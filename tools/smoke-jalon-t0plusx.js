// Tests cibles : DATE-CIBLE d'un Jalon saisie en « T0 + X » (defaut conceptuel n°2).
//   1) Equivalence stricte : un jalon cale en T0+X se comporte EXACTEMENT comme le
//      meme jalon cale sur la date calendaire correspondante (EF, LF, marge, tenue).
//   2) Offset NEGATIF : T0−X ancre un jalon entrant avant T0 (anticipation) sans
//      passer par une date calendaire.
//   3) Les deux saisies COHABITENT : basculer de mode ne detruit pas l'autre valeur.
//   4) Le nœud affiche « Cible : T0+X <unite> » en mode offset, la date en mode date.
//   5) Consommateurs alignes : synthese (libelle + marge), Gantt/MSPDI (msOffset),
//      CSV (cible resolue en date), reorganisation « axe temps seul ».
//   6) Panneau : selecteur de mode + champ de saisie + rappel « Soit le <date> ».
// Usage : node tools/smoke-jalon-t0plusx.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);
  const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

  await page.evaluate(() => {
    window.link = (src, dst) => src.connect(0, dst, dst.inputs.length - 1);
  });

  // ── 1) Equivalence T0+X ⇄ date calendaire ────────────────────────────────────
  // T0 = 01/04/26, unite mois. Chaine de 4 mois → jalon cible a 6 mois.
  // Saisi en date (01/10/26) puis en T0+6 : memes EF / marge / tenue.
  const equiv = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta; m.groups = {}; m.t0 = '2026-04-01'; m.unit = 'mois';

    const A = LiteGraph.createNode('pert/activity');
    A.properties.duration = 4; g.add(A);
    const J = LiteGraph.createNode('pert/milestone');
    J.properties.label = 'Livraison'; J.updateSize(); g.add(J);
    link(A, J);

    // (a) mode date
    J.properties.due_mode = 'date'; J.properties.due_date = '2026-10-01';
    pertRecalc();
    const parDate = { ef: J.ef, lf: J.lf, slack: J.slack, missed: J.target_missed,
                      off: pertMilestoneDueOffset(J), label: pertMilestoneDueLabel(J) };

    // (b) mode offset T0+6
    J.properties.due_mode = 'offset'; J.properties.due_offset = 6;
    pertRecalc();
    const parOffset = { ef: J.ef, lf: J.lf, slack: J.slack, missed: J.target_missed,
                        off: pertMilestoneDueOffset(J), label: pertMilestoneDueLabel(J) };

    // (c) cible manquee : T0+3 alors que la chaine finit a 4
    J.properties.due_offset = 3;
    pertRecalc();
    const rate = { missed: J.target_missed, slack: J.slack };

    // (d) les deux valeurs cohabitent : la date saisie en (a) est intacte
    const conserve = J.properties.due_date;
    return { parDate, parOffset, rate, conserve };
  });
  console.log('1) equivalence :', equiv);
  if (!near(equiv.parDate.off, 6)) throw new Error('scenario invalide : 01/10/26 doit valoir T0+6');
  ['ef', 'lf', 'slack'].forEach(k => {
    if (!near(equiv.parDate[k], equiv.parOffset[k]))
      throw new Error('divergence date/offset sur ' + k + ' : ' + equiv.parDate[k] + ' vs ' + equiv.parOffset[k]);
  });
  if (equiv.parDate.missed || equiv.parOffset.missed)
    throw new Error('la cible T0+6 doit etre tenue dans les deux modes');
  if (equiv.parDate.label !== '01/10/26')
    throw new Error('mode date : libelle attendu « 01/10/26 », obtenu ' + equiv.parDate.label);
  if (equiv.parOffset.label !== 'T0+6 mois')
    throw new Error('mode offset : libelle attendu « T0+6 mois », obtenu ' + equiv.parOffset.label);
  if (!equiv.rate.missed || !(equiv.rate.slack < 0))
    throw new Error('cible T0+3 : le jalon doit etre non tenu avec une marge negative');
  if (equiv.conserve !== '2026-10-01')
    throw new Error('la date calendaire doit survivre au passage en mode offset');

  // ── 2) Offset NEGATIF : jalon entrant avant T0, sans date calendaire ──────────
  const negatif = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta; m.t0 = '2026-04-01'; m.unit = 'mois';

    const J0 = LiteGraph.createNode('pert/milestone');
    J0.properties.label = 'Budget anticipation';
    J0.properties.due_mode = 'offset'; J0.properties.due_offset = -3;
    J0.updateSize(); g.add(J0);
    const A = LiteGraph.createNode('pert/activity');
    A.properties.duration = 3; g.add(A);
    const JF = LiteGraph.createNode('pert/milestone');
    JF.properties.label = 'Livraison';
    JF.properties.due_mode = 'offset'; JF.properties.due_offset = 0;
    JF.updateSize(); g.add(JF);
    link(J0, A); link(A, JF);

    pertRecalc();
    return { esJ0: J0.es, esA: A.es, efA: A.ef, efJF: JF.ef,
             missed: JF.target_missed, slack: JF.slack,
             label: pertMilestoneDueLabel(J0), antic: pertHasAnticipation(g) };
  });
  console.log('2) offset negatif :', negatif);
  if (!near(negatif.esJ0, -3)) throw new Error('T0−3 : ES attendu -3, obtenu ' + negatif.esJ0);
  if (!near(negatif.esA, -3) || !near(negatif.efA, 0))
    throw new Error('la chaine aval doit partir a -3 : ' + negatif.esA + ' → ' + negatif.efA);
  if (negatif.missed || !near(negatif.slack, 0))
    throw new Error('le jalon final doit tomber pile sur sa cible (marge 0)');
  if (negatif.label !== 'T0−3 mois')
    throw new Error('libelle attendu « T0−3 mois », obtenu ' + negatif.label);
  if (!negatif.antic) throw new Error('anticipation non detectee via une cible en T0−X');

  // ── 3) Consommateurs : nœud, synthese, Gantt, CSV, reorganisation ────────────
  const conso = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta; m.t0 = '2026-04-01'; m.unit = 'mois';

    const A = LiteGraph.createNode('pert/activity');
    A.properties.label = 'Etude'; A.properties.duration = 2; A.properties.etp = 1; g.add(A);
    const J = LiteGraph.createNode('pert/milestone');
    J.properties.label = 'Revue';
    J.properties.due_mode = 'offset'; J.properties.due_offset = 5;
    J.updateSize(); g.add(J);
    link(A, J);
    pertRecalc();

    // Le nœud reserve bien une ligne « Cible » (hauteur) et sait la rendre.
    const hJalon = J.size[1];
    J.properties.due_mode = 'date'; J.properties.due_date = '';  // plus de cible
    J.updateSize();
    const hSansCible = J.size[1];
    J.properties.due_mode = 'offset';
    J.updateSize();
    pertRecalc();

    // Reorganisation « axe temps seul » : le jalon se pose sur sa CIBLE (offset 5).
    A.pos[1] = 100; J.pos[1] = 300;
    pertAutoLayoutTimeOnly();
    const dx = (J.pos[0] - A.pos[0]) / PERT_PX_PER_UNIT;   // 5 - 0 attendu

    // Gantt / MSPDI : offset d'affichage du jalon.
    const model = pertScheduleModel();
    const msOff = model.msOffset(J);

    // CSV : la cible est resolue en DATE, quel que soit le mode de saisie.
    const csv = pertBuildCSV().split('\n').find(l => l.indexOf('Revue') !== -1);

    // Synthese : libelle « T0+5 mois » et marge = cible - EF = 5 - 2 = 3.
    const sm = pertBuildSynthesisModel();
    // Listes entrants / sortants : un jalon intermediaire figure dans les deux, d'ou
    // la recherche sur leur reunion (plus les isoles, si le jalon n'est pas connecte).
    const row = sm.milestonesSortants
      .concat(sm.milestonesEntrants, sm.milestonesIsoles)
      .find(r => r.label === 'Revue');

    return { hJalon, hSansCible, dx, msOff, csv,
             synthLabel: row && row.dueLabel, synthMargin: row && row.margin };
  });
  console.log('3) consommateurs :', conso);
  if (!(conso.hJalon > conso.hSansCible))
    throw new Error('le nœud doit reserver une ligne « Cible » en mode offset');
  if (!near(conso.dx, 5, 0.01))
    throw new Error('reorg « axe temps seul » : le jalon doit se poser sur T0+5, dx=' + conso.dx);
  if (!near(conso.msOff, 5)) throw new Error('Gantt/MSPDI : msOffset attendu 5, obtenu ' + conso.msOff);
  if (conso.csv.indexOf('01/09/26') === -1)
    throw new Error('CSV : la cible T0+5 doit ressortir en date 01/09/26 → ' + conso.csv);
  if (conso.synthLabel !== 'T0+5 mois')
    throw new Error('synthese : libelle attendu « T0+5 mois », obtenu ' + conso.synthLabel);
  if (!near(conso.synthMargin, 3))
    throw new Error('synthese : marge attendue 3, obtenue ' + conso.synthMargin);

  // ── 4) Panneau : selecteur de mode + saisie + rappel de la date resolue ───────
  const panneau = await page.evaluate(() => {
    const g = window.pertGraph;
    const J = g._nodes.find(n => n.type === 'pert/milestone');
    showProperties(J);
    const c = document.getElementById('properties-content');
    const sel = Array.from(c.querySelectorAll('select'))
      .find(s => Array.from(s.options).some(o => o.value === 'offset'));
    const num = c.querySelector('input[type=number]');
    const resolved = Array.from(c.querySelectorAll('.readonly-row'))
      .map(r => r.textContent).find(t => /Soit le/.test(t));

    // Saisie d'un nouvel offset via l'IHM → recalcul immediat. On teste la TENUE de
    // cible et non le LF : sur un jalon TERMINAL le LF est borne par la fin de projet
    // (la cible ne fait que le resserrer), il ne bouge donc pas vers le haut.
    const before = { off: J.properties.due_offset, missed: J.target_missed };
    num.value = '1';                       // cible AVANT la fin de la chaine (EF = 2)
    num.dispatchEvent(new Event('input', { bubbles: true }));
    const serre = { off: J.properties.due_offset, missed: J.target_missed };
    num.value = '8';                       // cible confortable → de nouveau tenue
    num.dispatchEvent(new Event('input', { bubbles: true }));
    const after = { off: J.properties.due_offset, missed: J.target_missed };

    // Bascule en mode date via le selecteur → le champ redevient une date.
    sel.value = 'date';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const dateInput = !!c.querySelector('input[type=date]');
    return { hasSelect: !!sel, hasNumber: !!num, resolved, before, serre, after, dateInput };
  });
  console.log('4) panneau :', panneau);
  if (!panneau.hasSelect) throw new Error('selecteur de mode absent du panneau Jalon');
  if (!panneau.hasNumber) throw new Error('champ de saisie T0+X absent en mode offset');
  if (!panneau.resolved || !/01\/09\/26/.test(panneau.resolved))
    throw new Error('rappel « Soit le <date> » absent ou faux : ' + panneau.resolved);
  if (panneau.after.off !== 8)
    throw new Error('la saisie IHM n\'a pas mis a jour due_offset : ' + panneau.after.off);
  if (panneau.before.missed || !panneau.serre.missed || panneau.after.missed)
    throw new Error('la saisie IHM ne declenche pas le recalcul : tenue attendue '
                    + 'oui/non/oui, obtenue ' + [!panneau.before.missed, !panneau.serre.missed,
                    !panneau.after.missed].join('/'));
  if (!panneau.dateInput)
    throw new Error('le retour en mode date ne restaure pas le champ de saisie date');

  if (errors.length) throw new Error('erreurs console : ' + errors.join(' | '));
  console.log('\nOK — date-cible en T0+X validee');
  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
