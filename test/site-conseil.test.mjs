// Le conseil du moment du site (public/app/analyse/conseil.js) : le port de
// Conseil.pour (Accueil.swift) et de ConseilAffiche (ConseilVue.swift). Les
// cas d'AccueilTests.swift d'abord, mot pour mot, puis chaque branche des
// quatre types, la fraîcheur du conseil réfléchi, la ligne de source et
// « Ce que Rémy a regardé ». Puis le contrat avec la tour : GET /api/conseil
// et POST /api/conseil/renouveler joués contre les vraies routes.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { conseilPour, conseilReflechi, ligneSource, faitsConseil, aProposer, TYPES_CONSEIL } = await import("../public/app/analyse/conseil.js");
const { BROUILLONS } = await import("../public/app/analyse/journee.js");

// Jeudi 15 octobre 2026, 10:40 à Paris (AccueilTests).
const maintenant = new Date(2026, 9, 15, 10, 40).getTime();
const h = (hh, mm = 0) => maintenant + (hh * 60 + mm - 640) * 60e3;
const maquette = () => ({ type: "tache", id: "t1", titre: "Maquette du site", debut: h(10, 15), fin: h(11, 30), duree: 75 });
const dejeuner = () => ({ type: "rdv", id: "e1", titre: "Déjeuner avec Léa", lieu: "Chez Paulette", debut: h(12), fin: h(13, 15) });
const jour = (items, { aFaire = [], retard = null } = {}) => ({ jour: "2026-10-15", items, aFaire, retard, sources: { motion: "ok", agenda: "ok" } });
const du = (j) => conseilPour("maintenant", j, maintenant)?.texte;

// --- AccueilTests.swift ---

test("pendant une tâche : le temps qui reste, puis ce qui suit", () => {
  assert.equal(du(jour([maquette(), dejeuner()])), "Il te reste 50 min sur « Maquette du site ». Ensuite : « Déjeuner avec Léa » à 12:00 (Chez Paulette).");
});

test("un rendez-vous fixe coupe la tâche : c'est ça qu'il faut savoir", () => {
  const tard = { ...maquette(), fin: h(12, 20) };
  assert.equal(du(jour([tard, dejeuner()])), "Il te reste 1 h 40 sur « Maquette du site ». Attention : « Déjeuner avec Léa » commence à 12:00, avant la fin prévue.");
  assert.deepEqual(conseilPour("maintenant", jour([tard, dejeuner()]), maintenant).pourquoi, ["Tâche en cours jusqu'à 12:20", "Rendez-vous fixe à 12:00"]);
});

test("du temps libre : une tâche importante à avancer", () => {
  assert.equal(du(jour([dejeuner()], { aFaire: [{ id: "a", titre: "Appeler l'assurance", priorite: "HIGH" }] })), "1 h 20 devant toi avant « Déjeuner avec Léa » (12:00). De quoi avancer « Appeler l'assurance ».");
});

test("une tâche ordinaire n'est plus proposée dans un trou (« avance sur ta douche »)", () => {
  const douche = { id: "d", titre: "Prendre une douche" };
  const c = conseilPour("maintenant", jour([dejeuner()], { aFaire: [douche] }), maintenant);
  assert.equal(c.texte, "1 h 20 devant toi avant « Déjeuner avec Léa » à 12:00 (Chez Paulette).");
  assert.deepEqual(c.pourquoi, ["1 h 20 avant le prochain élément"]);
  assert.equal(conseilPour("libre", jour([dejeuner()], { aFaire: [douche] }), maintenant).texte, "1 h 20 de libre avant « Déjeuner avec Léa » (12:00).");
});

test("les quatre types de conseil", () => {
  const urgent = { id: "u", titre: "Relancer le comptable", priorite: "ASAP" };
  const r = { total: 2, items: [{ id: "x", titre: "Envoyer le devis" }] };
  const j = jour([maquette(), dejeuner()], { aFaire: [urgent], retard: r });
  assert.equal(conseilPour("prochaine", j, maintenant).texte, "Prochain : « Déjeuner avec Léa » à 12:00 (Chez Paulette), dans 1 h 20.");
  assert.equal(conseilPour("libre", j, maintenant).texte, "30 min de libre avant « Déjeuner avec Léa » (12:00). De quoi avancer « Relancer le comptable ».");
  assert.equal(conseilPour("priorites", j, maintenant).texte, "D'abord « Relancer le comptable ». 2 en retard : commence par « Envoyer le devis ».");
  assert.ok(conseilPour("maintenant", j, maintenant).pourquoi.length > 0);
  assert.deepEqual(TYPES_CONSEIL.map((t) => t.libelle), ["Maintenant", "Prochaine tâche", "Temps libre", "Priorités"]);
});

