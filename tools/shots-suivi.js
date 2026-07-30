// Captures de relecture — fenetre de SUIVI D'AVANCEMENT.
// Planning realiste, date du point FORCEE au 27/01/2026 (offset 16 en jours ouvres
// depuis T0) pour que les captures soient reproductibles.
// Usage : node tools/shots-suivi.js — sortie dans /tmp/shots-suivi/.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = '/tmp/shots-suivi';

function projet() {
  window.pertSuiviToday = '2026-01-27';
  const g = window.pertGraph; g.clear();
  window.pertMeta.title = 'Ligne de conditionnement';
  window.pertMeta.t0 = '2026-01-05';
  window.pertMeta.unit = 'j';
  window.pertMeta.groups = { 'WP1 Études': '#4A90D9', 'Achats': '#F5A623', 'Qualité': '#7E57C2' };
  const link = (s, d) => s.connect(0, d, d.inputs.length - 1);
  let x = 40;
  const act = (label, dur, progress, groupe, y) => {
    const n = LiteGraph.createNode('pert/activity');
    n.properties.label = label; n.properties.duration = dur;
    n.properties.progress = progress; n.properties.group = groupe;
    n.properties.color = window.pertMeta.groups[groupe];
    n.color = n.properties.color;
    n.updateSize(); g.add(n); n.pos = [x, y]; x += 60;
    return n;
  };
  const jal = (label, off, tag, y) => {
    const n = LiteGraph.createNode('pert/milestone');
    n.properties.label = label; n.properties.due_mode = 'offset';
    n.properties.due_offset = off; n.properties.tag = tag || '';
    n.updateSize(); g.add(n); n.pos = [x, y]; x += 60;
    return n;
  };

  const etude   = act('Étude de faisabilité', 8, 'TERMINE', 'WP1 Études', 60);
  const cmeca   = act('Conception mécanique', 12, 'EN_COURS', 'WP1 Études', 200);
  const celec   = act('Conception électrique', 10, 'EN_COURS', 'WP1 Études', 340);
  const consult = act('Consultation fournisseurs', 6, 'TERMINE', 'Achats', 480);
  const commande = act('Commande longs délais', 4, 'NON_COMMENCE', 'Achats', 620);
  const doc     = act('Doc technique', 6, 'EN_COURS', 'Qualité', 760);
  const relect  = act('Relecture doc', 2, 'NON_COMMENCE', 'Qualité', 900);
  const montage = act('Montage', 7, 'NON_COMMENCE', 'WP1 Études', 1040);

  const jLivr = jal('Livraison composants', 18, '', 60);
  const jQual = jal('Dossier qualité', 20, 'ING', 200);
  const jRevue = jal('Revue de conception', 22, 'COTD', 340);
  const jMes = jal('Mise en service', 45, 'DOTD', 480);

  link(etude, cmeca); link(etude, celec); link(etude, consult); link(etude, doc);
  link(consult, commande); link(doc, relect);
  link(cmeca, montage); link(celec, montage);
  link(commande, jLivr); link(relect, jQual);
  link(cmeca, jRevue); link(celec, jRevue);
  link(montage, jMes);
  pertRecalc();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1500, height: 940 } });
  await lib.openApp(page);
  await page.evaluate(projet);
  await page.click('#btn-fit');
  await page.waitForTimeout(400);

  // 1) Le sous-menu du bouton Synthèse.
  await page.click('#btn-synthesis');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '1-sous-menu-synthese.png'),
                          clip: { x: 0, y: 0, width: 1100, height: 200 } });
  console.log('  ✓ 1-sous-menu-synthese.png — Planification / Avancement');

  // 2) Onglet Tâches.
  await page.evaluate(() => {
    document.querySelectorAll('.litegraph.litecontextmenu').forEach(m => m.remove());
    pertSelectSuiviTab('taches');
    pertOpenSuiviDialog();
  });
  await page.waitForTimeout(300);
  const box = await page.$('#suivi-dialog .dialog');
  await box.screenshot({ path: path.join(OUT, '2-suivi-taches.png') });
  console.log('  ✓ 2-suivi-taches.png');

  // 3) Onglet Jalons.
  await page.evaluate(() => pertSelectSuiviTab('jalons'));
  await page.waitForTimeout(300);
  await box.screenshot({ path: path.join(OUT, '3-suivi-jalons.png') });
  console.log('  ✓ 3-suivi-jalons.png');

  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
