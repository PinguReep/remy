// Routes des conversations externes (29/10). Toutes derrière la session : ce
// que tu as dit ailleurs ne sort que vers ton app et ton site. Le contrat
// (formes JSON) est décrit dans docs/conversations-externes.md.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { sendJSON, readJSON } from "../http.js";
import { requireAuth } from "../auth.js";
import { dossierBase } from "../store.js";
import * as sync from "./sync.js";
import { lireDigest, dernierDigest } from "./nuit.js";

const ID_CONV = /^[A-Za-z0-9_.:-]{1,200}$/;
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const params = (req) => new URL(req.url, "http://local").searchParams;

function repondreErreur(res, source, err, statut = 500) {
  const e = sync.erreurDe(source, err);
  if (statut >= 500) console.warn(`Conversations externes : ${e.code} (${err?.code || err?.name})`);
  return sendJSON(res, statut, { error: e.code, message: e.message, quoiFaire: e.quoiFaire });
}

// GET /api/conversations-externes
export async function etat(req, res) {
  if (!requireAuth(req, res)) return;
  return sendJSON(res, 200, sync.etat());
}

// POST /api/conversations-externes/synchroniser { source? }
export async function synchroniser(req, res) {
  if (!requireAuth(req, res)) return;
  const body = await readJSON(req).catch(() => ({}));
  const source = body?.source ?? null;
  if (source !== null && !sync.estSource(source)) return sendJSON(res, 400, { error: "source-inconnue", message: "Source inconnue." });
  if (source && !sync.sourceActive(source)) {
    return sendJSON(res, 409, { error: "source-coupee", message: `La lecture de ${sync.SOURCES[source].nom} est coupée : allume-la d'abord.`, quoiFaire: "Réglages › Sources des conversations." });
  }
  try {
    const bilan = await sync.synchroniser({ sources: source ? [source] : null });
    if (bilan.ok === false && bilan.raison === "source-coupee") {
      return sendJSON(res, 409, { error: "source-coupee", message: "Toutes les sources sont coupées : allume-en une d'abord.", quoiFaire: "Réglages › Sources des conversations." });
    }
    return sendJSON(res, 200, { bilan, etat: sync.etat() });
  } catch (err) {
    return repondreErreur(res, source, err, err?.code === "CLE_DIFFERENTE" ? 409 : 500);
  }
}

// PUT /api/conversations-externes/sources/:id { actif }
// ChatGPT a deux réglages de plus : { telechargements } (surveiller
// Téléchargements) et { rappel } (la carte « Exporter ChatGPT »).
const REGLAGES_CHATGPT = ["telechargements", "rappel"];
export async function reglerSource(req, res, id) {
  if (!requireAuth(req, res)) return;
  if (!sync.estSource(id)) return sendJSON(res, 404, { error: "source-inconnue", message: "Source inconnue." });
  const body = await readJSON(req).catch(() => null);
  const options = id === sync.SOURCE_CHATGPT ? REGLAGES_CHATGPT.filter((k) => typeof body?.[k] === "boolean") : [];
  if (typeof body?.actif !== "boolean" && !options.length) {
    return sendJSON(res, 400, { error: "attendu", message: id === sync.SOURCE_CHATGPT ? 'Attendu : { "actif" | "telechargements" | "rappel": true | false }' : 'Attendu : { "actif": true | false }' });
  }
  if (typeof body.actif === "boolean") {
    sync.reglerSource(id, body.actif);
    console.warn(`Conversations externes : ${sync.SOURCES[id].nom} ${body.actif ? "allumée" : "COUPÉE"}`);
  }
  if (options.length) {
    sync.reglerChatGPT(Object.fromEntries(options.map((k) => [k, body[k]])));
    for (const k of options) console.warn(`Conversations externes : ChatGPT, ${k === "telechargements" ? "Téléchargements surveillé" : "rappel d'export"} ${body[k] ? "allumé" : "coupé"}`);
  }
  return sendJSON(res, 200, sync.etat());
}

// DELETE /api/conversations-externes/sources/:id : oublier tout ce qui en vient.
export async function purger(req, res, id) {
  if (!requireAuth(req, res)) return;
  if (!sync.estSource(id)) return sendJSON(res, 404, { error: "source-inconnue", message: "Source inconnue." });
  const e = await sync.purger(id);
  console.warn(`Conversations externes : ${sync.SOURCES[id].nom} OUBLIÉE (purge)`);
  const message =
    id === "chatgpt"
      ? "Effacé de la tour. Ton compte ChatGPT n'est pas touché ; l'import est coupé jusqu'au prochain envoi."
      : `Effacé de la tour, et la lecture coupée. Tes conversations dans ${sync.SOURCES[id].nom}, elles, ne sont pas touchées.`;
  return sendJSON(res, 200, { ok: true, message, etat: e });
}

