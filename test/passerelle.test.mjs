// La passerelle du modèle local pour les outils de code (lib/passerelle.js) :
//   - coupée par défaut ; deux clés créées et révoquées depuis Réglages,
//     montrées une fois, gardées hachées, jamais dans les journaux ;
//   - chaque refus : sans clé, clé fausse ou révoquée (à temps constant),
//     requête trop grande, débit dépassé, paramètres et en-têtes hors liste
//     blanche, image par adresse, modèle pas « chez toi », pas de modèle ;
//   - le même arbitre que Rémy (lib/priorite.js) : la clé « au clavier » est
//     une demande (fait céder le fond de Rémy et les agents de fond) ; la clé
//     « agents de fond » attend en file pendant une demande et son répit, dans
//     l'ordre, sans erreur ; l'appel en cours n'est pas coupé ; attente bornée
//     (503 + Retry-After), file bornée ; Réglages › Diagnostic le dit ;
//   - le panneau des coûts reçoit des compteurs, jamais le contenu.
// Faux modèles (lent, à flux, à une place) et faux client : rien de réel.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fauxModelePasserelle } from "./outils/faux-modele-passerelle.mjs";
import { travailEssai } from "./outils/fond-travail.mjs";

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-passerelle-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "VERCEL", "REMY_SPARKS_MAX", "REMY_GLM_LOCAL", "REMY_GLM_MODEL"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.APP_PASSWORD = "mot-de-passe-de-test";
process.env.REMY_FOND_REPIT_MS = "0";
const journaux = [];
for (const n of ["log", "info", "warn", "error"]) console[n] = (...a) => journaux.push(a.map(String).join(" "));

// Le travail de fond de Rémy : 900 ms ; un agent « LONG » : 500 ms ; le reste : 20 ms.
const modele = await fauxModelePasserelle({ duree: (t) => (/FOND/.test(t) ? 900 : /LONG/.test(t) ? 500 : 20), statut: (t) => (/REFUS-400/.test(t) ? 400 : /REFUS-401/.test(t) ? 401 : 200) });
process.env.REMY_GLM_URL = modele.url;
process.env.REMY_GLM_TOKEN = "jeton-du-relais-essai";

const prio = await import("../lib/priorite.js");
const jobs = await import("../lib/jobs.js");
const P = await import("../lib/passerelle.js");
const store = await import("../lib/store.js");
const { routeApi } = await import("../lib/routes.js");
const { makeSessionToken } = await import("../lib/auth.js");
const { glmProvider } = await import("../lib/providers.js");
const serveurMaj = await import("../lib/maj-auto-serveur.js");
const { fermer } = await import("../lib/db.js");

