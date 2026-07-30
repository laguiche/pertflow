// Fabrique un classeur au FORMAT CPERT, de toutes pieces et sans donnee reelle.
//
//   node tools/make-cpert-fixture.js            → test_cases/cpert_synthetique.xlsx
//   node tools/make-cpert-fixture.js /tmp/x.xlsx
//
// ─── Pourquoi ce script existe ────────────────────────────────────────────────────
//
// L'import CPERT est une fonction majeure de PertFlow, et c'etait la seule qu'aucun
// tiers ne pouvait tester : les seuls classeurs CPERT existants sont des plannings
// d'entreprise, impubliables. Les tests couvraient donc les transformations pures
// (buildImportModel et ses aides, sur des donnees fabriquees en memoire), mais jamais
// la LECTURE du fichier -- dezippage, resolution feuille → dessin, extraction du
// DrawingML. Ce script comble ce trou en fabriquant un classeur minimal mais vrai.
//
// Il vaut aussi comme documentation executable du format : ce que PertFlow lit
// reellement dans un CPERT tient dans les quelques structures ci-dessous.
//
// ─── Ce que PertFlow lit dans un CPERT (et rien d'autre) ──────────────────────────
//
//   1. Feuille « MANUEL » : K2 = nom de la feuille PERT, K5 = T0 (date serie Excel),
//      J10 = unite (1 = mois, 2 = semaines).
//   2. La feuille nommee en K2, pour son DESSIN associe (xl/drawings/drawingN.xml,
//      resolu par les _rels de la feuille).
//   3. Dans ce dessin : les GROUPES (un par nœud) et les CONNECTEURS (un par lien).
//      - le NOM du groupe donne le type : « S… » = jalon, « E… » = jalon d'entree,
//        tout le reste = tache ;
//      - la 1re sous-forme du groupe porte le LIBELLE ;
//      - une sous-forme de la forme « duree/marge » donne la DUREE ;
//      - un connecteur relie deux sous-formes (a:stCxn / a:endCxn), et c'est le
//        GROUPE PARENT de chacune qui fait le lien.
//
// Le classeur produit est un .xlsx : sans macro, donc pleinement valide et ouvrable
// tel quel. Un vrai CPERT est un .xlsm parce qu'il embarque la macro de l'outil
// d'origine -- que PertFlow ne lit jamais. Le selecteur d'import accepte les deux.
//
// Aucune dependance npm (contrainte du projet) : le zip est fait par la commande
// « zip » du systeme, comme dans scripts/make-release.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SORTIE = process.argv[2] ||
  path.join(__dirname, '..', 'test_cases', 'cpert_synthetique.xlsx');

// ─── Le planning de reference ─────────────────────────────────────────────────────
//
// Sept nœuds et sept liens, choisis pour exercer CHAQUE regle de lecture, y compris
// les pieges deja rencontres. Ce n'est pas un planning realiste : c'est un banc
// d'essai. Les libelles sont inventes.
//
//   nom   : nom du GROUPE dans le dessin — sa 1re lettre porte le type
//   px    : position en pixels (convertie en EMU), pour que l'import soit lisible
//   subs  : sous-formes DANS L'ORDRE, la 1re etant le libelle
const T0 = '2026-09-01';              // ecrit en K5 de MANUEL, en date serie Excel
const UNITE = 1;                      // J10 : 1 = mois (comme les CPERT reels)
const FEUILLE_PERT = 'PERT';          // K2

const NŒUDS = [
  // Jalon d'ENTREE : pas de libelle date-cible, mais une sous-forme qui porte une
  // date → c'est elle qui donne la date du jalon (et le T0 de secours si MANUEL
  // n'en fournit pas).
  { nom: 'E1', px: [40, 210], subs: ['Debut de programme', '01/09/2026'] },

  // Tache dont la DATE precede la DUREE dans l'ordre des sous-formes. C'est le
  // piege : sans motif ancre (^…$), « 01/11/2026 » serait lu comme la duree « 1 »
  // (deux slashes, comme « duree/marge »). Ce nœud verrouille cette regression.
  { nom: 'A1', px: [250, 210], subs: ['Etude de faisabilite', '01/11/2026', '3/0'] },

  { nom: 'A2', px: [470, 110], subs: ['Conception mecanique', '4/1'] },

  // Marge INDETERMINEE : le CPERT ecrit « ? » quand il ne sait pas la calculer.
  // Seule la duree doit etre lue.
  { nom: 'A3', px: [470, 310], subs: ['Appro composants', '2/?'] },

  // Duree DECIMALE a la francaise (virgule) : 1,5 mois.
  { nom: 'A4', px: [700, 210], subs: ['Integration', '1,5/0'] },

  // Jalon SANS date-cible.
  { nom: 'S1', px: [700, 40], subs: ['Revue de conception'] },

  // Jalon AVEC date-cible collee au libelle, notation « E=(jj/mm/aaaa) ».
  { nom: 'S2', px: [930, 210], subs: ['Livraison prototype E=(01/06/2027)'] },
];

