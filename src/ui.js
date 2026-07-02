// ─── État global ──────────────────────────────────────────────────────────────

// groups : registre des couleurs memorisees par groupe (WP/metier/service), #14.
// { "<nom du groupe>": "<couleur>" } — serialise dans le .pert, capte par l'undo.
// prop_width (#18) : largeur des Activites proportionnelle a la duree (defaut true).
// Optionnel — desactivable via le dialogue Parametres ; serialise dans le .pert.
// hours_per_month / hours_per_day / hourly_rate (S8.5) : parametres d'estimation de
// cout (cf. pertActivityCost) ; defauts entreprise, modifiables dans Parametres.
window.pertMeta = {
  title: "Nouveau projet", t0: "", unit: "mois", layout_gap: 30, prop_width: true,
  hours_per_month: 135, hours_per_day: 8, hourly_rate: 136,
  groups: {}, autosave: true
};
window.pertGraph = null;
window.pertCanvas = null;

// ─── Initialisation ───────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  LiteGraph.debug = false;
  LiteGraph.NODE_TITLE_HEIGHT = 24;
  LiteGraph.NODE_TEXT_SIZE = 12;

  const graph = new LGraph();
  const canvasEl = document.getElementById("pertCanvas");
  const lgCanvas = new LGraphCanvas("#pertCanvas", graph);

  window.pertGraph = graph;
  window.pertCanvas = lgCanvas;

  lgCanvas.background_image = null;
  lgCanvas.show_info = false;   // masque l'overlay debug LiteGraph (T/I/N/V/FPS)
  lgCanvas.render_shadows = false;
  lgCanvas.render_connections_border = true;
  lgCanvas.connections_width = 2;
  // Cadre par défaut LiteGraph dessiné en coords graphe (ancré à l'origine 0,0) :
  // il se décale visuellement après recadrage « Tout afficher ». Inutile ici.
  lgCanvas.render_canvas_border = false;

  // ── Menu contextuel (clic droit) — recentré sur le PERT (Session 4) ──────────
  // On neutralise la barre de recherche LiteGraph (#28), inutile pour un usage
  // PERT et qui s'ouvrait de façon parasite au double-clic sur le fond.
  lgCanvas.allow_searchbox = false;

  // Position graphe du dernier clic droit, pour ajouter le nœud sous le curseur.
  // processContextMenu reçoit l'événement souris ; on le convertit en coords graphe
  // AVANT de laisser LiteGraph construire le menu (qui appelle getMenuOptions).
  let lastCtxGraphPos = null;
  const origProcessContextMenu = lgCanvas.processContextMenu;
  lgCanvas.processContextMenu = function (node, event) {
    try { lastCtxGraphPos = this.convertEventToCanvasOffset(event); }
    catch (e) { lastCtxGraphPos = null; }
    const ret = origProcessContextMenu.call(this, node, event);
    // #25 LiteGraph met node.type ("pert/activity"…) comme TITRE du menu de nœud
    // (cf. options.title = node.type dans processContextMenu). On le remplace, apres
    // creation du menu, par le libelle FR du type (ActivityNode.title = "Activité"…).
    if (node) {
      const titles = document.querySelectorAll(".litemenu-title");
      const el = titles[titles.length - 1]; // le menu qu'on vient d'ouvrir
      if (el) el.textContent = (node.constructor && node.constructor.title) || node.type;
    }
    return ret;
  };

  // Ajoute un nœud du type donné à la position graphe fournie (ou au centre).
  function addNodeAt(typeName, pos) {
    const n = LiteGraph.createNode(typeName);
    if (n.updateSize) n.updateSize();
    if (pos) {
      // Position explicite (clic droit) : coin haut-gauche sous le curseur
      n.pos = [pos[0], pos[1]];
    } else {
      // Bouton toolbar : nœud CENTRE sur le milieu de l'espace de travail visible
      // (retrait de la demi-taille — pos est le coin haut-gauche du nœud)
      const c = getCanvasCenter();
      const w = (n.size && n.size[0]) || 0;
      const h = (n.size && n.size[1]) || 0;
      n.pos = [c[0] - w / 2, c[1] - h / 2];
    }
    graph.add(n);
    return n;
  }

  // Menu du fond de canvas : uniquement des actions PERT, en français
  // (remplace intégralement le menu natif anglais « Add Node / Add Group… »).
  lgCanvas.getMenuOptions = function () {
    const pos = lastCtxGraphPos;
    return [
      { content: "▭ Ajouter une Activité", callback: () => addNodeAt("pert/activity", pos) },
      { content: "◈ Ajouter un Jalon",     callback: () => addNodeAt("pert/milestone", pos) },
      { content: "❏ Ajouter un Label",     callback: () => addNodeAt("pert/label", pos) },
      null,
      { content: "⤓ Réorganiser", callback: () => {
          pertAutoLayout(); pertHistoryMark(); pertZoomToFit();
        } },
      { content: "🔍 Tout afficher", callback: () => pertZoomToFit() }
    ];
  };

  // Menu d'un nœud : francisé et limité aux actions utiles (remplace le menu natif
  // anglais Inputs/Outputs/Properties/Title/Mode/Resize/Collapse/Pin/Colors/Shapes).
  lgCanvas.getNodeMenuOptions = function (node) {
    return [
      { content: "⧉ Dupliquer", callback: () => {
          const clone = node.clone();
          if (!clone) return;
          clone.pos = [node.pos[0] + 24, node.pos[1] + 24];
          if (clone.updateSize) clone.updateSize();
          graph.add(clone);          // déclenche onNodeAdded → recalc + historique
          pertEnsureUids();          // #34 le clone recopie l'uid → on le regenere
          pertRecalc();
        } },
      null,
      { content: "🗑 Supprimer", callback: () => { graph.remove(node); } }
    ];
  };

  // #25 Cohérence linguistique : neutraliser les derniers panneaux/menus natifs
  // LiteGraph en anglais encore atteignables (les menus contextuels de fond et de
  // nœud sont déjà francisés ci-dessus).
  // - Double-clic sur un nœud ouvrait le panneau natif anglais (Title/Properties…),
  //   redondant ici puisque notre panneau de propriétés est toujours affiché à droite.
  lgCanvas.onShowNodePanel = function () { /* supprime le panneau natif anglais */ };
  // - Clic droit sur un lien ouvrait un menu natif anglais (« Add Node / Delete »).
  //   On le remplace par un menu français minimal (suppression du lien).
  lgCanvas.showLinkMenu = function (link, e) {
    new LiteGraph.ContextMenu(["Supprimer le lien"], {
      event: e,
      callback: (v) => {
        if (v === "Supprimer le lien" && link) {
          graph.removeLink(link.id);   // déclenche onConnectionChange → recalc + historique
          pertRecalc();
        }
      }
    });
    return false;
  };

  // ── Snap-to-grid (option utilisateur, Session 4) ─────────────────────────────
  // Toggle toolbar : quand actif, le déplacement des nœuds s'aligne sur la grille
  // (align_to_grid natif LiteGraph) ET la grille devient visible. Décision figée :
  // pas de grille affichée tant que l'option est désactivée.
  window.pertSnapEnabled = false;
  const GRID_STEP = LiteGraph.CANVAS_GRID_SIZE; // 10 px (pas d'alignement natif)

  // Dessin de la grille en espace graphe (ctx déjà transformé par LiteGraph).
  // Évité quand le pas projeté à l'écran devient trop dense (zoom arrière).
  lgCanvas.onDrawBackground = function (ctx, area) {
    // #26 Neutralise le surlignage blanc des liens du nœud selectionne : LiteGraph
    // force la couleur #FFF pour les liens de highlighted_links (renderLink), ce qui
    // masquait le rouge du chemin critique sur le ou les liens touchant le nœud
    // selectionne (typiquement le dernier lien vers un jalon de fin selectionne).
    // onDrawBackground est appele dans drawBackCanvas JUSTE avant drawConnections,
    // dans le meme cycle de rendu → vider la table ici fait primer nos couleurs.
    this.highlighted_links = {};

    if (!window.pertSnapEnabled) return;
    if (GRID_STEP * this.ds.scale < 6) return; // grille illisible → on s'abstient
    const x0 = Math.floor(area[0] / GRID_STEP) * GRID_STEP;
    const y0 = Math.floor(area[1] / GRID_STEP) * GRID_STEP;
    const x1 = area[0] + area[2], y1 = area[1] + area[3];
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(126,184,247,0.10)";
    ctx.beginPath();
    for (let x = x0; x <= x1; x += GRID_STEP) { ctx.moveTo(x, area[1]); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y += GRID_STEP) { ctx.moveTo(area[0], y); ctx.lineTo(x1, y); }
    ctx.stroke();
    ctx.restore();
  };

  // Resize dynamique
  function resizeCanvas() {
    const container = document.getElementById("canvas-container");
    canvasEl.width = container.clientWidth;
    canvasEl.height = container.clientHeight;
    lgCanvas.resize(canvasEl.width, canvasEl.height);
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  graph.start();

  // ── Sélection → panneau propriétés ──────────────────────────────────────────

  // Panneau toujours visible, placeholder quand rien n'est sélectionné
  showProperties(null);

  lgCanvas.onNodeSelected = function(node) {
    showProperties(node);
  };

  lgCanvas.onNodeDeselected = function() {
    // Vérifier s'il reste exactement 1 nœud sélectionné
    setTimeout(() => {
      const sel = Object.values(lgCanvas.selected_nodes || {});
      if (sel.length === 1) showProperties(sel[0]);
      else showProperties(null);
    }, 30);
  };

  // Clic sur le canvas vide → désélection
  canvasEl.addEventListener("mousedown", (e) => {
    if (e.target !== canvasEl) return;
    setTimeout(() => {
      const sel = Object.values(lgCanvas.selected_nodes || {});
      if (sel.length === 0) showProperties(null);
      else if (sel.length === 1) showProperties(sel[0]);
      else showProperties(null); // multi-sélection
    }, 60);
  });

  // Nœud supprimé (touche Delete native LiteGraph)
  graph.onNodeRemoved = function() {
    pertRecalc();
    pertHistoryMark();
    setTimeout(() => {
      const sel = Object.values(lgCanvas.selected_nodes || {});
      if (sel.length === 1) showProperties(sel[0]);
      else showProperties(null);
    }, 30);
  };

  // ── Recalcul PERT automatique (ajout / connexion) ───────────────────────────
  graph.onNodeAdded = function() { pertRecalc(); pertHistoryMark(); };
  graph.onConnectionChange = function() {
    pertRecalc();
    pertHistoryMark();
    // Rafraîchir le panneau si un nœud unique est sélectionné (valeurs calculées)
    const sel = Object.values(lgCanvas.selected_nodes || {});
    if (sel.length === 1) showProperties(sel[0]);
  };

  // Deplacement de noeud(s) termine (drag relache) → cran d'historique.
  lgCanvas.onNodeMoved = function() { pertHistoryMark(); };

  // Premier calcul (graphe éventuellement déjà peuplé)
  pertRecalc();

  // Baseline de l'historique : etat initial (apres recalc) comme reference d'undo.
  pertHistoryReset();

  // ── Toolbar ─────────────────────────────────────────────────────────────────

  // Les 3 boutons d'ajout passent par addNodeAt (sans position) → nœud centré
  // sur le milieu de l'espace de travail visible, taille calculee au prealable.
  document.getElementById("btn-add-activity").addEventListener("click", () => {
    addNodeAt("pert/activity");
  });

  document.getElementById("btn-add-milestone").addEventListener("click", () => {
    addNodeAt("pert/milestone");
  });

  document.getElementById("btn-add-label").addEventListener("click", () => {
    addNodeAt("pert/label");
  });

  document.getElementById("btn-layout").addEventListener("click", () => {
    pertAutoLayout();
    pertHistoryMark();   // les positions changent → cran d'historique
    showToast("Nœuds réorganisés chronologiquement");
    pertZoomToFit();
  });

  document.getElementById("btn-fit").addEventListener("click", () => {
    pertZoomToFit();
  });

  // Zoom au clavier/souris sans molette : boutons −/+ autour de « Tout afficher ».
  // changeScale (natif LiteGraph) clampe [min_scale, max_scale] et recentre sur le
  // milieu du canvas visible (zooming_center par defaut = centre de l'element).
  function pertZoomBy(factor) {
    lgCanvas.ds.changeScale(lgCanvas.ds.scale * factor);
    lgCanvas.setDirty(true, true);
  }
  document.getElementById("btn-zoom-out").addEventListener("click", () => pertZoomBy(1 / 1.2));
  document.getElementById("btn-zoom-in").addEventListener("click", () => pertZoomBy(1.2));

  // Toggle grille aimantée (snap-to-grid) : bascule l'état + visibilité de grille.
  document.getElementById("btn-snap").addEventListener("click", () => {
    window.pertSnapEnabled = !window.pertSnapEnabled;
    lgCanvas.align_to_grid = window.pertSnapEnabled; // alignement natif au déplacement
    document.getElementById("btn-snap").classList.toggle("active", window.pertSnapEnabled);
    lgCanvas.setDirty(true, true); // redessine (affiche / masque la grille)
    showToast(window.pertSnapEnabled
      ? "Grille aimantée activée — les nœuds s'alignent au déplacement"
      : "Grille aimantée désactivée");
  });

  // S7 (C) — Filtre / mise en evidence par groupe ou couleur. Menu deroulant CUSTOM
  // (les <option> natives n'affichent pas de couleur de fond sous Firefox) : pastilles
  // de couleur garanties dans tous les navigateurs. La liste est reconstruite a chaque
  // ouverture pour refleter l'etat courant (groupes/couleurs presents).
  const filterTrigger = document.getElementById("filter-trigger");
  if (filterTrigger) {
    updateFilterTrigger();
    filterTrigger.addEventListener("click", (e) => { e.stopPropagation(); toggleFilterMenu(); });
    // Clic hors du controle → ferme le menu.
    document.addEventListener("click", (e) => {
      const ctrl = document.getElementById("filter-control");
      if (ctrl && !ctrl.contains(e.target)) closeFilterMenu();
    });
    // Echap → ferme le menu.
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFilterMenu(); });
  }

  // Undo / Redo (Session 4)
  document.getElementById("btn-undo").addEventListener("click", () => pertUndo());
  document.getElementById("btn-redo").addEventListener("click", () => pertRedo());

  // Import Excel legacy (#8) : ouvre le selecteur de fichier
  document.getElementById("btn-import").addEventListener("click", () => {
    document.getElementById("excel-input").value = ""; // re-selection du meme fichier OK
    document.getElementById("excel-input").click();
  });
  document.getElementById("excel-input").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleExcelFile(file);
  });

  // Bouton « À propos » : auteur, licence, date de génération du bundle et tag main.
  document.getElementById("btn-info").addEventListener("click", openAbout);
  document.getElementById("about-close").addEventListener("click", () => {
    document.getElementById("about-dialog").style.display = "none";
  });

  document.getElementById("btn-settings").addEventListener("click", openSettings);
  document.getElementById("settings-ok").addEventListener("click", saveSettings);
  document.getElementById("settings-cancel").addEventListener("click", () => {
    document.getElementById("settings-dialog").style.display = "none";
  });

  // ── Persistance JSON (.pert) — Session 3 ────────────────────────────────────
  document.getElementById("btn-save").addEventListener("click", () => {
    guardUI("Sauvegarde impossible", () => pertSaveProject());
  });
  document.getElementById("btn-open").addEventListener("click", () => {
    document.getElementById("file-input").value = ""; // re-selection du meme fichier OK
    document.getElementById("file-input").click();
  });
  document.getElementById("file-input").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) guardUI("Ouverture impossible", () => pertLoadProject(file));
  });

  // ── Export PNG / PDF — Session 3 ────────────────────────────────────────────
  document.getElementById("btn-export-png").addEventListener("click", () => {
    guardUI("Export PNG impossible", () => pertExportPNG());
  });
  document.getElementById("btn-export-pdf").addEventListener("click", () => {
    guardUI("Export PDF impossible", () => pertExportPDF());
  });

  // ── Raccourcis clavier ──────────────────────────────────────────────────────

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if (e.ctrlKey && e.key === "a") {
      e.preventDefault();
      lgCanvas.selectNodes();   // sans argument → selectionne tous les noeuds
      return;
    }

    // Ctrl+S → sauvegarder le projet (on bloque le dialogue natif du navigateur)
    if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      pertSaveProject();
      return;
    }

    // Undo : Ctrl+Z  /  Redo : Ctrl+Y ou Ctrl+Shift+Z (conventions navigateur)
    if (e.ctrlKey && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      pertUndo();
      return;
    }
    if (e.ctrlKey && ((e.key === "y" || e.key === "Y") ||
        (e.shiftKey && (e.key === "z" || e.key === "Z")))) {
      e.preventDefault();
      pertRedo();
      return;
    }

    // Copier / coller : on reutilise le presse-papier interne de LiteGraph
    // (copyToClipboard/pasteFromClipboard, via localStorage). Le collage place
    // les noeuds a la derniere position connue de la souris sur le canvas, et
    // recree les liens internes a la selection copiee.
    if (e.ctrlKey && (e.key === "c" || e.key === "C")) {
      lgCanvas.copyToClipboard();
      return;
    }
    if (e.ctrlKey && (e.key === "v" || e.key === "V")) {
      lgCanvas.pasteFromClipboard();
      pertEnsureUids();   // #34 les noeuds colles recopient l'uid → on les regenere
      pertRecalc();
      return;
    }
  });

  // ── Filet de sécurité global : surface les erreurs inattendues ───────────────
  // En file:// (pas de console accessible pour l'utilisateur métier), une exception
  // non rattrapée passerait inaperçue. On la signale par un toast rouge discret.
  window.addEventListener("error", (e) => {
    showError("Erreur inattendue : " + (e && e.message ? e.message : "voir la console"));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e && e.reason;
    showError("Erreur inattendue : " + (r && r.message ? r.message : "voir la console"));
  });

  // ── Barre de statut ─────────────────────────────────────────────────────────

  setInterval(updateStatus, 600);
  updateStatus();

  // ── Sauvegarde automatique / recuperation apres plantage ─────────────────────
  // Demarre le timer d'ecriture puis propose de restaurer un eventuel snapshot
  // (issu d'une session precedente qui s'est mal terminee). Appele en dernier :
  // pertApplyProject (utilise par la restauration) doit etre pleinement operationnel.
  if (window.pertAutosaveStart) pertAutosaveStart();
  if (window.pertAutosaveCheckRecovery) pertAutosaveCheckRecovery();
});

