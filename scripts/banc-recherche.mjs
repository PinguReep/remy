// Le banc de la recherche web (29/10) : les stratégies de lib/recherche-rapide.js
// jouées contre le VRAI modèle local, sur la tour, avec les mêmes questions.
// Une commande, un tableau, un JSON dans le coffre — pour garder la meilleure.
//
// Sur la tour (PowerShell), depuis la copie de production :
//   cd $env:USERPROFILE\.remy\app
//   node --env-file=..\remy.env scripts\banc-recherche.mjs
//
//   --modes salle,direct,hybride,direct-vif   les stratégies (défaut : les quatre)
//   --questions acre,smic                      un sous-ensemble (défaut : les 8 du banc)
//   --pause 3000                               entre deux essais (le moteur n'aime pas les rafales)
//   --sans-memoire                             consigne sans la mémoire (sinon : relue, jamais écrite)
//   --planning                                 ajoute l'instantané Motion à la consigne (LECTURE seule)
//
// Stratégies : « salle » (la salle blanche, comme le 25/10), « direct » (la tour
// cherche et lit, le modèle répond en un appel), « hybride » (direct + une
// relance possible), « direct-vif » (direct, réflexion coupée).
//
// Garde-fous :
//   - le modèle local seulement (REMY_GLM_URL, adresse locale ou tailnet) :
//     aucune IA cloud — la clé Anthropic est retirée du processus ;
//   - rien n'est écrit dans Motion, l'agenda, la mémoire ni les conversations :
//     le banc appelle le modèle directement (ni chat, ni mémoire, ni titre) ;
//     les propositions éventuelles (carnet) restent des événements ignorés ;
//   - les questions sont inventées (scripts/recherche-questions.mjs) ; la
//     mémoire, si elle est lue, ne part que vers le modèle local ;
//   - seul fichier écrit : <coffre>/.remy/bancs/recherche-<date>.json (réponses
//     comprises, pour juger la qualité), mis à jour après chaque essai.
// Pendant le banc, évite d'utiliser Rémy : les Sparks seraient partagées.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const val = (nom) => args.flatMap((a, i) => (a === nom ? [args[i + 1]] : [])).filter(Boolean)[0];
const drapeau = (nom) => args.includes(nom);

// --- Garde-fous, AVANT d'importer le code de Rémy ----------------------------------
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
process.env.REMY_SECOURS_CLOUD = "off";
if (!drapeau("--planning")) delete process.env.MOTION_API_KEY; // ni lecture ni outil Motion
delete process.env.GOOGLE_CLIENT_ID;
const urlModele = process.env.REMY_GLM_URL;
function locale(u) {
  let h;
  try {
    h = new URL(u).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".ts.net") || !h.includes(".")) return true;
  const p = h.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x))) return false;
  return p[0] === 10 || p[0] === 127 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}
if (!urlModele) {
  console.error("REMY_GLM_URL manque : lance le banc avec --env-file=..\\remy.env (le modèle local de la tour).");
  process.exit(2);
}
if (!locale(urlModele)) {
  console.error(`REMY_GLM_URL (${new URL(urlModele).hostname}) n'est ni local ni sur le tailnet : le banc ne parle qu'au modèle local.`);
  process.exit(2);
}

const { glmProvider } = await import("../lib/providers.js");
const { buildSystem, pourModeleLocal } = await import("../lib/chat.js");
const { getMemory } = await import("../lib/store.js");
const { creerFiltre } = await import("../lib/filtre-sortie.js");
const { PRENOM, VOCABULAIRE } = await import("../lib/profil.js");
const { bilanChiffres, backendRecherche, blocageRestantMs } = await import("../lib/recherche.js");
const { palierSansRouteur } = await import("../lib/allegement.js");
const rr = await import("../lib/recherche-rapide.js");
const { salleBlancheActive } = await import("../lib/salle-blanche.js");
const { modeleActif, libelleModele } = await import("../lib/glm.js");
const { QUESTIONS } = await import("./recherche-questions.mjs");

