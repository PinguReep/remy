// Bac à sable et chaîne d'écriture Motion (Lot 0, J0.5).
//
// 1. Le bac à sable lui-même : `npm test` pose REMY_ENV=test, et le code
//    refuse alors toute requête vers un vrai Motion ou un vrai Google.
// 2. Le faux Motion à état : pagination, quota, pannes.
// 3. Les défauts prouvés par sonde lors de l'audit du 13/10 (plan technique,
//    §2.2 et §3.2), écrits comme ils DOIVENT se comporter. Rouges sur le code
//    d'avant, verts avec la chaîne d'écriture (J0.7, lib/ecriture.js).

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFauxMotion } from "./outils/faux-motion.mjs";

const motion = await demarrerFauxMotion({ pageTaille: 3 });
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-ecriture-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "GOOGLE_CLIENT_ID", "MOTION_WORKSPACE_ID", "MOTION_WRITE"]) {
  delete process.env[v];
}
process.env.REMY_DATA_DIR = dossier;
process.env.MOTION_API_KEY = "faux";
process.env.MOTION_BASE_URL = motion.url;

const store = await import("../lib/store.js");
const lm = await import("../lib/motion.js");
const { routeApi } = await import("../lib/routes.js");
const { exigerBacASable } = await import("../lib/bac-a-sable.js");
const { db, fermer } = await import("../lib/db.js");
const journalDe = (convId) => db().prepare("SELECT * FROM journal WHERE conv_id = ?").all(convId);

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;

test.after(async () => {
  remy.close();
  await motion.fermer();
  fermer(); // sous Windows, une base ouverte ne se supprime pas
  fs.rmSync(dossier, { recursive: true, force: true });
});

