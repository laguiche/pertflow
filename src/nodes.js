// ─── Mesure de texte (canvas offscreen partagé) ───────────────────────────────

let _offscreenCtx = null;
function measureText(text, font) {
  if (!_offscreenCtx) {
    _offscreenCtx = document.createElement("canvas").getContext("2d");
  }
  _offscreenCtx.font = font;
  return _offscreenCtx.measureText(String(text || "")).width;
}

// ─── Nœud Activité ────────────────────────────────────────────────────────────

function ActivityNode() {
  this.addInput("", "pert_flow");  // slot initial — d'autres s'ajoutent dynamiquement
  this.addOutput("", "pert_flow");

  this.properties = {
    label: "Nouvelle activité",
    duration: 1,
    responsible: "",
    color: "#4A90D9"
  };

  // Valeurs calculées (Session 2)
  this.es = null; this.ef = null;
  this.ls = null; this.lf = null;
  this.slack = null;
  this.is_critical = false;

  this.title = this.properties.label;
  this.color = this.properties.color;
  this.bgcolor = "#f0f4f8";
  this.size = [240, 108];
  this.updateSize();
}

ActivityNode.title = "Activité";

ActivityNode.prototype.onPropertyChanged = function(name, value) {
  if (name === "label") this.title = value;
  if (name === "color") this.color = value;
  this.updateSize();
  this.setDirtyCanvas(true, true);
};

ActivityNode.prototype.updateSize = function() {
  const unit = (window.pertMeta && window.pertMeta.unit) || "j";
  const labelW  = measureText(this.properties.label,    "bold 13px sans-serif");
  const durW    = measureText("Durée : " + this.properties.duration + " " + unit, "12px sans-serif");
  const respW   = this.properties.responsible
    ? measureText("Resp. : " + this.properties.responsible, "11px sans-serif") : 0;
  this.size[0] = Math.max(labelW + 56, durW + 20, respW + 20, 180);
  // hauteur fixe : 108 de base + 20px par slot d'entrée supplémentaire
  this.size[1] = 108 + Math.max(0, (this.inputs ? this.inputs.length - 1 : 0)) * 20;
};

ActivityNode.prototype.onConnectionsChange = function(type) {
  if (type !== LiteGraph.INPUT) return;
  manageDynamicInputs(this, "pert_flow");
};

ActivityNode.prototype.onDrawBackground = function(ctx) {
  const w = this.size[0];
  const h = this.size[1];
  const unit = (window.pertMeta && window.pertMeta.unit) ? window.pertMeta.unit : "j";

  // Section info : durée + responsable
  ctx.fillStyle = "#f0f4f8";
  ctx.fillRect(0, 0, w, 52);

  // Separator
  ctx.strokeStyle = "#cdd5df";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 52); ctx.lineTo(w, 52);
  ctx.stroke();

  // Section calculs
  const calcBg = this.slack === 0
    ? "#ffe5e5"
    : (this.slack !== null ? "#e5f5e5" : "#f8f8f8");
  ctx.fillStyle = calcBg;
  ctx.fillRect(0, 52, w, h - 52);

  // Bordure critique
  if (this.is_critical) {
    ctx.strokeStyle = "#cc0000";
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w, h);
  }

  // Texte section info
  ctx.fillStyle = "#2c3e50";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Durée : " + this.properties.duration + " " + unit, 10, 20);

  if (this.properties.responsible) {
    ctx.fillStyle = "#555";
    ctx.font = "11px sans-serif";
    ctx.fillText("Resp. : " + this.properties.responsible, 10, 38);
  }

  // Texte section calculs
  ctx.font = "11px sans-serif";
  if (this.ef !== null) {
    ctx.fillStyle = "#2c3e50";
    ctx.fillText("Fin t.tôt : " + pertFormatDate(this.ef), 10, 70);
  } else {
    ctx.fillStyle = "#aaa";
    ctx.fillText("Non calculé", 10, 70);
  }

  if (this.slack !== null) {
    ctx.fillStyle = this.slack === 0 ? "#cc0000" : "#1a7a1a";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("Marge : " + (this.slack >= 0 ? "+" : "") + this.slack + " " + unit, 10, 90);
  }
};

// ─── Nœud Jalon ───────────────────────────────────────────────────────────────

function MilestoneNode() {
  this.addInput("", "pert_flow");  // slot initial — d'autres s'ajoutent dynamiquement
  this.addOutput("", "pert_flow");

  this.properties = {
    label: "Jalon",
    due_date: ""
  };

  this.ef = null; this.lf = null;
  this.slack = null;
  this.is_critical = false;

  this.size = [140, 140];
  this.flags = { no_title: true };
  this.color = "#f5a623";
  this.bgcolor = "#1a1a2e";
  this.updateSize();
}

