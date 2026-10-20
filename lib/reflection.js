// La réflexion nocturne de Rémy (Constitution : « le cerveau lent »).
// Chaque nuit, un cron Vercel relit le modèle de Sam et les conversations récentes,
// puis prépare un briefing court pour le matin. Principes hérités de remy-os V0.1 :
// budget d'attention strict (3 éléments maximum), sortie vide autorisée, jamais
// culpabilisant — on rappelle à Sam ses propres objectifs, pas une norme externe.

import crypto from "node:crypto";
import {
  getMemory,
  listConversations,
  getConversation,
  putBriefing,
  getBriefing,
  getReflectionFocus,
  putReflectionFocus,
  putReflectionSuggestions,
  getBriefingEtats,
  listBriefings,
  listActivite,
  listCaptures,
} from "./store.js";
import { sujetsFermes } from "./briefing.js";
import { resume, horodate } from "./activite.js";
import { phraseActivite } from "./chat.js";
import { fournisseurDeFond } from "./providers.js";
import { motionSnapshot } from "./motion.js";
import { logCost } from "./chat.js";
import { encadrer, nomAssistant, CONSIGNE_MATIERE } from "./encadrement.js";
import { PRENOM } from "./profil.js";

const REFLECTION_MODEL = process.env.REMY_REFLECTION_MODEL || "claude-sonnet-5";
const LOOKBACK_MS = 36 * 3600 * 1000; // conversations des ~36 dernières heures
const MAX_CONVS = 5;
const MAX_MSGS = 12;
const MAX_MSG_CHARS = 600;

const REFLECTION_PROMPT = `Tu es le module de réflexion nocturne de Rémy OS. Chaque nuit, tu relis le modèle de ${PRENOM} et ses conversations récentes avec Rémy, puis tu prépares le briefing que Rémy lui montrera au réveil.

Règles :
- MAXIMUM 3 éléments. La sortie vide est autorisée : si rien n'est suffisamment significatif, réponds exactement RIEN. Un briefing vide vaut mieux qu'un briefing qui dérange pour rien.
- Chaque élément est une ligne markdown commençant par "- " : une hypothèse (avec % de confiance), une question douce, ou une observation réellement utile pour la journée.
- Distingue manque de données et signal réel : peu d'informations n'est pas un signal.
- Une hypothèse n'est JAMAIS présentée comme un fait.
- Un objectif que ${PRENOM} a déclaré prioritaire mais dont il ne parle plus mérite une question, pas un reproche.
- Ne culpabilise jamais : tu rappelles à ${PRENOM} ses propres engagements, pas une norme externe.
- Si ${PRENOM} ne t'a pas parlé depuis plusieurs jours, tu as le droit de le relever — il l'a demandé. Une ligne, factuelle, sans reproche moral (« Quatre jours sans échange : est-ce que quelque chose bloque, ou juste une semaine chargée ? »). Jamais deux nuits de suite.
- Ne propose aucune action engageante (achat, message à quelqu'un…) : au mieux une suggestion à valider.
- Réponds UNIQUEMENT avec les lignes du briefing (ou RIEN), sans titre ni préambule.`;

