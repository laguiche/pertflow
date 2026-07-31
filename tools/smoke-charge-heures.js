// Test cible : CHARGE d'une tache exprimee en ETP ou en HEURES (31/07/2026).
//   - defauts et compatibilite : mode "etp", .pert anterieur (sans charge_mode) inchange ;
//   - formule de cout par mode, et ce qui reste INVARIANT quand l'elongation bouge
//     (mode etp : l'ETP ; mode heures : la charge et donc le cout) ;
//   - bascule de mode a COUT CONSTANT, dans les deux sens ;
//   - panneau : les deux valeurs cote a cote (meme ligne), la deduite en lecture seule
//     et mise a jour a la frappe, sans debordement du panneau ;
//   - duree nulle en mode heures : l'ETP n'existe pas (« — »), la charge coute quand meme ;
//   - round-trip .pert et exports (CSV « Charge(h) », MSPDI <Work>).
// Usage : node tools/smoke-charge-heures.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // Parametres de cout figes pour tout le test : 1 mois = 135 h, 1 j = 8 h, 136 €/h.
  const PARAMS = { hpm: 135, hpd: 8, rate: 136 };

  // ── 1) Defauts : mode ETP, cout identique a la formule S8.5 ───────────────────
  const defauts = await page.evaluate((P) => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta;
    m.hours_per_month = P.hpm; m.hours_per_day = P.hpd; m.hourly_rate = P.rate;
    m.unit = 'mois';
    const a = LiteGraph.createNode('pert/activity');
    a.properties.duration = 5; a.properties.etp = 1.5; g.add(a);
    return { mode: pertChargeMode(a), chargeHoursProp: a.properties.charge_hours,
             heures: pertActivityHours(a), etp: pertActivityEtp(a),
             cout: pertActivityCost(a) };
  }, PARAMS);
  console.log('defauts :', defauts);
  if (defauts.mode !== 'etp') throw new Error('le mode par defaut doit rester "etp"');
  if (defauts.chargeHoursProp !== null) throw new Error('charge_hours par defaut doit etre null');
  if (Math.abs(defauts.heures - 135 * 5 * 1.5) > 1e-9) throw new Error('charge en heures deduite fausse');
  if (defauts.etp !== 1.5) throw new Error('ETP lu != ETP saisi en mode etp');
  if (Math.abs(defauts.cout - 135 * 5 * 1.5 * 136) > 1e-6)
    throw new Error('cout en mode ETP != formule S8.5');

  // ── 2) Mode heures : cout = charge × taux, ETP deduit de l'elongation ─────────
  const heures = await page.evaluate((P) => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta; m.unit = 'mois';
    m.hours_per_month = P.hpm; m.hours_per_day = P.hpd; m.hourly_rate = P.rate;
    const a = LiteGraph.createNode('pert/activity');
    a.properties.duration = 2; a.properties.etp = 42;   // valeur parasite : ne doit PLUS servir
    a.properties.charge_mode = 'heures'; a.properties.charge_hours = 405;
    g.add(a);
    const avant = { h: pertActivityHours(a), etp: pertActivityEtp(a), cout: pertActivityCost(a) };
    // L'elongation double : en mode heures c'est l'ETP qui baisse, le cout ne bouge pas.
    a.properties.duration = 4;
    const apres = { h: pertActivityHours(a), etp: pertActivityEtp(a), cout: pertActivityCost(a) };
    return { avant, apres };
  }, PARAMS);
  console.log('mode heures :', heures);
  if (heures.avant.h !== 405) throw new Error('charge saisie non lue');
  if (Math.abs(heures.avant.etp - 405 / (135 * 2)) > 1e-9)
    throw new Error('ETP deduit faux (attendu charge / heures d\'elongation)');
  if (Math.abs(heures.avant.cout - 405 * 136) > 1e-6)
    throw new Error('cout en mode heures != charge × taux');
  if (heures.apres.h !== 405 || Math.abs(heures.apres.cout - heures.avant.cout) > 1e-6)
    throw new Error('allonger la tache ne doit PAS changer une charge saisie en heures');
  if (Math.abs(heures.apres.etp - heures.avant.etp / 2) > 1e-9)
    throw new Error('allonger la tache doit diluer l\'ETP deduit');
  // L'ETP parasite reste dans properties mais n'entre plus dans le cout : c'est bien le
  // MODE qui arbitre, pas la presence d'une valeur.
  if (Math.abs(heures.avant.cout - 42 * 135 * 2 * 136) < 1e-6)
    throw new Error('le cout suit encore l\'ETP stocke alors que le mode est "heures"');

  // ── 3) Mode ETP : c'est la charge en heures qui suit l'elongation ─────────────
  const invariantEtp = await page.evaluate((P) => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta; m.unit = 'mois';
    m.hours_per_month = P.hpm; m.hours_per_day = P.hpd; m.hourly_rate = P.rate;
    const a = LiteGraph.createNode('pert/activity');
    a.properties.duration = 2; a.properties.etp = 1; g.add(a);
    const avant = { h: pertActivityHours(a), cout: pertActivityCost(a) };
    a.properties.duration = 4;
    return { avant, apres: { h: pertActivityHours(a), cout: pertActivityCost(a) },
             etp: pertActivityEtp(a) };
  }, PARAMS);
  console.log('invariant ETP :', invariantEtp);
  if (invariantEtp.etp !== 1) throw new Error('l\'ETP saisi doit rester invariant');
  if (Math.abs(invariantEtp.apres.h - 2 * invariantEtp.avant.h) > 1e-9)
    throw new Error('en mode ETP, doubler la duree doit doubler la charge en heures');

  // ── 4) Bascule de mode a COUT CONSTANT (via le panneau, vrai geste) ───────────
  const bascule = await page.evaluate((P) => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta; m.unit = 'j';
    m.hours_per_month = P.hpm; m.hours_per_day = P.hpd; m.hourly_rate = P.rate;
    const a = LiteGraph.createNode('pert/activity');
    a.properties.duration = 10; a.properties.etp = 0.5; g.add(a);
    pertRecalc(); showProperties(a);
    const coutEtp = pertActivityCost(a);
    const sel = document.querySelector('#charge-section select');
    const choisir = (v) => { sel.value = v; sel.dispatchEvent(new Event('change')); };
    // ETP → heures
    choisir('heures');
    const versHeures = { mode: a.properties.charge_mode, h: a.properties.charge_hours,
                         cout: pertActivityCost(a) };
    // ... puis retour heures → ETP, apres avoir change la charge entre-temps
    a.properties.charge_hours = 80;
    const coutHeures = pertActivityCost(a);
    document.querySelector('#charge-section select').value = 'etp';
    document.querySelector('#charge-section select').dispatchEvent(new Event('change'));
    const versEtp = { mode: a.properties.charge_mode, etp: a.properties.etp,
                      cout: pertActivityCost(a) };
    return { coutEtp, versHeures, coutHeures, versEtp };
  }, PARAMS);
  console.log('bascule :', bascule);
  if (bascule.versHeures.mode !== 'heures') throw new Error('bascule vers heures non enregistree');
  if (Math.abs(bascule.versHeures.h - 10 * 8 * 0.5) > 1e-9)
    throw new Error('la bascule doit figer la charge deduite (10 j × 8 h × 0,5 ETP)');
  if (Math.abs(bascule.versHeures.cout - bascule.coutEtp) > 1e-6)
    throw new Error('basculer ETP → heures a change le cout');
  if (bascule.versEtp.mode !== 'etp') throw new Error('retour au mode etp non enregistre');
  if (Math.abs(bascule.versEtp.etp - 80 / (10 * 8)) > 1e-9)
    throw new Error('le retour en ETP doit reprendre l\'ETP deduit de la charge saisie');
  if (Math.abs(bascule.versEtp.cout - bascule.coutHeures) > 1e-6)
    throw new Error('basculer heures → ETP a change le cout');

  // ── 5) Panneau : deux champs COTE A COTE, le deduit en lecture seule ──────────
  const panneau = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta; m.unit = 'j'; m.hours_per_day = 8;
    const a = LiteGraph.createNode('pert/activity');
    a.properties.duration = 10; a.properties.etp = 2; g.add(a);
    pertRecalc(); showProperties(a);
    const box = document.getElementById('charge-section');
    const inputs = Array.from(box.querySelectorAll('input'));
    const r = inputs.map(i => i.getBoundingClientRect());
    const panelR = document.getElementById('properties-panel').getBoundingClientRect();
    const saisie = inputs.find(i => !i.readOnly);
    const deduit = inputs.find(i => i.readOnly);
    const avant = deduit.value;
    // Frappe dans le champ de saisie : le champ deduit doit suivre SANS re-rendu
    // (sinon on perdrait le focus au caractere suivant).
    saisie.focus();
    saisie.value = '3';
    saisie.dispatchEvent(new Event('input'));
    const focusGarde = document.activeElement === saisie;
    const apres = document.querySelector('#charge-section input.field-derived').value;
    return {
      nbInputs: inputs.length, nbLectureSeule: inputs.filter(i => i.readOnly).length,
      memeLigne: Math.abs(r[0].top - r[1].top) < 2,
      largeurOk: r.every(x => x.left >= panelR.left - 1 && x.right <= panelR.right + 1),
      avant, apres, focusGarde,
      etpApres: a.properties.etp,
      // La valeur DEDUITE s'ecrit a la francaise (virgule decimale) comme le reste de
      // l'app ; la valeur SAISIE reste brute, un <input type=number> rejetant la
      // virgule (le champ s'afficherait vide).
      deduitVirgule: (() => {
        a.properties.duration = 3;      // 3 j × 8 h × 3 ETP = 72 h -> entier, on force
        a.properties.etp = 1.5;         // 3 j × 8 h × 1,5 = 36 h ; on vise l'ETP deduit
        a.properties.charge_mode = 'heures'; a.properties.charge_hours = 100;
        showProperties(a);
        const d = document.querySelector('#charge-section input.field-derived').value;
        const s = document.querySelector('#charge-section input:not(.field-derived)').value;
        return { deduit: d, saisi: s };
      })(),
    };
  });
  console.log('panneau :', panneau);
  if (panneau.nbInputs !== 2) throw new Error('le bloc charge doit exposer exactement 2 champs');
  if (panneau.nbLectureSeule !== 1) throw new Error('un seul des deux champs doit etre en lecture seule');
  if (!panneau.memeLigne) throw new Error('les deux champs ne sont pas cote a cote (memes ordonnees)');
  if (!panneau.largeurOk) throw new Error('un champ deborde du panneau lateral');
  if (panneau.avant !== '160') throw new Error('charge deduite initiale attendue 160 h : ' + panneau.avant);
  if (panneau.apres !== '240') throw new Error('la charge deduite ne suit pas la frappe : ' + panneau.apres);
  if (!panneau.focusGarde) throw new Error('la frappe reconstruit le champ et perd le focus');
  if (panneau.etpApres !== 3) throw new Error('la saisie n\'a pas ete enregistree');
  // 100 h sur 3 j × 8 h = 4,1666… ETP → « 4,17 » (virgule), et la charge saisie « 100 »
  // reste lisible par l'<input type=number>.
  if (panneau.deduitVirgule.deduit !== '4,17')
    throw new Error('la valeur deduite doit s\'ecrire a la francaise : ' + panneau.deduitVirgule.deduit);
  if (panneau.deduitVirgule.saisi !== '100')
    throw new Error('le champ de saisie doit rester renseigne (valeur brute) : ' + panneau.deduitVirgule.saisi);

  // ── 6) Duree nulle en mode heures : pas d'ETP, mais un cout ──────────────────
  const dureeNulle = await page.evaluate((P) => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta; m.unit = 'j'; m.hours_per_day = P.hpd; m.hourly_rate = P.rate;
    const a = LiteGraph.createNode('pert/activity');
    a.properties.duration = 0; a.properties.charge_mode = 'heures'; a.properties.charge_hours = 50;
    g.add(a); pertRecalc(); showProperties(a);
    const deduit = document.querySelector('#charge-section input.field-derived');
    return { etp: pertActivityEtp(a), cout: pertActivityCost(a), affiche: deduit.value };
  }, PARAMS);
  console.log('duree nulle :', dureeNulle);
  if (dureeNulle.etp !== null) throw new Error('ETP d\'une tache de duree nulle : attendu null');
  if (dureeNulle.affiche !== '—') throw new Error('le champ deduit doit afficher « — », pas 0');
  if (Math.abs(dureeNulle.cout - 50 * PARAMS.rate) > 1e-6)
    throw new Error('une charge saisie en heures coute meme sans elongation');

  // ── 7) Round-trip .pert + compatibilite d'un fichier anterieur ───────────────
  const rt = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const a = LiteGraph.createNode('pert/activity');
    a.properties.label = 'Offre'; a.properties.charge_mode = 'heures';
    a.properties.charge_hours = 320; g.add(a);
    const data = JSON.parse(JSON.stringify(pertSerializeProject()));
    // Fichier « d'avant » : on retire les deux proprietes, comme un .pert v0.21.
    const ancien = JSON.parse(JSON.stringify(data));
    ancien.graph.nodes.forEach(n => { delete n.properties.charge_mode; delete n.properties.charge_hours; });
    ancien.graph.nodes.forEach(n => { n.properties.etp = 2; });
    pertApplyProject(data);
    const relu = window.pertGraph._nodes.find(n => n.type === 'pert/activity');
    const apresRT = { mode: relu.properties.charge_mode, h: relu.properties.charge_hours };
    pertApplyProject(ancien);
    const vieux = window.pertGraph._nodes.find(n => n.type === 'pert/activity');
    return { apresRT, vieuxMode: pertChargeMode(vieux), vieuxEtp: pertActivityEtp(vieux) };
  });
  console.log('round-trip :', rt);
  if (rt.apresRT.mode !== 'heures' || rt.apresRT.h !== 320)
    throw new Error('mode/charge non persistes dans le .pert');
  if (rt.vieuxMode !== 'etp' || rt.vieuxEtp !== 2)
    throw new Error('un .pert anterieur doit se relire en mode ETP, sans migration');

  // ── 8) Exports : colonne CSV « Charge(h) » et <Work> MSPDI ───────────────────
  const exports = await page.evaluate((P) => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta; m.t0 = '2026-01-05'; m.unit = 'j';
    m.hours_per_day = P.hpd; m.hours_per_month = P.hpm; m.hourly_rate = P.rate;
    const a = LiteGraph.createNode('pert/activity');
    a.properties.label = 'Chiffree en heures'; a.properties.duration = 10;
    a.properties.charge_mode = 'heures'; a.properties.charge_hours = 120;
    g.add(a);
    pertRecalc();
    const csv = pertBuildCSV().split('\r\n');
    const model = pertScheduleModel();
    return { entete: csv[0].split(';'), ligne: csv[1].split(';'),
             etpGantt: pertGanttEtp(a), mspdi: pertBuildMSPDI(model) };
  }, PARAMS);
  const iCharge = exports.entete.indexOf('Charge(h)');
  const iEtp = exports.entete.indexOf('ETP');
  console.log('exports :', { iCharge, iEtp, charge: exports.ligne[iCharge], etp: exports.ligne[iEtp],
                             etpGantt: exports.etpGantt });
  if (iCharge !== exports.entete.length - 1)
    throw new Error('« Charge(h) » doit etre la DERNIERE colonne (schema jamais intercale)');
  if (exports.ligne[iCharge] !== '120') throw new Error('charge en heures absente du CSV');
  if (exports.ligne[iEtp] !== '1,5')
    throw new Error('la colonne ETP doit porter la valeur DEDUITE (120 h / 80 h) : ' + exports.ligne[iEtp]);
  if (Math.abs(exports.etpGantt - 1.5) > 1e-9)
    throw new Error('le Gantt doit tracer l\'ETP deduit, pas l\'ETP stocke');
  if (!/<Work>PT120H0M0S<\/Work>/.test(exports.mspdi))
    throw new Error('MSPDI : <Work> doit valoir la charge saisie (120 h)');

  // ── 9) Synthèse planification : charge en heures PAR GROUPE, et total ────────
  // Les deux modes de saisie doivent s'agreger dans la MEME colonne : c'est tout
  // l'interet de la grandeur commune. On melange donc volontairement les deux dans un
  // meme groupe, et on verifie que le total du haut vaut la somme des lignes.
  await page.evaluate((P) => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta;
    m.t0 = '2026-01-05'; m.unit = 'j'; m.groups = {};
    m.hours_per_day = P.hpd; m.hours_per_month = P.hpm; m.hourly_rate = P.rate;
    const mk = (label, groupe, dur, conf) => {
      const n = LiteGraph.createNode('pert/activity');
      n.properties.label = label; n.properties.group = groupe; n.properties.duration = dur;
      Object.assign(n.properties, conf);
      g.add(n); pertApplyGroup(n); return n;
    };
    mk('Spec', 'Étude', 10, { etp: 1 });                                  // 10 j × 8 h = 80 h
    mk('Chiffrage', 'Étude', 5, { charge_mode: 'heures', charge_hours: 20 });   // 20 h
    mk('Dev', 'Réalisation', 20, { charge_mode: 'heures', charge_hours: 300 }); // 300 h
    pertRecalc();
  }, PARAMS);
  await lib.openSynthesisMenu(page, 'planification');
  const synth = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('#synthesis-content table'));
    const grp = tables.find(t => /Groupe/.test(t.querySelector('tr').textContent));
    const entetes = Array.from(grp.querySelectorAll('tr:first-child th, tr:first-child td'))
      .map(c => c.textContent.trim());
    const lignes = Array.from(grp.querySelectorAll('tr')).slice(1)
      .map(tr => Array.from(tr.children).map(c => c.textContent.trim()));
    const ov = document.querySelector('#synthesis-content .synth-overview').textContent;
    return { entetes, lignes, total: /Charge totale/.test(ov) ? ov : null };
  });
  console.log('synthese groupes :', JSON.stringify(synth.lignes));
  const iH = synth.entetes.indexOf('Charge (h)');
  if (iH === -1) throw new Error('colonne « Charge (h) » absente du tableau par groupe');
  if (iH >= synth.entetes.indexOf('Coût global'))
    throw new Error('la charge doit preceder le cout (elle en est la cause)');
  const parGroupe = {};
  synth.lignes.forEach(l => { parGroupe[l[0]] = l[iH]; });
  // 80 h (ETP) + 20 h (heures) dans le meme groupe : les deux modes s'additionnent.
  if (parGroupe['Étude'] !== '100 h')
    throw new Error('groupe Étude : 80 h (ETP) + 20 h (saisies) attendus, vu ' + parGroupe['Étude']);
  if (parGroupe['Réalisation'] !== '300 h')
    throw new Error('groupe Réalisation : 300 h attendues, vu ' + parGroupe['Réalisation']);
  if (!synth.total || !/400 h/.test(synth.total))
    throw new Error('« Charge totale » (400 h) absente de la vue d\'ensemble : ' + synth.total);

  await page.waitForTimeout(100);
  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  if (errors.length) throw new Error('Erreurs JS detectees');

  await browser.close();
  console.log('\n=== SMOKE CHARGE ETP/HEURES OK ===');
})().catch(e => { console.error('SMOKE CHARGE FAIL:', e.message); process.exit(1); });
