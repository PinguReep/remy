// Tâche Motion ou rendez-vous d'agenda ? La règle vient de la structure réelle
// d'une tâche Motion, relevée sur le compte de Sam :
//
//   duration, dueDate, deadlineType (SOFT|HARD), startOn (une DATE), priority
//   scheduledStart / scheduledEnd  ← calculés par Motion, en lecture seule
//
// Aucun champ ne permet d'épingler une tâche à une heure. Mettre un rendez-vous
// dans Motion, c'est donc accepter qu'il soit déplacé — et rater son dentiste.

import test from "node:test";
import assert from "node:assert/strict";
import {
  nomAvecHeure, echeanceSuspecte, verifierActionMotion, verifierPropositionMotion, CONSIGNE_ARBITRAGE,
} from "../lib/arbitrage.js";

const bloquants = (a) => verifierActionMotion(a).filter((v) => v.gravite === "bloquant");
const avertis = (a) => verifierActionMotion(a).filter((v) => v.gravite === "avertissement");

// --- Le refus net : une tâche Motion n'a pas d'heure de début ---------------------

test("une action Motion portant une heure de début est refusée", () => {
  for (const champ of ["debut", "heure", "fin", "lieu"]) {
    const a = { type: "creer", nom: "Dentiste", duree: "60", [champ]: "2026-08-20T13:00:00Z" };
    assert.equal(bloquants(a).length, 1, `le champ ${champ} doit bloquer`);
  }
});

test("le refus explique quoi faire, pas seulement que c'est refusé", () => {
  const [b] = bloquants({ type: "creer", nom: "Dentiste", debut: "2026-08-20T13:00:00Z" });
  assert.match(b.message, /agenda/i);
  assert.match(b.message, /échéance et une durée/);
});

test("une vraie tâche Motion passe sans rien déclencher", () => {
  const a = { type: "creer", nom: "Rappeler le podologue", duree: "15", echeance: "2026-08-20T21:59:00Z", priorite: "HIGH" };
  assert.deepEqual(verifierActionMotion(a), []);
});

test("un champ d'événement vide n'est pas un champ d'événement", () => {
  assert.deepEqual(bloquants({ type: "creer", nom: "Trier les mails", lieu: "", debut: null }), []);
});

// --- L'avertissement : une heure annoncée dans le nom ------------------------------

test("une heure dans le nom déclenche un avertissement, pas un blocage", () => {
  const a = { type: "creer", nom: "RDV dentiste 15h", duree: "60" };
  assert.equal(bloquants(a).length, 0, "on n'est pas sûr : Sam garde le dernier geste");
  assert.equal(avertis(a).length, 1);
});

test("les écritures d'heure courantes sont reconnues", () => {
  for (const n of ["Dentiste à 15h", "Appel 9h30", "Réunion 14:00", "Visio à 9 h 30", "Départ 7h45"]) {
    assert.equal(nomAvecHeure(n), true, n);
  }
});

test("une durée n'est pas un horaire", () => {
  for (const n of ["Sport pendant 2h", "Rédiger le dossier (durée 3h)", "Ménage environ 1h"]) {
    assert.equal(nomAvecHeure(n), false, n);
  }
});

test("un nom sans horaire ne déclenche rien", () => {
  for (const n of ["Trier Motion", "Résilier Suno", "Préparer la démo", "Courses"]) {
    assert.equal(nomAvecHeure(n), false, n);
  }
});

test("un chiffre seul n'est pas une heure", () => {
  assert.equal(nomAvecHeure("Acheter 3 ampoules"), false);
  assert.equal(nomAvecHeure("Relire les 15 pages"), false);
});

// --- L'avertissement : une échéance qui ressemble à un horaire ----------------------

test("une échéance en pleine journée à l'heure ronde est signalée", () => {
  assert.equal(echeanceSuspecte("2026-08-20T13:00:00Z"), true);
  assert.equal(echeanceSuspecte("2026-08-20T09:30:00Z"), true);
});

test("une échéance de fin de journée est une vraie échéance", () => {
  // Motion pose ses échéances de journée à 23:59:59 : rien à signaler.
  assert.equal(echeanceSuspecte("2026-08-20T21:59:59Z"), false);
  assert.equal(echeanceSuspecte("2026-08-20T23:00:00Z"), false);
});

test("une heure non ronde ressemble à une contrainte, pas à un rendez-vous", () => {
  assert.equal(echeanceSuspecte("2026-08-20T13:17:00Z"), false);
});

test("une échéance illisible ne déclenche rien", () => {
  for (const v of ["", null, "demain", undefined]) assert.equal(echeanceSuspecte(v), false);
});

test("l'avertissement d'échéance ne double pas celui du nom", () => {
  // Deux avertissements pour le même soupçon noieraient le message utile.
  const a = { type: "creer", nom: "Dentiste 15h", echeance: "2026-08-20T15:00:00Z" };
  assert.equal(avertis(a).length, 1);
});

test("modifier ou terminer une tâche ne déclenche pas les soupçons du nom", () => {
  // Le nom sert alors au repérage d'une tâche existante : le suspecter n'aurait
  // aucun sens, Sam ne crée rien.
  assert.deepEqual(verifierActionMotion({ type: "terminer", id: "tk_1", nom: "Dentiste 15h" }), []);
  assert.deepEqual(verifierActionMotion({ type: "modifier", id: "tk_1", nom: "Appel 9h30" }), []);
});

// --- La proposition entière ----------------------------------------------------------

test("un seul champ d'événement bloque toute la proposition", () => {
  const { bloquants: b } = verifierPropositionMotion([
    { type: "creer", nom: "Trier Motion", duree: "60" },
    { type: "creer", nom: "Dentiste", debut: "2026-08-20T13:00:00Z" },
  ]);
  assert.equal(b.length, 1);
  assert.equal(b[0].index, 1, "l'action fautive doit être identifiable");
});

test("une proposition saine ne bloque pas", () => {
  const { bloquants: b, avis } = verifierPropositionMotion([
    { type: "creer", nom: "Préparer la démo", duree: "120", echeance: "2026-08-20T21:59:00Z" },
  ]);
  assert.deepEqual(b, []);
  assert.deepEqual(avis, []);
});

test("une entrée qui n'est pas une liste ne fait pas planter", () => {
  for (const v of [null, undefined, {}, "x"]) assert.deepEqual(verifierPropositionMotion(v).avis, []);
});

// --- La consigne donnée à Rémy ---------------------------------------------------------

test("la consigne dit POURQUOI, pas seulement quoi", () => {
  // Une règle sans raison ne survit pas à un cas limite : le modèle doit savoir
  // qu'une tâche Motion est déplaçable par construction.
  assert.match(CONSIGNE_ARBITRAGE, /ne PEUT PAS être épinglée à une heure/);
  assert.match(CONSIGNE_ARBITRAGE, /c'est Motion qui choisit le créneau/);
});

test("la consigne donne un test décidable en une phrase", () => {
  assert.match(CONSIGNE_ARBITRAGE, /si quelqu'un d'autre attend Sam/i);
});

test("la consigne traite le cas où un sujet donne les deux", () => {
  assert.match(CONSIGNE_ARBITRAGE, /LES DEUX/);
});

test("la consigne distingue échéance et horaire", () => {
  assert.match(CONSIGNE_ARBITRAGE, /Une échéance n'est pas un horaire/);
});
