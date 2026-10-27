// Connexion Motion (lecture seule, v1) — Constitution, étape 3 : « planning
// quotidien justifié (connexion Motion) ». Si MOTION_API_KEY est défini, Rémy
// reçoit avant chaque réponse un instantané compact : horaires de travail
// (/v1/schedules), projets ouverts (/v1/projects) et tâches (/v1/tasks),
// mis en cache 5 minutes (l'API Motion est limitée à ~12 req/min).
// Écriture (créer/déplacer des tâches) : v2, avec confirmation de Sam.

import { exigerBacASable } from "./bac-a-sable.js";
import * as instantanes from "./instantanes.js";
import { chrono, mesurer } from "./mesures.js";
import { PRENOM } from "./profil.js";

const BASE = process.env.MOTION_BASE_URL || "https://api.usemotion.com/v1";
// Une minute, pas cinq : Sam coche une tâche dans Motion puis ouvre Rémy — il
// doit la voir partie. Le quota (12 req/min) tient : le cache est partagé.
const CACHE_MS = Number(process.env.MOTION_CACHE_MS) || 60 * 1000;
// L'API pagine ses listes (`meta.nextCursor`). Ne lire que la première page
// laissait les tâches récentes hors de Rémy : Sam les créait dans Motion et
// Rémy ne les voyait jamais (constaté le 08/10/2026).
const MAX_PAGES = Number(process.env.MOTION_MAX_PAGES) || 8;
// Retours TestFlight 13 (15/10) : « jusqu'à 15 s », « Motion ne répond pas »
// fréquent. Cause mesurée : NOTRE consommation du quota (12 req/min) — chaque
// geste vidait le cache et relisait toutes les pages. Désormais :
//   - la dernière liste est rendue tout de suite, quel que soit son âge (datée),
//     et relue EN ARRIÈRE-PLAN au-delà d'une minute ;
//   - une écriture met la liste à jour sur place (la réponse de Motion), puis
//     une relecture est prévue ~25 s plus tard (Motion a recalculé le planning) ;
//   - une relecture de fond ne prend jamais les dernières places du quota :
//     elles restent aux gestes de Sam ;
//   - la liste est gardée dans remy.db : après un redémarrage, elle est là.
const RELIRE_APRES_ECRITURE_MS = Number(process.env.MOTION_RELIRE_APRES_MS ?? 25_000);
const RESERVE_GESTES = 4;
// Deux relectures forcées (tirer pour rafraîchir) à moins de 20 s : la seconde lit le cache.
const FRAIS_MIN_MS = Number(process.env.MOTION_FRAIS_MIN_MS ?? 20_000);
const CLE_INSTANTANE = "motion:taches";
// En test, pas de base partagée entre fichiers (sauf demande explicite).
const persister = () => process.env.REMY_ENV !== "test" || process.env.REMY_INSTANTANE === "on";

export function motionEnabled() {
  return Boolean(process.env.MOTION_API_KEY);
}

let cache = { at: 0, text: "" };
// Les tâches brutes, partagées entre l'instantané de Rémy et le tableau de bord :
// ouvrir l'app ne doit pas coûter une requête de plus sur un quota de 12/min.
let tachesCache = { at: 0, liste: null, enVol: null };
let echecA = 0; // dernier échec de lecture : on ne martèle pas un quota épuisé
let fraisA = 0; // dernière relecture forcée par Sam
let derniereErreur = null; // { type, message, a } — dite telle quelle à l'app
let relireA = 0; // une écriture a eu lieu : relire à cette heure-là
let instantaneCharge = false;
let minuteurRelecture = null;
// Génération du cache : une lecture lancée AVANT une écriture ne doit jamais
// réécrire, en finissant, la liste d'avant par-dessus (la tâche créée restait
// invisible une minute, y compris pour l'anti-doublon — audit du 13/10).
let generation = 0;

// Après une écriture dont on ne connaît pas le résultat exact (annulation) :
// la liste reste affichée, une relecture de fond est due tout de suite.
function oublierCaches() {
  generation++;
  cache = { at: 0, text: "" };
  tachesCache.enVol = null;
  relireA = Date.now();
}

function chargerInstantane() {
  if (instantaneCharge || !persister()) return;
  instantaneCharge = true;
  const i = instantanes.lire(CLE_INSTANTANE);
  if (!tachesCache.liste && Array.isArray(i?.valeur?.taches)) {
    const liste = i.valeur.taches;
    if (i.valeur.tronquee) liste.tronquee = true;
    tachesCache = { at: i.luA, liste, enVol: null };
  }
}

function retenir(liste, at, luParNous = tachesCache.luParNous) {
  tachesCache = { at, liste, enVol: null, luParNous };
  if (persister()) instantanes.ecrire(CLE_INSTANTANE, { taches: liste, tronquee: Boolean(liste.tronquee) }, at);
}

const estFinie = (t) => !t || t.completed || t.status?.isResolvedStatus || t.status?.name === "Completed";

/** Une écriture a réussi : la liste en mémoire suit, sans relire Motion. */
function majApresEcriture(changements) {
  generation++; // une lecture lancée avant ne réécrira pas l'ancienne liste
  cache = { at: 0, text: "" };
  tachesCache.enVol = null;
  relireA = Date.now() + RELIRE_APRES_ECRITURE_MS;
  // Relue d'elle-même une fois que Motion a recalculé le planning : la
  // prochaine ouverture de l'app trouve le nouveau créneau.
  clearTimeout(minuteurRelecture);
  minuteurRelecture = setTimeout(() => {
    if (doitRelire()) relireEnFond();
  }, RELIRE_APRES_ECRITURE_MS + 50);
  minuteurRelecture.unref?.();
  if (!tachesCache.liste) return;
  let liste = [...tachesCache.liste];
  for (const c of changements) {
    if (c.retirer) {
      liste = liste.filter((t) => t.id !== c.id);
    } else if (c.tache?.id) {
      const i = liste.findIndex((t) => t.id === c.tache.id);
      // La réponse de Motion fait foi ; un champ absent garde l'ancienne valeur
      // (le créneau, recalculé par Motion après coup).
      const fusion = i >= 0 ? { ...liste[i], ...Object.fromEntries(Object.entries(c.tache).filter(([, v]) => v !== undefined)) } : c.tache;
      if (estFinie(fusion)) liste = liste.filter((t) => t.id !== c.tache.id);
      else if (i >= 0) liste[i] = fusion;
      else liste.push(fusion);
    }
  }
  if (tachesCache.liste.tronquee) liste.tronquee = true;
  retenir(liste, tachesCache.at);
}

// Places libres dans la fenêtre d'une minute du quota.
function quotaLibre() {
  const maintenant = Date.now();
  return QUOTA_MIN() - appels.filter((t) => maintenant - t < 60_000).length;
}

