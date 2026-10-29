// Le site et les conversations d'ailleurs (29/10) : la vue Conversations
// (public/app/vues/conversations-externes.js) appelle les routes de la tour
// par les chemins de public/app/analyse/conversations.js, et dit les mêmes
// phrases que l'iPhone (ConversationsExternes.swift). Ici :
// - les phrases et les adresses, cas par cas (module pur) ;
// - le contrat : chaque chemin du site, joué contre les vraies routes de la
//   tour (lib/routes.js) sur des conversations FICTIVES des trois sources
//   (test/outils/conversations-fictives.mjs), rend ce que la vue lit.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const C = await import("../public/app/analyse/conversations.js");

const date = (j, m, h, mi = 0, an = 2026) => new Date(an, m - 1, j, h, mi, 0, 0).getTime();
const MAINTENANT = date(29, 10, 15, 0);

// --- Les phrases (les mêmes mots que l'iPhone) ---

test("une source : coupée, en erreur, vide avec son aide, jamais lue, lue", () => {
  assert.equal(C.phraseSource({ id: "t3", actif: false }), "Coupée : rien n'est lu.");
  assert.equal(C.phraseSource({ id: "t3", actif: false, forceParLaTour: true }), "Coupée sur la tour (remy.env).");
  assert.equal(C.phraseSource({ id: "t3", actif: true, erreur: { code: "illisible", message: "Base de T3 illisible." } }), "Base de T3 illisible.");
  assert.equal(C.phraseSource({ id: "chatgpt", actif: true, conversations: 0, aide: { code: "rien-importe", message: "Aucun export ChatGPT importé." } }), "Aucun export ChatGPT importé.");
  assert.equal(C.phraseSource({ id: "claude-code", actif: true, conversations: 3 }), "Pas encore lue : première lecture dans 30 min au plus.");
  assert.equal(C.phraseSource({ id: "chatgpt", actif: true, conversations: 1 }), "1 conversation", "ChatGPT ne se relit pas : il s'envoie");
  assert.equal(C.phraseSource({ id: "t3", actif: true, conversations: 1234, derniereLecture: date(29, 10, 14, 20) }, MAINTENANT), "Lue de 14:20 · 1\u202f234 conversations");
  assert.equal(C.phraseSource({ id: "t3", actif: true, conversations: 2, derniereLecture: date(28, 10, 18, 2) }, MAINTENANT), "Lue d'hier, 18:02 · 2 conversations");
  assert.match(C.phraseSource({ id: "t3", actif: true, conversations: 2, derniereLecture: date(13, 10, 18, 2) }, MAINTENANT), /^Lue du 13 oct\.?, 18:02 · 2 conversations$/);
  assert.equal(C.quoiFaireSource({ actif: true, erreur: { message: "x", quoiFaire: "Ferme T3 puis réessaie." } }), "Ferme T3 puis réessaie.");
  assert.equal(C.quoiFaireSource({ actif: true, conversations: 4, aide: { message: "x", quoiFaire: "y" } }), null, "l'aide ne sert qu'à une source vide");
});

test("l'état : la clé d'abord, puis une source en erreur, sinon le compte et la dernière lecture", () => {
  const sources = [{ id: "claude-code", actif: true, derniereReussie: date(29, 10, 14, 20) }, { id: "t3", actif: true, derniereReussie: date(29, 10, 9, 5) }];
  assert.equal(C.resumeEtat({ sources, total: { conversations: 57 } }, MAINTENANT), "57 conversations · lues de 14:20");
  assert.equal(C.resumeEtat({ sources: [], total: { conversations: 0 } }), "Rien encore : Claude Code, T3 Code, ChatGPT.");
  const enPanne = [{ id: "t3", actif: true, erreur: { message: "T3 occupé." } }, { id: "chatgpt", actif: false, erreur: { message: "coupée : ne compte pas" } }];
  assert.equal(C.resumeEtat({ sources: enPanne, total: { conversations: 3 } }), "T3 occupé.");
  assert.equal(C.resumeEtat({ sources: enPanne, cle: { erreur: { message: "Clé différente." } }, total: { conversations: 3 } }), "Clé différente.");
  assert.equal(C.resumeEtat(null), null);
});

