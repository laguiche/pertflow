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
// Choix de conception : les MOIS sont comptés en mois CALENDAIRES réels (via les
// méthodes de Date), pas approximés à 30 jours. Une tâche de N mois depuis T0 tombe
// exactement N mois calendaires plus loin (longueurs de mois et années bissextiles
// gérées nativement) → plus aucune dérive cumulée sur les projets longs (le bug du
// facteur fixe 30 j décalait de ~6 jours par an). Les jours (j=1) et les semaines
// (sem=7 j, exactes) restaient justes : seul le mois posait problème.
//
// Invariant conservé : offset→date et date→offset restent exactement inverses pour
// un offset entier de mois, ce qui est indispensable pour comparer une date-cible de
// jalon (calendaire) à une valeur calculée (en unités). On convertit toujours
// l'offset CUMULÉ depuis T0 (jamais pas-à-pas) → pas d'accumulation d'erreur.
//
// Le calcul interne du moteur reste 100% en unités abstraites : seule cette frontière
// unités↔dates change (chemin critique, marges et layout sont inchangés).

// Nombre de jours du mois calendaire de la date d (1..31).
function pertDaysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// Ajoute un décalage exprimé en unités à une date de référence (objet Date).
// "mois" → arithmétique calendaire (setMonth) ; partie fractionnaire au prorata des
// jours du mois atteint. "sem"/"j" → multiple de jours exact.
function pertAddUnits(refDate, offsetUnits, unit) {
  const d = new Date(refDate.getTime());
  if (unit === "mois") {
    const whole = Math.trunc(offsetUnits);
    const frac = offsetUnits - whole;
    d.setMonth(d.getMonth() + whole);
    if (Math.abs(frac) > 1e-9) {
      d.setDate(d.getDate() + Math.round(frac * pertDaysInMonth(d)));
    }
    return d;
  }
  const daysPerUnit = unit === "sem" ? 7 : 1;
  d.setDate(d.getDate() + Math.round(offsetUnits * daysPerUnit));
  return d;
}

// Décalage en unités (depuis T0) → objet Date, ou null si T0 non défini.
function pertOffsetToDate(offsetUnits) {
  if (offsetUnits === null || offsetUnits === undefined) return null;
  const meta = window.pertMeta || {};
  if (!meta.t0) return null;
  const t0 = new Date(meta.t0 + "T00:00:00");
  if (isNaN(t0.getTime())) return null;
  return pertAddUnits(t0, offsetUnits, meta.unit);
}