const MODES = ["salle", "direct", "hybride", "direct-vif"];
const modes = (val("--modes") || MODES.join(",")).split(",").map((s) => s.trim()).filter((m) => MODES.includes(m));
const ids = (val("--questions") || "").split(",").map((s) => s.trim()).filter(Boolean);
const questions = ids.length ? QUESTIONS.filter((q) => ids.includes(q.id)) : QUESTIONS.filter((q) => q.banc);
const PAUSE = Number(val("--pause")) || 3000;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
if (!modes.length || !questions.length) {
  console.error(`Rien à jouer : --modes parmi ${MODES.join(", ")} ; --questions parmi ${QUESTIONS.map((q) => q.id).join(", ")}.`);
  process.exit(2);
}

// --- Compter les appels au modèle : chaque /chat/completions qui part ---------------
const base = String(urlModele).replace(/\/+$/, "");
let appels = [];
const fetchOrigine = globalThis.fetch;
globalThis.fetch = (url, init = {}) => {
  const u = String(url?.href || url);
  if (u.startsWith(base) && u.endsWith("/chat/completions")) {
    let salle = false;
    let cars = 0;
    try {
      const b = JSON.parse(init.body || "{}");
      salle = String(b.messages?.[0]?.content || "").startsWith("Tu es le module de recherche web");
      cars = String(init.body || "").length;
    } catch {}
    appels.push({ t: Date.now(), salle, cars });
  }
  return fetchOrigine(url, init);
};

// --- La consigne : celle de Rémy, sans rien écrire -----------------------------------------
const memoire = drapeau("--sans-memoire") ? "" : String((await getMemory().catch(() => ({ text: "" })))?.text || "");
let planning = "";
if (drapeau("--planning")) {
  const { motionSnapshot } = await import("../lib/motion.js");
  planning = await motionSnapshot().catch((err) => {
    console.warn("Instantané Motion illisible, sans planning :", err.message);
    return "";
  });
}
const systeme = pourModeleLocal(buildSystem(memoire, false, planning, null, "", "", { activite: "", sujets: [] }));
const carsSysteme = systeme.reduce((n, b) => n + String(b.text || "").length, 0);
const modele = await modeleActif().catch(() => ({ id: "?" }));

const dossier = process.env.REMY_VAULT ? path.join(process.env.REMY_VAULT, ".remy", "bancs") : path.join(os.homedir(), ".remy", "bancs");
fs.mkdirSync(dossier, { recursive: true });
const fichier = path.join(dossier, `recherche-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`);
const rapport = {
  date: new Date().toISOString(),
  modele: modele.id,
  moteur: backendRecherche(),
  consigne: { caracteres: carsSysteme, jetonsEstimes: Math.round(carsSysteme / 3.2), memoire: Boolean(memoire), planning: Boolean(planning) },
  reglages: { pages: rr.pagesDirectes(), lecturesMs: rr.delaiLectures(), reflexion: rr.reflexionRecherche() },
  essais: [],
};
const ecrire = () => fs.writeFileSync(fichier, JSON.stringify(rapport, null, 2));

console.log(`Banc de la recherche web — modèle ${libelleModele(modele.id)}, moteur ${backendRecherche()}, consigne ~${rapport.consigne.jetonsEstimes} jetons${memoire ? " (mémoire comprise)" : ""}.`);
console.log(`${questions.length} questions × ${modes.length} stratégies : ${modes.join(", ")}. Résultats : ${fichier}\n`);

