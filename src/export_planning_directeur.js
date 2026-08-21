// ─── Export « Planning directeur » (Excel) — v0.23 ──────────────────────────────
//
// Transpose le PERT sur le CANEVAS d'un planning directeur pluriannuel (cf. le
// modele fourni par l'utilisateur : en-tete annees / trimestres / initiales de mois,
// une colonne par mois, zebrage mensuel, pointilles au changement d'annee, panneaux
// figes, paysage). Ce n'est pas un tableau de chiffres : c'est un document de
// communication, celui qu'on projette en revue de projet.
//
// TROIS DECISIONS DE CADRAGE (utilisateur, 21/08/2026) — ne pas les defaire sans
// nouvel arbitrage, elles ont chacune une consequence sur tout le reste du module :
//
//  1. « On ne change pas les (x, y) des taches et jalons : on respecte
//     scrupuleusement l'agencement du PERT. » Aucun regroupement en voies, aucun
//     tri, aucun empilement recalcule. L'ORDONNEE d'une forme est celle du nœud sur
//     le canvas, a l'echelle pres. L'ABSCISSE, elle, vient des DATES (ES → EF) et
//     non du x du canvas : l'axe horizontal du canevas est calendaire, une barre
//     doit tomber sous son mois — sinon l'en-tete mentirait. Le x du canvas ne sert
//     donc qu'aux nœuds Label, qui n'ont aucune date (cf. pertPdLabelXFit).
//
//  2. Les DEUX COLONNES DE GAUCHE sont laissees VIDES, a remplir par l'utilisateur
//     apres l'export. PertFlow n'a qu'un seul niveau de regroupement (le groupe) la
//     ou le canevas en a deux (« Poste » puis voie) ; plutot que d'inventer une
//     hierarchie, on livre les colonnes mises en forme (fond, bordures, centrage,
//     retour a la ligne) et l'utilisateur y saisit sa propre nomenclature.
//
//  3. AUCUN lien de dependance n'est trace (illisible des que le planning grossit),
//     et une LEGENDE des couleurs est posee en haut a gauche, comme sur le modele.
//
// Les barres ne sont PAS des cellules colorees (contrairement au « Gantt chargé »
// de la S9) mais des FORMES flottantes DrawingML — c'est ce que fait le modele, et
// c'est la seule facon de placer une barre au milieu d'un mois sans decouper la
// grille. Le mini-writer maison a ete etendu pour cela (cf. export_xlsx.js).

// ── Geometrie du canevas (valeurs relevees sur le modele) ───────────────────────
const PERT_PD_COL_A_W      = 2.18;    // colonne A : marge etroite
const PERT_PD_COL_LABEL_W  = 17.82;   // colonnes B et C : nomenclature utilisateur
const PERT_PD_COL_MONTH_W  = 4.453;   // une colonne = un mois
const PERT_PD_COL0         = 3;       // colonne D = premier mois de la grille
const PERT_PD_ROW0         = 4;       // ligne 5 = premiere bande de contenu
const PERT_PD_HEAD_HEIGHTS = [14.5, 20, 21.75, 20];  // marge, annees, trimestres, mois

// Hauteur d'une barre de tache et cote d'un losange de jalon, en points. Fixes (et
// non proportionnels a la hauteur du nœud) : un nœud PERT fait 60 a 100 px de haut,
// une barre de planning directeur en fait ~14 pt. Ce qui est conserve, c'est la
// POSITION du centre — donc l'agencement vertical — pas l'encombrement du nœud.
const PERT_PD_BAR_PT       = 14;
const PERT_PD_MS_PT        = 11;
const PERT_PD_MIN_BAR_MON  = 0.30;    // largeur plancher d'une barre, en mois

// Deux nœuds distants de moins de ce seuil (px canvas) appartiennent a la meme
// bande, donc a la meme ligne du classeur. Au-dela, la ligne change.
const PERT_PD_BAND_GAP_PX  = 6;

