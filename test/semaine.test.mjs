// Demain et les 7 jours (24/10) : la vue lue dans Motion et l'agenda, sans IA.
// Ce qui est garanti ici :
//   - chaque jour a sa frise, ses échéances, sa charge (prévu contre
//     disponible dans les horaires Motion, rendez-vous déduits) et ce qui
//     déborde ;
//   - lire la semaine ne vide pas le quota Motion : la liste en cache sert,
//     les horaires sont relus toutes les 10 min au plus, l'agenda est lu en
//     UNE requête pour la période, et sans chasser la journée de l'accueil ;
//   - une source en panne laisse les autres s'afficher.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFauxMotion } from "./outils/faux-motion.mjs";

console.log = () => {};

const { semaine, plagesDuJour } = await import("../lib/semaine.js");
const { debutJour } = await import("../lib/dashboard.js");

const H = 3600_000;
const M = 60_000;
// Lundi 26 octobre 2026, 10 h à Paris (heure d'hiver : UTC+1).
const LUNDI_10H = Date.parse("2026-10-26T09:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const a = (jour, h, m = 0) => debutJour(LUNDI_10H) + jour * 24 * H + h * H + m * M;
const BUREAU = { monday: [{ start: "09:00", end: "18:00" }], tuesday: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }], wednesday: [], saturday: [{ start: "10:00", end: "23:59" }] };

test("les plages de travail d'un jour, d'après les horaires Motion", () => {
  assert.deepEqual(plagesDuJour(BUREAU, "2026-10-26"), [[540, 1080]], "lundi");
  assert.deepEqual(plagesDuJour(BUREAU, "2026-10-27"), [[540, 720], [840, 1080]], "mardi en deux plages");
  assert.deepEqual(plagesDuJour(BUREAU, "2026-10-28"), [], "mercredi : rien");
  assert.deepEqual(plagesDuJour(BUREAU, "2026-10-31"), [[600, 1440]], "« 23:59 » va jusqu'à minuit");
  assert.equal(plagesDuJour(null, "2026-10-26"), null, "horaires inconnus");
});

test("sept jours : frise, échéances, charge et débordement par jour", () => {
  const taches = [
    // Aujourd'hui, placée.
    { id: "t1", name: "Finaliser la démo", scheduledStart: iso(a(0, 11)), scheduledEnd: iso(a(0, 12, 30)), duration: 90, dueDate: iso(a(0, 18)) },
    // Demain : deux tâches placées, dont une APRÈS son échéance.
    { id: "t2", name: "Relire le contrat de Hugo", scheduledStart: iso(a(1, 9)), scheduledEnd: iso(a(1, 10)), duration: 60, dueDate: iso(a(1, 17)) },
    { id: "t3", name: "Envoyer le devis", scheduledStart: iso(a(1, 15)), scheduledEnd: iso(a(1, 16)), duration: 60, dueDate: iso(a(1, 11)) },
    // Échéance jeudi, pas placée : menacée.
    { id: "t4", name: "Payer l'assurance", dueDate: iso(a(3, 12)), duration: 15 },
    // Hors de la période.
    { id: "t5", name: "Plus tard", scheduledStart: iso(a(9, 10)), scheduledEnd: iso(a(9, 11)), dueDate: iso(a(10, 10)) },
    // Terminée : ignorée.
    { id: "t6", name: "Déjà faite", completed: true, scheduledStart: iso(a(1, 11)), scheduledEnd: iso(a(1, 12)) },
  ];
  const evenements = [
    { id: "e1", summary: "Podologue", start: { dateTime: iso(a(1, 11)) }, end: { dateTime: iso(a(1, 12)) } },
    // Chevauche le premier : la demi-heure commune ne compte qu'une fois.
    { id: "e2", summary: "Appel Léa", start: { dateTime: iso(a(1, 11, 30)) }, end: { dateTime: iso(a(1, 12, 30)) } },
    // En dehors des horaires : ne retire rien au disponible.
    { id: "e3", summary: "Dîner", start: { dateTime: iso(a(1, 20)) }, end: { dateTime: iso(a(1, 22)) } },
    { id: "e4", summary: "Salon du design", start: { date: "2026-10-28" }, end: { date: "2026-10-30" } },
  ];
  const s = semaine({ taches, evenements, horaires: BUREAU, maintenant: LUNDI_10H });
  assert.equal(s.aujourdhui, "2026-10-26");
  assert.deepEqual(s.jours.map((j) => j.jour), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);

  const [lun, mar, mer, jeu, ven] = s.jours;
  assert.deepEqual(lun.items.map((i) => i.id), ["t1"]);
  assert.equal(lun.charge.taches, 90);
  assert.equal(lun.charge.disponible, 9 * 60);

  assert.deepEqual(mar.items.map((i) => i.id), ["t2", "e1", "e2", "t3", "e3"], "dans l'ordre du temps");
  assert.equal(mar.items.find((i) => i.id === "e1").etat, "avenir");
  assert.equal(mar.charge.taches, 120);
  assert.equal(mar.charge.rdv, 90 + 120, "chevauchement compté une fois");
  assert.equal(mar.charge.travail, 7 * 60);
  // 11:00-12:00 dans la plage du matin ; 12:00-12:30 hors plage ; le dîner hors plage.
  assert.equal(mar.charge.disponible, 7 * 60 - 60);
  assert.deepEqual(mar.deborde.map((t) => t.id), ["t3"], "placée après son échéance");
  assert.equal(mar.items.find((i) => i.id === "t3").apresEcheance, true);
  assert.deepEqual(mar.echeances.map((e) => [e.id, e.menacee]), [["t3", true], ["t2", false]]);

  assert.deepEqual(mer.toute.map((e) => e.titre), ["Salon du design"]);
  assert.equal(mer.charge.disponible, 0, "mercredi : pas d'horaires");
  assert.deepEqual(jeu.echeances.map((e) => [e.id, e.placee, e.menacee]), [["t4", false, true]]);
  assert.deepEqual(jeu.toute.map((e) => e.titre), ["Salon du design"]);
  assert.deepEqual(ven.toute, [], "la fin d'une journée entière est exclusive");
  assert.equal(s.jours.flatMap((j) => j.items).some((i) => i.id === "t5" || i.id === "t6"), false);
});

