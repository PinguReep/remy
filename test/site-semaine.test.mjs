// Demain et les 7 jours sur le site (public/app/analyse/semaine.js) : la
// charge en mots (ChargeJour, cas de SemaineTests.swift), ce que montre
// chaque carte (menacées, échéances, rendez-vous), la vue gardée, et la frise
// à l'échelle (heures utiles, jour coupé, couloirs d'AccueilTests). Puis
// GET /api/semaine joué contre les vraies routes de la tour.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const S = await import("../public/app/analyse/semaine.js");
const { impactProlongation, autreJour, jourTitre } = await import("../public/app/analyse/journee.js");

// L'exemple de SemaineTests.swift (lundi 26 octobre 2026, 10:00).
const exemple = {
  maintenant: 1793001600000, aujourdhui: "2026-10-26", horaires: "Work Hours",
  sources: { motion: "ok", agenda: "ok" }, motion: { etat: "ok", luA: 1793001500000 },
  jours: [
    { jour: "2026-10-26", debut: 1792969200000, fin: 1793055600000,
      items: [{ type: "tache", id: "t1", titre: "Finaliser la démo", debut: 1793005200000, fin: 1793010600000, duree: 90 }],
      toute: [], echeances: [], deborde: [], charge: { taches: 90, rdv: 0, travail: 540, disponible: 540 } },
    { jour: "2026-10-27", debut: 1793055600000, fin: 1793142000000,
      items: [
        { type: "tache", id: "t2", titre: "Relire le contrat de Hugo", debut: 1793088000000, fin: 1793091600000, duree: 60, echeance: 1793116800000 },
        { type: "rdv", id: "e1", titre: "Podologue", debut: 1793095200000, fin: 1793098800000, avecAutres: false },
        { type: "tache", id: "t3", titre: "Envoyer le devis", debut: 1793109600000, fin: 1793113200000, duree: 60, echeance: 1793095200000, apresEcheance: true }],
      toute: [{ type: "rdv", id: "e4", titre: "Salon du design" }],
      echeances: [{ id: "t3", titre: "Envoyer le devis", echeance: 1793095200000, placee: true, menacee: true },
        { id: "t2", titre: "Relire le contrat de Hugo", echeance: 1793116800000, placee: true, menacee: false }],
      deborde: [{ id: "t3", titre: "Envoyer le devis", echeance: 1793095200000, fin: 1793113200000 }],
      charge: { taches: 120, rdv: 60, travail: 420, disponible: 360 } },
    { jour: "2026-10-28", debut: "illisible" },
    { jour: "2026-10-29", debut: 1793228400000, items: [], charge: { taches: 600, rdv: 0, travail: 540, disponible: 540 } },
  ],
};
const lundi10h = 1793001600000;

test("la charge se dit en mots (SemaineTests)", () => {
  const c = (taches, extra = {}) => ({ taches, rdv: 0, ...extra });
  assert.equal(S.niveauCharge(c(0, { disponible: 540 })), "libre");
  assert.equal(S.phraseCharge(c(0, { disponible: 540 })), "Rien de prévu sur 9 h libres");
  assert.equal(S.niveauCharge(c(120, { disponible: 360 })), "leger");
  assert.equal(S.phraseCharge(c(120, { disponible: 360 })), "2 h prévues sur 6 h libres");
  assert.equal(S.niveauCharge(c(300, { disponible: 360 })), "charge");
  assert.equal(S.niveauCharge(c(400, { disponible: 360 })), "deborde");
  assert.equal(S.remplissage(c(400, { disponible: 360 })), 1);
  assert.equal(S.phraseCharge(c(45, { disponible: null })), "45 min prévue");
  assert.equal(S.niveauCharge(c(45, { disponible: null })), "leger");
  assert.equal(S.phraseCharge(c(0, { disponible: 0 })), "Pas d'horaires de travail");
  assert.equal(S.niveauCharge(c(30, { disponible: 0 })), "deborde");
  // Un jour sans horaires de travail (dimanche) : pas d'alarme pour 3 h.
  assert.equal(S.niveauCharge(c(180, { travail: 0, disponible: 0 })), "leger");
  assert.equal(S.phraseCharge(c(180, { travail: 0, disponible: 0 })), "3 h prévues, hors horaires");
  assert.equal(S.niveauCharge({ taches: 120, rdv: 540, travail: 540, disponible: 0 }), "deborde", "journée prise par les rendez-vous");
});

