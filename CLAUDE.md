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
  responsible: "",      // optionnel
  color: "#4A90D9",     // couleur de fond du nœud
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
- **Calcul interne en unités** (offset depuis T0) ; conversion en dates calendaires à l'affichage (facteur fixe : j=1, sem=7, mois=30 jours, inversible)
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
- Jalon avec due_date → LF = min(due_date calculée, LF propagée)
- Cycle détecté → afficher une erreur dans l'UI, ne pas calculer
- Nœud isolé (sans connexion) → calculé indépendamment depuis T0

### Déclenchement du recalcul
Recalculer automatiquement à chaque événement LiteGraph :
- `graph.onNodeAdded`
- `graph.onNodeRemoved`
- `graph.onConnectionChange`
- Modification d'une propriété dans le panneau latéral

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
> Roadmap effective : **S1 ✅ → S2 ✅ → S2.5 ✅ → S3 ✅ (dont import Excel) → S4 ✅
> → S5 ✅ (correctifs & quick wins) → S6 ✅ (regroupement métier WP, temps 1) → S7
> (couleur/groupe : import + réorg conscients du groupe, puis filtre) → S8 (propriétés &
> jalons enrichis) → S9 (exports avancés) → S10 (liens & layout) → Doc (fin)**.

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
- Convention de nommage : groupe `<lettre><id>` → `A`=activité, `S`=jalon, `E`=nœud T0
  (non matérialisé → règle `meta.t0`). Sous-formes `.1`=libellé, `.2`=`durée/marge`
  (virgule décimale FR ; on garde la durée), `.3`/`.4`=date. Jalon : date-cible encodée
  `E=(jj/mm/aaaa)` dans le libellé → `due_date`.
- Connecteurs : `stCxn`/`endCxn` pointent une **sous-forme** → map `id sous-forme→groupe`
  pour résoudre. Arêtes touchant un nœud `E` ignorées (le successeur démarre à T0).
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
  Sortie `dist/pertflow.html` (~1,6 Mo), `dist/` gitignoré (artefact). `scripts/` est
  suivi par git (contrairement à `tools/`, outillage de validation gitignoré).
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

### Session 7 — Le couple couleur/groupe au cœur des fonctions de base ⏳ À VENIR
Suite de S6 sur la même dimension « groupe ». **Redéfinie le 28/06/2026** (cf. ci-dessous) :
avant de bâtir le filtre, on fait d'abord exploiter le concept couleur/groupe par les
fonctions de base déjà acquises (import, réorganisation). **#3 (coût) retiré** du périmètre
S7 → reporté en long terme (décision utilisateur : pas indispensable pour un outil PERT KISS).
**Objectifs** :
- [ ] **A — Import Excel conscient du groupe** : le dialogue d'import devient **centré
  groupe** (combobox enrichissable + `<datalist>` des groupes existants), avec 3 chemins :
  (1) **groupe existant** sélectionné → couleur **héritée et verrouillée** (affichée, lue
  dans `pertMeta.groups`) ; (2) **nouveau groupe** (nom non connu) → on choisit sa couleur,
  qui **devient** la couleur du groupe (« premier venu », cohérent avec S6) ; (3) **aucun
  groupe** (champ laissé vide) → on choisit juste une couleur, tâches importées **sans
  groupe** (comportement actuel préservé). **Un seul groupe par lot** d'import (retag
  possible après coup via le bouton « Appliquer ce groupe aux tâches de même couleur » de S6).
  Remplace/étend `promptImportColor` ; les Activités importées sont rattachées au groupe via
  `pertApplyGroup` (héritage/premier-venu), pas un 2e système de couleur.
- [ ] **B — Réorganisation cohésive (couloirs groupés)** : `pertAutoLayout` conserve
  **l'abscisse ∝ ES inchangée** (cohérence temporelle façon Gantt intacte) ; seule
  **l'affectation des couloirs verticaux** devient **consciente du groupe** → les tâches
  d'un même WP/groupe se posent sur des **couloirs voisins** (zones de couleur lisibles
  « de loin », objectif #4 préservé après réorg). Best-effort : la non-superposition reste
  prioritaire. Tâches **sans groupe** packées normalement. Pas de bandes horizontales par
  groupe (calage temporel conservé — décision utilisateur du 28/06).
- [ ] **C — #16 Filtrer / mettre en évidence** par WP/métier/service **ou par couleur** —
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

---

### Session 8 — Propriétés & jalons enrichis ⏳ À VENIR
**Objectifs** :
- [ ] **#12** Champ texte libre dans les propriétés d'Activité (hypothèses de durée,
  contenu réel de la tâche)
