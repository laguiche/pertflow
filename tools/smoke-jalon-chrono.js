// Tests cibles : prise en compte de la DATE CIBLE des jalons (2 correctifs mineurs).
//   1) reorganisation « axe temps seul » (pertAutoLayoutTimeOnly) : un Jalon porteur
//      d'une date cible est place a l'abscisse de CETTE cible, pas de son ES.
//   2) fenetre de synthese : les listes de jalons (tenus / non tenus / sans cible)
//      sont classees par ordre chronologique croissant (cible d'abord, sinon EF).
// Usage : node tools/smoke-jalon-chrono.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // ── 1) Reorganisation « axe temps seul » : cible prioritaire sur l'ES ─────────
  const layout = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta;
    m.groups = {}; m.title = 'Chrono'; m.t0 = '2026-01-05'; m.unit = 'j';

    // A1 (10 j) → Jalon cible tardive : ES du jalon = 10, cible = T0 + 40 j ouvres.
    const A1 = LiteGraph.createNode('pert/activity');
    A1.properties.duration = 10; g.add(A1);
    const J = LiteGraph.createNode('pert/milestone');
    J.properties.label = 'Livraison'; J.properties.due_date = '2026-03-02'; // ~40 j ouvres
    J.updateSize(); g.add(J); A1.connect(0, J, 0);
    // Jalon sans cible : reste sur son ES/EF.
    const Jsc = LiteGraph.createNode('pert/milestone');
    Jsc.properties.label = 'Point'; Jsc.updateSize(); g.add(Jsc); A1.connect(0, Jsc, 0);

    // Ordonnees manuelles distinctes : la reorg « temps seul » ne doit pas y toucher.
    A1.pos[1] = 100; J.pos[1] = 300; Jsc.pos[1] = 500;
    pertRecalc();
    const dueOff = pertDateToOffset('2026-03-02');
    pertAutoLayoutTimeOnly();
    return {
      dueOff,
      esJ: J.es, efJ: J.ef,
      xA1: A1.pos[0], xJ: J.pos[0], xJsc: Jsc.pos[0],
      yA1: A1.pos[1], yJ: J.pos[1], yJsc: Jsc.pos[1],
      expectedXJ: PERT_LAYOUT_MARGIN_X + dueOff * PERT_PX_PER_UNIT,
      expectedXJsc: PERT_LAYOUT_MARGIN_X + Jsc.es * PERT_PX_PER_UNIT,
    };
  });
  console.log('layout:', layout);
  if (!(layout.dueOff > layout.esJ)) throw new Error('scenario invalide : la cible doit etre posterieure a l\'ES');
  if (Math.abs(layout.xJ - layout.expectedXJ) > 0.5)
    throw new Error('jalon a cible mal place : x=' + layout.xJ + ' attendu ' + layout.expectedXJ);
  if (Math.abs(layout.xJsc - layout.expectedXJsc) > 0.5)
    throw new Error('jalon sans cible : l\'ES doit rester la reference');
  if (layout.yA1 !== 100 || layout.yJ !== 300 || layout.yJsc !== 500)
    throw new Error('la reorg « temps seul » ne doit pas modifier les ordonnees');

  // ── 2) Synthese : listes de jalons classees chronologiquement ────────────────
  const synth = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta;
    m.groups = {}; m.t0 = '2026-01-05'; m.unit = 'j';

    // Activite longue → EF eleve : toutes les cibles precoces seront "non tenues".
    const A = LiteGraph.createNode('pert/activity');
    A.properties.duration = 60; g.add(A);

    // Ajoutes dans le DESORDRE chronologique pour verifier le tri.
    const mk = (label, due) => {
      const n = LiteGraph.createNode('pert/milestone');
      n.properties.label = label;
      if (due) n.properties.due_date = due;
      n.updateSize(); g.add(n); A.connect(0, n, 0); return n;
    };
    // Non tenus (cibles avant la fin de A) :
    mk('rate-C', '2026-03-02'); mk('rate-A', '2026-01-12'); mk('rate-B', '2026-02-02');
    // Tenus (cibles apres la fin de A) :
    mk('ok-B', '2027-06-01'); mk('ok-A', '2026-12-01');
    // Sans cible : classes par EF (durees d'amont differentes).
    const B = LiteGraph.createNode('pert/activity'); B.properties.duration = 5; g.add(B);
    const s1 = LiteGraph.createNode('pert/milestone');
    s1.properties.label = 'sc-tard'; s1.updateSize(); g.add(s1); A.connect(0, s1, 0);
    const s2 = LiteGraph.createNode('pert/milestone');
    s2.properties.label = 'sc-tot'; s2.updateSize(); g.add(s2); B.connect(0, s2, 0);

    pertRecalc();
    const mdl = pertBuildSynthesisModel();
    // Tous ces jalons ont un lien ENTRANT et aucun sortant → ils sont tous SORTANTS.
    // Depuis le passage aux listes entrants/sortants, tenus, non tenus et sans cible
    // cohabitent donc dans une seule liste : ce qui reste a verifier ici, c'est que
    // l'ordre CHRONOLOGIQUE est conserve (exigence maintenue de la synthese).
    return {
      sortants: mdl.milestonesSortants.map(r => ({ label: r.label, off: r.sortOff })),
      entrants: mdl.milestonesEntrants.map(r => r.label),
    };
  });
  console.log('synthese:', synth);
  const labels = synth.sortants.map(r => r.label);
  if (synth.entrants.length !== 0)
    throw new Error('aucun jalon entrant attendu (aucun n\'a de lien sortant) : ' + synth.entrants.join(','));
  if (labels.length !== 7)
    throw new Error('7 jalons sortants attendus, obtenu ' + labels.length + ' : ' + labels.join(','));
  // Tri chronologique global : la cle de tri ne doit jamais decroitre le long de la liste.
  for (let i = 1; i < synth.sortants.length; i++) {
    if (synth.sortants[i].off < synth.sortants[i - 1].off)
      throw new Error('liste des sortants non triee chronologiquement : ' + labels.join(','));
  }
  // Ordre relatif de chaque famille (les cibles/EF sont volontairement etagees).
  const before = (a, b) => labels.indexOf(a) < labels.indexOf(b);
  if (!before('rate-A', 'rate-B') || !before('rate-B', 'rate-C'))
    throw new Error('jalons non tenus non classes chronologiquement : ' + labels.join(','));
  if (!before('ok-A', 'ok-B'))
    throw new Error('jalons tenus non classes chronologiquement : ' + labels.join(','));
  if (!before('sc-tot', 'sc-tard'))
    throw new Error('jalons sans cible non classes par fin au plus tot : ' + labels.join(','));

  if (errors.length) throw new Error('erreurs JS : ' + errors.join(' | '));
  console.log('\nOK — cible des jalons prise en compte (reorg axe temps + tri synthese)');
  await browser.close();
})().catch(async (e) => { console.error('ECHEC :', e.message); process.exit(1); });
