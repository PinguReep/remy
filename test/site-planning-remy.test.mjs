// « Le planning de Rémy, à côté de celui de Motion » sur le site
// (public/app/analyse/planning-remy.js, vues/planning-remy.js) : les mots de
// la feuille (tête, compteur, notes, états vides), les écarts à juger d'abord,
// le planning jour par jour, et les portes d'entrée (carte des 7 jours, Ctrl+K,
// Réglages, nouveauté, cache hors ligne). Données fictives (Sam, la boutique).
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const A = await import("../public/app/analyse/planning-remy.js");
const lire = (f) => fs.readFileSync(new URL(`../public/app/${f}`, import.meta.url), "utf8");

// Lundi 16 novembre 2026, 10:00.
const MAINTENANT = new Date(2026, 10, 16, 10).getTime();
const at = (j, h, m = 0) => new Date(2026, 10, 16 + j, h, m).getTime();

const reponse = {
  etat: "ok", calculeA: MAINTENANT, motionLuA: MAINTENANT - 2 * 60e3, horairesSupposes: false, agenda: "ok",
  resume: { taches: 12, placeesRemy: 10, placeesMotion: 11, ecarts: 3 },
  ecarts: [
    { id: "bloquee:t13", genre: "bloquee", titre: "Écrire la newsletter d'automne", pourquoi: "Elle attend « Tri des photos de l'été » …", remy: "mer. 18 à 09:00–12:30", motion: "mar. 17 à 09:00–12:30" },
    { id: "ferme:t12", genre: "ferme", titre: "Envoyer le dossier à la banque", pourquoi: "Échéance ferme …", remy: "aujourd'hui à 11:00–12:00", motion: "demain à 16:00–17:00", jugement: { verdict: "remy", a: at(0, 9) } },
    { id: "ordre:t16:t17", genre: "ordre", titre: "Répéter le morceau / Trier les factures", pourquoi: "Rémy fait …", remy: "…", motion: "…" },
  ],
  remy: {
    placements: [
      { id: "t2", titre: "Relire le contrat de Hugo", debut: at(1, 9), fin: at(1, 9, 45), morceaux: [{ debut: at(1, 9), fin: at(1, 9, 45) }], raison: "Due demain …" },
      { id: "t1", titre: "Finaliser la démo", debut: at(0, 10), fin: at(0, 11, 15), morceaux: [{ debut: at(0, 10), fin: at(0, 11, 15) }], raison: "Échéance ferme …" },
      { id: "t15", titre: "Faire la déclaration de TVA", debut: at(3, 9), fin: at(3, 10, 30), morceaux: [{ debut: at(3, 9), fin: at(3, 10, 30) }], raison: "Échéance …" },
    ],
    nonPlaces: [{ id: "t3", titre: "Préparer la facture Ondine", genre: "sans-duree", raison: "Sans durée …" }],
  },
  jugements: { remy: 3, motion: 1, total: 4, depuis: at(0, 9), parGenre: {}, lisibles: true },
};

