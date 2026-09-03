// ─── Gestion des risques ────────────────────────────────────────────────────────
//
// POURQUOI CE MODULE. Un planning ne dit que ce qui est PREVU. Ce qui le met en
// defaut — une qualification qui traine, un fournisseur unique, une ressource pas
// encore recrutee — vivait jusqu'ici dans un tableau a part, sans lien avec les
// dates. Or un risque n'a d'interet que rapporte a une PERIODE et a des TACHES :
// « de quand a quand suis-je expose, et sur quoi ». C'est exactement ce que le PERT
// sait dire. Le risque devient donc un objet du planning (nœud `pert/risk`, cf.
// nodes.js) qui LIT le calcul sans jamais y entrer.
//
// LE MODELE, EN UNE PHRASE : un risque porte un libelle, une date de DEBUT saisie
// (bornee), et une date de FIN qui n'est pas saisie du tout — elle est DEDUITE des
// taches couvertes, comme le cout est deduit de la charge. Rien a re-saisir, rien a
// re-synchroniser : c'est ce qui garantit qu'un risque ne peut pas mentir sur le
// planning apres un replanning.
//
//   fin    = max(LF) des taches couvertes      → le risque court tant qu'UNE des
//            (a defaut : LF du projet, 0 si      taches exposees n'est pas bouclee
//             le projet est vide)                au plus tard
//   debut  = saisi, borne a [T0 , min(ES) des taches couvertes]
//   duree  = fin − debut
//
// La borne haute du debut est le min des ES : un risque qui commencerait APRES la
// premiere tache qu'il couvre ne la couvrirait pas. La borne basse est T0, l'origine
// contractuelle — SAUF si une tache couverte est anticipee (ES negatif), auquel cas
// la borne basse descend jusqu'a cet ES : refuser le cas rendrait le risque
// incapable de couvrir sa propre tache (cf. pertRiskBounds).
//
// LA SAISIE N'EST JAMAIS ECRASEE. `start_offset` conserve ce que l'utilisateur a
// tape ; le bornage est applique A LA LECTURE (pertRiskStart). Consequence voulue :
// couvrir une tache tres precoce ramene le debut affiche a l'ES de celle-ci, et la
// DETACHER rend au risque son debut d'origine. Ecraser la propriete aurait detruit
// l'information a la premiere connexion, sans moyen de revenir en arriere.
//
// AUCUN EFFET SUR LE PERT — regle absolue, meme rang que celle de l'avancement :
// aucune fonction de ce fichier n'appelle pertRecalc, et le moteur ignore le type
// `pert/risk` (hors PERT_TYPES). La dependance est a sens unique.
//
// Contrainte file:// : pur JS charge en <script src>, aucune dependance.

// ─── Lecture du modele ──────────────────────────────────────────────────────────

function pertRiskNodes() {
  const g = window.pertGraph;
  if (!g || !g._nodes) return [];
  return g._nodes.filter(n => n.type === "pert/risk");
}
window.pertRiskNodes = pertRiskNodes;

function pertRiskByUid(uid) {
  if (!uid) return null;
  return pertRiskNodes().find(n => (n.properties.uid || "") === uid) || null;
}

// Appelee depuis nodes.js (pertNodeDimmed) : ce risque couvre-t-il cette Activite ?
// Passer par une fonction plutot que de relire `covers` sur place garde UN seul
// endroit qui sait comment le rattachement est stocke.
function pertRiskCovers(riskUid, actUid) {
  const r = pertRiskByUid(riskUid);
  if (!r || !actUid) return false;
  return (r.properties.covers || []).indexOf(actUid) !== -1;
}
window.pertRiskCovers = pertRiskCovers;

// Activites effectivement presentes dans le graphe pour les uid couverts. Un uid
// orphelin (tache supprimee depuis) est simplement ignore : on ne « nettoie » pas
// `covers` en douce, car un undo peut ramener la tache — et un rattachement efface
// sans que l'utilisateur l'ait demande serait invisible.
function pertRiskCoveredNodes(risk) {
  const g = window.pertGraph;
  if (!risk || !g || !g._nodes) return [];
  const uids = risk.properties.covers || [];
  if (!uids.length) return [];
  const wanted = new Set(uids);
  const out = g._nodes.filter(n => n.type === "pert/activity"
    && n.properties && wanted.has(n.properties.uid));
  // Ordre chronologique : un risque se lit dans le sens du temps, comme les listes
  // de jalons de la synthese.
  out.sort((a, b) => {
    const da = a.es == null ? Infinity : a.es, db = b.es == null ? Infinity : b.es;
    if (da !== db) return da - db;
    return String(a.properties.label || "").localeCompare(String(b.properties.label || ""), "fr");
  });
  return out;
}
window.pertRiskCoveredNodes = pertRiskCoveredNodes;

