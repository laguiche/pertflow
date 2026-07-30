// Captures pour l'enrichissement du manuel :
//  - Chapitre 1 « Prise en main rapide » : une capture par action (etapes 2 -> 9),
//    en construisant PROGRESSIVEMENT le meme petit projet.
//  - Chapitre 4 « Moteur PERT » : 2 synoptiques (anatomie des dates ES/EF/LS/LF +
//    marge ; propagation des dates) rendus en PNG, + 2 captures reelles (panneau des
//    valeurs calculees, chemin critique en rouge).
// Usage : node tools/doc-shots-manuel2.js  → docs/images/manuel/*.png

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const OUT = path.join(lib.ROOT, 'docs', 'images', 'manuel');

// ─── Synoptiques SVG (fond CLAIR, pour s'integrer au manuel HTML imprimable) ──────
const FONT = "font-family='-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif'";

// A. Anatomie des dates d'une tache : au plus tot / au plus tard / marge.
const SVG_ANATOMIE = `
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="380" viewBox="0 0 900 380">
  <rect width="900" height="380" fill="#ffffff"/>
  <!-- axe du temps -->
  <line x1="60" y1="290" x2="850" y2="290" stroke="#8a97ad" stroke-width="2"/>
  <polygon points="850,290 838,284 838,296" fill="#8a97ad"/>
  <text x="856" y="294" ${FONT} font-size="15" fill="#8a97ad">temps</text>

  <!-- droplines -->
  <g stroke="#c3ccdb" stroke-width="1.5" stroke-dasharray="4 4">
    <line x1="150" y1="70"  x2="150" y2="290"/>
    <line x1="430" y1="70"  x2="430" y2="290"/>
    <line x1="330" y1="185" x2="330" y2="290"/>
    <line x1="610" y1="185" x2="610" y2="290"/>
  </g>

  <!-- barre AU PLUS TOT (verte) : ES -> EF -->
  <rect x="150" y="80" width="280" height="52" rx="6" fill="#2e9e5b"/>
  <text x="290" y="112" ${FONT} font-size="17" fill="#ffffff" text-anchor="middle" font-weight="600">Durée de la tâche</text>
  <text x="150" y="66" ${FONT} font-size="14" fill="#2e7d47" font-weight="600">Position « au plus tôt »</text>

  <!-- marge : double fleche ES -> LS -->
  <g stroke="#d98a17" stroke-width="2">
    <line x1="150" y1="158" x2="330" y2="158"/>
    <polygon points="150,158 162,152 162,164" fill="#d98a17" stroke="none"/>
    <polygon points="330,158 318,152 318,164" fill="#d98a17" stroke="none"/>
  </g>
  <text x="240" y="150" ${FONT} font-size="14" fill="#a9660a" text-anchor="middle" font-weight="600">Marge</text>

  <!-- barre AU PLUS TARD (contour) : LS -> LF -->
  <rect x="330" y="185" width="280" height="52" rx="6" fill="#eef2f8" stroke="#5a7bb5" stroke-width="2" stroke-dasharray="7 5"/>
  <text x="470" y="217" ${FONT} font-size="16" fill="#3a5488" text-anchor="middle">même durée, décalée</text>
  <text x="610" y="256" ${FONT} font-size="14" fill="#3a5488" text-anchor="end">Position « au plus tard »</text>

  <!-- etiquettes des 4 dates -->
  <g ${FONT} text-anchor="middle">
    <text x="150" y="312" font-size="16" fill="#14213d" font-weight="700">ES</text>
    <text x="150" y="330" font-size="12" fill="#667">Début t.tôt</text>
    <text x="330" y="312" font-size="16" fill="#14213d" font-weight="700">LS</text>
    <text x="330" y="330" font-size="12" fill="#667">Début t.tard</text>
    <text x="430" y="312" font-size="16" fill="#14213d" font-weight="700">EF</text>
    <text x="430" y="330" font-size="12" fill="#667">Fin t.tôt</text>
    <text x="610" y="312" font-size="16" fill="#14213d" font-weight="700">LF</text>
    <text x="610" y="330" font-size="12" fill="#667">Fin t.tard</text>
  </g>

  <!-- formule -->
  <text x="450" y="366" ${FONT} font-size="15" fill="#14213d" text-anchor="middle">Marge = LS − ES = LF − EF&#160;&#160;·&#160;&#160;une marge nulle = tâche <tspan fill="#c0392b" font-weight="700">critique</tspan></text>
</svg>`;

