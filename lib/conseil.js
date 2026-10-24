// Le conseil du moment (Lot 1, retours TestFlight 13 de Sam, 15/10) :
// « plus de suggestions mécaniques absurdes du type “Tu as 44 minutes, avance
// sur ta douche” » ; « GLM local pour raisonner, conseil précalculé en
// arrière-plan et mis en cache ; ne bloque jamais l'affichage ».
//
//   - GLM LOCAL SEULEMENT : jamais de secours cloud ici (V8 — rien de privé ne
//     part automatiquement chez un fournisseur). Sans GLM, l'iPhone garde son
//     conseil calculé par règles.
//   - Circuit « conseil » : coupable d'un geste dans les Réglages.
//   - Une situation résumée (la journée, pas la mémoire ni les conversations).
//   - Le résultat est gardé avec la « clé » de la situation : tant qu'elle ne
//     change pas (mêmes éléments, même tranche de 20 min), on ne refait rien.

import crypto from "node:crypto";
import { glmConfigured, verifierGlm, libelleLocal } from "./glm.js";
import { glmProvider } from "./providers.js";
import { circuitActif } from "./jobs.js";
import * as instantanes from "./instantanes.js";
import { logCost } from "./chat.js";
import { chrono } from "./mesures.js";
import { TZ } from "./activite.js";
import { normaliser } from "./regles.js";
import { PRENOM } from "./profil.js";
import { contextePriorites } from "./priorites.js";

export const TYPES = {
  maintenant: "Que faire maintenant, compte tenu de ce qui est en cours et de ce qui arrive.",
  prochaine: "Comment aborder le prochain élément de la journée (tâche ou rendez-vous) : préparation, transition, départ.",
  libre: "Comment utiliser le temps libre avant le prochain engagement fixe — ou dire honnêtement qu'il n'y en a pas.",
  priorites: "Ce qui compte le plus aujourd'hui et ce qui peut attendre, en tenant compte des échéances et des retards.",
};

const TRANCHE_MS = 20 * 60_000;
const AUTO_MIN_MS = Number(process.env.REMY_CONSEIL_AUTO_MS ?? 2 * 60_000); // deux calculs automatiques du même type : 2 min d'écart au moins
const persister = () => process.env.REMY_ENV !== "test" || process.env.REMY_INSTANTANE === "on";

const heure = (ms) =>
  ms ? new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(ms)) : null;
const jourLong = (ms) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(ms));
const minutes = (ms) => Math.max(0, Math.round(ms / 60_000));
const PRIO = { ASAP: "urgente", HIGH: "importante", MEDIUM: "normale", LOW: "basse" };

/** La journée résumée pour GLM : ce qui compte pour décider, rien de plus. */
export function situation(j, { maintenant = Date.now(), rappels = [], priorites = null } = {}) {
  const items = (j?.items || []).filter((e) => e && typeof e.debut === "number");
  const fin = (e) => e.fin ?? e.debut + 30 * 60_000;
  const enCours = items.find((e) => e.debut <= maintenant && fin(e) > maintenant && !e.fait);
  const avenir = items.filter((e) => e.debut > maintenant).sort((a, b) => a.debut - b.debut);
  const prochainFixe = avenir.find((e) => e.type === "rdv");
  const libres = (t) => t && t.bloquee !== true;
  return {
    heure: heure(maintenant),
    jour: jourLong(maintenant),
    enCours: enCours
      ? {
          titre: enCours.titre,
          nature: enCours.type === "rdv" ? "rendez-vous fixe" : "tâche Motion",
          fin: heure(fin(enCours)),
          resteMin: minutes(fin(enCours) - maintenant),
          projet: enCours.projet || undefined,
          bloquee: enCours.bloquee || undefined,
        }
      : null,
    prochainsFixes: avenir
      .filter((e) => e.type === "rdv")
      .slice(0, 3)
      .map((e) => ({ titre: e.titre, debut: heure(e.debut), fin: heure(fin(e)), lieu: e.lieu || undefined })),
    prochainesTaches: avenir
      .filter((e) => e.type === "tache" && libres(e))
      .slice(0, 4)
      .map((e) => ({ titre: e.titre, debut: heure(e.debut), dureeMin: e.duree ?? minutes(fin(e) - e.debut), priorite: PRIO[e.priorite] || undefined, projet: e.projet || undefined })),
    libreAvantProchainFixeMin: prochainFixe ? minutes(prochainFixe.debut - Math.max(maintenant, enCours ? fin(enCours) : maintenant)) : null,
    aFaireAujourdhui: (j?.aFaire || [])
      .filter(libres)
      .slice(0, 8)
      .map((t) => ({ titre: t.titre, priorite: PRIO[t.priorite] || undefined, avant: heure(t.echeance) || undefined, projet: t.projet || undefined })),
    enRetard: {
      total: j?.retard?.total || 0,
      exemples: (j?.retard?.items || []).filter(libres).slice(0, 3).map((t) => t.titre),
    },
    bloquees: [...(j?.aFaire || []), ...(j?.retard?.items || []), ...items].filter((t) => t?.bloquee).slice(0, 5).map((t) => t.titre),
    rappelsDuJour: rappels
      .filter((r) => !r.fait && r.quand && r.quand >= maintenant - 6 * 3600_000 && heure(r.quand))
      .slice(0, 5)
      .map((r) => ({ texte: r.texte, heure: heure(r.quand) })),
    // Ce que Sam a déclaré compter (lib/priorites.js) : titre, pourquoi, et
    // « négligée depuis N jours » quand ses traces le montrent.
    ...(priorites?.priorites?.length
      ? { priorites: priorites.priorites.map(({ titre, pourquoi, negligeeDepuisJours }) => ({ titre, pourquoi, negligeeDepuisJours })) }
      : {}),
  };
}

