// La file d'envoi du site : ce que Sam note pendant que la tour ne répond
// pas reste ici (localStorage) et part tout seul au retour, dans l'ordre.
// Chaque envoi porte un identifiant fixé à la capture (idCommande, idCapture,
// id d'élément) : renvoyé après une coupure, la tour ne le fait pas deux fois.
// Une capture refusée par la tour (4xx) n'est pas renvoyée en boucle : elle
// attend Sam (Réessayer ou Retirer, dans Réglages › Envoi en attente).
import { api } from "./api.js";
import { local } from "./ui.js";

const CLE = "remy-file-envoi";
const ATTENTES = [0, 15e3, 60e3, 5 * 60e3, 15 * 60e3];

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
/**
 * Vide la file : s'arrête au premier échec réseau (inutile d'insister). Rend
 * `{ envoyes: [resume…], restants }`. `force` : ignore l'attente entre deux essais
 * et retente les refus.
 */
export function vider({ force = false } = {}) {
  if (enCours) return enCours;
  enCours = (async () => {
    const envoyes = [];
    for (const e of lireFile()) {
      if (!force && (e.refus || e.prochain > Date.now())) continue;
      try {
        const r = await envoyerElement(e);
        if (r && r.ok === false && Array.isArray(r.results)) throw Object.assign(new Error(r.results.find((x) => !x.ok)?.erreur || "Refusé par Motion."), { nature: "serveur" });
        retirer(e.id);
        envoyes.push(e.resume);
      } catch (err) {
        if (err.nature === "reseau" || err.nature === "delai") {
          const t = e.tentatives + 1;
          maj(e.id, { tentatives: t, prochain: Date.now() + ATTENTES[Math.min(t, ATTENTES.length - 1)] });
          break;
        }
        if (err.nature === "auth") break;
        maj(e.id, { refus: err.message, tentatives: e.tentatives + 1 });
      }
    }
    return { envoyes, restants: compte() };
  })().finally(() => {
    enCours = null;
  });
  return enCours;
}

/** Retente une capture refusée (Réessayer). */
export async function reessayer(id) {
  maj(id, { refus: null, prochain: 0 });
  return vider({ force: true });
}
