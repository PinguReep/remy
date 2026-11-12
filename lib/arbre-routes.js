// Les routes de l'arbre des projets et du verrou (12/11, capacités arbre-v1
// et verrou-v1). La logique vit dans lib/arbre.js (fiches, déductions sans
// IA) et lib/verrou.js (la ré-authentification récente).
//
// Derrière le verrou (vérifié ICI, sur la tour, à chaque appel) : ce qui
// montre ce que la MÉMOIRE de Rémy dit de Sam.
//   GET  /api/compris                     ce que Rémy tient pour vrai, nœud par nœud, avec sa mémoire
//   (et, dans handlers.js : GET/PUT /api/memory, GET /api/export)
// En accès normal (l'écran Projets et la conversation en ont besoin en
// permanence ; verrouiller une copie de ce qui s'y affiche ne protégerait rien) :
//   GET  /api/noeuds                      l'arbre et ses fiches (sans rien tiré de la mémoire)
//   GET  /api/noeuds/:noeud/historique    l'historique de la fiche d'un nœud
//   PUT  /api/noeuds/:noeud/fiche         confirmer, corriger, écarter
//   PUT  /api/conversations/:id/noeud     rattacher une conversation
//   POST /api/noeuds/:noeud/resume-local  le modèle local propose « où on en est » (geste, coupable)
//   GET|POST|DELETE /api/verrou           l'état, déverrouiller, reverrouiller

import { sendJSON, readJSON, sameOrigin } from "./http.js";
import { requireAuth } from "./auth.js";
import * as store from "./store.js";
import { db, lireJSON } from "./db.js";
import * as A from "./arbre.js";
import * as carnet from "./carnet.js";
import { lirePriorites } from "./priorites.js";
import { motionEnabled, tachesMotion, projetsMotion } from "./motion.js";
import { normTache } from "./dashboard.js";
import { etatVerrou, exigerDeverrouillage, deverrouiller, reverrouiller } from "./verrou.js";
import { circuitActif } from "./jobs.js";
import { glmConfigured, verifierGlm, libelleLocal, nomModeleLocal } from "./glm.js";
import { glmProvider } from "./providers.js";
import { logCost } from "./chat.js";
import { counterIncr } from "./store.js";

export const LIMITES_ARBRE = "Rémy déduit à partir de Motion, de ce qui passe par lui et de ta mémoire. Il ne sait pas qu'une branche est finie, ni ce qui avance ailleurs (du code dans Claude Code ou T3, un coup de fil).";

function lent(p, ms = 8000) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error("délai dépassé")), ms); })]).finally(() => clearTimeout(t));
}
const val = (r, defaut = null) => (r.status === "fulfilled" ? r.value : defaut);

function erreur(res, err) {
  if (err instanceof A.ErreurArbre || err instanceof carnet.ErreurCarnet) return sendJSON(res, err.statut, { error: "arbre", message: err.message });
  throw err;
}