test("sans horaires Motion : la charge prévue reste, le disponible est inconnu", () => {
  const s = semaine({ taches: [], evenements: [], horaires: null, maintenant: LUNDI_10H, jours: 2 });
  assert.equal(s.jours.length, 2);
  assert.equal(s.jours[0].charge.disponible, null);
  assert.equal(s.jours[0].charge.taches, 0);
  assert.equal(semaine({ maintenant: LUNDI_10H, jours: 99 }).jours.length, 14, "plafond");
});

test("le passage à l'heure d'hiver : un jour de 25 h reste un seul jour", () => {
  // Dimanche 25 octobre 2026 : 3 h redevient 2 h à Paris.
  const s = semaine({ maintenant: Date.parse("2026-10-24T10:00:00Z"), jours: 3 });
  assert.deepEqual(s.jours.map((j) => j.jour), ["2026-10-24", "2026-10-25", "2026-10-26"]);
  assert.equal(s.jours[1].fin - s.jours[1].debut, 25 * H);
});

// --- Par la tour : quota Motion et agenda -------------------------------------------

const lecturesAgenda = [];
let agendaEnPanne = false;
const google = http.createServer((req, res) => {
  const u = new URL(req.url, "http://g");
  res.setHeader("Content-Type", "application/json");
  if (u.pathname === "/token") return res.end(JSON.stringify({ access_token: "faux", expires_in: 3600 }));
  if (/\/events$/.test(u.pathname)) {
    lecturesAgenda.push({ timeMin: u.searchParams.get("timeMin"), timeMax: u.searchParams.get("timeMax"), max: u.searchParams.get("maxResults") });
    if (agendaEnPanne) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: { message: "panne injectée" } }));
    }
    const demain = debutJour() + 24 * H + 11 * H;
    return res.end(JSON.stringify({ items: [{ id: "g1", summary: "Podologue", start: { dateTime: iso(demain) }, end: { dateTime: iso(demain + 45 * M) } }] }));
  }
  res.statusCode = 404;
  res.end("{}");
});
await new Promise((r) => google.listen(0, "127.0.0.1", r));

