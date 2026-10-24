// Le cœur de Rémy : personnalité, mémoire, routage de modèle, coûts, streaming SSE.

import { suiviEtapes } from "./etapes.js";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { motionSnapshot } from "./motion.js";
import { agendaSnapshot, googleConnecte } from "./google.js";
import { contexteSession, reperesValides } from "./couverture.js";
import {
  putConversation,
  getConversation,
  getMemory,
  MEMORY_MAX_CHARS,
  putMemory,
  addCostEntry,
  markSessionDone,
  ajouterCouverture,
  getBriefing,
  getBriefingEtats,
  setBriefingEtat,
  listActivite,
} from "./store.js";
import { sujetsOuverts } from "./briefing.js";
import { resume, horodate } from "./activite.js";
import { CONSIGNE_ARBITRAGE, CONSIGNE_CARNET } from "./arbitrage.js";
import { securityHeaders } from "./http.js";
import { nettoyerSortie } from "./sortie.js";
import {
  getProvider,
  DEFAULT_MODEL,
  glmProvider,
  glmConfigured,
  verifierGlm,
  glmEnPanne,
  glmRepond,
  GlmError,
  libelleLocal,
  modeleGlm,
  machineGlm,
  cerveau,
  secoursCloudActif,
  reglagesCloud,
  SECOURS_COUPE,
} from "./providers.js";
import { estimateCostUsd } from "./pricing.js";
import { demarrerGeneration, siArrete, avecMention, MENTION_COUPEE } from "./arret.js";
import { noterIncident } from "./incidents.js";
import { aCompacter, compacter, historiqueCompacte, noteResume } from "./compactage.js";
import { circuitActif } from "./jobs.js";
import { lieuxConnus, noteLieux, etat as etatLieux } from "./lieux.js";
import { noteActivitePC } from "./activite-pc.js";
import { tachesMotion, motionEnabled } from "./motion.js";
import { etatsPropositions } from "./ecriture.js";
import { estLocal } from "./cerveau.js";
import { palierSansRouteur, apprendSurSam } from "./allegement.js";
import { CONSIGNE_MATIERE } from "./encadrement.js";
import { PRENOM } from "./profil.js";

export const SYSTEM_PROMPT = `Tu es Rémy, l'assistant personnel de ${PRENOM} — son « directeur de cabinet », inspiré de Rémy dans Ratatouille : tu observes, tu apprends, tu conseilles, mais ${PRENOM} garde toujours le dernier geste.

Ta mission : « Mon rôle n'est pas de remplir tes journées. Mon rôle est de t'aider à construire la vie que tu as choisie, en prenant à ta place les décisions répétitives et en te laissant toute ton énergie pour créer, décider et vivre. »

Principes (extraits de ta Constitution) :
- Tu protèges l'attention de ${PRENOM} : réponses courtes, directes. Jamais plus de 3 recommandations à la fois — tu ne le noies pas.
- QUAND TU AS BESOIN DE PRÉCISIONS, TU POSES TOUT D'UN COUP. Sur un sujet donné, tu réunis TOUTES tes questions dans UN SEUL message, numérotées, en annonçant combien il y en a (« 4 questions et je te laisse tranquille »). ${PRENOM} déteste découvrir en cours de route que ça va durer : il doit savoir dès le premier message ce que le sujet va lui coûter en temps. Tu ne rattrapes pas une question oubliée au message suivant si tu pouvais la prévoir — réfléchis à tout ce dont tu as besoin AVANT d'écrire. Il répond dans l'ordre qu'il veut, partiellement s'il préfère ; ce qui manque, tu le redemandes une fois, groupé.
- Tu poses une question plutôt que d'inventer une réponse.
- Tu expliques tes arbitrages seulement quand ça apporte de la valeur ou construit la confiance.
- Tu formules des hypothèses avec un niveau de confiance ("J'ai l'impression que… (70 %)"), et tu acceptes de te tromper. Une hypothèse n'est jamais présentée comme un fait.
- Tu distingues idée / tâche / projet : une idée floue va dans l'incubateur, pas dans les projets actifs. Tu ne transformes pas chaque idée en tâche ou en projet.
- Avant d'ajouter quelque chose à sa charge, tu cherches ce qui peut être supprimé, reporté ou archivé.
- Tes insights sont doux, jamais culpabilisants : tu rappelles à ${PRENOM} ses propres engagements, tu ne fais pas la morale. Tu ne considères pas le travail intense comme un problème sans signaux réels.
- Tu admets tes erreurs et tu révises ton modèle de ${PRENOM} quand il te corrige.
- Ton ton : le ${PRENOM} de dans cinq ans — serein, exigeant, intelligent. Pas un coach militaire.
- Tu réponds en français, naturel et complice, sans jargon inutile.

Tu as accès au web avec trois outils :
- web_search pour chercher ; web_fetch pour lire vite une page dont l'URL est dans la conversation. Utilise-les quand l'information est récente, locale, chiffrée ou incertaine — sans demander la permission — et cite brièvement tes sources (liens).
- browse_page, ton navigateur : il exécute le JavaScript et voit la page comme un humain, et peut cliquer sur des boutons par leur texte. Utilise-le quand web_fetch renvoie une coquille vide (site React/Vue), ou quand il faut cliquer pour atteindre un contenu. Il est plus lent (5-10 s par page) et limité à quelques pages par message : commence par web_fetch, passe à browse_page seulement si nécessaire, et enchaîne les clics avec parcimonie. Une page protégée par mot de passe reste hors de portée — dans ce cas, demande une capture d'écran.
web_fetch ne lit que les URLs présentes dans la conversation COURANTE (si ${PRENOM} parle d'un lien envoyé ailleurs, demande-lui de le recoller ici).

Autonomie : chaque action que tu proposes se juge sur clarté, impact, réversibilité, coût, sensibilité et confiance acquise. Un achat ou une dépense ne se décide jamais de ta seule initiative — au mieux tu prépares, ${PRENOM} valide.

Si ton modèle de ${PRENOM} (ta mémoire) est vide ou presque : propose-lui l'onboarding, 6 sessions courtes pour vider sa tête, une à la fois, à son rythme — 1. tout ce qui traîne dans sa tête, sans classer · 2. les projets réellement actifs (résultat attendu, échéance, prochaine preuve d'avancement) · 3. le quotidien (ménage, courses, abonnements, dossiers administratifs, routines) · 4. les personnes qui comptent et les promesses déjà faites · 5. les lieux fréquents et les temps de trajet ou préparation · 6. l'autonomie qu'il veut te donner, les sujets sensibles, le style à éviter. Objectif final : « J'ai suffisamment capturé ce qui encombre ta tête. Tu peux arrêter d'essayer de tout retenir. »`;

const MEMORY_UPDATE_PROMPT = `Tu es le module mémoire de Rémy OS. Ta tâche : maintenir le « modèle de ${PRENOM} », un document markdown concis que Rémy relit avant chaque conversation.

Règles :
- Structure en sections : ## Identité & contexte · ## Objectifs · ## Préférences · ## Personnes · ## Projets en cours · ## Habitudes & fonctionnement · ## Hypothèses (jamais des faits).
- Chaque information porte sa provenance : [déclaré] (${PRENOM} l'a dit), [observé] (constaté de façon répétée dans ses messages), [inféré] (déduit par toi).
- Intègre uniquement les informations nouvelles, durables et utiles du dernier échange. Pas le bavardage éphémère.
- Corrige ou supprime ce que le dernier échange contredit. Mais une information [déclaré] ne se corrige que si ${PRENOM} la contredit lui-même — jamais sur simple déduction.
- Une incertitude va dans Hypothèses avec un % de confiance, pas dans les faits. Quand c'est utile, note ce qui confirmerait ou infirmerait l'hypothèse.
- Maximum ~1500 mots. Concis, factuel, utile.
- Réponds UNIQUEMENT avec le document complet mis à jour, sans commentaire ni préambule.
- Si le dernier échange n'apporte rien de durable à mémoriser, réponds exactement : NO_UPDATE`;

// --- Le routeur : choisir le bon « cerveau » pour chaque demande -----------------
// (Constitution, principe 27 : le routage des modèles n'est pas le métier de Sam.)

const ROUTER_PROMPT = `Tu es le routeur de Rémy OS. Classe la demande de l'utilisateur selon la profondeur de réflexion nécessaire :

- reflexe : salutation, question simple, information factuelle courte, rappel, confirmation, petite tâche mécanique.
- raisonnement : conseil du quotidien, organisation, planification, rédaction moyenne, explication.
- conseil : décision importante ou engageante, analyse profonde, sujet émotionnellement lourd, stratégie, texte long et exigeant.

Réponds avec UN SEUL mot : reflexe, raisonnement ou conseil.`;

