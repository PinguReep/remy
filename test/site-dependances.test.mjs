// Le site et les dépendances entre tâches (taches-dependances-v1) : le choix
// des bloquantes dans Gérer, les marques des lignes, ce que disent les
// bandeaux après une coche ou une proposition validée.

import test from "node:test";
import assert from "node:assert/strict";

const D = await import("../public/app/analyse/dependances.js");
const J = await import("../public/app/analyse/journee.js");
const P = await import("../public/app/vues/propositions.js");
const R = await import("../public/app/analyse/rituel.js");

const taches = [
  { id: "a", titre: "Réparer la voiture au garage", projet: "Voiture", echeance: 3 },
  { id: "b", titre: "Porter la voiture chez le carrossier", projet: "Voiture", echeance: 5 },
  { id: "c", titre: "Payer le carrossier", projet: null, echeance: null },
  { id: "d", titre: "Appeler Léa", projet: "Perso", echeance: 1 },
];

test("choisir une bloquante : ni elle-même, ni une déjà choisie, ni une qui l'attend (même de loin)", () => {
  const liens = [{ tache: { id: "b" }, bloquante: { id: "a" } }, { tache: { id: "c" }, bloquante: { id: "b" } }];
  assert.deepEqual(D.candidats(taches, { tacheId: "a", liens }).map((t) => t.id), ["d"], "b et c attendent a : elles boucleraient");
  assert.deepEqual(D.candidats(taches, { tacheId: "c", deja: [{ id: "b" }], liens }).map((t) => t.id), ["d", "a"], "échéances proches d'abord");
});

test("chercher par nom : accents et majuscules n'y font rien, tous les mots comptent, le projet aussi", () => {
  assert.deepEqual(D.candidats(taches, { tacheId: "d", recherche: "REPARER voiture" }).map((t) => t.id), ["a"]);
  assert.deepEqual(D.candidats(taches, { tacheId: "d", recherche: "voiture" }).map((t) => t.id), ["a", "b"]);
  assert.deepEqual(D.candidats(taches, { tacheId: "d", recherche: "perso" }), []);
  assert.match(D.phraseVide({ total: 3, recherche: "zèbre" }), /Aucune tâche ne correspond à « zèbre »/);
  assert.match(D.phraseVide({ total: 0 }), /Aucune autre tâche ouverte dans Motion/);
});

test("les marques : « Bloquée par », « Débloque », l'ancien « En attente » inchangé", () => {
  assert.equal(J.marqueBloquee("le devis"), "En attente · le devis");
  assert.equal(J.marqueBloquee(null), "En attente");
  assert.equal(J.marqueBloquee("après « Garage »", [{ id: "a", nom: "Garage" }]), "Bloquée par « Garage »");
  assert.equal(J.marqueBloquee(null, [{ id: "a", nom: "Garage" }, { id: "x", nom: "Devis" }]), "Bloquée par « Garage » (+1)");
  assert.equal(J.marqueDebloque([{ id: "b", nom: "Carrossier" }]), "Débloque « Carrossier »");
  assert.equal(J.marqueDebloque([]), null);
});