test("la jauge : min(1, tâches / disponible), sur 8 h sans horaires, pleine si rien de libre", () => {
  assert.equal(S.remplissage({ taches: 180, disponible: 360 }), 0.5);
  assert.equal(S.remplissage({ taches: 240, disponible: null }), 0.5, "sans horaires : sur 8 h");
  assert.equal(S.remplissage({ taches: 240, travail: 0, disponible: 0 }), 0.5, "un jour sans travail : sur 8 h aussi");
  assert.equal(S.remplissage({ taches: 30, disponible: 0, travail: 540 }), 1);
  assert.equal(S.remplissage({ taches: 0, disponible: 0, travail: 540 }), 0);
  assert.equal(S.niveauCharge({ taches: 600, disponible: null }), "charge", "plus de 8 h sans horaires");
  assert.equal(S.phraseCharge({ taches: 600, disponible: 540 }), "10 h prévues sur 9 h libres");
  assert.equal(S.phraseCharge({ taches: 90, disponible: 90 }), "1 h 30 prévue sur 1 h 30 libre");
});

test("les jours se lisent même abîmés, à partir d'aujourd'hui, sans les cochées", () => {
  const j = S.joursAffiches(exemple, lundi10h);
  assert.deepEqual(j.map((x) => x.jour), ["2026-10-26", "2026-10-27", "2026-10-29"], "un jour illisible est sauté, pas toute la vue");
  assert.deepEqual(S.joursAffiches(exemple, lundi10h + 86400e3).map((x) => x.jour), ["2026-10-27", "2026-10-29"], "une vue d'hier perd son premier jour");
  const sansT3 = S.joursAffiches(exemple, lundi10h, new Set(["t3"]))[1];
  assert.deepEqual(sansT3.items.map((e) => e.id), ["t2", "e1"]);
  assert.deepEqual(sansT3.echeances.map((e) => e.id), ["t2"]);
  assert.deepEqual(sansT3.deborde, []);
  assert.deepEqual(S.joursAffiches(null, lundi10h), []);
  assert.equal(S.demainISO(lundi10h), "2026-10-27");
  assert.equal(S.demainISO(new Date(2026, 9, 31, 23, 30).getTime()), "2026-11-01", "fin de mois");
});

test("RÉGRESSION : un jour demandé par l'adresse hors des jours lus n'est jamais dit « rien de prévu »", () => {
  const jours = S.joursAffiches(exemple, lundi10h);
  assert.equal(S.situerJour("2026-10-27", jours, { maintenant: lundi10h }), "lu");
  assert.equal(S.situerJour("2026-11-20", jours, { maintenant: lundi10h }), "hors", "au-delà des 7 jours lus");
  assert.equal(S.situerJour("2026-10-25", jours, { maintenant: lundi10h }), "passe", "un lien de la veille, ouvert le lendemain");
  assert.equal(S.situerJour("2026-10-28", jours, { maintenant: lundi10h }), "hors", "un jour que la tour n'a pas rendu");
  assert.equal(S.situerJour("2026-11-20", [], { lus: false, maintenant: lundi10h }), "attente", "pas encore lus : on ne sait rien");
  // Le titre d'un tel jour : en toutes lettres, jamais la chaîne ISO.
  assert.equal(S.debutJourISO("2026-11-20"), new Date(2026, 10, 20).getTime());
  assert.equal(jourTitre(S.debutJourISO("2026-11-20")), "Vendredi 20 novembre");
  assert.equal(S.debutJourISO("2026-13-45"), null, "pas un vrai jour");
  assert.equal(S.debutJourISO("demain"), null);
  assert.equal(S.debutJourISO(undefined), null);
  assert.match(S.VIDES.hors, /pas dans les 7 prochains jours/);
  assert.match(S.VIDES.passe, /passé/);
});

