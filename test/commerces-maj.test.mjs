// La base des commerces se remet à jour toute seule (29/10 : « pas besoin
// d'actualiser tous les jours, fais un truc raisonnable ») : au plus une fois
// par mois, la nuit, sans IA, reprise si elle échoue, et la date de la dernière
// mise à jour affichée. Un faux Overpass, des commerces inventés.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};
console.error = () => {};

// --- Faux Overpass : « ok » rend deux commerces, « refus » répond 400 aux deux sorties.
const overpass = { mode: "ok", requetes: [] };
const serveur = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (x) => (corps += x));
  req.on("end", () => {
    overpass.requetes.push(decodeURIComponent(corps.replace(/\+/g, " ")));
    if (overpass.mode === "refus") {
      res.writeHead(400);
      return res.end("bad request");
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        elements: [
          { type: "node", id: 1, lat: 45.7, lon: 4.8, tags: { craft: "hairdresser", name: "Salon Lumière" } },
          { type: "node", id: 2, lat: 45.71, lon: 4.81, tags: { shop: "bakery", name: "Au Bon Pain Fictif" } },
          { type: "node", id: 3, lat: 45.72, lon: 4.82, tags: { shop: "florist", name: "Fleurs Fictives" } },
        ],
      }),
    );
  });
});
await new Promise((r) => serveur.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-commerces-maj-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "REMY_LIEUX", "REMY_COMMERCES_AUTO", "REMY_COMMERCES_JOURS", "REMY_GEO_DEPARTEMENTS", "REMY_SAUVEGARDE_CLE", "REMY_TZ"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_PRENOM = "Sam";
process.env.REMY_OVERPASS_URL = `http://127.0.0.1:${serveur.address().port}/api/interpreter`;
// La nuit du planificateur, c'est maintenant : la fenêtre des commerces commence
// à l'heure de Paris du test ; ni réflexion ni sauvegarde ni purges (non enregistrées ici).
const heureParis = Number(
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).find((p) => p.type === "hour").value,
);
process.env.REMY_COMMERCES_HEURE = String(heureParis);
process.env.REMY_REFLEXION_HEURE = "99";
process.env.REMY_SAUVEGARDE_HEURE = "99";

