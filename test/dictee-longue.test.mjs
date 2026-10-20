// Les vocaux longs (19/10) : un vocal de plusieurs minutes ne doit plus être
// refusé pour sa taille ni abandonné après 90 s pendant que la tour le transcrit.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};

// Fausse Dictée Locale : note la taille de l'audio reçu, rend un texte.
const recus = [];
const dictee = http.createServer((req, res) => {
  let taille = 0;
  req.on("data", (c) => (taille += c.length));
  req.on("end", () => {
    recus.push({ url: req.url, taille });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ text: "un long vocal" }));
  });
});
await new Promise((r) => dictee.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-vocal-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.DICTEE_LOCALE_URL = `http://127.0.0.1:${dictee.address().port}/v1`;

const { routeApi } = await import("../lib/routes.js");
const { delaiTranscription } = await import("../lib/transcribe.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); dictee.close(); fs.rmSync(dossier, { recursive: true, force: true }); });

test("un vocal de plus de 4,5 Mo passe sur la tour", async () => {
  const audio = Buffer.alloc(6_000_000, 7);
  const r = await fetch(`${base}/api/transcribe?type=audio/mp4&dur=480.0`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: audio,
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { text: "un long vocal" });
  assert.equal(recus.at(-1).url, "/v1/audio/transcriptions");
  assert.ok(recus.at(-1).taille > 6_000_000, "tout l'audio est arrivé à Dictée Locale");
});

test("le délai laissé à la transcription grandit avec le vocal", () => {
  assert.equal(delaiTranscription(0), 90_000);
  assert.equal(delaiTranscription(180), 270_000, "3 min : 4 min 30 au lieu de 90 s");
  assert.equal(delaiTranscription(900), 990_000);
  assert.equal(delaiTranscription("n'importe quoi"), 90_000);
});
