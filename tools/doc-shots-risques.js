// Captures pour le MANUEL — gestion des risques :
//   risques-canvas.png   — deux bandeaux de risque au-dessus du planning, avec leurs
//                          traits de rattachement en pointillé
//   risques-panneau.png  — le panneau d'un risque (libellé, début borné, fin déduite)
//   risques-couvrir.png  — la fenêtre « Couvrir des tâches… », tâches couvertes marquées
//   risques-filtre.png   — le filtre par risque : le bandeau et ses tâches restent vifs
//   risques-fenetre.png  — la fenêtre « Risques », onglet « Par tâche »
//
// Le planning de démonstration porte DEUX risques dont l'un couvre une tâche que
// l'autre couvre aussi : c'est ce recouvrement qui rend l'onglet « Par tâche » utile,
// et une capture prise sur un seul risque ne le raconterait pas.
//
// Usage : node tools/doc-shots-risques.js — sortie dans docs/images/manuel/.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');

function projet() {
  const g = window.pertGraph; g.clear();
  window.pertMeta.title = 'Ligne de conditionnement';
  window.pertMeta.t0 = '2026-01-05';
  // Unité SEMAINE, et durées courtes : la largeur d'une tâche est proportionnelle à
  // sa durée, et un planning en jours ouvrés s'étale sur plusieurs écrans — les
  // bandeaux y deviennent des filets illisibles une fois la vue ajustée.
  window.pertMeta.unit = 'sem';
  window.pertMeta.groups = { 'WP1 Études': '#4A90D9', 'WP2 Achats': '#F5A623', 'WP3 Essais': '#7E57C2' };
  const link = (s, d) => s.connect(0, d, d.inputs.length - 1);
  const act = (label, dur, groupe, resp) => {
    const n = LiteGraph.createNode('pert/activity');
    n.properties.label = label; n.properties.duration = dur;
    n.properties.group = groupe; n.properties.responsible = resp;
    n.properties.color = window.pertMeta.groups[groupe];
    n.color = n.properties.color;
    n.updateSize(); g.add(n);
    return n;
  };

  const etude   = act('Étude mécanique', 3, 'WP1 Études', 'Dupont');
  const consult = act('Consultation', 2, 'WP2 Achats', 'Martin');
  const appro   = act('Approvisionnement', 4, 'WP2 Achats', 'Martin');
  const banc    = act('Banc d\'essai', 3, 'WP3 Essais', 'Nguyen');
  const jalon = LiteGraph.createNode('pert/milestone');
  jalon.properties.label = 'Mise en service';
  jalon.updateSize(); g.add(jalon);

  link(etude, consult); link(consult, appro); link(appro, banc); link(banc, jalon);
  pertRecalc();
  // Placement canonique : c'est celui que l'utilisateur obtient d'un clic sur
  // « Réorganiser », donc celui qu'il reconnaîtra dans le manuel.
  pertAutoLayout();

  // Deux risques. Le premier couvre l'achat de bout en bout, le second ne porte que
  // sur les essais — mais tous deux couvrent l'approvisionnement, ce qui fait de
  // celui-ci la tâche la plus exposée du planning.
  const hautDesTaches = Math.min.apply(null, g._nodes
    .filter(n => n.type !== 'pert/risk').map(n => n.pos[1]));
  const risque = (label, couleur, uids, rang) => {
    const r = LiteGraph.createNode('pert/risk');
    r.properties.label = label;
    r.properties.color = couleur;
    r.properties.covers = uids;
    g.add(r);
    r.pos[1] = hautDesTaches - 110 + rang * 46;
    pertRiskSyncGeometry(r);
    return r;
  };
  const u = n => n.properties.uid;
  risque('Rupture d\'approvisionnement', '#c0392b', [u(consult), u(appro)], 0);
  risque('Indisponibilité du banc', '#8e44ad', [u(appro), u(banc)], 1);
  pertRecalc();
}

