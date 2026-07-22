// ─── Fenetre d'import unique + socle commun aux formats — Lot 2 (refonte import) ──
//
// Symetrie avec la fenetre d'export (S9) : un seul bouton toolbar « Importer » ouvre
// une fenetre listant les formats disponibles. Chaque module d'import enregistre son
// descripteur { id, icon, label, desc, order, run } via pertRegisterImportFormat →
// l'ordre d'affichage ne depend PAS de l'ordre de chargement des <script>.
//
// Ce module heberge aussi les DEUX regles transverses aux formats (decisions du
// 08/07/2026, cf. docs/historique-sessions.md « Refonte de l'import ») :
//
//   1. T0 = min(T0 courant, T0 importe) + ANCRAGE. Le bloc dont le T0 d'origine est le
//      plus tardif recoit un jalon entrant date a ce T0, branche sur ses racines. On
//      reutilise ainsi la regle « jalon entrant » du moteur (aucun entrant + >=1 sortant
//      + due_date → ES = EF = offset(due_date)) plutot que d'etendre le modele de
//      donnees. Resultat : AUCUNE date absolue ne bouge a l'import.
//      Auparavant : `if (model.t0) window.pertMeta.t0 = model.t0;` → ecrasement pur.
//
//   2. L'unite du projet n'est JAMAIS ecrasee en silence. Si le fichier importe a une
//      unite differente ET que le projet n'est pas vide, l'utilisateur tranche :
//      ignorer l'unite du fichier / convertir les durees / annuler l'import.
//      Auparavant : `if (model.unit) window.pertMeta.unit = model.unit;` → toutes les
//      durees existantes etaient reinterpretees silencieusement (elles sont stockees en
//      unites, pas en jours).

// ─── Registre des formats ────────────────────────────────────────────────────────

const PERT_IMPORT_FORMATS = [];

// Enregistre (ou remplace, par id) un format d'import. Appele par ce module (Excel)
// et par src/import_pert.js a leur chargement.
function pertRegisterImportFormat(fmt) {
  const i = PERT_IMPORT_FORMATS.findIndex(f => f.id === fmt.id);
  if (i !== -1) PERT_IMPORT_FORMATS[i] = fmt;
  else PERT_IMPORT_FORMATS.push(fmt);
}

// Ouvre un <input type="file"> masque (re-selection du meme fichier autorisee).
function pertPickFile(inputId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.value = "";
  inp.click();
}

// CPERT — Excel legacy (#8). Le parsing vit dans src/import_excel.js, la couche DOM
// (FileReader → handleExcelFile) dans src/ui.js : ici on ne fait qu'ouvrir le selecteur.
pertRegisterImportFormat({
  id: "cpert", icon: "📊", label: "CPERT — Excel (.xlsm)", order: 10,
  desc: "Planning legacy C-PERT. Nœuds et liens lus dans les objets graphiques.",
  run: () => pertPickFile("excel-input")
});

// ─── Fenetre de choix du format ──────────────────────────────────────────────────

function pertBuildImportRow(fmt) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "import-format-row";
  const ic = document.createElement("span");
  ic.className = "import-format-icon";
  ic.textContent = fmt.icon;
  row.appendChild(ic);
  const txt = document.createElement("span");
  txt.className = "import-format-text";
  const t = document.createElement("span");
  t.className = "import-format-label";
  t.textContent = fmt.label;
  const d = document.createElement("span");
  d.className = "import-format-desc";
  d.textContent = fmt.desc;
  txt.appendChild(t);
  txt.appendChild(d);
  row.appendChild(txt);
  row.addEventListener("click", () => {
    pertCloseImportDialog();
    // guardUI : filet d'erreur (toast rouge) — indispensable en file:// (pas de console).
    if (window.guardUI) guardUI("Import « " + fmt.label + " » impossible", fmt.run);
    else fmt.run();
  });
  return row;
}

function pertOpenImportDialog() {
  const list = document.getElementById("import-format-list");
  const dlg = document.getElementById("import-dialog");
  if (!list || !dlg) return;
  list.innerHTML = "";
  PERT_IMPORT_FORMATS.slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .forEach(fmt => list.appendChild(pertBuildImportRow(fmt)));
  dlg.style.display = "flex";
}

function pertCloseImportDialog() {
  const dlg = document.getElementById("import-dialog");
  if (dlg) dlg.style.display = "none";
}

