// ─── Mini-writer XLSX (sur fflate) — Session 9, etendu v0.23 ────────────────────
//
// Un .xlsx est un ZIP de fichiers XML (Office Open XML). On le fabrique a la main
// avec fflate (lib/fflate.min.js, MIT, deja present pour l'import) — AUCUNE
// dependance supplementaire (SheetJS est Apache-2.0, exclu par la regle « MIT
// uniquement »). Le writer est volontairement minimal mais couvre ce dont les
// exports Gantt/micro-jalonnement ont besoin : cellules texte / nombre / date /
// formule, formats de nombre et de date, remplissage (fills) de couleur, gras,
// largeurs de colonnes, plusieurs feuilles.
//
// v0.23 — l'export « Planning directeur » a demande un cran de plus : le canevas
// vise (cf. test_cases/Planning_directeur.xlsx) repose sur des bordures, des
// cellules fusionnees, des hauteurs de ligne, des panneaux figes, une mise en page
// paysage… et surtout sur des FORMES flottantes (DrawingML) — les barres de taches
// n'y sont pas des cellules colorees mais des rectangles arrondis poses au-dessus
// de la grille. Tout ce qui a ete ajoute est OPTIONNEL : un appelant qui ne passe
// que { name, cols, rows } produit exactement le meme classeur qu'avant.
//
// API :
//   pertXlsxText(v, style?)     cellule texte (partagee via sharedStrings)
//   pertXlsxNum(v, style?)      cellule nombre
//   pertXlsxDate(dateObj,style?) cellule date (serial Excel + format date)
//   pertXlsxFormula(f, style?)  cellule formule (ex. "SUM(D2:D12)")  — sans '='
//   null / undefined            cellule vide
//   style = { fmt, bold, fill, size, color, italic, halign, valign, wrap, border }
//       fmt    ∈ {null,"num2","date-mmm-yy","date-d-mmm-yy"}
//       fill   = "#RRGGBB" ou null
//       color  = "#RRGGBB" (couleur du texte) ; size = corps en points
//       halign ∈ {"left","center","right"} ; valign ∈ {"top","center","bottom"}
//       border = { l, r, t, b }, chaque cote "style#RRGGBB"
//                (style ∈ thin|medium|thick|hair|dotted|dashed), ex. "medium#FFFFFF"
//   pertXlsxBuild(sheets) → Uint8Array (zip)
//     sheets = [{ name, cols?, rows, rowHeights?, merges?, freeze?, gridLines?,
//                 defaultRowHeight?, page?, shapes? }]
//       cols        = [{ width }]        largeurs de colonnes
//       rowHeights  = [pt|null, ...]     hauteur par ligne (index = ligne 0-based)
//       merges      = ["A1:C1", ...]     plages fusionnees
//       freeze      = { col, row }       nb de colonnes/lignes figees
//       gridLines   = false              masque le quadrillage a l'ecran
//       page        = { orientation, paperSize, scale, fitToPage, centered }
//       shapes      = [forme, ...]       cf. pertXlsxShape ci-dessous
//
// Contrainte file:// : pur JS, telechargement via pertDownloadBlob.

// Constructeurs de cellules (objets legers interpretes par pertXlsxBuild).
function pertXlsxText(v, style)    { return { k: "s", v: (v == null ? "" : String(v)), style: style || null }; }
function pertXlsxNum(v, style)     { return { k: "n", v: v, style: style || null }; }
function pertXlsxDate(d, style)    { return { k: "d", v: d, style: style || null }; }
function pertXlsxFormula(f, style) { return { k: "f", v: f, style: style || null }; }