// Liens, par nom de groupe. Le dessin, lui, relie des SOUS-FORMES : on connecte la
// 1re sous-forme de chaque groupe, et l'import remonte au groupe parent.
const LIENS = [
  ['E1', 'A1'], ['A1', 'A2'], ['A1', 'A3'],
  ['A2', 'A4'], ['A3', 'A4'], ['A2', 'S1'], ['A4', 'S2'],
];

// ─── Fabrication ──────────────────────────────────────────────────────────────────

const EMU = 9525;                     // 1 pixel = 9525 EMU (cf. PertExcel.EMU_PER_PX)

// Date ISO → date serie Excel (epoque 1899-12-30, qui absorbe le bug de l'an 1900).
function serieExcel(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  return Math.round((Date.UTC(a, m - 1, j) - Date.UTC(1899, 11, 30)) / 86400000);
}

function echapper(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Les identifiants de formes doivent etre uniques dans TOUT le dessin : le groupe i
// prend 100 + 10*i, ses sous-formes les numeros suivants. C'est ce qui permet a un
// connecteur de designer une sous-forme sans ambiguite.
const idGroupe = i => 100 + 10 * i;
const idSub = (i, j) => idGroupe(i) + 1 + j;
const indexDe = nom => NŒUDS.findIndex(n => n.nom === nom);

function formeXml(id, nom, x, y, texte) {
  return `      <xdr:sp macro="" textlink="">
        <xdr:nvSpPr>
          <xdr:cNvPr id="${id}" name="${echapper(nom)}"/>
          <xdr:cNvSpPr/>
        </xdr:nvSpPr>
        <xdr:spPr>
          <a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${170 * EMU}" cy="${26 * EMU}"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </xdr:spPr>
        <xdr:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p><a:r><a:t>${echapper(texte)}</a:t></a:r></a:p>
        </xdr:txBody>
      </xdr:sp>`;
}

function groupeXml(n, i) {
  const [px, py] = n.px;
  const x = px * EMU, y = py * EMU;
  const cx = 180 * EMU, cy = (30 + 28 * n.subs.length) * EMU;
  // L'import lit la position du groupe dans le PREMIER <a:off> rencontre, celui de
  // grpSpPr/xfrm — d'ou l'ordre : grpSpPr avant les sous-formes.
  const formes = n.subs
    .map((t, j) => formeXml(idSub(i, j), 'Texte ' + (j + 1), x + 5 * EMU, y + (10 + 28 * j) * EMU, t))
    .join('\n');
  return `  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>${1 + i}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${1 + i}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>${3 + i}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${5 + i}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:grpSp>
      <xdr:nvGrpSpPr>
        <xdr:cNvPr id="${idGroupe(i)}" name="${echapper(n.nom)}"/>
        <xdr:cNvGrpSpPr/>
      </xdr:nvGrpSpPr>
      <xdr:grpSpPr>
        <a:xfrm>
          <a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/>
          <a:chOff x="${x}" y="${y}"/><a:chExt cx="${cx}" cy="${cy}"/>
        </a:xfrm>
      </xdr:grpSpPr>
${formes}
    </xdr:grpSp>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`;
}

function lienXml([de, vers], k) {
  const i = indexDe(de), j = indexDe(vers);
  if (i < 0 || j < 0) throw new Error('lien vers un nœud inconnu : ' + de + '→' + vers);
  return `  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:cxnSp macro="">
      <xdr:nvCxnSpPr>
        <xdr:cNvPr id="${500 + k}" name="Connecteur ${k + 1}"/>
        <xdr:cNvCxnSpPr>
          <a:stCxn id="${idSub(i, 0)}" idx="3"/>
          <a:endCxn id="${idSub(j, 0)}" idx="1"/>
        </xdr:cNvCxnSpPr>
      </xdr:nvCxnSpPr>
      <xdr:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="${100 * EMU}" cy="0"/></a:xfrm>
        <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
      </xdr:spPr>
    </xdr:cxnSp>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

const fichiers = {
  '[Content_Types].xml': XML +
`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,

  '_rels/.rels': XML +
`<Relationships xmlns="${NS_PKG}">
  <Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,

  'xl/workbook.xml': XML +
`<workbook xmlns="${NS_SS}" xmlns:r="${NS_REL}">
  <sheets>
    <sheet name="MANUEL" sheetId="1" r:id="rId1"/>
    <sheet name="${FEUILLE_PERT}" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`,

  'xl/_rels/workbook.xml.rels': XML +
`<Relationships xmlns="${NS_PKG}">
  <Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="${NS_REL}/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId4" Type="${NS_REL}/styles" Target="styles.xml"/>
</Relationships>`,

  // MANUEL : seules trois cellules comptent, a des references FIXES (CPERT 6.14.x).
  // Les libelles voisins ne servent qu'a rendre le classeur lisible a l'ouverture.
  'xl/worksheets/sheet1.xml': XML +
`<worksheet xmlns="${NS_SS}">
  <sheetData>
    <row r="2">
      <c r="J2" t="s"><v>1</v></c>
      <c r="K2" t="s"><v>0</v></c>
    </row>
    <row r="5">
      <c r="J5" t="s"><v>2</v></c>
      <c r="K5"><v>${serieExcel(T0)}</v></c>
    </row>
    <row r="10">
      <c r="I10" t="s"><v>3</v></c>
      <c r="J10"><v>${UNITE}</v></c>
    </row>
  </sheetData>
</worksheet>`,

  // La feuille PERT n'a aucune donnee de cellule : tout le planning est dans son
  // DESSIN. C'est la particularite du format, et la raison d'etre de cet import.
  'xl/worksheets/sheet2.xml': XML +
`<worksheet xmlns="${NS_SS}" xmlns:r="${NS_REL}">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`,

  'xl/worksheets/_rels/sheet2.xml.rels': XML +
`<Relationships xmlns="${NS_PKG}">
  <Relationship Id="rId1" Type="${NS_REL}/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`,

  'xl/drawings/drawing1.xml': XML +
`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
${NŒUDS.map(groupeXml).join('\n')}
${LIENS.map(lienXml).join('\n')}
</xdr:wsDr>`,

  'xl/sharedStrings.xml': XML +
`<sst xmlns="${NS_SS}" count="4" uniqueCount="4">
  <si><t>${FEUILLE_PERT}</t></si>
  <si><t>Feuille du PERT</t></si>
  <si><t>Date de debut (T0)</t></si>
  <si><t>Unite (1=mois, 2=semaines)</t></si>
</sst>`,

  'xl/styles.xml': XML +
`<styleSheet xmlns="${NS_SS}">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`,
};

// Un zip enregistre la DATE DE MODIFICATION de chaque entree. Sans precaution, deux
// generations du meme contenu donnent donc deux fichiers differents, et chaque
// regeneration polluerait le diff git d'un binaire « modifie » sans rien changer.
// D'ou une date figee, arbitraire mais constante, posee sur chaque fichier temporaire
// avant l'archivage. (-X, lui, retire les attributs propres a la machine : uid/gid et
// champs etendus.) Le resultat est reproductible a implementation de « zip » egale.
const DATE_FIGEE = new Date('2026-07-31T00:00:00Z');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpert-'));
const ecrits = [];
for (const [rel, contenu] of Object.entries(fichiers)) {
  const dest = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, contenu, 'utf8');
  ecrits.push(dest);
}
// Les repertoires aussi : zip -r les archive comme des entrees a part entiere.
for (const d of new Set(ecrits.map(f => path.dirname(f)))) {
  let cur = d;
  while (cur !== tmp) { ecrits.push(cur); cur = path.dirname(cur); }
}
for (const f of ecrits) fs.utimesSync(f, DATE_FIGEE, DATE_FIGEE);

fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
fs.rmSync(SORTIE, { force: true });
cp.execFileSync('zip', ['-q', '-X', '-r', path.resolve(SORTIE), '.'], { cwd: tmp });
fs.rmSync(tmp, { recursive: true, force: true });

console.log('Classeur CPERT synthetique ecrit : ' + path.relative(path.join(__dirname, '..'), SORTIE));
console.log('  ' + NŒUDS.length + ' nœuds, ' + LIENS.length + ' liens, T0 ' + T0 +
            ', unite ' + (UNITE === 2 ? 'semaines' : 'mois'));
