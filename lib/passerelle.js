// La passerelle du modèle local pour les outils de code (12/11) : une porte
// « compatible OpenAI » sur la tour (/v1/models, /v1/chat/completions, avec ou
// sans flux), pour que les agents de code de Sam (T3 Code et ce qu'il pilote :
// OpenCode, Codex, Pi…) parlent au MÊME modèle local que Rémy, en passant par
// le MÊME arbitre (lib/priorite.js, lib/jobs.js : « le travail de fond cède la
// place »). Avant, ils parlaient directement aux Sparks : Rémy ne les voyait
// pas, une question à Rémy pouvait attendre derrière un agent, et rien ne
// mettait les agents en pause.
//
// Deux clés, créées et révoquées dans Réglages › Outils de code (montrées une
// fois, gardées hachées) :
//   - « au clavier » : Sam attend la réponse dans son outil. Une DEMANDE
//     (jobs.inference hors fond, nature « clavier ») : elle fait céder le fond
//     de Rémy et les agents de fond, comme une question posée à Rémy ;
//   - « agents de fond » : un agent qui tourne seul. Du FOND (jobs.enFond
//     « agent-fond ») : pendant une demande et son répit, ses nouveaux appels
//     attendent dans la file de la garde de charge, dans l'ordre et sans
//     erreur, puis partent. L'appel déjà parti n'est PAS coupé (un outil de
//     code supporte mal une réponse tronquée) : il finit, aucun autre ne part.
//     L'attente est bornée (Réglages : 2 min par défaut) ; au-delà, ou file
//     pleine, une réponse 503 avec Retry-After : les clients OpenAI (SDK
//     officiels, Vercel AI SDK d'OpenCode, Codex) réessaient d'eux-mêmes un
//     503 (comme 408, 409, 429 et les autres 5xx), et un 503 ne se confond pas
//     avec une limite de débit ou un quota épuisé.
//
// Sécurité (nouvelle porte vers le modèle) :
//   - coupée par défaut, allumée dans Réglages ; servie par server.js sur la
//     même écoute que Rémy (127.0.0.1, publiée au seul tailnet par Tailscale
//     Serve) : rien de plus large ; jamais sur Vercel (pas de /v1 là-bas) ;
//   - tout est refusé sans une clé valide (comparaison à temps constant des
//     empreintes, les deux clés toujours comparées) ;
//   - taille de requête et débit limités par clé ;
//   - liste blanche : des paramètres connus, vérifiés, sont relayés ; ni les
//     en-têtes de l'appelant ni sa clé ne partent vers le modèle (Rémy pose
//     les siens : lib/glm.js, relaisModeleLocal) ; le modèle est celui de Rémy ;
//   - aucune adresse fournie par l'appelant : une image ne passe que jointe
//     (data:), jamais par une URL que le serveur du modèle irait chercher ;
//   - seulement le modèle local configuré, et s'il est « chez toi »
//     (modeleLocalChezToi) ; jamais le secours cloud ;
//   - rien du contenu n'est gardé ni journalisé : le panneau des coûts reçoit
//     l'heure, la clé utilisée (son nom), la durée et les jetons (kind
//     « outil de code »).

import crypto from "node:crypto";
import * as store from "./store.js";
import * as jobs from "./jobs.js";
import * as prio from "./priorite.js";
import { requireAuth } from "./auth.js";
import { sendJSON, readJSON, sameOrigin, securityHeaders } from "./http.js";
import { glmConfigured, modeleLocalChezToi, modeleActif, modelesServis, relaisModeleLocal, detailLisible, libelleModele } from "./glm.js";
import { logCost } from "./chat.js";

// --- Réglages -------------------------------------------------------------------------

export const TYPES = {
  clavier: { nom: "au clavier", prefixe: "remy_clavier_" },
  fond: { nom: "agents de fond", prefixe: "remy_fond_" },
};
export const DEFAUTS = { active: false, attenteMaxS: 120, fileMax: 8, couperSansFlux: false };
export const BORNES = { attenteMaxS: [10, 600], fileMax: [1, 50] };

