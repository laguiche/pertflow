# CLAUDE.md — PertFlow
Outil de planification PERT, prototype web (Phase 1).
Développement incrémental par sessions (réorienté le 22/06/2026 — voir « Réorientation »
dans la section avancement). Ce fichier est mis à jour à la fin de chaque session.

---

## CONTEXTE PROJET

### Objectif
Application web locale (fichier HTML standalone) permettant de créer et gérer des plannings PERT :
- Nœuds Activité et Jalon reliés par des connexions orientées
- Calcul automatique chemin critique, dates au plus tôt/tard, marges
- Sauvegarde JSON, export PNG/PDF
- 100% offline, sans serveur, sans licence propriétaire

### Contraintes absolues
- **Zéro dépendance réseau au runtime** : toutes les libs sont en local (pas de CDN)
- **Fichier unique** : `index.html` + libs dans un dossier `lib/`
- **Navigateur cible** : Chrome/Edge récents (pas de support IE)
- **Licence** : MIT uniquement
- **Ouverture en `file://` par double-clic — PRIMORDIAL** : l'app tourne sur un PC
  d'entreprise fortement verrouillé par la DSI. Aucun serveur, aucun build, aucune
  architecture client-serveur. Interdits car ils forceraient un serveur local (CORS
  en `file://`) : **modules ES6** (`<script type="module">` + `import`/`export`) et
  **`fetch()`/XHR de fichiers locaux**. → charger le code par `<script src>` classiques,
  lire les fichiers utilisateur via `<input type="file">` + `FileReader` (jamais `fetch`).
  Vigilance particulière à l'**import Excel (Session 3)**.

### Stack technique
- **Canvas/graphe** : LiteGraph.js (MIT) — fichiers : `lib/litegraph.js` + `lib/litegraph.css`
- **Export PNG** : API Canvas2D native (pas de lib externe nécessaire)
- **Export PDF** : jsPDF (MIT) — fichier : `lib/jspdf.umd.min.js`
- **Import Excel (.xlsm)** : fflate (MIT, dézip ZIP) — fichier : `lib/fflate.min.js` ;
  build global non-module (compatible `file://`), parsing XML via `DOMParser` natif
- **UI** : Vanilla JS + CSS custom, aucun framework

### Structure des fichiers
```
pertflow/
├── index.html          # Point d'entrée unique
├── lib/
│   ├── litegraph.js
│   ├── litegraph.css
│   └── jspdf.umd.min.js
├── src/
│   ├── nodes.js        # Définition des types de nœuds PERT
│   ├── pert_engine.js  # Algorithmes de calcul PERT
│   ├── import_excel.js # Import des plannings legacy Excel (.xlsm → nœuds/liens)
│   ├── ui.js           # Toolbar, panneau latéral, interactions
│   ├── storage.js      # Sauvegarde/chargement JSON
│   └── export.js       # Export PNG et PDF
└── css/
    └── style.css       # Styles globaux de l'application
```

---

## MODÈLE DE DONNÉES

### Format JSON du fichier .pert
```json
{
  "version": "1.0",
  "meta": {
    "title": "Nom du projet",
    "t0": "2025-01-01",
    "unit": "j"
  },
  // NB : valeurs réelles de meta.unit dans le code → "j" | "sem" | "mois"
  "graph": { /* sérialisation LiteGraph native via graph.serialize() */ }
}
```

### Nœud Activité — propriétés
```js
{
  id: "uuid-v4",
  type: "pert/activity",
  label: "Nom de l'activité",
  duration: 5,          // en unités (jours, semaines ou mois selon meta.unit)
  etp: 1,               // S8.5 : nombre d'ETP (Equivalent Temps Plein) estimé — modifiable
  responsible: "",      // optionnel
  notes: "",            // S8 : note libre (panneau seul, jamais rendue sur le nœud)
  group: "",            // S6 : WP/métier/service (couleur mémorisée dans meta.groups)
  color: "#4A90D9",     // couleur de fond du nœud
  // Coût estimé (S8.5) : NON stocké — dérivé (duration→heures × etp × taux, cf.
  // pertActivityCost), recalculé comme es/ef. Affiché en lecture seule dans le panneau
  // et agrégé en barre d'état ; JAMAIS rendu sur le nœud (PERT != outil de chiffrage).
  // Calculés (non saisis) :
  es: null,             // Early Start (date au plus tôt de début)
  ef: null,             // Early Finish (date au plus tôt de fin)
  ls: null,             // Late Start (date au plus tard de début)
  lf: null,             // Late Finish (date au plus tard de fin)
  slack: null,          // Marge = lf - ef (en unités)
  is_critical: false    // true si sur le chemin critique (slack == 0)
}
```

### Nœud Jalon — propriétés
```js
{
  id: "uuid-v4",
  type: "pert/milestone",
  label: "Nom du jalon",
  due_date: "2025-06-01",  // date butée (optionnelle)
  // Calculés :
  ef: null,
  lf: null,
  slack: null,
  is_critical: false
}
```

### Nœud Label — propriétés
```js
{
  id: "uuid-v4",
  type: "pert/label",
  text: "Zone de documentation libre"
}
```

---

## RÈGLES DE CALCUL PERT

### Conventions
- **T0** = date de début du projet (saisie dans le panneau paramètres)
- **Durée** exprimée en jours, semaines ou mois (selon `meta.unit` : `"j"` | `"sem"` | `"mois"`)
- **Calcul interne en unités** (offset depuis T0) ; conversion en dates calendaires à l'affichage. Jours (j=1) et semaines (sem=7 j) = facteurs exacts ; **mois = mois CALENDAIRES réels** (via `Date.setMonth`, longueurs de mois et bissextiles gérées) — PAS un facteur fixe 30 j (corrigé pré-S8 : le facteur 30 dérivait de ~6 j/an, gênant sur les projets longs). On convertit toujours l'offset cumulé depuis T0 (jamais pas-à-pas) → conversions inversibles et sans dérive. Implémentation : `pertAddUnits` / `pertOffsetToDate` / `pertDateToOffset` dans `pert_engine.js`.
- **ES** du premier nœud = T0
- **EF** = ES + durée
- **ES** d'un nœud = max(EF de tous ses prédécesseurs)
- **LF** du dernier nœud = son EF (pas de marge sur le nœud final)
- **LS** = LF - durée
- **LF** d'un nœud = min(LS de tous ses successeurs)
- **Marge (slack)** = LF - EF (exprimée en unités, pas en jours calendaires)
- **Chemin critique** = tous les nœuds avec slack == 0

### Cas particuliers
- Nœud sans prédécesseur → ES = T0
- **Jalon ENTRANT** (corrigé pré-S8) : un Jalon **sans lien entrant + avec lien sortant + due_date** modélise une contrainte externe (livraison prototype, jalon client/fournisseur…) → son `ES = EF = offset(due_date)` (planché à T0 si la cible est antérieure), au lieu de démarrer à T0. La tâche en aval ne part donc pas automatiquement à T0. La topologie (aucun entrant + un sortant) distingue ce cas du jalon terminal et du checkpoint intermédiaire. Implémenté dans le forward pass de `pertRecalc`.
- Jalon avec due_date → LF = min(due_date calculée, LF propagée)
- Checkpoint intermédiaire (Jalon avec prédécesseur(s)) : la due_date ne borne que le LF, elle ne force PAS l'ES (qui reste = max EF des prédécesseurs)
- Cycle détecté → afficher une erreur dans l'UI, ne pas calculer
- Nœud isolé (sans connexion) → calculé indépendamment depuis T0

### Déclenchement du recalcul
Recalculer automatiquement à chaque événement LiteGraph :
- `graph.onNodeAdded`
- `graph.onNodeRemoved`
- `graph.onConnectionChange`
- Modification d'une propriété dans le panneau latéral

### Estimation de coût (Session 8.5)
**Coût d'une Activité = (durée convertie en heures) × ETP × taux horaire moyen.** En euros
en interne, affiché en **k€**. La conversion durée→heures dépend de l'unité courante
(`meta.unit`) et de paramètres dédiés (modifiables dans Paramètres, sérialisés, défauts
entreprise) :
- **jour** : `durée × hours_per_day` (défaut 8)
- **semaine** : `durée × 5 × hours_per_day` (semaine = 5 jours ouvrés)
- **mois** : `durée × hours_per_month` (défaut 135 — **paramètre indépendant**, PAS dérivé du jour)
- **taux** : `hourly_rate` (défaut 136 €/h)

Implémentation : `pertActivityCost(node)` (euros) + `pertFormatCost(euros)` (k€, FR) dans
`pert_engine.js`. **Le coût n'est PAS stocké** (dérivé, recalculé comme es/ef). Les Jalons et
Labels n'ont pas de coût. **Principe directeur : PertFlow reste un PERT, pas un outil de
chiffrage** → ETP (saisie) et coût (lecture seule) vivent dans le **panneau latéral** et la
**barre d'état**, JAMAIS sur le nœud (décision utilisateur).

Barre d'état (`updateStatus`, rafraîchie toutes les 600 ms **et** par `pertHighlightCriticalPath`) :
- **Coût total** = somme des Activités **visibles** (estompées par le filtre exclues → libellé
  « Coût visible » si filtre actif, sinon « Coût total »).
- **Chemin critique** = nombre de **tâches** + coût des Activités du chemin **actuellement mis en
  évidence** (`window.pertCriticalPathIds`, le MÊME que le tracé rouge) → **suit la sélection**
  (chemin contraignant de la tâche sélectionnée) ; **sans sélection**, c'est le chemin de marge
  minimale (`is_critical`). Corrige une incohérence S8.5 : avant, le coût utilisait `is_critical`
  (invariant) alors que le tracé rouge suivait la sélection → les deux divergeaient.
- **Comptage en tâches uniquement** (Activités) — pour le chemin critique ET le total projet
  (`#status-nodes` = « N tâche(s) ») : les Jalons sont des contraintes/sorties de chemin, pas des
  actions sur lesquelles agir (décision utilisateur). `#status-pert` ne porte plus que la fin de projet.

---

## RENDU VISUEL DES NŒUDS

### Nœud Activité (rectangle)
```
┌─────────────────────────┐
│  [●] Nom de l'activité  │  ← couleur de fond configurable
├─────────────────────────┤
│  Durée : 5 sem          │
│  Resp. : Frédéric       │
├─────────────────────────┤
│  Fin t.tôt : 15/03/25   │  ← calculé, fond vert si OK
│  Marge : +2 sem         │  ← rouge si marge = 0 (critique)
└─────────────────────────┘
```
- Bordure rouge épaisse si `is_critical == true`
- Fond de la section calculs : vert clair si marge > 0, rouge clair si marge = 0

