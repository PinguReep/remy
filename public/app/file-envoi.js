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
// Ce qui est parti est noté (remy-file-envoyes, deux jours) avec le ledgerId
// rendu par la tour : une coche partie pendant qu'Aujourd'hui n'était pas
// affiché (ou depuis une autre fenêtre) se conclut plus tard, « Annuler »
// compris. Un envoi en vol est marqué (enEnvoi) : l'annuler ne peut plus le
// retenir, seulement le défaire une fois arrivé.
// Chaque ligne dit où elle ira et où elle en est (decrire, etat : les phrases
// de FileEnvoiVue et d'EnvoiCaptures.swift) ; « Retirer » s'annule (remettre).
import { api, natureEchec } from "./api.js";
import { local, heure, dateCourte, memeJour } from "./ui.js";
import { noter as noterUsage } from "./usage.js";
import { echeanceLongue } from "./analyse/dates.js";

const CLE = "remy-file-envoi";
const CLE_ENVOYES = "remy-file-envoyes";
const GARDE_ENVOYES = 2 * 86400e3;
const ATTENTES = [0, 15e3, 60e3, 5 * 60e3, 15 * 60e3];
/** Au-delà, une capture qui reçoit toujours une réponse incertaine de la tour (500, 504) attend Sam. */
export const ESSAIS_INCERTAINS = 6;

const lireFile = () => local.lire(CLE, []) || [];
const ecrireFile = (f) => local.ecrire(CLE, f);
const abonnes = new Set();
const prevenir = () => abonnes.forEach((f) => f(lireFile()));

export const liste = () => lireFile();
export const compte = () => lireFile().length;

const idsEnVol = new Set(); // ids dont la requête est partie, sans réponse encore
/** La requête de cet envoi est partie et n'a pas encore de réponse. */
export const enEnvoi = (id) => idsEnVol.has(id);

const lireEnvoyes = () => local.lire(CLE_ENVOYES, []) || [];
/** Ce que la file a envoyé ces deux derniers jours : { id, resume, genre, a, ledgerId }, ou null. */
export const envoye = (id) => lireEnvoyes().find((x) => x.id === id) || null;
function noterEnvoye(e, r) {
  const garde = lireEnvoyes().filter((x) => x.id !== e.id && Date.now() - (x.a || 0) < GARDE_ENVOYES).slice(-49);
  garde.push({ id: e.id, resume: e.resume, genre: e.genre || null, a: Date.now(), ledgerId: r?.ledgerId ?? null });
  local.ecrire(CLE_ENVOYES, garde);
}
/** `f(file)` à chaque changement de la file, et quand un envoi part ou s'arrête (enVol) ; rend de quoi se désabonner. */
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

/** Retire un envoi ; rend sa place dans la file (pour « Annuler »), ou -1. */
export function retirer(id) {
  const f = lireFile();
  const i = f.findIndex((x) => x.id === id);
  ecrireFile(f.filter((x) => x.id !== id));
  prevenir();
  return i;
}

/** « Annuler » après « Retirer » : l'envoi revient tel qu'il était, à sa place (`place` : ce que rendait retirer). */
export function remettre(e, place = -1) {
  if (!e?.id) return false;
  const f = lireFile();
  if (f.some((x) => x.id === e.id)) return true;
  const i = place >= 0 ? Math.min(place, f.length) : f.findIndex((x) => (x.cree || 0) > (e.cree || 0));
  f.splice(i < 0 ? f.length : i, 0, e);
  if (!ecrireFile(f)) return false;
  prevenir();
  programmer();
  return true;
}

function maj(id, changement) {
  const f = lireFile();
  const i = f.findIndex((x) => x.id === id);
  if (i < 0) return;
  f[i] = { ...f[i], ...changement };
  ecrireFile(f);
  prevenir();
}

/**
 * Envoie un élément tout de suite (les requêtes dans l'ordre). Lève l'erreur
 * de la tour. Un geste de Sam (pas un renvoi de la file, `rejeu`) compte une
 * fois dans « Ce que tu utilises vraiment », quel que soit son nombre de requêtes.
 */
export async function envoyerElement(e, { rejeu = false } = {}) {
  if (!rejeu) noterUsage((e.requetes || []).some((r) => r.chemin === "/api/capture") ? "retenir" : "capture");
  let derniere = null;
  for (const r of e.requetes) {
    // « siAbsent » : créer le dossier seulement s'il manque (un dossier
    // « Idées » renommé par Sam ne se réécrit pas).
    if (r.siAbsent) {
      const d = await api("/api/dossiers");
      if ((d?.dossiers || []).some((x) => x.id === r.siAbsent)) continue;
    }
    derniere = await api(r.chemin, { methode: r.methode || "POST", corps: r.corps, delai: r.delai || 30000, compter: false });
  }
  return derniere;
}