/** Même clé = même situation : le conseil gardé reste valable. */
export function cleSituation(s, maintenant = Date.now()) {
  const { heure: _h, enCours, ...reste } = s;
  const base = JSON.stringify({ ...reste, enCours: enCours ? { titre: enCours.titre, fin: enCours.fin } : null, tranche: Math.floor(maintenant / TRANCHE_MS) });
  return crypto.createHash("sha1").update(base).digest("hex").slice(0, 16);
}

const SYSTEME = `Tu es Rémy, le directeur de cabinet de ${PRENOM}. Tu donnes UN conseil pour le moment présent, en français, en le tutoyant : une ou deux phrases, 220 caractères au plus, concrètes et réalistes.
Règles :
- Tiens compte de la nature des tâches. Une activité personnelle ou domestique (douche, ménage, aspirateur, repas, courses, sport) n'est pas un travail à « avancer » dans un trou de 20 minutes : ne la propose que si c'est vraiment le bon moment.
- Ne propose une tâche que si elle tient dans le temps disponible et a du sens maintenant ; sinon dis simplement ce que permet ce temps (finir, souffler, se préparer).
- Ne propose jamais une tâche « en attente » (liste « bloquees ») : ${PRENOM} attend quelque chose pour la faire.
- Un rendez-vous fixe proche compte : préparation, transition, trajet si un lieu est donné.
- « priorites » (s'il est là) : ce que ${PRENOM} a déclaré compter le plus, avec son pourquoi ; « negligeeDepuisJours » est un fait calculé. Relie le conseil à une priorité SEULEMENT si le lien est réel : la tâche proposée la sert (même projet, même domaine), ou le temps libre permet de reprendre une priorité négligée. Alors le premier « pourquoi » le dit avec ses mots à lui (« Tu as dit que … compte : … »), et « priorite » donne son titre exact. Sinon « priorite » vaut null : ne force jamais le lien.
- N'invente rien qui ne soit pas dans la situation. Pas de flatterie, pas de morale, pas de reproche.
Réponds UNIQUEMENT en JSON : {"conseil": "…", "pourquoi": ["raison courte tirée de la situation", "…"], "tache": "titre exact de la tâche proposée, ou null", "priorite": "titre exact de la priorité servie, ou null"}. « pourquoi » : 1 à 3 éléments de 90 caractères au plus.`;

const SCHEMA = {
  type: "object",
  properties: {
    conseil: { type: "string" },
    pourquoi: { type: "array", items: { type: "string" } },
    tache: { type: ["string", "null"] },
    priorite: { type: ["string", "null"] },
  },
  required: ["conseil", "pourquoi"],
};

/**
 * La réponse de GLM, nettoyée ; null si elle ne tient pas. `priorites` : les
 * titres déclarés — une priorité citée qui n'en fait pas partie est inventée,
 * elle est retirée (et le « pourquoi » qui la citait avec elle).
 */
export function lireReponse(texte, { priorites = null } = {}) {
  let j = null;
  try {
    j = JSON.parse(texte);
  } catch {
    const m = String(texte || "").match(/\{[\s\S]*\}/);
    if (m) {
      try {
        j = JSON.parse(m[0]);
      } catch {}
    }
  }
  const conseil = String(j?.conseil || "").replace(/\s+/g, " ").trim();
  if (!conseil) return null;
  const pourquoi = (Array.isArray(j.pourquoi) ? j.pourquoi : [])
    .map((p) => String(p || "").replace(/\s+/g, " ").trim().slice(0, 140))
    .filter(Boolean)
    .slice(0, 3);
  const tache = typeof j.tache === "string" && j.tache.trim() ? j.tache.trim().slice(0, 200) : null;
  const citee = typeof j.priorite === "string" ? j.priorite.trim() : "";
  const declaree = citee ? (priorites || []).find((t) => normaliser(t) === normaliser(citee)) : null;
  // Un lien vers une priorité qui n'existe pas : le « pourquoi » qui la cite part avec.
  const sansInvention = citee && !declaree ? pourquoi.filter((p) => !normaliser(p).includes(normaliser(citee))) : pourquoi;
  return { texte: conseil.slice(0, 320), pourquoi: sansInvention, tache, priorite: declaree || null };
}

// --- Cache et calcul ---------------------------------------------------------------

const gardes = new Map(); // type → { texte, pourquoi, tache, genereA, cle, source }
const enCours = new Map(); // type → promesse
const dernierAuto = new Map(); // type → ms
let chargeDepuisBase = false;