/** Tout ce que l'arbre lit, en une fois. Motion en panne n'enlève que ses faits. */
async function contexte({ maintenant = Date.now() } = {}) {
  const avecMotion = motionEnabled();
  const [taches, projets, convs, memoire] = await Promise.allSettled([
    avecMotion ? lent(tachesMotion()) : Promise.resolve(null),
    avecMotion ? lent(projetsMotion({ maintenant })) : Promise.resolve(null),
    store.listConversations(),
    store.getMemory(),
  ]);
  const brutes = val(taches) || [];
  let annotees = brutes;
  try {
    annotees = carnet.annoterTaches(brutes, { maintenant });
  } catch (err) {
    console.warn("Arbre : dépendances illisibles :", err.message);
  }
  let dossiers = [];
  const rattachements = new Map();
  const coches = [];
  try {
    const d = db();
    dossiers = d.prepare(`SELECT d.id, d.nom, d.parent, d.projet_motion AS projetMotion,
        MAX(d.maj_a, COALESCE(MAX(n.maj_a), 0), COALESCE((SELECT MAX(r.maj_a) FROM rattachements r WHERE r.dossier = d.id), 0)) AS dernier,
        SUM(CASE WHEN n.fait = 0 AND n.supprime = 0 THEN 1 ELSE 0 END) AS ouvertes
      FROM dossiers d LEFT JOIN notes_dossier n ON n.dossier = d.id WHERE d.supprime = 0 GROUP BY d.id ORDER BY d.ordre, d.cree_a`).all();
    for (const r of d.prepare("SELECT tache_id, dossier FROM rattachements").all()) rattachements.set(r.tache_id, r.dossier);
    // Les coches de la chaîne d'écriture (comme la revue de la semaine) : le
    // résultat dit ce qui a été terminé, l'action d'origine en garde l'identifiant.
    for (const r of d.prepare("SELECT ts, actions, results FROM journal WHERE ts >= ? AND annule = 0 AND source = 'motion' AND etat IN ('appliquee', 'appliquee_partiellement') ORDER BY ts DESC LIMIT 400").all(maintenant - 90 * 86_400_000)) {
      const actions = lireJSON(r.actions, []);
      const resultats = lireJSON(r.results, []);
      (Array.isArray(resultats) ? resultats : []).forEach((x, i) => {
        const a = Array.isArray(actions) ? actions[i] : null;
        if (!x?.ok || (x.type || a?.type) !== "terminer") return;
        const id = x.id || x.avant?.id || a?.id || null;
        const nom = x.nom || x.avant?.name || a?.nom || null;
        const projet = x.projet || x.avant?.project?.name || a?.projet || null;
        coches.push({ a: r.ts, nom: nom ? String(nom).slice(0, 200) : null, id: id ? String(id) : null, projet: projet ? String(projet) : null });
      });
    }
  } catch (err) {
    console.warn("Arbre : base de la tour illisible :", err.message);
  }
  // Ce que Sam a dit des projets entiers (« attend… », « C'est fini ») : projets-bloques-v1.
  let marques = new Map();
  try {
    marques = carnet.marquesNoeuds(brutes);
  } catch (err) {
    console.warn("Arbre : blocages des projets illisibles :", err.message);
  }
  let liens = new Map();
  try {
    liens = A.conversationsParNoeud();
  } catch (err) {
    console.warn("Arbre : rattachements des conversations illisibles :", err.message);
  }
  const projetsLus = val(projets)?.projets || [];
  const priorites = lirePriorites().priorites;
  // Le nom d'un projet Motion que la liste n'a pas rendu : celui qu'une priorité a gardé.
  const nomsMotion = new Map(priorites.filter((p) => p.projetMotion && p.projetNom).map((p) => [String(p.projetMotion), p.projetNom]));
  return {
    motion: avecMotion ? (taches.status === "rejected" || projets.status === "rejected" ? "erreur" : "ok") : "off",
    projets: projetsLus.map((p) => ({ id: p.id, nom: p.nom, statut: p.statut })),
    dossiers,
    taches: annotees.map(normTache).filter(Boolean),
    rattachements,
    coches,
    conversations: (val(convs) || []).filter((c) => !c.systeme).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, prive: c.prive })),
    liens,
    marques,
    nomsMotion,
    priorites,
    memoire: val(memoire)?.text || "",
    memoireA: val(memoire)?.updatedAt || null,
  };
}

const decoder = (v) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return "";
  }
};

// GET /api/noeuds : l'arbre et ses fiches. Ce qui vient de la mémoire n'y est que compté.
export async function getNoeuds(req, res) {
  if (!requireAuth(req, res)) return;
  const maintenant = Date.now();
  const ctx = await contexte({ maintenant });
  let fiches = new Map();
  try {
    fiches = A.lireFiches();
  } catch (err) {
    return sendJSON(res, 503, { error: "base", message: `Les fiches de l'arbre sont illisibles (base de la tour) : ${err.message}` });
  }
  return sendJSON(res, 200, {
    noeuds: A.arbre(ctx, { fiches, maintenant }),
    motion: ctx.motion,
    calculeA: maintenant,
    limites: LIMITES_ARBRE,
    verrou: etatVerrou(req),
  });
}

