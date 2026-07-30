# tools/ — validation et captures d'écran (outillage de développement)

PertFlow n'a **ni build ni dépendance** : c'est tout l'intérêt de l'outil, et c'est aussi ce qui
rend une modification difficile à valider autrement qu'à l'œil. Ce répertoire comble ce manque.
Il pilote l'application **dans un vrai Chromium, ouvert en `file://`** — exactement le mode de
déploiement cible — et vérifie ce qu'elle affiche et ce qu'elle exporte.

Rien ici n'est livré à l'utilisateur final : l'archive de release ne contient que le bundle et le
manuel. En revanche **tout ici est versionné**, car c'est le seul moyen pour un repreneur de
prouver qu'il n'a rien cassé.

---

## 1. Prérequis

| Quoi | Pourquoi | Installation |
|---|---|---|
| **Node.js ≥ 18** | exécute les tests (validé sur Node 24) | paquet système |
| **`playwright-core`** | pilotage du navigateur | `cd tools && npm install` |
| **Chromium de Playwright** | le navigateur réellement piloté (~380 Mo dans `~/.cache/ms-playwright`, hors dépôt) | `npx playwright install chromium` |
| **python3 + `markdown`** | **uniquement** pour `build-docs.js` (génération HTML/PDF de la doc) | `pip install markdown` |

Le navigateur n'est **pas** le paquet `playwright` complet mais `playwright-core` + le binaire du
cache : la même installation sert à toutes les sessions et n'alourdit pas le dépôt. `lib.js`
retrouve seul la version de Chromium la plus récente présente dans le cache.

Vérification en une commande :

```bash
cd tools && npm install && npx playwright install chromium && npm test
```

---

## 2. Lancer la suite

```bash
cd tools
npm test                        # toute la suite (29 tests, ~85 s)
node run-smokes.js -v           # idem, en affichant la sortie de chaque test
node run-smokes.js import s9    # seulement les tests dont le nom contient "import" ou "s9"
node smoke-suivi.js             # un test isolé (c'est ainsi qu'on débogue)
```

Le lanceur rend `0` si tout passe, `1` sinon, et rejoue en fin de compte rendu la sortie des seuls
tests en échec. Chaque `smoke*.js` reste un **programme autonome** : le contrat entre lui et le
lanceur se limite au code de sortie, il n'y a aucun framework de test à apprendre.

**Attendu sur `main` : 29/29.** Un test rouge sur un dépôt fraîchement cloné est un bug, pas une
fatalité — signalez-le.

---

## 3. Jeux d'essai

`test_cases/` rassemble les plannings d'exemple : projets `.pert` de complexité croissante, et les
exports de référence (CSV, Gantt chargé, micro-jalonnement) du projet `pert_a_exporter`. La suite
n'en consomme qu'un, `pert_a_exporter.pert`, mais tous servent aux essais manuels. Ils sont
**intégralement synthétiques** (« Activité 1 », « toto ») et versionnés : la suite doit tourner sur
un clone nu, sans rien préparer.

> ⚠️ **`test_cases/` est versionné en liste blanche** : le `.gitignore` ignore tout le répertoire,
> puis réautorise chaque fichier nommément. Un planning déposé ici pour un essai n'est donc **pas**
> suivi tant qu'on ne l'a pas décidé — c'est délibéré, et c'est ce qui rend `git add -A` sans
> danger. Avant d'ajouter un `!` pour un fichier Office, **ouvrir son zip** : un classeur transporte
> invisiblement le nom de son auteur, une éventuelle classification, les auteurs des commentaires,
> un serveur d'impression et le chemin complet des classeurs liés (`docProps/`,
> `xl/externalLinks/`, `xl/comments*`, `printerSettings`).

### Le fichier CPERT (`.xlsm`) — absent, volontairement

L'import d'un planning **CPERT** est une fonction majeure de PertFlow, mais les seuls fichiers
CPERT existants sont des **plannings d'entreprise** : ils ne peuvent pas être publiés. Le dépôt
n'en contient donc aucun, et n'en contiendra pas.

Conséquence : deux vérifications se désactivent d'elles-mêmes, sans faire échouer la suite —

- `smoke.js` étape 1 (import CPERT) : se rabat sur la fixture `.pert`, les étapes 2 à 8
  (persistance, exports, copier-coller, Label) restent jouées ;
- `smoke-import.js` assertion 11 (non-régression sur l'unité du projet).

Toute la logique de transformation CPERT reste couverte, elle : `smoke-import.js` teste les
fonctions pures (`buildImportModel` et consorts) sur des données fabriquées en mémoire. Ce que ces
deux étapes ajoutent, c'est la lecture réelle du fichier Excel (dézippage, DrawingML).

**Pour les activer**, fournir son propre export CPERT :

```bash
cp mon_planning.xlsm test_cases/C_PERT_exemple.xlsm    # non suivi : hors liste blanche
# ou, sans rien déplacer :
PERTFLOW_CPERT=/chemin/vers/mon_planning.xlsm npm test
```

Le fichier déposé n'est pas suivi par git, et n'a pas à l'être : c'est le vôtre.

---

## 4. Vérifier le bundle livré

`dist/pertflow.html` est ce qui est réellement distribué. Un module oublié à l'inlining ou un ordre
de scripts différent ne se verrait pas en testant `index.html` :

```bash
node scripts/build-bundle.js --tag v0.21
node tools/check-bundle.js v0.21       # le tag attendu est comparé à celui inscrit dans le bundle
```

Hors de `run-smokes.js` à dessein : ce test porte sur un artefact **construit**, il n'a de sens
qu'après un build.

---

## 5. Captures d'écran

| Script | Sortie | Usage |
|---|---|---|
| `doc-shots*.js` | `docs/images/manuel/` (versionné) | illustrations du manuel utilisateur |
| `shots-*.js` | `/tmp/shots-*/` | captures de **relecture**, pour valider une évolution à distance |
| `screenshot.js` | fichier au choix | capture ponctuelle : `node screenshot.js out.png --graph` |
| `build-docs.js` | `docs/*.html` + `docs/*.pdf` | régénère la doc distribuable depuis les `.md` |

`screenshot.js` accepte `--app` (défaut, UI complète) ou `--graph` (planning seul, fond blanc),
`--xlsm <f>` pour importer d'abord un planning, `--no-fit`, `--scale N`.

---

## 6. Écrire un nouveau test

Le plus simple est de copier le smoke le plus proche. Quatre conventions y sont tenues partout :

1. **Passer par `lib.js`** pour tout geste d'interface (import, menu Synthèse…). Un geste
   centralisé se répare une fois quand l'IHM bouge, au lieu de 29 fois.
2. **Emprunter le vrai chemin utilisateur** : cliquer les boutons plutôt qu'appeler les fonctions
   internes. Un test qui appelle directement `pertRecalc()` ne prouve pas que le bouton marche.
3. **Déduire les attendus de la fixture** plutôt que les coder en dur (cf. `smoke-s9.js`) : sinon
   la moindre recomposition d'un jeu d'essai se traduit par un échec qui ne dit rien de la qualité
   du code.
4. **Faire échouer avec un message**, et sortir en code 1 — c'est tout ce que le lanceur regarde.

Sorties temporaires : `tools/.smoke-out/` (gitignoré) et `/tmp`. Rien à nettoyer à la main.
