// La journée du site (public/app/analyse/journee.js) : ce que l'iPhone
// calcule sur place, porté pour Aujourd'hui et « Gérer ». L'effet d'une
// prolongation (ImpactProlongation, cas d'AccueilTests et SemaineTests), la
// tâche suivante et « Choisir… » (EtMaintenant, ChoixTache), les cochées
// retirées de la journée (TableauModel.journee), ce que disent les lignes et
// « Gérer », les questions préparées (Brouillons). Puis les routes des gestes
// (état d'une tâche, d'une activité) jouées contre les vraies routes.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const J = await import("../public/app/analyse/journee.js");

// Jeudi 15 octobre 2026, 10:40 à Paris (AccueilTests).
const maintenant = new Date(2026, 9, 15, 10, 40).getTime();
const h = (hh, mm = 0) => maintenant + (hh * 60 + mm - 640) * 60e3;
const maquette = () => ({ type: "tache", id: "t1", titre: "Maquette du site", debut: h(10, 15), fin: h(11, 30), duree: 75 });
const dejeuner = () => ({ type: "rdv", id: "e1", titre: "Déjeuner avec Léa", lieu: "Chez Paulette", debut: h(12), fin: h(13, 15) });
const prospection = () => ({ type: "tache", id: "t2", titre: "Prospection", debut: h(13, 45), fin: h(15, 15), duree: 90 });
const jour = (items, { aFaire = [], retard = null } = {}) => ({ jour: "2026-10-15", items, aFaire, retard, sources: { motion: "ok", agenda: "ok" } });

// --- Prolonger ---

test("impact sur un rendez-vous fixe", () => {
  const i = J.impactProlongation(maquette(), 40, jour([maquette(), dejeuner(), prospection()]));
  assert.equal(i.conflit?.id, "e1");
  assert.equal(i.retard, 10);
  assert.equal(i.phrase, "Fin à 12:10 : tu arriverais à « Déjeuner avec Léa » 10 min en retard. C'est un rendez-vous fixe.");
});

test("RÉGRESSION : le rendez-vous coupe déjà la tâche, « +15 » ne dit pas « aucun rendez-vous touché »", () => {
  const tard = { ...maquette(), fin: h(12, 10) };
  const i = J.impactProlongation(tard, 15, jour([tard, dejeuner(), prospection()]));
  assert.equal(i.conflit?.id, "e1");
  assert.equal(i.retard, 25);
  assert.equal(i.phrase, "Fin à 12:25 : tu arriverais à « Déjeuner avec Léa » 25 min en retard. C'est un rendez-vous fixe.");
});

test("impact sans rendez-vous touché : la tâche suivante, les N suivantes, ou rien", () => {
  const i = J.impactProlongation(maquette(), 15, jour([maquette(), dejeuner(), prospection()]));
  assert.equal(i.conflit, null);
  assert.equal(i.tachesDecalees, 1);
  assert.equal(i.phrase, "Fin à 11:45. Aucun rendez-vous touché ; Motion décalera la tâche suivante.");
  const autre = { type: "tache", id: "t3", titre: "Devis", debut: h(16), fin: h(16, 30) };
  assert.equal(J.impactProlongation(maquette(), 15, jour([maquette(), dejeuner(), prospection(), autre])).phrase, "Fin à 11:45. Aucun rendez-vous touché ; Motion décalera les 2 tâches suivantes.");
  assert.equal(J.impactProlongation(maquette(), 15, jour([maquette()])).phrase, "Fin à 11:45. Rien d'autre n'est touché.");
  assert.equal(J.impactProlongation(maquette(), 15, null).phrase, "Fin à 11:45. Rien d'autre n'est touché.", "sans journée");
});

