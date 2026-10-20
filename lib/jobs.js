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
  conseil: "Conseil du moment réfléchi (GLM local)",
  projets: "Mémoire de projets (lecture des sessions)",
  compactage: "Compactage des longues conversations (GLM local)",
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
const charge = { taps: 0, fond: 0, surchargeJusqua: 0, attente: [] };

const fondPeutPartir = () => Date.now() >= charge.surchargeJusqua && charge.taps + charge.fond < MAX_FOND();

function reveiller() {
  while (charge.attente.length && fondPeutPartir()) {
    charge.fond++;
    charge.attente.shift()();
  }
  // Différé pour surcharge : on repasse quand elle expire.
  if (charge.attente.length && Date.now() < charge.surchargeJusqua && !charge.minuterie) {
    charge.minuterie = setTimeout(() => {
      charge.minuterie = null;
      reveiller();
    }, charge.surchargeJusqua - Date.now() + 10); // pas d'unref : un job attend ce réveil
  }
}

// Toute inférence vers les Sparks passe par ici. Hors job (un tap, un message
// de Sam) : elle part tout de suite, et compte dans la charge. Dans un job :
// elle attend une place.
export async function inference(fn) {
  const fond = Boolean(contexte.getStore()?.fond);
  if (!fond) {
    charge.taps++;
    try {
      return await fn();
    } finally {
      charge.taps--;
      reveiller();
    }
  }
  if (fondPeutPartir() && !charge.attente.length) charge.fond++;
  else await new Promise((r) => (charge.attente.push(r), reveiller()));
  const debut = Date.now();
  try {
    return await fn();
  } finally {
    charge.fond--;
    if (Date.now() - debut > LATENCE_HAUTE_MS()) signalerSurcharge(60_000, "latence haute");
    reveiller();
  }
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

const types = new Map(); // type → { circuit, executer(entree, job), priorite, maxTentatives, delaiMaxMs, attenteBaseMs }

export function enregistrer(type, { circuit, executer, priorite = 5, maxTentatives = 5, delaiMaxMs = 15 * 60_000, attenteBaseMs = 10 * 60_000 }) {
  if (!circuit || typeof executer !== "function") throw new Error(`Job ${type} : circuit et executer requis`);
  types.set(type, { circuit, executer, priorite, maxTentatives, delaiMaxMs, attenteBaseMs });
}

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
  return n;
}

const enCours = new Set();

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
  enCours.add(job.id);
  let minuterie;
  // Le travail lui-même ne s'arrête pas au délai (rien ne peut l'interrompre) :
  // le job reste « occupé » tant qu'il tourne, pour ne jamais en lancer un
  // second par-dessus (deux réflexions, deux coûts). S'il finit après coup
  // avec succès, il est noté fait.
  const travail = Promise.resolve().then(() => contexte.run({ fond: true, job: job.id }, () => t.executer(lireJSON(job.entree), job)));
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
  ).finally(() => enCours.delete(job.id));
  try {
    const delai = new Promise((_, rej) => {
      minuterie = setTimeout(() => {
        horsDelai = true;
        rej(new Error(`délai maximal dépassé (${Math.round(job.delai_max_ms / 60_000)} min)`));
      }, job.delai_max_ms);
      minuterie.unref?.();
    });
    const resultat = await Promise.race([travail, delai]);
    db().prepare("UPDATE jobs SET etat = 'fait', resultat = ?, erreur = NULL, maj_a = ? WHERE id = ?").run(
      resultat == null ? null : JSON.stringify(resultat), Date.now(), job.id,
    );
    return { id: job.id, type: job.type, etat: "fait", resultat };
  } catch (err) {
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

export function etatJobs() {
  const d = db();
  const compte = Object.fromEntries(d.prepare("SELECT etat, COUNT(*) AS n FROM jobs GROUP BY etat").all().map((r) => [r.etat, r.n]));
  const problemes = d
    .prepare("SELECT type, cle, etat, tentatives, max_tentatives, erreur, prochain_essai_a, maj_a FROM jobs WHERE erreur IS NOT NULL AND etat IN ('attente', 'abandonne') ORDER BY maj_a DESC LIMIT 5")
    .all()
    .map((r) => ({
      type: r.type,
      cle: r.cle,
      etat: r.etat,
      essais: `${r.tentatives}/${r.max_tentatives}`,
      erreur: r.erreur,
      reprise: r.etat === "attente" ? new Date(r.prochain_essai_a).toISOString() : null,
    }));
  return { compte, problemes, charge: etatCharge() };
}

// Pour les tests.
export function _reinitialiserCharge() {
  clearTimeout(charge.minuterie);
  Object.assign(charge, { taps: 0, fond: 0, surchargeJusqua: 0, attente: [], minuterie: null });
}
