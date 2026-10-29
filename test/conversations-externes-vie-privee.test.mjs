// Conversations externes, vie privée (29/10) : ce que tu as dit ailleurs est de
// la matière privée. Prouvé ici, contre un faux modèle local, un faux Claude et
// un faux moteur de recherche :
//   - Rémy s'en sert (modèle local) quand ta question s'y rapporte, et
//     seulement alors ; la conversation devient privée ;
//   - jamais rien chez Claude : ni la réponse, ni le secours (même activé), ni
//     le titre ou la mémoire, ni la nuit ;
//   - jamais dans une recherche web : le filtre des requêtes sortantes connaît
//     les passages ;
//   - la nuit relit la veille (modèle local ou rien) ; la ligne du matin est
//     lue à l'affichage, jamais écrite dans le briefing ;
//   - les interrupteurs (réponses, nuit) coupent vraiment ; effacer une source
//     efface aussi ce que la nuit en avait tiré.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

console.log = () => {};
console.warn = () => {};
console.error = () => {};

const ici = path.dirname(fileURLToPath(import.meta.url));
const fixture = (nom) => fs.readFileSync(path.join(ici, "fixtures", "recherche", nom), "utf8");
const ecouter = (srv) => new Promise((ok) => srv.listen(0, "127.0.0.1", ok));

// --- Faux moteur de recherche : ce qui SORT de la tour. -----------------------------------------
const ddg = { requetes: [] };
const serveurDdg = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    ddg.requetes.push(new URLSearchParams(corps).get("q") || "");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fixture("ddg-html.html"));
  });
});
await ecouter(serveurDdg);

// --- Faux modèle local. ---------------------------------------------------------------------------
const glm = { principal: [], salle: [], flux: [], salleFlux: [], courts: [], panne: false, panneCourt: false, nuit: null };
const delta = (d, fin = null) => ({ choices: [{ index: 0, delta: d, finish_reason: fin }] });
const appel = (id, name, args) => [delta({ tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] }, "tool_calls")];
const texte = (t) => [delta({ content: t }, "stop")];
const estSalle = (b) => String(b.messages?.[0]?.content || "").startsWith("Tu es le module de recherche web");
const serveurGlm = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: "glm" }] }));
    const b = JSON.parse(corps || "{}");
    if (!b.stream) {
      glm.courts.push(b);
      if (glm.panneCourt) return res.writeHead(500).end("panne");
      const systeme = String(b.messages?.[0]?.content || "");
      const contenu = systeme.startsWith("Tu relis, pour") ? JSON.stringify(glm.nuit) : systeme.startsWith("Tu es le routeur") ? "raisonnement" : "NO_UPDATE";
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: contenu }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    }
    const salle = estSalle(b);
    (salle ? glm.salleFlux : glm.flux).push(b);
    if (!salle && glm.panne) return res.writeHead(500).end("panne");
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const script = (salle ? glm.salle : glm.principal).shift() || texte(salle ? "Rien trouvé." : "Réponse locale.");
    for (const e of script) res.write(`data: ${JSON.stringify(e)}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 30 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await ecouter(serveurGlm);

// --- Faux Claude : ne doit JAMAIS être appelé ici. -------------------------------------------------
const claude = [];
const anthropic = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    claude.push(corps);
    res.writeHead(500).end("{}");
  });
});
await ecouter(anthropic);

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-conv-privee-"));
for (const v of ["REMY_VAULT", "GOOGLE_CLIENT_ID", "MOTION_API_KEY", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_CERVEAU",
  "REMY_SECOURS_CLOUD", "REMY_WEB_SEARCH", "REMY_RECHERCHE", "REMY_SEARXNG_URL", "REMY_ALLEGEMENT", "REMY_CONSEIL_CLOUD", "REMY_SALLE_BLANCHE", "REMY_RECHERCHE_PRIVEE", "REMY_PRENOM",
  "REMY_SOURCE_CLAUDE_CODE", "REMY_SOURCE_T3", "REMY_SOURCE_CHATGPT", "REMY_CONVERSATIONS_USAGE", "REMY_CONVERSATIONS_CLE", "REMY_CONNAISSANCES_PROJETS", "T3CODE_HOME", "REMY_CLAUDE_DIRS"]) {
  delete process.env[v];
}
const racineClaude = path.join(dossier, "claude");
process.env.REMY_DATA_DIR = path.join(dossier, "data");
process.env.REMY_CLES_DIR = path.join(dossier, "cles");
process.env.CLAUDE_CONFIG_DIR = racineClaude;
process.env.REMY_T3_DIRS = path.join(dossier, "t3-absent");
process.env.REMY_IMPORTS_DIR = path.join(dossier, "imports");
process.env.HOME = path.join(dossier, "maison");
process.env.USERPROFILE = process.env.HOME;
process.env.REMY_GLM_URL = `http://127.0.0.1:${serveurGlm.address().port}/v1`;
process.env.REMY_PROVIDER = "api";
process.env.ANTHROPIC_API_KEY = "cle-de-test";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropic.address().port}`;
process.env.REMY_BROWSE = "off";
process.env.BROWSE_TEST_PUBLIQUES = "127.0.0.1";
process.env.REMY_DUCKDUCKGO_URL = `http://127.0.0.1:${serveurDdg.address().port}/html/`;
process.env.REMY_DUCKDUCKGO_LITE_URL = `http://127.0.0.1:${serveurDdg.address().port}/lite/`;