test("impact : un rendez-vous déjà commencé avant la tâche ne compte pas ; la même tâche non plus", () => {
  const avant = { type: "rdv", id: "e0", titre: "Appel", debut: h(10), fin: h(10, 30) };
  const i = J.impactProlongation(maquette(), 30, jour([avant, maquette(), { type: "rdv", id: "t1", titre: "Appel au même id", debut: h(11, 45), fin: h(12) }]));
  assert.equal(i.conflit?.id, "t1", "un rdv qui porte le même id qu'une tâche reste un autre élément");
  assert.equal(J.impactProlongation(maquette(), 30, jour([avant, maquette()])).conflit, null);
});

test("impact un autre jour : avec les voisins DE CE JOUR (SemaineTests)", () => {
  // Mardi 27 octobre 2026 : « Relire le contrat » 9:00–10:00, le podologue à 11:00, « Envoyer le devis » 15:00.
  const t2 = { type: "tache", id: "t2", titre: "Relire le contrat de Hugo", debut: 1793088000000, fin: 1793091600000, duree: 60, echeance: 1793116800000 };
  const j = { jour: "2026-10-27", items: [t2, { type: "rdv", id: "e1", titre: "Podologue", debut: 1793095200000, fin: 1793098800000, avecAutres: false }, { type: "tache", id: "t3", titre: "Envoyer le devis", debut: 1793109600000, fin: 1793113200000, duree: 60 }] };
  const i = J.impactProlongation(t2, 30, j);
  assert.equal(i.conflit, null, "le podologue commence après la nouvelle fin");
  assert.equal(i.tachesDecalees, 1);
});

test("« Est-ce raisonnable ? » et « déplacer » : les phrases de l'iPhone", () => {
  const i = J.impactProlongation(maquette(), 15, jour([maquette(), dejeuner(), prospection()]));
  assert.equal(J.brouillonRaisonnable(maquette(), 15, i), "Je pense prolonger « Maquette du site » de 15 min. Fin à 11:45. Aucun rendez-vous touché ; Motion décalera la tâche suivante. Est-ce raisonnable vu la suite de ma journée ?");
  assert.equal(J.brouillonDeplacer(dejeuner()), "Je voudrais déplacer « Déjeuner avec Léa » (12:00). Quels créneaux proposes-tu, et qui faut-il prévenir ?");
  assert.equal(J.BROUILLONS.rendezVous(dejeuner()), "Aide-moi à préparer « Déjeuner avec Léa » (12:00).");
  assert.equal(J.BROUILLONS.tache("Maquette du site"), "Aide-moi à avancer sur « Maquette du site ».");
  assert.equal(J.BROUILLONS.retard({ titre: "Envoyer le devis", echeance: new Date(2026, 9, 25, 23).getTime() }), "« Envoyer le devis » est en retard depuis le 25 oct.. Qu'est-ce que je fais ?");
  assert.equal(J.BROUILLONS.retard({ titre: "Envoyer le devis" }), "« Envoyer le devis » est en retard. Qu'est-ce que je fais ?");
  assert.equal(J.BROUILLONS.retards, "Qu'est-ce qui est en retard, et par quoi je commence ?");
  assert.equal(J.BROUILLONS.menacee({ titre: "Dossier banque", phrase: "Due aujourd'hui 18:00, aucun créneau prévu." }), "« Dossier banque » est menacée : Due aujourd'hui 18:00, aucun créneau prévu. Trouve-lui un créneau avant son échéance, sans toucher à mes rendez-vous.");
  assert.equal(J.titreFilJournee(new Date(2026, 9, 5)), "05/10/2026 · Journée");
});

// --- « Et maintenant ? » ---

