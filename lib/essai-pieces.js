// « Essayer la lecture des pièces » (12/11) : la tour essaie elle-même ce
// qu'elle sait lire, sur des fichiers d'essai FICTIFS (lib/fichiers-essai.js) :
// l'OCR de Windows, le modèle local avec une image, un PDF. Seulement sur un
// geste de Sam (Réglages, ou scripts/essai-pieces.mjs) ; borné dans le temps ;
// jamais d'adresse ni de jeton dans le résultat.
// Toutes les images passent par la tour, celles de l'iPhone comprises : une
// ligne OCR en échec veut dire « aucune image n'est lue, d'où qu'elle vienne ».
// Dernière ligne : l'outil lire_piece (lib/outil-pieces.js) est-il offert au
// modèle local ? Un constat de réglages, sans appel au modèle.

import { lireImageDetail } from "./ocr.js";
import { eprouverVision } from "./vision.js";
import { lirePdf } from "./pdf.js";
import { pdfEssai, pngMot } from "./fichiers-essai.js";
import { outilPiecesActif, NOM_OUTIL } from "./outil-pieces.js";
import { modeleLocalChezToi } from "./glm.js";

export const ESSAI_DELAI_MS = 75_000;
const LANGUES = { fr: "français", en: "anglais", de: "allemand", es: "espagnol", it: "italien" };
const langue = (moteur) => {
  const tag = String(moteur || "").match(/\(([a-z]{2})(?:-[A-Z]{2})?\)/)?.[1];
  return tag ? LANGUES[tag] || tag : null;
};
const borne = (p, ms, quoi) => Promise.race([p, new Promise((r) => setTimeout(() => r({ raison: `${quoi} : pas de réponse en ${Math.round(ms / 1000)} s` }), ms).unref?.())]);

// L'outil lire_piece : offert seulement au modèle local, s'il est sur tes machines.
export function relecture(env = process.env) {
  const libelle = "Le modèle relit une pièce (outil)";
  if (!outilPiecesActif(env)) return { cle: "relecture", libelle, ok: false, detail: "non — coupé sur la tour (REMY_OUTIL_PIECES=off)" };
  if (!env.REMY_GLM_URL) return { cle: "relecture", libelle, ok: false, detail: "non — pas de modèle local branché sur la tour" };
  if (!modeleLocalChezToi(env.REMY_GLM_URL)) return { cle: "relecture", libelle, ok: false, detail: "non — le modèle déclaré n'est pas sur tes machines : aucune pièce ne lui est relue" };
  return { cle: "relecture", libelle, ok: true, detail: `oui (${NOM_OUTIL} : la suite d'un PDF, une image relue ; jamais pour Claude)` };
}

// [{ cle, libelle, ok, detail }] et le diagnostic à copier.
export async function essayerLecture({ journal = null, delaiMs = ESSAI_DELAI_MS } = {}) {
  const [o, v, p] = await Promise.all([
    borne(lireImageDetail(pngMot("REMY 42"), "png"), delaiMs, "OCR"),
    borne(eprouverVision({ journal, delaiMs: delaiMs - 5000 }), delaiMs, "modèle local"),
    borne(lirePdf(pdfEssai(["Essai de lecture de Remy", "Total : 42,00 EUR"])), delaiMs, "PDF"),
  ]);
  const lignes = [];
  if (o.texte !== undefined) {
    const relu = /REMY\s*42/i.test(o.texte.replace(/\s+/g, " "));
    const essai = o.moteur === "essai";
    lignes.push({ cle: "ocr", libelle: "Reconnaissance de texte Windows", ok: true, detail: essai ? "oui, moteur d'essai (tour de démonstration)" : `oui${langue(o.moteur) ? `, ${langue(o.moteur)}` : ""}${relu ? "" : " (le mot d'essai n'a pas été bien relu)"}` });
  } else lignes.push({ cle: "ocr", libelle: "Reconnaissance de texte Windows", ok: false, detail: `non — ${o.raison} ; le texte des images, du site comme de l'iPhone, n'est donc pas lu` });
  if (v.voit) lignes.push({ cle: "vision", libelle: "Le modèle local lit les images", ok: true, detail: `oui${v.modele ? ` (${v.modele})` : ""}` });
  else lignes.push({ cle: "vision", libelle: "Le modèle local lit les images", ok: false, detail: `non — ${v.raison || "réponse inattendue"}` });
  if (p.texte && /Essai de lecture/.test(p.texte)) lignes.push({ cle: "pdf", libelle: "PDF", ok: true, detail: "oui" });
  else lignes.push({ cle: "pdf", libelle: "PDF", ok: false, detail: `non — ${p.raison || "texte d'essai mal relu"}` });
  lignes.push(relecture());
  const diagnostic = ["Lecture des pièces jointes (essai de la tour)", ...lignes.map((l) => `${l.libelle} : ${l.detail}`)].join("\n");
  return { lignes, diagnostic, at: Date.now() };
}