test("fin de journée : les retards, puis plus rien", () => {
  const r = { total: 2, items: [{ id: "x", titre: "Relancer le comptable" }] };
  assert.equal(du(jour([], { retard: r })), "Journée dégagée. 2 tâches en retard : commence par « Relancer le comptable ».");
  assert.equal(du(jour([])), "Plus rien de prévu aujourd'hui.");
  assert.deepEqual(conseilPour("maintenant", jour([]), maintenant).pourquoi, ["Journée terminée dans Motion et ton agenda"]);
});

test("une tâche bloquée n'est jamais proposée", () => {
  const bloquee = { id: "a", titre: "Facture Ondine", bloquee: true, raison: "J'attends le bon" };
  const libre = { id: "b", titre: "Appeler l'assurance", priorite: "HIGH" };
  assert.equal(du(jour([dejeuner()], { aFaire: [bloquee, libre] })), "1 h 20 devant toi avant « Déjeuner avec Léa » (12:00). De quoi avancer « Appeler l'assurance ».");
  assert.equal(du(jour([], { aFaire: [bloquee] })), "Plus rien de prévu aujourd'hui.");
  const r = { total: 2, items: [{ id: "x", titre: "Relancer le comptable", bloquee: true }, { id: "y", titre: "Envoyer le devis" }] };
  assert.equal(du(jour([], { retard: r })), "Journée dégagée. 2 tâches en retard : commence par « Envoyer le devis ».");
});

test("pas de conseil sans source, ni sans journée", () => {
  assert.equal(conseilPour("maintenant", { sources: {} }, maintenant), null);
  assert.equal(conseilPour("maintenant", null, maintenant), null);
  assert.equal(conseilPour("maintenant", { items: [], sources: { motion: "erreur", agenda: "off" } }, maintenant), null, "tout en panne");
  assert.ok(conseilPour("maintenant", { items: [], sources: { motion: "erreur", agenda: "ok" } }, maintenant), "l'agenda répond : on conseille");
});

// --- Les autres branches de Conseil.pour ---

test("maintenant : un rendez-vous en cours, puis la suite", () => {
  const appel = { type: "rdv", id: "e2", titre: "Appel Hugo", debut: h(10, 30), fin: h(11) };
  const c = conseilPour("maintenant", jour([appel, dejeuner()]), maintenant);
  assert.equal(c.texte, "« Appel Hugo » jusqu'à 11:00. Ensuite : « Déjeuner avec Léa » à 12:00 (Chez Paulette).");
  assert.deepEqual(c.pourquoi, ["Rendez-vous en cours"]);
  assert.equal(du(jour([appel])), "« Appel Hugo » jusqu'à 11:00.", "rien ensuite");
});

test("maintenant : une tâche en cours sans suite, et la tâche sans fin (30 min)", () => {
  assert.equal(du(jour([maquette()])), "Il te reste 50 min sur « Maquette du site ».");
  const sansFin = { type: "tache", id: "t", titre: "Ranger", debut: h(10, 30) };
  assert.equal(du(jour([sansFin])), "Il te reste 20 min sur « Ranger ».");
});

test("maintenant : le prochain élément dans moins de 15 min", () => {
  const bientot = { type: "rdv", id: "e3", titre: "Café", debut: h(10, 50), fin: h(11, 10) };
  const c = conseilPour("maintenant", jour([bientot], { aFaire: [{ id: "a", titre: "Urgent", priorite: "ASAP" }] }), maintenant);
  assert.equal(c.texte, "Prochain : « Café » à 10:50.");
  assert.deepEqual(c.pourquoi, ["Commence dans 10 min"]);
});

