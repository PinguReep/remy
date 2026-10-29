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

const F_SEMAINE_COURT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
/** « jeu. 30 oct. » (Format.jourSemaineCourt). */
export const jourSemaineCourt = (ms) => F_SEMAINE_COURT.format(new Date(ms));

// --- Prolonger : ce que ça changerait (ImpactProlongation, Accueil.swift) ---

/**
 * L'effet estimé d'une prolongation de `e` de `minutes` dans `journee` (les
 * éléments du même jour) : la nouvelle fin, le premier rendez-vous fixe qui
 * commencerait avant (et le retard), les tâches que Motion décalera. Une
 * estimation, pas une promesse : Motion recalcule la suite après coup.
 */
export function impactProlongation(e, minutes, journee) {
  const fin = finEffective(e);
  const nouvelleFin = fin + minutes * 60e3;
  const autres = (journee?.items || []).filter((x) => !(x.type === e.type && x.id === e.id));
  const apres = autres.filter((x) => x.debut >= fin - 60e3);
  // Un rendez-vous qui commence pendant la tâche compte aussi : il est déjà
  // coupé par la fin actuelle, la prolongation aggrave le retard.
  const conflit = autres.filter((x) => estRendezVous(x) && x.debut > e.debut && x.debut < nouvelleFin).sort((a, b) => a.debut - b.debut)[0] || null;
  const i = {
    nouvelleFin,
    conflit,
    retard: conflit ? Math.ceil((nouvelleFin - conflit.debut) / 60e3) : 0,
    tachesDecalees: apres.filter((x) => !estRendezVous(x)).length,
  };
  return { ...i, phrase: phraseImpact(i) };
}

/** « Fin à 11:45 : tu arriverais à « Déjeuner » 15 min en retard. C'est un rendez-vous fixe. » */
export function phraseImpact({ nouvelleFin, conflit, retard, tachesDecalees }) {
  const fin = `Fin à ${heure(nouvelleFin)}`;
  if (conflit) return `${fin} : tu arriverais à « ${conflit.titre} » ${duree(retard)} en retard. C'est un rendez-vous fixe.`;
  if (tachesDecalees > 0) return `${fin}. Aucun rendez-vous touché ; Motion décalera ${tachesDecalees > 1 ? `les ${tachesDecalees} tâches suivantes` : "la tâche suivante"}.`;
  return `${fin}. Rien d'autre n'est touché.`;
}

/** « Je pense prolonger « T » de 15 min. <phrase> Est-ce raisonnable vu la suite de ma journée ? » (Brouillons.raisonnable) */
export const brouillonRaisonnable = (e, minutes, impact) => `Je pense prolonger « ${e.titre} » de ${minutes} min. ${impact.phrase} Est-ce raisonnable vu la suite de ma journée ?`;
/** « Je voudrais déplacer « T » (HH:MM). … » (RendezVousPanneau, un rendez-vous avec d'autres). */
export const brouillonDeplacer = (e) => `Je voudrais déplacer « ${e.titre} » (${heure(e.debut)}). Quels créneaux proposes-tu, et qui faut-il prévenir ?`;

// --- « Et maintenant ? » après la tâche du moment (EtMaintenant, ChoixTache) ---

/** La prochaine tâche placée par Motion (pas un rendez-vous, pas en attente), sinon la première à faire. */
export function suivante(j, m = Date.now()) {
  const items = (j?.items || []).filter((e) => !estRendezVous(e) && e.bloquee !== true && finEffective(e) > m);
  const e = items.find((x) => etatMoment(x, m) === "avenir") ?? items[0];
  if (e) return { id: e.id, titre: e.titre, detail: heure(e.debut), duree: e.duree ?? null, item: e };
  const t = (j?.aFaire || []).find((x) => x.bloquee !== true);
  if (t) return { id: t.id, titre: t.titre, detail: "à faire aujourd'hui", duree: t.duree ?? null, item: null };
  return null;
}

