// « À trancher » et la revue du dimanche (24/10). Tout s'empilait : cartes en
// attente dans des fils oubliés, rappels sans date ou redits, articles pris
// jamais retirés, fils d'un seul échange, idées jamais relues. Ici, une seule
// lecture qui rassemble, et la semaine résumée par domaine.
//
// Aucun appel IA : tout est lu (conversations, carnet, journal, Motion en
// cache, briefings déjà écrits par la nuit). Les gestes passent par les routes
// existantes (chaîne d'écriture, carnet) ; ce module n'ajoute que « Plus tard »
// (un report daté), la réouverture d'une carte refusée (pour « Annuler ») et
// les trois décisions de la semaine.

import { db, transaction, lireJSON } from "./db.js";
import * as store from "./store.js";
import { etatsPropositions } from "./ecriture.js";
import { lireListes, lireRappels, lireDossiers } from "./carnet.js";
import { motionEnabled, tachesMotion } from "./motion.js";
import { itemsDe } from "./briefing.js";
import { sendJSON, readJSON, sameOrigin } from "./http.js";
import { requireAuth } from "./auth.js";

const JOUR = 86_400_000;
// Un fil d'un seul échange est « ancien » au bout de deux semaines.
export const FIL_ANCIEN_JOURS = 14;
// Un rappel sans date attend d'être rangé depuis une semaine.
export const RAPPEL_ANCIEN_JOURS = 7;
// « Plus tard » : revient dans une semaine (au plus 60 jours).
export const REPORT_JOURS = 7;
const PAR_GROUPE = 40;
const CLE_REPORTS = "a-trancher.reports";
const CLE_DECISIONS = "revue.decisions";

// --- Petits outils -------------------------------------------------------------

