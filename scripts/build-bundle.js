#!/usr/bin/env node
// ─── Génération du bundle HTML standalone — Session 4 ───────────────────────────
//
// Produit un fichier unique `dist/pertflow.html` embarquant TOUT (CSS + JS des
// libs + sources) en ligne, pour distribution / archivage. La structure de travail
// (index.html + src/ + lib/ + css/) reste le format de développement ; le bundle
// n'est qu'un artefact de livraison, régénéré à la demande.
//
// Contrainte file:// : le bundle s'ouvre par double-clic, sans serveur. Comme tout
// est inliné, il n'y a aucune requête réseau ni chargement de fichier — compatible
// avec les contraintes DSI (cf. CLAUDE.md). Aucune dépendance npm : Node natif seul.
//
// Usage :  node scripts/build-bundle.js

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC_HTML = path.join(ROOT, "index.html");
const OUT_DIR = path.join(ROOT, "dist");
const OUT_HTML = path.join(OUT_DIR, "pertflow.html");

// Lit un fichier référencé relativement à la racine du projet.
function readAsset(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.readFileSync(abs, "utf8");
}

// Neutralise toute séquence pouvant clore prématurément la balise hôte
// (ex. "</script>" présent dans un libellé minifié → "<\/script>").
function escapeForScript(js) {
  return js.replace(/<\/script>/gi, "<\\/script>");
}
function escapeForStyle(css) {
  return css.replace(/<\/style>/gi, "<\\/style>");
}

function build() {
  let html = fs.readFileSync(SRC_HTML, "utf8");

  // 1) Inline des feuilles de style : <link rel="stylesheet" href="X"> → <style>…</style>
  html = html.replace(
    /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/gi,
    (match, href) => {
      const css = escapeForStyle(readAsset(href));
      return `<style>\n/* ${href} */\n${css}\n</style>`;
    }
  );

  // 2) Inline des scripts : <script src="X"></script> → <script>…</script>
  html = html.replace(
    /<script\s+src="([^"]+)"\s*>\s*<\/script>/gi,
    (match, src) => {
      const js = escapeForScript(readAsset(src));
      return `<script>\n/* ${src} */\n${js}\n</script>`;
    }
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_HTML, html, "utf8");

  const sizeKB = (Buffer.byteLength(html, "utf8") / 1024).toFixed(0);
  console.log("Bundle généré : " + path.relative(ROOT, OUT_HTML) + " (" + sizeKB + " Ko)");

  // Garde-fou : aucune référence externe résiduelle (sinon échec en file://).
  const leftover = html.match(/(?:src|href)="(?:lib\/|src\/|css\/)[^"]+"/g);
  if (leftover) {
    console.error("ATTENTION — références externes non inlinées : " + leftover.join(", "));
    process.exit(1);
  }
}

build();
