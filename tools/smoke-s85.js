// Tests cibles Session 8.5 : estimation des couts (#3 reintroduit).
//   - formule cout = duree→heures (selon unite) × ETP × taux, par unite (j/sem/mois)
//   - ETP par defaut + serialisation .pert
//   - parametres de cout (meta) serialises + restaures
//   - barre d'etat : cout total (limite aux taches visibles si filtre), cout chemin critique
//   - les Jalons n'ont pas de cout
// Usage : node tools/smoke-s85.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // ── ETP par defaut + formule de cout selon l'unite ────────────────────────────
  const formula = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta;
    m.hours_per_month = 135; m.hours_per_day = 8; m.hourly_rate = 136;
    const a = LiteGraph.createNode('pert/activity'); a.properties.duration = 5; g.add(a);
    const etpDef = a.properties.etp;          // defaut attendu 1
    a.properties.etp = 1.5;
    m.unit = 'mois'; const cMois = pertActivityCost(a);   // 135*5*1.5*136
    m.unit = 'sem';  const cSem  = pertActivityCost(a);   // 5*8*5*1.5*136
    m.unit = 'j';    const cJour = pertActivityCost(a);   // 8*5*1.5*136
    // un jalon n'a pas de cout
    const jal = LiteGraph.createNode('pert/milestone'); g.add(jal);
    return { etpDef, cMois, cSem, cJour, cJalon: pertActivityCost(jal),
             fmt: pertFormatCost(cMois) };
  });
  console.log('formule:', formula);
  if (formula.etpDef !== 1) throw new Error('ETP par defaut != 1');
  if (Math.abs(formula.cMois - 135*5*1.5*136) > 1e-6) throw new Error('cout mois incorrect');
  if (Math.abs(formula.cSem  - 5*8*5*1.5*136) > 1e-6) throw new Error('cout semaine incorrect (5×h/jour)');
  if (Math.abs(formula.cJour - 8*5*1.5*136) > 1e-6) throw new Error('cout jour incorrect');
  if (formula.cJalon !== 0) throw new Error('un jalon ne doit pas avoir de cout');
  if (!/k€/.test(formula.fmt)) throw new Error('format k€ manquant');

  // ── ETP=0 → cout nul ; duree=0 → cout nul ─────────────────────────────────────
  const zero = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.unit = 'mois';
    const a = LiteGraph.createNode('pert/activity'); a.properties.duration = 3; a.properties.etp = 0; g.add(a);
    const c0 = pertActivityCost(a);
    a.properties.etp = 2; a.properties.duration = 0;
    return { c0, cDur0: pertActivityCost(a) };
  });
  console.log('zero:', zero);
  if (zero.c0 !== 0 || zero.cDur0 !== 0) throw new Error('cout non nul a ETP=0 ou duree=0');

  // ── Barre d'etat : total = visibles ; filtre exclut le hors-groupe ────────────
  const status = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.groups = {};
    const m = window.pertMeta; m.unit = 'mois'; m.hours_per_month = 135; m.hours_per_day = 8; m.hourly_rate = 136;
    const mk = (group, dur, etp) => { const n = LiteGraph.createNode('pert/activity'); n.properties.group = group; n.properties.duration = dur; n.properties.etp = etp; g.add(n); pertApplyGroup(n); return n; };
    const a = mk('Alpha', 2, 1);  // 135*2*1*136 = 36720
    const b = mk('Beta', 3, 1);   // 135*3*1*136 = 55080
    pertRecalc();
    // sans filtre : total = a + b
    window.pertFilter = null; updateStatus();
    const totalAll = document.getElementById('status-cost').textContent;
    // filtre groupe Alpha : seul a est visible
    window.pertFilter = { type: 'group', value: 'Alpha' }; updateStatus();
    const totalFilt = document.getElementById('status-cost').textContent;
    window.pertFilter = null;
    return { totalAll, totalFilt,
             costA: pertActivityCost(a), costB: pertActivityCost(b) };
  });
  console.log('status:', status);
  // verifications robustes sur les montants (en k€, 1 decimale FR — meme format que pertFormatCost)
  const k = e => (e/1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  if (!status.totalAll.startsWith('Coût total :')) throw new Error('libelle total hors-filtre incorrect');
  if (!status.totalAll.includes(k(status.costA + status.costB))) throw new Error('total hors-filtre != A+B');
  if (!status.totalFilt.startsWith('Coût visible :')) throw new Error('libelle total filtre incorrect (doit dire "Coût visible")');
  if (!status.totalFilt.includes(k(status.costA))) throw new Error('total filtre != cout de A seul');
  // le total VISIBLE ne doit pas valoir A+B (filtre limite aux visibles) — sauf coincidence
  // de format ; A et B ont des couts distincts donc k(A) != k(A+B).
  if (status.totalFilt.split('·')[0].includes(k(status.costA + status.costB)))
    throw new Error('le filtre ne limite pas le total aux visibles');

  // ── Cout du chemin critique = somme des activites is_critical ─────────────────
  const crit = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.t0 = '2026-01-01'; window.pertMeta.unit = 'mois';
    // chaine A(2)->B(3) ; B en bout = chemin critique ; une activite isolee C(1) hors critique
    const A = LiteGraph.createNode('pert/activity'); A.properties.duration = 2; A.properties.etp = 1; g.add(A);
    const B = LiteGraph.createNode('pert/activity'); B.properties.duration = 3; B.properties.etp = 1; g.add(B);
    A.connect(0, B, 0);
    const C = LiteGraph.createNode('pert/activity'); C.properties.duration = 1; C.properties.etp = 1; g.add(C);
    pertRecalc(); updateStatus();
    const txt = document.getElementById('status-cost').textContent;
    return { txt, critFlags: [A,B,C].map(n => n.is_critical),
             costAB: pertActivityCost(A) + pertActivityCost(B) };
  });
  console.log('crit:', crit);
  const k2 = e => (e/1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  // A et B critiques (chaine la plus longue), C non critique
  if (!(crit.critFlags[0] && crit.critFlags[1] && !crit.critFlags[2]))
    throw new Error('flags is_critical inattendus: ' + crit.critFlags);
  // sans selection : chemin critique = marge minimale = {A, B} (2 taches)
  if (!crit.txt.includes('Chemin critique : 2 tâche(s), ' + k2(crit.costAB)))
    throw new Error('cout/nb chemin critique par defaut != 2 taches A+B : ' + crit.txt);

  // ── Le chemin critique de la barre d'etat SUIT la selection ; sans selection = marge
  //    minimale ; jalons exclus du comptage (decision user). ─────────────────────────
  const follow = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.t0 = '2026-01-01'; window.pertMeta.unit = 'mois';
    window.pertMeta.hours_per_month = 135; window.pertMeta.hours_per_day = 8; window.pertMeta.hourly_rate = 136;
    // A(5)->FIN(jalon terminal) = chemin critique ; C(1) ISOLEE = tache non critique
    // (slack 4, LF cale sur la fin de projet). Pas de multi-entree sur FIN (un 2e
    // connect sur le slot 0 remplacerait le 1er — slots d'entree dynamiques du jalon).
    const A = LiteGraph.createNode('pert/activity'); A.properties.label='A'; A.properties.duration=5; A.properties.etp=1; g.add(A);
    const C = LiteGraph.createNode('pert/activity'); C.properties.label='C'; C.properties.duration=1; C.properties.etp=1; g.add(C);
    const FIN = LiteGraph.createNode('pert/milestone'); FIN.properties.label='FIN'; g.add(FIN);
    A.connect(0, FIN, 0);
    window.pertHighlightTargetId = null;
    pertRecalc();                       // recalc -> highlight defaut (marge minimale)
    const def = document.getElementById('status-cost').textContent;
    const defIds = Array.from(window.pertCriticalPathIds);
    // selection de C (tache NON critique) -> le chemin suivi devient celui de C
    window.pertHighlightTargetId = C.id;
    pertHighlightCriticalPath(C.id);
    const selC = document.getElementById('status-cost').textContent;
    const nodesTxt = (function(){ updateStatus(); return document.getElementById('status-nodes').textContent; })();
    return { def, selC, defIds, idA: A.id, idC: C.id, idFIN: FIN.id,
             costA: pertActivityCost(A), costC: pertActivityCost(C), nodesTxt };
  });
  console.log('follow:', follow);
  const k3 = e => (e/1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  // defaut : chemin critique = {A, FIN} mais on ne compte que la tache A (jalon exclu)
  if (!follow.defIds.includes(follow.idA) || !follow.defIds.includes(follow.idFIN))
    throw new Error('chemin par defaut devrait inclure A et FIN (marge minimale)');
  if (follow.defIds.includes(follow.idC))
    throw new Error('C (non critique) ne doit pas etre dans le chemin par defaut');
  if (!follow.def.includes('Chemin critique : 1 tâche(s), ' + k3(follow.costA)))
    throw new Error('defaut : doit compter 1 tache (A) et son cout, jalon FIN exclu : ' + follow.def);
  // selection de C : le chemin suivi = C seul -> cout de C, 1 tache
  if (!follow.selC.includes('Chemin critique : 1 tâche(s), ' + k3(follow.costC)))
    throw new Error('selection C : le chemin critique de la barre d\'etat ne suit pas la selection : ' + follow.selC);
  if (follow.def === follow.selC)
    throw new Error('la barre d\'etat est invariante : elle ne suit pas la selection');
  // total projet compte les taches (2 : A et C), pas le jalon
  if (follow.nodesTxt !== '2 tâche(s)')
    throw new Error('le compte projet doit etre en taches (2), jalon exclu : ' + follow.nodesTxt);

  // ── Round-trip .pert : etp + parametres de cout survivent ─────────────────────
  const rt = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta; m.hours_per_month = 140; m.hours_per_day = 7; m.hourly_rate = 99;
    const a = LiteGraph.createNode('pert/activity'); a.properties.etp = 2.5; g.add(a);
    const data = JSON.parse(JSON.stringify(pertSerializeProject()));
    // on perturbe avant rechargement
    m.hours_per_month = 1; m.hours_per_day = 1; m.hourly_rate = 1;
    pertApplyProject(data);
    const a2 = window.pertGraph._nodes.find(n => n.type === 'pert/activity');
    return { etp: a2.properties.etp, hpm: window.pertMeta.hours_per_month,
             hpd: window.pertMeta.hours_per_day, rate: window.pertMeta.hourly_rate };
  });
  console.log('round-trip:', rt);
  if (rt.etp !== 2.5) throw new Error('ETP non persiste');
  if (rt.hpm !== 140 || rt.hpd !== 7 || rt.rate !== 99) throw new Error('parametres de cout non persistes');

  await page.waitForTimeout(100);
  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  if (errors.length) throw new Error('Erreurs JS detectees');

  await browser.close();
  console.log('\n=== SMOKE S8.5 OK ===');
})().catch(e => { console.error('SMOKE S8.5 FAIL:', e.message); process.exit(1); });
