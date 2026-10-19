// « Corriger la dictée » : un mot surligné dans l'app part à Dictée Locale (sur
// la tour, 127.0.0.1), qui l'apprend. Les erreurs sont dites en clair.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};

// Fausse Dictée Locale : note les corrections reçues.
const recues = [];
let ancienne = false;
const dictee = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (ancienne || req.url !== "/v1/vocabulaire/corrections") { res.statusCode = 404; return res.end("{}"); }
    const b = JSON.parse(corps);
    recues.push(b);
    res.end(JSON.stringify({ ok: true, de: b.entendu.toLowerCase(), vers: b.voulu, active: true }));
  });
});
await new Promise((r) => dictee.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-dictee-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.DICTEE_LOCALE_URL = `http://127.0.0.1:${dictee.address().port}/v1`;

const { routeApi } = await import("../lib/routes.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); dictee.close(); fs.rmSync(dossier, { recursive: true, force: true }); });

const corriger = async (corps) => {
  const r = await fetch(`${base}/api/dictee/correction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
  return { status: r.status, corps: await r.json() };
};

test("un mot mal compris part à Dictée Locale, qui l'apprend", async () => {
  const r = await corriger({ entendu: " Rémi  Sanchez ", voulu: "Rémy Sanchez" });
  assert.equal(r.status, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps, { ok: true, de: "rémi sanchez", vers: "Rémy Sanchez" });
  assert.deepEqual(recues.at(-1), { entendu: "Rémi Sanchez", voulu: "Rémy Sanchez" });
});

test("une phrase, un champ vide ou le même mot sont refusés avant de partir", async () => {
  const avant = recues.length;
  assert.equal((await corriger({ entendu: "", voulu: "x" })).status, 400);
  assert.equal((await corriger({ entendu: "un deux trois quatre cinq", voulu: "x" })).status, 400);
  assert.equal((await corriger({ entendu: "Motion", voulu: "Motion" })).status, 400);
  assert.equal(recues.length, avant, "rien n'est parti");
});

test("une Dictée Locale trop ancienne le dit ; la capacité est annoncée", async () => {
  ancienne = true;
  const r = await corriger({ entendu: "cloud", voulu: "Claude" });
  ancienne = false;
  assert.equal(r.status, 501);
  assert.match(r.corps.message, /mets-la à jour/);
  const v = await (await fetch(`${base}/api/version`)).json();
  assert.ok(v.capacites.includes("dictee-correction-v1"));
});
