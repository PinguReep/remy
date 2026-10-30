// Le conseil du moment, sans IA : le port fidèle de `Conseil.pour`
// (ios-native/RemyCore/Sources/RemyCore/Accueil.swift) et de `ConseilAffiche`
// (ios-native/Remy/Vues/ConseilVue.swift). Une ou deux phrases tirées de la
// journée telle qu'elle est, lisibles en cinq secondes, avec leur
// « pourquoi ». Le conseil réfléchi de la tour (modèle local) passe devant
// seulement s'il est à jour ; sinon c'est celui-ci, calculé ici.
// Module pur : importé par le site et par les tests node (test/site-conseil.test.mjs
// reprend les cas d'AccueilTests.swift).
import { heure, duree, depuis, finEffective, etatMoment, estRendezVous, dureeTotale, minutesEntamees, sourcesAucune, sourcesEnPanne } from "./journee.js";

/** Les quatre conseils que Sam peut choisir (TypeConseil). */
export const TYPES_CONSEIL = [
  { id: "maintenant", libelle: "Maintenant" },
  { id: "prochaine", libelle: "Prochaine tâche" },
  { id: "libre", libelle: "Temps libre" },
  { id: "priorites", libelle: "Priorités" },
];

const urgente = (t) => ["ASAP", "HIGH"].includes(String(t.priorite || "").toUpperCase());
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const lieu = (e) => (e.lieu ? ` (${e.lieu})` : "");
const ensuite = (e) => (e ? ` Ensuite : « ${e.titre} » à ${heure(e.debut)}${lieu(e)}.` : "");

/**
 * Une tâche à glisser dans un temps libre : urgente, importante, ou due
 * aujourd'hui à une heure donnée. Sinon rien (pas de « douche » à avancer).
 */
export const aProposer = (aFaire) => aFaire.find(urgente) ?? aFaire.find((t) => t.echeance != null) ?? null;

function raison(t) {
  switch (String(t.priorite || "").toUpperCase()) {
    case "ASAP":
      return `« ${t.titre} » est urgente`;
    case "HIGH":
      return `« ${t.titre} » est importante`;
    default:
      return t.echeance != null ? `« ${t.titre} » est due avant ${heure(t.echeance)}` : `« ${t.titre} » est à faire aujourd'hui`;
  }
}

/**
 * Le conseil calculé ici, par règles : { texte, pourquoi }, ou null sans
 * journée lisible (rien de branché, tout en panne).
 */
