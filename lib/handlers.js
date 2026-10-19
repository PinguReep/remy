// Handlers de routes, partagés entre le serveur local (server.js) et Vercel (api/).

import crypto from "node:crypto";
import { sendJSON, readJSON, readRawBody, getIP, sameOrigin, securityHeaders, diagnosticProxy } from "./http.js";
import { requireAuth, attemptLogin, clearSessionCookie, authConfigured, estAutorise, estDirectLocal } from "./auth.js";
import { jetonDe, appareilDuJeton, emettre as emettreJeton, lister as listerAppareils, revoquer as revoquerAppareil } from "./appareils.js";
import * as store from "./store.js";
import { lireEtat, resumeEtat } from "./sauvegarde.js";
import { CIRCUITS, etatCircuits, etatJobs } from "./jobs.js";
import { appliquer, annuler, refuser, listerJournal, etatsPropositions, ErreurEcriture } from "./ecriture.js";
import { infosVersion, dernierBuildVu } from "./version.js";
import { streamReply, cerveau, lireAccordWeb } from "./chat.js";
import { arreterGeneration, attendreFin } from "./arret.js";
import { runReflection, suggestFocus } from "./reflection.js";
import { transcribeProvider, transcribe, transcriptionCloudBloquee, DICTEE_INDISPONIBLE } from "./transcribe.js";
import { providerName, verifierGlm, fournisseurDeFond, secoursCloudActif, reglagesCloud, SECOURS_COUPE } from "./providers.js";
import { coffre } from "./coffre.js";
import { motionSnapshot, applyActions, motionEnabled, tachesMotion, verifierMotion, motionLuA } from "./motion.js";
import { journee, resumeCouts, resumeMemoire, debutJour, finJour } from "./dashboard.js";
import { sessionsPubliques } from "./onboarding.js";
import { analyserCouverture } from "./couverture.js";
import { resume, horodate } from "./activite.js";
import { normaliserLot } from "./import.js";
import { itemsDe, avecEtats, ETATS } from "./briefing.js";
import { verifierPropositionMotion } from "./arbitrage.js";
import { nettoyerCapture, promptCapture, lireDistillation, PROMPT_CAPTURE, SCHEMA_CAPTURE } from "./capture.js";
import { getProvider } from "./providers.js";
import { logCost } from "./chat.js";
import {
  googleConfigured,
  googleConnecte,
  redirectUri,
  urlConnexion,
  echangerCode,
  deconnecter,
  appliquerAgenda,
  lireEvenement,
  agendaJournee,
} from "./google.js";

// Diagnostic de configuration — aucune valeur secrète n'est renvoyée, uniquement
// présent/absent. Public exprès : utile pour vérifier le setup avant que le mot de
// passe soit configuré.
// « Présente » ne veut pas dire « valide ». Une clé révoquée ou périmée passait
// le diagnostic au vert pendant que TOUT Rémy était en panne — c'est arrivé le
// 18/08, et ça a coûté trois faux diagnostics. On la teste pour de bon, contre
// l'endpoint le moins cher de l'API (liste des modèles, gratuit), avec un cache
// court : /api/health est public, il ne doit pas devenir un levier d'abus.
let cacheCle = { at: 0, verdict: null };

async function verifierCleAnthropic() {
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle && providerName() === "claude-code") return "— inutile : Claude passe par le CLI Claude Code (abonnement Max)";
  if (!cle) return "❌ absente";
  if (Date.now() - cacheCle.at < 60_000 && cacheCle.verdict) return cacheCle.verdict;
  let verdict;
  try {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": cle, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(6000),
    });
    verdict = r.ok
      ? "✅ valide"
      : r.status === 401
        ? "❌ REFUSÉE par Anthropic (clé invalide ou révoquée) — Rémy ne peut pas répondre"
        : `⚠️ réponse ${r.status} d'Anthropic`;
  } catch (err) {
    // Une panne réseau n'est pas une clé morte : ne pas accuser à tort.
    verdict = `⚠️ vérification impossible (${err.name === "TimeoutError" ? "délai dépassé" : err.message})`;
  }
  cacheCle = { at: Date.now(), verdict };
  return verdict;
}

export async function health(req, res) {
  // Sans session : « ok », rien d'autre — ni chemins disque, ni versions, ni
  // état des comptes branchés. Les détails : avec session, ou sur la tour.
  if (!estAutorise(req) && !estDirectLocal(req)) return sendJSON(res, 200, { ok: true });
  const onVercel = Boolean(process.env.VERCEL);
  const [cleAnthropic, motion, glm] = await Promise.all([
    verifierCleAnthropic(),
    verifierMotion(),
    verifierGlm({ maxAgeMs: 30_000 }),
  ]);
  return sendJSON(res, 200, {
    ok: true,
    stockage: store.redisConfig
      ? `✅ Redis connecté (via ${store.redisConfig.varName})`
      : onVercel
        ? "❌ Redis introuvable — les conversations seront PERDUES. Connecte la base Upstash au projet."
        : coffre()
          ? `✅ sur la tour — base ${store.dossierBase()}, coffre Obsidian ${coffre()}`
          : "fichier local (mode développement)",
    cle_api_anthropic: cleAnthropic,
    mot_de_passe: authConfigured() ? "✅ configuré" : "❌ pas encore configuré (APP_PASSWORD_HASH)",
    chiffrement_donnees: process.env.DATA_KEY
      ? "✅ activé"
      : coffre()
        ? "— lisible exprès (coffre Obsidian sur la tour, rien ne sort)"
        : "⚠️ désactivé (DATA_KEY absent)",
    session_secret: process.env.SESSION_SECRET ? "✅ présent" : "⚠️ absent (recommandé)",
    reflexion_nocturne: onVercel
      ? process.env.CRON_SECRET
        ? "✅ armée (cron 2h UTC)"
        : "⚠️ CRON_SECRET absent"
      : process.env.REMY_PLANIF === "off"
        ? "— coupée (REMY_PLANIF=off)"
        : `✅ planifiée sur la tour (${process.env.REMY_REFLEXION_HEURE ?? 4} h, heure de Paris)`,
    motion,
    agenda_google: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? "✅ configuré (connexion depuis l'onglet Onboarding)"
      : "— non configuré (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)",
    dictee_et_appel: (() => {
      const p = transcribeProvider();
      return p
        ? `✅ transcription via ${p.name} (${p.model})`
        : transcriptionCloudBloquee()
          ? "❌ Dictée Locale absente (DICTEE_LOCALE_URL) — et pas de cloud sans TRANSCRIPTION_CLOUD=on (D21)"
          : "❌ aucune clé (OPENAI_API_KEY, GROQ_API_KEY ou MISTRAL_API_KEY)";
    })(),
    moteur: providerName(),
    cerveau:
      cerveau() === "local"
        ? `local d'abord — GLM-5.3 sur les Sparks ; Claude pour chercher sur le web${(await secoursCloudActif()) ? " et en secours (activé)" : " ; secours cloud COUPÉ (D21)"}`
        : "Claude (REMY_GLM_URL absent ou REMY_CERVEAU=cloud)",
    glm_local: glm.verdict,
    version: (() => {
      const v = infosVersion();
      const app = dernierBuildVu();
      return `serveur ${v.serveur}${v.commit ? ` (${v.commit})` : ""} · API ${v.api}${app ? ` · app build ${app.build}` : ""}${v.appMin ? ` · build minimal ${v.appMin}` : ""}`;
    })(),
    sauvegardes: resumeEtat(lireEtat(store.dossierBase())),
    proxy: process.env.TRUST_PROXY
      ? "✅ TRUST_PROXY : l'adresse de chaque appareil vient de Tailscale Serve (dernière de X-Forwarded-For)"
      : diagnosticProxy.xffVu
        ? "⚠️ Tailscale Serve transmet l'adresse des appareils, mais TRUST_PROXY est absent : tous partagent les mêmes limites — pose TRUST_PROXY=1"
        : "— aucune adresse transmise par un proxy vue depuis le démarrage",
    travail_de_fond: await (async () => {
      try {
        const e = etatJobs();
        const coupes = Object.values(await etatCircuits()).filter((c) => !c.actif).map((c) => c.nom);
        const pb = e.problemes.map((p) => `${p.type} ${p.etat === "abandonne" ? "abandonné" : `en reprise (essai ${p.essais})`} : ${p.erreur}`);
        return [
          pb.length ? `⚠️ ${pb.join(" · ")}` : "✅ aucun échec en attente",
          coupes.length ? `coupé par Sam : ${coupes.join(", ")}` : null,
          `Sparks ${e.charge.taps + e.charge.fond}/${e.charge.max}${e.charge.surcharge ? " — saturées, fond différé" : ""}`,
        ].filter(Boolean).join(" · ");
      } catch (err) {
        return `❌ file des jobs illisible : ${err.message}`;
      }
    })(),
    integrite_base: (() => {
      const ko = store.fichiersIllisibles();
      return ko.length
        ? `❌ illisible, rien n'y est écrit : ${ko.map((k) => `${k.fichier} (${k.raison})`).join(", ")} — restaure une sauvegarde`
        : "✅ aucun fichier illisible détecté";
    })(),
    memoire: await (async () => {
      try {
        const n = ((await store.getMemory()).text || "").length;
        return n > store.MEMORY_MAX_CHARS
          ? `⚠️ ${n} caractères, au-delà de ${store.MEMORY_MAX_CHARS} : Rémy ne peut plus l'enrichir, raccourcis-la`
          : `✅ ${n} / ${store.MEMORY_MAX_CHARS} caractères`;
      } catch (err) {
        return `❌ ${err.message}`;
      }
    })(),
  });
}

