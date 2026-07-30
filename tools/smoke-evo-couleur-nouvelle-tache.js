// Test cible : couleur (et groupe) des taches NOUVELLEMENT creees, reglable dans les
// Parametres — onglet Projet, « Nouvelle tâche ».
//   - defaut « libre » : la tache neuve prend la 1re couleur de la palette qu'AUCUN
//     groupe ne s'est appropriee (le bleu tant qu'il est libre, la suivante sinon) ;
//   - deux taches libres creees a la suite gardent la MEME teinte (couleur « sans
//     groupe » du projet, pas un code couleur par tache) ;
//   - mode « groupe » : la tache est rattachee au groupe choisi ET herite de sa
//     couleur, sans passer par le panneau ;
//   - le reglage est serialise dans le .pert et capte par l'undo ;
//   - le chemin utilisateur est teste (openSettings/saveSettings + vrai bouton de la
//     toolbar), pas seulement les fonctions internes : c'est le cablage du dialogue
//     qui casse en pratique.
// Usage : node tools/smoke-evo-couleur-nouvelle-tache.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // ── 1) Mode « libre » : couleur non prise par un groupe ───────────────────────
  const libre = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.groups = {};
    window.pertMeta.new_task_mode = 'libre';
    window.pertMeta.new_task_group = '';

    // Aucun groupe : le bleu historique est libre, on doit le retrouver.
    document.getElementById('btn-add-activity').click();
    const bleu = g._nodes[g._nodes.length - 1].properties.color;

    // Un groupe s'approprie le bleu → la tache suivante doit changer de teinte.
    window.pertMeta.groups = { 'WP1': '#4A90D9' };
    document.getElementById('btn-add-activity').click();
    const apres = g._nodes[g._nodes.length - 1];
    document.getElementById('btn-add-activity').click();
    const encore = g._nodes[g._nodes.length - 1];

    return {
      bleu,
      apres: apres.properties.color,
      apresGroupe: apres.properties.group,
      encore: encore.properties.color,
      libreDuRegistre: pertPickFreeColor()
    };
  });
  console.log('mode libre :', libre);
  if (libre.bleu.toLowerCase() !== '#4a90d9')
    throw new Error('sans groupe, la couleur historique (bleu) doit etre conservee');
  if (libre.apres.toLowerCase() === '#4a90d9')
    throw new Error('la couleur d\'un groupe existant ne doit pas etre donnee a une tache neuve');
  if (libre.apres !== libre.libreDuRegistre)
    throw new Error('la couleur posee n\'est pas la 1re couleur libre de la palette');
  if (libre.apres !== libre.encore)
    throw new Error('deux taches libres consecutives doivent partager la meme couleur');
  if (libre.apresGroupe)
    throw new Error('le mode « libre » ne doit rattacher la tache a aucun groupe');

  // ── 2) Mode « groupe » via le VRAI dialogue des Parametres ────────────────────
  const parGroupe = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.groups = { 'WP1': '#4A90D9', 'Essais': '#F5A623' };

    openSettings();
    const modeSel = document.getElementById('settings-newtask-mode');
    const grpSel = document.getElementById('settings-newtask-group');
    const optionsProposees = Array.from(grpSel.options).map(o => o.value);
    modeSel.value = 'groupe';
    grpSel.value = 'Essais';
    modeSel.dispatchEvent(new Event('change'));
    const ligneVisible = document.getElementById('settings-newtask-group-row').style.display !== 'none';
    const pastille = document.getElementById('settings-newtask-swatch').style.background;
    saveSettings();

    document.getElementById('btn-add-activity').click();
    const n = g._nodes[g._nodes.length - 1];
    return {
      optionsProposees, ligneVisible, pastille,
      mode: window.pertMeta.new_task_mode,
      groupe: n.properties.group,
      couleur: n.properties.color,
      couleurNoeud: n.color,       // teinte reellement dessinee (n.color, cf. LiteGraph)
      couleurRegistre: pertGroups()['Essais']
    };
  });
  console.log('mode groupe :', parGroupe);
  if (parGroupe.optionsProposees.join('|') !== 'Essais|WP1')
    throw new Error('le selecteur doit lister les groupes connus, tries');
  if (!parGroupe.ligneVisible)
    throw new Error('la ligne « Groupe par defaut » doit apparaitre en mode groupe');
  if (!parGroupe.pastille)
    throw new Error('la pastille doit montrer la couleur du groupe selectionne');
  if (parGroupe.groupe !== 'Essais')
    throw new Error('la tache neuve doit etre rattachee au groupe par defaut');
  if (parGroupe.couleur.toLowerCase() !== '#f5a623')
    throw new Error('la tache neuve doit heriter de la couleur du groupe');
  if (parGroupe.couleurNoeud !== parGroupe.couleur)
    throw new Error('node.color doit suivre properties.color (sinon le nœud reste bleu a l\'ecran)');

  // ── 3) Aucun groupe defini → le mode « groupe » n'est pas offert ──────────────
  const sansGroupe = await page.evaluate(() => {
    window.pertGraph.clear();
    window.pertMeta.groups = {};
    window.pertMeta.new_task_mode = 'groupe';
    window.pertMeta.new_task_group = 'Essais';
    openSettings();
    const modeSel = document.getElementById('settings-newtask-mode');
    const optGroupe = Array.from(modeSel.options).find(o => o.value === 'groupe');
    const etat = { mode: modeSel.value, optionDesactivee: optGroupe.disabled,
                   selectDesactive: document.getElementById('settings-newtask-group').disabled };
    saveSettings();
    etat.modeApresValidation = window.pertMeta.new_task_mode;
    return etat;
  });
  console.log('sans groupe :', sansGroupe);
  if (sansGroupe.mode !== 'libre' || !sansGroupe.optionDesactivee || !sansGroupe.selectDesactive)
    throw new Error('sans aucun groupe, le mode « groupe » doit etre indisponible');
  if (sansGroupe.modeApresValidation !== 'libre')
    throw new Error('sans groupe cible, la validation doit retomber sur « libre »');

  // ── 4) Serialisation .pert + undo ─────────────────────────────────────────────
  const persist = await page.evaluate(() => {
    window.pertMeta.groups = { 'Essais': '#F5A623' };
    window.pertMeta.new_task_mode = 'groupe';
    window.pertMeta.new_task_group = 'Essais';
    const fichier = pertSerializeProject().meta;

    // Rechargement : les cles doivent revenir telles quelles.
    window.pertMeta.new_task_mode = 'libre';
    window.pertMeta.new_task_group = '';
    pertApplyProject(JSON.parse(JSON.stringify({
      version: '1.0', meta: fichier, graph: window.pertGraph.serialize()
    })));
    return {
      fichierMode: fichier.new_task_mode,
      fichierGroupe: fichier.new_task_group,
      relu: window.pertMeta.new_task_mode + '/' + window.pertMeta.new_task_group
    };
  });
  console.log('persistance :', persist);
  if (persist.fichierMode !== 'groupe' || persist.fichierGroupe !== 'Essais')
    throw new Error('le reglage n\'est pas serialise dans le .pert');
  if (persist.relu !== 'groupe/Essais')
    throw new Error('le reglage n\'est pas restaure au chargement d\'un .pert');

  // Fichier ANTERIEUR (sans les cles) → repli sur « libre », pas d'undefined.
  const ancien = await page.evaluate(() => {
    pertApplyProject({ version: '1.0', meta: { title: 'Ancien', t0: '', unit: 'j' },
                       graph: window.pertGraph.serialize() });
    return window.pertMeta.new_task_mode + '/' + JSON.stringify(window.pertMeta.new_task_group);
  });
  console.log('fichier anterieur :', ancien);
  if (ancien !== 'libre/""')
    throw new Error('un .pert anterieur doit retomber proprement sur « libre »');

  if (errors.length) throw new Error('erreurs JS :\n' + errors.join('\n'));
  console.log('\nOK — couleur/groupe des nouvelles taches valides');
  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
