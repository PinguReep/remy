// Lire ce qui est joint (12/11) : le texte d'un PDF (lib/pdf.js), et la
// compréhension d'une image par un modèle de vision LOCAL (lib/vision.js).
// Garde-fou : une image ne part JAMAIS vers un fournisseur cloud, quel que soit
// le réglage du secours — ni par la vision, ni par la conversation.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

console.log = () => {};
console.warn = () => {};
console.error = () => {};

const { lirePdf, raisonPdf } = await import("../lib/pdf.js");
const { pdfEssai, pngUni, pngMot } = await import("../lib/fichiers-essai.js");
const V = await import("../lib/vision.js");

// La couleur du premier pixel d'un PNG RVB de lib/fichiers-essai.js : le faux
// modèle « voit » vraiment l'image qu'on lui envoie.
function couleurDe(dataUrl) {
  const o = Buffer.from(String(dataUrl).split(",")[1], "base64");
  let i = 8;
  const idat = [];
  while (i < o.length) {
    const l = o.readUInt32BE(i);
    const type = o.toString("latin1", i + 4, i + 8);
    if (type === "IDAT") idat.push(o.subarray(i + 8, i + 8 + l));
    i += 12 + l;
  }
  const brut = zlib.inflateSync(Buffer.concat(idat));
  const [r, v, b] = [brut[1], brut[2], brut[3]];
  return r > v && r > b ? "rouge" : v > b ? "vert" : "bleu";
}

