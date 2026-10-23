// Le coffre Obsidian de Rémy (REMY_VAULT, ex. C:\Users\Utilisateur\Documents\Rémy).
//
// Sam ouvre ce dossier dans Obsidian et lit tout ce que Rémy sait :
//   Mémoire de Rémy.md        — LA mémoire. Source de vérité, dans les deux sens :
//                               Sam la corrige dans Obsidian, Rémy relit le
//                               fichier avant chaque réponse.
//   Conversations/…md         — copie lisible de chaque conversation (réécrite à
//                               chaque message : la modifier ici ne change rien).
//   Réflexions/AAAA-MM-JJ.md  — les réflexions de la nuit.
//   Captures/…md              — ce que Sam a capturé depuis l'iPhone.
//   .remy/                    — la base de l'app (JSON). Obsidian ignore les
//                               dossiers en point : rien à y toucher.
//
// Tout reste sur la tour. Une copie qui échoue ne casse jamais l'app : elle est
// signalée dans le journal et refaite au prochain enregistrement.

import fs from "node:fs";
import path from "node:path";
import { PRENOM } from "./profil.js";

export const coffre = () => process.env.REMY_VAULT || null;
export const dossierDonnees = () => (coffre() ? path.join(coffre(), ".remy") : null);

const MEMOIRE = "Mémoire de Rémy.md";

// Écriture atomique : un fichier à moitié écrit (tour coupée en pleine
// écriture) ne doit jamais remplacer le bon. Le contenu est forcé sur le
// disque (fsync) AVANT le renommage : sans ça, une coupure de courant juste
// après pouvait laisser un fichier vide à la place de l'ancien.
export function ecrireAtomique(fichier, contenu) {
  const dossier = path.dirname(fichier);
  fs.mkdirSync(dossier, { recursive: true });
  const tmp = `${fichier}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, contenu);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, fichier);
  // Le renommage lui-même, sur les systèmes qui le permettent (pas Windows).
  if (process.platform !== "win32") {
    try {
      const d = fs.openSync(dossier, "r");
      try {
        fs.fsyncSync(d);
      } finally {
        fs.closeSync(d);
      }
    } catch {}
  }
}

function nomDeFichier(s, max = 80) {
  const propre = String(s || "Sans titre")
    .replace(/[\\/:*?"<>|#^[\]\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return (propre || "Sans titre").slice(0, max);
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : "");
const jourDe = (ms) => new Date(ms || Date.now()).toLocaleDateString("sv-SE", { timeZone: process.env.REMY_TZ || "Europe/Paris" });

function frontmatter(champs) {
  const lignes = Object.entries(champs)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    // Une liste reste une liste YAML (Obsidian lit alors les tags) ; un texte est cité.
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : typeof v === "string" ? JSON.stringify(v) : v}`);
  return `---\n${lignes.join("\n")}\n---\n\n`;
}

function sansFrontmatter(texte) {
  return String(texte || "").replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").replace(/^\s*\n/, "");
}

const garde = (quoi, fn) => {
  try {
    return fn();
  } catch (err) {
    console.warn(`Coffre Obsidian — ${quoi} :`, err.message);
    return undefined;
  }
};

// --- Mémoire : source de vérité ------------------------------------------------