const lireConv = async (id) => (await fetch(`${base}/api/conversations/${id}`)).json();
const post = async (p, b) => {
  const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// --- 1. Bac à sable ---------------------------------------------------------------------

test("npm test pose REMY_ENV=test", () => {
  assert.equal(process.env.REMY_ENV, "test");
});

test("en test, une requête vers le vrai Motion ou le vrai Google est refusée par le code", () => {
  assert.throws(() => exigerBacASable("https://api.usemotion.com/v1", "Motion"), /Motion RÉEL refusée/);
  assert.throws(() => exigerBacASable("https://www.googleapis.com/calendar/v3", "Google"), /Google RÉEL refusée/);
  assert.doesNotThrow(() => exigerBacASable(motion.url, "Motion"));
  const avant = process.env.REMY_ENV;
  delete process.env.REMY_ENV; // hors test (la tour) : rien n'est bloqué
  try {
    assert.doesNotThrow(() => exigerBacASable("https://api.usemotion.com/v1", "Motion"));
  } finally {
    process.env.REMY_ENV = avant;
  }
});

// --- 2. Faux Motion ------------------------------------------------------------------------

test("faux Motion : pagination par curseur lue en entier par Rémy", async () => {
  motion.taches.clear();
  for (let i = 1; i <= 7; i++) motion.ajouter({ id: `p${i}`, name: `Tâche ${i}` });
  const liste = await lm.tachesMotion({ frais: true });
  assert.equal(liste.length, 7);
  assert.ok(motion.requetes.filter((r) => r.methode === "GET" && r.chemin.startsWith("/v1/tasks")).length >= 3);
});

test("faux Motion : quota par minute (429) et pannes injectées", async () => {
  const m = await demarrerFauxMotion({ quotaParMinute: 2 });
  try {
    const get = (p) => fetch(m.url + p).then((r) => r.status);
    assert.deepEqual([await get("/users/me"), await get("/users/me"), await get("/users/me")], [200, 200, 429]);
    const m2 = await demarrerFauxMotion();
    m2.ajouter({ id: "x1" });
    m2.pannes.push({ methode: "GET", chemin: /\/tasks\/x1$/, code: 500, fois: 1 });
    assert.equal(await fetch(`${m2.url}/tasks/x1`).then((r) => r.status), 500);
    assert.equal(await fetch(`${m2.url}/tasks/x1`).then((r) => r.status), 200);
    assert.equal(await fetch(`${m2.url}/tasks/absente`).then((r) => r.status), 404);
    await m2.fermer();
  } finally {
    await m.fermer();
  }
});

// --- 3. Défauts à corriger par la chaîne d'écriture (J0.7) ------------------------------------

async function propositionEnAttente(convId, actions) {
  await store.putConversation({
    id: convId,
    title: "t",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [
      { role: "user", content: "décale" },
      { role: "assistant", content: "je te propose", proposal: { id: `p-${convId}`, source: "motion", resume: "décaler", actions, statut: "en_attente" } },
    ],
  });
}

function deuxTaches() {
  motion.taches.clear();
  motion.ajouter({ id: "t1", name: "Relire le contrat", dueDate: "2026-10-15T21:59:00Z" });
  motion.ajouter({ id: "t2", name: "Payer la facture", dueDate: "2026-10-16T21:59:00Z" });
  return [
    { type: "modifier", id: "t1", nom: "Relire le contrat", echeance: "2026-10-20T21:59:00Z" },
    { type: "modifier", id: "t2", nom: "Payer la facture", echeance: "2026-10-21T21:59:00Z" },
  ];
}

test("sonde 1 — renvoyer la même application (réseau coupé) ne l'applique pas deux fois", async () => {
  const actions = deuxTaches();
  await propositionEnAttente("c1", actions);
  const a1 = await post("/api/motion/apply", { actions, resume: "décaler", convId: "c1", index: 1 });
  const a2 = await post("/api/motion/apply", { actions, resume: "décaler", convId: "c1", index: 1 });
  assert.equal(a1.status, 200);
  // Attendu : la seconde demande rend le MÊME résultat (même journal), sans nouvel effet.
  assert.equal(a2.body?.ledgerId, a1.body?.ledgerId);
  assert.equal(journalDe("c1").length, 1);
  // Motion n'a reçu qu'une modification par tâche.
  assert.equal(motion.requetes.filter((r) => r.methode === "PATCH" && r.chemin === "/v1/tasks/t1").length, 1);
});

test("sonde 2 — « Annuler » restaure vraiment l'état d'avant, même après un double envoi", async () => {
  const actions = deuxTaches();
  await propositionEnAttente("c2", actions);
  await post("/api/motion/apply", { actions, resume: "décaler", convId: "c2", index: 1 });
  const a2 = await post("/api/motion/apply", { actions, resume: "décaler", convId: "c2", index: 1 });
  const conv = await store.getConversation("c2");
  const vue = await lireConv("c2");
  const u = await post("/api/motion/undo", { id: vue.messages[1].proposal.ledgerId || a2.body?.ledgerId });
  assert.equal(u.body?.ok, true);
  assert.equal(motion.taches.get("t1").dueDate, "2026-10-15T21:59:00Z");
  // La conversation le dit (forme comprise par les builds déjà installés).
  const apres = await lireConv("c2");
  assert.equal(apres.messages[1].proposal.annulee, true);
  void conv;
});

test("sonde 3 — une annulation partielle reste reprenable", async () => {
  const actions = deuxTaches();
  await propositionEnAttente("c3", actions);
  const a = await post("/api/motion/apply", { actions, resume: "décaler", convId: "c3", index: 1 });
  motion.pannes.push({ methode: "PATCH", chemin: /\/tasks\/t2$/, code: 500, fois: 1 });
  const u1 = await post("/api/motion/undo", { id: a.body.ledgerId });
  assert.deepEqual(u1.body?.undone?.map((x) => x.ok).sort(), [false, true]);
  // Attendu : la reprise défait ce qui reste, au lieu d'un 409 « Déjà annulé ».
  const u2 = await post("/api/motion/undo", { id: a.body.ledgerId });
  assert.equal(u2.status, 200);
  assert.equal(motion.taches.get("t2").dueDate, "2026-10-16T21:59:00Z");
});

test("sonde 4 — /api/motion/undo refuse un journal d'agenda", async () => {
  db().prepare(`INSERT INTO journal (id, ts, source, etat, actions, results, annulations, maj_a)
    VALUES ('ag1', ?, 'agenda', 'appliquee', '[]', ?, '{}', ?)`).run(Date.now(), JSON.stringify([{ ok: true, type: "creer", titre: "Dentiste", eventId: "e1", annulable: "supprimer" }]), Date.now());
  const u = await post("/api/motion/undo", { id: "ag1" });
  assert.equal(u.status, 400);
  assert.match(u.body.message, /l'agenda/);
  assert.equal(db().prepare("SELECT annule FROM journal WHERE id = 'ag1'").get().annule, 0);
});

test("sonde 5 — deux créations simultanées (web + iPhone) ne font qu'une tâche", async () => {
  motion.taches.clear();
  const actions = [{ type: "creer", nom: "Appeler le garage", duree: 15 }];
  await propositionEnAttente("c5", actions);
  await Promise.all([
    post("/api/motion/apply", { actions, resume: "créer", convId: "c5", index: 1 }),
    post("/api/motion/apply", { actions, resume: "créer", convId: "c5", index: 1 }),
  ]);
  assert.equal(motion.ouvertes().filter((t) => t.name === "Appeler le garage").length, 1);
});

test("« Non merci » est enregistré : la proposition ne revient pas au rechargement", async () => {
  const actions = deuxTaches();
  await propositionEnAttente("c6", actions);
  const r = await post("/api/conversations/c6/propositions/p-c6/refus", {});
  assert.equal(r.status, 200);
  assert.equal((await lireConv("c6")).messages[1].proposal.statut, "refuse");
  // Et elle ne peut plus être appliquée par erreur.
  const a = await post("/api/motion/apply", { actions, resume: "décaler", convId: "c6", index: 1 });
  assert.equal(a.status, 409);
});
