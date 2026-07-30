// Captures de relecture — les trois retours du 29/07/2026 :
//   1) filtre d'avancement « En cours ou non commencé » (le reste a faire)
//   2) controle d'analyse « Nœuds masqués » (perte d'information, PAS simple
//      recouvrement : un jalon integralement disparu sous une activite)
//   3) aller a un nœud LEVE le filtre (bug v0.20)
// Usage : node tools/shots-details.js — sortie dans /tmp/shots-details/.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = '/tmp/shots-details';

function projet() {
  const g = window.pertGraph; g.clear();
  window.pertMeta.title = 'Ligne de conditionnement';
  window.pertMeta.t0 = '2026-01-05';
  window.pertMeta.unit = 'j';
  window.pertMeta.groups = { 'WP1 Études': '#4A90D9', 'Essais': '#F5A623' };
  const link = (s, d) => s.connect(0, d, d.inputs.length - 1);
  const act = (label, dur, progress, groupe, x, y) => {
    const n = LiteGraph.createNode('pert/activity');
    n.properties.label = label; n.properties.duration = dur;
    n.properties.progress = progress; n.properties.group = groupe;
    n.properties.color = window.pertMeta.groups[groupe];
    n.color = n.properties.color;
    n.updateSize(); g.add(n); n.pos = [x, y];
    return n;
  };

  const A = act('Étude de faisabilité', 4, 'TERMINE', 'WP1 Études', 60, 200);

  // Jalon cree AVANT la tache qui le recouvrira : c'est l'ordre de dessin qui decide
  // qui passe au-dessus. Il finira integralement masque — le cas que le controle doit
  // attraper, et le seul que l'utilisateur veut voir remonter.
  const P = LiteGraph.createNode('pert/milestone');
  P.properties.label = 'Point d\'étape'; P.properties.due_mode = 'date';
  P.properties.due_date = '2026-01-20'; P.updateSize(); g.add(P); P.pos = [400, 160];

  const B = act('Conception mécanique', 5, 'EN_COURS', 'WP1 Études', 390, 150);
  const C = act('Conception électrique', 4, 'EN_COURS', 'WP1 Études', 560, 340);
  const D = act('Essais de qualification', 4, 'NON_COMMENCE', 'Essais', 860, 200);
  const J = LiteGraph.createNode('pert/milestone');
  J.properties.label = 'Mise en service'; J.properties.due_mode = 'date';
  J.properties.due_date = '2026-03-16'; J.properties.tag = 'DOTD';
  J.updateSize(); g.add(J); J.pos = [1160, 220];

  link(A, B); link(A, C); link(B, P); link(B, D); link(C, D); link(D, J);
  pertRecalc();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1500, height: 900 } });
  await lib.openApp(page);
  await page.evaluate(projet);
  await page.click('#btn-fit');
  await page.waitForTimeout(400);

  // ── 1) Le filtre d'avancement « reste à faire » ───────────────────────────────
  await page.evaluate(() => openFilterMenu());
  await page.waitForTimeout(250);
  const menu = await page.$('#filter-menu');
  await menu.screenshot({ path: path.join(OUT, '1-filtre-liste.png') });
  console.log('  ✓ 1-filtre-liste.png — la liste, avec le regroupement en queue');

  await page.evaluate(() => {
    const sel = document.getElementById('filter-progress');
    sel.value = 'RESTE_A_FAIRE';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '2-reste-a-faire.png') });
  console.log('  ✓ 2-reste-a-faire.png — seule la tâche terminée est estompée');

  // ── 2) Le contrôle « Nœuds masqués » ─────────────────────────────────────────
  await lib.openSynthesisMenu(page, 'planification');
  await page.evaluate(() => pertSelectSynthTab('analyse'));
  await page.waitForTimeout(300);
  const box = await page.$('#synthesis-dialog .dialog');
  await box.screenshot({ path: path.join(OUT, '3-analyse-masquage.png') });
  console.log('  ✓ 3-analyse-masquage.png');

  // ── 3) Aller a un nœud LEVE le filtre ─────────────────────────────────────────
  // Le jalon masqué est aussi estompé par le filtre posé plus haut (il n'a pas
  // d'avancement) : sans le correctif, on le retrouvait sous le voile ET sous la
  // tâche. On clique son lien depuis l'analyse.
  await page.evaluate(() => {
    const lien = Array.from(document.querySelectorAll('#synthesis-content .synth-link'))
      .find(a => /Point d'étape/.test(a.textContent));
    lien.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '4-lien-leve-le-filtre.png') });
  console.log('  ✓ 4-lien-leve-le-filtre.png — filtre levé, nœud atteint');

  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