// PUT /api/noeuds/:noeud/fiche { pourquoi?, etat?, point?, ecarter? } — clé absente = inchangé.
export async function putFiche(req, res, n) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const corps = await readJSON(req).catch(() => null);
  try {
    return sendJSON(res, 200, { ok: true, fiche: A.ecrireFiche(decoder(n), corps) });
  } catch (err) {
    return erreur(res, err);
  }
}

// GET /api/noeuds/:noeud/historique — l'historique de la fiche, ouvert comme la fiche.
export async function getHistoriqueNoeud(req, res, n) {
  if (!requireAuth(req, res)) return;
  try {
    return sendJSON(res, 200, { noeud: decoder(n), historique: A.historique(decoder(n)) });
  } catch (err) {
    return erreur(res, err);
  }
}

// GET /api/compris — derrière le verrou : l'arbre avec ce que la mémoire en dit,
// les priorités et l'historique récent de chaque nœud.
export async function getCompris(req, res) {
  if (!requireAuth(req, res)) return;
  if (!exigerDeverrouillage(req, res)) return;
  const maintenant = Date.now();
  const ctx = await contexte({ maintenant });
  let fiches = new Map();
  try {
    fiches = A.lireFiches();
  } catch (err) {
    return sendJSON(res, 503, { error: "base", message: `Les fiches de l'arbre sont illisibles (base de la tour) : ${err.message}` });
  }
  const noeuds = A.arbre(ctx, { fiches, maintenant, avecMemoire: true }).map((x) => {
    let h = [];
    try {
      h = A.historique(x.noeud, { limite: 5 });
    } catch {}
    return { ...x, historique: h };
  });
  const lu = lirePriorites();
  const memoireUtilisee = new Set(noeuds.flatMap((x) => (x.memoire || []).map((m) => m.texte))).size;
  return sendJSON(res, 200, {
    noeuds,
    priorites: {
      classeA: lu.classeA,
      classees: lu.priorites.filter((p) => p.classee === true).map((p, i) => ({ rang: i + 1, titre: p.titre, pourquoi: p.pourquoi || "", projetNom: p.projetNom || null })),
      ecrites: lu.priorites.filter((p) => p.classee !== true).map((p) => ({ titre: p.titre, pourquoi: p.pourquoi || "" })),
    },
    memoire: { majA: ctx.memoireA, lignesUtilisees: memoireUtilisee, vide: !ctx.memoire.trim() },
    motion: ctx.motion,
    calculeA: maintenant,
    limites: LIMITES_ARBRE,
    verrou: etatVerrou(req),
  });
}

// PUT /api/conversations/:id/noeud { noeud | null }
export async function putNoeudConversation(req, res, id) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const convId = decoder(id);
  const corps = await readJSON(req).catch(() => null);
  if (!corps || typeof corps !== "object" || !Object.prototype.hasOwnProperty.call(corps, "noeud")) return sendJSON(res, 400, { error: "arbre", message: "Attendu : { noeud } (null pour détacher)" });
  const conv = await store.getConversation(convId).catch(() => null);
  if (!conv) return sendJSON(res, 404, { error: "Conversation introuvable" });
  try {
    return sendJSON(res, 200, A.rattacherConversation(convId, corps.noeud, { origine: "geste" }));
  } catch (err) {
    return erreur(res, err);
  }
}