// ─── Utilitaires canvas ───────────────────────────────────────────────────────

function getCanvasCenter() {
  const lgCanvas = window.pertCanvas;
  const canvasEl = document.getElementById("pertCanvas");
  // Convertir le centre de l'écran (canvas visible) en coordonnées graphe.
  // Convention LiteGraph : ecran = (graphe + offset) * scale
  //   → graphe = ecran / scale - offset  (cf. DragAndScale.convertCanvasToOffset)
  const cx = canvasEl.width / 2;
  const cy = canvasEl.height / 2;
  return [
    cx / lgCanvas.ds.scale - lgCanvas.ds.offset[0],
    cy / lgCanvas.ds.scale - lgCanvas.ds.offset[1]
  ];
}

// Ajuste zoom + cadrage pour que l'intégralité du planning tienne à l'écran.
// Calcule la boîte englobante de tous les nœuds (coords graphe), puis règle
// l'échelle et l'offset du DragAndScale LiteGraph pour la centrer.
// Convention LiteGraph : ecran = (graphe + offset) * scale.
function pertZoomToFit() {
  const lgCanvas = window.pertCanvas;
  const graph = window.pertGraph;
  const canvasEl = document.getElementById("pertCanvas");
  const nodes = graph && graph._nodes ? graph._nodes : [];
  if (!nodes.length) return;

  // Boîte englobante de tous les nœuds (getBounding renvoie [x, y, w, h])
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const b = new Float32Array(4);
  for (const n of nodes) {
    n.getBounding(b);
    minX = Math.min(minX, b[0]);
    minY = Math.min(minY, b[1]);
    maxX = Math.max(maxX, b[0] + b[2]);
    maxY = Math.max(maxY, b[1] + b[3]);
  }
  const bw = maxX - minX, bh = maxY - minY;
  if (bw <= 0 || bh <= 0) return;

  const margin = 40; // marge en pixels autour du planning
  const availW = Math.max(1, canvasEl.width - 2 * margin);
  const availH = Math.max(1, canvasEl.height - 2 * margin);

  // Échelle : on remplit au mieux sans dépasser 100 % (pas de sur-zoom)
  let scale = Math.min(availW / bw, availH / bh);
  scale = Math.max(0.1, Math.min(1, scale));

  // Centrer la boîte englobante sur le centre du canvas
  const gcx = minX + bw / 2, gcy = minY + bh / 2;
  lgCanvas.ds.scale = scale;
  lgCanvas.ds.offset[0] = (canvasEl.width / 2) / scale - gcx;
  lgCanvas.ds.offset[1] = (canvasEl.height / 2) / scale - gcy;

  lgCanvas.setDirty(true, true);
}

