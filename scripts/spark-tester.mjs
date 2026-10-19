// Teste l'accès de la tour au Spark (lecture, écriture, place libre) et,
// avec --enregistrer, inscrit la destination dans remy.env. Lancé par
// scripts\spark-relier.ps1 -Epingler, ou seul :
//
//   node scripts\spark-tester.mjs --cible remy-sauvegarde@192.168.1.51:/sauvegardes [--enregistrer]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { lireCible, etatDistant, executer, formatOctets, configSftp } from "../lib/sftp.js";
import { lireValeur, poserValeur, ecrireEnv } from "./env-tour.mjs";

const { values } = parseArgs({
  options: {
    cible: { type: "string" },
    enregistrer: { type: "boolean", default: false },
    fichier: { type: "string", default: path.join(os.homedir(), ".remy", "remy.env") },
  },
});
const sortir = (m) => {
  console.error(`❌ ${m}`);
  process.exit(1);
};

let cible;
try {
  cible = lireCible(values.cible);
} catch (err) {
  sortir(err.message);
}
const config = configSftp();
if (!fs.existsSync(config.cleSsh)) sortir(`clé SSH absente (${config.cleSsh}) : lance scripts\\spark-relier.ps1 d'abord.`);
if (!fs.existsSync(config.hotesConnus)) sortir(`empreinte du Spark pas épinglée (${config.hotesConnus}) : scripts\\spark-relier.ps1 -Epingler.`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "remy-spark-test-"));
try {
  const { libre, noms } = await etatDistant(cible);
  console.log(`✅ Spark joignable (${cible.utilisateur}@${cible.hote}:${cible.dossier}) : ${libre != null ? `${formatOctets(libre)} libres` : "place inconnue"}, ${noms.filter((n) => n.endsWith(".remy-sauvegarde")).length} archive(s).`);
  // Écriture, relecture, effacement d'un petit fichier.
  fs.writeFileSync(path.join(tmp, "essai"), "remy");
  const essai = `${cible.dossier}/.remy-essai-${process.pid}`;
  await executer(cible, [`put essai "${essai}"`, `get "${essai}" relu`, `rm "${essai}"`], { dossierLocal: tmp });
  if (fs.readFileSync(path.join(tmp, "relu"), "utf8") !== "remy") sortir("le fichier d'essai relu ne correspond pas.");
  console.log("✅ Écriture, relecture et effacement : OK.");
} catch (err) {
  sortir(`Spark : ${err.message}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (values.enregistrer) {
  if (!fs.existsSync(values.fichier)) sortir(`${values.fichier} introuvable.`);
  const texte = fs.readFileSync(values.fichier, "utf8");
  const avant = lireValeur(texte, "REMY_SAUVEGARDES_SPARK");
  if (avant === values.cible) console.log("ℹ️  Déjà inscrit dans remy.env.");
  else {
    ecrireEnv(values.fichier, poserValeur(texte, "REMY_SAUVEGARDES_SPARK", values.cible));
    console.log(`✅ remy.env : REMY_SAUVEGARDES_SPARK=${values.cible}${avant ? ` (avant : ${avant})` : ""}`);
  }
  console.log("   La prochaine sauvegarde (nuit, avant mise à jour, ou scripts\\sauvegarder.mjs) ira aussi sur le Spark.");
}
