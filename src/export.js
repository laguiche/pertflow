// ─── Export PNG et PDF — Session 3 ──────────────────────────────────────────────
//
// Strategie : rendu HORS-ECRAN de l'integralite du planning, independant du zoom
// et du cadrage courants. On calcule la boite englobante de tous les noeuds, on
// cree un canvas a cette taille, on y attache un LGraphCanvas temporaire (sans
// boucle de rendu ni evenements) cale sur la boite, on dessine une fois, puis on
// exporte le contenu. Le PDF embarque ce PNG via jsPDF (charge en local, file://).
//
// Convention LiteGraph : ecran = (graphe + ds.offset) * ds.scale.

const PERT_EXPORT_MARGIN = 30;     // marge en pixels autour du planning
const PERT_EXPORT_MAX_PX = 6000;   // garde-fou resolution (memoire canvas)

// Rend tout le graphe dans un canvas hors-ecran a fond blanc.
// renderScale (defaut 1) = facteur de suréchantillonnage : un rendu a 2x produit
// une image plus nette une fois ajustee a la page (utile pour le PDF, #29), au prix
// d'une resolution plus elevee (bornee par PERT_EXPORT_MAX_PX).
// Renvoie { canvas, w, h } ou null si rien a exporter.
function pertRenderToCanvas(renderScale) {
  const graph = window.pertGraph;
  const nodes = graph && graph._nodes ? graph._nodes : [];
  if (!nodes.length) return null;

  // Boite englobante de tous les noeuds (getBounding renvoie [x, y, w, h]).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const b = new Float32Array(4);
  for (const n of nodes) {
    n.getBounding(b);
    minX = Math.min(minX, b[0]);
    minY = Math.min(minY, b[1]);
    maxX = Math.max(maxX, b[0] + b[2]);
    maxY = Math.max(maxY, b[1] + b[3]);
  }
  const m = PERT_EXPORT_MARGIN;                 // marge en pixels image
  let scale = renderScale && renderScale > 0 ? renderScale : 1;
  // Dimensions image = boite englobante mise a l'echelle + marges (en px image).
  let w = Math.ceil((maxX - minX) * scale + 2 * m);
  let h = Math.ceil((maxY - minY) * scale + 2 * m);
  if (w <= 0 || h <= 0) return null;

  // Garde-fou : borne la resolution en conservant le ratio (gros plannings ou
  // facteur de suréchantillonnage trop ambitieux).
  if (w > PERT_EXPORT_MAX_PX || h > PERT_EXPORT_MAX_PX) {
    const k = Math.min(PERT_EXPORT_MAX_PX / w, PERT_EXPORT_MAX_PX / h);
    scale *= k;
    w = Math.floor(w * k);
    h = Math.floor(h * k);
  }

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;

  // skip_events : pas d'ecouteurs souris/clavier ; skip_render : pas de boucle
  // d'animation (on appelle draw() manuellement, une seule fois).
  const tmp = new LGraphCanvas(off, graph, { skip_events: true, skip_render: true });
  tmp.background_image = null;
  tmp.render_shadows = false;
  tmp.render_canvas_border = false;
  tmp.show_info = false;                  // pas d'overlay debug (T/I/N/V/FPS)
  tmp.clear_background = true;
  tmp.clear_background_color = "#ffffff"; // fond blanc (defaut LiteGraph = sombre)

  // Caler la boite englobante dans le canvas avec la marge : ecran = (g+off)*scale
  // → on veut que le point graphe (minX,minY) tombe a (m, m) pixels.
  tmp.ds.scale = scale;
  tmp.ds.offset[0] = m / scale - minX;
  tmp.ds.offset[1] = m / scale - minY;

  // Forcer le rendu complet (front + background) sur le canvas hors-ecran.
  tmp.draw(true, true);

  // Detacher le canvas temporaire du graphe (sinon il reste reference dans
  // graph.list_of_graphcanvas et recoit les futurs setDirtyCanvas inutilement).
  if (graph.detachCanvas) graph.detachCanvas(tmp);

  return { canvas: off, w, h };
}

// Telecharge un dataURL sous le nom donne.
function pertDownloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Export PNG : capture hors-ecran → telechargement.
function pertExportPNG() {
  const res = pertRenderToCanvas();
  if (!res) { showToast("Rien a exporter (planning vide)"); return; }
  const dataUrl = res.canvas.toDataURL("image/png");
  const name = (window.pertProjectFilename ? pertProjectFilename() : "pertflow") + ".png";
  pertDownloadDataUrl(dataUrl, name);
  showToast("Export PNG : " + name);
}

// Export PDF : capture hors-ecran → page A4 (orientation selon le ratio),
// image ajustee a la page en conservant les proportions, titre en en-tete.
function pertExportPDF() {
  // #29 Rendu a 2x pour une meilleure definition une fois l'image ajustee a l'A4.
  const res = pertRenderToCanvas(2);
  if (!res) { showToast("Rien a exporter (planning vide)"); return; }

  const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) { showToast("Bibliotheque PDF indisponible"); return; }

  const dataUrl = res.canvas.toDataURL("image/png");
  const orientation = res.w >= res.h ? "landscape" : "portrait";
  // #29 compress:true → flux image deflate (sans perte) : reduit drastiquement le
  // poids du PDF (jsPDF stockait l'image non compressee, d'ou des fichiers ~1,5 Mo).
  const pdf = new jsPDFCtor({ orientation, unit: "pt", format: "a4", compress: true });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const headerH = 22; // bandeau titre en haut

  const title = (window.pertMeta && window.pertMeta.title) || "PertFlow";
  pdf.setFontSize(13);
  pdf.text(title, margin, margin + 4);

  // Zone disponible pour l'image (sous le bandeau titre).
  const availW = pageW - 2 * margin;
  const availH = pageH - 2 * margin - headerH;
  const ratio = Math.min(availW / res.w, availH / res.h);
  const imgW = res.w * ratio;
  const imgH = res.h * ratio;
  const x = (pageW - imgW) / 2;
  const y = margin + headerH;

  pdf.addImage(dataUrl, "PNG", x, y, imgW, imgH);

  const name = (window.pertProjectFilename ? pertProjectFilename() : "pertflow") + ".pdf";
  pdf.save(name);
  showToast("Export PDF : " + name);
}

window.pertExportPNG = pertExportPNG;
window.pertExportPDF = pertExportPDF;
window.pertRenderToCanvas = pertRenderToCanvas;