// ─── Panneau propriétés ───────────────────────────────────────────────────────

function showProperties(node) {
  const panel = document.getElementById("properties-panel");
  const content = document.getElementById("properties-content");
  // Le panneau est toujours affiché
  panel.style.display = "flex";
  content.innerHTML = "";

  // #7 Tracé du chemin critique depuis le nœud sélectionné (sinon, par défaut,
  // depuis le nœud le plus éloigné de T0 quand rien n'est sélectionné).
  const isPert = node && (node.type === "pert/activity" || node.type === "pert/milestone");
  window.pertHighlightTargetId = isPert ? node.id : null;
  if (window.pertHighlightCriticalPath) pertHighlightCriticalPath(window.pertHighlightTargetId);

  if (!node) {
    content.innerHTML = '<p class="prop-empty">Sélectionnez un nœud<br>pour éditer ses propriétés.</p>';
    return;
  }

  if (node.type === "pert/activity") {
    buildField(content, "Libellé", "text", node.properties.label, v => {
      node.properties.label = v;
      node.updateSize();           // recalcul largeur + retour à la ligne (#4)
      node.setDirtyCanvas(true, true);
    });
    buildField(content, "Durée", "number", node.properties.duration, v => {
      node.properties.duration = parseFloat(v) || 0;
      node.updateSize();
      node.setDirtyCanvas(true);
      pertRecalc();
      fillCalcSection(node);
    }, { min: 0, step: 0.5 });
    // Estimation de cout (S8.5) : ETP modifiable. Le cout en decoule (affiche en lecture
    // seule dans la section calculs via fillCalcSection). Pas de pertRecalc : l'ETP
    // n'affecte pas l'ordonnancement, seulement le cout → on rafraichit juste le cout.
    buildField(content, "ETP (équivalent temps plein)", "number", node.properties.etp, v => {
      node.properties.etp = parseFloat(v) || 0;
      node.setDirtyCanvas(true);
      fillCalcSection(node);
    }, { min: 0, step: 0.1 });
    // Responsable : combobox enrichissable (#13 amorce) — texte libre + reproposition
    // des responsables deja saisis (datalist) pour une orthographe coherente.
    buildCombobox(content, "Responsable", node.properties.responsible, collectResponsibles(), v => {
      node.properties.responsible = v;
      node.updateSize();           // #8 l'en-tete doit grandir pour loger la ligne 👤
      node.setDirtyCanvas(true, true);
    }, null, { optionsProvider: collectResponsibles });

    // #2 Couleur — on garde la reference de l'input pour resynchroniser sa valeur
    // quand le groupe vient d'imposer sa teinte. #14 : changer la couleur d'une
    // activite groupee met a jour la couleur du groupe et recolore tous ses membres.
    const colorInput = buildField(content, "Couleur", "color", node.properties.color, v => {
      node.properties.color = v;
      node.color = v;
      const g = (node.properties.group || "").trim();
      if (g) { pertGroups()[g] = v; pertRecolorGroup(g, v); }
      node.setDirtyCanvas(true);
    });

    // #2/#14 Groupe : combobox enrichissable. La teinte du groupe est appliquee a la
    // VALIDATION du champ (change/selection), pas a chaque frappe, pour ne pas
    // perturber la saisie ni reconstruire le panneau pendant qu'on tape.
    buildCombobox(content, "Groupe", node.properties.group, collectGroupNames(),
      v => { node.properties.group = v; },   // onInput : memorise le texte au fil de la frappe
      v => {                                  // onCommit : applique la teinte du groupe
        node.properties.group = (v || "").trim();
        pertApplyGroup(node);
        if (colorInput) colorInput.value = node.properties.color; // resync sans rebuild
        node.updateSize();
        node.setDirtyCanvas(true, true);
      },
      // Menu "▾" : liste live des groupes + pastille de la couleur memorisee de chacun.
      { optionsProvider: collectGroupNames, swatchFor: g => pertGroups()[g] || null });

    // Action explicite : rattacher au groupe courant toutes les taches de meme couleur
    // (pratique pour tagger un lot importe entier). Lit le groupe au moment du clic.
    const sameColorBtn = document.createElement("button");
    sameColorBtn.className = "panel-action";
    sameColorBtn.textContent = "Appliquer ce groupe aux tâches de même couleur";
    sameColorBtn.title = "Affecte le groupe courant à toutes les autres activités de même couleur";
    sameColorBtn.addEventListener("click", () => pertApplyGroupToSameColor(node));
    content.appendChild(sameColorBtn);

    // #12 Note libre (hypotheses de duree, contenu reel de la tache). Panneau
    // uniquement — jamais rendue sur le nœud (cf. nodes.js). Pas de updateSize ni de
    // setDirtyCanvas : la note n'affecte pas l'apparence du nœud.
    buildTextarea(content, "Notes (hypothèses, contenu réel)", node.properties.notes, v => {
      node.properties.notes = v;
    });

    buildCalcSection(content, node);

  } else if (node.type === "pert/milestone") {
    buildField(content, "Libellé", "text", node.properties.label, v => {
      node.properties.label = v;
      node.updateSize();           // recalcul largeur + retour à la ligne (#4/#5)
      node.setDirtyCanvas(true, true);
    });
    buildField(content, "Date-cible (à tenir)", "date", node.properties.due_date, v => {
      node.properties.due_date = v;
      node.setDirtyCanvas(true);
      pertRecalc();
      fillCalcSection(node);
    });
    // #17 Type de jalon (importance contractuelle) : aucun / DOTD / COTD / Ingenierie.
    // Options derivees de PERT_MILESTONE_TAGS (nodes.js) → source unique. La pastille
    // peut changer la taille du nœud → updateSize.
    const tagOptions = [{ value: "", label: "Aucun" }].concat(
      PERT_MILESTONE_TAGS.map(t => ({ value: t.value, label: t.label })));
    buildSelect(content, "Type", node.properties.tag, tagOptions, v => {
      node.properties.tag = v;
      node.updateSize();
      node.setDirtyCanvas(true, true);
    });

    buildCalcSection(content, node);

  } else if (node.type === "pert/label") {
    buildTextarea(content, "Texte", node.properties.text, v => {
      node.properties.text = v;
      node.updateSize();           // la boite s'ajuste au texte (largeur + lignes)
      node.setDirtyCanvas(true, true);
    });
  }

  // Bouton supprimer
  const delBtn = document.createElement("button");
  delBtn.id = "btn-delete-node";
  delBtn.textContent = "Supprimer";
  delBtn.addEventListener("click", () => {
    window.pertGraph.remove(node);
    hideProperties();
  });
  content.appendChild(delBtn);
}

