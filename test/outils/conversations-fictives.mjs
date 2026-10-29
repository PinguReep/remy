// Des conversations FICTIVES dans les trois formats que lit la tour (29/10) :
// sessions Claude Code (JSONL), base de T3 Code (SQLite, schéma V2 de l'amont
// pingdotgg/t3code), export ChatGPT (.zip avec conversations.json). Sam, Léa,
// Hugo, la boutique de bougies : rien de réel. Servent aux tests et à la tour
// de démo des parcours de l'app iPhone.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// --- Claude Code ----------------------------------------------------------------------

let compteur = 0;
const uuid = (prefixe = "0000") => `${prefixe.padEnd(8, "0").slice(0, 8)}-0000-4000-8000-${String(++compteur).padStart(12, "0")}`;

// messages : [{ role: "user" | "assistant", texte, ts, extra }]
export function ecrireSessionClaude(racine, { dossier = "C--Users-sam-code-bougies", session, cwd = "C:\\Users\\sam\\code\\bougies", entrypoint = "cli", titre = null, messages = [], lignesEnPlus = [] } = {}) {
  const d = path.join(racine, "projects", dossier);
  fs.mkdirSync(d, { recursive: true });
  const id = session || uuid("5e55");
  const lignes = [];
  let parent = null;
  for (const m of messages) {
    const u = uuid();
    lignes.push({
      type: m.role,
      uuid: u,
      parentUuid: parent,
      sessionId: id,
      timestamp: m.ts || "2026-10-27T09:00:00.000Z",
      cwd,
      entrypoint,
      isSidechain: false,
      message: { role: m.role, content: m.role === "assistant" ? [{ type: "text", text: m.texte }] : m.texte },
      ...(m.extra || {}),
    });
    parent = u;
  }
  if (titre) lignes.push({ type: "custom-title", customTitle: titre, sessionId: id });
  lignes.push(...lignesEnPlus);
  const f = path.join(d, `${id}.jsonl`);
  fs.writeFileSync(f, lignes.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return { fichier: f, session: id };
}

// --- T3 Code ---------------------------------------------------------------------------

// Le schéma V2 de T3 Code (extrait des migrations 005, 055 et 069 de l'amont).
const SCHEMA_T3 = `
  CREATE TABLE effect_sql_migrations (migration_id INTEGER PRIMARY KEY NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, name VARCHAR(255) NOT NULL);
  CREATE TABLE projection_projects (project_id TEXT PRIMARY KEY, title TEXT NOT NULL, workspace_root TEXT NOT NULL, default_model TEXT, scripts_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
  CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, default_provider TEXT NOT NULL, runtime_mode TEXT NOT NULL, interaction_mode TEXT NOT NULL, active_provider_thread_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, deleted_at TEXT, payload_json TEXT NOT NULL);
  CREATE TABLE orchestration_v2_projection_messages (message_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, run_id TEXT, node_id TEXT, role TEXT NOT NULL, streaming INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL);
  CREATE INDEX orchestration_v2_projection_messages_thread_created_idx ON orchestration_v2_projection_messages(thread_id, created_at, message_id);
  CREATE TABLE orchestration_v2_projection_provider_threads (provider_thread_id TEXT PRIMARY KEY, thread_id TEXT, owner_node_id TEXT, provider TEXT NOT NULL, provider_session_id TEXT, status TEXT NOT NULL, first_run_ordinal INTEGER, last_run_ordinal INTEGER, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL, driver TEXT, provider_instance_id TEXT);
  CREATE VIRTUAL TABLE orchestration_v2_message_search USING fts5(text, content = '', contentless_delete = 1, tokenize = 'trigram remove_diacritics 1');
  CREATE TRIGGER orchestration_v2_message_search_insert AFTER INSERT ON orchestration_v2_projection_messages
  WHEN new.streaming = 0 BEGIN
    INSERT INTO orchestration_v2_message_search (rowid, text) SELECT new.rowid, json_extract(new.payload_json, '$.text') WHERE json_extract(new.payload_json, '$.text') IS NOT NULL;
  END;
`;

export function ouvrirBaseT3(fichier) {
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const b = new DatabaseSync(fichier);
  return b;
}

// projets : [{ id, titre, racine }] ; fils : [{ id, projet, titre, fournisseur,
// cree, maj, supprime, sousAgent, natif }] ; messages : [{ id, fil, role,
// texte, cree, maj, par, streaming, script }]
export function creerBaseT3(fichier, { projets = [], fils = [], messages = [], wal = false } = {}) {
  const b = ouvrirBaseT3(fichier);
  b.exec(wal ? "PRAGMA journal_mode = WAL;" : "PRAGMA journal_mode = DELETE;");
  b.exec(SCHEMA_T3);
  b.prepare("INSERT INTO effect_sql_migrations (migration_id, name) VALUES (?, ?)").run(69, "ThreadMessageSearch");
  ajouterT3(b, { projets, fils, messages });
  if (!wal) b.close();
  return b;
}

export function ajouterT3(b, { projets = [], fils = [], messages = [] } = {}) {
  for (const p of projets) {
    b.prepare("INSERT OR REPLACE INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at) VALUES (?, ?, ?, '[]', ?, ?, ?)").run(
      p.id, p.titre, p.racine, "2026-10-01T08:00:00.000Z", "2026-10-01T08:00:00.000Z", p.supprime ? "2026-10-02T08:00:00.000Z" : null,
    );
  }
  for (const f of fils) {
    const payload = JSON.stringify({ title: f.titre, ...(f.sousAgent ? { lineage: { relationshipToParent: "subagent" } } : {}) });
    b.prepare(
      `INSERT OR REPLACE INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, deleted_at, payload_json)
       VALUES (?, ?, ?, ?, 'full-access', 'default', ?, ?, ?, ?)`,
    ).run(f.id, f.projet, f.titre, f.fournisseur || "claudeAgent", f.cree || "2026-10-27T10:00:00.000Z", f.maj || f.cree || "2026-10-27T10:00:00.000Z", f.supprime ? "2026-10-28T10:00:00.000Z" : null, payload);
    if (f.natif) {
      b.prepare(
        `INSERT OR REPLACE INTO orchestration_v2_projection_provider_threads (provider_thread_id, thread_id, provider, status, updated_at, payload_json, driver)
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      ).run(`pt-${f.id}`, f.id, f.fournisseur || "claudeAgent", "2026-10-27T10:00:00.000Z", JSON.stringify({ nativeThreadRef: { nativeId: f.natif } }), f.fournisseur || "claudeAgent");
    }
  }
  for (const m of messages) {
    const payload = JSON.stringify({ id: m.id, threadId: m.fil, role: m.role, text: m.texte, attachments: [], streaming: Boolean(m.streaming), createdAt: m.cree, updatedAt: m.maj || m.cree, ...(m.par ? { createdBy: m.par } : {}), ...(m.script ? { workflowScript: true } : {}) });
    b.prepare(
      `INSERT OR REPLACE INTO orchestration_v2_projection_messages (message_id, thread_id, role, streaming, created_at, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(m.id, m.fil, m.role, m.streaming ? 1 : 0, m.cree, m.maj || m.cree, payload);
  }
}

// --- ChatGPT -------------------------------------------------------------------------------

// Une conversation au format de l'export : un arbre avec une réponse
// regénérée (la branche gardée est celle de current_node), des consignes
// personnalisées, un message système caché et un appel d'outil.
export function conversationChatGPT({ id, titre, debut, echanges, regeneree = null }) {
  const mapping = {};
  const racine = `${id}-racine`;
  mapping[racine] = { id: racine, message: null, parent: null, children: [] };
  let parent = racine;
  let t = debut;
  const ajouter = (noeud) => {
    mapping[noeud.id] = { ...noeud, parent, children: [] };
    mapping[parent].children.push(noeud.id);
    parent = noeud.id;
  };
  ajouter({ id: `${id}-sys`, message: { id: `${id}-sys`, author: { role: "system" }, content: { content_type: "text", parts: [""] }, metadata: { is_visually_hidden_from_conversation: true } } });
  ajouter({ id: `${id}-ctx`, message: { id: `${id}-ctx`, author: { role: "user" }, content: { content_type: "user_editable_context", user_profile: "Consignes personnalisées" }, metadata: { is_visually_hidden_from_conversation: true, is_user_system_message: true } } });
  echanges.forEach(([question, reponse], i) => {
    t += 60;
    ajouter({ id: `${id}-q${i}`, message: { id: `${id}-q${i}`, author: { role: "user" }, create_time: t, content: { content_type: "text", parts: [question] }, metadata: {} } });
    if (i === echanges.length - 1 && regeneree) {
      // Une première réponse, jetée (branche abandonnée).
      const q = parent;
      mapping[`${id}-jetee`] = { id: `${id}-jetee`, parent: q, children: [], message: { id: `${id}-jetee`, author: { role: "assistant" }, create_time: t + 5, content: { content_type: "text", parts: [regeneree] }, metadata: {} } };
      mapping[q].children.push(`${id}-jetee`);
    }
    t += 30;
    ajouter({ id: `${id}-outil${i}`, message: { id: `${id}-outil${i}`, author: { role: "assistant" }, recipient: "browser", create_time: t, content: { content_type: "code", text: "search('...')" }, metadata: {} } });
    ajouter({ id: `${id}-r${i}`, message: { id: `${id}-r${i}`, author: { role: "assistant" }, create_time: t + 10, content: { content_type: "text", parts: [reponse] }, metadata: {} } });
  });
  return { id, conversation_id: id, title: titre, create_time: debut, update_time: t + 10, mapping, current_node: parent };
}

// Un .zip minimal (méthode « deflate », ou « stocké » avec `stocke`), comme
// celui de l'export.
export function zipper(entrees) {
  const locaux = [];
  const central = [];
  let position = 0;
  const crc = zlib.crc32 || crc32;
  for (const { nom, contenu, stocke = false } of entrees) {
    const donnees = Buffer.isBuffer(contenu) ? contenu : Buffer.from(contenu);
    const compresse = stocke ? donnees : zlib.deflateRawSync(donnees);
    const methode = stocke ? 0 : 8;
    const nomB = Buffer.from(nom, "utf8");
    const c = crc(donnees) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(methode, 8);
    local.writeUInt32LE(c, 14);
    local.writeUInt32LE(compresse.length, 18);
    local.writeUInt32LE(donnees.length, 22);
    local.writeUInt16LE(nomB.length, 26);
    locaux.push(local, nomB, compresse);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x800, 8);
    cen.writeUInt16LE(methode, 10);
    cen.writeUInt32LE(c, 16);
    cen.writeUInt32LE(compresse.length, 20);
    cen.writeUInt32LE(donnees.length, 24);
    cen.writeUInt16LE(nomB.length, 28);
    cen.writeUInt32LE(position, 42);
    central.push(cen, nomB);
    position += 30 + nomB.length + compresse.length;
  }
  const annuaire = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entrees.length, 8);
  fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(annuaire.length, 12);
  fin.writeUInt32LE(position, 16);
  return Buffer.concat([...locaux, annuaire, fin]);
}

function crc32(buf) {
  let c = ~0;
  for (const o of buf) {
    c ^= o;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

// L'export complet : conversations.json, et une image jointe (ignorée).
export function exportChatGPT(conversations) {
  return zipper([
    { nom: "user.json", contenu: JSON.stringify({ id: "user-fictif" }) },
    { nom: "conversations.json", contenu: JSON.stringify(conversations) },
    { nom: "file-0001-image.png", contenu: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  ]);
}

// --- Un jeu complet, cohérent (tests, démo des parcours) ---------------------------------------

const iso = (ms) => new Date(ms).toISOString();

// `maintenant` : les dates sont posées autour (hier, aujourd'hui).
export function jeuDeDemo({ racine, maintenant = Date.now() }) {
  const hier = maintenant - 24 * 3600_000;
  const claudeDir = path.join(racine, "claude");
  const t3Dir = path.join(racine, "t3");
  const imports = path.join(racine, "imports");
  fs.mkdirSync(imports, { recursive: true });
  const s1 = ecrireSessionClaude(claudeDir, {
    session: "5e551011-0000-4000-8000-000000000001",
    titre: "Fiches produits de la boutique",
    messages: [
      { role: "user", texte: "Aide-moi à réécrire les fiches produits des bougies parfumées, ton chaleureux.", ts: iso(hier) },
      { role: "assistant", texte: "Voici une proposition pour la bougie « Figuier » : notes vertes, 40 heures de combustion.", ts: iso(hier + 60_000) },
      { role: "user", texte: "On garde ce ton. Décision : on publie les nouvelles fiches vendredi.", ts: iso(hier + 120_000) },
      { role: "assistant", texte: "Noté : publication vendredi. Il reste à refaire les photos du coffret.", ts: iso(hier + 180_000) },
    ],
  });
  creerBaseT3(path.join(t3Dir, "userdata", "statev2.sqlite"), {
    projets: [{ id: "proj-site", titre: "Site de la boutique", racine: "C:\\Users\\sam\\code\\site-boutique" }],
    fils: [
      { id: "fil-paiement", projet: "proj-site", titre: "Paiement en trois fois", fournisseur: "codex", cree: iso(maintenant - 3 * 3600_000), maj: iso(maintenant - 2 * 3600_000) },
      { id: "fil-livraison", projet: "proj-site", titre: "Frais de livraison", fournisseur: "claudeAgent", cree: iso(hier + 3600_000), natif: "5e551011-0000-4000-8000-0000000000aa" },
    ],
    messages: [
      { id: "m-1", fil: "fil-paiement", role: "user", texte: "Ajoute le paiement en trois fois au panier, sans frais pour le client.", cree: iso(maintenant - 3 * 3600_000) },
      { id: "m-2", fil: "fil-paiement", role: "assistant", texte: "C'est fait côté panier ; il faut encore activer l'option chez le prestataire de paiement.", cree: iso(maintenant - 2 * 3600_000) },
      { id: "m-3", fil: "fil-livraison", role: "user", texte: "Livraison offerte dès 49 euros, Léa est d'accord.", cree: iso(hier + 3600_000) },
      { id: "m-4", fil: "fil-livraison", role: "assistant", texte: "Seuil de livraison offerte réglé à 49 euros.", cree: iso(hier + 3700_000) },
    ],
  });
  const conversations = [
    conversationChatGPT({
      id: "6f1c0000-aaaa-4000-8000-000000000001",
      titre: "Idées de coffrets de Noël",
      debut: Math.round((hier - 2 * 3600_000) / 1000),
      echanges: [
        ["Trois idées de coffrets de Noël pour une boutique de bougies ?", "1. Coffret « Forêt » 2. Coffret « Épices » 3. Coffret découverte de trois mini-bougies."],
        ["Le coffret découverte me plaît. Prix conseillé ?", "Autour de 29 euros, pour rester sous le seuil de livraison offerte."],
      ],
      regeneree: "Autour de 45 euros.",
    }),
  ];
  const zip = path.join(racine, "export-chatgpt.zip");
  fs.writeFileSync(zip, exportChatGPT(conversations));
  return { claude: claudeDir, t3: t3Dir, imports, zip, sessions: [s1.session] };
}
