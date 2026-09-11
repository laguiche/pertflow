// ─── Identité de révision d'un planning (v0.26.1) ────────────────────────────────
//
// Pourquoi : un planning partagé dans un répertoire commun passe de main en main, et
// PertFlow enregistre par TELECHARGEMENT — le fichier est ensuite recopié à la main
// sur le partage. Rien ne disait jusqu'ici qui avait sauvegardé quoi, ni quand, ni si
// deux fichiers étaient deux états du MÊME planning. Chaque sauvegarde est désormais
// identifiable, et le planning a une identité qui survit au renommage de son fichier.
// C'est le socle de la comparaison de deux .pert et du travail à plusieurs (cf.
// docs/conception.md, « Identité de révision »).
//
// Ce que porte meta (tout est serialise par storage.js) :
//   lot_id   : identité du planning, tirée UNE fois (première sauvegarde suivie) ;
//              ne change ni au renommage du fichier ni à l'import d'un autre .pert.
//   revision : numéro de la dernière sauvegarde (0 = jamais sauvegardé avec suivi).
//   history  : les PERT_HISTORY_MAX dernières sauvegardes, la plus récente en fin :
//              { rev, saved_at, saved_by, comment, fingerprint }.
//
// Règles :
//   - la révision n'avance QU'À la sauvegarde du fichier (pertSaveProject) ; la
//     sauvegarde automatique et sa restauration ne la touchent jamais ;
//   - l'empreinte est calculée en JS pur (cyrb53) : aucune API propre à un navigateur
//     (décision du 11/09/2026 — le parc est hétérogène, une API peut disparaître) ;
//   - nom et commentaire viennent d'un fichier, donc d'un tiers : ils ne sont JAMAIS
//     injectés en HTML, seulement posés en textContent (un .pert est une donnée) ;
//   - le nom de l'auteur est une préférence DU POSTE (localStorage), pas du fichier.

const PERT_HISTORY_MAX = 50;              // entrées conservées dans le fichier
const PERT_AUTHOR_KEY = "pertflow.auteur"; // clé localStorage du nom de l'auteur
const PERT_COMMENT_MAX = 200;             // longueur maximale d'un commentaire
const PERT_AUTHOR_MAX = 60;               // longueur maximale d'un nom

// Identité d'un planning (« p- », sur le modèle des uid de nœuds a-/j-/l-/r-).
function pertGenLotId() {
  return "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// Empreinte d'une chaîne : cyrb53 (domaine public), 53 bits rendus en hexadécimal.
// Pas une signature cryptographique : elle dit seulement « même contenu / contenu
// différent », ce qui suffit à reconnaître deux fichiers issus d'une même sauvegarde.
function pertHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

// Empreinte du CONTENU du planning (le graphe serialise), indépendante de meta : deux
// fichiers au graphe identique ont la même empreinte, quel que soit leur historique.
function pertGraphFingerprint(graphData) {
  return pertHash(JSON.stringify(graphData || null));
}

// Horodatage local « AAAA-MM-JJTHH:MM ». Surtout PAS toISOString() : il convertit en
// UTC et décalerait l'heure (voire la date) à l'est de Greenwich — piège déjà rencontré
// deux fois dans ce projet (cf. pertIsoLocal).
function pertLocalStamp(d) {
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
       + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
}

// « 11/09/2026 à 10:42 » ; une valeur illisible est rendue telle quelle plutôt que
// masquée (elle vient d'un fichier : mieux vaut la montrer que la perdre).
function pertFormatStamp(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(stamp || "");
  if (!m) return stamp || "date inconnue";
  return m[3] + "/" + m[2] + "/" + m[1] + " à " + m[4] + ":" + m[5];
}

// ─── Nom de l'auteur (préférence du poste) ──────────────────────────────────────
// localStorage peut être indisponible (navigateur verrouillé, navigation privée) :
// on retombe alors sur un nom vide, jamais sur une erreur.

function pertAuthorGet() {
  try { return (localStorage.getItem(PERT_AUTHOR_KEY) || "").slice(0, PERT_AUTHOR_MAX); }
  catch (e) { return ""; }
}

function pertAuthorSet(name) {
  const v = String(name || "").trim().slice(0, PERT_AUTHOR_MAX);
  try {
    if (v) localStorage.setItem(PERT_AUTHOR_KEY, v);
    else localStorage.removeItem(PERT_AUTHOR_KEY);
  } catch (e) { /* stockage indisponible : le nom vaudra pour cette sauvegarde seule */ }
  return v;
}

// ─── Lecture robuste des champs de meta ─────────────────────────────────────────
// Un .pert peut venir d'une version antérieure (champs absents) ou d'un tiers
// (champs mal formés) : on ne garde que ce qui a la forme attendue.

function pertSanitizeLotId(v) {
  return (typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v)) ? v : "";
}

