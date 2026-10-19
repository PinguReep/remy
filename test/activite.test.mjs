// La mesure d'activité : deux chiffres qui ne veulent pas dire la même chose
// (présence ≠ activité), et une arithmétique de dates qui doit tenir au
// changement d'heure comme au fuseau du serveur (UTC sur Vercel, Paris pour Sam).

import test from "node:test";
import assert from "node:assert/strict";

import {
  horodate, creneauDe, minutesDe, plages, derniersJours, jourLisible, serie, resume,
  PAS_MIN, CRENEAUX_PAR_JOUR,
} from "../lib/activite.js";

const PARIS = "Europe/Paris";
const t = (iso) => Date.parse(iso);

// --- Le jour et le créneau, vus de Paris --------------------------------------

test("une soirée tardive appartient encore à la journée de Sam", () => {
  // 22:30 à Paris en été = 20:30 UTC. Le serveur est en UTC : sans conversion,
  // rien ne casse ici — mais 00:30 Paris tomberait la veille.
  assert.equal(horodate(t("2026-08-15T20:30:00Z"), PARIS).jour, "2026-08-15");
  assert.equal(horodate(t("2026-08-15T22:30:00Z"), PARIS).jour, "2026-08-16");
});

test("minuit passé compte pour le nouveau jour, pas comme 24 h", () => {
  const h = horodate(t("2026-08-14T22:10:00Z"), PARIS); // 00:10 le 15 à Paris
  assert.equal(h.jour, "2026-08-15");
  assert.equal(h.minute, 10);
  assert.equal(creneauDe(t("2026-08-14T22:10:00Z"), PARIS), 2);
});

test("le dernier créneau de la journée reste dans la journée", () => {
  const c = creneauDe(t("2026-08-15T21:59:00Z"), PARIS); // 23:59 à Paris
  assert.equal(c, CRENEAUX_PAR_JOUR - 1);
});

test("l'hiver décale d'une heure, sans changer de jour", () => {
  assert.equal(horodate(t("2026-01-15T23:30:00Z"), PARIS).jour, "2026-01-16");
  assert.equal(horodate(t("2026-01-15T22:30:00Z"), PARIS).jour, "2026-01-15");
});

// --- Présence : créneaux, minutes, plages lisibles -----------------------------

test("un créneau vaut cinq minutes, et les doublons ne comptent qu'une fois", () => {
  assert.equal(minutesDe([10, 10, 11]), 2 * PAS_MIN);
  assert.equal(minutesDe([]), 0);
  assert.equal(minutesDe(undefined), 0);
});

test("les créneaux aberrants sont écartés", () => {
  assert.equal(minutesDe([-1, 9999, 1.5, "12", null, 3]), PAS_MIN);
});

test("les créneaux collés se lisent comme une plage", () => {
  // 09:05 → 09:25, puis un trou, puis 14:00 → 14:10
  assert.deepEqual(plages([109, 110, 111, 112, 168, 169]), [
    { debut: "09:05", fin: "09:25", minutes: 20 },
    { debut: "14:00", fin: "14:10", minutes: 10 },
  ]);
});

test("une plage qui touche minuit s'écrit 24:00, pas 00:00", () => {
  const p = plages([CRENEAUX_PAR_JOUR - 1]);
  assert.deepEqual(p, [{ debut: "23:55", fin: "24:00", minutes: 5 }]);
});

test("les plages sortent triées même si les créneaux arrivent en désordre", () => {
  assert.deepEqual(plages([169, 109, 168, 110]).map((p) => p.debut), ["09:05", "14:00"]);
});

// --- Présence ≠ activité -------------------------------------------------------

test("une journée ouverte sans un mot n'est pas une journée active", () => {
  const j = jourLisible("2026-08-15", { creneaux: [100, 101, 102], messages: 0 });
  assert.equal(j.present, true);
  assert.equal(j.actif, false, "présence et activité ne doivent pas se confondre");
  assert.equal(j.minutes, 15);
});

test("un message rend la journée active", () => {
  const j = jourLisible("2026-08-15", { creneaux: [100], messages: 3 });
  assert.equal(j.actif, true);
  assert.equal(j.messages, 3);
});

