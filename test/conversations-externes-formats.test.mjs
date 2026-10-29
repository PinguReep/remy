// Contre-relecture « formats et usage » du 29/10, rejouée après correctifs :
// T3 qui importe une session avec ses dates d'origine, déclencheurs trop
// larges, passages mal choisis, nuit qui ne lisait que le début, envoi lent,
// secrets au format .env, conversations vocales et Canvas de ChatGPT,
// dossier Imports tel qu'un humain le remplit, lignes Claude Code abîmées,
// pagination, et scellement des conversations privées sur le disque.
// Données FICTIVES (Sam, la boutique de bougies, Élodie).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-conv-formats-"));
const racineClaude = path.join(dossier, "claude");
const racineT3 = path.join(dossier, "t3");
const imports = path.join(dossier, "imports");
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_SOURCE_CLAUDE_CODE", "REMY_SOURCE_T3", "REMY_SOURCE_CHATGPT",
  "REMY_CONNAISSANCES_PROJETS", "REMY_CONVERSATIONS_CLE", "REMY_CONVERSATIONS_USAGE", "REMY_CLAUDE_DIRS", "T3CODE_HOME", "REMY_IMPORT_MAX_MO", "REMY_IMPORTS_GARDE_JOURS", "REMY_PRENOM"]) delete process.env[v];
process.env.REMY_DATA_DIR = path.join(dossier, "data");
process.env.REMY_CLES_DIR = path.join(dossier, "cles");
process.env.CLAUDE_CONFIG_DIR = racineClaude;
process.env.REMY_T3_DIRS = racineT3;
process.env.REMY_IMPORTS_DIR = imports;
process.env.HOME = path.join(dossier, "maison");
process.env.USERPROFILE = process.env.HOME;

const fx = await import("./outils/conversations-fictives.mjs");
const sync = await import("../lib/connaissances/sync.js");
const usage = await import("../lib/connaissances/usage.js");
const { matiereDuJour, jourPrecedent } = await import("../lib/connaissances/nuit.js");
const { masquer, oublierSecretsDeLaTour } = await import("../lib/connaissances/masquage.js");
const { conversationDe } = await import("../lib/connaissances/chatgpt.js");
const { importerChatGPT } = await import("../lib/connaissances/handlers.js");
const { fermer, base } = await import("../lib/connaissances/base.js");
const { oublierCle } = await import("../lib/connaissances/chiffre.js");
const { debutJour } = await import("../lib/dashboard.js");
const { TZ } = await import("../lib/activite.js");
const store = await import("../lib/store.js");
oublierSecretsDeLaTour();