// Un faux serveur « chat completions » : `voit` (dit la vraie couleur), `aveugle`
// (invente), `refuse` (400 « not a multimodal model »).
function fauxModele(mode) {
  const s = { appels: [], mode };
  s.serveur = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const b = JSON.parse(body || "{}");
      s.appels.push(b);
      if (s.mode === "refuse") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "This model is not a multimodal model" } }));
      }
      const parties = b.messages?.at(-1)?.content || [];
      const question = parties.find((p) => p.type === "text")?.text || "";
      const image = parties.find((p) => p.type === "image_url")?.image_url?.url;
      let texte = "Une photo d'un chat roux sur un canapé.";
      if (s.mode === "voit") texte = /couleur/.test(question) ? couleurDe(image) : "Un ticket de caisse : trois bougies, total 42,00 €.";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ model: "vision-essai", choices: [{ message: { content: texte } }], usage: { prompt_tokens: 900, completion_tokens: 30 } }));
    });
  });
  return s;
}
const ecouter = async (s) => {
  await new Promise((r) => s.serveur.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${s.serveur.address().port}/v1`;
};

test("PDF : le texte est extrait ; protégé, abîmé, scanné ou trop long : la raison, jamais une erreur", async () => {
  const r = await lirePdf(pdfEssai(["Devis n° 2026-114", "Total TTC : 42,00 EUR"]));
  assert.deepEqual(r, { texte: "Devis n° 2026-114\nTotal TTC : 42,00 EUR", pages: 1, lues: 1, tronque: false });
  assert.equal((await lirePdf(Buffer.from("%PDF-1.4 rien du tout"))).raison, "PDF abîmé ou illisible");
  assert.match((await lirePdf(pdfEssai([""]))).raison, /PDF sans texte \(scanné \?\)/);
  const court = await lirePdf(pdfEssai(["Une ligne assez longue pour être coupée"]), { texteMax: 10 });
  assert.equal(court.texte.length, 10);
  assert.equal(court.tronque, true);
  assert.match((await lirePdf(pdfEssai(["x"]), { delaiMs: 1 })).raison, /trop longue/);
  assert.equal(raisonPdf("PasswordException", "No password given"), "PDF protégé par un mot de passe");
  assert.equal(raisonPdf("InvalidPDFException"), "PDF abîmé ou illisible");
  // Un PDF qui porte du JavaScript (OpenAction) : son texte est lu, le script jamais exécuté.
  const piege = Buffer.from(pdfEssai(["Texte visible"]).toString("latin1").replace("<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (globalThis.pirate = 1) >> >>"), "latin1");
  const lu = await lirePdf(piege);
  assert.ok(lu.texte?.includes("Texte visible") || lu.raison, JSON.stringify(lu));
  assert.equal(globalThis.pirate, undefined);
});

test("vision : un modèle local qui voit décrit l'image ; journalisé à 0 $ (kind piece-vision)", async () => {
  V._oublierVision();
  const m = fauxModele("voit");
  const url = await ecouter(m);
  const journal = [];
  try {
    const r = await V.decrireImage(pngMot("REMY 42"), "image/png", { env: { REMY_VISION_URL: url, REMY_VISION_MODELE: "vision-essai" }, journal: async (...a) => journal.push(a), libelle: "ticket.png" });
    assert.equal(r.description, "Un ticket de caisse : trois bougies, total 42,00 €.");
    assert.equal(m.appels.length, 2, "l'épreuve, puis la description");
    assert.ok(m.appels.every((b) => b.messages[0].content === V.CONSIGNE_VISION && b.stream === false));
    assert.ok(journal.every(([kind, fournisseur]) => kind === "piece-vision" && fournisseur === "local"));
    assert.equal(journal.length, 2);
    // L'épreuve n'est pas refaite à chaque image.
    await V.decrireImage(pngUni("vert"), "image/png", { env: { REMY_VISION_URL: url, REMY_VISION_MODELE: "vision-essai" } });
    assert.equal(m.appels.length, 3);
  } finally {
    m.serveur.close();
  }
});

test("vision : un modèle qui ne voit pas (invente, ou refuse l'image) est écarté et n'est plus sollicité", async () => {
  for (const mode of ["aveugle", "refuse"]) {
    V._oublierVision();
    const m = fauxModele(mode);
    const url = await ecouter(m);
    try {
      const env = { REMY_VISION_URL: url, REMY_VISION_MODELE: "texte-seul" };
      const r = await V.decrireImage(pngUni("bleu"), "image/png", { env });
      assert.match(r.raison, /ne voit pas les images/, mode);
      assert.equal(r.description, undefined, "rien d'inventé ne passe");
      const n = m.appels.length;
      const r2 = await V.decrireImage(pngUni("rouge"), "image/png", { env });
      assert.match(r2.raison, /ne voit pas les images/);
      assert.equal(m.appels.length, n, `${mode} : le refus est retenu, sans nouvel essai`);
    } finally {
      m.serveur.close();
    }
  }
});

test("vision : jamais vers une adresse hors de tes machines, et rien sans cerveau", async () => {
  V._oublierVision();
  let appels = 0;
  const espion = async () => {
    appels++;
    throw new Error("ne doit pas être appelé");
  };
  for (const url of ["https://api.anthropic.com/v1", "https://api.openai.com/v1", "https://vision.exemple.com/v1", "http://203.0.113.9:8000/v1"]) {
    const r = await V.decrireImage(pngUni(), "image/png", { env: { REMY_VISION_URL: url }, fetch: espion });
    assert.match(r.raison, /n'est pas sur tes machines/, url);
  }
  assert.equal(appels, 0, "aucune requête n'est partie");
  assert.match((await V.decrireImage(pngUni(), "image/png", { env: {}, fetch: espion })).raison, /pas de modèle de vision local/);
  assert.match((await V.decrireImage(Buffer.alloc(10), "image/heic", { env: { REMY_VISION_URL: "http://127.0.0.1:9/v1" }, fetch: espion })).raison, /format/);
  assert.match((await V.decrireImage(Buffer.alloc(V.VISION_OCTETS_MAX + 1), "image/png", { env: { REMY_VISION_URL: "http://127.0.0.1:9/v1" }, fetch: espion })).raison, /trop lourde/);
  assert.equal(appels, 0);
});

test("GARDE-FOU : secours cloud ALLUMÉ, aucun octet d'image ne part chez Claude (ni la vision, ni la conversation)", async () => {
  // Faux Anthropic : il note tout ce qu'il reçoit.
  const anthropique = [];
  const anthropic = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      anthropique.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5", content: [{ type: "text", text: "Réponse de secours." }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3 } }));
    });
  });
  await new Promise((r) => anthropic.listen(0, "127.0.0.1", r));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-vision-garde-"));
  for (const v of ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "REMY_CERVEAU"]) delete process.env[v];
  Object.assign(process.env, {
    REMY_DATA_DIR: dossier,
    REMY_CLES_DIR: path.join(dossier, "cles"),
    REMY_SECOURS_CLOUD: "on",
    ANTHROPIC_API_KEY: "cle-de-test",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${anthropic.address().port}`,
    REMY_PROVIDER: "api",
    REMY_BROWSE: "off",
    // Modèle local ET cerveau de vision éteints : c'est là que le secours servirait.
    REMY_GLM_URL: "http://127.0.0.1:9/v1",
    REMY_VISION_URL: "http://127.0.0.1:9/v1",
  });
  V._oublierVision();
  const { routeApi } = await import("../lib/routes.js");
  const remy = http.createServer(async (req, res) => {
    if (!(await routeApi(req, res))) {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise((r) => remy.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${remy.address().port}`;
  try {
    const post = (chemin, corps) => fetch(base + chemin, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    const conv = await (await post("/api/conversations", {})).json();
    const image = pngMot("REMY 42");
    const p = await (await post(`/api/conversations/${conv.id}/pieces`, { nom: "capture.png", donnees: image.toString("base64") })).json();
    assert.equal(p.lu, "non");
    assert.match(p.raison, /modèle de vision injoignable/);
    assert.equal(anthropique.length, 0, "la lecture de l'image n'a rien envoyé chez Claude");
    // La conversation part en secours (fil ordinaire, secours allumé) : du texte seulement.
    const r = await post(`/api/conversations/${conv.id}/messages`, { text: "Tu vois ma capture ?", pieces: [p.id] });
    await r.text();
    for (const corps of anthropique) {
      assert.equal(corps.includes(image.toString("base64")), false, "aucun octet de l'image");
      assert.doesNotMatch(corps, /"type":"image"|image_url|"media_type"/);
    }
    assert.ok(anthropique.length > 0, "le secours a bien servi la conversation (le chemin cloud est éprouvé)");
    assert.match(anthropique.join("\n"), /pièce jointe non lue : capture\.png/, "seule la ligne de texte est partie");
  } finally {
    remy.close();
    anthropic.close();
    for (const v of ["REMY_SECOURS_CLOUD", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "REMY_PROVIDER", "REMY_VISION_URL"]) delete process.env[v];
    try {
      (await import("../lib/db.js")).fermer();
    } catch {}
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});
