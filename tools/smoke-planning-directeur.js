// Test cible : export « Planning directeur » (Excel), v0.23.
//
// Ce que ce test protege, dans l'ordre d'importance :
//   1. L'AGENCEMENT DU PERT est conserve. C'est la demande explicite de l'utilisateur
//      (21/08/2026) : l'ordonnee d'une forme suit celle du nœud sur le canvas, et son
//      abscisse suit ses DATES. Les deux regles sont verifiees separement, sur des
//      valeurs relues depuis les nœuds — jamais depuis le modele d'export, qui serait
//      alors juge de sa propre copie.
//   2. Le classeur est REELLEMENT porteur de ses formes. Un .xlsx a qui il manque la
//      relation feuille → dessin ou son type de contenu s'ouvre sans erreur, sur une
//      grille vide : la panne la plus couteuse ici est celle qui ne se voit pas.
//   3. Le canevas est respecte : en-tete annees / trimestres / mois coherent, colonnes
//      de nomenclature vides mais mises en forme, panneaux figes, paysage, et AUCUN
//      connecteur (regle de cadrage explicite).
//
// Usage : node tools/smoke-planning-directeur.js

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

function assert(cond, msg) { if (!cond) throw new Error('ECHEC: ' + msg); }

const LETTRES = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const TRIM = ['1er Tri.', '2ème Tri.', '3ème Tri.', '4ème Tri.'];

