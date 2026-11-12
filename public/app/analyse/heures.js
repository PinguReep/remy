// « Prochaines heures » (12/11) : de maintenant à demain midi, ce que Sam va
// faire, dans l'ordre où Motion l'a placé, et pour chaque ligne UNE phrase de
// « pourquoi » tirée des faits que l'on a — jamais d'une raison inventée.
//
// Motion ne dit pas pourquoi il a mis A avant B (aucun champ « raison » dans
// son API) : on n'explique donc pas son calcul, on dit ce que ses données
// montrent de chaque ligne (rendez-vous fixe, échéance ferme, priorité Motion,
// date « pas avant », menacée…) et, quand la tâche appartient à un projet
// Motion relié à une priorité classée, « sert ta priorité n°k ». Quand rien
// ne la distingue, on le dit.
//
// Tout vient de GET /api/semaine?jours=2 (Motion et l'agenda lus par la tour,
// sans IA) et de GET /api/priorites (le classement de Sam, priorites-v2).
// Module pur, sans DOM : importé par le site et par les tests node
// (test/site-heures.test.mjs). Heures de la machine, comme le reste du site.
import { heure, duree, finEffective, estRendezVous, jourISO, jourCourtSemaine } from "./journee.js";

const MIN = 60e3;
const SEMAINE_MS = 7 * 86400e3;

/** `h:m` le jour de `ms` décalé de `jours` (heure de la machine). */
const a = (ms, jours, h, m = 0) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + jours, h, m).getTime();
};

/** Demain midi : là où s'arrête la feuille. */
export const horizon = (maintenant = Date.now()) => a(maintenant, 1, 12);

/**
 * Les tranches qui restent : ce matin (avant midi), cet après-midi (avant
 * 18 h), ce soir (jusqu'à minuit), demain matin (jusqu'à midi). Celles déjà
 * passées n'y sont pas ; la première commence maintenant.
 */
export function tranchesDe(maintenant = Date.now()) {
  const midi = a(maintenant, 0, 12);
  const soir = a(maintenant, 0, 18);
  const minuit = a(maintenant, 1, 0);
  const t = [];
  if (maintenant < midi) t.push({ id: "matin", titre: "Ce matin", debut: maintenant, fin: midi });
  if (maintenant < soir) t.push({ id: "apresmidi", titre: "Cet après-midi", debut: Math.max(maintenant, midi), fin: soir });
  t.push({ id: "soir", titre: "Ce soir", debut: Math.max(maintenant, soir), fin: minuit });
  t.push({ id: "demain", titre: "Demain matin", debut: minuit, fin: horizon(maintenant) });
  return t;
}

/** « aujourd'hui à 17:00 », « demain à 09:00 », « lun 16 à 18:00 ». */
export function quand(ms, maintenant = Date.now()) {
  const j = jourISO(ms);
  if (j === jourISO(maintenant)) return `aujourd'hui à ${heure(ms)}`;
  if (j === jourISO(a(maintenant, 1, 0))) return `demain à ${heure(ms)}`;
  if (j === jourISO(a(maintenant, -1, 0))) return `hier à ${heure(ms)}`;
  return `${jourCourtSemaine(ms).toLowerCase()} à ${heure(ms)}`;
}

/**
 * Le classement CONFIRMÉ de Sam, par projet Motion relié : identifiant →
 * { rang, titre }. Seules les priorités qu'il a confirmées (`classee`) ont un
 * rang, leur place parmi elles (la n°1 passe devant la n°2) ; une priorité
 * seulement écrite, ou une proposition de Rémy, n'en a pas. Deux priorités
 * reliées au même projet : la mieux classée.
 */
export const classeesDe = (priorites) => (Array.isArray(priorites) ? priorites : []).filter((p) => p?.classee === true);
export function rangsParProjet(priorites) {
  const rangs = new Map();
  classeesDe(priorites).forEach((p, i) => {
    const id = typeof p?.projetMotion === "string" ? p.projetMotion : null;
    if (id && !rangs.has(id)) rangs.set(id, { rang: i + 1, titre: String(p.titre || "") });
  });
  return rangs;
}

