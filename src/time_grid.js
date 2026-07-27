// ─── Trame temporelle de fond (repères de périodes calendaires) ─────────────────
//
// Sur un planning réorganisé, l'abscisse porte le temps — mais rien ne permettait de
// situer une tâche dans le calendrier sans lire ses dates une par une. La trame donne
// ce repère : des bandes alternées très discrètes délimitant la période « large », et
// de fins traits pour la subdivision, selon l'unité du projet :
//
//   unité « mois »    → bandes = ANNÉES,   subdivisions = TRIMESTRES
//   unité « sem »     → bandes = MOIS,     subdivisions = SEMAINES
//   unité « j »       → bandes = SEMAINES, subdivisions = JOURS
//
// Optionnelle (case « Trame temporelle » des Paramètres, `meta.time_grid`, défaut
// désactivée) : aucun changement visuel pour qui n'en veut pas.
//
// DISCRÉTION — contrainte de conception. La trame ne doit jamais concurrencer la
// lecture du graphe ni le voile sombre du filtre. D'où trois précautions :
//   - elle est dessinée en COUCHE DE FOND (derrière nœuds et liens), comme la bande
//     d'anticipation, donc toujours dominée par ce qui compte ;
//   - ses alphas de base sont volontairement très bas (bandes 0.030, traits 0.055) —
//     assez pour délimiter, trop peu pour attirer l'œil. Ils sont MODULÉS par le
//     curseur « Intensité de la trame » des Paramètres (`meta.time_grid_intensity`,
//     défaut 1) : le premier retour utilisateur a été « pas assez visible », et le bon
//     réglage s'est révélé affaire de goût et d'écran plutôt que de valeur juste. Les
//     plafonds passés à pertTgAlpha garantissent qu'à fond, la trame reste un fond ;
//   - chaque niveau s'efface de lui-même quand sa largeur PROJETÉE À L'ÉCRAN devient
//     trop faible (même principe que la grille aimantée de ui.js) : en zoom arrière
//     sur un planning long, les subdivisions disparaissent avant de virer au gris uni.
//
// GÉOMÉTRIE — l'abscisse d'une date se déduit exactement comme le repère T0 :
// x = pertT0OriginX(graph) + offset × PERT_PX_PER_UNIT. Les bornes de période sont
// calculées en CALENDRIER (1er janvier, 1er du mois, lundi…) puis converties en offset
// par pertDateToOffset — jamais par un pas fixe en pixels. C'est ce qui rend la trame
// juste dans les trois unités, y compris en « j » où l'axe compte les jours OUVRÉS
// (une semaine calendaire y occupe 5 unités, pas 7) et en « mois » où les mois
// calendaires réels n'ont pas tous la même longueur.

const PERT_TG_BAND_ALPHA = 0.030;   // remplissage d'une bande sur deux
const PERT_TG_LINE_ALPHA = 0.055;   // fins traits de subdivision
const PERT_TG_TEXT_ALPHA = 0.34;    // libellé de période (année, mois, semaine)
const PERT_TG_MIN_PX_BAND = 26;     // largeur écran minimale d'une bande pour la dessiner
const PERT_TG_MIN_PX_SUB = 14;      // idem pour une subdivision
const PERT_TG_PAD_Y = 60;           // débord vertical au-dessus/dessous du graphe
// Taille du libellé de période (année, mois, semaine). Dessiné en coordonnées GRAPHE :
// il suit donc le zoom, comme le texte des nœuds. Volontairement grand — c'est un
// filigrane de repérage, pas une légende à lire de près.
const PERT_TG_LABEL_PX = 34;

const PERT_TG_MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin",
                        "juil.", "août", "sept.", "oct.", "nov.", "déc."];

// La trame est-elle demandée ? (case des Paramètres, sérialisée dans meta)
function pertTimeGridEnabled() {
  return !!(window.pertMeta && window.pertMeta.time_grid);
}

