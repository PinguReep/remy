// Conversations externes, soir du 29/10 : la tour trouvait ~\.claude\projects
// mais montrait 0 conversation, trouvait ~\.t3 mais « aucune base ». Ici :
// la règle d'exclusion précise (Rémy et les « claude -p » d'un seul échange
// écartés, tout le reste lu, quel que soit l'entrypoint), sa migration (ce qui
// avait été écarté est relu), le diagnostic qui dit la vraie raison, T3 rangé
// comme un fork le range, et l'export ChatGPT pris dans Téléchargements sans y
// toucher. Données FICTIVES de bout en bout (Sam, la boutique de bougies).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

console.log = () => {};
console.warn = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-conv-sources-"));
const maison = path.join(dossier, "maison");
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_SOURCE_CLAUDE_CODE", "REMY_SOURCE_T3", "REMY_SOURCE_CHATGPT",
  "REMY_CONNAISSANCES_PROJETS", "REMY_CONVERSATIONS_CLE", "REMY_CONVERSATIONS_USAGE", "REMY_CLAUDE_DIRS", "CLAUDE_CONFIG_DIR", "T3CODE_HOME", "REMY_T3_DIRS", "REMY_IMPORT_MAX_MO",
  "REMY_TELECHARGEMENTS", "APPDATA", "XDG_CONFIG_HOME"]) delete process.env[v];
process.env.REMY_DATA_DIR = path.join(dossier, "data");
process.env.REMY_CLES_DIR = path.join(dossier, "cles");
process.env.REMY_IMPORTS_DIR = path.join(dossier, "imports");
// Tout est cherché à ses emplacements PAR DÉFAUT, dans une maison fictive :
// ~/.claude, ~/.t3, le profil de l'app, ~/Downloads.
process.env.HOME = maison;
process.env.USERPROFILE = maison;
fs.mkdirSync(maison, { recursive: true });

