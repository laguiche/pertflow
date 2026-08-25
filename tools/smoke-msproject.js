// Export Gantt MS Project (MSPDI XML) — ce que le fichier doit dire pour que MS
// Project REPLANIFIE comme PertFlow a calcule (correctifs du 25/08/2026) :
//   1) Jalon d'ENTREE : sa date-cible est sa date de debut, et elle est EPINGLEE par
//      une contrainte « Debut au plus tot » (SNET). Sans contrainte, MS Project
//      auto-planifie « des que possible » et ramene sur le debut de projet toute
//      tache sans predecesseur : les jalons d'entree s'empilaient sur T0.
//   2) Jalon de SORTIE : debut = sa date CALCULEE (celle que MS Project deduira de
//      l'amont de toute facon), cible reportee dans <Deadline> — repere d'echeance +
//      alerte de depassement, l'equivalent de la « tenue de cible » de PertFlow.
//      Les deux modes de saisie de la cible (date, T0+X) donnent la meme deadline.
//      Un jalon d'ENTREE, lui, n'a PAS de deadline : sa cible est une donnee d'entree.
//   3) Tache ANTICIPEE : epinglee elle aussi, sinon MS Project la colle au plus tot
//      derriere son predecesseur et l'anticipation disparait.
//   4) Couleur : MSPDI ne transporte aucune mise en forme de barre → groupe et
//      couleur partent dans des champs personnalises (ExtendedAttribute), declares
//      AVANT <Tasks> (l'ordre des elements est impose par le schema).
//
// Attendus DEDUITS du graphe monte par le test (es/ef/cible relus dans l'app), jamais
// des dates ecrites en dur : le jeu d'essai reste modifiable sans casser le test.
// Usage : node tools/smoke-msproject.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  const res = await page.evaluate(() => {
    window.pertMeta.t0 = '2026-01-05';
    window.pertMeta.unit = 'j';
    window.pertMeta.groups = { 'Études': '#8844AA' };

    const g = window.pertGraph;
    const mk = (t, props) => {
      const n = LiteGraph.createNode(t);
      Object.assign(n.properties, props);
      g.add(n);
      return n;
    };
    const link = (src, dst) => src.connect(0, dst, dst.inputs.length - 1);

    // Jalon d'entree : contrainte externe datee, en avance sur T0 (anticipation).
    const entree = mk('pert/milestone', {
      label: 'Livraison prototype', due_mode: 'date', due_date: '2025-12-15',
    });
    // Tache anticipee : PertFlow la planifie au plus tard (tiree par l'aval).
    const antic = mk('pert/activity', {
      label: 'Approvisionnement', duration: 10, anticipated: true, group: 'Études',
    });
    const etude = mk('pert/activity', {
      label: 'Étude détaillée', duration: 15, group: 'Études', color: '#123456',
    });
    const essai = mk('pert/activity', {
      label: 'Essais', duration: 5, color: '#22AA55',   // sans groupe : couleur du nœud
    });
    // Jalon de sortie a cible calendaire, et un second a cible « T0+X ».
    const revue = mk('pert/milestone', {
      label: 'Revue de conception', due_mode: 'date', due_date: '2026-03-31',
    });
    const fin = mk('pert/milestone', {
      label: 'Fin de projet', due_mode: 'offset', due_offset: 60,
    });

    link(entree, etude);
    link(antic, essai);
    link(etude, revue);
    link(revue, essai);
    link(essai, fin);
    pertRecalc();

    const xml = pertBuildMSPDI(pertScheduleModel());
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const parseErr = doc.getElementsByTagName('parsererror').length > 0;

    // Attendus recomposes depuis l'etat de l'app (jamais de date en dur).
    const iso = (off, hour) => pertMspDate(off, hour);
    const attendu = {
      entreeStart: iso(pertMilestoneDueOffset(entree)),
      anticStart: iso(antic.es),
      etudeStart: iso(etude.es),
      revueStart: iso(revue.ef),               // date CALCULEE, pas la cible
      revueDeadline: iso(pertMilestoneDueOffset(revue), 17),
      revueCible: iso(pertMilestoneDueOffset(revue)),
      finStart: iso(fin.ef),
      finDeadline: iso(pertMilestoneDueOffset(fin), 17),
    };

    const txt = (el, tag) => {
      const c = el.getElementsByTagName(tag);
      return c.length ? c[0].textContent : null;
    };
    const taches = {};
    Array.from(doc.getElementsByTagName('Task')).forEach(t => {
      const ext = {};
      Array.from(t.getElementsByTagName('ExtendedAttribute')).forEach(e => {
        ext[txt(e, 'FieldID')] = txt(e, 'Value');
      });
      taches[txt(t, 'Name')] = {
        start: txt(t, 'Start'),
        milestone: txt(t, 'Milestone'),
        constraintType: txt(t, 'ConstraintType'),
        constraintDate: txt(t, 'ConstraintDate'),
        deadline: txt(t, 'Deadline'),
        ext,
      };
    });

    // Declaration des champs personnalises : presente, et AVANT <Tasks>.
    const decl = {};
    const declNode = doc.getElementsByTagName('ExtendedAttributes')[0];
    if (declNode) {
      Array.from(declNode.getElementsByTagName('ExtendedAttribute')).forEach(e => {
        decl[txt(e, 'FieldID')] = txt(e, 'Alias');
      });
    }
    const ordreOk = xml.indexOf('<ExtendedAttributes>') !== -1
                 && xml.indexOf('<ExtendedAttributes>') < xml.indexOf('<Tasks>');

    return {
      parseErr, taches, attendu, decl, ordreOk,
      idGroupe: PERT_MSP_FIELD_GROUP + '', idCouleur: PERT_MSP_FIELD_COLOR + '',
      // L'anticipation doit avoir eu lieu, sinon le volet 3 ne prouve rien.
      anticAvantT0: antic.es < 0,
    };
  });

  const t = res.taches, a = res.attendu;
  const ko = (msg) => { throw new Error(msg); };

  if (res.parseErr) ko('MSPDI : XML mal forme');

  // ── 1) Jalon d'entree : cible = debut, epinglee, sans deadline ────────────────
  const entree = t['Livraison prototype'];
  console.log('1) jalon entrant :', entree);
  if (entree.start !== a.entreeStart)
    ko('jalon entrant : Start attendu ' + a.entreeStart + ', obtenu ' + entree.start);
  if (entree.constraintType !== '4')
    ko('jalon entrant : contrainte « Debut au plus tot » (4) attendue, obtenue ' + entree.constraintType);
  if (entree.constraintDate !== a.entreeStart)
    ko('jalon entrant : ConstraintDate attendue ' + a.entreeStart + ', obtenue ' + entree.constraintDate);
  if (entree.deadline !== null)
    ko('jalon entrant : sa cible est une donnee d\'entree, elle ne doit PAS devenir une deadline');
  if (entree.milestone !== '1') ko('jalon entrant : Milestone=1 attendu');

  // ── 2) Jalons de sortie : debut calcule + deadline (les 2 modes de saisie) ────
  const revue = t['Revue de conception'], fin = t['Fin de projet'];
  console.log('2) jalons sortants :', { revue, fin });
  if (a.revueStart === a.revueCible)
    ko('jeu d\'essai inutilisable : la cible de la revue doit differer de sa date calculee');
  if (revue.start !== a.revueStart)
    ko('jalon sortant : Start attendu = date calculee ' + a.revueStart + ', obtenu ' + revue.start);
  if (revue.deadline !== a.revueDeadline)
    ko('jalon sortant (cible en date) : Deadline attendue ' + a.revueDeadline + ', obtenue ' + revue.deadline);
  if (fin.deadline !== a.finDeadline)
    ko('jalon sortant (cible T0+X) : Deadline attendue ' + a.finDeadline + ', obtenue ' + fin.deadline);
  if (fin.start !== a.finStart)
    ko('jalon sortant : Start attendu ' + a.finStart + ', obtenu ' + fin.start);
  if (revue.constraintType !== '0' || revue.constraintDate !== null)
    ko('jalon sortant : aucune contrainte, MS Project doit le replanifier depuis l\'amont');
  if (!/T17:00:00$/.test(revue.deadline))
    ko('deadline : posee en fin de journee, sinon un jalon arrivant le jour meme serait en retard');

  // ── 3) Tache anticipee : epinglee a sa date au plus tard ──────────────────────
  const antic = t['Approvisionnement'], etude = t['Étude détaillée'];
  console.log('3) anticipation :', { antic, avantT0: res.anticAvantT0 });
  if (!res.anticAvantT0) ko('jeu d\'essai inutilisable : la tache anticipee doit demarrer avant T0');
  if (antic.constraintType !== '4' || antic.constraintDate !== a.anticStart)
    ko('tache anticipee : epinglage SNET a ' + a.anticStart + ' attendu, obtenu '
       + antic.constraintType + '/' + antic.constraintDate);
  if (etude.constraintType !== '0' || etude.constraintDate !== null)
    ko('tache ordinaire : elle est deduite de son amont, aucune contrainte ne doit l\'epingler');
  if (etude.start !== a.etudeStart)
    ko('tache ordinaire : Start attendu ' + a.etudeStart + ', obtenu ' + etude.start);

  // ── 4) Couleur et groupe en champs personnalises ──────────────────────────────
  console.log('4) champs personnalises :', { decl: res.decl, etude: etude.ext, essai: t['Essais'].ext });
  if (!res.ordreOk) ko('<ExtendedAttributes> doit preceder <Tasks> (ordre impose par le schema MSPDI)');
  if (!res.decl[res.idGroupe] || !res.decl[res.idCouleur])
    ko('les deux champs personnalises doivent etre declares avec leur alias');
  if (etude.ext[res.idGroupe] !== 'Études')
    ko('champ Groupe attendu « Études », obtenu ' + etude.ext[res.idGroupe]);
  // La couleur MEMORISEE du groupe prime sur la couleur individuelle du nœud
  // (meme regle que le Gantt chargé : c'est la couleur que l'utilisateur voit).
  if (etude.ext[res.idCouleur] !== '#8844AA')
    ko('couleur : celle du groupe doit primer (#8844AA), obtenu ' + etude.ext[res.idCouleur]);
  if (t['Essais'].ext[res.idCouleur] !== '#22AA55')
    ko('couleur : sans groupe, celle du nœud, obtenu ' + t['Essais'].ext[res.idCouleur]);
  if (t['Essais'].ext[res.idGroupe] !== undefined)
    ko('champ Groupe : ne rien ecrire quand la tache n\'a pas de groupe');
  if (Object.keys(entree.ext).length)
    ko('un jalon ne porte ni groupe ni couleur : aucun champ personnalise attendu');

  console.log('\nErreurs console/page:', errors.length ? errors : 'aucune');
  await browser.close();
  if (errors.length) process.exit(1);
  console.log('\n=== SMOKE EXPORT MS PROJECT OK ===');
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