test("les exports : ceux qui restent en clair hors du coffre, ceux qui attendent", () => {
  assert.equal(C.phraseOriginaux({ fichiers: 0 }), null);
  assert.equal(C.phraseOriginaux({ dossier: "~\\.remy\\imports-importes", fichiers: 1, gardeJours: 7 }), "1 export importé reste en clair hors du coffre (~\\.remy\\imports-importes) : effacé 7 jours après l'import.");
  assert.equal(C.phraseOriginaux({ fichiers: 2, gardeJours: 0 }), "2 exports importés restent en clair hors du coffre : effacé à la prochaine lecture.");
  assert.equal(C.phraseOriginaux({ fichiers: 1, gardeJours: 1 }), "1 export importé reste en clair hors du coffre : effacé 1 jour après l'import.");
  assert.equal(C.phraseOriginaux({ fichiers: 1 }), "1 export importé reste en clair hors du coffre : effacé après quelques jours.");
  assert.equal(C.phraseEnAttente({ enAttente: 0 }), null);
  assert.match(C.phraseEnAttente({ enAttente: 1, dossier: "~\\Documents\\Coffre\\Imports" }), /^1 export attend dans ~\\Documents\\Coffre\\Imports : lu au prochain passage/);
});

test("la liste : l'assistant seulement s'il dit autre chose que la source, groupée par jour", () => {
  const c = { source: "t3", assistant: "Codex", fin: date(29, 10, 14, 32), messages: 12, projet: { nom: "Site de la boutique" } };
  assert.equal(C.metaConversation(c, MAINTENANT), "Codex · 14:32 · 12 messages · Site de la boutique");
  assert.equal(C.metaConversation({ source: "chatgpt", assistant: "ChatGPT", fin: date(28, 10, 9), messages: 1 }, MAINTENANT), "Hier · 1 message", "pas « ChatGPT · ChatGPT »");
  const g = C.parJour([
    { id: "a", fin: date(29, 10, 10) }, { id: "b", fin: date(29, 10, 8) }, { id: "c", fin: date(28, 10, 22) }, { id: "d", fin: date(26, 10, 9) }, { id: "e", fin: null },
  ], MAINTENANT);
  assert.deepEqual(g.map((x) => [x.titre, x.conversations.map((y) => y.id).join("")]), [["Aujourd'hui", "ab"], ["Hier", "c"], ["Lundi 26 octobre", "d"], ["Sans date", "e"]]);
  assert.equal(C.titreJour(date(26, 10, 9, 0, 2025), MAINTENANT), "Dimanche 26 octobre 2025", "l'année quand ce n'est pas celle-ci");
  assert.equal(C.titreJourIso("2026-10-28", MAINTENANT), "Hier");
  assert.equal(C.titreJourIso("pas une date"), "pas une date");
});

test("qui parle : toi, un collage, l'assistant de la conversation, le résumé de Claude Code", () => {
  assert.equal(C.auteur({ auteur: "utilisateur" }, "Codex"), "Toi");
  assert.equal(C.auteur({ auteur: "colle" }), "Toi (collé)");
  assert.equal(C.auteur({ auteur: "assistant" }, "Codex"), "Codex");
  assert.equal(C.auteur({ auteur: "assistant" }), "L'assistant");
  assert.equal(C.auteur({ auteur: "resume" }), "Résumé de Claude Code");
  assert.ok(C.deToi({ auteur: "colle" }) && !C.deToi({ auteur: "assistant" }));
});