test("la suivante : la prochaine tâche placée à venir, sinon celle en cours, sinon à faire", () => {
  const bloquee = { type: "tache", id: "b", titre: "Bloquée", debut: h(11, 30), fin: h(12), bloquee: true };
  const s = J.suivante(jour([maquette(), bloquee, dejeuner(), prospection()]), maintenant);
  assert.equal(s.id, "t2", "ni le rendez-vous, ni la bloquée");
  assert.equal(s.detail, "13:45");
  assert.equal(s.item.id, "t2");
  assert.equal(J.suivante(jour([maquette(), dejeuner()]), maintenant).id, "t1", "aucune à venir : celle en cours (Continuer)");
  const t = J.suivante(jour([dejeuner()], { aFaire: [{ id: "x", titre: "En attente", bloquee: true }, { id: "a", titre: "Trier", duree: 20 }] }), maintenant);
  assert.deepEqual([t.id, t.detail, t.duree, t.item], ["a", "à faire aujourd'hui", 20, null]);
  assert.equal(J.suivante(jour([dejeuner()]), maintenant), null);
  assert.equal(J.suivante(null, maintenant), null);
});

test("« Choisir… » : aujourd'hui, en retard, cette semaine — sans doublon ni tâche en attente", () => {
  const j = jour([maquette(), dejeuner(), prospection()], {
    aFaire: [{ id: "a", titre: "Trier", echeance: h(18) }, { id: "b", titre: "Ranger" }, { id: "x", titre: "Bloquée", bloquee: true }],
    retard: { total: 2, items: [{ id: "r", titre: "Banque" }, { id: "rb", titre: "Retard bloqué", bloquee: true }] },
  });
  const projets = [
    { nom: "Boutiques", prochaine: { id: "p1", titre: "Visuels", echeance: new Date(2026, 9, 16, 9).getTime() } },
    { nom: "Album", prochaine: { id: "t2", titre: "Prospection" } },
    { nom: "Lointain", prochaine: { id: "p3", titre: "Plus tard", echeance: maintenant + 8 * 86400e3 } },
    { nom: "Attente", prochaine: { id: "p4", titre: "Bloquée", bloquee: true } },
    { nom: "Sans date", prochaine: { id: "p5", titre: "Un jour" } },
    { nom: "Vide" },
  ];
  const c = J.candidatsChoix(j, projets, maintenant);
  assert.deepEqual(c.aujourdhui.map((x) => [x.id, x.detail]), [["t2", "13:45 · 1 h 30"], ["a", "avant 18:00"], ["b", "aujourd'hui"]]);
  assert.ok(c.aujourdhui[0].item, "une tâche placée s'ouvre dans « Gérer »");
  assert.deepEqual(c.retard.map((x) => [x.id, x.detail]), [["r", "en retard"]]);
  assert.deepEqual(c.semaine.map((x) => [x.id, x.detail]), [["p1", "Boutiques · ven. 16 oct."], ["p5", "Sans date"]]);
  const vide = J.candidatsChoix(jour([]), [], maintenant);
  assert.deepEqual([vide.aujourdhui.length, vide.retard.length, vide.semaine.length], [0, 0, 0]);
});

// --- Cochées ---

test("les cochées du jour : purgées au changement de jour, retirées de la journée", () => {
  assert.deepEqual(J.cocheesDuJour({ jour: "2026-10-14", liste: [{ id: "t1" }] }, "2026-10-15"), [], "celles d'hier sont parties");
  assert.deepEqual(J.cocheesDuJour({ jour: "2026-10-15", liste: [{ id: "t1" }] }, "2026-10-15").map((c) => c.id), ["t1"]);
  assert.deepEqual(J.cocheesDuJour(null, "2026-10-15"), []);
  assert.equal(J.jourISO(new Date(2026, 9, 5, 23, 30)), "2026-10-05", "le jour de la machine, pas l'UTC");
  const j = jour([maquette(), { ...dejeuner(), id: "t1" }, prospection()], { aFaire: [{ id: "a", titre: "A" }], retard: { total: 5, items: [{ id: "r", titre: "R" }, { id: "s", titre: "S" }] } });
  const f = J.sansCochees(j, new Set(["t1", "a", "r"]));
  assert.deepEqual(f.items.map((e) => `${e.type}:${e.id}`), ["rdv:t1", "tache:t2"], "un rendez-vous au même id reste");
  assert.deepEqual(f.aFaire, []);
  assert.deepEqual(f.retard.items.map((t) => t.id), ["s"]);
  assert.equal(f.retard.total, 4, "le total suit");
  assert.equal(J.sansCochees(j, new Set()), j);
});

