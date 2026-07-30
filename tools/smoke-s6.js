// Tests cibles Session 6 : #34 (uid auto, unique, stable, dedoublonnage) et
// #2/#4/#14 (groupe WP/metier + registre de couleurs "premier venu fixe la teinte"
// + propagation au changement + serialisation .pert).
// Usage : node tools/smoke-s6.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // ── #34 : uid genere automatiquement, present et unique ───────────────────────
  const uid = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const A = LiteGraph.createNode('pert/activity'); g.add(A);
    const B = LiteGraph.createNode('pert/activity'); g.add(B);
    return { aHas: !!A.properties.uid, bHas: !!B.properties.uid, distinct: A.properties.uid !== B.properties.uid };
  });
  console.log('#34 uid auto:', uid);
  if (!uid.aHas || !uid.bHas) throw new Error('#34 : uid non genere a la creation');
  if (!uid.distinct) throw new Error('#34 : deux activites partagent le meme uid');

  // ── #34 : dedoublonnage apres clone (copie des properties → meme uid) ─────────
  const dedup = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const A = LiteGraph.createNode('pert/activity'); g.add(A);
    const clone = A.clone(); g.add(clone);            // recopie l'uid d'A
    const before = clone.properties.uid === A.properties.uid;
    pertEnsureUids();
    return { dupBeforeEnsure: before, distinctAfter: clone.properties.uid !== A.properties.uid };
  });
  console.log('#34 dedoublonnage:', dedup);
  if (!dedup.distinctAfter) throw new Error('#34 : uid encore duplique apres pertEnsureUids');

  // ── #14 : "premier venu fixe la teinte" + heritage ───────────────────────────
  const groupColor = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.groups = {};
    const A = LiteGraph.createNode('pert/activity'); A.properties.color = '#7ED321'; g.add(A);
    A.properties.group = 'Genie civil'; pertApplyGroup(A);   // 1er venu → fixe #7ED321
    const reg1 = window.pertMeta.groups['Genie civil'];

    const B = LiteGraph.createNode('pert/activity'); B.properties.color = '#000000'; g.add(B);
    B.properties.group = 'Genie civil'; pertApplyGroup(B);   // herite de la teinte
    return { registered: reg1, bInherited: B.properties.color };
  });
  console.log('#14 premier venu / heritage:', groupColor);
  if (groupColor.registered !== '#7ED321') throw new Error('#14 : le 1er venu n\'a pas fixe la teinte du groupe');
  if (groupColor.bInherited !== '#7ED321') throw new Error('#14 : la 2e activite n\'a pas herite de la teinte');

  // ── #4 : changer la couleur d'un membre recolore tout le groupe ──────────────
  const propagate = await page.evaluate(() => {
    const g = window.pertGraph;  // reutilise A + B du test precedent (meme groupe)
    pertGroups()['Genie civil'] = '#FF0000';
    pertRecolorGroup('Genie civil', '#FF0000');
    const cols = g._nodes.filter(n => n.type === 'pert/activity').map(n => n.properties.color);
    return { all: cols, allRed: cols.every(c => c === '#FF0000') };
  });
  console.log('#4 propagation couleur:', propagate);
  if (!propagate.allRed) throw new Error('#4 : la recoloration n\'a pas couvert tout le groupe');

  // ── Activite SANS groupe : couleur individuelle preservee (compat import) ─────
  const ungrouped = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.groups = {};
    const A = LiteGraph.createNode('pert/activity'); A.properties.color = '#123456'; A.properties.group = '';
    g.add(A); pertApplyGroup(A);
    return A.properties.color;
  });
  if (ungrouped !== '#123456') throw new Error('groupe vide : la couleur individuelle a ete alteree');

  // ── Propagation du groupe aux taches de MEME couleur (bouton explicite) ───────
  const byColor = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.groups = {};
    // 3 taches vertes (un "lot") + 1 bleue + 1 verte deja dans un autre groupe
    const mk = (color, group) => { const n = LiteGraph.createNode('pert/activity'); n.properties.color = color; if (group) n.properties.group = group; g.add(n); return n; };
    const A = mk('#7ED321');               // celle qu'on tague
    const B = mk('#7ED321');               // verte, sans groupe → doit etre rattachee
    const C = mk('#7ED321', 'Autre');      // verte, deja groupee → ecrasee (action deliberee)
    const D = mk('#0000FF');               // bleue → NON touchee
    A.properties.group = 'Genie civil';
    pertApplyGroupToSameColor(A);
    return {
      A: A.properties.group, B: B.properties.group, C: C.properties.group, D: D.properties.group,
      regGreen: window.pertMeta.groups['Genie civil']
    };
  });
  console.log('propagation par couleur:', byColor);
  if (byColor.B !== 'Genie civil') throw new Error('propagation : tache verte sans groupe non rattachee');
  if (byColor.D === 'Genie civil') throw new Error('propagation : tache d\'une AUTRE couleur touchee a tort');
  if (byColor.regGreen !== '#7ED321') throw new Error('propagation : groupe non enregistre dans le registre');

  // ── Serialisation .pert : uid + groupe + registre survivent au round-trip ─────
  const roundtrip = await page.evaluate(() => {
    const g = window.pertGraph; g.clear(); window.pertMeta.groups = {};
    const A = LiteGraph.createNode('pert/activity'); A.properties.color = '#50E3C2';
    A.properties.group = 'Soft'; g.add(A); pertApplyGroup(A);
    const savedUid = A.properties.uid;
    const data = window.pertSerializeProject();
    const json = JSON.parse(JSON.stringify(data)); // simule l'aller-retour disque
    window.pertApplyProject(json);
    const A2 = window.pertGraph._nodes.find(n => n.type === 'pert/activity');
    return {
      uidKept: A2 && A2.properties.uid === savedUid,
      groupKept: A2 && A2.properties.group === 'Soft',
      regKept: window.pertMeta.groups['Soft'] === '#50E3C2'
    };
  });
  console.log('round-trip .pert:', roundtrip);
  if (!roundtrip.uidKept) throw new Error('round-trip : uid non preserve');
  if (!roundtrip.groupKept) throw new Error('round-trip : groupe non preserve');
  if (!roundtrip.regKept) throw new Error('round-trip : registre de couleurs non preserve');

  await page.waitForTimeout(100);
  console.log('Erreurs console/page:', errors.length ? errors : 'aucune');
  if (errors.length) throw new Error('Erreurs JS detectees');

  await browser.close();
  console.log('\n=== SMOKE S6 OK ===');
})().catch(e => { console.error('SMOKE S6 FAIL:', e.message); process.exit(1); });
