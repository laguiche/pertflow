// ─── Export CSV (« raw ») — Session 9 ───────────────────────────────────────────
//
// Dump brut du planning : une ligne par nœud PERT (Activite + Jalon ; les Labels,
// simple documentation sans donnee d'ordonnancement, sont exclus). Separateur « ; »
// (demande utilisateur), decimales en « , » (coherent Excel FR puisque le separateur
// de colonnes est « ; »), dates au format FR. Un BOM UTF-8 est prepose pour qu'Excel
// reconnaisse l'encodage et affiche correctement les accents.
//
// Colonnes (schema figé — detail S9 dans docs/historique-sessions.md) :
//   Type ; UID ; Libellé ; Groupe ; Responsable ; Durée ; Unité ; ETP ; Coût(k€) ;
//   DébutTôt ; FinTôt ; DébutTard ; FinTard ; Marge ; Critique ; DateCible ; TagJalon
//
// Les valeurs calculees (es/ef/ls/lf/slack/is_critical) sont lues sur l'objet nœud
// (posees par pertRecalc) ; les proprietes saisies sont dans node.properties.
// Contrainte file:// : telechargement via Blob + objet URL (pertDownloadBlob), aucun
// fetch, aucune dependance.

const PERT_CSV_SEP = ";";

// Libelle humain de l'unite courante.
function pertCsvUnitLabel() {
  const u = (window.pertMeta && window.pertMeta.unit) || "j";
  return u === "mois" ? "mois" : (u === "sem" ? "semaine" : "jour");
}

// Nombre → chaine FR (decimale « , »), ou "" si null/undefined/NaN.
function pertCsvNum(v) {
  if (v === null || v === undefined || (typeof v === "number" && isNaN(v))) return "";
  return String(v).replace(".", ",");
}

// Date calendaire depuis un offset en unites → "jj/mm/aa", ou "" si non calculee.
function pertCsvDateFromOffset(offset) {
  if (offset === null || offset === undefined) return "";
  const d = pertOffsetToDate(offset);
  return d ? pertFormatDate(d) : "";
}

// Echappement CSV : entoure de guillemets si le champ contient le separateur, un
// guillemet, ou un saut de ligne ; double les guillemets internes.
function pertCsvEscape(field) {
  const s = (field === null || field === undefined) ? "" : String(field);
  if (s.indexOf(PERT_CSV_SEP) !== -1 || s.indexOf('"') !== -1
      || s.indexOf("\n") !== -1 || s.indexOf("\r") !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Construit une ligne (tableau de champs) pour un nœud PERT.
function pertCsvRowForNode(node) {
  const p = node.properties || {};
  const isAct = node.type === "pert/activity";
  const unit = pertCsvUnitLabel();

  const type = isAct ? "Activité" : "Jalon";
  const uid = isAct ? (p.uid || "") : "";
  const label = p.label || "";
  const group = isAct ? (p.group || "") : "";
  const resp = isAct ? (p.responsible || "") : "";
  const duration = isAct ? pertCsvNum(pertDuration(node)) : "";
  const etp = isAct ? pertCsvNum(p.etp != null ? p.etp : "") : "";
  const cost = isAct ? pertCsvNum(Math.round(pertActivityCost(node) / 100) / 10) : ""; // k€, 1 decimale
  const es = pertCsvDateFromOffset(node.es);
  const ef = pertCsvDateFromOffset(node.ef);
  const ls = pertCsvDateFromOffset(node.ls);
  const lf = pertCsvDateFromOffset(node.lf);
  const slack = pertCsvNum(node.slack);
  const critical = node.is_critical ? "oui" : "non";
  // DateCible = date-cible d'un Jalon (due_date) ; vide pour une Activite.
  // Cible resolue en date calendaire, quel que soit son mode de saisie (date ou
  // T0+X) : le schema de colonnes du CSV est fige, il reste une date.
  const dueDate = (!isAct && pertMilestoneHasDue(node))
    ? pertFormatDate(pertOffsetToDate(pertMilestoneDueOffset(node))) : "";
  // TagJalon = libelle du tag (DOTD / COTD / Ingenierie) ; vide sinon.
  let tag = "";
  if (!isAct && window.pertMilestoneTag) {
    const t = pertMilestoneTag(p.tag);
    if (t) tag = t.label;
  }

  return [type, uid, label, group, resp, duration, unit, etp, cost,
          es, ef, ls, lf, slack, critical, dueDate, tag];
}

const PERT_CSV_HEADER = ["Type", "UID", "Libellé", "Groupe", "Responsable", "Durée",
  "Unité", "ETP", "Coût(k€)", "DébutTôt", "FinTôt", "DébutTard", "FinTard", "Marge",
  "Critique", "DateCible", "TagJalon"];

// Serialise l'ensemble du planning en texte CSV (avec BOM UTF-8).
function pertBuildCSV() {
  const graph = window.pertGraph;
  const nodes = (graph && graph._nodes ? graph._nodes : [])
    .filter(n => n.type === "pert/activity" || n.type === "pert/milestone");
  const lines = [];
  lines.push(PERT_CSV_HEADER.map(pertCsvEscape).join(PERT_CSV_SEP));
  for (const n of nodes) {
    lines.push(pertCsvRowForNode(n).map(pertCsvEscape).join(PERT_CSV_SEP));
  }
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM + CRLF (compatibilite Excel)
}

// Export CSV : serialise → telechargement.
function pertExportCSV() {
  const graph = window.pertGraph;
  const nodes = (graph && graph._nodes ? graph._nodes : [])
    .filter(n => n.type === "pert/activity" || n.type === "pert/milestone");
  if (!nodes.length) { showToast("Rien a exporter (planning vide)"); return; }
  const content = pertBuildCSV();
  const name = (window.pertProjectFilename ? pertProjectFilename() : "pertflow") + ".csv";
  pertDownloadBlob(content, name, "text/csv;charset=utf-8");
  showToast("Export CSV : " + name);
}

window.pertBuildCSV = pertBuildCSV;
window.pertExportCSV = pertExportCSV;

// Enregistrement dans la fenetre d'export unique (S9).
if (window.pertRegisterExportFormat) {
  pertRegisterExportFormat({
    id: "csv", icon: "📑", label: "Données CSV", order: 30,
    desc: "Tableau brut (séparateur « ; »), un nœud par ligne, pour Excel/tableur.",
    run: () => pertExportCSV(),
  });
}
