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
│   ├── t0_marker.js    # Repère T0 + bande « travaux anticipés » (2 couches de rendu)
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
  // Cible (optionnelle), v0.16 : DEUX modes de saisie exclusifs, les deux valeurs
  // cohabitent (basculer de mode ne detruit pas l'autre saisie).
  due_mode: "date",        // "date" | "offset"
  due_date: "2025-06-01",  // mode "date"   : date butée calendaire
  due_offset: null,        // mode "offset" : T0 + X unités (X négatif = avant T0)
  // Ne JAMAIS relire due_date directement : passer par pertMilestoneHasDue /
  // pertMilestoneDueOffset / pertMilestoneDueLabel (pert_engine.js).
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
- **Calcul interne en unités** (offset depuis T0) ; conversion en dates calendaires à l'affichage. **Chaque unité est comptée dans son arithmétique naturelle, jamais via un facteur fixe en jours** : **`mois` = mois CALENDAIRES réels** (via `Date.setMonth`, longueurs de mois et bissextiles gérées) — PAS un facteur fixe 30 j (corrigé pré-S8 : le facteur 30 dérivait de ~6 j/an, gênant sur les projets longs) ; **`sem` = N × 7 jours calendaires exacts** (une semaine reste une semaine, elle n'est pas décomposée en 5 jours ouvrés parcourus un par un) ; **`j` = jours OUVRÉS** (samedis/dimanches sautés ; **jours fériés comptés comme ouvrés**, assumé — lot 1 du 08/07/2026, cf. « Refonte de l'import »). Une date tombant un week-end (T0, date-cible de jalon) est **recalée sur le jour ouvré suivant**, et seulement en unité `j`. Cohérence sem/j : depuis un jour de semaine, +5 jours ouvrés == +7 jours calendaires. On convertit toujours l'offset cumulé depuis T0 (jamais pas-à-pas) → conversions inversibles et sans dérive. Implémentation : `pertAddUnits` / `pertOffsetToDate` / `pertDateToOffset` (+ `pertWorkdayIndex` / `pertWorkdayFromIndex`, formule O(1)) dans `pert_engine.js`.
- **ES** du premier nœud = T0
- **EF** = ES + durée
- **ES** d'un nœud = max(EF de tous ses prédécesseurs)
- **LF** du dernier nœud = son EF (pas de marge sur le nœud final)
- **LS** = LF - durée
- **LF** d'un nœud = min(LS de tous ses successeurs)
- **Marge (slack)** = LF - EF (exprimée en unités, pas en jours calendaires)
- **Chemin critique** = tous les nœuds avec slack == 0

### Cas particuliers
- Nœud sans **aucun** prédécesseur → ES = T0. **T0 n'est PAS un plancher** (v0.16) : un nœud qui a des prédécesseurs hérite d'eux, offsets **négatifs compris**. T0 est l'origine contractuelle de l'axe des temps, pas la borne inférieure du planning.
- **ANTICIPATION (v0.16)** : des travaux peuvent être engagés **avant T0** (offsets négatifs) pour gagner de la marge en aval. Deux expressions complémentaires — (1) **jalon entrant daté avant T0** (la décision devient un objet visible du graphe : « déblocage du budget d'anticipation ») ; (2) propriété `anticipated` d'une Activité → planifiée **au plus tard** (juste-à-temps), son ES est tiré par l'aval et ne décale pas celui-ci. Une anticipation infaisable (prédécesseur non tiré trop tardif) est **rétrogradée** au plus tôt : la précédence prime toujours. Propriété : `slack(tâche anticipée) == slack(successeur)` → jamais de faux critique. Implémentation : `pertForwardPass` (2 passes + contrôle de faisabilité).
- **Jalon ENTRANT** (corrigé pré-S8) : un Jalon **sans lien entrant + avec lien sortant + cible** modélise une contrainte externe (livraison prototype, jalon client/fournisseur, déblocage de budget…) → son `ES = EF = offset(cible)`, **négatif admis** (le plancher à T0 a été levé en v0.16), au lieu de démarrer à T0. La tâche en aval ne part donc pas automatiquement à T0. La topologie (aucun entrant + un sortant) distingue ce cas du jalon terminal et du checkpoint intermédiaire. Implémenté dans le forward pass de `pertRecalc`.
- **La cible d'un jalon entrant ne borne PAS son LF** (v0.16) : c'est une **donnée d'entrée**, pas une échéance à tenir. La compter deux fois lui donnait marge 0 systématique et lui faisait capturer le chemin critique dès que le projet dégageait de la marge. `target_missed` reste faux pour un jalon d'entrée.
- Jalon (non entrant) avec cible → LF = min(cible calculée, LF propagée)
- Checkpoint intermédiaire (Jalon avec prédécesseur(s)) : la cible ne borne que le LF, elle ne force PAS l'ES (qui reste = max EF des prédécesseurs)
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

**Coût anticipé (v0.16)** : part du coût d'une Activité située **avant T0**, au **PRORATA** de sa
durée (`pertAnticipatedShare` / `pertAnticipatedCost`). Le prorata **ventile** le coût de part et
d'autre de T0, il ne le réduit JAMAIS : `anticipé + non anticipé = coût global`, pour chaque groupe
comme pour le projet. Affiché en barre d'état (« dont anticipé »), dans le panneau (« Avant T0 » +
« Coût anticipé ») et **par groupe** dans la synthèse (colonnes *Coût global / dont anticipé / dont
non anticipé*). **Décision utilisateur** : la marge des jalons n'est JAMAIS décomposée — on lit la
marge PERT de l'enchaînement complet, anticipation comprise, et rien d'autre.

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

### Rendu de fond / d'avant-plan du CANVAS (v0.16)
- `LGraphCanvas.onDrawBackground` / `onDrawForeground` sont appelés dans le repère **graphe**
  (transformation zoom/pan déjà appliquée) → mêmes coordonnées que `node.pos`.
- **PIÈGE** : `ui.js` **affecte** `onDrawBackground` (grille aimantée). Tout module qui veut
  s'y greffer doit **chaîner** le handler existant ET être installé **APRÈS** lui, sinon il est
  purement écrasé — sans la moindre erreur. Cf. `pertInstallT0Marker`, installé juste après le
  handler de grille. Un test de *présence* du handler ne détecte pas ce cas : tester les **pixels**.
- Ce qui doit passer **par-dessus les nœuds** (repère T0…) va en `onDrawForeground` : en fond, il
  disparaît derrière le premier nœud qui le chevauche.

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

## ÉTAT D'AVANCEMENT

> **Roadmap S1 → Doc TERMINÉE.** Dernier tag : **v0.16** (24/07/2026).
> **Le récit détaillé de chaque session vit dans [`docs/historique-sessions.md`](docs/historique-sessions.md)** —
> décisions d'implémentation, pièges rencontrés, validations. Ce tableau n'en est
> que l'index. **À la clôture d'une session : détail dans l'archive, UNE ligne ici.**
>
> Rappels utiles hérités de l'historique (déjà intégrés aux règles durables ci-dessus) :
> jalons entrants, mois calendaires réels, unité « jour » = jours ouvrés, coût dérivé
> (ETP × taux, panneau/barre d'état seulement), filtre = état de vue non sérialisé.
> Tags décalés : `vN ≠ SN` (S2.5 a consommé un tag). Numérotation patch `vX.Y.Z` pour
> les évolutions mineures.

| Session / chantier | Tag | Résumé |
|---|---|---|
| S0–S1 Socle canvas + nœuds | v0.1 | LiteGraph, nœuds Activité/Jalon/Label, toolbar, panneau, connexions |
| S2 Moteur PERT | v0.2 | Forward/backward pass, marges, chemin critique, cycles, recalc auto |
| S2.5 Visualisation & lisibilité | v0.3 | Réorg chronologique, largeur ∝ durée, Jalon refondu, tracé chemin critique |
| S3 Persistance / import Excel / export | v0.4 | Import `.xlsm` legacy, `.pert` JSON, export PNG/PDF, copier-coller |
| S4 Finitions UX & packaging | v0.5 | Undo/redo, menus FR, snap-to-grid, toasts, bundle `dist/pertflow.html` |
| S5 Correctifs & quick wins (Mickael) | v0.6 | #25/#26/#29/#8/#20/#15 + chemin critique = marge minimale |
| S6 Regroupement métier WP (temps 1) | v0.7 | uid auto (#34), dimension groupe (#2), couleur de groupe (#14/#4) |
| S7 Couleur/groupe fonctions de base | v0.8 | Import conscient du groupe, réorg couloirs groupés, filtre #16 |
| Correctifs pré-S8 | v0.9 | Jalons entrants (moteur + import E), mois calendaires réels |
| S8 Propriétés & jalons enrichis | v0.10 | Notes (#12), tag Jalon DOTD/COTD/ING (#17), largeur ∝ durée optionnelle (#18) |
| S8.5 Estimation des coûts (#3) | v0.11 | ETP saisi + coût dérivé, panneau + barre d'état, jamais sur le nœud |
| Correctifs pré-S9 | v0.12 → v0.12.3 | Import marge `?`, sélecteur groupe custom, ergonomie/autosave, filtre voile sombre + axe responsable |
| S9 Exports avancés (#21/#33) | v0.13 | 1 bouton Exporter → CSV / Gantt xlsx / micro-jalons xlsx / MSPDI XML (writer xlsx maison) |
| S10 Rendu des liens & layout (#46/#19) | v0.14 | 3 styles de liens `meta.link_mode`, coudé = routage orthogonal contournant |
| Session Doc | v0.14 (sans tag) | Manuel + conception + maintenance, 3 formats (md/html/pdf) |
| Post-roadmap : réorg enchaînements + clic-glisser | v0.14.1 | Réorg par composante connexe + packing compact ; multi-sélection sans SHIFT |
| Refonte import lot 1 : jour ouvré | v0.14.2 | Unité « jour » = jours ouvrés (moteur, 3 fonctions) |
| Refonte import lot 2 : multi-format | v0.15 | 1 bouton Importer (CPERT/.pert), T0 = min + ancrage, unité jamais écrasée |
| Peaufinage notes Jalon & Label | v0.15.1 | Notes de Jalon, gel taille manuelle Label, police réglable |
| Peaufinage réorg/Labels/alignement | v0.15.2 | Réorg « axe temps seul », mise en forme Labels, boîte d'alignement `src/align.js` |
| Manuel v0.15.2 + case panneau | v0.15.3 | MàJ manuel (8 captures) + correctif case « gras » du panneau Label |
| Fenêtre de synthèse + impression PDF | v0.15.4 | Bouton `📊 Synthèse` → modale (vue d'ensemble, jalons tenus/non tenus + marge, coût/LF par groupe), imprimable en PDF (`src/synthesis.js`) |
| Anticipation avant T0 + cible en « T0+X » | v0.16 | Offsets négatifs légaux (T0 = origine, plus un plancher) ; case « tâche anticipée » ; cible de jalon en date **ou** T0±X ; repère T0 + coût anticipé au prorata |
| Date-cible des jalons prise en compte | v0.15.5 | `pertTimeAxisOffset` (cible → sinon ES) : réorg « axe temps seul » place le jalon sur sa cible ; listes de jalons de la synthèse triées chronologiquement |

**Long terme / écarté** (retour Mickael, non planifié) : #38 sous-PERT · #41 chemin
critique « à la demande » (l'utilisateur ne veut PAS le retenir, comportement actuel
conservé) · #5 auto-incrément du n° de version (« peut-être fausse bonne idée »).
Agrégation de coût **par groupe** non faite (total projet / visible / chemin critique
seulement) — extension possible.

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

