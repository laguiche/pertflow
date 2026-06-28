// ─── Constantes de rendu — Session 2.5 ─────────────────────────────────────────
//
// Echelle horizontale partagee : sert a la fois a la largeur proportionnelle a la
// duree (#2) et au placement chronologique du layout automatique (#1, pert_engine).
// Avec une echelle commune, une chaine de taches se "carrele" comme un Gantt :
// le successeur demarre la ou le predecesseur finit.
const PERT_PX_PER_UNIT = 60;   // pixels par unite de duree (jour/semaine/mois)
const ACT_MIN_W = 140;         // largeur mini d'une activite : doit loger la ligne
                               // calculee la plus large ("Fin t.tot : 28/11/26").
                               // En-dessous (taches courtes) la proportionnalite cede
                               // a la lisibilite du texte (plancher).
const ACT_MAX_W = 3000;        // garde-fou de securite uniquement (taille de canvas).
                               // L'ancien plafond a 480 (= 8 unites) saturait des 8
                               // mois : une tache de 15 et une de 30 avaient la meme
                               // largeur (#2 inoperant au-dela). 3000 = 50 unites laisse
                               // la largeur ∝ duree sur toute la plage realiste, et cale
                               // la barre sur son empan temporel (es × PERT_PX_PER_UNIT)
                               // → coherence avec le layout facon Gantt.
const ACT_LABEL_LH = 18;       // hauteur de ligne du libelle (police bold 13px)

// #20 Seuil de marge (en unites de temps) au-dela duquel une date-cible de Jalon
// est consideree "tenue confortablement" → coin vert (sinon orange si juste tenue,
// rouge si non tenue). Exprime dans l'unite courante (j / sem / mois).
const MILESTONE_GREEN_MARGIN = 1;

// ─── Mesure de texte (canvas offscreen partage) ───────────────────────────────

let _offscreenCtx = null;
function measureText(text, font) {
  if (!_offscreenCtx) {
    _offscreenCtx = document.createElement("canvas").getContext("2d");
  }
  _offscreenCtx.font = font;
  return _offscreenCtx.measureText(String(text || "")).width;
}