const nombreEnv = (nom, defaut) => {
  const n = Number(process.env[nom]);
  return Number.isFinite(n) && n > 0 ? n : defaut;
};
// Limites (remy.env peut les changer ; les tests les raccourcissent).
const octetsMax = () => nombreEnv("REMY_PASSERELLE_MAX_OCTETS", 8 * 1024 * 1024); // un long contexte de code, des images jointes
const debitMax = () => nombreEnv("REMY_PASSERELLE_DEBIT_MIN", 120); // appels par minute et par clé
const jetonsMax = () => nombreEnv("REMY_PASSERELLE_MAX_JETONS", 32_768); // max_tokens plafonné
const entetesMs = () => nombreEnv("REMY_PASSERELLE_ENTETES_MS", 280_000); // sous les 300 s d'undici
const silenceMs = () => nombreEnv("REMY_PASSERELLE_SILENCE_MS", 180_000); // un flux muet si longtemps : coupé
const attenteMs = (r) => nombreEnv("REMY_PASSERELLE_ATTENTE_MS", r.attenteMaxS * 1000);

let horloge = () => Date.now();
export const _horloge = (f) => {
  horloge = f || (() => Date.now());
};

const empreinte = (cle) => crypto.createHash("sha256").update(String(cle)).digest("hex");
const ZERO = Buffer.alloc(32);

// L'état gardé : { active, attenteMaxS, fileMax, couperSansFlux, cles: { clavier, fond } }
// (une clé : { hash, apercu, creeA }). Relu au plus toutes les 2 s ; toute
// écriture passe par `modifier` (une à la fois), qui met le cache à jour : une
// clé révoquée est refusée tout de suite.
let cache = { a: 0, etat: null };
let chaine = Promise.resolve();

function normaliser(e) {
  const r = { ...DEFAUTS, ...(e && typeof e === "object" ? e : {}) };
  r.active = r.active === true;
  r.couperSansFlux = r.couperSansFlux === true;
  for (const [k, [min, max]] of Object.entries(BORNES)) if (!Number.isInteger(r[k]) || r[k] < min || r[k] > max) r[k] = DEFAUTS[k];
  r.cles = { clavier: null, fond: null, ...(r.cles || {}) };
  for (const t of Object.keys(TYPES)) if (!/^[0-9a-f]{64}$/.test(r.cles[t]?.hash || "")) r.cles[t] = null;
  return r;
}

async function lireEtat() {
  if (cache.etat && horloge() - cache.a < 2_000) return cache.etat;
  const etat = normaliser(await store.getPasserelle());
  cache = { a: horloge(), etat };
  return etat;
}

function modifier(fn) {
  const p = chaine.then(async () => {
    const etat = normaliser(await store.getPasserelle());
    const suivant = normaliser(fn(etat) || etat);
    await store.putPasserelle(suivant);
    cache = { a: horloge(), etat: suivant };
    return suivant;
  });
  chaine = p.catch(() => {});
  return p;
}

// La clé présentée (Authorization: Bearer …) → « clavier », « fond » ou null.
// Les deux empreintes sont TOUJOURS comparées, à temps constant, même sans
// clé présentée ou sans clé créée : la durée ne dit rien de ce qui a été tapé.
export function typeDeCle(presentee, etat) {
  const h = Buffer.from(empreinte(presentee ?? ""), "hex");
  let trouve = null;
  for (const t of Object.keys(TYPES)) {
    const enreg = etat?.cles?.[t];
    const ref = enreg?.hash ? Buffer.from(enreg.hash, "hex") : ZERO;
    const egal = crypto.timingSafeEqual(h, ref);
    if (egal && enreg?.hash && presentee && !trouve) trouve = t;
  }
  return trouve;
}

function clePresentee(req) {
  const a = req.headers?.authorization;
  if (typeof a !== "string" || a.length > 512) return null;
  const m = a.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : null;
}

// --- Débit par clé ------------------------------------------------------------------------

const passages = { clavier: [], fond: [] }; // horodatages de la dernière minute
function debitDepasse(type) {
  const t = horloge();
  const l = passages[type];
  while (l.length && t - l[0] >= 60_000) l.shift();
  if (l.length >= debitMax()) return Math.max(1, Math.ceil((l[0] + 60_000 - t) / 1000));
  l.push(t);
  return 0;
}

// Le dernier usage d'une clé, noté au plus une fois par minute (et jamais sur
// une clé révoquée ou remplacée entre-temps : relu sous `modifier`).
const derniersUsages = {};
function noterUsage(type, hash) {
  const t = horloge();
  if (derniersUsages[type] && t - derniersUsages[type] < 60_000) return;
  derniersUsages[type] = t;
  modifier((e) => {
    if (e.cles[type]?.hash === hash) e.cles[type] = { ...e.cles[type], dernierUsage: t };
    return e;
  }).catch(() => {});
}

