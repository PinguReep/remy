// Construire la base des commerces de la tour (lib/commerces.js) à partir
// d'OpenStreetMap : une requête Overpass par département, une fois (à relancer
// chaque mois au plus). Seuls les numéros de département partent : jamais une
// position. Ensuite, reconnaître « le coiffeur » ou « le drive » se fait sur la
// tour, sans rien envoyer à personne.
//
//   node --no-warnings --env-file=%USERPROFILE%\.remy\remy.env %USERPROFILE%\.remy\app\scripts\commerces-importer.mjs
//
// Départements : REMY_GEO_DEPARTEMENTS (« 69,01,38 », les mêmes que les
// adresses) ou --departements 69,01. Serveur : REMY_OVERPASS_URL (défaut
// overpass-api.de). Hors ligne : --fichier export.json --departement 69 (une
// réponse Overpass au format JSON). Un import réussi remplace le précédent ;
// un import interrompu garde l'ancien.

import fs from "node:fs";
import { remplacerCommerces, etatCommerces, fermerCommerces, requeteOverpass, lireElement } from "../lib/commerces.js";

const arg = (nom) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const VALIDE = /^(\d{2}|2A|2B|97\d)$/i;
const OVERPASS = process.env.REMY_OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// Une requête, avec patience : les serveurs publics d'Overpass répondent 429
// ou 504 quand ils sont chargés. « out bb » d'abord ; « out center » si refusé.
async function telecharger(dep) {
  let derniere = null;
  for (const sortie of ["out bb;", "out center;"]) {
    for (let essai = 1; essai <= 4; essai++) {
      let r;
      try {
        r = await fetch(OVERPASS, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Remy-tour (import mensuel des commerces)" },
          body: new URLSearchParams({ data: requeteOverpass(dep, sortie) }),
          signal: AbortSignal.timeout(20 * 60_000),
        });
      } catch (err) {
        derniere = `réseau (${err.message})`;
        await attendre(30_000 * essai);
        continue;
      }
      if (r.ok) {
        const j = await r.json();
        if (j?.remark && !j.elements?.length) throw new Error(`Overpass ${dep} : ${String(j.remark).slice(0, 200)}`);
        return j.elements || [];
      }
      derniere = `réponse ${r.status}`;
      if (r.status === 400) break; // requête refusée : on essaie l'autre sortie
      if (r.status === 429 || r.status >= 500) {
        await attendre(60_000 * essai);
        continue;
      }
      throw new Error(`Overpass ${dep} : ${derniere}`);
    }
  }
  throw new Error(`Overpass ${dep} : ${derniere || "pas de réponse"}`);
}

function bilan(elements) {
  const parType = new Map();
  for (const e of elements) {
    const c = lireElement(e);
    if (c) parType.set(c.type, (parType.get(c.type) || 0) + 1);
  }
  return [...parType].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => `${n} ${t}`).join(", ");
}

const fichier = arg("fichier");
try {
  const tous = [];
  const deps = [];
  if (fichier) {
    const dep = arg("departement");
    if (!dep || !VALIDE.test(dep)) throw new Error("Avec --fichier, indique --departement (ex. 69).");
    const j = JSON.parse(fs.readFileSync(fichier, "utf8"));
    tous.push(...(j.elements || []));
    deps.push(dep.toUpperCase());
  } else {
    const liste = String(arg("departements") || process.env.REMY_GEO_DEPARTEMENTS || "")
      .split(",")
      .map((d) => d.trim().toUpperCase())
      .filter(Boolean);
    if (!liste.length) throw new Error("Aucun département : ajoute REMY_GEO_DEPARTEMENTS=69,01 dans remy.env (ou --departements 69,01).");
    const mauvais = liste.filter((d) => !VALIDE.test(d));
    if (mauvais.length) throw new Error(`Département illisible : ${mauvais.join(", ")}`);
    for (const d of liste) {
      process.stdout.write(`Département ${d} : demande à OpenStreetMap (quelques minutes)… `);
      const elements = await telecharger(d);
      if (!elements.length) throw new Error(`Overpass ${d} : aucun élément (département inconnu ?)`);
      console.log(`${elements.length.toLocaleString("fr-FR")} éléments — ${bilan(elements)}`);
      tous.push(...elements);
      deps.push(d);
    }
  }
  const n = remplacerCommerces(tous, { departements: deps });
  const e = etatCommerces();
  console.log(`Base des commerces prête : ${n.toLocaleString("fr-FR")} commerce${n > 1 ? "s" : ""} et lieux publics (${e.departements.join(", ")}). Données © les contributeurs d'OpenStreetMap (ODbL).`);
} catch (err) {
  console.error(`Import interrompu : ${err.message} — l'ancienne base (s'il y en a une) est gardée.`);
  process.exitCode = 1;
} finally {
  fermerCommerces();
}
