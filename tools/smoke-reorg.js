// Tests cibles : reorganisation a DEUX niveaux (evolution reorg).
//   1 — Regroupement PRIMAIRE par enchainement : deux chaines partageant le MEME
//       groupe forment deux bandes verticales DISJOINTES (l'ancien packing "groupe
//       d'abord" les aurait entremelees dans une seule bande WP).
//   2 — Regroupement SECONDAIRE par groupe DANS un enchainement : au sein d'une
//       composante melant deux groupes, chaque groupe occupe un sous-ensemble de
//       couloirs disjoint.
//   3 — Nœuds isoles (sans lien) regroupes dans une bande finale (sous les chaines).
//   4 — Abscisse (∝ ES) inchangee : l'ordre horizontal suit les ES.
//   5 — Chaines reliees seulement par un jalon de sortie = enchainements distincts.
// Usage : node tools/smoke-reorg.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // ── 1 : deux chaines de MEME groupe → bandes disjointes ───────────────────────
  const primary = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.groups = {};
    const mk = (group, dur) => {
      const n = LiteGraph.createNode('pert/activity');
      n.properties.group = group; n.properties.duration = dur;
      g.add(n); pertApplyGroup(n); n.updateSize(); return n;
    };
    // Chaine 1 : c1a(long) -> c1b     Chaine 2 : c2a -> c2b -> c2c   (tout "WP1")
    const c1a = mk('WP1', 6), c1b = mk('WP1', 2);
    const c2a = mk('WP1', 2), c2b = mk('WP1', 2), c2c = mk('WP1', 2);
    c1a.connect(0, c1b, 0);
    c2a.connect(0, c2b, 0); c2b.connect(0, c2c, 0);
    pertAutoLayout();
    const band = ns => ({ min: Math.min(...ns.map(n => n.pos[1])),
                          max: Math.max(...ns.map(n => n.pos[1] + n.size[1])) });
    const b1 = band([c1a, c1b]), b2 = band([c2a, c2b, c2c]);
    return { b1, b2, disjoint: b1.max <= b2.min || b2.max <= b1.min };
  });
  console.log('1 enchainements (meme groupe):', primary);
  if (!primary.disjoint)
    throw new Error('1 : deux chaines de meme groupe ne forment PAS des bandes disjointes (entremelees)');

  // ── 2 : compacite DANS un enchainement (anti-zigzag) ──────────────────────────
  // Chaine lineaire A(G1) -> B(G2) -> C(G1) a groupes alternes : elle doit rester sur
  // UN SEUL couloir (meme Y), le groupe ne devant PAS la faire zigzaguer. Une tache D
  // en parallele (A -> D, chevauche B) occupe un 2e couloir. Duree 3 pour que
  // l'espacement ∝ ES depasse la largeur mini du nœud (sinon overlap force un couloir).
  const compact = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.groups = {};
    const mk = (group, dur) => {
      const n = LiteGraph.createNode('pert/activity');
      n.properties.group = group; n.properties.duration = dur;
      g.add(n); pertApplyGroup(n); n.updateSize(); return n;
    };
    const A = mk('G1', 3), B = mk('G2', 3), C = mk('G1', 3), D = mk('G2', 3);
    A.connect(0, B, 0); B.connect(0, C, 0); A.connect(0, D, 0);
    pertAutoLayout();
    return {
      yA: A.pos[1], yB: B.pos[1], yC: C.pos[1], yD: D.pos[1],
      chainStraight: A.pos[1] === B.pos[1] && B.pos[1] === C.pos[1],
      parallelSplit: D.pos[1] !== A.pos[1]
    };
  });
  console.log('2 compacite (anti-zigzag):', compact);
  if (!compact.chainStraight)
    throw new Error('2 : la chaine lineaire a groupes alternes ne reste PAS sur un seul couloir (zigzag)');
  if (!compact.parallelSplit)
    throw new Error('2 : la tache parallele n\'est pas posee sur un couloir distinct');

  // ── 3 : nœuds isoles regroupes dans une bande finale (sous les chaines) ───────
  const isolated = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.groups = {};
    const mk = (dur) => {
      const n = LiteGraph.createNode('pert/activity'); n.properties.duration = dur;
      g.add(n); n.updateSize(); return n;
    };
    const chA = mk(2), chB = mk(2); chA.connect(0, chB, 0); // 1 chaine
    const iso1 = mk(2), iso2 = mk(2), iso3 = mk(2);          // 3 isoles (aucun lien)
    pertAutoLayout();
    const band = ns => ({ min: Math.min(...ns.map(n => n.pos[1])),
                          max: Math.max(...ns.map(n => n.pos[1] + n.size[1])) });
    const chain = band([chA, chB]), iso = band([iso1, iso2, iso3]);
    // Les isoles sont poses SOUS la chaine (bande finale) et ne la chevauchent pas.
    return { chain, iso, isolatedBelow: iso.min >= chain.max };
  });
  console.log('3 isoles en bande finale:', isolated);
  if (!isolated.isolatedBelow)
    throw new Error('3 : les nœuds isoles ne sont pas regroupes sous les enchainements');

  // ── 4 : abscisse ∝ ES conservee (ordre horizontal = ordre des ES) ─────────────
  const abscissa = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.groups = {};
    const mk = (dur) => {
      const n = LiteGraph.createNode('pert/activity'); n.properties.duration = dur;
      g.add(n); n.updateSize(); return n;
    };
    const A = mk(3), B = mk(3), C = mk(3);
    A.connect(0, B, 0); B.connect(0, C, 0);
    pertAutoLayout();
    // ES : A=0 < B=3 < C=6 → X strictement croissant
    return { xA: A.pos[0], xB: B.pos[0], xC: C.pos[0],
             increasing: A.pos[0] < B.pos[0] && B.pos[0] < C.pos[0] };
  });
  console.log('4 abscisse ∝ ES:', abscissa);
  if (!abscissa.increasing)
    throw new Error('4 : l\'abscisse ne suit plus les ES (le regroupement a bouge X)');

  // ── 5 : chaines reliees SEULEMENT par un jalon de sortie = enchainements ──────
  //        distincts (le jalon terminal est place dans sa propre bande haute et ne
  //        fusionne pas les deux chaines qui y convergent).
  const sharedOut = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.groups = {};
    const mk = (dur) => {
      const n = LiteGraph.createNode('pert/activity'); n.properties.duration = dur;
      g.add(n); n.updateSize(); return n;
    };
    const p1 = mk(2), p2 = mk(2); // chaine 1
    const q1 = mk(2), q2 = mk(2); // chaine 2
    p1.connect(0, p2, 0); q1.connect(0, q2, 0);
    const M = LiteGraph.createNode('pert/milestone'); g.add(M); M.updateSize();
    p2.connect(0, M, 0); q2.connect(0, M, 0); // convergent vers le meme jalon de sortie
    pertAutoLayout();
    const band = ns => ({ min: Math.min(...ns.map(n => n.pos[1])),
                          max: Math.max(...ns.map(n => n.pos[1] + n.size[1])) });
    const b1 = band([p1, p2]), b2 = band([q1, q2]);
    return { disjoint: b1.max <= b2.min || b2.max <= b1.min };
  });
  console.log('5 chaines convergeant vers un jalon de sortie:', sharedOut);
  if (!sharedOut.disjoint)
    throw new Error('5 : deux chaines reliees seulement par un jalon de sortie ne sont pas separees');

  console.log('\nErreurs console/page:', errors.length ? errors : 'aucune');
  if (errors.length) throw new Error('erreurs console/page detectees');
  await browser.close();
  console.log('\n=== SMOKE REORG OK ===');
})().catch(e => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
