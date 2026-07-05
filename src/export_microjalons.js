// ─── Export Micro-jalonnement (Excel) — Session 9 ───────────────────────────────
//
// Reproduit la STRUCTURE LOGIQUE du template de suivi de l'utilisateur
// (cf. microjalons.xlsx) : une ligne par nœud (jalons + activites, chaque activite
// devenant un micro-jalon « tache terminee »). Seules les colonnes derivables du
// planning sont remplies ; les colonnes de suivi (Statut, Replan, Ecart, Filtres…)
// restent vides, a completer par l'utilisateur (on ne recree PAS les listes
// deroulantes / liens externes du fichier d'origine — « fidelite minimale »).
//
// Colonnes (dans l'ordre du template) :
//   Num | Jalon | Destinataire | Resp. | LOT | Date baseline | Date prévue Actuelle |
//   Replan proposée | dates Replan | Statut | Date réalisée | Ecart ... (j) |
//   Jalon Majeur | Commentaires | Filtre1 | Filtre2 | Filtre3 |
//   Filtre pour jalons majeurs | LIBELLE JALON MAJEUR
//
// Regles de remplissage :
//   - Num : compteur par LOT (groupe) « <groupe>_NN » pour les ACTIVITES ; vide pour
//     les jalons. Ordre = meme tri que le Gantt (groupe par ES precoce, puis ES).
//   - Resp./LOT : responsable / groupe (activites).
//   - Date baseline : date-cible (due_date) si presente, sinon EF (date planifiee).
//   - Date prévue Actuelle : EF calcule (prevision courante). Diverge de la baseline
//     quand une date-cible de jalon n'est pas exactement tenue.
//   - Jalon Majeur : GOLDEN si tag DOTD/COTD, SILVER si tag Ingenierie ; sinon vide.
//   - LIBELLE JALON MAJEUR : recopie du libelle pour un jalon majeur.
//   - Commentaires : note libre de l'activite (properties.notes) si presente.
//
// Contrainte file:// : mini-writer XLSX maison (export_xlsx.js, fflate), pas de fetch.

const PERT_MJ_HEADERS = ["Num", "Jalon", "Destinataire", "Resp.", "LOT", "Date baseline",
  "Date prévue Actuelle", "Replan proposée", "dates Replan", "Statut", "Date réalisée",
  "Ecart entre réalisé et baseline (j)", "Jalon Majeur", "Commentaires", "Filtre1",
  "Filtre2", "Filtre3", "Filtre pour jalons majeurs", "LIBELLE JALON MAJEUR"];
const PERT_MJ_COL = { NUM: 0, JALON: 1, DEST: 2, RESP: 3, LOT: 4, BASELINE: 5, PREVUE: 6,
  MAJEUR: 12, COMMENT: 13, LIBELLE_MAJEUR: 18 };

// Niveau « jalon majeur » a partir du tag du jalon (GOLDEN / SILVER / "").
function pertMjMajorLevel(m) {
  const t = (m.properties && m.properties.tag) || "";
  if (t === "DOTD" || t === "COTD") return "GOLDEN";
  if (t === "ING") return "SILVER";
  return "";
}

function pertBuildMicroJalonsXlsx(model) {
  const DATE = { fmt: "date-d-mmm-yy" };
  const HEAD = { bold: true, fill: "#CCFFCC" };

  // En-tete.
  const rows = [PERT_MJ_HEADERS.map(h => pertXlsxText(h, HEAD))];

  // Numeros de micro-jalon par LOT (groupe), dans l'ordre de tri des activites.
  const counters = {};
  const numOf = new Map();
  model.acts.forEach(a => {
    const g = (a.properties.group || "").trim() || "SG";
    counters[g] = (counters[g] || 0) + 1;
    numOf.set(a, g + "_" + String(counters[g]).padStart(2, "0"));
  });

  // Offsets baseline / prevue.
  const baselineOffset = (n) => (n.type === "pert/milestone") ? model.msOffset(n) : n.ef;
  const dateCell = (offset) => {
    if (offset == null) return null;
    const d = pertOffsetToDate(offset);
    return d ? pertXlsxDate(d, DATE) : null;
  };

  const pushRow = (n) => {
    const isAct = n.type === "pert/activity";
    const row = [];
    row[PERT_MJ_COL.JALON] = pertXlsxText(n.properties.label || "");
    if (isAct) {
      row[PERT_MJ_COL.NUM] = pertXlsxText(numOf.get(n) || "");
      if (n.properties.responsible) row[PERT_MJ_COL.RESP] = pertXlsxText(n.properties.responsible);
      if (n.properties.group) row[PERT_MJ_COL.LOT] = pertXlsxText(n.properties.group);
      if (n.properties.notes) row[PERT_MJ_COL.COMMENT] = pertXlsxText(n.properties.notes);
    } else {
      const lvl = pertMjMajorLevel(n);
      if (lvl) {
        row[PERT_MJ_COL.MAJEUR] = pertXlsxText(lvl);
        row[PERT_MJ_COL.LIBELLE_MAJEUR] = pertXlsxText(n.properties.label || "");
      }
    }
    row[PERT_MJ_COL.BASELINE] = dateCell(baselineOffset(n));
    row[PERT_MJ_COL.PREVUE] = dateCell(n.ef);
    rows.push(row);
  };

  // Ordre : jalons d'entree, activites (groupees), jalons de sortie — comme le Gantt.
  model.entryMs.forEach(pushRow);
  model.acts.forEach(pushRow);
  model.exitMs.forEach(pushRow);

  const cols = [{ width: 10 }, { width: 24 }, { width: 12 }, { width: 10 }, { width: 8 },
    { width: 13 }, { width: 15 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 12 },
    { width: 16 }, { width: 12 }, { width: 20 }, { width: 8 }, { width: 8 }, { width: 8 },
    { width: 16 }, { width: 20 }];

  return pertXlsxBuild([{ name: "Micro-jalonnement", cols, rows }]);
}

function pertExportMicroJalons() {
  const model = pertScheduleModel();
  if (!model) { showToast("Rien a exporter (planning vide)"); return; }
  if (model.error === "no_t0") { showToast("Definissez d'abord la date T0 (Parametres)"); return; }
  const u8 = pertBuildMicroJalonsXlsx(model);
  const name = (window.pertProjectFilename ? pertProjectFilename() : "pertflow") + "_microjalons.xlsx";
  pertDownloadBlob(u8, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  showToast("Export micro-jalonnement : " + name);
}

window.pertBuildMicroJalonsXlsx = pertBuildMicroJalonsXlsx;
window.pertExportMicroJalons = pertExportMicroJalons;

// Enregistrement dans la fenetre d'export (S9).
if (window.pertRegisterExportFormat) {
  pertRegisterExportFormat({
    id: "microjalons", icon: "🎯", label: "Micro-jalonnement (Excel)", order: 50,
    desc: "Une ligne par jalon/tâche pour le suivi (jalons majeurs GOLDEN/SILVER).",
    run: () => pertExportMicroJalons(),
  });
}