test.after(() => {
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;
const H = 3600_000;
const MAINTENANT = Date.now();
// Midi, hier, à Paris : une journée entière autour, quelle que soit l'heure du test.
const MIDI_HIER = debutJour(MAINTENANT - 24 * H, TZ) + 12 * H;
const vieux = (f) => {
  const t = new Date(Date.now() - MIN);
  fs.utimesSync(f, t, t);
};
const vue = () => sync.liste({ limite: 100 }).conversations.map((c) => `${c.source}:${c.titre}`);

// =============================================================================================
// T3 : le curseur suit l'ordre d'insertion
// =============================================================================================

test("T3 : une session Claude importée DANS T3 avec ses dates d'origine n'est jamais perdue (liste et recherche)", async () => {
  const IL_Y_A_10J = MAINTENANT - 10 * 24 * H;
  const SESSION = "aaaaaaaa-1111-4222-8333-444444444444";
  fx.ecrireSessionClaude(racineClaude, {
    session: SESSION,
    titre: "Refonte du panier",
    messages: [
      { role: "user", texte: "Refais le panier avec le récapitulatif des frais de port.", ts: iso(IL_Y_A_10J) },
      { role: "assistant", texte: "Le récapitulatif des frais de port est en place dans le panier.", ts: iso(IL_Y_A_10J + MIN) },
    ],
  });
  const fichier = path.join(racineT3, "userdata", "statev2.sqlite");
  fx.creerBaseT3(fichier, {
    projets: [{ id: "p1", titre: "Boutique", racine: "C:\\Users\\sam\\code\\bougies" }],
    fils: [{ id: "fil-a", projet: "p1", titre: "Fil du jour", cree: iso(MAINTENANT - H), maj: iso(MAINTENANT - 50 * MIN) }],
    messages: [{ id: "m1", fil: "fil-a", role: "user", texte: "Ajoute un bandeau de soldes.", cree: iso(MAINTENANT - H) }],
  });
  await sync.synchroniser();
  assert.deepEqual(vue().sort(), ["claude-code:Refonte du panier", "t3:Fil du jour"]);
  // L'assistant d'accueil de T3 importe la session : nouveau fil, lien natif, dates d'il y a 10 jours.
  const b = fx.ouvrirBaseT3(fichier);
  fx.ajouterT3(b, {
    fils: [{ id: "fil-importe", projet: "p1", titre: "Refonte du panier", fournisseur: "claudeAgent", cree: iso(IL_Y_A_10J), maj: iso(IL_Y_A_10J + MIN), natif: SESSION }],
    messages: [
      { id: "fil-importe:000000", fil: "fil-importe", role: "user", texte: "Refais le panier avec le récapitulatif des frais de port.", cree: iso(IL_Y_A_10J), par: "user" },
      { id: "fil-importe:000001", fil: "fil-importe", role: "assistant", texte: "Le récapitulatif des frais de port est en place dans le panier.", cree: iso(IL_Y_A_10J + MIN) },
    ],
  });
  b.close();
  const r = await sync.synchroniser({ sources: ["t3"] });
  assert.equal(r.sources.t3.ok, true);
  assert.deepEqual(vue().sort(), ["t3:Fil du jour", "t3:Refonte du panier"], "montrée une fois, sous T3");
  assert.ok(sync.chercher("récapitulatif frais de port").length >= 1);
});

test("T3 : un message daté dans le futur ne bloque plus la lecture ; une réponse finie après coup est lue", async () => {
  const fichier = path.join(racineT3, "userdata", "statev2.sqlite");
  const b = fx.ouvrirBaseT3(fichier);
  // Horloge du téléphone en avance d'un jour, puis des messages ordinaires.
  fx.ajouterT3(b, { messages: [{ id: "m-futur", fil: "fil-a", role: "user", texte: "Message daté de demain (horloge en avance).", cree: iso(MAINTENANT + 24 * H) }] });
  await sync.synchroniser({ sources: ["t3"] });
  fx.ajouterT3(b, {
    messages: [
      { id: "m-ensuite", fil: "fil-a", role: "user", texte: "Et le bandeau en rouge vermillon ?", cree: iso(MAINTENANT) },
      { id: "m-en-cours", fil: "fil-a", role: "assistant", texte: "Je mets", cree: iso(MAINTENANT), streaming: true },
    ],
  });
  await sync.synchroniser({ sources: ["t3"] });
  assert.ok(sync.chercher("vermillon").length === 1, "lu malgré le message du futur");
  assert.equal(sync.chercher("cramoisi").length, 0);
  // La réponse se termine (même ligne, mise à jour) : lue à la lecture suivante.
  b.prepare("UPDATE orchestration_v2_projection_messages SET streaming = 0, updated_at = ?, payload_json = json_set(payload_json, '$.text', ?) WHERE message_id = 'm-en-cours'").run(
    iso(Date.now()),
    "Je mets le bandeau en rouge cramoisi, plus lisible.",
  );
  b.close();
  const r = await sync.synchroniser({ sources: ["t3"] });
  assert.equal(sync.chercher("cramoisi").length, 1, JSON.stringify(r.sources.t3));
  // Relu sans changement : rien de réécrit.
  const r2 = await sync.synchroniser({ sources: ["t3"] });
  assert.equal(r2.sources.t3.messages + r2.sources.t3.majs, 0);
});

test("T3 : une table de messages sans rowid (WITHOUT ROWID) se lit aussi, nouvelles lignes et modifications comprises", async () => {
  const t3 = await import("../lib/connaissances/t3.js");
  // Un chemin avec accents et espaces (profil Windows « Élodie Martin ») : la base fermée s'ouvre en « immutable » par une URL.
  const fichier = path.join(dossier, "Données Élodie", "t3 sans rowid", "statev2.sqlite");
  fx.creerBaseT3(fichier, {
    projets: [{ id: "p9", titre: "Atelier", racine: "C:\\Users\\sam\\code\\atelier" }],
    fils: [{ id: "fil-z", projet: "p9", titre: "Sans rowid", cree: iso(MAINTENANT - H) }],
  });
  // La même table, refaite WITHOUT ROWID.
  const b = fx.ouvrirBaseT3(fichier);
  b.exec(`DROP TABLE orchestration_v2_projection_messages;
    CREATE TABLE orchestration_v2_projection_messages (message_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, run_id TEXT, node_id TEXT, role TEXT NOT NULL, streaming INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL) WITHOUT ROWID;`);
  fx.ajouterT3(b, { messages: [{ id: "z1", fil: "fil-z", role: "user", texte: "Première ligne sans rowid.", cree: iso(MAINTENANT - H) }] });
  b.close();
  const r1 = await t3.lireBase(fichier, null);
  assert.deepEqual(r1.messages.map((m) => m.texte), ["Première ligne sans rowid."]);
  const b2 = fx.ouvrirBaseT3(fichier);
  fx.ajouterT3(b2, { messages: [{ id: "z2", fil: "fil-z", role: "assistant", texte: "Réponse ajoutée ensuite.", cree: iso(Date.now()) }] });
  b2.close();
  const r2 = await t3.lireBase(fichier, r1.curseur, { connus: new Set(["fil-z"]) });
  assert.ok(r2.messages.some((m) => m.texte === "Réponse ajoutée ensuite."));
});

// =============================================================================================
// Rémy : quand puiser, et quoi
// =============================================================================================

test("usage : « où j'en suis », « au bureau », « Rémy, … » ne rendent plus une conversation privée", async () => {
  fx.ecrireSessionClaude(racineClaude, {
    dossier: "C--OneDrive-Bureau",
    cwd: "C:\\Users\\Élodie Martin\\OneDrive\\Bureau",
    titre: "Script de renommage",
    messages: [
      { role: "user", texte: "Renomme les photos du dossier vacances avec la date de prise de vue.", ts: iso(MAINTENANT - 30 * H) },
      { role: "assistant", texte: "Le script renomme chaque photo ; demain tu pourras le relancer.", ts: iso(MAINTENANT - 30 * H + MIN) },
    ],
  });
  fx.ecrireSessionClaude(racineClaude, {
    dossier: "C--code-remy",
    cwd: "C:\\Users\\Élodie Martin\\code\\remy",
    titre: "Rappels de Rémy",
    messages: [
      { role: "user", texte: "Quand Rémy envoie un rappel le matin, la notification doit arriver avant 8 h.", ts: iso(MAINTENANT - 50 * H) },
      { role: "assistant", texte: "Rémy programme la notification du rappel du matin à 7 h 45.", ts: iso(MAINTENANT - 50 * H + MIN) },
    ],
  });
  fx.ecrireSessionClaude(racineClaude, {
    dossier: "C--code-bougies",
    cwd: "C:\\Users\\Élodie Martin\\code\\Boutique Bougies",
    titre: "Purge du cache",
    messages: [
      { role: "user", texte: "Ajoute une tâche planifiée qui purge le cache des images chaque nuit.", ts: iso(MAINTENANT - 2 * H) },
      { role: "assistant", texte: "La tâche planifiée purge maintenant le cache des images à 3 h.", ts: iso(MAINTENANT - 2 * H + MIN) },
    ],
  });
  await sync.synchroniser({ sources: ["claude-code"] });
  const projets = sync.nomsDeProjets();
  assert.ok(projets.includes("Bureau") && projets.includes("remy"));
  assert.ok(projets.includes("Boutique Bougies"), `le nom garde ses majuscules : ${JSON.stringify(projets)}`);
  for (const q of ["Où j'en suis dans mes tâches aujourd'hui ?", "Je pars au bureau à quelle heure demain ?", "Rémy, tu peux m'envoyer la notification du rappel plus tôt ?", "J'ai racheté des bougies parfumées."]) {
    assert.equal(usage.seRapporte(q), null, q);
    assert.equal(usage.passagesPourQuestion(q, { maintenant: MAINTENANT }), null, q);
  }
  // Désigné, un projet compte ; un nom de plusieurs mots suffit seul.
  assert.equal(usage.seRapporte("Où en est le projet Boutique Bougies ?"), "projet");
  assert.equal(usage.seRapporte("Et la boutique bougies, on en est où ?"), "projet");
  assert.equal(usage.seRapporte("Dans ma session Claude Code d'hier, qu'est-ce que j'avais décidé ?"), "source");
});

test("usage : « on avait décidé quoi ? » rend la décision, pas le bruit plus récent qui partage un mot", async () => {
  fx.ecrireSessionClaude(racineClaude, {
    dossier: "C--code-bougies",
    cwd: "C:\\Users\\Élodie Martin\\code\\Boutique Bougies",
    titre: "Moyen de paiement",
    messages: [
      { role: "user", texte: "On part sur Stripe pour le paiement en trois fois, PayPal prend trop de frais.", ts: iso(MAINTENANT - 72 * H) },
      { role: "assistant", texte: "C'est noté : Stripe pour le paiement en trois fois.", ts: iso(MAINTENANT - 72 * H + MIN) },
    ],
  });
  const bruit = [];
  for (let i = 0; i < 8; i++) {
    bruit.push({ role: i % 2 ? "assistant" : "user", texte: i % 2 ? `Le test du module de paiement passe (cas ${i}).` : `Relance les tests du paiement, le cas ${i} échoue encore.`, ts: iso(MAINTENANT - (20 - i) * H) });
  }
  fx.ecrireSessionClaude(racineClaude, { dossier: "C--code-bougies", cwd: "C:\\Users\\Élodie Martin\\code\\Boutique Bougies", titre: "Tests du module", messages: bruit });
  await sync.synchroniser({ sources: ["claude-code"] });
  for (const q of ["On avait décidé quoi pour le paiement ?", "Qu'est-ce que j'avais décidé pour le paiement avec Claude ?"]) {
    const r = usage.passagesPourQuestion(q, { maintenant: MAINTENANT });
    assert.ok(r, q);
    assert.match(r.texte, /Stripe/);
    assert.doesNotMatch(r.texte, /Tests du module/, `${q} : pas le bruit`);
  }
});

test("usage et nuit : « il fallait que je rappelle qui avant vendredi ? » trouve la ligne au milieu d'une longue session d'hier ; la nuit la lit aussi", async () => {
  const messages = [];
  for (let i = 0; i < 114; i++) {
    const t = MIDI_HIER - 3 * H + i * MIN;
    if (i === 68) messages.push({ role: "user", texte: "Au fait, il faudra rappeler le comptable avant vendredi pour l'export de la TVA.", ts: iso(t) });
    else messages.push({ role: i % 2 ? "assistant" : "user", texte: i % 2 ? `Colonne ${i} du tableur exportée au format attendu.` : `Vérifie la colonne ${i} de l'export TVA.`, ts: iso(t) });
  }
  fx.ecrireSessionClaude(racineClaude, { dossier: "C--code-compta", cwd: "C:\\Users\\Élodie Martin\\code\\compta", titre: "Export TVA", messages });
  // Et 21 autres conversations le même jour (la nuit ne doit en oublier aucune).
  for (let k = 0; k < 21; k++) {
    fx.ecrireSessionClaude(racineClaude, {
      dossier: "C--code-divers",
      cwd: "C:\\Users\\Élodie Martin\\code\\divers",
      titre: `Petite session ${k}`,
      messages: [
        { role: "user", texte: `Question rapide numéro ${k} sur la mise en page.`, ts: iso(MIDI_HIER + k * 5 * MIN) },
        { role: "assistant", texte: `Réponse rapide numéro ${k}.`, ts: iso(MIDI_HIER + k * 5 * MIN + MIN) },
      ],
    });
  }
  await sync.synchroniser({ sources: ["claude-code"] });
  const r = usage.passagesPourQuestion("Il fallait que je rappelle qui avant vendredi, d'après mes sessions d'hier ?", { maintenant: MAINTENANT });
  assert.ok(r, "des passages");
  assert.match(r.texte, /comptable/);
  const m = matiereDuJour(jourPrecedent(MAINTENANT));
  assert.match(m.texte, /rappeler le comptable avant vendredi/, "la ligne à 60 % de la session est lue la nuit");
  assert.ok(m.conversations >= 22, `toutes les conversations du jour (${m.conversations})`);
  assert.match(m.texte, /Question rapide numéro 20/);
});

// =============================================================================================
// Masquage, ChatGPT, dossier Imports
// =============================================================================================

test("masquage : les lignes .env et YAML (AWS_SECRET_ACCESS_KEY=…, client_secret: …) sont masquées ; le reste reste lisible", () => {
  const secrets = [
    ["AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "wJalr"],
    ["aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "wJalr"],
    ["SMTP_PASSWORD=Vanille-et-Cedre-77", "Vanille"],
    ["MOTION_API_KEY=mK7pQ2xR9sT4vW8yZ1aB3cD5eF6gH0jL", "mK7pQ"],
    ["UPSTASH_REDIS_REST_TOKEN=AXmkASQgZjM2NzRkYzUtMmQ4Ni00ZDE1", "AXmkA"],
    ["client_secret: 9f8e7d6c5b4a39281706f5e4d3c2b1a0", "9f8e7"],
    ["APP_PASSWORD_HASH=$2b$12$abcdefghijklmnopqrstuuJ5J5J5J5J5J5J5J5J5J5J5J5J5J5J5J5", "abcdefgh"],
    ["const apiKey = 'abcd1234efgh'", "abcd1234"],
    ["Le code du digicode c'est 4B72A, et le wifi : MaisonBleue2026", "MaisonBleue"],
  ];
  for (const [ligne, morceau] of secrets) {
    const r = masquer(ligne);
    assert.ok(r.masques >= 1, ligne);
    assert.ok(!r.texte.includes(morceau), `${ligne} → ${r.texte}`);
    assert.doesNotMatch(r.texte, /masqué\] masqué\]/, "jamais masqué deux fois");
  }
  for (const neutre of ["const keyboard = createKeyboard(options);", "On garde Stripe pour le paiement : c'est validé.", "la clé de la réussite : travailler"]) {
    assert.equal(masquer(neutre).texte, neutre);
  }
});

test("ChatGPT : une conversation VOCALE (transcriptions) et un document Canvas sont gardés", () => {
  const n = (id, parent, message, children = []) => ({ id, parent, children, message });
  const m = (id, role, content, extra = {}) => ({ id, author: { role }, create_time: 1793100000 + Number(id.replace(/\D/g, "") || 0), content, metadata: {}, recipient: "all", ...extra });
  const vocal = conversationDe({
    conversation_id: "6f00aa00-0000-4000-8000-000000000001",
    title: "Rendez-vous",
    create_time: 1793100000,
    update_time: 1793100100,
    current_node: "a1",
    mapping: {
      racine: n("racine", null, null, ["u1"]),
      u1: n("u1", "racine", m("u1", "user", { content_type: "multimodal_text", parts: [{ content_type: "audio_transcription", text: "Rappelle-moi l'ostéopathe jeudi à dix-huit heures." }, { content_type: "audio_asset_pointer", asset_pointer: "sediment://file_1" }] }), ["a1"]),
      a1: n("a1", "u1", m("a1", "assistant", { content_type: "multimodal_text", parts: [{ content_type: "audio_transcription", text: "Ostéopathe jeudi à dix-huit heures, c'est noté." }] })),
    },
  });
  assert.deepEqual(vocal.conversation?.messages.map((x) => x.texte), ["Rappelle-moi l'ostéopathe jeudi à dix-huit heures.", "Ostéopathe jeudi à dix-huit heures, c'est noté."]);
  const canvas = conversationDe({
    conversation_id: "6f00aa00-0000-4000-8000-000000000002",
    title: "Lettre au bailleur",
    create_time: 1793100000,
    update_time: 1793100100,
    current_node: "a2",
    mapping: {
      racine: n("racine", null, null, ["u1"]),
      u1: n("u1", "racine", m("u1", "user", { content_type: "text", parts: ["Écris la lettre de préavis, départ fin janvier."] }), ["c1"]),
      c1: n("c1", "u1", m("c1", "assistant", { content_type: "code", text: JSON.stringify({ name: "preavis", type: "document", content: "Madame, Monsieur, je quitte le logement au 31 janvier." }) }, { recipient: "canmore.create_textdoc" }), ["t1"]),
      t1: n("t1", "c1", m("t1", "tool", { content_type: "text", parts: ["Successfully created text document"] }), ["a2"]),
      a2: n("a2", "t1", m("a2", "assistant", { content_type: "text", parts: ["Voilà la lettre dans le document à côté."] })),
    },
  });
  const textes = canvas.conversation.messages.map((x) => x.texte);
  assert.equal(textes.length, 3);
  assert.match(textes[1], /^\[Document « preavis »\]\nMadame, Monsieur, je quitte le logement/);
  assert.ok(!textes.some((t) => /Successfully created/.test(t)), "le retour de l'outil n'est pas gardé");
});

test("Imports : un export décompressé dans un sous-dossier est lu ; à plat, les fichiers annexes ne font pas d'erreur", async () => {
  await sync.reglerSource("chatgpt", true);
  const conv = fx.conversationChatGPT({ id: "6f00aa00-0000-4000-8000-0000000000aa", titre: "Coffrets de Noël", debut: Math.round((MAINTENANT - 24 * H) / 1000), echanges: [["Trois idées de coffrets ?", "Forêt, Agrumes, Épices."]] });
  const sous = path.join(imports, "1a2b3c-2026-10-28-21-04-11");
  fs.mkdirSync(sous, { recursive: true });
  fs.writeFileSync(path.join(sous, "conversations.json"), JSON.stringify([conv]));
  fs.writeFileSync(path.join(sous, "user.json"), JSON.stringify({ id: "user-x" }));
  vieux(path.join(sous, "conversations.json"));
  vieux(path.join(sous, "user.json"));
  assert.equal(sync.etat().imports.enAttente, 1);
  let r = await sync.synchroniser({ sources: ["chatgpt"] });
  assert.equal(r.sources.chatgpt.importes, 1, JSON.stringify(r.sources.chatgpt));
  assert.ok(!fs.existsSync(sous), "le sous-dossier a quitté Imports");
  assert.ok(vue().includes("chatgpt:Coffrets de Noël"));
  // À plat, avec les fichiers annexes de l'export.
  const autre = fx.conversationChatGPT({ id: "6f00aa00-0000-4000-8000-0000000000ab", titre: "Étiquettes kraft", debut: Math.round((MAINTENANT - 24 * H) / 1000), echanges: [["Une étiquette kraft ?", "Oui, écriture blanche."]] });
  for (const [nom, contenu] of [["conversations.json", JSON.stringify([autre])], ["user.json", "{}"], ["message_feedback.json", "[]"], ["shared_conversations.json", "[]"]]) {
    fs.writeFileSync(path.join(imports, nom), contenu);
    vieux(path.join(imports, nom));
  }
  r = await sync.synchroniser({ sources: ["chatgpt"] });
  assert.equal(r.sources.chatgpt.ok, true, JSON.stringify(r.sources.chatgpt));
  assert.equal(sync.etat().sources.find((s) => s.id === "chatgpt").erreur, null);
  assert.deepEqual(fs.readdirSync(imports), [], "les fichiers de l'export partent avec lui (user.json a ton adresse)");
  const parti = fs.readdirSync(sync.dossierOriginaux()).find((n) => n.endsWith("-conversations.json"));
  assert.deepEqual(fs.readdirSync(path.join(sync.dossierOriginaux(), parti)).sort(), ["conversations.json", "message_feedback.json", "shared_conversations.json", "user.json"]);
});

test("Imports : un .zip abîmé est refusé (somme de contrôle), avec le bon conseil, et n'est pas relu tant qu'il ne change pas", async () => {
  const conv = fx.conversationChatGPT({ id: "6f00aa00-0000-4000-8000-0000000000ac", titre: "Mèches", debut: Math.round((MAINTENANT - 24 * H) / 1000), echanges: [["Quelle mèche ?", "Coton, taille moyenne."]] });
  // Stocké sans compression : quelques octets altérés passent l'analyse JSON mais pas la somme de contrôle.
  const zip = fx.zipper([{ nom: "conversations.json", contenu: JSON.stringify([conv]), stocke: true }]);
  const i = zip.indexOf(Buffer.from("Coton"));
  assert.ok(i > 0, "entrée stockée telle quelle");
  zip.write("Cotin", i);
  const f = path.join(imports, "export.zip");
  fs.writeFileSync(f, zip);
  vieux(f);
  const r = await sync.synchroniser({ sources: ["chatgpt"] });
  const e = r.sources.chatgpt.erreur;
  assert.equal(e.code, "zip-invalide", JSON.stringify(e));
  assert.match(e.message, /somme de contrôle/);
  assert.match(e.quoiFaire, /Retélécharge/);
  // Pas relu : le même fichier garde son erreur sans rien recalculer.
  const lus = base().prepare("SELECT COUNT(*) AS n FROM journal WHERE source = 'chatgpt'").get().n;
  const r2 = await sync.synchroniser({ sources: ["chatgpt"] });
  assert.equal(r2.sources.chatgpt.erreur.code, "zip-invalide");
  assert.ok(base().prepare("SELECT COUNT(*) AS n FROM journal WHERE source = 'chatgpt'").get().n > lus);
  assert.ok(fs.existsSync(f), "il reste, en attendant le bon fichier");
  // Le bon fichier, déposé à la place : importé.
  fs.writeFileSync(f, fx.exportChatGPT([conv]));
  vieux(f);
  const r3 = await sync.synchroniser({ sources: ["chatgpt"] });
  assert.equal(r3.sources.chatgpt.ok, true, JSON.stringify(r3.sources.chatgpt));
});

// =============================================================================================
// Claude Code : lignes abîmées
// =============================================================================================

test("Claude Code : texte tapé avec une capture de 5 Mo gardé, « [Request interrupted by user] » écarté, reprise après des octets nuls", async () => {
  const d = path.join(racineClaude, "projects", "C--code-lignes");
  fs.mkdirSync(d, { recursive: true });
  const S = "bbbbbbbb-1111-4222-8333-444444444444";
  const base0 = { sessionId: S, cwd: "C:\\Users\\Élodie Martin\\code\\lignes", entrypoint: "cli", isSidechain: false };
  let n = 0;
  const ligne = (o) => JSON.stringify({ ...base0, uuid: `u-${++n}`, ...o });
  const t = (min) => iso(MAINTENANT - (120 - min) * MIN);
  const image = "A".repeat(5 * 1024 * 1024);
  const f = path.join(d, `${S}.jsonl`);
  fs.writeFileSync(
    f,
    [
      ligne({ type: "user", timestamp: t(1), message: { role: "user", content: "Corrige le bandeau du panier." } }),
      ligne({ type: "user", timestamp: t(3), message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: image } }, { type: "text", text: "Regarde cette capture : le prix barré déborde sur mobile." }] } }),
      ligne({ type: "user", timestamp: t(5), message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } }),
    ].join("\n") +
      "\n" +
      "\0".repeat(4096),
  );
  await sync.synchroniser({ sources: ["claude-code"] });
  fs.appendFileSync(f, ligne({ type: "user", timestamp: t(10), message: { role: "user", content: "On reprend : ajoute le badge Nouveau sur les bougies d'automne." } }) + "\n");
  const r = await sync.synchroniser({ sources: ["claude-code"] });
  assert.equal(r.sources["claude-code"].illisibles, 0);
  const l = sync.lire("claude-code", S);
  assert.deepEqual(
    l.messages.map((m) => m.texte),
    ["Corrige le bandeau du panier.", "Regarde cette capture : le prix barré déborde sur mobile.", "On reprend : ajoute le badge Nouveau sur les bougies d'automne."],
  );
});