function pertSanitizeHistory(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach(e => {
    if (!e || typeof e !== "object") return;
    const rev = parseInt(e.rev, 10);
    if (!isFinite(rev) || rev < 1) return;
    out.push({
      rev: rev,
      saved_at: typeof e.saved_at === "string" ? e.saved_at.slice(0, 32) : "",
      saved_by: typeof e.saved_by === "string" ? e.saved_by.slice(0, PERT_AUTHOR_MAX) : "",
      comment: typeof e.comment === "string" ? e.comment.slice(0, PERT_COMMENT_MAX) : "",
      fingerprint: typeof e.fingerprint === "string" ? e.fingerprint.slice(0, 32) : ""
    });
  });
  return out.slice(-PERT_HISTORY_MAX);
}

// Numéro de révision : entier >= 0, jamais inférieur à la dernière entrée d'historique
// (un fichier retouché à la main ne doit pas faire reculer la numérotation).
function pertSanitizeRevision(v, history) {
  let rev = parseInt(v, 10);
  if (!isFinite(rev) || rev < 0) rev = 0;
  (history || []).forEach(e => { if (e.rev > rev) rev = e.rev; });
  return rev;
}

// ─── Enregistrement d'une révision ──────────────────────────────────────────────

// Inscrit une nouvelle révision dans meta, juste avant l'écriture du fichier. Tire
// l'identité du planning si elle n'existe pas encore (fichier antérieur, projet neuf).
// opts : { author, comment } — author par défaut = le nom retenu sur ce poste.
function pertRecordRevision(meta, graphData, opts) {
  opts = opts || {};
  if (!pertSanitizeLotId(meta.lot_id)) meta.lot_id = pertGenLotId();
  meta.history = pertSanitizeHistory(meta.history);
  meta.revision = pertSanitizeRevision(meta.revision, meta.history) + 1;
  const author = opts.author != null ? String(opts.author) : pertAuthorGet();
  const entry = {
    rev: meta.revision,
    saved_at: pertLocalStamp(new Date()),
    saved_by: author.trim().slice(0, PERT_AUTHOR_MAX),
    comment: String(opts.comment || "").trim().slice(0, PERT_COMMENT_MAX),
    fingerprint: pertGraphFingerprint(graphData)
  };
  meta.history.push(entry);
  meta.history = meta.history.slice(-PERT_HISTORY_MAX);
  return entry;
}

// Dernière entrée d'historique (null si le fichier n'en a pas).
function pertLastRevision(meta) {
  const h = (meta && Array.isArray(meta.history)) ? meta.history : [];
  return h.length ? h[h.length - 1] : null;
}

// Phrase décrivant une entrée : « révision 14, le 11/09/2026 à 10:42 par Alice ».
function pertDescribeRevision(e) {
  let s = "révision " + e.rev + ", le " + pertFormatStamp(e.saved_at);
  if (e.saved_by) s += " par " + e.saved_by;
  return s;
}

// ─── Fenêtre « Sauvegarder le planning » ────────────────────────────────────────
// Chaque sauvegarde produit un fichier téléchargé : c'est déjà un acte délibéré. La
// fenêtre en profite pour demander un commentaire (facultatif) — l'historique vaut par
// ce qu'il dit — et le nom de l'auteur, prérempli dès la deuxième fois. Entrée valide,
// Échap annule : la sauvegarde reste à deux touches.

function pertSaveDialogOpen() {
  const dlg = document.getElementById("save-dialog");
  return !!dlg && dlg.style.display !== "none";
}

function pertOpenSaveDialog() {
  const dlg = document.getElementById("save-dialog");
  // Montage HTML sans la fenêtre (page de test, intégration) : sauvegarde directe.
  if (!dlg) { pertSaveProject(); return; }
  if (!window.pertGraph || !window.pertGraph._nodes.length) {
    showToast("Rien à sauvegarder");
    return;
  }
  const meta = window.pertMeta || {};
  const info = document.getElementById("save-rev-info");
  const next = pertSanitizeRevision(meta.revision, pertSanitizeHistory(meta.history)) + 1;
  const last = pertLastRevision(meta);
  if (info) {
    info.textContent = last
      ? "Cette sauvegarde sera la révision " + next + ". Précédente : " + pertDescribeRevision(last) + "."
      : "Première sauvegarde suivie de ce planning : révision " + next + ".";
  }
  const author = document.getElementById("save-author");
  const comment = document.getElementById("save-comment");
  author.value = pertAuthorGet();
  comment.value = "";
  dlg.style.display = "flex";
  // Le nom est connu dès la deuxième fois : on va droit au commentaire.
  (author.value ? comment : author).focus();
}

