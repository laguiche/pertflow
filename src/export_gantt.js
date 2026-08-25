// ─── Export Gantt chargé (Excel) & MS Project (MSPDI XML) — Session 9 ────────────
//
// Les deux exports partagent le meme MODELE D'ORDONNANCEMENT (pertScheduleModel) :
// activites triees par groupe puis date de debut, jalons classes entree/sortie,
// nombre de colonnes de periodes (selon meta.unit), liens de dependance. Le Gantt
// Excel en fait un diagramme de charge colore ; le MSPDI en fait un projet importable.
//
// Gantt chargé (cf. gantt_charge.xlsx) :
//   - Colonnes A/B/C/D = Tache / Groupe / Responsable / Avancement, puis 1 colonne
//     PAR PERIODE (unite du projet) de T0 a la fin de projet (en-tete = date, gras).
//   - Sections en colonne A : « Jalons d'entree », « Taches », « Jalons de sortie »,
//     « total charge » (SUM par colonne).
//   - Cellule periode d'une Activite = son ETP, sur chaque periode active [es, ef),
//     remplie a la couleur du groupe (barre de Gantt). Jalon = 0 dans sa colonne.
//   - Granularite = meta.unit (garde-fou PERT_GANTT_MAX_COLS colonnes).
//
// Contrainte file:// : mini-writer XLSX maison (export_xlsx.js, fflate), pas de fetch.

const PERT_GANTT_MAX_COLS = 400;  // garde-fou : au-dela, on tronque + avertit

// Index (0-based) de la PREMIERE colonne de periode, c'est-a-dire le nombre de
// colonnes d'en-tete a gauche : Tache / Groupe / Responsable / Avancement. Constante
// plutot que litteral, parce qu'elle est lue a quatre endroits (lignes de jalon,
// lignes d'activite, formules de total, largeurs de colonnes) : ajouter une colonne
// d'en-tete en oubliant l'un d'eux decalerait les barres de Gantt sans rien casser
// de visible a la generation.
const PERT_GANTT_FIRST_PERIOD_COL = 4;

// Couleur de remplissage d'une Activite : couleur memorisee du groupe, sinon couleur
// individuelle du nœud, sinon bleu par defaut.
function pertGanttColor(act) {
  const groups = (window.pertMeta && window.pertMeta.groups) || {};
  const g = (act.properties.group || "").trim();
  return (g && groups[g]) || act.properties.color || "#4A90D9";
}

// ETP d'une Activite (0 accepte ; defaut 1 si non renseigne / invalide).
// Passe par pertActivityEtp : une tache dont la charge est saisie en HEURES n'a pas
// d'ETP stocke, il se deduit de l'elongation (cf. « Mode de charge », pert_engine.js).
// pertActivityEtp rend null quand la duree est nulle : la tache n'occupe alors aucune
// colonne de periode dans le Gantt, la valeur n'est jamais ecrite — on retombe sur 0
// plutot que sur 1, qui gonflerait la ligne « total charge » si elle l'etait un jour.
function pertGanttEtp(act) {
  if (pertChargeMode(act) === "heures") {
    const v = pertActivityEtp(act);
    return (v === null || isNaN(v)) ? 0 : v;
  }
  const raw = act.properties.etp;
  if (raw === "" || raw == null) return 1;
  const v = parseFloat(raw);
  return isNaN(v) ? 1 : v;
}

