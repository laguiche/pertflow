// Captures d'ecran pour le manuel — fenetre de synthese en QUATRE onglets :
//   synthese.png          → onglet « Générique » (remplace la capture d'avant onglets)
//   synthese-analyse.png  → onglet « Analyse » et ses points d'attention
// Usage : node tools/doc-shots-synthese-onglets.js — sorties dans docs/images/manuel/.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');
const FIXTURE = path.join(lib.EXEMPLES, 'pert_a_exporter.pert');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1440, height: 940 } });
  await lib.openApp(page);

  const data = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  await page.evaluate((d) => { pertApplyProject(d); }, data);
  await page.waitForTimeout(300);

  const shotDialog = async (name) => {
    await page.waitForTimeout(250);
    await page.locator('.synthesis-dialog-box').screenshot({ path: path.join(OUT, name) });
    console.log('  ✓', name);
  };

  // ── Onglet « Générique » sur le planning de demonstration tel quel ───────────
  await page.evaluate(() => { pertOpenSynthesisDialog(); pertSelectSynthTab('generique'); });
  await shotDialog('synthese.png');

  // ── Onglet « Analyse » ───────────────────────────────────────────────────────
  // Le planning de demonstration est presque sain : tel quel, l'onglet ne montrerait
  // qu'un seul controle, ce qui illustre mal la fonction. On y ajoute donc DELIBEREMENT
  // deux anomalies typiques — un jalon orphelin, et un doublon de nom entre un jalon
  // sortant et un jalon entrant — pour que la capture montre ce que l'utilisateur
  // cherchera a comprendre. La fixture sur disque n'est pas modifiee.
  await page.evaluate(() => {
    pertCloseSynthesisDialog();
    const g = window.pertGraph;
    const sortant = g._nodes.find(n => n.type === 'pert/milestone'
      && (n.properties.label || '').toLowerCase().indexOf('sortie') !== -1);

    // Doublon : meme nom qu'un jalon sortant, mais en entree d'une autre tache.
    const dup = LiteGraph.createNode('pert/milestone');
    dup.properties.label = sortant ? sortant.properties.label : 'Livraison';
    dup.properties.due_mode = 'date'; dup.properties.due_date = '2027-04-01';
    dup.updateSize(); g.add(dup); dup.pos = [1500, 500];
    const suite = LiteGraph.createNode('pert/activity');
    suite.properties.label = 'Intégration client'; suite.properties.duration = 3;
    suite.updateSize(); g.add(suite); suite.pos = [1500, 700];
    dup.connect(0, suite, suite.inputs.length - 1);

    // Orphelin : aucun lien.
    const orph = LiteGraph.createNode('pert/milestone');
    orph.properties.label = 'Revue de sécurité';
    orph.properties.due_mode = 'date'; orph.properties.due_date = '2027-02-15';
    orph.updateSize(); g.add(orph); orph.pos = [1500, 900];

    pertRecalc();
    pertOpenSynthesisDialog();
    pertSelectSynthTab('analyse');
  });
  await shotDialog('synthese-analyse.png');

  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
