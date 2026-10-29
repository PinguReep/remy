// Les appels à la tour : un délai, une erreur lisible pour chaque cas (tour
// injoignable, session perdue, tour à mettre à jour, réponse non JSON, refus
// expliqué par la tour), et un lecteur de flux SSE pour les réponses de Rémy.
// Aucune donnée n'est gardée ici : /api n'est jamais mis en cache (sw.js).

export const evenements = new EventTarget();
const signaler = (nom, detail) => evenements.dispatchEvent(new CustomEvent(nom, { detail }));

/** Une erreur dite à Sam : `nature` dit quoi faire (reseau, delai, auth, version, serveur, illisible). */
export class ErreurAPI extends Error {
  constructor(message, { nature = "serveur", statut = 0, code = null } = {}) {
    super(message);
    this.nature = nature;
    this.statut = statut;
    this.code = code;
  }
}

const MESSAGES = {
  reseau: "La tour ne répond pas. Vérifie que le PC est allumé et que Tailscale est connecté, puis réessaie.",
  arretee: "La tour est joignable mais Rémy n'y répond pas (redémarrage ou mise à jour en cours ?). Réessaie dans un instant.",
  delai: "La tour met trop de temps à répondre. Réessaie dans un instant.",
  illisible: "La tour a répondu quelque chose d'illisible. Recharge la page ; si ça continue, mets la tour à jour.",
};

let enLigne = true;
/** La tour a-t-elle répondu au dernier appel ? */
export const tourJoignable = () => enLigne;
function marquer(ok) {
  if (ok === enLigne) return;
  enLigne = ok;
  signaler(ok ? "en-ligne" : "hors-ligne");
}

/** Le message d'erreur d'une réponse de la tour, avec son code d'incident. */
function messageDe(statut, corps) {
  let m = (corps && (corps.message || (typeof corps.error === "string" ? corps.error : null))) || `Erreur ${statut} : réessaie.`;
  if (m === "base_illisible") m = "La base de la tour est illisible : rien n'a été écrasé. Regarde le journal de la tour.";
  if (corps?.quoiFaire) m += ` ${corps.quoiFaire}`;
  if (corps?.code && /^R-/.test(corps.code)) m += ` (code ${corps.code})`;
  return m;
}

/**
 * Appelle la tour et rend le JSON (ou `null` pour une réponse vide).
 * `corps` : objet envoyé en JSON. `delai` en ms.
 */
export async function api(chemin, { methode = "GET", corps, delai = 25000, signal } = {}) {
  // Une écriture Motion qui tarde : la tour la fait attendre dans la file du
  // quota. Au bout de 4 s, le site le dit (« ça part tout seul »).
  if (chemin === "/api/motion/apply") {
    const suivi = setTimeout(() => signaler("motion-lent"), 4000);
    try {
      return await appel(chemin, { methode, corps, delai, signal });
    } finally {
      clearTimeout(suivi);
      signaler("motion-fini");
    }
  }
  return appel(chemin, { methode, corps, delai, signal });
}