// --- Réponses au format OpenAI ---------------------------------------------------------

function erreurOpenAI(res, status, message, { type = status >= 500 ? "server_error" : "invalid_request_error", code = null, retry = null } = {}) {
  if (res.headersSent) return;
  if (retry) res.setHeader("Retry-After", String(retry));
  sendJSON(res, status, { error: { message, type, code, param: null } });
}

class ErreurRequete extends Error {}
const refus = (m) => {
  throw new ErreurRequete(m);
};

// --- La liste blanche ---------------------------------------------------------------------

const estObjet = (v) => v && typeof v === "object" && !Array.isArray(v);
const nombreEntre = (v, min, max, nom) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : refus(`${nom} : un nombre entre ${min} et ${max}`));
const texte = (v, nom, max = 1_000_000) => (typeof v === "string" && v.length <= max ? v : refus(`${nom} : du texte attendu`));
const NOM_OUTIL = /^[A-Za-z0-9_.:-]{1,128}$/;
const ROLES = { system: "system", developer: "system", user: "user", assistant: "assistant", tool: "tool" };

function partie(p, i) {
  if (!estObjet(p)) refus(`messages[${i}].content : parties attendues`);
  if (p.type === "text") return { type: "text", text: texte(p.text, `messages[${i}].content.text`) };
  if (p.type === "image_url") {
    const url = typeof p.image_url === "string" ? p.image_url : p.image_url?.url;
    // Jamais une adresse que le serveur du modèle irait chercher lui-même.
    if (typeof url !== "string" || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(url)) refus("Image par adresse refusée : la passerelle n'envoie au modèle que des images jointes (data:image/…;base64).");
    const detail = ["auto", "low", "high"].includes(p.image_url?.detail) ? { detail: p.image_url.detail } : {};
    return { type: "image_url", image_url: { url, ...detail } };
  }
  return refus(`messages[${i}].content : partie « ${String(p.type).slice(0, 30)} » non relayée (texte et images jointes seulement)`);
}

function message(m, i) {
  if (!estObjet(m)) refus(`messages[${i}] : un objet attendu`);
  const role = ROLES[m.role];
  if (!role) refus(`messages[${i}].role : system, developer, user, assistant ou tool`);
  const out = { role };
  if (m.content === null || m.content === undefined) {
    if (role !== "assistant") refus(`messages[${i}].content : manquant`);
    out.content = null;
  } else if (typeof m.content === "string") out.content = m.content;
  else if (Array.isArray(m.content) && m.content.length <= 500) out.content = m.content.map((p) => partie(p, i));
  else refus(`messages[${i}].content : texte ou liste de parties`);
  if (m.name !== undefined) out.name = texte(m.name, `messages[${i}].name`, 64);
  if (role === "assistant" && m.tool_calls !== undefined) {
    if (!Array.isArray(m.tool_calls) || m.tool_calls.length > 128) refus(`messages[${i}].tool_calls : une liste`);
    out.tool_calls = m.tool_calls.map((tc) => {
      if (!estObjet(tc) || !estObjet(tc.function) || !NOM_OUTIL.test(String(tc.function.name || ""))) refus(`messages[${i}].tool_calls : appel illisible`);
      return { id: texte(String(tc.id ?? ""), "tool_calls.id", 200), type: "function", function: { name: tc.function.name, arguments: texte(tc.function.arguments ?? "", "tool_calls.arguments") } };
    });
  }
  if (role === "assistant" && typeof m.reasoning_content === "string") out.reasoning_content = m.reasoning_content;
  if (role === "tool") out.tool_call_id = texte(m.tool_call_id ?? "", `messages[${i}].tool_call_id`, 200);
  return out;
}

function outil(t, i) {
  if (!estObjet(t) || t.type !== "function" || !estObjet(t.function) || !NOM_OUTIL.test(String(t.function.name || ""))) refus(`tools[${i}] : { type: "function", function: { name, parameters } } attendu`);
  const f = { name: t.function.name };
  if (t.function.description !== undefined) f.description = texte(t.function.description, `tools[${i}].description`, 20_000);
  if (t.function.parameters !== undefined) f.parameters = estObjet(t.function.parameters) ? t.function.parameters : refus(`tools[${i}].parameters : un schéma JSON`);
  if (typeof t.function.strict === "boolean") f.strict = t.function.strict;
  return { type: "function", function: f };
}