function pertCloseSaveDialog() {
  const dlg = document.getElementById("save-dialog");
  if (dlg) dlg.style.display = "none";
}

function pertConfirmSaveDialog() {
  const author = pertAuthorSet(document.getElementById("save-author").value);
  const comment = document.getElementById("save-comment").value;
  pertCloseSaveDialog();
  pertSaveProject({ author: author, comment: comment });
}

// Branchement des boutons et du clavier (appelé une fois, au démarrage, par ui.js).
function pertInstallSaveDialog() {
  const dlg = document.getElementById("save-dialog");
  if (!dlg) return;
  document.getElementById("save-ok").addEventListener("click", () => {
    guardUI("Sauvegarde impossible", pertConfirmSaveDialog);
  });
  document.getElementById("save-cancel").addEventListener("click", pertCloseSaveDialog);
  ["save-author", "save-comment"].forEach(id => {
    document.getElementById(id).addEventListener("keydown", e => {
      // Les raccourcis globaux ignorent la frappe dans un champ (ui.js) : on traite
      // donc ici Entrée, Échap et Ctrl+S — sans quoi Ctrl+S ouvrirait le dialogue
      // « Enregistrer la page » du navigateur.
      if (e.key === "Enter" || (e.ctrlKey && (e.key === "s" || e.key === "S"))) {
        e.preventDefault();
        guardUI("Sauvegarde impossible", pertConfirmSaveDialog);
      } else if (e.key === "Escape") {
        e.preventDefault();
        pertCloseSaveDialog();
      }
    });
  });
}

// ─── Onglet « Historique » des Paramètres ───────────────────────────────────────

// Remplit l'onglet à l'ouverture des Paramètres : identité, nom de l'auteur, liste des
// sauvegardes (la plus récente en tête). Tout passe par textContent (cf. en-tête).
function pertFillHistoryPanel() {
  const meta = window.pertMeta || {};
  const idBox = document.getElementById("settings-history-id");
  const list = document.getElementById("settings-history-list");
  const author = document.getElementById("settings-author");
  if (author) author.value = pertAuthorGet();
  const history = pertSanitizeHistory(meta.history);
  const rev = pertSanitizeRevision(meta.revision, history);
  const lotId = pertSanitizeLotId(meta.lot_id);

  if (idBox) {
    idBox.textContent = "";
    const line = document.createElement("div");
    line.className = "history-rev";
    line.textContent = rev ? "Révision " + rev : "Jamais sauvegardé avec suivi de révision";
    idBox.appendChild(line);
    if (lotId) {
      const idLine = document.createElement("div");
      idLine.className = "history-lotid";
      idLine.textContent = "Identifiant du planning : " + lotId;
      idLine.title = "Reconnaît ce planning quel que soit le nom de son fichier";
      idBox.appendChild(idLine);
    }
  }

  if (!list) return;
  list.textContent = "";
  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "Aucune sauvegarde n'est encore inscrite dans ce fichier. "
      + "La prochaine ouvrira l'historique.";
    list.appendChild(empty);
    return;
  }
  history.slice().reverse().forEach(e => {
    const item = document.createElement("div");
    item.className = "history-item";
    const head = document.createElement("div");
    head.className = "history-head";
    const num = document.createElement("span");
    num.className = "history-num";
    num.textContent = "Rév. " + e.rev;
    const when = document.createElement("span");
    when.textContent = pertFormatStamp(e.saved_at) + (e.saved_by ? " · " + e.saved_by : "");
    head.appendChild(num);
    head.appendChild(when);
    const body = document.createElement("div");
    body.className = "history-comment" + (e.comment ? "" : " none");
    body.textContent = e.comment || "sans commentaire";
    item.appendChild(head);
    item.appendChild(body);
    list.appendChild(item);
  });
}

// Validation des Paramètres : seul le nom de l'auteur relève de cet onglet.
function pertSaveHistoryPanel() {
  const author = document.getElementById("settings-author");
  if (author) pertAuthorSet(author.value);
}

// Exposition globale (storage.js, ui.js, tests)
window.pertRecordRevision = pertRecordRevision;
window.pertGraphFingerprint = pertGraphFingerprint;
window.pertOpenSaveDialog = pertOpenSaveDialog;
window.pertFillHistoryPanel = pertFillHistoryPanel;
window.pertSaveHistoryPanel = pertSaveHistoryPanel;
