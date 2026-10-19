// « Interrompre » : POST /api/conversations/:id/stop coupe la réponse en cours.
//
// Ce que ces tests tiennent, de bout en bout par les vraies routes :
//   - le fournisseur est VRAIMENT coupé (le faux modèle voit sa connexion
//     fermée), pas seulement l'affichage ;
//   - la réponse partielle est enregistrée avec sa mention « (interrompu) »,
//     AVANT que l'arrêt rende la main (sinon le message suivant serait écrasé) ;
//   - coupée avant le premier mot : ni titre ni mémoire (aucun appel IA) ;
//   - le SDK Anthropic reçoit bien le signal.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// --- Faux GLM (API OpenAI de tensorfold) -----------------------------------------
// Le flux envoie ses morceaux puis se tait : seule une coupure le termine.
let morceaux = ["Bonjour ", "Jo"];
let coupes = 0; // flux fermés par Rémy avant leur fin
let appelsTaches = []; // routeur, titre, mémoire (appels non streamés)
const glm = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "GLM-5.3-Flash-EXL3" }] }));
    }
    const b = JSON.parse(body || "{}");
    if (!b.stream) {
      const sys = b.messages?.[0]?.content || "";
      const quoi = /routeur/i.test(sys) ? "routeur" : /titre/i.test(sys) ? "titre" : /mémoire/i.test(sys) ? "mémoire" : "autre";
      appelsTaches.push(quoi);
      const texte = quoi === "routeur" ? "raisonnement" : quoi === "titre" ? "Salutations" : "NO_UPDATE";
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: texte }, finish_reason: "stop" }], usage: {} }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    let fini = false;
    res.on("close", () => {
      if (!fini) coupes++;
    });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: "…" } }] })}\n\n`);
    for (const m of morceaux) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: m } }] })}\n\n`);
    // …et plus rien : un modèle qui écrit longtemps.
    setTimeout(() => {
      fini = true;
      res.end("data: [DONE]\n\n");
    }, 30_000).unref();
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

// --- Faux Anthropic : un flux qui commence puis se tait ----------------------------
let anthropicCoupe = false;
const anthropic = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.on("close", () => (anthropicCoupe = true));
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev("message_start", {
      message: { id: "msg_1", type: "message", role: "assistant", content: [], model: "claude-sonnet-5", stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 1 } },
    });
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Je cherche" } });
  });
});
await new Promise((r) => anthropic.listen(0, "127.0.0.1", r));

