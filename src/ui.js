// ─── État global ──────────────────────────────────────────────────────────────

// groups : registre des couleurs memorisees par groupe (WP/metier/service), #14.
// { "<nom du groupe>": "<couleur>" } — serialise dans le .pert, capte par l'undo.
window.pertMeta = { title: "Nouveau projet", t0: "", unit: "mois", layout_gap: 30, groups: {} };
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
    n.pos = pos ? [pos[0], pos[1]] : getCanvasCenter();
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

  document.getElementById("btn-add-activity").addEventListener("click", () => {
    const node = LiteGraph.createNode("pert/activity");
    node.pos = getCanvasCenter();
    graph.add(node);
  });

  document.getElementById("btn-add-milestone").addEventListener("click", () => {
    const node = LiteGraph.createNode("pert/milestone");
    node.pos = getCanvasCenter();
    graph.add(node);
  });

  document.getElementById("btn-add-label").addEventListener("click", () => {
    const node = LiteGraph.createNode("pert/label");
    node.pos = getCanvasCenter();
    graph.add(node);
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
});

// ─── Utilitaires canvas ───────────────────────────────────────────────────────

function getCanvasCenter() {
  const lgCanvas = window.pertCanvas;
  const canvasEl = document.getElementById("pertCanvas");
  // Convertir le centre de l'écran en coordonnées graph
  const cx = canvasEl.width / 2;
  const cy = canvasEl.height / 2;
  return [
    (cx - lgCanvas.ds.offset[0]) / lgCanvas.ds.scale,
    (cy - lgCanvas.ds.offset[1]) / lgCanvas.ds.scale
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
    // Responsable : combobox enrichissable (#13 amorce) — texte libre + reproposition
    // des responsables deja saisis (datalist) pour une orthographe coherente.
    buildCombobox(content, "Responsable", node.properties.responsible, collectResponsibles(), v => {
      node.properties.responsible = v;
      node.updateSize();           // #8 l'en-tete doit grandir pour loger la ligne 👤
      node.setDirtyCanvas(true, true);
    });

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

// Combobox enrichissable = <input> texte + <datalist> alimentee par les valeurs deja
// saisies (Responsable, Groupe). L'utilisateur tape librement OU choisit une valeur
// existante sans la ressaisir. onInput est appele a chaque frappe (memorisation au fil
// de l'eau) ; onCommit (optionnel) a la validation (change/selection) — sert au Groupe
// pour n'appliquer la teinte qu'une fois la saisie terminee. Si onCommit est omis,
// onInput fait office des deux.
function buildCombobox(parent, labelText, value, options, onInput, onCommit) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value !== null && value !== undefined ? value : "";
  input.setAttribute("autocomplete", "off");
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
  label.appendChild(input);
  label.appendChild(dl);
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

function buildTextarea(parent, labelText, value, onChange) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const ta = document.createElement("textarea");
  ta.rows = 5;
  ta.value = value || "";
  ta.addEventListener("input", e => onChange(e.target.value));
  label.appendChild(ta);
  parent.appendChild(label);
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

// ─── Paramètres ───────────────────────────────────────────────────────────────

function openSettings() {
  document.getElementById("settings-title").value = window.pertMeta.title || "";
  document.getElementById("settings-t0").value = window.pertMeta.t0 || "";
  document.getElementById("settings-unit").value = window.pertMeta.unit || "j";
  document.getElementById("settings-hgap").value =
    window.pertMeta.layout_gap != null ? window.pertMeta.layout_gap : 30;
  document.getElementById("settings-dialog").style.display = "flex";
}

function saveSettings() {
  window.pertMeta.title = document.getElementById("settings-title").value;
  window.pertMeta.t0 = document.getElementById("settings-t0").value;
  window.pertMeta.unit = document.getElementById("settings-unit").value;
  const hgap = parseFloat(document.getElementById("settings-hgap").value);
  window.pertMeta.layout_gap = isNaN(hgap) ? 30 : Math.max(0, hgap);
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
  const nodes = g ? g._nodes.length : 0;
  const unit = window.pertMeta.unit === "sem" ? "semaines"
    : (window.pertMeta.unit === "mois" ? "mois" : "jours");
  document.getElementById("status-nodes").textContent = nodes + " nœud(s)";
  document.getElementById("status-unit").textContent = "Unité : " + unit;
  document.getElementById("status-t0").textContent =
    window.pertMeta.t0 ? "T0 : " + window.pertMeta.t0 : "T0 non défini";
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

// Demande la couleur des taches importees (presel. = 1re couleur libre) puis
// concatene le modele. Point de passage commun aux deux chemins d'import.
function finishExcelImport(model) {
  if (!model || !model.nodes || !model.nodes.length) {
    showToast("Aucun nœud à importer");
    return;
  }
  promptImportColor(pickDefaultImportColor(), (color) => applyImportModel(model, color));
}

// Dialogue de choix de la couleur des taches importees : selecteur libre + pastilles
// de la palette (clic = selection rapide). La pastille presel. est mise en exergue.
function promptImportColor(defaultColor, onChoose) {
  let dlg = document.getElementById("color-dialog");
  if (dlg) dlg.remove();
  dlg = document.createElement("div");
  dlg.id = "color-dialog";
  dlg.className = "dialog-overlay";
  dlg.style.display = "flex";

  const box = document.createElement("div");
  box.className = "dialog";
  const h = document.createElement("h3");
  h.textContent = "Couleur des tâches importées";
  box.appendChild(h);

  let current = defaultColor;

  const swatches = document.createElement("div");
  swatches.className = "color-swatches";

  // Selecteur de couleur libre, pre-rempli sur la 1re couleur non utilisee.
  const picker = document.createElement("input");
  picker.type = "color";
  picker.value = current;

  // Synchronise l'exergue des pastilles avec la couleur courante.
  const syncSelected = () => {
    swatches.querySelectorAll(".color-swatch").forEach(e =>
      e.classList.toggle("selected", e.title.toLowerCase() === current.toLowerCase()));
  };

  IMPORT_COLOR_PALETTE.forEach(c => {
    const sw = document.createElement("button");
    sw.className = "color-swatch";
    sw.style.background = c;
    sw.title = c;
    sw.onclick = () => { current = c; picker.value = c; syncSelected(); };
    swatches.appendChild(sw);
  });
  picker.addEventListener("input", () => { current = picker.value; syncSelected(); });
  syncSelected();

  box.appendChild(swatches);
  box.appendChild(picker);

  const btns = document.createElement("div");
  btns.className = "dialog-buttons";
  const cancel = document.createElement("button");
  cancel.textContent = "Annuler";
  cancel.onclick = () => dlg.remove();
  const ok = document.createElement("button");
  ok.textContent = "Importer";
  ok.className = "primary";
  ok.onclick = () => { dlg.remove(); onChoose(current); };
  btns.appendChild(cancel);
  btns.appendChild(ok);
  box.appendChild(btns);

  dlg.appendChild(box);
  document.body.appendChild(dlg);
}

// Concatene le modele d'import dans le graphe courant. importColor (optionnel) =
// couleur appliquee a toutes les Activites importees (cf. promptImportColor).
function applyImportModel(model, importColor) {
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
