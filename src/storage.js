// ─── Sauvegarde / chargement JSON (.pert) — Session 3 ───────────────────────────
//
// Format du fichier .pert (cf. CLAUDE.md « MODELE DE DONNEES ») :
//   { version, meta:{ title, t0, unit, layout_gap }, graph: <graph.serialize()> }
//
// Contrainte file:// (PC verrouille DSI) : aucune requete reseau.
//  - Sauvegarde : Blob + <a download> (telechargement local par le navigateur).
//  - Chargement : <input type="file"> + FileReader.readAsText, JAMAIS fetch().
// Les valeurs calculees (es/ef/ls/lf/slack...) ne sont PAS serialisees (hors de
// node.properties) : elles sont recalculees par pertRecalc() apres chargement.

const PERT_FILE_VERSION = "1.0";

// Construit l'objet projet serialisable a partir de l'etat courant.
function pertSerializeProject() {
  const graph = window.pertGraph;
  const meta = window.pertMeta || {};
  return {
    version: PERT_FILE_VERSION,
    meta: {
      title: meta.title || "",
      t0: meta.t0 || "",
      unit: meta.unit || "j",
      layout_gap: meta.layout_gap != null ? meta.layout_gap : 30,
      // #18 largeur des taches ∝ duree (defaut true si absent : anciens .pert)
      prop_width: meta.prop_width !== false,
      // #14 registre des couleurs de groupes (WP/metier/service)
      groups: meta.groups || {}
    },
    // graph.serialize() renvoie un objet JS (noeuds + liens + positions/tailles)
    graph: graph ? graph.serialize() : null
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
function pertSaveProject() {
  const data = pertSerializeProject();
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
  showToast("Projet sauvegarde : " + a.download);
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
  window.pertMeta.title = meta.title || "Nouveau projet";
  window.pertMeta.t0 = meta.t0 || "";
  window.pertMeta.unit = meta.unit || "j";
  window.pertMeta.layout_gap = meta.layout_gap != null ? meta.layout_gap : 30;
  // #18 largeur ∝ duree (defaut true pour les fichiers anterieurs sans la cle)
  window.pertMeta.prop_width = meta.prop_width !== false;
  // #14 registre des couleurs de groupes (robuste aux fichiers anterieurs : {})
  window.pertMeta.groups = meta.groups || {};

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
  pertZoomToFit();

  // Nouvelle reference d'historique : le projet charge devient la baseline d'undo
  // (sinon un Ctrl+Z remonterait avant le chargement, sur un graphe etranger).
  if (window.pertHistoryReset) window.pertHistoryReset();

  showToast("Projet charge : " + graph._nodes.length + " nœud(s)");
}

// Exposition globale (appelee depuis ui.js)
window.pertSaveProject = pertSaveProject;
window.pertLoadProject = pertLoadProject;
window.pertSerializeProject = pertSerializeProject;