function hideProperties() {
  showProperties(null);
}

function buildField(parent, labelText, type, value, onChange, attrs) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = type;
  input.value = value !== null && value !== undefined ? value : "";
  if (attrs) Object.assign(input, attrs);
  const handler = e => { onChange(e.target.value); pertHistoryMark(); };
  input.addEventListener(type === "color" ? "input" : "change", handler);
  if (type !== "color") input.addEventListener("input", handler);
  label.appendChild(input);
  parent.appendChild(label);
  return input;
}

// Combobox enrichissable = <input> texte (saisie libre) + bouton "▾" ouvrant un MENU
// CUSTOM listant TOUS les choix existants (Responsable, Groupe). L'utilisateur tape un
// nouveau nom OU clique un existant dans le menu. onInput est appele a chaque frappe
// (memorisation au fil de l'eau) ; onCommit (optionnel) a la validation (change/clic dans
// le menu) — sert au Groupe pour n'appliquer la teinte qu'une fois la saisie terminee.
// Si onCommit est omis, onInput fait office des deux.
//
// Pourquoi un menu custom et pas un <datalist> natif : le <datalist> est inutilisable
// pour "choisir parmi les valeurs existantes". (1) Firefox : autocomplete="off" le
// masque — mais meme sans, (2) Chrome/Edge FILTRENT les suggestions par la valeur
// COURANTE du champ → rouvrir une activite deja groupee "WP1" ne propose plus que "WP1",
// jamais les autres groupes. Le menu custom (meme pattern que le filtre S7) affiche
// toujours TOUS les choix, identiquement sur Firefox/Edge/Chrome. On conserve neanmoins
// un <datalist> discret pour l'autocompletion a la frappe (complement, pas le selecteur).
//
// config (optionnel) : { optionsProvider: fn()->[noms], swatchFor: fn(nom)->couleur|null }
//   - optionsProvider : recalcule la liste a l'ouverture du menu (sinon `options` fige au build)
//   - swatchFor       : pastille de couleur devant chaque ligne (Groupe → couleur du groupe)
function buildCombobox(parent, labelText, value, options, onInput, onCommit, config) {
  config = config || {};
  const label = document.createElement("label");
  label.textContent = labelText;

  const wrap = document.createElement("div");
  wrap.className = "combo-wrap";

  const input = document.createElement("input");
  input.type = "text";
  input.value = value !== null && value !== undefined ? value : "";
  // Pas d'autocomplete="off" (cf. en-tete : Firefox masquerait le <datalist> de frappe).
  const listId = "dl-" + labelText.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  input.setAttribute("list", listId);
  const dl = document.createElement("datalist");
  dl.id = listId;
  (options || []).forEach(o => {
    const opt = document.createElement("option");
    opt.value = o;
    dl.appendChild(opt);
  });
  input.addEventListener("input", e => { onInput(e.target.value); pertHistoryMark(); });
  input.addEventListener("change", e => { (onCommit || onInput)(e.target.value); pertHistoryMark(); });

  // Bouton "▾" + menu custom (robuste multi-navigateurs).
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "combo-toggle";
  toggle.textContent = "▾"; // ▾
  toggle.tabIndex = -1;
  toggle.title = "Choisir parmi les valeurs existantes";

  const menu = document.createElement("div");
  menu.className = "combo-menu";
  menu.hidden = true;

  function commit(v) {
    input.value = v;
    onInput(v);
    (onCommit || onInput)(v);
    pertHistoryMark();
  }
  function buildRows() {
    menu.textContent = "";
    const opts = typeof config.optionsProvider === "function" ? config.optionsProvider() : (options || []);
    if (!opts.length) {
      const empty = document.createElement("div");
      empty.className = "combo-menu-empty";
      empty.textContent = "Aucune valeur existante";
      menu.appendChild(empty);
      return;
    }
    opts.forEach(o => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "combo-menu-row" + (o === input.value ? " active" : "");
      if (config.swatchFor) {
        const c = config.swatchFor(o);
        const sw = document.createElement("span");
        sw.className = "filter-swatch" + (c ? "" : " none");
        if (c) sw.style.background = c;
        row.appendChild(sw);
      }
      const txt = document.createElement("span");
      txt.className = "combo-row-label";
      txt.textContent = o;
      row.appendChild(txt);
      row.addEventListener("click", e => { e.stopPropagation(); commit(o); closeMenu(); });
      menu.appendChild(row);
    });
  }
  // Ecouteurs "clic exterieur"/Echap attaches SEULEMENT tant que le menu est ouvert
  // (retires a la fermeture → pas d'accumulation quand le panneau est reconstruit).
  let outside = null;
  function escClose(e) { if (e.key === "Escape") closeMenu(); }
  function openMenu() {
    buildRows();
    menu.hidden = false;
    outside = e => { if (!wrap.contains(e.target)) closeMenu(); };
    setTimeout(() => document.addEventListener("click", outside), 0); // apres le clic courant
    document.addEventListener("keydown", escClose);
  }
  function closeMenu() {
    menu.hidden = true;
    if (outside) { document.removeEventListener("click", outside); outside = null; }
    document.removeEventListener("keydown", escClose);
  }
  toggle.addEventListener("click", e => {
    e.stopPropagation();
    if (menu.hidden) openMenu(); else closeMenu();
  });

  wrap.appendChild(input);
  wrap.appendChild(toggle);
  wrap.appendChild(menu);
  wrap.appendChild(dl);
  label.appendChild(wrap);
  parent.appendChild(label);
  return input;
}

// ─── Groupes (WP / métier / service) — registre couleur #14 ──────────────────────

// Registre des couleurs memorisees par groupe (cree paresseusement).
function pertGroups() {
  if (!window.pertMeta.groups) window.pertMeta.groups = {};
  return window.pertMeta.groups;
}

