// Faux installer-tour.ps1 pour l'essai de la mise à jour automatique (Linux) :
// mêmes paramètres, même contrat (code 0 : installé ; raison d'un arrêt dans
// installeur-raison.txt), mais un simple `git checkout` de la copie.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const a = process.argv.slice(2);
const ref = a[a.indexOf("-Ref") + 1];
const retour = a.includes("-Retour");
fs.appendFileSync(process.env.FAUX_INSTALLEUR_TRACE, `${ref}${a.includes("-Auto") ? " -Auto" : ""}${retour ? " -Retour" : ""}\n`);
if (process.env.FAUX_INSTALLEUR_ARRET === "1" && !retour) {
  fs.writeFileSync(path.join(process.env.REMY_MAJ_DIR, "installeur-raison.txt"), "Sauvegarde avant mise à jour impossible ou sans copie hors de la tour : rien n'a été changé. (essai)");
  process.exit(1);
}
const r = spawnSync("git", ["-C", process.env.REMY_MAJ_APP, "checkout", "--quiet", "--force", "--detach", ref]);
process.exit(r.status ?? 1);