// Fin de projet en offset : le LF le plus tardif du planning (a defaut son EF, pour
// un nœud qu'un cycle a laisse sans backward pass). 0 — c'est-a-dire T0 — quand le
// projet est vide : c'est la valeur d'initialisation demandee pour un risque cree
// sur un planning encore blanc.
function pertProjectEndOffset() {
  const g = window.pertGraph;
  if (!g || !g._nodes) return 0;
  let end = null;
  g._nodes.forEach(n => {
    if (!pertIsComputed(n)) return;
    const v = (n.lf != null) ? n.lf : n.ef;
    if (v == null) return;
    if (end === null || v > end) end = v;
  });
  return end === null ? 0 : end;
}
window.pertProjectEndOffset = pertProjectEndOffset;

// Fin du risque (offset). DEDUITE, jamais stockee — c'est ce qui la rend
// automatiquement juste apres toute connexion, deconnexion ou replanification, sans
// le moindre code de synchronisation.
function pertRiskEnd(risk) {
  const covered = pertRiskCoveredNodes(risk);
  let end = null;
  covered.forEach(n => {
    const v = (n.lf != null) ? n.lf : n.ef;
    if (v == null) return;
    if (end === null || v > end) end = v;
  });
  // Aucune tache couverte (ou aucune calculable, cas d'un cycle) : le risque pese sur
  // tout le projet — c'est l'hypothese la moins fausse tant qu'on n'a rien precise.
  return end === null ? pertProjectEndOffset() : end;
}
window.pertRiskEnd = pertRiskEnd;

// Bornes admissibles de la date de DEBUT, en offsets : { lo, hi }.
function pertRiskBounds(risk) {
  const covered = pertRiskCoveredNodes(risk);
  let minEs = null;
  covered.forEach(n => {
    if (n.es == null) return;
    if (minEs === null || n.es < minEs) minEs = n.es;
  });
  // Sans tache couverte, il n'y a pas d'ES a respecter : la seule borne est la fin du
  // risque lui-meme (un debut posterieur a la fin n'aurait aucun sens).
  const hi = (minEs === null) ? pertRiskEnd(risk) : minEs;
  // T0 (offset 0) est la borne basse, sauf si une tache couverte est ANTICIPEE : son
  // ES est alors negatif et le risque doit pouvoir descendre avec elle, sinon il ne
  // couvrirait pas la tache qu'on vient de lui rattacher.
  return { lo: Math.min(0, hi), hi: hi };
}
window.pertRiskBounds = pertRiskBounds;

// Debut effectif (offset) : la saisie, RAMENEE dans ses bornes. La propriete n'est
// pas modifiee — cf. l'en-tete du fichier.
function pertRiskStart(risk) {
  if (!risk || !risk.properties) return 0;
  const b = pertRiskBounds(risk);
  const v = parseFloat(risk.properties.start_offset);
  const start = isNaN(v) ? 0 : v;
  return Math.max(b.lo, Math.min(b.hi, start));
}
window.pertRiskStart = pertRiskStart;

// Duree exposee, dans l'unite du projet.
function pertRiskDuration(risk) {
  return pertRiskEnd(risk) - pertRiskStart(risk);
}
window.pertRiskDuration = pertRiskDuration;

// « 01/03/26 → 14/09/26 » (ou « +0 j → +12 j » sans T0). Utilise par le bandeau et
// par les rapports : la meme periode ne doit pas s'ecrire de deux facons.
function pertRiskPeriodLabel(risk) {
  const s = pertRiskStart(risk), e = pertRiskEnd(risk);
  const fmt = (typeof pertOffsetLabel === "function")
    ? pertOffsetLabel
    : (o => String(o));
  return fmt(s) + " → " + fmt(e);
}
window.pertRiskPeriodLabel = pertRiskPeriodLabel;

