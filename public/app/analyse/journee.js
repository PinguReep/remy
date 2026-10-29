// La journée d'Aujourd'hui, sans IA ni réseau : ce que l'iPhone calcule sur
// place (Logique.swift, Accueil.swift, Modeles.swift, AgendaVues.swift,
// Panneaux.swift) porté mot pour mot, pour que le site et l'app disent la
// même chose. Module pur, sans DOM : importé par le site et par les tests node
// (test/site-journee.test.mjs reprend les cas des tests Swift).

const pad = (n) => String(n).padStart(2, "0");

/** « 09:05 » (Format.heure, heure de la machine). */
export const heure = (ms) => {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** « 45 min », « 1 h 05 », « 2 h » (Format.duree). */
export function duree(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${pad(r)}`;
}

const F_JOUR_COURT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
/** « 25 oct. » (Format.jourCourt). */
export const jourCourt = (ms) => F_JOUR_COURT.format(new Date(ms));

/** « 29/10/2026 · Journée » : le titre du fil du jour, le même que l'iPhone (Fils.journee). */
export const titreFilJournee = (d = new Date()) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} · Journée`;

/**
 * Les phrases que Rémy reçoit quand Sam touche une ligne de sa journée
 * (Brouillons, Modeles.swift). Préparées dans le composeur, jamais envoyées
 * sans un geste.
 */
export const BROUILLONS = {
  journee: "Organise ma journée : regarde mon agenda et mes tâches, dis-moi par quoi commencer et ce qui est en retard. Pose tes questions d'un coup si tu en as.",
  retards: "Qu'est-ce qui est en retard, et par quoi je commence ?",
  rendezVous: (e) => `Aide-moi à préparer « ${e.titre} » (${heure(e.debut)}).`,
  tache: (titre) => `Aide-moi à avancer sur « ${titre} ».`,
  retard: (t) => `« ${t.titre} » est en retard${t.echeance != null ? ` depuis le ${jourCourt(t.echeance)}` : ""}. Qu'est-ce que je fais ?`,
  menacee: (t) => `« ${t.titre} » est menacée : ${t.phrase} Trouve-lui un créneau avant son échéance, sans toucher à mes rendez-vous.`,
};
