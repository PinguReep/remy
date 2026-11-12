// Moteur de jobs (Lot 0, J0.9) : tout ce que Rémy fait SANS qu'on le lui
// demande — la sauvegarde et la réflexion de la nuit aujourd'hui, demain les
// synthèses, la stratégie (piste S) et Hermès.
//
//   - une file durable (table `jobs` de SQLite) : un redémarrage ne perd rien,
//     un job interrompu est repris ;
//   - une CLÉ d'unicité : deux demandes identiques (« réflexion du 14/10 »)
//     ne font qu'un job ;
//   - un échec n'est jamais noté « fait » : il est repris plus tard, de plus
//     en plus espacé, puis abandonné (visible dans /api/health) ;
//   - un INTERRUPTEUR par circuit (nuit, synthèses, événements, stratégie),
//     réglable par Sam et journalisé ;
//   - une GARDE DE CHARGE devant les Sparks : au plus N inférences de fond à la
//     fois, différées quand les Sparks saturent (429, latence). Ce que Sam
//     demande d'un tap passe toujours : il n'attend jamais derrière un job.

import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { db, transaction, lireJSON } from "./db.js";
import * as store from "./store.js";
import * as prio from "./priorite.js";

// --- Circuits -------------------------------------------------------------------------

// Un circuit = une famille de travail de fond, coupable d'un geste. « socle »
// (sauvegardes) ne se coupe pas ici : il a son propre interrupteur
// (REMY_SAUVEGARDE_AUTO), parce que couper les sauvegardes doit rester un acte
// délibéré sur la tour, pas un réglage de l'app.
export const CIRCUITS = {
  nuit: "Réflexion de la nuit",
  syntheses: "Synthèses",
  evenements: "Réactions aux événements",
  strategie: "Réflexion stratégique",
  conseil: "Conseil du moment réfléchi (modèle local)",
  projets: "Mémoire de projets (lecture des sessions)",
  compactage: "Compactage des longues conversations (modèle local)",
  regles: "Règles de Rémy (tâches avant un événement)",
};

const envCircuit = (c) => process.env[`REMY_CIRCUIT_${c.toUpperCase()}`];

// Coupé par la tour (variable d'environnement), sinon le réglage de Sam,
// sinon allumé.
export async function circuitActif(circuit) {
  if (circuit === "socle") return true;
  if (envCircuit(circuit) === "off") return false;
  if (envCircuit(circuit) === "on") return true;
  // Réglages illisibles : le circuit reste COUPÉ (comme le secours cloud) —
  // un choix de Sam ne se rallume pas parce qu'un fichier est abîmé.
  try {
    const r = await store.getReglages();
    return r?.circuits?.[circuit] !== false;
  } catch (err) {
    console.warn(`Circuit « ${circuit} » tenu coupé : réglages illisibles (${err.message})`);
    return false;
  }
}

export async function etatCircuits() {
  const r = await store.getReglages().catch(() => ({}));
  return Object.fromEntries(
    await Promise.all(
      Object.entries(CIRCUITS).map(async ([id, nom]) => [
        id,
        { nom, actif: await circuitActif(id), forceParLaTour: ["on", "off"].includes(envCircuit(id)), reglage: r?.circuits?.[id] !== false },
      ]),
    ),
  );
}

// --- Garde de charge devant les Sparks -----------------------------------------------------

const MAX_FOND = () => Math.max(1, Number(process.env.REMY_SPARKS_MAX) || 2);
const LATENCE_HAUTE_MS = () => Number(process.env.REMY_SPARKS_LATENCE_MS) || 45_000;
const contexte = new AsyncLocalStorage();
const charge = { taps: 0, fond: 0, surchargeJusqua: 0, attente: [] }; // attente : [{ partir, ctx }]

// Le fond part s'il a une place, que les Sparks ne saturent pas, et qu'aucune
// demande de Sam (ni une mise à jour) ne passe (lib/priorite.js, 12/11).
const fondPeutPartir = () => !prio.fondDoitCeder() && Date.now() >= charge.surchargeJusqua && charge.taps + charge.fond < MAX_FOND();

