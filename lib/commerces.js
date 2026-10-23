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
// Prudence (23/10, premier import réel : des milliers de « piscines » privées
// sans nom, des écoles qui débordaient sur les immeubles voisins) : mieux vaut
// ne rien supposer qu'un faux « sans doute ».
const PROCHE_M = 20; // un commerce nommé à moins de 20 m : c'est sans doute lui…
const ECART_M = 8; // …si le suivant est au moins 8 m plus loin (sinon : ambigu)
const LOIN_M = 35; // jusqu'à 35 m, s'il est seul à la ronde…
const ECART_LOIN_M = 15; // …avec 15 m d'avance sur le suivant ; au-delà, plus rien
const MUR_M = 15; // une surface : à plus de 15 m de son mur, on n'y est pas
const PRECISION_MAX = 50; // une visite plus floue que 50 m : rien (sur de vraies données, à 65 m, une supposition sur deux était fausse)
const GRANDE_M = 400; // au-delà de 400 m de demi-diagonale (golf, zone entière) : un point
export const FORMAT = 4; // 3 : les surfaces gardent leur vrai contour (« out geom ») ; 4 : et leur étage
const M_LAT = 111_320; // mètres par degré de latitude
// Un point près duquel on peut être sans y être collé (salle, grande surface,
// station) ; les autres (boulangerie, coiffeur, restaurant) : au-delà de 8 m +
// 1,5 × la précision, c'est l'immeuble voisin.
const GRANDS =
  /^(shop=(supermarket|mall|department_store|doityourself|garden_centre|furniture|car)|leisure=(fitness_centre|sports_centre|stadium|swimming_pool|ice_rink|bowling_alley|water_park|climbing)|amenity=(cinema|hospital|school|college|university|marketplace|fuel|car_wash)|drive)$/;
// Des terrains (cour, parc, enclos) collés aux maisons : on y est dedans, jamais
// « à quelques mètres de leur mur ».
const TERRAINS = /^amenity=(school|kindergarten|childcare|college|university|hospital|clinic|place_of_worship|community_centre|townhall)$/;

let ouverte = null;
let cheminOuvert = null;

const TABLES = `
  CREATE TABLE IF NOT EXISTS commerces (
    id INTEGER PRIMARY KEY, osm TEXT, nom TEXT, type TEXT NOT NULL, cle TEXT,
    lat REAL NOT NULL, lon REAL NOT NULL, demi REAL NOT NULL DEFAULT 0, aire REAL, contour TEXT, niveau TEXT
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS commerces_rt USING rtree(id, min_lat, max_lat, min_lon, max_lon);
`;

