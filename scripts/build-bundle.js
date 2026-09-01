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
// avec les contraintes DSI (cf. docs/conception.md). Aucune dépendance npm : Node natif seul.
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

// Date de génération "JJ/MM/AAAA" (format manuel, indépendant de la locale).
// SANS heure (v0.18.1, demande utilisateur) : ce qui compte pour situer un bundle est le
// jour, l'heure n'apporte rien à qui lit « À propos » et alourdit la ligne. Les bundles
// antérieurs portent encore « JJ/MM/AAAA HH:MM » — openAbout sait la retirer à l'affichage.
function buildStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
}

// Lit un fichier référencé relativement à la racine du projet.
function readAsset(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.readFileSync(abs, "utf8");
}

// ─── Politique de sécurité de contenu (CSP) — audit de sécurité du 01/09/2026 ──
//
// Le bundle est ce qui CIRCULE : il est ouvert sur des postes verrouillés par une DSI,
// et vient parfois d'un tiers. Cette balise fait appliquer par le NAVIGATEUR lui-même
// ce que l'application promet — ne parler à personne. C'est le seul argument opposable
// a une DSI : il ne demande de croire ni l'auteur, ni un rapport d'audit, et il se lit
// en clair en tete du fichier.
//
// Elle referme aussi le constat C-01 de l'audit : un fichier .pert forge declarant un
// noeud reseau de LiteGraph ouvrait une connexion sortante a l'ouverture du planning.
// Le passage au build « coeur » de LiteGraph (lib/litegraph.core.js) supprime le code
// fautif ; « connect-src 'none' » interdit l'effet. Les deux sont independants a
// dessein : chacune des deux mesures suffit, et la seconde couvre le code a venir.
//
// Chaque directive porte son motif — ne pas en retirer une sans mesurer ce qu'elle
// autorisait, la CSP echoue en SILENCE cote utilisateur (fonction morte, aucune erreur
// visible hors console). Contre-epreuve : tools/smoke-securite.js.
//
// ATTENTION : injectee ici, JAMAIS dans index.html. En developpement les scripts sont
// des fichiers separes charges en file://, que « script-src 'unsafe-inline' »
// bloquerait — l'app ne demarrerait plus. Dans le bundle tout est en ligne, d'ou
// 'unsafe-inline' (et lui seul : pas de 'unsafe-eval', aucun code n'est evalue).
const CSP = [
  "default-src 'none'",      // tout est interdit par defaut, on ne rouvre que le necessaire
  "script-src 'unsafe-inline'", // scripts inlines par ce script ; PAS de 'unsafe-eval'
  "style-src 'unsafe-inline'",  // feuilles inlinees + styles poses par l'UI (element.style)
  "img-src data: blob:",     // export PNG (canvas.toDataURL) et apercus
  "font-src data:",          // aucune police externe ; data: par prudence
  "connect-src 'none'",      // AUCUNE sortie reseau : fetch, XHR, WebSocket, EventSource
  "frame-src 'none'",        // aucune iframe
  "object-src 'none'",       // aucun plugin
  "base-uri 'none'",         // interdit de reecrire la base des URL relatives
  "form-action 'none'",      // aucun envoi de formulaire
].join("; ");

// Mentions de copyright des bibliotheques embarquees. La licence MIT impose de
// conserver la mention d'origine dans les copies : jsPDF porte la sienne dans son
// propre en-tete, mais les builds de litegraph et fflate n'en ont aucun — sans ce
// bloc, le bundle diffuserait deux bibliotheques MIT sans crediter leurs auteurs
// (constat C-03 de l'audit). Le fichier LICENCES-TIERCES.txt de l'archive de
// livraison reprend le texte integral des licences ; ici on garde l'essentiel, dans
// le fichier qui circule seul.
const CREDITS = [
  "  PertFlow — (c) Stephane Guichard — licence MIT",
  "",
  "  Bibliotheques tierces embarquees dans ce fichier, toutes sous licence MIT :",
  "    - litegraph.js 0.7.18 (build « core ») — (c) Javi Agenjo",
  "                                             https://github.com/jagenjo/litegraph.js",
  "    - jsPDF 4.2.1 — (c) James Hall, yWorks GmbH et contributeurs",
  "                    https://github.com/parallax/jsPDF",
  "    - fflate 0.8.3 — (c) Arjun Barrett",
  "                     https://github.com/101arrowz/fflate",
  "",
  "  Aucune ressource n'est chargee depuis le reseau : tout est contenu ici.",
].join("\n");

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

  // 0 bis) Politique de sécurité + crédits des bibliothèques (cf. constantes ci-dessus).
  //    La CSP doit précéder tout contenu qu'elle gouverne : on l'ancre sur le <meta
  //    charset>, premier élément du <head>. Les crédits passent AVANT elle, pour être
  //    la première chose que lit qui ouvre le fichier dans un éditeur.
  html = html.replace(
    /<meta charset="UTF-8">/i,
    "<!--\n" + CREDITS + "\n-->\n"
      + '  <meta charset="UTF-8">\n'
      + '  <meta http-equiv="Content-Security-Policy" content="' + CSP + '">'
  );

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

  // ── Garde-fous, AVANT écriture ──────────────────────────────────────────────
  // Les deux contrôles précèdent le fs.writeFileSync (ils le suivaient jusqu'au
  // 01/09/2026) : un bundle défectueux déjà écrit sur le disque finit tôt ou tard
  // distribué, le message d'erreur ayant défilé. Même principe que make-release.js —
  // bloquer plutôt qu'avertir.

  // 1) Aucune référence externe résiduelle (sinon échec en file://).
  const leftover = html.match(/(?:src|href)="(?:lib\/|src\/|css\/)[^"]+"/g);
  if (leftover) {
    console.error("ATTENTION — références externes non inlinées : " + leftover.join(", "));
    console.error("Bundle NON écrit.");
    process.exit(1);
  }

  // 2) CSP et crédits effectivement injectés. Ils sont ancrés sur un motif du HTML
  //    source : qu'un remaniement d'index.html déplace le <meta charset> et
  //    l'injection devient sans effet — le bundle sort complet et fonctionnel, mais
  //    sans protection ni mention de licence, ce que rien ne signale à l'usage.
  if (html.indexOf("Content-Security-Policy") === -1 || html.indexOf("Bibliotheques tierces") === -1) {
    console.error("ATTENTION — CSP ou crédits non injectés : le motif d'ancrage"
      + " <meta charset=\"UTF-8\"> a disparu d'index.html.");
    console.error("Bundle NON écrit.");
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_HTML, html, "utf8");

  const sizeKB = (Buffer.byteLength(html, "utf8") / 1024).toFixed(0);
  console.log("Bundle généré : " + path.relative(ROOT, OUT_HTML) + " (" + sizeKB + " Ko)"
    + " — version " + buildInfo.tag + ", " + buildInfo.date);
}

build();
