// Le travail de fond cède la place (règle du 12/11, CLAUDE.md) : tout ce que
// Rémy fait sans qu'on le lui ait demandé à l'instant se met en pause dès
// qu'arrive une demande de l'utilisateur ou une mise à jour, puis reprend. Une
// tâche de fond ne fait jamais attendre une réponse.
//
// Ce module est le SEUL endroit qui classe ce que fait la tour :
//   - « demande » : demandé à l'instant (une réponse du chat, une dictée, une
//     capture, la lecture d'une pièce jointe, une écriture qu'il vient de faire) ;
//   - « attendu » : programmé par lui, dont il attend le résultat à une heure
//     dite (le briefing du matin, le bilan du soir : calculés sans IA à la
//     lecture ; un travail attendu en cours retiendrait la mise à jour) ;
//   - « fond » : tout le reste.
// Chaque job (lib/jobs.js, `enregistrer`) et chaque travail de fond hors job
// (`enFond`) déclare son identifiant ici ; un identifiant inconnu compte comme
// du fond (dans le doute, il cède).
//
// Ce que fait le fond devant une demande (lib/jobs.js, `inference`) :
//   - il ne COMMENCE aucun appel au modèle local tant qu'une demande est en
//     cours, ni pendant un court répit après (REMY_FOND_REPIT_MS, 5 s : la
//     question suivante arrive souvent dans la foulée) ;
//   - un appel déjà parti est COUPÉ (signal d'abandon : la connexion se ferme,
//     le serveur du modèle arrête le calcul s'il sait le faire) s'il est
//     interruptible, puis REFAIT en entier plus tard : un appel au modèle
//     n'écrit rien, ce qui suit l'appel ne s'exécute qu'avec sa réponse, donc
//     rien n'est perdu ni fait deux fois.
// Devant une mise à jour (lib/maj-auto-serveur.js) : la même pause, tenue par
// un bail (`cederPourMiseAJour`) ; la mise à jour n'attend plus que les
// demandes, et le fond qui ne se coupe pas au milieu (une sauvegarde qui écrit).

import { generationsEnCours } from "./arret.js";

export const CATEGORIES = {
  demande: "demandé à l'instant",
  attendu: "attendu à une heure dite",
  fond: "de fond",
};