// Le corps reçu → ce qui part vers le modèle (rien d'autre). Un paramètre
// inconnu n'est pas relayé (ignoré : `user`, `metadata`, `store`, `n`,
// `logprobs`… ; ni `chat_template_kwargs` ni les `guided_*` du moteur). Le
// modèle demandé est ignoré : c'est celui de Rémy.
export function filtrerCorps(b) {
  if (!estObjet(b)) refus("Corps JSON attendu");
  if (!Array.isArray(b.messages) || !b.messages.length || b.messages.length > 5_000) refus("messages : une liste non vide (5 000 au plus)");
  const corps = { messages: b.messages.map(message) };
  const stream = b.stream === true;
  if (b.stream !== undefined && typeof b.stream !== "boolean") refus("stream : true ou false");
  const veutUsage = stream && b.stream_options?.include_usage === true;
  if (stream) corps.stream = true, (corps.stream_options = { include_usage: true }); // pour compter les jetons
  const max = b.max_completion_tokens ?? b.max_tokens;
  if (max !== undefined && max !== null) {
    if (!Number.isInteger(max) || max < 1) refus("max_tokens : un entier positif");
    corps.max_tokens = Math.min(max, jetonsMax());
  }
  if (b.temperature != null) corps.temperature = nombreEntre(b.temperature, 0, 2, "temperature");
  if (b.top_p != null) corps.top_p = nombreEntre(b.top_p, 0, 1, "top_p");
  if (b.presence_penalty != null) corps.presence_penalty = nombreEntre(b.presence_penalty, -2, 2, "presence_penalty");
  if (b.frequency_penalty != null) corps.frequency_penalty = nombreEntre(b.frequency_penalty, -2, 2, "frequency_penalty");
  if (b.seed != null) corps.seed = Number.isInteger(b.seed) ? b.seed : refus("seed : un entier");
  if (b.stop != null) {
    const s = typeof b.stop === "string" ? [b.stop] : b.stop;
    if (!Array.isArray(s) || s.length > 4 || !s.every((x) => typeof x === "string" && x.length <= 200)) refus("stop : jusqu'à 4 textes");
    corps.stop = s;
  }
  if (b.tools != null) {
    if (!Array.isArray(b.tools) || b.tools.length > 256) refus("tools : une liste (256 au plus)");
    if (b.tools.length) corps.tools = b.tools.map(outil);
  }
  if (b.tool_choice != null) {
    const c = b.tool_choice;
    if (["auto", "none", "required"].includes(c)) corps.tool_choice = c;
    else if (estObjet(c) && c.type === "function" && NOM_OUTIL.test(String(c.function?.name || ""))) corps.tool_choice = { type: "function", function: { name: c.function.name } };
    else refus("tool_choice : auto, none, required ou { type: \"function\", function: { name } }");
  }
  if (typeof b.parallel_tool_calls === "boolean") corps.parallel_tool_calls = b.parallel_tool_calls;
  if (b.response_format != null) {
    const f = b.response_format;
    if (estObjet(f) && (f.type === "text" || f.type === "json_object")) corps.response_format = { type: f.type };
    else if (estObjet(f) && f.type === "json_schema" && estObjet(f.json_schema) && estObjet(f.json_schema.schema)) {
      corps.response_format = { type: "json_schema", json_schema: { name: texte(String(f.json_schema.name ?? "reponse"), "json_schema.name", 64), schema: f.json_schema.schema, ...(typeof f.json_schema.strict === "boolean" ? { strict: f.json_schema.strict } : {}) } };
    } else refus("response_format : text, json_object ou json_schema");
  }
  if (b.reasoning_effort != null) corps.reasoning_effort = ["minimal", "low", "medium", "high"].includes(b.reasoning_effort) ? b.reasoning_effort : refus("reasoning_effort : minimal, low, medium ou high");
  return { corps, stream, veutUsage };
}

// --- Le relais ----------------------------------------------------------------------------

const usageDe = (u) => ({ input_tokens: u?.prompt_tokens || 0, output_tokens: u?.completion_tokens || 0 });
const secondes = (ms) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