// Cout cumule des taches couvertes — l'ordre de grandeur de ce que le risque met en
// jeu. Lu via pertActivityCost, comme partout ailleurs (jamais etp × taux a la main).
function pertRiskExposure(risk) {
  let total = 0;
  pertRiskCoveredNodes(risk).forEach(n => { total += pertActivityCost(n); });
  return total;
}
window.pertRiskExposure = pertRiskExposure;

// ─── Geometrie du bandeau ───────────────────────────────────────────────────────
//
// L'abscisse et la largeur SONT la periode (decision 3 de nodes.js) : elles sont
// posees ici et nulle part ailleurs. L'ordonnee, elle, appartient a l'utilisateur —
// on n'y touche jamais, c'est ce qui lui permet d'empiler ses risques ou de les
// ranger sous le bloc de taches qu'ils concernent.
//
// L'origine du repere est celle de TOUT le planning : pertT0OriginX, deduite des
// nœuds calcules. Sur un graphe qui n'en contient aucun, elle vaut null → on retombe
// sur la marge du layout, la meme que celle ou seront poses les premiers nœuds.
function pertRiskSyncGeometry(risk) {
  if (!risk || !risk.properties) return;
  const g = window.pertGraph;
  const origin = (typeof pertT0OriginX === "function") ? pertT0OriginX(g) : null;
  const ox = (origin === null || origin === undefined) ? PERT_LAYOUT_MARGIN_X : origin;
  const s = pertRiskStart(risk), e = pertRiskEnd(risk);
  risk.pos[0] = ox + s * PERT_PX_PER_UNIT;
  risk.size[0] = Math.max(PERT_RISK_MIN_W, (e - s) * PERT_PX_PER_UNIT);
  risk.size[1] = PERT_RISK_H;
}
window.pertRiskSyncGeometry = pertRiskSyncGeometry;

// Recale tous les bandeaux. Appelee en fin de pertRecalc (le seul moment ou les LF
// bougent) et apres tout rattachement. C'est une COUTURE volontaire dans le moteur :
// une ligne d'appel garde, plutot que de disperser le recalage dans chaque appelant
// — et le moteur, lui, ignore toujours tout du contenu des risques.
function pertSyncRisks() {
  const risks = pertRiskNodes();
  if (!risks.length) return;
  risks.forEach(pertRiskSyncGeometry);
  const g = window.pertGraph;
  if (g) g.setDirtyCanvas(true, true);
}
window.pertSyncRisks = pertSyncRisks;

// ─── Trait de rattachement (dessine, pas connecte) ──────────────────────────────
//
// Le lien risque → tache n'existe pas dans graph.links (cf. decision 2 de nodes.js) :
// il est trace ici, en POINTILLE, dans le fond du canvas — donc SOUS les nœuds, comme
// la trame calendaire. Le passer au-dessus barrerait le texte des taches.
//
// ⚠ On CHAINE le handler existant, et ce module doit etre installe APRES la grille,
// le repere T0 et la trame (cf. « Rendu de fond du CANVAS » dans CLAUDE.md) : une
// affectation ecraserait purement les precedents, sans la moindre erreur.
function pertInstallRiskTies(canvas) {
  if (!canvas || canvas._pertRiskTies) return;
  canvas._pertRiskTies = true;
  const previous = canvas.onDrawBackground;
  canvas.onDrawBackground = function(ctx, visibleArea) {
    if (previous) previous.call(this, ctx, visibleArea);
    pertDrawRiskTies(ctx);
  };
}
window.pertInstallRiskTies = pertInstallRiskTies;

