// Les sujets de la réflexion nocturne : identité stable, états, et ce que Rémy
// a le droit de voir. Le piège central : si l'identité d'un sujet bougeait, un
// sujet coché lundi se retrouverait barré sur une autre ligne mardi.

import test from "node:test";
import assert from "node:assert/strict";
import {
  itemsDe, idDe, avecEtats, sujetsOuverts, sujetsFermes, etatsUtiles, PEREMPTION_MS,
} from "../lib/briefing.js";

const BRIEFING = `- Tu as parlé trois fois de la démo de la boutique sans fixer de date (70 %).
- Le tri Motion attend depuis six jours.
* Léa t'a demandé une réponse sur le week-end.`;

// --- Découpage ------------------------------------------------------------------

test("les puces deviennent des sujets, la prose non", () => {
  const items = itemsDe(`Voici ce que j'ai vu cette nuit.\n\n${BRIEFING}\n\nBonne journée.`);
  assert.equal(items.length, 3);
  assert.match(items[0].texte, /démo de la boutique/);
  assert.match(items[2].texte, /Léa/, "les puces en * comptent aussi");
});

test("un briefing vide ne donne aucun sujet", () => {
  for (const v of ["", null, undefined, "juste de la prose", "   "]) assert.deepEqual(itemsDe(v), []);
});

test("deux puces identiques ne font qu'un sujet", () => {
  assert.equal(itemsDe("- Le tri Motion attend.\n- Le tri Motion attend.").length, 1);
});

// --- Identité ---------------------------------------------------------------------

test("l'identité d'un sujet ne dépend ni de la casse, ni des accents, ni de la ponctuation", () => {
  assert.equal(idDe("Le tri Motion attend depuis six jours."), idDe("le tri motion attend depuis six jours"));
  assert.equal(idDe("Léa t'a demandé"), idDe("LEA T'A DEMANDE !"));
});

test("deux sujets différents ne partagent pas d'identité", () => {
  const [a, b] = itemsDe(BRIEFING);
  assert.notEqual(a.id, b.id);
});

test("l'identité tient à travers deux lectures du même texte", () => {
  assert.deepEqual(itemsDe(BRIEFING).map((i) => i.id), itemsDe(BRIEFING).map((i) => i.id));
});

test("un sujet reformulé est un NOUVEAU sujet", () => {
  // C'est voulu : « le tri Motion attend » et « lance le tri Motion » ne sont
  // pas la même question — hériter de l'état de l'un ferait disparaître l'autre
  // avant même que Sam l'ait lu.
  assert.notEqual(idDe("Le tri Motion attend depuis six jours."), idDe("Lance le tri Motion cette semaine."));
});

test("l'identité est un format court et vérifiable", () => {
  assert.match(idDe("x"), /^[a-f0-9]{10}$/);
});

// --- États --------------------------------------------------------------------------

test("sans état enregistré, un sujet est ouvert", () => {
  assert.ok(avecEtats(itemsDe(BRIEFING), {}).every((i) => i.etat === "ouvert"));
  assert.ok(avecEtats(itemsDe(BRIEFING), null).every((i) => i.etat === "ouvert"));
});

test("un état inventé est ignoré au profit d'ouvert", () => {
  const [a] = itemsDe(BRIEFING);
  assert.equal(avecEtats([a], { [a.id]: { etat: "n_importe_quoi" } })[0].etat, "ouvert");
});

test("traité et écarté se distinguent", () => {
  const [a, b] = itemsDe(BRIEFING);
  const out = avecEtats(itemsDe(BRIEFING), { [a.id]: { etat: "traite" }, [b.id]: { etat: "ignore" } });
  assert.deepEqual(out.map((i) => i.etat), ["traite", "ignore", "ouvert"]);
});

// --- Ce que Rémy voit -----------------------------------------------------------------

test("Rémy ne voit que les sujets encore ouverts", () => {
  const [a] = itemsDe(BRIEFING);
  const vus = sujetsOuverts(BRIEFING, { [a.id]: { etat: "traite" } }, { genereA: Date.now() });
  assert.equal(vus.length, 2);
  assert.ok(!vus.some((s) => s.id === a.id), "un sujet barré ne doit pas être relancé");
});

test("un briefing périmé ne relance plus rien", () => {
  const vieux = Date.now() - PEREMPTION_MS - 1000;
  assert.deepEqual(sujetsOuverts(BRIEFING, {}, { genereA: vieux }), []);
  assert.equal(sujetsOuverts(BRIEFING, {}, { genereA: Date.now() - 1000 }).length, 3);
});

test("le nombre de sujets envoyés au modèle est plafonné", () => {
  const gros = Array.from({ length: 20 }, (_, i) => `- sujet numéro ${i}`).join("\n");
  assert.equal(sujetsOuverts(gros, {}, { genereA: Date.now() }).length, 6);
});

test("chaque sujet envoyé à Rémy porte son identifiant", () => {
  const vus = sujetsOuverts(BRIEFING, {}, { genereA: Date.now() });
  assert.ok(vus.every((s) => /^[a-f0-9]{10}$/.test(s.id) && s.texte));
});

// --- Ce que la pré-réflexion ne doit plus proposer --------------------------------------

test("un sujet écarté remonte pour ne plus être reproposé", () => {
  const [a, b] = itemsDe(BRIEFING);
  const fermes = sujetsFermes([BRIEFING], { [a.id]: { etat: "ignore" }, [b.id]: { etat: "traite" } });
  assert.equal(fermes.length, 2);
  assert.equal(fermes.find((s) => s.id === a.id).etat, "ignore");
});

test("les sujets ouverts ne remontent pas comme fermés", () => {
  assert.deepEqual(sujetsFermes([BRIEFING], {}), []);
});

test("un sujet fermé présent dans deux briefings ne compte qu'une fois", () => {
  const [a] = itemsDe(BRIEFING);
  const fermes = sujetsFermes([BRIEFING, BRIEFING], { [a.id]: { etat: "ignore" } });
  assert.equal(fermes.length, 1);
});

// --- Ménage -------------------------------------------------------------------------------

test("un état dont le sujet a disparu de tous les briefings est oublié", () => {
  const [a] = itemsDe(BRIEFING);
  const etats = { [a.id]: { etat: "traite", at: Date.now() }, fantome123: { etat: "ignore", at: Date.now() } };
  const out = etatsUtiles(etats, [BRIEFING]);
  assert.deepEqual(Object.keys(out), [a.id]);
});

test("un état très vieux est oublié même si son sujet existe encore", () => {
  const [a] = itemsDe(BRIEFING);
  const out = etatsUtiles({ [a.id]: { etat: "traite", at: Date.now() - 200 * 86_400_000 } }, [BRIEFING]);
  assert.deepEqual(out, {});
});
