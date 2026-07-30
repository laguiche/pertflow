// Capture d'ecran de PertFlow — pour illustrations de documentation.
//
// Usage :
//   node tools/screenshot.js <sortie.png> [--xlsm <fichier.xlsm>] [--graph|--app] [--no-fit] [--scale N]
//
//   --app   (defaut) capture l'application complete (toolbar + canvas + panneau + statut)
//   --graph capture le planning SEUL (rendu hors-ecran, fond blanc) — ideal pour
//           illustrer un diagramme PERT sans le chrome de l'UI
//   --xlsm  importe d'abord un planning Excel legacy (sinon canvas vide)
//   --no-fit  ne pas faire de zoom-to-fit avant la capture
//   --scale N  facteur de resolution (defaut 2 pour des captures nettes en --app)

const lib = require('./lib');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const a = { out: null, xlsm: null, mode: 'app', fit: true, scale: 2 };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--xlsm') a.xlsm = argv[++i];
    else if (t === '--graph') a.mode = 'graph';
    else if (t === '--app') a.mode = 'app';
    else if (t === '--no-fit') a.fit = false;
    else if (t === '--scale') a.scale = parseFloat(argv[++i]) || 2;
    else if (!a.out) a.out = t;
  }
  return a;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    console.error('Usage: node tools/screenshot.js <sortie.png> [--xlsm <fichier.xlsm>] [--graph|--app] [--no-fit] [--scale N]');
    process.exit(1);
  }

  const { browser, page } = await lib.launch({ scale: args.mode === 'app' ? args.scale : 1 });
  await lib.openApp(page);
  if (args.xlsm) await lib.importXlsm(page, args.xlsm);
  if (args.fit) { await page.click('#btn-fit'); await page.waitForTimeout(300); }

  const outAbs = path.isAbsolute(args.out) ? args.out : path.join(process.cwd(), args.out);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });

  if (args.mode === 'graph') {
    // Planning seul via le rendu hors-ecran de l'app (meme code que l'export PNG)
    const dataUrl = await page.evaluate(() => {
      const r = window.pertRenderToCanvas();
      return r ? r.canvas.toDataURL('image/png') : null;
    });
    if (!dataUrl) { console.error('Graphe vide — rien a capturer'); process.exit(1); }
    fs.writeFileSync(outAbs, Buffer.from(dataUrl.split(',')[1], 'base64'));
  } else {
    await page.screenshot({ path: outAbs });
  }

  console.log('Capture ecrite :', outAbs);
  await browser.close();
})().catch(e => { console.error('ERREUR:', e.message); process.exit(1); });