// Le classement. `modele` : appelle le modèle local. `interruptible` : ses
// appels au modèle se coupent et se refont (fond seulement). `coupure` : ce
// qui se passe quand une demande ou une mise à jour arrive. Le tableau du
// rapport et docs/journal-technique.md en sont la copie lisible.
export const TRAVAUX = {
  // --- Demandé à l'instant : jamais coupé par le fond ; la mise à jour l'attend.
  chat: { nom: "Réponse du chat", categorie: "demande", modele: true, coupure: "jamais coupée par le fond ; la mise à jour attend la fin de la réponse" },
  "chat-suite": { nom: "Titre et mémoire tirés d'une réponse", categorie: "demande", modele: true, coupure: "suite immédiate de la réponse, gardée en mémoire du processus seulement : la mise à jour l'attend (quelques secondes)" },
  dictee: { nom: "Dictée", categorie: "demande", modele: false, coupure: "la mise à jour attend la fin de l'envoi" },
  capture: { nom: "Capture (et son analyse)", categorie: "demande", modele: true, coupure: "la mise à jour attend la fin de l'envoi" },
  piece: { nom: "Lecture d'une pièce jointe", categorie: "demande", modele: true, coupure: "la mise à jour attend la fin de l'envoi" },
  ecriture: { nom: "Écriture depuis l'app", categorie: "demande", modele: false, coupure: "la mise à jour attend la fin de la requête" },
  "conseil-renouvele": { nom: "« Un autre conseil »", categorie: "demande", modele: true, coupure: "demandé d'un tap : passe devant le fond" },
  "compactage-demande": { nom: "Compactage demandé depuis la jauge", categorie: "demande", modele: true, coupure: "demandé d'un tap : passe devant le fond (un compactage automatique du même fil est promu)" },
  "reflexion-demandee": { nom: "Réflexion lancée à la main", categorie: "demande", modele: true, coupure: "la mise à jour attend la fin de la requête" },
  // La passerelle des outils de code (lib/passerelle.js, 12/11) : la clé « au
  // clavier », c'est Sam qui attend la réponse dans son outil.
  "agent-clavier": { nom: "Outil de code, au clavier", categorie: "demande", modele: true, coupure: "jamais coupé par le fond ; fait céder le fond et les agents de fond ; la mise à jour attend la fin de la réponse" },

  // --- Attendu à une heure dite : lu par l'app au moment voulu (l'app Windows
  // notifie le briefing du matin et le bilan du soir) ; calculé sans IA à la
  // lecture, il n'a rien à céder. Sa matière, la réflexion de nuit, est du fond.
  "briefing-matin": { nom: "Briefing du matin", categorie: "attendu", modele: false, coupure: "calculé sans IA quand l'app le lit (une lecture) : rien à céder, rien que la mise à jour doive attendre" },
  "bilan-soir": { nom: "Bilan du soir", categorie: "attendu", modele: false, coupure: "calculé sans IA quand l'app le lit (une lecture) : rien à céder" },

  // --- De fond, avec le modèle local : interruptible, refait sans rien perdre.
  "reflexion-nuit": {
    nom: "Réflexion de nuit", categorie: "fond", modele: true, interruptible: true,
    coupure: "son appel au modèle est coupé puis refait en entier (le briefing ne s'écrit qu'avec la réponse) ; le délai du job ne compte pas la pause ; après une mise à jour, reprise sans compter d'essai",
  },
  "conversations-nuit": {
    nom: "Relecture de nuit des conversations d'ailleurs", categorie: "fond", modele: true, interruptible: true,
    coupure: "appel coupé puis refait ; le résumé du jour s'écrit en une transaction (UPSERT), une reprise le réécrit à l'identique",
  },
  conseil: {
    nom: "Conseil précalculé", categorie: "fond", modele: true, interruptible: true,
    coupure: "appel coupé puis refait ; hors job : une mise à jour le perd, il se recalcule à la prochaine ouverture (rien d'écrit à moitié)",
  },
  compactage: {
    nom: "Compactage d'une longue conversation", categorie: "fond", modele: true, interruptible: true,
    coupure: "appel coupé puis refait ; le résumé ne s'écrit qu'à la fin, conversation relue juste avant ; perdu à une mise à jour, refait après la réponse suivante",
  },

  // La clé « agents de fond » de la passerelle : un agent qui tourne seul.
  // `file` : il cède EN FILE — ses nouveaux appels attendent (dans l'ordre,
  // sans erreur, au plus le délai réglé dans Réglages) pendant une demande et
  // son répit ; l'appel déjà parti n'est PAS coupé (un outil de code supporte
  // mal une réponse tronquée) : il finit, et aucun autre ne part.
  // `groupe` : Réglages › Diagnostic les compte au lieu de les nommer un à un.
  "agent-fond": {
    nom: "Appel d'un agent de fond", categorie: "fond", modele: true, interruptible: false, file: true,
    groupe: ["appel d'agent", "appels d'agents"],
    coupure: "ses nouveaux appels attendent dans la file (puis 503 et Retry-After passé le délai réglé) ; l'appel en cours finit — coupé et refait seulement s'il est sans flux et que Réglages le permet ; la mise à jour attend un appel en cours",
  },

  // --- De fond, sans le modèle : rien à céder au modèle ; ne commence pas
  // pendant une demande ou une mise à jour, mais ne se coupe pas au milieu.
  "sauvegarde-nuit": { nom: "Sauvegarde de la nuit", categorie: "fond", modele: false, coupure: "ne se coupe pas au milieu (archive chiffrée en cours d'écriture) : la mise à jour l'attend, jusqu'à son délai maximal" },
  "commerces-maj": { nom: "Mise à jour des commerces", categorie: "fond", modele: false, coupure: "un import en cours remplace la base des commerces : la mise à jour l'attend, jusqu'à son délai maximal" },
  "connaissances-sync": { nom: "Indexation des conversations d'ailleurs", categorie: "fond", modele: false, coupure: "relecture de fichiers, quelques secondes : la mise à jour l'attend" },
  "regles-verifier": { nom: "Règles de Rémy (agenda relu)", categorie: "fond", modele: false, coupure: "quelques secondes : la mise à jour l'attend" },
  "activite-pc-releve": { nom: "Relevé de l'activité du PC", categorie: "fond", modele: false, coupure: "quelques secondes : la mise à jour l'attend" },
  "activite-pc-purge": { nom: "Ménage de l'activité du PC", categorie: "fond", modele: false, coupure: "une requête : la mise à jour l'attend" },
  "lieux-purge": { nom: "Ménage des lieux", categorie: "fond", modele: false, coupure: "une requête : la mise à jour l'attend" },
  "carnet-purge": { nom: "Ménage du carnet", categorie: "fond", modele: false, coupure: "une requête : la mise à jour l'attend" },
};

