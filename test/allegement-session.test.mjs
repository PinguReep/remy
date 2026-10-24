// La mémoire n'est plus réécrite pour « acheter des ampoules » (lib/allegement.js),
// sauf dans une étape « Faire connaissance » : là, tout ce que Sam dit compte.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const appels = [];
const glm = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "glm" }] }));
    }
    const corps = JSON.parse(b || "{}");
    const sys = String(corps.messages?.[0]?.content || "");
    appels.push(corps.stream ? "reponse" : /module mémoire/.test(sys) ? "memoire" : /^Tu es le routeur/.test(sys) ? "routeur" : "autre");
    if (!corps.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: "NO_UPDATE" }, finish_reason: "stop" }], usage: {} }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Noté." }, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-allegement-session-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_SECOURS_CLOUD", "ANTHROPIC_API_KEY", "REMY_CONSEIL_CLOUD", "REMY_ALLEGEMENT"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_BROWSE = "off";

const { routeApi } = await import("../lib/routes.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); glm.close(); fs.rmSync(dossier, { recursive: true, force: true }); });
const post = (chemin, corps) => fetch(base + chemin, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
const attendre = async (pred) => { for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 20)); };

test("« acheter des ampoules » : pas de mémoire ; dans « Faire connaissance » : mémoire", async () => {
  const c = await (await post("/api/conversations", {})).json();
  await (await post(`/api/conversations/${c.id}/messages`, { text: "acheter des ampoules" })).text();
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(appels.filter((a) => a !== "autre"), ["reponse"], "ni routeur ni mémoire (le titre reste)");

  appels.length = 0;
  const s = await (await post("/api/conversations", { session: "vider-tete" })).json();
  await (await post(`/api/conversations/${s.id}/messages`, { text: "acheter des ampoules" })).text();
  await attendre(() => appels.includes("memoire"));
  assert.ok(appels.includes("memoire"), JSON.stringify(appels));
});
