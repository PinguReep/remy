// Mémoire de projets, lot B : lire les sessions Claude Code en lecture seule,
// n'en garder que le dialogue (masqué), sans jamais rien écrire chez Claude
// Code. Sessions fictives de bout en bout.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

console.log = () => {};
console.warn = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-connaissances-"));
const racineClaude = path.join(dossier, "claude");
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_SOURCE_CLAUDE_CODE", "REMY_CONNAISSANCES_PROJETS"]) delete process.env[v];
process.env.REMY_DATA_DIR = path.join(dossier, "data");
process.env.CLAUDE_CONFIG_DIR = racineClaude;
process.env.HOME = path.join(dossier, "maison"); // pas de ~/.claude réel lu par les tests
process.env.USERPROFILE = process.env.HOME;
process.env.FAUX_SECRET_DE_LA_TOUR_TOKEN = "valeur-tres-secrete-123";

const { masquer, fichierSensible, oublierSecretsDeLaTour } = await import("../lib/connaissances/masquage.js");
const claude = await import("../lib/connaissances/claudeCode.js");
const sync = await import("../lib/connaissances/sync.js");
const { routeApi } = await import("../lib/routes.js");
oublierSecretsDeLaTour();

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); fs.rmSync(dossier, { recursive: true, force: true }); });