test("maintenant : une échéance aujourd'hui fait proposer la tâche, avec sa raison", () => {
  const due = { id: "a", titre: "Envoyer le devis", echeance: h(17) };
  const c = conseilPour("maintenant", jour([dejeuner()], { aFaire: [{ id: "z", titre: "Quelconque" }, due] }), maintenant);
  assert.equal(c.texte, "1 h 20 devant toi avant « Déjeuner avec Léa » (12:00). De quoi avancer « Envoyer le devis ».");
  assert.deepEqual(c.pourquoi, ["1 h 20 avant le prochain élément", "« Envoyer le devis » est due avant 17:00"]);
  const urgent = conseilPour("maintenant", jour([dejeuner()], { aFaire: [{ id: "u", titre: "Payer", priorite: "asap" }] }), maintenant);
  assert.equal(urgent.pourquoi[1], "« Payer » est urgente", "la priorité se lit sans casse");
  assert.equal(aProposer([{ id: "1", titre: "A" }]), null);
});

test("maintenant : plus rien à heure fixe, ce qui reste à faire", () => {
  const a = { id: "a", titre: "Trier la boîte mail" };
  assert.equal(du(jour([], { aFaire: [a] })), "Plus rien à heure fixe. Reste à faire : « Trier la boîte mail ».");
  const c = conseilPour("maintenant", jour([], { aFaire: [a, { id: "b", titre: "B" }, { id: "c", titre: "C" }] }), maintenant);
  assert.equal(c.texte, "Plus rien à heure fixe. Reste à faire : « Trier la boîte mail » et 2 autres.");
  assert.deepEqual(c.pourquoi, ["Plus de créneau fixe aujourd'hui", "3 tâches à faire"]);
  assert.equal(du(jour([], { aFaire: [a, { id: "b", titre: "B" }] })), "Plus rien à heure fixe. Reste à faire : « Trier la boîte mail » et 1 autre.");
  const passe = { type: "rdv", id: "p", titre: "Petit-déjeuner", debut: h(8), fin: h(9) };
  assert.equal(du(jour([passe])), "Plus rien de prévu aujourd'hui.", "un élément passé ne compte plus");
});

test("prochaine : une tâche placée dit sa durée Motion, et ce qui se termine avant", () => {
  const prospection = { type: "tache", id: "t2", titre: "Prospection", debut: h(13, 45), fin: h(15, 15), duree: 90 };
  const c = conseilPour("prochaine", jour([maquette(), prospection]), maintenant);
  assert.equal(c.texte, "Prochain : « Prospection » à 13:45, dans 3 h 05. Motion lui a donné 1 h 30.");
  assert.deepEqual(c.pourquoi, ["Tâche placée par Motion à 13:45", "« Maquette du site » se termine à 11:30"]);
  const r = conseilPour("prochaine", jour([]), maintenant);
  assert.equal(r.texte, "Plus rien de prévu à heure fixe aujourd'hui.");
  assert.deepEqual(r.pourquoi, ["Aucun élément à venir dans ta journée"]);
  assert.deepEqual(conseilPour("prochaine", jour([dejeuner()]), maintenant).pourquoi, ["Rendez-vous fixe à 12:00"]);
});

test("libre : depuis la fin de la tâche en cours ; pas de rendez-vous, ou pas assez de temps", () => {
  const c = conseilPour("libre", jour([maquette(), dejeuner()]), maintenant);
  assert.equal(c.texte, "30 min de libre avant « Déjeuner avec Léa » (12:00).");
  assert.deepEqual(c.pourquoi, ["Rendez-vous fixe à 12:00 (Chez Paulette)"]);
  const aucun = conseilPour("libre", jour([maquette()]), maintenant);
  assert.equal(aucun.texte, "Aucun rendez-vous fixe d'ici ce soir : ton temps est à toi, Motion place tes tâches.");
  assert.deepEqual(aucun.pourquoi, ["Pas de rendez-vous à venir aujourd'hui"]);
  const serre = conseilPour("libre", jour([{ ...maquette(), fin: h(11, 50) }, dejeuner()]), maintenant);
  assert.equal(serre.texte, "Pas vraiment de temps libre avant « Déjeuner avec Léa » à 12:00.");
  assert.deepEqual(serre.pourquoi, ["10 min entre maintenant et ce rendez-vous"]);
  const tache = conseilPour("libre", jour([dejeuner()], { aFaire: [{ id: "u", titre: "Relancer", priorite: "HIGH" }] }), maintenant);
  assert.deepEqual(tache.pourquoi, ["Rendez-vous fixe à 12:00 (Chez Paulette)", "« Relancer » est importante"]);
});

