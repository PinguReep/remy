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
//     cours, ni pendant un court répit après (REMY_FOND_REPIT_MS, 20 s : la
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
const REPIT_MS = () => {
  const n = Number(process.env.REMY_FOND_REPIT_MS);
  return Number.isFinite(n) && n >= 0 ? n : 20_000;
};
export const BAIL_MAJ_MS = 20 * 60_000; // plus que l'intervalle de la tâche (15 min)

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
  maj: "une mise à jour s'installe",
};

const demandes = new Map(); // id → { nature, debut }
let compteur = 0;
let derniere = null; // { nature, fin }
let bail = null; // { jusqua } : la mise à jour tient le fond en pause
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
  demandes.set(id, { nature, debut: horloge() });
  if (nature !== "passive") ceder(nature);
  let fini = false;
  return () => {
    if (fini) return;
    fini = true;
    demandes.delete(id);
    if (nature !== "passive") derniere = { nature, fin: horloge() };
    programmerReveil();
  };
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

export const demandesEnCours = () => [...demandes.values()];

// Le fond doit-il céder maintenant ? null, ou { nature, raison, enCours, jusqua }.
export function fondDoitCeder(t = horloge()) {
  if (bail && t < bail.jusqua) return { nature: "maj", raison: RAISONS.maj, enCours: true, jusqua: bail.jusqua };
  const actives = [...demandes.values()].filter((d) => d.nature !== "passive");
  if (actives.length) {
    const n = actives.at(-1).nature;
    return { nature: n, raison: RAISONS[n] || RAISONS.ecriture, enCours: true, jusqua: null };
  }
  if (generationsEnCours()) return { nature: "question", raison: RAISONS.question, enCours: true, jusqua: null };
  if (derniere && t - derniere.fin < REPIT_MS()) {
    return { nature: derniere.nature, raison: RAISONS[derniere.nature] || RAISONS.ecriture, enCours: false, jusqua: derniere.fin + REPIT_MS() };
  }
  return null;
}

// --- Le bail de la mise à jour --------------------------------------------------------

export function cederPourMiseAJour({ dureeMs = BAIL_MAJ_MS } = {}) {
  bail = { jusqua: horloge() + dureeMs };
  ceder("maj");
  programmerReveil();
  return bail;
}
export function reprendreApresMiseAJour() {
  const avait = Boolean(bail);
  bail = null;
  programmerReveil();
  return avait;
}
export const bailMiseAJour = () => (bail && horloge() < bail.jusqua ? { ...bail } : null);

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
  return { travaux, cede: cede ? { nature: cede.nature, raison: cede.raison, enCours: cede.enCours } : null, ligne: phraseFond({ travaux, cede }) };
}

// « Réflexion de nuit en pause : tu viens de poser une question ».
export function phraseFond({ travaux = [], cede = null } = {}) {
  if (!travaux.length) return cede ? `Rien en fond en ce moment (le fond attend : ${cede.raison}).` : "Rien en fond en ce moment.";
  const une = (t) =>
    t.etat === "pause"
      ? `${t.nom} en pause : ${cede?.raison || "une demande passe avant"}`
      : t.etat === "attente"
        ? `${t.nom} : attend sa place sur le modèle local`
        : `${t.nom} en cours`;
  return travaux.map(une).join(" · ");
}

// Pour les tests.
export function _reinitialiser() {
  demandes.clear();
  derniere = null;
  bail = null;
  clearTimeout(reveil);
  reveil = null;
  for (const v of vols) vols.delete(v);
  fonds.clear();
  horloge = () => Date.now();
}
