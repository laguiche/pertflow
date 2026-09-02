// ─── Relier deux nœuds sans naviguer dans le canvas ─────────────────────────────
//
// POURQUOI CE MODULE. Sur un très grand PERT, créer un lien entre deux nœuds
// éloignés était un parcours du combattant : dézoomer pour retrouver la cible,
// filtrer pour la distinguer, zoomer, DEPLACER le nœud pour l'amener a portee de
// glisser, tirer le lien, puis le remettre en place. Autrement dit, une operation
// purement logique (« A precede B ») exigeait une manœuvre GEOMETRIQUE, avec le
// risque de laisser l'agencement du planning abime derriere soi.
//
// Le principe retenu : on part du nœud SELECTIONNE, on DESIGNE l'autre extremite
// par une recherche (nom, groupe, responsable), et le lien se cree sur un clic.
// La vue ne bouge pas, aucun nœud n'est deplace.
//
// TROIS DECISIONS DE CADRAGE, a ne pas defaire sans nouvel arbitrage :
//
//  1. LES DEUX SENS SONT OFFERTS. Relier n'a de sens qu'oriente ; obliger a se
//     placer sur l'amont pour creer un lien reintroduirait la navigation qu'on
//     cherche justement a eviter (« il me manque un predecesseur » est aussi
//     frequent que l'inverse). D'ou le selecteur Successeurs / Predecesseurs,
//     MEMORISE d'une ouverture a l'autre (comme les onglets du panneau) : on relie
//     rarement un seul nœud, et refaire le meme geste a chaque fois lasserait.
//
//  2. CE QUI EST IMPOSSIBLE RESTE AFFICHE, mais desactive et MOTIVE. Un candidat
//     deja lie, ou qui creerait un cycle, n'est pas retire de la liste : le faire
//     disparaitre laisserait croire a une faute de frappe dans la recherche. La
//     ligne reste, grisee, avec la RAISON — c'est une reponse, pas une absence.
//     Le controle de cycle est fait ICI, avant la creation : le moteur sait
//     detecter un cycle, mais il ne peut plus alors RIEN calculer (cf. pertRecalc)
//     — le planning entier deviendrait muet a cause d'un clic.
//
//  3. LA FENETRE NE SE FERME PAS APRES UN LIEN. On relie par rafales (un jalon
//     recoit cinq predecesseurs) ; la ligne cliquee bascule en « deja lie », ce qui
//     tient lieu d'accuse de reception, et le compteur d'en-tete suit.
//
// Contrainte file:// : pur JS charge en <script src>, aucune dependance.

// Au-dela, la liste cesse d'etre lisible et le rendu coute plus qu'il ne rapporte :
// on affiche les premiers et on invite a affiner. Le compteur, lui, annonce le TOTAL
// (masquer le total ferait croire que la recherche n'a trouve que ce qui est visible).
const PERT_LS_MAX_ROWS = 200;

// Etat de la fenetre. `dir` survit a la fermeture (cf. decision 1) ; le reste est
// propre a une ouverture — une recherche vaut pour le nœud qu'on est en train de
// relier, la retrouver telle quelle sur le nœud suivant serait deroutant.
const pertLinkSearch = {
  nodeId: null,
  dir: "succ",       // "succ" : nœud courant → candidat ; "pred" : candidat → nœud courant
  text: "",
  group: "",         // "" = tous
  resp: ""           // "" = tous
};

// Le nœud en cours de liaison, relu depuis le graphe a chaque usage : entre deux
// rafraichissements il a pu etre supprime (undo, touche Suppr) — on ne garde donc
// qu'un id, jamais la reference.
function pertLsNode() {
  const g = window.pertGraph;
  if (!g || !g._nodes || pertLinkSearch.nodeId === null) return null;
  return g._nodes.find(n => n.id === pertLinkSearch.nodeId) || null;
}

// Un Label n'a ni entree ni sortie (cf. nodes.js) : il ne peut etre ni origine ni
// extremite d'un lien. Il est donc absent de la liste, et la fenetre ne s'ouvre pas
// depuis un Label.
function pertLsLinkable(node) {
  return !!node && (node.type === "pert/activity" || node.type === "pert/milestone");
}