/**
 * Les tâches à choisir (« Choisir… ») : aujourd'hui (placées à venir, puis à
 * faire), en retard, puis la prochaine de chaque projet cette semaine
 * (GET /api/projets), sans doublon ni tâche en attente.
 */
export function candidatsChoix(j, projets, m = Date.now()) {
  const items = j?.items || [];
  const aujourdhui = [
    ...items.filter((e) => !estRendezVous(e) && e.bloquee !== true && etatMoment(e, m) === "avenir")
      .map((e) => ({ id: e.id, titre: e.titre, detail: `${heure(e.debut)} · ${duree(dureeTotale(e))}`, duree: e.duree ?? null, item: e })),
    ...(j?.aFaire || []).filter((t) => t.bloquee !== true)
      .map((t) => ({ id: t.id, titre: t.titre, detail: t.echeance != null ? `avant ${heure(t.echeance)}` : "aujourd'hui", duree: t.duree ?? null, item: null })),
  ];
  const retard = (j?.retard?.items || []).filter((t) => t.bloquee !== true).map((t) => ({ id: t.id, titre: t.titre, detail: "en retard", duree: t.duree ?? null, item: null }));
  const vus = new Set([...aujourdhui, ...retard].map((c) => c.id).concat(items.map((e) => e.id)));
  const semaine = [];
  for (const p of projets || []) {
    const t = p?.prochaine;
    if (!t || vus.has(t.id) || t.bloquee === true) continue;
    if (t.echeance != null && t.echeance > m + 7 * 86400e3) continue;
    vus.add(t.id);
    semaine.push({ id: t.id, titre: t.titre, detail: p.nom + (t.echeance != null ? ` · ${jourSemaineCourt(t.echeance)}` : ""), duree: t.duree ?? null, item: null });
  }
  return { aujourdhui, retard, semaine };
}

// --- Les tâches cochées depuis le site (« Cochées tout à l'heure ») ---

/** La liste du jour (clé locale « remy-cochees ») : vide si elle date d'un autre jour. */
export const cocheesDuJour = (etat, jour = jourISO()) => (etat && etat.jour === jour && Array.isArray(etat.liste) ? etat.liste : []);

/**
 * La journée sans les tâches cochées (TableauModel.journee) : la tour garde
 * quelques minutes sa liste Motion, une tâche cochée ne revient pas au
 * rafraîchissement suivant.
 */
export function sansCochees(j, ids) {
  if (!j || !ids?.size) return j;
  const garder = (x) => !ids.has(x.id);
  const r = j.retard;
  let retard = r;
  if (r) {
    const items = (r.items || []).filter(garder);
    retard = { ...r, items, total: Math.max(0, (r.total ?? 0) - ((r.items || []).length - items.length)) };
  }
  return { ...j, items: (j.items || []).filter((e) => !(e.type === "tache" && ids.has(e.id))), aFaire: (j.aFaire || []).filter(garder), retard };
}

// --- Ce que disent les lignes et « Gérer » ---

/** « urgent » (ASAP), « important » (HIGH), sinon rien (LigneSuite.priorite). */
export function motPriorite(p) {
  switch (String(p || "").toUpperCase()) {
    case "ASAP":
      return "urgent";
    case "HIGH":
      return "important";
    default:
      return null;
  }
}
/** Les priorités de « Modifier », avec les mots de l'iPhone (ModifierTache.priorites). */
export const PRIORITES = [["ASAP", "Urgente"], ["HIGH", "Importante"], ["MEDIUM", "Normale"], ["LOW", "Basse"]];