// Decoupe un texte en lignes qui tiennent dans maxWidth (retour a la ligne sur
// les espaces). Un mot plus large que maxWidth est laisse tel quel (debordement
// accepte plutot que coupure au milieu d'un mot). Renvoie au moins une ligne.
function wrapText(text, font, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(w => w.length);
  if (!words.length) return [""];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = current + " " + words[i];
    if (measureText(candidate, font) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

// Tronque un texte avec une ellipse pour qu'il tienne dans maxWidth (mesure avec
// la police courante de ctx). Sert au responsable dans l'en-tete (#8) : un nom
// trop long est ecourte plutot que de deborder du nœud.
function ellipsize(ctx, text, maxWidth) {
  text = String(text || "");
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

// ─── #16 Filtre / mise en évidence (S7) ─────────────────────────────────────────
//
// window.pertFilter (defini dans ui.js, etat de vue non serialise) :
//   null | { type:"group", value } | { type:"color", value }
// Un nœud "estompe" recoit un voile translucide (pertDrawDimVeil), dessine en
// onDrawForeground → par-dessus le contenu ET les slots (l'avant-plan est rendu en
// dernier par LiteGraph). Sans filtre actif, rien n'est estompe. Seules les
// Activites peuvent "correspondre" a un filtre groupe/couleur ; les Jalons et
// Labels sont donc estompes des qu'un filtre est actif (ils ne portent ni groupe
// ni couleur de groupe), ce qui concentre l'œil sur l'ensemble selectionne.

function pertNodeDimmed(node) {
  const f = window.pertFilter;
  if (!f) return false;
  const isAct = node.type === "pert/activity" && node.properties;
  if (f.type === "group") {
    return !(isAct && (node.properties.group || "").trim() === f.value);
  }
  if (f.type === "color") {
    return !(isAct && (node.properties.color || "").toLowerCase() === String(f.value).toLowerCase());
  }
  return false;
}

function pertDrawDimVeil(ctx, node) {
  if (!pertNodeDimmed(node)) return;
  ctx.save();
  ctx.fillStyle = "rgba(248,249,251,0.78)"; // voile clair : estompe sans masquer
  ctx.fillRect(0, 0, node.size[0], node.size[1]);
  ctx.restore();
}

// ─── Nœud Activité ────────────────────────────────────────────────────────────

function ActivityNode() {
  this.addInput("", "pert_flow");  // slot initial — d'autres s'ajoutent dynamiquement
  this.addOutput("", "pert_flow");

  this.properties = {
    // #34 Identifiant unique d'Activite — genere automatiquement, NI visible NI
    // editable par l'utilisateur. Brique de fondation pour le micro-jalonnement et
    // les exports Excel/Gantt a venir (S9). Stocke dans properties → serialise
    // nativement par graph.serialize(), donc stable a la sauvegarde/chargement.
    uid: pertGenUid(),
    label: "Nouvelle activité",
    duration: 1,
    responsible: "",
    // #2 Dimension "groupe" (WP / metier / service) au-dela du responsable. Texte
    // libre saisi via un combobox enrichissable (cf. ui.js). Couleur du groupe
    // memorisee dans pertMeta.groups (#14) ; harmonisation visuelle #4.
    group: "",
    color: "#4A90D9"
  };

  // Valeurs calculées (Session 2)
  this.es = null; this.ef = null;
  this.ls = null; this.lf = null;
  this.slack = null;
  this.is_critical = false;

  // Rendu custom : pas de barre de titre LiteGraph (cf. ActivityNode.title_mode),
  // on dessine notre propre en-tete (permet le libelle multi-lignes #4).
  this.color = this.properties.color;
  this.bgcolor = "#ffffff";
  this._labelLines = [this.properties.label];
  this._headerH = ACT_LABEL_LH + 12;
  this._calcTop = 0;
  this.size = [ACT_MIN_W, 120];
  this.updateSize();
}

ActivityNode.title = "Activité";
// Masque la barre de titre LiteGraph : le titre est pilote par title_mode du
// constructeur, PAS par flags.no_title (qui n'a aucun effet sur le rendu).
ActivityNode.title_mode = LiteGraph.NO_TITLE;

ActivityNode.prototype.onPropertyChanged = function(name, value) {
  if (name === "color") this.color = value;
  this.updateSize();
  this.setDirtyCanvas(true, true);
};

// Recalcule largeur (∝ duree, bornee), libelle multi-lignes, hauteur et slots.
ActivityNode.prototype.updateSize = function() {
  // #2 largeur proportionnelle a la duree, bornee [MIN, MAX]
  const dur = parseFloat(this.properties.duration) || 0;
  const width = Math.max(ACT_MIN_W, Math.min(ACT_MAX_W, dur * PERT_PX_PER_UNIT));

  // #4 libelle multi-lignes si trop long pour la largeur
  this._labelLines = wrapText(this.properties.label, "bold 13px sans-serif", width - 20);
  // #8 En-tete = libelle + (si renseigne) ligne responsable, dans le bandeau colore.
  // Le responsable est ainsi nettement separe des lignes de dates calculees (avant,
  // meme police/taille et colle a "Fin t.tot" → les deux infos se confondaient).
  const respLineH = this.properties.responsible ? 16 : 0;
  const headerH = this._labelLines.length * ACT_LABEL_LH + respLineH + 12;

  // Section info : ligne duree seulement (le responsable est passe dans l'en-tete)
  const infoH = 28;
  // Section calculs : EF + marge
  const calcH = 48;

  this._headerH = headerH;
  this._calcTop = headerH + infoH;

  const nbInputs = this.inputs ? this.inputs.length : 1;
  const slotsH = headerH + 12 + nbInputs * 20 + 8;

  this.size[0] = width;
  this.size[1] = Math.max(headerH + infoH + calcH, slotsH);
  this.positionSlots();
};

// Positions explicites des slots : entrees empilees sur le bord gauche sous
// l'en-tete, sortie sur le bord droit a hauteur de la premiere entree.
ActivityNode.prototype.positionSlots = function() {
  const baseY = this._headerH + 12;
  if (this.inputs) {
    for (let i = 0; i < this.inputs.length; i++) {
      this.inputs[i].pos = [0, baseY + i * 20];
    }
  }
  if (this.outputs && this.outputs[0]) {
    this.outputs[0].pos = [this.size[0], baseY];
  }
};

ActivityNode.prototype.onConnectionsChange = function(type) {
  if (type !== LiteGraph.INPUT) return;
  manageDynamicInputs(this, "pert_flow");
  this.updateSize();
};

ActivityNode.prototype.onDrawBackground = function(ctx) {
  const w = this.size[0];
  const h = this.size[1];
  const headerH = this._headerH;
  const calcTop = this._calcTop;
  const unit = (window.pertMeta && window.pertMeta.unit) ? window.pertMeta.unit : "j";

  // En-tete colore + libelle multi-lignes (blanc)
  ctx.fillStyle = this.properties.color;
  ctx.fillRect(0, 0, w, headerH);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "left";
  this._labelLines.forEach((ln, i) => {
    ctx.fillText(ln, 10, 16 + i * ACT_LABEL_LH);
  });

  // #8 Responsable dans l'en-tete (texte blanc + icone 👤), tronque si trop long.
  // Place sous le libelle, dans le bandeau colore → distinct des dates calculees.
  if (this.properties.responsible) {
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    const respY = this._labelLines.length * ACT_LABEL_LH + 13;
    ctx.fillText(ellipsize(ctx, "👤 " + this.properties.responsible, w - 16), 10, respY);
  }

  // Section info : durée (le responsable est desormais dans l'en-tete)
  ctx.fillStyle = "#f0f4f8";
  ctx.fillRect(0, headerH, w, calcTop - headerH);

  // Section calculs : rouge clair si critique (marge nulle) ou marge négative
  // (délai/cible infaisable en aval), vert clair si marge positive
  const alert = this.is_critical || (this.slack !== null && this.slack < 0);
  const calcBg = alert
    ? "#ffe5e5"
    : (this.slack !== null ? "#e5f5e5" : "#f8f8f8");
  ctx.fillStyle = calcBg;
  ctx.fillRect(0, calcTop, w, h - calcTop);

  // Separateur en-tete / info / calculs
  ctx.strokeStyle = "#cdd5df";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, calcTop); ctx.lineTo(w, calcTop);
  ctx.stroke();

  // Bordure critique
  if (this.is_critical) {
    ctx.strokeStyle = "#cc0000";
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w, h);
  }

  // Texte section info
  ctx.fillStyle = "#2c3e50";
  ctx.font = "12px sans-serif";
  ctx.fillText("Durée : " + this.properties.duration + " " + unit, 10, headerH + 18);

  // Texte section calculs : EF converti en date calendaire
  ctx.font = "11px sans-serif";
  if (this.ef !== null) {
    ctx.fillStyle = "#2c3e50";
    const efDate = pertOffsetToDate(this.ef);
    const efTxt = efDate ? pertFormatDate(efDate) : ("+" + this.ef + " " + unit);
    ctx.fillText("Fin t.tôt : " + efTxt, 10, calcTop + 18);
  } else {
    ctx.fillStyle = "#aaa";
    ctx.fillText("Non calculé", 10, calcTop + 18);
  }

  if (this.slack !== null) {
    ctx.fillStyle = (this.is_critical || this.slack < 0) ? "#cc0000" : "#1a7a1a";
    ctx.font = "bold 11px sans-serif";
    const slackTxt = pertFormatSlack(this.slack);
    ctx.fillText("Marge : " + slackTxt + " " + unit, 10, calcTop + 36);
  }
};

// #16 Voile d'estompage si un filtre est actif et que cette Activite n'y correspond
// pas (dessine en avant-plan → recouvre contenu et slots).
ActivityNode.prototype.onDrawForeground = function(ctx) {
  pertDrawDimVeil(ctx, this);
};

// ─── Nœud Jalon ───────────────────────────────────────────────────────────────
//
// Session 2.5 (#5) : refonte de la forme. Le losange etait trop exigu pour le
// texte → rectangle arrondi avec un coin "drapeau" (marqueur de jalon) en haut
// a droite et un losange glyphe devant le libelle.

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
  this.target_missed = false;

  this.bgcolor = "#ffffff";
  this._labelLines = [this.properties.label];
  this.size = [180, 70];
  this.updateSize();
}

