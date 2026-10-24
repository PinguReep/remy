// Alléger le modèle local (nuit du 24/10) : un faux modèle qui COMPTE ses
// appels, par sorte (routeur, réponse, mémoire, titre), et le temps qu'ils
// coûtent. La même journée type passe deux fois : avant (REMY_ALLEGEMENT=off,
// routeur et mémoire à chaque message) et après. Les délais du faux modèle
// reprennent les ordres de grandeur mesurés sur les Sparks, divisés par 100 :
// routeur ~0,3 s, réponse ~3 s, mémoire ~30 s, titre ~1 s.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const DELAIS = { routeur: 3, reponse: 30, memoire: 300, titre: 10, autre: 10 };
let appels = [];
let enCours = 0;
const sorte = (sys) =>
  /^Tu es le routeur/.test(sys) ? "routeur" : /module mémoire/.test(sys) ? "memoire" : /titre d'une conversation/.test(sys) ? "titre" : "autre";
const glm = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", async () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "glm" }] }));
    }
    const corps = JSON.parse(b || "{}");
    const quoi = corps.stream ? "reponse" : sorte(String(corps.messages?.[0]?.content || ""));
    appels.push(quoi);
    enCours++;
    await new Promise((r) => setTimeout(r, DELAIS[quoi]));
    enCours--;
    if (!corps.stream) {
      const texte = quoi === "routeur" ? "reflexe" : quoi === "titre" ? "Courses" : "NO_UPDATE";
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: texte }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "C'est noté." }, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-allegement-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_SECOURS_CLOUD", "ANTHROPIC_API_KEY", "REMY_CONSEIL_CLOUD", "REMY_ALLEGEMENT"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_BROWSE = "off";

const { routeApi } = await import("../lib/routes.js");
const { palierSansRouteur, palierDeterministe, apprendSurSam, indiceWeb } = await import("../lib/allegement.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); glm.close(); fs.rmSync(dossier, { recursive: true, force: true }); });

const post = (chemin, corps) => fetch(base + chemin, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
const calme = async () => {
  // Les tâches de fond (mémoire) tournent après « done » : on attend le silence.
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 20));
    if (enCours === 0) {
      await new Promise((r) => setTimeout(r, 60));
      if (enCours === 0) return;
    }
  }
};

// Une journée type (fictive) : des captures courtes, une question, une confidence.
// Sept messages : deux passages et le test suivant tiennent dans la limite de
// 15 messages par minute de la tour.
const JOURNEE = [
  "acheter des ampoules",
  "Faut que je pense à préparer la réunion de jeudi",
  "Organise ma journée",
  "Rappelle-moi d'appeler Léa demain",
  "J'aime pas les réunions avant 10 h, garde-le en tête",
  "Ajoute du lait",
  "Je me sens crevé ce soir",
];

async function journee() {
  appels = [];
  const debut = Date.now();
  let attenteDone = 0;
  const c = await (await post("/api/conversations", {})).json();
  for (const texte of JOURNEE) {
    const t0 = Date.now();
    const brut = await (await post(`/api/conversations/${c.id}/messages`, { text: texte })).text();
    assert.match(brut, /event: done/, texte);
    attenteDone += Date.now() - t0;
    await calme();
  }
  const compte = (q) => appels.filter((a) => a === q).length;
  return {
    appels: appels.length,
    parMessage: Math.round((appels.length / JOURNEE.length) * 10) / 10,
    routeur: compte("routeur"),
    memoire: compte("memoire"),
    titre: compte("titre"),
    reponse: compte("reponse"),
    msModele: appels.reduce((s, a) => s + DELAIS[a], 0),
    msAttenteSam: attenteDone,
    msTotal: Date.now() - debut,
  };
}

