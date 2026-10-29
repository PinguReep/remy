// La file d'envoi du site : ce que Sam note pendant que la tour ne répond
// pas reste ici (localStorage) et part tout seul au retour, dans l'ordre.
// Chaque envoi porte un identifiant fixé à la capture (idCommande, idCapture,
// id d'élément) : renvoyé après une coupure, la tour ne le fait pas deux fois.
// Une capture refusée par la tour (4xx) n'est pas renvoyée en boucle : elle
// attend Sam (Réessayer ou Retirer, dans Réglages › Envoi en attente).
// Un échec passager (502 : Rémy arrêté derrière Tailscale, 503, 429, 408…)
// ou incertain (réseau, délai, 500, 504) repart tout seul, plus tard, avec le
// même identifiant (NatureEchec de l'iPhone) ; un incertain qui se répète
// (la tour répond 500 à chaque essai) finit par attendre Sam.
import { api, natureEchec } from "./api.js";
import { local } from "./ui.js";

const CLE = "remy-file-envoi";
const ATTENTES = [0, 15e3, 60e3, 5 * 60e3, 15 * 60e3];
/** Au-delà, une capture qui reçoit toujours une réponse incertaine de la tour (500, 504) attend Sam. */
export const ESSAIS_INCERTAINS = 6;

const lireFile = () => local.lire(CLE, []) || [];
const ecrireFile = (f) => local.ecrire(CLE, f);
const abonnes = new Set();
const prevenir = () => abonnes.forEach((f) => f(lireFile()));

export const liste = () => lireFile();
export const compte = () => lireFile().length;
export const surChangement = (f) => {
  abonnes.add(f);
  return () => abonnes.delete(f);
};

/**
 * Met un envoi en file. `requetes` : [{ chemin, methode, corps }] envoyées dans
 * l'ordre (une idée = créer le dossier Idées puis la note). Rend l'élément.
 */
export function ajouter({ id, resume, genre, requetes }) {
  const f = lireFile();
  if (f.some((x) => x.id === id)) return f.find((x) => x.id === id);
  const e = { id, resume, genre, requetes, cree: Date.now(), tentatives: 0, prochain: 0, refus: null };
  f.push(e);
  if (!ecrireFile(f)) return null;
  prevenir();
  return e;
}

export function retirer(id) {
  ecrireFile(lireFile().filter((x) => x.id !== id));
  prevenir();
}

function maj(id, changement) {
  const f = lireFile();
  const i = f.findIndex((x) => x.id === id);
  if (i < 0) return;
  f[i] = { ...f[i], ...changement };
  ecrireFile(f);
  prevenir();
}

/** Envoie un élément tout de suite (les requêtes dans l'ordre). Lève l'erreur de la tour. */
export async function envoyerElement(e) {
  let derniere = null;
  for (const r of e.requetes) {
    // « siAbsent » : créer le dossier seulement s'il manque (un dossier
    // « Idées » renommé par Sam ne se réécrit pas).
    if (r.siAbsent) {
      const d = await api("/api/dossiers");
      if ((d?.dossiers || []).some((x) => x.id === r.siAbsent)) continue;
    }
    derniere = await api(r.chemin, { methode: r.methode || "POST", corps: r.corps, delai: r.delai || 30000 });
  }
  return derniere;
}

let enCours = null;
let reveil = null;
/**
 * Le prochain essai se programme tout seul : une capture en attente (502,
 * 503, 429…) repart à l'heure dite même si rien d'autre ne se passe sur la
 * page (pas de retour au premier plan, pas d'événement « en ligne »).
 */
function programmer() {
  clearTimeout(reveil);
  reveil = null;
  if (typeof setTimeout !== "function") return;
  const prochains = lireFile().filter((x) => !x.refus && x.prochain > Date.now()).map((x) => x.prochain);
  if (!prochains.length) return;
  const dans = Math.max(1000, Math.min(...prochains) - Date.now() + 250);
  reveil = setTimeout(() => {
    reveil = null;
    vider().catch(() => {});
  }, dans);
  reveil?.unref?.(); // sous node (tests), ne retient pas le processus
}

/**
 * Vide la file : s'arrête au premier échec réseau (inutile d'insister). Rend
 * `{ envoyes: [resume…], restants }`. `force` : ignore l'attente entre deux essais
 * et retente les refus. `sansAttendre` : la tour vient de répondre de nouveau,
 * l'attente entre deux essais ne sert plus (les refus, eux, attendent Sam).
 */
export function vider({ force = false, sansAttendre = false } = {}) {
  if (enCours) return enCours;
  enCours = (async () => {
    const envoyes = [];
    for (const e of lireFile()) {
      if (!force && (e.refus || (!sansAttendre && e.prochain > Date.now()))) continue;
      try {
        const r = await envoyerElement(e);
        if (r && r.ok === false && Array.isArray(r.results)) {
          // Motion n'a pas pu cette fois (quota, panne) : passager ; sinon un refus.
          const res = r.results.find((x) => !x.ok);
          const passagere = res?.nature === "passager" || /quota|indisponible|429/i.test(res?.erreur || "");
          throw Object.assign(new Error(res?.erreur || "Refusé par Motion."), { nature: "serveur", statut: passagere ? 429 : 422 });
        }
        retirer(e.id);
        envoyes.push(e.resume);
      } catch (err) {
        const nature = natureEchec(err);
        if (nature === "auth") break;
        const t = e.tentatives + 1;
        // La tour répond, mais mal, à chaque essai : on arrête d'insister.
        const repondMal = nature === "incertain" && err.nature !== "reseau" && err.nature !== "delai";
        if (nature === "passager" || (nature === "incertain" && !(repondMal && t >= ESSAIS_INCERTAINS))) {
          maj(e.id, { tentatives: t, prochain: Date.now() + ATTENTES[Math.min(t, ATTENTES.length - 1)], dernierEchec: err.message || null });
          break; // dans l'ordre : la suite attend que celle-ci passe
        }
        maj(e.id, { refus: err.message || "Refusé par la tour.", tentatives: t });
      }
    }
    return { envoyes, restants: compte() };
  })().finally(() => {
    enCours = null;
    programmer();
  });
  return enCours;
}

/** Retente une capture refusée (Réessayer). */
export async function reessayer(id) {
  maj(id, { refus: null, prochain: 0 });
  return vider({ force: true });
}
