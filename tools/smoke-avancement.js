// Test cible : champ « Avancement » des Activités (suivi léger, 29/07/2026).
//
// L'exigence n°1 n'est pas que l'avancement marche, c'est qu'il ne PERTURBE RIEN :
// le PERT reste l'objectif prioritaire et absolu de PertFlow. Ce test verifie donc
// d'abord la non-regression, puis la fonctionnalite.
//   1) vocabulaire : trois etats, NON_COMMENCE par defaut sur une tache neuve
//   2) retrocompatibilite : un .pert SANS la propriete s'ouvre en « Non commencé »
//      (aucune migration a ecrire — les valeurs par defaut de properties survivent)
//   3) NON-REGRESSION PERT : es/ef/ls/lf/marge/critique/cout strictement identiques
//      avant et apres avoir renseigne l'avancement de toutes les taches
//   4) NON-REGRESSION AU PIXEL : un planning que personne ne suit doit etre rendu
//      exactement comme avant (aucune decoration) ; le marqueur n'apparait qu'a
//      partir de « En cours ». C'est le seul controle capable d'attraper une
//      pastille dessinee par erreur pour l'etat par defaut.
//   5) filtre : nature « progress » (Activites seulement), declencheur, et filtre
//      CONSERVE meme quand plus aucune tache n'est dans l'etat demande
//   6) persistance : sauvegarde → rechargement conserve l'etat
//   7) exports : colonne « Avancement » en FIN de schema CSV (jamais intercalee),
//      et colonne D du Gantt Excel — les periodes decalees d'autant
// Usage : node tools/smoke-avancement.js

const lib = require('./lib');

