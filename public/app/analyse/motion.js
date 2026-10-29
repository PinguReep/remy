// Ce que l'accueil dit de Motion, sans IA : le port fidèle de
// `EtatMotion.phrase` (ios-native/RemyCore/Sources/RemyCore/Models.swift).
// La tour seule sait si c'est le quota, une panne ou une mise à jour
// (journee.motion = { etat, luA, raison }) ; le site le dit avec les mêmes
// mots que l'iPhone, en tête d'Aujourd'hui, et ne dit « À jour. » que si
// c'est vrai. Module pur : importé par le site et par les tests node.

/** « 4 min », « 1 h 05 » (Format.duree). */
function duree(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, "0")}`;
}

/** États où le bandeau est une alerte (et non une simple information). */
export const ALERTES_MOTION = new Set(["panne", "reseau", "auth", "quota"]);
/** États où « Réessayer » a un sens. */
export const REESSAI_MOTION = new Set(["panne", "reseau", "quota"]);

/** La phrase du bandeau (null : rien à dire). Une liste de moins de 10 min sans souci n'en mérite pas. */
export function phraseMotion(m, maintenant = Date.now()) {
  if (!m || typeof m.etat !== "string") return null;
  const age = typeof m.luA === "number" ? Math.max(0, Math.floor((maintenant - m.luA) / 60000)) : null;
  const depuis = age == null ? null : age < 1 ? "à l'instant" : `il y a ${duree(age)}`;
  const liste = depuis ? `Tâches Motion lues ${depuis}` : null;
  switch (m.etat) {
    case "auth":
      return "Motion refuse la clé de la tour : vérifie MOTION_API_KEY dans remy.env.";
    case "quota":
      return (liste ? `${liste} : ` : "") + "Motion limite les requêtes, mise à jour dès que possible.";
    case "menage":
      if (age == null || age < 3) return null;
      return (liste || "Tâches Motion") + " : Rémy garde le quota Motion pour tes gestes, mise à jour dans un instant.";
    case "panne":
      return (liste ? `${liste} : ` : "") + "Motion ne répond pas pour l'instant.";
    case "reseau":
      return (liste ? `${liste} : ` : "") + "la tour ne joint pas Motion (réseau).";
    case "attente":
      return "Première lecture de Motion en cours…";
    case "ok":
    case "maj":
      if (age == null || age < 10 || !liste) return null;
      return liste + (m.etat === "maj" ? ", mise à jour en cours." : ".");
    default:
      return null;
  }
}

/** Motion vient-il vraiment d'être relu ? (« À jour. » ne se dit qu'alors.) */
export const motionFrais = (m) => !m || m.etat === "ok" || m.etat === "maj" || m.etat === "off";