// Echelle verticale : on vise une hauteur de corps a peu pres tenable sur une page,
// bornee des deux cotes. Sans borne haute un petit planning serait etire jusqu'au
// ridicule ; sans borne basse un gros planning ecraserait ses barres les unes sur
// les autres. La hauteur de ligne est de toute facon plafonnee au plancher
// PERT_PD_MIN_ROW_PT, qui garantit qu'une barre tient dans sa ligne.
const PERT_PD_TARGET_PT    = 480;
const PERT_PD_SCALE_MIN    = 0.10;
const PERT_PD_SCALE_MAX    = 0.60;
const PERT_PD_MIN_ROW_PT   = PERT_PD_BAR_PT + 4;
// Marge maximale (en points, repartie de part et d'autre) laissee autour du contenu
// d'une bande. La hauteur d'une bande est dictee par le VIDE qui l'entoure sur le
// canvas, pas par son contenu : sans plafond, un planning aere sort avec des lignes de
// 100 pt pour une barre de 14. Mais le plafond ne porte QUE sur cette marge — plafonner
// la hauteur totale comprimerait le contenu lui-meme, et deux nœuds distincts d'une
// meme bande finiraient l'un sur l'autre (constate sur un planning dense).
const PERT_PD_MAX_GAP_PT   = 24;

// Garde-fou : au-dela, la grille est tronquee (un classeur de 30 ans de colonnes est
// deja hors de propos pour un planning directeur).
const PERT_PD_MAX_MONTHS   = 360;

// Palette du canevas (relevee dans le modele).
const PERT_PD_COLORS = {
  head:       "#5DBFD4",   // bandeau annees / trimestres / mois
  headText:   "#FFFFFF",
  poste:      "#5DBFD4",   // colonne B (niveau superieur, a remplir)
  laneA:      "#D2E8EF",   // colonne C, bandes paires
  laneB:      "#EAF4F7",   // colonne C, bandes impaires
  monthOdd:   "#D9D9D9",   // zebrage mensuel
  monthEven:  "#FFFFFF",
  white:      "#FFFFFF",
  msOk:       "#FFFF00",   // losange de jalon (jaune du modele)
  msMissed:   "#FF0000",   // jalon dont la cible n'est pas tenue
  legendBg:   "#FFF9E6",
  legendLine: "#E8A33D",
};

const PERT_PD_MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const PERT_PD_QUARTERS = ["1er Tri.", "2ème Tri.", "3ème Tri.", "4ème Tri."];