const MAX_MESSAGES_PER_MIN = 15; // limite d'envoi de messages par IP (protège la facture API)
const MAX_ANALYSES_PER_HOUR = 8; // analyse d'onboarding : l'appel le plus cher, relit tout l'historique
const MAX_PINGS_PER_MIN = 20; // signes de vie : 1/min attendu, la marge couvre plusieurs appareils
const MAX_IMPORTS_PER_HOUR = 60; // un gros export part en plusieurs paquets
const MAX_IMPORT_LOT = 40; // conversations par paquet
const MAX_IMPORT_OCTETS = 4_000_000; // un paquet d'import pèse plus qu'un message
const MAX_CAPTURES_PER_HOUR = 40; // une capture = un appel IA : le raccourci ne doit pas s'emballer

export async function login(req, res) {
  const body = await readJSON(req).catch(() => ({}));
  return attemptLogin(req, res, body.password, { appareil: typeof body.appareil === "string" ? body.appareil : null });
}

export async function logout(req, res) {
  // L'iPhone qui se déconnecte rend aussi son jeton.
  try {
    const a = appareilDuJeton(jetonDe(req));
    if (a && sameOrigin(req)) revoquerAppareil(a.id);
  } catch (err) {
    console.warn("Jeton non révoqué à la déconnexion :", err.message);
  }
  clearSessionCookie(req, res);
  return sendJSON(res, 200, { ok: true });
}

// --- Appareils (J0.8b) : la liste, un jeton pour l'app déjà connectée, la révocation.

export async function getAppareils(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    return sendJSON(res, 200, { appareils: listerAppareils().map((a) => ({ ...a, actuel: a.id === req.appareil?.id })) });
  } catch (err) {
    return sendJSON(res, 503, { error: "appareils", message: `Liste des appareils indisponible : ${err.message}` });
  }
}

// L'app installée avant le Lot 0 n'a qu'un cookie : elle demande ici son
// jeton, sans redemander le mot de passe. Réservé à une session par cookie —
// un jeton ne peut pas en fabriquer d'autres (un jeton volé puis révoqué ne
// laisse pas de descendance).
export async function postAppareil(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  if (req.appareil) return sendJSON(res, 403, { error: "appareil", message: "Un appareil ne peut pas en connecter un autre." });
  const body = await readJSON(req).catch(() => ({}));
  try {
    const a = emettreJeton(typeof body.nom === "string" ? body.nom : "iPhone");
    return sendJSON(res, 200, { ok: true, jeton: a.jeton, appareil: { id: a.id, nom: a.nom } });
  } catch (err) {
    return sendJSON(res, 503, { error: "appareils", message: `Jeton non émis : ${err.message}` });
  }
}

// Ce qu'un jeton d'appareil ne peut pas faire (l'app iPhone n'en a pas
// besoin) : créer un accès qui survivrait à sa révocation (jeton de capture,
// connexion Google), ou emporter toutes les données (export). Depuis le site.
function reserveAuSite(req, res) {
  if (!req.appareil) return false;
  sendJSON(res, 403, { error: "appareil", message: "Depuis le site seulement (avec le mot de passe), pas depuis un appareil connecté par jeton." });
  return true;
}

export async function deleteAppareil(req, res, id) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  if (!revoquerAppareil(decodeURIComponent(id))) return sendJSON(res, 404, { error: "introuvable", message: "Appareil introuvable ou déjà déconnecté" });
  return sendJSON(res, 200, { ok: true });
}

export async function listConversations(req, res) {
  if (!requireAuth(req, res)) return;
  return sendJSON(res, 200, await store.listConversations());
}

