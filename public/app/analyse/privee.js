// Ce que la conversation privée promet, dit avec les mêmes mots que l'iPhone
// (ios-native/RemyCore/Sources/RemyCore/Privee.swift, et le verrou de
// Reglages dans Models.swift). « ni ailleurs » seulement quand rien d'autre ne
// peut sortir : si Sam a permis la recherche dans les conversations privées,
// des questions générales partent vers le moteur (salle blanche, filtre).
// Module pur : importé par le site et par les tests node.

/**
 * inconnu, sansReglage, permise, coupee, webCoupee, verrouillee
 * (EtatRecherchePrivee). `capacite` : la tour sait-elle recherche-privee-v1 ?
 * Sans elle, une conversation privée n'y cherche jamais (sansReglage).
 */
export function etatRecherchePrivee(r, { capacite = true } = {}) {
  if (!capacite) return "sansReglage";
  if (!r || typeof r !== "object") return "inconnu";
  if (verrouRecherchePrivee(r)) return "verrouillee";
  if (r.rechercheWeb !== true || r.rechercheWebCoupeeParLaTour === true) return "webCoupee";
  return r.recherchePrivee === true ? "permise" : "coupee";
}

/** Pourquoi l'interrupteur est grisé, s'il l'est (Reglages.verrouRecherchePrivee). */
export function verrouRecherchePrivee(r) {
  if (r?.salleBlanche === false) return "Verrouillée sur la tour : sans la salle blanche (REMY_SALLE_BLANCHE=off), une conversation privée ne cherche jamais.";
  if (r?.recherchePriveeVerrouillee === true) return "Verrouillée sur la tour (REMY_RECHERCHE_PRIVEE=off) : une conversation privée ne cherche jamais, quoi que dise ce réglage.";
  if (r && !String(r.rechercheLocale || "").trim()) return "Ta tour ne cherche pas elle-même sur le web : une conversation privée ne cherche jamais.";
  return null;
}

/** Ce qui sort quand la recherche est permise (ConversationPrivee.ceQuiSort). */
export const CE_QUI_SORT = "partent vers le moteur de recherche des questions générales, écrites par Rémy puis par la salle blanche (une recherche qui ne sait rien de toi) ; les pages trouvées sont lues depuis ta tour, et le filtre bloque noms, numéros et mots de cette conversation.";
export const SANS_MODELE_LOCAL = "Si le modèle local est éteint, Rémy ne répond pas : rien ne bascule vers Claude.";

/** La promesse en quelques mots. */
export function sousTitrePrivee(etat) {
  return etat === "permise" || etat === "inconnu" ? "Rien ne part chez Claude" : "Rien ne part chez Claude ni ailleurs";
}

/** Ce que ça change, dit en clair (écran vide, panneau, confirmation). */
export function ceQueCaChange(etat) {
  const local = "Rémy répond avec le modèle local de ta tour, n'en retient rien dans sa mémoire, et la réflexion de la nuit ne la lit pas.";
  const web = {
    permise: `Recherche web permise (Réglages) : ${CE_QUI_SORT}`,
    coupee: "Pas de recherche web (Réglages › Recherche dans les conversations privées pour la permettre).",
    webCoupee: "Pas de recherche web : elle est coupée (Réglages › Recherche web).",
    verrouillee: "Pas de recherche web : ta tour ne la permet pas dans une conversation privée.",
    sansReglage: "Pas de recherche web dans une conversation privée.",
  }[etat] || "Pas de recherche web, sauf si tu l'as permise dans Réglages.";
  return `${sousTitrePrivee(etat)} : ${local} ${web} ${SANS_MODELE_LOCAL}`;
}

/** Avant de rendre privée la conversation en cours : sans retour, dit avant de confirmer. */
export function confirmationPrivee(etat) {
  return `C'est sans retour : elle restera privée. Pour repasser par Claude, il faudra ouvrir une nouvelle conversation. ${ceQueCaChange(etat)}`;
}
