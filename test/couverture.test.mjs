// L'analyse d'onboarding a échoué trois fois en production. À chaque fois pour
// une raison différente, et à chaque fois on a corrigé à l'aveugle. Ces tests
// figent les trois pannes réelles pour qu'aucune ne puisse revenir.
//
//   1. le modèle bavarde avant son JSON  → lireCouverture doit s'en sortir
//   2. le modèle rend une autre forme    → lireCouverture / nettoyer
//   3. le modèle dépense TOUT son budget en réflexion et n'écrit pas une ligne
//      (stop=max_tokens, blocs=thinking, 0 caractère) → deuxième essai sans
//      réflexion, au lieu d'une erreur payée pour rien.
//
//   node --test test/

import test from "node:test";
import assert from "node:assert/strict";

process.env.ANTHROPIC_API_KEY ||= "cle-de-test";
process.env.REMY_PROVIDER ||= "api";

const { lireCouverture, nettoyer, SCHEMA_COUVERTURE, couvertureDepuisModele } = await import(
  "../lib/couverture.js"
);
const { SESSIONS, SESSION_IDS } = await import("../lib/onboarding.js");

const S1 = SESSIONS[0];
const R1 = S1.reperes[0].id;
const R2 = S1.reperes[1].id;

// Un fournisseur de test : rend les réponses qu'on lui donne, dans l'ordre, et
// garde la trace exacte de ce qu'on lui a demandé.
function faux(...reponses) {
  const appels = [];
  return {
    name: "faux",
    appels,
    async complete(params) {
      appels.push(params);
      const r = reponses[appels.length - 1];
      if (!r) throw new Error(`appel n°${appels.length} non prévu par le test`);
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

const OK = { text: JSON.stringify({ [S1.id]: [R1] }), stopReason: "end_turn", blocs: ["text"], usage: {}, model: "m" };
// La panne de production du 13/08 : tout le budget parti en réflexion.
const REFLEXION_SEULE = { text: "", stopReason: "max_tokens", blocs: ["thinking"], usage: {}, model: "m" };

// --- Lecture de la réponse ----------------------------------------------------

test("lireCouverture accepte l'enveloppe demandée", () => {
  assert.deepEqual(lireCouverture(`{"couverture":{"${S1.id}":["${R1}"]}}`), { [S1.id]: [R1] });
});

test("lireCouverture accepte la carte nue (celle du schéma)", () => {
  assert.deepEqual(lireCouverture(`{"${S1.id}":["${R1}"]}`), { [S1.id]: [R1] });
});

test("lireCouverture retrouve le JSON noyé dans de la prose", () => {
  const t = `Voici mon analyse :\n\n{"${S1.id}": ["${R1}"]}\n\nJ'ai été prudent.`;
  assert.deepEqual(lireCouverture(t), { [S1.id]: [R1] });
});

test("lireCouverture retrouve le JSON dans un bloc de code", () => {
  assert.deepEqual(lireCouverture("```json\n{\"" + S1.id + "\": []}\n```"), { [S1.id]: [] });
});

test("lireCouverture refuse ce qui n'est pas une carte de couverture", () => {
  // Rendre {} ici ferait enregistrer « rien n'est couvert » en annonçant
  // « analyse terminée » : le pire des deux mondes.
  for (const t of ["", "   ", null, undefined, "Je préfère ne pas répondre.", "{pas du json}", "[]", '{"foo":["bar"]}'])
    assert.equal(lireCouverture(t), null, `devrait refuser : ${JSON.stringify(t)}`);
});

// --- Nettoyage ----------------------------------------------------------------

test("nettoyer rend les huit sections, même absentes de la réponse", () => {
  assert.deepEqual(Object.keys(nettoyer({})).sort(), [...SESSION_IDS].sort());
  assert.deepEqual(nettoyer({})[S1.id], []);
});

test("nettoyer écarte les repères inventés et les doublons", () => {
  const out = nettoyer({ [S1.id]: [R1, R1, "repere-invente", 42] });
  assert.deepEqual(out[S1.id], [R1]);
});

test("nettoyer écarte un repère rangé dans la mauvaise section", () => {
  const autre = SESSIONS.find((s) => s.id !== S1.id);
  assert.deepEqual(nettoyer({ [autre.id]: [R1] })[autre.id], []);
});

test("nettoyer survit à une valeur qui n'est pas un tableau", () => {
  assert.deepEqual(nettoyer({ [S1.id]: "tout" })[S1.id], []);
  assert.deepEqual(nettoyer(null)[S1.id], []);
});

// --- Schéma de sortie structurée ----------------------------------------------

test("le schéma exige les huit sections et interdit tout le reste", () => {
  assert.deepEqual([...SCHEMA_COUVERTURE.required].sort(), [...SESSION_IDS].sort());
  assert.equal(SCHEMA_COUVERTURE.additionalProperties, false);
});

test("le schéma énumère les vrais identifiants de chaque section", () => {
  for (const s of SESSIONS) {
    assert.deepEqual(
      SCHEMA_COUVERTURE.properties[s.id].items.enum,
      s.reperes.map((r) => r.id),
      `section ${s.id}`,
    );
  }
});

// --- L'appel au modèle : les trois pannes -------------------------------------

test("premier essai : réflexion bornée et JSON imposé par le schéma", async () => {
  const p = faux(OK);
  await couvertureDepuisModele({ provider: p, prompt: "p" });
  const a = p.appels[0];
  assert.equal(a.schema, SCHEMA_COUVERTURE);
  assert.equal(a.effort, "medium");
  // Le plafond doit laisser la place à la réflexion ET à la réponse.
  assert.ok(a.maxTokens >= 8000, `maxTokens trop serré : ${a.maxTokens}`);
});

test("une réponse exploitable n'est pas payée deux fois", async () => {
  const p = faux(OK);
  const { couverture, essais } = await couvertureDepuisModele({ provider: p, prompt: "p" });
  assert.equal(essais, 1);
  assert.equal(p.appels.length, 1);
  assert.deepEqual(couverture[S1.id], [R1]);
});

test("RÉGRESSION : tout le budget parti en réflexion → second essai sans réflexion", async () => {
  const p = faux(REFLEXION_SEULE, { ...OK, text: JSON.stringify({ [S1.id]: [R1, R2] }) });
  const { couverture, essais } = await couvertureDepuisModele({ provider: p, prompt: "p" });
  assert.equal(essais, 2);
  assert.deepEqual(p.appels[1].thinking, { type: "disabled" });
  assert.equal(p.appels[1].effort, "low");
  assert.deepEqual(couverture[S1.id], [R1, R2]);
});

test("deux réponses tronquées de suite → TROP_LONG", async () => {
  const p = faux(REFLEXION_SEULE, REFLEXION_SEULE);
  await assert.rejects(couvertureDepuisModele({ provider: p, prompt: "p" }), /TROP_LONG/);
  assert.equal(p.appels.length, 2);
});

test("deux réponses bavardes de suite → illisible", async () => {
  const bavard = { text: "Je ne peux pas conclure.", stopReason: "end_turn", blocs: ["text"] };
  const p = faux(bavard, bavard);
  await assert.rejects(couvertureDepuisModele({ provider: p, prompt: "p" }), /illisible/i);
});

test("un refus n'est pas repayé une seconde fois", async () => {
  const p = faux({ text: "", stopReason: "refusal", blocs: [] });
  await assert.rejects(couvertureDepuisModele({ provider: p, prompt: "p" }), /REFUS/);
  assert.equal(p.appels.length, 1);
});

test("chaque essai est facturé au panneau des coûts", async () => {
  const vus = [];
  const p = faux(REFLEXION_SEULE, OK);
  await couvertureDepuisModele({ provider: p, prompt: "p", journaliser: (r) => vus.push(r) });
  assert.equal(vus.length, 2, "les deux appels doivent apparaître dans les coûts");
});

test("un fournisseur qui refuse les options récentes est retenté à nu", async () => {
  // Le CLI Claude Code local, ou une API plus ancienne, ne connaît ni
  // output_config ni thinking. L'analyse doit marcher quand même.
  const err = Object.assign(new Error("output_config: unexpected field"), { status: 400 });
  const p = faux(err, OK);
  const { couverture } = await couvertureDepuisModele({ provider: p, prompt: "p" });
  assert.equal(p.appels[1].schema, undefined);
  assert.equal(p.appels[1].thinking, undefined);
  assert.deepEqual(couverture[S1.id], [R1]);
});

test("une vraie panne réseau remonte telle quelle", async () => {
  const p = faux(Object.assign(new Error("fetch failed"), { status: 500 }));
  await assert.rejects(couvertureDepuisModele({ provider: p, prompt: "p" }), /fetch failed/);
});
