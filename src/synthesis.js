// ─── Fenetre de synthese globale du planning (evolution post-roadmap) ────────────
//
// Bouton toolbar « Synthese » → fenetre modale recapitulant tout le planning en
// une vue (au-dela de la barre d'etat en pied de page) : vue d'ensemble (taches,
// jalons, fin de projet, cout, chemin critique), jalons TENUS / NON TENUS avec leur
// marge vis-a-vis de la cible, jalons sans cible, et synthese PAR GROUPE (nb taches,
// cout, fin au plus tard = LF max du groupe). Un bouton « Imprimer / PDF » lance
// l'impression navigateur de la seule synthese (l'utilisateur choisit « Enregistrer
// au format PDF ») — approche KISS et 100% file:// (pas de generation jsPDF a la main
// pour du contenu essentiellement tabulaire ; window.print() suffit et respecte la
// contrainte de destination du navigateur).
//
// Toutes les valeurs sont DERIVEES (pertActivityCost, ef/lf/slack recalcules par
// pertRecalc) — rien n'est stocke. La fenetre n'a pas d'etat propre : chaque ouverture
// reconstruit le modele depuis le graphe courant. Le chemin critique repris est le
// MEME que le trace rouge / la barre d'etat (window.pertCriticalPathIds : suit la
// selection, ou marge minimale sans selection).

