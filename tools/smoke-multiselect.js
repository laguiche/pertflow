// Test : deplacement d'une selection multiple au simple clic-glisser (sans SHIFT).
// Gestes reproduits en vrai (souris Playwright) :
//   1) Ctrl + glisser une zone => selection rectangle de 2 taches (standard, deja OK).
//   2) Clic-glisser SANS modificateur sur une des taches selectionnees => TOUTE la
//      selection se deplace (correctif : avant, il fallait maintenir SHIFT).
// Plus une verification unitaire de la surcharge processNodeSelected.
// Usage : node tools/smoke-multiselect.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // ── Preparation : 2 activites a des positions connues, vue non zoomee ──────────
  await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const mk = (x, y) => {
      const n = LiteGraph.createNode('pert/activity'); n.properties.duration = 3;
      g.add(n); n.updateSize(); n.pos = [x, y]; return n;
    };
    window.__a = mk(200, 320);
    window.__b = mk(520, 320);
    window.pertRecalc();
    // Vue neutre : scale 1, offset 0 → mapping graphe→ecran simple et stable.
    window.pertCanvas.ds.scale = 1;
    window.pertCanvas.ds.offset[0] = 0;
    window.pertCanvas.ds.offset[1] = 0;
    window.pertCanvas.setDirty(true, true);
  });

  // Attendre un rendu : le hit-test souris (getNodeOnPos) s'appuie sur visible_nodes,
  // peuple au 1er dessin. Sans cette attente, le clic « rate » les nœuds (artefact de
  // test uniquement — un utilisateur a toujours des frames entre ses gestes).
  await page.waitForFunction(() => window.pertCanvas.visible_nodes &&
    window.pertCanvas.visible_nodes.length >= 2);

  // Helper : convertit une position GRAPHE en coords page (px CSS).
  //   page = rect + (graphe + offset) * scale     (cf. adjustMouseEvent)
  const toPage = async (gx, gy) => page.evaluate(({ gx, gy }) => {
    const c = document.querySelector('#pertCanvas');
    const r = c.getBoundingClientRect();
    const ds = window.pertCanvas.ds;
    return { x: r.left + (gx + ds.offset[0]) * ds.scale,
             y: r.top + (gy + ds.offset[1]) * ds.scale };
  }, { gx, gy });

  const centerOf = async (which) => page.evaluate((w) => {
    const n = window[w];
    return { gx: n.pos[0] + n.size[0] / 2, gy: n.pos[1] + n.size[1] / 2 };
  }, which);

  // ── 1) Ctrl + glisser une zone englobant les 2 taches ─────────────────────────
  const p1 = await toPage(150, 260);   // coin haut-gauche (fond vide)
  const p2 = await toPage(760, 470);   // coin bas-droit (fond vide)
  await page.keyboard.down('Control');
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  await page.mouse.move((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, { steps: 4 });
  await page.mouse.move(p2.x, p2.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Control');

  const selCount = await page.evaluate(() => Object.keys(window.pertCanvas.selected_nodes).length);
  console.log('1 selection rectangle Ctrl : nœuds selectionnes =', selCount);
  if (selCount !== 2) throw new Error('1 : la selection rectangle Ctrl n\'a pas selectionne les 2 taches');

  // Pause > 300 ms : sinon le mousedown du drag suit celui du box-select de trop pres
  // et LiteGraph le prend pour un DOUBLE-CLIC (seuil 300 ms), qui court-circuite la
  // prise du nœud. Artefact de test uniquement (gestes humains toujours espaces).
  await page.waitForTimeout(400);

  // ── 2) Clic-glisser SANS SHIFT sur la tache A → les 2 doivent bouger ──────────
  const before = await page.evaluate(() => ({
    a: [...window.__a.pos], b: [...window.__b.pos]
  }));
  const ca = await centerOf('__a');
  const start = await toPage(ca.gx, ca.gy);
  const DX = 120, DY = 60; // deplacement en px (scale 1 → identique en graphe)
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + DX / 2, start.y + DY / 2, { steps: 4 });
  await page.mouse.move(start.x + DX, start.y + DY, { steps: 4 });
  await page.mouse.up();

  const after = await page.evaluate(() => ({
    a: [...window.__a.pos], b: [...window.__b.pos]
  }));
  console.log('2 avant:', before, '\n2 apres:', after);

  const movedA = [after.a[0] - before.a[0], after.a[1] - before.a[1]];
  const movedB = [after.b[0] - before.b[0], after.b[1] - before.b[1]];
  const near = (v, t) => Math.abs(v - t) <= 12; // tolerance (arrondis / steps)
  if (!(near(movedA[0], DX) && near(movedA[1], DY)))
    throw new Error('2 : la tache cliquee ne s\'est pas deplacee comme attendu : ' + JSON.stringify(movedA));
  if (!(near(movedB[0], DX) && near(movedB[1], DY)))
    throw new Error('2 : la 2e tache selectionnee n\'a PAS suivi (SHIFT etait donc requis) : ' + JSON.stringify(movedB));

  // ── 3) Verification unitaire de la surcharge processNodeSelected ──────────────
  const unit = await page.evaluate(() => {
    const c = window.pertCanvas, a = window.__a, b = window.__b;
    // (a) clic SANS modificateur sur un nœud DEJA selectionne → selection conservee
    c.selectNodes([a, b]);
    c.processNodeSelected(a, {});
    const keepsMulti = Object.keys(c.selected_nodes).length === 2;
    // (b) clic SANS modificateur sur un nœud NON selectionne → selection unique
    c.selectNodes([a, b]);
    b.is_selected = false; delete c.selected_nodes[b.id]; // b hors selection
    // c contient a; on clique un 3e nœud non selectionne → doit tout reinitialiser
    c.processNodeSelected(b, {});
    const single = Object.keys(c.selected_nodes).length === 1 && c.selected_nodes[b.id];
    // (c) SHIFT sur un nœud selectionne → bascule (deselection) native preservee
    c.selectNodes([a, b]);
    c.processNodeSelected(a, { shiftKey: true });
    const shiftToggles = !a.is_selected;
    return { keepsMulti, single: !!single, shiftToggles };
  });
  console.log('3 surcharge processNodeSelected:', unit);
  if (!unit.keepsMulti) throw new Error('3a : clic sans modificateur sur un nœud selectionne perd la selection');
  if (!unit.single) throw new Error('3b : clic sur un nœud non selectionne ne reinitialise pas a une selection unique');
  if (!unit.shiftToggles) throw new Error('3c : SHIFT ne bascule plus la selection (comportement natif casse)');

  console.log('\nErreurs console/page:', errors.length ? errors : 'aucune');
  if (errors.length) throw new Error('erreurs console/page detectees');
  await browser.close();
  console.log('\n=== SMOKE MULTISELECT OK ===');
})().catch(e => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