// Ensemble des nœuds atteignables depuis `startId` en suivant `table` (preds ou succs),
// TRANSITIVEMENT. Sert a interdire les liens qui refermeraient une boucle : relier vers
// un ancetre (sens successeur) ou vers un descendant (sens predecesseur) cree un cycle.
// Parcours defensif (ensemble « vu ») : le graphe peut DEJA contenir un cycle — c'est
// un etat que le moteur signale sans l'interdire — et il ne faut pas boucler dessus.
function pertLsReach(startId, table) {
  const seen = new Set();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    (table[id] || []).forEach(next => {
      if (!seen.has(next)) { seen.add(next); stack.push(next); }
    });
  }
  return seen;
}

// Date affichee en bout de ligne : pour un candidat PREDECESSEUR ce qui compte est
// quand il libere la suite (sa fin au plus tot), pour un SUCCESSEUR quand il peut
// demarrer. Meme convention que les listes de voisins du panneau (fillLinksSection),
// pour que la meme grandeur ne s'ecrive pas de deux facons selon l'ecran.
function pertLsDateOf(node, dir) {
  if (dir === "pred") return node.ef;
  return node.type === "pert/activity" ? node.es : node.ef;
}

// Construit la liste des candidats, chacun assorti de son STATUT. Rien n'est ecarte
// pour cause d'impossibilite (cf. decision 2) : seuls le nœud lui-meme, les Labels et
// ce que la recherche exclut ne figurent pas dans le resultat.
//
// Note sur les facettes : groupe et responsable sont des proprietes d'ACTIVITE (comme
// dans le filtre du canvas). En choisir une retire donc les Jalons de la liste — c'est
// coherent avec le filtre, et c'est ce qu'on veut : on cherche alors « une tache de tel
// lot », pas un jalon.
function pertLsCandidates() {
  const node = pertLsNode();
  const graph = window.pertGraph;
  if (!node || !graph) return { rows: [], total: 0 };

  // Meme source de verite que le calcul PERT : doublons de liens ecartes, Labels
  // exclus — le statut « deja lie » ne peut donc pas diverger de ce que voit le moteur.
  const { preds, succs } = pertBuildAdjacency(graph);
  const dir = pertLinkSearch.dir;
  const linked = new Set(dir === "succ" ? (succs[node.id] || []) : (preds[node.id] || []));
  // Sens successeur : relier vers un ANCETRE referme la boucle. Sens predecesseur :
  // c'est vers un DESCENDANT.
  const closing = dir === "succ"
    ? pertLsReach(node.id, preds)
    : pertLsReach(node.id, succs);

  const needle = pertNormalizeSearch(pertLinkSearch.text);
  const rows = [];
  graph._nodes.forEach(n => {
    if (n.id === node.id) return;
    if (!pertLsLinkable(n)) return;
    const p = n.properties || {};
    if (needle && pertNormalizeSearch(pertNodeSearchText(n)).indexOf(needle) === -1) return;
    if (pertLinkSearch.group && (p.group || "").trim() !== pertLinkSearch.group) return;
    if (pertLinkSearch.resp && (p.responsible || "").trim() !== pertLinkSearch.resp) return;
    rows.push({
      node: n,
      linked: linked.has(n.id),
      cycle: closing.has(n.id),
      date: pertLsDateOf(n, dir)
    });
  });

  // Tri chronologique puis alphabetique : on relie en raisonnant sur l'enchainement,
  // la date est le repere naturel (meme ordre que les listes de voisins du panneau).
  rows.sort((a, b) => {
    const da = a.date === null || a.date === undefined ? Infinity : a.date;
    const db = b.date === null || b.date === undefined ? Infinity : b.date;
    if (da !== db) return da - db;
    return String(a.node.properties.label || "")
      .localeCompare(String(b.node.properties.label || ""), "fr");
  });

  return { rows: rows.slice(0, PERT_LS_MAX_ROWS), total: rows.length };
}

// ─── Creation effective du lien ────────────────────────────────────────────────