export async function createConversation(req, res) {
  if (!requireAuth(req, res)) return;
  const body = await readJSON(req).catch(() => ({}));
  // Une conversation peut porter une session d'onboarding : Rémy reçoit alors
  // la consigne de clôture à CHAQUE message, sans que Sam la voie.
  const session = /^[a-z0-9-]{1,40}$/.test(String(body?.session || "")) ? body.session : null;
  // Une session n'a qu'UNE conversation. Si elle existe encore, on la rend
  // telle quelle au lieu d'en ouvrir une deuxième : c'est le serveur qui fait
  // foi, pas l'état du panneau (qui peut être périmé ou n'avoir jamais été
  // enregistré). Le client reconnaît une reprise à ses messages déjà présents.
  if (session) {
    const existante = await store.sessionConv(session);
    if (existante) return sendJSON(res, 200, existante);
  }
  const conv = {
    id: crypto.randomUUID(),
    title: "Nouvelle conversation",
    messages: [],
    ...(session ? { session, pinned: true } : {}),
    // Privée : jamais envoyée à Claude, même quand le modèle local est en panne.
    ...(body?.prive === true ? { prive: true } : {}),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await store.putConversation(conv);
  // Rattachement immédiat : la conversation d'une session ne peut plus être
  // orpheline, même si le panneau n'arrive jamais à enregistrer son état.
  if (session) {
    try {
      await store.attachSessionConv(session, conv.id);
    } catch (err) {
      console.warn("Session non rattachée :", err.message);
    }
  }
  return sendJSON(res, 201, conv);
}

export async function getConversation(req, res, id) {
  if (!requireAuth(req, res)) return;
  const conv = await store.getConversation(id);
  if (!conv) return sendJSON(res, 404, { error: "Conversation introuvable" });
  // L'état des propositions vient de la base (il fait foi), pas de la copie.
  return sendJSON(res, 200, etatsPropositions(conv));
}

export async function renameConversation(req, res, id) {
  if (!requireAuth(req, res)) return;
  const conv = await store.getConversation(id);
  if (!conv) return sendJSON(res, 404, { error: "Conversation introuvable" });
  const body = await readJSON(req).catch(() => ({}));

  // Épinglage : indépendant du renommage, les deux passent par ce PATCH.
  if (typeof body.pinned === "boolean") {
    conv.pinned = body.pinned;
  }

  // Rendre privée : à sens unique (comme les fils privés du fork). Ce qui a été
  // dit ici sous la promesse « ça reste chez moi » ne repart pas chez Claude
  // parce qu'un bouton a été décoché ; pour revenir au cloud, nouvelle conversation.
  if (body.prive === false && conv.prive) {
    return sendJSON(res, 400, { error: "Une conversation privée le reste — ouvre-en une nouvelle pour passer par Claude." });
  }
  if (body.prive === true) conv.prive = true;

  if (body.title !== undefined) {
    const title = String(body.title || "").trim();
    if (!title) return sendJSON(res, 400, { error: "Titre vide" });
    if (title.length > 80) return sendJSON(res, 400, { error: "Titre trop long (80 caractères max)" });
    conv.title = title;
    conv.renamed = true; // le premier message ne remplacera plus ce titre choisi
  } else if (typeof body.pinned !== "boolean" && body.prive !== true) {
    return sendJSON(res, 400, { error: "Rien à modifier" });
  }

  await store.putConversation(conv);
  return sendJSON(res, 200, {
    id: conv.id,
    title: conv.title,
    pinned: Boolean(conv.pinned),
    prive: Boolean(conv.prive),
    updatedAt: conv.updatedAt,
  });
}

export async function deleteConversation(req, res, id) {
  if (!requireAuth(req, res)) return;
  const ok = await store.deleteConversation(id);
  if (!ok) return sendJSON(res, 404, { error: "Conversation introuvable" });
  return sendJSON(res, 200, { ok: true });
}

export async function getMemory(req, res) {
  if (!requireAuth(req, res)) return;
  return sendJSON(res, 200, await store.getMemory());
}

export async function putMemory(req, res) {
  if (!requireAuth(req, res)) return;
  const body = await readJSON(req).catch(() => ({}));
  if (typeof body.text !== "string") return sendJSON(res, 400, { error: "Champ text manquant" });
  if (body.text.length > store.MEMORY_MAX_CHARS) {
    return sendJSON(res, 400, { error: `Mémoire trop longue (max ${store.MEMORY_MAX_CHARS} caractères)` });
  }
  return sendJSON(res, 200, await store.putMemory(body.text));
}

// La roadmap (constitution/roadmap.md) affichée dans l'app — lecture seule,
// la source de vérité reste le dépôt.
export async function getRoadmap(req, res) {
  if (!requireAuth(req, res)) return;
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const file = path.join(process.cwd(), "constitution", "roadmap.md");
  try {
    const text = await readFile(file, "utf8");
    return sendJSON(res, 200, { text });
  } catch {
    return sendJSON(res, 200, { text: "_Roadmap introuvable dans ce déploiement._" });
  }
}

export async function getBriefing(req, res) {
  if (!requireAuth(req, res)) return;
  const [current, history, etats] = await Promise.all([
    store.getBriefing(),
    store.listBriefings(),
    store.getBriefingEtats(),
  ]);
  return sendJSON(res, 200, {
    ...current,
    items: avecEtats(itemsDe(current.text), etats),
    history: history.map((b) => ({ ...b, items: avecEtats(itemsDe(b.text), etats) })),
  });
}

// Barrer un sujet (traité) ou l'écarter (pas pour moi). Un tap, pas de modèle.
export async function setBriefingEtat(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const body = await readJSON(req).catch(() => ({}));
  const id = String(body?.id || "").toLowerCase();
  const etat = String(body?.etat || "");
  if (!/^[a-f0-9]{10}$/.test(id)) return sendJSON(res, 400, { error: "Sujet inconnu" });
  if (!ETATS.includes(etat)) return sendJSON(res, 400, { error: "État inconnu" });
  try {
    const etats = await store.setBriefingEtat(id, etat);
    return sendJSON(res, 200, { id, etat, etats });
  } catch (err) {
    console.error("État de sujet non enregistré :", err.message);
    return sendJSON(res, 500, { error: "Enregistrement impossible — réessaie." });
  }
}

// Écran 📅 Aujourd'hui : le briefing de la nuit + le planning Motion, en un appel.
export async function getToday(req, res) {
  if (!requireAuth(req, res)) return;
  const [briefing, motion, etats] = await Promise.all([
    store.getBriefing(),
    motionSnapshot().catch((err) => {
      console.warn("Motion indisponible :", err.message);
      return "";
    }),
    store.getBriefingEtats().catch(() => ({})),
  ]);
  return sendJSON(res, 200, {
    briefing: { ...briefing, items: avecEtats(itemsDe(briefing.text), etats) },
    motion,
  });
}

// Le tableau de bord, en UN aller-retour : la journée (Motion + Google), la nuit,
// l'activité, l'onboarding, la mémoire, les coûts. Chaque bloc échoue SEUL —
// Motion en panne ne doit pas vider l'écran, il doit dire « Motion indisponible »
// dans sa case pendant que le reste s'affiche.
export async function getDashboard(req, res) {
  if (!requireAuth(req, res)) return;
  const maintenant = Date.now();
  // Une source lente ne retient pas l'écran : au-delà de 8 s, sa case dit
  // « indisponible » et le reste s'affiche.
  const lent = (p, ms = 8000) => {
    let t;
    return Promise.race([
      p,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error("délai dépassé")), ms); }),
    ]).finally(() => clearTimeout(t));
  };

  const [briefing, etats, taches, evenements, activite, setup, memoire, couts] = await Promise.allSettled([
    store.getBriefing(),
    store.getBriefingEtats(),
    // « frais=1 » : Sam a tiré pour rafraîchir — on relit Motion pour de bon.
    lent(tachesMotion({ frais: new URL(req.url, "http://x").searchParams.get("frais") === "1" })),
    lent(agendaJournee(debutJour(maintenant), finJour(maintenant))),
    store.listActivite(14, maintenant),
    store.getSetup(),
    store.getMemory(),
    store.listCostEntries(),
  ]);
  const val = (r, defaut = null) => (r.status === "fulfilled" ? r.value : defaut);
  const etatSource = (r, actif) => {
    if (r.status === "rejected") {
      console.warn("Tableau de bord — source indisponible :", r.reason?.message);
      return "erreur";
    }
    return actif && r.value !== null ? "ok" : "off";
  };

  const b = val(briefing, {});
  const mem = val(memoire, { text: "", updatedAt: null });
  return sendJSON(res, 200, {
    maintenant,
    briefing: b?.text || b?.generatedAt
      ? { text: b.text || "", generatedAt: b.generatedAt || null, items: avecEtats(itemsDe(b.text), val(etats, {})) }
      : null,
    journee: {
      ...journee({ taches: val(taches) || [], evenements: val(evenements) || [], maintenant }),
      sources: { motion: etatSource(taches, motionEnabled()), agenda: etatSource(evenements, googleConfigured()) },
      motionLuA: motionLuA() || null,
    },
    activite: activite.status === "fulfilled" ? resume(activite.value, { jours: 14, aujourdhui: horodate(maintenant).jour }) : null,
    setup: setup.status === "fulfilled" ? { ...setup.value, sessions: sessionsPubliques() } : null,
    memoire: { ...resumeMemoire(mem.text), updatedAt: mem.updatedAt || null },
    couts: couts.status === "fulfilled" ? resumeCouts(couts.value, maintenant) : null,
    systeme: {
      motion: motionEnabled(),
      agenda: googleConfigured(),
      transcription: Boolean(transcribeProvider()),
      reflexion: Boolean(process.env.CRON_SECRET),
    },
  });
}

// --- Écriture Motion : uniquement sur clic explicite de Sam --------------------
// Le modèle ne peut PAS atteindre ces routes : elles exigent une session
// authentifiée et une origine de confiance. Il propose, Sam dispose.

// --- Écritures Motion et agenda : la chaîne d'écriture (lib/ecriture.js) -------------

function repondreEcriture(res, err, source) {
  if (err instanceof ErreurEcriture) return sendJSON(res, err.statut, { error: err.code, message: err.message });
  console.error(`Écriture ${source} échouée :`, err);
  return sendJSON(res, 502, { error: source, message: err.message });
}

