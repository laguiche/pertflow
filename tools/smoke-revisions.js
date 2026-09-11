// Test cible : identite de revision d'un planning (v0.26.1, src/revisions.js) et
// identifiant stable sur les QUATRE types de nœuds.
//
// Ce qui est protege ici, et pourquoi :
//   - un fichier ANTERIEUR s'ouvre sans rien casser : revision 0, historique vide,
//     identite absente — et ses Jalons/Labels recoivent un uid (a-/j-/l-/r-), unique ;
//   - la sauvegarde par le VRAI geste (bouton → fenetre → Entree) inscrit revision,
//     auteur, commentaire et empreinte du graphe dans le fichier telecharge, et tire
//     l'identite du planning une fois pour toutes ;
//   - la revision n'avance QUE par la sauvegarde du fichier : ni la sauvegarde
//     automatique (pertSerializeProject), ni l'annulation (Ctrl+Z), ni une fenetre de
//     sauvegarde fermee par Echap — sinon la numerotation ne dirait plus rien ;
//   - Ctrl+S passe par la meme fenetre, le nom de l'auteur y est retenu d'une fois
//     sur l'autre (preference du poste) ;
//   - l'empreinte decrit le CONTENU : identique pour un graphe inchange, differente des
//     qu'on le modifie ;
//   - au rechargement, uid, identite et historique reviennent A L'IDENTIQUE — c'est la
//     propriete qui permettra de reconnaitre un nœud d'un fichier a l'autre ;
//   - un copier-coller ou un « Dupliquer » donne un NOUVEL uid au jalon (sinon deux
//     nœuds se confondraient) — et Ctrl+V ne colle qu'UNE copie : LiteGraph et ui.js
//     collaient chacun la leur, superposees donc invisibles (defaut du 11/09/2026) ; un import de .pert ne change pas l'identite du planning
//     ouvert ;
//   - un historique venu d'un fichier est une DONNEE : champs mal formes ecartes, et un
//     commentaire contenant du HTML est affiche tel quel, jamais interprete.
// Usage : node tools/smoke-revisions.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

const OLD_FILE = path.join(lib.EXEMPLES, 'test_6.pert');   // anterieur : 4 A, 4 J, 1 L

let failures = 0;
function check(cond, msg) {
  console.log((cond ? '  OK   ' : '  FAIL ') + msg);
  if (!cond) failures++;
}

