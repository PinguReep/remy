// Contre-relecture FUITES du 29/10, rejouée après correctifs : chaque test
// essaie de faire sortir une conversation importée (Claude Code, T3,
// ChatGPT) de l'enclave chiffrée — par le coffre Obsidian, la base JSON de
// Rémy, la réflexion de nuit chez Claude, une recherche web, le dossier
// Imports, un message d'erreur. Chaque attaque doit ÉCHOUER (« bloquée »),
// chaque garde TENIR. Contre un faux GLM, un faux Claude et un faux
// DuckDuckGo ; données 100 % fictives (Kervella Paiements, Barthélémy,
// Vautrin Immobilier).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const journal = [];
console.log = () => {};
console.warn = (...a) => journal.push(a.join(" "));
console.error = (...a) => journal.push(a.join(" "));

const ici = path.dirname(fileURLToPath(import.meta.url));
const fixture = (nom) => fs.readFileSync(path.join(ici, "fixtures", "recherche", nom), "utf8");
const ecouter = (srv) => new Promise((ok) => srv.listen(0, "127.0.0.1", ok));

// --- Faux moteur ------------------------------------------------------------------------------
const ddg = { requetes: [] };
const serveurDdg = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    ddg.requetes.push(new URLSearchParams(corps).get("q") || decodeURIComponent(req.url));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fixture("ddg-html.html"));
  });
});
await ecouter(serveurDdg);

