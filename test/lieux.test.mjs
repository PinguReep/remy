// La localisation (20/10) : visites et trajets envoyés par l'iPhone, lieux
// nommés ou reconnus, adresses traduites SUR LA TOUR (base d'adresses locale),
// 90 jours puis effacé, et ce que Rémy en sait ne part qu'à GLM.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

// Un faux modèle local qui garde la consigne reçue.
const consignes = [];
const delta = (d, fin = null) => ({ choices: [{ index: 0, delta: d, finish_reason: fin }] });
const glm = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "GLM-5.3" }] }));
    }
    const corps = JSON.parse(b || "{}");
    if (!corps.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: {} }));
    }
    consignes.push(corps.messages[0].content);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify(delta({ content: "D'accord." }))}\n\n`);
    res.write(`data: ${JSON.stringify(delta({}, "stop"))}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-lieux-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_SECOURS_CLOUD", "ANTHROPIC_API_KEY", "REMY_LIEUX", "REMY_LIEUX_JOURS"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_BROWSE = "off";
process.env.REMY_PRENOM = "Sam";

const geo = await import("../lib/geocodage.js");
const lieux = await import("../lib/lieux.js");
const { routeApi } = await import("../lib/routes.js");
const { fermer } = await import("../lib/db.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); glm.close(); fermer(); geo.fermerGeo(); fs.rmSync(dossier, { recursive: true, force: true }); });
const envoyer = (m, chemin, corps) => fetch(base + chemin, { method: m, headers: { "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined });

// Une ville fictive : deux rues, coordonnées inventées.
const BAN = [
  "id;id_fantoir;numero;rep;nom_voie;code_postal;code_insee;nom_commune;code_insee_ancienne_commune;nom_ancienne_commune;x;y;lon;lat",
  "a1;;12;;Rue des Lilas;99001;99001;Villefictive;;;0;0;4.80000;45.70000",
  "a2;;14;bis;Rue des Lilas;99001;99001;Villefictive;;;0;0;4.80010;45.70005",
  "a3;;3;;Avenue du Port;99001;99001;Villefictive;;;0;0;4.82000;45.71000",
];
const H = 3_600_000;
const maintenant = Date.now();

test("la base d'adresses de la tour traduit une position en adresse, sans rien envoyer", async () => {
  assert.equal(geo.adresseProche(45.7, 4.8), null, "sans base : rien d'inventé");
  geo.viderGeo();
  const n = await geo.importerBan(BAN, { departement: "99" });
  assert.equal(n, 3);
  assert.equal(geo.adresseProche(45.70001, 4.80001), "12 Rue des Lilas, 99001 Villefictive");
  assert.equal(geo.adresseProche(45.71002, 4.82001), "3 Avenue du Port, 99001 Villefictive");
  assert.equal(geo.adresseProche(45.8, 4.9), null, "à plus de 150 m : pas d'adresse");
  assert.deepEqual(geo.etatGeo().departements, ["99"]);
});

test("une visite arrive, puis repart ; le lieu est retrouvé à la visite suivante", () => {
  const r = lieux.recevoir([{ type: "visite", id: "v1", arrivee: maintenant - 5 * H, lat: 45.70001, lon: 4.80001, precision: 30 }]);
  assert.equal(r.visites, 1);
  let e = lieux.etat(maintenant);
  assert.equal(e.ou, "lieu");
  assert.equal(e.lieu.adresse, "12 Rue des Lilas, 99001 Villefictive");
  lieux.recevoir([{ type: "visite", id: "v1", arrivee: maintenant - 5 * H, depart: maintenant - 4 * H, lat: 45.70001, lon: 4.80001 }]);
  lieux.recevoir([{ type: "visite", id: "v2", arrivee: maintenant - 2 * H, lat: 45.70003, lon: 4.80004 }]);
  const tous = lieux.listerLieux();
  assert.equal(tous.length, 1, "même endroit, même lieu");
  assert.equal(tous[0].visites, 2);
  // En voiture depuis : prime sur la dernière visite.
  lieux.recevoir([{ type: "trajet", id: "t1", debut: maintenant - 10 * 60_000, mode: "voiture" }]);
  assert.equal(lieux.etat(maintenant).ou, "voiture");
  lieux.recevoir([{ type: "trajet", id: "t1", debut: maintenant - 10 * 60_000, fin: maintenant - 60_000, mode: "voiture" }]);
  // Bornes : position ou date illisibles, type inconnu.
  const mauvais = lieux.recevoir([{ type: "visite", id: "x", arrivee: "hier", lat: 200, lon: 0 }, { type: "danse", id: "y" }, { type: "visite" }]);
  assert.equal(mauvais.ecartes, 3);
});

test("un rendez-vous de l'agenda à cette adresse donne son nom au lieu", () => {
  const debut = maintenant - 30 * 60_000;
  lieux.recevoir([{ type: "visite", id: "v3", arrivee: debut + 5 * 60_000, lat: 45.71002, lon: 4.82001 }], {
    agenda: [{ summary: "Coiffeur", location: "Salon Lumière, 3 avenue du Port, Villefictive", debut, fin: debut + H }],
  });
  const e = lieux.etat(maintenant);
  assert.equal(e.lieu.nom, "Coiffeur");
  assert.equal(lieux.listerLieux().find((l) => l.nom === "Coiffeur").source, "agenda");
});

test("Rémy relit où est Sam — et les tâches liées au lieu — dans sa consigne", async () => {
  const note = lieux.noteLieux({ maintenant, taches: ["Prendre rendez-vous coiffeur", "Appeler la banque"] });
  assert.match(note, /En ce moment : Coiffeur \(depuis/);
  assert.match(note, /Aujourd'hui : 12 Rue des Lilas/);
  assert.match(note, /« Prendre rendez-vous coiffeur »/);
  assert.doesNotMatch(note, /banque/);
  // De bout en bout : la consigne envoyée au modèle local la contient.
  const c = await (await envoyer("POST", "/api/conversations", {})).json();
  await (await envoyer("POST", `/api/conversations/${c.id}/messages`, { text: "Je fais quoi après ?" })).text();
  assert.match(consignes.at(-1), /# Où est Sam/);
});

test("Sam nomme un lieu, le renomme, le supprime ; « tout effacer » garde ses lieux nommés", async () => {
  const r = await (await envoyer("POST", "/api/lieux", { lat: 45.70002, lon: 4.80002, nom: "Maison" })).json();
  assert.equal(r.lieu.nom, "Maison");
  assert.equal(r.lieux.length, 2, "le lieu existant est renommé, pas doublé");
  const id = r.lieu.id;
  const p = await (await envoyer("PATCH", `/api/lieux/${id}`, { nom: "Chez moi", rayon: 120 })).json();
  assert.equal(p.lieu.nom, "Chez moi");
  assert.equal(p.lieu.rayon, 120);
  const v = await (await fetch(`${base}/api/lieux`)).json();
  assert.equal(v.etat.ou, "lieu");
  assert.ok(v.aujourdhui.length >= 2);
  assert.equal(v.geocodage.pret, true);
  await envoyer("DELETE", "/api/lieux/historique");
  const apres = await (await fetch(`${base}/api/lieux`)).json();
  assert.equal(apres.aujourdhui.length, 0);
  assert.deepEqual(apres.lieux.map((l) => l.nom), ["Chez moi"], "le lieu nommé reste, sans visite");
  assert.equal((await envoyer("DELETE", `/api/lieux/${id}`)).status, 200);
  assert.equal((await envoyer("DELETE", `/api/lieux/${id}`)).status, 404);
  assert.equal((await envoyer("POST", "/api/lieux", { lat: 45.7, lon: 4.8, nom: "" })).status, 400);
});

test("au-delà de 90 jours, tout s'efface ; la tour peut tout couper", async () => {
  lieux.recevoir([
    { type: "visite", id: "vieille", arrivee: maintenant - 91 * 24 * H, depart: maintenant - 91 * 24 * H + H, lat: 45.70001, lon: 4.80001 },
    { type: "visite", id: "recente", arrivee: maintenant - 3 * H, lat: 45.70001, lon: 4.80001 },
  ]);
  assert.equal(lieux.purger(maintenant), 1);
  assert.deepEqual(lieux.journee().map((v) => v.id).includes("vieille"), false);
  process.env.REMY_LIEUX = "off";
  try {
    const r = await envoyer("POST", "/api/lieux/evenements", { evenements: [{ type: "visite", id: "z", arrivee: maintenant, lat: 45.7, lon: 4.8 }] });
    assert.equal(r.status, 409);
    assert.equal(lieux.noteLieux({ maintenant }), null, "coupée : Rémy ne sait rien");
  } finally {
    delete process.env.REMY_LIEUX;
  }
  const ok = await (await envoyer("POST", "/api/lieux/evenements", { evenements: [{ type: "visite", id: "z", arrivee: maintenant - 60_000, lat: 45.7, lon: 4.8 }] })).json();
  assert.equal(ok.visites, 1);
  const v = await (await fetch(`${base}/api/version`)).json();
  assert.ok(v.capacites.includes("lieux-v1"));
});