// Noms de groupes connus (registre + groupes effectivement portes par des Activites),
// tries — alimente la datalist du combobox Groupe.
function collectGroupNames() {
  const set = new Set();
  Object.keys(pertGroups()).forEach(k => { if (k) set.add(k); });
  const g = window.pertGraph;
  if (g && g._nodes) g._nodes.forEach(n => {
    if (n.type === "pert/activity" && n.properties && n.properties.group) set.add(n.properties.group);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
}

// Responsables deja saisis (datalist du combobox Responsable, #13 amorce).
function collectResponsibles() {
  const set = new Set();
  const g = window.pertGraph;
  if (g && g._nodes) g._nodes.forEach(n => {
    if (n.type === "pert/activity" && n.properties && n.properties.responsible) set.add(n.properties.responsible);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
}

// "Premier venu fixe la teinte" (#14) : a l'affectation d'un groupe, l'Activite herite
// de la couleur memorisee du groupe si elle existe (#4 harmonisation), sinon sa couleur
// courante DEVIENT celle du groupe (premiere activite a porter ce nom). Groupe vide →
// rien (l'Activite garde sa couleur individuelle, compatible import).
function pertApplyGroup(node) {
  const g = (node.properties.group || "").trim();
  node.properties.group = g;
  if (!g) return;
  const reg = pertGroups();
  if (reg[g]) { node.properties.color = reg[g]; node.color = reg[g]; }
  else { reg[g] = node.properties.color; }
}

// Action explicite (bouton du panneau) : affecte le groupe courant a toutes les autres
// Activites de MEME couleur. Pensee pour les lots importes (une couleur = un lot) : on
// tague une tache et on rattache tout le lot d'un clic. Choix "bouton explicite" (pas
// d'automatisme) pour eviter les surprises avec le bleu par defaut des nouvelles taches.
// Les taches deja dans ce groupe sont ignorees ; les autres voient leur groupe ecrase
// (action deliberee, annulable par Ctrl+Z).
function pertApplyGroupToSameColor(node) {
  const g = (node.properties.group || "").trim();
  if (!g) { showToast("Renseignez d'abord un groupe pour cette activité"); return; }
  const color = (node.properties.color || "").toLowerCase();
  const graph = window.pertGraph;
  if (!graph || !graph._nodes) return;
  // S'assure que le groupe est enregistre (premier-venu) avant de propager.
  pertApplyGroup(node);
  let n = 0;
  graph._nodes.forEach(other => {
    if (other === node || other.type !== "pert/activity" || !other.properties) return;
    if ((other.properties.color || "").toLowerCase() !== color) return;
    if ((other.properties.group || "").trim() === g) return; // deja ce groupe
    other.properties.group = g;
    other.setDirtyCanvas(true);
    n++;
  });
  if (n > 0) pertHistoryMark();
  showToast(n > 0
    ? n + " tâche(s) de même couleur rattachée(s) au groupe « " + g + " »"
    : "Aucune autre tâche de cette couleur à rattacher");
}

// Propage une couleur a toutes les Activites d'un groupe (changement de couleur d'un
// membre → tout le groupe se recolore, #4).
function pertRecolorGroup(groupName, color) {
  const g = window.pertGraph;
  if (!g || !g._nodes) return;
  g._nodes.forEach(n => {
    if (n.type === "pert/activity" && n.properties && (n.properties.group || "").trim() === groupName) {
      n.properties.color = color;
      n.color = color;
      n.setDirtyCanvas(true);
    }
  });
}

// ─── #16 Filtre / mise en évidence (par groupe ou couleur) — S7 (C) ──────────────
//
// Le filtre est un etat de VUE (window.pertFilter), non serialise dans le .pert :
//   null                         → aucun filtre (tout en pleine intensite)
//   { type:"group", value:"WP1" } → seules les Activites du groupe restent vives
//   { type:"color", value:"#.." } → seules les Activites de cette couleur restent vives
// Les nœuds non concernes sont ESTOMPES (voile translucide dessine dans nodes.js,
// pertDrawDimVeil). On ne cache rien (les liens et la structure restent lisibles),
// on attire l'œil sur l'ensemble selectionne. Couvre import (couleur d'un lot) et
// regroupement metier (groupe). Decision du 28/06/2026 : filtre apres socle A+B.

// Couleurs distinctes effectivement portees par des Activites du graphe.
function collectActivityColors() {
  const seen = new Set();
  const colors = [];
  const g = window.pertGraph;
  if (g && g._nodes) g._nodes.forEach(n => {
    if (n.type === "pert/activity" && n.properties && n.properties.color) {
      const c = n.properties.color.toLowerCase();
      if (!seen.has(c)) { seen.add(c); colors.push(n.properties.color); }
    }
  });
  return colors;
}

// Libelle parlant d'une couleur dans le filtre : le(s) groupe(s) du registre qui
// portent cette teinte, ou "Sans groupe" (typiquement un lot importe non rattache).
function pertColorGroupLabel(color) {
  const reg = pertGroups();
  const lc = String(color || "").toLowerCase();
  const names = Object.keys(reg).filter(k => String(reg[k] || "").toLowerCase() === lc);
  return names.length ? names.join(", ") : "Sans groupe";
}

// Egalite de deux descripteurs de filtre (null compris ; couleur insensible casse).
function filterEquals(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.type === b.type
    && String(a.value).toLowerCase() === String(b.value).toLowerCase();
}

// Le filtre courant correspond-il encore a un groupe/couleur existant ? (un groupe
// supprime ou une couleur disparue doit invalider le filtre, sinon tout reste estompe).
function pertFilterStillValid() {
  const f = window.pertFilter;
  if (!f) return true;
  if (f.type === "group") return collectGroupNames().indexOf(f.value) !== -1;
  if (f.type === "color") {
    const lc = String(f.value).toLowerCase();
    return collectActivityColors().some(c => c.toLowerCase() === lc);
  }
  return false;
}

// ── Menu déroulant custom (pastilles de couleur, compatible Firefox) ────────────

function openFilterMenu() {
  refreshFilterOptions();
  const m = document.getElementById("filter-menu");
  const t = document.getElementById("filter-trigger");
  if (m) m.hidden = false;
  if (t) t.setAttribute("aria-expanded", "true");
}
function closeFilterMenu() {
  const m = document.getElementById("filter-menu");
  const t = document.getElementById("filter-trigger");
  if (m) m.hidden = true;
  if (t) t.setAttribute("aria-expanded", "false");
}
function toggleFilterMenu() {
  const m = document.getElementById("filter-menu");
  if (!m) return;
  if (m.hidden) openFilterMenu(); else closeFilterMenu();
}

// Crée une pastille de couleur (carré). color null → motif hachuré "aucun".
function buildFilterSwatch(color) {
  const sw = document.createElement("span");
  sw.className = "filter-swatch" + (color ? "" : " none");
  if (color) sw.style.background = color;
  return sw;
}

// En-tête de section dans le menu (Groupes / Couleurs).
function buildFilterHeader(text) {
  const h = document.createElement("div");
  h.className = "filter-menu-header";
  h.textContent = text;
  return h;
}

// Une ligne cliquable du menu : pastille + libellé. filter = descripteur (ou null
// pour "aucun"). color = teinte de la pastille (ou null → motif "aucun").
function buildFilterRow(filter, label, color) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "filter-menu-row" + (filterEquals(window.pertFilter, filter) ? " active" : "");
  row.appendChild(buildFilterSwatch(color));
  const txt = document.createElement("span");
  txt.className = "filter-row-label";
  txt.textContent = label;
  row.appendChild(txt);
  row.addEventListener("click", (e) => {
    e.stopPropagation();
    applyFilter(filter);
    updateFilterTrigger();
    closeFilterMenu();
  });
  return row;
}

// (Re)construit le contenu du menu de filtre (aucun + groupes + couleurs).
function refreshFilterOptions() {
  // Invalide d'abord un filtre devenu obsolete (groupe/couleur disparu).
  if (!pertFilterStillValid()) { applyFilter(null); updateFilterTrigger(); }

  const menu = document.getElementById("filter-menu");
  if (!menu) return;
  menu.innerHTML = "";

  menu.appendChild(buildFilterRow(null, "Aucun filtre", null));

  const reg = pertGroups();
  const groups = collectGroupNames();
  if (groups.length) {
    menu.appendChild(buildFilterHeader("Groupes"));
    groups.forEach(g => menu.appendChild(buildFilterRow({ type: "group", value: g }, g, reg[g] || null)));
  }

  const colors = collectActivityColors();
  if (colors.length) {
    menu.appendChild(buildFilterHeader("Couleurs"));
    colors.forEach(c => menu.appendChild(buildFilterRow({ type: "color", value: c }, pertColorGroupLabel(c), c)));
  }
}

// Met à jour l'affichage du déclencheur (pastille + libellé du filtre courant).
function updateFilterTrigger() {
  const cur = document.getElementById("filter-current");
  if (!cur) return;
  cur.innerHTML = "";
  const f = window.pertFilter;
  if (!f) { cur.textContent = "🔎 Filtre : aucun"; return; }
  const color = f.type === "group" ? (pertGroups()[f.value] || null) : f.value;
  const label = f.type === "group" ? f.value : pertColorGroupLabel(f.value);
  cur.appendChild(buildFilterSwatch(color));
  const txt = document.createElement("span");
  txt.className = "filter-row-label";
  txt.textContent = label;
  cur.appendChild(txt);
}

// Active un filtre (ou null), redessine et informe l'utilisateur.
function applyFilter(filter) {
  window.pertFilter = filter;
  if (window.pertGraph) window.pertGraph.setDirtyCanvas(true, true);
  if (!filter) { showToast("Filtre désactivé"); return; }
  const label = filter.type === "group"
    ? "groupe « " + filter.value + " »"
    : "couleur de « " + pertColorGroupLabel(filter.value) + " »";
  showToast("Filtre actif : " + label + " mis en évidence");
}
window.refreshFilterOptions = refreshFilterOptions;
window.updateFilterTrigger = updateFilterTrigger;

function buildTextarea(parent, labelText, value, onChange) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const ta = document.createElement("textarea");
  ta.rows = 5;
  ta.value = value || "";
  // pertHistoryMark coalesce la saisie (un seul cran d'undo par edition de zone)
  ta.addEventListener("input", e => { onChange(e.target.value); pertHistoryMark(); });
  label.appendChild(ta);
  parent.appendChild(label);
  return ta;
}

// Liste deroulante simple (label + <select>). options = [{value, label}]. Sert au
// type de Jalon (#17). Marque l'historique a chaque changement.
function buildSelect(parent, labelText, value, options, onChange) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const sel = document.createElement("select");
  options.forEach(o => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === (value || "")) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", e => { onChange(e.target.value); pertHistoryMark(); });
  label.appendChild(sel);
  parent.appendChild(label);
  return sel;
}

function buildReadonly(parent, labelText, value, cls) {
  const row = document.createElement("div");
  row.className = "readonly-row" + (cls ? " " + cls : "");
  row.innerHTML = `<span class="ro-label">${labelText}</span><span class="ro-value">${value !== null && value !== undefined ? value : "—"}</span>`;
  parent.appendChild(row);
}

// Conteneur dédié aux valeurs calculées (rafraîchi sans reconstruire les champs)
function buildCalcSection(parent, node) {
  const sec = document.createElement("div");
  sec.id = "calc-section";
  parent.appendChild(sec);
  fillCalcSection(node);
}

// (Re)remplit la section calculs pour le nœud donné — sans toucher aux champs éditables
function fillCalcSection(node) {
  const sec = document.getElementById("calc-section");
  if (!sec || !node) return;
  sec.innerHTML = "";

  const unit = (window.pertMeta && window.pertMeta.unit) || "j";
  const asDate = off => {
    const d = pertOffsetToDate(off);
    return d ? pertFormatDate(d) : (off !== null && off !== undefined ? "+" + off + " " + unit : "—");
  };

  if (node.type === "pert/activity") {
    if (node.es === null) {
      sec.innerHTML = '<p class="prop-empty">Non calculé (cycle ou T0 absent ?)</p>';
      return;
    }
    const title = document.createElement("div");
    title.className = "calc-title";
    title.textContent = node.is_critical ? "⛔ Chemin critique" : "Valeurs calculées";
    sec.appendChild(title);
    buildReadonly(sec, "Début t.tôt (ES)", asDate(node.es));
    buildReadonly(sec, "Fin t.tôt (EF)", asDate(node.ef));
    buildReadonly(sec, "Début t.tard (LS)", asDate(node.ls));
    buildReadonly(sec, "Fin t.tard (LF)", asDate(node.lf));
    buildReadonly(sec, "Marge", pertFormatSlack(node.slack) + " " + unit,
      node.is_critical ? "ro-critical" : "");
    // Estimation de cout (S8.5) — non modifiable, derive de duree × ETP × taux.
    buildReadonly(sec, "Coût estimé", pertFormatCost(pertActivityCost(node)));

  } else if (node.type === "pert/milestone") {
    if (node.ef === null) {
      sec.innerHTML = '<p class="prop-empty">Non calculé (cycle ou T0 absent ?)</p>';
      return;
    }
    const title = document.createElement("div");
    title.className = "calc-title";
    title.textContent = node.is_critical ? "⛔ Chemin critique" : "Valeurs calculées";
    sec.appendChild(title);
    buildReadonly(sec, "Atteint t.tôt (EF)", asDate(node.ef));
    buildReadonly(sec, "Au plus tard (LF)", asDate(node.lf));
    buildReadonly(sec, "Marge", pertFormatSlack(node.slack) + " " + unit,
      node.is_critical ? "ro-critical" : "");
    if (node.target_missed) {
      buildReadonly(sec, "Cible", "⛔ non tenue", "ro-critical");
    } else if (node.properties.due_date) {
      buildReadonly(sec, "Cible", "✓ tenue");
    }
  }
}

// ─── À propos (auteur, licence, version) ────────────────────────────────────────
//
// La date de génération du bundle et le tag de la branche main sont injectés par
// scripts/build-bundle.js dans `window.PERTFLOW_BUILD` au moment du build. En mode
// développement (sources non bundlées), cet objet est absent → on l'indique.
function openAbout() {
  const c = document.getElementById("about-content");
  if (!c) return;
  c.innerHTML = "";
  const b = window.PERTFLOW_BUILD || {};
  buildReadonly(c, "Auteur", "© Stéphane Guichard");
  buildReadonly(c, "Licence", "MIT");
  buildReadonly(c, "Version (tag main)", b.tag || "développement (non bundlée)");
  buildReadonly(c, "Bundle généré le", b.date || "—");
  document.getElementById("about-dialog").style.display = "flex";
}

// ─── Paramètres ───────────────────────────────────────────────────────────────

function openSettings() {
  document.getElementById("settings-title").value = window.pertMeta.title || "";
  document.getElementById("settings-t0").value = window.pertMeta.t0 || "";
  document.getElementById("settings-unit").value = window.pertMeta.unit || "j";
  document.getElementById("settings-hgap").value =
    window.pertMeta.layout_gap != null ? window.pertMeta.layout_gap : 30;
  // #18 case cochee par defaut (proportionnalite active sauf desactivation explicite)
  document.getElementById("settings-propwidth").checked =
    window.pertMeta.prop_width !== false;
  // Sauvegarde automatique (activee par defaut : cochee sauf desactivation explicite)
  document.getElementById("settings-autosave").checked =
    window.pertMeta.autosave !== false;
  // S8.5 parametres d'estimation de cout
  document.getElementById("settings-hpm").value =
    window.pertMeta.hours_per_month != null ? window.pertMeta.hours_per_month : 135;
  document.getElementById("settings-hpd").value =
    window.pertMeta.hours_per_day != null ? window.pertMeta.hours_per_day : 8;
  document.getElementById("settings-rate").value =
    window.pertMeta.hourly_rate != null ? window.pertMeta.hourly_rate : 136;
  document.getElementById("settings-dialog").style.display = "flex";
}

function saveSettings() {
  window.pertMeta.title = document.getElementById("settings-title").value;
  window.pertMeta.t0 = document.getElementById("settings-t0").value;
  window.pertMeta.unit = document.getElementById("settings-unit").value;
  const hgap = parseFloat(document.getElementById("settings-hgap").value);
  window.pertMeta.layout_gap = isNaN(hgap) ? 30 : Math.max(0, hgap);
  // #18 largeur ∝ duree (re-applique par updateSize sur tous les nœuds ci-dessous)
  window.pertMeta.prop_width = document.getElementById("settings-propwidth").checked;
  // Sauvegarde automatique : bascule prise en compte immediatement par le module
  window.pertMeta.autosave = document.getElementById("settings-autosave").checked;
  if (window.pertAutosaveOnToggle) window.pertAutosaveOnToggle();
  // S8.5 parametres de cout (planches a 0 ; defaut si champ vide/invalide)
  const hpm = parseFloat(document.getElementById("settings-hpm").value);
  const hpd = parseFloat(document.getElementById("settings-hpd").value);
  const rate = parseFloat(document.getElementById("settings-rate").value);
  window.pertMeta.hours_per_month = isNaN(hpm) ? 135 : Math.max(0, hpm);
  window.pertMeta.hours_per_day   = isNaN(hpd) ? 8   : Math.max(0, hpd);
  window.pertMeta.hourly_rate     = isNaN(rate) ? 136 : Math.max(0, rate);
  document.getElementById("settings-dialog").style.display = "none";
  document.getElementById("project-title").textContent = window.pertMeta.title || "PertFlow";
  // Recalculer les tailles (l'unité affectée dans les nœuds Activité)
  if (window.pertGraph) {
    window.pertGraph._nodes.forEach(n => { if (n.updateSize) n.updateSize(); });
    window.pertGraph.setDirtyCanvas(true, true);
  }
  // T0 / unité affectent les dates calculées et les offsets des dates-cibles
  pertRecalc();
  const sel = Object.values(window.pertCanvas.selected_nodes || {});
  if (sel.length === 1) fillCalcSection(sel[0]);
  updateStatus();
}

// ─── Barre de statut ──────────────────────────────────────────────────────────

function updateStatus() {
  const g = window.pertGraph;
  const unit = window.pertMeta.unit === "sem" ? "semaines"
    : (window.pertMeta.unit === "mois" ? "mois" : "jours");
  // Nombre de TÂCHES (Activités) — les jalons ne sont pas comptés (ce sont des
  // contraintes/sorties de chemin, pas des actions ; décision utilisateur S8.5).
  let nbTasks = 0;
  if (g && g._nodes) g._nodes.forEach(n => { if (n.type === "pert/activity") nbTasks++; });
  document.getElementById("status-nodes").textContent = nbTasks + " tâche(s)";
  document.getElementById("status-unit").textContent = "Unité : " + unit;
  document.getElementById("status-t0").textContent =
    window.pertMeta.t0 ? "T0 : " + window.pertMeta.t0 : "T0 non défini";

  // S8.5 Coût agrégé + chemin critique. Total = somme des Activités VISIBLES (hors-filtre
  // estompé exclu si un filtre est actif). Chemin critique = Activités du chemin
  // ACTUELLEMENT mis en évidence (window.pertCriticalPathIds) → SUIT la sélection (le même
  // chemin que le tracé rouge) ; sans sélection, c'est le chemin de marge minimale. On ne
  // compte que les tâches (jalons exclus). Appelé périodiquement (setInterval 600 ms) ET
  // par pertHighlightCriticalPath → reflète en continu sélection, ETP, paramètres, filtre.
  const costEl = document.getElementById("status-cost");
  if (costEl) {
    const critIds = window.pertCriticalPathIds || new Set();
    let total = 0, crit = 0, critTasks = 0;
    if (g && g._nodes) g._nodes.forEach(n => {
      if (n.type !== "pert/activity") return;
      const c = pertActivityCost(n);
      if (!window.pertFilter || !pertNodeDimmed(n)) total += c; // visible
      if (critIds.has(n.id)) { crit += c; critTasks++; }
    });
    const totalLabel = window.pertFilter ? "Coût visible" : "Coût total";
    costEl.textContent = totalLabel + " : " + pertFormatCost(total)
      + " · Chemin critique : " + critTasks + " tâche(s), " + pertFormatCost(crit);
  }
}

// ─── Toast notification ───────────────────────────────────────────────────────

function showToast(msg, isError) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.toggle("error", !!isError);
  toast.classList.add("show");
  clearTimeout(toast._t);
  // Les erreurs restent affichées un peu plus longtemps (lecture du message).
  toast._t = setTimeout(() => toast.classList.remove("show"), isError ? 4500 : 2500);
}

