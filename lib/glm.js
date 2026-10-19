// Fournisseur 3 : GLM-5.3 sur les deux DGX Spark de Sam.
//
// API compatible OpenAI (tensorfold), servie en tensor parallèle sur spark-2116
// et spark-1ef1. Vercel ne voit pas le réseau local : la requête passe par le
// relais de la tour (scripts/glm-relay.mjs), protégé par un jeton. Rien ne
// sort des machines de Sam, et aucun appel n'est facturé.
//
//   REMY_GLM_URL    base de l'API, ex. https://<tour>.ts.net:10000/v1
//   REMY_GLM_TOKEN  jeton du relais (Authorization: Bearer)
//   REMY_GLM_MODEL  identifiant servi (défaut GLM-5.3-Flash-EXL3)

import { appelsEcritsEnTexte, nettoyerSortie } from "./sortie.js";
import { inference, signalerSurcharge } from "./jobs.js";
import { chrono } from "./mesures.js";

export const GLM_LABEL = "glm-5.3"; // ce que l'app affiche sous une réponse
const GLM_MODEL = () => process.env.REMY_GLM_MODEL || "GLM-5.3-Flash-EXL3";
const ENTETES_MS = 8_000; // la tour éteinte ne doit pas faire attendre Sam
const SILENCE_MS = 60_000; // plus rien du flux pendant une minute : on coupe
const MAX_TOKENS = 16000;
// 80 s sous Vercel (coupure à 120 s), 4 min sur la tour.
export const budgetMs = () =>
  Number(process.env.REMY_BUDGET_MS) || (process.env.VERCEL ? 80_000 : 240_000);

export function glmConfigured() {
  return Boolean(process.env.REMY_GLM_URL);
}

const glmUrl = (chemin) => `${String(process.env.REMY_GLM_URL).replace(/\/+$/, "")}${chemin}`;
const glmEntetes = () => ({
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  ...(process.env.REMY_GLM_TOKEN ? { Authorization: `Bearer ${process.env.REMY_GLM_TOKEN}` } : {}),
});

// Erreur du modèle local. `avantTexte` : rien n'a encore été montré à Sam,
// on peut donc repasser par Claude sans réponse en double.
// `nature` : « injoignable » (tour ou Sparks éteintes : on le note pour une
// minute), « occupe » (429 : on réessaie une fois), « reponse » (le reste).
export class GlmError extends Error {
  constructor(message, { avantTexte = true, status = null, nature = "reponse" } = {}) {
    super(message);
    this.name = "GlmError";
    this.avantTexte = avantTexte;
    this.status = status;
    this.nature = nature;
  }
}

// tensorfold renvoie parfois la réflexion en clair, close par </think>.
const sansReflexion = (t) => String(t || "").replace(/^[\s\S]*<\/think>/, "").trim();

const aplatir = (system) =>
  Array.isArray(system) ? system.map((b) => b.text).join("\n\n") : String(system || "");

async function glmFetch(corps, signal) {
  let r;
  try {
    r = await fetch(glmUrl("/chat/completions"), {
      method: "POST",
      headers: glmEntetes(),
      body: JSON.stringify({ model: GLM_MODEL(), ...corps }),
      signal,
    });
  } catch (err) {
    const quoi = err.name === "TimeoutError" || err.name === "AbortError" ? "délai dépassé" : err.message;
    throw new GlmError(`Modèle local injoignable (${quoi})`, { nature: "injoignable" });
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new GlmError(
      r.status === 401
        ? "Modèle local : jeton du relais refusé (REMY_GLM_TOKEN)"
        : r.status === 429
          ? "Modèle local occupé (les Sparks sont déjà au maximum)"
          : `Modèle local : réponse ${r.status} ${detail.slice(0, 160)}`,
      { status: r.status, nature: r.status === 429 ? "occupe" : r.status >= 502 ? "injoignable" : "reponse" },
    );
  }
  return r;
}

// Une seule nouvelle tentative quand les Sparks sont occupées (Hermès s'en sert aussi).
async function glmFetchPatient(corps, signal) {
  try {
    return await glmFetch(corps, signal);
  } catch (err) {
    if (!(err instanceof GlmError) || err.nature !== "occupe") throw err;
    await new Promise((r) => setTimeout(r, 2500));
    return glmFetch(corps, signal);
  }
}

function usageDe(u) {
  return {
    input_tokens: u?.prompt_tokens || 0,
    output_tokens: u?.completion_tokens || 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    web_search_requests: 0,
  };
}

