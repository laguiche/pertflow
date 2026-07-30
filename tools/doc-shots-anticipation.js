// Captures d'ecran pour le manuel — evolutions v0.16 :
//  - anticipation de travaux AVANT T0 (avant / apres, sur le meme planning)
//  - repere T0 + bande « travaux anticipes » sur le canvas
//  - panneau d'une tache anticipee (case a cocher + « Avant T0 » + cout anticipe)
//  - panneau d'un Jalon dont la cible est saisie en « T0 + X »
//  - synthese : ventilation du cout par groupe (global / anticipe / non anticipe)
// Complete tools/doc-shots.js et tools/doc-shots-evo.js.
// Usage : node tools/doc-shots-anticipation.js — sorties dans docs/images/manuel/.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');

// Planning de demonstration commun aux captures « avant / apres ».
// Sans anticipation : Appro(3) → Conception(4) → Integration(2) finit a T0+9, alors que
// la Livraison client est engagee a T0+6 → cible RATEE de 3 mois.
// En cochant « Tache anticipee » sur l'Appro, celle-ci recule a T0-3 et la chaine aval
// gagne exactement 3 mois → cible TENUE, sans avoir touche a T0.
const PLAN = () => {
  const g = window.pertGraph, m = window.pertMeta;
  g.clear();
  m.t0 = '2026-04-01'; m.unit = 'mois'; m.title = 'Programme XYZ';
  m.groups = { 'Etudes': '#4A90D9', 'Appro': '#D98A4A' };
  m.hours_per_month = 135; m.hourly_rate = 136;
  const link = (a, b) => a.connect(0, b, b.inputs.length - 1);

  const P = LiteGraph.createNode('pert/activity');
  P.properties.label = 'Appro longue'; P.properties.duration = 3; P.properties.etp = 1;
  P.properties.group = 'Appro'; P.properties.color = '#D98A4A'; g.add(P);

  const B = LiteGraph.createNode('pert/activity');
  B.properties.label = 'Conception'; B.properties.duration = 4; B.properties.etp = 2;
  B.properties.group = 'Etudes'; g.add(B);

  const C = LiteGraph.createNode('pert/activity');
  C.properties.label = 'Integration'; C.properties.duration = 2; C.properties.etp = 2;
  C.properties.group = 'Etudes'; g.add(C);

  const JF = LiteGraph.createNode('pert/milestone');
  JF.properties.label = 'Livraison client';
  JF.properties.due_mode = 'offset'; JF.properties.due_offset = 6;
  JF.updateSize(); g.add(JF);

  link(P, B); link(B, C); link(C, JF);
  pertRecalc(); pertAutoLayout();
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1440, height: 820 } });
  await lib.openApp(page);

  const shot = async (name, clip) => {
    await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.remove(); });
    await page.screenshot({ path: path.join(OUT, name), clip });
    console.log('  ✓', name);
  };

  // Cadrage serre sur les nœuds (le zoom « Tout afficher » laisse de larges marges,
  // peu lisibles en illustration). On convertit l'emprise du graphe en coordonnees
  // ecran : x_ecran = (x_graphe + offset) × scale, + l'origine du conteneur canvas.
  // pad est exprime en pixels ECRAN.
  const nodesClip = (pad) => page.evaluate((pad) => {
    const c = window.pertCanvas, ns = window.pertGraph._nodes;
    const box = document.getElementById('canvas-container').getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ns.forEach(n => {
      minX = Math.min(minX, n.pos[0]);              maxX = Math.max(maxX, n.pos[0] + n.size[0]);
      minY = Math.min(minY, n.pos[1] - 30);         maxY = Math.max(maxY, n.pos[1] + n.size[1]);
    });
    const sx = v => (v + c.ds.offset[0]) * c.ds.scale + box.x;
    const sy = v => (v + c.ds.offset[1]) * c.ds.scale + box.y;
    const x = Math.max(box.x, Math.round(sx(minX) - pad));
    const y = Math.max(box.y, Math.round(sy(minY) - pad));
    return {
      x, y,
      width: Math.round(Math.min(box.right, sx(maxX) + pad) - x),
      height: Math.round(Math.min(box.bottom, sy(maxY) + pad) - y),
    };
  }, pad);

  // Le panneau occupe toute la hauteur de la fenetre : on s'arrete au BAS DU CONTENU
  // (dernier element de #properties-content, le bouton Supprimer) plutot que de trainer
  // des centaines de pixels vides — sinon l'image, trop haute, se coupe entre deux
  // pages dans le PDF du manuel.
  const panelClip = () => page.evaluate(() => {
    const p = document.getElementById('properties-panel').getBoundingClientRect();
    const c = document.getElementById('properties-content');
    const last = c.lastElementChild;
    const bottom = last ? last.getBoundingClientRect().bottom + 16 : p.bottom;
    return { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width),
             height: Math.round(Math.min(p.bottom, bottom) - p.y) };
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 1) ANTICIPATION : avant / apres sur le MEME planning
  // ════════════════════════════════════════════════════════════════════════════
  await page.evaluate(PLAN);
  await page.click('#btn-fit');
  await page.waitForTimeout(400);
  await shot('anticipation-avant.png', await nodesClip(70));

  await page.evaluate(() => {
    const P = window.pertGraph._nodes.find(n => n.properties.label === 'Appro longue');
    P.properties.anticipated = true;
    pertRecalc(); pertAutoLayout();
  });
  await page.click('#btn-fit');
  await page.waitForTimeout(400);
  await shot('anticipation-apres.png', await nodesClip(70));

  // ════════════════════════════════════════════════════════════════════════════
  // 2) PANNEAU d'une tache anticipee (case cochee + « Avant T0 » + cout anticipe)
  // ════════════════════════════════════════════════════════════════════════════
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => {
    const P = window.pertGraph._nodes.find(n => n.properties.label === 'Appro longue');
    showProperties(P);
    pertSelectPanelTab('proprietes');   // la case « Tâche anticipée » est une saisie
  });
  await page.waitForTimeout(400);
  await shot('panneau-tache-anticipee.png', await panelClip());

  // ════════════════════════════════════════════════════════════════════════════
  // 3) PANNEAU d'un Jalon : cible saisie en « T0 + X »
  // ════════════════════════════════════════════════════════════════════════════
  await page.evaluate(() => {
    const J = window.pertGraph._nodes.find(n => n.type === 'pert/milestone');
    showProperties(J);
    pertSelectPanelTab('proprietes');   // la cible est une saisie
  });
  await page.waitForTimeout(400);
  await shot('jalon-cible-t0plusx.png', await panelClip());

  // ════════════════════════════════════════════════════════════════════════════
  // 4) SYNTHESE : ventilation du cout par groupe
  // ════════════════════════════════════════════════════════════════════════════
  await page.setViewportSize({ width: 1440, height: 900 });
  await lib.openSynthesisMenu(page, 'planification');
  await page.waitForTimeout(400);
  const dlg = await page.evaluate(() => {
    const r = document.querySelector('#synthesis-dialog > *').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y),
             width: Math.round(r.width), height: Math.round(r.height) };
  });
  await shot('synthese-cout-anticipe.png', dlg);

  await browser.close();
  console.log('\nCaptures v0.16 generees dans docs/images/manuel/');
})();
