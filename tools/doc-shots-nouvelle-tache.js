// Capture d'ecran pour le manuel — reglage « Couleur des nouvelles tâches » (onglet Projet des
// Parametres) : couleur libre / rattachement a un groupe existant.
// La capture est prise en mode « groupe », le seul qui montre les DEUX lignes du
// reglage (le selecteur de groupe et sa pastille de couleur).
// Usage : node tools/doc-shots-nouvelle-tache.js — sortie dans docs/images/manuel/.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1440, height: 900 } });
  await lib.openApp(page);

  // Un projet plausible : deux groupes deja connus, dont un qui s'est approprie le
  // bleu historique — c'est precisement la situation qui rendait le bleu trompeur.
  await page.evaluate(() => {
    window.pertMeta.title = 'Ligne de conditionnement';
    window.pertMeta.groups = { 'WP1 Études': '#4A90D9', 'Essais': '#F5A623' };
    window.pertMeta.new_task_mode = 'groupe';
    window.pertMeta.new_task_group = 'Essais';
    openSettings();
  });
  await page.waitForTimeout(300);

  const box = await page.$('#settings-box');
  await box.screenshot({ path: path.join(OUT, 'parametres-nouvelle-tache.png') });
  console.log('  ✓ parametres-nouvelle-tache.png');

  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
