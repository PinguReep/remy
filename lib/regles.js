// Les règles de Rémy (Sam, 19/10) : « avant une sortie, me raser ». Motion ne
// sait pas faire du conditionnel ; Rémy, si — une première couche, simple, en
// attendant un vrai moteur de planification :
//   - une règle = des mots qui reconnaissent l'événement (« sortie, soirée,
//     resto ») + la tâche à faire avant (nom, durée, au plus tard N minutes
//     avant) ;
//   - créée en parlant à Rémy (outil regle_proposer), validée par Sam ;
//   - toutes les 3 heures, Rémy lit l'agenda et Motion sur 7 jours : un
//     événement qui correspond, sans la tâche déjà prévue → Rémy PROPOSE la
//     tâche Motion (échéance avant l'événement ; Motion la place) dans le fil
//     « Règles de Rémy ». Rien n'est écrit sans Sam.
// Aucun appel IA : des mots-clés, lisibles et prévisibles. Coupable par le
// circuit « regles ».

import crypto from "node:crypto";
import { db, transaction } from "./db.js";
import * as store from "./store.js";
import { agendaJournee } from "./google.js";
import { tachesMotion, motionEnabled } from "./motion.js";
import { PRENOM } from "./profil.js";

export const HORIZON_JOURS = 7;
const MARGE_MIN = 15; // une tâche dont l'échéance tombe dans 15 min ne sert plus
const MAX_ACTIONS = 12;
const PRIORITES = ["ASAP", "HIGH", "MEDIUM", "LOW"];
export const TITRE_FIL = "Règles de Rémy";

// « Soirée chez Léo » → « soiree chez leo »
export const normaliser = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Un mot (ou une expression) de la règle se retrouve-t-il, entier, dans le titre ?
export function correspond(mots, titre) {
  const t = ` ${normaliser(titre)} `;
  return mots.some((m) => {
    const n = normaliser(m);
    return n && t.includes(` ${n} `);
  });
}

const borne = (n, min, max, defaut) => {
  const v = Number.parseInt(n, 10);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : defaut;
};

// Ce que le modèle propose (ou que l'app envoie) → une règle propre, ou une
// erreur. La sortie du modèle peut être influencée par une page web : tout est
// borné, rien n'est exécuté.
export function nettoyerRegle(entree) {
  const e = entree || {};
  const nom = String(e.nom || "").trim().slice(0, 80);
  const mots = [...new Set((Array.isArray(e.mots) ? e.mots : Array.isArray(e.mots_cles) ? e.mots_cles : [])
    .map((m) => String(m || "").trim().slice(0, 40))
    .filter((m) => normaliser(m).length >= 2))].slice(0, 12);
  const t = e.tache || {};
  const tache = {
    nom: String(t.nom || "").trim().slice(0, 120),
    duree: borne(t.duree, 5, 480, 15),
    priorite: PRIORITES.includes(t.priorite) ? t.priorite : "MEDIUM",
  };
  const avantMin = borne(e.avant_minutes ?? e.avantMin, 0, 7 * 24 * 60, 120);
  if (!mots.length) return { erreur: "Il faut au moins un mot qui reconnaît l'événement (ex. « sortie », « soirée »)." };
  if (!tache.nom) return { erreur: "Il faut le nom de la tâche à faire avant (ex. « Rasage »)." };
  return { regle: { nom: nom || `Avant ${mots[0]} : ${tache.nom}`, mots, tache, avantMin } };
}

// « au plus tard 3 h avant », « au plus tard la veille », « avant l'événement »
export function delaiLisible(min) {
  if (!min) return "avant l'événement";
  if (min % 1440 === 0) return min === 1440 ? "au plus tard la veille" : `au plus tard ${min / 1440} jours avant`;
  if (min % 60 === 0) return `au plus tard ${min / 60} h avant`;
  return `au plus tard ${min} min avant`;
}

// Ce que Sam lit sur la carte avant de dire oui.
export const resumeRegle = (r) =>
  `Avant un événement « ${r.mots.join(" », « ")} » : « ${r.tache.nom} » (${r.tache.duree} min), ${delaiLisible(r.avantMin)}.`;

const deLigne = (l) => ({
  id: l.id,
  nom: l.nom,
  mots: JSON.parse(l.mots),
  tache: JSON.parse(l.tache),
  avantMin: l.avant_min,
  actif: Boolean(l.actif),
  creeA: l.cree_a,
});

