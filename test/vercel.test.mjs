// L'ancienne app Vercel (migration seulement depuis le 08/10) n'envoie plus
// rien chez Claude toute seule : plus de tâche planifiée, et la route de la
// réflexion de nuit refuse même avec le secret du cron.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("vercel.json : aucune tâche planifiée", () => {
  const conf = JSON.parse(fs.readFileSync(path.join(racine, "vercel.json"), "utf8"));
  assert.equal(conf.crons, undefined);
});

test("sur Vercel, la réflexion de nuit refuse, même appelée avec le secret du cron", async () => {
  process.env.VERCEL = "1";
  process.env.CRON_SECRET = "secret-du-cron";
  try {
    const h = await import("../lib/handlers.js");
    const res = { statusCode: 0, entetes: {}, corps: "", setHeader(k, v) { this.entetes[k] = v; }, end(c) { this.corps = c; } };
    await h.reflectionJob({ headers: { authorization: "Bearer secret-du-cron" } }, res);
    assert.equal(res.statusCode, 410);
    assert.match(JSON.parse(res.corps).error, /tourne sur la tour/);
  } finally {
    delete process.env.VERCEL;
    delete process.env.CRON_SECRET;
  }
});
