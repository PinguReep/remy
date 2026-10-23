// Les commerces et lieux publics autour de Sam, SUR LA TOUR (Sam, 20/10 :
// « savoir si je suis au coiffeur ou au drive ») : un lieu sans nom devient
// « sans doute chez Salon Lumière (coiffeur) ». Aucune position ne sort.
//
// La base `<base>/commerces.db` est construite par scripts/commerces-importer.mjs
// à partir d'OpenStreetMap (données publiques, ODbL), une requête Overpass par
// département de REMY_GEO_DEPARTEMENTS : seule la liste des départements part,
// jamais une position. Index spatial R*Tree, comme les adresses.
//
// Sans base : null partout — rien d'inventé.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { dossierBase } from "./store.js";
import { distance } from "./geocodage.js";

const require = createRequire(import.meta.url);

export const cheminCommerces = () => path.join(dossierBase(), "commerces.db");
const RAYON_M = 60; // au-delà, ce n'est plus « là où est Sam »

let ouverte = null;
let cheminOuvert = null;

export function baseCommerces({ creer = false } = {}) {
  const chemin = cheminCommerces();
  if (ouverte && cheminOuvert === chemin) return ouverte;
  fermerCommerces();
  if (!creer && !fs.existsSync(chemin)) return null;
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const b = new DatabaseSync(chemin);
  b.exec(`
    PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS meta (cle TEXT PRIMARY KEY, valeur TEXT);
    CREATE TABLE IF NOT EXISTS commerces (
      id INTEGER PRIMARY KEY, osm TEXT, nom TEXT, type TEXT NOT NULL, cle TEXT,
      lat REAL NOT NULL, lon REAL NOT NULL, demi REAL NOT NULL DEFAULT 0
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS commerces_rt USING rtree(id, min_lat, max_lat, min_lon, max_lon);
  `);
  ouverte = b;
  cheminOuvert = chemin;
  return b;
}

export function fermerCommerces() {
  if (ouverte) {
    try {
      ouverte.close();
    } catch {}
  }
  ouverte = null;
  cheminOuvert = null;
}

// --- Ce qu'on garde d'OpenStreetMap ------------------------------------------
// Les endroits où l'on « va » : commerces, santé, sport, sorties, services.
// Le type est ce que Rémy dira (« coiffeur », « drive », « salle de sport »).

const BOUTIQUES = {
  hairdresser: "coiffeur", beauty: "institut de beauté", cosmetics: "parfumerie", supermarket: "supermarché",
  convenience: "supérette", bakery: "boulangerie", pastry: "pâtisserie", butcher: "boucherie", greengrocer: "primeur",
  cheese: "fromagerie", seafood: "poissonnerie", wine: "caviste", alcohol: "caviste", mall: "centre commercial",
  department_store: "grand magasin", clothes: "magasin de vêtements", shoes: "magasin de chaussures",
  doityourself: "magasin de bricolage", hardware: "quincaillerie", garden_centre: "jardinerie", car_repair: "garage",
  car: "concession automobile", car_parts: "pièces auto", tyres: "centre pneus", optician: "opticien", florist: "fleuriste",
  books: "librairie", tobacco: "bureau de tabac", newsagent: "marchand de journaux", mobile_phone: "boutique de téléphonie",
  electronics: "magasin d'électronique", computer: "magasin d'informatique", furniture: "magasin de meubles",
  pet: "animalerie", sports: "magasin de sport", laundry: "laverie", dry_cleaning: "pressing", chemist: "droguerie",
  jewelry: "bijouterie", toys: "magasin de jouets", bicycle: "magasin de vélos", gift: "boutique de cadeaux",
  variety_store: "bazar", frozen_food: "surgelés", deli: "traiteur", massage: "massage", tattoo: "tatoueur",
  travel_agency: "agence de voyages", kiosk: "kiosque", pharmacy: "pharmacie", outdoor: "magasin de plein air",
};
const SERVICES = {
  restaurant: "restaurant", cafe: "café", bar: "bar", pub: "bar", fast_food: "restauration rapide", ice_cream: "glacier",
  pharmacy: "pharmacie", bank: "banque", post_office: "bureau de poste", doctors: "médecin", dentist: "dentiste",
  clinic: "clinique", hospital: "hôpital", veterinary: "vétérinaire", cinema: "cinéma", theatre: "théâtre",
  library: "bibliothèque", fuel: "station-service", car_wash: "lavage auto", marketplace: "marché", townhall: "mairie",
  school: "école", kindergarten: "école maternelle", childcare: "crèche", college: "établissement d'enseignement",
  university: "université", place_of_worship: "lieu de culte", police: "commissariat", nightclub: "boîte de nuit",
  driving_school: "auto-école", community_centre: "salle municipale", coworking_space: "espace de coworking",
};
const LOISIRS = {
  fitness_centre: "salle de sport", sports_centre: "centre sportif", swimming_pool: "piscine", stadium: "stade",
  bowling_alley: "bowling", ice_rink: "patinoire", golf_course: "golf", climbing: "salle d'escalade",
  dance: "école de danse", escape_game: "escape game", water_park: "parc aquatique", amusement_arcade: "salle de jeux",
};
const SOINS = {
  physiotherapist: "kinésithérapeute", laboratory: "laboratoire d'analyses", optometrist: "optométriste",
  podiatrist: "podologue", psychotherapist: "psychothérapeute", speech_therapist: "orthophoniste",
};

