// Importer les conversations que Sam a eues ailleurs (ChatGPT, Claude).
//
// Pourquoi côté serveur : les deux exports ont des formes différentes et
// piégeuses — ChatGPT range ses messages dans un ARBRE (avec les branches des
// réponses regénérées), Claude dans une liste plate. Se tromper de branche, ou
// oublier de trier, donne une conversation qui n'a jamais existé. Cette logique
// mérite d'être testée, pas dupliquée dans une page HTML.
//
// Le navigateur ne fait que : lire le fichier, montrer la liste, laisser Sam
// cocher, et envoyer les objets bruts choisis. Rien n'est envoyé sans son geste.

const MAX_MSGS = 400;
const MAX_CHARS_MSG = 20_000;
const MAX_CHARS_CONV = 400_000;

const ROLES = { user: "user", human: "user", assistant: "assistant" };

export function detecterFormat(brut) {
  if (!brut || typeof brut !== "object") return null;
  if (brut.mapping && typeof brut.mapping === "object") return "chatgpt";
  if (Array.isArray(brut.chat_messages)) return "claude";
  return null;
}

function texte(v) {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(texte).filter(Boolean).join("\n");
  if (v && typeof v === "object") return typeof v.text === "string" ? v.text : "";
  return "";
}

// L'export ChatGPT est un arbre : chaque réponse regénérée crée une branche.
// `current_node` désigne la feuille de la branche que Sam a réellement gardée
// à l'écran — on remonte de là jusqu'à la racine, puis on remet à l'endroit.
// Sans ça, on ressort des réponses qu'il a jetées.
function filChatgpt(mapping, courant) {
  const fil = [];
  const vus = new Set();
  let id = courant;
  while (id && mapping[id] && !vus.has(id)) {
    vus.add(id);
    fil.push(mapping[id]);
    id = mapping[id].parent;
  }
  if (fil.length > 1) return fil.reverse();
  // Pas de `current_node` exploitable : on descend en suivant le premier enfant.
  const racine = Object.values(mapping).find((n) => !n.parent);
  const suite = [];
  let n = racine;
  const revus = new Set();
  while (n && !revus.has(n.id)) {
    revus.add(n.id);
    suite.push(n);
    n = mapping[(n.children || [])[0]];
  }
  return suite;
}

function messagesChatgpt(brut) {
  return filChatgpt(brut.mapping || {}, brut.current_node)
    .map((n) => n?.message)
    .filter(Boolean)
    .filter((m) => !m.metadata?.is_visually_hidden_from_conversation)
    .map((m) => ({
      role: ROLES[m.author?.role],
      // Les parties non textuelles (images, appels d'outils) donnent une chaîne
      // vide et disparaissent au filtre suivant : mieux vaut un message manquant
      // qu'un « [object Object] » dans la mémoire de Rémy.
      content: texte(m.content?.parts ?? m.content?.text ?? "").trim(),
      at: m.create_time ? Math.round(m.create_time * 1000) : null,
    }));
}

function messagesClaude(brut) {
  return [...brut.chat_messages]
    .sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0))
    .map((m) => ({
      role: ROLES[m.sender] || ROLES[m.role],
      content: (m.text && m.text.trim()) || texte(m.content).trim(),
      at: Date.parse(m.created_at) || null,
    }));
}

function dateDe(brut, format, messages) {
  const brute =
    format === "chatgpt"
      ? (brut.create_time || 0) * 1000
      // `Date.parse(0)` rend le 1er janvier 2000 — un repli qui a l'air d'une
      // vraie date est pire que pas de date du tout.
      : Date.parse(brut.created_at) || 0;
  if (brute > 0) return Math.round(brute);
  // Pas de date exploitable : celle du premier message vaut mieux que « maintenant »,
  // qui ferait passer une conversation de 2023 pour celle d'aujourd'hui.
  return messages.find((m) => m.at)?.at || null;
}

// Une clé stable, pour qu'un deuxième import du même export ne crée pas de
// doublons. L'identifiant d'origine s'il existe, sinon le titre et la date.
export function cleDe(brut, format, titre, creeA) {
  const id = brut.conversation_id || brut.id || brut.uuid;
  return `${format}:${id || `${titre}|${creeA || ""}`}`.slice(0, 200);
}

// Rend { conv } si la conversation est exploitable, { raison } sinon.
export function normaliser(brut) {
  const format = detecterFormat(brut);
  if (!format) return { raison: "format inconnu" };

  let messages = format === "chatgpt" ? messagesChatgpt(brut) : messagesClaude(brut);
  messages = messages.filter((m) => m.role && m.content);
  if (!messages.length) return { raison: "aucun message lisible" };

  const coupee = messages.length > MAX_MSGS;
  // On garde la FIN : dans une longue conversation, ce qui a été conclu compte
  // plus que les tâtonnements du début.
  if (coupee) messages = messages.slice(-MAX_MSGS);

  let total = 0;
  const propres = [];
  for (const m of messages) {
    const c = m.content.length > MAX_CHARS_MSG ? m.content.slice(0, MAX_CHARS_MSG) + " […]" : m.content;
    if (total + c.length > MAX_CHARS_CONV) break;
    total += c.length;
    propres.push({ role: m.role, content: c });
  }
  if (!propres.length) return { raison: "conversation trop volumineuse" };

  const titre = String(brut.title || brut.name || "").trim().slice(0, 200) || "Conversation importée";
  const creeA = dateDe(brut, format, messages);
  return {
    conv: {
      titre,
      creeA,
      messages: propres,
      tronquee: coupee || propres.length < messages.length,
      origine: { source: format, at: creeA, cle: cleDe(brut, format, titre, creeA) },
    },
  };
}

// Un lot entier. Ce qui ne passe pas ressort nommé : un import qui avale
// silencieusement la moitié des conversations est pire qu'un import qui échoue.
export function normaliserLot(liste, { dejaVues = new Set() } = {}) {
  const ok = [];
  const ignorees = [];
  const vues = new Set(dejaVues);
  for (const brut of Array.isArray(liste) ? liste : []) {
    const { conv, raison } = normaliser(brut);
    if (!conv) {
      ignorees.push({ titre: String(brut?.title || brut?.name || "sans titre").slice(0, 80), raison });
      continue;
    }
    if (vues.has(conv.origine.cle)) {
      ignorees.push({ titre: conv.titre, raison: "déjà importée" });
      continue;
    }
    vues.add(conv.origine.cle);
    ok.push(conv);
  }
  return { ok, ignorees };
}
