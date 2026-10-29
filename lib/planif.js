// Ce que faisait le cron de Vercel, sur la tour : la nuit de Rémy — la
// sauvegarde (à partir de 3 h), puis la réflexion (à partir de 4 h), heure de
// Paris. Rattrapées au réveil si la tour était éteinte. Interrupteur général :
// REMY_PLANIF=off.
//
// Depuis le Lot 0 (J0.9), ce sont des JOBS (lib/jobs.js) : un échec n'est
// plus jamais noté « fait » — la réflexion qui rend une réponse vide, par
// exemple —, la reprise est espacée au lieu de relancer toutes les 10 minutes,
// et la réflexion se coupe d'un geste (circuit « nuit »).

import fs from "node:fs";
import path from "node:path";
import { dossierBase } from "./store.js";
import { ecrireAtomique } from "./coffre.js";
import * as jobs from "./jobs.js";
import { sourceActive, synchroniser as synchroniserConnaissances } from "./connaissances/sync.js";
import { listerRegles, verifierRegles } from "./regles.js";
import { purger as purgerLieux } from "./lieux.js";
import { activiteAllumee, collecter as collecterActivite, purger as purgerActivite, RELEVE_MIN } from "./activite-pc.js";
import { purgerCarnet } from "./carnet.js";
import { commercesADemander, enregistrerCommerces, finFenetreCommerces } from "./commerces-maj.js";

const HEURE = () => Number(process.env.REMY_REFLEXION_HEURE ?? 4);
const HEURE_SAUVEGARDE = () => Number(process.env.REMY_SAUVEGARDE_HEURE ?? 3);
// Jusqu'à quand la réflexion attend le modèle local éteint ou saturé (29/10) :
// 8 h, avant le réveil — et au moins 2 h après son heure.
const LIMITE = () => Math.max(Number(process.env.REMY_REFLEXION_LIMITE ?? 8), HEURE() + 2);
const TZ = process.env.REMY_TZ || "Europe/Paris";

// L'instant (ms) où il est `heure` h le `jour` (AAAA-MM-JJ) à Paris.
export function instantLocal(jour, heure, tz = TZ) {
  const [a, m, j] = String(jour).split("-").map(Number);
  const supposee = Date.UTC(a, m - 1, j, heure);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(supposee))
      .map((x) => [x.type, Number(x.value)]),
  );
  const vue = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return supposee - (vue - supposee);
}
export const limiteReflexion = (jour) => instantLocal(jour, LIMITE());
const fichier = () => path.join(dossierBase(), "planif.json");

const maintenantParis = () => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return { jour: `${p.year}-${p.month}-${p.day}`, heure: Number(p.hour) };
};

// planif.json : la trace d'avant les jobs, gardée à jour (une nuit déjà faite
// avant la mise à jour n'est pas refaite).
function lire() {
  try {
    return JSON.parse(fs.readFileSync(fichier(), "utf8"));
  } catch {
    return {};
  }
}
const noter = (champ, jour) => ecrireAtomique(fichier(), JSON.stringify({ ...lire(), [champ]: jour, at: Date.now() }, null, 2));

const sauvegardeAuto = () => process.env.REMY_SAUVEGARDE_AUTO !== "off" && Boolean(process.env.REMY_SAUVEGARDE_CLE);