export function classement(travail) {
  const t = TRAVAUX[travail];
  return t ? { id: travail, ...t } : { id: travail, nom: String(travail || "travail de fond"), categorie: "fond", modele: true, interruptible: false, coupure: "non classé : compté comme du fond" };
}

// --- L'horloge et le répit (les tests les remplacent) ------------------------------

let horloge = () => Date.now();
export const _horloge = (f) => {
  horloge = f || (() => Date.now());
};
export const maintenant = () => horloge();
const REPIT_MS = () => {
  const n = Number(process.env.REMY_FOND_REPIT_MS);
  return Number.isFinite(n) && n >= 0 ? n : 5_000;
};
export const BAIL_MAJ_MS = 20 * 60_000; // plus que l'intervalle de la tâche (15 min)
// Plafond (relecture de sécurité du 12/11) : 45 min de pause d'affilée au plus
// pour une mise à jour — trois passages de la tâche, la sauvegarde et
// l'installation comprises. Au-delà, le fond reprend d'office et les
// nouvelles demandes de pause sont REFUSÉES 30 min : le temps que le
// planificateur repasse (10 min au plus) et qu'une sauvegarde de nuit
// finisse (délai maximal 15 min), avec de la marge. Une tâche coincée, ou une
// session qui renouvellerait la pause sans fin, n'arrête donc jamais le fond.
export const PLAFOND_MAJ_MS = 45 * 60_000;
export const RECUPERATION_MAJ_MS = 30 * 60_000;
// Une demande ouverte depuis plus de 10 min (une requête restée ouverte) ne
// fait plus céder le fond ni ne retient la mise à jour. Une réponse du chat
// réellement en cours reste protégée par son registre (lib/arret.js : posé au
// début de la génération, retiré quand elle a tout écrit ; une réponse est
// bornée à ~6 min par le budget du modèle) jusqu'à 30 min.
export const DEMANDE_MAX_MS = 10 * 60_000;
export const GENERATION_MAX_MS = 30 * 60_000;

// --- Les demandes en cours -----------------------------------------------------------

// Ce qu'une requête de l'app demande (sa méthode, son chemin). null : une
// lecture (rien à prioriser). « passive » : écrite par l'app sans geste de
// l'utilisateur (signe de vie, lieux, appareil) : la mise à jour l'attend,
// le fond ne lui cède pas.
const PASSIVES = [/^\/api\/activite\/ping$/, /^\/api\/lieux\/evenements$/, /^\/api\/appareils$/];
export function natureRequete(methode, chemin) {
  const m = String(methode || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(m)) return null;
  const p = String(chemin || "").split("?")[0].replace(/\/+$/, "");
  if (/^\/api\/maj-auto(\/|$)/.test(p)) return null; // la mise à jour ne s'attend pas elle-même
  if (PASSIVES.some((re) => re.test(p))) return "passive";
  if (/^\/api\/conversations\/[^/]+\/messages$/.test(p)) return "question";
  if (/^\/api\/conversations\/[^/]+\/pieces$/.test(p)) return "piece";
  if (/^\/api\/(transcribe|dictee\/correction)$/.test(p)) return "dictee";
  if (/^\/api\/capture(\/(image|analyser|extraire))?$/.test(p)) return "capture";
  return "ecriture";
}

