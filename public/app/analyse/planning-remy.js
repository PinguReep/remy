// « Le planning de Rémy, à côté de celui de Motion » (12/11, planning-remy-v1) :
// les mots et les regroupements de la feuille, sans DOM (importé par le site et
// par test/site-planning-remy.test.mjs). Le calcul vit sur la tour
// (lib/planificateur.js) : ici, on ne fait que dire ce qu'elle a rendu.
import { jourISO, jourCourtSemaine } from "./journee.js";

export const GENRES = Object.freeze({
  bloquee: { titre: "Bloquée, placée quand même", icone: "pause" },
  ferme: { titre: "Échéance ferme", icone: "cadenas" },
  echeance: { titre: "Échéance", icone: "drapeau" },
  ordre: { titre: "Ordre différent", icone: "deplacer" },
});

/** La réponse de la tour a-t-elle la forme attendue ? (sinon : « illisible », jamais « rien »). */
export function planningLisible(b) {
  if (!b || typeof b !== "object" || typeof b.etat !== "string") return false;
  if (b.etat !== "ok") return true;
  return Array.isArray(b.ecarts) && Array.isArray(b.remy?.placements) && Array.isArray(b.remy?.nonPlaces) && typeof b.jugements === "object";
}

/** Ce que la feuille dit quand il n'y a pas de planning à montrer (null : il y en a un). */
export function messageEtat(b) {
  switch (b?.etat) {
    case "coupe": return { titre: "Coupé dans les Réglages", texte: "Le planning de Rémy ne se calcule plus. Réglages › Rémy › Circuits pour le rallumer.", reglages: true };
    case "sans-motion": return { titre: "Motion n'est pas connecté", texte: "Sans les tâches de Motion, il n'y a rien à comparer." };
    case "attente": return { titre: "Motion n'a pas encore été lu", texte: "La tour n'a pas encore lu tes tâches Motion : ouvre Aujourd'hui (ou tire pour rafraîchir), puis reviens ici." };
    case "ok": return null;
    default: return { titre: "Réponse inattendue", texte: "La tour a rendu une réponse que cette page ne sait pas lire : mets la tour à jour." };
  }
}

const fois = (n) => `${n} fois`;
const F_DATE = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }) : null;
export const dateCourte = (ms) => (F_DATE ? F_DATE.format(new Date(ms)) : "");

/** « Tes jugements depuis le 12 nov. : Rémy a raison 3 fois, Motion 1 fois. » */
export function phraseCompteur(j) {
  const remy = Number(j?.remy) || 0;
  const motion = Number(j?.motion) || 0;
  if (!remy && !motion) return "Pas encore de jugement : pour chaque écart, dis qui a raison. Dans quelques semaines, le compte dira si Rémy peut planifier seul.";
  const depuis = Number.isFinite(j?.depuis) ? ` depuis le ${dateCourte(j.depuis)}` : "";
  return `Tes jugements${depuis} : Rémy a raison ${fois(remy)}, Motion ${fois(motion)}.`;
}

/** La part de « Rémy a raison » (0 à 1), null sans jugement. */
export const partRemy = (j) => {
  const t = (Number(j?.remy) || 0) + (Number(j?.motion) || 0);
  return t ? (Number(j.remy) || 0) / t : null;
};

/** La phrase de tête : combien d'écarts, sur combien de tâches. */
export function phraseTete(b) {
  const n = Array.isArray(b?.ecarts) ? b.ecarts.length : 0;
  const t = Number(b?.resume?.taches) || 0;
  if (!t) return "Aucune tâche ouverte dans Motion : rien à planifier.";
  if (!n) return `Sur tes ${t} tâches, aucun écart qui compte : Rémy et Motion font la même chose.`;
  const aJuger = b.ecarts.filter((e) => !e.jugement).length;
  return `${n} écart${n > 1 ? "s" : ""} qui compte${n > 1 ? "nt" : ""} sur tes ${t} tâches${aJuger ? `, ${aJuger} à juger` : ", tous jugés"}.`;
}