const c = await import("../lib/commerces.js");
const maj = await import("../lib/commerces-maj.js");
const jobs = await import("../lib/jobs.js");
const planif = await import("../lib/planif.js");
const lieux = await import("../lib/lieux.js");
const { db, fermer } = await import("../lib/db.js");
test.after(() => {
  serveur.close();
  c.fermerCommerces();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const JOUR = 86_400_000;
const vieillir = (jours) => c.baseCommerces().prepare("UPDATE meta SET valeur = ? WHERE cle = 'importe_a'").run(String(Date.now() - jours * JOUR));
const vider = () => db().prepare("DELETE FROM jobs").run();
maj.enregistrerCommerces();

test("pas de base : rien d'automatique (le premier import reste un geste), et c'est dit", () => {
  assert.equal(maj.commercesADemander({ heure: heureParis }), null);
  assert.match(maj.resumeCommerces(), /^— pas encore de base \(une fois : scripts\/commerces-importer\.mjs/);
});

test("au plus une fois par mois, la nuit seulement, coupable", () => {
  c.remplacerCommerces([{ type: "node", id: 9, lat: 45.7, lon: 4.8, tags: { shop: "bakery", name: "Ancienne Boulangerie" } }], { departements: ["99"] });
  assert.equal(maj.commercesADemander({ heure: heureParis }), null, "importée aujourd'hui : rien à faire");
  vieillir(29);
  assert.equal(maj.commercesADemander({ heure: heureParis }), null, "29 jours : pas encore");
  vieillir(31);
  assert.deepEqual(maj.commercesADemander({ heure: heureParis }), { departements: ["99"] }, "31 jours : la nuit venue, elle est demandée");
  assert.equal(maj.commercesADemander({ heure: (heureParis + 12) % 24 }), null, "en journée : jamais");
  process.env.REMY_COMMERCES_AUTO = "off";
  assert.equal(maj.commercesADemander({ heure: heureParis }), null);
  assert.match(maj.resumeCommerces(), /mise à jour automatique coupée/);
  delete process.env.REMY_COMMERCES_AUTO;
  process.env.REMY_LIEUX = "off";
  assert.equal(maj.commercesADemander({ heure: heureParis }), null, "localisation coupée : pas de commerces à tenir à jour");
  delete process.env.REMY_LIEUX;
  // Les départements de remy.env l'emportent sur ceux de la base.
  process.env.REMY_GEO_DEPARTEMENTS = "98, 99";
  assert.deepEqual(maj.commercesADemander({ heure: heureParis }).departements, ["98", "99"]);
  delete process.env.REMY_GEO_DEPARTEMENTS;
});

test("échec (Overpass refuse) : repris dans la nuit, dit avec sa date, puis réussi — base remplacée, date affichée", async () => {
  vider();
  vieillir(31);
  overpass.mode = "refus";
  overpass.requetes.length = 0;
  const faits = await planif.passage();
  const r = faits.find((f) => f.type === "commerces-maj");
  assert.ok(r, "demandée par le planificateur et lancée");
  assert.equal(r.etat, "attente", "un échec n'est jamais « fait »");
  assert.match(r.erreur, /Overpass 99 : réponse 400/);
  assert.ok(overpass.requetes.length >= 1 && overpass.requetes.every((q) => q.includes('["ref:INSEE"="99"]')), "le département part");
  assert.ok(overpass.requetes.every((q) => !/45\.7|4\.8/.test(q)), "jamais une position");
  let j = jobs.dernierJob("commerces-maj");
  assert.equal(j.tentatives, 1);
  assert.ok(j.prochain_essai_a - Date.now() > 25 * 60_000, "nouvel essai dans 30 min, pas tout de suite");
  assert.equal(c.etatCommerces().commerces, 1, "l'ancienne base est gardée");
  assert.match(maj.resumeCommerces(), /^⚠️ 1 commerce \(99\), mis à jour le \d\d\/\d\d\/\d{4} ; dernière tentative le \d\d\/\d\d à \d\d:\d\d échouée \(Overpass 99 : réponse 400\) — nouvel essai le \d\d\/\d\d à \d\d:\d\d$/);
  assert.ok(lieux.vue().commerces.maj.echec, "l'app le voit aussi (vue des lieux)");

  // Le passage suivant ne la redemande pas (une par nuit), et l'essai repris réussit.
  overpass.mode = "ok";
  db().prepare("UPDATE jobs SET prochain_essai_a = 0 WHERE type = 'commerces-maj'").run();
  await planif.passage();
  j = jobs.dernierJob("commerces-maj");
  assert.equal(j.etat, "fait");
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'commerces-maj'").get().n, 1, "un seul job pour la nuit");
  const e = c.etatCommerces();
  assert.equal(e.commerces, 3, "la base est remplacée");
  assert.ok(Date.now() - e.importeA < 60_000);
  const aujourdhui = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
  const dans30 = new Date(Date.now() + 30 * JOUR).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
  assert.equal(maj.resumeCommerces(), `✅ 3 commerces (99), mis à jour le ${aujourdhui} ; prochaine mise à jour automatique la nuit après le ${dans30}`);
  const vue = lieux.vue().commerces;
  assert.equal(vue.maj.echec, null);
  assert.equal(vue.maj.auto, true);
  assert.ok(vue.maj.derniere && vue.maj.prochaine);
  // À jour : rien n'est redemandé, ni ce soir ni les nuits suivantes avant 30 jours.
  assert.equal(maj.commercesADemander({ heure: heureParis }), null);
  vider();
});

test("une base d'un format dépassé (après une mise à jour du code) est refaite la nuit suivante", () => {
  c.baseCommerces().prepare("UPDATE meta SET valeur = '3' WHERE cle = 'format'").run();
  assert.equal(c.etatCommerces().aRefaire, true);
  assert.deepEqual(maj.commercesADemander({ heure: heureParis }), { departements: ["99"] });
  assert.match(maj.resumeCommerces(), /^⚠️ .* ; format dépassé : refaite la nuit prochaine$/);
});
