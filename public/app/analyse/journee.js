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

const F_SEMAINE = new Intl.DateTimeFormat("fr-FR", { weekday: "long" });
const F_JOUR_LONG = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** « Jeudi 29 octobre » (Format.jourTitre). */
export const jourTitre = (ms) => majuscule(F_JOUR_LONG.format(new Date(ms)));
/** « Lun 26 » (JourSemaine.titreCourt). */
export const jourCourtSemaine = (ms) => `${majuscule(F_SEMAINE.format(new Date(ms))).slice(0, 3)} ${new Date(ms).getDate()}`;
/** « 2026-10-29 » : le jour tel que la tour l'écrit (journee.jour), heure de la machine. */
export const jourISO = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const debutJour = (ms) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** « de 13:20 », « d'hier, 13:20 », « du 25 oct., 13:20 » (Format.depuis). */
export function depuis(ms, maintenant = Date.now()) {
  const debut = debutJour(maintenant);
  if (ms >= debut) return `de ${heure(ms)}`;
  if (ms >= debut - 86400e3) return `d'hier, ${heure(ms)}`;
  return `du ${jourCourt(ms)}, ${heure(ms)}`;
}

/** « Demain », « Lun 26 » ; null aujourd'hui (Format.autreJour : Gérer ouvert depuis les 7 jours). */
export function autreJour(ms, maintenant = Date.now()) {
  const j = debutJour(ms);
  const auj = debutJour(maintenant);
  if (j === auj) return null;
  const demain = new Date(auj);
  demain.setDate(demain.getDate() + 1);
  if (j === demain.getTime()) return "Demain";
  return jourCourtSemaine(j);
}

// --- Les éléments de la journée (ElementJour, Logique.swift) ---
export const finEffective = (e) => e.fin ?? (e.debut != null ? e.debut + 30 * 60e3 : null);
/** Passé, en cours, à venir (Jour.etat) : recalculé avec l'heure de la machine. */
export const etatMoment = (e, m) => (finEffective(e) <= m ? "passe" : e.debut <= m ? "encours" : "avenir");
export const estRendezVous = (e) => e.type === "rdv";
/** Une activité à soi, à heure fixe dans l'agenda (« Aspirateur »), pas un vrai rendez-vous. */
export const estActivite = (e) => e.type === "rdv" && e.avecAutres !== true;
/** La référence de « 50 min restantes sur 1 h 15 » : la durée Motion, à défaut celle du créneau. */
export const dureeTotale = (e) => e.duree ?? Math.max(1, Math.round((finEffective(e) - e.debut) / 60e3));
/** Des millisecondes en minutes entamées, au moins 1 (Conseil.minutes). */
export const minutesEntamees = (ms) => Math.max(1, Math.ceil(ms / 60e3));

/** Rien de branché (ni Motion ni l'agenda) : pas une panne (Sources.aucune). */
export const sourcesAucune = (s = {}) => s.motion !== "ok" && s.agenda !== "ok" && s.motion !== "erreur" && s.agenda !== "erreur";
/** Branché, mais rien ne répond en ce moment (Sources.enPanne). */
export const sourcesEnPanne = (s = {}) => s.motion !== "ok" && s.agenda !== "ok" && (s.motion === "erreur" || s.agenda === "erreur");
/** La journée se lit-elle ? (ni rien de branché, ni tout en panne) */
export const lisible = (j) => Boolean(j) && !sourcesAucune(j.sources || {}) && !sourcesEnPanne(j.sources || {});

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
  conseil: (texte) => `Tu me conseilles : « ${texte} » Explique-moi, ou propose autre chose si tu vois mieux.`,
};
