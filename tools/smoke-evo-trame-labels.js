// Tests cibles : trame temporelle de fond + aimantation des Labels sur les bords.
//   - trame : desactivee par defaut, activee par la case des Parametres, serialisee
//     dans meta (sauvegarde / rechargement / undo), et bornes de periodes calculees
//     en CALENDRIER dans les trois unites (mois → annees, sem → mois, j → semaines)
//   - trame : rendu effectif teste AU PIXEL — une case a cocher qui ne dessine rien
//     passerait tous les tests d'etat (piege deja rencontre avec le repere T0 : un
//     module qui AFFECTE onDrawBackground ecrase silencieusement les precedents)
//   - aimantation : un Label lache pres du bord d'une tache s'y aligne exactement ;
//     une Activite, elle, ne doit JAMAIS etre aimantee (son abscisse porte le temps)
// Usage : node tools/smoke-evo-trame-labels.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  // ── 1) Trame : etat par defaut + bascule + serialisation ──────────────────────
  const state = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const m = window.pertMeta;
    m.t0 = '2026-01-05'; m.unit = 'mois'; m.title = 'Trame';
    const A = LiteGraph.createNode('pert/activity');
    A.properties.duration = 30; g.add(A); A.pos = [100, 100];
    pertRecalc();

    const before = pertTimeGridEnabled();
    // Passage par la vraie case des Parametres (et non par meta directement) :
    // c'est le chemin utilisateur, donc celui qui doit etre teste.
    openSettings();
    document.getElementById('settings-timegrid').checked = true;
    saveSettings();
    const after = pertTimeGridEnabled();

    // Serialisation .pert : la trame suit le fichier.
    const saved = pertSerializeProject();
    return {
      before, after,
      inFile: saved && saved.meta ? saved.meta.time_grid : null,
    };
  });
  console.log('trame (etat):', state);
  if (state.before !== false) throw new Error('la trame doit etre desactivee par defaut');
  if (state.after !== true) throw new Error('la case des Parametres n\'active pas la trame');
  if (state.inFile !== true) throw new Error('la trame n\'est pas serialisee dans le .pert');

  // ── 2) Trame : bornes de periodes dans les trois unites ───────────────────────
  // On verifie que le decoupage est CALENDAIRE : premier janvier / premier du mois /
  // lundi, et non un pas fixe en pixels (qui deriverait sur les mois inegaux et sur
  // l'unite « jour », ou l'axe compte les jours OUVRES).
  const scheme = await page.evaluate(() => {
    const out = {};
    const probe = new Date(2026, 4, 20);         // 20 mai 2026, un mercredi
    // Formatage en heure LOCALE : toISOString() convertirait en UTC et reculerait ces
    // dates a minuit local d'une journee pour tout fuseau a l'est de Greenwich —
    // exactement le piege que pertTgIso evite cote source.
    const iso = (d) => d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    ['mois', 'sem', 'j'].forEach(u => {
      const s = pertTimeGridScheme(u);
      const b = s.band.start(probe);
      const n = s.band.next(b);
      out[u] = { start: iso(b), next: iso(n), label: s.band.label(b) };
    });
    return out;
  });
  console.log('trame (decoupage):', scheme);
  if (scheme.mois.start !== '2026-01-01' || scheme.mois.next !== '2027-01-01')
    throw new Error('unite mois : bandes attendues sur l\'ANNEE calendaire, obtenu ' + JSON.stringify(scheme.mois));
  if (scheme.mois.label !== '2026') throw new Error('libelle d\'annee attendu, obtenu ' + scheme.mois.label);
  if (scheme.sem.start !== '2026-05-01' || scheme.sem.next !== '2026-06-01')
    throw new Error('unite sem : bandes attendues sur le MOIS calendaire, obtenu ' + JSON.stringify(scheme.sem));
  if (scheme.j.start !== '2026-05-18' || scheme.j.next !== '2026-05-25')
    throw new Error('unite j : bandes attendues du LUNDI au lundi, obtenu ' + JSON.stringify(scheme.j));

  // ── 3) Trame : rendu reellement present dans le canvas ────────────────────────
  // Test AU PIXEL et non de simple presence du handler : un module installe avant
  // un autre qui AFFECTE onDrawBackground serait ecrase sans la moindre erreur.
  // On compare le fond hors nœuds, trame active puis desactivee.
  const pixels = await page.evaluate(async () => {
    const cv = document.getElementById('pertCanvas');
    const read = () => {
      const c = document.createElement('canvas');
      c.width = cv.width; c.height = cv.height;
      c.getContext('2d').drawImage(cv, 0, 0);
      // Somme sur TOUT le canvas : la trame ne couvre que l'emprise du graphe (+ marge),
      // pas la totalite de la vue — echantillonner une seule ligne, choisie au hasard,
      // risquerait de tomber hors bande et de conclure a tort que rien n'est dessine.
      // Les nœuds, identiques d'une capture a l'autre, s'annulent dans la difference.
      const d = c.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum;
    };
    const redraw = () => new Promise(r => {
      window.pertCanvas.setDirty(true, true);
      window.pertCanvas.draw(true, true);
      requestAnimationFrame(() => requestAnimationFrame(r));
    });
    window.pertMeta.time_grid = true;  await redraw();
    const withGrid = read();
    window.pertMeta.time_grid = false; await redraw();
    const without = read();
    return { withGrid, without };
  });
  console.log('trame (pixels):', pixels);
  if (pixels.withGrid === pixels.without)
    throw new Error('la trame ne dessine rien : fond identique avec et sans (handler ecrase ?)');
  if (pixels.withGrid < pixels.without)
    throw new Error('la trame assombrit le fond au lieu de l\'eclaircir (teinte inattendue)');

  // ── 3bis) Onglets des Parametres + curseur d'intensite ────────────────────────
  // Le piege du decoupage en onglets : un champ d'un onglet jamais ouvert doit rester
  // lu et ecrit par saveSettings(). On verifie donc qu'un aller-retour par le
  // dialogue, en ne touchant QU'A l'onglet Affichage, ne perd aucun autre reglage.
  const onglets = await page.evaluate(() => {
    const out = {};
    const meta = window.pertMeta;
    meta.title = 'Projet Onglets'; meta.hourly_rate = 200; meta.layout_gap = 45;
    meta.time_grid = true; meta.time_grid_intensity = 1;

    openSettings();
    const tabs = Array.from(document.querySelectorAll('#settings-tabs .settings-tab'));
    out.noms = tabs.map(t => t.dataset.tab);
    const visibles = () => document.querySelectorAll('#settings-box .settings-panel.active').length;
    out.unSeulPanneau = visibles();

    // Bascule sur « Affichage » et pousse l'intensite a 300 %.
    tabs.find(t => t.dataset.tab === 'affichage').click();
    out.panneauActif = document.querySelector('#settings-box .settings-panel.active').dataset.panel;
    out.champCoutMasque = document.getElementById('settings-hpm').offsetParent === null;
    document.getElementById('settings-timegrid-intensity').value = 300;
    document.getElementById('settings-timegrid-intensity')
      .dispatchEvent(new Event('input', { bubbles: true }));
    out.libelle = document.getElementById('settings-timegrid-val').textContent;
    saveSettings();

    out.apres = {
      intensite: meta.time_grid_intensity,
      titre: meta.title,           // onglet Projet, jamais ouvert
      taux: meta.hourly_rate,      // onglet Couts, jamais ouvert
      gap: meta.layout_gap,
    };
    // L'onglet actif est-il memorise d'une ouverture a l'autre ?
    openSettings();
    out.ongletMemorise = document.querySelector('#settings-box .settings-panel.active').dataset.panel;
    document.getElementById('settings-cancel').click();
    return out;
  });
  console.log('onglets:', onglets);
  if (onglets.noms.join(',') !== 'projet,affichage,couts')
    throw new Error('onglets attendus projet/affichage/couts, obtenu ' + onglets.noms.join(','));
  if (onglets.unSeulPanneau !== 1) throw new Error('un seul panneau doit etre visible a la fois');
  if (onglets.panneauActif !== 'affichage') throw new Error('le clic d\'onglet ne bascule pas le panneau');
  if (!onglets.champCoutMasque) throw new Error('les champs des autres onglets doivent etre masques');
  if (onglets.libelle !== '300 %') throw new Error('libelle du curseur attendu « 300 % », obtenu ' + onglets.libelle);
  if (Math.abs(onglets.apres.intensite - 3) > 1e-9)
    throw new Error('intensite attendue 3, obtenue ' + onglets.apres.intensite);
  if (onglets.apres.titre !== 'Projet Onglets' || onglets.apres.taux !== 200 || onglets.apres.gap !== 45)
    throw new Error('un reglage d\'un onglet non ouvert a ete perdu : ' + JSON.stringify(onglets.apres));
  if (onglets.ongletMemorise !== 'affichage')
    throw new Error('l\'onglet actif doit etre memorise, obtenu ' + onglets.ongletMemorise);

  // ── 3ter) L'intensite change reellement le rendu ──────────────────────────────
  const intensite = await page.evaluate(async () => {
    const cv = document.getElementById('pertCanvas');
    const g = window.pertGraph; g.clear();
    window.pertMeta.t0 = '2026-01-05'; window.pertMeta.unit = 'mois';
    const A = LiteGraph.createNode('pert/activity');
    A.properties.duration = 30; g.add(A); A.pos = [100, 100];
    pertRecalc();
    window.pertMeta.time_grid = true;
    const sum = () => {
      const c = document.createElement('canvas');
      c.width = cv.width; c.height = cv.height;
      c.getContext('2d').drawImage(cv, 0, 0);
      const d = c.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return s;
    };
    const redraw = () => new Promise(r => {
      window.pertCanvas.setDirty(true, true); window.pertCanvas.draw(true, true);
      requestAnimationFrame(() => requestAnimationFrame(r));
    });
    window.pertMeta.time_grid_intensity = 1;   await redraw(); const faible = sum();
    window.pertMeta.time_grid_intensity = 3;   await redraw(); const fort = sum();
    // Valeurs aberrantes (fichier .pert edite a la main, ou champ vide) : bornees, et
    // non appliquees telles quelles — sinon le fond devient opaque ou la trame dispara"it.
    const bornes = {
      enorme: (window.pertMeta.time_grid_intensity = 999, pertTimeGridIntensity()),
      negatif: (window.pertMeta.time_grid_intensity = -5, pertTimeGridIntensity()),
      absent: (window.pertMeta.time_grid_intensity = undefined, pertTimeGridIntensity()),
      texte: (window.pertMeta.time_grid_intensity = "beaucoup", pertTimeGridIntensity()),
    };
    window.pertMeta.time_grid_intensity = 1;
    return { faible, fort, bornes };
  });
  console.log('intensite:', intensite);
  if (!(intensite.fort > intensite.faible))
    throw new Error('monter l\'intensite doit rendre la trame plus visible');
  const b = intensite.bornes;
  if (b.enorme !== 4) throw new Error('intensite enorme non bornee a 4 : ' + b.enorme);
  if (b.negatif !== 0.2) throw new Error('intensite negative non bornee a 0,2 : ' + b.negatif);
  if (b.absent !== 1 || b.texte !== 1)
    throw new Error('intensite absente ou non numerique doit retomber a 1 : ' + JSON.stringify(b));

  // ── 3quater) v0.18.1 : libelle de periode en filigrane + date « A propos » ────
  const v0181 = await page.evaluate(() => {
    const out = {};
    // Taille du libelle : encode une DECISION utilisateur (« largement plus grande »),
    // pas un detail d'implementation — d'ou ce garde-fou contre un retour a 11 px.
    out.taillePolice = typeof PERT_TG_LABEL_PX === 'number' ? PERT_TG_LABEL_PX : null;

    // « A propos » : la date de generation ne doit plus porter l'heure, y compris pour
    // un bundle ANTERIEUR qui l'embarque encore (format « JJ/MM/AAAA HH:MM »).
    const lire = () => {
      const c = document.getElementById('about-content');
      const lignes = Array.from(c.querySelectorAll('*')).map(e => e.textContent);
      return lignes.filter(t => /\d{2}\/\d{2}\/\d{4}/.test(t)).pop() || '';
    };
    window.PERTFLOW_BUILD = { date: '27/07/2026 14:06', tag: 'v0.17' };
    openAbout(); out.ancienBundle = lire();
    document.getElementById('about-close').click();

    window.PERTFLOW_BUILD = { date: '28/07/2026', tag: 'v0.18.1' };
    openAbout(); out.nouveauBundle = lire();
    document.getElementById('about-close').click();

    delete window.PERTFLOW_BUILD;
    return out;
  });
  console.log('v0.18.1:', v0181);
  if (!(v0181.taillePolice >= 24))
    throw new Error('le libelle de periode doit rester en gros filigrane, vu ' + v0181.taillePolice + ' px');
  if (/\d{2}:\d{2}/.test(v0181.ancienBundle))
    throw new Error('« A propos » affiche encore l\'heure d\'un ancien bundle : ' + v0181.ancienBundle);
  if (v0181.ancienBundle.indexOf('27/07/2026') === -1)
    throw new Error('la date d\'un ancien bundle doit rester lisible : ' + v0181.ancienBundle);
  if (v0181.nouveauBundle.indexOf('28/07/2026') === -1)
    throw new Error('la date d\'un bundle recent doit s\'afficher : ' + v0181.nouveauBundle);

  // ── 4) Aimantation des Labels ─────────────────────────────────────────────────
  const snap = await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const A = LiteGraph.createNode('pert/activity');
    A.properties.duration = 5; g.add(A); A.pos = [400, 300]; A.size = [200, 120];

    const L = LiteGraph.createNode('pert/label');
    g.add(L);
    // manual_size : sans lui, updateSize() recalcule la taille du Label d'apres son
    // texte et ecrase celle imposee ici — les attendus sur le bord DROIT seraient
    // alors calcules sur une largeur qui n'est plus la bonne.
    L.properties.manual_size = true;
    L.size = [160, 80];

    // Lache a 4 px du bord gauche de A → doit s'y coller exactement.
    L.pos = [404, 306];
    window.pertCanvas.onNodeMoved(L);
    const alignedLeft = [L.pos[0], L.pos[1]];

    // Lache a 30 px : hors portee d'aimantation → position inchangee.
    L.pos = [430, 500];
    window.pertCanvas.onNodeMoved(L);
    const untouched = [L.pos[0], L.pos[1]];

    // Bord DROIT du Label aligne sur le bord droit de A (600) → pos.x = 600 - largeur.
    const expectRight = (A.pos[0] + A.size[0]) - L.size[0];
    L.pos = [expectRight + 3, 800];
    window.pertCanvas.onNodeMoved(L);
    const alignedRight = [L.pos[0], L.pos[1]];

    // Une ACTIVITE ne doit jamais etre aimantee : son abscisse porte le temps.
    const A2 = LiteGraph.createNode('pert/activity');
    A2.properties.duration = 5; g.add(A2); A2.pos = [404, 306];
    window.pertCanvas.onNodeMoved(A2);
    const activity = [A2.pos[0], A2.pos[1]];

    return { alignedLeft, untouched, alignedRight, activity, expectRight, lSize: [L.size[0], L.size[1]] };
  });
  console.log('aimantation:', snap);
  if (snap.alignedLeft[0] !== 400)
    throw new Error('bord gauche non aimante : x = ' + snap.alignedLeft[0] + ' (400 attendu)');
  if (snap.alignedLeft[1] !== 300)
    throw new Error('bord haut non aimante : y = ' + snap.alignedLeft[1] + ' (300 attendu)');
  if (snap.untouched[0] !== 430 || snap.untouched[1] !== 500)
    throw new Error('aimantation hors portee : ' + snap.untouched.join(',') + ' (430,500 attendu)');
  if (snap.alignedRight[0] !== snap.expectRight)
    throw new Error("bord droit non aimante : x = " + snap.alignedRight[0] + " (" + snap.expectRight + " attendu)");
  if (snap.activity[0] !== 404 || snap.activity[1] !== 306)
    throw new Error('une Activite a ete aimantee : ' + snap.activity.join(',') + ' — son abscisse porte le temps');

  if (errors.length) throw new Error('erreurs JS : ' + errors.join(' | '));
  console.log('\n✅ smoke-evo-trame-labels OK');
  await browser.close();
})().catch(async (e) => { console.error('ECHEC :', e.message); process.exit(1); });