// Toast rouge dédié aux échecs (raccourci lisible aux points d'appel).
function showError(msg) { showToast(msg, true); }
window.showToast = showToast;
window.showError = showError;

// Exécute une action en attrapant toute exception inattendue et en la signalant
// à l'utilisateur (toast rouge) plutôt que de la laisser casser l'UI silencieusement.
// Contexte = libellé de l'action, intégré au message d'erreur.
function guardUI(context, fn) {
  try {
    fn();
  } catch (err) {
    showError(context + " : " + (err && err.message ? err.message : "erreur inattendue"));
    if (window.qtLog) window.qtLog("[PertFlow] " + context + " — " + err);
  }
}
window.guardUI = guardUI;

// ─── Import Excel legacy (#8) ───────────────────────────────────────────────────
//
// Flux : <input file> → FileReader.readAsArrayBuffer → PertExcel.importXlsm
// (lecture auto de la feuille/T0/unite via l'onglet MANUEL) → applyImportModel.
// Fallback : si la detection auto echoue, on propose le choix de la feuille.

function handleExcelFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const ab = reader.result;
    let model = null;
    try {
      model = PertExcel.importXlsm(ab); // auto via MANUEL
    } catch (err) {
      // Detection auto KO → proposer le choix de feuille
      let sheets = [];
      try { sheets = PertExcel.listPertSheets(ab); } catch (e2) { /* ignore */ }
      if (!sheets.length) {
        showToast("Import impossible : aucun PERT graphique trouvé dans ce fichier");
        return;
      }
      promptSheetChoice(sheets, (chosen) => {
        try {
          finishExcelImport(PertExcel.importXlsm(ab, chosen));
        } catch (e3) {
          showToast("Import échoué : " + e3.message);
        }
      });
      return;
    }
    guardUI("Import Excel impossible", () => finishExcelImport(model));
  };
  reader.onerror = () => showError("Lecture du fichier impossible");
  reader.readAsArrayBuffer(file);
}