test("après la coche : « Y est débloquée » ; après une proposition : les liens posés ou pas", () => {
  assert.equal(J.phraseDebloquees([{ id: "b", nom: "Carrossier" }]), "« Carrossier » est débloquée : elle peut commencer.");
  assert.equal(J.phraseDebloquees([{ id: "b", nom: "A" }, { id: "c", nom: "B" }]), "« A » et « B » sont débloquées.");
  assert.equal(J.phraseDebloquees([]), null);
  assert.equal(J.phraseDebloquees(undefined), null);
  const r = { results: [{ ok: true, nom: "Garage" }, { ok: true, nom: "Carrossier", bloqueePar: [{ id: "t1", nom: "Garage" }] }] };
  assert.equal(P.phraseLiens(r), "« Carrossier » attendra « Garage ».");
  assert.match(P.phraseLiens({ results: [{ ok: true, nom: "Carrossier", liensRates: [{ ref: "garage", erreur: "écartée de la proposition" }] }] }), /n'a pas été posé/);
  assert.equal(P.phraseLiens({ results: [{ ok: true, nom: "x" }] }), "");
});

test("la carte de proposition dit ce qu'une étape attend", () => {
  assert.equal(P.detailAction({ type: "creer", nom: "Carrossier", apres: ["Réparer la voiture au garage"] }), "après « Réparer la voiture au garage »");
  assert.equal(P.detailAction({ type: "creer", nom: "Payer", duree: 15, apres: ["A", "B"] }), "15 min · après « A » (+1)");
});

test("une échéance menacée par le blocage : la question pour Rémy ne parle pas de la caser", () => {
  const m = { titre: "Carrossier", raison: "bloquee", phrase: "Due demain 18:00. Elle attend « Garage », prévue après son échéance." };
  assert.match(R.phraseMenacee(m), /avancer ce qu'elle attend, ou repousser son échéance/);
  assert.match(R.phraseMenacee({ titre: "X", phrase: "Due ce soir." }), /Trouve-lui un créneau/);
});

// --- Les projets bloqués (projets-bloques-v1) ---

test("projets : la marque d'une tâche dont le projet attend, celle du projet et de sa branche", () => {
  const projet = { id: "motion:pc", nom: "Carrosserie", par: [{ id: "motion:pg", nom: "Garage", noeud: true }] };
  assert.equal(J.marqueBloquee("projet « Carrosserie » après « Garage »", null, projet), "Projet « Carrosserie » bloqué par « Garage »");
  assert.equal(J.marqueBloquee(null, [{ id: "a", nom: "Devis" }], projet), "Bloquée par « Devis »", "son propre lien d'abord");
  assert.equal(J.marqueNoeud({ bloquePar: [{ id: "motion:pg", nom: "Garage" }] }), "Bloqué par « Garage »");
  assert.equal(J.marqueNoeud({ parentBloque: projet }), "« Carrosserie » attend « Garage »");
  assert.equal(J.marqueNoeud({}), null);
  assert.match(J.regleFini("Garage"), /« Garage » est fini pour Rémy quand toutes ses tâches sont terminées .* ou quand tu le dis/);
});

test("projets : « Carrosserie est débloqué », la carte « Faire attendre »", () => {
  assert.equal(J.phraseDebloquees([{ id: "motion:pc", nom: "Carrosserie" }]), "« Carrosserie » est débloqué : ses tâches peuvent commencer.");
  assert.equal(P.verbe({ type: "attendre" }), "Faire attendre");
  assert.equal(P.detailAction({ type: "attendre", nom: "Carrosserie", apres: ["Garage"] }), "après « Garage »");
  assert.equal(P.phraseLiens({ results: [{ ok: true, type: "terminer", nom: "Récupérer la voiture", debloquees: [{ id: "motion:pc", nom: "Carrosserie" }] }] }), "« Carrosserie » est débloqué.");
});

test("projets : choisir parmi tâches ET projets, par nom", () => {
  const items = [...taches, { id: "motion:pg", titre: "Garage", genre: "projet" }, { id: "dossier:peinture", titre: "Peinture", genre: "dossier" }];
  assert.deepEqual(D.candidats(items, { tacheId: "motion:pc", recherche: "garage" }).map((t) => t.id), ["a", "motion:pg"], "les tâches datées d'abord, puis les projets");
  assert.deepEqual(D.candidats(items, { tacheId: "motion:pg", recherche: "peint" }).map((t) => t.id), ["dossier:peinture"]);
});

test("projets : le choix n'offre ni ses propres tâches, ni son projet, ni ses branches", () => {
  const items = [
    { id: "g1", titre: "Récupérer la voiture", dans: ["motion:pg"] },
    { id: "c1", titre: "Porter chez le carrossier", dans: ["motion:pc"] },
    { id: "motion:pg", titre: "Garage", genre: "projet" },
    { id: "motion:pc", titre: "Carrosserie", genre: "projet" },
    { id: "dossier:peinture", titre: "Peinture", genre: "dossier", dans: ["motion:pc"] },
  ];
  assert.deepEqual(D.candidats(items, { tacheId: "motion:pc" }).map((t) => t.id).sort(), ["g1", "motion:pg"]);
  assert.deepEqual(D.candidats(items, { tacheId: "c1" }).map((t) => t.id).sort(), ["dossier:peinture", "g1", "motion:pg"].sort().filter((x) => x !== "motion:pc"));
  assert.deepEqual(D.candidats(items, { tacheId: "dossier:peinture" }).map((t) => t.id).sort(), ["c1", "g1", "motion:pg"]);
});
