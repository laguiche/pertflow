// ─── Rendu & routage des liens — Session 10 ─────────────────────────────────────
//
// #46 (styles de liens) + #19 (évitement des nœuds), pilotés par `meta.link_mode` :
//   "courbe" (défaut) → spline native LiteGraph (comportement historique)
//   "droit"           → ligne quasi droite native (STRAIGHT_LINK)
//   "coude"           → routage ORTHOGONAL custom (angles droits) qui CONTOURNE les
//                       activités intercalées (best-effort)
//
// On surcharge `renderLink` sur l'INSTANCE LGraphCanvas (comme les menus contextuels,
// sans patcher la lib). Le mode courbe/droit délègue au rendu natif ; seul le mode
// coudé, et uniquement pour un lien RÉEL, passe par notre tracé. Le lien élastique de
// création (objet lien `null`) reste toujours une simple courbe native → visée fluide.
//
// Perf (#19) : élagage spatial (on ne teste comme obstacle qu'un nœud dont la boîte
// chevauche la zone du lien) + dégradation automatique au-delà de PERT_LINK_AVOID_MAX
// nœuds (routage orthogonal simple, sans test de collision) → aucun lag sur gros PERT.
// Le placement manuel n'est JAMAIS modifié : le routage est purement cosmétique.

const PERT_LINK_STUB = 14;         // sortie horizontale depuis les slots
const PERT_LINK_MARGIN = 8;        // marge de contournement autour des nœuds
const PERT_LINK_AVOID_MAX = 300;   // au-dela : pas de test de collision (perf)

function pertLinkMode() {
  return (window.pertMeta && window.pertMeta.link_mode) || "courbe";
}

// Segment AXIS-ALIGNED (horizontal ou vertical) vs rectangle {x,y,w,h}.
function pertSegHitsRect(x1, y1, x2, y2, r) {
  if (x1 === x2) { // vertical
    const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
    return x1 >= r.x && x1 <= r.x + r.w && hi >= r.y && lo <= r.y + r.h;
  }
  // horizontal
  const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
  return y1 >= r.y && y1 <= r.y + r.h && hi >= r.x && lo <= r.x + r.w;
}

// Une polyligne (liste de points) touche-t-elle un des obstacles ?
function pertPathHits(pts, obstacles) {
  for (let i = 1; i < pts.length; i++) {
    const x1 = pts[i - 1][0], y1 = pts[i - 1][1], x2 = pts[i][0], y2 = pts[i][1];
    for (const r of obstacles) {
      if (pertSegHitsRect(x1, y1, x2, y2, r)) return true;
    }
  }
  return false;
}

// Route « Z » orthogonale de base : sortie, canal vertical a x=mx, entree.
function pertZRoute(a, b, mx) {
  const ax = a[0] + PERT_LINK_STUB, bx = b[0] - PERT_LINK_STUB;
  return [a, [ax, a[1]], [mx, a[1]], [mx, b[1]], [bx, b[1]], b];
}

// Calcule une polyligne orthogonale de a vers b contournant au mieux les obstacles.
// obstacles = null (mode dégradé) ou [] → route « Z » directe sans test.
function pertRouteOrthogonal(a, b, obstacles) {
  const ax = a[0] + PERT_LINK_STUB, bx = b[0] - PERT_LINK_STUB;
  const midX = (ax + bx) / 2;
  if (!obstacles || obstacles.length === 0) return pertZRoute(a, b, midX);

  // 1) Canal vertical : essaie le milieu, puis juste a cote de chaque obstacle.
  const cand = [midX];
  for (const o of obstacles) { cand.push(o.x - PERT_LINK_MARGIN, o.x + o.w + PERT_LINK_MARGIN); }
  for (const mx of cand) {
    const path = pertZRoute(a, b, mx);
    if (!pertPathHits(path, obstacles)) return path;
  }

  // 2) Bande horizontale : contourne par-dessus / par-dessous tous les obstacles
  //    presents dans l'empan horizontal du lien.
  const xlo = Math.min(ax, bx), xhi = Math.max(ax, bx);
  let top = Infinity, bot = -Infinity;
  for (const o of obstacles) {
    if (o.x <= xhi && o.x + o.w >= xlo) { top = Math.min(top, o.y); bot = Math.max(bot, o.y + o.h); }
  }
  if (isFinite(top)) {
    const lanes = [bot + PERT_LINK_MARGIN + 12, top - PERT_LINK_MARGIN - 12];
    for (const yLane of lanes) {
      const path = [a, [ax, a[1]], [ax, yLane], [bx, yLane], [bx, b[1]], b];
      if (!pertPathHits(path, obstacles)) return path;
    }
  }

  // 3) Echec du contournement → Z simple (best-effort, on accepte le recouvrement).
  return pertZRoute(a, b, midX);
}