const fx = await import("./outils/conversations-fictives.mjs");
const claude = await import("../lib/connaissances/claudeCode.js");
const t3 = await import("../lib/connaissances/t3.js");
const sync = await import("../lib/connaissances/sync.js");
const { routeApi } = await import("../lib/routes.js");
const { fermer, base } = await import("../lib/connaissances/base.js");
const { fermer: fermerRemy } = await import("../lib/db.js");

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const adresse = `http://127.0.0.1:${remy.address().port}`;
test.after(() => {
  remy.close();
  fermer();
  fermerRemy();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const json = async (methode, chemin, corps) => {
  const r = await fetch(adresse + chemin, { method: methode, headers: { "Content-Type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps) });
  return { status: r.status, corps: await r.json() };
};
const lire = async (src) => (await json("POST", "/api/conversations-externes/synchroniser", src ? { source: src } : {})).corps;
const etat = async () => (await json("GET", "/api/conversations-externes")).corps;
const source = (e, id) => e.sources.find((s) => s.id === id);
const iso = (ms) => new Date(ms).toISOString();
const HIER = Date.now() - 24 * 3600_000;
const racineClaude = path.join(maison, ".claude");
const sid = (n) => `5e55c0de-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Une session de plusieurs échanges.
const echanges = (n, sujet) =>
  Array.from({ length: n }, (_, i) => [
    { role: "user", texte: `${sujet} : question ${i + 1} sur la boutique de bougies.`, ts: iso(HIER + i * 120_000) },
    { role: "assistant", texte: `${sujet} : réponse ${i + 1}, la bougie Figuier tient 40 heures.`, ts: iso(HIER + i * 120_000 + 60_000) },
  ]).flat();

// L'empreinte d'un dossier : noms, tailles, dates et contenus.
function empreinte(d) {
  const h = crypto.createHash("sha256");
  const parcourir = (x) => {
    for (const e of fs.readdirSync(x, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(x, e.name);
      if (e.isDirectory()) parcourir(p);
      else {
        const st = fs.statSync(p);
        h.update(p).update(String(st.size)).update(String(st.mtimeMs)).update(fs.readFileSync(p));
      }
    }
  };
  parcourir(d);
  return h.digest("hex");
}

// =============================================================================================
// La règle d'exclusion
// =============================================================================================

test("règle : seules les sessions de Rémy et les « claude -p » d'un seul échange sont écartées", () => {
  const r = (etat) => claude.exclusion(etat);
  assert.equal(r({ cwd: "C:\\Users\\sam\\AppData\\Local\\Temp\\remy-claude-AbC12\\vide", entrypoint: "sdk-cli", echanges: 1 }), "remy");
  assert.equal(r({ cwd: "/tmp/remy-claude-x9/vide/", entrypoint: "sdk-cli", echanges: 3 }), "remy", "Rémy, même de plusieurs échanges");
  assert.equal(r({ entrypoint: "remy", cwd: "C:\\code\\bougies", echanges: 4 }), "remy");
  assert.equal(r({ cwd: "C:\\Users\\sam\\AppData\\Local\\Temp\\t3code-claude-title-Zx9", entrypoint: "sdk-cli", echanges: 1 }), "programme");
  assert.equal(r({ cwd: "C:\\code\\bougies", entrypoint: "sdk-cli", echanges: 1 }), "programme");
  assert.equal(r({ cwd: "C:\\code\\bougies", entrypoint: "sdk-cli", echanges: 0 }), "programme");
  // Une vraie conversation, d'où qu'elle vienne.
  assert.equal(r({ cwd: "C:\\code\\bougies", entrypoint: "sdk-cli", echanges: 2 }), null, "Remote Control : plusieurs échanges");
  for (const entrypoint of ["cli", "claude-desktop", "sdk-ts", "sdk-py", "remote", "remote_mobile", "claude-vscode", "local-agent", undefined]) {
    assert.equal(r({ cwd: "C:\\code\\bougies", entrypoint, echanges: 1 }), null, String(entrypoint));
  }
  // Un dossier qui ressemble sans l'être.
  assert.equal(r({ cwd: "C:\\code\\remy-claude-notes\\vide-grenier", entrypoint: "cli", echanges: 1 }), null);
});

test("Claude Code : l'app de bureau, l'Agent SDK, Remote Control et le terminal sont lus ; Rémy et les titres de T3 écartés", async () => {
  const s = (n, o) => fx.ecrireSessionClaude(racineClaude, { session: sid(n), ...o });
  s(1, { entrypoint: "claude-desktop", titre: "Fiches produits", messages: echanges(3, "Bureau") });
  s(2, { entrypoint: "sdk-ts", messages: echanges(2, "SDK") });
  s(3, { entrypoint: "sdk-cli", messages: echanges(2, "Remote Control") });
  s(4, { entrypoint: "cli", messages: echanges(1, "Terminal") });
  s(5, { entrypoint: undefined, messages: echanges(1, "Ancien CLI") });
  // À écarter : Rémy lui-même (son dossier vide), un titre de T3, un claude -p de commit.
  s(6, { dossier: "C--Users-sam-AppData-Local-Temp-remy-claude-AbC12-vide", cwd: "C:\\Users\\sam\\AppData\\Local\\Temp\\remy-claude-AbC12\\vide", entrypoint: "sdk-cli", messages: [{ role: "user", texte: "Consigne de Rémy", ts: iso(HIER) }, { role: "assistant", texte: "Réponse", ts: iso(HIER + 1000) }] });
  s(7, { dossier: "C--Temp-t3code-claude-title-Zx9", cwd: "C:\\Temp\\t3code-claude-title-Zx9", entrypoint: "sdk-cli", messages: [{ role: "user", texte: "Donne un titre", ts: iso(HIER) }, { role: "assistant", texte: "{\"title\":\"Bougies\"}", ts: iso(HIER + 1000) }] });
  s(8, { entrypoint: "sdk-cli", messages: [{ role: "user", texte: "Écris le message de commit.", ts: iso(HIER) }, { role: "assistant", texte: "fix: bougies", ts: iso(HIER + 1000) }] });
  // Un sous-agent, rangé dans <session>/subagents/ : jamais listé.
  const sous = path.join(racineClaude, "projects", "C--Users-sam-code-bougies", sid(1), "subagents");
  fs.mkdirSync(sous, { recursive: true });
  fs.writeFileSync(path.join(sous, "agent-a1.jsonl"), JSON.stringify({ type: "user", uuid: "u-sous", sessionId: sid(1), cwd: "C:\\code\\bougies", isSidechain: true, message: { role: "user", content: "sous-tâche" } }) + "\n");
  const avant = empreinte(racineClaude);
  const r = await lire("claude-code");
  const b = r.bilan.sources["claude-code"];
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(b.fichiers, 8, "le sous-agent n'est pas une session");
  assert.deepEqual(b.recensement.ecartees, { remy: 1, programme: 2, horsFiltre: 0, sansDossier: 0 });
  assert.equal(b.recensement.gardees, 5);
  assert.equal(empreinte(racineClaude), avant, "rien d'écrit chez Claude Code");
  const e = source(r.etat, "claude-code");
  assert.equal(e.conversations, 5);
  assert.equal(e.aide, null);
  assert.equal(e.recensement.phrase, "8 sessions : 5 lues, 2 d'un seul échange lancées par un programme (claude -p), 1 de Rémy lui-même.");
  const titres = (await json("GET", "/api/conversations-externes/liste?source=claude-code")).corps.conversations.map((c) => c.titre);
  assert.ok(titres.includes("Fiches produits"));
  assert.ok(!titres.some((t) => /Consigne de Rémy|Donne un titre|commit/.test(t)), titres.join(" | "));
});

test("Claude Code : un « claude -p » qui devient une conversation (deuxième échange) est relu en entier", async () => {
  const f = path.join(racineClaude, "projects", "C--Users-sam-code-bougies", `${sid(8)}.jsonl`);
  fs.appendFileSync(f, JSON.stringify({ type: "user", uuid: "u-suite", parentUuid: null, sessionId: sid(8), timestamp: iso(HIER + 5000), cwd: "C:\\Users\\sam\\code\\bougies", entrypoint: "sdk-cli", isSidechain: false, message: { role: "user", content: "Et ajoute la date de vendredi." } }) + "\n");
  const r = await lire("claude-code");
  const e = source(r.etat, "claude-code");
  assert.equal(e.conversations, 6);
  const c = (await json("GET", `/api/conversations-externes/conversations/claude-code/${sid(8)}`)).corps;
  assert.deepEqual(c.messages.map((m) => m.texte), ["Écris le message de commit.", "fix: bougies", "Et ajoute la date de vendredi."], "le premier échange n'est pas perdu");
});

test("migration : des curseurs posés par l'ancienne règle (sessions « inchangées » jamais écrites) sont relus une fois", async () => {
  // L'état d'une tour du 29/10 : une session sdk-cli de plusieurs échanges
  // écartée par l'ancienne règle, une autre lue sans rien donner (sa
  // conversation absente), toutes deux « inchangées » depuis.
  const b = base();
  const cles = b.prepare("SELECT cle, conversation FROM curseurs WHERE source = 'claude-code'").all();
  const de = (n) => cles.find((c) => c.conversation === sid(n)).cle;
  b.prepare("UPDATE curseurs SET exclu = 'entrypoint:sdk-cli' WHERE cle = ?").run(de(3));
  b.prepare("DELETE FROM messages WHERE source = 'claude-code' AND conversation IN (?, ?)").run(sid(3), sid(2));
  b.prepare("DELETE FROM conversations WHERE source = 'claude-code' AND id IN (?, ?)").run(sid(3), sid(2));
  b.prepare("UPDATE meta SET valeur = '1' WHERE cle = 'regle_claude'").run();
  assert.equal(source(await etat(), "claude-code").conversations, 4);
  const r = await lire("claude-code");
  const bl = r.bilan.sources["claude-code"];
  assert.ok(bl.aRelire >= 2, JSON.stringify(bl));
  assert.equal(source(r.etat, "claude-code").conversations, 6, "les deux sessions sont revenues");
  // Une seule fois : la lecture suivante ne relit plus rien.
  const r2 = await lire("claude-code");
  assert.equal(r2.bilan.sources["claude-code"].aRelire, 0);
  assert.equal(r2.bilan.sources["claude-code"].lus, 0);
  assert.equal(r2.bilan.sources["claude-code"].inchanges, 8);
});

test("diagnostic : « aucune session », « toutes écartées (raison) », « rien de lisible (format inconnu) »", async () => {
  // Une autre racine, seule : REMY_CLAUDE_DIRS, la maison mise de côté.
  const autre = path.join(dossier, "claude-vide");
  fs.mkdirSync(path.join(autre, "projects"), { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = autre;
  const garde = path.join(dossier, "claude-de-cote");
  fs.renameSync(racineClaude, garde);
  try {
    await json("DELETE", "/api/conversations-externes/sources/claude-code");
    await json("PUT", "/api/conversations-externes/sources/claude-code", { actif: true });
    let s = source((await lire("claude-code")).etat, "claude-code");
    assert.equal(s.aide.code, "aucune-session");
    assert.match(s.aide.message, /ne contient aucune session/);
    // Que des programmes : toutes écartées, et pourquoi.
    fx.ecrireSessionClaude(autre, { session: sid(20), entrypoint: "sdk-cli", messages: [{ role: "user", texte: "titre ?", ts: iso(HIER) }] });
    fx.ecrireSessionClaude(autre, { session: sid(21), dossier: "C--Temp-remy-claude-Q-vide", cwd: "C:\\Temp\\remy-claude-Q\\vide", entrypoint: "sdk-cli", messages: echanges(2, "Rémy") });
    s = source((await lire("claude-code")).etat, "claude-code");
    assert.equal(s.conversations, 0);
    assert.equal(s.aide.code, "ecartees");
    assert.equal(s.aide.message, "2 sessions trouvées, aucune gardée : 1 d'un seul échange lancée par un programme (claude -p), 1 de Rémy lui-même.");
    // Un format que Rémy ne comprend pas (le contenu n'est ni texte ni blocs).
    fs.rmSync(path.join(autre, "projects"), { recursive: true });
    fs.mkdirSync(path.join(autre, "projects", "C--code-x"), { recursive: true });
    const bizarre = (u, type) => JSON.stringify({ type, uuid: u, sessionId: sid(22), cwd: "C:\\code\\x", entrypoint: "claude-desktop", timestamp: iso(HIER), message: { role: type, content: { forme: "inconnue" } } });
    fs.writeFileSync(path.join(autre, "projects", "C--code-x", `${sid(22)}.jsonl`), [bizarre("a", "user"), bizarre("b", "assistant")].join("\n") + "\n");
    s = source((await lire("claude-code")).etat, "claude-code");
    assert.equal(s.aide.code, "format-inconnu");
    assert.equal(s.aide.message, "1 session trouvée, aucune gardée : 1 d'un format inconnu.");
    assert.match(s.aide.quoiFaire, /connaissances-etat\.mjs --lire/);
    // L'ancien iPhone n'a besoin que de message et quoiFaire.
    for (const k of ["code", "message", "quoiFaire"]) assert.ok(k in s.aide);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.renameSync(garde, racineClaude);
  }
  await json("DELETE", "/api/conversations-externes/sources/claude-code");
  await json("PUT", "/api/conversations-externes/sources/claude-code", { actif: true });
  assert.equal(source((await lire("claude-code")).etat, "claude-code").conversations, 6);
});

test("script de la tour : connaissances-etat.mjs dit le recensement et la vraie raison", async () => {
  const { execFileSync } = await import("node:child_process");
  const sortie = execFileSync(process.execPath, ["--no-warnings", path.resolve("scripts/connaissances-etat.mjs"), "--lire"], { env: process.env, encoding: "utf8" });
  assert.match(sortie, /Claude Code : allumée/);
  assert.match(sortie, /8 sessions : 6 lues, 1 d'un seul échange lancée par un programme \(claude -p\), 1 de Rémy lui-même\./);
  assert.match(sortie, /Lecture : 8 fichier\(s\), 0 lu\(s\), 8 inchangé\(s\)/);
  assert.match(sortie, /T3 Code : allumée/);
  assert.match(sortie, /Téléchargements/);
  assert.ok(!/bougies|Figuier/i.test(sortie), "jamais le contenu des conversations");
});

// =============================================================================================
// T3 Code : là où le fork range sa base
// =============================================================================================

const filsT3 = (prefixe, titre) => ({
  projets: [{ id: `${prefixe}-proj`, titre: "Site de la boutique", racine: "C:\\Users\\sam\\code\\site-boutique" }],
  fils: [{ id: `${prefixe}-fil`, projet: `${prefixe}-proj`, titre, fournisseur: "codex", cree: iso(HIER) }],
  messages: [
    { id: `${prefixe}-m1`, fil: `${prefixe}-fil`, role: "user", texte: `${titre} : la livraison offerte dès 49 euros.`, cree: iso(HIER) },
    { id: `${prefixe}-m2`, fil: `${prefixe}-fil`, role: "assistant", texte: "C'est réglé.", cree: iso(HIER + 60_000) },
  ],
});

test("T3 : rien trouvé → « où Rémy a cherché », dit utilement", async () => {
  const s = source((await lire()).etat, "t3");
  assert.equal(s.disponible, false);
  assert.equal(s.aide.code, "introuvable");
  assert.match(s.aide.quoiFaire, /REMY_T3_DIRS/);
  const l = s.emplacements.find((x) => x.chemin === "~/.t3" || x.chemin === "~\\.t3");
  assert.ok(l, JSON.stringify(s.emplacements));
  assert.equal(l.trouve, false);
  assert.match(l.origine, /dossier de l'utilisateur · absent/);
  assert.ok(!s.emplacements.some((x) => /profil/.test(x.origine)), "un profil d'app absent n'est pas cité");
});

test("T3 : une base de dev vide ne cache plus l'ancienne base ; le profil de l'app (Alpha) et un dossier imbriqué sont trouvés ; worktrees ignoré", async () => {
  const t3dir = path.join(maison, ".t3");
  // Comme le fork : l'ancienne base dans userdata, une base V2 VIDE dans dev.
  fx.creerBaseT3(path.join(t3dir, "dev", "statev2.sqlite"), {});
  creerBaseV1(path.join(t3dir, "userdata", "state.sqlite"), filsT3("v1", "Ancienne base"));
  // Une base rangée plus profond (profil nommé), et une dans worktrees (jamais lue).
  fx.creerBaseT3(path.join(t3dir, "profils", "alpha", "userdata", "statev2.sqlite"), filsT3("prof", "Profil alpha"));
  fx.creerBaseT3(path.join(t3dir, "worktrees", "site", ".t3", "userdata", "statev2.sqlite"), filsT3("wt", "Copie de travail"));
  // Le profil Electron « T3 Code (Alpha) » (sous Linux : ~/.config).
  fx.creerBaseT3(path.join(maison, ".config", "T3 Code (Alpha)", "userdata", "statev2.sqlite"), filsT3("app", "Profil de l'app"));
  const avant = empreinte(t3dir);
  const r = await lire("t3");
  const b = r.bilan.sources.t3;
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(b.bases, 4, JSON.stringify(b.detail));
  assert.ok(!b.detail.some((d) => /worktrees/.test(d.chemin)));
  const s = source(r.etat, "t3");
  assert.equal(s.conversations, 3);
  const titres = (await json("GET", "/api/conversations-externes/liste?source=t3")).corps.conversations.map((c) => c.titre).sort();
  assert.deepEqual(titres, ["Ancienne base", "Profil alpha", "Profil de l'app"]);
  assert.equal(s.recensement.phrase, "4 bases, 3 fils : 3 lus.");
  const lignes = s.emplacements.filter((x) => x.trouve).map((x) => x.origine);
  assert.ok(lignes.includes("dossier de l'utilisateur · ancienne base") && lignes.includes("dossier de l'utilisateur · base V2") && lignes.includes("profil de l'app · base V2"), lignes.join(" | "));
  assert.equal(empreinte(t3dir), avant, "rien d'écrit chez T3");
});

test("T3 : T3CODE_HOME en « ~/… » est compris ; une base sans aucun fil le dit", async () => {
  const home = path.join(maison, "T3 maison");
  fx.creerBaseT3(path.join(home, "userdata", "statev2.sqlite"), {});
  process.env.T3CODE_HOME = "~/T3 maison";
  const garde = path.join(dossier, "t3-de-cote");
  fs.renameSync(path.join(maison, ".t3"), garde);
  fs.renameSync(path.join(maison, ".config"), `${garde}-config`);
  try {
    assert.equal(t3.deplier("~/T3 maison"), home);
    await json("DELETE", "/api/conversations-externes/sources/t3");
    await json("PUT", "/api/conversations-externes/sources/t3", { actif: true });
    const s = source((await lire("t3")).etat, "t3");
    assert.equal(s.disponible, true);
    assert.equal(s.aide.code, "base-vide");
    assert.match(s.aide.message, /Base de T3 Code trouvée \(.*T3 maison.*statev2\.sqlite\), mais sans aucun fil\./);
    assert.match(s.aide.quoiFaire, /WSL/);
    assert.ok(s.emplacements.some((x) => x.origine === "T3CODE_HOME · base V2" && x.trouve));
  } finally {
    delete process.env.T3CODE_HOME;
    fs.renameSync(garde, path.join(maison, ".t3"));
    fs.renameSync(`${garde}-config`, path.join(maison, ".config"));
  }
  await json("DELETE", "/api/conversations-externes/sources/t3");
  await json("PUT", "/api/conversations-externes/sources/t3", { actif: true });
  assert.equal(source((await lire("t3")).etat, "t3").conversations, 3);
});

// L'ancienne base de T3 (avant la V2) : projection_threads, projection_thread_messages.
function creerBaseV1(fichier, { projets = [], fils = [], messages = [] }) {
  const b = fx.ouvrirBaseT3(fichier);
  b.exec(`PRAGMA journal_mode = DELETE;
    CREATE TABLE projection_projects (project_id TEXT PRIMARY KEY, title TEXT NOT NULL, workspace_root TEXT NOT NULL, created_at TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE projection_threads (thread_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
    CREATE TABLE projection_thread_messages (message_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, is_streaming INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  for (const p of projets) b.prepare("INSERT INTO projection_projects (project_id, title, workspace_root) VALUES (?, ?, ?)").run(p.id, p.titre, p.racine);
  for (const f of fils) b.prepare("INSERT INTO projection_threads (thread_id, project_id, title, model, created_at, updated_at) VALUES (?, ?, ?, 'claude-sonnet', ?, ?)").run(f.id, f.projet, f.titre, f.cree, f.cree);
  for (const m of messages) b.prepare("INSERT INTO projection_thread_messages (message_id, thread_id, role, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(m.id, m.fil, m.role, m.texte, m.cree, m.cree);
  b.close();
}

// =============================================================================================
// ChatGPT : l'export pris dans Téléchargements, sans y toucher
// =============================================================================================

const telechargements = path.join(maison, "Downloads");
const conv = (id, titre, q) => fx.conversationChatGPT({ id, titre, debut: Math.round(HIER / 1000), echanges: [[q, "Bonne idée pour la boutique."]] });
const ilYa = (jours) => new Date(Date.now() - jours * 86_400_000);

test("Téléchargements : seul l'export ChatGPT est importé, une fois ; rien n'y est déplacé, renommé, effacé ni modifié", async () => {
  fs.mkdirSync(telechargements, { recursive: true });
  const ecrire = (nom, contenu, jours = 1) => {
    const f = path.join(telechargements, nom);
    fs.writeFileSync(f, contenu);
    fs.utimesSync(f, ilYa(jours), ilYa(jours));
    return f;
  };
  ecrire("4d8e-export-2026-10-28.zip", fx.exportChatGPT([conv("6f1c0000-bbbb-4000-8000-000000000001", "Coffrets de Noël", "Trois idées de coffrets ?")]));
  ecrire("photos-vacances.zip", fx.zipper([{ nom: "IMG_0001.jpg", contenu: Buffer.from([0xff, 0xd8, 0xff]) }, { nom: "notes.txt", contenu: "rien" }]));
  ecrire("archive-dossier.zip", fx.zipper([{ nom: "vieux/conversations.json", contenu: "[]" }]));
  ecrire("export-ancien.zip", fx.exportChatGPT([conv("6f1c0000-bbbb-4000-8000-000000000002", "Très ancien", "Une vieille question ?")]), 120);
  // Un autre assistant range aussi un conversations.json à la racine : pas ChatGPT.
  ecrire("export-autre-assistant.zip", fx.zipper([{ nom: "conversations.json", contenu: JSON.stringify([{ uuid: "x", name: "Autre", chat_messages: [{ text: "bonjour" }] }]) }, { nom: "users.json", contenu: "[]" }]));
  ecrire("facture.pdf", "%PDF-1.4 fictif");
  const avant = empreinte(telechargements);
  const r = await lire("chatgpt");
  const b = r.bilan.sources.chatgpt;
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(b.telechargements.dossiers, 1);
  assert.equal(b.telechargements.zips, 5);
  assert.equal(b.telechargements.importes, 1);
  assert.equal(b.telechargements.tropVieux, 1);
  assert.equal(b.telechargements.autres, 3, "photos, dossier imbriqué, autre assistant");
  assert.equal(empreinte(telechargements), avant, "Téléchargements intact : présence, taille, date, contenu");
  assert.deepEqual(fs.readdirSync(telechargements).sort(), ["4d8e-export-2026-10-28.zip", "archive-dossier.zip", "export-ancien.zip", "export-autre-assistant.zip", "facture.pdf", "photos-vacances.zip"]);
  const s = source(r.etat, "chatgpt");
  assert.equal(s.conversations, 1);
  assert.ok(s.emplacements.some((x) => x.origine === "Téléchargements, lecture seule" && x.trouve && /Downloads$/.test(x.chemin)), JSON.stringify(s.emplacements));
  assert.equal(r.etat.imports.importes, 1, "l'autre assistant n'est pas compté comme un import");
  // Le passage suivant : rien n'est relu ni réimporté.
  const r2 = await lire("chatgpt");
  assert.equal(r2.bilan.sources.chatgpt.telechargements.importes, 0);
  assert.equal(r2.bilan.sources.chatgpt.telechargements.exports, 0, "aucun .zip rouvert");
  assert.equal(r2.etat.imports.importes, 1);
  assert.equal(empreinte(telechargements), avant);
});

test("Téléchargements : un export déjà importé (envoyé depuis l'app) n'est pas réimporté ; un .zip abîmé le dit sans y toucher", async () => {
  const contenu = fx.exportChatGPT([conv("6f1c0000-bbbb-4000-8000-000000000003", "Envoyé depuis l'iPhone", "Prix du coffret ?")]);
  const r0 = await fetch(`${adresse}/api/conversations-externes/chatgpt`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: contenu });
  assert.equal(r0.status, 200);
  const f = path.join(telechargements, "export-meme.zip");
  fs.writeFileSync(f, contenu);
  fs.utimesSync(f, ilYa(1), ilYa(1));
  let r = await lire("chatgpt");
  assert.equal(r.bilan.sources.chatgpt.telechargements.deja, 2, "celui d'avant, et celui-ci reconnu à son empreinte");
  assert.equal(r.bilan.sources.chatgpt.telechargements.importes, 0);
  assert.equal(r.etat.imports.importes, 2);
  // Un export abîmé (annuaire lisible, contenu tronqué) : l'erreur, et quoi faire.
  const abime = Buffer.from(fx.exportChatGPT([conv("6f1c0000-bbbb-4000-8000-000000000004", "Abîmé", "?")]));
  const debut = abime.indexOf(Buffer.from("conversations.json")) + 40;
  abime[debut] ^= 0xff;
  abime[debut + 1] ^= 0xff;
  const g = path.join(telechargements, "export-abime.zip");
  fs.writeFileSync(g, abime);
  fs.utimesSync(g, ilYa(1), ilYa(1));
  const avant = empreinte(telechargements);
  r = await lire("chatgpt");
  assert.equal(r.bilan.sources.chatgpt.ok, false);
  assert.equal(source(r.etat, "chatgpt").erreur.code, "zip-invalide");
  assert.match(source(r.etat, "chatgpt").erreur.quoiFaire, /Retélécharge/);
  assert.equal(empreinte(telechargements), avant);
  fs.rmSync(g); // c'est l'utilisateur qui l'efface, jamais Rémy
  r = await lire("chatgpt");
  assert.equal(source(r.etat, "chatgpt").erreur, null);
});

test("Téléchargements : coupable dans l'app, REMY_TELECHARGEMENTS (plusieurs dossiers, « off ») sur la tour", async () => {
  let e = (await json("PUT", "/api/conversations-externes/sources/chatgpt", { telechargements: false })).corps;
  assert.equal(e.chatgpt.telechargements.actif, false);
  assert.ok(!source(e, "chatgpt").emplacements.some((x) => /Téléchargements/.test(x.origine)));
  const f = path.join(telechargements, "export-pendant-la-coupure.zip");
  fs.writeFileSync(f, fx.exportChatGPT([conv("6f1c0000-bbbb-4000-8000-000000000005", "Pendant la coupure", "?")]));
  fs.utimesSync(f, ilYa(1), ilYa(1));
  let r = await lire("chatgpt");
  assert.equal(r.bilan.sources.chatgpt.telechargements.coupe, true);
  assert.equal(r.etat.imports.importes, 2);
  e = (await json("PUT", "/api/conversations-externes/sources/chatgpt", { telechargements: true })).corps;
  assert.equal(e.chatgpt.telechargements.actif, true);
  // Deux dossiers, « ; » entre eux.
  const second = path.join(dossier, "Téléchargements du NAS");
  fs.mkdirSync(second, { recursive: true });
  const g = path.join(second, "export-nas.zip");
  fs.writeFileSync(g, fx.exportChatGPT([conv("6f1c0000-bbbb-4000-8000-000000000006", "Depuis le NAS", "?")]));
  fs.utimesSync(g, ilYa(2), ilYa(2));
  process.env.REMY_TELECHARGEMENTS = `${telechargements};${second}`;
  try {
    r = await lire("chatgpt");
    assert.equal(r.bilan.sources.chatgpt.telechargements.dossiers, 2);
    assert.equal(r.bilan.sources.chatgpt.telechargements.importes, 2);
    assert.equal(r.etat.chatgpt.telechargements.dossiers.length, 2);
  } finally {
    delete process.env.REMY_TELECHARGEMENTS;
  }
  process.env.REMY_TELECHARGEMENTS = "off";
  try {
    e = await etat();
    assert.deepEqual([e.chatgpt.telechargements.actif, e.chatgpt.telechargements.forceParLaTour, e.chatgpt.telechargements.dossiers.length], [false, true, 0]);
  } finally {
    delete process.env.REMY_TELECHARGEMENTS;
  }
  assert.equal((await json("PUT", "/api/conversations-externes/sources/chatgpt", {})).status, 400);
  assert.equal((await json("PUT", "/api/conversations-externes/sources/t3", { telechargements: false })).status, 400, "un réglage de ChatGPT seulement");
});

test("carte « Exporter ChatGPT » : jamais importé (source allumée), ou plus de 30 jours ; coupable ; un export qui attend la fait taire", async () => {
  let e = await etat();
  assert.equal(e.chatgpt.rappel.aMontrer, false, "importé aujourd'hui");
  assert.equal(e.chatgpt.rappel.lien, "https://chatgpt.com/#settings/DataControls");
  assert.equal(e.chatgpt.rappel.seuilJours, 30);
  assert.equal(e.chatgpt.rappel.depuisJours, 0);
  // Le dernier import a 31 jours.
  base().prepare("UPDATE imports SET a = ?").run(Date.now() - 31 * 86_400_000);
  e = await etat();
  assert.equal(e.chatgpt.rappel.aMontrer, true);
  assert.equal(e.chatgpt.rappel.depuisJours, 31);
  // Coupée dans les Réglages.
  e = (await json("PUT", "/api/conversations-externes/sources/chatgpt", { rappel: false })).corps;
  assert.deepEqual([e.chatgpt.rappel.actif, e.chatgpt.rappel.aMontrer], [false, false]);
  e = (await json("PUT", "/api/conversations-externes/sources/chatgpt", { rappel: true })).corps;
  assert.equal(e.chatgpt.rappel.aMontrer, true);
  // Un export qui attend dans Imports : il sera lu, pas besoin de le redemander.
  fs.mkdirSync(process.env.REMY_IMPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.REMY_IMPORTS_DIR, "export.zip"), "pas encore lu");
  assert.equal((await etat()).chatgpt.rappel.aMontrer, false);
  fs.rmSync(path.join(process.env.REMY_IMPORTS_DIR, "export.zip"));
  // La source coupée : pas de carte.
  e = (await json("PUT", "/api/conversations-externes/sources/chatgpt", { actif: false })).corps;
  assert.equal(e.chatgpt.rappel.aMontrer, false);
  // Jamais importé, source allumée : la carte.
  await json("DELETE", "/api/conversations-externes/sources/chatgpt");
  e = (await json("PUT", "/api/conversations-externes/sources/chatgpt", { actif: true })).corps;
  assert.deepEqual([e.chatgpt.rappel.dernierImport, e.chatgpt.rappel.aMontrer], [null, true]);
  assert.match(source(e, "chatgpt").aide.quoiFaire, /Rémy prend le \.zip dans Téléchargements/);
});
