// Conversation privée depuis l'iPhone (27/10) : le contrat que l'app lit et
// écrit sur la tour, sans route nouvelle.
//   - POST /api/conversations { prive: true } : née privée ;
//   - PATCH { prive: true } : rendue privée, sans retour (PATCH { prive: false } refusé) ;
//   - la liste et la conversation disent `prive` ;
//   - /api/reglages : l'interrupteur « Recherche dans les conversations
//     privées » (coupé par défaut), son verrou, la salle blanche, et le
//     circuit « compactage » que la jauge lit ;
//   - /api/version : les capacités qui montrent l'interrupteur et la jauge.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-prive-iphone-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH",
  "VERCEL", "REMY_MODEL", "REMY_CERVEAU", "REMY_RECHERCHE_PRIVEE", "REMY_SALLE_BLANCHE", "REMY_RECHERCHE", "REMY_WEB_SEARCH"]) {
  delete process.env[v];
}
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = "http://127.0.0.1:9/v1"; // cerveau local (jamais appelé ici)

const { routeApi } = await import("../lib/routes.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;

const { fermer } = await import("../lib/db.js");
test.after(() => {
  remy.close();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const json = (methode, chemin, corps) =>
  fetch(base + chemin, { method: methode, headers: { "Content-Type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps) });

test("« Nouvelle conversation privée » : née privée, la liste et la conversation le disent", async () => {
  const r = await json("POST", "/api/conversations", { prive: true });
  assert.equal(r.status, 201);
  const c = await r.json();
  assert.equal(c.prive, true);
  const liste = await (await json("GET", "/api/conversations")).json();
  assert.equal(liste.find((x) => x.id === c.id).prive, true);
  assert.equal((await (await json("GET", `/api/conversations/${c.id}`)).json()).prive, true);
  // Une ordinaire ne l'est pas.
  const o = await (await json("POST", "/api/conversations", {})).json();
  assert.equal(o.prive, undefined);
  assert.equal((await (await json("GET", "/api/conversations")).json()).find((x) => x.id === o.id).prive, false);
});

test("« Rendre privée » : PATCH { prive: true }, puis sans retour", async () => {
  const c = await (await json("POST", "/api/conversations", {})).json();
  const r = await json("PATCH", `/api/conversations/${c.id}`, { prive: true });
  assert.equal(r.status, 200);
  const vue = await r.json();
  assert.equal(vue.prive, true);
  assert.equal(vue.title, "Nouvelle conversation", "le titre ne bouge pas");
  assert.equal((await (await json("GET", "/api/conversations")).json()).find((x) => x.id === c.id).prive, true);
  // Sans retour : la tour refuse de la rendre publique, et le dit.
  const refus = await json("PATCH", `/api/conversations/${c.id}`, { prive: false });
  assert.equal(refus.status, 400);
  assert.match((await refus.json()).error, /privée le reste/);
  assert.equal((await (await json("GET", `/api/conversations/${c.id}`)).json()).prive, true);
  // Redemandé (deux taps, deux appareils) : rien ne casse.
  assert.equal((await json("PATCH", `/api/conversations/${c.id}`, { prive: true })).status, 200);
  // Une valeur qui n'est pas un booléen ne rend rien privé.
  const autre = await (await json("POST", "/api/conversations", {})).json();
  assert.equal((await json("PATCH", `/api/conversations/${autre.id}`, { prive: "oui" })).status, 400);
  assert.equal((await (await json("GET", `/api/conversations/${autre.id}`)).json()).prive, undefined);
});

test("Réglages : l'interrupteur coupé par défaut, son verrou, la salle blanche et le circuit du compactage", async () => {
  const r = await (await json("GET", "/api/reglages")).json();
  assert.equal(r.recherchePrivee, false);
  assert.equal(r.recherchePriveeReglage, false);
  assert.equal(r.recherchePriveeVerrouillee, false);
  assert.equal(r.salleBlanche, true);
  assert.equal(typeof r.secoursCloud, "boolean", "l'app le décode toujours");
  assert.equal(r.circuits.compactage.actif, true, "la jauge dit le résumé automatique allumé");

  const allume = await (await json("PUT", "/api/reglages", { recherchePrivee: true })).json();
  assert.equal(allume.recherchePriveeReglage, true);
  try {
    process.env.REMY_RECHERCHE_PRIVEE = "off";
    const verrou = await (await json("GET", "/api/reglages")).json();
    assert.equal(verrou.recherchePriveeVerrouillee, true, "grisé dans l'app");
    assert.equal(verrou.recherchePrivee, false, "verrouillée : rien ne sort");
    assert.equal(verrou.salleBlanche, true, "le verrou vient de REMY_RECHERCHE_PRIVEE, pas de la salle blanche");
    delete process.env.REMY_RECHERCHE_PRIVEE;
    process.env.REMY_SALLE_BLANCHE = "off";
    const sansSalle = await (await json("GET", "/api/reglages")).json();
    assert.equal(sansSalle.recherchePriveeVerrouillee, true);
    assert.equal(sansSalle.salleBlanche, false, "l'app dit pourquoi");
  } finally {
    delete process.env.REMY_RECHERCHE_PRIVEE;
    delete process.env.REMY_SALLE_BLANCHE;
    await json("PUT", "/api/reglages", { recherchePrivee: false });
  }
});

test("Version : les capacités que l'app attend pour l'interrupteur et la jauge", async () => {
  const v = await (await json("GET", "/api/version")).json();
  for (const c of ["recherche-privee-v1", "jauge-v1", "compactage-v1", "reglages"]) assert.ok(v.capacites.includes(c), c);
});
