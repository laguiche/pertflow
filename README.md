# PertFlow

Outil de planification PERT — prototype web standalone (100% offline).

## Prérequis

- Un navigateur récent (Chrome ou Edge recommandé)
- Aucune installation requise

## Lancer l'application

Ouvrir `index.html` directement dans le navigateur, ou via un serveur local si besoin :

```bash
npx serve .
# ou
python -m http.server 8080
```

## Stack

- [LiteGraph.js](https://github.com/jagenjo/litegraph.js) (MIT, build **`core`**) — moteur de graphe canvas
- [jsPDF](https://github.com/parallax/jsPDF) (MIT) — export PDF
- [fflate](https://github.com/101arrowz/fflate) (MIT) — zip/dézip des imports et exports Excel

Les trois bibliothèques sont **embarquées dans le fichier livré** — aucune n'est chargée depuis le
réseau. Leurs licences voyagent avec la livraison (`LICENCES-TIERCES.txt`).

## Sécurité

L'application est destinée à des postes administrés. Le fichier livré déclare une **politique de
sécurité de contenu** (`connect-src 'none'`) : le navigateur lui interdit toute sortie réseau,
quel que soit le code. Les contrôles se rejouent sur n'importe quelle version :

```bash
node tools/audit-securite.js     # empreintes, provenance npm, vulnérabilités OSV,
                                 # reproductibilité, comportement observé → rapport HTML + PDF
```

Détail dans [`tools/README.md`](tools/README.md) §4 bis et [`docs/conception.md`](docs/conception.md) §9.

## Structure

```
pertflow/
├── index.html
├── lib/          # Bibliothèques tierces (LiteGraph, jsPDF, fflate)
├── src/          # Code source de l'application
├── css/          # Styles
├── docs/         # Manuel utilisateur, conception, maintenance (MD + HTML + PDF)
├── scripts/      # Fabrication du bundle standalone et de l'archive de livraison
├── tools/        # Suite de tests et captures d'écran (développement)
└── dist/         # pertflow.html — le bundle autoporteur, effectivement livré
```

## Développer et modifier PertFlow

Il n'y a **rien à installer pour développer** : éditez `src/*.js`, `css/style.css` ou
`index.html`, puis rechargez la page. Pas de build, pas de transpilation, pas de framework —
et [des contraintes à respecter absolument](docs/maintenance.md#2-contraintes-absolues-à-ne-jamais-enfreindre)
(pas de module ES6, pas de `fetch` local), sous peine de casser l'ouverture en `file://`.

Une **suite de tests** pilote l'application dans un vrai navigateur et vérifie ce qu'elle
affiche et exporte. Elle demande, elle, une petite installation :

```bash
cd tools && npm install && npx playwright install chromium
npm test          # 34 tests, ~95 s
```

Tout est détaillé dans [`tools/README.md`](tools/README.md) — y compris pourquoi aucun fichier
d'exemple CPERT n'est fourni, et comment fournir le vôtre.

Pour reprendre le projet : [`docs/maintenance.md`](docs/maintenance.md) (reprise pratique,
pièges connus, rituel de version) et [`docs/conception.md`](docs/conception.md) (architecture
et justification des choix).

## Téléchargement

La dernière version prête à l'emploi (application, manuel et notes de version) est publiée dans
[Releases](https://github.com/laguiche/pertflow/releases) : télécharger l'archive,
la dézipper, double-cliquer sur `pertflow.html`.

## Licence

[MIT](LICENSE) — © Stéphane Guichard.
Les bibliothèques tierces embarquées (LiteGraph.js, jsPDF, fflate) sont également MIT.
