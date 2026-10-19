// Lire les exports ChatGPT et Claude. Les deux pièges principaux :
//   - ChatGPT range ses messages dans un ARBRE, avec les branches des réponses
//     regénérées. Prendre la mauvaise branche ressort une conversation que
//     Sam n'a jamais eue.
//   - Claude rend une liste plate, mais pas garantie dans l'ordre.

import test from "node:test";
import assert from "node:assert/strict";
import { normaliser, normaliserLot, detecterFormat, cleDe } from "../lib/import.js";

const T0 = 1_700_000_000; // secondes (ChatGPT compte en secondes flottantes)

// Fabrique un export ChatGPT : chaîne linéaire, plus des branches optionnelles.
function chatgpt({ titre = "Mon projet", noeuds, courant, create = T0 } = {}) {
  const mapping = {};
  for (const n of noeuds) {
    mapping[n.id] = {
      id: n.id,
      parent: n.parent ?? null,
      children: noeuds.filter((x) => x.parent === n.id).map((x) => x.id),
      message: n.role
        ? {
            id: n.id,
            author: { role: n.role },
            create_time: n.at ?? create,
            content: { content_type: "text", parts: [n.texte] },
            ...(n.cache ? { metadata: { is_visually_hidden_from_conversation: true } } : {}),
          }
        : null,
    };
  }
  return { title: titre, create_time: create, conversation_id: "c-1", mapping, current_node: courant };
}

const CHAINE = [
  { id: "root", parent: null },
  { id: "m1", parent: "root", role: "user", texte: "je monte une boutique de bougies" },
  { id: "m2", parent: "m1", role: "assistant", texte: "bonne idée" },
];

// --- Détection ------------------------------------------------------------------

test("chaque format est reconnu, et rien d'autre", () => {
  assert.equal(detecterFormat(chatgpt({ noeuds: CHAINE, courant: "m2" })), "chatgpt");
  assert.equal(detecterFormat({ uuid: "x", chat_messages: [] }), "claude");
  for (const v of [null, undefined, "texte", 42, [], {}, { messages: [] }])
    assert.equal(detecterFormat(v), null, `ne doit pas être reconnu : ${JSON.stringify(v)}`);
});

// --- ChatGPT : l'arbre ------------------------------------------------------------

test("ChatGPT : la conversation ressort dans l'ordre, racine exclue", () => {
  const { conv } = normaliser(chatgpt({ noeuds: CHAINE, courant: "m2" }));
  assert.deepEqual(conv.messages, [
    { role: "user", content: "je monte une boutique de bougies" },
    { role: "assistant", content: "bonne idée" },
  ]);
  assert.equal(conv.titre, "Mon projet");
});

test("ChatGPT : la réponse jetée ne remonte pas, seule la branche gardée compte", () => {
  const avecBranche = [
    ...CHAINE,
    { id: "m2bis", parent: "m1", role: "assistant", texte: "RÉPONSE REGÉNÉRÉE PUIS JETÉE" },
    { id: "m3", parent: "m2bis", role: "user", texte: "et pour la facturation ?" },
  ];
  // Sam a gardé la branche m2bis → m3.
  const { conv } = normaliser(chatgpt({ noeuds: avecBranche, courant: "m3" }));
  assert.deepEqual(conv.messages.map((m) => m.content), [
    "je monte une boutique de bougies",
    "RÉPONSE REGÉNÉRÉE PUIS JETÉE",
    "et pour la facturation ?",
  ]);
  assert.equal(conv.messages.length, 3, "la branche abandonnée ne doit pas s'ajouter");
});

test("ChatGPT : sans current_node, on descend quand même l'arbre", () => {
  const brut = chatgpt({ noeuds: CHAINE, courant: undefined });
  const { conv } = normaliser(brut);
  assert.equal(conv.messages.length, 2);
});

test("ChatGPT : les messages système et cachés sont écartés", () => {
  const noeuds = [
    { id: "root", parent: null },
    { id: "s", parent: "root", role: "system", texte: "tu es un assistant" },
    { id: "h", parent: "s", role: "user", texte: "message caché", cache: true },
    { id: "m", parent: "h", role: "user", texte: "vrai message" },
  ];
  const { conv } = normaliser(chatgpt({ noeuds, courant: "m" }));
  assert.deepEqual(conv.messages, [{ role: "user", content: "vrai message" }]);
});

test("ChatGPT : une image ou un appel d'outil ne laisse pas d'objet illisible", () => {
  const brut = chatgpt({ noeuds: CHAINE, courant: "m2" });
  brut.mapping.m2.message.content = { content_type: "multimodal_text", parts: [{ asset_pointer: "file-x" }] };
  const { conv } = normaliser(brut);
  assert.deepEqual(conv.messages.map((m) => m.content), ["je monte une boutique de bougies"]);
  assert.ok(!JSON.stringify(conv).includes("object Object"));
});

test("ChatGPT : un arbre circulaire ne fait pas tourner l'import en boucle", () => {
  const brut = chatgpt({ noeuds: CHAINE, courant: "m2" });
  brut.mapping.root.parent = "m2"; // cycle
  const { conv } = normaliser(brut);
  assert.ok(conv.messages.length >= 1);
});

// --- Claude : la liste plate --------------------------------------------------------

const claudeExport = (msgs, extra = {}) => ({
  uuid: "u-1",
  name: "Tennis",
  created_at: "2026-02-03T10:00:00Z",
  chat_messages: msgs,
  ...extra,
});

