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
  await lib.insererNoeud(page, 'risque');
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

  // ── 11) Reorganisation : les bandeaux sont replaces comme le reste ───────────
  //
  // « Réorganiser » doit traiter les risques, pas les laisser sur place au milieu du
  // planning qu'on vient de deplacer sous eux. Deux modes, deux promesses distinctes :
  // la reorg COMPLETE leur attribue une ordonnee (bande en haut, packee en couloirs
  // comme les taches) ; l'axe du temps SEUL ne touche a aucune ordonnee, mais recale
  // les abscisses — et l'abscisse d'un bandeau est sa date de debut.
  await page.evaluate(() => { pertCloseRiskLink(); });
  const reorg = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.t0 = '2026-01-05'; window.pertMeta.unit = 'sem';
    const mk = (label, dur) => {
      const n = LiteGraph.createNode('pert/activity');
      n.properties.label = label; n.properties.duration = dur;
      n.updateSize(); g.add(n); return n;
    };
    const a = mk('A', 4), b = mk('B', 4), c = mk('C', 4);
    a.connect(0, b, 0); b.connect(0, c, 0);
    pertRecalc();
    // R1 couvre A (donc periode courte, a gauche), R2 couvre A et C (large, il
    // recouvre R1), R3 ne couvre que C (a droite, disjoint de R1).
    const mkR = (label, couverts) => {
      const r = LiteGraph.createNode('pert/risk');
      r.properties.label = label;
      r.properties.covers = couverts.map(n => n.properties.uid);
      g.add(r); r.pos[1] = 5000;   // volontairement absurde : la reorg doit la reprendre
      return r;
    };
    const r1 = mkR('R1', [a]), r2 = mkR('R2', [a, c]), r3 = mkR('R3', [c]);
    // R3 doit commencer apres la fin de R1 pour pouvoir partager son couloir.
    r3.properties.start_offset = 8;
    pertRecalc();
    pertAutoLayout();

    const taches = g._nodes.filter(n => n.type !== 'pert/risk');
    const hautDesTaches = Math.min.apply(null, taches.map(n => n.pos[1]));
    const basDesRisques = Math.max.apply(null, [r1, r2, r3].map(n => n.pos[1] + n.size[1]));
    const ox = pertT0OriginX(g);
    const geo = r => [Math.round(r.pos[0]), Math.round(r.size[0])];
    const attendu = r => [Math.round(ox + pertRiskStart(r) * PERT_PX_PER_UNIT),
                          Math.round(Math.max(PERT_RISK_MIN_W,
                                     pertRiskDuration(r) * PERT_PX_PER_UNIT))];
    const avantTimeOnly = [r1.pos[1], r2.pos[1], r3.pos[1]];
    // Axe du temps seul : on decale tout le graphe, les ordonnees doivent survivre et
    // les abscisses des bandeaux se recaler.
    taches.forEach(n => { n.pos[0] += 777; });
    pertAutoLayoutTimeOnly();
    return {
      hautDesTaches, basDesRisques,
      memeCouloir: r1.pos[1] === r3.pos[1],
      couloirDistinct: r1.pos[1] !== r2.pos[1],
      geoR2: geo(r2), attR2: attendu(r2),
      ordonneesConservees: JSON.stringify([r1.pos[1], r2.pos[1], r3.pos[1]])
                           === JSON.stringify(avantTimeOnly),
      xRecale: Math.round(r2.pos[0]) === Math.round(pertT0OriginX(g)
                 + pertRiskStart(r2) * PERT_PX_PER_UNIT)
    };
  });
  check(reorg.basDesRisques <= reorg.hautDesTaches,
     '11) La reorganisation complete doit poser les bandeaux EN BANDE AU-DESSUS du '
     + 'planning (un risque se lit comme un en-tete, et ses traits descendent vers '
     + 'les taches) — bas des risques ' + reorg.basDesRisques
     + ', haut des taches ' + reorg.hautDesTaches);
  check(reorg.couloirDistinct,
     '11) Deux risques dont les periodes se recouvrent doivent occuper deux couloirs');
  check(reorg.memeCouloir,
     '11) Deux risques dont les periodes sont DISJOINTES doivent partager un couloir '
     + '(meme packing que les taches — sinon la bande enfle inutilement)');
  eq(reorg.geoR2, reorg.attR2,
     '11) Apres reorganisation, l\'abscisse et la largeur d\'un bandeau restent sa periode');
  check(reorg.ordonneesConservees,
     '11) La reorganisation « axe du temps seul » ne doit toucher AUCUNE ordonnee, '
     + 'celles des bandeaux comprises');
  check(reorg.xRecale,
     '11) La reorganisation « axe du temps seul » doit recaler l\'abscisse des bandeaux '
     + 'sur la nouvelle origine des temps');

  await browser.close();

  if (errors.length) ko.push('Erreurs JS dans la page :\n    ' + errors.join('\n    '));
  if (ko.length) {
    console.error('ECHEC — ' + ko.length + ' probleme(s) :\n');
    ko.forEach(m => console.error('  ✗ ' + m + '\n'));
    process.exit(1);
  }
  console.log('OK — risques : aucun effet sur le PERT, fin deduite et reevaluee, debut borne');
  console.log('     sans ecrasement, anticipation, geometrie = periode, filtre + synthese,');
  console.log('     round-trip .pert, uid uniques, fenetres Risques et « Couvrir des taches »,');
  console.log('     reorganisation (bande en haut, couloirs) dans les deux modes.');
})();
