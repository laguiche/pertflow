// ─── Sauvegarde / chargement JSON (.pert) — Session 3 ───────────────────────────
//
// Format du fichier .pert (modele de donnees detaille dans docs/conception.md) :
//   { version, meta:{ title, t0, unit, layout_gap }, graph: <graph.serialize()> }
//
// Contrainte file:// (PC verrouille DSI) : aucune requete reseau.
//  - Sauvegarde : Blob + <a download> (telechargement local par le navigateur).
//  - Chargement : <input type="file"> + FileReader.readAsText, JAMAIS fetch().
// Les valeurs calculees (es/ef/ls/lf/slack...) ne sont PAS serialisees (hors de
// node.properties) : elles sont recalculees par pertRecalc() apres chargement.

const PERT_FILE_VERSION = "1.0";

// Construit l'objet projet serialisable a partir de l'etat courant.
// graphData (facultatif) : graphe deja serialise par l'appelant — pertSaveProject en a
// besoin AVANT, pour calculer l'empreinte de la revision qu'il inscrit.
function pertSerializeProject(graphData) {
  const graph = window.pertGraph;
  const meta = window.pertMeta || {};
  return {
    version: PERT_FILE_VERSION,
    meta: {
      // Identite de revision (v0.26.1, cf. src/revisions.js). Vides pour un projet
      // jamais sauvegarde : l'identite n'est tiree qu'a la premiere sauvegarde suivie.
      lot_id: meta.lot_id || "",
      revision: meta.revision || 0,
      history: Array.isArray(meta.history) ? meta.history : [],
      title: meta.title || "",
      t0: meta.t0 || "",
      unit: meta.unit || "j",
      layout_gap: meta.layout_gap != null ? meta.layout_gap : 30,
      // S10 style des liens (defaut "courbe" si absent : anciens .pert)
      link_mode: meta.link_mode || "courbe",
      // #18 largeur des taches ∝ duree (defaut true si absent : anciens .pert)
      prop_width: meta.prop_width !== false,
      // Trame temporelle de fond (defaut false si absent : anciens .pert inchanges)
      time_grid: !!meta.time_grid,
      time_grid_intensity: meta.time_grid_intensity != null ? meta.time_grid_intensity : 1,
      // S8.5 parametres d'estimation de cout (defauts si absents : anciens .pert)
      hours_per_month: meta.hours_per_month != null ? meta.hours_per_month : 135,
      hours_per_day: meta.hours_per_day != null ? meta.hours_per_day : 8,
      hourly_rate: meta.hourly_rate != null ? meta.hourly_rate : 136,
      // #14 registre des couleurs de groupes (WP/metier/service)
      groups: meta.groups || {},
      // Couleur/groupe des taches nouvellement creees (defaut "libre" : anciens .pert)
      new_task_mode: meta.new_task_mode === "groupe" ? "groupe" : "libre",
      new_task_group: meta.new_task_group || "",
      // Sauvegarde automatique (recuperation apres plantage) : activee par defaut
      autosave: meta.autosave !== false
    },
    // graph.serialize() renvoie un objet JS (noeuds + liens + positions/tailles)
    graph: graphData || (graph ? graph.serialize() : null)
  };
}

// Nom de fichier sur depuis le titre du projet (ASCII, sans espaces).
function pertProjectFilename() {
  const raw = (window.pertMeta && window.pertMeta.title) || "pertflow";
  const safe = raw.trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")  // remplace tout caractere non sur
    .replace(/^_+|_+$/g, "");
  return (safe || "pertflow");
}

// Telecharge le projet courant au format .pert (JSON indente).
// opts (facultatif, v0.26.1) : { author, comment } inscrits dans l'historique. Appelee
// sans argument (tests, sauvegarde directe), l'auteur est le nom retenu sur ce poste.
// Le bouton et Ctrl+S passent par la fenetre pertOpenSaveDialog (src/revisions.js).
function pertSaveProject(opts) {
  const graph = window.pertGraph;
  if (!graph) { showToast("Rien a sauvegarder"); return; }
  // La revision avance a CHAQUE sauvegarde du fichier, et seulement la : la sauvegarde
  // automatique serialise sans passer par ici. Si l'utilisateur annule ensuite le
  // telechargement, la numerotation sautera un cran — sans consequence, elle ne
  // promet que l'ordre, pas la continuite.
  const graphData = graph.serialize();
  if (window.pertRecordRevision) pertRecordRevision(window.pertMeta, graphData, opts);
  const data = pertSerializeProject(graphData);
  if (!data.graph) { showToast("Rien a sauvegarder"); return; }
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = pertProjectFilename() + ".pert";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Liberer l'URL objet apres que le navigateur a demarre le telechargement.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  // Le fichier .pert capture l'etat : plus rien de « non sauvegarde » a recuperer.
  if (window.pertAutosaveMarkSaved) window.pertAutosaveMarkSaved();
  showToast("Projet sauvegarde : " + a.download
    + (data.meta.revision ? " (révision " + data.meta.revision + ")" : ""));
}

