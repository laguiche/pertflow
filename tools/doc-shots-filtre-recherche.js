// Capture d'ecran pour le manuel — recherche par nom dans le menu Filtre.
// On montre le menu OUVERT (zone de saisie + compteur) au-dessus d'un planning ou
// l'estompage est visible : c'est la conjonction des deux qui explique la fonction.
// Usage : node tools/doc-shots-filtre-recherche.js — sortie dans docs/images/manuel/.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');
const FIXTURE = path.join(lib.EXEMPLES, 'pert_a_exporter.pert');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1440, height: 820 } });
  await lib.openApp(page);

  // Meme planning de demonstration que les autres captures du manuel.
  const data = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  await page.evaluate((d) => { pertApplyProject(d); }, data);
  await page.click('#btn-fit');
  await page.waitForTimeout(400);

  // Terme de recherche : on ne code rien en dur (la fixture a deja change de contenu),
  // mais on ne prend pas non plus le premier mot venu — dans ce planning de demo les
  // libelles sont generiques (« Activité 1/2/3… »), et « Activité » eclairerait
  // presque tout, ce qui n'illustre RIEN. On choisit donc le terme le plus
  // DISCRIMINANT : celui qui laisse le moins de nœuds vifs, tout en en laissant au
  // moins un.
  const terme = await page.evaluate(() => {
    const g = window.pertGraph;
    const mots = new Set();
    g._nodes.forEach(n => {
      String((n.properties && (n.properties.label || n.properties.text)) || '')
        .split(/\s+/).forEach(m => { if (m.length >= 4) mots.add(m); });
    });
    const memo = window.pertFilter;
    let best = null, bestN = Infinity;
    mots.forEach(m => {
      window.pertFilter = { type: 'text', value: m };
      const n = g._nodes.filter(x => !pertNodeDimmed(x)).length;
      // Au moins DEUX nœuds trouves : avec un seul, la capture montrerait un planning
      // entierement estompe et le lecteur chercherait ce qui a ete trouve.
      if (n >= 2 && n < bestN) { bestN = n; best = m; }
    });
    window.pertFilter = memo;
    return best;
  });
  console.log('  terme recherche :', terme);

  await page.click('#filter-trigger');
  await page.evaluate((t) => {
    const i = document.getElementById('filter-search');
    i.value = t;
    i.dispatchEvent(new Event('input'));
  }, terme);
  await page.waitForTimeout(300);

  // Cadrage sur les nœuds TROUVES : « Tout afficher » cadre le planning entier, et les
  // nœuds mis en evidence pouvaient tomber hors de la zone capturee — la capture
  // illustrait alors un planning tout estompe, exactement le contraire du propos.
  await page.evaluate(() => {
    const c = window.pertCanvas, el = c.canvas;
    const vifs = window.pertGraph._nodes.filter(n => !pertNodeDimmed(n));
    if (!vifs.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    vifs.forEach(n => {
      minX = Math.min(minX, n.pos[0]); minY = Math.min(minY, n.pos[1]);
      maxX = Math.max(maxX, n.pos[0] + n.size[0]); maxY = Math.max(maxY, n.pos[1] + n.size[1]);
    });
    c.ds.scale = Math.max(0.35, Math.min(1, Math.min(
      (el.width * 0.7) / Math.max(1, maxX - minX),
      (el.height * 0.5) / Math.max(1, maxY - minY))));
    // Legerement bas dans la vue : le menu deroulant occupe le haut a droite.
    c.ds.offset[0] = (el.width / 2) / c.ds.scale - (minX + maxX) / 2;
    c.ds.offset[1] = (el.height * 0.58) / c.ds.scale - (minY + maxY) / 2;
    c.setDirty(true, true);
  });
  await page.waitForTimeout(400);

  await page.screenshot({
    path: path.join(OUT, 'filtre-recherche.png'),
    clip: { x: 0, y: 0, width: 1440, height: 780 }
  });
  console.log('  ✓ filtre-recherche.png');

  await browser.close();
})().catch(e => { console.error('ECHEC :', e.message); process.exit(1); });