/**
 * Les faits d'une ligne, du plus fort au plus doux : { genre, texte }.
 * genre : fixe, menace, priorite, echeance, motion, debut, attente, rien.
 */
export function faitsDe(e, { maintenant = Date.now(), rangs = new Map() } = {}) {
  if (estRendezVous(e)) {
    return [{ genre: "fixe", texte: e.avecAutres === true ? "Rendez-vous à heure fixe, avec d'autres : Motion place le reste autour" : "À heure fixe dans ton agenda : Motion place le reste autour" }];
  }
  const f = [];
  const ech = typeof e.echeance === "number" ? e.echeance : null;
  if (e.apresEcheance === true && ech != null) f.push({ genre: "menace", texte: `Menacée : Motion la finit après son échéance (${quand(ech, maintenant)})` });
  else if (e.retard === true && ech != null) f.push({ genre: "menace", texte: `En retard : elle était due ${quand(ech, maintenant)}` });
  const lie = e.projetId ? rangs.get(e.projetId) : null;
  if (lie) f.push({ genre: "priorite", texte: `Sert ta priorité n°${lie.rang}${lie.titre ? ` (« ${lie.titre} »)` : ""}` });
  if (ech != null && e.apresEcheance !== true && e.retard !== true && e.deadlineType !== "NONE") {
    // Une échéance lointaine et souple ne dit rien de ce créneau-ci : on ne s'en sert pas.
    const ferme = e.deadlineType === "HARD";
    if (ferme) f.push({ genre: "echeance", texte: `Échéance ferme ${quand(ech, maintenant)}` });
    else if (ech - maintenant <= SEMAINE_MS) f.push({ genre: "echeance", texte: `Due ${quand(ech, maintenant)}` });
  }
  if (e.priorite === "ASAP") f.push({ genre: "motion", texte: "Priorité Motion : au plus vite" });
  else if (e.priorite === "HIGH") f.push({ genre: "motion", texte: "Priorité Motion : haute" });
  if (typeof e.startOn === "string" && typeof e.debut === "number" && e.startOn === jourISO(e.debut)) {
    const jour = e.startOn === jourISO(maintenant) ? "aujourd'hui" : e.startOn === jourISO(a(maintenant, 1, 0)) ? "demain" : `le ${jourCourtSemaine(e.debut).toLowerCase()}`;
    f.push({ genre: "debut", texte: `Pas avant ${jour} : sa date de début dans Motion` });
  }
  if (e.bloquee === true) f.push({ genre: "attente", texte: e.raison ? `En attente : ${e.raison}` : "En attente" });
  if (!f.length) f.push({ genre: "rien", texte: "Rien ne la distingue : Motion l'a mise là" });
  return f;
}

/** La ligne de « pourquoi » : les faits, en une phrase. */
export const pourquoi = (faits) => faits.map((x) => x.texte).join(" · ");

/** Les minutes d'une tâche dans [debut, fin] : au prorata de sa durée Motion si elle est étalée (comme la charge de la tour). */
function minutesDans(e, debut, fin) {
  const d = Math.max(e.debut, debut);
  const f = Math.min(finEffective(e), fin);
  if (f <= d) return 0;
  const etale = (finEffective(e) - e.debut) / MIN;
  const part = (f - d) / MIN;
  return typeof e.duree === "number" && e.duree > 0 && etale > e.duree ? (part * e.duree) / etale : part;
}

/** La longueur d'une réunion d'intervalles (deux rendez-vous qui se chevauchent comptent une fois). */
function longueurReunie(intervalles) {
  const tries = intervalles.filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
  let total = 0;
  let cour = null;
  for (const [x, y] of tries) {
    if (cour && x <= cour[1]) cour[1] = Math.max(cour[1], y);
    else {
      if (cour) total += cour[1] - cour[0];
      cour = [x, y];
    }
  }
  if (cour) total += cour[1] - cour[0];
  return total / MIN;
}

