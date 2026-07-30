// Smoke test de validation PertFlow en navigateur reel (file://).
// Couvre : import Excel, persistance .pert, export PNG/PDF, copier-coller, Label.
// Usage : node tools/smoke.js
//
// L'etape 1 (import CPERT) n'est jouee que si un fichier CPERT est disponible : il
// n'y en a pas dans le depot, les exports CPERT reels etant des documents
// d'entreprise (cf. lib.CPERT et tools/README.md). A defaut, on repart de la fixture
// versionnee : les etapes 2 a 8 (persistance, exports, copier-coller, Label) ne
// dependent pas de la PROVENANCE du planning, elles restent donc pleinement valides.

const lib = require('./lib');
const path = require('path');
const fs = require('fs');

const DL = path.join(__dirname, '.smoke-out');
fs.mkdirSync(DL, { recursive: true });

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // 1) Import du PERT Excel de reference, ou repli sur la fixture versionnee
  if (lib.cpertPresent()) {
    await lib.importXlsm(page, lib.CPERT);
  } else {
    console.log('(1 ignore : aucun fichier CPERT — repli sur test_cases/pert_a_exporter.pert)');
    await lib.importPert(page, path.join(lib.EXEMPLES, 'pert_a_exporter.pert'));
  }
  const nbNodes = await page.evaluate(() => window.pertGraph._nodes.length);
  console.log('Noeuds importes:', nbNodes);
  if (nbNodes < 2) throw new Error('Import insuffisant');

  // 2) Sauvegarde .pert
  const [dlPert] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-save'),
  ]);
  const pertPath = path.join(DL, dlPert.suggestedFilename());
  await dlPert.saveAs(pertPath);
  const pertData = JSON.parse(fs.readFileSync(pertPath, 'utf8'));
  console.log('.pert:', dlPert.suggestedFilename(), '| v', pertData.version,
    '| unit', pertData.meta.unit, '| t0', pertData.meta.t0,
    '| nodes', pertData.graph.nodes.length, '| links', pertData.graph.links.length);
  if (!pertData.graph || !pertData.graph.nodes.length) throw new Error('Sauvegarde vide');

  // 3) Clear + rechargement -> integrite
  await page.evaluate(() => { window.pertGraph.clear(); window.pertRecalc(); });
  const [fc2] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#btn-open'),
  ]);
  await fc2.setFiles(pertPath);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.pertGraph._nodes.length);
  console.log('Rechargement:', after, 'noeuds');
  if (after !== nbNodes) throw new Error('Rechargement incoherent (' + after + ' != ' + nbNodes + ')');

  // 4) Export PNG (via la fenetre d'export unique — S9)
  await page.click('#btn-export');
  const [dlPng] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.export-format-row', { hasText: 'Image PNG' }).click(),
  ]);
  const pngPath = path.join(DL, dlPng.suggestedFilename());
  await dlPng.saveAs(pngPath);
  const pngSig = fs.readFileSync(pngPath).slice(0, 8).toString('hex');
  console.log('PNG:', fs.statSync(pngPath).size, 'octets, sig', pngSig);
  if (pngSig !== '89504e470d0a1a0a') throw new Error('PNG invalide');

  // 5) Export PDF (via la fenetre d'export unique — S9)
  await page.click('#btn-export');
  const [dlPdf] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.export-format-row', { hasText: 'Document PDF' }).click(),
  ]);
  const pdfPath = path.join(DL, dlPdf.suggestedFilename());
  await dlPdf.saveAs(pdfPath);
  const pdfHead = fs.readFileSync(pdfPath).slice(0, 5).toString();
  console.log('PDF:', fs.statSync(pdfPath).size, 'octets, entete', pdfHead);
  if (pdfHead !== '%PDF-') throw new Error('PDF invalide');

  // 6) Copier/coller
  const n0 = await page.evaluate(() => window.pertGraph._nodes.length);
  await page.evaluate(() => window.pertCanvas.selectNodes());
  await page.keyboard.press('Control+c');
  const box = await page.locator('#pertCanvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(300);
  const n1 = await page.evaluate(() => window.pertGraph._nodes.length);
  console.log('Copier/coller:', n0, '->', n1);
  if (n1 !== n0 * 2) throw new Error('Copier/coller: attendu ' + (n0 * 2) + ', obtenu ' + n1);

  // 7) Label updateSize
  await page.click('#btn-add-label');
  await page.waitForTimeout(150);
  const labelOk = await page.evaluate(() => {
    const lbl = window.pertGraph._nodes.find(n => n.type === 'pert/label');
    if (!lbl) return 'absent';
    const w0 = lbl.size[0];
    lbl.properties.text = 'Une note tres longue qui doit elargir la boite du label de facon visible';
    lbl.updateSize();
    return lbl.size[0] > w0 ? 'ok' : 'largeur inchangee';
  });
  console.log('Label updateSize:', labelOk);
  if (labelOk !== 'ok') throw new Error('Label: ' + labelOk);

  await page.waitForTimeout(150);
  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  if (errors.length) throw new Error('Erreurs JS detectees');

  await browser.close();
  console.log('\n=== SMOKE TEST OK ===');
})().catch(e => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
