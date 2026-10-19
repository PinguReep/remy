// Le CLI Claude Code (abonnement Max) tourne dans un dossier vide : il n'y
// trouve ni le CLAUDE.md de l'app, ni dépôt git, ni fichier de Rémy. Sans ça,
// « seule ta question partira » (V8) serait faux. Un faux `claude` note ce
// qu'il reçoit et d'où il est lancé.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const D = fs.mkdtempSync(path.join(os.tmpdir(), "remy-cli-test-"));
const trace = path.join(D, "trace.json");
const faux = path.join(D, "faux-claude");
fs.writeFileSync(
  faux,
  `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
if (process.argv.includes("--help")) {
  process.stdout.write("Options:\\n  --allowedTools <tools...>\\n  --disallowedTools <tools...>\\n  --no-session-persistence\\n  --strict-mcp-config\\n  --disable-slash-commands\\n");
  process.exit(0);
}
let entree = "";
process.stdin.on("data", (c) => (entree += c));
process.stdin.on("end", () => {
  const i = process.argv.indexOf("--system-prompt-file");
  const fichier = process.argv[i + 1];
  fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    contenuCwd: fs.readdirSync(process.cwd()),
    systeme: fs.readFileSync(fichier, "utf8"),
    systemeDansCwd: path.dirname(path.resolve(fichier)) === process.cwd(),
    entree,
    cle: process.env.ANTHROPIC_API_KEY || null,
    secrets: ["REMY_SAUVEGARDE_CLE", "MOTION_API_KEY", "SESSION_SECRET"].filter((k) => process.env[k]),
    session: process.env.CLAUDE_CODE_OAUTH_TOKEN || null,
    sansMemoire: [process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, process.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS, process.env.ENABLE_CLAUDEAI_MCP_SERVERS],
  }));
  const ev = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
  ev({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "La piscine ferme à 22 h." } } });
  ev({ type: "result", result: "La piscine ferme à 22 h.", usage: { input_tokens: 3, output_tokens: 5 } });
});
`,
  { mode: 0o755 }
);

process.env.REMY_PROVIDER = "claude-code";
process.env.REMY_CLAUDE_BIN = faux;
process.env.ANTHROPIC_API_KEY = "ne-doit-pas-partir";
process.env.REMY_SAUVEGARDE_CLE = "a".repeat(64);
process.env.MOTION_API_KEY = "motion-ne-doit-pas-partir";
process.env.SESSION_SECRET = "session-ne-doit-pas-partir";
process.env.CLAUDE_CODE_OAUTH_TOKEN = "session-claude-gardee";
const { getProvider } = await import("../lib/providers.js");
const tracer = () => JSON.parse(fs.readFileSync(trace, "utf8"));

test("le CLI tourne dans un dossier vide, effacé après, sans la clé API", { skip: process.platform === "win32" && "faux binaire à shebang" }, async () => {
  const appDir = process.cwd();
  const r = await getProvider().stream({
    system: [{ type: "text", text: "PROMPT-RECHERCHE" }],
    messages: [{ role: "user", content: "La piscine est ouverte ce soir ?" }],
  });
  assert.equal(r.text, "La piscine ferme à 22 h.");
  const t = JSON.parse(fs.readFileSync(trace, "utf8"));
  assert.notEqual(t.cwd, appDir, "pas le dossier de l'app (son CLAUDE.md partirait)");
  assert.deepEqual(t.contenuCwd, [], "dossier courant vide");
  assert.equal(t.systemeDansCwd, false, "le prompt système n'est pas dans le dossier courant");
  assert.match(t.systeme, /PROMPT-RECHERCHE/);
  assert.match(t.entree, /La piscine est ouverte ce soir \?/);
  assert.equal(t.cle, null, "jamais facturé sur l'API par surprise");
  assert.deepEqual(t.secrets, [], "aucun secret de la tour dans l'environnement du CLI");
  assert.equal(t.session, "session-claude-gardee", "la session Claude Code, elle, reste");
  // Sans accord de recherche : outils web retirés ; isolement du CLI.
  assert.ok(t.argv.includes("--disallowedTools"));
  assert.equal(t.argv.includes("--allowedTools"), false);
  for (const o of ["--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"]) assert.ok(t.argv.includes(o), o);
  assert.deepEqual(t.sansMemoire, ["1", "1", "1", "false"], "ni CLAUDE.md, ni mémoire auto, ni git, ni connecteurs");
  // Tout est effacé à la fin (prompt système compris : mémoire, planning…).
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.existsSync(path.dirname(t.cwd)), false);
});

test.after(() => fs.rmSync(D, { recursive: true, force: true }));

test("recherche autorisée (web) : WebSearch et WebFetch pré-approuvés, et seulement là", { skip: process.platform === "win32" && "faux binaire à shebang" }, async () => {
  await getProvider().stream({ system: [{ type: "text", text: "x" }], messages: [{ role: "user", content: "q" }], web: true });
  const t = tracer();
  const i = t.argv.indexOf("--allowedTools");
  assert.ok(i > 0);
  assert.equal(t.argv[i + 1], "WebSearch,WebFetch");
  assert.equal(t.argv.includes("--disallowedTools"), false);
  await getProvider().complete({ system: [{ type: "text", text: "x" }], prompt: "routeur" });
  assert.equal(tracer().argv.includes("--allowedTools"), false, "jamais pour une tâche de fond");
});
