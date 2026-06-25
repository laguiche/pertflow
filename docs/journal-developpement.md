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
| **S3 — Données** | import Excel legacy (#8 🔴), persistance `.pert`, export PNG/PDF | reprise de l'existant |
| **S4 — Finitions** | menu contextuel, snap-to-grid, erreurs UI, icônes, bundle, guide | livraison |

> Note dépendance : 5 des 7 demandes utilisateurs s'appuient sur le moteur de
> calcul → faire **S2 d'abord** est le chemin le plus court vers la valeur visible,
> et rend l'import Excel immédiatement exploitable (les tâches importées se calculent).

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

## Écueils rencontrés
- **Perte du poste de développement** (disque HS) → reconstruction depuis Git + `CLAUDE.md`.
- (à compléter)
