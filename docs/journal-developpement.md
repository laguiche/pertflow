# Journal de développement — PertFlow

> Document vivant. Tenu pendant tout le développement pour servir de matière à la
> **restitution de septembre 2026** (forum interne entreprise : présentation +
> questions/réponses) sur le thème *« développement d'outils métier assisté par IA »*.
>
> Double lecture voulue :
> 1. **Chronologie technique** — étapes, écueils, décisions, particularités.
> 2. **Angle restitution IA** (encadrés « 🎙️ Restitution ») — ce que l'IA a apporté
>    au métier de **pilotage de l'ingénierie de projet**, et où elle a eu ses limites.

---

## Le projet en une phrase

Remplacer un outil PERT *legacy* basé sur Excel par **PertFlow**, une application web
100 % offline (fichier `index.html` standalone + libs locales MIT), pour créer,
calculer et visualiser des plannings PERT (chemin critique, dates au plus tôt/tard,
marges) dans le cadre du pilotage de projets d'ingénierie au long cours.

---

## Ligne du temps

### Session 0 — Mise en place (✅ terminée)
- Dépôt GitHub, structure (`lib/ src/ css/`), libs locales (LiteGraph.js, jsPDF), README, `.gitignore`.
- Commit `abc0c73`.

### Session 1 — Socle canvas + nœuds (✅ ~90 %)
- Canvas LiteGraph initialisé, 3 types de nœuds (Activité, Jalon losange, Label), rendu custom Canvas2D.
- Toolbar, dialog Paramètres, panneau propriétés dynamique, barre de statut.
- Au-delà de la spec initiale : **slots d'entrée dynamiques** (`84a91e8`), **resize auto** selon le contenu texte (`abb79a0`), panneau propriétés toujours visible (`773b593`).
- Commits : `2b450f2`, `84a91e8`, `773b593`, `abb79a0`.

> **🎙️ Restitution — écueil n°1 : la perte de données.**
> Le développement initial a été perdu (disque HS, pas de sauvegarde). La
> reconstruction du contexte s'est faite à partir du **code commité sur GitHub +
> le fichier `CLAUDE.md`** (spec exécutable). Enseignement métier : la
> documentation-comme-code (`CLAUDE.md`) et le versionnage régulier transforment
> une perte machine en simple incident — l'IA a pu re-dériver l'état complet du
> projet en quelques minutes à partir des seuls artefacts versionnés.

### Session 2 — Moteur de calcul PERT (✅ 22/06/2026)
- `src/pert_engine.js` : construction adjacence depuis `graph.links`, détection de
  cycle (DFS tricolore), tri topologique (Kahn), forward pass (ES/EF), backward
  pass (LS/LF), marges et chemin critique (`slack ≈ 0`).
