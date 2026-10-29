// Le site servi par la tour (server.js + public/) : en-têtes de cache (HTML,
// JS, CSS revalidés à chaque chargement : une page en cache ne doit jamais se
// mélanger à un module neuf après une mise à jour), modules tous présents,
// syntaxe valide, aucun appel à un tiers, l'interface classique gardée.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(RACINE, "public");

const portLibre = () => new Promise((r) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => r(port));
  });
});

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-site-statique-"));
const port = await portLibre();
const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1", REMY_DATA_DIR: dossier, REMY_PLANIF: "off", REMY_ENV: "test" };
for (const v of ["MOTION_API_KEY", "GOOGLE_CLIENT_ID", "REMY_GLM_URL", "ANTHROPIC_API_KEY", "REMY_VAULT", "APP_PASSWORD", "APP_PASSWORD_HASH", "REMY_LOG"]) delete env[v];
const serveur = spawn(process.execPath, ["server.js"], { cwd: RACINE, env, stdio: ["ignore", "pipe", "pipe"] });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 80; i++) {
  try {
    await fetch(`${base}/api/health`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
test.after(() => {
  serveur.kill();
  fs.rmSync(dossier, { recursive: true, force: true });
});

test("la page, les modules et la feuille de style sont revalidés à chaque chargement", async () => {
  for (const [chemin, type] of [["/", "text/html"], ["/?fenetre=noter", "text/html"], ["/app/main.js", "text/javascript"], ["/app/atelier.css", "text/css"], ["/manifest.json", "application/json"], ["/sw.js", "text/javascript"], ["/classique.html", "text/html"]]) {
    const r = await fetch(base + chemin);
    assert.equal(r.status, 200, chemin);
    assert.match(r.headers.get("content-type"), new RegExp(type), chemin);
    assert.equal(r.headers.get("cache-control"), "no-cache", chemin);
  }
  const police = await fetch(`${base}/fonts/source-serif-4-latin-600.woff2`);
  assert.equal(police.status, 200);
  assert.equal(police.headers.get("content-type"), "font/woff2");
  assert.match(police.headers.get("cache-control"), /max-age=86400/);
});

test("la nouvelle page charge le module principal ; l'ancienne reste servie", async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /<script type="module" src="\/app\/main.js">/);
  assert.match(html, /\/app\/atelier\.css/);
  // Le thème est posé avant la feuille de style (pas de clignement clair → sombre).
  assert.ok(html.indexOf("remy-theme") < html.indexOf("atelier.css"));
  assert.match(html, /href="\/classique.html"/, "lien de secours sans JavaScript");
  const classique = await (await fetch(`${base}/classique.html`)).text();
  assert.match(classique, /Nouvelle interface/);
  assert.match(classique, /\/api\/conversations/, "l'interface classique est entière");
});

test("hors de public/ : refusé", async () => {
  const r = await fetch(`${base}/..%2Fserver.js`);
  assert.ok([403, 404].includes(r.status));
  assert.equal((await fetch(`${base}/app/inexistant.js`)).status, 404);
});

const fichiersApp = (d = path.join(PUBLIC, "app")) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? fichiersApp(path.join(d, e.name)) : e.name.endsWith(".js") ? [path.join(d, e.name)] : []));

test("chaque module a une syntaxe valide et ses imports existent", () => {
  const fichiers = fichiersApp();
  assert.ok(fichiers.length >= 15, "les modules du site");
  for (const f of fichiers) {
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
    assert.equal(r.status, 0, `${path.relative(RACINE, f)} : ${r.stderr}`);
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:import\s[^"']*?from\s*|import\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      assert.ok(fs.existsSync(path.resolve(path.dirname(f), m[1])), `${path.relative(RACINE, f)} importe ${m[1]}, introuvable`);
    }
  }
});

test("le service worker garde tous les modules, jamais /api", () => {
  const sw = fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
  const gardes = [...sw.matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]).filter((u) => u !== "/api/");
  for (const u of gardes) {
    if (u === "/") continue;
    assert.ok(fs.existsSync(path.join(PUBLIC, u)), `sw.js garde ${u}, absent de public/`);
  }
  for (const f of fichiersApp()) {
    const rel = "/" + path.relative(PUBLIC, f).split(path.sep).join("/");
    assert.ok(gardes.includes(rel), `${rel} manque au cache hors ligne (sw.js)`);
  }
  assert.match(sw, /startsWith\("\/api\/"\)\) return/, "les données ne sont jamais mises en cache");
  assert.match(sw, /ignoreSearch: true/, "?fenetre=noter servi hors ligne");
});

test("aucun appel à un tiers depuis le site (polices et scripts auto-hébergés)", () => {
  const fichiers = [...fichiersApp(), path.join(PUBLIC, "index.html"), path.join(PUBLIC, "app", "atelier.css")];
  for (const f of fichiers) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:src|href|url)\s*[=(]\s*["']?(https?:\/\/[^"')\s]+)/g)) {
      assert.fail(`${path.relative(RACINE, f)} charge ${m[1]}`);
    }
    assert.doesNotMatch(src, /fonts\.googleapis|cdn\.|unpkg|jsdelivr/, path.relative(RACINE, f));
  }
});

test("le site n'envoie jamais l'en-tête de version de l'app iPhone", () => {
  // X-Remy-App ferait répondre 426 à une tour plus ancienne : le site, servi par la tour, a toujours sa version.
  for (const f of fichiersApp()) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /X-Remy-App/i, f);
});