// Construit le modele d'ordonnancement commun (Gantt + MSPDI). Recalcule d'abord
// pour garantir des es/ef a jour. Renvoie null si rien a exporter / T0 absent.
function pertScheduleModel() {
  const graph = window.pertGraph;
  if (!graph || !graph._nodes) return null;
  if (!window.pertMeta || !window.pertMeta.t0) return { error: "no_t0" };
  if (window.pertRecalc) pertRecalc();

  const { nodes, preds, succs } = pertBuildAdjacency(graph);
  if (!nodes.length) return null;

  const acts = nodes.filter(n => n.type === "pert/activity");
  const entryMs = [], exitMs = [];
  nodes.filter(n => n.type === "pert/milestone").forEach(m => {
    // Jalon d'entree = aucune arete entrante + au moins une sortante (contrainte
    // externe qui amorce une chaine) ; tout le reste = jalon de sortie/checkpoint.
    if (preds[m.id].length === 0 && succs[m.id].length >= 1) entryMs.push(m);
    else exitMs.push(m);
  });

  // Offset d'affichage d'un jalon = sa date-cible si renseignee (ou l'on veut le voir
  // sur l'echeance), sinon son EF calcule. (Ex. un jalon de sortie avec due_date se
  // place a la cible, pas a l'EF de son predecesseur.)
  const msOffset = (m) => {
    // Cible saisie en date OU en T0+X : dans les deux cas on ne manipule que l'offset.
    const o = pertMilestoneDueOffset(m);
    if (o != null) return o;
    return m.ef != null ? m.ef : 0;
  };

  // Tri : groupes ordonnes par leur ES le plus precoce (sans-groupe en dernier), puis
  // activites par ES au sein du groupe. Coherent avec la logique de layout S7.
  const groupMinEs = {};
  acts.forEach(a => {
    const g = (a.properties.group || "").trim();
    const es = a.es == null ? Infinity : a.es;
    if (!(g in groupMinEs) || es < groupMinEs[g]) groupMinEs[g] = es;
  });
  const grank = (g) => g ? (groupMinEs[g] != null ? groupMinEs[g] : Infinity) : Infinity;
  acts.sort((a, b) => {
    const ga = (a.properties.group || "").trim(), gb = (b.properties.group || "").trim();
    const ra = grank(ga), rb = grank(gb);
    if (ra !== rb) return ra - rb;
    if (ga !== gb) return ga.localeCompare(gb, "fr"); // meme rang → alphabetique
    return (a.es || 0) - (b.es || 0);
  });
  const byDate = (a, b) => msOffset(a) - msOffset(b);
  entryMs.sort(byDate);
  exitMs.sort(byDate);

  // Bornes de la grille de periodes : elle couvre la derniere periode active des
  // activites ET la colonne (date d'affichage) des jalons.
  // firstCol = periode de la PREMIERE colonne. Elle vaut 0 (= T0) sur un planning
  // classique, mais devient NEGATIVE des qu'il y a des travaux ANTICIPES : sans cela
  // les taches situees avant T0 tombaient hors grille et disparaissaient purement et
  // simplement du Gantt exporte.
  let maxCol = 0, minCol = 0;
  acts.forEach(a => {
    if (a.ef != null) maxCol = Math.max(maxCol, Math.ceil(a.ef) - 1);
    if (a.es != null) minCol = Math.min(minCol, Math.floor(a.es));
  });
  entryMs.concat(exitMs).forEach(m => {
    const o = msOffset(m);
    maxCol = Math.max(maxCol, Math.round(o));
    minCol = Math.min(minCol, Math.floor(o));
  });
  const firstCol = minCol;
  let numCols = Math.max(1, maxCol - firstCol + 1);
  let truncated = false;
  if (numCols > PERT_GANTT_MAX_COLS) { numCols = PERT_GANTT_MAX_COLS; truncated = true; }

  // Liens de dependance (pour le MSPDI).
  const ids = new Set(nodes.map(n => n.id));
  const links = [];
  for (const lid in graph.links) {
    const l = graph.links[lid];
    if (l && ids.has(l.origin_id) && ids.has(l.target_id)) links.push({ from: l.origin_id, to: l.target_id });
  }

  const unit = (window.pertMeta && window.pertMeta.unit) || "j";
  return {
    unit,
    dateFmt: unit === "mois" ? "date-mmm-yy" : "date-d-mmm-yy",
    acts, entryMs, exitMs, numCols, firstCol, truncated, links, msOffset,
    // Une Activite occupe la PERIODE i (offset absolu depuis T0, negatif possible)
    // si elle chevauche [i, i+1).
    activeAt: (a, i) => a.es != null && a.ef != null && a.es < i + 1 && a.ef > i,
    // Colonne (0-based dans la grille) d'un jalon = periode de sa date d'affichage,
    // ramenee a l'origine de la grille (firstCol).
    msCol: (m) => Math.min(numCols - 1, Math.max(0, Math.round(msOffset(m)) - firstCol)),
  };
}