function reveiller() {
  // Un travail promu (Sam l'attend maintenant) sort de la file sans attendre.
  for (let i = 0; i < charge.attente.length; i++) {
    if (!charge.attente[i].ctx?.promu) continue;
    const [e] = charge.attente.splice(i--, 1);
    charge.fond++;
    e.partir();
  }
  while (charge.attente.length && fondPeutPartir()) {
    charge.fond++;
    charge.attente.shift().partir();
  }
  // Différé pour surcharge : on repasse quand elle expire.
  if (charge.attente.length && Date.now() < charge.surchargeJusqua && !charge.minuterie) {
    charge.minuterie = setTimeout(() => {
      charge.minuterie = null;
      reveiller();
    }, charge.surchargeJusqua - Date.now() + 10); // pas d'unref : un job attend ce réveil
  }
}

// La demande finie (et son répit), le bail de la mise à jour levé : le fond repart.
prio.surLibre(() => reveiller());

// Un job en pause pendant une mise à jour : marqué dans la file, pour que le
// redémarrage le reprenne sans compter d'essai (reprendreInterrompus).
export const MARQUE_PAUSE_MAJ = "en pause : mise à jour";
function marquerPauseMaj(ctx, oui) {
  if (!ctx?.job || Boolean(ctx.marqueMaj) === oui) return;
  try {
    if (oui) db().prepare("UPDATE jobs SET erreur = ? WHERE id = ? AND etat = 'en_cours'").run(MARQUE_PAUSE_MAJ, ctx.job);
    else db().prepare("UPDATE jobs SET erreur = NULL WHERE id = ? AND etat = 'en_cours' AND erreur = ?").run(ctx.job, MARQUE_PAUSE_MAJ);
    ctx.marqueMaj = oui;
  } catch (err) {
    console.warn("Jobs : pause pour la mise à jour non notée —", err.message);
  }
}

// Attendre une place : en pause (une demande passe) ou en attente (le modèle
// est pris). Le temps de pause ne compte pas dans le délai du job.
async function prendrePlace(ctx) {
  if (fondPeutPartir() && !charge.attente.length) return void charge.fond++;
  const t0 = Date.now();
  let cession = prio.fondDoitCeder();
  const noter = () => {
    const c = prio.fondDoitCeder();
    cession = c || cession;
    if (!ctx) return;
    ctx.etat = c ? "pause" : "attente";
    if (c?.nature === "maj") marquerPauseMaj(ctx, true);
  };
  noter();
  const suivi = ctx ? setInterval(noter, 1_000) : null; // l'écran suit pause / attente
  suivi?.unref?.();
  await new Promise((partir) => (charge.attente.push({ partir, ctx }), reveiller()));
  clearInterval(suivi);
  if (ctx) {
    if (cession) ctx.pauseMs += Date.now() - t0;
    marquerPauseMaj(ctx, false);
  }
}

// Toute inférence vers les Sparks passe par ici. Hors job (un tap, un message
// de Sam) : elle part tout de suite, compte dans la charge, et fait céder le
// fond. Dans un job (ou `enFond`) : elle attend une place, et qu'aucune
// demande ne passe. `fn(signal)` : `signal` (fond seulement) coupe l'appel
// quand une demande arrive, si `interruptible` — l'appel est alors REFAIT en
// entier, plus tard : il ne doit rien écrire lui-même (un appel au modèle,
// rien de plus ; ce qui suit ne s'exécute qu'avec sa réponse).
export async function inference(fn, { interruptible = false } = {}) {
  const ctx = contexte.getStore();
  const fond = Boolean(ctx?.fond) && !ctx.promu;
  if (!fond) {
    charge.taps++;
    const fin = prio.debutDemande("modele");
    try {
      return await fn(null);
    } finally {
      charge.taps--;
      fin();
      reveiller();
    }
  }
  for (;;) {
    await prendrePlace(ctx);
    const vol = prio.envol({ interruptible, ctx });
    const debut = Date.now();
    if (ctx) Object.assign(ctx, { etat: "modele", appelInterruptible: interruptible });
    let cede = false;
    try {
      return await fn(vol.signal);
    } catch (err) {
      if (!vol.cede()) throw err;
      cede = true; // coupé pour céder la place : refait quand elle se libère
      if (ctx) {
        ctx.pauseMs += Date.now() - debut;
        ctx.cessions = (ctx.cessions || 0) + 1;
      }
    } finally {
      vol.fin();
      if (ctx) Object.assign(ctx, { etat: "actif", appelInterruptible: false });
      charge.fond--;
      if (!cede && Date.now() - debut > LATENCE_HAUTE_MS()) signalerSurcharge(60_000, "latence haute");
      reveiller();
    }
  }
}

