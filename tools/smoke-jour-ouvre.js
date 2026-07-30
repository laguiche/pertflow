// Tests cibles : unite "j" = JOURS OUVRES dans le moteur (lot 1, v0.14.2).
//
//   1 — "j" saute les week-ends (aller) et les compte a l'envers (retour).
//   2 — Inversibilite exacte offset↔date pour un offset entier de jours ouvres.
//   3 — T0 tombant un week-end : recale sur le jour ouvre suivant (offset 0).
//   4 — Date-cible de jalon un week-end : lue comme le jour ouvre suivant.
//   5 — NON-REGRESSION "sem" : N × 7 jours calendaires exacts (une semaine reste une
//       semaine, elle n'est PAS decomposee en 5 jours ouvres parcourus un par un).
//   6 — NON-REGRESSION "mois" : mois calendaires reels + round-trip exact.
//   7 — Coherence sem/j : +1 sem (7 j calendaires) == +5 jours ouvres depuis un lundi.
//   8 — Offsets negatifs et durees fractionnaires (arrondi au jour ouvre entier).
//   9 — Perf : pas de boucle jour-a-jour (offset de 10 ans instantane).
//
// Test pur Node (aucun navigateur) : la frontiere unites↔dates ne depend que de
// window.pertMeta. Usage : node tools/smoke-jour-ouvre.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Bac a sable : on charge pert_engine.js avec un window minimal ────────────────
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'pert_engine.js'), 'utf8');
const sandbox = { window: { pertMeta: {} }, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
// LiteGraph n'est pas charge : on neutralise ce qui n'est pas la frontiere de dates.
sandbox.LiteGraph = { LGraphCanvas: function () {} };
vm.runInContext(src, sandbox);

const { pertAddUnits, pertOffsetToDate, pertDateToOffset, pertWorkdayIndex } = sandbox;
const meta = sandbox.window.pertMeta;

// ── Helpers de test ─────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = String(got) === String(want);
  if (ok) { pass++; }
  else { fail++; console.log(`  ✗ ${label}\n      attendu: ${want}\n      obtenu : ${got}`); }
}
// Date → "YYYY-MM-DD (jour)" pour des assertions lisibles.
const DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
function fmt(d) {
  if (!d) return 'null';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} (${DAYS[d.getDay()]})`;
}
function setMeta(t0, unit) { meta.t0 = t0; meta.unit = unit; }

// ── 1 : "j" saute les week-ends ─────────────────────────────────────────────────
// T0 = lundi 06/07/2026. +5 j ouvres = lundi 13/07 ; +10 j = lundi 20/07.
setMeta('2026-07-06', 'j');
check('1a  T0 + 0 j', fmt(pertOffsetToDate(0)), '2026-07-06 (lun)');
check('1b  T0 + 4 j  (vendredi)', fmt(pertOffsetToDate(4)), '2026-07-10 (ven)');
check('1c  T0 + 5 j  (lundi suivant, WE saute)', fmt(pertOffsetToDate(5)), '2026-07-13 (lun)');
check('1d  T0 + 10 j (2 WE sautes)', fmt(pertOffsetToDate(10)), '2026-07-20 (lun)');
// Le cas du brief utilisateur : tache de 10 j → fin lundi 20/07 (et non jeudi 16/07).
check('1e  tache 10 j : fin', fmt(pertOffsetToDate(10)), '2026-07-20 (lun)');
check('1f  retour : date → offset', pertDateToOffset('2026-07-20'), 10);

// ── 2 : inversibilite exacte sur une plage large ────────────────────────────────
let invOk = true;
for (let i = -60; i <= 500; i++) {
  const d = pertOffsetToDate(i);
  const p = n => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (pertDateToOffset(iso) !== i) { invOk = false; console.log('    offset non inversible :', i, iso); break; }
  if (d.getDay() === 0 || d.getDay() === 6) { invOk = false; console.log('    week-end produit :', iso); break; }
}
check('2   inversibilite j sur [-60, 500] (et jamais de week-end)', invOk, true);

// ── 3 : T0 un week-end → recale au jour ouvre suivant ───────────────────────────
setMeta('2026-07-04', 'j'); // samedi
check('3a  T0 samedi → offset 0 = lundi', fmt(pertOffsetToDate(0)), '2026-07-06 (lun)');
setMeta('2026-07-05', 'j'); // dimanche
check('3b  T0 dimanche → offset 0 = lundi', fmt(pertOffsetToDate(0)), '2026-07-06 (lun)');
check('3c  T0 dimanche : offset du lundi = 0', pertDateToOffset('2026-07-06'), 0);

// ── 4 : date-cible de jalon un week-end → jour ouvre suivant ────────────────────
setMeta('2026-07-06', 'j');
check('4a  cible dimanche 12/07 → offset', pertDateToOffset('2026-07-12'), 5);
check('4b  cible dimanche 12/07 → relue', fmt(pertOffsetToDate(pertDateToOffset('2026-07-12'))), '2026-07-13 (lun)');
check('4c  cible samedi 11/07 → meme offset', pertDateToOffset('2026-07-11'), 5);

// ── 5 : NON-REGRESSION "sem" (N × 7 jours calendaires) ──────────────────────────
setMeta('2026-07-06', 'sem');
check('5a  T0 + 1 sem = +7 j calendaires', fmt(pertOffsetToDate(1)), '2026-07-13 (lun)');
check('5b  T0 + 4 sem = +28 j calendaires', fmt(pertOffsetToDate(4)), '2026-08-03 (lun)');
check('5c  1,5 sem = 10,5 j → arrondi 11 j', fmt(pertOffsetToDate(1.5)), '2026-07-17 (ven)');
check('5d  round-trip sem', pertDateToOffset('2026-08-03'), 4);
// T0 un week-end en "sem" : PAS de recalage (comportement historique preserve).
setMeta('2026-07-04', 'sem');
check('5e  T0 samedi en sem : non recale', fmt(pertOffsetToDate(0)), '2026-07-04 (sam)');
check('5f  T0 samedi + 1 sem', fmt(pertOffsetToDate(1)), '2026-07-11 (sam)');

// ── 6 : NON-REGRESSION "mois" (calendaire reel) ─────────────────────────────────
setMeta('2026-01-31', 'mois');
check('6a  31/01 + 1 mois (fevrier court)', fmt(pertOffsetToDate(1)), '2026-03-03 (mar)');
setMeta('2026-07-06', 'mois');
check('6b  T0 + 12 mois', fmt(pertOffsetToDate(12)), '2027-07-06 (mar)');
check('6c  round-trip 12 mois', pertDateToOffset('2027-07-06'), 12);
setMeta('2024-02-29', 'mois'); // bissextile
check('6d  29/02/2024 + 12 mois', fmt(pertOffsetToDate(12)), '2025-03-01 (sam)');

// ── 7 : coherence sem / j (+5 j ouvres == +7 j calendaires depuis un lundi) ─────
setMeta('2026-07-06', 'j');
const j5 = fmt(pertOffsetToDate(5));
setMeta('2026-07-06', 'sem');
const s1 = fmt(pertOffsetToDate(1));
check('7   +5 j ouvres == +1 sem', j5, s1);

// ── 8 : offsets negatifs et durees fractionnaires ───────────────────────────────
setMeta('2026-07-06', 'j');
check('8a  T0 - 1 j (vendredi precedent)', fmt(pertOffsetToDate(-1)), '2026-07-03 (ven)');
check('8b  T0 - 5 j', fmt(pertOffsetToDate(-5)), '2026-06-29 (lun)');
check('8c  round-trip negatif', pertDateToOffset('2026-06-29'), -5);
check('8d  duree 1,9 j → arrondi 2 j ouvres', fmt(pertOffsetToDate(1.9)), '2026-07-08 (mer)');
check('8e  duree 0,4 j → arrondi 0', fmt(pertOffsetToDate(0.4)), '2026-07-06 (lun)');

// ── 9 : perf (formule O(1), pas de boucle jour-a-jour) ──────────────────────────
const t = Date.now();
setMeta('2020-01-01', 'j');
for (let i = 0; i < 20000; i++) pertOffsetToDate(2610); // ~10 ans de jours ouvres
const ms = Date.now() - t;
check('9a  20000 conversions +10 ans < 200 ms', ms < 200, true);
// 2610 j ouvres = 522 semaines pile → meme jour de semaine que T0 (mercredi).
check('9b  2610 j ouvres depuis mer 01/01/2020', fmt(pertOffsetToDate(2610)), '2030-01-02 (mer)');
// L'index de jour ouvre reste coherent sur un siecle.
check('9c  index monotone (1970→2070)',
  pertWorkdayIndex(new Date(2070, 0, 1)) > pertWorkdayIndex(new Date(1970, 0, 1)), true);

console.log(`\n${pass} assertion(s) OK, ${fail} echec(s).`);
process.exit(fail ? 1 : 0);