// D'où vient l'écriture, pour le journal : le chat ou un geste direct, et
// l'appareil (« tap · iPhone de Sam ») quand il s'est identifié par jeton.
const origineDe = (req, demande) => `${demande.convId ? "chat" : "tap"}${req.appareil ? ` · ${req.appareil.nom}` : ""}`;

// Le corps des anciennes routes : { actions, resume, convId, index } ; les
// nouveaux clients ajoutent propositionId et idCommande (clé d'idempotence
// d'un geste direct, rejouable sans double effet).
async function lireDemandeEcriture(req) {
  const body = await readJSON(req).catch(() => ({}));
  return {
    actions: Array.isArray(body.actions) ? body.actions : null,
    resume: String(body.resume || "").slice(0, 200),
    convId: typeof body.convId === "string" ? body.convId : null,
    index: Number.isInteger(body.index) ? body.index : null,
    propositionId: typeof body.propositionId === "string" ? body.propositionId : null,
    idCommande: typeof body.idCommande === "string" ? body.idCommande : null,
  };
}

export async function applyMotion(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const demande = await lireDemandeEcriture(req);
  if (!motionEnabled()) return sendJSON(res, 400, { error: "Motion n'est pas connecté" });
  try {
    const r = await appliquer({
      source: "motion",
      origine: origineDe(req, demande),
      ...demande,
      // Une tâche Motion n'a pas d'heure de début : sa structure ne le permet
      // pas. Si le modèle en a glissé une, il s'est trompé d'outil — l'appliquer
      // créerait une tâche que Motion déplacerait, et Sam raterait son RDV.
      valider: (actions) => {
        const { bloquants } = verifierPropositionMotion(actions);
        if (!bloquants.length) return null;
        console.warn("Proposition Motion refusée (confusion tâche/rendez-vous) :", bloquants[0].message);
        return bloquants[0].message + " Redemande à Rémy de le passer dans l'agenda.";
      },
      executer: applyActions,
    });
    return sendJSON(res, 200, r);
  } catch (err) {
    return repondreEcriture(res, err, "motion");
  }
}

export async function undoMotion(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const body = await readJSON(req).catch(() => ({}));
  try {
    return sendJSON(res, 200, await annuler({ source: "motion", journalId: body.id }));
  } catch (err) {
    return repondreEcriture(res, err, "motion");
  }
}

export async function getLedger(req, res) {
  if (!requireAuth(req, res)) return;
  return sendJSON(res, 200, { entries: listerJournal(200) });
}

// « Non merci » : enregistré, la proposition ne revient pas au rechargement.
export async function refuserProposition(req, res, convId, propositionId) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  try {
    return sendJSON(res, 200, await refuser({ convId, propositionId: decodeURIComponent(propositionId) }));
  } catch (err) {
    return repondreEcriture(res, err, "proposition");
  }
}

// Focus de la réflexion nocturne : la consigne one-shot que Sam peut donner
// avant la nuit (« occupe-toi de X »). Consommée par runReflection.
export async function getReflectionFocusState(req, res) {
  if (!requireAuth(req, res)) return;
  return sendJSON(res, 200, await store.getReflectionFocus());
}

export async function putReflectionFocusState(req, res) {
  if (!requireAuth(req, res)) return;
  const body = await readJSON(req).catch(() => ({}));
  if (typeof body.text !== "string") return sendJSON(res, 400, { error: "Champ text manquant" });
  if (body.text.length > 1000) return sendJSON(res, 400, { error: "Consigne trop longue (1000 caractères max)" });
  return sendJSON(res, 200, await store.putReflectionFocus(body.text));
}

// Pré-réflexion : Rémy propose les sujets de la nuit (max 3, ancrés sur des
// signaux réels). GET = suggestions conservées ; POST = en générer de nouvelles.
export async function getSuggestState(req, res) {
  if (!requireAuth(req, res)) return;
  return sendJSON(res, 200, await store.getReflectionSuggestions());
}

export async function postSuggest(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    return sendJSON(res, 200, await suggestFocus());
  } catch (err) {
    console.error("Pré-réflexion échouée :", err);
    return sendJSON(res, 502, {
      error: "suggest",
      message: err.message === SECOURS_COUPE ? SECOURS_COUPE : "Pré-réflexion impossible pour le moment — réessaie.",
    });
  }
}

// Panneau ⚙️ Configuration : quelles sessions guidées sont faites.
export async function getSetupState(req, res) {
  if (!requireAuth(req, res)) return;
  // Les sessions viennent du serveur : c'est lui qui analyse la couverture, le
  // client ne doit pas avoir sa propre copie de la liste (elles divergeraient).
  return sendJSON(res, 200, { ...(await store.getSetup()), sessions: sessionsPubliques() });
}

// « Combien de questions il reste » : Rémy relit ce que Sam lui a déjà dit et
// coche les repères. Toujours déclenché par Sam (un appel IA ne part jamais
// tout seul), et journalisé dans le panneau coûts.
// Auto-test de l'agenda : créer un événement, le relire, le supprimer. Trois
// appels réels, une trace lisible. C'est la seule façon de savoir si la chaîne
// entière marche — les identifiants sont bons, le jeton est valide, le scope
// autorise l'écriture — sans attendre le premier vrai rendez-vous.
export async function testerAgenda(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const count = await store.counterIncr(`remy:rl:gtest:${getIP(req)}`, 3600);
  if (count > 10) return sendJSON(res, 429, { error: "Trop de tests d'affilée." });

  const etapes = [];
  const note = (quoi, ok, detail) => etapes.push({ quoi, ok, detail: String(detail || "").slice(0, 200) });
  // Loin devant, à une heure improbable : même si la suppression échouait, ça
  // ne polluerait pas une vraie journée de Sam.
  const debut = new Date(Date.now() + 30 * 86_400_000);
  debut.setUTCHours(3, 0, 0, 0);
  // Titre unique : si un test précédent avait échoué à supprimer son événement,
  // le garde-fou anti-doublon bloquerait tous les suivants.
  const titre = `Rémy — test de connexion ${crypto.randomBytes(2).toString("hex")} (à ignorer)`;
  let id = null;
  try {
    const [cree] = await appliquerAgenda([
      { type: "creer", titre, debut: debut.toISOString(), duree: "15", description: "Créé puis supprimé automatiquement par Rémy." },
    ]);
    if (!cree?.ok) throw new Error(cree?.erreur || "création refusée");
    id = cree.eventId;
    note("Création", true, `« ${titre} » le ${debut.toLocaleDateString("fr-FR")}`);
  } catch (err) {
    note("Création", false, err.message);
    return sendJSON(res, 200, { ok: false, etapes });
  }

  try {
    // Par identifiant, pas via l'instantané : celui-ci ne couvre que 7 jours, et
    // l'événement de test est volontairement placé loin devant.
    const ev = await lireEvenement(id);
    const bon = ev?.summary === titre;
    note("Relecture", bon, bon ? "l'événement est bien dans l'agenda de Google" : `retrouvé sous un autre nom : « ${ev?.summary} »`);
  } catch (err) {
    note("Relecture", false, err.message);
  }

  try {
    const [sup] = await appliquerAgenda([{ type: "supprimer", id, titre }]);
    if (!sup?.ok) throw new Error(sup?.erreur || "suppression refusée");
    note("Suppression", true, "l'agenda est revenu à son état d'origine");
  } catch (err) {
    // Le pire cas : on a créé sans pouvoir supprimer. Il faut le dire, avec de
    // quoi retrouver l'événement à la main.
    note("Suppression", false, `${err.message} — supprime-le à la main : « ${titre} », le ${debut.toLocaleDateString("fr-FR")}`);
  }
  return sendJSON(res, 200, { ok: etapes.every((e) => e.ok), etapes });
}