// Un travail de fond hors job (conseil précalculé, compactage automatique) :
// ses appels au modèle cèdent la place comme ceux d'un job. `travail` : son
// identifiant dans lib/priorite.js. Rend la promesse, avec `.ctx` (à passer à
// `promouvoir` quand Sam se met à l'attendre).
export function enFond(travail, fn) {
  const ctx = prio.debutFond(travail);
  const p = Promise.resolve()
    .then(() => contexte.run(ctx, fn))
    .finally(() => prio.finFond(ctx));
  p.ctx = ctx;
  return p;
}

// Sam attend maintenant ce travail (« compacter » d'un tap pendant le
// compactage automatique du même fil) : il ne cède plus, et sort de la file.
export function promouvoir(ctx) {
  if (!ctx) return;
  ctx.promu = true;
  reveiller();
}

// La mise à jour automatique arrive (lib/maj-auto-serveur.js) : le fond se met
// en pause (bail de 20 min, renouvelé à chaque passage), aucun job ne
// commence, les appels interruptibles en vol sont coupés et reviennent en
// pause. Rend vrai quand plus aucun n'est en vol.
export async function cederPourMiseAJour({ dureeMs, reposMs = 3_000 } = {}) {
  prio.cederPourMiseAJour(dureeMs ? { dureeMs } : {});
  reveiller();
  return prio.attendreRepos(reposMs);
}

// Les Sparks saturent (429, latence) : le fond attend, les taps non.
export function signalerSurcharge(ms = 60_000, pourquoi = "occupées") {
  const jusqua = Date.now() + ms;
  if (jusqua > charge.surchargeJusqua) {
    charge.surchargeJusqua = jusqua;
    console.warn(`Sparks ${pourquoi} : travail de fond différé de ${Math.round(ms / 1000)} s`);
  }
}

export const etatCharge = () => ({
  taps: charge.taps,
  fond: charge.fond,
  enAttente: charge.attente.length,
  max: MAX_FOND(),
  surcharge: Date.now() < charge.surchargeJusqua ? new Date(charge.surchargeJusqua).toISOString() : null,
});

export const dansUnJob = () => Boolean(contexte.getStore()?.fond);

// --- Types de jobs ------------------------------------------------------------------------

const types = new Map(); // type → { circuit, executer(entree, job), priorite, maxTentatives, delaiMaxMs, attenteBaseMs, repriseJusqua }

// `repriseJusqua(entree, job)` (facultatif) : jusqu'à quand (ms) une panne qui
// passe d'elle-même — erreur marquée `indisponible` : modèle local éteint ou
// saturé — est retentée toutes les REMY_REPRISE_LOCAL_MIN minutes (20) SANS
// compter d'échec. La réflexion de la nuit (29/10) : les Sparks éteintes à 4 h
// ne la font plus abandonner à 5 h ; elle repart dès qu'elles reviennent,
// jusqu'à 8 h. Un essai = une sonde /models : rien ne martèle les Sparks.
export function enregistrer(type, { circuit, executer, priorite = 5, maxTentatives = 5, delaiMaxMs = 15 * 60_000, attenteBaseMs = 10 * 60_000, repriseJusqua = null }) {
  if (!circuit || typeof executer !== "function") throw new Error(`Job ${type} : circuit et executer requis`);
  types.set(type, { circuit, executer, priorite, maxTentatives, delaiMaxMs, attenteBaseMs, repriseJusqua });
}
// Les types enregistrés (le classement de lib/priorite.js doit tous les connaître : testé).
export const typesDeJobs = () => [...types.keys()];
const repriseLocaleMs = () => (Number(process.env.REMY_REPRISE_LOCAL_MIN) || 20) * 60_000;

// Reprise espacée : 10 min, 20, 40, 80… plafonnée à 2 h (une réflexion qui
// échoue ne relance plus Claude toutes les 10 minutes toute la journée).
export const attenteAvantEssai = (tentatives, base = 10 * 60_000) => Math.min(2 * 3600_000, base * 2 ** Math.max(0, tentatives - 1));

// --- La file ------------------------------------------------------------------------------

const ligne = (r) => (r ? { ...r, entree: lireJSON(r.entree), resultat: lireJSON(r.resultat) } : null);

