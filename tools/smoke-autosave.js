// Verifie la sauvegarde automatique / recuperation apres plantage :
//   - aucun snapshot tant que l'option est desactivee ;
//   - snapshot ecrit dans localStorage apres activation + edition ;
//   - dialogue de recuperation propose au rechargement (simulation de plantage) ;
//   - « Restaurer » recharge le travail et efface le snapshot ;
//   - « Ignorer » efface le snapshot et repart vierge ;
//   - round-trip de la preference meta.autosave (.pert + valeur par defaut).
// NB : l'ecriture est periodique (interval 8 s) → ce test comporte 2 attentes de 9 s.
const lib = require('./lib');
const KEY = 'pertflow.recovery.v1';

(async () => {
  const { browser, page } = await lib.launch();
  try {
    await lib.openApp(page);

    let key = await page.evaluate(k => localStorage.getItem(k), KEY);
    if (key) throw new Error('snapshot present alors qu\'aucun autosave');

    await page.evaluate(() => {
      window.pertMeta.autosave = true;
      window.pertAutosaveOnToggle();
      document.getElementById('btn-add-activity').click();
      document.getElementById('btn-add-milestone').click();
    });
    await page.waitForTimeout(9000);
    key = await page.evaluate(k => localStorage.getItem(k), KEY);
    if (!key) throw new Error('snapshot NON ecrit apres activation + edition');
    const snap = JSON.parse(key);
    if (snap.project.graph.nodes.length !== 2) throw new Error('snapshot incoherent (2 noeuds attendus)');
    console.log(`Snapshot ecrit : ${snap.project.graph.nodes.length} noeuds, ts=${!!snap.ts}`);

    await page.reload();
    await page.waitForFunction(() => window.pertGraph != null);
    await page.waitForTimeout(300);
    const dlg = await page.evaluate(() =>
      getComputedStyle(document.getElementById('recovery-dialog')).display !== 'none');
    if (!dlg) throw new Error('dialogue de recuperation non affiche apres reload');

    await page.click('#recovery-restore');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.pertGraph._nodes.length);
    if (after !== 2) throw new Error(`restauration KO (${after} != 2)`);
    key = await page.evaluate(k => localStorage.getItem(k), KEY);
    if (key) throw new Error('snapshot non efface apres restauration');
    console.log(`Restauration OK : ${after} noeuds, snapshot efface`);

    // Cas Ignorer
    await page.evaluate(() => {
      window.pertMeta.autosave = true;
      document.getElementById('btn-add-activity').click();
    });
    await page.waitForTimeout(9000);
    await page.reload();
    await page.waitForFunction(() => window.pertGraph != null);
    await page.waitForTimeout(300);
    await page.click('#recovery-ignore');
    await page.waitForTimeout(200);
    key = await page.evaluate(k => localStorage.getItem(k), KEY);
    const vierge = await page.evaluate(() => window.pertGraph._nodes.length === 0);
    if (key || !vierge) throw new Error('Ignorer : snapshot non efface ou graphe non vierge');
    console.log('Ignorer OK : snapshot efface, graphe vierge');

    // Round-trip preference .pert + defaut
    const rt = await page.evaluate(() => {
      window.pertMeta.autosave = true;
      const ser = window.pertSerializeProject();
      const savedKey = ser.meta.autosave;
      window.pertApplyProject({ version:'1.0', meta:{ ...ser.meta, autosave:false }, graph: ser.graph });
      const applyFalse = window.pertMeta.autosave;
      window.pertApplyProject({ version:'1.0', meta:{ title:'X', t0:'', unit:'j' }, graph: ser.graph });
      const legacy = window.pertMeta.autosave; // active par defaut (cle absente) → true
      return { savedKey, applyFalse, legacy };
    });
    if (rt.savedKey !== true || rt.applyFalse !== false || rt.legacy !== true)
      throw new Error('round-trip preference autosave incoherent');
    console.log('Round-trip preference OK (serialisee, apply, defaut true)');

    console.log('\n=== SMOKE AUTOSAVE OK ===');
  } catch (e) {
    console.error('SMOKE FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
