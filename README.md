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

- [LiteGraph.js](https://github.com/jagenjo/litegraph.js) (MIT) — moteur de graphe canvas
- [jsPDF](https://github.com/parallax/jsPDF) (MIT) — export PDF
- [fflate](https://github.com/101arrowz/fflate) (MIT) — zip/dézip des imports et exports Excel

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
npm test          # 29 tests, ~85 s
```

Tout est détaillé dans [`tools/README.md`](tools/README.md) — y compris pourquoi aucun fichier
d'exemple CPERT n'est fourni, et comment fournir le vôtre.

Pour reprendre le projet : [`docs/maintenance.md`](docs/maintenance.md) (reprise pratique,
pièges connus, rituel de version) et [`docs/conception.md`](docs/conception.md) (architecture
et justification des choix).

## Téléchargement

La dernière version prête à l'emploi (application + manuel) est publiée dans
[Releases](https://github.com/laguiche/pertflow/releases) : télécharger l'archive,
la dézipper, double-cliquer sur `pertflow.html`.

## Licence

[MIT](LICENSE) — © Stéphane Guichard.
Les bibliothèques tierces embarquées (LiteGraph.js, jsPDF, fflate) sont également MIT.