export function lireJob(id) {
  return ligne(db().prepare("SELECT * FROM jobs WHERE id = ?").get(id));
}

export function jobParCle(cle) {
  return ligne(db().prepare("SELECT * FROM jobs WHERE cle = ?").get(cle));
}

// Demande un job. Avec une `cle` : si un job de même clé existe déjà (en
// attente, en cours, fait ou abandonné), aucun second n'est créé — la demande
// est fusionnée, et la priorité la plus haute (le plus petit nombre) l'emporte.
export function planifier(type, { cle = null, entree = null, priorite = null, quand = Date.now() } = {}) {
  const t = types.get(type);
  if (!t) throw new Error(`Type de job inconnu : ${type}`);
  return transaction((d) => {
    if (cle) {
      const deja = d.prepare("SELECT * FROM jobs WHERE cle = ?").get(cle);
      if (deja) {
        const p = Math.min(deja.priorite, priorite ?? t.priorite);
        if (p !== deja.priorite) d.prepare("UPDATE jobs SET priorite = ?, maj_a = ? WHERE id = ?").run(p, Date.now(), deja.id);
        return { id: deja.id, fusionne: true, etat: deja.etat };
      }
    }
    const id = crypto.randomUUID();
    const maintenant = Date.now();
    d.prepare(`
      INSERT INTO jobs (id, type, circuit, cle, priorite, etat, entree, tentatives, max_tentatives, delai_max_ms, prochain_essai_a, cree_a, maj_a)
      VALUES (?, ?, ?, ?, ?, 'attente', ?, 0, ?, ?, ?, ?, ?)`).run(
      id, type, t.circuit, cle, priorite ?? t.priorite, entree == null ? null : JSON.stringify(entree),
      t.maxTentatives, t.delaiMaxMs, quand, maintenant, maintenant,
    );
    return { id, fusionne: false, etat: "attente" };
  });
}

// Un job périodique (la réflexion de la nuit) encore en attente quand le
// suivant est demandé ne sert plus à rien : il est « périmé », pas rejoué en
// retard (réactiver le circuit « nuit » un soir ne relance pas les nuits
// manquées).
export function perimer(type, cleGardee) {
  return db()
    .prepare("UPDATE jobs SET etat = 'perime', maj_a = ? WHERE type = ? AND etat = 'attente' AND cle IS NOT ?")
    .run(Date.now(), type, cleGardee).changes;
}

// Au démarrage : un job resté « en cours » a été coupé par un arrêt de la
// tour. Il repart (la tentative compte : un job qui fait tomber la tour ne
// boucle pas indéfiniment).
export function reprendreInterrompus() {
  const maintenant = Date.now();
  // Mis en pause pour une mise à jour (entre deux étapes : rien d'écrit à
  // moitié) : repris tout de suite, sans compter l'essai (12/11).
  const pauses = db()
    .prepare("UPDATE jobs SET etat = 'attente', tentatives = MAX(0, tentatives - 1), erreur = NULL, prochain_essai_a = ?, maj_a = ? WHERE etat = 'en_cours' AND erreur = ?")
    .run(maintenant, maintenant, MARQUE_PAUSE_MAJ).changes;
  if (pauses) console.warn(`Jobs : ${pauses} job(s) mis en pause pour la mise à jour, repris (essai non compté)`);
  // Un job qui a déjà épuisé ses essais est sans doute CELUI qui fait tomber la
  // tour : abandonné, pas relancé à chaque démarrage.
  const abandonnes = db()
    .prepare("UPDATE jobs SET etat = 'abandonne', erreur = 'interrompu par un arrêt de la tour, essais épuisés', maj_a = ? WHERE etat = 'en_cours' AND tentatives >= max_tentatives")
    .run(maintenant).changes;
  const n = db()
    .prepare("UPDATE jobs SET etat = 'attente', erreur = 'interrompu par un arrêt de la tour', prochain_essai_a = ?, maj_a = ? WHERE etat = 'en_cours'")
    .run(maintenant, maintenant).changes;
  if (n) console.warn(`Jobs : ${n} job(s) interrompu(s) par un arrêt, repris`);
  if (abandonnes) console.error(`Jobs : ${abandonnes} job(s) abandonné(s) après des arrêts répétés`);
  return n + pauses;
}

const enCours = new Map(); // id → type

