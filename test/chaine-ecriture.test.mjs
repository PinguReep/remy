// La chaîne d'écriture (Lot 0, J0.7), au-delà des défauts de l'audit :
//   - un geste direct (coche) rejoué avec la même clé ne fait qu'un effet ;
//   - deux propositions différentes qui créent la même tâche, en même temps :
//     une seule tâche (écritures en file, cache qui ne masque plus) ;
//   - l'annulation remet aussi une échéance qui était vide ;
//   - une tâche modifiée dans Motion depuis n'est JAMAIS écrasée (conflit dit) ;
//   - une tâche supprimée dans Motion, une coupure réseau : des erreurs claires ;
//   - Motion illisible : rien n'est créé à l'aveugle ;
//   - le journal est écrit AVANT l'effet ;
//   - agenda : un déplacement garde la durée ; une suppression annulée suit le
//     nouvel identifiant ; pas lu → pas d'outil d'écriture ;
//   - une seule proposition par réponse ; Rémy relit l'état réel.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFauxMotion } from "./outils/faux-motion.mjs";

console.log = () => {}; // voir test/secours.test.mjs : la sortie standard sert au lanceur

// --- Faux Google Calendar (événements, jeton) -----------------------------------------
const evenements = new Map();
let suivant = 1;
const google = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://g");
    const json = (code, v) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(v === undefined ? "" : JSON.stringify(v));
    };
    if (u.pathname === "/token") return json(200, { access_token: "faux", expires_in: 3600 });
    const b = corps ? JSON.parse(corps) : null;
    if (/\/events$/.test(u.pathname)) {
      if (req.method === "GET") return json(200, { items: [...evenements.values()] });
      const ev = { id: `e${suivant++}`, status: "confirmed", ...b };
      evenements.set(ev.id, ev);
      return json(200, ev);
    }
    const m = u.pathname.match(/\/events\/([^/]+)$/);
    if (m) {
      const ev = evenements.get(decodeURIComponent(m[1]));
      if (!ev) return json(404, { error: "not found" });
      if (req.method === "GET") return json(200, ev);
      if (req.method === "DELETE") {
        evenements.delete(ev.id);
        return json(204);
      }
      if (req.method === "PATCH") {
        Object.assign(ev, b);
        return json(200, ev);
      }
    }
    json(404, {});
  });
});
await new Promise((r) => google.listen(0, "127.0.0.1", r));