test("l'import ChatGPT : quels fichiers, quel type, ce qui est dit (BilanImport.phrase)", () => {
  assert.ok(C.importable("export-chatgpt.ZIP") && C.importable("conversations.json"));
  assert.ok(!C.importable("chat.html") && !C.importable(""));
  assert.equal(C.typeFichier("conversations.json"), "application/json");
  assert.equal(C.typeFichier("abc.zip"), "application/zip");
  assert.equal(C.phraseImport({ deja: true }), "Cet export était déjà importé : rien de nouveau.");
  assert.equal(C.phraseImport({ nouvelles: 12, misesAJour: 3 }), "12 conversations importées, 3 mises à jour.");
  assert.equal(C.phraseImport({ nouvelles: 1, misesAJour: 1, ignorees: 1, tronquees: 1, masques: 1 }),
    "1 conversation importée, 1 mise à jour. 1 ignorée (sans texte lisible). 1 très longue : seule la fin est gardée. 1 secret masqué.");
  assert.equal(C.phraseImport({ ignorees: 2, masques: 3 }), "Rien de nouveau dans cet export. 2 ignorées (sans texte lisible). 3 secrets masqués.");
  assert.equal(C.libelleEnvoi(null), "Envoi de l'export à la tour…");
  assert.equal(C.libelleEnvoi(0.429), "Envoi de l'export… 42 %");
  assert.equal(C.libelleEnvoi(1), "Lecture de l'export sur la tour…");
  assert.equal(C.erreurImport(413, { message: "Fichier trop gros pour la tour (2048 Mo au plus).", quoiFaire: "Envoie seulement conversations.json." }),
    "Fichier trop gros pour la tour (2048 Mo au plus). Envoie seulement conversations.json.");
  assert.equal(C.erreurImport(500, null), "Erreur 500 : l'export n'a pas été importé.");
  assert.match(C.erreurImport(0), /^La tour ne répond pas/);
});

test("« Lire maintenant » : ce qui est relu, ou les sources en échec", () => {
  assert.deepEqual(C.phraseSynchro({ bilan: { ok: true, sources: { "claude-code": { ok: true }, t3: { ok: true } } } }), { texte: "Conversations relues.", erreur: false });
  assert.deepEqual(C.phraseSynchro({ bilan: { sources: { t3: { ok: false, erreur: { message: "base occupée" } } } } }), { texte: "Lu, sauf : T3 Code (base occupée).", erreur: true });
  assert.deepEqual(C.corpsSynchro("t3"), { source: "t3" });
  assert.deepEqual(C.corpsSynchro("chatgpt"), {}, "ChatGPT ne se relit pas : on relit tout le reste");
  assert.deepEqual(C.corpsSynchro(""), {});
});

// --- Les adresses du site ---

// Ce que fait main.js : tout le fragment décodé, puis découpé aux « / ».
const commeMain = (route) => decodeURIComponent(`#/${route}`.replace(/^#\/?/, "")).split("/").filter(Boolean);

test("une conversation a son adresse, ouverte au message trouvé si besoin, même avec un « / » dans l'identifiant", () => {
  for (const id of ["5e551011-0000-4000-8000-000000000001", "fil-paiement", "dossier/avec/barres", "été 100%", "a?b#c"]) {
    const [vue, ...args] = commeMain(C.route({ source: "t3", id }));
    assert.equal(vue, "conversations");
    assert.deepEqual(C.lireRoute(args), { source: "t3", id, autour: null }, id);
    const [, ...args2] = commeMain(C.route({ source: "chatgpt", id, autour: 42 }));
    assert.deepEqual(C.lireRoute(args2), { source: "chatgpt", id, autour: 42 }, id);
  }
  assert.equal(C.lireRoute([]), null);
  assert.equal(C.lireRoute(["t3"]), null);
  assert.equal(C.lireRoute(["t3", "x", "pas-un-nombre"]).autour, null);
});

test("les chemins du contrat : paramètres bornés, vides omis", () => {
  assert.equal(C.cheminListe({}), "/api/conversations-externes/liste?limite=40");
  assert.equal(C.cheminListe({ source: "t3", jour: "2026-10-28", decalage: 40, limite: 500 }), "/api/conversations-externes/liste?source=t3&jour=2026-10-28&decalage=40&limite=100");
  assert.equal(C.cheminRecherche({ q: "  livraison offerte ", source: "", limite: 99 }), "/api/conversations-externes/chercher?q=livraison+offerte&limite=50");
  assert.equal(new URL(`http://x${C.cheminRecherche({ q: "a".repeat(300) })}`).searchParams.get("q").length, 200);
  assert.equal(C.cheminLecture({ source: "claude-code", id: "a/b", autour: 9 }), "/api/conversations-externes/conversations/claude-code/a%2Fb?autour=9&limite=300");
  assert.equal(C.cheminLecture({ source: "t3", id: "x", apres: 12 }), "/api/conversations-externes/conversations/t3/x?apres=12&limite=300");
  assert.equal(C.cheminJours({ source: "chatgpt" }), "/api/conversations-externes/jours?source=chatgpt&nombre=400");
  assert.equal(C.cheminNuit(), "/api/conversations-externes/nuit");
  assert.equal(C.cheminSource("t3"), "/api/conversations-externes/sources/t3");
});

// --- Le contrat, contre les vraies routes de la tour ---

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-site-conv-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_SOURCE_CLAUDE_CODE", "REMY_SOURCE_T3", "REMY_SOURCE_CHATGPT",
  "REMY_CONNAISSANCES_PROJETS", "REMY_CONVERSATIONS_CLE", "REMY_CONVERSATIONS_USAGE", "REMY_CLAUDE_DIRS", "T3CODE_HOME", "REMY_IMPORT_MAX_MO"]) delete process.env[v];