### Nœud Jalon (rectangle arrondi + coin drapeau — refonte S2.5)
- Forme rectangle arrondi dessinée via `onDrawBackground()` en Canvas2D (le losange
  de S1, trop exigu pour le texte, a été abandonné en S2.5/#5)
- Coin « drapeau » (petit triangle haut-droit) = marqueur visuel du type Jalon ;
  losange glyphe ◆ devant le libellé pour conserver l'identité PERT
- Libellé multi-lignes (`wrapText`), + ligne « Fin » calculée + ligne « Cible » si renseignée
- Fond/bordure rouge si critique OU date-cible non tenue (`target_missed`)

### Nœud Label (rectangle en pointillés)
- Pas de ports d'entrée/sortie
- Fond transparent, bordure en pointillés
- Texte multilignes

### Connexions
- Flèche orientée (de sortie vers entrée)
- Couleur rouge si les deux nœuds connectés sont critiques
- Couleur grise sinon

---

## INTERFACE UTILISATEUR

### Layout général
```
┌─────────────────────────────────────────────────────┐
│  TOOLBAR                                            │
├──────────────────────────────────┬──────────────────┤
│                                  │                  │
│         CANVAS LITEGRAPH         │  PANNEAU         │
│                                  │  PROPRIÉTÉS      │
│                                  │  (nœud sélect.)  │
│                                  │                  │
└──────────────────────────────────┴──────────────────┘
│  BARRE STATUT (T0, unité, nb nœuds, erreurs PERT)   │
└─────────────────────────────────────────────────────┘
```

### Toolbar — boutons
- **+ Activité** : ajoute un nœud Activité au centre du canvas
- **+ Jalon** : ajoute un nœud Jalon
- **+ Label** : ajoute un nœud Label
- **Paramètres** : ouvre dialog (T0, unité durée)
- **Ouvrir** : charge un fichier `.pert` (JSON)
- **Sauvegarder** : télécharge le fichier `.pert`
- **Export PNG** : capture et télécharge
- **Export PDF** : génère et télécharge
- Séparateur
- **Undo** (Ctrl+Z)
- **Redo** (Ctrl+Y)

### Panneau propriétés (droite)
Affiché quand un nœud est sélectionné. Champs selon le type :
- Activité : Libellé (text), Durée (number), Responsable (text), Couleur (color picker)
- Jalon : Libellé (text), Date butée (date)
- Label : Texte (textarea)
Bouton **Supprimer** en bas du panneau (rouge).

### Raccourcis clavier
- `Delete` / `Backspace` : supprimer nœud(s) sélectionné(s)
- `Ctrl+Z` : undo
- `Ctrl+Y` : redo
- `Ctrl+A` : sélectionner tout
- `Ctrl+C` / `Ctrl+V` : copier/coller sélection
- `Ctrl+scroll` : zoom (natif LiteGraph)

---

## POINTS DE VIGILANCE LITEGRAPH

### Rendu custom des nœuds
- Utiliser `node.onDrawForeground(ctx, canvas)` pour le rendu custom
- Utiliser `node.onDrawBackground(ctx, canvas)` pour le fond
- Les dimensions du nœud : `node.size = [largeur, hauteur]`
- Pour forcer le redessin : `node.setDirtyCanvas(true, true)`
- **PIÈGE** : pour masquer la barre de titre, `node.flags.no_title` **ne fonctionne pas**
  (jamais lu au rendu). Le rendu du titre est piloté par `Constructor.title_mode`
  (`LiteGraph.NO_TITLE` = 1, cf. `litegraph.js` l.9052). Définir donc
  `MonNoeud.title_mode = LiteGraph.NO_TITLE;` sur le constructeur, pas un flag d'instance.
- Si on masque le titre **et** qu'on veut des slots ailleurs qu'à leur position par
  défaut, fixer explicitement `input.pos = [x, y]` / `output.pos = [x, y]` (relatifs au
  coin haut-gauche) ; `getConnectionPos` les respecte (dessin ET interaction).

### Sérialisation
- `graph.serialize()` retourne un objet JS (pas une string)
- `graph.configure(data)` pour restaurer
- Les propriétés custom des nœuds doivent être dans `node.properties` pour être sérialisées automatiquement

### Multi-sélection
- LiteGraph gère nativement la sélection par rectangle (drag sur canvas vide)
- `canvas.selected_nodes` contient les nœuds sélectionnés
- Pour supprimer la sélection : itérer sur `canvas.selected_nodes` et appeler `graph.remove(node)`

### Connexions
- Un nœud Activité a 1 input et 1 output (type "pert")
- Un nœud Jalon a N inputs et 1 output
- Forcer le type de connexion pour éviter les connexions invalides :
  ```js
  this.addInput("", "pert_flow")
  this.addOutput("", "pert_flow")
  ```

### Losange pour le Jalon
```js
onDrawForeground(ctx) {
  const w = this.size[0], h = this.size[1];
  ctx.beginPath();
  ctx.moveTo(w/2, 0);
  ctx.lineTo(w, h/2);
  ctx.lineTo(w/2, h);
  ctx.lineTo(0, h/2);
  ctx.closePath();
  ctx.fillStyle = this.is_critical ? "#ffcccc" : "#fffbe6";
  ctx.fill();
  ctx.strokeStyle = this.is_critical ? "#cc0000" : "#999";
  ctx.stroke();
}
```

---

## ÉTAT D'AVANCEMENT PAR SESSION

> **Réorientation du 22/06/2026** — après retours d'équipe et perte du poste de dev
> initial (reconstruction depuis Git + ce fichier), le plan linéaire évolue :
> - **7 demandes utilisateurs** de lisibilité regroupées en **Session 2.5** (#1 à #7).
> - **Import des plannings legacy Excel (#8)** marqué 🔴 URGENT, intégré en **Session 3**
>   (avant la Session 4) — approche figée sur fichier exemple.
> - **Restitution interne de septembre 2026** (« développement d'outils métier assisté
>   par IA ») : journal tenu en continu dans `docs/journal-developpement.md`.
> - Undo/Redo reporté en fin de parcours (Session 4). (Copier/coller livré en S3.)
> - **Documentation dédiée** : manuel utilisateur + document de conception et de
>   maintenance. Initialement actée en Session 5 (25/06/2026), **déplacée en toute fin
>   de parcours** (décision du 27/06/2026) pour que le manuel illustre l'application
>   aboutie. La tâche « Guide utilisateur 1 page » de S4 en était la prémisse.
>
> **2e retour utilisateur (27/06/2026, « Mickael »)** — 32 remarques dépouillées et
> catégorisées (`retours-utilisateurs/remarques_mickael`). Intégrées à la roadmap plutôt que
> traitées au fil de l'eau : voir le détail réparti sur S5→S10 ci-dessous, et le bloc
> « Long terme / écarté » en fin de section. Le numéro `#NN` des objectifs S5+ renvoie
> à la ligne correspondante de `remarques_mickael`. Arbitrages utilisateur du 27/06 :
> correctifs/quick wins **avant** le chantier métier ; chantier « regroupement WP »
> **découpé en 2 temps** (S6 dimension+couleur, S7 socle+filtre) ; **doc en dernier**.
>
> **Redéfinition de S7 (28/06/2026)** — S7 n'est plus « filtre + coût » mais « le couple
> couleur/groupe au cœur des fonctions de base » : on fait d'abord exploiter le concept
> couleur/groupe par l'**import Excel** (choix/création de groupe au lieu d'une simple
> couleur) et la **réorganisation** (conserver le regroupement par couleur), **avant** de
> bâtir le **filtre #16** (le tout dans S7). **#3 (estimation de coût) retiré** de la
> roadmap planifiée → long terme (outil PERT KISS). Détail dans la section S7.
>
> **Réintroduction de #3 — Session 8.5 (30/06/2026)** — après S8, l'utilisateur a finalement
> demandé la fonction d'**estimation de coût** (#3), retirée de S7 et classée « long terme ».
> Insérée comme **Session 8.5** (intercalée avant S9, modèle S2.5). Principe : ETP saisi +
> coût dérivé, **uniquement dans le panneau et la barre d'état** (PERT ≠ outil de chiffrage).
>
> Roadmap effective : **S1 ✅ → S2 ✅ → S2.5 ✅ → S3 ✅ (dont import Excel) → S4 ✅
> → S5 ✅ (correctifs & quick wins) → S6 ✅ (regroupement métier WP, temps 1) → S7 ✅
> (couleur/groupe : import + réorg conscients du groupe, puis filtre) → S8 ✅ (propriétés &
> jalons enrichis) → S8.5 ✅ (estimation des coûts, #3 réintroduit) → S9 (exports avancés) →
> S10 (liens & layout) → Doc (fin)**.

### Session 0 — Mise en place du dépôt GitHub ✅ TERMINÉE
**Objectifs** :
- [x] Créer le dépôt GitHub `pertflow` (public ou privé selon politique entreprise)
- [x] Initialiser le dépôt localement et lier au remote
- [x] Créer la structure de fichiers du projet (dossiers `lib/`, `src/`, `css/`)
- [x] Télécharger les libs et les placer dans `lib/` :
  - LiteGraph.js : https://github.com/jagenjo/litegraph.js (fichiers `build/litegraph.js` et `css/litegraph.css`)
  - jsPDF : https://github.com/parallax/jsPDF (fichier `dist/jspdf.umd.min.js`)
- [x] Créer un `README.md` minimal (description, prérequis, comment lancer)
- [x] Créer un `.gitignore` adapté (node_modules, fichiers systèmes OS)
- [x] Commit initial `"chore: init project structure"`
- [x] Vérifier que le dépôt est accessible et clonable

**Conventions Git à respecter pour la suite** :
- Commits en anglais, préfixés : `feat:`, `fix:`, `chore:`, `docs:`
- Une branche par session : `session/1-canvas`, `session/2-pert-engine`, etc.
- Merge sur `main` en fin de session validée
- Tag de version en fin de chaque session : `v0.1`, `v0.2`, `v0.3`, `v0.4`

**Critère de validation** :
Dépôt clonable depuis zéro, structure présente, libs en place, `index.html` vide ouvrable dans le navigateur.

---

### Session 1 — Socle canvas + nœuds ✅ TERMINÉE (reste : undo/redo, copier/coller — reportés)
**Objectifs** :
- [x] Structure de fichiers créée
- [x] LiteGraph.js initialisé et fonctionnel
- [x] Nœud Activité défini et rendu
- [x] Nœud Jalon défini (losange — refonte de forme prévue en Session 2.5, voir réorientation)
- [x] Nœud Label défini
- [x] Toolbar avec boutons Ajouter
- [x] Panneau propriétés fonctionnel (toujours visible, slots d'entrée dynamiques, resize auto)
- [x] Multi-sélection, suppression, zoom OK
- [x] Connexions entre nœuds

**Critère de validation** :
Construire manuellement un réseau PERT de 5 nœuds, modifier les propriétés, déplacer en groupe, supprimer.
**Reste** : undo/redo et copier/coller (déplacés en fin de parcours, cf. réorientation).

---

### Session 2 — Moteur de calcul PERT ✅ TERMINÉE
**Objectifs** :
- [x] Panneau paramètres (T0, unité — jours / semaines / mois)
- [x] Forward pass implémenté (ES / EF)
- [x] Backward pass implémenté (LS / LF)
- [x] Calcul des marges (slack en unités)
- [x] Affichage résultats dans les nœuds (dates calendaires)
- [x] Surlignage chemin critique au niveau des nœuds (tracé rouge du chemin → Session 2.5, #7)
- [x] Recalcul automatique (onNodeAdded / onNodeRemoved / onConnectionChange + édition)
- [x] Détection des cycles (DFS tricolore, message en barre de statut)
- [x] Jalon : borne LF par la date-cible + flag `target_missed` (amorce #6)

**Critère de validation** :
Reproduire le PERT Excel de référence et comparer les résultats chiffrés.
**Validé** par test headless (bac à sable Node) : PERT diamant (chemin critique
A-C-D, marge B=3), détection de cycle, jalon cible non tenue — tous OK. Comparaison
au PERT Excel de référence à refaire une fois l'import Excel disponible (Session 3).

**Implémentation — décisions notables** :
- Calcul interne en **unités** (offset depuis T0), conversion en **dates** à l'affichage.
- Conversion date à **facteur fixe** (j=1, sem=7, mois=30 j) → `offset↔date` inversibles.
- **Fin de projet = max(EF)** (nœud le plus éloigné de T0), ancrage du backward pass.
- **Marge négative** = délai/cible infaisable → affichée en rouge (alerte).

---

### Session 2.5 — Visualisation & lisibilité du PERT ✅ TERMINÉE (validée navigateur 24/06/2026)
**Objectifs** (issus de la réorientation du 22/06/2026) :
- [x] #1 Ré-arrangement chronologique automatique des nœuds (selon dates au plus tôt), **sans superposition** — bouton « Réorganiser » (déclenchement manuel)
- [x] #2 Largeur des tâches proportionnelle à la durée (échelle `PERT_PX_PER_UNIT`, bornée [160, 320]px)
- [x] #3 Unités semaines / mois (moteur S2 ; l'unité pilote désormais aussi la largeur des nœuds via l'échelle commune)
- [x] #4 Intitulé multi-lignes quand le texte ne tient pas dans la boîte (`wrapText`, Activité + Jalon)
- [x] #5 Refonte de la forme du Jalon : rectangle arrondi + coin « drapeau » (abandon du losange exigu)
- [x] #6 Jalon date-cible « à tenir » + exergue rouge si non tenue (flag `target_missed` calculé en S2, rendu rouge en S2.5)
- [x] #7 Tracé visuel du chemin critique (en rouge) depuis la tâche sélectionnée ou, par défaut, la plus éloignée de T0

**Critère de validation** :
Un PERT de 10+ nœuds reste lisible après ré-arrangement automatique ; le chemin critique est identifiable d'un coup d'œil.
**État** : validée en navigateur (Chrome) le 24/06/2026 après une passe de corrections sur retour
visuel utilisateur (cf. ci-dessous). Logique également couverte par test headless Node.

**Implémentation — décisions notables** :
- **Masquage de la barre de titre = `Constructor.title_mode = LiteGraph.NO_TITLE`**, PAS
  `flags.no_title` (qui n'a AUCUN effet sur le rendu — piège LiteGraph, cf. POINTS DE VIGILANCE).
  Appliqué à Activité, Jalon et Label.
- **Échelle horizontale commune** `PERT_PX_PER_UNIT` (60 px/unité) partagée entre la largeur
  ∝ durée (#2) et l'abscisse du layout (#1) → une chaîne de tâches se « carrèle » comme un Gantt.
- **Largeur Activité bornée [140, 480] px** : le plancher 140 loge la ligne calculée la plus large
  (« Fin t.tôt : 28/11/26 ») → les très courtes durées (1-2 u.) restent au plancher, la
  proportionnalité n'est nette qu'au-delà. Compromis assumé (texte vs proportionnalité stricte).
  **MàJ S5 (27/06)** : le plafond `480` saturait dès 8 unités (15 et 30 mois identiques) → relevé
  à **3000 px** (simple garde-fou), la borne effective est donc `[140, 3000]`.
- **Layout = packing par couloirs** (lanes) : abscisse ∝ ES, tâches se chevauchant dans le temps
  posées sur des couloirs distincts ; **jalons de sortie (terminaux) regroupés en bande haute** ;
  déclenché **manuellement** (bouton), jamais pendant l'édition pour ne pas casser un placement manuel.
- **Espacement horizontal entre tâches consécutives** ajouté par `rang × gap` (rang = profondeur
  dans la chaîne) : l'abscisse stricte colle les tâches bord à bord et masque les liens. `gap`
  **paramétrable à chaud** via le dialogue Paramètres (`meta.layout_gap`, défaut 30 px) — décision
  revisable après consultation utilisateurs.
- **Activité dessinée 100% custom** (en-tête coloré + positions de slots explicites via `input.pos`/
  `output.pos`) : nécessaire pour l'en-tête multi-lignes (LiteGraph ne fait pas de titre multi-lignes).
- **Chemin critique tracé** par remontée des prédécesseurs contraignants (EF cale le ES) depuis la
  cible ; coloration via `link.color` (mécanisme natif LiteGraph). Recalculé à chaque sélection.
  Cible par défaut = nœud d'EF max, **tie-break vers le nœud terminal** (le jalon de fin plutôt
  que la dernière activité).
- `updateSize()` doit être rappelé **à chaque frappe du libellé** (pas seulement sur la durée),
  sinon le retour à la ligne ne se rafraîchit qu'au prochain événement de graphe.

---

### Session 3 — Persistance, import Excel & export ✅ TERMINÉE (25/06/2026)
**Objectifs** :
- [x] **#8 Import des plannings legacy Excel** (🔴 URGENT) — lecture directe `.xlsm` (objets graphiques) + **concaténation** dans un PERT existant ✅ 25/06/2026
- [x] Sauvegarde/chargement JSON (.pert)
- [x] Export PNG
- [x] Export PDF
- [x] Copier/coller nœuds
- [x] Nœud Label opérationnel

**Critère de validation** :
Importer un planning Excel réel et le concaténer. Sauvegarder, recharger, vérifier intégrité. Exporter PNG et PDF lisibles.
**Import #8 validé** (croisé) : test e2e Playwright/Chromium sur `C_PERT_exemple.xlsm`
(6 nœuds, 4 liens, T0/unité depuis MANUEL, 0 erreur console) + validation visuelle utilisateur.
**Persistance/export/copier-coller validés** : smoke test Playwright/Chromium en `file://`
— import → sauvegarde `.pert` → clear + rechargement (intégrité 6=6) → export PNG (signature
valide) → export PDF (`%PDF-`) → copier/coller (6→12) → Label `updateSize` ; 0 erreur console.

**Import Excel — décisions notables** :
- Le `.xlsm` est un ZIP ; **toute la donnée est dans `xl/drawings/`** (groupes de formes =
  nœuds, connecteurs = liens). Les cellules sont cosmétiques SAUF l'onglet **MANUEL**, qui
  est la **feuille de config** de l'outil C-PERT : `K2`=feuille PERT cible, `K5`=T0 (date
  série Excel), `J10`=unité (1=mois, 2=sem). L'import lit ces paramètres ; le choix de
  feuille manuel est un fallback.
- Convention de nommage : groupe `<lettre><id>` → `A`=activité, `S`=jalon, `E`=**jalon
  entrant** (« Jalon entrée » C-PERT). Sous-formes `.1`=libellé, `.2`=`durée/marge`
  (virgule décimale FR ; on garde la durée), `.3`/`.4`=date. Jalon : date-cible encodée
  `E=(jj/mm/aaaa)` dans le libellé → `due_date`.
- **Nœud `E` (corrigé pré-S8)** : auparavant non matérialisé (seulement source T0 de
  secours, arêtes supprimées) → le jalon entrant et sa contrainte étaient **perdus à
  l'import**. Désormais **matérialisé en Jalon** (`due_date` = sa date) **avec ses arêtes
  sortantes conservées** ; couplé à la règle « jalon entrant » du moteur, la contrainte
  d'entrée est restituée. Le rôle de source T0 de secours est conservé (si MANUEL n'a pas
  de T0). Un `E` posé à T0 donne un jalon à T0 (redondance assumée, documente l'entrée).
- Connecteurs : `stCxn`/`endCxn` pointent une **sous-forme** → map `id sous-forme→groupe`
  pour résoudre. On ne retire plus que les self-loops et les liens non résolus (les arêtes
  des nœuds `E` sont conservées).
- **Contrainte `file://`** : dézip par **fflate** (`lib/fflate.min.js`, MIT, global
  non-module), `<input type="file">` + `FileReader.readAsArrayBuffer`, parsing `DOMParser`,
  **jamais `fetch`**. `src/import_excel.js` sépare transforms purs (testables Node) et
  couche DOM/ZIP (navigateur).
- Placement importé **conservé tel quel** (coordonnées absolues Excel, EMU→px via 9525),
  concaténé à droite du graphe existant ; l'utilisateur « Réorganise » s'il le souhaite.
- **Couleur par import** (évolution inter-sessions du 25/06/2026, avant S4) : un dialogue
  (`promptImportColor`) s'intercale à chaque import et applique **une couleur unique à toutes
  les Activités du lot** (les Jalons gardent leur code couleur critique/cible). Présélection =
  **première teinte de `IMPORT_COLOR_PALETTE` non encore utilisée** par une Activité du
  workspace (`pickDefaultImportColor`), pour distinguer visuellement les imports successifs.
  Les deux chemins d'import (auto MANUEL + fallback choix de feuille) convergent vers
  `finishExcelImport` → `applyImportModel(model, color)`.

**Persistance / export — décisions notables** :
- **`.pert` = `{ version, meta, graph }`** où `graph` est `graph.serialize()` natif. Les
  valeurs calculées (ES/EF/LS/LF/slack) **ne sont PAS sérialisées** (hors `node.properties`) :
  recalculées par `pertRecalc()` au chargement → cohérence garantie même sur vieux fichier.
  Chargement = `graph.clear()` puis `graph.configure()`, `updateSize()` rejoué sur chaque
  nœud (tailles dépendantes unité/libellés), puis recalc + zoom-to-fit.
- **Export = rendu hors-écran**, indépendant du zoom courant : `LGraphCanvas` temporaire
  (`{skip_events, skip_render}`, fond blanc, `show_info=false`) sur un canvas dimensionné à
  la boîte englobante, calé via `ds.scale`/`ds.offset` (convention `écran=(graphe+offset)*scale`),
  un seul `draw(true,true)`, puis `toDataURL`. Garde-fou résolution **6000 px**. Penser à
  `graph.detachCanvas(tmp)` après coup (sinon il reste dans `list_of_graphcanvas`).
- **PDF** : page A4 jsPDF (orientation selon ratio), PNG ajusté en conservant les proportions,
  titre projet en en-tête. Choix « fit-to-page A4 » plutôt qu'une page sur-mesure → imprimable.
- **Copier/coller** : presse-papier interne LiteGraph (`copyToClipboard`/`pasteFromClipboard`
  via `localStorage`) câblé Ctrl+C/Ctrl+V — recrée les liens internes à la sélection, colle à
  la position souris. **Bug latent corrigé** : Ctrl+A appelait `selectAllNodes()` (inexistant)
  → c'est `selectNodes()` sans argument qui sélectionne tout.
- **Label opérationnel** : `updateSize()` rappelé à l'édition du texte (boîte ∝ contenu).
  Overlay debug LiteGraph (`show_info`) masqué aussi dans le canvas principal.

---

### Session 4 — Finitions UX et packaging ✅ TERMINÉE (27/06/2026)
**Objectifs** :
- [x] **Undo/Redo** (26/06/2026) — historique par snapshots (`src/history.js`)
- [x] **Menu contextuel clic droit** (27/06/2026) — menus francisés recentrés PERT
  (fond + nœud) ; couvre #27/#45 (nettoyage) et #28 (searchbox neutralisée)
- [x] **Snap-to-grid** (27/06/2026) — toggle toolbar, grille visible seulement si activée
- [x] **Gestion des erreurs UI** (27/06/2026) — toast d'erreur rouge, `guardUI`, filet global
- [x] **Toolbar avec icônes** (27/06/2026) — glyphes Unicode homogènes (techno actuelle)
- [x] **HTML standalone bundlé** (27/06/2026) — `scripts/build-bundle.js` → `dist/pertflow.html`

**Critère de validation** :
Test utilisateur métier sans assistance.
**Validé** : smoke test existant sans régression + `tools/smoke-s4.js` (menus, searchbox,
snap, toast d'erreur, duplication) + vérif du bundle généré (init OK, 0 requête non-`file://`,
libs inlinées) — tous en navigateur réel (Playwright/Chromium, `file://`), 0 erreur console.

> Note : la « Guide utilisateur 1 page » initialement prévue ici est **déplacée et
> étoffée dans la session Doc finale** (manuel utilisateur complet), décision du
> 25/06/2026 (placement en fin de parcours acté le 27/06/2026).
>
> Note (retour Mickael, 27/06/2026) : le nettoyage du menu clic droit (#27/#45) couvre
> aussi **#28** (barre de recherche LiteGraph parasite au double-clic sur le fond) — à
> traiter ici ; sinon repris en S5. **#6 (CTRL+Z)** demandé par l'utilisateur est déjà
> livré (Undo/Redo ci-dessus). **#46** (grille aimantée) correspond au snap-to-grid
> ci-dessus ; son sous-point « liens droits/coudés » est planifié en S10.

**Undo/Redo — décisions notables (26/06/2026)** :
- Historique par **snapshots sérialisés** (`meta` + `graph.serialize()`), restaurés
  par `configure()` — même mécanisme que la persistance `.pert`, donc robuste et
  exhaustif (couvre ajout/suppression/connexion/déplacement/édition/import/layout/
  paramètres) sans tracer chaque mutation. Pile bornée à 60 entrées.
- **Coalescence** des frappes clavier (commit différé, debounce 450 ms) → un seul
  cran d'undo par saisie de champ, pas un par caractère.
- `pertHistoryMark()` câblé sur les événements LiteGraph (`onNodeAdded`,
  `onNodeRemoved`, `onConnectionChange`, `onNodeMoved`) + édition de propriété +
  bouton « Réorganiser » ; baseline `pertHistoryReset()` au démarrage **et** après
  chargement `.pert` (sinon Ctrl+Z post-chargement remonte avant le chargement).
- Pur JS, `<script src>`, aucune dépendance (contrainte `file://`).

**Décisions de conception pour les tâches restantes (figées le 26/06/2026)** :
- **Snap-to-grid = option utilisateur** : bouton **toggle on/off** dans la toolbar.
  La grille n'est **affichée que lorsque l'option est activée** (pas de grille visible
  à l'état désactivé).
- **Icônes toolbar** : on **améliore les icônes en restant sur la techno actuelle**
  (emoji/Unicode dans le HTML). Évolution future possible (non retenue pour S4) :
  passer à des **SVG inline** pour un rendu plus « pro » et homogène — à évaluer si
  besoin, sans dépendance ni fichier externe (compatible `file://`).
- **Bundle HTML standalone = génération à la demande par script** : un script produit
  le fichier bundlé dans un répertoire **`./dist`**. La **structure actuelle est
  conservée** (`index.html` + `src/` + `lib/`) pour poursuivre les développements ;
  le bundle n'est qu'un artefact de livraison, pas le format de travail.

**Implémentation — décisions notables (27/06/2026)** :
- **Menus contextuels = `getMenuOptions` / `getNodeMenuOptions` surchargés** sur
  l'instance `LGraphCanvas` (PAS `getExtraMenuOptions`, qui ne fait qu'ajouter au menu
  natif). On **remplace** ainsi intégralement les menus natifs anglais (Add Node/Group,
  Inputs/Outputs/Properties/Title/Mode/Resize/Collapse/Pin/Colors/Shapes) par des items
  français recentrés PERT. Menu de fond = ajout des 3 types de nœuds + Réorganiser +
  Tout afficher ; menu de nœud = Dupliquer + Supprimer.
- **Position d'ajout sous le curseur** : `processContextMenu` est wrappé pour mémoriser
  `convertEventToCanvasOffset(event)` (coords graphe) **avant** que LiteGraph ne construise
  le menu ; `getMenuOptions` lit cette position pour poser le nœud là où on a cliqué.
- **#28 searchbox** : `lgCanvas.allow_searchbox = false` neutralise la barre de recherche
  qui s'ouvrait au double-clic sur le fond (sans valeur pour un usage PERT).
- **Snap-to-grid** : `lgCanvas.align_to_grid` (natif) pour l'alignement au déplacement ;
  grille dessinée à la main dans `lgCanvas.onDrawBackground` (espace graphe, ctx déjà
  transformé) **uniquement si `pertSnapEnabled`** — et **omise si `GRID_STEP*scale < 6 px`**
  (illisible au zoom arrière). Pas de réalignement rétroactif des nœuds existants
  (l'alignement se fait au prochain déplacement).
- **Gestion d'erreurs** : `showToast(msg, isError)` + helper `showError` (toast rouge),
  `guardUI(context, fn)` enrobant les actions risquées (sauvegarde/ouverture/export/import),
  et un filet global (`window.error` / `unhandledrejection`) — indispensable en `file://`
  où l'utilisateur métier n'a pas accès à la console.
- **Bundle** (`scripts/build-bundle.js`, Node natif, aucune dépendance) : inline des
  `<link rel=stylesheet>` → `<style>` et des `<script src>` → `<script>` par regex sur
  `index.html`, avec échappement défensif de `</script>`/`</style>` dans les contenus
  minifiés et **garde-fou** qui échoue s'il reste une référence `lib/`/`src/`/`css/`.
  Sortie `dist/pertflow.html` (~1,6 Mo). `scripts/` est suivi par git (contrairement à
  `tools/`, outillage de validation gitignoré). **MàJ 29/06 :** `dist/pertflow.html` est
  désormais **versionné** (plus gitignoré) et régénéré en fin de session (cf. « Rituel de
  fin de session »).
- **Icônes toolbar** : glyphes Unicode monochromes pour les 3 boutons d'ajout
  (▭ Activité / ◈ Jalon / ❏ Label) + bouton ▦ Grille, homogènes avec le reste de la
  toolbar (emoji/Unicode), sans dépendance ni fichier externe.

---

### Session 5 — Correctifs & quick wins (retour utilisateur Mickael) ✅ TERMINÉE (27/06/2026)
Issue du 2e retour utilisateur du 27/06/2026 (`remarques_mickael`). Petits efforts,
forte satisfaction perçue, faible risque — traités en premier (arbitrage utilisateur).
**Objectifs** :
- [x] **#25 (bug)** Cohérence linguistique : neutralisation des derniers panneaux/menus
  natifs LiteGraph en anglais (panneau de nœud au double-clic, menu de lien au clic droit)
- [x] **#26 (bug)** Dernier lien du chemin critique non coloré — descente symétrique vers
  le nœud terminal ajoutée à `pertHighlightCriticalPath` (le tracé ne s'arrêtait plus à la
  cible sélectionnée mais allait jusqu'au terminal en aval)
- [x] **#29 (bug)** Export PDF : `compress:true` (flux image deflate sans perte → poids
  ÷10, de ~1,5 Mo à ~150 Ko) + rendu hors-écran en 2× (meilleure définition)
- [x] **#8** Responsable déplacé dans l'en-tête coloré du nœud Activité (texte blanc + 👤,
  tronqué si trop long) — auparavant même police/taille que « Fin t.tôt » et collé à elle,
  les deux infos se confondaient (décision utilisateur : « dans l'en-tête coloré »)
- [x] **#20** Coin/exergue du Jalon en vert quand la cible est tenue avec marge ≥ 1 unité
  (orange si juste tenue, rouge si ratée) — décision utilisateur : 3 états avec seuil. La
  couleur reflète la **tenue de la cible**, indépendamment du chemin critique (cf. retour
  utilisateur : un jalon terminal largement en avance sur sa cible doit être vert)
- [x] **#15** Réorganisation : les Labels chevauchant un nœud placé sont relogés dans une
  bande libre sous le graphe (les Labels non gênants gardent leur position)
- [x] **#28 (bug)** Barre de recherche LiteGraph neutralisée — **livré en S4** (`allow_searchbox = false`)
- [x] **Bug barre d'état** (hors liste, trouvé en validation) : « Chemin critique : 0 nœud(s) »
  affiché en permanence dès qu'une date-cible de jalon était ratée (marges toutes négatives →
  aucun nœud à slack 0). Chemin critique redéfini en **marge minimale** (cf. notes)
- [x] **Bug largeur ∝ durée plafonnée** (hors liste, trouvé en validation) : le plafond
  `ACT_MAX_W=480` saturait dès 8 unités → une activité de 15 et une de 30 mois avaient la même
  largeur. Plafond relevé à 3000 px (garde-fou de sécurité), proportionnalité rétablie (cf. notes)

**Critère de validation** :
L'utilisateur métier ne relève plus #25/#26/#28/#29 ; rendu validé en navigateur réel.
**État** : implémenté et validé par tests headless navigateur (`tools/smoke-critical.js` #26,
`tools/smoke-s5.js` #15/#20/#8) + smoke existant sans régression + capture de contrôle
(en-tête responsable, coin vert/rouge, chemin critique complet). **Validation visuelle
utilisateur à confirmer avant merge** (même schéma que S4).

**Implémentation — décisions notables (27/06/2026)** :
- **#26** : DEUX volets. (1) Données — la coloration part de la cible (nœud sélectionné,
  sinon terminal d'EF max) et **remonte** les prédécesseurs contraignants ; ajout d'une
  **descente symétrique** vers l'aval (successeurs que le nœud contraint, EF cale le ES)
  jusqu'au terminal. Sans effet au clic fond (cible déjà terminale). (2) Rendu — LiteGraph
  force la couleur **#FFF** (blanc) sur les liens du nœud sélectionné (`highlighted_links`
  dans `renderLink`), ce qui **masquait** le rouge sur le dernier lien d'un jalon sélectionné.
  Corrigé en vidant `highlighted_links` dans notre `onDrawBackground` (appelé juste avant
  `drawConnections` dans `drawBackCanvas`) → nos couleurs de lien priment, sans patcher la lib.
- **#25** : les menus contextuels étaient déjà francisés en S4 ; restaient des entrées
  natives anglaises — le **panneau de nœud** au double-clic (`onShowNodePanel` → no-op), le
  **menu de lien** au clic droit (`showLinkMenu` remplacé par un menu FR « Supprimer le lien »),
  et (post-validation) le **titre du menu de nœud** : LiteGraph y met `node.type`
  (« pert/activity »…) via `processContextMenu` ; notre wrapper le remplace après création
  par `node.constructor.title` (« Activité »/« Jalon »/« Label »), sans patcher la lib.
- **#29** : le poids venait de l'absence de compression jsPDF (image stockée brute), pas de
  la résolution. `compress:true` = gain sans perte ; le 2× est un bonus de netteté.
  `pertRenderToCanvas(renderScale)` accepte un facteur de suréchantillonnage (PNG reste à 1×).
- **#8** : `MILESTONE_GREEN_MARGIN` mis à part, le responsable passe de la section info à
  l'en-tête → `infoH` repasse à 28 (constante) et `headerH` intègre une ligne responsable.
  Troncature par `ellipsize()` (helper canvas) pour éviter tout débordement.
- **#20** : état calculé par `MilestoneNode.prototype.targetState()` (« alert »/« safe »/
  « neutral ») — testable isolément. Marge mesurée **vis-à-vis de la cible** (`dueOffset - ef`),
  pas le slack (qui peut être borné par l'aval). **`is_critical` N'INTERVIENT PAS** dans la
  couleur du jalon (correctif post-validation utilisateur) : un jalon est un marqueur
  d'échéance, sa couleur dit « cible tenue ? » et non « sur le chemin critique ? » (ce dernier
  est porté par le rouge des LIENS). DOTD/COTD ne sont que des libellés d'importance
  contractuelle, sans lien avec la tenue.
- **#8** (correctif post-validation) : le handler du champ « Responsable » dans `showProperties`
  ne rappelait pas `updateSize()` → l'en-tête ne grandissait pas et le nom débordait sous le
  bandeau quand le libellé tenait sur une ligne. Ajout de `node.updateSize()` (comme le champ
  Libellé).
- **#15** : `pertRelocateOverlappingLabels` appelée en fin de `pertAutoLayout` ; ne déplace
  que les Labels en recouvrement (test d'intersection de rectangles), empilés sous le graphe.
- **Bug largeur ∝ durée plafonnée (`ACT_MAX_W`)** : la largeur d'une activité est
  `clamp(durée × PERT_PX_PER_UNIT, ACT_MIN_W, ACT_MAX_W)`. L'ancien plafond `480` (= 8 unités à
  60 px/u.) saturait toutes les durées ≥ 8 → 15 et 30 mois rendus à l'identique, et la barre ne
  couvrait plus son empan temporel (le layout place le successeur à `es × 60`, créant un grand
  vide). Plafond porté à **3000 px** (= 50 unités), réduit à un simple garde-fou de taille de
  canvas (cas typo). Le plancher `ACT_MIN_W=140` reste pour la lisibilité du texte des tâches
  courtes (compromis assumé : sous ~2,3 unités, lisibilité > proportionnalité stricte). Effet
  de bord positif : la barre cale désormais sur son empan temporel → cohérence avec le layout
  façon Gantt.
- **Bug barre d'état (chemin critique = marge minimale)** : `is_critical` était `|slack| < eps`
  (strictement 0). Une date-cible de jalon non tenue borne LF à la cible → tout le chemin
  contraignant passe en marge **négative**, donc plus aucun nœud à slack 0 → `nbCritical = 0`
  et « Chemin critique : 0 nœud(s) ». Corrigé en définissant le chemin critique par la **marge
  minimale** : `is_critical = slack <= minSlack + eps`. En projet faisable `minSlack = 0` (le
  terminal d'EF max est calé sur la fin de projet) → comportement strictement inchangé ; en
  projet infaisable, le chemin contraignant (le plus en retard) est identifié. C'est aussi la
  définition PERT standard (float minimal, négatif si échéance imposée intenable). Le tracé
  rouge des liens (`pertHighlightCriticalPath`) marchait déjà (basé sur la contrainte EF, pas
  sur `is_critical`) ; seuls le compteur de statut et les bordures rouges des activités étaient
  affectés.

---

### Session 6 — Regroupement métier (WP/service), temps 1 : dimension + couleur ✅ TERMINÉE (27/06/2026)
Chantier transversal majeur du retour Mickael — une seule fonctionnalité de fond
derrière 5 remarques (#2, #4, #14, #16 ; #3 retiré le 28/06), **découpée en 2 temps**
(S6 puis S7, arbitrage utilisateur). Temps 1 = modèle de données + restitution visuelle.
**Objectifs** :
- [x] **#34** Identifiant unique par Activité — brique de fondation (micro-jalonnement,
  exports Excel/Gantt). **Précision utilisateur : uid AUTOMATIQUE, ni visible ni éditable
  pour l'instant** (≠ « champ affiché et éditable » de la spec initiale). Stable à la
  sérialisation (stocké dans `properties.uid`)
- [x] **#2** Dimension « groupe » sur l'Activité au-delà du responsable :
  WP / métier / service (combobox enrichissable dans le panneau propriétés)
- [x] **#14** Couleur associée à un groupe + mémorisation des couleurs choisies
  (registre `pertMeta.groups` persistant dans le `.pert`, réutilisable rapidement)
- [x] **#4** Harmonisation visuelle : les activités d'un même groupe partagent une teinte
  → zones par WP/métier lisibles « de loin » sur un PERT chargé
- [x] **Propagation du groupe par couleur** (ajout en cours de session, demande utilisateur) :
  bouton « Appliquer ce groupe aux tâches de même couleur » → tague d'un clic tout un lot
  importé (une couleur = un lot). Choix utilisateur : **bouton explicite** (pas d'automatisme,
  pour éviter de tagger en masse le bleu par défaut des nouvelles tâches)

**Décisions de conception figées en début de session (arbitrage utilisateur)** :
- **Modèle du groupe = combobox enrichissable** (texte libre + `<datalist>` des valeurs
  déjà saisies), PAS une liste gérée. L'utilisateur saisit le nom qu'il veut ; un nom
  déjà employé est reproposé sans ressaisie. **Même mécanisme appliqué au Responsable**
  (amorce #13) — helper `buildCombobox` réutilisable.
- **Articulation couleur/groupe = « premier venu fixe la teinte »** : la 1re activité à
  porter un nom de groupe enregistre **sa** couleur courante comme couleur du groupe
  (`pertMeta.groups[nom]`) ; les suivantes du même groupe **héritent** de cette teinte.
  Pas de 2e système de couleur : le rendu lit toujours `node.properties.color` ; le
  registre ne sert qu'à la mémoire (#14) et à la propagation (#4). Sans groupe → couleur
  individuelle inchangée (compatible avec la couleur d'import `IMPORT_COLOR_PALETTE`).
- **Propagation au changement** (point laissé « à voir », tranché ici) : changer la couleur
  d'une activité **groupée** met à jour la couleur du groupe ET recolore **tous** ses
  membres (`pertRecolorGroup`). Sans quoi le groupe diverge et l'harmonisation #4 tombe.
  Trivial à inverser (couleur figée) si retour utilisateur contraire.

**Critère de validation** :
Sur un PERT chargé, les zones par WP/métier sont identifiables d'un coup d'œil par la couleur.
**État** : implémenté et validé par test headless navigateur (`tools/smoke-s6.js` : uid
auto/unique/dédoublonnage clone+coller, premier-venu/héritage, propagation, round-trip
`.pert`) + smoke existant sans régression + contrôle du panneau (combobox Groupe/Responsable
avec datalists alimentées). **Validation visuelle utilisateur à confirmer avant merge/tag
v0.6** (même schéma que S4/S5).

**Implémentation — décisions notables (27/06/2026)** :
- **#34 uid** : généré par `pertGenUid()` (timestamp base36 + aléatoire), posé dans
  `properties.uid` du constructeur `ActivityNode` → sérialisé nativement et stable.
  `configure()` (chargement) écrase l'uid du constructeur par l'uid sauvegardé → stabilité.
  Anciens `.pert` sans uid : le constructeur en fournit un. **`clone()` et copier/coller
  recopient les `properties` → uid dupliqué** : `pertEnsureUids()` (le 1er vu conservé, les
  doublons régénérés) est appelé après Dupliquer, après collage Ctrl+V, et par sécurité au
  chargement `.pert`. Pas de champ panneau (invisible, non éditable).
- **`buildCombobox(parent, label, value, options, onInput, onCommit)`** : `<input>` +
  `<datalist>`. `onInput` à chaque frappe (mémorisation), `onCommit` à la validation
  (`change`/sélection). Pour le **Groupe**, la teinte n'est appliquée qu'à `onCommit` (pas
  à chaque frappe) pour ne pas perturber la saisie ; la valeur de l'input couleur est
  resynchronisée **sans reconstruire le panneau** (la reconstruction ferait perdre le focus).
- **Registre `pertMeta.groups`** `{ nom: couleur }` : sérialisé dans `storage.js`
  (`pertSerializeProject` + `pertApplyProject`), restauré par l'undo (`history.js` `restore`
  — le snapshot capte déjà `pertMeta` entier, mais `restore` ne réapplique que des clés
  explicites, d'où l'ajout). `pertApplyGroup` (héritage/premier-venu) et `pertRecolorGroup`
  (propagation) dans `ui.js`. `collectGroupNames`/`collectResponsibles` alimentent les datalists.
- **Articulation avec l'import** : aucun 2e système — les activités importées restent sans
  groupe (couleur d'import individuelle) ; l'utilisateur les affecte à un groupe ensuite s'il
  le souhaite, et l'héritage prend le relais. `IMPORT_COLOR_PALETTE`/`pickDefaultImportColor`
  inchangés.
- **Propagation du groupe par couleur** (`pertApplyGroupToSameColor`, bouton `.panel-action`
  dans le panneau Activité) : affecte le groupe courant à toutes les autres Activités de
  **même couleur** (`color` comparé en minuscules). Pensé pour les lots importés (1 couleur =
  1 lot) → tag d'un clic. **Bouton explicite** (et non un automatisme à la saisie du groupe) :
  décision utilisateur pour éviter de propager en masse sur le bleu par défaut des nouvelles
  tâches. Les tâches déjà dans ce groupe sont ignorées ; les autres voient leur groupe écrasé
  (action délibérée, annulable par Ctrl+Z). Le groupe est d'abord enregistré (`pertApplyGroup`)
  pour rester cohérent avec le registre. Toast récapitulatif (n tâches rattachées).

---

### Session 7 — Le couple couleur/groupe au cœur des fonctions de base ✅ TERMINÉE (28/06/2026)
Suite de S6 sur la même dimension « groupe ». **Redéfinie le 28/06/2026** (cf. ci-dessous) :
avant de bâtir le filtre, on fait d'abord exploiter le concept couleur/groupe par les
fonctions de base déjà acquises (import, réorganisation). **#3 (coût) retiré** du périmètre
S7 → reporté en long terme (décision utilisateur : pas indispensable pour un outil PERT KISS).
**Objectifs** :
- [x] **A — Import Excel conscient du groupe** : le dialogue d'import devient **centré
  groupe** (combobox enrichissable + `<datalist>` des groupes existants), avec 3 chemins :
  (1) **groupe existant** sélectionné → couleur **héritée et verrouillée** (affichée, lue
  dans `pertMeta.groups`) ; (2) **nouveau groupe** (nom non connu) → on choisit sa couleur,
  qui **devient** la couleur du groupe (« premier venu », cohérent avec S6) ; (3) **aucun
  groupe** (champ laissé vide) → on choisit juste une couleur, tâches importées **sans
  groupe** (comportement actuel préservé). **Un seul groupe par lot** d'import (retag
  possible après coup via le bouton « Appliquer ce groupe aux tâches de même couleur » de S6).
  Remplace `promptImportColor` par `promptImportGroup` ; les Activités importées sont
  rattachées au groupe via `pertApplyGroup` (héritage/premier-venu), pas un 2e système de couleur.
- [x] **B — Réorganisation cohésive (couloirs groupés)** : `pertAutoLayout` conserve
  **l'abscisse ∝ ES inchangée** (cohérence temporelle façon Gantt intacte) ; seule
  **l'affectation des couloirs verticaux** devient **consciente du groupe** → les tâches
  d'un même WP/groupe se posent sur des **couloirs voisins** (zones de couleur lisibles
  « de loin », objectif #4 préservé après réorg). Best-effort : la non-superposition reste
  prioritaire. Tâches **sans groupe** packées normalement. Pas de bandes horizontales par
  groupe (calage temporel conservé — décision utilisateur du 28/06).
- [x] **C — #16 Filtrer / mettre en évidence** par WP/métier/service **ou par couleur** —
  arrive **après** A+B (qui l'ont rendu pertinent), même session (périmètre S7 confirmé
  « tout dans S7 » le 28/06).

**Décisions de conception figées le 28/06/2026 (arbitrage utilisateur, avant implémentation)** :
- **Ordre du chantier** : socle (import + réorg conscients du groupe) **avant** le filtre.
  L'utilisateur veut que les fonctions déjà acquises exploitent couleur/groupe d'abord.
- **Import centré groupe** (pas centré couleur) mais avec **échappatoire « aucun groupe »**
  (couleur seule) **et** création de groupe à la volée — les 3 chemins ci-dessus.
- **Réorganisation = couloirs groupés**, X = temps **conservé** (pas de relâchement du
  calage temporel pour faire des bandes). Le groupe ne joue que sur la dimension verticale.
- **#3 (estimation de coût) retiré** de S7 → long terme (cf. bloc « Long terme / écarté »).

**Critère de validation** :
À l'import, on choisit/crée un groupe (ou pas) et la couleur en découle ; après
« Réorganiser », les zones par WP/couleur restent groupées visuellement ; l'utilisateur
isole/met en évidence un WP ou une couleur via le filtre.
**État** : implémenté et validé par test headless navigateur (`tools/smoke-s7.js` : import
3 chemins A, bandes de groupe disjointes + X∝ES préservé B, estompage groupe/couleur C) +
smoke existant sans régression + captures de contrôle (couloirs groupés orange/turquoise,
filtre estompant le hors-groupe). **Validation visuelle utilisateur à confirmer avant
merge/tag** (même schéma que S4/S5/S6).

**Implémentation — décisions notables (28/06/2026)** :
- **A — `promptImportGroup` remplace `promptImportColor`** : combobox groupe + `<datalist>`
  (`collectGroupNames`) au-dessus du sélecteur de couleur existant. Une note dynamique et le
  verrouillage du sélecteur (`picker.disabled` + `.color-swatches.locked`) reflètent le chemin
  actif en temps réel (lecture de `pertGroups()[nom]` à chaque frappe). `applyImportModel(model,
  importColor, importGroup)` : si un groupe est fourni, chaque Activité reçoit `group` puis
  `pertApplyGroup` tranche la couleur (héritée si groupe connu, fixée sinon) — **l'héritage prime
  sur `importColor`** (un groupe existant impose toujours sa teinte). Sans groupe : couleur libre,
  aucune écriture dans le registre.
- **B — `pertPackLanesGrouped` + `pertGroupKey`** (dans `pert_engine.js`) : remplace l'appel
  direct à `pertPackLanes` pour le bloc `rest`. Partitionne par groupe, **empile une bande de
  couloirs par groupe** (triées par X min = ES min, puis nom ; bande « sans groupe » `""` en
  dernier). `xOf` (∝ ES) **jamais modifié** → seul Y change. **Non-régression par construction** :
  sans groupe, une seule bande `""` → packing identique à l'ancien. Les jalons terminaux restent
  dans leur bande haute séparée (inchangé) ; les jalons intermédiaires tombent dans la bande `""`.
- **C — filtre = état de vue `window.pertFilter`** (`null | {type:"group"|"color", value}`),
  **non sérialisé**. Rendu : `pertNodeDimmed(node)` + `pertDrawDimVeil(ctx, node)` dans `nodes.js`,
  **voile translucide dessiné en `onDrawForeground`** (donc par-dessus contenu ET slots, l'avant-plan
  étant rendu en dernier par LiteGraph). Seules les Activités peuvent « correspondre » ; Jalons et
  Labels sont estompés dès qu'un filtre est actif (ils ne portent pas la dimension groupe/couleur).
  Comparaison couleur insensible à la casse.
- **C — menu déroulant CUSTOM à pastilles de couleur** (retour utilisateur, 29/06) : un code hexa
  ne parle à personne ET **les `<option>` natives n'affichent pas de couleur de fond sous Firefox**
  (navigateur par défaut de l'utilisateur) → le `<select>` est remplacé par un menu maison
  (`#filter-trigger` + `#filter-menu` dans la toolbar). Chaque ligne (`buildFilterRow`) porte une
  **vraie pastille de couleur** (`buildFilterSwatch`, `<span>` au fond coloré, motif hachuré pour
  « aucun ») + un **libellé parlant** : nom du groupe, ou pour une couleur le(s) groupe(s) qui la
  portent (ou « Sans groupe » pour un lot importé, `pertColorGroupLabel`). 100% DOM/CSS → rendu
  identique sur tous les navigateurs (Firefox inclus), sans dépendance (`file://`). Le déclencheur
  reflète le filtre courant (pastille + libellé, `updateFilterTrigger`). Ouverture/fermeture :
  `toggleFilterMenu`/`closeFilterMenu` (clic extérieur + Échap) ; `refreshFilterOptions` reconstruit
  les lignes à chaque ouverture et après import, et **invalide un filtre obsolète**
  (`pertFilterStillValid` : groupe supprimé / couleur disparue → retour à « aucun »). Le toast de
  filtre est aussi « parlant » (plus de hexa).

---

### Correctifs pré-Session 8 — Jalons entrants & mois calendaires ✅ TERMINÉS (29/06/2026, tag v0.9)
Deux bugs majeurs traités avant d'ouvrir la S8 (branche `fix/jalons-entrants-mois-calendaires`).
**Objectifs** :
- [x] **Jalons entrants** : un Jalon sans lien entrant + avec lien sortant + date-cible
  fixe le démarrage de la chaîne aval (contrainte externe) au lieu de partir à T0.
  Règle réutilisant le Jalon existant (pas de nouveau type), branchée dans le forward pass.
  **+ Import legacy** : les nœuds `E` (« Jalon entrée »), auparavant ignorés et leurs arêtes
  supprimées, sont matérialisés en Jalons entrants avec arêtes conservées.
- [x] **Calcul en mois calendaires réels** : l'unité « mois » calculait en jours avec
  l'approximation 30 j → dérive importante sur projets longs. Conversion unité↔date
  refondue (`pertAddUnits`, `Date.setMonth`) ; jours/semaines déjà exacts, seul le mois
  était fautif. Moteur interne inchangé (toujours en unités abstraites).

**Décisions utilisateur (29/06)** : import des `E` = **tous matérialisés** en jalons
entrants (y compris celui à T0) ; date-cible antérieure à T0 = **plancher à T0** (ES=0).

**État** : implémenté, validé par test headless pur Node (28 assertions : conversion mois
calendaire + round-trip exact, semaines/jours inchangés ; règle jalon entrant avec cas
limites — terminal/sans-date/date<T0/checkpoint ; matérialisation E + non-régression import).
**Validation visuelle navigateur confirmée** (import réel `C_PERT_exemple.xlsm` avec le nœud
`E1020` « Jalon entrée » + planning mois sur plusieurs années). **Mergé sur `main`, tagué `v0.9`,
poussé** (rituel de fin de session : bundle régénéré `--tag v0.9` et versionné).

**Implémentation — décisions notables** :
- **Localisation chirurgicale** : bug mois = 2 fonctions (`pertOffsetToDate`/`pertDateToOffset`
  + helper `pertAddUnits`/`pertDaysInMonth`) ; règle jalon entrant = ~6 lignes dans le forward
  pass ; import E = uniquement la fonction pure `buildImportModel` (`applyImportModel` gère déjà
  le type `milestone` + ses arêtes de façon générique → aucun changement UI).
- **Invariant conservé** : `offset→date` et `date→offset` restent exacts inverses pour un offset
  entier de mois (indispensable à la comparaison `due_date` ↔ valeur calculée).
- **Effet de bord assumé** : un jalon entrant a `EF = due_date` et son LF est borné à cette même
  date → marge 0 → marqué critique (un point d'entrée à date fixe ne peut pas glisser). Pas de
  fausse alerte `target_missed` (EF == due_date).

### Session 8 — Propriétés & jalons enrichis ✅ TERMINÉE (30/06/2026)
Sur la branche `session/8-proprietes-jalons`. **Tags décalés : cette session sera `v0.10`**
(v0.9 = correctifs pré-S8).
**Objectifs** :
- [x] **#12** Champ texte libre dans les propriétés d'Activité (hypothèses de durée,
  contenu réel de la tâche) — `properties.notes`, **panneau uniquement** (jamais rendu
  sur le nœud, décision utilisateur : la note peut être longue)
- [x] **#13** Liste des responsables déjà saisis, proposée à la sélection (orthographe
  cohérente) — **déjà livré en S6** via `buildCombobox` + `collectResponsibles` (datalist
  alimentée par les valeurs existantes) ; confirmé et couvert par test en S8
- [x] **#17** Tag de type sur les Jalons : aucun / DOTD / COTD / Ingénierie — **pastille
  colorée + texte** sous le libellé (décision utilisateur), couleur propre par type
  INDÉPENDANTE du code couleur de tenue de cible (#20)
- [x] **#18** Largeur ∝ durée rendue **optionnelle** — case à cocher dans le dialogue
  **Paramètres** (décision utilisateur), `meta.prop_width` (défaut true), sérialisée

**Critère de validation** :
Propriétés enrichies utilisables ; jalons taggables ; largeur proportionnelle désactivable.
**État** : implémenté et validé par test headless navigateur (`tools/smoke-s8.js` : note par
défaut/panneau-seul/round-trip, `collectResponsibles` dédoublonné+trié, tag défaut/lookup/
taille/indépendance targetState/round-trip, prop_width on→off→on réversible + round-trip) +
smoke existant sans régression + captures de contrôle (4 jalons taggés DOTD/COTD/Ingénierie/
aucun, dialogue Paramètres avec la case). **Validation visuelle utilisateur à confirmer avant
merge/tag v0.10** (même schéma que S4–S7).

**Décisions de conception (arbitrage utilisateur, en ouverture de session)** :
- **#17 affichage** = pastille colorée + texte (chip) sous le libellé — distincte du
  rouge/vert/orange de tenue de cible (porté par corps/bordure/coin).
- **#18 emplacement** = case à cocher dans le dialogue Paramètres (préférence projet
  sérialisée, cohérent avec `layout_gap`), PAS un bouton toolbar.
- **#12 portée** = panneau propriétés uniquement (jamais sur le nœud).

**Implémentation — décisions notables (30/06/2026)** :
- **#12** : `properties.notes` (défaut `""`), `buildTextarea` dans le panneau Activité. Pas
  de `updateSize`/`setDirtyCanvas` dans le handler (la note n'affecte pas l'apparence du
  nœud). `buildTextarea` appelle désormais `pertHistoryMark()` (coalescence) → la note ET
  le texte de Label deviennent undoables par cran de saisie.
- **#17** : registre `PERT_MILESTONE_TAGS` (nodes.js, source unique : `[{value,label,color}]`,
  ordre = ordre du menu) + helper `pertMilestoneTag(value)` (null si vide/inconnu, robuste
  aux anciens .pert). `properties.tag` (`"" | "DOTD" | "COTD" | "ING"` — codes ASCII, le label
  accentué « Ingénierie » n'est qu'un libellé d'affichage). `MilestoneNode.updateSize` réserve
  une ligne (~20px) et élargit le nœud si la pastille est plus large ; rendu dans
  `onDrawBackground` (rectangle arrondi plein + texte blanc) entre le libellé et la ligne
  « Fin ». Le panneau utilise `buildSelect` (nouveau helper) avec options dérivées de
  `PERT_MILESTONE_TAGS`. **Le tag n'affecte ni le calcul PERT ni `targetState`** (vérifié par test).
- **#18** : `meta.prop_width` (défaut true). `ActivityNode.updateSize` lit
  `window.pertMeta.prop_width` : si `false`, largeur figée à `ACT_MIN_W` (boîtes uniformes) ;
  sinon comportement S2.5 (∝ durée). **Le placement chronologique du layout (abscisse ∝ ES)
  reste inchangé** — seule la largeur du nœud varie. `saveSettings` réapplique `updateSize` sur
  tous les nœuds. Sérialisé dans `storage.js` (+ défaut true pour anciens fichiers) et restauré
  par l'undo (`history.js`).
- **`buildSelect(parent, label, value, options, onChange)`** : nouveau helper liste déroulante
  simple (label + `<select>`), marque l'historique au changement. Réutilisable au-delà du tag.

---

### Session 8.5 — Estimation des coûts ✅ TERMINÉE (30/06/2026)
Session **intercalée avant la S9** (sur le modèle de S2.5) à la demande de l'utilisateur :
réintroduction de **#3 (estimation de coût)**, qui avait été retiré de S7 le 28/06 et classé
« long terme ». Branche `session/8.5-estimation-couts`. **Tag `v0.11`** (S9 décalée à `v0.12`).
**Objectifs** :
- [x] **2 informations de coût par Activité** : **ETP** (Equivalent Temps Plein, **modifiable**)
  + **estimation financière** (**non modifiable**, = durée en heures × ETP × taux, en k€)
- [x] **Paramètres de coût** dans le dialogue Paramètres : heures/mois, heures/jour
  (semaine = 5×), taux horaire moyen — modifiables, sérialisés
- [x] **Barre d'état** : coût total du projet en k€ (**limité aux tâches visibles** si filtre
  actif) + coût du **chemin critique** courant en k€

**Décision utilisateur structurante** : **on ne surcharge pas l'affichage graphique** — ETP et
coût restent dans le **panneau latéral** (+ agrégats en barre d'état), JAMAIS sur le nœud,
« cohérent d'un PERT qui de base n'est pas un outil de chiffrage ». Défauts entreprise fournis
par l'utilisateur : **135 h/mois · 8 h/jour · 136 €/h**.

**Critère de validation** :
Saisir un ETP, lire le coût d'une tâche et les agrégats projet/chemin critique ; vérifier que
le filtre limite bien le total aux tâches visibles.
**État** : implémenté et validé par test headless navigateur (`tools/smoke-s85.js` : formule par
unité j/sem/mois, ETP défaut/0, jalon sans coût, total filtré vs non filtré, coût chemin critique,
round-trip `.pert` de l'ETP + des paramètres) + smoke existant sans régression + captures de
contrôle (panneau ETP+coût, dialogue Paramètres, barre d'état). **Validation visuelle utilisateur
à confirmer avant merge/tag v0.11** (même schéma que S4–S8).

**Implémentation — décisions notables (30/06/2026)** :
- **Formule** : `pertActivityCost(node)` (euros) + `pertDurationToHours(duration, unit, meta)` +
  `pertFormatCost(euros)` (k€, notation FR `toLocaleString`) dans `pert_engine.js`. Conversion
  durée→heures **dépendante de l'unité** ; mois = paramètre indépendant (pas dérivé du jour),
  semaine = 5×jour. Coût **non stocké** (dérivé, comme es/ef) → toujours cohérent avec les paramètres.
- **`properties.etp`** (défaut 1) sur l'Activité ; édité par un `buildField` number (panneau).
  L'ETP **n'affecte pas l'ordonnancement** → son handler appelle `fillCalcSection` (rafraîchit le
  coût) mais **pas `pertRecalc`**. Coût affiché en lecture seule dans `fillCalcSection` (`buildReadonly`).
- **Barre d'état** : nouveau `#status-cost`, alimenté dans `updateStatus` (déjà appelé toutes les
  600 ms via `setInterval` → reflète en continu édition d'ETP, paramètres, filtre, recalcul, sans
  câbler chaque événement). Total = Activités **visibles** (`!pertNodeDimmed`), libellé « Coût
  visible » si filtre actif sinon « Coût total » ; critique = Activités `is_critical`.
- **Paramètres** : `meta.hours_per_month/hours_per_day/hourly_rate` (défauts 135/8/136), groupés
  dans un `<fieldset class="settings-group">` du dialogue Paramètres. Sérialisés (`storage.js`,
  défauts pour anciens `.pert`) + restaurés par l'undo (`history.js`).

**Correctif chemin critique (retour utilisateur, 30/06/2026)** — l'utilisateur a relevé deux
défauts à la première version :
- **Coût ≠ chemin tracé** : la barre d'état utilisait `is_critical` (chemin global invariant)
  alors que le tracé rouge des liens suit la sélection (#7) → divergence. `pertHighlightCriticalPath`
  mémorise désormais l'ensemble des nœuds du chemin **réellement mis en évidence**
  (`window.pertCriticalPathIds`) — chemin contraignant de la sélection, ou marge minimale
  (`is_critical`) sans sélection (la **demande utilisateur explicite** : « sans sélection → chemin
  de marge minimale »). La barre d'état (coût + nombre) en dérive → toujours cohérente avec le
  rouge. La fonction a aussi été refactorée : le **mode défaut** colore les liens contraignants
  entre nœuds `is_critical` (avant : remontée depuis le nœud d'EF max, qui pouvait diverger du
  chemin de marge minimale en projet infaisable). `pertHighlightCriticalPath` appelle `updateStatus`
  en fin → la barre suit la sélection sans attendre le tick 600 ms.
- **Comptage des jalons** : le nombre de nœuds du chemin critique (et du projet) incluait les
  Jalons, peu pertinents (contraintes/sorties, pas d'action possible). On ne compte plus que les
  **tâches** (Activités) : `#status-cost` « Chemin critique : N tâche(s), X k€ », `#status-nodes`
  « N tâche(s) ». `pertPublishStatus` (`#status-pert`) ne porte plus le compte critique (déplacé
  dans `updateStatus`, conscient de la sélection) — il ne garde que « Fin projet ».

---

### Correctifs pré-Session 9 — Import (marge « ? ») & sélecteur de groupe ✅ TERMINÉS (01-02/07/2026, tags v0.12 puis v0.12.1)
Deux bugs remontés par l'utilisateur, traités avant d'ouvrir la S9 (branche
`fix/import-marge-et-selecteur-groupe`). Même modèle que les correctifs pré-S8.
**Numérotation patch introduite ici** : `v0.12` = 1re passe (import + retrait `autocomplete="off"`
côté Firefox) ; **`v0.12.1`** = 2e passe après retour utilisateur (« même souci sous Edge ») =
remplacement du `<datalist>` par un menu déroulant custom (cf. sélecteur ci-dessous).
**Objectifs** :
- [x] **Import : durée fausse (« 1 mois ») sur les tâches à marge indéterminée** — dans
  C-PERT le champ durée/marge peut valoir `2/?` (marge non calculée). Le sélecteur
  `findValueText` (`import_excel.js`) exigeait un chiffre après le `/` → `2/?` ignoré, puis
  **repli sur la date de la tâche** (`01/11/2026`) dont `01/11` matchait le motif → durée lue
  = `01` = 1. Corrigé par un motif **ancré** acceptant `?` :
  `/^-?\d[\d,]*\s*\/\s*(-?[\d,]+|\?)$/`. L'ancrage `^…$` empêche la confusion avec une date
  (deux slashes). La durée reste le 1er membre (`parseDurationField`), seule la marge tolère `?`.
- [x] **Sélecteur de groupe (panneau) inutilisable pour choisir parmi les groupes créés** —
  **DEUX causes distinctes**, le `<datalist>` natif étant inadapté au cas « choisir parmi les
  valeurs existantes » : (1) **Firefox** — `autocomplete="off"` sur les `<input>` du combobox
  **supprime le menu déroulant du `<datalist>`** ; (2) **Edge/Chrome** — le `<datalist>` natif
  **filtre les suggestions par la valeur COURANTE du champ** : rouvrir une activité déjà groupée
  « WP1 » ne propose plus que « WP1 », jamais les autres groupes. Corrigé en **remplaçant le
  sélecteur par un menu déroulant CUSTOM** (bouton « ▾ » + liste), même pattern que le menu de
  filtre S7 (déjà adopté pour la même raison : listes natives non fiables cross-navigateur). Le
  menu affiche **tous** les groupes (pastille de couleur de chacun via `pertGroups()`), identique
  sur Firefox/Edge/Chrome ; le champ texte reste pour saisir un **nouveau** groupe (un `<datalist>`
  discret est conservé pour l'autocomplétion à la frappe, en complément). Appliqué aussi au
  **Responsable** (helper `buildCombobox` commun, param `config` optionnel `{optionsProvider,
  swatchFor}`). `autocomplete="off"` retiré au passage. Logique de collecte/héritage des groupes
  inchangée (déjà correcte).

**Validation** : import `C_PERT_exemple_2.xlsm` → durées **2 / 3 / 6 / 3** (conformes à
`test_cases/exemple2.png`, champs `2/?`, `3/?`, `6/1`, `3/?`) ; non-régression import
`C_PERT_exemple.xlsm` (durées `1,9` conservées) ; le menu custom liste **tous** les groupes
même quand le champ contient déjà une valeur (cas qui piégeait la datalist Edge/Chrome), avec
pastilles de couleur, sélection → héritage de teinte OK (capture de contrôle) ; smoke S6 + S7 +
smoke général sans régression (Playwright/Chromium). **Numérotation : v0.12 puis patch v0.12.1**
(v0.11 = S8.5) → la Session 9 sera **v0.13**.

---

### Correctifs pré-Session 9 (suite) — Ergonomie & filet anti-crash ✅ TERMINÉS (02-03/07/2026, tag v0.12.2)
Trois évolutions d'ergonomie demandées par l'utilisateur avant d'ouvrir la S9 (branche
`fix/centrage-toolbar-zoom-autosave`). **3e passe patch : `v0.12.2`** (v0.12.1 = sélecteur de
groupe). La Session 9 reste **v0.13**.
**Objectifs** :
- [x] **Placement au centre de l'espace visible** — les nœuds créés via les boutons de la
  toolbar apparaissaient décalés : `getCanvasCenter` utilisait une conversion écran→graphe
  fausse (`(cx - offset)/scale` au lieu de `cx/scale - offset`, cf.
  `DragAndScale.convertCanvasToOffset`), fautive dès que le zoom ≠ 1 ; le nœud était de plus
  posé par son **coin haut-gauche**. Corrigé (formule + retrait de la demi-taille → centre
  réel) ; les 3 boutons passent désormais par le helper `addNodeAt` (taille calculée d'abord).
  Le clic droit « Ajouter » reste posé **sous le curseur** (inchangé).
- [x] **Toolbar accessible à toute résolution** — à certaines résolutions la toolbar
  débordait horizontalement, rendant des boutons inaccessibles (aucun mécanisme de
  débordement). Passage en **`flex-wrap: wrap`** + `min-height: 42px` : la barre s'étale sur
  plusieurs lignes en largeur contrainte au lieu de rogner des boutons. Zéro JS, sans casser
  le menu Filtre (positionné en absolu) ni le canvas (recalculé par le handler `resize`).
- [x] **Zoom −/+ (boutons toolbar)** — sans molette ni pavé tactile multipoint, le zoom
  (Ctrl+scroll natif) était inaccessible. Boutons **`➖`/`➕`** encadrant « Tout afficher »,
  câblés sur `changeScale` natif (helper `pertZoomBy`, facteur ×1,2, **clamp [0,1 ; 10]**,
  recentrage sur le milieu du canvas visible).
- [x] **Sauvegarde automatique (filet anti-crash)** — de rares plantages faisaient perdre le
  travail. **Contrainte `file://`** : impossible d'écrire un `.pert` silencieusement (pas de
  serveur ; téléchargement seulement sur action utilisateur). → **snapshot de récupération
  dans `localStorage`** (même stockage que le presse-papier LiteGraph), écrit périodiquement
  (8 s) tant qu'il reste du travail non sauvegardé, **proposé à la restauration au démarrage**
  via un dialogue après un plantage. **ACTIVÉ PAR DÉFAUT** (décision utilisateur), désactivable
  dans Paramètres, sérialisé **par projet**. Ne remplace PAS le `.pert` (filet, pas sauvegarde).

**Décisions notables (02/07/2026)** :
- **Le seul mécanisme viable en `file://`** est `localStorage` (pas d'écriture disque). Le
  snapshot n'est effacé que par une vraie sauvegarde `.pert`, un chargement, ou « Ignorer »
  → le dialogue de démarrage ne s'affiche que pour du **vrai travail non sauvegardé** (jamais
  après une session propre sans édition). Un **simple F5 ne l'efface pas** (utile pour tester).
- **Gating par séquence de changements** (`changeSeq`/`savedSeq`/`writtenSeq` dans
  `src/autosave.js`) : `pertHistoryMark` incrémente `changeSeq` (`pertAutosaveTouch`), une vraie
  sauvegarde/chargement cale `savedSeq` (`pertAutosaveMarkSaved`) et efface le snapshot → un
  snapshot n'existe que si `changeSeq > savedSeq`. Écriture périodique (`setInterval` 8 s) +
  flush best-effort sur `beforeunload`.
- **Robustesse** : tout accès `localStorage` sous `try/catch` (quota/indisponible → toast
  unique, jamais bloquant) — si un navigateur DSI bloquait le stockage, l'autosave se
  désactive proprement sans casser l'app.
- **Activé par défaut** = sémantique « défaut vrai » (`autosave !== false`) partout où la clé
  peut être absente (init `meta`, chargement d'anciens `.pert`, restauration undo) ; un `false`
  explicite reste respecté et sérialisé.
- **Bundle** : `src/autosave.js` inliné automatiquement (regex du builder), aucune modif de
  `scripts/build-bundle.js` nécessaire.

**Validation** : tests headless navigateur (Playwright/Chromium, `file://`) — `tools/smoke-center-toolbar.js`
(centrage exact à scale=0,5+pan, zoom monotone+clamp, toolbar enroulée à 720px avec « À propos »
cliquable) + `tools/smoke-autosave.js` (aucun snapshot à froid, écriture après édition, dialogue
de récupération au reload, Restaurer→2 nœuds+snapshot effacé, Ignorer→vierge, round-trip
`meta.autosave` + défaut `true` pour anciens fichiers) + smoke général sans régression.
**Validée par l'utilisateur** avant clôture (rituel de fin de session : bundle `--tag v0.12.2`
régénéré + versionné). La Session 9 sera **v0.13**.

---

### Correctifs pré-Session 9 (suite 2) — Filtre : voile sombre & axe responsable ✅ TERMINÉS (05/07/2026, tag v0.12.3)
Deux petites évolutions du filtre demandées par l'utilisateur (« à gérer en indice mineur »)
avant d'ouvrir la S9. **4e passe patch : `v0.12.3`** (v0.12.2 = ergonomie & autosave). La
Session 9 reste **v0.13**.
**Objectifs** :
- [x] **Voile d'estompage cohérent avec le thème sombre** — le filtre (#16, S7) estompait les
  nœuds hors sélection avec un voile **clair** `rgba(248,249,251,0.78)` (quasi blanc), incohérent
  sur le thème sombre de l'app. Repassé en voile **sombre** `rgba(18,18,42,0.72)` aligné sur le
  fond du canvas (`#12122a`) : les tâches masquées sont *assombries* au lieu d'être blanchies.
  Un seul point de changement (`pertDrawDimVeil` dans `nodes.js`) → bénéficie à tous les nœuds
  estompés (Activités/Jalons/Labels).
- [x] **Filtre par responsable** — nouveau 3e axe `{ type:"responsible", value }`, **symétrique**
  aux filtres groupe/couleur existants (aucune refonte). Le responsable n'ayant pas de couleur
  associée, il s'affiche dans le menu avec une **pastille icône 👤** (au lieu d'un carré coloré).

**Décision de conception** : extension **par symétrie stricte** du motif de filtre S7 (menu
déroulant custom à pastilles, déjà adopté pour la fiabilité cross-navigateur) — surface de
risque minimale, réutilise `collectResponsibles()` (déjà présent depuis S6 pour la datalist
Responsable). Le filtre reste un **état de vue** `window.pertFilter` **non sérialisé**.

**Implémentation — décisions notables (05/07/2026)** :
- **Voile** : `pertDrawDimVeil` (`nodes.js`) — seule la couleur de remplissage change.
- **`pertNodeDimmed`** (`nodes.js`) : branche `f.type === "responsible"` → estompe si
  `properties.responsible` (trim) ≠ valeur du filtre. Seules les Activités portent un responsable
  → Jalons/Labels estompés dès qu'un filtre responsable est actif (comme pour groupe/couleur).
- **`ui.js`** : `pertFilterStillValid` (invalide si le responsable a disparu du graphe),
  `refreshFilterOptions` (section « Responsables » entre Groupes et Couleurs, alimentée par
  `collectResponsibles()`), `updateFilterTrigger` + `applyFilter` (toast) gèrent le cas
  responsable. `buildFilterSwatch(color, icon)` et `buildFilterRow(filter, label, color, icon)`
  reçoivent un param **icône** optionnel (👤) pour une dimension sans couleur.
- **`css/style.css`** : `.filter-swatch.icon` (glyphe centré, sans cadre ni fond).

**Validation** : `tools/smoke-s7.js` (non-régression du filtre groupe/couleur) + vérification e2e
dédiée du nouvel axe (dimming Alice vives / Bob+sans-responsable estompés, `collectResponsibles`
dédoublonné+trié, section « Responsables » + pastille 👤 dans le menu, validité Alice/absent,
déclencheur « 👤 Bob ») — Playwright/Chromium `file://`, 0 erreur console. **Validée par
l'utilisateur** avant clôture (rituel : bundle `--tag v0.12.3` régénéré + versionné). La Session 9
sera **v0.13**.

---

### Session 9 — Exports avancés ✅ TERMINÉE le 05/07/2026 (tag **v0.13**)

> **État au 05/07/2026** : les 6 formats sont implémentés, validés par tests headless
> navigateur (Playwright/Chromium, `file://`) contre les fichiers d'exemple réels — voir
> « Implémentation » en fin de section — **et validés visuellement par l'utilisateur**.
> Branche `session/9-exports-avances`, mergée sur `main`, taguée **v0.13** (rituel de fin
> de session appliqué : bundle `--tag v0.13` régénéré + versionné). La spec détaillée
> ci-dessous reste la référence.

> **Concept d'export approfondi avec l'utilisateur le 05/07/2026, AVANT ouverture de la
> session** (pour reprise sereine même après interruption). Cette section est
> **auto-suffisante** : formats décodés depuis les fichiers d'exemple + décisions figées +
> architecture + ordre de livraison. Fichiers d'exemple dans `test_cases/` (NON versionnés) :
> source `pert_a_exporter.pert` → attendus `gantt_charge.xlsx` et `microjalons.xlsx`.

**Refonte du concept (demande utilisateur)** : remplacer les boutons `🖼 PNG` / `📄 PDF`
de la toolbar par **UN SEUL bouton « ⬇ Exporter »** ouvrant une **fenêtre de choix du
format**. PNG et PDF (fonctions existantes inchangées) sont appelés depuis cette fenêtre.

**Formats proposés dans la fenêtre** :
- [ ] **PNG** — existant (`pertExportPNG`), juste déplacé dans la fenêtre.
- [ ] **PDF** — existant (`pertExportPDF`), idem.
- [ ] **CSV** — séparateur `;`, format « raw » (un nœud par ligne).
- [ ] **Gantt chargé — Excel** (#33) — diagramme de charge `.xlsx`.
- [ ] **Micro-jalonnement — Excel** (#21) — template de suivi `.xlsx`, s'appuie sur l'uid (#34).
- [ ] **Gantt MS Project** — fichier **MSPDI XML** (`.xml`) importable par MS Project.

#### Décisions figées (arbitrage utilisateur du 05/07/2026, via AskUserQuestion)
- **Fidélité XLSX = fichier propre minimal** : mêmes colonnes / données / dates / couleurs de
  groupe que les exemples, mais **SANS** les artefacts du template de l'utilisateur (listes
  déroulantes de « Statut », liens externes vers un autre classeur, commentaires VML). Ces
  exemples sont ses fichiers de suivi réels ; on n'en reproduit que la **structure logique**.
- **MS Project = MSPDI XML** : **aucune lib JS navigateur, MIT et offline, n'écrit du `.mpp`
  natif** (binaire propriétaire). On génère à la main du **MS Project XML (MSPDI, `.xml`)**,
  importable nativement par Project — zéro dépendance, 100% offline, compatible MIT. Même
  logique que le Gantt chargé **+ les liens de dépendance**.
- **Granularité du Gantt = suivre l'unité du projet** (`meta.unit` : jour / semaine / mois) —
  PAS toujours au mois. ⚠️ **Garde-fou obligatoire** : un projet en jours étalé sur des mois
  peut produire des centaines de colonnes → **plafonner le nombre de colonnes** (proposition :
  ~400) avec toast d'avertissement, plutôt qu'un fichier ingérable.

#### Contraintes techniques (rappel `file://` + MIT — cf. CONTEXTE PROJET)
- Un `.xlsx` est un **ZIP de fichiers XML** → **mini-writer maison sur `fflate`** (déjà
  présent, MIT ; même lib que l'import). **PAS de SheetJS** (Apache-2.0, exclu par « MIT
  uniquement »). Le writer produit : `[Content_Types].xml`, `_rels/`, `xl/workbook.xml`,
  `xl/worksheets/sheet1.xml`, `xl/styles.xml`, `xl/sharedStrings.xml`. Styles nécessaires :
  format date (`mmm-yy` pour le Gantt, `d-mmm-yy` pour les micro-jalons), format nombre
  `0.00`, **fills** de couleur (barres Gantt), gras (en-têtes). Formules `=SUM(...)` supportées
  (cellule `<f>` + type numérique).
- MSPDI = **XML pur** écrit à la main (aucune lib), sérialisé en `.xml` téléchargé.
- Téléchargement via `<a download>` (comme PNG/PDF) — **destination = dossier Téléchargements
  du navigateur** (#7 : pas de sélecteur de chemin en `file://`, à **expliciter** dans la
  fenêtre, ne pas promettre un choix de dossier).

#### Formats décodés (spécification précise, tirée des exemples)

**A. Gantt chargé (`gantt_charge.xlsx`)** — diagramme de charge :
- Colonnes fixes : `A`=Tâche, `B`=Groupe, `C`=Responsable. Puis **une colonne par période**
  (unité projet) de **T0 jusqu'à la fin de projet** ; en-tête = date de début de période
  (format `mmm-yy` en mensuel), **gras**. `D1` = T0 (première date = T0).
- **Sections** repérées par un libellé en colonne A, dans l'ordre :
  1. `Jalons d'entrée` (jalons entrants — sans lien entrant),
  2. `Tâches` (activités),
  3. `Jalons de sortie` (jalons terminaux / intermédiaires),
  4. `total charge` = ligne de **`=SUM(col2:col_avant_total)`** par colonne de période.
- **Valeur d'une cellule période** pour une Activité = son **ETP**, placé sur **chaque
  période active** (de ES à EF exclu), format `0.00`, **cellule remplie à la couleur du
  groupe** (`meta.groups[group]` ou `properties.color`) → effet « barre de Gantt ».
- **Jalon** = valeur `0` dans la seule colonne de sa date.
- **Tri des tâches** : par **groupe** puis par **ES croissant** (vérifié : sys = Act 3 puis
  Act 2 ; algo = Act 1 puis Act 4).
- Exemple validé sur `pert_a_exporter.pert` (T0=2026-07-01, unité mois) : `Activité 3`
  (etp 1, sys) → `1` d'août-26 à janv-27 ; `Activité 2` (etp 0,75) → `0,75` nov→janv ;
  `Activité 4` (etp 2, algo) → `2` févr→avr-27 ; jalons d'entrée/sortie = `0` sur leur mois.

**B. Micro-jalonnement (`microjalons.xlsx`)** — une ligne par nœud dans le template de suivi.
En-têtes (ligne 1, fond vert clair) : `Num | Jalon | Destinataire | Resp. | LOT | Date
baseline | Date prévue Actuelle | Replan proposée | dates Replan | Statut | Date réalisée |
Ecart entre réalisé et baseline (j) | Jalon Majeur | Commentaires | Filtre1 | Filtre2 |
Filtre3 | Filtre pour jalons majeurs | LIBELLE JALON MAJEUR`. Remplissage à l'export :
- `Num` = **compteur par LOT/groupe** au format `<groupe>_NN` (ex. `sys_01`, `sys_02`,
  `algo_01`…), **uniquement pour les Activités** ; **vide** pour les jalons. (NB : ce `Num`
  n'est PAS l'uid #34 — c'est un numéro séquentiel par groupe, calculé à l'export dans le
  même ordre de tri que le Gantt : groupe puis ES.)
- `Jalon` = libellé ; `Resp.` = responsable ; `LOT` = groupe ; `Destinataire` = vide.
- `Date baseline` = `Date prévue Actuelle` = **EF** (fin de tâche) pour une Activité, ou la
  **date du jalon** pour un jalon. Format `d-mmm-yy`.
- **`Jalon Majeur`** = **`GOLDEN`** si tag jalon DOTD ou COTD, **`SILVER`** si tag Ingénierie
  (`ING`), vide sinon. `LIBELLE JALON MAJEUR` = recopie du libellé quand major (GOLDEN/SILVER).
- Toutes les autres colonnes de suivi (`Statut`, `Replan`, `Ecart`, `Filtre1..3`, etc.)
  restent **vides** (remplies plus tard par l'utilisateur) — on ne recrée PAS les listes
  déroulantes / liens externes du template (cf. « fidélité minimale »).
- Ordre des lignes = même tri que le Gantt : jalons d'entrée, puis activités groupées par LOT,
  puis jalons de sortie.

**C. MS Project (MSPDI `.xml`)** — même modèle temps/charge que le Gantt chargé **+ liens** :
- Une `<Task>` par nœud (activités ET jalons ; jalon = `<Milestone>1</Milestone>`,
  `<Duration>0`). Dates `<Start>`/`<Finish>` = ES/EF calendaires ; `<Work>` = charge (ETP ×
  durée convertie, à caler sur la même logique que `pertDurationToHours`/le Gantt).
- **Liens de dépendance** = `<PredecessorLink>` sur chaque tâche (type FS, `Type=1`),
  reconstruits depuis `graph.links`.
- En-tête projet : `<Project>` avec `<StartDate>` = T0. Encodage UTF-8, namespace MSPDI
  (`http://schemas.microsoft.com/project`).

**D. CSV (`;`)** — dump « raw », un nœud par ligne. **Schéma proposé** (à confirmer/ajuster en
ouverture de session, non figé) :
`Type ; UID ; Libellé ; Groupe ; Responsable ; Durée ; Unité ; ETP ; Coût(k€) ; DébutTôt ;
FinTôt ; DébutTard ; FinTard ; Marge ; Critique ; DateCible ; TagJalon`. Dates au format FR,
**décimales en `,`** (cohérent Excel FR puisque le séparateur de colonnes est `;`).

#### Architecture fichiers (contrainte `file://` → `<script src>` classiques, pas de module ES6)
- `src/export.js` (existant) — garde PNG/PDF ; **héberge la fenêtre d'orchestration**
  (`pertOpenExportDialog` / menu de choix, même pattern DOM/CSS que le menu de filtre S7 pour
  la fiabilité multi-navigateurs).
- `src/export_xlsx.js` (nouveau) — **mini-writer XLSX** générique sur `fflate` (grille de
  cellules typées string/number/date/formule, styles, fills, `sharedStrings`, zip). Socle
  commun aux exports B et une partie de A.
- `src/export_gantt.js` (nouveau) — construit le modèle temps/charge (buckets selon `meta.unit`
  + garde-fou colonnes) ; produit **le Gantt chargé (via export_xlsx)** ET **le MSPDI XML**.
- `src/export_microjalons.js` (nouveau) — produit le micro-jalonnement (via export_xlsx).
- `src/export_csv.js` (nouveau) — produit le CSV.
- `index.html` : retirer `#btn-export-png` / `#btn-export-pdf`, ajouter `#btn-export` +
  conteneur de la fenêtre ; ajouter les `<script src>` des nouveaux modules **et** les
  déclarer dans `scripts/build-bundle.js` si l'inline par regex ne les capte pas
  automatiquement (vérifier : le builder inline tous les `<script src="src/…">`, donc a priori
  automatique — **à contrôler sur le bundle**).
- `css/style.css` : styles de la fenêtre d'export (réutiliser le pattern `.filter-menu`).

#### Ordre de livraison conseillé (incrémental, testable à chaque étape)
1. **Fenêtre d'export + bascule PNG/PDF** (retrait des 2 boutons, non-régression PNG/PDF).
2. **CSV** (le plus simple, valide le téléchargement texte + le schéma de données).
3. **Mini-writer XLSX** (`export_xlsx.js`) + un xlsx trivial de test (valide zip/ouverture Excel).
4. **Gantt chargé Excel** (buckets + charge + fills + total + garde-fou colonnes).
5. **Micro-jalonnement Excel** (réutilise le writer + la logique de tri/uid `<groupe>_NN`).
6. **MSPDI XML** (réutilise le modèle temps du Gantt + liens).

#### Points de vigilance / à trancher en ouverture
- **Charge par période en jours/semaines** : l'ETP est placé sur chaque période active (charge
  constante) — confirmer si un lissage plus fin est souhaité (a priori non, KISS).
- **Nommage fichiers** : `<titre-projet>_gantt.xlsx`, `_microjalons.xlsx`, `_msproject.xml`,
  `.csv`, `.png`, `.pdf` (via `pertProjectFilename()`).
- **Schéma CSV** : proposé ci-dessus, à valider avec l'utilisateur avant de figer.
- **#5** (incrément auto du n° de version à la sauvegarde) : **hors périmètre export**, jugé
  « peut-être une fausse bonne idée » par l'utilisateur → à rediscuter séparément, ne pas
  l'embarquer dans S9 sauf demande explicite.
- **Validation** : test headless navigateur (Playwright/Chromium, `file://`) par format —
  re-lire les xlsx générés avec un décodeur (fflate + DOMParser ou openpyxl côté outillage)
  pour comparer la structure logique aux exemples ; MSPDI = XML bien formé + tâches/liens
  présents ; CSV = colonnes/valeurs. Puis validation visuelle utilisateur (rituel habituel).

#### Implémentation — décisions notables (05/07/2026)
- **Fenêtre d'export = liste data-driven** : `PERT_EXPORT_FORMATS` (dans `export.js`) +
  `pertRegisterExportFormat(fmt)` — chaque module d'export enregistre son descripteur
  `{id, icon, label, desc, order, run}` à son chargement ; la fenêtre trie par `order` →
  l'ordre d'affichage ne dépend PAS de l'ordre des `<script>`. Ajouter un format = un appel,
  aucune modif de `index.html`. Fenêtre = dialogue modal (`#export-dialog`, pattern
  `.dialog-overlay`) avec la **note de destination `file://`**. PNG/PDF (S3) inchangés,
  juste rappelés via `run`. `pertDownloadBlob(data, filename, mime)` (objet URL, marche en
  `file://`) = socle de téléchargement commun CSV/XLSX/XML.
- **CSV** (`export_csv.js`) : `pertBuildCSV()` — BOM UTF-8 + CRLF, séparateur `;`, décimales
  `,`, dates FR ; un nœud PERT par ligne (Labels exclus). Schéma = en-tête figé de la spec.
- **Mini-writer XLSX** (`export_xlsx.js`) : `pertXlsxBuild(sheets)` sur **fflate** (zip + XML
  écrits à la main). Cellules `pertXlsxText/Num/Date/Formula`, style `{fmt, bold, fill}`
  dédupliqué en `cellXfs` ; formats date custom (164 `mmm-yy`, 165 `d-mmm-yy`), nombre `0.00`
  (builtin 2) ; fills solides collectés dynamiquement (couleurs de groupe) ; `sharedStrings` ;
  `cellStyles` « Normal » (sinon warning openpyxl / Excel tatillon). Dates → serial Excel
  (epoch 1899-12-30, calcul UTC). Validé par relecture openpyxl (dates reconnues, formats,
  fills, formules, gras, 0 warning).
- **Gantt chargé + MSPDI** (`export_gantt.js`) partagent `pertScheduleModel()` : recalcul,
  classement jalons entrée (aucun entrant + ≥1 sortant) / sortie, **tri activités = groupes
  par ES le plus précoce puis ES** (colle à l'exemple : sys avant algo), `numCols` = dernière
  période active + colonne jalons (garde-fou `PERT_GANTT_MAX_COLS=400` + toast), liens résolus
  depuis `graph.links`. **Offset d'affichage d'un jalon = sa `due_date` si présente, sinon EF**
  (l'exemple place « Jalon sortie 2 » à sa cible mars, pas à l'EF février). Gantt : ETP par
  période active coloré par groupe, sections + ligne `total charge` = `SUM` par colonne.
- **Micro-jalonnement** (`export_microjalons.js`) : template 19 colonnes, `Num` = `<groupe>_NN`
  (activités, compteur par LOT dans l'ordre de tri), **Date baseline = due_date sinon EF**,
  **Date prévue Actuelle = EF** (divergent pour un jalon dont la cible n'est pas tenue),
  **Jalon Majeur = GOLDEN (DOTD/COTD) / SILVER (ING)** + `LIBELLE JALON MAJEUR`, `Commentaires`
  = `properties.notes`. Colonnes de suivi laissées vides. En-tête fond vert (`#CCFFCC`).
- **MSPDI** (`export_gantt.js`, `pertBuildMSPDI`) : `<Project>`/`<Tasks>` XML à la main,
  namespace `schemas.microsoft.com/project`. Une `<Task>` par nœud (ordre = Gantt), UID/ID
  séquentiels, `Milestone` pour jalons/durée nulle, `Duration`/`Work` en heures via
  `pertDurationToHours` (× ETP pour Work), `PredecessorLink` (Type 1 = FS) depuis les liens.
  Validé : XML bien formé, 8 tâches, 6 liens reconstruits correctement.
- **Validation** : `tools/smoke-s9.js` (6 formats + ordre, CSV, magic PK des xlsx, MSPDI
  8 tâches/6 liens) + relecture openpyxl des xlsx (structure logique conforme à
  `gantt_charge.xlsx` / `microjalons.xlsx`) + parse XML du MSPDI ; **`tools/smoke.js` adapté**
  (PNG/PDF via la fenêtre) sans régression ; smoke S6/S7 verts. 0 erreur console.
- **Fichiers** : `index.html` (bouton `#btn-export`, `#export-dialog`, 4 nouveaux `<script>`),
  `src/export.js` (fenêtre + `pertDownloadBlob` + registre), `src/export_csv.js`,
  `src/export_xlsx.js`, `src/export_gantt.js` (Gantt + MSPDI), `src/export_microjalons.js`,
  `src/ui.js` (bouton unique), `css/style.css` (`.export-*`), `tools/smoke-s9.js`.

**Critère de validation** :
Un seul bouton d'export ; PNG/PDF/CSV/Gantt Excel/Micro-jalonnement/MSPDI produits, exploitables
et fidèles (structure logique) aux exemples ; ouverture propre dans Excel / MS Project ;
contrainte de destination `file://` explicitée à l'utilisateur.

---

### Session 10 — Rendu des liens & layout ✅ TERMINÉE le 05/07/2026 (tag **v0.14**)
> Implémentée, validée par tests headless (`tools/smoke-s10.js` + smoke général) **et
> validée visuellement par l'utilisateur** ; branche `session/10-liens-layout` mergée sur
> `main`, taguée **v0.14** (rituel appliqué : bundle `--tag v0.14` régénéré + versionné).
> Défaut conservé = `"courbe"` (non-disruptif).
**Objectifs** :
- [x] **#46** Liens **droits ou coudés au choix** — 3 styles pilotés par `meta.link_mode`
  (`"courbe"` défaut / `"droit"` / `"coude"`), sélecteur dans **Paramètres**. Le coudé =
  vrais angles droits (routage orthogonal custom).
- [x] **#19** Liens qui **ne passent plus sous/sur les activités** — en mode coudé, routage
  orthogonal **best-effort contournant** les nœuds intercalés.
- [x] **#15 (suite)** — vérifié : `pertRelocateOverlappingLabels` (S5) toujours en place et
  couvre le cas ; pas de retouche nécessaire.

**Décisions de conception (arbitrage utilisateur du 05/07/2026, via AskUserQuestion)** :
- **#46 = 3 styles** dont un **coudé orthogonal custom** (pas seulement les modes natifs
  LiteGraph), basculable dans **Paramètres** (cohérent avec `prop_width`/`layout_gap`).
- **#19 = routage orthogonal contournant les nœuds** (best-effort), PAS de pathfinding complet
  (écarté : trop coûteux/peu KISS). Garde-fous perf : élagage spatial + **dégradation auto
  au-delà de `PERT_LINK_AVOID_MAX=300` nœuds** (routage orthogonal simple sans test de collision).
- **Le placement manuel n'est JAMAIS modifié** : déplacer une tâche ne relance PAS le layout
  (`pertAutoLayout` reste manuel) ; le routage est purement cosmétique, recalculé en direct.
- **Le lien élastique de création** (drag pour connecter, objet lien `null`) reste une **simple
  courbe native** → visée fluide, aucun calcul d'évitement pendant le tirage.

**Implémentation — décisions notables (05/07/2026)** :
- **`src/link_routing.js`** : surcharge de `renderLink` **sur l'instance** `LGraphCanvas`
  (comme les menus contextuels, sans patcher la lib). Mode `coude` + lien **réel** → tracé
  orthogonal custom (`pertRenderOrthogonalLink` : bordure + trait coloré + flèche, en
  reproduisant la résolution de couleur native `link.color`/highlight/défaut) ; sinon (courbe/
  droit, ou lien élastique `null`) → rendu natif. `pertApplyLinkMode` règle
  `links_render_mode` natif (`droit`→STRAIGHT, `courbe`/`coude`→SPLINE pour l'élastique) et
  `setDirty` (⚠️ `LGraphCanvas.setDirty`, PAS `setDirtyCanvas` qui est sur graphe/nœud).
- **Routage** (`pertRouteOrthogonal`) : (1) canal vertical « Z » testé au milieu puis aux bords
  de chaque obstacle ; (2) si échec, **bande horizontale** par-dessus/dessous les obstacles de
  l'empan ; (3) fallback Z simple. Collision = segments axis-aligned vs rectangles
  (`pertSegHitsRect`). Obstacles = tous les nœuds **sauf les 2 extrémités**, élagués à la zone
  du lien (`pertCollectObstacles`, renvoie `null` si > `PERT_LINK_AVOID_MAX` → pas de test).
- **`meta.link_mode`** (défaut `"courbe"` = comportement historique) sérialisé (`storage.js`,
  défaut anciens fichiers) + restauré (`history.js`) ; `pertApplyLinkMode` rappelé après
  chargement (`storage.js`), undo (`history.js`) et `saveSettings`. Sélecteur `#settings-linkmode`
  dans le dialogue Paramètres.
- **Validation** : `tools/smoke-s10.js` (bascule des 3 modes → `links_render_mode` attendu ;
  `pertRouteOrthogonal` contourne un obstacle posé sur la ligne ; Z simple / mode dégradé ;
  rendu réel `.pert` en mode coudé sans erreur ; round-trip `meta.link_mode` ; #15 présent),
  `tools/smoke.js` sans régression (mode courbe par défaut), capture de contrôle (lien
  contournant un nœud non relié par-dessous, en angles droits). 0 erreur console.
- **Défaut = `"courbe"`** (non-disruptif pour les projets existants) ; l'utilisateur active le
  coudé dans Paramètres. À rediscuter si l'on veut le coudé par défaut.
- **Fichiers** : `src/link_routing.js` (nouveau), `index.html` (`<script>` + `#settings-linkmode`),
  `src/ui.js` (install + apply à l'init, open/saveSettings), `src/storage.js` + `src/history.js`
  (sérialisation/restauration + apply), `tools/smoke-s10.js`.

**Critère de validation** :
Sur un PERT chargé, les liens restent lisibles sans masquer les nœuds.

---

### Session Doc — Manuel utilisateur & documentation de conception/maintenance ✅ TERMINÉE (06/07/2026)
Placée intentionnellement en dernier (décision du 27/06/2026) pour que le manuel illustre
l'application aboutie. **Dernière session de la roadmap.** Livrée sur la branche `session/doc`.
**Objectifs** :
- [x] **Manuel utilisateur** (`docs/manuel-utilisateur.md`) — 100 % français, illustré de
  captures réelles : prise en main rapide (quick start), moteur PERT (dates, marges, chemin
  critique, **jalons entrants/sortants/points de contrôle + notion de cible**), et **toutes**
  les fonctionnalités (interface, 3 types de nœuds, panneau, réorganiser/grille/styles de
  liens/filtre, groupes, coûts, import Excel, sauvegarde/autosave, 6 exports, paramètres,
  raccourcis, FAQ). Note « Vocabulaire » en tête (nœud/lien/tâche + 3 types) sur retour user.
- [x] **Document de conception** (`docs/conception.md`) — contraintes `file://`/MIT,
  architecture, modèle de données, moteur PERT, rendu LiteGraph custom, exports, packaging,
  tableau des choix techniques justifiés.
- [x] **Document de maintenance** (`docs/maintenance.md`) — reprise, contraintes absolues,
  pièges LiteGraph, recettes « comment ajouter… », outillage `tools/`, rituel, vigilances.

**Décisions (retours utilisateur, 06/07/2026)** :
- **3 formats par document** (demande user) : **Markdown (source) + HTML autonome + PDF**.
  HTML autonome = images embarquées en data-URI (consultable hors ligne d'un double-clic), PDF
  A4 imprimable. **Pipeline** : `tools/build-docs.js` (chaîne `tools/_md2html.py` = python-markdown
  → HTML autonome + CSS d'impression + images data-URI, puis Chromium/Playwright → PDF). Sorties
  `docs/*.html` et `docs/*.pdf` **versionnées**. Règle permanente : à chaque évolution d'un doc,
  régénérer les 3 formats. (Cf. mémoire feedback-doc-formats.)
- **Retouches manuel** : ne mentionner que le **bundle `pertflow.html`** (pas `index.html` —
  seul le bundle est distribué) ; vocabulaire nœud/tâche clarifié en tête ; capture de barre
  d'état retirée du chapitre coûts (texte suffisant).
- **Clôture sans tag ni bundle** (décision user) : la session Doc ne modifie pas le code de
  l'app → **commit docs uniquement, pas de nouveau tag, pas de régénération du bundle** (ces
  mécanismes restent réservés aux évolutions fonctionnelles). Le bundle reste en `v0.14`.

**Captures d'écran** : `tools/doc-shots.js` (projet démo relabellisé FR) → `docs/images/manuel/`
(9 PNG). `tools/screenshot.js` reste disponible (modes `--app` / `--graph`).

**Critère de validation** :
Un nouvel arrivant prend en main l'outil avec le manuel seul ; un développeur tiers comprend
l'architecture et peut intervenir avec la doc de conception/maintenance. **Validé par
l'utilisateur** (relecture du manuel + retouches appliquées).

---

## ÉVOLUTIONS POST-ROADMAP

> La roadmap est terminée (S1→Doc). Les évolutions mineures et corrections de bugs
> demandées ensuite sont consignées ici, du plus récent au plus ancien.

### Déplacement d'une sélection multiple au simple clic-glisser ✅ TERMINÉE (07/07/2026, tag **v0.14.1**)
Correctif d'ergonomie sur la branche `evo/reorg-enchainements` (même lot que la réorg,
avant le tag). **Demande utilisateur** : après avoir sélectionné plusieurs tâches
(**Ctrl + glisser une zone** — conforme aux standards, inchangé), déplacer le groupe en
**cliquant-glissant sur l'un des éléments** exigeait de maintenir **SHIFT** (peu standard).
Attendu : le simple clic-glisser sur un élément déjà sélectionné déplace toute la sélection.

**Cause** : LiteGraph, au `mousedown` sur un nœud **déjà sélectionné sans modificateur**,
réinitialise la sélection à ce seul nœud (`processNodeSelected` → `selectNode` sans « add »)
→ seul ce nœud se déplaçait ; il fallait SHIFT pour préserver la multi-sélection.

**Correctif** (`src/ui.js`) : **surcharge d'instance** de `lgCanvas.processNodeSelected`
(même pattern que les menus contextuels, **sans patcher la lib**) — si le nœud cliqué est
**déjà sélectionné** et qu'aucun modificateur (Ctrl/Shift/Cmd) n'est pressé, on **conserve
la sélection** (retour anticipé) au lieu de la réduire à ce nœud. LiteGraph déplace ensuite
tous les `selected_nodes` (le `node_dragged` est posé avant l'appel). Cliquer un nœud **non
sélectionné** garde le comportement natif (sélection unique) ; Ctrl/Shift conservent
l'ajout/bascule. La sélection rectangle (Ctrl + glisser) n'est pas touchée.

**État** : validé par `tools/smoke-multiselect.js` — geste réel (souris Playwright) : Ctrl +
glisser sélectionne 2 tâches, puis clic-glisser **sans SHIFT** déplace **les deux** ; + tests
unitaires de la surcharge (conserve la multi-sélection au clic sur un sélectionné ; réduit à
une sélection unique au clic sur un non-sélectionné ; SHIFT bascule toujours). Non-régression
smoke S4/général (copier-coller, menus, sélection). ⚠️ Pièges de **test** rencontrés (pas des
bugs applicatifs) : le hit-test souris s'appuie sur `visible_nodes` (peuplé au 1er rendu →
attendre une frame) ; deux `mousedown` à moins de **300 ms** sont vus comme un **double-clic**
par LiteGraph (espacer les gestes dans le test). **Validé par l'utilisateur ; mergé sur `main`,
tagué v0.14.1, poussé** (rituel de fin de session appliqué).

### Réorganisation à deux niveaux — enchaînement puis groupe ✅ TERMINÉE (06/07/2026, tag **v0.14.1**)
Amélioration de la réorganisation chronologique (`pertAutoLayout`), sur la branche
`evo/reorg-enchainements`. **Demande utilisateur** : jusqu'ici la réorg regroupait les
tâches **d'abord par groupe** (bandes WP, S7). Un PERT étant fait d'**enchaînements** de
tâches reliées par des liens, il est plus lisible de **regrouper d'abord par enchaînement**
(tâches reliées entre elles). Bénéfice : **moins de liens qui se croisent** (les chaînes ne sont
plus entremêlées entre bandes WP). Le besoin « voir toutes les tâches d'un groupe » reste couvert
par le **filtre** (S7).

> **Affinement (retour utilisateur en cours de validation)** : une première version rangeait, *à
> l'intérieur* d'un enchaînement, les tâches par groupe dans des sous-bandes distinctes. Résultat :
> une chaîne linéaire à groupes alternés (ex. Meca→Prod→Meca) **zigzaguait** entre deux lignes —
> aucun gain de lisibilité, surface de travail inutilement étalée. Décision : **la compacité prime**,
> le groupe n'est plus qu'une **préférence secondaire** (départage entre couloirs *déjà libres*,
> jamais un couloir en plus). Le PERT est un exercice visuel → on privilégie une **zone de travail
> compacte** ; les groupes éventuellement « mixés » se retrouvent via le **filtre**.

**Ce qui change (uniquement l'affectation des couloirs verticaux)** :
- **Niveau 1 (primaire) = enchaînement** : composante faiblement connexe des liens (liens
  traités comme non orientés). Chaque enchaînement occupe une **bande verticale contiguë**.
- **Niveau 2 (à l'intérieur d'une bande) = packing COMPACT** : les tâches sont posées dans l'ordre
  des ES et l'on choisit leur couloir par ordre de préférence, **sans jamais ouvrir un couloir tant
  qu'il en reste un de libre** (⇒ nombre de couloirs = concurrence temporelle maximale, optimal) :
  **(1)** le couloir du **prédécesseur contraignant (EF max)** s'il est libre → une **chaîne directe
  reste rectiligne** (règle demandée : « enchaînement direct → même couloir si pas en concurrence ») ;
  **(2)** sinon, parmi les couloirs libres, un du **même groupe** (cohésion à coût nul en compacité —
  on ne fait que choisir *lequel* des couloirs déjà libres) ; **(3)** sinon le premier couloir libre ;
  **(4)** sinon seulement, un nouveau couloir.
- **Nœuds isolés** (aucun lien) : regroupés dans **une bande finale unique** (même packer compact),
  pour ne pas éparpiller un couloir par nœud isolé.
- **Invariants préservés** : l'**abscisse reste ∝ ES** (calage temporel façon Gantt intact ; le
  regroupement ne joue que sur Y) ; les **jalons de sortie** gardent leur bande haute séparée ;
  la relocalisation des Labels (#15) est inchangée. Déclenchement toujours **manuel** (bouton).

**Décision de conception** : les composantes connexes sont calculées **sur `rest` seul**
(activités + jalons intermédiaires), voisins restreints à `rest`. Conséquence : deux chaînes
qui ne convergent **que** par un jalon de sortie (placé dans sa bande haute à part) restent des
**enchaînements distincts** — elles ne fusionnent pas en une seule bande. Ordre des bandes
d'enchaînement = **ES min croissant** (lecture dans le sens du temps), départage taille
décroissante puis id ; bande des isolés en dernier. **Rappel du compromis largeur** : une tâche
très courte (durée ≲ 2,3 u.) a une largeur *mini* (`ACT_MIN_W`) qui dépasse son empan ∝ ES → son
successeur direct peut ne pas tenir sur le même couloir (chevauchement géométrique) et bascule
alors sur un couloir voisin. C'est le compromis largeur/lisibilité **pré-existant** (documenté),
pas un zigzag de groupe.

**Implémentation** (`src/pert_engine.js`) :
- `pertConnectedComponents(list, preds, succs)` : composantes non orientées restreintes à `list`
  (BFS, voisins = `preds ∪ succs` filtrés par `inSet`).
- `pertPackLanesConnected(list, topY, rowH, xOf, compOf, preds, efOf)` : niveau 1 — partitionne
  par composante, empile les bandes (multi-nœuds triées par ES min, puis les isolés), délègue chaque
  bande à `pertPackLanesCompact`. Remplace l'appel direct à `pertPackLanesGrouped` dans
  `pertAutoLayout`.
- `pertPackLanesCompact(list, topY, rowH, xOf, preds, efOf)` : niveau 2 (compacité, cf. règles
  (1)→(4) ci-dessus). Tri par `(ES, groupe, id)` → un prédécesseur est traité avant ses successeurs,
  et le tri par groupe rapproche les tâches de même groupe *en concurrence* (couloirs adjacents).
  `efOf = { id: ef }` sert à repérer le prédécesseur contraignant. **Remplace** `pertPackLanesGrouped`
  (supprimé : la partition dure par groupe causait le zigzag).
- `pertAutoLayout` calcule `efOf` (depuis `n.ef`) et passe `preds`/`efOf` à `pertPackLanesConnected`.

**Non-régression par construction** : quand il n'y a qu'un seul enchaînement (ou des tâches sans
lien), on retombe sur un packing par couloirs classique ; les tâches sans groupe se comportent
comme avant. Le test S7-B (4 activités sans lien, 2 groupes) reste vert : toutes en concurrence
(même ES) → un couloir chacune ; le tri par groupe les empile en couloirs adjacents → Alpha au-dessus
de Beta, disjoints.

**État** : implémenté et validé par test headless navigateur (`tools/smoke-reorg.js` : (1) bandes
disjointes pour 2 chaînes de même groupe ; (2) **compacité anti-zigzag** = chaîne linéaire à groupes
alternés sur un seul couloir + tâche parallèle sur un 2ᵉ couloir ; (3) isolés en bande finale ;
(4) abscisse ∝ ES ; (5) chaînes convergeant vers un même jalon de sortie séparées) + smoke S5/S6/S7/S10
+ smoke général sans régression + capture de contrôle (enchaînement Meca→Prod→Meca **rectiligne**).
**Validé par l'utilisateur ; mergé sur `main`, tagué v0.14.1, poussé** (rituel de fin de session
appliqué : bundle `--tag v0.14.1` régénéré + versionné).

---

### Long terme / écarté (hors roadmap planifiée)
Issu du retour Mickael (27/06/2026), volontairement non planifié :
- **#38** Sous-PERT — fonctionnalité de l'application « pro », beaucoup plus tard
- **#41** Chemin critique affiché seulement « quand nécessaire » — l'utilisateur indique
  **ne pas vouloir le retenir** ; le comportement actuel (re-tracé à la sélection, cf. S2.5)
  est conservé
- **#5** Incrément auto du n° de version — rattaché à S9 mais marqué « à rediscuter »
  (cf. ci-dessus), l'utilisateur doutant lui-même de l'intérêt
- **#3** Estimation rapide du coût — ~~retiré de S7 le 28/06/2026~~ **RÉINTRODUIT et livré en
  Session 8.5 (30/06/2026)** à la demande de l'utilisateur (ETP + coût dérivé, panneau + barre
  d'état, sans surcharge du graphe). Voir la section Session 8.5. L'agrégation **par groupe**
  n'est pas faite (seulement total projet / visible / chemin critique) — extension possible.

---

## COMMANDES DE DÉVELOPPEMENT

```bash
# Pas de build nécessaire. Mode d'ouverture cible (et seul garanti en production
# sur PC verrouillé DSI) : double-clic sur index.html → s'ouvre en file:// dans Chrome.
# Tant qu'il n'y a NI module ES6 NI fetch() local (cf. contraintes absolues), file://
# suffit. N'introduire ni l'un ni l'autre : un serveur peut être indisponible/interdit.
#
# Un serveur local n'est qu'un confort de DEV ponctuel (jamais requis en prod) :
# npx serve .
# ou
# python -m http.server 8080
```

---

## RITUEL DE FIN DE SESSION (obligatoire, décision utilisateur 29/06/2026)

À appliquer **systématiquement** à la clôture de chaque session, **avant** le commit final :

1. **Régénérer le bundle** standalone avec le tag de la session :
   ```bash
   node scripts/build-bundle.js --tag vX.Y
   ```
   (`vX.Y` = le tag qui sera posé à la fin de CETTE session ; rappel numérotation décalée
   vN ≠ SN — voir l'historique des tags. Le tag est créé après le commit, d'où `--tag`.)
2. **Committer ET pousser le bundle** (`dist/pertflow.html`) **avec le reste** du code.
   Le bundle est **versionné** (plus gitignoré depuis le 29/06) : il fait partie de la livraison.
3. Le bundle **embarque un bouton « À propos »** (toolbar) ouvrant une popup qui rappelle :
   - le **copyright auteur** : « © Stéphane Guichard » ;
   - la **licence** : MIT ;
   - la **date de génération** du bundle ;
   - le **tag de la branche main** correspondant.

   Ces deux dernières valeurs sont injectées par `scripts/build-bundle.js` dans
   `window.PERTFLOW_BUILD = { date, tag }` (lu par `openAbout()` dans `src/ui.js`). En mode
   développement (sources non bundlées), l'objet est absent → la popup affiche « développement
   (non bundlée) ». **Ne jamais coder en dur** date/tag dans les sources : seul le build les fixe.

> Ordre type de clôture : finaliser le code/doc → **régénérer le bundle** (`--tag`) →
> committer (source + bundle) → pousser → merger sur `main` → taguer `vX.Y` → pousser le tag.

---

## HISTORIQUE DES SESSIONS

### Session 0
- Démarrage du projet, structure, libs locales, dépôt GitHub
- Fichier CLAUDE.md initialisé

### Session 1
- Canvas LiteGraph, nœuds Activité / Jalon / Label, toolbar, panneau propriétés
- Au-delà de la spec : slots d'entrée dynamiques, resize auto, panneau toujours visible

### Session 2 (22/06/2026)
- Moteur PERT complet (`src/pert_engine.js`) : forward/backward pass, marges,
  chemin critique, détection de cycle, recalcul auto, conversion unités↔dates
- Jalon : date-cible bornant le LF + détection cible non tenue
- Validé par test headless (Node) sur PERT de référence
- **Réorientation** intégrée (voir bloc en tête de la section avancement)
- Journal de restitution créé : `docs/journal-developpement.md`

### Session 2.5 (24/06/2026)
- Visualisation & lisibilité : 7 demandes utilisateurs traitées (#1 à #7)
- `nodes.js` : Activité custom (en-tête coloré multi-lignes, largeur ∝ durée, slots
  positionnés explicitement) ; Jalon refondu (rectangle arrondi + coin drapeau,
  multi-lignes, exergue rouge si cible non tenue) ; helper `wrapText`
- `pert_engine.js` : `pertAutoLayout` (packing chronologique par couloirs) et
  `pertHighlightCriticalPath` (coloration des liens du chemin critique)
- `ui.js` / `index.html` : bouton « Réorganiser » ; chemin critique re-tracé à la sélection
- Logique validée par test headless Node ; **rendu visuel à valider dans Chrome**

### Session 3 (25/06/2026) — terminée
- Évolutions UI préalables (`fix/ui-tweaks`) : unité « mois » par défaut, bouton
  « Tout afficher » (zoom-to-fit + masquage du cadre LiteGraph parasite), correction
  du plafond visuel à 3 liens entrants sur les Jalons (hauteur ∝ nb de slots)
- **Import Excel legacy #8** (🔴 urgent) livré : `src/import_excel.js` (dézip fflate +
  parsing DrawingML), bouton « Importer Excel », lecture config onglet MANUEL
  (feuille/T0/unité), concaténation dans le PERT courant, dialogue fallback de choix
  de feuille. `lib/fflate.min.js` ajouté
- **Persistance `.pert`** (`src/storage.js`) : sérialisation `{version,meta,graph}`,
  sauvegarde Blob + chargement `FileReader`, recalcul/zoom après `configure()`
- **Export PNG/PDF** (`src/export.js`) : rendu hors-écran (boîte englobante, fond blanc),
  `toDataURL` + jsPDF page A4 fit-to-page avec titre
- **Copier/coller** câblé sur le presse-papier natif LiteGraph (Ctrl+C/Ctrl+V) ;
  correction du bug Ctrl+A (`selectAllNodes` → `selectNodes`)
- **Nœud Label** opérationnel (`updateSize` à l'édition) ; overlay debug masqué (`show_info`)
- Validé en croisé : tests headless import (pur 25/25, e2e 10/10) + smoke test navigateur
  réel (Playwright/Chromium) sur `C_PERT_exemple.xlsm` couvrant import/sauvegarde/rechargement/
  export PNG+PDF/copier-coller/Label, 0 erreur console + validation visuelle utilisateur

### Session 4 (26-27/06/2026) — terminée
- Reprise après crash PC en plein travail sur l'undo/redo (récupération du travail
  non commité : `src/history.js` intact, câblage `index.html`/`ui.js` présent)
- **Undo/Redo livré** : `src/history.js` (historique par snapshots, coalescence des
  frappes, baseline au démarrage et après chargement `.pert`), boutons toolbar +
  raccourcis Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, marques sur les événements de graphe et
  l'édition de propriété. Correction d'un trou de réinitialisation d'historique dans
  `src/storage.js` (chargement `.pert`)
- Validé en navigateur réel (Playwright/Chromium, `file://`) : smoke test existant sans
  régression + test ciblé ajout/undo/redo, coalescence, boutons aux extrémités, baseline
  réinitialisée après chargement `.pert` ; 0 erreur console
- **Décisions de conception figées** pour les tâches restantes (snap-to-grid toggle +
  grille visible seulement si activée ; icônes sur techno actuelle, SVG inline en
  évolution future possible ; bundle généré à la demande dans `./dist`, structure
  conservée) — détail dans la section Session 4 plus haut
- **Finitions livrées (27/06/2026)** : menus contextuels francisés recentrés PERT
  (`getMenuOptions`/`getNodeMenuOptions` surchargés, ajout de nœud sous le curseur),
  searchbox neutralisée (#28) ; snap-to-grid en toggle (grille visible si activée) ;
  gestion d'erreurs UI (toast rouge `showError`, `guardUI`, filet global `window.error`) ;
  icônes Unicode homogènes sur la toolbar ; bundle standalone `scripts/build-bundle.js`
  → `dist/pertflow.html` (libs+sources inlinés, 0 requête externe ; versionné depuis le 29/06)
- Validé en navigateur réel (Playwright/Chromium, `file://`) : `tools/smoke.js` sans
  régression + nouveau `tools/smoke-s4.js` + vérification du bundle, 0 erreur console
- **Mergé sur `main`, tagué `v0.5`, poussé** après validation visuelle utilisateur (Firefox).
  ⚠️ Numérotation des tags décalée (S2.5 a consommé un tag) : v0.1=S1, v0.2=S2, v0.3=S2.5,
  v0.4=S3, v0.5=S4 → la prochaine session sera v0.6

### Session 5 (27/06/2026) — correctifs & quick wins (retour Mickael)
- 7 remarques traitées (#25, #26, #29, #8, #20, #15 ; #28 déjà livré en S4) sur la branche
  `session/5-correctifs`. Détail et décisions d'implémentation dans la section Session 5
  plus haut. Deux arbitrages visuels tranchés par l'utilisateur : #8 responsable « dans
  l'en-tête coloré » ; #20 coin vert « si marge confortable » (3 états, seuil 1 unité)
- `src/pert_engine.js` : descente symétrique vers le terminal dans
  `pertHighlightCriticalPath` (#26) + `pertRelocateOverlappingLabels` (#15) ;
  `src/nodes.js` : responsable dans l'en-tête + `ellipsize` (#8), `targetState` 3 états +
  `MILESTONE_GREEN_MARGIN` (#20) ; `src/export.js` : `pertRenderToCanvas(renderScale)` +
  `compress:true` (#29) ; `src/ui.js` : `onShowNodePanel` no-op + `showLinkMenu` FR (#25)
- Validé : `tools/smoke-critical.js` (#26), `tools/smoke-s5.js` (#15/#20/#8), smoke existant
  sans régression, capture de contrôle. **Validation visuelle utilisateur à confirmer avant
  merge/tag v0.6**

### Session 6 (27/06/2026) — regroupement métier WP/service, temps 1 (retour Mickael)
- Sur la branche `session/6-regroupement-wp`. 4 objectifs livrés (#34, #2, #14, #4).
  Détail et décisions dans la section Session 6 plus haut. Deux décisions de conception
  tranchées par l'utilisateur en début de session : **groupe = combobox enrichissable**
  (même mécanisme que le Responsable, repris au passage — amorce #13) ; **couleur/groupe
  = « premier venu fixe la teinte »** (propagation au changement décidée côté implémentation
  pour préserver l'harmonisation #4). Précision utilisateur sur **#34 : uid automatique,
  ni visible ni éditable**.
- `src/nodes.js` : `properties.uid` (auto) + `properties.group` sur l'Activité ;
  helpers `pertGenUid` / `pertEnsureUids` (dédoublonnage clone/coller/chargement).
  `src/ui.js` : `buildCombobox` (Groupe + Responsable), registre `pertGroups` +
  `pertApplyGroup` (héritage/premier-venu) + `pertRecolorGroup` (propagation),
  `collectGroupNames` / `collectResponsibles` (datalists), `pertEnsureUids` après
  Dupliquer/coller, `pertMeta.groups` initialisé. `src/storage.js` : sérialisation +
  restauration de `groups` + `pertEnsureUids` au chargement. `src/history.js` : restauration
  de `groups` dans `restore`.
- Validé : `tools/smoke-s6.js` (uid auto/unique/dédoublonnage, premier-venu/héritage,
  propagation couleur, round-trip `.pert`), smoke existant sans régression, contrôle du
  panneau (combobox + datalists). **Validation visuelle utilisateur à confirmer avant
  merge/tag v0.6**

### Session 7 (28/06/2026) — couleur/groupe au cœur des fonctions de base (retour Mickael)
- Sur la branche `session/7-couleur-groupe`. 3 volets livrés (A import conscient du groupe,
  B réorganisation à couloirs groupés, C filtre #16). Détail et décisions dans la section
  Session 7 plus haut. **Redéfinition de la session par l'utilisateur en ouverture (28/06)** :
  faire exploiter le couple couleur/groupe par les fonctions déjà acquises (import, réorg)
  **avant** de bâtir le filtre ; **#3 (coût) retiré** → long terme.
- `src/ui.js` : `promptImportGroup` (remplace `promptImportColor`, 3 chemins groupe) +
  `applyImportModel(model, color, group)` ; section filtre (`collectActivityColors`,
  `refreshFilterOptions`, `setFilterFromSelect`, `applyFilter`, `window.pertFilter`) + câblage
  du `<select>`. `src/pert_engine.js` : `pertGroupKey` + `pertPackLanesGrouped` (bandes
  verticales par groupe, X∝ES conservé, non-régression par construction). `src/nodes.js` :
  `pertNodeDimmed` + `pertDrawDimVeil` + `onDrawForeground` (voile d'estompage) sur Activité/
  Jalon/Label. `index.html` : menu de filtre custom (`#filter-trigger` + `#filter-menu`) dans
  la toolbar. `css/style.css` : styles du champ groupe d'import, de la note, du verrou couleur
  et du menu de filtre custom (pastilles). **Correctif 29/06 (retour user)** : le `<select>`
  natif a été remplacé par un menu déroulant custom à pastilles de couleur (les `<option>`
  natives n'affichent pas de fond coloré sous Firefox, navigateur par défaut de l'utilisateur).
- Validé : `tools/smoke-s7.js` (A 3 chemins, B bandes disjointes + X∝ES, C estompage groupe/
  couleur), smoke existant sans régression, captures de contrôle.
- **Ajouts de fin de session (29/06/2026, décision utilisateur)** : instauration du **« Rituel de
  fin de session »** (cf. section dédiée) — bundle régénéré + versionné à chaque clôture. Bouton
  **« À propos »** (`#btn-info` → `openAbout`, popup `#about-dialog`) rappelant © Stéphane Guichard,
  licence MIT, date de génération et tag main. `scripts/build-bundle.js` injecte
  `window.PERTFLOW_BUILD = {date, tag}` (option `--tag`, sinon dernier tag git). `.gitignore` :
  `dist/` n'est plus ignoré (bundle versionné). Bundle v0.8 régénéré et vérifié (À propos affiche
  v0.8 + date, 0 requête externe).

### Session 8 (30/06/2026) — propriétés & jalons enrichis (retour Mickael)
- Sur la branche `session/8-proprietes-jalons`. 4 objectifs (#12, #13, #17, #18). Détail et
  décisions dans la section Session 8 plus haut. Trois arbitrages utilisateur en ouverture :
  **#17** = pastille colorée + texte ; **#18** = case à cocher dans Paramètres ; **#12** =
  panneau uniquement. **#13** était déjà livré en S6 (combobox Responsable + datalist) —
  confirmé et couvert par test.
- `src/nodes.js` : `properties.notes` sur l'Activité (#12, panneau seul) ; `properties.tag`
  + registre `PERT_MILESTONE_TAGS` + helper `pertMilestoneTag` + rendu pastille dans
  `MilestoneNode.onDrawBackground`/`updateSize` (#17) ; `ActivityNode.updateSize` lit
  `meta.prop_width` (#18, largeur figée à `ACT_MIN_W` si désactivé). `src/ui.js` : champ Notes
  (`buildTextarea`, qui marque désormais l'historique), sélecteur Type Jalon (`buildSelect`,
  nouveau helper), case `settings-propwidth` dans open/saveSettings, `pertMeta.prop_width`
  par défaut. `index.html` : case à cocher dans le dialogue Paramètres. `css/style.css` :
  `.settings-check` (checkbox inline). `src/storage.js` + `src/history.js` : sérialisation/
  restauration de `prop_width`.
- Validé : `tools/smoke-s8.js` (#12 défaut/panneau-seul/round-trip, #13 collectResponsibles,
  #17 défaut/lookup/taille/indépendance targetState/round-trip, #18 toggle réversible +
  round-trip), smoke existant sans régression, captures de contrôle (jalons taggés, dialogue
  Paramètres). **Mergée sur `main` (`7909a6d`), taguée `v0.10`, poussée** après validation
  visuelle utilisateur (rituel de fin de session : bundle `--tag v0.10` régénéré+versionné).

### Session 8.5 (30/06/2026) — estimation des coûts (#3 réintroduit)
- Session **intercalée avant la S9** (modèle S2.5), sur la branche `session/8.5-estimation-couts`.
  L'utilisateur a finalement demandé la fonction de coût (#3), retirée de S7 et classée « long
  terme ». **Décision structurante** : ne pas surcharger le graphe — ETP (saisi) + coût (lecture
  seule) dans le **panneau**, agrégats dans la **barre d'état**, rien sur le nœud (« PERT ≠ outil
  de chiffrage »). Défauts entreprise : 135 h/mois · 8 h/jour · 136 €/h.
- `src/pert_engine.js` : `pertActivityCost` + `pertDurationToHours` + `pertFormatCost` (coût =
  durée→heures selon unité × ETP × taux, non stocké). `src/nodes.js` : `properties.etp` (défaut 1).
  `src/ui.js` : champ ETP (panneau), coût en lecture seule dans `fillCalcSection`, agrégats dans
  `updateStatus` (total visible/filtré + chemin critique, via `#status-cost`), paramètres dans
  open/saveSettings. `index.html` : `<fieldset>` Estimation des coûts + `#status-cost`.
  `css/style.css` : `.settings-group`. `src/storage.js` + `src/history.js` : sérialisation/
  restauration des 3 paramètres (défauts pour anciens fichiers).
- Validé : `tools/smoke-s85.js` (formule j/sem/mois, ETP défaut/0, jalon sans coût, total
  filtré vs non, coût chemin critique, round-trip ETP+paramètres), smoke existant sans régression,
  captures de contrôle (panneau ETP+coût, dialogue Paramètres, barre d'état). **Validation
  visuelle utilisateur à confirmer avant merge/tag v0.11**.

### Correctifs pré-Session 9 (01/07/2026) — import (marge « ? ») & sélecteur de groupe Firefox
- Deux bugs remontés par l'utilisateur, traités avant la S9 sur la branche
  `fix/import-marge-et-selecteur-groupe`. Détail dans la section « Correctifs pré-Session 9 »
  plus haut. **Import** : les tâches à marge indéterminée (`2/?`) étaient importées avec une
  durée de 1 — `findValueText` (`import_excel.js`) ignorait `2/?` (pas de chiffre après `/`) et
  se rabattait sur la date de la tâche, dont `01/11` donnait durée = 1. Motif ancré tolérant `?`.
  **Sélecteur de groupe** : le `<datalist>` natif était inutilisable (Firefox le masque avec
  `autocomplete="off"` ; Edge/Chrome le filtrent par la valeur courante → impossible de voir les
  autres groupes quand le champ est déjà rempli). Remplacé par un **menu déroulant custom**
  (bouton ▾ + pastilles de couleur, pattern du filtre S7) dans `buildCombobox` (`src/ui.js`,
  `css/style.css`), appliqué au Groupe et au Responsable.
- Validé : import `C_PERT_exemple_2.xlsm` (durées 2/3/6/3), non-régression `C_PERT_exemple.xlsm`,
  smoke S6 + S7 + smoke général (Playwright/Chromium) sans régression. **v0.12** = 1re passe
  (import + retrait `autocomplete="off"`), **mergé sur `main` et tagué**. Retour utilisateur
  ensuite : « même souci sous Edge » → le `<datalist>` natif filtre par la valeur courante
  (Chrome/Edge) → **2e passe `v0.12.1`** : menu déroulant custom (bouton ▾ + pastilles, pattern
  filtre S7) dans `buildCombobox`, appliqué au Groupe et au Responsable. Rituel appliqué aux deux
  passes (bundle régénéré + versionné). La Session 9 sera `v0.13`.

### Correctifs pré-Session 9 (suite, 02-03/07/2026) — ergonomie & filet anti-crash (tag v0.12.2)
- Trois évolutions d'ergonomie demandées avant la S9, branche `fix/centrage-toolbar-zoom-autosave`.
  Détail et décisions dans la section « Correctifs pré-Session 9 (suite) » plus haut. **Centrage** :
  `getCanvasCenter` corrigé (conversion écran→graphe `cx/scale - offset`, fausse dès zoom ≠ 1) +
  centrage réel (retrait demi-taille) ; les 3 boutons d'ajout passent par `addNodeAt`. **Toolbar** :
  `flex-wrap` + `min-height` → plus aucun bouton rogné en petite résolution. **Zoom −/+** : boutons
  `➖`/`➕` autour de « Tout afficher », `changeScale` natif (clamp [0,1 ; 10]) pour les postes sans
  molette/pavé multipoint. **Sauvegarde automatique** : nouveau module `src/autosave.js` — snapshot
  de récupération `localStorage` (seul mécanisme viable en `file://`), écrit toutes les 8 s tant
  qu'il reste du travail non sauvegardé, dialogue de restauration au démarrage après plantage.
  **Activée par défaut** (décision utilisateur), désactivable dans Paramètres, sérialisée par projet ;
  effacée par une vraie sauvegarde/chargement/« Ignorer ».
- `index.html` : boutons zoom, case + note Paramètres, dialogue de récupération, `<script src>` autosave.
  `src/ui.js` : `getCanvasCenter` + centrage `addNodeAt`, `pertZoomBy`, case autosave, démarrage module +
  check récupération, `meta.autosave` défaut true. `src/autosave.js` (nouveau). `src/storage.js` +
  `src/history.js` : clé `autosave` (défaut true, anciens fichiers inclus) + effacement snapshot.
  `css/style.css` : toolbar `flex-wrap`, note Paramètres.
- Validé : `tools/smoke-center-toolbar.js` + `tools/smoke-autosave.js` + smoke général sans régression
  (Playwright/Chromium, `file://`). **Validation utilisateur** avant clôture ; **mergé sur `main`,
  tagué `v0.12.2`, poussé** (rituel : bundle `--tag v0.12.2` régénéré + versionné). La Session 9 sera `v0.13`.

### Correctifs pré-Session 9 (suite 2, 05/07/2026) — filtre : voile sombre & axe responsable (tag v0.12.3)
- Deux petites évolutions du filtre demandées « en indice mineur » avant la S9, branche
  `fix/filtre-responsable-voile-sombre`. Détail dans la section « Correctifs pré-Session 9 (suite 2) »
  plus haut. **Voile sombre** : `pertDrawDimVeil` (`src/nodes.js`) passe d'un voile clair
  `rgba(248,249,251,0.78)` (blanchit, incohérent thème sombre) à un voile sombre `rgba(18,18,42,0.72)`
  aligné sur le fond `#12122a` du canvas → les tâches hors filtre sont assombries. **Filtre
  responsable** : nouvel axe `{ type:"responsible", value }` symétrique aux filtres groupe/couleur
  (`pertNodeDimmed` dans `src/nodes.js` ; `pertFilterStillValid`, section « Responsables » de
  `refreshFilterOptions`, `updateFilterTrigger`, `applyFilter` dans `src/ui.js` ; réutilise
  `collectResponsibles()` de S6). Pastille icône **👤** (dimension sans couleur) via `buildFilterSwatch`/
  `buildFilterRow` (param `icon` optionnel) + `.filter-swatch.icon` (`css/style.css`).
- Validé : `tools/smoke-s7.js` (non-régression groupe/couleur) + vérification e2e dédiée du filtre
  responsable (dimming, dédoublonnage, menu + pastille 👤, validité, déclencheur), 0 erreur console.
  **Validation utilisateur** avant clôture ; **mergé sur `main`, tagué `v0.12.3`, poussé** (rituel :
  bundle `--tag v0.12.3` régénéré + versionné). La Session 9 sera `v0.13`.

### Session 9 (05/07/2026) — exports avancés (#21, #33)
- Sur la branche `session/9-exports-avances`. **Concept approfondi avec l'utilisateur AVANT de
  coder** (formats décodés depuis `test_cases/pert_a_exporter.pert` → `gantt_charge.xlsx` +
  `microjalons.xlsx` ; 3 décisions figées par AskUserQuestion). Détail complet et décisions dans
  la section Session 9 plus haut. **Refonte** : un seul bouton « ⬇ Exporter » ouvrant une fenêtre
  de choix (PNG/PDF perdent leur bouton dédié, fonctions S3 inchangées) + 4 formats métier.
- 6 formats : PNG, PDF, **CSV** (`;`, brut), **Gantt chargé Excel** (charge ETP/période colorée
  par groupe, sections + `total` SUM), **Micro-jalonnement Excel** (template de suivi, jalons
  majeurs GOLDEN/SILVER), **Gantt MS Project** (MSPDI XML, tâches + charge + liens). Décisions
  utilisateur : fidélité Excel *minimale* ; MS Project = *MSPDI XML à la main* (pas de lib .mpp) ;
  granularité Gantt = *unité projet* + garde-fou 400 colonnes.
- Fichiers : `index.html` (bouton + `#export-dialog` + 4 `<script>`), `src/export.js` (fenêtre
  data-driven `PERT_EXPORT_FORMATS`/`pertRegisterExportFormat` + `pertDownloadBlob`),
  `src/export_csv.js`, `src/export_xlsx.js` (mini-writer XLSX sur fflate), `src/export_gantt.js`
  (Gantt chargé + MSPDI, `pertScheduleModel` partagé), `src/export_microjalons.js`, `src/ui.js`
  (bouton unique), `css/style.css` (`.export-*`) + `tools/smoke-s9.js` ; `tools/smoke.js` adapté
  (PNG/PDF via la fenêtre).
- Validé : `tools/smoke-s9.js` + relecture openpyxl des xlsx (structure conforme aux exemples) +
  parse XML du MSPDI (8 tâches, 6 liens), smoke général + S6/S7 sans régression, 0 erreur console,
  **validation visuelle utilisateur** (Excel + import MS Project). **Mergé sur `main`, tagué
  `v0.13`, poussé** (rituel : bundle `--tag v0.13` régénéré + versionné). Prochaine étape : **S10
  (rendu des liens & layout)** — ou la session Doc si l'utilisateur préfère.

### Session 10 (05/07/2026) — rendu des liens & layout (#46, #19, #15)
- Sur la branche `session/10-liens-layout`. **Concept cadré avec l'utilisateur avant de coder**
  (2 arbitrages via AskUserQuestion, après échanges sur le comportement au déplacement de nœud
  et la perf). Détail complet et décisions dans la section Session 10 plus haut. **#46** : 3
  styles de liens (`meta.link_mode` = courbe/droit/coudé) dans Paramètres, le coudé = routage
  orthogonal custom ; **#19** : en mode coudé, contournement best-effort des nœuds intercalés ;
  **#15** : vérifié (pertRelocateOverlappingLabels S5 suffit).
- Décisions : coudé = vrai orthogonal custom (pas les modes natifs seuls) ; évitement best-effort
  (pas de pathfinding complet) avec garde-fous perf (élagage + dégradation > 300 nœuds) ;
  placement manuel jamais modifié (routage cosmétique) ; lien élastique de création reste une
  courbe simple. Défaut = courbe (non-disruptif).
- Fichiers : `src/link_routing.js` (nouveau : surcharge instance de `renderLink`, `pertRouteOrthogonal`,
  `pertRenderOrthogonalLink`, `pertApplyLinkMode`), `index.html` (`<script>` + `#settings-linkmode`),
  `src/ui.js` (install + apply à l'init + open/saveSettings), `src/storage.js` + `src/history.js`
  (sérialisation/restauration `link_mode` + apply), `tools/smoke-s10.js`.
- Validé : `tools/smoke-s10.js` (bascule modes, évitement, round-trip, rendu réel coudé, #15) +
  smoke général sans régression + capture de contrôle (lien contournant un nœud) + **validation
  visuelle utilisateur**. **Mergé sur `main`, tagué `v0.14`, poussé** (rituel : bundle `--tag v0.14`
  régénéré + versionné). Prochaine étape : **session Doc** (manuel + conception/maintenance),
  dernière de la roadmap.

### Session Doc (06/07/2026) — manuel utilisateur & doc conception/maintenance
- **Dernière session de la roadmap.** Sur la branche `session/doc`. Détail et décisions dans la
  section « Session Doc » plus haut. Trois documents en `docs/` : **manuel utilisateur** (FR,
  quick start, moteur PERT + jalons entrants/sortants/cible, toutes les fonctionnalités, 9
  captures réelles), **conception** (architecture, choix techniques), **maintenance** (reprise,
  pièges LiteGraph, outillage, rituel).
- **Décision user : 3 formats par document** — Markdown (source) + **HTML autonome** (images
  data-URI, hors ligne) + **PDF**. Pipeline `tools/build-docs.js` (`_md2html.py` python-markdown +
  Chromium/Playwright). Sorties `docs/*.html` / `docs/*.pdf` versionnées ; à régénérer à chaque
  évolution d'un doc. Captures via `tools/doc-shots.js` (projet démo relabellisé FR).
- **Retouches manuel (retour user)** : seul le bundle `pertflow.html` mentionné (pas `index.html`) ;
  vocabulaire nœud/tâche en tête ; capture barre d'état retirée du chapitre coûts.
- **Clôture sans tag ni bundle** (décision user) : docs uniquement → pas de code modifié → **commit
  docs, pas de nouveau tag, bundle inchangé (`v0.14`)** ; ces mécanismes restent pour les évolutions
  fonctionnelles. **Roadmap terminée.** Fichiers : `docs/manuel-utilisateur.{md,html,pdf}`,
  `docs/conception.{md,html,pdf}`, `docs/maintenance.{md,html,pdf}`, `docs/images/manuel/*.png`,
  CLAUDE.md + journal (`tools/build-docs.js`, `_md2html.py`, `doc-shots.js` = outillage gitignoré).

### Évolution post-roadmap (06/07/2026) — réorganisation à deux niveaux (enchaînement + compacité)
- Sur la branche `evo/reorg-enchainements`. Détail et décisions dans la section « Évolutions
  post-roadmap » plus haut. **Demande utilisateur** : la réorg chronologique regroupait les tâches
  d'abord par groupe (S7) ; la regrouper **d'abord par enchaînement** (composante connexe de liens)
  est plus lisible et réduit les croisements de liens (le filtre couvre le besoin « voir tout un
  groupe »). **Affinement après 1re validation** : la sous-partition par groupe *à l'intérieur* d'un
  enchaînement faisait **zigzaguer** une chaîne linéaire à groupes alternés → **la compacité prime**,
  le groupe devient une simple préférence secondaire (départage entre couloirs déjà libres).
- `src/pert_engine.js` : `pertConnectedComponents` (composantes non orientées restreintes à `rest`)
  + `pertPackLanesConnected(…, preds, efOf)` (niveau 1 enchaînement, délègue à
  `pertPackLanesCompact` par bande ; isolés en bande finale) + `pertPackLanesCompact` (niveau 2 :
  couloir du prédécesseur contraignant EF max si libre → chaîne rectiligne ; puis affinité de groupe
  sur couloirs libres ; puis 1er libre ; puis nouveau couloir — jamais un couloir de plus s'il en
  reste un libre). `pertPackLanesGrouped` **supprimé** (la partition dure causait le zigzag).
  `pertAutoLayout` calcule `efOf` et appelle `pertPackLanesConnected`. Abscisse ∝ ES et bande haute
  des jalons de sortie inchangées.
- Validé : `tools/smoke-reorg.js` (bandes d'enchaînement disjointes ; **compacité anti-zigzag** =
  chaîne linéaire sur un seul couloir ; isolés en bande finale ; abscisse ∝ ES ; chaînes convergeant
  vers un jalon de sortie séparées) + smoke S5/S6/S7/S10 + smoke général sans régression + capture
  de contrôle (enchaînement Meca→Prod→Meca rectiligne). **Validé par l'utilisateur, mergé sur `main`,
  tagué `v0.14.1`, poussé** (avec le correctif sélection multiple ci-dessous, même lot).

### Évolution post-roadmap (07/07/2026) — déplacement d'une sélection multiple au clic-glisser
- Sur la branche `evo/reorg-enchainements` (même lot que la réorg, avant le tag `v0.14.1`). Détail dans
  la section « Évolutions post-roadmap » plus haut. **Demande utilisateur** : déplacer une sélection
  multiple (faite par Ctrl + glisser une zone) en cliquant-glissant un élément exigeait de maintenir
  SHIFT — écart aux standards. Correctif = **surcharge d'instance** de `lgCanvas.processNodeSelected`
  (`src/ui.js`, sans patcher la lib) : clic sur un nœud **déjà sélectionné sans modificateur** →
  conserve la sélection (LiteGraph déplace alors tous les `selected_nodes`) ; clic sur un nœud non
  sélectionné → sélection unique native ; Ctrl/Shift inchangés. Sélection rectangle (Ctrl) intacte.
- Validé : `tools/smoke-multiselect.js` (geste réel souris : Ctrl+zone → 2 sélectionnés, puis
  clic-glisser sans SHIFT déplace les 2 ; + unitaires de la surcharge) + non-régression S4/général.
  Pièges de test notés (visible_nodes au 1er rendu ; double-clic < 300 ms). **Validé par l'utilisateur,
  mergé sur `main`, tagué `v0.14.1`, poussé** (rituel : bundle `--tag v0.14.1` régénéré + versionné).
