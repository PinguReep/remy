// Ce qui casse à J+30 (simulation d'usage intensif du 24/10) : plafonds du
// carnet, doublons à l'entrée, « déjà là » qui n'est pas un échec,
// propositions périmées, règles en double, historique paginé, rangement des
// rappels. Base temporaire, faux Motion, aucune donnée réelle.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFauxMotion } from "./outils/faux-motion.mjs";

console.log = () => {};
console.warn = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-intensif-"));
for (const v of ["REMY_VAULT", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_GLM_URL", "ANTHROPIC_API_KEY", "MOTION_WORKSPACE_ID", "MOTION_WRITE", "REMY_MOTION_HORAIRE"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
const motion = await demarrerFauxMotion();
process.env.MOTION_API_KEY = "faux";
process.env.MOTION_BASE_URL = motion.url;

const c = await import("../lib/carnet.js");
const store = await import("../lib/store.js");
const regles = await import("../lib/regles.js");
const ecriture = await import("../lib/ecriture.js");
const { page } = await import("../lib/historique.js");
const { rappelsAClasser } = await import("../lib/analyses.js");
const { routeApi } = await import("../lib/routes.js");
const dbm = await import("../lib/db.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(async () => {
  remy.close();
  await motion.fermer();
  dbm.fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});
const envoyer = async (m, chemin, corps) => {
  const r = await fetch(base + chemin, { method: m, headers: { "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const JOUR = 86_400_000;

// --- 1. Plafonds du carnet ---------------------------------------------------------

test("500 articles dont 405 pris : cocher, décocher et ajouter marchent (avant : 409)", () => {
  c.ecrireListe("courses", { nom: "Courses" });
  const lot = (de, n, fait) => Array.from({ length: n }, (_, k) => ({ id: `a${de + k}`, texte: `article ${de + k}`, fait }));
  for (let k = 0; k < 405; k += 100) c.ecrireElements("courses", lot(k, Math.min(100, 405 - k), true));
  for (let k = 405; k < 500; k += 100) c.ecrireElements("courses", lot(k, Math.min(100, 500 - k), false));
  assert.equal(c.lireListes()[0].elements.length, 500);
  // Cocher un article existant, en décocher un autre.
  assert.equal(c.ecrireElements("courses", [{ id: "a450", texte: "article 450", fait: true }]).ok, true);
  assert.equal(c.ecrireElements("courses", [{ id: "a3", texte: "article 3", fait: false }]).ok, true);
  // Ajouter un article neuf : seuls les « à prendre » comptent.
  assert.equal(c.ecrireElements("courses", [{ id: "neuf1", texte: "poulet" }]).ok, true);
});

test("le plafond ne compte que les articles à prendre, et le message dit quoi faire", () => {
  c.ecrireListe("pleine", { nom: "Pleine" });
  for (let k = 0; k < 500; k += 100) c.ecrireElements("pleine", Array.from({ length: 100 }, (_, j) => ({ id: `p${k + j}`, texte: `chose ${k + j}` })));
  assert.throws(() => c.ecrireElements("pleine", [{ id: "p-trop", texte: "encore" }]), /articles à prendre.*coche ou retire/);
  // Une coche ne compte jamais.
  assert.equal(c.ecrireElements("pleine", [{ id: "p1", texte: "chose 1", fait: true }]).ok, true);
  assert.equal(c.ecrireElements("pleine", [{ id: "p-apres", texte: "encore" }]).ok, true, "une place libérée par la coche");
});

test("« Retirer les pris » : une seule requête pour tous (route en lot)", async () => {
  const pris = c.lireListes().find((l) => l.id === "courses").elements.filter((e) => e.fait).map((e) => e.id);
  assert.ok(pris.length > 400);
  const r = await envoyer("POST", "/api/listes/courses/retirer", { ids: pris });
  assert.equal(r.status, 200);
  assert.equal(r.body.retires, pris.length);
  assert.ok(!c.lireListes().find((l) => l.id === "courses").elements.some((e) => e.fait));
  // Rejouée (coupure réseau) : sans effet.
  assert.equal((await envoyer("POST", "/api/listes/courses/retirer", { ids: pris })).body.retires, 0);
  assert.equal((await envoyer("POST", "/api/listes/courses/retirer", { ids: [] })).status, 400);
});

test("purge douce : les pris de plus de 7 jours et les rappels faits de plus de 30 jours", () => {
  const d = dbm.db();
  c.ecrireListe("vieille", { nom: "Vieille" });
  c.ecrireElements("vieille", [{ id: "v1", texte: "farine", fait: true }, { id: "v2", texte: "sel", fait: true }, { id: "v3", texte: "sucre" }]);
  c.ecrireRappels([{ id: "rf1", texte: "vieux rappel fait", fait: true }, { id: "rf2", texte: "rappel fait hier", fait: true }]);
  d.prepare("UPDATE elements_liste SET maj_a = ? WHERE id = 'v1'").run(Date.now() - 8 * JOUR);
  d.prepare("UPDATE rappels SET maj_a = ? WHERE id = 'rf1'").run(Date.now() - 31 * JOUR);
  const r = c.purgerCarnet();
  assert.ok(r.pris >= 1 && r.faits >= 1);
  assert.deepEqual(c.lireListes().find((l) => l.id === "vieille").elements.map((e) => e.id), ["v2", "v3"]);
  assert.ok(!c.lireRappels().some((x) => x.id === "rf1"));
  assert.ok(c.lireRappels().some((x) => x.id === "rf2"));
  // Douce : réécrire la ligne la fait revenir.
  c.ecrireElements("vieille", [{ id: "v1", texte: "farine", fait: true }]);
  assert.ok(c.lireListes().find((l) => l.id === "vieille").elements.some((e) => e.id === "v1"));
});

// --- 2. Doublons à l'entrée ---------------------------------------------------------

test("un article déjà à prendre n'est pas recréé : la tour rend l'existant", () => {
  c.ecrireListe("dbl", { nom: "Courses bis" });
  c.ecrireElements("dbl", [{ id: "lait1", texte: "Lait" }]);
  const r = c.ecrireElements("dbl", [{ id: "lait2", texte: "  lait ! " }, { id: "oeufs", texte: "œufs" }, { id: "oeufs2", texte: "Œufs" }]);
  assert.deepEqual(r.dejaLa.map((x) => [x.id, x.existant]), [["lait2", "lait1"], ["oeufs2", "oeufs"]]);
  assert.deepEqual(c.lireListes().find((l) => l.id === "dbl").elements.map((e) => e.texte), ["Lait", "œufs"]);
  // Pris, il peut revenir (on en rachète).
  c.ecrireElements("dbl", [{ id: "lait1", texte: "Lait", fait: true }]);
  assert.deepEqual(c.ecrireElements("dbl", [{ id: "lait3", texte: "lait" }]).dejaLa, []);
  // Une autre liste n'est pas concernée.
  c.ecrireListe("autre", { nom: "Bricolage" });
  assert.deepEqual(c.ecrireElements("autre", [{ id: "lait-b", texte: "lait" }]).dejaLa, []);
});

test("un rappel déjà en cours n'est pas recréé (« payer le loyer » ×14) ; il prend la date du nouveau", async () => {
  c.ecrireRappels([{ id: "loyer1", texte: "Payer le loyer" }]);
  for (let k = 2; k <= 14; k++) c.ecrireRappels([{ id: `loyer${k}`, texte: "payer le loyer" }]);
  assert.equal(c.lireRappels().filter((r) => c.cleTexte(r.texte) === "payer le loyer").length, 1);
  const demain = Date.now() + JOUR;
  const r = await envoyer("POST", "/api/rappels", { rappels: [{ id: "loyer15", texte: "Payer le loyer", quand: demain }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.dejaLa, [{ id: "loyer15", existant: "loyer1", texte: "Payer le loyer" }]);
  assert.equal(c.lireRappels().find((x) => x.id === "loyer1").quand, demain);
  // Fait, il peut être noté de nouveau (le mois suivant).
  c.ecrireRappels([{ id: "loyer1", texte: "Payer le loyer", fait: true }]);
  assert.deepEqual(c.ecrireRappels([{ id: "loyer-nov", texte: "Payer le loyer" }]).dejaLa, []);
});

// --- 3. « Déjà dans Motion » n'est pas un échec ----------------------------------------

test("déjà dans Motion : statut neutre, rien d'annulable, l'historique dit « Déjà là »", async () => {
  motion.taches.clear();
  motion.ajouter({ id: "m-loyer", name: "Relancer le comptable" });
  const r = await envoyer("POST", "/api/motion/apply", { actions: [{ type: "creer", nom: "relancer le comptable" }], idCommande: "cap-1", origine: "capture" });
  assert.equal(r.status, 200);
  assert.equal(r.body.etat, "deja_la");
  assert.equal(r.body.echecs, 0);
  assert.equal(r.body.results[0].ok, true);
  assert.equal(r.body.results[0].dejaLa, true);
  const [e] = page({ limite: 1 }).entrees;
  assert.equal(e.etat, "deja_la");
  assert.equal(e.elements[0].action, "Déjà là");
  assert.equal(e.annulable, false);
});

// --- 7. Historique paginé et filtrable --------------------------------------------------

test("historique : au-delà des 80 dernières, et filtres échouée / annulée / déjà là (anciennes lignes relues)", () => {
  const d = dbm.db();
  const t0 = Date.now() - 10 * JOUR;
  const poser = d.prepare("INSERT INTO journal (id, ts, source, origine, resume, etat, actions, results, annulations, maj_a, annule) VALUES (?, ?, 'motion', 'tap', 'r', ?, '[]', ?, '{}', ?, ?)");
  const ok = JSON.stringify([{ ok: true, type: "creer", nom: "Tâche", annulable: "supprimer" }]);
  const ancienDoublon = JSON.stringify([{ ok: false, type: "creer", nom: "Payer le loyer", erreur: "« Payer le loyer » existe déjà dans Motion — rien n'a été créé", doublon: true }]);
  const panne = JSON.stringify([{ ok: false, type: "creer", nom: "Appeler", erreur: "Motion ne répond pas" }]);
  for (let k = 0; k < 300; k++) {
    const genre = k % 10;
    const [etat, results, annule] = genre === 0 ? ["echouee", panne, 0] : genre === 1 ? ["echouee", ancienDoublon, 0] : genre === 2 ? ["annulee", ok, 1] : ["appliquee", ok, 0];
    poser.run(`h${k}`, t0 + k * 60_000, etat, results, t0, annule);
  }
  const p1 = page({ limite: 80 });
  assert.equal(p1.entrees.length, 80);
  assert.ok(p1.suite);
  const p2 = page({ limite: 80, avant: p1.suite });
  assert.equal(p2.entrees.length, 80);
  assert.ok(p2.entrees[0].ts < p1.entrees.at(-1).ts, "la page suivante est plus ancienne");
  let toutes = [...p1.entrees, ...p2.entrees];
  for (let s = p2.suite; s; ) {
    const p = page({ limite: 80, avant: s });
    toutes = toutes.concat(p.entrees);
    s = p.suite;
  }
  assert.ok(toutes.length >= 300, `tout le journal se parcourt (${toutes.length})`);
  const echouees = page({ limite: 200, filtre: "echouee" }).entrees;
  assert.equal(echouees.length, 30, "les vraies pannes seulement");
  assert.ok(echouees.every((e) => e.elements[0].action === "Échec"));
  const deja = page({ limite: 200, filtre: "deja_la" }).entrees;
  assert.ok(deja.length >= 30);
  assert.ok(deja.every((e) => e.etat === "deja_la" && e.elements[0].erreur === null));
  assert.equal(page({ limite: 200, filtre: "annulee" }).entrees.length, 30);
});

test("route /api/historique : suite et filtre", async () => {
  const r = await envoyer("GET", "/api/historique?limite=5&filtre=echouee");
  assert.equal(r.status, 200);
  assert.equal(r.body.entrees.length, 5);
  assert.ok(r.body.suite);
  const r2 = await envoyer("GET", `/api/historique?limite=5&filtre=echouee&avant=${r.body.suite}`);
  assert.ok(r2.body.entrees[0].ts < r.body.entrees.at(-1).ts);
});

// --- 4. Péremption des propositions -----------------------------------------------------

async function propositionDe(convId, actions, { creeA = Date.now(), majConv = Date.now() } = {}) {
  await store.putConversation({
    id: convId, title: "t", createdAt: majConv, updatedAt: majConv,
    messages: [
      { role: "user", content: "x" },
      { role: "assistant", content: "je propose", proposal: { id: `p-${convId}`, source: "motion", resume: "r", actions, statut: "en_attente", ...(creeA ? { creeA } : {}) } },
    ],
  });
}

test("péremption : âge réglable, date passée, et une ancienne carte sans date de naissance", () => {
  const m = Date.parse("2026-11-23T10:00:00Z");
  assert.equal(ecriture.peremption({ creeA: m - 2 * JOUR, actions: [] }, { maintenant: m, jours: 7 }), null);
  assert.match(ecriture.peremption({ creeA: m - 60 * JOUR, actions: [] }, { maintenant: m, jours: 7 }), /il y a 60 jours/);
  assert.equal(ecriture.peremption({ creeA: m - 60 * JOUR, actions: [] }, { maintenant: m, jours: 90 }), null, "réglable");
  assert.match(ecriture.peremption({ creeA: m, actions: [{ type: "creer", nom: "Abonnement", echeance: "2026-10-26" }] }, { maintenant: m }), /L'échéance de « Abonnement » est passée/);
  assert.equal(ecriture.peremption({ creeA: m, actions: [{ type: "creer", nom: "Ce soir", echeance: "2026-11-23" }] }, { maintenant: m }), null, "une échéance du jour court jusqu'au soir");
  assert.match(ecriture.peremption({ creeA: m, actions: [{ type: "creer", titre: "Dentiste", debut: "2026-11-20T09:00:00Z" }] }, { maintenant: m }), /Le début de « Dentiste » est passé/);
  // Sans creeA (cartes d'avant le 24/10) : le fil inactif depuis 30 jours suffit.
  assert.match(ecriture.peremption({ actions: [] }, { conv: { updatedAt: m - 30 * JOUR }, maintenant: m }), /plus de 30 jours/);
  // Ajustée hier : remise à neuf.
  assert.equal(ecriture.peremption({ creeA: m - 60 * JOUR, actions: [] }, { ajusteA: m - JOUR, maintenant: m }), null);
});

test("« Oui » sur une proposition périmée : 409 tant que Sam n'a pas confirmé, rien n'est écrit", async () => {
  motion.taches.clear();
  await propositionDe("vieille", [{ type: "creer", nom: "Acheter abonnement pour Tom", echeance: new Date(Date.now() - 28 * JOUR).toISOString() }], { creeA: Date.now() - 60 * JOUR });
  const vue = await envoyer("GET", "/api/conversations/vieille");
  assert.equal(vue.body.messages[1].proposal.perimee, true);
  assert.match(vue.body.messages[1].proposal.raisonPeremption, /Proposée il y a 60 jours\. L'échéance/);
  const r = await envoyer("POST", "/api/motion/apply", { convId: "vieille", propositionId: "p-vieille" });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "perimee");
  assert.equal(motion.ouvertes().length, 0, "rien n'a été créé");
  const ok = await envoyer("POST", "/api/motion/apply", { convId: "vieille", propositionId: "p-vieille", confirmer: true });
  assert.equal(ok.status, 200);
  assert.equal(motion.ouvertes().length, 1);
  // Appliquée : la carte n'est plus « périmée ».
  assert.equal((await envoyer("GET", "/api/conversations/vieille")).body.messages[1].proposal.perimee, undefined);
});

test("une proposition récente passe sans rien demander", async () => {
  motion.taches.clear();
  await propositionDe("fraiche", [{ type: "creer", nom: "Réserver le resto", echeance: new Date(Date.now() + 3 * JOUR).toISOString() }]);
  const vue = await envoyer("GET", "/api/conversations/fraiche");
  assert.equal(vue.body.messages[1].proposal.perimee, undefined);
  assert.equal((await envoyer("POST", "/api/motion/apply", { convId: "fraiche", propositionId: "p-fraiche" })).status, 200);
});

test("une ancienne carte rouge « existe déjà dans Motion » se relit comme « déjà là »", async () => {
  await propositionDe("rouge", [{ type: "creer", nom: "Payer le loyer" }]);
  dbm.db().prepare("INSERT INTO propositions (id, conv_id, source, statut, journal_id, bilan, annulee, annulation_ratee, maj_a) VALUES (?, ?, 'motion', 'echec', NULL, ?, 0, NULL, ?)")
    .run("p-rouge", "rouge", JSON.stringify({ faits: [], echoues: [{ nom: "Payer le loyer", erreur: "« Payer le loyer » existe déjà dans Motion — rien n'a été créé" }] }), Date.now());
  const p = (await envoyer("GET", "/api/conversations/rouge")).body.messages[1].proposal;
  assert.equal(p.statut, "applique");
  assert.deepEqual(p.bilan.echoues, []);
  assert.deepEqual(p.bilan.dejaLa, ["Payer le loyer"]);
});

// --- 6. Règles ---------------------------------------------------------------------------

const RASAGE = { nom: "Rasage avant une sortie", mots_cles: ["sortie", "soirée", "resto"], tache: { nom: "Rasage", duree: "15" }, avant_minutes: "180" };

test("une règle identique n'est pas recréée ; une voisine est fusionnée", () => {
  const r1 = regles.creerRegle(RASAGE);
  const r2 = regles.creerRegle(RASAGE);
  assert.equal(r2.id, r1.id);
  assert.equal(r2.deja, true);
  const r3 = regles.creerRegle({ ...RASAGE, mots_cles: ["resto", "dîner"] });
  assert.equal(r3.id, r1.id);
  assert.equal(r3.fusionnee, true);
  assert.deepEqual(r3.mots, ["sortie", "soirée", "resto", "dîner"]);
  assert.equal(regles.listerRegles().length, 1);
  // Une autre tâche reste une autre règle.
  regles.creerRegle({ ...RASAGE, nom: "Repassage", tache: { nom: "Repasser une chemise" } });
  assert.equal(regles.listerRegles().length, 2);
});

test("une seule action par événement et par tâche, même avec des règles en double d'avant", async () => {
  for (const r of regles.listerRegles()) if (r.tache.nom !== "Rasage") regles.reglerRegle(r.id, { actif: false });
  // Une règle en double, posée à la main (comme avant le 24/10).
  dbm.db().prepare("INSERT INTO regles (id, nom, mots, tache, avant_min, actif, cree_a, conv_id) VALUES ('regle-double', 'Rasage bis', ?, ?, 180, 1, ?, NULL)")
    .run(JSON.stringify(["resto"]), JSON.stringify({ nom: "Rasage", duree: 15, priorite: "MEDIUM" }), Date.now());
  const maintenant = Date.now();
  const resto = { id: "ev-resto", summary: "Resto avec Hugo", start: { dateTime: new Date(maintenant + 2 * JOUR).toISOString() } };
  const b = await regles.verifierRegles({ maintenant, sources: { agenda: [resto], motion: [] } });
  assert.equal(b.proposees, 1, "Rasage une fois, pas deux");
  const b2 = await regles.verifierRegles({ maintenant, sources: { agenda: [resto], motion: [] } });
  assert.equal(b2.proposees, 0, "et pas de nouveau au passage suivant");
});

// --- 8. Rangement des rappels ----------------------------------------------------------------

test("rangement des rappels : les plus récents d'abord, un seul exemplaire d'un même texte", () => {
  const rappels = Array.from({ length: 100 }, (_, k) => ({ id: `r${k}`, texte: k >= 90 ? "Pression des pneus" : `rappel ${k}`, fait: false, creeA: 1000 + k }));
  const choisis = rappelsAClasser(rappels);
  assert.equal(choisis.length, 60);
  assert.equal(choisis[0].id, "r99", "le dernier noté est vu");
  assert.equal(choisis.filter((r) => r.texte === "Pression des pneus").length, 1);
  assert.ok(!choisis.some((r) => r.id === "r0"), "les plus anciens attendent le tour suivant");
});
