// Les gestes sur une tâche ou une activité de l'agenda (« Gérer » de
// l'iPhone, GererPanneau et RendezVousPanneau) : Terminer (bandeau « Annuler »
// 2 s, rien ne part avant ; sans réseau, la coche attend dans la file d'envoi
// avec sa clé), Commencer maintenant ou Remettre à sa place, Décaler (les
// choix de Ergonomie.swift), Prolonger en deux gestes (choisir +N min montre
// d'abord ce que ça change, puis un bouton confirme), En attente (avec sa
// raison), catégorie, Modifier. Une activité à soi se coche et se décoche ;
// un rendez-vous avec d'autres ne se modifie jamais d'un geste. Motion fait
// foi ; chaque écriture porte un identifiant et s'annule depuis le bandeau.
// Les tâches cochées d'ici restent listées dans la journée (« Cochées tout à
// l'heure », clé locale remy-cochees) avec leur « Annuler ».
import { api, ecrire, nouvelId, seg, sait, natureEchec, tourJoignable } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, feuille, heure, quand, duree, isoLocal, versChampDate, depuisChampDate, occupe, demanderTexte, texteErreur, local } from "../ui.js";
import { couleurProjet } from "../couleurs.js";
import * as fileEnvoi from "../file-envoi.js";
import { BROUILLONS, PRIORITES, impactProlongation, brouillonRaisonnable, brouillonDeplacer, horairesTache, quandSansCreneau, horairesRendezVous, marqueBloquee, lienAgendaJour, cocheesDuJour, jourISO, etatMoment, dureeTotale } from "../analyse/journee.js";

const DELAI_ANNULATION = 2000;

// --- Les choix de « Décaler » (port de Decaler, Ergonomie.swift) ---
const debutJour = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const plusJours = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const echeanceDans = (jours, depuis = new Date()) => {
  const j = plusJours(debutJour(depuis), jours);
  return new Date(j.getFullYear(), j.getMonth(), j.getDate(), 23, 0);
};
export function joursJusquaLundi(d) {
  const n = (1 - d.getDay() + 7) % 7;
  return n === 0 ? 7 : n;
}
/** Au quart d'heure supérieur. */
export function arrondi(d) {
  const t = new Date(Math.floor(d.getTime() / 1000) * 1000);
  const reste = (t.getMinutes() % 15) * 60 + t.getSeconds();
  return reste === 0 ? t : new Date(t.getTime() + (15 * 60 - reste) * 1000);
}
/** Une tâche Motion ne se décale QUE par son échéance : Motion choisit l'heure. */
export function choixTache(echeance, maintenant = new Date()) {
  const choix = [];
  if (echeance != null && echeance < maintenant.getTime()) choix.push({ id: "aujourdhui", libelle: "Aujourd'hui", date: echeanceDans(0, maintenant) });
  choix.push({ id: "demain", libelle: "Demain", date: echeanceDans(1, maintenant) });
  const lundi = joursJusquaLundi(maintenant);
  if (lundi > 1) choix.push({ id: "lundi", libelle: "Lundi", date: echeanceDans(lundi, maintenant) });
  else choix.push({ id: "semaine", libelle: "Dans 1 sem.", date: echeanceDans(7, maintenant) });
  if (echeance == null) return choix;
  const apres = choix.filter((c) => c.date.getTime() > echeance);
  return apres.length ? apres : [{ id: "plus-7", libelle: "+1 sem.", date: echeanceDans(7, new Date(echeance)) }];
}
/** Une activité à soi se décale à l'heure : +15 min, +1 h, ce soir, demain même heure. */
export function choixActivite(e, maintenant = new Date()) {
  const debut = new Date(e.debut);
  const base = debut > maintenant ? debut : maintenant;
  const choix = [
    { id: "plus-15", libelle: "+15 min", date: arrondi(new Date(base.getTime() + 15 * 60e3)) },
    { id: "plus-60", libelle: "+1 h", date: arrondi(new Date(base.getTime() + 3600e3)) },
  ];
  const soir = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate(), 19, 0);
  if (soir.getTime() > base.getTime() + 3600e3) choix.push({ id: "ce-soir", libelle: "Ce soir", date: soir });
  choix.push({ id: "demain", libelle: "Demain", date: plusJours(debut, 1) });
  return choix;
}

const finEffective = (e) => e.fin ?? (e.debut != null ? e.debut + 30 * 60e3 : null);
/** « d'ici demain », « d'ici lundi », et « avant ce soir » le jour même (pas « d'ici aujourd'hui »). */
const dici = (date, maintenant = new Date()) => (debutJour(date).getTime() === debutJour(maintenant).getTime() ? "avant ce soir" : `d'ici ${quand(date.getTime(), { avecHeure: false })}`);
const estActivite = (e) => e.type === "rdv" && e.avecAutres !== true;
const estTache = (e) => e.type === "tache" || e.type === "sans-creneau";

// --- Les écritures ---
/** Le texte d'une erreur sans son point final (la phrase en remet un). */
const raisonDe = (err) => texteErreur(err).replace(/[.\s]+$/, "");

async function appliquer(source, action, resume) {
  const chemin = source === "agenda" ? "/api/google/apply" : "/api/motion/apply";
  const r = await ecrire(chemin, { actions: [action], resume, idCommande: nouvelId() }, { delai: 150000 });
  const res = r?.results?.[0];
  if ((r?.echecs ?? 0) > 0 || res?.ok === false) {
    const erreur = res?.erreur || "raison inconnue";
    // « n'existe plus » (404, 410) : réessayer ne peut pas marcher ; on relira l'écran.
    const introuvable = /\((404|410)\)|n'existe plus|introuvable/i.test(erreur);
    throw Object.assign(new Error(erreur), { nature: "refus", statut: introuvable ? 404 : 0 });
  }
  return r;
}
async function defaire(source, ledgerId, titre, apres) {
  try {
    const r = await ecrire(source === "agenda" ? "/api/google/undo" : "/api/motion/undo", { id: ledgerId });
    dire(r?.ok === false ? "Annulation incomplète : vérifie ton planning." : `« ${titre} » : remis comme avant.`, { genre: r?.ok === false ? "erreur" : "succes" });
  } catch (err) {
    direErreur(err, null, "Pas annulé");
  }
  apres?.();
}
const annulable = (source, r, titre, apres) => (r?.ledgerId ? { libelle: "Annuler", faire: () => defaire(source, r.ledgerId, titre, apres) } : null);

