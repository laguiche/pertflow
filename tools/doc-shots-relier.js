// Captures pour le MANUEL — fenêtre « Relier à… » :
//   relier-menu.png     — l'entrée « 🔗 Relier à… » du menu contextuel d'un nœud
//   relier-fenetre.png  — la fenêtre elle-même, avec ses deux statuts bloquants
//   relier-panneau.png  — le second point d'entrée, en tête du voisinage du panneau
//
// Le planning de démonstration est VOLONTAIREMENT étalé (plus large que l'écran) :
// c'est la situation qui motive la fonctionnalité, et une capture prise sur trois
// nœuds côte à côte ne la raconterait pas.
//
// Usage : node tools/doc-shots-relier.js — sortie dans docs/images/manuel/.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');

// Planning de démonstration : trois lots, deux responsables par lot, un jalon de revue
// déjà relié à une tâche — de quoi montrer un candidat « déjà lié » ET un candidat
// « boucle » dans la même capture.
function projet() {
  const g = window.pertGraph; g.clear();
  window.pertMeta.title = 'Ligne de conditionnement';
  window.pertMeta.t0 = '2026-01-05';
  window.pertMeta.unit = 'j';
  window.pertMeta.groups = { 'WP1 Études': '#4A90D9', 'WP2 Achats': '#F5A623', 'WP3 Essais': '#7E57C2' };
  const link = (s, d) => s.connect(0, d, d.inputs.length - 1);
  const act = (label, dur, groupe, resp, x, y) => {
    const n = LiteGraph.createNode('pert/activity');
    n.properties.label = label; n.properties.duration = dur;
    n.properties.group = groupe; n.properties.responsible = resp;
    n.properties.color = window.pertMeta.groups[groupe];
    n.color = n.properties.color;
    n.updateSize(); g.add(n); n.pos = [x, y];
    return n;
  };

  const etude   = act('Étude mécanique détaillée', 15, 'WP1 Études', 'Dupont', 40, 200);
  const elec    = act('Étude électronique', 18, 'WP1 Études', 'Bernard', 40, 420);
  const chiff   = act('Chiffrage fournisseurs', 8, 'WP2 Achats', 'Martin', 520, 200);
  const consult = act('Consultation appel d\'offres', 12, 'WP2 Achats', 'Martin', 520, 420);
  const banc    = act('Banc d\'essai vibratoire', 20, 'WP3 Essais', 'Nguyen', 1000, 200);
  const therm   = act('Qualification thermique', 10, 'WP3 Essais', 'Nguyen', 1000, 420);

  const revue = LiteGraph.createNode('pert/milestone');
  revue.properties.label = 'Revue de conception';
  revue.updateSize(); g.add(revue); revue.pos = [1460, 300];

  // Deux liens préexistants, choisis pour que la capture porte les DEUX statuts
  // bloquants à la fois, vue depuis « Étude mécanique détaillée » en sens
  // prédécesseur : « Étude électronique » est déjà son amont (déjà lié), et
  // « Chiffrage » est son aval — l'y remettre en amont refermerait une boucle.
  link(etude, chiff);
  link(elec, etude);
  pertRecalc();
  return etude;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1500, height: 900 } });
  await lib.openApp(page);
  await page.evaluate(projet);
  await page.click('#btn-fit');
  await page.waitForTimeout(400);

  // 1) Le menu contextuel du nœud. LiteGraph le construit en DOM (.litegraph.litecontextmenu),
  //    on le déclenche par un vrai clic droit sur le nœud pour capturer ce que voit
  //    l'utilisateur — position comprise.
  const pt = await page.evaluate(() => {
    const n = window.pertGraph._nodes.find(x => x.properties.label === 'Étude mécanique détaillée');
    const c = window.pertCanvas, ds = c.ds;
    const r = c.canvas.getBoundingClientRect();
    return { x: r.x + (n.pos[0] + 60 + ds.offset[0]) * ds.scale,
             y: r.y + (n.pos[1] + 20 + ds.offset[1]) * ds.scale };
  });
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  await page.waitForTimeout(400);
  const menu = await page.$('.litecontextmenu');
  await menu.screenshot({ path: path.join(OUT, 'relier-menu.png') });
  console.log('  ✓ relier-menu.png');
  await page.keyboard.press('Escape');
  await page.mouse.click(20, 400);
  await page.waitForTimeout(200);

  // 2) La fenêtre. On l'ouvre sur « Étude mécanique détaillée » en sens PRÉDÉCESSEUR :
  //    c'est le seul réglage où la capture porte les DEUX statuts bloquants à la fois
  //    (cf. les liens préexistants ci-dessus). Le sens est changé par un vrai clic sur
  //    le bouton, ce qui montre aussi le sélecteur en position « Prédécesseurs ».
  await page.evaluate(() => {
    const n = window.pertGraph._nodes.find(x => x.properties.label === 'Étude mécanique détaillée');
    window.pertCanvas.selectNode(n);
    showProperties(n);
    window.pertOpenLinkSearch(n);
  });
  await page.waitForTimeout(300);
  await page.click('#linksearch-dir .ls-dir-btn:nth-child(2)');
  await page.waitForTimeout(300);
  const box = await page.$('.linksearch-dialog-box');
  await box.screenshot({ path: path.join(OUT, 'relier-fenetre.png') });
  console.log('  ✓ relier-fenetre.png');
  await page.evaluate(() => window.pertCloseLinkSearch());

  // 3) Le second point d'entrée : le bouton en tête du voisinage, dans l'onglet
  //    Synthèse du panneau. Recadré sur la zone utile (même raison que les autres
  //    captures de panneau : le bas du panneau est vide).
  await page.evaluate(() => {
    document.querySelector('#properties-tabs .prop-tab[data-tab="synthese"]').click();
  });
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => {
    const panneau = document.getElementById('properties-panel').getBoundingClientRect();
    const dernier = document.getElementById('properties-synthesis').lastElementChild;
    const bas = dernier ? dernier.getBoundingClientRect().bottom : panneau.bottom;
    return { x: panneau.x, y: panneau.y, width: panneau.width,
             height: Math.min(panneau.height, bas - panneau.y + 12) };
  });
  await page.screenshot({ path: path.join(OUT, 'relier-panneau.png'), clip });
  console.log('  ✓ relier-panneau.png');

  await browser.close();
})();
