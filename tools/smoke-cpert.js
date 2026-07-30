// Test cible : import d'un planning CPERT, de bout en bout et dans un vrai navigateur.
//
// Ce que ce test couvre et qu'aucun autre ne couvrait : la LECTURE du classeur.
// smoke-import.js verifie les transformations pures (buildImportModel et ses aides)
// sur des donnees fabriquees en memoire ; ici on part d'un vrai fichier Excel et on
// traverse toute la chaine — dezippage fflate, feuille MANUEL, resolution
// feuille → dessin par les _rels, extraction du DrawingML, puis construction du
// planning. Ce trou existait parce que les seuls CPERT disponibles etaient des
// plannings d'entreprise ; il est comble par tools/make-cpert-fixture.js, qui
// fabrique un classeur au meme format sans aucune donnee reelle.
//
// Le classeur d'essai est concu pour exercer chaque regle de lecture, pieges compris :
// voir la table en tete de make-cpert-fixture.js. Les attendus ci-dessous en
// decoulent directement — si l'un change, c'est la table qu'il faut relire.
//
// Usage : node tools/smoke-cpert.js

const path = require('path');
const fs = require('fs');
const lib = require('./lib');

let pass = 0, fail = 0;
function check(nom, obtenu, attendu) {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  console.log((ok ? '  ok  ' : ' ECHEC') + '  ' + nom +
    (ok ? '' : `  → attendu ${JSON.stringify(attendu)}, obtenu ${JSON.stringify(obtenu)}`));
  ok ? pass++ : fail++;
}

(async () => {
  if (!fs.existsSync(lib.CPERT)) {
    throw new Error('classeur d\'essai absent : ' + lib.CPERT +
      '\n  → node tools/make-cpert-fixture.js');
  }

  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await lib.openApp(page);

  await lib.importXlsm(page, lib.CPERT);

  const vu = await page.evaluate(() => ({
    t0: window.pertMeta.t0,
    unit: window.pertMeta.unit,
    liens: window.pertGraph.links ? Object.keys(window.pertGraph.links).length : 0,
    noeuds: window.pertGraph._nodes.map(n => ({
      type: n.type.replace('pert/', ''),
      label: n.properties.label,
      duration: n.properties.duration,
      due: n.properties.due_date || null,
      x: Math.round(n.pos[0]),
    })),
  }));

  const parLabel = l => vu.noeuds.find(n => n.label === l);

  // ── Feuille MANUEL : les trois cellules de configuration ─────────────────────
  check('T0 lu en K5 (date serie Excel → ISO)', vu.t0, '2026-09-01');
  check('unite lue en J10 (1 = mois)', vu.unit, 'mois');

  // ── Structure : un groupe = un nœud, un connecteur = un lien ─────────────────
  check('7 nœuds importes', vu.noeuds.length, 7);
  check('7 liens importes', vu.liens, 7);
  check('4 taches', vu.noeuds.filter(n => n.type === 'activity').length, 4);
  check('3 jalons (dont le jalon d\'entree E1)', vu.noeuds.filter(n => n.type === 'milestone').length, 3);

  // ── Type deduit de la 1re lettre du nom de groupe ────────────────────────────
  check('E1 materialise en JALON d\'entree', parLabel('Debut de programme').type, 'milestone');
  check('E1 porte la date de sa sous-forme', parLabel('Debut de programme').due, '2026-09-01');
  check('S1 est un jalon', parLabel('Revue de conception').type, 'milestone');
  check('S1 sans date-cible', parLabel('Revue de conception').due, null);
  check('A1 est une tache', parLabel('Etude de faisabilite').type, 'activity');

  // ── Libelle : 1re sous-forme du groupe ───────────────────────────────────────
  check('libelles des taches',
    vu.noeuds.filter(n => n.type === 'activity').map(n => n.label).sort(),
    ['Appro composants', 'Conception mecanique', 'Etude de faisabilite', 'Integration']);

  // ── Duree : sous-forme « duree/marge », et ses trois pieges ──────────────────
  // Le piege principal : A1 porte une DATE (01/11/2026) AVANT sa duree. Sans motif
  // ancre, « 01/11 » serait pris pour « duree/marge » et la duree vaudrait 1.
  check('A1 : la date ne masque pas la duree', parLabel('Etude de faisabilite').duration, 3);
  check('A2 : duree simple', parLabel('Conception mecanique').duration, 4);
  check('A3 : marge indeterminee « 2/? »', parLabel('Appro composants').duration, 2);
  check('A4 : decimale francaise « 1,5/0 »', parLabel('Integration').duration, 1.5);

  // ── Date-cible collee au libelle : « … E=(jj/mm/aaaa) » ──────────────────────
  check('S2 : libelle nettoye de sa date-cible', parLabel('Livraison prototype').type, 'milestone');
  check('S2 : date-cible extraite du libelle', parLabel('Livraison prototype').due, '2027-06-01');

  // ── Disposition : les abscisses du dessin sont conservees, a l'echelle ───────
  // On ne verifie pas des pixels (l'import recentre et met a l'echelle), mais
  // l'ORDRE : un planning importe a plat serait illisible sans qu'aucun autre
  // controle ne s'en apercoive.
  check('E1 est le nœud le plus a gauche',
    vu.noeuds.slice().sort((a, b) => a.x - b.x)[0].label, 'Debut de programme');
  check('S2 est le nœud le plus a droite',
    vu.noeuds.slice().sort((a, b) => b.x - a.x)[0].label, 'Livraison prototype');

  // ── Non-regression sur un CPERT REEL, s'il y en a un ─────────────────────────
  // Un vrai planning porte des centaines de formes et des cas que le classeur
  // d'essai n'anticipe pas. On ne peut rien y affirmer de precis — son contenu est
  // inconnu du test, et il n'est pas versionne — mais on peut exiger qu'il s'importe
  // sans erreur et produise un planning non vide. Absent chez un tiers : normal.
  if (lib.cpertReelPresent()) {
    await page.evaluate(() => { window.pertGraph.clear(); window.pertMeta.t0 = ''; });
    await lib.importXlsm(page, lib.CPERT_REEL, { unitChoice: 'ignore' });
    const reel = await page.evaluate(() => window.pertGraph._nodes.length);
    check('CPERT reel : planning non vide (' + path.basename(lib.CPERT_REEL) + ')', reel > 1, true);
  } else {
    console.log('  (non-regression CPERT reel ignoree : aucun classeur reel — cf. tools/README.md)');
  }

  console.log('\nErreurs console/page:', errors.length ? errors : 'aucune');
  if (errors.length) fail++;
  console.log(`${pass} assertion(s) OK, ${fail} echec(s).`);
  await browser.close();
  if (fail) { console.log('\n=== SMOKE CPERT FAIL ==='); process.exit(1); }
  console.log('\n=== SMOKE CPERT OK ===');
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