const versOpenAI = (t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.input_schema },
});

// Lit un flux SSE OpenAI. Rend le texte, les appels d'outils recomposés, la
// raison de fin et l'usage. Coupe si le flux se tait trop longtemps.
async function lireFlux(r, { onText, onReflexion, controleur, echeance }) {
  const lecteur = r.body.getReader();
  const decodeur = new TextDecoder();
  let tampon = "";
  let texte = "";
  let fin = null;
  let usage = null;
  const outils = []; // par index : { id, name, args }
  let termine = false; // [DONE] ou finish_reason vus : sinon la réponse est coupée
  let silence = setTimeout(() => controleur.abort(), SILENCE_MS);
  const dure = echeance ? setTimeout(() => controleur.abort(), Math.max(1000, echeance - Date.now())) : null;
  const traiter = (ligne) => {
    if (!ligne.startsWith("data:")) return;
    const data = ligne.slice(5).trim();
    if (data === "[DONE]") {
      termine = true;
      return;
    }
    if (!data) return;
    let evt;
    try {
      evt = JSON.parse(data);
    } catch {
      return;
    }
    if (evt.error) throw new GlmError(`Modèle local : ${evt.error.message || "erreur"}`, { avantTexte: !texte });
    if (evt.usage) usage = evt.usage;
    const choix = evt.choices?.[0];
    if (!choix) return;
    const d = choix.delta || {};
    if (d.reasoning_content) onReflexion?.();
    if (d.content) {
      texte += d.content;
      onText(d.content);
    }
    for (const tc of d.tool_calls || []) {
      const i = tc.index ?? outils.length;
      outils[i] ||= { id: "", name: "", args: "" };
      if (tc.id) outils[i].id = tc.id;
      if (tc.function?.name) outils[i].name += tc.function.name;
      if (tc.function?.arguments) outils[i].args += tc.function.arguments;
    }
    if (choix.finish_reason) {
      fin = choix.finish_reason;
      termine = true;
    }
  };
  try {
    while (true) {
      let lu;
      try {
        lu = await lecteur.read();
      } catch (err) {
        throw new GlmError(
          `Flux du modèle local coupé (${err.name === "AbortError" ? "délai dépassé" : err.message})`,
          { avantTexte: !texte, nature: "injoignable" },
        );
      }
      if (lu.done) break;
      clearTimeout(silence);
      silence = setTimeout(() => controleur.abort(), SILENCE_MS);
      tampon += decodeur.decode(lu.value, { stream: true });
      let nl;
      while ((nl = tampon.indexOf("\n")) !== -1) {
        const ligne = tampon.slice(0, nl).trim();
        tampon = tampon.slice(nl + 1);
        traiter(ligne);
      }
    }
    traiter(tampon.trim()); // dernière ligne sans retour final
  } finally {
    clearTimeout(silence);
    clearTimeout(dure);
  }
  // Un flux qui s'arrête sans fin annoncée est une réponse coupée, pas une
  // réponse complète : l'enregistrer telle quelle nourrirait la mémoire d'une
  // phrase tronquée.
  if (!termine) throw new GlmError("Réponse du modèle local coupée en route", { avantTexte: !texte, nature: "injoignable" });
  return { texte, outils: outils.filter(Boolean), fin, usage };
}

// Pas de nom de machine ni de modèle ici : le 09/10, Rémy a pris « Paramétrer le
// studio » (son appartement) pour « configurer les DGX Spark » qu'on lui citait.
const NOTE_GLM =
  "# Où tu tournes\n\nTu tournes en local, chez Sam : rien de cette conversation ne quitte ses machines. Ce détail technique ne concerne pas ses tâches : ne l'y mêle pas. " +
  "Ici tu n'as NI web_search NI web_fetch. Tu as browse_page pour ouvrir une URL précise ; pour une recherche sur le web, dis à Sam que tu ne peux pas chercher depuis le modèle local. " +
  "N'écris jamais ta réflexion dans la réponse : seulement ce que Sam doit lire.";