// null : pas de coffre, ou pas encore de fichier (on retombe sur la base).
export function lireMemoire() {
  if (!coffre()) return null;
  const f = path.join(coffre(), MEMOIRE);
  try {
    const brut = fs.readFileSync(f, "utf8");
    return { text: sansFrontmatter(brut).replace(/^# Mémoire de Rémy\s*\n+/, "").trim(), updatedAt: fs.statSync(f).mtimeMs };
  } catch (err) {
    if (err.code !== "ENOENT") console.warn("Coffre Obsidian — mémoire illisible :", err.message);
    return null;
  }
}

export function ecrireMemoire(texte) {
  if (!coffre()) return false;
  ecrireAtomique(
    path.join(coffre(), MEMOIRE),
    frontmatter({ maj: iso(Date.now()), note: "Tu peux corriger ce texte : Rémy le relit avant chaque réponse." }) +
      `# Mémoire de Rémy\n\n${String(texte || "").trim()}\n`,
  );
  return true;
}

// --- Copies lisibles -----------------------------------------------------------

function trouverParId(dossier, id8) {
  try {
    return fs.readdirSync(dossier).filter((f) => f.endsWith(` (${id8}).md`));
  } catch {
    return [];
  }
}

export function copierConversation(conv) {
  if (!coffre() || !conv?.id) return;
  garde("conversation", () => {
    const dossier = path.join(coffre(), "Conversations");
    const id8 = conv.id.slice(0, 8);
    const nom = `${nomDeFichier(conv.title)} (${id8}).md`;
    // Renommée : l'ancienne copie part, sinon Obsidian en garde deux.
    for (const ancien of trouverParId(dossier, id8)) if (ancien !== nom) fs.rmSync(path.join(dossier, ancien), { force: true });
    const qui = (m) => (m.role === "user" ? PRENOM : conv.origine?.source === "chatgpt" ? "ChatGPT" : conv.origine?.source === "claude" ? "Claude" : "Rémy");
    const corps = (conv.messages || [])
      .map((m) => {
        const puce = m.role === "assistant" && m.model ? ` · ${m.model}` : "";
        const prop = m.proposal?.actions?.length
          ? `\n\n> Proposition ${m.proposal.source === "agenda" ? "agenda" : "Motion"} (${m.proposal.statut || "en attente"}${m.proposal.annulee ? ", annulée" : ""}) : ${m.proposal.resume || ""}`
          : "";
        return `**${qui(m)}**${puce}\n\n${String(m.content || "").trim()}${prop}`;
      })
      .join("\n\n---\n\n");
    ecrireAtomique(
      path.join(dossier, nom),
      frontmatter({
        id: conv.id,
        creee: iso(conv.createdAt),
        maj: iso(conv.updatedAt),
        privee: conv.prive ? true : undefined,
        epinglee: conv.pinned ? true : undefined,
        tags: conv.prive ? ["rémy", "privée"] : ["rémy"],
      }) + `# ${conv.title || "Conversation"}\n\n${corps}\n`,
    );
  });
}

export function retirerConversation(id) {
  if (!coffre() || !id) return;
  garde("suppression", () => {
    const dossier = path.join(coffre(), "Conversations");
    for (const f of trouverParId(dossier, String(id).slice(0, 8))) fs.rmSync(path.join(dossier, f), { force: true });
  });
}

export function copierReflexion(b) {
  if (!coffre() || !b?.text) return;
  garde("réflexion", () =>
    ecrireAtomique(
      path.join(coffre(), "Réflexions", `${jourDe(b.generatedAt)}.md`),
      frontmatter({ generee: iso(b.generatedAt), tags: ["rémy", "réflexion"] }) + `# Réflexion du ${jourDe(b.generatedAt)}\n\n${b.text.trim()}\n`,
    ),
  );
}

export function copierCapture(c) {
  if (!coffre() || !c) return;
  garde("capture", () => {
    const quand = c.at || Date.now();
    const texte = String(c.extrait || c.texte || "");
    const ajouts = (c.ajouts || []).map((a) => `- ${typeof a === "string" ? a : a?.texte || JSON.stringify(a)}`).join("\n");
    ecrireAtomique(
      path.join(coffre(), "Captures", `${jourDe(quand)} ${nomDeFichier(c.titre || texte.slice(0, 40), 60)}.md`),
      frontmatter({ capturee: iso(quand), source: c.source || "note", tags: ["rémy", "capture"] }) +
        `# ${c.titre || "Capture"}\n\n` +
        // Une image partagée s'affiche dans la note (chemin relatif au coffre).
        (c.image && String(c.image).startsWith("Captures/") ? `![[${c.image}]]\n\n` : "") +
        `${texte.trim()}${c.complet ? "\n\n*(extrait)*" : ""}\n` +
        (ajouts ? `\n## Ce que Rémy en a retenu\n\n${ajouts}\n` : ""),
    );
  });
}

// Le mode d'emploi, posé une fois à la racine du coffre.
export function preparerCoffre() {
  if (!coffre()) return;
  garde("préparation", () => {
    const f = path.join(coffre(), "À lire.md");
    if (fs.existsSync(f)) return;
    ecrireAtomique(
      f,
      "# Le coffre de Rémy\n\n" +
        "Tout ce que Rémy sait de toi, sur ta tour, rien ailleurs.\n\n" +
        "- **[[Mémoire de Rémy]]** — ce qu'il a retenu. **Tu peux la corriger** : il relit ce fichier avant chaque réponse.\n" +
        "- **Conversations/** — une copie lisible de chaque conversation. La modifier ici ne change rien dans l'app.\n" +
        "- **Réflexions/** — ses réflexions de la nuit.\n" +
        "- **Captures/** — ce que tu as capturé depuis l'iPhone.\n\n" +
        "Le dossier caché `.remy/` est la base de l'app : n'y touche pas.\n",
    );
  });
}
