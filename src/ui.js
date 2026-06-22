// ─── État global ──────────────────────────────────────────────────────────────

window.pertMeta = { title: "Nouveau projet", t0: "", unit: "j" };
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
  lgCanvas.render_shadows = false;
  lgCanvas.render_connections_border = true;
  lgCanvas.connections_width = 2;

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
    setTimeout(() => {
      const sel = Object.values(lgCanvas.selected_nodes || {});
      if (sel.length === 1) showProperties(sel[0]);
      else showProperties(null);
    }, 30);
  };

  // ── Recalcul PERT automatique (ajout / connexion) ───────────────────────────
  graph.onNodeAdded = function() { pertRecalc(); };
  graph.onConnectionChange = function() {
    pertRecalc();
    // Rafraîchir le panneau si un nœud unique est sélectionné (valeurs calculées)
    const sel = Object.values(lgCanvas.selected_nodes || {});
    if (sel.length === 1) showProperties(sel[0]);
  };

  // Premier calcul (graphe éventuellement déjà peuplé)
  pertRecalc();

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

  document.getElementById("btn-settings").addEventListener("click", openSettings);
  document.getElementById("settings-ok").addEventListener("click", saveSettings);
  document.getElementById("settings-cancel").addEventListener("click", () => {
    document.getElementById("settings-dialog").style.display = "none";
  });

  // Boutons Session 3 — placeholders
  ["btn-open", "btn-save", "btn-export-png", "btn-export-pdf"].forEach(id => {
    document.getElementById(id).addEventListener("click", () => {
      showToast("Disponible en Session 3");
    });
  });

  // ── Raccourcis clavier ──────────────────────────────────────────────────────

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if (e.ctrlKey && e.key === "a") {
      e.preventDefault();
      lgCanvas.selectAllNodes();
    }
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

// ─── Panneau propriétés ───────────────────────────────────────────────────────

function showProperties(node) {
  const panel = document.getElementById("properties-panel");
  const content = document.getElementById("properties-content");
  // Le panneau est toujours affiché
  panel.style.display = "flex";
  content.innerHTML = "";

  if (!node) {
    content.innerHTML = '<p class="prop-empty">Sélectionnez un nœud<br>pour éditer ses propriétés.</p>';
    return;
  }

  if (node.type === "pert/activity") {
    buildField(content, "Libellé", "text", node.properties.label, v => {
      node.properties.label = v;
      node.title = v;
      node.setDirtyCanvas(true);
    });
    buildField(content, "Durée", "number", node.properties.duration, v => {
      node.properties.duration = parseFloat(v) || 0;
      node.updateSize();
      node.setDirtyCanvas(true);
      pertRecalc();
      fillCalcSection(node);
    }, { min: 0, step: 0.5 });
    buildField(content, "Responsable", "text", node.properties.responsible, v => {
      node.properties.responsible = v;
      node.setDirtyCanvas(true);
    });
    buildField(content, "Couleur", "color", node.properties.color, v => {
      node.properties.color = v;
      node.color = v;
      node.setDirtyCanvas(true);
    });

    buildCalcSection(content, node);

  } else if (node.type === "pert/milestone") {
    buildField(content, "Libellé", "text", node.properties.label, v => {
      node.properties.label = v;
      node.setDirtyCanvas(true);
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
      node.setDirtyCanvas(true);
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
  input.addEventListener(type === "color" ? "input" : "change", e => onChange(e.target.value));
  if (type !== "color") input.addEventListener("input", e => onChange(e.target.value));
  label.appendChild(input);
  parent.appendChild(label);
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
  document.getElementById("settings-dialog").style.display = "flex";
}

function saveSettings() {
  window.pertMeta.title = document.getElementById("settings-title").value;
  window.pertMeta.t0 = document.getElementById("settings-t0").value;
  window.pertMeta.unit = document.getElementById("settings-unit").value;
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

function showToast(msg) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove("show"), 2500);
}