// DELETE /api/conversations-externes/tout : tout effacer (clé changée…).
export async function toutEffacer(req, res) {
  if (!requireAuth(req, res)) return;
  const e = await sync.toutEffacer();
  console.warn("Conversations externes : base vidée (tout effacer)");
  return sendJSON(res, 200, { ok: true, message: "Tout est effacé de la tour. « Lire maintenant » relit tes sources.", etat: e });
}

// PUT /api/conversations-externes/usage { chat?, nuit? }
export async function reglerUsage(req, res) {
  if (!requireAuth(req, res)) return;
  const body = await readJSON(req).catch(() => null);
  if (!body || (typeof body.chat !== "boolean" && typeof body.nuit !== "boolean")) {
    return sendJSON(res, 400, { error: "attendu", message: 'Attendu : { "chat": true | false, "nuit": true | false }' });
  }
  sync.reglerUsage(body);
  return sendJSON(res, 200, sync.etat());
}

// GET /api/conversations-externes/liste?source=&jour=&projet=&decalage=&limite=
export async function liste(req, res) {
  if (!requireAuth(req, res)) return;
  const p = params(req);
  const source = p.get("source");
  const jour = p.get("jour");
  const projet = p.get("projet");
  if (source && !sync.estSource(source)) return sendJSON(res, 400, { error: "source-inconnue", message: "Source inconnue." });
  if (jour && !JOUR.test(jour)) return sendJSON(res, 400, { error: "jour", message: "Jour attendu : AAAA-MM-JJ." });
  return sendJSON(res, 200, sync.liste({ source, jour, projet: /^p-[0-9a-f]{10}$/.test(projet || "") ? projet : null, decalage: p.get("decalage"), limite: p.get("limite") }));
}

// GET /api/conversations-externes/jours?source=&nombre=
export async function jours(req, res) {
  if (!requireAuth(req, res)) return;
  const p = params(req);
  const source = p.get("source");
  if (source && !sync.estSource(source)) return sendJSON(res, 400, { error: "source-inconnue", message: "Source inconnue." });
  return sendJSON(res, 200, sync.jours({ source, nombre: p.get("nombre") }));
}

// GET /api/conversations-externes/conversations/:source/:id?apres=&limite=
export async function lire(req, res, source, id) {
  if (!requireAuth(req, res)) return;
  let ident = id;
  try {
    ident = decodeURIComponent(id);
  } catch {}
  if (!sync.estSource(source) || !ID_CONV.test(ident)) return sendJSON(res, 404, { error: "introuvable", message: "Conversation introuvable." });
  const p = params(req);
  const r = sync.lire(source, ident, { apres: p.get("apres"), limite: p.get("limite"), autour: p.get("autour") });
  if (!r) return sendJSON(res, 404, { error: "introuvable", message: "Conversation introuvable (effacée, ou source coupée puis effacée)." });
  return sendJSON(res, 200, r);
}

// GET /api/conversations-externes/chercher?q=&source=&limite=
export async function chercher(req, res) {
  if (!requireAuth(req, res)) return;
  const p = params(req);
  const q = String(p.get("q") || "").slice(0, 200);
  const source = p.get("source");
  if (source && !sync.estSource(source)) return sendJSON(res, 400, { error: "source-inconnue", message: "Source inconnue." });
  if (!q.trim()) return sendJSON(res, 400, { error: "q", message: "Il faut des mots à chercher." });
  const resultats = sync.chercher(q, { source, limite: p.get("limite") }).map(({ texte, poids, couverture, ...r }) => r);
  return sendJSON(res, 200, { resultats });
}

// GET /api/conversations-externes/nuit?jour= : ce que la nuit a tiré des
// conversations de ce jour (le dernier, sans jour).
export async function nuit(req, res) {
  if (!requireAuth(req, res)) return;
  const jour = params(req).get("jour");
  if (jour && !JOUR.test(jour)) return sendJSON(res, 400, { error: "jour", message: "Jour attendu : AAAA-MM-JJ." });
  return sendJSON(res, 200, { digest: jour ? lireDigest(jour) : dernierDigest(), usage: sync.usage() });
}

