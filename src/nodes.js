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

  // Section calculs : rouge clair si critique (marge nulle) ou marge négative
  // (délai/cible infaisable en aval), vert clair si marge positive
  const alert = this.is_critical || (this.slack !== null && this.slack < 0);
  const calcBg = alert
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

  // Texte section calculs : EF converti en date calendaire
  ctx.font = "11px sans-serif";
  if (this.ef !== null) {
    ctx.fillStyle = "#2c3e50";
    const efDate = pertOffsetToDate(this.ef);
    const efTxt = efDate ? pertFormatDate(efDate) : ("+" + this.ef + " " + unit);
    ctx.fillText("Fin t.tôt : " + efTxt, 10, 70);
  } else {
    ctx.fillStyle = "#aaa";
    ctx.fillText("Non calculé", 10, 70);
  }

  if (this.slack !== null) {
    ctx.fillStyle = (this.is_critical || this.slack < 0) ? "#cc0000" : "#1a7a1a";
    ctx.font = "bold 11px sans-serif";
    const slackTxt = pertFormatSlack(this.slack);
    ctx.fillText("Marge : " + slackTxt + " " + unit, 10, 90);
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

  // Mise en exergue : rouge si critique OU si la date-cible n'est pas tenue
  const alert = this.is_critical || this.target_missed;
  ctx.fillStyle = alert ? "#ffcccc" : "#fffbe6";
  ctx.fill();
  ctx.strokeStyle = alert ? "#cc0000" : "#aaa";
  ctx.lineWidth = alert ? 3 : 1.5;
  ctx.stroke();

  // Libellé (remonté pour laisser la place aux lignes de date)
  ctx.fillStyle = "#333";
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "center";
  const nbLines = (this.properties.due_date ? 1 : 0) + (this.ef !== null ? 1 : 0);
  ctx.fillText(this.properties.label, w / 2, h / 2 - nbLines * 7);

  let lineY = h / 2 - nbLines * 7 + 14;

  // Fin calculée (date au plus tôt d'atteinte du jalon)
  if (this.ef !== null) {
    const efDate = pertOffsetToDate(this.ef);
    ctx.font = "10px sans-serif";
    ctx.fillStyle = this.target_missed ? "#cc0000" : "#1a7a1a";
    ctx.fillText("Fin : " + (efDate ? pertFormatDate(efDate) : "+" + this.ef), w / 2, lineY);
    lineY += 13;
  }

  // Date-cible « à tenir »
  if (this.properties.due_date) {
    const dueDate = pertOffsetToDate(pertDateToOffset(this.properties.due_date));
    ctx.font = "10px sans-serif";
    ctx.fillStyle = this.target_missed ? "#cc0000" : "#666";
    ctx.fillText("Cible : " + (dueDate ? pertFormatDate(dueDate) : this.properties.due_date), w / 2, lineY);
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

// Marge signée, arrondie à 2 décimales et sans zéros inutiles (+2, -1.5, 0)
function pertFormatSlack(slack) {
  if (slack === null || slack === undefined) return "—";
  const rounded = Math.round(slack * 100) / 100;
  const sign = rounded > 0 ? "+" : "";
  return sign + rounded;
}
