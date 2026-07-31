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

// Etat visuel d'un jalon dans les listes de synthese. On REUTILISE la regle de la zone
// de travail (MilestoneNode.targetState, nodes.js #20) pour qu'un jalon ait la meme
// couleur a l'ecran et dans la synthese — une seule regle a retenir, une seule a
// maintenir. Deux ecarts assumes, tous deux vers la neutralite :
//   - « aucune cible » → etat "none" (police normale) et non orange : sans echeance,
//     il n'y a aucun verdict a rendre ; l'orange serait une alerte sans objet ;
//   - jalon PUREMENT ENTRANT (aucun lien entrant) → "none" egalement : sa cible est une
//     DONNEE D'ENTREE, pas un engagement du projet. Le moteur applique deja cette regle
//     (ES = EF = offset(cible), target_missed force a faux, cf. pert_engine.js) ; sans
//     cet ecart, sa marge structurellement nulle le peindrait en orange a chaque fois.
function pertSynthMilestoneState(node, row, hasIn) {
  if (!row.hasDue) return "none";
  if (!hasIn) return "none";
  if (typeof node.targetState === "function") return node.targetState();
  // Repli si la methode du nœud n'est pas disponible (nœud deserialise a plat) :
  // meme seuil que nodes.js, MILESTONE_GREEN_MARGIN unites de temps.
  if (node.target_missed) return "alert";
  const seuil = (typeof MILESTONE_GREEN_MARGIN === "number") ? MILESTONE_GREEN_MARGIN : 1;
  return (row.margin !== null && row.margin >= seuil) ? "safe" : "neutral";
}

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
    // Charge en heures homme (31/07/2026), agregee comme le cout : c'est la grandeur
    // du chiffrage d'offre, celle qu'on negocie avant d'en parler en euros. Toujours
    // lue via pertActivityHours, qui connait le mode de saisie de chaque tache.
    totalHours: 0,
    // Part du cout total ENGAGEE AVANT T0 (travaux anticipes), au prorata de la duree
    // situee a gauche de T0. Sert de bascule d'affichage : les colonnes « anticipe /
    // non anticipe » n'apparaissent que si le planning comporte de l'anticipation.
    anticCost: 0,
    endDate: null,
    critTasks: 0,
    critCost: 0,
    // Jalons classes par TOPOLOGIE et non plus par tenue de cible : un jalon ENTRANT
    // (au moins un lien sortant) alimente la suite du planning, un jalon SORTANT (au
    // moins un lien entrant) est produit par lui. Un checkpoint intermediaire a les
    // deux → il figure DANS LES DEUX LISTES, ce qui est voulu : il est a la fois un
    // livrable pour l'amont et une donnee d'entree pour l'aval.
    milestonesEntrants: [],
    milestonesSortants: [],
    milestonesIsoles: [],
    groups: [],
    // Onglet ANALYSE : liste de « controles » du planning, chacun autonome (titre,
    // explication, colonnes, lignes). Le rendu est generique, donc en ajouter un
    // consiste a pousser un objet de plus dans pertBuildAnalyses().
    analyses: [],
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
      model.totalHours += pertActivityHours(n);
      model.anticCost += pertAnticipatedCost(n);
      if (critIds.has(n.id)) { model.critTasks++; model.critCost += c; }
    }
  });
  model.endDate = (maxEf != null) ? pertOffsetToDate(maxEf) : null;

  // Passe 2 : jalons ENTRANTS / SORTANTS, avec marge vis-a-vis de la cible.
  // La marge est en UNITES du projet : cible (offset) - EF (offset). Positive = tenu
  // avec avance, negative = rate. target_missed est calcule par pertRecalc (EF > cible).
  //
  // Le code couleur reprend TEL QUEL celui des Jalons dans la zone de travail
  // (MilestoneNode.targetState, cf. nodes.js #20) — une seule regle a comprendre pour
  // l'utilisateur, et une seule a maintenir : rouge = cible non tenue, vert = tenue
  // avec au moins MILESTONE_GREEN_MARGIN unites d'avance, orange = tenue tout juste.
  const adj = (typeof pertBuildAdjacency === "function") ? pertBuildAdjacency(g) : null;
  g._nodes.forEach(n => {
    if (n.type !== "pert/milestone") return;
    model.nbMilestones++;
    const hasIn = !!(adj && adj.preds[n.id] && adj.preds[n.id].length > 0);
    const hasOut = !!(adj && adj.succs[n.id] && adj.succs[n.id].length > 0);
    const row = {
      // Identifiant du nœud : la ligne doit pouvoir RAMENER au jalon dans le planning
      // (cf. synthNodeLink). Rien d'autre dans le modele n'en depend.
      id: n.id,
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
    if (row.hasDue && row.dueOff !== null && n.ef != null) row.margin = row.dueOff - n.ef;
    row.state = pertSynthMilestoneState(n, row, hasIn);
    if (hasOut) model.milestonesEntrants.push(row);
    if (hasIn) model.milestonesSortants.push(row);
    if (!hasIn && !hasOut) model.milestonesIsoles.push(row);
  });

  // Classement chronologique croissant des trois listes de jalons (cle : date cible si
  // presente, sinon fin au plus tot). Les jalons sans repere temporel finissent en queue,
  // le libelle departageant les ex aequo pour un ordre stable d'une ouverture a l'autre.
  const byChrono = (a, b) => {
    const oa = (a.sortOff != null) ? a.sortOff : Infinity;
    const ob = (b.sortOff != null) ? b.sortOff : Infinity;
    return (oa - ob) || a.label.localeCompare(b.label, "fr");
  };
  model.milestonesEntrants.sort(byChrono);
  model.milestonesSortants.sort(byChrono);
  model.milestonesIsoles.sort(byChrono);

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
    let cost = 0, hours = 0, anticCost = 0, maxLf = null;
    nodes.forEach(n => {
      cost += pertActivityCost(n);
      hours += pertActivityHours(n);
      anticCost += pertAnticipatedCost(n);
      if (n.lf != null && (maxLf === null || n.lf > maxLf)) maxLf = n.lf;
    });
    model.groups.push({
      name: name || "(sans groupe)",
      color: name ? (groupColors[name] || (nodes[0].properties && nodes[0].properties.color) || null) : null,
      nbTasks: nodes.length,
      hours,
      cost,
      anticCost,
      plainCost: cost - anticCost,
      lfDate: (maxLf != null) ? pertOffsetToDate(maxLf) : null,
    });
  });

  model.analyses = pertBuildAnalyses(g, adj);
  return model;
}