export function categorie(tags = {}) {
  const nom = String(tags.name || tags.brand || "");
  if (/\bdrive\b/i.test(nom) && (tags.shop || tags.amenity)) return { type: "drive", cle: "drive" };
  if (tags.craft === "hairdresser") return { type: "coiffeur", cle: "craft=hairdresser" };
  if (tags.leisure && LOISIRS[tags.leisure]) return { type: LOISIRS[tags.leisure], cle: `leisure=${tags.leisure}` };
  if (tags.amenity && SERVICES[tags.amenity]) return { type: SERVICES[tags.amenity], cle: `amenity=${tags.amenity}` };
  if (tags.shop && tags.shop !== "no" && tags.shop !== "vacant") {
    return { type: BOUTIQUES[tags.shop] || "commerce", cle: `shop=${tags.shop}` };
  }
  if (tags.healthcare && SOINS[tags.healthcare]) return { type: SOINS[tags.healthcare], cle: `healthcare=${tags.healthcare}` };
  return null;
}

// La requête Overpass d'un département (« area » : sa limite administrative).
// `sortie` : « out bb; » (les nœuds avec leur position, les surfaces avec leurs
// limites) ; « out center; » si le serveur ne connaît pas « bb ».
export function requeteOverpass(departement, sortie = "out bb;") {
  const cle = (o) => Object.keys(o).join("|");
  return (
    `[out:json][timeout:900][maxsize:1073741824];\n` +
    `area["boundary"="administrative"]["admin_level"="6"]["ref:INSEE"="${departement}"]->.d;\n(\n` +
    `  nwr["shop"](area.d);\n` +
    `  nwr["craft"="hairdresser"](area.d);\n` +
    `  nwr["amenity"~"^(${cle(SERVICES)})$"](area.d);\n` +
    `  nwr["leisure"~"^(${cle(LOISIRS)})$"](area.d);\n` +
    `  nwr["healthcare"~"^(${cle(SOINS)})$"](area.d);\n` +
    `);\n${sortie}`
  );
}

// Un élément Overpass → { osm, nom, type, cle, lat, lon, demi } ou null.
// Un nœud a lat/lon ; une surface (supermarché, galerie) a ses limites
// (bounds) — son demi-côté compte : on est « dedans » sans être au centre.
export function lireElement(e) {
  const c = categorie(e?.tags);
  if (!c) return null;
  let lat;
  let lon;
  let demi = 0;
  if (Number.isFinite(e.lat) && Number.isFinite(e.lon)) {
    lat = e.lat;
    lon = e.lon;
  } else if (e.bounds && [e.bounds.minlat, e.bounds.maxlat, e.bounds.minlon, e.bounds.maxlon].every(Number.isFinite)) {
    const b = e.bounds;
    lat = (b.minlat + b.maxlat) / 2;
    lon = (b.minlon + b.maxlon) / 2;
    demi = Math.min(400, distance({ lat: b.minlat, lon: b.minlon }, { lat: b.maxlat, lon: b.maxlon }) / 2);
  } else if (e.center && Number.isFinite(e.center.lat) && Number.isFinite(e.center.lon)) {
    lat = e.center.lat;
    lon = e.center.lon;
  } else return null;
  const nom = String(e.tags.name || e.tags.brand || "").trim().slice(0, 120) || null;
  return { osm: `${e.type || "?"}/${e.id ?? "?"}`, nom, type: c.type, cle: c.cle, lat, lon, demi };
}