MilestoneNode.title = "Jalon";
MilestoneNode.title_mode = LiteGraph.NO_TITLE;

MilestoneNode.prototype.onPropertyChanged = function() {
  this.updateSize();
  this.setDirtyCanvas(true, true);
};

MilestoneNode.prototype.updateSize = function() {
  const efTxt  = this.ef !== null ? "Fin : 00/00/00" : "";
  const dueTxt = this.properties.due_date ? "Cible : 00/00/00" : "";
  const labelW = measureText("◆ " + this.properties.label, "bold 12px sans-serif");
  const lineW  = Math.max(labelW, measureText(efTxt, "10px sans-serif"),
                          measureText(dueTxt, "10px sans-serif"));
  // bord gauche reserve au slot d'entree (~24px) + marge droite
  const width = Math.max(160, Math.min(300, lineW + 44));

  this._labelLines = wrapText("◆ " + this.properties.label, "bold 12px sans-serif", width - 32);
  const nbExtra = (this.ef !== null ? 1 : 0) + (this.properties.due_date ? 1 : 0);
  const textH = 14 + this._labelLines.length * 16 + nbExtra * 15 + 10;

  // Hauteur minimale pour loger TOUS les slots d'entree (sinon le Jalon plafonne
  // visuellement a ~3 liens entrants) : LiteGraph empile les slots a
  // y = (i + 0.7) * NODE_SLOT_HEIGHT, titre masque. On garde une demi-marge basse.
  const nbInputs = this.inputs ? this.inputs.length : 1;
  const slotsH = (nbInputs + 0.3) * LiteGraph.NODE_SLOT_HEIGHT;

  this.size[0] = width;
  this.size[1] = Math.max(textH, slotsH);
};

