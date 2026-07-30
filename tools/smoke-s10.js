// Tests cibles Session 10 : rendu & routage des liens (#46 styles, #19 évitement).
//   - Bascule des modes (courbe/droit/coudé) → links_render_mode + pertLinkMode.
//   - Routage orthogonal : contourne un obstacle ; sans obstacle → Z simple ;
//     mode dégradé (obstacles null) → pas d'erreur.
//   - Rendu réel d'un .pert en mode coudé (draw complet) sans erreur console.
//   - Round-trip meta.link_mode (sérialisation + rechargement).
//   - Non-régression #15 : pertRelocateOverlappingLabels toujours présent.
// Usage : node tools/smoke-s10.js

const fs = require('fs');
const path = require('path');
const lib = require('./lib');
function assert(c, m) { if (!c) throw new Error('ECHEC: ' + m); }

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await lib.openApp(page);
  const pert = JSON.parse(fs.readFileSync(path.join(lib.EXEMPLES, 'pert_a_exporter.pert'), 'utf8'));

  const res = await page.evaluate((data) => {
    const out = {};

    // ── Bascule des modes ──────────────────────────────────────────────────────
    window.pertMeta.link_mode = 'courbe'; pertApplyLinkMode();
    out.courbe = { mode: pertLinkMode(), render: window.pertCanvas.links_render_mode };
    window.pertMeta.link_mode = 'droit'; pertApplyLinkMode();
    out.droit = { mode: pertLinkMode(), render: window.pertCanvas.links_render_mode };
    window.pertMeta.link_mode = 'coude'; pertApplyLinkMode();
    out.coude = { mode: pertLinkMode(), render: window.pertCanvas.links_render_mode };

    // ── Routage orthogonal : obstacle pile sur la ligne a→b ────────────────────
    const a = [0, 100], b = [400, 100];
    const obstacle = { x: 180, y: 80, w: 80, h: 60 }; // recouvre le trace direct
    // reimplemente le test de collision pour verifier le resultat
    function pathHits(pts, obs) {
      for (let i = 1; i < pts.length; i++) {
        if (pertSegHitsRectTest(pts[i - 1], pts[i], obs)) return true;
      }
      return false;
    }
    window.pertSegHitsRectTest = (p1, p2, r) => {
      const x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1];
      if (x1 === x2) { const lo = Math.min(y1, y2), hi = Math.max(y1, y2); return x1 >= r.x && x1 <= r.x + r.w && hi >= r.y && lo <= r.y + r.h; }
      const lo = Math.min(x1, x2), hi = Math.max(x1, x2); return y1 >= r.y && y1 <= r.y + r.h && hi >= r.x && lo <= r.x + r.w;
    };
    const routed = pertRouteOrthogonal(a, b, [obstacle]);
    out.avoid = { npts: routed.length, hits: pathHits(routed, obstacle) };
    // Sans obstacle → Z simple, extremites correctes.
    const zpath = pertRouteOrthogonal(a, b, []);
    out.zEndpoints = (zpath[0][0] === a[0] && zpath[zpath.length - 1][0] === b[0]);
    // Mode degrade (obstacles null) → pas d'erreur, extremites ok.
    const dpath = pertRouteOrthogonal(a, b, null);
    out.degrade = (dpath[0][0] === a[0] && dpath[dpath.length - 1][0] === b[0]);

    // ── Rendu reel en mode coude ───────────────────────────────────────────────
    pertApplyProject(data);
    window.pertMeta.link_mode = 'coude'; pertApplyLinkMode();
    window.pertCanvas.draw(true, true); // force un rendu complet (renderLink orthogonal)
    out.drewCoude = true;

    // ── Round-trip meta.link_mode ──────────────────────────────────────────────
    const ser = pertSerializeProject();
    out.serialized = ser.meta.link_mode;
    window.pertMeta.link_mode = 'courbe';
    pertApplyProject(ser);
    out.reloaded = window.pertMeta.link_mode;

    // ── #15 non-regression ─────────────────────────────────────────────────────
    out.hasRelocate = (typeof pertRelocateOverlappingLabels === 'function');
    return out;
  }, pert);

  console.log(JSON.stringify(res, null, 2));
  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');

  assert(res.courbe.render === 2, 'courbe → SPLINE_LINK(2)');   // LiteGraph.SPLINE_LINK = 2
  assert(res.droit.render === 0, 'droit → STRAIGHT_LINK(0)');    // STRAIGHT_LINK = 0
  assert(res.coude.render === 2, 'coude → SPLINE natif pour le lien elastique');
  assert(res.coude.mode === 'coude', 'mode coude actif');
  assert(res.avoid.hits === false, 'route orthogonale contourne l\'obstacle');
  assert(res.avoid.npts >= 4, 'route orthogonale a des points de detour');
  assert(res.zEndpoints, 'Z simple : extremites a/b');
  assert(res.degrade, 'mode degrade (null) : extremites a/b');
  assert(res.drewCoude, 'rendu coude effectue');
  assert(res.serialized === 'coude', 'link_mode serialise');
  assert(res.reloaded === 'coude', 'link_mode rechargé (round-trip)');
  assert(res.hasRelocate, '#15 pertRelocateOverlappingLabels present');
  assert(errors.length === 0, 'erreurs console');

  console.log('\n=== SMOKE S10 OK ===');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