// Comme server.js : /v1 → la passerelle, /api → la table de routage.
const remy = http.createServer(async (req, res) => {
  const chemin = new URL(req.url, "http://x").pathname;
  if (P.estCheminPasserelle(chemin)) return P.traiterV1(req, res);
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
const session = { Cookie: `remy_session=${makeSessionToken()}`, "Content-Type": "application/json" };

test.after(async () => {
  remy.close();
  await modele.fermer();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
async function jusqua(cond, maxMs = 5_000, quoi = "condition") {
  const fin = Date.now() + maxMs;
  while (!(await cond())) {
    if (Date.now() > fin) throw new Error(`jamais vu : ${quoi}`);
    await attendre(5);
  }
}
const reglages = (corps) => fetch(`${base}/api/passerelle`, { method: "PUT", headers: session, body: JSON.stringify(corps) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const creerCle = (type) => fetch(`${base}/api/passerelle/cles/${type}`, { method: "POST", headers: session }).then((r) => r.json());
const revoquer = (type) => fetch(`${base}/api/passerelle/cles/${type}`, { method: "DELETE", headers: session }).then((r) => r.json());

// Le faux client : un outil « compatible OpenAI ».
const appeler = (cle, corps, { chemin = "/v1/chat/completions", methode = "POST", entetes = {}, signal } = {}) =>
  fetch(`${base}${chemin}`, { method: methode, headers: { ...(cle ? { Authorization: `Bearer ${cle}` } : {}), "Content-Type": "application/json", ...entetes }, body: methode === "GET" ? undefined : JSON.stringify(corps), signal });
const question = (texte, extra = {}) => ({ model: "gpt-4o", messages: [{ role: "user", content: texte }], ...extra });
// Lit un flux SSE en entier : les événements « data: ».
async function lireFlux(r) {
  const brut = await r.text();
  return brut.split(/\n\n/).map((e) => e.trim()).filter(Boolean).map((e) => e.replace(/^data: /, "")).map((d) => (d === "[DONE]" ? d : JSON.parse(d)));
}

let cles = {};
const remiseAZero = async () => {
  prio._reinitialiser();
  jobs._reinitialiserCharge();
  P._reinitialiser();
  modele.vider();
  process.env.REMY_FOND_REPIT_MS = "0";
  for (const v of ["REMY_PASSERELLE_ATTENTE_MS", "REMY_PASSERELLE_MAX_OCTETS", "REMY_PASSERELLE_DEBIT_MIN"]) delete process.env[v];
  await reglages({ active: true, fileMax: 8, attenteMaxS: 120, couperSansFlux: false });
};

test("coupée par défaut ; deux clés créées depuis Réglages, montrées une fois, gardées hachées ; révoquée, refusée tout de suite", async () => {
  // Rien d'allumé : tout est refusé, même la route des modèles.
  let r = await appeler(null, null, { chemin: "/v1/models", methode: "GET" });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error.code, "passerelle_coupee");
  let v = await fetch(`${base}/api/passerelle`, { headers: session }).then((x) => x.json());
  assert.equal(v.active, false, "coupée par défaut");
  assert.deepEqual(v.cles, { clavier: null, fond: null });
  assert.equal((await fetch(`${base}/api/passerelle`)).status, 401, "réglages : jamais sans session");
  assert.equal((await fetch(`${base}/api/passerelle/cles/fond`, { method: "POST" })).status, 401, "une clé ne se crée pas sans session");
  assert.equal((await fetch(`${base}/api/passerelle/cles/fond`, { method: "POST", headers: { ...session, Origin: "https://ailleurs.example" } })).status, 403, "ni depuis une autre origine");
  assert.equal((await reglages({ active: "oui" })).status, 400);
  assert.equal((await reglages({ attenteMaxS: 5 })).status, 400, "attente bornée (10 à 600 s)");
  assert.equal((await reglages({ inconnu: true })).status, 400);

  const clavier = await creerCle("clavier");
  const fond = await creerCle("fond");
  assert.match(clavier.cle, /^remy_clavier_[A-Za-z0-9_-]{43}$/);
  assert.match(fond.cle, /^remy_fond_[A-Za-z0-9_-]{43}$/);
  // Relue : jamais la clé, seulement sa date et sa fin.
  v = await fetch(`${base}/api/passerelle`, { headers: session }).then((x) => x.json());
  assert.equal(JSON.stringify(v).includes(clavier.cle), false);
  assert.equal(v.cles.clavier.apercu, `remy_clavier_…${clavier.cle.slice(-4)}`);
  assert.equal(v.cles.fond.hash, undefined, "l'empreinte ne sort pas non plus");
  const disque = fs.readFileSync(path.join(dossier, "passerelle.json"), "utf8");
  assert.equal(disque.includes(clavier.cle) || disque.includes(fond.cle), false, "sur la tour : l'empreinte, jamais la clé");
  assert.ok(disque.includes(crypto.createHash("sha256").update(clavier.cle).digest("hex")));

  // Encore coupée : la clé ne suffit pas.
  r = await appeler(clavier.cle, null, { chemin: "/v1/models", methode: "GET" });
  assert.equal(r.status, 404);
  assert.equal((await reglages({ active: true })).active, true);
  r = await appeler(clavier.cle, null, { chemin: "/v1/models", methode: "GET" });
  assert.equal(r.status, 200);
  const liste = await r.json();
  assert.deepEqual(liste.data.map((m) => m.id), ["Modele-Essai"], "le modèle de Rémy, et lui seul");
  assert.equal(liste.data[0].context_length, 32768);
  assert.equal((await appeler(fond.cle, null, { chemin: "/v1/models/Modele-Essai", methode: "GET" })).status, 200);
  assert.equal((await appeler(fond.cle, null, { chemin: "/v1/models/Autre-Modele", methode: "GET" })).status, 404);

  // Remplacée : l'ancienne ne marche plus ; révoquée : refusée tout de suite.
  const neuve = await creerCle("fond");
  assert.equal((await appeler(fond.cle, null, { chemin: "/v1/models", methode: "GET" })).status, 401, "l'ancienne clé est morte");
  assert.equal((await appeler(neuve.cle, null, { chemin: "/v1/models", methode: "GET" })).status, 200);
  await revoquer("fond");
  assert.equal((await appeler(neuve.cle, null, { chemin: "/v1/models", methode: "GET" })).status, 401, "révoquée : refusée tout de suite");
  cles = { clavier: clavier.cle, fond: (await creerCle("fond")).cle };
  assert.equal(journaux.some((l) => l.includes(clavier.cle) || l.includes(neuve.cle) || l.includes(cles.fond)), false, "aucune clé dans les journaux");
  const { CAPACITES } = await import("../lib/version.js");
  assert.ok(CAPACITES.includes("passerelle-v1"));
});

test("refus sans clé valide, à temps constant : les deux empreintes sont toujours comparées", async () => {
  await remiseAZero();
  const avant = modele.etat.recus.length;
  for (const entetes of [{}, { Authorization: "Bearer remy_fond_faux" }, { Authorization: `Basic ${cles.fond}` }, { Authorization: `Bearer ${cles.fond}x` }, { "X-Api-Key": cles.fond }, { Cookie: session.Cookie }]) {
    const r = await appeler(null, question("Bonjour"), { entetes });
    assert.equal(r.status, 401, JSON.stringify(Object.keys(entetes)));
    const j = await r.json();
    assert.equal(j.error.code, "invalid_api_key");
    assert.equal(JSON.stringify(j).includes(cles.fond), false);
  }
  assert.equal(modele.etat.recus.length, avant, "rien n'est parti vers le modèle");
  // La comparaison : deux timingSafeEqual à chaque fois, quelle que soit la clé.
  const vrai = crypto.timingSafeEqual;
  let n = 0;
  crypto.timingSafeEqual = (a, b) => (n++, vrai(a, b));
  try {
    const etat = { cles: { clavier: { hash: crypto.createHash("sha256").update("a").digest("hex") }, fond: null } };
    for (const [cle, attendu] of [["a", "clavier"], ["b", null], [null, null], ["", null]]) {
      n = 0;
      assert.equal(P.typeDeCle(cle, etat), attendu);
      assert.equal(n, 2, `deux comparaisons pour ${JSON.stringify(cle)}`);
    }
  } finally {
    crypto.timingSafeEqual = vrai;
  }
  // Une route que la passerelle ne connaît pas (l'API « responses ») : refusée, clé valide ou non.
  assert.equal((await appeler(cles.fond, {}, { chemin: "/v1/responses" })).status, 404);
  assert.equal((await appeler(cles.fond, null, { chemin: "/v1/chat/completions", methode: "GET" })).status, 405);
  // /v1 n'existe pas dans la table de l'API (donc pas sur Vercel) : seulement server.js.
  const faux = { method: "GET", url: "/v1/models", headers: { host: "x" } };
  assert.equal(await routeApi(faux, { once() {}, setHeader() {}, end() {} }), false);
});

test("liste blanche : ni les en-têtes de l'outil ni sa clé ne partent ; paramètres inconnus écartés ; le modèle est celui de Rémy", async () => {
  await remiseAZero();
  const r = await appeler(cles.clavier, question("Écris une fonction", {
    temperature: 0.3, max_tokens: 999_999, stop: "FIN", tools: [{ type: "function", function: { name: "lire_fichier", parameters: { type: "object" } }, extra: 1 }],
    tool_choice: "auto", user: "quelqu-un", metadata: { a: 1 }, chat_template_kwargs: { x: 1 }, guided_json: {}, n: 3, logprobs: true, extra_body: { url: "http://ailleurs" },
    messages: [{ role: "developer", content: "Consigne" }, { role: "user", content: [{ type: "text", text: "Écris une fonction" }], cache_control: { type: "ephemeral" } }],
  }), { entetes: { Cookie: "secret=1", "X-Forwarded-For": "10.0.0.9", "X-Custom": "1", "OpenAI-Organization": "org", Host: "ailleurs.example" } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.choices[0].message.content, /Écris une fonction/);
  assert.equal(r.headers.get("x-moteur-interne"), null, "les en-têtes du moteur ne reviennent pas non plus");
  const recu = modele.etat.recus.at(-1);
  assert.equal(recu.entetes.authorization, "Bearer jeton-du-relais-essai", "le jeton de Rémy vers le modèle, jamais la clé de l'outil");
  for (const h of ["cookie", "x-forwarded-for", "x-custom", "openai-organization"]) assert.equal(recu.entetes[h], undefined, `${h} n'est pas relayé`);
  assert.equal(recu.entetes.host, new URL(modele.url).host);
  assert.equal(JSON.stringify(recu).includes(cles.clavier), false);
  assert.deepEqual(Object.keys(recu.corps).sort(), ["max_tokens", "messages", "model", "stop", "temperature", "tool_choice", "tools"]);
  assert.equal(recu.corps.model, "Modele-Essai");
  assert.equal(recu.corps.max_tokens, 32768, "plafonné");
  assert.deepEqual(recu.corps.stop, ["FIN"]);
  assert.deepEqual(recu.corps.tools, [{ type: "function", function: { name: "lire_fichier", parameters: { type: "object" } } }]);
  assert.deepEqual(recu.corps.messages, [{ role: "system", content: "Consigne" }, { role: "user", content: [{ type: "text", text: "Écris une fonction" }] }]);
});

test("refus : image par adresse (le moteur irait la chercher), corps illisible, rôle inconnu, requête trop grande", async () => {
  await remiseAZero();
  const avant = modele.etat.recus.length;
  const image = (url) => question("x", { messages: [{ role: "user", content: [{ type: "text", text: "Que vois-tu ?" }, { type: "image_url", image_url: { url } }] }] });
  for (const url of ["http://169.254.169.254/latest", "https://ailleurs.example/a.png", "file:///etc/passwd", "data:text/html;base64,AAAA"]) {
    const r = await appeler(cles.fond, image(url));
    assert.equal(r.status, 400, url);
    assert.match((await r.json()).error.message, /Image par adresse refusée/);
  }
  assert.equal((await appeler(cles.fond, { messages: [{ role: "root", content: "x" }] })).status, 400);
  assert.equal((await appeler(cles.fond, { messages: [] })).status, 400);
  assert.equal((await appeler(cles.fond, question("x", { temperature: "chaud" }))).status, 400);
  const brut = await fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${cles.fond}` }, body: "{pas du json" });
  assert.equal(brut.status, 400);
  process.env.REMY_PASSERELLE_MAX_OCTETS = "2000";
  const gros = await appeler(cles.fond, question("x".repeat(5000)));
  assert.equal(gros.status, 413);
  assert.equal((await gros.json()).error.code, "requete_trop_grande");
  assert.equal(modele.etat.recus.length, avant, "aucun de ces appels n'est parti vers le modèle");
  // Une image jointe, elle, passe.
  delete process.env.REMY_PASSERELLE_MAX_OCTETS;
  assert.equal((await appeler(cles.fond, image("data:image/png;base64,iVBORw0KGgo="))).status, 200);
  assert.equal(modele.etat.recus.at(-1).corps.messages[0].content[1].image_url.url, "data:image/png;base64,iVBORw0KGgo=");
});

test("débit par clé : au-delà, 429 avec Retry-After ; l'autre clé n'est pas touchée ; la minute passée, ça repart", async () => {
  await remiseAZero();
  process.env.REMY_PASSERELLE_DEBIT_MIN = "3";
  let t = Date.now();
  P._horloge(() => t);
  for (let i = 0; i < 3; i++) assert.equal((await appeler(cles.fond, null, { chemin: "/v1/models", methode: "GET" })).status, 200);
  const r = await appeler(cles.fond, null, { chemin: "/v1/models", methode: "GET" });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "60");
  assert.equal((await r.json()).error.type, "rate_limit_error");
  assert.equal((await appeler(cles.clavier, null, { chemin: "/v1/models", methode: "GET" })).status, 200, "chaque clé a son débit");
  t += 60_001;
  assert.equal((await appeler(cles.fond, null, { chemin: "/v1/models", methode: "GET" })).status, 200);
});

test("seulement le modèle local configuré : rien sans modèle, rien vers une adresse hors de la maison, jamais le secours cloud", async () => {
  await remiseAZero();
  const vrai = globalThis.fetch;
  const vus = [];
  globalThis.fetch = (u, o) => (vus.push(String(u)), vrai(u, o));
  const url = process.env.REMY_GLM_URL;
  try {
    process.env.REMY_GLM_URL = "https://modele.example.com/v1";
    let r = await appeler(cles.clavier, question("Bonjour"));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, "modele_non_branche");
    delete process.env.REMY_GLM_URL;
    r = await appeler(cles.clavier, question("Bonjour"));
    assert.equal(r.status, 503);
    process.env.REMY_SECOURS_CLOUD = "on";
    r = await appeler(cles.clavier, question("Bonjour"));
    assert.equal(r.status, 503, "même secours allumé, rien ne part ailleurs");
  } finally {
    process.env.REMY_GLM_URL = url;
    delete process.env.REMY_SECOURS_CLOUD;
    globalThis.fetch = vrai;
  }
  assert.deepEqual(vus.filter((u) => !u.startsWith(base)), [], "aucune requête sortante");
  // Les refus du serveur du modèle : lisibles, et jamais un 401 qui ferait croire à l'outil que SA clé est fausse.
  let r = await appeler(cles.clavier, question("REFUS-401"));
  assert.equal(r.status, 502);
  r = await appeler(cles.clavier, question("REFUS-400"));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error.message, /refus d'essai 400/);
});

test("en flux : relayé tel quel ; l'événement des jetons seulement si l'outil l'a demandé ; le panneau des coûts reçoit des compteurs, pas le contenu", async () => {
  await remiseAZero();
  let r = await appeler(cles.fond, question("Code secret de la boutique", { stream: true }));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/event-stream/);
  let evs = await lireFlux(r);
  assert.equal(evs.at(-1), "[DONE]");
  assert.equal(evs.filter((e) => e !== "[DONE]").map((e) => e.choices[0]?.delta?.content || "").join(""), "m0 m1 m2 m3 ");
  assert.equal(evs.some((e) => e.usage), false, "pas demandé : pas d'événement des jetons");
  assert.equal(modele.etat.recus.at(-1).corps.stream_options.include_usage, true, "demandé au modèle quand même, pour compter");
  r = await appeler(cles.clavier, question("Autre chose", { stream: true, stream_options: { include_usage: true } }));
  evs = await lireFlux(r);
  assert.deepEqual(evs.find((e) => e.usage)?.usage, { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
  await attendre(30);
  const couts = (await store.listCostEntries()).filter((e) => e.kind === "outil de code");
  assert.ok(couts.length >= 2);
  const [dernier, avant] = couts;
  assert.match(dernier.label, /^Clé « au clavier » · \d+,\d s$/);
  assert.match(avant.label, /^Clé « agents de fond » · /);
  assert.equal(dernier.in, 11);
  assert.equal(dernier.out, 7);
  assert.equal(dernier.usd, 0);
  assert.equal(dernier.local, true);
  const tout = fs.readdirSync(dossier).map((f) => (fs.statSync(path.join(dossier, f)).isFile() ? fs.readFileSync(path.join(dossier, f), "utf8") : "")).join("\n");
  assert.equal(tout.includes("Code secret de la boutique"), false, "le contenu n'est gardé nulle part");
  assert.equal(journaux.some((l) => l.includes("Code secret")), false, "ni journalisé");
});

test("agents de fond pendant une question : l'appel en cours finit (pas coupé), les nouveaux attendent en file, dans l'ordre, puis partent ; Diagnostic le dit", async () => {
  await remiseAZero();
  const lire = (p) => p.then(lireFlux);
  const a = lire(appeler(cles.fond, question("LONG agent A", { stream: true })));
  await modele.enCalcul(/agent A/);
  const fin = prio.debutDemande("question");
  const b = appeler(cles.fond, question("agent B"));
  await attendre(10);
  const c = appeler(cles.fond, question("agent C"));
  await jusqua(() => P.etatPasserelle().enFile === 2, 2_000, "deux appels en file");
  const vue = await fetch(`${base}/api/fond`, { headers: session }).then((x) => x.json());
  assert.equal(vue.ligne, "1 appel d'agent en cours · 2 appels d'agents en attente : tu viens de poser une question");
  assert.deepEqual(vue.agents, { enAttente: 2, enCours: 1 });
  const evsA = await a;
  assert.equal(evsA.at(-1), "[DONE]", "l'appel déjà parti finit en entier");
  assert.deepEqual(modele.etat.coupes, [], "rien n'est coupé");
  await attendre(60);
  assert.deepEqual(modele.etat.recus.map((x) => x.texte), ["LONG agent A"], "aucun autre ne part pendant la question");
  fin();
  const [rb, rc] = await Promise.all([b, c]);
  assert.equal(rb.status, 200);
  assert.equal(rc.status, 200);
  assert.deepEqual(modele.etat.recus.map((x) => x.texte), ["LONG agent A", "agent B", "agent C"], "dans l'ordre d'arrivée");
  assert.equal(P.etatPasserelle().enFile, 0);
  const couts = (await store.listCostEntries()).filter((e) => e.kind === "outil de code");
  assert.ok(couts.some((e) => /d'attente/.test(e.label)), "l'attente est comptée");
});

test("la clé « au clavier » est une demande : elle coupe la réflexion de nuit de Rémy, passe tout de suite, et les agents de fond attendent la fin de son répit", async () => {
  await remiseAZero();
  const f = path.join(dossier, "reflexion-essai.txt");
  jobs.enregistrer("reflexion-nuit", { circuit: "syntheses", executer: travailEssai(glmProvider, f) });
  jobs.planifier("reflexion-nuit", { cle: "reflexion-nuit:passerelle", entree: { jour: "2026-11-12" } });
  const passe = jobs.passer({ limite: 1 });
  await modele.enCalcul(/FOND/);
  process.env.REMY_FOND_REPIT_MS = "200";
  const t0 = Date.now();
  const clavier = appeler(cles.clavier, question("LONG au clavier", { stream: true }));
  await jusqua(() => modele.etat.coupes.length === 1, 2_000, "réflexion coupée");
  assert.match(modele.etat.coupes[0], /FOND/, "la réflexion de nuit a cédé");
  await modele.enCalcul(/au clavier/);
  assert.ok(Date.now() - t0 < 400, "la réponse au clavier n'a pas attendu les 900 ms du fond");
  assert.deepEqual(serveurMaj.occupation().raisons, ["1 réponse à ton outil de code en cours"], "la mise à jour attend la réponse au clavier");
  const agent = appeler(cles.fond, question("agent pendant le clavier"));
  await jusqua(() => P.etatPasserelle().enFile === 1, 2_000, "agent en file");
  assert.match((await fetch(`${base}/api/fond`, { headers: session }).then((x) => x.json())).ligne, /1 appel d'agent en attente : tu travailles dans ton outil de code/);
  const evs = await (await clavier).text();
  const finClavier = Date.now();
  assert.match(evs, /\[DONE\]/);
  assert.equal((await agent).status, 200);
  const parti = modele.etat.recus.find((x) => x.texte === "agent pendant le clavier").a;
  assert.ok(parti - finClavier >= 150, `l'agent est parti après le répit (${parti - finClavier} ms)`);
  process.env.REMY_FOND_REPIT_MS = "0";
  const [res] = await passe;
  assert.equal(res.etat, "fait", "la réflexion reprend et finit, sans erreur");
});

test("attente bornée : 503 + Retry-After, rien n'est parti ; file pleine : 503 tout de suite ; un outil parti quitte la file", async () => {
  await remiseAZero();
  process.env.REMY_PASSERELLE_ATTENTE_MS = "150";
  const fin = prio.debutDemande("question");
  const t0 = Date.now();
  const r = await appeler(cles.fond, question("agent patient"));
  assert.equal(r.status, 503);
  assert.ok(Date.now() - t0 >= 140, "après le délai réglé");
  assert.equal(r.headers.get("retry-after"), "10");
  const j = await r.json();
  assert.equal(j.error.code, "remy_occupe");
  assert.match(j.error.message, /tu viens de poser une question/);
  assert.equal(P.etatPasserelle().enFile, 0);

  delete process.env.REMY_PASSERELLE_ATTENTE_MS;
  assert.equal((await reglages({ fileMax: 1 })).fileMax, 1);
  const premier = appeler(cles.fond, question("agent premier"));
  await jusqua(() => P.etatPasserelle().enFile === 1, 2_000, "premier en file");
  const second = await appeler(cles.fond, question("agent second"));
  assert.equal(second.status, 503);
  assert.equal((await second.json()).error.code, "file_pleine");
  assert.ok(second.headers.get("retry-after"));

  // L'outil abandonne (Échap dans son terminal) : il sort de la file.
  const ctrl = new AbortController();
  await reglages({ fileMax: 8 });
  const parti = appeler(cles.fond, question("agent abandonné"), { signal: ctrl.signal }).catch(() => "coupé");
  await jusqua(() => P.etatPasserelle().enFile === 2, 2_000, "deux en file");
  ctrl.abort();
  assert.equal(await parti, "coupé");
  await jusqua(() => P.etatPasserelle().enFile === 1, 2_000, "l'abandonné a quitté la file");
  fin();
  assert.equal((await premier).status, 200);
  await attendre(50);
  assert.deepEqual(modele.etat.recus.map((x) => x.texte), ["agent premier"], "rien n'est parti pour l'outil qui a abandonné");
});

test("réglage « couper un appel sans flux » : coupé pour une question, refait en entier, une seule réponse à l'outil", async () => {
  await remiseAZero();
  await reglages({ couperSansFlux: true });
  const a = appeler(cles.fond, question("LONG sans flux"));
  await modele.enCalcul(/LONG sans flux/);
  const fin = prio.debutDemande("question");
  await jusqua(() => modele.etat.coupes.length === 1, 2_000, "coupé");
  await attendre(30);
  fin();
  const r = await a;
  assert.equal(r.status, 200);
  assert.match((await r.json()).choices[0].message.content, /LONG sans flux/);
  assert.equal(modele.etat.recus.filter((x) => x.texte === "LONG sans flux").length, 2, "refait en entier");
  // Un appel en flux, lui, n'est jamais coupé, même avec ce réglage.
  modele.vider();
  const s = appeler(cles.fond, question("LONG en flux", { stream: true }));
  await modele.enCalcul(/LONG en flux/);
  const fin2 = prio.debutDemande("question");
  const evs = await lireFlux(await s);
  fin2();
  assert.equal(evs.at(-1), "[DONE]");
  assert.deepEqual(modele.etat.coupes, []);
  await reglages({ couperSansFlux: false });
});

test("les réglages de la passerelle relus par le site : adresses, limites, compteurs", async () => {
  await remiseAZero();
  const v = await fetch(`${base}/api/passerelle`, { headers: session }).then((x) => x.json());
  assert.equal(v.active, true);
  assert.equal(v.branche, true);
  assert.equal(typeof v.portLocal, "number");
  assert.deepEqual(v.bornes, { attenteMaxS: [10, 600], fileMax: [1, 50] });
  assert.equal(v.enFile, 0);
  assert.ok(v.cles.clavier.dernierUsage, "le dernier usage est noté");
  assert.equal((await reglages({ active: false })).active, false);
  assert.equal((await appeler(cles.fond, null, { chemin: "/v1/models", methode: "GET" })).status, 404, "recoupée : refusée");
});

test("Diagnostic : les appels d'agents sont comptés, au singulier comme au pluriel, à côté du fond de Rémy", () => {
  const t = (etat, travail = "agent-fond", nom = "Appel d'un agent de fond") => ({ travail, nom, etat });
  const cede = { raison: "tu viens de poser une question" };
  assert.equal(prio.phraseFond({ travaux: [t("pause")], cede }), "1 appel d'agent en attente : tu viens de poser une question");
  assert.equal(prio.phraseFond({ travaux: [t("attente"), t("attente")] }), "2 appels d'agents attendent leur place sur le modèle local");
  assert.equal(prio.phraseFond({ travaux: [t("attente")] }), "1 appel d'agent attend sa place sur le modèle local");
  assert.equal(
    prio.phraseFond({ travaux: [t("pause", "reflexion-nuit", "Réflexion de nuit"), t("pause"), t("actif"), t("pause")], cede }),
    "Réflexion de nuit en pause : tu viens de poser une question · 2 appels d'agents en attente : tu viens de poser une question · 1 appel d'agent en cours",
  );
});