test("lecture : pages sur (date, identifiant) même quand les dates se croisent ; « autour » ouvre au message trouvé", async () => {
  // 30 messages écrits dans le désordre de leurs dates (la reprise d'une session).
  const messages = [];
  for (let i = 0; i < 30; i++) messages.push({ role: i % 2 ? "assistant" : "user", texte: `Étape ${String(i).padStart(2, "0")} du déménagement.`, ts: iso(MAINTENANT - 5 * H + (i % 3 === 0 ? i + 40 : i) * MIN) });
  const { session } = fx.ecrireSessionClaude(racineClaude, { dossier: "C--code-pages", cwd: "C:\\Users\\Élodie Martin\\code\\pages", titre: "Pages", messages });
  await sync.synchroniser({ sources: ["claude-code"] });
  const vus = [];
  let apres = 0;
  for (let k = 0; k < 10; k++) {
    const p = sync.lire("claude-code", session, { apres, limite: 7 });
    vus.push(...p.messages.map((m) => m.texte));
    if (!p.suite) break;
    apres = p.suite;
  }
  assert.equal(vus.length, 30, "aucun message sauté ni répété");
  assert.equal(new Set(vus).size, 30);
  const cherche = sync.chercher("Étape 25").find((x) => x.conversation === session);
  const a = sync.lire("claude-code", session, { autour: cherche.message, limite: 20 });
  assert.equal(a.cible, cherche.message);
  assert.ok(a.messages.some((m) => m.id === cherche.message));
  assert.equal(typeof a.avant, "boolean");
});

