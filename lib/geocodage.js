// Traduire une position en adresse, SUR LA TOUR (Sam, 20/10 : « adresses
// traduites localement ») : aucune coordonnée ne part chez Apple ni ailleurs.
//
// La base `<base>/geo.db` est construite une fois par scripts/geo-importer.mjs
// à partir de la Base Adresse Nationale (données publiques, data.gouv.fr), pour
// les départements de REMY_GEO_DEPARTEMENTS. Index spatial R*Tree : l'adresse
// la plus proche se trouve en quelques millisecondes.
//
// Sans base : null partout, et l'app dit « adresse inconnue » — rien d'inventé.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { dossierBase } from "./store.js";

const require = createRequire(import.meta.url);

export const cheminGeo = () => path.join(dossierBase(), "geo.db");
const RAYON_MAX_M = 150; // au-delà, ce n'est plus « l'adresse » de la position

let ouverte = null;
let cheminOuvert = null;

export function baseGeo({ creer = false } = {}) {
  const chemin = cheminGeo();
  if (ouverte && cheminOuvert === chemin) return ouverte;
  fermerGeo();
  if (!creer && !fs.existsSync(chemin)) return null;
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const b = new DatabaseSync(chemin);
  b.exec(`
    PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS meta (cle TEXT PRIMARY KEY, valeur TEXT);
    CREATE TABLE IF NOT EXISTS adresses (
      id INTEGER PRIMARY KEY, numero TEXT, voie TEXT, cp TEXT, commune TEXT, lat REAL NOT NULL, lon REAL NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS adresses_rt USING rtree(id, min_lat, max_lat, min_lon, max_lon);
  `);
  ouverte = b;
  cheminOuvert = chemin;
  return b;
}

export function fermerGeo() {
  if (ouverte) {
    try {
      ouverte.close();
    } catch {}
  }
  ouverte = null;
  cheminOuvert = null;
}

// Distance en mètres (haversine).
export function distance(a, b) {
  const R = 6_371_000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// « 12 Rue de la République, 69001 Lyon », ou null (pas de base, ou
// rien à moins de 150 m).
export function adresseProche(lat, lon) {
  const b = baseGeo();
  if (!b) return null;
  const d = 0.0015; // ≈ 165 m en latitude
  const lignes = b
    .prepare(
      `SELECT a.numero, a.voie, a.cp, a.commune, a.lat, a.lon FROM adresses_rt r JOIN adresses a ON a.id = r.id
        WHERE r.min_lat >= ? AND r.max_lat <= ? AND r.min_lon >= ? AND r.max_lon <= ?`,
    )
    .all(lat - d, lat + d, lon - d * 1.4, lon + d * 1.4);
  let meilleure = null;
  let dMin = Infinity;
  for (const l of lignes) {
    const m = distance({ lat, lon }, l);
    if (m < dMin) {
      dMin = m;
      meilleure = l;
    }
  }
  if (!meilleure || dMin > RAYON_MAX_M) return null;
  const rue = [meilleure.numero, meilleure.voie].filter(Boolean).join(" ");
  return `${rue}, ${[meilleure.cp, meilleure.commune].filter(Boolean).join(" ")}`;
}

export function etatGeo() {
  const b = baseGeo();
  if (!b) return { pret: false, adresses: 0, departements: [] };
  const n = Number(b.prepare("SELECT COUNT(*) AS n FROM adresses").get().n);
  const deps = b.prepare("SELECT valeur FROM meta WHERE cle = 'departements'").get()?.valeur;
  const quand = b.prepare("SELECT valeur FROM meta WHERE cle = 'importe_a'").get()?.valeur;
  return { pret: n > 0, adresses: n, departements: deps ? deps.split(",") : [], importeA: quand ? Number(quand) : null };
}

// --- Import (scripts/geo-importer.mjs) --------------------------------------

// Une ligne CSV de la BAN (séparateur « ; », guillemets possibles).
function champs(ligne) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (q) {
      if (c === '"' && ligne[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ";") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// Importe un flux de lignes CSV de la BAN (en-tête compris). Rend le nombre
// d'adresses ajoutées. `lignes` : itérable asynchrone de chaînes.
export async function importerBan(lignes, { departement = null } = {}) {
  const b = baseGeo({ creer: true });
  let entete = null;
  let n = 0;
  const insA = b.prepare("INSERT INTO adresses (numero, voie, cp, commune, lat, lon) VALUES (?, ?, ?, ?, ?, ?)");
  const insR = b.prepare("INSERT INTO adresses_rt (id, min_lat, max_lat, min_lon, max_lon) VALUES (?, ?, ?, ?, ?)");
  b.exec("BEGIN");
  try {
    for await (const brute of lignes) {
      const ligne = String(brute).replace(/\r$/, "");
      if (!ligne) continue;
      if (!entete) {
        entete = Object.fromEntries(champs(ligne).map((c, i) => [c.trim(), i]));
        if (!("lat" in entete && "lon" in entete && "nom_voie" in entete)) throw new Error("En-tête BAN inattendu (lat, lon, nom_voie)");
        continue;
      }
      const c = champs(ligne);
      const lat = Number(c[entete.lat]);
      const lon = Number(c[entete.lon]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const numero = [c[entete.numero], c[entete.rep]].filter(Boolean).join("");
      const r = insA.run(numero || null, c[entete.nom_voie] || null, c[entete.code_postal] || null, c[entete.nom_commune] || null, lat, lon);
      insR.run(r.lastInsertRowid, lat, lat, lon, lon);
      n++;
      if (n % 50_000 === 0) {
        b.exec("COMMIT");
        b.exec("BEGIN");
      }
    }
    if (departement) {
      const deja = b.prepare("SELECT valeur FROM meta WHERE cle = 'departements'").get()?.valeur;
      const deps = new Set([...(deja ? deja.split(",") : []), String(departement)]);
      b.prepare("INSERT INTO meta (cle, valeur) VALUES ('departements', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run([...deps].sort().join(","));
    }
    b.prepare("INSERT INTO meta (cle, valeur) VALUES ('importe_a', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(String(Date.now()));
    b.exec("COMMIT");
  } catch (err) {
    b.exec("ROLLBACK");
    throw err;
  }
  return n;
}

// Repartir de zéro (avant un nouvel import complet).
export function viderGeo() {
  const b = baseGeo({ creer: true });
  b.exec("DELETE FROM adresses; DELETE FROM adresses_rt; DELETE FROM meta;");
}