// Les types des jobs qui tournent en ce moment dans ce processus (la mise à
// jour automatique attend qu'ils aient fini : lib/maj-auto-serveur.js).
export const jobsEnCours = () => [...enCours.values()];

// Prend le job s'il est encore en attente (deux passages simultanés ne
// prennent jamais le même).
function prendre(job) {
  return (
    db()
      .prepare("UPDATE jobs SET etat = 'en_cours', tentatives = tentatives + 1, maj_a = ? WHERE id = ? AND etat = 'attente'")
      .run(Date.now(), job.id).changes === 1
  );
}

async function executerUn(job) {
  const t = types.get(job.type);
  const tentatives = job.tentatives + 1;
  enCours.set(job.id, job.type);
  let minuterie;
  // Le travail lui-même ne s'arrête pas au délai (rien ne peut l'interrompre) :
  // le job reste « occupé » tant qu'il tourne, pour ne jamais en lancer un
  // second par-dessus (deux réflexions, deux coûts). S'il finit après coup
  // avec succès, il est noté fait.
  // Son contexte (lib/priorite.js) : ce qu'il fait (actif, appel au modèle,
  // pause), pour l'écran et pour la mise à jour.
  const ctx = prio.debutFond(job.type, { job: job.id });
  const debut = Date.now();
  const travail = Promise.resolve().then(() => contexte.run(ctx, () => t.executer(lireJSON(job.entree), job)));
  let horsDelai = false;
  travail.then(
    (res) => {
      if (horsDelai) {
        db().prepare("UPDATE jobs SET etat = 'fait', resultat = ?, erreur = NULL, maj_a = ? WHERE id = ? AND etat = 'attente'").run(
          res == null ? null : JSON.stringify(res), Date.now(), job.id,
        );
      }
    },
    () => {},
  ).finally(() => {
    enCours.delete(job.id);
    prio.finFond(ctx);
  });
  try {
    // Le délai ne compte pas le temps passé en pause pour une demande de Sam
    // ou une mise à jour (ni l'appel coupé pour elles) : céder ne fait pas
    // échouer un job.
    const delai = new Promise((_, rej) => {
      const armer = (ms) => {
        minuterie = setTimeout(() => {
          const reste = job.delai_max_ms - (Date.now() - debut - ctx.pauseMs);
          if (ctx.etat === "pause") return armer(Math.max(reste, 1_000)); // revu chaque seconde tant qu'il est en pause
          if (reste > 0) return armer(Math.max(reste, 50));
          horsDelai = true;
          ctx.horsDelai = true;
          rej(new Error(`délai maximal dépassé (${Math.round(job.delai_max_ms / 60_000)} min)`));
        }, ms);
        minuterie.unref?.();
      };
      armer(job.delai_max_ms);
    });
    const resultat = await Promise.race([travail, delai]);
    db().prepare("UPDATE jobs SET etat = 'fait', resultat = ?, erreur = NULL, maj_a = ? WHERE id = ?").run(
      resultat == null ? null : JSON.stringify(resultat), Date.now(), job.id,
    );
    return { id: job.id, type: job.type, etat: "fait", resultat };
  } catch (err) {
    // Le modèle local est éteint ou saturé : pas un échec du job. Il attend
    // son retour, jusqu'à l'heure limite du type ; au-delà, la règle commune.
    let limite = null;
    if (err?.indisponible && t.repriseJusqua) {
      try {
        limite = t.repriseJusqua(lireJSON(job.entree), job);
      } catch {}
    }
    if (Number.isFinite(limite) && Date.now() < limite) {
      const prochain = Math.min(Date.now() + repriseLocaleMs(), limite);
      db().prepare("UPDATE jobs SET etat = 'attente', tentatives = MAX(0, tentatives - 1), erreur = ?, prochain_essai_a = ?, maj_a = ? WHERE id = ? AND etat = 'en_cours'").run(
        String(err?.message || err).slice(0, 500), prochain, Date.now(), job.id,
      );
      console.warn(`Job ${job.type} en attente du modèle local (nouvel essai ${new Date(prochain).toISOString()}, au plus tard ${new Date(limite).toISOString()}) —`, err?.message || err);
      return { id: job.id, type: job.type, etat: "attente", erreur: err?.message || String(err), reprise: prochain };
    }
    const fin = tentatives >= job.max_tentatives;
    const prochain = Date.now() + attenteAvantEssai(tentatives, t.attenteBaseMs);
    db().prepare("UPDATE jobs SET etat = ?, erreur = ?, prochain_essai_a = ?, maj_a = ? WHERE id = ?").run(
      fin ? "abandonne" : "attente", String(err?.message || err).slice(0, 500), prochain, Date.now(), job.id,
    );
    console.error(`Job ${job.type} ${fin ? "abandonné" : `échoué (essai ${tentatives}/${job.max_tentatives}, reprise ${new Date(prochain).toISOString()})`} —`, err?.message || err);
    return { id: job.id, type: job.type, etat: fin ? "abandonne" : "attente", erreur: err?.message || String(err) };
  } finally {
    clearTimeout(minuterie);
  }
}

