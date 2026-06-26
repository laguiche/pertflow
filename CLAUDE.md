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
> **découpé en 2 temps** (S6 dimension+couleur, S7 filtre+coût) ; **doc en dernier**.
>
> Roadmap effective : **S1 ✅ → S2 ✅ → S2.5 ✅ → S3 ✅ (dont import Excel) → S4 (en
> cours) → S5 (correctifs & quick wins) → S6/S7 (regroupement métier WP) → S8
> (propriétés & jalons enrichis) → S9 (exports avancés) → S10 (liens & layout) → Doc (fin)**.

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

### Session 4 — Finitions UX et packaging ⏳ EN COURS
**Objectifs** :
- [x] **Undo/Redo** (26/06/2026) — historique par snapshots (`src/history.js`)
- [ ] Menu contextuel clic droit
- [ ] Snap-to-grid (optionnel)
- [ ] Gestion des erreurs UI
- [ ] Toolbar avec icônes
- [ ] HTML standalone bundlé

**Critère de validation** :
Test utilisateur métier sans assistance.

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

---

### Session 5 — Correctifs & quick wins (retour utilisateur Mickael) ⏳ À VENIR
Issue du 2e retour utilisateur du 27/06/2026 (`remarques_mickael`). Petits efforts,
forte satisfaction perçue, faible risque — traités en premier (arbitrage utilisateur).
**Objectifs** :
- [ ] **#25 (bug)** Cohérence linguistique : supprimer le mélange français/anglais dans l'UI
- [ ] **#26 (bug)** Dernier lien du chemin critique non coloré en rouge — corriger la
  remontée des prédécesseurs jusqu'au nœud terminal (la fonction de tracé existe depuis S2.5)
- [ ] **#29 (bug)** Export PDF : améliorer la définition et réduire le poids du fichier
- [ ] **#8** Revoir l'affichage du responsable dans le nœud Activité
- [ ] **#20** Coin du Jalon en vert quand la cible est tenue avec marge suffisante
  (symétrique du rouge « cible non tenue » déjà en place)
- [ ] **#15** Réorganisation : empêcher qu'un Label se retrouve superposé à une activité
- [ ] **#28 (bug)** Neutraliser la barre de recherche LiteGraph au double-clic sur le fond
  (si non déjà traité dans le nettoyage clic droit de S4)

**Critère de validation** :
L'utilisateur métier ne relève plus #25/#26/#28/#29 ; rendu validé en navigateur réel.

---

### Session 6 — Regroupement métier (WP/service), temps 1 : dimension + couleur ⏳ À VENIR
Chantier transversal majeur du retour Mickael — une seule fonctionnalité de fond
derrière 5 remarques (#2, #3, #4, #14, #16), **découpée en 2 temps** (S6 puis S7,
arbitrage utilisateur). Temps 1 = modèle de données + restitution visuelle.
**Objectifs** :
- [ ] **#34** Identifiant unique par Activité — brique de fondation (micro-jalonnement,
  exports Excel/Gantt). Champ affiché et éditable, stable à la sérialisation
- [ ] **#2** Dimension « groupe » sur l'Activité au-delà du responsable :
  WP / métier / service (champ dédié dans le panneau propriétés)
- [ ] **#14** Couleur associée à un groupe + mémorisation des couleurs choisies
  (palette persistante, réutilisable rapidement)
- [ ] **#4** Harmonisation visuelle : les activités d'un même groupe partagent une teinte
  → zones par WP/métier lisibles « de loin » sur un PERT chargé

**Point de conception à figer en début de session** : modèle du « groupe » (attribut
texte libre vs liste gérée), et articulation avec la couleur d'import existante
(`IMPORT_COLOR_PALETTE` / `pickDefaultImportColor`) pour éviter deux systèmes de couleur.

**Critère de validation** :
Sur un PERT chargé, les zones par WP/métier sont identifiables d'un coup d'œil par la couleur.

---

### Session 7 — Regroupement métier (WP/service), temps 2 : filtre + coût ⏳ À VENIR
Suite de S6 sur la même dimension « groupe ».
**Objectifs** :
- [ ] **#16** Filtrer / mettre en évidence par WP/métier/service ou par couleur
- [ ] **#3** Estimation rapide du coût d'une activité ou d'un groupe d'un même WP/métier
  (agrégation) — **périmètre à confirmer** : l'utilisateur le note « peut-être hors scope »

**Critère de validation** :
L'utilisateur isole visuellement un WP et obtient une estimation agrégée.

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

### Session 4 (26/06/2026) — en cours
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
- **Reste à faire** : menu contextuel clic droit, snap-to-grid, gestion erreurs UI,
  icônes toolbar, bundle HTML standalone
