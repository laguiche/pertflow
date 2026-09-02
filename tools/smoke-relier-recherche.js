// Test cible : fenetre « Relier a… » (src/link_search.js) — creer un lien en
// DESIGNANT l'autre extremite par une recherche, sans naviguer dans le canvas.
//
// Ce qui est protege ici, et pourquoi :
//   - les DEUX points d'entree existent (menu contextuel du nœud, bouton du panneau)
//     et AUCUN n'est propose sur un Label, qui n'a ni entree ni sortie ;
//   - la recherche porte sur le nom ET les notes, les facettes groupe/responsable
//     restreignent — c'est tout l'interet du dispositif sur un planning fourni ;
//   - le clic cree un VRAI lien, vu par l'adjacence du MOTEUR (et pas seulement par
//     graph.links), et le PERT est recalcule dans la foulee ;
//   - le SENS est respecte : c'est la seule chose qu'un test d'etat ne devine pas, et
//     l'inverser produirait un planning silencieusement faux ;
//   - un candidat impossible (deja lie, ou qui refermerait une boucle) reste AFFICHE
//     mais n'est pas un bouton — ni clic, ni tabulation. Le cas « boucle » est le plus
//     couteux a laisser passer : le moteur ne calcule plus rien des qu'un cycle existe,
//     un seul clic suffirait donc a rendre tout le planning muet ;
//   - la fenetre RESTE ouverte apres un lien (on relie par rafales).
// Usage : node tools/smoke-relier-recherche.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // Graphe d'essai : trois Activites de deux groupes et deux responsables, un Jalon,
  // un Label. Aucun lien au depart — c'est la fenetre qui doit les creer.
  await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.t0 = '2026-01-05'; window.pertMeta.unit = 'j';
    window.pertMeta.groups = { 'WP1': '#4A90D9', 'WP2': '#7ED321' };
    const mk = (label, group, resp, dur, notes, x) => {
      const n = LiteGraph.createNode('pert/activity');
      n.properties.label = label; n.properties.group = group;
      n.properties.responsible = resp; n.properties.duration = dur;
      n.properties.notes = notes || '';
      n.updateSize(); g.add(n); n.pos = [x, 100];
      return n;
    };
    mk('Étude mécanique', 'WP1', 'Dupont', 3, '', 100);
    mk('Chiffrage', 'WP2', 'Martin', 2, 'a affiner apres la revue', 400);
    mk('Consultation', 'WP1', 'Dupont', 4, '', 700);
    const J = LiteGraph.createNode('pert/milestone');
    J.properties.label = 'Revue de lancement'; J.updateSize(); g.add(J); J.pos = [1000, 100];
    const L = LiteGraph.createNode('pert/label');
    L.properties.text = 'Hypothèse : chiffrage sous-traité'; g.add(L); L.pos = [100, 350];
    pertRecalc();
  });

  const par = async (nom) => page.evaluate((l) => {
    const n = window.pertGraph._nodes.find(x =>
      (x.properties.label || x.properties.text || '').indexOf(l) === 0);
    return n ? n.id : null;
  }, nom);

  const idEtude = await par('Étude');
  const idChiff = await par('Chiffrage');
  const idConsult = await par('Consultation');
  const idRevue = await par('Revue');
  const idLabel = await par('Hypothèse');

  // Ouvre la fenetre sur un nœud donne (chemin reel : la fonction du menu contextuel).
  const ouvrir = async (id) => page.evaluate((nid) => {
    const n = window.pertGraph._nodes.find(x => x.id === nid);
    window.pertOpenLinkSearch(n);
  }, id);

  const saisir = async (txt) => page.evaluate((t) => {
    const i = document.getElementById('linksearch-text');
    i.value = t; i.dispatchEvent(new Event('input'));
  }, txt);

  const facette = async (selId, val) => page.evaluate((a) => {
    const s = document.getElementById(a.selId);
    s.value = a.val; s.dispatchEvent(new Event('change'));
  }, { selId, val });

  const sens = async (dir) => page.evaluate((d) => {
    const i = d === 'succ' ? 0 : 1;
    document.querySelectorAll('#linksearch-dir .ls-dir-btn')[i].click();
  }, dir);

  // Etat lisible de la liste : pour chaque ligne, son libelle, son statut et si elle
  // est cliquable (un <button> l'est, un <div> non — c'est la forme qui porte la regle).
  const liste = async () => page.evaluate(() => ({
    ouverte: document.getElementById('linksearch-dialog').style.display === 'flex',
    titre: document.getElementById('linksearch-title').textContent,
    compteur: document.getElementById('linksearch-count').textContent,
    sens: Array.from(document.querySelectorAll('#linksearch-dir .ls-dir-btn'))
      .filter(b => b.classList.contains('active')).map(b => b.textContent.trim())[0],
    lignes: Array.from(document.querySelectorAll('#linksearch-list .ls-row')).map(r => ({
      nom: r.querySelector('.lk-name').textContent,
      bout: r.querySelector('.ls-tail').textContent,
      cliquable: r.tagName === 'BUTTON',
      taken: r.classList.contains('ls-taken'),
      cycle: r.classList.contains('ls-cycle'),
    })),
  }));

  // Adjacence vue par le MOTEUR (pas par graph.links) : c'est elle qui fait foi pour
  // le calcul, donc c'est elle qui doit voir le lien.
  const liens = async () => page.evaluate(() => {
    const { preds, succs } = pertBuildAdjacency(window.pertGraph);
    const nom = id => {
      const n = window.pertGraph._nodes.find(x => x.id === id);
      return n ? (n.properties.label || '') : '?';
    };
    const out = [];
    Object.keys(succs).forEach(src => succs[src].forEach(dst => {
      out.push(nom(Number(src)) + ' → ' + nom(dst));
    }));
    return out.sort();
  });

  const ko = [];
  const check = (cond, msg) => { if (!cond) ko.push(msg); };
  const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b),
    msg + '\n    attendu : ' + JSON.stringify(b) + '\n    obtenu  : ' + JSON.stringify(a));

  // ── 1) Points d'entree : menu contextuel et bouton du panneau ────────────────
  // Un Label ne se relie pas : ni l'un ni l'autre ne doit le proposer. Proposer une
  // action impossible coute plus cher que de ne rien proposer.
  const entrees = await page.evaluate((ids) => {
    const g = window.pertGraph;
    const menu = (nid) => {
      const n = g._nodes.find(x => x.id === nid);
      return (window.pertCanvas.getNodeMenuOptions(n) || [])
        .filter(Boolean).map(o => o.content).join(' | ');
    };
    const panneau = (nid) => {
      const n = g._nodes.find(x => x.id === nid);
      window.pertCanvas.selectNode(n);
      showProperties(n);
      return !!document.querySelector('#links-section .ls-panel-btn');
    };
    return {
      menuActivite: menu(ids.act).indexOf('Relier') !== -1,
      menuJalon: menu(ids.jal).indexOf('Relier') !== -1,
      menuLabel: menu(ids.lab).indexOf('Relier') !== -1,
      panneauActivite: panneau(ids.act),
      panneauJalon: panneau(ids.jal),
      panneauLabel: panneau(ids.lab),
    };
  }, { act: idEtude, jal: idRevue, lab: idLabel });
  eq(entrees, {
    menuActivite: true, menuJalon: true, menuLabel: false,
    panneauActivite: true, panneauJalon: true, panneauLabel: false,
  }, '1) Les deux points d\'entree doivent exister sur Activite et Jalon, et JAMAIS sur un Label');

  // ── 2) Contenu de la liste : ni le nœud courant, ni les Labels ───────────────
  await ouvrir(idEtude);
  let l = await liste();
  check(l.ouverte, '2) La fenetre doit etre ouverte');
  check(l.titre.indexOf('Étude mécanique') !== -1,
    '2) Le titre doit nommer le nœud relie, obtenu : ' + l.titre);
  eq(l.lignes.map(r => r.nom).sort(),
    ['Chiffrage', 'Consultation', 'Revue de lancement'],
    '2) La liste doit exclure le nœud courant et les Labels (aucun port a relier)');

  // ── 3) Recherche par nom ET par notes ────────────────────────────────────────
  await saisir('revue');
  l = await liste();
  // « Chiffrage » est trouve par ses NOTES (« a affiner apres la revue ») : une seule
  // recherche prouve les deux chemins de lecture.
  eq(l.lignes.map(r => r.nom).sort(), ['Chiffrage', 'Revue de lancement'],
    '3) La recherche doit porter sur le nom ET les notes');

  // ── 4) Facettes groupe / responsable ─────────────────────────────────────────
  await saisir('');
  await facette('linksearch-group', 'WP1');
  l = await liste();
  eq(l.lignes.map(r => r.nom), ['Consultation'],
    '4) La facette Groupe doit restreindre aux Activites du groupe (le Jalon sort)');
  await facette('linksearch-group', '');
  await facette('linksearch-resp', 'Martin');
  l = await liste();
  eq(l.lignes.map(r => r.nom), ['Chiffrage'],
    '4) La facette Responsable doit restreindre de la meme facon');
  await facette('linksearch-resp', '');

  // ── 5) Creation d'un lien : sens successeur ──────────────────────────────────
  // Etude (duree 3) → Chiffrage. Le sens est le point sensible : l'inverser donnerait
  // un planning credible mais faux.
  await saisir('chiffrage');
  await page.click('#linksearch-list .ls-row');
  await page.waitForTimeout(200);
  eq(await liens(), ['Étude mécanique → Chiffrage'],
    '5) Le clic doit creer le lien dans le sens « nœud courant → candidat »');
  const apres = await page.evaluate(() => {
    const n = window.pertGraph._nodes.find(x => (x.properties.label || '') === 'Chiffrage');
    return { es: n.es, ef: n.ef };
  });
  eq(apres, { es: 3, ef: 5 },
    '5) Le PERT doit etre recalcule apres creation du lien (Chiffrage tire par Etude)');

  // ── 6) La fenetre reste ouverte, et la ligne bascule en « deja lie » ─────────
  l = await liste();
  check(l.ouverte, '6) La fenetre doit RESTER ouverte apres un lien (on relie par rafales)');
  eq(l.lignes.map(r => ({ nom: r.nom, bout: r.bout, cliquable: r.cliquable, taken: r.taken })),
    [{ nom: 'Chiffrage', bout: 'déjà lié', cliquable: false, taken: true }],
    '6) Un candidat deja lie reste affiche, motive, et n\'est plus cliquable');

  // ── 7) Boucle : le candidat est affiche, motive, et non cliquable ────────────
  // Depuis Etude en sens PREDECESSEUR, prendre Chiffrage (son descendant) refermerait
  // le cycle. Le moteur ne calculerait alors plus RIEN : c'est le clic a ne jamais
  // laisser passer.
  await sens('pred');
  l = await liste();
  eq(l.sens, '↢ Prédécesseurs', '7) Le bouton de sens actif doit refleter le choix');
  const chiff = l.lignes.filter(r => r.nom === 'Chiffrage')[0];
  eq(chiff, { nom: 'Chiffrage', bout: 'boucle', cliquable: false, taken: false, cycle: true },
    '7) Un candidat qui refermerait une boucle reste affiche, motive, et non cliquable');

  // ── 8) Creation dans le sens predecesseur ────────────────────────────────────
  // Consultation (duree 4) → Etude. C'est bien le CANDIDAT qui devient l'amont.
  await saisir('consultation');
  await page.click('#linksearch-list .ls-row');
  await page.waitForTimeout(200);
  eq(await liens(),
    ['Consultation → Étude mécanique', 'Étude mécanique → Chiffrage'].sort(),
    '8) En sens predecesseur, c\'est le CANDIDAT qui devient l\'amont');
  const chaine = await page.evaluate(() => {
    const n = window.pertGraph._nodes.find(x => (x.properties.label || '') === 'Chiffrage');
    return { es: n.es, ef: n.ef };
  });
  eq(chaine, { es: 7, ef: 9 },
    '8) La chaine complete doit etre recalculee (4 + 3 = 7 jours ouvres avant Chiffrage)');

  // ── 9) Fermeture ─────────────────────────────────────────────────────────────
  await page.click('#linksearch-close');
  l = await liste();
  check(!l.ouverte, '9) Le bouton Fermer doit refermer la fenetre');

  await browser.close();

  if (errors.length) ko.push('Erreurs JS dans la page :\n    ' + errors.join('\n    '));
  if (ko.length) {
    console.error('ECHEC — ' + ko.length + ' probleme(s) :\n');
    ko.forEach(m => console.error('  ✗ ' + m + '\n'));
    process.exit(1);
  }
  console.log('OK — fenetre « Relier a… » : points d\'entree, recherche, facettes, sens,');
  console.log('     statuts (deja lie / boucle), recalcul PERT et rafales.');
})();
