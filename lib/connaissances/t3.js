// Lecture STRICTEMENT SEULE des fils de T3 Code (29/10).
//
// T3 Code (et son fork) range tout dans une base SQLite : <base>/userdata/
// statev2.sqlite (V2, depuis la version 0.1.0), <base>/dev/statev2.sqlite
// (lancé depuis les sources) et, avant la V2, <base>/userdata/state.sqlite.
// <base> : REMY_T3_DIRS (des dossiers séparés par « ; », pour un fork rangé
// ailleurs ; un dossier peut aussi être directement celui de la base),
// T3CODE_HOME, puis %USERPROFILE%\.t3 — le défaut de l'app de bureau et du
// serveur. Les fils menés depuis le téléphone (T3 mobile) passent par le même
// serveur : ils sont dans la même base.
//
// Ce qui est lu, et rien d'autre :
//   - les projets (titre, dossier) ;
//   - les fils (titre, dates ; supprimés et sous-agents écartés) ;
//   - leurs messages terminés, de toi ou de l'assistant (ni notification
//     produite par T3, ni script de workflow, ni outil) ;
//   - l'identifiant de session Claude d'un fil mené avec Claude : la même
//     conversation dans ~/.claude n'est alors montrée qu'une fois, ici.
//
// Jamais rien d'écrit chez T3 : si T3 tourne (fichiers -wal et -shm présents),
// la base est ouverte en LECTURE SEULE, en lecteur ordinaire de SQLite ; si T3
// est fermé, en « immutable » — aucun fichier n'est créé à côté de sa base.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { masquer } from "./masquage.js";
import { listeChemins } from "./claudeCode.js";

const require = createRequire(import.meta.url);
const TEXTE_MAX = 12_000;
const COLLE_MIN = 2500;
const PAGE = 1000;

export function racinesCandidates() {
  const r = [];
  for (const c of listeChemins(process.env.REMY_T3_DIRS)) r.push({ chemin: c, origine: "REMY_T3_DIRS" });
  if (process.env.T3CODE_HOME?.trim()) r.push({ chemin: process.env.T3CODE_HOME.trim(), origine: "T3CODE_HOME" });
  r.push({ chemin: path.join(os.homedir(), ".t3"), origine: "dossier de l'utilisateur" });
  const vus = new Set();
  return r
    .map((x) => ({ ...x, chemin: path.resolve(x.chemin) }))
    .filter((x) => (vus.has(x.chemin) ? false : vus.add(x.chemin)));
}

// Les bases de T3 trouvées. Une base V2 l'emporte sur l'ancienne de la même
// racine (la V2 a repris son contenu).
export function bases() {
  const sortie = [];
  const vues = new Set();
  const ajouter = (fichier, version) => {
    const f = path.resolve(fichier);
    if (vues.has(f) || !estFichier(f)) return false;
    vues.add(f);
    sortie.push({ fichier: f, version });
    return true;
  };
  for (const { chemin } of racinesCandidates()) {
    if (/\.sqlite$/i.test(chemin)) {
      ajouter(chemin, /statev2/i.test(chemin) ? 2 : 1);
      continue;
    }
    let v2 = false;
    for (const sous of ["userdata", "dev", "."]) v2 = ajouter(path.join(chemin, sous, "statev2.sqlite"), 2) || v2;
    if (!v2) for (const sous of ["userdata", "."]) ajouter(path.join(chemin, sous, "state.sqlite"), 1);
  }
  return sortie;
}

function estFichier(f) {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
}

// T3 tourne : -wal ou -shm à côté de la base.
export const t3Ouvert = (fichier) => fs.existsSync(`${fichier}-wal`) || fs.existsSync(`${fichier}-shm`);

