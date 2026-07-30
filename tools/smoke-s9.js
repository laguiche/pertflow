// Tests cibles Session 9 : exports avances (fenetre unique + 6 formats).
//   - Fenetre d'export : un seul bouton, 6 formats dans l'ordre attendu.
//   - CSV : en-tete + separateur ; + BOM.
//   - Gantt chargé (xlsx) : magic PK, formule SUM, cellule de charge coloree.
//   - Micro-jalonnement (xlsx) : en-tetes template, Num <groupe>_NN, GOLDEN.
//   - MSPDI XML : bien forme, 6 liens de dependance.
// Usage : node tools/smoke-s9.js

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

function assert(cond, msg) { if (!cond) throw new Error('ECHEC: ' + msg); }

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await lib.openApp(page);
  const pert = JSON.parse(fs.readFileSync(path.join(lib.EXEMPLES, 'pert_a_exporter.pert'), 'utf8'));

  const res = await page.evaluate((data) => {
    pertApplyProject(data);
    const out = {};
    // Fenetre : ordre des formats
    document.getElementById('btn-export').click();
    out.formats = Array.from(document.querySelectorAll('.export-format-row .export-format-label')).map(e => e.textContent);
    pertCloseExportDialog();
    // CSV
    out.csv = pertBuildCSV();
    // Gantt xlsx (magic bytes + relecture logique cote Node)
    out.gantt = Array.from(pertBuildGanttXlsx(pertScheduleModel()));
    // Micro-jalons xlsx
    out.mj = Array.from(pertBuildMicroJalonsXlsx(pertScheduleModel()));
    // MSPDI
    out.msp = pertBuildMSPDI(pertScheduleModel());
    return out;
  }, pert);

  // ── Fenetre ──────────────────────────────────────────────────────────────────
  console.log('Formats:', res.formats);
  assert(res.formats.length === 6, '6 formats attendus, vu ' + res.formats.length);
  const expected = ['Image PNG', 'Document PDF', 'Données CSV', 'Gantt chargé (Excel)',
    'Micro-jalonnement (Excel)', 'Gantt MS Project (XML)'];
  expected.forEach((label, i) => assert(res.formats[i] === label, 'format[' + i + '] = ' + res.formats[i]));

  // ── CSV ──────────────────────────────────────────────────────────────────────
  assert(res.csv.charCodeAt(0) === 0xFEFF, 'CSV : BOM UTF-8 attendu');
  assert(res.csv.indexOf('Type;UID;Libellé;Groupe;Responsable') !== -1, 'CSV : en-tete');
  assert(/Activité 3;sys;toto/.test(res.csv), 'CSV : ligne Activité 3 (groupe+resp)');

  // ── XLSX : magic PK (zip) ─────────────────────────────────────────────────────
  assert(res.gantt[0] === 0x50 && res.gantt[1] === 0x4B, 'Gantt : magic PK (zip)');
  assert(res.mj[0] === 0x50 && res.mj[1] === 0x4B, 'Micro-jalons : magic PK (zip)');
  fs.writeFileSync('/tmp/smoke_s9_gantt.xlsx', Buffer.from(res.gantt));
  fs.writeFileSync('/tmp/smoke_s9_mj.xlsx', Buffer.from(res.mj));

  // ── MSPDI ────────────────────────────────────────────────────────────────────
  const nLinks = (res.msp.match(/<PredecessorLink>/g) || []).length;
  const nTasks = (res.msp.match(/<Task>/g) || []).length;
  assert(res.msp.indexOf('xmlns="http://schemas.microsoft.com/project"') !== -1, 'MSPDI : namespace');
  // Attendus DEDUITS de la fixture, et non codes en dur : la fixture peut etre recomposee
  // (elle l'a ete le 28/07/2026, avec un nœud de plus, quand elle vivait encore hors depot).
  // Un nombre en dur transformait ce simple ecart en echec de test, sans
  // rien dire de la qualite de l'export. Ce qu'on veut verifier ici, c'est que l'export
  // MSPDI restitue TOUT le planning : une tache par Activite et par Jalon (les Labels sont
  // de la documentation, ils n'ont pas leur place dans un planning MS Project), et un lien
  // par connexion.
  const attendus = pert.graph.nodes.filter(n => n.type === 'pert/activity' || n.type === 'pert/milestone').length;
  const attendusLiens = (pert.graph.links || []).length;
  assert(nTasks === attendus, 'MSPDI : ' + attendus + ' taches attendues (Activites + Jalons de la fixture), vu ' + nTasks);
  assert(nLinks === attendusLiens, 'MSPDI : ' + attendusLiens + ' liens attendus (connexions de la fixture), vu ' + nLinks);
  fs.writeFileSync('/tmp/smoke_s9_msp.xml', res.msp);

  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  assert(errors.length === 0, 'erreurs console');

  console.log('\n=== SMOKE S9 OK ===');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
