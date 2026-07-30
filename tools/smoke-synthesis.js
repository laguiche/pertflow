// Tests cibles : fenetre de synthese globale (evolution post-roadmap).
//   - modele : nb taches/jalons, cout total, fin de projet, chemin critique
//   - jalons TENUS / NON TENUS classes correctement + marge (signe) vis-a-vis cible
//   - jalons sans cible listes a part
//   - synthese par groupe : nb taches, cout, LF max ("fin au plus tard")
//   - rendu DOM : sections, compteurs d'en-tete, pastilles de groupe/tag
//   - impression : classe body.synthesis-printing posee puis retiree a afterprint
// Usage : node tools/smoke-synthesis.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // ── Construction d'un planning de reference ───────────────────────────────────
  const model = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta;
    m.groups = {}; m.title = 'Projet Test'; m.t0 = '2026-01-05'; m.unit = 'mois';
    m.hours_per_month = 135; m.hours_per_day = 8; m.hourly_rate = 136;

    const mkA = (group, dur, etp) => {
      const n = LiteGraph.createNode('pert/activity');
      n.properties.group = group; n.properties.duration = dur; n.properties.etp = etp;
      g.add(n); pertApplyGroup(n); return n;
    };
    const A1 = mkA('WP1', 2, 1);
    const A2 = mkA('WP1', 3, 2); A1.connect(0, A2, 0);
    const A3 = mkA('WP2', 4, 1);

    // Jalon TENU : cible tres tardive → EF <= cible → marge positive.
    const Mtenu = LiteGraph.createNode('pert/milestone');
    Mtenu.properties.label = 'Livraison'; Mtenu.properties.due_date = '2027-06-01';
    Mtenu.properties.tag = 'COTD'; Mtenu.updateSize(); g.add(Mtenu); A2.connect(0, Mtenu, 0);

    // Jalon NON TENU : cible tres precoce (avant EF) → target_missed → marge negative.
    const Mrate = LiteGraph.createNode('pert/milestone');
    Mrate.properties.label = 'Revue'; Mrate.properties.due_date = '2026-02-01';
    Mrate.updateSize(); g.add(Mrate); A3.connect(0, Mrate, 0);

    // Jalon SANS CIBLE et sans aucun lien → jalon ISOLE.
    const Msc = LiteGraph.createNode('pert/milestone');
    Msc.properties.label = 'Point'; Msc.updateSize(); g.add(Msc);

    // Jalon PUREMENT ENTRANT : aucun lien entrant, un lien sortant, une cible. Sa cible
    // est une donnee d'entree (contrainte externe) → jamais de verdict de tenue.
    const Ment = LiteGraph.createNode('pert/milestone');
    Ment.properties.label = 'Budget'; Ment.properties.due_date = '2026-01-05';
    Ment.updateSize(); g.add(Ment);
    const A4 = mkA('WP2', 2, 1); Ment.connect(0, A4, 0);

    // Jalon INTERMEDIAIRE : lien entrant ET sortant → doit figurer dans les DEUX listes.
    const Mmid = LiteGraph.createNode('pert/milestone');
    Mmid.properties.label = 'Checkpoint'; Mmid.properties.due_date = '2026-03-01';
    Mmid.updateSize(); g.add(Mmid); A4.connect(0, Mmid, 0);
    const A5 = mkA('WP2', 1, 1); Mmid.connect(0, A5, 0);

    pertRecalc();
    window.pertCriticalPathIds = new Set(); // sans selection : la synthese lira cet ensemble
    window.pertHighlightCriticalPath && pertHighlightCriticalPath();

    const mdl = pertBuildSynthesisModel();
    return {
      nbTasks: mdl.nbTasks, nbMilestones: mdl.nbMilestones,
      totalCost: mdl.totalCost,
      costs: { A1: pertActivityCost(A1), A2: pertActivityCost(A2), A3: pertActivityCost(A3),
               A4: pertActivityCost(A4), A5: pertActivityCost(A5) },
      endDate: mdl.endDate ? mdl.endDate.getTime() : null,
      entrants: mdl.milestonesEntrants.map(r => ({ label: r.label, state: r.state })),
      sortants: mdl.milestonesSortants.map(r => ({ label: r.label, margin: r.margin, state: r.state, tag: r.tag && r.tag.value })),
      isoles: mdl.milestonesIsoles.map(r => ({ label: r.label, state: r.state })),
      groups: mdl.groups.map(gr => ({ name: gr.name, nbTasks: gr.nbTasks, cost: gr.cost, hasColor: !!gr.color, lf: gr.lfDate ? gr.lfDate.getTime() : null })),
      crit: { tasks: mdl.critTasks, cost: mdl.critCost },
    };
  });
  console.log('model:', JSON.stringify(model, null, 0));

  if (model.nbTasks !== 5) throw new Error('nbTasks attendu 5, obtenu ' + model.nbTasks);
  if (model.nbMilestones !== 5) throw new Error('nbMilestones attendu 5, obtenu ' + model.nbMilestones);
  const sumCost = model.costs.A1 + model.costs.A2 + model.costs.A3 + model.costs.A4 + model.costs.A5;
  if (Math.abs(model.totalCost - sumCost) > 1e-6) throw new Error('cout total != somme des activites');
  if (model.endDate == null) throw new Error('fin de projet non calculee');

  // ── Classement par TOPOLOGIE : entrants (lien sortant) / sortants (lien entrant) ──
  const entL = model.entrants.map(r => r.label);
  const sortL = model.sortants.map(r => r.label);
  if (entL.length !== 2) throw new Error('2 jalons entrants attendus (Budget, Checkpoint), obtenu : ' + entL.join(','));
  if (entL.indexOf('Budget') < 0 || entL.indexOf('Checkpoint') < 0)
    throw new Error('jalons entrants mal classes : ' + entL.join(','));
  if (sortL.length !== 3) throw new Error('3 jalons sortants attendus, obtenu : ' + sortL.join(','));
  ['Livraison', 'Revue', 'Checkpoint'].forEach(l => {
    if (sortL.indexOf(l) < 0) throw new Error('jalon sortant manquant : ' + l);
  });
  // Le checkpoint intermediaire doit figurer dans LES DEUX listes.
  if (entL.indexOf('Checkpoint') < 0 || sortL.indexOf('Checkpoint') < 0)
    throw new Error('le jalon intermediaire doit figurer dans les deux listes');
  // Jalon isole : ni entrant ni sortant, et donc absent des deux listes.
  if (model.isoles.length !== 1 || model.isoles[0].label !== 'Point')
    throw new Error('jalon isole mal classe : ' + JSON.stringify(model.isoles));
  if (entL.indexOf('Point') >= 0 || sortL.indexOf('Point') >= 0)
    throw new Error('un jalon isole ne doit apparaitre dans aucune des deux listes');

  // ── Code couleur, repris de la zone de travail (targetState) ─────────────────────
  const stateOf = (list, label) => (list.find(r => r.label === label) || {}).state;
  if (stateOf(model.sortants, 'Revue') !== 'alert')
    throw new Error('cible non tenue → etat "alert" attendu, obtenu ' + stateOf(model.sortants, 'Revue'));
  if (stateOf(model.sortants, 'Livraison') !== 'safe')
    throw new Error('cible tenue avec marge → etat "safe" attendu, obtenu ' + stateOf(model.sortants, 'Livraison'));
  // Jalon purement entrant : sa cible est une donnee d'entree → aucun verdict (blanc).
  if (stateOf(model.entrants, 'Budget') !== 'none')
    throw new Error('jalon purement entrant → etat "none" attendu, obtenu ' + stateOf(model.entrants, 'Budget'));
  // Jalon sans cible : aucun verdict non plus.
  if (model.isoles[0].state !== 'none')
    throw new Error('jalon sans cible → etat "none" attendu, obtenu ' + model.isoles[0].state);
  // Marges : signe coherent avec la tenue de cible.
  const marginOf = (label) => (model.sortants.find(r => r.label === label) || {}).margin;
  if (!(marginOf('Livraison') > 0)) throw new Error('marge du jalon tenu doit etre positive');
  if (!(marginOf('Revue') < 0)) throw new Error('marge du jalon non tenu doit etre negative');
  if ((model.sortants.find(r => r.label === 'Livraison') || {}).tag !== 'COTD')
    throw new Error('tag du jalon tenu non repris');

  // Groupes.
  if (model.groups.length !== 2) throw new Error('attendu 2 groupes, obtenu ' + model.groups.length);
  const wp1 = model.groups.find(g => g.name === 'WP1');
  const wp2 = model.groups.find(g => g.name === 'WP2');
  if (!wp1 || wp1.nbTasks !== 2) throw new Error('WP1 doit compter 2 taches');
  if (!wp2 || wp2.nbTasks !== 3) throw new Error('WP2 doit compter 3 taches, obtenu ' + (wp2 && wp2.nbTasks));
  if (Math.abs(wp1.cost - (model.costs.A1 + model.costs.A2)) > 1e-6) throw new Error('cout WP1 incorrect');
  if (!wp1.hasColor || !wp2.hasColor) throw new Error('couleur de groupe manquante');
  if (wp1.lf == null || wp2.lf == null) throw new Error('LF (fin au plus tard) de groupe manquante');

  // ── Rendu DOM : ouverture, sections, compteurs ────────────────────────────────
  await lib.openSynthesisMenu(page, 'planification');
  const dom = await page.evaluate(() => {
    const c = document.getElementById('synthesis-content');
    const heads = Array.from(c.querySelectorAll('.synth-section h4')).map(h => h.textContent);
    return {
      heads,
      chips: c.querySelectorAll('.synth-chip').length,
      tags: c.querySelectorAll('.synth-tag').length,
      neg: c.querySelectorAll('.synth-neg').length,
      pos: c.querySelectorAll('.synth-pos').length,
      tables: c.querySelectorAll('table.synth-table').length,
      // Code couleur de tenue de cible, porte par la LIGNE (cf. css .synth-mile-*).
      alert: c.querySelectorAll('tr.synth-mile-alert').length,
      safe: c.querySelectorAll('tr.synth-mile-safe').length,
      none: c.querySelectorAll('tr.synth-mile-none').length,
    };
  });
  console.log('dom:', dom);
  if (!dom.heads.some(h => /Vue d'ensemble/.test(h))) throw new Error('section Vue d\'ensemble manquante');
  if (!dom.heads.some(h => /Jalons entrants \(2\)/.test(h))) throw new Error('en-tete "Jalons entrants (2)" attendu : ' + dom.heads.join(' | '));
  if (!dom.heads.some(h => /Jalons sortants \(3\)/.test(h))) throw new Error('en-tete "Jalons sortants (3)" attendu : ' + dom.heads.join(' | '));
  if (!dom.heads.some(h => /Jalons isolés \(1\)/.test(h))) throw new Error('en-tete "Jalons isolés (1)" attendu : ' + dom.heads.join(' | '));
  // Une ligne rouge (Revue), une verte (Livraison), et des lignes neutres (Budget, Point).
  if (dom.alert < 1) throw new Error('aucune ligne de jalon en rouge (cible non tenue)');
  if (dom.safe < 1) throw new Error('aucune ligne de jalon en vert (cible tenue avec marge)');
  if (dom.none < 2) throw new Error('lignes neutres attendues (jalon entrant + jalon sans cible)');
  if (!dom.heads.some(h => /Par groupe/.test(h))) throw new Error('section Par groupe manquante');
  if (dom.chips < 2) throw new Error('pastilles de groupe manquantes (>=2 attendues)');
  if (dom.tags < 1) throw new Error('pastille de tag de jalon manquante');
  if (dom.neg < 1) throw new Error('marge negative (jalon non tenu) non coloree');
  if (dom.pos < 1) throw new Error('marge positive (jalon tenu) non coloree');

  // ── Impression : classe body posee puis retiree a afterprint ──────────────────
  const printFlow = await page.evaluate(() => {
    const orig = window.print;
    window.print = () => {};                 // neutralise le vrai print (headless)
    pertPrintSynthesis();
    const during = document.body.classList.contains('synthesis-printing');
    window.dispatchEvent(new Event('afterprint'));
    const after = document.body.classList.contains('synthesis-printing');
    window.print = orig;
    return { during, after };
  });
  console.log('print:', printFlow);
  if (!printFlow.during) throw new Error('classe synthesis-printing non posee pendant l\'impression');
  if (printFlow.after) throw new Error('classe synthesis-printing non retiree apres afterprint');

  // ── Cas planning vide : ouverture sans erreur, message "vide" ─────────────────
  const empty = await page.evaluate(() => {
    window.pertGraph.clear(); pertRecalc();
    pertRenderSynthesis();
    const c = document.getElementById('synthesis-content');
    return { emptyMsgs: c.querySelectorAll('.synth-empty').length,
             hasVue: !!Array.from(c.querySelectorAll('h4')).find(h => /Vue d'ensemble/.test(h.textContent)) };
  });
  console.log('empty:', empty);
  if (!empty.hasVue) throw new Error('section Vue d\'ensemble absente sur planning vide');
  if (empty.emptyMsgs < 1) throw new Error('message "vide" attendu sur planning vide');

  if (errors.length) { console.error('ERREURS CONSOLE:', errors); throw new Error('erreurs console detectees'); }
  console.log('\n✅ smoke-synthesis OK');
  await browser.close();
})().catch(async e => { console.error('\n❌', e.message); process.exit(1); });