// ── Gantt chargé → classeur XLSX ────────────────────────────────────────────────
function pertBuildGanttXlsx(model) {
  const nCols = model.numCols;
  const HEAD = { bold: true };
  const HEAD_DATE = { bold: true, fmt: model.dateFmt };

  // Origine de la grille : 0 (= T0) en l'absence d'anticipation, negative sinon.
  const first = model.firstCol || 0;

  const P0 = PERT_GANTT_FIRST_PERIOD_COL;

  // En-tete : Tache / Groupe / Responsable / Avancement + une date par periode.
  const header = [pertXlsxText("Tâche", HEAD), pertXlsxText("Groupe", HEAD),
                  pertXlsxText("Responsable", HEAD), pertXlsxText("Avancement", HEAD)];
  for (let i = 0; i < nCols; i++) header.push(pertXlsxDate(pertOffsetToDate(first + i), HEAD_DATE));

  const rows = [header];
  const sectionRow = (label) => { rows.push([pertXlsxText(label, HEAD)]); };

  // Ligne d'un jalon : libelle + un 0 dans la colonne de sa date. Pas d'avancement :
  // un jalon est une echeance, il est atteint ou non — il ne « s'avance » pas.
  const milestoneRow = (m) => {
    const row = [pertXlsxText(m.properties.label || "")];
    const c = model.msCol(m);
    row[P0 + c] = pertXlsxNum(0, { fmt: "num2" });
    rows.push(row);
  };

  // Ligne d'une activite : libelle/groupe/resp/avancement + ETP colore sur ses
  // periodes actives.
  const activityRow = (a) => {
    const row = [
      pertXlsxText(a.properties.label || ""),
      pertXlsxText(a.properties.group || ""),
      pertXlsxText(a.properties.responsible || ""),
      pertXlsxText(window.pertProgressDef ? pertProgressDef(a.properties.progress).label : ""),
    ];
    const etp = pertGanttEtp(a);
    const fill = pertGanttColor(a);
    for (let i = 0; i < nCols; i++) {
      if (model.activeAt(a, first + i)) row[P0 + i] = pertXlsxNum(etp, { fmt: "num2", fill });
    }
    rows.push(row);
  };

  sectionRow("Jalons d'entrée");
  model.entryMs.forEach(milestoneRow);
  sectionRow("Tâches");
  model.acts.forEach(activityRow);
  sectionRow("Jalons de sortie");
  model.exitMs.forEach(milestoneRow);

  // Ligne « total charge » : SUM par colonne de periode, de la 1re ligne de section
  // (row 2, 1-based) a la derniere ligne de donnees (avant le total).
  const firstDataRow = 2;
  const lastDataRow = rows.length; // rows.length lignes deja posees (header=row1)
  const totalRow = [pertXlsxText("total charge", HEAD)];
  for (let i = 0; i < nCols; i++) {
    const col = pertXlsxColLetter(P0 + i);
    totalRow[P0 + i] = pertXlsxFormula(`SUM(${col}${firstDataRow}:${col}${lastDataRow})`, { fmt: "num2", bold: true });
  }
  rows.push(totalRow);

  // Largeurs de colonnes : libelles larges, periodes etroites.
  const cols = [{ width: 22 }, { width: 12 }, { width: 14 }, { width: 14 }];
  for (let i = 0; i < nCols; i++) cols.push({ width: 8 });

  return pertXlsxBuild([{ name: "Gantt chargé", cols, rows }]);
}

