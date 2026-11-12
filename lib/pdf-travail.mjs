// Fil de travail de la lecture d'un PDF (lib/pdf.js) : le PDF est une matière
// NON FIABLE, lue à part du serveur — un fichier piégé qui bloque ou gonfle la
// mémoire n'arrête que ce fil, que lib/pdf.js coupe au délai.
// Extraction du TEXTE seulement : ni rendu, ni polices chargées, ni eval, ni
// XFA, ni scripts (pdf.js n'exécute jamais le JavaScript d'un PDF sans son bac
// à sable, qui n'est pas chargé ici), ni pièces incluses, ni réseau.
import { parentPort, workerData } from "node:worker_threads";

// pdf.js prévient sur la console (« Cannot polyfill DOMMatrix » : rien à
// dessiner ici) : ces avertissements ne disent rien à Sam.
console.log = console.warn = console.info = console.error = () => {};

const { octets, pagesMax, texteMax } = workerData;
try {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const tache = getDocument({
    data: new Uint8Array(octets),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    isOffscreenCanvasSupported: false,
    useWorkerFetch: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const doc = await tache.promise;
  const pages = doc.numPages;
  const aLire = Math.min(pages, pagesMax);
  let texte = "";
  let lues = 0;
  for (let i = 1; i <= aLire && texte.length <= texteMax; i++) {
    const page = await doc.getPage(i);
    const contenu = await page.getTextContent();
    texte += contenu.items.map((it) => `${it.str || ""}${it.hasEOL ? "\n" : ""}`).join("") + "\n\n";
    page.cleanup();
    lues = i;
  }
  await tache.destroy();
  parentPort.postMessage({ ok: true, pages, lues, texte });
} catch (err) {
  parentPort.postMessage({ ok: false, nom: String(err?.name || "Error"), message: String(err?.message || err).slice(0, 200) });
}
