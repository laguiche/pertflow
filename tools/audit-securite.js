// ─── Audit de sécurité du fichier livré — rejouable à chaque version ────────────
//
// POURQUOI CET OUTIL. PertFlow tourne sur des postes verrouillés par une DSI, et le
// bundle circule de main en main. La question posée n'est jamais « ce logiciel est-il
// bien intentionné ? » mais « pouvez-vous le PROUVER ? ». Un rapport rédigé une fois
// ne prouve rien trois versions plus tard : cet outil refait les contrôles sur le
// fichier du jour et en rend le compte rendu, de sorte qu'une DSI puisse le rejouer
// elle-même, sans rien installer d'autre que Node.
//
// Il ne remplace pas tools/smoke-securite.js, qui garde un rôle distinct : le smoke
// FAIT ÉCHOUER la suite quand une protection saute (il est dans run-smokes.js) ;
// l'audit, lui, DÉCRIT — nomenclature, empreintes, provenance, vulnérabilités connues,
// comportement observé — et produit le document à joindre au dossier DSI.
//
// USAGE
//   node tools/audit-securite.js              contrôles + rapport HTML + PDF
//   node tools/audit-securite.js --hors-ligne  saute les contrôles réseau (npm, OSV)
//   node tools/audit-securite.js --sans-pdf    compte rendu console + HTML seulement
//
// SORTIES : dist/audit/audit-securite-<tag>.html et .pdf — un répertoire GITIGNORÉ, et
// absent de l'archive de livraison. C'est délibéré (décision utilisateur du
// 01/09/2026) : le rapport est un document de travail, daté, destiné à être remis à
// une DSI à la demande. Le verser au dépôt public le figerait à la version du jour ; le
// mettre dans l'archive laisserait croire à une certification accompagnant le produit.
//
// DEUX RÈGLES DE CONCEPTION, à ne pas défaire :
//
//   1) LES CONTRÔLES RÉSEAU NE FONT JAMAIS ÉCHOUER L'AUDIT. Un poste verrouillé n'a
//      souvent pas accès à npm ni à OSV — c'est justement le poste qui nous intéresse.
//      Sans réseau, ces contrôles rendent « non vérifié » et le rapport le DIT, au lieu
//      de laisser croire à un succès. Même principe que le CPERT réel de la suite.
//
//   2) AUCUN ATTENDU CODÉ EN DUR. Ni empreinte, ni numéro de version, ni nombre de
//      types de nœuds : tout est lu dans le fichier audité et dans les paquets
//      officiels. Un attendu figé transformerait la prochaine montée de version en
//      « échec » sans rapport avec la sécurité — et, pire, un attendu recopié d'une
//      version antérieure ferait passer pour vérifié ce qui ne l'est plus.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const cp = require('child_process');
const lib = require('./lib');

const ARGS = process.argv.slice(2);
const HORS_LIGNE = ARGS.includes('--hors-ligne');
const SANS_PDF = ARGS.includes('--sans-pdf');

const SORTIE = path.join(lib.ROOT, 'dist', 'audit');

// Correspondance fichier embarqué → artefact publié sur npm. C'est LA table qui rend
// la provenance vérifiable : le nom local ne suffit pas (fflate.min.js s'appelle
// umd/index.js chez l'éditeur, et litegraph publie deux builds très différents sous
// des noms voisins). Une ligne par bibliothèque, à tenir à jour en cas de changement
// de build — c'est le seul endroit à corriger.
const BIBLIOTHEQUES = [
  { fichier: 'lib/litegraph.core.js', paquet: 'litegraph.js', artefact: 'build/litegraph.core.js',
    role: 'Canevas graphique : nœuds, liens, sélection' },
  { fichier: 'lib/litegraph.css', paquet: 'litegraph.js', artefact: 'css/litegraph.css',
    role: 'Feuille de style du canevas' },
  { fichier: 'lib/jspdf.umd.min.js', paquet: 'jspdf', artefact: 'dist/jspdf.umd.min.js',
    role: 'Génération du PDF à l\'export' },
  { fichier: 'lib/fflate.min.js', paquet: 'fflate', artefact: 'umd/index.js',
    role: 'Lecture et écriture des fichiers Excel (ZIP)' },
];