// ─── Onglet ANALYSE : contrôles de qualité du planning ──────────────────────────
//
// Objectif : ce qui n'est PAS lisible dans les listes chronologiques — des anomalies de
// STRUCTURE, qui ne sautent aux yeux que sur un petit planning. Chaque controle est un
// objet autonome { id, title, hint, columns, rows } ; le rendu est generique, donc en
// ajouter un nouveau consiste a pousser un objet de plus dans la liste ci-dessous.
// Un controle sans anomalie n'est PAS affiche : l'onglet doit se lire comme une liste
// de choses a regarder, pas comme une liste de cases vertes a faire defiler.

// Forme normalisee d'un libelle pour la comparaison : minuscules, sans accents, sans
// ponctuation ni espaces multiples. « Livraison MOTEUR (v2) » et « livraison moteur v2 »
// doivent etre reconnus comme le meme nom.
function pertSynthNormalizeLabel(s) {
  const base = (typeof pertNormalizeSearch === "function")
    ? pertNormalizeSearch(s)
    : String(s == null ? "" : s).toLowerCase();
  return base.replace(/[^a-z0-9]+/g, " ").trim();
}

// Distance de Levenshtein (deux lignes seulement : les libelles sont courts).
function pertSynthLevenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[b.length];
}

// Similitude de deux libelles, dans [0, 1]. Seuil d'alerte : PERT_SYNTH_SIMILARITY.
// Une valeur trop basse noierait l'utilisateur sous les faux positifs (« Jalon 1 » et
// « Jalon 2 » se ressemblent beaucoup en distance d'edition alors qu'ils designent
// deux choses differentes) ; d'ou un seuil eleve, et des libelles courts exclus.
const PERT_SYNTH_SIMILARITY = 0.85;
const PERT_SYNTH_MIN_LABEL = 5;   // en deca, la distance d'edition ne veut plus rien dire

// Part d'un nœud qui doit etre RECOUVERTE pour qu'on le declare masque.
//
// Le critere n'est pas « ces deux nœuds se touchent » mais « celui-ci perd une part
// significative de son information ». Un recouvrement partiel ou leger n'est pas un
// probleme : sur un planning un peu dense il y en a partout, et les signaler
// produirait une liste interminable ou l'on ne verrait plus le seul cas qui compte —
// typiquement un jalon integralement disparu sous une activite. A 50 %, c'est la
// moitie du contenu du nœud (ses dates, sa marge, son avancement) qui n'est plus
// lisible : le seuil est deja genereux.
const PERT_SYNTH_MASK_RATIO = 0.5;