const motion = await demarrerFauxMotion();
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-chaine-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "MOTION_WORKSPACE_ID", "MOTION_WRITE", "REMY_MOTION_HORAIRE"]) {
  delete process.env[v];
}
process.env.REMY_DATA_DIR = dossier;
process.env.MOTION_API_KEY = "faux";
process.env.MOTION_BASE_URL = motion.url;
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_API_URL = `http://127.0.0.1:${google.address().port}`;
process.env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${google.address().port}/token`;

const store = await import("../lib/store.js");
await store.putGoogleToken({ refresh_token: "faux", access_token: "faux", expire_a: Date.now() + 3600_000 });
const { routeApi } = await import("../lib/routes.js");
const { db, fermer } = await import("../lib/db.js");
const { contenuPourModele } = await import("../lib/chat.js");
const { _outilsClient, _executerOutil } = await import("../lib/providers.js");

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;

test.after(async () => {
  remy.close();
  google.close();
  await motion.fermer();
  fermer(); // sous Windows, une base ouverte ne se supprime pas
  fs.rmSync(dossier, { recursive: true, force: true });
});

const post = async (p, b) => {
  const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const lireConv = async (id) => (await fetch(`${base}/api/conversations/${id}`)).json();

async function proposition(convId, actions, source = "motion") {
  await store.putConversation({
    id: convId,
    title: "t",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [
      { role: "user", content: "x" },
      { role: "assistant", content: "je propose", proposal: { id: `p-${convId}`, source, resume: "r", actions, statut: "en_attente" } },
    ],
  });
}

test("coche rejouée avec la même clé (coupure réseau) : un seul effet, même résultat", async () => {
  motion.taches.clear();
  motion.ajouter({ id: "k1", name: "Payer la facture" });
  const action = [{ type: "terminer", id: "k1", nom: "Payer la facture" }];
  const a = await post("/api/motion/apply", { actions: action, idCommande: "coche-123" });
  const b = await post("/api/motion/apply", { actions: action, idCommande: "coche-123" });
  assert.equal(a.status, 200);
  assert.equal(b.body.ledgerId, a.body.ledgerId);
  assert.equal(b.body.rejoue, true);
  assert.equal(motion.requetes.filter((r) => r.methode === "PATCH" && r.chemin === "/v1/tasks/k1").length, 1);
});

test("deux propositions différentes créent la même tâche en même temps : une seule tâche", async () => {
  motion.taches.clear();
  await proposition("d1", [{ type: "creer", nom: "Appeler le comptable", duree: 15 }]);
  await proposition("d2", [{ type: "creer", nom: "Appeler le comptable", duree: 15 }]);
  const [r1, r2] = await Promise.all([
    post("/api/motion/apply", { convId: "d1", index: 1 }),
    post("/api/motion/apply", { convId: "d2", index: 1 }),
  ]);
  assert.equal(motion.ouvertes().filter((t) => t.name === "Appeler le comptable").length, 1);
  const doublon = [r1, r2].find((r) => r.body.echecs === 1);
  assert.match(doublon.body.results[0].erreur, /existe déjà/);
});

test("un nom qui en contient un autre n'est pas un doublon (« Sport » ≠ « Sport avec Hugo »)", async () => {
  motion.taches.clear();
  motion.ajouter({ name: "Sport" });
  const r = await post("/api/motion/apply", { actions: [{ type: "creer", nom: "Sport avec Hugo" }], idCommande: "sport-1" });
  assert.equal(r.body.ok, true);
});

test("annuler remet aussi une échéance qui était vide", async () => {
  motion.taches.clear();
  motion.ajouter({ id: "v1", name: "Ranger le garage", dueDate: null });
  await proposition("e1", [{ type: "modifier", id: "v1", nom: "Ranger le garage", echeance: "2026-10-30T21:59:00Z" }]);
  const a = await post("/api/motion/apply", { convId: "e1", index: 1 });
  assert.equal(motion.taches.get("v1").dueDate, "2026-10-30T21:59:00Z");
  const u = await post("/api/motion/undo", { id: a.body.ledgerId });
  assert.equal(u.body.ok, true);
  assert.equal(motion.taches.get("v1").dueDate, null);
});

test("modifiée dans Motion depuis : l'annulation n'écrase rien et le dit", async () => {
  motion.taches.clear();
  motion.ajouter({ id: "m1", name: "Préparer la démo", dueDate: "2026-10-20T21:59:00Z" });
  await proposition("f1", [{ type: "modifier", id: "m1", nom: "Préparer la démo", echeance: "2026-10-22T21:59:00Z" }]);
  const a = await post("/api/motion/apply", { convId: "f1", index: 1 });
  motion.taches.get("m1").dueDate = "2026-10-25T21:59:00Z"; // Sam, dans Motion
  const u = await post("/api/motion/undo", { id: a.body.ledgerId });
  assert.equal(u.body.ok, false);
  assert.match(u.body.undone[0].erreur, /Modifiée dans Motion depuis.*rien n'est écrasé/);
  assert.equal(motion.taches.get("m1").dueDate, "2026-10-25T21:59:00Z");
  const conv = await lireConv("f1");
  assert.match(conv.messages[1].proposal.annulationRatee[0].erreur, /Modifiée dans Motion/);
});

test("tâche supprimée dans Motion, coupure réseau : des erreurs qui disent ce qui se passe", async () => {
  motion.taches.clear();
  const sup = await post("/api/motion/apply", { actions: [{ type: "terminer", id: "absente", nom: "X" }], idCommande: "err-1" });
  assert.equal(sup.body.ok, false);
  assert.match(sup.body.results[0].erreur, /\(404\)/);
  motion.ajouter({ id: "c1", name: "Courses" });
  motion.pannes.push({ methode: "GET", chemin: /\/tasks\/c1$/, code: 0, fois: 1 }); // coupure
  const cut = await post("/api/motion/apply", { actions: [{ type: "terminer", id: "c1", nom: "Courses" }], idCommande: "err-2" });
  assert.match(cut.body.results[0].erreur, /injoignable/);
  // Une commande qui a ÉCHOUÉ entièrement se rejoue (la cause est passée).
  const encore = await post("/api/motion/apply", { actions: [{ type: "terminer", id: "c1", nom: "Courses" }], idCommande: "err-2" });
  assert.equal(encore.body.ok, true);
});

test("une écriture coupée par un redémarrage ne bloque rien : rejouée sans double effet, et l'annulation dit pourquoi", async () => {
  motion.taches.clear();
  motion.ajouter({ id: "r1", name: "Relancer le comptable", dueDate: "2026-10-15T21:59:00Z" });
  const actions = [
    { type: "modifier", id: "r1", nom: "Relancer le comptable", echeance: "2026-10-22T21:59:00Z" },
    { type: "creer", nom: "Préparer le bilan", duree: 30 },
  ];
  await proposition("redemarrage", actions);
  // Ce que laisse un arrêt de la tour en pleine écriture : la création était
  // déjà partie chez Motion, la commande et son journal sont restés « en cours ».
  motion.ajouter({ id: "r2", name: "Préparer le bilan" });
  const t = Date.now();
  db().prepare("INSERT INTO commandes (id, source, origine, proposition_id, etat, journal_id, cree_a, maj_a) VALUES ('prop:p-redemarrage', 'motion', 'chat', 'p-redemarrage', 'en_cours', 'j-coupe', ?, ?)").run(t, t);
  db().prepare("INSERT INTO journal (id, ts, source, etat, commande_id, actions, results, annulations, maj_a) VALUES ('j-coupe', ?, 'motion', 'en_cours', 'prop:p-redemarrage', '[]', '[]', '{}', ?)").run(t, t);

  const u = await post("/api/motion/undo", { id: "j-coupe" });
  assert.equal(u.status, 409);
  assert.match(u.body.message, /interrompue par un redémarrage/);

  const a = await post("/api/motion/apply", { convId: "redemarrage", index: 1, propositionId: "p-redemarrage", actions });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.ok, true, JSON.stringify(a.body.results));
  assert.equal(motion.taches.get("r1").dueDate, "2026-10-22T21:59:00Z");
  assert.equal(motion.ouvertes().filter((x) => x.name === "Préparer le bilan").length, 1, "la création déjà faite n'est pas refaite");
  assert.equal((await lireConv("redemarrage")).messages[1].proposal.statut, "applique");
});


test("le journal est ouvert AVANT l'effet", async () => {
  motion.taches.clear();
  motion.ajouter({ id: "j1", name: "Lire" });
  motion.latenceMs = 800; // Motion lent : on regarde le journal pendant l'écriture
  try {
    const p = post("/api/motion/apply", { actions: [{ type: "terminer", id: "j1", nom: "Lire" }], idCommande: "avant-1" });
    // Pas de chronomètre (les machines de CI sont lentes) : on attend que la
    // trace apparaisse, et on vérifie que Motion n'a encore rien écrit.
    let pendant = null;
    for (let i = 0; i < 300 && !pendant; i++) {
      await new Promise((r) => setTimeout(r, 10));
      pendant = db().prepare("SELECT etat FROM journal WHERE commande_id = 'avant-1'").get();
    }
    assert.equal(pendant?.etat, "en_cours", "la trace existe avant que Motion ait répondu");
    assert.equal(motion.taches.get("j1").completed, false, "Motion n'a encore rien écrit");
    await p;
  } finally {
    motion.latenceMs = 0;
  }
  assert.equal(db().prepare("SELECT etat FROM journal WHERE commande_id = 'avant-1'").get().etat, "appliquee");
});

test("agenda : déplacer un RDV garde sa durée ; annuler une suppression suit le nouvel identifiant", async () => {
  evenements.clear();
  evenements.set("rdv1", { id: "rdv1", summary: "Dentiste", start: { dateTime: "2026-10-20T08:00:00.000Z" }, end: { dateTime: "2026-10-20T08:30:00.000Z" } });
  await proposition("g1", [{ type: "modifier", id: "rdv1", titre: "Dentiste", debut: "2026-10-20T13:00:00.000Z" }], "agenda");
  const a = await post("/api/google/apply", { convId: "g1", index: 1 });
  assert.equal(a.body.ok, true, JSON.stringify(a.body));
  const ev = evenements.get("rdv1");
  assert.equal(Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime), 30 * 60_000);

  await proposition("g2", [{ type: "supprimer", id: "rdv1", titre: "Dentiste" }], "agenda");
  const s = await post("/api/google/apply", { convId: "g2", index: 1 });
  assert.equal(evenements.has("rdv1"), false);
  const u = await post("/api/google/undo", { id: s.body.ledgerId });
  assert.equal(u.body.ok, true);
  const j = db().prepare("SELECT results FROM journal WHERE id = ?").get(s.body.ledgerId);
  const nouvelId = JSON.parse(j.results)[0].eventIdRecree;
  assert.ok(nouvelId && evenements.has(nouvelId), "le journal suit l'événement recréé");
  // Motion ne peut pas annuler une écriture d'agenda.
  const croise = await post("/api/motion/undo", { id: a.body.ledgerId });
  assert.equal(croise.status, 400);
});

test("annuler ne défait pas ce que Sam a changé depuis : tâche cochée dans Motion, RDV retouché dans l'agenda", async () => {
  // Motion : Rémy crée, Sam coche la tâche dans Motion, puis « Annuler ».
  motion.taches.clear();
  await proposition("derive-m", [{ type: "creer", nom: "Écrire au notaire", duree: 15 }]);
  const c = await post("/api/motion/apply", { convId: "derive-m", index: 1 });
  assert.equal(c.body.ok, true, JSON.stringify(c.body));
  const t = [...motion.taches.values()].find((x) => x.name === "Écrire au notaire");
  assert.ok(t, JSON.stringify(c.body) + JSON.stringify([...motion.taches.values()].map((x) => x.name)));
  t.status = { name: "Completed", isResolvedStatus: true };
  t.completed = true;
  const u = await post("/api/motion/undo", { id: c.body.ledgerId });
  assert.equal(u.body.ok, false);
  assert.match(u.body.undone[0].erreur, /Modifiée dans Motion depuis \(status\)/);
  assert.ok(motion.taches.has(t.id), "la tâche cochée par Sam n'est pas supprimée");

  // Agenda : Rémy déplace, Sam ajoute un lieu dans Google Agenda, puis « Annuler ».
  evenements.clear();
  evenements.set("rdv9", { id: "rdv9", summary: "Kiné", start: { dateTime: "2026-10-21T08:00:00.000Z" }, end: { dateTime: "2026-10-21T08:45:00.000Z" } });
  await proposition("derive-a", [{ type: "modifier", id: "rdv9", titre: "Kiné", debut: "2026-10-21T15:00:00.000Z" }], "agenda");
  const m = await post("/api/google/apply", { convId: "derive-a", index: 1 });
  assert.equal(m.body.ok, true, JSON.stringify(m.body));
  evenements.get("rdv9").location = "Cabinet, 2e étage";
  const ua = await post("/api/google/undo", { id: m.body.ledgerId });
  assert.equal(ua.body.ok, false);
  assert.match(ua.body.undone[0].erreur, /Modifié dans ton agenda depuis \(lieu\)/);
  assert.equal(evenements.get("rdv9").location, "Cabinet, 2e étage", "le lieu de Sam reste");
  assert.equal(Date.parse(evenements.get("rdv9").start.dateTime), Date.parse("2026-10-21T15:00:00.000Z"));
});

test("pas lu, pas écrit : sans lecture de Motion ou de l'agenda, pas d'outil d'écriture", () => {
  const noms = (o) => o.map((t) => t.name);
  assert.ok(noms(_outilsClient(true, { motionActif: true })).includes("motion_proposer"));
  assert.ok(!noms(_outilsClient(false, { motionActif: false })).includes("motion_proposer"));
  assert.ok(!noms(_outilsClient(false, { motionActif: false })).includes("agenda_proposer"));
});

test("une seule proposition par réponse : une seconde d'une autre source est refusée au modèle", async () => {
  const compteurs = { browse: 0 };
  const vues = [];
  const r1 = await _executerOutil("agenda_proposer", { resume: "rdv", actions: [{ type: "creer", titre: "Démo", debut: "2026-10-23T12:00:00Z" }] }, (i) => vues.push(i), compteurs);
  assert.equal(r1.statut, "proposition_affichee");
  const r2 = await _executerOutil("motion_proposer", { resume: "tâche", actions: [{ type: "creer", nom: "Préparer la démo" }] }, (i) => vues.push(i), compteurs);
  assert.match(r2.erreur, /déjà affichée.*au tour suivant/);
  assert.equal(vues.length, 1);
});

test("Rémy relit l'état réel : annulée, échec, annulation incomplète", () => {
  const m = (p) => ({ role: "assistant", content: "x", proposal: { actions: [{ type: "creer", nom: "A" }], ...p } });
  assert.match(contenuPourModele(m({ statut: "applique", annulee: true })), /ANNULÉE/);
  assert.match(contenuPourModele(m({ statut: "echec", bilan: { echoues: [{ nom: "A", erreur: "quota" }] } })), /RIEN n'a pu être fait \(quota\)/);
  assert.match(contenuPourModele(m({ statut: "applique", annulationRatee: [{ nom: "A", erreur: "conflit" }] })), /INCOMPLÈTE/);
  assert.match(contenuPourModele(m({ statut: "refuse" })), /REFUSÉ/);
});

test("une proposition d'avant le Lot 0 (sans identifiant) reçoit une adresse sûre et se refuse", async () => {
  await store.putConversation({
    id: "vieille",
    title: "t",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [
      { role: "user", content: "x" },
      { role: "assistant", content: "je propose", proposal: { source: "motion", resume: "r", actions: [{ type: "creer", nom: "Vieux" }], statut: "en_attente" } },
    ],
  });
  const id = (await lireConv("vieille")).messages[1].proposal.id;
  assert.equal(id, "ancienne-vieille-1");
  assert.equal(encodeURIComponent(id), id, "voyage tel quel dans l'URL du refus");
  const r = await post(`/api/conversations/vieille/propositions/${id}/refus`, {});
  assert.equal(r.status, 200);
  assert.equal((await lireConv("vieille")).messages[1].proposal.statut, "refuse");
  const a = await post("/api/motion/apply", { convId: "vieille", index: 1, propositionId: id, actions: [] });
  assert.equal(a.status, 409, "refusée : plus applicable, ni par l'index ni par l'identifiant");
});

test("429 de Motion au milieu d'une écriture : attente de Retry-After, puis une reprise, sans double effet", async () => {
  motion.taches.clear();
  motion.ajouter({ id: "q1", name: "Classer les factures", dueDate: "2026-10-15T21:59:00Z" });
  motion.pannes.push({ methode: "PATCH", chemin: /\/tasks\/q1$/, code: 429, fois: 1, entetes: { "Retry-After": "1" }, corps: { message: "Rate limit exceeded" } });
  const avant = motion.requetes.filter((r) => r.methode === "PATCH" && r.chemin === "/v1/tasks/q1").length;
  const t0 = Date.now();
  const r = await post("/api/motion/apply", { actions: [{ type: "modifier", id: "q1", nom: "Classer les factures", echeance: "2026-10-25T21:59:00Z" }], idCommande: "quota-1" });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.ok(Date.now() - t0 >= 900, "Retry-After respecté");
  assert.equal(motion.requetes.filter((x) => x.methode === "PATCH" && x.chemin === "/v1/tasks/q1").length - avant, 2, "le 429, puis la reprise");
  assert.equal(motion.taches.get("q1").dueDate, "2026-10-25T21:59:00Z");
});

// En dernier : après une lecture ratée, Motion n'est plus relu pendant une
// minute (protection du quota) — les tests suivants en pâtiraient.
// --- Ajuster une proposition avant de dire oui (Sam, 18/10) ---------------------

test("proposition ajustée (date, durée, catégorie) : c'est la version ajustée qui part, et la catégorie reste", async () => {
  motion.taches.clear();
  const { categoriesTaches, ecrireEtiquette } = await import("../lib/carnet.js");
  ecrireEtiquette("et-pro", { nom: "Professionnel" });
  await proposition("aj1", [{ type: "creer", nom: "Acheter abonnement Claude Code pour Tom", duree: 10 }]);
  const pid = "p-aj1";
  // Le type et la cible ne bougent jamais ; « id » glissé est ignoré.
  const r = await post(`/api/conversations/aj1/propositions/${pid}/ajuster`, {
    actions: [{ rang: 0, type: "supprimer", id: "autre", nom: "Abonnement Claude Code (Tom)", echeance: "2026-10-22T18:00:00+02:00", duree: 15, priorite: "high", etiquettes: ["et-pro"] }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.actions[0].type, "creer");
  assert.equal(r.body.actions[0].id, undefined);
  assert.equal(r.body.actions[0].priorite, "HIGH");
  const lue = (await lireConv("aj1")).messages[1].proposal;
  assert.equal(lue.ajustee, true);
  assert.equal(lue.actions[0].nom, "Abonnement Claude Code (Tom)");
  assert.equal(lue.actionsOrigine[0].nom, "Acheter abonnement Claude Code pour Tom", "l'originale reste");
  // « Oui » : la requête ne compte pas, la version ajustée de la tour, si.
  const a = await post("/api/motion/apply", { convId: "aj1", index: 1, propositionId: pid, actions: [{ type: "creer", nom: "Injecté" }] });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const creee = [...motion.taches.values()].find((t) => t.name === "Abonnement Claude Code (Tom)");
  assert.ok(creee, "créée sous le nom ajusté");
  assert.equal(creee.duration, 15);
  assert.ok(![...motion.taches.values()].some((t) => t.name === "Injecté"));
  assert.deepEqual(categoriesTaches().get(creee.id), ["et-pro"], "la catégorie suit la tâche créée");
  // Plus ajustable une fois appliquée.
  assert.equal((await post(`/api/conversations/aj1/propositions/${pid}/ajuster`, { actions: [] })).status, 409);
});

test("une action rangée en rappel sort de la proposition ; tout rangé : plus rien à envoyer", async () => {
  await proposition("aj2", [{ type: "creer", nom: "Acheter le cadeau" }, { type: "creer", nom: "Préparer le pitch", duree: 60 }]);
  const r = await post("/api/conversations/aj2/propositions/p-aj2/ajuster", { convertis: [0] });
  assert.deepEqual(r.body.actions.map((x) => [x.nom, x.rang]), [["Préparer le pitch", 1]], "le rang d'origine suit l'action");
  // Un second ajustement s'ajoute au premier : la ligne rangée ne revient pas.
  const d = await post("/api/conversations/aj2/propositions/p-aj2/ajuster", { actions: [{ rang: 1, duree: 90 }] });
  assert.deepEqual(d.body.actions.map((x) => [x.nom, x.duree]), [["Préparer le pitch", 90]]);
  const tout = await post("/api/conversations/aj2/propositions/p-aj2/ajuster", { convertis: [1] });
  assert.equal(tout.body.statut, "converti");
  assert.equal((await lireConv("aj2")).messages[1].proposal.statut, "converti");
  const a = await post("/api/motion/apply", { convId: "aj2", index: 1, propositionId: "p-aj2", actions: [] });
  assert.equal(a.status, 409);
  // Une action qui n'est pas une création ne se range pas en rappel.
  await proposition("aj3", [{ type: "terminer", id: "k9", nom: "Payer la facture" }]);
  const t = await post("/api/conversations/aj3/propositions/p-aj3/ajuster", { convertis: [0] });
  assert.deepEqual(t.body.actions.map((x) => x.type), ["terminer"]);
});

test("une tâche se catégorise depuis l'app, et la journée le dit", async () => {
  const c = await import("../lib/carnet.js");
  c.ecrireEtiquette("et-voiture", { nom: "Voiture" });
  const r = await fetch(`${base}/api/taches/t-garage/etiquettes`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ etiquettes: ["et-voiture", "et-voiture", "inexistante"] }) });
  assert.equal(r.status, 200);
  const j = c.avecCategories({ items: [{ type: "tache", id: "t-garage" }, { type: "rdv", id: "t-garage" }], aFaire: [{ id: "t-garage" }], retard: { total: 0, items: [] } });
  assert.deepEqual(j.items[0].etiquettes, ["et-voiture"], "une étiquette qui n'existe pas est écartée");
  assert.equal(j.items[1].etiquettes, undefined, "un rendez-vous n'a pas de catégorie");
  assert.deepEqual(j.aFaire[0].etiquettes, ["et-voiture"]);
  await fetch(`${base}/api/taches/t-garage/etiquettes`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ etiquettes: [] }) });
  assert.equal(c.categoriesTaches().has("t-garage"), false);
});

test("Motion illisible : rien n'est créé à l'aveugle, et c'est dit", async () => {
  motion.taches.clear();
  motion.pannes.push({ methode: "GET", chemin: /^\/tasks$/, code: 500, fois: 5 });
  const r = await post("/api/motion/apply", { actions: [{ type: "creer", nom: "Nouvelle tâche" }], idCommande: "illisible-1" });
  assert.equal(r.body.ok, false);
  assert.match(r.body.results[0].erreur, /rien n'a été créé, pour ne pas risquer un doublon/);
  assert.equal(motion.taches.size, 0);
  motion.pannes.length = 0;
});