// --- Envoi d'un export ChatGPT ---------------------------------------------------------------

const MAX_OCTETS = () => {
  const mo = Number(process.env.REMY_IMPORT_MAX_MO);
  return Math.round((mo > 0 ? mo : 2048) * 1024 * 1024);
};
const dossierEnvois = () => path.join(dossierBase(), "imports-en-cours");
const TROP_GROS_QUOI_FAIRE =
  "Dans Fichiers, touche le .zip pour le décompresser et envoie seulement conversations.json (les images et l'audio restent sur l'iPhone) ; ou dépose le .zip dans le dossier Imports de ton coffre, ou monte REMY_IMPORT_MAX_MO dans remy.env.";

// Un gros export en 4G peut mettre plus de 5 min : le délai de Node pour
// recevoir une requête entière (requestTimeout, 300 s) est allongé le temps
// des envois AUTHENTIFIÉS en cours, puis rendu (contre-relecture du 29/10).
// Un envoi qui ne reçoit plus rien pendant 2 min est coupé.
const DELAI_ENVOI_MS = 3 * 3600_000;
const INACTIF_MS = 120_000;
let envoisEnCours = 0;
let delaiAvant = null;
export function allongerDelai(req) {
  const srv = req.socket?.server;
  if (!srv || typeof srv.requestTimeout !== "number") return () => {};
  if (envoisEnCours++ === 0) {
    delaiAvant = srv.requestTimeout;
    if (srv.requestTimeout > 0 && srv.requestTimeout < DELAI_ENVOI_MS) srv.requestTimeout = DELAI_ENVOI_MS;
  }
  let rendu = false;
  return () => {
    if (rendu) return;
    rendu = true;
    if (--envoisEnCours === 0 && delaiAvant !== null) {
      srv.requestTimeout = delaiAvant;
      delaiAvant = null;
    }
  };
}

// Les restes d'un envoi interrompu (tour coupée en plein import).
function nettoyerEnvois() {
  try {
    for (const n of fs.readdirSync(dossierEnvois())) {
      const f = path.join(dossierEnvois(), n);
      if (Date.now() - fs.statSync(f).mtimeMs > 3600_000) fs.rmSync(f, { force: true });
    }
  } catch {}
}

// POST /api/conversations-externes/chatgpt : le corps est le fichier (.zip de
// l'export, ou conversations.json), en flux. Il est écrit à part le temps de
// l'import (le .zip se lit par la fin), puis effacé.
export async function importerChatGPT(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.body !== undefined && req.body !== null) {
    return sendJSON(res, 501, { error: "non-pris-en-charge", message: "L'import se fait sur la tour, pas ici." });
  }
  if (process.env[sync.SOURCES.chatgpt.env] === "off") {
    req.resume();
    return sendJSON(res, 409, { error: "source-coupee", message: "L'import ChatGPT est coupé sur la tour (REMY_SOURCE_CHATGPT=off).", quoiFaire: "Retire cette ligne de remy.env, puis relance l'installeur." });
  }
  const max = MAX_OCTETS();
  const annonce = Number(req.headers["content-length"]);
  if (Number.isFinite(annonce) && annonce > max) {
    req.resume();
    return sendJSON(res, 413, { error: "trop-gros", message: `Fichier trop gros pour la tour (${Math.round(max / 1024 / 1024)} Mo au plus).`, quoiFaire: TROP_GROS_QUOI_FAIRE });
  }
  nettoyerEnvois();
  fs.mkdirSync(dossierEnvois(), { recursive: true });
  // « .tmp » : jamais emporté par une sauvegarde (lib/sauvegarde.js).
  const tmp = path.join(dossierEnvois(), `${crypto.randomUUID()}.tmp`);
  let recus = 0;
  const rendreDelai = allongerDelai(req);
  const surInactif = () => req.destroy(Object.assign(new Error("envoi inactif"), { code: "INACTIF" }));
  try {
    try {
      req.socket?.setTimeout?.(INACTIF_MS);
      req.socket?.on?.("timeout", surInactif);
      await pipeline(
        req,
        new Transform({
          transform(c, _e, fait) {
            recus += c.length;
            if (recus > max) return fait(Object.assign(new Error("trop gros"), { code: "TROP_GROS" }));
            fait(null, c);
          },
        }),
        fs.createWriteStream(tmp, { mode: 0o600 }),
      );
    } catch (err) {
      if (err.code === "TROP_GROS") return sendJSON(res, 413, { error: "trop-gros", message: `Fichier trop gros pour la tour (${Math.round(max / 1024 / 1024)} Mo au plus).`, quoiFaire: TROP_GROS_QUOI_FAIRE });
      return sendJSON(res, 400, { error: "envoi-interrompu", message: "L'envoi s'est interrompu avant la fin.", quoiFaire: "Réessaie, de préférence en Wi-Fi ; ou envoie seulement conversations.json (plus léger)." });
    } finally {
      rendreDelai();
      req.socket?.off?.("timeout", surInactif);
      req.socket?.setTimeout?.(0);
    }
    if (!recus) return sendJSON(res, 400, { error: "vide", message: "Fichier vide.", quoiFaire: "Choisis le .zip reçu par mail de ChatGPT." });
    try {
      const bilan = await sync.importerChatGPT(tmp, { octets: recus });
      console.warn(`Conversations externes : export ChatGPT importé (${bilan.deja ? "déjà vu" : `${bilan.nouvelles} nouvelle(s), ${bilan.misesAJour} mise(s) à jour`})`);
      return sendJSON(res, 200, { bilan, etat: sync.etat() });
    } catch (err) {
      const statut = ["ZIP_INVALIDE", "JSON_INVALIDE", "SANS_CONVERSATIONS"].includes(err?.code) ? 422 : err?.code === "CLE_DIFFERENTE" ? 409 : 500;
      return repondreErreur(res, "chatgpt", err, statut);
    }
  } finally {
    fs.rm(tmp, { force: true }, () => {});
  }
}