export function listerRegles({ actives = false } = {}) {
  return db()
    .prepare(`SELECT * FROM regles ${actives ? "WHERE actif = 1" : ""} ORDER BY cree_a`)
    .all()
    .map(deLigne);
}

// Une règle redemandée (J+30 : trois « Rasage avant une sortie ») n'est pas
// recréée : même tâche et un mot en commun → la règle existante, complétée
// des mots nouveaux, réglée comme la carte validée (délai, durée, priorité) et
// réactivée ; rien de nouveau → rendue telle quelle.
export function creerRegle(regle, { convId = null } = {}) {
  const { regle: r, erreur } = nettoyerRegle(regle);
  if (erreur) throw Object.assign(new Error(erreur), { status: 400 });
  const tache = normaliser(r.tache.nom);
  const mots = new Set(r.mots.map(normaliser));
  const jumelle = listerRegles().find((x) => normaliser(x.tache.nom) === tache && x.mots.some((m) => mots.has(normaliser(m))));
  if (jumelle) {
    const connus = new Set(jumelle.mots.map(normaliser));
    const ajouts = r.mots.filter((m) => !connus.has(normaliser(m)));
    // Redemandée avec un autre délai ou une autre durée (« 2 h avant » au lieu
    // de « la veille ») : la carte que Sam a validée l'emporte.
    const reglage = jumelle.avantMin !== r.avantMin || jumelle.tache.duree !== r.tache.duree || jumelle.tache.priorite !== r.tache.priorite;
    if (!ajouts.length && !reglage && jumelle.actif) return { ...jumelle, deja: true };
    db().prepare("UPDATE regles SET mots = ?, tache = ?, avant_min = ?, actif = 1 WHERE id = ?")
      .run(JSON.stringify([...jumelle.mots, ...ajouts].slice(0, 12)), JSON.stringify({ ...jumelle.tache, duree: r.tache.duree, priorite: r.tache.priorite }), r.avantMin, jumelle.id);
    return { ...listerRegles().find((x) => x.id === jumelle.id), fusionnee: true };
  }
  const id = `regle-${crypto.randomUUID().slice(0, 8)}`;
  db()
    .prepare("INSERT INTO regles (id, nom, mots, tache, avant_min, actif, cree_a, conv_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
    .run(id, r.nom, JSON.stringify(r.mots), JSON.stringify(r.tache), r.avantMin, Date.now(), convId);
  return listerRegles().find((x) => x.id === id);
}

export function reglerRegle(id, { actif }) {
  const r = db().prepare("UPDATE regles SET actif = ? WHERE id = ?").run(actif ? 1 : 0, String(id));
  if (!r.changes) throw Object.assign(new Error("Règle introuvable."), { status: 404 });
  return listerRegles().find((x) => x.id === id);
}

export function supprimerRegle(id) {
  transaction((d) => {
    const r = d.prepare("DELETE FROM regles WHERE id = ?").run(String(id));
    if (!r.changes) throw Object.assign(new Error("Règle introuvable."), { status: 404 });
    d.prepare("DELETE FROM regles_vues WHERE regle_id = ?").run(String(id));
  });
}

// --- La vérification ------------------------------------------------------------

const debutEvenement = (e) => {
  if (e.start?.dateTime) return Date.parse(e.start.dateTime);
  // Toute la journée : on vise la matinée (heure locale de la tour).
  if (e.start?.date) return Date.parse(`${e.start.date}T10:00:00`);
  return NaN;
};

const quand = (ms) =>
  new Date(ms).toLocaleString("fr-FR", { timeZone: process.env.REMY_TZ || "Europe/Paris", weekday: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

// Le fil où Rémy dépose ses propositions de règles (créé au premier besoin).
async function filDesRegles() {
  const liste = await store.listConversations();
  const existant = liste.find((c) => c.systeme === "regles");
  if (existant) return store.getConversation(existant.id);
  const conv = { id: crypto.randomUUID(), title: TITRE_FIL, systeme: "regles", messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  await store.putConversation(conv);
  return conv;
}

// Une passe : rend un bilan (compteurs, jamais de contenu). `sources` : pour
// les tests ({ agenda, motion }).
export async function verifierRegles({ maintenant = Date.now(), sources = null } = {}) {
  const regles = listerRegles({ actives: true });
  if (!regles.length) return { regles: 0, evenements: 0, proposees: 0, deja: 0 };
  const fin = maintenant + HORIZON_JOURS * 86_400_000;
  const agenda = sources ? sources.agenda : await agendaJournee(maintenant, fin).catch(() => null);
  const taches = sources ? sources.motion : motionEnabled() ? await tachesMotion().catch(() => null) : null;

  const evenements = [];
  for (const e of agenda || []) {
    const debut = debutEvenement(e);
    if (Number.isFinite(debut) && debut > maintenant && debut <= fin) evenements.push({ cle: `agenda:${e.id}:${debut}`, titre: e.summary || "", debut });
  }
  for (const t of taches || []) {
    const debut = Date.parse(t.dueDate || "");
    if (t.completed || !Number.isFinite(debut) || debut <= maintenant || debut > fin) continue;
    evenements.push({ cle: `motion:${t.id}`, titre: t.name || "", debut });
  }

  const vue = db().prepare("SELECT statut FROM regles_vues WHERE regle_id = ? AND evenement = ?");
  const noter = db().prepare("INSERT OR IGNORE INTO regles_vues (regle_id, evenement, statut, a) VALUES (?, ?, ?, ?)");
  const actions = [];
  const lignes = [];
  let deja = 0;
  // Une seule action par événement et par tâche, même si plusieurs règles
  // (ou des règles en double d'avant le 24/10) le reconnaissent.
  const memeTache = new Map();
  for (const r of regles) {
    const n = normaliser(r.tache.nom);
    memeTache.set(n, [...(memeTache.get(n) || []), r.id]);
  }
  const prises = new Set();
  for (const r of regles) {
    const nomTache = normaliser(r.tache.nom);
    for (const ev of evenements) {
      if (actions.length >= MAX_ACTIONS) break;
      // La tâche de la règle elle-même ne déclenche rien (« Rasage avant sortie »).
      if (normaliser(ev.titre).includes(nomTache) || !correspond(r.mots, ev.titre)) continue;
      if (vue.get(r.id, ev.cle)) continue;
      const cle = `${ev.cle}|${nomTache}`;
      if (prises.has(cle) || memeTache.get(nomTache).some((autre) => autre !== r.id && vue.get(autre, ev.cle))) {
        noter.run(r.id, ev.cle, "deja", maintenant);
        continue;
      }
      prises.add(cle);
      const echeance = ev.debut - r.avantMin * 60_000;
      if (echeance < maintenant + MARGE_MIN * 60_000) continue;
      // Déjà prévue (par Sam, par Motion, ou une proposition acceptée) : rien.
      const prevue = (taches || []).some((t) => {
        const d = Date.parse(t.dueDate || "");
        return !t.completed && normaliser(t.name).includes(nomTache) && Number.isFinite(d) && d <= ev.debut && d >= ev.debut - 3 * 86_400_000;
      });
      if (prevue) {
        noter.run(r.id, ev.cle, "deja", maintenant);
        deja++;
        continue;
      }
      actions.push({
        type: "creer",
        nom: r.tache.nom,
        duree: String(r.tache.duree),
        priorite: r.tache.priorite,
        echeance: new Date(echeance).toISOString(),
        description: `Règle « ${r.nom} » : avant « ${ev.titre} » (${quand(ev.debut)}).`,
        regle: r.id,
        evenement: ev.cle,
      });
      lignes.push(`- « ${r.tache.nom} » avant **${ev.titre}** (${quand(ev.debut)}) — ${delaiLisible(r.avantMin)}`);
    }
  }
  if (!actions.length) return { regles: regles.length, evenements: evenements.length, proposees: 0, deja };

  const conv = await filDesRegles();
  conv.messages.push({
    role: "assistant",
    model: "remy",
    tier: "regles",
    usd: 0,
    content: `D'après tes règles, je te propose :\n\n${lignes.join("\n")}\n\nMotion placera chaque tâche avant son échéance. Rien n'est créé sans ton accord.`,
    proposal: {
      id: crypto.randomUUID(),
      source: "motion",
      resume: `Tâches prévues par tes règles, avant tes prochains événements.`,
      actions: actions.map(({ regle, evenement, ...a }) => a),
      statut: "en_attente",
      creeA: maintenant,
    },
  });
  conv.updatedAt = Date.now();
  await store.putConversation(conv);
  transaction(() => {
    for (const a of actions) noter.run(a.regle, a.evenement, "propose", maintenant);
  });
  console.warn(`Règles de Rémy : ${actions.length} tâche(s) proposée(s) à ${PRENOM}`);
  return { regles: regles.length, evenements: evenements.length, proposees: actions.length, deja, conversation: conv.id };
}