// Cree le lien entre le nœud courant et `other`, dans le sens choisi. Le recalcul PERT
// et le cran d'historique ne sont PAS declenches ici : graph.onConnectionChange (ui.js)
// s'en charge deja pour toute connexion, d'ou qu'elle vienne — les refaire poserait deux
// crans d'undo pour un seul geste.
function pertLsCreateLink(other) {
  const node = pertLsNode();
  if (!node || !other) return;
  const src = pertLinkSearch.dir === "succ" ? node : other;
  const dst = pertLinkSearch.dir === "succ" ? other : node;
  const ok = src.connect(0, dst, freeInputSlot(dst));
  if (!ok) {
    if (window.showToast) showToast("Lien impossible entre ces deux nœuds", true);
    return;
  }
  const nomSrc = src.properties.label || "(sans nom)";
  const nomDst = dst.properties.label || "(sans nom)";
  if (window.showToast) showToast("Lien créé : « " + nomSrc + " » → « " + nomDst + " »");
  const canvas = window.pertCanvas;
  if (canvas) canvas.setDirty(true, true);
  pertLsRender();
}

// ─── Rendu ─────────────────────────────────────────────────────────────────────

function pertLsBuildDirButtons() {
  const box = document.getElementById("linksearch-dir");
  if (!box) return;
  box.innerHTML = "";
  [
    { id: "succ", label: "↣ Successeurs", hint: "Le nœud sélectionné précède celui que vous choisirez" },
    { id: "pred", label: "↢ Prédécesseurs", hint: "Le nœud que vous choisirez précède le nœud sélectionné" }
  ].forEach(d => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ls-dir-btn" + (pertLinkSearch.dir === d.id ? " active" : "");
    b.textContent = d.label;
    b.title = d.hint;
    b.addEventListener("click", () => {
      if (pertLinkSearch.dir === d.id) return;
      pertLinkSearch.dir = d.id;
      pertLsRender();
    });
    box.appendChild(b);
  });
}

// Remplit une liste deroulante de facette (« Tous » + valeurs connues). La valeur
// courante est conservee si elle existe encore ; sinon la facette retombe sur « Tous »
// plutot que de filtrer sur une valeur disparue, ce qui donnerait une liste vide sans
// explication.
function pertLsFillFacet(selectId, values, current, allLabel) {
  const sel = document.getElementById(selectId);
  if (!sel) return "";
  const keep = values.indexOf(current) !== -1 ? current : "";
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = allLabel;
  sel.appendChild(opt0);
  values.forEach(v => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  });
  sel.value = keep;
  return keep;
}

// Une ligne de resultat. Un candidat impossible est rendu comme un <div> et non comme
// un <button> : il ne doit etre ni cliquable, ni atteignable au clavier — un bouton
// desactive dans une longue liste ne fait qu'allonger le parcours de tabulation.
function pertLsBuildRow(row) {
  const n = row.node;
  const bloque = row.linked || row.cycle;
  const el = document.createElement(bloque ? "div" : "button");
  if (!bloque) el.type = "button";
  el.className = "ls-row" + (row.linked ? " ls-taken" : "") + (row.cycle ? " ls-cycle" : "")
    + (n.is_critical ? " lk-critical" : "");

  const glyph = document.createElement("span");
  glyph.className = "lk-glyph";
  glyph.textContent = n.type === "pert/milestone" ? "◈" : "▭";

  const name = document.createElement("span");
  name.className = "lk-name";
  name.textContent = n.properties.label || "(sans nom)";

  // Groupe et responsable, quand ils existent : ce sont eux qui permettent de trancher
  // entre deux taches de meme nom sur un planning fourni (« Recette » de quel lot ?).
  const p = n.properties || {};
  const meta = [p.group, p.responsible].map(v => (v || "").trim()).filter(Boolean).join(" · ");
  const sub = document.createElement("span");
  sub.className = "ls-meta";
  sub.textContent = meta;

  const tail = document.createElement("span");
  tail.className = "ls-tail";
  if (row.linked) { tail.textContent = "déjà lié"; tail.title = "Ce lien existe déjà"; }
  else if (row.cycle) {
    tail.textContent = "boucle";
    tail.title = "Ce lien refermerait une boucle : le planning ne serait plus calculable";
  } else {
    tail.textContent = pertOffsetLabel(row.date);
  }

  el.appendChild(glyph);
  el.appendChild(name);
  if (meta) el.appendChild(sub);
  el.appendChild(tail);
  if (!bloque) {
    el.title = "Créer le lien";
    el.addEventListener("click", () => pertLsCreateLink(n));
  }
  return el;
}

