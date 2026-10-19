// Ce que fait Rémy pendant qu'il répond, pour la petite barre du chat (19/10) :
// relire le contexte, choisir le modèle, attendre le modèle, réfléchir, lire
// Motion, chercher sur le web, écrire. Chaque étape part en événement « status »
// (compatible avec les apps qui ne lisent que `text`) avec une clé, le temps
// écoulé depuis le début et, pour la réflexion, un court extrait.
//
// Lisible à l'œil nu : la réflexion du modèle arrive par petits morceaux (dix
// par seconde ou plus) ; on n'en montre qu'un extrait toutes les PAS_REFLEXION_MS.
// L'extrait n'est ni enregistré ni envoyé ailleurs qu'à l'app de la personne.

export const PAS_REFLEXION_MS = 1500;
const EXTRAIT_MAX = 140;

// La fin de ce que le modèle est en train de penser, sur une ligne.
export function extraitPensee(texte) {
  const plat = String(texte || "").replace(/\s+/g, " ").trim();
  if (plat.length <= EXTRAIT_MAX) return plat;
  const fin = plat.slice(-EXTRAIT_MAX);
  const espace = fin.indexOf(" ");
  return "…" + (espace > 0 && espace < 30 ? fin.slice(espace + 1) : fin);
}

// `send` : l'émetteur SSE de la réponse. `maintenant` : horloge (tests).
export function suiviEtapes(send, maintenant = () => Date.now()) {
  const debut = maintenant();
  let derniere = null;
  const etape = (cle, texte, detail) => {
    const evt = { text: texte, cle, t: maintenant() - debut };
    if (detail) evt.detail = detail;
    derniere = cle;
    send("status", evt);
  };
  // L'étape en cours (pour ne pas répéter « écrit » à chaque mot).
  etape.courante = () => derniere;
  return etape;
}

// La réflexion : un signal immédiat, puis un extrait au plus toutes les
// PAS_REFLEXION_MS, quel que soit le débit du modèle.
export function suiviReflexion(signaler, maintenant = () => Date.now(), pas = PAS_REFLEXION_MS) {
  let pensee = "";
  let dernier = null;
  return (morceau) => {
    pensee = (pensee + String(morceau || "")).slice(-800);
    const t = maintenant();
    if (dernier !== null && t - dernier < pas) return;
    dernier = t;
    signaler(extraitPensee(pensee));
  };
}