// API à effet de bord recherchées dans le fichier livré, avec l'ORIGINE connue de
// chacune. Un audit qui se contente de compter les occurrences ne sert à rien : il
// rend une liste d'alertes sans réponse, et c'est l'auteur qu'on rappelle pour les
// expliquer une par une. La colonne « origine » porte donc la réponse — d'où vient
// cette capacité dans cet assemblage, et pourquoi elle n'est pas atteinte.
//
// Une capacité TROUVÉE SANS ORIGINE connue est signalée « à expliquer » : c'est le cas
// qui doit sauter aux yeux, celui d'une capacité apparue depuis le dernier audit.
//
// ⚠ Ces notes décrivent l'assemblage AUDITÉ. Changer une bibliothèque (ou son build)
// les périme en silence : les revérifier alors, comme on revérifie la table de
// make-cpert-fixture.js. Elles ne remplacent en rien les deux contrôles qui, eux, se
// recalculent seuls et font foi : le comportement observé (§05) et la CSP (§03).
const API_SENSIBLES = [
  { motif: /new WebSocket|WebSocket\s*\(/g, quoi: 'Ouverture de socket' },
  { motif: /XMLHttpRequest/g, quoi: 'Requête HTTP (XHR)',
    origine: 'Cœur de LiteGraph (chargement d\'un graphe par URL) et utilitaire '
      + 'd\'enregistrement de jsPDF, réservé au téléchargement d\'une URL. PertFlow '
      + 'n\'appelle ni l\'un ni l\'autre : ses fichiers viennent d\'un champ de '
      + 'sélection, et le PDF est produit en mémoire.' },
  { motif: /\bfetch\s*\(/g, quoi: 'Requête HTTP (fetch)',
    origine: 'Utilitaire de lecture de fichier du cœur de LiteGraph, jamais appelé. '
      + 'Les autres occurrences sont des commentaires du code de PertFlow, qui '
      + 'rappellent précisément de ne jamais y recourir.' },
  { motif: /navigator\.sendBeacon/g, quoi: 'Envoi en arrière-plan (beacon)' },
  { motif: /getUserMedia/g, quoi: 'Caméra / microphone' },
  { motif: /requestMIDIAccess/g, quoi: 'Périphériques MIDI' },
  { motif: /navigator\.geolocation/g, quoi: 'Géolocalisation' },
  { motif: /document\.cookie/g, quoi: 'Cookies' },
  { motif: /\beval\s*\(/g, quoi: 'Évaluation de code',
    origine: 'Cœur de LiteGraph : résolution d\'une expression arithmétique tapée dans '
      + 'un widget de saisie numérique, filtrée par une expression régulière. PertFlow '
      + 'n\'utilise aucun widget LiteGraph — ses valeurs se saisissent dans le panneau '
      + 'latéral, en HTML.' },
  { motif: /new Function\s*\(/g, quoi: 'Compilation de code',
    origine: 'Cœur de LiteGraph, à l\'intérieur d\'un bloc mis en commentaire par '
      + 'l\'éditeur : du code mort, que le navigateur ne lit même pas.' },
  { motif: /new Worker\s*\(/g, quoi: 'Fil d\'exécution séparé',
    origine: 'API asynchrone de fflate. PertFlow n\'emploie que ses fonctions '
      + 'synchrones (zipSync / unzipSync) pour lire et écrire les classeurs Excel.' },
  { motif: /localStorage/g, quoi: 'Stockage local (reste sur le poste)',
    origine: 'Sauvegarde de récupération après plantage et presse-papiers copier-coller. '
      + 'Ces données restent dans le navigateur du poste : aucune API ne permet de les '
      + 'transmettre, et la politique de sécurité interdit toute sortie.' },
];

// ─── Utilitaires ───────────────────────────────────────────────────────────────

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// GET HTTPS minimal, suivant les redirections. Volontairement sans dépendance : cet
// outil doit tourner sur un poste où l'on n'installe rien.
function telecharger(url, redirections) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 20000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if ((redirections || 0) > 5) return reject(new Error('trop de redirections'));
        return resolve(telecharger(res.headers.location, (redirections || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const morceaux = [];
      res.on('data', d => morceaux.push(d));
      res.on('end', () => resolve(Buffer.concat(morceaux)));
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
  });
}

function postJson(url, corps) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST', timeout: 20000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corps) },
    }, res => {
      const m = [];
      res.on('data', d => m.push(d));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(m).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
    req.end(corps);
  });
}

// Extrait un fichier d'une archive .tgz npm, via tar (présent partout sauf Windows nu).
// On passe par un répertoire temporaire plutôt que par une lib de décompression : une
// dépendance de plus serait, ici précisément, une ironie.
function extraireDuTgz(tgz, cheminDansPaquet) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pertflow-audit-'));
  try {
    const archive = path.join(tmp, 'paquet.tgz');
    fs.writeFileSync(archive, tgz);
    cp.execFileSync('tar', ['xzf', archive, '-C', tmp, 'package/' + cheminDansPaquet], { stdio: 'pipe' });
    return fs.readFileSync(path.join(tmp, 'package', cheminDansPaquet));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Version d'une bibliothèque : lue dans son propre code quand elle s'y nomme, sinon
// déduite en essayant les versions publiées jusqu'à retrouver l'empreinte. La déduction
// est le cas normal pour les builds qui ne portent pas leur numéro (litegraph, fflate)
// — et c'est plus fort qu'une déclaration : l'empreinte ne se trompe pas.
async function identifierVersion(paquet, artefact, empreinte) {
  const meta = JSON.parse((await telecharger('https://registry.npmjs.org/' + paquet)).toString('utf8'));
  const versions = Object.keys(meta.versions);
  // Les plus récentes d'abord : on tombe presque toujours sur la bonne au 1er essai.
  const ordre = versions.slice().reverse();
  const derniere = meta['dist-tags'] && meta['dist-tags'].latest;
  for (const v of ordre) {
    let tgz;
    try { tgz = await telecharger(meta.versions[v].dist.tarball); } catch (e) { continue; }
    let contenu;
    try { contenu = extraireDuTgz(tgz, artefact); } catch (e) { continue; }
    if (sha256(contenu) === empreinte) return { version: v, derniere: derniere, identique: true };
  }
  return { version: null, derniere: derniere, identique: false };
}

async function vulnerabilites(paquet, version) {
  const r = await postJson('https://api.osv.dev/v1/query',
    JSON.stringify({ package: { name: paquet, ecosystem: 'npm' }, version: version }));
  return (r.vulns || []).map(v => ({ id: v.id, resume: (v.summary || '').slice(0, 160) }));
}

// ─── Contrôles ─────────────────────────────────────────────────────────────────

// 1. Identité de l'objet audité. Le tag et la date viennent du bundle lui-même
//    (window.PERTFLOW_BUILD, ce que le bouton « À propos » affiche à l'utilisateur) :
//    c'est le seul numéro de version qui engage, celui du fichier en main.
function identite(bundle) {
  const m = bundle.match(/window\.PERTFLOW_BUILD\s*=\s*(\{[^}]*\})/);
  const info = m ? JSON.parse(m[1]) : { tag: 'inconnu', date: 'inconnue' };
  return {
    fichier: path.relative(lib.ROOT, lib.BUNDLE),
    tag: info.tag, date: info.date,
    octets: Buffer.byteLength(bundle, 'utf8'),
    empreinte: sha256(Buffer.from(bundle, 'utf8')),
  };
}

// 2. Nomenclature + provenance + vulnérabilités connues, bibliothèque par bibliothèque.
async function nomenclature() {
  const lignes = [];
  for (const b of BIBLIOTHEQUES) {
    const abs = path.join(lib.ROOT, b.fichier);
    const ligne = { ...b, present: fs.existsSync(abs) };
    if (!ligne.present) { lignes.push(ligne); continue; }
    ligne.empreinte = sha256(fs.readFileSync(abs));
    if (HORS_LIGNE) { ligne.provenance = 'non vérifiée'; lignes.push(ligne); continue; }
    try {
      const id = await identifierVersion(b.paquet, b.artefact, ligne.empreinte);
      ligne.version = id.version;
      ligne.derniere = id.derniere;
      ligne.provenance = id.identique ? 'identique au paquet officiel' : 'AUCUNE version publiée ne correspond';
      if (id.version) {
        try { ligne.vulns = await vulnerabilites(b.paquet, id.version); }
        catch (e) { ligne.vulns = null; }
      }
    } catch (e) {
      ligne.provenance = 'non vérifiée (' + e.message + ')';
    }
    lignes.push(ligne);
  }
  return lignes;
}

// 3. Le bundle contient-il bien, octet pour octet, les fichiers de lib/ ? Sans ce
//    contrôle, la provenance vérifiée en 2 ne dirait rien du fichier distribué.
function librairiesInlinees(bundle) {
  return BIBLIOTHEQUES.filter(b => fs.existsSync(path.join(lib.ROOT, b.fichier))).map(b => {
    const brut = fs.readFileSync(path.join(lib.ROOT, b.fichier), 'utf8');
    const echappe = brut.replace(/<\/script>/gi, '<\\/script>').replace(/<\/style>/gi, '<\\/style>');
    return { fichier: b.fichier, inlinee: bundle.indexOf(echappe) !== -1 };
  });
}

// 4. Le bundle est-il reproductible depuis les sources ? On régénère avec le tag lu
//    dans le bundle, on compare en neutralisant la seule date de génération, puis on
//    REMET l'original — un audit ne doit rien laisser derrière lui (d'où le finally).
function reproductible(bundleOriginal, tag) {
  const sauvegarde = Buffer.from(bundleOriginal, 'utf8');
  try {
    cp.execFileSync(process.execPath,
      [path.join(lib.ROOT, 'scripts', 'build-bundle.js'), '--tag', tag],
      { cwd: lib.ROOT, stdio: 'pipe' });
    const neuf = fs.readFileSync(lib.BUNDLE, 'utf8');
    const sansDate = s => s.replace(/"date":"[^"]*"/, '"date":"X"');
    return { verifie: true, identique: sansDate(neuf) === sansDate(bundleOriginal) };
  } catch (e) {
    return { verifie: false, identique: false, erreur: e.message };
  } finally {
    fs.writeFileSync(lib.BUNDLE, sauvegarde);
  }
}

// 5. Inventaire statique du fichier livré : ce qu'une DSI y cherchera elle-même.
function inventaireStatique(bundle) {
  const csp = (bundle.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i) || [])[1] || null;
  const ressourcesExternes = bundle.match(/(?:src|href)="(?:https?:)?\/\/[^"]+"/gi) || [];

  // Les URL présentes dans le fichier : la plupart sont des espaces de noms XML et des
  // liens de crédit dans les commentaires. On les remonte toutes, en séparant celles
  // qui sont réellement chargeables (http/https hors espaces de noms).
  const urls = {};
  (bundle.match(/(https?|wss?):\/\/[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+/g) || []).forEach(u => {
    const hote = (u.match(/^[a-z]+:\/\/([^/]+)/i) || [])[1] || u;
    urls[hote] = (urls[hote] || 0) + 1;
  });

  const api = API_SENSIBLES.map(a => ({
    quoi: a.quoi, origine: a.origine || null,
    occurrences: (bundle.match(a.motif) || []).length,
  }));

  return { csp, ressourcesExternes, hotes: urls, api,
           credits: bundle.indexOf('Bibliotheques tierces') !== -1 };
}

// 6. Comportement réel : le fichier est ouvert dans un vrai navigateur, on lui fait
//    subir le scénario du constat C-01 (planning forgé) puis un parcours normal, et on
//    écoute TOUT ce qui sort. C'est le seul contrôle qui parle du logiciel en marche.
async function comportement() {
  const forge = {
    version: '1.0', meta: { title: 'Contrôle', t0: '2026-09-01', unit: 'j' },
    graph: { last_node_id: 3, last_link_id: 0, links: [], groups: [], config: {}, version: 0.4,
      nodes: [
        { id: 1, type: 'pert/activity', pos: [100, 100], size: [180, 90], flags: {}, order: 0,
          mode: 0, properties: { label: 'Etude', duration: 5, etp: 1, color: '#4A90D9' } },
        { id: 2, type: 'network/websocket', pos: [400, 100], size: [60, 20], flags: {}, order: 1,
          mode: 0, properties: { url: 'ws://audit.exemple.test:8099/exfil' } },
      ] },
  };

  const { browser, ctx, page } = await lib.launch();
  const ws = [], sorties = [], violations = [], erreurs = [], telechargements = [];
  page.on('websocket', s => ws.push(s.url()));
  page.on('request', r => {
    const u = r.url();
    if (!/^(file|data|blob):/.test(u)) sorties.push(r.method() + ' ' + u);
  });
  page.on('download', d => telechargements.push(d.suggestedFilename()));
  page.on('pageerror', e => erreurs.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    (/Content Security Policy/i.test(m.text()) ? violations : erreurs).push(m.text().slice(0, 140));
  });

  await lib.openBundle(page);
  const types = await page.evaluate(() => Object.keys(LiteGraph.registered_node_types).sort());

  const f = path.join(os.tmpdir(), 'pertflow_audit_forge.pert');
  fs.writeFileSync(f, JSON.stringify(forge));
  await page.setInputFiles('#file-input', f);
  await page.waitForTimeout(2500);
  const apresForge = { ws: ws.slice(), sorties: sorties.slice() };

  // Parcours normal : tous les exports proposés, puis la sauvegarde. C'est ce qui
  // révèle une CSP trop serrée — laquelle casse en SILENCE, sans erreur visible.
  const pert = JSON.parse(fs.readFileSync(path.join(lib.EXEMPLES, 'pert_a_exporter.pert'), 'utf8'));
  await page.evaluate(d => pertApplyProject(d), pert);
  const n = await page.evaluate(() => {
    document.getElementById('btn-export').click();
    const c = document.querySelectorAll('.export-format-row').length;
    pertCloseExportDialog();
    return c;
  });
  const formats = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => document.getElementById('btn-export').click());
    await page.waitForTimeout(120);
    formats.push(await page.evaluate(k => {
      const r = document.querySelectorAll('.export-format-row')[k];
      const l = r.querySelector('.export-format-label').textContent;
      r.click(); return l;
    }, i));
    await page.waitForTimeout(1100);
  }
  await page.evaluate(() => pertSaveProject());
  await page.waitForTimeout(800);

  await ctx.close();
  await browser.close();

  return { types, apresForge, formats, telechargements, violations, erreurs,
           sortiesTotales: sorties, wsTotales: ws };
}

