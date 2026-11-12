// Les pièces jointes du chat (12/11) : une image, un PDF, un texte joints à un
// message, sur le site (trombone, coller, déposer) et sur l'iPhone.
//
// Ce que Rémy LIT, tout sur la tour ou l'iPhone (jamais un fournisseur cloud) :
//   - un .txt ou un .md : son texte (UTF-8), jusqu'à TEXTE_MAX caractères ;
//   - un PDF : son texte, extrait ici par pdf.js (lib/pdf.js) — un PDF scanné,
//     protégé ou abîmé reste joint, et la raison est dite ;
//   - une image : le texte que l'iPhone y a reconnu (Vision, sur l'appareil),
//     sinon celui de l'OCR de Windows sur la tour (lib/ocr.js) ; et, s'il y a
//     un modèle de vision LOCAL qui voit vraiment (lib/vision.js), sa
//     description. Lectures automatiques : dites comme pouvant se tromper.
// Ce qui n'a rien donné est seulement JOINT : le modèle reçoit une ligne
// (« [pièce jointe non lue : …, raison] ») pour pouvoir le dire. Le modèle de
// conversation ne reçoit que du TEXTE ; seul le cerveau de vision local voit
// une image. Le texte lu suit la règle du reste du message (privé : local
// seulement ; sinon le secours cloud, s'il est allumé, comme le reste).
//
// L'original est GARDÉ, pour être revu dans le fil : chiffré (AES-256-GCM, la
// clé des conversations, hors du coffre — lib/connaissances/chiffre.js) dans
// <base>/pieces/<conversation>/<id>.piece. La base partant dans la sauvegarde,
// les pièces aussi (et la clé, déjà dans l'archive chiffrée). Rien n'est
// recopié en clair dans le coffre Obsidian. Supprimer la conversation
// supprime son dossier ; une pièce envoyée mais jamais jointe à un message est
// effacée au bout de 24 h.
//
// Le type se lit dans les OCTETS (signatures), jamais dans ce que dit
// l'envoyeur : un « .png » qui contient du HTML, un « .md » qui est un PDF
// sont refusés. Le nom est assaini et ne sert jamais de chemin.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dossierBase } from "./store.js";
import { ecrireAtomique } from "./coffre.js";
import { chiffrerOctets, dechiffrerOctets } from "./connaissances/chiffre.js";
import { encadrer } from "./encadrement.js";
import { PRENOM } from "./profil.js";
import { lirePdf } from "./pdf.js";
import { lireImageDetail } from "./ocr.js";
import { decrireImage, DESCRIPTION_MAX } from "./vision.js";

export const PIECE_MAX = 10 * 1024 * 1024; // 10 Mo par pièce
export const PIECES_PAR_MESSAGE = 4;
export const PIECES_PAR_CONVERSATION = 100; // envoyées ou en attente
export const TEXTE_MAX = 20_000; // caractères lus d'un .txt / .md
export const OCR_MAX = 8_000; // caractères reconnus sur une image (iPhone)
export const NOM_MAX = 120;
// Le corps JSON d'un envoi : la pièce en base64 (4/3), son nom, son texte reconnu.
export const CORPS_MAX = Math.ceil((PIECE_MAX * 4) / 3) + 200_000;
export const ORPHELINE_MS = 24 * 3600_000;

const ID_CONV = /^[A-Za-z0-9_-]{1,100}$/;
const ID_PIECE = /^[a-f0-9]{24}$/;
export const idConversationValide = (id) => typeof id === "string" && ID_CONV.test(id);
export const idPieceValide = (id) => typeof id === "string" && ID_PIECE.test(id);

// Ce que la tour sait reconnaître. `mime` : ce qui est servi (le texte, même
// en Markdown, est servi en text/plain : affiché, jamais interprété).
export const TYPES = {
  png: { famille: "image", mime: "image/png", nom: "PNG" },
  jpeg: { famille: "image", mime: "image/jpeg", nom: "JPEG" },
  webp: { famille: "image", mime: "image/webp", nom: "WebP" },
  heic: { famille: "image", mime: "image/heic", nom: "HEIC" },
  pdf: { famille: "pdf", mime: "application/pdf", nom: "PDF" },
  texte: { famille: "texte", mime: "text/plain; charset=utf-8", nom: "texte" },
  markdown: { famille: "texte", mime: "text/plain; charset=utf-8", nom: "Markdown" },
};
const EXTENSIONS = { png: "image", jpg: "image", jpeg: "image", webp: "image", heic: "image", heif: "image", pdf: "pdf", txt: "texte", md: "texte", markdown: "texte" };
export const LIBELLES = { image: "image", pdf: "PDF", texte: "texte" };
export const REFUS_TYPE = "Type de fichier non pris : images (PNG, JPEG, HEIC, WebP), PDF, et texte (.txt, .md).";