// Les compteurs, jamais le contenu (panneau des coûts, kind « outil de code »).
function journal(type, suivi) {
  const morceaux = [`Clé « ${TYPES[type].nom} »`, secondes(horloge() - suivi.debut)];
  if (suivi.attente >= 100) morceaux.push(`${secondes(suivi.attente)} d'attente`);
  if (suivi.coupe) morceaux.push(`coupé ${suivi.coupe} fois pour une demande, refait`);
  if (suivi.issue) morceaux.push(suivi.issue);
  logCost("outil de code", "glm", suivi.modele ? libelleModele(suivi.modele) : "modèle local", suivi.usage ? usageDe(suivi.usage) : null, null, morceaux.join(" · ")).catch(() => {});
}

// Lire un flux (corps d'erreur, réponse sans flux) sans dépasser `max` octets.
async function lireCorps(r, max) {
  const lecteur = r.body?.getReader();
  if (!lecteur) return "";
  const morceaux = [];
  let n = 0;
  for (;;) {
    const { value, done } = await lecteur.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      lecteur.cancel().catch(() => {});
      throw new Error("réponse du modèle trop grande");
    }
    morceaux.push(value);
  }
  return Buffer.concat(morceaux.map((m) => Buffer.from(m))).toString("utf8");
}

// Un appel au modèle : `signalCede` (fond sans flux, si Réglages le permet)
// le coupe pour une demande — il sera refait en entier par la garde de
// charge : rien n'a encore été envoyé à l'outil.
async function relayer({ type, corps, stream, veutUsage, res, client, signalCede, suivi }) {
  const coupe = new AbortController();
  const signal = AbortSignal.any([client, coupe.signal, ...(signalCede ? [signalCede] : [])]);
  let minuteur = setTimeout(() => coupe.abort(new Error("délai")), entetesMs());
  const cede = () => {
    if (signalCede?.aborted) {
      suivi.coupe = (suivi.coupe || 0) + 1;
      throw signalCede.reason; // la garde de charge le refait
    }
  };
  try {
    let r;
    try {
      const x = await relaisModeleLocal(corps, { signal });
      r = x.reponse;
      suivi.modele = x.modele;
    } catch (err) {
      cede();
      if (client.aborted) return (suivi.issue = "outil parti avant la réponse");
      suivi.issue = coupe.signal.aborted ? "pas de réponse du modèle à temps" : "modèle injoignable";
      return erreurOpenAI(res, coupe.signal.aborted ? 504 : 502, coupe.signal.aborted ? "Le modèle local n'a pas commencé à répondre à temps." : "Le modèle local est injoignable (tour ou machines du modèle éteintes ?).", { code: "modele_injoignable", retry: 30 });
    }
    if (!r.ok) {
      const detail = detailLisible(await lireCorps(r, 64 * 1024).catch(() => "")).slice(0, 300);
      cede();
      suivi.issue = `refusé par le modèle (${r.status})`;
      if (r.status === 429) {
        jobs.signalerSurcharge(60_000, "occupées (429, passerelle)");
        return erreurOpenAI(res, 503, "Le modèle local est déjà au maximum : réessaie dans un moment.", { code: "modele_occupe", retry: 15 });
      }
      // 401/403/404 du serveur du modèle : un souci de la tour (jeton du relais,
      // modèle changé), pas de la clé de l'outil — jamais rendu tel quel.
      if ([400, 413, 422].includes(r.status)) return erreurOpenAI(res, r.status, `Le modèle local refuse la requête${detail ? ` : ${detail}` : "."}`, { code: "refus_du_modele" });
      return erreurOpenAI(res, 502, `Le modèle local a répondu ${r.status}${detail ? ` (${detail})` : ""}.`, { code: "erreur_du_modele", retry: 30 });
    }
    if (!stream) {
      const brut = await lireCorps(r, 64 * 1024 * 1024);
      cede();
      let j;
      try {
        j = JSON.parse(brut);
      } catch {
        suivi.issue = "réponse illisible";
        return erreurOpenAI(res, 502, "Réponse illisible du modèle local.", { code: "reponse_illisible", retry: 10 });
      }
      suivi.usage = j?.usage || null;
      suivi.issue = null;
      if (client.aborted) return (suivi.issue = "outil parti avant la réponse");
      return sendJSON(res, 200, j);
    }
    // En flux : les en-têtes partent, puis chaque événement tel que le modèle
    // l'écrit — sauf le dernier, celui des jetons, si l'outil ne l'a pas demandé.
    clearTimeout(minuteur);
    const armer = () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => coupe.abort(new Error("silence")), silenceMs());
    };
    armer();
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
    const lecteur = r.body.getReader();
    const decodeur = new TextDecoder();
    let tampon = "";
    let fini = false;
    const evenement = (ev) => {
      if (!ev.trim()) return;
      for (const ligne of ev.split(/\r?\n/)) {
        if (!ligne.startsWith("data:")) continue;
        const data = ligne.slice(5).trim();
        if (data === "[DONE]") fini = true;
        else {
          try {
            const j = JSON.parse(data);
            if (j?.usage) suivi.usage = j.usage;
            if (j?.choices?.[0]?.finish_reason) fini = true;
            if (!veutUsage && j?.usage && Array.isArray(j.choices) && !j.choices.length) return;
          } catch {}
        }
      }
      res.write(`${ev}\n\n`);
    };
    try {
      for (;;) {
        const { value, done } = await lecteur.read();
        if (done) break;
        armer();
        tampon += decodeur.decode(value, { stream: true });
        let i;
        while ((i = tampon.search(/\r?\n\r?\n/)) !== -1) {
          const m = tampon.slice(i).match(/^\r?\n\r?\n/)[0];
          evenement(tampon.slice(0, i));
          tampon = tampon.slice(i + m.length);
        }
      }
      evenement(tampon);
      suivi.issue = fini ? null : "flux du modèle coupé en route";
    } catch {
      if (client.aborted) suivi.issue = "outil parti pendant la réponse";
      else {
        suivi.issue = coupe.signal.aborted ? "flux muet trop longtemps" : "flux du modèle coupé en route";
        res.write(`data: ${JSON.stringify({ error: { message: "Le flux du modèle local s'est interrompu.", type: "server_error", code: "flux_coupe" } })}\n\n`);
      }
    }
    if (!res.writableEnded) res.end();
  } finally {
    clearTimeout(minuteur);
  }
}