// --- Capture : « donne ça à Rémy », en un geste ----------------------------------
//
// Aucune API ne permet de lire les conversations ChatGPT ou Claude. Le seul
// chemin temps réel est que Sam pousse la matière — depuis la feuille de
// partage de son iPhone (raccourci + jeton) ou en la collant dans l'app.
//
// Rémy absorbe en silence : pas de conversation ouverte, pas de question posée.

const MODELE_CAPTURE = process.env.REMY_CAPTURE_MODEL || "claude-sonnet-5";

export async function capturer(req, res) {
  // Deux entrées : la session de l'app (Sam colle un texte) ou le jeton du
  // raccourci iPhone (aucun cookie ne peut voyager depuis la feuille de partage).
  const porteur = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const parJeton = porteur ? await store.jetonCaptureValide(porteur) : false;
  if (!parJeton) {
    if (!requireAuth(req, res)) return;
    if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  }

  const count = await store.counterIncr(`remy:rl:cap:${getIP(req)}`, 3600);
  if (count > MAX_CAPTURES_PER_HOUR) {
    return sendJSON(res, 429, { error: "Trop de captures d'affilée — réessaie dans un moment." });
  }

  const body = await readJSON(req, 200_000).catch(() => null);
  if (!body) return sendJSON(res, 413, { error: "Texte trop volumineux" });
  const { capture, raison } = nettoyerCapture(body.texte, {
    source: body.source,
    titre: body.titre,
  });
  if (!capture) return sendJSON(res, 400, { error: raison });

  try {
    const provider = fournisseurDeFond();
    const memoire = await store.getMemory();
    const reqId = crypto.randomUUID();
    const { text, usage, model, stopReason } = await provider.complete({
      system: PROMPT_CAPTURE,
      prompt: promptCapture(memoire.text, capture),
      model: MODELE_CAPTURE,
      // Même précaution que partout : de la place pour la réflexion ET la
      // réponse, un effort borné, et un schéma pour que la forme soit sûre.
      maxTokens: 12_000,
      effort: "low",
      schema: SCHEMA_CAPTURE,
    });
    await logCost("capture", provider.name, model, usage, reqId, capture.titre || "Capture");

    let brut = null;
    try {
      const t = (text || "").trim();
      const d = t.indexOf("{");
      const f = t.lastIndexOf("}");
      if (d !== -1 && f > d) brut = JSON.parse(t.slice(d, f + 1));
    } catch {}
    const distille = lireDistillation(brut, memoire.text);
    if (!distille) {
      console.warn(
        "Capture non distillée (%d caractères, stop=%s) — mémoire inchangée, capture conservée.",
        (text || "").length, stopReason || "?",
      );
      // La capture est gardée quand même : la réflexion nocturne la relira, et
      // Sam n'aura pas à repousser le même texte.
      await store.addCapture({ ...capture, ajouts: [] });
      return sendJSON(res, 200, { ok: true, ajouts: [], memoire: false });
    }

    try {
      await store.putMemory(distille.memoire);
    } catch (err) {
      if (err.code !== "MEMOIRE_TROP_LONGUE") throw err;
      // Mémoire pleine : la capture est gardée (la nuit la relira), la mémoire
      // reste telle quelle, et Sam le sait.
      console.warn("Capture : mémoire NON réécrite —", err.message);
      await store.addCapture({ ...capture, ajouts: [] });
      return sendJSON(res, 200, { ok: true, ajouts: [], memoire: false, message: "Mémoire pleine : capture gardée, mémoire inchangée." });
    }
    await store.addCapture({ ...capture, ajouts: distille.ajouts });
    return sendJSON(res, 200, { ok: true, ajouts: distille.ajouts, memoire: true });
  } catch (err) {
    console.error("Capture échouée :", err.message);
    // Le texte n'est jamais perdu : gardé tel quel, la réflexion de la nuit le
    // relira. Et Sam sait pourquoi il n'a pas été absorbé tout de suite.
    const pourquoi =
      err.message === SECOURS_COUPE
        ? "la tour (GLM) ne répond pas et le secours Claude est coupé"
        : "le modèle n'a pas répondu";
    const garde = await store.addCapture({ ...capture, ajouts: [] }).then(() => true, () => false);
    if (garde) {
      return sendJSON(res, 200, { ok: true, ajouts: [], memoire: false, message: `Pas absorbé tout de suite (${pourquoi}) : Rémy le relira cette nuit.` });
    }
    return sendJSON(res, 502, { error: "capture", message: `Rémy n'a pas pu garder ce texte (${pourquoi}) — réessaie.` });
  }
}

// Le jeton du raccourci iPhone. Il n'est montré qu'à sa création : ensuite, on
// ne sait plus que sa date et sa dernière utilisation.
export async function etatJetonCapture(req, res) {
  if (!requireAuth(req, res)) return;
  return sendJSON(res, 200, { jeton: await store.jetonCaptureExiste() });
}