// --- Un essai : une question, une stratégie --------------------------------------------------
async function essai(q, mode) {
  const env = { REMY_RECHERCHE_MODE: process.env.REMY_RECHERCHE_MODE, REMY_RECHERCHE_REFLEXION: process.env.REMY_RECHERCHE_REFLEXION };
  process.env.REMY_RECHERCHE_MODE = mode === "direct-vif" ? "direct" : mode;
  if (mode === "direct-vif") process.env.REMY_RECHERCHE_REFLEXION = "off";
  rr.viderCachesRecherche(); // chaque essai à froid : rien de l'essai d'avant
  appels = [];
  const evenements = [];
  const onTool = (e) => evenements.push({ ...e, t: Date.now() });
  const filtre = creerFiltre({ sources: [memoire, planning], profil: [PRENOM, VOCABULAIRE], messageEnCours: q.question, prive: false });
  const t0 = Date.now();
  let premierMot = null;
  let texte = "";
  let prep = null;
  let resultat = null;
  let erreur = null;
  let tFlux = Infinity;
  try {
    const palier = palierSansRouteur(q.question, { rechercheWeb: true, rechercheLocale: true }) || "web";
    const m = process.env.REMY_RECHERCHE_MODE;
    // Comme lib/chat.js : la recherche directe pour une question « web », hors mode salle.
    if (palier === "web" && m !== "salle") prep = await rr.preparerRechercheDirecte({ message: q.question, mode: m, filtre, onTool });
    const directe = Boolean(prep && prep.statut !== "non");
    const opt = m !== "salle" ? rr.optionsReflexion() : { reflexion: true, effort: "high" };
    tFlux = Date.now();
    resultat = await glmProvider.stream({
      system: systeme,
      messages: rr.messagesAvecRecherche([{ role: "user", content: q.question }], directe ? prep : null),
      onText: (d) => {
        if (premierMot === null && String(d).trim()) premierMot = Date.now() - t0;
        texte += d;
      },
      onTool,
      agendaActif: false,
      motionActif: false,
      lectureMotion: true,
      recherche: directe ? Boolean(prep.relance) && salleBlancheActive() : true,
      filtre,
      reflexion: opt.reflexion,
      effort: opt.effort,
      ...(opt.effortSuite !== undefined ? { effortSuite: opt.effortSuite } : {}),
      ...(directe ? { webDeja: prep.recherche.web, matiereJointe: true, rechercherMax: 1 } : {}),
      navigateur: !directe,
    });
  } catch (err) {
    erreur = String(err.message || err).slice(0, 300);
  } finally {
    process.env.REMY_RECHERCHE_MODE = env.REMY_RECHERCHE_MODE ?? "";
    if (env.REMY_RECHERCHE_REFLEXION === undefined) delete process.env.REMY_RECHERCHE_REFLEXION;
    else process.env.REMY_RECHERCHE_REFLEXION = env.REMY_RECHERCHE_REFLEXION;
    if (!env.REMY_RECHERCHE_MODE) delete process.env.REMY_RECHERCHE_MODE;
  }
  const totalMs = Date.now() - t0;
  const web = resultat?.web || {};
  const reponse = String(resultat?.text || texte || "");
  const salles = evenements.filter((e) => e.type === "salle_blanche_faite");
  const usage = resultat?.usage || {};
  const r = {
    question: q.id,
    mode,
    totalMs,
    premierMotMs: premierMot,
    appelsModele: appels.length,
    dontSalleBlanche: appels.filter((a) => a.salle).length,
    caracteresEnvoyes: appels.reduce((n, a) => n + a.cars, 0),
    jetonsEnvoyes: (usage.input_tokens || 0) + salles.reduce((n, e) => n + (e.usage?.input_tokens || 0), 0),
    jetonsEcrits: (usage.output_tokens || 0) + salles.reduce((n, e) => n + (e.usage?.output_tokens || 0), 0),
    recherches: evenements.filter((e) => e.type === "recherche").length,
    requetes: evenements.filter((e) => e.type === "recherche").map((e) => e.requete),
    // Recherches lancées pendant la réponse (rechercher) : une relance, en hybride.
    recherchesDuModele: evenements.filter((e) => e.type === "recherche" && e.t >= tFlux).length,
    relance: mode === "hybride" && Boolean(prep && prep.statut !== "non") && evenements.some((e) => e.type === "recherche" && e.t >= tFlux),
    pagesLues: (web.pagesLues || []).length,
    pages: (web.pagesLues || []).map((p) => p.url),
    directe: prep ? { statut: prep.statut, raison: prep.raison || null, ms: prep.recherche?.mesures?.totalMs ?? null, probleme: prep.recherche?.erreur || null } : null,
    // Ce que le web a dit de travers (moteur bloqué, page refusée…), d'où qu'il vienne.
    problemesWeb: evenements.filter((e) => (e.type === "recherche_faite" && e.echec) || (e.type === "lecture_faite" && (e.echec || e.refusee))).length,
    chiffres: reponse ? bilanChiffres(reponse, web, q.question) : null,
    erreur,
    reponse,
  };
  return r;
}