function assert(cond, msg) { if (!cond) throw new Error('ECHEC: ' + msg); }

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // Planning de reference : trois taches enchainees + un jalon de sortie date.
  await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.t0 = '2026-01-05'; window.pertMeta.unit = 'j';
    window.pertMeta.groups = { 'WP1': '#4A90D9' };
    const mk = (label, dur, x) => {
      const n = LiteGraph.createNode('pert/activity');
      n.properties.label = label; n.properties.duration = dur;
      n.properties.group = 'WP1'; n.properties.responsible = 'Frédéric';
      n.updateSize(); g.add(n); n.pos = [x, 120];
      return n;
    };
    const a = mk('Étude de faisabilité', 5, 100);
    const b = mk('Conception', 8, 400);
    const c = mk('Réalisation', 6, 700);
    const j = LiteGraph.createNode('pert/milestone');
    j.properties.label = 'Livraison'; j.properties.due_mode = 'date';
    j.properties.due_date = '2026-03-02'; j.updateSize(); g.add(j); j.pos = [1000, 120];
    a.connect(0, b, 0); b.connect(0, c, 0); c.connect(0, j, 0);
    pertRecalc();
  });

  // ── 1) Vocabulaire et valeur par defaut ──────────────────────────────────────
  const vocab = await page.evaluate(() => ({
    etats: PERT_PROGRESS_STATES.map(s => s.value),
    defaut: PERT_PROGRESS_DEFAULT,
    // Tache neuve, creee par le chemin utilisateur (bouton de la toolbar).
    neuve: (() => {
      document.getElementById('btn-add-activity').click();
      const n = window.pertGraph._nodes[window.pertGraph._nodes.length - 1];
      const v = n.properties.progress;
      window.pertGraph.remove(n);
      return v;
    })(),
    // Un Jalon n'a pas d'avancement (c'est une echeance, elle est atteinte ou non).
    jalon: pertActivityProgress(window.pertGraph._nodes.find(n => n.type === 'pert/milestone')),
    // Valeur inconnue / absente → retombe sur le defaut, sans exception.
    inconnu: pertProgressDef('BIDON').value,
    absent: pertProgressDef(undefined).value,
  }));
  console.log('vocabulaire :', vocab);
  assert(vocab.etats.join('|') === 'NON_COMMENCE|EN_COURS|TERMINE', 'trois etats attendus');
  assert(vocab.defaut === 'NON_COMMENCE', 'defaut = NON_COMMENCE');
  assert(vocab.neuve === 'NON_COMMENCE', 'une tache neuve doit etre « non commencée »');
  assert(vocab.jalon === '', 'un Jalon n\'a pas d\'avancement');
  assert(vocab.inconnu === 'NON_COMMENCE' && vocab.absent === 'NON_COMMENCE',
    'valeur inconnue/absente → etat par defaut');

  // ── 2) Retrocompatibilite : .pert anterieur, sans la propriete ───────────────
  const retro = await page.evaluate(() => {
    const data = pertSerializeProject();
    // On simule un fichier produit AVANT cette evolution : la propriete n'existe pas.
    data.graph.nodes.forEach(n => { if (n.properties) delete n.properties.progress; });
    pertApplyProject(data);
    return window.pertGraph._nodes
      .filter(n => n.type === 'pert/activity')
      .map(n => pertActivityProgress(n));
  });
  console.log('ancien .pert (sans propriete) :', retro);
  assert(retro.length === 3 && retro.every(v => v === 'NON_COMMENCE'),
    'un .pert anterieur doit s\'ouvrir en « non commencé » — vu ' + retro.join('|'));

  // ── 3) NON-REGRESSION PERT : le calcul ne bouge pas d'un iota ────────────────
  const calc = await page.evaluate(() => {
    const snap = () => window.pertGraph._nodes
      .filter(n => n.type === 'pert/activity' || n.type === 'pert/milestone')
      .map(n => [n.properties.label, n.es, n.ef, n.ls, n.lf, n.slack, n.is_critical,
                 n.type === 'pert/activity' ? pertActivityCost(n) : 0].join(','))
      .join(' | ');
    pertRecalc();
    const avant = snap();
    const etats = ['EN_COURS', 'TERMINE', 'NON_COMMENCE'];
    window.pertGraph._nodes.filter(n => n.type === 'pert/activity')
      .forEach((n, i) => { n.properties.progress = etats[i % 3]; n.updateSize(); });
    pertRecalc();
    return { avant, apres: snap() };
  });
  assert(calc.avant === calc.apres,
    'l\'avancement a modifie le calcul PERT !\n  avant : ' + calc.avant + '\n  apres : ' + calc.apres);
  console.log('non-regression PERT : calcul identique (dates, marges, critique, coût)');

  // ── 4) NON-REGRESSION AU PIXEL + marqueur effectivement dessine ──────────────
  // Un test d'etat ne prouverait rien ici : la pastille est du Canvas2D, elle peut
  // etre codee et jamais dessinee (piege deja rencontre avec la trame et le repere T0).
  const pixels = await page.evaluate(async () => {
    const cv = document.getElementById('pertCanvas');
    const sum = () => {
      const c = document.createElement('canvas');
      c.width = cv.width; c.height = cv.height;
      c.getContext('2d').drawImage(cv, 0, 0);
      const d = c.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return s;
    };
    const redraw = () => new Promise(r => {
      window.pertCanvas.setDirty(true, true); window.pertCanvas.draw(true, true);
      requestAnimationFrame(() => requestAnimationFrame(r));
    });
    const setAll = (v) => window.pertGraph._nodes
      .filter(n => n.type === 'pert/activity')
      .forEach(n => { n.properties.progress = v; n.updateSize(); n.setDirtyCanvas(true, true); });

    document.getElementById('btn-fit').click();
    setAll('NON_COMMENCE'); await redraw(); const nonCommence = sum();
    setAll('EN_COURS');     await redraw(); const enCours = sum();
    setAll('TERMINE');      await redraw(); const termine = sum();
    // On revient au defaut et on redessine : le rendu doit retrouver EXACTEMENT
    // l'image de depart (aucune trace residuelle, aucune taille de nœud figee).
    setAll('NON_COMMENCE'); await redraw(); const retourDefaut = sum();
    return { nonCommence, enCours, termine, retourDefaut };
  });
  console.log('pixels :', pixels);
  assert(pixels.nonCommence === pixels.retourDefaut,
    '« non commencé » doit rendre le planning EXACTEMENT comme avant l\'evolution');
  assert(pixels.enCours !== pixels.nonCommence, '« en cours » ne dessine aucun marqueur');
  assert(pixels.termine !== pixels.nonCommence, '« terminé » ne dessine aucun marqueur');
  assert(pixels.enCours !== pixels.termine, '« en cours » et « terminé » rendent la meme image');

  // ── 5) Filtre par avancement ─────────────────────────────────────────────────
  const filtre = await page.evaluate(() => {
    const acts = window.pertGraph._nodes.filter(n => n.type === 'pert/activity');
    acts[0].properties.progress = 'EN_COURS';
    acts[1].properties.progress = 'TERMINE';
    acts[2].properties.progress = 'NON_COMMENCE';
    acts.forEach(n => n.updateSize());

    const vifs = () => window.pertGraph._nodes.filter(n => !pertNodeDimmed(n))
      .map(n => n.properties.label).sort().join('|');

    // Chemin utilisateur : ouverture du menu → choix dans la LISTE DEROULANTE
    // « Avancement » (vocabulaire ferme : une liste, pas des lignes a pastille).
    openFilterMenu();
    const sections = Array.from(document.querySelectorAll('#filter-options .filter-menu-header'))
      .map(h => h.textContent);
    const sel = document.getElementById('filter-progress');
    const options = Array.from(sel.options).map(o => o.textContent);
    sel.value = 'EN_COURS';
    sel.dispatchEvent(new Event('change'));
    const enCours = { vifs: vifs(), declencheur: document.getElementById('filter-current').textContent };

    // Une recherche REMPLACE le filtre : la liste doit revenir a « Tous », sinon elle
    // annonce un filtre qui n'est plus actif.
    openFilterMenu();
    const input = document.getElementById('filter-search');
    input.value = 'conception'; input.dispatchEvent(new Event('input'));
    const apresRecherche = document.getElementById('filter-progress').value;
    input.value = ''; input.dispatchEvent(new Event('input'));

    // On repose le filtre d'avancement pour la suite du scenario.
    openFilterMenu();
    const sel2 = document.getElementById('filter-progress');
    sel2.value = 'EN_COURS'; sel2.dispatchEvent(new Event('change'));

    // Rouvrir le menu doit MONTRER le filtre actif (la liste le reflete).
    openFilterMenu();
    const reflet = document.getElementById('filter-progress').value;

    // REGROUPEMENT « reste a faire » : couvre DEUX etats a la fois. Ici la tache
    // terminée (Étude) doit s'estomper, les deux autres rester vives.
    const sel3 = document.getElementById('filter-progress');
    sel3.value = 'RESTE_A_FAIRE'; sel3.dispatchEvent(new Event('change'));
    const resteAFaire = {
      vifs: vifs(),
      declencheur: document.getElementById('filter-current').textContent,
    };
    openFilterMenu();
    sel3.value = 'EN_COURS'; sel3.dispatchEvent(new Event('change'));

    // Le jalon doit etre estompe : il n'a pas d'avancement, il ne matche jamais.
    const jalonEstompe = pertNodeDimmed(window.pertGraph._nodes.find(n => n.type === 'pert/milestone'));

    // La derniere tache « en cours » passe « terminée » : le filtre ne doit PAS
    // sauter tout seul (« plus rien en cours » est une reponse, pas une anomalie).
    acts[0].properties.progress = 'TERMINE';
    refreshFilterOptions();
    const apresVidage = {
      filtre: window.pertFilter && window.pertFilter.type + ':' + window.pertFilter.value,
      vifs: vifs(),
    };
    applyFilter(null); updateFilterTrigger();
    return { sections, options, enCours, jalonEstompe, apresVidage, apresRecherche,
             reflet, resteAFaire };
  });
  console.log('filtre :', JSON.stringify(filtre));
  assert(filtre.sections.indexOf('Avancement') !== -1, 'section « Avancement » absente du menu');
  assert(filtre.options.join('|') === 'Tous|Non commencé|En cours|Terminé|En cours ou non commencé',
    'liste deroulante : « Tous », les trois etats, puis le regroupement — vu ' + filtre.options.join('|'));
  // acts[0] Étude = EN_COURS, acts[1] Conception = TERMINE, acts[2] Réalisation =
  // NON_COMMENCE : le regroupement garde donc Étude et Réalisation, et estompe la
  // seule tache terminée.
  assert(filtre.resteAFaire.vifs === 'Réalisation|Étude de faisabilité',
    'le regroupement « reste a faire » doit garder vives les taches en cours ET non '
    + 'commencées — vu ' + filtre.resteAFaire.vifs);
  assert(/En cours ou non commencé/.test(filtre.resteAFaire.declencheur),
    'le declencheur doit nommer le regroupement, vu ' + filtre.resteAFaire.declencheur);
  assert(filtre.apresRecherche === '',
    'une recherche remplace le filtre : la liste doit revenir a « Tous »');
  assert(filtre.reflet === 'EN_COURS',
    'rouvrir le menu doit montrer le filtre d\'avancement actif');
  assert(filtre.enCours.vifs === 'Étude de faisabilité',
    'filtre « En cours » : seule la tache en cours doit rester vive — vu ' + filtre.enCours.vifs);
  assert(/En cours/.test(filtre.enCours.declencheur), 'declencheur du filtre non a jour');
  assert(filtre.jalonEstompe === true, 'un Jalon ne doit jamais matcher un filtre d\'avancement');
  assert(filtre.apresVidage.filtre === 'progress:EN_COURS',
    'le filtre d\'avancement ne doit pas s\'invalider quand plus rien n\'est dans l\'etat');
  assert(filtre.apresVidage.vifs === '', 'plus aucune tache ne devrait etre vive');

  // ── 6) Persistance sauvegarde → rechargement ─────────────────────────────────
  const persist = await page.evaluate(() => {
    const acts = window.pertGraph._nodes.filter(n => n.type === 'pert/activity');
    acts[0].properties.progress = 'TERMINE';
    acts[1].properties.progress = 'EN_COURS';
    acts[2].properties.progress = 'NON_COMMENCE';
    const data = JSON.parse(JSON.stringify(pertSerializeProject()));  // aller-retour JSON reel
    window.pertGraph.clear();
    pertApplyProject(data);
    return window.pertGraph._nodes.filter(n => n.type === 'pert/activity')
      .map(n => n.properties.label + '=' + pertActivityProgress(n)).join(' | ');
  });
  console.log('persistance :', persist);
  assert(persist === 'Étude de faisabilité=TERMINE | Conception=EN_COURS | Réalisation=NON_COMMENCE',
    'l\'avancement n\'a pas survecu a la sauvegarde/rechargement — vu ' + persist);

  // ── 7) Exports ───────────────────────────────────────────────────────────────
  const exports = await page.evaluate(() => {
    const csv = pertBuildCSV();
    const lignes = csv.replace(/^﻿/, '').split('\r\n');
    // Gantt : on relit le classeur produit avec la meme lib que l'app (fflate).
    const xlsx = pertBuildGanttXlsx(pertScheduleModel());
    const files = fflate.unzipSync(xlsx);
    const sheet = new TextDecoder().decode(files['xl/worksheets/sheet1.xml']);
    const shared = new TextDecoder().decode(files['xl/sharedStrings.xml']);
    const textes = Array.from(shared.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(m => m[1]);
    // Ligne 1 = en-tete : on recupere les refs de cellules et leur contenu.
    const row1 = (sheet.match(/<row r="1"[\s\S]*?<\/row>/) || [''])[0];
    const cells = Array.from(row1.matchAll(/<c r="([A-Z]+)1"[^>]*?(?: t="s")?[^>]*><v>(\d+)<\/v>/g))
      .map(m => ({ ref: m[1], val: m[2] }));
    return {
      entete: lignes[0].split(';'),
      ligne1: lignes[1].split(';'),
      ganttD: (() => { const c = cells.find(c => c.ref === 'D'); return c ? textes[+c.val] : null; })(),
      ganttE: (() => { const c = cells.find(c => c.ref === 'E'); return c ? c.val : null; })(),
      // La colonne E de la ligne d'en-tete doit etre une DATE (1re periode), donc
      // plus une chaine partagee : le decalage des periodes est bien applique.
      ganttEestDate: /<c r="E1"[^>]*s="\d+"[^>]*><v>[\d.]+<\/v>/.test(row1),
    };
  });
  console.log('CSV en-tete :', exports.entete.join(';'));
  console.log('CSV ligne 1 :', exports.ligne1.join(';'));
  assert(exports.entete[exports.entete.length - 1] === 'Avancement',
    '« Avancement » doit etre la DERNIERE colonne du CSV (schema fige, jamais intercale)');
  assert(exports.entete.length === 18, '18 colonnes CSV attendues, vu ' + exports.entete.length);
  assert(exports.ligne1[exports.ligne1.length - 1] === 'Terminé',
    'valeur d\'avancement absente du CSV — vu ' + exports.ligne1[exports.ligne1.length - 1]);
  console.log('Gantt colonne D :', exports.ganttD, '| E est une date :', exports.ganttEestDate);
  assert(exports.ganttD === 'Avancement', 'Gantt : colonne D = « Avancement », vu ' + exports.ganttD);
  assert(exports.ganttEestDate, 'Gantt : la 1re colonne de periode doit avoir glisse en E');

  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  assert(errors.length === 0, 'erreurs console');

  console.log('\n=== SMOKE AVANCEMENT OK ===');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
