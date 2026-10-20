// La jauge du chat (19/10) : la vitesse d'écriture du modèle, en jetons par
// seconde, et la place qu'occupe la conversation dans sa mémoire de travail.
// Aucun appel IA ici : des compteurs, et des durées mesurées sur la tour.
//
// Pendant la réponse, les jetons ne sont connus qu'à la fin (usage) : on les
// estime au fil de l'eau d'après les caractères reçus (réflexion, texte,
// appels d'outils), avec un rapport caractères/jeton appris sur les vraies
// réponses. À la fin, le compte exact du modèle remplace l'estimation.

// Rapport de départ (français, tokenizer GLM) ; ensuite, celui des réponses.
const CARS_PAR_JETON_DEFAUT = 3.2;
let carsParJeton = CARS_PAR_JETON_DEFAUT;

// Une mise à jour par seconde au plus : lisible à l'œil nu, et le flux n'est
// pas noyé d'événements.
export const PAS_DEBIT_MS = 1000;

export const rapportAppris = () => carsParJeton;
export function oublierRapport() {
  carsParJeton = CARS_PAR_JETON_DEFAUT;
}

function apprendre(cars, jetons) {
  if (jetons < 50 || cars <= 0) return; // trop court pour en tirer quelque chose
  const r = cars / jetons;
  if (r < 1 || r > 8) return; // aberrant : on garde l'ancien
  carsParJeton = carsParJeton * 0.7 + r * 0.3;
}

const arrondi = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;

// Suit une réponse, sur un ou plusieurs tours (outils). `envoyer({ tps, jetons })`
// reçoit le débit en direct. Le temps compté est celui de l'écriture : du
// premier jeton de chaque tour à sa fin (ni la lecture du contexte par le
// modèle, ni l'exécution des outils).
export function compteurDebit(envoyer = () => {}, { pas = PAS_DEBIT_MS, maintenant = () => performance.now() } = {}) {
  const t0 = maintenant();
  let premierMs = null;
  let debutTour = null;
  let decodeMs = 0;
  let carsTour = 0;
  let jetonsFinis = 0; // tours terminés (compte exact du modèle, sinon estimé)
  let exact = true;
  let dernierEnvoi = null;

  const enCours = (t) => {
    const ms = decodeMs + (debutTour === null ? 0 : t - debutTour);
    const jetons = jetonsFinis + carsTour / carsParJeton;
    return { ms, jetons };
  };

  return {
    // Un morceau produit par le modèle (réflexion, texte ou arguments d'outil).
    morceau(texte) {
      const n = String(texte || "").length;
      if (!n) return;
      const t = maintenant();
      if (debutTour === null) {
        debutTour = t;
        if (premierMs === null) premierMs = t - t0;
        if (dernierEnvoi === null) dernierEnvoi = t;
      }
      carsTour += n;
      if (t - dernierEnvoi >= pas) {
        dernierEnvoi = t;
        const { ms, jetons } = enCours(t);
        if (ms > 0) envoyer({ tps: arrondi((jetons * 1000) / ms), jetons: Math.round(jetons) });
      }
    },
    // Fin d'un tour : `jetons` = completion_tokens du modèle (null s'il ne l'a pas dit).
    finTour(jetons) {
      const t = maintenant();
      if (debutTour !== null) decodeMs += t - debutTour;
      debutTour = null;
      if (Number.isFinite(jetons) && jetons > 0) {
        jetonsFinis += jetons;
        apprendre(carsTour, jetons);
      } else if (carsTour) {
        jetonsFinis += carsTour / carsParJeton;
        exact = false;
      }
      carsTour = 0;
    },
    // Le bilan de la réponse : null si le modèle n'a rien écrit.
    bilan() {
      const { ms, jetons } = enCours(maintenant());
      if (!jetons || ms <= 0) return null;
      return {
        jetons: Math.round(jetons),
        tps: arrondi((jetons * 1000) / ms),
        decodeMs: Math.round(ms),
        premierMs: premierMs === null ? null : Math.round(premierMs),
        ...(exact ? {} : { estime: true }),
      };
    },
  };
}

// Le contexte du dernier appel au modèle : ce qu'il avait en tête en finissant
// sa réponse (consigne + conversation + résultats d'outils lus, puis ce qu'il
// a écrit). La répartition suit la part de caractères de chaque bloc (≈).
export function contexteDe({ entree, sortie, cars }) {
  if (!Number.isFinite(entree) || entree <= 0) return null;
  const s = Number.isFinite(sortie) && sortie > 0 ? sortie : 0;
  const total = (cars?.systeme || 0) + (cars?.conversation || 0) + (cars?.outils || 0);
  const part = (x) => (total ? Math.round((entree * (x || 0)) / total) : 0);
  const systeme = part(cars?.systeme);
  const outils = part(cars?.outils);
  return {
    utilise: entree + s,
    repartition: total
      ? { systeme, conversation: Math.max(0, entree - systeme - outils), outils, reponse: s }
      : null,
  };
}

// La taille maximale du contexte, telle que le serveur du modèle la déclare
// (/v1/models), selon les moteurs : vLLM, SGLang, TabbyAPI, llama.cpp…
export function fenetreDeclaree(entree) {
  if (!entree || typeof entree !== "object") return null;
  const candidats = [
    entree.max_model_len,
    entree.context_length,
    entree.max_context_length,
    entree.context_window,
    entree.max_seq_len,
    entree.parameters?.max_seq_len,
    entree.meta?.n_ctx,
    entree.meta?.n_ctx_train,
  ];
  for (const c of candidats) {
    const n = Number(c);
    if (Number.isFinite(n) && n >= 1024 && n <= 100_000_000) return Math.round(n);
  }
  return null;
}
