// Conversation privée depuis l'iPhone (27/10) : le contrat que l'app lit et
// écrit sur la tour, sans route nouvelle.
//   - POST /api/conversations { prive: true } : née privée ;
//   - PATCH { prive: true } : rendue privée, sans retour (PATCH { prive: false } refusé) ;
//   - la liste et la conversation disent `prive` ;
//   - /api/reglages : l'interrupteur « Recherche dans les conversations
//     privées » (coupé par défaut), son verrou, la salle blanche, et le
//     circuit « compactage » que la jauge lit ;
//   - /api/version : les capacités qui montrent l'interrupteur et la jauge ;
//   - recherche web coupée : la recherche privée ne s'applique pas (ce que l'app dit) ;
//   - la dictée d'une conversation privée (?prive=1) : Dictée Locale seulement.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-prive-iphone-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH",
  "VERCEL", "REMY_MODEL", "REMY_CERVEAU", "REMY_RECHERCHE_PRIVEE", "REMY_SALLE_BLANCHE", "REMY_RECHERCHE", "REMY_WEB_SEARCH",
  "DICTEE_LOCALE_URL", "TRANSCRIPTION_CLOUD", "TRANSCRIBE_PROVIDER", "TRANSCRIBE_BASE_URL", "GROQ_API_KEY", "MISTRAL_API_KEY"]) {
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

// Contre-relecture (27/10) : ce que l'app affiche suit ce que fait lib/chat.js.
// La recherche web coupée (Réglages ou tour), une conversation privée ne
// cherche pas, interrupteur privé allumé ou non : l'app ne doit pas dire
// « Recherche web permise ».
test("Réglages : recherche web coupée, la recherche privée ne s'applique pas", async () => {
  await json("PUT", "/api/reglages", { recherchePrivee: true });
  try {
    const allume = await (await json("GET", "/api/reglages")).json();
    assert.equal(allume.rechercheWeb, true);
    assert.equal(allume.recherchePrivee, true, "allumée, web permis : elle s'applique");
    await json("PUT", "/api/reglages", { rechercheWeb: false });
    const sansWeb = await (await json("GET", "/api/reglages")).json();
    assert.equal(sansWeb.rechercheWeb, false);
    assert.equal(sansWeb.recherchePriveeReglage, true, "le choix de Sam est gardé");
    assert.equal(sansWeb.recherchePrivee, false, "web coupé : rien ne sort d'une conversation privée");
    await json("PUT", "/api/reglages", { rechercheWeb: true });
    process.env.REMY_WEB_SEARCH = "off";
    const tour = await (await json("GET", "/api/reglages")).json();
    assert.equal(tour.rechercheWebCoupeeParLaTour, true);
    assert.equal(tour.recherchePrivee, false, "web coupé sur la tour : pareil");
  } finally {
    delete process.env.REMY_WEB_SEARCH;
    await json("PUT", "/api/reglages", { recherchePrivee: false, rechercheWeb: true });
  }
});

// Contre-relecture (27/10) : la dictée d'une conversation privée ne part
// jamais chez un service en ligne, même avec TRANSCRIPTION_CLOUD=on.
test("Dictée privée (?prive=1) : Dictée Locale seulement, jamais le cloud", async () => {
  let appels = 0;
  const faux = http.createServer((req, res) => {
    appels++;
    req.resume();
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ text: "bonjour Rémy" }));
    });
  });
  await new Promise((r) => faux.listen(0, "127.0.0.1", r));
  const adresse = `http://127.0.0.1:${faux.address().port}/v1`;
  const audio = Buffer.alloc(2000, 1);
  const dicter = (suite = "") => fetch(`${base}/api/transcribe?type=audio/mp4&dur=1${suite}`, { method: "POST", body: audio });
  const avant = { cloud: process.env.TRANSCRIPTION_CLOUD, cle: process.env.OPENAI_API_KEY, url: process.env.TRANSCRIBE_BASE_URL };
  try {
    // Le cloud ouvert à la main (TRANSCRIPTION_CLOUD=on), un faux OpenAI.
    process.env.TRANSCRIPTION_CLOUD = "on";
    process.env.OPENAI_API_KEY = "sk-faux";
    process.env.TRANSCRIBE_BASE_URL = adresse;
    const refus = await dicter("&prive=1");
    assert.equal(refus.status, 503);
    const corps = await refus.json();
    assert.equal(corps.error, "prive_cloud");
    assert.match(corps.message, /Dictée Locale/);
    assert.equal(appels, 0, "l'audio n'est parti nulle part");
    // Une conversation ordinaire : la voie choisie par Sam reste ouverte.
    const ordinaire = await dicter();
    assert.equal(ordinaire.status, 200);
    assert.equal(appels, 1);
    // Dictée Locale branchée : la conversation privée dicte normalement.
    process.env.DICTEE_LOCALE_URL = adresse;
    const locale = await dicter("&prive=1");
    assert.equal(locale.status, 200);
    assert.equal((await locale.json()).text, "bonjour Rémy");
    assert.equal(appels, 2);
  } finally {
    for (const [v, cle] of [["TRANSCRIPTION_CLOUD", "cloud"], ["OPENAI_API_KEY", "cle"], ["TRANSCRIBE_BASE_URL", "url"]]) {
      if (avant[cle] === undefined) delete process.env[v];
      else process.env[v] = avant[cle];
    }
    delete process.env.DICTEE_LOCALE_URL;
    faux.close();
  }
});

test("Version : les capacités que l'app attend pour l'interrupteur et la jauge", async () => {
  const v = await (await json("GET", "/api/version")).json();
  for (const c of ["recherche-privee-v1", "jauge-v1", "compactage-v1", "reglages"]) assert.ok(v.capacites.includes(c), c);
});
