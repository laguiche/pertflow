// Captures pour le MANUEL — suivi d'avancement (v0.21) :
//   panneau-avancement.png       — le champ « Avancement » dans le panneau
//   noeud-avancement.png         — les marqueurs sur les nœuds du planning
//   filtre-avancement.png        — la liste déroulante du menu Filtre
//   suivi-taches.png / suivi-jalons.png — les deux onglets de la fenêtre de suivi
//   synthese-noeuds-masques.png  — le contrôle d'analyse « Nœuds masqués »
//
// Le point d'avancement est FORCÉ (window.pertSuiviToday) : une capture de manuel doit
// être reproductible, or tout le suivi se lit par rapport à la date du jour.
// Usage : node tools/doc-shots-avancement.js — sortie dans docs/images/manuel/.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');

// Planning de démonstration commun : T0 au 05/01/2026, point d'avancement au 27/01
// (= 16 jours ouvrés), de quoi peupler chaque section du suivi.
function projet() {
  window.pertSuiviToday = '2026-01-27';
  const g = window.pertGraph; g.clear();
  window.pertMeta.title = 'Ligne de conditionnement';
  window.pertMeta.t0 = '2026-01-05';
  window.pertMeta.unit = 'j';
  window.pertMeta.groups = { 'WP1 Études': '#4A90D9', 'Achats': '#F5A623', 'Qualité': '#7E57C2' };
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
  const jal = (label, off, tag, x, y) => {
    const n = LiteGraph.createNode('pert/milestone');
    n.properties.label = label; n.properties.due_mode = 'offset';
    n.properties.due_offset = off; n.properties.tag = tag || '';
    n.updateSize(); g.add(n); n.pos = [x, y];
    return n;
  };

  const etude    = act('Étude de faisabilité', 8, 'TERMINE', 'WP1 Études', 40, 200);
  const cmeca    = act('Conception mécanique', 12, 'EN_COURS', 'WP1 Études', 560, 60);
  const celec    = act('Conception électrique', 10, 'EN_COURS', 'WP1 Études', 560, 640);
  const consult  = act('Consultation fournisseurs', 6, 'TERMINE', 'Achats', 560, 360);
  const commande = act('Commande longs délais', 4, 'NON_COMMENCE', 'Achats', 980, 360);
  const doc      = act('Doc technique', 6, 'EN_COURS', 'Qualité', 560, 500);
  const relect   = act('Relecture doc', 2, 'NON_COMMENCE', 'Qualité', 980, 500);
  const montage  = act('Montage', 7, 'NON_COMMENCE', 'WP1 Études', 1320, 60);

  const jLivr  = jal('Livraison composants', 18, '', 1280, 360);
  const jQual  = jal('Dossier qualité', 20, 'ING', 1280, 500);
  const jRevue = jal('Revue de conception', 22, 'COTD', 1320, 640);
  const jMes   = jal('Mise en service', 45, 'DOTD', 1700, 60);

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
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1500, height: 900 } });
  await lib.openApp(page);
  await page.evaluate(projet);
  await page.click('#btn-fit');
  await page.waitForTimeout(400);

  // 1) Les marqueurs sur les nœuds — vue rapprochée sur trois tâches d'états différents.
  await page.evaluate(() => {
    window.pertCanvas.ds.scale = 1.15;
    window.pertCanvas.ds.offset = [-545, -30];
    window.pertCanvas.setDirty(true, true);
  });
  await page.waitForTimeout(400);
  const canvas = await page.$('#pertCanvas');
  await canvas.screenshot({ path: path.join(OUT, 'noeud-avancement.png') });
  console.log('  ✓ noeud-avancement.png');

  // 2) Le champ « Avancement » dans le panneau.
  await page.evaluate(() => {
    const n = window.pertGraph._nodes.find(x => x.properties.label === 'Conception mécanique');
    window.pertCanvas.selectNode(n);
    showProperties(n);
  });
  await page.waitForTimeout(300);
  // Recadre sur la ZONE UTILE : le panneau fait toute la hauteur de la fenetre et se
  // termine par un grand vide puis le bouton Supprimer — dans le manuel imprime, la
  // capture s'etalait sur deux pages pour ne rien montrer. On coupe sous la derniere
  // zone de saisie.
  const clip = await page.evaluate(() => {
    const panneau = document.getElementById('properties-panel').getBoundingClientRect();
    const champs = document.querySelectorAll('#properties-content textarea');
    const bas = champs.length
      ? champs[champs.length - 1].getBoundingClientRect().bottom
      : panneau.bottom;
    return { x: panneau.x, y: panneau.y, width: panneau.width,
             height: Math.min(panneau.height, bas - panneau.y + 12) };
  });
  await page.screenshot({ path: path.join(OUT, 'panneau-avancement.png'), clip });
  console.log('  ✓ panneau-avancement.png');

  // 3) La liste déroulante d'avancement du menu Filtre.
  await page.evaluate(() => openFilterMenu());
  await page.waitForTimeout(300);
  const menu = await page.$('#filter-menu');
  await menu.screenshot({ path: path.join(OUT, 'filtre-avancement.png') });
  console.log('  ✓ filtre-avancement.png');
  await page.evaluate(() => closeFilterMenu());

  // 4) et 5) Les deux onglets de la fenêtre de suivi.
  await page.evaluate(() => { pertSelectSuiviTab('taches'); pertOpenSuiviDialog(); });
  await page.waitForTimeout(300);
  const box = await page.$('#suivi-dialog .dialog');
  await box.screenshot({ path: path.join(OUT, 'suivi-taches.png') });
  console.log('  ✓ suivi-taches.png');
  await page.evaluate(() => pertSelectSuiviTab('jalons'));
  await page.waitForTimeout(300);
  await box.screenshot({ path: path.join(OUT, 'suivi-jalons.png') });
  console.log('  ✓ suivi-jalons.png');
  await page.evaluate(() => pertCloseSuiviDialog());

  // 6) Le contrôle « Nœuds masqués » : on pose une tâche sur un jalon pour le faire
  //    disparaître — l'ordre de création décide qui passe au-dessus, « Montage » a
  //    été créée après « Livraison composants ».
  await page.evaluate(() => {
    const g = window.pertGraph;
    const jalon = g._nodes.find(n => n.properties.label === 'Livraison composants');
    const act = g._nodes.find(n => n.properties.label === 'Montage');
    act.pos = [jalon.pos[0] - 10, jalon.pos[1] - 10];
    pertOpenSynthesisDialog();
    pertSelectSynthTab('analyse');
  });
  await page.waitForTimeout(300);
  const synth = await page.$('#synthesis-dialog .dialog');
  await synth.screenshot({ path: path.join(OUT, 'synthese-noeuds-masques.png') });
  console.log('  ✓ synthese-noeuds-masques.png');

  console.log('\nCaptures v0.21 generees dans docs/images/manuel/');
  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
