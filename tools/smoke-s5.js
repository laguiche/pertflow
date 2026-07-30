// Tests ciblés Session 5 : #15 (relocalisation des Labels au réarrangement) et
// #20 (états de couleur du Jalon : alert / safe / neutral). #8 vérifié via rendu.
// Usage : node tools/smoke-s5.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // ── #15 : un Label superposé à une activité est relogé hors recouvrement ──────
  const rel = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const A = LiteGraph.createNode('pert/activity'); A.properties.label = 'A'; A.properties.duration = 3; A.updateSize(); g.add(A);
    const B = LiteGraph.createNode('pert/activity'); B.properties.label = 'B'; B.properties.duration = 3; B.updateSize(); g.add(B);
    A.connect(0, B, 0);
    const L = LiteGraph.createNode('pert/label'); L.properties.text = 'Note'; L.updateSize(); g.add(L);
    window.pertRecalc();
    // Force le Label PILE sur l'activité A (recouvrement garanti)
    L.pos = [A.pos[0], A.pos[1]];
    window.pertAutoLayout();
    const overlaps = (a, b) =>
      a.pos[0] < b.pos[0] + b.size[0] && a.pos[0] + a.size[0] > b.pos[0] &&
      a.pos[1] < b.pos[1] + b.size[1] && a.pos[1] + a.size[1] > b.pos[1];
    const placed = g._nodes.filter(n => n.type !== 'pert/label');
    return { stillOverlaps: placed.some(n => overlaps(L, n)), labelY: L.pos[1] };
  });
  console.log('#15 Label relogé:', rel);
  if (rel.stillOverlaps) throw new Error('#15 : le Label chevauche encore une activité après réorganisation');

  // ── #20 : états du Jalon (targetState) ───────────────────────────────────────
  const states = await page.evaluate(() => {
    window.pertMeta.t0 = '2025-01-01';
    window.pertMeta.unit = 'j'; // 1 unité = 1 jour → marges faciles à exprimer
    const mk = () => { const m = LiteGraph.createNode('pert/milestone'); m.ef = 2; m.is_critical = false; m.target_missed = false; return m; };

    const safeNode = mk(); safeNode.properties.due_date = '2025-01-10'; // offset 9, marge 7 ≥ 1
    const tightNode = mk(); tightNode.properties.due_date = '2025-01-03'; // offset 2, marge 0 < 1
    const noTarget = mk(); noTarget.properties.due_date = '';
    const missed = mk(); missed.target_missed = true; missed.properties.due_date = '2025-01-02';
    // is_critical ne doit PAS forcer le rouge : un jalon critique mais largement
    // tenu reste vert (la couleur reflete la cible, pas le chemin critique).
    const criticalButMet = mk(); criticalButMet.is_critical = true; criticalButMet.properties.due_date = '2025-01-10';

    return {
      safe: safeNode.targetState(),
      tight: tightNode.targetState(),
      noTarget: noTarget.targetState(),
      missed: missed.targetState(),
      criticalButMet: criticalButMet.targetState()
    };
  });
  console.log('#20 états:', states);
  const expect = { safe: 'safe', tight: 'neutral', noTarget: 'neutral', missed: 'alert', criticalButMet: 'safe' };
  for (const k in expect) if (states[k] !== expect[k])
    throw new Error('#20 : état ' + k + ' = ' + states[k] + ' (attendu ' + expect[k] + ')');

  // ── #8 : activité avec responsable long → rendu sans erreur + en-tête agrandi ─
  const resp = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const A = LiteGraph.createNode('pert/activity');
    A.properties.label = 'Tâche'; A.updateSize();
    const h0 = A._headerH;
    A.properties.responsible = 'Marie-Christophe de la Tour-Fenouillet';
    A.updateSize();
    const h1 = A._headerH;
    // Rendu hors-écran : ne doit pas lever d'exception
    const ctx = document.createElement('canvas').getContext('2d');
    A.onDrawBackground(ctx);
    return { h0, h1, grew: h1 > h0 };
  });
  console.log('#8 en-tête (sans→avec resp):', resp);
  if (!resp.grew) throw new Error('#8 : l\'en-tête ne s\'agrandit pas pour loger le responsable');

  // ── Barre d'état : chemin critique = marge MINIMALE (≠ 0 si projet infaisable) ─
  // Bug barre d'état : une cible de jalon ratée rendait toutes les marges négatives
  // → aucun nœud à slack 0 → "Chemin critique : 0 nœud(s)" en permanence.
  const status = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.t0 = '2025-01-01'; window.pertMeta.unit = 'mois';
    const A = LiteGraph.createNode('pert/activity'); A.properties.label = 'A'; A.properties.duration = 5; A.updateSize(); g.add(A);
    const M = LiteGraph.createNode('pert/milestone'); M.properties.label = 'M'; M.properties.due_date = '2025-03-01'; M.updateSize(); g.add(M);
    A.connect(0, M, 0);
    window.pertHighlightTargetId = null;
    const res = window.pertRecalc();
    updateStatus();
    // Le nombre de taches du chemin critique est desormais dans #status-cost (S8.5),
    // conscient de la selection ; #status-pert ne porte plus que la fin de projet.
    return { nbCritical: res.nbCritical,
             cost: document.getElementById('status-cost').textContent };
  });
  console.log('Barre d\'état (cible ratée):', status);
  // Projet infaisable (cible ratee → marges negatives) : le chemin critique de marge
  // minimale doit quand meme compter la tache A (et non 0).
  if (status.nbCritical < 1 || /Chemin critique : 0 tâche/.test(status.cost))
    throw new Error('Barre d\'état : chemin critique à 0 alors que le projet est infaisable (marge min négative)');

  // ── Largeur ∝ durée non plafonnée prématurément (bug : 15 et 30 mois identiques) ─
  const widths = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const w = (dur) => { const n = LiteGraph.createNode('pert/activity'); n.properties.duration = dur; n.updateSize(); g.add(n); return n.size[0]; };
    return { w5: w(5.5), w15: w(15), w30: w(30), wHuge: w(9999) };
  });
  console.log('Largeurs (5.5/15/30/typo):', widths);
  if (!(widths.w30 > widths.w15 && widths.w15 > widths.w5))
    throw new Error('Largeur non proportionnelle (plafond trop bas) : ' + JSON.stringify(widths));
  if (Math.abs(widths.w30 - 2 * widths.w15) > 1)
    throw new Error('30 mois devrait faire ~2× 15 mois : ' + JSON.stringify(widths));
  if (widths.wHuge > 3000) throw new Error('garde-fou de largeur dépassé');

  await page.waitForTimeout(100);
  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  if (errors.length) throw new Error('Erreurs JS détectées');

  await browser.close();
  console.log('\n=== SMOKE S5 OK ===');
})().catch(e => { console.error('SMOKE S5 FAIL:', e.message); process.exit(1); });