MilestoneNode.prototype.onConnectionsChange = function(type) {
  if (type !== LiteGraph.INPUT) return;
  manageDynamicInputs(this, "pert_flow");
  this.updateSize();
};

// Etat d'exergue du Jalon (#20) : reflete la TENUE DE LA CIBLE (echeance
// contractuelle du jalon), INDEPENDAMMENT de l'appartenance au chemin critique.
// Un jalon est avant tout un marqueur d'echeance : sa couleur doit dire "la cible
// est-elle tenue ?", pas "suis-je sur le chemin critique ?" (ce dernier est porte
// par le rouge des LIENS). Etats :
//   "alert"   (rouge)  : cible non tenue (EF > cible).
//   "safe"    (vert)   : cible tenue avec marge confortable (dateCible - EF >= seuil).
//   "neutral" (orange) : juste tenue (0 <= marge < seuil) ou aucune cible.
// La marge consideree est celle vis-a-vis de la cible (dateCible - EF), pas le slack
// (qui peut etre borne par l'aval du graphe). Un jalon terminal largement en avance
// sur sa cible apparait donc en vert, meme s'il est sur le chemin critique.
MilestoneNode.prototype.targetState = function() {
  if (this.target_missed) return "alert";
  if (this.properties.due_date && this.ef !== null) {
    const dueOff = pertDateToOffset(this.properties.due_date);
    if (dueOff !== null && (dueOff - this.ef) >= MILESTONE_GREEN_MARGIN) return "safe";
  }
  return "neutral";
};