// Palette de couleurs distinctes proposees pour distinguer visuellement les lots
// importes successivement (un import = une couleur appliquee a toutes ses Activites).
const IMPORT_COLOR_PALETTE = [
  "#4A90D9", // bleu (defaut historique)
  "#7ED321", // vert
  "#F5A623", // orange
  "#BD10E0", // violet
  "#50E3C2", // turquoise
  "#E94B6A", // rose
  "#9013FE", // indigo
  "#B8E986"  // vert clair
];

// Premiere couleur de la palette pas encore utilisee par une Activite du workspace
// (fallback : 1re couleur de la palette si toutes sont deja prises).
function pickDefaultImportColor() {
  const graph = window.pertGraph;
  const used = new Set();
  if (graph && graph._nodes) {
    graph._nodes.forEach(n => {
      if (n.type === "pert/activity" && n.properties && n.properties.color) {
        used.add(n.properties.color.toLowerCase());
      }
    });
  }
  const free = IMPORT_COLOR_PALETTE.find(c => !used.has(c.toLowerCase()));
  return free || IMPORT_COLOR_PALETTE[0];
}

// Demande le GROUPE (et la couleur qui en decoule) des taches importees, puis
// concatene le modele. Point de passage commun aux deux chemins d'import. S7 (A) :
// le dialogue est desormais centre groupe (cf. promptImportGroup).
function finishExcelImport(model) {
  if (!model || !model.nodes || !model.nodes.length) {
    showToast("Aucun nœud à importer");
    return;
  }
  promptImportGroup(pickDefaultImportColor(),
    (color, group) => applyImportModel(model, color, group));
}