let enCours = null;
let reveil = null;
let enVolId = null;
/** L'identifiant de l'envoi qui part en ce moment (null : aucun). */
export const enVol = () => enVolId;
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
    for (const { id } of lireFile()) {
      // Relue avant chaque envoi : une ligne retirée pendant que la précédente
      // partait ne part pas (« ne partira pas » a été dit) ; remise par
      // « Annuler », elle part telle qu'elle est (EnvoiCaptures.envoyerCapture).
      const e = lireFile().find((x) => x.id === id);
      if (!e) continue;
      if (!force && (e.refus || (!sansAttendre && e.prochain > Date.now()))) continue;
      enVolId = e.id;
      idsEnVol.add(e.id);
      prevenir(); // la liste d'attente dit « Part en ce moment… », la coche tourne
      try {
        const r = await envoyerElement(e, { rejeu: true }).finally(() => idsEnVol.delete(e.id));
        if (r && r.ok === false && Array.isArray(r.results)) {
          // Motion n'a pas pu cette fois (quota, panne) : passager ; sinon un refus.
          const res = r.results.find((x) => !x.ok);
          const passagere = res?.nature === "passager" || /quota|indisponible|429/i.test(res?.erreur || "");
          throw Object.assign(new Error(res?.erreur || "Refusé par Motion."), { nature: "serveur", statut: passagere ? 429 : 422 });
        }
        // Noté avant de sortir de la file : qui voit l'envoi disparaître sait qu'il est parti.
        noterEnvoye(e, r);
        retirer(e.id);
        envoyes.push(e.resume);
      } catch (err) {
        const nature = natureEchec(err);
        if (nature === "auth") {
          prevenir(); // plus en vol : la ligne qui attendait se redessine
          break;
        }
        const t = e.tentatives + 1;
        // Sans réponse nette, la tour l'a peut-être écrite : « Retirer » le dira.
        const sansReponse = e.sansReponse || nature === "incertain";
        // La tour répond, mais mal, à chaque essai : on arrête d'insister.
        const repondMal = nature === "incertain" && err.nature !== "reseau" && err.nature !== "delai";
        if (nature === "passager" || (nature === "incertain" && !(repondMal && t >= ESSAIS_INCERTAINS))) {
          maj(e.id, { tentatives: t, prochain: Date.now() + ATTENTES[Math.min(t, ATTENTES.length - 1)], dernierEchec: err.message || null, raison: raisonCourte(err), sansReponse });
          break; // dans l'ordre : la suite attend que celle-ci passe
        }
        maj(e.id, { refus: err.message || "Refusé par la tour.", tentatives: t, sansReponse, peutEtreRecue: nature === "incertain" });
      }
    }
    return { envoyes, restants: compte() };
  })().finally(() => {
    enCours = null;
    enVolId = null;
    prevenir(); // plus rien ne part : la liste le dit
    programmer();
  });
  return enCours;
}

/** Retente une capture refusée (Réessayer). */
export async function reessayer(id) {
  maj(id, { refus: null, prochain: 0 });
  return vider({ force: true });
}

/**
 * « Renvoyer » (une ligne à revoir) : Sam a vérifié ; elle repart avec le
 * même identifiant, sans relancer les autres refus.
 */
export async function renvoyer(id) {
  maj(id, { refus: null, peutEtreRecue: false, prochain: 0 });
  return vider({ sansAttendre: true });
}

// --- Ce que la liste « En attente d'envoi » dit de chaque envoi ---

/** Pas de réponse pendant l'envoi : la tour l'a peut-être écrite (EnvoiCaptures.peutEtreRecue). */
export const PEUT_ETRE_RECUE = "Pas de réponse de Rémy pendant l'envoi : il l'a peut-être déjà reçue. Renvoie-la seulement si elle n'est pas arrivée.";

/** La raison d'un échec passager, courte (le prochain essai se fait seul). */
export function raisonCourte(err) {
  if (err?.nature === "reseau" && !err.statut) return "la tour ne répond pas";
  if (err?.nature === "delai") return "la tour a mis trop de temps";
  if (err?.nature === "illisible") return "réponse illisible";
  const statut = Number(err?.statut) || 0;
  if (statut === 502 || statut === 504) return `Rémy ne répond pas derrière Tailscale (${statut})`;
  if (statut === 503) return "base de la tour indisponible (503)";
  if (statut === 429) return "Motion limite les requêtes (429)";
  if (statut) return `erreur de la tour (${statut})`;
  return String(err?.message || "échec").replace(/\s*(?:—|-|:|,)\s*réessaie[^.]*\.?\s*$/i, "");
}

const premiere = (e, f) => {
  for (const r of e?.requetes || []) {
    const v = f(r.corps || {}, r);
    if (v != null) return v;
  }
  return null;
};
const court = (t, n = 40) => {
  const s = String(t || "").trim();
  return s.length <= n ? s : `${s.slice(0, n - 1).trim()}…`;
};

/**
 * Où va un envoi, pour la liste d'attente : { genre, icone, libelle, texte,
 * detail, ou } (CaptureFigee.libelle, detail, ou). Lu dans ses requêtes,
 * telles que notées : rien n'est recalculé.
 */
