// ─── Moteur de calcul PERT — Session 2 ─────────────────────────────────────────
//
// Calcule, pour chaque nœud Activité / Jalon du graphe :
//   ES (Early Start), EF (Early Finish), LS (Late Start), LF (Late Finish),
//   slack (marge) et is_critical (sur le chemin critique).
// Détecte les cycles (PERT non calculable) et signale les jalons dont la
// date-cible n'est pas tenue.
//
// Convention interne : toutes les valeurs ES/EF/LS/LF/slack sont exprimées en
// UNITES (l'unité courante du projet : jour, semaine ou mois), comptées en
// décalage depuis T0 (ES du/des premier(s) nœud(s) = 0). La conversion en date
// calendaire pour l'affichage est faite par pertOffsetToDate().
//
// Les nœuds Label n'ont pas de ports et sont ignorés.

// ─── Conversion unités ⇄ dates calendaires ──────────────────────────────────────
//
// Choix de conception : facteur fixe « jours par unité » (j=1, sem=7, mois=30).
// Garantit que offset→date et date→offset sont exactement inverses, ce qui est
// indispensable pour comparer une date-cible de jalon (calendaire) à une valeur
// calculée (en unités). Les mois sont donc approximés à 30 jours — acceptable
// pour un planning prévisionnel au long cours ; raffinable plus tard.

function pertDaysPerUnit(unit) {
  if (unit === "sem") return 7;
  if (unit === "mois") return 30;
  return 1; // "j"
}

// Décalage en unités (depuis T0) → objet Date, ou null si T0 non défini.
function pertOffsetToDate(offsetUnits) {
  if (offsetUnits === null || offsetUnits === undefined) return null;
  const meta = window.pertMeta || {};
  if (!meta.t0) return null;
  const t0 = new Date(meta.t0 + "T00:00:00");
  if (isNaN(t0.getTime())) return null;
  const days = offsetUnits * pertDaysPerUnit(meta.unit);
  const d = new Date(t0.getTime());
  d.setDate(d.getDate() + Math.round(days));
  return d;
}

// Date calendaire (string "YYYY-MM-DD") → décalage en unités depuis T0, ou null.
function pertDateToOffset(dateStr) {
  const meta = window.pertMeta || {};
  if (!dateStr || !meta.t0) return null;
  const t0 = new Date(meta.t0 + "T00:00:00");
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(t0.getTime()) || isNaN(d.getTime())) return null;
  const days = (d.getTime() - t0.getTime()) / 86400000;
  return days / pertDaysPerUnit(meta.unit);
}

// ─── Accès au modèle de graphe ──────────────────────────────────────────────────

const PERT_TYPES = ["pert/activity", "pert/milestone"];

function pertIsComputed(node) {
  return node && PERT_TYPES.indexOf(node.type) !== -1;
}

function pertDuration(node) {
  if (node.type === "pert/activity") {
    const d = parseFloat(node.properties.duration);
    return isNaN(d) ? 0 : d;
  }
  return 0; // jalon = durée nulle
}

// Construit les listes de prédécesseurs / successeurs à partir de graph.links.
// Un lien origin_id → target_id signifie : origin est prédécesseur de target.
function pertBuildAdjacency(graph) {
  const nodes = graph._nodes.filter(pertIsComputed);
  const ids = new Set(nodes.map(n => n.id));
  const preds = {}, succs = {};
  nodes.forEach(n => { preds[n.id] = []; succs[n.id] = []; });

  for (const linkId in graph.links) {
    const link = graph.links[linkId];
    if (!link) continue;
    if (!ids.has(link.origin_id) || !ids.has(link.target_id)) continue;
    // éviter les doublons (multi-liens entre mêmes nœuds)
    if (succs[link.origin_id].indexOf(link.target_id) === -1) {
      succs[link.origin_id].push(link.target_id);
    }
    if (preds[link.target_id].indexOf(link.origin_id) === -1) {
      preds[link.target_id].push(link.origin_id);
    }
  }
  return { nodes, preds, succs };
}

// ─── Détection de cycle (DFS tricolore) ─────────────────────────────────────────

function pertDetectCycle(nodes, succs) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = {};
  nodes.forEach(n => { color[n.id] = WHITE; });

  function visit(id) {
    color[id] = GRAY;
    for (const s of succs[id]) {
      if (color[s] === GRAY) return true;          // arête arrière → cycle
      if (color[s] === WHITE && visit(s)) return true;
    }
    color[id] = BLACK;
    return false;
  }

  for (const n of nodes) {
    if (color[n.id] === WHITE && visit(n.id)) return true;
  }
  return false;
}

