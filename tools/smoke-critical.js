// Test ciblé du correctif #26 : le dernier lien du chemin critique doit être rouge
// même lorsqu'un nœud intermédiaire est sélectionné (et pas seulement au clic fond).
// Usage : node tools/smoke-critical.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // Construit une chaîne critique A → B → S (jalon terminal), tout sur le chemin.
  await page.evaluate(() => {
    const g = window.pertGraph;
    g.clear();
    const A = LiteGraph.createNode('pert/activity'); A.properties.label = 'A'; A.properties.duration = 2; A.updateSize(); g.add(A);
    const B = LiteGraph.createNode('pert/activity'); B.properties.label = 'B'; B.properties.duration = 2; B.updateSize(); g.add(B);
    const S = LiteGraph.createNode('pert/milestone'); S.properties.label = 'S'; S.updateSize(); g.add(S);
    A.connect(0, B, 0);
    B.connect(0, S, 0);
    window.__ids = { A: A.id, B: B.id, S: S.id };
    window.pertRecalc();
  });

  // Helper : retourne la couleur des liens A→B et B→S.
  const linkColors = async () => page.evaluate(() => {
    const g = window.pertGraph, { A, B, S } = window.__ids;
    const col = (o, t) => {
      for (const id in g.links) { const l = g.links[id];
        if (l && l.origin_id === o && l.target_id === t) return l.color; }
      return undefined;
    };
    return { AB: col(A, B), BS: col(B, S) };
  });

  // Cas 1 : rien sélectionné (cible par défaut = terminal) → chemin complet rouge.
  await page.evaluate(() => { window.pertHighlightTargetId = null; window.pertHighlightCriticalPath(null); });
  const bg = await linkColors();
  console.log('Fond (rien sélectionné):', bg);
  if (bg.AB !== '#cc0000' || bg.BS !== '#cc0000') throw new Error('Chemin incomplet au clic fond');

  // Cas 2 : nœud intermédiaire A sélectionné → AVANT #26, B→S restait gris.
  await page.evaluate(() => { const { A } = window.__ids;
    window.pertHighlightTargetId = A; window.pertHighlightCriticalPath(A); });
  const selA = await linkColors();
  console.log('Sélection A (intermédiaire):', selA);
  if (selA.AB !== '#cc0000') throw new Error('Lien A→B non rouge (amont)');
  if (selA.BS !== '#cc0000') throw new Error('#26 NON corrigé : dernier lien B→S non rouge à la sélection');

  // Cas 3 : sélection du jalon terminal S → chemin complet rouge aussi.
  await page.evaluate(() => { const { S } = window.__ids;
    window.pertHighlightTargetId = S; window.pertHighlightCriticalPath(S); });
  const selS = await linkColors();
  console.log('Sélection S (terminal):', selS);
  if (selS.AB !== '#cc0000' || selS.BS !== '#cc0000') throw new Error('Chemin incomplet à la sélection du terminal');

  // Cas 4 : surlignage blanc neutralisé. Sélectionner un nœud peuple highlighted_links
  // (LiteGraph force #FFF sur ces liens) ; notre onDrawBackground les vide juste avant
  // drawConnections → après un rendu, la table doit être vide (le rouge prime à l'écran).
  const hl = await page.evaluate(() => {
    const c = window.pertCanvas, { S } = window.__ids;
    c.selectNode(c.graph.getNodeById(S));       // peuple highlighted_links
    const populated = Object.keys(c.highlighted_links).length;
    c.draw(true, true);                          // force un rendu complet (back + front)
    const after = Object.keys(c.highlighted_links).length;
    return { populated, after };
  });
  console.log('Surlignage liens (avant→après rendu):', hl);
  if (hl.populated === 0) throw new Error('Test invalide : highlighted_links non peuplé à la sélection');
  if (hl.after !== 0) throw new Error('#26 rendu : highlighted_links non vidé au draw (le lien resterait blanc)');

  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  if (errors.length) throw new Error('Erreurs JS détectées');

  await browser.close();
  console.log('\n=== SMOKE #26 OK ===');
})().catch(e => { console.error('SMOKE #26 FAIL:', e.message); process.exit(1); });
