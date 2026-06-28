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
// Le bundle embarque ses métadonnées de version (date de génération + tag de la
// branche main) dans window.PERTFLOW_BUILD, affichées par le bouton « À propos ».
//
// Usage :  node scripts/build-bundle.js [--tag vX.Y]
//   --tag : tag à inscrire dans le bundle (sinon : dernier tag git, ou "inconnu").
//           Utile en fin de session car le tag est créé APRÈS génération du bundle.

"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SRC_HTML = path.join(ROOT, "index.html");
const OUT_DIR = path.join(ROOT, "dist");
const OUT_HTML = path.join(OUT_DIR, "pertflow.html");

// Tag de version à inscrire : --tag prioritaire, sinon dernier tag git accessible.
function resolveTag() {
  const i = process.argv.indexOf("--tag");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  try {
    return cp.execSync("git describe --tags --abbrev=0", { cwd: ROOT }).toString().trim();
  } catch (e) {
    return "inconnu";
  }
}

// Horodatage de génération "JJ/MM/AAAA HH:MM" (format manuel, indépendant de la locale).
function buildStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear()
    + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

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

  // 0) Métadonnées de version du bundle (lues par le bouton « À propos »). Injectées
  //    juste après <body> pour être définies avant l'exécution des scripts.
  const buildInfo = { date: buildStamp(), tag: resolveTag() };
  const infoTag = "<script>window.PERTFLOW_BUILD = " + JSON.stringify(buildInfo) + ";<\/script>";
  html = html.replace(/<body>/i, "<body>\n  " + infoTag);

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
  console.log("Bundle généré : " + path.relative(ROOT, OUT_HTML) + " (" + sizeKB + " Ko)"
    + " — version " + buildInfo.tag + ", " + buildInfo.date);

  // Garde-fou : aucune référence externe résiduelle (sinon échec en file://).
  const leftover = html.match(/(?:src|href)="(?:lib\/|src\/|css\/)[^"]+"/g);
  if (leftover) {
    console.error("ATTENTION — références externes non inlinées : " + leftover.join(", "));
    process.exit(1);
  }
}

build();