- Conversion unités ⇄ dates calendaires (`pertOffsetToDate` / `pertDateToOffset`).
- Jalon : borne LF par la date-cible et lève `target_missed` si la cible n'est pas
  tenue (amorce #6).
- Recalcul automatique câblé sur `onNodeAdded` / `onNodeRemoved` /
  `onConnectionChange` + édition durée/date-cible/paramètres dans `ui.js`.
- Rendu : tâches et jalons affichent désormais les dates calculées ; rouge si
  critique ou marge négative ; barre de statut « Chemin critique : N nœuds · Fin projet ».
- **Validé** par test headless (bac à sable Node) : PERT diamant (chemin critique
  A-C-D, marge B=3), détection de cycle, jalon cible non tenue. Tous ✅.

> **🎙️ Restitution — valider la logique métier sans cliquer.**
> Le cœur du calcul PERT (la valeur métier réelle) a été vérifié *avant* tout test
> navigateur, en exécutant le moteur dans un bac à sable Node avec un PERT de
> référence dont je connais les chiffres à la main. Apport IA : écrire le moteur
> *et* son banc de test de référence en une passe, ce qui sécurise les calculs
> (dates au plus tôt/tard, marges, chemin critique) — les chiffres faux dans un
> outil de pilotage sont le risque n°1.

### Session 2.5 — Visualisation & lisibilité (✅ 24/06/2026, validation Chrome à faire)
Les 7 demandes utilisateurs de lisibilité, toutes traitées :
- **#1 Layout chronologique** : bouton « Réorganiser » → `pertAutoLayout`. Abscisse ∝
  date au plus tôt (ES), packing vertical par « couloirs » (lanes) pour éliminer les
  superpositions. Déclenchement **manuel** (choix assumé : ne pas déplacer les nœuds
  sous le curseur pendant l'édition).
- **#2 Largeur ∝ durée** + **#1** partagent une échelle commune `PERT_PX_PER_UNIT`
  (36 px/unité) : une chaîne de tâches se « carrèle » alors comme un diagramme de Gantt.
- **#4 Multi-lignes** : helper `wrapText` (retour à la ligne sur les espaces) ; libellé
  d'Activité et de Jalon passent en plusieurs lignes au lieu d'élargir la boîte sans fin.
- **#5 Refonte Jalon** : abandon du losange (trop exigu) → rectangle arrondi avec un coin
  « drapeau » qui marque le type Jalon, et un losange glyphe ◆ devant le libellé.
- **#6 Cible jalon** : `target_missed` (calculé en S2) déclenche désormais un rendu rouge.
- **#7 Chemin critique tracé** : `pertHighlightCriticalPath` remonte les prédécesseurs
  contraignants (dont l'EF cale le ES) depuis la cible et colore les liens en rouge.
  Cible = nœud sélectionné, sinon le plus éloigné de T0. Re-tracé à chaque sélection.
- Validé par test headless Node (layout sans superposition + liens A→C→D rouges sur
  PERT diamant), puis **validé en navigateur le 24/06/2026** après une passe de corrections.

**Ajustements après le premier test visuel (24/06/2026).** Une capture d'écran de
l'utilisateur a révélé plusieurs écarts, corrigés dans la foulée :
- **Libellé dupliqué** (bande de titre LiteGraph au-dessus de mon en-tête custom) : la
  cause était un piège LiteGraph — `flags.no_title` n'a **aucun effet** au rendu, le titre
  est piloté par `Constructor.title_mode`. Correction : `title_mode = LiteGraph.NO_TITLE`
  sur les trois types de nœuds. Le jalon d'origine (S1) souffrait du même bug, masqué jusque-là.
- **Largeur peu proportionnelle** : l'échelle (36 px/u.) était trop faible face au plancher
  de largeur ; passée à 60 px/u., plancher abaissé à 140 px. Compromis assumé : le plancher
  (place pour la ligne de date calculée) empêche les très courtes durées de rétrécir.
- **Retour à la ligne non rafraîchi pendant la frappe** : le champ Libellé ne rappelait pas
  `updateSize()`. Corrigé.
- **Jalons de sortie souhaités en haut** : le layout les regroupe désormais dans une bande haute.
- **Espacement horizontal entre tâches** (demande de confort) : ajouté via `rang × gap`, et
  rendu **paramétrable à chaud** (dialogue Paramètres, défaut 30 px) à la demande explicite de
  l'utilisateur — décision revisable après consultation de ses propres utilisateurs.

> **🎙️ Restitution — la capture d'écran comme protocole de recette.**
> La logique métier se valide hors navigateur, mais l'ergonomie se juge à l'œil. Un
> aller-retour « capture annotée → diagnostic → correctif » a suffi à converger. Côté IA :
> une annotation visuelle ambiguë (« le bloc est bizarre ») a été traduite en causes
> techniques précises (titre LiteGraph mal masqué, échelle, rafraîchissement) en lisant
> le code de la lib — un débogage que l'outil accélère nettement. Côté métier : la
> décision de rendre l'espacement *paramétrable* (plutôt que de le figer) anticipe une
> future consultation utilisateurs — on instrumente le doute au lieu de trancher trop tôt.

> **🎙️ Restitution — l'IA face au non-testable automatiquement.**
> Le calcul PERT se valide hors navigateur (bac à sable Node, cf. Session 2), mais le
> **rendu visuel** (formes, multi-lignes, couleurs de liens) ne se teste pas en headless
> sans outillage navigateur. La parade : isoler la *logique* (placement, choix des liens
> à colorer) en fonctions pures testables, et ne laisser au navigateur que le dessin.
> L'IA a permis d'extraire systématiquement cette logique testable — mais la validation
> finale d'ergonomie reste un coup d'œil humain. Limite honnête à présenter.

> **🎙️ Restitution — décider à la place de l'outil, pas l'inverse.**
> Deux choix de conception (déclenchement du layout : manuel vs automatique ; forme du
> jalon) ont été tranchés *par l'utilisateur* avant le code, l'IA présentant les options
> et leurs compromis (dont des maquettes ASCII de formes). Le layout automatique « magique »
> aurait cassé tout placement manuel : c'est un arbitrage métier, pas technique.

**Précision de contrainte (24/06/2026) — environnement de déploiement DSI.**
En préparant le test, une question simple (« pourquoi `npx serve`, pas juste ouvrir
`index.html` ? ») a révélé une contrainte de production jusque-là implicite : l'outil
tournera sur un **PC d'entreprise fortement verrouillé par la DSI**, où un serveur local
peut être indisponible ou interdit. Décision actée : **ouverture par double-clic `file://`,
sans serveur ni architecture client-serveur**, et donc **interdiction des modules ES6 et des
`fetch()`/XHR de fichiers locaux** (bloqués par CORS en `file://`). Conséquence concrète à
anticiper : l'**import Excel (Session 3)** devra passer par `<input type="file">` + `FileReader`,
jamais par `fetch`. Contrainte consignée dans `CLAUDE.md` (contraintes absolues) ; la note
`npx serve` y a été requalifiée en simple confort de dev, jamais requise en prod.

> **🎙️ Restitution — la contrainte de déploiement est une exigence, pas un détail.**
> La vraie contrainte n'est pas apparue dans la spec initiale mais dans une question
> d'usage. Sur un poste verrouillé, l'« architecture » la plus robuste est souvent la
> plus pauvre : un fichier HTML qu'on double-clique. L'IA tendait par réflexe à proposer
> un serveur local (`npx serve`) ; c'est le métier qui a recadré vers le strict minimum.
> Enseignement : expliciter tôt l'environnement cible (droits, réseau, installation)
> évite de construire une élégance technique inutilisable en production.

### Réorientation (22/06/2026) — nouvelles priorités utilisateurs
Après usage et retours d'équipe, le plan initial (4 sessions linéaires) évolue.
Voir la section « Backlog réorienté » ci-dessous.

> **🎙️ Restitution — le pilotage par itérations.**
> Le plan initial en 4 sessions a tenu jusqu'au contact des utilisateurs réels.
> Les retours terrain (lisibilité du PERT, unités au long cours, reprise des
> plannings Excel existants) ont réordonné les priorités. C'est exactement le
> rôle d'un pilote d'ingénierie : l'IA accélère l'exécution, mais la
> hiérarchisation de la valeur reste une décision métier.

### Session 3 — Données : import Excel legacy, persistance & export (✅ 25/06/2026)

**Évolutions UI préalables** (`fix/ui-tweaks`, mergé) : unité « mois » par défaut,
bouton « Tout afficher » (zoom-to-fit calé sur la boîte englobante, + désactivation du
cadre LiteGraph `render_canvas_border` qui se décalait après recadrage), et correction
d'un plafond visuel à 3 liens entrants sur les Jalons (la hauteur du nœud ne tenait pas
compte du nombre de slots → 4e slot hors boîte).

**Import Excel (#8, l'urgence).** Le PERT legacy est un `.xlsm` où **toute la donnée est
dans les objets graphiques** (groupes de formes = nœuds, connecteurs = liens), rien
d'utile dans les cellules — sauf l'onglet **MANUEL**, qui s'est révélé être la **feuille de
configuration** de l'outil (C-PERT 6.14.x) : `K2`=feuille PERT cible, `K5`=T0 (date série
Excel), `J10`=unité (1=mois). Décodage par reverse-engineering du XML DrawingML :
- groupe `<lettre><id>` → type (`A`=activité, `S`=jalon, `E`=nœud T0) ; sous-formes
  `.1`=libellé, `.2`=`durée/marge` (virgule FR), `.3`/`.4`=date ; jalon → date-cible
  encodée `E=(jj/mm/aaaa)` dans le libellé.
- connecteurs `stCxn`/`endCxn` référencent l'`id` d'une **sous-forme** → map
  `id sous-forme→groupe` pour résoudre les liens. Arêtes touchant `E` ignorées (le
  successeur démarre à T0).

`src/import_excel.js` en 2 couches : transforms **purs** (testables Node) + couche
**DOM/ZIP** navigateur. Contrainte `file://` respectée : dézip par **fflate** (MIT, lib
locale non-module), `<input file>` + `FileReader.readAsArrayBuffer`, parsing `DOMParser`,
**jamais** `fetch`. Import = **concaténation** dans le PERT existant (bloc posé à droite,
placement absolu hérité d'Excel conservé — l'utilisateur « Réorganise » s'il le souhaite).

**Validation croisée.** Couche pure : 25/25 en headless. Pipeline e2e sur le fichier réel
(unzip + DOM via shim xmldom) : 10/10. Puis **pilotage du vrai navigateur** (Playwright +
Chromium) : import auto → 6 nœuds, 4 liens, T0 `2025-07-01`, unité `mois`, zéro erreur
console, rendu conforme (capture). Validation humaine en parallèle.

> **🎙️ Restitution — l'IA face à un format propriétaire non documenté.**
> Reprendre des plannings Excel « legacy » paraissait être le point dur. En réalité,
> l'essentiel a été de **comprendre la structure** : l'IA a déplié le `.xlsm` (un ZIP),
> lu le XML DrawingML et reconstruit le modèle (nœuds, liens, dépendances) sans
> documentation. Le déclic métier : l'onglet « MANUEL », pris au départ pour de l'aide,
> était la table de configuration (T0, unité, feuille active) — c'est l'utilisateur qui
> a orienté vers cet onglet. L'IA décode vite un format opaque ; le métier sait *où
> regarder* et *ce que les nombres signifient* (le champ `durée/marge`, l'unité en mois).

> **🎙️ Restitution — validation croisée homme + machine.**
> La validation s'est faite à deux niveaux complémentaires : l'IA a piloté le navigateur
> réel (Playwright) pour un test reproductible et chiffré, *et* l'utilisateur a validé
> visuellement. Aucune des deux ne remplace l'autre : le test automatisé garantit la
> non-régression et l'absence d'erreur, le coup d'œil humain juge l'ergonomie et la
> fidélité au planning d'origine.

**Persistance `.pert` (`src/storage.js`).** Format `{ version, meta, graph }` où `graph`
est la sérialisation native LiteGraph (`graph.serialize()`). Les valeurs calculées
(ES/EF/LS/LF/slack) ne sont **pas** sauvegardées (hors de `node.properties`) : elles sont
recalculées par `pertRecalc()` après chargement, ce qui garantit la cohérence avec les
règles de calcul courantes même sur un vieux fichier. Au chargement, on `clear()` puis
`configure()`, on rejoue `updateSize()` sur chaque nœud (tailles dépendantes de l'unité et
des libellés), puis recalc + zoom-to-fit. Contrainte `file://` respectée : sauvegarde par
Blob + `<a download>`, chargement par `<input file>` + `FileReader.readAsText`, jamais `fetch`.

**Export PNG / PDF (`src/export.js`).** Rendu **hors-écran** indépendant du zoom courant :
calcul de la boîte englobante de tous les nœuds, création d'un canvas à cette taille, attache
d'un `LGraphCanvas` temporaire (`skip_events`/`skip_render`, fond blanc, overlay debug
désactivé) calé sur la boîte via `ds.scale`/`ds.offset`, un seul `draw(true,true)`, puis
`toDataURL`. Garde-fou de résolution (6000 px max) pour les très grands plannings. Le PDF
(jsPDF, lib locale) embarque ce PNG dans une page A4 (orientation selon le ratio, image
ajustée en conservant les proportions, titre du projet en en-tête).

**Copier/coller.** Réutilise le presse-papier interne de LiteGraph (`copyToClipboard` /
`pasteFromClipboard`, via `localStorage`) câblé sur Ctrl+C / Ctrl+V : il recrée les liens
internes à la sélection et colle à la dernière position connue de la souris. En passant,
correction d'un **bug latent** : le raccourci Ctrl+A appelait `selectAllNodes()`, méthode
inexistante — c'est `selectNodes()` (sans argument) qui sélectionne tout.

**Nœud Label opérationnel.** L'édition du texte rappelle désormais `updateSize()` (la boîte
s'élargit/s'allonge avec le contenu). Overlay debug LiteGraph (`T/I/N/V/FPS`) masqué aussi
dans le canvas principal (`show_info = false`), cohérent avec `render_canvas_border = false`.

**Validation croisée.** Smoke test Playwright/Chromium en `file://` sur `C_PERT_exemple.xlsm` :
import (6 nœuds, 4 liens) → sauvegarde `.pert` (relecture JSON : version/meta/graphe OK) →
`clear()` + rechargement (intégrité 6=6) → export PNG (signature PNG valide, 82 Ko) → export
PDF (en-tête `%PDF-` valide) → copier/coller (6→12) → Label `updateSize`. Zéro erreur console.
Rendu PNG inspecté visuellement (fond blanc, chemin critique rouge, nœuds custom). Critère de
validation S3 atteint.

### Session 4 — Finitions UX, puis intégration d'un 2e retour utilisateur (✅ terminée, 26–27/06/2026)

**Undo/Redo (26/06/2026).** Historique par **snapshots sérialisés** (`meta` +
`graph.serialize()`, restaurés par `configure()` — même mécanisme que la persistance
`.pert`), donc robuste et exhaustif sans tracer chaque mutation. Pile bornée à 60 entrées,
**coalescence** des frappes clavier (un seul cran d'undo par saisie, pas un par caractère),
baseline réinitialisée au démarrage **et** après chargement `.pert`. Pur JS, `<script src>`,
zéro dépendance (contrainte `file://`). Récupéré après un crash PC en plein travail (le code
non commité — `src/history.js` + câblage — était intact). Validé en navigateur réel.

**Finitions UX & packaging (27/06/2026).** Bouclage des cinq dernières tâches de la session :
- **Menus contextuels recentrés PERT.** Les menus natifs LiteGraph (anglais, pleins
  d'options sans objet ici : Inputs/Outputs/Mode/Pin/Shapes…) sont **remplacés** en
  surchargeant `getMenuOptions` (fond) et `getNodeMenuOptions` (nœud) — pas en *ajoutant*
  via `getExtraMenuOptions`. Menu de fond = ajouter Activité/Jalon/Label **à l'endroit
  cliqué** (position mémorisée en interceptant `processContextMenu`), Réorganiser, Tout
  afficher ; menu de nœud = Dupliquer / Supprimer. La barre de recherche parasite au
  double-clic (#28) est neutralisée (`allow_searchbox = false`).
- **Snap-to-grid en option.** Toggle toolbar : alignement natif au déplacement
  (`align_to_grid`) + grille dessinée à la main dans `onDrawBackground` **seulement quand
  l'option est active** (et masquée au zoom arrière où elle deviendrait illisible).
- **Gestion d'erreurs UI.** Toast rouge (`showError`), enrobage `guardUI` des actions
  risquées (sauvegarde / ouverture / export / import) et filet global
  (`window.error` / `unhandledrejection`) — crucial en `file://`, où l'utilisateur métier
  n'a pas de console pour voir une exception silencieuse.
- **Icônes toolbar** homogènes (glyphes Unicode, techno actuelle conservée).
- **Bundle standalone** : `scripts/build-bundle.js` (Node natif, zéro dépendance) inline
  CSS + libs + sources dans un unique `dist/pertflow.html` ouvrable par double-clic, avec
  un garde-fou qui échoue s'il subsiste une référence externe. `dist/` est gitignoré
  (artefact de livraison) ; la structure de travail (`index.html` + `src/` + `lib/`) reste
  le format de développement.

> **🎙️ Restitution — « finir » un outil métier, c'est retirer les aspérités de la lib
> sous-jacente.** Aucune de ces cinq tâches n'ajoute de fonction PERT ; toutes rendent
> l'outil *présentable* à un utilisateur non technique. Le fil conducteur des contraintes
> `file://`/DSI se retrouve jusque dans les finitions : pas de console pour l'utilisateur →
> on rend les erreurs visibles ; pas de serveur ni de build toléré → le bundle est un simple
> script Node qui produit un HTML autoportant. Le menu contextuel illustre un piège récurrent
> du dev assisté : une librairie tierce (LiteGraph) impose ses défauts (menu anglais, barre de
> recherche) qu'il faut *surcharger* au bon point d'extension, pas contourner.

**2e retour utilisateur structuré (27/06/2026).** L'utilisateur métier (« Mickael ») a
transmis **32 remarques**, qu'il avait lui-même **pré-classées en catégories** (à
approfondir / améliorations / bugs / nice-to-have / appli « pro » / écarté / déjà prévu).
Le travail a consisté à transformer ce retour en plan d'action versionné :
- **Re-tri en buckets actionnables** et recoupement avec l'existant : séparer ce qui est
  **déjà fait** (#6 CTRL+Z, livré en S4), **déjà prévu** (#27/#45 menu contextuel, #46
  grille, #28 barre de recherche) et **réellement nouveau**.
- **Détection d'un thème transversal** : 5 remarques distinctes (#2, #3, #4, #14, #16) ne
  sont en fait **qu'une seule fonctionnalité de fond** — une dimension « groupe »
  (WP/métier/service) au-delà du responsable, déclinée ensuite en couleur, filtre et
  agrégation de coût. Le signal le plus fort du retour, promu en chantier dédié.
- **Repérage d'une brique de fondation sous-estimée** : #34 (identifiant unique par
  activité), rangé en « nice to have » par l'utilisateur, débloque en réalité le
  micro-jalonnement et les exports → remonté en priorité, placé en tête du chantier métier.
- **Garde-fou de contrainte** : #7 (choisir la destination des exports) se heurte à
  `file://` (le navigateur pilote le dossier de téléchargement) → à expliquer plutôt qu'à
  promettre.
- **Intégration dans la roadmap (`CLAUDE.md`)** plutôt qu'au fil de l'eau : 6 sessions
  ajoutées (S5 correctifs & quick wins, S6/S7 regroupement métier en 2 temps, S8 propriétés
  & jalons enrichis, S9 exports avancés, S10 liens & layout), **documentation déplacée en
  toute fin** de parcours, et bloc « Long terme / écarté » (#38 sous-PERT, #41). Chaque
  objectif S5+ porte le `#NN` renvoyant à la ligne du retour brut.
- **Archivage du retour brut** dans un répertoire dédié `retours-utilisateurs/` (avec un
  README) pour la traçabilité. Commité et mergé sur `main`.

> **🎙️ Restitution — l'IA comme outil de triage et de hiérarchisation d'un retour terrain.**
> Un retour utilisateur, c'est rarement une liste de tâches : ce sont 32 remarques de
> granularité et de maturité inégales, où le même besoin réapparaît sous cinq formulations.
> L'apport IA ici n'est pas d'« écrire du code » mais de **structurer la matière** : regrouper
> les doublons cachés (les 5 remarques = un seul chantier WP), distinguer le déjà-fait du
> déjà-prévu du nouveau (éviter de re-spécifier), et requalifier la valeur réelle d'un item
> que l'utilisateur sous-estimait (l'identifiant unique, fondation discrète de plusieurs
> features). Mais la **hiérarchisation finale est restée une décision métier** : trois
> arbitrages explicites de l'utilisateur (correctifs avant le chantier de fond ; découper le
> chantier WP en deux temps ; documenter en dernier) ont fixé l'ordre. L'IA propose un plan
> argumenté et chiffré ; le pilote tranche la priorité. C'est la division du travail visée.

> **🎙️ Restitution — la documentation-comme-code transforme un retour en roadmap exécutable.**
> Le retour n'a pas atterri dans un ticket ou un mail vite oublié : il a été **dépouillé,
> catégorisé et réparti dans `CLAUDE.md`** (la spec exécutable du projet), avec un lien `#NN`
> vers le retour brut archivé. Conséquence concrète : la prochaine session de dev (ou un
> repreneur) trouve l'intention, l'arbitrage et la trace d'origine au même endroit que le
> reste de la conception. Le même réflexe qui a sauvé le projet après la perte du poste (cf.
> Session 1) sert ici à ne perdre aucune exigence utilisateur entre deux sessions.

---

### Session 5 — Correctifs & quick wins du retour Mickael (✅ 27/06/2026)

Sept remarques du retour utilisateur traitées en un lot (les « petits efforts à forte
satisfaction », priorisés par l'utilisateur avant le chantier métier) :

- **#26 — dernier lien du chemin critique non rouge à la sélection.** Le tracé partait de
  la cible (nœud sélectionné) et **remontait** vers T0 ; il s'arrêtait donc au nœud
  sélectionné, laissant gris les liens en aval. Ajout d'une **descente symétrique** vers le
  nœud terminal. Le diagnostic a été affiné par l'utilisateur lui-même (« le bug n'apparaît
  que quand un nœud est sélectionné ; au clic sur le fond, le chemin complet est rouge ») —
  ce qui a pointé directement la dissymétrie remontée/descente.
- **#25 — mélange français/anglais.** Les menus contextuels étaient déjà francisés (S4) ;
  restaient deux panneaux **natifs LiteGraph** en anglais, atteignables autrement : le
  panneau de propriétés au double-clic sur un nœud et le menu au clic droit sur un lien.
  Neutralisés / remplacés par du français.
- **#29 — PDF lourd.** Un PDF de 1,5 Mo pour un PNG de 80 Ko : jsPDF stockait l'image **non
  compressée**. `compress:true` (deflate, sans perte) → poids ÷10. Le rendu hors-écran passe
  en 2× pour la netteté. Améliore définition **et** poids, sans compromis.
- **#8 — affichage du responsable.** Problème précisé par l'utilisateur : même police/taille
  que « Fin t.tôt » et collé à elle → les deux infos se confondaient. Déplacé dans l'en-tête
  coloré (texte blanc + 👤), tronqué si trop long. Choix de placement validé par l'utilisateur.
- **#20 — coin de Jalon vert.** Symétrique du rouge « cible non tenue ». Décision utilisateur :
  3 états avec seuil (vert si marge ≥ 1 unité, orange si juste tenue, rouge si ratée). Subtilité
  retenue : la marge mesurée est celle **vis-à-vis de la cible** (et non le slack). La validation
  utilisateur a corrigé une erreur de conception : la couleur du jalon **ne doit PAS dépendre du
  chemin critique** (un jalon terminal largement en avance sur sa cible doit être vert, même s'il
  est critique) — `is_critical` a donc été retiré de `targetState`.
- **#15 — Label superposé après réorganisation.** Les Labels n'ont pas de date au plus tôt →
  non placés par le layout. On reloge ceux qui chevauchent un nœud dans une bande sous le graphe.
- **Bug largeur ∝ durée plafonnée (hors liste, trouvé en clôture).** L'utilisateur a remarqué
  qu'une activité de 30 mois faisait la même taille qu'une de 15 mois. Cause : le plafond de
  largeur `ACT_MAX_W=480` saturait dès 8 unités (480 ÷ 60 px/u.), annulant la proportionnalité
  (#2) au-delà. Plafond porté à 3000 px (garde-fou). Effet de bord positif : la barre couvre
  désormais son empan temporel (le layout place le successeur à `es × 60`), d'où une cohérence
  Gantt — les barres se touchent au lieu de laisser un grand vide.
- **Bug barre d'état (hors liste, trouvé en clôture).** La barre indiquait « Chemin critique :
  0 nœud(s) » en permanence. Cause : `is_critical` testait `slack == 0` strict ; or une cible de
  jalon non tenue borne LF à la cible et fait passer tout le chemin contraignant en marge
  négative → aucun nœud à 0 → compteur à 0. Corrigé en redéfinissant le chemin critique par la
  **marge minimale** (définition PERT standard) : inchangé en projet faisable (min = 0), et le
  chemin contraignant reste identifié même quand une échéance imposée est intenable.

> **🎙️ Restitution — l'utilisateur affine le diagnostic, l'IA exécute la correction.** Sur
> #26, c'est la précision de l'utilisateur (« seulement quand un nœud est sélectionné ») qui a
> transformé un symptôme flou en cause localisée : la fonction de tracé était asymétrique
> (remontée sans descente). Sur #8, de même, l'utilisateur n'a pas demandé « mets-le ailleurs »
> mais a décrit *pourquoi* c'était illisible (typographie identique, proximité) — ce qui rend
> la bonne correction évidente. La boucle efficace n'est pas « l'IA devine », mais « l'utilisateur
> qualifie le besoin, l'IA propose des options chiffrées/illustrées, l'utilisateur tranche ».
> Deux arbitrages purement visuels (#8 placement, #20 seuil) ont été soumis avec maquettes ASCII
> avant toute ligne de code.

---

### Session 6 — Regroupement métier (WP/service), temps 1 (✅ 27/06/2026)

Premier temps du chantier métier majeur du retour Mickael : donner aux activités une
**dimension de regroupement** (work package / métier / service) et la rendre lisible
**de loin** par la couleur. Découpé en 2 temps sur arbitrage utilisateur — S6 pose le
modèle de données et la restitution visuelle, S7 ajoutera le filtre et le coût.

- **#34 — identifiant unique d'activité.** Brique de fondation pour les futurs exports
  (Excel/Gantt) et le micro-jalonnement. **Précision utilisateur en ouverture de session :
  pour l'instant l'uid doit être *automatique*, ni visible ni éditable** — à rebours de la
  spec initiale (« champ affiché et éditable »). Implémenté comme propriété cachée générée
  à la création, stable à la sauvegarde. Subtilité : `clone()` et le copier/coller LiteGraph
  recopient les propriétés (donc l'uid) → un dé-doublonnage (`pertEnsureUids`) régénère les
  doublons après duplication/collage/chargement.
- **#2 — dimension « groupe ».** L'utilisateur a tranché le modèle : « ce n'est pas
  tellement différent du responsable, ce devrait être le même type de champ ». D'où un
  **combobox enrichissable** (texte libre + liste des valeurs déjà saisies, reproposées
  sans ressaisie) — et non une liste gérée par dialogue. Le même mécanisme a été appliqué
  au **Responsable** au passage (amorce de #13, prévu S8).
- **#14 / #4 — couleur de groupe et harmonisation.** Articulation couleur ↔ groupe choisie
  par l'utilisateur : **« premier venu fixe la teinte »** — la première activité d'un groupe
  enregistre sa couleur comme couleur du groupe, les suivantes en héritent. Un seul système
  de couleur (le rendu lit toujours `node.properties.color`) ; un registre `pertMeta.groups`
  ne sert qu'à mémoriser (persisté dans le `.pert`) et à propager. Le point « propagation au
  changement » (laissé ouvert à la décision) a été tranché côté implémentation : changer la
  couleur d'un membre recolore tout le groupe, sinon l'harmonisation #4 se déliterait.
- **Propagation du groupe par couleur (ajout en cours de session).** Après validation de la
  propagation *couleur*, l'utilisateur a demandé la réciproque : « quand on saisit un groupe,
  toutes les tâches de même couleur pourraient porter ce groupe ? ». Très utile pour les lots
  importés (une couleur = un lot → on tague tout d'un clic). Le piège soulevé en réponse : le
  **bleu par défaut** des nouvelles tâches rendrait une propagation automatique dangereuse
  (taggage de masse involontaire). L'utilisateur a tranché pour un **bouton explicite**
  « Appliquer ce groupe aux tâches de même couleur » plutôt qu'un automatisme — convenance sans
  surprise, et de toute façon annulable (Ctrl+Z).

> **🎙️ Restitution — l'utilisateur choisit le bon *modèle*, pas seulement la couleur du bouton.**
> Les deux décisions soumises en début de session étaient structurantes (modèle de saisie du
> groupe ; couplage couleur/groupe) et ont été présentées avec maquettes et options chiffrées.
> La réponse de l'utilisateur sur le premier point — « c'est le même besoin que le responsable »
> — a non seulement réglé la question du groupe mais **généralisé** la solution (un helper
> combobox réutilisable, qui resservira pour #13). C'est l'inverse du sur-engineering : une
> exigence reformulée par le métier simplifie l'architecture au lieu de la complexifier. La
> précision sur #34 (« automatique, pas éditable ») illustre l'autre versant : livrer la
> *brique* (l'identifiant stable) sans la *surface* (un champ d'UI) tant qu'elle n'a pas d'usage.

---

### Session 7 — Le couple couleur/groupe au cœur des fonctions de base (✅ 28/06/2026)

Deuxième temps du chantier métier. **Redéfinie en ouverture de session** (28/06) : plutôt
que d'enchaîner directement sur le filtre, l'utilisateur a demandé que les **fonctions déjà
acquises** (import, réorganisation) **exploitent d'abord** le concept couleur/groupe posé en
S6. La séance livre donc, dans l'ordre : un socle (A+B) puis le filtre (C). **#3 (estimation
de coût) a été retiré** du périmètre — « pas indispensable pour un outil PERT KISS » → long terme.

- **A — Import Excel conscient du groupe.** Le dialogue d'import, jusqu'ici un simple choix de
  couleur, devient **centré groupe** : un combobox enrichissable (datalist des groupes connus)
  pilote trois chemins. *Groupe existant* → la couleur est **héritée du registre et verrouillée**
  (sélecteur grisé) ; *nouveau groupe* → la couleur choisie **devient** celle du groupe
  (« premier venu », cohérent avec S6) ; *champ vide* → couleur libre, tâches **sans groupe**
  (comportement historique intact). Le rattachement réutilise `pertApplyGroup` (aucun 2e système
  de couleur). La cohérence avec S6 a permis de **ne rien réécrire** côté modèle : l'import ne
  fait que *poser* groupe + couleur, l'héritage/premier-venu prend le relais.
- **B — Réorganisation cohésive (couloirs groupés).** L'arbitrage utilisateur du 28/06 est précis :
  l'**abscisse ∝ ES reste inchangée** (le calage temporel façon Gantt est intouchable), seule
  l'**affectation des couloirs verticaux** devient consciente du groupe. Implémenté par un packing
  qui partitionne par groupe et empile une **bande verticale contiguë par groupe** (triées par ES
  minimal, sans-groupe en dernier). Quand aucun groupe n'est utilisé, tout retombe dans une bande
  unique → comportement **strictement identique** à l'ancien layout (non-régression garantie par
  construction). Pas de bandes *horizontales* par groupe : le temps prime, le groupe ne joue que
  sur Y.
- **C — #16 Filtrer / mettre en évidence.** Arrivé **après** A+B (qui l'ont rendu pertinent).
  Un menu déroulant dans la toolbar liste les groupes **et** les couleurs présentes ; sélectionner
  une entrée **estompe** (voile translucide) tous les nœuds qui n'y correspondent pas, concentrant
  l'œil sur l'ensemble visé. Choix « mise en évidence par estompage » plutôt que masquage : la
  structure (liens, jalons) reste lisible. Le filtre est un **état de vue**, non sérialisé.
- **C (correctif 29/06, retour utilisateur).** Première version avec un `<select>` natif dont les
  options affichaient le **code hexa** des couleurs (« ne parle à personne ») ; on a d'abord tenté
  de peindre les `<option>` à leur couleur — mais **Firefox** (navigateur par défaut de l'utilisateur)
  **n'affiche pas la couleur de fond des `<option>`**. Décision du concepteur : passer à un **menu
  déroulant custom** (DOM/CSS pur, sans dépendance, `file://`). Chaque ligne porte une **vraie
  pastille de couleur** + un libellé parlant (le groupe associé, ou « Sans groupe » pour un lot
  importé non rattaché) ; le déclencheur reflète la sélection courante. Rendu désormais **identique
  sur tous les navigateurs**.

> **🎙️ Restitution — connaître l'environnement réel d'usage prime sur le « standard ».**
> Le `<select>` natif est la solution canonique, accessible et sans code — mais une limitation
> concrète (Firefox n'applique pas la couleur de fond aux `<option>`) la rendait inopérante *pour
> cet utilisateur précis, sur son navigateur*. L'outil étant d'abord le sien, son arbitrage (« menu
> custom, c'est obligatoire ») a tranché net : on ne livre pas un compromis dégradé sur la cible
> réelle au nom d'une bonne pratique générique. Le surcoût (une centaine de lignes JS/CSS) est
> assumé et reste dans les clous (`file://`, zéro dépendance).

> **🎙️ Restitution — « faire d'abord exploiter l'acquis avant d'empiler du neuf ».**
> La redéfinition de S7 par l'utilisateur est un enseignement de méthode : une donnée nouvelle
> (le groupe, posé en S6) ne prend sa valeur que si les fonctions *existantes* la reconnaissent.
> Brancher le groupe sur l'import et la réorganisation **avant** de construire le filtre a évité
> de livrer une fonctionnalité isolée et a fait converger trois remarques (#2/#4/#16) vers une
> seule dimension cohérente. Le retrait de #3 (coût) au même moment relève du même principe KISS :
> on n'ajoute pas un axe (le coût) tant que l'axe en cours (couleur/groupe) n'irrigue pas tout
> l'outil. Côté technique, la non-régression du layout « par construction » (bande unique quand
> pas de groupe) illustre une bonne pratique : faire du *nouveau comportement* une **généralisation**
> de l'ancien, pas une branche parallèle.

### Correctifs pré-Session 8 — Jalons entrants & mois calendaires (29/06/2026)

Deux bugs de fond signalés par l'utilisateur avant d'ouvrir la S8, sur la branche
`fix/jalons-entrants-mois-calendaires`.

- **Jalons entrants.** Un planning réel comporte des contraintes externes (livraison
  d'un prototype, jalon client/fournisseur) : une tâche qui en dépend ne doit pas
  démarrer à T0 mais à la date de la contrainte. La fonctionnalité manquait, et l'import
  legacy *perdait* ces jalons (nœuds `E` « Jalon entrée » ignorés, arêtes supprimées).
  Solution proposée par l'utilisateur et retenue : **réutiliser le Jalon existant** avec
  une règle topologique — *aucun lien entrant + un lien sortant + date-cible → le jalon
  démarre à sa date*. Élégant car aucun nouveau type de nœud, et la topologie distingue
  proprement les trois usages du Jalon (entrant / checkpoint intermédiaire / terminal).
  Côté import, les nœuds `E` sont désormais matérialisés en Jalons (date-cible = leur
  date) avec arêtes conservées ; la règle du moteur fait le reste.

- **Mois calendaires réels.** L'unité « mois » convertissait via un facteur fixe de 30
  jours → dérive de ~6 jours/an, problématique sur des projets s'étalant sur plusieurs
  années. Correctif : conversion unité↔date refondue en **mois calendaires** (`Date.setMonth`,
  longueurs de mois et bissextiles gérées). Diagnostic clé : le moteur travaille en
  *unités abstraites* et ne convertit jamais en interne — le bug était entièrement
  localisé à la frontière d'affichage (2 fonctions). Les jours et semaines (7 j exacts)
  n'étaient pas concernés : seul le mois dérivait.

> **Apport méthode/IA.** L'IA a d'abord *instruit la décision* : lecture du moteur pour
> confirmer que la règle jalon entrant tenait en ~6 lignes et que le bug mois était
> circonscrit à 2 fonctions, inspection du `.xlsm` d'exemple pour identifier le nœud
> `E1020` « Jalon entrée » et son traitement actuel. Deux points de conception ont été
> remontés à l'utilisateur avant d'écrire le code (matérialisation des `E` à T0 ;
> plancher à T0 pour une cible antérieure). Validation par test headless pur (28
> assertions) couvrant les cas limites — un filet utile vu qu'aucun navigateur n'était
> disponible en environnement de dev. Enseignement transverse : *un correctif bien
> diagnostiqué est petit* — le travail de compréhension en amont a transformé deux « bugs
> majeurs » en changements chirurgicaux à faible risque.

---

### Session 8 — Propriétés & jalons enrichis (✅ 30/06/2026)

Quatre demandes du retour Mickael portant sur la richesse des propriétés et la lisibilité
des jalons, sur la branche `session/8-proprietes-jalons`.

- **#12 — Note libre sur l'Activité.** Une zone de texte (hypothèses de durée, contenu réel
  de la tâche) dans le panneau propriétés. Décision utilisateur : **panneau uniquement**,
  jamais affichée sur le nœud — une note peut être longue et n'a pas à encombrer le graphe.
- **#13 — Responsables proposés à la saisie.** Déjà livré en Session 6 (le champ Responsable
  est un combobox enrichissable alimenté par les valeurs déjà saisies). La S8 n'a fait que le
  confirmer et le couvrir par un test ; rien à reconstruire.
- **#17 — Type de jalon (DOTD / COTD / Ingénierie).** Tag d'importance contractuelle affiché
  en **pastille colorée + texte** sous le libellé (choix utilisateur parmi trois maquettes).
  Point de conception clé : la couleur du tag est **indépendante** du code couleur de tenue
  de cible (rouge/vert/orange déjà porté par le corps, la bordure et le coin du jalon) — deux
  informations distinctes ne doivent pas se disputer le même canal visuel.
- **#18 — Largeur proportionnelle optionnelle.** La largeur ∝ durée (introduite en S2.5) est
  utile mais peut gêner ; on la rend désactivable par une **case à cocher dans Paramètres**
  (préférence projet sérialisée). Désactivée, toutes les tâches prennent une largeur uniforme.
  Le placement chronologique du layout (abscisse ∝ date au plus tôt) reste, lui, inchangé.

> **Apport méthode/IA.** Trois choix de présentation visibles (#17, #18, #12) ont été soumis
> à l'utilisateur *avant* d'écrire la moindre ligne, maquettes ASCII à l'appui — l'arbitrage
> en amont évite les allers-retours sur le rendu. La lecture préalable du code a aussi
> raccourci le périmètre réel : #13 était déjà fait depuis S6, transformant « 4 features » en
> 3. Implémentation guidée par les conventions maison (registre unique `PERT_MILESTONE_TAGS`
> comme source des options du menu et du rendu ; défauts robustes aux anciens `.pert` ;
> `prop_width` propagé dans persistance + undo). Validation par test headless (`smoke-s8.js`)
> et captures de contrôle, faute de navigateur interactif en environnement de dev.

---

### Session 8.5 — Estimation des coûts (✅ 30/06/2026)

Session **intercalée avant la S9** (comme S2.5 l'avait été) : l'utilisateur revient sur #3
(estimation de coût), qu'il avait lui-même retiré le 28/06 (« pas indispensable pour un outil
PERT KISS »). Le besoin s'est confirmé — preuve qu'une fonctionnalité « écartée » n'est pas
« enterrée » : la roadmap reste pilotée par l'usage réel.

- **Deux infos de coût par tâche.** Un **ETP** (Équivalent Temps Plein) saisi, et une
  **estimation financière** qui en découle (non modifiable). Formule : `coût = durée_en_heures
  × ETP × taux horaire`, la conversion durée→heures dépendant de l'unité (jour ×h/jour,
  semaine ×5×h/jour, mois ×h/mois).
- **Paramètres de chiffrage** dans Paramètres : heures/mois, heures/jour, taux horaire moyen
  (défauts entreprise : 135 h/mois, 8 h/jour, 136 €/h).
- **Agrégats en barre d'état** : coût total du projet (limité aux tâches **visibles** quand un
  filtre est actif) et coût du **chemin critique** courant.

> **Décision de cadrage (utilisateur).** Le point structurant n'est pas technique mais
> *philosophique* : **ne pas surcharger l'affichage graphique**. L'ETP et le coût restent dans
> le panneau latéral et la barre d'état, jamais sur les nœuds — « cohérent d'un PERT qui de base
> n'est pas un outil de chiffrage ». Cet arbitrage a été tranché par l'utilisateur en cours
> d'échange (après une proposition de l'IA d'afficher les valeurs sur le nœud), et il oriente
> toute l'implémentation : le coût est une *lecture* annexe, pas une dimension première du
> diagramme. **Apport méthode/IA** : questions ciblées sur les valeurs métier (taux horaire,
> heures/mois — données d'entreprise non devinables) plutôt que de présumer des défauts ;
> réutilisation du `setInterval(updateStatus)` existant pour rendre les agrégats *live* sans
> recâbler chaque événement ; coût dérivé (jamais stocké) pour rester cohérent avec les
> paramètres. Validé par `smoke-s85.js` (formule par unité, total filtré, chemin critique,
> round-trip) + captures.

**Correction sur retour utilisateur (même jour).** À la validation, l'utilisateur a repéré
que le coût du « chemin critique » de la barre d'état ne correspondait pas au chemin tracé en
rouge : deux notions cohabitaient (le drapeau global `is_critical` pour la barre d'état, le
tracé rouge suivant la tâche sélectionnée). Diagnostic et correctif : faire dériver la barre
d'état du chemin **réellement mis en évidence** (sélection, ou marge minimale par défaut — sur
demande explicite de l'utilisateur), de sorte que coût et tracé soient toujours cohérents. Au
passage, le comptage du chemin critique (et du projet) ne retient plus que les **tâches** : les
jalons sont des contraintes/sorties de chemin, sur lesquelles on n'agit pas. *Leçon* : une
fonctionnalité « finie » selon les tests headless peut révéler une incohérence d'ergonomie à
l'usage réel — la boucle de validation visuelle utilisateur reste indispensable.

---

## Backlog réorienté (à partir du 22/06/2026)

### A. Demandes utilisateurs (lisibilité & ergonomie du PERT)
1. **Ré-arrangement chronologique automatique** des tâches/jalons (layout selon les
   dates au plus tôt), **sans superposition** des éléments graphiques.
2. **Largeur des tâches proportionnelle à la durée** (sens visuel immédiat).
3. **Unités au long cours** : semaines / mois (les projets sont longs).
4. **Intitulé multi-lignes** quand le texte ne tient pas dans la boîte.
5. **Repenser la forme du Jalon** : le losange devient exigu pour quelques mots →
   trouver une autre distinction visuelle tâche/jalon, plus généreuse pour le texte.
6. **Jalon avec date-cible « à tenir »** en plus des dates calculées ; **mise en
   exergue rouge** si le PERT ne tient pas la cible.
7. **Chemin critique visuellement identifiable** (tracé rouge), calculé depuis la
   **tâche sélectionnée** ou, par défaut, **la plus éloignée de T0**.

### B. Import du legacy Excel (🔴 URGENT — avant la Session 4, fusionné avec 2/3)
8. Récupérer les plannings déjà faits dans l'outil Excel et les **concaténer** dans
   PertFlow (import via format prédéfini *ou* lecture directe du `.xlsx` — à décider).

### C. Méta — restitution de septembre 2026
9. Tenir ce journal (étapes / écueils / particularités), axé **usage de l'IA et son
   apport au métier de pilotage de l'ingénierie de projet**. Format md, pas de slides.

---

## Roadmap proposée (révisée)

| Phase | Contenu | Débloque |
|-------|---------|----------|
| **S1 reste** | Undo/Redo, copier/coller, suppression explicite ; validation réseau 5 nœuds | clôture S1 |
| **S2 — Moteur PERT** | forward/backward pass, marges, chemin critique, détection cycles, recalcul auto | features #1, #6, #7 (toutes dépendent du calcul) |
| **S2.5 — Visualisation** | layout chronologique (#1), largeur ∝ durée (#2), unités sem/mois (#3), multi-lignes (#4), refonte Jalon (#5) | lisibilité |
| **S3 — Données** ✅ | import Excel legacy (#8 🔴), persistance `.pert`, export PNG/PDF, copier-coller | reprise de l'existant |
| **S4 — Finitions** | undo/redo, menu contextuel, snap-to-grid, erreurs UI, icônes, bundle standalone | livraison |
| **S5 — Documentation** | manuel utilisateur + doc de conception/maintenance (captures via `tools/`) | reprise par un tiers |

> Note dépendance : 5 des 7 demandes utilisateurs s'appuient sur le moteur de
> calcul → faire **S2 d'abord** est le chemin le plus court vers la valeur visible,
> et rend l'import Excel immédiatement exploitable (les tâches importées se calculent).

> **Mise à jour 27/06/2026** : ce tableau reflète la réorientation du 22/06. Suite au 2e
> retour utilisateur (cf. Session 4 ci-dessus), la roadmap a été **étendue** — S4 reste
> les finitions, puis **S5** (correctifs & quick wins), **S6/S7** (regroupement métier WP
> en 2 temps), **S8** (propriétés & jalons enrichis), **S9** (exports avancés), **S10**
> (liens & layout), et la **Documentation déplacée en toute fin**. La roadmap détaillée et
> à jour fait foi dans `CLAUDE.md` (section « ÉTAT D'AVANCEMENT PAR SESSION »).

---

## Décisions techniques notables
- **Calcul interne en unités, affichage en dates.** ES/EF/LS/LF/slack sont des
  décalages en unités depuis T0 ; la conversion en date calendaire est faite à
  l'affichage. Découple le calcul de la présentation.
- **Conversion date à facteur fixe** (j=1, sem=7, mois=30 jours). Garantit que
  `offset→date` et `date→offset` sont exactement inverses (indispensable pour
  comparer une date-cible calendaire à une valeur calculée). Les mois sont donc
  approximés à 30 jours — acceptable en prévisionnel, raffinable plus tard.
- **Fin de projet = nœud le plus éloigné de T0 (max EF)** : sert d'ancrage au
  backward pass et de cible par défaut du chemin critique (cohérent avec #7).
- **Marge négative** = délai/cible infaisable en aval → affichée en rouge comme un
  signal d'alerte (distinct de la marge nulle = critique).
- **Couleur par import (25/06/2026, évolution inter-sessions).** Demande utilisateur :
  distinguer d'un coup d'œil les lots issus de plusieurs imports Excel. Choix : une
  **couleur unique par import** (et non par nœud, jugé fastidieux sur gros imports),
  sélectionnée dans un dialogue dont la valeur **présélectionnée est la première teinte
  d'une palette non encore présente dans le workspace**. L'IA a servi à cadrer le
  périmètre (questions ciblées avant code) puis à livrer + valider en navigateur réel
  (Playwright : présélection qui évite le bleu déjà pris au 2e import, couleurs bien
  appliquées aux Activités). Apport métier : itération « idée → feature validée » en une
  passe, sans casser le flux d'import existant ni les contraintes `file://`.

## Écueils rencontrés
- **Perte du poste de développement** (disque HS) → reconstruction depuis Git + `CLAUDE.md`.
- **Gros plannings tronqués à l'écran (25/06/2026).** Sur `essai_max.pert` (146 nœuds,
  boîte englobante ~387 × 19 826 px), « Tout afficher » ne montre qu'une moitié des nœuds.
  Diagnostic IA : double plancher de zoom à 0.1 (`pertZoomToFit` **et** `min_scale` de
  LiteGraph) alors qu'il faudrait ~0.04 pour tout cadrer. Non bloquant (exports PNG/PDF et
  navigation restent complets) → laissé tel quel sur décision utilisateur ; piste connue si
  besoin : abaisser les deux planchers de zoom.