// --- Le banc -------------------------------------------------------------------------------
const s = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : "—");
let interrompu = false;
process.on("SIGINT", () => {
  interrompu = true;
  console.log("\nArrêt demandé : le JSON garde les essais faits.");
  ecrire();
  process.exit(130);
});
for (const [i, q] of questions.entries()) {
  // L'ordre tourne d'une question à l'autre : aucune stratégie ne passe
  // toujours la première (Sparks froides, moteur reposé).
  const ordre = modes.map((_, k) => modes[(k + i) % modes.length]);
  for (const mode of ordre) {
    if (interrompu) break;
    let r = await essai(q, mode);
    // DuckDuckGo a bloqué (vérification anti-robot) : l'essai ne mesure rien.
    // On attend la fin du blocage (5 min) et on le rejoue une fois.
    if (blocageRestantMs() > 0) {
      console.log(`${q.id.padEnd(12)} ${mode.padEnd(11)} DuckDuckGo bloque : pause de ${Math.ceil(blocageRestantMs() / 60_000)} min, puis l'essai est rejoué.`);
      await pause(blocageRestantMs() + 5_000);
      r = await essai(q, mode);
      if (blocageRestantMs() > 0) r.bloque = true;
    }
    rapport.essais.push(r);
    ecrire();
    const c = r.chiffres;
    console.log(
      `${q.id.padEnd(12)} ${mode.padEnd(11)} ${s(r.totalMs).padStart(7)}  1er mot ${s(r.premierMotMs).padStart(7)}  ${String(r.appelsModele).padStart(2)} appels  ${String(r.pagesLues).padStart(2)} pages  ` +
        `chiffres ${c ? `${c.verifies}/${c.avances} vérifiés, ${c.aVerifier} à vérifier` : "—"}${r.relance ? "  (relance)" : ""}` +
        `${r.directe?.probleme ? `  web : ${r.directe.probleme.slice(0, 90)}` : r.problemesWeb ? `  web : ${r.problemesWeb} échec(s)` : ""}${r.erreur ? `  ERREUR ${r.erreur}` : ""}`,
    );
    await pause(PAUSE);
  }
}

// --- Le tableau --------------------------------------------------------------------------------
const med = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};
console.log("\n| Stratégie | Temps total (méd.) | 1er mot (méd.) | Appels modèle | Pages lues | Chiffres vérifiés / avancés | À vérifier | Sans page / erreurs |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
const resume = {};
for (const mode of modes) {
  const l = rapport.essais.filter((e) => e.mode === mode);
  // Un essai sans aucune page lue (moteur bloqué, pages refusées) ne dit rien
  // de la stratégie : compté à part, hors des médianes.
  const ok = l.filter((e) => !e.erreur && e.pagesLues > 0);
  const somme = (k) => ok.reduce((n, e) => n + (e.chiffres?.[k] || 0), 0);
  resume[mode] = {
    essais: l.length,
    totalMs: med(ok.map((e) => e.totalMs)),
    premierMotMs: med(ok.map((e) => e.premierMotMs)),
    appels: med(ok.map((e) => e.appelsModele)),
    pages: med(ok.map((e) => e.pagesLues)),
    verifies: somme("verifies"),
    avances: somme("avances"),
    aVerifier: somme("aVerifier"),
    erreurs: l.filter((e) => e.erreur).length,
    sansPage: l.filter((e) => !e.erreur && !e.pagesLues).length,
    relances: mode === "hybride" ? ok.filter((e) => e.relance).length : undefined,
  };
  const x = resume[mode];
  console.log(`| ${mode}${x.relances !== undefined ? ` (${x.relances} relance${x.relances > 1 ? "s" : ""})` : ""} | ${s(x.totalMs)} | ${s(x.premierMotMs)} | ${x.appels ?? "—"} | ${x.pages ?? "—"} | ${x.verifies} / ${x.avances} | ${x.aVerifier} | ${x.sansPage} / ${x.erreurs} |`);
}
rapport.resume = resume;
ecrire();
console.log(`\nLes réponses complètes, pour juger la qualité : ${fichier}`);
console.log("Pour changer de stratégie : REMY_RECHERCHE_MODE=<salle|direct|hybride> (et REMY_RECHERCHE_REFLEXION=off pour « direct-vif ») dans remy.env, puis relancer l'installeur.");
process.exit(0);
