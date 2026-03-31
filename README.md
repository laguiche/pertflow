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

## Structure

```
pertflow/
├── index.html
├── lib/          # Bibliothèques tierces (LiteGraph, jsPDF)
├── src/          # Code source de l'application
└── css/          # Styles
```
