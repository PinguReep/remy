// La mémoire de projets vue depuis la tour, sans l'app : ce que Rémy a lu de
// tes sessions Claude Code (projets, sessions, passages, dernière lecture).
// Rien n'est modifié chez Claude Code. Le contenu des passages n'est jamais
// affiché : seulement des noms de projets, des dates et des comptes.
//
//   node --no-warnings --env-file=%USERPROFILE%\.remy\remy.env %USERPROFILE%\.remy\app\scripts\connaissances-etat.mjs [--lire]
//
// --lire : lit tout de suite les sessions accordées (sinon, Rémy le fait seul
// toutes les 30 minutes).

import * as sync from "../lib/connaissances/sync.js";

const date = (ms) => (ms ? new Date(ms).toLocaleString("fr-FR", { timeZone: process.env.REMY_TZ || "Europe/Paris" }) : "—");

if (process.argv.includes("--lire")) {
  if (!sync.sourceActive()) {
    console.log("Lecture non accordée : ajoute REMY_SOURCE_CLAUDE_CODE=on dans remy.env (ou active-la dans l'app).");
    process.exit(2);
  }
  const b = await sync.synchroniser();
  console.log(`Lecture : ${b.lus} session(s) lue(s), ${b.passages} passage(s) ajouté(s), ${b.masques} secret(s) masqué(s), ${b.exclus} exclue(s), ${b.horsFiltre} hors filtre, ${b.erreurs} erreur(s) — ${Math.round(b.duree / 100) / 10} s`);
}
const e = sync.etat();
const s = e.sources["claude-code"];
console.log(`Source Claude Code : ${s.actif ? "accordée" : "COUPÉE"}${s.forceParLaTour ? " (réglée dans remy.env)" : ""}, filtre de projets : ${s.filtre ? "oui" : "non (tous)"}`);
console.log(`Dernière lecture : ${s.derniereSync ? date(s.derniereSync.fin || s.derniereSync.debut) : "jamais"}`);
console.log(`Données non chiffrées sur le disque de la tour : ${e.chiffre ? "non" : "oui"}`);
if (!e.projets.length) console.log("Aucun projet lu pour l'instant.");
for (const p of e.projets) console.log(`  ${p.nom.padEnd(28)} ${String(p.sessions).padStart(4)} session(s) ${String(p.passages).padStart(6)} passage(s)   dernier : ${date(p.derniere)}`);
