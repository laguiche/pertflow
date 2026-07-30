// Capture d'ecran pour le manuel — onglet « Synthèse » du panneau lateral :
// valeurs calculees + predecesseurs / successeurs.
// On choisit un nœud du planning de demonstration qui a DEUX predecesseurs et au
// moins un successeur : c'est le cas ou la liste apporte le plus, et celui que le
// manuel decrit. Usage : node tools/doc-shots-panneau-synthese.js

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');
const FIXTURE = path.join(lib.EXEMPLES, 'pert_a_exporter.pert');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1440, height: 1000 } });
  await lib.openApp(page);

  // Chargement du planning de demonstration officiel (meme fixture que les autres
  // captures du manuel, pour que les noms de taches concordent d'une image a l'autre).
  const data = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  await page.evaluate((d) => { pertApplyProject(d); }, data);
  await page.waitForTimeout(400);

  // Nœud le mieux entoure : on le cherche plutot que de le coder en dur, la fixture
  // ayant deja change de contenu par le passe.
  const choisi = await page.evaluate(() => {
    const g = window.pertGraph;
    const { preds, succs } = pertBuildAdjacency(g);
    let best = null, score = -1;
    g._nodes.forEach(n => {
      if (n.type !== 'pert/activity') return;
      const p = (preds[n.id] || []).length, s = (succs[n.id] || []).length;
      if (!p || !s) return;
      if (p + s > score) { score = p + s; best = n; }
    });
    if (!best) return null;
    window.pertCanvas.selectNode(best, false);
    showProperties(best);
    pertSelectPanelTab('synthese');
    return { label: best.properties.label, voisins: score };
  });
  if (!choisi) throw new Error('aucun nœud avec predecesseurs ET successeurs dans la fixture');
  console.log('  nœud retenu :', choisi.label, '(' + choisi.voisins + ' voisins)');

  await page.waitForTimeout(300);
  await page.locator('#properties-panel').screenshot({
    path: path.join(OUT, 'panneau-synthese.png')
  });
  console.log('  ✓ panneau-synthese.png');

  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