// POST /api/conversations-externes/chatgpt/telechargements { id, importer }
// La réponse à la carte « Un export ChatGPT trouvé dans Téléchargements » :
// rien de Téléchargements n'entre dans la mémoire sans ce geste.
export async function repondreTelechargement(req, res) {
  if (!requireAuth(req, res)) return;
  const body = await readJSON(req).catch(() => null);
  const id = typeof body?.id === "string" && /^f-[a-f0-9]{24}$/.test(body.id) ? body.id : null;
  if (!id || typeof body?.importer !== "boolean") return sendJSON(res, 400, { error: "attendu", message: 'Attendu : { "id": "f-…", "importer": true | false }' });
  try {
    const r = await sync.repondreTelechargement(id, body.importer);
    if (r.introuvable) {
      return sendJSON(res, 404, { error: "introuvable", message: "Ce fichier n'est plus dans Téléchargements (déplacé, effacé ou modifié depuis).", quoiFaire: "« Lire maintenant » pour revoir ce qui s'y trouve." });
    }
    if (r.dejaImporte) {
      return sendJSON(res, 409, { error: "deja-importe", message: "Déjà importé : cet export est entré dans ta mémoire juste avant.", quoiFaire: "Pour le retirer : Sources › ChatGPT › « Effacer ce que Rémy en a gardé ».", etat: sync.etat() });
    }
    if (r.ecarte) return sendJSON(res, 200, { ok: true, message: "Pas importé : Rémy ne le proposera plus (sauf s'il change).", etat: sync.etat() });
    console.warn(`Conversations externes : export de Téléchargements importé sur geste (${r.bilan.deja ? "déjà vu" : `${r.bilan.nouvelles} nouvelle(s), ${r.bilan.misesAJour} mise(s) à jour`})`);
    return sendJSON(res, 200, { ok: true, bilan: r.bilan, etat: sync.etat() });
  } catch (err) {
    const statut = err?.code === "CLE_DIFFERENTE" ? 409 : ["ZIP_INVALIDE", "JSON_INVALIDE", "SANS_CONVERSATIONS", "PAS_CHATGPT"].includes(err?.code) ? 422 : 500;
    return repondreErreur(res, "chatgpt", Object.assign(err, { telechargements: true }), statut);
  }
}

// --- Anciennes routes du lot B (/api/connaissances) --------------------------------------------

export async function ancienReglage(req, res) {
  if (!requireAuth(req, res)) return;
  const body = await readJSON(req).catch(() => null);
  const v = body?.[sync.SOURCE_CLAUDE];
  if (typeof v !== "boolean") return sendJSON(res, 400, { error: `Attendu : { "${sync.SOURCE_CLAUDE}": true | false }` });
  sync.reglerSource(sync.SOURCE_CLAUDE, v);
  return sendJSON(res, 200, sync.etat());
}