const fx = await import("./outils/conversations-fictives.mjs");
const store = await import("../lib/store.js");
const sync = await import("../lib/connaissances/sync.js");
const { preparerNuit, ligneDuMatin, jourPrecedent } = await import("../lib/connaissances/nuit.js");
const { fournisseurDeFond, PRIVE_DE_FOND } = await import("../lib/providers.js");
const { PRIVE_INJOIGNABLE, logCost } = await import("../lib/chat.js");
const { _oublierBlocage } = await import("../lib/recherche.js");
const { routeApi } = await import("../lib/routes.js");
const { fermer } = await import("../lib/db.js");
const { fermer: fermerConv } = await import("../lib/connaissances/base.js");

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) (res.statusCode = 404), res.end("{}");
});
await ecouter(remy);
const base = `http://127.0.0.1:${remy.address().port}`;

test.after(() => {
  for (const s of [remy, serveurGlm, anthropic, serveurDdg]) s.close();
  fermer();
  fermerConv();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const json = (methode, chemin, corps) =>
  fetch(base + chemin, { method: methode, headers: { "Content-Type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps) });
async function flux(chemin, corps) {
  const t = await (await json("POST", chemin, corps)).text();
  return t
    .split("\n\n")
    .filter(Boolean)
    .map((bloc) => ({ nom: bloc.match(/^event: (.+)$/m)?.[1], data: JSON.parse(bloc.match(/^data: (.+)$/m)?.[1] || "null") }))
    .filter((e) => e.nom);
}
const nouveauFil = async (corps = {}) => (await (await json("POST", "/api/conversations", corps)).json()).id;
const envoyer = async (id, text) => {
  for (const ip of ["127.0.0.1", "::ffff:127.0.0.1", "::1"]) await store.counterReset(`remy:rl:msg:${ip}`);
  return flux(`/api/conversations/${id}/messages`, { text });
};
const finDe = (ev) => ev.find((e) => e.nom === "done")?.data;
const erreurDe = (ev) => ev.find((e) => e.nom === "error")?.data;
const etapesDe = (ev) => ev.filter((e) => e.nom === "status").map((e) => e.data.text);
const systemeDe = (b) => String(b.messages?.[0]?.content || "");
const dernierOutil = (b) => JSON.parse([...b.messages].reverse().find((m) => m.role === "tool").content);
const reset = () => {
  glm.principal = [];
  glm.salle = [];
  glm.flux = [];
  glm.salleFlux = [];
  glm.courts = [];
  glm.panne = false;
  glm.panneCourt = false;
  ddg.requetes = [];
  claude.length = 0;
  _oublierBlocage();
};

// Ta session Claude Code d'hier (fictive), avec un nom et un prestataire.
const HIER = Date.now() - 24 * 3600_000;
const iso = (ms) => new Date(ms).toISOString();
fx.ecrireSessionClaude(racineClaude, {
  session: "5e551011-0000-4000-8000-0000000000c1",
  titre: "Paiement en ligne",
  messages: [
    { role: "user", texte: "Pour les fiches produits de la boutique, on publie vendredi.", ts: iso(HIER) },
    { role: "assistant", texte: "Noté pour vendredi. Pour le paiement, le prestataire Kervella Paiements prend 1,4 %.", ts: iso(HIER + 60_000) },
    { role: "user", texte: "Décision : on garde Kervella Paiements, Barthélémy s'occupe du contrat.", ts: iso(HIER + 120_000) },
  ],
});
await sync.synchroniser();
// Ce qui ne doit JAMAIS sortir de la tour vers Claude ou un moteur.
const SECRETS = /kervella|barth[ée]l[ée]my/i;

test("une question qui s'y rapporte : le modèle local reçoit les passages, encadrés ; la conversation devient privée ; Claude jamais appelé", async () => {
  reset();
  glm.principal = [texte("Tu avais décidé de garder Kervella Paiements (session Claude Code d'hier).")];
  const id = await nouveauFil();
  const ev = await envoyer(id, "Dans ma session Claude Code d'hier, qu'est-ce que j'avais décidé pour le paiement ?");
  const fin = finDe(ev);
  assert.ok(fin, JSON.stringify(erreurDe(ev)));
  assert.equal(fin.prive, true, "l'app apprend que la conversation est passée en privée");
  const sys = systemeDe(glm.flux[0]);
  assert.match(sys, /# Tes conversations ailleurs \(matière privée\)/);
  assert.match(sys, /<matiere_externe source="Claude Code" titre="Paiement en ligne">/);
  assert.match(sys, /on garde Kervella Paiements/);
  assert.ok(etapesDe(ev).includes("Rémy relit tes conversations Claude Code…"), etapesDe(ev).join(" | "));
  const conv = await (await json("GET", `/api/conversations/${id}`)).json();
  assert.equal(conv.prive, true);
  assert.equal(claude.length, 0, "rien chez Claude");
  // Le titre et la mémoire de cette conversation (tâches de fond, après la
  // réponse) : modèle local seulement.
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(claude.length, 0);
  assert.ok(glm.courts.length >= 1, "les tâches de fond sont allées au modèle local");
});

test("une question sans rapport : rien n'est relu, la conversation reste ordinaire", async () => {
  reset();
  glm.principal = [texte("Il fera beau.")];
  const id = await nouveauFil();
  const ev = await envoyer(id, "Quel temps pour courir demain matin ?");
  assert.ok(finDe(ev));
  assert.equal(finDe(ev).prive, undefined);
  assert.doesNotMatch(systemeDe(glm.flux[0]), /Tes conversations ailleurs|Kervella/);
  assert.equal((await (await json("GET", `/api/conversations/${id}`)).json()).prive, undefined);
});

test("le modèle local lâche avant d'écrire : pas de secours Claude, même activé", async () => {
  reset();
  assert.equal((await (await json("PUT", "/api/reglages", { secoursCloud: true })).json()).secoursCloud, true);
  try {
    glm.panne = true;
    const id = await nouveauFil();
    const ev = await envoyer(id, "Avec Claude Code hier, on avait dit quoi pour les fiches produits ?");
    assert.equal(erreurDe(ev)?.message, PRIVE_INJOIGNABLE);
    assert.equal(claude.length, 0, "secours activé, et pourtant rien chez Claude");
    // Une conversation ordinaire, elle, aurait eu le secours : la différence vient bien des passages.
    const autre = await nouveauFil();
    await envoyer(autre, "Bonjour");
    assert.ok(claude.length >= 1, "sans passages, le secours (activé) prend le relais");
    for (const c of claude) assert.doesNotMatch(c, SECRETS);
  } finally {
    await json("PUT", "/api/reglages", { secoursCloud: false });
  }
});

test("jamais dans une recherche web : le filtre connaît les passages (salle blanche, recherche privée permise)", async () => {
  reset();
  assert.equal((await json("PUT", "/api/reglages", { recherchePrivee: true })).status, 200);
  try {
    glm.principal = [
      appel("p1", "rechercher", { question: "Kervella Paiements avis frais" }),
      appel("p2", "rechercher", { question: "Quels frais pour un prestataire de paiement en ligne en France ?" }),
      texte("Les frais tournent autour de 1 à 2 %."),
    ];
    glm.salle = [appel("s1", "chercher_web", { requete: "frais prestataire paiement en ligne" }), texte("Entre 1 et 2 % par transaction.")];
    const id = await nouveauFil();
    const ev = await envoyer(id, "Dans ma session Claude Code, le prestataire de paiement est-il cher ?");
    assert.ok(finDe(ev), JSON.stringify(erreurDe(ev)));
    assert.equal(finDe(ev).prive, true);
    const outils = (glm.flux[0].tools || []).map((t) => t.function.name);
    assert.ok(outils.includes("rechercher"), outils.join(","));
    // La question qui reprend un nom des passages est refusée, rien n'est parti.
    assert.match(dernierOutil(glm.flux[1]).erreur, /« Kervella »/);
    for (const q of ddg.requetes) assert.doesNotMatch(q, SECRETS);
    for (const b of glm.salleFlux) assert.doesNotMatch(JSON.stringify(b), SECRETS);
    assert.ok(ddg.requetes.length >= 1, "la question générale, elle, part");
    assert.equal(claude.length, 0);
  } finally {
    await json("PUT", "/api/reglages", { recherchePrivee: false });
  }
});

test("devenue privée, la recherche suit la règle des conversations privées (coupée par défaut)", async () => {
  reset();
  glm.principal = [texte("Je te réponds sans le web.")];
  const id = await nouveauFil();
  await envoyer(id, "Dans ma session Claude Code, le prestataire de paiement est-il cher ?");
  const outils = (glm.flux[0].tools || []).map((t) => t.function.name);
  for (const n of ["rechercher", "chercher_web", "lire_page", "browse_page"]) assert.equal(outils.includes(n), false, n);
  assert.deepEqual(ddg.requetes, []);
});

test("la nuit relit la veille avec le modèle local seul ; la ligne du matin est lue à l'affichage, jamais écrite dans le briefing", async () => {
  reset();
  glm.nuit = {
    themes: ["Paiement en ligne", "Fiches produits"],
    decisions: ["Garder le prestataire de paiement actuel"],
    aFaire: [{ texte: "Relire le contrat du prestataire", source: "Claude Code" }],
    ligne: "Les fiches produits sortent vendredi.",
  };
  const jour = jourPrecedent(Date.now());
  const r = await preparerNuit({ jour, fournisseur: fournisseurDeFond(), noterCout: logCost, relire: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  const demande = glm.courts.find((b) => systemeDe(b).startsWith("Tu relis, pour"));
  assert.ok(demande, "le modèle local a reçu la demande");
  assert.match(JSON.stringify(demande), /matiere_externe/);
  assert.equal(claude.length, 0);
  const n = await (await json("GET", `/api/conversations-externes/nuit?jour=${jour}`)).json();
  assert.deepEqual(n.digest.themes, ["Paiement en ligne", "Fiches produits"]);
  assert.equal(n.digest.aFaire[0].source, "Claude Code");
  assert.deepEqual(n.digest.sources, ["claude-code"]);
  // Le coût est journalisé, à son nom.
  const couts = (await store.listCostEntries()).filter((c) => c.kind === "conversations-nuit");
  assert.equal(couts.length, 1);
  assert.equal(couts[0].provider, "glm");
  // La ligne du matin : dans le rituel de l'app, pas dans le briefing stocké.
  assert.deepEqual(ligneDuMatin(Date.now()), { ligne: "Les fiches produits sortent vendredi.", jour, sources: ["claude-code"] });
  const rituel = await (await json("GET", "/api/rituel")).json();
  assert.equal(rituel.conversations?.ligne, "Les fiches produits sortent vendredi.");
  assert.doesNotMatch(JSON.stringify(await store.getBriefing()), /fiches produits sortent/);
  // Rien en clair dans la base.
  assert.equal(fs.readFileSync(sync.cheminConnaissances()).includes(Buffer.from("sortent vendredi")), false);
});

test("la nuit, modèle local en panne : rien chez Claude, même avec le secours activé (la nuit réessaiera)", async () => {
  reset();
  await json("PUT", "/api/reglages", { secoursCloud: true });
  try {
    glm.panneCourt = true;
    await assert.rejects(preparerNuit({ jour: jourPrecedent(Date.now()), fournisseur: fournisseurDeFond(), relire: false }), { message: PRIVE_DE_FOND });
    assert.equal(claude.length, 0);
  } finally {
    await json("PUT", "/api/reglages", { secoursCloud: false });
  }
});

test("le compactage d'une conversation devenue privée reste local (il n'a jamais d'autre fournisseur)", () => {
  const code = fs.readFileSync(path.join(ici, "..", "lib", "compactage.js"), "utf8");
  assert.doesNotMatch(code, /getProvider|fournisseurDeFond|anthropic/i);
  assert.match(code, /glmProvider\.complete/);
});

test("interrupteurs : réponses coupées → rien relu ; nuit coupée → rien relu, et plus de ligne le matin", async () => {
  reset();
  await json("PUT", "/api/conversations-externes/usage", { chat: false, nuit: false });
  try {
    glm.principal = [texte("D'accord.")];
    const id = await nouveauFil();
    const ev = await envoyer(id, "Dans ma session Claude Code, qu'est-ce que j'avais décidé pour le paiement ?");
    assert.equal(finDe(ev).prive, undefined);
    assert.doesNotMatch(systemeDe(glm.flux[0]), /Kervella/);
    assert.deepEqual(await preparerNuit({ jour: jourPrecedent(Date.now()), fournisseur: fournisseurDeFond(), relire: false }), { saute: "usage-coupe" });
    assert.equal(ligneDuMatin(Date.now()), null);
    assert.equal((await (await json("GET", "/api/rituel")).json()).conversations, null);
  } finally {
    await json("PUT", "/api/conversations-externes/usage", { chat: true, nuit: true });
  }
});

test("effacer une source efface aussi ce que la nuit en avait tiré", async () => {
  const jour = jourPrecedent(Date.now());
  assert.ok((await (await json("GET", `/api/conversations-externes/nuit?jour=${jour}`)).json()).digest);
  assert.equal((await json("DELETE", "/api/conversations-externes/sources/claude-code")).status, 200);
  assert.equal((await (await json("GET", `/api/conversations-externes/nuit?jour=${jour}`)).json()).digest, null);
  assert.equal(ligneDuMatin(Date.now()), null);
  // Plus de passages : la même question ne relit plus rien.
  reset();
  glm.principal = [texte("Je n'ai rien.")];
  const id = await nouveauFil();
  const ev = await envoyer(id, "Dans ma session Claude Code, qu'est-ce que j'avais décidé pour le paiement ?");
  assert.equal(finDe(ev).prive, undefined);
});
