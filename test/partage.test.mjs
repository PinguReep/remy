// La feuille de partage de l'iPhone (24/10) : un texte, un lien ou une image
// venus de n'importe quelle app. Une image est rangée dans le coffre ; seul le
// texte que l'iPhone y a lu part au modèle, LOCAL seulement.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};
console.error = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-partage-"));
const vault = path.join(dossier, "coffre");
fs.mkdirSync(vault);
for (const v of ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "ANTHROPIC_API_KEY", "REMY_GLM_URL"]) delete process.env[v];
process.env.REMY_VAULT = vault;
process.env.REMY_DATA_DIR = path.join(dossier, "donnees");

const { routeApi } = await import("../lib/routes.js");
const { lireImage, texteImage, nettoyerCapture, SOURCES, promptCapture } = await import("../lib/capture.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); fs.rmSync(dossier, { recursive: true, force: true }); });

// Un vrai JPEG minuscule (1×1) et un PNG (1×1).
const JPEG = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const envoyer = async (corps, chemin = "/api/capture/image") => {
  const r = await fetch(`${base}${chemin}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
  return { status: r.status, corps: await r.json().catch(() => null) };
};

test("« partage » est une source connue, annoncée au modèle", () => {
  assert.ok(SOURCES.includes("partage"));
  const { capture } = nettoyerCapture("Lien partagé : https://exemple.org/bougies — la boutique de bougies de Léa", { source: "partage" });
  assert.equal(capture.source, "partage");
  assert.match(promptCapture("", capture), /partage de Sam depuis son iPhone/);
});

test("l'image : JPEG et PNG reconnus à leurs octets, le reste refusé avec sa raison", () => {
  assert.equal(lireImage(JPEG).ext, "jpg");
  assert.equal(lireImage(`data:image/png;base64,${PNG}`).ext, "png");
  assert.equal(lireImage("R0lGODlhAQABAAAAACw=").statut, 415, "un GIF n'est pas pris");
  assert.equal(lireImage("").statut, 400);
  assert.equal(lireImage("pas du base64 !").statut, 400);
  assert.equal(lireImage("A".repeat(4_100_000)).statut, 413, "trop lourde, refusée avant décodage");
});

test("le texte d'une image : le mot de Sam puis ce que l'iPhone a lu ; vide sans rien", () => {
  assert.equal(texteImage({}), "");
  assert.equal(texteImage({ texte: "   ", mot: " " }), "");
  const t = texteImage({ texte: "Facture n° 42\r\nTotal : 18 €", mot: "à payer avant vendredi", titre: "Capture d'écran" });
  assert.match(t, /« Capture d'écran »/);
  assert.match(t, /Ce que Sam en dit : à payer avant vendredi/);
  assert.match(t, /Texte lu sur l'image[^\n]*:\nFacture n° 42\nTotal : 18 €/);
  assert.ok(texteImage({ texte: "x".repeat(20_000) }).length < 9_000, "le texte lu est borné");
});

test("une photo sans texte est rangée dans le coffre, sans appel au modèle", async () => {
  const r = await envoyer({ image: JPEG, titre: "Photo" });
  assert.equal(r.status, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.ok, true);
  assert.equal(r.corps.memoire, false);
  assert.match(r.corps.message, /rangée dans ton coffre/);
  assert.match(r.corps.image, /^Captures\/Images\/\d{4}-\d{2}-\d{2} \d{6} [0-9a-f]{6}\.jpg$/);
  const octets = fs.readFileSync(path.join(vault, ...r.corps.image.split("/")));
  assert.deepEqual([...octets.subarray(0, 3)], [0xff, 0xd8, 0xff], "l'image est écrite telle quelle");
  // La note de capture du coffre affiche l'image.
  const notes = fs.readdirSync(path.join(vault, "Captures")).filter((f) => f.endsWith(".md"));
  const note = notes.map((f) => fs.readFileSync(path.join(vault, "Captures", f), "utf8")).find((n) => n.includes(r.corps.image));
  assert.ok(note, "une note de capture renvoie à l'image");
  assert.match(note, /source: "partage"/);
});

test("une capture d'écran avec du texte : gardée même sans modèle local, jamais envoyée au cloud", async () => {
  const r = await envoyer({ image: PNG, texte: "Rendez-vous chez Hugo jeudi à 18 h, atelier de la boutique de bougies", mot: "à ne pas oublier" });
  assert.equal(r.status, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.memoire, false);
  assert.match(r.corps.message, /modèle local ne répond pas/);
  assert.match(r.corps.image, /\.png$/);
  const captures = await (await fetch(`${base}/api/capture`)).json();
  assert.equal(captures[0].source, "partage");
  assert.match(captures[0].apercu, /Ce que Sam en dit : à ne pas oublier/);
});

test("deux images du même jour gardent chacune leur note", async () => {
  const a = await envoyer({ image: JPEG });
  const b = await envoyer({ image: JPEG });
  assert.notEqual(a.corps.image, b.corps.image);
  for (const r of [a, b]) {
    const nom = path.posix.basename(r.corps.image).replace(/\.jpg$/, ".md");
    assert.match(fs.readFileSync(path.join(vault, "Captures", nom), "utf8"), new RegExp(r.corps.image.replace(/[.]/g, "\\.")));
  }
});

test("une image refusée le dit en clair (format, poids, rien reçu)", async () => {
  const gif = await envoyer({ image: "R0lGODlhAQABAAAAACw=" });
  assert.equal(gif.status, 415);
  assert.match(gif.corps.message, /JPEG ou PNG/);
  const vide = await envoyer({ texte: "rien d'autre" });
  assert.equal(vide.status, 400);
  assert.match(vide.corps.message, /Aucune image/);
  const lourde = await envoyer({ image: "A".repeat(4_300_000) });
  assert.equal(lourde.status, 413);
  assert.match(lourde.corps.message, /3 Mo/);
});

test("la capacité est annoncée", async () => {
  const v = await (await fetch(`${base}/api/version`)).json();
  assert.ok(v.capacites.includes("partage-v1"));
});
