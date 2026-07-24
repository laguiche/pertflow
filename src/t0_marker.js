// ─── Repère T0 et zone d'anticipation ───────────────────────────────────────────
//
// T0 est la référence CONTRACTUELLE du projet (« livraison à T0 + X ») : c'est le
// point d'origine sur lequel toute l'équipe s'accorde. Depuis que le moteur autorise
// les travaux ANTICIPÉS (offsets négatifs, cf. le bloc « Anticipation » de
// pert_engine.js), une partie du planning peut se trouver À GAUCHE de T0 — et rien,
// visuellement, ne distinguait cette zone du reste du graphe.
//
// On dessine donc deux éléments, dans DEUX couches différentes :
//   - une bande hachurée couvrant tout ce qui se trouve avant T0, EN FOND (derrière
//     les nœuds et les liens) — affichée uniquement lorsqu'il y a effectivement de
//     l'anticipation, donc aucun bruit visuel sur un planning classique ;
//   - un trait vertical à l'abscisse de T0, légendé « T0 » + la date, AU PREMIER PLAN.
//     Il doit passer PAR-DESSUS les nœuds : dessiné en fond, il disparaissait derrière
//     la première tâche qui chevauchait T0 — c'est-à-dire exactement le cas courant.
//
// L'abscisse de T0 est DÉDUITE des nœuds placés (pertT0OriginX) : rien de nouveau à
// sérialiser, et le repère suit une translation d'ensemble du graphe. Même réserve
// que la lecture chronologique des abscisses en général : après déplacement manuel
// d'un nœud isolé vers la gauche, le repère peut s'écarter du placement théorique.
//
// Le rendu passe par LGraphCanvas.onDrawBackground, appelé dans le repère GRAPHE
// (transformation zoom/pan déjà appliquée) — mêmes coordonnées que node.pos.
// Surcharge d'INSTANCE, sans patcher la lib (même principe que le routage des liens).

const PERT_T0_PAD_Y = 40;    // débord vertical du trait au-dessus/dessous du graphe
const PERT_T0_ZONE_PAD = 24; // marge de la bande hachurée autour des nœuds anticipés

// Emprise verticale des nœuds calculés + abscisse minimale (bord gauche du graphe).
// Renvoie null si aucun nœud calculé.
function pertGraphExtent(graph) {
  let top = Infinity, bottom = -Infinity, left = Infinity;
  for (const n of graph._nodes) {
    // Les Labels sont exclus : librement positionnés, ils étireraient l'emprise.
    if (n.type !== "pert/activity" && n.type !== "pert/milestone") continue;
    top = Math.min(top, n.pos[1]);
    bottom = Math.max(bottom, n.pos[1] + n.size[1]);
    left = Math.min(left, n.pos[0]);
  }
  if (top === Infinity) return null;
  return { top, bottom, left };
}

// Y a-t-il au moins un nœud dont l'offset temporel est antérieur à T0 ?
function pertHasAnticipation(graph) {
  for (const n of graph._nodes) {
    if (n.type !== "pert/activity" && n.type !== "pert/milestone") continue;
    if (n.es !== null && n.es !== undefined && n.es < 0) return true;
    // Jalon entrant daté avant T0 : son ES porte déjà la valeur négative, mais on
    // couvre aussi le cas d'un jalon non recalculé (T0 modifié à la volée).
    const off = window.pertTimeAxisOffset ? pertTimeAxisOffset(n) : null;
    if (off !== null && off < 0) return true;
  }
  return false;
}

// Géométrie commune aux deux couches : { originX, ext } ou null si rien à dessiner.
function pertT0Geometry(graph) {
  if (!graph || !graph._nodes || !graph._nodes.length) return null;
  const originX = window.pertT0OriginX ? pertT0OriginX(graph) : null;
  if (originX === null) return null;
  const ext = pertGraphExtent(graph);
  if (!ext) return null;
  return { originX, ext };
}