function pertDrawRiskTies(ctx) {
  const risks = pertRiskNodes();
  if (!risks.length) return;
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.5;
  risks.forEach(risk => {
    // Un risque estompe par le filtre n'affiche pas ses traits : ils ajouteraient du
    // bruit exactement la ou l'on demande a ne PAS regarder.
    if (pertNodeDimmed(risk)) return;
    const col = risk.properties.color || PERT_RISK_DEFAULT_COLOR;
    ctx.strokeStyle = pertRiskTint(col, 0.55);
    const rx0 = risk.pos[0], rx1 = risk.pos[0] + risk.size[0];
    const ryTop = risk.pos[1], ryBot = risk.pos[1] + risk.size[1];
    pertRiskCoveredNodes(risk).forEach(act => {
      const acx = act.pos[0] + act.size[0] / 2;
      const dessous = act.pos[1] > ryBot;
      // Depart : le point du bandeau le plus proche a l'aplomb de la tache. Un trait
      // qui partirait toujours du milieu traverserait tout le bandeau des qu'il est
      // long, et se croiserait avec ses voisins.
      const sx = Math.max(rx0 + 6, Math.min(rx1 - 6, acx));
      const sy = dessous ? ryBot : ryTop;
      const ey = dessous ? act.pos[1] : act.pos[1] + act.size[1];
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(acx, ey);
      ctx.stroke();
    });
  });
  ctx.restore();
}

// ─── Rattachement / detachement ─────────────────────────────────────────────────
//
// Le geste est un BASCULEMENT : la meme ligne rattache puis detache. « Connexion » et
// « deconnexion » sont deux faces d'un ajout/retrait dans une liste — les separer en
// deux commandes aurait oblige a savoir, avant de cliquer, dans quel etat on est.
//
// Aucun pertRecalc : les dates du risque sont DEDUITES, il n'y a rien a recalculer
// dans le PERT (regle absolue). On repositionne les bandeaux et on pose un cran
// d'undo, puisque le geste modifie le document.
function pertRiskToggleCover(risk, act) {
  if (!risk || !act || !act.properties || !act.properties.uid) return false;
  const uid = act.properties.uid;
  const covers = risk.properties.covers || (risk.properties.covers = []);
  const i = covers.indexOf(uid);
  const nom = act.properties.label || "(sans nom)";
  if (i === -1) covers.push(uid); else covers.splice(i, 1);
  pertRiskSyncGeometry(risk);
  if (window.pertGraph) window.pertGraph.setDirtyCanvas(true, true);
  if (typeof pertHistoryMark === "function") pertHistoryMark();
  if (window.showToast) {
    showToast(i === -1
      ? "« " + nom + " » est désormais couverte par ce risque"
      : "« " + nom + " » n'est plus couverte par ce risque");
  }
  return i === -1;
}
window.pertRiskToggleCover = pertRiskToggleCover;

// ─── Fenetre « Couvrir des taches… » ────────────────────────────────────────────
//
// Meme parti pris que « Relier a… » (v0.25), et pour la meme raison : sur un grand
// planning, designer une tache par une RECHERCHE coute infiniment moins cher que
// d'aller la chercher a l'ecran. La vue ne bouge pas, aucun nœud n'est deplace.
//
// Deux differences assumees avec « Relier a… » :
//   - la liste ne contient QUE des Activites (un risque ne couvre pas un jalon : un
//     jalon n'a pas de duree, donc pas d'exposition) ;
//   - rien n'est jamais impossible ni desactive — d'ou le basculement plutot que des
//     lignes grisees. Ici l'etat « deja couvert » n'est pas un obstacle, c'est une
//     information sur laquelle on peut agir.
const PERT_RL_MAX_ROWS = 200;

const pertRiskLink = {
  riskId: null,
  text: "",
  group: "",
  resp: "",
  // « Ne montrer que les taches deja couvertes » : sur un planning fourni, c'est la
  // seule facon de relire d'un coup ce qu'on vient de rattacher sans le chercher
  // parmi trois cents lignes. Non memorise entre deux ouvertures — c'est un geste de
  // verification, pas une preference.
  couvertesSeules: false
};

function pertRlRisk() {
  const g = window.pertGraph;
  if (!g || !g._nodes || pertRiskLink.riskId === null) return null;
  return g._nodes.find(n => n.id === pertRiskLink.riskId) || null;
}

