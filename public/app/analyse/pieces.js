// Les pièces jointes du chat (12/11), côté site : ce qui se calcule sans DOM
// (contrôle avant l'envoi, tailles, nom d'une image collée, ce que dit la
// puce). Les mêmes limites et les mêmes mots que la tour (lib/pieces.js) et
// que l'iPhone (PiecesJointes.swift). Testé par test/site-pieces.test.mjs.

export const PIECE_MAX = 10 * 1024 * 1024;
export const PIECES_PAR_MESSAGE = 4;
/** Ce que le sélecteur de fichiers propose (la tour revérifie le contenu). */
export const ACCEPTE = ".png,.jpg,.jpeg,.webp,.heic,.heif,.pdf,.txt,.md,image/png,image/jpeg,image/webp,image/heic,application/pdf,text/plain,text/markdown";
const EXTENSIONS = { png: "image", jpg: "image", jpeg: "image", webp: "image", heic: "image", heif: "image", pdf: "pdf", txt: "texte", md: "texte", markdown: "texte" };
/** Les images que le navigateur sait dessiner (aperçu, réduction pour le modèle). */
export const DESSINABLES = new Set(["png", "jpg", "jpeg", "webp"]);
/** Le côté le plus long d'une image montrée au modèle de vision local. */
export const COTE_VISION = 1344;

export const extensionDe = (nom) => String(nom || "").toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1] || "";
export const familleDe = (nom) => EXTENSIONS[extensionDe(nom)] || null;

export function tailleLisible(o) {
  const n = Number(o) || 0;
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",").replace(",0", "")} Mo`;
}

/**
 * Peut-on joindre ce fichier ? `deja` : le nombre de pièces déjà dans le
 * composeur. Rend null, ou la phrase qui dit pourquoi non.
 */
export function refus({ nom, taille }, deja = 0) {
  if (deja >= PIECES_PAR_MESSAGE) return `${PIECES_PAR_MESSAGE} pièces au plus par message : envoie celles-ci d'abord.`;
  if (!familleDe(nom)) return `« ${nom || "Ce fichier"} » : type non pris. Images (PNG, JPEG, HEIC, WebP), PDF, et texte (.txt, .md).`;
  if (!(Number(taille) > 0)) return `« ${nom} » est vide.`;
  if (Number(taille) > PIECE_MAX) return `« ${nom} » est trop lourd (${tailleLisible(taille)}) : ${tailleLisible(PIECE_MAX)} au plus.`;
  return null;
}

const deux = (n) => String(n).padStart(2, "0");
/** Le nom d'une image collée (Ctrl+V d'une capture), qui n'en a pas. */
export function nomCollage(type, d = new Date()) {
  const ext = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
  return `capture-${d.getFullYear()}${deux(d.getMonth() + 1)}${deux(d.getDate())}-${deux(d.getHours())}${deux(d.getMinutes())}${deux(d.getSeconds())}.${ext}`;
}

/** La taille d'un aperçu qui tient dans `cote` px, proportions gardées (jamais agrandi). */
export function reduction(largeur, hauteur, cote = COTE_VISION) {
  const l = Number(largeur) || 0;
  const h = Number(hauteur) || 0;
  if (!l || !h) return null;
  const k = Math.min(1, cote / Math.max(l, h));
  return { largeur: Math.max(1, Math.round(l * k)), hauteur: Math.max(1, Math.round(h * k)) };
}

/** Ce que la puce dit d'une pièce envoyée : la mention de la tour, sinon la même règle. */
export function mention(p) {
  if (!p) return "";
  if (typeof p.mention === "string" && p.mention) return p.mention;
  if (p.lu === "texte") return p.famille === "pdf" ? "lue par Rémy (texte du PDF)" : "lue par Rémy";
  if (p.lu === "ocr") return `${p.par === "iphone" ? "texte reconnu sur l'iPhone" : "texte reconnu sur la tour"} — peut se tromper`;
  if (p.lu === "decrite") return "décrite par le modèle local — peut se tromper";
  return `non lue par Rémy${p.raison ? ` : ${p.raison}` : ""}`;
}
/** Lue (en tout ou en partie) par Rémy ? Pour la couleur de la mention. */
export const estLue = (p) => p?.lu === "texte" || p?.lu === "ocr" || p?.lu === "decrite";

/** L'adresse de l'original sur la tour. */
export const adresse = (convId, id, { telecharger = false } = {}) =>
  `/api/conversations/${encodeURIComponent(convId)}/pieces/${encodeURIComponent(id)}${telecharger ? "?telecharger=1" : ""}`;

/** Ce qui part avec un message : le texte peut être vide s'il y a des pièces. */
export const peutPartir = (texte, pieces) => Boolean(String(texte || "").trim()) || (Array.isArray(pieces) && pieces.length > 0);