// ─── Tri topologique (Kahn) ─────────────────────────────────────────────────────

function pertTopoOrder(nodes, preds, succs) {
  const indeg = {};
  nodes.forEach(n => { indeg[n.id] = preds[n.id].length; });
  const queue = nodes.filter(n => indeg[n.id] === 0).map(n => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const s of succs[id]) {
      if (--indeg[s] === 0) queue.push(s);
    }
  }
  return order; // longueur < nodes.length seulement en cas de cycle (déjà filtré)
}

// ─── Calcul principal ───────────────────────────────────────────────────────────

const PERT_EPS = 1e-6;

// Réinitialise les valeurs calculées d'un nœud.
function pertResetNode(node) {
  node.es = node.ef = node.ls = node.lf = node.slack = null;
  node.is_critical = false;
  if (node.type === "pert/milestone") node.target_missed = false;
}

// Recalcule tout le graphe et reporte les résultats sur les nœuds.
// Retourne { ok, error, nbNodes, nbCritical, projectEnd }.
function pertRecalc() {
  const graph = window.pertGraph;
  if (!graph) return { ok: false, error: "no_graph" };

  const { nodes, preds, succs } = pertBuildAdjacency(graph);

  // Toujours repartir d'un état propre
  nodes.forEach(pertResetNode);

  if (nodes.length === 0) {
    pertPublishStatus({ ok: true, nbNodes: 0, nbCritical: 0, projectEnd: null });
    graph.setDirtyCanvas(true, true);
    return { ok: true, nbNodes: 0, nbCritical: 0 };
  }

  // — Cycle → on s'arrête, valeurs laissées à null —
  if (pertDetectCycle(nodes, succs)) {
    const res = { ok: false, error: "cycle", nbNodes: nodes.length };
    pertPublishStatus(res);
    graph.setDirtyCanvas(true, true);
    return res;
  }

  const order = pertTopoOrder(nodes, preds, succs);
  const byId = {};
  nodes.forEach(n => { byId[n.id] = n; });

  // — Forward pass : ES / EF —
  for (const id of order) {
    const node = byId[id];
    let es = 0; // sans prédécesseur → ES = T0
    for (const p of preds[id]) {
      const efPred = byId[p].ef;
      if (efPred !== null && efPred > es) es = efPred;
    }
    node.es = es;
    node.ef = es + pertDuration(node);
  }

  // — Fin de projet = nœud le plus éloigné de T0 (max EF) —
  let projectEnd = 0;
  for (const n of nodes) if (n.ef > projectEnd) projectEnd = n.ef;

  // — Backward pass : LF / LS (ordre topo inverse) —
  for (let i = order.length - 1; i >= 0; i--) {
    const node = byId[order[i]];
    let lf;
    if (succs[node.id].length === 0) {
      lf = projectEnd; // nœud terminal : caler sur la fin de projet
    } else {
      lf = Infinity;
      for (const s of succs[node.id]) {
        const lsSucc = byId[s].ls;
        if (lsSucc !== null && lsSucc < lf) lf = lsSucc;
      }
    }
    // Jalon avec date-cible : LF bornée par la cible si elle est plus contraignante
    if (node.type === "pert/milestone" && node.properties.due_date) {
      const dueOffset = pertDateToOffset(node.properties.due_date);
      if (dueOffset !== null && dueOffset < lf) lf = dueOffset;
      // Cible non tenue : on ne peut pas finir avant la date-cible
      node.target_missed = (dueOffset !== null && node.ef > dueOffset + PERT_EPS);
    }
    node.lf = lf;
    node.ls = lf - pertDuration(node);
  }

  // — Marges + chemin critique —
  let nbCritical = 0;
  for (const n of nodes) {
    n.slack = n.lf - n.ef;
    n.is_critical = Math.abs(n.slack) < PERT_EPS;
    if (n.is_critical) nbCritical++;
  }

  // Les nœuds adaptent leur taille aux valeurs calculées (le jalon grandit pour
  // afficher les lignes Fin/Cible une fois renseignées).
  nodes.forEach(n => { if (n.updateSize) n.updateSize(); });

  // #7 Tracé du chemin critique en rouge (vers la cible mémorisée, ou par défaut
  // le nœud le plus éloigné de T0).
  pertHighlightCriticalPath(window.pertHighlightTargetId);

  const res = { ok: true, nbNodes: nodes.length, nbCritical, projectEnd };
  pertPublishStatus(res);
  graph.setDirtyCanvas(true, true);
  return res;
}