// Date calendaire (string "YYYY-MM-DD") → décalage en unités depuis T0, ou null.
// Inverse exact de pertOffsetToDate pour un offset entier de mois ; pour une date
// quelconque, partie entière = mois calendaires complets, fraction = part du mois
// courant (jour atteint / longueur du mois) → cohérent avec pertAddUnits.
function pertDateToOffset(dateStr) {
  const meta = window.pertMeta || {};
  if (!dateStr || !meta.t0) return null;
  const t0 = new Date(meta.t0 + "T00:00:00");
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(t0.getTime()) || isNaN(d.getTime())) return null;
  if (meta.unit === "mois") {
    let months = (d.getFullYear() - t0.getFullYear()) * 12 + (d.getMonth() - t0.getMonth());
    const base = pertAddUnits(t0, months, "mois"); // T0 + months mois calendaires
    const dayDiff = (d.getTime() - base.getTime()) / 86400000;
    if (Math.abs(dayDiff) > 1e-9) months += dayDiff / pertDaysInMonth(base);
    return months;
  }
  const daysPerUnit = meta.unit === "sem" ? 7 : 1;
  return (d.getTime() - t0.getTime()) / 86400000 / daysPerUnit;
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
    // Jalon ENTRANT : un jalon sans prédécesseur mais avec un successeur et une
    // date-cible représente une contrainte externe (livraison d'un prototype, jalon
    // client/fournisseur…) qui retarde le démarrage de la chaîne en aval — la tâche
    // suivante ne part donc pas automatiquement à T0 mais à cette date. La topologie
    // (aucun lien entrant + un lien sortant) distingue ce cas du jalon terminal
    // (échéance à tenir) et du checkpoint intermédiaire (qui, eux, gardent ES = max
    // des prédécesseurs ; la date-cible n'y borne que le LF, cf. backward pass).
    // Plancher à T0 : une contrainte antérieure à T0 est déjà levée au démarrage.
    if (node.type === "pert/milestone" && preds[id].length === 0
        && succs[id].length > 0 && node.properties.due_date) {
      const dueOff = pertDateToOffset(node.properties.due_date);
      if (dueOff !== null) es = Math.max(0, dueOff);
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
  // Le chemin critique = chemin de marge MINIMALE (et non strictement nulle). En
  // projet faisable, la marge minimale vaut 0 (le nœud terminal d'EF max est calé
  // sur la fin de projet) → comportement identique a "slack == 0". Mais si une
  // date-cible de jalon est ratee, le backward pass borne LF a la cible et tout le
  // chemin contraignant passe en marge NEGATIVE : aucun nœud n'a alors slack == 0.
  // Avec le critere min-slack on identifie quand meme ce chemin (sinon nbCritical
  // valait 0 et la barre d'etat affichait "Chemin critique : 0 nœud(s)" en
  // permanence des qu'une cible n'etait pas tenue).
  let minSlack = Infinity;
  for (const n of nodes) {
    n.slack = n.lf - n.ef;
    if (n.slack < minSlack) minSlack = n.slack;
  }
  let nbCritical = 0;
  for (const n of nodes) {
    n.is_critical = n.slack <= minSlack + PERT_EPS;
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
  // S7 (B) : packing conscient du groupe. L'abscisse (∝ ES) reste inchangee
  // (coherence temporelle facon Gantt) ; seule l'affectation des couloirs verticaux
  // tient compte du groupe → les taches d'un meme WP/groupe se posent sur des
  // couloirs voisins (bande verticale contigue) pour rester lisibles "de loin" (#4)
  // apres reorganisation. Les taches sans groupe sont packees normalement.
  pertPackLanesGrouped(rest, restTop, rowH, xOf);

  // #15 Les Labels n'ont pas de ES → ils ne sont pas places par le layout et
  // peuvent se retrouver sous une activite/jalon repositionne. On reloge ceux qui
  // chevauchent un nœud place, dans une bande libre sous le graphe.
  pertRelocateOverlappingLabels(graph, placeable);

  graph.setDirtyCanvas(true, true);
}

// Reloge les Labels qui chevauchent un nœud place (placed) vers une bande
// verticale libre sous le graphe. Les Labels non genants gardent leur position
// (un placement manuel volontaire n'est pas bouscule sans raison).
function pertRelocateOverlappingLabels(graph, placed) {
  const labels = graph._nodes.filter(n => n.type === "pert/label");
  if (!labels.length || !placed.length) return;

  const overlaps = (a, b) =>
    a.pos[0] < b.pos[0] + b.size[0] && a.pos[0] + a.size[0] > b.pos[0] &&
    a.pos[1] < b.pos[1] + b.size[1] && a.pos[1] + a.size[1] > b.pos[1];

  // Bas du graphe = ordonnee max des nœuds places (bord inferieur).
  let bottomY = -Infinity;
  placed.forEach(n => { bottomY = Math.max(bottomY, n.pos[1] + n.size[1]); });
  let cursorY = bottomY + PERT_LAYOUT_GAP_Y;
  const x = PERT_LAYOUT_MARGIN_X;

  for (const lbl of labels) {
    if (!placed.some(n => overlaps(lbl, n))) continue; // ne touche pas un Label OK
    lbl.pos[0] = x;
    lbl.pos[1] = cursorY;                 // sous le graphe → aucun chevauchement
    cursorY += lbl.size[1] + PERT_LAYOUT_GAP_Y; // empile les Labels relogés
  }
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

// Cle de groupe d'un nœud pour le layout : nom du groupe d'une Activite, sinon ""
// (sans groupe). Les Jalons intermediaires n'ont pas de groupe → bande "".
function pertGroupKey(n) {
  return (n.type === "pert/activity" && n.properties && n.properties.group)
    ? String(n.properties.group).trim() : "";
}

// S7 (B) : packing par couloirs CONSCIENT DU GROUPE. On partitionne la liste par
// groupe et on empile les bandes verticalement (une bande contigue de couloirs par
// groupe), de sorte que les taches d'un meme groupe restent voisines a l'ecran.
// L'abscisse (xOf, ∝ ES) n'est jamais modifiee → le calage temporel facon Gantt est
// preserve ; le groupe ne joue que sur la dimension verticale. La non-superposition
// reste prioritaire (chaque bande est packee par pertPackLanes). Quand aucun groupe
// n'est utilise, tout retombe dans une seule bande "" → comportement identique a
// l'ancien packing (best-effort, decision utilisateur du 28/06/2026).
function pertPackLanesGrouped(list, topY, rowH, xOf) {
  if (!list.length) return 0;

  const buckets = new Map();
  for (const n of list) {
    const k = pertGroupKey(n);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(n);
  }

  // Ordre des bandes : groupes nommes d'abord, tries par ES min croissant (lecture
  // dans le sens du temps) puis par nom ; la bande "sans groupe" ("") en dernier.
  const minX = k => buckets.get(k).reduce((m, n) => Math.min(m, xOf[n.id]), Infinity);
  const keys = Array.from(buckets.keys()).sort((a, b) => {
    if (a === "") return 1;
    if (b === "") return -1;
    return (minX(a) - minX(b)) || a.localeCompare(b, "fr");
  });

  let laneTop = topY;
  for (const k of keys) {
    const used = pertPackLanes(buckets.get(k), laneTop, rowH, xOf);
    laneTop += used * rowH; // bande suivante posee sous la precedente
  }
  return keys.length;
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

  // Remontee du chemin contraignant (cible → T0, vers l'amont)
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

  // Descente vers le nœud terminal (cible → fin de projet, vers l'aval) — #26.
  // Symetrique de la remontee : sans elle, selectionner un nœud intermediaire
  // laissait le ou les liens en aval (jusqu'au jalon de fin) en gris, donc le
  // "dernier lien" du chemin critique n'etait pas colore. On suit les successeurs
  // que le nœud courant contraint (son EF cale le ES du successeur), en preferant
  // les successeurs critiques, jusqu'a un nœud terminal. Sans effet quand la cible
  // est deja le nœud terminal (cas du clic sur le fond) : la boucle s'arrete
  // immediatement (aucun successeur), donc le comportement par defaut est inchange.
  const seenFwd = new Set();
  current = target;
  while (current && !seenFwd.has(current.id)) {
    seenFwd.add(current.id);
    let binding = null;
    for (const sid of succs[current.id]) {
      const s = byId[sid];
      if (s.es === null) continue;
      // successeur contraint : son ES est cale par le EF du nœud courant
      if (Math.abs(current.ef - s.es) < PERT_EPS) {
        // preferer un successeur critique, puis celui de plus grand EF (plus loin)
        if (!binding || (s.is_critical && !binding.is_critical) || s.ef > binding.ef) {
          binding = s;
        }
      }
    }
    if (!binding) break;
    pertColorLink(graph, current.id, binding.id, "#cc0000");
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
