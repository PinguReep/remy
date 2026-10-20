// 19/10 : une conversation importée (ChatGPT, Claude) entrait dans la réflexion
// de nuit et pouvait repartir chez Claude avec le secours. Elle est désormais
// privée d'office, y compris celles importées avant ce correctif.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-import-prive-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;

const { routeApi } = await import("../lib/routes.js");
const store = await import("../lib/store.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); fs.rmSync(dossier, { recursive: true, force: true }); });

const exportChatGPT = {
  title: "Mon projet", create_time: 1_700_000_000, conversation_id: "c-1", current_node: "m2",
  mapping: {
    root: { id: "root", parent: null, children: ["m1"], message: null },
    m1: { id: "m1", parent: "root", children: ["m2"], message: { id: "m1", author: { role: "user" }, create_time: 1_700_000_000, content: { content_type: "text", parts: ["je monte une boutique"] } } },
    m2: { id: "m2", parent: "m1", children: [], message: { id: "m2", author: { role: "assistant" }, create_time: 1_700_000_010, content: { content_type: "text", parts: ["bonne idée"] } } },
  },
};

test("une conversation importée est privée d'office", async () => {
  const r = await fetch(`${base}/api/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversations: [exportChatGPT] }) });
  assert.equal(r.status, 200);
  const { importees } = await r.json();
  assert.equal(importees.length, 1);
  const liste = await store.listConversations();
  assert.equal(liste.find((c) => c.id === importees[0].id).prive, true);
  assert.equal((await store.getConversation(importees[0].id)).prive, true);
});

test("une conversation importée AVANT le correctif est lue comme privée", async () => {
  await store.putConversation({ id: "ancienne", title: "Vieil import", messages: [{ role: "user", content: "x" }], createdAt: 1, updatedAt: Date.now(), origine: { source: "chatgpt", cle: "k-old" } });
  assert.equal((await store.listConversations()).find((c) => c.id === "ancienne").prive, true);
  assert.equal((await store.getConversation("ancienne")).prive, true);
  // Une conversation normale, elle, ne change pas.
  await store.putConversation({ id: "normale", title: "Normale", messages: [], createdAt: 1, updatedAt: Date.now() });
  assert.equal((await store.getConversation("normale")).prive, undefined);
  assert.equal((await store.listConversations()).find((c) => c.id === "normale").prive, false);
});
