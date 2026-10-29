// Constat du 29/10 sur la tour : /api/health disait « reflexion-nuit abandonné :
// Le modèle local (GLM, sur la tour) ne répond pas… · Sparks 0/2 », alors que
// les Sparks servaient DeepSeek et que le chat répondait. Les causes, rejouées
// contre de faux serveurs compatibles OpenAI :
//   - une alerte d'une version d'avant (un 404 « model_not_found » pris pour
//     « ne répond pas ») restait affichée pour toujours ;
//   - « Sparks 0/2 » comptait les inférences en cours, pas les Sparks ;
//   - un modèle renommé ou changé entre deux lectures de /models : 404 ;
//   - un premier jeton lent, une réflexion longue : pris pour une panne ;
//   - Sparks saturées (429) ou éteintes une heure : la réflexion abandonnée
//     à 5 h, sans nouvel essai dans la nuit.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
const avertis = [];
console.warn = (...a) => avertis.push(a.join(" "));
console.error = () => {};

// --- Un faux serveur de modèle (vLLM, tensorfold) ------------------------------------------
function fauxModele(servis) {
  const s = {
    servis,
    recus: [], // corps des /chat/completions
    jetons: [], // en-têtes Authorization vus
    modelesEteint: false,
    completionsEteint: false,
    code429: false,
    refuserTout: false,
    delaiEntetesMs: 0,
    delaiPremierMs: 0,
    delaiCompleteMs: 0,
  };
  s.serveur = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      s.jetons.push(req.headers.authorization || null);
      if (req.url.endsWith("/models")) {
        if (s.modelesEteint) return req.socket.destroy();
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ object: "list", data: s.servis.map((id) => ({ id, object: "model", max_model_len: 131072 })) }));
      }
      const corps = JSON.parse(b || "{}");
      s.recus.push(corps);
      if (s.completionsEteint) return req.socket.destroy();
      if (s.code429) {
        res.writeHead(429, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "Too many requests" } }));
      }
      if (s.refuserTout || !s.servis.includes(corps.model)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: `The model \`${corps.model}\` does not exist.`, type: "invalid_request_error", code: "model_not_found" } }));
      }
      if (!corps.stream) {
        return setTimeout(() => {
          if (res.destroyed) return;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ choices: [{ message: { content: "- Une piste pour demain." }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
        }, s.delaiCompleteMs);
      }
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.flushHeaders();
        setTimeout(() => {
          if (res.destroyed) return;
          const d = (delta, fin = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`;
          res.write(d({ content: "Bonjour " }));
          res.write(d({ content: "Sam." }));
          res.write(d({}, "stop"));
          res.end("data: [DONE]\n\n");
        }, s.delaiPremierMs);
      }, s.delaiEntetesMs);
    });
  });
  s.ecouter = () => new Promise((r) => s.serveur.listen(0, "127.0.0.1", r)).then(() => `http://127.0.0.1:${s.serveur.address().port}/v1`);
  s.fermer = () => new Promise((r) => s.serveur.close(r));
  return s;
}

const spark1 = fauxModele(["DeepSeek-V4.1-Flash-1017"]);
const url1 = await spark1.ecouter();

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-sparks-nuit-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_CERVEAU", "REMY_SECOURS_CLOUD", "ANTHROPIC_API_KEY", "REMY_SPARKS", "REMY_SPARKS_MAX", "REMY_CIRCUIT_NUIT", "REMY_REFLEXION_LIMITE", "REMY_ALERTE_JOBS_H", "REMY_REPRISE_LOCAL_MIN", "REMY_GLM_TOKEN"]) {
  delete process.env[v];
}
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = url1;
process.env.REMY_GLM_MODEL = "GLM-5.3-Flash-EXL3"; // l'ancien réglage de la tour, plus servi
process.env.REMY_PROVIDER = "api";
process.env.REMY_BROWSE = "off";
process.env.REMY_PRENOM = "Sam";
process.env.REMY_REFLEXION_HEURE = "0";
// Les délais de la tour, raccourcis : 8 s → 150 ms, 60 s → 200 ms.
process.env.REMY_GLM_ENTETES_MS = "150";
process.env.REMY_GLM_ENTETES_MAX_MS = "3000";
process.env.REMY_GLM_SILENCE_MS = "200";

const glm = await import("../lib/glm.js");
const { glmProvider, fournisseurDeFond, estSecoursCoupe } = await import("../lib/providers.js");
const jobs = await import("../lib/jobs.js");
const planif = await import("../lib/planif.js");
const sparks = await import("../lib/sparks.js");
const { noterIncident } = await import("../lib/incidents.js");
const { routeApi } = await import("../lib/routes.js");
const { db, fermer } = await import("../lib/db.js");

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(async () => {
  remy.close();
  await spark1.fermer();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const sante = async () => (await fetch(`${base}/api/health`)).json();
// Chaque scénario part de Sparks allumées, la liste servie relue.
async function remettre() {
  Object.assign(spark1, { modelesEteint: false, completionsEteint: false, code429: false, refuserTout: false, delaiEntetesMs: 0, delaiPremierMs: 0, delaiCompleteMs: 0 });
  spark1.servis = ["DeepSeek-V4.1-Flash-1017"];
  spark1.recus.length = 0;
  jobs._reinitialiserCharge();
  await glm.modelesServis({ frais: true });
  await glm.modeleActif();
  await glm.verifierGlm({ maxAgeMs: 0 });
  sparks._oublierSparks();
}
const vider = () => db().prepare("DELETE FROM jobs").run();
const H = 3600_000;
const inserer = (type, { etat, erreur = null, maj }) =>
  db()
    .prepare("INSERT INTO jobs (id, type, circuit, cle, priorite, etat, erreur, tentatives, max_tentatives, delai_max_ms, prochain_essai_a, cree_a, maj_a) VALUES (?, ?, 'nuit', ?, 2, ?, ?, 4, 4, 600000, ?, ?, ?)")
    .run(`${type}-${maj}`, type, `${type}:${maj}`, etat, erreur, maj, maj, maj);
const ANCIEN =
  "Le modèle local (GLM, sur la tour) ne répond pas, et le secours Claude est coupé : rien n'est parti dans le cloud. Réessaie quand GLM est revenu, ou active « Secours Claude » dans les Réglages de l'app iPhone.";

test("le constat : une réflexion abandonnée par une version d'avant ne reste pas affichée pour toujours", async () => {
  await remettre();
  vider();
  inserer("reflexion-nuit", { etat: "abandonne", erreur: ANCIEN, maj: Date.now() - 3 * 24 * H });
  let h = await sante();
  assert.equal(jobs.etatJobs().problemes.length, 0, "plus de 48 h : plus d'alerte");
  assert.match(h.travail_de_fond, /^✅ aucun échec en attente/);
  // Et le compteur de la garde ne se fait plus passer pour les Sparks.
  assert.doesNotMatch(h.travail_de_fond, /Sparks \d+\/\d+/);
  assert.match(h.travail_de_fond, /inférences en cours : 0 \(fond : 2 à la fois au plus\)/);

  // Une alerte récente se lit, datée…
  inserer("reflexion-nuit", { etat: "abandonne", erreur: "panne de cette nuit", maj: Date.now() - H });
  h = await sante();
  assert.match(h.travail_de_fond, /^⚠️ reflexion-nuit abandonné le \d\d\/\d\d à \d\d:\d\d : panne de cette nuit/);
  // …et s'efface dès qu'une réflexion suivante réussit.
  inserer("reflexion-nuit", { etat: "fait", maj: Date.now() });
  h = await sante();
  assert.match(h.travail_de_fond, /^✅ aucun échec en attente/);
  vider();
});

test("404 model_not_found : les Sparks ont changé (ou renommé) leur modèle depuis la dernière lecture — Rémy relit /models et repart", async () => {
  await remettre();
  assert.equal((await glm.modeleActif()).id, "DeepSeek-V4.1-Flash-1017", "l'ancien REMY_GLM_MODEL n'est plus servi : Rémy suit les Sparks");
  // Rechargé sur les Sparks sous un autre nom ; la liste en mémoire a moins d'une minute.
  spark1.servis = ["deepseek-ai/DeepSeek-V4.2-Flash-1101"];
  const f = fournisseurDeFond();
  const r = await f.complete({ system: "s", prompt: "Prépare le briefing.", maxTokens: 50 });
  assert.equal(r.text, "- Une piste pour demain.");
  assert.equal(f.name, "glm");
  assert.deepEqual(spark1.recus.map((x) => x.model), ["DeepSeek-V4.1-Flash-1017", "deepseek-ai/DeepSeek-V4.2-Flash-1101"]);
  assert.ok(avertis.some((a) => /refusé par les Sparks \(réponse 404\), Rémy passe à « deepseek-ai\/DeepSeek-V4\.2-Flash-1101 »/.test(a)));
  assert.equal(glm.nomModeleLocal(), "le modèle local (DeepSeek-V4.2-Flash-1101)");
  assert.equal((await glm.verifierGlm({ maxAgeMs: 0 })).ok, true, "un 404 n'est pas une panne");
});

test("un refus du modèle qui persiste : la cause est dite (« ne servent pas »), jamais « ne répond pas »", async () => {
  await remettre();
  spark1.refuserTout = true;
  await assert.rejects(fournisseurDeFond().complete({ system: "s", prompt: "p", maxTokens: 10 }), (err) => {
    assert.ok(estSecoursCoupe(err));
    assert.equal(err.nature, "modele");
    assert.equal(err.indisponible, false);
    assert.match(err.message, /^Les Sparks ne servent pas le modèle demandé \(« DeepSeek-V4\.1-Flash-1017 », réponse 404\), et le secours Claude est coupé : rien n'est parti dans le cloud\. Regarde ce qu'elles servent dans Réglages › Modèle/);
    assert.doesNotMatch(err.message, /ne répond pas|GLM/);
    return true;
  });
  assert.equal(spark1.recus.length, 1, "/models relu sert le même modèle : pas de second envoi inutile");
});

test("les messages nomment le modèle servi, et disent quoi faire", async () => {
  await remettre();
  spark1.completionsEteint = true; // /models répond encore, le calcul tombe
  await assert.rejects(fournisseurDeFond().complete({ system: "s", prompt: "p", maxTokens: 10 }), (err) => {
    assert.match(err.message, /^Le modèle local \(DeepSeek-V4\.1-Flash-1017\) ne répond pas \(.+\), et le secours Claude est coupé : rien n'est parti dans le cloud\. Vérifie que les Sparks sont allumées et que le modèle y est chargé, puis réessaie — ou active « Secours Claude »/);
    assert.doesNotMatch(err.message, /GLM/);
    assert.equal(err.indisponible, true);
    return true;
  });
});

test("premier jeton lent (en-têtes tardifs) : Rémy attend tant que le serveur répond à /models", async () => {
  await remettre();
  spark1.delaiEntetesMs = 900; // > REMY_GLM_ENTETES_MS (150) : avant, coupé et « injoignable »
  let vu = "";
  const r = await glmProvider.stream({ system: [{ text: "sys" }], messages: [{ role: "user", content: "Salut" }], onText: (t) => (vu += t), reflexion: false });
  assert.equal(vu, "Bonjour Sam.");
  assert.equal(r.text, "Bonjour Sam.");
  assert.equal((await glm.verifierGlm()).ok, true, "pas noté en panne");
});

test("premier jeton lent après les en-têtes (long contexte) : le silence n'est plus une panne", async () => {
  await remettre();
  spark1.delaiPremierMs = 900; // > REMY_GLM_SILENCE_MS (200)
  let vu = "";
  await glmProvider.stream({ system: [{ text: "sys" }], messages: [{ role: "user", content: "Salut" }], onText: (t) => (vu += t), reflexion: false });
  assert.equal(vu, "Bonjour Sam.");
});

test("serveur vraiment éteint : « injoignable » sans attendre", async () => {
  await remettre();
  spark1.delaiEntetesMs = 60_000;
  spark1.modelesEteint = true;
  const debut = Date.now();
  await assert.rejects(
    glmProvider.stream({ system: [{ text: "sys" }], messages: [{ role: "user", content: "Salut" }], onText: () => {}, reflexion: false }),
    (err) => err.nature === "injoignable",
  );
  assert.ok(Date.now() - debut < 2500, `coupé vite (${Date.now() - debut} ms)`);
});

test("vivant mais sans un mot en ENTETES_MAX_MS : « occupé », pas « ne répond pas »", async () => {
  await remettre();
  process.env.REMY_GLM_ENTETES_MAX_MS = "500";
  spark1.delaiEntetesMs = 5_000;
  try {
    await assert.rejects(
      glmProvider.stream({ system: [{ text: "sys" }], messages: [{ role: "user", content: "Salut" }], onText: () => {}, reflexion: false }),
      (err) => err.nature === "occupe" && /^Le modèle local \(DeepSeek-V4\.1-Flash-1017\) est joignable mais n'a pas commencé à répondre en 1 s/.test(err.message),
    );
  } finally {
    process.env.REMY_GLM_ENTETES_MAX_MS = "3000";
  }
});

test("réflexion longue (sans flux) : délai dépassé n'est pas « injoignable », et le délai d'un job est celui du fond", async () => {
  await remettre();
  spark1.delaiCompleteMs = 1500;
  await assert.rejects(glmProvider.complete({ system: "s", prompt: "p", delaiMs: 400 }), (err) => {
    assert.equal(err.nature, "delai");
    assert.match(err.message, /^Le modèle local \(DeepSeek-V4\.1-Flash-1017\) est joignable mais n'a pas fini en 1 s/);
    return true;
  });
  assert.equal((await glm.verifierGlm()).ok, true, "toujours joignable pour la suite");
  // Dans un job, sans délai donné : REMY_FOND_DELAI_MS (15 min sur la tour).
  process.env.REMY_FOND_DELAI_MS = "1000";
  vider();
  let erreur = null;
  jobs.enregistrer("long-test", {
    circuit: "socle",
    maxTentatives: 1,
    async executer() {
      try {
        await fournisseurDeFond().complete({ system: "s", prompt: "p" });
      } catch (err) {
        erreur = err;
        throw err;
      }
    },
  });
  try {
    jobs.planifier("long-test");
    await jobs.passer();
  } finally {
    delete process.env.REMY_FOND_DELAI_MS;
  }
  assert.equal(erreur?.nature, "delai");
  assert.equal(erreur.indisponible, false, "un délai compte comme un échec : on ne refait pas 15 min de calcul toutes les 20 min");
  assert.match(erreur.message, /^Le modèle local \(DeepSeek-V4\.1-Flash-1017\) répond, mais n'a pas fini en 1 s, et le secours Claude est coupé/);
  assert.doesNotMatch(erreur.message, /ne répond pas/);
  vider();
});

test("Sparks saturées (429) la nuit : la réflexion attend sans compter d'échec, puis passe, et l'alerte s'efface", async () => {
  await remettre();
  vider();
  process.env.REMY_REFLEXION_LIMITE = "24"; // la limite tombe à minuit : le test ne dépend pas de l'heure
  try {
    let briefings = 0;
    planif.enregistrerNuit({
      reflechir: async () => {
        await fournisseurDeFond().complete({ system: "s", prompt: "Prépare le briefing du matin.", maxTokens: 50 });
        briefings++;
        return { ok: true };
      },
    });
    const jour = new Date().toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
    const { id } = jobs.planifier("reflexion-nuit", { cle: `reflexion-nuit:${jour}`, entree: { jour } });
    spark1.code429 = true;
    await jobs.passer();
    let j = jobs.lireJob(id);
    assert.equal(j.etat, "attente");
    assert.equal(j.tentatives, 0, "pas un échec : les Sparks étaient prises");
    assert.match(j.erreur, /^Le modèle local \(DeepSeek-V4\.1-Flash-1017\) est occupé \(les Sparks sont au maximum\)/);
    const dans = j.prochain_essai_a - Date.now();
    assert.ok(dans > 19 * 60_000 && dans <= 20 * 60_000, `nouvel essai dans 20 min (${Math.round(dans / 60_000)} min)`);
    const h = await sante();
    assert.match(h.travail_de_fond, /^⚠️ reflexion-nuit en reprise \(prochain essai le \d\d\/\d\d à \d\d:\d\d\) : Le modèle local \(DeepSeek-V4\.1-Flash-1017\) est occupé/);
    assert.match(h.travail_de_fond, /Sparks saturées, fond différé/, "la garde le dit");

    // Les Sparks se libèrent : l'essai suivant passe, et l'alerte disparaît.
    spark1.code429 = false;
    jobs._reinitialiserCharge();
    db().prepare("UPDATE jobs SET prochain_essai_a = 0 WHERE id = ?").run(id);
    await jobs.passer();
    j = jobs.lireJob(id);
    assert.equal(j.etat, "fait");
    assert.equal(j.erreur, null);
    assert.equal(briefings, 1);
    assert.match((await sante()).travail_de_fond, /^✅ aucun échec en attente/);
  } finally {
    delete process.env.REMY_REFLEXION_LIMITE;
    vider();
  }
});

test("Sparks éteintes une partie de la nuit : un essai toutes les 20 min (une sonde, aucun calcul), jusqu'à l'heure limite, puis la règle commune", async () => {
  await remettre();
  vider();
  spark1.modelesEteint = true;
  spark1.completionsEteint = true;
  await glm.verifierGlm({ maxAgeMs: 0 });
  let limite = Date.now() + H;
  jobs.enregistrer("nuit-test", {
    circuit: "nuit",
    maxTentatives: 4,
    repriseJusqua: () => limite,
    async executer() {
      await fournisseurDeFond().complete({ system: "s", prompt: "p", maxTokens: 10 });
    },
  });
  const { id } = jobs.planifier("nuit-test");
  for (let i = 0; i < 5; i++) {
    db().prepare("UPDATE jobs SET prochain_essai_a = 0 WHERE id = ?").run(id);
    await glm.verifierGlm({ maxAgeMs: 0 });
    await jobs.passer();
  }
  let j = jobs.lireJob(id);
  assert.equal(j.etat, "attente", "toujours en attente : jamais abandonnée dans la nuit");
  assert.equal(j.tentatives, 0);
  assert.match(j.erreur, /ne répond pas/);
  assert.equal(spark1.recus.length, 0, "aucune inférence envoyée à des Sparks éteintes : seulement /models");
  // Juste avant la limite : le dernier essai tombe sur la limite, pas après.
  limite = Date.now() + 5 * 60_000;
  db().prepare("UPDATE jobs SET prochain_essai_a = 0 WHERE id = ?").run(id);
  await jobs.passer();
  j = jobs.lireJob(id);
  assert.ok(Math.abs(j.prochain_essai_a - limite) < 1000, "un dernier essai à l'heure limite");
  // L'heure limite passée : un échec compte, reprise espacée (10 min, 20…), puis abandon.
  limite = Date.now() - 1;
  db().prepare("UPDATE jobs SET prochain_essai_a = 0 WHERE id = ?").run(id);
  await jobs.passer();
  j = jobs.lireJob(id);
  assert.equal(j.tentatives, 1);
  assert.ok(j.prochain_essai_a - Date.now() > 9 * 60_000);
  vider();
});

test("la limite de la nuit : 8 h à Paris le jour de la réflexion (heure d'hiver comme d'été), réglable", () => {
  assert.equal(planif.limiteReflexion("2026-10-29"), Date.UTC(2026, 9, 29, 7));
  assert.equal(planif.limiteReflexion("2026-07-01"), Date.UTC(2026, 6, 1, 6));
  process.env.REMY_REFLEXION_LIMITE = "9";
  try {
    assert.equal(planif.limiteReflexion("2026-10-29"), Date.UTC(2026, 9, 29, 8));
  } finally {
    delete process.env.REMY_REFLEXION_LIMITE;
  }
});

test("« Sparks n/2 » dit vrai, et le diagnostic dit le modèle servi par chaque Spark", async () => {
  await remettre();
  const spark2 = fauxModele(["Qwen3-235B-A22B-AWQ"]);
  const url2 = await spark2.ecouter();
  process.env.REMY_GLM_TOKEN = "jeton-du-relais";
  try {
    // Sans REMY_SPARKS : une seule adresse connue, et la ligne ne prétend pas compter.
    let h = await sante();
    assert.match(h.glm_local, /^✅ joignable \(DeepSeek-V4\.1-Flash-1017\)/);
    assert.equal(h.sparks, "✅ le modèle local répond (DeepSeek-V4.1-Flash-1017) — une seule adresse connue (REMY_GLM_URL) : déclare REMY_SPARKS pour suivre chaque Spark");

    process.env.REMY_SPARKS = `spark-1=${url1},spark-2=${url2}`;
    sparks._oublierSparks();
    h = await sante();
    assert.equal(h.sparks, "✅ Sparks 2/2 répondent — spark-1 (Rémy) : DeepSeek-V4.1-Flash-1017 · spark-2 : Qwen3-235B-A22B");
    assert.ok(!spark2.jetons.includes("Bearer jeton-du-relais"), "le jeton du relais ne part que vers REMY_GLM_URL");
    assert.ok(spark1.jetons.includes("Bearer jeton-du-relais"));

    // Un Spark sur deux.
    await spark2.fermer();
    sparks._oublierSparks();
    h = await sante();
    assert.match(h.sparks, /^⚠️ Sparks 1\/2 répond — spark-1 \(Rémy\) : DeepSeek-V4\.1-Flash-1017 · spark-2 : ❌ (injoignable|délai dépassé)$/);
    assert.doesNotMatch(JSON.stringify(h), /127\.0\.0\.1/, "aucune adresse dans l'état");

    // Réglages › Modèle (l'app) : chaque Spark et ce qu'elle sert.
    const m = await (await fetch(`${base}/api/modeles`)).json();
    assert.deepEqual(
      m.sparks.map((s) => [s.nom, s.remy, s.joignable, s.modeles.map((x) => x.libelle)]),
      [["spark-1", true, true, ["DeepSeek-V4.1-Flash-1017"]], ["spark-2", false, false, []]],
    );
    // « Copier le diagnostic » d'un incident : ce que sert chaque Spark au moment de la copie.
    const code = noterIncident({ type: "chat", modele: "DeepSeek-V4.1-Flash-1017" });
    const d = await (await fetch(`${base}/api/incidents/${code}`)).json();
    assert.equal(d.code, code);
    assert.deepEqual(d.sparks.liste.map((s) => [s.nom, s.joignable, s.modeles.map((x) => x.id)]), [["spark-1", true, ["DeepSeek-V4.1-Flash-1017"]], ["spark-2", false, []]]);
  } finally {
    delete process.env.REMY_SPARKS;
    delete process.env.REMY_GLM_TOKEN;
    sparks._oublierSparks();
  }
});

test("REMY_SPARKS : noms facultatifs, doublons et saisies invalides ignorés", () => {
  const { liste, declarees } = sparks.sparksDeclarees({
    REMY_GLM_URL: "http://a.example:8888/v1/",
    REMY_SPARKS: "http://a.example:8888/v1, gauche=http://b.example:8000/v1 ; pas-une-adresse ,http://a.example:8888/v1/",
  });
  assert.equal(declarees, true);
  assert.deepEqual(liste.map((s) => [s.nom, s.principale]), [["Spark 1", true], ["gauche", false]]);
  assert.equal(sparks.resumeSparks({ declarees: false, sparks: [] }), "— aucun modèle local branché (REMY_GLM_URL)");
});
