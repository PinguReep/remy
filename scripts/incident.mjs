// Un code d'erreur vu dans l'app (« R-7KQ2M ») : ce que la tour en sait.
// Jamais de contenu de message : l'étape, l'erreur technique, les durées, les
// tailles, le modèle. On peut le coller tel quel dans une conversation.
//
//   node --no-warnings --env-file=%USERPROFILE%\.remy\remy.env %USERPROFILE%\.remy\app\scripts\incident.mjs [R-7KQ2M]
//
// Sans code : les 10 derniers incidents.

import { lireIncident, derniersIncidents, codeValide } from "../lib/incidents.js";

const code = process.argv.slice(2).find((a) => !a.startsWith("-"));
if (code) {
  if (!codeValide(code)) {
    console.log("Code attendu : R- suivi de 5 caractères (ex. R-7KQ2M).");
    process.exit(2);
  }
  const e = lireIncident(code);
  if (!e) {
    console.log(`Incident ${code.toUpperCase()} inconnu sur cette tour (les 300 derniers sont gardés).`);
    process.exit(1);
  }
  console.log(JSON.stringify(e, null, 2));
} else {
  const liste = derniersIncidents(10);
  if (!liste.length) console.log("Aucun incident enregistré.");
  for (const e of liste) {
    console.log(`${e.code}  ${e.a}  ${String(e.type).padEnd(5)}  ${e.etape || e.route || ""}  ${e.erreur?.message || ""}`.slice(0, 200));
  }
}
