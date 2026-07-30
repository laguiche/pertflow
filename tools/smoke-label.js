// Tests cibles Nœud Label (peaufinage) :
//   - Correction : redimensionnement manuel conserve a la frappe (bug : updateSize
//     ecrasait la taille des qu'on editait le texte). Drapeau manual_size (onResize).
//   - Amelioration : taille de police (properties.font_size) — l'auto-fit et le rendu
//     s'y adaptent ; bornes LABEL_MIN_FONT..LABEL_MAX_FONT.
//   - Round-trip .pert : font_size + manual_size + taille manuelle survivent.
// Usage : node tools/smoke-label.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // ── Defauts + auto-fit a la frappe (mode auto) ────────────────────────────────
  const auto = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const l = LiteGraph.createNode('pert/label'); g.add(l);
    const defFont = l.properties.font_size;
    const defManual = l.properties.manual_size;
    const h0 = l.size[1];
    l.properties.text = 'ligne 1\nligne 2\nligne 3';   // plus de lignes → boite plus haute
    l.updateSize();
    const grewOnText = l.size[1] > h0;
    const hBeforeFont = l.size[1];
    l.properties.font_size = 24;                        // police plus grande → interligne plus haut
    l.updateSize();
    const grewOnFont = l.size[1] > hBeforeFont;         // hauteur ∝ police (largeur souvent au mini 160)
    return { defFont, defManual, grewOnText, grewOnFont };
  });
  console.log('auto:', auto);
  if (auto.defFont !== 12) throw new Error('font_size par defaut != 12');
  if (auto.defManual !== false) throw new Error('manual_size par defaut != false');
  if (!auto.grewOnText) throw new Error('mode auto : la boite ne suit pas le texte');
  if (!auto.grewOnFont) throw new Error('mode auto : la boite ne suit pas la police');

  // ── Correction du bug : apres redimensionnement manuel, la frappe ne reinitialise plus ──
  const manual = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const l = LiteGraph.createNode('pert/label'); g.add(l);
    l.size[0] = 400; l.size[1] = 260;                   // l'utilisateur tire la poignee...
    l.onResize();                                       // ...ce que LiteGraph signale via onResize
    const flagged = l.properties.manual_size === true;
    l.properties.text = 'un tout petit texte';          // editer le texte...
    l.updateSize();                                     // ...ne doit PLUS reinitialiser la taille
    const keptOnText = l.size[0] === 400 && l.size[1] === 260;
    l.properties.font_size = 30;                        // changer la police non plus (taille figee)
    l.updateSize();
    const keptOnFont = l.size[0] === 400 && l.size[1] === 260;
    return { flagged, keptOnText, keptOnFont };
  });
  console.log('manual:', manual);
  if (!manual.flagged) throw new Error('onResize ne pose pas manual_size');
  if (!manual.keptOnText) throw new Error('BUG : la frappe reinitialise la taille manuelle');
  if (!manual.keptOnFont) throw new Error('changement de police reinitialise la taille manuelle');

  // ── Stepper de police : bornes respectees (logique buildLabelFontStepper) ─────
  const bounds = await page.evaluate(() => {
    return { min: LABEL_MIN_FONT, max: LABEL_MAX_FONT, def: LABEL_DEFAULT_FONT };
  });
  console.log('bornes police:', bounds);
  if (!(bounds.min < bounds.def && bounds.def < bounds.max))
    throw new Error('bornes de police incoherentes');

  // ── Round-trip .pert : font_size + manual_size + taille manuelle conserves ────
  const rt = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const l = LiteGraph.createNode('pert/label'); g.add(l);
    l.properties.font_size = 20;
    l.size[0] = 333; l.size[1] = 222; l.onResize();     // taille manuelle assumee
    const data = JSON.parse(JSON.stringify(pertSerializeProject()));
    pertApplyProject(data);                             // recharge (rejoue updateSize)
    const l2 = window.pertGraph._nodes.find(n => n.type === 'pert/label');
    return {
      font: l2.properties.font_size,
      manual: l2.properties.manual_size,
      w: l2.size[0], h: l2.size[1]
    };
  });
  console.log('round-trip:', rt);
  if (rt.font !== 20) throw new Error('round-trip : font_size non persiste');
  if (rt.manual !== true) throw new Error('round-trip : manual_size non persiste');
  if (rt.w !== 333 || rt.h !== 222)
    throw new Error('round-trip : la taille manuelle est reinitialisee au chargement');

  await page.waitForTimeout(100);
  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  if (errors.length) throw new Error('Erreurs JS detectees');

  await browser.close();
  console.log('\n=== SMOKE LABEL OK ===');
})().catch(e => { console.error('SMOKE LABEL FAIL:', e.message); process.exit(1); });
