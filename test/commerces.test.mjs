// Reconnaître le commerce où se trouve Sam (phase 2 de la localisation, 20/10) :
// OpenStreetMap importé sur la tour, rapproché d'un lieu sans nom. Une ville
// fictive : coordonnées et commerces inventés.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

console.log = () => {};
console.warn = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-commerces-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "REMY_LIEUX"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_PRENOM = "Sam";

const c = await import("../lib/commerces.js");
const lieux = await import("../lib/lieux.js");
const { fermer } = await import("../lib/db.js");
test.after(() => {
  c.fermerCommerces();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

// Une réponse Overpass (« out bb ») : des nœuds, une grande surface, une galerie.
const OVERPASS = {
  elements: [
    { type: "node", id: 1, lat: 45.7, lon: 4.8, tags: { craft: "hairdresser", name: "Salon Lumière" } },
    { type: "way", id: 2, bounds: { minlat: 45.7100, minlon: 4.8100, maxlat: 45.7106, maxlon: 4.8110 }, tags: { shop: "supermarket", name: "Hyper Fictif Drive" } },
    { type: "way", id: 3, bounds: { minlat: 45.7200, minlon: 4.8200, maxlat: 45.7210, maxlon: 4.8215 }, tags: { shop: "mall", name: "Galerie des Lilas" } },
    { type: "node", id: 4, lat: 45.7204, lon: 4.8207, tags: { shop: "bakery", name: "Au Bon Pain Fictif" } },
    { type: "node", id: 5, lat: 45.7300, lon: 4.8300, tags: { leisure: "fitness_centre", name: "Forme Plus" } },
    { type: "node", id: 6, lat: 45.7400, lon: 4.8400, tags: { amenity: "bench" } }, // pas un endroit où l'on « va »
    { type: "way", id: 7, center: { lat: 45.7500, lon: 4.8500 }, tags: { amenity: "pharmacy" } }, // « out center », sans nom
  ],
};

test("catégories : ce que Rémy dira", () => {
  assert.equal(c.categorie({ craft: "hairdresser" }).type, "coiffeur");
  assert.equal(c.categorie({ shop: "supermarket", name: "Hyper Fictif Drive" }).type, "drive");
  assert.equal(c.categorie({ leisure: "fitness_centre" }).type, "salle de sport");
  assert.equal(c.categorie({ shop: "something_rare" }).type, "commerce");
  assert.equal(c.categorie({ amenity: "bench" }), null);
  assert.equal(c.categorie({ shop: "vacant" }), null);
  const q = c.requeteOverpass("99");
  assert.match(q, /"ref:INSEE"="99"/);
  assert.match(q, /out bb;$/);
  assert.match(c.requeteOverpass("99", "out center;"), /out center;$/);
});

test("sans base : rien d'inventé", () => {
  assert.equal(c.commerceProche(45.7, 4.8), null);
  assert.equal(c.etatCommerces().pret, false);
  assert.equal(fs.existsSync(c.cheminCommerces()), false, "lire ne crée pas la base");
});

test("le commerce où est Sam : le plus proche, dedans une grande surface, la boutique avant la galerie", () => {
  const n = c.remplacerCommerces(OVERPASS.elements, { departements: ["99"] });
  assert.equal(n, 6, "le banc est écarté");
  assert.deepEqual(c.etatCommerces().departements, ["99"]);
  assert.equal(c.commerceProche(45.70003, 4.80004).nom, "Salon Lumière");
  // Au fond du parking-magasin, loin de son centre : on est « dedans ».
  const drive = c.commerceProche(45.71005, 4.81095);
  assert.equal(drive.type, "drive");
  assert.equal(drive.distance, 0);
  assert.equal(c.libelleCommerce(drive), "Hyper Fictif Drive");
  // Dans la galerie, à côté de la boulangerie : la boulangerie.
  assert.equal(c.commerceProche(45.72042, 4.82072).nom, "Au Bon Pain Fictif");
  assert.equal(c.libelleCommerce(c.commerceProche(45.7300, 4.83002)), "Forme Plus (salle de sport)");
  assert.equal(c.libelleCommerce(c.commerceProche(45.75001, 4.85001)), "pharmacie (sans nom)");
  assert.equal(c.commerceProche(45.69, 4.79), null, "à plus de 60 m de tout : rien");
});

test("un import qui échoue garde l'ancienne base", () => {
  const avant = c.etatCommerces().commerces;
  assert.throws(() => c.remplacerCommerces([...OVERPASS.elements, { osm: "x/1", nom: "Cassé", type: "commerce", cle: "shop=x", lat: null, lon: 4.8, demi: 0 }]));
  assert.equal(c.etatCommerces().commerces, avant);
  assert.equal(c.commerceProche(45.7, 4.8).nom, "Salon Lumière");
});

test("un lieu sans nom devient « sans doute Salon Lumière (coiffeur) » — un lieu nommé reste à Sam", () => {
  const maintenant = Date.now();
  lieux.recevoir([{ type: "visite", id: "v1", arrivee: maintenant - 20 * 60_000, lat: 45.70002, lon: 4.80002, precision: 30 }]);
  const v = lieux.vue(maintenant);
  assert.equal(v.commerces.pret, true);
  assert.equal(v.lieux[0].commerce.type, "coiffeur");
  assert.equal(v.etat.lieu.commerce.nom, "Salon Lumière");
  const note = lieux.noteLieux({ maintenant, taches: ["Prendre rendez-vous coiffeur"] });
  assert.match(note, /En ce moment : sans doute Salon Lumière \(coiffeur\)/);
  assert.match(note, /« Prendre rendez-vous coiffeur »/, "la tâche liée au type du commerce");
  lieux.nommer({ id: v.lieux[0].id, nom: "Mon coiffeur" });
  const apres = lieux.vue(maintenant);
  assert.equal(apres.lieux[0].nom, "Mon coiffeur");
  assert.equal(apres.lieux[0].commerce, null, "nommé par Sam : plus de supposition");
});

test("l'importeur, hors ligne, depuis une réponse Overpass enregistrée", () => {
  const fichier = path.join(dossier, "export.json");
  fs.writeFileSync(fichier, JSON.stringify(OVERPASS));
  const autre = fs.mkdtempSync(path.join(os.tmpdir(), "remy-commerces-imp-"));
  const script = fileURLToPath(new URL("../scripts/commerces-importer.mjs", import.meta.url));
  const r = spawnSync(process.execPath, ["--no-warnings", script, "--fichier", fichier, "--departement", "99"], {
    env: { ...process.env, REMY_DATA_DIR: autre },
    encoding: "utf8",
  });
  fs.rmSync(autre, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Base des commerces prête : 6 commerces/);
  const sans = spawnSync(process.execPath, ["--no-warnings", script, "--fichier", fichier], { env: { ...process.env, REMY_DATA_DIR: autre }, encoding: "utf8" });
  assert.equal(sans.status, 1);
  assert.match(sans.stderr, /indique --departement/);
});