test("Claude : humain et assistant sont traduits dans les bons rôles", () => {
  const { conv } = normaliser(
    claudeExport([
      { uuid: "a", sender: "human", text: "règle mon tennis", created_at: "2026-02-03T10:00:00Z" },
      { uuid: "b", sender: "assistant", text: "voilà", created_at: "2026-02-03T10:01:00Z" },
    ]),
  );
  assert.deepEqual(conv.messages, [
    { role: "user", content: "règle mon tennis" },
    { role: "assistant", content: "voilà" },
  ]);
  assert.equal(conv.titre, "Tennis");
});

test("Claude : les messages sont remis dans l'ordre du temps", () => {
  const { conv } = normaliser(
    claudeExport([
      { sender: "assistant", text: "deuxième", created_at: "2026-02-03T10:05:00Z" },
      { sender: "human", text: "premier", created_at: "2026-02-03T10:00:00Z" },
    ]),
  );
  assert.deepEqual(conv.messages.map((m) => m.content), ["premier", "deuxième"]);
});

test("Claude : le texte peut venir des blocs de contenu", () => {
  const { conv } = normaliser(
    claudeExport([
      { sender: "human", text: "", content: [{ type: "text", text: "dans le bloc" }], created_at: "2026-02-03T10:00:00Z" },
    ]),
  );
  assert.deepEqual(conv.messages, [{ role: "user", content: "dans le bloc" }]);
});

// --- Dates ---------------------------------------------------------------------------

test("la date d'origine est conservée, pas remplacée par celle de l'import", () => {
  const { conv } = normaliser(chatgpt({ noeuds: CHAINE, courant: "m2", create: T0 }));
  assert.equal(conv.creeA, T0 * 1000);
  assert.equal(new Date(conv.origine.at).getUTCFullYear(), 2023);
});

test("sans date d'entête, celle du premier message sert de repli", () => {
  const brut = claudeExport([{ sender: "human", text: "salut", created_at: "2025-05-04T08:00:00Z" }]);
  delete brut.created_at;
  const { conv } = normaliser(brut);
  assert.equal(conv.creeA, Date.parse("2025-05-04T08:00:00Z"));
});

// --- Refus propres ---------------------------------------------------------------------

test("une conversation vide est refusée avec sa raison, pas importée à moitié", () => {
  assert.equal(normaliser(claudeExport([])).raison, "aucun message lisible");
  assert.equal(normaliser({ mapping: {} }).raison, "aucun message lisible");
  assert.equal(normaliser({ nimporte: "quoi" }).raison, "format inconnu");
});

test("un message démesuré est coupé, pas jeté", () => {
  const { conv } = normaliser(
    claudeExport([{ sender: "human", text: "a".repeat(50_000), created_at: "2026-02-03T10:00:00Z" }]),
  );
  assert.ok(conv.messages[0].content.length < 21_000);
  assert.ok(conv.messages[0].content.endsWith("[…]"));
});

test("une conversation à rallonge garde sa FIN et le dit", () => {
  const msgs = Array.from({ length: 500 }, (_, i) => ({
    sender: i % 2 ? "assistant" : "human",
    text: "message " + i,
    created_at: new Date(Date.UTC(2026, 1, 3, 0, i)).toISOString(),
  }));
  const { conv } = normaliser(claudeExport(msgs));
  assert.equal(conv.messages.length, 400);
  assert.equal(conv.messages.at(-1).content, "message 499", "la fin doit être gardée");
  assert.equal(conv.tronquee, true, "la troncature doit être signalée");
});

// --- Le lot ----------------------------------------------------------------------------

test("un import rejoué ne crée pas de doublons", () => {
  const liste = [chatgpt({ noeuds: CHAINE, courant: "m2" })];
  const premier = normaliserLot(liste);
  assert.equal(premier.ok.length, 1);
  const second = normaliserLot(liste, { dejaVues: new Set([premier.ok[0].origine.cle]) });
  assert.equal(second.ok.length, 0);
  assert.equal(second.ignorees[0].raison, "déjà importée");
});

test("deux fois la même conversation dans le MÊME fichier ne passe qu'une fois", () => {
  const c = chatgpt({ noeuds: CHAINE, courant: "m2" });
  const { ok, ignorees } = normaliserLot([c, c]);
  assert.equal(ok.length, 1);
  assert.equal(ignorees.length, 1);
});

test("ce qui est écarté ressort nommé — jamais d'import silencieusement amputé", () => {
  const { ok, ignorees } = normaliserLot([
    chatgpt({ noeuds: CHAINE, courant: "m2" }),
    { title: "Vide", mapping: {} },
    "pas un objet",
  ]);
  assert.equal(ok.length, 1);
  assert.equal(ignorees.length, 2);
  assert.equal(ignorees[0].titre, "Vide");
  assert.ok(ignorees.every((i) => i.raison));
});

test("deux conversations différentes gardent des clés différentes", () => {
  const a = cleDe({ conversation_id: "c-1" }, "chatgpt", "T", 1);
  const b = cleDe({ conversation_id: "c-2" }, "chatgpt", "T", 1);
  const c = cleDe({ uuid: "c-1" }, "claude", "T", 1);
  assert.notEqual(a, b);
  assert.notEqual(a, c, "même identifiant chez deux fournisseurs ≠ même conversation");
});

test("sans identifiant, la clé tient au titre et à la date", () => {
  const brut = { name: "Sans id", chat_messages: [{ sender: "human", text: "x", created_at: "2026-02-03T10:00:00Z" }] };
  const { ok } = normaliserLot([brut, { ...brut }]);
  assert.equal(ok.length, 1, "la même conversation sans id ne doit pas passer deux fois");
});

test("un lot qui n'est pas une liste ne fait pas planter l'import", () => {
  for (const v of [null, undefined, {}, "x"]) assert.deepEqual(normaliserLot(v).ok, []);
});
