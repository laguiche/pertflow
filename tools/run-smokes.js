// Lance TOUTE la suite de validation : chaque fichier tools/smoke*.js, l'un apres
// l'autre, et rend un compte rendu unique.
//
// Usage :
//   node tools/run-smokes.js                 la suite complete
//   node tools/run-smokes.js -v              en affichant la sortie de chaque test
//   node tools/run-smokes.js import suivi    seulement les tests dont le nom contient
//                                            "import" ou "suivi"
//
// Pourquoi un lanceur separe plutot qu'un framework (Jest, Mocha…) : chaque smoke est
// un programme Node autonome qui pilote un vrai navigateur et se suffit a lui-meme
// (`node tools/smoke-s9.js` doit continuer a marcher seul, c'est ainsi qu'on debogue).
// Le contrat est donc reduit au minimum : code de sortie 0 = succes. Un framework
// imposerait de tout reecrire, et une dependance de plus, pour le meme resultat.
//
// Sequentiel et non parallele : les tests partagent le repertoire de telechargement
// et le meme Chromium, et chacun mesure des rendus canvas — les faire concourir rendrait
// les echecs non reproductibles, ce qui coute plus cher que les minutes gagnees.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const args = process.argv.slice(2);
const verbose = args.includes('-v') || args.includes('--verbose');
const filtres = args.filter(a => a[0] !== '-');

const tests = fs.readdirSync(__dirname)
  .filter(f => /^smoke.*\.js$/.test(f))
  .filter(f => !filtres.length || filtres.some(m => f.includes(m)))
  .sort();

if (!tests.length) {
  console.error('Aucun test ne correspond a : ' + filtres.join(' '));
  process.exit(2);
}

// Un prerequis manquant n'est pas un echec de test : on le dit une fois, clairement,
// plutot que de laisser toute la suite echouer sur la meme cause.
if (!lib.findChromium()) {
  console.error('Chromium introuvable dans ~/.cache/ms-playwright.');
  console.error('  → npx playwright install chromium   (cf. tools/README.md)');
  process.exit(2);
}
if (!fs.existsSync(lib.CPERT)) {
  console.error('Classeur CPERT d\'essai absent : ' + lib.CPERT);
  console.error('  → node tools/make-cpert-fixture.js   (cf. tools/README.md)');
  process.exit(2);
}

const echecs = [];
const t0 = Date.now();

for (const t of tests) {
  const debut = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, t)], {
    cwd: __dirname,
    encoding: 'utf8',
    stdio: verbose ? 'inherit' : 'pipe',
  });
  const duree = ((Date.now() - debut) / 1000).toFixed(1);
  const ok = r.status === 0;
  if (!ok) echecs.push({ t, sortie: [r.stdout, r.stderr].filter(Boolean).join('\n') });
  console.log(`${ok ? '  OK  ' : 'ECHEC'}  ${t.padEnd(36)} ${duree.padStart(6)} s`);
}

// La sortie des tests en echec est rejouee a la fin, et non au fil de l'eau : le
// compte rendu reste lisible, et l'essentiel (ce qui a casse) se lit d'un bloc.
for (const e of echecs) {
  console.log('\n' + '─'.repeat(72) + `\n${e.t}\n` + '─'.repeat(72));
  console.log(e.sortie.trim() || '(aucune sortie)');
}

const total = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n${tests.length - echecs.length}/${tests.length} test(s) OK en ${total} s.`);
process.exit(echecs.length ? 1 : 0);