export function decrire(e, maintenant = new Date()) {
  const g = e?.genre;
  const texteResume = String(e?.resume || "").replace(/^[^«]*« (.*) »[^»]*$/, "$1");
  switch (g) {
    case "tache": {
      const a = premiere(e, (c) => c.actions?.[0]) || {};
      const ech = a.echeance ? new Date(a.echeance) : null;
      const detail = !ech || Number.isNaN(ech.getTime()) ? "Motion lui trouvera un créneau"
        : ech < maintenant ? `Motion, échéance déjà passée (${echeanceLongue(ech, maintenant)}) : elle y arrivera en retard`
        : `Motion, d'ici ${echeanceLongue(ech, maintenant)}`;
      return { genre: g, icone: "coche", libelle: "Tâche", texte: a.nom || texteResume, detail, ou: "dans Motion" };
    }
    case "terminer":
      return { genre: g, icone: "coche", libelle: "Tâche cochée", texte: texteResume, detail: "Motion, marquée faite", ou: "dans Motion" };
    case "idee":
      return { genre: g, icone: "ampoule", libelle: "Idée", texte: premiere(e, (c) => c.notes?.[0]?.texte) || texteResume, detail: "Idées (Projets), rien n'est planifié", ou: "dans tes Idées (Projets)" };
    case "retenir":
      return { genre: g, icone: "ampoule", libelle: "Retenir", texte: premiere(e, (c) => c.texte) || texteResume, detail: "Mémoire de Rémy", ou: "dans la mémoire de Rémy" };
    case "projet": {
      const c = premiere(e, (c) => (c.nom ? c : null)) || {};
      const detail = e.nomParent ? `Projets, dans « ${e.nomParent} »` : c.parent ? "Projets, dans son dossier" : "Projets, à part";
      return { genre: g, icone: "dossier", libelle: "Dossier", texte: c.nom || texteResume, detail, ou: "dans Projets" };
    }
    case "liste": {
      const articles = premiere(e, (c) => (Array.isArray(c.elements) ? c.elements.map((x) => x.texte) : null)) || [];
      const nom = String(e?.resume || "").match(/dans « ([^»]+) »$/)?.[1] || "Courses";
      return { genre: g, icone: "liste", libelle: "Liste", texte: articles.join(", ") || texteResume, detail: `Carnet, dans « ${nom} »`, ou: `dans ta liste « ${nom} »` };
    }
    case "rappel": {
      const r = premiere(e, (c) => c.rappels?.[0]) || {};
      const q = Number(r.quand);
      return { genre: g, icone: "cloche", libelle: "Rappel", texte: r.texte || texteResume, detail: q ? `Rappels, ${memeJour(q, maintenant) ? `aujourd'hui ${heure(q)}` : `${dateCourte(q)} ${heure(q)}`}` : "Rappels, sans heure", ou: "dans tes rappels (Projets)" };
    }
    default:
      return { genre: g || "", icone: "envoyer", libelle: "Envoi", texte: e?.resume || "", detail: "Vers ta tour", ou: "sur ta tour" };
  }
}

/** « à 10:40 », « hier », « le 23 oct. » (FileEnvoiVue.quand). */
export function quandNotee(ms, maintenant = new Date()) {
  if (memeJour(ms, maintenant)) return `à ${heure(ms)}`;
  const hier = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() - 1);
  if (memeJour(ms, hier)) return "hier";
  return `le ${dateCourte(ms)}`;
}

/** Ce que la ligne dit de l'envoi, et s'il attend Sam (« Renvoyer ») : { texte, aRevoir }. */
export function etat(e, maintenant = Date.now()) {
  if (e?.refus) return { texte: e.peutEtreRecue ? PEUT_ETRE_RECUE : e.refus, aRevoir: true };
  if (!e?.dernierEchec && !e?.raison) return { texte: `Partira dès que Rémy sera joignable · notée ${quandNotee(e?.cree || maintenant, new Date(maintenant))}`, aRevoir: false };
  const raison = e.raison || raisonCourte({ message: e.dernierEchec });
  const quand = e.prochain > maintenant ? `, nouvel essai seul vers ${heure(e.prochain)}` : ", nouvel essai seul dès que possible";
  return { texte: `Dernier essai : ${raison}${quand} · notée ${quandNotee(e.cree || maintenant, new Date(maintenant))}`, aRevoir: false };
}

/** Le bandeau après « Retirer » (EnvoiCaptures.phraseRetiree). */
export function phraseRetiree(e, maintenant = new Date()) {
  const d = decrire(e, maintenant);
  return e?.sansReponse
    ? `Retirée de la file : « ${court(d.texte)} ». Un envoi est resté sans réponse, elle est peut-être déjà arrivée : vérifie ${d.ou}.`
    : `Retirée : « ${court(d.texte)} » ne partira pas.`;
}

/** Peut-il partir seul (pas un refus qui attend Sam) ? */
export const partSeul = (e) => !e?.refus;
