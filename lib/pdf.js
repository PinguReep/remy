// Lire le texte d'un PDF joint au chat (12/11), sur la tour, avec pdf.js
// (pdfjs-dist, build « legacy » pour Node : une bibliothèque, aucun service,
// aucune requête réseau). Bornes : PDF_PAGES_MAX pages, `texteMax`
// caractères, PDF_DELAI_MS, et la mémoire du fil de travail. Un PDF protégé,
// abîmé, trop long à lire ou sans couche de texte (scanné) ne fait jamais
// échouer l'envoi : il reste joint, et la raison est dite.

import { Worker } from "node:worker_threads";

export const PDF_PAGES_MAX = 50;
export const PDF_DELAI_MS = 20_000;
const MEMOIRE_MO = 384;

// La raison, en clair, d'un PDF qui n'a pas pu être lu.
export function raisonPdf(nom, message = "") {
  if (nom === "PasswordException" || /password/i.test(message)) return "PDF protégé par un mot de passe";
  if (nom === "InvalidPDFException" || nom === "FormatError" || /invalid pdf|corrupt|xref|startxref/i.test(message)) return "PDF abîmé ou illisible";
  return "PDF illisible pour Rémy";
}

// { texte, pages, lues, tronque } ou { raison }.
export function lirePdf(octets, { texteMax = 20_000, pagesMax = PDF_PAGES_MAX, delaiMs = PDF_DELAI_MS } = {}) {
  return new Promise((resolve) => {
    let fini = false;
    const finir = (r) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      travail.terminate().catch(() => {});
      resolve(r);
    };
    const travail = new Worker(new URL("./pdf-travail.mjs", import.meta.url), {
      workerData: { octets: Buffer.from(octets), pagesMax, texteMax },
      resourceLimits: { maxOldGenerationSizeMb: MEMOIRE_MO },
      stdout: true,
      stderr: true,
    });
    travail.stdout?.resume();
    travail.stderr?.resume();
    const minuteur = setTimeout(() => finir({ raison: `lecture du PDF trop longue (plus de ${Math.round(delaiMs / 1000)} s)` }), delaiMs);
    travail.on("message", (m) => {
      if (!m?.ok) return finir({ raison: raisonPdf(m?.nom, m?.message) });
      const brut = String(m.texte || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (!brut) return finir({ raison: "PDF sans texte (scanné ?) : Rémy ne lit pas encore les PDF scannés", pages: m.pages });
      finir({
        texte: brut.slice(0, texteMax),
        pages: m.pages,
        lues: m.lues,
        tronque: brut.length > texteMax || m.lues < m.pages,
      });
    });
    travail.on("error", (err) => finir({ raison: /memory|heap/i.test(String(err?.message)) ? "PDF trop lourd à lire" : raisonPdf(err?.name, err?.message) }));
    travail.on("exit", () => finir({ raison: "PDF illisible pour Rémy" }));
  });
}
