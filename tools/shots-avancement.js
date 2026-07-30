// Captures de relecture — champ « Avancement » (suivi léger, 29/07/2026).
// Destinees a la validation VISUELLE de l'evolution (utilisateur en remote), avant
// leur reprise eventuelle dans le manuel.
// Usage : node tools/shots-avancement.js — sortie dans /tmp/shots-avancement/.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = '/tmp/shots-avancement';

// Planning de demonstration : une chaine realiste, avec les trois etats representes
// (et une tache laissee « non commencée » pour montrer qu'elle n'est PAS decoree).
function projet() {
  const g = window.pertGraph; g.clear();
  window.pertMeta.title = 'Ligne de conditionnement';
  window.pertMeta.t0 = '2026-01-05';
  window.pertMeta.unit = 'j';
  window.pertMeta.groups = { 'WP1 Études': '#4A90D9', 'Essais': '#F5A623' };
  const mk = (label, dur, resp, groupe, progress, x, y) => {
    const n = LiteGraph.createNode('pert/activity');
    n.properties.label = label; n.properties.duration = dur;
    n.properties.responsible = resp; n.properties.group = groupe;
    n.properties.color = window.pertMeta.groups[groupe];
    n.properties.progress = progress;
    n.color = n.properties.color;
    n.updateSize(); g.add(n); n.pos = [x, y];
    return n;
  };
  // Positions choisies pour qu'AUCUN nœud n'en chevauche un autre : la largeur est
  // proportionnelle a la duree (dur × 60 px), et un nœud recouvert masquerait le
  // marqueur du nœud dessous — ce qui ferait croire a tort qu'il n'est pas dessine.
  const a = mk('Étude de faisabilité', 4, 'Frédéric', 'WP1 Études', 'TERMINE', 60, 140);
  const b = mk('Conception mécanique', 6, 'Mickael', 'WP1 Études', 'EN_COURS', 380, 40);
  const c = mk('Conception électrique', 5, 'Sophie', 'WP1 Études', 'EN_COURS', 380, 300);
  const d = mk('Essais de qualification', 4, 'Mickael', 'Essais', 'NON_COMMENCE', 820, 170);
  const j = LiteGraph.createNode('pert/milestone');
  j.properties.label = 'Mise en service'; j.properties.due_mode = 'date';
  j.properties.due_date = '2026-03-16'; j.properties.tag = 'DOTD';
  j.updateSize(); g.add(j); j.pos = [1160, 180];
  a.connect(0, b, 0); a.connect(0, c, 0);
  b.connect(0, d, 0); c.connect(0, d, 0); d.connect(0, j, 0);
  pertRecalc();
  return d.id;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1500, height: 860 } });
  await lib.openApp(page);
  await page.evaluate(projet);
  await page.click('#btn-fit');
  await page.waitForTimeout(400);

  // 1) Le planning : marqueurs sur les taches suivies, RIEN sur « non commencée ».
  await page.screenshot({ path: path.join(OUT, '1-planning-marqueurs.png') });
  console.log('  ✓ 1-planning-marqueurs.png — marques "en cours" / "terminé", tache non commencée intacte');

  // 2) Zoom sur les nœuds, pour juger la pastille de pres.
  await page.evaluate(() => {
    window.pertCanvas.ds.scale = 1.7;
    window.pertCanvas.ds.offset = [-30, -10];
    window.pertCanvas.setDirty(true, true);
  });
  await page.waitForTimeout(400);
  const canvas = await page.$('#pertCanvas');
  await canvas.screenshot({ path: path.join(OUT, '2-zoom-pastilles.png') });
  console.log('  ✓ 2-zoom-pastilles.png');

  // 3) Le panneau lateral, onglet Propriétés, sur une tache en cours.
  await page.evaluate(() => {
    window.pertCanvas.ds.scale = 1; window.pertCanvas.ds.offset = [0, 0];
    const n = window.pertGraph._nodes.find(x => x.properties.label === 'Conception mécanique');
    window.pertCanvas.selectNode(n);
    showProperties(n);
  });
  await page.waitForTimeout(300);
  const panel = await page.$('#properties-panel');
  await panel.screenshot({ path: path.join(OUT, '3-panneau-avancement.png') });
  console.log('  ✓ 3-panneau-avancement.png — le champ « Avancement » dans la saisie');

  // 4) Le menu de filtre ouvert : la nouvelle section « Avancement », en tete (le menu
  // defile et plafonne a 340 px — une section posee en fin de liste serait hors champ).
  await page.evaluate(() => openFilterMenu());
  await page.waitForTimeout(300);
  const menu = await page.$('#filter-menu');
  await menu.screenshot({ path: path.join(OUT, '4-menu-filtre.png') });
  console.log('  ✓ 4-menu-filtre.png — section « Avancement » en tête de menu');

  // 5) Filtre « En cours » applique : seules les taches en cours restent vives.
  await page.evaluate(() => {
    const sel = document.getElementById('filter-progress');
    sel.value = 'EN_COURS';
    sel.dispatchEvent(new Event('change'));
  });
  await page.click('#btn-fit');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '5-filtre-en-cours.png') });
  console.log('  ✓ 5-filtre-en-cours.png — « montre-moi ce qui est en cours »');

  // 6) Menu rouvert : la liste reflete le filtre actif (elle ne repart pas a « Tous »).
  await page.evaluate(() => openFilterMenu());
  await page.waitForTimeout(300);
  const menu2 = await page.$('#filter-menu');
  await menu2.screenshot({ path: path.join(OUT, '6-menu-filtre-actif.png') });
  console.log('  ✓ 6-menu-filtre-actif.png — la liste montre le filtre actif');

  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
