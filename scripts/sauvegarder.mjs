// Sauvegarde de Rémy, à la main ou avant une mise à jour (Lot 0, J0.1).
//
// Sur la tour :
//   node --env-file=%USERPROFILE%\.remy\remy.env scripts\sauvegarder.mjs [--raison avant-maj]
//
// Lit la base, le coffre et Motion (lecture seule), écrit une archive chiffrée
// dans REMY_SAUVEGARDES, REMY_SAUVEGARDES_EXTERNE et sur le Spark
// (REMY_SAUVEGARDES_SPARK), relit chaque copie.
// Code de sortie : 0 si la copie locale est bonne (une copie externe ratée est
// signalée), 1 sinon — et 1 aussi sans copie hors de la tour avec
// --exiger-hors-tour (l'installeur, avant une mise à jour).

import { parseArgs } from "node:util";
import { sauvegarderRemy } from "../lib/sauvegarde.js";

const { values } = parseArgs({
  options: {
    raison: { type: "string", default: "manuelle" },
    // Avant une mise à jour : sans copie hors de la tour, on s'arrête.
    "exiger-hors-tour": { type: "boolean", default: false },
  },
});

try {
  const r = await sauvegarderRemy({ raison: values.raison });
  console.log(`Sauvegarde ${r.nom} — ${r.fichiers} fichiers, ${(r.taille / 1024).toFixed(0)} Ko, Motion : ${r.motion}`);
  for (const c of r.copies) console.log(`  ${c.ok ? "✅" : "❌"} ${c.nom} : ${c.ok ? c.fichier + (c.libre ? ` (${c.libre} libres)` : "") : c.erreur}`);
  const locale = r.copies.find((c) => c.nom === "locale");
  if (!locale?.ok) process.exit(1);
  if (r.copies.some((c) => !c.ok)) console.log("⚠️  Une copie a échoué : la sauvegarde n'existe pas en double.");
  if (!r.copies.some((c) => c.ok && c.horsTour)) {
    console.log("⚠️  Aucune copie hors de la tour : si elle meurt, la sauvegarde meurt avec elle.");
    if (values["exiger-hors-tour"]) process.exit(1);
  }
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