// Facteur d'intensité (curseur des Paramètres, `meta.time_grid_intensity`, défaut 1).
// La bonne valeur dépend de l'écran, de la luminosité de la pièce et du goût de chacun :
// aucun réglage codé en dur ne pouvait convenir à tout le monde — d'où le curseur.
// Borné à [0,2 ; 4] : la borne haute protège d'un .pert edité à la main qui rendrait le
// fond opaque, la borne basse d'une trame invisible qu'on croirait cassée.
function pertTimeGridIntensity() {
  const v = window.pertMeta ? window.pertMeta.time_grid_intensity : 1;
  const n = (typeof v === "number" && isFinite(v)) ? v : 1;
  return Math.max(0.2, Math.min(4, n));
}

// Alpha d'un élément de la trame, module par l'intensite choisie. Le plafond garde la
// trame en ARRIERE-plan quoi qu'il arrive : meme a fond, elle ne doit pas concurrencer
// les nœuds ni le voile du filtre.
function pertTgAlpha(base, plafond) {
  return Math.min(plafond, base * pertTimeGridIntensity());
}

// Découpage applicable à l'unité courante : quelles périodes pour les bandes, et
// lesquelles pour les subdivisions. `next` avance d'une période, `label` nomme la
// bande. Tout est calculé en dates calendaires : aucune hypothèse de longueur fixe.
function pertTimeGridScheme(unit) {
  if (unit === "mois") {
    return {
      band: {
        start: (d) => new Date(d.getFullYear(), 0, 1),
        next: (d) => new Date(d.getFullYear() + 1, 0, 1),
        label: (d) => String(d.getFullYear()),
      },
      sub: {
        start: (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1),
        next: (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 1),
      },
    };
  }
  if (unit === "sem") {
    return {
      band: {
        start: (d) => new Date(d.getFullYear(), d.getMonth(), 1),
        next: (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1),
        label: (d) => PERT_TG_MONTHS[d.getMonth()] + " " + d.getFullYear(),
      },
      sub: {
        // Lundi de la semaine courante (getDay : 0 = dimanche).
        start: (d) => pertTgMonday(d),
        next: (d) => pertTgAddDays(pertTgMonday(d), 7),
      },
    };
  }
  // unité « j » : bandes = semaines, subdivisions = jours.
  return {
    band: {
      start: (d) => pertTgMonday(d),
      next: (d) => pertTgAddDays(pertTgMonday(d), 7),
      label: (d) => "sem. " + pertTgWeekNumber(pertTgMonday(d)),
    },
    sub: {
      start: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()),
      next: (d) => pertTgAddDays(d, 1),
    },
  };
}

