// Ne plus jamais écraser (Lot 0, J0.2) :
//   - un fichier de la base ILLISIBLE bloque l'écriture au lieu de repartir de
//     zéro (avant : la conversation suivante remplaçait tout l'historique) ;
//   - un fichier ABSENT reste un démarrage normal ;
//   - une mémoire trop longue est refusée, pas tronquée en silence ;
//   - une erreur dans une route devient une réponse, pas un arrêt du serveur.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-integrite-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "MOTION_API_KEY", "GOOGLE_CLIENT_ID"]) {
  delete process.env[v];
}
process.env.REMY_DATA_DIR = dossier;

const store = await import("../lib/store.js");
const { ecrireAtomique } = await import("../lib/coffre.js");
const { routeApi } = await import("../lib/routes.js");

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
  fs.rmSync(dossier, { recursive: true, force: true });
});

const fichier = path.join(dossier, "conversations.json");

test("fichier absent : premier démarrage normal", async () => {
  fs.rmSync(fichier, { force: true });
  assert.deepEqual(await store.listConversations(), []);
});

test("fichier corrompu : l'écriture est refusée et le fichier n'a pas bougé d'un octet", async () => {
  await store.putConversation({ id: "c1", title: "Ancienne", messages: [], createdAt: 1, updatedAt: 1 });
  const sain = fs.readFileSync(fichier, "utf8");
  const corrompu = sain.slice(0, Math.floor(sain.length / 2)); // coupure en pleine écriture
  fs.writeFileSync(fichier, corrompu);

  await assert.rejects(
    store.putConversation({ id: "c2", title: "Nouvelle", messages: [], createdAt: 2, updatedAt: 2 }),
    (err) => err.code === "BASE_ILLISIBLE" && /conversations\.json/.test(err.message),
  );
  await assert.rejects(store.listConversations(), { code: "BASE_ILLISIBLE" });
  assert.equal(fs.readFileSync(fichier, "utf8"), corrompu);
  assert.deepEqual(store.fichiersIllisibles(), [{ fichier: "conversations.json", raison: "JSON invalide" }]);

  // Réparé (ou restauré) : tout repart, et l'alerte disparaît.
  fs.writeFileSync(fichier, sain);
  assert.equal((await store.listConversations()).length, 1);
  assert.deepEqual(store.fichiersIllisibles(), []);
});

test("une route sur une base illisible répond 503 avec le nom du fichier, et le serveur continue", async () => {
  const sain = fs.readFileSync(fichier, "utf8");
  fs.writeFileSync(fichier, "{ pas du json");
  const r = await fetch(`${base}/api/conversations`);
  assert.equal(r.status, 503);
  const corps = await r.json();
  assert.equal(corps.error, "base_illisible");
  assert.match(corps.message, /conversations\.json/);
  assert.match(corps.message, /Rien n'a été écrit/);
  // Toujours debout : la requête suivante est servie.
  fs.writeFileSync(fichier, sain);
  const ok = await fetch(`${base}/api/conversations`);
  assert.equal(ok.status, 200);
});

test("mémoire trop longue : refusée, l'ancienne reste intacte", async () => {
  await store.putMemory("## Identité\n- Sam [déclaré]");
  await assert.rejects(store.putMemory("x".repeat(store.MEMORY_MAX_CHARS + 1)), { code: "MEMOIRE_TROP_LONGUE" });
  assert.equal((await store.getMemory()).text, "## Identité\n- Sam [déclaré]");
  // Pile à la limite : acceptée.
  await store.putMemory("y".repeat(store.MEMORY_MAX_CHARS));
  assert.equal((await store.getMemory()).text.length, store.MEMORY_MAX_CHARS);
});

test("écriture atomique : contenu complet, aucun fichier temporaire laissé", () => {
  const f = path.join(dossier, "sous", "atomique.json");
  ecrireAtomique(f, JSON.stringify({ a: 1 }));
  ecrireAtomique(f, JSON.stringify({ a: 2 }));
  assert.deepEqual(JSON.parse(fs.readFileSync(f, "utf8")), { a: 2 });
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ["atomique.json"]);
});