// ─── Rapport ───────────────────────────────────────────────────────────────────

function ech(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Le rapport est volontairement en THÈME CLAIR seulement : il est fait pour être
// imprimé et joint à un dossier, pas consulté à l'écran dans le noir.
function rendreHtml(r) {
  const oui = '<span class="ok">✓</span>';
  const non = '<span class="ko">✗</span>';
  const nv = '<span class="nv">—</span>';

  const ligneBiblio = b => `<tr>
      <td class="mono">${ech(b.fichier.replace('lib/', ''))}</td>
      <td class="mono">${b.version ? ech(b.paquet + '@' + b.version) : ech(b.paquet) + (HORS_LIGNE ? '' : ' <em>(?)</em>')}</td>
      <td>${ech(b.role)}</td>
      <td class="hash">${ech(b.empreinte || '—')}</td>
      <td>${b.provenance === 'identique au paquet officiel' ? oui + ' identique'
        : b.provenance === 'non vérifiée' ? nv + ' non vérifiée' : non + ' ' + ech(b.provenance)}</td>
      <td>${b.vulns == null ? nv : b.vulns.length === 0 ? oui + ' aucune'
        : non + ' ' + b.vulns.map(v => ech(v.id)).join(', ')}</td>
    </tr>`;

  const ligneApi = a => `<tr>
      <td>${ech(a.quoi)}</td>
      <td class="mono num">${a.occurrences}</td>
      <td>${a.occurrences === 0 ? oui + ' absent du fichier livré'
        : a.origine ? '<b>Présent, non atteint.</b> ' + ech(a.origine)
        : '<span class="att">⚠ À EXPLIQUER — capacité sans origine connue</span>'}</td>
    </tr>`;

  const c = r.comportement;
  const constats = [];
  if (c.apresForge.ws.length || c.apresForge.sorties.length) {
    constats.push(['critique', 'Un planning forgé déclenche une sortie réseau',
      (c.apresForge.ws.concat(c.apresForge.sorties)).join(', ')]);
  }
  if (!r.statique.csp) {
    constats.push(['critique', 'Le fichier livré ne porte aucune politique de sécurité de contenu',
      'Régénérer le bundle avec scripts/build-bundle.js']);
  } else if (r.statique.csp.indexOf("connect-src 'none'") === -1) {
    constats.push(['critique', "La politique de sécurité n'interdit pas les sorties réseau",
      "Directive « connect-src 'none' » attendue"]);
  }
  if (r.statique.ressourcesExternes.length) {
    constats.push(['critique', 'Le fichier référence une ressource externe',
      r.statique.ressourcesExternes.join(', ')]);
  }
  r.statique.api.filter(a => a.occurrences > 0 && !a.origine).forEach(a => {
    constats.push(['critique', 'Capacité sensible sans origine connue : ' + a.quoi,
      a.occurrences + ' occurrence(s) apparue(s) depuis le dernier audit — à instruire, '
      + 'puis à documenter dans API_SENSIBLES (tools/audit-securite.js)']);
  });
  if (!r.statique.credits) {
    constats.push(['mineur', 'Mentions de licence des bibliothèques absentes du fichier livré',
      'Licence MIT : la mention de copyright doit accompagner les copies']);
  }
  r.nomenclature.forEach(b => {
    if (b.provenance && b.provenance.indexOf('AUCUNE') === 0) {
      constats.push(['critique', 'Bibliothèque introuvable dans les paquets publiés : ' + b.fichier,
        'Le fichier embarqué ne correspond à aucune version officielle de ' + b.paquet]);
    }
    if (b.vulns && b.vulns.length) {
      constats.push(['critique', 'Vulnérabilité connue : ' + b.paquet + '@' + b.version,
        b.vulns.map(v => v.id + ' — ' + v.resume).join(' ; ')]);
    }
    if (b.version && b.derniere && b.version !== b.derniere) {
      constats.push(['mineur', b.paquet + ' n\'est pas à la dernière version publiée',
        'embarquée ' + b.version + ', publiée ' + b.derniere + ' — aucune vulnérabilité associée']);
    }
  });
  if (c.violations.length) {
    constats.push(['mineur', 'La politique de sécurité bloque une fonction de l\'application',
      c.violations.join(' | ')]);
  }
  if (c.erreurs.length) {
    constats.push(['mineur', 'Erreurs relevées pendant le parcours fonctionnel', c.erreurs.join(' | ')]);
  }
  if (!r.reproductible.verifie) {
    constats.push(['mineur', 'Reproductibilité non vérifiée', r.reproductible.erreur || '']);
  } else if (!r.reproductible.identique) {
    constats.push(['critique', 'Le fichier livré ne correspond pas à ses propres sources',
      'Régénérer le bundle, ou expliquer l\'écart']);
  }

  const critiques = constats.filter(x => x[0] === 'critique');
  const verdict = critiques.length === 0
    ? { classe: 'vert', texte: constats.length ? 'Aucun constat bloquant' : 'Aucun constat' }
    : { classe: 'rouge', texte: critiques.length + ' constat(s) bloquant(s)' };

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Audit de sécurité — PertFlow ${ech(r.identite.tag)}</title>
<style>
  :root { --ink:#14181C; --muted:#58646B; --rule:#D6DDDD; --accent:#1C5566;
          --ok:#2B6349; --ko:#8E2C22; --att:#8F5300; --paper:#FFFFFF; }
  * { box-sizing:border-box; }
  body { margin:0; padding:28px 32px 44px; background:var(--paper); color:var(--ink);
         font:13px/1.55 "Segoe UI", -apple-system, Helvetica, Arial, sans-serif; }
  h1 { font-size:23px; margin:0 0 4px; letter-spacing:-.01em; }
  h2 { font-size:15px; margin:26px 0 9px; padding-bottom:5px; border-bottom:2px solid var(--ink);
       letter-spacing:-.005em; }
  h2 .n { color:var(--accent); font-family:ui-monospace,Consolas,monospace; font-size:12px;
          margin-right:9px; }
  p { margin:0 0 9px; max-width:47em; }
  .sub { color:var(--muted); margin:0 0 14px; max-width:47em; }
  .mono, .hash, code { font-family:ui-monospace,"Consolas",monospace; }
  .hash { font-size:9.5px; color:var(--muted); word-break:break-all; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  table { border-collapse:collapse; width:100%; margin:8px 0 4px; font-size:11.5px; }
  th,td { border:1px solid var(--rule); padding:5px 7px; text-align:left; vertical-align:top; }
  th { background:#F1F4F3; font-size:9.5px; letter-spacing:.07em; text-transform:uppercase;
       color:var(--muted); font-weight:600; }
  .ok { color:var(--ok); font-weight:700; }
  .ko { color:var(--ko); font-weight:700; }
  .att { color:var(--att); font-weight:600; }
  .nv { color:var(--muted); }
  .fiche { border:1px solid var(--ink); padding:14px 16px; margin:14px 0 6px; }
  .fiche dl { display:grid; grid-template-columns:auto 1fr; gap:3px 16px; margin:0; font-size:12px; }
  .fiche dt { color:var(--muted); font-size:9.5px; letter-spacing:.07em; text-transform:uppercase;
              padding-top:3px; }
  .fiche dd { margin:0; font-family:ui-monospace,Consolas,monospace; word-break:break-all; }
  .verdict { display:inline-block; padding:4px 10px; font-size:11px; font-weight:700;
             letter-spacing:.06em; text-transform:uppercase; border:1px solid currentColor; }
  .verdict.vert { color:var(--ok); background:#E1EDE6; }
  .verdict.rouge { color:var(--ko); background:#F6E4E2; }
  .constat { border-left:3px solid var(--att); padding:7px 0 7px 12px; margin:9px 0; }
  .constat.critique { border-left-color:var(--ko); }
  .constat b { display:block; }
  .constat span { color:var(--muted); font-size:11.5px; }
  footer { margin-top:30px; padding-top:11px; border-top:1px solid var(--rule);
           color:var(--muted); font-size:10.5px; }
  @media print { h2 { break-after:avoid; } table, .constat, .fiche { break-inside:avoid; } }
</style></head><body>

<h1>Audit de sécurité — PertFlow ${ech(r.identite.tag)}</h1>
<p class="sub">Contrôles rejoués automatiquement sur le fichier effectivement distribué
   (<code>tools/audit-securite.js</code>). Chaque ligne est reproductible : les empreintes sont
   recalculées, les provenances comparées aux paquets publiés, le comportement observé dans un
   navigateur réel.</p>

<div class="fiche">
  <dl>
    <dt>Objet</dt><dd>${ech(r.identite.fichier)}</dd>
    <dt>Version</dt><dd>${ech(r.identite.tag)} — généré le ${ech(r.identite.date)}</dd>
    <dt>Taille</dt><dd>${Math.round(r.identite.octets / 1024)} Ko</dd>
    <dt>SHA-256</dt><dd>${ech(r.identite.empreinte)}</dd>
    <dt>Audit</dt><dd>${ech(r.horodatage)}${HORS_LIGNE ? ' — mode hors ligne' : ''}</dd>
  </dl>
  <p style="margin:13px 0 0"><span class="verdict ${verdict.classe}">${ech(verdict.texte)}</span></p>
</div>

<h2><span class="n">01</span>Nomenclature, provenance et vulnérabilités</h2>
<p class="sub">La version de chaque bibliothèque est <em>déduite de son empreinte</em>, en la
   comparant aux artefacts publiés sur npm : c'est plus sûr qu'un numéro déclaré.
   ${HORS_LIGNE ? '<b>Mode hors ligne : provenance et vulnérabilités non vérifiées.</b>' : ''}</p>
<table><thead><tr><th>Fichier</th><th>Paquet publié</th><th>Rôle</th><th>SHA-256</th>
  <th>Provenance</th><th>Vulnérabilités connues</th></tr></thead>
<tbody>${r.nomenclature.map(ligneBiblio).join('')}</tbody></table>

<h2><span class="n">02</span>Chaîne de confiance du fichier livré</h2>
<table><tbody>
  <tr><td>Bibliothèques retrouvées octet pour octet dans le fichier livré</td>
      <td>${r.inlinees.every(x => x.inlinee) ? oui + ' les ' + r.inlinees.length
          : non + ' ' + r.inlinees.filter(x => !x.inlinee).map(x => ech(x.fichier)).join(', ')}</td></tr>
  <tr><td>Fichier livré reproductible depuis ses sources</td>
      <td>${!r.reproductible.verifie ? nv + ' non vérifié'
          : r.reproductible.identique ? oui + ' identique (hors date de génération)'
          : non + ' écart constaté'}</td></tr>
  <tr><td>Ressources chargées depuis le réseau</td>
      <td>${r.statique.ressourcesExternes.length === 0 ? oui + ' aucune'
          : non + ' ' + ech(r.statique.ressourcesExternes.join(', '))}</td></tr>
  <tr><td>Mentions de licence des bibliothèques tierces</td>
      <td>${r.statique.credits ? oui + ' présentes' : non + ' absentes'}</td></tr>
</tbody></table>

<h2><span class="n">03</span>Politique de sécurité de contenu</h2>
${r.statique.csp
  ? '<p>Déclarée en tête du fichier : le navigateur applique ces règles quoi que fasse le code.</p>'
    + '<table><tbody>' + r.statique.csp.split(';').map(d =>
        '<tr><td class="mono">' + ech(d.trim()) + '</td></tr>').join('') + '</tbody></table>'
  : '<p>' + non + ' <b>Aucune politique déclarée.</b></p>'}

<h2><span class="n">04</span>Points de sortie et API sensibles</h2>
<p class="sub">Recherche exhaustive dans le fichier livré : la colonne « occurrences » est ce qu'un
   outil d'analyse trouvera de son côté. Une occurrence n'est pas un défaut — du code présent
   n'est pas du code atteint —, mais elle doit s'expliquer, et la troisième colonne porte
   l'explication. Ce qui fait foi reste le comportement observé (§05) et la politique du §03 :
   même atteint, aucun de ces appels ne pourrait sortir du poste.</p>
<table><thead><tr><th style="width:16%">Capacité</th><th style="width:8%">Occ.</th>
  <th>Origine dans cet assemblage</th></tr></thead>
<tbody>${r.statique.api.map(ligneApi).join('')}</tbody></table>
<p class="sub">Hôtes cités dans le fichier (espaces de noms XML et liens de crédit compris) :
   ${Object.keys(r.statique.hotes).sort().map(h => '<code>' + ech(h) + '</code>').join(', ') || 'aucun'}.</p>

<h2><span class="n">05</span>Comportement observé</h2>
<table><tbody>
  <tr><td>Types de nœuds qu'un fichier de planning peut instancier</td>
      <td class="mono">${c.types.length} — ${ech(c.types.join(', '))}</td></tr>
  <tr><td>Planning <b>forgé</b> (nœud réseau injecté) : connexions ouvertes</td>
      <td>${c.apresForge.ws.length === 0 ? oui + ' aucune' : non + ' ' + ech(c.apresForge.ws.join(', '))}</td></tr>
  <tr><td>Planning forgé : requêtes sortantes</td>
      <td>${c.apresForge.sorties.length === 0 ? oui + ' aucune' : non + ' ' + ech(c.apresForge.sorties.join(', '))}</td></tr>
  <tr><td>Parcours fonctionnel complet : trafic réseau</td>
      <td>${c.sortiesTotales.length === 0 && c.wsTotales.length === 0 ? oui + ' aucun'
          : non + ' ' + ech(c.sortiesTotales.concat(c.wsTotales).join(', '))}</td></tr>
  <tr><td>Fichiers réellement produits par les ${c.formats.length} exports + la sauvegarde</td>
      <td>${c.telechargements.length === c.formats.length + 1 ? oui + ' ' : non + ' '}
          <span class="mono">${ech(c.telechargements.join(', ')) || 'aucun'}</span></td></tr>
  <tr><td>Fonctions bloquées par la politique de sécurité</td>
      <td>${c.violations.length === 0 ? oui + ' aucune' : non + ' ' + ech(c.violations.join(' | '))}</td></tr>
  <tr><td>Erreurs pendant le parcours</td>
      <td>${c.erreurs.length === 0 ? oui + ' aucune' : non + ' ' + ech(c.erreurs.join(' | '))}</td></tr>
</tbody></table>

<h2><span class="n">06</span>Constats</h2>
${constats.length === 0
  ? '<p>' + oui + ' Aucun constat : tous les contrôles sont au vert.</p>'
  : constats.map(([niv, titre, detail]) => `<div class="constat ${niv}">
      <b>${niv === 'critique' ? '⛔' : '▸'} ${ech(titre)}</b><span>${ech(detail)}</span></div>`).join('')}

<footer>
  Rapport produit le ${ech(r.horodatage)} par <code>tools/audit-securite.js</code> —
  PertFlow ${ech(r.identite.tag)}, © Stéphane Guichard, licence MIT.<br>
  Compte rendu d'une revue technique automatisée, non une certification. Il vaut pour l'empreinte
  <code>${ech(r.identite.empreinte.slice(0, 16))}…</code> et pour elle seule.
</footer>
</body></html>`;
}

// ─── Programme principal ───────────────────────────────────────────────────────

(async () => {
  if (!fs.existsSync(lib.BUNDLE)) {
    console.error('Bundle absent : ' + lib.BUNDLE);
    console.error('  → node scripts/build-bundle.js --tag vX.Y');
    process.exit(2);
  }

  const bundle = fs.readFileSync(lib.BUNDLE, 'utf8');
  const r = { horodatage: new Date().toLocaleString('fr-FR') };

  console.log('Audit de sécurité — ' + path.relative(lib.ROOT, lib.BUNDLE));
  r.identite = identite(bundle);
  console.log('  objet      ' + r.identite.tag + ', ' + Math.round(r.identite.octets / 1024) + ' Ko, '
    + r.identite.empreinte.slice(0, 16) + '…');

  process.stdout.write('  nomenclature… ');
  r.nomenclature = await nomenclature();
  console.log(r.nomenclature.map(b => (b.version ? b.paquet + '@' + b.version : b.paquet)).join(', '));

  r.inlinees = librairiesInlinees(bundle);
  r.statique = inventaireStatique(bundle);
  console.log('  statique    CSP ' + (r.statique.csp ? 'présente' : 'ABSENTE')
    + ', ' + r.statique.ressourcesExternes.length + ' ressource(s) externe(s)');

  process.stdout.write('  reproductibilité… ');
  r.reproductible = reproductible(bundle, r.identite.tag);
  console.log(!r.reproductible.verifie ? 'non vérifiée'
    : r.reproductible.identique ? 'identique aux sources' : 'ÉCART');

  process.stdout.write('  comportement (navigateur réel)… ');
  r.comportement = await comportement();
  console.log(r.comportement.types.length + ' type(s) instanciable(s), '
    + (r.comportement.wsTotales.length + r.comportement.sortiesTotales.length) + ' sortie(s) réseau, '
    + r.comportement.telechargements.length + ' fichier(s) produit(s)');

  // Sorties. Le nom porte le tag : on garde côte à côte les audits de plusieurs
  // versions, ce qui est exactement ce qu'une DSI demande quand elle suit un outil.
  fs.mkdirSync(SORTIE, { recursive: true });
  const base = path.join(SORTIE, 'audit-securite-' + r.identite.tag.replace(/[^\w.-]/g, '_'));
  const html = rendreHtml(r);
  fs.writeFileSync(base + '.html', html, 'utf8');
  console.log('  → ' + path.relative(lib.ROOT, base + '.html'));

  if (!SANS_PDF) {
    const { browser, ctx, page } = await lib.launch();
    await page.goto('file://' + base + '.html');
    await page.pdf({
      path: base + '.pdf', format: 'A4', printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    });
    await ctx.close();
    await browser.close();
    console.log('  → ' + path.relative(lib.ROOT, base + '.pdf'));
  }

  // Code de sortie : 1 s'il reste un constat BLOQUANT, pour que le rituel s'arrête.
  // Les constats mineurs (version en retard, contrôle non vérifié hors ligne) ne
  // doivent pas bloquer une livraison — ils sont dans le rapport, c'est leur place.
  const bloquants = html.indexOf('class="constat critique"') !== -1;
  console.log(bloquants ? '\nCONSTAT BLOQUANT — voir le rapport.' : '\nAucun constat bloquant.');
  process.exit(bloquants ? 1 : 0);
})().catch(e => { console.error('\nAudit interrompu : ' + (e.stack || e.message)); process.exit(2); });