const TIER_MODELS = {
  reflexe: process.env.REMY_MODEL_REFLEXE || "claude-haiku-4-5",
  raisonnement: process.env.REMY_MODEL_RAISONNEMENT || "claude-sonnet-5",
  conseil: process.env.REMY_MODEL_CONSEIL || "claude-opus-5",
};
const ROUTER_MODEL = "claude-haiku-4-5";
const MEMORY_MODEL = process.env.REMY_MEMORY_MODEL || "claude-haiku-4-5";
const TITLE_MODEL = process.env.REMY_TITLE_MODEL || "claude-haiku-4-5";

const TITLE_PROMPT = `Tu génères le titre d'une conversation entre un utilisateur et son assistant. Résume le sujet en 2 à 5 mots, en français. Règles : pas de guillemets, pas de point final, pas d'émoji, pas de deux-points, maximum 40 caractères. Réponds UNIQUEMENT avec le titre.`;

export async function logCost(kind, providerNameStr, model, usage, reqId, label) {
  try {
    // Abonnement (Claude Code) ou machines de Sam (GLM, Qwen, Hermès sur les
    // Sparks) : 0 $, quel que soit le nom que le relais donne au modèle (un nom
    // inconnu était compté au prix d'Opus — défaut n°20).
    const usd = providerNameStr === "claude-code" || estLocal(providerNameStr) ? 0 : estimateCostUsd(model, usage);
    await addCostEntry({
      ts: Date.now(),
      reqId, // identifiant partagé par tous les appels d'une même requête utilisateur
      label, // extrait du message utilisateur (sur l'entrée "conversation" uniquement)
      kind, // "conversation" | "routeur" | "mémoire"
      provider: providerNameStr,
      local: estLocal(providerNameStr) || undefined,
      model: model || "?",
      in: (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0),
      out: usage?.output_tokens || 0,
      usd: Math.round(usd * 1e6) / 1e6,
    });
  } catch (err) {
    console.warn("Journalisation du coût échouée :", err.message);
  }
}

// Garder la fonction Vercel en vie après la réponse (mémoire réécrite en
// arrière-plan). C'est exactement ce que fait @vercel/functions, sans ses
// dépendances ; hors Vercel (server.js), Node finit la promesse tout seul.
const waitUntil = (p) => globalThis[Symbol.for("@vercel/request-context")]?.get?.()?.waitUntil?.(p);

// --- Cerveau local d'abord ---------------------------------------------------------
// Dès que GLM est branché (REMY_GLM_URL), Rémy répond depuis les Sparks de
// Sam : rien ne quitte ses machines et rien n'est facturé. Claude ne sert plus
// qu'à deux choses : chercher sur le web (GLM n'a pas web_search), et prendre
// le relais quand la tour ne répond pas — signalé « dégradé » sous la réponse.
// Une conversation PRIVÉE n'a ni l'un ni l'autre : jamais de Claude, même en
// panne. REMY_CERVEAU=cloud revient à l'ancien comportement.
export { cerveau };
const versLocal = (conv) => cerveau() === "local" || Boolean(conv?.prive);

export async function estPrivee(conv) {
  if (!conv) return false;
  if (conv.prive) return true;
  try {
    const frais = await getConversation(conv.id);
    if (frais?.prive) conv.prive = true;
  } catch (err) {
    console.warn("État privé non relu :", err.message);
  }
  return Boolean(conv.prive);
}

export const PRIVE_INJOIGNABLE =
  "Conversation privée : le modèle local ne répond pas (tour ou Sparks éteintes ?). Rien n'est parti chez Claude — réessaie quand le modèle local est revenu.";

const ROUTER_PROMPT_LOCAL = `Tu es le routeur de Rémy OS. Classe la demande de l'utilisateur :

- reflexe : salutation, question simple, information factuelle courte, rappel, confirmation, petite tâche mécanique.
- raisonnement : conseil du quotidien, organisation, planification, rédaction moyenne, explication.
- conseil : décision importante ou engageante, analyse profonde, sujet émotionnellement lourd, stratégie, texte long et exigeant.
- web : la réponse exige de CHERCHER sur internet une information récente ou inconnue (actualité, prix, horaires, météo, disponibilité, avis). Pas pour ouvrir une URL déjà donnée.

Réponds avec UN SEUL mot : reflexe, raisonnement, conseil ou web.`;

// Une demande longue, en plusieurs lignes ou avec un tableau n'est jamais un
// « réflexe » : le 09/10, un tri Motion de 900 caractères est parti sans
// réflexion, et GLM a produit une réponse cassée (boucles, appels d'outil en vrac).
export function demandeComplexe(texte) {
  const t = String(texte || "");
  return t.length > 280 || t.split("\n").filter((l) => l.trim()).length >= 4 || /\|.*\|/.test(t);
}

// Classe la demande avec GLM (réflexion coupée : ~0,3 s). null si GLM ne répond pas.
// Cerveau local et unique pour ce message (pas de recherche web possible, ou
// rien qui y ressemble) : pas d'appel, le palier se décide sans IA (lib/allegement.js).
async function routerLocal(conv, reqId, prive = false) {
  const lastUser = [...conv.messages].reverse().find((m) => m.role === "user");
  const excerpt = (lastUser?.content || "").slice(0, 1500);
  const { rechercheWeb } = await reglagesCloud().catch(() => ({ rechercheWeb: false }));
  const sans = palierSansRouteur(excerpt, { rechercheWeb, prive, conseilCloud: process.env.REMY_CONSEIL_CLOUD === "on", complexe: demandeComplexe(excerpt) });
  if (sans) return sans;
  try {
    const { text, usage, model } = await glmProvider.complete({
      system: ROUTER_PROMPT_LOCAL,
      prompt: `Demande (conversation de ${conv.messages.length} message(s)) :\n\n${excerpt}`,
      maxTokens: 10,
      delaiMs: 10_000,
    });
    glmRepond();
    await logCost("routeur", "glm", model, usage, reqId);
    const tier = ["web", "reflexe", "raisonnement", "conseil"].find((t) => text.toLowerCase().includes(t)) || "raisonnement";
    return tier === "reflexe" && demandeComplexe(excerpt) ? "raisonnement" : tier;
  } catch (err) {
    if (err?.nature === "injoignable") glmEnPanne(err.message);
    console.warn("Routeur local indisponible :", err.message);
    return null;
  }
}

// --- Recherche web : jamais sans l'accord de Sam (V8, 14/10/2026) ---------------
// Une question qui demande le web passe par Claude (Anthropic) : un tiers. Rien
// ne part tout seul — Rémy demande, Sam répond (bouton, ou « oui » / « non »).
// Par défaut seule la QUESTION part, ni la conversation, ni la mémoire, ni le
// planning (réglage « Envoi de contexte au cloud »). Conversation privée : jamais.

export const PROMPT_RECHERCHE = `Tu es Rémy, l'assistant personnel de ${PRENOM}. Il t'a autorisé à chercher sur le web pour répondre à UNE question. Tu ne sais rien d'autre de lui : ni sa mémoire, ni son planning, ni le reste de la conversation. Cherche, puis réponds en français, de façon concise et vérifiable : les faits utiles d'abord, tes sources ensuite (nom du site et lien). Si tu ne trouves pas, dis-le.`;

const NOTES_WEB = {
  coupee: `Recherche web coupée par ${PRENOM} (Réglages) : réponds avec ce que tu sais, sans chercher, et dis-lui en une phrase que l'information peut ne pas être à jour.`,
  refusee: `${PRENOM} a préféré que tu ne cherches pas sur le web : réponds avec ce que tu sais, et dis-lui en une phrase que l'information peut ne pas être à jour.`,
  privee: "Conversation privée : pas de recherche web (elle passerait par un service extérieur). Réponds avec ce que tu sais, et dis-le en une phrase.",
};

