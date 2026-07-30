// Test cible : filtre « recherche par nom » (zone de saisie du menu Filtre).
//   - un nœud reste vif si son NOM ou ses NOTES contiennent la chaine ; les autres
//     sont estompes — et la recherche vaut pour les TROIS types de nœuds (c'est le
//     seul filtre dans ce cas : on cherche « ou est passe X »)
//   - insensible a la casse ET aux accents (« etude » trouve « Étude »)
//   - vider la zone retire le filtre ; choisir un autre filtre ou « Aucun filtre »
//     VIDE la zone de saisie (exigence explicite de la demande)
//   - la zone survit a la fermeture/reouverture du menu (elle est fixe dans le HTML,
//     seules les options sont reconstruites)
//   - le compteur de resultats distingue « trouve » de « rien trouve », sans quoi une
//     recherche infructueuse estompe tout le planning sans rien dire
//   - le rendu est verifie AU PIXEL : un filtre qui n'estompe rien passerait tous les
//     tests d'etat (piege deja rencontre avec la trame et le repere T0)
// Usage : node tools/smoke-evo-filtre-recherche.js

const lib = require('./lib');

(async () => {
  const { browser, page } = await lib.launch();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await lib.openApp(page);

  await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    window.pertMeta.t0 = '2026-01-05'; window.pertMeta.unit = 'j';
    const mk = (label, notes, x) => {
      const n = LiteGraph.createNode('pert/activity');
      n.properties.label = label; n.properties.notes = notes || '';
      n.properties.duration = 3; n.properties.group = 'WP1';
      n.updateSize(); g.add(n); n.pos = [x, 100];
      return n;
    };
    mk('Étude mécanique', '', 100);
    mk('Chiffrage', 'chiffrage a affiner apres etude', 300);   // trouvable par ses NOTES
    mk('Consultation', '', 500);
    const J = LiteGraph.createNode('pert/milestone');
    J.properties.label = 'Revue d\'étude'; J.updateSize(); g.add(J); J.pos = [700, 100];
    const L = LiteGraph.createNode('pert/label');
    L.properties.text = 'Hypothèse : étude sous-traitée'; g.add(L); L.pos = [100, 300];
    window.pertMeta.groups = { 'WP1': '#4A90D9' };
    pertRecalc();
  });

  // Helpers : pilote la VRAIE zone de saisie du menu (chemin utilisateur).
  const search = async (txt) => page.evaluate((t) => {
    const input = document.getElementById('filter-search');
    input.value = t;
    input.dispatchEvent(new Event('input'));
    return {
      filtre: window.pertFilter && window.pertFilter.type + ':' + window.pertFilter.value,
      vifs: window.pertGraph._nodes.filter(n => !pertNodeDimmed(n))
        .map(n => n.properties.label || n.properties.text).sort(),
      compteur: document.getElementById('filter-search-count').textContent,
      declencheur: document.getElementById('filter-current').textContent,
      // Aucune ligne du menu ne represente une recherche : tant qu'elle est active,
      // aucune ne doit etre marquee — surtout pas « Aucun filtre ».
      lignesActives: Array.from(document.querySelectorAll('#filter-options .filter-menu-row.active'))
        .map(r => r.textContent.trim()),
    };
  }, txt);

  // ── 1) Recherche sur le nom, sur les notes, et les trois types de nœuds ──────
  // Attendu : l'Activite « Étude mécanique » (nom), le Jalon « Revue d'étude » (nom),
  // le Label « Hypothèse : étude… » (texte) — et « Chiffrage », dont les NOTES portent
  // « etude » SANS accent : un seul cas qui prouve a la fois la recherche dans les
  // notes et l'insensibilite aux accents.
  const etude = await search('étude');
  console.log('« étude » :', etude);
  if (etude.filtre !== 'text:étude') throw new Error('le filtre texte n\'est pas pose');
  const attendu = ['Chiffrage', 'Hypothèse : étude sous-traitée', 'Revue d\'étude', 'Étude mécanique'];
  if (etude.vifs.join('|') !== attendu.join('|'))
    throw new Error('la recherche doit couvrir Activite, Jalon ET Label — vu ' + etude.vifs.join('|'));
  if (!/4 nœuds/.test(etude.compteur)) throw new Error('compteur attendu « 4 nœuds », vu ' + etude.compteur);
  if (etude.lignesActives.length)
    throw new Error('aucune ligne du menu ne doit rester marquee active pendant une recherche — vu '
      + etude.lignesActives.join(', '));
  if (!/étude/.test(etude.declencheur)) throw new Error('le declencheur doit rappeler la recherche');

  // ── 2) Insensibilite casse + accents, et recherche dans les NOTES ────────────
  const sansAccent = await search('ETUDE');
  console.log('« ETUDE » :', sansAccent.vifs);
  if (sansAccent.vifs.join('|') !== etude.vifs.join('|'))
    throw new Error('la recherche doit ignorer casse et accents');
  const notes = await search('affiner');
  console.log('« affiner » (notes) :', notes.vifs);
  if (notes.vifs.join('|') !== 'Chiffrage')
    throw new Error('la recherche doit porter aussi sur les notes — vu ' + notes.vifs.join('|'));

  // ── 3) Rendu AU PIXEL : le voile d'estompage est-il reellement dessine ? ─────
  const pixels = await page.evaluate(async () => {
    const cv = document.getElementById('pertCanvas');
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
    document.getElementById('btn-fit').click();
    await redraw();
    const input = document.getElementById('filter-search');
    input.value = ''; input.dispatchEvent(new Event('input'));
    await redraw(); const sansFiltre = sum();
    input.value = 'chiffrage'; input.dispatchEvent(new Event('input'));
    await redraw(); const avecFiltre = sum();
    return { sansFiltre, avecFiltre };
  });
  console.log('pixels :', pixels);
  if (pixels.sansFiltre === pixels.avecFiltre)
    throw new Error('la recherche n\'estompe rien a l\'ecran (voile non dessine)');

  // ── 4) Recherche sans resultat : compteur explicite, filtre conserve ─────────
  const vide = await search('zzz-introuvable');
  console.log('sans resultat :', vide.compteur, '| vifs =', vide.vifs.length);
  if (vide.vifs.length !== 0) throw new Error('aucun nœud ne devrait correspondre');
  if (!/aucun/i.test(vide.compteur))
    throw new Error('une recherche infructueuse doit le dire — vu « ' + vide.compteur + ' »');

  // ── 5) Vider la zone retire le filtre ────────────────────────────────────────
  const videe = await search('');
  console.log('zone videe :', videe.filtre, videe.compteur);
  if (videe.filtre !== null && videe.filtre !== undefined)
    throw new Error('vider la zone doit retirer le filtre, vu ' + videe.filtre);
  if (videe.compteur !== '') throw new Error('le compteur doit disparaitre sans recherche');

  // ── 6) Choisir un AUTRE filtre vide la zone (exigence explicite) ─────────────
  const autre = await page.evaluate(() => {
    const input = document.getElementById('filter-search');
    input.value = 'chiffrage'; input.dispatchEvent(new Event('input'));
    // Clic sur la vraie ligne « WP1 » du menu (chemin utilisateur).
    openFilterMenu();
    const ligne = Array.from(document.querySelectorAll('#filter-options .filter-menu-row'))
      .find(r => r.textContent.trim() === 'WP1');
    ligne.click();
    return {
      saisie: document.getElementById('filter-search').value,
      compteur: document.getElementById('filter-search-count').textContent,
      filtre: window.pertFilter && window.pertFilter.type + ':' + window.pertFilter.value,
    };
  });
  console.log('apres choix d\'un groupe :', autre);
  if (autre.saisie !== '') throw new Error('choisir un autre filtre doit VIDER la zone de recherche');
  if (autre.filtre !== 'group:WP1') throw new Error('le filtre groupe doit avoir pris la main');
  if (autre.compteur !== '') throw new Error('le compteur de recherche doit disparaitre');

  // ── 7) « Aucun filtre » vide aussi la zone ───────────────────────────────────
  const aucun = await page.evaluate(() => {
    const input = document.getElementById('filter-search');
    input.value = 'étude'; input.dispatchEvent(new Event('input'));
    openFilterMenu();
    const ligne = Array.from(document.querySelectorAll('#filter-options .filter-menu-row'))
      .find(r => r.textContent.trim() === 'Aucun filtre');
    ligne.click();
    return {
      saisie: document.getElementById('filter-search').value,
      filtre: window.pertFilter,
      estompes: window.pertGraph._nodes.filter(n => pertNodeDimmed(n)).length,
    };
  });
  console.log('apres « Aucun filtre » :', aucun);
  if (aucun.saisie !== '') throw new Error('« Aucun filtre » doit VIDER la zone de recherche');
  if (aucun.filtre !== null) throw new Error('« Aucun filtre » doit retirer tout filtre');
  if (aucun.estompes !== 0) throw new Error('sans filtre, plus rien ne doit etre estompe');

  // ── 8) La saisie survit a la fermeture/reouverture du menu ───────────────────
  const survie = await page.evaluate(() => {
    const input = document.getElementById('filter-search');
    input.value = 'consult'; input.dispatchEvent(new Event('input'));
    closeFilterMenu();
    openFilterMenu();     // refreshFilterOptions ne doit reconstruire QUE les options
    return {
      saisie: document.getElementById('filter-search').value,
      compteur: document.getElementById('filter-search-count').textContent,
      focus: document.activeElement && document.activeElement.id,
      filtre: window.pertFilter && window.pertFilter.type,
    };
  });
  console.log('reouverture du menu :', survie);
  if (survie.saisie !== 'consult')
    throw new Error('la saisie doit survivre a la reouverture du menu (zone fixe, options reconstruites)');
  if (survie.filtre !== 'text') throw new Error('le filtre de recherche doit rester actif');
  if (!/1 nœud/.test(survie.compteur)) throw new Error('compteur attendu « 1 nœud », vu ' + survie.compteur);
  if (survie.focus !== 'filter-search') throw new Error('ouvrir le menu doit placer le curseur dans la recherche');

  if (errors.length) throw new Error('erreurs JS :\n' + errors.join('\n'));
  console.log('\nOK — filtre de recherche par nom valide');
  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