test("un jour : rendez-vous, tâches, titres, menaces, ce qu'il faut signaler", () => {
  const mardi = exemple.jours[1];
  assert.deepEqual(S.rendezVousDe(mardi).map((e) => e.titre), ["Podologue"]);
  assert.equal(S.tachesDe(mardi).length, 2);
  assert.equal(S.nombreMenaces(mardi), 1, "la même tâche ne compte qu'une fois");
  assert.equal(S.titreCourtJour(exemple.jours[0]), "Lun 26");
  assert.equal(S.titreCourtJour(mardi), "Mar 27");
  assert.equal(S.titreLongJour(mardi), "Mardi 27 octobre");
  assert.deepEqual(S.menaceesDuJour(mardi).map((t) => t.id), ["t3"]);
  const ailleurs = { ...mardi, echeances: [], deborde: [{ id: "x", titre: "Due lundi", echeance: lundi10h }] };
  assert.deepEqual(S.menaceesDuJour(ailleurs).map((t) => [t.id, t.placee, t.menacee]), [["x", true, true]], "placée après une échéance d'un autre jour");
  assert.deepEqual(S.aSignaler(mardi).map((t) => t.id), ["t3"]);
  assert.deepEqual(S.aSignaler({ items: [], echeances: [{ id: "z", titre: "Pas placée", placee: false }] }).map((t) => t.id), ["z"], "pas sur la frise");
  assert.equal(S.detailEcheance(mardi.echeances[0]), "échéance 11:00 · Motion la place après");
  assert.equal(S.detailEcheance({ echeance: 1793116800000, placee: false }), "échéance 17:00 · pas encore placée par Motion");
  assert.equal(S.detailEcheance({ echeance: 1793116800000, placee: true, menacee: false }), "échéance 17:00");
  assert.equal(S.detailEcheance({}), "échéance · pas encore placée par Motion");
  assert.equal(S.resumeJour(mardi), "2 h prévues sur 6 h libres · 2 échéances");
  assert.equal(S.resumeJour(exemple.jours[0]), "1 h 30 prévue sur 9 h libres");
  assert.equal(S.ligneRendezVous(mardi), "11:00 Podologue");
  assert.equal(S.estVide({ items: [], toute: [], echeances: [] }), true);
  assert.equal(S.estVide(mardi), false);
  assert.deepEqual(S.chargeDe({ items: [{ type: "tache", debut: 0, fin: 45 * 60e3 }, { type: "rdv", debut: 0, fin: 3600e3 }] }), { taches: 45, rdv: 0 }, "sans charge de la tour : ses tâches");
});

test("un jour se relit comme une journée : l'impact d'une prolongation avec SES voisins, le jour dans « Gérer »", () => {
  const j = S.journeeDuJour(exemple.jours[1]);
  assert.equal(j.jour, "2026-10-27");
  assert.equal(j.items.length, 3);
  assert.deepEqual(j.aFaire, [], "tout est placé");
  const t2 = j.items.find((e) => e.id === "t2");
  const i = impactProlongation(t2, 30, j);
  assert.equal(i.conflit, null, "le podologue commence après la nouvelle fin");
  assert.equal(i.tachesDecalees, 1);
  assert.equal(autreJour(1793005200000, lundi10h), null, "aujourd'hui : rien");
  assert.equal(autreJour(1793088000000, lundi10h), "Demain");
  assert.equal(autreJour(1793260800000, lundi10h), "Jeu 29");
  const aPlacer = S.journeeDuJour({ jour: "2026-10-30", items: [], echeances: [{ id: "p", titre: "À placer", echeance: 1, placee: false, duree: 30 }] });
  assert.deepEqual(aPlacer.aFaire.map((t) => [t.id, t.duree]), [["p", 30]]);
});

test("la vue gardée : tour injoignable, erreur, mise à jour", () => {
  const le = new Date(2026, 9, 26, 9, 5).getTime();
  assert.equal(S.etatVue({}, lundi10h), null, "jamais lue : les squelettes le disent");
  assert.equal(S.etatVue({ misAJour: le }, lundi10h), null);
  assert.equal(S.etatVue({ misAJour: le, erreur: { nature: "reseau" } }, lundi10h), "Vue de 09:05 : la tour ne répond pas. Tailscale est-il actif ?");
  assert.equal(S.etatVue({ misAJour: le, erreur: { nature: "serveur", message: "Erreur 500 : réessaie." } }, lundi10h), "Vue de 09:05 : Erreur 500 : réessaie.");
  assert.equal(S.etatVue({ misAJour: le, chargement: true }, lundi10h), "Vue de 09:05, mise à jour…");
  assert.equal(S.etatVue({ misAJour: le - 86400e3, chargement: true }, lundi10h), "Vue d'hier, 09:05, mise à jour…");
});