// Pourquoi le fond attend, dit à l'utilisateur (Réglages › Diagnostic).
export const RAISONS = {
  question: "tu viens de poser une question",
  dictee: "tu viens de dicter",
  capture: "tu viens d'envoyer une capture",
  piece: "tu viens de joindre une pièce",
  ecriture: "tu viens d'agir dans l'app",
  modele: "Rémy te répond",
  clavier: "tu travailles dans ton outil de code",
  clavierPlafond: "ton outil de code a eu la priorité 45 min dans l'heure : le travail de fond rattrape son retard",
  maj: "une mise à jour s'installe",
};

const demandes = new Map(); // id → { nature, debut }
let compteur = 0;
let derniere = null; // { nature, fin }
let bail = null; // { debut, jusqua } : la mise à jour tient le fond en pause
let recuperation = null; // { jusqua } : plafond atteint, les pauses sont refusées
const ecouteurs = new Set();
let reveil = null;

function prevenir() {
  for (const f of ecouteurs) {
    try {
      f();
    } catch {}
  }
}
// Le fond peut-il repartir ? Rappelé à la fin d'une demande, du répit, du bail.
export function surLibre(f) {
  ecouteurs.add(f);
  return () => ecouteurs.delete(f);
}
export function programmerReveil() {
  clearTimeout(reveil);
  reveil = null;
  const c = fondDoitCeder();
  if (!c) return prevenir();
  if (c.jusqua) reveil = setTimeout(programmerReveil, Math.max(0, c.jusqua - horloge()) + 5);
}

// Une demande commence. Rend la fonction qui la termine (idempotente).
export function debutDemande(nature = "ecriture") {
  const id = ++compteur;
  const d = { nature, debut: horloge() };
  demandes.set(id, d);
  // La clé « au clavier » en récupération (plafond atteint) ne fait rien céder.
  const recup = nature === "clavier" ? recuperationClavier() : null;
  if (recup) d.compteDepuis = recup; // compté seulement après la récupération
  if (nature !== "passive" && !recup) ceder(nature);
  if (nature === "clavier") programmerReveil(); // le réveil du plafond
  let fini = false;
  return () => {
    if (fini) return;
    fini = true;
    demandes.delete(id);
    const fin = horloge();
    if (nature === "clavier") noterClavier(d, fin);
    if (nature !== "passive") derniere = { nature, fin };
    programmerReveil();
  };
}

// --- Le plafond de la clé « au clavier » (passerelle des outils de code) ---------------
// Relecture de sécurité du 12/11 : un outil mal réglé (ou une clé volée) qui
// enchaîne les appels « au clavier » ferait céder le fond sans fin, sauvegarde
// de nuit comprise. Comme pour la mise à jour : au-delà de 45 min de priorité
// cumulée (appels en cours et leur répit, réunis) sur une heure glissante, la
// clé « au clavier » est traitée comme du FOND pendant 15 min — ses appels
// prennent la file comme ceux des agents de fond, ceux en cours ne font plus
// céder le fond —, puis le compte repart de zéro. Soit au moins 15 min par
// heure pour le fond : plus que l'intervalle du planificateur (10 min), donc
// un job dû (la sauvegarde de nuit) commence pendant la récupération ; une
// sauvegarde ne se coupe pas au milieu, elle finit ensuite quoi qu'il arrive.
// Un humain au clavier atteint rarement 45 min de génération sur 60. Les
// demandes faites dans Rémy (chat, dictée, capture…) ne sont pas concernées.
export const PLAFOND_CLAVIER_MS = 45 * 60_000;
export const FENETRE_CLAVIER_MS = 60 * 60_000;
export const RECUPERATION_CLAVIER_MS = 15 * 60_000;
let clavierPasse = []; // [debut, fin + répit] des appels au clavier finis
let recupClavier = null; // { debut, jusqua }

function noterClavier(d, fin) {
  const a = Math.max(d.debut, d.compteDepuis || 0);
  const b = fin + REPIT_MS();
  if (b > a) clavierPasse.push([a, b]);
  const t = horloge();
  clavierPasse = clavierPasse.filter(([, x]) => x > t - FENETRE_CLAVIER_MS);
}

