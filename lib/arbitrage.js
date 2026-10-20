// Tâche Motion, ou rendez-vous Google ? La question se pose à chaque fois que
// Rémy touche au planning, et se tromper coûte cher dans les deux sens.
//
// Ce que dit la VRAIE structure d'une tâche Motion (vérifié sur le compte de
// Sam, pas déduit d'une doc) :
//
//   duration, dueDate, deadlineType (SOFT | HARD), startOn, priority
//   scheduledStart / scheduledEnd  ← DÉCIDÉS PAR MOTION, en lecture seule
//
// Autrement dit : une tâche Motion porte une ÉCHÉANCE et une DURÉE, jamais une
// heure de début. `startOn` est une DATE (« pas avant ce jour-là »), pas une
// heure. `scheduledStart` est le résultat du calcul de Motion, pas une consigne.
// Il n'existe donc AUCUN moyen d'épingler une tâche Motion à 15h00.
//
// Conséquence, et c'est toute la règle : tout ce qui a une heure imposée dans la
// vraie vie doit aller dans l'agenda Google. Ce n'est pas un contournement —
// c'est là que Motion lit les créneaux occupés pour caser le reste.

import { PRENOM } from "./profil.js";

// Champs qui n'existent que pour un rendez-vous. Si le modèle en glisse un dans
// une action Motion, ce n'est pas une faute de frappe : il s'est trompé d'outil.
const CHAMPS_EVENEMENT = ["debut", "heure", "fin", "lieu"];

// « 15h », « 15h30 », « 15:30 », « 9 h 30 » — une heure d'horloge annoncée dans
// le nom. Pas « 30 min » ni « 2h de travail » (une durée, pas un horaire).
const HEURE = /(?:^|[\s(à«,'’-])(?:[01]?\d|2[0-3])\s?(?:h(?:\s?[0-5]\d)?\b|:[0-5]\d\b)/i;
const DUREE = /\b(?:pendant|durée|dure|environ|~)\s*$/i;

export function nomAvecHeure(nom) {
  const t = String(nom || "");
  const m = t.match(HEURE);
  if (!m) return false;
  // « pendant 2h » parle de durée, pas d'un créneau.
  return !DUREE.test(t.slice(0, m.index + 1));
}

// Une échéance à une heure ronde en pleine journée ressemble à un rendez-vous.
// Motion, lui, pose ses échéances de journée à 23:59:59 locales.
export function echeanceSuspecte(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const h = d.getUTCHours();
  const min = d.getUTCMinutes();
  if (h >= 20 || h < 5) return false; // fin de journée : une vraie échéance
  return min === 0 || min === 30;
}

// Rend la liste des avertissements pour UNE action Motion. Jamais bloquant sur
// une simple présomption : Sam garde le dernier geste, on l'informe.
export function verifierActionMotion(action) {
  const avis = [];
  if (!action || typeof action !== "object") return avis;

  const intrus = CHAMPS_EVENEMENT.filter((c) => action[c] !== undefined && action[c] !== null && action[c] !== "");
  if (intrus.length) {
    avis.push({
      gravite: "bloquant",
      message:
        `Une tâche Motion n'a pas de ${intrus.join(" ni de ")} : elle a une échéance et une durée, ` +
        `et c'est Motion qui choisit le créneau. Un horaire imposé va dans l'agenda.`,
    });
  }
  if (action.type !== "creer") return avis;

  if (nomAvecHeure(action.nom)) {
    avis.push({
      gravite: "avertissement",
      message: `« ${action.nom} » annonce une heure précise. Si c'est un rendez-vous, il va dans l'agenda — Motion replanifierait la tâche ailleurs.`,
    });
  } else if (action.echeance && echeanceSuspecte(action.echeance)) {
    avis.push({
      gravite: "avertissement",
      message: `L'échéance tombe à une heure ronde en pleine journée. Une échéance dit « au plus tard », pas « à cette heure-là » : si l'heure est imposée, c'est un rendez-vous.`,
    });
  }
  return avis;
}

export function verifierPropositionMotion(actions) {
  const tous = (Array.isArray(actions) ? actions : []).flatMap((a, i) =>
    verifierActionMotion(a).map((v) => ({ ...v, index: i, nom: a?.nom || a?.id || "" })),
  );
  return {
    avis: tous,
    bloquants: tous.filter((v) => v.gravite === "bloquant"),
  };
}

// Le bloc de consignes injecté dans le prompt de Rémy. Ici plutôt qu'en dur dans
// chat.js : la règle et son test vivent au même endroit.
export const CONSIGNE_ARBITRAGE = `## Tâche Motion ou rendez-vous d'agenda ?

C'est l'arbitrage que tu fais le plus souvent. Il n'est pas cosmétique : une
tâche Motion ne PEUT PAS être épinglée à une heure. Sa structure est
« durée + échéance + priorité », et c'est Motion qui choisit le créneau, puis le
recalcule tout seul quand le planning bouge. Mettre un rendez-vous dans Motion,
c'est donc accepter qu'il soit déplacé — ${PRENOM} raterait son dentiste.

Le test en une phrase : **si quelqu'un d'autre attend ${PRENOM} à cette heure-là, ou
si le monde extérieur impose l'horaire, c'est un RENDEZ-VOUS.**

RENDEZ-VOUS → agenda_proposer (heure de début + durée)
- médecin, dentiste, coiffeur, garagiste
- appel, visio, réunion, déjeuner avec quelqu'un
- train, avion, trajet à horaire fixe
- créneau que ${PRENOM} veut bloquer pour être sûr d'être libre
- cours, séance, spectacle, tout ce qui commence sans lui

TÂCHE → motion_proposer (durée + échéance + priorité)
- « rappeler le podologue » (l'heure, c'est Motion qui la trouve)
- préparer, rédiger, comparer, trier, relire
- démarches administratives, résiliations
- courses, ménage, sport sans horaire imposé
- « avant vendredi » = une échéance, pas un horaire

Trois pièges à connaître :
1. Un même sujet peut donner LES DEUX : « préparer la démo » (tâche) et « démo
   chez le client jeudi 14h » (rendez-vous). Une seule proposition par
   réponse : propose l'un, annonce l'autre, et propose-le au tour suivant.
2. Une échéance n'est pas un horaire. « Rendre le dossier avant 13h » est une
   tâche à échéance 13h. « Remise du dossier en main propre à 13h » est un
   rendez-vous.
3. Quand tu crées un rendez-vous, regarde s'il rend une tâche Motion impossible
   (plus de créneau avant l'échéance) et dis-le à ${PRENOM} dans le même message.

Dans le doute, demande — mais une seule fois, et pose la question en même temps
que tout le reste dont tu as besoin.`;
