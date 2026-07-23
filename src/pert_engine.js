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
// Chaque unité est comptée dans SA propre arithmétique naturelle — jamais ramenée à
// un facteur fixe en jours :
//   - MOIS  : mois CALENDAIRES réels (via setMonth). Une tâche de N mois depuis T0
//     tombe exactement N mois calendaires plus loin (longueurs de mois et années
//     bissextiles gérées nativement) → aucune dérive cumulée sur les projets longs
//     (le facteur fixe 30 j décalait de ~6 jours par an).
//   - SEM   : semaines calendaires, N × 7 jours exacts. Une semaine reste une
//     semaine : on ne la décompose PAS en 5 jours ouvrés parcourus un par un
//     (décision utilisateur — symétrie avec le mois).
//   - J     : jours OUVRÉS (décision utilisateur) — samedis et dimanches sont
//     sautés. C'est ainsi qu'un planning en jours se lit en gestion de projet.
//     Les jours fériés, eux, sont comptés comme ouvrés (pas de calendrier des
//     fériés : dépendant du pays/de l'entreprise, hors périmètre KISS).
//
// Cohérence sem/j : partir d'un jour de semaine et avancer de 5 jours ouvrés tombe
// exactement sur +7 jours calendaires → les deux unités restent alignées.
//
// Invariant conservé : offset→date et date→offset restent exactement inverses pour
// un offset entier (mois calendaires, semaines, jours ouvrés), ce qui est
// indispensable pour comparer une date-cible de jalon (calendaire) à une valeur
// calculée (en unités). On convertit toujours l'offset CUMULÉ depuis T0 (jamais
// pas-à-pas) → pas d'accumulation d'erreur.
//
// Le calcul interne du moteur reste 100% en unités abstraites : seule cette frontière
// unités↔dates change (chemin critique, marges et layout sont inchangés).

// Nombre de jours du mois calendaire de la date d (1..31).
function pertDaysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// ── Arithmétique des jours ouvrés (unité "j") ───────────────────────────────────
//
// On travaille sur un NUMERO DE JOUR absolu, calculé depuis les composantes locales
// de la Date : insensible au fuseau et aux bascules d'heure d'été (une soustraction
// de timestamps, elle, peut donner 23 h ou 25 h et fausser l'arrondi).

