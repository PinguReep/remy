// La mémoire près de son plafond (24/11) : elle est condensée au lieu de ne
// plus rien apprendre, et l'ancienne version est gardée dans le coffre.
// Faux modèle local, coffre jetable, données fictives (Sam et ses bougies).

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let script = []; // une réponse par appel : { texte, fin? }
let recus = [];
const modele = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "GLM-5.3-Flash-EXL3" }] }));
    const b = JSON.parse(body || "{}");
    recus.push(b);
    const tour = script.shift() || { texte: "NO_UPDATE" };
    res.end(JSON.stringify({ choices: [{ message: { content: tour.texte }, finish_reason: tour.fin || "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
  });
});
await new Promise((r) => modele.listen(0, "127.0.0.1", r));

const coffre = fs.mkdtempSync(path.join(os.tmpdir(), "remy-memoire-"));
for (const v of ["REMY_DATA_DIR", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "REMY_CERVEAU", "REMY_CIRCUIT_MEMOIRE", "ANTHROPIC_API_KEY"]) {
  delete process.env[v];
}
process.env.REMY_VAULT = coffre;
process.env.REMY_GLM_URL = `http://127.0.0.1:${modele.address().port}/v1`;

const store = await import("../lib/store.js");
const { updateMemory, condensationCredible, _oublierCondensation } = await import("../lib/chat.js");
const { routeApi } = await import("../lib/routes.js");
const { CIRCUITS } = await import("../lib/jobs.js");

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));

// La base doit être fermée avant de supprimer son dossier (Windows : EPERM sinon).
const { fermer: fermerDb } = await import("../lib/db.js");
test.after(() => {
  modele.close();
  remy.close();
  fermerDb();
  fs.rmSync(coffre, { recursive: true, force: true });
});

const SECTIONS = ["Identité & contexte", "Objectifs", "Préférences", "Personnes", "Projets en cours", "Habitudes & fonctionnement", "Hypothèses (jamais des faits)"];
/** Une mémoire fictive d'environ `taille` caractères, en sept sections. */
function memoire(taille, marque = "") {
  const parSection = Math.ceil(taille / SECTIONS.length);
  return SECTIONS.map((s, i) => {
    let t = `## ${s}\n`;
    for (let k = 0; t.length < parSection; k++) t += `- [déclaré] Sam fabrique des bougies parfumées${marque}, gamme ${i}-${k} : cire de soja, mèche en coton.\n`;
    return t;
  }).join("\n").trim();
}
const conv = { id: "c1", prive: false, messages: [] };
const dossierAnciennes = path.join(coffre, "Mémoire — anciennes versions");
const anciennes = () => (fs.existsSync(dossierAnciennes) ? fs.readdirSync(dossierAnciennes) : []);
const depart = async (texte) => {
  script = [];
  recus = [];
  _oublierCondensation();
  await store.putMemory(texte);
};

test("le plafond est relevé, et la réponse du modèle a la place de contenir toute la mémoire", async () => {
  assert.equal(store.MEMORY_MAX_CHARS, 40_000);
  assert.ok(store.MEMORY_CIBLE_CONDENSATION < store.MEMORY_SEUIL_CONDENSATION && store.MEMORY_SEUIL_CONDENSATION < store.MEMORY_MAX_CHARS * 0.97);
  await store.putMemory("y".repeat(25_001)); // refusée avant le 24/11
  await assert.rejects(store.putMemory("y".repeat(store.MEMORY_MAX_CHARS + 1)), { code: "MEMOIRE_TROP_LONGUE" });

  const avant = memoire(4000);
  await depart(avant);
  script = [{ texte: `${avant}\n- [déclaré] Sam ouvre une boutique à Lyon.` }];
  assert.equal(await updateMemory(conv, avant, "J'ouvre une boutique à Lyon", "Noté.", "r1"), true);
  assert.equal(recus.length, 1, "sous le seuil : une seule réécriture, pas de condensation");
  assert.doesNotMatch(recus[0].messages[0].content, /devenu trop long/);
  assert.match(recus[0].messages[0].content, /Maximum ~5200 mots/, "le nombre de mots suit le plafond");
  assert.ok(recus[0].max_tokens * 2.5 >= store.MEMORY_MAX_CHARS, "une mémoire au plafond tient dans la réponse");
  assert.match((await store.getMemory()).text, /boutique à Lyon/);
  assert.deepEqual(anciennes(), []);
});

