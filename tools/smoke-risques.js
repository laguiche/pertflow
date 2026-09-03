// Test cible : gestion des risques (src/risks.js + nœud pert/risk de nodes.js).
//
// Ce qui est protege ici, et pourquoi :
//   - LA REGLE ABSOLUE : un risque n'entre dans AUCUN calcul PERT. On compare
//     l'INTEGRALITE du calcul (es/ef/ls/lf/marge/critique) avant et apres l'ajout
//     d'un risque puis apres chaque rattachement. C'est le controle le plus
//     important du fichier : la fonctionnalite est un OBSERVATEUR du planning, et le
//     jour ou elle se mettrait a le deplacer, plus rien n'avertirait ;
//   - la FIN est DEDUITE (max des LF couverts, a defaut la fin de projet) et se
//     reevalue a chaque rattachement / detachement — c'est la promesse faite a
//     l'utilisateur, et rien d'autre ne la garantit puisqu'elle n'est jamais stockee ;
//   - le DEBUT est borne a [T0 , min des ES], SANS ecraser la saisie : detacher doit
//     rendre au risque le debut qu'on avait tape. Une implementation qui ecrase la
//     propriete passe tous les tests « en avant » et perd l'information ;
//   - l'ANTICIPATION descend la borne basse sous T0 : sinon un risque ne pourrait pas
//     couvrir une tache anticipee, c'est-a-dire justement celle qui inquiete ;
//   - la GEOMETRIE du bandeau EST la periode (abscisse + largeur), y compris apres un
//     glisser horizontal — la lecture visuelle ne doit jamais pouvoir mentir ;
//   - le FILTRE laisse vifs le bandeau ET ses taches, estompe le reste, et ouvre la
//     synthese des taches couvertes (c'est la reponse attendue du geste) ;
//   - le round-trip .pert conserve uid, covers et debut saisi ;
//   - les uid de risque restent uniques apres duplication (l'uid est la valeur du
//     filtre : deux risques qui le partagent seraient indiscernables).
// Usage : node tools/smoke-risques.js

const lib = require('./lib');

