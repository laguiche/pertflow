// ─── Import des plannings legacy Excel (C-PERT .xlsm) ───────────────────────────
//
// Session 3 (#8). Lit un fichier .xlsm exporte par l'outil C-PERT et le concatene
// dans le PERT courant. Tout passe par les objets graphiques (groupes = noeuds,
// connecteurs = aretes) ; les metadonnees (T0, unite, feuille cible) sont lues
// dans la feuille de config "MANUEL".
//
// Contrainte file:// (cf. CLAUDE.md) : pas de fetch, pas de module ES6, pas de
// serveur. Le .xlsm (un ZIP) est dezippe par fflate (lib/fflate.min.js, charge en
// <script src> avant ce fichier) a partir d'un ArrayBuffer fourni par FileReader.
// Les XML sont parses par DOMParser natif (navigateur).
//
// Architecture en 2 couches pour permettre un test headless Node :
//   - extraction DOM (extractDrawingModel / extractConfig)  → navigateur uniquement
//   - transforms purs (buildImportModel + helpers)          → testables sous Node

(function (global) {
  "use strict";

  // EMU (English Metric Units) → pixels : 914400 EMU = 96 px → 9525 EMU/px
  var EMU_PER_PX = 9525;

  // Namespaces DrawingML / SpreadsheetML
  var NS = {
    xdr: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    a:   "http://schemas.openxmlformats.org/drawingml/2006/main",
    ss:  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    r:   "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  };

  // ─── Helpers purs (testables headless) ──────────────────────────────────────

  // Date serie Excel → "YYYY-MM-DD". Epoch 1899-12-30 (gere le bug an 1900).
  function xlSerialToISO(serial) {
    var n = Number(serial);
    if (!isFinite(n)) return null;
    var d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return isoDate(d);
  }

  function isoDate(d) {
    var y = d.getUTCFullYear();
    var m = ("0" + (d.getUTCMonth() + 1)).slice(-2);
    var day = ("0" + d.getUTCDate()).slice(-2);
    return y + "-" + m + "-" + day;
  }

  // "jj/mm/aaaa" → "YYYY-MM-DD" (ou null)
  function frDateToISO(s) {
    var m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? m[3] + "-" + m[2] + "-" + m[1] : null;
  }

  // Nombre decimal francais ("1,9" → 1.9)
  function parseFrNumber(s) {
    var v = parseFloat(String(s).replace(",", "."));
    return isFinite(v) ? v : 0;
  }

  // Champ valeur "duree/marge" (ex. "1,9/0") → premiere valeur = duree.
  function parseDurationField(txt) {
    var parts = String(txt || "").split("/");
    return parseFrNumber(parts[0]);
  }

  // Libelle de jalon "STRE=(01/10/2025)" → { label:"STR", due_date:"2025-10-01" }.
  // La date-cible est collee au texte via "E=(jj/mm/aaaa)".
  function parseMilestoneLabel(txt) {
    var s = String(txt || "");
    var m = s.match(/^([\s\S]*?)\s*E=\(\s*(\d{2}\/\d{2}\/\d{4})\s*\)\s*$/);
    if (m) return { label: m[1].trim(), due_date: frDateToISO(m[2]) };
    return { label: s.trim(), due_date: null };
  }

  // Prefixe du nom de groupe → type de noeud.
  function nodeTypeFromName(name) {
    var c = String(name || "").charAt(0).toUpperCase();
    if (c === "S") return "milestone";
    if (c === "E") return "start";
    return "activity"; // "A" et tout le reste
  }

  // J10 de MANUEL → unite PertFlow (1=mois, 2=semaines).
  function mapUnit(j10) {
    return String(j10) === "2" ? "sem" : "mois";
  }

  // Premiere sous-forme dont le texte ressemble a un champ "x/y".
  function findValueText(subs) {
    for (var i = 0; i < subs.length; i++) {
      if (/-?\d[\d,]*\s*\/\s*-?\d/.test(subs[i].text || "")) return subs[i].text;
    }
    return null;
  }

  // Premiere sous-forme contenant une date jj/mm/aaaa.
  function findDateText(subs) {
    for (var i = 0; i < subs.length; i++) {
      if (/\d{2}\/\d{2}\/\d{4}/.test(subs[i].text || "")) return subs[i].text;
    }
    return null;
  }

  // ─── Construction du modele d'import (PUR) ──────────────────────────────────
  //
  // rawGroups : [{ name, off:{x,y}, subs:[{id,name,text}] }]
  // rawCxns   : [{ name, st, end }]   (st/end = id d'une sous-forme quelconque)
  // config    : { t0, unit, sheet }   (lue dans MANUEL ; champs optionnels)
  //
  // Retour : { t0, unit, nodes:[{srcName,type,label,duration|due_date,off}],
  //            edges:[{from,to}] }  — noms de groupes en cles de liens.
  function buildImportModel(rawGroups, rawCxns, config) {
    config = config || {};

    // Map id de sous-forme → nom de groupe parent (pour resoudre les connecteurs).
    var id2group = {};
    rawGroups.forEach(function (g) {
      (g.subs || []).forEach(function (s) { id2group[s.id] = g.name; });
    });

    var t0 = config.t0 || null;
    var nodes = [];

    rawGroups.forEach(function (g) {
      var type = nodeTypeFromName(g.name);
      var subs = g.subs || [];
      var labelText = (subs[0] && subs[0].text) || g.name;

      if (type === "start") {
        // Noeud E = JALON ENTRANT (contrainte externe : "Jalon entree" dans C-PERT).
        // Il sert toujours de source T0 de secours (si la config MANUEL n'a pas de T0),
        // mais on le MATERIALISE desormais en Jalon avec sa date-cible et on CONSERVE
        // ses aretes sortantes (cf. plus bas) : la tache en aval ne demarre plus a T0
        // mais a cette date. Avec la regle "jalon entrant" du moteur (aucun lien
        // entrant + un lien sortant + date-cible → ES = date), la contrainte est
        // restituee automatiquement. Un E pose exactement a T0 donne un jalon a T0
        // (legere redondance assumee : il documente la contrainte d'entree).
        var eDt = findDateText(subs);
        var eDate = eDt ? frDateToISO(eDt) : null;
        if (!t0 && eDate) t0 = eDate;
        var ml = parseMilestoneLabel(labelText);
        nodes.push({
          srcName: g.name, type: "milestone", off: g.off || { x: 0, y: 0 },
          label: ml.label || labelText.trim(),
          // date-cible : celle encodee dans le libelle (E=(...)), sinon la date du noeud
          due_date: ml.due_date || eDate
        });
        return;
      }

      var node = { srcName: g.name, type: type, off: g.off || { x: 0, y: 0 } };
      if (type === "activity") {
        node.label = labelText.trim();
        node.duration = parseDurationField(findValueText(subs));
      } else { // milestone
        var ml2 = parseMilestoneLabel(labelText);
        node.label = ml2.label;
        node.due_date = ml2.due_date;
      }
      nodes.push(node);
    });

    // Aretes : on resout via id2group. Les noeuds E etant desormais materialises en
    // Jalons entrants, leurs aretes sortantes sont CONSERVEES (la contrainte d'entree
    // se propage a la tache en aval). On ne retire que les self-loops et les liens
    // dont une extremite ne resout pas vers un groupe connu.
    var edges = [];
    (rawCxns || []).forEach(function (c) {
      var from = id2group[c.st];
      var to = id2group[c.end];
      if (from === undefined || to === undefined) return;
      if (from === to) return;
      edges.push({ from: from, to: to });
    });

    return {
      t0: t0,
      unit: config.unit || "mois",
      sheet: config.sheet || null,
      nodes: nodes,
      edges: edges
    };
  }

  // ─── Extraction DOM (navigateur) ────────────────────────────────────────────

  function parseXml(str) {
    return new global.DOMParser().parseFromString(str, "application/xml");
  }

  function child(el, ns, local) {
    var list = el.getElementsByTagNameNS(ns, local);
    return list.length ? list[0] : null;
  }

  function textOf(sp) {
    var ts = sp.getElementsByTagNameNS(NS.a, "t");
    var out = "";
    for (var i = 0; i < ts.length; i++) out += ts[i].textContent || "";
    return out;
  }

  // drawingN.xml → { groups, cxns } au format attendu par buildImportModel.
  function extractDrawingModel(xmlStr) {
    var doc = parseXml(xmlStr);
    var anchors = doc.getElementsByTagNameNS(NS.xdr, "twoCellAnchor");
    var groups = [], cxns = [];

    for (var i = 0; i < anchors.length; i++) {
      var anchor = anchors[i];
      var grp = child(anchor, NS.xdr, "grpSp");
      var cxn = child(anchor, NS.xdr, "cxnSp");

      if (grp) {
        var gpr = child(child(grp, NS.xdr, "nvGrpSpPr"), NS.xdr, "cNvPr");
        var off = child(grp, NS.a, "off"); // grpSpPr/xfrm/off (1er off rencontre)
        var subs = [];
        var sps = grp.getElementsByTagNameNS(NS.xdr, "sp");
        for (var j = 0; j < sps.length; j++) {
          var spr = child(child(sps[j], NS.xdr, "nvSpPr"), NS.xdr, "cNvPr");
          subs.push({
            id: spr ? spr.getAttribute("id") : null,
            name: spr ? spr.getAttribute("name") : null,
            text: textOf(sps[j])
          });
        }
        groups.push({
          name: gpr ? gpr.getAttribute("name") : null,
          off: off ? {
            x: parseInt(off.getAttribute("x"), 10) || 0,
            y: parseInt(off.getAttribute("y"), 10) || 0
          } : { x: 0, y: 0 },
          subs: subs
        });
      } else if (cxn) {
        var cpr = child(child(cxn, NS.xdr, "nvCxnSpPr"), NS.xdr, "cNvPr");
        var st = child(cxn, NS.a, "stCxn");
        var en = child(cxn, NS.a, "endCxn");
        cxns.push({
          name: cpr ? cpr.getAttribute("name") : null,
          st: st ? st.getAttribute("id") : null,
          end: en ? en.getAttribute("id") : null
        });
      }
    }
    return { groups: groups, cxns: cxns };
  }

  // ─── Lecture de la config (feuille MANUEL) ──────────────────────────────────

  // sharedStrings.xml → tableau de chaines.
  function parseSharedStrings(xmlStr) {
    if (!xmlStr) return [];
    var doc = parseXml(xmlStr);
    var sis = doc.getElementsByTagNameNS(NS.ss, "si");
    var out = [];
    for (var i = 0; i < sis.length; i++) {
      var ts = sis[i].getElementsByTagNameNS(NS.ss, "t");
      var s = "";
      for (var j = 0; j < ts.length; j++) s += ts[j].textContent || "";
      out.push(s);
    }
    return out;
  }

  // Valeur d'une cellule (ref ex. "K2") dans une feuille, chaines partagees resolues.
  function cellValue(sheetDoc, ref, shared) {
    var cells = sheetDoc.getElementsByTagNameNS(NS.ss, "c");
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].getAttribute("r") !== ref) continue;
      var t = cells[i].getAttribute("t");
      var v = child(cells[i], NS.ss, "v");
      var is = child(cells[i], NS.ss, "is");
      if (t === "s" && v) return shared[parseInt(v.textContent, 10)];
      if (is) return (is.textContent || "").trim();
      if (v) return v.textContent;
      return null;
    }
    return null;
  }

  // Construit l'index des feuilles : name → { sheetPath, drawingPath }.
  function indexSheets(files) {
    var wb = parseXml(textFile(files, "xl/workbook.xml"));
    var rels = parseXml(textFile(files, "xl/_rels/workbook.xml.rels"));

    // rId → cible (worksheets/sheetN.xml)
    var rid2target = {};
    var rl = rels.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/package/2006/relationships", "Relationship");
    for (var i = 0; i < rl.length; i++) {
      rid2target[rl[i].getAttribute("Id")] = rl[i].getAttribute("Target");
    }

    var index = {};
    var sheets = wb.getElementsByTagNameNS(NS.ss, "sheet");
    for (var k = 0; k < sheets.length; k++) {
      var name = sheets[k].getAttribute("name");
      var rid = sheets[k].getAttributeNS(NS.r, "id");
      var target = rid2target[rid];
      if (!target) continue;
      var sheetPath = "xl/" + target.replace(/^\/?xl\//, "");
      index[name] = { sheetPath: sheetPath, drawingPath: drawingForSheet(files, sheetPath) };
    }
    return index;
  }

  // Resout le drawing associe a une feuille via ses _rels.
  function drawingForSheet(files, sheetPath) {
    var m = sheetPath.match(/([^\/]+)\.xml$/);
    if (!m) return null;
    var relsPath = "xl/worksheets/_rels/" + m[1] + ".xml.rels";
    var relsStr = textFile(files, relsPath);
    if (!relsStr) return null;
    var rels = parseXml(relsStr);
    var rl = rels.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/package/2006/relationships", "Relationship");
    for (var i = 0; i < rl.length; i++) {
      var tgt = rl[i].getAttribute("Target") || "";
      if (/drawings\/drawing\d+\.xml$/.test(tgt)) {
        return "xl/" + tgt.replace(/^\.\.\//, "").replace(/^\/?xl\//, "");
      }
    }
    return null;
  }

  // Lit T0 / unite / feuille cible dans la feuille MANUEL (cellules fixes,
  // version C-PERT 6.14.x). Tolerant : renvoie ce qu'il trouve.
  function extractConfig(files) {
    var index = indexSheets(files);
    var shared = parseSharedStrings(textFile(files, "xl/sharedStrings.xml"));

    // Trouver la feuille de config (MANUEL / MANUAL)
    var manualName = Object.keys(index).find(function (n) {
      return /^manue?l$|^manual$/i.test(n.trim());
    });
    var cfg = { t0: null, unit: "mois", sheet: null, sheets: index };
    if (manualName) {
      var doc = parseXml(textFile(files, index[manualName].sheetPath));
      var k2 = cellValue(doc, "K2", shared);   // feuille PERT cible
      var k5 = cellValue(doc, "K5", shared);   // T0 (serie Excel)
      var j10 = cellValue(doc, "J10", shared); // unite (1=mois, 2=sem)
      if (k2) cfg.sheet = String(k2).trim();
      if (k5) cfg.t0 = xlSerialToISO(k5);
      if (j10 != null) cfg.unit = mapUnit(j10);
    }
    return cfg;
  }

  // ─── Orchestration (navigateur) ─────────────────────────────────────────────

  function textFile(files, path) {
    var bytes = files[path];
    if (!bytes) return null;
    return strFromU8(bytes);
  }

  function strFromU8(bytes) {
    if (global.fflate && global.fflate.strFromU8) return global.fflate.strFromU8(bytes);
    // Fallback (navigateurs recents)
    return new global.TextDecoder("utf-8").decode(bytes);
  }

  // ArrayBuffer (.xlsm) → modele d'import { t0, unit, sheet, nodes, edges }.
  // chosenSheet : nom de feuille force par l'utilisateur (sinon config.sheet).
  function importXlsm(arrayBuffer, chosenSheet) {
    var files = global.fflate.unzipSync(new Uint8Array(arrayBuffer));
    var cfg = extractConfig(files);

    var sheetName = chosenSheet || cfg.sheet;
    var sheetInfo = sheetName && cfg.sheets ? cfg.sheets[sheetName] : null;
    var drawingPath = sheetInfo ? sheetInfo.drawingPath : null;

    if (!drawingPath || !files[drawingPath]) {
      throw new Error("Feuille PERT introuvable" +
        (sheetName ? " (\"" + sheetName + "\")" : "") + " ou sans dessin associe.");
    }

    var dm = extractDrawingModel(textFile(files, drawingPath));
    var model = buildImportModel(dm.groups, dm.cxns, cfg);
    return model;
  }

  // Liste des feuilles contenant des groupes PERT (pour le dialogue de fallback).
  function listPertSheets(arrayBuffer) {
    var files = global.fflate.unzipSync(new Uint8Array(arrayBuffer));
    var index = indexSheets(files);
    var out = [];
    Object.keys(index).forEach(function (name) {
      var dp = index[name].drawingPath;
      if (dp && files[dp]) {
        var dm = extractDrawingModel(textFile(files, dp));
        if (dm.groups.length) out.push({ name: name, nodes: dm.groups.length });
      }
    });
    return out;
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  var api = {
    // pur / testable
    xlSerialToISO: xlSerialToISO,
    frDateToISO: frDateToISO,
    parseFrNumber: parseFrNumber,
    parseDurationField: parseDurationField,
    parseMilestoneLabel: parseMilestoneLabel,
    nodeTypeFromName: nodeTypeFromName,
    mapUnit: mapUnit,
    buildImportModel: buildImportModel,
    EMU_PER_PX: EMU_PER_PX,
    // navigateur
    extractDrawingModel: typeof global.DOMParser !== "undefined" ? extractDrawingModel : undefined,
    importXlsm: importXlsm,
    listPertSheets: listPertSheets
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PertExcel = api;

})(typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : this));
