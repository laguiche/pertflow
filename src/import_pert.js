// ─── Import d'un projet PertFlow (.pert) par CONCATENATION — Lot 2 ───────────────
//
// A ne pas confondre avec « Ouvrir » (src/storage.js → pertApplyProject) qui REMPLACE
// le projet courant. Ici on CONCATENE : les noeuds du fichier sont ajoutes a droite du
// graphe existant, comme un lot d'import Excel.
//
// Consequence directe : on ne peut PAS passer par graph.configure(), qui repartirait
// d'un graphe vide. On instancie chaque noeud via LiteGraph.createNode + recopie de ses
// properties, puis on recree les liens en remappant les identifiants serialises.
//
// Contrainte file:// (PC verrouille DSI) : lecture par <input type="file"> +
// FileReader.readAsText, JAMAIS fetch().

// Conflits de couleur entre le registre de groupes du projet et celui du fichier.
// Regle (decision utilisateur) : le PROJET COURANT gagne. On se contente d'avertir.
// Renvoie [{ name, current, file }].
function pertGroupColorConflicts(fileGroups) {
  const reg = (window.pertGroups ? pertGroups() : {}) || {};
  const out = [];
  Object.keys(fileGroups || {}).forEach(name => {
    const cur = reg[name];
    const fil = fileGroups[name];
    if (cur && fil && cur.toLowerCase() !== fil.toLowerCase()) {
      out.push({ name, current: cur, file: fil });
    }
  });
  return out;
}

// Lit le fichier .pert choisi par l'utilisateur et demarre l'import.
function handlePertImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      showError("Fichier .pert invalide (JSON illisible)");
      return;
    }
    guardUI("Import du projet PertFlow impossible", () => startPertImport(data));
  };
  reader.onerror = () => showError("Lecture du fichier impossible");
  reader.readAsText(file);
}

// Dialogue groupe (avec l'option « conserver ») → resolution T0/unite → concatenation.
function startPertImport(data) {
  if (!data || !data.graph || !Array.isArray(data.graph.nodes) || !data.graph.nodes.length) {
    showToast("Aucun nœud à importer");
    return;
  }
  const fileMeta = data.meta || {};
  const conflicts = pertGroupColorConflicts(fileMeta.groups);

  promptImportGroup(pickDefaultImportColor(), (color, group, keep) => {
    // Les deux formats partagent la meme resolution T0/unite (src/import.js) :
    // T0 = min + ancrage ; unite du projet preservee, durees converties si demande.
    pertResolveImportMeta(fileMeta.t0 || "", fileMeta.unit || "", (plan) => {
      applyPertImport(data, plan, { color, group, keep });
    });
  }, {
    allowKeep: true,
    conflicts: conflicts,
    title: "Importer un projet PertFlow"
  });
}

