// Réglages › Outils de code (vues/reglages.js, passerelle-v1) : ce que l'écran
// dit d'une clé (jamais la clé), les adresses à copier, l'état des appels.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";

const magasin = new Map();
globalThis.localStorage = { getItem: (k) => (magasin.has(k) ? magasin.get(k) : null), setItem: (k, v) => magasin.set(k, String(v)), removeItem: (k) => magasin.delete(k), clear: () => magasin.clear() };
const V = await import("../public/app/vues/reglages.js");
const R = await import("../public/app/analyse/recherche-reglages.js");

test("une clé : son aperçu, sa date, son dernier usage ; aucune clé : dit simplement", () => {
  const maintenant = Date.parse("2026-11-12T15:00:00+01:00");
  assert.equal(V.phraseClePasserelle(null, maintenant), "Aucune clé.");
  const p = V.phraseClePasserelle({ apercu: "remy_fond_…ab12", creeA: maintenant - 2 * 86400_000, dernierUsage: null }, maintenant);
  assert.match(p, /^Une clé existe \(remy_fond_…ab12, créée .+, pas encore utilisée\)\.$/);
  assert.match(V.phraseClePasserelle({ apercu: "remy_clavier_…zz99", creeA: maintenant - 3600_000, dernierUsage: maintenant - 120_000 }, maintenant), /utilisée/);
});

test("les adresses : la tour elle-même toujours, celle du site quand on n'y est pas en local", () => {
  assert.deepEqual(V.adressesPasserelle({ portLocal: 3010 }, "http://127.0.0.1:3010").map((a) => a.url), ["http://127.0.0.1:3010/v1"]);
  assert.deepEqual(V.adressesPasserelle({ portLocal: 3010 }, "https://tour.exemple.ts.net:8444").map((a) => a.url), ["http://127.0.0.1:3010/v1", "https://tour.exemple.ts.net:8444/v1"]);
  assert.deepEqual(V.adressesPasserelle({}, "").map((a) => a.url), ["http://127.0.0.1:3000/v1"]);
});

test("l'état des appels, en mots", () => {
  assert.equal(V.phraseEtatPasserelle({ enFile: 0, enCours: 0 }), "Aucun appel d'outil de code en ce moment.");
  assert.equal(V.phraseEtatPasserelle({ enFile: 2, enCours: 1 }), "2 appels d'agents en attente, 1 en cours.");
  assert.equal(V.phraseEtatPasserelle({ enFile: 1, enCours: 0 }), "1 appel d'agent en attente.");
});

test("la recherche de Réglages trouve la section (cachée sans la capacité)", () => {
  const avec = { capacites: ["passerelle-v1"], reglages: null };
  assert.ok(R.chercher("T3 Code", avec).entrees.some((e) => e.section === "passerelle"));
  assert.ok(R.chercher("base URL", avec).entrees.some((e) => e.id === "passerelle"));
  assert.equal(R.chercher("T3 Code", { capacites: [], reglages: null }).entrees.some((e) => e.section === "passerelle" && !e.grise), false);
});
