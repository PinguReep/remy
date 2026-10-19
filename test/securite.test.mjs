// Sécurité (Lot 0, J0.8b) :
//   - jeton par appareil : émis à la connexion, haché sur la tour, nommé,
//     révocable — et une fois révoqué, l'appareil est dehors même avec un cookie ;
//   - un jeton ne fabrique pas d'autres jetons ;
//   - /api/health ne dit que « ok » sans session ;
//   - X-Forwarded-For : seule la DERNIÈRE adresse, posée par le proxy local, compte.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-secu-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "VERCEL", "APP_PASSWORD_HASH", "TRUST_PROXY"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.APP_PASSWORD = "mot-de-passe-de-test";
process.env.SESSION_SECRET = "secret-de-test";

const { routeApi } = await import("../lib/routes.js");
const { getIP } = await import("../lib/http.js");
const { db, fermer } = await import("../lib/db.js");

const srv = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) (res.statusCode = 404), res.end("{}");
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;

test.after(() => {
  srv.close();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const appel = async (methode, chemin, { corps, jeton, cookie, entetes = {} } = {}) => {
  const r = await fetch(base + chemin, {
    method: methode,
    headers: {
      ...(corps ? { "Content-Type": "application/json" } : {}),
      ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...entetes,
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { status: r.status, corps: await r.json().catch(() => null), cookie: r.headers.get("set-cookie")?.split(";")[0] };
};

test("connexion de l'iPhone : un jeton à lui, dont la tour ne garde que l'empreinte", async () => {
  const r = await appel("POST", "/api/login", { corps: { password: "mot-de-passe-de-test", appareil: "iPhone de Sam" } });
  assert.equal(r.status, 200);
  assert.match(r.corps.jeton, /^rmy_[A-Za-z0-9_-]{43}$/);
  assert.equal(r.corps.appareil.nom, "iPhone de Sam");
  assert.ok(r.cookie, "le cookie reste posé (compatibilité)");
  const lignes = db().prepare("SELECT * FROM appareils").all();
  assert.equal(lignes.length, 1);
  assert.ok(!JSON.stringify(lignes).includes(r.corps.jeton), "le jeton lui-même n'est jamais gardé");
  // Le jeton suffit, sans cookie.
  assert.equal((await appel("GET", "/api/conversations", { jeton: r.corps.jeton })).status, 200);
  // Le site, sans « appareil », n'a pas de jeton.
  const site = await appel("POST", "/api/login", { corps: { password: "mot-de-passe-de-test" } });
  assert.equal(site.corps.jeton, undefined);
});

test("déconnecter un appareil : dehors, même avec son cookie ; la liste le dit", async () => {
  const r = await appel("POST", "/api/login", { corps: { password: "mot-de-passe-de-test", appareil: "Vieil iPhone" } });
  const { jeton } = r.corps;
  const liste = await appel("GET", "/api/appareils", { jeton });
  const moi = liste.corps.appareils.find((a) => a.actuel);
  assert.equal(moi.nom, "Vieil iPhone");
  assert.equal((await appel("DELETE", `/api/appareils/${moi.id}`, { cookie: r.cookie })).status, 200);
  const apres = await appel("GET", "/api/conversations", { jeton, cookie: r.cookie });
  assert.equal(apres.status, 401);
  assert.match(apres.corps.message, /déconnecté/);
  assert.equal((await appel("DELETE", `/api/appareils/${moi.id}`, { cookie: r.cookie })).status, 404);
  // Un jeton inventé ou mal formé : refusé aussi.
  assert.equal((await appel("GET", "/api/conversations", { jeton: "rmy_" + "a".repeat(43) })).status, 401);
  const autre = await appel("GET", "/api/conversations", { jeton: "n'importe quoi" });
  assert.equal(autre.status, 401);
  assert.doesNotMatch(autre.corps.message || "", /appareil/, "un Bearer qui n'est pas un jeton d'appareil n'est pas « un appareil déconnecté »");
});

test("l'app déjà connectée (cookie) obtient son jeton sans mot de passe ; un jeton n'en fabrique pas d'autre", async () => {
  const site = await appel("POST", "/api/login", { corps: { password: "mot-de-passe-de-test" } });
  const r = await appel("POST", "/api/appareils", { cookie: site.cookie, corps: { nom: "iPhone (migration)" } });
  assert.equal(r.status, 200);
  assert.match(r.corps.jeton, /^rmy_/);
  const encore = await appel("POST", "/api/appareils", { jeton: r.corps.jeton, corps: { nom: "clone" } });
  assert.equal(encore.status, 403);
  assert.equal((await appel("POST", "/api/appareils", { corps: { nom: "inconnu" } })).status, 401);
});

test("se déconnecter depuis l'iPhone rend son jeton", async () => {
  const { corps } = await appel("POST", "/api/login", { corps: { password: "mot-de-passe-de-test", appareil: "Prêté" } });
  assert.equal((await appel("POST", "/api/logout", { jeton: corps.jeton })).status, 200);
  assert.equal((await appel("GET", "/api/conversations", { jeton: corps.jeton })).status, 401);
});

test("/api/health : « ok » et rien d'autre sans session ; le détail avec", async () => {
  // Via le proxy (Tailscale Serve) sans session : rien à apprendre.
  const nu = await appel("GET", "/api/health", { entetes: { "X-Forwarded-For": "100.64.0.9", Host: "tour.ts.net" } });
  assert.deepEqual(nu.corps, { ok: true });
  const { cookie } = await appel("POST", "/api/login", { corps: { password: "mot-de-passe-de-test" } });
  const detail = await appel("GET", "/api/health", { cookie, entetes: { "X-Forwarded-For": "100.64.0.9" } });
  assert.ok(detail.corps.stockage, "le détail, avec session");
  assert.ok(detail.corps.proxy);
  // Sur la tour elle-même (localhost, sans proxy) : le détail, pour le dépannage.
  const local = await appel("GET", "/api/health", { entetes: { Host: "localhost:3010" } });
  assert.ok(local.corps.stockage);
});

test("X-Forwarded-For : la dernière adresse (posée par le proxy local), jamais la première", () => {
  const req = (xff, adr = "127.0.0.1") => ({ headers: { "x-forwarded-for": xff }, socket: { remoteAddress: adr } });
  // Sans TRUST_PROXY : l'adresse de la connexion, l'en-tête est ignoré.
  assert.equal(getIP(req("6.6.6.6, 100.64.0.9")), "127.0.0.1");
  process.env.TRUST_PROXY = "1";
  try {
    // Un client qui forge « 6.6.6.6 » : Tailscale ajoute sa vraie adresse à la fin.
    assert.equal(getIP(req("6.6.6.6, 100.64.0.9")), "100.64.0.9");
    assert.equal(getIP(req("100.64.0.9")), "100.64.0.9");
    // Une connexion qui ne vient pas de la tour : l'en-tête ne vaut rien.
    assert.equal(getIP(req("100.64.0.9", "100.64.0.50")), "100.64.0.50");
  } finally {
    delete process.env.TRUST_PROXY;
  }
});

test("un corps énorme envoyé à /api/login ne fait pas tomber le serveur", async () => {
  const net = await import("node:net");
  // 20 Mo annoncés et envoyés sans Content-Length (en morceaux) : refusés, serveur debout.
  const s = net.connect(srv.address().port, "127.0.0.1");
  await new Promise((ok) => s.once("connect", ok));
  s.write("POST /api/login HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n");
  const morceau = Buffer.alloc(1024 * 1024, 0x61);
  for (let i = 0; i < 20 && !s.destroyed; i++) {
    s.write(`${morceau.length.toString(16)}\r\n`);
    s.write(morceau);
    s.write("\r\n");
  }
  s.end("0\r\n\r\n");
  await new Promise((r) => setTimeout(r, 300));
  s.destroy();
  const r = await fetch(`${base}/api/health`);
  assert.equal(r.status, 200, "le serveur répond encore");
  // Annoncé trop gros : refusé tout de suite.
  const gros = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "50000000" }, body: "{}" }).catch((e) => e);
  assert.ok(gros instanceof Error || gros.status >= 400);
});

test("un jeton d'appareil ne crée pas d'accès qui survivrait à sa révocation, et n'exporte rien", async () => {
  const { corps } = await appel("POST", "/api/login", { corps: { password: "mot-de-passe-de-test", appareil: "iPhone volé" } });
  for (const [m, chemin] of [["POST", "/api/capture/jeton"], ["DELETE", "/api/capture/jeton"], ["GET", "/api/export"], ["POST", "/api/google/auth"], ["POST", "/api/google/deconnexion"]]) {
    const r = await appel(m, chemin, { jeton: corps.jeton });
    assert.equal(r.status, 403, `${m} ${chemin}`);
    assert.match(r.corps.message, /Depuis le site seulement/);
  }
  // Le site (cookie), lui, peut.
  const { cookie } = await appel("POST", "/api/login", { corps: { password: "mot-de-passe-de-test" } });
  assert.equal((await appel("GET", "/api/export", { cookie })).status, 200);
});

test("sans mot de passe configuré : ouvert seulement depuis la tour elle-même, jamais via le tailnet", async () => {
  const mdp = process.env.APP_PASSWORD;
  delete process.env.APP_PASSWORD;
  try {
    const viaServe = await appel("GET", "/api/conversations", { entetes: { "X-Forwarded-For": "100.64.0.9" } });
    assert.equal(viaServe.status, 401);
    assert.equal((await appel("GET", "/api/health", { entetes: { "X-Forwarded-For": "100.64.0.9" } })).corps.stockage, undefined);
    assert.equal((await appel("GET", "/api/conversations", { entetes: { Host: "localhost:3010" } })).status, 200);
  } finally {
    process.env.APP_PASSWORD = mdp;
  }
});

test("/api/version sans session : ni version exacte ni commit", async () => {
  const nu = await appel("GET", "/api/version", { entetes: { "X-Forwarded-For": "100.64.0.9" } });
  assert.deepEqual(Object.keys(nu.corps).sort(), ["api", "appMin"]);
  const { cookie } = await appel("POST", "/api/login", { corps: { password: "mot-de-passe-de-test" } });
  const plein = await appel("GET", "/api/version", { cookie });
  assert.ok(plein.corps.serveur && plein.corps.capacites);
});

test("base indisponible : 503 (l'iPhone garde son jeton), pas « appareil déconnecté »", async () => {
  const { corps } = await appel("POST", "/api/login", { corps: { password: "mot-de-passe-de-test", appareil: "iPhone" } });
  const d = db();
  d.exec("ALTER TABLE appareils RENAME TO appareils_cache");
  try {
    const r = await appel("GET", "/api/conversations", { jeton: corps.jeton });
    assert.equal(r.status, 503);
    assert.match(r.corps.message, /reste connecté/);
  } finally {
    d.exec("ALTER TABLE appareils_cache RENAME TO appareils");
  }
  assert.equal((await appel("GET", "/api/conversations", { jeton: corps.jeton })).status, 200);
});

// En dernier : ce test verrouille l'adresse de test pendant 15 minutes.
test("anti-force brute : 30 essais envoyés en même temps, 5 vérifiés au plus", async () => {
  const essais = await Promise.all(
    Array.from({ length: 30 }, (_, i) => appel("POST", "/api/login", { corps: { password: i === 29 ? "mot-de-passe-de-test" : `faux-${i}` } })),
  );
  const parStatut = essais.reduce((o, r) => ((o[r.status] = (o[r.status] || 0) + 1), o), {});
  assert.ok((parStatut[401] || 0) + (parStatut[200] || 0) <= 5, JSON.stringify(parStatut));
  assert.ok(parStatut[429] >= 25, JSON.stringify(parStatut));
});