// Concatene le contenu d'un .pert dans le graphe courant.
//   plan = { unit, convertFrom, t0, anchor }  (cf. pertResolveImportMeta)
//   opt  = { color, group, keep }             (cf. promptImportGroup)
function applyPertImport(data, plan, opt) {
  const graph = window.pertGraph;
  if (!graph) return;
  const sNodes = data.graph.nodes;
  const fileMeta = data.meta || {};

  // Noeuds preexistants, captures AVANT l'ajout : c'est le « bloc existant », candidat
  // a l'ancrage si c'est lui qui demarrait le plus tard.
  const before = graph._nodes.slice();

  // Origine du bloc importe et decalage pour le poser a droite du graphe existant.
  let impMinX = Infinity, impMinY = Infinity;
  sNodes.forEach(n => {
    if (!n.pos) return;
    impMinX = Math.min(impMinX, n.pos[0]);
    impMinY = Math.min(impMinY, n.pos[1]);
  });
  if (!isFinite(impMinX)) { impMinX = 0; impMinY = 0; }
  let baseX = 60, baseY = 60;
  if (before.length) {
    let maxX = -Infinity;
    before.forEach(n => { maxX = Math.max(maxX, n.pos[0] + n.size[0]); });
    baseX = maxX + 80;
  }
  const dx = baseX - impMinX, dy = baseY - impMinY;

  // Registre des groupes : on n'ajoute QUE les groupes inconnus du projet. Un groupe
  // deja connu conserve sa couleur courante (le projet gagne) → les activites importees
  // de ce groupe heriteront de cette teinte via pertApplyGroup (#4 harmonisation).
  if (opt.keep && fileMeta.groups) {
    const reg = pertGroups();
    Object.keys(fileMeta.groups).forEach(name => {
      if (name && !reg[name]) reg[name] = fileMeta.groups[name];
    });
  }

  // ── 1) Noeuds (map id serialise → instance, pour les liens) ────────────────────
  const created = {};
  const importedNodes = [];
  sNodes.forEach(sn => {
    const node = LiteGraph.createNode(sn.type);
    if (!node) return;   // type inconnu (fichier d'une version future) → ignore
    Object.assign(node.properties, sn.properties || {});

    if (node.type === "pert/activity") {
      // Conversion des durees si l'utilisateur l'a demandee (unites divergentes).
      // Les due_date des jalons sont absolues → jamais converties.
      if (plan.convertFrom) {
        node.properties.duration =
          pertConvertDuration(node.properties.duration, plan.convertFrom, plan.unit);
      }
      if (!opt.keep) {
        // Retag : un lot = un groupe + une couleur (symetrie avec l'import CPERT).
        node.properties.group = opt.group || "";
        node.properties.color = opt.color;
      }
      // Dans les deux cas, pertApplyGroup tranche : heritage si le groupe est connu,
      // « premier venu » sinon. Sans groupe, la couleur individuelle est conservee.
      pertApplyGroup(node);
      node.color = node.properties.color;
    }

    node.pos = [(sn.pos ? sn.pos[0] : 0) + dx, (sn.pos ? sn.pos[1] : 0) + dy];
    if (node.updateSize) node.updateSize();
    graph.add(node);
    created[sn.id] = node;
    importedNodes.push(node);
  });

  // ── 2) Liens : [id, origin_id, origin_slot, target_id, target_slot, type] ───────
  // On ne rejoue pas target_slot tel quel : les slots d'entree sont dynamiques (un slot
  // libre est ajoute a chaque connexion) → on prend le premier slot libre de la cible.
  let nbLinks = 0;
  (data.graph.links || []).forEach(l => {
    const src = created[l[1]], dst = created[l[3]];
    if (!src || !dst) return;
    if (src.connect(l[2] || 0, dst, freeInputSlot(dst))) nbLinks++;
  });

  // ── 3) Metadonnees : T0 le plus anterieur, unite du projet preservee ───────────
  window.pertMeta.t0 = plan.t0;
  window.pertMeta.unit = plan.unit;

  // ── 4) Ancrage : le bloc qui demarrait le plus tard garde sa date de demarrage ──
  let anchored = null;
  if (plan.anchor) {
    const target = plan.anchor.side === "imported" ? importedNodes : before;
    const label = plan.anchor.side === "imported"
      ? "Début " + (fileMeta.title || "import")
      : "Début " + (window.pertMeta.title || "projet");
    anchored = pertAnchorRoots(target, plan.anchor.date, label);
  }

  // #34 : les uid du fichier peuvent collisionner avec ceux du projet (meme .pert
  // importe deux fois, ou projet derive d'un autre) → dedoublonnage systematique.
  if (window.pertEnsureUids) pertEnsureUids();

  // L'unite pilote la largeur des Activites → recalcul des tailles apres coup.
  graph._nodes.forEach(n => { if (n.updateSize) n.updateSize(); });

  pertRecalc();
  updateStatus();
  refreshFilterOptions();   // nouveaux groupes/couleurs disponibles dans le filtre
  pertZoomToFit();

  let msg = importedNodes.length + " nœud(s) et " + nbLinks + " lien(s) importés";
  if (plan.convertFrom) msg += " — durées converties";
  if (anchored) msg += " — jalon d'ancrage « " + anchored.properties.label + " » créé";
  showToast(msg);
}

// Enregistrement du format dans la fenetre d'import (src/import.js).
pertRegisterImportFormat({
  id: "pert", icon: "🗂", label: "Projet PertFlow (.pert)", order: 20,
  desc: "Concatène un autre projet PertFlow au projet courant.",
  run: () => pertPickFile("pert-input")
});

window.handlePertImportFile = handlePertImportFile;
window.pertGroupColorConflicts = pertGroupColorConflicts;
window.applyPertImport = applyPertImport;