// Un passage : prend les jobs dus, par priorité puis ancienneté, un à la
// fois (la nuit est séquentielle : sauvegarde, puis réflexion). Un circuit
// coupé laisse ses jobs en attente, sans les compter comme échecs.
export async function passer({ limite = 10 } = {}) {
  const faits = [];
  const sautes = new Set();
  for (let i = 0; i < limite; i++) {
    // Une demande de Sam ou une mise à jour passe : aucun job ne commence (ils
    // partiront au passage suivant, dans 10 min au plus).
    if (prio.fondDoitCeder()) break;
    const dus = db()
      .prepare("SELECT * FROM jobs WHERE etat = 'attente' AND prochain_essai_a <= ? ORDER BY priorite, cree_a LIMIT 50")
      .all(Date.now());
    let job = null;
    for (const j of dus) {
      if (sautes.has(j.id) || enCours.has(j.id)) continue;
      if (!types.has(j.type)) {
        sautes.add(j.id);
        continue;
      }
      if (!(await circuitActif(j.circuit))) {
        sautes.add(j.id);
        continue;
      }
      if (!prendre(j)) {
        sautes.add(j.id);
        continue;
      }
      job = j;
      break;
    }
    if (!job) break;
    faits.push(await executerUn(job));
  }
  return faits;
}

// Les échecs montrés dans /api/health. Pas ceux qu'un succès du même type a
// suivis (la réflexion d'hier abandonnée, celle de cette nuit faite : plus
// d'alerte), ni ceux de plus de 48 h (REMY_ALERTE_JOBS_H) : le 29/10, une
// réflexion abandonnée des jours plus tôt — par une version d'avant, au message
// d'avant — restait affichée, et semblait dire que le modèle était en panne.
const ALERTE_MAX_MS = () => (Number(process.env.REMY_ALERTE_JOBS_H) || 48) * 3600_000;

export function etatJobs() {
  const d = db();
  const compte = Object.fromEntries(d.prepare("SELECT etat, COUNT(*) AS n FROM jobs GROUP BY etat").all().map((r) => [r.etat, r.n]));
  const problemes = d
    .prepare(`
      SELECT j.type, j.cle, j.etat, j.tentatives, j.max_tentatives, j.erreur, j.prochain_essai_a, j.maj_a FROM jobs j
      WHERE j.erreur IS NOT NULL AND j.etat IN ('attente', 'abandonne') AND j.maj_a > ?
        AND NOT EXISTS (SELECT 1 FROM jobs f WHERE f.type = j.type AND f.etat = 'fait' AND f.maj_a > j.maj_a)
      ORDER BY j.maj_a DESC LIMIT 5`)
    .all(Date.now() - ALERTE_MAX_MS())
    .map((r) => ({
      type: r.type,
      cle: r.cle,
      etat: r.etat,
      essais: `${r.tentatives}/${r.max_tentatives}`,
      erreur: r.erreur,
      a: new Date(r.maj_a).toISOString(),
      reprise: r.etat === "attente" ? new Date(r.prochain_essai_a).toISOString() : null,
    }));
  return { compte, problemes, charge: etatCharge() };
}

// Le dernier job d'un type (pour dire l'état d'une tâche rare, comme la mise à
// jour mensuelle des commerces).
export function dernierJob(type) {
  return ligne(db().prepare("SELECT * FROM jobs WHERE type = ? ORDER BY maj_a DESC LIMIT 1").get(type));
}

// Pour les tests.
export function _reinitialiserCharge() {
  clearTimeout(charge.minuterie);
  Object.assign(charge, { taps: 0, fond: 0, surchargeJusqua: 0, attente: [], minuterie: null });
}