// --- Les lignes et « Gérer » ---

test("une ligne du planning dit tout : en cours, lieu, projet, catégories, durée, priorité", () => {
  const e = { ...maquette(), projet: "Boutiques", priorite: "ASAP" };
  assert.equal(J.detailLigne(e, maintenant, ["Pro"]), "en cours · Boutiques · Pro · 1 h 15 · urgent");
  assert.equal(J.detailLigne(dejeuner(), maintenant), "Chez Paulette", "un rendez-vous n'a pas de durée");
  assert.equal(J.detailLigne({ ...prospection(), priorite: "HIGH" }, maintenant), "1 h 30 · important");
  assert.equal(J.motPriorite("medium"), null);
  assert.deepEqual(J.PRIORITES.map((p) => p[1]), ["Urgente", "Importante", "Normale", "Basse"]);
});

test("une tâche à faire : « avant HH:MM » entre 5 h et 20 h, en retard « prévue le … »", () => {
  assert.equal(J.detailTache({ titre: "A", echeance: h(18), projet: "Boutiques", priorite: "HIGH" }, { noms: ["Pro"] }), "avant 18:00 · Boutiques · Pro · important");
  assert.equal(J.detailTache({ titre: "A", echeance: h(23) }), "", "une échéance de fin de journée ne dit rien");
  assert.equal(J.detailTache({ titre: "A", echeance: h(4, 30) }), "");
  assert.equal(J.detailTache({ titre: "A", echeance: new Date(2026, 9, 12, 23).getTime() }, { enRetard: true }), "prévue le 12 oct.");
  assert.equal(J.marqueBloquee("J'attends le devis"), "En attente · J'attends le devis");
  assert.equal(J.marqueBloquee(null), "En attente");
  assert.equal(J.plusEnRetard({ total: 5, items: [{}, {}] }), "Et 3 autres en retard.");
  assert.equal(J.plusEnRetard({ total: 3, items: [{}, {}] }), "Et une autre en retard.");
  assert.equal(J.plusEnRetard({ total: 2, items: [{}, {}] }), null);
});

test("« Gérer » : horaires, il reste, au total, le jour quand ce n'est pas aujourd'hui", () => {
  assert.equal(J.horairesTache(maquette(), maintenant), "10:15 – 11:30 · il reste 50 min · 1 h 15 au total");
  assert.equal(J.horairesTache(prospection(), maintenant), "13:45 – 15:15 · 1 h 30 au total");
  const demain = { ...prospection(), debut: prospection().debut + 86400e3, fin: prospection().fin + 86400e3 };
  assert.equal(J.horairesTache(demain, maintenant), "Demain · 13:45 – 15:15 · 1 h 30 au total");
  const lundi = { ...prospection(), debut: new Date(2026, 9, 19, 9).getTime(), fin: new Date(2026, 9, 19, 10).getTime(), duree: 60 };
  assert.equal(J.horairesTache(lundi, maintenant), "Lun 19 · 09:00 – 10:00 · 1 h au total");
  assert.equal(J.quandSansCreneau({ retard: true, echeance: new Date(2026, 9, 12, 23).getTime(), duree: 30 }), "En retard · prévue le 12 oct. · 30 min");
  assert.equal(J.quandSansCreneau({ retard: false, echeance: h(18), duree: 30 }), "Pas encore placée par Motion · avant 18:00 · 30 min");
  assert.equal(J.quandSansCreneau({}), "Pas encore placée par Motion");
  const aspirateur = { type: "rdv", id: "e5", titre: "Aspirateur", debut: h(10, 30), fin: h(11), avecAutres: false };
  assert.equal(J.horairesRendezVous(aspirateur, maintenant), "10:30 – 11:00 · en cours");
  assert.equal(J.horairesRendezVous({ ...aspirateur, fait: true }, maintenant), "10:30 – 11:00 · faite");
  assert.equal(J.horairesRendezVous(dejeuner(), maintenant), "12:00 – 13:15 · Chez Paulette");
  assert.equal(J.lienAgendaJour(h(12)), "https://calendar.google.com/calendar/r/day/2026/10/15");
});