test("priorités : deux urgentes au plus, sinon la première échéance, puis les retards", () => {
  const a = { id: "a", titre: "A", priorite: "ASAP" };
  const b = { id: "b", titre: "B", priorite: "HIGH" };
  const c = { id: "c", titre: "C", priorite: "HIGH" };
  const p = conseilPour("priorites", jour([], { aFaire: [a, b, c] }), maintenant);
  assert.equal(p.texte, "D'abord « A » et « B ».");
  assert.deepEqual(p.pourquoi, ["3 tâches urgentes ou importantes"]);
  assert.deepEqual(conseilPour("priorites", jour([], { aFaire: [a] }), maintenant).pourquoi, ["1 tâche urgente ou importante"]);
  const ech = conseilPour("priorites", jour([], { aFaire: [{ id: "z", titre: "Z" }, { id: "d", titre: "Dossier", echeance: h(18) }] }), maintenant);
  assert.equal(ech.texte, "D'abord « Dossier », due avant 18:00.");
  assert.deepEqual(ech.pourquoi, ["Échéance aujourd'hui"]);
  const retards = conseilPour("priorites", jour([], { retard: { total: 1, items: [{ id: "r", titre: "Banque" }] } }), maintenant);
  assert.equal(retards.texte, "1 en retard : commence par « Banque ».");
  assert.deepEqual(retards.pourquoi, ["1 tâche en retard"]);
  const rien = conseilPour("priorites", jour([], { aFaire: [{ id: "z", titre: "Z" }] }), maintenant);
  assert.equal(rien.texte, "Rien d'urgent aujourd'hui : suis le planning de Motion.");
  assert.deepEqual(rien.pourquoi, ["Aucune tâche urgente, importante ou en retard"]);
  assert.equal(conseilPour("priorites", jour([], { retard: { total: 3, items: [{ id: "r", titre: "X", bloquee: true }] } }), maintenant).texte, "Rien d'urgent aujourd'hui : suis le planning de Motion.", "le seul retard est en attente");
});

// --- ConseilAffiche : le réfléchi seulement s'il est frais, d'où il vient, ce qui a été regardé ---

test("le conseil réfléchi : à jour, ou de moins de 20 min ; sinon le calcul d'ici", () => {
  const c = (genereA, extra = {}) => ({ type: "maintenant", conseil: { texte: "Réfléchi.", source: "glm", genereA, ...extra }, aJour: false, enCours: false, disponible: true });
  assert.equal(conseilReflechi(c(maintenant - 5 * 60e3), maintenant)?.texte, "Réfléchi.");
  assert.equal(conseilReflechi(c(maintenant - 20 * 60e3), maintenant), null, "20 min : trop vieux");
  assert.equal(conseilReflechi({ ...c(maintenant - 9 * 3600e3), aJour: true }, maintenant)?.texte, "Réfléchi.", "à jour : peu importe l'âge");
  assert.equal(conseilReflechi(c(null), maintenant), null, "sans date et pas à jour");
  assert.equal(conseilReflechi(c(maintenant, { source: "regles" }), maintenant), null, "pas du modèle local");
  assert.equal(conseilReflechi({ conseil: null, enCours: true }, maintenant), null, "rien encore");
  assert.equal(conseilReflechi(null, maintenant), null);
  // La capture du soir (19:40) : un conseil de midi n'est plus affiché comme frais.
  const soir = new Date(2026, 9, 15, 19, 40).getTime();
  assert.equal(conseilReflechi(c(new Date(2026, 9, 15, 12, 5).getTime()), soir), null);
});

test("la ligne de source : réfléchi (à HH:MM, il réfléchit à nouveau…), ou calculé ici et pourquoi", () => {
  const glm = { texte: "x", genereA: h(10, 12), source: "glm" };
  assert.equal(ligneSource({ glm, disponible: true, tourne: false, maintenant }), "Réfléchi par Rémy (sur tes machines) · à 10:12");
  assert.equal(ligneSource({ glm, disponible: true, tourne: true, maintenant }), "Réfléchi par Rémy (sur tes machines) · à 10:12 · il réfléchit à nouveau…");
  assert.equal(ligneSource({ glm: { ...glm, genereA: h(10, 12) - 86400e3 }, disponible: true, tourne: false, maintenant }), "Réfléchi par Rémy (sur tes machines) · d'hier, 10:12");
  assert.equal(ligneSource({ glm: null, disponible: true, tourne: true, maintenant }), "Calculé ici en attendant : Rémy réfléchit…");
  assert.equal(ligneSource({ glm: null, disponible: false, tourne: false, maintenant }), "Calculé ici, sans IA (le conseil réfléchi arrivera avec la mise à jour de ta tour).");
  assert.equal(ligneSource({ glm: null, tour: { raison: "Le modèle local ne répond pas." }, disponible: true, tourne: false, maintenant }), "Calculé ici, sans IA. Le modèle local ne répond pas.");
  assert.equal(ligneSource({ glm: null, tour: {}, disponible: true, tourne: false, maintenant }), "Calculé ici, sans IA.");
});