const lireMeta = (cle, defaut) => {
  try {
    return lireJSON(db().prepare("SELECT valeur FROM meta WHERE cle = ?").get(cle)?.valeur, defaut) ?? defaut;
  } catch {
    return defaut;
  }
};
const ecrireMeta = (cle, valeur) =>
  db().prepare("INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(cle, JSON.stringify(valeur));

// « Appeler le garage. » et « appeler  le Garage » sont le même rappel.
export const reduire = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const court = (s, n = 140) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// --- Reports (« Plus tard ») -----------------------------------------------------

const CLE = /^[a-z]+:[A-Za-z0-9:_.\-]{1,200}$/;

/** Les reports encore valables (les échus sont oubliés à l'écriture suivante). */
export function reports(maintenant = Date.now()) {
  const r = lireMeta(CLE_REPORTS, {});
  return Object.fromEntries(Object.entries(r && typeof r === "object" ? r : {}).filter(([, t]) => Number(t) > maintenant));
}

export function reporter(cle, { jours = REPORT_JOURS, maintenant = Date.now() } = {}) {
  if (!CLE.test(String(cle || ""))) throw Object.assign(new Error("Clé invalide"), { statut: 400 });
  const n = Math.min(60, Math.max(1, Math.round(Number(jours) || REPORT_JOURS)));
  const jusqua = maintenant + n * JOUR;
  transaction(() => ecrireMeta(CLE_REPORTS, { ...reports(maintenant), [cle]: jusqua }));
  return { ok: true, cle, jusqua };
}

export function annulerReport(cle, maintenant = Date.now()) {
  const r = reports(maintenant);
  delete r[cle];
  transaction(() => ecrireMeta(CLE_REPORTS, r));
  return { ok: true };
}

// --- Réouvrir une carte refusée (« Annuler » après « Non ») ---------------------

// Seul un refus se défait ici : une carte appliquée s'annule par le journal
// (chaîne d'écriture), jamais en effaçant son état.
export function rouvrir(propositionId) {
  const id = String(propositionId || "").slice(0, 200);
  const r = db().prepare("DELETE FROM propositions WHERE id = ? AND statut = 'refuse'").run(id);
  if (!r.changes) throw Object.assign(new Error("Cette carte n'est pas refusée : rien à rouvrir."), { statut: 409 });
  return { ok: true };
}

// --- Ce qui attend -----------------------------------------------------------------

async function cartesEnAttente() {
  const lignes = [];
  for (const conv of await store.toutesLesConversations()) {
    // Fil importé : lecture seule, rien à appliquer.
    if (conv?.origine || !conv?.messages?.some((m) => m?.proposal)) continue;
    const c = conv;
    etatsPropositions(conv);
    conv.messages.forEach((m) => {
      const p = m?.proposal;
      if (!p?.id || !Array.isArray(p.actions) || !p.actions.length) return;
      if (p.statut && p.statut !== "en_attente") return;
      // Appliquée avant le Lot 0 : pas d'état en base, mais une trace au journal.
      if (!p.statut && (p.ledgerId || p.annulee)) return;
      const noms = p.actions.map((a) => a?.nom || a?.titre).filter(Boolean);
      lignes.push({
        cle: `carte:${p.id}`,
        type: "carte",
        texte: court(p.resume || noms.join(", ") || "Proposition de Rémy"),
        detail: court(`${c.systeme === "regles" ? "Règles de Rémy" : c.title || "Conversation"} · ${p.actions.length} action${p.actions.length > 1 ? "s" : ""}`, 90),
        depuis: m.ts || conv.updatedAt || null,
        convId: c.id,
        propositionId: p.id,
        source: p.source || "motion",
      });
    });
  }
  return lignes.sort((a, b) => (a.depuis || 0) - (b.depuis || 0));
}

function rappelsATrancher(maintenant) {
  const ouverts = lireRappels().filter((r) => !r.fait);
  const crees = new Map(db().prepare("SELECT id, cree_a FROM rappels WHERE supprime = 0 AND fait = 0").all().map((r) => [r.id, r.cree_a]));
  // Les doublons : même texte réduit. Le plus ancien reste, les autres partent.
  const parTexte = new Map();
  for (const r of ouverts) {
    const k = reduire(r.texte);
    if (!k) continue;
    if (!parTexte.has(k)) parTexte.set(k, []);
    parTexte.get(k).push(r);
  }
  const doublons = [];
  const enDouble = new Set();
  for (const groupe of parTexte.values()) {
    if (groupe.length < 2) continue;
    groupe.sort((a, b) => (crees.get(a.id) || 0) - (crees.get(b.id) || 0));
    // On garde celui qui a une date (s'il y en a un), sinon le plus ancien.
    const garde = groupe.find((r) => r.quand) || groupe[0];
    const autres = groupe.filter((r) => r.id !== garde.id);
    for (const r of groupe) enDouble.add(r.id);
    doublons.push({
      cle: `doublon:${garde.id}`,
      type: "doublon",
      texte: court(garde.texte),
      detail: `${groupe.length} fois le même rappel`,
      depuis: crees.get(garde.id) || null,
      rappelId: garde.id,
      doublons: autres.map((r) => r.id),
    });
  }
  const sansDate = ouverts
    .filter((r) => !r.quand && !enDouble.has(r.id) && maintenant - (crees.get(r.id) || maintenant) >= RAPPEL_ANCIEN_JOURS * JOUR)
    .map((r) => ({ cle: `rappel:${r.id}`, type: "rappel", texte: court(r.texte), detail: "Sans date", depuis: crees.get(r.id) || null, rappelId: r.id }))
    .sort((a, b) => (a.depuis || 0) - (b.depuis || 0));
  return { doublons, sansDate };
}

function articlesPris() {
  return lireListes()
    .map((l) => ({ l, pris: l.elements.filter((e) => e.fait) }))
    .filter(({ pris }) => pris.length)
    .map(({ l, pris }) => ({
      cle: `articles:${l.id}`,
      type: "articles",
      texte: `${l.nom} : ${pris.length} article${pris.length > 1 ? "s" : ""} pris`,
      detail: court(pris.slice(0, 4).map((e) => e.texte).join(", ") + (pris.length > 4 ? "…" : ""), 90),
      depuis: null,
      listeId: l.id,
      nombre: pris.length,
    }));
}

// Un fil qui porte une carte en attente n'est pas proposé : la carte d'abord.
function filsAnciens(convs, maintenant, avecCarte = new Set()) {
  return convs
    .filter((c) => !c.pinned && !c.systeme && !c.origine && !avecCarte.has(c.id) && (c.messages || 0) <= 2 && maintenant - (c.updatedAt || maintenant) >= FIL_ANCIEN_JOURS * JOUR)
    .map((c) => ({
      cle: `fil:${c.id}`,
      type: "fil",
      texte: court(c.title || "Conversation"),
      detail: c.messages ? "Un seul échange" : "Vide",
      depuis: c.updatedAt || null,
      convId: c.id,
    }))
    .sort((a, b) => (a.depuis || 0) - (b.depuis || 0));
}

// Les idées : les notes non relues du dossier « Idées » (et des notes sans projet).
function ideesNonTriees() {
  const crees = new Map(db().prepare("SELECT id, cree_a FROM notes_dossier WHERE supprime = 0").all().map((n) => [n.id, n.cree_a]));
  return lireDossiers()
    .filter((d) => d.id === "idees" || d.id === "notes")
    .flatMap((d) => d.notes.filter((n) => !n.fait).map((n) => ({
      cle: `idee:${n.id}`,
      type: "idee",
      // Le texte entier : « Gardée » réécrit la note telle quelle.
      texte: n.texte,
      detail: d.id === "idees" ? "Idées" : "Notes",
      depuis: crees.get(n.id) || null,
      dossierId: d.id,
      noteId: n.id,
    })))
    .sort((a, b) => (a.depuis || 0) - (b.depuis || 0));
}

// Les tâches Motion dont l'échéance est passée (le cache de la tour : aucune
// lecture forcée). Pour « On trie tes retards ? » après une absence.
async function retardsMotion(maintenant) {
  if (!motionEnabled()) return [];
  const taches = await tachesMotion().catch(() => null);
  return (taches || [])
    .map((t) => ({ t, echeance: t?.dueDate ? Date.parse(t.dueDate) : NaN }))
    .filter(({ echeance }) => Number.isFinite(echeance) && echeance < maintenant - 3600_000)
    .sort((a, b) => a.echeance - b.echeance)
    .slice(0, 30)
    .map(({ t, echeance }) => ({
      cle: `retard:${t.id}`,
      type: "retard",
      // Le nom exact : la chaîne d'écriture vérifie qu'il désigne bien la tâche.
      texte: String(t.name || "(sans nom)").slice(0, 200),
      detail: t.project?.name ? court(t.project.name, 60) : null,
      depuis: echeance,
      tacheId: String(t.id),
    }));
}

const GROUPES = [
  ["cartes", "Cartes en attente"],
  ["doublons", "Rappels en double"],
  ["rappels", "Rappels sans date"],
  ["articles", "Articles pris"],
  ["idees", "Idées à trier"],
  ["fils", "Fils d'un seul échange"],
];

export async function aTrancher({ maintenant = Date.now() } = {}) {
  const convs = await store.listConversations();
  const reportes = reports(maintenant);
  const { doublons, sansDate } = rappelsATrancher(maintenant);
  const cartes = await cartesEnAttente();
  const brut = {
    cartes,
    doublons,
    rappels: sansDate,
    articles: articlesPris(),
    idees: ideesNonTriees(),
    fils: filsAnciens(convs, maintenant, new Set(cartes.map((c) => c.convId))),
  };
  let mises = 0;
  const groupes = GROUPES.map(([id, titre]) => {
    const toutes = brut[id].filter((l) => !reportes[l.cle]);
    mises += brut[id].length - toutes.length;
    return { id, titre, total: toutes.length, lignes: toutes.slice(0, PAR_GROUPE) };
  }).filter((g) => g.total);
  const retards = (await retardsMotion(maintenant)).filter((l) => !reportes[l.cle]);
  return {
    genereA: maintenant,
    total: groupes.reduce((n, g) => n + g.total, 0),
    reportes: mises,
    groupes,
    retards,
  };
}

// --- La revue du dimanche -------------------------------------------------------------

// Le lundi 00:00 (heure de la tour) de la semaine de `ts`.
export function debutSemaine(ts = Date.now()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

const SANS = "Sans projet";

/**
 * La semaine par domaine, sans IA : ce qui a été fait (coches de la chaîne
 * d'écriture), ce qui a glissé (échéance passée cette semaine, encore
 * ouvert), le temps des tâches faites par projet, les rappels faits.
 */
export async function revueSemaine({ maintenant = Date.now() } = {}) {
  const debut = maintenant - 7 * JOUR;
  const d = db();
  const faites = [];
  for (const j of d.prepare("SELECT ts, results, annule FROM journal WHERE source = 'motion' AND ts >= ? AND annule = 0 AND etat IN ('appliquee', 'appliquee_partiellement') ORDER BY ts").all(debut)) {
    for (const r of lireJSON(j.results, [])) {
      if (!r?.ok || r.type !== "terminer") continue;
      faites.push({ nom: court(r.nom || r.avant?.name || "?", 120), projet: r.projet || null, minutes: Number(r.avant?.duration) || 0, a: j.ts });
    }
  }
  const glissees = [];
  if (motionEnabled()) {
    const taches = await tachesMotion().catch(() => null);
    for (const t of taches || []) {
      const e = t?.dueDate ? Date.parse(t.dueDate) : NaN;
      if (Number.isFinite(e) && e >= debut && e < maintenant) {
        glissees.push({ id: String(t.id), nom: court(t.name || "(sans nom)", 120), projet: t.project?.name || null, echeance: e });
      }
    }
  }
  const domaines = new Map();
  const domaine = (nom) => {
    const k = nom || SANS;
    if (!domaines.has(k)) domaines.set(k, { nom: k, faites: 0, glissees: 0, minutes: 0 });
    return domaines.get(k);
  };
  for (const f of faites) {
    const x = domaine(f.projet);
    x.faites++;
    x.minutes += f.minutes;
  }
  for (const g of glissees) domaine(g.projet).glissees++;
  const rappelsFaits = d.prepare("SELECT COUNT(*) AS n FROM rappels WHERE supprime = 0 AND fait = 1 AND maj_a >= ?").get(debut).n;
  return {
    debut,
    fin: maintenant,
    domaines: [...domaines.values()].sort((a, b) => b.minutes - a.minutes || b.faites - a.faites || a.nom.localeCompare(b.nom, "fr")),
    faites: faites.slice(-30).reverse(),
    glissees: glissees.sort((a, b) => a.echeance - b.echeance).slice(0, 30),
    rappelsFaits,
    appris: await apprisDeLaNuit(debut),
    decisions: decisions(maintenant),
  };
}

// « Ce que j'ai appris sur toi » : les hypothèses déjà écrites par la réflexion
// de nuit cette semaine (une puce avec un pourcentage). Aucun nouvel appel.
export async function apprisDeLaNuit(depuis) {
  const briefings = await store.listBriefings().catch(() => []);
  const vus = new Set();
  const hypotheses = [];
  for (const b of briefings || []) {
    if (!b?.text || (b.generatedAt || 0) < depuis) continue;
    for (const i of itemsDe(b.text)) {
      if (!/\d\s?%/.test(i.texte) || vus.has(i.id)) continue;
      vus.add(i.id);
      hypotheses.push(court(i.texte.replace(/\*\*/g, ""), 220));
    }
  }
  return hypotheses.slice(0, 3);
}

// --- Trois décisions pour la semaine ------------------------------------------------

// Faite le dimanche, la revue vaut pour la semaine qui vient : le dimanche, on
// lit et on écrit celle-là (rouverte le même soir, la revue les retrouve).
// Deux jours et pas un : un passage à l'heure d'hiver ne fait pas retomber
// dans la semaine finie.
const semaineVisee = (maintenant) => debutSemaine(new Date(maintenant).getDay() === 0 ? maintenant + 2 * JOUR : maintenant);

export function decisions(maintenant = Date.now()) {
  const d = lireMeta(CLE_DECISIONS, null);
  if (!d || d.semaine !== semaineVisee(maintenant)) return { semaine: semaineVisee(maintenant), liste: [], a: null };
  return d;
}

export function ecrireDecisions(liste, maintenant = Date.now()) {
  if (!Array.isArray(liste)) throw Object.assign(new Error("Attendu : { decisions: [\"…\"] }"), { statut: 400 });
  const propres = liste.map((x) => court(x, 200)).filter(Boolean).slice(0, 3);
  const d = { semaine: semaineVisee(maintenant), liste: propres, a: maintenant };
  transaction(() => ecrireMeta(CLE_DECISIONS, d));
  return d;
}

// --- Routes -------------------------------------------------------------------------

const erreur = (res, err) => sendJSON(res, err.statut || 500, { error: err.statut ? err.message : "Erreur serveur", message: err.message });

// GET /api/a-trancher
export async function getATrancher(req, res) {
  if (!requireAuth(req, res)) return;
  return sendJSON(res, 200, await aTrancher());
}

// POST /api/a-trancher/reports { cle, jours } — DELETE /api/a-trancher/reports/:cle
export async function postReport(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const body = await readJSON(req).catch(() => ({}));
  try {
    return sendJSON(res, 200, reporter(body?.cle, { jours: body?.jours }));
  } catch (err) {
    return erreur(res, err);
  }
}

export async function deleteReport(req, res, cle) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  return sendJSON(res, 200, annulerReport(decodeURIComponent(cle)));
}

// POST /api/a-trancher/rouvrir { propositionId }
export async function postRouvrir(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const body = await readJSON(req).catch(() => ({}));
  try {
    return sendJSON(res, 200, rouvrir(body?.propositionId));
  } catch (err) {
    return erreur(res, err);
  }
}

// GET /api/revue — PUT /api/revue/decisions { decisions: [] }
export async function getRevue(req, res) {
  if (!requireAuth(req, res)) return;
  const [revue, tri] = await Promise.all([revueSemaine(), aTrancher()]);
  return sendJSON(res, 200, { ...revue, aTrancher: tri.total });
}

export async function putDecisions(req, res) {
  if (!requireAuth(req, res)) return;
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "Origine refusée" });
  const body = await readJSON(req).catch(() => ({}));
  try {
    return sendJSON(res, 200, ecrireDecisions(body?.decisions));
  } catch (err) {
    return erreur(res, err);
  }
}