// Numéro de jour absolu de d. Jour 0 = jeudi 01/01/1970 ; jour 4 = lundi 05/01/1970.
function pertDayNumber(d) {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

// Date locale (minuit) correspondant à un numéro de jour absolu.
function pertDateFromDayNumber(n) {
  const u = new Date(n * 86400000);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
}

// Index de jour ouvré : nombre de jours ouvrés écoulés depuis le lundi 05/01/1970.
// Un samedi et un dimanche donnent le MÊME index que le lundi suivant → une date de
// week-end est de fait recalée sur le jour ouvré suivant (T0, date-cible de jalon…),
// ce qui préserve l'inversibilité offset↔date. Formule O(1) (pas de boucle : un
// projet peut couvrir des années).
function pertWorkdayIndex(d) {
  const m = pertDayNumber(d) - 4;   // 0 = lundi 05/01/1970 (Math.floor gère le négatif)
  const w = Math.floor(m / 7);      // numéro de semaine
  const r = m - 7 * w;              // rang dans la semaine : 0 = lundi … 6 = dimanche
  return w * 5 + Math.min(r, 5);    // samedi (5) et dimanche (6) → index du lundi suivant
}

// Inverse de pertWorkdayIndex : renvoie toujours un jour ouvré (lundi..vendredi).
function pertWorkdayFromIndex(i) {
  const w = Math.floor(i / 5);
  const r = i - 5 * w;              // 0..4
  return pertDateFromDayNumber(4 + 7 * w + r);
}

// Ajoute un décalage exprimé en unités à une date de référence (objet Date).
// "mois" → arithmétique calendaire (setMonth), partie fractionnaire au prorata des
// jours du mois atteint. "sem" → multiple de 7 jours exact. "j" → jours ouvrés.
function pertAddUnits(refDate, offsetUnits, unit) {
  if (unit === "j") {
    // Offset arrondi au jour ouvré entier (une durée peut être fractionnaire, ex. 1,9).
    return pertWorkdayFromIndex(pertWorkdayIndex(refDate) + Math.round(offsetUnits));
  }
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
  d.setDate(d.getDate() + Math.round(offsetUnits * 7)); // "sem" : semaines calendaires
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
// Inverse exact de pertOffsetToDate pour un offset entier de mois / semaines / jours
// ouvrés ; pour une date quelconque en mois, partie entière = mois calendaires
// complets, fraction = part du mois courant (jour atteint / longueur du mois).
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
  if (meta.unit === "j") {
    // Jours ouvrés entre T0 et d (week-ends exclus ; une date de week-end compte
    // comme le jour ouvré suivant, cf. pertWorkdayIndex).
    return pertWorkdayIndex(d) - pertWorkdayIndex(t0);
  }
  return (d.getTime() - t0.getTime()) / 86400000 / 7; // "sem"
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
    window.pertCriticalPathIds = new Set(); // plus de chemin critique a agreger
    pertPublishStatus({ ok: true, nbNodes: 0, nbCritical: 0, projectEnd: null });
    graph.setDirtyCanvas(true, true);
    return { ok: true, nbNodes: 0, nbCritical: 0 };
  }

  // — Cycle → on s'arrête, valeurs laissées à null —
  if (pertDetectCycle(nodes, succs)) {
    window.pertCriticalPathIds = new Set(); // pas de chemin critique sur un cycle
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
  // Packing a DEUX niveaux (evolution reorg). L'abscisse (∝ ES) reste inchangee
  // (coherence temporelle facon Gantt) ; seule l'affectation des couloirs verticaux
  // change. Regroupement PRIMAIRE = enchainement (composante connexe de liens : les
  // taches reliees entre elles restent ensemble → moins de liens qui se croisent),
  // puis packing COMPACT a l'interieur (une chaine directe reste sur une ligne, le
  // groupe n'etant qu'une preference secondaire). Le besoin "voir tout un groupe" est
  // couvert par le filtre. Les nœuds isoles (aucun lien) sont regroupes en bande finale.
  const compOf = pertConnectedComponents(rest, preds, succs);
  const efOf = {};
  placeable.forEach(n => { efOf[n.id] = n.ef; });
  pertPackLanesConnected(rest, restTop, rowH, xOf, compOf, preds, efOf);

  // #15 Les Labels n'ont pas de ES → ils ne sont pas places par le layout et
  // peuvent se retrouver sous une activite/jalon repositionne. On reloge ceux qui
  // chevauchent un nœud place, dans une bande libre sous le graphe.
  pertRelocateOverlappingLabels(graph, placeable);

  graph.setDirtyCanvas(true, true);
}

// Reorganisation "axe temps seul" (2e variante, demande utilisateur) : on ne
// deplace les nœuds QUE sur l'abscisse (le temps), l'ordonnee (pos[1]) reste celle
// choisie manuellement par l'utilisateur, quels que soient les chevauchements.
// Contrairement a pertAutoLayout, on n'applique PAS le decalage rang × gap : c'est
// un X PUR ∝ ES (decision utilisateur) → deux taches de meme ES se retrouvent a la
// meme abscisse, et les lignes horizontales voulues par l'utilisateur restent
// lisibles. Aucun packing par couloir, aucune relocalisation de Label.
// Abscisse temporelle d'un nœud, au sens « ou l'utilisateur attend ce nœud sur l'axe
// du temps ». Pour un Jalon porteur d'une DATE CIBLE, c'est cette cible qui fait foi
// (l'utilisateur raisonne sur l'engagement pris, pas sur la date au plus tot calculee,
// qui peut etre bien anterieure) ; pour tout autre nœud, l'ES (a defaut l'EF).
// Renvoie null si le nœud n'a aucune position temporelle (Label...).
// Utilise par la reorganisation « axe temps seul » ET par le classement chronologique
// des jalons dans la fenetre de synthese → une seule regle, deux usages coherents.
function pertTimeAxisOffset(node) {
  if (!node) return null;
  if (node.type === "pert/milestone" && node.properties && node.properties.due_date) {
    const off = pertDateToOffset(node.properties.due_date);
    if (off !== null) return Math.max(0, off); // cible anterieure a T0 → plancher T0
  }
  if (node.es != null) return node.es;
  if (node.ef != null) return node.ef;
  return null;
}

function pertAutoLayoutTimeOnly() {
  const graph = window.pertGraph;
  if (!graph) return;

  // ES a jour avant de recaler l'abscisse
  pertRecalc();

  const { nodes } = pertBuildAdjacency(graph);
  const placeable = nodes.map(n => ({ node: n, off: pertTimeAxisOffset(n) }))
                         .filter(e => e.off !== null);
  if (!placeable.length) return;

  placeable.forEach(e => {
    // X pur ∝ offset temps : pas de rang × gap (l'ordonnee manuelle porte la lisibilite)
    e.node.pos[0] = PERT_LAYOUT_MARGIN_X + e.off * PERT_PX_PER_UNIT;
    // pos[1] volontairement inchange (on ne touche pas a l'axe des ordonnees)
  });

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

// Composantes faiblement connexes (liens traites comme NON orientes) restreintes a
// la liste fournie : deux nœuds relies par une chaine de liens (dans un sens ou
// l'autre) appartiennent au meme enchainement. Retourne un objet id → identifiant de
// composante (entier). Un nœud sans lien (au sein de la liste) forme sa propre
// composante de taille 1. preds/succs sont les adjacences globales du graphe → on
// restreint les voisins a la liste (via inSet) pour ne pas relier deux enchainements
// qui ne convergent que par un jalon de sortie (place dans sa bande a part).
function pertConnectedComponents(list, preds, succs) {
  const inSet = new Set(list.map(n => n.id));
  const comp = {};
  let next = 0;
  for (const seed of list) {
    if (comp[seed.id] !== undefined) continue;
    comp[seed.id] = next;
    const stack = [seed.id];
    while (stack.length) {
      const id = stack.pop();
      const neigh = preds[id].concat(succs[id]);
      for (const m of neigh) {
        if (inSet.has(m) && comp[m] === undefined) { comp[m] = next; stack.push(m); }
      }
    }
    next++;
  }
  return comp;
}

// Packing par couloirs A DEUX NIVEAUX. Niveau 1 = enchainement (composante connexe
// compOf) : chaque enchainement occupe une bande verticale contigue, de sorte que
// les taches reliees entre elles restent groupees (moins de liens croises). Niveau 2
// (a l'interieur de chaque bande) = packing COMPACT (pertPackLanesCompact) qui
// privilegie la compacite : une tache en enchainement direct reste sur le couloir de
// son predecesseur → une chaine lineaire tient sur une seule ligne (pas de zigzag),
// le groupe n'etant qu'une preference secondaire (departage entre couloirs deja
// libres, jamais un couloir en plus). Les nœuds isoles (composante de taille 1, aucun
// lien) sont regroupes dans une bande finale unique (aucun lien → aucun croisement)
// pour eviter d'eparpiller un couloir par nœud isole. L'abscisse (xOf, ∝ ES) n'est
// jamais modifiee → calage temporel facon Gantt preserve ; l'enchainement ne joue que
// sur la dimension verticale. Renvoie le nombre total de couloirs occupes.
function pertPackLanesConnected(list, topY, rowH, xOf, compOf, preds, efOf) {
  if (!list.length) return 0;

  const size = {};
  for (const n of list) size[compOf[n.id]] = (size[compOf[n.id]] || 0) + 1;

  const comps = new Map(); // composantes multi-nœuds : id → nœuds
  const singles = [];      // nœuds isoles (composante de taille 1)
  for (const n of list) {
    const c = compOf[n.id];
    if (size[c] <= 1) { singles.push(n); continue; }
    if (!comps.has(c)) comps.set(c, []);
    comps.get(c).push(n);
  }

  // Ordre des bandes : ES min croissant (lecture dans le sens du temps), puis taille
  // decroissante et id pour un rendu stable ; la bande des isoles vient en dernier.
  const minX = arr => arr.reduce((m, n) => Math.min(m, xOf[n.id]), Infinity);
  const keys = Array.from(comps.keys()).sort((a, b) =>
    (minX(comps.get(a)) - minX(comps.get(b))) ||
    (comps.get(b).length - comps.get(a).length) || (a - b));

  let laneTop = topY;
  for (const c of keys) {
    laneTop += pertPackLanesCompact(comps.get(c), laneTop, rowH, xOf, preds, efOf) * rowH;
  }
  if (singles.length) {
    laneTop += pertPackLanesCompact(singles, laneTop, rowH, xOf, preds, efOf) * rowH;
  }
  return Math.round((laneTop - topY) / rowH);
}

// Packing par couloirs COMPACT (niveau 2, appele par enchainement). Objectif :
// minimiser la surface de travail et eviter les zigzags → une chaine directe reste
// sur une seule ligne. Les taches sont posees dans l'ordre des ES (donc un
// predecesseur est traite avant ses successeurs) ; pour chaque tache on choisit son
// couloir dans cet ordre de preference, sans JAMAIS ouvrir un couloir tant qu'il en
// reste un de libre (→ nombre de couloirs = concurrence temporelle maximale, optimal) :
//   1) le couloir du predecesseur CONTRAIGNANT (EF max) s'il est libre → la chaine
//      principale reste rectiligne (regle demandee : "enchainement direct → meme
//      couloir si pas en concurrence") ;
//   2) sinon, parmi les couloirs libres, un du MEME groupe (cohesion visuelle a cout
//      nul en compacite — on ne fait que choisir lequel des couloirs deja libres) ;
//   3) sinon, le premier couloir libre (compacite) ;
//   4) sinon seulement, un nouveau couloir.
// L'abscisse (xOf, ∝ ES) n'est jamais modifiee. preds = adjacence globale (filtree a
// la liste) ; efOf = { id: ef } pour reperer le predecesseur contraignant. Renvoie le
// nombre TOTAL de couloirs occupes (extent vertical), pour l'empilement des bandes.
function pertPackLanesCompact(list, topY, rowH, xOf, preds, efOf) {
  if (!list.length) return 0;

  // Tri par abscisse (ES) puis groupe puis id : les predecesseurs (ES plus petit) sont
  // traites avant leurs successeurs ; le tri par groupe rapproche les taches de meme
  // groupe quand elles sont en concurrence (aucun couloir partageable → couloirs
  // adjacents). id en dernier pour un rendu stable.
  list.sort((a, b) =>
    (xOf[a.id] - xOf[b.id]) ||
    pertGroupKey(a).localeCompare(pertGroupKey(b), "fr") ||
    (a.id - b.id));

  const idSet = new Set(list.map(n => n.id));
  const lanes = [];   // { right, group } par couloir
  const laneOf = {};  // id -> index de couloir

  for (const n of list) {
    const x = xOf[n.id];
    const free = i => x >= lanes[i].right + PERT_LAYOUT_GAP_X;
    let lane = -1;

    // 1) Compacite : rester dans le couloir du predecesseur contraignant (EF max) libre.
    let best = null;
    for (const p of preds[n.id]) {
      if (!idSet.has(p)) continue;
      const pl = laneOf[p];
      if (pl === undefined || !free(pl)) continue;
      if (best === null || efOf[p] > best.ef) best = { lane: pl, ef: efOf[p] };
    }
    if (best) lane = best.lane;

    // 2) Affinite de groupe : parmi les couloirs libres, en preferer un du meme groupe.
    if (lane === -1) {
      const g = pertGroupKey(n);
      for (let i = 0; i < lanes.length; i++) {
        if (free(i) && lanes[i].group === g) { lane = i; break; }
      }
    }

    // 3) N'importe quel couloir libre (le plus haut = compacite).
    if (lane === -1) {
      for (let i = 0; i < lanes.length; i++) { if (free(i)) { lane = i; break; } }
    }

    // 4) Nouveau couloir.
    if (lane === -1) { lane = lanes.length; lanes.push({ right: 0, group: "" }); }

    n.pos[0] = x;
    n.pos[1] = topY + lane * rowH;
    lanes[lane].right = x + n.size[0];
    lanes[lane].group = pertGroupKey(n); // le couloir adopte le groupe de sa derniere tache
    laneOf[n.id] = lane;
  }
  return lanes.length;
}

// ─── #7 Tracé du chemin critique (coloration des connexions) ─────────────────────
//
// Deux modes selon la presence d'une selection (targetId) :
//   - SANS selection : LE chemin critique du projet = chemin de marge MINIMALE
//     (nœuds is_critical). On colore les liens contraignants entre nœuds critiques.
//   - AVEC selection : chemin CONTRAIGNANT passant par le nœud selectionne — on
//     remonte les predecesseurs contraignants (EF cale le ES) jusqu'a T0 et on
//     descend les successeurs contraints jusqu'au terminal (#26).
// Dans les deux cas, l'ensemble des nœuds du chemin mis en evidence est memorise
// dans window.pertCriticalPathIds → la barre d'etat (cout + nombre de TACHES) reflete
// exactement le trace rouge affiche (S8.5, correctif d'incoherence cout/chemin). Les
// autres liens repassent au gris.

function pertHighlightCriticalPath(targetId) {
  const graph = window.pertGraph;
  window.pertCriticalPathIds = new Set(); // nœuds du chemin actuellement mis en evidence
  if (!graph) return;

  // Reinitialiser toutes les couleurs de lien (retour au gris par defaut)
  for (const id in graph.links) {
    if (graph.links[id]) graph.links[id].color = null;
  }

  const { nodes, preds, succs } = pertBuildAdjacency(graph);
  if (!nodes.length) { if (window.updateStatus) window.updateStatus(); return; }
  const byId = {};
  nodes.forEach(n => { byId[n.id] = n; });

  // Nœud selectionne (s'il est calcule), sinon mode "chemin critique par defaut".
  const selected = (targetId != null && byId[targetId] && byId[targetId].ef !== null)
    ? byId[targetId] : null;

  const pathIds = new Set();

  if (!selected) {
    // — SANS selection : chemin de marge minimale (is_critical). On memorise tous les
    //   nœuds critiques et on colore les liens contraignants entre eux (gere aussi les
    //   branches paralleles a marge minimale).
    for (const n of nodes) if (n.is_critical) pathIds.add(n.id);
    for (const n of nodes) {
      if (!n.is_critical || n.es === null) continue;
      for (const pid of preds[n.id]) {
        const p = byId[pid];
        if (p && p.is_critical && p.ef !== null && Math.abs(p.ef - n.es) < PERT_EPS) {
          pertColorLink(graph, p.id, n.id, "#cc0000");
        }
      }
    }
  } else {
    // — AVEC selection : chemin contraignant passant par le nœud selectionne.
    const target = selected;
    pathIds.add(target.id);

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
      pathIds.add(binding.id);
      current = binding;
    }

    // Descente vers le nœud terminal (cible → fin de projet, vers l'aval) — #26.
    // Symetrique de la remontee : sans elle, selectionner un nœud intermediaire
    // laissait le ou les liens en aval (jusqu'au jalon de fin) en gris, donc le
    // "dernier lien" du chemin critique n'etait pas colore. On suit les successeurs
    // que le nœud courant contraint (son EF cale le ES du successeur), en preferant
    // les successeurs critiques, jusqu'a un nœud terminal.
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
      pathIds.add(binding.id);
      current = binding;
    }
  }

  window.pertCriticalPathIds = pathIds;
  graph.setDirtyCanvas(true, true);
  // Rafraichit immediatement les agregats de cout/chemin critique (la barre d'etat
  // suit la selection sans attendre le tick periodique de updateStatus).
  if (window.updateStatus) window.updateStatus();
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
  // Le nombre de tâches du chemin critique (conscient de la sélection) est affiché
  // dans #status-cost par updateStatus ; ici on garde la fin de projet (invariante).
  let txt;
  if (res.projectEnd !== null && res.projectEnd !== undefined) {
    const unit = (window.pertMeta && window.pertMeta.unit) || "j";
    txt = "Fin projet : " + res.projectEnd + " " + unit;
    const d = pertOffsetToDate(res.projectEnd);
    if (d) txt += " (" + pertFormatDate(d) + ")";
  } else {
    txt = "Projet non daté";
  }
  el.textContent = txt;
}