test("ce que Rémy a regardé", () => {
  const j = jour([maquette(), dejeuner(), { type: "tache", id: "t9", titre: "Bloquée", debut: h(14), fin: h(15), bloquee: true }], {
    aFaire: [{ id: "a", titre: "A" }, { id: "b", titre: "B", bloquee: true }],
    retard: { total: 3, items: [] },
  });
  assert.deepEqual(faitsConseil(j, maintenant), [
    "En cours : « Maquette du site » jusqu'à 11:30",
    "Prochain rendez-vous fixe : « Déjeuner avec Léa » à 12:00",
    "1 tâche à faire aujourd'hui sans créneau",
    "3 tâches en retard",
    "2 en attente (jamais proposées)",
  ]);
  assert.deepEqual(faitsConseil(jour([]), maintenant), []);
  assert.deepEqual(faitsConseil(null, maintenant), []);
});

test("« En parler avec Rémy » prépare la phrase de l'iPhone", () => {
  assert.equal(BROUILLONS.conseil("Avance « X »."), "Tu me conseilles : « Avance « X ». » Explique-moi, ou propose autre chose si tu vois mieux.");
});

// --- Le contrat avec la tour : les routes que lit le site ---

console.log = () => {};
console.warn = () => {};
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "remy-site-conseil-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD_HASH", "VERCEL", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "REMY_GLM_URL", "ANTHROPIC_API_KEY"]) delete process.env[v];
process.env.REMY_DATA_DIR = path.join(DATA, "data");
process.env.REMY_CLES_DIR = path.join(DATA, "cles");
process.env.APP_PASSWORD = "secret-de-test";
process.env.SESSION_SECRET = "s";
process.env.REMY_PLANIF = "off";
const { routeApi } = await import("../lib/routes.js");
const serveur = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${serveur.address().port}`;
const { fermer: fermerRemy } = await import("../lib/db.js");
test.after(() => {
  serveur.close();
  fermerRemy();
  fs.rmSync(DATA, { recursive: true, force: true });
});
let cookie = "";
const appel = async (chemin, { methode = "GET", corps } = {}) => {
  const r = await fetch(base + chemin, { method: methode, headers: { Accept: "application/json", "Content-Type": "application/json", Origin: base, Cookie: cookie }, body: corps ? JSON.stringify(corps) : undefined });
  const t = await r.text();
  return { statut: r.status, corps: t ? JSON.parse(t) : null };
};

test("contrat : sans session, 401 (le site passe par la reconnexion)", async () => {
  assert.equal((await appel("/api/conseil?type=libre")).statut, 401);
  assert.equal((await appel("/api/conseil/renouveler", { methode: "POST", corps: { type: "maintenant" } })).statut, 401);
});

test("contrat : GET /api/conseil rend ce que le site lit, pour chaque type ; sans modèle local, renouveler dit pourquoi", async () => {
  const r = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ password: "secret-de-test" }) });
  assert.equal(r.status, 200);
  cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  for (const t of TYPES_CONSEIL) {
    const c = await appel(`/api/conseil?type=${t.id}`);
    assert.equal(c.statut, 200, t.id);
    assert.equal(c.corps.type, t.id);
    for (const cle of ["conseil", "aJour", "enCours", "disponible"]) assert.ok(cle in c.corps, `${t.id} : ${cle}`);
    assert.equal(c.corps.disponible, false, "pas de modèle local ici");
    assert.equal(conseilReflechi(c.corps, Date.now()), null, "rien de réfléchi : le site calcule le sien");
  }
  const n = await appel("/api/conseil/renouveler", { methode: "POST", corps: { type: "libre" } });
  assert.equal(n.statut, 202);
  assert.equal(n.corps.disponible, false);
  assert.ok(n.corps.raison, "la tour dit pourquoi : le bandeau la reprend");
  assert.equal("conseil" in n.corps, false, "la réponse 202 n'a pas de texte : elle ne remplace jamais le conseil affiché");
});