// Matière première commune à la réflexion et à la pré-réflexion : mémoire,
// conversations récentes, planning Motion.
async function gatherContext() {
  const memory = await getMemory();
  const all = await listConversations();
  // Une conversation rendue privée par Sam reste hors de la réflexion. Les
  // conversations importées (privées d'office) y entrent, mais alors la
  // réflexion ne peut tourner que sur le modèle local (`prive`, plus bas).
  const recent = all.filter((c) => (!c.prive || c.origine) && c.updatedAt > Date.now() - LOOKBACK_MS).slice(0, MAX_CONVS);
  const prive = recent.some((c) => c.origine);

  const excerpts = [];
  for (const { id, title } of recent) {
    const conv = await getConversation(id);
    if (!conv) continue;
    // Un import n'est pas « Rémy » : l'assistant d'origine est nommé, et
    // l'échange est encadré comme matière externe (écrit ailleurs).
    const assistant = nomAssistant(conv);
    const msgs = conv.messages.slice(-MAX_MSGS).map((m) => {
      const text = m.content.length > MAX_MSG_CHARS ? m.content.slice(0, MAX_MSG_CHARS) + "…" : m.content;
      return `${m.role === "user" ? PRENOM : assistant} : ${text}`;
    });
    const corps = msgs.join("\n\n");
    excerpts.push(
      conv.origine
        ? `### ${title} (conversation importée depuis ${assistant})\n\n${encadrer(corps, { source: `export ${assistant}`, titre: title })}`
        : `### ${title}\n\n${corps}`,
    );
  }

  const motion = await motionSnapshot().catch((err) => {
    console.warn("Motion indisponible pour la réflexion :", err.message);
    return "";
  });

  // Son assiduité : sans elle, la nuit où Sam n'a rien dit depuis cinq jours
  // ressemble à toutes les autres — alors que c'est précisément le signal qu'il
  // a demandé qu'on relève.
  const activite = await listActivite(14)
    .then((c) => phraseActivite(resume(c, { jours: 14, aujourdhui: horodate().jour })))
    .catch((err) => {
      console.warn("Activité indisponible pour la réflexion :", err.message);
      return "";
    });

  // Ce que Sam a poussé depuis ailleurs : c'est la matière la plus fraîche
  // sur ce qu'il se demande EN CE MOMENT, et elle n'apparaît dans aucune
  // conversation avec Rémy.
  const captures = await listCaptures(10)
    .then((cs) =>
      cs
        .filter((c) => c.at > Date.now() - 7 * 86_400_000)
        .map((c) => {
          const q = new Date(c.at).toISOString().slice(0, 10);
          return `### ${c.titre || "Capture"} (${q}, depuis ${c.source})\n\n${encadrer((c.extrait || "").slice(0, 1500), { source: `capture ${c.source || ""}`, titre: c.titre })}`;
        }),
    )
    .catch((err) => {
      console.warn("Captures indisponibles pour la réflexion :", err.message);
      return [];
    });

  return { memory, recent, excerpts, motion, activite, captures, prive };
}