const cleProjet = (e) => (e.projetId ? `id:${e.projetId}` : e.projet ? `nom:${e.projet}` : "sans");

/** Une réponse de /api/semaine qu'on sait lire (sinon : « réponse illisible »). */
export const semaineLisible = (s) => Boolean(s) && typeof s === "object" && Array.isArray(s.jours);

/**
 * Tout ce que montre la feuille. `semaine` : GET /api/semaine?jours=2 ;
 * `priorites` : la liste de GET /api/priorites (null : illisible) — seul le
 * classement confirmé y compte : sans lui, aucune ligne ne dit « sert ta
 * priorité n°k » (jamais une hypothèse présentée comme un fait) ;
 * `cochees` : les tâches cochées ici, pas encore parties.
 */
export function prochainesHeures({ semaine, priorites = [], maintenant = Date.now(), cochees = new Set() } = {}) {
  const fin = horizon(maintenant);
  const rangs = rangsParProjet(priorites);
  const jours = (semaine?.jours || []).filter((j) => j && typeof j.jour === "string" && j.jour >= jourISO(maintenant) && j.jour <= jourISO(fin));

  // Les lignes : rendez-vous et tâches placées qui ne sont pas finies avant maintenant ni après demain midi.
  const vus = new Set();
  const lignes = [];
  const tousItems = [];
  for (const j of jours) {
    for (const e of j.items || []) {
      if (!e || typeof e.debut !== "number" || !e.id) continue;
      tousItems.push(e);
      const cle = `${e.type}:${e.id}`;
      if (vus.has(cle)) continue; // une tâche à cheval sur minuit : une seule ligne
      if (e.fait === true || (e.type === "tache" && cochees.has(e.id))) continue;
      if (finEffective(e) <= maintenant || e.debut >= fin) continue;
      vus.add(cle);
      const faits = faitsDe(e, { maintenant, rangs });
      lignes.push({
        cle, type: e.type, id: e.id, titre: String(e.titre || "(sans titre)"),
        projet: e.projet ?? null, projetId: e.projetId ?? null, lieu: e.lieu ?? null,
        debut: e.debut, fin: finEffective(e), duree: e.duree ?? null,
        enCours: e.debut <= maintenant,
        rang: e.projetId ? rangs.get(e.projetId)?.rang ?? null : null,
        menace: faits.some((x) => x.genre === "menace"),
        rien: faits[0].genre === "rien",
        faits, pourquoi: pourquoi(faits),
      });
    }
  }
  lignes.sort((x, y) => x.debut - y.debut || (x.type === "rdv" ? -1 : 1));

  // Par tranche : les lignes qui y commencent (celle en cours dans la première), et les minutes par projet.
  const tranches = tranchesDe(maintenant).map((t, k) => {
    const ici = lignes.filter((l) => (l.enCours ? k === 0 : l.debut >= t.debut && l.debut < t.fin));
    const projets = new Map();
    const rdv = [];
    for (const l of lignes) {
      if (l.type === "rdv") {
        rdv.push([Math.max(l.debut, t.debut), Math.min(l.fin, t.fin)]);
        continue;
      }
      const m = minutesDans(l, t.debut, t.fin);
      if (m <= 0) continue;
      const c = cleProjet(l);
      const p = projets.get(c) || { cle: c, nom: l.projet || "Sans projet", minutes: 0, rang: l.rang };
      p.minutes += m;
      projets.set(c, p);
    }
    const liste = [...projets.values()].map((p) => ({ ...p, minutes: Math.round(p.minutes) })).filter((p) => p.minutes > 0)
      .sort((x, y) => y.minutes - x.minutes || (x.rang ?? 99) - (y.rang ?? 99) || x.nom.localeCompare(y.nom, "fr"));
    return { ...t, lignes: ici, projets: liste, minutesTaches: liste.reduce((n, p) => n + p.minutes, 0), minutesRdv: Math.round(longueurReunie(rdv)) };
  });

  // Ce qui ne rentre pas avant demain midi, d'après Motion lui-même : due d'ici là,
  // et pas placée, ou placée après son échéance. Rien n'est supposé.
  const finDe = new Map(tousItems.filter((e) => e.type === "tache").map((e) => [e.id, finEffective(e)]));
  const neRentrePas = [];
  const dejaDit = new Set();
  for (const j of jours) {
    for (const t of [...(j.echeances || []).filter((x) => x?.menacee === true), ...(j.deborde || []).map((x) => ({ ...x, placee: true }))]) {
      if (!t?.id || dejaDit.has(t.id) || cochees.has(t.id)) continue;
      if (typeof t.echeance !== "number" || t.echeance < maintenant || t.echeance > fin) continue;
      dejaDit.add(t.id);
      const placee = t.placee === true;
      const finT = t.fin ?? finDe.get(t.id) ?? null;
      neRentrePas.push({
        id: t.id, titre: String(t.titre || "(sans nom)"), echeance: t.echeance, projet: t.projet ?? null,
        texte: placee
          ? `Due ${quand(t.echeance, maintenant)} : Motion la finit après${finT ? `, ${quand(finT, maintenant)}` : ""}`
          : `Due ${quand(t.echeance, maintenant)} : Motion ne l'a pas encore placée`,
      });
    }
  }
  neRentrePas.sort((x, y) => x.echeance - y.echeance);

  const toute = [];
  for (const j of jours) for (const e of j.toute || []) if (e?.titre && !toute.includes(e.titre)) toute.push(e.titre);

  const enCours = lignes.find((l) => l.enCours) || null;
  const ensuite = lignes.find((l) => !l.enCours) || null;
  return {
    debut: maintenant, fin, lignes, tranches, neRentrePas, toute,
    enCours, ensuite,
    vide: !lignes.length && !neRentrePas.length,
    notes: notesHeures(semaine, priorites),
  };
}