// (Re)construit l'integralite du contenu de la fenetre a partir de l'etat courant.
function pertLsRender() {
  const node = pertLsNode();
  const list = document.getElementById("linksearch-list");
  const count = document.getElementById("linksearch-count");
  const title = document.getElementById("linksearch-title");
  if (!list || !count) return;

  // Le nœud a disparu pendant que la fenetre etait ouverte (suppression, undo) : on
  // ferme plutot que d'afficher une fenetre qui ne relie plus rien.
  if (!node) { pertCloseLinkSearch(); return; }

  if (title) {
    title.textContent = "Relier « " + (node.properties.label || "(sans nom)") + " »";
  }
  pertLsBuildDirButtons();

  // Les facettes sont reconstruites a chaque rendu : un groupe peut naitre ou
  // disparaitre pendant que la fenetre est ouverte (les liens crees ne changent rien,
  // mais un undo, si).
  pertLinkSearch.group = pertLsFillFacet("linksearch-group", collectGroupNames(),
    pertLinkSearch.group, "Tous les groupes");
  pertLinkSearch.resp = pertLsFillFacet("linksearch-resp", collectResponsibles(),
    pertLinkSearch.resp, "Tous les responsables");

  const { rows, total } = pertLsCandidates();
  const dispo = rows.filter(r => !r.linked && !r.cycle).length;
  count.textContent = total === 0
    ? "Aucun nœud ne correspond"
    : (total + " nœud(s) trouvé(s), " + dispo + " reliable(s)"
       + (total > rows.length ? " — " + rows.length + " premiers affichés, affinez la recherche" : ""));
  count.className = "ls-count" + (total === 0 ? " empty" : "");

  list.innerHTML = "";
  rows.forEach(r => list.appendChild(pertLsBuildRow(r)));
}

// ─── Ouverture / fermeture ─────────────────────────────────────────────────────

// Ouvre la fenetre pour `node`. Refuse un Label (aucun port) et un graphe vide de
// tout autre nœud reliable : mieux vaut le dire que d'ouvrir une fenetre vide.
function pertOpenLinkSearch(node) {
  if (!pertLsLinkable(node)) {
    if (window.showToast) showToast("Un Label ne se relie pas : il n'a ni entrée ni sortie", true);
    return;
  }
  pertLinkSearch.nodeId = node.id;
  pertLinkSearch.text = "";
  const input = document.getElementById("linksearch-text");
  if (input) input.value = "";
  pertLsRender();
  const dlg = document.getElementById("linksearch-dialog");
  if (dlg) dlg.style.display = "flex";
  // Le curseur va dans la recherche : ouvrir cette fenetre, c'est vouloir designer un
  // nœud par son nom (meme parti pris que le menu de filtre).
  if (input) input.focus();
}
window.pertOpenLinkSearch = pertOpenLinkSearch;

function pertCloseLinkSearch() {
  const dlg = document.getElementById("linksearch-dialog");
  if (dlg) dlg.style.display = "none";
  pertLinkSearch.nodeId = null;
}
window.pertCloseLinkSearch = pertCloseLinkSearch;

// Branche les ecouteurs fixes de la fenetre (appele depuis ui.js au demarrage).
function pertInstallLinkSearch() {
  const input = document.getElementById("linksearch-text");
  if (input) {
    input.addEventListener("input", e => {
      pertLinkSearch.text = e.target.value;
      pertLsRender();
    });
  }
  const g = document.getElementById("linksearch-group");
  if (g) g.addEventListener("change", e => { pertLinkSearch.group = e.target.value; pertLsRender(); });
  const r = document.getElementById("linksearch-resp");
  if (r) r.addEventListener("change", e => { pertLinkSearch.resp = e.target.value; pertLsRender(); });
  const close = document.getElementById("linksearch-close");
  if (close) close.addEventListener("click", pertCloseLinkSearch);
  // Echap ferme : la fenetre ne se fermant pas d'elle-meme apres un lien (decision 3),
  // il faut une sortie qui ne demande pas de viser un bouton.
  const dlg = document.getElementById("linksearch-dialog");
  if (dlg) {
    dlg.addEventListener("keydown", e => { if (e.key === "Escape") pertCloseLinkSearch(); });
  }
}
window.pertInstallLinkSearch = pertInstallLinkSearch;