export async function runReflection() {
  const { memory, recent, excerpts, motion, activite, captures, prive } = await gatherContext();

  if (!memory.text.trim() && !recent.length) {
    return { ok: true, skipped: "rien à relire (mémoire vide, aucune conversation récente)" };
  }
  // Consigne one-shot de Sam (« cette nuit, occupe-toi de… ») : prioritaire,
  // consommée après usage pour ne pas se répéter toutes les nuits.
  const focus = await getReflectionFocus().catch(() => ({ text: "" }));
  const prompt = `${
    focus.text ? `CONSIGNE DE ${PRENOM.toUpperCase()} POUR CETTE NUIT (priorité absolue, traite-la d'abord) :\n${focus.text}\n\n---\n\n` : ""
  }Modèle de ${PRENOM} (mémoire de Rémy) :\n${memory.text.trim() || "(vide)"}\n\n---\n\n${
    activite ? `Son assiduité : ${activite}\n\n---\n\n` : ""
  }${
    captures.length
      ? `Ce que ${PRENOM} t'a poussé depuis ailleurs (extraits de ses conversations avec d'autres assistants, ou ses notes) — c'est ce qu'il se demande en ce moment :\n\n${captures.join("\n\n")}\n\n---\n\n`
      : ""
  }${
    motion ? motion + "\n\n---\n\n" : ""
  }Conversations récentes :\n\n${
    excerpts.join("\n\n---\n\n") || "(aucune)"
  }\n\n---\n\nPrépare le briefing du matin.`;

  const provider = fournisseurDeFond();
  const reqId = crypto.randomUUID();
  // Même piège que l'analyse d'onboarding : sans plafond explicite ni effort
  // borné, Sonnet 5 peut dépenser tout son budget en réflexion et ne rien
  // écrire. Un briefing vide passerait alors pour « rien de significatif ».
  const { text, usage, model, stopReason, blocs } = await provider.complete({
    prive,
    system: `${REFLECTION_PROMPT}\n\n${CONSIGNE_MATIERE}`,
    prompt,
    model: REFLECTION_MODEL,
    maxTokens: 8000,
    effort: "medium",
  });
  await logCost("réflexion", provider.name, model, usage, reqId, "Réflexion nocturne");

  const out = (text || "").trim();
  // Un texte vide n'est PAS « RIEN » : « RIEN » est une décision du modèle,
  // le vide est une panne. Écraser le briefing d'hier avec une panne serait
  // une perte silencieuse.
  if (!out) {
    console.warn(
      "Réflexion nocturne vide (stop=%s, blocs=%s) — briefing précédent conservé.",
      stopReason || "?", (blocs || []).join(",") || "aucun",
    );
    return { ok: false, erreur: "réponse vide", stopReason: stopReason || null };
  }
  const briefing = await putBriefing(out === "RIEN" ? "" : out);
  if (focus.text) {
    await putReflectionFocus("").catch((err) => console.warn("Focus non effacé :", err.message));
  }
  return { ok: true, empty: !briefing.text, generatedAt: briefing.generatedAt, focused: Boolean(focus.text) };
}

// --- Pré-réflexion : proposer à Sam les sujets de la nuit ----------------------
// Le choix du sujet est lui-même un problème d'attention : Rémy propose (à
// partir de signaux réels), Sam arbitre d'un tap dans la carte « Cette nuit ».

const SUGGEST_MODEL = process.env.REMY_SUGGEST_MODEL || "claude-sonnet-5";

const SUGGEST_PROMPT = `Tu es le module de pré-réflexion de Rémy OS. En soirée, tu annonces à ${PRENOM} ce que Rémy compte creuser pendant sa réflexion nocturne (« Ce soir, je compte réfléchir sur… »), et tu lui proposes jusqu'à 2 sujets optionnels en plus (« Veux-tu que je traite aussi… »).

Un bon sujet :
- est actionnable PAR RÉMY cette nuit (réfléchir, structurer, comparer, préparer un plan, analyser) — jamais une tâche pour ${PRENOM} ;
- part d'un signal réel dans la matière fournie : décision en suspens, question restée ouverte dans une conversation, échéance qui approche dans le planning, tension entre deux objectifs, sujet que ${PRENOM} a dit vouloir creuser ;
- est formulé comme une consigne directe (« Prépare… », « Compare… », « Structure… »), 15 mots maximum ;
- a un « pourquoi » d'une seule phrase qui cite le signal d'origine.

Le « principal » est LE sujet le plus utile — celui que Rémy traitera. Les options « aussi » (0 à 2) ne servent jamais à remplir : si la matière est pauvre, n'en propose aucune. Ne reprends pas un sujet déjà traité dans le dernier briefing, sauf s'il reste clairement ouvert.

Réponds UNIQUEMENT avec ce JSON, sans balises de code ni commentaire :
{"principal":{"sujet":"…","pourquoi":"…"},"aussi":[{"sujet":"…","pourquoi":"…"}]}`;

// Le modèle ne peut plus rendre autre chose que cette forme.
const SCHEMA_SUJETS = {
  type: "object",
  properties: {
    principal: {
      type: "object",
      properties: { sujet: { type: "string" }, pourquoi: { type: "string" } },
      required: ["sujet", "pourquoi"],
      additionalProperties: false,
    },
    aussi: {
      type: "array",
      items: {
        type: "object",
        properties: { sujet: { type: "string" }, pourquoi: { type: "string" } },
        required: ["sujet", "pourquoi"],
        additionalProperties: false,
      },
    },
  },
  required: ["principal", "aussi"],
  additionalProperties: false,
};

export async function suggestFocus() {
  const { memory, excerpts, motion, captures, prive } = await gatherContext();
  const [briefing, etats, historique] = await Promise.all([
    getBriefing(),
    getBriefingEtats().catch(() => ({})),
    listBriefings().catch(() => []),
  ]);
  // Un « − » de Sam est un signal, pas un simple geste de ménage : ce qu'il a
  // écarté ne doit pas revenir la nuit suivante sous une autre formulation.
  const fermes = sujetsFermes([briefing.text, ...historique.slice(0, 5).map((b) => b.text)], etats);
  const ecartes = fermes.filter((s) => s.etat === "ignore");
  const deja = fermes.filter((s) => s.etat === "traite");

  const prompt = `Modèle de ${PRENOM} (mémoire de Rémy) :\n${memory.text.trim() || "(vide)"}\n\n---\n\n${
    motion ? motion + "\n\n---\n\n" : ""
  }Dernier briefing du matin :\n${briefing.text || "(aucun)"}\n\n${
    ecartes.length
      ? `Sujets que ${PRENOM} a EXPLICITEMENT écartés (ne les repropose pas, même reformulés) :\n${ecartes.map((s) => "- " + s.texte).join("\n")}\n\n`
      : ""
  }${
    deja.length
      ? `Sujets déjà traités avec lui (n'y reviens que s'ils sont clairement rouverts) :\n${deja.map((s) => "- " + s.texte).join("\n")}\n\n`
      : ""
  }${
    captures.length ? `Ce que ${PRENOM} t'a poussé depuis ailleurs :\n\n${captures.join("\n\n")}\n\n` : ""
  }---\n\nConversations récentes :\n\n${
    excerpts.join("\n\n---\n\n") || "(aucune)"
  }\n\n---\n\nPropose les sujets pour cette nuit.`;

  const provider = fournisseurDeFond();
  const reqId = crypto.randomUUID();
  const { text, usage, model, stopReason, blocs } = await provider.complete({
    prive,
    system: `${SUGGEST_PROMPT}\n\n${CONSIGNE_MATIERE}`,
    prompt,
    model: SUGGEST_MODEL,
    // 600 jetons suffisaient quand le modèle n'écrivait que du JSON. Depuis
    // Sonnet 5, la réflexion se sert AVANT la réponse dans le même budget :
    // il en faut assez pour les deux, et un schéma pour garantir la forme.
    maxTokens: 4000,
    effort: "low",
    schema: SCHEMA_SUJETS,
  });
  await logCost("pré-réflexion", provider.name, model, usage, reqId, "Sujets pour cette nuit");

  let parsed;
  try {
    const brut = (text || "").trim();
    const debut = brut.indexOf("{");
    const fin = brut.lastIndexOf("}");
    if (debut === -1 || fin <= debut) throw new Error("pas de JSON");
    parsed = JSON.parse(brut.slice(debut, fin + 1));
  } catch {
    console.warn(
      "Pré-réflexion illisible (%d caractères, stop=%s, blocs=%s)",
      (text || "").length, stopReason || "?", (blocs || []).join(",") || "aucun",
    );
    throw new Error("Réponse de pré-réflexion illisible");
  }
  const clean = (s) => ({
    sujet: String(s?.sujet || "").trim().slice(0, 140),
    pourquoi: String(s?.pourquoi || "").trim().slice(0, 240),
  });
  const principal = clean(parsed.principal);
  if (!principal.sujet) throw new Error("Pré-réflexion sans sujet principal");
  const options = (Array.isArray(parsed.aussi) ? parsed.aussi : [])
    .slice(0, 2)
    .map(clean)
    .filter((s) => s.sujet);

  // « Ce soir, je compte réfléchir sur… » : le principal devient la consigne
  // immédiatement — Sam n'a rien à faire, il ne fait qu'arbitrer les extras.
  await putReflectionFocus(principal.sujet);
  return putReflectionSuggestions({ principal, options });
}