// Le temps de priorité « clavier » réuni sur l'heure glissante (ms).
export function cumulClavier(t = horloge()) {
  const debutFenetre = t - FENETRE_CLAVIER_MS;
  const enCours = [...demandes.values()].filter((d) => d.nature === "clavier").map((d) => [Math.max(d.debut, d.compteDepuis || 0), t]);
  const iv = [...clavierPasse, ...enCours]
    .map(([a, b]) => [Math.max(a, debutFenetre), Math.min(b, t)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur = null;
  for (const [a, b] of iv) {
    if (!cur || a > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    } else cur[1] = Math.max(cur[1], b);
  }
  return cur ? total + cur[1] - cur[0] : total;
}

// La clé « au clavier » rattrape-t-elle ? Jusqu'à quand (ms), ou null. Le
// plafond atteint, la récupération commence (et le compte est remis à zéro).
export function recuperationClavier(t = horloge()) {
  if (recupClavier && t < recupClavier.jusqua) return recupClavier.jusqua;
  recupClavier = null;
  if (cumulClavier(t) < PLAFOND_CLAVIER_MS) return null;
  recupClavier = { debut: t, jusqua: t + RECUPERATION_CLAVIER_MS };
  clavierPasse = [];
  for (const d of demandes.values()) if (d.nature === "clavier") d.compteDepuis = recupClavier.jusqua;
  console.warn("Passerelle : la clé « au clavier » a eu la priorité 45 min dans l'heure — traitée comme du fond 15 min");
  return recupClavier.jusqua;
}

// Une requête HTTP de l'app : suivie de son début à sa fin (ou sa coupure).
export function suivreRequete(req, res, { autorise = true } = {}) {
  const nature = natureRequete(req?.method, req?.url);
  if (!nature || !autorise) return null;
  const fin = debutDemande(nature);
  res?.once?.("close", fin);
  res?.once?.("finish", fin);
  return fin;
}

// Les demandes en cours, sans celles ouvertes depuis plus de DEMANDE_MAX_MS.
export const demandesEnCours = (t = horloge()) => [...demandes.values()].filter((d) => t - d.debut < DEMANDE_MAX_MS);
export const generationsFraiches = (t = horloge()) => generationsEnCours({ depuisMoinsDe: GENERATION_MAX_MS, maintenant: t });

// Le fond doit-il céder maintenant ? null, ou { nature, raison, enCours, jusqua }.
export function fondDoitCeder(t = horloge()) {
  if (bail && t < bail.jusqua) return { nature: "maj", raison: RAISONS.maj, enCours: true, jusqua: bail.jusqua };
  const recup = recuperationClavier(t);
  const actives = demandesEnCours(t).filter((d) => d.nature !== "passive" && !(recup && d.nature === "clavier"));
  if (actives.length) {
    const n = actives.at(-1).nature;
    // Seulement « au clavier » : réveil prévu à l'heure où le plafond serait atteint.
    const jusqua = actives.every((d) => d.nature === "clavier") ? t + Math.max(1, PLAFOND_CLAVIER_MS - cumulClavier(t)) : null;
    return { nature: n, raison: RAISONS[n] || RAISONS.ecriture, enCours: true, jusqua };
  }
  if (generationsFraiches(t)) return { nature: "question", raison: RAISONS.question, enCours: true, jusqua: null };
  if (derniere && !(recup && derniere.nature === "clavier") && t - derniere.fin < REPIT_MS()) {
    return { nature: derniere.nature, raison: RAISONS[derniere.nature] || RAISONS.ecriture, enCours: false, jusqua: derniere.fin + REPIT_MS() };
  }
  return null;
}

// --- Le bail de la mise à jour --------------------------------------------------------

// Rend { ok: true, bail } ou, plafond atteint, { ok: false, refus, jusqua }
// (le fond rattrape son retard : la mise à jour attendra un passage).
export function cederPourMiseAJour({ dureeMs = BAIL_MAJ_MS } = {}) {
  const t = horloge();
  if (recuperationMiseAJour(t)) return { ok: false, refus: "rattrapage", jusqua: recuperation.jusqua };
  recuperation = null;
  // Un bail encore courant se prolonge, sans dépasser son plafond.
  const debut = bail && t < bail.jusqua ? bail.debut : t;
  if (t - debut >= PLAFOND_MAJ_MS) {
    bail = null;
    recuperation = { jusqua: t + RECUPERATION_MAJ_MS };
    programmerReveil();
    return { ok: false, refus: "rattrapage", jusqua: recuperation.jusqua };
  }
  bail = { debut, jusqua: Math.min(t + dureeMs, debut + PLAFOND_MAJ_MS) };
  ceder("maj");
  programmerReveil();
  return { ok: true, bail: { ...bail } };
}
export function reprendreApresMiseAJour() {
  const avait = Boolean(bail);
  bail = null;
  programmerReveil();
  return avait;
}
export const bailMiseAJour = () => {
  if (!bail) return null;
  const t = horloge();
  if (t < bail.jusqua) return { ...bail };
  // Échu au plafond (sans nouvel appel) : la récupération commence là.
  if (bail.jusqua - bail.debut >= PLAFOND_MAJ_MS && !recuperation) recuperation = { jusqua: bail.jusqua + RECUPERATION_MAJ_MS };
  return null;
};
// Le fond rattrape son retard après un plafond atteint : jusqu'à quand (ms), ou null.
export function recuperationMiseAJour(t = horloge()) {
  bailMiseAJour(); // note un plafond échu de lui-même
  return recuperation && t < recuperation.jusqua ? recuperation.jusqua : null;
}

// --- Les appels au modèle de fond en vol ---------------------------------------------

const vols = new Set(); // { controleur, interruptible, ctx, cede }

// Un appel de fond part. `signal` : à passer au fetch ; `cede()` : a-t-il été
// coupé pour céder la place (alors le refaire) ; `fin()` : il est fini.
export function envol({ interruptible = false, ctx = null } = {}) {
  const controleur = new AbortController();
  const v = { controleur, interruptible, ctx, cede: false };
  vols.add(v);
  return { signal: controleur.signal, cede: () => v.cede, fin: () => vols.delete(v) };
}

export class CessionFond extends Error {
  constructor(nature) {
    super(`Travail de fond mis en pause : ${RAISONS[nature] || nature}`);
    this.name = "CessionFond";
    this.cede = true;
    this.nature = nature;
  }
}

// Coupe les appels de fond interruptibles en vol (pas ceux d'un travail promu).
function ceder(nature) {
  for (const v of vols) {
    if (!v.interruptible || v.cede || v.ctx?.promu) continue;
    v.cede = true;
    try {
      v.controleur.abort(new CessionFond(nature));
    } catch {}
  }
}

// --- Les travaux de fond en cours (pour l'écran et pour la mise à jour) --------------

const fonds = new Set(); // ctx

// `etat` : « actif » (son propre code), « modele » (un appel au modèle en vol),
// « pause » (il attend : une demande ou une mise à jour passe), « attente » (il
// attend une place sur le modèle). En pause ou en attente, il est ENTRE deux
// étapes : rien n'est à moitié écrit, l'arrêter ne perd rien.
export function debutFond(travail, extra = {}) {
  const c = classement(travail);
  const ctx = { fond: c.categorie !== "demande", travail, nom: c.nom, categorie: c.categorie, debut: horloge(), etat: "actif", appelInterruptible: false, pauseMs: 0, horsDelai: false, ...extra };
  fonds.add(ctx);
  return ctx;
}
export function finFond(ctx) {
  fonds.delete(ctx);
}
export const travauxDeFond = () => [...fonds];

// Ce qui retient VRAIMENT une mise à jour, côté fond : un travail attendu, ou
// un travail de fond au milieu d'une étape qu'on ne coupe pas (une sauvegarde
// qui écrit, un import). Pas celui qui est en pause entre deux étapes, ni
// celui qui a dépassé son délai maximal (déjà compté comme échoué et repris).
export function fondQuiRetient() {
  const raisons = [];
  for (const ctx of fonds) {
    if (ctx.horsDelai || ctx.promu) continue;
    if (ctx.categorie === "attendu") {
      raisons.push(`${ctx.nom} (attendu)`);
      continue;
    }
    if (ctx.etat === "pause" || ctx.etat === "attente") continue;
    if (ctx.etat === "modele" && ctx.appelInterruptible) raisons.push(`${ctx.nom} : appel au modèle ${bailMiseAJour() ? "en cours d'interruption" : "en cours (cède à la mise à jour)"}`);
    else raisons.push(`${ctx.nom} en cours (ne se coupe pas au milieu)`);
  }
  return raisons;
}

// Attend (au plus `ms`) que les appels coupés soient revenus en pause.
export async function attendreRepos(ms = 3_000, pas = 20) {
  const fin = Date.now() + ms;
  const enVol = () => [...fonds].some((c) => c.etat === "modele" && c.appelInterruptible && !c.promu && !c.horsDelai);
  while (enVol() && Date.now() < fin) await new Promise((r) => setTimeout(r, pas));
  return !enVol();
}

// --- Ce que Réglages › Diagnostic montre ---------------------------------------------

export function etatFond(t = horloge()) {
  const cede = fondDoitCeder(t);
  const travaux = [...fonds]
    .filter((c) => c.categorie !== "demande")
    .map((c) => ({
      travail: c.travail,
      nom: c.nom,
      categorie: c.categorie,
      etat: c.etat === "pause" ? "pause" : c.etat === "attente" ? "attente" : "actif",
      depuis: new Date(c.debut).toISOString(),
    }));
  // Les appels d'agents de fond (passerelle des outils de code), comptés.
  const agents = { enAttente: 0, enCours: 0 };
  for (const x of travaux) if (x.travail === "agent-fond") agents[x.etat === "actif" ? "enCours" : "enAttente"]++;
  const recup = recuperationClavier(t);
  const clavier = recup ? { recuperation: true, jusqua: new Date(recup).toISOString() } : null;
  const ligne = phraseFond({ travaux, cede });
  return {
    travaux,
    agents,
    clavier,
    cede: cede ? { nature: cede.nature, raison: cede.raison, enCours: cede.enCours } : null,
    ligne: recup ? `${ligne.replace(/\.$/, "")} · ${RAISONS.clavierPlafond} (jusqu'à ${heureCourte(recup)}).` : ligne,
  };
}

const heureCourte = (ms) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: process.env.REMY_TZ || "Europe/Paris" }).format(new Date(ms));