// B. Propagation : ES d'une tache = la plus tardive des fins de ses predecesseurs.
const SVG_PROPAGATION = `
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="330" viewBox="0 0 900 330">
  <rect width="900" height="330" fill="#ffffff"/>
  <!-- predecesseurs -->
  <g>
    <rect x="50" y="55" width="230" height="76" rx="8" fill="#eaf1fb" stroke="#5a7bb5" stroke-width="2"/>
    <text x="70" y="85" ${FONT} font-size="16" fill="#14213d" font-weight="700">Tâche A</text>
    <text x="70" y="112" ${FONT} font-size="15" fill="#2e7d47">Fin au plus tôt : sem. 5</text>
  </g>
  <g>
    <rect x="50" y="195" width="230" height="76" rx="8" fill="#eaf1fb" stroke="#5a7bb5" stroke-width="2"/>
    <text x="70" y="225" ${FONT} font-size="16" fill="#14213d" font-weight="700">Tâche B</text>
    <text x="70" y="252" ${FONT} font-size="15" fill="#2e7d47">Fin au plus tôt : sem. 8</text>
  </g>
  <!-- successeur -->
  <g>
    <rect x="590" y="120" width="260" height="90" rx="8" fill="#fef6e6" stroke="#d98a17" stroke-width="2"/>
    <text x="720" y="150" ${FONT} font-size="16" fill="#14213d" font-weight="700" text-anchor="middle">Tâche C</text>
    <text x="720" y="176" ${FONT} font-size="15" fill="#14213d" text-anchor="middle">Début au plus tôt =</text>
    <text x="720" y="197" ${FONT} font-size="15" fill="#a9660a" text-anchor="middle" font-weight="700">max(5, 8) = sem. 8</text>
  </g>
  <!-- fleches -->
  <g stroke="#8a97ad" stroke-width="2.5" fill="none">
    <path d="M280,93 C430,93 440,150 588,158"/>
    <path d="M280,233 C430,233 440,180 588,172"/>
  </g>
  <polygon points="590,158 576,152 577,165" fill="#8a97ad"/>
  <polygon points="590,172 577,165 576,178" fill="#8a97ad"/>

  <text x="450" y="305" ${FONT} font-size="15" fill="#14213d" text-anchor="middle">C ne peut démarrer qu'une fois A <tspan font-weight="700">et</tspan> B terminées → on retient la fin la <tspan font-weight="700">plus tardive</tspan>.</text>
</svg>`;