// Noir ou blanc selon la clarte du fond : un libelle blanc sur une barre jaune est
// illisible, et l'utilisateur choisit librement la couleur de ses groupes.
function pertPdTextOn(hex) {
  const h = String(hex || "").replace(/^#/, "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return "#000000";
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#000000" : "#FFFFFF";
}

// Assombrit une couleur (contour d'une barre : la meme teinte en plus soutenu tient
// mieux qu'un noir uniforme, qui salit les barres claires).
function pertPdDarken(hex, factor) {
  const h = String(hex || "").replace(/^#/, "");
  const v = [0, 2, 4].map(i => {
    const c = parseInt(h.slice(i, i + 2), 16);
    return isNaN(c) ? 0 : Math.max(0, Math.min(255, Math.round(c * factor)));
  });
  return "#" + v.map(c => c.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function pertPdDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

// ── Modele ──────────────────────────────────────────────────────────────────────
//
// Rassemble tout ce dont le rendu a besoin : les elements a dessiner (avec leur
// ordonnee canvas et leurs dates), l'etendue de la grille en mois, et le decoupage
// en bandes qui donne les lignes du classeur.
function pertPlanningDirecteurModel() {
  const graph = window.pertGraph;
  if (!graph || !graph._nodes || !graph._nodes.length) return null;
  if (!window.pertMeta || !window.pertMeta.t0) return { error: "no_t0" };
  if (window.pertRecalc) pertRecalc();

  const items = [];
  graph._nodes.forEach(n => {
    if (!n || !n.pos || !n.size) return;
    const base = {
      node: n,
      top: n.pos[1], bottom: n.pos[1] + n.size[1],
      cy: n.pos[1] + n.size[1] / 2,
      x: n.pos[0], w: n.size[0],
    };
    if (n.type === "pert/activity") {
      if (n.es == null || n.ef == null) return;
      items.push(Object.assign(base, { kind: "act", start: n.es, end: n.ef }));
    } else if (n.type === "pert/milestone") {
      // Meme regle d'affichage que le Gantt et la synthese : un jalon se lit sur sa
      // CIBLE quand elle est saisie, sinon sur son EF calcule (cf. pertScheduleModel).
      const due = pertMilestoneDueOffset(n);
      const off = (due != null) ? due : (n.ef != null ? n.ef : 0);
      items.push(Object.assign(base, { kind: "ms", start: off, end: off }));
    } else if (n.type === "pert/label") {
      items.push(Object.assign(base, { kind: "lab" }));
    }
  });

  const dated = items.filter(i => i.kind !== "lab");
  if (!dated.length) return null;

  // Etendue calendaire reelle du planning, arrondie aux mois entiers qui la portent.
  let minD = null, maxD = null;
  dated.forEach(i => {
    const a = pertOffsetToDate(i.start), b = pertOffsetToDate(i.end);
    if (a && (!minD || a < minD)) minD = a;
    if (b && (!maxD || b > maxD)) maxD = b;
    if (a && (!maxD || a > maxD)) maxD = a;
  });
  if (!minD || !maxD) return null;

  const y0 = minD.getFullYear(), m0 = minD.getMonth();
  let nMonths = (maxD.getFullYear() - y0) * 12 + (maxD.getMonth() - m0) + 1;
  let truncated = false;
  if (nMonths > PERT_PD_MAX_MONTHS) { nMonths = PERT_PD_MAX_MONTHS; truncated = true; }

  // Position d'une date sur l'axe, en mois fractionnaires depuis l'origine de la
  // grille. La fraction est la part du mois ecoulee : une tache qui demarre le 15
  // mars commence a la moitie de la colonne de mars.
  const monthPos = (d) => {
    if (!d) return 0;
    const whole = (d.getFullYear() - y0) * 12 + (d.getMonth() - m0);
    return whole + (d.getDate() - 1) / pertPdDaysInMonth(d.getFullYear(), d.getMonth());
  };
  const posOf = (offset) => monthPos(pertOffsetToDate(offset));

  // ── Bandes : le decoupage vertical du canvas en lignes de classeur ────────────
  // Une bande regroupe les nœuds dont les boites se chevauchent verticalement (a
  // PERT_PD_BAND_GAP_PX pres). C'est une LECTURE de l'agencement existant, pas une
  // reorganisation : rien n'est deplace, on decide seulement ou couper les lignes.
  const sorted = items.slice().sort((a, b) => a.top - b.top);
  const bands = [];
  let cur = null;
  sorted.forEach(it => {
    if (!cur || it.top > cur.bottom + PERT_PD_BAND_GAP_PX) {
      cur = { top: it.top, bottom: it.bottom, items: [] };
      bands.push(cur);
    }
    cur.bottom = Math.max(cur.bottom, it.bottom);
    cur.items.push(it);
  });

  // Frontieres de lignes : le vide entre deux bandes est partage par moitie entre
  // elles, de sorte que les lignes pavent tout le canvas sans trou ni recouvrement.
  // L'ordonnee relative d'un nœud DANS sa ligne reste donc exactement celle qu'il a
  // sur le canvas.
  bands.forEach((b, i) => {
    const prev = bands[i - 1], next = bands[i + 1];
    b.rowTop = prev ? (prev.bottom + b.top) / 2 : b.top - 10;
    b.rowBottom = next ? (b.bottom + next.top) / 2 : b.bottom + 10;
  });

  const totalPx = bands.length ? (bands[bands.length - 1].rowBottom - bands[0].rowTop) : 1;
  const scaleY = Math.max(PERT_PD_SCALE_MIN,
                   Math.min(PERT_PD_SCALE_MAX, PERT_PD_TARGET_PT / Math.max(1, totalPx)));
  // Hauteur d'une ligne = contenu a l'echelle EXACTE + marges plafonnees. Le surplus
  // eventuel (bande plus courte que le plancher) est reparti de part et d'autre, pour
  // que le contenu reste centre dans sa ligne.
  bands.forEach(b => {
    const contentPt = (b.bottom - b.top) * scaleY;
    b.padTopPt = Math.min((b.top - b.rowTop) * scaleY, PERT_PD_MAX_GAP_PT / 2);
    const padBot = Math.min((b.rowBottom - b.bottom) * scaleY, PERT_PD_MAX_GAP_PT / 2);
    const naturel = b.padTopPt + contentPt + padBot;
    b.heightPt = Math.max(PERT_PD_MIN_ROW_PT, naturel);
    b.padTopPt += (b.heightPt - naturel) / 2;
  });

  return { items, bands, y0, m0, nMonths, truncated, monthPos, posOf, scaleY };
}

// Place les nœuds Label, qui n'ont AUCUNE date, sur l'axe calendaire.
//
// Leur abscisse ne peut venir que du canvas : on ajuste (moindres carres) la relation
// x_canvas → position en mois sur les taches et jalons, dont on connait les deux, puis
// on l'applique aux Labels. Sur un PERT range selon l'axe du temps — le cas nominal,
// c'est ce que produit la reorganisation « axe temps seul » — l'ajustement est exact
// et le Label retombe pile ou son auteur l'avait mis. Sur un PERT range autrement, il
// atterrit au mieux : c'est le seul rattachement disponible, faute de date.
function pertPdLabelXFit(model) {
  const pts = model.items.filter(i => i.kind !== "lab")
    .map(i => ({ x: i.x + i.w / 2, p: (model.posOf(i.start) + model.posOf(i.end)) / 2 }));
  if (pts.length < 2) return () => 0;
  const n = pts.length;
  const mx = pts.reduce((s, q) => s + q.x, 0) / n;
  const mp = pts.reduce((s, q) => s + q.p, 0) / n;
  let num = 0, den = 0;
  pts.forEach(q => { num += (q.x - mx) * (q.p - mp); den += (q.x - mx) * (q.x - mx); });
  if (den < 1e-9) return () => mp;                   // tous les nœuds sur la meme verticale
  const a = num / den, b = mp - a * mx;
  return (x) => a * x + b;
}

// ── Construction du classeur ────────────────────────────────────────────────────
function pertBuildPlanningDirecteurXlsx(model) {
  const { bands, y0, m0, nMonths } = model;

  // Conversions : une colonne de mois et une ligne mesurent respectivement tant de
  // pixels et tant de points ; les formes s'ancrent en (cellule + decalage EMU).
  const MONTH_PX = pertXlsxColWidthPx(PERT_PD_COL_MONTH_W);
  const MONTH_EMU = pertXlsxPxToEmu(MONTH_PX);
  const MONTH_PT = MONTH_PX * 0.75;                  // 96 dpi → points
  const LABEL_PX = pertXlsxColWidthPx(PERT_PD_COL_LABEL_W);

  const nCols = PERT_PD_COL0 + nMonths;
  const monthOfCol = (i) => (m0 + i) % 12 < 0 ? ((m0 + i) % 12 + 12) % 12 : (m0 + i) % 12;
  const yearOfCol = (i) => y0 + Math.floor((m0 + i) / 12);

  // ── Styles ───────────────────────────────────────────────────────────────────
  // Separateurs blancs du modele. Verticaux en « medium » : ce sont eux qui detachent
  // les mois les uns des autres, c'est le quadrillage utile. Horizontaux en « thin » :
  // deux bordures medium se cumulent a chaque frontiere de ligne et decoupent les
  // colonnes grises en tronçons, ce qui casse la lecture d'une colonne de mois.
  const WB = "medium#FFFFFF", WT = "thin#FFFFFF";
  const frame = (right) => ({ l: WB, r: right || WB, t: WT, b: WT });
  const head = (size) => ({
    fill: PERT_PD_COLORS.head, color: PERT_PD_COLORS.headText, bold: true, size: size,
    halign: "center", valign: "center", wrap: true, border: frame(),
  });
  const HEAD_YEAR = head(11), HEAD_QUARTER = head(10), HEAD_MONTH = head(9);

  // Cellule de corps : zebrage mensuel + trait pointille de part et d'autre du
  // changement d'annee (pose des DEUX cotes de la frontiere, sinon la bordure de la
  // cellule voisine peut le recouvrir selon la version d'Excel).
  const bodyStyle = (i) => {
    const mo = monthOfCol(i);
    const b = frame();
    if (mo === 11) b.r = "dotted#000000";
    if (mo === 0)  b.l = "dotted#000000";
    // Le modele grise janvier, mars, mai… : ce sont les mois d'indice PAIR (0-based).
    return { fill: (mo % 2 === 0) ? PERT_PD_COLORS.monthOdd : PERT_PD_COLORS.monthEven, border: b };
  };
  // Colonnes B et C : vides, mais mises en forme pour que la saisie de l'utilisateur
  // tombe deja centree, coupee et cadree comme sur le modele.
  const laneStyle = (bandIdx, col) => ({
    fill: col === 1 ? PERT_PD_COLORS.poste
                    : (bandIdx % 2 ? PERT_PD_COLORS.laneB : PERT_PD_COLORS.laneA),
    size: 10, halign: "center", valign: "center", wrap: true, border: frame(),
  });

  // ── Cellules ─────────────────────────────────────────────────────────────────
  const rows = [];
  const merges = [];
  const rowHeights = PERT_PD_HEAD_HEIGHTS.slice();
  for (let r = 0; r < PERT_PD_ROW0; r++) rows.push([]);

  // Lignes annees / trimestres : une valeur en tete de bloc, le style sur toute son
  // etendue (une fusion dont les cellules internes n'ont pas le style laisse des
  // trous blancs dans le bandeau).
  const emitBlocks = (rowIdx, keyOf, labelOf, style) => {
    let start = 0;
    for (let i = 1; i <= nMonths; i++) {
      if (i === nMonths || keyOf(i) !== keyOf(start)) {
        for (let k = start; k < i; k++) {
          rows[rowIdx][PERT_PD_COL0 + k] = pertXlsxText(k === start ? labelOf(start) : "", style);
        }
        if (i - start > 1) {
          merges.push(pertXlsxColLetter(PERT_PD_COL0 + start) + (rowIdx + 1) + ":"
                    + pertXlsxColLetter(PERT_PD_COL0 + i - 1) + (rowIdx + 1));
        }
        start = i;
      }
    }
  };
  emitBlocks(1, (i) => yearOfCol(i), (i) => String(yearOfCol(i)), HEAD_YEAR);
  emitBlocks(2, (i) => yearOfCol(i) + "-" + Math.floor(monthOfCol(i) / 3),
                (i) => PERT_PD_QUARTERS[Math.floor(monthOfCol(i) / 3)], HEAD_QUARTER);
  for (let i = 0; i < nMonths; i++) {
    rows[3][PERT_PD_COL0 + i] = pertXlsxText(PERT_PD_MONTH_LETTERS[monthOfCol(i)], HEAD_MONTH);
  }

  bands.forEach((b, bi) => {
    const r = PERT_PD_ROW0 + bi;
    const row = [];
    row[1] = pertXlsxText("", laneStyle(bi, 1));
    row[2] = pertXlsxText("", laneStyle(bi, 2));
    for (let i = 0; i < nMonths; i++) row[PERT_PD_COL0 + i] = pertXlsxText("", bodyStyle(i));
    rows.push(row);
    rowHeights.push(Math.round(b.heightPt * 100) / 100);
  });

  // ── Ancrages ─────────────────────────────────────────────────────────────────
  // Une forme se pose en (colonne, decalage dans la colonne) et (ligne, decalage dans
  // la ligne). Consequence importante : une erreur d'estimation de la largeur rendue
  // d'une colonne ne decale que la fraction interne — elle ne se CUMULE pas le long
  // de la grille, contrairement a un placement en coordonnees absolues.
  const xAnchor = (mp) => {
    const c = Math.max(0, Math.min(nMonths - 1e-6, mp));
    const col = Math.floor(c);
    return { col: PERT_PD_COL0 + col, colOff: Math.round((c - col) * MONTH_EMU) };
  };
  const cumY = [];
  let acc = 0;
  rowHeights.forEach(h => { cumY.push(acc); acc += h; });
  const yAnchor = (absPt) => {
    let y = Math.max(0, Math.min(acc - 0.01, absPt)), r = 0;
    while (r < rowHeights.length - 1 && y >= rowHeights[r]) { y -= rowHeights[r]; r++; }
    return { row: r, rowOff: pertXlsxPtToEmu(y) };
  };
  // Ordonnee absolue (en points depuis le haut de la feuille) du centre d'un nœud :
  // le haut de sa ligne, sa marge, puis sa position DANS la bande a l'echelle exacte —
  // c'est ce dernier terme qui preserve l'agencement vertical du canvas.
  const centerPt = (band, bandIdx, cy) =>
    cumY[PERT_PD_ROW0 + bandIdx] + band.padTopPt + (cy - band.top) * model.scaleY;

  // ── Formes ───────────────────────────────────────────────────────────────────
  // Trois plans de profondeur : l'ordre d'emission EST l'ordre de dessin. Les notes
  // (Labels) tapissent le fond, les barres viennent dessus, les jalons en dernier — un
  // losange ne doit jamais disparaitre sous une barre qui le chevauche, c'est le repere
  // que l'œil cherche en premier sur un planning directeur.
  const fond = [], barres = [], jalons = [];
  const labelX = pertPdLabelXFit(model);

  bands.forEach((band, bi) => {
    band.items.forEach(it => {
      const shapes = it.kind === "lab" ? fond : (it.kind === "act" ? barres : jalons);
      const cPt = centerPt(band, bi, it.cy);
      const n = it.node;

      if (it.kind === "act") {
        let x1 = model.posOf(it.start), x2 = model.posOf(it.end);
        if (x2 - x1 < PERT_PD_MIN_BAR_MON) x2 = x1 + PERT_PD_MIN_BAR_MON;
        const fill = pertGanttColor(n);
        shapes.push({
          kind: "roundRect",
          from: Object.assign(xAnchor(x1), yAnchor(cPt - PERT_PD_BAR_PT / 2)),
          to:   Object.assign(xAnchor(x2), yAnchor(cPt + PERT_PD_BAR_PT / 2)),
          fill, line: pertPdDarken(fill, 0.6), lineW: 0.75,
          text: (n.properties && n.properties.label) || "",
          textColor: pertPdTextOn(fill), textSize: 7, bold: true, align: "ctr",
          name: "Tache " + ((n.properties && n.properties.label) || n.id),
        });
        return;
      }

      if (it.kind === "ms") {
        const halfMon = (PERT_PD_MS_PT / MONTH_PT) / 2;
        // Un jalon pose sur le tout premier (ou tout dernier) jour de la grille verrait
        // la moitie de son losange rognee par le bord : on le rentre d'une demi-largeur.
        const mp = Math.max(halfMon, Math.min(nMonths - halfMon, model.posOf(it.start)));
        const fill = n.target_missed ? PERT_PD_COLORS.msMissed : PERT_PD_COLORS.msOk;
        shapes.push({
          kind: "diamond",
          from: Object.assign(xAnchor(mp - halfMon), yAnchor(cPt - PERT_PD_MS_PT / 2)),
          to:   Object.assign(xAnchor(mp + halfMon), yAnchor(cPt + PERT_PD_MS_PT / 2)),
          fill, line: "#000000", lineW: 0.75,
          name: "Jalon " + ((n.properties && n.properties.label) || n.id),
        });
        // Le libelle vit dans une forme SEPAREE, posee a droite du losange : ecrit
        // dedans il serait illisible (un losange de 11 pt n'a pas de place utile).
        const txt = (n.properties && n.properties.label) || "";
        if (txt) {
          const wMon = Math.max(1, (txt.length * 4.2 + 6) / MONTH_PT);
          shapes.push({
            kind: "text",
            from: Object.assign(xAnchor(mp + halfMon), yAnchor(cPt - PERT_PD_MS_PT / 2)),
            to:   Object.assign(xAnchor(mp + halfMon + wMon), yAnchor(cPt + PERT_PD_MS_PT / 2)),
            text: txt, textColor: "#000000", textSize: 7, bold: true, align: "l", wrap: false,
            name: "Libelle jalon " + txt,
          });
        }
        return;
      }

      // Label : boite de texte, couleurs et graisse reprises du nœud.
      const p = n.properties || {};
      const x1 = labelX(it.x), x2 = labelX(it.x + it.w);
      // Hauteur de la boite : celle du nœud Label, a l'echelle verticale du document,
      // bornee pour qu'une note tres haute n'ecrase pas la bande.
      const hPt = Math.max(10, Math.min(48, (it.bottom - it.top) * model.scaleY));
      shapes.push({
        kind: "rect",
        from: Object.assign(xAnchor(x1), yAnchor(cPt - hPt / 2)),
        to:   Object.assign(xAnchor(Math.max(x2, x1 + PERT_PD_MIN_BAR_MON)), yAnchor(cPt + hPt / 2)),
        fill: p.bg_color || null, line: null,
        text: p.text || "", textColor: p.text_color || "#444444", textSize: 8,
        bold: !!p.bold,
        align: p.text_align === "center" ? "ctr" : (p.text_align === "right" ? "r" : "l"),
        name: "Note",
      });
    });
  });
  const shapes = fond.concat(barres, jalons);

  // ── Legende (haut a gauche, sur les colonnes B et C) ─────────────────────────
  const legend = [];
  const seen = new Set();
  model.items.forEach(it => {
    if (it.kind !== "act") return;
    const g = ((it.node.properties && it.node.properties.group) || "").trim();
    const key = g || "(sans groupe)";
    if (seen.has(key)) return;
    seen.add(key);
    legend.push({ label: key, color: pertGanttColor(it.node), diamond: false });
  });
  legend.sort((a, b) => a.label.localeCompare(b.label, "fr"));
  if (model.items.some(i => i.kind === "ms")) {
    legend.push({ label: "Jalon", color: PERT_PD_COLORS.msOk, diamond: true });
  }
  if (model.items.some(i => i.kind === "ms" && i.node.target_missed)) {
    legend.push({ label: "Jalon : cible non tenue", color: PERT_PD_COLORS.msMissed, diamond: true });
  }

  if (legend.length) {
    // Deux colonnes des que la liste depasse cinq entrees, pour rester dans la
    // hauteur du bandeau d'en-tete.
    const twoCols = legend.length > 5;
    const nRows = twoCols ? Math.ceil(legend.length / 2) : legend.length;
    const PAD = 3, TITLE_PT = 9, LINE_PT = 9, SW_PX = 16;
    const boxW = 2 * LABEL_PX - 4;
    const colW = twoCols ? (boxW - 2 * PAD) / 2 : boxW - 2 * PAD;
    const boxH = PAD + TITLE_PT + nRows * LINE_PT + PAD;
    // Abscisse en pixels depuis le bord gauche de la colonne B → (colonne, decalage).
    const lx = (px) => {
      const c = Math.max(0, Math.min(2 * LABEL_PX - 1, px));
      return { col: 1 + Math.floor(c / LABEL_PX), colOff: pertXlsxPxToEmu(c % LABEL_PX) };
    };
    shapes.push({
      kind: "rect",
      from: Object.assign(lx(2), yAnchor(2)),
      to:   Object.assign(lx(2 + boxW), yAnchor(2 + boxH)),
      fill: PERT_PD_COLORS.legendBg, line: PERT_PD_COLORS.legendLine, lineW: 1,
      name: "Legende",
    });
    shapes.push({
      kind: "text",
      from: Object.assign(lx(2 + PAD), yAnchor(2 + PAD)),
      to:   Object.assign(lx(2 + boxW - PAD), yAnchor(2 + PAD + TITLE_PT)),
      text: "Légende :", textColor: "#000000", textSize: 8, bold: true, align: "l", wrap: false,
      name: "Legende titre",
    });
    legend.forEach((e, i) => {
      const c = twoCols && i >= nRows ? 1 : 0;
      const r = twoCols ? (i % nRows) : i;
      const x = 2 + PAD + c * (colW + PAD * 0);
      const y = 2 + PAD + TITLE_PT + r * LINE_PT;
      shapes.push({
        kind: e.diamond ? "diamond" : "rect",
        from: Object.assign(lx(x), yAnchor(y + 1)),
        to:   Object.assign(lx(x + SW_PX), yAnchor(y + LINE_PT - 1)),
        fill: e.color, line: "#666666", lineW: 0.5,
        name: "Legende pastille " + e.label,
      });
      shapes.push({
        kind: "text",
        from: Object.assign(lx(x + SW_PX + 2), yAnchor(y)),
        to:   Object.assign(lx(x + colW), yAnchor(y + LINE_PT)),
        text: e.label, textColor: "#000000", textSize: 7, align: "l", wrap: false,
        name: "Legende texte " + e.label,
      });
    });
  }

  // ── Feuille ──────────────────────────────────────────────────────────────────
  const cols = [{ width: PERT_PD_COL_A_W }, { width: PERT_PD_COL_LABEL_W }, { width: PERT_PD_COL_LABEL_W }];
  for (let i = 0; i < nMonths; i++) cols.push({ width: PERT_PD_COL_MONTH_W });

  return pertXlsxBuild([{
    name: "Planning directeur",
    cols, rows, rowHeights, merges, shapes,
    gridLines: false,
    defaultRowHeight: 14,
    // Colonnes A→C et les quatre lignes d'en-tete restent visibles au defilement :
    // sur cinq ans de colonnes, sans cela on ne sait plus quel mois on lit.
    freeze: { col: PERT_PD_COL0, row: PERT_PD_ROW0 },
    page: { orientation: "landscape", paperSize: 8, fitToPage: true, centered: true },
  }]);
}

function pertExportPlanningDirecteur() {
  const model = pertPlanningDirecteurModel();
  if (!model) { showToast("Rien a exporter (planning vide ou sans dates)"); return; }
  if (model.error === "no_t0") { showToast("Definissez d'abord la date T0 (Parametres)"); return; }
  const data = pertBuildPlanningDirecteurXlsx(model);
  const name = (window.pertProjectFilename ? pertProjectFilename() : "pertflow") + "_planning_directeur.xlsx";
  pertDownloadBlob(data, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  showToast(model.truncated
    ? "Planning directeur : " + name + " (grille tronquee a " + PERT_PD_MAX_MONTHS + " mois)"
    : "Planning directeur : " + name);
}

window.pertPlanningDirecteurModel = pertPlanningDirecteurModel;
window.pertBuildPlanningDirecteurXlsx = pertBuildPlanningDirecteurXlsx;
window.pertExportPlanningDirecteur = pertExportPlanningDirecteur;

if (window.pertRegisterExportFormat) {
  pertRegisterExportFormat({
    id: "planning-directeur", icon: "🗺", label: "Planning directeur (Excel)", order: 50,
    desc: "Vue calendaire pluriannuelle (annees / trimestres / mois), barres et jalons dessines, "
        + "agencement du PERT conserve. Colonnes de nomenclature a remplir apres l'export.",
    run: () => pertExportPlanningDirecteur(),
  });
}
