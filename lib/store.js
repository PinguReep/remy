// Stockage des conversations + compteurs de rate limiting.
//
// Deux backends, choisis automatiquement :
//  - Redis via l'API REST Upstash (l'ancienne production sur Vercel)
//  - Fichiers JSON locaux : la production sur la tour depuis le 08/10/2026.
//    Avec REMY_VAULT, la base vit dans <coffre>/.remy et la mémoire, les
//    conversations, réflexions et captures ont une copie lisible dans le coffre
//    Obsidian (lib/coffre.js) — la mémoire y est la source de vérité.
//
// Chiffrement au repos : si DATA_KEY (64 caractères hexadécimaux = clé AES-256) est
// défini, chaque conversation est chiffrée en AES-256-GCM avant d'être stockée.
// Ainsi, même un accès direct à la base Redis ne révèle rien.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { horodate, creneauDe, derniersJours } from "./activite.js";
import {
  dossierDonnees,
  ecrireAtomique,
  lireMemoire,
  ecrireMemoire,
  copierConversation,
  retirerConversation,
  copierReflexion,
  copierCapture,
  coffre,
} from "./coffre.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.REMY_DATA_DIR || dossierDonnees() || path.join(__dirname, "..", "data");
export const dossierBase = () => DATA_DIR;
const DATA_FILE = path.join(DATA_DIR, "conversations.json");
const HASH_KEY = "remy:conversations";

// Détection de la base Redis (Upstash). L'intégration Vercel crée des variables
// dont le nom dépend du préfixe choisi (KV, STORAGE, ...) : on les cherche toutes.
function detectRedisConfig() {
  const env = process.env;
  const pairs = [
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  ];
  for (const [u, t] of pairs) {
    if (env[u] && env[t]) return { url: env[u], token: env[t], varName: u };
  }
  // N'importe quel préfixe : {PREFIX}_REST_API_URL + {PREFIX}_REST_API_TOKEN
  for (const key of Object.keys(env)) {
    if (key.endsWith("_REST_API_URL")) {
      const tokenKey = key.slice(0, -4) + "_TOKEN";
      if (env[tokenKey]) return { url: env[key], token: env[tokenKey], varName: key };
    }
  }
  // Dernier filet : {PREFIX}_URL en https vers upstash.io + {PREFIX}_TOKEN
  for (const key of Object.keys(env)) {
    if (
      key.endsWith("_URL") &&
      /^https:\/\//.test(env[key] || "") &&
      env[key].includes("upstash.io")
    ) {
      const tokenKey = key.slice(0, -4) + "_TOKEN";
      if (env[tokenKey]) return { url: env[key], token: env[tokenKey], varName: key };
    }
  }
  return null;
}

export const redisConfig = detectRedisConfig();
const useRedis = Boolean(redisConfig);

// --- Chiffrement AES-256-GCM --------------------------------------------------