// =============================================================================================
// Envoi lent depuis l'iPhone
// =============================================================================================

test("envoi : un export qui met plus longtemps que le délai de réception de Node arrive quand même (et le délai est rendu)", async () => {
  const srv = http.createServer({ requestTimeout: 1500, connectionsCheckingInterval: 100 }, (req, res) => importerChatGPT(req, res));
  const avant = srv.requestTimeout;
  process.env.APP_PASSWORD = "";
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const conv = fx.conversationChatGPT({ id: "6f00aa00-0000-4000-8000-0000000000ad", titre: "Envoi lent", debut: Math.round((MAINTENANT - 24 * H) / 1000), echanges: [["Envoi lent ?", "Oui, en 4G."]] });
    const donnees = Buffer.from(JSON.stringify([conv]));
    const reponse = await new Promise((ok, ko) => {
      const req = http.request({ host: "127.0.0.1", port: srv.address().port, method: "POST", path: "/api/conversations-externes/chatgpt", headers: { "Content-Type": "application/json", "Content-Length": donnees.length } }, (res) => {
        let corps = "";
        res.on("data", (c) => (corps += c));
        res.on("end", () => ok({ status: res.statusCode, corps }));
      });
      req.on("error", ko);
      // 3 s pour tout envoyer, en petits morceaux : deux fois le délai de Node.
      const morceaux = 10;
      const taille = Math.ceil(donnees.length / morceaux);
      let i = 0;
      const suite = () => {
        if (i >= morceaux) return req.end();
        req.write(donnees.subarray(i * taille, (i + 1) * taille));
        i++;
        setTimeout(suite, 300);
      };
      suite();
    });
    assert.equal(reponse.status, 200, reponse.corps);
    assert.equal(JSON.parse(reponse.corps).bilan.nouvelles, 1);
    assert.equal(srv.requestTimeout, avant, "délai rendu après l'envoi");
  } finally {
    srv.close();
  }
});