function charger() {
  if (chargeDepuisBase || !persister()) return;
  chargeDepuisBase = true;
  for (const type of Object.keys(TYPES)) {
    const i = instantanes.lire(`conseil:${type}`);
    if (i?.valeur?.texte) gardes.set(type, i.valeur);
  }
}

// Les priorités ne bloquent jamais le conseil : illisibles, il s'en passe.
async function prioritesSures(maintenant) {
  try {
    return await contextePriorites({ maintenant });
  } catch (err) {
    console.warn("Priorités illisibles pour le conseil :", err.message);
    return null;
  }
}

/** GLM peut-il conseiller (configuré, circuit allumé) ? La raison sinon. */
export async function disponibilite() {
  if (!glmConfigured()) return { disponible: false, raison: "Le modèle local (GLM) n'est pas configuré sur la tour." };
  if (!(await circuitActif("conseil"))) return { disponible: false, raison: "Conseil réfléchi coupé dans les Réglages." };
  return { disponible: true };
}

async function calculer(type, s, cle, { varier = false } = {}) {
  const fin = chrono("conseil.glm");
  const precedent = gardes.get(type);
  const prompt =
    `Type de conseil demandé : ${TYPES[type]}\n` +
    (varier && precedent?.texte ? `Propose autre chose que : « ${precedent.texte} »\n` : "") +
    `Situation (JSON) :\n${JSON.stringify(s)}`;
  try {
    if (!(await verifierGlm()).ok) throw new Error("GLM injoignable");
    const r = await glmProvider.complete({ system: SYSTEME, prompt, maxTokens: 600, schema: SCHEMA, delaiMs: 60_000 });
    logCost("conseil", "glm", r.model || libelleLocal(), r.usage, null, `Conseil · ${type}`).catch(() => {});
    const lu = lireReponse(r.text, { priorites: (s.priorites || []).map((p) => p.titre) });
    if (!lu) throw new Error("réponse illisible");
    const garde = { ...lu, type, genereA: Date.now(), cle, source: "glm", erreur: null };
    gardes.set(type, garde);
    if (persister()) instantanes.ecrire(`conseil:${type}`, garde);
    fin({ ok: true });
    return garde;
  } catch (err) {
    fin({ ok: false });
    console.warn(`Conseil « ${type} » non calculé :`, err.message);
    const g = gardes.get(type);
    if (g) gardes.set(type, { ...g, erreur: err.message });
    else gardes.set(type, { type, texte: null, pourquoi: [], tache: null, genereA: null, cle: null, source: null, erreur: err.message });
    throw err;
  }
}

/** Lance un calcul de fond (une fois à la fois par type). */
export function lancer(type, s, cle, { varier = false, auto = true } = {}) {
  if (enCours.has(type)) return enCours.get(type);
  if (auto) {
    if (Date.now() - (dernierAuto.get(type) || 0) < AUTO_MIN_MS) return null;
    dernierAuto.set(type, Date.now());
  }
  const p = calculer(type, s, cle, { varier })
    .catch(() => null)
    .finally(() => enCours.delete(type));
  enCours.set(type, p);
  return p;
}

/**
 * Ce que l'app affiche, tout de suite : le dernier conseil gardé (même ancien,
 * daté), s'il correspond encore à la situation, et si un calcul tourne. Si la
 * situation a changé, un nouveau calcul part derrière (GLM, jamais le cloud).
 */
export async function conseilPour(type, j, { maintenant = Date.now(), rappels = [], relancer = true } = {}) {
  charger();
  if (!TYPES[type]) type = "maintenant";
  const dispo = await disponibilite();
  const s = situation(j, { maintenant, rappels, priorites: await prioritesSures(maintenant) });
  const cle = cleSituation(s, maintenant);
  const g = gardes.get(type) || null;
  const aJour = Boolean(g?.texte && g.cle === cle);
  if (dispo.disponible && relancer && !aJour) lancer(type, s, cle);
  return {
    type,
    conseil: g?.texte ? { texte: g.texte, pourquoi: g.pourquoi, tache: g.tache, priorite: g.priorite || null, genereA: g.genereA, source: g.source } : null,
    aJour,
    enCours: enCours.has(type),
    disponible: dispo.disponible,
    raison: dispo.raison || (g?.erreur && !aJour ? `GLM n'a pas pu réfléchir (${g.erreur}).` : null),
  };
}

/** « Un autre conseil » : recalcul forcé, en demandant autre chose. */
export async function renouveler(type, j, { maintenant = Date.now(), rappels = [] } = {}) {
  charger();
  if (!TYPES[type]) type = "maintenant";
  const dispo = await disponibilite();
  if (!dispo.disponible) return { type, enCours: false, disponible: false, raison: dispo.raison };
  const s = situation(j, { maintenant, rappels, priorites: await prioritesSures(maintenant) });
  lancer(type, s, cleSituation(s, maintenant), { varier: true, auto: false });
  return { type, enCours: true, disponible: true };
}

export function _vider() {
  gardes.clear();
  enCours.clear();
  dernierAuto.clear();
  chargeDepuisBase = false;
}
