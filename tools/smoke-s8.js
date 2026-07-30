// Tests cibles Session 8 : proprietes & jalons enrichis.
//   #12 — Note libre d'Activite (properties.notes, panneau seul, round-trip .pert)
//   #13 — Datalist des responsables deja saisis (collectResponsibles)
//   #17 — Tag de type de Jalon (properties.tag, pastille, taille, round-trip ;
//         sans effet sur targetState/calcul)
//   #18 — Largeur ∝ duree optionnelle (meta.prop_width pilote updateSize ; round-trip)
// Usage : node tools/smoke-s8.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // ── #12 : note libre — propriete par defaut, ecriture, NON rendue (pas d'effet taille) ──
  const notes = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const a = LiteGraph.createNode('pert/activity'); g.add(a);
    const def = a.properties.notes;                 // defaut ""
    const wBefore = a.size[0], hBefore = a.size[1];
    a.properties.notes = 'hypothese: charge estimee a partir du lot precedent\nligne 2';
    a.updateSize();                                 // ne doit pas changer la taille
    return { def, sameW: a.size[0] === wBefore, sameH: a.size[1] === hBefore };
  });
  console.log('#12 notes:', notes);
  if (notes.def !== '') throw new Error('#12 : note par defaut non vide');
  if (!notes.sameW || !notes.sameH) throw new Error('#12 : la note a modifie la taille du nœud (doit etre panneau seul)');

  // ── #13 : responsables collectes pour la datalist (dedoublonnes, tries) ────────
  const resp = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const mk = r => { const n = LiteGraph.createNode('pert/activity'); n.properties.responsible = r; g.add(n); return n; };
    mk('Zoe'); mk('Anne'); mk('Zoe'); mk('');       // doublon + vide a ignorer
    return collectResponsibles();
  });
  console.log('#13 responsables:', resp);
  if (resp.length !== 2 || resp[0] !== 'Anne' || resp[1] !== 'Zoe')
    throw new Error('#13 : collectResponsibles incorrect (dedoublonnage/tri)');

  // ── #17 : tag de jalon — defaut, lookup, taille augmente, sans effet sur targetState ──
  const tag = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = LiteGraph.createNode('pert/milestone'); g.add(m);
    const def = m.properties.tag;                   // defaut ""
    const stateBefore = m.targetState();
    const hBefore = m.size[1];
    m.properties.tag = 'DOTD';
    m.updateSize();
    const grew = m.size[1] > hBefore;               // la pastille reserve une ligne
    const stateAfter = m.targetState();             // tag ne touche PAS la tenue de cible
    return {
      def, grew,
      lookupOk: !!(pertMilestoneTag('DOTD') && pertMilestoneTag('DOTD').color),
      lookupNone: pertMilestoneTag('') === null && pertMilestoneTag('ZZZ') === null,
      stateStable: stateBefore === stateAfter,
      nbTags: PERT_MILESTONE_TAGS.length
    };
  });
  console.log('#17 tag:', tag);
  if (tag.def !== '') throw new Error('#17 : tag par defaut non vide');
  if (!tag.grew) throw new Error('#17 : la pastille de tag ne reserve pas de place (hauteur inchangee)');
  if (!tag.lookupOk) throw new Error('#17 : pertMilestoneTag ne resout pas un tag connu');
  if (!tag.lookupNone) throw new Error('#17 : pertMilestoneTag devrait renvoyer null pour ""/inconnu');
  if (!tag.stateStable) throw new Error('#17 : le tag a modifie la tenue de cible (doit etre independant)');
  if (tag.nbTags !== 3) throw new Error('#17 : nombre de tags inattendu');

  // ── Note libre de Jalon (peaufinage) — defaut "", NON rendue (pas d'effet taille) ──
  const mNotes = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = LiteGraph.createNode('pert/milestone'); g.add(m);
    const def = m.properties.notes;                 // defaut ""
    const wBefore = m.size[0], hBefore = m.size[1];
    m.properties.notes = 'contexte: livraison client attendue\nligne 2';
    m.updateSize();                                 // ne doit pas changer la taille
    return { def, sameW: m.size[0] === wBefore, sameH: m.size[1] === hBefore };
  });
  console.log('jalon notes:', mNotes);
  if (mNotes.def !== '') throw new Error('jalon notes : note par defaut non vide');
  if (!mNotes.sameW || !mNotes.sameH) throw new Error('jalon notes : la note a modifie la taille du nœud (doit etre panneau seul)');

  // ── #18 : largeur ∝ duree optionnelle (meta.prop_width) ───────────────────────
  const width = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const a = LiteGraph.createNode('pert/activity'); a.properties.duration = 20; g.add(a);
    window.pertMeta.prop_width = true;  a.updateSize(); const wOn = a.size[0];
    window.pertMeta.prop_width = false; a.updateSize(); const wOff = a.size[0];
    window.pertMeta.prop_width = true;  a.updateSize(); const wBack = a.size[0];
    return { wOn, wOff, wBack };
  });
  console.log('#18 largeur:', width);
  if (!(width.wOn > width.wOff)) throw new Error('#18 : desactiver prop_width ne reduit pas la largeur');
  if (width.wOn !== width.wBack) throw new Error('#18 : la largeur n\'est pas reversible (toggle)');

  // ── Round-trip .pert : notes + tag + prop_width survivent a sauvegarde/chargement ──
  const roundTrip = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const a = LiteGraph.createNode('pert/activity'); a.properties.notes = 'NOTE-X'; g.add(a);
    const m = LiteGraph.createNode('pert/milestone'); m.properties.tag = 'ING'; m.properties.notes = 'NOTE-M'; g.add(m);
    window.pertMeta.prop_width = false;
    const data = pertSerializeProject();
    // round-trip via JSON pour simuler le fichier
    const clone = JSON.parse(JSON.stringify(data));
    // on remet des valeurs differentes pour verifier que apply ecrase bien
    window.pertMeta.prop_width = true;
    pertApplyProject(clone);
    const g2 = window.pertGraph;
    const a2 = g2._nodes.find(n => n.type === 'pert/activity');
    const m2 = g2._nodes.find(n => n.type === 'pert/milestone');
    return {
      notes: a2.properties.notes,
      mNotes: m2.properties.notes,
      tag: m2.properties.tag,
      propWidth: window.pertMeta.prop_width
    };
  });
  console.log('round-trip:', roundTrip);
  if (roundTrip.notes !== 'NOTE-X') throw new Error('round-trip : note non persistee');
  if (roundTrip.mNotes !== 'NOTE-M') throw new Error('round-trip : note de jalon non persistee');
  if (roundTrip.tag !== 'ING') throw new Error('round-trip : tag de jalon non persiste');
  if (roundTrip.propWidth !== false) throw new Error('round-trip : prop_width non persiste');

  await page.waitForTimeout(100);
  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  if (errors.length) throw new Error('Erreurs JS detectees');

  await browser.close();
  console.log('\n=== SMOKE S8 OK ===');
})().catch(e => { console.error('SMOKE S8 FAIL:', e.message); process.exit(1); });
