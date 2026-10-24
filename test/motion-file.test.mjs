// La file du quota Motion (24/10) : la tour CALCULE quand partira la dernière
// requête en attente (fenêtre glissante de 12 requêtes par minute), et l'app
// l'affiche sur la carte au lieu d'un rond muet.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-file-motion-"));
for (const v of ["REMY_VAULT", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.MOTION_API_KEY = "cle-de-test";
process.env.MOTION_BASE_URL = "http://127.0.0.1:9/v1";

const { estimerFile, fileMotion } = await import("../lib/motion.js");
const { routeApi } = await import("../lib/routes.js");
const { CAPACITES } = await import("../lib/version.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
test.after(() => { remy.close(); fs.rmSync(dossier, { recursive: true, force: true }); });

const T = 1_000_000;

test("rien en file : aucune attente", () => {
  assert.deepEqual(estimerFile([T - 1000, T - 500], 0, 12, T), { enFile: 0, attenteMs: 0, quotaParMinute: 12 });
  assert.equal(estimerFile([T - 1000], 1, 12, T).attenteMs, 0, "une place libre : la requête part tout de suite");
});

test("fenêtre pleine : la suivante part quand la plus ancienne sort de la minute", () => {
  const partis = Array.from({ length: 12 }, (_, i) => T - 50_000 + i * 1000); // 12 requêtes en 11 s, il y a 50 s
  assert.equal(estimerFile(partis, 1, 12, T).attenteMs, 10_000);
  assert.equal(estimerFile(partis, 3, 12, T).attenteMs, 12_000, "la 3e attend la sortie de la 3e plus ancienne");
  // 13 en attente : la 13e attend une deuxième minute (sa place est celle de la 1re en file).
  assert.equal(estimerFile(partis, 13, 12, T).attenteMs, 70_000);
});

test("les requêtes sorties de la minute ne comptent plus", () => {
  const partis = [T - 120_000, T - 61_000, ...Array.from({ length: 11 }, (_, i) => T - 30_000 + i)];
  assert.equal(estimerFile(partis, 1, 12, T).attenteMs, 0);
  assert.equal(estimerFile(partis, 2, 12, T).attenteMs, 30_000);
});

test("GET /api/motion/file : l'état de la file, sans appel à Motion ; capacité annoncée", async () => {
  const r = await fetch(`http://127.0.0.1:${remy.address().port}/api/motion/file`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), fileMotion());
  assert.ok(CAPACITES.includes("motion-file-v1"));
});
