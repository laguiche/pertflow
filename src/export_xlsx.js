// ─── Mini-writer XLSX (sur fflate) — Session 9 ──────────────────────────────────
//
// Un .xlsx est un ZIP de fichiers XML (Office Open XML). On le fabrique a la main
// avec fflate (lib/fflate.min.js, MIT, deja present pour l'import) — AUCUNE
// dependance supplementaire (SheetJS est Apache-2.0, exclu par la regle « MIT
// uniquement »). Le writer est volontairement minimal mais couvre ce dont les
// exports Gantt/micro-jalonnement ont besoin : cellules texte / nombre / date /
// formule, formats de nombre et de date, remplissage (fills) de couleur, gras,
// largeurs de colonnes, plusieurs feuilles.
//
// API :
//   pertXlsxText(v, style?)     cellule texte (partagee via sharedStrings)
//   pertXlsxNum(v, style?)      cellule nombre
//   pertXlsxDate(dateObj,style?) cellule date (serial Excel + format date)
//   pertXlsxFormula(f, style?)  cellule formule (ex. "SUM(D2:D12)")  — sans '='
//   null / undefined            cellule vide
//   style = { fmt, bold, fill } ; fmt ∈ {null,"num2","date-mmm-yy","date-d-mmm-yy"}
//                                 fill = "#RRGGBB" ou null ; bold = booleen
//   pertXlsxBuild(sheets) → Uint8Array (zip)
//     sheets = [{ name, cols?, rows }]
//       cols = [{ width }]   (largeurs de colonnes, optionnel)
//       rows = [[cell, cell, ...], ...]
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

// Cle canonique d'un style (pour dedup en cellXfs).
function pertXlsxStyleKey(st) {
  if (!st) return "";
  return (st.fmt || "") + "|" + (st.bold ? "1" : "0") + "|" + (st.fill || "");
}

// Construit le classeur complet et renvoie le zip (Uint8Array).
function pertXlsxBuild(sheets) {
  // ── 1) Collecte des sharedStrings, des styles et des fills ──────────────────
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

  const xfMap = new Map();        // cle style → index cellXfs
  const xfList = [];              // { numFmtId, fontId, fillId }
  xfMap.set("", 0);
  xfList.push({ numFmtId: 0, fontId: 0, fillId: 0 }); // style par defaut (index 0)
  function internStyle(st) {
    const key = pertXlsxStyleKey(st);
    if (xfMap.has(key)) return xfMap.get(key);
    const numFmtId = st && st.fmt ? (PERT_XLSX_NUMFMT[st.fmt] || 0) : 0;
    const fontId = st && st.bold ? 1 : 0;
    const fillId = st && st.fill ? internFill(st.fill) : 0;
    const i = xfList.length;
    xfList.push({ numFmtId, fontId, fillId });
    xfMap.set(key, i);
    return i;
  }

  // ── 2) Emission des feuilles (references string/style resolues ici) ─────────
  const sheetXmls = sheets.map(sheet => {
    let cols = "";
    if (sheet.cols && sheet.cols.length) {
      cols = "<cols>" + sheet.cols.map((c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${c.width || 10}" customWidth="1"/>`
      ).join("") + "</cols>";
    }
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
      body += `<row r="${rn}">${cells}</row>`;
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + cols + `<sheetData>${body}</sheetData></worksheet>`;
  });

  // ── 3) styles.xml (numFmts custom + 2 fonts + fills + cellXfs) ──────────────
  const numFmtsXml = "<numFmts count=\"" + PERT_XLSX_CUSTOM_FMT.length + "\">"
    + PERT_XLSX_CUSTOM_FMT.map(f => `<numFmt numFmtId="${f.id}" formatCode="${f.code}"/>`).join("")
    + "</numFmts>";
  const fontsXml = '<fonts count="2">'
    + '<font><sz val="11"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>';
  // fills : 0 none, 1 gray125 (reserves Excel), puis les solides collectes.
  const solidFills = Array.from(fillMap.entries()).sort((a, b) => a[1] - b[1]);
  const fillsXml = '<fills count="' + (2 + solidFills.length) + '">'
    + '<fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + solidFills.map(([argb]) =>
        `<fill><patternFill patternType="solid"><fgColor rgb="${argb}"/><bgColor indexed="64"/></patternFill></fill>`
      ).join("")
    + '</fills>';
  const cellXfsXml = '<cellXfs count="' + xfList.length + '">'
    + xfList.map(xf => {
        const attrs = [`numFmtId="${xf.numFmtId}"`, `fontId="${xf.fontId}"`,
                       `fillId="${xf.fillId}"`, 'borderId="0"', 'xfId="0"'];
        if (xf.numFmtId) attrs.push('applyNumberFormat="1"');
        if (xf.fontId) attrs.push('applyFont="1"');
        if (xf.fillId) attrs.push('applyFill="1"');
        return "<xf " + attrs.join(" ") + "/>";
      }).join("")
    + '</cellXfs>';
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + numFmtsXml + fontsXml + fillsXml
    + '<borders count="1"><border/></borders>'
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

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + sheets.map((s, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
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
  return fflate.zipSync(files, { level: 6 });
}

window.pertXlsxText = pertXlsxText;
window.pertXlsxNum = pertXlsxNum;
window.pertXlsxDate = pertXlsxDate;
window.pertXlsxFormula = pertXlsxFormula;
window.pertXlsxColLetter = pertXlsxColLetter;
window.pertXlsxBuild = pertXlsxBuild;
