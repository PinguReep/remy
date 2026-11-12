// Processus enfant de test/fond-cede.test.mjs : un Rémy réduit à sa file de
// jobs, qui lance un travail de fond vers le faux modèle lent, puis, sur
// ordre du parent, cède la place à une mise à jour (comme POST
// /api/maj-auto/ceder) et dit son occupation. Le parent l'arrête alors net
// (comme l'installeur arrête node) et vérifie que la base reste cohérente.
//
// Environnement : REMY_DATA_DIR, REMY_GLM_URL, FICHIER_ESSAI.

console.log = () => {};
console.warn = () => {};
console.error = () => {};

const jobs = await import("../../lib/jobs.js");
const { glmProvider } = await import("../../lib/providers.js");
const { occupation } = await import("../../lib/maj-auto-serveur.js");
const { travailEssai } = await import("./fond-travail.mjs");

jobs.enregistrer("essai-coupe", { circuit: "syntheses", maxTentatives: 2, executer: travailEssai(glmProvider, process.env.FICHIER_ESSAI) });
jobs.planifier("essai-coupe", { cle: "essai-coupe:2026-11-12", entree: { jour: "2026-11-12" } });

process.on("message", async (m) => {
  if (m === "ceder") {
    const { repos } = await jobs.cederPourMiseAJour({ reposMs: 3_000 });
    process.send({ repos, occupation: occupation(), job: jobs.jobParCle("essai-coupe:2026-11-12") });
  }
});
process.send("pret");
jobs.passer().catch(() => {});