export class LectureT3Impossible extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Ouvre la base de T3 sans jamais y écrire.
export function ouvrir(fichier) {
  const { DatabaseSync } = require("node:sqlite");
  if (t3Ouvert(fichier)) {
    // Lecteur ordinaire en lecture seule : il voit ce que T3 a validé, sans
    // rien écrire dans la base ni dans son journal.
    const b = new DatabaseSync(fichier, { readOnly: true });
    b.exec("PRAGMA busy_timeout = 3000; PRAGMA query_only = ON;");
    return b;
  }
  // T3 fermé : « immutable », SQLite n'ouvre ni ne crée aucun autre fichier.
  const u = pathToFileURL(fichier);
  u.searchParams.set("immutable", "1");
  try {
    const b = new DatabaseSync(u, { readOnly: true });
    b.exec("PRAGMA query_only = ON;");
    return b;
  } catch (err) {
    if (err instanceof TypeError || /path|url/i.test(String(err.message))) {
      throw new LectureT3Impossible("node-ancien", "Node est trop ancien pour lire T3 Code sans rien toucher (il faut Node 22.15 ou plus) : mets Node à jour sur la tour.");
    }
    throw err;
  }
}

const ms = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

// « claudeAgent » → « Claude », « codex » → « Codex ».
export function nomAssistant(fournisseur) {
  const f = String(fournisseur || "").toLowerCase();
  if (f.includes("claude")) return "Claude";
  if (f.includes("codex") || f.includes("openai")) return "Codex";
  if (f.includes("gemini") || f.includes("antigravity")) return "Gemini";
  if (f.includes("cursor")) return "Cursor";
  if (f.includes("opencode")) return "OpenCode";
  return f ? f.charAt(0).toUpperCase() + f.slice(1, 24) : "Assistant";
}

function tables(b) {
  return new Set(b.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all().map((r) => r.name));
}

function colonnes(b, table) {
  return new Set(b.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((r) => r.name));
}

// Un message de T3 → un message de Rémy (masqué), ou null.
export function messageDe({ id, role, texte, cree, par, script }) {
  if (role !== "user" && role !== "assistant") return null;
  if (script === 1 || script === true || script === "true") return null;
  if (role === "user" && par && par !== "user") return null; // notification produite par T3
  const brut = String(texte || "");
  if (!brut.trim()) return null;
  const auteur = role === "assistant" ? "assistant" : brut.length >= COLLE_MIN ? "colle" : "utilisateur";
  const { texte: propre, masques } = masquer(brut.length > TEXTE_MAX ? brut.slice(0, TEXTE_MAX) + " […]" : brut);
  return { uuid: String(id), ts: ms(cree), auteur, texte: propre, masques };
}