async function appel(chemin, { methode, corps, delai, signal }) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort("delai"), delai);
  const relais = () => ctrl.abort("annule");
  signal?.addEventListener("abort", relais, { once: true });
  let r;
  try {
    r = await fetch(chemin, {
      method: methode,
      headers: corps !== undefined ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
      signal: ctrl.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (err) {
    clearTimeout(minuteur);
    signal?.removeEventListener("abort", relais);
    if (signal?.aborted) throw new ErreurAPI("Annulé.", { nature: "annule" });
    if (ctrl.signal.aborted && ctrl.signal.reason === "delai") throw new ErreurAPI(MESSAGES.delai, { nature: "delai" });
    marquer(false);
    throw new ErreurAPI(MESSAGES.reseau, { nature: "reseau" });
  }
  clearTimeout(minuteur);
  signal?.removeEventListener("abort", relais);
  const texte = await r.text().catch(() => "");
  let donnees = null;
  let illisible = false;
  if (texte) {
    try {
      donnees = JSON.parse(texte);
    } catch {
      illisible = true;
    }
  }
  // Un 502 ou 504 sans JSON vient de Tailscale Serve : Rémy est arrêté
  // derrière (mise à jour, redémarrage). Pour le site, la tour ne répond pas.
  if (arretDerriereLeRelais(r.status, donnees)) {
    marquer(false);
    throw new ErreurAPI(MESSAGES.arretee, { nature: "reseau", statut: r.status });
  }
  marquer(true);
  if (r.status === 401 && donnees?.error !== "bad_password") {
    signaler("session-perdue");
    throw new ErreurAPI("Ta session a expiré : reconnecte-toi.", { nature: "auth", statut: 401 });
  }
  if (r.status === 426) {
    signaler("version", donnees);
    throw new ErreurAPI(donnees?.message || "Cette interface est plus récente que la tour : mets la tour à jour.", { nature: "version", statut: 426 });
  }
  if (!r.ok) throw new ErreurAPI(illisible ? `Erreur ${r.status} : réessaie.` : messageDe(r.status, donnees), { nature: "serveur", statut: r.status, code: donnees?.code ?? null });
  if (illisible) throw new ErreurAPI(MESSAGES.illisible, { nature: "illisible", statut: r.status });
  return donnees;
}

/** 502/504 sans corps JSON : la réponse du relais (Tailscale Serve), pas de Rémy. */
export const arretDerriereLeRelais = (statut, donnees) => (statut === 502 || statut === 504) && (donnees == null || typeof donnees !== "object");

/**
 * Ce qu'un échec d'envoi dit d'une écriture (port de NatureEchec,
 * EnvoiCaptures.swift) :
 * - « incertain » : pas de réponse nette (réseau, délai, 500, 504, réponse
 *   illisible) : la tour l'a peut-être écrite → renvoyer avec le même id ;
 * - « passager » : une réponse nette, rien d'écrit, et ça passera (408, 425,
 *   429, 502 Rémy arrêté derrière Tailscale, 503 base indisponible) ;
 * - « refus » : la tour dit non (400, 404, 409, 422…) : ça attend Sam.
 * Une session perdue n'est rien de tout ça : `auth` (on attend la reconnexion).
 */
export function natureEchec(err) {
  if (!err) return "refus";
  if (err.nature === "auth") return "auth";
  if (err.nature === "reseau" || err.nature === "delai" || err.nature === "illisible") return "incertain";
  const statut = Number(err.statut) || 0;
  if (statut === 500 || statut === 504) return "incertain";
  if ([408, 425, 429, 502, 503].includes(statut)) return "passager";
  return "refus";
}

export const lire = (chemin, options) => api(chemin, options);
export const ecrire = (chemin, corps, options = {}) => api(chemin, { methode: "POST", corps: corps ?? {}, ...options });
export const remplacer = (chemin, corps, options = {}) => api(chemin, { methode: "PUT", corps: corps ?? {}, ...options });
export const modifier = (chemin, corps, options = {}) => api(chemin, { methode: "PATCH", corps: corps ?? {}, ...options });
export const supprimer = (chemin, options = {}) => api(chemin, { methode: "DELETE", ...options });

/** Un segment de chemin encodé (identifiants venus de la tour). */
export const seg = (s) => encodeURIComponent(String(s));

/** Un identifiant neuf (écritures idempotentes : la tour reconnaît un renvoi). */
export const nouvelId = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** La tour répond-elle ? (sonde légère, sans session) Un 502 ou 503 : non. */
export async function sonder(delai = 5000) {
  try {
    await api("/api/health", { delai });
    return true;
  } catch (err) {
    if (err.statut === 502 || err.statut === 503 || err.statut === 504) {
      marquer(false);
      return false;
    }
    return err.nature !== "reseau" && err.nature !== "delai";
  }
}

/** Silence maximal d'un flux avant de le couper (comme l'iPhone, API.swift : 180 s d'inactivité). */
export const INACTIVITE_FLUX = 180000;
/** Plafond total d'une réponse en flux (une recherche plus une longue réponse locale tient dedans). */
export const PLAFOND_FLUX = 30 * 60000;

/**
 * Envoie une requête qui répond en flux (SSE) et appelle `surEvenement(nom,
 * donnees)` pour chacun. Rend quand le flux se ferme. Les erreurs avant le
 * flux sont des ErreurAPI comme pour `api`. Le flux n'est coupé que s'il se
 * tait `inactivite` ms (réarmé à chaque morceau reçu), ou au-delà de `plafond`.
 */
export async function flux(chemin, corps, surEvenement, { signal, inactivite = INACTIVITE_FLUX, plafond = PLAFOND_FLUX } = {}) {
  const ctrl = new AbortController();
  let silence = setTimeout(() => ctrl.abort("silence"), inactivite);
  const reveil = () => {
    clearTimeout(silence);
    silence = setTimeout(() => ctrl.abort("silence"), inactivite);
  };
  const butoir = setTimeout(() => ctrl.abort("plafond"), plafond);
  const arreter = () => {
    clearTimeout(silence);
    clearTimeout(butoir);
  };
  signal?.addEventListener("abort", () => ctrl.abort("annule"), { once: true });
  let r;
  try {
    r = await fetch(chemin, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(corps ?? {}),
      signal: ctrl.signal,
      credentials: "same-origin",
    });
  } catch {
    arreter();
    if (ctrl.signal.reason === "annule") throw new ErreurAPI("Annulé.", { nature: "annule" });
    if (ctrl.signal.reason === "silence") throw new ErreurAPI("La tour n'a pas commencé à répondre en 3 minutes. Réessaie dans un instant.", { nature: "delai" });
    marquer(false);
    throw new ErreurAPI(MESSAGES.reseau, { nature: "reseau" });
  }
  if (!r.ok || !r.body) {
    arreter();
    const d = await r.json().catch(() => null);
    if (arretDerriereLeRelais(r.status, d)) {
      marquer(false);
      throw new ErreurAPI(MESSAGES.arretee, { nature: "reseau", statut: r.status });
    }
    marquer(true);
    if (r.status === 401 && d?.error !== "bad_password") {
      signaler("session-perdue");
      throw new ErreurAPI("Ta session a expiré : reconnecte-toi.", { nature: "auth", statut: 401 });
    }
    throw new ErreurAPI(messageDe(r.status, d), { nature: "serveur", statut: r.status, code: d?.code ?? null });
  }
  marquer(true);
  reveil();
  const lecteur = r.body.getReader();
  const decodeur = new TextDecoder();
  let tampon = "";
  const traiter = (bloc) => {
    const nom = bloc.match(/^event: ?(.+)$/m)?.[1]?.trim();
    const lignes = [...bloc.matchAll(/^data: ?(.*)$/gm)].map((m) => m[1]);
    if (!nom || !lignes.length) return;
    let d = null;
    try {
      d = JSON.parse(lignes.join("\n"));
    } catch {
      return;
    }
    surEvenement(nom, d);
  };
  try {
    while (true) {
      const { done, value } = await lecteur.read();
      if (done) break;
      reveil();
      tampon += decodeur.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i;
      while ((i = tampon.indexOf("\n\n")) !== -1) {
        traiter(tampon.slice(0, i));
        tampon = tampon.slice(i + 2);
      }
    }
    if (tampon.trim()) traiter(tampon);
  } catch (err) {
    const raison = ctrl.signal.reason;
    if (raison === "annule") throw new ErreurAPI("Interrompu.", { nature: "annule" });
    if (raison === "silence") throw new ErreurAPI(`La tour ne dit plus rien depuis ${Math.round(inactivite / 60000) || 1} min : la réponse a été arrêtée ici. Elle continue peut-être sur la tour : rouvre la conversation dans un moment.`, { nature: "delai" });
    if (raison === "plafond") throw new ErreurAPI("La réponse dure depuis plus de 30 min : elle a été arrêtée ici. Elle continue peut-être sur la tour : rouvre la conversation dans un moment.", { nature: "delai" });
    throw new ErreurAPI("La connexion à la tour a été coupée pendant la réponse.", { nature: "reseau" });
  } finally {
    arreter();
  }
}

// --- Version et capacités de la tour ---

let version = null;
/** `{ api, serveur, capacites: [...] }` (après connexion), ou null. */
export const versionTour = () => version;
export const sait = (capacite) => Boolean(version?.capacites?.includes(capacite));
export async function chargerVersion() {
  version = await api("/api/version", { delai: 8000 });
  return version;
}
