// Construire la base d'adresses de la tour (lib/geocodage.js) à partir de la
// Base Adresse Nationale : données publiques, téléchargées une fois depuis
// adresse.data.gouv.fr pour les départements choisis. Ensuite, traduire une
// position en adresse se fait sur la tour, sans rien envoyer à personne.
//
//   node --no-warnings --env-file=%USERPROFILE%\.remy\remy.env %USERPROFILE%\.remy\app\scripts\geo-importer.mjs
//
// Départements : REMY_GEO_DEPARTEMENTS (« 69,01,38 ») dans remy.env, ou
// --departements 69,01. Hors ligne : --fichier adresses-69.csv(.gz) --departement 69.
// Un import complet remplace le précédent (à relancer une fois par mois).

import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";
import { Readable } from "node:stream";
import { importerBan, viderGeo, etatGeo, fermerGeo } from "../lib/geocodage.js";

const arg = (nom) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const VALIDE = /^(\d{2}|2A|2B|97\d)$/i;
const URL_BAN = (d) => `https://adresse.data.gouv.fr/data/ban/adresses/latest/csv/adresses-${d}.csv.gz`;

function lignesDe(flux, gz) {
  const source = gz ? flux.pipe(zlib.createGunzip()) : flux;
  return readline.createInterface({ input: source, crlfDelay: Infinity });
}

const fichier = arg("fichier");
let total = 0;
try {
  if (fichier) {
    const dep = arg("departement");
    if (!dep || !VALIDE.test(dep)) throw new Error("Avec --fichier, indique --departement (ex. 69).");
    viderGeo();
    total += await importerBan(lignesDe(fs.createReadStream(fichier), fichier.endsWith(".gz")), { departement: dep.toUpperCase() });
  } else {
    const deps = String(arg("departements") || process.env.REMY_GEO_DEPARTEMENTS || "")
      .split(",")
      .map((d) => d.trim().toUpperCase())
      .filter(Boolean);
    if (!deps.length) throw new Error("Aucun département : ajoute REMY_GEO_DEPARTEMENTS=69,01 dans remy.env (ou --departements 69,01).");
    const mauvais = deps.filter((d) => !VALIDE.test(d));
    if (mauvais.length) throw new Error(`Département illisible : ${mauvais.join(", ")}`);
    viderGeo();
    for (const d of deps) {
      process.stdout.write(`Département ${d} : téléchargement… `);
      const r = await fetch(URL_BAN(d.toLowerCase()), { signal: AbortSignal.timeout(10 * 60_000) });
      if (!r.ok) throw new Error(`BAN ${d} : réponse ${r.status}`);
      const n = await importerBan(lignesDe(Readable.fromWeb(r.body), true), { departement: d });
      total += n;
      console.log(`${n.toLocaleString("fr-FR")} adresses`);
    }
  }
  const e = etatGeo();
  console.log(`Base d'adresses prête : ${e.adresses.toLocaleString("fr-FR")} adresse${e.adresses > 1 ? "s" : ""} (${e.departements.join(", ")}).`);
} catch (err) {
  console.error(`Import interrompu : ${err.message}`);
  process.exitCode = 1;
} finally {
  fermerGeo();
}
