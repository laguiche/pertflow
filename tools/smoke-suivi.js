// Test cible : fenetre de SUIVI D'AVANCEMENT (bouton Synthèse ▾ → Avancement).
//
// Le suivi confronte le PERT a la date du jour ; il est donc par construction relatif
// au calendrier. Tout le test repose sur une date FORCEE (window.pertSuiviToday), sans
// quoi il changerait de resultat chaque matin.
//
// Planning de reference — T0 = lundi 05/01/2026, unite = jours OUVRES, point au
// 15/01/2026 (= offset 8) :
//   A Étude        5 j  TERMINE       es 0   → ne doit apparaitre nulle part
//   B Conception  10 j  EN_COURS      es 5   (WP1)
//   F Doc          3 j  EN_COURS      es 5   (Achats)  → teste le tri par GROUPE
//   C Achats       5 j  NON_COMMENCE  es 5   → es depasse ⇒ « aurait du commencer »
//   D Réalisation  8 j  NON_COMMENCE  es 15  → amont B en cours ⇒ « a engager »
//   E Essais       4 j  NON_COMMENCE  es 23  → ni l'un ni l'autre (rien ne la mure)
//   J4 cible +10 : amont A, TERMINE          → PAS d'alerte (tout l'amont est fait)
//   J3 cible +12 : amont C, NON COMMENCEE    → alerte ROUGE (replanification)
//   J1 cible +14 : amont B, EN COURS         → alerte ORANGE (vigilance)
//   J2 cible +40 : hors horizon              → prochain jalon, mais pas d'alerte
//
// Verifie aussi : les tableaux menent aux nœuds, le bouton de mise en evidence pose
// bien le filtre natif, l'impression PDF sort deux chapitres SANS entrainer la fenetre
// de synthese (fermee), et l'absence de T0 est dite au lieu d'etre subie.
// Usage : node tools/smoke-suivi.js

const lib = require('./lib');

