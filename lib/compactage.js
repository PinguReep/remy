// Compacter une longue conversation (Sam, 19/10) : quand elle prend trop de
// place dans le contexte du modèle, son début est résumé par GLM — en local,
// jamais chez Claude — et Rémy relit ce résumé puis les derniers messages en
// entier. Rien n'est effacé : tous les messages restent dans le fil, sur la
// tour, et Sam peut lire le résumé.
//
// Automatique après une réponse qui a rempli 70 % du contexte (circuit
// « compactage », coupable dans les Réglages) ; à la demande depuis la jauge.

import crypto from "node:crypto";
import { getConversation, putConversation } from "./store.js";
import { glmProvider, glmConfigured, libelleLocal } from "./providers.js";
import { logCost, contenuPourModele } from "./chat.js";
import { PRENOM } from "./profil.js";

// Les derniers messages, gardés en entier (trois échanges).
export const GARDER = 6;
export const SEUIL = 0.7; // part du contexte au-delà de laquelle on compacte
const SEUIL_SANS_TAILLE = 90_000; // jetons, quand le modèle ne dit pas sa taille
const MORCEAU = 48_000; // caractères relus par appel au résumé
const MESSAGE_MAX = 16_000; // un message démesuré est relu en partie
const RESUME_MAX = 8_000;

const CONSIGNE = `Tu résumes le début d'une conversation entre ${PRENOM} et Rémy, son assistant, pour que Rémy puisse la poursuivre sans la relire.
Garde : ce que ${PRENOM} a dit de lui, de ses projets et de ses contraintes ; les décisions prises ; les demandes en cours et ce qui reste à faire ; les propositions de Rémy et leur statut (validée, refusée, en attente) ; les chiffres, dates, lieux et noms.
N'invente rien, ne commente pas, ne t'adresse pas à ${PRENOM}. Des listes courtes sous quelques titres. 700 mots au plus.`;

// Faut-il compacter après cette réponse ? `mesures` : celles de la réponse.
export function aCompacter(conv, mesures) {
  const c = mesures?.contexte;
  if (!c) return false;
  const seuil = mesures.fenetre ? SEUIL * mesures.fenetre : SEUIL_SANS_TAILLE;
  return c >= seuil && limite(conv) > (conv.compactage?.jusqua || 0);
}

// Où s'arrête le résumé : avant les GARDER derniers messages, juste avant un
// message de Sam (le modèle relit ensuite un échange entier).
function limite(conv, garder = GARDER) {
  const debut = conv.compactage?.jusqua || 0;
  let j = conv.messages.length - garder;
  while (j > debut && conv.messages[j]?.role !== "user") j--;
  return j;
}

function* morceaux(messages) {
  let lot = [];
  let taille = 0;
  for (const m of messages) {
    const texte = String(contenuPourModele(m) || "");
    const ligne = `${m.role === "user" ? PRENOM : "Rémy"} : ${texte.length > MESSAGE_MAX ? texte.slice(0, MESSAGE_MAX) + " […]" : texte}`;
    if (lot.length && taille + ligne.length > MORCEAU) {
      yield lot;
      lot = [];
      taille = 0;
    }
    lot.push(ligne);
    taille += ligne.length;
  }
  if (lot.length) yield lot;
}

// Ce que l'app voit d'un compactage (le résumé aussi : c'est la conversation de Sam).
export const vuePublique = (c) =>
  c ? { jusqua: c.jusqua, a: c.a, resume: c.resume, modele: c.modele, caracteres: String(c.resume || "").length } : null;

const enCours = new Map(); // convId → promesse (une seule à la fois par fil)

export function compacter(convId, options = {}) {
  if (enCours.has(convId)) return enCours.get(convId);
  const p = compacterVraiment(convId, options).finally(() => enCours.delete(convId));
  enCours.set(convId, p);
  return p;
}

async function compacterVraiment(convId, { reqId = crypto.randomUUID(), garder = GARDER } = {}) {
  if (!glmConfigured()) {
    throw new Error("Compactage impossible : le modèle local n'est pas branché (rien n'est envoyé chez Claude).");
  }
  const conv = await getConversation(convId);
  if (!conv) throw Object.assign(new Error("Conversation introuvable."), { status: 404 });
  const avant = conv.compactage || null;
  const debut = avant?.jusqua || 0;
  const jusqua = limite(conv, garder);
  if (jusqua <= debut) return { compacte: false, raison: "rien-a-resumer", compactage: vuePublique(avant) };

  const aResumer = conv.messages.slice(debut, jusqua).filter((m) => !m.autorisation && String(m.content || "").trim());
  let resume = avant?.resume || "";
  for (const lot of morceaux(aResumer)) {
    const prompt =
      (resume ? `# Résumé déjà fait (à compléter, sans le répéter mot pour mot)\n\n${resume}\n\n` : "") +
      `# Suite de la conversation\n\n${lot.join("\n\n")}\n\nRends le résumé complet, mis à jour.`;
    const r = await glmProvider.complete({ system: CONSIGNE, prompt, maxTokens: 3000, reflexion: false, delaiMs: 240_000 });
    await logCost("compaction", "glm", r.model, r.usage, reqId, String(conv.title || "conversation").slice(0, 70));
    const t = String(r.text || "").trim();
    if (!t) throw new Error("Le modèle local n'a rien rendu : conversation non compactée.");
    resume = t.slice(0, RESUME_MAX);
  }
  const compactage = { jusqua, resume, a: Date.now(), modele: libelleLocal() };
  // Relue au moment d'écrire : une réponse a pu s'ajouter pendant le résumé.
  const frais = await getConversation(convId);
  if (!frais) throw Object.assign(new Error("Conversation introuvable."), { status: 404 });
  if ((frais.compactage?.jusqua || 0) >= jusqua) return { compacte: false, raison: "deja-fait", compactage: vuePublique(frais.compactage) };
  frais.compactage = compactage;
  await putConversation(frais);
  console.warn(`Compactage : ${jusqua - debut} message(s) résumé(s) en ${resume.length} caractères`);
  return { compacte: true, resumes: jusqua - debut, compactage: vuePublique(compactage) };
}

// Ce que le modèle relit : le résumé (dans la consigne), puis la suite.
export function historiqueCompacte(conv, messages) {
  const c = conv.compactage;
  if (!c?.resume || !(c.jusqua > 0) || c.jusqua > messages.length) return { resume: null, messages };
  return { resume: c.resume, messages: messages.slice(c.jusqua) };
}

export const noteResume = (resume) =>
  `# Plus tôt dans cette conversation (résumé)\n\nLe début de cette conversation a été résumé pour tenir dans ta mémoire de travail ; ${PRENOM} voit toujours tous les messages. Appuie-toi dessus comme sur ce qui a été dit.\n\n${resume}`;