// =============================================================================================
// Une conversation de Rémy qui cite tes conversations d'ailleurs : scellée sur le disque
// =============================================================================================

test("scellée : une conversation qui cite la matière d'ailleurs n'est jamais en clair dans conversations.json ; une autre clé la rend illisible sans la détruire", async () => {
  const conv = { id: "c0ffee00-1111-4000-8000-000000000001", title: "Paiement Stripe en trois fois", createdAt: MAINTENANT, updatedAt: MAINTENANT, prive: true, matiereExterne: true, messages: [{ role: "user", content: "Dans ma session Claude Code, on part sur Stripe ?" }, { role: "assistant", content: "Oui : Stripe, paiement en trois fois." }] };
  await store.putConversation(conv);
  await store.putConversation({ id: "c0ffee00-1111-4000-8000-000000000002", title: "Courses de la semaine", createdAt: MAINTENANT, updatedAt: MAINTENANT, messages: [{ role: "user", content: "Liste de courses" }] });
  const fichier = path.join(process.env.REMY_DATA_DIR, "conversations.json");
  const brut = fs.readFileSync(fichier, "utf8");
  assert.doesNotMatch(brut, /Stripe/);
  assert.match(brut, /Courses de la semaine/, "les autres restent lisibles");
  assert.equal((await store.getConversation(conv.id)).messages[1].content, "Oui : Stripe, paiement en trois fois.");
  assert.ok((await store.listConversations()).some((c) => c.title === "Paiement Stripe en trois fois"));
  // Une autre clé (restauration sans la clé) : illisible, mais jamais écrasée.
  const sauve = fs.readFileSync(path.join(process.env.REMY_CLES_DIR, "conversations.cle"), "utf8");
  process.env.REMY_CONVERSATIONS_CLE = "ab".repeat(32);
  oublierCle();
  try {
    const illisible = await store.getConversation(conv.id);
    assert.equal(illisible.illisible, true);
    assert.deepEqual(illisible.messages, []);
    await store.putConversation({ id: "c0ffee00-1111-4000-8000-000000000003", title: "Autre", createdAt: MAINTENANT, updatedAt: MAINTENANT, messages: [] });
  } finally {
    delete process.env.REMY_CONVERSATIONS_CLE;
    oublierCle();
  }
  assert.equal(fs.readFileSync(path.join(process.env.REMY_CLES_DIR, "conversations.cle"), "utf8"), sauve);
  assert.equal((await store.getConversation(conv.id)).messages.length, 2, "avec la bonne clé, tout revient");
});
