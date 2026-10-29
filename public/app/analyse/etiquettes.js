// L'étiquette d'un rappel (ou la catégorie d'une tâche) devinée par les mots,
// sans IA : le port d'`EtiquetteDevinee` (Rangement.swift). Seule une
// étiquette qui EXISTE chez Sam est proposée ; il la retire d'un clic.
// Comparaison sans casse ni accents. Module pur, sans DOM (lu aussi par
// gerer.js et tri-rappels.js, en import()).
import { plier } from "./dates.js";

/** Les mots qui désignent un domaine, dans l'ordre où on les essaie. */
export const INDICES = [
  ["Voiture", ["garage", "voiture", "controle technique", "pneu", "vidange", "parking", "carte grise", "permis"]],
  ["Santé", ["medecin", "docteur", "dentiste", "pharmacie", "ordonnance", "kine", "podologue", "vaccin", "analyse", "mutuelle"]],
  ["Administratif", ["impot", "caf", "banque", "declaration", "papiers", "passeport", "carte d'identite", "urssaf", "facture", "loyer", "assurance"]],
  ["Anniversaire", ["anniversaire", "anniv"]],
  ["Famille et amis", ["maman", "papa", "frere", "soeur", "mamie", "papi", "ami"]],
  ["Professionnel", ["client", "devis", "reunion", "demo", "contrat", "associe", "prospect"]],
];

// « sœur » se plie en « sœur » (la ligature n'est pas un accent) : on la défait.
const plie = (s) => plier(String(s || "")).replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/[’‘]/g, "'");

/** L'étiquette existante qui correspond au texte ({ id, nom… }), ou null. */
export function etiquettePour(texte, etiquettes = []) {
  const t = ` ${plie(texte)} `;
  for (const [nom, mots] of INDICES) {
    if (!mots.some((m) => t.includes(plie(m)))) continue;
    const e = (etiquettes || []).find((x) => x && plie(x.nom) === plie(nom));
    if (e) return e;
  }
  return null;
}

/** Contrat E : l'identifiant de l'étiquette devinée, ou null. */
export const etiquetteDevinee = (texte, etiquettes) => etiquettePour(texte, etiquettes)?.id ?? null;