(async () => {
  const DL = fs.mkdtempSync(path.join(os.tmpdir(), 'pertflow-rev-'));
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await lib.openApp(page);
  // Aucun nom retenu au depart : c'est le cas d'un poste neuf.
  await page.evaluate(() => { try { localStorage.removeItem('pertflow.auteur'); } catch (e) {} });

  const open = async (file) => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btn-open')]);
    await fc.setFiles(file);
    await page.waitForTimeout(400);
  };
  // Sauvegarde par le vrai geste ; `fill` = { author, comment } saisis dans la fenetre.
  const save = async (fill, viaCtrlS) => {
    if (viaCtrlS) {
      await page.click('#pertCanvas', { position: { x: 5, y: 5 } });
      await page.keyboard.press('Control+s');
    } else {
      await page.click('#btn-save');
    }
    await page.waitForSelector('#save-dialog[style*="flex"]');
    if (fill.author != null) await page.fill('#save-author', fill.author);
    if (fill.comment != null) await page.fill('#save-comment', fill.comment);
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.press('#save-comment', 'Enter'),
    ]);
    const out = path.join(DL, 'rev-' + Date.now() + '.pert');
    await dl.saveAs(out);
    return { file: out, data: JSON.parse(fs.readFileSync(out, 'utf8')) };
  };
  const uidsOf = (data) => data.graph.nodes.map(n => [n.type, n.properties && n.properties.uid]);

  // ── 1) Fichier anterieur ─────────────────────────────────────────────────────
  console.log('1) Fichier anterieur (sans identite de revision)');
  await open(OLD_FILE);
  const old = await page.evaluate(() => {
    const m = window.pertMeta;
    const nodes = window.pertGraph._nodes.map(n => ({ type: n.type, uid: n.properties.uid }));
    return { rev: m.revision, hist: m.history.length, lot: m.lot_id, nodes };
  });
  check(old.rev === 0 && old.hist === 0 && old.lot === '', 'revision 0, historique vide, identite absente');
  const prefix = { 'pert/activity': 'a-', 'pert/milestone': 'j-', 'pert/label': 'l-', 'pert/risk': 'r-' };
  check(old.nodes.length === 9 && old.nodes.every(n => typeof n.uid === 'string' && n.uid.indexOf(prefix[n.type]) === 0),
        'les 9 nœuds (Activites, Jalons, Label) ont un uid au bon prefixe');
  check(new Set(old.nodes.map(n => n.uid)).size === old.nodes.length, 'uid tous distincts');

  // ── 2) Premiere sauvegarde par le bouton ─────────────────────────────────────
  console.log('2) Premiere sauvegarde (bouton → fenetre → Entree)');
  const info1 = await (async () => {
    await page.click('#btn-save');
    await page.waitForSelector('#save-dialog[style*="flex"]');
    const t = await page.textContent('#save-rev-info');
    const focus = await page.evaluate(() => document.activeElement && document.activeElement.id);
    await page.keyboard.press('Escape');
    return { t, focus };
  })();
  check(/Première sauvegarde suivie/.test(info1.t) && /révision 1/.test(info1.t), 'la fenetre annonce la revision 1');
  check(info1.focus === 'save-author', 'nom inconnu sur ce poste → curseur dans le champ du nom');
  const afterEsc = await page.evaluate(() => ({
    shown: document.getElementById('save-dialog').style.display, rev: window.pertMeta.revision }));
  check(afterEsc.shown === 'none' && afterEsc.rev === 0, 'Echap ferme sans sauvegarder ni numeroter');

  const s1 = await save({ author: 'Alice Martin', comment: 'Premier jet du WP1' });
  const m1 = s1.data.meta;
  check(m1.revision === 1, 'fichier : revision 1');
  check(/^p-[a-z0-9]+-[a-z0-9]+$/.test(m1.lot_id), 'fichier : identite du planning tiree (' + m1.lot_id + ')');
  const e1 = m1.history && m1.history[0];
  check(m1.history.length === 1 && e1.rev === 1 && e1.saved_by === 'Alice Martin'
        && e1.comment === 'Premier jet du WP1', 'fichier : entree d\'historique (auteur, commentaire)');
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e1.saved_at), 'horodatage local AAAA-MM-JJTHH:MM');
  const fpNow = await page.evaluate(() => pertGraphFingerprint(window.pertGraph.serialize()));
  check(/^[0-9a-f]{14}$/.test(e1.fingerprint) && e1.fingerprint === fpNow, 'empreinte = celle du graphe sauvegarde');
  const uids1 = uidsOf(s1.data);
  check(uids1.every(([t, u]) => u && u.indexOf(prefix[t]) === 0), 'fichier : uid ecrits pour les 4 types');
  const auteurPoste = await page.evaluate(() => localStorage.getItem('pertflow.auteur'));
  check(auteurPoste === 'Alice Martin', 'nom de l\'auteur retenu sur le poste');

  // ── 3) Deuxieme sauvegarde par Ctrl+S, graphe inchange ───────────────────────
  console.log('3) Deuxieme sauvegarde (Ctrl+S), contenu inchange');
  await page.click('#pertCanvas', { position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+s');
  await page.waitForSelector('#save-dialog[style*="flex"]');
  const pre2 = await page.evaluate(() => ({
    author: document.getElementById('save-author').value,
    focus: document.activeElement && document.activeElement.id,
    info: document.getElementById('save-rev-info').textContent }));
  check(pre2.author === 'Alice Martin' && pre2.focus === 'save-comment',
        'Ctrl+S ouvre la fenetre, nom prerempli, curseur dans le commentaire');
  check(/révision 2/.test(pre2.info) && /Précédente : révision 1/.test(pre2.info) && /Alice Martin/.test(pre2.info),
        'la fenetre rappelle la revision precedente et son auteur');
  await page.keyboard.press('Escape');
  const s2 = await save({ comment: '' }, true);
  const m2 = s2.data.meta;
  check(m2.revision === 2 && m2.lot_id === m1.lot_id && m2.history.length === 2,
        'revision 2, meme identite, deux entrees');
  check(m2.history[1].comment === '' && m2.history[1].saved_by === 'Alice Martin', 'commentaire facultatif');
  check(m2.history[1].fingerprint === m2.history[0].fingerprint, 'graphe inchange → meme empreinte');

  // ── 4) Ni l'autosave ni l'annulation ne font avancer la revision ─────────────
  console.log('4) Revision insensible a l\'autosave et a l\'annulation');
  const r3 = await page.evaluate(() => {
    const before = window.pertMeta.revision;
    const snap = pertSerializeProject();
    // Une modification annulee : l'undo restaure l'etat, pas la revision.
    const n = window.pertGraph._nodes.find(x => x.type === 'pert/activity');
    n.properties.duration = (n.properties.duration || 1) + 3;
    if (window.pertHistoryMark) pertHistoryMark();
    pertUndo();
    return { before, after: window.pertMeta.revision, snapRev: snap.meta.revision,
             snapLot: snap.meta.lot_id === window.pertMeta.lot_id };
  });
  check(r3.before === 2 && r3.after === 2 && r3.snapRev === 2 && r3.snapLot,
        'serialisation (autosave) et Ctrl+Z laissent la revision a 2');

  // ── 5) Contenu modifie → empreinte differente ────────────────────────────────
  console.log('5) Contenu modifie');
  await page.evaluate(() => {
    const n = window.pertGraph._nodes.find(x => x.type === 'pert/activity');
    n.properties.duration = (n.properties.duration || 1) + 2;
    pertRecalc();
  });
  const s3 = await save({ comment: 'Essais recales' });
  check(s3.data.meta.revision === 3 && s3.data.meta.history[2].fingerprint !== s3.data.meta.history[1].fingerprint,
        'revision 3, empreinte differente');

  // ── 6) Rechargement : tout revient a l'identique ─────────────────────────────
  console.log('6) Rechargement du fichier sauvegarde');
  await page.evaluate(() => { window.pertGraph.clear(); window.pertMeta.revision = 0;
    window.pertMeta.history = []; window.pertMeta.lot_id = ''; });
  await open(s3.file);
  const back = await page.evaluate(() => ({
    rev: window.pertMeta.revision, lot: window.pertMeta.lot_id, hist: window.pertMeta.history.length,
    uids: window.pertGraph._nodes.map(n => [n.type, n.properties.uid]) }));
  check(back.rev === 3 && back.lot === m1.lot_id && back.hist === 3, 'revision, identite et historique restaures');
  const sorted = a => a.map(x => x.join('|')).sort().join(',');
  check(sorted(back.uids) === sorted(uidsOf(s3.data)), 'uid des 9 nœuds identiques a ceux du fichier');
  check(sorted(uidsOf(s3.data)) === sorted(uids1), 'uid stables d\'une sauvegarde a l\'autre');

  // ── 7) Onglet Historique des Parametres ──────────────────────────────────────
  console.log('7) Onglet Historique');
  await page.click('#btn-settings');
  await page.click('#settings-tabs .settings-tab[data-tab="historique"]');
  const panel = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('#settings-history-list .history-item'));
    const box = document.getElementById('settings-history-list').getBoundingClientRect();
    return {
      head: document.getElementById('settings-history-id').textContent,
      nums: items.map(i => i.querySelector('.history-num').textContent),
      first: items[0] && items[0].querySelector('.history-comment').textContent,
      none: items[1] && items[1].querySelector('.history-comment').classList.contains('none'),
      author: document.getElementById('settings-author').value,
      visible: box.width > 100 && box.height > 40
    };
  });
  check(/Révision 3/.test(panel.head) && panel.head.indexOf(m1.lot_id) !== -1, 'en-tete : revision et identifiant');
  check(panel.nums.join(',') === 'Rév. 3,Rév. 2,Rév. 1' && panel.first === 'Essais recales',
        'liste : la plus recente en tete, avec son commentaire');
  check(panel.none === true, 'une sauvegarde sans commentaire est signalee comme telle');
  check(panel.author === 'Alice Martin' && panel.visible, 'nom du poste affiche, liste reellement visible');
  // Le nom se change depuis l'onglet, et vaut pour la sauvegarde suivante.
  await page.fill('#settings-author', 'Bruno Petit');
  await page.click('#settings-ok');
  const s4 = await save({ comment: 'Relecture' });
  check(s4.data.meta.history[3].saved_by === 'Bruno Petit', 'nom modifie dans l\'onglet → auteur de la sauvegarde suivante');

  // ── 8) Copier-coller et Dupliquer d'un jalon → nouvel uid ────────────────────
  console.log('8) Copier-coller / Dupliquer');
  const dup = await page.evaluate(() => {
    const g = window.pertGraph;
    const j = g._nodes.find(n => n.type === 'pert/milestone');
    const l = g._nodes.find(n => n.type === 'pert/label');
    return { j: j.properties.uid, l: l.properties.uid, count: g._nodes.length };
  });
  // Le focus doit etre hors d'un champ : les raccourcis ignorent la frappe en saisie.
  await page.click('#pertCanvas', { position: { x: 5, y: 5 } });
  await page.evaluate((d) => {
    const g = window.pertGraph;
    const j = g._nodes.find(n => n.properties.uid === d.j);
    const l = g._nodes.find(n => n.properties.uid === d.l);
    window.pertCanvas.selectNodes([j, l]);
  }, dup);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(200);
  const pasted = await page.evaluate((d) => {
    const g = window.pertGraph;
    const all = g._nodes.map(n => n.properties.uid);
    return { count: g._nodes.length, unique: new Set(all).size === all.length,
             j: all.filter(u => u === d.j).length, l: all.filter(u => u === d.l).length,
             js: g._nodes.filter(n => n.type === 'pert/milestone').length };
  }, dup);
  check(pasted.count === dup.count + 2 && pasted.unique && pasted.j === 1 && pasted.l === 1,
        'Ctrl+C / Ctrl+V : UNE copie par nœud, et le jalon comme le label recoivent un nouvel uid');
  const cloned = await page.evaluate(() => {
    const g = window.pertGraph;
    const j = g._nodes.find(n => n.type === 'pert/milestone');
    const c = j.clone(); g.add(c); pertEnsureUids();
    return { differ: c.properties.uid !== j.properties.uid, prefix: c.properties.uid.slice(0, 2) };
  });
  check(cloned.differ && cloned.prefix === 'j-', 'Dupliquer : le clone d\'un jalon recoit un nouvel uid « j- »');

  // Creation par le vrai geste (menu « Insérer ») : le constructeur tire l'uid, sans
  // attendre qu'un chargement ou un collage passe par pertEnsureUids.
  await lib.insererNoeud(page, 'jalon');
  await lib.insererNoeud(page, 'label');
  const neufs = await page.evaluate(() => {
    const ns = window.pertGraph._nodes;
    return ns.slice(-2).map(n => [n.type, n.properties.uid || '']);
  });
  check(neufs.length === 2 && neufs.every(([t, u]) => u.indexOf(prefix[t]) === 0),
        'jalon et label crees par « Insérer » : uid des la creation');

  // ── 9) Import d'un .pert : l'identite du planning ouvert ne change pas ───────
  console.log('9) Import (concatenation)');
  const lotAvant = await page.evaluate(() => window.pertMeta.lot_id);
  await lib.importPert(page, s1.file);
  const imp = await page.evaluate(() => {
    const all = window.pertGraph._nodes.map(n => n.properties.uid);
    return { lot: window.pertMeta.lot_id, rev: window.pertMeta.revision, unique: new Set(all).size === all.length };
  });
  check(imp.lot === lotAvant && imp.rev === 4, 'identite et revision du planning ouvert conservees');
  check(imp.unique, 'uid toujours uniques apres l\'import du meme contenu');

  // ── 10) Historique venu d'un fichier : une donnee, filtree et jamais interpretee ─
  console.log('10) Historique mal forme ou hostile');
  const forged = JSON.parse(fs.readFileSync(s1.file, 'utf8'));
  forged.meta.lot_id = '<img src=x onerror=alert(1)>';
  forged.meta.revision = 'beaucoup';
  forged.meta.history = [
    null, 'texte', { rev: 'x' },
    { rev: 7, saved_at: '2026-09-01T08:00', saved_by: 'Eve', comment: '<b id="inj">gras</b>', fingerprint: 'ab' }
  ];
  const forgedFile = path.join(DL, 'forge.pert');
  fs.writeFileSync(forgedFile, JSON.stringify(forged));
  await open(forgedFile);
  await page.click('#btn-settings');
  await page.click('#settings-tabs .settings-tab[data-tab="historique"]');
  const hostile = await page.evaluate(() => ({
    rev: window.pertMeta.revision, lot: window.pertMeta.lot_id, hist: window.pertMeta.history.length,
    injected: !!document.getElementById('inj'),
    shown: (document.querySelector('#settings-history-list .history-comment') || {}).textContent
  }));
  await page.click('#settings-cancel');
  check(hostile.hist === 1 && hostile.rev === 7, 'entrees mal formees ecartees, revision recalee sur l\'historique');
  check(hostile.lot === '', 'identite mal formee ignoree (une nouvelle sera tiree a la sauvegarde)');
  check(!hostile.injected && hostile.shown === '<b id="inj">gras</b>', 'commentaire HTML affiche tel quel, jamais interprete');

  check(errors.length === 0, 'aucune erreur JS' + (errors.length ? ' : ' + errors.join(' | ') : ''));
  await browser.close();
  fs.rmSync(DL, { recursive: true, force: true });
  console.log(failures ? `\nECHEC : ${failures} verification(s) en defaut` : '\nOK : identite de revision conforme');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
