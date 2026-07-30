// Verification du BUNDLE autoporteur (dist/pertflow.html) ouvert en file://, et non
// des sources : c'est ce fichier-la qui est livre. Un module manquant a l'inline ou un
// ordre de scripts different ne se verrait pas en testant index.html.
const path = require('path');
const lib = require('./lib');
const BUNDLE = 'file:///home/laguiche/workspace/pertflow/dist/pertflow.html';

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(BUNDLE);
  await page.waitForFunction(() => window.pertGraph != null);
  await page.waitForTimeout(400);

  const res = await page.evaluate(async () => {
    const out = {};
    // Les trois fonctionnalites sont-elles chargees dans le bundle ?
    out.aFonctions = {
      trame: typeof pertDrawTimeGrid === 'function',
      installTrame: typeof pertInstallTimeGrid === 'function',
      aimant: typeof pertSnapLabelToNeighbors === 'function',
      synth: typeof pertBuildSynthesisModel === 'function',
    };
    out.caseParametres = !!document.getElementById('settings-timegrid');
    // Onglets + curseur d'intensite (v0.18) : presents ET fonctionnels dans le bundle.
    out.onglets = document.querySelectorAll('#settings-tabs .settings-tab').length;
    out.curseur = !!document.getElementById('settings-timegrid-intensity');
    openSettings();
    const tabAff = document.querySelector('#settings-tabs .settings-tab[data-tab="affichage"]');
    if (tabAff) tabAff.click();
    out.panneauActif = (document.querySelector('#settings-box .settings-panel.active') || {}).dataset;
    out.panneauActif = out.panneauActif ? out.panneauActif.panel : null;
    document.getElementById('settings-cancel').click();
    out.build = window.PERTFLOW_BUILD || null;
    // v0.18.1 : la date affichee par « A propos » ne doit plus porter d'heure.
    openAbout();
    const about = document.getElementById('about-content');
    out.dateAffichee = (Array.from(about.querySelectorAll('*')).map(e => e.textContent)
      .filter(t => /\d{2}\/\d{2}\/\d{4}/.test(t)).pop() || '');
    document.getElementById('about-close').click();

    // Synthese : listes entrantes/sortantes sur un mini-planning.
    const g = window.pertGraph; g.clear();
    window.pertMeta.t0 = '2026-01-05'; window.pertMeta.unit = 'mois';
    const A = LiteGraph.createNode('pert/activity'); A.properties.duration = 3; g.add(A);
    const J = LiteGraph.createNode('pert/milestone');
    J.properties.label = 'Fin'; J.properties.due_date = '2026-02-01';
    J.updateSize(); g.add(J); A.connect(0, J, 0);
    pertRecalc();
    const m = pertBuildSynthesisModel();
    out.synthese = {
      sortants: m.milestonesSortants.map(r => r.label + ':' + r.state),
      entrants: m.milestonesEntrants.length,
    };

    // Aimantation, au travers du vrai handler installe par le bundle.
    const L = LiteGraph.createNode('pert/label'); g.add(L);
    L.properties.manual_size = true; L.size = [160, 80];
    A.pos = [400, 300]; A.size = [200, 120];
    L.pos = [405, 307];
    window.pertCanvas.onNodeMoved(L);
    out.aimantation = [L.pos[0], L.pos[1]];

    // Panneau lateral en deux onglets (v0.19) : presence, bascule, et bouton Supprimer
    // dans le pied (donc visible quel que soit l'onglet).
    showProperties(A);
    pertSelectPanelTab('synthese');
    const synth = document.getElementById('properties-synthesis');
    out.panneau = {
      onglets: document.querySelectorAll('#properties-tabs .prop-tab').length,
      actif: (document.querySelector('#properties-body .prop-panel.active') || { dataset: {} }).dataset.panel,
      // Surface reellement occupee : un id duplique rendrait le panneau vide sans erreur.
      visible: synth ? synth.getBoundingClientRect().height > 50 : false,
      voisins: !!document.getElementById('links-section'),
      supprEnPied: !!document.querySelector('#properties-footer #btn-delete-node'),
    };
    pertSelectPanelTab('proprietes');

    // v0.20 : recherche du menu Filtre + synthese en quatre onglets, verifiees DANS LE
    // BUNDLE (un module oublie a l'inline ne se verrait pas sur index.html).
    const rech = document.getElementById('filter-search');
    if (rech) { rech.value = 'jalon'; rech.dispatchEvent(new Event('input')); }
    out.recherche = {
      zone: !!rech,
      filtre: window.pertFilter && window.pertFilter.type,
      compteur: (document.getElementById('filter-search-count') || {}).textContent || '',
    };
    if (rech) { rech.value = ''; rech.dispatchEvent(new Event('input')); }

    pertOpenSynthesisDialog();
    pertSelectSynthTab('analyse');
    out.synthOnglets = {
      nb: document.querySelectorAll('#synthesis-tabs .synth-tab').length,
      actif: (document.querySelector('#synthesis-content .synth-panel.active') || { dataset: {} }).dataset.panel,
      // Surface reellement occupee : un panneau vide passerait tous les tests d'etat.
      visible: (() => {
        const p = document.querySelector('#synthesis-content .synth-panel[data-panel="analyse"]');
        return p ? p.getBoundingClientRect().height > 20 : false;
      })(),
    };
    pertCloseSynthesisDialog();

    // Trame : la case des Parametres la fait-elle reellement dessiner ?
    const cv = document.getElementById('pertCanvas');
    const sum = () => {
      const c = document.createElement('canvas');
      c.width = cv.width; c.height = cv.height;
      c.getContext('2d').drawImage(cv, 0, 0);
      const d = c.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return s;
    };
    const redraw = () => new Promise(r => {
      window.pertCanvas.setDirty(true, true); window.pertCanvas.draw(true, true);
      requestAnimationFrame(() => requestAnimationFrame(r));
    });
    openSettings();
    document.getElementById('settings-timegrid').checked = true;
    saveSettings();
    await redraw(); const avec = sum();
    window.pertMeta.time_grid = false; await redraw(); const sans = sum();
    out.trameDessine = avec !== sans;
    return out;
  });

  console.log(JSON.stringify(res, null, 2));
  const pb = [];
  Object.entries(res.aFonctions).forEach(([k, v]) => { if (!v) pb.push('fonction absente du bundle : ' + k); });
  if (!res.caseParametres) pb.push('case « Trame temporelle » absente du bundle');
  if (res.onglets !== 3) pb.push('3 onglets attendus dans le bundle, vu ' + res.onglets);
  if (!res.curseur) pb.push('curseur d\'intensite absent du bundle');
  const pan = res.panneau || {};
  if (pan.onglets !== 2) pb.push('2 onglets de panneau attendus, vu ' + pan.onglets);
  if (pan.actif !== 'synthese') pb.push('le panneau ne bascule pas sur Synthèse : ' + pan.actif);
  if (!pan.visible) pb.push('onglet Synthèse sans surface a l\'ecran (id duplique ?)');
  if (!pan.voisins) pb.push('listes predecesseurs/successeurs absentes du bundle');
  if (!pan.supprEnPied) pb.push('bouton Supprimer absent du pied de panneau');
  const rec = res.recherche || {};
  if (!rec.zone) pb.push('zone de recherche du filtre absente du bundle');
  if (rec.filtre !== 'text') pb.push('la recherche ne pose pas de filtre : ' + rec.filtre);
  if (!rec.compteur) pb.push('compteur de resultats de recherche muet');
  const so = res.synthOnglets || {};
  if (so.nb !== 4) pb.push('4 onglets de synthese attendus, vu ' + so.nb);
  if (so.actif !== 'analyse') pb.push('la synthese ne bascule pas sur Analyse : ' + so.actif);
  if (!so.visible) pb.push('onglet Analyse de la synthese sans surface a l\'ecran');
  if (res.panneauActif !== 'affichage') pb.push('les onglets ne basculent pas dans le bundle : ' + res.panneauActif);
  // Tag attendu : celui passe en argument, sinon on se contente de verifier qu'un tag
  // de forme valide a bien ete injecte. Coder une version en dur ici faisait echouer le
  // controle a chaque nouvelle version, pour une raison qui n'a rien a voir avec le bundle.
  const attendu = process.argv[2];
  if (!res.build || !res.build.tag) pb.push('tag de build absent : ' + JSON.stringify(res.build));
  else if (attendu && res.build.tag !== attendu) pb.push('tag attendu ' + attendu + ', vu ' + res.build.tag);
  else if (!attendu && !/^v\d+\.\d+(\.\d+)?$/.test(res.build.tag)) pb.push('tag de build mal forme : ' + res.build.tag);
  if (res.synthese.sortants[0] !== 'Fin:alert') pb.push('synthese : etat attendu Fin:alert, obtenu ' + res.synthese.sortants);
  if (res.aimantation[0] !== 400 || res.aimantation[1] !== 300) pb.push('aimantation inoperante : ' + res.aimantation);
  if (!res.trameDessine) pb.push('la trame ne dessine rien dans le bundle');
  if (/\d{2}:\d{2}/.test(res.dateAffichee)) pb.push('« A propos » affiche encore une heure : ' + res.dateAffichee);
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(res.dateAffichee.trim().split(' ').pop() || '')) pb.push('date de bundle non lisible : ' + res.dateAffichee);
  if (errors.length) pb.push('erreurs JS : ' + errors.join(' | '));

  if (pb.length) { console.error('ECHEC :\n - ' + pb.join('\n - ')); process.exit(1); }
  console.log('\nOK — bundle autoporteur ' + (process.argv[2] || '?') + ' valide en file://');
  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
