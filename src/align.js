// ─── Alignement / repartition d'une selection multiple ──────────────────────────
//
// Boite a outils d'organisation des nœuds selectionnes (demande utilisateur).
// Operations de GEOMETRIE PURE sur node.pos : elles ne touchent NI au calcul PERT
// (les positions n'influencent ni ES/EF ni le chemin critique) NI a la taille des
// nœuds → pas de pertRecalc, juste un cran d'historique + un redraw.
//
// Surface UI : sous-menu « Aligner ▸ » du menu contextuel de nœud (cf. ui.js),
// visible des que >=2 nœuds sont selectionnes (>=3 pour la repartition).

// Nœuds actuellement selectionnes (tableau). Ordre non garanti → on trie dans
// chaque operation qui en depend (repartition).
function pertSelectedNodes() {
  const canvas = window.pertCanvas;
  return canvas ? Object.values(canvas.selected_nodes || {}) : [];
}

function pertNodeCenterX(n) { return n.pos[0] + n.size[0] / 2; }
function pertNodeCenterY(n) { return n.pos[1] + n.size[1] / 2; }

// Finalise une operation d'alignement : redraw + cran d'historique.
function pertFinishAlign() {
  if (window.pertGraph) window.pertGraph.setDirtyCanvas(true, true);
  pertHistoryMark();
}

// Aligne / repartit la selection selon le mode demande.
// Modes : "left" | "right" | "top" | "bottom" | "center-x" | "center-y"
//         | "distribute-h" | "distribute-v"
// center-x = centres alignes sur une meme verticale (colonne) ;
// center-y = centres alignes sur une meme horizontale (ligne).
function pertAlignSelection(mode) {
  const sel = pertSelectedNodes();
  const minCount = (mode === "distribute-h" || mode === "distribute-v") ? 3 : 2;
  if (sel.length < minCount) return;

  switch (mode) {
    case "left": {
      const x = Math.min(...sel.map(n => n.pos[0]));
      sel.forEach(n => { n.pos[0] = x; });
      break;
    }
    case "right": {
      const r = Math.max(...sel.map(n => n.pos[0] + n.size[0]));
      sel.forEach(n => { n.pos[0] = r - n.size[0]; });
      break;
    }
    case "top": {
      const y = Math.min(...sel.map(n => n.pos[1]));
      sel.forEach(n => { n.pos[1] = y; });
      break;
    }
    case "bottom": {
      const b = Math.max(...sel.map(n => n.pos[1] + n.size[1]));
      sel.forEach(n => { n.pos[1] = b - n.size[1]; });
      break;
    }
    case "center-x": {
      // Aligne les centres horizontaux sur la moyenne → colonne verticale.
      const cx = sel.reduce((s, n) => s + pertNodeCenterX(n), 0) / sel.length;
      sel.forEach(n => { n.pos[0] = Math.round(cx - n.size[0] / 2); });
      break;
    }
    case "center-y": {
      // Aligne les centres verticaux sur la moyenne → ligne horizontale.
      const cy = sel.reduce((s, n) => s + pertNodeCenterY(n), 0) / sel.length;
      sel.forEach(n => { n.pos[1] = Math.round(cy - n.size[1] / 2); });
      break;
    }
    case "distribute-h": {
      // Espacement egal des centres entre le plus a gauche et le plus a droite.
      const s = sel.slice().sort((a, b) => pertNodeCenterX(a) - pertNodeCenterX(b));
      const first = pertNodeCenterX(s[0]);
      const last = pertNodeCenterX(s[s.length - 1]);
      const step = (last - first) / (s.length - 1);
      s.forEach((n, i) => { n.pos[0] = Math.round(first + i * step - n.size[0] / 2); });
      break;
    }
    case "distribute-v": {
      const s = sel.slice().sort((a, b) => pertNodeCenterY(a) - pertNodeCenterY(b));
      const first = pertNodeCenterY(s[0]);
      const last = pertNodeCenterY(s[s.length - 1]);
      const step = (last - first) / (s.length - 1);
      s.forEach((n, i) => { n.pos[1] = Math.round(first + i * step - n.size[1] / 2); });
      break;
    }
    default:
      return;
  }
  pertFinishAlign();
}

// Options du sous-menu « Aligner ▸ » (partagees si besoin). Chaque entree appelle
// pertAlignSelection. Les entrees de repartition sont proposees des >=2 mais ne font
// rien sous 3 nœuds (garde dans pertAlignSelection) — on ne les affiche qu'a >=3.
function pertAlignMenuOptions(selCount) {
  const opts = [
    { content: "⇤ Aligner à gauche",   callback: () => pertAlignSelection("left") },
    { content: "⇥ Aligner à droite",   callback: () => pertAlignSelection("right") },
    { content: "⤒ Aligner en haut",    callback: () => pertAlignSelection("top") },
    { content: "⤓ Aligner en bas",     callback: () => pertAlignSelection("bottom") },
    { content: "↕ Centrer (colonne)",  callback: () => pertAlignSelection("center-x") },
    { content: "↔ Centrer (ligne)",    callback: () => pertAlignSelection("center-y") }
  ];
  if (selCount >= 3) {
    opts.push({ content: "⇹ Répartir horizontalement", callback: () => pertAlignSelection("distribute-h") });
    opts.push({ content: "⤨ Répartir verticalement",   callback: () => pertAlignSelection("distribute-v") });
  }
  return opts;
}
