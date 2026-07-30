// Captures d'ecran pour le manuel utilisateur (docs/images/manuel/).
// Charge un PERT demo realiste (base pert_a_exporter, relabellise FR) et produit
// une serie de captures illustrant les fonctionnalites. Usage : node tools/doc-shots.js

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');

// Renommage vers un projet demo parlant (mappe les libelles d'origine).
const RELABEL = {
  'Jalon entrée': 'Cahier des charges',
  'Jalon entrée 2': 'Feu vert direction',
  'Activité 1': 'Étude algorithme',
  'Activité 2': 'Intégration système',
  'Activité 3': 'Développement logiciel',
  'Activité 4': 'Validation & essais',
  'Jalon sortie 1': 'Revue interne',
  'Jalon sortie 2': 'Livraison client',
};
const REGROUP = { sys: 'Logiciel', algo: 'Études' };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const pert = JSON.parse(fs.readFileSync(path.join(lib.EXEMPLES, 'pert_a_exporter.pert'), 'utf8'));

  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1440, height: 860 } });
  await lib.openApp(page);

  // ── Charge + habille le projet demo ──────────────────────────────────────────
  await page.evaluate((data) => {
    pertApplyProject(data);
    window.pertMeta.title = 'Projet démo — Nouveau produit';
    document.getElementById('project-title').textContent = window.pertMeta.title;
    // Renommage des groupes (conserve les couleurs)
    const REGROUP = { sys: 'Logiciel', algo: 'Études' };
    const g = window.pertGraph;
    const newGroups = {};
    Object.keys(window.pertMeta.groups || {}).forEach(k => {
      newGroups[REGROUP[k] || k] = window.pertMeta.groups[k];
    });
    window.pertMeta.groups = newGroups;
    const RELABEL = {
      'Jalon entrée': 'Cahier des charges', 'Jalon entrée 2': 'Feu vert direction',
      'Activité 1': 'Étude algorithme', 'Activité 2': 'Intégration système',
      'Activité 3': 'Développement logiciel', 'Activité 4': 'Validation & essais',
      'Jalon sortie 1': 'Revue interne', 'Jalon sortie 2': 'Livraison client',
    };
    g._nodes.forEach(n => {
      if (n.properties) {
        if (RELABEL[n.properties.label]) n.properties.label = RELABEL[n.properties.label];
        if (n.properties.group && REGROUP[n.properties.group]) n.properties.group = REGROUP[n.properties.group];
        if (n.updateSize) n.updateSize();
      }
    });
    // Un nœud Label pour illustrer la documentation libre
    const lab = LiteGraph.createNode('pert/label');
    lab.properties.text = 'Phase 1 — Conception\n(exemple de note libre)';
    lab.pos = [40, 40];
    g.add(lab);
    if (lab.updateSize) lab.updateSize();
    pertAutoLayout();
    pertRecalc();
  }, pert);
  await page.click('#btn-fit');
  await page.waitForTimeout(400);

  const shot = async (name, sel) => {
    await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.remove(); });
    const target = sel ? await page.$(sel) : page;
    await (target || page).screenshot({ path: path.join(OUT, name) });
    console.log('  ✓', name);
  };
  const centerOn = async (label, scale) => {
    await page.evaluate(({ label, scale }) => {
      const c = window.pertCanvas;
      const n = window.pertGraph._nodes.find(x => x.properties && x.properties.label === label);
      if (!n) return;
      window.pertCanvas.selectNode ? window.pertCanvas.selectNode(n, false) : null;
      const W = c.canvas.width, H = c.canvas.height;
      c.ds.scale = scale;
      c.ds.offset[0] = (W / 2) / scale - (n.pos[0] + n.size[0] / 2);
      c.ds.offset[1] = (H / 2) / scale - (n.pos[1] + n.size[1] / 2);
      if (window.pertHighlightCriticalPath) pertHighlightCriticalPath(null);
      c.setDirty(true, true);
    }, { label, scale });
    await page.waitForTimeout(300);
  };

  // ── 1) Aperçu général de l'application ───────────────────────────────────────
  await page.evaluate(() => { if (window.pertHighlightCriticalPath) pertHighlightCriticalPath(null); });
  await page.waitForTimeout(200);
  await shot('apercu-general.png');

  // ── 2) Planning seul (rendu propre fond blanc) ───────────────────────────────
  const dataUrl = await page.evaluate(() => {
    const r = window.pertRenderToCanvas();
    return r ? r.canvas.toDataURL('image/png') : null;
  });
  if (dataUrl) { fs.writeFileSync(path.join(OUT, 'planning-seul.png'), Buffer.from(dataUrl.split(',')[1], 'base64')); console.log('  ✓ planning-seul.png'); }

  // ── 3) Nœud Activité (gros plan) ─────────────────────────────────────────────
  await centerOn('Développement logiciel', 1.6);
  await shot('noeud-activite.png', '#pertCanvas');

  // ── 4) Nœud Jalon de sortie avec tag (gros plan) ─────────────────────────────
  await centerOn('Livraison client', 1.6);
  await shot('noeud-jalon.png', '#pertCanvas');

  // ── 5) Panneau propriétés (activité sélectionnée) ────────────────────────────
  await page.evaluate(() => {
    const n = window.pertGraph._nodes.find(x => x.properties && x.properties.label === 'Développement logiciel');
    if (n) { if (window.pertCanvas.selectNode) window.pertCanvas.selectNode(n, false); showProperties(n); }
    // L'onglet du panneau est memorise d'une selection a l'autre : on le force ici,
    // sinon la capture depend de l'onglet ouvert par une capture precedente.
    pertSelectPanelTab('proprietes');
  });
  await page.click('#btn-fit'); await page.waitForTimeout(300);
  await shot('panneau-proprietes.png');

  // ── 6) Dialogue Paramètres ───────────────────────────────────────────────────
  // Depuis le decoupage en onglets, une seule capture ne montre plus qu'un tiers des
  // reglages : on prend l'onglet Projet (celui qui s'ouvre par defaut) puis l'onglet
  // Affichage, qui porte la trame et son curseur d'intensite.
  await page.evaluate(() => { window.pertMeta.time_grid = true; openSettings(); });
  await page.waitForTimeout(250);
  await shot('parametres.png');
  await page.click('#settings-tabs .settings-tab[data-tab="affichage"]');
  await page.waitForTimeout(200);
  await shot('parametres-affichage.png');
  await page.evaluate(() => { document.getElementById('settings-dialog').style.display = 'none'; });

  // ── 7) Filtre par groupe actif (estompage) ───────────────────────────────────
  await page.evaluate(() => {
    window.pertFilter = { type: 'group', value: 'Logiciel' };
    if (window.updateFilterTrigger) updateFilterTrigger();
    window.pertGraph.setDirtyCanvas(true, true);
  });
  await page.click('#btn-fit'); await page.waitForTimeout(300);
  await shot('filtre.png');
  await page.evaluate(() => { window.pertFilter = null; if (window.updateFilterTrigger) updateFilterTrigger(); window.pertGraph.setDirtyCanvas(true, true); });

  // ── 8) Liens coudés (évitement) ──────────────────────────────────────────────
  await page.evaluate(() => { window.pertMeta.link_mode = 'coude'; pertApplyLinkMode(); if (window.pertHighlightCriticalPath) pertHighlightCriticalPath(null); });
  await page.click('#btn-fit'); await page.waitForTimeout(400);
  await shot('liens-coude.png', '#pertCanvas');
  await page.evaluate(() => { window.pertMeta.link_mode = 'courbe'; pertApplyLinkMode(); });

  // ── 9) Fenêtre d'export ──────────────────────────────────────────────────────
  await page.evaluate(() => pertOpenExportDialog());
  await page.waitForTimeout(250);
  await shot('fenetre-export.png');
  await page.evaluate(() => pertCloseExportDialog());

  console.log('Captures écrites dans', OUT);
  await browser.close();
})().catch(e => { console.error('ERREUR:', e.message); process.exit(1); });