// POST /api/noeuds/:noeud/resume-local { conversation } : le modèle LOCAL
// propose « où on en est » d'après une conversation rattachée. Un geste de Sam,
// jamais automatique ; coupable (circuit « arbre ») ; journalisé (kind
// « arbre ») ; jamais de secours cloud : sans le modèle local, rien.
const MAX_RESUMES_HEURE = 20;
const SYSTEME_RESUME = `Tu lis une conversation entre Sam et son assistant à propos d'un projet. Dis en UNE phrase (200 caractères au plus) où en est ce projet d'après cette conversation : ce qui est fait, ce qui reste. N'invente rien : si la conversation ne le dit pas, réponds exactement « Rien de clair ». Réponds en français, sans guillemets ni préambule.`;

export async function postResumeLocal(req, res, n) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const id = decoder(n);
  if (!A.noeudValide(id)) return sendJSON(res, 400, { error: "arbre", message: "nœud invalide" });
  if (!(await circuitActif("arbre"))) return sendJSON(res, 403, { error: "coupe", message: "Coupé dans Réglages › Rémy (« Résumer une conversation de l'arbre »)." });
  if (!glmConfigured()) return sendJSON(res, 503, { error: "local", message: "Le modèle local n'est pas configuré sur la tour : rien n'est envoyé ailleurs." });
  const corps = await readJSON(req).catch(() => ({}));
  const convId = String(corps?.conversation || "");
  if (A.noeudDeConversation(convId) !== id) return sendJSON(res, 400, { error: "arbre", message: "Cette conversation n'est pas rattachée à ce nœud." });
  const conv = await store.getConversation(convId).catch(() => null);
  if (!conv) return sendJSON(res, 404, { error: "Conversation introuvable" });
  if ((await counterIncr("remy:arbre:resume", 3600)) > MAX_RESUMES_HEURE) return sendJSON(res, 429, { error: "limite", message: "Assez de résumés pour cette heure : réessaie plus tard." });
  if (!(await verifierGlm()).ok) return sendJSON(res, 503, { error: "local", message: `${nomModeleLocal({ maj: true })} ne répond pas : rien n'est envoyé ailleurs, réessaie plus tard.` });
  const messages = (conv.messages || []).filter((m) => typeof m?.content === "string" && m.content.trim()).slice(-12);
  if (!messages.length) return sendJSON(res, 400, { error: "arbre", message: "Cette conversation est vide : rien à résumer." });
  let texte = messages.map((m) => `${m.role === "user" ? "Sam" : "Assistant"} : ${m.content.replace(/\s+/g, " ").slice(0, 900)}`).join("\n");
  if (texte.length > 8000) texte = texte.slice(-8000);
  let r;
  try {
    r = await glmProvider.complete({ system: SYSTEME_RESUME, prompt: texte, maxTokens: 300, delaiMs: 90_000 });
  } catch (err) {
    return sendJSON(res, 503, { error: "local", message: `Le modèle local n'a pas pu résumer (${err.message}) : rien n'est envoyé ailleurs.` });
  }
  logCost("arbre", "glm", r.model || libelleLocal(), r.usage, null, "Arbre · où on en est").catch(() => {});
  const phrase = String(r.text || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\s+/g, " ").replace(/^[«"\s]+|[»"\s]+$/g, "").trim().slice(0, 240);
  if (!phrase || /^rien de clair/i.test(phrase)) return sendJSON(res, 200, { proposition: null, message: "Le modèle local n'a rien trouvé de clair dans cette conversation." });
  return sendJSON(res, 200, {
    proposition: { champ: "point", texte: phrase, origine: "deduit", source: `résumé par le modèle local de la conversation « ${String(conv.title || "Sans titre").slice(0, 60)} »` },
  });
}

// --- Le verrou ---

export async function verrou(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method === "GET") return sendJSON(res, 200, etatVerrou(req));
  if (req.method === "POST") return deverrouiller(req, res);
  if (req.method === "DELETE") return reverrouiller(req, res);
  return sendJSON(res, 405, { error: "methode" });
}