test("les formats de l'iPhone : depuis, autre jour, jour en titre, page d'un autre jour", () => {
  assert.equal(J.depuis(h(9, 5), maintenant), "de 09:05");
  assert.equal(J.depuis(h(9, 5) - 86400e3, maintenant), "d'hier, 09:05");
  assert.equal(J.depuis(new Date(2026, 9, 2, 18, 2).getTime(), maintenant), "du 2 oct., 18:02");
  assert.equal(J.autreJour(h(23, 50), maintenant), null);
  assert.equal(J.jourTitre(maintenant), "Jeudi 15 octobre");
  assert.equal(J.jourCourtSemaine(new Date(2026, 9, 26).getTime()), "Lun 26");
  assert.equal(J.duree(65), "1 h 05");
  assert.equal(J.duree(120), "2 h");
  assert.equal(J.estPerimee({ jour: "2026-10-14" }, maintenant), true);
  assert.equal(J.estPerimee({ jour: "2026-10-15" }, maintenant), false);
  assert.equal(J.estPerimee({}, maintenant), false, "une tour qui ne dit pas le jour : rien à dire");
  assert.equal(J.estActivite({ type: "rdv", avecAutres: false }), true);
  assert.equal(J.estActivite({ type: "rdv", avecAutres: true }), false);
  assert.equal(J.dureeTotale({ debut: h(10), fin: h(10, 45) }), 45, "à défaut de durée Motion, celle du créneau");
});

// --- Les routes des gestes, contre les vraies routes de la tour ---

console.log = () => {};
console.warn = () => {};
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "remy-site-journee-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "REMY_GLM_URL", "ANTHROPIC_API_KEY"]) delete process.env[v];
process.env.REMY_DATA_DIR = path.join(DATA, "data");
process.env.REMY_CLES_DIR = path.join(DATA, "cles");
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
const appel = async (chemin, { methode = "GET", corps } = {}) => {
  const r = await fetch(base + chemin, { method: methode, headers: { Accept: "application/json", "Content-Type": "application/json", Origin: base }, body: corps ? JSON.stringify(corps) : undefined });
  const t = await r.text();
  return { statut: r.status, corps: t ? JSON.parse(t) : null };
};

test("contrat : une activité se coche et se décoche (PUT /api/taches/rdv:<id>/etat), une tâche se commence et se remet à sa place", async () => {
  const fait = await appel(`/api/taches/${encodeURIComponent("rdv:e5")}/etat`, { methode: "PUT", corps: { fait: true } });
  assert.equal(fait.statut, 200, JSON.stringify(fait.corps));
  const defait = await appel(`/api/taches/${encodeURIComponent("rdv:e5")}/etat`, { methode: "PUT", corps: { fait: false } });
  assert.equal(defait.statut, 200);
  const commence = await appel("/api/taches/t2/etat", { methode: "PUT", corps: { commencee: maintenant } });
  assert.equal(commence.statut, 200, JSON.stringify(commence.corps));
  const remise = await appel("/api/taches/t2/etat", { methode: "PUT", corps: { commencee: false } });
  assert.equal(remise.statut, 200);
});

test("contrat : sans Motion, les projets (« Cette semaine ») se lisent vides, et l'annulation d'une coche inconnue est refusée", async () => {
  const p = await appel("/api/projets");
  assert.equal(p.statut, 200);
  assert.ok(Array.isArray(p.corps.projets));
  assert.deepEqual(J.candidatsChoix(jour([]), p.corps.projets, maintenant).semaine, []);
  const u = await appel("/api/motion/undo", { methode: "POST", corps: { id: "inconnu" } });
  assert.ok(u.statut >= 400, `${u.statut} ${JSON.stringify(u.corps)}`);
});
