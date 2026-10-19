// Ce que Rémy sait de l'assiduité de Sam — la phrase qu'il reçoit dans son
// prompt. Sam a demandé qu'on le lui reproche quand il disparaît : la phrase
// doit donc dire l'absence clairement, sans la dire quand elle n'existe pas.

import test from "node:test";
import assert from "node:assert/strict";

process.env.ANTHROPIC_API_KEY ||= "cle-de-test";
process.env.REMY_PROVIDER ||= "api";

const { phraseActivite } = await import("../lib/chat.js");
const { resume } = await import("../lib/activite.js");

// Construit un résumé à partir d'une suite de jours, du plus récent au plus
// ancien : [messages aujourd'hui, hier, avant-hier…]
function depuis(messages) {
  const cartes = {};
  const base = Date.UTC(2026, 7, 15);
  messages.forEach((n, i) => {
    const jour = new Date(base - i * 86_400_000).toISOString().slice(0, 10);
    cartes[jour] = { creneaux: n ? [100, 101] : [], messages: n };
  });
  return resume(cartes, { jours: messages.length, aujourdhui: "2026-08-15" });
}

test("une absence de plusieurs jours est dite, avec son compte", () => {
  const p = phraseActivite(depuis([0, 0, 0, 5, 2]));
  assert.match(p, /pas écrit depuis 3 jours/);
});

test("une longue absence est signalée comme longue", () => {
  assert.match(phraseActivite(depuis([0, 0, 0, 0, 0, 0, 3])), /c'est long/);
});

test("une absence d'un seul jour n'est pas relevée", () => {
  // Ne pas avoir écrit hier n'est pas un signal : le relever serait du
  // harcèlement, pas de l'assiduité.
  const p = phraseActivite(depuis([0, 3, 3]));
  assert.doesNotMatch(p, /pas écrit depuis/);
});

test("une journée en cours déjà active donne le compte du jour", () => {
  const p = phraseActivite(depuis([4, 0, 0]));
  assert.match(p, /4 messages/);
  assert.doesNotMatch(p, /pas écrit depuis/);
});

test("une série est mentionnée à partir de trois jours", () => {
  assert.match(phraseActivite(depuis([2, 2, 2])), /3 jours d'affilée/);
  assert.doesNotMatch(phraseActivite(depuis([2, 2, 0])), /d'affilée/);
});

test("le ratio sur la fenêtre est toujours donné", () => {
  assert.match(phraseActivite(depuis([1, 0, 1, 0, 1])), /Sur 5 jours, il t'a parlé 3 fois/);
});

test("un silence total ne rend pas une phrase vide", () => {
  const p = phraseActivite(depuis([0, 0, 0, 0, 0]));
  assert.match(p, /pas écrit depuis 5 jours/);
});

test("sans mesure du tout, Rémy ne reçoit rien plutôt qu'une phrase fausse", () => {
  assert.equal(phraseActivite(null), "");
  assert.equal(phraseActivite({ jours: [] }), "");
});