const motion = await demarrerFauxMotion({ quotaParMinute: 12, horaires: { monday: [{ start: "09:00", end: "18:00" }], tuesday: [{ start: "09:00", end: "18:00" }], wednesday: [{ start: "09:00", end: "18:00" }], thursday: [{ start: "09:00", end: "18:00" }], friday: [{ start: "09:00", end: "18:00" }] } });
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-semaine-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "MOTION_WORKSPACE_ID", "REMY_MOTION_HORAIRE"]) delete process.env[v];
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
const { fermer } = await import("../lib/db.js");
const carnet = await import("../lib/carnet.js");

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
const lire = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const appelsMotion = (re) => motion.requetes.filter((r) => r.methode === "GET" && re.test(r.chemin)).length;

test.after(async () => {
  remy.close();
  google.close();
  await motion.fermer();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

test("la semaine par la tour : une lecture Motion partagée, une requête d'agenda pour la période", async () => {
  const demain9h = debutJour() + 24 * H + 9 * H;
  motion.ajouter({ id: "m1", name: "Préparer la facture Ondine", scheduledStart: iso(demain9h), scheduledEnd: iso(demain9h + H), duration: 60, dueDate: iso(demain9h + 8 * H) });
  motion.ajouter({ id: "m2", name: "Trier la boîte mail", dueDate: iso(debutJour() + 3 * 24 * H + 12 * H), duration: 20 });
  carnet.marquerTache("m1", { bloquee: true, raison: "J'attends le bon de commande" });

  const r = await lire("/api/semaine");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body;
  assert.equal(s.jours.length, 7);
  assert.equal(s.sources.motion, "ok");
  assert.equal(s.sources.agenda, "ok");
  assert.equal(s.horaires, "Work Hours");
  const demain = s.jours[1];
  assert.deepEqual(demain.items.map((i) => i.titre), ["Préparer la facture Ondine", "Podologue"]);
  assert.equal(demain.items[0].bloquee, true, "l'état gardé par Remy suit la tâche");
  assert.equal(demain.charge.taches, 60);
  assert.ok(s.jours[3].echeances.some((e) => e.id === "m2" && e.menacee), "échéance non placée");
  assert.equal(lecturesAgenda.length, 1);
  assert.equal(lecturesAgenda[0].max, "250", "une semaine : de la place pour tous les rendez-vous");
  assert.equal(Date.parse(lecturesAgenda[0].timeMax) - Date.parse(lecturesAgenda[0].timeMin) >= 7 * 23 * H, true, "toute la période d'un coup");

  // Rouvrir la vue cinq fois, puis l'accueil : rien de plus vers Motion, et
  // l'agenda de la semaine sert depuis le cache sans chasser celui du jour.
  const listesAvant = appelsMotion(/^\/v1\/tasks(\?|$)/);
  for (let i = 0; i < 5; i++) assert.equal((await lire("/api/semaine")).status, 200);
  await lire("/api/dashboard");
  await lire("/api/semaine");
  await lire("/api/dashboard");
  assert.equal(appelsMotion(/^\/v1\/tasks(\?|$)/), listesAvant, "la liste Motion en cache sert");
  assert.equal(appelsMotion(/^\/v1\/schedules/), 1, "horaires relus au plus toutes les 10 min");
  assert.equal(lecturesAgenda.length, 2, "une lecture pour la semaine, une pour la journée");
});

test("l'agenda en panne : la semaine s'affiche avec Motion, et le dit", async () => {
  agendaEnPanne = true;
  const r = await lire("/api/semaine?jours=3");
  agendaEnPanne = false;
  assert.equal(r.status, 200);
  assert.equal(r.body.jours.length, 3);
  // Le cache de la période de 7 jours ne sert pas pour 3 jours : vraie relecture, ratée.
  assert.equal(r.body.sources.agenda, "erreur");
  assert.equal(r.body.sources.motion, "ok");
  assert.ok(r.body.jours[1].items.some((i) => i.titre === "Préparer la facture Ondine"));
});

test("sans session : refusé", async () => {
  process.env.APP_PASSWORD = "secret-de-test";
  try {
    assert.equal((await lire("/api/semaine")).status, 401);
  } finally {
    delete process.env.APP_PASSWORD;
  }
});
