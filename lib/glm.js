// Fournisseur 3 : le modèle local, sur les deux DGX Spark de Sam (GLM-5.3
// jusqu'au 20/10, puis ce que les Sparks chargent : Rémy le suit tout seul).
//
// API compatible OpenAI (tensorfold), servie en tensor parallèle sur les deux
// Sparks. Vercel ne voit pas le réseau local : la requête passe par le
// relais de la tour (scripts/glm-relay.mjs), protégé par un jeton. Rien ne
// sort des machines de Sam, et aucun appel n'est facturé.
//
//   REMY_GLM_URL    base de l'API, ex. https://<tour>.ts.net:10000/v1
//   REMY_GLM_TOKEN  jeton du relais (Authorization: Bearer)
//   REMY_GLM_MODEL  modèle préféré, s'il est servi (sinon celui que les Sparks servent)
//   REMY_GLM_CONTEXTE  taille max du contexte, si le serveur ne la déclare pas
//   REMY_GLM_MACHINE   où il tourne, tel que l'app l'affiche (défaut « DGX Spark »)

import { suiviReflexion } from "./etapes.js";
import { compteurDebit, contexteDe, fenetreDeclaree } from "./debit.js";
import { appelEcritEnTexte, appelsEcritsEnTexte, nettoyerSortie } from "./sortie.js";
import { inference, signalerSurcharge } from "./jobs.js";
import { chrono } from "./mesures.js";
import { PRENOM } from "./profil.js";
import { getReglages } from "./store.js";
import { consigneRecherche, cleUrl, urlsDuTexte } from "./recherche.js";
import { consigneRechercher, consigneRelance } from "./salle-blanche.js";
import { modeRecherche } from "./recherche-rapide.js";

// Si les Sparks ne disent pas ce qu'elles servent (et rien n'est réglé).
const MODELE_DEFAUT = "GLM-5.3-Flash-EXL3";
export const machineGlm = () => process.env.REMY_GLM_MACHINE || "DGX Spark";
const ENTETES_MS = 8_000; // la tour éteinte ne doit pas faire attendre Sam
const SILENCE_MS = 60_000; // plus rien du flux pendant une minute : on coupe
const MAX_TOKENS = 16000;
// 80 s sous Vercel (coupure à 120 s), 4 min sur la tour.
export const budgetMs = () =>
  Number(process.env.REMY_BUDGET_MS) || (process.env.VERCEL ? 80_000 : 240_000);
// Après le budget, le temps laissé pour conclure (lire le contexte, écrire).
const margeMs = () => Number(process.env.REMY_MARGE_MS) || 90_000;
const TROP_LONG = (ms) =>
  `Rémy a travaillé plus de ${Math.round(ms / 60_000)} minutes sans finir sa réponse : la demande est sans doute très longue ou très ouverte. ` +
  "Le modèle local tourne bien. Réessaie, ou découpe-la en deux ou trois messages.";

export function glmConfigured() {
  return Boolean(process.env.REMY_GLM_URL);
}

// --- Le modèle servi -------------------------------------------------------
// Les Sparks passent d'un modèle à l'autre (20/10 : GLM-5.3 → DeepSeek). Rémy
// prend, dans l'ordre : le modèle choisi dans l'app (Réglages › Modèle), puis
// REMY_GLM_MODEL — chacun tant que les Sparks le servent encore — sinon le
// premier qu'elles déclarent sur /v1/models.
let servis = { liste: null, a: 0, echec: false }; // [{ id, fenetre }]
let dernier = null; // { id, source } : le modèle du dernier appel
let choix = { valeur: undefined, a: 0 };
let prevenu = "";

// « zai-org/GLM-5.3-FP8 » → « GLM-5.3 » : ce que l'app affiche sous une réponse.
export function libelleModele(id) {
  const nom = String(id || "").split("/").pop();
  return nom.replace(/[-_.](?:EXL\d|AWQ|GPTQ|GGUF|MLX|NVFP4|FP8|FP4|INT[48]|W4A16|\d+(?:\.\d+)?bpw)\b.*$/i, "") || nom;
}