// --- Les tâches cochées d'ici (« Cochées tout à l'heure ») ---
// La liste du jour : { jour, liste: [{ id, titre, ledgerId, a, envoi, idCommande, defaire? }] },
// envoi : « fait » (Motion l'a), « attente » (dans la file, jamais tentée),
// « tentee » (partie sans réponse nette : elle repart avec la même clé).
// Pendant les 2 s du bandeau, rien n'est écrit : elles vivent en mémoire.
// En route (envoi direct, ou la file qui l'envoie) : la ligne tourne, et
// « Annuler » ne peut plus la retenir : elle est défaite dès son arrivée
// (defaire), où que soit Sam (le suivi de la file part au démarrage, main.js).
const CLE_COCHEES = "remy-cochees";
const enDelai = new Map(); // id → { id, titre, a, renoncer }
const enCoursCochee = new Set(); // ids dont l'envoi ou l'annulation tourne
const aDefaire = new Set(); // « Annuler » touché pendant l'envoi : défaite dès qu'elle est arrivée
const abonnesCochees = new Set();
const lireCochees = () => cocheesDuJour(local.lire(CLE_COCHEES, null), jourISO());
function ecrireCochees(liste) {
  local.ecrire(CLE_COCHEES, { jour: jourISO(), liste });
  prevenirCochees();
}
const prevenirCochees = () => abonnesCochees.forEach((f) => {
  try {
    f();
  } catch {}
});
function majCochee(id, changement) {
  const liste = lireCochees();
  const i = liste.findIndex((c) => c.id === id);
  if (i < 0) return;
  liste[i] = { ...liste[i], ...changement };
  ecrireCochees(liste);
}
const retirerCochee = (id) => ecrireCochees(lireCochees().filter((c) => c.id !== id));
/** La file d'envoi est en train d'envoyer cette coche (sa requête est partie). */
const enVolFile = (c) => Boolean(c.idCommande) && (c.envoi === "attente" || c.envoi === "tentee") && fileEnvoi.enEnvoi(c.idCommande);
/** « Annuler » touché pendant l'envoi (ici ou sur une autre vue) : à défaire maintenant qu'elle est arrivée. */
function doitDefaire(id) {
  const demande = aDefaire.delete(id);
  return demande || Boolean(lireCochees().find((x) => x.id === id)?.defaire);
}

/** Les cochées du jour, celles du délai d'abord vues comme « délai ». */
export const cochees = {
  liste: () => [...lireCochees().map((c) => ({ ...c, enCours: enCoursCochee.has(c.id) || enVolFile(c) })), ...[...enDelai.values()].map((c) => ({ id: c.id, titre: c.titre, a: c.a, envoi: "delai" }))],
  ids: () => new Set([...lireCochees().map((c) => c.id), ...enDelai.keys()]),
  surChangement(f) {
    abonnesCochees.add(f);
    return () => abonnesCochees.delete(f);
  },
};

/**
 * « Annuler » sur la ligne d'une cochée : pendant le délai, elle revient sans
 * rien envoyer ; dans la file et jamais tentée, elle en sort ; en route (sa
 * requête est partie) ou déjà tentée, elle sera rouverte dès qu'elle sera
 * arrivée ; écrite, Motion la rouvre.
 */
export function renoncerCochee(id, { apres } = {}) {
  if (enDelai.has(id)) return enDelai.get(id).renoncer();
  const c = lireCochees().find((x) => x.id === id);
  if (!c) return;
  if (c.envoi !== "fait" && (enCoursCochee.has(id) || enVolFile(c))) {
    // Trop tard pour la retenir : la retirer de la liste perdrait ce geste, la coche arrivant quand même.
    aDefaire.add(id);
    majCochee(id, { defaire: true });
    dire(`« ${c.titre} » partait déjà : elle sera rouverte dès qu'elle sera arrivée.`);
  } else if (c.envoi === "attente") {
    // La liste d'abord : le suivi de la file ne la prend pas pour une coche retirée ailleurs.
    retirerCochee(id);
    if (c.idCommande) fileEnvoi.retirer(c.idCommande);
    apres?.();
  } else if (c.envoi === "tentee") {
    majCochee(id, { defaire: true });
    dire(`« ${c.titre} » sera rouverte dès que Rémy sera joignable.`);
  } else if (c.ledgerId) {
    annulerCoche(id, { apres });
  } else {
    aDefaire.add(id);
  }
}

/** Défait une coche : la tâche redevient ouverte dans Motion (spinner sur la ligne pendant). */
export async function annulerCoche(id, { apres } = {}) {
  const c = lireCochees().find((x) => x.id === id);
  if (!c?.ledgerId || enCoursCochee.has(id)) return;
  enCoursCochee.add(id);
  prevenirCochees();
  try {
    const r = await ecrire("/api/motion/undo", { id: c.ledgerId });
    enCoursCochee.delete(id);
    retirerCochee(id);
    dire(r?.ok === false ? `Annulation incomplète : vérifie « ${c.titre} » dans Motion.` : `Annulé : « ${c.titre} » est de retour.`, { genre: r?.ok === false ? "erreur" : "succes" });
    apres?.();
  } catch (err) {
    enCoursCochee.delete(id);
    prevenirCochees();
    direErreur(err, () => annulerCoche(id, { apres }), "Pas annulé");
  }
}

/** Le corps de la coche : la même clé (idCommande) au premier envoi et à chaque renvoi. */
const corpsCoche = (c) => ({ actions: [{ type: "terminer", nom: c.titre, id: c.id }], resume: "Coché depuis le site", idCommande: c.idCommande });

/** La coche attend la tour dans la file d'envoi (file-envoi.js) ; rend false si le navigateur n'a pas pu la garder. */
function mettreEnFile(c) {
  const e = fileEnvoi.ajouter({ id: c.idCommande, resume: resumeCoche(c), genre: "terminer", requetes: [{ chemin: "/api/motion/apply", methode: "POST", corps: corpsCoche(c), delai: 150000 }] });
  suivreFileCochees();
  return Boolean(e);
}