// ─── #1 Ré-arrangement chronologique automatique ────────────────────────────────
//
// Placement de type Gantt : abscisse ∝ date au plus tôt (ES), packing vertical
// par "couloirs" (lanes) pour eliminer les superpositions. Deux taches qui se
// chevauchent dans le temps sont posees sur des couloirs differents ; une tache
// reutilise le premier couloir libere par une tache anterieure.
// Declenche manuellement (bouton toolbar), jamais pendant l'edition.

const PERT_LAYOUT_MARGIN_X = 60;
const PERT_LAYOUT_MARGIN_Y = 60;
const PERT_LAYOUT_GAP_X = 24;   // espace mini entre deux taches d'un meme couloir
const PERT_LAYOUT_GAP_Y = 30;   // espace vertical entre couloirs

// Espacement horizontal entre taches consecutives (confort visuel des liens).
// Parametrable a chaud via le dialogue Parametres (meta.layout_gap) ; cette
// constante n'est que la valeur par defaut (decision revisable apres retours
// utilisateurs, cf. demande du 24/06/2026).
const PERT_LAYOUT_HGAP_DEFAULT = 30;

function pertLayoutGap() {
  const g = window.pertMeta && window.pertMeta.layout_gap;
  const n = parseFloat(g);
  return isNaN(n) ? PERT_LAYOUT_HGAP_DEFAULT : Math.max(0, n);
}

function pertAutoLayout() {
  const graph = window.pertGraph;
  if (!graph) return;

  // S'assurer que les ES sont a jour avant de positionner
  pertRecalc();

  const { nodes, preds, succs } = pertBuildAdjacency(graph);
  const placeable = nodes.filter(n => n.es !== null);
  if (!placeable.length) return;

  // Rang = profondeur dans la chaine (plus long chemin en nombre d'aretes depuis
  // une origine). Sert a INSERER un espace horizontal entre taches consecutives :
  // l'abscisse stricte (∝ ES) colle les taches bord a bord (style Gantt) et masque
  // les liens ; on ajoute rang × gap pour les ecarter d'un cran a chaque maillon.
  const order = pertTopoOrder(nodes, preds, succs);
  const rank = {};
  nodes.forEach(n => { rank[n.id] = 0; });
  for (const id of order) {
    for (const s of succs[id]) {
      if (rank[id] + 1 > rank[s]) rank[s] = rank[id] + 1;
    }
  }

  const gap = pertLayoutGap();
  const xOf = {};
  placeable.forEach(n => {
    xOf[n.id] = PERT_LAYOUT_MARGIN_X + n.es * PERT_PX_PER_UNIT + rank[n.id] * gap;
  });

  // Hauteur de couloir = plus grande tache + marge
  let rowH = 0;
  placeable.forEach(n => { if (n.size[1] > rowH) rowH = n.size[1]; });
  rowH += PERT_LAYOUT_GAP_Y;

  // Jalons de sortie (terminaux, sans successeur) regroupes dans une bande EN HAUT
  // du graphe ; le reste (activites + jalons intermediaires) en dessous.
  const isOutMilestone = n => n.type === "pert/milestone" && succs[n.id].length === 0;
  const top = placeable.filter(isOutMilestone);
  const rest = placeable.filter(n => !isOutMilestone(n));

  const topLanes = pertPackLanes(top, PERT_LAYOUT_MARGIN_Y, rowH, xOf);
  const restTop = PERT_LAYOUT_MARGIN_Y + (top.length ? topLanes * rowH : 0);
  pertPackLanes(rest, restTop, rowH, xOf);

  graph.setDirtyCanvas(true, true);
}

// Packing par couloirs (lanes) d'une liste de nœuds : abscisse fournie par xOf,
// premier couloir libre verticalement. topY = ordonnee du couloir 0. Renvoie le
// nombre de couloirs utilises.
function pertPackLanes(list, topY, rowH, xOf) {
  list.sort((a, b) => (xOf[a.id] - xOf[b.id]) || (a.pos[1] - b.pos[1]));
  const lanes = []; // bord droit (x) actuellement occupe de chaque couloir
  for (const n of list) {
    const x = xOf[n.id];
    let lane = lanes.findIndex(right => x >= right + PERT_LAYOUT_GAP_X);
    if (lane === -1) { lane = lanes.length; lanes.push(0); }
    n.pos[0] = x;
    n.pos[1] = topY + lane * rowH;
    lanes[lane] = x + n.size[0];
  }
  return lanes.length;
}