// Cadre de capture calé sur le CONTENU (nœuds visibles), et non sur une zone fixe :
// le planning de démonstration évoluera, et un cadre figé finirait par le couper ou
// le noyer dans du vide sans que rien ne le signale.
async function cadreContenu(page) {
  return page.evaluate(() => {
    const c = window.pertCanvas, ds = c.ds, r = c.canvas.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    window.pertGraph._nodes.forEach(n => {
      x0 = Math.min(x0, n.pos[0]); y0 = Math.min(y0, n.pos[1]);
      x1 = Math.max(x1, n.pos[0] + n.size[0]); y1 = Math.max(y1, n.pos[1] + n.size[1]);
    });
    const sx = v => r.x + (v + ds.offset[0]) * ds.scale;
    const sy = v => r.y + (v + ds.offset[1]) * ds.scale;
    const m = 24;
    const x = Math.max(0, sx(x0) - m), y = Math.max(0, sy(y0) - m);
    return { x: Math.round(x), y: Math.round(y),
             width: Math.round(Math.min(window.innerWidth - x, sx(x1) - x + m)),
             height: Math.round(Math.min(window.innerHeight - y, sy(y1) - y + m)) };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1500, height: 900 } });
  await lib.openApp(page);
  await page.evaluate(projet);
  await page.click('#btn-fit');
  await page.waitForTimeout(400);

  // 1) Le canvas : les bandeaux, leur empan calendaire et leurs traits de
  //    rattachement. C'est LA capture qui explique le modèle sans une phrase — un
  //    risque est une période, et il pointe ce sur quoi il pèse.
  await page.screenshot({ path: path.join(OUT, 'risques-canvas.png'),
    clip: await cadreContenu(page) });
  console.log('  ✓ risques-canvas.png');

  // 2) Le panneau d'un risque. Recadré sous son dernier élément (même précaution que
  //    les autres captures de panneau : le bas est vide, et viser une hauteur fixe
  //    coupe la capture au premier champ ajouté).
  await page.evaluate(() => {
    const r = pertRiskNodes()[0];
    window.pertCanvas.selectNode(r);
    showProperties(r);
    document.querySelector('#properties-tabs .prop-tab[data-tab="proprietes"]').click();
  });
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => {
    const p = document.getElementById('properties-panel').getBoundingClientRect();
    const d = document.getElementById('properties-content').lastElementChild;
    const bas = d ? d.getBoundingClientRect().bottom : p.bottom;
    return { x: p.x, y: p.y, width: p.width, height: Math.min(p.height, bas - p.y + 12) };
  });
  await page.screenshot({ path: path.join(OUT, 'risques-panneau.png'), clip });
  console.log('  ✓ risques-panneau.png');

  // 3) La fenêtre « Couvrir des tâches… », avec deux tâches déjà couvertes : c'est la
  //    marque d'état qui doit se lire, et le rappel de période en tête.
  await page.evaluate(() => pertOpenRiskLink(pertRiskNodes()[0]));
  await page.waitForTimeout(300);
  let box = await page.$('#risklink-dialog .linksearch-dialog-box');
  await box.screenshot({ path: path.join(OUT, 'risques-couvrir.png') });
  console.log('  ✓ risques-couvrir.png');
  await page.evaluate(() => pertCloseRiskLink());

  // 4) Le filtre par risque : tout s'éteint sauf le bandeau et ses tâches. On passe
  //    par le VRAI chemin (la ligne du menu de filtre), pour capturer aussi le menu.
  await page.click('#filter-trigger');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'risques-filtre-menu.png'),
    clip: await page.evaluate(() => {
      const m = document.getElementById('filter-menu').getBoundingClientRect();
      return { x: m.x - 4, y: m.y - 4, width: m.width + 8, height: m.height + 8 };
    }) });
  console.log('  ✓ risques-filtre-menu.png');
  await page.evaluate(() => {
    const r = pertRiskNodes()[0];
    Array.from(document.querySelectorAll('#filter-options .filter-menu-row'))
      .find(e => e.textContent.indexOf('Rupture') !== -1).click();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'risques-filtre.png'),
    clip: await cadreContenu(page) });
  console.log('  ✓ risques-filtre.png');

  // 5) La fenêtre « Risques », onglet « Par tâche » : c'est lui qui fait ressortir la
  //    tâche couverte par DEUX risques, invisible sur toute autre vue.
  await page.evaluate(() => { applyFilter(null); updateFilterTrigger(); });
  await lib.openSynthesisMenu(page, 'risques');
  await page.evaluate(() => pertSelectRisksTab('taches'));
  await page.waitForTimeout(300);
  box = await page.$('#risks-dialog .suivi-dialog-box');
  await box.screenshot({ path: path.join(OUT, 'risques-fenetre.png') });
  console.log('  ✓ risques-fenetre.png');

  await browser.close();
})();