export function baseCommerces({ creer = false } = {}) {
  const chemin = cheminCommerces();
  if (ouverte && cheminOuvert === chemin) return ouverte;
  fermerCommerces();
  if (!creer && !fs.existsSync(chemin)) return null;
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const b = new DatabaseSync(chemin);
  try {
    b.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS meta (cle TEXT PRIMARY KEY, valeur TEXT); ${TABLES}`);
  } catch (err) {
    try {
      b.close();
    } catch {}
    throw err;
  }
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

const formatDe = (b) => Number(b.prepare("SELECT valeur FROM meta WHERE cle = 'format'").get()?.valeur) || 1;

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
  // Privé (piscine d'une villa, club fermé) : pas un endroit où l'on « va ».
  if (/^(private|no)$/i.test(String(tags.access || ""))) return null;
  const nom = String(tags.name || tags.brand || "");
  // Une piscine sans nom, c'est presque toujours celle d'un jardin.
  if (tags.leisure === "swimming_pool" && !nom.trim()) return null;
  if (tags.craft === "hairdresser") return { type: "coiffeur", cle: "craft=hairdresser" };
  // Le drive d'un supermarché (pas l'auto-école « Drive », ni le fast-food).
  if (/\bdrive\b/i.test(nom) && /^(supermarket|convenience|outpost|general)$/.test(tags.shop || "")) return { type: "drive", cle: "drive" };
  if (tags.leisure && LOISIRS[tags.leisure]) return { type: LOISIRS[tags.leisure], cle: `leisure=${tags.leisure}` };
  if (tags.amenity && SERVICES[tags.amenity]) return { type: SERVICES[tags.amenity], cle: `amenity=${tags.amenity}` };
  if (tags.shop && tags.shop !== "no" && tags.shop !== "vacant") {
    return { type: BOUTIQUES[tags.shop] || "commerce", cle: `shop=${tags.shop}` };
  }
  if (tags.healthcare && SOINS[tags.healthcare]) return { type: SOINS[tags.healthcare], cle: `healthcare=${tags.healthcare}` };
  return null;
}

// La requête Overpass d'un département (« area » : sa limite administrative).
// `sortie` : « out geom; » (les nœuds avec leur position, les surfaces avec leur
// contour) ; « out center; » si le serveur refuse (des points seulement). Les
// lieux privés et les piscines sans nom restent chez OpenStreetMap.
export function requeteOverpass(departement, sortie = "out geom;") {
  const cle = (o) => Object.keys(o).join("|");
  const ouvert = `["access"!~"^(private|no)$"]`;
  const loisirs = Object.keys(LOISIRS).filter((k) => k !== "swimming_pool").join("|");
  return (
    `[out:json][timeout:900][maxsize:1073741824];\n` +
    `area["boundary"="administrative"]["admin_level"="6"]["ref:INSEE"="${departement}"]->.d;\n(\n` +
    `  nwr["shop"]${ouvert}(area.d);\n` +
    `  nwr["craft"="hairdresser"]${ouvert}(area.d);\n` +
    `  nwr["amenity"~"^(${cle(SERVICES)})$"]${ouvert}(area.d);\n` +
    `  nwr["leisure"~"^(${loisirs})$"]${ouvert}(area.d);\n` +
    `  nwr["leisure"="swimming_pool"]["name"]${ouvert}(area.d);\n` +
    `  nwr["healthcare"~"^(${cle(SOINS)})$"]${ouvert}(area.d);\n` +
    `);\n${sortie}`
  );
}

// --- Les contours ------------------------------------------------------------
// Un anneau : [lat, lon, lat, lon, …], sans répéter le premier point. Une
// surface : ses anneaux (extérieurs et trous), lus en pair-impair.

const arrondi = (x) => Math.round(x * 1e6) / 1e6; // 11 cm
const memePoint = (a, b) => a[0] === b[0] && a[1] === b[1];

// Une suite de { lat, lon } fermée → un anneau ; sinon null (une ligne, ou un
// contour incomplet).
function anneauDe(points) {
  if (!Array.isArray(points) || points.length < 4) return null;
  const pts = [];
  for (const p of points) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) return null;
    const q = [arrondi(p.lat), arrondi(p.lon)];
    if (!pts.length || !memePoint(pts.at(-1), q)) pts.push(q);
  }
  if (pts.length < 4 || !memePoint(pts[0], pts.at(-1))) return null;
  pts.pop();
  return pts.length >= 3 ? pts.flat() : null;
}

// Les chemins d'une relation (morceaux d'anneaux) mis bout à bout. Un anneau
// qui ne se referme pas : tout le contour est refusé (plutôt rien).
function assembler(chemins) {
  const reste = chemins.map((c) => (c || []).map((p) => (Number.isFinite(p?.lat) && Number.isFinite(p?.lon) ? [arrondi(p.lat), arrondi(p.lon)] : null)));
  if (reste.some((c) => c.length < 2 || c.includes(null))) return null;
  const anneaux = [];
  while (reste.length) {
    let a = reste.shift();
    while (!memePoint(a[0], a.at(-1))) {
      const fin = a.at(-1);
      const i = reste.findIndex((c) => memePoint(c[0], fin) || memePoint(c.at(-1), fin));
      if (i < 0) return null;
      const [c] = reste.splice(i, 1);
      a = a.concat((memePoint(c[0], fin) ? c : [...c].reverse()).slice(1));
    }
    const r = anneauDe(a.map(([lat, lon]) => ({ lat, lon })));
    if (!r) return null;
    anneaux.push(r);
  }
  return anneaux.length ? anneaux : null;
}

// Les anneaux d'un élément « out geom », ou null (un nœud, une ligne, un
// contour cassé, une relation qui n'est pas une surface).
function anneauxDe(e) {
  if (e.type === "way") {
    const r = anneauDe(e.geometry);
    return r ? { exterieurs: [r], trous: [] } : null;
  }
  if (e.type === "relation" && /^(multipolygon|boundary)$/.test(String(e.tags?.type || "")) && Array.isArray(e.members)) {
    const chemins = e.members.filter((m) => m?.type === "way");
    const exterieurs = assembler(chemins.filter((m) => m.role !== "inner").map((m) => m.geometry));
    if (!exterieurs) return null;
    const interieurs = chemins.filter((m) => m.role === "inner");
    const trous = interieurs.length ? assembler(interieurs.map((m) => m.geometry)) : [];
    return trous ? { exterieurs, trous } : null;
  }
  return null;
}

// Aire (m²) d'un anneau, dans un plan local autour de son premier point.
function aireAnneau(a) {
  const k = M_LAT * Math.cos((a[0] * Math.PI) / 180);
  let s = 0;
  for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) {
    s += (a[j + 1] - a[1]) * k * ((a[i] - a[0]) * M_LAT) - (a[i + 1] - a[1]) * k * ((a[j] - a[0]) * M_LAT);
  }
  return Math.abs(s) / 2;
}

// Le point est-il dans la surface ? (lancer de rayon, pair-impair : un trou
// n'est pas dedans).
export function dansLeContour(lat, lon, anneaux) {
  let dedans = false;
  for (const a of anneaux) {
    for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) {
      const yi = a[i];
      const yj = a[j];
      if (yi > lat !== yj > lat && lon < ((a[j + 1] - a[i + 1]) * (lat - yi)) / (yj - yi) + a[i + 1]) dedans = !dedans;
    }
  }
  return dedans;
}

// Distance (m) du point au mur le plus proche (dedans comme dehors).
export function jusquAuMur(lat, lon, anneaux) {
  const k = M_LAT * Math.cos((lat * Math.PI) / 180);
  let min = Infinity;
  for (const a of anneaux) {
    for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) {
      const ax = (a[j + 1] - lon) * k;
      const ay = (a[j] - lat) * M_LAT;
      const dx = (a[i + 1] - lon) * k - ax;
      const dy = (a[i] - lat) * M_LAT - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return min;
}

// Un élément Overpass → { osm, nom, type, cle, niveau, lat, lon, demi, aire,
// anneaux, limites } ou null. Un nœud est un point ; une surface (supermarché,
// galerie) garde son contour : on est « dedans » sans être au centre. Sans
// contour (« out center ») : un point, jamais « dedans ». Le centre de la boîte
// d'un site, d'une surface immense ou d'un contour cassé ne dit pas où elle est :
// un point sans nom, qui peut rendre un voisin ambigu sans jamais être la réponse.
export function lireElement(e) {
  const c = categorie(e?.tags);
  if (!c) return null;
  const nom = String(e.tags.name || e.tags.brand || "").trim().slice(0, 120) || null;
  const niveau = String(e.tags.level ?? "").trim().slice(0, 20) || null;
  const fiche = { osm: `${e.type || "?"}/${e.id ?? "?"}`, nom, type: c.type, cle: c.cle, niveau };
  const point = (lat, lon, anonyme = false) => ({ ...fiche, ...(anonyme ? { nom: null } : {}), lat, lon, demi: 0, aire: null, anneaux: null, limites: null });
  if (Number.isFinite(e.lat) && Number.isFinite(e.lon)) return point(e.lat, e.lon);
  const forme = anneauxDe(e);
  if (forme) {
    const anneaux = [...forme.exterieurs, ...forme.trous];
    const limites = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };
    for (const a of forme.exterieurs) {
      for (let i = 0; i < a.length; i += 2) {
        limites.minLat = Math.min(limites.minLat, a[i]);
        limites.maxLat = Math.max(limites.maxLat, a[i]);
        limites.minLon = Math.min(limites.minLon, a[i + 1]);
        limites.maxLon = Math.max(limites.maxLon, a[i + 1]);
      }
    }
    const lat = (limites.minLat + limites.maxLat) / 2;
    const lon = (limites.minLon + limites.maxLon) / 2;
    const demi = distance({ lat: limites.minLat, lon: limites.minLon }, { lat: limites.maxLat, lon: limites.maxLon }) / 2;
    if (demi > GRANDE_M) return point(lat, lon, true);
    const aire = forme.exterieurs.reduce((s, a) => s + aireAnneau(a), 0) - forme.trous.reduce((s, a) => s + aireAnneau(a), 0);
    return { ...fiche, lat, lon, demi, aire: Math.max(1, Math.round(aire)), anneaux, limites };
  }
  const b = e.bounds;
  if (e.center && Number.isFinite(e.center.lat) && Number.isFinite(e.center.lon)) return point(e.center.lat, e.center.lon);
  if (b && [b.minlat, b.maxlat, b.minlon, b.maxlon].every(Number.isFinite)) return point((b.minlat + b.maxlat) / 2, (b.minlon + b.maxlon) / 2, true);
  return null;
}

// Remplace toute la base par ces éléments, en une transaction : un import
// interrompu garde l'ancienne (tables comprises : une base d'un ancien format
// est refaite à neuf). Rend le nombre de commerces gardés.
export function remplacerCommerces(elements, { departements = [] } = {}) {
  const b = baseCommerces({ creer: true });
  const vus = new Set();
  let n = 0;
  b.exec("BEGIN");
  try {
    b.exec(`DROP TABLE IF EXISTS commerces; DROP TABLE IF EXISTS commerces_rt; ${TABLES}`);
    const ins = b.prepare("INSERT INTO commerces (osm, nom, type, cle, lat, lon, demi, aire, contour, niveau) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insR = b.prepare("INSERT INTO commerces_rt (id, min_lat, max_lat, min_lon, max_lon) VALUES (?, ?, ?, ?, ?)");
    for (const brut of elements) {
      const c = brut?.type && brut?.lat !== undefined && brut?.cle ? brut : lireElement(brut);
      if (!c || vus.has(c.osm)) continue; // une surface sur deux départements arrive deux fois
      vus.add(c.osm);
      const contour = c.anneaux?.length ? JSON.stringify(c.anneaux) : null;
      const r = ins.run(c.osm, c.nom, c.type, c.cle, c.lat, c.lon, contour ? c.demi || 0 : 0, contour ? c.aire ?? null : null, contour, c.niveau ?? null);
      const l = contour ? c.limites : null;
      if (l) insR.run(r.lastInsertRowid, l.minLat, l.maxLat, l.minLon, l.maxLon);
      else insR.run(r.lastInsertRowid, c.lat, c.lat, c.lon, c.lon);
      n++;
    }
    const meta = b.prepare("INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur");
    meta.run("departements", [...new Set(departements.map(String))].sort().join(","));
    meta.run("importe_a", String(Date.now()));
    meta.run("source", "OpenStreetMap (ODbL)");
    meta.run("format", String(FORMAT));
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
  const format = formatDe(b);
  return {
    pret: n > 0,
    commerces: n,
    departements: meta("departements") ? meta("departements").split(",") : [],
    importeA: meta("importe_a") ? Number(meta("importe_a")) : null,
    format,
    // Un import d'avant le 23/10 (lieux privés, rectangles au lieu des
    // contours) : plus aucune supposition tant qu'il n'est pas refait.
    aRefaire: n > 0 && format < FORMAT,
  };
}

// Le commerce où se trouve sans doute Sam, ou null — plutôt rien qu'une
// fausse supposition. `precision` : celle de la visite iOS (m) ; plus elle est
// floue, plus l'avance demandée sur le voisin est grande. Dans l'ordre :
//   1. le plus proche, s'il est nommé, à moins de 20 m et 8 m (ou la précision)
//      plus près que le suivant, nommé ou non — dans une grande surface, seuls
//      comptent ceux qui y sont ;
//   2. sinon, la plus petite surface dont Sam est dedans à coup sûr (le
//      supermarché plutôt que la galerie ; une surface sans nom compte ici) ;
//   3. sinon, le plus proche s'il est nommé, à moins de 35 m et 15 m (ou la
//      précision) plus près que le suivant.
// « Proche » : dedans une surface, ou à la précision de son mur (5 à 15 m ;
// jamais pour une cour d'école ou un hôpital) ; pour un petit commerce en
// point, à 8 m + 1,5 × la précision au plus. Plusieurs étages sous les pieds de
// Sam (centre commercial cartographié niveau par niveau) : seul le bâtiment.
// Une base d'avant ces règles ne donne rien (relu à chaque appel : l'importeur
// est un autre processus).
export function commerceProche(lat, lon, { precision = null } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const p = Number.isFinite(precision) && precision > 0 ? precision : 0;
  if (p > PRECISION_MAX) return null;
  const b = baseCommerces();
  if (!b || formatDe(b) < FORMAT) return null;
  const ecartProche = Math.max(ECART_M, p);
  const ecartLoin = Math.max(ECART_LOIN_M, p);
  // Assez loin pour voir le voisin qui rendrait la supposition ambiguë.
  const rayon = LOIN_M + ecartLoin;
  const dLat = rayon / M_LAT;
  const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const lignes = b
    .prepare(
      `SELECT c.* FROM commerces_rt r JOIN commerces c ON c.id = r.id
        WHERE r.max_lat >= ? AND r.min_lat <= ? AND r.max_lon >= ? AND r.min_lon <= ?`,
    )
    .all(lat - dLat, lat + dLat, lon - dLon, lon + dLon);
  let autour = [];
  for (const c of lignes) {
    let anneaux = null;
    try {
      anneaux = c.contour ? JSON.parse(c.contour) : null;
    } catch {}
    if (anneaux) {
      const mur = jusquAuMur(lat, lon, anneaux);
      const dedans = dansLeContour(lat, lon, anneaux);
      if (dedans || mur <= rayon) autour.push({ c, anneaux, dedans, d: dedans ? 0 : mur, profondeur: dedans ? mur : 0 });
    } else {
      const d = distance({ lat, lon }, c);
      if (d <= rayon) autour.push({ c, anneaux: null, dedans: false, d, profondeur: 0 });
    }
  }
  const etages = new Set(autour.filter((x) => (x.dedans || x.d <= PROCHE_M) && x.c.niveau != null).map((x) => x.c.niveau)).size > 1;
  if (etages) autour = autour.filter((x) => x.c.niveau == null);
  // Dedans « à coup sûr » : même décalé de la précision, Sam resterait à moins
  // de 15 m du mur — et rien hors d'elle (la boutique mitoyenne, le café contre
  // le mur) n'est plus près que l'avance demandée.
  const dedansSur = (x) =>
    x.dedans &&
    x.profondeur + MUR_M >= p &&
    autour.every((y) => y === x || (y.dedans && y.c.aire >= x.c.aire) || dansLeContour(y.c.lat, y.c.lon, x.anneaux) || y.d >= ecartProche);
  const dans = autour.filter(dedansSur).sort((a, b) => a.c.aire - b.c.aire)[0];
  const voisins = (
    dans
      ? autour.filter((x) => x !== dans && !(x.dedans && x.c.aire >= dans.c.aire) && dansLeContour(x.c.lat, x.c.lon, dans.anneaux))
      : autour
  ).sort((a, b) => a.d - b.d);
  const proche = (x, seuil) => {
    if (!x?.c.nom) return false;
    if (x.anneaux) return x.dedans || (!TERRAINS.test(x.c.cle) && x.d <= Math.min(seuil, MUR_M, Math.max(5, p)));
    return x.d <= seuil && (GRANDS.test(x.c.cle) || x.d <= 8 + 1.5 * Math.max(p, 5));
  };
  const net = (seuil, ecart) => {
    const [premier, second] = voisins;
    if (etages || !proche(premier, seuil)) return null;
    return !second || second.d - premier.d >= ecart ? premier : null;
  };
  const choix = net(PROCHE_M, ecartProche) || dans || net(LOIN_M, ecartLoin);
  if (!choix) return null;
  return { nom: choix.c.nom || null, type: choix.c.type, distance: Math.round(choix.d), osm: choix.c.osm };
}

// « Salon Lumière (coiffeur) » ; sans nom connu, « boulangerie (sans nom) ».
export function libelleCommerce(c) {
  if (!c) return null;
  if (c.nom) return c.nom.toLowerCase().includes(c.type) ? c.nom : `${c.nom} (${c.type})`;
  return `${c.type} (sans nom)`;
}