// --- La porte /v1 ---------------------------------------------------------------------------

export const estCheminPasserelle = (chemin) => chemin === "/v1" || String(chemin || "").startsWith("/v1/");

let enFile = 0; // appels d'agents de fond qui attendent leur tour
let enCours = 0; // appels relayés en ce moment (les deux clés)
export const etatPasserelle = () => ({ enFile, enCours });

export async function traiterV1(req, res) {
  securityHeaders(res);
  let etat;
  try {
    etat = await lireEtat();
  } catch {
    req.resume();
    return erreurOpenAI(res, 503, "Réglages de la passerelle illisibles sur la tour.", { code: "reglages_illisibles" });
  }
  if (!etat.active) {
    req.resume();
    return erreurOpenAI(res, 404, "La passerelle du modèle local est coupée : allume-la dans Rémy, Réglages › Outils de code.", { code: "passerelle_coupee" });
  }
  const presentee = clePresentee(req);
  const type = typeDeCle(presentee, etat);
  if (!type) {
    req.resume();
    return erreurOpenAI(res, 401, "Clé d'accès absente ou invalide : crée-la dans Rémy, Réglages › Outils de code.", { code: "invalid_api_key" });
  }
  noterUsage(type, etat.cles[type].hash);
  const attendre = debitDepasse(type);
  if (attendre) {
    req.resume();
    return erreurOpenAI(res, 429, `Trop d'appels avec la clé « ${TYPES[type].nom} » (${debitMax()} par minute au plus).`, { type: "rate_limit_error", code: "debit_depasse", retry: attendre });
  }

  const chemin = String(req.url || "").split("?")[0].replace(/\/+$/, "");
  const m = String(req.method || "GET").toUpperCase();
  const modeles = chemin === "/v1/models";
  const unModele = chemin.startsWith("/v1/models/");
  const chat = chemin === "/v1/chat/completions";
  if (!modeles && !unModele && !chat) {
    req.resume();
    return erreurOpenAI(res, 404, "Route inconnue de la passerelle : /v1/models et /v1/chat/completions seulement.", { code: "route_inconnue" });
  }
  if ((chat && m !== "POST") || (!chat && m !== "GET")) {
    req.resume();
    res.setHeader("Allow", chat ? "POST" : "GET");
    return erreurOpenAI(res, 405, "Méthode non permise.", { code: "methode" });
  }
  // Le modèle local de Rémy, et lui seul : jamais le secours cloud.
  if (!glmConfigured() || !modeleLocalChezToi()) {
    req.resume();
    return erreurOpenAI(res, 503, glmConfigured() ? "Le modèle de Rémy n'est pas sur une machine de la maison : la passerelle ne relaie que vers le modèle local." : "Aucun modèle local branché sur la tour (REMY_GLM_URL).", { code: "modele_non_branche", retry: 60 });
  }

  if (!chat) {
    const servis = await modelesServis().catch(() => []);
    const actif = await modeleActif();
    const fenetre = servis.find((x) => x.id === actif.id)?.fenetre || null;
    const fiche = { id: actif.id, object: "model", created: 0, owned_by: "remy", ...(fenetre ? { context_length: fenetre, max_model_len: fenetre } : {}) };
    if (unModele) {
      const id = decodeURIComponent(chemin.slice("/v1/models/".length));
      if (id !== actif.id) return erreurOpenAI(res, 404, `Modèle « ${id.slice(0, 80)} » inconnu : la passerelle sert « ${actif.id} », celui de Rémy.`, { code: "model_not_found" });
      return sendJSON(res, 200, fiche);
    }
    return sendJSON(res, 200, { object: "list", data: [fiche] });
  }

  let demande;
  try {
    demande = filtrerCorps(await readJSON(req, octetsMax()));
  } catch (err) {
    if (/trop grand/i.test(err.message)) return erreurOpenAI(res, 413, `Requête trop grande (${Math.round(octetsMax() / 1024 / 1024)} Mo au plus).`, { code: "requete_trop_grande" });
    return erreurOpenAI(res, 400, err instanceof ErreurRequete ? err.message : "Corps JSON illisible.", { code: "requete_invalide" });
  }

  const client = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) client.abort(new Error("outil parti"));
  });
  const suivi = { debut: horloge(), attente: 0, usage: null, modele: null, issue: null };
  const appel = (signalCede) => relayer({ type, ...demande, res, client: client.signal, signalCede, suivi });
  enCours++;
  try {
    if (type === "clavier") {
      // Une demande : elle passe tout de suite et fait céder le fond.
      await jobs.inference(() => appel(null), { nature: "clavier", latence: false });
      return;
    }
    if (enFile >= etat.fileMax) {
      suivi.issue = "file pleine";
      return erreurOpenAI(res, 503, `${enFile} appels d'agents attendent déjà : réessaie dans un moment.`, { code: "file_pleine", retry: retryApres() });
    }
    enFile++;
    let parti = false;
    const partir = () => {
      if (parti) return;
      parti = true;
      enFile--;
      suivi.attente = horloge() - suivi.debut;
    };
    const abandon = AbortSignal.any([client.signal, AbortSignal.timeout(attenteMs(etat))]);
    try {
      await jobs.enFond("agent-fond", () =>
        jobs.inference((signalCede) => (partir(), appel(signalCede)), { interruptible: etat.couperSansFlux && !demande.stream, abandon, latence: false }),
      );
    } catch (err) {
      // Parti puis échoué : l'erreur suit son cours. Sinon (ou en attendant de
      // refaire un appel coupé) : l'outil est parti, ou l'attente a dépassé le délai.
      const renonce = !parti || (abandon.aborted && err === abandon.reason);
      if (!renonce) throw err;
      if (!parti) (parti = true), enFile--;
      if (client.signal.aborted) return void (suivi.issue = "outil parti dans la file");
      const pourquoi = prio.fondDoitCeder()?.raison;
      suivi.issue = "pas parti (attente dépassée)";
      return erreurOpenAI(res, 503, `Rémy fait passer une demande avant les agents de fond${pourquoi ? ` (${pourquoi})` : ""} : l'appel a attendu ${Math.round(attenteMs(etat) / 1000)} s. Réessaie dans un moment.`, { code: "remy_occupe", retry: retryApres() });
    }
  } catch (err) {
    suivi.issue ||= "erreur de la passerelle";
    console.error("Passerelle : appel échoué —", err?.name || "erreur", String(err?.message || "").slice(0, 120));
    if (!res.headersSent) erreurOpenAI(res, 502, "La passerelle n'a pas pu relayer l'appel.", { code: "erreur_passerelle", retry: 10 });
    else if (!res.writableEnded) res.end();
  } finally {
    enCours--;
    journal(type, suivi);
  }
}

