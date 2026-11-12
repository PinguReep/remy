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