export function conseilPour(type, j, m = Date.now()) {
  if (!j || sourcesAucune(j.sources || {}) || sourcesEnPanne(j.sources || {})) return null;
  const items = j.items || [];
  const avenir = items.filter((e) => etatMoment(e, m) === "avenir");
  const enCours = items.find((e) => etatMoment(e, m) === "encours") || null;
  // Une tâche marquée bloquée n'est jamais proposée.
  const aFaire = (j.aFaire || []).filter((t) => t.bloquee !== true);
  const enRetard = (j.retard?.items || []).filter((t) => t.bloquee !== true);
  const prochainFixe = avenir.find(estRendezVous) || null;
  switch (type) {
    case "prochaine": {
      const s = avenir[0];
      if (!s) return { texte: "Plus rien de prévu à heure fixe aujourd'hui.", pourquoi: ["Aucun élément à venir dans ta journée"] };
      let texte = `Prochain : « ${s.titre} » à ${heure(s.debut)}${lieu(s)}, dans ${duree(minutesEntamees(s.debut - m))}.`;
      if (!estRendezVous(s)) texte += ` Motion lui a donné ${duree(dureeTotale(s))}.`;
      const pourquoi = [estRendezVous(s) ? `Rendez-vous fixe à ${heure(s.debut)}` : `Tâche placée par Motion à ${heure(s.debut)}`];
      if (enCours) pourquoi.push(`« ${enCours.titre} » se termine à ${heure(finEffective(enCours))}`);
      return { texte, pourquoi };
    }
    case "libre": {
      const depuisMs = Math.max(m, enCours ? finEffective(enCours) : m);
      const f = prochainFixe;
      if (!f) return { texte: "Aucun rendez-vous fixe d'ici ce soir : ton temps est à toi, Motion place tes tâches.", pourquoi: ["Pas de rendez-vous à venir aujourd'hui"] };
      const libre = minutesEntamees(f.debut - depuisMs);
      if (libre < 15) return { texte: `Pas vraiment de temps libre avant « ${f.titre} » à ${heure(f.debut)}.`, pourquoi: [`${duree(libre)} entre maintenant et ce rendez-vous`] };
      let texte = `${duree(libre)} de libre avant « ${f.titre} » (${heure(f.debut)}).`;
      const pourquoi = [`Rendez-vous fixe à ${heure(f.debut)}${lieu(f)}`];
      const x = aProposer(aFaire);
      if (x) {
        texte += ` De quoi avancer « ${x.titre} ».`;
        pourquoi.push(raison(x));
      }
      return { texte, pourquoi };
    }
    case "priorites": {
      const urgentes = aFaire.filter(urgente);
      const bouts = [];
      const pourquoi = [];
      if (urgentes.length) {
        bouts.push(`D'abord ${urgentes.slice(0, 2).map((t) => `« ${t.titre} »`).join(" et ")}.`);
        const s = urgentes.length > 1 ? "s" : "";
        pourquoi.push(`${urgentes.length} tâche${s} urgente${s} ou importante${s}`);
      } else {
        const x = aFaire.find((t) => t.echeance != null);
        if (x) {
          bouts.push(`D'abord « ${x.titre} », due avant ${heure(x.echeance)}.`);
          pourquoi.push("Échéance aujourd'hui");
        }
      }
      const r = j.retard;
      if (r && r.total > 0 && enRetard[0]) {
        bouts.push(`${r.total} en retard : commence par « ${enRetard[0].titre} ».`);
        pourquoi.push(`${pluriel(r.total, "tâche")} en retard`);
      }
      if (!bouts.length) return { texte: "Rien d'urgent aujourd'hui : suis le planning de Motion.", pourquoi: ["Aucune tâche urgente, importante ou en retard"] };
      return { texte: bouts.join(" "), pourquoi };
    }
    default:
      return conseilMaintenant(j, { enCours, avenir, aFaire, enRetard, m });
  }
}

function conseilMaintenant(j, { enCours: e, avenir, aFaire, enRetard, m }) {
  if (e) {
    const fin = finEffective(e);
    if (estRendezVous(e)) return { texte: `« ${e.titre} » jusqu'à ${heure(fin)}.${ensuite(avenir[0])}`, pourquoi: ["Rendez-vous en cours"] };
    const phrase = `Il te reste ${duree(minutesEntamees(fin - m))} sur « ${e.titre} ».`;
    // Un rendez-vous fixe commence avant la fin prévue : c'est ça qu'il faut savoir.
    const r = avenir.find((x) => estRendezVous(x) && x.debut < fin);
    if (r) {
      return {
        texte: `${phrase} Attention : « ${r.titre} » commence à ${heure(r.debut)}, avant la fin prévue.`,
        pourquoi: [`Tâche en cours jusqu'à ${heure(fin)}`, `Rendez-vous fixe à ${heure(r.debut)}`],
      };
    }
    return { texte: phrase + ensuite(avenir[0]), pourquoi: [`Tâche en cours jusqu'à ${heure(fin)}`] };
  }
  const s = avenir[0];
  if (s) {
    const libre = minutesEntamees(s.debut - m);
    const t = aProposer(aFaire);
    if (libre >= 15 && t) {
      return {
        texte: `${duree(libre)} devant toi avant « ${s.titre} » (${heure(s.debut)}). De quoi avancer « ${t.titre} ».`,
        pourquoi: [`${duree(libre)} avant le prochain élément`, raison(t)],
      };
    }
    if (libre >= 15) return { texte: `${duree(libre)} devant toi avant « ${s.titre} » à ${heure(s.debut)}${lieu(s)}.`, pourquoi: [`${duree(libre)} avant le prochain élément`] };
    return { texte: `Prochain : « ${s.titre} » à ${heure(s.debut)}${lieu(s)}.`, pourquoi: [`Commence dans ${duree(libre)}`] };
  }
  if (aFaire[0]) {
    const autres = aFaire.length - 1;
    return {
      texte: `Plus rien à heure fixe. Reste à faire : « ${aFaire[0].titre} »${autres > 0 ? ` et ${pluriel(autres, "autre")}.` : "."}`,
      pourquoi: ["Plus de créneau fixe aujourd'hui", `${pluriel(aFaire.length, "tâche")} à faire`],
    };
  }
  const r = j.retard;
  if (r && r.total > 0 && enRetard[0]) {
    return { texte: `Journée dégagée. ${pluriel(r.total, "tâche")} en retard : commence par « ${enRetard[0].titre} ».`, pourquoi: [`${pluriel(r.total, "tâche")} en retard`] };
  }
  return { texte: "Plus rien de prévu aujourd'hui.", pourquoi: ["Journée terminée dans Motion et ton agenda"] };
}