function pertRlCandidates() {
  const risk = pertRlRisk();
  const g = window.pertGraph;
  if (!risk || !g) return { rows: [], total: 0, couvertes: 0 };
  const covers = new Set(risk.properties.covers || []);
  const needle = pertNormalizeSearch(pertRiskLink.text);
  const rows = [];
  let couvertes = 0;
  g._nodes.forEach(n => {
    if (n.type !== "pert/activity" || !n.properties) return;
    const couverte = covers.has(n.properties.uid);
    if (couverte) couvertes++;
    if (pertRiskLink.couvertesSeules && !couverte) return;
    const p = n.properties;
    if (needle && pertNormalizeSearch(pertNodeSearchText(n)).indexOf(needle) === -1) return;
    if (pertRiskLink.group && (p.group || "").trim() !== pertRiskLink.group) return;
    if (pertRiskLink.resp && (p.responsible || "").trim() !== pertRiskLink.resp) return;
    rows.push({ node: n, couverte: couverte });
  });
  rows.sort((a, b) => {
    const da = a.node.es == null ? Infinity : a.node.es;
    const db = b.node.es == null ? Infinity : b.node.es;
    if (da !== db) return da - db;
    return String(a.node.properties.label || "")
      .localeCompare(String(b.node.properties.label || ""), "fr");
  });
  return { rows: rows.slice(0, PERT_RL_MAX_ROWS), total: rows.length, couvertes: couvertes };
}

function pertRlBuildRow(row) {
  const n = row.node;
  const el = document.createElement("button");
  el.type = "button";
  el.className = "ls-row rl-row" + (row.couverte ? " rl-couverte" : "")
    + (n.is_critical ? " lk-critical" : "");

  // Marque d'etat tracee en CSS (carre coche), pas un glyphe « ☑ » : meme raison que
  // les marqueurs des nœuds, on ne maitrise pas les polices du poste.
  const box = document.createElement("span");
  box.className = "rl-box" + (row.couverte ? " on" : "");

  const name = document.createElement("span");
  name.className = "lk-name";
  name.textContent = n.properties.label || "(sans nom)";

  const p = n.properties;
  const meta = [p.group, p.responsible].map(v => (v || "").trim()).filter(Boolean).join(" · ");
  const sub = document.createElement("span");
  sub.className = "ls-meta";
  sub.textContent = meta;

  const tail = document.createElement("span");
  tail.className = "ls-tail";
  tail.textContent = pertOffsetLabel(n.es) + " → " + pertOffsetLabel(n.lf);

  el.appendChild(box);
  el.appendChild(name);
  if (meta) el.appendChild(sub);
  el.appendChild(tail);
  el.title = row.couverte ? "Retirer cette tâche du risque" : "Couvrir cette tâche";
  el.addEventListener("click", () => {
    const risk = pertRlRisk();
    if (!risk) return;
    pertRiskToggleCover(risk, n);
    pertRlRender();
    // Le panneau lateral affiche peut-etre la synthese de ce risque : ses dates
    // viennent de changer.
    if (typeof showProperties === "function" && window.pertCanvas) {
      const sel = Object.values(window.pertCanvas.selected_nodes || {});
      if (sel.length === 1 && sel[0] === risk) showProperties(risk);
    }
  });
  return el;
}

function pertRlRender() {
  const risk = pertRlRisk();
  const list = document.getElementById("risklink-list");
  const count = document.getElementById("risklink-count");
  const title = document.getElementById("risklink-title");
  const periode = document.getElementById("risklink-periode");
  if (!list || !count) return;
  if (!risk) { pertCloseRiskLink(); return; }

  if (title) title.textContent = "Risque « " + (risk.properties.label || "(sans nom)") + " »";
  // La periode est rappelee EN PERMANENCE et se met a jour a chaque basculement :
  // c'est l'accuse de reception du geste — on voit la fin du risque bouger quand on
  // couvre une tache plus tardive, ce qui est tout l'interet du dispositif.
  if (periode) periode.textContent = "Période exposée : " + pertRiskPeriodLabel(risk);

  pertRiskLink.group = pertLsFillFacet("risklink-group", collectGroupNames(),
    pertRiskLink.group, "Tous les groupes");
  pertRiskLink.resp = pertLsFillFacet("risklink-resp", collectResponsibles(),
    pertRiskLink.resp, "Tous les responsables");
  const only = document.getElementById("risklink-only");
  if (only) only.checked = pertRiskLink.couvertesSeules;

  const { rows, total, couvertes } = pertRlCandidates();
  count.textContent = total === 0
    ? (pertRiskLink.couvertesSeules ? "Aucune tâche couverte" : "Aucune tâche ne correspond")
    : (couvertes + " tâche(s) couverte(s) — " + total + " affichable(s)"
       + (total > rows.length ? ", " + rows.length + " premières affichées, affinez la recherche" : ""));
  count.className = "ls-count" + (total === 0 ? " empty" : "");

  list.innerHTML = "";
  rows.forEach(r => list.appendChild(pertRlBuildRow(r)));
}