// COUCHE DE FOND : bande hachurée « travaux anticipés », derrière nœuds et liens.
// Ne dessine rien si le planning ne comporte aucune anticipation.
function pertDrawT0Zone(ctx, graph) {
  const geo = pertT0Geometry(graph);
  if (!geo) return;
  const { originX, ext } = geo;
  if (!pertHasAnticipation(graph) || ext.left >= originX) return;

  const x0 = ext.left - PERT_T0_ZONE_PAD;
  const w = originX - x0;
  const y0 = ext.top - PERT_T0_ZONE_PAD;
  const h = (ext.bottom + PERT_T0_ZONE_PAD) - y0;

  ctx.save();
  ctx.fillStyle = "rgba(230, 170, 60, 0.08)";  // ambre dilué, lisible sur fond sombre
  ctx.fillRect(x0, y0, w, h);

  // Hachures diagonales, découpées à la zone pour ne pas déborder.
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.strokeStyle = "rgba(230, 170, 60, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = 14;
  for (let x = x0 - h; x < x0 + w; x += step) {
    ctx.moveTo(x, y0 + h);
    ctx.lineTo(x + h, y0);
  }
  ctx.stroke();
  ctx.restore();
}

// COUCHE DE PREMIER PLAN : trait vertical de T0 + légende, PAR-DESSUS les nœuds.
function pertDrawT0Line(ctx, graph) {
  const geo = pertT0Geometry(graph);
  if (!geo) return;
  // Repère affiché UNIQUEMENT en présence d'anticipation — même règle que la bande.
  // Deux raisons : (1) zéro changement et zéro bruit pour les plannings classiques ;
  // (2) sur un graphe placé À LA MAIN, l'abscisse n'a aucune signification temporelle
  // et un trait légendé « T0 » y serait trompeur. Des qu'il y a des travaux anticipés,
  // l'utilisateur raisonne sur l'axe du temps (et a réorganisé) : le repère fait sens.
  if (!pertHasAnticipation(graph)) return;
  const { originX, ext } = geo;
  const yTop = ext.top - PERT_T0_PAD_Y;
  const yBottom = ext.bottom + PERT_T0_PAD_Y;

  ctx.save();
  ctx.strokeStyle = "rgba(120, 200, 255, 0.85)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(originX, yTop);
  ctx.lineTo(originX, yBottom);
  ctx.stroke();
  ctx.setLineDash([]);

  // Légende « T0 » + date, au-dessus du trait, sur une pastille sombre pour rester
  // lisible même si un nœud passe juste derrière.
  const meta = window.pertMeta || {};
  let txt = "T0";
  if (meta.t0) {
    const d = pertOffsetToDate(0);
    if (d && window.pertFormatDate) txt += " · " + pertFormatDate(d);
  }
  ctx.font = "bold 13px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // La pastille est posee DANS la marge haute (yTop + 2) et non au-dessus : placee
  // au-dessus, elle sortait du canvas des que le graphe touchait le bord superieur.
  const wTxt = ctx.measureText(txt).width + 14;
  ctx.fillStyle = "rgba(20, 24, 40, 0.85)";
  ctx.fillRect(originX - wTxt / 2, yTop + 2, wTxt, 20);
  ctx.fillStyle = "rgba(150, 215, 255, 1)";
  ctx.fillText(txt, originX, yTop + 12);

  // Rappel du sens de lecture côté anticipation, sous la légende.
  if (pertHasAnticipation(graph) && ext.left < originX) {
    ctx.font = "italic 12px Arial";
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(230, 170, 60, 0.95)";
    ctx.fillText("← travaux anticipés", originX - 10, yTop + 30);
  }
  ctx.restore();
}

// Compatibilite / usage direct (tests) : dessine les deux couches d'un coup.
function pertDrawT0Marker(ctx, graph) {
  pertDrawT0Zone(ctx, graph);
  pertDrawT0Line(ctx, graph);
}

// Installe le repère sur une instance de LGraphCanvas (appelé à l'init de l'app).
// Chaîne les handlers déjà en place plutôt que de les écraser.
function pertInstallT0Marker(lgCanvas) {
  const prevBg = lgCanvas.onDrawBackground;
  lgCanvas.onDrawBackground = function (ctx, area) {
    if (prevBg) prevBg.call(this, ctx, area);
    try { pertDrawT0Zone(ctx, this.graph); }
    catch (e) { /* un repère décoratif ne doit jamais casser le rendu du graphe */ }
  };
  const prevFg = lgCanvas.onDrawForeground;
  lgCanvas.onDrawForeground = function (ctx, area) {
    if (prevFg) prevFg.call(this, ctx, area);
    try { pertDrawT0Line(ctx, this.graph); }
    catch (e) { /* idem : jamais bloquant */ }
  };
}

window.pertInstallT0Marker = pertInstallT0Marker;
window.pertDrawT0Marker = pertDrawT0Marker;
window.pertDrawT0Zone = pertDrawT0Zone;
window.pertDrawT0Line = pertDrawT0Line;
window.pertHasAnticipation = pertHasAnticipation;