// Rectangles-obstacles pertinents pour un lien (tous les nœuds sauf ses 2 extremites,
// elagues a la zone du lien). Renvoie null si le graphe est trop gros (perf → pas de
// test de collision, routage orthogonal simple).
function pertCollectObstacles(link, a, b) {
  const g = window.pertGraph;
  const nodes = (g && g._nodes) ? g._nodes : [];
  if (nodes.length > PERT_LINK_AVOID_MAX) return null;
  const xlo = Math.min(a[0], b[0]) - 40, xhi = Math.max(a[0], b[0]) + 40;
  const ylo = Math.min(a[1], b[1]) - 40, yhi = Math.max(a[1], b[1]) + 40;
  const out = [];
  const bb = new Float32Array(4);
  for (const n of nodes) {
    if (n.id === link.origin_id || n.id === link.target_id) continue;
    n.getBounding(bb);
    const r = { x: bb[0], y: bb[1], w: bb[2], h: bb[3] };
    if (r.x > xhi || r.x + r.w < xlo || r.y > yhi || r.y + r.h < ylo) continue; // elagage
    out.push(r);
  }
  return out;
}

// Trace un lien orthogonal (mode coudé) : bordure + trait coloré + flèche, en
// reproduisant la resolution de couleur native (link.color / highlight / defaut).
function pertRenderOrthogonalLink(canvas, ctx, a, b, link, skip_border, color) {
  if (!color && link) color = link.color || LGraphCanvas.link_type_colors[link.type];
  if (!color) color = canvas.default_link_color;
  if (link && canvas.highlighted_links[link.id]) color = "#FFF";

  const obstacles = pertCollectObstacles(link, a, b);
  const pts = pertRouteOrthogonal(a, b, obstacles);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);

  if (canvas.render_connections_border && canvas.ds.scale > 0.6 && !skip_border) {
    ctx.lineWidth = canvas.connections_width + 4;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.stroke();
  }
  ctx.lineWidth = canvas.connections_width;
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.stroke();

  // Centre du lien (ancre pour la selection / le menu clic droit).
  const mid = pts[Math.floor(pts.length / 2)];
  if (link && link._pos) { link._pos[0] = mid[0]; link._pos[1] = mid[1]; }

  // Fleche a l'entree de la cible, orientee selon le dernier segment.
  if (canvas.ds.scale >= 0.6 && canvas.render_connection_arrows !== false) {
    const p2 = pts[pts.length - 1], p1 = pts[pts.length - 2];
    const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    const hx = p2[0] - Math.cos(ang) * 8, hy = p2[1] - Math.sin(ang) * 8;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(-6, -4);
    ctx.lineTo(3, 0);
    ctx.lineTo(-6, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// Installe la surcharge de renderLink sur l'instance (idempotent).
function pertInstallLinkRouting(canvas) {
  if (!canvas || canvas.__pertLinkPatched) return;
  const native = canvas.renderLink.bind(canvas);
  canvas.__pertNativeRenderLink = native;
  canvas.renderLink = function (ctx, a, b, link, skip_border, flow, color, start_dir, end_dir, num_sublines) {
    // Mode coudé + lien REEL → tracé orthogonal custom. Le lien elastique de creation
    // (link null) et les autres modes → rendu natif (courbe/droit).
    if (pertLinkMode() === "coude" && link) {
      this.visible_links.push(link); // le natif le fait aussi
      pertRenderOrthogonalLink(this, ctx, a, b, link, skip_border, color);
      return;
    }
    return native(ctx, a, b, link, skip_border, flow, color, start_dir, end_dir, num_sublines);
  };
  canvas.__pertLinkPatched = true;
}

// Applique le mode courant : mode natif du canvas (pour courbe/droit et le lien
// elastique) + redessin. A appeler a l'init, apres saveSettings et apres chargement.
function pertApplyLinkMode() {
  const c = window.pertCanvas;
  if (!c) return;
  // Le lien elastique et les modes non-coude passent par le rendu natif :
  //   droit → STRAIGHT_LINK ; courbe/coude → SPLINE_LINK (jolie courbe elastique).
  c.links_render_mode = (pertLinkMode() === "droit") ? LiteGraph.STRAIGHT_LINK : LiteGraph.SPLINE_LINK;
  c.setDirty(true, true); // LGraphCanvas : setDirty (setDirtyCanvas est sur le graphe/nœud)
}

window.pertLinkMode = pertLinkMode;
window.pertRouteOrthogonal = pertRouteOrthogonal;
window.pertInstallLinkRouting = pertInstallLinkRouting;
window.pertApplyLinkMode = pertApplyLinkMode;
