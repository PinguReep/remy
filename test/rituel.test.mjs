// Le rendez-vous quotidien (24/10) : briefing du matin, bilan du soir et
// signal « menacée », calculés sans IA. Données fictives, heure de Paris.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const racine = fs.mkdtempSync(path.join(os.tmpdir(), "remy-rituel-"));
for (const v of ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "MOTION_API_KEY", "VERCEL", "ANTHROPIC_API_KEY"]) delete process.env[v];
process.env.REMY_DATA_DIR = racine;

const { menacees, briefingMatin, bilanSoir, faitsDepuis, texteBilan, tempsLibre, quand } = await import("../lib/rituel.js");
const { journee } = await import("../lib/dashboard.js");

const H = 3600_000;
// Vendredi 23 octobre 2026, 8 h à Paris (UTC+2).
const MATIN = Date.parse("2026-10-23T06:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const a = (h, m = 0, jour = 0) => Date.parse("2026-10-22T22:00:00Z") + jour * 24 * H + h * H + m * 60_000;

test("une tâche placée après son échéance est menacée, avec « repousser »", () => {
  const taches = [{ id: "t1", name: "Envoyer les visuels", dueDate: iso(a(17)), scheduledStart: iso(a(10, 0, 1)), scheduledEnd: iso(a(11, 0, 1)), duration: 60 }];
  const [m] = menacees({ taches, maintenant: MATIN });
  assert.equal(m.raison, "apres-echeance");
  assert.match(m.phrase, /Planifiée demain 10:00, après son échéance \(aujourd'hui 17:00\)/);
  assert.equal(m.action.type, "repousser");
  assert.ok(m.action.echeance >= a(11, 0, 1), "la nouvelle échéance couvre le créneau");
});

test("une tâche due sous 24 h sans créneau est menacée ; une lointaine ou en retard non", () => {
  const taches = [
    { id: "t1", name: "Facture Ondine", dueDate: iso(a(17)) },
    { id: "t2", name: "Plus tard", dueDate: iso(a(9, 0, 6)) },
    { id: "t3", name: "Déjà en retard", dueDate: iso(a(6, 0, -1)) },
    { id: "t4", name: "Bien placée", dueDate: iso(a(17)), scheduledStart: iso(a(14)), scheduledEnd: iso(a(15)) },
  ];
  const m = menacees({ taches, maintenant: MATIN });
  assert.deepEqual(m.map((x) => x.id), ["t1"]);
  assert.equal(m[0].raison, "sans-creneau");
  assert.equal(m[0].action.type, "caser");
});

test("capacité : ce qui ne tient plus dans le temps libre déborde", () => {
  const maintenant = a(19); // 19 h : deux heures utiles avant 21 h
  const evenements = [{ id: "e1", summary: "Dîner", start: { dateTime: iso(a(19, 30)) }, end: { dateTime: iso(a(20, 30)) } }];
  const taches = [
    { id: "t1", name: "Petit mail", dueDate: iso(a(22)), duration: 30 },
    { id: "t2", name: "Gros dossier", dueDate: iso(a(23)), duration: 90 },
  ];
  const j = journee({ taches, evenements, maintenant });
  assert.equal(tempsLibre(j, maintenant), 60);
  const m = menacees({ taches, j, maintenant });
  assert.deepEqual(m.map((x) => [x.id, x.raison]), [["t1", "sans-creneau"], ["t2", "capacite"]]);
  assert.match(m[1].phrase, /il te reste 1 h de libre pour 2 h à faire/);
  assert.equal(m[1].action.type, "repousser");
});

test("le briefing du matin tient en trois lignes déterministes", () => {
  const taches = [
    { id: "t1", name: "Finaliser la démo", dueDate: iso(a(16)), scheduledStart: iso(a(10)), scheduledEnd: iso(a(11, 15)), priority: "HIGH", project: { name: "Boutiques" } },
    { id: "t2", name: "Facture Ondine", dueDate: iso(a(17)) },
  ];
  const evenements = [{ id: "e1", summary: "Podologue", start: { dateTime: iso(a(9)) }, end: { dateTime: iso(a(9, 45)) } }];
  const sujets = [{ id: "x", texte: "Le comptable attend ta réponse depuis quatre jours", etat: "ouvert" }];
  const b = briefingMatin({ taches, evenements, pour: MATIN, maintenant: MATIN, sujets });
  assert.equal(b.compte, "Ce qui compte : « Finaliser la démo », avant 16:00.");
  assert.match(b.pourquoi, /^Pourquoi : priorité importante ; échéance ce jour-là ; projet Boutiques\.$/);
  assert.match(b.menace, /^Menacée : « Facture Ondine » — due aujourd'hui 17:00, aucun créneau prévu\./);
  assert.match(b.resume, /1 rendez-vous · 1 tâche \(1 h 15\) · 1 sans créneau/);
  assert.equal(b.pour, "2026-10-23");
  assert.match(b.titre, /^Ta journée — vendredi 23 octobre$/);
  assert.equal(b.sujets, 1);
  // Même entrée, même sortie.
  assert.deepEqual(briefingMatin({ taches, evenements, pour: MATIN, maintenant: MATIN, sujets }), b);
});

test("le briefing de demain se prépare la veille, et une journée vide le dit", () => {
  const soir = a(21);
  const taches = [{ id: "t1", name: "Relire le contrat", dueDate: iso(a(12, 0, 1)), scheduledStart: iso(a(9, 0, 1)), scheduledEnd: iso(a(9, 45, 1)) }];
  const b = briefingMatin({ taches, pour: soir + 12 * H, maintenant: soir });
  assert.equal(b.pour, "2026-10-24");
  assert.equal(b.compte, "Ce qui compte : « Relire le contrat », avant 12:00.");
  assert.equal(b.menace, "Rien de menacé : la journée tient.");
  const vide = briefingMatin({ pour: MATIN, maintenant: MATIN });
  assert.equal(vide.compte, "Journée libre : aucun rendez-vous ni échéance.");
  assert.equal(vide.resume, "Rien de prévu.");
});

test("le bilan du soir : fait, glissé, et ce qui reste avec son échéance de demain", () => {
  const soir = a(21);
  const taches = [
    { id: "t1", name: "Relire le contrat", dueDate: iso(a(19)), scheduledStart: iso(a(14)), scheduledEnd: iso(a(14, 45)) },
    { id: "t2", name: "Facture Ondine", dueDate: iso(a(17)) },
    { id: "t3", name: "Plus tard", dueDate: iso(a(9, 0, 6)) },
  ];
  const lignes = [
    { ts: a(10), actions: JSON.stringify([{ type: "terminer", nom: "Trier la boîte mail" }]), results: JSON.stringify([{ ok: true }]) },
    { ts: a(11), actions: JSON.stringify([{ type: "terminer", nom: "Annulée" }]), results: "[]", annule: 1 },
    { ts: a(9, 0, -1), actions: JSON.stringify([{ type: "terminer", nom: "Hier" }]), results: "[]" },
    { ts: a(12), actions: JSON.stringify([{ type: "modifier", nom: "Pas une coche" }]), results: "[]" },
  ];
  const faits = faitsDepuis(lignes, a(0));
  assert.deepEqual(faits, ["Trier la boîte mail"]);
  const b = bilanSoir({ taches, faits, maintenant: soir });
  assert.deepEqual(b.fait, ["Trier la boîte mail"]);
  assert.deepEqual(b.glisse.map((g) => g.id), ["t1"]);
  assert.deepEqual(b.reste.map((r) => r.id), ["t1", "t2"]);
  assert.equal(b.reste[0].versDemain, a(19, 0, 1), "même heure, demain");
  assert.equal(b.reste[1].versDemain, a(17, 0, 1));
  assert.equal(b.phrase, "1 fait, 2 restent pour aujourd'hui.");
  const t = texteBilan({ bilan: b, ressenti: "  Fatigué mais   content  " });
  assert.match(t, /Fait : Trier la boîte mail\./);
  assert.match(t, /Comment ça s'est passé : Fatigué mais content$/);
});

test("quand : aujourd'hui, demain, ou le jour en toutes lettres", () => {
  assert.equal(quand(a(17), MATIN), "aujourd'hui 17:00");
  assert.equal(quand(a(10, 0, 1), MATIN), "demain 10:00");
  // Lundi 26 : heure d'hiver (UTC+1) depuis dimanche.
  assert.equal(quand(Date.parse("2026-10-26T09:00:00Z"), MATIN), "lundi 26 à 10:00");
});

test("routes : /api/rituel rend le briefing, le bilan et les menaces ; le bilan se range pour la nuit", async () => {
  process.env.APP_PASSWORD = "mot-de-passe-de-test";
  process.env.SESSION_SECRET = "secret-de-test";
  const { routeApi } = await import("../lib/routes.js");
  const store = await import("../lib/store.js");
  const http = await import("node:http");
  const serveur = http.createServer((req, res) => routeApi(req, res).then((pris) => { if (!pris) { res.statusCode = 404; res.end(); } }));
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  try {
    const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "mot-de-passe-de-test" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const r = await fetch(`${base}/api/rituel`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const j = await r.json();
    for (const k of ["aujourdhui", "demain", "soir", "menacees", "sources"]) assert.ok(k in j, k);
    assert.equal(j.sources.motion, "off");
    assert.match(j.aujourdhui.compte, /Journée libre|Ce qui compte/);
    const v = await (await fetch(`${base}/api/version`, { headers: { cookie } })).json();
    assert.ok(v.capacites.includes("rituel-v1"));
    const p = await fetch(`${base}/api/rituel/bilan`, { method: "POST", headers: { cookie, "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ ressenti: "Bonne journée, un peu dispersé." }) });
    assert.equal(p.status, 200);
    const [c] = await store.listCaptures(1);
    assert.equal(c.source, "bilan");
    assert.match(c.extrait, /Comment ça s'est passé : Bonne journée, un peu dispersé\./);
    const sansSession = await fetch(`${base}/api/rituel`);
    assert.equal(sansSession.status, 401);
  } finally {
    serveur.close();
  }
});