/** Une ligne du planning : « en cours · lieu · projet · catégories · durée · urgent » (LigneSuite.detail). */
export function detailLigne(e, m = Date.now(), noms = []) {
  const bits = etatMoment(e, m) === "encours" ? ["en cours"] : [];
  if (e.lieu) bits.push(e.lieu);
  if (e.projet) bits.push(e.projet);
  bits.push(...noms);
  if (!estRendezVous(e)) bits.push(duree(dureeTotale(e)));
  const p = motPriorite(e.priorite);
  if (p) bits.push(p);
  return bits.join(" · ");
}

/** Une tâche sans créneau : « avant 18:00 » (entre 5 h et 20 h), en retard « prévue le 25 oct. », projet, catégories, priorité (LigneTache.detail). */
export function detailTache(t, { enRetard = false, noms = [] } = {}) {
  const bits = [];
  if (t.echeance != null) {
    if (enRetard) bits.push(`prévue le ${jourCourt(t.echeance)}`);
    else {
      const hh = new Date(t.echeance).getHours();
      if (hh < 20 && hh >= 5) bits.push(`avant ${heure(t.echeance)}`);
    }
  }
  if (t.projet) bits.push(t.projet);
  bits.push(...noms);
  const p = motPriorite(t.priorite);
  if (p) bits.push(p);
  return bits.join(" · ");
}

/** « En attente · J'attends le devis » (MarqueBloquee). */
export const marqueBloquee = (raison) => (raison ? `En attente · ${raison}` : "En attente");

/** « Et 3 autres en retard. » quand la tour n'envoie pas toutes les lignes. */
export function plusEnRetard(retard) {
  const n = (retard?.total ?? 0) - (retard?.items?.length ?? 0);
  if (n > 1) return `Et ${n} autres en retard.`;
  if (n === 1) return "Et une autre en retard.";
  return null;
}

/** Gérer : « 10:15 – 11:30 · il reste 50 min · 1 h 15 au total », « Demain · … » un autre jour (GererPanneau.horaires). */
export function horairesTache(e, m = Date.now()) {
  const bits = [`${heure(e.debut)} – ${heure(finEffective(e))}`];
  const j = autreJour(e.debut, m);
  if (j) bits.unshift(j);
  if (etatMoment(e, m) === "encours") bits.push(`il reste ${duree(Math.max(0, Math.ceil((finEffective(e) - m) / 60e3)))}`);
  bits.push(`${duree(dureeTotale(e))} au total`);
  return bits.join(" · ");
}

/** Gérer d'une tâche sans créneau : « En retard · prévue le 20 oct. · 30 min » ou « Pas encore placée par Motion · avant 18:00 · 30 min ». */
export function quandSansCreneau(e) {
  const bits = [];
  if (e.retard) bits.push(`En retard${e.echeance != null ? ` · prévue le ${jourCourt(e.echeance)}` : ""}`);
  else {
    bits.push("Pas encore placée par Motion");
    if (e.echeance != null) bits.push(`avant ${heure(e.echeance)}`);
  }
  if (e.duree) bits.push(duree(e.duree));
  return bits.join(" · ");
}

/** Gérer d'une activité ou d'un rendez-vous : « 09:00 – 09:45 · lieu · faite » (ou « · en cours »). */
export function horairesRendezVous(e, m = Date.now()) {
  const bits = [`${heure(e.debut)} – ${heure(finEffective(e))}`];
  const j = autreJour(e.debut, m);
  if (j) bits.unshift(j);
  if (e.lieu) bits.push(e.lieu);
  if (e.fait === true) bits.push("faite");
  else if (etatMoment(e, m) === "encours") bits.push("en cours");
  return bits.join(" · ");
}

/** Le lien de l'agenda Google à ce jour (« Ouvrir l'agenda à ce jour »). */
export const lienAgendaJour = (ms) => {
  const d = new Date(ms);
  return `https://calendar.google.com/calendar/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

/** La page date-t-elle d'un autre jour ? (Jour.estPerimee) L'afficher tromperait. */
export const estPerimee = (j, maintenant = Date.now()) => Boolean(j?.jour) && j.jour !== jourISO(maintenant);