/** Ce qui manque pour dire tout : une source absente ou en panne, un classement illisible, pas confirmé ou sans lien. */
export function notesHeures(semaine, priorites) {
  const notes = [];
  const s = semaine?.sources || {};
  if (s.motion === "off") notes.push({ texte: "Motion n'est pas relié à ta tour : seuls tes rendez-vous apparaissent ici.", alerte: false });
  else if (s.motion === "erreur") notes.push({ texte: "Motion n'a pas répondu : des tâches peuvent manquer. Rafraîchis dans un instant.", alerte: true });
  if (s.agenda === "erreur") notes.push({ texte: "L'agenda n'a pas répondu : des rendez-vous peuvent manquer.", alerte: true });
  if (priorites === null) notes.push({ texte: "Ton classement n'a pas pu être lu : « sert ta priorité » n'apparaît pas cette fois.", alerte: false });
  else if (s.motion === "off") {
    // Sans Motion, aucune tâche à relier : rien à demander.
  } else if (!classeesDe(priorites).length) {
    notes.push({ texte: "Ton classement n'est pas encore confirmé : Rémy en propose un dans Ce qui compte. D'ici là, aucune ligne ne dit quelle priorité elle sert.", alerte: false, reglage: true });
  } else if (!classeesDe(priorites).some((p) => typeof p.projetMotion === "string")) {
    notes.push({ texte: "Aucune priorité de ton classement n'est reliée à un projet Motion : relie-les dans Ce qui compte, chaque ligne dira laquelle elle sert.", alerte: false, reglage: true });
  }
  return notes;
}

/** « 2 h 05 », « 45 min ». */
export const minutesLisibles = (m) => duree(m);