- [ ] **#13** Liste des responsables déjà saisis, proposée à la sélection (orthographe
  cohérente) — autocomplétion / `datalist` alimentée par les valeurs existantes du graphe
- [ ] **#17** Tag de type sur les Jalons : aucun / DOTD / COTD / Ingénierie (affichage distinctif)
- [ ] **#18** Largeur ∝ durée rendue **optionnelle** (toggle) — laisser le choix d'activer
  ou non la proportionnalité (introduite en S2.5)

**Critère de validation** :
Propriétés enrichies utilisables ; jalons taggables ; largeur proportionnelle désactivable.

---

### Session 9 — Exports avancés ⏳ À VENIR
**Objectifs** :
- [ ] **#21** Export Excel (notamment pour faciliter le micro-jalonnement) — s'appuie
  sur l'identifiant unique (#34) de S6
- [ ] **#33** Export Gantt
- [ ] **#7** Destination des sauvegardes/exports : ⚠️ **bridé par `file://`** — le
  navigateur pilote le dossier de téléchargement, pas de sélecteur de chemin possible
  sans serveur. Au mieux : nom de fichier suggéré + dossier Téléchargements. À **expliquer**
  à l'utilisateur plutôt qu'à promettre.

**Écarté / à rediscuter en début de session** :
- **#5** Incrément automatique du n° de version à chaque sauvegarde — l'utilisateur
  lui-même le juge « peut-être une fausse bonne idée ». À trancher avant implémentation.

**Critère de validation** :
Export Excel et Gantt exploitables ; contrainte de destination explicitée à l'utilisateur.

---

### Session 10 — Rendu des liens & layout ⏳ À VENIR
**Objectifs** :
- [ ] **#19** Liens qui ne passent plus sous/sur les activités (routage évitant les nœuds)
- [ ] **#46** Liens droits ou coudés au choix (la grille aimantée du même point est
  couverte par le snap-to-grid de S4)
- [ ] **#15 (suite)** Affiner la réorganisation automatique si la superposition de Label
  n'a pas été entièrement résolue en S5

**Critère de validation** :
Sur un PERT chargé, les liens restent lisibles sans masquer les nœuds.

---

### Session Doc — Manuel utilisateur & documentation de conception/maintenance ⏳ À VENIR (en fin de parcours)
Placée intentionnellement en dernier (décision du 27/06/2026) pour que le manuel illustre
l'application aboutie, sans refaire les captures à chaque ajout de fonctionnalité.
**Objectifs** :
- [ ] **Manuel utilisateur** de PertFlow (prise en main, toolbar, nœuds, calcul PERT,
  import Excel, sauvegarde/export) — illustré de captures d'écran réelles
- [ ] **Document de conception logicielle** : architecture (fichiers `file://`, libs
  locales, modèle de données, moteur PERT, rendu LiteGraph custom), choix techniques
  et leurs justifications (s'appuyer sur ce `CLAUDE.md` et `docs/journal-developpement.md`)
- [ ] **Document de maintenance** : comment reprendre/faire évoluer le projet (pièges
  LiteGraph, contraintes DSI, points de vigilance), pour une reprise par une autre
  personne ou une équipe de l'entreprise

**Captures d'écran** : produites via l'outillage `tools/screenshot.js` (Playwright
local, `file://`) — modes `--app` (UI complète) et `--graph` (planning seul).

**Critère de validation** :
Un nouvel arrivant prend en main l'outil avec le manuel seul ; un développeur tiers
comprend l'architecture et peut intervenir avec la doc de conception/maintenance.

---

### Long terme / écarté (hors roadmap planifiée)
Issu du retour Mickael (27/06/2026), volontairement non planifié :
- **#38** Sous-PERT — fonctionnalité de l'application « pro », beaucoup plus tard
- **#41** Chemin critique affiché seulement « quand nécessaire » — l'utilisateur indique
  **ne pas vouloir le retenir** ; le comportement actuel (re-tracé à la sélection, cf. S2.5)
  est conservé
- **#5** Incrément auto du n° de version — rattaché à S9 mais marqué « à rediscuter »
  (cf. ci-dessus), l'utilisateur doutant lui-même de l'intérêt
- **#3** Estimation rapide du coût d'une activité ou d'un groupe (agrégation) — **retiré
  de S7 le 28/06/2026** : pas indispensable pour un outil PERT KISS, reporté « beaucoup
  plus tard » (décision utilisateur)

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
  → `dist/pertflow.html` (libs+sources inlinés, 0 requête externe, `dist/` gitignoré)
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