// Colonne Excel ("D", "AB"…) → indice 0-based.
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await lib.openApp(page);
  const pert = JSON.parse(fs.readFileSync(path.join(lib.EXEMPLES, 'pert_a_exporter.pert'), 'utf8'));

  const res = await page.evaluate((data) => {
    pertApplyProject(data);
    const bytes = pertBuildPlanningDirecteurXlsx(pertPlanningDirecteurModel());
    const dec = new TextDecoder();
    const zip = fflate.unzipSync(bytes);
    const part = (n) => zip[n] ? dec.decode(zip[n]) : null;

    // Attendus releves sur les NŒUDS eux-memes (pos, es/ef, dates), sans repasser par
    // le modele d'export : c'est ce qui permet au test de contredire l'export.
    const attendus = pertGraph._nodes
      .filter(n => n.type === 'pert/activity' || n.type === 'pert/milestone')
      .map(n => {
        const jalon = n.type === 'pert/milestone';
        const due = jalon ? pertMilestoneDueOffset(n) : null;
        const off = jalon ? (due != null ? due : (n.ef != null ? n.ef : 0)) : n.es;
        const d = pertOffsetToDate(off);
        return {
          nom: (jalon ? 'Jalon ' : 'Tache ') + n.properties.label,
          jalon, cy: n.pos[1] + n.size[1] / 2,
          annee: d.getFullYear(), mois: d.getMonth(),
        };
      });

    return {
      parts: Object.keys(zip).sort(),
      sheet: part('xl/worksheets/sheet1.xml'),
      rels: part('xl/worksheets/_rels/sheet1.xml.rels'),
      types: part('[Content_Types].xml'),
      drawing: part('xl/drawings/drawing1.xml'),
      sst: part('xl/sharedStrings.xml'),
      attendus,
      nLabels: pertGraph._nodes.filter(n => n.type === 'pert/label').length,
      magic: [bytes[0], bytes[1]],
    };
  }, pert);

  // ── 1) Le paquet porte bien son dessin ───────────────────────────────────────
  assert(res.magic[0] === 0x50 && res.magic[1] === 0x4B, 'magic PK (zip) attendu');
  assert(res.parts.indexOf('xl/drawings/drawing1.xml') !== -1, 'partie drawing1.xml absente');
  assert(/Target="\.\.\/drawings\/drawing1\.xml"/.test(res.rels || ''),
         'relation feuille → dessin absente (le classeur s\'ouvrirait sur une grille vide)');
  assert(/PartName="\/xl\/drawings\/drawing1\.xml"/.test(res.types),
         'type de contenu du dessin absent');
  assert(/<drawing r:id="rId1"\/>/.test(res.sheet), '<drawing> absent de la feuille');

  // ── 2) Chaines partagees : on en aura besoin pour relire l'en-tete ────────────
  const sst = (res.sst.match(/<t[^>]*>(.*?)<\/t>/g) || [])
    .map(s => s.replace(/<[^>]+>/g, ''));

  // Cellules de la feuille : { ref → { s, texte } }
  const cells = {};
  (res.sheet.match(/<c r="[^"]+"[^>]*(?:\/>|>.*?<\/c>)/g) || []).forEach(c => {
    const ref = /r="([^"]+)"/.exec(c)[1];
    const st = /s="(\d+)"/.exec(c);
    const v = /<v>(\d+)<\/v>/.exec(c);
    const partage = / t="s"/.test(c);
    cells[ref] = { s: st ? +st[1] : 0, texte: (partage && v) ? sst[+v[1]] : null };
  });

  // ── 3) En-tete calendaire coherent de bout en bout ───────────────────────────
  // On ne compare pas a des mois codes en dur : on verifie que les trois lignes
  // racontent la MEME chose (le mois M de l'annee A tombe bien dans son trimestre),
  // et que la suite des mois est continue. Un decalage d'une colonne casse la
  // coherence, quelle que soit la periode couverte par le planning.
  const moisCols = Object.keys(cells).filter(r => /^[A-Z]+4$/.test(r)).map(colIndex).sort((a, b) => a - b);
  assert(moisCols.length > 0, 'aucune colonne de mois en ligne 4');
  assert(moisCols[0] === 3, 'la grille doit commencer en colonne D, vu ' + moisCols[0]);

  const suite = moisCols.map(c => LETTRES.indexOf(cells[colLetter(c) + '4'].texte));
  // Les initiales sont ambigues (J, M, A reviennent deux fois) : on reconstitue la
  // suite reelle des mois a partir de la ligne des ANNEES, puis on verifie que chaque
  // initiale correspond. C'est ce croisement qui rend l'en-tete verifiable.
  let annee = null, mois = null;
  moisCols.forEach((c, i) => {
    const ref = colLetter(c) + '2';
    if (cells[ref] && cells[ref].texte) {
      const a = parseInt(cells[ref].texte, 10);
      if (!isNaN(a)) { if (annee !== null) assert(a === annee + 1, 'annees non consecutives'); annee = a; }
    }
    if (i === 0) mois = res.attendus.reduce((m, x) => Math.min(m, x.annee * 12 + x.mois), Infinity) % 12;
    else mois = (mois + 1) % 12;
    assert(LETTRES[mois] === cells[colLetter(c) + '4'].texte,
           'initiale du mois en colonne ' + colLetter(c) + ' : attendu ' + LETTRES[mois]
           + ', vu ' + cells[colLetter(c) + '4'].texte);
    const t = cells[colLetter(c) + '3'];
    if (t && t.texte) assert(t.texte === TRIM[Math.floor(mois / 3)],
           'trimestre en colonne ' + colLetter(c) + ' : attendu ' + TRIM[Math.floor(mois / 3)] + ', vu ' + t.texte);
  });
  console.log('En-tete : ' + moisCols.length + ' mois, de ' + cells['D4'].texte + ' a '
              + cells[colLetter(moisCols[moisCols.length - 1]) + '4'].texte);

  // ── 4) Une forme par nœud, du bon type, et AUCUN connecteur ──────────────────
  const formes = [];
  const re = /<xdr:twoCellAnchor>(.*?)<\/xdr:twoCellAnchor>/g;
  let m;
  while ((m = re.exec(res.drawing)) !== null) {
    const b = m[1];
    const from = /<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>(\d+)<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row><xdr:rowOff>(\d+)<\/xdr:rowOff><\/xdr:from>/.exec(b);
    formes.push({
      nom: /name="([^"]*)"/.exec(b)[1],
      geom: /prst="(\w+)"/.exec(b)[1],
      col: +from[1], colOff: +from[2], row: +from[3], rowOff: +from[4],
    });
  }
  assert(!/<xdr:cxnSp/.test(res.drawing), 'aucun connecteur ne doit etre trace');
  assert(!/prst="(line|bentConnector3|curvedConnector3|straightConnector1)"/.test(res.drawing),
         'aucune forme de type liaison ne doit etre tracee');

  const nAct = res.attendus.filter(a => !a.jalon).length;
  const nMs = res.attendus.filter(a => a.jalon).length;
  assert(formes.filter(f => f.geom === 'roundRect').length === nAct,
         nAct + ' barres attendues (une par Activite), vu ' + formes.filter(f => f.geom === 'roundRect').length);
  assert(formes.filter(f => f.geom === 'diamond' && /^Jalon /.test(f.nom)).length === nMs,
         nMs + ' losanges attendus (un par Jalon), vu '
         + formes.filter(f => f.geom === 'diamond' && /^Jalon /.test(f.nom)).length);

  // ── 5) ABSCISSE = les dates du PERT ──────────────────────────────────────────
  const parNom = {};
  formes.forEach(f => { if (!parNom[f.nom]) parNom[f.nom] = f; });
  const mois0 = res.attendus.reduce((acc, a) => Math.min(acc, a.annee * 12 + a.mois), Infinity);
  res.attendus.filter(a => !a.jalon).forEach(a => {
    const f = parNom[a.nom];
    assert(f, 'forme introuvable pour ' + a.nom);
    const attendu = 3 + (a.annee * 12 + a.mois - mois0);
    assert(f.col === attendu,
           a.nom + ' : colonne de debut attendue ' + colLetter(attendu) + ' (mois de son ES), vu ' + colLetter(f.col));
  });
  console.log('Abscisses : ' + nAct + ' barres posees sur le mois de leur ES');

  // ── 6) ORDONNEE = l'agencement du canvas ─────────────────────────────────────
  // Le contrat n'est pas « telle forme a telle hauteur » mais « l'ORDRE vertical du
  // canvas est conserve » : deux nœuds separes sur le canvas restent separes, dans le
  // meme sens, dans le classeur.
  const ordonnees = res.attendus.map(a => ({
    nom: a.nom, cy: a.cy,
    y: (parNom[a.nom].row * 1e9) + parNom[a.nom].rowOff,   // cle de tri (ligne, puis offset)
  }));
  ordonnees.sort((p, q) => p.cy - q.cy);
  for (let i = 1; i < ordonnees.length; i++) {
    if (ordonnees[i].cy - ordonnees[i - 1].cy < 1) continue;   // meme hauteur sur le canvas
    assert(ordonnees[i].y >= ordonnees[i - 1].y,
           'ordre vertical rompu : ' + ordonnees[i - 1].nom + ' (canvas y=' + Math.round(ordonnees[i - 1].cy)
           + ') doit rester au-dessus de ' + ordonnees[i].nom + ' (canvas y=' + Math.round(ordonnees[i].cy) + ')');
  }
  console.log('Ordonnees : ordre vertical du canvas conserve sur ' + ordonnees.length + ' nœuds');

  // ── 7) Canevas : colonnes de nomenclature, panneaux figes, mise en page ──────
  assert(cells['B5'] && cells['B5'].s > 0 && cells['B5'].texte === '',
         'colonne B : cellule vide MAIS mise en forme attendue (nomenclature a remplir)');
  assert(cells['C5'] && cells['C5'].s > 0 && cells['C5'].texte === '',
         'colonne C : cellule vide MAIS mise en forme attendue');
  assert(/xSplit="3"/.test(res.sheet) && /ySplit="4"/.test(res.sheet), 'panneaux figes attendus (D5)');
  assert(/showGridLines="0"/.test(res.sheet), 'quadrillage a l\'ecran a masquer');
  assert(/orientation="landscape"/.test(res.sheet), 'mise en page paysage attendue');
  assert(/<mergeCell ref="/.test(res.sheet), 'fusions attendues (annees et trimestres)');

  // ── 8) Legende ───────────────────────────────────────────────────────────────
  assert(formes.some(f => f.nom === 'Legende'), 'encart de legende attendu');
  const pastilles = formes.filter(f => /^Legende pastille /.test(f.nom));
  assert(pastilles.length >= 1, 'au moins une pastille de couleur attendue dans la legende');
  console.log('Legende : ' + pastilles.length + ' entrees');

  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  assert(errors.length === 0, 'erreurs console');

  console.log('\n=== SMOKE PLANNING DIRECTEUR OK ===');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });

function colLetter(i) {
  let s = '';
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
