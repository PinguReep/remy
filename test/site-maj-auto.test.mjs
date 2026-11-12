// Réglages › Diagnostic : la ligne « Mise à jour automatique » (maj-auto-v1),
// ce qu'elle dit dans chaque cas, et la recherche qui la retrouve.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";

const magasin = new Map();
globalThis.localStorage = {
  getItem: (k) => (magasin.has(k) ? magasin.get(k) : null),
  setItem: (k, v) => magasin.set(k, String(v)),
  removeItem: (k) => magasin.delete(k),
  clear: () => magasin.clear(),
};
const V = await import("../public/app/vues/reglages.js");
const R = await import("../public/app/analyse/recherche-reglages.js");
const N = await import("../public/app/nouveautes.js");

const T = Date.parse("2026-11-12T15:00:00+01:00");

test("la ligne : activée, en pause, désactivée, coupée — et la dernière mise à jour", () => {
  const derniere = { commit: "abc1234", date: "2026-11-12T10:05:00+01:00", resultat: "reussie" };
  assert.equal(V.phraseMajAuto({ active: true, derniere }, T), "Mise à jour automatique : activée — dernière : abc1234, aujourd'hui 10:05, réussie");
  assert.equal(V.phraseMajAuto({ active: true, pause: true, derniere: { ...derniere, resultat: "annulee", raison: "/api/version ne répond pas", date: "2026-11-11T09:00:00+01:00" } }, T),
    "Mise à jour automatique : en pause — dernière : abc1234, hier 09:00, annulée (/api/version ne répond pas)");
  assert.equal(V.phraseMajAuto({ active: true }, T), "Mise à jour automatique : activée — aucune encore");
  assert.equal(V.phraseMajAuto({ active: false }, T), "Mise à jour automatique : désactivée");
  assert.equal(V.phraseMajAuto({ active: true, coupeeParLaTour: true }, T), "Mise à jour automatique : coupée sur la tour — aucune encore");
  assert.equal(V.phraseMajAuto(null), "Mise à jour automatique : état inconnu");
});

test("le détail dit ce qui se passe, ou quoi faire", () => {
  assert.match(V.detailMajAuto({ active: false }, T), /PowerShell administrateur, installer-tour\.ps1 -MiseAJourAuto/);
  assert.match(V.detailMajAuto({ active: true, coupeeParLaTour: true }, T), /REMY_MAJ_AUTO=off/);
  assert.equal(V.detailMajAuto({ active: true, pause: true, pauseDepuis: "2026-11-12T14:00:00+01:00" }, T), "En pause depuis aujourd'hui 14:00 : rien n'est installé.");
  assert.match(V.detailMajAuto({ active: true, retard: true, dernierePasse: "2026-11-12T09:00:00+01:00" }, T), /pas passée depuis aujourd'hui 09:00/);
  assert.equal(V.detailMajAuto({ active: true, message: "À jour : abc1234 est le dernier commit de main.", dernierePasse: "2026-11-12T14:50:00+01:00" }, T),
    "À jour : abc1234 est le dernier commit de main. (passage : aujourd'hui 14:50)");
  assert.equal(V.detailMajAuto({ active: true, intervalleMin: 15 }, T), "Premier passage dans 15 min au plus.");
  assert.match(V.detailMajAuto({ active: true, occupeLongtemps: true, occupeDepuis: "2026-11-12T07:00:00+01:00" }, T), /occupé sans relâche depuis aujourd'hui 07:00/);
  assert.match(V.detailMajAuto({ active: true, occupeLongtemps: true, occupeDepuis: "2026-11-12T07:00:00+01:00", occupePar: ["1 réponse en cours"] }, T), /ce qui la retient : 1 réponse en cours/);
  assert.match(V.confirmationMajAuto(true), /en pause/);
  assert.match(V.confirmationMajAuto(false), /reprise/);
});

test("la recherche la trouve, seulement si la tour sait la faire ; la nouveauté l'attend aussi", () => {
  const avec = R.chercher("mise à jour automatique", { capacites: ["maj-auto-v1"], reglages: null, bureau: false });
  assert.equal(avec.entrees[0]?.id, "majAuto");
  assert.equal(R.cible(avec.entrees[0], { capacites: ["maj-auto-v1"] }).section, "diagnostic");
  const sans = R.chercher("mise à jour automatique", { capacites: [], reglages: null, bureau: false });
  assert.notEqual(sans.entrees[0]?.id, "majAuto");
  const e = N.CATALOGUE.find((x) => x.id === "maj-auto");
  assert.equal(e.capacite, "maj-auto-v1");
});

test("Travail de fond (fond-cede-v1) : la ligne de la tour, et la recherche qui la retrouve", () => {
  assert.equal(V.phraseFond({ ligne: "Réflexion de nuit en pause : tu viens de poser une question" }), "Réflexion de nuit en pause : tu viens de poser une question");
  assert.equal(V.phraseFond(null), "Travail de fond : état inconnu");
  assert.equal(V.phraseFond({ ligne: 3 }), "Travail de fond : état inconnu");
  const avec = R.chercher("travail de fond", { capacites: ["fond-cede-v1"], reglages: null, bureau: false });
  assert.equal(avec.entrees[0]?.id, "fond");
  assert.equal(R.cible(avec.entrees[0], { capacites: ["fond-cede-v1"] }).section, "diagnostic");
  assert.notEqual(R.chercher("travail de fond", { capacites: [], reglages: null, bureau: false }).entrees[0]?.id, "fond");
});