// --- Faux modèle local ------------------------------------------------------------------------
const glm = { principal: [], salle: [], flux: [], salleFlux: [], courts: [], panneCourt: false, routeur: "raisonnement", titre: "Paiement Kervella et Barthélémy" };
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
      const systeme = String(b.messages?.[0]?.content || "");
      if (glm.panneCourt && !systeme.startsWith("Tu es le routeur")) return res.writeHead(500).end("panne");
      const contenu = systeme.startsWith("Tu es le routeur")
        ? glm.routeur
        : systeme.startsWith("Tu génères le titre")
          ? glm.titre
          : "NO_UPDATE";
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: contenu }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    }
    const salle = estSalle(b);
    (salle ? glm.salleFlux : glm.flux).push(b);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const script = (salle ? glm.salle : glm.principal).shift() || texte(salle ? "Rien trouvé." : "Réponse locale.");
    for (const e of script) res.write(`data: ${JSON.stringify(e)}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 30 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await ecouter(serveurGlm);

// --- Faux Claude : tout ce qui y arrive est une sortie de la tour ----------------------------------
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

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-attaque-fuites-"));
for (const v of ["REMY_VAULT", "REMY_DATA_DIR", "GOOGLE_CLIENT_ID", "MOTION_API_KEY", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_CERVEAU",
  "REMY_SECOURS_CLOUD", "REMY_WEB_SEARCH", "REMY_RECHERCHE", "REMY_SEARXNG_URL", "REMY_ALLEGEMENT", "REMY_CONSEIL_CLOUD", "REMY_SALLE_BLANCHE", "REMY_RECHERCHE_PRIVEE", "REMY_PRENOM",
  "REMY_SOURCE_CLAUDE_CODE", "REMY_SOURCE_T3", "REMY_SOURCE_CHATGPT", "REMY_CONVERSATIONS_USAGE", "REMY_CONVERSATIONS_CLE", "REMY_CONNAISSANCES_PROJETS", "T3CODE_HOME", "REMY_CLAUDE_DIRS", "REMY_IMPORTS_DIR"]) {
  delete process.env[v];
}
// Comme sur la tour : base DANS le coffre (<coffre>/.remy), clé HORS du coffre.
const coffre = path.join(dossier, "Documents", "Rémy");
fs.mkdirSync(coffre, { recursive: true });
const racineClaude = path.join(dossier, "claude");
process.env.REMY_VAULT = coffre;
process.env.REMY_CLES_DIR = path.join(dossier, "cles");
process.env.CLAUDE_CONFIG_DIR = racineClaude;
process.env.REMY_T3_DIRS = path.join(dossier, "t3-absent");
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
const { preparerNuit, jourPrecedent } = await import("../lib/connaissances/nuit.js");
const { fournisseurDeFond, estPriveDeFond } = await import("../lib/providers.js");
// Le message nomme le modèle et dit la panne vue par la tour (#22) : on vérifie sa
// nature (« prive ») et ce qu'il promet, pas sa formulation exacte.
const priveDeFond = (err) =>
  estPriveDeFond(err) && /^Matière privée \(conversations importées\) : .+\. Rien n'est parti chez Claude/.test(err.message);
const { _oublierBlocage } = await import("../lib/recherche.js");
const { routeApi } = await import("../lib/routes.js");
const { enregistrerPriorites } = await import("../lib/priorites.js");
const { runReflection } = await import("../lib/reflection.js");
const { fermer } = await import("../lib/db.js");
const { fermer: fermerConv, cheminConnaissances } = await import("../lib/connaissances/base.js");

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
const nouveauFil = async () => (await (await json("POST", "/api/conversations", {})).json()).id;
const envoyer = async (id, text) => {
  for (const ip of ["127.0.0.1", "::ffff:127.0.0.1", "::1"]) await store.counterReset(`remy:rl:msg:${ip}`);
  return flux(`/api/conversations/${id}/messages`, { text });
};
const finDe = (ev) => ev.find((e) => e.nom === "done")?.data;
const systemeDe = (b) => String(b.messages?.[0]?.content || "");
const reset = () => {
  glm.principal = [];
  glm.salle = [];
  glm.flux = [];
  glm.salleFlux = [];
  glm.courts = [];
  glm.panneCourt = false;
  glm.routeur = "raisonnement";
  ddg.requetes = [];
  claude.length = 0;
  _oublierBlocage();
};
// Tous les fichiers d'un dossier dont le contenu (ou le nom) contient `motif`.
function fichiersQuiContiennent(racine, motif, { sauf = [] } = {}) {
  const trouves = [];
  const parcourir = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (sauf.some((s) => path.resolve(p) === path.resolve(s))) continue;
      if (e.isDirectory()) parcourir(p);
      else if (motif.test(e.name) || motif.test(fs.readFileSync(p).toString("utf8"))) trouves.push(path.relative(racine, p));
    }
  };
  parcourir(racine);
  return trouves;
}

const SECRETS = /kervella|barth[ée]l[ée]my/i;
const HIER = Date.now() - 24 * 3600_000;
const iso = (ms) => new Date(ms).toISOString();
fx.ecrireSessionClaude(racineClaude, {
  session: "5e551011-0000-4000-8000-0000000000a1",
  titre: "Paiement en ligne",
  messages: [
    { role: "user", texte: "Pour le paiement en ligne de la boutique, quel prestataire ?", ts: iso(HIER) },
    { role: "assistant", texte: "Le prestataire Kervella Paiements prend 1,4 %.", ts: iso(HIER + 60_000) },
    { role: "user", texte: "Décision : on garde Kervella Paiements, Barthélémy s'occupe du contrat.", ts: iso(HIER + 120_000) },
  ],
});
// Une session dans le dépôt d'un client : son nom n'est QUE dans le dossier.
fx.ecrireSessionClaude(racineClaude, {
  dossier: "C--Users-sam-code-Vautrin-Immobilier",
  cwd: "C:\\Users\\sam\\code\\Vautrin-Immobilier",
  session: "5e551011-0000-4000-8000-0000000000a2",
  titre: "Frais du prestataire",
  messages: [
    { role: "user", texte: "Le prestataire de paiement du site prend combien de frais par transaction ?", ts: iso(HIER + 3_600_000) },
    { role: "assistant", texte: "Environ 1,2 % plus 25 centimes par transaction pour ce prestataire de paiement.", ts: iso(HIER + 3_660_000) },
  ],
});
await sync.synchroniser();
let filPrive = null;

// Tout ce qui, sur le disque, contient le secret EN CLAIR (la base des
// conversations, chiffrée, est vérifiée à part).
const enClairDans = (racine) => fichiersQuiContiennent(racine, SECRETS, { sauf: [cheminConnaissances(), `${cheminConnaissances()}-wal`, `${cheminConnaissances()}-shm`] });

test("contrôle : la base des conversations ne contient rien en clair", () => {
  assert.equal(SECRETS.test(fs.readFileSync(cheminConnaissances()).toString("latin1")), false);
  assert.ok(cheminConnaissances().startsWith(coffre), "la base vit dans le coffre (comme sur la tour)");
});

test("bloquée (FUITE 1) — une réponse qui cite les passages n'est en clair NI dans le coffre Obsidian NI dans la base JSON de Rémy ; elle reste lisible dans l'app", async () => {
  reset();
  glm.principal = [texte("Tu avais décidé de garder Kervella Paiements ; Barthélémy s'occupe du contrat (session Claude Code d'hier).")];
  filPrive = await nouveauFil();
  const ev = await envoyer(filPrive, "Dans ma session Claude Code d'hier, qu'est-ce que j'avais décidé pour le paiement ?");
  assert.equal(finDe(ev)?.prive, true);
  await new Promise((r) => setTimeout(r, 300)); // titre (GLM) puis recopie dans le coffre
  assert.deepEqual(enClairDans(coffre), [], "rien en clair dans le coffre, nom de fichier compris");
  const copies = fs.readdirSync(path.join(coffre, "Conversations"));
  assert.ok(copies.includes(`Conversation privée (${filPrive.slice(0, 8)}).md`), JSON.stringify(copies));
  const disque = JSON.parse(fs.readFileSync(path.join(coffre, ".remy", "conversations.json"), "utf8"));
  const scellee = disque.conversations.find((c) => c.id === filPrive);
  assert.ok(scellee.scelle && !scellee.messages && !scellee.title, "scellée sur le disque : seul l'en-tête reste lisible");
  // Dans l'app, rien ne change.
  const lue = await (await json("GET", `/api/conversations/${filPrive}`)).json();
  assert.match(lue.messages.at(-1).content, /Kervella/);
  assert.equal(lue.prive, true);
  assert.equal(claude.length, 0);
});

test("bloquée (FUITE 2) — priorités → réflexion de nuit → Claude : le titre d'une conversation privée ne part pas (secours activé, modèle local en panne)", async () => {
  assert.ok(filPrive, "dépend du test précédent");
  reset();
  enregistrerPriorites([{ titre: "Paiement en ligne de la boutique", pourquoi: "lancer les ventes" }], { base: 0, maintenant: Date.now() - 20 * 86_400_000 });
  const conv = await store.getConversation(filPrive);
  assert.equal(conv.prive, true);
  assert.match(conv.title, SECRETS, "le titre généré (localement) reprend les passages");
  conv.updatedAt = Date.now() - 10 * 86_400_000;
  await store.putConversation(conv);
  assert.equal((await (await json("PUT", "/api/reglages", { secoursCloud: true })).json()).secoursCloud, true);
  try {
    glm.panneCourt = true; // les Sparks éteintes la nuit
    await runReflection().catch(() => {}); // le faux Claude répond 500 : peu importe, la requête est partie
    assert.ok(claude.length >= 1, "la réflexion (ordinaire) est bien partie chez Claude");
    for (const c of claude) assert.doesNotMatch(c, SECRETS);
    assert.ok(claude.some((c) => /une conversation priv/.test(c)), "la priorité dit seulement « une conversation privée, le … »");
  } finally {
    await json("PUT", "/api/reglages", { secoursCloud: false });
  }
});

test("bloquée (FUITE 3) — le nom de PROJET d'un passage (dossier du dépôt) entre au filtre : aucune recherche web ne le fait sortir (recherche privée permise)", async () => {
  reset();
  assert.equal((await json("PUT", "/api/reglages", { recherchePrivee: true })).status, 200);
  try {
    glm.principal = [appel("p1", "rechercher", { question: "Vautrin Immobilier avis frais prestataire paiement" }), texte("Environ 1,2 %.")];
    glm.salle = [appel("s1", "chercher_web", { requete: "Vautrin Immobilier avis" }), texte("Rien de notable.")];
    const id = await nouveauFil();
    const ev = await envoyer(id, "Dans ma session Claude Code, les frais du prestataire de paiement sont-ils élevés ?");
    assert.equal(finDe(ev)?.prive, true);
    assert.match(systemeDe(glm.flux[0]), /projet Vautrin-Immobilier/i, "le modèle local voit le nom du projet");
    assert.ok(!ddg.requetes.some((q) => /vautrin/i.test(q)), `requêtes parties : ${JSON.stringify(ddg.requetes)}`);
    assert.doesNotMatch(glm.salleFlux.map((b) => JSON.stringify(b.messages)).join(" "), /vautrin/i, "la salle blanche ne l'a même pas reçu");
  } finally {
    await json("PUT", "/api/reglages", { recherchePrivee: false });
  }
});

test("bloquée (FUITE 4) — l'export ChatGPT déposé QUITTE le coffre une fois importé (hors du coffre, effacé après le délai)", async () => {
  assert.ok(sync.dossierImports().startsWith(coffre), `dossier des imports par défaut : ${sync.dossierImports()}`);
  await json("PUT", "/api/conversations-externes/sources/chatgpt", { actif: true });
  fs.mkdirSync(sync.dossierImports(), { recursive: true });
  const conv = fx.conversationChatGPT({ id: "c0ffee00-0000-4000-8000-000000000001", titre: "Contrat", debut: HIER / 1000, echanges: [["Barthélémy signe le contrat Kervella lundi ?", "Oui, lundi."]] });
  const depose = path.join(sync.dossierImports(), "conversations.json");
  fs.writeFileSync(depose, JSON.stringify([conv]));
  const avant = new Date(Date.now() - 60_000);
  fs.utimesSync(depose, avant, avant); // copie terminée depuis une minute
  const r = await sync.synchroniser({ sources: ["chatgpt"] });
  assert.equal(r.sources.chatgpt.ok, true, JSON.stringify(r.sources.chatgpt));
  assert.deepEqual(enClairDans(coffre), [], "plus rien en clair dans le coffre");
  const originaux = sync.dossierOriginaux();
  assert.ok(!originaux.startsWith(coffre), "mis de côté hors du coffre");
  assert.equal(fs.readdirSync(originaux).length, 1);
  // Passé le délai : effacé.
  process.env.REMY_IMPORTS_GARDE_JOURS = "0";
  try {
    await sync.synchroniser({ sources: ["chatgpt"] });
    assert.deepEqual(fs.readdirSync(originaux), []);
    assert.equal(sync.etat().imports.originaux.fichiers, 0);
  } finally {
    delete process.env.REMY_IMPORTS_GARDE_JOURS;
  }
});

test("bloquée (FUITE 5) — un export abîmé : l'erreur ne cite aucun bout du contenu (état, base, script de la tour)", async () => {
  const f = path.join(sync.dossierImports(), "conversations.json");
  fs.writeFileSync(f, `[{"title":"Coffret","mapping":{},"note": Kervella Barthelemy signe lundi}]`);
  const avant = new Date(Date.now() - 60_000);
  fs.utimesSync(f, avant, avant);
  const r = await sync.synchroniser({ sources: ["chatgpt"] });
  const e = r.sources.chatgpt.erreur;
  assert.equal(e.code, "json-invalide");
  assert.doesNotMatch(JSON.stringify(e), /Kervella|Barth/);
  const etat = await (await json("GET", "/api/conversations-externes")).json();
  assert.doesNotMatch(JSON.stringify(etat), /Kervella|Barth/);
  sync.etat();
  const surDisque = [cheminConnaissances(), `${cheminConnaissances()}-wal`].filter((x) => fs.existsSync(x)).map((x) => fs.readFileSync(x).toString("latin1")).join("");
  assert.equal(surDisque.includes("Kervella"), false);
  fs.rmSync(f, { force: true });
});

test("garde — un « modèle local » qui n'est pas chez toi (REMY_GLM_URL vers un service) : ni passages, ni nuit", async () => {
  const { modeleLocalChezToi } = await import("../lib/glm.js");
  assert.equal(modeleLocalChezToi("http://127.0.0.1:8888/v1"), true);
  assert.equal(modeleLocalChezToi("http://10.0.0.7:8888/v1"), true);
  assert.equal(modeleLocalChezToi("https://sparks.exemple.ts.net/v1"), true);
  assert.equal(modeleLocalChezToi("http://sparks:8888/v1"), true);
  assert.equal(modeleLocalChezToi("https://api.exemple.com/v1"), false);
  const vrai = process.env.REMY_GLM_URL;
  process.env.REMY_GLM_URL = "https://glm.exemple.com/v1";
  try {
    let appele = false;
    const r = await preparerNuit({ jour: jourPrecedent(Date.now()), fournisseur: { name: "faux", complete: async () => ((appele = true), { text: "{}" }) }, relire: false });
    assert.equal(r.saute, "modele-pas-chez-toi");
    assert.equal(appele, false);
    process.env.REMY_GLM_LOCAL = "oui";
    assert.equal(modeleLocalChezToi(), true, "sauf si tu le déclares local");
  } finally {
    process.env.REMY_GLM_URL = vrai;
    delete process.env.REMY_GLM_LOCAL;
  }
});

test("tient — REMY_CONSEIL_CLOUD=on : une question « conseil » sur tes sessions part chez Claude SANS les passages", async () => {
  reset();
  process.env.REMY_CONSEIL_CLOUD = "on";
  try {
    glm.routeur = "conseil";
    const id = await nouveauFil();
    await envoyer(id, "Dans ma session Claude Code d'hier, qu'est-ce que j'avais décidé pour le paiement ? Aide-moi à trancher pour de bon.");
    assert.ok(claude.length >= 1, "la question est partie chez Claude (conseil cloud)");
    for (const c of claude) assert.doesNotMatch(c, SECRETS);
  } finally {
    delete process.env.REMY_CONSEIL_CLOUD;
  }
});

test("tient — REMY_CERVEAU=cloud : la nuit des conversations refuse Claude (modèle local ou rien)", async () => {
  reset();
  process.env.REMY_CERVEAU = "cloud";
  try {
    await assert.rejects(preparerNuit({ jour: jourPrecedent(Date.now()), fournisseur: fournisseurDeFond(), relire: false }), priveDeFond);
    assert.equal(claude.length, 0);
  } finally {
    delete process.env.REMY_CERVEAU;
  }
});

test("tient — une conversation devenue privée : le message suivant, modèle local en panne et secours activé, ne part pas chez Claude", async () => {
  reset();
  await json("PUT", "/api/reglages", { secoursCloud: true });
  try {
    glm.panneCourt = true;
    const srv = serveurGlm.address().port;
    process.env.REMY_GLM_URL = "http://127.0.0.1:9/v1"; // tour → Sparks coupé
    const ev = await envoyer(filPrive, "Et pour la livraison ?");
    process.env.REMY_GLM_URL = `http://127.0.0.1:${srv}/v1`;
    assert.ok(ev.some((e) => e.nom === "error"));
    assert.equal(claude.length, 0);
  } finally {
    await json("PUT", "/api/reglages", { secoursCloud: false });
  }
});

test("tient — journaux de la tour : aucune ligne ne cite le contenu des conversations", () => {
  assert.deepEqual(journal.filter((l) => SECRETS.test(l)), []);
});

test("tient — incidents et coûts : le contenu importé n'y est pas", async () => {
  const couts = JSON.stringify(await store.listCostEntries());
  assert.doesNotMatch(couts, SECRETS);
  const inc = path.join(coffre, ".remy", "incidents.jsonl");
  if (fs.existsSync(inc)) assert.doesNotMatch(fs.readFileSync(inc, "utf8"), SECRETS);
});
