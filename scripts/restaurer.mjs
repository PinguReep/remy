// Restauration d'une sauvegarde de Rémy (Lot 0, J0.1).
//
//   Vérifier seulement (rien n'est écrit) :
//     node --env-file=…\remy.env scripts\restaurer.mjs <archive> --verifier
//   Restaurer dans un dossier NEUF (par défaut, à côté de l'archive) :
//     node --env-file=…\remy.env scripts\restaurer.mjs <archive> [--vers <dossier>]
//   Restaurer EN PLACE (Rémy arrêté ; sauvegarde « avant-restauration » faite
//   d'abord ; la base actuelle est mise de côté, jamais effacée) :
//     node --env-file=…\remy.env scripts\restaurer.mjs <archive> --remplacer
//   Depuis le Spark (la plus récente, ou celle nommée), puis comme ci-dessus :
//     node --env-file=…\remy.env scripts\restaurer.mjs --depuis-spark [nom] [--verifier|--vers …|--remplacer]
//
// Dans le coffre, une restauration en place réécrit les fichiers de l'archive
// et ne supprime rien d'autre : une note ajoutée depuis reste là.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { lireArchive, restaurerFichiers, cleSauvegarde, sauvegarderRemy, destinations, EXTENSION } from "../lib/sauvegarde.js";
import { dossierCles } from "../lib/connaissances/chiffre.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    verifier: { type: "boolean", default: false },
    vers: { type: "string" },
    remplacer: { type: "boolean", default: false },
    "accepter-clair": { type: "boolean", default: false },
    "depuis-spark": { type: "boolean", default: false },
  },
});

const sortir = (msg) => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};

let archive = positionals[0];
if (values["depuis-spark"]) {
  // L'archive revient chiffrée sur la tour, à côté des copies locales ; elle
  // n'est lue qu'avec la clé, comme les autres.
  if (!process.env.REMY_SAUVEGARDES_SPARK) sortir("REMY_SAUVEGARDES_SPARK absente de remy.env : quel Spark ?");
  const { lireCible, telechargerDuSpark } = await import("../lib/sftp.js");
  try {
    archive = await telechargerDuSpark({
      cible: lireCible(process.env.REMY_SAUVEGARDES_SPARK),
      nom: positionals[0] || null,
      vers: path.join(destinations()[0].dossier, "depuis-spark"),
    });
  } catch (err) {
    sortir(`Récupération depuis le Spark impossible : ${err.message}`);
  }
  console.log(`Récupérée depuis le Spark : ${archive}`);
}
if (!archive) sortir("Indique l'archive à restaurer (fichier .remy-sauvegarde), ou --depuis-spark.");

let lu;
try {
  lu = lireArchive(fs.readFileSync(archive), { cle: cleSauvegarde(), accepterClair: values["accepter-clair"] });
} catch (err) {
  sortir(err.message);
}
const { manifeste, fichiers } = lu;
const compte = (p) => fichiers.filter((f) => f.chemin.startsWith(p + "/")).length;
console.log(`Archive valide : ${path.basename(archive)}`);
console.log(`  créée le ${manifeste.creeeA} sur ${manifeste.machine} (${manifeste.raison})`);
console.log(`  base : ${compte("base")} fichiers · coffre : ${compte("coffre")} fichiers · Motion : ${manifeste.motion}`);
if (values.verifier) process.exit(0);

if (!values.remplacer) {
  const vers = values.vers || path.join(path.dirname(path.resolve(archive)), path.basename(archive, EXTENSION) + "-restauree");
  try {
    const ecrits = restaurerFichiers(fichiers, { vers });
    console.log(`✅ ${ecrits.length} fichiers restaurés dans ${vers} — rien d'autre n'a été touché.`);
  } catch (err) {
    sortir(err.message);
  }
  process.exit(0);
}

// --- En place ---------------------------------------------------------------------
const store = await import("../lib/store.js");
const { coffre } = await import("../lib/coffre.js");
const base = store.dossierBase();
const port = process.env.PORT || 3000;
const enMarche = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) })
  .then(() => true)
  .catch(() => false);
if (enMarche) sortir(`Rémy tourne encore (port ${port}) : arrête la tâche planifiée « Rémy » d'abord.`);

try {
  const avant = await sauvegarderRemy({ raison: "avant-restauration" });
  console.log(`Sauvegarde de l'état actuel : ${avant.nom}`);
} catch (err) {
  sortir(`Sauvegarde de l'état actuel impossible, restauration annulée : ${err.message}`);
}
// La sauvegarde ci-dessus a ouvert la base SQLite : sous Windows, un dossier
// dont un fichier est ouvert ne se renomme pas.
(await import("../lib/db.js")).fermer();
if (fs.existsSync(base)) {
  const deCote = `${base}.avant-restauration-${Date.now()}`;
  fs.renameSync(base, deCote);
  console.log(`Base actuelle mise de côté : ${deCote}`);
}
const ecrits = restaurerFichiers(fichiers, { cibles: { base, coffre: coffre() || null, cles: dossierCles() } });
const cleDeCote = ecrits.find((e) => /conversations\.cle\.avant-restauration-/.test(e));
if (cleDeCote) console.log(`Clé des conversations actuelle mise de côté : ${cleDeCote} (celle de la sauvegarde va avec sa base).`);
console.log(`✅ ${ecrits.length} fichiers restaurés en place. Relance la tâche « Rémy ».`);
