# Document de maintenance — PertFlow

Guide pratique pour **reprendre et faire évoluer** PertFlow. À lire avec
[conception.md](conception.md) (architecture) et le `CLAUDE.md` racine (historique détaillé des
sessions et décisions).

---

## 1. Reprendre le projet en 2 minutes

- **Aucun build, aucune installation** pour utiliser l'outil : ouvrez `index.html` (ou
  `dist/pertflow.html`) par double-clic → il s'ouvre en `file://` dans le navigateur.
- **Pour développer**, éditez `index.html`, `src/*.js`, `css/style.css` et rechargez la page.
- Un serveur local (`npx serve .` ou `python -m http.server`) n'est qu'un **confort de dev
  ponctuel** : il ne doit **jamais** devenir nécessaire (voir contraintes ci-dessous).
- Récupérer l'environnement : `npm install` reconstitue `node_modules` (exclu du git).

---

## 2. Contraintes ABSOLUES (à ne jamais enfreindre)

Ces règles découlent du déploiement sur postes DSI verrouillés (ouverture `file://`) :

1. **Pas de modules ES6.** Interdits : `<script type="module">`, `import`/`export`. Le code est
   chargé par des `<script src>` classiques et vit dans le **scope global**.
2. **Pas de `fetch()`/XHR de fichiers locaux.** Lire les fichiers utilisateur avec
   `<input type="file">` + `FileReader`. (Vigilance particulière sur l'import/export.)
3. **Licence MIT uniquement.** Toute nouvelle bibliothèque doit être MIT (ou compatible) et
   **locale** (`lib/`), jamais via CDN. Préférer réutiliser fflate/jsPDF/LiteGraph.
4. **Pas de caractères accentués dans les identifiants ou valeurs de code** (les libellés
   d'affichage peuvent l'être).
5. **Commentaires auto-documentés systématiques** ; ne pas supprimer les commentaires existants
   hors lignes réellement modifiées.

Toute PR qui introduirait un module ES6, un `fetch` local ou une dépendance non-MIT casse le
déploiement cible.

---

## 3. Pièges LiteGraph (déjà rencontrés — à connaître absolument)

| Piège | À faire |
|---|---|
| Masquer la barre de titre d'un nœud | `MonNoeud.title_mode = LiteGraph.NO_TITLE` sur le **constructeur**. `flags.no_title` **ne fait rien**. |
| Rafraîchir le canvas | `LGraphCanvas.setDirty(fg, bg)` ; **`setDirtyCanvas` est sur le graphe / le nœud**, pas sur le canvas. |
| Slots d'entrée dynamiques des nœuds | Connecter deux liens au **même** slot 0 **remplace** le premier. En test, viser des slots successifs ou isoler. |
| Liens du nœud sélectionné forcés en blanc | LiteGraph met `#FFF` via `highlighted_links` → on le vide dans notre `onDrawBackground` pour que nos couleurs de lien priment. |
| Surcharger un comportement | Surcharger sur **l'instance** `LGraphCanvas` (`renderLink`, `getMenuOptions`, `getNodeMenuOptions`) plutôt que patcher `lib/litegraph.js`. |
| Rendu hors-écran (export) | Penser à `graph.detachCanvas(tmp)` après coup (sinon le canvas temporaire reste dans `list_of_graphcanvas`). |
| `<datalist>` natif | Inadapté au « choisir parmi les valeurs existantes » (masqué par `autocomplete=off` sous Firefox ; filtré par la valeur courante sous Edge/Chrome). Utiliser le **menu déroulant custom** (`buildCombobox`). |

---

## 4. Comment ajouter…

### …un réglage de projet

1. Ajouter le champ dans le dialogue **Paramètres** (`index.html`).
2. Lire/écrire dans `openSettings` / `saveSettings` (`ui.js`).
3. **Sérialiser** dans `storage.js` (côté `pertSerializeProject` **et** `pertApplyProject`, avec
   une **valeur par défaut robuste** pour les anciens `.pert`).
4. **Restaurer** dans `history.js` (undo).
5. Si le réglage a un effet visuel immédiat, l'appliquer dans `saveSettings` et au chargement.

*(Exemple récent : `meta.link_mode` en Session 10.)*

### …un format d'export

1. Créer `src/export_<format>.js` qui produit le contenu (réutiliser `pertXlsxBuild` pour un
   Excel, `pertScheduleModel` pour du temps/charge/liens) et télécharge via `pertDownloadBlob`.
2. Appeler `pertRegisterExportFormat({ id, icon, label, desc, order, run })` en fin de fichier.
3. Déclarer le `<script src>` dans `index.html`.

### …un type de nœud

Définir le type dans `nodes.js` (rendu custom, `title_mode`, slots), l'enregistrer auprès de
LiteGraph, l'intégrer au moteur si pertinent (`pert_engine.js`) et à la sérialisation.

---

## 5. Outillage de validation (`tools/`)

> ⚠️ Le dossier **`tools/` est gitignoré** (outillage de dev, hors livraison). Il contient
> `playwright-core` + un Chromium local. `npx playwright install chromium` si absent.

- **Smoke tests** headless en navigateur réel (`file://`) : `tools/smoke.js` (parcours général)
  et un `tools/smoke-sN.js` par session. Ils pilotent l'app via Playwright et vérifient l'absence
  d'erreur console. Modèle de validation systématique avant clôture de session.
- **Captures d'écran de doc** : `tools/screenshot.js` (`--app` / `--graph`) et `tools/doc-shots.js`
  (jeu de captures du manuel dans `docs/images/manuel/`).
- Certains tests attendent `C_PERT_exemple.xlsm` à la racine ; les fichiers d'exemple vivent dans
  `test_cases/` (**non versionné**) → copie temporaire à la racine pour lancer ces tests.

Validation « pure Node » possible quand Playwright est indisponible (le moteur PERT est du JS sans
DOM ; on stube `window`).

### Documentation : Markdown (base) + HTML autonome + PDF

Les documents (`docs/*.md`) sont la **source**. Pour **chaque** document, on génère aussi une
**version HTML autonome** (images embarquées en data-URI, consultable hors ligne d'un double-clic)
et un **PDF**. Ces sorties `docs/*.html` et `docs/*.pdf` sont **versionnées** (livrables).

- **Régénérer** après toute modification d'un `.md` : `node tools/build-docs.js`.
- Chaîne : `tools/_md2html.py` (python-markdown → HTML autonome + CSS d'impression, images en
  data-URI) puis Chromium headless (Playwright) → PDF A4.
- Prérequis : `pip install markdown` + le Chromium de Playwright.
- Captures du manuel : `node tools/doc-shots.js` (régénère `docs/images/manuel/`).

> Règle : à chaque évolution d'un document, régénérer HTML **et** PDF, et les committer avec le
> `.md`.

---

## 6. Git, versionnage et rituel de fin de session

- **Branche par session** (`session/N-...` ou `fix/...`), merge **no-ff** sur `main`, **tag** en
  fin de session.
- ⚠️ **Numérotation des tags décalée** : `vN ≠ SN` (la Session 2.5 et plusieurs lots de correctifs
  ont consommé des tags). Se fier à l'historique des tags, pas au numéro de session. Les
  correctifs successifs sur une session déjà taguée utilisent un **schéma patch `vX.Y.Z`**.
- **Format de commit** : trois paragraphes (résumé bref / description fonctionnelle avec le
  *pourquoi* / liste des fichiers et changements). Préfixe `[Plugin]` si LaBotBox/Simulia (sans
  objet ici).

### Rituel de fin de session (obligatoire)

À chaque clôture, **avant** le commit final :

1. **Mettre à jour la documentation** (`CLAUDE.md`, `docs/journal-developpement.md`, mémoire) —
   **avant** le push.
2. **Régénérer le bundle** avec le tag de la session :
   `node scripts/build-bundle.js --tag vX.Y`.
3. **Committer + pousser le bundle** (`dist/pertflow.html`, **versionné**) avec le reste.
4. Le bundle embarque le bouton **« À propos »** (© Stéphane Guichard, licence MIT, date de
   génération et tag) : ces valeurs sont injectées par le build dans `window.PERTFLOW_BUILD` —
   **ne jamais les coder en dur**.

Ordre : finaliser code/doc → régénérer bundle (`--tag`) → committer (source + bundle) → pousser →
merger sur `main` → taguer → pousser le tag.

---

## 7. Points de vigilance divers

- **Ne pas versionner** `test_cases/` ni `tools/` (déjà gitignorés). Éviter `git add -A` aveugle
  (préférer `git add <fichiers>` explicites) pour ne pas committer un `.xlsm` d'exemple.
- **`console.log` fonctionne** ici (contrairement à l'intégration LaBotBox du dépôt jumeau) ; mais
  en `file://` l'utilisateur final n'a pas la console → passer par `showToast`/`showError`.
- **Compatibilité navigateur** : cible Chrome/Edge/Firefox récents. Les contrôles « natifs »
  (`<datalist>`, `<option>` colorées) se comportent différemment d'un navigateur à l'autre →
  privilégier des composants DOM/CSS maison (pattern déjà en place).
- **Le `.pert` doit rester rétro-compatible** : toute nouvelle clé `meta` a une valeur par défaut
  à la lecture (anciens fichiers).

---

## 8. Où trouver quoi

| Je cherche… | Fichier |
|---|---|
| L'historique détaillé et les décisions de chaque session | `CLAUDE.md` (racine) |
| Le récit de développement (restitution) | `docs/journal-developpement.md` |
| Le manuel utilisateur | `docs/manuel-utilisateur.md` |
| L'architecture et les choix techniques | `docs/conception.md` |
| Le calcul PERT | `src/pert_engine.js` |
| Le rendu des nœuds / liens | `src/nodes.js`, `src/link_routing.js` |
| Les exports | `src/export*.js` |
| La sérialisation / l'undo / l'autosave | `src/storage.js`, `history.js`, `autosave.js` |
