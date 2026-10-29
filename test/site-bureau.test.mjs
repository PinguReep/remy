// Le pont du site avec l'app Windows (public/app/bureau.js) : ce que le site
// décide de notifier, sans IA, à partir de /api/rappels et /api/rituel. Une
// notification par rappel dû, une seule fois ; ceux d'une longue absence
// regroupés ; briefing et bilan coupés par défaut, à l'heure choisie. Et les
// choix de « Décaler » (gerer.js), portés d'Ergonomie.swift.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import { rappelsADire, rituelDu, texteRituel, cleRappel, REGLAGES_PAR_DEFAUT, DEUX_HEURES, OUBLI, estBureau } from "../public/app/bureau.js";
import { choixTache, choixActivite, arrondi, joursJusquaLundi, echeanceDans } from "../public/app/vues/gerer.js";
import { indexProjet } from "../public/app/couleurs.js";

const M = 60e3;
const H = 3600e3;
const maintenant = new Date(2026, 9, 15, 10, 40).getTime(); // jeudi 15 octobre 2026, 10:40

test("hors de l'app, le pont est absent", () => {
  assert.equal(estBureau(), false);
});

test("un rappel dû est notifié une fois, avec sa clé", () => {
  const rappels = [
    { id: "r1", texte: "Appeler le garage", quand: maintenant - 5 * M },
    { id: "r2", texte: "Plus tard", quand: maintenant + H },
    { id: "r3", texte: "Déjà fait", quand: maintenant - 10 * M, fait: true },
    { id: "r4", texte: "Sans date" },
  ];
  const a = rappelsADire(rappels, { maintenant });
  assert.equal(a.notifications.length, 1);
  assert.equal(a.notifications[0].titre, "Appeler le garage");
  assert.equal(a.notifications[0].cle, `rappel:r1@${maintenant - 5 * M}`);
  assert.deepEqual(a.cles, [cleRappel(rappels[0])]);
  // Deuxième passage : déjà dit, rien de plus.
  const b = rappelsADire(rappels, { maintenant: maintenant + M, deja: new Set(a.cles) });
  assert.equal(b.notifications.length, 0);
  // Reporté (nouveau « quand ») : c'est un nouveau rappel dû, notifié à son heure.
  const reporte = [{ ...rappels[0], quand: maintenant + 30 * M }];
  assert.equal(rappelsADire(reporte, { maintenant: maintenant + 31 * M, deja: new Set(a.cles) }).notifications.length, 1);
});

test("une longue absence : les rappels passés depuis plus de 2 h sont regroupés", () => {
  const rappels = [
    { id: "a", texte: "Payer le loyer", quand: maintenant - 5 * H },
    { id: "b", texte: "Rendre le livre", quand: maintenant - 3 * H },
    { id: "c", texte: "Arroser", quand: maintenant - 26 * H },
    { id: "d", texte: "Appeler Hugo", quand: maintenant - 10 * M },
  ];
  const a = rappelsADire(rappels, { maintenant });
  assert.equal(a.notifications.length, 2, "un groupe + le rappel récent");
  assert.equal(a.notifications[0].titre, "3 rappels passés pendant ton absence");
  assert.match(a.notifications[0].corps, /Arroser · Payer le loyer · Rendre le livre/);
  assert.equal(a.notifications[1].titre, "Appeler Hugo");
  assert.equal(a.cles.length, 4, "tous marqués dits");
  // Un seul ancien : sa propre notification, qui dit qu'il est passé.
  const seul = rappelsADire([{ id: "x", texte: "Payer le loyer", quand: maintenant - 3 * H }], { maintenant });
  assert.equal(seul.notifications.length, 1);
  assert.match(seul.notifications[0].corps, /pendant ton absence/);
});

test("pas plus de trois notifications d'un coup ; plus vieux que 3 jours : rien", () => {
  const rappels = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, texte: `Rappel ${i}`, quand: maintenant - (i + 1) * M }));
  const a = rappelsADire(rappels, { maintenant });
  assert.equal(a.notifications.length, 4, "trois seuls + un groupe");
  assert.match(a.notifications[0].titre, /^3 rappels/);
  assert.equal(rappelsADire([{ id: "v", texte: "Vieux", quand: maintenant - OUBLI - M }], { maintenant }).notifications.length, 0);
  assert.ok(DEUX_HEURES === 2 * H);
});

test("des textes bornés pour Windows (titre 80, corps 240)", () => {
  const long = "x".repeat(300);
  const a = rappelsADire([{ id: "l", texte: long, quand: maintenant - M }], { maintenant });
  assert.equal(a.notifications[0].titre.length, 80);
  const g = rappelsADire(Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, texte: long, quand: maintenant - 3 * H - i * M })), { maintenant });
  assert.ok(g.notifications[0].corps.length <= 240);
});