// --- Rémy, sur un dossier de données jetable -----------------------------------------
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-arret-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_CERVEAU"]) {
  delete process.env[v];
}
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_PROVIDER = "api";
process.env.ANTHROPIC_API_KEY = "cle-de-test";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropic.address().port}`;
process.env.REMY_BROWSE = "off";

const { routeApi } = await import("../lib/routes.js");
const { arreterGeneration, attendreFin, demarrerGeneration, avecMention, MENTION_INTERROMPU } = await import("../lib/arret.js");
const { apiProvider } = await import("../lib/providers.js");

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;

test.after(() => {
  remy.close();
  glm.close();
  anthropic.close();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const post = (chemin, corps) =>
  fetch(base + chemin, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps ?? {}) });

// Envoie un message et lit le flux SSE ; `quand` est appelé à chaque événement.
async function envoyer(id, texte, quand) {
  const r = await post(`/api/conversations/${id}/messages`, { text: texte });
  assert.equal(r.status, 200);
  const lecteur = r.body.getReader();
  const dec = new TextDecoder();
  let tampon = "";
  const evenements = [];
  while (true) {
    const { done, value } = await lecteur.read();
    if (done) break;
    tampon += dec.decode(value, { stream: true });
    let i;
    while ((i = tampon.indexOf("\n\n")) !== -1) {
      const brut = tampon.slice(0, i);
      tampon = tampon.slice(i + 2);
      const nom = brut.match(/^event: (.+)$/m)?.[1];
      const data = JSON.parse(brut.match(/^data: (.+)$/m)?.[1] || "null");
      evenements.push({ nom, data });
      await quand?.(nom, data, evenements);
    }
  }
  return evenements;
}

const nouvelleConversation = async () => (await post("/api/conversations")).json();
const lire = async (id) => (await fetch(`${base}/api/conversations/${id}`)).json();

test("rien en cours : l'arrêt répond sans erreur", async () => {
  const c = await nouvelleConversation();
  const r = await post(`/api/conversations/${c.id}/stop`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, arrete: false });
});

test("une autre origine ne peut pas interrompre", async () => {
  const c = await nouvelleConversation();
  const r = await fetch(`${base}/api/conversations/${c.id}/stop`, { method: "POST", headers: { Origin: "https://ailleurs.example" } });
  assert.equal(r.status, 403);
});

test("interrompre coupe le modèle et garde la réponse partielle, avec sa mention", async () => {
  morceaux = ["Bonjour ", "Jo"];
  coupes = 0;
  appelsTaches = [];
  const c = await nouvelleConversation();
  let arret = null;
  const evenements = await envoyer(c.id, "Salut Rémy", async (nom, _d, tous) => {
    const texte = tous.filter((e) => e.nom === "delta").map((e) => e.data.text).join("");
    if (nom === "delta" && texte === "Bonjour Jo" && !arret) {
      // Sans attendre : le flux doit continuer d'être lu pendant l'arrêt.
      arret = post(`/api/conversations/${c.id}/stop`).then((r) => r.json());
    }
  });
  assert.deepEqual(await arret, { ok: true, arrete: true });
  const done = evenements.find((e) => e.nom === "done");
  assert.ok(done, "le flux se termine par « done », pas par une erreur");
  assert.equal(done.data.interrompu, true);
  assert.equal(done.data.text, `Bonjour Jo\n\n${MENTION_INTERROMPU}`);
  assert.equal(coupes, 1, "la requête au modèle est fermée");

  const conv = await lire(c.id);
  const dernier = conv.messages.at(-1);
  assert.equal(conv.messages.length, 2);
  assert.equal(dernier.role, "assistant");
  assert.equal(dernier.content, `Bonjour Jo\n\n${MENTION_INTERROMPU}`);
  assert.equal(dernier.interrompu, true);
  // Une réponse partielle mais réelle : titre et mémoire suivent leur cours.
  assert.ok(appelsTaches.includes("titre"));

  // Le message suivant voit la réponse partielle juste avant lui.
  const ensuite = await envoyer(c.id, "Reprends", async (nom) => {
    if (nom === "delta") await post(`/api/conversations/${c.id}/stop`);
  });
  assert.ok(ensuite.some((e) => e.nom === "done"));
  const apres = await lire(c.id);
  assert.deepEqual(apres.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(apres.messages[2].content, "Reprends");
});

test("coupée avant le premier mot : mention seule, ni titre ni mémoire", async () => {
  morceaux = []; // le modèle réfléchit, n'a encore rien écrit
  appelsTaches = [];
  const c = await nouvelleConversation();
  let arret = null;
  const evenements = await envoyer(c.id, "Question difficile", async (nom, data) => {
    if (nom === "status" && /réfléchit/.test(data.text) && !arret) {
      arret = post(`/api/conversations/${c.id}/stop`).then((r) => r.json());
    }
  });
  assert.deepEqual(await arret, { ok: true, arrete: true });
  assert.equal(evenements.find((e) => e.nom === "done")?.data.text, MENTION_INTERROMPU);
  const conv = await lire(c.id);
  assert.equal(conv.messages.length, 2, "le message de Sam reste : le modèle le verra au tour suivant");
  assert.equal(conv.messages[1].content, MENTION_INTERROMPU);
  assert.deepEqual(appelsTaches, ["routeur"], "aucun appel de titre ni de mémoire après l'arrêt");
});

test("un message envoyé pendant l'écriture attend qu'elle se termine", async () => {
  const g = demarrerGeneration("fil-occupe");
  let libre = null;
  const attente = attendreFin("fil-occupe", 2000).then((v) => (libre = v));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(libre, null, "toujours en attente");
  g.liberer();
  assert.equal(await attente, true);
  assert.equal(await attendreFin("fil-occupe"), true, "plus rien en cours");
  const h = demarrerGeneration("fil-bloque");
  assert.equal(await attendreFin("fil-bloque", 20), false, "délai écoulé : le client recevra 409");
  h.liberer();
  assert.equal(await arreterGeneration("fil-bloque"), false);
});

test("la mention s'ajoute proprement", () => {
  assert.equal(avecMention("Bonjour  \n"), `Bonjour\n\n${MENTION_INTERROMPU}`);
  assert.equal(avecMention(""), MENTION_INTERROMPU);
});

test("SDK Anthropic : le signal coupe le flux en cours", async () => {
  anthropicCoupe = false;
  const controleur = new AbortController();
  let vu = "";
  const p = apiProvider.stream({
    system: [{ type: "text", text: "sys" }],
    messages: [{ role: "user", content: "cherche" }],
    model: "claude-haiku-4-5",
    signal: controleur.signal,
    onText: (t) => {
      vu += t;
      controleur.abort();
    },
  });
  await assert.rejects(p);
  assert.equal(vu, "Je cherche");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(anthropicCoupe, true, "la connexion à l'API est fermée");
});