export async function creerJetonCapture(req, res) {
  if (!requireAuth(req, res)) return;
  if (reserveAuSite(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const jeton = await store.nouveauJetonCapture();
  return sendJSON(res, 200, { jeton, avertissement: "Ce jeton ne sera plus jamais affiché." });
}

export async function supprimerJetonCapture(req, res) {
  if (!requireAuth(req, res)) return;
  if (reserveAuSite(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  await store.revoquerJetonCapture();
  return sendJSON(res, 200, { ok: true });
}

export async function listerCaptures(req, res) {
  if (!requireAuth(req, res)) return;
  const captures = await store.listCaptures(20);
  // L'extrait complet n'a rien à faire dans une liste : on rend de quoi
  // reconnaître la capture, pas de quoi la relire.
  return sendJSON(res, 200, captures.map((c) => ({
    at: c.at, source: c.source, titre: c.titre,
    apercu: (c.extrait || "").slice(0, 160),
    ajouts: c.ajouts || [],
  })));
}

// --- Import des conversations d'ailleurs (ChatGPT, Claude) -----------------------

// Le navigateur envoie les conversations BRUTES qu'il a cochées, par paquets
// (le corps d'une requête est plafonné). Toute la lecture de format se fait ici,
// où elle est testée.
export async function importerConversations(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const count = await store.counterIncr(`remy:rl:imp:${getIP(req)}`, 3600);
  if (count > MAX_IMPORTS_PER_HOUR) {
    return sendJSON(res, 429, { error: "Trop d'imports d'affilée — réessaie dans un moment." });
  }

  let body;
  try {
    body = await readJSON(req, MAX_IMPORT_OCTETS);
  } catch {
    return sendJSON(res, 413, {
      error: "Paquet trop gros — réduis le nombre de conversations cochées d'un coup.",
    });
  }
  const brutes = Array.isArray(body?.conversations) ? body.conversations : null;
  if (!brutes) return sendJSON(res, 400, { error: "Aucune conversation reçue" });
  if (brutes.length > MAX_IMPORT_LOT) return sendJSON(res, 400, { error: "Trop de conversations d'un coup" });

  try {
    // Deux imports du même export ne doivent pas créer de doublons.
    const dejaVues = new Set(
      (await store.listConversations()).map((c) => c.origine?.cle).filter(Boolean),
    );
    const { ok, ignorees } = normaliserLot(brutes, { dejaVues });
    const importees = [];
    for (const c of ok) {
      const conv = {
        id: crypto.randomUUID(),
        title: c.titre,
        messages: c.messages,
        createdAt: c.creeA || Date.now(),
        // Fraîche dans Rémy, datée d'origine à l'affichage : elle remonte en tête
        // de la liste (Sam vient de l'ajouter) sans mentir sur son âge.
        updatedAt: Date.now(),
        renamed: true,
        origine: { ...c.origine, importeA: Date.now(), tronquee: c.tronquee },
      };
      await store.putConversation(conv);
      importees.push({ id: conv.id, titre: conv.title, messages: conv.messages.length });
    }
    return sendJSON(res, 200, { importees, ignorees });
  } catch (err) {
    console.error("Import de conversations échoué :", err.message);
    return sendJSON(res, 500, { error: "Import impossible pour le moment — réessaie." });
  }
}

// --- Activité : présence et messages, jour par jour ------------------------------

// Signe de vie du navigateur. Zéro appel IA, zéro contenu : un créneau de
// 5 minutes. Le rate limit protège d'un onglet qui s'emballerait.
export async function pingActivite(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const count = await store.counterIncr(`remy:rl:act:${getIP(req)}`, 60);
  if (count > MAX_PINGS_PER_MIN) return sendJSON(res, 429, { error: "Trop de signaux" });
  try {
    const rec = await store.pingActivite();
    return sendJSON(res, 200, { jour: rec.jour, creneaux: rec.creneaux.length, messages: rec.messages });
  } catch (err) {
    // Une mesure qui tombe ne doit pas remonter comme une panne à l'écran.
    console.warn("Ping d'activité échoué :", err.message);
    return sendJSON(res, 200, { jour: horodate().jour, creneaux: 0, messages: 0, degrade: true });
  }
}

export async function getActivite(req, res) {
  if (!requireAuth(req, res)) return;
  const url = new URL(req.url, `http://${req.headers.host || "local"}`);
  const demande = parseInt(url.searchParams.get("jours") || "14", 10);
  const jours = Math.min(Math.max(Number.isFinite(demande) ? demande : 14, 1), 90);
  try {
    const cartes = await store.listActivite(jours);
    return sendJSON(res, 200, resume(cartes, { jours, aujourdhui: horodate().jour }));
  } catch (err) {
    console.error("Lecture de l'activité échouée :", err.message);
    return sendJSON(res, 500, { error: "Activité illisible pour le moment." });
  }
}

export async function analyseOnboarding(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  // C'est l'appel IA le plus cher de l'app (il relit tout l'historique) : le
  // bouton se désactive côté écran, mais la facture ne doit pas dépendre de ça.
  const count = await store.counterIncr(`remy:rl:onb:${getIP(req)}`, 3600);
  if (count > MAX_ANALYSES_PER_HOUR) {
    return sendJSON(res, 429, {
      error: "Trop d'analyses en peu de temps — réessaie dans un moment.",
    });
  }
  const t0 = Date.now();
  try {
    const { couverture, vide } = await analyserCouverture();
    return sendJSON(res, 200, { couverture, vide, analyseA: Date.now() });
  } catch (err) {
    // Le message du fournisseur peut contenir du JSON brut : Sam n'a pas à le
    // lire dans un bandeau. Il part dans les logs, pas à l'écran.
    console.warn("Analyse d'onboarding échouée :", err.message);
    // Chaque cause a sa phrase : « réessaie » sur un refus enverrait Sam
    // retaper indéfiniment un bouton qui ne peut pas marcher.
    const propre =
      err.message === SECOURS_COUPE
        ? SECOURS_COUPE
        : err.message === "REFUS"
          ? "Rémy a préféré ne pas rendre cette analyse. Tes pourcentages avancent quand même au fil des sessions."
          : err.message === "TROP_LONG"
            ? "L'analyse a été coupée avant la fin — réessaie."
            : /illisible/i.test(err.message || "")
              ? "Rémy a mal rendu son analyse — réessaie."
              : "Analyse impossible pour le moment — réessaie.";
    // Le détail technique part AUSSI à l'écran, derrière un repli : sans accès
    // aux logs Vercel, c'est le seul moyen de diagnostiquer sans deviner.
    return sendJSON(res, 502, {
      error: propre,
      detail: `${err.detail || err.message || "?"} — ${Math.round((Date.now() - t0) / 1000)} s`,
    });
  }
}

// « Marquer à refaire » sur une section : la jauge repart de zéro. Seul geste
// qui RETIRE de la couverture, et il vient de Sam.
export async function viderCouvertureSection(req, res, id) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const couverture = await store.viderCouverture(id);
  if (couverture === null) return sendJSON(res, 400, { error: "Section inconnue" });
  return sendJSON(res, 200, { couverture });
}

// --- Google Calendar : connexion, agenda, écriture validée ----------------------

// L'état de connexion, pour l'écran. Aucun jeton n'en sort jamais.
export async function googleStatus(req, res) {
  if (!requireAuth(req, res)) return;
  return sendJSON(res, 200, {
    configure: googleConfigured(),
    connecte: await googleConnecte(),
    retour: redirectUri(req),
  });
}

// Départ du consentement Google. Le `state` est signé côté serveur et rejoué au
// retour : sans lui, n'importe qui pourrait brancher SON agenda sur l'app.
export async function googleAuth(req, res) {
  if (!requireAuth(req, res)) return;
  if (reserveAuSite(req, res)) return;
  if (!googleConfigured()) return sendJSON(res, 400, { error: "Identifiants Google absents (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)" });
  const state = crypto.randomBytes(16).toString("hex");
  await store.counterReset(`remy:gstate:${state}`);
  await store.counterIncr(`remy:gstate:${state}`, 600); // valable 10 minutes
  return sendJSON(res, 200, { url: urlConnexion(req, state) });
}

// Retour de Google : c'est le navigateur de Sam qui arrive ici, pas un appel
// de l'app — on répond donc une page, pas du JSON.
export async function googleCallback(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "local"}`);
  const page = (titre, detail) => {
    securityHeaders(res);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<style>body{font-family:system-ui;background:#12100e;color:#efe9e2;display:grid;place-items:center;height:100dvh;margin:0;text-align:center;padding:24px}` +
        `a{color:#e07a4a}</style><div><h2>${titre}</h2><p>${detail}</p><p><a href="/">Revenir à Rémy</a></p></div>`,
    );
  };
  try {
    const state = url.searchParams.get("state") || "";
    // Un `state` inconnu ou périmé = ce n'est pas nous qui avons lancé la
    // connexion : on refuse.
    if (!/^[a-f0-9]{32}$/.test(state) || !(await store.counterGet(`remy:gstate:${state}`))) {
      return page("Connexion refusée", "Le jeton de sécurité est absent ou périmé. Relance la connexion depuis l'app.");
    }
    await store.counterReset(`remy:gstate:${state}`);
    const code = url.searchParams.get("code");
    if (!code) return page("Connexion annulée", url.searchParams.get("error") || "Aucun code reçu.");
    await echangerCode(req, code);
    return page("Agenda connecté ✓", "Rémy voit tes rendez-vous et peut t'en proposer de nouveaux.");
  } catch (err) {
    console.error("Connexion Google échouée :", err);
    return page("Connexion échouée", "Réessaie depuis l'app. Le détail est dans les logs.");
  }
}

