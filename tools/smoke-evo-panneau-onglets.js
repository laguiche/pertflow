// Test cible : panneau lateral en DEUX onglets (Propriétés / Synthèse) + listes de
// predecesseurs et successeurs.
//   - repartition : les champs SAISIS d'un cote, les valeurs CALCULEES de l'autre ;
//   - le bouton Supprimer vit dans le pied du panneau et reste present/visible dans
//     les DEUX onglets (l'exigence explicite de la demande) ;
//   - l'onglet choisi est MEMORISE d'une selection de nœud a l'autre ;
//   - voisinage : contenu, tri chronologique, cas « aucun », exclusion des Labels,
//     et rafraichissement quand un lien est ajoute ou une duree modifiee ;
//   - clic sur un voisin → il devient le nœud selectionne et la vue se centre dessus ;
//   - le panneau masque n'est pas retire du DOM (fillCalcSection le retrouve par id).
// Usage : node tools/smoke-evo-panneau-onglets.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // Reseau de test : A → B et A → C, puis B → D et C → D (D a deux predecesseurs,
  // A deux successeurs). Un Label est pose a cote : il ne doit apparaitre nulle part.
  const build = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.t0 = '2026-01-05';
    window.pertMeta.unit = 'j';
    const mk = (label, dur, x) => {
      const n = LiteGraph.createNode('pert/activity');
      n.properties.label = label; n.properties.duration = dur;
      n.updateSize(); g.add(n); n.pos = [x, 100];
      return n;
    };
    const A = mk('Analyse', 5, 100);
    const B = mk('Banc de test', 10, 400);   // finit APRES C → doit se trier en second
    const C = mk('Chiffrage', 2, 400);
    const D = mk('Décision', 3, 700);
    const L = LiteGraph.createNode('pert/label');
    L.properties.text = 'note'; g.add(L); L.pos = [100, 400];

    // Les slots d'entree sont DYNAMIQUES (le dernier est toujours libre, cf.
    // manageDynamicInputs) : viser le slot 0 une seconde fois REMPLACE le premier
    // lien au lieu d'en ajouter un. On cible donc toujours le dernier slot.
    window.__link = (src, dst) => src.connect(0, dst, dst.inputs.length - 1);
    __link(A, B); __link(A, C);
    __link(B, D); __link(C, D);
    pertRecalc();
    window.__ids = { A: A.id, B: B.id, C: C.id, D: D.id, L: L.id };
    return { nodes: g._nodes.length, entreesD: D.inputs.filter(i => i.link !== null).length };
  });
  console.log('reseau :', build);

  // ── 1) Repartition des champs entre les deux onglets ─────────────────────────
  const split = await page.evaluate(() => {
    const g = window.pertGraph;
    const D = g._nodes.find(n => n.id === window.__ids.D);
    showProperties(D);
    const props = document.getElementById('properties-content');
    const synth = document.getElementById('properties-synthesis');
    const txt = el => el.textContent;
    return {
      // Saisie a gauche : les champs editables restent dans « Propriétés ».
      champsSaisis: props.querySelectorAll('input, textarea, select').length,
      propsAValeursCalculees: /Fin t\.tôt|Marge/.test(txt(props)),
      synthAValeursCalculees: /Fin t\.tôt/.test(txt(synth)) && /Marge/.test(txt(synth)),
      synthAVoisins: /Prédécesseurs/.test(txt(synth)) && /Successeurs/.test(txt(synth)),
      // Le bouton Supprimer n'est plus dans un onglet mais dans le pied du panneau.
      supprDansPied: !!document.querySelector('#properties-footer #btn-delete-node'),
      supprDansOnglet: !!props.querySelector('#btn-delete-node')
        || !!synth.querySelector('#btn-delete-node'),
      // Garde-fou : un id duplique ne leve AUCUNE erreur, getElementById rend
      // simplement le premier element du document. Le panneau a ainsi ecrit un temps
      // dans la fenetre de synthese globale, qui porte deja « synthesis-content » —
      // tests verts, onglet vide a l'ecran. On verifie donc l'unicite des ids, la
      // surface reellement occupee, et l'innocence de la modale.
      idsDupliques: (() => {
        const vus = {}, dup = [];
        document.querySelectorAll('[id]').forEach(el => {
          if (vus[el.id]) { if (dup.indexOf(el.id) === -1) dup.push(el.id); }
          vus[el.id] = true;
        });
        return dup;
      })(),
      syntheseVisible: (() => {
        pertSelectPanelTab('synthese');
        const r = document.getElementById('properties-synthesis').getBoundingClientRect();
        return r.width > 50 && r.height > 50;
      })(),
      modalePolluee: !!document.querySelector('#synthesis-dialog #synthesis-content')
        .textContent.trim()
    };
  });
  console.log('repartition :', split);
  if (split.idsDupliques.length)
    throw new Error('ids dupliques dans index.html : ' + split.idsDupliques.join(', ')
      + ' — getElementById rend le PREMIER du document, un panneau ecrirait dans l\'autre');
  if (!split.syntheseVisible)
    throw new Error('l\'onglet Synthèse doit occuper une vraie surface a l\'ecran');
  if (split.modalePolluee)
    throw new Error('le panneau ne doit pas ecrire dans la fenetre de synthese globale');
  if (!split.champsSaisis) throw new Error('l\'onglet Propriétés doit garder les champs de saisie');
  if (split.propsAValeursCalculees)
    throw new Error('les valeurs calculees ne doivent plus etre dans l\'onglet Propriétés');
  if (!split.synthAValeursCalculees)
    throw new Error('les valeurs calculees doivent etre dans l\'onglet Synthèse');
  if (!split.synthAVoisins)
    throw new Error('les predecesseurs/successeurs doivent etre dans l\'onglet Synthèse');
  if (!split.supprDansPied || split.supprDansOnglet)
    throw new Error('le bouton Supprimer doit vivre dans le pied du panneau');

  // ── 2) Le bouton Supprimer est visible dans les DEUX onglets ─────────────────
  const visible = async () => page.evaluate(() => {
    const b = document.getElementById('btn-delete-node');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  await page.click('#properties-tabs .prop-tab[data-tab="proprietes"]');
  const visProps = await visible();
  await page.click('#properties-tabs .prop-tab[data-tab="synthese"]');
  const visSynth = await visible();
  console.log('bouton Supprimer visible :', { proprietes: visProps, synthese: visSynth });
  if (!visProps || !visSynth)
    throw new Error('le bouton Supprimer doit rester visible dans les deux onglets');

  // ── 3) Persistance de l'onglet d'une selection a l'autre ─────────────────────
  const persist = await page.evaluate(() => {
    const g = window.pertGraph;
    const A = g._nodes.find(n => n.id === window.__ids.A);
    const D = g._nodes.find(n => n.id === window.__ids.D);
    // On est sur « Synthèse » (clic precedent) : changer de nœud ne doit pas ramener
    // a « Propriétés », sinon l'onglet serait inutilisable en navigation.
    showProperties(A);
    const apresA = document.querySelector('#properties-tabs .prop-tab.active').dataset.tab;
    showProperties(D);
    const apresD = document.querySelector('#properties-tabs .prop-tab.active').dataset.tab;
    const panneauActif = document.querySelector('#properties-body .prop-panel.active').dataset.panel;
    // Le panneau inactif reste dans le DOM (les fonctions de rafraichissement le
    // retrouvent par son id, meme masque).
    const inactifPresent = !!document.getElementById('properties-content');
    return { apresA, apresD, panneauActif, inactifPresent };
  });
  console.log('persistance onglet :', persist);
  if (persist.apresA !== 'synthese' || persist.apresD !== 'synthese')
    throw new Error('l\'onglet choisi doit etre conserve d\'une selection a l\'autre');
  if (persist.panneauActif !== 'synthese' || !persist.inactifPresent)
    throw new Error('le panneau inactif doit etre masque, pas retire du DOM');

  // ── 4) Contenu et tri des listes de voisins ──────────────────────────────────
  const voisins = await page.evaluate(() => {
    const g = window.pertGraph;
    const read = (id) => {
      const n = g._nodes.find(x => x.id === id);
      showProperties(n);
      const sec = document.getElementById('links-section');
      const titres = Array.from(sec.querySelectorAll('.calc-title')).map(t => t.textContent);
      const rows = Array.from(sec.querySelectorAll('.link-row')).map(r => ({
        nom: r.querySelector('.lk-name').textContent,
        date: r.querySelector('.lk-date').textContent,
        critique: r.classList.contains('lk-critical')
      }));
      const vides = Array.from(sec.querySelectorAll('.link-none')).map(p => p.textContent);
      // Position de chaque ligne par rapport aux deux titres, pour distinguer
      // predecesseurs et successeurs.
      const kids = Array.from(sec.children);
      const iSucc = kids.findIndex(k => /Successeurs/.test(k.textContent) && k.classList.contains('calc-title'));
      const preds = [], succs = [];
      kids.forEach((k, i) => {
        if (!k.classList.contains('link-row')) return;
        (i < iSucc ? preds : succs).push(k.querySelector('.lk-name').textContent);
      });
      return { titres, rows, vides, preds, succs };
    };
    return { A: read(window.__ids.A), D: read(window.__ids.D) };
  });
  console.log('voisins de A :', voisins.A.preds, '→', voisins.A.succs);
  console.log('voisins de D :', voisins.D.preds, '→', voisins.D.succs);
  if (voisins.A.preds.length !== 0 || !voisins.A.vides.length)
    throw new Error('A n\'a aucun predecesseur : la liste doit le dire explicitement');
  // B et C demarrent tous deux a la fin de A : a date egale, le tri retombe sur
  // l'ordre alphabetique, seul critere stable qui reste.
  if (voisins.A.succs.join('|') !== 'Banc de test|Chiffrage')
    throw new Error('successeurs mal tries (date puis libelle) — vu ' + voisins.A.succs.join('|'));
  if (voisins.D.preds.join('|') !== 'Chiffrage|Banc de test')
    throw new Error('les predecesseurs doivent etre tries par fin au plus tot — vu ' + voisins.D.preds.join('|'));
  if (voisins.D.succs.length !== 0)
    throw new Error('D ne doit avoir aucun successeur');
  if (JSON.stringify(voisins.D).includes('note'))
    throw new Error('un Label ne doit jamais apparaitre dans le voisinage');

  // ── 5) Un Label selectionne : onglet Synthèse explicite, pas vide ────────────
  const surLabel = await page.evaluate(() => {
    const L = window.pertGraph._nodes.find(n => n.id === window.__ids.L);
    showProperties(L);
    const synth = document.getElementById('properties-synthesis');
    return { texte: synth.textContent.trim().slice(0, 40),
             supprPresent: !!document.querySelector('#properties-footer #btn-delete-node') };
  });
  console.log('label :', surLabel);
  if (!surLabel.texte) throw new Error('l\'onglet Synthèse d\'un Label ne doit pas etre vide');
  if (!surLabel.supprPresent) throw new Error('un Label doit rester supprimable');

  // ── 6) Rafraichissement : nouveau lien, puis duree modifiee ─────────────────
  const refresh = await page.evaluate(() => {
    const g = window.pertGraph;
    const A = g._nodes.find(n => n.id === window.__ids.A);
    const D = g._nodes.find(n => n.id === window.__ids.D);
    const noms = () => Array.from(document.querySelectorAll('#links-section .link-row .lk-name'))
      .map(e => e.textContent);
    // Selection REELLE (et pas seulement showProperties) : le rafraichissement passe
    // par graph.onConnectionChange, qui relit canvas.selected_nodes.
    window.pertCanvas.selectNode(D);
    showProperties(D);
    const avant = noms();
    // Lien direct A → D ajoute : la liste doit s'enrichir sans reselection manuelle.
    // connect() declenche lui-meme graph.onConnectionChange (chemin de production).
    __link(A, D);
    const apres = noms();
    // Duree d'un predecesseur allongee : sa date affichee doit suivre.
    const B = g._nodes.find(n => n.id === window.__ids.B);
    const dateB = () => Array.from(document.querySelectorAll('#links-section .link-row'))
      .filter(r => r.querySelector('.lk-name').textContent === 'Banc de test')
      .map(r => r.querySelector('.lk-date').textContent)[0];
    const dateAvant = dateB();
    B.properties.duration = 40;
    pertRecalc();
    fillSynthesis(D);
    return { avant, apres, dateAvant, dateApres: dateB() };
  });
  console.log('rafraichissement :', refresh);
  if (refresh.apres.length !== refresh.avant.length + 1)
    throw new Error('l\'ajout d\'un lien doit se refleter dans la liste des voisins');
  if (refresh.dateAvant === refresh.dateApres)
    throw new Error('la date d\'un voisin doit suivre le recalcul PERT');

  // ── 7) Clic sur un voisin → selection + recentrage de la vue ─────────────────
  const nav = await page.evaluate(() => {
    const g = window.pertGraph;
    const D = g._nodes.find(n => n.id === window.__ids.D);
    showProperties(D);
    const offAvant = window.pertCanvas.ds.offset.slice();
    const row = Array.from(document.querySelectorAll('#links-section .link-row'))
      .find(r => r.querySelector('.lk-name').textContent === 'Analyse');
    row.click();
    const sel = Object.values(window.pertCanvas.selected_nodes || {});
    return {
      selectionne: sel.length === 1 ? sel[0].properties.label : null,
      panneauSuit: document.getElementById('properties-content')
        .querySelector('input').value,
      vueDeplacee: offAvant[0] !== window.pertCanvas.ds.offset[0]
        || offAvant[1] !== window.pertCanvas.ds.offset[1]
    };
  });
  console.log('navigation :', nav);
  if (nav.selectionne !== 'Analyse')
    throw new Error('cliquer un voisin doit le selectionner');
  if (nav.panneauSuit !== 'Analyse')
    throw new Error('le panneau doit suivre le nœud atteint');
  if (!nav.vueDeplacee)
    throw new Error('la vue doit se centrer sur le nœud atteint');

  if (errors.length) throw new Error('erreurs JS :\n' + errors.join('\n'));
  console.log('\nOK — panneau en onglets + voisinage valides');
  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
