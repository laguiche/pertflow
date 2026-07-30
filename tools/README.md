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
npm test                        # toute la suite (30 tests, ~90 s)
node run-smokes.js -v           # idem, en affichant la sortie de chaque test
node run-smokes.js import s9    # seulement les tests dont le nom contient "import" ou "s9"
node smoke-suivi.js             # un test isolé (c'est ainsi qu'on débogue)
```

Le lanceur rend `0` si tout passe, `1` sinon, et rejoue en fin de compte rendu la sortie des seuls
tests en échec. Chaque `smoke*.js` reste un **programme autonome** : le contrat entre lui et le
lanceur se limite au code de sortie, il n'y a aucun framework de test à apprendre.

**Attendu sur `main` : 30/30.** Un test rouge sur un dépôt fraîchement cloné est un bug, pas une
fatalité — signalez-le.

---

## 3. Jeux d'essai

`test_cases/` rassemble les plannings d'exemple : un classeur au format CPERT (voir plus bas),
des projets `.pert` de complexité croissante, et les exports de référence (CSV, Gantt chargé,
micro-jalonnement) du projet `pert_a_exporter`. La suite en consomme deux, le classeur CPERT et
`pert_a_exporter.pert` ; les autres servent aux essais manuels. Ils sont
**intégralement synthétiques** (« Activité 1 », « toto ») et versionnés : la suite doit tourner sur
un clone nu, sans rien préparer.

> ⚠️ **`test_cases/` est versionné en liste blanche** : le `.gitignore` ignore tout le répertoire,
> puis réautorise chaque fichier nommément. Un planning déposé ici pour un essai n'est donc **pas**
> suivi tant qu'on ne l'a pas décidé — c'est délibéré, et c'est ce qui rend `git add -A` sans
> danger. Avant d'ajouter un `!` pour un fichier Office, **ouvrir son zip** : un classeur transporte
> invisiblement le nom de son auteur, une éventuelle classification, les auteurs des commentaires,
> un serveur d'impression et le chemin complet des classeurs liés (`docProps/`,
> `xl/externalLinks/`, `xl/comments*`, `printerSettings`).

### Le classeur CPERT — fabriqué, pas emprunté

L'import d'un planning **CPERT** est une fonction majeure de PertFlow, et les seuls classeurs
CPERT réels sont des **plannings d'entreprise** : ils ne peuvent pas être publiés. Plutôt que de
laisser cette fonction hors de portée des tests, le dépôt contient un classeur **fabriqué de
toutes pièces** :

```bash
node tools/make-cpert-fixture.js        # → test_cases/cpert_synthetique.xlsx
```

Sept nœuds, sept liens, aucune donnée réelle. Il n'est pas là pour ressembler à un planning, mais
pour **exercer chaque règle de lecture**, y compris les pièges déjà rencontrés : une date placée
avant la durée dans le même nœud (sans motif ancré, `01/11/2026` se lit comme une durée de 1), une
marge indéterminée `2/?`, une décimale à la française `1,5/0`, une date-cible collée au libellé
`… E=(01/06/2027)`. La table en tête du script décrit chaque cas et pourquoi il est là ; c'est
aussi la meilleure documentation du format qui existe.

Le fichier produit est versionné — la suite doit tourner sur un clone nu — et régénérable à
l'identique (`zip -X`, sortie déterministe). C'est un `.xlsx` et non un `.xlsm` : un vrai CPERT
porte l'extension macro parce qu'il embarque la macro de l'outil d'origine, que PertFlow ne lit
jamais. Le sélecteur d'import accepte les deux.

`smoke-cpert.js` s'en sert pour couvrir **toute la chaîne de lecture** — dézippage, feuille
`MANUEL`, résolution feuille → dessin, extraction du DrawingML — là où `smoke-import.js` ne
couvrait que les transformations pures, sur des données fabriquées en mémoire.

**Un vrai CPERT, en plus** : si vous en avez un, `smoke-cpert.js` l'importe aussi, en
non-régression (il exige seulement un planning non vide et sans erreur — son contenu est inconnu
du test). Absent, cette vérification s'annonce comme ignorée et la suite reste verte.

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
node scripts/build-bundle.js --tag v0.21.1
node tools/check-bundle.js v0.21.1     # le tag attendu est comparé à celui inscrit dans le bundle
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

Le plus simple est de copier le smoke le plus proche. Cinq conventions y sont tenues partout :

1. **Passer par `lib.js`** pour tout geste d'interface (import, menu Synthèse…). Un geste
   centralisé se répare une fois quand l'IHM bouge, au lieu de 30 fois.
2. **Emprunter le vrai chemin utilisateur** : cliquer les boutons plutôt qu'appeler les fonctions
   internes. Un test qui appelle directement `pertRecalc()` ne prouve pas que le bouton marche.
3. **Déduire les attendus de la fixture** plutôt que les coder en dur (cf. `smoke-s9.js`) : sinon
   la moindre recomposition d'un jeu d'essai se traduit par un échec qui ne dit rien de la qualité
   du code.
4. **Faire échouer avec un message**, et sortir en code 1 — c'est tout ce que le lanceur regarde.
5. **Vérifier qu'un test neuf sait échouer** : casser volontairement ce qu'il prétend protéger, et
   confirmer que c'est bien *lui* qui rouspète, avant de rétablir. Un test vert du premier coup n'a
   encore rien prouvé — il peut se contenter de mesurer ce que le code fait, quel qu'il soit.
   (Fait pour `smoke-cpert.js` : motif de durée désancré → durée lue 1 au lieu de 3, une seule
   assertion en échec, la bonne.)

Sorties temporaires : `tools/.smoke-out/` (gitignoré) et `/tmp`. Rien à nettoyer à la main.
