// Tests cibles : refonte de l'import (lot 2, v0.15).
//
//   1 — Fenetre d'import : 2 formats, ordre stable (CPERT puis .pert).
//   2 — pertConvertDuration : pivot jours ouvres (sem=5, mois=261/12), arrondi 2 dec.
//   3 — pertResolveT0 : min() + cote a ancrer (imported / existing / aucun).
//   4 — pertAnchorRoots : jalon entrant date branche sur les racines NON ancrees ;
//       aucune creation si toutes les racines sont deja des jalons entrants dates.
//   5 — Import .pert dans projet VIDE : adoption T0/unite, aucun ancrage.
//   6 — Import .pert dans projet EXISTANT, T0 importe POSTERIEUR : T0 = min,
//       ancrage du bloc importe, les dates absolues des deux blocs sont preservees.
//   7 — Import .pert, T0 importe ANTERIEUR : T0 = min (importe), ancrage du bloc
//       EXISTANT (c'est lui qui demarrait le plus tard).
//   8 — Dialogue d'unite : divergence → 3 issues. "cancel" n'ajoute rien ;
//       "convert" convertit les durees ; "ignore" les laisse telles quelles.
//       Pas de dialogue si projet vide ou unites identiques.
//   9 — Groupes : "conserver" (defaut) preserve groupe/couleur du fichier ; conflit de
//       couleur → le PROJET COURANT gagne ; "retag" ecrase tout avec un groupe unique.
//  10 — uid dedoublonnes (meme .pert importe deux fois).
//  11 — Non-regression CPERT : l'unite du projet n'est plus ecrasee en silence.
//
// Usage : node tools/smoke-import.js   (depuis la racine ou depuis tools/)

const path = require('path');
const lib = require('./lib');

// Petit .pert de test, fabrique en memoire (pas de fixture externe).
// A(2) → B(3) → J(jalon terminal). Groupe "Meca" en orange.
function makePert(t0, unit, opts = {}) {
  const color = opts.color || '#F5A623';
  return {
    version: '1.0',
    meta: {
      title: opts.title || 'Importe', t0, unit,
      groups: opts.groups || { Meca: color },
      layout_gap: 30, prop_width: true, link_mode: 'courbe',
      hours_per_month: 135, hours_per_day: 8, hourly_rate: 136, autosave: false
    },
    graph: {
      last_node_id: 3, last_link_id: 2,
      nodes: [
        { id: 1, type: 'pert/activity', pos: [100, 100], size: [200, 100], order: 0, mode: 0,
          inputs: [{ name: '', type: 'pert_flow', link: null }],
          outputs: [{ name: '', type: 'pert_flow', links: [1] }],
          properties: { uid: 'uid-a', label: 'Import A', duration: 2, etp: 1,
                        responsible: 'Alice', notes: '', group: 'Meca', color } },
        { id: 2, type: 'pert/activity', pos: [400, 100], size: [200, 100], order: 1, mode: 0,
          inputs: [{ name: '', type: 'pert_flow', link: 1 }],
          outputs: [{ name: '', type: 'pert_flow', links: [2] }],
          properties: { uid: 'uid-b', label: 'Import B', duration: 3, etp: 1,
                        responsible: '', notes: '', group: 'Meca', color } },
        { id: 3, type: 'pert/milestone', pos: [700, 100], size: [180, 90], order: 2, mode: 0,
          inputs: [{ name: '', type: 'pert_flow', link: 2 }],
          outputs: [{ name: '', type: 'pert_flow', links: null }],
          properties: { label: 'Fin import', due_date: '', tag: '' } }
      ],
      links: [[1, 1, 0, 2, 0, 'pert_flow'], [2, 2, 0, 3, 0, 'pert_flow']],
      groups: [], config: {}, extra: {}
    }
  };
}

// Ecrit un .pert temporaire et renvoie son chemin.
const fs = require('fs');
const os = require('os');
function writePert(obj, name) {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log(`  ✗ ${label}\n      attendu: ${JSON.stringify(want)}\n      obtenu : ${JSON.stringify(got)}`); }
}

// Construit un projet courant « existant » : C(4) en unite/T0 donnes.
async function seedProject(page, t0, unit, dur) {
  await page.evaluate(({ t0, unit, dur }) => {
    const g = window.pertGraph;
    g.clear();
    window.pertMeta.t0 = t0;
    window.pertMeta.unit = unit;
    window.pertMeta.groups = {};
    window.pertMeta.title = 'Projet courant';
    const n = LiteGraph.createNode('pert/activity');
    n.properties.label = 'Existant C';
    n.properties.duration = dur;
    n.properties.color = '#4A90D9';
    n.pos = [100, 100];
    g.add(n);
    n.updateSize();
    pertRecalc();
  }, { t0, unit, dur });
}