test("avant/après : moins d'appels au modèle local, même réponse", async () => {
  process.env.REMY_ALLEGEMENT = "off";
  const avant = await journee();
  delete process.env.REMY_ALLEGEMENT;
  const apres = await journee();
  if (process.env.REMY_MESURE) process.stderr.write(`\nMESURE avant ${JSON.stringify(avant)}\nMESURE après ${JSON.stringify(apres)}\n`);
  assert.equal(avant.reponse, JOURNEE.length);
  assert.equal(apres.reponse, JOURNEE.length, "chaque message a toujours sa réponse");
  assert.equal(avant.routeur, JOURNEE.length, "avant : un routeur par message");
  assert.equal(apres.routeur, 0, "après : aucun message de la journée ne ressemble au web");
  assert.equal(avant.memoire, JOURNEE.length, "avant : mémoire réécrite à chaque message");
  assert.equal(apres.memoire, 2, "après : seulement « J'aime pas… » et « Je me sens crevé »");
  assert.ok(apres.appels < avant.appels / 2, `${apres.appels} appels contre ${avant.appels}`);
  assert.ok(apres.msModele < avant.msModele / 2);
});

test("un message qui ressemble au web appelle encore le routeur (la recherche reste proposée)", async () => {
  appels = [];
  const c = await (await post("/api/conversations", {})).json();
  await (await post(`/api/conversations/${c.id}/messages`, { text: "Quel temps fera-t-il demain ?" })).text();
  await calme();
  assert.ok(appels.includes("routeur"));
});

test("palier sans routeur : cerveau unique, web, conseil confié à Claude", () => {
  assert.equal(palierDeterministe("acheter des ampoules"), "reflexe");
  assert.equal(palierDeterministe("Organise ma semaine"), "raisonnement");
  assert.equal(palierDeterministe("Je devrais démissionner ?"), "conseil");
  assert.equal(palierDeterministe("J'hésite entre deux offres"), "conseil");
  assert.equal(palierDeterministe("je devrais acheter du pain"), "reflexe", "une envie n'est pas une décision");
  assert.equal(palierDeterministe("ok", { complexe: true }), "raisonnement");
  assert.equal(palierDeterministe("x".repeat(200)), "raisonnement");
  // Web autorisé : un message qui y ressemble passe par le routeur.
  assert.equal(palierSansRouteur("Les horaires de la piscine ?", { rechercheWeb: true }), null);
  assert.equal(palierSansRouteur("acheter des ampoules", { rechercheWeb: true }), "reflexe");
  // Web coupé ou conversation privée : cerveau unique, « web » sans appel (Rémy dit qu'il ne cherche pas).
  assert.equal(palierSansRouteur("La météo de demain ?", { rechercheWeb: false }), "web");
  assert.equal(palierSansRouteur("La météo de demain ?", { rechercheWeb: true, prive: true }), "web");
  // Conseil confié à Claude : jamais décidé par une expression régulière.
  assert.equal(palierSansRouteur("acheter des ampoules", { rechercheWeb: true, conseilCloud: true }), null);
  assert.equal(palierSansRouteur("acheter des ampoules", { rechercheWeb: true, prive: true, conseilCloud: true }), "reflexe");
  process.env.REMY_ALLEGEMENT = "off";
  try {
    assert.equal(palierSansRouteur("acheter des ampoules"), null, "désactivé : toujours le routeur");
    assert.equal(apprendSurSam("ok"), true, "désactivé : toujours la mémoire");
  } finally {
    delete process.env.REMY_ALLEGEMENT;
  }
});

test("apprend-on quelque chose sur Sam ? (test déterministe, sans IA)", () => {
  for (const t of ["acheter des ampoules", "ok merci", "Organise ma journée", "Ajoute du lait", "Rappelle-moi d'appeler Léa demain", "", "Qu'est-ce qui est en retard ?"]) {
    assert.equal(apprendSurSam(t), false, t);
  }
  for (const t of ["Retiens que je fais du sport le mardi", "Je déteste les appels avant 9 h", "D'habitude je me lève à 6 h 30", "Mon fils a judo le mercredi", "Je me sens épuisé", "Mon objectif cette année : courir un semi", "x".repeat(450)]) {
    assert.equal(apprendSurSam(t), true, t);
  }
  assert.equal(indiceWeb("Le programme du cinéma ce soir ?"), true);
  assert.equal(indiceWeb("Prépare la réunion de jeudi"), false);
  assert.equal(indiceWeb("Qu'est-ce qui est en retard ?"), false, "la suggestion de l'app ne cherche rien");
  assert.equal(indiceWeb("Qui est le maire de Lyon ?"), true);
  assert.equal(apprendSurSam("Ma sœur arrive samedi"), true, "« œ » lu comme « oe »");
});