function pertOpenRiskLink(risk) {
  if (!risk || risk.type !== "pert/risk") return;
  pertRiskLink.riskId = risk.id;
  pertRiskLink.text = "";
  pertRiskLink.couvertesSeules = false;
  const input = document.getElementById("risklink-text");
  if (input) input.value = "";
  pertRlRender();
  const dlg = document.getElementById("risklink-dialog");
  if (dlg) dlg.style.display = "flex";
  if (input) input.focus();
}
window.pertOpenRiskLink = pertOpenRiskLink;

function pertCloseRiskLink() {
  const dlg = document.getElementById("risklink-dialog");
  if (dlg) dlg.style.display = "none";
  pertRiskLink.riskId = null;
}
window.pertCloseRiskLink = pertCloseRiskLink;

function pertInstallRiskLink() {
  const input = document.getElementById("risklink-text");
  if (input) input.addEventListener("input", e => {
    pertRiskLink.text = e.target.value; pertRlRender();
  });
  const g = document.getElementById("risklink-group");
  if (g) g.addEventListener("change", e => { pertRiskLink.group = e.target.value; pertRlRender(); });
  const r = document.getElementById("risklink-resp");
  if (r) r.addEventListener("change", e => { pertRiskLink.resp = e.target.value; pertRlRender(); });
  const only = document.getElementById("risklink-only");
  if (only) only.addEventListener("change", e => {
    pertRiskLink.couvertesSeules = e.target.checked; pertRlRender();
  });
  const close = document.getElementById("risklink-close");
  if (close) close.addEventListener("click", pertCloseRiskLink);
  const dlg = document.getElementById("risklink-dialog");
  if (dlg) dlg.addEventListener("keydown", e => { if (e.key === "Escape") pertCloseRiskLink(); });
}
window.pertInstallRiskLink = pertInstallRiskLink;

// ─── Synthese des taches couvertes (panneau lateral) ────────────────────────────
//
// Repond a « ce risque, il pese sur quoi ? » — la question qu'on se pose le nœud
// selectionne sous les yeux. Les helpers de rendu sont ceux de synthesis.js : un
// tableau de taches doit avoir la meme graphie partout, c'est la raison d'etre de
// leur mutualisation.
function pertRiskFillSynthesis(parent, risk) {
  const u = (window.pertMeta && window.pertMeta.unit) || "j";
  const covered = pertRiskCoveredNodes(risk);
  const b = pertRiskBounds(risk);

  const ov = synthEl("div", "synth-overview");
  synthKV(ov, "Début (exposition)", pertOffsetLabel(pertRiskStart(risk)));
  synthKV(ov, "Fin (déduite)", pertOffsetLabel(pertRiskEnd(risk)));
  synthKV(ov, "Durée exposée", pertFormatSlack(pertRiskDuration(risk)).replace("+", "") + " " + u);
  synthKV(ov, "Tâches couvertes", String(covered.length));
  if (covered.length) synthKV(ov, "Coût des tâches couvertes", pertFormatCost(pertRiskExposure(risk)));
  // La borne haute EXPLIQUE pourquoi le champ de saisie refuse d'aller plus loin.
  // Sans elle, l'utilisateur constate un plafond sans en comprendre l'origine.
  synthKV(ov, "Début réglable jusqu'à", pertOffsetLabel(b.hi));
  synthSection(parent, "Période", ov);

  if (!covered.length) {
    synthSection(parent, "Tâches couvertes", null,
      "Ce risque ne couvre aucune tâche : sa fin est calée sur la fin du projet. "
      + "Utilisez « Couvrir des tâches… » pour dire sur quoi il pèse.");
    return;
  }

  const rows = covered.map(n => ({
    cells: [
      { text: n.properties.label || "(sans nom)", nodeId: n.id },
      { text: (n.properties.group || "").trim() || "—" },
      { text: pertOffsetLabel(n.es) },
      { text: pertOffsetLabel(n.lf) },
      synthMarginCell(n.slack, u),
      { text: pertProgressDef(n.properties.progress).label }
    ]
  }));
  synthSection(parent, "Tâches couvertes", synthTable([
    { text: "Tâche" }, { text: "Groupe" }, { text: "Début t.tôt" },
    { text: "Fin t.tard" }, { text: "Marge", cls: "num" }, { text: "Avancement" }
  ], rows));
}
window.pertRiskFillSynthesis = pertRiskFillSynthesis;

