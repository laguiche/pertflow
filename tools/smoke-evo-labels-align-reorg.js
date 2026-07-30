// Verification e2e des 3 evolutions (branche evo/labels-alignement-reorg) :
//  1. Reorganisation "axe temps seul" (X pur ∝ ES, ordonnees conservees)
//  2. Label : justification + gras + couleur texte + couleur fond (round-trip)
//  3. Boite a outils d'alignement de la selection
// Navigateur reel (Playwright/Chromium, file://), comme les autres smoke tests.

const assert = require('assert');
const { launch, openApp } = require('./lib');

(async () => {
  const { browser, page } = await launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await openApp(page);

  // ── 1. Reorganisation axe temps seul ─────────────────────────────────────────
  const reorg = await page.evaluate(() => {
    const g = window.pertGraph;
    g.clear();
    const a = LiteGraph.createNode('pert/activity');
    const b = LiteGraph.createNode('pert/activity');
    a.properties.duration = 3; b.properties.duration = 2;
    a.pos = [999, 111]; b.pos = [50, 777];   // positions "manuelles" arbitraires
    g.add(a); g.add(b);
    // chaine A -> B pour que B ait un ES > 0
    a.connect(0, b, 0);
    pertRecalc();
    const yA0 = a.pos[1], yB0 = b.pos[1];
    pertAutoLayoutTimeOnly();
    const PX = 60, M = 60;
    return {
      xA: a.pos[0], xB: b.pos[0],
      esA: a.es, esB: b.es,
      expXA: M + a.es * PX, expXB: M + b.es * PX,
      yKeptA: a.pos[1] === yA0, yKeptB: b.pos[1] === yB0
    };
  });
  assert.strictEqual(reorg.xA, reorg.expXA, 'X pur ∝ ES pour A');
  assert.strictEqual(reorg.xB, reorg.expXB, 'X pur ∝ ES pour B (pas de rang×gap)');
  assert.ok(reorg.yKeptA && reorg.yKeptB, 'ordonnees conservees');
  assert.ok(reorg.esB > reorg.esA, 'B apres A dans le temps');
  console.log('1 reorg temps-seul:', reorg);

  // ── 2. Label : justif + gras + couleurs + round-trip ─────────────────────────
  const label = await page.evaluate(() => {
    const g = window.pertGraph;
    g.clear();
    const l = LiteGraph.createNode('pert/label');
    l.properties.text = 'Ligne une\nLigne deux plus longue';
    g.add(l);
    const wBefore = l.size[0];
    l.properties.bold = true; l.updateSize();
    const wBold = l.size[0];              // le gras elargit l'auto-fit
    l.properties.text_align = 'center';
    l.properties.text_color = '#cc0000';
    l.properties.bg_color = '#eef7ff';
    // round-trip .pert : serialize -> configure
    const snap = g.serialize();
    g.clear();
    g.configure(snap);
    g._nodes.forEach(n => n.updateSize && n.updateSize());
    const r = g._nodes.find(n => n.type === 'pert/label');
    return {
      wBefore, wBold, wider: wBold >= wBefore,
      align: r.properties.text_align, bold: r.properties.bold,
      textColor: r.properties.text_color, bgColor: r.properties.bg_color
    };
  });
  assert.ok(label.wider, 'gras elargit la boite (auto-fit conscient du gras)');
  assert.strictEqual(label.align, 'center', 'alignement survit au round-trip');
  assert.strictEqual(label.bold, true, 'gras survit au round-trip');
  assert.strictEqual(label.textColor, '#cc0000', 'couleur texte survit au round-trip');
  assert.strictEqual(label.bgColor, '#eef7ff', 'couleur fond survit au round-trip');
  console.log('2 label:', label);

  // ── 3. Alignement de la selection ────────────────────────────────────────────
  const align = await page.evaluate(() => {
    const g = window.pertGraph, c = window.pertCanvas;
    g.clear();
    const mk = (x, y, w, h) => {
      const n = LiteGraph.createNode('pert/label');
      n.pos = [x, y]; n.size = [w, h]; n.properties.manual_size = true;
      g.add(n); return n;
    };
    const n1 = mk(0, 0, 100, 40);
    const n2 = mk(200, 100, 60, 80);
    const n3 = mk(400, 300, 120, 20);
    const selectAll = () => { c.selected_nodes = { [n1.id]: n1, [n2.id]: n2, [n3.id]: n3 }; };

    selectAll(); pertAlignSelection('left');
    const left = [n1.pos[0], n2.pos[0], n3.pos[0]];

    selectAll(); pertAlignSelection('top');
    const top = [n1.pos[1], n2.pos[1], n3.pos[1]];

    // repartition horizontale : remettre des X distincts puis repartir
    n1.pos[0] = 0; n2.pos[0] = 50; n3.pos[0] = 500;
    selectAll(); pertAlignSelection('distribute-h');
    const cx = [n1, n2, n3].map(n => n.pos[0] + n.size[0] / 2).sort((a, b) => a - b);
    const gap1 = cx[1] - cx[0], gap2 = cx[2] - cx[1];

    // garde : repartition ignoree sous 3 noeuds
    c.selected_nodes = { [n1.id]: n1, [n2.id]: n2 };
    const before = n2.pos[0];
    pertAlignSelection('distribute-h');
    const distIgnoredUnder3 = (n2.pos[0] === before);

    return { left, top, gap1, gap2, evenSpacing: Math.abs(gap1 - gap2) < 0.001, distIgnoredUnder3 };
  });
  assert.ok(align.left.every(x => x === align.left[0]), 'aligner a gauche : meme X');
  assert.ok(align.top.every(y => y === align.top[0]), 'aligner en haut : meme Y');
  assert.ok(align.evenSpacing, 'repartition H : espacement egal des centres');
  assert.ok(align.distIgnoredUnder3, 'repartition ignoree sous 3 noeuds');
  console.log('3 alignement:', align);

  assert.strictEqual(errors.length, 0, 'erreurs console: ' + errors.join(' | '));
  console.log('Erreurs console/page: aucune');
  console.log('\n=== SMOKE EVO (labels/align/reorg) OK ===');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
