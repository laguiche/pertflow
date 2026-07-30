// Captures d'ecran pour le manuel — evolutions v0.15.2 :
//  - mise en forme des Labels (justif / gras / couleurs)
//  - 2e reorganisation « axe du temps seul » (avant / apres)
//  - boite a outils d'alignement (menu + avant / apres)
// Complete tools/doc-shots.js. Usage : node tools/doc-shots-evo.js
// Sorties dans docs/images/manuel/.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1440, height: 860 } });
  await lib.openApp(page);

  const shot = async (name, sel) => {
    await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.remove(); });
    const target = sel ? await page.$(sel) : page;
    await (target || page).screenshot({ path: path.join(OUT, name) });
    console.log('  ✓', name);
  };

  // Recadre la vue pour englober tous les nœuds avec une marge (zoom manuel stable).
  const frameAll = async (scale, padX, padY) => {
    await page.evaluate(({ scale, padX, padY }) => {
      const c = window.pertCanvas, ns = window.pertGraph._nodes;
      if (!ns.length) return;
      let minX = Infinity, minY = Infinity;
      ns.forEach(n => { minX = Math.min(minX, n.pos[0]); minY = Math.min(minY, n.pos[1]); });
      c.ds.scale = scale;
      c.ds.offset[0] = -minX + padX;
      c.ds.offset[1] = -minY + padY;
      c.setDirty(true, true);
    }, { scale, padX, padY });
    await page.waitForTimeout(300);
  };

  const openAlignMenu = async (x, y, count) => {
    await page.evaluate(({ x, y, count }) => {
      document.querySelectorAll('.litecontextmenu').forEach(m => m.remove());
      const ev = new CustomEvent('contextmenu');
      Object.defineProperty(ev, 'clientX', { value: x });
      Object.defineProperty(ev, 'clientY', { value: y });
      Object.defineProperty(ev, 'target', { value: document.getElementById('pertCanvas') });
      new LiteGraph.ContextMenu(pertAlignMenuOptions(count), { event: ev, title: 'Aligner' });
    }, { x, y, count });
    await page.waitForTimeout(200);
  };

  // ════════════════════════════════════════════════════════════════════════════
  // 1) MISE EN FORME DES LABELS
  // ════════════════════════════════════════════════════════════════════════════
  // Trois Labels illustrant : defaut / centre+gras+couleurs / droite colore.
  await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const mk = (text, x, y, opts) => {
      const l = LiteGraph.createNode('pert/label');
      l.properties.text = text;
      Object.assign(l.properties, opts || {});
      l.pos = [x, y];
      g.add(l);
      l.properties.manual_size = false; l.updateSize();
      return l;
    };
    mk('Label par defaut\n(texte a gauche, gris)', 60, 60, {});
    mk('PHASE 1 — CONCEPTION\nLivraison prevue S12', 60, 220, {
      text_align: 'center', bold: true, font_size: 16,
      text_color: '#5a3a00', bg_color: '#ffe08a'
    });
    mk('Legende :\nchemin critique en rouge', 60, 380, {
      text_align: 'right', text_color: '#7a1020', bg_color: '#ffe0e6'
    });
  });
  await frameAll(1.4, 60, 60);
  await shot('label-mise-en-forme.png', '#pertCanvas');

  // Panneau du Label (Label du milieu selectionne → montre tous les reglages).
  await page.evaluate(() => {
    const g = window.pertGraph;
    const l = g._nodes.find(n => n.type === 'pert/label' && n.properties.bold);
    if (l) { if (window.pertCanvas.selectNode) window.pertCanvas.selectNode(l, false); showProperties(l); }
  });
  await frameAll(1.2, 60, 60);
  await shot('panneau-label.png');

  // ════════════════════════════════════════════════════════════════════════════
  // 2) 2e REORGANISATION « AXE DU TEMPS SEUL » (avant / apres)
  // ════════════════════════════════════════════════════════════════════════════
  // Chaine A -> B -> C, plus une tache D en parallele. On dispose les nœuds sur
  // DEUX rangees choisies a la main (Y significatif), mais avec des X quelconques :
  // le mode « axe du temps » va recaler l'abscisse SANS toucher aux rangees.
  const buildTimeScene = async () => {
    await page.evaluate(() => {
      const g = window.pertGraph; g.clear();
      window.pertMeta.unit = 'sem';
      const mk = (label, dur, x, y, color) => {
        const n = LiteGraph.createNode('pert/activity');
        n.properties.label = label; n.properties.duration = dur;
        n.properties.color = color;
        n.pos = [x, y]; g.add(n); n.updateSize();
        return n;
      };
      // Rangee du haut (chaine principale) — X volontairement desordonnes
      const a = mk('Specification', 3, 520, 80, '#4A90D9');
      const b = mk('Realisation', 4, 120, 80, '#4A90D9');
      const c = mk('Recette', 2, 900, 80, '#4A90D9');
      // Rangee du bas (tache support en parallele)
      const d = mk('Documentation', 5, 300, 320, '#7B61FF');
      a.connect(0, b, 0); b.connect(0, c, 0);
      a.connect(0, d, 0);
      pertRecalc();
    });
  };
  await buildTimeScene();
  await frameAll(1.1, 60, 60);
  await shot('reorg-temps-avant.png', '#pertCanvas');

  await page.evaluate(() => { pertAutoLayoutTimeOnly(); });
  await frameAll(1.1, 60, 60);
  await shot('reorg-temps-apres.png', '#pertCanvas');

  // ════════════════════════════════════════════════════════════════════════════
  // 3) BOITE A OUTILS D'ALIGNEMENT (menu + avant / apres)
  // ════════════════════════════════════════════════════════════════════════════
  // Scene de nœuds volontairement mal alignes (Labels de tailles variees).
  const buildAlignScene = async () => {
    await page.evaluate(() => {
      const g = window.pertGraph; g.clear();
      const mk = (text, x, y, bg) => {
        const l = LiteGraph.createNode('pert/label');
        l.properties.text = text; l.properties.bg_color = bg;
        l.properties.manual_size = true;
        l.pos = [x, y]; l.size = [150, 60];
        g.add(l); return l;
      };
      mk('Bloc A', 40, 60, '#d6e9ff');
      mk('Bloc B', 210, 150, '#ffe08a');
      mk('Bloc C', 120, 300, '#d7f5dd');
      mk('Bloc D', 360, 230, '#ffd6df');
    });
  };
  await buildAlignScene();
  await frameAll(1.5, 60, 60);
  await shot('alignement-avant.png', '#pertCanvas');

  // Menu Aligner (selection des 4 blocs) — capture pleine page.
  await page.evaluate(() => {
    const c = window.pertCanvas, ns = window.pertGraph._nodes;
    c.selected_nodes = {}; ns.forEach(n => { c.selected_nodes[n.id] = n; n.is_selected = true; });
    c.setDirty(true, true);
  });
  await openAlignMenu(430, 210, 4);
  await shot('menu-aligner.png');

  // Applique : aligner a gauche + repartir verticalement.
  await page.evaluate(() => {
    document.querySelectorAll('.litecontextmenu').forEach(m => m.remove());
    const c = window.pertCanvas, ns = window.pertGraph._nodes;
    c.selected_nodes = {}; ns.forEach(n => { c.selected_nodes[n.id] = n; });
    pertAlignSelection('left');
    pertAlignSelection('distribute-v');
  });
  await frameAll(1.5, 60, 60);
  await shot('alignement-apres.png', '#pertCanvas');

  // ════════════════════════════════════════════════════════════════════════════
  // 4) MENU DES DEUX REORGANISATIONS (bouton toolbar)
  // ════════════════════════════════════════════════════════════════════════════
  await page.evaluate(() => {
    const g = window.pertGraph; g.clear();
    const mk = (label, dur, x, y) => {
      const n = LiteGraph.createNode('pert/activity');
      n.properties.label = label; n.properties.duration = dur;
      n.pos = [x, y]; g.add(n); n.updateSize(); return n;
    };
    const a = mk('Etude', 2, 80, 120); const b = mk('Dev', 3, 360, 120);
    a.connect(0, b, 0); pertRecalc();
  });
  await page.click('#btn-fit'); await page.waitForTimeout(200);
  await page.click('#btn-layout');
  await page.waitForTimeout(250);
  await shot('menu-reorganiser.png');

  console.log('Captures evo ecrites dans', OUT);
  await browser.close();
})().catch(e => { console.error('ERREUR:', e.message, e.stack); process.exit(1); });