// ─── Fenetre « Risques » (3e volet du bouton Synthese) ──────────────────────────
//
// Deux onglets = deux chapitres a l'impression, comme la synthese et le suivi :
//   « Par risque »  — ce que chaque risque met en jeu ;
//   « Par tâche »   — l'inverse : quelles taches sont exposees, et a combien de
//                     risques. C'est cette lecture-la qui fait ressortir la tache
//                     qui concentre trois risques a elle seule, invisible autrement.
// Une section vide reste AFFICHEE avec son message (regle de la fenetre de suivi) :
// « aucune tache exposee » est une reponse qu'un pilote vient chercher.
const PERT_RISKS_TABS = [
  { id: "risques", label: "Par risque", chapter: "Risques du planning" },
  { id: "taches",  label: "Par tâche",  chapter: "Tâches exposées" },
];

let pertRisksTab = "risques";

function pertSelectRisksTab(name) {
  const tabs = document.querySelectorAll("#risks-tabs .synth-tab");
  const panels = document.querySelectorAll("#risks-content .synth-panel");
  if (!tabs.length) return;
  let known = false;
  tabs.forEach(t => { if (t.dataset.tab === name) known = true; });
  if (!known) name = tabs[0].dataset.tab;
  pertRisksTab = name;
  tabs.forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  panels.forEach(p => p.classList.toggle("active", p.dataset.panel === name));
  const c = document.getElementById("risks-content");
  if (c) c.scrollTop = 0;
}
window.pertSelectRisksTab = pertSelectRisksTab;

function pertBuildRisksTabs(nbRisques) {
  const bar = document.getElementById("risks-tabs");
  const c = document.getElementById("risks-content");
  const panels = {};
  if (!bar || !c) return panels;
  bar.innerHTML = "";
  c.innerHTML = "";
  PERT_RISKS_TABS.forEach(t => {
    const b = synthEl("button", "synth-tab", t.label);
    b.type = "button";
    b.dataset.tab = t.id;
    b.setAttribute("role", "tab");
    if (t.id === "risques" && nbRisques) {
      b.appendChild(synthEl("span", "synth-tab-badge", String(nbRisques)));
    }
    b.addEventListener("click", () => pertSelectRisksTab(t.id));
    bar.appendChild(b);
    const p = synthEl("div", "synth-panel");
    p.dataset.panel = t.id;
    p.appendChild(synthEl("h3", "synth-chapter", t.chapter));
    c.appendChild(p);
    panels[t.id] = p;
  });
  return panels;
}

