// Tests cibles : ANTICIPATION des travaux avant T0 (defaut conceptuel n°1).
//   1) Jalon ENTRANT date avant T0 : sa date cale l'ES de la chaine aval dans le
//      NEGATIF (l'ancien plancher Math.max(0, dueOff) la ramenait sur T0 et decalait
//      tout l'aval → jalon final rate + marge negative).
//   2) Jalon ENTRANT : sa date ne borne plus son LF → il ne se retrouve plus avec une
//      marge 0 systematique qui capturait le chemin critique du projet.
//   3) Tache ANTICIPEE (properties.anticipated) : planifiee au plus tard, elle recule
//      avant T0 sans decaler son successeur, et herite de la marge de celui-ci.
//   4) Anticipation INFAISABLE (amont contraint) : rétrogradation en planning au plus
//      tot, la precedence reste respectee.
//   5) Cout anticipe au PRORATA de la part de duree situee avant T0.
//   6) Layout : les abscisses negatives sont decalees pour rester visibles, et T0 est
//      localisable (pertT0OriginX).
// Usage : node tools/smoke-anticipation.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

  // Les nœuds gerent leurs entrees DYNAMIQUEMENT (le dernier slot est toujours libre) :
  // reconnecter sur le slot 0 remplacerait le lien precedent. On injecte donc un
  // helper `link(src, dst)` qui vise systematiquement le dernier slot libre.
  await page.evaluate(() => {
    window.link = (src, dst) => src.connect(0, dst, dst.inputs.length - 1);
  });

  // ── 1) Jalon entrant avant T0 : la chaine part dans le negatif ────────────────
  // Budget d'anticipation debloque a T0−3 mois → Etude (3 mois) → Livraison cible T0.
  // Attendu : Etude va de −3 a 0, la Livraison tombe PILE sur sa cible (marge 0).
  const entry = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta;
    m.groups = {}; m.t0 = '2026-04-01'; m.unit = 'mois';

    const J0 = LiteGraph.createNode('pert/milestone');
    J0.properties.label = 'Budget anticipation'; J0.properties.due_date = '2026-01-01';
    J0.updateSize(); g.add(J0);
    const A = LiteGraph.createNode('pert/activity');
    A.properties.label = 'Etude'; A.properties.duration = 3; g.add(A);
    const JF = LiteGraph.createNode('pert/milestone');
    JF.properties.label = 'Livraison'; JF.properties.due_date = '2026-04-01';
    JF.updateSize(); g.add(JF);
    link(J0, A); link(A, JF);

    pertRecalc();
    return { esJ0: J0.es, efJ0: J0.ef, esA: A.es, efA: A.ef,
             efJF: JF.ef, slackJF: JF.slack, missedJF: JF.target_missed };
  });
  console.log('1) jalon entrant avant T0 :', entry);
  if (!near(entry.esJ0, -3)) throw new Error('jalon entrant : ES attendu -3, obtenu ' + entry.esJ0);
  if (!near(entry.esA, -3) || !near(entry.efA, 0))
    throw new Error('chaine aval mal calee : ' + entry.esA + ' → ' + entry.efA);
  if (!near(entry.efJF, 0)) throw new Error('jalon final : EF attendu 0, obtenu ' + entry.efJF);
  if (entry.missedJF) throw new Error('jalon final donne comme NON TENU alors qu\'il tombe sur sa cible');
  if (!near(entry.slackJF, 0)) throw new Error('marge du jalon final attendue 0, obtenue ' + entry.slackJF);

  // ── 2) Le jalon entrant ne capture plus le chemin critique ────────────────────
  // Branche courte contrainte par un jalon entrant a T0+1, branche longue de 4 mois.
  // Le jalon entrant dispose de marge (2 mois) : il ne doit plus etre critique.
  const noCapture = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta; m.t0 = '2026-04-01'; m.unit = 'mois';

    const J0 = LiteGraph.createNode('pert/milestone');
    J0.properties.label = 'Entree'; J0.properties.due_date = '2026-05-01'; // T0+1
    J0.updateSize(); g.add(J0);
    const A = LiteGraph.createNode('pert/activity');
    A.properties.duration = 1; g.add(A);
    const A2 = LiteGraph.createNode('pert/activity');
    A2.properties.duration = 4; g.add(A2);
    const JF = LiteGraph.createNode('pert/milestone');
    JF.properties.label = 'Fin'; JF.updateSize(); g.add(JF);
    link(J0, A); link(A, JF); link(A2, JF);

    pertRecalc();
    return { slackJ0: J0.slack, critJ0: J0.is_critical, critA2: A2.is_critical, efJ0: J0.ef };
  });
  console.log('2) jalon entrant non capturant :', noCapture);
  if (!near(noCapture.efJ0, 1)) throw new Error('jalon entrant : EF attendu 1, obtenu ' + noCapture.efJ0);
  if (!(noCapture.slackJ0 > 0.5))
    throw new Error('le jalon entrant devrait disposer de marge, obtenu ' + noCapture.slackJ0);
  if (noCapture.critJ0) throw new Error('le jalon entrant ne doit plus etre sur le chemin critique');
  if (!noCapture.critA2) throw new Error('la branche longue doit rester critique');

  // ── 3) Tache anticipee : juste-a-temps, sans decaler l'aval ───────────────────
  const antic = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta; m.t0 = '2026-04-01'; m.unit = 'mois';

    const P = LiteGraph.createNode('pert/activity');
    P.properties.label = 'Appro longue'; P.properties.duration = 2; g.add(P);
    const M = LiteGraph.createNode('pert/activity');
    M.properties.label = 'Realisation'; M.properties.duration = 3; g.add(M);
    const JF = LiteGraph.createNode('pert/milestone');
    JF.properties.label = 'Livraison'; JF.properties.due_date = '2026-07-01'; // T0+3
    JF.updateSize(); g.add(JF);
    link(P, M); link(M, JF);

    // Sans le drapeau : la preparation POUSSE la realisation (comportement historique).
    pertRecalc();
    const avant = { esP: P.es, esM: M.es, efJF: JF.ef, missed: JF.target_missed, slackJF: JF.slack };

    // Avec le drapeau : elle recule avant T0, la realisation ne bouge pas.
    P.properties.anticipated = true;
    pertRecalc();
    const apres = { esP: P.es, efP: P.ef, esM: M.es, efM: M.ef, efJF: JF.ef,
                    missed: JF.target_missed, slackP: P.slack, slackM: M.slack };
    return { avant, apres };
  });
  console.log('3) tache anticipee :', antic);
  if (!near(antic.avant.esM, 2) || !antic.avant.missed)
    throw new Error('scenario invalide : sans anticipation le jalon doit etre rate');
  if (!near(antic.apres.esP, -2) || !near(antic.apres.efP, 0))
    throw new Error('tache anticipee mal tiree : ' + antic.apres.esP + ' → ' + antic.apres.efP);
  if (!near(antic.apres.esM, 0) || !near(antic.apres.efM, 3))
    throw new Error('l\'aval a ete decale alors qu\'il ne devait pas bouger');
  if (antic.apres.missed) throw new Error('le jalon devrait etre tenu apres anticipation');
  if (!near(antic.apres.slackP, antic.apres.slackM))
    throw new Error('la tache anticipee doit heriter de la marge de son successeur : '
                    + antic.apres.slackP + ' vs ' + antic.apres.slackM);

  // ── 4) Anticipation infaisable → retrogradation au plus tot ───────────────────
  // Un jalon entrant a T0 interdit de demarrer avant : la precedence prime.
  const infeasible = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta; m.t0 = '2026-04-01'; m.unit = 'mois';

    const J0 = LiteGraph.createNode('pert/milestone');
    J0.properties.label = 'Go'; J0.properties.due_date = '2026-04-01'; // T0 pile
    J0.updateSize(); g.add(J0);
    const P = LiteGraph.createNode('pert/activity');
    P.properties.duration = 2; P.properties.anticipated = true; g.add(P);
    const M = LiteGraph.createNode('pert/activity');
    M.properties.duration = 3; g.add(M);
    link(J0, P); link(P, M);

    pertRecalc();
    return { esP: P.es, efP: P.ef, esM: M.es, efM: M.ef };
  });
  console.log('4) anticipation infaisable :', infeasible);
  if (!near(infeasible.esP, 0) || !near(infeasible.efP, 2))
    throw new Error('anticipation infaisable : la tache doit repasser au plus tot');
  if (!near(infeasible.esM, 2))
    throw new Error('precedence violee : le successeur doit suivre la fin reelle (2), obtenu ' + infeasible.esM);

  // ── 5) Cout anticipe au prorata + 6) layout/repere T0 ─────────────────────────
  const cost = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta;
    m.t0 = '2026-04-01'; m.unit = 'mois';
    m.hours_per_month = 135; m.hourly_rate = 100;

    // A cheval sur T0 : 4 mois dont 2 avant → part anticipee = 0,5.
    const P = LiteGraph.createNode('pert/activity');
    P.properties.duration = 4; P.properties.etp = 1; P.properties.anticipated = true; g.add(P);
    const M = LiteGraph.createNode('pert/activity');
    M.properties.duration = 2; M.properties.etp = 1; g.add(M);
    const J0 = LiteGraph.createNode('pert/milestone');
    J0.properties.label = 'Entree'; J0.properties.due_date = '2026-06-01'; // T0+2
    J0.updateSize(); g.add(J0);
    link(P, M); link(J0, M);

    pertRecalc();
    pertAutoLayout();
    const originAfterLayout = pertT0OriginX(g);
    let minX = Infinity;
    g._nodes.forEach(n => { if (n.pos[0] < minX) minX = n.pos[0]; });
    return {
      esP: P.es, efP: P.ef, esM: M.es,
      share: pertAnticipatedShare(P), shareM: pertAnticipatedShare(M),
      cost: pertActivityCost(P), anticCost: pertAnticipatedCost(P),
      originAfterLayout, minX, xP: P.pos[0], xM: M.pos[0],
    };
  });
  console.log('5/6) cout anticipe + layout :', cost);
  // M est cale par le jalon entrant a T0+2 ; P (anticipee) finit pile a 2 → part de −2 a 2.
  if (!near(cost.esP, -2) || !near(cost.efP, 2))
    throw new Error('scenario invalide : la tache doit etre a cheval sur T0');
  if (!near(cost.share, 0.5)) throw new Error('part anticipee attendue 0,5, obtenue ' + cost.share);
  if (cost.shareM !== 0) throw new Error('une tache demarrant apres T0 n\'a aucune part anticipee');
  if (!near(cost.anticCost, cost.cost / 2, 1e-6))
    throw new Error('cout anticipe attendu = moitie du cout, obtenu ' + cost.anticCost);
  if (!(cost.minX >= 0))
    throw new Error('abscisses negatives non decalees : minX = ' + cost.minX);
  if (cost.originAfterLayout === null || !(cost.originAfterLayout > 0))
    throw new Error('origine T0 introuvable apres reorganisation');
  // T0 doit tomber a droite de la tache anticipee et a gauche de celle qui suit T0.
  if (!(cost.xP < cost.originAfterLayout))
    throw new Error('la tache anticipee doit se placer a GAUCHE du repere T0');

  // ── 7) IHM : case du panneau, repere T0 dessine, synthese par groupe ──────────
  const ui = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta;
    m.groups = { 'Etudes': '#4A90D9', 'Appro': '#D98A4A' };
    m.t0 = '2026-04-01'; m.unit = 'mois'; m.hours_per_month = 135; m.hourly_rate = 100;

    const P = LiteGraph.createNode('pert/activity');
    P.properties.label = 'Commande matiere'; P.properties.group = 'Appro';
    P.properties.duration = 2; P.properties.etp = 1; g.add(P);
    const M = LiteGraph.createNode('pert/activity');
    M.properties.label = 'Conception'; M.properties.group = 'Etudes';
    M.properties.duration = 3; M.properties.etp = 1; g.add(M);
    link(P, M);
    pertRecalc();

    // Panneau : la case « Tache anticipee » doit exister pour une Activite.
    showProperties(P);
    const labels = Array.from(document.querySelectorAll('#properties-content .panel-check'));
    const row = labels.find(l => /anticip/i.test(l.textContent));
    const before = { esP: P.es, esM: M.es };
    if (row) row.querySelector('input[type=checkbox]').click();  // coche via l'IHM
    const after = { esP: P.es, esM: M.es, flag: P.properties.anticipated };

    // Repere T0 : installe sur les DEUX couches (fond = bande hachuree, premier plan =
    // trait). On verifie le PIXEL reellement rendu, pas seulement la presence du
    // handler : la bande etait bien codee mais son handler se faisait ECRASER par
    // celui de la grille (installe ensuite dans ui.js) — un test de presence n'aurait
    // rien vu.
    const installed = typeof window.pertCanvas.onDrawBackground === 'function'
                   && typeof window.pertCanvas.onDrawForeground === 'function';
    pertAutoLayout();
    const c = window.pertCanvas;
    c.ds.scale = 1; c.ds.offset[0] = 0; c.ds.offset[1] = 0;
    c.setDirty(true, true); c.draw(true, true);
    const originX = pertT0OriginX(g);
    const bgctx = c.bgcanvas.getContext('2d');
    const px = (x, y) => Array.from(bgctx.getImageData(x, y, 1, 1).data);
    // Un point a gauche de T0 (dans la bande) et un point a droite (hors bande), tous
    // deux JUSTE AU-DESSUS des nœuds (donc dans la marge de la bande, sans recouvrement
    // par une boite) : ils ne doivent pas avoir la meme couleur.
    let minY = Infinity;
    g._nodes.forEach(n => { if (n.type !== 'pert/label') minY = Math.min(minY, n.pos[1]); });
    const yProbe = Math.round(minY) - 10;
    const inZone = px(Math.round(originX) - 20, yProbe);
    const outZone = px(Math.round(originX) + 40, yProbe);

    return { hasCheckbox: !!row, before, after, installed,
             hasAntic: pertHasAnticipation(g), originX, yProbe, inZone, outZone };
  });
  console.log('7) IHM :', ui);
  if (!ui.hasCheckbox) throw new Error('case « Tache anticipee » absente du panneau Activite');
  if (ui.after.flag !== true) throw new Error('la case n\'a pas positionne properties.anticipated');
  if (!near(ui.before.esP, 0) || !near(ui.after.esP, -2))
    throw new Error('la case du panneau n\'a pas declenche le recalcul : ' + ui.after.esP);
  if (!near(ui.after.esM, 0)) throw new Error('l\'aval a bouge alors qu\'il ne devait pas');
  if (!ui.installed) throw new Error('repere T0 non installe sur les deux couches du canvas');
  if (!ui.hasAntic) throw new Error('anticipation non detectee par pertHasAnticipation');
  if (String(ui.inZone) === String(ui.outZone))
    throw new Error('bande « travaux anticipes » non dessinee : pixels identiques de part '
                    + 'et d\'autre de T0 (' + ui.inZone + ')');

  // Synthese : colonnes « dont anticipe » / « dont non anticipe » par groupe.
  await lib.openSynthesisMenu(page, 'planification');
  const synth = await page.evaluate(() => {
    const secs = Array.from(document.querySelectorAll('#synthesis-content .synth-section'));
    const grp = secs.find(s => /Par groupe/.test(s.querySelector('h4').textContent));
    const headers = Array.from(grp.querySelectorAll('thead th')).map(th => th.textContent);
    const rows = Array.from(grp.querySelectorAll('tbody tr'))
      .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent));
    const kv = Array.from(document.querySelectorAll('#synthesis-content .synth-kv'))
      .map(r => r.querySelector('.k').textContent + '=' + r.querySelector('.v').textContent);
    return { headers, rows, kv };
  });
  console.log('7b) synthese par groupe :', synth.headers, synth.rows);
  if (!synth.headers.some(h => /Coût global/.test(h)))
    throw new Error('colonne « Cout global » absente de la synthese par groupe');
  if (!synth.headers.some(h => /dont anticipé/.test(h)) ||
      !synth.headers.some(h => /dont non anticipé/.test(h)))
    throw new Error('colonnes anticipe / non anticipe absentes : ' + synth.headers.join(' | '));
  if (!synth.kv.some(k => /dont anticipé/.test(k)))
    throw new Error('vue d\'ensemble : ligne « dont anticipe » absente');
  // Appro (2 mois entierement avant T0) : cout global == cout anticipe, non anticipe = 0.
  // Colonnes reperees par leur EN-TETE et non par un index en dur : le tableau s'enrichit
  // (« Charge (h) » s'y est intercalee le 31/07/2026), et un index fige transformerait
  // n'importe quel ajout en echec sans rapport avec ce qui est teste ici.
  const appro = synth.rows.find(r => /Appro/.test(r[0]));
  if (!appro) throw new Error('groupe Appro absent de la synthese');
  const col = (motif) => appro[synth.headers.findIndex(h => motif.test(h))];
  if (col(/Coût global/) !== col(/dont anticipé/))
    throw new Error('Appro : cout global et anticipe devraient coincider : ' + appro.join(' | '));
  if (!/^0\s/.test(col(/dont non anticipé/)))
    throw new Error('Appro : la part non anticipee devrait etre nulle : ' + col(/dont non anticipé/));

  if (errors.length) throw new Error('erreurs console : ' + errors.join(' | '));
  console.log('\nOK — anticipation avant T0 validee');
  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