// Etat lisible du graphe apres import.
async function snapshot(page) {
  return page.evaluate(() => {
    const g = window.pertGraph;
    const iso = d => { if (!d) return null; const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
    return {
      t0: window.pertMeta.t0, unit: window.pertMeta.unit,
      groups: Object.assign({}, window.pertMeta.groups),
      nodes: g._nodes.map(n => ({
        label: n.properties.label, type: n.type,
        duration: n.properties.duration, group: n.properties.group,
        color: n.properties.color, due: n.properties.due_date,
        uid: n.properties.uid,
        esDate: iso(pertOffsetToDate(n.es)), efDate: iso(pertOffsetToDate(n.ef))
      }))
    };
  });
}

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await lib.openApp(page);

  // ── 1 : fenetre d'import, formats et ordre ─────────────────────────────────────
  const formats = await page.evaluate(() =>
    window.PERT_IMPORT_FORMATS.slice().sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(f => f.id));
  check('1   formats (ordre stable)', formats, ['cpert', 'pert']);
  await page.click('#btn-import');
  const rows = await page.$$eval('#import-format-list .import-format-row',
    els => els.map(e => e.querySelector('.import-format-label').textContent));
  check('1b  lignes de la fenetre', rows.length, 2);
  await page.click('#import-cancel');

  // ── 2 : conversion de durees (pivot jours ouvres) ──────────────────────────────
  const conv = await page.evaluate(() => ({
    semToJ: pertConvertDuration(2, 'sem', 'j'),          // 2 x 5 = 10
    jToSem: pertConvertDuration(10, 'j', 'sem'),         // 10 / 5 = 2
    moisToJ: pertConvertDuration(1, 'mois', 'j'),        // 261/12 = 21,75
    moisToSem: pertConvertDuration(6, 'mois', 'sem'),    // 6 x 21,75 / 5 = 26,1
    semToMois: pertConvertDuration(4, 'sem', 'mois'),    // 4 x 5 / 21,75 = 0,92
    same: pertConvertDuration(3, 'mois', 'mois')
  }));
  check('2   conversions', conv, { semToJ: 10, jToSem: 2, moisToJ: 21.75, moisToSem: 26.1, semToMois: 0.92, same: 3 });

  // ── 3 : resolution du T0 (min + cote a ancrer) ─────────────────────────────────
  const t0res = await page.evaluate(() => {
    window.pertMeta.t0 = '2026-03-01';
    return {
      importedLater: pertResolveT0('2026-06-01', false),
      importedEarlier: pertResolveT0('2026-01-01', false),
      same: pertResolveT0('2026-03-01', false),
      emptyProject: pertResolveT0('2026-06-01', true),
      noImportedT0: pertResolveT0('', false)
    };
  });
  check('3a  T0 importe posterieur → ancre le bloc importe', t0res.importedLater,
    { t0: '2026-03-01', anchor: { side: 'imported', date: '2026-06-01' } });
  check('3b  T0 importe anterieur → ancre le bloc existant', t0res.importedEarlier,
    { t0: '2026-01-01', anchor: { side: 'existing', date: '2026-03-01' } });
  check('3c  T0 identiques → pas d\'ancrage', t0res.same, { t0: '2026-03-01', anchor: null });
  check('3d  projet vide → adoption, pas d\'ancrage', t0res.emptyProject, { t0: '2026-06-01', anchor: null });
  check('3e  pas de T0 importe → T0 courant', t0res.noImportedT0, { t0: '2026-03-01', anchor: null });

  // ── 4 : ancrage — racines deja ancrees ignorees ────────────────────────────────
  const anch = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const a = LiteGraph.createNode('pert/activity'); a.properties.label = 'R1'; a.pos = [300, 100]; g.add(a);
    const b = LiteGraph.createNode('pert/activity'); b.properties.label = 'R2'; b.pos = [300, 300]; g.add(b);
    a.connect(0, b, 0); // b n'est plus une racine
    const created = pertAnchorRoots(g._nodes.slice(), '2026-05-04', 'Début X');
    const links = created ? created.outputs[0].links.length : 0;
    // Cas ou toutes les racines sont deja des jalons entrants dates.
    g.clear();
    const m = LiteGraph.createNode('pert/milestone');
    m.properties.due_date = '2026-05-04'; m.pos = [100, 100]; g.add(m);
    const c = LiteGraph.createNode('pert/activity'); c.pos = [400, 100]; g.add(c);
    m.connect(0, c, 0);
    const again = pertAnchorRoots(g._nodes.slice(), '2026-05-04', 'Début Y');
    return { label: created && created.properties.label, due: created && created.properties.due_date,
             links, secondPass: again };
  });
  check('4a  jalon d\'ancrage cree', { label: anch.label, due: anch.due },
    { label: 'Début X', due: '2026-05-04' });
  check('4b  branche sur la seule racine', anch.links, 1);
  check('4c  bloc deja ancre → aucun jalon cree', anch.secondPass, null);

  // ── 5 : import .pert dans projet VIDE ──────────────────────────────────────────
  const f1 = writePert(makePert('2026-07-06', 'j'), 'pf-import-1.pert');
  await page.evaluate(() => { window.pertGraph.clear(); window.pertMeta.t0 = ''; window.pertMeta.groups = {}; });
  await lib.importPert(page, f1);
  let s = await snapshot(page);
  check('5a  T0 adopte', s.t0, '2026-07-06');
  check('5b  unite adoptee', s.unit, 'j');
  check('5c  3 nœuds, aucun ancrage', s.nodes.length, 3);
  // A demarre a T0 (lundi), dure 2 j ouvres → fin mercredi ; B fin lundi suivant.
  check('5d  dates en jours ouvres', [s.nodes[0].esDate, s.nodes[0].efDate, s.nodes[1].efDate],
    ['2026-07-06', '2026-07-08', '2026-07-13']);

  // ── 6 : projet existant, T0 importe POSTERIEUR → ancrage du bloc importe ───────
  await seedProject(page, '2026-03-02', 'mois', 2);   // C : mars → mai
  const f2 = writePert(makePert('2026-06-01', 'mois'), 'pf-import-2.pert');
  await lib.importPert(page, f2);
  s = await snapshot(page);
  check('6a  T0 projet = min (inchange ici)', s.t0, '2026-03-02');
  const anchor6 = s.nodes.find(n => n.type === 'pert/milestone' && n.due === '2026-06-01');
  check('6b  jalon d\'ancrage cree a la date du bloc importe', !!anchor6, true);
  const impA6 = s.nodes.find(n => n.label === 'Import A');
  check('6c  le bloc importe demarre bien a SON T0 (dates preservees)', impA6.esDate, '2026-06-01');
  const exist6 = s.nodes.find(n => n.label === 'Existant C');
  check('6d  le bloc existant ne bouge pas', exist6.esDate, '2026-03-02');

  // ── 7 : T0 importe ANTERIEUR → ancrage du bloc EXISTANT ───────────────────────
  await seedProject(page, '2026-06-01', 'mois', 2);
  const f3 = writePert(makePert('2026-03-02', 'mois'), 'pf-import-3.pert');
  await lib.importPert(page, f3);
  s = await snapshot(page);
  check('7a  T0 projet recule au plus anterieur', s.t0, '2026-03-02');
  const anchor7 = s.nodes.find(n => n.type === 'pert/milestone' && n.due === '2026-06-01');
  check('7b  jalon d\'ancrage du bloc EXISTANT cree', !!anchor7, true);
  const exist7 = s.nodes.find(n => n.label === 'Existant C');
  check('7c  le bloc existant conserve sa date de demarrage', exist7.esDate, '2026-06-01');
  const impA7 = s.nodes.find(n => n.label === 'Import A');
  check('7d  le bloc importe demarre au nouveau T0', impA7.esDate, '2026-03-02');

  // ── 8 : dialogue d'unite (3 issues) ────────────────────────────────────────────
  // 8a — annulation : rien n'est ajoute.
  await seedProject(page, '2026-03-02', 'mois', 2);
  const f4 = writePert(makePert('2026-03-02', 'sem'), 'pf-import-4.pert');
  await lib.importPert(page, f4, { unitChoice: 'cancel' });
  s = await snapshot(page);
  check('8a  « Annuler l\'import » n\'ajoute rien', s.nodes.length, 1);
  check('8b  unite du projet intacte', s.unit, 'mois');

  // 8c — conversion : durees sem → mois (2 sem = 0,46 mois ; 3 sem = 0,69 mois).
  await seedProject(page, '2026-03-02', 'mois', 2);
  await lib.importPert(page, f4, { unitChoice: 'convert' });
  s = await snapshot(page);
  check('8c  unite du projet preservee', s.unit, 'mois');
  check('8d  durees converties (sem → mois)',
    [s.nodes.find(n => n.label === 'Import A').duration,
     s.nodes.find(n => n.label === 'Import B').duration], [0.46, 0.69]);

  // 8e — ignorer : durees telles quelles.
  await seedProject(page, '2026-03-02', 'mois', 2);
  await lib.importPert(page, f4, { unitChoice: 'ignore' });
  s = await snapshot(page);
  check('8e  durees inchangees si unite ignoree',
    [s.nodes.find(n => n.label === 'Import A').duration,
     s.nodes.find(n => n.label === 'Import B').duration], [2, 3]);

  // 8f — unites identiques → aucun dialogue (resolveUnitDialog renvoie false).
  await seedProject(page, '2026-03-02', 'mois', 2);
  const f5 = writePert(makePert('2026-03-02', 'mois'), 'pf-import-5.pert');
  await lib.pickImportFormat(page, 'pert', f5);
  await page.waitForSelector('#color-dialog');
  await page.click('#color-dialog .dialog-buttons button.primary');
  const shown = await lib.resolveUnitDialog(page);
  check('8f  pas de dialogue si unites identiques', shown, false);
  await page.waitForTimeout(500);

  // ── 9 : groupes et couleurs ────────────────────────────────────────────────────
  // 9a — « conserver » : groupe/couleur du fichier repris (groupe inconnu du projet).
  await page.evaluate(() => { window.pertGraph.clear(); window.pertMeta.groups = {}; window.pertMeta.t0 = ''; });
  await lib.importPert(page, f5);
  s = await snapshot(page);
  check('9a  groupe conserve', s.nodes.find(n => n.label === 'Import A').group, 'Meca');
  check('9b  couleur du fichier enregistree', s.groups.Meca, '#F5A623');

  // 9c — conflit de couleur : le PROJET COURANT gagne.
  await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.t0 = '2026-03-02'; window.pertMeta.unit = 'mois';
    window.pertMeta.groups = { Meca: '#4A90D9' };   // Meca en BLEU cote projet
    const n = LiteGraph.createNode('pert/activity');
    n.properties.label = 'Existant C'; n.properties.group = 'Meca';
    n.properties.color = '#4A90D9'; n.pos = [100, 100]; g.add(n); n.updateSize();
  });
  const conflicts = await page.evaluate(() => pertGroupColorConflicts({ Meca: '#F5A623' }));
  check('9c  conflit detecte', conflicts, [{ name: 'Meca', current: '#4A90D9', file: '#F5A623' }]);
  await lib.importPert(page, f5);          // fichier : Meca en orange
  s = await snapshot(page);
  check('9d  la couleur du projet gagne (registre)', s.groups.Meca, '#4A90D9');
  check('9e  les taches importees heritent du bleu',
    s.nodes.find(n => n.label === 'Import A').color, '#4A90D9');

  // 9f — « retag » : groupe unique, couleur unique, groupe du fichier ecrase.
  await page.evaluate(() => {
    window.pertGraph.clear(); window.pertMeta.groups = {};
    window.pertMeta.t0 = '2026-03-02'; window.pertMeta.unit = 'mois';
  });
  await lib.importPert(page, f5, { keep: false, group: 'Lot Z' });
  s = await snapshot(page);
  check('9f  retag : groupe ecrase', s.nodes.find(n => n.label === 'Import A').group, 'Lot Z');
  check('9g  retag : ancien groupe non enregistre', s.groups.Meca, undefined);

  // ── 10 : uid dedoublonnes (meme fichier importe deux fois) ────────────────────
  await page.evaluate(() => { window.pertGraph.clear(); window.pertMeta.groups = {}; window.pertMeta.t0 = ''; });
  await lib.importPert(page, f5);
  await lib.importPert(page, f5);
  const uids = await page.evaluate(() => window.pertGraph._nodes
    .filter(n => n.type === 'pert/activity').map(n => n.properties.uid));
  check('10a 4 activites', uids.length, 4);
  check('10b uid tous distincts', new Set(uids).size, 4);

  // ── 11 : non-regression CPERT (unite du projet non ecrasee) ───────────────────
  await seedProject(page, '2026-03-02', 'j', 2);   // projet en JOURS
  await lib.importXlsm(page, lib.CPERT, { unitChoice: 'ignore' }); // le CPERT est en mois
  s = await snapshot(page);
  check('11a unite du projet preservee (plus d\'ecrasement)', s.unit, 'j');
  check('11b nœuds importes', s.nodes.length > 1, true);

  console.log('\nErreurs console/page:', errors.length ? errors : 'aucune');
  console.log(`${pass} assertion(s) OK, ${fail} echec(s).`);
  await browser.close();
  if (fail || errors.length) { console.log('\n=== SMOKE IMPORT FAIL ==='); process.exit(1); }
  console.log('\n=== SMOKE IMPORT OK ===');
})();