function dataKey() {
  const hex = process.env.DATA_KEY;
  if (!hex) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("DATA_KEY doit faire 64 caractères hexadécimaux (openssl rand -hex 32)");
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plain) {
  const key = dataKey();
  if (!key) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "enc:v1:" + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(stored) {
  if (!stored.startsWith("enc:v1:")) return stored; // donnée non chiffrée (ancienne ou DATA_KEY absent)
  const key = dataKey();
  if (!key) throw new Error("Donnée chiffrée mais DATA_KEY absent");
  const buf = Buffer.from(stored.slice(7), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// --- Client Redis minimal (API REST Upstash, aucune dépendance) ---------------

async function redis(...cmd) {
  const r = await fetch(redisConfig.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${redisConfig.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(`Redis: ${j.error}`);
  return j.result;
}

// --- Backend fichier (développement local) -------------------------------------

// Distinction importante : un fichier ABSENT est un état normal (premier
// démarrage), un fichier ILLISIBLE est une possible perte de données. Avant,
// on le signalait puis on renvoyait « vide » : l'écriture suivante remplaçait
// alors tout l'historique par une base neuve. Désormais la lecture ÉCHOUE :
// la requête s'arrête avec un message clair, et le fichier n'est pas touché
// tant qu'il n'est pas réparé ou restauré (scripts/restaurer.mjs).
export class BaseIllisible extends Error {
  constructor(fichier, cause) {
    super(`Base illisible : ${path.basename(fichier)} (${cause}). Rien n'a été écrit — restaure une sauvegarde.`);
    this.code = "BASE_ILLISIBLE";
    this.fichier = fichier;
  }
}

const illisibles = new Map(); // chemin → raison
export const fichiersIllisibles = () => [...illisibles.entries()].map(([f, raison]) => ({ fichier: path.basename(f), raison }));

function readJSONFile(file, fallback) {
  let brut;
  try {
    brut = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    illisibles.set(file, err.code || err.message);
    console.error(`Lecture de ${file} échouée :`, err.message);
    throw new BaseIllisible(file, err.code || err.message);
  }
  try {
    const v = JSON.parse(brut);
    illisibles.delete(file);
    return v;
  } catch (err) {
    illisibles.set(file, "JSON invalide");
    console.error(`Lecture de ${file} échouée (fichier corrompu) :`, err.message);
    throw new BaseIllisible(file, "JSON invalide");
  }
}

function fileLoad() {
  return readJSONFile(DATA_FILE, { conversations: [] });
}

function fileSave(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  ecrireAtomique(DATA_FILE, JSON.stringify(store, null, 2));
}

// --- API conversations ----------------------------------------------------------

export async function listConversations() {
  let convs;
  if (useRedis) {
    const vals = (await redis("HVALS", HASH_KEY)) || [];
    convs = vals.map((v) => JSON.parse(decrypt(v)));
  } else {
    convs = fileLoad().conversations;
  }
  // Les conversations épinglées remontent en tête, puis les plus récentes.
  return convs
    .map(({ id, title, updatedAt, pinned, origine, prive, messages, systeme }) => ({
      id, title, updatedAt, pinned: Boolean(pinned), origine: origine || null, prive: privee({ prive, origine }),
      // Un fil tenu par Rémy lui-même (« regles » : ses propositions de règles).
      ...(systeme ? { systeme } : {}),
      // Pour les « non lus » de l'iPhone (18/10) : combien de messages, et qui a
      // parlé en dernier — un compte, pas une heure (pas de décalage d'horloge).
      messages: Array.isArray(messages) ? messages.length : 0,
      dernier: Array.isArray(messages) && messages.length ? messages.at(-1)?.role || null : null,
    }))
    .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || b.updatedAt - a.updatedAt);
}

// Toutes les conversations complètes, en UNE lecture : « À trancher » (24/10)
// les parcourt toutes, et un getConversation par fil relirait tout le fichier.
export async function toutesLesConversations() {
  if (useRedis) {
    const vals = (await redis("HVALS", HASH_KEY)) || [];
    return vals.map((v) => JSON.parse(decrypt(v)));
  }
  return fileLoad().conversations;
}

// Une conversation importée (ChatGPT, Claude…) est privée par nature : elle ne
// doit jamais repartir chez Claude, ni par la réflexion de nuit, ni par le
// secours (19/10 : les imports faits avant ce correctif n'avaient pas le
// drapeau, ils le prennent à la lecture).
const privee = (c) => Boolean(c?.prive) || Boolean(c?.origine);

export async function getConversation(id) {
  let c;
  if (useRedis) {
    const v = await redis("HGET", HASH_KEY, id);
    c = v ? JSON.parse(decrypt(v)) : null;
  } else {
    c = fileLoad().conversations.find((x) => x.id === id) || null;
  }
  if (c && privee(c)) c.prive = true;
  return c;
}

export async function putConversation(conv) {
  if (useRedis) {
    await redis("HSET", HASH_KEY, conv.id, encrypt(JSON.stringify(conv)));
    return;
  }
  const store = fileLoad();
  const i = store.conversations.findIndex((c) => c.id === conv.id);
  if (i === -1) store.conversations.push(conv);
  else store.conversations[i] = conv;
  fileSave(store);
  copierConversation(conv);
}

export async function deleteConversation(id) {
  if (useRedis) {
    return (await redis("HDEL", HASH_KEY, id)) > 0;
  }
  const store = fileLoad();
  const before = store.conversations.length;
  store.conversations = store.conversations.filter((c) => c.id !== id);
  fileSave(store);
  retirerConversation(id);
  return store.conversations.length < before;
}

// --- Mémoire de Rémy (le « modèle de Sam ») -----------------------------------

const MEMORY_KEY = "remy:memory";
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");
export const MEMORY_MAX_CHARS = 25_000;

export async function getMemory() {
  if (useRedis) {
    const v = await redis("GET", MEMORY_KEY);
    return v ? JSON.parse(decrypt(v)) : { text: "", updatedAt: null };
  }
  // Le coffre fait foi : Sam a pu corriger la mémoire dans Obsidian.
  return lireMemoire() || readJSONFile(MEMORY_FILE, { text: "", updatedAt: null });
}

// Une mémoire trop longue est REFUSÉE, pas coupée : la tronquer effaçait sa fin
// sans un mot. L'ancienne version reste en place.
export class MemoireTropLongue extends Error {
  constructor(longueur) {
    super(`Mémoire trop longue (${longueur} caractères, maximum ${MEMORY_MAX_CHARS}) : l'ancienne version est gardée.`);
    this.code = "MEMOIRE_TROP_LONGUE";
    this.longueur = longueur;
  }
}

export async function putMemory(text) {
  const texte = String(text);
  if (texte.length > MEMORY_MAX_CHARS) throw new MemoireTropLongue(texte.length);
  const mem = { text: texte, updatedAt: Date.now() };
  if (useRedis) {
    await redis("SET", MEMORY_KEY, encrypt(JSON.stringify(mem)));
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireAtomique(MEMORY_FILE, JSON.stringify(mem, null, 2));
    ecrireMemoire(mem.text);
  }
  return mem;
}

// --- Briefing du matin (produit par la réflexion nocturne) ------------------------

const BRIEFING_KEY = "remy:briefing";
const BRIEFING_FILE = path.join(DATA_DIR, "briefing.json");
const BRIEFINGS_KEY = "remy:briefings"; // historique des réflexions non vides
const BRIEFINGS_FILE = path.join(DATA_DIR, "briefings.json");
const BRIEFINGS_MAX = 30;

export async function getBriefing() {
  if (useRedis) {
    const v = await redis("GET", BRIEFING_KEY);
    return v ? JSON.parse(decrypt(v)) : { text: "", generatedAt: null };
  }
  return readJSONFile(BRIEFING_FILE, { text: "", generatedAt: null });
}

export async function putBriefing(text) {
  const b = { text: String(text).slice(0, 8000), generatedAt: Date.now() };
  if (useRedis) {
    await redis("SET", BRIEFING_KEY, encrypt(JSON.stringify(b)));
    if (b.text) {
      await redis("LPUSH", BRIEFINGS_KEY, encrypt(JSON.stringify(b)));
      await redis("LTRIM", BRIEFINGS_KEY, "0", String(BRIEFINGS_MAX - 1));
    }
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireAtomique(BRIEFING_FILE, JSON.stringify(b, null, 2));
    if (b.text) {
      const list = readJSONFile(BRIEFINGS_FILE, []);
      list.unshift(b);
      ecrireAtomique(BRIEFINGS_FILE, JSON.stringify(list.slice(0, BRIEFINGS_MAX), null, 2));
      copierReflexion(b);
    }
  }
  return b;
}

// État des sujets du briefing : ouvert / traité / écarté. Séparé du briefing
// lui-même, qui est réécrit chaque nuit — un état survit à la nuit suivante.
const BR_ETATS_KEY = "remy:briefing:etats";
const BR_ETATS_FILE = path.join(DATA_DIR, "briefing-etats.json");

export async function getBriefingEtats() {
  if (useRedis) {
    const v = await redis("GET", BR_ETATS_KEY);
    return v ? JSON.parse(decrypt(v)) : {};
  }
  return readJSONFile(BR_ETATS_FILE, {});
}

export async function putBriefingEtats(etats) {
  if (useRedis) await redis("SET", BR_ETATS_KEY, encrypt(JSON.stringify(etats)));
  else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireAtomique(BR_ETATS_FILE, JSON.stringify(etats, null, 2));
  }
  return etats;
}

// Relecture avant écriture : Rémy peut barrer un sujet pendant que Sam en
// coche un autre à l'écran.
export async function setBriefingEtat(id, etat) {
  const etats = await getBriefingEtats();
  if (etat === "ouvert") delete etats[id];
  else etats[id] = { etat, at: Date.now() };
  return putBriefingEtats(etats);
}

export async function listBriefings() {
  if (useRedis) {
    const raw = (await redis("LRANGE", BRIEFINGS_KEY, "0", String(BRIEFINGS_MAX - 1))) || [];
    return raw.map((r) => JSON.parse(decrypt(r)));
  }
  return readJSONFile(BRIEFINGS_FILE, []);
}

// --- Journal des actions (Action Ledger v0) --------------------------------------
// Toute écriture sortante (Motion pour l'instant) est journalisée : quoi, quand,
// et de quoi l'annuler. C'est la mémoire des actes de Rémy — pas ses paroles.

const LEDGER_KEY = "remy:ledger";
const LEDGER_FILE = path.join(DATA_DIR, "ledger.json");
const LEDGER_MAX = 200;

export async function addLedgerEntry(entry) {
  const e = { id: crypto.randomUUID(), ts: Date.now(), annule: false, ...entry };
  if (useRedis) {
    await redis("LPUSH", LEDGER_KEY, encrypt(JSON.stringify(e)));
    await redis("LTRIM", LEDGER_KEY, "0", String(LEDGER_MAX - 1));
  } else {
    const list = readJSONFile(LEDGER_FILE, []);
    list.unshift(e);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireAtomique(LEDGER_FILE, JSON.stringify(list.slice(0, LEDGER_MAX), null, 2));
  }
  return e;
}

export async function listLedger() {
  if (useRedis) {
    const raw = (await redis("LRANGE", LEDGER_KEY, "0", String(LEDGER_MAX - 1))) || [];
    return raw.map((r) => JSON.parse(decrypt(r)));
  }
  return readJSONFile(LEDGER_FILE, []);
}

// Marque une entrée comme annulée (Redis : réécriture de la liste entière —
// elle est courte, c'est acceptable et ça garde l'ordre).
export async function markLedgerUndone(id) {
  const list = await listLedger();
  const i = list.findIndex((e) => e.id === id);
  if (i === -1) return null;
  list[i] = { ...list[i], annule: true, annuleAt: Date.now() };
  if (useRedis) {
    await redis("DEL", LEDGER_KEY);
    for (const e of [...list].reverse()) await redis("LPUSH", LEDGER_KEY, encrypt(JSON.stringify(e)));
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireAtomique(LEDGER_FILE, JSON.stringify(list, null, 2));
  }
  return list[i];
}

// --- Focus de la réflexion nocturne (consigne one-shot de Sam) ------------------

const FOCUS_KEY = "remy:reflection:focus";
const FOCUS_FILE = path.join(DATA_DIR, "reflection-focus.json");

export async function getReflectionFocus() {
  if (useRedis) {
    const v = await redis("GET", FOCUS_KEY);
    return v ? JSON.parse(decrypt(v)) : { text: "", setAt: null };
  }
  return readJSONFile(FOCUS_FILE, { text: "", setAt: null });
}

export async function putReflectionFocus(text) {
  const f = { text: String(text || "").trim().slice(0, 1000), setAt: Date.now() };
  if (useRedis) {
    await redis("SET", FOCUS_KEY, encrypt(JSON.stringify(f)));
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireAtomique(FOCUS_FILE, JSON.stringify(f, null, 2));
  }
  return f;
}

// Suggestions de la pré-réflexion (« ce soir, Rémy pourrait creuser… »),
// conservées pour la journée afin de ne pas repayer l'appel à chaque ouverture.
const SUGG_KEY = "remy:reflection:suggest";
const SUGG_FILE = path.join(DATA_DIR, "reflection-suggest.json");

export async function getReflectionSuggestions() {
  if (useRedis) {
    const v = await redis("GET", SUGG_KEY);
    return v ? JSON.parse(decrypt(v)) : { principal: null, options: [], generatedAt: null };
  }
  return readJSONFile(SUGG_FILE, { principal: null, options: [], generatedAt: null });
}

export async function putReflectionSuggestions(data) {
  const s = {
    principal: data?.principal || null,
    options: (data?.options || []).slice(0, 2),
    generatedAt: Date.now(),
  };
  if (useRedis) {
    await redis("SET", SUGG_KEY, encrypt(JSON.stringify(s)));
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireAtomique(SUGG_FILE, JSON.stringify(s, null, 2));
  }
  return s;
}

// --- Configuration guidée (panneau ⚙️ : sessions faites / à faire) ---------------

// --- Jeton Google Calendar -------------------------------------------------------
// Le jeton de rafraîchissement donne accès à l'agenda de Sam : il est chiffré
// au repos comme le reste (DATA_KEY), et n'est JAMAIS renvoyé au navigateur.

const GOOGLE_KEY = "remy:google";
const GOOGLE_FILE = path.join(DATA_DIR, "google.json");

export async function getGoogleToken() {
  if (useRedis) {
    const v = await redis("GET", GOOGLE_KEY);
    return v ? JSON.parse(decrypt(v)) : null;
  }
  return readJSONFile(GOOGLE_FILE, null);
}

export async function putGoogleToken(token) {
  if (!token) return deleteGoogleToken();
  const t = { ...token, updatedAt: Date.now() };
  if (useRedis) {
    await redis("SET", GOOGLE_KEY, encrypt(JSON.stringify(t)));
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireAtomique(GOOGLE_FILE, JSON.stringify(t, null, 2));
  }
  return t;
}

export async function deleteGoogleToken() {
  if (useRedis) await redis("DEL", GOOGLE_KEY);
  else fs.rmSync(GOOGLE_FILE, { force: true });
  return null;
}

// --- Réglages de Sam (Lot 0) ---------------------------------------------------
// Peu de choses, mais qui doivent survivre à un redémarrage et se changer
// depuis l'iPhone : ex. le secours Claude (D21, coupé par défaut).

const REGLAGES_KEY = "remy:reglages";
const REGLAGES_FILE = path.join(DATA_DIR, "reglages.json");
// Par défaut : pas de secours cloud (D21) ; la recherche web existe mais
// DEMANDE à chaque fois ; rien du contexte (conversation, mémoire, planning)
// ne part avec elle (V8, décision de Sam du 14/10).
const REGLAGES_DEFAUT = { secoursCloud: false, rechercheWeb: true, contexteCloud: false };

export async function getReglages() {
  if (useRedis) {
    const v = await redis("GET", REGLAGES_KEY);
    return { ...REGLAGES_DEFAUT, ...(v ? JSON.parse(decrypt(v)) : {}) };
  }
  return { ...REGLAGES_DEFAUT, ...readJSONFile(REGLAGES_FILE, {}) };
}

export async function putReglages(patch) {
  const r = { ...(await getReglages()) };
  if (typeof patch?.secoursCloud === "boolean") r.secoursCloud = patch.secoursCloud;
  if (typeof patch?.rechercheWeb === "boolean") r.rechercheWeb = patch.rechercheWeb;
  if (typeof patch?.contexteCloud === "boolean") r.contexteCloud = patch.contexteCloud;
  // Une proposition plus vieille que ça demande confirmation (1 à 90 jours).
  if (Number.isInteger(patch?.peremptionJours) && patch.peremptionJours >= 1 && patch.peremptionJours <= 90) r.peremptionJours = patch.peremptionJours;
  // Le modèle local choisi dans l'app ; null = celui que les Sparks servent.
  if (patch && "modeleLocal" in patch) {
    if (typeof patch.modeleLocal === "string" && patch.modeleLocal) r.modeleLocal = patch.modeleLocal.slice(0, 200);
    else if (patch.modeleLocal === null) delete r.modeleLocal;
  }
  if (patch?.circuits && typeof patch.circuits === "object") {
    r.circuits = { ...(r.circuits || {}) };
    for (const [k, v] of Object.entries(patch.circuits)) if (typeof v === "boolean") r.circuits[k] = v;
  }
  r.majA = Date.now();
  if (useRedis) await redis("SET", REGLAGES_KEY, encrypt(JSON.stringify(r)));
  else ecrireAtomique(REGLAGES_FILE, JSON.stringify(r, null, 2));
  return r;
}

const SETUP_KEY = "remy:setup";
const SETUP_FILE = path.join(DATA_DIR, "setup.json");

const CLE_SESSION = /^[a-z0-9-]{1,40}$/;
const ETATS = ["en_cours", "faite"];

// Format : { etats: {id: "en_cours"|"faite"}, convs: {id: convId},
//            couverture: {id: [idDeRepère…]}, analyseA: timestamp }
// L'ancien format { done: {id: true} } est migré à la lecture.
export async function getSetup() {
  let s;
  if (useRedis) {
    const v = await redis("GET", SETUP_KEY);
    s = v ? JSON.parse(decrypt(v)) : null;
  } else {
    s = readJSONFile(SETUP_FILE, null);
  }
  if (!s) return { etats: {}, convs: {}, couverture: {} };
  if (!s.etats && s.done) {
    s = { etats: Object.fromEntries(Object.keys(s.done).map((k) => [k, "faite"])), convs: {} };
  }
  return {
    etats: s.etats || {},
    convs: s.convs || {},
    couverture: s.couverture || {},
    analyseA: s.analyseA,
    updatedAt: s.updatedAt,
  };
}

// Écriture partielle : les champs absents sont repris de l'état stocké. La
// couverture est produite par une analyse coûteuse — la perdre parce qu'un
// autre champ a été écrit serait payer deux fois.
async function writeSetup(partiel) {
  const actuel = await getSetup();
  const s = {
    etats: partiel.etats ?? actuel.etats,
    convs: partiel.convs ?? actuel.convs,
    couverture: partiel.couverture ?? actuel.couverture,
    analyseA: partiel.analyseA ?? actuel.analyseA,
    updatedAt: partiel.updatedAt ?? Date.now(),
  };
  if (useRedis) {
    await redis("SET", SETUP_KEY, encrypt(JSON.stringify(s)));
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireAtomique(SETUP_FILE, JSON.stringify(s, null, 2));
  }
  return s;
}

// Résultat de l'analyse des conversations passées : quels repères sont déjà
// couverts, section par section.
// UNION avec l'existant, jamais un remplacement : l'analyse ne voit qu'une
// fenêtre (les 30 derniers messages de chaque conversation, un plafond de
// caractères, et rien des conversations supprimées). La laisser écraser ferait
// reculer la jauge alors que Sam n'a fait qu'ajouter de l'information — le
// contraire de ce qu'un pourcentage de progression promet.
export async function putCouverture(couverture) {
  const actuel = (await getSetup()).couverture || {};
  const fusion = { ...actuel };
  for (const [k, ids] of Object.entries(couverture || {})) {
    fusion[k] = [...new Set([...(actuel[k] || []), ...(Array.isArray(ids) ? ids : [])])];
  }
  const s = await writeSetup({ couverture: fusion, analyseA: Date.now() });
  return s.couverture;
}

// Le seul chemin qui RETIRE de la couverture : « Marquer à refaire », c'est-à-dire
// un geste explicite de Sam qui veut repartir de zéro sur une section.
export async function viderCouverture(session) {
  if (!CLE_SESSION.test(session)) return null;
  const s = await getSetup();
  if (!s.couverture[session]) return s.couverture;
  const couverture = { ...s.couverture };
  delete couverture[session];
  const ecrit = await writeSetup({ couverture });
  return ecrit.couverture;
}

// Couverture gagnée EN DIRECT pendant une session : Rémy signale les repères
// qu'il vient de couvrir. On ajoute, on ne retire jamais — un point acquis dans
// une conversation ne se déprend pas parce qu'une autre n'en parle pas.
export async function ajouterCouverture(session, ids) {
  if (!CLE_SESSION.test(session) || !Array.isArray(ids) || !ids.length) return null;
  const s = await getSetup();
  const avant = new Set(s.couverture[session] || []);
  const propres = ids.filter((r) => typeof r === "string" && CLE_SESSION.test(r)).slice(0, 20);
  for (const r of propres) avant.add(r);
  const couverture = { ...s.couverture, [session]: [...avant] };
  await writeSetup({ couverture });
  return couverture;
}

// Remplacement volontaire (le client envoie l'état complet du panneau, y
// compris les décochages), mais on repart de l'état stocké pour ne pas perdre
// une session que le serveur vient de cocher pendant que le panneau était
// ouvert : une clé absente côté client mais « faite » côté serveur est gardée.
export async function putSetup(setup) {
  const actuel = await getSetup();
  const s = { etats: {}, convs: {}, updatedAt: Date.now() };
  const etats = setup?.etats && typeof setup.etats === "object" ? setup.etats : {};
  for (const [k, v] of Object.entries(etats).slice(0, 50)) {
    if (CLE_SESSION.test(k) && ETATS.includes(v)) s.etats[k] = v;
  }
  // Le client peut décocher (« Marquer à refaire ») et détacher la conversation
  // d'une session : on ne réintroduit que ce qu'il n'a PAS PU voir, c'est-à-dire
  // ce que le serveur a écrit après le chargement du panneau (vuA).
  const plusRecentQueLeClient = (actuel.updatedAt || 0) > (setup?.vuA || 0);
  for (const [k, v] of Object.entries(actuel.etats || {})) {
    if (!(k in etats) && ETATS.includes(v) && plusRecentQueLeClient) s.etats[k] = v;
  }
  const convs = setup?.convs && typeof setup.convs === "object" ? setup.convs : {};
  const fusion = { ...convs };
  for (const [k, v] of Object.entries(actuel.convs || {})) {
    if (!(k in convs) && plusRecentQueLeClient) fusion[k] = v;
  }
  for (const [k, v] of Object.entries(fusion).slice(0, 50)) {
    if (CLE_SESSION.test(k) && typeof v === "string" && v.length <= 60) s.convs[k] = v;
  }
  return writeSetup(s);
}

// Rattache une conversation à sa session, côté serveur, au moment même de la
// création. Le suivi ne dépend plus d'un PUT du client qui peut échouer : sans
// ça, un enregistrement raté rendait la conversation introuvable et le clic
// suivant en créait une deuxième (constaté par Sam le 11 août).
export async function attachSessionConv(session, convId) {
  if (!CLE_SESSION.test(session) || typeof convId !== "string" || convId.length > 60) return null;
  const s = await getSetup();
  s.convs[session] = convId;
  // Une session déjà cochée le reste : si Sam a supprimé sa conversation et
  // en rouvre une, ce n'est pas « je la refais » — faire reculer le pourcentage
  // tout seul serait un mensonge. Seul « Marquer à refaire » décoche.
  if (s.etats[session] !== "faite") s.etats[session] = "en_cours";
  await writeSetup({ etats: s.etats, convs: s.convs, updatedAt: Date.now() });
  return convId;
}

// La conversation d'une session, si elle existe encore (Sam a pu la
// supprimer depuis la liste).
export async function sessionConv(session) {
  if (!CLE_SESSION.test(session)) return null;
  const { convs } = await getSetup();
  const id = convs[session];
  if (!id) return null;
  return (await getConversation(id)) || null;
}

// Marque une session terminée sans écraser le reste (appelé quand Rémy clôt
// lui-même une session guidée).
export async function markSessionDone(id) {
  if (!CLE_SESSION.test(id)) return null;
  const s = await getSetup();
  if (s.etats[id] === "faite") return null; // déjà fait : pas de doublon
  s.etats[id] = "faite";
  await writeSetup({ etats: s.etats, convs: s.convs, updatedAt: Date.now() });
  return id;
}

// --- Historique des coûts --------------------------------------------------------

const COSTS_KEY = "remy:costs";
const COSTS_FILE = path.join(DATA_DIR, "costs.json");
const COSTS_MAX = 2000;

export async function addCostEntry(entry) {
  if (useRedis) {
    // Chiffré aussi : les entrées contiennent un extrait du message utilisateur.
    await redis("LPUSH", COSTS_KEY, encrypt(JSON.stringify(entry)));
    await redis("LTRIM", COSTS_KEY, "0", String(COSTS_MAX - 1));
    return;
  }
  const list = readJSONFile(COSTS_FILE, []);
  list.unshift(entry);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  ecrireAtomique(COSTS_FILE, JSON.stringify(list.slice(0, COSTS_MAX)));
}

export async function listCostEntries() {
  if (useRedis) {
    const raw = (await redis("LRANGE", COSTS_KEY, "0", String(COSTS_MAX - 1))) || [];
    return raw.map((r) => JSON.parse(decrypt(r)));
  }
  return readJSONFile(COSTS_FILE, []);
}

// --- Captures poussées par Sam (extraits d'ailleurs) ---------------------------
// Gardées brutes en plus d'être distillées dans la mémoire : la réflexion
// nocturne relit la matière d'origine, pas seulement le résumé.

const CAPTURES_KEY = "remy:captures";
const CAPTURES_FILE = path.join(DATA_DIR, "captures.json");
const CAPTURES_MAX = 40;
// Ce qu'on garde d'une capture pour la relecture : au-delà, l'historique
// pèserait plus que tout le reste réuni.
const CAPTURE_EXTRAIT = 4000;

export async function addCapture(capture) {
  const c = {
    at: capture.at || Date.now(),
    source: capture.source,
    titre: capture.titre || "",
    extrait: String(capture.texte || "").slice(0, CAPTURE_EXTRAIT),
    complet: (capture.texte || "").length > CAPTURE_EXTRAIT || capture.tronquee,
    ajouts: capture.ajouts || [],
    // Une image partagée : son chemin dans le coffre (Captures/Images/…).
    ...(capture.image ? { image: capture.image } : {}),
    // Texte lu sur une image : la réflexion de la nuit le garde au modèle local.
    ...(capture.prive ? { prive: true } : {}),
  };
  if (useRedis) {
    await redis("LPUSH", CAPTURES_KEY, encrypt(JSON.stringify(c)));
    await redis("LTRIM", CAPTURES_KEY, "0", String(CAPTURES_MAX - 1));
  } else {
    const list = readJSONFile(CAPTURES_FILE, []);
    list.unshift(c);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireAtomique(CAPTURES_FILE, JSON.stringify(list.slice(0, CAPTURES_MAX), null, 2));
    copierCapture(c);
  }
  return c;
}

// L'image d'une capture partagée (24/10) : rangée dans le coffre, à côté des
// notes de capture (Obsidian l'affiche), ou dans le dossier de données sans
// coffre. Rend son chemin relatif, ou null là où il n'y a pas de disque.
export function garderImageCapture(octets, ext, at = Date.now()) {
  if (useRedis) return null;
  const d = new Date(at);
  const jour = d.toLocaleDateString("sv-SE", { timeZone: process.env.REMY_TZ || "Europe/Paris" });
  const heure = d.toLocaleTimeString("fr-FR", { timeZone: process.env.REMY_TZ || "Europe/Paris", hour12: false }).replace(/:/g, "");
  const nom = `${jour} ${heure} ${crypto.randomBytes(3).toString("hex")}.${ext === "png" ? "png" : "jpg"}`;
  const relatif = coffre() ? path.posix.join("Captures", "Images", nom) : path.posix.join("captures-images", nom);
  ecrireAtomique(path.join(coffre() || DATA_DIR, ...relatif.split("/")), octets);
  return relatif;
}

export async function listCaptures(n = CAPTURES_MAX) {
  if (useRedis) {
    const raw = (await redis("LRANGE", CAPTURES_KEY, "0", String(n - 1))) || [];
    return raw.map((r) => JSON.parse(decrypt(r)));
  }
  return readJSONFile(CAPTURES_FILE, []).slice(0, n);
}

// Jeton de capture : la feuille de partage de l'iPhone ne peut pas porter de
// cookie de session. On stocke son EMPPREINTE, jamais le jeton — s'il fuit d'un
// côté, il ne fuit pas de l'autre.
const CAPTOKEN_KEY = "remy:capture:token";
const CAPTOKEN_FILE = path.join(DATA_DIR, "capture-token.json");

function empreinte(jeton) {
  return crypto.createHash("sha256").update(String(jeton)).digest("hex");
}

async function lireJetonCapture() {
  if (useRedis) {
    const v = await redis("GET", CAPTOKEN_KEY);
    return v ? JSON.parse(decrypt(v)) : null;
  }
  return readJSONFile(CAPTOKEN_FILE, null);
}

export async function jetonCaptureExiste() {
  const t = await lireJetonCapture();
  return t ? { creeA: t.creeA, dernierUsage: t.dernierUsage || null } : null;
}

export async function nouveauJetonCapture() {
  const jeton = crypto.randomBytes(24).toString("base64url");
  const enreg = { hash: empreinte(jeton), creeA: Date.now(), dernierUsage: null };
  if (useRedis) await redis("SET", CAPTOKEN_KEY, encrypt(JSON.stringify(enreg)));
  else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireAtomique(CAPTOKEN_FILE, JSON.stringify(enreg, null, 2));
  }
  return jeton; // montré UNE fois, jamais relisible
}

export async function revoquerJetonCapture() {
  if (useRedis) await redis("DEL", CAPTOKEN_KEY);
  else fs.rmSync(CAPTOKEN_FILE, { force: true });
  return true;
}

export async function jetonCaptureValide(jeton) {
  const enreg = await lireJetonCapture();
  if (!enreg?.hash || !jeton) return false;
  const a = Buffer.from(empreinte(jeton), "hex");
  const b = Buffer.from(enreg.hash, "hex");
  // Comparaison à temps constant : une comparaison naïve laisse deviner le
  // jeton caractère par caractère.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  enreg.dernierUsage = Date.now();
  if (useRedis) await redis("SET", CAPTOKEN_KEY, encrypt(JSON.stringify(enreg)));
  else ecrireAtomique(CAPTOKEN_FILE, JSON.stringify(enreg, null, 2));
  return true;
}

// --- Activité de Sam (présence + messages, par jour) ---------------------------
//
// Une clé par jour, pour que la lecture des 14 derniers jours ne relise pas
// l'historique entier, et pour que l'expiration fasse le ménage toute seule.
// Chiffré comme le reste : ce sont ses horaires de vie.

const ACT_PREFIX = "remy:activite:";
const ACT_FILE = path.join(DATA_DIR, "activite.json");
const ACT_TTL_SEC = 120 * 86_400;
const ACT_JOURS_MAX = 120;

function actVide(jour) {
  return { jour, creneaux: [], messages: 0, premier: null, dernier: null };
}

async function actLire(jour) {
  if (useRedis) {
    const v = await redis("GET", ACT_PREFIX + jour);
    return v ? JSON.parse(decrypt(v)) : null;
  }
  return readJSONFile(ACT_FILE, {})[jour] || null;
}

async function actEcrire(jour, rec) {
  if (useRedis) {
    await redis("SET", ACT_PREFIX + jour, encrypt(JSON.stringify(rec)), "EX", String(ACT_TTL_SEC));
    return rec;
  }
  const tout = readJSONFile(ACT_FILE, {});
  tout[jour] = rec;
  // Le fichier local n'a pas d'expiration : on le taille à la main.
  const gardes = Object.keys(tout).sort().slice(-ACT_JOURS_MAX);
  const propre = Object.fromEntries(gardes.map((j) => [j, tout[j]]));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  ecrireAtomique(ACT_FILE, JSON.stringify(propre, null, 2));
  return rec;
}

// Signe de vie du navigateur. N'écrit QUE si le créneau de 5 minutes est
// nouveau : le navigateur peut cogner toutes les minutes, et depuis plusieurs
// appareils, sans que ça coûte une écriture à chaque fois.
export async function pingActivite(ts = Date.now()) {
  const { jour } = horodate(ts);
  const creneau = creneauDe(ts);
  const rec = (await actLire(jour)) || actVide(jour);
  if (rec.creneaux.includes(creneau)) return rec;
  rec.creneaux.push(creneau);
  rec.premier = Math.min(rec.premier || ts, ts);
  rec.dernier = Math.max(rec.dernier || ts, ts);
  return actEcrire(jour, rec);
}

export async function noterMessage(ts = Date.now()) {
  const { jour } = horodate(ts);
  const creneau = creneauDe(ts);
  const rec = (await actLire(jour)) || actVide(jour);
  rec.messages = (rec.messages || 0) + 1;
  // Un message prouve la présence mieux qu'un ping : le créneau est compté même
  // si l'onglet était masqué (dictée, écran verrouillé, appel vocal).
  if (!rec.creneaux.includes(creneau)) rec.creneaux.push(creneau);
  rec.premier = Math.min(rec.premier || ts, ts);
  rec.dernier = Math.max(rec.dernier || ts, ts);
  return actEcrire(jour, rec);
}

export async function listActivite(nbJours = 14, ts = Date.now()) {
  const jours = derniersJours(nbJours, horodate(ts).jour);
  if (!jours.length) return {};
  if (useRedis) {
    const vals = (await redis("MGET", ...jours.map((j) => ACT_PREFIX + j))) || [];
    return Object.fromEntries(
      jours.map((j, i) => [j, vals[i] ? JSON.parse(decrypt(vals[i])) : null]).filter(([, v]) => v),
    );
  }
  const tout = readJSONFile(ACT_FILE, {});
  return Object.fromEntries(jours.filter((j) => tout[j]).map((j) => [j, tout[j]]));
}

// --- Compteurs pour le rate limiting / anti brute force -------------------------

const memCounters = new Map(); // fallback local : { key: { count, resetAt } }

export async function counterIncr(key, windowSec) {
  if (useRedis) {
    const count = await redis("INCR", key);
    if (count === 1) await redis("EXPIRE", key, String(windowSec));
    return count;
  }
  const now = Date.now();
  const entry = memCounters.get(key);
  if (!entry || entry.resetAt < now) {
    memCounters.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

export async function counterGet(key) {
  if (useRedis) {
    const v = await redis("GET", key);
    return v ? parseInt(v, 10) : 0;
  }
  const entry = memCounters.get(key);
  return entry && entry.resetAt > Date.now() ? entry.count : 0;
}

export async function counterReset(key) {
  if (useRedis) return redis("DEL", key);
  memCounters.delete(key);
}

// --- Migration Vercel → tour (08/10/2026) ---------------------------------------
// Tout ce que Rémy sait, en un seul JSON déchiffré : lu depuis Redis (Vercel)
// ou depuis les fichiers, puis réécrit tel quel dans la base locale.

async function brut(cle, fichier, defaut) {
  if (useRedis) {
    const v = await redis("GET", cle);
    return v ? JSON.parse(decrypt(v)) : defaut;
  }
  return readJSONFile(fichier, defaut);
}

async function liste(cle, fichier, max) {
  if (useRedis) {
    const raw = (await redis("LRANGE", cle, "0", String(max - 1))) || [];
    return raw.map((r) => JSON.parse(decrypt(r)));
  }
  return readJSONFile(fichier, []);
}

export async function exporterTout() {
  const conversations = [];
  for (const { id } of await listConversations()) {
    const c = await getConversation(id);
    if (c) conversations.push(c);
  }
  let activite = {};
  if (useRedis) {
    const cles = (await redis("KEYS", ACT_PREFIX + "*")) || [];
    for (const cle of cles) {
      const v = await redis("GET", cle);
      if (v) activite[cle.slice(ACT_PREFIX.length)] = JSON.parse(decrypt(v));
    }
  } else {
    activite = readJSONFile(ACT_FILE, {});
  }
  return {
    format: "remy-export",
    version: 1,
    exporteA: Date.now(),
    conversations,
    // La mémoire qui fait foi : celle du coffre quand il y en a un (Sam a pu
    // la corriger dans Obsidian) — avant, l'export prenait memory.json et
    // perdait ces corrections.
    memoire: useRedis ? await brut(MEMORY_KEY, MEMORY_FILE, { text: "", updatedAt: null }) : await getMemory(),
    briefing: await brut(BRIEFING_KEY, BRIEFING_FILE, { text: "", generatedAt: null }),
    briefings: await liste(BRIEFINGS_KEY, BRIEFINGS_FILE, BRIEFINGS_MAX),
    briefingEtats: await brut(BR_ETATS_KEY, BR_ETATS_FILE, {}),
    journalMotion: await liste(LEDGER_KEY, LEDGER_FILE, LEDGER_MAX),
    focus: await brut(FOCUS_KEY, FOCUS_FILE, null),
    suggestions: await brut(SUGG_KEY, SUGG_FILE, null),
    // Le jeton Google n'a servi qu'à migrer Vercel → la tour : sur la tour, il
    // ne sort plus dans un export (accès à l'agenda), sauf demande explicite.
    google: !process.env.REMY_VAULT || process.env.REMY_EXPORT_GOOGLE === "on" ? await brut(GOOGLE_KEY, GOOGLE_FILE, null) : null,
    setup: await brut(SETUP_KEY, SETUP_FILE, null),
    couts: await liste(COSTS_KEY, COSTS_FILE, COSTS_MAX),
    captures: await liste(CAPTURES_KEY, CAPTURES_FILE, CAPTURES_MAX),
    jetonCapture: await brut(CAPTOKEN_KEY, CAPTOKEN_FILE, null),
    activite,
  };
}

// Écrit un export dans la base locale (jamais dans Redis).
//  - base vide : l'export est recopié tel quel ;
//  - `fusionner` : ce que la tour a déjà vécu est GARDÉ (conversations du jour,
//    activité, coûts) et l'historique Vercel s'y ajoute ; la mémoire de l'export
//    remplace la mémoire locale, mise de côté dans le coffre ;
//  - sinon une base déjà remplie est refusée (`forcer` l'écrase).
export async function importerTout(e, { forcer = false, fusionner = false } = {}) {
  if (useRedis) throw new Error("L'import n'écrit que dans la base locale (pas de Redis configuré ici).");
  if (e?.format !== "remy-export") throw new Error("Ce fichier n'est pas un export de Rémy.");
  const locale = fileLoad().conversations;
  if (!forcer && !fusionner && locale.length) {
    throw new Error("La base locale a déjà des conversations — relance avec --fusionner (garde tout) ou --forcer (écrase).");
  }
  const garder = fusionner && !forcer;
  const ecrire = (fichier, v) => v !== null && v !== undefined && ecrireAtomique(fichier, JSON.stringify(v, null, 2));
  const unir = (fichier, venus, cle, max) => {
    const ici = garder ? readJSONFile(fichier, []) : [];
    const vus = new Set(ici.map((x) => JSON.stringify(x?.[cle])));
    const tout = [...ici, ...(venus || []).filter((x) => !vus.has(JSON.stringify(x?.[cle])))];
    tout.sort((a, b) => (b?.[cle] || 0) - (a?.[cle] || 0));
    ecrire(fichier, max ? tout.slice(0, max) : tout);
  };
  const sinonLocal = (fichier, venu) => {
    if (garder && readJSONFile(fichier, null) !== null) return;
    ecrire(fichier, venu);
  };

  const idsLocaux = new Set(garder ? locale.map((c) => c.id) : []);
  const ajoutees = (e.conversations || []).filter((c) => !idsLocaux.has(c.id));
  fileSave({ conversations: [...(garder ? locale : []), ...ajoutees] });

  if (e.memoire?.text) {
    const avant = lireMemoire() || readJSONFile(MEMORY_FILE, null);
    if (garder && avant?.text?.trim() && avant.text.trim() !== e.memoire.text.trim() && dossierBase()) {
      // La mémoire de la tour n'est pas jetée : Sam peut y reprendre une ligne.
      const coffreRacine = path.dirname(dossierBase());
      ecrireAtomique(path.join(coffreRacine, "Mémoire de Rémy (avant migration).md"), `# Mémoire de la tour avant la migration\n\n${avant.text.trim()}\n`);
    }
    ecrire(MEMORY_FILE, e.memoire);
    ecrireMemoire(e.memoire.text);
  }
  if (garder) {
    const b = readJSONFile(BRIEFING_FILE, null);
    if (!b?.generatedAt || (e.briefing?.generatedAt || 0) > b.generatedAt) ecrire(BRIEFING_FILE, e.briefing);
  } else ecrire(BRIEFING_FILE, e.briefing);
  unir(BRIEFINGS_FILE, e.briefings, "generatedAt", BRIEFINGS_MAX);
  ecrire(BR_ETATS_FILE, { ...(e.briefingEtats || {}), ...(garder ? readJSONFile(BR_ETATS_FILE, {}) : {}) });
  unir(LEDGER_FILE, e.journalMotion, "id", LEDGER_MAX);
  sinonLocal(FOCUS_FILE, e.focus);
  sinonLocal(SUGG_FILE, e.suggestions);
  sinonLocal(GOOGLE_FILE, e.google);
  sinonLocal(SETUP_FILE, e.setup);
  unir(COSTS_FILE, e.couts, "ts", COSTS_MAX);
  unir(CAPTURES_FILE, e.captures, "at", CAPTURES_MAX);
  sinonLocal(CAPTOKEN_FILE, e.jetonCapture);
  ecrire(ACT_FILE, { ...(e.activite || {}), ...(garder ? readJSONFile(ACT_FILE, {}) : {}) });
  for (const c of ajoutees) copierConversation(c);
  for (const b of [...(e.briefings || [])].reverse()) copierReflexion(b);
  for (const c of e.captures || []) copierCapture(c);
  return {
    conversations: ajoutees.length,
    gardees: garder ? locale.length : 0,
    memoire: (e.memoire?.text || "").length,
    reflexions: (e.briefings || []).length,
    captures: (e.captures || []).length,
    jours: Object.keys(e.activite || {}).length,
    google: Boolean(e.google),
  };
}