test("près du plafond : condensée après l'échange, ancienne version gardée dans le coffre, coût journalisé", async () => {
  const avant = memoire(store.MEMORY_SEUIL_CONDENSATION + 500);
  const apres = `${memoire(store.MEMORY_CIBLE_CONDENSATION - 2000, " (condensé)")}\n- [déclaré] Sam ouvre une boutique à Lyon.`;
  await depart(avant);
  script = [{ texte: apres }];
  assert.equal(await updateMemory(conv, avant, "J'ouvre une boutique à Lyon", "Noté.", "r2"), true);

  assert.equal(recus.length, 1, "un seul appel : la condensation intègre aussi le dernier échange");
  assert.match(recus[0].messages[0].content, /devenu trop long/);
  assert.match(recus[0].messages[1].content, /J'ouvre une boutique à Lyon/);
  assert.equal((await store.getMemory()).text, apres.trim());
  assert.match(fs.readFileSync(path.join(coffre, "Mémoire de Rémy.md"), "utf8"), /\(condensé\)/, "la note d'Obsidian suit");

  const gardees = anciennes();
  assert.equal(gardees.length, 1);
  assert.match(gardees[0], /^\d{4}-\d{2}-\d{2} \d\dh\d\dm\d\d\.md$/);
  const gardee = fs.readFileSync(path.join(dossierAnciennes, gardees[0]), "utf8");
  assert.ok(gardee.includes(avant), "l'ancienne version est gardée entière");
  assert.match(gardee, /avant condensation/);

  const couts = await store.listCostEntries();
  assert.equal(couts[0].kind, "mémoire-condensation");
  assert.equal(couts[0].usd, 0, "modèle local : 0 $");
});

test("une condensation coupée ou vidée n'écrit rien, n'est pas retentée de sitôt, et la mise à jour ordinaire continue", async () => {
  const avant = memoire(store.MEMORY_SEUIL_CONDENSATION + 500);
  const gardeesAvant = anciennes().length;
  await depart(avant);
  // 1er appel : condensation coupée au plafond de jetons ; 2e : la mise à jour ordinaire.
  script = [{ texte: memoire(5000), fin: "length" }, { texte: `${avant}\n- [déclaré] Léa rejoint l'atelier.` }];
  assert.equal(await updateMemory(conv, avant, "Léa rejoint l'atelier", "Noté.", "r3"), true);
  assert.equal(recus.length, 2);
  assert.match(recus[0].messages[0].content, /devenu trop long/);
  assert.doesNotMatch(recus[1].messages[0].content, /devenu trop long/);
  assert.match((await store.getMemory()).text, /Léa rejoint l'atelier/);
  assert.equal(anciennes().length, gardeesAvant, "rien n'a été condensé : rien à garder");

  // L'échange suivant ne repaie pas une condensation.
  const suite = (await store.getMemory()).text;
  recus = [];
  script = [{ texte: "NO_UPDATE" }];
  assert.equal(await updateMemory(conv, suite, "ok merci", "De rien.", "r4"), false);
  assert.equal(recus.length, 1);
  assert.doesNotMatch(recus[0].messages[0].content, /devenu trop long/);
});

test("ce qui rend une condensation croyable", () => {
  const avant = memoire(store.MEMORY_SEUIL_CONDENSATION + 500);
  assert.equal(condensationCredible(avant, memoire(store.MEMORY_CIBLE_CONDENSATION), "end_turn"), true);
  assert.equal(condensationCredible(avant, memoire(store.MEMORY_CIBLE_CONDENSATION), "max_tokens"), false, "coupée");
  assert.equal(condensationCredible(avant, memoire(store.MEMORY_SEUIL_CONDENSATION + 100), "end_turn"), false, "encore au-dessus du seuil");
  assert.equal(condensationCredible(avant, memoire(8000), "end_turn"), false, "moins d'un tiers : trop a disparu");
  assert.equal(condensationCredible(avant, "## Identité & contexte\n" + "- [déclaré] Sam.\n".repeat(1200), "end_turn"), false, "sections perdues");
  assert.equal(condensationCredible(avant, "", "end_turn"), false);
});

test("Sam a corrigé sa mémoire pendant la condensation : sa version reste", async () => {
  const avant = memoire(store.MEMORY_SEUIL_CONDENSATION + 500);
  await depart(avant);
  const corrigee = `${avant}\n- [déclaré] Corrigé par Sam dans Obsidian.`;
  script = [{ texte: memoire(store.MEMORY_CIBLE_CONDENSATION - 2000, " (condensé)") }];
  const enCours = updateMemory(conv, avant, "Bonjour", "Bonjour Sam.", "r5");
  await store.putMemory(corrigee);
  assert.equal(await enCours, false);
  assert.equal((await store.getMemory()).text, corrigee);
});

test("coupée dans les Réglages : aucune condensation, et le diagnostic dit quoi faire", async () => {
  assert.ok(CIRCUITS.memoire, "le circuit existe : il se coupe d'un geste");
  const avant = memoire(store.MEMORY_SEUIL_CONDENSATION + 500);
  await depart(avant);
  const sante = async () => (await (await fetch(`http://127.0.0.1:${remy.address().port}/api/health`)).json()).memoire;
  assert.match(await sante(), /Rémy la condensera au prochain échange \(l'ancienne version sera gardée\)/);

  await store.putReglages({ circuits: { memoire: false } });
  try {
    script = [{ texte: "NO_UPDATE" }];
    assert.equal(await updateMemory(conv, avant, "ok", "ok", "r6"), false);
    assert.equal(recus.length, 1);
    assert.doesNotMatch(recus[0].messages[0].content, /devenu trop long/);
    assert.match(await sante(), /condensation est coupée dans les Réglages/);
  } finally {
    await store.putReglages({ circuits: { memoire: true } });
  }

  await depart(memoire(3000));
  assert.match(await sante(), new RegExp(`^✅ \\d+ / ${store.MEMORY_MAX_CHARS} caractères$`));
});
