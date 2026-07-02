// ─── Sauvegarde automatique / recuperation apres plantage ───────────────────────
//
// Contrainte file:// (PC verrouille DSI) : on ne peut PAS ecrire silencieusement un
// fichier .pert sur le disque (aucun serveur ; le navigateur ne declenche un
// telechargement que sur action utilisateur). Le seul mecanisme fiable est un
// snapshot de RECUPERATION dans localStorage (meme stockage que le presse-papier
// LiteGraph, donc disponible dans le contexte file:// de l'app).
//
// Principe :
//  - Quand l'option est activee (meta.autosave, case dans Parametres), l'app ecrit
//    en continu une copie du projet dans localStorage (a intervalle, uniquement si
//    le projet a change depuis la derniere ecriture).
//  - Au demarrage, si un snapshot subsiste (typiquement apres un plantage : une
//    fermeture propre n'est pas requise pour le conserver), on PROPOSE de le
//    restaurer via un dialogue (choix utilisateur : « Proposer de restaurer »).
//  - Ce snapshot NE REMPLACE PAS le fichier .pert : c'est un filet anti-crash.
//    Une vraie sauvegarde (.pert) ou un chargement efface le snapshot (plus rien
//    « non sauvegarde » a recuperer) ; il est re-cree des la modification suivante.
//
// Aucune dependance, pur JS, charge en <script src> (compatible file://).

(function (global) {
  "use strict";

  var STORAGE_KEY = "pertflow.recovery.v1";
  var INTERVAL_MS = 8000; // frequence de verification/ecriture du snapshot

  // Sequence de changements : incrementee a chaque modification (pertHistoryMark),
  // figee a savedSeq lors d'une vraie sauvegarde/chargement. Un snapshot de
  // recuperation ne doit exister que s'il y a du travail non sauvegarde
  // (changeSeq > savedSeq) → le dialogue de demarrage reste pertinent.
  var changeSeq = 0;   // nb de modifications depuis le debut de session
  var savedSeq = 0;    // valeur de changeSeq au dernier point sauvegarde
  var writtenSeq = -1; // valeur de changeSeq du dernier snapshot ecrit
  var warnedQuota = false;

  function lsAvailable() {
    try { return typeof localStorage !== "undefined"; } catch (e) { return false; }
  }

  // Marque une modification du projet (branche sur pertHistoryMark).
  function touch() { changeSeq++; }

  // Y a-t-il du travail non sauvegarde a proteger ?
  function hasUnsaved() {
    if (changeSeq <= savedSeq) return false;
    var g = global.pertGraph;
    return !!(g && g._nodes && g._nodes.length > 0);
  }

  // Ecrit le snapshot de recuperation (best-effort, jamais bloquant).
  function writeSnapshot() {
    if (!lsAvailable()) return;
    try {
      var payload = {
        ts: Date.now(),
        title: (global.pertMeta && global.pertMeta.title) || "",
        project: global.pertSerializeProject ? global.pertSerializeProject() : null
      };
      if (!payload.project || !payload.project.graph) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      writtenSeq = changeSeq;
    } catch (e) {
      // Quota depasse ou stockage indisponible : on previent une seule fois.
      if (!warnedQuota && global.showToast) {
        global.showToast("Sauvegarde automatique impossible (stockage navigateur indisponible)", true);
        warnedQuota = true;
      }
    }
  }

  // Efface le snapshot (apres restauration, refus, vraie sauvegarde ou chargement).
  function clearSnapshot() {
    if (!lsAvailable()) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    writtenSeq = changeSeq;
  }

  // Appele apres une vraie sauvegarde .pert ou un chargement : l'etat courant
  // devient le point de reference « sauvegarde » → plus rien a recuperer.
  function markSaved() {
    savedSeq = changeSeq;
    clearSnapshot();
  }

  // Tick periodique : ecrit le snapshot si l'option est active et qu'il y a du
  // nouveau travail non sauvegarde depuis la derniere ecriture.
  function tick() {
    if (!global.pertMeta || global.pertMeta.autosave !== true) return;
    if (!hasUnsaved()) return;
    if (changeSeq === writtenSeq) return; // deja ecrit cet etat
    writeSnapshot();
  }

  // Bascule de l'option depuis Parametres : ecrit tout de suite si pertinent,
  // efface si desactive (plus de filet demande).
  function onToggle() {
    if (global.pertMeta && global.pertMeta.autosave === true) {
      if (hasUnsaved()) writeSnapshot();
    } else {
      clearSnapshot();
    }
  }

  // Lit un snapshot exploitable (ou null).
  function readSnapshot() {
    if (!lsAvailable()) return null;
    var raw;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var data = JSON.parse(raw);
      if (data && data.project && data.project.graph) return data;
    } catch (e) { /* snapshot corrompu : on l'ignore */ }
    return null;
  }

  // Formate un horodatage (ms) en date/heure locale lisible.
  function formatTs(ms) {
    try { return new Date(ms).toLocaleString("fr-FR"); }
    catch (e) { return ""; }
  }

  // Verifie au demarrage la presence d'un snapshot et PROPOSE de le restaurer.
  function checkRecovery() {
    var snap = readSnapshot();
    if (!snap) return;
    var when = formatTs(snap.ts);
    var title = snap.title || "projet sans titre";
    var whenEl = document.getElementById("recovery-when");
    if (whenEl) {
      whenEl.textContent = "« " + title + " » — " + when;
    }
    var dlg = document.getElementById("recovery-dialog");
    if (!dlg) {
      // Filet : pas de dialogue dans le DOM → on efface pour ne pas rester bloque.
      clearSnapshot();
      return;
    }
    dlg.style.display = "flex";

    var btnRestore = document.getElementById("recovery-restore");
    var btnIgnore = document.getElementById("recovery-ignore");

    function close() { dlg.style.display = "none"; }

    btnRestore.onclick = function () {
      close();
      if (global.pertApplyProject) {
        global.pertApplyProject(snap.project);
        // Le projet restaure est desormais l'etat courant ; il n'a pas ete
        // ecrit dans un .pert → il reste « non sauvegarde », mais on repart du
        // snapshot restaure comme reference d'ecriture pour eviter un doublon.
        savedSeq = changeSeq;         // pertApplyProject a pu incrementer via marks
        writtenSeq = changeSeq;
        if (global.showToast) global.showToast("Travail récupéré restauré");
      }
    };
    btnIgnore.onclick = function () {
      close();
      clearSnapshot();               // refus explicite → on ne renotifie plus
      savedSeq = changeSeq;
    };
  }

  // Demarre le module : timer periodique + flush best-effort a la fermeture.
  function start() {
    setInterval(tick, INTERVAL_MS);
    global.addEventListener("beforeunload", function () {
      if (global.pertMeta && global.pertMeta.autosave === true && hasUnsaved()) {
        writeSnapshot();
      }
    });
  }

  // Exposition globale.
  global.pertAutosaveTouch = touch;
  global.pertAutosaveMarkSaved = markSaved;
  global.pertAutosaveOnToggle = onToggle;
  global.pertAutosaveCheckRecovery = checkRecovery;
  global.pertAutosaveStart = start;

})(typeof globalThis !== "undefined" ? globalThis : this);