// ─── Conversion de durees entre unites ───────────────────────────────────────────
//
// Une DUREE n'a pas d'ancrage calendaire (contrairement a une date) : les mois
// calendaires reels de pertAddUnits y sont inapplicables. On passe donc par un pivot
// en JOURS OUVRES, coherent avec la semantique du moteur (« j » = jours ouvres,
// cf. lot 1) : semaine = 5 jours ouvres, mois = 261/12 ≈ 21,75 jours ouvres.
//
// ATTENTION : ne PAS deriver le mois de hours_per_month / hours_per_day (135/8 ≈ 16,9).
// Ces 135 h sont une CHARGE avec abattement conges/absences, pas un empan calendaire.
const PERT_UNIT_WORKDAYS = { j: 1, sem: 5, mois: 261 / 12 };

// Convertit une duree d'une unite vers une autre (arrondi a 2 decimales : la conversion
// est approximative par nature, inutile de trainer des flottants a 15 chiffres).
function pertConvertDuration(duration, fromUnit, toUnit) {
  const d = parseFloat(duration);
  if (isNaN(d)) return 0;
  if (fromUnit === toUnit) return d;
  const from = PERT_UNIT_WORKDAYS[fromUnit] || 1;
  const to = PERT_UNIT_WORKDAYS[toUnit] || 1;
  return Math.round((d * from / to) * 100) / 100;
}

// Libelle lisible d'une unite (dialogues et toasts).
function pertUnitLabel(u) {
  return u === "mois" ? "mois" : (u === "sem" ? "semaines" : "jours");
}

// ─── Resolution T0 / unite (commune a tous les formats) ──────────────────────────

// Le projet contient-il au moins un noeud PERT (Activite/Jalon) ? Un graphe ne
// contenant que des Labels est considere comme vide : rien a preserver.
function pertProjectHasNodes() {
  const g = window.pertGraph;
  if (!g || !g._nodes) return false;
  return g._nodes.some(n => n.type === "pert/activity" || n.type === "pert/milestone");
}

// Resout T0 et unite pour un import, puis appelle onResolved(plan) — ou rien du tout si
// l'utilisateur annule. Asynchrone : l'arbitrage d'unite passe par un dialogue.
//
// plan = {
//   unit,            // unite retenue pour le projet apres import
//   convertFrom,     // unite source si les durees importees doivent etre converties, sinon null
//   t0,              // T0 retenu pour le projet (le plus anterieur)
//   anchor           // { side: "imported"|"existing", date } ou null
// }
function pertResolveImportMeta(importedT0, importedUnit, onResolved) {
  const meta = window.pertMeta || {};
  const empty = !pertProjectHasNodes();

  // ── Unite ──────────────────────────────────────────────────────────────────────
  // Projet vide → on adopte l'unite du fichier (rien a reinterpreter).
  // Projet non vide et unite divergente → l'utilisateur tranche (jamais d'ecrasement
  // silencieux). Sinon, l'unite du projet reste en place.
  const unitDiverges = importedUnit && meta.unit && importedUnit !== meta.unit;

  const finish = (unit, convertFrom) => {
    onResolved(Object.assign({ unit, convertFrom }, pertResolveT0(importedT0, empty)));
  };

  if (empty) { finish(importedUnit || meta.unit, null); return; }
  if (!unitDiverges) { finish(meta.unit, null); return; }

  promptUnitConflict(importedUnit, meta.unit, (choice) => {
    if (choice === "cancel") return;                       // import abandonne
    finish(meta.unit, choice === "convert" ? importedUnit : null);
  });
}

// T0 : on retient le plus anterieur (une concatenation ne doit pas repousser un debut
// de projet), et on indique quel bloc doit etre ancre pour ne pas voir ses racines
// glisser vers ce nouveau T0 plus precoce.
function pertResolveT0(importedT0, projectEmpty) {
  const meta = window.pertMeta || {};
  const cur = meta.t0 || "";
  if (projectEmpty || !cur) return { t0: importedT0 || cur, anchor: null };
  if (!importedT0) return { t0: cur, anchor: null };
  if (importedT0 === cur) return { t0: cur, anchor: null };
  // Comparaison lexicographique valide : les deux dates sont en ISO "YYYY-MM-DD".
  if (importedT0 < cur) {
    // Le projet existant demarrait plus tard → c'est LUI qu'on ancre a son T0 d'origine.
    return { t0: importedT0, anchor: { side: "existing", date: cur } };
  }
  // Le bloc importe demarre plus tard → on l'ancre a son propre T0.
  return { t0: cur, anchor: { side: "imported", date: importedT0 } };
}

// ─── Ancrage d'un bloc par un jalon entrant date ─────────────────────────────────

// Racines d'un bloc : noeuds PERT sans aucun lien entrant.
function pertBlockRoots(nodes) {
  return nodes.filter(n => {
    if (n.type !== "pert/activity" && n.type !== "pert/milestone") return false;
    if (!n.inputs) return true;
    return !n.inputs.some(inp => inp.link != null);
  });
}

