// Génère, pour chaque document Markdown de docs/, une version HTML AUTONOME
// (images embarquées) ET un PDF. Le Markdown reste le format de base ; HTML et PDF
// en dérivent. Outillage de doc — hors livraison (les SORTIES docs/*.html / *.pdf
// sont versionnées).
//
// Prérequis : python-markdown (pip install markdown) + le Chromium de Playwright.
// Usage : node tools/build-docs.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const lib = require('./lib');

const DOCS = [
  { md: 'manuel-utilisateur.md', title: 'Manuel utilisateur — PertFlow' },
  { md: 'conception.md', title: 'Document de conception — PertFlow' },
  { md: 'maintenance.md', title: 'Document de maintenance — PertFlow' },
];

(async () => {
  const docsDir = path.join(lib.ROOT, 'docs');
  const helper = path.join(__dirname, '_md2html.py');

  // 1) MD → HTML autonome (Python + python-markdown), images en data-URI.
  for (const d of DOCS) {
    const mdPath = path.join(docsDir, d.md);
    const html = execFileSync('python3', [helper, mdPath, d.title], {
      encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024,
    });
    const outHtml = mdPath.replace(/\.md$/, '.html');
    fs.writeFileSync(outHtml, html);
    console.log('  ✓ HTML  ', path.basename(outHtml));
  }

  // 2) HTML → PDF (Chromium headless via Playwright).
  const { browser, page } = await lib.launch();
  for (const d of DOCS) {
    const htmlPath = path.join(docsDir, d.md.replace(/\.md$/, '.html'));
    const pdfPath = path.join(docsDir, d.md.replace(/\.md$/, '.pdf'));
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: pdfPath, format: 'A4', printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    console.log('  ✓ PDF   ', path.basename(pdfPath));
  }
  await browser.close();
  console.log('Documents générés (HTML autonome + PDF) dans', docsDir);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(1); });