// Dans combien de secondes réessayer : la fin du répit si on la connaît.
function retryApres() {
  const c = prio.fondDoitCeder();
  if (c?.jusqua) return Math.max(1, Math.min(60, Math.ceil((c.jusqua - prio.maintenant()) / 1000)));
  return 10;
}

// --- Réglages › Outils de code (site, session) -----------------------------------------------

function vue(etat) {
  const cle = (c) => (c ? { creeA: c.creeA || null, dernierUsage: c.dernierUsage || null, apercu: c.apercu || null } : null);
  return {
    active: etat.active,
    attenteMaxS: etat.attenteMaxS,
    fileMax: etat.fileMax,
    couperSansFlux: etat.couperSansFlux,
    bornes: BORNES,
    cles: { clavier: cle(etat.cles.clavier), fond: cle(etat.cles.fond) },
    // Ce qu'on met dans l'outil (le site ajoute son adresse : location.origin + /v1).
    portLocal: Number(process.env.PORT) || 3000,
    branche: glmConfigured() && modeleLocalChezToi(),
    limites: { octetsMax: octetsMax(), debitParMinute: debitMax() },
    ...etatPasserelle(),
  };
}

function gardeSite(req, res) {
  if (!requireAuth(req, res)) return false;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" }), false;
  // Depuis le site seulement (avec le mot de passe), pas un appareil connecté par jeton.
  if (req.appareil) return sendJSON(res, 403, { error: "appareil", message: "Depuis le site seulement (avec le mot de passe), pas depuis un appareil connecté par jeton." }), false;
  return true;
}