(async () => {
  // Fuseau a l'EST de Greenwich, impose : c'est la seule facon d'eprouver le piege
  // de conversion de date du volet 3 sur n'importe quelle machine (cf. lib.launch).
  const { browser, page } = await lib.launch({ timezoneId: 'Europe/Paris' });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  const ko = [];
  const check = (cond, msg) => { if (!cond) ko.push(msg); };
  const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b),
    msg + '\n    attendu : ' + JSON.stringify(b) + '\n    obtenu  : ' + JSON.stringify(a));

  // Empreinte COMPLETE du calcul PERT : c'est elle qui sert de temoin.
  //
  // Elle porte sur TOUS les nœuds du graphe, Risques compris, et pas seulement sur les
  // Activites et les Jalons. La raison est un piege verifie par mutation : un bandeau
  // n'ayant ni entree ni sortie, l'inscrire par erreur dans PERT_TYPES ne DEPLACE
  // aucune tache — il devient simplement un nœud isole que le moteur calcule, qui
  // recoit des dates et peut se declarer critique. Une empreinte limitee aux taches
  // et aux jalons laissait donc passer exactement la faute qu'on veut interdire.
  // On y ajoute, pour la meme raison, la liste des nœuds que le MOTEUR retient.
  const empreintePert = () => page.evaluate(() => ({
    noeuds: window.pertGraph._nodes
      .map(n => [n.properties.label || n.properties.text || '?', n.type,
                 n.es == null ? null : n.es, n.ef == null ? null : n.ef,
                 n.ls == null ? null : n.ls, n.lf == null ? null : n.lf,
                 n.slack == null ? null : n.slack, !!n.is_critical])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    // Ce que le moteur accepte de calculer : aucun type `pert/risk` ne doit y figurer.
    vusParLeMoteur: Array.from(new Set(
      pertBuildAdjacency(window.pertGraph).nodes.map(n => n.type))).sort()
  }));

  // ── 0) Planning temoin ───────────────────────────────────────────────────────
  // Etude (10 j) → Realisation (20 j) → Jalon ; plus une tache isolee « Veille »
  // pour disposer d'un nœud que le filtre devra estomper.
  await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.t0 = '2026-01-05'; window.pertMeta.unit = 'j';
    const mk = (label, dur, x) => {
      const n = LiteGraph.createNode('pert/activity');
      n.properties.label = label; n.properties.duration = dur;
      n.updateSize(); g.add(n); n.pos = [x, 100];
      return n;
    };
    const a = mk('Etude', 10, 60);
    const b = mk('Realisation', 20, 660);
    mk('Veille', 3, 60);
    const j = LiteGraph.createNode('pert/milestone');
    j.properties.label = 'Livraison'; j.updateSize(); g.add(j); j.pos = [1860, 100];
    a.connect(0, b, 0);
    b.connect(0, j, 0);
    pertRecalc();
  });
  const pertAvant = await empreintePert();

  // ── 1) Creation : debut = T0, fin = LF du projet ─────────────────────────────
  // Un risque nait couvrant TOUT le projet : c'est l'hypothese la plus large, donc
  // la moins fausse tant qu'on n'a pas dit sur quoi il pese.
  await page.click('#btn-add-risk');
  await page.waitForTimeout(150);
  const cree = await page.evaluate(() => {
    const r = pertRiskNodes()[0];
    return { nb: pertRiskNodes().length, start: pertRiskStart(r), end: pertRiskEnd(r),
             projet: pertProjectEndOffset(), covers: r.properties.covers.length,
             uid: r.properties.uid, label: r.properties.label };
  });
  eq([cree.nb, cree.start, cree.end, cree.covers], [1, 0, cree.projet, 0],
     '1) Un risque neuf doit couvrir T0 → fin de projet, sans aucune tache rattachee');
  check(/^r-/.test(cree.uid), '1) L\'uid d\'un risque doit porter le prefixe « r- »');

  const apres1 = await empreintePert();
  eq(apres1.vusParLeMoteur, ['pert/activity', 'pert/milestone'],
     '1) REGLE ABSOLUE : le moteur ne doit JAMAIS voir un nœud de type pert/risk '
     + '(il est hors PERT_TYPES — un bandeau isole se ferait calculer sans rien '
     + 'deplacer, donc sans que rien ne l\'annonce)');
  eq(apres1.noeuds.filter(n => n[1] === 'pert/risk'),
     [[cree.label || 'Nouveau risque', 'pert/risk', null, null, null, null, null, false]],
     '1) REGLE ABSOLUE : un risque ne porte AUCUNE valeur calculee (es/ef/ls/lf/marge)');
  eq(apres1.noeuds.filter(n => n[1] !== 'pert/risk'), pertAvant.noeuds,
     '1) REGLE ABSOLUE : ajouter un risque ne doit RIEN changer au calcul PERT');

  // ── 2) Fin deduite du max des LF couverts ────────────────────────────────────
  const couvrir = (label) => page.evaluate((l) => {
    const r = pertRiskNodes()[0];
    const a = pertGraph._nodes.find(n => n.type === 'pert/activity' && n.properties.label === l);
    pertRiskToggleCover(r, a);
    return { start: pertRiskStart(r), end: pertRiskEnd(r), bounds: pertRiskBounds(r),
             lf: a.lf, es: a.es, covers: r.properties.covers.length };
  }, label);

  const surEtude = await couvrir('Etude');
  eq([surEtude.end, surEtude.covers], [surEtude.lf, 1],
     '2) Couvrir une tache cale la fin du risque sur le LF de cette tache');
  const surReal = await couvrir('Realisation');
  eq([surReal.end, surReal.covers], [surReal.lf, 2],
     '2) Avec plusieurs taches, la fin est le LF le PLUS TARDIF (le risque court tant '
     + 'qu\'une tache exposee n\'est pas bouclee)');

  const apres2 = await empreintePert();
  eq(apres2.noeuds.filter(n => n[1] !== 'pert/risk'), pertAvant.noeuds,
     '2) REGLE ABSOLUE : rattacher des taches ne doit RIEN changer au calcul PERT');
  eq(apres2.vusParLeMoteur, ['pert/activity', 'pert/milestone'],
     '2) REGLE ABSOLUE : le moteur ignore toujours les risques apres rattachement');

  // Detachement : la fin doit REVENIR en arriere. C'est le sens que la reevaluation
  // automatique protege — une implementation qui ne ferait que « pousser » la fin
  // passerait le controle precedent et echouerait ici.
  const detache = await couvrir('Realisation');
  eq([detache.end, detache.covers], [surEtude.lf, 1],
     '2) Detacher une tache doit RAMENER la fin du risque sur le LF restant');
  await couvrir('Realisation');   // on la remet pour la suite

  // ── 3) Borne du debut, et saisie non ecrasee ─────────────────────────────────
  // La borne haute est le min des ES : un risque qui commencerait apres la premiere
  // tache couverte ne la couvrirait pas.
  const bornes = await page.evaluate(() => {
    const r = pertRiskNodes()[0];
    const b = pertRiskBounds(r);
    const esMin = Math.min.apply(null, pertRiskCoveredNodes(r).map(n => n.es));
    // Saisie deliberement HORS bornes, tres au-dela de la premiere tache couverte.
    r.properties.start_offset = 12;
    return { hi: b.hi, esMin: esMin, lu: pertRiskStart(r), stocke: r.properties.start_offset };
  });
  eq([bornes.hi, bornes.lu, bornes.stocke], [bornes.esMin, bornes.esMin, 12],
     '3) Le debut est BORNE a la lecture (min des ES) mais la saisie n\'est PAS ecrasee');

  // Tout detacher rouvre la plage → la saisie d'origine doit ressortir telle quelle.
  const rendu = await page.evaluate(() => {
    const r = pertRiskNodes()[0];
    r.properties.covers = [];
    pertRiskSyncGeometry(r);
    return { lu: pertRiskStart(r), fin: pertRiskEnd(r), projet: pertProjectEndOffset() };
  });
  eq([rendu.lu, rendu.fin], [12, rendu.projet],
     '3) Tout detacher rend au risque le debut saisi, et recale la fin sur le projet');

  // Le champ de saisie du panneau affiche la date en heure LOCALE, et ses bornes
  // min/max avec. PIEGE VERIFIE : toISOString() convertit en UTC et affichait la
  // VEILLE — un debut faux d'un jour, dans un champ que rien ne contredit a l'ecran.
  const champ = await page.evaluate(() => {
    const r = pertRiskNodes()[0];
    r.properties.start_offset = 0;
    r.properties.covers = [];
    window.pertCanvas.selectNode(r); showProperties(r);
    const i = Array.from(document.querySelectorAll('#properties-content input'))
      .find(x => x.type === 'date');
    return i ? { valeur: i.value, min: i.min, t0: window.pertMeta.t0 } : null;
  });
  check(champ !== null, '3) Le panneau d\'un risque doit offrir un champ de date');
  eq([champ.valeur, champ.min], [champ.t0, champ.t0],
     '3) Un risque calé sur T0 doit AFFICHER T0 (conversion en heure locale, pas UTC), '
     + 'et la borne basse du champ vaut T0');

  // ── 4) Anticipation : la borne basse descend sous T0 ─────────────────────────
  // Sans cela, un risque ne pourrait pas couvrir une tache anticipee — c'est-a-dire
  // precisement celle qui inquiete.
  const antic = await page.evaluate(() => {
    const g = window.pertGraph;
    const a = g._nodes.find(n => n.properties.label === 'Etude');
    a.properties.anticipated = true;
    pertRecalc();
    const r = pertRiskNodes()[0];
    r.properties.start_offset = 0;
    r.properties.covers = [a.properties.uid];
    const b = pertRiskBounds(r);
    return { es: a.es, lo: b.lo, hi: b.hi, debut: pertRiskStart(r) };
  });
  check(antic.es < 0, '4) Pre-requis : une tache anticipee doit avoir un ES negatif');
  eq([antic.lo, antic.hi, antic.debut], [antic.es, antic.es, antic.es],
     '4) Une tache couverte anticipee descend la borne basse a son ES : le risque '
     + 'doit pouvoir couvrir la tache qu\'on vient de lui rattacher');

  await page.evaluate(() => {
    const a = window.pertGraph._nodes.find(n => n.properties.label === 'Etude');
    a.properties.anticipated = false;
    const r = pertRiskNodes()[0];
    r.properties.start_offset = 0;
    r.properties.covers = window.pertGraph._nodes
      .filter(n => n.type === 'pert/activity' && n.properties.label !== 'Veille')
      .map(n => n.properties.uid);
    pertRecalc();
  });

  // ── 5) La geometrie EST la periode ───────────────────────────────────────────
  const geo = await page.evaluate(() => {
    const r = pertRiskNodes()[0];
    const ox = pertT0OriginX(window.pertGraph);
    return { x: r.pos[0], w: r.size[0], h: r.size[1],
             attX: ox + pertRiskStart(r) * PERT_PX_PER_UNIT,
             attW: Math.max(PERT_RISK_MIN_W, pertRiskDuration(r) * PERT_PX_PER_UNIT) };
  });
  eq([geo.x, geo.w, geo.h], [geo.attX, geo.attW, 34],
     '5) Abscisse et largeur du bandeau doivent valoir exactement sa periode');

  // Un glisser horizontal est REPRIS au lacher : l'axe des abscisses n'appartient pas
  // a l'utilisateur, sinon le bandeau mentirait sur sa periode.
  const apresGlisser = await page.evaluate(() => {
    const r = pertRiskNodes()[0];
    r.pos[0] += 500; r.pos[1] += 40;
    const y = r.pos[1];
    window.pertCanvas.onNodeMoved(r);
    return { x: r.pos[0], y: r.pos[1], attY: y };
  });
  eq(apresGlisser.x, geo.attX,
     '5) Un deplacement HORIZONTAL du bandeau doit etre repris (l\'abscisse est une date)');
  // ... mais l'ordonnee, elle, appartient a l'utilisateur : c'est ce qui lui permet
  // d'empiler ses risques ou de les ranger sous le bloc de taches concerne.
  eq(apresGlisser.y, apresGlisser.attY,
     '5) Le deplacement VERTICAL du bandeau doit etre conserve');

  // ── 6) Filtre : le risque et ses taches restent vifs ─────────────────────────
  const filtre = await page.evaluate(() => {
    const r = pertRiskNodes()[0];
    applyFilter({ type: 'risk', value: r.properties.uid });
    const dim = (l) => pertNodeDimmed(window.pertGraph._nodes
      .find(n => (n.properties.label || '') === l));
    return {
      risque: pertNodeDimmed(r),
      etude: dim('Etude'), veille: dim('Veille'), jalon: dim('Livraison'),
      onglet: document.querySelector('#properties-tabs .prop-tab.active').dataset.tab,
      synthese: document.getElementById('properties-synthesis').textContent,
      libelle: document.getElementById('filter-current').textContent
    };
  });
  eq([filtre.risque, filtre.etude, filtre.veille, filtre.jalon],
     [false, false, true, true],
     '6) Le filtre laisse vifs le bandeau et ses taches couvertes, et estompe le reste');
  check(filtre.onglet === 'synthese',
     '6) Filtrer sur un risque doit ouvrir la synthese de ses taches couvertes');
  check(filtre.synthese.indexOf('Etude') !== -1 && filtre.synthese.indexOf('Veille') === -1,
     '6) La synthese doit lister les taches COUVERTES, et elles seules');

  // Le filtre doit tomber avec le risque : sinon tout reste estompe au profit d'un
  // bandeau qui n'existe plus.
  const apresSuppression = await page.evaluate(() => {
    const r = pertRiskNodes()[0];
    const copie = { label: r.properties.label, uid: r.properties.uid,
                    covers: r.properties.covers.slice(), start: r.properties.start_offset,
                    color: r.properties.color, pos: r.pos.slice() };
    window.pertGraph.remove(r);
    refreshFilterOptions();
    window.__copie = copie;
    return { filtre: window.pertFilter };
  });
  check(apresSuppression.filtre === null,
     '6) Supprimer le risque filtre doit LEVER le filtre (sinon tout reste estompe)');

  // ── 7) Round-trip .pert ──────────────────────────────────────────────────────
  const roundtrip = await page.evaluate(() => {
    const c = window.__copie;
    const r = LiteGraph.createNode('pert/risk');
    r.properties.label = c.label; r.properties.uid = c.uid;
    r.properties.covers = c.covers.slice(); r.properties.start_offset = 7;
    r.properties.color = '#00aa88';
    window.pertGraph.add(r); r.pos = c.pos.slice();
    pertRecalc();
    const avant = JSON.parse(JSON.stringify(window.pertGraph.serialize()));
    window.pertGraph.clear();
    window.pertGraph.configure(avant);
    window.pertGraph._nodes.forEach(n => { if (n.updateSize) n.updateSize(); });
    pertRecalc();
    const r2 = pertRiskNodes()[0];
    return { nb: pertRiskNodes().length, uid: r2.properties.uid,
             covers: r2.properties.covers.length, start: r2.properties.start_offset,
             color: r2.properties.color, fin: pertRiskEnd(r2) };
  });
  eq([roundtrip.nb, roundtrip.uid, roundtrip.covers, roundtrip.start, roundtrip.color],
     [1, (await page.evaluate(() => window.__copie.uid)), 2, 7, '#00aa88'],
     '7) Le round-trip .pert doit conserver uid, taches couvertes, debut saisi et couleur');

  // ── 8) Unicite des uid apres duplication ─────────────────────────────────────
  const dup = await page.evaluate(() => {
    const r = pertRiskNodes()[0];
    const clone = r.clone();
    clone.pos = [r.pos[0], r.pos[1] + 60];
    window.pertGraph.add(clone);
    pertEnsureUids();
    const uids = pertRiskNodes().map(n => n.properties.uid);
    return { nb: uids.length, distincts: new Set(uids).size,
             coversClone: clone.properties.covers.length };
  });
  eq([dup.nb, dup.distincts, dup.coversClone], [2, 2, 2],
     '8) Un risque duplique recoit un uid PROPRE (l\'uid est la valeur du filtre) mais '
     + 'garde les memes taches couvertes');

  // ── 9) Fenetre « Risques » : les deux onglets ────────────────────────────────
  await lib.openSynthesisMenu(page, 'risques');
  const fenetre = await page.evaluate(() => {
    const txt = (t) => { pertSelectRisksTab(t);
      return document.querySelector('#risks-content .synth-panel.active').textContent; };
    return { risques: txt('risques'), taches: txt('taches'),
             onglets: Array.from(document.querySelectorAll('#risks-tabs .synth-tab'))
               .map(b => b.dataset.tab) };
  });
  eq(fenetre.onglets, ['risques', 'taches'],
     '9) La fenetre Risques porte deux onglets = deux chapitres a l\'impression');
  check(fenetre.risques.indexOf('Etude') !== -1,
     '9) L\'onglet « Par risque » doit lister les taches couvertes');
  check(fenetre.taches.indexOf('Etude') !== -1 && /Etude[^]*?2/.test(fenetre.taches),
     '9) L\'onglet « Par tache » doit dire a COMBIEN de risques chaque tache est exposee');

  // Impression : DEUX chapitres = deux pages. Seul un VRAI pdf le prouve — Chrome
  // ignore `break-before` sous un parent flex, et l'enchainement des chapitres sur
  // une seule page se produirait alors en silence (piege deja rencontre sur la
  // synthese). Marquage par la fonction de PRODUCTION, jamais en reposant les
  // classes a la main : sinon le test derive le jour ou le marquage change.
  await page.evaluate(() => pertPrintMark('risks-dialog', true));
  const pdf = await page.pdf({ format: 'A4', printBackground: false });
  await page.evaluate(() => pertPrintMark('risks-dialog', false));
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  check(pages >= 2,
     '9) Les deux onglets doivent s\'imprimer en deux chapitres = 2 pages au minimum ; '
     + 'vu ' + pages + ' (Chrome ignore break-before sous un parent flex)');

  // ── 10) La fenetre « Couvrir des taches… » bascule ───────────────────────────
  await page.evaluate(() => { pertCloseRisksDialog(); pertOpenRiskLink(pertRiskNodes()[0]); });
  await page.waitForSelector('#risklink-dialog[style*="flex"]');
  const av = await page.evaluate(() => ({
    lignes: document.querySelectorAll('#risklink-list .rl-row').length,
    couvertes: document.querySelectorAll('#risklink-list .rl-row.rl-couverte').length,
    periode: document.getElementById('risklink-periode').textContent
  }));
  check(av.lignes >= 3 && av.couvertes === 2,
     '10) La fenetre liste TOUTES les taches et marque celles qui sont couvertes');
  // Un clic sur une ligne deja couverte la RETIRE (le geste est un basculement).
  await page.click('#risklink-list .rl-row.rl-couverte');
  await page.waitForTimeout(120);
  const ap = await page.evaluate(() => ({
    couvertes: document.querySelectorAll('#risklink-list .rl-row.rl-couverte').length,
    ouverte: document.getElementById('risklink-dialog').style.display === 'flex',
    periode: document.getElementById('risklink-periode').textContent
  }));
  eq([ap.couvertes, ap.ouverte], [1, true],
     '10) Un clic sur une tache couverte la retire, et la fenetre RESTE ouverte '
     + '(on relie par rafales)');
  check(ap.periode !== av.periode,
     '10) La periode rappelee en tete doit se mettre a jour : c\'est l\'accuse de '
     + 'reception du geste');

  // Dernier controle de la regle absolue : apres TOUT ce qui precede (rattachements,
  // detachements, duplication, round-trip), le calcul PERT doit etre a l'identique.
  const fin = await empreintePert();
  eq(fin.noeuds.filter(n => n[1] !== 'pert/risk'), pertAvant.noeuds,
     '10) REGLE ABSOLUE : au terme de toutes les manipulations de risques, le calcul '
     + 'PERT doit etre rigoureusement celui du depart');
  eq(fin.noeuds.filter(n => n[1] === 'pert/risk')
       .every(n => n.slice(2, 7).every(v => v === null)), true,
     '10) REGLE ABSOLUE : aucun risque n\'a acquis de valeur calculee en cours de route');

  await browser.close();

  if (errors.length) ko.push('Erreurs JS dans la page :\n    ' + errors.join('\n    '));
  if (ko.length) {
    console.error('ECHEC — ' + ko.length + ' probleme(s) :\n');
    ko.forEach(m => console.error('  ✗ ' + m + '\n'));
    process.exit(1);
  }
  console.log('OK — risques : aucun effet sur le PERT, fin deduite et reevaluee, debut borne');
  console.log('     sans ecrasement, anticipation, geometrie = periode, filtre + synthese,');
  console.log('     round-trip .pert, uid uniques, fenetres Risques et « Couvrir des taches ».');
})();