MilestoneNode.title = "Jalon";

MilestoneNode.prototype.onPropertyChanged = function() {
  this.updateSize();
  this.setDirtyCanvas(true, true);
};

MilestoneNode.prototype.updateSize = function() {
  const labelW = measureText(this.properties.label,    "bold 12px sans-serif");
  const dateW  = measureText(this.properties.due_date, "10px sans-serif");
  // Le losange expose toute sa largeur au centre ; on ajoute 80px de marge
  // pour que le texte reste bien à l'intérieur des diagonales
  const size = Math.max(140, Math.max(labelW, dateW) + 80);
  this.size[0] = size;
  this.size[1] = size;
};

MilestoneNode.prototype.onConnectionsChange = function(type) {
  if (type !== LiteGraph.INPUT) return;
  manageDynamicInputs(this, "pert_flow");
};

MilestoneNode.prototype.onDrawBackground = function(ctx) {
  // Masquer le fond rectangulaire par défaut
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, this.size[0], this.size[1]);
};

MilestoneNode.prototype.onDrawForeground = function(ctx) {
  const w = this.size[0], h = this.size[1];
  const pad = 4;

  ctx.beginPath();
  ctx.moveTo(w / 2, pad);
  ctx.lineTo(w - pad, h / 2);
  ctx.lineTo(w / 2, h - pad);
  ctx.lineTo(pad, h / 2);
  ctx.closePath();

  ctx.fillStyle = this.is_critical ? "#ffcccc" : "#fffbe6";
  ctx.fill();
  ctx.strokeStyle = this.is_critical ? "#cc0000" : "#aaa";
  ctx.lineWidth = this.is_critical ? 3 : 1.5;
  ctx.stroke();

  ctx.fillStyle = "#333";
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "center";
  const labelY = this.properties.due_date ? h / 2 - 6 : h / 2 + 4;
  ctx.fillText(this.properties.label, w / 2, labelY);

  if (this.properties.due_date) {
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#666";
    ctx.fillText(this.properties.due_date, w / 2, h / 2 + 12);
  }
};

// ─── Nœud Label ───────────────────────────────────────────────────────────────

function LabelNode() {
  this.properties = { text: "Note libre..." };
  this.size = [200, 80];
  this.flags = { no_title: true };
  this.bgcolor = "#1a1a2e";
  this.updateSize();
}

LabelNode.title = "Label";

LabelNode.prototype.onPropertyChanged = function() {
  this.updateSize();
  this.setDirtyCanvas(true, true);
};

LabelNode.prototype.updateSize = function() {
  const lines = (this.properties.text || "").split("\n");
  const maxW = Math.max(...lines.map(l => measureText(l, "12px sans-serif")));
  this.size[0] = Math.max(160, maxW + 20);
  this.size[1] = Math.max(50, lines.length * 16 + 20);
};

LabelNode.prototype.onDrawBackground = function(ctx) {
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, this.size[0], this.size[1]);
};

LabelNode.prototype.onDrawForeground = function(ctx) {
  const w = this.size[0], h = this.size[1];

  ctx.fillStyle = "rgba(255, 255, 220, 0.90)";
  ctx.fillRect(0, 0, w, h);

  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = "#bbb";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.setLineDash([]);

  ctx.fillStyle = "#444";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";

  const lines = (this.properties.text || "").split("\n");
  lines.forEach((line, i) => {
    ctx.fillText(line, 10, 18 + i * 16, w - 20);
  });
};

// ─── Slots d'entrée dynamiques ────────────────────────────────────────────────
//
// Règle : le dernier slot est toujours vide (disponible pour une nouvelle
// connexion). Quand il est connecté on en ajoute un nouveau. Quand une
// connexion est retirée on supprime les slots vides en trop (on en garde
// toujours au moins un).

function manageDynamicInputs(node, slotType) {
  const inputs = node.inputs;

  // Ajouter un slot vide si le dernier est occupé
  if (inputs[inputs.length - 1].link !== null) {
    node.addInput("", slotType);
  }

  // Supprimer les slots vides en excès (garder au moins 1)
  while (inputs.length > 1
      && inputs[inputs.length - 1].link === null
      && inputs[inputs.length - 2].link === null) {
    node.removeInput(inputs.length - 1);
  }

  node.setDirtyCanvas(true, true);
}

// ─── Enregistrement ───────────────────────────────────────────────────────────

LiteGraph.registerNodeType("pert/activity", ActivityNode);
LiteGraph.registerNodeType("pert/milestone", MilestoneNode);
LiteGraph.registerNodeType("pert/label", LabelNode);

// ─── Utilitaire ───────────────────────────────────────────────────────────────

function pertFormatDate(val) {
  if (val === null || val === undefined) return "—";
  if (val instanceof Date) {
    return val.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }
  return String(val);
}