/**
 * Le conseil « maintenant » de la tour arrive par deux chemins : le tableau et
 * GET /api/conseil. Chacun : { reponse, recuA } ou null. On garde le plus
 * récemment généré ; à genereA égal, la réponse reçue en dernier, seule à dire
 * si ce conseil est encore à jour (sinon un « aJour » d'il y a une heure le
 * garderait « réfléchi » au-delà des 20 min).
 */
export function conseilLePlusRecent(tableau, lu) {
  if (!tableau?.reponse || !lu?.reponse) return tableau?.reponse || lu?.reponse || null;
  const gt = tableau.reponse.conseil?.genereA ?? 0;
  const gl = lu.reponse.conseil?.genereA ?? 0;
  if (gt !== gl) return gt > gl ? tableau.reponse : lu.reponse;
  return (tableau.recuA ?? 0) >= (lu.recuA ?? 0) ? tableau.reponse : lu.reponse;
}

/** Le conseil de la tour s'il vaut encore : réfléchi par le modèle local, à jour, ou de moins de 20 min (ConseilAffiche.glm). */
export function conseilReflechi(tour, m = Date.now()) {
  const c = tour?.conseil;
  if (!c || c.source !== "glm" || !c.texte) return null;
  if (tour.aJour === true) return c;
  if (c.genereA == null || m - c.genereA >= 20 * 60e3) return null;
  return c;
}

/** D'où vient le conseil affiché (ConseilAffiche.source, « l'iPhone » devenu « ici »). */
export function ligneSource({ glm, tour, disponible, tourne, maintenant = Date.now() }) {
  if (glm) {
    const quand = glm.genereA != null ? ` · ${depuis(glm.genereA, maintenant).replace("de ", "à ")}` : "";
    return `Réfléchi par Rémy (sur tes machines)${quand}${tourne ? " · il réfléchit à nouveau…" : ""}`;
  }
  if (tourne) return "Calculé ici en attendant : Rémy réfléchit…";
  if (!disponible) return "Calculé ici, sans IA (le conseil réfléchi arrivera avec la mise à jour de ta tour).";
  if (tour?.raison) return `Calculé ici, sans IA. ${tour.raison}`;
  return "Calculé ici, sans IA.";
}

/** Ce que Rémy a regardé, en mots simples (ConseilAffiche.faits). */
export function faitsConseil(j, m = Date.now()) {
  if (!j) return [];
  const f = [];
  const items = j.items || [];
  const e = items.find((x) => etatMoment(x, m) === "encours");
  if (e) f.push(`En cours : « ${e.titre} » jusqu'à ${heure(finEffective(e))}`);
  const r = items.find((x) => estRendezVous(x) && etatMoment(x, m) === "avenir");
  if (r) f.push(`Prochain rendez-vous fixe : « ${r.titre} » à ${heure(r.debut)}`);
  const aFaire = (j.aFaire || []).filter((t) => t.bloquee !== true);
  if (aFaire.length) f.push(`${pluriel(aFaire.length, "tâche")} à faire aujourd'hui sans créneau`);
  if (j.retard?.total > 0) f.push(`${pluriel(j.retard.total, "tâche")} en retard`);
  const bloquees = (j.aFaire || []).filter((t) => t.bloquee === true).length + items.filter((x) => x.bloquee === true).length;
  if (bloquees > 0) f.push(`${bloquees} en attente (jamais proposée${bloquees > 1 ? "s" : ""})`);
  return f;
}
