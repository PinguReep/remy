// Conversations externes (29/10) : les sessions Claude Code, les fils de T3
// Code et l'export ChatGPT, lus sur la tour en lecture seule, rangés chiffrés,
// consultables, effaçables par source. Données FICTIVES de bout en bout
// (test/outils/conversations-fictives.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

console.log = () => {};
console.warn = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-conv-ext-"));
const racineClaude = path.join(dossier, "claude");
const racineT3 = path.join(dossier, "t3");
const imports = path.join(dossier, "imports");
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_SOURCE_CLAUDE_CODE", "REMY_SOURCE_T3", "REMY_SOURCE_CHATGPT",
  "REMY_CONNAISSANCES_PROJETS", "REMY_CONVERSATIONS_CLE", "REMY_CONVERSATIONS_USAGE", "REMY_CLAUDE_DIRS", "T3CODE_HOME", "REMY_IMPORT_MAX_MO"]) delete process.env[v];
process.env.REMY_DATA_DIR = path.join(dossier, "data");
process.env.REMY_CLES_DIR = path.join(dossier, "cles");
process.env.CLAUDE_CONFIG_DIR = racineClaude;
process.env.REMY_T3_DIRS = racineT3;
process.env.REMY_IMPORTS_DIR = imports;
process.env.HOME = path.join(dossier, "maison"); // pas de ~/.claude ni ~/.t3 réels lus par les tests
process.env.USERPROFILE = process.env.HOME;
process.env.FAUX_SECRET_DE_LA_TOUR_TOKEN = "valeur-tres-secrete-123";

