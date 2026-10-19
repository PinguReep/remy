// Le coffre Obsidian sur la tour : la mémoire y fait foi dans les deux sens, les
// conversations y ont une copie lisible qui suit renommages et suppressions, et
// la migration depuis Vercel n'écrase jamais une base déjà remplie.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const coffre = fs.mkdtempSync(path.join(os.tmpdir(), "coffre-remy-"));
process.env.REMY_VAULT = coffre;
for (const k of Object.keys(process.env)) if (/REST_API|UPSTASH|_URL$/.test(k) && k !== "REMY_VAULT") delete process.env[k];

const store = await import("../lib/store.js");
const lister = (d) => {
  try {
    return fs.readdirSync(path.join(coffre, d));
  } catch {
    return [];
  }
};

test.after(() => fs.rmSync(coffre, { recursive: true, force: true }));

test("la base vit dans <coffre>/.remy, hors de la vue d'Obsidian", () => {
  assert.equal(store.dossierBase(), path.join(coffre, ".remy"));
});

test("mémoire : écrite en Markdown, et une correction faite dans Obsidian est relue", async () => {
  await store.putMemory("## Identité\n- Sam [déclaré]");
  const md = fs.readFileSync(path.join(coffre, "Mémoire de Rémy.md"), "utf8");
  assert.match(md, /^---\n/);
  assert.match(md, /## Identité\n- Sam \[déclaré\]/);
  fs.writeFileSync(path.join(coffre, "Mémoire de Rémy.md"), md.replace("Sam [déclaré]", "Sam, 34 ans [déclaré]"));
  const lue = await store.getMemory();
  assert.equal(lue.text, "## Identité\n- Sam, 34 ans [déclaré]");
});

test("conversation : copie lisible, renommage sans doublon, suppression", async () => {
  const conv = { id: "abcdef12-0000", title: "Garage / devis", messages: [{ role: "user", content: "Salut" }, { role: "assistant", content: "Bonjour", model: "glm-5.3" }], createdAt: 1, updatedAt: 2 };
  await store.putConversation(conv);
  assert.deepEqual(lister("Conversations"), ["Garage devis (abcdef12).md"]);
  const md = fs.readFileSync(path.join(coffre, "Conversations", "Garage devis (abcdef12).md"), "utf8");
  assert.match(md, /\*\*Rémy\*\* · glm-5\.3\n\nBonjour/);
  await store.putConversation({ ...conv, title: "Devis du garage", prive: true });
  assert.deepEqual(lister("Conversations"), ["Devis du garage (abcdef12).md"]);
  const prive = fs.readFileSync(path.join(coffre, "Conversations", "Devis du garage (abcdef12).md"), "utf8");
  assert.match(prive, /^privee: true$/m);
  assert.match(prive, /^tags: \[rémy, privée\]$/m); // une vraie liste YAML : Obsidian lit les tags
  await store.deleteConversation(conv.id);
  assert.deepEqual(lister("Conversations"), []);
});

test("migration en fusion : la tour garde ses conversations, la mémoire Vercel remplace la locale mise de côté", async () => {
  await store.putConversation({ id: "33333333-cccc", title: "Du jour", messages: [], createdAt: 5, updatedAt: 5 });
  await store.putMemory("## Identité\n- mémoire de test");
  const e = {
    format: "remy-export",
    conversations: [{ id: "44444444-dddd", title: "De Vercel", messages: [], createdAt: 1, updatedAt: 1 }],
    memoire: { text: "## Identité\n- la vraie mémoire", updatedAt: 1 },
    couts: [{ ts: 1, kind: "conversation" }],
  };
  const bilan = await store.importerTout(e, { fusionner: true });
  assert.equal(bilan.conversations, 1);
  const titres = (await store.listConversations()).map((c) => c.title);
  assert.ok(titres.includes("Du jour") && titres.includes("De Vercel"), titres.join(","));
  assert.equal((await store.getMemory()).text, "## Identité\n- la vraie mémoire");
  assert.match(fs.readFileSync(path.join(coffre, "Mémoire de Rémy (avant migration).md"), "utf8"), /mémoire de test/);
  // Rejouer la fusion n'ajoute rien en double.
  assert.equal((await store.importerTout(e, { fusionner: true })).conversations, 0);
  await store.deleteConversation("33333333-cccc");
  await store.deleteConversation("44444444-dddd");
});

test("migration : export → import, et refus d'écraser une base remplie", async () => {
  await store.putConversation({ id: "11111111-aaaa", title: "Avant", messages: [], createdAt: 1, updatedAt: 1 });
  const e = await store.exporterTout();
  assert.equal(e.format, "remy-export");
  assert.equal(e.conversations.length, 1);
  await assert.rejects(store.importerTout(e), /--forcer/);
  e.conversations.push({ id: "22222222-bbbb", title: "Importée", messages: [{ role: "user", content: "x" }], createdAt: 3, updatedAt: 3 });
  e.briefings = [{ text: "- un sujet", generatedAt: Date.UTC(2026, 9, 8, 2) }];
  const bilan = await store.importerTout(e, { forcer: true });
  assert.equal(bilan.conversations, 2);
  assert.equal((await store.listConversations()).length, 2);
  // Non lus (iPhone) : la liste dit combien de messages et qui a parlé en dernier.
  await store.putConversation({ id: "55555555-eeee", title: "Réponse en attente", createdAt: 2, updatedAt: 2,
    messages: [{ role: "user", content: "Tu peux regarder ?" }, { role: "assistant", content: "C'est fait." }] });
  const r = (await store.listConversations()).find((c) => c.id === "55555555-eeee");
  assert.equal(r.messages, 2);
  assert.equal(r.dernier, "assistant");
  assert.equal((await store.listConversations()).find((c) => c.id === "11111111-aaaa")?.dernier ?? null, null, "fil vide : personne");
  await store.deleteConversation("55555555-eeee");
  assert.ok(lister("Conversations").includes("Importée (22222222).md"));
  assert.deepEqual(lister("Réflexions"), ["2026-10-08.md"]);
});