function pertRenderRisks() {
  const c = document.getElementById("risks-content");
  if (!c) return;
  const u = (window.pertMeta && window.pertMeta.unit) || "j";
  const risks = pertRiskNodes().slice().sort((a, b) => {
    const da = pertRiskStart(a), db = pertRiskStart(b);
    if (da !== db) return da - db;
    return String(a.properties.label || "").localeCompare(String(b.properties.label || ""), "fr");
  });
  const panels = pertBuildRisksTabs(risks.length);
  const pRisques = panels.risques || c;
  const pTaches = panels.taches || c;

  if (!risks.length) {
    synthSection(pRisques, "Aucun risque", null,
      "Ce planning ne porte encore aucun risque. « ➕ Insérer ▾ → ⚠ Risque » en crée un ; "
      + "il couvre ensuite les tâches sur lesquelles il pèse.");
    synthSection(pTaches, "Aucune tâche exposée", null, "Aucun risque n'est défini.");
    pertSelectRisksTab(pertRisksTab);
    return;
  }

  // ── Onglet « Par risque » ─────────────────────────────────────────────────────
  const exposees = new Set();
  risks.forEach(r => pertRiskCoveredNodes(r).forEach(n => exposees.add(n.properties.uid)));
  const nbAct = (window.pertGraph && window.pertGraph._nodes || [])
    .filter(n => n.type === "pert/activity").length;

  const ov = synthEl("div", "synth-overview");
  synthKV(ov, "Risques", String(risks.length));
  synthKV(ov, "Tâches exposées", exposees.size + " sur " + nbAct);
  synthSection(pRisques, "Vue d'ensemble", ov);

  risks.forEach(r => {
    const covered = pertRiskCoveredNodes(r);
    const entete = synthEl("div", "synth-overview");
    synthKV(entete, "Période", pertRiskPeriodLabel(r));
    synthKV(entete, "Durée exposée",
      pertFormatSlack(pertRiskDuration(r)).replace("+", "") + " " + u);
    synthKV(entete, "Tâches couvertes", String(covered.length));
    if (covered.length) synthKV(entete, "Coût couvert", pertFormatCost(pertRiskExposure(r)));
    const bloc = synthEl("div");
    bloc.appendChild(entete);
    if (covered.length) {
      bloc.appendChild(synthTable([
        { text: "Tâche" }, { text: "Groupe" }, { text: "Début t.tôt" },
        { text: "Fin t.tard" }, { text: "Marge", cls: "num" }, { text: "Avancement" }
      ], covered.map(n => ({ cells: [
        { text: n.properties.label || "(sans nom)", nodeId: n.id },
        { text: (n.properties.group || "").trim() || "—" },
        { text: pertOffsetLabel(n.es) },
        { text: pertOffsetLabel(n.lf) },
        synthMarginCell(n.slack, u),
        { text: pertProgressDef(n.properties.progress).label }
      ] }))));
    } else {
      bloc.appendChild(synthEl("div", "synth-empty",
        "Aucune tâche couverte : la fin est calée sur celle du projet."));
    }
    synthSection(pRisques, (r.properties.label || "(sans nom)"), bloc);
  });

  // ── Onglet « Par tâche » ──────────────────────────────────────────────────────
  const parTache = [];
  (window.pertGraph && window.pertGraph._nodes || []).forEach(n => {
    if (n.type !== "pert/activity" || !n.properties) return;
    const porteurs = risks.filter(r => (r.properties.covers || []).indexOf(n.properties.uid) !== -1);
    if (porteurs.length) parTache.push({ node: n, risques: porteurs });
  });
  // Le plus expose d'abord : c'est le classement qu'on vient chercher.
  parTache.sort((a, b) => {
    if (b.risques.length !== a.risques.length) return b.risques.length - a.risques.length;
    const da = a.node.es == null ? Infinity : a.node.es;
    const db = b.node.es == null ? Infinity : b.node.es;
    return da - db;
  });

  if (!parTache.length) {
    synthSection(pTaches, "Aucune tâche exposée", null,
      "Aucun risque ne couvre encore de tâche : leurs fins sont toutes calées sur la "
      + "fin du projet. Rattachez les tâches concernées pour resserrer les périodes.");
    pertSelectRisksTab(pertRisksTab);
    return;
  }
  synthSection(pTaches, "Tâches sous risque", synthTable([
    { text: "Tâche" }, { text: "Groupe" }, { text: "Risques", cls: "num" },
    { text: "Lesquels" }, { text: "Marge", cls: "num" }
  ], parTache.map(e => ({ cells: [
    { text: e.node.properties.label || "(sans nom)", nodeId: e.node.id },
    { text: (e.node.properties.group || "").trim() || "—" },
    { text: String(e.risques.length), cls: "num" },
    { text: e.risques.map(r => r.properties.label || "(sans nom)").join(", ") },
    synthMarginCell(e.node.slack, u)
  ] }))));

  pertSelectRisksTab(pertRisksTab);
}
window.pertRenderRisks = pertRenderRisks;

function pertOpenRisksDialog() {
  pertRenderRisks();
  const d = document.getElementById("risks-dialog");
  if (d) d.style.display = "flex";
}
window.pertOpenRisksDialog = pertOpenRisksDialog;

function pertCloseRisksDialog() {
  const d = document.getElementById("risks-dialog");
  if (d) d.style.display = "none";
}
window.pertCloseRisksDialog = pertCloseRisksDialog;

function pertPrintRisks() { pertPrintDialog("risks-dialog"); }
window.pertPrintRisks = pertPrintRisks;