// S7 (A) — Dialogue d'import CENTRE GROUPE. Un seul groupe par lot d'import, avec
// 3 chemins (decision utilisateur du 28/06/2026) :
//   1. Groupe EXISTANT (deja dans pertMeta.groups) → couleur HERITEE et verrouillee
//      (lue dans le registre, selecteur de couleur desactive) — coherent avec #4/#14.
//   2. NOUVEAU groupe (nom non connu) → on choisit la couleur, qui DEVIENT celle du
//      groupe ("premier venu", coherent avec S6).
//   3. AUCUN groupe (champ laisse vide) → on choisit juste une couleur, taches
//      importees SANS groupe (comportement historique preserve).
// Le rattachement effectif au groupe est fait par applyImportModel via pertApplyGroup.
function promptImportGroup(defaultColor, onChoose) {
  let dlg = document.getElementById("color-dialog");
  if (dlg) dlg.remove();
  dlg = document.createElement("div");
  dlg.id = "color-dialog";
  dlg.className = "dialog-overlay";
  dlg.style.display = "flex";

  const box = document.createElement("div");
  box.className = "dialog";
  const h = document.createElement("h3");
  h.textContent = "Groupe et couleur des tâches importées";
  box.appendChild(h);

  let current = defaultColor; // couleur courante (modifiable sauf groupe existant)

  // ── Champ Groupe (combobox enrichissable : datalist des groupes connus) ──────
  const groupLabel = document.createElement("label");
  groupLabel.className = "dialog-field";
  groupLabel.textContent = "Groupe (WP / métier / service) — laisser vide pour aucun";
  const groupInput = document.createElement("input");
  groupInput.type = "text";
  // Pas d'autocomplete="off" (cf. buildCombobox) : sous Firefox il masquerait le
  // menu deroulant du <datalist> des groupes existants.
  groupInput.setAttribute("list", "dl-import-group");
  groupInput.placeholder = "Aucun groupe";
  const dl = document.createElement("datalist");
  dl.id = "dl-import-group";
  collectGroupNames().forEach(g => {
    const opt = document.createElement("option");
    opt.value = g;
    dl.appendChild(opt);
  });
  groupLabel.appendChild(groupInput);
  groupLabel.appendChild(dl);
  box.appendChild(groupLabel);

  // Note dynamique : indique le chemin actif (heritee / nouvelle / aucune).
  const note = document.createElement("p");
  note.className = "dialog-note";
  box.appendChild(note);

  // ── Choix de couleur (pastilles + selecteur libre) ───────────────────────────
  const swatches = document.createElement("div");
  swatches.className = "color-swatches";
  const picker = document.createElement("input");
  picker.type = "color";
  picker.value = current;

  const syncSelected = () => {
    swatches.querySelectorAll(".color-swatch").forEach(e =>
      e.classList.toggle("selected", e.title.toLowerCase() === current.toLowerCase()));
  };

  IMPORT_COLOR_PALETTE.forEach(c => {
    const sw = document.createElement("button");
    sw.className = "color-swatch";
    sw.style.background = c;
    sw.title = c;
    sw.onclick = () => { if (picker.disabled) return; current = c; picker.value = c; syncSelected(); };
    swatches.appendChild(sw);
  });
  picker.addEventListener("input", () => { current = picker.value; syncSelected(); });

  box.appendChild(swatches);
  box.appendChild(picker);

  // Reagit a la saisie du groupe : verrouille la couleur si le groupe existe deja.
  const refreshColorState = () => {
    const g = groupInput.value.trim();
    const reg = pertGroups();
    if (g && reg[g]) {
      // Chemin 1 : groupe existant → couleur heritee, verrouillee.
      current = reg[g];
      picker.value = current;
      picker.disabled = true;
      swatches.classList.add("locked");
      note.textContent = "Couleur héritée du groupe « " + g + " » (verrouillée).";
    } else if (g) {
      // Chemin 2 : nouveau groupe → on fixe sa couleur.
      picker.disabled = false;
      swatches.classList.remove("locked");
      note.textContent = "Nouveau groupe « " + g + " » : la couleur choisie deviendra sa couleur.";
    } else {
      // Chemin 3 : aucun groupe → couleur libre, taches non groupees.
      picker.disabled = false;
      swatches.classList.remove("locked");
      note.textContent = "Aucun groupe : les tâches importées prendront simplement cette couleur.";
    }
    syncSelected();
  };
  groupInput.addEventListener("input", refreshColorState);
  refreshColorState();

  const btns = document.createElement("div");
  btns.className = "dialog-buttons";
  const cancel = document.createElement("button");
  cancel.textContent = "Annuler";
  cancel.onclick = () => dlg.remove();
  const ok = document.createElement("button");
  ok.textContent = "Importer";
  ok.className = "primary";
  ok.onclick = () => {
    const g = groupInput.value.trim();
    dlg.remove();
    onChoose(current, g);
  };
  btns.appendChild(cancel);
  btns.appendChild(ok);
  box.appendChild(btns);

  dlg.appendChild(box);
  document.body.appendChild(dlg);
  groupInput.focus();
}

// Concatene le modele d'import dans le graphe courant. importColor = couleur
// appliquee aux Activites importees ; importGroup (optionnel) = groupe auquel les
// rattacher (S7 A) → l'heritage/premier-venu de pertApplyGroup prend le relais.
function applyImportModel(model, importColor, importGroup) {
  const graph = window.pertGraph;
  if (!model || !model.nodes || !model.nodes.length) {
    showToast("Aucun nœud à importer");
    return;
  }
  const EMU = PertExcel.EMU_PER_PX;

  // Origine des positions importees (coin haut-gauche du bloc Excel).
  let impMinX = Infinity, impMinY = Infinity;
  model.nodes.forEach(n => {
    impMinX = Math.min(impMinX, n.off.x / EMU);
    impMinY = Math.min(impMinY, n.off.y / EMU);
  });

  // Decalage pour poser le bloc importe a droite du graphe existant (concatenation
  // sans recouvrement). Si le graphe est vide, on cale pres de l'origine.
  let baseX = 60, baseY = 60;
  if (graph._nodes.length) {
    let maxX = -Infinity;
    graph._nodes.forEach(n => { maxX = Math.max(maxX, n.pos[0] + n.size[0]); });
    baseX = maxX + 80;
  }
  const dx = baseX - impMinX;
  const dy = baseY - impMinY;

  // 1) Creation des noeuds (map srcName → instance pour les liens)
  const created = {};
  model.nodes.forEach(n => {
    const node = LiteGraph.createNode(
      n.type === "milestone" ? "pert/milestone" : "pert/activity");
    if (n.type === "milestone") {
      node.properties.label = n.label || "Jalon";
      node.properties.due_date = n.due_date || "";
    } else {
      node.properties.label = n.label || "Activité";
      node.properties.duration = (n.duration != null ? n.duration : 1);
      if (importColor) {
        node.properties.color = importColor;
        node.color = importColor;
      }
      // S7 (A) : rattachement au groupe choisi a l'import. pertApplyGroup applique
      // l'heritage (groupe existant → couleur du registre) ou le "premier venu"
      // (nouveau groupe → la couleur d'import devient celle du groupe). Sans groupe,
      // on ne touche pas a la couleur d'import (comportement historique).
      if (importGroup) {
        node.properties.group = importGroup;
        pertApplyGroup(node);
        node.color = node.properties.color;
      }
    }
    if (node.updateSize) node.updateSize();
    node.pos = [n.off.x / EMU + dx, n.off.y / EMU + dy];
    graph.add(node);
    created[n.srcName] = node;
  });

  // 2) Creation des liens (sortie 0 → premier slot d'entree libre de la cible)
  let nbLinks = 0;
  model.edges.forEach(e => {
    const src = created[e.from], dst = created[e.to];
    if (!src || !dst) return;
    if (src.connect(0, dst, freeInputSlot(dst))) nbLinks++;
  });

  // 3) Metadonnees projet (T0 / unite) issues de la config MANUEL
  if (model.t0) window.pertMeta.t0 = model.t0;
  if (model.unit) window.pertMeta.unit = model.unit;
  // L'unite influe sur la largeur des Activites → recalcul des tailles
  graph._nodes.forEach(n => { if (n.updateSize) n.updateSize(); });

  pertRecalc();
  updateStatus();
  refreshFilterOptions();   // S7 (C) : nouveaux groupes/couleurs dispo dans le filtre
  pertZoomToFit();
  showToast(model.nodes.length + " nœud(s) et " + nbLinks + " lien(s) importés"
    + (model.sheet ? " (feuille « " + model.sheet + " »)" : ""));
}

// Premier slot d'entree libre d'un noeud (les Activites/Jalons ont des entrees
// dynamiques : un slot vide en fin de liste est toujours disponible).
function freeInputSlot(node) {
  if (node.inputs) {
    for (let i = 0; i < node.inputs.length; i++) {
      if (node.inputs[i].link == null) return i;
    }
  }
  return node.inputs ? node.inputs.length - 1 : 0;
}

// Dialogue minimal de choix de feuille (fallback si detection auto KO).
function promptSheetChoice(sheets, onChoose) {
  let dlg = document.getElementById("sheet-dialog");
  if (dlg) dlg.remove();
  dlg = document.createElement("div");
  dlg.id = "sheet-dialog";
  dlg.className = "dialog-overlay";
  dlg.style.display = "flex";

  const box = document.createElement("div");
  box.className = "dialog";
  const h = document.createElement("h3");
  h.textContent = "Choisir la feuille PERT à importer";
  box.appendChild(h);

  const sel = document.createElement("select");
  sheets.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.name;
    opt.textContent = s.name + " (" + s.nodes + " nœud(s))";
    sel.appendChild(opt);
  });
  box.appendChild(sel);

  const btns = document.createElement("div");
  btns.className = "dialog-buttons";
  const cancel = document.createElement("button");
  cancel.textContent = "Annuler";
  cancel.onclick = () => dlg.remove();
  const ok = document.createElement("button");
  ok.textContent = "Importer";
  ok.className = "primary";
  ok.onclick = () => { const v = sel.value; dlg.remove(); onChoose(v); };
  btns.appendChild(cancel);
  btns.appendChild(ok);
  box.appendChild(btns);

  dlg.appendChild(box);
  document.body.appendChild(dlg);
}