// --- Fabrique de sessions fictives -------------------------------------------------
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
function ligne(type, contenu, extra = {}) {
  return { type, uuid: uuid(), parentUuid: null, sessionId: extra.sessionId || "s-1", timestamp: extra.timestamp || "2026-10-10T09:00:00.000Z",
    cwd: extra.cwd || "C:\\Users\\sam\\code\\projet-essai", entrypoint: extra.entrypoint || "claude-desktop", isSidechain: false,
    message: { role: type === "user" ? "user" : "assistant", content: contenu }, ...extra };
}
function ecrireSession(nomDossier, fichier, lignes) {
  const d = path.join(racineClaude, "projects", nomDossier);
  fs.mkdirSync(d, { recursive: true });
  const p = path.join(d, fichier);
  fs.writeFileSync(p, lignes.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return p;
}
const empreinteDossier = () => {
  const h = crypto.createHash("sha256");
  const parcourir = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) parcourir(p);
      else h.update(p).update(fs.readFileSync(p)).update(String(fs.statSync(p).mtimeMs));
    }
  };
  parcourir(racineClaude);
  return h.digest("hex");
};
const json = async (methode, chemin, corps) => {
  const r = await fetch(base + chemin, { method: methode, headers: { "Content-Type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps) });
  return { status: r.status, corps: await r.json() };
};

// --- Masquage ---------------------------------------------------------------------
test("les secrets sont masqués avant tout stockage, le reste du texte non", () => {
  const canaris = [
    "sk-ant-api03-FAUXFAUXFAUXFAUXFAUX0000",
    "sk-proj-FAUXFAUXFAUXFAUXFAUXFAUX00",
    "ghp_FAUXFAUXFAUXFAUXFAUXFAUXFAUX000000",
    "AKIAFAUXFAUXFAUX0000",
    "xoxb-1234567890-FAUXFAUXFAUX",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYXV4In0.c2lnbmF0dXJlZmF1c3Nl",
    "valeur-tres-secrete-123",
  ];
  for (const c of canaris) {
    const { texte, masques } = masquer(`voici ${c} dans une phrase`);
    assert.ok(!texte.includes(c), `canari en clair : ${c}`);
    assert.ok(masques >= 1);
  }
  assert.equal(masquer("le mot de passe est hunter22, ok").texte, "le mot de passe est [secret masqué], ok");
  assert.equal(masquer("https://sam:motdepasse@exemple.test/depot").texte, "https://[secret masqué]@exemple.test/depot");
  const neutre = "On garde le prix de 80 € et la clé du succès, c'est la régularité.";
  assert.equal(masquer(neutre).texte, neutre, "une phrase ordinaire reste intacte");
  assert.ok(fichierSensible("C:\\projet\\.env.local"));
  assert.ok(fichierSensible("/home/x/.ssh/id_ed25519"));
  assert.ok(!fichierSensible("src/app.ts"));
});

// --- Auteurs ----------------------------------------------------------------------
test("qui parle : seul le texte tapé est « utilisateur » ; outils, méta, sous-agents et commandes sont écartés", () => {
  const etat = {};
  const p = (rec) => claude.passageDe(rec, etat);
  assert.equal(p(ligne("user", "On part sur SQLite plutôt que Postgres.")).auteur, "utilisateur");
  assert.equal(p(ligne("user", [{ type: "text", text: "Et pour les tests ?" }])).auteur, "utilisateur");
  assert.equal(p(ligne("assistant", [{ type: "thinking", thinking: "réflexion privée" }, { type: "text", text: "Je propose Vitest." }])).texte, "Je propose Vitest.");
  assert.equal(p(ligne("assistant", [{ type: "tool_use", id: "t", name: "Bash", input: {} }])), null, "un appel d'outil seul n'est pas du dialogue");
  assert.equal(p(ligne("user", [{ type: "tool_result", tool_use_id: "t", content: "sortie" }])), null);
  assert.equal(p(ligne("user", "consigne interne", { isMeta: true })), null);
  assert.equal(p(ligne("user", "<command-name>/clear</command-name>")), null);
  assert.equal(p(ligne("user", "Notification de tâche", { origin: { kind: "task-notification" } })), null);
  assert.equal(p(ligne("user", "texte d'un sous-agent", { isSidechain: true })), null);
  assert.equal(p(ligne("user", "Résumé de la conversation…", { isCompactSummary: true })).auteur, "resume");
  assert.equal(p(ligne("user", "x".repeat(3000))).auteur, "colle", "un long collage n'est pas une déclaration");
  assert.equal(etat.entrypoint, "claude-desktop");
});

test("le dossier d'un projet est normalisé, un worktree de T3 Code ramené à son dépôt", () => {
  assert.equal(claude.normaliserCwd("C:\\Users\\Sam\\Code\\Projet\\"), "c:/users/sam/code/projet");
  assert.equal(claude.normaliserCwd("/mnt/c/Users/Sam/Code/Projet"), "c:/users/sam/code/projet");
  assert.equal(claude.normaliserCwd("C:\\Users\\Sam\\.t3\\worktrees\\mon-depot\\branche-x"), "c:/users/sam/.t3/worktrees/mon-depot");
  assert.equal(claude.idProjet("c:/a"), claude.idProjet("c:/a"));
  assert.notEqual(claude.idProjet("c:/a"), claude.idProjet("c:/b"));
});

// --- Bout en bout -------------------------------------------------------------------
test("source coupée par défaut : rien n'est lu tant qu'elle n'est pas accordée", async () => {
  ecrireSession("c--projet-essai", "s-1.jsonl", [ligne("user", "Bonjour")]);
  const r = await json("POST", "/api/connaissances/synchroniser");
  assert.equal(r.status, 409);
  assert.equal((await json("GET", "/api/connaissances")).corps.sources["claude-code"].actif, false);
});

test("lecture accordée : le dialogue est rangé, masqué, sans rien modifier chez Claude Code", async () => {
  process.env.REMY_CONNAISSANCES_PROJETS = "projet-essai";
  const f = ecrireSession("c--projet-essai", "s-1.jsonl", [
    ligne("user", "On choisit SQLite pour la base locale, ma clé est sk-ant-api03-FAUXFAUXFAUXFAUXFAUX0000", { timestamp: "2026-10-10T09:00:00Z" }),
    ligne("assistant", [{ type: "text", text: "D'accord, SQLite en mode WAL." }], { timestamp: "2026-10-10T09:01:00Z" }),
    ligne("user", [{ type: "tool_result", tool_use_id: "t", content: "AKIAFAUXFAUXFAUX0000" }]),
  ]);
  // Une session d'un AUTRE projet (hors filtre) et une session « claude -p ».
  ecrireSession("c--autre", "s-2.jsonl", [ligne("user", "Rien à voir", { sessionId: "s-2", cwd: "C:\\code\\autre" })]);
  ecrireSession("c--projet-essai", "s-3.jsonl", [ligne("user", "titre auto", { sessionId: "s-3", entrypoint: "sdk-cli" })]);
  const avant = empreinteDossier();
  assert.equal((await json("PUT", "/api/connaissances/sources", { "claude-code": true })).status, 200);
  const r = await json("POST", "/api/connaissances/synchroniser");
  assert.equal(r.status, 200, JSON.stringify(r.corps));
  const b = r.corps.bilan;
  assert.equal(b.passages, 2);
  assert.equal(b.horsFiltre, 1);
  assert.equal(b.exclus, 1);
  assert.ok(b.masques >= 1);
  assert.equal(empreinteDossier(), avant, "aucun octet modifié chez Claude Code");
  const projets = r.corps.etat.projets;
  assert.equal(projets.length, 1);
  assert.equal(projets[0].nom, "projet-essai");
  assert.equal(projets[0].passages, 2);
  assert.equal(r.corps.etat.chiffre, false, "dit, pas simulé");
  // Recherche plein texte, sans accents, avec la source pour citer.
  const c = await json("GET", "/api/connaissances/chercher?q=sqlite%20base");
  assert.equal(c.status, 200);
  assert.ok(c.corps.resultats.length >= 1);
  assert.equal(c.corps.resultats[0].session, "s-1");
  assert.ok(c.corps.resultats[0].uuid);
  const tout = JSON.stringify(c.corps);
  assert.ok(!tout.includes("sk-ant-api03"), "le secret n'est nulle part");
  assert.ok(!tout.includes("AKIAFAUX"), "un résultat d'outil n'est jamais rangé");
  assert.equal(f.length > 0, true);
});

test("relecture incrémentale : seule la suite est lue ; une ligne en cours d'écriture attend", async () => {
  const f = path.join(racineClaude, "projects", "c--projet-essai", "s-1.jsonl");
  const second = await json("POST", "/api/connaissances/synchroniser");
  assert.equal(second.corps.bilan.passages, 0);
  assert.ok(second.corps.bilan.inchanges >= 1);
  fs.appendFileSync(f, JSON.stringify(ligne("user", "Il reste à écrire la purge.", { timestamp: "2026-10-11T10:00:00Z" })) + "\n");
  fs.appendFileSync(f, '{"type":"user","uuid":"incomplet"'); // pas encore de fin de ligne
  const troisieme = await json("POST", "/api/connaissances/synchroniser");
  assert.equal(troisieme.corps.bilan.passages, 1);
  assert.equal(troisieme.corps.bilan.illisibles, 0, "la ligne incomplète n'est pas lue de travers");
  assert.equal(troisieme.corps.etat.projets[0].passages, 3);
});

test("un fichier réécrit (plus court) est relu depuis le début, sans doublon", async () => {
  ecrireSession("c--projet-essai", "s-1.jsonl", [ligne("user", "Version réécrite de la session.")]);
  const r = await json("POST", "/api/connaissances/synchroniser");
  assert.equal(r.corps.bilan.relus, 1);
  assert.equal(r.corps.etat.projets[0].passages, 1);
});

test("ajouter un projet au filtre relit ses sessions déjà vues", async () => {
  process.env.REMY_CONNAISSANCES_PROJETS = "projet-essai,autre";
  const r = await json("POST", "/api/connaissances/synchroniser");
  assert.equal(r.corps.etat.projets.length, 2);
});

test("purge : tout ce qui vient de la source est oublié, et la source coupée", async () => {
  const r = await json("DELETE", "/api/connaissances/sources/claude-code");
  assert.equal(r.status, 200);
  assert.equal(r.corps.etat.projets.length, 0);
  assert.equal(r.corps.etat.sources["claude-code"].actif, false);
  assert.equal((await json("GET", "/api/connaissances/chercher?q=sqlite")).corps.resultats.length, 0);
});

test("REMY_SOURCE_CLAUDE_CODE=off coupe la lecture, même accordée dans l'app", async () => {
  await json("PUT", "/api/connaissances/sources", { "claude-code": true });
  process.env.REMY_SOURCE_CLAUDE_CODE = "off";
  try {
    assert.equal((await json("POST", "/api/connaissances/synchroniser")).status, 409);
    assert.equal(sync.sourceActive(), false);
  } finally {
    delete process.env.REMY_SOURCE_CLAUDE_CODE;
  }
});

test("la mémoire personnelle et les conversations ne sont pas touchées", async () => {
  const store = await import("../lib/store.js");
  assert.equal((await store.getMemory()).text || "", "");
  assert.equal((await store.listConversations()).length, 0);
});