// Construit le modele de synthese depuis le graphe + les metadonnees courants.
function pertBuildSynthesisModel() {
  const g = window.pertGraph;
  const meta = window.pertMeta || {};
  const unitLabel = meta.unit === "sem" ? "semaines" : (meta.unit === "mois" ? "mois" : "jours");
  const model = {
    title: meta.title || "PertFlow",
    t0: meta.t0 || null,
    unit: meta.unit || "j",
    unitLabel,
    nbTasks: 0,
    nbMilestones: 0,
    totalCost: 0,
    // Part du cout total ENGAGEE AVANT T0 (travaux anticipes), au prorata de la duree
    // situee a gauche de T0. Sert de bascule d'affichage : les colonnes « anticipe /
    // non anticipe » n'apparaissent que si le planning comporte de l'anticipation.
    anticCost: 0,
    endDate: null,
    critTasks: 0,
    critCost: 0,
    milestonesTenus: [],
    milestonesNonTenus: [],
    milestonesSansCible: [],
    groups: [],
  };
  if (!g || !g._nodes) return model;

  // Chemin critique = MEME ensemble que le trace rouge (window.pertCriticalPathIds).
  const critIds = window.pertCriticalPathIds || new Set();

  // Passe 1 : projet, taches, cout, chemin critique, fin de projet (max EF).
  let maxEf = null;
  const activities = [];
  g._nodes.forEach(n => {
    if (n.ef != null && (maxEf === null || n.ef > maxEf)) maxEf = n.ef;
    if (n.type === "pert/activity") {
      model.nbTasks++;
      activities.push(n);
      const c = pertActivityCost(n);
      model.totalCost += c;
      model.anticCost += pertAnticipatedCost(n);
      if (critIds.has(n.id)) { model.critTasks++; model.critCost += c; }
    }
  });
  model.endDate = (maxEf != null) ? pertOffsetToDate(maxEf) : null;

  // Passe 2 : jalons (tenus / non tenus / sans cible), avec marge vis-a-vis de la cible.
  // La marge est en UNITES du projet : cible (offset) - EF (offset). Positive = tenu
  // avec avance, negative = rate. target_missed est calcule par pertRecalc (EF > cible).
  g._nodes.forEach(n => {
    if (n.type !== "pert/milestone") return;
    model.nbMilestones++;
    const row = {
      label: (n.properties && n.properties.label) || "(jalon)",
      tag: (n.properties && typeof pertMilestoneTag === "function") ? pertMilestoneTag(n.properties.tag) : null,
      efDate: (n.ef != null) ? pertOffsetToDate(n.ef) : null,
      // Cible : on retient l'OFFSET resolu (calcul de marge) et le LIBELLE tel que
      // saisi (date calendaire ou « T0+X ») — cf. pert_engine.js, deux modes de saisie.
      hasDue: pertMilestoneHasDue(n),
      dueOff: pertMilestoneDueOffset(n),
      dueLabel: pertMilestoneDueLabel(n),
      margin: null,
      // Cle de tri chronologique : la date CIBLE si elle existe, sinon la fin au plus
      // tot (meme regle que la reorganisation « axe temps seul », cf. pertTimeAxisOffset).
      sortOff: (typeof pertTimeAxisOffset === "function") ? pertTimeAxisOffset(n) : n.ef,
    };
    if (row.hasDue) {
      const dueOff = row.dueOff;
      if (dueOff !== null && n.ef != null) row.margin = dueOff - n.ef;
      if (n.target_missed) model.milestonesNonTenus.push(row);
      else model.milestonesTenus.push(row);
    } else {
      model.milestonesSansCible.push(row);
    }
  });

  // Classement chronologique croissant des trois listes de jalons (cle : date cible si
  // presente, sinon fin au plus tot). Les jalons sans repere temporel finissent en queue,
  // le libelle departageant les ex aequo pour un ordre stable d'une ouverture a l'autre.
  const byChrono = (a, b) => {
    const oa = (a.sortOff != null) ? a.sortOff : Infinity;
    const ob = (b.sortOff != null) ? b.sortOff : Infinity;
    return (oa - ob) || a.label.localeCompare(b.label, "fr");
  };
  model.milestonesTenus.sort(byChrono);
  model.milestonesNonTenus.sort(byChrono);
  model.milestonesSansCible.sort(byChrono);

  // Passe 3 : synthese par groupe. « Fin au plus tard du groupe » = LF max de ses
  // Activites (la derniere tache a devoir etre terminee). Les taches sans groupe sont
  // regroupees dans un bucket « (sans groupe) », affiche en dernier.
  const byGroup = {};
  activities.forEach(n => {
    const gname = (n.properties && n.properties.group ? String(n.properties.group).trim() : "") || "";
    (byGroup[gname] = byGroup[gname] || []).push(n);
  });
  const groupColors = (typeof pertGroups === "function" ? pertGroups() : {}) || {};
  Object.keys(byGroup).sort((a, b) => {
    if (a === "") return 1;      // « sans groupe » en dernier
    if (b === "") return -1;
    return a.localeCompare(b, "fr");
  }).forEach(name => {
    const nodes = byGroup[name];
    // Cout GLOBAL du groupe, puis sa decomposition anticipe (avant T0) / non anticipe
    // (demande utilisateur du 24/07/2026) : c'est par groupe que se decide qui porte
    // l'effort d'anticipation et le budget correspondant.
    let cost = 0, anticCost = 0, maxLf = null;
    nodes.forEach(n => {
      cost += pertActivityCost(n);
      anticCost += pertAnticipatedCost(n);
      if (n.lf != null && (maxLf === null || n.lf > maxLf)) maxLf = n.lf;
    });
    model.groups.push({
      name: name || "(sans groupe)",
      color: name ? (groupColors[name] || (nodes[0].properties && nodes[0].properties.color) || null) : null,
      nbTasks: nodes.length,
      cost,
      anticCost,
      plainCost: cost - anticCost,
      lfDate: (maxLf != null) ? pertOffsetToDate(maxLf) : null,
    });
  });

  return model;
}

// ─── Rendu DOM ──────────────────────────────────────────────────────────────────

// Petit helper de creation d'element (texte via textContent → pas d'injection HTML
// depuis les libelles utilisateur).
function synthEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Ligne « cle : valeur » de la vue d'ensemble.
function synthKV(parent, k, v) {
  const row = synthEl("div", "synth-kv");
  row.appendChild(synthEl("span", "k", k));
  row.appendChild(synthEl("span", "v", v));
  parent.appendChild(row);
}

