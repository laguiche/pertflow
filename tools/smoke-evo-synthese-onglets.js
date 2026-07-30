// Test cible : fenetre de synthese repartie en QUATRE onglets, qui deviennent des
// CHAPITRES a l'impression, + le nouvel onglet ANALYSE.
//   - repartition du contenu : generique (vue d'ensemble + couts par groupe), jalons
//     sortants, jalons entrants, analyse — chacun dans son panneau, un seul visible ;
//   - l'onglet consulte est memorise d'une ouverture a l'autre ;
//   - ANALYSE : nœuds masques (perte d'information, pas simple recouvrement),
//     jalons orphelins, jalons de nom similaire (le cas utile etant le
//     couple sortant/entrant non relie), taches isolees, fins de chaine sans jalon,
//     taches de duree nulle ; un controle sans anomalie n'est PAS affiche ;
//   - un planning sain affiche « aucun point d'attention » et aucune pastille ;
//   - IMPRESSION : les quatre panneaux redeviennent visibles, la barre d'onglets
//     disparait, les titres de chapitre apparaissent, et le PDF fait au moins quatre
//     pages — c'est le seul controle qui prouve le saut de page (Chrome ignore
//     `break-before` sous un parent flex, en silence).
// Usage : node tools/smoke-evo-synthese-onglets.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // Planning volontairement « imparfait » : chaque controle d'analyse doit trouver
  // matiere, et un seul d'entre eux au minimum doit rester muet dans le cas sain (2e partie).
  await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.t0 = '2026-01-05'; window.pertMeta.unit = 'j';
    window.pertMeta.title = 'Projet de contrôle';
    const link = (s, d) => s.connect(0, d, d.inputs.length - 1);
    const act = (label, dur, grp, x, y) => {
      const n = LiteGraph.createNode('pert/activity');
      n.properties.label = label; n.properties.duration = dur;
      n.properties.group = grp || ''; n.updateSize(); g.add(n); n.pos = [x, y];
      return n;
    };
    const jal = (label, due, x, y) => {
      const n = LiteGraph.createNode('pert/milestone');
      n.properties.label = label;
      if (due) { n.properties.due_mode = 'date'; n.properties.due_date = due; }
      n.updateSize(); g.add(n); n.pos = [x, y];
      return n;
    };

    const A = act('Étude', 5, 'WP1', 100, 100);
    const B = act('Réalisation', 8, 'WP1', 300, 100);
    const C = act('Recette', 3, 'WP2', 500, 100);
    link(A, B); link(B, C);

    // Jalon d'entree + jalon de sortie relies a la chaine.
    const JE = jal('Feu vert budget', '2026-01-05', 60, 250);
    link(JE, A);
    const JS = jal('Livraison prototype', '2026-03-01', 700, 100);
    link(C, JS);

    // (1) orphelin : aucun lien.
    jal('Jalon oublié', '2026-02-02', 700, 300);
    // (2) noms similaires NON relies : le sortant ci-dessus et un entrant d'un autre lot.
    const JE2 = jal('Livraison prototypes', null, 900, 300);
    // Faux positif a NE PAS remonter : une serie numerotee deliberee. En distance
    // d'edition « Revue de lot 1 » et « Revue de lot 2 » se ressemblent a 93 %.
    jal('Revue de lot 1', null, 900, 500);
    jal('Revue de lot 2', null, 900, 620);
    const D = act('Intégration client', 4, 'WP2', 1100, 300);
    link(JE2, D);
    // (3) tache isolee.
    act('Veille technique', 2, '', 100, 450);
    // (4) fin de chaine sans jalon : « Intégration client » n'a pas de successeur.
    // (5) tache de duree nulle.
    act('Point d\'avancement', 0, 'WP1', 300, 450);

    pertRecalc();
  });

  // ── 1) Quatre onglets, un seul panneau visible, contenu au bon endroit ───────
  const structure = await page.evaluate(() => {
    pertOpenSynthesisDialog();
    const tabs = Array.from(document.querySelectorAll('#synthesis-tabs .synth-tab'))
      .map(t => t.dataset.tab);
    const panneaux = Array.from(document.querySelectorAll('#synthesis-content .synth-panel'))
      .map(p => p.dataset.panel);
    const visibles = Array.from(document.querySelectorAll('#synthesis-content .synth-panel'))
      .filter(p => p.getBoundingClientRect().height > 0).map(p => p.dataset.panel);
    const txt = (id) => document.querySelector('#synthesis-content .synth-panel[data-panel="' + id + '"]').textContent;
    return {
      tabs, panneaux, visibles,
      generiqueOK: /Vue d'ensemble/.test(txt('generique')) && /Par groupe/.test(txt('generique')),
      generiqueSansJalons: !/Jalons entrants/.test(txt('generique')),
      sortantsOK: /Jalons sortants/.test(txt('sortants')),
      entrantsOK: /Jalons entrants/.test(txt('entrants')),
      analyseOK: /Jalons orphelins/.test(txt('analyse')),
      badge: (document.querySelector('#synthesis-tabs .synth-tab-badge') || {}).textContent || '',
      chapitresCaches: Array.from(document.querySelectorAll('.synth-chapter'))
        .every(h => h.getBoundingClientRect().height === 0),
    };
  });
  console.log('structure :', structure);
  if (structure.tabs.join('|') !== 'generique|sortants|entrants|analyse')
    throw new Error('4 onglets attendus dans l\'ordre demande — vu ' + structure.tabs.join('|'));
  if (structure.panneaux.length !== 4) throw new Error('4 panneaux attendus');
  if (structure.visibles.join('|') !== 'generique')
    throw new Error('un seul panneau visible a l\'ecran — vu ' + structure.visibles.join('|'));
  if (!structure.generiqueOK || !structure.generiqueSansJalons)
    throw new Error('« Générique » doit porter vue d\'ensemble + couts par groupe, et PAS les jalons');
  if (!structure.sortantsOK || !structure.entrantsOK || !structure.analyseOK)
    throw new Error('chaque onglet doit porter son contenu');
  if (!structure.badge) throw new Error('l\'onglet Analyse doit afficher le nombre de points d\'attention');
  if (!structure.chapitresCaches)
    throw new Error('les titres de chapitre doivent rester masques a l\'ecran (l\'onglet les dit deja)');

  // ── 2) Contenu de l'onglet ANALYSE ───────────────────────────────────────────
  const analyse = await page.evaluate(() => {
    const m = pertBuildSynthesisModel();
    const parId = {};
    m.analyses.forEach(a => { parId[a.id] = a.rows.map(r => r.cells.map(c => c.text)); });
    // Chaque ligne doit designer au moins un nœud (cellule porteuse d'un nodeId) et
    // porter un terme de filtre : ce sont les deux gestes offerts au lecteur.
    const sansNoeud = [];
    const sansFiltre = [];
    m.analyses.forEach(a => a.rows.forEach(r => {
      if (!r.cells.some(c => c.nodeId != null)) sansNoeud.push(a.id);
      if (!r.filterText) sansFiltre.push(a.id);
    }));
    return { ids: m.analyses.map(a => a.id), parId, sansNoeud, sansFiltre };
  });
  console.log('analyses :', JSON.stringify(analyse.parId, null, 1));
  // « noeuds-masques » ne doit PAS figurer ici : le planning de controle empile bien
  // des nœuds (la largeur d'une tache est proportionnelle a sa duree, « Étude » deborde
  // sur « Réalisation »), mais ces recouvrements sont PARTIELS — aucune information
  // n'est perdue, il n'y a donc rien a signaler. C'est le garde-fou anti-bruit du
  // controle : sans lui, tout planning un peu dense produirait une liste interminable.
  if (analyse.ids.indexOf('noeuds-masques') !== -1)
    throw new Error('un recouvrement PARTIEL ne doit pas etre signale — vu '
      + JSON.stringify(analyse.parId['noeuds-masques']));
  const attendus = ['jalons-orphelins', 'jalons-similaires', 'taches-isolees',
                    'fins-sans-jalon', 'duree-nulle'];
  attendus.forEach(id => {
    if (analyse.ids.indexOf(id) === -1) throw new Error('controle absent : ' + id);
  });
  if (!analyse.parId['jalons-orphelins'].some(r => r[0] === 'Jalon oublié'))
    throw new Error('le jalon sans aucun lien doit etre signale orphelin');
  const sim = analyse.parId['jalons-similaires'];
  if (!sim.some(r => r.indexOf('Livraison prototype') !== -1 && r.indexOf('Livraison prototypes') !== -1))
    throw new Error('les deux jalons de nom quasi identique doivent etre rapproches');
  if (!sim.some(r => r.indexOf('sortant') !== -1 && r.indexOf('entrant') !== -1))
    throw new Error('le role de chaque jalon (sortant / entrant) doit etre indique');
  if (sim.some(r => r.indexOf('Revue de lot 1') !== -1 && r.indexOf('Revue de lot 2') !== -1))
    throw new Error('une serie numerotee deliberee ne doit PAS etre signalee comme doublon');
  if (!analyse.parId['taches-isolees'].some(r => r[0] === 'Veille technique'))
    throw new Error('la tache sans aucun lien doit etre signalee');
  if (!analyse.parId['fins-sans-jalon'].some(r => r[0] === 'Intégration client'))
    throw new Error('la fin de chaine sans jalon doit etre signalee');
  if (!analyse.parId['duree-nulle'].some(r => r[0] === 'Point d\'avancement'))
    throw new Error('la tache de duree nulle doit etre signalee');
  if (analyse.sansNoeud.length)
    throw new Error('toute ligne d\'analyse doit designer un nœud cliquable — manque : '
      + analyse.sansNoeud.join(', '));
  if (analyse.sansFiltre.length)
    throw new Error('toute ligne d\'analyse doit porter un terme de mise en evidence — manque : '
      + analyse.sansFiltre.join(', '));

  // ── 2ter) Nœud reellement MASQUE : la perte d'information, elle, est signalee ─
  // On pose une activite exactement sur un jalon, ce qui le fait disparaitre. Le
  // sens compte : c'est l'ordre de DESSIN qui dit qui recouvre qui, et « Veille
  // technique » a ete creee apres « Feu vert budget », elle passe donc au-dessus.
  const masque = await page.evaluate(() => {
    const g = window.pertGraph;
    const jalon = g._nodes.find(n => n.properties.label === 'Feu vert budget');
    const act = g._nodes.find(n => n.properties.label === 'Veille technique');
    // Tailles fixees a la main : le test doit valoir un recouvrement TOTAL, pas
    // dependre des dimensions auto (qui suivent la duree et la longueur du libelle).
    jalon.size = [140, 100];
    act.size = [140, 120];
    act.pos = [jalon.pos[0], jalon.pos[1]];
    const m = pertBuildSynthesisModel();
    const ctrl = m.analyses.find(a => a.id === 'noeuds-masques');
    const res = ctrl ? ctrl.rows.map(r => r.cells.map(c => c.text)) : null;
    // On remet le planning en etat pour la suite du test.
    act.pos = [100, 450];
    return { res, ordre: g._nodes.indexOf(jalon) < g._nodes.indexOf(act) };
  });
  console.log('nœud masqué :', JSON.stringify(masque.res));
  if (!masque.ordre)
    throw new Error('le scenario suppose que le jalon est DESSOUS (cree avant)');
  if (!masque.res || !masque.res.length)
    throw new Error('un jalon integralement recouvert doit etre signale');
  if (masque.res[0][0] !== 'Feu vert budget' || masque.res[0][3] !== 'Veille technique')
    throw new Error('c\'est le nœud du DESSOUS qui est masque — vu ' + masque.res[0].join(' | '));
  if (masque.res[0][2] !== '100 %')
    throw new Error('recouvrement total attendu, vu ' + masque.res[0][2]);

  // ── 2bis) Les deux gestes offerts par une ligne d'analyse ───────────────────
  // (a) cliquer le NOM mene au nœud : la fenetre se ferme (elle recouvre le planning),
  //     le nœud devient la selection et la vue se centre dessus.
  const nav = await page.evaluate(() => {
    pertOpenSynthesisDialog();
    pertSelectSynthTab('analyse');
    const lien = Array.from(document.querySelectorAll('#synthesis-content .synth-link'))
      .find(a => a.textContent === 'Jalon oublié');
    const offAvant = window.pertCanvas.ds.offset.slice();
    lien.click();
    const sel = Object.values(window.pertCanvas.selected_nodes || {});
    return {
      fenetreFermee: document.getElementById('synthesis-dialog').style.display === 'none',
      selectionne: sel.length === 1 ? sel[0].properties.label : null,
      vueDeplacee: offAvant[0] !== window.pertCanvas.ds.offset[0]
        || offAvant[1] !== window.pertCanvas.ds.offset[1],
    };
  });
  console.log('clic sur le nom :', nav);
  if (!nav.fenetreFermee) throw new Error('la fenetre doit se fermer : elle recouvre le planning');
  if (nav.selectionne !== 'Jalon oublié') throw new Error('le clic doit selectionner le nœud vise');
  if (!nav.vueDeplacee) throw new Error('la vue doit se centrer sur le nœud vise');

  // (b) le bouton 🔎 de la ligne pose le filtre de RECHERCHE sur le nom commun aux
  //     nœuds de la ligne — pour une paire de jalons similaires, les deux s'allument.
  const miseEnEvidence = await page.evaluate(() => {
    pertOpenSynthesisDialog();
    pertSelectSynthTab('analyse');
    // La ligne des jalons de nom similaire (« Livraison prototype » / « ...s »).
    // Requete PORTEE au panneau Analyse : le meme libelle figure aussi dans la liste
    // des jalons sortants, dont les lignes n'ont evidemment pas de bouton d'action.
    const lignes = Array.from(document.querySelectorAll(
      '#synthesis-content .synth-panel[data-panel="analyse"] tr'));
    const ligne = lignes.find(tr => /Livraison prototype/.test(tr.textContent));
    ligne.querySelector('.synth-goto').click();
    return {
      fenetreFermee: document.getElementById('synthesis-dialog').style.display === 'none',
      saisie: document.getElementById('filter-search').value,
      filtre: window.pertFilter && window.pertFilter.type,
      vifs: window.pertGraph._nodes.filter(n => !pertNodeDimmed(n))
        .map(n => n.properties.label).sort(),
    };
  });
  console.log('bouton de mise en evidence :', miseEnEvidence);
  if (!miseEnEvidence.fenetreFermee)
    throw new Error('la fenetre doit se fermer pour laisser voir le planning filtre');
  if (miseEnEvidence.filtre !== 'text' || !miseEnEvidence.saisie)
    throw new Error('le bouton doit remplir la zone de recherche du filtre');
  if (miseEnEvidence.vifs.length !== 2
      || !miseEnEvidence.vifs.every(l => /^Livraison prototype/.test(l)))
    throw new Error('les DEUX jalons de la ligne doivent etre mis en evidence — vu '
      + miseEnEvidence.vifs.join(', '));

  // ── 2ter) Les listes de jalons menent elles aussi au planning ───────────────
  const jalonsCliquables = await page.evaluate(() => {
    pertOpenSynthesisDialog();
    pertSelectSynthTab('sortants');
    const panneau = document.querySelector('#synthesis-content .synth-panel[data-panel="sortants"]');
    const liens = Array.from(panneau.querySelectorAll('.synth-link')).map(a => a.textContent);
    // Toute premiere colonne d'une ligne de jalon doit etre un lien, sans exception :
    // une liste ou seuls certains noms sont cliquables serait pire que rien.
    const premieres = Array.from(panneau.querySelectorAll('tbody tr'))
      .map(tr => !!tr.querySelector('td:first-child .synth-link'));
    const cible = liens.find(l => l === 'Livraison prototype');
    const lien = Array.from(panneau.querySelectorAll('.synth-link')).find(a => a.textContent === cible);
    const offAvant = window.pertCanvas.ds.offset.slice();
    lien.click();
    const sel = Object.values(window.pertCanvas.selected_nodes || {});
    return {
      liens, toutesCliquables: premieres.every(Boolean),
      // Pas de bouton d'action ici : une ligne = un jalon, l'y conduire suffit.
      sansBouton: !panneau.querySelector('.synth-goto'),
      fenetreFermee: document.getElementById('synthesis-dialog').style.display === 'none',
      selectionne: sel.length === 1 ? sel[0].properties.label : null,
      vueDeplacee: offAvant[0] !== window.pertCanvas.ds.offset[0]
        || offAvant[1] !== window.pertCanvas.ds.offset[1],
    };
  });
  console.log('liste de jalons cliquable :', jalonsCliquables);
  if (!jalonsCliquables.toutesCliquables)
    throw new Error('tous les noms de jalon des listes doivent etre cliquables');
  if (!jalonsCliquables.sansBouton)
    throw new Error('pas de bouton de mise en evidence dans les listes de jalons (une ligne = un nœud)');
  if (jalonsCliquables.selectionne !== 'Livraison prototype' || !jalonsCliquables.fenetreFermee
      || !jalonsCliquables.vueDeplacee)
    throw new Error('cliquer un jalon de la liste doit fermer la fenetre, le selectionner et recentrer');

  // ── 3) Memorisation de l'onglet d'une ouverture a l'autre ────────────────────
  const memo = await page.evaluate(() => {
    pertSelectSynthTab('analyse');
    pertCloseSynthesisDialog();
    pertOpenSynthesisDialog();
    return {
      actif: document.querySelector('#synthesis-tabs .synth-tab.active').dataset.tab,
      panneau: document.querySelector('#synthesis-content .synth-panel.active').dataset.panel,
    };
  });
  console.log('memorisation :', memo);
  if (memo.actif !== 'analyse' || memo.panneau !== 'analyse')
    throw new Error('l\'onglet consulte doit etre retrouve a la reouverture');

  // ── 4) IMPRESSION : quatre chapitres, quatre pages au moins ─────────────────
  // On pose la meme classe que pertPrintSynthesis(), puis on demande un vrai PDF au
  // moteur : c'est le seul moyen de verifier ce que @media print produit reellement
  // (inspecter les regles depuis la page echoue en file://, Chrome refusant l'acces
  // aux cssRules d'une feuille locale).
  // Marquage par la fonction de PRODUCTION (pertPrintMark) : depuis qu'il y a deux
  // fenetres imprimables (synthese et suivi), l'impression cible celle qui porte le
  // marqueur .synth-printing, et non plus un id. Reposer les classes a la main ici
  // ferait deriver le test le jour ou le marquage rechange.
  await page.evaluate(() => pertPrintMark('synthesis-dialog', true));
  const pdf = await page.pdf({ format: 'A4', printBackground: false });
  await page.evaluate(() => pertPrintMark('synthesis-dialog', false));
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log('PDF : ' + pages + ' page(s), ' + Math.round(pdf.length / 1024) + ' Ko');
  if (pages < 4)
    throw new Error('4 chapitres = 4 pages au minimum ; vu ' + pages
      + ' — le saut de page est ignore (parent flex ?)');

  // ── 5) Planning SAIN : aucun point d'attention, aucune pastille ─────────────
  const sain = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const link = (s, d) => s.connect(0, d, d.inputs.length - 1);
    const A = LiteGraph.createNode('pert/activity');
    A.properties.label = 'Étude'; A.properties.duration = 5; A.updateSize(); g.add(A);
    const J = LiteGraph.createNode('pert/milestone');
    J.properties.label = 'Livraison'; J.properties.due_mode = 'date';
    J.properties.due_date = '2026-06-01'; J.updateSize(); g.add(J); J.pos = [400, 0];
    link(A, J);
    pertRecalc();
    pertOpenSynthesisDialog();
    const m = pertBuildSynthesisModel();
    return {
      nb: m.analyses.length,
      badge: !!document.querySelector('#synthesis-tabs .synth-tab-badge'),
      texte: document.querySelector('#synthesis-content .synth-panel[data-panel="analyse"]').textContent,
    };
  });
  console.log('planning sain :', { nb: sain.nb, badge: sain.badge });
  if (sain.nb !== 0) throw new Error('un planning sain ne doit declencher aucun controle');
  if (sain.badge) throw new Error('sans point d\'attention, pas de pastille sur l\'onglet');
  if (!/[Aa]ucun point d'attention/.test(sain.texte))
    throw new Error('l\'onglet Analyse doit le dire explicitement quand il n\'a rien trouve');

  if (errors.length) throw new Error('erreurs JS :\n' + errors.join('\n'));
  console.log('\nOK — synthese en onglets + analyse valides');
  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