export async function googleDeconnexion(req, res) {
  if (!requireAuth(req, res)) return;
  if (reserveAuSite(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  await deconnecter();
  return sendJSON(res, 200, { ok: true, connecte: false });
}

// Écriture d'agenda : même contrat que Motion — jamais le modèle, toujours un
// tap de Sam, et tout est annulable.
export async function applyAgenda(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  if (!(await googleConnecte())) return sendJSON(res, 400, { error: "Google Calendar n'est pas connecté" });
  const demande = await lireDemandeEcriture(req);
  try {
    return sendJSON(res, 200, await appliquer({ source: "agenda", origine: origineDe(req, demande), ...demande, executer: appliquerAgenda }));
  } catch (err) {
    return repondreEcriture(res, err, "agenda");
  }
}

export async function undoAgenda(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const body = await readJSON(req).catch(() => ({}));
  try {
    return sendJSON(res, 200, await annuler({ source: "agenda", journalId: body.id }));
  } catch (err) {
    return repondreEcriture(res, err, "agenda");
  }
}

export async function putSetupState(req, res) {
  if (!requireAuth(req, res)) return;
  const body = await readJSON(req).catch(() => ({}));
  if (!body || typeof body !== "object" || (!body.etats && !body.convs)) {
    return sendJSON(res, 400, { error: "Rien à enregistrer" });
  }
  return sendJSON(res, 200, await store.putSetup(body));
}

// Réflexion nocturne : déclenchée par le cron Vercel (Authorization: Bearer CRON_SECRET)
// ou manuellement depuis une session authentifiée.
export async function reflectionJob(req, res) {
  // Depuis le 08/10, Rémy vit sur la tour : la réflexion de nuit y tourne, en
  // local. L'ancienne app Vercel ne relit plus rien et n'envoie plus rien chez
  // Claude toute seule (Sam, 14/10 : aucun envoi automatique au cloud).
  if (process.env.VERCEL) {
    return sendJSON(res, 410, { error: "La réflexion de nuit tourne sur la tour, plus sur Vercel." });
  }
  const secret = process.env.CRON_SECRET;
  const auth = String(req.headers.authorization || "");
  const sha = (s) => crypto.createHash("sha256").update(s).digest();
  const fromCron = Boolean(secret) && crypto.timingSafeEqual(sha(auth), sha(`Bearer ${secret}`));
  if (!fromCron && !requireAuth(req, res)) return;
  try {
    const result = await runReflection();
    return sendJSON(res, 200, result);
  } catch (err) {
    console.error("Réflexion nocturne échouée :", err);
    return sendJSON(res, 500, { error: "Réflexion nocturne échouée", message: err.message });
  }
}

// Sonde de capacité : le client choisit entre transcription serveur (qualité
// Whisper) et reconnaissance du navigateur selon la réponse.
export async function transcribeProbe(req, res) {
  if (!requireAuth(req, res)) return;
  const p = transcribeProvider();
  return sendJSON(res, 200, {
    available: Boolean(p),
    provider: p?.name || null,
    model: p?.model || null,
    // La reconnaissance vocale DU NAVIGATEUR envoie l'audio chez Google
    // (Chrome) ou Apple : un tiers. Interdite sauf accord explicite (D21).
    navigateur: process.env.TRANSCRIPTION_NAVIGATEUR === "on",
    raison: p ? null : DICTEE_INDISPONIBLE,
  });
}

export async function transcribeAudio(req, res) {
  if (!requireAuth(req, res)) return;
  const provider = transcribeProvider();
  if (!provider) {
    return sendJSON(res, 400, {
      error: "no_provider",
      message: transcriptionCloudBloquee() ? DICTEE_INDISPONIBLE : "Aucun moteur de transcription configuré.",
    });
  }

  // Plafond adapté au mode appel (une transcription par prise de parole).
  const count = await store.counterIncr(`remy:rl:stt:${getIP(req)}`, 3600);
  if (count > 120) {
    return sendJSON(res, 429, { error: "rate", message: "Beaucoup de dictées d'un coup — réessaie dans un moment." });
  }

  const url = new URL(req.url, "http://local");
  const mime = (url.searchParams.get("type") || "audio/mp4").slice(0, 60);
  const seconds = Math.min(600, Math.max(0, parseFloat(url.searchParams.get("dur")) || 0));

  let buffer;
  try {
    buffer = await readRawBody(req, 4_500_000);
  } catch (err) {
    // Ne pas mettre toutes les erreurs dans le même sac : « trop gros » a un
    // message dédié, le reste (réseau coupé, corps malformé) est signalé tel quel.
    if (/Corps trop grand/.test(err.message || "")) {
      return sendJSON(res, 413, { error: "too_large", message: "Enregistrement trop long (4 Mo max, ~3 minutes)." });
    }
    console.warn("Lecture de l'audio échouée :", err.message);
    return sendJSON(res, 400, { error: "bad_body", message: "Audio non reçu en entier — réessaie." });
  }
  if (!buffer || buffer.length < 1000) {
    return sendJSON(res, 400, { error: "empty", message: "Audio vide ou trop court." });
  }

  try {
    const text = await transcribe(buffer, mime, provider);
    // L'audio n'est pas conservé ; on journalise seulement le coût estimé.
    try {
      await store.addCostEntry({
        ts: Date.now(),
        reqId: crypto.randomUUID(),
        label: "Dictée vocale",
        kind: "dictée",
        provider: provider.name,
        model: provider.model,
        in: 0,
        out: 0,
        usd: Math.round((seconds / 60) * provider.usdPerMin * 1e6) / 1e6,
      });
    } catch (err) {
      console.warn("Coût de la dictée non journalisé :", err.message);
    }
    return sendJSON(res, 200, { text });
  } catch (err) {
    console.error("Transcription échouée :", err.message);
    return sendJSON(res, 502, {
      error: "transcribe",
      message: provider.locale
        ? "Dictée Locale ne répond pas — vérifie que l'app tourne sur la tour (icône près de l'horloge)."
        : "Transcription impossible pour le moment.",
    });
  }
}

// Migration vers la tour : tout ce que Rémy sait, déchiffré, en un JSON. Session
// obligatoire ; jamais mis en cache. Contient le jeton Google : le script de
// migration le lit en mémoire et ne l'écrit nulle part ailleurs que dans la base.
export async function exporter(req, res) {
  if (!requireAuth(req, res)) return;
  if (reserveAuSite(req, res)) return;
  try {
    const tout = await store.exporterTout();
    res.setHeader("Content-Disposition", `attachment; filename="remy-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return sendJSON(res, 200, tout);
  } catch (err) {
    console.error("Export échoué :", err);
    return sendJSON(res, 500, { error: "Export impossible — réessaie.", message: err.message });
  }
}

// Réglages de Sam (Lot 0) : aujourd'hui le secours Claude (D21). Effectif =
// réglage de l'app OU REMY_SECOURS_CLOUD=on sur la tour (le second ne se coupe
// pas depuis l'app : il a été posé exprès sur la machine).
export async function getReglagesHandler(req, res) {
  if (!requireAuth(req, res)) return;
  return sendJSON(res, 200, await vueReglages());
}

export async function putReglagesHandler(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const body = await readJSON(req).catch(() => null);
  const secours = body?.secoursCloud;
  const circuits = body?.circuits;
  const web = body?.rechercheWeb;
  const contexte = body?.contexteCloud;
  const booleenOuAbsent = (v) => v === undefined || typeof v === "boolean";
  const circuitsValides =
    circuits === undefined ||
    (circuits && typeof circuits === "object" && !Array.isArray(circuits) &&
      Object.entries(circuits).every(([k, v]) => k in CIRCUITS && typeof v === "boolean"));
  const rien = [secours, circuits, web, contexte].every((v) => v === undefined);
  if (!body || rien || ![secours, web, contexte].every(booleenOuAbsent) || !circuitsValides) {
    return sendJSON(res, 400, {
      error: `Attendu : secoursCloud, rechercheWeb, contexteCloud (true | false) et/ou { circuits: { ${Object.keys(CIRCUITS).join(" | ")}: true | false } }`,
    });
  }
  await store.putReglages({ secoursCloud: secours, circuits, rechercheWeb: web, contexteCloud: contexte });
  if (typeof web === "boolean") console.warn(`Réglage : recherche web ${web ? "permise (sur autorisation)" : "COUPÉE"} par Sam`);
  if (typeof contexte === "boolean") console.warn(`Réglage : envoi de contexte au cloud ${contexte ? "AUTORISÉ" : "coupé"} par Sam`);
  // Journalisés : ce sont des choix de Sam sur ce que Rémy fait sans lui.
  if (typeof secours === "boolean") console.warn(`Réglage : secours Claude ${secours ? "ACTIVÉ" : "coupé"} par Sam`);
  for (const [k, v] of Object.entries(circuits || {})) console.warn(`Réglage : circuit « ${CIRCUITS[k]} » ${v ? "allumé" : "COUPÉ"} par Sam`);
  return sendJSON(res, 200, await vueReglages());
}

async function vueReglages() {
  const r = await store.getReglages();
  const parEnv = process.env.REMY_SECOURS_CLOUD === "on";
  return {
    secoursCloud: parEnv || r.secoursCloud === true,
    secoursCloudReglage: r.secoursCloud === true,
    secoursCloudForceParLaTour: parEnv,
    // Sans GLM, Claude EST le cerveau : le réglage ne change rien.
    secoursCloudSansObjet: cerveau() !== "local",
    // Ce que Rémy fait sans qu'on le lui demande, circuit par circuit (J0.9).
    circuits: await etatCircuits(),
    // Recherche web (V8) : chaque recherche demande l'accord de Sam ; ce
    // réglage dit si elle existe, l'autre si le contexte part avec elle.
    ...(await (async () => {
      const c = await reglagesCloud();
      return { rechercheWeb: c.rechercheWeb, rechercheWebCoupeeParLaTour: c.rechercheWebCoupeeParLaTour, contexteCloud: c.contexteCloud };
    })()),
  };
}

export async function getCosts(req, res) {
  if (!requireAuth(req, res)) return;
  const entries = await store.listCostEntries();
  const now = Date.now();
  const startOfDay = debutJour(now); // minuit à Paris, pas minuit UTC du serveur
  const totals = { today: 0, days7: 0, days30: 0, all: 0 };
  for (const e of entries) {
    const usd = e.usd || 0;
    totals.all += usd;
    if (e.ts >= startOfDay) totals.today += usd;
    if (e.ts >= now - 7 * 86400_000) totals.days7 += usd;
    if (e.ts >= now - 30 * 86400_000) totals.days30 += usd;
  }
  return sendJSON(res, 200, { entries: entries.slice(0, 200), totals });
}

// Génère un APP_PASSWORD_HASH depuis le navigateur (page /hash.html) — pratique
// depuis un téléphone. Aucune donnée n'est stockée ; pas d'authentification requise
// (l'endpoint ne révèle rien), mais limité en débit.
export async function hashPassword(req, res) {
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "origin" });
  const count = await store.counterIncr(`remy:rl:hash:${getIP(req)}`, 60);
  if (count > 10) return sendJSON(res, 429, { error: "rate", message: "Trop de tentatives, réessaie dans une minute." });

  const body = await readJSON(req).catch(() => ({}));
  const pwd = String(body.password || "");
  if (pwd.length < 8) return sendJSON(res, 400, { error: "short", message: "Vise au moins 12 caractères (8 minimum)." });

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pwd, salt, 64).toString("hex");
  return sendJSON(res, 200, { hash: `scrypt:${salt}:${hash}` });
}

export async function postMessage(req, res, id) {
  if (!requireAuth(req, res)) return;

  const count = await store.counterIncr(`remy:rl:msg:${getIP(req)}`, 60);
  if (count > MAX_MESSAGES_PER_MIN) {
    return sendJSON(res, 429, { error: "rate", message: "Trop de messages d'un coup, souffle un peu 😉" });
  }

  const body = await readJSON(req).catch(() => ({}));
  const text = (body.text || "").trim();
  if (!text) return sendJSON(res, 400, { error: "Message vide" });
  if (text.length > 50_000) return sendJSON(res, 400, { error: "Message trop long" });

  // Une réponse s'écrit encore dans ce fil : elle enregistre la conversation
  // entière en finissant, et effacerait ce message. On la laisse finir.
  if (!(await attendreFin(id))) {
    return sendJSON(res, 409, {
      error: "occupe",
      message: "Rémy répond encore dans cette conversation — attends la fin, ou interromps-le.",
    });
  }
  // Relue APRÈS l'attente : elle contient la réponse qui vient de finir.
  const conv = await store.getConversation(id);
  if (!conv) return sendJSON(res, 404, { error: "Conversation introuvable" });

  // Rémy attendait un accord pour chercher sur le web : « oui » / « non » y
  // répond (l'app déjà installée n'a pas encore les boutons). Toute autre
  // question remplace la demande, qui expire.
  const derniere = conv.messages.at(-1);
  const attente = derniere?.role === "assistant" && derniere.autorisation?.statut === "en_attente" ? derniere.autorisation : null;
  if (attente) {
    const accord = lireAccordWeb(text);
    if (accord !== null) {
      const index = conv.messages.length - 1;
      attente.statut = accord ? "acceptee" : "refusee";
      conv.messages.push({ role: "user", content: text });
      conv.updatedAt = Date.now();
      await store.putConversation(conv);
      return streamReply(res, conv, { reprise: { accord, index, requete: attente.requete, contexte: attente.contexte === true, parTexte: true }, session: conv.session || null });
    }
    attente.statut = "expiree";
  }

  conv.messages.push({ role: "user", content: text });
  // Titre provisoire immédiat (extrait du message) ; le vrai titre — un résumé
  // généré par un mini-modèle — arrive à la fin de la première réponse.
  const autoTitle = conv.messages.length === 1 && !conv.renamed;
  if (autoTitle) {
    conv.title = text.length > 60 ? text.slice(0, 57) + "…" : text;
  }
  conv.updatedAt = Date.now();
  await store.putConversation(conv);
  // Compter le message ne doit jamais empêcher de répondre : c'est une mesure,
  // pas une fonction.
  store.noterMessage().catch((e) => console.warn("Activité non enregistrée :", e.message));

  return streamReply(res, conv, { call: Boolean(body.call), autoTitle, session: conv.session || null });
}

// Réponse de Sam à une demande d'autorisation (recherche web, V8) : la
// réponse suit en flux, comme un message. Seule la DERNIÈRE demande du fil
// peut être acceptée — une question posée depuis l'a remplacée.
export async function repondreAutorisation(req, res, convId, autorisationId) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const body = await readJSON(req).catch(() => ({}));
  if (typeof body.accord !== "boolean") return sendJSON(res, 400, { error: "Attendu : { accord: true | false }" });
  if (!(await attendreFin(convId))) {
    return sendJSON(res, 409, { error: "occupe", message: "Rémy répond encore dans cette conversation — attends la fin." });
  }
  const conv = await store.getConversation(convId);
  if (!conv) return sendJSON(res, 404, { error: "Conversation introuvable" });
  const index = conv.messages.findIndex((m) => m?.autorisation?.id === autorisationId);
  if (index < 0) return sendJSON(res, 404, { error: "introuvable", message: "Demande introuvable dans cette conversation" });
  const a = conv.messages[index].autorisation;
  if (a.statut !== "en_attente") {
    return sendJSON(res, 409, { error: "deja", message: a.statut === "expiree" ? "Cette demande a expiré : repose ta question." : "Tu as déjà répondu à cette demande." });
  }
  if (index !== conv.messages.length - 1) {
    a.statut = "expiree";
    await store.putConversation(conv);
    return sendJSON(res, 409, { error: "expiree", message: "Cette demande a expiré : repose ta question." });
  }
  a.statut = body.accord ? "acceptee" : "refusee";
  conv.updatedAt = Date.now();
  await store.putConversation(conv);
  console.warn(`Recherche web ${body.accord ? "AUTORISÉE" : "refusée"} par Sam${a.contexte ? " (avec contexte)" : " (question seule)"}`);
  return streamReply(res, conv, { reprise: { accord: body.accord, index, requete: a.requete, contexte: a.contexte === true }, session: conv.session || null });
}

// « Interrompre » : coupe la réponse en cours de CE fil. Rend la main une fois
// la réponse partielle enregistrée — le client peut alors envoyer son message
// suivant sans risque de l'écraser. Rien en cours : ce n'est pas une erreur.
export async function stopConversation(req, res, id) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const arrete = await arreterGeneration(id);
  return sendJSON(res, 200, { ok: true, arrete });
}