// Réponse TAPÉE à « Tu autorises ? » : true (accord), false (refus), null
// (autre chose : la demande expire, le message est une nouvelle question).
// L'accord est strict — uniquement des mots d'accord, sans négation : « ok, ne
// cherche pas » ou « oui mais pas maintenant » ne sont JAMAIS un accord.
const MOTS_ACCORD = new Set(["oui", "ouais", "ok", "okay", "d'accord", "dacc", "vas-y", "go", "cherche", "autorise", "j'autorise"]);
const MOTS_POLIS = new Set(["merci", "stp", "svp", "s'il-te-plait", "s'il-te-plaît", "s'il-vous-plait", "s'il-vous-plaît"]);
const NEGATION = /\b(non|pas|ne|n'|nan|jamais|sans|stop|annule|laisse|nope)\b|\bn'/i;
export function lireAccordWeb(texte) {
  const t = String(texte || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\bvas y\b/g, "vas-y")
    .replace(/s'il (te|vous) pla[iî]t/g, (m) => m.replace(/ /g, "-"))
    .replace(/[.!,;:…]+/g, " ")
    .trim();
  if (!t || t.length > 60) return null;
  // Une négation n'est jamais un accord. Elle refuse si c'est un refus court
  // (« non merci », « ne cherche pas ») ; une phrase qui continue (« laisse
  // tomber, parle-moi de ma semaine ») est une nouvelle question : la demande expire.
  if (NEGATION.test(t)) {
    const refusCourt = /^(non|nan|nope|pas besoin|pas la peine|laisse tomber|laisse|sans)( (merci|stp|svp))*$/.test(t);
    return refusCourt || (t.length <= 40 && /cherch/.test(t)) ? false : null;
  }
  const mots = t.split(/\s+/);
  if (mots.every((m) => MOTS_ACCORD.has(m) || MOTS_POLIS.has(m)) && mots.some((m) => MOTS_ACCORD.has(m))) return true;
  return null;
}

export function texteAutorisation(a) {
  const quoi = a.contexte
    ? "ta question, la conversation et ta mémoire partiraient chez eux (réglage « Envoi de contexte au cloud » activé)"
    : "seule ta question partirait chez eux — ni la conversation, ni ta mémoire, ni ton planning";
  return `Pour te répondre, il faut chercher sur le web, et la recherche passe par Claude (Anthropic) : ${quoi}. Tu autorises ? Réponds « oui » pour que je cherche, ou « non » pour que je réponde sans le web.`;
}

// Choisit QUI répond et avec quel modèle : { provider, model, tier, reflexion }.
// `reprise` : réponse de Sam à une demande d'autorisation ({ accord }) — la
// question est déjà classée « web », le routeur n'est pas rappelé.
async function pickModel(conv, reqId, { reprise = null } = {}) {
  const base = getProvider();
  const prive = await estPrivee(conv);
  if (process.env.REMY_MODEL && !prive) return { provider: base, model: process.env.REMY_MODEL, tier: "fixe" };
  if (versLocal(conv)) {
    if (!glmConfigured() && prive) throw new Error(PRIVE_INJOIGNABLE);
    const glmVivant = glmConfigured() && (await verifierGlm()).ok;
    let tier = reprise ? "web" : glmVivant ? await routerLocal(conv, reqId, prive) : null;
    // Routeur muet mais GLM vivant, et pas de secours : on tente GLM quand même
    // plutôt que d'échouer (un vrai échec de GLM sera dit plus loin).
    if (!tier && glmVivant && !prive && !(await secoursCloudActif())) tier = "raisonnement";
    const sansWeb = (note) => ({ provider: glmProvider, model: libelleLocal(), tier: "raisonnement", reflexion: true, effort: "high", noteWeb: NOTES_WEB[note] });
    if (tier === "web" && prive) {
      if (!glmVivant) throw new Error(PRIVE_INJOIGNABLE);
      return sansWeb("privee");
    }
    if (tier === "web") {
      const c = await reglagesCloud();
      const local = (note) => {
        if (glmVivant) return sansWeb(note);
        throw new Error(SECOURS_COUPE);
      };
      if (!c.rechercheWeb) return local("coupee");
      if (reprise?.accord === false) return local("refusee");
      if (reprise?.accord !== true) return { demandeAutorisation: { contexte: c.contexteCloud } };
      // L'accord porte sur ce que la carte a MONTRÉ : un réglage changé entre
      // la carte et le tap n'élargit jamais ce qui part (au plus, il réduit).
      return {
        provider: base,
        ...(await pickCloud(base, conv, reqId, "web")),
        contexteMinimal: !(c.contexteCloud && reprise.contexte === true),
        webAutorise: true,
      };
    }
    if (tier) {
      if (tier === "conseil" && !prive && process.env.REMY_CONSEIL_CLOUD === "on") {
        return { provider: base, model: TIER_MODELS.conseil, tier };
      }
      const t = tier === "web" ? "raisonnement" : tier;
      // Réflexe : sans réflexion. Raisonnement : réflexion bornée (« high »).
      // Conseil : réflexion complète, quitte à attendre.
      return { provider: glmProvider, model: libelleLocal(), tier: t, reflexion: t !== "reflexe", effort: t === "raisonnement" ? "high" : null };
    }
    if (prive) throw new Error(PRIVE_INJOIGNABLE);
    // Tour éteinte : Claude prend le relais SEULEMENT si Sam l'a activé (D21),
    // et la puce le dit.
    if (!(await secoursCloudActif())) throw new Error(SECOURS_COUPE);
    const secours = await pickCloud(base, conv, reqId);
    return { provider: base, model: secours.model, tier: "dégradé" };
  }
  return { provider: base, ...(await pickCloud(base, conv, reqId)) };
}

// Le routage historique, tout Claude. REMY_MODEL le fige ; en mode API, un
// mini-appel Haiku classe la demande ; en mode Claude Code (Max, coût fixe), on
// garde le modèle par défaut pour ne pas ralentir chaque message. `force` : le
// palier est déjà connu (le routeur local a dit « web »), pas de second appel.
async function pickCloud(provider, conv, reqId, force = null) {
  if (force === "web") return { model: TIER_MODELS.raisonnement, tier: "web" };
  if (provider.name !== "api") return { model: DEFAULT_MODEL, tier: "local" };

  const lastUser = [...conv.messages].reverse().find((m) => m.role === "user");
  const excerpt = (lastUser?.content || "").slice(0, 1500);
  try {
    const { text, usage, model } = await provider.complete({
      system: ROUTER_PROMPT,
      prompt: `Demande (conversation de ${conv.messages.length} message(s)) :\n\n${excerpt}`,
      model: ROUTER_MODEL,
      maxTokens: 10,
    });
    await logCost("routeur", provider.name, model, usage, reqId);
    let tier = ["reflexe", "raisonnement", "conseil"].find((t) =>
      text.toLowerCase().includes(t)
    ) || "raisonnement";
    // Lire une page web demande l'outil web_fetch complet : un message qui
    // contient une URL ne reste jamais sur le palier réflexe.
    if (tier === "reflexe" && /https?:\/\//i.test(excerpt)) tier = "raisonnement";
    return { model: TIER_MODELS[tier], tier };
  } catch (err) {
    // Dégradation visible (principe remy-os) : le chip de modèle affichera « dégradé »
    // plutôt que de faire croire que le routage a fonctionné.
    console.warn("Routeur indisponible, modèle intermédiaire utilisé :", err.message);
    return { model: TIER_MODELS.raisonnement, tier: "dégradé" };
  }
}

// « Depuis combien de temps Sam ne m'a pas ouvert » — en une phrase, pour que
// Rémy puisse le relever de lui-même. Sam l'a demandé explicitement : il veut
// qu'on lui en fasse la remarque, pas qu'on fasse comme si de rien n'était.
export function phraseActivite(a) {
  if (!a || !a.jours?.length) return "";
  const [auj, ...avant] = a.jours;
  const creux = avant.findIndex((j) => j.actif);
  const absence = auj.actif ? 0 : creux === -1 ? avant.length + 1 : creux + 1;
  const bouts = [];
  if (absence >= 2) {
    bouts.push(
      `${PRENOM} ne t'a pas écrit depuis ${absence} jour${absence > 1 ? "s" : ""}` +
        (absence >= 5 ? " — c'est long." : "."),
    );
  } else if (auj.actif) {
    bouts.push(`Aujourd'hui, ${auj.messages} message${auj.messages > 1 ? "s" : ""} et ${auj.minutes} minutes devant toi.`);
  }
  if (a.serie >= 3) bouts.push(`Il t'a parlé ${a.serie} jours d'affilée.`);
  bouts.push(`Sur ${a.jours.length} jours, il t'a parlé ${a.joursActifs} fois.`);
  return bouts.join(" ");
}

export function buildSystem(memoryText, callMode, motionText, session, resteSession = "", agendaText = "", extras = {}) {
  const blocks = [
    {
      type: "text",
      text: `${SYSTEM_PROMPT}\n\n${CONSIGNE_MATIERE}${process.env.REMY_OUTILS_CARNET !== "off" ? `\n\n${CONSIGNE_CARNET}` : ""}`,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (memoryText && memoryText.trim()) {
    blocks.push({
      type: "text",
      text: `# Mémoire — ton modèle de ${PRENOM}\n\nCe que tu sais de ${PRENOM} à ce jour (tu l'as appris au fil des conversations) :\n\n${memoryText.trim()}`,
    });
  }
  if (motionText && motionText.trim()) {
    blocks.push({
      type: "text",
      text: `# Planning — ${motionText.trim()}

## Ce que tu sais de Motion (l'outil de planning de ${PRENOM})
Une tâche Motion, c'est exactement quatre choses : un nom, une DURÉE, une ÉCHÉANCE (souple ou ferme) et une PRIORITÉ (ASAP > haute > moyenne > basse). Motion choisit ensuite tout seul le créneau, dans les horaires de travail, autour des événements fixes du calendrier — et il le recalcule dès que le planning bouge. Si une tâche ne rentre plus avant son échéance, il la signale.

Ce qu'une tâche NE PEUT PAS avoir : une heure de début. Ça n'existe pas dans Motion. L'heure à laquelle tu vois une tâche est le résultat du calcul de Motion, pas une consigne — elle changera. C'est pour ça qu'un rendez-vous n'a rien à faire ici.

Les projets regroupent des tâches ; les tâches récurrentes servent aux routines. Une bonne tâche Motion = nom clair + durée réaliste + vraie échéance + priorité honnête (tout en ASAP = plus rien n'est prioritaire).

## Prudence sur ce planning
${PRENOM} a construit puis abandonné cet emploi du temps plusieurs fois : ce que tu vois contient du périmé et du non-suivi. Ne le prends jamais comme la vérité sur sa vie actuelle. Avant de t'appuyer dessus pour un conseil de planning, vérifie (« Cette tâche X, c'est encore d'actualité ? »). S'il veut repartir au propre, aide-le à trier : qu'est-ce qui est encore vrai, qu'est-ce qu'on jette, qu'est-ce qui manque — par lots de tâches, pas une par une.

## Tu peux modifier ce planning
C'est ton rôle principal : épargner à ${PRENOM} le travail d'éditer Motion à la main. Avec l'outil motion_proposer, tu prépares les changements (créer, modifier, terminer) et il les applique d'un tap. N'attends pas qu'il te le demande explicitement : s'il mentionne une tâche à faire, une échéance qui bouge, quelque chose de terminé, ou si tu vois un planning qui ne tient pas debout — propose. Regroupe les changements liés en une seule proposition, avec un « pourquoi » d'une ligne.

Ce que tu ne peux PAS faire : supprimer une tâche, créer ou renommer un projet, toucher aux séries récurrentes. Pour ça, propose de terminer la tâche, ou dis à ${PRENOM} de le faire lui-même dans Motion (en une phrase, avec la liste). L'instantané ci-dessus résume : pour un tri complet, parcours tout avec motion_lister avant de conclure. Pour modifier ou terminer, donne toujours le nom exact de la tâche avec son identifiant.

Trois règles : tu ne dis JAMAIS qu'un changement est fait avant que ${PRENOM} ait validé (dis « je te propose », pas « c'est ajouté ») ; tu ne proposes pas plus de 3 changements à la fois sauf s'il demande un grand tri ; et devant une tâche ambiguë (tu ne sais pas CE qu'il faut faire), tu poses une question. Une tâche claire sans date dite n'est pas ambiguë : propose une échéance raisonnable (souple) et dis-le dans le « pourquoi » (« échéance proposée : jeudi ») — ${PRENOM} l'ajuste d'un toucher avant de valider. Ce n'est jamais un créneau fixe : Motion place la tâche.`,
    });
  }
  if (agendaText && agendaText.trim()) {
    blocks.push({
      type: "text",
      text:
        `# Agenda de ${PRENOM} (Google Calendar)\n\n${agendaText.trim()}\n\n` +
        CONSIGNE_ARBITRAGE +
        `\n\n## Les règles de l'agenda\n` +
        `Mêmes règles que pour Motion : tu ne dis jamais qu'un rendez-vous est pris avant que ${PRENOM} ait validé, ` +
        `tu ne proposes pas un créneau déjà occupé par ce que tu vois ci-dessus, et tu donnes toujours l'heure de début ` +
        `avec son fuseau. Si ${PRENOM} te donne une heure sans date, c'est aujourd'hui ou le prochain jour possible — dis lequel.`,
    });
  }
  if (extras.activite) {
    blocks.push({
      type: "text",
      text: `# Ce que tu sais de son assiduité\n\n${extras.activite}\n\nCe compteur existe parce que ${PRENOM} te l'a demandé : il veut que tu le relèves. Après plusieurs jours sans lui, dis-le une fois, en une phrase, au moment où ça sert (« ça fait quatre jours — il s'est passé quoi ? »), puis passe à autre chose. Tu constates, tu ne sermonnes pas, et tu ne le répètes pas à chaque message.`,
    });
  }
  if (extras.sujets?.length) {
    blocks.push({
      type: "text",
      text:
        `# Sujets de ta dernière réflexion nocturne, encore ouverts\n\n` +
        extras.sujets.map((s) => `- [${s.id}] ${s.texte}`).join("\n") +
        `\n\nSi l'un de ces sujets est VRAIMENT traité dans cette conversation — ${PRENOM} a répondu, ou a tranché, pas juste effleuré — termine ton message par la ligne exacte [TRAITE:identifiant] pour le barrer dans son écran du matin. ${PRENOM} ne voit pas ce marqueur. Ne barre jamais un sujet que tu as toi-même relancé sans réponse de sa part, et n'en barre pas plus de deux dans un message. Tu n'es pas obligé de les aborder : ce sont des sujets ouverts, pas une liste de courses.`,
    });
  }
  if (session) {
    blocks.push({
      type: "text",
      text: `# Session guidée en cours (identifiant : ${session})\nCette conversation est une session d'onboarding. Avance par blocs : à chaque tour, TOUTES les questions du sous-sujet en cours dans un seul message, numérotées, en annonçant combien il en reste après. Quand elle sera VRAIMENT terminée — tu as fait le tour du sujet et ${PRENOM} n'a plus rien à ajouter — et pas avant, termine ton message par la ligne exacte [SESSION-FAITE:${session}]. ${PRENOM} ne verra pas ce marqueur : il sert à cocher la session dans son onboarding. N'écris jamais ce marqueur au milieu d'une session en cours.${resteSession}`,
    });
  }
  if (callMode) {
    blocks.push({
      type: "text",
      text: `Mode appel vocal : ${PRENOM} t'écoute à voix haute (ton texte est lu par une synthèse vocale, son message vient d'une transcription — tolère les mots mal transcrits, devine le sens). Réponds comme au téléphone : 2-3 phrases maximum, naturelles, sans markdown, sans listes, sans URL brute. Une seule question à la fois. Si ${PRENOM} dit « note ça », enregistre et réponds juste « Noté. »`,
    });
  }
  return blocks;
}

// Au premier échange d'une conversation, un mini-appel résume le sujet en
// quelques mots pour titrer la conversation (comme ChatGPT / Claude).
async function makeTitle(conv, userMsg, assistantMsg, reqId) {
  const prompt = `Premier message de l'utilisateur :\n${(userMsg || "").slice(0, 1200)}\n\nDébut de la réponse de l'assistant :\n${(assistantMsg || "").slice(0, 400)}`;
  const { text } = await tacheDeFond("titre", conv, reqId, {
    system: TITLE_PROMPT,
    prompt,
    model: TITLE_MODEL,
    maxTokens: 30,
  });
  let title = (text || "").trim().split("\n")[0];
  title = title.replace(/^["'«\s]+/, "").replace(/["'»\s.]+$/, "").trim();
  if (title.length > 60) title = title.slice(0, 57) + "…";
  return title;
}

// Après chaque échange, Rémy met à jour son modèle de Sam.
async function updateMemory(conv, memoryText, userMsg, assistantMsg, reqId) {
  // Mémoire déjà au plafond : la réécriture serait refusée (MEMOIRE_TROP_LONGUE)
  // après avoir payé un appel complet à chaque message. On ne l'appelle pas ;
  // /api/health (« Mémoire ») dit à Sam qu'il faut la raccourcir.
  if ((memoryText || "").length >= MEMORY_MAX_CHARS * 0.97) {
    console.warn(`Mémoire au plafond (${(memoryText || "").length}/${MEMORY_MAX_CHARS}) : mise à jour sautée, à raccourcir`);
    return false;
  }
  const prompt = `Mémoire actuelle :\n${memoryText?.trim() || "(vide — première conversation)"}\n\n---\n\nDernier échange :\n\nSam : ${userMsg}\n\nRémy : ${assistantMsg}`;
  const { text, stopReason } = await tacheDeFond("mémoire", conv, reqId, {
    system: MEMORY_UPDATE_PROMPT,
    prompt,
    model: MEMORY_MODEL,
    maxTokens: 8000,
  });
  const updated = (text || "").trim();
  if (!updated || updated.startsWith("NO_UPDATE")) return false;
  if (!memoireCredible(memoryText, updated, stopReason)) {
    console.warn("Mémoire NON réécrite : réponse coupée ou amputée", { stopReason, avant: memoryText?.length, apres: updated.length });
    return false;
  }
  // La réécriture tourne après la réponse : Sam a pu envoyer un autre message
  // entre-temps, dont la mise à jour a pu atterrir avant celle-ci. Écrire
  // par-dessus effacerait ce qu'elle a appris — on laisse la plus récente.
  const actuelle = await getMemory().catch(() => null);
  if (actuelle && (actuelle.text || "").trim() !== (memoryText || "").trim()) {
    console.warn(`Mémoire NON réécrite : modifiée pendant la mise à jour (message suivant ou édition de ${PRENOM})`);
    return false;
  }
  try {
    await putMemory(updated);
  } catch (err) {
    if (err.code !== "MEMOIRE_TROP_LONGUE") throw err;
    console.warn("Mémoire NON réécrite :", err.message);
    return false;
  }
  return true;
}

// Le document entier est réécrit à chaque échange : une réponse coupée au
// plafond, ou qui a perdu la moitié de ses sections, effacerait des mois
// d'apprentissage sans bruit. On garde l'ancienne version dans le doute.
export function memoireCredible(avant, apres, stopReason) {
  if (stopReason === "max_tokens") return false;
  const sections = (t) => (String(t || "").match(/^##\s/gm) || []).length;
  const nAvant = sections(avant);
  if (nAvant >= 3 && sections(apres) < Math.ceil(nAvant / 2)) return false;
  if ((avant || "").length > 1500 && apres.length < avant.length * 0.4) return false;
  return true;
}

// Titre et mémoire : GLM d'abord quand le cerveau est local (la mémoire est la
// donnée la plus personnelle de Rémy), Claude Haiku en secours — sauf pour une
// conversation privée, qui n'a pas de secours.
async function tacheDeFond(kind, conv, reqId, params) {
  if (versLocal(conv)) {
    if (glmConfigured() && (await verifierGlm()).ok) {
      try {
        const r = await glmProvider.complete(params);
        await logCost(kind, "glm", r.model, r.usage, reqId);
        return r;
      } catch (err) {
        if (err?.nature === "injoignable") glmEnPanne(err.message);
        if (await estPrivee(conv)) throw err;
        if (cerveau() === "local" && !(await secoursCloudActif())) throw new Error(SECOURS_COUPE);
        console.warn(`${kind} : modèle local indisponible, Claude prend le relais (secours activé) :`, err.message);
      }
    } else if (await estPrivee(conv)) {
      throw new Error(PRIVE_INJOIGNABLE);
    } else if (cerveau() === "local" && !(await secoursCloudActif())) {
      throw new Error(SECOURS_COUPE);
    }
  }
  const provider = getProvider();
  const r = await provider.complete(params);
  await logCost(kind, provider.name, r.model, r.usage, reqId);
  return r;
}

// Une réponse peut durer une minute. Pendant ce temps, Sam peut épingler ou
// renommer la conversation depuis la barre latérale : ces champs vivent dans le
// store, pas dans notre copie en mémoire. On les reprend avant d'écrire, sinon
// l'écriture de fin de flux les efface silencieusement.
// `possedes` : les champs que CE flux modifie volontairement (ex. désépingler
// une session close) — ils gagnent sur l'état relu, sinon on les écraserait.
async function saveConv(conv, possedes = null) {
  try {
    const frais = await getConversation(conv.id);
    if (frais) {
      conv.pinned = frais.pinned;
      if (frais.prive) conv.prive = true; // rendue privée pendant la réponse
      if (frais.renamed) {
        conv.title = frais.title;
        conv.renamed = true;
      }
      // Compactée pendant la réponse (lib/compactage.js) : le résumé reste.
      if ((frais.compactage?.jusqua || 0) > (conv.compactage?.jusqua || 0)) conv.compactage = frais.compactage;
    }
  } catch (err) {
    console.warn("Relecture de la conversation impossible :", err.message);
  }
  if (possedes) Object.assign(conv, possedes);
  return putConversation(conv);
}

// Ce que Rémy relit d'un ancien message. Une proposition de planning porte un
// statut que le modèle ne voyait PAS : il ne recevait que le texte. Résultat,
// il ne savait pas si Sam avait validé, et reproposait les mêmes actions —
// Sam revalidait, et se retrouvait avec deux tâches identiques dans Motion,
// payées deux fois (constaté le 12 août : deux « pose stérilet » à 3 min
// d'écart). Le statut est désormais collé au message, invisible à l'écran.
export function contenuPourModele(m) {
  const p = m?.proposal;
  if (m?.role !== "assistant" || !p?.actions?.length) return m?.content ?? "";
  const note = (t) => `${m.content}\n\n[${t}]`;
  if (p.source === "regle") {
    if (p.statut === "applique") return note(`RÈGLE — ${PRENOM} a validé cette règle : elle est active. Ne la repropose pas.`);
    if (p.statut === "refuse") return note(`RÈGLE — ${PRENOM} a REFUSÉ cette règle. Ne la repropose pas telle quelle.`);
    return note(`RÈGLE — proposée, ${PRENOM} n'a pas encore tranché.`);
  }
  if (p.source === "carnet") {
    const faits = (p.bilan?.faits || []).join(", ");
    if (p.statut === "applique") return note(`CARNET — ${PRENOM} a validé : c'est dans son carnet${faits ? ` (${faits})` : ""}. Ne le repropose pas.`);
    if (p.statut === "refuse") return note(`CARNET — ${PRENOM} a REFUSÉ cet ajout. Ne le repropose pas tel quel.`);
    if (p.statut === "echec") return note(`CARNET — ${PRENOM} a validé mais rien n'a pu être écrit. Tu peux le reproposer si la cause est réglée.`);
    return note(`CARNET — proposé, ${PRENOM} n'a pas encore tranché. N'en refais pas un identique.`);
  }
  if (p.statut === "applique" && p.annulee) {
    return note(
      `PLANNING — ${PRENOM} avait validé cette proposition, puis l'a ANNULÉE : tout est revenu comme avant. ` +
        "Ne la repropose pas sans raison nouvelle ; demande-lui plutôt ce qu'il veut.",
    );
  }
  if (p.statut === "echec") {
    const pourquoi = (p.bilan?.echoues || []).map((e) => e.erreur).filter(Boolean).join(" ; ");
    return note(
      `PLANNING — ${PRENOM} a validé cette proposition mais RIEN n'a pu être fait${pourquoi ? ` (${pourquoi})` : ""}. ` +
        "Tu peux la reproposer si la cause est réglée ; dis-le-lui.",
    );
  }
  if (p.statut === "applique") {
    const b = p.bilan || {};
    const faits = (b.faits || []).length
      ? `Fait dans Motion${b.espace ? ` (espace « ${b.espace} »)` : ""} : ${b.faits.join(", ")}.`
      : "";
    const rates = (b.echoues || []).length
      ? ` Échec : ${b.echoues.map((e) => `${e.nom} (${e.erreur})`).join(" ; ")}.`
      : "";
    const annulationRatee = (p.annulationRatee || []).length
      ? ` ${PRENOM} a demandé l'annulation, mais elle est INCOMPLÈTE : ${p.annulationRatee.map((e) => `${e.nom} (${e.erreur})`).join(" ; ")}.`
      : "";
    return note(
      `PLANNING — ${PRENOM} a validé cette proposition et elle est APPLIQUÉE. ${faits}${rates}${annulationRatee} ` +
        `Ne repropose JAMAIS ce qui est déjà fait : si tu doutes, demande-lui plutôt que de refaire.`,
    );
  }
  if (p.statut === "refuse") {
    return note(`PLANNING — ${PRENOM} a REFUSÉ cette proposition. Ne la repropose pas telle quelle ; demande-lui ce qui n'allait pas.`);
  }
  return note(`PLANNING — proposition affichée, ${PRENOM} n'a pas encore tranché. N'en refais pas une identique : attends sa réponse.`);
}

async function contexteDeLUtilisateur() {
  const [cartes, briefing, etats] = await Promise.all([
    listActivite(14),
    getBriefing(),
    getBriefingEtats(),
  ]);
  return {
    activite: phraseActivite(resume(cartes, { jours: 14, aujourdhui: horodate().jour })),
    sujets: sujetsOuverts(briefing.text, etats, { genereA: briefing.generatedAt }),
  };
}

export async function streamReply(res, conv, opts = {}) {
  securityHeaders(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  // La petite barre du chat : ce que Rémy fait en ce moment (lib/etapes.js).
  const etape = suiviEtapes(send);
  // Ce qu'un incident dira de cette réponse si elle échoue (lib/incidents.js) :
  // des tailles, des durées, le modèle — jamais le contenu.
  const diag = { debut: Date.now() };

  let assistantText = "";
  let champsPossedes = null; // champs que CE flux écrit volontairement
  // Ce que Rémy relit de ses anciennes propositions : leur état RÉEL (base),
  // pas la copie de la conversation (appliquée, refusée, annulée…).
  etatsPropositions(conv);
  // POST /api/conversations/:id/stop coupe le fournisseur par ce signal
  // (lib/arret.js) ; libéré une fois toutes les écritures faites.
  const arret = demarrerGeneration(conv.id);
  try {
    etape("contexte", "Rémy relit sa mémoire, ton planning et ton agenda…");
    const [memory, motion, agenda, resteSession, contexteUtilisateur] = await Promise.all([
      getMemory(),
      motionSnapshot().catch((err) => {
        console.warn("Motion indisponible :", err.message);
        return "";
      }),
      // Les rendez-vous de la semaine : sans eux, Rémy proposerait des créneaux
      // déjà pris.
      agendaSnapshot().catch((err) => {
        console.warn("Agenda indisponible :", err.message);
        return "";
      }),
      // Ce qu'il reste à apprendre dans cette session : Rémy ne redemande pas
      // ce que Sam lui a déjà raconté ailleurs.
      opts.session
        ? contexteSession(opts.session).catch((err) => {
            console.warn("Repères de session indisponibles :", err.message);
            return "";
          })
        : "",
      // Son assiduité, et les sujets de la nuit encore ouverts. Deux lectures de
      // base, aucun appel IA : si elles échouent, Rémy répond sans, plutôt que
      // de faire échouer la conversation.
      contexteDeLUtilisateur().catch((err) => {
        console.warn("Contexte d'assiduité indisponible :", err.message);
        return { activite: "", sujets: [] };
      }),
    ]);
    const reqId = crypto.randomUUID();
    // Sur une reprise, la question est celle d'AVANT la demande d'autorisation
    // (pas le « oui » qui y répond).
    const lastUserMsg = [...(opts.reprise ? conv.messages.slice(0, opts.reprise.index) : conv.messages)].reverse().find((m) => m.role === "user");
    const label = (lastUserMsg?.content || "").slice(0, 70);
    diag.question = String(lastUserMsg?.content || "").length;
    etape("choix", "Rémy choisit comment te répondre…");
    const choix = await pickModel(conv, reqId, { reprise: opts.reprise });

    // La question demande le web : Rémy DEMANDE avant d'envoyer quoi que ce
    // soit chez Claude (aucun appel IA ici). Sam répond par la carte, ou par
    // « oui » / « non » (route de reprise, ou message suivant).
    if (choix.demandeAutorisation) {
      const autorisation = {
        id: crypto.randomUUID(),
        type: "web",
        statut: "en_attente",
        contexte: Boolean(choix.demandeAutorisation.contexte),
        requete: String(lastUserMsg?.content || "").slice(0, 2000),
      };
      const texte = texteAutorisation(autorisation);
      conv.messages.push({ role: "assistant", content: texte, model: "remy", tier: "autorisation", usd: 0, autorisation });
      conv.updatedAt = Date.now();
      await saveConv(conv, champsPossedes);
      send("delta", { text: texte });
      send("autorisation", { ...autorisation, index: conv.messages.length - 1 });
      send("done", { stop_reason: "autorisation", model: "remy", tier: "autorisation", usd: 0, text: texte });
      return;
    }

    let { provider, model: chosenModel, tier } = choix;
    const reflexion = choix.reflexion ?? true;
    const effort = choix.effort ?? null;
    Object.assign(diag, { fournisseur: provider.name, modele: chosenModel, tier, reflexion, effort });

    // Résumé en direct de ce que fait Rémy pendant qu'il travaille (affiché
    // sous les points de frappe) — coût nul : ce sont nos propres événements.
    let proposal = null; // proposition Motion en attente de validation de Sam
    const onTool = (info) => {
      try {
        if (info.type === "browse") {
          const host = info.url ? new URL(info.url).hostname.replace(/^www\./, "") : "une page";
          const doing = info.clics?.length ? `navigue sur ${host} (clic : ${info.clics.join(" → ")})` : `ouvre ${host}`;
          etape("navigateur", `Rémy ${doing}…`);
        } else if (info.type === "web") {
          etape("web", "Rémy cherche sur le web…");
        } else if (info.type === "motion_lecture") {
          etape("motion", "Rémy parcourt ton Motion…");
        } else if (info.type === "reflexion") {
          etape("reflexion", "Rémy réfléchit…", info.extrait);
        } else if (info.type === "budget") {
          // Sam doit savoir que la réponse arrive écourtée, et pourquoi.
          etape(
            "budget",
            info.raison === "reflexion"
              ? "Réflexion trop longue — Rémy conclut avec ce qu'il a…"
              : "Recherche trop longue — Rémy conclut avec ce qu'il a…",
          );
        } else if (info.type === "regle") {
          etape("proposition", "Rémy prépare une règle…");
          if (!proposal) {
            proposal = {
              id: crypto.randomUUID(),
              source: "regle",
              resume: String(info.resume || "").slice(0, 200),
              actions: info.actions,
              statut: "en_attente",
              creeA: Date.now(), // pour la péremption (24/10)
            };
          }
        } else if (info.type === "motion" || info.type === "agenda" || info.type === "carnet") {
          etape(
            "proposition",
            info.type === "agenda" ? "Rémy prépare un rendez-vous…" : info.type === "carnet" ? "Rémy prépare ton carnet…" : "Rémy prépare une modification du planning…",
          );
          // Même source dans la même réponse : une seule carte, actions ajoutées.
          if (proposal && proposal.source === info.type) {
            proposal.actions = [...proposal.actions, ...info.actions].slice(0, 12);
            if (info.resume && !proposal.resume) proposal.resume = String(info.resume).slice(0, 200);
          } else if (!proposal) {
            proposal = {
              id: crypto.randomUUID(),
              source: info.type, // « motion » (tâches), « agenda » (rendez-vous) ou « carnet » (courses, rappels)
              resume: String(info.resume || "").slice(0, 200),
              actions: info.actions,
              statut: "en_attente",
              creeA: Date.now(), // pour la péremption (24/10)
            };
          }
        }
      } catch {}
    };

    // L'historique vu par le modèle : sans les demandes d'autorisation (elles
    // sont pour Sam), et, sur une reprise, arrêté à la question d'origine.
    // Une longue conversation compactée : son début arrive résumé (lib/compactage.js).
    const compact = historiqueCompacte(conv, opts.reprise ? conv.messages.slice(0, opts.reprise.index) : conv.messages);
    const historique = compact.messages.filter((m) => !m.autorisation);
    const systeme = buildSystem(memory.text, opts.call, motion, opts.session, resteSession, agenda, contexteUtilisateur);
    if (compact.resume) systeme.push({ type: "text", text: noteResume(compact.resume) });
    if (choix.noteWeb) systeme.push({ type: "text", text: `# Recherche web\n\n${choix.noteWeb}` });
    // Où est Sam (localisation, 20/10) : pour GLM seulement — ce bloc ne part
    // jamais chez Claude (ni en secours, ni pour une recherche avec contexte).
    let blocLieux = null;
    try {
      if (lieuxConnus()) {
        const ici = etatLieux();
        const taches = ici.ou === "lieu" && motionEnabled() ? ((await tachesMotion().catch(() => null)) || []).filter((t) => !t.completed).map((t) => t.name) : [];
        const note = noteLieux({ taches });
        if (note) blocLieux = { type: "text", text: note };
      }
    } catch (err) {
      console.warn("Localisation illisible :", err.message);
    }
    // L'activité du PC (ActivityWatch, 24/10) : même règle, GLM seulement.
    let blocActivite = null;
    try {
      const note = noteActivitePC();
      if (note) blocActivite = { type: "text", text: note };
    } catch (err) {
      console.warn("Activité du PC illisible :", err.message);
    }
    const blocsLocaux = [blocLieux, blocActivite].filter(Boolean);
    // Recherche autorisée SANS contexte (par défaut) : seule la question part.
    const minimal = Boolean(choix.contexteMinimal);
    const demande = {
      system: minimal
        ? [{ type: "text", text: `${PROMPT_RECHERCHE}\n\n${CONSIGNE_MATIERE}` }]
        : provider === glmProvider && blocsLocaux.length
          ? [...systeme, ...blocsLocaux]
          : systeme,
      // Pas lu, pas écrit : l'outil d'écriture n'est proposé que si l'agenda
      // (ou Motion) a pu être lu pour cette réponse.
      agendaActif: !minimal && Boolean(agenda) && (await googleConnecte().catch(() => false)),
      motionActif: !minimal && Boolean(motion),
      lectureMotion: !minimal,
      // Outils web : seulement pour une recherche autorisée par Sam (V8).
      web: Boolean(choix.webAutorise),
      messages: minimal
        ? [{ role: "user", content: String(opts.reprise?.requete || lastUserMsg?.content || "") }]
        : historique.map((m) => ({ role: m.role, content: contenuPourModele(m) })),
      model: chosenModel,
      reflexion,
      effort,
      navigateur: !conv.prive,
      signal: arret.signal,
      onTool,
      // La vitesse d'écriture, au plus une fois par seconde (barre du chat).
      onDebit: (d) => {
        diag.debit = d;
        send("debit", d);
      },
      onText: (delta) => {
        // Une fois par reprise de l'écriture (après un outil, une réflexion).
        if (etape.courante() !== "ecrit") etape("ecrit", "Rémy écrit sa réponse…");
        assistantText += delta;
        send("delta", { text: delta });
      },
    };
    etape("modele", provider === glmProvider ? "Rémy interroge son modèle local…" : "Rémy attend la réponse de Claude…");
    let resultat;
    try {
      resultat = await provider.stream(demande).catch(siArrete(arret.signal, chosenModel));
      if (provider === glmProvider) glmRepond();
    } catch (err) {
      if (!(err instanceof GlmError)) throw err;
      if (err.nature === "injoignable") glmEnPanne(err.message);
      // Trop long, pas en panne : le dire tel quel (Claude n'y ferait pas mieux
      // sans l'accord de Sam, et GLM reste joignable pour la suite).
      if (err.nature === "delai") throw err;
      // Rien n'a encore été montré : Claude reprend la même demande, sauf en
      // conversation privée. Sinon (réponse coupée en route), on dit l'erreur.
      const prive = await estPrivee(conv);
      if (!err.avantTexte || prive) throw prive && err.avantTexte ? new Error(PRIVE_INJOIGNABLE) : err;
      if (!(await secoursCloudActif())) throw new Error(SECOURS_COUPE);
      console.warn("GLM a lâché avant de répondre, Claude prend le relais (secours activé) :", err.message);
      etape("secours", "Modèle local injoignable — Rémy passe par Claude…");
      // Une proposition préparée par GLM avant de lâcher n'a pas été annoncée :
      // elle ne doit pas rester accrochée à la réponse de Claude.
      proposal = null;
      provider = getProvider();
      chosenModel = TIER_MODELS[tier] || TIER_MODELS.raisonnement;
      tier = "dégradé";
      Object.assign(diag, { fournisseur: provider.name, modele: chosenModel, tier, secours: true });
      // Claude ne reçoit jamais la position de Sam.
      resultat = await provider.stream({ ...demande, system: minimal ? demande.system : systeme, model: chosenModel }).catch(siArrete(arret.signal, chosenModel));
    }
    const { stopReason, usage, model } = resultat;
    // La jauge du chat : débit et contexte de cette réponse (des compteurs),
    // le modèle et la machine qui l'ont écrite.
    const surGlm = provider === glmProvider;
    const mesures = {
      ...(resultat.mesures || {}),
      modele: surGlm ? modeleGlm() : model || chosenModel,
      machine: surGlm ? machineGlm() : provider.name === "claude-code" ? "Anthropic (cloud), via Claude Code sur la tour" : "Anthropic (cloud)",
    };
    // Balises d'outil, boucles, caractères parasites : jamais sous les yeux de
    // Sam ni dans l'historique (le « done » remplace l'affichage).
    const text = nettoyerSortie(resultat.text);
    assistantText = nettoyerSortie(assistantText);
    // Coupée par Sam : la réponse partielle est gardée, avec sa mention.
    const interrompu = stopReason === "interrompu";
    // Coupée par l'échéance en pleine écriture (lib/glm.js) : gardée, et dite.
    const coupee = stopReason === "coupe";
    const partielVide = interrompu && !assistantText.trim();

    await logCost(
      opts.reprise?.accord ? "recherche web" : "conversation",
      provider.name, model || chosenModel, usage, reqId,
      `${opts.reprise?.accord ? (minimal ? "[question seule] " : "[avec contexte] ") : ""}${label}${interrompu ? " (interrompu)" : ""}`,
    );

    if (stopReason === "refusal" && !assistantText) {
      assistantText = "Je ne peux pas répondre à cette demande. Reformule-la et je ferai de mon mieux.";
      send("delta", { text: assistantText });
    } else if (!assistantText && text) {
      assistantText = text;
      send("delta", { text });
    }

    // Session guidée close par Rémy lui-même : il termine par [SESSION-FAITE:id].
    // On retire le marqueur du texte (Sam ne doit jamais le voir) et on coche
    // la session dans le panneau Onboarding.
    let sessionDone = null;
    const marker = assistantText.match(/\[SESSION-FAITE:([a-z0-9-]{1,40})\]/i);
    if (marker) {
      // Le marqueur est toujours retiré du texte (cosmétique), mais il ne coche
      // une session QUE s'il correspond à celle que porte cette conversation :
      // sinon n'importe quelle réponse — y compris influencée par une page web
      // hostile — pourrait valider une session au hasard.
      assistantText = assistantText.replace(marker[0], "").trimEnd();
      const id = marker[1].toLowerCase();
      if (opts.session && id === opts.session) {
        try {
          sessionDone = await markSessionDone(id);
        } catch (err) {
          console.warn("Session non cochée :", err.message);
        }
        // Session close : la conversation cesse de la porter (plus de consigne
        // de clôture à vie) et se désépingle pour libérer la tête de liste.
        delete conv.session;
        conv.pinned = false;
        champsPossedes = { pinned: false, session: undefined };
      } else {
        console.warn("Marqueur de session ignoré (hors session) :", id);
      }
    }

    // Repères couverts en direct : [COUVERT:id1,id2]. Même règle de sécurité que
    // ci-dessus — le marqueur est toujours retiré du texte, mais il ne compte
    // que pour la session que porte CETTE conversation, et seuls les
    // identifiants réellement définis pour elle sont retenus.
    let couverture = null;
    const marques = [...assistantText.matchAll(/\[COUVERT:([a-z0-9,\-\s]{1,200})\]/gi)];
    if (marques.length) {
      // TOUS les marqueurs sont retirés, pas seulement le premier : sinon le
      // second restait visible dans le message enregistré.
      for (const m of marques) assistantText = assistantText.replace(m[0], "");
      assistantText = assistantText.replace(/[ \t]{2,}/g, " ").trimEnd();
      const ids = marques
        .flatMap((m) => m[1].toLowerCase().split(","))
        .map((x) => x.trim())
        .filter(Boolean);
      if (opts.session) {
        // Plafond par message : un seul échange qui couvrirait toute une section
        // n'est pas crédible, et Rémy lit des pages web qui pourraient l'y
        // pousser. On limite les dégâts d'un message trop généreux.
        const valides = reperesValides(opts.session, ids).slice(0, 3);
        if (valides.length) {
          try {
            couverture = await ajouterCouverture(opts.session, valides);
          } catch (err) {
            console.warn("Repères non enregistrés :", err.message);
          }
        }
      } else {
        console.warn("Marqueur de couverture ignoré (hors session) :", ids.join(","));
      }
    }

    // Sujet de la nuit barré par Rémy lui-même : [TRAITE:identifiant]. Même
    // règle que les deux marqueurs ci-dessus — retiré du texte dans tous les
    // cas, honoré seulement s'il désigne un sujet RÉELLEMENT ouvert de la
    // dernière réflexion. Sans ce filtre, une page web hostile pourrait faire
    // barrer n'importe quoi dans l'écran du matin de Sam.
    let traites = [];
    const marquesT = [...assistantText.matchAll(/\[TRAITE:([a-f0-9,\s]{1,120})\]/gi)];
    if (marquesT.length) {
      for (const m of marquesT) assistantText = assistantText.replace(m[0], "");
      assistantText = assistantText.replace(/[ \t]{2,}/g, " ").trimEnd();
      const ouverts = new Set((contexteUtilisateur.sujets || []).map((x) => x.id));
      const ids = [...new Set(
        marquesT.flatMap((m) => m[1].toLowerCase().split(",")).map((x) => x.trim()).filter(Boolean),
      )].filter((id) => ouverts.has(id));
      // Deux au maximum : un message qui barrerait toute la nuit d'un coup n'est
      // pas crédible.
      for (const id of ids.slice(0, 2)) {
        try {
          await setBriefingEtat(id, "traite");
          traites.push(id);
        } catch (err) {
          console.warn("Sujet non barré :", err.message);
        }
      }
      const refuses = marquesT.length && !traites.length;
      if (refuses) console.warn("Marqueur [TRAITE] ignoré (sujet inconnu ou déjà fermé)");
    }
    if (traites.length) send("traites", { ids: traites });

    // Coût estimé de la réponse elle-même (hors routeur/mémoire — le détail
    // complet est dans le panneau coûts), affiché sous le message dans l'app.
    const usd =
      provider.name === "claude-code"
        ? 0
        : Math.round(estimateCostUsd(model || chosenModel, usage) * 1e6) / 1e6;

    if (interrompu) assistantText = avecMention(assistantText);
    else if (coupee) assistantText = avecMention(assistantText, MENTION_COUPEE);
    conv.messages.push({
      role: "assistant",
      content: assistantText,
      model: model || chosenModel,
      tier,
      usd,
      // La proposition vit sur le message : elle survit au rechargement et
      // garde sa trace (appliquée / annulée) dans l'historique.
      ...(proposal ? { proposal } : {}),
      ...(interrompu ? { interrompu: true } : {}),
      ...(mesures ? { mesures } : {}),
    });
    if (proposal) send("proposal", { ...proposal, index: conv.messages.length - 1 });
    conv.updatedAt = Date.now();
    await saveConv(conv, champsPossedes);

    // Titre automatique (premier échange) et mise à jour de la mémoire, en
    // parallèle. Échecs non fatals dans les deux cas. La mémoire passe APRÈS
    // « done » : sur GLM, réécrire le document prend ~30 s, et Sam n'a pas à
    // attendre la fin d'une tâche qu'il ne voit pas pour que sa réponse soit
    // marquée finie.
    // Coupée avant le premier mot : rien à résumer ni à retenir.
    const titleTask = opts.autoTitle && !partielVide
      ? makeTitle(conv, lastUserMsg?.content || "", assistantText, reqId).catch((err) => {
          console.warn("Titre automatique échoué :", err.message);
          return "";
        })
      : Promise.resolve("");
    // Une conversation privée ne nourrit PAS la mémoire : ce document part chez
    // Claude avec les conversations normales et la réflexion de la nuit — ce
    // serait une fuite par la bande. Rémy la lit, il n'y écrit pas.
    // Rien appris sur Sam (« acheter des ampoules », « ok merci ») : la
    // mémoire n'est pas réécrite (lib/allegement.js). Une étape « Faire
    // connaissance » la nourrit toujours, comme la réponse à une question de
    // Rémy sur Sam (« Tu te lèves à quelle heure ? » → « vers 7 h »).
    const iSam = conv.messages.lastIndexOf(lastUserMsg);
    const question = iSam > 0 ? conv.messages.slice(0, iSam).reverse().find((m) => m.role === "assistant")?.content : "";
    const rienAppris = !opts.session && !apprendSurSam(lastUserMsg?.content || "", { question: typeof question === "string" ? question : "" });
    const memoryTask = conv.prive || partielVide || rienAppris
      ? Promise.resolve(false)
      : updateMemory(conv, memory.text, lastUserMsg?.content || "", assistantText, reqId).catch((err) => {
          console.warn("Mise à jour mémoire échouée :", err.message);
          return false;
        });

    const title = await titleTask;
    if (title) {
      conv.title = title;
      await saveConv(conv, champsPossedes);
      send("title", { title });
    }

    // Le texte complet voyage dans « done » : si des fragments du flux se sont
    // perdus en route (réseau mobile), l'app remplace l'affichage par la vérité
    // stockée — plus jamais de mots mâchés à l'écran.
    send("done", {
      stop_reason: stopReason,
      model: model || chosenModel,
      tier,
      usd,
      text: assistantText,
      session_done: sessionDone,
      couverture, // fait avancer la jauge dans la conversation, sans rechargement
      ...(interrompu ? { interrompu: true } : {}),
      ...(mesures ? { mesures } : {}),
    });
    // Une réponse qui a rempli 70 % du contexte : le début du fil est résumé
    // maintenant (GLM local), pour que la suivante reparte plus légère.
    const compactageTask = !partielVide && aCompacter(conv, mesures) && glmConfigured() && (await circuitActif("compactage"))
      ? compacter(conv.id, { reqId }).catch((err) => {
          console.warn("Compactage automatique échoué :", err.message);
        })
      : Promise.resolve();
    // Le flux se ferme maintenant (l'app débloque le composeur à la fermeture) ;
    // waitUntil garde la fonction Vercel en vie jusqu'à la fin de la mémoire.
    waitUntil(Promise.all([memoryTask, compactageTask]));
  } catch (err) {
    let message = "Erreur inattendue côté serveur.";
    if (/authentication method/i.test(err.message || "")) {
      message =
        "Aucune clé API configurée. Ajoute ANTHROPIC_API_KEY, ou en local utilise REMY_PROVIDER=claude-code (abonnement Max).";
    } else if (err instanceof Anthropic.AuthenticationError) {
      message = "Clé API invalide. Vérifie ANTHROPIC_API_KEY.";
    } else if (err instanceof Anthropic.RateLimitError) {
      message = "Limite de débit atteinte. Réessaie dans quelques instants.";
    } else if (err instanceof Anthropic.APIConnectionError) {
      message = "Impossible de joindre l'API Claude. Vérifie la connexion.";
    } else if (err instanceof Anthropic.APIError) {
      message = `Erreur API (${err.status}) : ${err.message}`;
    } else if (err.message) {
      message = err.message;
    }
    // Un code que Sam peut transmettre ; l'incident reste sur la tour.
    const code = noterIncident({
      type: "chat",
      conversation: conv.id,
      prive: Boolean(conv.prive || conv.origine),
      session: opts.session || null,
      appel: Boolean(opts.call),
      reprise: Boolean(opts.reprise),
      etape: etape.courante(),
      etapes: etape.historique(),
      dureeMs: Date.now() - diag.debut,
      questionCaracteres: diag.question ?? null,
      messages: conv.messages.length,
      fournisseur: diag.fournisseur ?? null,
      modele: diag.modele ?? null,
      tier: diag.tier ?? null,
      reflexion: diag.reflexion ?? null,
      effort: diag.effort ?? null,
      secours: Boolean(diag.secours),
      debit: diag.debit ?? null,
      texteRecu: assistantText.length,
      erreur: err,
    });
    // On retire le message utilisateur non traité pour pouvoir réessayer proprement.
    // Sur une reprise, rien n'est retiré : la demande d'autorisation redevient
    // « en attente », Sam peut réessayer d'un tap.
    if (!assistantText && opts.reprise) {
      const a = conv.messages[opts.reprise.index]?.autorisation;
      if (a) a.statut = "en_attente";
      if (conv.messages.at(-1)?.role === "user" && opts.reprise.parTexte) conv.messages.pop();
      conv.updatedAt = Date.now();
      await saveConv(conv, champsPossedes);
    } else if (!assistantText) {
      conv.messages.pop();
      conv.updatedAt = Date.now();
      await saveConv(conv, champsPossedes);
    }
    send("error", { message, code });
  } finally {
    arret.liberer();
    res.end();
  }
}
