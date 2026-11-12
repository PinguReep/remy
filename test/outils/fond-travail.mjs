// Un travail de fond d'essai, bâti comme la réflexion de la nuit : il lit
// (trace « lecture »), appelle le modèle local, puis écrit son résultat d'un
// coup (fichier temporaire puis renommage, comme ecrireAtomique) et le trace
// (« ecrit »). Partagé par test/fond-cede.test.mjs et par le processus enfant
// qu'il arrête net (test/outils/fond-enfant.mjs). Données fictives.

import fs from "node:fs";

export const travailEssai = (provider, fichier) => async ({ jour } = {}) => {
  fs.appendFileSync(`${fichier}.etapes`, "lecture\n");
  const r = await provider.complete({ system: "Essai", prompt: `FOND : résume la journée du ${jour} (boutique de bougies)` });
  const tmp = `${fichier}.tmp`;
  fs.writeFileSync(tmp, `${jour} : ${r.text}`);
  fs.renameSync(tmp, fichier);
  fs.appendFileSync(`${fichier}.etapes`, "ecrit\n");
  return { ok: true };
};
