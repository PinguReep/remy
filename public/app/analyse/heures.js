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
//
// La frise se parcourt (12/11, second lot) : elle va d'aujourd'hui, début de
// la journée utile (7 h, ou plus tôt si quelque chose y est), jusqu'à demain
// soir (22 h, ou plus tard) — ce que /api/semaine?jours=2 couvre. Le passé de
// la journée y est : rendez-vous passés, tâches cochées (par Rémy : le journal
// de la tour, à leur créneau quand il a été gardé, sinon à l'heure de la
// coche), et tâches dont le créneau est passé sans coche. Hier n'y est pas :
// la tour ne lit la semaine qu'à partir de minuit. La géométrie (échelle,
// couloirs, zones tactiles, centrage), le seuil glisser/clic, l'inertie et la
// liaison frise ↔ liste sont ici, testés sous node.
import { heure, duree, finEffective, estRendezVous, estActivite, jourISO, jourCourtSemaine } from "./journee.js";
import { couloirs } from "./semaine.js";

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
 * `cochees` : les tâches cochées ici, pas encore parties (Set d'ids) ;
 * `cocheesA` : l'heure de chaque coche d'ici (Map id → ms), si on l'a.
 *
 * `lignes` : ce qui reste à faire, de maintenant à demain midi (la liste
 * « prochaines heures » et ses tranches). `toutes` : tout ce que montre la
 * frise, passé compris, fait compris, sur `plage`.
 */
export function prochainesHeures({ semaine, priorites = [], maintenant = Date.now(), cochees = new Set(), cocheesA = new Map() } = {}) {
  const fin = horizon(maintenant);
  const rangs = rangsParProjet(priorites);
  const jours = (semaine?.jours || []).filter((j) => j && typeof j.jour === "string" && j.jour >= jourISO(maintenant) && j.jour <= jourISO(a(maintenant, 1, 12)));

  // Tous les éléments placés (une tâche à cheval sur minuit : une seule fois), puis ce qui a été coché par Rémy.
  const parCle = new Map();
  const tousItems = [];
  for (const j of jours) {
    for (const e of j.items || []) {
      if (!e || typeof e.debut !== "number" || !e.id) continue;
      tousItems.push(e);
      const cle = `${e.type}:${e.id}`;
      if (!parCle.has(cle)) parCle.set(cle, { e, fait: e.fait === true || (e.type === "tache" && cochees.has(e.id)), faitA: e.faitA ?? (e.type === "tache" ? cocheesA.get(e.id) ?? null : null) });
    }
  }
  for (const j of jours) {
    for (const x of j.faites || []) {
      if (!x?.id || typeof x.a !== "number") continue;
      const cle = `tache:${x.id}`;
      const deja = parCle.get(cle);
      if (deja) {
        deja.fait = true;
        deja.faitA = deja.faitA ?? x.a;
        continue;
      }
      const creneau = typeof x.debut === "number" && typeof x.fin === "number" && x.fin > x.debut;
      parCle.set(cle, {
        e: { type: "tache", id: x.id, titre: x.titre, projet: x.projet ?? null, duree: x.duree ?? null, debut: creneau ? x.debut : x.a, fin: creneau ? x.fin : x.a },
        fait: true, faitA: x.a, ponctuel: !creneau, journal: true,
      });
    }
  }
  const plage = plageFrise(maintenant, [...parCle.values()].map((v) => v.e));
  const toutes = [];
  for (const [cle, v] of parCle) {
    const l = ligneDe(cle, v, { maintenant, rangs });
    if (l.fin < plage.debut || l.debut > plage.fin || (!l.ponctuel && l.fin <= plage.debut)) continue;
    toutes.push(l);
  }
  toutes.sort((x, y) => x.debut - y.debut || (x.type === "rdv" ? -1 : 1));

  // Ce qui reste à faire, de maintenant à demain midi.
  const lignes = toutes.filter((l) => !l.fait && l.fin > maintenant && l.debut < fin);

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
      if (!t?.id || dejaDit.has(t.id) || cochees.has(t.id) || parCle.get(`tache:${t.id}`)?.fait) continue;
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
  const passees = toutes.filter((l) => l.etat === "passe" || l.fait);
  return {
    debut: maintenant, fin, lignes, tranches, neRentrePas, toute,
    enCours, ensuite,
    vide: !lignes.length && !neRentrePas.length,
    rienDuTout: !toutes.length && !neRentrePas.length,
    notes: notesHeures(semaine, priorites),
    plage, toutes,
    groupes: groupesDe(toutes, maintenant, plage),
    bilanPasse: {
      faites: passees.filter((l) => l.fait).length,
      pasCochees: passees.filter((l) => l.issue === "pasCochee").length,
      total: passees.length,
    },
  };
}

/** Une ligne de la feuille : ce qu'elle est, où elle en est, et pourquoi elle est là. */
function ligneDe(cle, { e, fait = false, faitA = null, ponctuel = false, journal = false }, { maintenant, rangs }) {
  const finL = ponctuel ? e.debut : finEffective(e);
  const etat = finL <= maintenant && !(ponctuel && e.debut > maintenant) ? "passe" : e.debut <= maintenant ? "encours" : "avenir";
  const rdv = e.type === "rdv";
  // Passée sans coche : une tâche dont le créneau est fini (Motion la replacera), une activité à soi pas cochée.
  const issue = fait ? "faite" : etat === "passe" && (!rdv || estActivite(e)) ? "pasCochee" : null;
  const faits = faitsDe(e, { maintenant, rangs });
  const cocheeA = typeof faitA === "number" && jourISO(faitA) === jourISO(maintenant) ? heure(faitA) : null;
  let statut = null;
  if (fait) statut = ponctuel ? `Cochée à ${cocheeA || heure(e.debut)} dans Rémy (son créneau n'était pas gardé)` : cocheeA ? `Faite · cochée à ${cocheeA}` : "Faite";
  else if (issue === "pasCochee") statut = rdv ? "Passée, pas cochée" : "Créneau passé, pas cochée : Motion la replacera";
  else if (etat === "passe") statut = "Passé";
  return {
    cle, type: e.type, id: e.id, titre: String(e.titre || "(sans titre)"),
    projet: e.projet ?? null, projetId: e.projetId ?? null, lieu: e.lieu ?? null,
    debut: e.debut, fin: finL, duree: e.duree ?? null,
    enCours: !fait && etat === "encours",
    etat, fait, faitA: faitA ?? null, ponctuel, issue, statut,
    rang: e.projetId ? rangs.get(e.projetId)?.rang ?? null : null,
    menace: !fait && etat !== "passe" && faits.some((x) => x.genre === "menace"),
    rien: faits[0].genre === "rien",
    faits, pourquoi: pourquoi(faits),
    // Ce que « Gérer » reçoit : l'élément tel que la tour l'a donné. Une coche
    // lue dans le journal n'est plus chez Motion : rien à gérer, l'Historique l'annule.
    source: journal ? null : e,
    gerable: !journal && !(fait && !rdv),
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
  // L'inverse : la position (0..1) → l'heure (un clic sur la frise).
  const temps = (x) => {
    const w = Math.min(Math.max(x, 0), 1) * total;
    if (!nuit) return debut + w * MIN;
    const avant = (nuit.debut - debut) / MIN;
    if (w <= avant) return debut + w * MIN;
    if (w <= avant + NUIT_POIDS) return nuit.debut + ((w - avant) / NUIT_POIDS) * (nuit.fin - nuit.debut);
    return nuit.fin + (w - avant - NUIT_POIDS) * MIN;
  };
  const heures = [];
  // Les heures rondes, de la première (le bord gauche, si la frise commence à l'heure pile) à la dernière.
  const premiere = new Date(debut).getMinutes() || new Date(debut).getSeconds() ? a(debut, 0, new Date(debut).getHours() + 1) : debut;
  for (let t = premiere; t < fin; t = a(t, 0, new Date(t).getHours() + 1)) {
    if (nuit && t > nuit.debut && t < nuit.fin) continue;
    const h = new Date(t).getHours();
    heures.push({ ms: t, x: pos(t), libelle: `${h}h`, majeure: h % 3 === 0 });
  }
  return { pos, temps, minutes: total, nuit: nuit ? { ...nuit, x0: pos(nuit.debut), x1: pos(nuit.fin) } : null, heures };
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

// --- La frise qui se parcourt (12/11, second lot) ---

const HEURE = 60 * MIN;
export const DEBUT_UTILE_H = 7;
export const FIN_UTILE_H = 22;

const plancherHeure = (ms) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
};
const plafondHeure = (ms) => {
  const p = plancherHeure(ms);
  return p === ms ? ms : a(p, 0, new Date(p).getHours() + 1);
};

/**
 * La plage de la frise : aujourd'hui dès 7 h (plus tôt si quelque chose y
 * est, ou si on y est), jusqu'à demain 22 h (plus tard si quelque chose y
 * finit), à l'heure ronde ; jamais avant minuit, jamais au-delà de demain
 * minuit — ce que /api/semaine?jours=2 couvre.
 */
export function plageFrise(maintenant = Date.now(), items = []) {
  const borne0 = a(maintenant, 0, 0);
  const borne1 = a(maintenant, 2, 0);
  let debut = Math.min(a(maintenant, 0, DEBUT_UTILE_H), plancherHeure(maintenant));
  let fin = a(maintenant, 1, FIN_UTILE_H);
  for (const e of items) {
    if (!e || typeof e.debut !== "number") continue;
    const f = Math.max(e.debut, finEffective(e) ?? e.debut);
    if (f < borne0 || e.debut >= borne1) continue;
    debut = Math.min(debut, plancherHeure(Math.max(e.debut, borne0)));
    fin = Math.max(fin, plafondHeure(Math.min(f, borne1)));
  }
  return { debut: Math.max(borne0, debut), fin: Math.min(borne1, fin) };
}

/** « Aujourd'hui dès 7 h, jusqu'à demain 22 h » : la plage, dite. */
export function phrasePlage(plage, maintenant = Date.now()) {
  const hh = (ms) => {
    const d = new Date(ms);
    return d.getMinutes() ? heure(ms) : `${d.getHours()} h`;
  };
  const fin = jourISO(plage.fin) === jourISO(a(maintenant, 2, 0)) && new Date(plage.fin).getHours() === 0 ? "demain minuit" : `demain ${hh(plage.fin)}`;
  return `Aujourd'hui dès ${hh(plage.debut)}, jusqu'à ${fin}`;
}

/**
 * Les groupes de la liste : les tranches d'aujourd'hui et de demain sur la
 * plage, chacune avec ses lignes (par heure de début) et son état.
 * Ce qui est passé (ou fait) est à part (`passees`) : la liste s'ouvre sur ce
 * qui vient, le passé se déplie.
 */
export function groupesDe(toutes, maintenant, plage) {
  const defs = [
    [0, "matin", "Ce matin", 0, 12], [0, "apresmidi", "Cet après-midi", 12, 18], [0, "soir", "Ce soir", 18, 24],
    [1, "demain", "Demain matin", 0, 12], [1, "demainApresmidi", "Demain après-midi", 12, 18], [1, "demainSoir", "Demain soir", 18, 24],
  ];
  const tranches = defs.map(([j, id, titre, h0, h1]) => ({ id, titre, debut: Math.max(a(maintenant, j, h0), plage.debut), fin: Math.min(a(maintenant, j, h1), plage.fin) }))
    .filter((t) => t.fin > t.debut)
    .map((t) => ({ ...t, etat: t.fin <= maintenant ? "passe" : t.debut <= maintenant ? "encours" : "avenir" }));
  const dans = (l) => tranches.find((t) => Math.max(l.debut, plage.debut) < t.fin) || tranches[tranches.length - 1];
  const passe = (l) => l.fait || l.etat === "passe";
  // Ce qui est en cours va dans la tranche de maintenant (commencé avant midi, en cours à 12 h 10 : « Cet après-midi »).
  const courante = tranches.find((t) => t.etat === "encours");
  const groupe = (l) => (l.enCours && courante ? courante : dans(l));
  const aVenir = tranches.map((t) => ({ ...t, lignes: toutes.filter((l) => !passe(l) && groupe(l) === t) })).filter((t) => t.lignes.length);
  const passees = tranches.map((t) => ({ ...t, lignes: toutes.filter((l) => passe(l) && dans(l) === t) })).filter((t) => t.lignes.length);
  return { aVenir, passees };
}

/**
 * La géométrie en pixels : `pxParHeure` (la nuit resserrée vaut une heure).
 * Rend la largeur totale, x(ms) et ms(x), les repères d'heures, le
 * changement de jour, maintenant, et chaque bloc : sa place visible, sa zone
 * de clic (≥ `cible` px, sans empiéter sur un voisin), son couloir (deux
 * éléments qui se chevauchent sont l'un au-dessus de l'autre) et ce que son
 * étiquette peut dire à cette largeur.
 */
export function friseDe(toutes, plage, maintenant, { pxParHeure = 120, cible = 44, ponctuelPx = 20 } = {}) {
  const g = echelleFrise(toutes.filter((l) => !l.ponctuel), plage.debut, plage.fin);
  const total = Math.round((g.minutes / 60) * pxParHeure);
  const x = (t) => g.pos(t) * total;
  const temps = (px) => g.temps(px / total);
  // Les couloirs : sur l'étendue visible (une coche sans créneau occupe sa petite marque).
  const etendue = (l) => {
    if (!l.ponctuel) return { debut: Math.max(l.debut, plage.debut), fin: Math.min(l.fin, plage.fin) };
    const m = (ponctuelPx / pxParHeure) * 30 * MIN;
    return { debut: l.debut - m, fin: l.debut + m };
  };
  const places = couloirs(toutes.map((l) => ({ type: l.type, id: l.id, ...etendue(l) })));
  const blocs = toutes.map((l) => {
    const e = etendue(l);
    let x0 = x(e.debut);
    let x1 = Math.max(x(e.fin), x0 + 4);
    if (l.ponctuel) {
      const c = x(l.debut);
      x0 = c - ponctuelPx / 2;
      x1 = c + ponctuelPx / 2;
    }
    const p = places.get(l.cle) || { index: 0, total: 1 };
    return { cle: l.cle, x0, x1, couloir: p.index, couloirs: p.total };
  });
  // Les zones de clic : au moins `cible` de large autour du bloc, sans dépasser la mi-chemin
  // d'un voisin du même étage ; bloquée d'un côté, la zone s'étend de l'autre.
  const chevauche = (b, o) => b.couloir / b.couloirs < (o.couloir + 1) / o.couloirs && o.couloir / o.couloirs < (b.couloir + 1) / b.couloirs;
  for (const b of blocs) {
    let gauche = 0;
    let droite = total;
    for (const o of blocs) {
      if (o === b || !chevauche(b, o)) continue;
      if (o.x1 <= b.x0) gauche = Math.max(gauche, (o.x1 + b.x0) / 2);
      else if (o.x0 >= b.x1) droite = Math.min(droite, (b.x1 + o.x0) / 2);
    }
    const voulu = Math.max(cible, b.x1 - b.x0);
    const c = (b.x0 + b.x1) / 2;
    let h0 = c - voulu / 2;
    let h1 = c + voulu / 2;
    if (h1 > droite) {
      h0 -= h1 - droite;
      h1 = droite;
    }
    if (h0 < gauche) {
      h1 = Math.min(droite, h1 + (gauche - h0));
      h0 = gauche;
    }
    b.hit0 = Math.max(0, Math.min(h0, b.x0));
    b.hit1 = Math.min(total, Math.max(h1, b.x1));
    const largeur = b.x1 - b.x0;
    b.etiquette = largeur >= 108 && b.couloirs === 1 ? "complete" : largeur >= 56 ? "titre" : largeur >= 18 ? "icone" : null;
  }
  const minuit = a(maintenant, 1, 0);
  const xm = maintenant >= plage.debut && maintenant <= plage.fin ? x(maintenant) : null;
  // L'étiquette d'une heure (« 14h », posée à droite de son trait, ~26 px) ne passe pas sous la pastille
  // de maintenant (« 14:20 », ~48 px centrée) : elle est masquée (son trait reste).
  const sousPastille = (px) => xm != null && px + 4 + 26 > xm - 26 && px + 4 < xm + 26;
  return {
    total, x, temps, nuit: g.nuit ? { x0: g.nuit.x0 * total, x1: g.nuit.x1 * total } : null,
    heures: g.heures.map((r) => ({ ...r, x: r.x * total, masque: sousPastille(r.x * total) })),
    demain: minuit > plage.debut && minuit < plage.fin ? x(minuit) : null,
    maintenant: xm,
    blocs, parCle: new Map(blocs.map((b) => [b.cle, b])),
  };
}

/** Le défilement qui met `px` au milieu d'une vue large de `largeurVue` (borné à la frise). */
export function defilementPour(px, largeurVue, total) {
  return Math.round(Math.min(Math.max(0, px - largeurVue / 2), Math.max(0, total - largeurVue)));
}

/** Ce qu'il y a à l'heure `t` : la ligne qui la couvre (exact), sinon la suivante, sinon la dernière avant. */
export function ligneA(toutes, t, { pres = 10 * MIN } = {}) {
  const dedans = toutes.filter((l) => (l.ponctuel ? Math.abs(l.debut - t) <= pres : l.debut <= t && t < l.fin));
  if (dedans.length) {
    // Ce qui reste à faire d'abord, puis le plus précis (commencé le plus tard).
    dedans.sort((x, y) => Number(x.fait) - Number(y.fait) || y.debut - x.debut || (x.type === "rdv" ? -1 : 1));
    return { ligne: dedans[0], exact: true, sens: null };
  }
  const apres = toutes.filter((l) => l.debut > t).sort((x, y) => x.debut - y.debut)[0];
  if (apres) return { ligne: apres, exact: false, sens: "apres" };
  const avant = toutes.filter((l) => l.fin <= t).sort((x, y) => y.fin - x.fin)[0];
  return avant ? { ligne: avant, exact: false, sens: "avant" } : null;
}

/** La phrase d'un moment touché sur la frise : ce qui s'y passe, ou ce qui vient. */
export function phraseMoment(t, r) {
  const h0 = heure(t);
  if (!r) return `${h0} · rien de prévu`;
  const l = r.ligne;
  const titre = `« ${l.titre} »`;
  if (r.exact) return l.ponctuel ? `${h0} · ${titre}, ${l.statut ? l.statut.charAt(0).toLowerCase() + l.statut.slice(1) : "cochée"}` : `${h0} · ${titre} (${heure(l.debut)} – ${heure(l.fin)})${l.fait ? ", faite" : ""}`;
  if (r.sens === "apres") return `${h0} · rien de prévu ; ensuite ${titre} à ${heure(l.debut)}`;
  return `${h0} · plus rien après ${titre} (fini à ${heure(l.fin)})`;
}

/** La ligne de départ (focus et sélection par défaut) : celle en cours, sinon la prochaine, sinon la dernière. */
export function ligneCourante(toutes, maintenant) {
  const restent = toutes.filter((l) => !l.fait);
  return restent.find((l) => l.enCours) || restent.find((l) => l.debut > maintenant) || toutes[toutes.length - 1] || null;
}

/** La voisine dans l'ordre du temps (flèches sur un bloc) : `sens` = -1 ou +1. */
export function voisine(toutes, cle, sens) {
  const i = toutes.findIndex((l) => l.cle === cle);
  if (i < 0) return toutes[0] || null;
  return toutes[Math.min(toutes.length - 1, Math.max(0, i + sens))] || null;
}

// --- Le geste : glisser n'est pas cliquer ---

/** Seuil de déplacement : au-delà, c'est un glisser (jamais un clic, ni une fermeture). Le doigt tremble plus que la souris. */
export const SEUIL_SOURIS_PX = 6;
export const SEUIL_DOIGT_PX = 10;
export const estGlisser = (dx, dy, type = "mouse") => Math.hypot(dx, dy) >= (type === "mouse" ? SEUIL_SOURIS_PX : SEUIL_DOIGT_PX);

/** La vitesse au lâcher (px/ms), sur les 100 dernières ms ; immobile avant de lâcher : 0. Bornée à 3 px/ms. */
export function vitesseRelachee(echantillons, lache) {
  const recents = (echantillons || []).filter((e) => lache - e.t <= 100);
  if (recents.length < 2) return 0;
  const p = recents[0];
  const d = recents[recents.length - 1];
  if (lache - d.t > 60 || d.t <= p.t) return 0;
  const v = (d.x - p.x) / (d.t - p.t);
  return Math.max(-3, Math.min(3, v));
}

/** L'inertie : un pas de `dt` ms à la vitesse `v` (px/ms), freinée ; s'arrête sous 0,02 px/ms. */
export const FROTTEMENT = 0.93; // par tranche de 16 ms
export function pasInertie(v, dt) {
  const v2 = v * Math.pow(FROTTEMENT, dt / 16);
  return { dx: ((v + v2) / 2) * dt, v: Math.abs(v2) < 0.02 ? 0 : v2 };
}