const jeuRacine = path.join(dossier, "jeu");
process.env.REMY_DATA_DIR = path.join(dossier, "data");
process.env.REMY_CLES_DIR = path.join(dossier, "cles");
process.env.CLAUDE_CONFIG_DIR = path.join(jeuRacine, "claude");
process.env.REMY_T3_DIRS = path.join(jeuRacine, "t3");
process.env.REMY_IMPORTS_DIR = path.join(jeuRacine, "imports");
process.env.HOME = path.join(dossier, "maison"); // jamais le ~/.claude ni le ~/.t3 de la machine
process.env.USERPROFILE = process.env.HOME;

const { jeuDeDemo } = await import("./outils/conversations-fictives.mjs");
const jeu = jeuDeDemo({ racine: jeuRacine });
const { routeApi } = await import("../lib/routes.js");
const { CAPACITES } = await import("../lib/version.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
const { fermer } = await import("../lib/connaissances/base.js");
const { fermer: fermerRemy } = await import("../lib/db.js");
test.after(() => {
  remy.close();
  fermer();
  fermerRemy();
  fs.rmSync(dossier, { recursive: true, force: true });
});

// Comme api.js : JSON, cookie de session (pas de mot de passe ici, en test).
const appel = async (chemin, { methode = "GET", corps } = {}) => {
  const r = await fetch(base + chemin, { method: methode, headers: { Accept: "application/json", ...(corps !== undefined ? { "Content-Type": "application/json" } : {}) }, body: corps === undefined ? undefined : JSON.stringify(corps) });
  return { statut: r.status, corps: await r.json() };
};

test("contrat : la capacité que le site attend est annoncée par la tour", () => {
  assert.ok(CAPACITES.includes(C.CAPACITE));
  const main = fs.readFileSync(new URL("../public/app/main.js", import.meta.url), "utf8");
  assert.match(main, /si: \(\) => sait\("conversations-externes-v1"\) \}/, "la vue se cache sur une tour qui ne la connaît pas");
});

test("contrat : lire maintenant, l'import ChatGPT envoyé comme le site, puis l'état", async () => {
  const s = await appel(C.cheminSynchro(), { methode: "POST", corps: C.corpsSynchro("") });
  assert.equal(s.statut, 200);
  assert.equal(C.phraseSynchro(s.corps).erreur, false, JSON.stringify(s.corps.bilan));
  // L'envoi du site : le fichier en corps brut, avec le type de typeFichier.
  const zip = fs.readFileSync(jeu.zip);
  const r = await fetch(base + C.cheminImport(), { method: "POST", headers: { "Content-Type": C.typeFichier("export-chatgpt.zip"), Accept: "application/json" }, body: zip });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.equal(C.phraseImport(d.bilan), "1 conversation importée.");
  const r2 = await fetch(base + C.cheminImport(), { method: "POST", headers: { "Content-Type": "application/zip" }, body: zip });
  assert.equal(C.phraseImport((await r2.json()).bilan), "Cet export était déjà importé : rien de nouveau.");
  // Un fichier qui n'est pas un export : refusé, avec quoi faire.
  const r3 = await fetch(base + C.cheminImport(), { method: "POST", headers: { "Content-Type": "application/zip" }, body: Buffer.from("pas un zip") });
  const d3 = await r3.json();
  assert.equal(r3.status, 422);
  assert.ok(C.erreurImport(r3.status, d3).length > 10);

  const e = (await appel(C.cheminEtat())).corps;
  assert.deepEqual(e.sources.map((x) => x.id), C.SOURCES);
  for (const x of e.sources) {
    assert.equal(typeof x.nom, "string");
    assert.equal(typeof x.actif, "boolean");
    assert.ok(Array.isArray(x.emplacements));
    assert.ok(C.phraseSource(x).length > 3, x.id);
  }
  assert.equal(e.total.conversations, 4, "1 session Claude Code (l'autre, menée depuis T3, une seule fois), 2 fils T3, 1 ChatGPT");
  assert.match(C.resumeEtat(e), /^4 conversations · lues de \d\d:\d\d$/);
  assert.equal(typeof e.usage.chat, "boolean");
  assert.equal(e.chiffre, true);
  assert.ok(e.imports && typeof e.imports.enAttente === "number");
});

