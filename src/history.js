// ─── Undo / Redo (historique par snapshots) — Session 4 ─────────────────────────
//
// LiteGraph n'a pas d'undo natif. On memorise une pile de snapshots serialises
// (etat complet = meta projet + graph.serialize()) et on restaure par configure().
// Avantages : robuste (meme mecanisme que la persistance .pert), couvre tout
// (ajout/suppression/connexion/deplacement/edition/import/layout/parametres).
//
// Coalescence : les actions rapprochees (frappe au clavier dans un champ) sont
// regroupees en une seule entree d'historique via un commit differe (debounce),
// pour eviter un cran d'undo par caractere.
//
// Contrainte file:// : aucune dependance, pur JS, charge en <script src>.

(function (global) {
  "use strict";

  var COMMIT_DELAY_MS = 450; // fenetre de coalescence des modifications
  var STACK_LIMIT = 60;      // bornes memoire (nb de snapshots conserves)

  var history = {
    stack: [],        // pile de snapshots (chaines JSON)
    index: -1,        // position courante dans la pile
    timer: null,      // timer de commit differe
    restoring: false  // garde : true pendant une restauration (ignore les marks)
  };

  // Snapshot de l'etat courant (meta + graphe) sous forme de chaine comparable.
  function snapshot() {
    return JSON.stringify({
      meta: global.pertMeta,
      graph: global.pertGraph ? global.pertGraph.serialize() : null
    });
  }

  // (Re)initialise l'historique avec l'etat courant comme unique baseline.
  // Appele au demarrage et apres un chargement/.pert (nouvelle reference).
  function historyReset() {
    clearTimeout(history.timer);
    history.timer = null;
    history.stack = [snapshot()];
    history.index = 0;
    history.restoring = false;
    updateButtons();
  }

  // Marque une modification : programme un commit differe (coalescence).
  function historyMark() {
    if (history.restoring) return;
    clearTimeout(history.timer);
    history.timer = setTimeout(historyCommit, COMMIT_DELAY_MS);
  }

  // Fige immediatement l'etat courant dans la pile (si different du sommet).
  function historyCommit() {
    clearTimeout(history.timer);
    history.timer = null;
    if (history.restoring) return;
    var snap = snapshot();
    if (history.index >= 0 && history.stack[history.index] === snap) return;
    // On tronque toute branche "redo" en aval avant d'empiler le nouvel etat.
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(snap);
    if (history.stack.length > STACK_LIMIT) history.stack.shift();
    history.index = history.stack.length - 1;
    updateButtons();
  }

  function historyUndo() {
    historyCommit();                 // fige d'abord une saisie en cours
    if (history.index <= 0) return;
    history.index--;
    restore(history.stack[history.index]);
  }

  function historyRedo() {
    if (history.index >= history.stack.length - 1) return;
    history.index++;
    restore(history.stack[history.index]);
  }

  // Restaure un snapshot : meta + graphe, puis resynchronise l'UI et le PERT.
  function restore(snapStr) {
    var data;
    try { data = JSON.parse(snapStr); } catch (e) { return; }
    var graph = global.pertGraph;
    if (!graph || !data) return;

    history.restoring = true;
    try {
      // Restaure les metadonnees projet (objet conserve : on mute ses cles).
      if (data.meta) {
        global.pertMeta.title = data.meta.title;
        global.pertMeta.t0 = data.meta.t0;
        global.pertMeta.unit = data.meta.unit;
        global.pertMeta.layout_gap = data.meta.layout_gap;
        // #18 largeur ∝ duree (defaut true si snapshot anterieur sans la cle)
        global.pertMeta.prop_width = data.meta.prop_width !== false;
        // S8.5 parametres d'estimation de cout (defauts si snapshot anterieur)
        global.pertMeta.hours_per_month = data.meta.hours_per_month != null ? data.meta.hours_per_month : 135;
        global.pertMeta.hours_per_day = data.meta.hours_per_day != null ? data.meta.hours_per_day : 8;
        global.pertMeta.hourly_rate = data.meta.hourly_rate != null ? data.meta.hourly_rate : 136;
        // #14 registre des couleurs de groupes (capte dans le snapshot via pertMeta)
        global.pertMeta.groups = data.meta.groups || {};
      }
      graph.clear();
      if (data.graph) graph.configure(data.graph);
      graph._nodes.forEach(function (n) { if (n.updateSize) n.updateSize(); });

      if (global.pertRecalc) global.pertRecalc();

      var titleEl = document.getElementById("project-title");
      if (titleEl) titleEl.textContent = global.pertMeta.title || "PertFlow";
      if (global.showProperties) global.showProperties(null);
      if (global.updateStatus) global.updateStatus();
      if (global.pertCanvas) global.pertCanvas.setDirty(true, true);
    } finally {
      history.restoring = false;
    }
    updateButtons();
  }

  // Active/desactive les boutons toolbar selon la position dans la pile.
  function updateButtons() {
    var u = document.getElementById("btn-undo");
    var r = document.getElementById("btn-redo");
    if (u) u.disabled = history.index <= 0;
    if (r) r.disabled = history.index >= history.stack.length - 1;
  }

  // Exposition globale (appelee depuis ui.js / storage.js)
  global.pertHistoryReset = historyReset;
  global.pertHistoryMark = historyMark;
  global.pertHistoryCommit = historyCommit;
  global.pertUndo = historyUndo;
  global.pertRedo = historyRedo;
  global.pertHistoryUpdateButtons = updateButtons;
  global._pertHistory = history; // expose pour tests/debug

})(typeof globalThis !== "undefined" ? globalThis : this);