// Remplace toute la base par ces éléments, en une transaction : un import
// interrompu garde l'ancienne. Rend le nombre de commerces gardés.
export function remplacerCommerces(elements, { departements = [] } = {}) {
  const b = baseCommerces({ creer: true });
  const ins = b.prepare("INSERT INTO commerces (osm, nom, type, cle, lat, lon, demi) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insR = b.prepare("INSERT INTO commerces_rt (id, min_lat, max_lat, min_lon, max_lon) VALUES (?, ?, ?, ?, ?)");
  const vus = new Set();
  let n = 0;
  b.exec("BEGIN");
  try {
    b.exec("DELETE FROM commerces; DELETE FROM commerces_rt;");
    for (const brut of elements) {
      const c = brut?.type && brut?.lat !== undefined && brut?.cle ? brut : lireElement(brut);
      if (!c || vus.has(c.osm)) continue; // une surface sur deux départements arrive deux fois
      vus.add(c.osm);
      const r = ins.run(c.osm, c.nom, c.type, c.cle, c.lat, c.lon, c.demi);
      const dLat = c.demi / 111_320;
      const dLon = dLat / Math.max(0.2, Math.cos((c.lat * Math.PI) / 180));
      insR.run(r.lastInsertRowid, c.lat - dLat, c.lat + dLat, c.lon - dLon, c.lon + dLon);
      n++;
    }
    const meta = b.prepare("INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur");
    meta.run("departements", [...new Set(departements.map(String))].sort().join(","));
    meta.run("importe_a", String(Date.now()));
    meta.run("source", "OpenStreetMap (ODbL)");
    b.exec("COMMIT");
  } catch (err) {
    b.exec("ROLLBACK");
    throw err;
  }
  return n;
}

export function etatCommerces() {
  const b = baseCommerces();
  if (!b) return { pret: false, commerces: 0, departements: [] };
  const n = Number(b.prepare("SELECT COUNT(*) AS n FROM commerces").get().n);
  const meta = (k) => b.prepare("SELECT valeur FROM meta WHERE cle = ?").get(k)?.valeur;
  return {
    pret: n > 0,
    commerces: n,
    departements: meta("departements") ? meta("departements").split(",") : [],
    importeA: meta("importe_a") ? Number(meta("importe_a")) : null,
  };
}

// Le commerce où se trouve sans doute Sam : le plus proche à moins de 60 m
// (0 m si la position tombe dans une grande surface). À distance égale, une
// boutique nommée l'emporte sur la galerie qui la contient.
export function commerceProche(lat, lon, { rayon = RAYON_M } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const b = baseCommerces();
  if (!b) return null;
  const dLat = rayon / 111_320;
  const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const lignes = b
    .prepare(
      `SELECT c.* FROM commerces_rt r JOIN commerces c ON c.id = r.id
        WHERE r.max_lat >= ? AND r.min_lat <= ? AND r.max_lon >= ? AND r.min_lon <= ?`,
    )
    .all(lat - dLat, lat + dLat, lon - dLon, lon + dLon);
  let meilleur = null;
  for (const c of lignes) {
    const d = Math.max(0, distance({ lat, lon }, c) - c.demi);
    if (d > rayon) continue;
    const score = d + (c.nom ? 0 : 15) + Math.min(30, c.demi / 10);
    if (!meilleur || score < meilleur.score) meilleur = { score, c, d };
  }
  if (!meilleur) return null;
  return { nom: meilleur.c.nom || null, type: meilleur.c.type, distance: Math.round(meilleur.d), osm: meilleur.c.osm };
}

// « Salon Lumière (coiffeur) » ; sans nom connu, « boulangerie (sans nom) ».
export function libelleCommerce(c) {
  if (!c) return null;
  if (c.nom) return c.nom.toLowerCase().includes(c.type) ? c.nom : `${c.nom} (${c.type})`;
  return `${c.type} (sans nom)`;
}