/** Les notes de prudence : horaires supposés, agenda absent, liste incomplète ou ancienne. */
export function notes(b, maintenant = Date.now()) {
  const out = [];
  if (b?.horairesSupposes) out.push({ alerte: true, texte: "Tes horaires Motion ne sont pas encore lus : Rémy a supposé 9 h – 18 h en semaine." });
  if (b?.agenda === "absent") out.push({ alerte: false, texte: "Agenda Google non connecté : Rémy ne voit pas tes rendez-vous." });
  if (b?.agenda === "erreur") out.push({ alerte: true, texte: "Agenda illisible pour l'instant : Rémy a planifié sans tes rendez-vous." });
  if (b?.incomplet) out.push({ alerte: true, texte: "La liste Motion est incomplète (trop de pages) : certaines tâches manquent." });
  if (Number.isFinite(b?.motionLuA) && maintenant - b.motionLuA > 15 * 60e3) out.push({ alerte: false, texte: `Tâches Motion lues il y a ${Math.round((maintenant - b.motionLuA) / 60e3)} min : Motion a pu bouger depuis.` });
  return out;
}

/** Le planning de Rémy, jour par jour (heure de la machine) : [{ jour, titre, lignes }]. */
export function parJour(placements, maintenant = Date.now()) {
  const auj = jourISO(maintenant);
  const dem = jourISO(new Date(new Date(maintenant).getFullYear(), new Date(maintenant).getMonth(), new Date(maintenant).getDate() + 1).getTime());
  const jours = new Map();
  for (const p of Array.isArray(placements) ? placements : []) {
    if (!Number.isFinite(p?.debut)) continue;
    const j = jourISO(p.debut);
    if (!jours.has(j)) jours.set(j, { jour: j, titre: j === auj ? "Aujourd'hui" : j === dem ? "Demain" : jourCourtSemaine(p.debut), lignes: [] });
    jours.get(j).lignes.push(p);
  }
  return [...jours.values()].sort((a, b) => (a.jour < b.jour ? -1 : 1)).map((j) => ({ ...j, lignes: j.lignes.sort((a, b) => a.debut - b.debut) }));
}

/** Les heures d'une ligne : « 15:25 – 18:00 », et pour une tâche en morceaux « En 2 morceaux : … ». */
export function heuresLigne(p, heureDe) {
  const m = Array.isArray(p?.morceaux) && p.morceaux.length ? p.morceaux : [{ debut: p?.debut, fin: p?.fin }];
  const premier = `${heureDe(m[0].debut)} – ${heureDe(m[0].fin)}`;
  if (m.length < 2) return { premier, suite: null };
  const autres = m.slice(1).map((x) => `${jourISO(x.debut) === jourISO(m[0].debut) ? "" : `${jourCourtSemaine(x.debut)} `}${heureDe(x.debut)} – ${heureDe(x.fin)}`);
  return { premier, suite: `En ${m.length} morceaux : puis ${autres.join(", puis ")}.` };
}

/** Les écarts à juger d'abord, puis les jugés ; l'ordre de la tour (les plus graves d'abord) dans chaque groupe. */
export const ecartsTries = (ecarts) => {
  const l = Array.isArray(ecarts) ? ecarts : [];
  return [...l.filter((e) => !e.jugement), ...l.filter((e) => e.jugement)];
};

/** Après un geste : l'écart avec son nouveau jugement (null : retiré). */
export const avecJugement = (ecarts, id, jugement) => (Array.isArray(ecarts) ? ecarts : []).map((e) => {
  if (e.id !== id) return e;
  const { jugement: _ancien, ...reste } = e;
  return jugement ? { ...reste, jugement } : reste;
});

/** « Jugé le 12 nov. : Rémy a raison » */
export const phraseJugement = (j) => (j ? `Jugé le ${dateCourte(j.a)} : ${j.verdict === "remy" ? "Rémy a raison" : "Motion a raison"}.` : null);
