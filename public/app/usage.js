// Ce que tu utilises vraiment (port de Usage.swift, 24/10) : des compteurs
// par fonction et par jour, sur cet ordinateur seulement. Aucun contenu : un
// nom de fonction et un nombre, jamais un texte, un titre ou un lieu. Ils ne
// partent nulle part (pas même vers la tour). Gardés 60 jours.
// Comptés : l'ouverture au premier plan, les vues (main.js), et les GESTES :
// les écritures envoyées à la tour (api.js : une coche, un message, une
// validation). Les lectures, les renvois de la file et ce que le site envoie
// seul (signe de vie) ne comptent pas.
// Module pur (le stockage passe par `local`, lu à l'appel) : testé sous node.
import { local } from "./ui.js";

/** Les fonctions comptées, dans l'ordre de FonctionUsage, et leur libellé. */
export const FONCTIONS = [
  ["ouverture", "Ouvrir l'app"], ["aujourdhui", "Écran Aujourd'hui"], ["remy", "Écran Rémy"], ["projets", "Écran Projets"],
  ["parler", "Parler à Rémy"], ["valider", "Valider une proposition"], ["refuser", "Refuser ou ajuster une proposition"], ["annuler", "Annuler une action"],
  ["terminer", "Cocher une tâche"], ["gerer", "Décaler, prolonger, modifier"], ["capture", "Noter avec « + »"], ["retenir", "Retenir une idée"],
  ["listes", "Listes de courses"], ["rappels", "Rappels"], ["dictee", "Dictée"], ["dossiers", "Dossiers et étiquettes"],
  ["regles", "Règles de Rémy"], ["conseil", "Renouveler le conseil"], ["nuit", "Sujets de la nuit"], ["lieux", "Lieux"], ["reglages", "Réglages de la tour"],
];
const LIBELLES = Object.fromEntries(FONCTIONS);
export const libelle = (f) => LIBELLES[f] || f;
/** L'ouverture et les vues disent qu'on regarde ; le reste, qu'on agit. */
export const estUnGeste = (f) => !["ouverture", "aujourdhui", "remy", "projets"].includes(f);

/**
 * Quelle fonction une écriture vers la tour représente (FonctionUsage.de).
 * null : une lecture, ou un envoi que le site fait seul. Seul le TYPE
 * d'action est lu dans le corps, jamais un texte.
 */
export function fonctionDe(methode, chemin, corps) {
  if (String(methode || "GET").toUpperCase() === "GET") return null;
  const p = String(chemin || "").split("?")[0];
  const m = p.split("/").filter(Boolean);
  if (m.length < 2 || m[0] !== "api") return null;
  switch (m[1]) {
    case "conversations":
      if (m.length === 4 && m[3] === "messages") return "parler";
      if (m.length === 5 && m[3] === "autorisations") return "parler";
      if (m.length === 6 && m[3] === "propositions") return m[5] === "regle" ? "regles" : "refuser";
      return null;
    case "motion":
    case "google": {
      if (m.length === 3 && m[2] === "undo") return "annuler";
      if (!(m.length === 3 && m[2] === "apply")) return null;
      const o = corps && typeof corps === "object" ? corps : null;
      if (o?.origine === "capture") return "capture";
      if (o?.convId != null) return "valider";
      const type = Array.isArray(o?.actions) ? String(o.actions[0]?.type || "") : "";
      if (type === "terminer") return "terminer";
      if (type === "creer") return "capture";
      if (["modifier", "replanifier", "prolonger"].includes(type)) return "gerer";
      return "valider";
    }
    case "taches": return m[m.length - 1] === "etiquettes" ? "dossiers" : "gerer";
    case "capture": return m.length === 3 && m[2] === "analyser" ? "capture" : "retenir";
    case "listes": return "listes";
    case "rappels": return "rappels";
    case "transcribe":
    case "dictee": return "dictee";
    case "etiquettes":
    case "dossiers":
    case "rattachements": return "dossiers";
    case "regles": return "regles";
    case "conseil": return "conseil";
    case "briefing": return "nuit";
    case "lieux": return m.length === 3 && m[2] === "evenements" ? null : "lieux";
    case "reglages":
    case "modeles": return "reglages";
    default: return null;
  }
}

// --- Les compteurs (local : { parJour: { "2026-10-24": { terminer: 3 } }, debut }) ---
export const CLE = "remy-usage-v1";
export const JOURS_GARDES = 60;
const jourISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lire = () => {
  const v = local.lire(CLE, null);
  return v && typeof v === "object" && v.parJour && typeof v.parJour === "object" ? v : { parJour: {}, debut: null };
};

/** Compte une fonction (un geste, une ouverture, une vue) pour aujourd'hui. */
export function noter(f, date = new Date()) {
  if (!LIBELLES[f]) return;
  const c = lire();
  const jour = jourISO(date);
  const j = (c.parJour[jour] ||= {});
  j[f] = (j[f] || 0) + 1;
  if (c.debut == null) c.debut = date.getTime();
  const jours = Object.keys(c.parJour).sort();
  for (const k of jours.slice(0, Math.max(0, jours.length - JOURS_GARDES))) delete c.parJour[k];
  local.ecrire(CLE, c);
}

/** Une écriture vers la tour (api.js) : comptée si c'est un geste connu. */
export function noterRequete(methode, chemin, corps) {
  const f = fonctionDe(methode, chemin, corps);
  if (f) noter(f);
}

/** Les totaux des `jours` derniers jours (aujourd'hui compris). */
export function totaux({ jours = 30, maintenant = new Date() } = {}) {
  const depuis = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() - (jours - 1));
  const premier = jourISO(depuis);
  const t = {};
  for (const [jour, compte] of Object.entries(lire().parJour)) {
    if (jour < premier) continue;
    for (const [f, n] of Object.entries(compte || {})) if (LIBELLES[f] && Number.isFinite(n)) t[f] = (t[f] || 0) + n;
  }
  return t;
}

export const debut = () => lire().debut;
export const remettreAZero = () => local.effacer(CLE);

/**
 * Le résumé de Réglages (ResumeUsage) : les gestes du plus au moins utilisé,
 * les vues, les gestes jamais faits, et si c'est assez pour conclure (10).
 */
export function resume(t = totaux(), { depuis = debut(), jours = 30 } = {}) {
  const lignes = FONCTIONS.map(([f]) => ({ fonction: f, libelle: libelle(f), nombre: t[f] || 0 }))
    .filter((l) => l.nombre > 0)
    .sort((a, b) => (a.nombre !== b.nombre ? b.nombre - a.nombre : a.libelle.localeCompare(b.libelle, "fr")));
  const gestes = lignes.filter((l) => estUnGeste(l.fonction));
  const jamais = FONCTIONS.map(([f]) => f).filter((f) => estUnGeste(f) && !(t[f] > 0));
  const assez = gestes.reduce((s, l) => s + l.nombre, 0) >= 10;
  let phrase = "Pas encore assez de gestes comptés pour le dire. Compté sur cet ordinateur, sans contenu.";
  if (assez) {
    const top = gestes.slice(0, 3).map((l) => l.libelle.toLowerCase());
    phrase = `Surtout : ${top.join(", ")}${jamais.length ? `. ${jamais.length} fonction${jamais.length > 1 ? "s" : ""} jamais touchée${jamais.length > 1 ? "s" : ""}.` : "."}`;
  }
  return { gestes, vues: lignes.filter((l) => !estUnGeste(l.fonction)), jamais, jours, depuis, assez, phrase };
}
