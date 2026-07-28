#!/usr/bin/env node
// ─── Fabrication de l'archive de livraison (release GitHub) ─────────────────────
//
// Produit `dist/release/pertflow_vX_Y.zip` contenant ce dont un UTILISATEUR a
// besoin, et rien d'autre : l'application (le bundle standalone), le manuel en PDF,
// et un mot d'accueil expliquant qu'il suffit de double-cliquer. Le code source,
// lui, reste sur GitHub pour qui veut le lire — l'archive n'est pas un miroir du
// depot, c'est une livraison.
//
// Pourquoi une archive et pas le bundle nu : le manuel doit voyager avec
// l'application. Sur un PC verrouille, l'utilisateur telecharge un fichier, le
// dezippe, et a tout sous la main sans reseau.
//
// L'archive N'EST PAS versionnee (dist/release/ est gitignore) : elle serait un
// doublon du bundle, deja suivi, et alourdirait le depot a chaque version. Sa
// place est dans les « Releases » de GitHub.
//
// Usage :  node scripts/make-release.js [--tag vX.Y]
//   --tag : version a livrer (sinon : dernier tag git accessible).
//
// Publication : voir le rituel de fin de session dans CLAUDE.md
//   gh release create vX.Y dist/release/pertflow_vX_Y.zip --title ... --notes-file ...

"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BUNDLE = path.join(ROOT, "dist", "pertflow.html");
const MANUEL = path.join(ROOT, "docs", "manuel-utilisateur.pdf");
const OUT_DIR = path.join(ROOT, "dist", "release");

function resolveTag() {
  const i = process.argv.indexOf("--tag");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  try {
    return cp.execSync("git describe --tags --abbrev=0", { cwd: ROOT }).toString().trim();
  } catch (e) {
    return null;
  }
}

function fail(msg) {
  console.error("ECHEC : " + msg);
  process.exit(1);
}

const tag = resolveTag();
if (!tag || !/^v\d+\.\d+(\.\d+)?$/.test(tag)) {
  fail("tag de version absent ou mal forme (attendu vX.Y ou vX.Y.Z) : " + tag);
}

// Refus AVANT ecriture si le bundle n'est pas celui de cette version. Livrer une
// archive « v0.20 » contenant un bundle v0.19 serait indetectable a l'usage : le
// numero affiche par « A propos » viendrait du bundle, pas du nom de l'archive.
// Le rituel regenere le bundle juste avant ; ce controle verifie qu'il l'a bien ete.
if (!fs.existsSync(BUNDLE)) fail("bundle absent : " + BUNDLE + " (node scripts/build-bundle.js --tag " + tag + ")");
// La cle est ecrite en JSON (`"tag":"v0.20"`) par build-bundle.js ; l'expression
// accepte aussi la forme non quotee, pour ne pas casser si le generateur change.
const bundleTag = (fs.readFileSync(BUNDLE, "utf8")
  .match(/PERTFLOW_BUILD\s*=\s*\{[^}]*"?tag"?\s*:\s*"([^"]+)"/) || [])[1];
if (bundleTag !== tag) {
  fail("le bundle porte le tag « " + bundleTag + " » et non « " + tag + " ».\n"
     + "        Regenerer d'abord : node scripts/build-bundle.js --tag " + tag);
}
if (!fs.existsSync(MANUEL)) fail("manuel PDF absent : " + MANUEL + " (node tools/build-docs.js)");

// zip est fourni par le systeme (aucune dependance npm dans ce projet, cf. CLAUDE.md).
try {
  cp.execSync("command -v zip", { stdio: "ignore" });
} catch (e) {
  fail("la commande « zip » est introuvable (sudo apt install zip)");
}

const slug = "pertflow_" + tag.replace(/\./g, "_");     // v0.20 → pertflow_v0_20
const stage = path.join(OUT_DIR, slug);
const zipPath = path.join(OUT_DIR, slug + ".zip");

fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(zipPath, { force: true });
fs.mkdirSync(stage, { recursive: true });

fs.copyFileSync(BUNDLE, path.join(stage, "pertflow.html"));
fs.copyFileSync(MANUEL, path.join(stage, "manuel-utilisateur.pdf"));

// Mot d'accueil : la premiere chose lue apres le dezippage. Il repond aux deux
// questions du nouvel arrivant — comment on lance, et ou sont mes donnees.
fs.writeFileSync(path.join(stage, "LISEZ-MOI.txt"),
  "PertFlow " + tag + "\r\n"
  + "Outil de planification PERT — © Stéphane Guichard — licence MIT\r\n"
  + "\r\n"
  + "DEMARRAGE\r\n"
  + "  Double-cliquez sur « pertflow.html ». L'application s'ouvre dans votre\r\n"
  + "  navigateur. Il n'y a rien a installer, aucun serveur, aucune connexion\r\n"
  + "  reseau : tout fonctionne hors ligne, et aucune donnee ne quitte votre poste.\r\n"
  + "\r\n"
  + "VOS PLANNINGS\r\n"
  + "  « Sauvegarder » telecharge un fichier .pert dans votre dossier de\r\n"
  + "  telechargements ; « Ouvrir » le recharge. Rangez-les ou vous voulez.\r\n"
  + "\r\n"
  + "DOCUMENTATION\r\n"
  + "  « manuel-utilisateur.pdf » — prise en main, puis chaque fonction en detail.\r\n"
  + "\r\n"
  + "Code source et versions : https://github.com/laguiche/pertflow\r\n",
  "utf8");

// -j : archive a plat — l'utilisateur dezippe et voit trois fichiers, pas un dossier
// dans un dossier. Les fichiers sont listes explicitement (pas de glob confie au
// shell) : on livre exactement ce qu'on a prepare, ni plus ni moins.
const files = fs.readdirSync(stage).sort();
cp.execSync(["zip", "-q", "-j", JSON.stringify(zipPath)]
  .concat(files.map(f => JSON.stringify(path.join(stage, f)))).join(" "));

fs.rmSync(stage, { recursive: true, force: true });

const ko = (n) => Math.round(n / 1024) + " Ko";
console.log("Archive : " + path.relative(ROOT, zipPath) + " (" + ko(fs.statSync(zipPath).size) + ")");
console.log(cp.execSync("unzip -l " + JSON.stringify(zipPath)).toString().trim());