// ─── Estimation de coût (Session 8.5) ───────────────────────────────────────────
//
// Cout d'une Activite = (duree convertie en heures) × ETP × taux horaire moyen.
// La conversion duree→heures depend de l'unite courante (meta.unit) :
//   - jour    : duree × heures_par_jour
//   - semaine : duree × 5 × heures_par_jour   (semaine = 5 jours ouvres)
//   - mois    : duree × heures_par_mois        (parametre independant, non derive du jour)
// Les parametres (heures/mois, heures/jour, taux) sont dans meta, modifiables dans le
// dialogue Parametres. pertActivityCost renvoie des EUROS ; l'affichage convertit en k€.
// Les Jalons et Labels n'ont pas de cout (pas de duree/ETP).

const PERT_DEFAULT_HOURS_MONTH = 135;  // defaut entreprise
const PERT_DEFAULT_HOURS_DAY   = 8;    // semaine = 5 × 8 = 40 h
const PERT_DEFAULT_RATE        = 136;  // taux horaire moyen charge (€/h)

function pertDurationToHours(duration, unit, meta) {
  const hpm = (meta && meta.hours_per_month != null) ? meta.hours_per_month : PERT_DEFAULT_HOURS_MONTH;
  const hpd = (meta && meta.hours_per_day   != null) ? meta.hours_per_day   : PERT_DEFAULT_HOURS_DAY;
  if (unit === "mois") return duration * hpm;
  if (unit === "sem")  return duration * 5 * hpd;
  return duration * hpd; // "j" (jours) par defaut
}

