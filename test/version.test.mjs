// Versions app ↔ serveur (Lot 0, J0.4) :
//   - /api/version dit la version du serveur, le commit installé, la version
//     d'API et les capacités — sans session (une app trop ancienne doit pouvoir
//     le lire pour dire « mets-moi à jour ») ;
//   - une app plus ancienne que REMY_APP_MIN reçoit un 426 clair, partout ;
//   - le site (sans X-Remy-App) n'est jamais concerné ;
//   - le commit est lu dans .git, y compris pour un clone détaché (la tour).

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-version-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_APP_MIN"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;

const { routeApi } = await import("../lib/routes.js");
const { commitInstalle, CAPACITES } = await import("../lib/version.js");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

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

test("/api/version : version, API, capacités", async () => {
  const v = await (await fetch(`${base}/api/version`)).json();
  assert.equal(v.serveur, pkg.version);
  assert.equal(v.api, 1);
  assert.deepEqual(v.capacites, CAPACITES);
  assert.ok(v.capacites.includes("reglages"));
  assert.equal(v.appMin, null);
});

test("app plus ancienne que REMY_APP_MIN : 426 clair ; à jour, ou le site : servis", async () => {
  process.env.REMY_APP_MIN = "12";
  try {
    const vieille = await fetch(`${base}/api/conversations`, { headers: { "X-Remy-App": "9" } });
    assert.equal(vieille.status, 426);
    assert.match((await vieille.json()).message, /build 9.*trop ancienne.*TestFlight/);
    // La version reste lisible, même pour elle.
    assert.equal((await fetch(`${base}/api/version`, { headers: { "X-Remy-App": "9" } })).status, 200);
    assert.equal((await fetch(`${base}/api/conversations`, { headers: { "X-Remy-App": "12" } })).status, 200);
    assert.equal((await fetch(`${base}/api/conversations`)).status, 200); // le site
    // Un build d'avant le Lot 0 n'envoie pas X-Remy-App : reconnu à son User-Agent iOS.
    const ancienne = await fetch(`${base}/api/conversations`, { headers: { "User-Agent": "Remy/9 CFNetwork/1568.100.1 Darwin/25.0.0" } });
    assert.equal(ancienne.status, 426);
    assert.equal((await fetch(`${base}/api/conversations`, { headers: { "User-Agent": "Mozilla/5.0 (iPhone)" } })).status, 200);
  } finally {
    delete process.env.REMY_APP_MIN;
  }
});

test("commit installé : branche, clone détaché, refs compactées", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "remy-git-"));
  try {
    fs.mkdirSync(path.join(d, ".git", "refs", "heads"), { recursive: true });
    const sha = "0123456789abcdef0123456789abcdef01234567";
    fs.writeFileSync(path.join(d, ".git", "HEAD"), `${sha}\n`); // détaché (la tour)
    assert.equal(commitInstalle(d), "0123456");
    fs.writeFileSync(path.join(d, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(path.join(d, ".git", "refs", "heads", "main"), "abcdef0123456789abcdef0123456789abcdef01\n");
    assert.equal(commitInstalle(d), "abcdef0");
    fs.rmSync(path.join(d, ".git", "refs", "heads", "main"));
    fs.writeFileSync(path.join(d, ".git", "packed-refs"), "# pack-refs\nfedcba9876543210fedcba9876543210fedcba98 refs/heads/main\n");
    assert.equal(commitInstalle(d), "fedcba9");
    assert.equal(commitInstalle(path.join(d, "absent")), null);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
