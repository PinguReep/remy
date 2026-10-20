// Le prénom, le vocabulaire et les notes privées viennent de la tour (remy.env),
// jamais du dépôt public : vérifié dans un processus neuf, comme au démarrage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const lancer = (env, code) =>
  execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    env: { ...process.env, REMY_ENV: "test", ...env },
    encoding: "utf8",
  });

test("le prénom réglé sur la tour remplace partout le prénom fictif", () => {
  const out = lancer({ REMY_PRENOM: "Alex" }, `
    const { SYSTEM_PROMPT } = await import("./lib/chat.js");
    const { PROMPT_CAPTURE } = await import("./lib/capture.js");
    console.log(JSON.stringify({ s: SYSTEM_PROMPT, c: PROMPT_CAPTURE }));
  `);
  const { s, c } = JSON.parse(out.trim().split("\n").pop());
  assert.match(s, /l'assistant personnel de Alex/);
  assert.doesNotMatch(s + c, /\bSam\b|\bSAM\b/);
  assert.match(c, /Ce que ALEX écrit compte/);
});

test("sans réglage, un prénom fictif ; le vocabulaire de dictée s'ajoute à la liste générique", () => {
  const out = lancer({ REMY_PRENOM: "", REMY_VOCABULAIRE: "Hugo, céramique" }, `
    const p = await import("./lib/profil.js");
    console.log(JSON.stringify({ prenom: p.PRENOM, vocabulaire: p.VOCABULAIRE }));
  `);
  assert.deepEqual(JSON.parse(out.trim().split("\n").pop()), { prenom: "Sam", vocabulaire: "Hugo, céramique" });
});