// Construit une <table> a partir d'en-tetes et de lignes de cellules
// ({ text, cls }). Retourne l'element table.
function synthTable(headers, rows) {
  const table = synthEl("table", "synth-table");
  const thead = synthEl("thead");
  const htr = synthEl("tr");
  headers.forEach(h => {
    const th = synthEl("th", h.cls || null, h.text);
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);
  const tbody = synthEl("tbody");
  rows.forEach(cells => {
    const tr = synthEl("tr");
    cells.forEach(c => {
      const td = synthEl("td", c.cls || null);
      if (c.node) td.appendChild(c.node);
      else td.textContent = (c.text != null ? c.text : "");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

// Section titree ; ajoute un message « vide » si aucune ligne.
function synthSection(parent, title, contentNode, emptyMsg) {
  const sec = synthEl("div", "synth-section");
  sec.appendChild(synthEl("h4", null, title));
  if (contentNode) sec.appendChild(contentNode);
  else sec.appendChild(synthEl("div", "synth-empty", emptyMsg || "—"));
  parent.appendChild(sec);
}

// Cellule « marge » coloree (verte si >= 0, rouge si < 0), suffixee de l'unite.
function synthMarginCell(margin, unitLabel) {
  if (margin == null) return { text: "—" };
  const txt = pertFormatSlack(margin) + " " + unitLabel;
  return { text: txt, cls: "num " + (margin < 0 ? "synth-neg" : "synth-pos") };
}

// Petite pastille de tag de jalon (couleur du registre PERT_MILESTONE_TAGS).
function synthTagNode(tag) {
  if (!tag) return null;
  const s = synthEl("span", "synth-tag", tag.label);
  s.style.background = tag.color;
  return s;
}

// (Re)construit le contenu de la fenetre de synthese.
function pertRenderSynthesis() {
  const c = document.getElementById("synthesis-content");
  if (!c) return;
  c.innerHTML = "";
  const m = pertBuildSynthesisModel();

  // 1) Vue d'ensemble.
  const ov = synthEl("div", "synth-overview");
  synthKV(ov, "Projet", m.title);
  synthKV(ov, "T0", m.t0 || "non défini");
  synthKV(ov, "Unité", m.unitLabel);
  synthKV(ov, "Fin de projet", pertFormatDate(m.endDate));
  synthKV(ov, "Tâches", String(m.nbTasks));
  synthKV(ov, "Jalons", String(m.nbMilestones));
  synthKV(ov, "Coût total", pertFormatCost(m.totalCost));
  // Depense engagee AVANT le lancement contractuel : ligne affichee seulement si le
  // planning comporte effectivement des travaux anticipes.
  if (m.anticCost > 0) {
    synthKV(ov, "dont anticipé (avant T0)", pertFormatCost(m.anticCost));
  }
  synthKV(ov, "Chemin critique", m.critTasks + " tâche(s) · " + pertFormatCost(m.critCost));
  synthSection(c, "Vue d'ensemble", ov);

  // 2) Jalons tenus.
  const mileHeaders = [
    { text: "Jalon" }, { text: "Type" }, { text: "Fin t.tôt" },
    { text: "Cible" }, { text: "Marge", cls: "num" },
  ];
  const mileRow = (r) => [
    { text: r.label },
    { node: synthTagNode(r.tag), text: r.tag ? "" : "—" },
    { text: pertFormatDate(r.efDate) },
    { text: r.dueLabel || "—" },
    synthMarginCell(r.margin, m.unitLabel),
  ];
  synthSection(c, "Jalons tenus (" + m.milestonesTenus.length + ")",
    m.milestonesTenus.length ? synthTable(mileHeaders, m.milestonesTenus.map(mileRow)) : null,
    "Aucun jalon avec cible tenue.");

  // 3) Jalons non tenus.
  synthSection(c, "Jalons non tenus (" + m.milestonesNonTenus.length + ")",
    m.milestonesNonTenus.length ? synthTable(mileHeaders, m.milestonesNonTenus.map(mileRow)) : null,
    "Aucun jalon en retard sur sa cible.");

  // 4) Jalons sans cible (facultatif — repere les jalons non contraints par une date).
  if (m.milestonesSansCible.length) {
    const rows = m.milestonesSansCible.map(r => [
      { text: r.label },
      { node: synthTagNode(r.tag), text: r.tag ? "" : "—" },
      { text: pertFormatDate(r.efDate) },
    ]);
    synthSection(c, "Jalons sans cible (" + m.milestonesSansCible.length + ")",
      synthTable([{ text: "Jalon" }, { text: "Type" }, { text: "Fin t.tôt" }], rows));
  }

  // 5) Synthese par groupe : cout GLOBAL puis, si le planning comporte de
  // l'anticipation, sa decomposition anticipe (avant T0) / non anticipe. Les deux
  // colonnes supplementaires n'apparaissent pas sur un planning classique (aucun
  // bruit), et leur somme redonne toujours le cout global du groupe.
  const showAntic = m.anticCost > 0;
  const grpRows = m.groups.map(gr => {
    const nameCell = synthEl("span");
    if (gr.color) {
      const chip = synthEl("span", "synth-chip");
      chip.style.background = gr.color;
      nameCell.appendChild(chip);
    }
    nameCell.appendChild(document.createTextNode(gr.name));
    const cells = [
      { node: nameCell },
      { text: String(gr.nbTasks), cls: "num" },
      { text: pertFormatCost(gr.cost), cls: "num" },
    ];
    if (showAntic) {
      cells.push({ text: pertFormatCost(gr.anticCost), cls: "num" });
      cells.push({ text: pertFormatCost(gr.plainCost), cls: "num" });
    }
    cells.push({ text: pertFormatDate(gr.lfDate), cls: "num" });
    return cells;
  });
  const grpHeaders = [
    { text: "Groupe" }, { text: "Tâches", cls: "num" }, { text: "Coût global", cls: "num" },
  ];
  if (showAntic) {
    grpHeaders.push({ text: "dont anticipé", cls: "num" });
    grpHeaders.push({ text: "dont non anticipé", cls: "num" });
  }
  grpHeaders.push({ text: "Fin au plus tard", cls: "num" });
  synthSection(c, "Par groupe (WP / métier)",
    m.groups.length ? synthTable(grpHeaders, grpRows) : null,
    "Aucune tâche.");
}

// ─── Ouverture / fermeture / impression ──────────────────────────────────────────

function pertOpenSynthesisDialog() {
  // Recalcul defensif : garantit ef/lf/slack a jour avant de construire le modele.
  if (window.pertRecalc) pertRecalc();
  pertRenderSynthesis();
  const d = document.getElementById("synthesis-dialog");
  if (d) d.style.display = "flex";
}
window.pertOpenSynthesisDialog = pertOpenSynthesisDialog;

function pertCloseSynthesisDialog() {
  const d = document.getElementById("synthesis-dialog");
  if (d) d.style.display = "none";
}
window.pertCloseSynthesisDialog = pertCloseSynthesisDialog;

// Impression de la seule synthese : une classe sur <body> isole la fenetre via les
// regles @media print (tout le reste est masque, fond blanc + texte noir). La classe
// est retiree a l'evenement afterprint (bien supporte sur les navigateurs cibles).
// ⚠️ Pas de setTimeout de nettoyage : sous Chrome window.print() ouvre un apercu NON
// bloquant → un timer retirerait la classe pendant que l'apercu est encore ouvert.
function pertPrintSynthesis() {
  document.body.classList.add("synthesis-printing");
  const cleanup = () => {
    document.body.classList.remove("synthesis-printing");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}
window.pertPrintSynthesis = pertPrintSynthesis;