// Les deux jobs de la nuit. `faire` / `reflechir` sont injectés (server.js),
// pour que les tests les remplacent.
export function enregistrerNuit({ reflechir, faireSauvegarde }) {
  if (faireSauvegarde) {
    jobs.enregistrer("sauvegarde-nuit", {
      circuit: "socle",
      priorite: 1, // avant la réflexion
      maxTentatives: 6,
      async executer({ jour }) {
        if (!sauvegardeAuto()) throw new Error("sauvegarde automatique coupée ou sans clé");
        const r = await faireSauvegarde({ raison: "nuit" });
        const ratees = r.copies.filter((c) => !c.ok);
        console.log(`Planificateur : sauvegarde ${r.nom}${ratees.length ? ` — ÉCHEC ${ratees.map((c) => c.nom).join(", ")}` : ""}`);
        // Seule la copie locale conditionne « fait » : un disque externe
        // absent est signalé par /api/health, pas rejoué toute la nuit.
        if (!r.copies.find((c) => c.nom === "locale")?.ok) throw new Error("copie locale ratée");
        noter("sauvegarde", jour);
        return { nom: r.nom, ratees: ratees.map((c) => c.nom) };
      },
    });
  }
  if (reflechir) {
    jobs.enregistrer("reflexion-nuit", {
      circuit: "nuit",
      priorite: 2,
      maxTentatives: 4,
      delaiMaxMs: 30 * 60_000,
      // Modèle local éteint ou saturé : retentée toutes les 20 min jusqu'à 8 h,
      // sans compter d'échec (lib/jobs.js).
      repriseJusqua: ({ jour } = {}) => (jour ? limiteReflexion(jour) : null),
      async executer({ jour }) {
        console.log(`Planificateur : réflexion de la nuit (${jour})`);
        const r = await reflechir();
        // `{ ok: false }` (réponse vide du modèle…) est un ÉCHEC : le briefing
        // d'hier reste, et la réflexion sera retentée (défaut n°16).
        if (r?.ok === false) throw new Error(r.erreur || "réflexion sans résultat");
        noter("reflexion", jour);
        console.log("Planificateur : réflexion faite", r?.empty || r?.skipped ? "(rien de neuf)" : "");
        return { vide: Boolean(r?.empty), saute: r?.skipped || null };
      },
    });
  }
}

// Un passage du planificateur : demande les jobs du jour quand leur heure est
// venue (la clé du jour les rend uniques), puis exécute ce qui est dû.
export async function passage() {
  const { jour, heure } = maintenantParis();
  const deja = lire();
  try {
    if (sauvegardeAuto() && heure >= HEURE_SAUVEGARDE() && deja.sauvegarde !== jour) {
      jobs.perimer("sauvegarde-nuit", `sauvegarde-nuit:${jour}`);
      jobs.planifier("sauvegarde-nuit", { cle: `sauvegarde-nuit:${jour}`, entree: { jour } });
    }
    if (heure >= HEURE() && deja.reflexion !== jour) {
      jobs.perimer("reflexion-nuit", `reflexion-nuit:${jour}`);
      jobs.planifier("reflexion-nuit", { cle: `reflexion-nuit:${jour}`, entree: { jour } });
    }
    // Mémoire de projets : relire les sessions accordées toutes les 30 min
    // (lecture seule, sans IA). Rien tant que la source n'est pas accordée.
    let accorde = false;
    try {
      accorde = sourceActive();
    } catch (err) {
      console.warn("Mémoire de projets : base illisible —", err.message);
    }
    if (accorde) {
      const tranche = Math.floor(Date.now() / (30 * 60_000));
      jobs.planifier("connaissances-sync", { cle: `connaissances-sync:${tranche}` });
    }
    // Localisation : ce qui a plus de 90 jours s'efface, une fois par jour.
    if (heure >= HEURE_SAUVEGARDE()) jobs.planifier("lieux-purge", { cle: `lieux-purge:${jour}` });
    // Activité du PC : ActivityWatch relu toutes les 20 min (sans IA), dès que
    // Sam l'a allumée ; au-delà de 90 jours, effacé une fois par jour.
    let activite = false;
    try {
      activite = activiteAllumee();
    } catch (err) {
      console.warn("Activité du PC : base illisible —", err.message);
    }
    if (activite) jobs.planifier("activite-pc-releve", { cle: `activite-pc-releve:${Math.floor(Date.now() / (RELEVE_MIN * 60_000))}` });
    if (heure >= HEURE_SAUVEGARDE()) jobs.planifier("activite-pc-purge", { cle: `activite-pc-purge:${jour}` });
    // Carnet : les articles pris depuis 7 jours et les rappels faits depuis 30
    // jours s'effacent (doucement : récupérables), une fois par jour.
    if (heure >= HEURE_SAUVEGARDE()) jobs.planifier("carnet-purge", { cle: `carnet-purge:${jour}` });
    // Règles de Rémy : l'agenda et Motion relus toutes les 3 h, sans IA, dès
    // qu'une règle est active (de 7 h à 22 h : pas de proposition la nuit).
    let regles = 0;
    try {
      regles = listerRegles({ actives: true }).length;
    } catch (err) {
      console.warn("Règles de Rémy : base illisible —", err.message);
    }
    if (regles && heure >= 7 && heure < 22) {
      const tranche = Math.floor(Date.now() / (3 * 3600_000));
      jobs.planifier("regles-verifier", { cle: `regles-verifier:${tranche}` });
    }
    // Commerces : la base d'OpenStreetMap remise à jour une nuit par mois au
    // plus, sans IA (lib/commerces-maj.js).
    let commerces = null;
    try {
      commerces = commercesADemander({ heure });
    } catch (err) {
      console.warn("Commerces : base illisible —", err.message);
    }
    if (commerces) {
      jobs.planifier("commerces-maj", {
        cle: `commerces-maj:${jour}`,
        entree: { jour, departements: commerces.departements, avant: instantLocal(jour, finFenetreCommerces()) },
      });
    }
  } catch (err) {
    // Type non enregistré (pas de sauvegarde injectée) : rien à demander.
    if (!/Type de job inconnu/.test(err.message)) throw err;
  }
  return jobs.passer();
}