let suiviFile = null;
let relireApres = null;
let volVu = ""; // les coches que la file envoyait au dernier passage (leur ligne tourne)
const conclues = new Set(); // coches sorties de la file, en cours de conclusion
const resumeCoche = (c) => `Terminer « ${c.titre} »`;
/**
 * Suit la file d'envoi : une coche qui en sort a été envoyée (le registre de
 * la file le dit, avec le ledgerId rendu par la tour) ou retirée ailleurs
 * (Réglages › Envoi en attente) ; une coche refusée revient dans la journée.
 * Lancé au démarrage du site (main.js), quelle que soit la vue : une coche
 * partie pendant que Sam est sur Rémy se conclut là, « Annuler » compris.
 * Aujourd'hui y ajoute `apres` (relire la journée).
 */
export function suivreFileCochees({ apres } = {}) {
  if (apres) relireApres = apres;
  if (suiviFile) return;
  suiviFile = fileEnvoi.surChangement(verifierFile);
  verifierFile(fileEnvoi.liste());
}
function verifierFile(file) {
  const parId = new Map(file.map((x) => [x.id, x]));
  for (const c of lireCochees()) {
    if ((c.envoi !== "attente" && c.envoi !== "tentee") || !c.idCommande || conclues.has(c.id)) continue;
    // Envoyée d'ici en ce moment, ou en vol dans la file : sa réponse décidera.
    if (enCoursCochee.has(c.id) || fileEnvoi.enEnvoi(c.idCommande)) continue;
    const x = parId.get(c.idCommande);
    if (!x) {
      const parti = fileEnvoi.envoye(c.idCommande);
      if (parti) {
        conclues.add(c.id);
        conclure(c, parti).finally(() => conclues.delete(c.id));
      } else {
        // Ni dans la file ni partie : retirée à la main (Réglages › Envoi en attente). La tâche revient.
        retirerCochee(c.id);
        relireApres?.();
      }
    } else if (x.refus) {
      // Refusée par Motion : la tâche revient, et c'est dit.
      fileEnvoi.retirer(c.idCommande);
      retirerCochee(c.id);
      dire(`Motion n'a pas pu marquer « ${c.titre} » comme fait : ${String(x.refus).replace(/[.\s]+$/, "")}. La tâche est de retour.`, { genre: "erreur" });
      relireApres?.();
    } else if (c.envoi === "attente" && x.tentatives > 0) majCochee(c.id, { envoi: "tentee" });
  }
  // La file vient de prendre (ou de lâcher) une coche : sa ligne tourne, ou plus.
  const vol = lireCochees().filter(enVolFile).map((c) => c.id).join(",");
  if (vol !== volVu) {
    volVu = vol;
    prevenirCochees();
  }
}
/** Une coche partie par la file : faite, puis défaite si Sam l'a annulée en route. */
async function conclure(c, parti) {
  let ledgerId = parti.ledgerId ?? null;
  if (!ledgerId) {
    // Pas de ledgerId gardé : rejouer la même clé le rend (la tour répond « rejoue », sans rien refaire).
    try {
      ledgerId = (await ecrire("/api/motion/apply", corpsCoche(c), { delai: 30000 }))?.ledgerId ?? null;
    } catch {}
  }
  const defaireLa = doitDefaire(c.id);
  majCochee(c.id, { envoi: "fait", ledgerId, defaire: false });
  if (defaireLa) await defaireArrivee(c.id, c.titre, { apres: relireApres });
  else dire(`Envoyé : « ${c.titre} » est marqué fait.`, { genre: "succes", duree: 5000, action: ledgerId ? { libelle: "Annuler", faire: () => annulerCoche(c.id, { apres: relireApres }) } : null });
  relireApres?.();
}
/** Défait une coche arrivée après son « Annuler » ; sans ledgerId, Rémy ne peut pas : on dit quoi faire. */
async function defaireArrivee(id, titre, { apres } = {}) {
  if (lireCochees().find((x) => x.id === id)?.ledgerId) return annulerCoche(id, { apres });
  dire(`« ${titre} » est marquée faite dans Motion, mais Rémy n'a pas pu la rouvrir : rouvre-la dans Motion.`, { genre: "erreur" });
}

/**
 * Terminer : la ligne part tout de suite, un bandeau « Annuler » 2 s, et
 * RIEN n'est envoyé pendant ce délai. `retirer()` / `remettre()` : l'écran.
 * `journee()` : la journée, pour proposer la suite (« Et maintenant ? ») une
 * fois Motion d'accord ; `ouvrir(e)` : « Gérer » de la tâche proposée.
 * Une activité à soi se coche dans Rémy (l'agenda ne change pas).
 */
