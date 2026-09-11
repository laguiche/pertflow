// Captures d'ecran pour le manuel — identite de revision (v0.26.1) :
//   - sauvegarde-fenetre.png   : la fenetre « Sauvegarder le planning » (nom, commentaire,
//                                rappel de la revision precedente) ;
//   - parametres-historique.png : l'onglet « Historique » des Parametres.
// L'historique affiche est POSE dans meta (dates et auteurs varies) : des sauvegardes
// reelles enchainees par le script tomberaient toutes dans la meme minute, et la capture
// ne montrerait pas a quoi ressemble un historique vivant. Le rendu, lui, est le vrai.
// Usage : node tools/doc-shots-revisions.js — sortie dans docs/images/manuel/.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1440, height: 900 } });
  await lib.openApp(page);

  // Le projet d'exemple du manuel, puis un historique de trois sauvegardes.
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btn-open')]);
  await fc.setFiles(path.join(lib.EXEMPLES, 'Nouveau_projet.pert'));
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    try { localStorage.setItem('pertflow.auteur', 'Bruno Petit'); } catch (e) {}
    const m = window.pertMeta;
    m.lot_id = 'p-mtw3k1az-7q2c9d';
    m.history = [
      { rev: 1, saved_at: '2026-09-02T09:15', saved_by: 'Alice Martin', comment: 'Premier jet du planning', fingerprint: '0a1b2c3d4e5f60' },
      { rev: 2, saved_at: '2026-09-04T16:40', saved_by: 'Alice Martin', comment: '', fingerprint: '1b2c3d4e5f6071' },
      { rev: 3, saved_at: '2026-09-10T11:05', saved_by: 'Bruno Petit', comment: 'Essais recalés d\'une semaine après la revue fournisseur', fingerprint: '2c3d4e5f607182' }
    ];
    m.revision = 3;
  });

  // 1) Fenetre de sauvegarde, commentaire en cours de saisie.
  await page.click('#btn-save');
  await page.waitForSelector('#save-dialog[style*="flex"]');
  await page.fill('#save-comment', 'Ajout du lot Industrialisation');
  await page.waitForTimeout(150);
  await (await page.$('.save-dialog-box')).screenshot({ path: path.join(OUT, 'sauvegarde-fenetre.png') });
  console.log('  ✓ sauvegarde-fenetre.png');
  await page.click('#save-cancel');

  // 2) Onglet Historique des Parametres.
  await page.evaluate(() => openSettings());
  await page.click('#settings-tabs .settings-tab[data-tab="historique"]');
  await page.waitForTimeout(200);
  await (await page.$('#settings-box')).screenshot({ path: path.join(OUT, 'parametres-historique.png') });
  console.log('  ✓ parametres-historique.png');

  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