// Rectangle arrondi dessine en fond → les slots (rendus ensuite) restent visibles.
MilestoneNode.prototype.onDrawBackground = function(ctx) {
  const w = this.size[0], h = this.size[1];
  const r = 8;

  const state = this.targetState();
  const alert = state === "alert";
  const safe  = state === "safe";

  // Couleurs selon l'etat : rouge (alerte) / vert (cible confortable) / orange (neutre)
  const bodyFill   = alert ? "#ffe5e5" : (safe ? "#e9f7e9" : "#fff8e1");
  const strokeCol  = alert ? "#cc0000" : (safe ? "#2e9e2e" : "#d0a000");
  const strokeW    = alert ? 3 : (safe ? 2 : 1.5);
  const cornerCol  = alert ? "#cc0000" : (safe ? "#2e9e2e" : "#f5a623");

  // Corps arrondi
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.arcTo(w, 0, w, r, r);
  ctx.lineTo(w, h - r);
  ctx.arcTo(w, h, w - r, h, r);
  ctx.lineTo(r, h);
  ctx.arcTo(0, h, 0, h - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.fillStyle = bodyFill;
  ctx.fill();
  ctx.strokeStyle = strokeCol;
  ctx.lineWidth = strokeW;
  ctx.stroke();

  // Coin "drapeau" en haut a droite : marqueur visuel du type Jalon
  ctx.beginPath();
  ctx.moveTo(w - 18, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, 18);
  ctx.closePath();
  ctx.fillStyle = cornerCol;
  ctx.fill();

  // Libellé (losange glyphe prepende sur la 1re ligne, multi-lignes #4/#5)
  ctx.fillStyle = "#333";
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "left";
  let y = 18;
  this._labelLines.forEach(ln => {
    ctx.fillText(ln, 12, y);
    y += 16;
  });

  // Fin calculée (date au plus tôt d'atteinte du jalon)
  if (this.ef !== null) {
    const efDate = pertOffsetToDate(this.ef);
    ctx.font = "10px sans-serif";
    ctx.fillStyle = this.target_missed ? "#cc0000" : "#1a7a1a";
    ctx.fillText("Fin : " + (efDate ? pertFormatDate(efDate) : "+" + this.ef), 12, y + 2);
    y += 15;
  }

  // Date-cible « à tenir »
  if (this.properties.due_date) {
    const dueDate = pertOffsetToDate(pertDateToOffset(this.properties.due_date));
    ctx.font = "10px sans-serif";
    ctx.fillStyle = this.target_missed ? "#cc0000" : "#666";
    ctx.fillText("Cible : " + (dueDate ? pertFormatDate(dueDate) : this.properties.due_date), 12, y + 2);
  }
};

// #16 Voile d'estompage (un Jalon est estompe des qu'un filtre groupe/couleur est actif).
MilestoneNode.prototype.onDrawForeground = function(ctx) {
  pertDrawDimVeil(ctx, this);
};

// ─── Nœud Label ───────────────────────────────────────────────────────────────

function LabelNode() {
  this.properties = { text: "Note libre..." };
  this.size = [200, 80];
  this.bgcolor = "#1a1a2e";
  this.updateSize();
}

LabelNode.title = "Label";
LabelNode.title_mode = LiteGraph.NO_TITLE;

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

  // #16 Voile d'estompage (un Label est estompe des qu'un filtre est actif).
  pertDrawDimVeil(ctx, this);
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

// ─── Identifiant unique d'Activité (#34) ────────────────────────────────────────
//
// Genere automatiquement a la creation d'une Activite, invisible et non editable.
// Format court de type uuid (timestamp base36 + aleatoire) : la collision est
// negligeable pour un usage mono-poste. Sert de cle stable aux futurs exports.

function pertGenUid() {
  return "a-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// Garantit l'unicite des uid d'Activite dans le graphe courant. A appeler apres les
// operations qui peuvent dupliquer un uid (clone "Dupliquer", copier/coller, et par
// securite apres un chargement .pert) : clone()/configure() recopient les properties
// donc l'uid d'origine → on regenere l'uid des doublons (le 1er vu est conserve).
function pertEnsureUids() {
  const graph = window.pertGraph;
  if (!graph || !graph._nodes) return;
  const seen = new Set();
  graph._nodes.forEach(n => {
    if (n.type !== "pert/activity" || !n.properties) return;
    let id = n.properties.uid;
    if (!id || seen.has(id)) {
      id = pertGenUid();
      n.properties.uid = id;
    }
    seen.add(id);
  });
}

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
