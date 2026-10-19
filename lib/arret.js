// Interrompre une réponse en cours (« Interrompre et envoyer », bouton stop).
//
// Un registre par conversation : la génération en cours y dépose son
// AbortController, et POST /api/conversations/:id/stop s'en sert. Le signal
// descend jusqu'au fournisseur (SDK Anthropic, fetch GLM, process du CLI) :
// arrêter coupe vraiment le calcul, pas seulement l'affichage.
//
// L'arrêt ATTEND que la réponse partielle soit enregistrée avant de rendre la
// main. Sans ça, le message suivant de Sam (« Interrompre et envoyer ») serait
// ajouté à la conversation pendant que le flux interrompu écrit la sienne — et
// l'écriture du flux, qui part de sa propre copie, effacerait ce message.
//
// En mémoire du processus : la tour n'a qu'un serveur. Sur Vercel, l'arrêt ne
// verrait que les réponses de la même instance (il répond alors « rien en cours »).

import { PRENOM } from "./profil.js";

const enCours = new Map(); // convId → { controleur, fini, terminer }

// Une génération démarre. Rend le signal à transmettre au fournisseur et
// `liberer()`, à appeler quand TOUTES les écritures de la conversation sont faites.
export function demarrerGeneration(convId) {
  const controleur = new AbortController();
  let terminer;
  const fini = new Promise((r) => (terminer = r));
  const entree = { controleur, fini, terminer };
  enCours.set(convId, entree);
  return {
    signal: controleur.signal,
    liberer() {
      terminer();
      if (enCours.get(convId) === entree) enCours.delete(convId);
    },
  };
}

export function generationEnCours(convId) {
  return enCours.has(convId);
}

const attendre = (promesse, ms) =>
  Promise.race([promesse.then(() => true), new Promise((r) => setTimeout(() => r(false), ms).unref?.())]);

// Interrompt la génération de CETTE conversation. Rend `false` s'il n'y avait
// rien à arrêter (réponse déjà finie : ce n'est pas une erreur), `true` une
// fois la réponse partielle enregistrée (ou le délai écoulé).
export async function arreterGeneration(convId, { delaiMs = 15_000 } = {}) {
  const e = enCours.get(convId);
  if (!e) return false;
  if (!e.controleur.signal.aborted) e.controleur.abort(new Error(`Interrompu par ${PRENOM}`));
  await attendre(e.fini, delaiMs);
  return true;
}

// Un nouveau message arrive pendant qu'une réponse s'écrit encore (deux
// appareils, ou un client qui n'a pas attendu) : on laisse la précédente finir
// d'enregistrer, sinon elle écraserait ce message. `true` : la voie est libre.
export async function attendreFin(convId, delaiMs = 4_000) {
  const e = enCours.get(convId);
  if (!e) return true;
  return attendre(e.fini, delaiMs);
}

// Ce que le flux renvoie quand le fournisseur a été coupé : la réponse
// partielle, déjà transmise morceau par morceau, est reprise par streamReply.
export const siArrete = (signal, model) => (err) => {
  if (signal?.aborted) return { text: "", stopReason: "interrompu", usage: null, model };
  throw err;
};

// La mention discrète, visible par Sam ET relue par le modèle au tour
// suivant (il sait que sa réponse a été coupée, pas qu'il avait fini).
// (Italique en « * » : c'est la seule forme que rendent le site et l'app.)
export const MENTION_INTERROMPU = "*(interrompu)*";
// Coupée par le temps imparti (lib/glm.js), pas par Sam.
export const MENTION_COUPEE = "*(coupée : réponse trop longue)*";
export function avecMention(texte, mention = MENTION_INTERROMPU) {
  const t = String(texte || "").trimEnd();
  return t ? `${t}\n\n${mention}` : mention;
}
