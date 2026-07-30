// Helpers partages pour piloter PertFlow dans un vrai navigateur (file://).
// Outillage de DEV : versionne, mais hors livraison (absent de l'archive de release).
//
// Le binaire Chromium est celui telecharge par Playwright dans ~/.cache/ms-playwright
// (persiste entre sessions). playwright-core est installe localement dans tools/.

const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// Jeux d'essai. Le repertoire est VERSIONNE fichier par fichier (liste blanche dans
// le .gitignore) : la suite doit pouvoir tourner sur un clone nu, mais rien ne doit
// pouvoir y entrer par megarde -- voir tools/README.md, « Jeux d'essai ».
const EXEMPLES = path.join(ROOT, 'test_cases');

// Planning CPERT (.xlsm) de reference : VOLONTAIREMENT hors depot. Les exports CPERT
// dont on dispose sont des plannings d'entreprise, ils ne peuvent pas etre publies.
// Les tests qui en dependent se desactivent proprement en son absence (cf.
// tools/README.md) ; pour les activer, deposer son propre export CPERT ici, ou
// pointer la variable d'environnement PERTFLOW_CPERT vers un autre fichier.
const CPERT = process.env.PERTFLOW_CPERT || path.join(EXEMPLES, 'C_PERT_exemple.xlsm');

function cpertPresent() { return fs.existsSync(CPERT); }

// Localise le binaire Chromium de Playwright (derniere version chromium-<n> presente).
function findChromium() {
  const base = path.join(process.env.HOME, '.cache', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base)
    .filter(d => /^chromium-\d+$/.test(d))
    .sort((a, b) => parseInt(b.split('-')[1]) - parseInt(a.split('-')[1]));
  for (const d of dirs) {
    const exe = path.join(base, d, 'chrome-linux64', 'chrome');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

// Lance un navigateur headless + page, prets a charger l'app.
async function launch(opts = {}) {
  const exe = findChromium();
  if (!exe) throw new Error('Chromium introuvable dans ~/.cache/ms-playwright (npx playwright install chromium)');
  const browser = await chromium.launch({ executablePath: exe, headless: opts.headless !== false });
  const ctx = await browser.newContext({
    acceptDownloads: true,
    viewport: opts.viewport || { width: 1400, height: 900 },
    deviceScaleFactor: opts.scale || 1,
  });
  const page = await ctx.newPage();
  return { browser, ctx, page };
}

// Ouvre index.html en file:// et attend l'initialisation de l'app.
async function openApp(page) {
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => window.pertGraph != null);
  await page.waitForTimeout(300);
}

// Ouvre la fenetre d'import (lot 2) et declenche le format demande, puis fournit le
// fichier au <input type="file"> masque. formatId : "cpert" | "pert".
async function pickImportFormat(page, formatId, filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  await page.click('#btn-import');
  await page.waitForSelector('#import-dialog[style*="flex"]');
  // Les lignes sont construites dynamiquement : on cible par le libelle du format.
  const idx = await page.evaluate((id) =>
    window.PERT_IMPORT_FORMATS.slice().sort((a, b) => (a.order || 0) - (b.order || 0))
      .findIndex(f => f.id === id), formatId);
  if (idx < 0) throw new Error('format d\'import inconnu : ' + formatId);
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click(`#import-format-list .import-format-row:nth-child(${idx + 1})`),
  ]);
  await fc.setFiles(abs);
}

// Importe un .xlsm via le bouton « Importer » → fenetre de format → CPERT.
// opts.unitChoice : "ignore" | "convert" | "cancel" si le dialogue d'unite apparait.
async function importXlsm(page, xlsmPath, opts = {}) {
  await pickImportFormat(page, 'cpert', xlsmPath);
  // Depuis l'evolution couleur-a-l'import : un dialogue de choix de couleur
  // s'intercale avant la concatenation. On valide la couleur presel. (1re libre).
  try {
    await page.waitForSelector('#color-dialog', { timeout: 2000 });
    await page.click('#color-dialog .dialog-buttons button.primary');
  } catch (e) { /* pas de dialogue (ancien flux) : on continue */ }
  await resolveUnitDialog(page, opts.unitChoice);
  await page.waitForTimeout(800);
}

// Importe un .pert par CONCATENATION (lot 2). opts.keep (defaut true) = conserver les
// groupes/couleurs du fichier ; opts.unitChoice comme ci-dessus.
async function importPert(page, pertPath, opts = {}) {
  await pickImportFormat(page, 'pert', pertPath);
  await page.waitForSelector('#color-dialog', { timeout: 3000 });
  if (opts.keep === false) {
    await page.click('#color-dialog input[name=import-group-mode][value=retag]');
    if (opts.group) await page.fill('#color-dialog input[type=text]', opts.group);
  }
  await page.click('#color-dialog .dialog-buttons button.primary');
  await resolveUnitDialog(page, opts.unitChoice);
  await page.waitForTimeout(800);
}

// Repond au dialogue d'arbitrage d'unite s'il s'affiche (lot 2). choice par defaut :
// "ignore" (l'unite du fichier est ignoree, aucune conversion).
async function resolveUnitDialog(page, choice) {
  try {
    await page.waitForSelector('#unit-dialog', { timeout: 1500 });
  } catch (e) { return false; }   // pas de divergence d'unite
  const label = { convert: 'Convertir les durées', cancel: 'Annuler l\'import' }[choice]
    || 'Unité d\'import ignorée';
  await page.click(`#unit-dialog .dialog-buttons button:text-is("${label}")`);
  return true;
}

// Ouvre une des deux fenetres de rapport via le bouton « Synthèse ▾ ». Depuis
// l'ajout du suivi d'avancement (29/07/2026) ce bouton n'ouvre plus directement la
// synthese : il deroule un sous-menu. Le geste est centralise ici pour que les tests
// passent par le VRAI chemin utilisateur sans le reecrire chacun de leur cote.
// quoi : "planification" (synthese) | "avancement" (suivi).
async function openSynthesisMenu(page, quoi) {
  const motif = quoi === "avancement" ? /Avancement/ : /Planification/;
  await page.click('#btn-synthesis');
  await page.waitForSelector('.litegraph.litecontextmenu .litemenu-entry');
  await page.evaluate((src) => {
    const re = new RegExp(src);
    Array.from(document.querySelectorAll('.litegraph.litecontextmenu .litemenu-entry'))
      .find(e => re.test(e.textContent)).click();
  }, motif.source);
  const dialog = quoi === "avancement" ? '#suivi-dialog' : '#synthesis-dialog';
  await page.waitForSelector(dialog + '[style*="flex"]');
}

module.exports = { ROOT, EXEMPLES, CPERT, cpertPresent,
                   findChromium, launch, openApp, importXlsm, importPert,
                   pickImportFormat, resolveUnitDialog, openSynthesisMenu };