// Lit une base de T3 à partir d'un curseur { maj, id } (le dernier message vu,
// par date de mise à jour). Rend les fils (tous, ils sont peu nombreux), les
// projets, les messages nouveaux ou modifiés et les liens vers Claude Code.
export async function lireBase(fichier, curseur = null, { cede = () => new Promise((r) => setImmediate(r)) } = {}) {
  const b = ouvrir(fichier);
  try {
    const t = tables(b);
    const v2 = t.has("orchestration_v2_projection_threads") && t.has("orchestration_v2_projection_messages");
    const v1 = !v2 && t.has("projection_threads") && t.has("projection_thread_messages");
    if (!v2 && !v1) throw new LectureT3Impossible("schema-inconnu", "La base de T3 Code n'a pas la forme attendue (version trop ancienne ou trop récente) : rien n'a été lu.");

    const projets = new Map();
    if (t.has("projection_projects")) {
      const cp = colonnes(b, "projection_projects");
      for (const p of b.prepare(`SELECT project_id, title, workspace_root${cp.has("deleted_at") ? ", deleted_at" : ", NULL AS deleted_at"} FROM projection_projects`).all()) {
        projets.set(p.project_id, { titre: p.title || "", racine: p.workspace_root || "", supprime: Boolean(p.deleted_at) });
      }
    }

    const fils = new Map();
    if (v2) {
      for (const f of b
        .prepare(
          `SELECT thread_id, project_id, title, default_provider, created_at, updated_at, deleted_at,
                  json_extract(payload_json, '$.lineage.relationshipToParent') AS lien
             FROM orchestration_v2_projection_threads`,
        )
        .all()) {
        fils.set(f.thread_id, {
          id: f.thread_id,
          projet: f.project_id,
          titre: f.title || "",
          assistant: nomAssistant(f.default_provider),
          debut: ms(f.created_at),
          fin: ms(f.updated_at),
          supprime: Boolean(f.deleted_at),
          sousAgent: f.lien === "subagent",
        });
      }
    } else {
      const ct = colonnes(b, "projection_threads");
      for (const f of b.prepare(`SELECT thread_id, project_id, title, ${ct.has("model") ? "model" : "NULL AS model"}, created_at, updated_at, deleted_at FROM projection_threads`).all()) {
        fils.set(f.thread_id, {
          id: f.thread_id,
          projet: f.project_id,
          titre: f.title || "",
          assistant: nomAssistant(/claude/i.test(f.model || "") ? "claude" : "codex"),
          debut: ms(f.created_at),
          fin: ms(f.updated_at),
          supprime: Boolean(f.deleted_at),
          sousAgent: false,
        });
      }
    }

    // Les sessions Claude menées par T3 : leur identifiant natif.
    const liens = [];
    for (const nom of ["orchestration_v2_projection_provider_threads", "provider_threads"]) {
      if (!t.has(nom)) continue;
      const c = colonnes(b, nom);
      if (!c.has("payload_json") || !c.has("thread_id")) continue;
      const pilote = c.has("driver") ? (c.has("provider") ? "COALESCE(driver, provider)" : "driver") : c.has("provider") ? "provider" : "NULL";
      for (const l of b.prepare(`SELECT thread_id, ${pilote} AS pilote, json_extract(payload_json, '$.nativeThreadRef.nativeId') AS natif FROM ${nom}`).all()) {
        if (l.natif && l.thread_id && /claude/i.test(l.pilote || "")) liens.push({ natif: String(l.natif).toLowerCase(), conversation: l.thread_id });
      }
    }

    // Les messages, par pages, depuis le curseur.
    const messages = [];
    let maj = curseur?.maj || "";
    let dernierId = curseur?.id || "";
    const requete = v2
      ? b.prepare(
          `SELECT message_id AS id, thread_id AS fil, role, created_at AS cree, updated_at AS maj,
                  json_extract(payload_json, '$.text') AS texte,
                  json_extract(payload_json, '$.createdBy') AS par,
                  json_extract(payload_json, '$.workflowScript') AS script
             FROM orchestration_v2_projection_messages
            WHERE streaming = 0 AND (updated_at, message_id) > (?, ?)
            ORDER BY updated_at, message_id LIMIT ${PAGE}`,
        )
      : b.prepare(
          `SELECT message_id AS id, thread_id AS fil, role, created_at AS cree, updated_at AS maj, text AS texte, NULL AS par, NULL AS script
             FROM projection_thread_messages
            WHERE is_streaming = 0 AND (updated_at, message_id) > (?, ?)
            ORDER BY updated_at, message_id LIMIT ${PAGE}`,
        );
    let compte = 0;
    let masques = 0;
    for (;;) {
      const lot = requete.all(maj, dernierId);
      for (const r of lot) {
        compte++;
        maj = r.maj;
        dernierId = r.id;
        const fil = fils.get(r.fil);
        if (!fil || fil.sousAgent) continue;
        const m = messageDe(r);
        if (!m) continue;
        masques += m.masques;
        messages.push({ ...m, conversation: r.fil });
      }
      if (lot.length < PAGE) break;
      await cede();
    }
    return { version: v2 ? 2 : 1, fils, projets, liens, messages, compte, masques, curseur: { maj, id: dernierId } };
  } finally {
    try {
      b.close();
    } catch {}
  }
}