export const extensionDe = (nom) => String(nom || "").toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1] || "";

// Le type d'après les premiers octets (null : rien de connu).
export function signature(o) {
  if (!Buffer.isBuffer(o) || o.length < 4) return null;
  if (o.length >= 8 && o.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return "jpeg";
  if (o.length >= 12 && o.toString("latin1", 0, 4) === "RIFF" && o.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (o.length >= 12 && o.toString("latin1", 4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(o.toString("latin1", 8, 12))) return "heic";
  if (o.toString("latin1", 0, 5) === "%PDF-") return "pdf";
  return null;
}

// Du texte lisible : de l'UTF-8 valide, sans octet nul. null sinon.
export function lireTexte(o) {
  try {
    const t = new TextDecoder("utf-8", { fatal: true }).decode(o);
    if (t.includes("\u0000")) return null;
    return t.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  } catch {
    return null;
  }
}

// { type, famille, mime } ou { statut, raison } : le contenu doit être ce que
// dit l'extension (famille), sinon c'est un fichier déguisé.
export function reconnaitre(octets, nom) {
  const attendue = EXTENSIONS[extensionDe(nom)];
  if (!attendue) return { statut: 415, raison: REFUS_TYPE };
  const sig = signature(octets);
  if (attendue === "texte") {
    if (sig) return { statut: 415, raison: `« ${nom} » n'est pas un texte : son contenu est un fichier ${TYPES[sig].nom}. Rien n'a été joint.` };
    const texte = lireTexte(octets);
    if (texte === null) return { statut: 415, raison: `« ${nom} » n'est pas un texte lisible (UTF-8 attendu). Rien n'a été joint.` };
    const type = /\.(md|markdown)$/i.test(nom) ? "markdown" : "texte";
    return { type, ...TYPES[type], texte };
  }
  if (!sig || TYPES[sig].famille !== attendue) {
    return { statut: 415, raison: `« ${nom} » n'est pas ce que dit son nom (${attendue === "pdf" ? "un PDF" : "une image"} attendu${attendue === "pdf" ? "" : "e"}) : rien n'a été joint.` };
  }
  return { type: sig, ...TYPES[sig] };
}

// Un nom affichable et sans danger : jamais un chemin, jamais de caractère de
// contrôle ; l'extension est gardée quand il faut couper.
export function nomPropre(brut) {
  let n = String(brut ?? "")
    .normalize("NFC")
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "");
  if (n.length > NOM_MAX) {
    const ext = extensionDe(n);
    n = ext ? `${n.slice(0, NOM_MAX - ext.length - 2).trimEnd()}….${ext}` : n.slice(0, NOM_MAX);
  }
  return n;
}

export function tailleLisible(o) {
  const n = Number(o) || 0;
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",").replace(",0", "")} Mo`;
}

// --- Rangement (chiffré) -----------------------------------------------------------

export const dossierPieces = (convId) => path.join(dossierBase(), "pieces", convId);
const cheminPiece = (convId, id) => path.join(dossierPieces(convId), `${id}.piece`);
const place = (convId, id) => `piece:${convId}:${id}`;

// Le fichier : chiffré([longueur de la fiche sur 4 octets][fiche JSON][octets]).
function emballer(fiche, octets) {
  const f = Buffer.from(JSON.stringify(fiche), "utf8");
  const l = Buffer.alloc(4);
  l.writeUInt32BE(f.length);
  return Buffer.concat([l, f, octets]);
}

export function lire(convId, id) {
  if (!idConversationValide(convId) || !idPieceValide(id)) return null;
  let brut;
  try {
    brut = fs.readFileSync(cheminPiece(convId, id));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const clair = dechiffrerOctets(brut, place(convId, id));
  const l = clair.readUInt32BE(0);
  const fiche = JSON.parse(clair.subarray(4, 4 + l).toString("utf8"));
  return { fiche, octets: clair.subarray(4 + l) };
}

export function supprimer(convId, id) {
  if (!idConversationValide(convId) || !idPieceValide(id)) return false;
  try {
    fs.rmSync(cheminPiece(convId, id));
    return true;
  } catch {
    return false;
  }
}

// Toutes les pièces d'une conversation (supprimée).
export function supprimerTout(convId) {
  if (!idConversationValide(convId)) return;
  fs.rmSync(dossierPieces(convId), { recursive: true, force: true });
}

const idsDuFil = (conv) => new Set((conv?.messages || []).flatMap((m) => (Array.isArray(m?.pieces) ? m.pieces.map((p) => p?.id) : [])));

// Les pièces envoyées mais jamais jointes (le message n'est pas parti, la page
// a été fermée) : effacées au bout de 24 h. Rend le nombre de pièces restantes.
export function purgerOrphelines(conv, maintenant = Date.now()) {
  if (!idConversationValide(conv?.id)) return 0;
  const jointes = idsDuFil(conv);
  let fichiers;
  try {
    fichiers = fs.readdirSync(dossierPieces(conv.id)).filter((f) => f.endsWith(".piece"));
  } catch {
    return 0;
  }
  let restent = 0;
  for (const f of fichiers) {
    const id = f.slice(0, -6);
    const plein = path.join(dossierPieces(conv.id), f);
    if (!jointes.has(id)) {
      try {
        if (maintenant - fs.statSync(plein).mtimeMs > ORPHELINE_MS) {
          fs.rmSync(plein, { force: true });
          continue;
        }
      } catch {}
    }
    restent++;
  }
  return restent;
}

export const estJointe = (conv, id) => idsDuFil(conv).has(id);

// Une image jointe, plus légère, que le site a réduite pour le modèle de
// vision (JPEG ou PNG, APERCU_MAX au plus) ; l'original reste tel quel.
export const APERCU_MAX = 1_600_000;
function apercuDe(corps) {
  if (typeof corps?.apercu !== "string" || !corps.apercu) return null;
  const b = corps.apercu.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (b.length > Math.ceil((APERCU_MAX * 4) / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b)) return null;
  const o = Buffer.from(b, "base64");
  const sig = signature(o);
  return sig === "jpeg" || sig === "png" ? { octets: o, mime: TYPES[sig].mime } : null;
}

const propreTexte = (t, max) => String(t ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max);

// Ce que Rémy peut lire de la pièce, posé sur sa fiche. Rien ne fait échouer
// l'envoi : ce qui n'a pas pu être lu est dit (`raison`).
async function lirePiece(fiche, octets, r, corps, { ocr, vision, journal }) {
  if (r.famille === "texte") {
    const t = r.texte.trim();
    if (!t) return Object.assign(fiche, { raison: "fichier vide" });
    return Object.assign(fiche, { lu: "texte", texte: t.slice(0, TEXTE_MAX), caracteres: Math.min(t.length, TEXTE_MAX), ...(t.length > TEXTE_MAX ? { tronque: true } : {}) });
  }
  if (r.famille === "pdf") {
    const p = await lirePdf(octets, { texteMax: TEXTE_MAX });
    if (p.pages) fiche.pages = p.pages;
    if (!p.texte) return Object.assign(fiche, { raison: p.raison || "PDF illisible pour Rémy" });
    return Object.assign(fiche, { lu: "texte", texte: p.texte, caracteres: p.texte.length, pagesLues: p.lues, ...(p.tronque ? { tronque: true } : {}) });
  }
  // Une image : son texte (lu sur l'iPhone, sinon par l'OCR de la tour) et,
  // s'il y a un modèle de vision local, sa description.
  const raisons = [];
  const dejaLu = typeof corps?.texte === "string" ? propreTexte(corps.texte, OCR_MAX) : null;
  const iphone = corps?.lecture === "iphone" || Boolean(dejaLu);
  const apercu = apercuDe(corps);
  const [o, d] = await Promise.all([
    iphone ? null : ocr(octets, r.type).catch(() => ({ raison: "la lecture du texte a échoué" })),
    vision(apercu?.octets || octets, apercu?.mime || r.mime, { journal, libelle: fiche.nom }).catch(() => ({ raison: "le modèle de vision a échoué" })),
  ]);
  if (dejaLu) Object.assign(fiche, { texte: dejaLu, caracteres: dejaLu.length, par: "iphone" });
  else if (iphone) raisons.push("aucun texte reconnu sur l'iPhone");
  else if (o?.texte && propreTexte(o.texte, OCR_MAX)) {
    const t = propreTexte(o.texte, OCR_MAX);
    Object.assign(fiche, { texte: t, caracteres: t.length, par: "tour", moteur: String(o.moteur || "OCR").slice(0, 60) });
  } else raisons.push(o?.raison || "aucun texte reconnu sur l'image");
  if (d?.description) Object.assign(fiche, { description: propreTexte(d.description, DESCRIPTION_MAX), modeleVision: String(d.modele || "local").slice(0, 80) });
  else raisons.push(d?.raison || "pas de modèle de vision local");
  fiche.lu = fiche.texte ? "ocr" : fiche.description ? "decrite" : "non";
  if (fiche.lu === "non") fiche.raison = raisons.join(" ; ");
}

// Reçoit une pièce : { nom, donnees (base64), texte? (reconnu sur l'iPhone),
// lecture? (« iphone » : l'iPhone a déjà cherché du texte), apercu? (image
// réduite par le site, pour le modèle de vision) }. Rend { piece } (la fiche,
// avec ce qui a été lu) ou { statut, raison }. `ocr`, `vision` : injectables.
export async function recevoir(conv, corps, { maintenant = Date.now(), ocr = lireImageDetail, vision = decrireImage, journal = null } = {}) {
  const nom = nomPropre(corps?.nom);
  if (!nom || !extensionDe(nom)) return { statut: 400, raison: "Nom de fichier manquant ou sans extension : rien n'a été joint." };
  const b64 = typeof corps?.donnees === "string" ? corps.donnees.replace(/^data:[^,]*,/, "").replace(/\s+/g, "") : "";
  if (!b64) return { statut: 400, raison: "Fichier vide : rien n'a été joint." };
  if (Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0) > PIECE_MAX) {
    return { statut: 413, raison: `« ${nom} » est trop lourd : ${tailleLisible(PIECE_MAX)} au plus par pièce.` };
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return { statut: 400, raison: "Fichier mal transmis (base64 illisible) : réessaie." };
  const octets = Buffer.from(b64, "base64");
  if (!octets.length) return { statut: 400, raison: "Fichier vide : rien n'a été joint." };
  if (octets.length > PIECE_MAX) return { statut: 413, raison: `« ${nom} » est trop lourd : ${tailleLisible(PIECE_MAX)} au plus par pièce.` };
  const r = reconnaitre(octets, nom);
  if (r.statut) return r;
  if (purgerOrphelines(conv, maintenant) >= PIECES_PAR_CONVERSATION) {
    return { statut: 409, raison: `Cette conversation a déjà ${PIECES_PAR_CONVERSATION} pièces jointes : ouvres-en une nouvelle.` };
  }
  const fiche = { id: crypto.randomBytes(12).toString("hex"), nom, type: r.type, famille: r.famille, mime: r.mime, taille: octets.length, at: maintenant, lu: "non" };
  await lirePiece(fiche, octets, r, corps, { ocr, vision, journal });
  fs.mkdirSync(dossierPieces(conv.id), { recursive: true });
  ecrireAtomique(cheminPiece(conv.id, fiche.id), chiffrerOctets(emballer(fiche, octets), place(conv.id, fiche.id)));
  return { piece: fiche };
}

// Ce qui reste dans le message (ce qui a été lu compris : il suit la règle du
// reste du message) ; jamais les octets.
const CHAMPS = ["id", "nom", "type", "famille", "taille", "lu", "texte", "caracteres", "tronque", "par", "moteur", "description", "modeleVision", "pages", "pagesLues", "raison"];
export const pourMessage = (f) => Object.fromEntries(CHAMPS.filter((k) => f?.[k] !== undefined && f[k] !== null && f[k] !== "" && f[k] !== false).map((k) => [k, f[k]]));

// Ce qui s'est passé, en clair (le fil du site et de l'iPhone l'affiche tel quel).
export function mention(p) {
  if (!p) return "";
  if (p.famille === "texte") return p.lu === "texte" ? (p.tronque ? "lue par Rémy (le début)" : "lue par Rémy") : `non lue par Rémy : ${p.raison || "fichier vide"}`;
  if (p.famille === "pdf") {
    if (p.lu !== "texte") return `non lue par Rémy : ${p.raison || "PDF illisible"}`;
    return `lue par Rémy (texte du PDF${p.pages ? `, ${p.pages} page${p.pages > 1 ? "s" : ""}` : ""}${p.tronque ? ", le début seulement" : ""})`;
  }
  const faits = [];
  if (p.texte || (p.lu === "ocr" && p.caracteres)) faits.push(p.par === "iphone" ? "texte reconnu sur l'iPhone" : "texte reconnu sur la tour");
  if (p.description || p.decrite) faits.push("décrite par le modèle local");
  if (!faits.length) return `non lue par Rémy${p.raison ? ` : ${p.raison}` : ""}`;
  return `${faits.join(", ")} — peut se tromper`;
}

// Ce que voient les clients : la fiche et sa mention, sans le texte lu ni la
// description (l'original se rouvre).
export const vuePublique = (p) => {
  if (!p || typeof p !== "object") return p;
  const { texte, description, ...reste } = p;
  return { ...reste, ...(description ? { decrite: true } : {}), mention: mention(p) };
};
export const messagesPublics = (messages) =>
  (messages || []).map((m) => (Array.isArray(m?.pieces) && m.pieces.length ? { ...m, pieces: m.pieces.map(vuePublique) } : m));

// --- Ce que le modèle reçoit (du texte, rien d'autre) ------------------------------

const ficheTexte = (p) =>
  `${String(p.nom || "pièce").replace(/[[\]\u0000-\u001f]/g, " ")}, ${LIBELLES[p.famille] || "fichier"}, ${tailleLisible(p.taille)}${p.pages ? `, ${p.pages} page${p.pages > 1 ? "s" : ""}` : ""}`;
const enChiffres = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function lignePourModele(p) {
  if (!p) return "";
  if (p.lu === "texte" && p.texte) {
    const coupe = p.tronque ? (p.famille === "pdf" && p.pagesLues && p.pages > p.pagesLues ? `, ${p.pagesLues} premières pages seulement` : `, coupée aux ${enChiffres(TEXTE_MAX)} premiers caractères`) : "";
    return `[pièce jointe lue : ${ficheTexte(p)}${p.famille === "pdf" ? " — texte extrait du PDF" : ""}${coupe}]\n${encadrer(p.texte, { source: p.famille === "pdf" ? "pièce jointe (PDF)" : "pièce jointe", titre: p.nom })}`;
  }
  if (p.famille === "image" && (p.texte || p.description)) {
    const blocs = [`[pièce jointe : ${ficheTexte(p)} — tu ne vois pas l'image elle-même ; ce qui suit vient d'une lecture automatique qui peut se tromper]`];
    if (p.texte) blocs.push(`Texte reconnu ${p.par === "iphone" ? "sur l'iPhone" : "sur la tour"} :\n${encadrer(p.texte, { source: "texte reconnu sur une image", titre: p.nom })}`);
    if (p.description) blocs.push(`Description par le modèle de vision local :\n${encadrer(p.description, { source: "description d'une image", titre: p.nom })}`);
    return blocs.join("\n");
  }
  return `[pièce jointe non lue : ${ficheTexte(p)}${p.raison ? ` — ${String(p.raison).replace(/[[\]]/g, " ")}` : ""}]`;
}

export const NOTE_NON_LUE = `(Une pièce « non lue » : tu n'en connais que le nom, le type et la taille. Ne prétends pas l'avoir vue ni lue ; si ${PRENOM} t'en parle, dis-le-lui.)`;

export function texteAvecPieces(content, pieces) {
  const liste = Array.isArray(pieces) ? pieces.filter(Boolean) : [];
  if (!liste.length) return content ?? "";
  const nonLue = liste.some((p) => !(p.texte || p.description));
  return [String(content ?? "").trim(), ...liste.map(lignePourModele), nonLue ? NOTE_NON_LUE : null].filter(Boolean).join("\n\n");
}

// --- Servir l'original ---------------------------------------------------------------

// Un nom pour Content-Disposition : ASCII de secours, et l'UTF-8 encodé.
export function disposition(nom, telecharger) {
  const ascii = String(nom || "piece").normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\;]/g, "").trim() || "piece";
  return `${telecharger ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nom || "piece")}`;
}

// Les en-têtes d'une pièce servie : son type lu dans les octets, jamais
// deviné par le navigateur (nosniff), et rien d'exécutable (CSP bac à sable,
// sauf le PDF que le lecteur du navigateur doit pouvoir afficher).
export function entetes(fiche, { telecharger = false } = {}) {
  const e = {
    "Content-Type": TYPES[fiche.type]?.mime || "application/octet-stream",
    "Content-Disposition": disposition(fiche.nom, telecharger),
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "private, no-store",
  };
  if (fiche.type !== "pdf") e["Content-Security-Policy"] = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
  return e;
}