test("briefing et bilan : coupés par défaut, à l'heure choisie, une fois par jour", () => {
  assert.equal(REGLAGES_PAR_DEFAUT.rappels, true);
  assert.equal(REGLAGES_PAR_DEFAUT.briefing, false);
  assert.equal(REGLAGES_PAR_DEFAUT.bilan, false);
  const a = (h, m) => new Date(2026, 9, 15, h, m).getTime();
  assert.equal(rituelDu(REGLAGES_PAR_DEFAUT, { maintenant: a(7, 31) }), null, "coupé : jamais");
  const r = { ...REGLAGES_PAR_DEFAUT, briefing: true, bilan: true };
  assert.equal(rituelDu(r, { maintenant: a(7, 29) }), null, "pas avant l'heure");
  assert.deepEqual(rituelDu(r, { maintenant: a(7, 30) }), { nom: "briefing", cle: "briefing@2026-10-15" });
  assert.deepEqual(rituelDu(r, { maintenant: a(10, 0) }), { nom: "briefing", cle: "briefing@2026-10-15" }, "PC allumé à 10 h : encore utile");
  assert.equal(rituelDu(r, { maintenant: a(11, 31) }), null, "plus de 4 h après : trop tard");
  assert.equal(rituelDu(r, { maintenant: a(8, 0), deja: new Set(["briefing@2026-10-15"]) }), null, "une fois par jour");
  assert.deepEqual(rituelDu(r, { maintenant: a(21, 45) }), { nom: "bilan", cle: "bilan@2026-10-15" });
  assert.deepEqual(rituelDu({ ...r, heureBilan: "18:00" }, { maintenant: a(18, 5) }), { nom: "bilan", cle: "bilan@2026-10-15" });
});

test("le texte des rituels vient de /api/rituel", () => {
  const rituel = {
    aujourdhui: { compte: "Ce qui compte : « Finaliser la démo », avant 12:00.", resume: "2 rendez-vous · 3 tâches (2 h)" },
    soir: { phrase: "2 faits, 1 reste pour aujourd'hui." },
  };
  assert.deepEqual(texteRituel("briefing", rituel), { titre: "Briefing du matin", corps: "Ce qui compte : « Finaliser la démo », avant 12:00. 2 rendez-vous · 3 tâches (2 h)" });
  assert.equal(texteRituel("bilan", rituel).titre, "Bilan du soir");
  assert.match(texteRituel("bilan", rituel).corps, /^2 faits, 1 reste/);
  assert.match(texteRituel("briefing", {}).corps, /Ta journée/, "sans données : une phrase quand même");
});

test("Décaler une tâche : les choix de l'iPhone (Ergonomie.swift)", () => {
  const jeudi = new Date(2026, 9, 15, 10, 40);
  const ids = (l) => l.map((c) => c.id);
  assert.deepEqual(ids(choixTache(null, jeudi)), ["demain", "lundi"]);
  assert.deepEqual(choixTache(null, jeudi)[0].date, new Date(2026, 9, 16, 23, 0));
  assert.deepEqual(choixTache(null, jeudi)[1].date, new Date(2026, 9, 19, 23, 0));
  // En retard : « Aujourd'hui » d'abord.
  assert.deepEqual(ids(choixTache(jeudi.getTime() - 86400e3, jeudi)), ["aujourdhui", "demain", "lundi"]);
  // Un dimanche, lundi est demain : « Dans 1 sem. ».
  assert.deepEqual(ids(choixTache(null, new Date(2026, 9, 18, 10))), ["demain", "semaine"]);
  // Décaler ne rapproche jamais : échéance dans dix jours → +1 sem.
  const loin = new Date(2026, 9, 25, 23).getTime();
  assert.deepEqual(ids(choixTache(loin, jeudi)), ["plus-7"]);
  assert.deepEqual(choixTache(loin, jeudi)[0].date, new Date(2026, 10, 1, 23, 0));
  assert.equal(joursJusquaLundi(new Date(2026, 9, 19)), 7, "on est lundi : le suivant");
  assert.deepEqual(echeanceDans(0, jeudi), new Date(2026, 9, 15, 23, 0));
});

test("Décaler une activité : au quart d'heure supérieur, ce soir, demain", () => {
  const m = new Date(2026, 9, 15, 10, 40);
  const e = { type: "rdv", debut: new Date(2026, 9, 15, 11, 0).getTime(), fin: new Date(2026, 9, 15, 11, 30).getTime() };
  const c = choixActivite(e, m);
  assert.deepEqual(c.map((x) => x.id), ["plus-15", "plus-60", "ce-soir", "demain"]);
  assert.deepEqual(c[0].date, new Date(2026, 9, 15, 11, 15));
  assert.deepEqual(c[1].date, new Date(2026, 9, 15, 12, 0));
  assert.deepEqual(c[3].date, new Date(2026, 9, 16, 11, 0));
  assert.deepEqual(arrondi(new Date(2026, 9, 15, 15, 7, 30)), new Date(2026, 9, 15, 15, 15));
  assert.deepEqual(arrondi(new Date(2026, 9, 15, 15, 15)), new Date(2026, 9, 15, 15, 15));
  // Déjà commencée : à partir de maintenant ; 18 h passées, plus de « ce soir ».
  const tard = new Date(2026, 9, 15, 18, 20);
  assert.deepEqual(choixActivite({ type: "rdv", debut: new Date(2026, 9, 15, 18, 0).getTime() }, tard).map((x) => x.id), ["plus-15", "plus-60", "demain"]);
});

test("couleur de projet : stable, six teintes, la même pour la même casse", () => {
  const i = indexProjet("Boutiques");
  assert.ok(i >= 0 && i < 6);
  assert.equal(indexProjet("boutiques"), i, "insensible à la casse, comme l'iPhone");
  assert.equal(indexProjet(""), -1);
  const vus = new Set(["Boutiques", "Voyage à Porto", "Album « Été »", "Maison", "Site vitrine", "Démo client", "Travaux cuisine", "Idées"].map(indexProjet));
  assert.ok(vus.size >= 3, "le brassage répartit les noms");
});
