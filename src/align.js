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

// ─── Aimantation des Labels sur les bords voisins ───────────────────────────────
//
// Un Label est une annotation librement positionnee : il est exclu de la reorganisation
// automatique et n'a aucune signification temporelle. L'aligner a la main sur le bloc
// qu'il commente etait fastidieux au pixel pres — d'ou cette aimantation.
//
// RESERVE AUX LABELS, deliberement. Sur une Activite ou un Jalon, l'abscisse PORTE LE
// TEMPS (x = originX + offset × PERT_PX_PER_UNIT) : aimanter horizontalement un tel
// nœud sur son voisin le deplacerait dans le calendrier et fausserait la lecture
// chronologique. Les Labels, eux, ne portent rien — les aimanter est sans consequence.
//
// Se declenche AU LACHER (via onNodeMoved), comme le snap-to-grid natif de LiteGraph,
// qui aligne lui aussi a la fin du deplacement (litegraph.js : alignToGrid() puis
// onNodeMoved()). Notre ajustement passe donc APRES la grille et prime sur elle.

const PERT_LABEL_SNAP_PX = 9;   // distance d'accrochage, en pixels du repere GRAPHE

// Candidats d'alignement d'un axe : bord bas/gauche, bord haut/droit, centre.
function pertSnapCandidates(n, axis) {
  const p = n.pos[axis], s = n.size[axis];
  return [p, p + s, p + s / 2];
}

// Aimante un Label sur les bords (et centres) des nœuds voisins, axe par axe.
// Les deux axes sont traites INDEPENDAMMENT : un Label peut s'aligner horizontalement
// sur une tache et verticalement sur une autre, ce qui est le comportement attendu
// d'un outil de dessin. Renvoie true si une position a ete ajustee.
function pertSnapLabelToNeighbors(node) {
  if (!node || node.type !== "pert/label") return false;
  const graph = window.pertGraph;
  if (!graph || !graph._nodes) return false;

  let moved = false;
  for (let axis = 0; axis < 2; axis++) {
    const mine = pertSnapCandidates(node, axis);
    let best = null;   // { delta, dist }
    for (const other of graph._nodes) {
      if (other === node) continue;
      // Un nœud replie/masque n'offre pas de bord pertinent ; les autres comptent tous
      // (taches, jalons ET labels : on aligne aussi les cartouches entre eux).
      if (other.flags && other.flags.collapsed) continue;
      for (const target of pertSnapCandidates(other, axis)) {
        for (const m of mine) {
          const d = target - m;
          const dist = Math.abs(d);
          if (dist <= PERT_LABEL_SNAP_PX && (best === null || dist < best.dist)) {
            best = { delta: d, dist };
          }
        }
      }
    }
    if (best && best.delta !== 0) {
      node.pos[axis] = Math.round(node.pos[axis] + best.delta);
      moved = true;
    }
  }
  return moved;
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
