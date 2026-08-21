// Capture du MANUEL — export « Planning directeur » (v0.23).
//   planning-directeur.png — le classeur produit, tel qu'il s'ouvre dans un tableur
// Sortie : docs/images/manuel/ (VERSIONNE — cette image illustre le manuel).
// Usage : node tools/doc-shots-planning-directeur.js
//
// PREREQUIS PARTICULIER : ce script-ci a besoin de **LibreOffice** (binaire
// `libreoffice`) et de **pdftoppm** (paquet poppler-utils), en plus de Chromium.
// C'est la seule capture du manuel qui montre un fichier PRODUIT et non l'application
// elle-meme : il faut donc l'ouvrir dans un tableur pour la photographier. En son
// absence, le script s'arrete proprement en le disant — l'image versionnee reste
// valable, elle n'a a etre refaite que si le canevas de l'export change.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');

// Planning d'illustration : deux chaines menees en parallele sur ~18 mois, disposees
// verticalement comme un lecteur les rangerait — c'est precisement cet agencement que
// l'export doit restituer, l'image ne montrerait rien s'il etait quelconque.
function PLAN() {
  const g = window.pertGraph; g.clear();
  const m = window.pertMeta;
  m.title = 'Programme — poste de contrôle';
  m.t0 = '2026-01-05'; m.unit = 'mois';
  m.groups = { 'Études': '#4A90D9', 'Réalisation': '#7ED321', 'Qualification': '#F5A623' };
  const link = (s, d) => s.connect(0, d, d.inputs.length - 1);
  const act = (label, dur, groupe, x, y) => {
    const n = LiteGraph.createNode('pert/activity');
    n.properties.label = label; n.properties.duration = dur; n.properties.group = groupe;
    n.properties.color = m.groups[groupe]; n.color = n.properties.color;
    n.updateSize(); g.add(n); n.pos = [x, y];
    return n;
  };
  const jalon = (label, x, y, due) => {
    const n = LiteGraph.createNode('pert/milestone');
    n.properties.label = label;
    if (due) { n.properties.due_mode = 'date'; n.properties.due_date = due; }
    n.updateSize(); g.add(n); n.pos = [x, y];
    return n;
  };
  // Quatre lignes bien separees verticalement : c'est ce decoupage que l'export
  // reprend en lignes de classeur, l'image ne montrerait pas grand-chose si tout le
  // planning tenait sur une seule bande.
  const A  = act('Spécification système', 3, 'Études', 60, 60);
  const B  = act('Architecture', 4, 'Études', 400, 60);
  const J1 = jalon('Revue de conception', 760, 60);
  const C  = act('Développement logiciel', 7, 'Réalisation', 400, 280);
  const J2 = jalon('Livraison prototype', 800, 280);
  const D  = act('Fabrication banc', 5, 'Réalisation', 400, 500);
  const E  = act('Intégration', 3, 'Qualification', 840, 720);
  const F  = act('Qualification', 4, 'Qualification', 1180, 720);
  const J3 = jalon('Mise en service', 1540, 720);
  link(A, B); link(A, C); link(A, D); link(B, J1);
  link(C, J2); link(C, E); link(D, E); link(E, F); link(F, J3);
  pertRecalc();
}

(async () => {
  for (const [outil, essai] of [['libreoffice', ['--version']], ['pdftoppm', ['-v']]]) {
    try { execFileSync(outil, essai, { stdio: 'ignore' }); }
    catch (e) {
      console.error('Prerequis manquant : ' + outil + '.');
      console.error('  Cette capture montre le CLASSEUR produit : il faut un tableur pour l\'ouvrir.');
      process.exit(2);
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pertflow-pd-'));

  const { browser, page } = await lib.launch();
  await lib.openApp(page);
  await page.evaluate(PLAN);
  const bytes = await page.evaluate(
    () => Array.from(pertBuildPlanningDirecteurXlsx(pertPlanningDirecteurModel())));
  await browser.close();

  const xlsx = path.join(tmp, 'planning_directeur.xlsx');
  fs.writeFileSync(xlsx, Buffer.from(bytes));
  execFileSync('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', tmp, xlsx],
               { stdio: 'ignore' });
  // 150 dpi : assez fin pour le manuel imprime, sans peser trois megaoctets.
  execFileSync('pdftoppm', ['-r', '150', '-png', '-cropbox', '-singlefile',
                            path.join(tmp, 'planning_directeur.pdf'), path.join(tmp, 'page')],
               { stdio: 'ignore' });

  // Recadrage sur le contenu : la page A3 produite est trop grande pour le planning
  // d'illustration, elle sortirait avec la moitie de sa surface en blanc.
  const src = path.join(tmp, 'page.png');
  const dst = path.join(OUT, 'planning-directeur.png');
  try {
    execFileSync('convert', [src, '-trim', '+repage', '-bordercolor', 'white', '-border', '12', dst],
        { stdio: 'ignore' });
  } catch (e) {
    fs.copyFileSync(src, dst);   // ImageMagick absent : on garde la page entiere
    console.log('  (ImageMagick absent : image non recadree)');
  }
  console.log('  ✓ planning-directeur.png');
  console.log('\nCapture v0.23 generee dans docs/images/manuel/');
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
