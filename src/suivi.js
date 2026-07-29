// ─── Fenetre de suivi d'avancement (29/07/2026) ─────────────────────────────────
//
// Bouton toolbar « Synthese ▾ » → « Avancement ». Repond a une seule question, celle
// du pilote une fois le PERT realise et acte : OU EN EST-ON AUJOURD'HUI, et qu'est-ce
// qui doit m'inquieter ? Deux onglets, Taches et Jalons.
//
// PERIMETRE — c'est du pilotage leger « ordre de grandeur » du working level. Aucune
// replanification, aucun recalcul de dates a partir du reel, aucune valeur acquise :
// les dates restent celles du PERT, le suivi ne fait que les CONFRONTER a la date du
// jour et a l'etat d'avancement saisi. Quand l'ecart devient gros, la fenetre le dit
// (« nécessite sûrement une replanification ») — mais c'est a l'utilisateur de
// retoucher son PERT, pas a l'outil.
//
// Le modele est entierement DERIVE : rien n'est stocke, chaque ouverture le
// reconstruit depuis le graphe. Le rendu reutilise les helpers de synthesis.js
// (synthEl / synthTable / synthSection / synthNodeLink) et la meme coquille de
// fenetre — d'ou l'impression PDF acquise sans une ligne de CSS de plus.

