// Smoke test ciblé des finitions Session 4 (menu contextuel, snap-to-grid,
// neutralisation searchbox, toast d'erreur, duplication via menu nœud).
// Usage : node tools/smoke-s4.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // 1) Searchbox LiteGraph neutralisée (#28)
  const noSearchbox = await page.evaluate(() => window.pertCanvas.allow_searchbox === false);
  console.log('Searchbox neutralisée:', noSearchbox);
  if (!noSearchbox) throw new Error('allow_searchbox devrait être false');

  // 2) Menu contextuel du fond : items PERT en français, pas de menu natif anglais
  const bgMenu = await page.evaluate(() => window.pertCanvas.getMenuOptions().map(o => o && o.content));
  console.log('Menu fond:', bgMenu.filter(Boolean));
  if (!bgMenu.some(c => c && c.includes('Activité')) || bgMenu.some(c => c === 'Add Node'))
    throw new Error('Menu de fond non francisé');

  // 2 bis) Le sous-menu « Insérer ▾ » de la toolbar (04/09/2026 : les quatre boutons
  //   de création y ont été regroupés, la toolbar passait à la ligne). On vérifie que
  //   chaque entrée crée bien SON type — une inversion de deux callbacks dans une
  //   liste de quatre ne se voit pas à la relecture, et se paierait à chaque usage.
  const insMenu = await page.evaluate(() =>
    window.pertInsertMenuOptions().map(o => o.content));
  console.log('Menu Insérer:', insMenu);
  if (insMenu.length !== 4)
    throw new Error('4 entrées attendues dans « Insérer ▾ », vu ' + insMenu.length);
  for (const [quoi, type] of [['activite', 'pert/activity'], ['jalon', 'pert/milestone'],
                              ['label', 'pert/label'], ['risque', 'pert/risk']]) {
    await lib.insererNoeud(page, quoi);
    const vu = await page.evaluate(() => {
      const g = window.pertGraph;
      const n = g._nodes[g._nodes.length - 1];
      const t = n.type;
      g.remove(n);
      return t;
    });
    if (vu !== type)
      throw new Error('« Insérer ▾ » : l\'entrée ' + quoi + ' a créé ' + vu
        + ' au lieu de ' + type);
  }

  // 3) Menu nœud : Dupliquer + Supprimer ; la duplication crée bien un nœud
  await lib.insererNoeud(page, 'activite');
  await page.waitForTimeout(100);
  const dupResult = await page.evaluate(() => {
    const node = window.pertGraph._nodes[0];
    const menu = window.pertCanvas.getNodeMenuOptions(node).filter(Boolean);
    const labels = menu.map(o => o.content);
    const before = window.pertGraph._nodes.length;
    menu.find(o => o.content.includes('Dupliquer')).callback();
    return { labels, before, after: window.pertGraph._nodes.length };
  });
  console.log('Menu nœud:', dupResult.labels, '| duplication', dupResult.before, '->', dupResult.after);
  if (dupResult.after !== dupResult.before + 1) throw new Error('Duplication échouée');

  // 3b) #25 : le TITRE du menu contextuel de nœud doit être francisé (pas "pert/...").
  // Vrai clic droit Playwright (évènement souris réel) sur l'en-tête d'une activité.
  await page.evaluate(() => window.pertCanvas.deselectAllNodes && window.pertCanvas.deselectAllNodes());
  const sc = await page.evaluate(() => {
    const c = window.pertCanvas;
    const node = window.pertGraph._nodes.find(n => n.type === 'pert/activity');
    const rect = document.getElementById('pertCanvas').getBoundingClientRect();
    const sx = rect.left + (node.pos[0] + 40 + c.ds.offset[0]) * c.ds.scale;
    const sy = rect.top + (node.pos[1] + 6 + c.ds.offset[1]) * c.ds.scale;
    return { sx, sy };
  });
  await page.mouse.click(sc.sx, sc.sy, { button: 'right' });
  await page.waitForTimeout(150);
  const menuTitle = await page.evaluate(() => {
    const titles = document.querySelectorAll('.litemenu-title');
    return titles.length ? titles[titles.length - 1].textContent : null;
  });
  console.log('Titre menu nœud:', menuTitle);
  if (!menuTitle || /pert\//.test(menuTitle)) throw new Error('#25 : titre du menu non francisé (' + menuTitle + ')');
  await page.keyboard.press('Escape'); // ferme le menu

  // 4) Snap-to-grid : toggle ON → état + align_to_grid + grille visible sans erreur
  await page.click('#btn-snap');
  await page.waitForTimeout(150);
  const snapOn = await page.evaluate(() => ({
    enabled: window.pertSnapEnabled,
    align: window.pertCanvas.align_to_grid,
    active: document.getElementById('btn-snap').classList.contains('active')
  }));
  console.log('Snap ON:', snapOn);
  if (!snapOn.enabled || !snapOn.align || !snapOn.active) throw new Error('Snap non activé');

  await page.click('#btn-snap'); // toggle OFF
  await page.waitForTimeout(100);
  const snapOff = await page.evaluate(() => window.pertSnapEnabled === false &&
    window.pertCanvas.align_to_grid === false &&
    !document.getElementById('btn-snap').classList.contains('active'));
  console.log('Snap OFF:', snapOff);
  if (!snapOff) throw new Error('Snap non désactivé');

  // 5) Toast d'erreur : showError applique la classe .error
  const errToast = await page.evaluate(() => {
    window.showError('test erreur');
    const t = document.getElementById('toast');
    return t && t.classList.contains('error') && t.classList.contains('show');
  });
  console.log('Toast erreur:', errToast);
  if (!errToast) throw new Error('Toast erreur KO');

  await page.waitForTimeout(150);
  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  if (errors.length) throw new Error('Erreurs JS détectées');

  await browser.close();
  console.log('\n=== SMOKE S4 OK ===');
})().catch(e => { console.error('SMOKE S4 FAIL:', e.message); process.exit(1); });