test("contrat : la liste (par source, par jour), les jours, la recherche, la lecture au message trouvé", async () => {
  const toutes = (await appel(C.cheminListe({}))).corps;
  assert.equal(toutes.total, 4);
  for (const c of toutes.conversations) {
    assert.ok(C.SOURCES.includes(c.source) && c.id && c.titre && typeof c.messages === "number", JSON.stringify(c));
    assert.ok(C.metaConversation(c).length);
  }
  assert.ok(C.parJour(toutes.conversations).length >= 2, "aujourd'hui et hier");
  const t3 = (await appel(C.cheminListe({ source: "t3" }))).corps;
  assert.deepEqual(t3.conversations.map((c) => c.titre).sort(), ["Frais de livraison", "Paiement en trois fois"]);
  assert.equal(C.assistantDistinct(t3.conversations.find((c) => c.id === "fil-paiement")), "Codex");

  const jours = (await appel(C.cheminJours({}))).corps.jours;
  assert.ok(jours.length >= 2 && jours.every((j) => /^\d{4}-\d{2}-\d{2}$/.test(j.jour) && j.conversations > 0), JSON.stringify(jours));
  const unJour = (await appel(C.cheminListe({ jour: jours[0].jour }))).corps;
  assert.equal(unJour.conversations.length, jours[0].conversations, "le filtre par jour suit /jours");

  const pages = (await appel(C.cheminListe({ limite: 2 }))).corps;
  assert.equal(pages.conversations.length, 2);
  assert.equal(pages.suite, 2);
  const suite = (await appel(C.cheminListe({ decalage: pages.suite, limite: 2 }))).corps;
  assert.equal(suite.suite, null);
  assert.equal(new Set([...pages.conversations, ...suite.conversations].map((c) => c.id)).size, 4);

  const r = (await appel(C.cheminRecherche({ q: "livraison" }))).corps.resultats;
  const trouve = r.find((x) => x.conversation === "fil-livraison");
  assert.ok(trouve && /49 euros/.test(trouve.extrait), JSON.stringify(r));
  assert.ok(Number.isInteger(trouve.message));
  // La vue l'ouvre à ce message : l'adresse, puis le chemin de lecture.
  const [, ...args] = commeMain(C.route({ source: trouve.source, id: trouve.conversation, autour: trouve.message }));
  const sel = C.lireRoute(args);
  const lu = (await appel(C.cheminLecture(sel))).corps;
  assert.equal(lu.cible, trouve.message);
  assert.ok(lu.messages.some((m) => m.id === lu.cible), "le message visé est dans la page");
  assert.equal(typeof lu.avant, "boolean");
  assert.equal(lu.conversation.titre, "Frais de livraison");
  assert.equal((await appel(C.cheminRecherche({ q: "zzzintrouvable" }))).corps.resultats.length, 0);

  // Lecture paginée : « Suite de la conversation » avec apres.
  const chat = toutes.conversations.find((c) => c.source === "chatgpt");
  const p1 = (await appel(C.cheminLecture({ source: chat.source, id: chat.id, limite: 2 }))).corps;
  assert.equal(p1.messages.length, 2);
  assert.ok(p1.suite != null);
  const p2 = (await appel(C.cheminLecture({ source: chat.source, id: chat.id, apres: p1.suite }))).corps;
  assert.equal(p1.messages.length + p2.messages.length, chat.messages);
  assert.equal(C.auteur(p1.messages.find((m) => m.auteur === "assistant"), p1.conversation.assistant), "ChatGPT");

  const absente = await appel(C.cheminLecture({ source: "t3", id: "fil-inconnu" }));
  assert.equal(absente.statut, 404, "la vue dit « effacée, ou source coupée »");
  assert.ok(absente.corps.message);
});