export async function getPasserelleHandler(req, res) {
  if (!gardeSite(req, res)) return;
  return sendJSON(res, 200, vue(await lireEtat()));
}

export async function putPasserelleHandler(req, res) {
  if (!gardeSite(req, res)) return;
  const b = await readJSON(req).catch(() => null);
  const ok =
    estObjet(b) &&
    Object.keys(b).length > 0 &&
    Object.keys(b).every((k) => ["active", "attenteMaxS", "fileMax", "couperSansFlux"].includes(k)) &&
    [b.active, b.couperSansFlux].every((v) => v === undefined || typeof v === "boolean") &&
    Object.entries(BORNES).every(([k, [min, max]]) => b[k] === undefined || (Number.isInteger(b[k]) && b[k] >= min && b[k] <= max));
  if (!ok) return sendJSON(res, 400, { error: "Attendu : active, couperSansFlux (true | false), attenteMaxS (10 à 600), fileMax (1 à 50)" });
  const etat = await modifier((e) => ({ ...e, ...b }));
  if (typeof b.active === "boolean") console.warn(`Réglage : passerelle des outils de code ${b.active ? "ALLUMÉE" : "coupée"}`);
  return sendJSON(res, 200, vue(etat));
}

export async function creerCleHandler(req, res, type) {
  if (!gardeSite(req, res)) return;
  if (!TYPES[type]) return sendJSON(res, 404, { error: "Clé inconnue : clavier ou fond" });
  const cle = `${TYPES[type].prefixe}${crypto.randomBytes(32).toString("base64url")}`;
  const etat = await modifier((e) => {
    e.cles[type] = { hash: empreinte(cle), apercu: `${TYPES[type].prefixe}…${cle.slice(-4)}`, creeA: horloge() };
    return e;
  });
  delete derniersUsages[type];
  console.warn(`Passerelle : clé « ${TYPES[type].nom} » créée (l'ancienne, s'il y en avait une, ne marche plus)`);
  return sendJSON(res, 200, { cle, avertissement: "Cette clé ne sera plus jamais affichée.", ...vue(etat) });
}

export async function revoquerCleHandler(req, res, type) {
  if (!gardeSite(req, res)) return;
  if (!TYPES[type]) return sendJSON(res, 404, { error: "Clé inconnue : clavier ou fond" });
  const etat = await modifier((e) => {
    e.cles[type] = null;
    return e;
  });
  console.warn(`Passerelle : clé « ${TYPES[type].nom} » révoquée`);
  return sendJSON(res, 200, vue(etat));
}

// Pour les tests.
export function _reinitialiser() {
  cache = { a: 0, etat: null };
  passages.clavier.length = passages.fond.length = 0;
  for (const k of Object.keys(derniersUsages)) delete derniersUsages[k];
  enFile = enCours = 0;
  horloge = () => Date.now();
}