// Ce que l'app dit de la fraîcheur des tâches (« liste d'il y a 4 min : Motion
// limite les requêtes »). Une seule source de vérité, côté tour.
export function etatMotion() {
  if (!motionEnabled()) return { etat: "off" };
  chargerInstantane();
  const maintenant = Date.now();
  const luA = tachesCache.liste ? tachesCache.at : null;
  const erreurRecente = derniereErreur && (!luA || derniereErreur.a > luA) ? derniereErreur : null;
  let etat = "ok";
  if (tachesCache.enVol) etat = "maj";
  else if (erreurRecente) etat = erreurRecente.type;
  else if (luA && maintenant - luA >= CACHE_MS && quotaLibre() < RESERVE_GESTES) etat = "menage";
  else if (!luA) etat = "attente";
  return {
    etat,
    luA,
    raison: erreurRecente?.message || null,
    quota: { utilise: QUOTA_MIN() - quotaLibre(), max: QUOTA_MIN() },
  };
}

// Classe une erreur de lecture pour l'app : quota (Motion ou le nôtre), panne
// (5xx, délai), réseau, clé refusée.
function typeErreur(err) {
  const t = err?.type;
  if (t === "quota") return "quota";
  if (t === "auth") return "auth";
  if (t === "reseau") return "reseau";
  if (t === "serveur" || t === "delai") return "panne";
  return "panne";
}

// Une liste complète, page après page. `cle` : le champ qui porte les éléments
// (« tasks », « projects », « workspaces »).
// `tout.tronquee` : la lecture s'est arrêtée avant la fin (plafond de pages
// ou curseur qui tourne en rond) — la liste n'est pas complète.
export async function motionGetAll(path, cle, maxPages = MAX_PAGES) {
  const tout = [];
  const vus = new Set();
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const d = await motionGet(cursor ? `${path}${sep}cursor=${encodeURIComponent(cursor)}` : path);
    tout.push(...(Array.isArray(d) ? d : d?.[cle] || []));
    cursor = typeof d?.meta?.nextCursor === "string" && d.meta.nextCursor ? d.meta.nextCursor : null;
    tout.pages = page + 1;
    if (!cursor) return tout;
    if (vus.has(cursor)) break; // l'API rend un curseur déjà vu : on s'arrête là
    vus.add(cursor);
  }
  console.warn(`Motion ${path} : lecture arrêtée avant la fin (${maxPages} pages au plus)`);
  tout.tronquee = true;
  return tout;
}

// Toutes les tâches ouvertes, telles que Motion les rend (avec scheduledStart /
// scheduledEnd : le créneau que SON algorithme a calculé). Deux appels
// simultanés partagent la même requête. `frais` : Sam a demandé une relecture.
export async function tachesMotion({ frais = false, pourEcrire = false } = {}) {
  if (!motionEnabled()) return null;
  chargerInstantane();
  if (pourEcrire) return tachesPourEcrire();
  // Tirer pour rafraîchir en boucle ne doit pas vider le quota de 12 req/min.
  if (frais && Date.now() - fraisA < FRAIS_MIN_MS) frais = false;
  if (frais) fraisA = Date.now();
  if (!frais && tachesCache.liste) {
    // Rendue tout de suite, datée ; relue derrière si elle a vieilli.
    if (doitRelire()) relireEnFond();
    return tachesCache.liste;
  }
  if (tachesCache.enVol) return tachesCache.enVol;
  // Échec il y a moins d'une minute (quota, panne) : on ne relance pas 8 pages.
  if (Date.now() - echecA < 60_000) {
    if (tachesCache.liste) return tachesCache.liste;
    throw new ErreurMotion(derniereErreur?.type === "quota" ? "quota" : "serveur", derniereErreur?.message || "Motion indisponible (dernier essai il y a moins d'une minute)");
  }
  return lireTaches();
}

// L'anti-doublon d'une création ne se fie qu'à une liste lue par la tour
// depuis moins d'une minute, sans écriture depuis (sinon Motion a pu bouger :
// une écriture coupée par un redémarrage, une tâche créée ailleurs). Une
// lecture ratée l'empêche : on ne crée pas à l'aveugle.
async function tachesPourEcrire() {
  const sure = tachesCache.liste && tachesCache.luParNous && !relireA && Date.now() - tachesCache.at < CACHE_MS;
  if (sure) return tachesCache.liste;
  if (Date.now() - echecA < 60_000) {
    throw new ErreurMotion(derniereErreur?.type === "quota" ? "quota" : "serveur", derniereErreur?.message || "Motion illisible il y a moins d'une minute");
  }
  const debut = Date.now();
  if (tachesCache.enVol) await tachesCache.enVol.catch(() => {});
  else await lireTaches().catch(() => {});
  if (derniereErreur && derniereErreur.a >= debut) throw new ErreurMotion(derniereErreur.type === "quota" ? "quota" : "serveur", derniereErreur.message);
  if (!tachesCache.liste || !tachesCache.luParNous) throw new ErreurMotion("serveur", "Liste Motion indisponible");
  return tachesCache.liste;
}

function doitRelire() {
  const maintenant = Date.now();
  if (tachesCache.enVol || maintenant - echecA < 60_000) return false;
  const due = maintenant - tachesCache.at >= CACHE_MS || (relireA && maintenant >= relireA);
  return due && quotaLibre() >= RESERVE_GESTES;
}

function relireEnFond() {
  lireTaches().catch(() => {}); // l'erreur est gardée dans derniereErreur
}

function lireTaches() {
  const gen = generation;
  const fin = chrono("motion.liste");
  const enVol = motionGetAll("/tasks", "tasks")
    .then((brutes) => {
      const liste = brutes.filter((t) => t && !estFinie(t));
      if (brutes.tronquee) liste.tronquee = true;
      fin({ pages: brutes.pages || null, taches: liste.length });
      // Une écriture a eu lieu pendant la lecture : cette liste est déjà
      // périmée, on la rend à qui l'attendait sans la mettre en cache.
      if (gen === generation) {
        retenir(liste, Date.now(), true);
        relireA = 0;
      }
      echecA = 0;
      derniereErreur = null;
      return liste;
    })
    .catch((err) => {
      if (gen === generation) tachesCache.enVol = null;
      echecA = Date.now();
      derniereErreur = { type: typeErreur(err), message: err.message, a: Date.now() };
      if (tachesCache.liste) {
        console.warn("Motion illisible, dernière liste gardée :", err.message);
        return tachesCache.liste;
      }
      throw err;
    });
  tachesCache.enVol = enVol;
  return enVol;
}

// Quand les tâches ont été lues pour la dernière fois (0 : jamais).
export const motionLuA = () => tachesCache.at;