// Indice colonne 0-based → lettre(s) Excel (0→A, 26→AA…).
function pertXlsxColLetter(i) {
  let s = "";
  i = i + 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function pertXlsxEsc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Date → numero de serie Excel (jours depuis 1899-12-30, systeme 1900). Calcul en
// composantes locales (nos dates sont construites a minuit local depuis T0).
function pertXlsxDateSerial(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return 0;
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((utc - epoch) / 86400000);
}

// Couleur "#RRGGBB" → ARGB "FFRRGGBB" (alpha opaque), majuscules.
function pertXlsxArgb(hex) {
  return "FF" + String(hex || "").replace(/^#/, "").toUpperCase();
}

// Couleur "#RRGGBB" → "RRGGBB" (DrawingML n'utilise pas la composante alpha ici).
function pertXlsxRgb(hex) {
  return String(hex || "").replace(/^#/, "").toUpperCase();
}

// Unites de mesure OOXML. Les formes se positionnent en EMU (English Metric Unit) :
// 914400 EMU par pouce, donc 12700 par point et 9525 par pixel a 96 dpi. On expose
// les deux conversions : les hauteurs de ligne se declarent en POINTS (donc exactes
// en EMU), les largeurs de colonne se rendent en PIXELS (approximation, cf. le
// commentaire de pertXlsxColWidthPx).
const PERT_XLSX_EMU_PER_PT = 12700;
const PERT_XLSX_EMU_PER_PX = 9525;
function pertXlsxPtToEmu(pt) { return Math.round(pt * PERT_XLSX_EMU_PER_PT); }
function pertXlsxPxToEmu(px) { return Math.round(px * PERT_XLSX_EMU_PER_PX); }

// Largeur de colonne Excel (en « caracteres ») → largeur rendue en pixels, formule
// OOXML pour la police par defaut (Calibri 11 → MDW = 7 px).
//
// ATTENTION : cette conversion n'est fiable que si le poste rend bien la police par
// defaut a 7 px de chasse — ce qui n'est pas garanti. C'est sans consequence ICI
// parce qu'une forme s'ancre en (indice de colonne + decalage DANS la colonne) :
// une erreur d'estimation ne decale jamais que la fraction interne, elle ne
// s'accumule pas de colonne en colonne. Ne pas s'en servir pour additionner des
// largeurs sur toute une feuille, ou l'erreur, elle, se cumulerait.
function pertXlsxColWidthPx(chars) {
  return Math.floor(((256 * chars + Math.floor(128 / 7)) / 256) * 7);
}

// numFmtId par nom de format ; les >=164 sont des formats custom declares dans styles.xml.
const PERT_XLSX_NUMFMT = {
  "num2": 2,               // builtin "0.00"
  "date-mmm-yy": 164,      // custom
  "date-d-mmm-yy": 165,    // custom
};
const PERT_XLSX_CUSTOM_FMT = [
  { id: 164, code: "mmm\\-yy" },
  { id: 165, code: "d\\-mmm\\-yy" },
];

// Cle canonique d'une police / d'une bordure / d'un style (pour dedup dans styles.xml).
function pertXlsxFontKey(st) {
  if (!st) return "11|0|0|";
  return (st.size || 11) + "|" + (st.bold ? 1 : 0) + "|" + (st.italic ? 1 : 0) + "|" + (st.color || "");
}
function pertXlsxBorderKey(b) {
  if (!b) return "";
  return ["l", "r", "t", "b"].map(k => b[k] || "").join("|");
}
function pertXlsxStyleKey(st) {
  if (!st) return "";
  return (st.fmt || "") + "|" + pertXlsxFontKey(st) + "|" + (st.fill || "")
    + "|" + (st.halign || "") + "|" + (st.valign || "") + "|" + (st.wrap ? "1" : "0")
    + "|" + pertXlsxBorderKey(st.border);
}

// ── Formes flottantes (DrawingML) ───────────────────────────────────────────────
//
// Une forme s'ancre sur DEUX cellules (twoCellAnchor) : coin haut-gauche et coin
// bas-droit, chacun exprime en (colonne, decalage EMU dans la colonne, ligne,
// decalage EMU dans la ligne). C'est ce que fait Excel lui-meme quand on dessine
// un rectangle sur une feuille, et c'est ce qui permet de placer une barre de Gantt
// AU MILIEU d'un mois sans decouper la grille.
//
//   forme = {
//     kind: "roundRect" | "rect" | "diamond" | "ellipse" | "line" | "text",
//     from: { col, colOff, row, rowOff },   // EMU pour les decalages
//     to:   { col, colOff, row, rowOff },
//     fill: "#RRGGBB" | null,               // null = transparent
//     line: "#RRGGBB" | null,               // null = sans contour
//     lineW: points (defaut 0.75),
//     text, textColor, textSize, bold, align ("l"|"ctr"|"r"), wrap (defaut true),
//     name: nom affiche dans le volet de selection d'Excel
//   }
// "text" est un rectangle sans fond ni contour : le libelle d'un jalon pose a cote
// de son losange, une zone de commentaire… (aucune geometrie propre a inventer).
function pertXlsxShapeXml(sh, id) {
  const kind = sh.kind || "rect";
  const geom = (kind === "text") ? "rect" : kind;
  const anchor = (pt, tag) =>
    `<xdr:${tag}><xdr:col>${pt.col}</xdr:col><xdr:colOff>${Math.round(pt.colOff || 0)}</xdr:colOff>`
    + `<xdr:row>${pt.row}</xdr:row><xdr:rowOff>${Math.round(pt.rowOff || 0)}</xdr:rowOff></xdr:${tag}>`;

  const fill = (kind === "text" || !sh.fill)
    ? "<a:noFill/>"
    : `<a:solidFill><a:srgbClr val="${pertXlsxRgb(sh.fill)}"/></a:solidFill>`;
  const line = sh.line
    ? `<a:ln w="${pertXlsxPtToEmu(sh.lineW == null ? 0.75 : sh.lineW)}">`
      + `<a:solidFill><a:srgbClr val="${pertXlsxRgb(sh.line)}"/></a:solidFill></a:ln>`
    : "<a:ln><a:noFill/></a:ln>";

  // Le texte est centre verticalement (anchor="ctr") et deborde en « clip » plutot
  // que de pousser la forme : une barre de tache garde la largeur de sa duree, meme
  // si son libelle est trop long — c'est la duree qui porte l'information.
  let body = "";
  if (sh.text) {
    const rPr = `<a:rPr lang="fr-FR" sz="${Math.round((sh.textSize || 7) * 100)}"`
      + (sh.bold ? ' b="1"' : "")
      + `><a:solidFill><a:srgbClr val="${pertXlsxRgb(sh.textColor || "#000000")}"/></a:solidFill></a:rPr>`;
    body = `<a:p><a:pPr algn="${sh.align || "ctr"}"/><a:r>${rPr}`
      + `<a:t>${pertXlsxEsc(sh.text)}</a:t></a:r></a:p>`;
  } else {
    body = "<a:p><a:endParaRPr lang=\"fr-FR\"/></a:p>";
  }
  const wrap = (sh.wrap === false) ? "none" : "square";
  const txBody = `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="${wrap}"`
    + ` lIns="18000" tIns="0" rIns="18000" bIns="0" rtlCol="0" anchor="ctr"/><a:lstStyle/>${body}</xdr:txBody>`;

  return "<xdr:twoCellAnchor>"
    + anchor(sh.from, "from") + anchor(sh.to, "to")
    + `<xdr:sp macro="" textlink="">`
    + `<xdr:nvSpPr><xdr:cNvPr id="${id}" name="${pertXlsxEsc(sh.name || ("Forme " + id))}"/>`
    + `<xdr:cNvSpPr/></xdr:nvSpPr>`
    + `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>`
    + `<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${fill}${line}</xdr:spPr>`
    + txBody
    + `</xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`;
}

function pertXlsxDrawingXml(shapes) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"`
    + ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`
    // id 1 est reserve : Excel numerote les formes a partir de 2 dans ses propres fichiers.
    + shapes.map((sh, i) => pertXlsxShapeXml(sh, i + 2)).join("")
    + `</xdr:wsDr>`;
}

function pertXlsxBuild(sheets) {
  // ── 1) Collecte des sharedStrings, des styles, fills, polices et bordures ───
  const strMap = new Map();       // texte → index
  const strList = [];
  function internStr(s) {
    if (strMap.has(s)) return strMap.get(s);
    const i = strList.length; strMap.set(s, i); strList.push(s); return i;
  }

  const fillMap = new Map();      // argb → fillId (les 0/1 sont reserves)
  let nextFillId = 2;
  function internFill(hex) {
    const argb = pertXlsxArgb(hex);
    if (fillMap.has(argb)) return fillMap.get(argb);
    const id = nextFillId++; fillMap.set(argb, id); return id;
  }

  // Police 0 = Calibri 11 par defaut ; police 1 = la meme en gras (les deux etaient
  // les seules avant v0.23, on les conserve en tete pour ne rien deplacer).
  const fontMap = new Map();
  const fontList = [];
  function internFont(st) {
    const key = pertXlsxFontKey(st);
    if (fontMap.has(key)) return fontMap.get(key);
    const i = fontList.length;
    fontList.push({ size: (st && st.size) || 11, bold: !!(st && st.bold),
                    italic: !!(st && st.italic), color: (st && st.color) || null });
    fontMap.set(key, i);
    return i;
  }
  internFont(null);            // 0 : normal
  internFont({ bold: true });  // 1 : gras

  const borderMap = new Map();
  const borderList = [];
  function internBorder(b) {
    const key = pertXlsxBorderKey(b);
    if (borderMap.has(key)) return borderMap.get(key);
    const i = borderList.length;
    borderList.push(b || null);
    borderMap.set(key, i);
    return i;
  }
  internBorder(null);          // 0 : sans bordure

  const xfMap = new Map();        // cle style → index cellXfs
  const xfList = [];              // { numFmtId, fontId, fillId, borderId, align }
  xfMap.set("", 0);
  xfList.push({ numFmtId: 0, fontId: 0, fillId: 0, borderId: 0, align: null }); // style par defaut
  function internStyle(st) {
    const key = pertXlsxStyleKey(st);
    if (xfMap.has(key)) return xfMap.get(key);
    const numFmtId = st && st.fmt ? (PERT_XLSX_NUMFMT[st.fmt] || 0) : 0;
    const fontId = internFont(st);
    const fillId = st && st.fill ? internFill(st.fill) : 0;
    const borderId = st && st.border ? internBorder(st.border) : 0;
    const align = (st && (st.halign || st.valign || st.wrap))
      ? { h: st.halign || null, v: st.valign || null, wrap: !!st.wrap } : null;
    const i = xfList.length;
    xfList.push({ numFmtId, fontId, fillId, borderId, align });
    xfMap.set(key, i);
    return i;
  }

  // ── 2) Emission des feuilles (references string/style resolues ici) ─────────
  //
  // L'ORDRE des elements d'une <worksheet> est impose par le schema OOXML
  // (sheetPr, sheetViews, sheetFormatPr, cols, sheetData, mergeCells, printOptions,
  // pageMargins, pageSetup, drawing). Excel refuse d'ouvrir un classeur qui s'en
  // ecarte, sans indiquer lequel des elements est en cause — d'ou cette sequence
  // ecrite une fois pour toutes, dans cet ordre-la.
  const sheetXmls = sheets.map(sheet => {
    const page = sheet.page || null;
    const sheetPr = (page && page.fitToPage)
      ? `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` : "";

    let view = `<sheetView${sheet.gridLines === false ? ' showGridLines="0"' : ""} workbookViewId="0">`;
    if (sheet.freeze && (sheet.freeze.col || sheet.freeze.row)) {
      const fc = sheet.freeze.col || 0, fr = sheet.freeze.row || 0;
      view += `<pane${fc ? ` xSplit="${fc}"` : ""}${fr ? ` ySplit="${fr}"` : ""}`
        + ` topLeftCell="${pertXlsxColLetter(fc)}${fr + 1}" activePane="bottomRight" state="frozen"/>`;
    }
    view += "</sheetView>";
    const sheetViews = `<sheetViews>${view}</sheetViews>`;
    const fmtPr = `<sheetFormatPr defaultRowHeight="${sheet.defaultRowHeight || 14}"/>`;

    let cols = "";
    if (sheet.cols && sheet.cols.length) {
      cols = "<cols>" + sheet.cols.map((c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${c.width || 10}" customWidth="1"/>`
      ).join("") + "</cols>";
    }

    const heights = sheet.rowHeights || [];
    let body = "";
    (sheet.rows || []).forEach((row, r) => {
      const rn = r + 1;
      let cells = "";
      (row || []).forEach((cell, c) => {
        if (cell == null) return;
        const ref = pertXlsxColLetter(c) + rn;
        const s = internStyle(cell.style);
        const sAttr = s ? ` s="${s}"` : "";
        if (cell.k === "s") {
          const idx = internStr(cell.v);
          cells += `<c r="${ref}"${sAttr} t="s"><v>${idx}</v></c>`;
        } else if (cell.k === "n") {
          const v = (cell.v == null || isNaN(cell.v)) ? 0 : cell.v;
          cells += `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
        } else if (cell.k === "d") {
          cells += `<c r="${ref}"${sAttr}><v>${pertXlsxDateSerial(cell.v)}</v></c>`;
        } else if (cell.k === "f") {
          cells += `<c r="${ref}"${sAttr}><f>${pertXlsxEsc(cell.v)}</f></c>`;
        }
      });
      const h = heights[r];
      const hAttr = (h == null) ? "" : ` ht="${h}" customHeight="1"`;
      body += `<row r="${rn}"${hAttr}>${cells}</row>`;
    });

    const merges = (sheet.merges && sheet.merges.length)
      ? `<mergeCells count="${sheet.merges.length}">`
        + sheet.merges.map(m => `<mergeCell ref="${m}"/>`).join("") + "</mergeCells>"
      : "";

    let pageXml = "";
    if (page) {
      if (page.centered) pageXml += `<printOptions horizontalCentered="1" verticalCentered="1"/>`;
      pageXml += `<pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`;
      const attrs = [];
      if (page.paperSize) attrs.push(`paperSize="${page.paperSize}"`);
      if (page.scale && !page.fitToPage) attrs.push(`scale="${page.scale}"`);
      if (page.fitToPage) { attrs.push('fitToWidth="1"'); attrs.push('fitToHeight="0"'); }
      attrs.push(`orientation="${page.orientation || "portrait"}"`);
      pageXml += `<pageSetup ${attrs.join(" ")}/>`;
    } else {
      pageXml = `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`;
    }

    const drawing = (sheet.shapes && sheet.shapes.length) ? `<drawing r:id="rId1"/>` : "";

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`
      + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
      + sheetPr + sheetViews + fmtPr + cols
      + `<sheetData>${body}</sheetData>`
      + merges + pageXml + drawing
      + `</worksheet>`;
  });

  // ── 3) styles.xml (numFmts custom + polices + fills + bordures + cellXfs) ────
  const numFmtsXml = "<numFmts count=\"" + PERT_XLSX_CUSTOM_FMT.length + "\">"
    + PERT_XLSX_CUSTOM_FMT.map(f => `<numFmt numFmtId="${f.id}" formatCode="${f.code}"/>`).join("")
    + "</numFmts>";
  const fontsXml = '<fonts count="' + fontList.length + '">'
    + fontList.map(f =>
        "<font>" + (f.bold ? "<b/>" : "") + (f.italic ? "<i/>" : "")
        + `<sz val="${f.size}"/>`
        + (f.color ? `<color rgb="${pertXlsxArgb(f.color)}"/>` : "")
        + '<name val="Calibri"/></font>'
      ).join("")
    + "</fonts>";
  // fills : 0 none, 1 gray125 (reserves Excel), puis les solides collectes.
  const solidFills = Array.from(fillMap.entries()).sort((a, b) => a[1] - b[1]);
  const fillsXml = '<fills count="' + (2 + solidFills.length) + '">'
    + '<fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + solidFills.map(([argb]) =>
        `<fill><patternFill patternType="solid"><fgColor rgb="${argb}"/><bgColor indexed="64"/></patternFill></fill>`
      ).join("")
    + '</fills>';
  const side = (spec, tag) => {
    if (!spec) return `<${tag}/>`;
    const [style, color] = String(spec).split("#");
    return `<${tag} style="${style}">${color ? `<color rgb="${pertXlsxArgb(color)}"/>` : ""}</${tag}>`;
  };
  const bordersXml = '<borders count="' + borderList.length + '">'
    + borderList.map(b => "<border>" + side(b && b.l, "left") + side(b && b.r, "right")
        + side(b && b.t, "top") + side(b && b.b, "bottom") + "<diagonal/></border>").join("")
    + "</borders>";
  const cellXfsXml = '<cellXfs count="' + xfList.length + '">'
    + xfList.map(xf => {
        const attrs = [`numFmtId="${xf.numFmtId}"`, `fontId="${xf.fontId}"`,
                       `fillId="${xf.fillId}"`, `borderId="${xf.borderId}"`, 'xfId="0"'];
        if (xf.numFmtId) attrs.push('applyNumberFormat="1"');
        if (xf.fontId) attrs.push('applyFont="1"');
        if (xf.fillId) attrs.push('applyFill="1"');
        if (xf.borderId) attrs.push('applyBorder="1"');
        if (!xf.align) return "<xf " + attrs.join(" ") + "/>";
        attrs.push('applyAlignment="1"');
        const a = [];
        if (xf.align.h) a.push(`horizontal="${xf.align.h}"`);
        if (xf.align.v) a.push(`vertical="${xf.align.v}"`);
        if (xf.align.wrap) a.push('wrapText="1"');
        return "<xf " + attrs.join(" ") + `><alignment ${a.join(" ")}/></xf>`;
      }).join("")
    + '</cellXfs>';
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + numFmtsXml + fontsXml + fillsXml + bordersXml
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + cellXfsXml
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + `</styleSheet>`;

  // ── 4) sharedStrings.xml ────────────────────────────────────────────────────
  const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strList.length}" uniqueCount="${strList.length}">`
    + strList.map(s => `<si><t xml:space="preserve">${pertXlsxEsc(s)}</t></si>`).join("")
    + `</sst>`;

  // ── 5) workbook.xml + rels + content types ──────────────────────────────────
  const sheetsMeta = sheets.map((s, i) =>
    `<sheet name="${pertXlsxEsc(s.name || ("Feuille" + (i + 1)))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
  ).join("");
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
    + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets>${sheetsMeta}</sheets></workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + sheets.map((s, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      ).join("")
    + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
    + `</Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`;

  // Une feuille porteuse de formes ajoute trois choses au paquet : la partie
  // drawingN.xml, la relation sheetN → drawingN, et le type de contenu associe.
  const drawingSheets = [];
  sheets.forEach((s, i) => { if (s.shapes && s.shapes.length) drawingSheets.push(i); });

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + sheets.map((s, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      ).join("")
    + drawingSheets.map((si, k) =>
        `<Override PartName="/xl/drawings/drawing${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
      ).join("")
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`
    + `</Types>`;

  // ── 6) Zip (fflate) ─────────────────────────────────────────────────────────
  const S = fflate.strToU8;
  const files = {
    "[Content_Types].xml": S(contentTypes),
    "_rels/.rels": S(rootRels),
    "xl/workbook.xml": S(workbookXml),
    "xl/_rels/workbook.xml.rels": S(wbRels),
    "xl/styles.xml": S(stylesXml),
    "xl/sharedStrings.xml": S(sstXml),
  };
  sheetXmls.forEach((xml, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = S(xml); });
  drawingSheets.forEach((si, k) => {
    files[`xl/drawings/drawing${k + 1}.xml`] = S(pertXlsxDrawingXml(sheets[si].shapes));
    files[`xl/worksheets/_rels/sheet${si + 1}.xml.rels`] = S(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${k + 1}.xml"/>`
      + `</Relationships>`
    );
  });
  return fflate.zipSync(files, { level: 6 });
}

window.pertXlsxText = pertXlsxText;
window.pertXlsxNum = pertXlsxNum;
window.pertXlsxDate = pertXlsxDate;
window.pertXlsxFormula = pertXlsxFormula;
window.pertXlsxColLetter = pertXlsxColLetter;
window.pertXlsxBuild = pertXlsxBuild;
window.pertXlsxPtToEmu = pertXlsxPtToEmu;
window.pertXlsxPxToEmu = pertXlsxPxToEmu;
window.pertXlsxColWidthPx = pertXlsxColWidthPx;
