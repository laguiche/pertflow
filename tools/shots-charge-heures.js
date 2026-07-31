// Captures de relecture — charge d'une tache en ETP ou en HEURES (31/07/2026).
// Montre les deux modes cote a cote dans le panneau, la bascule a cout constant, et
// ce que devient la valeur deduite quand l'elongation change.
// Usage : node tools/shots-charge-heures.js — sortie dans /tmp/shots-charge/.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = '/tmp/shots-charge';

function projet() {
  const g = window.pertGraph; g.clear();
  const m = window.pertMeta;
  m.title = 'Offre — poste de contrôle';
  m.t0 = '2026-01-05'; m.unit = 'j';
  m.hours_per_day = 8; m.hours_per_month = 135; m.hourly_rate = 136;
  m.groups = { 'Étude': '#4A90D9', 'Réalisation': '#F5A623' };
  const link = (s, d) => s.connect(0, d, d.inputs.length - 1);
  const act = (label, dur, groupe, x, y) => {
    const n = LiteGraph.createNode('pert/activity');
    n.properties.label = label; n.properties.duration = dur;
    n.properties.group = groupe; n.properties.color = m.groups[groupe];
    n.color = n.properties.color;
    n.updateSize(); g.add(n); n.pos = [x, y];
    return n;
  };
  const A = act('Spécification', 10, 'Étude', 80, 200);
  const B = act('Développement IHM', 20, 'Réalisation', 420, 140);
  const C = act('Banc de recette', 8, 'Réalisation', 420, 340);
  const J = LiteGraph.createNode('pert/milestone');
  J.properties.label = 'Livraison'; J.properties.due_mode = 'date';
  J.properties.due_date = '2026-03-16'; J.properties.tag = 'COTD';
  J.updateSize(); g.add(J); J.pos = [800, 240];
  link(A, B); link(A, C); link(B, J); link(C, J);
  pertRecalc();
  window.__idB = B.id;
}

const selNode = () => {
  const n = window.pertGraph._nodes.find(x => x.id === window.__idB);
  window.pertCanvas.selectNodes([n]);
  showProperties(n);
  return n;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1500, height: 900 } });
  await lib.openApp(page);
  await page.evaluate(projet);
  await page.click('#btn-fit');
  await page.waitForTimeout(400);

  // ── 1) Mode ETP (fonctionnement historique) : la charge en heures est déduite ──
  await page.evaluate(selNode);
  await page.waitForTimeout(300);
  const panel = await page.$('#properties-panel');
  await panel.screenshot({ path: path.join(OUT, '1-mode-etp.png') });
  console.log('  ✓ 1-mode-etp.png — ETP saisi, heures déduites (20 j × 8 h × 1 ETP = 160 h)');

  // ── 2) Le sélecteur de mode déroulé ───────────────────────────────────────────
  await page.screenshot({ path: path.join(OUT, '2-plein-ecran-etp.png') });
  console.log('  ✓ 2-plein-ecran-etp.png — le panneau dans son contexte');

  // ── 3) Bascule en heures : même coût, l'ETP passe à droite en lecture seule ────
  await page.evaluate(() => {
    const sel = document.querySelector('#charge-section select');
    sel.value = 'heures'; sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  await (await page.$('#properties-panel')).screenshot({ path: path.join(OUT, '3-mode-heures.png') });
  console.log('  ✓ 3-mode-heures.png — bascule à coût constant, ETP déduit');

  // ── 4) Saisie d'une charge d'offre (240 h) : l'ETP suit ───────────────────────
  await page.evaluate(() => {
    const input = document.querySelector('#charge-section input:not(.field-derived)');
    input.value = '240'; input.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(300);
  await (await page.$('#properties-panel')).screenshot({ path: path.join(OUT, '4-saisie-heures.png') });
  console.log('  ✓ 4-saisie-heures.png — 240 h sur 20 j → 1,5 ETP déduit');

  // ── 5) L'élongation passe de 20 à 30 jours : la charge tient, l'ETP se dilue ───
  await page.evaluate(() => {
    const champs = Array.from(document.querySelectorAll('#properties-content input[type=number]'));
    const duree = champs[0];   // 1er champ numérique du panneau = Durée
    duree.value = '30'; duree.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(400);
  await (await page.$('#properties-panel')).screenshot({ path: path.join(OUT, '5-duree-allongee.png') });
  console.log('  ✓ 5-duree-allongee.png — 240 h inchangées, ETP déduit 1 (240/240)');

  // ── 6) Onglet Synthèse : le coût, seule valeur qui compte en aval ─────────────
  await page.evaluate(() => pertSelectPanelTab('synthese'));
  await page.waitForTimeout(300);
  await (await page.$('#properties-panel')).screenshot({ path: path.join(OUT, '6-synthese-cout.png') });
  console.log('  ✓ 6-synthese-cout.png — coût = 240 h × 136 €/h = 32,6 k€');

  // ── 7) Vue complète avec la barre d'état (coût projet agrégé) ─────────────────
  await page.evaluate(() => { updateStatus(); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, '7-plein-ecran-heures.png') });
  console.log('  ✓ 7-plein-ecran-heures.png');

  // ── 8) Synthèse planification : la charge en heures par groupe ────────────────
  // La tâche « Développement IHM » est chiffrée en heures, les deux autres en ETP :
  // la colonne les agrège dans la même unité, c'est tout son intérêt.
  await lib.openSynthesisMenu(page, 'planification');
  await page.waitForTimeout(400);
  const dlg = await page.$('#synthesis-dialog .dialog');
  await dlg.screenshot({ path: path.join(OUT, '8-synthese-groupes.png') });
  console.log('  ✓ 8-synthese-groupes.png — Charge (h) par groupe + charge totale');

  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