function pertTgAddDays(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

function pertTgMonday(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (r.getDay() + 6) % 7;   // 0 = lundi … 6 = dimanche
  r.setDate(r.getDate() - dow);
  return r;
}

// Numéro de semaine ISO 8601 (jeudi de la semaine → son année).
function pertTgWeekNumber(monday) {
  const thursday = pertTgAddDays(monday, 3);
  const jan1 = new Date(thursday.getFullYear(), 0, 1);
  return Math.floor((thursday - jan1) / 86400000 / 7) + 1;
}

// Date → "YYYY-MM-DD" en heure LOCALE. Indispensable : pertDateToOffset attend une
// chaîne, et toISOString() convertirait en UTC — soit un jour d'écart pour tout
// fuseau à l'est de Greenwich, donc une trame décalée d'une case en heure d'été.
function pertTgIso(d) {
  const p = (n) => (n < 10 ? "0" + n : String(n));
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// Abscisse (repère graphe) d'une date calendaire, via l'offset temporel du projet.
// Renvoie null si la conversion est impossible (T0 non défini, date hors plage).
function pertTgDateToX(date, originX) {
  if (typeof pertDateToOffset !== "function") return null;
  const off = pertDateToOffset(pertTgIso(date));
  if (off === null || off === undefined || isNaN(off)) return null;
  return originX + off * PERT_PX_PER_UNIT;
}

// Emprise du graphe à couvrir + abscisse de T0, ou null s'il n'y a rien à dessiner.
// On réutilise l'emprise verticale du repère T0 (mêmes nœuds, mêmes exclusions :
// les Labels, librement positionnés, n'étirent pas la zone).
function pertTimeGridGeometry(graph) {
  if (!graph || !graph._nodes || !graph._nodes.length) return null;
  if (typeof pertGraphExtent !== "function" || typeof pertT0OriginX !== "function") return null;
  const originX = pertT0OriginX(graph);
  if (originX === null) return null;
  const ext = pertGraphExtent(graph);
  if (!ext) return null;
  // Bord droit : le nœud le plus à droite (l'emprise du repère T0 ne le fournit pas).
  let right = -Infinity;
  for (const n of graph._nodes) {
    if (n.type !== "pert/activity" && n.type !== "pert/milestone") continue;
    right = Math.max(right, n.pos[0] + n.size[0]);
  }
  if (right === -Infinity) return null;
  return { originX, ext, right };
}

// COUCHE DE FOND : bandes alternées + subdivisions + libellés de période.
function pertDrawTimeGrid(ctx, graph) {
  if (!pertTimeGridEnabled()) return;
  const geo = pertTimeGridGeometry(graph);
  if (!geo) return;
  const { originX, ext, right } = geo;

  const unit = (window.pertMeta && window.pertMeta.unit) || "mois";
  const scheme = pertTimeGridScheme(unit);

  // Plage temporelle à couvrir, déduite des abscisses extrêmes du graphe (marge d'une
  // période de part et d'autre pour que la bande de bord soit complète).
  const xLeft = ext.left - PERT_PX_PER_UNIT;
  const xRight = right + PERT_PX_PER_UNIT;
  const offLeft = (xLeft - originX) / PERT_PX_PER_UNIT;
  const offRight = (xRight - originX) / PERT_PX_PER_UNIT;
  if (typeof pertOffsetToDate !== "function") return;
  const dLeft = pertOffsetToDate(Math.floor(offLeft));
  const dRight = pertOffsetToDate(Math.ceil(offRight));
  if (!dLeft || !dRight) return;

  const yTop = ext.top - PERT_TG_PAD_Y;
  const yBottom = ext.bottom + PERT_TG_PAD_Y;
  const h = yBottom - yTop;
  if (h <= 0) return;

  // Échelle écran : sert uniquement aux seuils de discrétion (on ne dessine pas un
  // niveau devenu illisible). `ds.scale` est le zoom courant du canvas LiteGraph.
  const scale = (window.pertCanvas && window.pertCanvas.ds && window.pertCanvas.ds.scale) || 1;

  ctx.save();

  // ── Bandes alternées (niveau large) ───────────────────────────────────────────
  // L'alternance est indexée sur le RANG ABSOLU de la période (année, mois, semaine)
  // et non sur un compteur local : le motif ne saute pas quand on déplace la vue.
  let cur = scheme.band.start(dLeft);
  let guard = 0;
  const bands = [];
  while (cur <= dRight && guard++ < 4000) {
    const nxt = scheme.band.next(cur);
    const x0 = pertTgDateToX(cur, originX);
    const x1 = pertTgDateToX(nxt, originX);
    if (x0 !== null && x1 !== null && x1 > x0) bands.push({ x0, x1, date: cur });
    cur = nxt;
  }
  const bandWidthPx = bands.length ? (bands[0].x1 - bands[0].x0) * scale : 0;
  if (bands.length && bandWidthPx >= PERT_TG_MIN_PX_BAND) {
    ctx.fillStyle = "rgba(126, 184, 247, " + pertTgAlpha(PERT_TG_BAND_ALPHA, 0.20) + ")";
    bands.forEach((b) => {
      if (pertTgBandParity(b.date, unit) === 0) return;   // une bande sur deux
      ctx.fillRect(b.x0, yTop, b.x1 - b.x0, h);
    });

    // Libellé de période, posé dans la marge haute. Il joue le rôle d'un FILIGRANE :
    // grand, pour se lire d'un coup d'œil et de loin sur un planning dézoomé, mais pâle,
    // pour ne pas concurrencer les nœuds (v0.18.1 — la taille précédente, 11 px, se
    // perdait complètement sur la largeur d'une bande d'un an).
    ctx.font = "bold " + PERT_TG_LABEL_PX + "px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(170, 210, 250, " + pertTgAlpha(PERT_TG_TEXT_ALPHA, 0.95) + ")";
    bands.forEach((b) => {
      const label = scheme.band.label(b.date);
      // N'entre pas dans la bande → on saute plutôt que de déborder sur la suivante.
      // Avec un libellé de cette taille, le cas devient courant sur les bandes étroites
      // (mois en unité « sem », semaines en unité « j ») : c'est voulu, mieux vaut pas
      // de repère qu'un repère illisible ou chevauchant.
      if (ctx.measureText(label).width + 12 > (b.x1 - b.x0)) return;
      ctx.fillText(label, b.x0 + 8, yTop + 2);
    });
  }

  // ── Subdivisions (fins traits verticaux) ──────────────────────────────────────
  let sub = scheme.sub.start(dLeft);
  guard = 0;
  const subXs = [];
  while (sub <= dRight && guard++ < 20000) {
    const x = pertTgDateToX(sub, originX);
    if (x !== null) subXs.push(x);
    sub = scheme.sub.next(sub);
  }
  let subStepPx = 0;
  if (subXs.length >= 2) subStepPx = (subXs[1] - subXs[0]) * scale;
  if (subXs.length >= 2 && subStepPx >= PERT_TG_MIN_PX_SUB) {
    ctx.strokeStyle = "rgba(126, 184, 247, " + pertTgAlpha(PERT_TG_LINE_ALPHA, 0.35) + ")";
    ctx.lineWidth = 1;
    ctx.beginPath();
    subXs.forEach((x) => { ctx.moveTo(x, yTop); ctx.lineTo(x, yBottom); });
    ctx.stroke();
  }

  ctx.restore();
}

// Parité de la bande, calculée sur un rang ABSOLU (et non sur l'ordre d'affichage) :
// année, mois depuis l'an 0, ou semaine depuis une origine fixe. Garantit que la même
// période garde la même teinte quel que soit le défilement ou le zoom.
function pertTgBandParity(date, unit) {
  if (unit === "mois") return date.getFullYear() % 2;
  if (unit === "sem") return (date.getFullYear() * 12 + date.getMonth()) % 2;
  return Math.floor(pertTgMonday(date).getTime() / 604800000) % 2;
}

// Installe la trame sur une instance de LGraphCanvas.
// ⚠️ CHAÎNE le handler existant (grille aimantée de ui.js, puis bande d'anticipation
// du repère T0) : un module qui AFFECTE onDrawBackground écrase silencieusement tous
// ceux installés avant lui — piège déjà rencontré avec pertInstallT0Marker.
function pertInstallTimeGrid(lgCanvas) {
  const prevBg = lgCanvas.onDrawBackground;
  lgCanvas.onDrawBackground = function (ctx, area) {
    if (prevBg) prevBg.call(this, ctx, area);
    try { pertDrawTimeGrid(ctx, this.graph); }
    catch (e) { /* une trame décorative ne doit jamais casser le rendu du graphe */ }
  };
}

window.pertInstallTimeGrid = pertInstallTimeGrid;
window.pertDrawTimeGrid = pertDrawTimeGrid;
window.pertTimeGridEnabled = pertTimeGridEnabled;
window.pertTimeGridScheme = pertTimeGridScheme;
window.pertTimeGridIntensity = pertTimeGridIntensity;
window.pertTgAlpha = pertTgAlpha;
