// Tests cibles Session 7 : le couple couleur/groupe au coeur des fonctions de base.
//   A — import conscient du groupe (applyImportModel : nouveau groupe / groupe
//       existant herite / aucun groupe)
//   B — reorganisation a couloirs groupes (pertAutoLayout : bandes verticales par
//       groupe, abscisse ∝ ES conservee)
//   C — filtre / mise en evidence (pertNodeDimmed par groupe ou couleur)
// Usage : node tools/smoke-s7.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // ── A : import nouveau groupe → couleur d'import devient celle du groupe ───────
  const newGroup = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.groups = {};
    const off = { x: 0, y: 0 };
    const model = { nodes: [
      { srcName: 'A1', type: 'activity', label: 'T1', duration: 2, off },
      { srcName: 'A2', type: 'activity', label: 'T2', duration: 3, off }
    ], edges: [] };
    applyImportModel(model, '#F5A623', 'WP-Neuf');
    const acts = g._nodes.filter(n => n.type === 'pert/activity');
    return {
      groups: acts.map(n => n.properties.group),
      colors: acts.map(n => n.properties.color),
      reg: window.pertMeta.groups['WP-Neuf']
    };
  });
  console.log('A nouveau groupe:', newGroup);
  if (!newGroup.groups.every(x => x === 'WP-Neuf')) throw new Error('A : taches non rattachees au nouveau groupe');
  if (!newGroup.colors.every(c => c === '#F5A623')) throw new Error('A : couleur d\'import non appliquee');
  if (newGroup.reg !== '#F5A623') throw new Error('A : la couleur du nouveau groupe (premier venu) n\'est pas enregistree');

  // ── A : import groupe EXISTANT → couleur heritee du registre (verrouillee) ────
  const existGroup = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.groups = { 'WP-Connu': '#BD10E0' };
    const off = { x: 0, y: 0 };
    const model = { nodes: [{ srcName: 'B1', type: 'activity', label: 'X', duration: 1, off }], edges: [] };
    // importColor volontairement "faux" : l'heritage doit primer (couleur du groupe).
    applyImportModel(model, '#000000', 'WP-Connu');
    const a = g._nodes.find(n => n.type === 'pert/activity');
    return { color: a.properties.color, nodeColor: a.color, group: a.properties.group };
  });
  console.log('A groupe existant:', existGroup);
  if (existGroup.color !== '#BD10E0' || existGroup.nodeColor !== '#BD10E0')
    throw new Error('A : couleur non heritee du groupe existant');

  // ── A : aucun groupe → couleur libre, taches non groupees, registre intact ────
  const noGroup = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.groups = {};
    const off = { x: 0, y: 0 };
    const model = { nodes: [{ srcName: 'C1', type: 'activity', label: 'Y', duration: 1, off }], edges: [] };
    applyImportModel(model, '#7ED321', '');
    const a = g._nodes.find(n => n.type === 'pert/activity');
    return { color: a.properties.color, group: a.properties.group, regKeys: Object.keys(window.pertMeta.groups) };
  });
  console.log('A aucun groupe:', noGroup);
  if (noGroup.color !== '#7ED321') throw new Error('A : couleur libre non appliquee (sans groupe)');
  if (noGroup.group) throw new Error('A : un groupe a ete affecte alors que le champ etait vide');
  if (noGroup.regKeys.length) throw new Error('A : le registre a ete pollue par un import sans groupe');

  // ── B : reorganisation a couloirs groupes (bandes verticales disjointes) ──────
  // 2 activites "Alpha" + 2 "Beta", sans lien (toutes a ES=0 → meme abscisse). Sans
  // grouping elles occuperaient 4 couloirs entremeles ; avec grouping, Alpha et Beta
  // forment deux bandes verticales disjointes. On verifie aussi que X est identique
  // (abscisse ∝ ES inchangee, le groupe ne joue que sur Y).
  const layout = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.groups = {};
    const mk = (group) => { const n = LiteGraph.createNode('pert/activity'); n.properties.group = group; n.properties.duration = 2; g.add(n); pertApplyGroup(n); return n; };
    const a1 = mk('Alpha'), a2 = mk('Alpha'), b1 = mk('Beta'), b2 = mk('Beta');
    pertAutoLayout();
    const yOf = n => n.pos[1];
    const xOf = n => n.pos[0];
    const alphaY = [a1, a2].map(yOf), betaY = [b1, b2].map(yOf);
    const allX = [a1, a2, b1, b2].map(xOf);
    return {
      alphaMax: Math.max(...alphaY), betaMin: Math.min(...betaY),
      sameX: allX.every(x => Math.abs(x - allX[0]) < 0.5)
    };
  });
  console.log('B couloirs groupes:', layout);
  if (!(layout.alphaMax < layout.betaMin)) throw new Error('B : les bandes de groupe se chevauchent verticalement (pas de cohesion)');
  if (!layout.sameX) throw new Error('B : l\'abscisse n\'est plus ∝ ES (le groupe a deplace les taches horizontalement)');

  // ── C : filtre par groupe (les autres estompes) ──────────────────────────────
  const filterGroup = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.groups = {};
    const a = LiteGraph.createNode('pert/activity'); a.properties.group = 'Alpha'; g.add(a);
    const b = LiteGraph.createNode('pert/activity'); b.properties.group = 'Beta'; g.add(b);
    const m = LiteGraph.createNode('pert/milestone'); g.add(m);
    window.pertFilter = { type: 'group', value: 'Alpha' };
    const res = { aDim: pertNodeDimmed(a), bDim: pertNodeDimmed(b), mDim: pertNodeDimmed(m) };
    window.pertFilter = null;
    res.noneDim = pertNodeDimmed(a); // filtre off → rien estompe
    return res;
  });
  console.log('C filtre groupe:', filterGroup);
  if (filterGroup.aDim) throw new Error('C : l\'activite du groupe filtre est estompee a tort');
  if (!filterGroup.bDim) throw new Error('C : une activite hors groupe n\'est pas estompee');
  if (!filterGroup.mDim) throw new Error('C : un jalon n\'est pas estompe sous filtre de groupe');
  if (filterGroup.noneDim) throw new Error('C : estompage actif alors qu\'aucun filtre n\'est defini');

  // ── C : filtre par couleur (insensible a la casse) ───────────────────────────
  const filterColor = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const a = LiteGraph.createNode('pert/activity'); a.properties.color = '#7ED321'; g.add(a);
    const b = LiteGraph.createNode('pert/activity'); b.properties.color = '#4A90D9'; g.add(b);
    window.pertFilter = { type: 'color', value: '#7ed321' }; // casse differente volontaire
    const res = { aDim: pertNodeDimmed(a), bDim: pertNodeDimmed(b) };
    window.pertFilter = null;
    return res;
  });
  console.log('C filtre couleur:', filterColor);
  if (filterColor.aDim) throw new Error('C : l\'activite de la couleur filtree est estompee a tort');
  if (!filterColor.bDim) throw new Error('C : une activite d\'une autre couleur n\'est pas estompee');

  await page.waitForTimeout(100);
  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  if (errors.length) throw new Error('Erreurs JS detectees');

  await browser.close();
  console.log('\n=== SMOKE S7 OK ===');
})().catch(e => { console.error('SMOKE S7 FAIL:', e.message); process.exit(1); });