test("la réponse de la tour : lisible, ou dite illisible ; les états sans planning ont leur phrase", () => {
  assert.equal(A.planningLisible(reponse), true);
  assert.equal(A.planningLisible({ etat: "ok" }), false, "ok sans écarts : illisible, jamais « rien »");
  assert.equal(A.planningLisible(null), false);
  assert.equal(A.planningLisible("<html>"), false);
  assert.equal(A.planningLisible({ etat: "coupe" }), true);
  assert.equal(A.messageEtat(reponse), null);
  assert.equal(A.messageEtat({ etat: "coupe" }).reglages, true);
  assert.match(A.messageEtat({ etat: "coupe" }).texte, /Réglages › Rémy › Circuits/);
  assert.match(A.messageEtat({ etat: "attente" }).texte, /ouvre Aujourd'hui/);
  assert.match(A.messageEtat({ etat: "sans-motion" }).titre, /Motion n'est pas connecté/);
  assert.match(A.messageEtat({ etat: "demain" }).texte, /mets la tour à jour/);
});

test("la tête et le compteur, en mots de tous les jours", () => {
  assert.equal(A.phraseTete(reponse), "3 écarts qui comptent sur tes 12 tâches, 2 à juger.");
  assert.equal(A.phraseTete({ ...reponse, ecarts: [] }), "Sur tes 12 tâches, aucun écart qui compte : Rémy et Motion font la même chose.");
  assert.equal(A.phraseTete({ ...reponse, ecarts: [reponse.ecarts[1]] }), "1 écart qui compte sur tes 12 tâches, tous jugés.");
  assert.equal(A.phraseTete({ ...reponse, resume: { taches: 0 }, ecarts: [] }), "Aucune tâche ouverte dans Motion : rien à planifier.");
  assert.equal(A.phraseCompteur(reponse.jugements), "Tes jugements depuis le 16 nov. : Rémy a raison 3 fois, Motion 1 fois.");
  assert.match(A.phraseCompteur({ remy: 0, motion: 0 }), /^Pas encore de jugement/);
  assert.equal(A.partRemy(reponse.jugements), 0.75);
  assert.equal(A.partRemy({ remy: 0, motion: 0 }), null);
  assert.equal(A.phraseJugement({ verdict: "motion", a: at(0, 9) }), "Jugé le 16 nov. : Motion a raison.");
});

test("les notes de prudence : horaires supposés, agenda absent ou illisible, liste incomplète ou ancienne", () => {
  assert.deepEqual(A.notes(reponse, MAINTENANT), []);
  const n = A.notes({ ...reponse, horairesSupposes: true, agenda: "erreur", incomplet: true, motionLuA: MAINTENANT - 40 * 60e3 }, MAINTENANT).map((x) => x.texte);
  assert.equal(n.length, 4);
  assert.match(n[0], /supposé 9 h – 18 h/);
  assert.match(n[3], /il y a 40 min/);
  assert.match(A.notes({ ...reponse, agenda: "absent" }, MAINTENANT)[0].texte, /non connecté/);
});

test("les écarts à juger d'abord ; un jugement se pose et se retire sans toucher aux autres", () => {
  assert.deepEqual(A.ecartsTries(reponse.ecarts).map((e) => e.id), ["bloquee:t13", "ordre:t16:t17", "ferme:t12"]);
  const apres = A.avecJugement(reponse.ecarts, "ordre:t16:t17", { verdict: "motion", a: MAINTENANT });
  assert.equal(apres[2].jugement.verdict, "motion");
  assert.equal(apres[1].jugement.verdict, "remy", "les autres gardent le leur");
  const retire = A.avecJugement(apres, "ferme:t12", null);
  assert.equal("jugement" in retire[1], false);
  assert.ok(A.GENRES.bloquee && A.GENRES.ferme && A.GENRES.echeance && A.GENRES.ordre);
});

test("le planning de Rémy jour par jour, dans l'ordre", () => {
  const j = A.parJour(reponse.remy.placements, MAINTENANT);
  assert.deepEqual(j.map((x) => x.titre), ["Aujourd'hui", "Demain", "Jeu 19"]);
  assert.deepEqual(j[0].lignes.map((l) => l.id), ["t1"]);
  assert.deepEqual(A.parJour(null), []);
});

test("les portes d'entrée : la carte des 7 jours, Ctrl+K, les Réglages, la nouveauté, le cache hors ligne", async () => {
  const semaine = lire("vues/semaine.js");
  assert.match(semaine, /sait\("planning-remy-v1"\)\s+\? h\("button", \{ type: "button", class: "semaine-porte-remy"/);
  assert.match(semaine, /"Le planning de Rémy, à côté de Motion"/);
  const P = await import("../public/app/palette.js");
  const contexte = { aller: () => {}, noter: () => {} };
  const avec = P.lignesDeBase({ contexte, vues: [], sait: (c) => c === "planning-remy-v1" || c === "semaine-v1" });
  for (const q of ["planning de rémy", "comparer motion", "écarts"]) assert.equal(P.filtrer(avec, q)[0]?.titre, "Le planning de Rémy, à côté de Motion", q);
  assert.ok(!P.lignesDeBase({ contexte, vues: [], sait: () => false }).some((e) => /planning de Rémy/.test(e.titre)), "caché tant que la tour ne sait pas");
  const R = await import("../public/app/vues/reglages.js");
  assert.match(R.detailCircuit("planificateur", { forceParLaTour: false }), /Rien n'est écrit chez Motion/);
  assert.equal(R.annonceCircuit("planificateur", false), "Planning de Rémy coupé : rien n'est calculé.");
  const N = await import("../public/app/nouveautes.js");
  const e = N.CATALOGUE.find((x) => x.id === "planning-remy");
  assert.equal(e.capacite, "planning-remy-v1");
  assert.equal(e.serie, Math.max(...N.CATALOGUE.map((x) => x.serie)), "la dernière série");
  assert.ok(e.pages.length >= 1 && e.pages.length <= 3);
  const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(sw, /"\/app\/analyse\/planning-remy\.js", "\/app\/vues\/planning-remy\.js"/);
  // La feuille ne parle qu'à la tour : aucun tiers, aucune écriture ailleurs que les jugements.
  const vue = lire("vues/planning-remy.js");
  assert.doesNotMatch(vue, /https?:\/\//);
  assert.deepEqual([...vue.matchAll(/api\("([^"]+)"/g)].map((x) => x[1]).sort(), ["/api/planning-remy", "/api/planning-remy/jugements"]);
  // Cibles au doigt : les gestes sont des boutons de 44 px (classe .btn).
  assert.match(vue, /class: `btn papier pr-juge/);
});

test("les heures d'une ligne : un bloc, ou ses morceaux (le même jour, ou un autre)", () => {
  const hh = (ms) => new Date(ms).toTimeString().slice(0, 5);
  assert.deepEqual(A.heuresLigne({ morceaux: [{ debut: at(1, 9), fin: at(1, 9, 45) }] }, hh), { premier: "09:00 – 09:45", suite: null });
  assert.deepEqual(A.heuresLigne({ morceaux: [{ debut: at(1, 15, 25), fin: at(1, 18) }, { debut: at(3, 9), fin: at(3, 9, 30) }] }, hh), { premier: "15:25 – 18:00", suite: "En 2 morceaux : puis Jeu 19 09:00 – 09:30." });
  assert.equal(A.heuresLigne({ morceaux: [{ debut: at(1, 9), fin: at(1, 10) }, { debut: at(1, 14), fin: at(1, 15) }, { debut: at(2, 9), fin: at(2, 10) }] }, hh).suite, "En 3 morceaux : puis 14:00 – 15:00, puis Mer 18 09:00 – 10:00.");
});