// ─── #7 Tracé du chemin critique (coloration des connexions) ─────────────────────
//
// Remonte les predecesseurs "contraignants" (ceux dont le EF cale le ES du nœud
// courant) depuis une cible jusqu'a l'origine, et colore les liens traverses en
// rouge. La cible est le nœud passe en argument (selection utilisateur) ou, a
// defaut, le nœud le plus eloigne de T0 (EF max). Les autres liens repassent au
// gris par defaut.

function pertHighlightCriticalPath(targetId) {
  const graph = window.pertGraph;
  if (!graph) return;

  // Reinitialiser toutes les couleurs de lien (retour au gris par defaut)
  for (const id in graph.links) {
    if (graph.links[id]) graph.links[id].color = null;
  }

  const { nodes, preds, succs } = pertBuildAdjacency(graph);
  if (!nodes.length) return;
  const byId = {};
  nodes.forEach(n => { byId[n.id] = n; });

  // Cible : nœud demande s'il est calcule, sinon le plus eloigne de T0 (EF max).
  // A EF egal, on prefere un nœud terminal (sans successeur) — typiquement le
  // jalon de fin — plutot que la derniere activite qui le precede.
  let target = (targetId != null && byId[targetId] && byId[targetId].ef !== null)
    ? byId[targetId] : null;
  if (!target) {
    for (const n of nodes) {
      if (n.ef === null) continue;
      if (!target) { target = n; continue; }
      const nTerminal = succs[n.id].length === 0;
      const tTerminal = succs[target.id].length === 0;
      if (n.ef > target.ef + PERT_EPS
          || (Math.abs(n.ef - target.ef) < PERT_EPS && nTerminal && !tTerminal)) {
        target = n;
      }
    }
  }
  if (!target || target.ef === null) return;

  // Remontee du chemin contraignant
  const seen = new Set();
  let current = target;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    let binding = null;
    for (const pid of preds[current.id]) {
      const p = byId[pid];
      if (p.ef === null) continue;
      // predecesseur contraignant : son EF cale le ES du nœud courant
      if (Math.abs(p.ef - current.es) < PERT_EPS) {
        // preferer un predecesseur critique, puis celui de plus grand EF
        if (!binding || (p.is_critical && !binding.is_critical) || p.ef > binding.ef) {
          binding = p;
        }
      }
    }
    if (!binding) break;
    pertColorLink(graph, binding.id, current.id, "#cc0000");
    current = binding;
  }

  graph.setDirtyCanvas(true, true);
}

// Colore le(s) lien(s) origin→target dans graph.links.
function pertColorLink(graph, originId, targetId, color) {
  for (const id in graph.links) {
    const link = graph.links[id];
    if (link && link.origin_id === originId && link.target_id === targetId) {
      link.color = color;
    }
  }
}

// ─── Publication de l'état vers l'UI (barre de statut) ───────────────────────────

function pertPublishStatus(res) {
  const el = document.getElementById("status-pert");
  if (!el) return;
  if (!res.ok && res.error === "cycle") {
    el.textContent = "⛔ Cycle détecté — PERT non calculable";
    el.className = "pert-error";
    return;
  }
  el.className = "";
  if (!res.nbNodes) {
    el.textContent = "Aucun nœud à calculer";
    return;
  }
  let txt = "Chemin critique : " + res.nbCritical + " nœud(s)";
  if (res.projectEnd !== null && res.projectEnd !== undefined) {
    const unit = (window.pertMeta && window.pertMeta.unit) || "j";
    txt += " · Fin projet : " + res.projectEnd + " " + unit;
    const d = pertOffsetToDate(res.projectEnd);
    if (d) txt += " (" + pertFormatDate(d) + ")";
  }
  el.textContent = txt;
}

// Exposition globale (appelée depuis ui.js sur les événements de graphe)
window.pertRecalc = pertRecalc;
window.pertOffsetToDate = pertOffsetToDate;
window.pertDateToOffset = pertDateToOffset;
window.pertAutoLayout = pertAutoLayout;
window.pertHighlightCriticalPath = pertHighlightCriticalPath;