function noterServis(j) {
  const liste = (Array.isArray(j?.data) ? j.data : [])
    .filter((x) => x && typeof x.id === "string" && x.id)
    .map((x) => ({ id: x.id, fenetre: fenetreDeclaree(x) }));
  servis = { liste, a: Date.now(), echec: false };
  return liste;
}

// Ce que les Sparks servent, relu au plus toutes les minutes (15 s après un
// échec : une tour éteinte ne fait pas attendre chaque message).
export async function modelesServis({ frais = false } = {}) {
  if (!glmConfigured()) return [];
  const age = Date.now() - servis.a;
  if (!frais && servis.a && age < (servis.echec ? 15_000 : 60_000)) return servis.liste || [];
  try {
    const r = await fetch(glmUrl("/models"), { headers: glmEntetes(), signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(String(r.status));
    return noterServis(await r.json());
  } catch {
    servis = { liste: servis.liste, a: Date.now(), echec: true }; // l'ancienne liste vaut mieux que rien
    return servis.liste || [];
  }
}
export const sparksRepondent = () => Boolean(servis.a) && !servis.echec;

async function modeleChoisi() {
  if (choix.valeur !== undefined && Date.now() - choix.a < 30_000) return choix.valeur;
  let v = null;
  try {
    v = (await getReglages()).modeleLocal || null;
  } catch {}
  choix = { valeur: v, a: Date.now() };
  return v;
}
export const oublierChoixModele = () => {
  choix = { valeur: undefined, a: 0 };
};

// { id, source } — source : « choisi » (app), « tour » (REMY_GLM_MODEL),
// « auto » (ce que les Sparks servent), « defaut » (rien n'est connu).
export async function modeleActif() {
  const ids = (await modelesServis()).map((m) => m.id);
  const sert = (id) => Boolean(id) && (!ids.length || ids.includes(id));
  const choisi = await modeleChoisi();
  const tour = process.env.REMY_GLM_MODEL || null;
  let actif;
  if (sert(choisi)) actif = { id: choisi, source: "choisi" };
  else if (sert(tour)) actif = { id: tour, source: "tour" };
  else if (ids.length) actif = { id: ids[0], source: "auto" };
  else actif = { id: MODELE_DEFAUT, source: "defaut" };
  const parti = [choisi, tour].find((x) => x && ids.length && !ids.includes(x));
  if (parti && prevenu !== `${parti}>${actif.id}`) {
    prevenu = `${parti}>${actif.id}`;
    console.warn(`Modèle local : « ${parti} » n'est plus servi par les Sparks, Rémy prend « ${actif.id} ».`);
  }
  if (dernier && dernier.id !== actif.id) fenetreConnue = null; // autre modèle, autre taille de contexte
  dernier = actif;
  return actif;
}

// Synchrones, pour la jauge et les journaux : le modèle du dernier appel.
export const modeleGlm = () => dernier?.id || process.env.REMY_GLM_MODEL || MODELE_DEFAUT;
export const libelleLocal = () => libelleModele(modeleGlm());

// --- Réflexion en clair ------------------------------------------------------
// Un serveur qui ne sait pas séparer la réflexion d'un modèle (nouveau modèle,
// gabarit inconnu) la renvoie dans le texte, close par </think>. Tant qu'on ne
// sait pas ce que fait le modèle, le texte attend la fin de la réflexion au
// lieu de la montrer à Sam ; ensuite, on s'en souvient (par modèle).
const enClair = new Map(); // id → true (réflexion dans le texte) | false (jamais)
const reflexionEnClair = (id) => enClair.get(id);
function noterReflexionEnClair(id, oui) {
  if (enClair.get(id) === true && !oui) return; // vue une fois en clair : on reste prudent
  enClair.set(id, oui);
}
export const oublierReflexionEnClair = () => enClair.clear();

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

// Réfléchir ou non : GLM et Qwen lisent `enable_thinking`, DeepSeek `thinking`.
// Un gabarit ignore le paramètre qu'il ne connaît pas : on envoie les deux.
const reflechir = (oui) => ({ enable_thinking: Boolean(oui), thinking: Boolean(oui) });

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
      body: JSON.stringify({ model: (await modeleActif()).id, ...corps }),
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
// `onMorceau` reçoit tout ce que le modèle produit (réflexion, texte,
// arguments d'outils) : c'est ce qui compte pour le débit.
async function lireFlux(r, { onText, onReflexion, onMorceau, controleur, echeance, reflexionAttendue = false }) {
  const lecteur = r.body.getReader();
  const decodeur = new TextDecoder();
  let tampon = "";
  let texte = "";
  let fin = null;
  let usage = null;
  const outils = []; // par index : { id, name, args }
  let termine = false; // [DONE] ou finish_reason vus : sinon la réponse est coupée
  // Réflexion demandée à un modèle dont on ne sait pas encore si le serveur la
  // range à part : le texte attend, au cas où elle arriverait en clair, close
  // par </think> (lib/glm.js, « Réflexion en clair »).
  const modele = modeleGlm();
  let enAttente = reflexionAttendue && reflexionEnClair(modele) !== false ? "" : null;
  let separee = false;
  let apresReflexion = false; // les blancs qui suivent </think> ne s'affichent pas
  const ecrire = (t) => {
    if (apresReflexion) t = t.replace(/^\s+/, "");
    if (!t) return;
    apresReflexion = false;
    texte += t;
    onText(t);
  };
  const lacher = () => {
    if (enAttente === null) return;
    const t = enAttente.replace(/^\s*<think>\s*/, "");
    enAttente = null;
    ecrire(t);
  };
  let silence = setTimeout(() => controleur.abort(), SILENCE_MS);
  const dure = echeance
    ? setTimeout(() => {
        controleur.raison ||= "echeance";
        controleur.abort();
      }, Math.max(1000, echeance - Date.now()))
    : null;
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
    const reflexion = d.reasoning_content ?? d.reasoning;
    if (typeof reflexion === "string" && reflexion) {
      separee = true;
      onMorceau?.(reflexion);
      onReflexion?.(reflexion);
      lacher(); // le serveur range la réflexion à part : le texte est du texte
    }
    if (d.content) {
      onMorceau?.(d.content);
      if (enAttente === null) {
        if (d.content.includes("</think>")) noterReflexionEnClair(modele, true); // pour la prochaine fois
        ecrire(d.content);
      } else {
        enAttente += d.content;
        const i = enAttente.indexOf("</think>");
        if (i !== -1) {
          const avant = enAttente.slice(0, i).replace(/^\s*<think>/, "").trim();
          const apres = enAttente.slice(i + "</think>".length);
          enAttente = null;
          apresReflexion = true;
          noterReflexionEnClair(modele, true);
          if (avant) onReflexion?.(avant);
          ecrire(apres);
        }
      }
    }
    for (const tc of d.tool_calls || []) {
      const i = tc.index ?? outils.length;
      outils[i] ||= { id: "", name: "", args: "" };
      if (tc.id) outils[i].id = tc.id;
      if (tc.function?.name) outils[i].name += tc.function.name;
      if (tc.function?.arguments) {
        onMorceau?.(tc.function.arguments);
        outils[i].args += tc.function.arguments;
      }
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
        // Coupé par l'échéance de la réponse : le modèle travaillait, il n'est
        // pas en panne (« delai »). Coupé par le silence ou le réseau : « injoignable ».
        throw new GlmError(
          `Flux du modèle local coupé (${err.name === "AbortError" ? "délai dépassé" : err.message})`,
          { avantTexte: !texte, nature: controleur.raison === "echeance" ? "delai" : "injoignable" },
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
  // Fini sans </think> : c'était la réponse, sans réflexion écrite.
  if (enAttente !== null && termine) {
    if (!separee) noterReflexionEnClair(modele, false);
    lacher();
  }
  // Un flux qui s'arrête sans fin annoncée est une réponse coupée, pas une
  // réponse complète : l'enregistrer telle quelle nourrirait la mémoire d'une
  // phrase tronquée.
  if (!termine) throw new GlmError("Réponse du modèle local coupée en route", { avantTexte: !texte, nature: "injoignable" });
  return { texte, outils: outils.filter(Boolean), fin, usage };
}

// Pas de nom de machine ni de modèle ici : le 09/10, Rémy a pris « Paramétrer le
// studio » (son appartement) pour « configurer les DGX Spark » qu'on lui citait.
// `recherche` : chercher_web et lire_page sont là (lib/recherche.js, 25/10) ;
// `rechercher` : la recherche passe par l'outil rechercher — salle blanche
// (lib/salle-blanche.js) ou, en modes direct et hybride, la tour elle-même
// (lib/recherche-rapide.js, `parLaTour`) ; `matiere` : la tour a déjà cherché
// pour ce message, les passages sont joints au message de Sam (29/10) ;
// sinon (conversation privée, recherche coupée) il dit qu'il ne peut pas chercher.
const noteGlm = ({ recherche = false, rechercher = false, navigateur = false, matiere = false, parLaTour = false, budget = null } = {}) =>
  `# Où tu tournes\n\nTu tournes en local, chez ${PRENOM} : la conversation reste sur ses machines. Ce détail technique ne concerne pas ses tâches : ne l'y mêle pas. ` +
  (rechercher
    ? "Tu n'as NI web_search NI web_fetch : pour le web, tu as l'outil rechercher (voir « Chercher sur le web »). "
    : matiere
      ? `Tu n'as NI web_search NI web_fetch : pour ce message, la tour a déjà cherché sur le web pour toi, et les passages lus sont joints au message de ${PRENOM} ; pas d'autre recherche. `
      : recherche
        ? "Tu n'as NI web_search NI web_fetch : ils s'appellent ici chercher_web et lire_page (voir « Chercher sur le web »). "
        : `Ici tu n'as NI web_search NI web_fetch.${navigateur ? " Tu as browse_page pour ouvrir une URL précise ;" : ""} Pour une recherche sur le web, dis à ${PRENOM} que tu ne peux pas chercher d'ici. `) +
  `N'écris jamais ta réflexion dans la réponse : seulement ce que ${PRENOM} doit lire.` +
  (rechercher
    ? `\n\n${matiere ? consigneRelance() : consigneRechercher({ parLaTour, ...(budget ? { budget } : {}) })}`
    : recherche
      ? `\n\n${consigneRecherche()}`
      : "");

// `outils` : { liste (format Anthropic), noms, executer(name, input, onTool, compteurs),
// budget() (appels d'outils web permis par message) }
// — fournis par providers.js, pour que Claude et GLM partagent EXACTEMENT les
// mêmes garde-fous (aucune écriture Motion/agenda par le modèle).
export function creerGlmProvider(outils) {
  return sousGarde({
    name: "glm",

    // `reflexion` : GLM réfléchit avant de répondre (plus lent, plus juste).
    // `navigateur` : faux en conversation privée — une page piégée pourrait faire
    // ouvrir https://ailleurs/?q=<ce que Sam vient de confier>.
    // `signal` : l'arrêt demandé par Sam (lib/arret.js) coupe la requête en cours.
    // `onDebit({ tps, jetons })` : la vitesse d'écriture en direct (jauge du chat).
    // `recherche` : la recherche web locale — l'outil rechercher (salle blanche),
    // ou chercher_web et lire_page (REMY_SALLE_BLANCHE=off, jamais sans `navigateur`).
    // `filtre` : le filtre des requêtes sortantes (lib/filtre-sortie.js).
    // `salleBlanche` : CETTE boucle est la salle blanche (lib/salle-blanche.js) :
    // le prompt est celui qu'on lui donne, rien n'y est ajouté (pas même le
    // prénom de Sam) ; `connues` : les adresses que Sam a données ; `duree` :
    // { budget, marge } en ms, à la place des budgets de la réponse.
    // `premiereRecherche` (salle blanche) : la tour lance elle-même ce premier
    // chercher_web avant le premier appel au modèle — un appel de moins.
    // Recherche rapide (29/10, lib/recherche-rapide.js) : `webDeja` — ce que la
    // tour a déjà cherché et lu pour ce message (vérification des chiffres) ;
    // `matiereJointe` : ses passages sont dans le message de Sam ;
    // `rechercherMax` : budget de rechercher pour ce message (1 : une relance) ;
    // `effortSuite` : la réflexion des tours qui suivent un outil.
    async stream({ system, messages, onText, onTool, onDebit, agendaActif = false, motionActif = true, lectureMotion = true, reflexion = true, effort = null, effortSuite = "medium", navigateur = true, recherche = false, filtre = null, salleBlanche = false, connues: connuesDonnees = null, duree = null, premiereRecherche = null, webDeja = null, matiereJointe = false, rechercherMax: budgetRechercher = null, signal }) {
      const tools = outils.liste(agendaActif, { navigateur, motionActif, lectureMotion, recherche, salleBlanche }).map(versOpenAI);
      const aOutil = (nom) => tools.some((t) => t.function.name === nom);
      const cherche = aOutil("chercher_web");
      const rechercher = aOutil("rechercher");
      // À qui s'adressent les relances : la salle blanche ne connaît pas son prénom.
      const qui = salleBlanche ? "l'assistant" : PRENOM;
      let convo = [
        {
          role: "system",
          content: salleBlanche
            ? aplatir(system)
            : `${aplatir(system)}\n\n${noteGlm({ recherche: cherche, rechercher, navigateur: aOutil("browse_page"), matiere: Boolean(matiereJointe), parLaTour: modeRecherche() !== "salle", budget: budgetRechercher })}`,
        },
        ...messages.map((m) => ({ role: m.role, content: String(m.content ?? "") })),
      ];
      // `lus` (pages lues) et `extraits` (résultats de recherche) : ce que Rémy a
      // vu sur le web pendant ce tour, pour vérifier ensuite les chiffres de sa
      // réponse (lib/recherche.js) ; `tentatives` / `abouties` : recherches et
      // lectures essayées / réussies. `connues` : les adresses qu'il peut ouvrir
      // (celles des messages de Sam, puis les résultats de chercher_web).
      // `sures` : les adresses qu'aucun modèle n'a écrites (résultats du moteur,
      // liens de Sam hors conversation privée) — le filtre ne les relit pas.
      // `stop` : la salle blanche a vu une requête refusée — elle conclut.
      const offerts = new Set(tools.map((t) => t.function.name));
      const deSam = filtre?.prive ? [] : messages.filter((m) => m.role === "user").flatMap((m) => urlsDuTexte(m.content)).map(cleUrl).filter(Boolean);
      const connues = salleBlanche ? new Set(connuesDonnees || []) : cherche || rechercher ? new Set(deSam) : null;
      const compteurs = {
        browse: 0, recherche: 0, lecture: 0, tentatives: webDeja?.tentatives || 0, abouties: webDeja?.abouties || 0,
        lus: [...(webDeja?.pages || [])], extraits: [...(webDeja?.extraits || [])], pages: [...(webDeja?.pagesLues || [])], connues,
        sures: new Set(connues || []), filtre, salleBlanche, signal, rechercher: 0, stop: false,
        ...(budgetRechercher ? { rechercherMax: budgetRechercher } : {}),
      };
      const usage = usageDe(null);
      // La jauge : débit en direct, et la place prise au dernier appel.
      const fenetre = fenetreGlm().catch(() => null);
      const debit = compteurDebit((d) => onDebit?.(d));
      const longueur = (m) => String(m.content ?? "").length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
      const cars = { systeme: convo[0].content.length, conversation: convo.slice(1).reduce((n, m) => n + longueur(m), 0), outils: 0 };
      let dernierAppel = null; // { entree, sortie, cars }
      let texte = "";
      let fin = null;
      // Un signal tout de suite, puis un extrait de la réflexion au plus toutes
      // les 1,5 s (lib/etapes.js) : la barre du chat reste lisible.
      const reflexionSuivie = suiviReflexion((extrait) => onTool?.({ type: "reflexion", extrait }));
      const debut = Date.now();
      const BUDGET_MS = duree?.budget ?? budgetMs();
      const MARGE_MS = duree?.marge ?? margeMs();
      const echeance = debut + BUDGET_MS + MARGE_MS; // au-delà, on coupe net
      let conclusionDemandee = false;
      if (premiereRecherche && offerts.has("chercher_web")) {
        // Comme si le modèle l'avait demandé : il lit les résultats et choisit
        // la page à lire, sans un appel pour écrire la requête.
        const args = JSON.stringify({ requete: String(premiereRecherche).slice(0, 200) });
        const payload = await outils.executer("chercher_web", JSON.parse(args), onTool, compteurs);
        const ajout = [
          { role: "assistant", content: null, tool_calls: [{ id: "recherche_tour", type: "function", function: { name: "chercher_web", arguments: args } }] },
          { role: "tool", tool_call_id: "recherche_tour", content: JSON.stringify(payload) },
        ];
        convo = [...convo, ...ajout];
        cars.outils += ajout.reduce((n, m) => n + longueur(m), 0);
      }

      // Chercher, lire quelques pages, puis répondre : autant de tours d'outils
      // que le budget d'appels web en permet (+ 2 pour le reste). Ensuite, un
      // tour SANS outil où il conclut, et au besoin une relance s'il n'a rien
      // écrit : jamais de réponse vide sans un mot (relecture du 25/10).
      const tours = cherche ? (outils.budget?.() ?? 10) + 2 : 8;
      let conclureAuProchain = false;
      let relanceVide = false;
      for (let hop = 0; hop < tours + 2; hop++) {
        if (signal?.aborted) throw new GlmError("Réponse interrompue", { avantTexte: !texte, nature: "arret" });
        if (!conclusionDemandee && Date.now() - debut > BUDGET_MS) {
          conclusionDemandee = true;
          onTool?.({ type: "budget" });
          const relance = { role: "user", content: "Le temps imparti est presque écoulé. Conclus MAINTENANT avec ce que tu as, sans nouvel outil." };
          convo = [...convo, relance];
          cars.conversation += longueur(relance);
        } else if (!conclusionDemandee && tools.length && (hop >= tours || conclureAuProchain || compteurs.stop)) {
          conclusionDemandee = true;
          onTool?.({ type: "budget" });
          const relance = {
            role: "user",
            content: "Tu as utilisé tous tes appels d'outils pour ce message. Réponds MAINTENANT avec ce que tu as lu, sans nouvel outil ; dis franchement ce qui manque.",
          };
          convo = [...convo, relance];
          cars.conversation += longueur(relance);
        }
        const controleur = new AbortController();
        const entetes = setTimeout(() => controleur.abort(), ENTETES_MS);
        const corps = {
          messages: convo,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: MAX_TOKENS,
          chat_template_kwargs: reflechir(reflexion && !conclusionDemandee),
        };
        // `effort` borne la réflexion du premier tour (« high » ≈ 200 jetons ; sans
        // effort, elle s'emballe : ~10 000 jetons et 4 min sur un tri Motion le
        // 09/10). Ensuite, quand il ne fait que lire des résultats d'outil, elle
        // reste légère (« medium »).
        if (reflexion && !conclusionDemandee) {
          const e = hop > 0 ? effortSuite : effort;
          if (e) corps.reasoning_effort = e;
        }
        if (tools.length && !conclusionDemandee) corps.tools = tools;
        // Du départ de la requête au premier mot visible (1er tour seulement).
        const finPremier = hop === 0 ? chrono("glm.premier_jeton") : null;
        const carsAppel = { ...cars };
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
        // Le budget passé alors que Rémy réfléchit encore sans avoir rien écrit :
        // on l'arrête, et il conclut à partir de ses notes. Sans ça, une longue
        // dictée (19/10, ~8 min de parole) faisait réfléchir GLM jusqu'à la
        // coupure sèche des 5 min — et Sam n'avait rien, avec « GLM ne répond pas ».
        let texteVu = false;
        let notes = "";
        const garde =
          reflexion && !conclusionDemandee
            ? setTimeout(() => {
                if (texteVu) return;
                controleur.raison = "budget";
                controleur.abort();
              }, Math.max(0, debut + BUDGET_MS - Date.now()))
            : null;
        let tour;
        try {
          tour = await lireFlux(r, {
            controleur,
            echeance,
            reflexionAttendue: Boolean(reflexion) && !conclusionDemandee,
            onText: (t) => {
              texteVu = true;
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
            onReflexion: (x) => {
              if (notes.length < 40_000) notes += x;
              reflexionSuivie(x);
            },
            onMorceau: debit.morceau,
          });
        } catch (err) {
          if (controleur.raison === "budget") {
            tour = null;
          } else if (err instanceof GlmError && err.nature === "delai") {
            // Coupée en pleine écriture : la réponse partielle est gardée, et
            // dite ; sans rien d'écrit, une erreur claire (pas « injoignable »).
            if (!texte) throw new GlmError(TROP_LONG(BUDGET_MS + MARGE_MS), { avantTexte: true, nature: "delai" });
            debit.finTour(null);
            return { text: texte, stopReason: "coupe", usage, model: libelleLocal(), mesures: await mesuresDe(debit, dernierAppel, fenetre) };
          } else {
            throw err;
          }
        } finally {
          clearTimeout(garde);
        }
        if (!tour) {
          debit.finTour(null);
          conclusionDemandee = true;
          onTool?.({ type: "budget", raison: "reflexion" });
          const ajout = [
            ...(notes.trim()
              ? [{ role: "assistant", content: `(Mes notes de réflexion, arrêtées faute de temps — ${qui} ne les a pas vues.)\n${notes.trim().slice(-8000)}` }]
              : []),
            {
              role: "user",
              content:
                "Le temps imparti est écoulé. Réponds MAINTENANT à partir de ces notes, sans nouvel outil et sans réfléchir davantage : " +
                "l'essentiel d'abord ; s'il reste des points que tu n'as pas pu traiter, dis lesquels.",
            },
          ];
          convo = [...convo, ...ajout];
          cars.conversation += ajout.reduce((n, m) => n + longueur(m), 0);
          continue;
        }
        const u = usageDe(tour.usage);
        usage.input_tokens += u.input_tokens;
        usage.output_tokens += u.output_tokens;
        debit.finTour(tour.usage ? u.output_tokens : null);
        dernierAppel = { entree: u.input_tokens, sortie: u.output_tokens, cars: carsAppel };
        fin = tour.fin;

        // Seuls les outils OFFERTS à ce tour s'exécutent : un appel à un outil
        // absent (conversation privée sans outil web, conclusion demandée, nom
        // inventé comme « web_search ») reçoit une erreur, jamais une exécution.
        const permis = conclusionDemandee ? new Set() : offerts;
        let appels = tour.outils;
        // GLM écrit parfois son appel d'outil en texte au lieu de l'émettre : un
        // appel complet est exécuté quand même (il ne fait que proposer), le
        // texte est nettoyé à la fin de la réponse (lib/sortie.js).
        if (!appels.length && appelEcritEnTexte(tour.texte)) {
          appels = appelsEcritsEnTexte(tour.texte)
            .filter((a) => permis.has(a.name))
            .map((a, i) => ({ id: `texte_${hop}_${i}`, name: a.name, args: JSON.stringify(a.args) }));
          if (appels.length) fin = "tool_calls";
        }
        if (fin !== "tool_calls" || !appels.length) {
          // Rien d'écrit pour Sam (réflexion seule, appels ignorés…) : une
          // relance, sans outil, avant d'abandonner.
          if (!texte.trim() && !relanceVide && !signal?.aborted && hop < tours + 1) {
            relanceVide = true;
            conclusionDemandee = true;
            const relance = { role: "user", content: `Tu n'as encore rien écrit à ${qui}. Réponds-lui MAINTENANT en texte, sans outil, avec ce que tu as.` };
            convo = [...convo, ...(tour.texte?.trim() ? [{ role: "assistant", content: nettoyerSortie(tour.texte) }] : []), relance];
            cars.conversation += longueur(relance);
            continue;
          }
          break;
        }
        const resultats = [];
        let refusBudget = 0;
        for (const appel of appels) {
          let input = null;
          try {
            input = JSON.parse(appel.args || "{}");
          } catch {}
          const payload = !permis.has(appel.name)
            ? {
                erreur:
                  `Outil inconnu ou indisponible ici : ${String(appel.name).slice(0, 60)}.` +
                  (conclusionDemandee ? " Plus d'outil pour ce message : réponds maintenant avec ce que tu as." : "") +
                  (!conclusionDemandee && offerts.has("chercher_web") ? " Pour chercher sur le web : chercher_web ; pour lire une page : lire_page." : "") +
                  (!conclusionDemandee && offerts.has("rechercher") ? " Pour chercher sur le web : rechercher, avec une question complète." : ""),
              }
            : input
              ? await outils.executer(appel.name, input, onTool, compteurs)
              : { erreur: "Arguments illisibles (JSON invalide)." };
          if (/^Budget /.test(payload?.erreur || "")) refusBudget++;
          resultats.push({ role: "tool", tool_call_id: appel.id, content: JSON.stringify(payload) });
        }
        // Tous ses appels refusés faute de budget : il tourne en rond, il conclut.
        // Salle blanche et requête refusée par le filtre : elle conclut aussi.
        if (refusBudget === appels.length || compteurs.stop) conclureAuProchain = true;
        const ajout = [
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
        convo = [...convo, ...ajout];
        cars.outils += ajout.reduce((n, m) => n + longueur(m), 0);
      }
      const stopReason = fin === "length" ? "max_tokens" : fin === "tool_calls" ? "tool_use" : "end_turn";
      // `web` : ce que la recherche locale a vu (pages, extraits) et tenté, pour
      // la vérification des chiffres (lib/chat.js) ; absent sans aucune tentative.
      // `pagesLues` : les mêmes pages, avec leur adresse et leur date (salle blanche).
      const web = compteurs.tentatives
        ? { web: { pages: compteurs.lus, extraits: compteurs.extraits, tentatives: compteurs.tentatives, abouties: compteurs.abouties, pagesLues: compteurs.pages } }
        : {};
      // `arretFiltre` : la salle blanche a été arrêtée par le filtre des requêtes.
      return { text: texte, stopReason, usage, model: libelleLocal(), mesures: await mesuresDe(debit, dernierAppel, fenetre), ...web, ...(compteurs.stop ? { arretFiltre: true } : {}) };
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
        chat_template_kwargs: reflechir(reflexion),
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
        model: libelleLocal(),
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
    if (r.ok) {
      noterServis(j);
      noterFenetre(j);
    }
    verdict = r.ok
      ? `✅ joignable (${j?.data?.[0]?.id || modeleGlm()})`
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

// --- La jauge du chat : la taille du contexte du modèle ----------------------
// REMY_GLM_CONTEXTE si la tour la règle ; sinon ce que le serveur du modèle
// déclare (/v1/models), relu toutes les heures (5 min s'il ne l'a pas dit).
let fenetreConnue = null; // { valeur, a }

function noterFenetre(j) {
  const liste = Array.isArray(j?.data) ? j.data : [];
  const n = fenetreDeclaree(liste.find((x) => x?.id === modeleGlm()) || liste[0]);
  fenetreConnue = { valeur: n ? { jetons: n, source: "modele" } : null, a: Date.now() };
  return fenetreConnue.valeur;
}

export async function fenetreGlm() {
  const reglee = Number(process.env.REMY_GLM_CONTEXTE);
  if (Number.isFinite(reglee) && reglee >= 1024) return { jetons: Math.round(reglee), source: "reglage" };
  if (fenetreConnue && Date.now() - fenetreConnue.a < (fenetreConnue.valeur ? 3_600_000 : 300_000)) return fenetreConnue.valeur;
  try {
    const r = await fetch(glmUrl("/models"), { headers: glmEntetes(), signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(String(r.status));
    return noterFenetre(await r.json());
  } catch {
    fenetreConnue = { valeur: null, a: Date.now() };
    return null;
  }
}
export const oublierFenetre = () => {
  fenetreConnue = null;
};

// Ce qui voyage avec la réponse (« done », et le message enregistré) : des
// compteurs, jamais de contenu.
async function mesuresDe(debit, dernierAppel, fenetreP) {
  const b = debit.bilan();
  const ctx = dernierAppel ? contexteDe(dernierAppel) : null;
  if (!b && !ctx) return null;
  // Lancée en même temps que la réponse ; si le serveur tarde, la réponse
  // n'attend pas (la taille viendra avec la suivante).
  let minuteur;
  const f = await Promise.race([fenetreP, new Promise((r) => (minuteur = setTimeout(() => r(null), 300)))]);
  clearTimeout(minuteur);
  return {
    ...(b || {}),
    ...(ctx ? { contexte: ctx.utilise, ...(ctx.repartition ? { repartition: ctx.repartition } : {}) } : {}),
    ...(f ? { fenetre: f.jetons, fenetreSource: f.source } : {}),
  };
}
