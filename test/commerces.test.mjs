// Reconnaître le commerce où se trouve Sam (phase 2 de la localisation, 20/10) :
// OpenStreetMap importé sur la tour, rapproché d'un lieu sans nom. Une ville
// fictive : coordonnées et commerces inventés. Depuis le premier import réel
// (23/10 : des milliers de piscines privées, des écoles qui débordaient sur les
// immeubles voisins), la règle est la prudence : plutôt rien qu'un faux
// « sans doute ».

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

console.log = () => {};
console.warn = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-commerces-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "REMY_LIEUX"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_PRENOM = "Sam";
// Un fuseau où il est 14 h : « maintenant » ne tombe jamais en pleine nuit (la
// règle du logement en dépend), quelle que soit l'heure du test.
{
  const h = ((14 - new Date().getUTCHours() + 36) % 24) - 12;
  process.env.REMY_TZ = h === 0 ? "Etc/UTC" : `Etc/GMT${h > 0 ? "-" : "+"}${Math.abs(h)}`;
}

const c = await import("../lib/commerces.js");
const lieux = await import("../lib/lieux.js");
const { fermer } = await import("../lib/db.js");
test.after(() => {
  c.fermerCommerces();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const M = 111_320;
const versLon = (lat, m) => m / (M * Math.cos((lat * Math.PI) / 180));
// Le point à (nord, est) mètres d'un autre.
const decale = (lat, lon, nord, est = 0) => ({ lat: lat + nord / M, lon: lon + versLon(lat, est) });
// Un contour fermé (« out geom ») : un rectangle, ou un polygone de sommets.
const rectangle = (sud, ouest, nord, est) => [
  { lat: sud, lon: ouest }, { lat: sud, lon: est }, { lat: nord, lon: est }, { lat: nord, lon: ouest }, { lat: sud, lon: ouest },
];
const carre = (lat, lon, m) => {
  const a = decale(lat, lon, -m, -m);
  const b = decale(lat, lon, m, m);
  return rectangle(a.lat, a.lon, b.lat, b.lon);
};
const polygone = (lat, lon, sommets) => [...sommets, sommets[0]].map(([n, e]) => decale(lat, lon, n, e));
const chemin = (id, geometry, tags) => ({ type: "way", id, geometry, tags });

// Une réponse Overpass (« out geom ») : des nœuds, des surfaces, et du bruit.
const OVERPASS = {
  elements: [
    { type: "node", id: 1, lat: 45.7, lon: 4.8, tags: { craft: "hairdresser", name: "Salon Lumière" } },
    chemin(2, rectangle(45.7100, 4.8100, 45.7106, 4.8110), { shop: "supermarket", name: "Hyper Fictif Drive" }),
    chemin(3, rectangle(45.7200, 4.8200, 45.7210, 4.8215), { shop: "mall", name: "Galerie des Lilas" }),
    { type: "node", id: 4, lat: 45.7204, lon: 4.8207, tags: { shop: "bakery", name: "Au Bon Pain Fictif" } },
    chemin(17, rectangle(45.7206, 4.8201, 45.7209, 4.8204), { shop: "supermarket", name: "Super S" }), // dans la galerie
    { type: "node", id: 5, lat: 45.7300, lon: 4.8300, tags: { leisure: "fitness_centre", name: "Forme Plus" } },
    { type: "node", id: 6, lat: 45.7400, lon: 4.8400, tags: { amenity: "bench" } }, // pas un endroit où l'on « va »
    chemin(7, carre(45.75, 4.85, 15), { amenity: "pharmacy" }), // une surface sans nom
    { type: "way", id: 8, center: { lat: 45.7600, lon: 4.8600 }, tags: { amenity: "pharmacy", name: "Pharmacie du Mail" } }, // « out center »
    // Le bruit du premier import réel : des piscines de jardin.
    chemin(9, carre(45.77, 4.87, 6), { leisure: "swimming_pool" }),
    chemin(10, carre(45.7702, 4.8702, 6), { leisure: "swimming_pool", name: "Piscine des Pins", access: "private" }),
    { type: "node", id: 11, lat: 45.7710, lon: 4.8710, tags: { leisure: "swimming_pool", name: "Piscine municipale fictive", access: "yes" } },
    { type: "node", id: 12, lat: 45.7720, lon: 4.8720, tags: { shop: "clothes", name: "Atelier fermé", access: "no" } },
    // Une rue commerçante : deux boutiques côte à côte.
    { type: "node", id: 13, lat: 45.7800, lon: 4.8800, tags: { shop: "bakery", name: "Boulangerie des Arcades" } },
    { type: "node", id: 14, lat: 45.78003, lon: 4.8800, tags: { amenity: "cafe", name: "Café des Arcades" } },
    // Une cour d'école carrée de 100 m, tournée de 45° : son rectangle englobant
    // déborde de 41 m sur les maisons voisines.
    chemin(19, polygone(45.82, 4.92, [[70.7, 0], [0, 70.7], [-70.7, 0], [0, -70.7]]), { amenity: "school", name: "École Fictive" }),
    // Un hôpital en multipolygone : un carré de 200 m en deux morceaux (l'un à
    // l'envers), autour d'un parc de 80 m qui n'est pas l'hôpital.
    {
      type: "relation", id: 20, tags: { type: "multipolygon", amenity: "hospital", name: "Hôpital Fictif" },
      members: [
        { type: "way", ref: 201, role: "outer", geometry: polygone(45.83, 4.93, [[-100, -100], [-100, 100], [100, 100]]).slice(0, 3) },
        { type: "way", ref: 202, role: "outer", geometry: polygone(45.83, 4.93, [[-100, -100], [100, -100], [100, 100]]).slice(0, 3) },
        { type: "way", ref: 203, role: "inner", geometry: carre(45.83, 4.93, 40) },
        { type: "node", ref: 204, role: "label", lat: 45.83, lon: 4.93 },
      ],
    },
    // Une relation dont l'anneau ne se referme pas : un point, jamais « dedans ».
    {
      type: "relation", id: 21, bounds: { minlat: 45.8391, minlon: 4.9387, maxlat: 45.8409, maxlon: 4.9413 },
      tags: { type: "multipolygon", amenity: "clinic", name: "Clinique Cassée" },
      members: [{ type: "way", ref: 211, role: "outer", geometry: polygone(45.84, 4.94, [[-100, -100], [-100, 100], [100, 100]]).slice(0, 3) }],
    },
    // Un golf de 900 m : trop grand pour dire « tu y es ».
    chemin(22, carre(45.80, 4.90, 318), { leisure: "golf_course", name: "Golf X" }),
    // Un point sans nom plus proche qu'un point nommé : ambigu.
    { type: "node", id: 23, lat: 45.8100, lon: 4.9100, tags: { amenity: "fast_food" } },
    { type: "node", id: 24, lat: 45.81011, lon: 4.9100, tags: { shop: "bakery", name: "Boulangerie du Coin" } },
    // Un supermarché de 50 × 80 m, et la boulangerie d'en face, à 12 m de sa façade nord.
    chemin(25, (() => { const a = decale(45.86, 4.96, -25, -40); const b = decale(45.86, 4.96, 25, 40); return rectangle(a.lat, a.lon, b.lat, b.lon); })(), { shop: "supermarket", name: "Supermarché du Pont" }),
    { type: "node", id: 26, ...decale(45.86, 4.96, 37), tags: { shop: "bakery", name: "Boulangerie d'en face" } },
    // Pour les lieux : un café sous un bureau, deux commerces à 55 m l'un de
    // l'autre, un fleuriste.
    { type: "node", id: 28, lat: 45.87, lon: 4.97, tags: { amenity: "cafe", name: "Café Fictif" } },
    { type: "node", id: 29, lat: 45.88, lon: 4.98, tags: { shop: "bakery", name: "Boulangerie Fictive" } },
    { type: "node", id: 30, ...decale(45.88, 4.98, 0, 55), tags: { craft: "hairdresser", name: "Salon Fictif" } },
    { type: "node", id: 31, lat: 45.89, lon: 4.99, tags: { shop: "florist", name: "Fleurs Fictives" } },
    // Pour la précision et le lieu de vie : des commerces isolés.
    { type: "node", id: 50, lat: 45.91, lon: 4.71, tags: { shop: "florist", name: "Fleurs A" } },
    { type: "node", id: 51, lat: 45.92, lon: 4.72, tags: { shop: "bakery", name: "Pain B" } },
    { type: "node", id: 52, lat: 45.93, lon: 4.73, tags: { shop: "bakery", name: "Pain C" } },
    { type: "node", id: 53, lat: 45.94, lon: 4.74, tags: { shop: "bakery", name: "Pain D" } },
    { type: "node", id: 54, lat: 45.96, lon: 4.76, tags: { shop: "bakery", name: "Pain E" } },
    { type: "node", id: 55, ...decale(45.96, 4.76, 0, 55), tags: { craft: "hairdresser", name: "Salon E" } },
    { type: "node", id: 56, lat: 45.97, lon: 4.77, tags: { amenity: "cafe", name: "Café Midi" } },
    // Un centre commercial cartographié étage par étage : deux boutiques l'une
    // au-dessus de l'autre.
    chemin(57, carre(45.98, 4.78, 50), { shop: "mall", name: "Centre Étages" }),
    chemin(58, carre(45.98, 4.78, 10), { shop: "clothes", name: "Boutique Rez", level: "0" }),
    chemin(59, carre(45.98, 4.78, 10), { shop: "shoes", name: "Boutique Haut", level: "1" }),
    // Deux boutiques de 10 m, mitoyennes : le mur commun à 5 m au nord du point.
    chemin(60, (() => { const a = decale(45.99, 4.79, -5, -5); const b = decale(45.99, 4.79, 5, 5); return rectangle(a.lat, a.lon, b.lat, b.lon); })(), { shop: "bakery", name: "Boutique A" }),
    chemin(61, (() => { const a = decale(45.99, 4.79, 5, -5); const b = decale(45.99, 4.79, 15, 5); return rectangle(a.lat, a.lon, b.lat, b.lon); })(), { shop: "florist", name: "Boutique B" }),
  ],
};
const GARDES = 35; // sans le banc, les deux piscines de jardin et l'atelier fermé

test("catégories : ce que Rémy dira, et ce qu'il ignore", () => {
  assert.equal(c.categorie({ craft: "hairdresser" }).type, "coiffeur");
  assert.equal(c.categorie({ shop: "supermarket", name: "Hyper Fictif Drive" }).type, "drive");
  assert.equal(c.categorie({ leisure: "fitness_centre" }).type, "salle de sport");
  assert.equal(c.categorie({ shop: "something_rare" }).type, "commerce");
  assert.equal(c.categorie({ amenity: "bench" }), null);
  assert.equal(c.categorie({ shop: "vacant" }), null);
  assert.equal(c.categorie({ leisure: "swimming_pool" }), null, "une piscine sans nom : celle d'un jardin");
  assert.equal(c.categorie({ leisure: "swimming_pool", name: "Piscine des Pins", access: "private" }), null);
  assert.equal(c.categorie({ shop: "clothes", name: "Atelier", access: "no" }), null);
  assert.equal(c.categorie({ leisure: "swimming_pool", name: "Piscine municipale" }).type, "piscine");
  assert.equal(c.categorie({ amenity: "driving_school", name: "Drive Auto-école" }).type, "auto-école", "« drive » : seulement un supermarché");
  assert.equal(c.categorie({ amenity: "fast_food", name: "Burger Drive" }).type, "restauration rapide");
  const q = c.requeteOverpass("99");
  assert.match(q, /"ref:INSEE"="99"/);
  assert.match(q, /out geom;$/);
  assert.match(q, /nwr\["shop"\]\["access"!~"\^\(private\|no\)\$"\]\(area\.d\);/, "les lieux privés ne sont même pas téléchargés");
  assert.match(q, /nwr\["leisure"="swimming_pool"\]\["name"\]/, "les piscines sans nom non plus");
  assert.doesNotMatch(q, /\|swimming_pool\||\(swimming_pool\||\|swimming_pool\)/);
  assert.match(c.requeteOverpass("99", "out center;"), /out center;$/);
});

test("les contours : surfaces, trous, relations cassées, surfaces immenses", () => {
  const lire = (id) => c.lireElement(OVERPASS.elements.find((e) => e.id === id));
  assert.equal(lire(1).anneaux, null, "un nœud : un point");
  assert.equal(lire(2).anneaux.length, 1);
  assert.ok(Math.abs(lire(2).aire - 66.8 * 77.9) < 60, `aire du drive : ${lire(2).aire}`);
  const hopital = lire(20);
  assert.equal(hopital.anneaux.length, 2, "l'extérieur, recollé de deux morceaux, et le parc");
  assert.ok(Math.abs(hopital.aire - (200 * 200 - 80 * 80)) < 100, `aire de l'hôpital : ${hopital.aire}`);
  assert.equal(lire(21).anneaux, null, "un anneau ouvert : pas de contour");
  assert.equal(lire(21).demi, 0);
  assert.equal(lire(21).nom, null, "le centre de sa boîte ne dit pas où elle est : un point sans nom");
  assert.equal(lire(22).anneaux, null, "900 m : un point");
  assert.equal(lire(22).nom, null);
  assert.equal(lire(8).anneaux, null, "« out center » : un point");
  assert.equal(lire(8).nom, "Pharmacie du Mail", "« out center » d'un commerce : nommé");
  assert.equal(lire(58).niveau, "0");
  const trouCasse = { type: "relation", id: 62, bounds: { minlat: 45.599, minlon: 4.598, maxlat: 45.601, maxlon: 4.602 }, tags: { type: "multipolygon", amenity: "hospital", name: "H" },
    members: [{ type: "way", role: "outer", geometry: carre(45.6, 4.6, 100) }, { type: "way", role: "inner", geometry: carre(45.6, 4.6, 40).slice(0, 3) }] };
  assert.equal(c.lireElement(trouCasse).anneaux, null, "un trou qui ne se referme pas : tout le contour est refusé");
  const roleVide = { type: "relation", id: 63, tags: { type: "multipolygon", shop: "mall", name: "G" }, members: [{ type: "way", role: "", geometry: carre(45.6, 4.6, 30) }] };
  assert.equal(c.lireElement(roleVide).anneaux.length, 1, "un rôle vide compte comme extérieur");
  assert.equal(c.lireElement({ type: "way", id: 1, geometry: rectangle(45.7, 4.8, 45.71, 4.81).slice(0, 4), tags: { shop: "bakery" } }), null, "une ligne sans centre : rien");
  const a = lire(19).anneaux;
  assert.equal(c.dansLeContour(45.82, 4.92, a), true);
  const coin = decale(45.82, 4.92, 50, 50); // dans le rectangle englobant, hors de la cour
  assert.equal(c.dansLeContour(coin.lat, coin.lon, a), false);
  assert.ok(Math.abs(c.jusquAuMur(coin.lat, coin.lon, a) - 20.7) < 0.5);
});

test("sans base : rien d'inventé", () => {
  assert.equal(c.commerceProche(45.7, 4.8), null);
  assert.equal(c.etatCommerces().pret, false);
  assert.equal(fs.existsSync(c.cheminCommerces()), false, "lire ne crée pas la base");
});

test("le commerce où est Sam : tout près, ou dedans une grande surface — sinon rien", () => {
  const n = c.remplacerCommerces(OVERPASS.elements, { departements: ["99"] });
  assert.equal(n, GARDES, "le banc, la piscine de jardin, la piscine privée et l'atelier fermé sont écartés");
  const e = c.etatCommerces();
  assert.deepEqual(e.departements, ["99"]);
  assert.equal(e.format, c.FORMAT);
  assert.equal(e.aRefaire, false);
  assert.equal(c.commerceProche(45.70003, 4.80004).nom, "Salon Lumière");
  // Au fond du parking-magasin, loin de son centre : on est « dedans ».
  const drive = c.commerceProche(45.71005, 4.81095);
  assert.equal(drive.type, "drive");
  assert.equal(drive.distance, 0);
  assert.equal(c.libelleCommerce(drive), "Hyper Fictif Drive");
  // Dehors, à 10 m du mur, à 15 m près (le bruit du GPS) : encore le magasin ;
  // à 5 m près, non ; à 30 m, la maison d'en face : rien.
  assert.equal(c.commerceProche(45.71069, 4.8105, { precision: 15 })?.distance, 10, "la distance au mur, pas au centre");
  assert.equal(c.commerceProche(45.71069, 4.8105, { precision: 5 }), null, "à 5 m près, 10 m du mur : dehors");
  assert.equal(c.commerceProche(45.71087, 4.8105, { precision: 15 }), null, "à 30 m du mur : pas dans le magasin");
  // Le mur ouest est l'arête qui referme l'anneau.
  const ouest = decale(45.7103, 4.8100, 0, -10);
  assert.equal(c.commerceProche(ouest.lat, ouest.lon, { precision: 15 })?.distance, 10, "l'arête de fermeture compte");
  // Dans la galerie, à côté de la boulangerie : la boulangerie.
  assert.equal(c.commerceProche(45.72042, 4.82072).nom, "Au Bon Pain Fictif");
  // Dans la galerie, loin de toute boutique : la galerie.
  assert.equal(c.commerceProche(45.7201, 4.8213).nom, "Galerie des Lilas");
  // Dans le supermarché de la galerie : la plus petite surface.
  assert.equal(c.commerceProche(45.72075, 4.82025)?.nom, "Super S");
  assert.equal(c.libelleCommerce(c.commerceProche(45.7300, 4.83002)), "Forme Plus (salle de sport)");
  // À 33 m, seule à la ronde : encore elle. À 55 m : rien.
  assert.equal(c.commerceProche(45.7303, 4.83)?.nom, "Forme Plus");
  assert.equal(c.commerceProche(45.7305, 4.83), null);
  // Une surface sans nom compte quand on est dedans ; un point sans nom, jamais.
  assert.equal(c.libelleCommerce(c.commerceProche(45.75001, 4.85001)), "pharmacie (sans nom)");
  assert.equal(c.commerceProche(45.8100, 4.91), null, "devant la friterie sans nom, la boulangerie à 12 m : rien");
  assert.equal(c.commerceProche(45.81001, 4.91), null);
  assert.equal(c.commerceProche(45.76001, 4.86001).nom, "Pharmacie du Mail", "« out center » : un point");
  // Dans le jardin à la piscine, à côté de la piscine privée : rien.
  assert.equal(c.commerceProche(45.77, 4.87), null);
  assert.equal(c.commerceProche(45.7702, 4.8702), null);
  assert.equal(c.commerceProche(45.7710, 4.87101).nom, "Piscine municipale fictive");
  // Entre deux boutiques voisines : Rémy ne tranche pas.
  assert.equal(c.commerceProche(45.78015, 4.88), null, "boulangerie ou café ? Rien plutôt qu'un faux « sans doute »");
  assert.equal(c.commerceProche(45.69, 4.79), null, "loin de tout : rien");
});

test("le vrai contour : la maison à côté de l'école, le parc au milieu de l'hôpital", () => {
  assert.equal(c.commerceProche(45.82, 4.92)?.nom, "École Fictive");
  for (const m of [47, 60]) {
    const p = decale(45.82, 4.92, m, m); // dans le rectangle englobant, à 16,5 et 34 m de la cour
    assert.equal(c.commerceProche(p.lat, p.lon), null, `maison à ${m} m nord-est du centre`);
  }
  const aile = decale(45.83, 4.93, 70); // dans les bâtiments, entre le parc et la rue
  assert.equal(c.commerceProche(aile.lat, aile.lon)?.nom, "Hôpital Fictif");
  assert.equal(c.commerceProche(45.83, 4.93), null, "au milieu du parc, à 40 m des bâtiments");
  const parc = decale(45.83, 4.93, 30); // dans le parc, à 10 m des bâtiments
  const hopital = c.lireElement(OVERPASS.elements.find((e) => e.id === 20)).anneaux;
  assert.equal(c.dansLeContour(parc.lat, parc.lon, hopital), false);
  assert.ok(Math.abs(c.jusquAuMur(parc.lat, parc.lon, hopital) - 10) < 0.5, "le mur du trou compte");
  assert.equal(c.commerceProche(parc.lat, parc.lon, { precision: 15 }), null, "à 10 m d'un hôpital, dehors : pas à l'hôpital");
  const portail = decale(45.82, 4.92, 73); // à 2 m de la pointe nord de la cour
  assert.equal(c.commerceProche(portail.lat, portail.lon, { precision: 10 }), null, "devant l'école, dehors : la maison d'en face");
  const cassee = decale(45.84, 4.94, 60, 60);
  assert.equal(c.commerceProche(cassee.lat, cassee.lon), null, "un contour cassé n'est jamais « dedans »");
  const golf = decale(45.80, 4.90, 300);
  assert.equal(c.commerceProche(golf.lat, golf.lon), null, "900 m de golf : pas « au golf »");
});

test("dans un supermarché : lui, pas la boulangerie d'en face — sauf si la position est trop floue", () => {
  const p = decale(45.86, 4.96, 20); // à 5 m de la façade nord, la boulangerie à 17 m
  assert.equal(c.commerceProche(p.lat, p.lon)?.nom, "Supermarché du Pont");
  assert.equal(c.commerceProche(p.lat, p.lon, { precision: 10 })?.nom, "Supermarché du Pont");
  assert.equal(c.commerceProche(p.lat, p.lon, { precision: 30 }), null, "à 30 m près, dedans ou en face ? Rien");
  assert.equal(c.commerceProche(45.86, 4.96, { precision: 30 })?.nom, "Supermarché du Pont", "au milieu, 25 m de chaque mur : dedans à coup sûr");
  assert.equal(c.commerceProche(45.86, 4.96, { precision: 60 }), null, "une visite floue à 60 m : rien");
});

test("la boutique mitoyenne, et les étages d'un centre commercial", () => {
  const contreLeMur = decale(45.99, 4.79, 4); // dans A, à 1 m du mur commun
  assert.equal(c.commerceProche(contreLeMur.lat, contreLeMur.lon, { precision: 10 }), null, "A ou B ? Rien");
  const fond = decale(45.99, 4.79, -4); // dans A, à 9 m du mur commun
  assert.equal(c.commerceProche(fond.lat, fond.lon)?.nom, "Boutique A");
  assert.equal(c.commerceProche(45.98, 4.78)?.nom, "Centre Étages", "deux étages sous les pieds : seulement le bâtiment");
});

test("règle 2 : la marge de la précision, et la plus petite surface", () => {
  assert.equal(c.libelleCommerce(c.commerceProche(45.75, 4.85, { precision: 25 })), "pharmacie (sans nom)", "au centre, 15 m de chaque mur");
  assert.equal(c.commerceProche(45.75, 4.85, { precision: 31 }), null, "à 31 m près : peut-être dehors");
  const G = { lat: 45.7205, lon: 4.82075 };
  const avec = (nordPain) => [
    OVERPASS.elements.find((e) => e.id === 3),
    chemin(40, carre(G.lat, G.lon, 5), { shop: "kiosk", name: "Kiosque K" }),
    { type: "node", id: 41, ...decale(G.lat, G.lon, nordPain, -4), tags: { shop: "bakery", name: "Pain P" } },
  ];
  const sam = decale(G.lat, G.lon, -4, -2); // dans le kiosque, à 1 m de son mur
  try {
    c.remplacerCommerces(avec(-30), { departements: ["99"] });
    assert.equal(c.commerceProche(sam.lat, sam.lon)?.nom, "Kiosque K", "la plus petite surface");
    c.remplacerCommerces(avec(-11), { departements: ["99"] });
    assert.equal(c.commerceProche(sam.lat, sam.lon)?.nom, "Galerie des Lilas", "le kiosque ou la boulangerie à 7 m ? La galerie, sûrement");
  } finally {
    c.remplacerCommerces(OVERPASS.elements, { departements: ["99"] });
  }
});

test("fenêtre de recherche : est-ouest, et élargie par la précision", () => {
  const P = { lat: 45.95, lon: 4.75 };
  const n = (id, nord, est, nom, tags = { leisure: "fitness_centre" }) => ({ type: "node", id, ...decale(P.lat, P.lon, nord, est), tags: { ...tags, name: nom } });
  try {
    c.remplacerCommerces([n(1, 30, 0, "N30"), n(2, 0, 42, "E42")], { departements: ["99"] });
    assert.equal(c.commerceProche(P.lat, P.lon), null, "E42 vu à l'est : 12 m d'avance seulement");
    c.remplacerCommerces([n(1, 5, 0, "N5", { shop: "bakery" }), n(2, -52, 0, "S52", { shop: "bakery" })], { departements: ["99"] });
    assert.equal(c.commerceProche(P.lat, P.lon, { precision: 50 }), null, "à 50 m près, S52 est vu");
  } finally {
    c.remplacerCommerces(OVERPASS.elements, { departements: ["99"] });
  }
});

test("les seuils, un par un", () => {
  const P = { lat: 45.95, lon: 4.75 };
  const nord = (id, m, nom = `N${m}`) => ({ type: "node", id, ...decale(P.lat, P.lon, m), tags: { shop: "bakery", ...(nom ? { name: nom } : {}) } });
  const salle = (id, m) => ({ type: "node", id, ...decale(P.lat, P.lon, m), tags: { leisure: "fitness_centre", name: `N${m}` } });
  const sud = (id, m) => ({ type: "node", id, ...decale(P.lat, P.lon, -m), tags: { shop: "florist", name: `S${m}` } });
  const mur = (id, m, tags = { shop: "supermarket", name: "Super S" }) => {
    const a = decale(P.lat, P.lon, m, -30);
    const b = decale(P.lat, P.lon, m + 60, 30);
    return chemin(id, rectangle(a.lat, a.lon, b.lat, b.lon), tags);
  };
  const cas = (elements, attendu, opts, pourquoi) => {
    c.remplacerCommerces(elements, { departements: ["99"] });
    assert.equal(c.commerceProche(P.lat, P.lon, opts)?.nom ?? null, attendu, pourquoi);
  };
  try {
    cas([nord(1, 10), sud(2, 16)], null, {}, "10 m et 16 m : 6 m d'écart, ambigu");
    cas([nord(1, 10), sud(2, 19)], "N10", {}, "10 m et 19 m : 9 m d'écart");
    cas([nord(1, 15), sud(2, 24)], "N15", {}, "une boulangerie à 15 m, position précise");
    cas([nord(1, 17), sud(2, 30)], null, {}, "à 17 m d'une boulangerie, position précise : l'immeuble voisin");
    cas([nord(1, 18), sud(2, 29)], "N18", { precision: 10 }, "à 18 m, à 10 m près, 11 m d'avance");
    cas([nord(1, 18), sud(2, 27)], null, { precision: 10 }, "à 10 m près, 9 m d'avance ne suffisent pas");
    cas([nord(1, 22), sud(2, 32)], null, { precision: 10 }, "à 22 m : il faut 15 m d'avance");
    cas([nord(1, 22), sud(2, 38)], "N22", { precision: 10 }, "à 22 m, 16 m d'avance");
    cas([salle(1, 34)], "N34", {}, "une salle de sport seule, à 34 m");
    cas([nord(1, 34)], null, {}, "une boulangerie à 34 m : non");
    cas([salle(1, 36)], null, {}, "à 36 m : trop loin");
    cas([salle(1, 34), sud(2, 48)], null, {}, "à 34 m, le suivant à 48 m : 14 m d'avance, pas assez");
    cas([mur(1, 4)], "Super S", {}, "à 4 m de son mur, position précise");
    cas([mur(1, 6)], null, {}, "à 6 m de son mur, position précise : dehors");
    cas([mur(1, 14)], "Super S", { precision: 15 }, "à 14 m de son mur, à 15 m près");
    cas([mur(1, 16)], null, { precision: 15 }, "à 16 m de son mur");
    cas([mur(1, 3, { amenity: "school", name: "École E" })], null, { precision: 10 }, "à 3 m d'une cour d'école : la maison d'en face");
    cas([nord(1, 1, null), nord(2, 12, "N12")], null, {}, "un commerce sans nom plus près : ambigu");
    cas([nord(1, 10)], "N10", { precision: 30 }, "seul à la ronde, même à 30 m près");
    cas([nord(1, 10), sud(2, 35)], null, { precision: 30 }, "à 30 m près, 25 m d'avance ne suffisent pas");
    cas([nord(1, 10), sud(2, 45)], "N10", { precision: 30 }, "35 m d'avance");
    cas([nord(1, 5)], "N5", { precision: 50 }, "seul à la ronde, à 50 m près");
    cas([nord(1, 5)], null, { precision: 51 }, "plus floue que 50 m : rien");
  } finally {
    c.remplacerCommerces(OVERPASS.elements, { departements: ["99"] });
  }
});

test("une base importée avant ces règles : plus rien jusqu'au nouvel import, qui la refait à neuf", () => {
  // La base de la tour au 23/10 : l'ancien schéma, des rectangles gonflés, une
  // piscine privée nommée.
  c.fermerCommerces();
  for (const f of ["", "-wal", "-shm"]) fs.rmSync(c.cheminCommerces() + f, { force: true });
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
  const vieille = new DatabaseSync(c.cheminCommerces());
  vieille.exec(`
    CREATE TABLE meta (cle TEXT PRIMARY KEY, valeur TEXT);
    CREATE TABLE commerces (id INTEGER PRIMARY KEY, osm TEXT, nom TEXT, type TEXT NOT NULL, cle TEXT, lat REAL NOT NULL, lon REAL NOT NULL, demi REAL NOT NULL DEFAULT 0);
    CREATE VIRTUAL TABLE commerces_rt USING rtree(id, min_lat, max_lat, min_lon, max_lon);
    INSERT INTO meta VALUES ('departements', '99');
    INSERT INTO commerces VALUES (1, 'node/1', 'Salon Lumière', 'coiffeur', 'craft=hairdresser', 45.7, 4.8, 0);
    INSERT INTO commerces_rt VALUES (1, 45.7, 45.7, 4.8, 4.8);
    INSERT INTO commerces VALUES (2, 'way/10', 'Piscine des Pins', 'piscine', 'leisure=swimming_pool', 45.79, 4.89, 40);
    INSERT INTO commerces_rt VALUES (2, 45.7896, 45.7904, 4.8894, 4.8906);
  `);
  vieille.close();
  const e = c.etatCommerces();
  assert.equal(e.format, 1);
  assert.equal(e.aRefaire, true);
  assert.equal(c.commerceProche(45.79, 4.89), null, "la piscine privée de l'ancienne base");
  assert.equal(c.commerceProche(45.7, 4.8), null, "même le coiffeur : rien tant que la base n'est pas refaite");
  assert.equal(c.remplacerCommerces(OVERPASS.elements, { departements: ["99"] }), GARDES);
  assert.equal(c.etatCommerces().aRefaire, false, "un nouvel import la remet à jour");
  assert.equal(c.commerceProche(45.71005, 4.81095)?.nom, "Hyper Fictif Drive");
});

test("un import qui échoue garde l'ancienne base", () => {
  const avant = c.etatCommerces().commerces;
  assert.throws(() => c.remplacerCommerces([...OVERPASS.elements, { osm: "x/1", nom: "Cassé", type: "commerce", cle: "shop=x", lat: null, lon: 4.8, demi: 0 }]));
  assert.equal(c.etatCommerces().commerces, avant);
  assert.equal(c.etatCommerces().format, c.FORMAT);
  assert.equal(c.commerceProche(45.7, 4.8).nom, "Salon Lumière");
  assert.equal(c.commerceProche(45.71005, 4.81095)?.nom, "Hyper Fictif Drive", "les contours aussi");
});

test("la nuit : 3 h du matin couvert, c'est un logement", () => {
  const z = process.env.REMY_TZ;
  try {
    process.env.REMY_TZ = "Europe/Paris";
    const t = (s) => Date.parse(s);
    assert.equal(lieux.couvreLaNuit(t("2026-10-22T19:00:00Z"), t("2026-10-23T06:00:00Z")), true, "21 h → 8 h");
    assert.equal(lieux.couvreLaNuit(t("2026-10-22T23:00:00Z"), t("2026-10-23T02:00:00Z")), true, "1 h → 4 h");
    assert.equal(lieux.couvreLaNuit(t("2026-10-22T07:00:00Z"), t("2026-10-22T16:00:00Z")), false, "une journée de travail");
    assert.equal(lieux.couvreLaNuit(t("2026-10-22T18:00:00Z"), t("2026-10-22T23:00:00Z")), false, "une soirée qui finit à 1 h");
    assert.equal(lieux.couvreLaNuit(t("2026-10-20T02:00:00Z"), t("2026-10-22T00:00:00Z")), true, "deux jours (plus de 24 h)");
    assert.equal(lieux.couvreLaNuit(t("2026-10-21T22:30:00Z"), t("2026-10-22T00:30:00Z")), false, "0 h 30 → 2 h 30");
    assert.equal(lieux.couvreLaNuit(t("2026-10-21T18:00:00Z"), t("2026-10-22T00:30:00Z")), false, "20 h → 2 h 30");
    assert.equal(lieux.couvreLaNuit(t("2026-10-21T18:00:00Z"), t("2026-10-22T01:30:00Z")), true, "20 h → 3 h 30");
    assert.equal(lieux.couvreLaNuit(t("2026-10-22T01:30:00Z"), t("2026-10-22T07:00:00Z")), false, "3 h 30 → 9 h");
  } finally {
    process.env.REMY_TZ = z;
  }
});

const H = 3_600_000;
const lieuA = (lat, lon) => lieux.listerLieux().find((l) => Math.abs(l.lat - lat) < 1e-6 && Math.abs(l.lon - lon) < 1e-6);

test("un lieu sans nom devient « sans doute Salon Lumière (coiffeur) » — pas un logement, pas un lieu nommé", () => {
  const maintenant = Date.now();
  // Depuis 22 h hier, à côté de la salle de sport (la visite est ouverte) : on
  // y a dormi, ce n'est pas la salle.
  lieux.recevoir([{ type: "visite", id: "vN", arrivee: maintenant - 16 * H, lat: 45.73001, lon: 4.83001, precision: 10 }]);
  assert.equal(lieux.etat(maintenant).lieu.commerce, null);
  assert.doesNotMatch(lieux.noteLieux({ maintenant }), /sans doute Forme Plus/);
  lieux.recevoir([{ type: "visite", id: "v1", arrivee: maintenant - 20 * 60_000, lat: 45.70002, lon: 4.80002, precision: 30 }]);
  const v = lieux.vue(maintenant);
  assert.equal(v.commerces.pret, true);
  const coiffeur = v.lieux.find((l) => l.commerce?.type === "coiffeur");
  assert.ok(coiffeur, "le lieu du coiffeur");
  assert.equal(v.etat.lieu.commerce.nom, "Salon Lumière");
  const note = lieux.noteLieux({ maintenant, taches: ["Prendre rendez-vous coiffeur", "Appeler Lumière Électricité"] });
  assert.match(note, /En ce moment : sans doute Salon Lumière \(coiffeur\)/);
  assert.match(note, /« Prendre rendez-vous coiffeur »/, "la tâche liée au type du commerce");
  assert.doesNotMatch(note, /Électricité/, "un mot du nom supposé ne suffit pas");
  assert.match(note, /demande d'abord à Sam s'il y est vraiment/, "une supposition : Sam confirme avant de cocher");
  // Sans précision connue (-1 d'iOS) : pas de supposition.
  lieux.recevoir([{ type: "visite", id: "vX", arrivee: maintenant - 30 * H, depart: maintenant - 29.5 * H, lat: 45.91001, lon: 4.71, precision: -1 }]);
  assert.equal(lieux.journee(new Date(maintenant - 30 * H).toLocaleDateString("fr-CA", { timeZone: process.env.REMY_TZ })).find((x) => x.id === "vX").lieu.commerce, null);
  // Une nuit passée à côté de la salle de sport : c'est un logement, pas la salle.
  lieux.recevoir([{ type: "visite", id: "v0", arrivee: maintenant - 44 * H, depart: maintenant - 32 * H, lat: 45.73001, lon: 4.83001 }]);
  const logement = lieuA(45.73001, 4.83001);
  assert.ok(logement, "le lieu de la nuit");
  assert.equal(logement.commerce, null, "une nuit sur place : pas de « sans doute Forme Plus »");
  // Nommé par Sam : plus de supposition.
  lieux.nommer({ id: coiffeur.id, nom: "Mon coiffeur" });
  const apres = lieux.vue(maintenant).lieux.find((l) => l.id === coiffeur.id);
  assert.equal(apres.nom, "Mon coiffeur");
  assert.equal(apres.commerce, null);
});

test("au bureau, au-dessus d'un café : 4 h sur place, ce n'est pas le café", () => {
  const maintenant = Date.now();
  const arrivee = maintenant - 30 * H; // 8 h hier (dans le fuseau du test)
  const depart = maintenant - 21 * H; // 17 h
  assert.equal(lieux.couvreLaNuit(arrivee, depart), false, "pas une nuit : c'est la durée qui compte");
  lieux.recevoir([{ type: "visite", id: "vB", arrivee, depart, lat: 45.87001, lon: 4.97001, precision: 10 }]);
  assert.equal(lieuA(45.87001, 4.97001).commerce, null);
  assert.equal(c.commerceProche(45.87001, 4.97001, { precision: 10 })?.nom, "Café Fictif", "le café est bien là");
});

test("au bureau avec la pause de midi ailleurs : 4 h dans la journée, ce n'est pas le café", () => {
  const maintenant = Date.now();
  lieux.recevoir([
    { type: "visite", id: "vM1", arrivee: maintenant - 29 * H, depart: maintenant - 25.5 * H, lat: 45.97001, lon: 4.77, precision: 10 }, // 9 h – 12 h 30
    { type: "visite", id: "vM2", arrivee: maintenant - 24.5 * H, depart: maintenant - 21 * H, lat: 45.97001, lon: 4.77, precision: 10 }, // 13 h 30 – 17 h
  ]);
  assert.equal(lieuA(45.97001, 4.77).commerce, null);
});

test("lieu de vie : le seuil de 4 h, et une nuit courte", () => {
  const t = Date.now();
  lieux.recevoir([
    { type: "visite", id: "q1", arrivee: t - 5 * H, depart: t - 1.5 * H, lat: 45.92001, lon: 4.72, precision: 5 },
    { type: "visite", id: "q2", arrivee: t - 5 * H + 60_000, depart: t - 0.5 * H, lat: 45.93001, lon: 4.73, precision: 5 },
  ]);
  assert.equal(lieuA(45.92001, 4.72).commerce?.nom, "Pain B", "3 h 30 : encore la boulangerie");
  assert.equal(lieuA(45.93001, 4.73).commerce, null, "4 h 29 : un lieu de vie");
  assert.equal(lieux.couvreLaNuit(t - 13 * H, t - 10.5 * H), true, "1 h → 3 h 30 dans le fuseau du test");
  lieux.recevoir([{ type: "visite", id: "r1", arrivee: t - 13 * H, depart: t - 10.5 * H, lat: 45.94001, lon: 4.74, precision: 5 }]);
  assert.equal(lieuA(45.94001, 4.74).commerce, null, "2 h 30, mais à 3 h du matin");
});

test("la précision de chaque visite arrive jusqu'à la supposition", () => {
  const t = Date.now();
  lieux.recevoir([
    { type: "visite", id: "p1", arrivee: t - 3 * H, depart: t - 3 * H + 10 * 60_000, lat: 45.91001, lon: 4.71, precision: 60 },
    { type: "visite", id: "p2", arrivee: t - 20 * 60_000, lat: 45.91001, lon: 4.71, precision: 10 },
  ]);
  const j = lieux.journee();
  const p1 = j.find((v) => v.id === "p1");
  const p2 = j.find((v) => v.id === "p2");
  assert.equal(p1.lieu.commerce, null, "à 60 m près : rien");
  assert.equal(p2.lieu.commerce?.nom, "Fleurs A", "à 10 m près : le fleuriste");
  assert.equal(p1.lieu.id, p2.lieu.id, "même lieu");
  assert.equal(lieux.listerLieux().find((l) => l.id === p1.lieu.id).commerce, null, "le lieu : la précision de la visite qui l'a créé");
  const salon = decale(45.96, 4.76, 0, 54);
  lieux.recevoir([
    { type: "visite", id: "s1", arrivee: t - 6 * H, depart: t - 6 * H + 10 * 60_000, lat: 45.96001, lon: 4.76, precision: 10 },
    { type: "visite", id: "s2", arrivee: t - 30 * 60_000, lat: salon.lat, lon: salon.lon, precision: 60 },
  ]);
  const k = lieux.journee();
  assert.equal(k.find((v) => v.id === "s2").lieu.id, k.find((v) => v.id === "s1").lieu.id, "à 60 m près, rien ne dit que c'est un autre commerce");
  assert.equal(k.find((v) => v.id === "s2").lieu.commerce, null);
});

test("un départ perdu : la visite s'arrête à l'arrivée suivante, pas « maintenant »", () => {
  const maintenant = Date.now();
  lieux.recevoir([
    { type: "visite", id: "vP", arrivee: maintenant - 46 * H, lat: 45.76001, lon: 4.86001, precision: 10 }, // midi, avant-hier ; départ perdu
    { type: "visite", id: "vQ", arrivee: maintenant - 45 * H, depart: maintenant - 44.5 * H, lat: 45.69, lon: 4.79 },
  ]);
  assert.equal(lieuA(45.76001, 4.86001).commerce?.nom, "Pharmacie du Mail", "une heure à la pharmacie, pas 46");
});

test("la boulangerie et le coiffeur à 55 m : deux lieux, et chez le coiffeur, le coiffeur", () => {
  const maintenant = Date.now();
  const salon = decale(45.88, 4.98, 0, 54);
  lieux.recevoir([
    { type: "visite", id: "vF1", arrivee: maintenant - 26 * H, depart: maintenant - 26 * H + 10 * 60_000, lat: 45.88001, lon: 4.98, precision: 10 },
    { type: "visite", id: "vF2", arrivee: maintenant - 50 * 60_000, lat: salon.lat, lon: salon.lon, precision: 10 },
  ]);
  const boulangerie = lieuA(45.88001, 4.98);
  assert.equal(boulangerie.commerce?.nom, "Boulangerie Fictive");
  const chez = lieux.vue(maintenant).aujourdhui.find((v) => v.id === "vF2");
  assert.notEqual(chez.lieu.id, boulangerie.id, "pas rattaché au lieu de la boulangerie");
  assert.equal(chez.lieu.commerce?.nom, "Salon Fictif");
});

test("un lieu oublié : plus de supposition, et son départ ne le recrée pas", () => {
  const maintenant = Date.now();
  lieux.recevoir([{ type: "visite", id: "vO", arrivee: maintenant - 10 * 60_000, lat: 45.89001, lon: 4.99, precision: 10 }]);
  assert.equal(lieux.etat(maintenant).lieu.commerce?.nom, "Fleurs Fictives");
  lieux.supprimerLieu(lieux.etat(maintenant).lieu.id);
  assert.equal(lieux.etat(maintenant).lieu.commerce, null);
  const avant = lieux.listerLieux().length;
  lieux.recevoir([{ type: "visite", id: "vO", arrivee: maintenant - 10 * 60_000, depart: maintenant - 60_000, lat: 45.89001, lon: 4.99, precision: 10 }]);
  assert.equal(lieux.listerLieux().length, avant, "le départ ne recrée pas le lieu");
  const v = lieux.journee().find((x) => x.id === "vO");
  assert.equal(v.lieu.id, null);
  assert.equal(v.lieu.commerce, null);
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
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
  const bi = new DatabaseSync(path.join(autre, "commerces.db"));
  const contours = Number(bi.prepare("SELECT COUNT(*) AS n FROM commerces WHERE contour IS NOT NULL").get().n);
  bi.close();
  fs.rmSync(autre, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Base des commerces prête : ${GARDES} commerces`));
  assert.equal(contours, OVERPASS.elements.map(c.lireElement).filter((x) => x?.anneaux).length, "l'importeur garde les contours");
  // Une réponse coupée par Overpass (HTTP 200, « runtime error ») : refusée.
  const coupe = path.join(dossier, "coupe.json");
  fs.writeFileSync(coupe, JSON.stringify({ ...OVERPASS, remark: 'runtime error: Query timed out in "print" at line 9 after 901 seconds.' }));
  const refus = spawnSync(process.execPath, ["--no-warnings", script, "--fichier", coupe, "--departement", "99"], { env: { ...process.env, REMY_DATA_DIR: autre }, encoding: "utf8" });
  assert.equal(refus.status, 1);
  assert.match(refus.stderr, /runtime error/);
  const sans = spawnSync(process.execPath, ["--no-warnings", script, "--fichier", fichier], { env: { ...process.env, REMY_DATA_DIR: autre }, encoding: "utf8" });
  assert.equal(sans.status, 1);
  assert.match(sans.stderr, /indique --departement/);
});

test("l'importeur, en ligne : une réponse coupée → la sortie plus légère ; coupée aussi → l'ancienne base reste", async () => {
  const http = await import("node:http");
  const { spawn } = await import("node:child_process");
  const script = fileURLToPath(new URL("../scripts/commerces-importer.mjs", import.meta.url));
  const coupure = 'runtime error: Query timed out in "print" at line 9 after 901 seconds.';
  const lancer = async (repondre) => {
    const vues = [];
    const serveur = http.createServer((req, res) => {
      let corps = "";
      req.on("data", (x) => (corps += x));
      req.on("end", () => {
        const sortie = /out\+geom|out geom/.test(decodeURIComponent(corps.replace(/\+/g, " "))) ? "geom" : "center";
        vues.push(sortie);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(repondre(sortie)));
      });
    });
    await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
    const autre = fs.mkdtempSync(path.join(os.tmpdir(), "remy-commerces-net-"));
    const enfant = spawn(process.execPath, ["--no-warnings", script, "--departements", "99"], {
      env: { ...process.env, REMY_DATA_DIR: autre, REMY_OVERPASS_URL: `http://127.0.0.1:${serveur.address().port}/api/interpreter` },
    });
    let sortie = "";
    let erreurs = "";
    enfant.stdout.on("data", (x) => (sortie += x));
    enfant.stderr.on("data", (x) => (erreurs += x));
    const code = await new Promise((r) => enfant.on("close", r));
    serveur.close();
    fs.rmSync(autre, { recursive: true, force: true });
    return { code, vues, sortie, erreurs };
  };
  const deux = [OVERPASS.elements[0], OVERPASS.elements[4]];
  const a = await lancer((s) => (s === "geom" ? { elements: [OVERPASS.elements[0]], remark: coupure } : { elements: deux }));
  assert.equal(a.code, 0, a.erreurs);
  assert.deepEqual(a.vues, ["geom", "center"]);
  assert.match(a.sortie, /Base des commerces prête : 2 commerces/);
  const b = await lancer(() => ({ elements: deux, remark: coupure }));
  assert.equal(b.code, 1);
  assert.match(b.erreurs, /runtime error/);
  assert.match(b.erreurs, /l'ancienne base \(s'il y en a une\) est gardée/);
});
