// L'export officiel de ChatGPT (29/10) : Réglages › Contrôle des données ›
// Exporter les données → un mail, un lien, un .zip qui contient
// conversations.json. Il n'existe pas d'API de l'historique : c'est la seule
// voie sûre, et elle est à sens unique — Rémy lit le fichier, rien ne repart
// vers OpenAI.
//
// conversations.json est un tableau de conversations ; chacune range ses
// messages dans un ARBRE (`mapping`) : chaque réponse regénérée ou message
// modifié crée une branche. `current_node` désigne la feuille de la branche
// gardée à l'écran : on remonte de là jusqu'à la racine (même logique que
// lib/import.js). Restent le texte de l'utilisateur et de l'assistant ; les
// consignes personnalisées, les messages système, les outils (navigation,
// code, images) et ce qui est caché ne sont pas gardés.

import fs from "node:fs";
import { masquer } from "./masquage.js";
import { entrees, fluxEntree, estZip, ZipInvalide } from "./zip.js";
import { elementsJson } from "./json-flux.js";

const TEXTE_MAX = 12_000;
const COLLE_MIN = 2500;
const MESSAGES_MAX = 2000;

// Le fil gardé à l'écran, de la racine à la feuille.
function fil(mapping, courant) {
  const sortie = [];
  const vus = new Set();
  let id = courant;
  while (id && mapping[id] && !vus.has(id)) {
    vus.add(id);
    sortie.push(mapping[id]);
    id = mapping[id].parent;
  }
  if (sortie.length > 1) return sortie.reverse();
  // Pas de `current_node` exploitable : on descend par le dernier enfant (la
  // dernière version d'une réponse regénérée).
  const racine = Object.values(mapping).find((n) => !n?.parent);
  const suite = [];
  const revus = new Set();
  let n = racine;
  while (n && !revus.has(n.id)) {
    revus.add(n.id);
    suite.push(n);
    const enfants = n.children || [];
    n = mapping[enfants[enfants.length - 1]];
  }
  return suite;
}

function texteDe(contenu) {
  if (!contenu || typeof contenu !== "object") return "";
  const type = contenu.content_type;
  if (type && !["text", "multimodal_text"].includes(type)) return "";
  const parts = Array.isArray(contenu.parts) ? contenu.parts : typeof contenu.text === "string" ? [contenu.text] : [];
  // Les parties non textuelles (images, fichiers) sont des objets : ignorées.
  return parts.filter((p) => typeof p === "string").join("\n").trim();
}

const secondes = (s) => (typeof s === "number" && Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : null);

// Une conversation de l'export → { id, titre, debut, fin, version, messages } ou { raison }.
export function conversationDe(brut) {
  if (!brut || typeof brut !== "object" || !brut.mapping || typeof brut.mapping !== "object") return { raison: "format inconnu" };
  const id = String(brut.conversation_id || brut.id || "").slice(0, 120);
  if (!/^[A-Za-z0-9_.:-]{4,120}$/.test(id)) return { raison: "sans identifiant" };
  const messages = [];
  let masques = 0;
  for (const noeud of fil(brut.mapping, brut.current_node)) {
    const m = noeud?.message;
    if (!m) continue;
    const role = m.author?.role;
    if (role !== "user" && role !== "assistant") continue;
    if (m.metadata?.is_visually_hidden_from_conversation || m.metadata?.is_user_system_message) continue;
    if (m.recipient && m.recipient !== "all") continue; // appel d'outil
    const t = texteDe(m.content);
    if (!t) continue;
    const auteur = role === "assistant" ? "assistant" : t.length >= COLLE_MIN ? "colle" : "utilisateur";
    const { texte, masques: n } = masquer(t.length > TEXTE_MAX ? t.slice(0, TEXTE_MAX) + " […]" : t);
    masques += n;
    messages.push({ uuid: String(m.id || noeud.id || messages.length), ts: secondes(m.create_time), auteur, texte });
  }
  if (!messages.length) return { raison: "aucun message lisible" };
  // Une très longue conversation : on garde la fin (ce qui a été conclu).
  const gardes = messages.length > MESSAGES_MAX ? messages.slice(-MESSAGES_MAX) : messages;
  const debut = secondes(brut.create_time) ?? gardes.find((m) => m.ts)?.ts ?? null;
  const fin = secondes(brut.update_time) ?? [...gardes].reverse().find((m) => m.ts)?.ts ?? debut;
  // Un message sans date prend celle de la conversation.
  for (const m of gardes) if (!m.ts) m.ts = debut;
  return {
    conversation: {
      id,
      titre: String(brut.title || "").trim().slice(0, 200) || "Conversation ChatGPT",
      debut,
      fin,
      version: String(brut.update_time ?? brut.create_time ?? ""),
      messages: gardes,
      masques,
      tronquee: gardes.length < messages.length,
    },
  };
}

const NOM_CONVERSATIONS = /(^|\/)conversations(-\d+)?\.json$/i;

// Les conversations brutes d'un fichier (.zip de l'export, ou
// conversations.json seul), une par une.
export async function* conversationsDuFichier(fichier) {
  if (estZip(fichier)) {
    let liste;
    try {
      liste = entrees(fichier).filter((e) => NOM_CONVERSATIONS.test(e.nom) && !e.nom.startsWith("__MACOSX/"));
    } catch (err) {
      if (err instanceof ZipInvalide) throw err;
      throw new ZipInvalide(err.message);
    }
    if (!liste.length) throw Object.assign(new Error("Pas de conversations.json dans cette archive : est-ce bien l'export de ChatGPT ?"), { code: "SANS_CONVERSATIONS" });
    for (const e of liste) yield* elementsJson(fluxEntree(fichier, e));
    return;
  }
  yield* elementsJson(fs.createReadStream(fichier, { highWaterMark: 1 << 20 }));
}
