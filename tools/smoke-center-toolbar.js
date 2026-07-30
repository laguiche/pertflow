// Verifie les 2 evolutions pre-S9 :
//   1) un noeud cree via un bouton toolbar atterrit au CENTRE de l'espace visible,
//      y compris apres un zoom/pan (formule getCanvasCenter corrigee) ;
//   2) la toolbar reste entierement accessible en petite resolution (flex-wrap :
//      le dernier bouton « A propos » est cliquable, non rogne).
const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch({ viewport: { width: 1400, height: 900 } });
  try {
    await lib.openApp(page);

    // --- Evolution 1 : centrage a un zoom/pan non trivial -------------------
    await page.evaluate(() => {
      const c = window.pertCanvas;
      c.ds.scale = 0.5;            // zoom arriere
      c.ds.offset[0] = 137;        // pan quelconque
      c.ds.offset[1] = -84;
      c.setDirty(true, true);
    });

    const res = await page.evaluate(() => {
      const before = window.pertGraph._nodes.length;
      document.getElementById('btn-add-activity').click();
      const nodes = window.pertGraph._nodes;
      const n = nodes[nodes.length - 1];
      const c = window.pertCanvas, cv = document.getElementById('pertCanvas');
      // centre du noeud en coords graphe
      const gx = n.pos[0] + n.size[0] / 2;
      const gy = n.pos[1] + n.size[1] / 2;
      // -> ecran (convention ecran = (graphe + offset) * scale)
      const sx = (gx + c.ds.offset[0]) * c.ds.scale;
      const sy = (gy + c.ds.offset[1]) * c.ds.scale;
      return { added: nodes.length - before, sx, sy, cw: cv.width, ch: cv.height };
    });

    if (res.added !== 1) throw new Error('bouton toolbar : noeud non ajoute');
    const dx = Math.abs(res.sx - res.cw / 2);
    const dy = Math.abs(res.sy - res.ch / 2);
    // tolerance : quelques px (arrondis de taille)
    if (dx > 2 || dy > 2) {
      throw new Error(`noeud non centre : ecart ecran (${dx.toFixed(1)},${dy.toFixed(1)})px `
        + `centre attendu (${res.cw / 2},${res.ch / 2}) obtenu (${res.sx.toFixed(1)},${res.sy.toFixed(1)})`);
    }
    console.log(`Centrage OK a scale=0.5/pan : ecart (${dx.toFixed(2)}, ${dy.toFixed(2)}) px`);

    // --- Zoom -/+ (boutons toolbar) : monotonie + clamp -----------------------
    const z = await page.evaluate(() => {
      const c = window.pertCanvas;
      c.ds.changeScale(1); c.setDirty(true, true);
      const s0 = c.ds.scale;
      document.getElementById('btn-zoom-in').click(); const s1 = c.ds.scale;
      document.getElementById('btn-zoom-out').click(); const s2 = c.ds.scale;
      for (let i = 0; i < 40; i++) document.getElementById('btn-zoom-out').click();
      const smin = c.ds.scale;
      for (let i = 0; i < 60; i++) document.getElementById('btn-zoom-in').click();
      const smax = c.ds.scale;
      return { s0, s1, s2, smin, smax, min: c.ds.min_scale, max: c.ds.max_scale };
    });
    if (!(z.s1 > z.s0)) throw new Error('zoom + ne monte pas');
    if (Math.abs(z.s2 - z.s0) > 1e-6) throw new Error('zoom - ne revient pas');
    if (z.smin < z.min - 1e-9 || z.smax > z.max + 1e-9) throw new Error('clamp zoom KO');
    console.log(`Zoom OK : ${z.s0}→${z.s1.toFixed(2)}→${z.s2}, clamp [${z.smin}, ${z.smax}]`);

    // --- Evolution 2 : toolbar accessible en petite largeur -----------------
    await page.setViewportSize({ width: 720, height: 800 });
    await page.waitForTimeout(150);
    const tb = await page.evaluate(() => {
      const bar = document.getElementById('toolbar');
      const info = document.getElementById('btn-info');
      const br = bar.getBoundingClientRect();
      const ir = info.getBoundingClientRect();
      // bouton visible et entierement dans les bornes de la toolbar
      const inside = ir.right <= br.right + 0.5 && ir.bottom <= br.bottom + 0.5
        && ir.left >= br.left - 0.5 && ir.top >= br.top - 0.5;
      return { wrapped: br.height > 50, inside, barH: br.height, infoRight: ir.right, barRight: br.right };
    });
    if (!tb.wrapped) throw new Error('toolbar non enroulee a 720px (attendu multi-lignes)');
    if (!tb.inside) throw new Error('bouton « A propos » hors des bornes visibles de la toolbar');

    // clic reel pour confirmer l'accessibilite
    await page.click('#btn-info');
    const aboutVisible = await page.evaluate(() =>
      getComputedStyle(document.getElementById('about-dialog')).display !== 'none');
    if (!aboutVisible) throw new Error('bouton « A propos » non cliquable apres wrap');
    console.log(`Toolbar wrap OK a 720px : hauteur ${tb.barH.toFixed(0)}px, « A propos » accessible et cliquable`);

    console.log('\n=== SMOKE CENTER+TOOLBAR OK ===');
  } catch (e) {
    console.error('SMOKE FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