test("les notes : heures libres inconnues, une source qui n'a pas répondu", () => {
  assert.deepEqual(S.notesSemaine(exemple), []);
  assert.deepEqual(S.notesSemaine({ ...exemple, horaires: null }).map((n) => n.texte), ["Heures libres inconnues : Motion n'a pas transmis d'horaires de travail. Les heures prévues restent justes."]);
  assert.deepEqual(S.notesSemaine({ ...exemple, sources: { motion: "erreur", agenda: "erreur" } }).map((n) => n.texte), ["Motion et l'agenda n'a pas répondu : ces jours peuvent être incomplets. Rafraîchis pour réessayer."]);
  assert.equal(S.notesSemaine({ ...exemple, sources: { motion: "ok", agenda: "erreur" } })[0].texte, "l'agenda n'a pas répondu : ces jours peuvent être incomplets. Rafraîchis pour réessayer.");
  assert.equal(S.VIDES.demain, "Rien de prévu demain : ni rendez-vous, ni tâche placée par Motion.");
});

test("la frise à l'échelle : 8 h – 22 h au moins, jusqu'à minuit si besoin, un élément coupé au jour", () => {
  const d = (hh, mm = 0) => new Date(2026, 9, 27, hh, mm).getTime();
  const jour = S.bornesJour(d(12));
  assert.deepEqual(jour, [new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28).getTime()]);
  assert.deepEqual(S.heuresFrise([], jour), [8, 22]);
  assert.deepEqual(S.heuresFrise([{ debut: d(9), fin: d(10) }], jour), [8, 22]);
  assert.deepEqual(S.heuresFrise([{ debut: d(6, 30), fin: d(7) }, { debut: d(22), fin: d(23, 10) }], jour), [6, 24]);
  assert.deepEqual(S.heuresFrise([{ debut: d(20), fin: jour[1] + 3600e3 }], jour), [8, 24], "fini après minuit : jusqu'au bout");
  const long = { type: "tache", id: "x", debut: d(22) - 86400e3, fin: d(10) };
  assert.deepEqual([S.dansLeJour(long, jour).debut, S.dansLeJour(long, jour).fin], [jour[0], d(10)]);
});

test("deux éléments qui se chevauchent sont côte à côte (AccueilTests)", () => {
  const maintenant = new Date(2026, 9, 15, 10, 40).getTime();
  const h = (hh, mm = 0) => maintenant + (hh * 60 + mm - 640) * 60e3;
  const maquette = { type: "tache", id: "t1", debut: h(10, 15), fin: h(11, 30) };
  const appel = { type: "rdv", id: "e2", debut: h(11), fin: h(11, 15) };
  const dejeuner = { type: "rdv", id: "e1", debut: h(12), fin: h(13, 15) };
  const p = S.couloirs([maquette, appel, dejeuner]);
  assert.deepEqual(p.get("tache:t1"), { index: 0, total: 2 });
  assert.deepEqual(p.get("rdv:e2"), { index: 1, total: 2 });
  assert.deepEqual(p.get("rdv:e1"), { index: 0, total: 1 }, "le déjeuner ne chevauche rien");
  const troisieme = { type: "tache", id: "t9", debut: h(11, 20), fin: h(11, 40) };
  assert.deepEqual(S.couloirs([maquette, appel, troisieme]).get("tache:t9"), { index: 1, total: 2 }, "le couloir libéré se reprend");
});

// --- Le contrat : GET /api/semaine, contre les vraies routes de la tour ---
console.log = () => {};
console.warn = () => {};
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "remy-site-semaine-"));
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

test("contrat : GET /api/semaine?jours=7 rend des jours que le site sait lire, à partir d'aujourd'hui", async () => {
  const r = await fetch(`${base}/api/semaine?jours=7`, { headers: { Accept: "application/json" } });
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.ok(Array.isArray(s.jours));
  assert.ok("sources" in s && "horaires" in s);
  const jours = S.joursAffiches(s, Date.now());
  assert.ok(jours.length >= 1 && jours.length <= 7, String(jours.length));
  for (const j of jours) {
    assert.match(j.jour, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof S.phraseCharge(S.chargeDe(j)), "string");
    assert.ok(S.remplissage(S.chargeDe(j)) >= 0);
  }
  assert.equal(jours[0].jour, (await import("../public/app/analyse/journee.js")).jourISO(new Date()), "le premier jour est aujourd'hui");
});