export function terminer(e, { retirer, remettre, apres, journee, ouvrir, contexte, maj } = {}) {
  if (e.type === "rdv") return marquerFaite(e, true, { maj: maj || apres });
  if (cochees.ids().has(e.id)) return;
  let renonce = false;
  const c = { id: e.id, titre: e.titre, ledgerId: null, a: Date.now(), envoi: "attente", idCommande: nouvelId() };
  retirer?.();
  let fermer = null;
  enDelai.set(e.id, {
    id: e.id, titre: e.titre, a: c.a,
    renoncer: () => {
      renonce = true;
      enDelai.delete(e.id);
      fermer?.();
      prevenirCochees();
      remettre?.();
    },
  });
  prevenirCochees();
  // « Annuler » : pendant le délai, rien n'est parti ; juste après, la coche est défaite comme depuis sa ligne.
  fermer = dire(`« ${e.titre} » : fait.`, { duree: DELAI_ANNULATION + 400, action: { libelle: "Annuler", faire: () => (enDelai.has(e.id) ? enDelai.get(e.id).renoncer() : renoncerCochee(e.id, { apres })) } });
  setTimeout(async () => {
    if (renonce) return;
    enDelai.delete(e.id);
    fermer?.(); // le délai est passé : ce bandeau ne peut plus annuler sans écrire
    ecrireCochees([...lireCochees().filter((x) => x.id !== e.id), c]);
    // La tour ne répond pas : la coche attend ici et partira seule à son retour.
    if (!tourJoignable()) return garder(c, { remettre, apres });
    enCoursCochee.add(e.id);
    prevenirCochees();
    try {
      const r = await ecrire("/api/motion/apply", corpsCoche(c), { delai: 150000 });
      const res = r?.results?.[0];
      if ((r?.echecs ?? 0) > 0 || res?.ok === false) {
        const erreur = res?.erreur || "raison inconnue";
        throw Object.assign(new Error(erreur), { nature: "refus", statut: /\((404|410)\)|n'existe plus|introuvable/i.test(erreur) ? 404 : 422 });
      }
      enCoursCochee.delete(e.id);
      const defaireLa = doitDefaire(e.id);
      majCochee(e.id, { envoi: "fait", ledgerId: r?.ledgerId ?? null, defaire: false });
      if (defaireLa) await defaireArrivee(e.id, e.titre, { apres });
      else {
        dire(`« ${e.titre} » est marqué fait dans Motion.`, { genre: "succes", duree: 5000, action: r?.ledgerId ? { libelle: "Annuler", faire: () => annulerCoche(e.id, { apres }) } : null });
        if (journee) import("./et-maintenant.js").then((m) => m.proposerSuite(e.titre, { id: e.id, journee, ouvrir, apres, contexte })).catch((err) => console.warn("Et maintenant ?", err));
      }
      apres?.();
    } catch (err) {
      enCoursCochee.delete(e.id);
      const nature = natureEchec(err);
      // Pas de réponse nette (réseau, délai, 500…) ou un refus passager (502, 503, 429) :
      // la tâche reste retirée, la commande repart plus tard avec la même clé.
      // Une session perdue (401) non plus : rien n'est parti, la coche attend la
      // reconnexion dans la file (au rechargement qui suit, main.js la vide).
      if (nature === "incertain" || nature === "passager" || nature === "auth") {
        const envoi = nature === "incertain" ? "tentee" : "attente";
        majCochee(e.id, { envoi });
        return garder({ ...c, envoi }, { remettre, apres, err });
      }
      retirerCochee(e.id);
      aDefaire.delete(e.id);
      remettre?.();
      direErreur(err, () => terminer(e, { retirer, remettre, apres, journee, ouvrir, contexte }), `Motion n'a pas pu marquer « ${e.titre} » comme fait`, { rafraichir: apres });
    }
  }, DELAI_ANNULATION);
}

/**
 * Pourquoi une coche attend, selon l'échec (phraseGarde de Noter) : « Pas de
 * réseau » seulement quand la tour ne répond pas ; une tour qui répond mal,
 * Motion qui fait la queue ou une session perdue se disent tels quels.
 */
export function phraseCocheGardee(titre, err, { defaire = false } = {}) {
  const t = `« ${titre} »`;
  if (err?.nature === "auth") return defaire
    ? `Tu n'es plus connecté à la tour : ${t} sera rouverte quand tu te reconnecteras.`
    : `Tu n'es plus connecté à la tour : ${t} est gardée ici et partira quand tu te reconnecteras.`;
  if (defaire) return `${t} sera rouverte dès que Rémy sera joignable.`;
  const nature = err ? natureEchec(err) : "incertain";
  if (nature === "passager" && err.nature !== "reseau") {
    const raison = fileEnvoi.raisonCourte(err);
    return `${raison.charAt(0).toUpperCase()}${raison.slice(1)} : ${t} repartira toute seule.`;
  }
  if (nature === "incertain" && err && err.nature !== "reseau" && err.nature !== "delai") return `La tour a mal répondu : ${t} est gardée ici et repartira toute seule, sans doublon.`;
  if (err?.nature === "reseau" && err.statut) return `Rémy ne répond pas derrière Tailscale (${err.statut}) : ${t} partira dès qu'il répondra.`;
  return `Pas de réseau : ${t} partira dès que Rémy sera joignable.`;
}

/** Sans réponse nette de la tour : la coche va dans la file d'envoi, ou revient si le navigateur ne peut rien garder. */
function garder(c, { remettre, apres, err = null }) {
  if (!mettreEnFile(c)) {
    retirerCochee(c.id);
    remettre?.();
    dire(`${err?.nature === "auth" ? "Tu n'es plus connecté à la tour" : "Pas de réseau"} : « ${c.titre} » n'est pas marqué fait. Il est de retour.`, { genre: "erreur" });
    return;
  }
  // « Annuler » touché pendant l'envoi raté : elle repartira, puis sera défaite.
  const defaireLa = aDefaire.has(c.id) || Boolean(lireCochees().find((x) => x.id === c.id)?.defaire);
  dire(phraseCocheGardee(c.titre, err, { defaire: defaireLa }), { duree: err?.nature === "auth" ? 0 : undefined });
  prevenirCochees();
  apres?.();
  // La tour répond mais mal (500…) : un nouvel essai dans un moment, la file espace les suivants.
  // Session perdue : la file attend la reconnexion (une requête de plus ne ferait qu'un 401).
  if (tourJoignable() && err?.nature !== "auth") setTimeout(() => fileEnvoi.vider().catch(() => {}), 15e3);
}

/** Une activité à soi faite (ou pas) : gardé dans Rémy, l'agenda ne change pas. À l'écran tout de suite, remis si la tour refuse. */
export async function marquerFaite(e, fait, { maj } = {}) {
  const avant = e.fait;
  e.fait = fait;
  maj?.();
  try {
    await api(`/api/taches/${seg("rdv:" + e.id)}/etat`, { methode: "PUT", corps: { fait } });
    dire(fait ? `« ${e.titre} » : faite.` : `« ${e.titre} » : à faire.`, { duree: 4000, action: { libelle: "Annuler", faire: () => marquerFaite(e, !fait, { maj }) } });
    return true;
  } catch (err) {
    e.fait = avant;
    maj?.();
    if (err?.nature !== "auth") dire(`« ${e.titre} » n'a pas pu être marquée : ${raisonDe(err)}.`, { genre: "erreur" });
    return false;
  }
}

export async function decaler(e, date, { apres } = {}) {
  try {
    if (estTache(e)) {
      const r = await appliquer("motion", { type: "modifier", nom: e.titre, echeance: isoLocal(date), id: e.id }, "Replanifié depuis le site");
      dire(`« ${e.titre} » : à faire ${dici(date)}. Motion recalcule.`, { genre: "succes", action: annulable("motion", r, e.titre, apres) });
    } else if (estActivite(e)) {
      const r = await appliquer("agenda", { type: "modifier", titre: e.titre, debut: isoLocal(date), id: e.id }, "Décalée depuis le site");
      dire(`« ${e.titre} » : à ${heure(date.getTime())}${date.getDate() !== new Date().getDate() ? ` (${quand(date.getTime(), { avecHeure: false })})` : ""}.`, { genre: "succes", action: annulable("agenda", r, e.titre, apres) });
    } else {
      dire(`« ${e.titre} » a d'autres participants : déplace-le dans ton agenda, ou demande à Rémy.`);
      return false;
    }
    apres?.();
    return true;
  } catch (err) {
    direErreur(err, () => decaler(e, date, { apres }), `« ${e.titre} » n'a pas été décalé`, { rafraichir: apres });
    return false;
  }
}

export async function prolonger(e, minutes, { apres } = {}) {
  try {
    if (estTache(e)) {
      if (!e.duree) {
        dire(`Motion ne donne pas de durée pour « ${e.titre} » : impossible de la prolonger d'ici.`, { genre: "erreur" });
        return false;
      }
      const r = await appliquer("motion", { type: "modifier", nom: e.titre, duree: e.duree + minutes, id: e.id }, "Prolongé depuis le site");
      dire(`« ${e.titre} » : +${minutes} min. Motion recalcule la suite.`, { genre: "succes", action: annulable("motion", r, e.titre, apres) });
    } else if (estActivite(e)) {
      const nouvelle = Math.round((finEffective(e) - e.debut) / 60e3) + minutes;
      const r = await appliquer("agenda", { type: "modifier", titre: e.titre, duree: nouvelle, id: e.id }, "Prolongée depuis le site");
      dire(`« ${e.titre} » : +${minutes} min, jusqu'à ${heure(finEffective(e) + minutes * 60e3)}.`, { genre: "succes", action: annulable("agenda", r, e.titre, apres) });
    } else return false;
    apres?.();
    return true;
  } catch (err) {
    if (err?.nature === "reseau") dire(`Pas de réseau : « ${e.titre} » n'a pas été prolongée.`, { genre: "erreur", action: { libelle: "Réessayer", faire: () => prolonger(e, minutes, { apres }) } });
    else direErreur(err, () => prolonger(e, minutes, { apres }), `« ${e.titre} » n'a pas été prolongée`, { rafraichir: apres });
    return false;
  }
}

export async function commencer(e, { apres } = {}) {
  try {
    await api(`/api/taches/${seg(e.id)}/etat`, { methode: "PUT", corps: { commencee: Date.now() } });
    dire(`« ${e.titre} » commencée. Motion sera prévenu quand tu la termines.`, {
      genre: "succes",
      action: { libelle: "Annuler", faire: () => arreter(e, { apres }) },
    });
    apres?.();
    return true;
  } catch (err) {
    if (err?.nature !== "auth") dire(`« ${e.titre} » n'a pas pu être commencée : ${raisonDe(err)}.`, { genre: "erreur", action: { libelle: "Réessayer", faire: () => commencer(e, { apres }) } });
    return false;
  }
}

/** Annule « commencer » : la tâche retrouve sa place dans Motion (Gestes.arreter). */
export async function arreter(e, { apres } = {}) {
  try {
    await api(`/api/taches/${seg(e.id)}/etat`, { methode: "PUT", corps: { commencee: false } });
    dire(`« ${e.titre} » : remise à sa place.`, { genre: "succes" });
    apres?.();
    return true;
  } catch (err) {
    direErreur(err, () => arreter(e, { apres }), `« ${e.titre} » n'a pas été remise à sa place`);
    return false;
  }
}

export async function bloquer(e, bloquee, raison, { apres } = {}) {
  const avant = { bloquee: Boolean(e.bloquee), raison: e.raison || null };
  try {
    const corps = { bloquee };
    if (bloquee && raison) corps.raison = raison;
    await api(`/api/taches/${seg(e.id)}/etat`, { methode: "PUT", corps });
    dire(bloquee ? `« ${e.titre} » : en attente.` : `« ${e.titre} » : reprise.`, {
      genre: "succes",
      action: { libelle: "Annuler", faire: async () => {
        await api(`/api/taches/${seg(e.id)}/etat`, { methode: "PUT", corps: avant.bloquee ? { bloquee: true, raison: avant.raison || undefined } : { bloquee: false } }).catch((err) => direErreur(err));
        apres?.();
      } },
    });
    apres?.();
  } catch (err) {
    direErreur(err, null, "État pas enregistré");
  }
}

async function modifier(e, { nouveauNom, echeance, dureeMin, priorite }, { apres } = {}) {
  const action = { type: "modifier", nom: e.titre, id: e.id };
  if (nouveauNom && nouveauNom !== e.titre) action.nouveau_nom = nouveauNom;
  if (echeance) action.echeance = isoLocal(echeance);
  if (dureeMin) action.duree = dureeMin;
  if (priorite) action.priorite = priorite;
  try {
    const r = await appliquer("motion", action, "Modifié depuis le site");
    dire(`« ${action.nouveau_nom || e.titre} » : modifiée.`, { genre: "succes", action: annulable("motion", r, e.titre, apres) });
    apres?.();
    return true;
  } catch (err) {
    direErreur(err, null, `Motion n'a pas pu modifier « ${e.titre} »`);
    return false;
  }
}

// --- Les catégories (étiquettes de Rémy : Voiture, Santé, Pro…) ---
let etiquettesConnues = null;
let lectureEtiquettes = null;
/** Les catégories de la tour (lues une fois) ; rend [] sans la capacité. */
export function chargerEtiquettes() {
  if (etiquettesConnues) return Promise.resolve(etiquettesConnues);
  lectureEtiquettes ||= api("/api/etiquettes").then((r) => (etiquettesConnues = r?.etiquettes || [])).finally(() => {
    lectureEtiquettes = null;
  });
  return lectureEtiquettes;
}
const etiquettes = chargerEtiquettes;
/** Les noms des catégories d'une tâche (vides tant qu'elles ne sont pas lues). */
export const nomsEtiquettes = (ids) => (ids || []).map((id) => etiquettesConnues?.find((x) => x.id === id)?.nom).filter(Boolean);
// La catégorie devinée par les mots (analyse/etiquettes.js, lot noter) : sans le module, pas de suggestion.
const ETIQUETTE_DEVINEE = "../analyse/etiquettes.js";

/** Prépare une question pour Rémy dans le composeur (jamais envoyée seule, contrat C). */
export function preparerQuestion(texte, contexte) {
  local.ecrire("remy-question", { texte, a: Date.now() });
  contexte?.aller("remy/nouvelle");
}

/** Une ligne d'action du panneau (52 px, chevron) : un bouton, ou un lien. */
function ligneAction(titre, detail, ic, faire, { href, desactive } = {}) {
  const contenu = [icone(ic), h("span", { class: "textes" }, h("strong", null, titre), detail ? h("span", { class: "detail" }, detail) : null), icone("chevron", "chevron-ligne")];
  if (href) return h("a", { class: "gerer-ligne", href, target: "_blank", rel: "noopener", onclick: faire }, contenu);
  return h("button", { type: "button", class: "gerer-ligne", disabled: desactive || null, onclick: faire }, contenu);
}

/**
 * La feuille « Gérer » d'un élément de la journée (ou d'une tâche sans
 * créneau). `apres()` : relire la journée. `contexte` : pour « En parler à
 * Rémy ». `prolonger: 15` : +15 déjà choisi (le « +15 » de la carte
 * Maintenant). `jour` : la journée (ou les éléments) du jour de l'élément,
 * pour estimer une prolongation et dire le jour. `journee()` : pour « Et
 * maintenant ? » après Terminer. `systeme` : ce que la tour a de branché
 * (l'agenda Google). `maj()` : redessiner sans relire.
 */
export function gerer(e, opts = {}) {
  const { apres, contexte, retirer, remettre, prolonger: choixInitial = null, jour = null, journee = null, systeme = null, maj = null, ouvrir = null } = opts;
  const tache = estTache(e);
  const activite = estActivite(e);
  const rdvAutres = e.type === "rdv" && !activite;
  const maintenant = Date.now();
  const enCours = e.debut != null && e.debut <= maintenant && finEffective(e) > maintenant;
  const placee = tache && e.type !== "sans-creneau";
  const journeeJour = Array.isArray(jour) ? { items: jour } : jour;
  let f;
  const fermerPuis = (faire) => async (ev) => {
    const btn = ev?.currentTarget;
    await occupe(btn, async () => {
      const ok = await faire();
      if (ok !== false) f.fermer();
    });
  };
  const groupe = (titre, ...enfants) => h("section", { class: "groupe-gestes" }, h("h3", { class: "titre-section" }, titre), ...enfants);
  const demander = (texte) => {
    f.fermer();
    preparerQuestion(texte, contexte);
  };

  const contenu = h("div", { class: "gerer" });
  if (e.type === "rdv") {
    // Le cadenas : une activité à heure fixe, ou un vrai rendez-vous.
    ajouterA(contenu,
      h("p", { class: "gerer-nature" }, icone("cadenas"), activite ? "Activité à heure fixe" : "Rendez-vous avec d'autres personnes"),
      h("p", { class: "gerer-horaires mono" }, horairesRendezVous(e, maintenant)),
      h("p", { class: "aide gerer-note" }, activite ? "Dans ton agenda : Motion place tes tâches autour, elle ne bouge pas toute seule." : "Il vit dans ton agenda : Rémy ne le modifie jamais d'un geste."));
  } else {
    const noms = nomsEtiquettes(e.etiquettes);
    const puces = [
      e.projet ? h("span", { class: "puce" }, h("span", { class: "point", style: { background: couleurProjet(e.projet) } }), h("span", null, e.projet)) : null,
      ...noms.map((n) => h("span", { class: "puce gerer-categorie" }, icone("etiquette"), h("span", null, n))),
    ].filter(Boolean);
    if (puces.length) ajouterA(contenu, h("div", { class: "rangee serree", style: { marginBottom: "6px" } }, puces));
    ajouterA(contenu, h("p", { class: `gerer-horaires mono${e.type === "sans-creneau" && e.retard ? " risque-texte" : ""}` }, e.type === "sans-creneau" ? quandSansCreneau(e) : horairesTache(e, maintenant)));
    if (e.bloquee) ajouterA(contenu, h("p", { class: "marque-bloquee" }, icone("pause"), marqueBloquee(e.raison)));
  }

  // « En parler à Rémy » : la question prête ; avec une prolongation choisie, « Est-ce raisonnable ? ».
  let choix = null;
  const question = () => {
    if (choix && placee) return brouillonRaisonnable(e, choix, impactProlongation(e, choix, journeeJour));
    if (e.type === "rdv") return BROUILLONS.rendezVous(e);
    if (e.type === "sans-creneau" && e.retard) return BROUILLONS.retard(e);
    return BROUILLONS.tache(e.titre);
  };
  const detailParler = () => (choix && placee ? "Est-ce raisonnable de prolonger ? Rien ne part sans toi" : "Une question prête, envoyée seulement si tu le décides");
  const parler = ligneAction("En parler à Rémy", detailParler(), "remy", () => demander(question()));
  const majParler = () => {
    const d = parler.querySelector(".detail");
    if (d) d.textContent = detailParler();
  };

  // Prolonger : choisir, voir ce que ça change, puis confirmer.
  const gestesAgenda = sait("agenda-gestes-v1") && systeme?.agenda !== false;
  if (placee || (activite && gestesAgenda && etatMoment(e, maintenant) !== "passe")) {
    if (placee && !e.duree) {
      ajouterA(contenu, groupe("Prolonger", h("p", { class: "aide" }, sait("duree-taches") ? "Motion ne donne pas de durée à cette tâche : prolonge-la dans Motion." : "Prolonger arrivera avec la mise à jour de ta tour.")));
    } else {
      const minutes = placee ? [5, 15, 30] : [15, 30, 60];
      choix = minutes.includes(choixInitial) ? choixInitial : null;
      const zone = h("div", { class: "gerer-impact-zone" });
      const puces = minutes.map((m) => h("button", {
        type: "button", class: "puce", "aria-pressed": "false",
        "aria-label": m < 60 ? `Prolonger de ${m} minutes` : "Prolonger d'une heure",
        onclick: () => {
          choix = choix === m ? null : m;
          majProlonger();
        },
      }, m < 60 ? `+${m} min` : "+1 h"));
      const envoyer = (m) => async (ev) => {
        const b = ev.currentTarget;
        const lib = b.querySelector(".lib");
        const avant = lib?.textContent;
        if (lib) lib.textContent = "…";
        const ok = await occupe(b, () => prolonger(e, m, { apres }));
        if (ok) f.fermer();
        else if (lib && b.isConnected) lib.textContent = avant;
      };
      const majProlonger = () => {
        puces.forEach((b, i) => b.setAttribute("aria-pressed", String(choix === minutes[i])));
        majParler();
        if (!choix) return vider(zone);
        if (!placee) {
          vider(zone, bouton(`Prolonger jusqu'à ${heure(finEffective(e) + choix * 60e3)}`, { classe: "plein", onclick: envoyer(choix) }));
          return;
        }
        const i = impactProlongation(e, choix, journeeJour);
        vider(zone, h("div", { class: `gerer-impact${i.conflit ? " conflit" : ""}`, role: "status" },
          h("p", { class: "phrase-impact" }, icone(i.conflit ? "alerte" : "info"), h("span", null, i.phrase)),
          bouton(i.conflit ? "Prolonger quand même" : `Prolonger de ${choix} min`, { classe: i.conflit ? "papier" : "plein", onclick: envoyer(choix) }),
          h("p", { class: "aide" }, "Estimation : Motion recalcule la suite, Rémy vérifie après coup.")));
      };
      ajouterA(contenu, groupe("Prolonger", h("div", { class: "rangee serree" }, puces), zone));
      majProlonger();
    }
  }

  // Décaler
  if (tache || (activite && gestesAgenda)) {
    const choixD = tache ? choixTache(e.echeance ?? null) : choixActivite(e);
    const autre = h("input", { class: "champ", type: tache ? "date" : "datetime-local", "aria-label": "Autre date", style: { width: "auto" } });
    const valeur = tache ? (e.echeance ? new Date(e.echeance) : echeanceDans(1)) : new Date(e.debut + 3600e3);
    autre.value = tache ? versChampDate(valeur).slice(0, 10) : versChampDate(valeur);
    ajouterA(contenu, groupe(tache ? "Décaler l'échéance" : "Décaler",
      h("div", { class: "rangee serree" },
        choixD.map((c) => h("button", { type: "button", class: "puce", title: quand(c.date.getTime(), { avecHeure: !tache }), onclick: fermerPuis(() => decaler(e, c.date, { apres })) }, c.libelle)),
        h("span", { class: "rangee serree" }, autre, bouton("OK", { classe: "papier petit", onclick: fermerPuis(() => {
          const d = tache ? (autre.value ? new Date(`${autre.value}T23:00`) : null) : depuisChampDate(autre.value);
          if (!d || Number.isNaN(d.getTime())) {
            dire("Choisis une date valide.", { genre: "erreur" });
            return false;
          }
          return decaler(e, d, { apres });
        }) })))));
  }

  // Les actions, une par ligne
  const lignes = h("div", { class: "gerer-lignes" });
  if (activite) {
    if (sait("taches-etat-v2")) {
      lignes.append(e.fait
        ? ligneAction("Pas encore terminée", "Elle redevient à faire", "arriere", () => { f.fermer(); marquerFaite(e, false, { maj: maj || apres }); })
        : ligneAction("Terminer", "Cochée dans Rémy ; ton agenda ne change pas", "coche", () => { f.fermer(); marquerFaite(e, true, { maj: maj || apres }); }));
    }
    if (!gestesAgenda) lignes.append(h("p", { class: "aide gerer-note" }, "Décaler et prolonger arriveront avec la mise à jour de ta tour."));
  } else if (rdvAutres) {
    if (systeme?.agenda) lignes.append(ligneAction("Ouvrir l'agenda à ce jour", "Pour le déplacer toi-même", "agenda", () => f.fermer(), { href: lienAgendaJour(e.debut) }));
    lignes.append(ligneAction("Demander à Rémy de le déplacer", "Il propose, tu valides avant tout changement", "deplacer", () => demander(brouillonDeplacer(e))));
  } else if (tache) {
    if (sait("taches-etat-v1")) {
      lignes.append(e.bloquee
        ? ligneAction("Reprendre", e.raison || "Elle n'est plus en attente", "lecture", fermerPuis(() => bloquer(e, false, null, { apres })))
        : ligneAction("Mettre en attente", "Mise de côté, avec ce que tu attends", "pause", async () => {
          const raison = await demanderTexte("En attente de quoi ?", { etiquette: "Raison (facultative)", libelle: "Mettre en attente", placeholder: "Le devis, une réponse de Hugo…", aide: "Elle reste dans ta journée, marquée « en attente », et le conseil du moment ne te la propose plus." }).catch(() => null);
          if (raison === null) return;
          f.fermer();
          bloquer(e, true, raison, { apres });
        }));
    }
    if (sait("taches-etat-v2")) {
      if (e.commencee) lignes.append(ligneAction("Remettre à sa place", "Annule « commencer » : Motion garde son créneau", "arriere", () => { f.fermer(); arreter(e, { apres }); }));
      else if (e.type === "sans-creneau" || etatMoment(e, maintenant) === "avenir") {
        lignes.append(ligneAction("Commencer maintenant", `Elle devient ta tâche en cours, pour ${duree(e.duree ?? (e.debut != null ? dureeTotale(e) : 30))}`, "lecture", fermerPuis(() => commencer(e, { apres }))));
      }
    }
  }
  lignes.append(parler);
  ajouterA(contenu, h("hr", { class: "separateur" }), lignes);

  // Catégorie : la suggestion des mots pré-cochée (pas enregistrée tant que Sam ne valide pas).
  if (tache && sait("categories-taches-v1")) {
    const zone = h("div", { class: "rangee serree" }, h("span", { class: "aide" }, "…"));
    const pied = h("p", { class: "aide gerer-note" }, "Le domaine de la tâche, pour filtrer et voir où passe ton temps. Motion n'est pas modifié.");
    ajouterA(contenu, groupe("Catégorie", zone, pied));
    etiquettes().then(async (liste) => {
      const choisies = new Set(e.etiquettes || []);
      let suggeree = null;
      if (!choisies.size && liste.length) {
        try {
          const m = await import(ETIQUETTE_DEVINEE);
          const id = m.etiquetteDevinee?.(e.titre, liste);
          if (id && liste.some((x) => x.id === id)) suggeree = id;
        } catch {}
        if (suggeree) choisies.add(suggeree);
      }
      const enregistrer = async (avant) => {
        try {
          await api(`/api/taches/${seg(e.id)}/etiquettes`, { methode: "PUT", corps: { etiquettes: [...choisies] } });
          e.etiquettes = [...choisies];
          suggeree = null;
          dessiner();
          apres?.();
        } catch (err) {
          choisies.clear();
          avant.forEach((x) => choisies.add(x));
          dessiner();
          if (err?.nature !== "auth") dire(`Catégorie de « ${e.titre} » pas enregistrée : ${texteErreur(err)}`, { genre: "erreur" });
        }
      };
      const dessiner = () => {
        if (!liste.length) {
          vider(zone, h("span", { class: "aide" }, "Pas encore de catégorie : crée-les (Voiture, Santé, Pro, Perso…)."),
            h("a", { class: "btn texte petit", href: "#/projets/categories", onclick: () => f.fermer() }, "Gérer les étiquettes…"));
          return;
        }
        vider(zone, liste.map((et) => h("button", {
          type: "button", class: `puce${suggeree === et.id ? " suggeree" : ""}`, "aria-pressed": String(choisies.has(et.id)),
          onclick: () => {
            const avant = new Set(choisies);
            if (choisies.has(et.id)) choisies.delete(et.id);
            else choisies.add(et.id);
            enregistrer(avant);
          },
        }, et.nom)),
        suggeree ? h("span", { class: "rangee serree suggestion" }, h("span", { class: "aide" }, "Suggérée d'après le titre."),
          bouton("Enregistrer", { classe: "papier petit", onclick: (ev) => occupe(ev.currentTarget, () => enregistrer(new Set())) })) : null);
      };
      dessiner();
    }).catch((err) => vider(zone, h("span", { class: "erreur-champ" }, `Les catégories n'ont pas pu être lues : ${raisonDe(err)}.`)));
  }

  // Modifier
  if (tache) {
    const nom = h("input", { class: "champ", type: "text", value: e.titre, "aria-label": "Nom" });
    const ech = h("input", { class: "champ", type: "datetime-local", "aria-label": "Échéance" });
    if (e.echeance) ech.value = versChampDate(new Date(e.echeance));
    const dur = h("input", { class: "champ", type: "number", min: "5", max: "1440", step: "5", "aria-label": "Durée (min)", placeholder: "min" });
    if (e.duree) dur.value = String(e.duree);
    const prio = h("select", { class: "champ", "aria-label": "Priorité" }, h("option", { value: "" }, "Priorité inchangée"), PRIORITES.map(([v, l]) => h("option", { value: v }, l)));
    if (e.priorite) prio.value = String(e.priorite).toUpperCase();
    const details = h("details", { class: "gerer-modifier" }, h("summary", { class: "gerer-ligne" }, icone("crayon"), h("span", { class: "textes" }, h("strong", null, "Modifier"), h("span", { class: "detail" }, "Nom, durée, priorité, échéance")), icone("bas", "chevron-ligne")),
      h("div", { style: { display: "grid", gap: "10px", gridTemplateColumns: "1fr 1fr", marginTop: "10px" } },
        h("label", { style: { gridColumn: "1 / -1" } }, h("span", { class: "etiquette-champ" }, "Nom"), nom),
        h("label", null, h("span", { class: "etiquette-champ" }, "Échéance"), ech),
        h("label", null, h("span", { class: "etiquette-champ" }, "Durée (min)"), dur,
          !e.duree ? h("span", { class: "aide", style: { display: "block", marginTop: "4px" } }, "Motion ne donnait pas de durée : en fixer une l'aide à placer la tâche.") : null),
        h("label", null, h("span", { class: "etiquette-champ" }, "Priorité"), prio),
        h("div", { style: { alignSelf: "end" } }, bouton("Enregistrer", { classe: "plein", onclick: fermerPuis(() => modifier(e, {
          nouveauNom: nom.value.trim(),
          echeance: depuisChampDate(ech.value),
          dureeMin: Number(dur.value) || null,
          priorite: prio.value && prio.value !== String(e.priorite || "").toUpperCase() ? prio.value : null,
        }, { apres })) }))));
    ajouterA(contenu, h("section", { class: "groupe-gestes" }, details));
  }

  // Le geste le plus fréquent, en bas.
  const pied = tache ? [bouton("Terminer", { classe: "plein large", icone: "coche", etiquette: `Terminer « ${e.titre} »`, onclick: () => {
    f.fermer();
    terminer(e, { retirer, remettre, apres, contexte, ouvrir, journee: placee ? journee : null });
  } })] : null;
  f = feuille({ titre: e.titre, sousTitre: enCours && e.type !== "rdv" ? "En cours" : e.type === "sans-creneau" ? "Sans créneau" : null, contenu, pied, large: true, classe: `feuille-gerer${e.fait ? " faite" : ""}` });
  return f;
}

/** Le résumé d'une durée « 50 min sur 1 h 15 » (carte Maintenant). */
export const resteSur = (e, maintenant = Date.now()) => {
  const reste = Math.max(1, Math.ceil((finEffective(e) - maintenant) / 60e3));
  const total = e.duree ?? Math.max(1, Math.round((finEffective(e) - e.debut) / 60e3));
  return { reste, total, texteReste: reste < 60 ? String(reste) : duree(reste), unite: reste < 60 ? "min restantes" : "restantes" };
};
export { finEffective, estActivite, estTache };