const fx = await import("./outils/conversations-fictives.mjs");
const { masquer, fichierSensible, oublierSecretsDeLaTour } = await import("../lib/connaissances/masquage.js");
const claude = await import("../lib/connaissances/claudeCode.js");
const t3 = await import("../lib/connaissances/t3.js");
const sync = await import("../lib/connaissances/sync.js");
const chiffre = await import("../lib/connaissances/chiffre.js");
const { elementsJson } = await import("../lib/connaissances/json-flux.js");
const { conversationDe } = await import("../lib/connaissances/chatgpt.js");
const { routeApi } = await import("../lib/routes.js");
const { CAPACITES } = await import("../lib/version.js");
oublierSecretsDeLaTour();

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
const { fermer, cheminConnaissances } = await import("../lib/connaissances/base.js");
const { fermer: fermerRemy } = await import("../lib/db.js");
// Windows refuse d'effacer une base encore ouverte.
test.after(() => {
  remy.close();
  fermer();
  fermerRemy();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const json = async (methode, chemin, corps) => {
  const r = await fetch(base + chemin, { method: methode, headers: { "Content-Type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps) });
  return { status: r.status, corps: await r.json() };
};
const envoyerFichier = async (contenu, type = "application/zip") => {
  const r = await fetch(`${base}/api/conversations-externes/chatgpt`, { method: "POST", headers: { "Content-Type": type }, body: contenu });
  return { status: r.status, corps: await r.json() };
};
const lireTout = async () => (await json("POST", "/api/conversations-externes/synchroniser")).corps;
const source = (etat, id) => etat.sources.find((s) => s.id === id);
const iso = (ms) => new Date(ms).toISOString();
const HIER = Date.now() - 24 * 3600_000;

// L'empreinte de tous les fichiers d'un dossier (contenu, taille, date) :
// « rien n'a été écrit chez la source ».
function empreinte(d) {
  const h = crypto.createHash("sha256");
  const parcourir = (x) => {
    for (const e of fs.readdirSync(x, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(x, e.name);
      if (e.isDirectory()) parcourir(p);
      else h.update(p).update(fs.readFileSync(p)).update(String(fs.statSync(p).mtimeMs));
    }
  };
  parcourir(d);
  return h.digest("hex");
}
const fichiers = (d) => fs.readdirSync(d).sort();

// Ce qui ne doit jamais apparaître en clair dans la base de la tour.
const CANARIS = ["Figuier", "chaleureux", "Kervella", "coffret", "trois fois", "Léa est", "boutique", "site-boutique", "bougies"];
function baseEnClair() {
  const trouves = [];
  for (const f of [cheminConnaissances(), `${cheminConnaissances()}-wal`]) {
    if (!fs.existsSync(f)) continue;
    const b = fs.readFileSync(f);
    for (const c of CANARIS) {
      for (const v of [c, c.toLowerCase(), c.normalize("NFD")]) if (b.includes(Buffer.from(v))) trouves.push(`${path.basename(f)}: ${v}`);
    }
  }
  return trouves;
}

// =============================================================================================
// Briques
// =============================================================================================

test("masquage : les secrets sont retirés avant tout stockage, le reste du texte non", () => {
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
  assert.ok(!fichierSensible("src/app.ts"));
});

test("Claude Code : seul le dialogue devient un message (ni outils, ni méta, ni sous-agents, ni commandes)", () => {
  const etat = {};
  const l = (type, contenu, extra = {}) => ({ type, uuid: crypto.randomUUID(), sessionId: "s", timestamp: "2026-10-10T09:00:00Z", cwd: "C:\\code\\x", entrypoint: "claude-desktop", message: { role: type, content: contenu }, ...extra });
  const p = (rec) => claude.passageDe(rec, etat);
  assert.equal(p(l("user", "On part sur SQLite.")).auteur, "utilisateur");
  assert.equal(p(l("assistant", [{ type: "thinking", thinking: "réflexion privée" }, { type: "text", text: "Je propose Vitest." }])).texte, "Je propose Vitest.");
  assert.equal(p(l("assistant", [{ type: "tool_use", id: "t", name: "Bash", input: {} }])), null);
  assert.equal(p(l("user", [{ type: "tool_result", tool_use_id: "t", content: "sortie" }])), null);
  assert.equal(p(l("user", "consigne interne", { isMeta: true })), null);
  assert.equal(p(l("user", "<command-name>/clear</command-name>")), null);
  assert.equal(p(l("user", "texte d'un sous-agent", { isSidechain: true })), null);
  assert.equal(p(l("user", "Résumé…", { isCompactSummary: true })).auteur, "resume");
  assert.equal(p(l("user", "x".repeat(3000))).auteur, "colle");
  assert.equal(etat.entrypoint, "claude-desktop");
  // Le titre donné dans Claude Code (/rename).
  claude.passageDe({ type: "custom-title", customTitle: "Mon titre", sessionId: "s" }, etat);
  assert.equal(etat.titre, "Mon titre");
});

test("Claude Code : les dossiers trouvés seuls (%USERPROFILE%\\.claude), plus CLAUDE_CONFIG_DIR et REMY_CLAUDE_DIRS", () => {
  const maison = path.join(process.env.HOME, ".claude");
  fs.mkdirSync(path.join(maison, "projects"), { recursive: true });
  const autre = path.join(dossier, "wsl-claude");
  fs.mkdirSync(path.join(autre, "projects"), { recursive: true });
  process.env.REMY_CLAUDE_DIRS = `${autre};${path.join(dossier, "absent")}`;
  try {
    const c = claude.racinesCandidates();
    assert.deepEqual(c.map((x) => x.origine), ["CLAUDE_CONFIG_DIR", "REMY_CLAUDE_DIRS", "REMY_CLAUDE_DIRS", "dossier de l'utilisateur"]);
    assert.ok(claude.racines().includes(path.resolve(maison)), "le dossier de l'utilisateur est trouvé sans réglage");
    assert.ok(claude.racines().includes(path.resolve(autre)));
    assert.ok(!claude.racines().includes(path.resolve(dossier, "absent")));
  } finally {
    delete process.env.REMY_CLAUDE_DIRS;
    fs.rmSync(maison, { recursive: true, force: true });
  }
  assert.equal(claude.normaliserCwd("C:\\Users\\Sam\\Code\\Projet\\"), "c:/users/sam/code/projet");
  assert.equal(claude.normaliserCwd("/mnt/c/Users/Sam/Code/Projet"), "c:/users/sam/code/projet");
});

test("chiffrement : un texte déplacé d'une ligne à l'autre ne se déchiffre plus ; l'index n'a que des empreintes", () => {
  const b = chiffre.chiffrer("Bougie Figuier", "chatgpt:c1:m:1");
  assert.equal(chiffre.dechiffrer(b, "chatgpt:c1:m:1"), "Bougie Figuier");
  assert.throws(() => chiffre.dechiffrer(b, "chatgpt:c2:m:1"));
  assert.ok(!b.includes(Buffer.from("Figuier")));
  const j = chiffre.jetonsIndex("Déploiement de la bougie Figuier");
  assert.doesNotMatch(j, /figuier|deploi|bougie/i);
  assert.match(j, /^(h[0-9a-f]{13} ?)+$/);
  // Mêmes mots, mêmes empreintes (sans accents ni pluriel) ; un début de mot suffit.
  const q = chiffre.jetonsRecherche("deploiements");
  assert.ok(q[0].jetons.some((t) => j.split(" ").includes(t)));
  assert.ok(chiffre.jetonsRecherche("déploi")[0].jetons.some((t) => j.split(" ").includes(t)));
});

test("la clé : créée une fois hors du coffre, jamais réécrite ; REMY_CONVERSATIONS_CLE l'emporte", () => {
  chiffre.oublierCle();
  const k1 = chiffre.cles();
  const f = chiffre.fichierCle();
  assert.ok(fs.existsSync(f));
  assert.ok(!f.startsWith(process.env.REMY_DATA_DIR), "la clé n'est pas à côté de la base");
  const contenu = fs.readFileSync(f, "utf8");
  chiffre.oublierCle();
  assert.equal(chiffre.cles().controle, k1.controle, "relue, pas recréée");
  assert.equal(fs.readFileSync(f, "utf8"), contenu);
  process.env.REMY_CONVERSATIONS_CLE = "zz";
  try {
    assert.throws(() => chiffre.cles(), /64 caractères/);
    process.env.REMY_CONVERSATIONS_CLE = "a".repeat(64);
    assert.equal(chiffre.cles().origine, "remy.env");
    assert.notEqual(chiffre.cles().controle, k1.controle);
  } finally {
    delete process.env.REMY_CONVERSATIONS_CLE;
    chiffre.oublierCle();
  }
});

test("JSON en flux : un grand tableau élément par élément, chaînes et accents coupés n'importe où", async () => {
  const objets = Array.from({ length: 30 }, (_, i) => ({ i, t: `«]}» \\"ok\\" é${"x".repeat(i * 37)}`, n: { a: [1, { b: "[" }] } }));
  const texte = Buffer.from(JSON.stringify(objets));
  // Découpé en morceaux de 7 octets : un caractère accentué est coupé en deux.
  const morceaux = [];
  for (let i = 0; i < texte.length; i += 7) morceaux.push(texte.subarray(i, i + 7));
  const lus = [];
  for await (const o of elementsJson(morceaux)) lus.push(o);
  assert.deepEqual(lus, objets);
  const seul = [];
  for await (const o of elementsJson([Buffer.from('{"conversations":[{"a":1},{"a":2}]}')])) seul.push(o);
  assert.deepEqual(seul, [{ a: 1 }, { a: 2 }]);
  await assert.rejects(async () => {
    for await (const _ of elementsJson([Buffer.from('[{"a":1},{"a":')])) {}
  }, /incomplet/);
});

test("ChatGPT : la branche gardée à l'écran, sans consignes, système, outils ni réponse jetée", () => {
  const c = fx.conversationChatGPT({
    id: "6f1c0000-bbbb-4000-8000-000000000009",
    titre: "Prix des coffrets",
    debut: Math.round(HIER / 1000),
    echanges: [["Prix d'un coffret ?", "Autour de 29 euros."]],
    regeneree: "Autour de 45 euros.",
  });
  const { conversation } = conversationDe(c);
  assert.deepEqual(conversation.messages.map((m) => [m.auteur, m.texte]), [["utilisateur", "Prix d'un coffret ?"], ["assistant", "Autour de 29 euros."]]);
  assert.equal(conversation.titre, "Prix des coffrets");
  assert.equal(conversationDe({ title: "x" }).raison, "format inconnu");
});

// =============================================================================================
// Bout en bout
// =============================================================================================

test("pourquoi tu n'y avais pas accès : allumées par défaut, l'état dit tout, sans rien créer pour répondre", async () => {
  // Aucune source sur la tour : l'état le dit, avec quoi faire, et la base
  // n'est pas créée pour autant.
  const r = await json("GET", "/api/conversations-externes");
  assert.equal(r.status, 200);
  assert.equal(fs.existsSync(cheminConnaissances()), false);
  for (const id of ["claude-code", "t3", "chatgpt"]) assert.equal(source(r.corps, id).actif, true, id);
  assert.equal(source(r.corps, "claude-code").aide.code, "introuvable");
  assert.match(source(r.corps, "t3").aide.quoiFaire, /REMY_T3_DIRS/);
  assert.match(source(r.corps, "chatgpt").aide.quoiFaire, /Exporter/);
  assert.equal(r.corps.chiffre, true);
  assert.ok(["a-creer", "fichier"].includes(r.corps.cle.origine));
  assert.ok(!r.corps.cle.emplacement.includes("data"), "la clé n'est pas dans la base");
  assert.ok(CAPACITES.includes("conversations-externes-v1"));
  // La lecture se planifie seule (toutes les 30 min) : le job existe.
  const { enregistrerConnaissances } = await import("../lib/planif.js");
  assert.equal(typeof enregistrerConnaissances, "function");
});

test("Claude Code : lu, masqué, chiffré, titré ; sdk-cli exclu ; rien de modifié chez Claude Code", async () => {
  fx.ecrireSessionClaude(racineClaude, {
    session: "5e551011-0000-4000-8000-000000000001",
    titre: "Fiches produits",
    messages: [
      { role: "user", texte: "Réécris la fiche de la bougie Figuier, ton chaleureux. Ma clé : sk-ant-api03-FAUXFAUXFAUXFAUXFAUX0000", ts: iso(HIER) },
      { role: "assistant", texte: "Voici la fiche de la bougie Figuier : notes vertes, 40 heures.", ts: iso(HIER + 60_000) },
      { role: "user", texte: "Décision : on publie vendredi.", ts: iso(HIER + 120_000) },
    ],
  });
  fx.ecrireSessionClaude(racineClaude, { session: "5e551011-0000-4000-8000-000000000002", entrypoint: "sdk-cli", messages: [{ role: "user", texte: "titre automatique", ts: iso(HIER) }] });
  const avant = empreinte(racineClaude);
  const r = await lireTout();
  const b = r.bilan.sources["claude-code"];
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(b.messages, 3);
  assert.equal(b.exclus, 1);
  assert.ok(b.masques >= 1);
  assert.equal(empreinte(racineClaude), avant, "aucun octet modifié chez Claude Code");
  const s = source(r.etat, "claude-code");
  assert.equal(s.conversations, 1);
  assert.equal(s.erreur, null);
  assert.equal(s.aide, null);
  const l = (await json("GET", "/api/conversations-externes/liste?source=claude-code")).corps;
  assert.equal(l.total, 1);
  assert.equal(l.conversations[0].titre, "Fiches produits");
  assert.equal(l.conversations[0].assistant, "Claude");
  assert.equal(l.conversations[0].projet.nom, "bougies");
  const c = (await json("GET", `/api/conversations-externes/conversations/claude-code/${l.conversations[0].id}`)).corps;
  assert.equal(c.messages.length, 3);
  assert.match(c.messages[0].texte, /\[secret masqué\]/);
  assert.ok(!JSON.stringify(c).includes("sk-ant-api03"));
  assert.deepEqual(baseEnClair(), []);
  assert.equal(r.etat.cle.origine, "fichier");
});

test("Claude Code : relecture incrémentale ; une ligne en cours d'écriture attend ; un fichier réécrit est relu", async () => {
  const f = path.join(racineClaude, "projects", "C--Users-sam-code-bougies", "5e551011-0000-4000-8000-000000000001.jsonl");
  const deux = (await lireTout()).bilan.sources["claude-code"];
  assert.equal(deux.messages, 0);
  assert.ok(deux.inchanges >= 1);
  fs.appendFileSync(f, JSON.stringify({ type: "user", uuid: crypto.randomUUID(), sessionId: "x", timestamp: iso(HIER + 180_000), cwd: "C:\\Users\\sam\\code\\bougies", message: { role: "user", content: "Il reste les photos du coffret." } }) + "\n");
  fs.appendFileSync(f, '{"type":"user","uuid":"incomplet"');
  const trois = (await lireTout()).bilan.sources["claude-code"];
  assert.equal(trois.messages, 1);
  assert.equal(trois.illisibles, 0);
  // Réécrit plus court : relu depuis le début, sans doublon.
  fx.ecrireSessionClaude(racineClaude, { session: "5e551011-0000-4000-8000-000000000001", titre: "Fiches produits", messages: [{ role: "user", texte: "Version réécrite de la fiche Figuier.", ts: iso(HIER) }] });
  const quatre = await lireTout();
  assert.equal(quatre.bilan.sources["claude-code"].relus, 1);
  assert.equal(source(quatre.etat, "claude-code").messages, 1);
  // On remet la session complète pour la suite.
  fx.ecrireSessionClaude(racineClaude, {
    session: "5e551011-0000-4000-8000-000000000001",
    titre: "Fiches produits",
    messages: [
      { role: "user", texte: "Réécris la fiche de la bougie Figuier, ton chaleureux.", ts: iso(HIER) },
      { role: "assistant", texte: "Voici la fiche de la bougie Figuier : notes vertes, 40 heures.", ts: iso(HIER + 60_000) },
      { role: "user", texte: "Décision : on publie vendredi.", ts: iso(HIER + 120_000) },
    ],
  });
  await lireTout();
});

test("T3 Code fermé : lu en « immutable », aucun fichier créé ni modifié à côté de sa base", async () => {
  const fichier = path.join(racineT3, "userdata", "statev2.sqlite");
  fx.creerBaseT3(fichier, {
    projets: [{ id: "proj-site", titre: "Site de la boutique", racine: "C:\\Users\\sam\\code\\site-boutique" }],
    fils: [
      { id: "fil-paiement", projet: "proj-site", titre: "Paiement en trois fois", fournisseur: "codex", cree: iso(HIER), maj: iso(HIER + 600_000) },
      // Mené avec Claude depuis T3 : sa session Claude Code ne doit pas apparaître deux fois.
      { id: "fil-fiches", projet: "proj-site", titre: "Fiches (depuis T3)", fournisseur: "claudeAgent", cree: iso(HIER), natif: "5E551011-0000-4000-8000-000000000001" },
      { id: "fil-agent", projet: "proj-site", titre: "Sous-agent", sousAgent: true, cree: iso(HIER) },
      { id: "fil-efface", projet: "proj-site", titre: "Effacé", supprime: true, cree: iso(HIER) },
    ],
    messages: [
      { id: "m-1", fil: "fil-paiement", role: "user", texte: "Ajoute le paiement en trois fois, Barthélémy Kervella valide.", cree: iso(HIER) },
      { id: "m-2", fil: "fil-paiement", role: "assistant", texte: "C'est fait côté panier.", cree: iso(HIER + 60_000) },
      { id: "m-3", fil: "fil-paiement", role: "user", texte: "Notification produite par T3", cree: iso(HIER + 70_000), par: "system" },
      { id: "m-4", fil: "fil-paiement", role: "assistant", texte: "en cours…", cree: iso(HIER + 80_000), streaming: true },
      { id: "m-5", fil: "fil-paiement", role: "user", texte: "export const script = 1", cree: iso(HIER + 90_000), script: true },
      { id: "m-6", fil: "fil-agent", role: "assistant", texte: "texte de sous-agent", cree: iso(HIER) },
      { id: "m-7", fil: "fil-efface", role: "user", texte: "fil effacé", cree: iso(HIER) },
      { id: "m-8", fil: "fil-fiches", role: "user", texte: "Réécris la fiche de la bougie Figuier depuis T3.", cree: iso(HIER) },
    ],
  });
  const avant = empreinte(racineT3);
  const listeAvant = fichiers(path.dirname(fichier));
  const r = await lireTout();
  const b = r.bilan.sources.t3;
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(b.messages, 3, "paiement (2) et fiches (1) ; ni notification, ni flux, ni script, ni sous-agent, ni fil effacé");
  assert.equal(b.liens, 1);
  assert.equal(empreinte(racineT3), avant, "base de T3 intacte");
  assert.deepEqual(fichiers(path.dirname(fichier)), listeAvant, "ni -wal ni -shm créés");
  const l = (await json("GET", "/api/conversations-externes/liste?source=t3")).corps.conversations;
  assert.deepEqual(l.map((c) => c.titre).sort(), ["Fiches (depuis T3)", "Paiement en trois fois"]);
  assert.equal(l.find((c) => c.id === "fil-paiement").assistant, "Codex");
  assert.equal(l.find((c) => c.id === "fil-paiement").projet.nom, "Site de la boutique");
  // La session Claude Code menée depuis T3 n'apparaît qu'une fois (sous T3).
  const tout = (await json("GET", "/api/conversations-externes/liste")).corps;
  assert.equal(tout.conversations.filter((c) => c.source === "claude-code").length, 0);
  assert.equal(source(r.etat, "claude-code").conversations, 0);
  assert.deepEqual(baseEnClair(), []);
});

test("T3 Code ouvert (journal WAL) : lecteur en lecture seule, il voit ce qui est validé, une suppression disparaît", async () => {
  const fichier = path.join(racineT3, "userdata", "statev2.sqlite");
  const b = fx.ouvrirBaseT3(fichier);
  b.exec("PRAGMA journal_mode = WAL;");
  try {
    fx.ajouterT3(b, { messages: [{ id: "m-9", fil: "fil-paiement", role: "user", texte: "Et le seuil de livraison offerte ?", cree: iso(HIER + 900_000) }] });
    assert.ok(fs.existsSync(`${fichier}-wal`), "T3 « tourne »");
    const r = await lireTout();
    assert.equal(r.bilan.sources.t3.messages, 1, "seulement le nouveau message (curseur)");
    // Le fil supprimé dans T3 disparaît de la tour.
    b.prepare("UPDATE orchestration_v2_projection_threads SET deleted_at = ? WHERE thread_id = 'fil-fiches'").run(iso(Date.now()));
    const r2 = await lireTout();
    assert.equal(r2.bilan.sources.t3.supprimees, 1);
    assert.equal(source(r2.etat, "t3").conversations, 1);
  } finally {
    b.close();
  }
  // Effacé dans T3 : sa session Claude reste cachée (tu l'as effacée là-bas).
  const c = (await json("GET", "/api/conversations-externes/liste?source=claude-code")).corps;
  assert.equal(c.total, 0);
});

test("ChatGPT : l'export .zip envoyé depuis l'app est importé, puis reconnu (idempotent), puis mis à jour", async () => {
  const conv = fx.conversationChatGPT({
    id: "6f1c0000-aaaa-4000-8000-000000000001",
    titre: "Idées de coffrets",
    debut: Math.round((HIER - 3600_000) / 1000),
    echanges: [
      ["Trois idées de coffrets pour une boutique de bougies ?", "Forêt, Épices, et un coffret découverte."],
      ["Pour le site, mot de passe : hunter2bis. Et le prix du coffret ?", "Autour de 29 euros."],
    ],
    regeneree: "Autour de 45 euros.",
  });
  const zip = fx.exportChatGPT([conv, { title: "illisible" }]);
  const r = await envoyerFichier(zip);
  assert.equal(r.status, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.bilan.deja, false);
  assert.equal(r.corps.bilan.nouvelles, 1);
  assert.equal(r.corps.bilan.ignorees, 1);
  assert.ok(r.corps.bilan.masques >= 1);
  assert.equal(source(r.corps.etat, "chatgpt").conversations, 1);
  const lu = (await json("GET", `/api/conversations-externes/conversations/chatgpt/${encodeURIComponent(conv.id)}`)).corps;
  assert.equal(lu.conversation.assistant, "ChatGPT");
  assert.deepEqual(lu.messages.map((m) => m.auteur), ["utilisateur", "assistant", "utilisateur", "assistant"]);
  assert.ok(!JSON.stringify(lu).includes("hunter2bis"));
  assert.ok(!JSON.stringify(lu).includes("45 euros"), "la réponse jetée n'est pas gardée");
  // Le même fichier : reconnu, rien de réécrit.
  const encore = await envoyerFichier(zip);
  assert.equal(encore.corps.bilan.deja, true);
  // Un export plus récent : la conversation modifiée est mise à jour, l'autre non.
  const modifiee = { ...conv, update_time: conv.update_time + 3600, mapping: { ...conv.mapping } };
  const autre = fx.conversationChatGPT({ id: "6f1c0000-aaaa-4000-8000-000000000002", titre: "Étiquettes", debut: Math.round(HIER / 1000), echanges: [["Une étiquette pour la bougie Figuier ?", "Kraft, écriture blanche."]] });
  const r2 = await envoyerFichier(Buffer.from(JSON.stringify([modifiee, autre])), "application/json");
  assert.equal(r2.status, 200, JSON.stringify(r2.corps));
  assert.equal(r2.corps.bilan.misesAJour, 1);
  assert.equal(r2.corps.bilan.nouvelles, 1);
  assert.equal(source(r2.corps.etat, "chatgpt").conversations, 2);
  assert.deepEqual(baseEnClair(), []);
});

test("ChatGPT : un fichier qui n'est pas l'export est refusé avec quoi faire ; rien n'est gardé de l'envoi", async () => {
  const pasZip = await envoyerFichier(Buffer.from("PK\u0003\u0004 pas vraiment un zip"));
  assert.equal(pasZip.status, 422);
  assert.equal(pasZip.corps.error, "zip-invalide");
  assert.match(pasZip.corps.quoiFaire, /export/);
  const sansConv = await envoyerFichier(fx.zipper([{ nom: "user.json", contenu: "{}" }]));
  assert.equal(sansConv.status, 422);
  assert.equal(sansConv.corps.error, "sans-conversations");
  const vide = await envoyerFichier(Buffer.alloc(0));
  assert.equal(vide.status, 400);
  const restes = fs.existsSync(path.join(process.env.REMY_DATA_DIR, "imports-en-cours")) ? fs.readdirSync(path.join(process.env.REMY_DATA_DIR, "imports-en-cours")) : [];
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(fs.readdirSync(path.join(process.env.REMY_DATA_DIR, "imports-en-cours")), [], `fichiers d'envoi effacés (${restes.join(",")})`);
  process.env.REMY_IMPORT_MAX_MO = "0.0001";
  try {
    const gros = await envoyerFichier(Buffer.alloc(2000, 1));
    assert.equal(gros.status, 413);
  } finally {
    delete process.env.REMY_IMPORT_MAX_MO;
  }
});

test("ChatGPT : un export déposé dans Imports est importé à la lecture suivante, puis rangé dans Imports\\Importés", async () => {
  fs.mkdirSync(imports, { recursive: true });
  const conv = fx.conversationChatGPT({ id: "6f1c0000-aaaa-4000-8000-000000000003", titre: "Mèches en coton", debut: Math.round(HIER / 1000), echanges: [["Quelle mèche pour un pot de 8 cm ?", "Une mèche en coton de taille moyenne."]] });
  const f = path.join(imports, "export-chatgpt.zip");
  fs.writeFileSync(f, fx.exportChatGPT([conv]));
  // Tout juste copié : il attend (la copie peut être en cours).
  const tot = await lireTout();
  assert.equal(tot.bilan.sources.chatgpt.enAttente, 1);
  assert.ok(fs.existsSync(f));
  const vieux = new Date(Date.now() - 60_000);
  fs.utimesSync(f, vieux, vieux);
  const r = await lireTout();
  assert.equal(r.bilan.sources.chatgpt.importes, 1, JSON.stringify(r.bilan.sources.chatgpt));
  assert.ok(!fs.existsSync(f));
  assert.ok(fs.existsSync(path.join(imports, "Importés", "export-chatgpt.zip")), "rangé, jamais effacé");
  assert.equal(source(r.etat, "chatgpt").conversations, 3);
  // Un fichier illisible reste là, et l'état dit pourquoi.
  const casse = path.join(imports, "casse.zip");
  fs.writeFileSync(casse, "PK\u0003\u0004 abîmé");
  fs.utimesSync(casse, vieux, vieux);
  const r2 = await lireTout();
  assert.equal(r2.bilan.sources.chatgpt.ok, false);
  assert.equal(source(r2.etat, "chatgpt").erreur.code, "zip-invalide");
  assert.ok(fs.existsSync(casse));
  fs.rmSync(casse);
  const r3 = await lireTout();
  assert.equal(source(r3.etat, "chatgpt").erreur, null, "réparé, l'erreur disparaît");
});

test("recherche : sans accents, par début de mot, par source ; extraits sans secret", async () => {
  const r = (await json("GET", "/api/conversations-externes/chercher?q=bougie%20figuier")).corps.resultats;
  assert.ok(r.length >= 1);
  assert.equal(r[0].source, "chatgpt");
  assert.equal(r[0].score, 2, "les deux mots");
  assert.ok(r[0].score >= r.at(-1).score);
  assert.match(r[0].extrait, /Figuier/);
  // La session Claude Code menée depuis T3 reste cachée (une seule fois, sous T3).
  assert.ok(!r.some((x) => x.conversation === "5e551011-0000-4000-8000-000000000001"));
  assert.equal("texte" in r[0], false, "l'extrait seulement");
  const prefixe = (await json("GET", "/api/conversations-externes/chercher?q=coffr")).corps.resultats;
  assert.ok(prefixe.some((x) => /coffret/i.test(x.extrait)));
  const seul = (await json("GET", "/api/conversations-externes/chercher?q=figuier&source=chatgpt")).corps.resultats;
  assert.ok(seul.length && seul.every((x) => x.source === "chatgpt"));
  assert.equal((await json("GET", "/api/conversations-externes/chercher?q=")).status, 400);
  assert.equal((await json("GET", "/api/conversations-externes/chercher?q=x&source=inconnue")).status, 400);
});

test("par date : les jours qui ont des conversations, et la liste d'un jour", async () => {
  const j = (await json("GET", "/api/conversations-externes/jours")).corps.jours;
  assert.ok(j.length >= 1);
  assert.ok(j.every((x, i) => i === 0 || x.jour < j[i - 1].jour), "du plus récent au plus ancien");
  for (const x of j) {
    const l = (await json("GET", `/api/conversations-externes/liste?jour=${x.jour}`)).corps;
    assert.equal(l.total, x.conversations, x.jour);
  }
  assert.equal((await json("GET", "/api/conversations-externes/liste?jour=hier")).status, 400);
  const p1 = (await json("GET", "/api/conversations-externes/liste?limite=2")).corps;
  assert.equal(p1.conversations.length, 2);
  assert.equal(p1.suite, 2);
  const p2 = (await json("GET", `/api/conversations-externes/liste?limite=2&decalage=${p1.suite}`)).corps;
  assert.ok(!p2.conversations.some((c) => p1.conversations.find((d) => d.id === c.id)));
  assert.equal((await json("GET", "/api/conversations-externes/conversations/t3/inconnue")).status, 404);
});

test("à sens unique : lire, importer, chercher, lister n'ouvre AUCUNE connexion vers l'extérieur", async () => {
  const appels = [];
  const fetchAvant = globalThis.fetch;
  const reqHttp = http.request;
  const reqHttps = https.request;
  globalThis.fetch = (...a) => {
    appels.push(String(a[0]));
    throw new Error("réseau interdit");
  };
  http.request = (...a) => {
    appels.push("http");
    throw new Error("réseau interdit");
  };
  https.request = (...a) => {
    appels.push("https");
    throw new Error("réseau interdit");
  };
  try {
    await sync.synchroniser();
    const zip = path.join(dossier, "a-importer.zip");
    fs.writeFileSync(zip, fx.exportChatGPT([fx.conversationChatGPT({ id: "6f1c0000-aaaa-4000-8000-000000000004", titre: "Hors ligne", debut: Math.round(HIER / 1000), echanges: [["Une question", "Une réponse"]] })]));
    await sync.importerChatGPT(zip);
    sync.chercher("figuier");
    sync.liste();
    sync.etat();
  } finally {
    globalThis.fetch = fetchAvant;
    http.request = reqHttp;
    https.request = reqHttps;
  }
  assert.deepEqual(appels, []);
  // Et dans le code : aucun module de lecture n'importe de quoi parler au réseau.
  const dossierLib = fileURLToPath(new URL("../lib/connaissances/", import.meta.url));
  for (const f of fs.readdirSync(dossierLib)) {
    const code = fs.readFileSync(path.join(dossierLib, f), "utf8");
    assert.doesNotMatch(code, /from "node:(https?|net|tls|dgram|child_process)"|\bfetch\(|XMLHttpRequest|WebSocket/, f);
  }
});

test("chiffré au repos : ni la base ni son journal ne contiennent un mot des conversations", async () => {
  // Tout ce qui précède est rangé : on relit les fichiers bruts.
  assert.deepEqual(baseEnClair(), []);
  // Avec la bonne clé tout se relit ; avec une autre, rien (et l'état le dit).
  process.env.REMY_CONVERSATIONS_CLE = "b".repeat(64);
  chiffre.oublierCle();
  try {
    const e = (await json("GET", "/api/conversations-externes")).corps;
    assert.equal(e.cle.erreur.code, "cle-differente");
    const s = await json("POST", "/api/conversations-externes/synchroniser");
    assert.equal(s.status, 409);
    assert.equal(s.corps.error, "cle-differente");
    const l = (await json("GET", "/api/conversations-externes/liste")).corps.conversations;
    assert.ok(l.every((c) => c.titre === "Conversation"), "illisible sans la clé");
  } finally {
    delete process.env.REMY_CONVERSATIONS_CLE;
    chiffre.oublierCle();
  }
  assert.equal((await json("GET", "/api/conversations-externes")).corps.cle.erreur, null);
});

test("effacer une source : tout ce qui en vient disparaît, la source est coupée, l'original n'est pas touché", async () => {
  const avant = empreinte(racineClaude);
  const r = await json("DELETE", "/api/conversations-externes/sources/chatgpt");
  assert.equal(r.status, 200);
  assert.match(r.corps.message, /compte ChatGPT n'est pas touché/);
  const s = source(r.corps.etat, "chatgpt");
  assert.equal(s.conversations, 0);
  assert.equal(s.actif, false);
  assert.equal((await json("GET", "/api/conversations-externes/chercher?q=coffret&source=chatgpt")).corps.resultats.length, 0);
  assert.equal(r.corps.etat.imports.importes, 0, "le même export pourra être réimporté");
  // Les autres sources restent.
  assert.ok(source(r.corps.etat, "t3").conversations >= 1);
  // Coupée : la lecture suivante ne la relit pas ; l'envoi d'un export la rallume.
  const lu = await lireTout();
  assert.equal(lu.bilan.sources.chatgpt, undefined);
  const rallume = await envoyerFichier(fx.exportChatGPT([fx.conversationChatGPT({ id: "6f1c0000-aaaa-4000-8000-000000000005", titre: "Retour", debut: Math.round(HIER / 1000), echanges: [["Q", "R"]] })]));
  assert.equal(rallume.status, 200);
  assert.equal(source(rallume.corps.etat, "chatgpt").actif, true);
  // Claude Code : effacé et coupé, ses sessions intactes.
  const c = await json("DELETE", "/api/conversations-externes/sources/claude-code");
  assert.equal(source(c.corps.etat, "claude-code").actif, false);
  assert.equal(empreinte(racineClaude), avant);
  assert.equal((await json("POST", "/api/conversations-externes/synchroniser", { source: "claude-code" })).status, 409);
  assert.equal((await json("PUT", "/api/conversations-externes/sources/claude-code", { actif: true })).status, 200);
  assert.equal((await lireTout()).bilan.sources["claude-code"].ok, true);
  assert.equal((await json("DELETE", "/api/conversations-externes/sources/inconnue")).status, 404);
});

test("REMY_SOURCE_T3=off coupe la lecture, même allumée dans l'app ; REMY_CONNAISSANCES_PROJETS filtre", async () => {
  process.env.REMY_SOURCE_T3 = "off";
  try {
    const e = (await json("GET", "/api/conversations-externes")).corps;
    assert.equal(source(e, "t3").actif, false);
    assert.equal(source(e, "t3").forceParLaTour, true);
    assert.equal((await lireTout()).bilan.sources.t3, undefined);
  } finally {
    delete process.env.REMY_SOURCE_T3;
  }
  process.env.REMY_CONNAISSANCES_PROJETS = "autre-projet";
  try {
    fx.ecrireSessionClaude(racineClaude, { dossier: "C--code-hors", session: "5e551011-0000-4000-8000-000000000077", cwd: "C:\\code\\hors-filtre", messages: [{ role: "user", texte: "rien à voir", ts: iso(HIER) }] });
    const b = (await lireTout()).bilan.sources["claude-code"];
    assert.equal(b.horsFiltre, 1);
  } finally {
    delete process.env.REMY_CONNAISSANCES_PROJETS;
  }
});

test("réglages : Rémy s'en inspire (réponses, nuit), coupable ; REMY_CONVERSATIONS_USAGE=off l'emporte", async () => {
  let e = (await json("GET", "/api/conversations-externes")).corps;
  assert.deepEqual([e.usage.chat, e.usage.nuit], [true, true]);
  e = (await json("PUT", "/api/conversations-externes/usage", { chat: false })).corps;
  assert.deepEqual([e.usage.chat, e.usage.nuit], [false, true]);
  assert.equal((await json("PUT", "/api/conversations-externes/usage", {})).status, 400);
  await json("PUT", "/api/conversations-externes/usage", { chat: true });
  process.env.REMY_CONVERSATIONS_USAGE = "off";
  try {
    e = (await json("GET", "/api/conversations-externes")).corps;
    assert.deepEqual([e.usage.chat, e.usage.nuit, e.usage.forceParLaTour], [false, false, true]);
  } finally {
    delete process.env.REMY_CONVERSATIONS_USAGE;
  }
});

test("les anciennes routes du lot B répondent encore (script de la tour)", async () => {
  const e = await json("GET", "/api/connaissances");
  assert.equal(e.status, 200);
  assert.ok(Array.isArray(e.corps.sources));
  assert.equal((await json("PUT", "/api/connaissances/sources", { "claude-code": true })).status, 200);
  assert.equal((await json("GET", "/api/connaissances/chercher?q=figuier")).status, 200);
});

test("une base du lot B (passages EN CLAIR) est vidée de son texte à la migration", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { base } = await import("../lib/connaissances/base.js");
  fermer();
  const vrai = cheminConnaissances();
  const sauve = `${vrai}.sauve`;
  fs.renameSync(vrai, sauve);
  for (const s of ["-wal", "-shm"]) fs.rmSync(vrai + s, { force: true });
  try {
    const b = new DatabaseSync(vrai);
    b.exec(`CREATE TABLE meta (cle TEXT PRIMARY KEY, valeur TEXT); INSERT INTO meta VALUES ('schema', '1');
      CREATE TABLE passages (id INTEGER PRIMARY KEY, texte TEXT); INSERT INTO passages (texte) VALUES ('${"Kervella secret du lot B ".repeat(50)}');`);
    b.close();
    assert.ok(fs.readFileSync(vrai).includes(Buffer.from("Kervella")));
    assert.equal(base().prepare("SELECT valeur FROM meta WHERE cle = 'schema'").get().valeur, "2");
    assert.equal(base().prepare("SELECT name FROM sqlite_master WHERE name = 'passages'").get(), undefined);
    fermer();
    assert.equal(fs.readFileSync(vrai).includes(Buffer.from("Kervella")), false, "VACUUM : le texte en clair a quitté le fichier");
  } finally {
    fermer();
    fs.rmSync(vrai, { force: true });
    for (const s of ["-wal", "-shm"]) fs.rmSync(vrai + s, { force: true });
    fs.renameSync(sauve, vrai);
  }
});