test("contrat : couper une source, l'usage, effacer une source puis tout", async () => {
  let e = (await appel(C.cheminSource("t3"), { methode: "PUT", corps: { actif: false } })).corps;
  assert.equal(e.sources.find((s) => s.id === "t3").actif, false, "PUT …/sources/:id rend l'état");
  assert.equal(C.phraseSource(e.sources.find((s) => s.id === "t3")), "Coupée : rien n'est lu.");
  const refus = await appel(C.cheminSynchro(), { methode: "POST", corps: C.corpsSynchro("t3") });
  assert.equal(refus.statut, 409, "lire une source coupée : refusé, dit");
  assert.ok(refus.corps.message);
  e = (await appel(C.cheminSource("t3"), { methode: "PUT", corps: { actif: true } })).corps;
  assert.equal(e.sources.find((s) => s.id === "t3").actif, true);

  e = (await appel(C.cheminUsage(), { methode: "PUT", corps: { chat: false } })).corps;
  assert.equal(e.usage.chat, false);
  e = (await appel(C.cheminUsage(), { methode: "PUT", corps: { chat: true } })).corps;
  assert.equal(e.usage.chat, true);

  const x = (await appel(C.cheminSource("chatgpt"), { methode: "DELETE" })).corps;
  assert.ok(x.ok && x.message && x.etat);
  assert.equal(x.etat.sources.find((s) => s.id === "chatgpt").conversations, 0);
  assert.equal((await appel(C.cheminListe({ source: "chatgpt" }))).corps.conversations.length, 0);

  const tout = (await appel(C.cheminToutEffacer(), { methode: "DELETE" })).corps;
  assert.ok(tout.ok && tout.message && tout.etat);
  assert.equal(tout.etat.total.conversations, 0);
  assert.equal(C.resumeEtat(tout.etat), "Rien encore : Claude Code, T3 Code, ChatGPT.");
  // « Lire maintenant » relit Claude Code et T3.
  await appel(C.cheminSynchro(), { methode: "POST", corps: {} });
  assert.equal((await appel(C.cheminEtat())).corps.total.conversations, 3);
});

test("le site : la vue, Réglages et Ctrl+K passent par ces chemins et ces phrases", () => {
  const vue = fs.readFileSync(new URL("../public/app/vues/conversations-externes.js", import.meta.url), "utf8");
  assert.doesNotMatch(vue, /["'`]\/api\/conversations-externes/, "aucun chemin écrit à la main : analyse/conversations.js les tient");
  for (const f of ["cheminListe", "cheminRecherche", "cheminLecture", "cheminJours", "cheminNuit", "cheminSynchro", "cheminSource", "cheminUsage", "cheminToutEffacer", "cheminImport", "phraseImport", "phraseSource", "lireRoute", "route"]) {
    assert.match(vue, new RegExp(`C\\.${f}\\(`), f);
  }
  const reglages = fs.readFileSync(new URL("../public/app/vues/reglages.js", import.meta.url), "utf8");
  assert.match(fs.readFileSync(new URL("../public/app/analyse/recherche-reglages.js", import.meta.url), "utf8"), /entree\("sourcesConversations", "Sources des conversations", [^\n]*\n[^\n]*"ChatGPT", "OpenAI", "Claude Code", "Claude", "T3", "T3 Code", "import"/, "la recherche de Réglages (index par ligne) les trouve");
  assert.match(reglages, /conversations: "conversations-externes-v1"/, "la section se cache sans la capacité");
  const palette = fs.readFileSync(new URL("../public/app/palette.js", import.meta.url), "utf8");
  assert.match(palette, /indexVisible/, "Ctrl+K ne propose pas une section cachée");
});