async function renderSvg(page, svg, name, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><body style="margin:0;padding:0">${svg}</body></html>`);
  await page.waitForTimeout(150);
  const el = await page.$('svg');
  await el.screenshot({ path: path.join(OUT, name) });
  console.log('  ✓', name);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await lib.launch({ scale: 2, viewport: { width: 1440, height: 860 } });

  // ── Synoptiques (avant d'ouvrir l'app : simples rendus SVG) ───────────────────
  await renderSvg(page, SVG_ANATOMIE, 'pert-anatomie-dates.png', 900, 380);
  await renderSvg(page, SVG_PROPAGATION, 'pert-propagation-dates.png', 900, 330);

  // ── App ───────────────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 1440, height: 860 });
  await lib.openApp(page);

  const shot = async (name, sel) => {
    await page.evaluate(() => { const t = document.getElementById('toast'); if (t && !window.__keepToast) t.remove(); });
    const target = sel ? await page.$(sel) : page;
    await (target || page).screenshot({ path: path.join(OUT, name) });
    console.log('  ✓', name);
  };
  const fit = async () => { await page.click('#btn-fit'); await page.waitForTimeout(250); };

  // ════════════════════════════════════════════════════════════════════════════
  // CHAPITRE 1 — QUICK START (une capture par action, projet construit pas a pas)
  // ════════════════════════════════════════════════════════════════════════════

  // Etape 2 — Parametres (T0 + unite)
  await page.evaluate(() => {
    window.pertMeta.title = 'Nouveau produit';
    window.pertMeta.t0 = '2026-09-01';
    window.pertMeta.unit = 'sem';
    document.getElementById('project-title').textContent = window.pertMeta.title;
    openSettings();
  });
  await page.waitForTimeout(250);
  await shot('qs-2-parametres.png');
  await page.evaluate(() => { document.getElementById('settings-dialog').style.display = 'none'; });

  // Etape 3 — Ajouter une tache
  const idA = await page.evaluate(() => {
    const n = LiteGraph.createNode('pert/activity');
    n.pos = [160, 200]; window.pertGraph.add(n); n.updateSize();
    window.pertCanvas.selectNode(n, false); showProperties(n);
    pertRecalc();
    return n.id;
  });
  await fit();
  await shot('qs-3-activite.png');

  // Etape 4 — Renseigner la tache (libelle, duree, responsable)
  await page.evaluate((id) => {
    const n = window.pertGraph.getNodeById(id);
    n.properties.label = 'Étude préalable';
    n.properties.duration = 2;
    n.properties.responsible = 'Awa';
    n.updateSize(); showProperties(n); pertRecalc();
  }, idA);
  await fit();
  await shot('qs-4-proprietes.png');

  // Etape 5 — Ajouter une 2e tache et la relier
  const idB = await page.evaluate((idA) => {
    const a = window.pertGraph.getNodeById(idA);
    const b = LiteGraph.createNode('pert/activity');
    b.properties.label = 'Développement'; b.properties.duration = 4;
    b.properties.responsible = 'Ben'; b.properties.color = '#7B61FF';
    b.pos = [520, 320]; window.pertGraph.add(b); b.updateSize();
    a.connect(0, b, 0);
    pertRecalc();
    window.pertCanvas.selectNode(b, false); showProperties(b);
    return b.id;
  }, idA);
  await fit();
  await shot('qs-5-lien.png');

  // Etape 6 — Ajouter un jalon de fin (avec date-cible) et le relier
  const idM = await page.evaluate((idB) => {
    const b = window.pertGraph.getNodeById(idB);
    const m = LiteGraph.createNode('pert/milestone');
    m.properties.label = 'Livraison'; m.properties.due_date = '2026-11-15';
    m.pos = [900, 320]; window.pertGraph.add(m); m.updateSize();
    b.connect(0, m, 0);
    pertRecalc();
    window.pertCanvas.selectNode(m, false); showProperties(m);
    return m.id;
  }, idB);
  await fit();
  await shot('qs-6-jalon.png');

  // Etape 7 — Lire les resultats (chemin critique rouge + valeurs de la tache)
  await page.evaluate((idB) => {
    const b = window.pertGraph.getNodeById(idB);
    window.pertCanvas.selectNode(b, false); showProperties(b);
    pertHighlightCriticalPath(b);
  }, idB);
  await fit();
  await shot('qs-7-resultats.png');

  // Etape 8 — Reorganiser + Tout afficher
  await page.evaluate(() => { pertAutoLayout(); pertHighlightCriticalPath(null); });
  await fit();
  await shot('qs-8-reorganiser.png');

  // Etape 9 — Sauvegarder (toast de confirmation)
  await page.evaluate(() => { window.__keepToast = true; pertSaveProject(); });
  await page.waitForTimeout(300);
  await shot('qs-9-sauvegarde.png');
  await page.evaluate(() => { window.__keepToast = false; const t = document.getElementById('toast'); if (t) t.remove(); });

  // ════════════════════════════════════════════════════════════════════════════
  // CHAPITRE 4 — captures reelles
  // ════════════════════════════════════════════════════════════════════════════

  // Panneau des valeurs calculees (tache critique selectionnee) — gros plan panneau.
  await page.evaluate(() => {
    const b = window.pertGraph._nodes.find(n => n.properties && n.properties.label === 'Développement');
    if (b) { window.pertCanvas.selectNode(b, false); showProperties(b); }
    // Depuis le decoupage du panneau en onglets, les valeurs calculees sont dans
    // « Synthèse » : la capture doit ouvrir cet onglet, sinon elle montre la saisie.
    pertSelectPanelTab('synthese');
  });
  await page.waitForTimeout(200);
  await shot('ch4-panneau-calcul.png', '#properties-panel');

  // Chemin critique en rouge (vue d'ensemble, sans selection = marge minimale).
  await page.evaluate(() => { pertHighlightCriticalPath(null); });
  await fit();
  await shot('ch4-chemin-critique.png', '#pertCanvas');

  console.log('Captures manuel2 ecrites dans', OUT);
  await browser.close();
})().catch(e => { console.error('ERREUR:', e.message, e.stack); process.exit(1); });