/** « Boutiques 1 h 30 · Sans projet 45 min · rendez-vous 1 h » ; « Rien de placé » sinon. */
export function phraseTranche(t) {
  const bits = t.projets.map((p) => `${p.nom} ${duree(p.minutes)}`);
  if (t.minutesRdv > 0) bits.push(`rendez-vous ${duree(t.minutesRdv)}`);
  return bits.length ? bits.join(" · ") : "Rien de placé";
}

/** « 10:47 – 12:00 » (la tranche en cours commence maintenant). */
export const heuresTranche = (t) => `${heure(t.debut)} – ${t.id === "soir" ? "minuit" : heure(t.fin)}`;

// --- La frise : de maintenant à demain midi, la nuit resserrée ---

const NUIT_MIN = 3 * 60; // un creux de nuit plus court ne se resserre pas
const NUIT_POIDS = 60; // une nuit resserrée occupe la place d'une heure

/**
 * La géométrie de la frise : `pos(ms)` → 0..1 ; la nuit sans rien (entre
 * 23 h et 7 h, le plus long creux d'au moins 3 h) resserrée à la place d'une
 * heure ; les repères d'heures (hors nuit) et les tranches.
 */
export function echelleFrise(lignes, debut, fin) {
  const n0 = Math.max(debut, a(debut, 0, 23));
  const n1 = Math.min(fin, a(debut, 1, 7));
  let nuit = null;
  if (n1 - n0 >= NUIT_MIN * MIN) {
    // Le plus long creux de la fenêtre de nuit, sans aucune ligne dedans.
    const occupe = lignes.map((l) => [Math.max(l.debut, n0), Math.min(l.fin, n1)]).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
    let curseur = n0;
    let meilleur = null;
    for (const [x, y] of [...occupe, [n1, n1]]) {
      if (x - curseur > (meilleur ? meilleur[1] - meilleur[0] : 0)) meilleur = [curseur, x];
      curseur = Math.max(curseur, y);
    }
    if (meilleur && meilleur[1] - meilleur[0] >= NUIT_MIN * MIN) nuit = { debut: meilleur[0], fin: meilleur[1] };
  }
  const poids = (t) => {
    // Les minutes « dessinées » de debut à t.
    const x = Math.min(Math.max(t, debut), fin);
    if (!nuit || x <= nuit.debut) return (x - debut) / MIN;
    const avant = (nuit.debut - debut) / MIN;
    if (x <= nuit.fin) return avant + (NUIT_POIDS * (x - nuit.debut)) / (nuit.fin - nuit.debut);
    return avant + NUIT_POIDS + (x - nuit.fin) / MIN;
  };
  const total = Math.max(1, poids(fin));
  const pos = (t) => poids(t) / total;
  const heures = [];
  for (let t = a(debut, 0, new Date(debut).getHours() + 1); t < fin; t = a(t, 0, new Date(t).getHours() + 1)) {
    if (nuit && t > nuit.debut && t < nuit.fin) continue;
    const h = new Date(t).getHours();
    heures.push({ ms: t, x: pos(t), libelle: `${h}h`, majeure: h % 3 === 0 });
  }
  return { pos, nuit: nuit ? { ...nuit, x0: pos(nuit.debut), x1: pos(nuit.fin) } : null, heures };
}

/** La phrase d'en tête : ce qui est en cours, et ce qui vient ensuite. */
export function phraseTete(v, maintenant = Date.now()) {
  if (!v || v.vide) return null;
  const bits = [];
  if (v.enCours) bits.push(`En ce moment : « ${v.enCours.titre} », jusqu'à ${heure(v.enCours.fin)}`);
  if (v.ensuite) bits.push(`ensuite : « ${v.ensuite.titre} » ${jourISO(v.ensuite.debut) === jourISO(maintenant) ? `à ${heure(v.ensuite.debut)}` : quand(v.ensuite.debut, maintenant)}`);
  if (!bits.length) return null;
  const s = bits.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}