function assert(cond, msg) { if (!cond) throw new Error('ECHEC: ' + msg); }

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  await page.evaluate(() => {
    window.pertSuiviToday = '2026-01-15';       // point d'avancement fige
    const g = window.pertGraph; g.clear();
    window.pertMeta.t0 = '2026-01-05';
    window.pertMeta.unit = 'j';
    window.pertMeta.groups = { 'WP1': '#4A90D9', 'Achats': '#F5A623' };
    const link = (s, d) => s.connect(0, d, d.inputs.length - 1);
    const act = (label, dur, progress, groupe) => {
      const n = LiteGraph.createNode('pert/activity');
      n.properties.label = label; n.properties.duration = dur;
      n.properties.progress = progress; n.properties.group = groupe || '';
      n.updateSize(); g.add(n);
      return n;
    };
    const jal = (label, off) => {
      const n = LiteGraph.createNode('pert/milestone');
      n.properties.label = label; n.properties.due_mode = 'offset';
      n.properties.due_offset = off; n.updateSize(); g.add(n);
      return n;
    };
    const A = act('Étude', 5, 'TERMINE', 'WP1');
    const B = act('Conception', 10, 'EN_COURS', 'WP1');
    const F = act('Doc', 3, 'EN_COURS', 'Achats');
    const C = act('Achats', 5, 'NON_COMMENCE', 'Achats');
    const D = act('Réalisation', 8, 'NON_COMMENCE', 'WP1');
    const E = act('Essais', 4, 'NON_COMMENCE', 'WP1');
    const J4 = jal('Jalon amont fait', 10);
    const J3 = jal('Revue achats', 12);
    const J1 = jal('Revue conception', 14);
    const J2 = jal('Livraison finale', 40);
    link(A, B); link(A, F); link(A, C); link(B, D); link(D, E);
    link(A, J4); link(C, J3); link(B, J1); link(E, J2);
    pertRecalc();
  });

  // Extracteur generique : titres de sections d'un panneau + contenu des lignes.
  const lire = (panel) => page.evaluate((sel) => {
    const out = [];
    document.querySelectorAll('#suivi-content .synth-panel[data-panel="' + sel + '"] .synth-section')
      .forEach(sec => {
        const h = sec.querySelector('h4');
        const rows = [];
        sec.querySelectorAll('tbody tr').forEach(tr => {
          rows.push({
            cls: tr.className || '',
            cells: Array.from(tr.children).map(td => td.textContent.trim()),
            liens: Array.from(tr.querySelectorAll('.synth-link')).map(a => a.textContent.trim()),
          });
        });
        out.push({
          titre: h ? h.textContent.trim() : '',
          vide: !!sec.querySelector('.synth-empty'),
          rows,
        });
      });
    return out;
  }, panel);

  // ── Ouverture par le CHEMIN UTILISATEUR (sous-menu du bouton Synthèse) ────────
  await page.click('#btn-synthesis');
  await page.waitForTimeout(200);
  const menu = await page.evaluate(() => Array.from(
    document.querySelectorAll('.litegraph.litecontextmenu .litemenu-entry'))
    .map(e => e.textContent.trim()));
  console.log('sous-menu Synthèse :', menu);
  assert(menu.length === 2, '2 entrees attendues dans le sous-menu, vu ' + menu.length);
  assert(/Planification/.test(menu[0]) && /Avancement/.test(menu[1]),
    'sous-menu attendu : Planification puis Avancement — vu ' + menu.join(' | '));
  await page.evaluate(() => Array.from(
    document.querySelectorAll('.litegraph.litecontextmenu .litemenu-entry'))
    .find(e => /Avancement/.test(e.textContent)).click());
  await page.waitForTimeout(300);

  const ouverte = await page.evaluate(() =>
    document.getElementById('suivi-dialog').style.display);
  assert(ouverte === 'flex', 'la fenetre de suivi ne s\'est pas ouverte');

  // ── Onglet Tâches ─────────────────────────────────────────────────────────────
  const taches = await lire('taches');
  taches.forEach(s => console.log('  [tâches]', s.titre,
    s.vide ? '(vide)' : '→ ' + s.rows.map(r => r.cells[0]).join(', ')));

  const enCours = taches.find(s => /^En cours/.test(s.titre));
  assert(enCours, 'section « En cours » absente');
  assert(enCours.titre === 'En cours (2)', 'titre attendu « En cours (2) », vu ' + enCours.titre);
  // Tri demande : par GROUPE, puis chronologique sur l'ES. « Achats » avant « WP1 ».
  assert(enCours.rows.map(r => r.cells[0]).join('|') === 'Doc|Conception',
    'tri par groupe puis ES attendu (Doc/Achats avant Conception/WP1) — vu '
    + enCours.rows.map(r => r.cells[0] + '/' + r.cells[1]).join('|'));

  const aEngager = taches.find(s => /^À engager/.test(s.titre));
  assert(aEngager && aEngager.rows.length === 1,
    '1 tache a engager attendue, vu ' + (aEngager ? aEngager.rows.length : 'section absente'));
  assert(aEngager.rows[0].cells[0] === 'Réalisation',
    '« Réalisation » attendue a engager, vu ' + aEngager.rows[0].cells[0]);
  assert(aEngager.rows[0].cells[2] === 'Amont en cours',
    'motif « Amont en cours » attendu, vu ' + aEngager.rows[0].cells[2]);

  const retard = taches.find(s => /^Auraient dû commencer/.test(s.titre));
  assert(retard && retard.rows.length === 1,
    '1 tache en retard attendue, vu ' + (retard ? retard.rows.length : 'section absente'));
  assert(retard.rows[0].cells[0] === 'Achats',
    '« Achats » attendue en retard, vu ' + retard.rows[0].cells[0]);
  assert(retard.rows[0].cells[3] === '+3 j',
    'retard de 3 jours ouvres attendu, vu ' + retard.rows[0].cells[3]);
  // Amont entierement termine → rien ne bloque, c'est la tache elle-meme qu'il faut lancer.
  assert(retard.rows[0].cells[4] === '—',
    'aucun bloquant amont attendu (Étude est terminée), vu ' + retard.rows[0].cells[4]);
  assert(/synth-mile-alert/.test(retard.rows[0].cls), 'la ligne en retard doit etre en alerte');

  // Une tache TERMINEE n'a plus rien a piloter : elle ne doit apparaitre dans aucune liste.
  const tousLibelles = taches.flatMap(s => s.rows.map(r => r.cells[0]));
  assert(tousLibelles.indexOf('Étude') === -1,
    'une tache terminee ne doit figurer dans aucune liste de suivi');
  // Une tache dont rien ne murit l'engagement non plus.
  assert(tousLibelles.indexOf('Essais') === -1,
    '« Essais » n\'est ni en cours, ni mure, ni en retard : elle ne doit pas etre listee');

  // ── Onglet Jalons ─────────────────────────────────────────────────────────────
  const jalons = await lire('jalons');
  jalons.forEach(s => console.log('  [jalons]', s.titre,
    s.vide ? '(vide)' : '→ ' + s.rows.map(r => r.cells[0]).join(', ')));

  const prochains = jalons.find(s => /^Prochains jalons/.test(s.titre));
  assert(prochains, 'section « Prochains jalons » absente');
  assert(prochains.rows.map(r => r.cells[0]).join('|')
      === 'Jalon amont fait|Revue achats|Revue conception|Livraison finale',
    'jalons attendus par ordre chronologique — vu ' + prochains.rows.map(r => r.cells[0]).join('|'));
  assert(prochains.rows[0].cells[3] === 'dans 2 j',
    'delai « dans 2 j » attendu pour le 1er jalon, vu ' + prochains.rows[0].cells[3]);

  const alerte = jalons.find(s => /^Jalons en alerte/.test(s.titre));
  assert(alerte, 'section « Jalons en alerte » absente');
  assert(alerte.rows.map(r => r.cells[0]).join('|') === 'Revue achats|Revue conception',
    'deux jalons en alerte attendus (achats puis conception) — vu '
    + alerte.rows.map(r => r.cells[0]).join('|'));
  // Amont NON COMMENCE → rouge (replanification) ; amont seulement EN COURS → orange.
  assert(/synth-mile-alert/.test(alerte.rows[0].cls),
    'amont non commencé ⇒ alerte rouge attendue, vu ' + alerte.rows[0].cls);
  assert(/synth-mile-neutral/.test(alerte.rows[1].cls),
    'amont en cours ⇒ vigilance orange attendue, vu ' + alerte.rows[1].cls);
  // Le jalon dont TOUT l'amont est termine n'est pas une alerte, meme proche.
  assert(alerte.rows.every(r => r.cells[0] !== 'Jalon amont fait'),
    'un jalon dont tout l\'amont est terminé ne doit pas etre en alerte');
  // La tache amont en cause est nommee ET cliquable : on doit pouvoir y aller.
  assert(alerte.rows[0].liens.join('|') === 'Revue achats|Achats',
    'le jalon et sa tache amont doivent etre cliquables — vu ' + alerte.rows[0].liens.join('|'));

  // ── Badges d'onglet : savoir qu'il y a a voir sans ouvrir ─────────────────────
  const badges = await page.evaluate(() => Array.from(
    document.querySelectorAll('#suivi-tabs .synth-tab'))
    .map(t => {
      const b = t.querySelector('.synth-tab-badge');
      return t.dataset.tab + ':' + (b ? b.textContent : '0');
    }));
  console.log('badges :', badges);
  assert(badges.join('|') === 'taches:1|jalons:2',
    'badges attendus taches:1 jalons:2 — vu ' + badges.join('|'));

  // ── Retour au planning : le lien mene au nœud, ferme la fenetre ET LEVE LE FILTRE
  // Correctif du bug v0.20 : on POSE d'abord un filtre qui estompe la cible, puis on
  // clique son lien. Sans le correctif, l'outil centrait la vue sur un nœud noye sous
  // le voile — c'est l'enchainement « filtrer, ouvrir la synthese, cliquer un lien »
  // qui le rendait le plus deroutant.
  const nav = await page.evaluate(() => {
    applyFilter({ type: 'progress', value: 'TERMINE' }, true);   // Doc n'y est pas
    updateFilterTrigger();
    const sec = Array.from(document.querySelectorAll('#suivi-content .synth-section'))
      .find(s => /^En cours/.test(s.querySelector('h4').textContent));
    const cible = sec.querySelector('.synth-link');
    const estompeeAvant = pertNodeDimmed(
      window.pertGraph._nodes.find(n => n.properties.label === 'Doc'));
    cible.click();
    const sel = Object.values(window.pertCanvas.selected_nodes || {});
    return {
      ferme: document.getElementById('suivi-dialog').style.display,
      selectionne: sel.length ? sel[0].properties.label : null,
      estompeeAvant,
      filtreApres: window.pertFilter,
      estompeeApres: pertNodeDimmed(
        window.pertGraph._nodes.find(n => n.properties.label === 'Doc')),
      declencheur: document.getElementById('filter-current').textContent,
    };
  });
  console.log('navigation :', nav);
  assert(nav.ferme === 'none', 'aller a un nœud doit fermer la fenetre (elle recouvre le planning)');
  assert(nav.selectionne === 'Doc', '« Doc » devait etre selectionnee, vu ' + nav.selectionne);
  assert(nav.estompeeAvant === true, 'le scenario exige que la cible soit estompee AVANT le clic');
  assert(nav.filtreApres === null,
    'aller a un nœud doit lever le filtre (bug v0.20) — vu ' + JSON.stringify(nav.filtreApres));
  assert(nav.estompeeApres === false, 'le nœud atteint ne doit plus etre estompe');
  assert(/aucun/i.test(nav.declencheur),
    'le declencheur doit repasser a « aucun », vu ' + nav.declencheur);

  // ── Mise en evidence : le bouton pose le filtre NATIF d'avancement ────────────
  const miseEnEvidence = await page.evaluate(() => {
    pertOpenSuiviDialog();
    const sec = Array.from(document.querySelectorAll('#suivi-content .synth-section'))
      .find(s => /^En cours/.test(s.querySelector('h4').textContent));
    sec.querySelector('.synth-goto').click();
    return {
      filtre: window.pertFilter && window.pertFilter.type + ':' + window.pertFilter.value,
      ferme: document.getElementById('suivi-dialog').style.display,
      vifs: window.pertGraph._nodes.filter(n => !pertNodeDimmed(n))
        .map(n => n.properties.label).sort().join('|'),
      declencheur: document.getElementById('filter-current').textContent,
    };
  });
  console.log('mise en évidence :', miseEnEvidence);
  assert(miseEnEvidence.filtre === 'progress:EN_COURS',
    'le bouton doit poser le filtre natif d\'avancement, vu ' + miseEnEvidence.filtre);
  assert(miseEnEvidence.vifs === 'Conception|Doc',
    'seules les taches en cours doivent rester vives, vu ' + miseEnEvidence.vifs);
  await page.evaluate(() => { applyFilter(null); updateFilterTrigger(); });

  // ── Impression : deux chapitres, et la synthese FERMEE ne s'invite pas ────────
  // Regression guettee : les regles @media print ciblaient #synthesis-dialog par son
  // id ; avec deux fenetres, un `display: block !important` sur un id aurait
  // force-affiche la fenetre fermee. Elles ciblent desormais le MARQUEUR de la fenetre
  // en cours d'impression — ce controle en est la preuve.
  await page.evaluate(() => { pertOpenSuiviDialog(); pertPrintMark('suivi-dialog', true); });
  const pdf = await page.pdf({ format: 'A4', printBackground: false });
  await page.evaluate(() => pertPrintMark('suivi-dialog', false));
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const texte = pdf.toString('latin1');
  console.log('PDF : ' + pages + ' page(s), ' + Math.round(pdf.length / 1024) + ' Ko');
  assert(pages >= 2, '2 chapitres = 2 pages au minimum, vu ' + pages);
  assert(texte.indexOf('planification') === -1,
    'la fenetre de synthese, pourtant fermee, s\'est imprimee avec le suivi');

  // ── Sans T0 : le suivi le dit, il ne rend pas des tableaux faussement vides ───
  const sansT0 = await page.evaluate(() => {
    window.pertMeta.t0 = '';
    pertOpenSuiviDialog();
    const txt = document.getElementById('suivi-content').textContent;
    pertCloseSuiviDialog();
    window.pertMeta.t0 = '2026-01-05';
    return txt;
  });
  assert(/Définissez d'abord la date T0/.test(sansT0),
    'sans T0, le suivi doit expliquer pourquoi il ne peut rien afficher');
  console.log('sans T0 : message explicite affiché');

  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  assert(errors.length === 0, 'erreurs console');

  console.log('\n=== SMOKE SUIVI OK ===');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