// `outils` : { liste (format Anthropic), noms, executer(name, input, onTool, compteurs) }
// — fournis par providers.js, pour que Claude et GLM partagent EXACTEMENT les
// mêmes garde-fous (aucune écriture Motion/agenda par le modèle).
export function creerGlmProvider(outils) {
  return sousGarde({
    name: "glm",

    // `reflexion` : GLM réfléchit avant de répondre (plus lent, plus juste).
    // `navigateur` : faux en conversation privée — une page piégée pourrait faire
    // ouvrir https://ailleurs/?q=<ce que Sam vient de confier>.
    // `signal` : l'arrêt demandé par Sam (lib/arret.js) coupe la requête en cours.
    async stream({ system, messages, onText, onTool, agendaActif = false, motionActif = true, lectureMotion = true, reflexion = true, effort = null, navigateur = true, signal }) {
      const tools = outils.liste(agendaActif, { navigateur, motionActif, lectureMotion }).map(versOpenAI);
      let convo = [
        { role: "system", content: `${aplatir(system)}\n\n${NOTE_GLM}` },
        ...messages.map((m) => ({ role: m.role, content: String(m.content ?? "") })),
      ];
      const compteurs = { browse: 0 };
      const usage = usageDe(null);
      let texte = "";
      let fin = null;
      let reflexionSignalee = false;
      const debut = Date.now();
      const BUDGET_MS = budgetMs();
      const echeance = debut + BUDGET_MS + 60_000; // au-delà, on coupe net
      let conclusionDemandee = false;

      for (let hop = 0; hop < 8; hop++) {
        if (signal?.aborted) throw new GlmError("Réponse interrompue", { avantTexte: !texte, nature: "arret" });
        if (!conclusionDemandee && Date.now() - debut > BUDGET_MS) {
          conclusionDemandee = true;
          onTool?.({ type: "budget" });
          convo = [
            ...convo,
            { role: "user", content: "Le temps imparti est presque écoulé. Conclus MAINTENANT avec ce que tu as, sans nouvel outil." },
          ];
        }
        const controleur = new AbortController();
        const entetes = setTimeout(() => controleur.abort(), ENTETES_MS);
        const corps = {
          messages: convo,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: MAX_TOKENS,
          chat_template_kwargs: { enable_thinking: Boolean(reflexion) && !conclusionDemandee },
        };
        // `effort` borne la réflexion du premier tour (« high » ≈ 200 jetons ; sans
        // effort, elle s'emballe : ~10 000 jetons et 4 min sur un tri Motion le
        // 09/10). Ensuite, quand il ne fait que lire des résultats d'outil, elle
        // reste légère (« medium »).
        if (reflexion) {
          const e = hop > 0 ? "medium" : effort;
          if (e) corps.reasoning_effort = e;
        }
        if (tools.length && !conclusionDemandee) corps.tools = tools;
        // Du départ de la requête au premier mot visible (1er tour seulement).
        const finPremier = hop === 0 ? chrono("glm.premier_jeton") : null;
        let r;
        try {
          r = await glmFetchPatient(corps, signal ? AbortSignal.any([controleur.signal, signal]) : controleur.signal);
        } catch (err) {
          if (err instanceof GlmError) err.avantTexte = !texte;
          throw err;
        } finally {
          clearTimeout(entetes);
        }
        // Texte avant un outil puis texte après : sans séparation, les deux
        // phrases se collent (« c'est en place.Voilà… »).
        let separer = Boolean(texte) && !/\s$/.test(texte);
        let premierVu = false;
        const tour = await lireFlux(r, {
          controleur,
          echeance,
          onText: (t) => {
            if (!premierVu && finPremier) {
              premierVu = true;
              finPremier();
            }
            if (separer) {
              separer = false;
              texte += "\n\n";
              onText("\n\n");
            }
            texte += t;
            onText(t);
          },
          onReflexion: () => {
            if (reflexionSignalee) return;
            reflexionSignalee = true;
            onTool?.({ type: "reflexion" });
          },
        });
        const u = usageDe(tour.usage);
        usage.input_tokens += u.input_tokens;
        usage.output_tokens += u.output_tokens;
        fin = tour.fin;

        let appels = tour.outils.filter((o) => outils.noms.includes(o.name));
        // GLM écrit parfois son appel d'outil en texte au lieu de l'émettre : un
        // appel complet est exécuté quand même (il ne fait que proposer), le
        // texte est nettoyé à la fin de la réponse (lib/sortie.js).
        if (!appels.length && tour.texte.includes("<tool_call>")) {
          appels = appelsEcritsEnTexte(tour.texte)
            .filter((a) => outils.noms.includes(a.name))
            .map((a, i) => ({ id: `texte_${hop}_${i}`, name: a.name, args: JSON.stringify(a.args) }));
          if (appels.length) fin = "tool_calls";
        }
        if (fin !== "tool_calls" || !appels.length) break;
        const resultats = [];
        for (const appel of appels) {
          let input = null;
          try {
            input = JSON.parse(appel.args || "{}");
          } catch {}
          const payload = input
            ? await outils.executer(appel.name, input, onTool, compteurs)
            : { erreur: "Arguments illisibles (JSON invalide)." };
          resultats.push({ role: "tool", tool_call_id: appel.id, content: JSON.stringify(payload) });
        }
        convo = [
          ...convo,
          {
            role: "assistant",
            content: nettoyerSortie(tour.texte) || null,
            tool_calls: appels.map((a) => ({
              id: a.id,
              type: "function",
              function: { name: a.name, arguments: a.args || "{}" },
            })),
          },
          ...resultats,
        ];
      }
      const stopReason = fin === "length" ? "max_tokens" : fin === "tool_calls" ? "tool_use" : "end_turn";
      return { text: texte, stopReason, usage, model: GLM_LABEL };
    },

    // Tâche courte non streamée (routeur, titre, mémoire). Réflexion coupée par
    // défaut : ces tâches sont mécaniques, et la réflexion mange le budget.
    // `schema` : sortie JSON structurée (tensorfold accepte response_format).
    async complete({ system, prompt, maxTokens = 4000, reflexion = false, delaiMs = 180_000, schema }) {
      const corps = {
        messages: [
          { role: "system", content: aplatir(system) },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
        chat_template_kwargs: { enable_thinking: Boolean(reflexion) },
      };
      if (schema) corps.response_format = { type: "json_schema", json_schema: { name: "reponse", schema } };
      const fin = chrono("glm.complete");
      const r = await glmFetchPatient(corps, AbortSignal.timeout(delaiMs));
      const j = await r.json().catch(() => null);
      const choix = j?.choices?.[0];
      if (!choix) throw new GlmError("Modèle local : réponse illisible");
      fin({ jetons: j?.usage?.completion_tokens ?? null });
      return {
        text: sansReflexion(choix.message?.content),
        stopReason: choix.finish_reason === "length" ? "max_tokens" : "end_turn",
        usage: usageDe(j.usage),
        model: GLM_LABEL,
      };
    },
  });
}

// Garde de charge (lib/jobs.js, J0.9) : chaque inférence vers les Sparks y
// passe. Celle d'un job attend une place ; celle de Sam part tout de suite.
// Un 429 des Sparks diffère le travail de fond d'une minute.
function sousGarde(p) {
  for (const m of ["stream", "complete"]) {
    const brut = p[m];
    p[m] = (args) =>
      inference(async () => {
        try {
          return await brut.call(p, args);
        } catch (err) {
          if (err instanceof GlmError && err.nature === "occupe") signalerSurcharge(60_000, "occupées (429)");
          throw err;
        }
      });
  }
  return p;
}

// Le modèle local répond-il ? Pour /api/health, et pour aiguiller sans attendre
// huit secondes à chaque message quand la tour est éteinte.
let cache = { at: 0, ok: false, verdict: null };
export async function verifierGlm({ maxAgeMs = 60_000 } = {}) {
  if (!glmConfigured()) return { ok: false, verdict: "— non branché (REMY_GLM_URL)" };
  if (Date.now() - cache.at < maxAgeMs && cache.verdict) return cache;
  let ok = false;
  let verdict;
  try {
    const r = await fetch(glmUrl("/models"), { headers: glmEntetes(), signal: AbortSignal.timeout(5000) });
    const j = await r.json().catch(() => null);
    ok = r.ok;
    verdict = r.ok
      ? `✅ joignable (${j?.data?.[0]?.id || GLM_MODEL()})`
      : r.status === 401
        ? "❌ jeton du relais refusé (REMY_GLM_TOKEN)"
        : `⚠️ réponse ${r.status} du relais`;
  } catch (err) {
    verdict = `⚠️ injoignable (${err.name === "TimeoutError" ? "délai dépassé" : err.message}) — Rémy passe par Claude, conversations privées en pause`;
  }
  cache = { at: Date.now(), ok, verdict };
  return cache;
}

// Un échec en pleine conversation invalide aussitôt le verdict : les messages
// suivants ne réessaient pas une tour éteinte pendant une minute.
export function glmEnPanne(raison = "dernier appel échoué") {
  cache = { at: Date.now(), ok: false, verdict: `⚠️ ${raison} — Rémy passe par Claude, conversations privées en pause` };
}
export function glmRepond() {
  if (!cache.ok) cache = { at: Date.now(), ok: true, verdict: "✅ joignable" };
}