test("un jour sans rien reste lisible plutôt que d'exploser", () => {
  const j = jourLisible("2026-08-15", null);
  assert.deepEqual(
    { minutes: j.minutes, messages: j.messages, actif: j.actif, present: j.present, plages: j.plages },
    { minutes: 0, messages: 0, actif: false, present: false, plages: [] },
  );
});

// --- Le calendrier des N derniers jours ----------------------------------------

test("les derniers jours remontent le temps, du plus récent au plus ancien", () => {
  assert.deepEqual(derniersJours(3, "2026-08-15"), ["2026-08-15", "2026-08-14", "2026-08-13"]);
});

test("le passage de mois et l'année bissextile ne sautent pas de jour", () => {
  assert.deepEqual(derniersJours(2, "2026-03-01"), ["2026-03-01", "2026-02-28"]);
  assert.deepEqual(derniersJours(2, "2024-03-01"), ["2024-03-01", "2024-02-29"]);
});

test("un jour de changement d'heure ne se double pas et ne disparaît pas", () => {
  // Passage à l'heure d'été 2026 : nuit du 28 au 29 mars.
  const j = derniersJours(4, "2026-03-30");
  assert.deepEqual(j, ["2026-03-30", "2026-03-29", "2026-03-28", "2026-03-27"]);
  assert.equal(new Set(j).size, 4);
});

// --- La série de jours actifs ---------------------------------------------------

test("la série compte les jours parlés d'affilée", () => {
  const j = [1, 1, 1, 0, 1].map((n, i) => jourLisible(`j${i}`, { messages: n }));
  assert.equal(serie(j), 3);
});

test("une journée en cours encore muette ne casse pas la série d'hier", () => {
  // Sans ça, la série retomberait à zéro tous les matins avant le premier message.
  const j = [0, 1, 1].map((n, i) => jourLisible(`j${i}`, { messages: n }));
  assert.equal(serie(j), 2);
});

test("deux jours muets de suite arrêtent bien la série", () => {
  const j = [0, 0, 1, 1].map((n, i) => jourLisible(`j${i}`, { messages: n }));
  assert.equal(serie(j), 0);
});

// --- Le résumé servi à l'écran --------------------------------------------------

test("le résumé rend toujours la fenêtre complète, trous compris", () => {
  const r = resume({ "2026-08-15": { creneaux: [100], messages: 2 } }, { jours: 7, aujourdhui: "2026-08-15" });
  assert.equal(r.jours.length, 7);
  assert.equal(r.jours[0].jour, "2026-08-15");
  assert.equal(r.jours[6].jour, "2026-08-09");
  assert.equal(r.jours[3].minutes, 0, "un jour sans donnée doit valoir zéro, pas disparaître");
});

test("le résumé additionne présence et messages", () => {
  const r = resume(
    {
      "2026-08-15": { creneaux: [100, 101], messages: 2 },
      "2026-08-14": { creneaux: [50], messages: 0 },
    },
    { jours: 3, aujourdhui: "2026-08-15" },
  );
  assert.equal(r.minutesTotal, 15);
  assert.equal(r.messagesTotal, 2);
  assert.equal(r.joursPresents, 2);
  assert.equal(r.joursActifs, 1, "le 14 était ouvert mais muet");
  assert.equal(r.aujourdhui.jour, "2026-08-15");
});

test("la moyenne ignore les jours d'absence", () => {
  // 30 min sur un seul jour présent en 10 jours : la moyenne utile est 30, pas 3.
  const r = resume({ "2026-08-15": { creneaux: [1, 2, 3, 4, 5, 6], messages: 1 } }, { jours: 10, aujourdhui: "2026-08-15" });
  assert.equal(r.minutesParJourPresent, 30);
});

test("aucune donnée : des zéros, pas des NaN", () => {
  const r = resume({}, { jours: 14, aujourdhui: "2026-08-15" });
  assert.deepEqual(
    { m: r.minutesTotal, msg: r.messagesTotal, s: r.serie, moy: r.minutesParJourPresent },
    { m: 0, msg: 0, s: 0, moy: 0 },
  );
  assert.equal(r.jours.length, 14);
});