// « Réflexion de nuit en pause : tu viens de poser une question » ;
// « 2 appels d'agents en attente : tu viens de poser une question ».
export function phraseFond({ travaux = [], cede = null } = {}) {
  if (!travaux.length) return cede ? `Rien en fond en ce moment (le fond attend : ${cede.raison}).` : "Rien en fond en ce moment.";
  const raison = cede?.raison || "une demande passe avant";
  const une = (t) =>
    t.etat === "pause"
      ? `${t.nom} en pause : ${raison}`
      : t.etat === "attente"
        ? `${t.nom} : attend sa place sur le modèle local`
        : `${t.nom} en cours`;
  // Un travail « groupé » (TRAVAUX[x].groupe) : une phrase par état, comptée.
  const groupes = new Map(); // « travail|état » → n
  const morceaux = [];
  for (const t of travaux) {
    const g = TRAVAUX[t.travail]?.groupe;
    if (!g) {
      morceaux.push(une(t));
      continue;
    }
    const cle = `${t.travail}|${t.etat}`;
    if (!groupes.has(cle)) morceaux.push(cle);
    groupes.set(cle, (groupes.get(cle) || 0) + 1);
  }
  return morceaux
    .map((m) => {
      if (!groupes.has(m)) return m;
      const [travail, etat] = m.split("|");
      const n = groupes.get(m);
      const [un, plusieurs] = TRAVAUX[travail].groupe;
      const quoi = `${n} ${n > 1 ? plusieurs : un}`;
      if (etat === "pause") return `${quoi} en attente : ${raison}`;
      if (etat === "attente") return `${quoi} ${n > 1 ? "attendent leur" : "attend sa"} place sur le modèle local`;
      return `${quoi} en cours`;
    })
    .join(" · ");
}

// Pour les tests.
export function _reinitialiser() {
  demandes.clear();
  clavierPasse = [];
  recupClavier = null;
  derniere = null;
  bail = null;
  recuperation = null;
  clearTimeout(reveil);
  reveil = null;
  for (const v of vols) vols.delete(v);
  fonds.clear();
  horloge = () => Date.now();
}