// « Présente » ne veut pas dire « valide » (même leçon que la clé Anthropic) :
// /api/health interroge Motion pour de bon, au plus une fois toutes les 10 min.
let cacheVerif = { at: 0, verdict: null };
export async function verifierMotion() {
  if (!motionEnabled()) return "— non connecté (MOTION_API_KEY)";
  if (Date.now() - cacheVerif.at < 10 * 60_000 && cacheVerif.verdict) return cacheVerif.verdict;
  const ecriture = process.env.MOTION_WRITE === "off" ? "lecture seule — MOTION_WRITE=off" : `lecture + écriture validée par ${PRENOM}`;
  let verdict;
  try {
    exigerBacASable(BASE, "Motion");
    const r = await fetch(`${BASE}/users/me`, {
      headers: { "X-API-Key": process.env.MOTION_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    verdict = r.ok
      ? `✅ connecté (${ecriture})`
      : r.status === 401
        ? "❌ clé REFUSÉE par Motion — génère une clé (Motion › Settings › API) et remplace MOTION_API_KEY sur Vercel"
        : r.status === 429
          ? "⚠️ quota Motion atteint pour la minute (12 req/min) — réessaie"
          : `⚠️ réponse ${r.status} de Motion`;
  } catch (err) {
    verdict = `⚠️ vérification impossible (${err.name === "TimeoutError" ? "délai dépassé" : err.message})`;
  }
  cacheVerif = { at: Date.now(), verdict };
  return verdict;
}

function fmtDate(iso) {
  if (!iso) return "sans échéance";
  const d = new Date(iso);
  if (isNaN(d)) return "sans échéance";
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

// --- Transport (Lot 0, J0.7) ----------------------------------------------------
// Toute requête vers Motion passe par ici :
//   - un BUDGET partagé (12 requêtes par minute pour un compte individuel,
//     MOTION_QUOTA_MIN) : on attend son tour au lieu de se faire refuser ;
//   - un DÉLAI (15 s) : une requête bloquée ne bloque plus tout le reste ;
//   - un 429 respecte Retry-After et réessaie une fois ;
//   - des erreurs TYPÉES : « supprimee » (404), « auth » (401/403), « quota »
//     (429), « reseau », « delai », « serveur » — une tâche disparue, une clé
//     perdue et une coupure réseau ne veulent pas dire la même chose.

export class ErreurMotion extends Error {
  // `message` : ce que Sam lit (sous la ligne, dans le toast) ; `court` : la
  // cause en deux mots, pour une phrase plus large ; `detail` : la requête,
  // pour le journal de la tour.
  constructor(type, message, statut = null, { court = null, detail = null, corps = "" } = {}) {
    super(message);
    this.type = type;
    this.statut = statut;
    this.court = court || message;
    this.detail = detail;
    this.corps = corps; // la réponse brute de Motion (pour reconnaître un refus précis)
  }
}

// Ce que Sam lit quand Motion ne fait pas ce qui était demandé : la cause et
// quoi faire, jamais une URL d'API.
const MOTS_MOTION = {
  supprimee: (s) => [`Cette tâche n'existe plus dans Motion (${s})`, `tâche introuvable (${s})`],
  auth: (s) => [`Motion refuse la clé d'accès (${s}) : vérifie MOTION_API_KEY sur la tour`, `clé refusée (${s})`],
  quota: (s) => [`Motion limite le nombre de requêtes (${s}) : réessaie dans une minute`, `quota atteint (${s})`],
  serveur: (s) => [`Motion est en panne (erreur ${s}) : réessaie plus tard`, `panne Motion (${s})`],
  refus: (s, d) => [`Motion a refusé la modification (${s})${d ? ` : ${d}` : ""}`, `refusé par Motion (${s})`],
};

const QUOTA_MIN = () => Number(process.env.MOTION_QUOTA_MIN) || 12;
const DELAI_MS = () => Number(process.env.MOTION_DELAI_MS) || 15_000;
const appels = []; // horodatages des requêtes de la dernière minute
let fileQuota = Promise.resolve();
let enFile = 0; // requêtes qui attendent leur place dans la fenêtre
let pause429 = 0; // Motion a dit « trop de requêtes » : nouvel essai à cet instant

// Attend qu'une place se libère dans la fenêtre glissante d'une minute. Les
// demandes sont servies dans l'ordre d'arrivée.
function attendreCreneau() {
  enFile++;
  const tour = fileQuota.then(async () => {
    for (;;) {
      const maintenant = Date.now();
      while (appels.length && maintenant - appels[0] >= 60_000) appels.shift();
      if (appels.length < QUOTA_MIN()) {
        appels.push(maintenant);
        return;
      }
      await new Promise((r) => setTimeout(r, Math.min(60_000 - (maintenant - appels[0]) + 50, 60_000)));
    }
  });
  fileQuota = tour.catch(() => {});
  tour.then(() => enFile--, () => enFile--);
  return tour;
}

// L'attente de la file, calculée et pas devinée (24/10) : avec les requêtes
// parties dans la dernière minute et celles qui attendent, on sait quand la
// dernière partira. L'app le montre sur la carte (« En file chez Motion :
// ~20 s ») au lieu d'un rond qui tourne sans rien dire.
export function fileMotion(maintenant = Date.now()) {
  return { ...etatFileMotion(maintenant), ...estimerFile(appels, enFile, QUOTA_MIN(), maintenant) };
}

export function estimerFile(partis, attendent, quota, maintenant) {
  const fenetre = partis.filter((t) => maintenant - t < 60_000).sort((a, b) => a - b);
  let depart = maintenant;
  for (let i = 0; i < attendent; i++) {
    if (fenetre.length >= quota) depart = Math.max(depart, fenetre.shift() + 60_000);
    fenetre.push(depart);
  }
  return { enFile: attendent, attenteMs: Math.max(0, Math.round(depart - maintenant)), quotaParMinute: quota };
}

// La même file, au format du site (quota, enAttente, pause429 : 24/10,
// site-correctifs) ; /api/motion/file rend les deux formats.
// La file vue de l'extérieur (24/10) : la carte « Appliquer » dit pourquoi
// elle attend, au lieu de « Application dans Motion… » pendant 40 s.
// `attenteMs` : quand la dernière requête en file aura sa place.
export function estimerFileQuota({ appels: faits = [], enAttente: n = 0, quota, pause429: pause = 0, maintenant = Date.now() }) {
  // Chaque requête en file prend la place de celle d'il y a `quota` requêtes,
  // une minute après elle (fenêtre glissante).
  const places = faits.filter((t) => maintenant - t < 60_000).sort((a, b) => a - b);
  for (let k = 0; k < n; k++) {
    const j = places.length;
    places.push(j >= quota ? Math.max(maintenant, places[j - quota] + 60_000) : maintenant);
  }
  const derniere = n ? places[places.length - 1] : maintenant;
  return {
    quota,
    enAttente: n,
    attenteMs: Math.max(0, derniere - maintenant, pause - maintenant),
    pause429: pause > maintenant ? pause - maintenant : 0,
  };
}

export const etatFileMotion = (maintenant = Date.now()) => estimerFileQuota({ appels, enAttente: enFile, quota: QUOTA_MIN(), pause429, maintenant });

const typeDeStatut = (s) => (s === 404 ? "supprimee" : s === 401 || s === 403 ? "auth" : s === 429 ? "quota" : s >= 500 ? "serveur" : "refus");

async function appelMotion(method, path, body, essai = 0) {
  exigerBacASable(BASE, "Motion");
  const finAttente = chrono("motion.attente_quota");
  await attendreCreneau();
  finAttente();
  const finAppel = chrono(method === "GET" ? "motion.lecture" : "motion.ecriture_http");
  let r;
  try {
    r = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "X-API-Key": process.env.MOTION_API_KEY,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(DELAI_MS()),
    });
  } catch (err) {
    const delai = err?.name === "TimeoutError" || err?.name === "AbortError";
    const detail = `${method} ${path}`;
    console.warn(`Motion ${detail} : ${delai ? "délai dépassé" : "injoignable"}`);
    throw delai
      ? new ErreurMotion("delai", "Motion n'a pas répondu à temps (délai dépassé) : réessaie dans un instant", null, { court: "délai dépassé", detail })
      : new ErreurMotion("reseau", "Motion injoignable pour le moment (réseau) : réessaie dans un instant", null, { court: "injoignable", detail });
  }
  if (r.status === 429 && essai === 0) {
    const attente = Math.min(20_000, Math.max(1_000, (Number(r.headers.get("retry-after")) || 5) * 1000));
    pause429 = Math.max(pause429, Date.now() + attente);
    await new Promise((res) => setTimeout(res, attente));
    return appelMotion(method, path, body, 1);
  }
  if (!r.ok) {
    const corps = method === "GET" ? "" : await r.text().catch(() => "");
    let raison = "";
    try {
      raison = String(JSON.parse(corps)?.message || "").slice(0, 160);
    } catch {}
    const type = typeDeStatut(r.status);
    const [message, court] = MOTS_MOTION[type](r.status, raison);
    console.warn(`Motion ${method} ${path} : ${r.status} ${corps.slice(0, 200)}`);
    throw new ErreurMotion(type, message, r.status, { court, detail: `${method} ${path}`, corps: corps.slice(0, 500) });
  }
  finAppel({ statut: r.status });
  if (r.status === 204) return {};
  try {
    return await r.json();
  } catch (err) {
    // Les en-têtes sont arrivés, pas le corps (délai, coupure) : l'écriture a
    // PEUT-ÊTRE eu lieu. Dit comme tel, en français.
    const delai = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.warn(`Motion ${method} ${path} : réponse incomplète (${err?.message})`);
    throw new ErreurMotion(
      delai ? "delai" : "reseau",
      method === "GET"
        ? "Motion a répondu de façon incomplète : réessaie dans un instant"
        : "Motion n'a pas fini de répondre : la modification a peut-être été faite — vérifie dans Motion avant de réessayer",
      r.status,
      { court: "réponse incomplète", detail: `${method} ${path}` },
    );
  }
}

const motionGet = (path) => appelMotion("GET", path);
const motionSend = (method, path, body) => appelMotion(method, path, body);

// « lun-ven 09:00-17:00 · sam 10:00-12:00 » — les jours consécutifs aux mêmes
// horaires sont regroupés pour rester compact.
const DAYS = [
  ["monday", "lun"], ["tuesday", "mar"], ["wednesday", "mer"], ["thursday", "jeu"],
  ["friday", "ven"], ["saturday", "sam"], ["sunday", "dim"],
];
function fmtSchedule(sched) {
  const hours = DAYS.map(([key]) =>
    (sched?.[key] || []).map((b) => `${b.start}-${b.end}`).join(" et ")
  );
  const runs = [];
  for (let i = 0; i < DAYS.length; i++) {
    if (!hours[i]) continue;
    const last = runs[runs.length - 1];
    if (last && last.hours === hours[i] && last.endIdx === i - 1) {
      last.endIdx = i;
    } else {
      runs.push({ startIdx: i, endIdx: i, hours: hours[i] });
    }
  }
  if (!runs.length) return "aucun créneau défini";
  return runs
    .map((r) => {
      const from = DAYS[r.startIdx][1];
      const to = DAYS[r.endIdx][1];
      return `${from === to ? from : from + "-" + to} ${r.hours}`;
    })
    .join(" · ");
}

function taskLine(t) {
  const extras = [];
  if (t.project?.name) extras.push(t.project.name);
  if (t.priority === "ASAP") extras.push("prio ASAP");
  else if (t.priority === "HIGH") extras.push("prio haute");
  if (typeof t.duration === "number" && t.duration > 0) extras.push(`${t.duration} min`);
  // L'identifiant est nécessaire pour modifier ou terminer la tâche.
  return `- [${t.id}] ${t.name} (${fmtDate(t.dueDate)}${extras.length ? " · " + extras.join(" · ") : ""})`;
}

// --- Lecture complète, pour trier (outil motion_lister) ------------------------
// L'instantané envoyé avant chaque réponse résume (« … et 74 autres ») : pour un
// grand tri, Rémy a besoin de tout voir, par pages.

const PAR_PAGE = 100;
const FILTRES = ["tout", "retard", "aujourdhui", "semaine", "plus_tard", "sans_echeance"];

function filtreDe(t, maintenant) {
  const due = t.dueDate ? Date.parse(t.dueDate) : null;
  if (!due) return "sans_echeance";
  if (due < maintenant - 3600_000) return "retard";
  if (due < maintenant + 86_400_000) return "aujourdhui";
  if (due < maintenant + 7 * 86_400_000) return "semaine";
  return "plus_tard";
}

export async function listerTaches({ filtre = "tout", recherche = "", page = 1 } = {}) {
  const toutes = (await tachesMotion()) || [];
  const f = FILTRES.includes(filtre) ? filtre : "tout";
  const cle = cleNom(recherche);
  const maintenant = Date.now();
  const retenues = toutes
    .filter((t) => f === "tout" || filtreDe(t, maintenant) === f || (f === "plus_tard" && filtreDe(t, maintenant) === "sans_echeance"))
    .filter((t) => !cle || cleNom(t.name).includes(cle) || cleNom(t.project?.name).includes(cle))
    .sort((a, b) => (Date.parse(a.dueDate) || Infinity) - (Date.parse(b.dueDate) || Infinity));
  const pages = Math.max(1, Math.ceil(retenues.length / PAR_PAGE));
  const p = Math.min(Math.max(1, Number(page) || 1), pages);
  return {
    total: retenues.length,
    page: p,
    pages,
    incomplet: Boolean(toutes.tronquee),
    taches: retenues.slice((p - 1) * PAR_PAGE, p * PAR_PAGE).map((t) => ({
      id: t.id,
      nom: t.name,
      echeance: t.dueDate ? fmtDate(t.dueDate) : null,
      duree_min: typeof t.duration === "number" ? t.duration : null,
      priorite: t.priority || null,
      projet: t.project?.name || null,
      espace: t.workspace?.name || null,
    })),
  };
}

// L'horaire dans lequel Rémy place une tâche qu'il crée. La doc de Motion dit
// que « Work Hours » existe chez tout le monde ; Sam n'en a pas (il a
// « Working hours », 9 h-23 h 59, et des fenêtres de routine) — constaté le
// 09/10. On prend l'horaire qui existe vraiment : « Work Hours » s'il est là,
// sinon un horaire « work… », sinon le premier.
// REMY_MOTION_HORAIRE l'impose. Horaires illisibles (quota, panne) : on ne
// devine plus « Work Hours » en silence — c'était justement le cas que #61
// corrigeait — la création échoue et le dit.
export async function nomHoraire() {
  if (process.env.REMY_MOTION_HORAIRE) return process.env.REMY_MOTION_HORAIRE;
  const d = await lentement("horaires", () => motionGet("/schedules"));
  if (d === null) throw new ErreurMotion("horaires", "Horaires Motion illisibles pour le moment : rien n'a été créé, réessaie dans une minute");
  const noms = (Array.isArray(d) ? d : d?.schedules || []).map((s) => s?.name).filter(Boolean);
  return noms.find((n) => n === "Work Hours") || noms.find((n) => /^work/i.test(n)) || noms[0] || "Work Hours";
}

// Les plages de l'horaire où Motion place les tâches ({ monday: [{ start,
// end }], … }), pour la charge des 7 jours. Même choix d'horaire que
// nomHoraire ; même lecture que l'instantané (10 min de cache, jamais une
// panne). null : horaires illisibles ou absents.
export async function horairesMotion() {
  if (!motionEnabled()) return null;
  const d = await lentement("horaires", () => motionGet("/schedules"));
  const liste = (Array.isArray(d) ? d : d?.schedules || []).filter((s) => s?.schedule && typeof s.schedule === "object");
  const voulu = process.env.REMY_MOTION_HORAIRE;
  const h = (voulu && liste.find((s) => s.name === voulu)) || liste.find((s) => s.name === "Work Hours") || liste.find((s) => /^work/i.test(s.name || "")) || liste[0];
  return h ? { nom: String(h.name || "Horaires"), plages: h.schedule } : null;
}

// Le nom actuel d'une tâche ouverte, par son identifiant (null si inconnue).
export async function nomDeTache(id) {
  const t = ((await tachesMotion()) || []).find((x) => x.id === id);
  return t ? t.name : null;
}

// --- Écriture (v2) : Rémy propose, Sam valide, tout est annulable ----------
// Vocabulaire fermé de mutations (roadmap étape 4) : creer | modifier | terminer.
// Aucune écriture n'est déclenchée par le modèle : elle passe toujours par
// applyActions(), appelé depuis un clic explicite de Sam.

let idsCache = { at: 0, workspaceId: null, workspaceName: null, doneStatus: null };

// L'espace où Sam travaille vraiment, déduit de l'endroit où ses tâches
// EXISTENT DÉJÀ. La lecture (`GET /tasks`) couvre tous ses espaces, alors que
// l'écriture doit en désigner un : prendre « le premier rendu par l'API » n'a
// aucune raison d'être le bon, et une tâche créée dans le mauvais espace part
// dans le vide — l'API répond 200, Sam ne voit rien.
async function espacePrincipal(espaces) {
  if (espaces.length <= 1) return espaces[0]?.id || null;
  try {
    const taches = (await tachesMotion()) || [];
    const compte = new Map();
    for (const t of taches) {
      const id = t?.workspace?.id || t?.workspaceId;
      if (id) compte.set(id, (compte.get(id) || 0) + 1);
    }
    const gagnant = [...compte.entries()].sort((a, b) => b[1] - a[1])[0];
    if (gagnant) return gagnant[0];
  } catch (err) {
    console.warn("Espaces Motion non départagés :", err.message);
  }
  return espaces[0]?.id || null;
}

async function motionIds() {
  if (Date.now() - idsCache.at < 30 * 60 * 1000 && idsCache.workspaceId) return idsCache;
  const espaces = await motionGetAll("/workspaces", "workspaces");
  let workspaceId = process.env.MOTION_WORKSPACE_ID || null;
  // Un identifiant configuré mais inconnu du compte enverrait les tâches dans
  // le vide en silence : on le signale et on retombe sur la déduction.
  if (workspaceId && espaces.length && !espaces.some((w) => w.id === workspaceId)) {
    console.warn(`MOTION_WORKSPACE_ID « ${workspaceId} » ne correspond à aucun espace — ignoré`);
    workspaceId = null;
  }
  if (!workspaceId) workspaceId = await espacePrincipal(espaces);
  if (!workspaceId) throw new Error("Aucun espace de travail Motion trouvé");
  const workspaceName = espaces.find((w) => w.id === workspaceId)?.name || workspaceId;
  // Tracé une fois par demi-heure : si une tâche « créée » reste invisible,
  // cette ligne dit tout de suite où elle est partie.
  console.log(
    `Motion : écriture dans « ${workspaceName} » (%s espace(s) disponible(s))`,
    espaces.length,
  );
  let doneStatus = null;
  try {
    const st = await motionGet(`/statuses?workspaceId=${encodeURIComponent(workspaceId)}`);
    const list = Array.isArray(st) ? st : st?.statuses || [];
    doneStatus = list.find((s) => s.isResolvedStatus)?.name || null;
  } catch (err) {
    console.warn("Statuts Motion indisponibles :", err.message);
  }
  idsCache = { at: Date.now(), workspaceId, workspaceName, doneStatus };
  return idsCache;
}

function normDuration(d) {
  if (d === undefined || d === null || d === "") return undefined;
  if (typeof d === "number") return Math.max(5, Math.round(d));
  if (["NONE", "REMINDER"].includes(String(d).toUpperCase())) return String(d).toUpperCase();
  const n = parseInt(d, 10);
  return Number.isFinite(n) ? Math.max(5, n) : undefined;
}

// Comparaison tolérante de noms de tâches : accents, casse, ponctuation et
// troncature ne doivent pas faire échouer une action légitime — mais deux
// tâches réellement différentes ne doivent jamais se confondre.
function cleNom(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function memeTache(annonce, reel) {
  const a = cleNom(annonce);
  const b = cleNom(reel);
  if (!a) return false; // nom non annoncé : impossible de vérifier ce que Sam a validé
  if (!b) return true; // tâche sans nom côté Motion : rien à contredire
  return a === b || a.includes(b) || b.includes(a);
}

// Anti-doublon : le MÊME nom (accents, casse et ponctuation mis à part), pas
// une inclusion — « Sport » existant ne doit pas bloquer « Sport avec Hugo ».
function memeNom(a, b) {
  const x = cleNom(a);
  return Boolean(x) && x === cleNom(b);
}

const PRIORITES = ["ASAP", "HIGH", "MEDIUM", "LOW"];
function normPriorite(p) {
  if (!p) return undefined;
  const up = String(p).toUpperCase();
  return PRIORITES.includes(up) ? up : undefined;
}

// Les tâches ouvertes, relues une fois par application (et non par action).
async function tachesOuvertes() {
  try {
    // Copie : on y ajoute les tâches créées pendant l'application.
    const liste = (await tachesMotion({ pourEcrire: true })) || [];
    const copie = [...liste];
    if (liste.tronquee) copie.tronquee = true;
    return copie;
  } catch (err) {
    // Pas de liste = pas de garde-fou anti-doublon. Avant, on créait quand
    // même (« mieux vaut un doublon qu'un refus ») ; avec une chaîne d'écriture
    // idempotente, un nouvel essai ne coûte plus rien : on ne crée pas à
    // l'aveugle, on le dit.
    throw new ErreurMotion("liste", `Tâches Motion illisibles (${err.court || err.message}) : rien n'a été créé, pour ne pas risquer un doublon — réessaie`);
  }
}

// Applique une liste d'actions validées. Renvoie un résultat par action, avec
// de quoi annuler (snapshot avant modification, id après création).
export async function applyActions(actions) {
  if (!motionEnabled()) throw new Error("Motion n'est pas connecté");
  const { workspaceId, workspaceName, doneStatus } = await motionIds();
  const results = [];
  // Ce que Motion a répondu, pour mettre la liste à jour sans la relire.
  const changements = [];
  const finEcriture = chrono("motion.ecriture");
  // Relu une fois pour toute l'application : le garde-fou anti-doublon ne doit
  // pas coûter un appel Motion par action (l'API est limitée à ~12 req/min).
  let ouvertes = null;

  for (const a of (actions || []).slice(0, 12)) {
    try {
      if (a.type === "creer") {
        if (!a.nom) throw new Error("Nom manquant");
        // Dernier rempart contre le doublon : si une tâche ouverte porte déjà
        // ce nom, on ne la recrée pas. Sam paie chaque appel — et se
        // retrouvait avec deux fois la même chose dans son planning.
        if (!ouvertes) ouvertes = await tachesOuvertes();
        let jumelle = ouvertes.find((t) => memeNom(a.nom, t.name));
        // Liste incomplète : on demande à Motion par le nom (une requête de plus,
        // plutôt qu'un doublon payé deux fois).
        if (!jumelle && ouvertes.tronquee) {
          const parNom = await motionGet(`/tasks?name=${encodeURIComponent(String(a.nom).slice(0, 80))}`).catch(() => null);
          jumelle = (parNom?.tasks || []).find((t) => !t.completed && memeNom(a.nom, t.name));
        }
        // Déjà là n'est pas un échec (J+30 : 92 % des « échouée » de
        // l'historique) : rien n'est créé, rien à annuler, rien à refaire.
        if (jumelle) {
          results.push({
            ok: true,
            type: "creer",
            nom: String(a.nom),
            dejaLa: true,
            doublon: true,
            note: `« ${jumelle.name} » est déjà dans Motion`,
          });
          continue;
        }
        const body = {
          name: String(a.nom).slice(0, 200),
          workspaceId,
          autoScheduled: { deadlineType: "SOFT", schedule: await nomHoraire() },
        };
        if (a.echeance) body.dueDate = a.echeance;
        const dur = normDuration(a.duree);
        if (dur !== undefined) body.duration = dur;
        const prio = normPriorite(a.priorite);
        if (prio) body.priority = prio;
        if (a.description) body.description = String(a.description).slice(0, 2000);
        const task = await motionSend("POST", "/tasks", body);
        ouvertes.push({ id: task.id, name: body.name, status: { name: "Todo" } });
        changements.push({ tache: task?.id ? task : { id: task?.id, name: body.name, status: { name: "Todo" }, dueDate: body.dueDate ?? null, duration: body.duration } });
        results.push({ ok: true, type: "creer", nom: body.name, taskId: task.id, espace: workspaceName, annulable: "supprimer", apres: etatTache(task) });
      } else if (a.type === "modifier" || a.type === "terminer") {
        if (!a.id) throw new Error("Identifiant de tâche manquant");
        const avant = await motionGet(`/tasks/${encodeURIComponent(a.id)}`);
        // Sam valide ce qu'il LIT (le nom). Si l'identifiant désigne une
        // autre tâche que celle affichée, on refuse : sans ce garde-fou, une
        // page web hostile pourrait faire clore une tâche importante sous le
        // libellé d'une tâche anodine.
        if (!memeTache(a.nom, avant.name)) {
          throw new Error(
            `La tâche visée s'appelle « ${avant.name} », pas « ${a.nom || "?" } » — action refusée par sécurité`
          );
        }
        // On repart de l'état actuel (le nom) ; l'espace n'est plus envoyé.
        const body = { name: avant.name };
        const espaceTache = avant.workspace?.id || workspaceId;
        const snapshot = {
          name: avant.name,
          dueDate: avant.dueDate,
          duration: avant.duration,
          priority: avant.priority,
          status: avant.status?.name,
        };
        if (a.type === "terminer") {
          // Le statut « terminé » de l'espace DE LA TÂCHE (Sam en a plusieurs),
          // celui de l'espace principal à défaut.
          const fini = (avant.workspace?.statuses || []).find((s) => s.isResolvedStatus)?.name || doneStatus;
          if (!fini) throw new Error("Aucun statut « terminé » trouvé dans Motion");
          body.status = fini;
        } else {
          if (a.nouveau_nom) body.name = String(a.nouveau_nom).slice(0, 200);
          if (a.echeance) body.dueDate = a.echeance;
          const dur = normDuration(a.duree);
          if (dur !== undefined) body.duration = dur;
          const prio = normPriorite(a.priorite);
          if (prio) body.priority = prio;
        }
        const apres = await modifierTache(a.id, body, espaceTache);
        changements.push(
          a.type === "terminer"
            ? { retirer: true, id: a.id }
            : { tache: apres?.id ? apres : { id: a.id, name: body.name, dueDate: body.dueDate, duration: body.duration, priority: body.priority } },
        );
        results.push({
          ok: true,
          type: a.type,
          nom: a.nom || avant.name,
          taskId: a.id,
          // Pour la revue du dimanche : le domaine d'une tâche faite (24/10).
          projet: avant.project?.name ? String(avant.project.name).slice(0, 80) : null,
          annulable: "restaurer",
          avant: snapshot,
          // Ce que Rémy a laissé : à l'annulation, si la tâche ne lui ressemble
          // plus, Sam l'a modifiée depuis dans Motion — on n'écrase rien.
          // La réponse de Motion d'abord (elle reflète ce qu'il a vraiment
          // enregistré, normalisé), ce qu'on a envoyé à défaut.
          apres: {
            ...Object.fromEntries(Object.entries(body).filter(([k]) => k !== "status")),
            ...Object.fromEntries(Object.entries(etatTache(apres)).filter(([, v]) => v !== null && v !== undefined)),
            status: body.status || snapshot.status,
          },
        });
      } else {
        throw new Error(`Action inconnue : ${a.type}`);
      }
    } catch (err) {
      console.warn("Action Motion échouée :", err.message);
      // `nature` (capture-idempotente-v1, 25/10) : la file d'envoi de l'iPhone
      // y lit si l'échec passera seul (quota, panne, délai) ou attend Sam.
      results.push({ ok: false, type: a.type, nom: a.nom || a.nouveau_nom || "?", erreur: err.message, nature: err instanceof ErreurMotion ? err.type : null });
    }
  }

  // La liste suit ce que Motion a répondu ; Motion recalcule le planning
  // derrière : une relecture est prévue ~25 s plus tard.
  majApresEcriture(changements);
  finEcriture({ actions: results.length });
  return results;
}

// Modifier une tâche. Motion refuse désormais workspaceId sur PATCH /tasks/:id
// (« property workspaceId should not exist », constaté le 08/10/2026) alors que
// sa doc le dit encore requis : cocher une tâche échouait. On l'envoie sans, et
// seulement si Motion le réclame à nouveau, une seconde fois avec.
export async function modifierTache(id, body, workspaceId) {
  const chemin = `/tasks/${encodeURIComponent(id)}`;
  try {
    return await motionSend("PATCH", chemin, body);
  } catch (err) {
    const texte = `${err.message} ${err.corps || ""}`;
    const reclame = /workspaceId/.test(texte) && !/should not exist/.test(texte);
    if (!reclame || !workspaceId) throw err;
    return motionSend("PATCH", chemin, { ...body, workspaceId });
  }
}

// L'état d'une tâche, réduit à ce que Rémy sait écrire (et donc restaurer).
function etatTache(t) {
  return {
    name: t?.name ?? null,
    dueDate: t?.dueDate ?? null,
    duration: t?.duration ?? null,
    priority: t?.priority ?? null,
    status: t?.status?.name ?? null,
  };
}

const memeValeur = (a, b) => {
  if (a === null || a === undefined || a === "") return b === null || b === undefined || b === "";
  if (typeof a === "string" && typeof b === "string" && !isNaN(Date.parse(a)) && !isNaN(Date.parse(b)) && /\d{4}-\d{2}-\d{2}/.test(a)) {
    return Date.parse(a) === Date.parse(b);
  }
  return String(a) === String(b);
};

// Ce qui a bougé dans Motion depuis l'écriture de Rémy (vide = rien).
function derive(actuel, apres) {
  if (!apres) return [];
  // Le statut aussi : une tâche cochée par Sam depuis n'est ni rouverte ni supprimée.
  // (comparé seulement s'il est connu : un statut absent de la réponse n'est pas une dérive).
  return ["name", "dueDate", "duration", "priority", "status"].filter(
    (k) => k in apres && !(k === "status" && !apres.status) && !memeValeur(apres[k], actuel[k]),
  );
}

// Défait UNE écriture. Vérifie d'abord que la tâche est toujours telle que
// Rémy l'a laissée : si Sam l'a modifiée depuis dans Motion, on n'écrase
// rien et on le dit (conflit). Remet aussi les champs qui étaient VIDES (une
// échéance ajoutée par Rémy repart, au lieu de rester).
export async function annulerResultatMotion(r, workspaceId = null) {
  if (!r?.ok || !r.taskId) return { ok: true, nom: r?.nom, quoi: "rien à défaire" };
  try {
    let actuel;
    try {
      actuel = etatTache(await motionGet(`/tasks/${encodeURIComponent(r.taskId)}`));
    } catch (err) {
      if (err.type === "supprimee") {
        return r.annulable === "supprimer"
          ? { ok: true, nom: r.nom, quoi: "déjà supprimée dans Motion" }
          : { ok: false, nom: r.nom, erreur: "La tâche n'existe plus dans Motion : rien à restaurer", type: "supprimee" };
      }
      throw err;
    }
    const bouge = derive(actuel, r.apres);
    if (bouge.length) {
      return { ok: false, conflit: true, nom: r.nom, erreur: `Modifiée dans Motion depuis (${bouge.join(", ")}) : rien n'est écrasé, à toi de voir`, type: "conflit" };
    }
    if (r.annulable === "supprimer") {
      await motionSend("DELETE", `/tasks/${encodeURIComponent(r.taskId)}`);
      return { ok: true, nom: r.nom, quoi: "tâche supprimée" };
    }
    if (r.annulable === "restaurer" && r.avant) {
      const body = { name: r.avant.name };
      for (const k of ["dueDate", "duration", "priority"]) {
        const avant = r.avant[k];
        if (avant !== undefined && avant !== null && avant !== "") body[k] = avant;
        // Vide avant, rempli par Rémy : on le revide (sinon il restait).
        else if (r.apres && r.apres[k] !== null && r.apres[k] !== undefined && k === "dueDate") body[k] = null;
      }
      if (r.avant.status) body.status = r.avant.status;
      await modifierTache(r.taskId, body, workspaceId);
      return { ok: true, nom: r.nom, quoi: "état précédent restauré" };
    }
    return { ok: false, nom: r.nom, erreur: "Rien pour restaurer cette action" };
  } catch (err) {
    return { ok: false, nom: r.nom, erreur: err.message, type: err.type || null };
  } finally {
    oublierCaches();
  }
}

// Annulation d'une entrée complète du journal : on défait dans l'ordre inverse.
export async function undoResults(results) {
  if (!motionEnabled()) throw new Error("Motion n'est pas connecté");
  const { workspaceId } = await motionIds();
  const out = [];
  for (const r of [...(results || [])].reverse()) {
    if (!r.ok || !r.taskId) continue;
    out.push(await annulerResultatMotion(r, workspaceId));
  }
  return out;
}

export async function espaceParDefaut() {
  return (await motionIds()).workspaceId;
}

// Horaires et projets bougent rarement : relus toutes les 10 min, pour que le
// rafraîchissement à la minute des tâches tienne dans le quota Motion.
const lents = new Map();
async function lentement(cle, lire) {
  const c = lents.get(cle);
  if (c && Date.now() - c.at < 10 * 60_000) return c.valeur;
  try {
    const valeur = await lire();
    lents.set(cle, { at: Date.now(), valeur });
    return valeur;
  } catch {
    return c?.valeur ?? null; // un plus, jamais une panne
  }
}

// L'onglet Projets de l'app (lecture seule) : les projets ouverts de Motion,
// leurs tâches ouvertes, la plus proche échéance. Les tâches viennent du même
// cache que la journée ; les projets, relus toutes les 10 min au plus.
export async function projetsMotion({ maintenant = Date.now() } = {}) {
  if (!motionEnabled()) return null;
  const [taches, donnees] = await Promise.all([
    tachesMotion(),
    lentement("projets", () => motionGetAll("/projects", "projects", 2).then((projects) => ({ projects }))),
  ]);
  const projets = new Map();
  for (const p of donnees?.projects || []) {
    if (!p?.name || p.status?.isResolvedStatus) continue;
    projets.set(p.id ? `id:${p.id}` : `nom:${p.name}`, {
      id: String(p.id || p.name), nom: String(p.name).slice(0, 80),
      statut: p.status?.name ? String(p.status.name).slice(0, 40) : null, taches: [],
    });
  }
  let sansProjet = 0;
  for (const t of taches || []) {
    const nom = t.project?.name;
    const id = t.project?.id || t.projectId;
    let p = (id && projets.get(`id:${id}`)) || [...projets.values()].find((x) => nom && x.nom === nom);
    if (!p && nom) {
      // Une tâche rattachée à un projet absent de la liste (liste tronquée).
      p = { id: String(id || nom), nom: String(nom).slice(0, 80), statut: null, taches: [] };
      projets.set(id ? `id:${id}` : `nom:${nom}`, p);
    }
    if (!p) { sansProjet++; continue; }
    p.taches.push({
      id: String(t.id), titre: String(t.name || "(sans nom)").slice(0, 200), echeance: t.dueDate ? Date.parse(t.dueDate) || null : null,
      duree: typeof t.duration === "number" ? t.duration : null, priorite: typeof t.priority === "string" ? t.priority.toUpperCase() : null,
    });
  }
  const liste = [...projets.values()].map((p) => {
    const datees = p.taches.filter((t) => t.echeance).sort((a, b) => a.echeance - b.echeance);
    const prochaine = datees[0] || p.taches[0] || null;
    return {
      id: p.id, nom: p.nom, statut: p.statut,
      taches: p.taches.length,
      enRetard: datees.filter((t) => t.echeance < maintenant - 3600_000).length,
      prochaine: prochaine ? { id: prochaine.id, titre: prochaine.titre, echeance: prochaine.echeance } : null,
      // Les tâches ouvertes du projet (pour les ranger dans des sous-projets).
      liste: [...datees, ...p.taches.filter((t) => !t.echeance)].slice(0, 30),
    };
  });
  // Ceux qui avancent d'abord (la plus proche échéance), puis les autres.
  liste.sort((a, b) =>
    (a.prochaine?.echeance ?? Infinity) - (b.prochaine?.echeance ?? Infinity) || b.taches - a.taches || a.nom.localeCompare(b.nom, "fr"));
  return { projets: liste.slice(0, 60), sansProjet, tronquee: Boolean(taches?.tronquee) };
}

export async function motionSnapshot() {
  if (!motionEnabled()) return "";
  if (Date.now() - cache.at < CACHE_MS) return cache.text;

  // Les tâches sont le cœur : leur échec fait échouer l'instantané (signalé en
  // amont). Horaires et projets sont un plus : leur échec les omet simplement.
  const [ouvertes, schedulesData, projectsData] = await Promise.all([
    tachesMotion(),
    lentement("horaires", () => motionGet("/schedules")),
    lentement("projets", () => motionGetAll("/projects", "projects", 2).then((projects) => ({ projects }))),
  ]);

  const parts = [];

  const schedules = Array.isArray(schedulesData) ? schedulesData : schedulesData?.schedules;
  if (Array.isArray(schedules) && schedules.length) {
    const lines = schedules
      .slice(0, 4)
      .map((s) => `- ${s.name || "Horaires"}${s.timezone ? ` (${s.timezone})` : ""} : ${fmtSchedule(s.schedule)}`);
    parts.push(`### Horaires de travail configurés dans Motion\n${lines.join("\n")}`);
  }

  const projects = (projectsData?.projects || [])
    .filter((p) => p && !p.status?.isResolvedStatus)
    .slice(0, 12);
  if (projects.length) {
    parts.push(
      `### Projets ouverts (${projects.length})\n${projects.map((p) => `- ${p.name}`).join("\n")}`
    );
  }

  const tasks = ouvertes.slice(0, 100);

  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const overdue = [];
  const today = [];
  const week = [];
  const later = [];
  for (const t of tasks) {
    const due = t.dueDate ? Date.parse(t.dueDate) : null;
    const line = taskLine(t);
    if (due && due < now - 3600_000) overdue.push(line);
    else if (due && due < now + day) today.push(line);
    else if (due && due < now + 7 * day) week.push(line);
    else later.push(line);
  }

  const cap = (arr, n) =>
    arr.slice(0, n).join("\n") + (arr.length > n ? `\n- … et ${arr.length - n} autres` : "");
  if (overdue.length) parts.push(`### En retard (${overdue.length})\n${cap(overdue, 8)}`);
  if (today.length) parts.push(`### Aujourd'hui / demain (${today.length})\n${cap(today, 10)}`);
  if (week.length) parts.push(`### Cette semaine (${week.length})\n${cap(week, 10)}`);
  if (later.length) parts.push(`### Plus tard ou sans échéance (${later.length})\n${cap(later, 5)}`);

  const anyTask = overdue.length + today.length + week.length + later.length > 0;
  const maintenant = new Date().toLocaleString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: process.env.REMY_TZ || "Europe/Paris",
  });
  const text = parts.length
    ? `Instantané Motion (planning de ${PRENOM}, lu il y a moins d'une minute).\nNous sommes le ${maintenant}. Le préfixe [xxx] devant chaque tâche est son identifiant Motion.\n\n${parts.join("\n\n")}${anyTask ? "" : "\n\n(Aucune tâche ouverte.)"}`.slice(0, 4600)
    : `Instantané Motion : aucune tâche ouverte. Nous sommes le ${maintenant}.`;
  cache = { at: Date.now(), text };
  return text;
}

// Créer un projet Motion (Lot 1 : « grands projets durables », validés par
// Sam). L'API ne permet NI de modifier NI de supprimer un projet : un projet
// du même nom déjà ouvert est réutilisé plutôt que dupliqué.
export async function creerProjetMotion(nom) {
  if (!motionEnabled()) throw new ErreurMotion("refus", "Motion n'est pas connecté");
  const { workspaceId } = await motionIds();
  const propre = String(nom || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!propre) throw new ErreurMotion("refus", "Nom de projet vide");
  const existants = await motionGetAll(`/projects?workspaceId=${encodeURIComponent(workspaceId)}`, "projects", 3).catch(() => []);
  const jumeau = existants.find((p) => p?.name && memeNom(propre, p.name) && !p.status?.isResolvedStatus);
  if (jumeau) return { id: String(jumeau.id), nom: jumeau.name, existait: true };
  const p = await motionSend("POST", "/projects", { name: propre, workspaceId });
  lents.delete("projets"); // la liste des projets la montrera tout de suite
  return { id: String(p.id), nom: p.name || propre, existait: false };
}