// Cree un jalon entrant date et le branche sur les racines de `nodes`, afin que le bloc
// conserve sa date de demarrage d'origine malgre un T0 projet devenu plus precoce.
//
// On NE branche PAS les racines qui sont deja des jalons entrants dates : les brancher
// leur ferait perdre leur statut de jalon entrant (un jalon avec predecesseur devient un
// checkpoint dont la due_date ne borne plus que le LF) → la contrainte serait detruite.
// Si toutes les racines sont deja ancrees ainsi, aucun jalon n'est cree (pas de doublon).
// Renvoie le jalon cree, ou null.
function pertAnchorRoots(nodes, dateISO, label) {
  const graph = window.pertGraph;
  if (!graph || !nodes || !nodes.length || !dateISO) return null;

  const roots = pertBlockRoots(nodes).filter(n =>
    !(n.type === "pert/milestone" && n.properties && n.properties.due_date));
  if (!roots.length) return null;   // bloc deja entierement ancre

  const anchor = LiteGraph.createNode("pert/milestone");
  anchor.properties.label = label || "Début";
  anchor.properties.due_date = dateISO;
  if (anchor.updateSize) anchor.updateSize();

  // Pose a gauche du bloc, centre verticalement sur ses racines.
  let minX = Infinity, sumY = 0;
  nodes.forEach(n => { minX = Math.min(minX, n.pos[0]); });
  roots.forEach(n => { sumY += n.pos[1]; });
  anchor.pos = [minX - anchor.size[0] - 80, Math.round(sumY / roots.length)];
  graph.add(anchor);

  roots.forEach(r => anchor.connect(0, r, freeInputSlot(r)));
  return anchor;
}

// ─── Dialogue d'arbitrage de l'unite ─────────────────────────────────────────────
//
// 3 issues (decision utilisateur du 08/07/2026) : ignorer l'unite du fichier /
// convertir les durees / annuler l'import. onChoose("ignore"|"convert"|"cancel").
function promptUnitConflict(importedUnit, projectUnit, onChoose) {
  let dlg = document.getElementById("unit-dialog");
  if (dlg) dlg.remove();
  dlg = document.createElement("div");
  dlg.id = "unit-dialog";
  dlg.className = "dialog-overlay";
  dlg.style.display = "flex";

  const box = document.createElement("div");
  box.className = "dialog";
  const h = document.createElement("h3");
  h.textContent = "Unité de durée différente";
  box.appendChild(h);

  const p = document.createElement("p");
  p.className = "dialog-note";
  p.innerHTML = "Le fichier importé est exprimé en <b>" + pertUnitLabel(importedUnit)
    + "</b>, le projet courant en <b>" + pertUnitLabel(projectUnit) + "</b>."
    + " L'unité du projet ne sera pas modifiée (elle réinterpréterait toutes les durées"
    + " existantes). Que faire des durées importées ?";
  box.appendChild(p);

  // Exemple concret de conversion (une duree de 1 dans l'unite du fichier).
  const ex = document.createElement("p");
  ex.className = "dialog-note";
  ex.textContent = "Conversion : 1 " + pertUnitLabel(importedUnit) + " → "
    + pertConvertDuration(1, importedUnit, projectUnit) + " " + pertUnitLabel(projectUnit)
    + " (pivot en jours ouvrés : semaine = 5 j, mois ≈ 21,75 j). Les dates-cibles des"
    + " jalons sont absolues : elles ne sont pas converties.";
  box.appendChild(ex);

  const btns = document.createElement("div");
  btns.className = "dialog-buttons";
  const mk = (text, choice, cls) => {
    const b = document.createElement("button");
    b.textContent = text;
    if (cls) b.className = cls;
    b.onclick = () => { dlg.remove(); onChoose(choice); };
    return b;
  };
  btns.appendChild(mk("Annuler l'import", "cancel"));
  btns.appendChild(mk("Unité d'import ignorée", "ignore"));
  btns.appendChild(mk("Convertir les durées", "convert", "primary"));
  box.appendChild(btns);

  dlg.appendChild(box);
  document.body.appendChild(dlg);
}

// ─── Exposition globale ──────────────────────────────────────────────────────────
window.PERT_IMPORT_FORMATS = PERT_IMPORT_FORMATS;
window.pertRegisterImportFormat = pertRegisterImportFormat;
window.pertPickFile = pertPickFile;
window.pertOpenImportDialog = pertOpenImportDialog;
window.pertCloseImportDialog = pertCloseImportDialog;
window.pertConvertDuration = pertConvertDuration;
window.pertUnitLabel = pertUnitLabel;
window.pertProjectHasNodes = pertProjectHasNodes;
window.pertResolveImportMeta = pertResolveImportMeta;
window.pertResolveT0 = pertResolveT0;
window.pertBlockRoots = pertBlockRoots;
window.pertAnchorRoots = pertAnchorRoots;
