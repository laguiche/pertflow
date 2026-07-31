#!/usr/bin/env node
// ─── Fabrication de l'archive de livraison (release GitHub) ─────────────────────
//
// Produit `dist/release/pertflow_vX_Y.zip` contenant ce dont un UTILISATEUR a
// besoin, et rien d'autre : l'application (le bundle standalone), le manuel en PDF,
// les NOTES DE VERSION et un mot d'accueil expliquant qu'il suffit de double-cliquer.
// Le code source, lui, reste sur GitHub pour qui veut le lire — l'archive n'est pas
// un miroir du depot, c'est une livraison.
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
// Publication : voir le rituel de fin de session dans docs/maintenance.md
//   gh release create vX.Y dist/release/pertflow_vX_Y.zip --title ... --notes-file ...

"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BUNDLE = path.join(ROOT, "dist", "pertflow.html");
const MANUEL = path.join(ROOT, "docs", "manuel-utilisateur.pdf");
const NOTES = path.join(ROOT, "docs", "release-notes.md");
const OUT_DIR = path.join(ROOT, "dist", "release");

// ─── Notes de version : Markdown → texte brut lisible au Bloc-notes ─────────────
//
// L'archive part sur un poste verrouille ou l'utilisateur n'a ni visionneuse Markdown
// ni acces a GitHub. On livre donc du .txt : les balises (**gras**, `code`, liens)
// deviennent du bruit a l'ecran si on les laisse telles quelles.
// L'historique COMPLET est inclus, pas seulement la version livree : quelqu'un qui
// saute plusieurs versions doit pouvoir lire ce qu'il a manque, et le fichier reste
// antechronologique — ce qui vient d'etre installe est en tete.

// Une puce Markdown tient sur plusieurs lignes source ; en texte brut, ses lignes de
// continuation non indentees se lisent mal. On rassemble donc chaque puce avant de la
// re-envelopper a la largeur voulue.
function wrapText(texte, largeur, indent, indentSuite) {
  const mots = texte.split(/\s+/).filter(Boolean);
  const lignes = [];
  let courante = indent;
  let vide = true;
  for (const mot of mots) {
    const prefixe = vide ? "" : " ";
    if (!vide && (courante + prefixe + mot).length > largeur) {
      lignes.push(courante);
      courante = indentSuite + mot;
    } else {
      courante += prefixe + mot;
      vide = false;
    }
  }
  if (!vide) lignes.push(courante);
  return lignes;
}

function notesEnTexte(md) {
  const propre = (s) => s
    // [texte](url) → « texte (url) », sauf quand le texte EST deja l'url : dans les
    // .md le libelle est souvent le nom du fichier entoure de backticks, d'ou le
    // nettoyage AVANT comparaison — sinon on ecrit « conception.md (conception.md) ».
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) =>
      (t.replace(/`/g, "").trim() === u.trim() ? t : t + " (" + u + ")"))
    .replace(/\*\*([^*]+)\*\*/g, "$1")                 // **gras**
    .replace(/`([^`]+)`/g, "$1")                       // `code`
    .replace(/^>\s?/, "");                             // citation
  const sortie = [];
  // Bloc en cours : une puce OU un paragraphe. Les deux s'etalent sur plusieurs lignes
  // source et doivent etre rassembles avant d'etre re-enveloppes — sinon les retours a
  // la ligne du Markdown se retrouvent tels quels dans le .txt, en plein milieu des
  // phrases.
  let bloc = null, puce = false;
  const vider = () => {
    if (bloc === null) return;
    sortie.push(...(puce ? wrapText(propre(bloc), 78, "  - ", "    ")
                         : wrapText(propre(bloc), 78, "", "")));
    bloc = null; puce = false;
  };
  for (const brute of md.split(/\r?\n/)) {
    const ligne = brute.trimEnd();
    if (/^\s*-\s+/.test(ligne)) {                      // debut de puce
      vider();
      bloc = ligne.replace(/^\s*-\s+/, ""); puce = true;
      continue;
    }
    if (/^#{1,2}\s/.test(ligne)) {                     // titre de document / de version
      vider();
      const t = propre(ligne.replace(/^#+\s*/, ""));
      sortie.push("", t, "=".repeat(Math.min(t.length, 78)));
      continue;
    }
    if (/^---+$/.test(ligne.trim())) { vider(); continue; }  // separateur : titres soulignes
    if (!ligne.trim()) {                               // fin de bloc
      vider();
      if (sortie.length && sortie[sortie.length - 1] !== "") sortie.push("");
      continue;
    }
    bloc = (bloc === null) ? ligne.trim() : bloc + " " + ligne.trim();
  }
  vider();
  return sortie.join("\r\n").replace(/^\r\n/, "") + "\r\n";
}

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

// Meme raisonnement que pour le tag du bundle : livrer une archive « vX.Y » dont les
// notes s'arretent a la version precedente est indetectable a l'usage — l'utilisateur
// lit un fichier qui ne parle pas de ce qu'il vient d'installer. On refuse AVANT
// d'ecrire quoi que ce soit, plutot que d'avertir dans un flot de sortie.
if (!fs.existsSync(NOTES)) fail("notes de version absentes : " + NOTES);
const notesMd = fs.readFileSync(NOTES, "utf8");
if (!new RegExp("^##\\s+" + tag.replace(/\./g, "\\.") + "\\b", "m").test(notesMd)) {
  fail("docs/release-notes.md ne contient aucune section « ## " + tag + " ».\n"
     + "        Redigez les notes de cette version avant de fabriquer l'archive.");
}

// zip est fourni par le systeme (aucune dependance npm dans ce projet, cf. docs/conception.md).
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
fs.writeFileSync(path.join(stage, "NOTES-DE-VERSION.txt"), notesEnTexte(notesMd), "utf8");

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
  + "  « manuel-utilisateur.pdf »  — prise en main, puis chaque fonction en detail.\r\n"
  + "  « NOTES-DE-VERSION.txt »    — ce qui a change dans cette version, et dans\r\n"
  + "                                les precedentes (la plus recente en tete).\r\n"
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