// ─── Date du point d'avancement ─────────────────────────────────────────────────
//
// C'est la date du JOUR. window.pertSuiviToday ("YYYY-MM-DD") permet de la forcer :
// indispensable pour que les tests et les captures soient reproductibles, un suivi
// etant par construction relatif au calendrier. Aucune UI ne l'expose — la faire
// saisir donnerait l'illusion de pouvoir « se placer » a une autre date, alors que
// seules les listes bougeraient, pas le planning.
function pertSuiviTodayISO() {
  if (window.pertSuiviToday) return window.pertSuiviToday;
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// Horizon « proche de l'echeance », exprime dans l'unite du projet — un jalon a 15
// jours et un jalon a 15 mois n'appellent pas la meme vigilance. Ces valeurs couvrent
// toutes trois environ trois semaines a deux mois de visibilite, la profondeur utile
// d'une revue d'avancement.
const PERT_SUIVI_HORIZON = { j: 15, sem: 4, mois: 2 };

function pertSuiviHorizon(unit) {
  return PERT_SUIVI_HORIZON[unit] != null ? PERT_SUIVI_HORIZON[unit] : PERT_SUIVI_HORIZON.j;
}

// ─── Amont d'un nœud ────────────────────────────────────────────────────────────
//
// Activites situees en amont, TRANSITIVEMENT. Pour un jalon, ce qui met son echeance
// en peril n'est pas seulement son predecesseur direct : c'est toute la chaine qui
// l'alimente. Une tache non commencee trois crans en amont est exactement le genre de
// chose qu'une revue doit attraper. Memoisation + ensemble de visites : le graphe est
// acyclique (pertRecalc refuse de calculer sinon), mais on ne s'y fie pas.
function pertSuiviUpstreamActivities(id, preds, byId, memo, seen) {
  if (memo[id]) return memo[id];
  seen = seen || new Set();
  if (seen.has(id)) return [];
  seen.add(id);
  const out = [];
  const vus = new Set();
  (preds[id] || []).forEach(pid => {
    const p = byId[pid];
    if (!p) return;
    if (p.type === "pert/activity" && !vus.has(pid)) { vus.add(pid); out.push(p); }
    pertSuiviUpstreamActivities(pid, preds, byId, memo, seen).forEach(a => {
      if (!vus.has(a.id)) { vus.add(a.id); out.push(a); }
    });
  });
  seen.delete(id);
  memo[id] = out;
  return out;
}

// ─── Modele ─────────────────────────────────────────────────────────────────────

function pertBuildSuiviModel() {
  const g = window.pertGraph;
  const meta = window.pertMeta || {};
  const unit = meta.unit || "j";
  const todayISO = pertSuiviTodayISO();
  const model = {
    todayISO,
    todayDate: new Date(todayISO + "T00:00:00"),
    // Offset de la date du jour dans le repere du projet. null si T0 n'est pas defini :
    // sans origine, aucune date calculee n'existe et le suivi n'a rien a comparer.
    todayOff: (typeof pertDateToOffset === "function") ? pertDateToOffset(todayISO) : null,
    unit,
    unitLabel: unit === "sem" ? "sem" : (unit === "mois" ? "mois" : "j"),
    horizon: pertSuiviHorizon(unit),
    noT0: !meta.t0,
    nbTasks: 0,
    counts: { NON_COMMENCE: 0, EN_COURS: 0, TERMINE: 0 },
    enCours: [],
    aEngager: [],
    enRetard: [],
    prochainsJalons: [],
    jalonsAlerte: [],
  };
  if (!g || !g._nodes) return model;

  const adj = pertBuildAdjacency(g);
  const byId = {};
  g._nodes.forEach(n => { byId[n.id] = n; });

  const activities = g._nodes.filter(n => n.type === "pert/activity");
  const groups = (typeof pertGroups === "function") ? pertGroups() : {};
  model.nbTasks = activities.length;
  activities.forEach(n => {
    const st = pertActivityProgress(n);
    if (model.counts[st] != null) model.counts[st]++;
  });

  const today = model.todayOff;

  // Ligne de tache. « retard » = de combien d'unites l'ES est depasse (positif
  // seulement) — c'est le chiffre qui dit l'urgence, pas la date brute.
  const taskRow = (n) => {
    const grp = ((n.properties && n.properties.group) || "").trim();
    return {
      id: n.id,
      label: (n.properties && n.properties.label) || "(tâche)",
      group: grp,
      groupColor: grp ? (groups[grp] || null) : null,
      es: n.es,
      ef: n.ef,
      esDate: (n.es != null) ? pertOffsetToDate(n.es) : null,
      efDate: (n.ef != null) ? pertOffsetToDate(n.ef) : null,
      slack: n.slack,
      retard: (today != null && n.es != null && n.es < today) ? (today - n.es) : 0,
    };
  };

  // Tri « par groupe, puis chronologique sur l'ES » (demande utilisateur) : on lit le
  // suivi lot par lot, et dans chaque lot dans l'ordre ou les choses arrivent. Les
  // taches sans groupe ferment la marche plutot que d'ouvrir sous une colonne vide.
  const byGroupThenEs = (a, b) => {
    const ga = a.group || "￿", gb = b.group || "￿";
    if (ga !== gb) return ga.localeCompare(gb, "fr");
    const ea = a.es != null ? a.es : Infinity, eb = b.es != null ? b.es : Infinity;
    return ea - eb;
  };

  activities.forEach(n => {
    const st = pertActivityProgress(n);
    if (st === "EN_COURS") { model.enCours.push(taskRow(n)); return; }
    if (st !== "NON_COMMENCE") return;   // TERMINE : plus rien a piloter

    // Une tache non commencee dont l'ES est DEPASSE aurait du etre engagee : c'est
    // l'alerte, elle prime sur toute autre consideration.
    if (today != null && n.es != null && n.es < today) {
      const row = taskRow(n);
      // Ce qui bloque : les predecesseurs directs pas encore termines. Sans cette
      // colonne, « aurait du commencer » n'indique pas s'il faut relancer la tache
      // elle-meme ou celle d'avant.
      row.bloquants = (adj.preds[n.id] || [])
        .map(pid => byId[pid])
        .filter(p => p && p.type === "pert/activity" && pertActivityProgress(p) !== "TERMINE");
      model.enRetard.push(row);
      return;
    }

    // « A engager » : la tache est mure, sans etre en retard. Deux facons de l'etre —
    //   (a) un predecesseur direct est EN COURS : la main va lui etre passee ;
    //   (b) son ES tombe aujourd'hui (le cas « ES depasse » est parti en alerte).
    const predEnCours = (adj.preds[n.id] || []).some(pid => {
      const p = byId[pid];
      return p && p.type === "pert/activity" && pertActivityProgress(p) === "EN_COURS";
    });
    const esAtteint = (today != null && n.es != null && n.es <= today);
    if (predEnCours || esAtteint) {
      const row = taskRow(n);
      row.motif = predEnCours ? "Amont en cours" : "Date atteinte";
      model.aEngager.push(row);
    }
  });

  model.enCours.sort(byGroupThenEs);
  model.aEngager.sort(byGroupThenEs);
  // Les retards, eux, se lisent du plus ancien au plus recent : le plus vieux retard
  // est le plus preoccupant, il n'a pas a etre range derriere un nom de groupe.
  model.enRetard.sort((a, b) => b.retard - a.retard);

  // ── Jalons ────────────────────────────────────────────────────────────────────
  const memo = {};
  const milestones = g._nodes.filter(n => n.type === "pert/milestone");
  milestones.forEach(n => {
    // Echeance = cible si elle est renseignee, sinon fin au plus tot. Meme regle que
    // le placement sur l'axe du temps (pertTimeAxisOffset) : le jalon se juge la ou
    // on l'attend, pas la ou le calcul le pose quand une cible existe.
    const off = (typeof pertTimeAxisOffset === "function") ? pertTimeAxisOffset(n) : n.ef;
    const amont = pertSuiviUpstreamActivities(n.id, adj.preds, byId, memo);
    const restants = amont.filter(a => pertActivityProgress(a) !== "TERMINE");
    const nonCommencees = restants.filter(a => pertActivityProgress(a) === "NON_COMMENCE");
    const row = {
      id: n.id,
      label: (n.properties && n.properties.label) || "(jalon)",
      tag: (n.properties && typeof pertMilestoneTag === "function")
        ? pertMilestoneTag(n.properties.tag) : null,
      off,
      date: (off != null) ? pertOffsetToDate(off) : null,
      dueLabel: pertMilestoneHasDue(n) ? pertMilestoneDueLabel(n) : null,
      dans: (today != null && off != null) ? (off - today) : null,
      nbAmont: amont.length,
      restants,
      nonCommencees,
    };

    if (today != null && off != null && off >= today) model.prochainsJalons.push(row);

    // ALERTE : l'echeance est dans l'horizon (ou deja passee) ET l'amont n'est pas
    // fait. Deux niveaux, parce que les deux situations n'appellent pas la meme
    // reaction — une tache amont NON COMMENCEE a si peu de temps de l'echeance
    // demande une replanification ; un amont seulement EN COURS demande de la
    // vigilance. Un jalon dont tout l'amont est termine n'est pas une alerte, et un
    // jalon sans amont du tout n'a rien a signaler (contrainte externe).
    if (today != null && off != null && amont.length && restants.length
        && (off - today) <= model.horizon) {
      row.niveau = nonCommencees.length ? "alert" : "neutral";
      row.depassee = (off < today);
      model.jalonsAlerte.push(row);
    }
  });

  const parDate = (a, b) => (a.off != null ? a.off : Infinity) - (b.off != null ? b.off : Infinity);
  model.prochainsJalons.sort(parDate);
  model.jalonsAlerte.sort(parDate);

  return model;
}
window.pertBuildSuiviModel = pertBuildSuiviModel;

// ─── Rendu ──────────────────────────────────────────────────────────────────────

// Section du suivi. Deux ecarts avec synthSection (synthesis.js) :
//   - une ACTION facultative a droite du titre (mise en evidence dans le planning) ;
//   - une section vide reste AFFICHEE, avec son message. C'est l'inverse de la regle
//     de l'onglet Analyse, ou un controle sans anomalie est masque — et c'est voulu :
//     « aucune tâche en retard » est une reponse qu'un pilote vient chercher, alors
//     qu'un controle sans anomalie n'est qu'une case verte de plus a faire defiler.
function suiviSection(parent, title, actionNode, contentNode, emptyMsg, hint) {
  const sec = synthEl("div", "synth-section");
  const head = synthEl("div", "suivi-section-head");
  head.appendChild(synthEl("h4", null, title));
  if (actionNode) head.appendChild(actionNode);
  sec.appendChild(head);
  if (hint) sec.appendChild(synthEl("p", "synth-hint", hint));
  sec.appendChild(contentNode || synthEl("div", "synth-empty", emptyMsg || "—"));
  parent.appendChild(sec);
  return sec;
}

// Bouton « mettre en evidence dans le planning » d'une section : pose le filtre
// d'avancement correspondant. Le filtre gere deja nativement cette mise en evidence
// (cf. ui.js) — on ne fait que l'actionner d'ici, sans dupliquer sa logique.
function suiviFilterButton(progressValue, labelEtat) {
  const b = synthEl("button", "synth-goto", "🔎 Voir dans le planning");
  b.type = "button";
  b.title = "Estompe tout sauf les tâches « " + labelEtat + " »";
  b.addEventListener("click", () => {
    pertCloseReportDialogs();
    if (typeof pertClearFilterSearch === "function") pertClearFilterSearch();
    applyFilter({ type: "progress", value: progressValue });
    if (typeof updateFilterTrigger === "function") updateFilterTrigger();
  });
  return b;
}

// Pastille de couleur de groupe + nom, comme dans la synthese par groupe.
function suiviGroupCell(row) {
  const span = synthEl("span");
  if (row.groupColor) {
    const chip = synthEl("span", "synth-chip");
    chip.style.background = row.groupColor;
    span.appendChild(chip);
  }
  span.appendChild(document.createTextNode(row.group || "—"));
  return span;
}

// Delai signe, en unites du projet : « dans 4 j », « il y a 3 j ». Un nombre nu
// obligerait le lecteur a se rappeler le sens du signe a chaque ligne.
function suiviDelai(n, unitLabel) {
  if (n == null) return "—";
  const v = Math.round(n * 10) / 10;
  if (v === 0) return "aujourd'hui";
  return v > 0 ? ("dans " + v + " " + unitLabel) : ("il y a " + (-v) + " " + unitLabel);
}

// Liste de taches amont rendue dans UNE cellule, chaque nom menant a son nœud. Le
// nombre est plafonne : au-dela, la cellule cesse d'etre lisible et le total suffit.
const PERT_SUIVI_MAX_AMONT = 3;
function suiviUpstreamCell(nodes) {
  const span = synthEl("span");
  if (!nodes.length) { span.textContent = "—"; return span; }
  nodes.slice(0, PERT_SUIVI_MAX_AMONT).forEach((n, i) => {
    if (i) span.appendChild(document.createTextNode(", "));
    const label = (n.properties && n.properties.label) || "(tâche)";
    const lien = synthNodeLink(label, n.id);
    // L'etat de la tache amont est CE QUI motive l'alerte, et il commande l'action :
    // une tache PAS COMMENCEE se lance (ou se replanifie), une tache EN COURS se
    // surveille. Les deux doivent donc se distinguer DANS la cellule — la couleur de
    // la ligne, elle, ne dit que le niveau d'alerte du jalon, pas ce qu'il faut faire.
    lien.classList.add(pertActivityProgress(n) === "NON_COMMENCE"
      ? "suivi-amont-ko" : "suivi-amont-wip");
    span.appendChild(lien);
  });
  if (nodes.length > PERT_SUIVI_MAX_AMONT) {
    span.appendChild(document.createTextNode(" … (+" + (nodes.length - PERT_SUIVI_MAX_AMONT) + ")"));
  }
  return span;
}

const PERT_SUIVI_TABS = [
  { id: "taches", label: "Tâches", chapter: "Suivi des tâches" },
  { id: "jalons", label: "Jalons", chapter: "Suivi des jalons" },
];

let pertSuiviTab = "taches";

function pertSelectSuiviTab(name) {
  const tabs = document.querySelectorAll("#suivi-tabs .synth-tab");
  const panels = document.querySelectorAll("#suivi-content .synth-panel");
  if (!tabs.length) return;
  let known = false;
  tabs.forEach(t => { if (t.dataset.tab === name) known = true; });
  if (!known) name = tabs[0].dataset.tab;
  pertSuiviTab = name;
  tabs.forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  panels.forEach(p => p.classList.toggle("active", p.dataset.panel === name));
  const c = document.getElementById("suivi-content");
  if (c) c.scrollTop = 0;
}
window.pertSelectSuiviTab = pertSelectSuiviTab;

// Barre d'onglets + panneaux vides. Le badge porte le nombre d'ALERTES de l'onglet :
// on doit savoir qu'il y a quelque chose a y voir sans avoir a l'ouvrir.
function pertBuildSuiviTabs(model) {
  const bar = document.getElementById("suivi-tabs");
  const c = document.getElementById("suivi-content");
  const panels = {};
  if (!bar || !c) return panels;
  bar.innerHTML = "";
  c.innerHTML = "";
  const alertes = { taches: model.enRetard.length, jalons: model.jalonsAlerte.length };
  PERT_SUIVI_TABS.forEach(t => {
    const b = synthEl("button", "synth-tab", t.label);
    b.type = "button";
    b.dataset.tab = t.id;
    b.setAttribute("role", "tab");
    if (alertes[t.id]) {
      const badge = synthEl("span", "synth-tab-badge", String(alertes[t.id]));
      b.appendChild(badge);
    }
    b.addEventListener("click", () => pertSelectSuiviTab(t.id));
    bar.appendChild(b);

    const p = synthEl("div", "synth-panel");
    p.dataset.panel = t.id;
    p.appendChild(synthEl("h3", "synth-chapter", t.chapter));
    c.appendChild(p);
    panels[t.id] = p;
  });
  return panels;
}

function pertRenderSuivi() {
  const c = document.getElementById("suivi-content");
  if (!c) return;
  const m = pertBuildSuiviModel();
  const panels = pertBuildSuiviTabs(m);
  const tachesPanel = panels.taches || c;
  const jalonsPanel = panels.jalons || c;
  const u = m.unitLabel;

  // Sans T0, aucune date calendaire n'existe : tout le suivi est relatif au jour, il
  // n'y a rien a afficher. On le dit franchement plutot que de rendre des tableaux
  // vides que l'utilisateur croirait justes.
  if (m.noT0 || m.todayOff == null) {
    suiviSection(tachesPanel, "Suivi indisponible", null, null,
      "Définissez d'abord la date T0 du projet (Paramètres) : sans origine des temps, "
      + "aucune date ne peut être confrontée au jour du point d'avancement.");
    suiviSection(jalonsPanel, "Suivi indisponible", null, null,
      "Définissez d'abord la date T0 du projet (Paramètres).");
    pertSelectSuiviTab(pertSuiviTab);
    return;
  }

  // ── Onglet Taches ─────────────────────────────────────────────────────────────
  const ov = synthEl("div", "synth-overview");
  synthKV(ov, "Point d'avancement au", pertFormatDate(m.todayDate));
  synthKV(ov, "Tâches", String(m.nbTasks));
  synthKV(ov, "Terminées", String(m.counts.TERMINE));
  synthKV(ov, "En cours", String(m.counts.EN_COURS));
  synthKV(ov, "Non commencées", String(m.counts.NON_COMMENCE));
  suiviSection(tachesPanel, "Où en est-on ?", null, ov);

  const tacheHeaders = [
    { text: "Tâche" }, { text: "Groupe" }, { text: "Début t.tôt" },
    { text: "Fin t.tôt" }, { text: "Marge", cls: "num" },
  ];
  const tacheRow = (r) => ({
    cells: [
      { text: r.label, nodeId: r.id },
      { node: suiviGroupCell(r) },
      { text: pertFormatDate(r.esDate) },
      { text: pertFormatDate(r.efDate) },
      synthMarginCell(r.slack, u),
    ],
  });

  suiviSection(tachesPanel, "En cours (" + m.enCours.length + ")",
    m.enCours.length ? suiviFilterButton("EN_COURS", "En cours") : null,
    m.enCours.length ? synthTable(tacheHeaders, m.enCours.map(tacheRow)) : null,
    "Aucune tâche déclarée en cours.");

  suiviSection(tachesPanel, "À engager (" + m.aEngager.length + ")",
    null,
    m.aEngager.length
      ? synthTable(tacheHeaders.slice(0, 2).concat([{ text: "Motif" }])
          .concat(tacheHeaders.slice(2)),
          m.aEngager.map(r => ({
            cells: [
              { text: r.label, nodeId: r.id },
              { node: suiviGroupCell(r) },
              { text: r.motif },
              { text: pertFormatDate(r.esDate) },
              { text: pertFormatDate(r.efDate) },
              synthMarginCell(r.slack, u),
            ],
          })))
      : null,
    "Rien à engager dans l'immédiat.",
    "Tâches non commencées dont l'amont est en cours, ou dont la date de début au plus "
    + "tôt tombe aujourd'hui. Ce sont les prochaines à lancer.");

  suiviSection(tachesPanel, "Auraient dû commencer (" + m.enRetard.length + ")",
    null,
    m.enRetard.length
      ? synthTable(
          [{ text: "Tâche" }, { text: "Groupe" }, { text: "Début t.tôt" },
           { text: "Retard", cls: "num" }, { text: "Amont pas terminé" }],
          m.enRetard.map(r => ({
            cls: "synth-mile-alert",
            cells: [
              { text: r.label, nodeId: r.id },
              { node: suiviGroupCell(r) },
              { text: pertFormatDate(r.esDate) },
              { text: "+" + Math.round(r.retard * 10) / 10 + " " + u, cls: "num" },
              { node: suiviUpstreamCell(r.bloquants) },
            ],
          })))
      : null,
    "Aucune tâche en retard d'engagement.",
    "Ces tâches sont non commencées alors que leur date de début au plus tôt est "
    + "passée. La colonne « Amont pas terminé » dit s'il faut relancer la tâche "
    + "elle-même ou celle qui la précède.");

  // ── Onglet Jalons ─────────────────────────────────────────────────────────────
  suiviSection(jalonsPanel, "Prochains jalons (" + m.prochainsJalons.length + ")",
    null,
    m.prochainsJalons.length
      ? synthTable(
          [{ text: "Jalon" }, { text: "Type" }, { text: "Échéance" },
           { text: "Délai", cls: "num" }, { text: "Amont restant", cls: "num" }],
          m.prochainsJalons.map(r => ({
            cells: [
              { text: r.label, nodeId: r.id },
              { node: synthTagNode(r.tag), text: r.tag ? "" : "—" },
              { text: pertFormatDate(r.date) },
              { text: suiviDelai(r.dans, u), cls: "num" },
              { text: r.nbAmont ? (r.restants.length + " / " + r.nbAmont) : "—", cls: "num" },
            ],
          })))
      : null,
    "Aucun jalon à venir.",
    "Jalons dont l'échéance est à venir, du plus proche au plus lointain. « Amont "
    + "restant » compte les tâches amont non terminées sur le total de l'amont.");

  suiviSection(jalonsPanel, "Jalons en alerte (" + m.jalonsAlerte.length + ")",
    null,
    m.jalonsAlerte.length
      ? synthTable(
          [{ text: "Jalon" }, { text: "Échéance" }, { text: "Délai", cls: "num" },
           { text: "Amont non terminé" }],
          m.jalonsAlerte.map(r => ({
            cls: "synth-mile-" + r.niveau,
            cells: [
              { text: r.label, nodeId: r.id },
              { text: pertFormatDate(r.date) + (r.depassee ? " (dépassée)" : "") },
              { text: suiviDelai(r.dans, u), cls: "num" },
              { node: suiviUpstreamCell(r.restants) },
            ],
          })))
      : null,
    "Aucun jalon menacé à l'horizon de " + m.horizon + " " + u + ".",
    "Jalons dont l'échéance tombe dans les " + m.horizon + " " + u + " (ou est déjà "
    + "passée) alors que des tâches amont ne sont pas terminées. En ROUGE, une tâche "
    + "amont n'est même pas commencée : l'échéance ne tiendra probablement pas sans "
    + "replanification. En ORANGE, l'amont est engagé mais pas fini : à surveiller.");

  pertSelectSuiviTab(pertSuiviTab);
}
window.pertRenderSuivi = pertRenderSuivi;

// ─── Ouverture / fermeture / impression ─────────────────────────────────────────

function pertOpenSuiviDialog() {
  // Recalcul defensif, comme la synthese : le suivi lit es/ef/slack, ils doivent etre
  // a jour — le suivi ne les calcule PAS lui-meme (il ne touche pas au PERT).
  if (window.pertRecalc) pertRecalc();
  pertRenderSuivi();
  const d = document.getElementById("suivi-dialog");
  if (d) d.style.display = "flex";
}
window.pertOpenSuiviDialog = pertOpenSuiviDialog;

function pertCloseSuiviDialog() {
  const d = document.getElementById("suivi-dialog");
  if (d) d.style.display = "none";
}
window.pertCloseSuiviDialog = pertCloseSuiviDialog;

function pertPrintSuivi() { pertPrintDialog("suivi-dialog"); }
window.pertPrintSuivi = pertPrintSuivi;