function pertExportGanttExcel() {
  const model = pertScheduleModel();
  if (!model) { showToast("Rien a exporter (planning vide)"); return; }
  if (model.error === "no_t0") { showToast("Definissez d'abord la date T0 (Parametres)"); return; }
  if (model.truncated) {
    showToast("Gantt tronque a " + PERT_GANTT_MAX_COLS + " colonnes (projet tres long)", true);
  }
  const u8 = pertBuildGanttXlsx(model);
  const name = (window.pertProjectFilename ? pertProjectFilename() : "pertflow") + "_gantt.xlsx";
  pertDownloadBlob(u8, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  showToast("Export Gantt Excel : " + name);
}

window.pertScheduleModel = pertScheduleModel;
window.pertBuildGanttXlsx = pertBuildGanttXlsx;
window.pertExportGanttExcel = pertExportGanttExcel;

// ── Gantt MS Project (MSPDI XML) ────────────────────────────────────────────────
//
// MSPDI = « Microsoft Project Data Interchange », le format XML documente que MS
// Project importe/exporte nativement. On l'ecrit A LA MAIN (aucune lib .mpp native
// n'existe cote navigateur en MIT/offline). Meme modele que le Gantt chargé + les
// LIENS de dependance (PredecessorLink). Duree/charge en heures : on reutilise
// pertDurationToHours (coherent avec l'estimation de cout et le calendrier standard
// 8 h/j de MS Project). Les activites sont auto-planifiees a partir de Start + Duration ;
// on fournit aussi Finish pour information.
//
// PIEGE CENTRAL, a l'origine de deux anomalies remontees par les utilisateurs
// (25/08/2026) : MS Project ne se contente PAS de relire le <Start> qu'on lui donne,
// il REPLANIFIE a l'import. Une tache auto-planifiee est par defaut « des que
// possible » ; le <Start> d'une tache sans predecesseur est donc ecrase par le debut
// du projet -- c'est ainsi que les jalons d'ENTREE se retrouvaient empiles sur T0
// alors que le XML portait bien leur date-cible. Deux consequences durables :
//   - une date de debut ne « tient » que si elle est accompagnee d'une CONTRAINTE
//     (ConstraintType/ConstraintDate) -- cf. `pinned` dans pertBuildMSPDI ;
//   - inversement, sur une tache qui a des predecesseurs, le <Start> ecrit est de
//     toute facon recalcule : y placer la date-cible d'un jalon de sortie n'avait
//     aucun effet visible. La cible d'un jalon de sortie est une ECHEANCE, elle se
//     declare dans <Deadline> (repere d'echeance + alerte de depassement cote MS
//     Project), ce qui reproduit exactement la « tenue de cible » de PertFlow.
//
// Ce que MSPDI ne sait PAS transporter : la mise en forme du diagramme. Le format
// decrit un projet (taches, dates, liens, charges), jamais l'apparence de ses barres --
// celle-ci vit dans les « styles des barres », propres au fichier .mpp. La couleur de
// groupe part donc dans des CHAMPS PERSONNALISES (ExtendedAttribute), a partir
// desquels l'utilisateur cree un style de barre en deux clics (cf. manuel, section 11).

// Identifiants MSPDI standards des champs personnalises Texte1 / Texte2 des taches.
const PERT_MSP_FIELD_GROUP = 188743731;  // Texte1 → nom du groupe
const PERT_MSP_FIELD_COLOR = 188743734;  // Texte2 → couleur de groupe, en #RRGGBB

// Types de contrainte MSPDI utilises. 0 = « Des que possible » (defaut : MS Project
// deduit la date de l'amont), 4 = « Debut au plus tot » (epingle la date fournie).
const PERT_MSP_CONSTRAINT_ASAP = 0;
const PERT_MSP_CONSTRAINT_SNET = 4;

function pertMspXmlEsc(s) {
  return String(s == null ? "" : s)
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Offset (unites) → horodatage ISO "YYYY-MM-DDTHH:MM:SS" (heure ouvree par defaut).
function pertMspDate(offset, hour) {
  const d = pertOffsetToDate(offset);
  if (!d) return "";
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
    + "T" + p(hour == null ? 8 : hour) + ":00:00";
}

// Nombre d'heures → duree MSPDI "PT<h>H0M0S".
function pertMspHours(h) { return "PT" + Math.max(0, Math.round(h)) + "H0M0S"; }

function pertBuildMSPDI(model) {
  const meta = window.pertMeta || {};
  const title = meta.title || "PertFlow";

  // Ordre d'affichage = jalons d'entree, activites, jalons de sortie (comme le Gantt).
  const ordered = model.entryMs.concat(model.acts, model.exitMs);
  const uidOf = new Map();
  ordered.forEach((n, i) => uidOf.set(n.id, i + 1));

  // Predecesseurs par nœud (id cible → [uid sources]) depuis les liens du modele.
  const predsByTarget = {};
  model.links.forEach(l => {
    if (!uidOf.has(l.from)) return;   // n'ouvrir l'entree que pour un vrai predecesseur :
    if (!predsByTarget[l.to]) predsByTarget[l.to] = [];  // hasPreds() en depend
    predsByTarget[l.to].push(uidOf.get(l.from));
  });
  // Une tache a-t-elle un amont ? Determine a la fois sa date de debut (deduite ou
  // epinglee) et le sens de sa date-cible (donnee d'entree ou echeance a tenir).
  const hasPreds = (n) => (predsByTarget[n.id] || []).length > 0;

  const tasksXml = ordered.map((n, i) => {
    const uid = i + 1;
    const isAct = n.type === "pert/activity";
    const durH = isAct ? pertDurationToHours(pertDuration(n), model.unit, meta) : 0;
    // Work MSPDI = charge en heures homme. On la prend a la source (pertActivityHours)
    // plutot que de refaire duree × ETP : une charge saisie en heures sur une tache de
    // duree nulle existe quand meme, et le produit la perdrait.
    const workH = isAct ? pertActivityHours(n) : 0;
    // Un jalon (ou une activite de duree nulle) est un Milestone.
    const isMilestone = !isAct || durH <= 0;

    // Date de debut ECRITE dans le fichier. Pour un jalon : son EF calcule des lors
    // qu'il a un amont (MS Project le recalculerait de toute facon), sa date-cible
    // sinon -- c'est le cas du jalon d'ENTREE, dont la cible EST la date de debut de
    // la chaine (bug n°1). model.msOffset retombe sur l'EF en l'absence de cible.
    const startOff = isAct ? n.es : (hasPreds(n) ? n.ef : model.msOffset(n));
    const finishOff = isAct ? n.ef : startOff;

    // Epinglage (cf. PIEGE CENTRAL en tete de chapitre) : sans contrainte, MS Project
    // ramene au debut du projet toute tache dont l'amont ne dicte pas la date. Deux
    // familles sont concernees -- les taches sans predecesseur (jalons d'entree en
    // premier lieu), et les taches ANTICIPEES, que PertFlow planifie au plus tard
    // alors que MS Project les collerait au plus tot derriere leur predecesseur.
    const pinned = !hasPreds(n) || (isAct && n.properties.anticipated === true);

    // Cible d'un jalon de SORTIE → <Deadline> (bug n°2) : MS Project trace le repere
    // d'echeance et signale le depassement, ce qui reproduit la « tenue de cible » de
    // PertFlow. Volontairement AUCUNE deadline sur un jalon d'entree : sa cible est
    // une donnee d'entree, pas une echeance a tenir -- elle ne borne meme pas son LF
    // dans le moteur (cf. pert_engine.js). La saisie en date ou en « T0+X » est
    // indifferente ici : pertMilestoneDueOffset rend un offset, converti en date
    // calendaire comme n'importe quelle autre.
    const deadlineOff = (!isAct && hasPreds(n)) ? pertMilestoneDueOffset(n) : null;

    let x = "<Task>";
    x += "<UID>" + uid + "</UID>";
    x += "<ID>" + uid + "</ID>";
    x += "<Name>" + pertMspXmlEsc(n.properties.label || "") + "</Name>";
    x += "<Active>1</Active>";
    x += "<Manual>0</Manual>";
    x += "<Type>0</Type>";                 // 0 = duree fixe / unites fixes (auto-planifie)
    x += "<OutlineLevel>1</OutlineLevel>";
    x += "<Start>" + pertMspDate(startOff) + "</Start>";
    x += "<Finish>" + pertMspDate(finishOff, isMilestone ? 8 : 17) + "</Finish>";
    x += "<Duration>" + pertMspHours(durH) + "</Duration>";
    x += "<DurationFormat>7</DurationFormat>";  // 7 = jours (affichage)
    x += "<Milestone>" + (isMilestone ? 1 : 0) + "</Milestone>";
    x += "<Work>" + pertMspHours(workH) + "</Work>";
    x += "<ConstraintType>" + (pinned ? PERT_MSP_CONSTRAINT_SNET : PERT_MSP_CONSTRAINT_ASAP) + "</ConstraintType>";
    if (pinned) x += "<ConstraintDate>" + pertMspDate(startOff) + "</ConstraintDate>";
    // Echeance posee en FIN de journee : un jalon arrivant le jour meme (date ecrite
    // a 8 h) doit compter comme tenu, seul un debordement au jour suivant alerte.
    if (deadlineOff !== null) x += "<Deadline>" + pertMspDate(deadlineOff, 17) + "</Deadline>";
    (predsByTarget[n.id] || []).forEach(puid => {
      x += "<PredecessorLink><PredecessorUID>" + puid + "</PredecessorUID><Type>1</Type></PredecessorLink>";
    });
    // Champs personnalises : seules les Activites portent un groupe et une couleur.
    if (isAct) {
      const grp = (n.properties.group || "").trim();
      if (grp) x += "<ExtendedAttribute><FieldID>" + PERT_MSP_FIELD_GROUP + "</FieldID>"
                 + "<Value>" + pertMspXmlEsc(grp) + "</Value></ExtendedAttribute>";
      x += "<ExtendedAttribute><FieldID>" + PERT_MSP_FIELD_COLOR + "</FieldID>"
         + "<Value>" + pertMspXmlEsc(pertGanttColor(n)) + "</Value></ExtendedAttribute>";
    }
    x += "</Task>";
    return x;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Project xmlns="http://schemas.microsoft.com/project">`
    + `<Name>` + pertMspXmlEsc(title) + `</Name>`
    + `<Title>` + pertMspXmlEsc(title) + `</Title>`
    + `<ScheduleFromStart>1</ScheduleFromStart>`
    // Debut de projet MS Project = T0, ou la premiere periode de la grille lorsque des
    // travaux sont ANTICIPES : declarer T0 alors que des taches demarrent avant rendrait
    // le fichier incoherent a l'import (taches anterieures au debut du projet).
    + `<StartDate>` + pertMspDate(Math.min(0, model.firstCol || 0)) + `</StartDate>`
    // Declaration des champs personnalises. Elle DOIT preceder <Tasks> : comme pour
    // OOXML, l'ordre des elements est impose par le schema MSPDI.
    + `<ExtendedAttributes>`
    +   `<ExtendedAttribute><FieldID>${PERT_MSP_FIELD_GROUP}</FieldID>`
    +     `<FieldName>Text1</FieldName><Alias>Groupe</Alias></ExtendedAttribute>`
    +   `<ExtendedAttribute><FieldID>${PERT_MSP_FIELD_COLOR}</FieldID>`
    +     `<FieldName>Text2</FieldName><Alias>Couleur PertFlow</Alias></ExtendedAttribute>`
    + `</ExtendedAttributes>`
    + `<Tasks>` + tasksXml + `</Tasks>`
    + `</Project>`;
}

function pertExportMSProject() {
  const model = pertScheduleModel();
  if (!model) { showToast("Rien a exporter (planning vide)"); return; }
  if (model.error === "no_t0") { showToast("Definissez d'abord la date T0 (Parametres)"); return; }
  const xml = pertBuildMSPDI(model);
  const name = (window.pertProjectFilename ? pertProjectFilename() : "pertflow") + "_msproject.xml";
  pertDownloadBlob(xml, name, "application/xml");
  showToast("Export MS Project : " + name);
}

window.pertBuildMSPDI = pertBuildMSPDI;
window.pertExportMSProject = pertExportMSProject;

// Enregistrement dans la fenetre d'export (S9).
if (window.pertRegisterExportFormat) {
  pertRegisterExportFormat({
    id: "gantt-xlsx", icon: "📊", label: "Gantt chargé (Excel)", order: 40,
    desc: "Diagramme de charge (ETP par période, coloré par groupe), formules de total.",
    run: () => pertExportGanttExcel(),
  });
  pertRegisterExportFormat({
    id: "msproject", icon: "🗓", label: "Gantt MS Project (XML)", order: 60,
    desc: "Fichier MSPDI importable dans MS Project (tâches, jalons, charge, liens, échéances).",
    run: () => pertExportMSProject(),
  });
}