// Lit un fichier .pert choisi par l'utilisateur et l'applique au graphe.
function pertLoadProject(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      showToast("Fichier .pert invalide (JSON illisible)");
      return;
    }
    pertApplyProject(data);
  };
  reader.onerror = () => showToast("Lecture du fichier impossible");
  reader.readAsText(file);
}

// Restaure meta + graphe a partir d'un objet projet (REMPLACE l'existant).
function pertApplyProject(data) {
  const graph = window.pertGraph;
  if (!graph) return;
  if (!data || !data.graph) {
    showToast("Fichier .pert invalide (graphe absent)");
    return;
  }

  // Metadonnees projet (avec valeurs par defaut robustes aux anciens fichiers)
  const meta = data.meta || {};
  // Identite de revision (v0.26.1) : un fichier anterieur n'en a pas → revision 0,
  // historique vide, identite tiree a sa premiere sauvegarde. Champs venus d'un
  // fichier, donc filtres (cf. src/revisions.js).
  const history = window.pertSanitizeHistory ? pertSanitizeHistory(meta.history) : [];
  window.pertMeta.history = history;
  window.pertMeta.revision = window.pertSanitizeRevision
    ? pertSanitizeRevision(meta.revision, history) : 0;
  window.pertMeta.lot_id = window.pertSanitizeLotId ? pertSanitizeLotId(meta.lot_id) : "";
  window.pertMeta.title = meta.title || "Nouveau projet";
  window.pertMeta.t0 = meta.t0 || "";
  window.pertMeta.unit = meta.unit || "j";
  window.pertMeta.layout_gap = meta.layout_gap != null ? meta.layout_gap : 30;
  // S10 style des liens (defaut "courbe" pour les fichiers anterieurs sans la cle)
  window.pertMeta.link_mode = meta.link_mode || "courbe";
  // #18 largeur ∝ duree (defaut true pour les fichiers anterieurs sans la cle)
  window.pertMeta.prop_width = meta.prop_width !== false;
  // Trame temporelle (defaut false pour les fichiers anterieurs sans la cle)
  window.pertMeta.time_grid = !!meta.time_grid;
  window.pertMeta.time_grid_intensity = meta.time_grid_intensity != null ? meta.time_grid_intensity : 1;
  // S8.5 parametres d'estimation de cout (defauts pour les fichiers anterieurs)
  window.pertMeta.hours_per_month = meta.hours_per_month != null ? meta.hours_per_month : 135;
  window.pertMeta.hours_per_day = meta.hours_per_day != null ? meta.hours_per_day : 8;
  window.pertMeta.hourly_rate = meta.hourly_rate != null ? meta.hourly_rate : 136;
  // #14 registre des couleurs de groupes (robuste aux fichiers anterieurs : {})
  window.pertMeta.groups = meta.groups || {};
  // Couleur/groupe des nouvelles taches (defaut "libre" pour les fichiers anterieurs)
  window.pertMeta.new_task_mode = meta.new_task_mode === "groupe" ? "groupe" : "libre";
  window.pertMeta.new_task_group = meta.new_task_group || "";
  // Sauvegarde automatique (activee par defaut, y compris fichiers anterieurs sans la cle)
  window.pertMeta.autosave = meta.autosave !== false;

  // Restauration du graphe : on vide tout puis on reconfigure depuis le fichier.
  graph.clear();
  graph.configure(data.graph);

  // #34 securite : garantir l'unicite des uid (anciens fichiers sans uid → genere ;
  // doublons eventuels → regeneres). Les fichiers recents ont deja des uid uniques.
  if (window.pertEnsureUids) pertEnsureUids();

  // Les tailles des noeuds dependent de l'unite et des libelles : configure()
  // restaure la taille serialisee, mais on la recalcule pour rester coherent
  // avec les regles de rendu courantes (largeur ∝ duree, retour a la ligne...).
  graph._nodes.forEach(n => { if (n.updateSize) n.updateSize(); });

  document.getElementById("project-title").textContent =
    window.pertMeta.title || "PertFlow";

  pertRecalc();
  updateStatus();
  // S10 : applique le style de liens du projet charge (courbe/droit/coude)
  if (window.pertApplyLinkMode) pertApplyLinkMode();
  pertZoomToFit();

  // Nouvelle reference d'historique : le projet charge devient la baseline d'undo
  // (sinon un Ctrl+Z remonterait avant le chargement, sur un graphe etranger).
  if (window.pertHistoryReset) window.pertHistoryReset();

  // Chargement = nouvelle reference « sauvegarde » : on efface le snapshot de
  // recuperation (le projet charge n'a pas de travail non sauvegarde en attente).
  if (window.pertAutosaveMarkSaved) window.pertAutosaveMarkSaved();

  showToast("Projet charge : " + graph._nodes.length + " nœud(s)");
}

// Exposition globale (appelee depuis ui.js)
window.pertSaveProject = pertSaveProject;
window.pertLoadProject = pertLoadProject;
window.pertSerializeProject = pertSerializeProject;
