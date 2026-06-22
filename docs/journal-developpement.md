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

### Réorientation (22/06/2026) — nouvelles priorités utilisateurs
Après usage et retours d'équipe, le plan initial (4 sessions linéaires) évolue.
Voir la section « Backlog réorienté » ci-dessous.

> **🎙️ Restitution — le pilotage par itérations.**
> Le plan initial en 4 sessions a tenu jusqu'au contact des utilisateurs réels.
> Les retours terrain (lisibilité du PERT, unités au long cours, reprise des
> plannings Excel existants) ont réordonné les priorités. C'est exactement le
> rôle d'un pilote d'ingénierie : l'IA accélère l'exécution, mais la
> hiérarchisation de la valeur reste une décision métier.

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
