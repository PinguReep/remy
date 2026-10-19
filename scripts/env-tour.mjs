// remy.env (réglages et secrets de la tour) : lecture et écriture sûres.
// L'écriture passe par un fichier temporaire renommé (jamais de fichier à
// moitié écrit), puis remet les droits « Sam seul » que l'installeur avait
// posés — un renommage sous Windows reprend sinon ceux du dossier.

import fs from "node:fs";
import { spawnSync } from "node:child_process";

export const lireValeur = (texte, cle) => (texte.match(new RegExp(`^${cle}=([^\\r\\n]*)$`, "m")) || [])[1]?.trim() || "";

export const poserValeur = (texte, cle, v) =>
  new RegExp(`^${cle}=`, "m").test(texte)
    ? texte.replace(new RegExp(`^${cle}=[^\\r\\n]*$`, "m"), () => `${cle}=${v}`)
    : `${texte.trimEnd()}\n${cle}=${v}\n`;

export function ecrireEnv(fichier, texte) {
  const tmp = `${fichier}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, texte, { mode: 0o600 });
    fs.renameSync(tmp, fichier);
  } finally {
    // Un renommage raté ne laisse pas traîner une copie des secrets.
    fs.rmSync(tmp, { force: true });
  }
  if (process.platform === "win32" && process.env.USERNAME) {
    const r = spawnSync("icacls", [fichier, "/inheritance:r", "/grant:r", `${process.env.USERNAME}:(R,W)`], { stdio: "ignore" });
    if (r.status !== 0) console.warn(`⚠️  Droits de ${fichier} non restreints (icacls) : relance l'installeur pour les reposer.`);
  }
}