let enCours = false;
export async function tick() {
  if (enCours) return [];
  enCours = true;
  try {
    return await passage();
  } catch (err) {
    console.error("Planificateur :", err.message);
    return [];
  } finally {
    enCours = false;
  }
}

// La lecture des sessions (mémoire de projets) : sans IA, coupable par le
// circuit « projets », et seulement quand la source est accordée.
export function enregistrerConnaissances() {
  jobs.enregistrer("connaissances-sync", {
    circuit: "projets",
    priorite: 8,
    maxTentatives: 3,
    async executer() {
      const r = await synchroniserConnaissances();
      if (r.ok === false) return { saute: r.raison };
      return { lus: r.lus, passages: r.passages, erreurs: r.erreurs };
    },
  });
}

// La localisation : effacer ce qui dépasse 90 jours (sans IA, toujours actif).
export function enregistrerLieux() {
  jobs.enregistrer("lieux-purge", {
    circuit: "socle",
    priorite: 9,
    maxTentatives: 3,
    async executer() {
      return { effaces: purgerLieux() };
    },
  });
  // Même ménage pour le carnet (sans IA, toujours actif).
  jobs.enregistrer("carnet-purge", {
    circuit: "socle",
    priorite: 9,
    maxTentatives: 3,
    async executer() {
      return purgerCarnet();
    },
  });
}

// L'activité du PC : sans IA. Pas de circuit à part : elle a son propre
// interrupteur (l'app) et REMY_ACTIVITE_PC=off sur la tour. ActivityWatch
// absent n'est pas un échec (le relevé suivant réessaie, sans bruit).
export function enregistrerActivitePC() {
  jobs.enregistrer("activite-pc-releve", {
    circuit: "socle",
    priorite: 8,
    maxTentatives: 2,
    delaiMaxMs: 5 * 60_000,
    async executer() {
      return await collecterActivite();
    },
  });
  jobs.enregistrer("activite-pc-purge", {
    circuit: "socle",
    priorite: 9,
    maxTentatives: 3,
    async executer() {
      return { effaces: purgerActivite() };
    },
  });
}

// Les règles de Rémy : sans IA, coupables par le circuit « regles ».
export function enregistrerRegles() {
  jobs.enregistrer("regles-verifier", {
    circuit: "regles",
    priorite: 7,
    maxTentatives: 2,
    async executer() {
      const r = await verifierRegles();
      return { regles: r.regles, evenements: r.evenements, proposees: r.proposees, deja: r.deja };
    },
  });
}

export function demarrerPlanificateur(runReflection, faireSauvegarde = null) {
  if (process.env.REMY_PLANIF === "off") return;
  enregistrerNuit({ reflechir: runReflection, faireSauvegarde });
  enregistrerConnaissances();
  enregistrerRegles();
  enregistrerLieux();
  enregistrerActivitePC();
  enregistrerCommerces();
  try {
    jobs.reprendreInterrompus();
  } catch (err) {
    console.error("Planificateur : file des jobs illisible —", err.message);
  }
  setTimeout(tick, 60_000).unref?.(); // laisse le serveur démarrer
  setInterval(tick, 10 * 60_000).unref();
}