function pertSynthSimilarity(a, b) {
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return 1 - (pertSynthLevenshtein(a, b) / max);
}

// Deux libelles qui ne different QUE par leurs chiffres sont une SERIE numerotee
// deliberee (« Jalon sortie 1 » / « Jalon sortie 2 »), pas un doublon. En distance
// d'edition ils se ressemblent enormement — un seul caractere sur quinze — et sans
// cette regle ils remontaient en tete des faux positifs, ce qui suffisait a
// decredibiliser tout le controle.
function pertSynthNumberedSiblings(a, b) {
  const sansChiffres = (s) => s.replace(/[0-9]+/g, "").replace(/\s+/g, " ").trim();
  const chiffres = (s) => (s.match(/[0-9]+/g) || []).join(",");
  return sansChiffres(a) === sansChiffres(b) && chiffres(a) !== chiffres(b);
}

// Construit la liste des controles. `adj` = adjacence du moteur (preds/succs).
function pertBuildAnalyses(g, adj) {
  const out = [];
  const preds = (adj && adj.preds) || {};
  const succs = (adj && adj.succs) || {};
  const nodes = (g && g._nodes) || [];
  const labelOf = (n) => (n.properties && (n.properties.label || n.properties.text)) || "(sans nom)";
  const nbIn = (n) => (preds[n.id] || []).length;
  const nbOut = (n) => (succs[n.id] || []).length;
  const milestones = nodes.filter(n => n.type === "pert/milestone");
  const activities = nodes.filter(n => n.type === "pert/activity");

  const push = (o) => { if (o.rows.length) out.push(o); };

  // 1) Jalons orphelins — ni amont ni aval. Le plus souvent une connexion oubliee :
  // le jalon n'est contraint par rien et ne contraint rien, il ne « tient » donc rien.
  push({
    id: "jalons-orphelins",
    title: "Jalons orphelins",
    hint: "Aucun lien entrant ni sortant : ce jalon ne contraint rien et n'est contraint "
        + "par rien. Le plus souvent, une connexion a été oubliée.",
    columns: [{ text: "Jalon" }, { text: "Cible" }],
    rows: milestones.filter(n => !nbIn(n) && !nbOut(n)).map(n => ({
      filterText: labelOf(n),
      cells: [
        { text: labelOf(n), nodeId: n.id },
        { text: (typeof pertMilestoneDueLabel === "function" && pertMilestoneHasDue(n))
            ? pertMilestoneDueLabel(n) : "—" },
      ],
    })),
  });

  // 2) Jalons de nom similaire. Le cas qui INTERESSE vraiment est le couple
  // « sortant d'un lot » / « entrant d'un autre » portant le meme nom : c'est le meme
  // evenement saisi deux fois, et le lien qui devrait les relier manque. On signale
  // aussi les doublons a l'interieur d'une meme liste (saisie en double).
  const simRows = [];
  const norm = milestones.map(n => ({ n, key: pertSynthNormalizeLabel(labelOf(n)) }))
                         .filter(x => x.key.length >= PERT_SYNTH_MIN_LABEL);
  for (let i = 0; i < norm.length; i++) {
    for (let j = i + 1; j < norm.length; j++) {
      if (pertSynthNumberedSiblings(norm[i].key, norm[j].key)) continue;
      const s = pertSynthSimilarity(norm[i].key, norm[j].key);
      if (s < PERT_SYNTH_SIMILARITY) continue;
      const a = norm[i].n, b = norm[j].n;
      // Deja relies l'un a l'autre ? Alors le doublon est deliberement chaine, rien a dire.
      if ((succs[a.id] || []).indexOf(b.id) !== -1 || (succs[b.id] || []).indexOf(a.id) !== -1) continue;
      const role = (x) => (nbIn(x) ? (nbOut(x) ? "intermédiaire" : "sortant") : (nbOut(x) ? "entrant" : "orphelin"));
      simRows.push({
        // Une ligne, DEUX nœuds : le terme de filtre est ce qu'ils ont en commun, pour
        // qu'un seul geste les mette tous les deux en evidence — c'est en les voyant
        // cote a cote qu'on tranche entre doublon et homonymie.
        filterText: pertSynthCommonTerm(labelOf(a), labelOf(b)),
        cells: [
          { text: labelOf(a), nodeId: a.id },
          { text: role(a) },
          { text: labelOf(b), nodeId: b.id },
          { text: role(b) },
          { text: s >= 0.999 ? "identique" : Math.round(s * 100) + " %", cls: "num" },
        ],
      });
    }
  }
  push({
    id: "jalons-similaires",
    title: "Jalons de nom similaire",
    hint: "Deux jalons portant presque le même nom sont souvent le même événement saisi "
        + "deux fois — typiquement le jalon sortant d'un lot et le jalon entrant du "
        + "suivant, entre lesquels le lien manque.",
    columns: [{ text: "Jalon" }, { text: "Rôle" }, { text: "Jalon" }, { text: "Rôle" },
              { text: "Ressemblance", cls: "num" }],
    rows: simRows,
  });

  // 3) Taches isolees — une Activite sans aucun lien n'est ni tenue par une echeance
  // ni tenante pour la suite : elle est hors du reseau, donc hors du calcul de chemin.
  push({
    id: "taches-isolees",
    title: "Tâches isolées",
    hint: "Aucun lien entrant ni sortant : la tâche est hors du réseau, elle ne participe "
        + "à aucun enchaînement et ne peut pas être sur le chemin critique.",
    columns: [{ text: "Tâche" }, { text: "Durée", cls: "num" }],
    rows: activities.filter(n => !nbIn(n) && !nbOut(n)).map(n => ({
      filterText: labelOf(n),
      cells: [
        { text: labelOf(n), nodeId: n.id },
        { text: String(n.properties.duration || 0), cls: "num" },
      ],
    })),
  });

  // 4) Fins de chaine sans jalon — une tache qui ne debouche sur rien produit quelque
  // chose que le planning ne materialise pas. C'est le controle « chaque branche
  // se termine-t-elle par un livrable identifie ? ».
  push({
    id: "fins-sans-jalon",
    title: "Fins de chaîne sans jalon",
    hint: "Ces tâches n'ont aucun successeur : leur aboutissement n'est matérialisé par "
        + "aucun jalon. Ajouter un jalon de sortie rend le livrable explicite et "
        + "vérifiable.",
    columns: [{ text: "Tâche" }, { text: "Fin t.tôt" }],
    rows: activities.filter(n => nbIn(n) && !nbOut(n)).map(n => ({
      filterText: labelOf(n),
      cells: [
        { text: labelOf(n), nodeId: n.id },
        { text: (typeof pertFormatDate === "function" && n.ef != null)
            ? pertFormatDate(pertOffsetToDate(n.ef)) : "—" },
      ],
    })),
  });

  // 5) Nœuds MASQUES a l'ecran. On ne signale pas « deux nœuds qui se touchent » —
  // un recouvrement partiel n'est pas un probleme, il y en a partout sur un planning
  // dense, et en faire la liste noierait le seul cas qui compte. On signale la PERTE
  // D'INFORMATION : un nœud dont une part significative disparait sous un autre.
  // L'exemple type est le jalon integralement recouvert par une activite — il n'est
  // plus lisible, plus cliquable, et l'utilisateur peut le croire supprime.
  //
  // Le sens du recouvrement compte, et il est donne par l'ORDRE DE DESSIN : LiteGraph
  // parcourt _nodes dans l'ordre, le dernier passe donc par-dessus. C'est le nœud du
  // DESSOUS qui perd de l'information — le rapport se calcule sur SA surface a lui,
  // et non sur celle de l'intersection dans l'absolu : une grosse tache a moitie
  // couverte perd autant qu'un petit jalon a moitie couvert.
  //
  // TOUS les types comptent : Activites, Jalons et Labels dessinent tous un fond
  // OPAQUE (un Label a une couleur de fond, defaut #fffedc) — un Label pose sur une
  // tache la masque donc tout autant.
  const boite = (n) => {
    if (!n.pos || !n.size || !(n.size[0] > 0) || !(n.size[1] > 0)) return null;
    return { x: n.pos[0], y: n.pos[1], w: n.size[0], h: n.size[1] };
  };
  const masques = [];
  const boites = nodes.map(n => ({ n, b: boite(n) })).filter(x => x.b);
  for (let i = 0; i < boites.length; i++) {
    for (let j = i + 1; j < boites.length; j++) {
      // i est dessine AVANT j → i est dessous, c'est lui qui peut etre masque.
      const dessous = boites[i], dessus = boites[j];
      const a = dessous.b, b = dessus.b;
      const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (dx <= 0 || dy <= 0) continue;
      const part = (dx * dy) / (a.w * a.h);
      if (part < PERT_SYNTH_MASK_RATIO) continue;
      masques.push({ masque: dessous.n, par: dessus.n, part });
    }
  }
  // Du plus grave au plus anodin : le nœud le plus recouvert est celui dont on a
  // perdu le plus, et c'est par lui qu'on veut commencer.
  masques.sort((p, q) => q.part - p.part);
  const typeOf = (n) => n.type === "pert/activity" ? "Tâche"
                      : (n.type === "pert/milestone" ? "Jalon" : "Label");
  push({
    id: "noeuds-masques",
    title: "Nœuds masqués",
    hint: "Ces nœuds disparaissent sous un autre : leur contenu (dates, marge, "
        + "avancement) n'est plus lisible et la zone recouverte intercepte les clics — "
        + "au point qu'on peut croire le nœud supprimé. Déplacer celui du dessus, ou "
        + "relancer « Réorganiser », suffit. Les recouvrements partiels, eux, ne sont "
        + "pas signalés : ils ne font perdre aucune information.",
    columns: [{ text: "Nœud masqué" }, { text: "Type" }, { text: "Masqué à", cls: "num" },
              { text: "Par" }, { text: "Type" }],
    rows: masques.map(c => ({
      // Une ligne met en jeu DEUX nœuds sans rien de commun dans leur nom : aucun
      // terme ne les surlignerait tous les deux. On retient le nœud MASQUE, celui
      // qu'on cherche a retrouver ; les deux noms, eux, menent chacun a leur nœud.
      filterText: labelOf(c.masque),
      cells: [
        { text: labelOf(c.masque), nodeId: c.masque.id },
        { text: typeOf(c.masque) },
        { text: Math.round(c.part * 100) + " %", cls: "num" },
        { text: labelOf(c.par), nodeId: c.par.id },
        { text: typeOf(c.par) },
      ],
    })),
  });

  // 6) Taches de duree nulle — une Activite de duree 0 est un JALON deguise : elle
  // n'occupe personne et brouille la lecture des enchainements.
  push({
    id: "duree-nulle",
    title: "Tâches de durée nulle",
    hint: "Une tâche sans durée est en réalité un jalon : la convertir clarifie le "
        + "planning et évite de la compter comme une charge.",
    columns: [{ text: "Tâche" }, { text: "Groupe" }],
    rows: activities.filter(n => !(parseFloat(n.properties.duration) > 0)).map(n => ({
      filterText: labelOf(n),
      cells: [
        { text: labelOf(n), nodeId: n.id },
        { text: (n.properties.group || "").trim() || "—" },
      ],
    })),
  });

  return out;
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
  rows.forEach(row => {
    // Une ligne est soit un simple tableau de cellules, soit { cls, cells } quand elle
    // porte une mise en forme d'ensemble (code couleur de tenue de cible des jalons).
    const cells = Array.isArray(row) ? row : (row.cells || []);
    const tr = synthEl("tr", Array.isArray(row) ? null : (row.cls || null));
    cells.forEach(c => {
      const td = synthEl("td", c.cls || null);
      if (c.node) td.appendChild(c.node);
      // Cellule DESIGNANT UN NŒUD : rendue cliquable, elle mene au nœud. Le lecteur
      // d'une synthese veut aller voir ce qu'on lui signale, pas le retrouver a l'œil
      // dans le planning. Meme geste que les voisins du panneau lateral.
      else if (c.nodeId != null) td.appendChild(synthNodeLink(c.text, c.nodeId));
      else td.textContent = (c.text != null ? c.text : "");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

// ─── Depuis la synthèse vers le planning ────────────────────────────────────────
//
// Deux gestes complementaires, parce que les deux questions ne sont pas les memes :
//   - « montre-moi CE nœud »        → le lien sur le nom : on ferme la fenetre, le nœud
//                                     est selectionne et la vue centree dessus ;
//   - « montre-moi CES nœuds-la »   → le bouton 🔎 de la ligne : on ferme la fenetre en
//                                     posant le filtre de recherche sur leur nom commun,
//                                     ce qui les met en evidence ENSEMBLE dans le plan.
// Le premier convient a une anomalie ponctuelle (un jalon orphelin), le second a une
// anomalie qui met en jeu PLUSIEURS nœuds (deux jalons de nom similaire) : les voir
// cote a cote est justement ce qui permet de trancher.
//
// Dans les deux cas la fenetre se ferme : elle recouvre le planning, l'y laisser
// ouverte rendrait le resultat invisible.

// Ferme TOUTES les fenetres de rapport (synthese, suivi). Un lien vers un nœud est
// rendu par les deux : plutot que de faire porter a chaque lien la connaissance de la
// fenetre qui l'a construit, on ferme ce qui recouvre le planning, point.
function pertCloseReportDialogs() {
  ["synthesis-dialog", "suivi-dialog"].forEach(id => {
    const d = document.getElementById(id);
    if (d) d.style.display = "none";
  });
}
window.pertCloseReportDialogs = pertCloseReportDialogs;

function pertSynthGoToNode(id) {
  const g = window.pertGraph;
  const node = g && g._nodes ? g._nodes.find(n => n.id === id) : null;
  pertCloseReportDialogs();
  if (!node) return;
  if (typeof pertFocusNode === "function") pertFocusNode(node);
}
window.pertSynthGoToNode = pertSynthGoToNode;

// Pose le filtre de RECHERCHE sur un texte, en passant par la vraie zone de saisie du
// menu Filtre : tout ce qui en depend (compteur, libelle du declencheur, regles de
// vidage) reste ainsi valable, sans dupliquer la moindre logique.
function pertSynthFilterOn(text) {
  pertCloseReportDialogs();
  const input = document.getElementById("filter-search");
  if (!input) return;
  input.value = text || "";
  input.dispatchEvent(new Event("input"));
  if (typeof showToast === "function" && text) {
    showToast("Filtre de recherche : « " + text + " »");
  }
}
window.pertSynthFilterOn = pertSynthFilterOn;

// Lien cliquable vers un nœud (rendu comme du texte souligne, pas comme un bouton :
// dans un tableau, une rangee de boutons serait visuellement assourdissante).
function synthNodeLink(text, nodeId) {
  const b = synthEl("button", "synth-link", text != null ? text : "");
  b.type = "button";
  b.title = "Aller à ce nœud dans le planning";
  b.addEventListener("click", () => pertSynthGoToNode(nodeId));
  return b;
}

// Bouton d'action « mettre en évidence » d'une ligne d'analyse.
function synthFilterButton(text) {
  const b = synthEl("button", "synth-goto", "🔎");
  b.type = "button";
  b.title = "Mettre en évidence dans le planning (filtre « " + text + " »)";
  b.addEventListener("click", () => pertSynthFilterOn(text));
  return b;
}

// Plus longue amorce commune a deux libelles, ramenee a une limite de mot. Sert de
// terme de filtre pour une ligne qui met en jeu DEUX nœuds : c'est ce qu'ils ont en
// commun qu'on veut voir surligne, pas l'un des deux. Repli sur le premier libelle
// quand l'amorce commune est trop courte pour etre discriminante.
function pertSynthCommonTerm(a, b) {
  a = String(a || ""); b = String(b || "");
  let i = 0;
  while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  let common = a.slice(0, i).trim();
  // Ne pas couper au milieu d'un mot : « Livraison protot » filtrerait large et mal.
  if (i < a.length && i < b.length && !/\s$/.test(a.slice(0, i))) {
    const cut = common.lastIndexOf(" ");
    if (cut > 0) common = common.slice(0, cut);
  }
  return common.length >= 4 ? common : a.trim();
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

// ─── Onglets (= chapitres à l'impression) ───────────────────────────────────────
//
// Sur un gros planning, tout empiler dans une seule colonne rendait la fenetre
// illisible malgre le defilement. Quatre onglets a l'ecran ; a l'IMPRESSION les quatre
// panneaux sont visibles a la suite, chacun ouvrant un chapitre sur une nouvelle page
// (regles @media print). Le titre de chapitre est donc dans le DOM en permanence, mais
// masque a l'ecran : il ferait doublon avec l'onglet actif.
const PERT_SYNTH_TABS = [
  { id: "generique", label: "Générique", chapter: "Générique" },
  { id: "sortants",  label: "Jalons sortants", chapter: "Jalons sortants" },
  { id: "entrants",  label: "Jalons entrants", chapter: "Jalons entrants" },
  { id: "analyse",   label: "Analyse", chapter: "Analyse du planning" },
];

// Onglet courant, memorise d'une ouverture a l'autre (meme principe que les
// Parametres et le panneau lateral) : on revient souvent verifier le meme chapitre.
let pertSynthTab = "generique";

function pertSelectSynthTab(name) {
  const tabs = document.querySelectorAll("#synthesis-tabs .synth-tab");
  const panels = document.querySelectorAll("#synthesis-content .synth-panel");
  if (!tabs.length) return;
  let known = false;
  tabs.forEach(t => { if (t.dataset.tab === name) known = true; });
  if (!known) name = tabs[0].dataset.tab;
  pertSynthTab = name;
  tabs.forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  panels.forEach(p => p.classList.toggle("active", p.dataset.panel === name));
  // Le defilement appartient au panneau : changer d'onglet doit repartir du haut,
  // sinon on arrive au milieu d'un tableau sans savoir ou l'on est.
  const c = document.getElementById("synthesis-content");
  if (c) c.scrollTop = 0;
}
window.pertSelectSynthTab = pertSelectSynthTab;

// Construit la barre d'onglets et les quatre panneaux vides ; renvoie les panneaux
// indexes par id, que le rendu remplit ensuite.
function pertBuildSynthTabs(model) {
  const bar = document.getElementById("synthesis-tabs");
  const c = document.getElementById("synthesis-content");
  const panels = {};
  if (!bar || !c) return panels;
  bar.innerHTML = "";
  c.innerHTML = "";

  // Nombre de points d'attention : porte par l'onglet Analyse, pour qu'on sache qu'il
  // y a quelque chose a y voir sans avoir a l'ouvrir.
  const nbAnalyses = model.analyses.reduce((s, a) => s + a.rows.length, 0);

  PERT_SYNTH_TABS.forEach(t => {
    const b = synthEl("button", "synth-tab", t.label);
    b.type = "button";
    b.dataset.tab = t.id;
    b.setAttribute("role", "tab");
    if (t.id === "analyse" && nbAnalyses) {
      const badge = synthEl("span", "synth-tab-badge", String(nbAnalyses));
      b.appendChild(badge);
    }
    b.addEventListener("click", () => pertSelectSynthTab(t.id));
    bar.appendChild(b);

    const p = synthEl("div", "synth-panel");
    p.dataset.panel = t.id;
    // Titre de chapitre : masque a l'ecran (l'onglet le dit deja), affiche a l'impression.
    p.appendChild(synthEl("h3", "synth-chapter", t.chapter));
    c.appendChild(p);
    panels[t.id] = p;
  });
  return panels;
}

// (Re)construit le contenu de la fenetre de synthese.
function pertRenderSynthesis() {
  const c = document.getElementById("synthesis-content");
  if (!c) return;
  const m = pertBuildSynthesisModel();
  const panels = pertBuildSynthTabs(m);
  const gen = panels.generique || c;

  // 1) Vue d'ensemble.
  const ov = synthEl("div", "synth-overview");
  synthKV(ov, "Projet", m.title);
  synthKV(ov, "T0", m.t0 || "non défini");
  synthKV(ov, "Unité", m.unitLabel);
  synthKV(ov, "Fin de projet", pertFormatDate(m.endDate));
  synthKV(ov, "Tâches", String(m.nbTasks));
  synthKV(ov, "Jalons", String(m.nbMilestones));
  // Charge puis coût : la somme des heures du tableau par groupe doit se retrouver ici,
  // sinon le lecteur additionne les lignes à la main pour vérifier.
  synthKV(ov, "Charge totale", pertFormatHours(m.totalHours));
  synthKV(ov, "Coût total", pertFormatCost(m.totalCost));
  // Depense engagee AVANT le lancement contractuel : ligne affichee seulement si le
  // planning comporte effectivement des travaux anticipes.
  if (m.anticCost > 0) {
    synthKV(ov, "dont anticipé (avant T0)", pertFormatCost(m.anticCost));
  }
  synthKV(ov, "Chemin critique", m.critTasks + " tâche(s) · " + pertFormatCost(m.critCost));
  synthSection(gen, "Vue d'ensemble", ov);

  // 2) et 3) Jalons ENTRANTS puis SORTANTS, dans l'ordre chronologique. Un checkpoint
  // intermediaire (lien entrant ET sortant) figure dans les deux listes : il est un
  // livrable pour l'amont et une donnee d'entree pour l'aval. Le code couleur de tenue
  // de cible est celui de la zone de travail (cf. pertSynthMilestoneState).
  const mileHeaders = [
    { text: "Jalon" }, { text: "Type" }, { text: "Fin t.tôt" },
    { text: "Cible" }, { text: "Marge", cls: "num" },
  ];
  // Le nom du jalon MENE au jalon (meme mecanique que l'onglet Analyse). Pas de bouton
  // « mettre en évidence » ici : une ligne ne designe qu'UN nœud, et l'y conduire
  // directement est strictement plus utile que de le surligner parmi les autres.
  const mileRow = (r) => ({
    cls: "synth-mile-" + (r.state || "none"),
    cells: [
      { text: r.label, nodeId: r.id },
      { node: synthTagNode(r.tag), text: r.tag ? "" : "—" },
      { text: pertFormatDate(r.efDate) },
      { text: r.dueLabel || "—" },
      synthMarginCell(r.margin, m.unitLabel),
    ],
  });

  synthSection(panels.entrants || c, "Jalons entrants (" + m.milestonesEntrants.length + ")",
    m.milestonesEntrants.length ? synthTable(mileHeaders, m.milestonesEntrants.map(mileRow)) : null,
    "Aucun jalon n'alimente le planning.");

  synthSection(panels.sortants || c, "Jalons sortants (" + m.milestonesSortants.length + ")",
    m.milestonesSortants.length ? synthTable(mileHeaders, m.milestonesSortants.map(mileRow)) : null,
    "Aucun jalon produit par le planning.");

  // 4) Jalons isoles (ni entrant ni sortant) : signales seulement s'il y en a. Ils
  // n'appartiennent a aucune des deux listes ci-dessus et passeraient sinon a la
  // trappe. Ils sont RAPPELES ici, dans les deux onglets de jalons, parce qu'un
  // lecteur qui parcourt « les jalons » doit les voir ; leur diagnostic, lui, vit
  // dans l'onglet Analyse.
  if (m.milestonesIsoles.length) {
    [panels.entrants, panels.sortants].forEach(p => {
      if (!p) return;
      synthSection(p, "Jalons isolés (" + m.milestonesIsoles.length + ")",
        synthTable(mileHeaders, m.milestonesIsoles.map(mileRow)));
    });
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
      // La charge PRECEDE le coût : elle en est la cause (charge × taux), et c'est
      // elle qu'on négocie en phase Offre. Toujours affichée, quel que soit le mode de
      // saisie des tâches du groupe — les deux expressions s'agrègent dans la même unité.
      { text: pertFormatHours(gr.hours), cls: "num" },
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
    { text: "Groupe" }, { text: "Tâches", cls: "num" }, { text: "Charge (h)", cls: "num" },
    { text: "Coût global", cls: "num" },
  ];
  if (showAntic) {
    grpHeaders.push({ text: "dont anticipé", cls: "num" });
    grpHeaders.push({ text: "dont non anticipé", cls: "num" });
  }
  grpHeaders.push({ text: "Fin au plus tard", cls: "num" });
  synthSection(gen, "Par groupe (WP / métier)",
    m.groups.length ? synthTable(grpHeaders, grpRows) : null,
    "Aucune tâche.");

  // 6) ANALYSE : un tableau par controle non vide, precede de son explication. Rien
  // detecte → un message unique, plutot que quatre sections vides a faire defiler.
  const an = panels.analyse || c;
  if (!m.analyses.length) {
    synthSection(an, "Points d'attention", null,
      "Aucun point d'attention détecté sur ce planning.");
  } else {
    m.analyses.forEach(a => {
      const box = synthEl("div");
      box.appendChild(synthEl("p", "synth-hint", a.hint));
      // Colonne d'action en queue de ligne : met en evidence dans le planning les
      // nœuds de CETTE ligne (le nom, lui, mene directement au nœud — cf. synthNodeLink).
      const cols = a.columns.concat([{ text: "", cls: "synth-goto-col" }]);
      const rows = a.rows.map(r => ({
        cells: r.cells.concat([{ node: synthFilterButton(r.filterText), cls: "synth-goto-col" }]),
      }));
      box.appendChild(synthTable(cols, rows));
      synthSection(an, a.title + " (" + a.rows.length + ")", box);
    });
  }

  pertSelectSynthTab(pertSynthTab);
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
// dialogId designe la fenetre a imprimer : elle recoit le marqueur .synth-printing,
// sur lequel les regles @media print s'appuient. Cibler une fenetre par son ID ne
// marche plus depuis qu'il y en a DEUX (synthese et suivi) : la regle
// `display: block !important` aurait force-affiche la fenetre fermee sur le papier.
// Pose (ou retire) les deux marqueurs dont depend @media print. Fonction a part, et
// exposee : c'est le SEUL endroit qui sait quelles classes portent l'impression, et
// les tests l'appellent au lieu de reposer les classes a la main — sans quoi ils
// derivent silencieusement le jour ou le marquage change (ce qui vient d'arriver).
function pertPrintMark(dialogId, on) {
  const d = document.getElementById(dialogId);
  if (!d) return null;
  document.body.classList.toggle("synthesis-printing", !!on);
  d.classList.toggle("synth-printing", !!on);
  return d;
}
window.pertPrintMark = pertPrintMark;

function pertPrintDialog(dialogId) {
  if (!pertPrintMark(dialogId, true)) return;
  const cleanup = () => {
    pertPrintMark(dialogId, false);
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}
window.pertPrintDialog = pertPrintDialog;

function pertPrintSynthesis() { pertPrintDialog("synthesis-dialog"); }
window.pertPrintSynthesis = pertPrintSynthesis;
