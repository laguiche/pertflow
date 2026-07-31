// Captures du MANUEL — charge d'une tache en ETP ou en heures (v0.22).
//   panneau-charge-etp.png     — le bloc charge en mode ETP (heures deduites)
//   panneau-charge-heures.png  — le meme, chiffre en heures (ETP deduit)
//   synthese-charge-groupes.png — la colonne « Charge (h) » de la synthese
// Sortie : docs/images/manuel/ (VERSIONNE — ces images illustrent le manuel).
// Usage : node tools/doc-shots-charge.js

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');

// Meme planning que les autres captures d'offre : deux groupes, une tache chiffree en
// heures et deux en ETP, pour que la colonne de synthese montre le melange des modes.
function PLAN() {
  const g = window.pertGraph; g.clear();
  const m = window.pertMeta;
  m.title = 'Offre — poste de contrôle';
  m.t0 = '2026-01-05'; m.unit = 'j';
  m.hours_per_day = 8; m.hours_per_month = 135; m.hourly_rate = 136;
  m.groups = { 'Étude': '#4A90D9', 'Réalisation': '#F5A623' };
  const link = (s, d) => s.connect(0, d, d.inputs.length - 1);
  const act = (label, dur, groupe, conf, x, y) => {
    const n = LiteGraph.createNode('pert/activity');
    n.properties.label = label; n.properties.duration = dur; n.properties.group = groupe;
    Object.assign(n.properties, conf || {});
    n.properties.color = m.groups[groupe]; n.color = n.properties.color;
    n.updateSize(); g.add(n); n.pos = [x, y];
    return n;
  };
  const A = act('Spécification', 10, 'Étude', { etp: 1 }, 80, 200);
  const B = act('Développement IHM', 20, 'Réalisation',
                { charge_mode: 'heures', charge_hours: 240 }, 420, 140);
  const C = act('Banc de recette', 8, 'Réalisation', { etp: 0.5 }, 420, 340);
  const J = LiteGraph.createNode('pert/milestone');
  J.properties.label = 'Livraison'; J.properties.due_mode = 'date';
  J.properties.due_date = '2026-03-16'; J.properties.tag = 'COTD';
  J.updateSize(); g.add(J); J.pos = [800, 240];
  link(A, B); link(A, C); link(B, J); link(C, J);
  pertRecalc();
  window.__idB = B.id;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1440, height: 1080 } });
  await lib.openApp(page);
  await page.evaluate(PLAN);
  await page.click('#btn-fit');
  await page.waitForTimeout(400);

  // Recadrage sur la zone UTILE du panneau : il fait toute la hauteur de la fenetre et
  // se termine par un grand vide puis le bouton Supprimer, qui s'etalerait sur deux
  // pages du manuel imprime sans rien montrer.
  const panelClip = () => page.evaluate(() => {
    const p = document.getElementById('properties-panel').getBoundingClientRect();
    const dernier = document.getElementById('properties-content').lastElementChild;
    const bas = dernier ? dernier.getBoundingClientRect().bottom + 16 : p.bottom;
    return { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width),
             height: Math.round(Math.min(p.bottom, bas) - p.y) };
  });
  const shot = async (nom, clip) => {
    await page.screenshot({ path: path.join(OUT, nom), clip });
    console.log('  ✓ ' + nom);
  };

  // 1) Le bloc charge en mode ETP — le fonctionnement historique.
  await page.evaluate(() => {
    const B = window.pertGraph._nodes.find(n => n.id === window.__idB);
    B.properties.charge_mode = 'etp'; B.properties.etp = 1.5;
    showProperties(B);
    pertSelectPanelTab('proprietes');
  });
  await page.waitForTimeout(300);
  await shot('panneau-charge-etp.png', await panelClip());

  // 2) Le meme, chiffre en heures : la charge devient la saisie, l'ETP la deduction.
  await page.evaluate(() => {
    const sel = document.querySelector('#charge-section select');
    sel.value = 'heures'; sel.dispatchEvent(new Event('change'));
    const input = document.querySelector('#charge-section input:not(.field-derived)');
    input.value = '240'; input.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(300);
  await shot('panneau-charge-heures.png', await panelClip());

  // 3) La synthese : la colonne « Charge (h) » agrege les deux modes de saisie.
  await lib.openSynthesisMenu(page, 'planification');
  await page.waitForTimeout(400);
  const dlg = await page.$('#synthesis-dialog .dialog');
  await dlg.screenshot({ path: path.join(OUT, 'synthese-charge-groupes.png') });
  console.log('  ✓ synthese-charge-groupes.png');

  await browser.close();
  console.log('\nCaptures v0.22 generees dans docs/images/manuel/');
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