// Cout estime d'une Activite en euros (0 pour tout autre type de nœud).
function pertActivityCost(node) {
  if (!node || node.type !== "pert/activity" || !node.properties) return 0;
  const meta = window.pertMeta || {};
  const dur = parseFloat(node.properties.duration) || 0;
  const etpRaw = parseFloat(node.properties.etp);
  const etp = isNaN(etpRaw) ? 0 : etpRaw;
  const rate = (meta.hourly_rate != null) ? meta.hourly_rate : PERT_DEFAULT_RATE;
  const hours = pertDurationToHours(dur, meta.unit || "j", meta);
  return hours * etp * rate;
}

// Formatage d'un montant (euros) en k€, notation FR (1 decimale max). Ex. "137,7 k€".
function pertFormatCost(euros) {
  const k = (euros || 0) / 1000;
  return k.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " k€";
}

// Exposition globale (appelée depuis ui.js sur les événements de graphe)
window.pertActivityCost = pertActivityCost;
window.pertFormatCost = pertFormatCost;
window.pertRecalc = pertRecalc;
window.pertOffsetToDate = pertOffsetToDate;
window.pertDateToOffset = pertDateToOffset;
window.pertAutoLayout = pertAutoLayout;
window.pertHighlightCriticalPath = pertHighlightCriticalPath;
