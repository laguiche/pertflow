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
> - Undo/Redo et copier/coller reportés en fin de parcours (Session 4).
>
> Roadmap effective : **S1 ✅ → S2 ✅ → S2.5 → S3 (dont import Excel) → S4**.

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

### Session 3 — Persistance, import Excel & export ⏳ À VENIR
**Objectifs** :
- [ ] **#8 Import des plannings legacy Excel** (🔴 URGENT) — approche à décider sur fichier exemple (lecture `.xlsx` directe vs gabarit d'import) + **concaténation** dans un PERT existant
- [ ] Sauvegarde/chargement JSON (.pert)
- [ ] Export PNG
- [ ] Export PDF
- [ ] Copier/coller nœuds
- [ ] Nœud Label opérationnel

**Critère de validation** :
Importer un planning Excel réel et le concaténer. Sauvegarder, recharger, vérifier intégrité. Exporter PNG et PDF lisibles.

---

### Session 4 — Finitions UX et packaging ⏳ À VENIR
**Objectifs** :
- [ ] Undo/Redo
- [ ] Menu contextuel clic droit
- [ ] Snap-to-grid (optionnel)
- [ ] Gestion des erreurs UI
- [ ] Toolbar avec icônes
- [ ] HTML standalone bundlé
- [ ] Guide utilisateur 1 page

**Critère de validation** :
Test utilisateur métier sans assistance.

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
