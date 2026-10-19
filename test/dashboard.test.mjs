// Le tableau de bord : la journée de Sam, lue à SON heure.
//
// Les pièges tenus ici :
//   - Vercel tourne en UTC : « aujourd'hui » doit commencer à minuit à Paris ;
//   - une tâche Motion n'a pas d'heure fixe, un rendez-vous si — les deux se
//     mêlent dans la frise sans se confondre ;
//   - une source illisible ne doit jamais afficher « Invalid Date ».

import test from "node:test";
import assert from "node:assert/strict";
import {
  debutJour, finJour, journee, normTache, normEvenement, resumeCouts, resumeMemoire,
} from "../lib/dashboard.js";

const TZ = "Europe/Paris";
// Mercredi 23 septembre 2026, 10:30 à Paris (UTC+2 en été) = 08:30 UTC.
const MAINTENANT = Date.UTC(2026, 8, 23, 8, 30);
const iso = (h, m = 0, j = 23) => new Date(Date.UTC(2026, 8, j, h - 2, m)).toISOString(); // heure de Paris → ISO

// --- Bornes du jour ---------------------------------------------------------------

test("la journée commence à minuit à Paris, pas à minuit UTC", () => {
  assert.equal(new Date(debutJour(MAINTENANT, TZ)).toISOString(), "2026-09-22T22:00:00.000Z");
  assert.equal(new Date(finJour(MAINTENANT, TZ)).toISOString(), "2026-09-23T22:00:00.000Z");
});

test("à 1 h du matin à Paris, on est déjà le lendemain", () => {
  const uneHeure = Date.UTC(2026, 8, 23, 23, 0); // 01:00 le 24 à Paris
  assert.equal(new Date(debutJour(uneHeure, TZ)).toISOString(), "2026-09-23T22:00:00.000Z");
});

test("le jour du passage à l'heure d'hiver dure 25 heures", () => {
  const dimanche = Date.UTC(2026, 9, 25, 10, 0); // 25 octobre 2026
  assert.equal(finJour(dimanche, TZ) - debutJour(dimanche, TZ), 25 * 3600_000);
});

// --- Normalisation ------------------------------------------------------------------

test("une tâche terminée ou sans identifiant n'entre pas", () => {
  assert.equal(normTache({ id: "a", name: "x", completed: true }), null);
  assert.equal(normTache({ id: "a", name: "x", status: { name: "Completed" } }), null);
  assert.equal(normTache({ name: "x" }), null);
  assert.equal(normTache(null), null);
});

test("une date illisible devient null, jamais NaN", () => {
  const t = normTache({ id: "a", name: "x", dueDate: "pas une date", scheduledStart: "" });
  assert.equal(t.echeance, null);
  assert.equal(t.debut, null);
});

test("un rendez-vous annulé ou sans date est écarté", () => {
  assert.equal(normEvenement({ id: "e", status: "cancelled", start: { dateTime: iso(9) } }), null);
  assert.equal(normEvenement({ id: "e", start: {} }), null);
});

// --- La frise -------------------------------------------------------------------------

const RDV = [
  { id: "r1", summary: "Podologue", start: { dateTime: iso(9) }, end: { dateTime: iso(9, 45) }, location: "Paris 11e" },
  { id: "r2", summary: "Déjeuner Léa", start: { dateTime: iso(12, 30) }, end: { dateTime: iso(14) } },
  { id: "r3", summary: "Congés Léa", start: { date: "2026-09-22" }, end: { date: "2026-09-25" } },
  { id: "r4", summary: "Demain", start: { dateTime: iso(9, 0, 24) }, end: { dateTime: iso(10, 0, 24) } },
];
const TACHES = [
  { id: "t1", name: "Démo de la boutique", scheduledStart: iso(10, 15), scheduledEnd: iso(11), dueDate: iso(18), priority: "HIGH", duration: 75 },
  { id: "t2", name: "Relancer le comptable", dueDate: iso(18, 0, 20) },
  { id: "t3", name: "Préparer la facture", dueDate: iso(17) },
  { id: "t4", name: "Plus tard", dueDate: iso(9, 0, 30) },
  { id: "t5", name: "Fini", completed: true, scheduledStart: iso(8) },
];

test("rendez-vous et tâches placées se mêlent dans l'ordre du temps", () => {
  const j = journee({ taches: TACHES, evenements: RDV, maintenant: MAINTENANT, tz: TZ });
  assert.deepEqual(j.items.map((i) => i.id), ["r1", "t1", "r2"]);
  assert.deepEqual(j.items.map((i) => i.type), ["rdv", "tache", "rdv"]);
});

test("une tâche placée dit la durée que Motion lui attribue (« 50 min sur 1 h 15 »)", () => {
  const j = journee({ taches: TACHES, evenements: RDV, maintenant: MAINTENANT, tz: TZ });
  const t1 = j.items.find((i) => i.id === "t1");
  assert.equal(t1.duree, 75);
  assert.equal(t1.echeance, Date.parse(iso(18)));
  assert.equal(j.items.find((i) => i.id === "r1").duree, undefined, "un rendez-vous n'a pas de durée Motion");
});

test("chaque élément sait s'il est passé, en cours ou à venir", () => {
  const j = journee({ taches: TACHES, evenements: RDV, maintenant: MAINTENANT, tz: TZ });
  assert.deepEqual(j.items.map((i) => i.etat), ["passe", "encours", "avenir"]);
  assert.equal(j.prochain.titre, "Démo de la boutique", "le prochain est celui en cours");
});

test("les minutes de la frise sont à l'heure de Paris", () => {
  const j = journee({ taches: TACHES, evenements: RDV, maintenant: MAINTENANT, tz: TZ });
  assert.equal(j.items[0].min, 9 * 60);
  assert.equal(j.items[0].minFin, 9 * 60 + 45);
  assert.equal(j.minute, 10 * 60 + 30);
  assert.equal(j.jour, "2026-09-23");
});

test("un congé sur plusieurs jours apparaît en « toute la journée »", () => {
  const j = journee({ taches: [], evenements: RDV, maintenant: MAINTENANT, tz: TZ });
  assert.deepEqual(j.toute.map((t) => t.titre), ["Congés Léa"]);
  assert.ok(!j.items.some((i) => i.id === "r3"));
});

test("le rendez-vous de demain n'est pas dans la frise d'aujourd'hui", () => {
  const j = journee({ taches: [], evenements: RDV, maintenant: MAINTENANT, tz: TZ });
  assert.ok(!j.items.some((i) => i.id === "r4"));
});

test("une tâche due aujourd'hui mais pas encore placée va dans « à faire »", () => {
  const j = journee({ taches: TACHES, evenements: [], maintenant: MAINTENANT, tz: TZ });
  assert.deepEqual(j.aFaire.map((t) => t.id), ["t3"]);
});

test("le retard est compté en entier, et les plus anciens d'abord", () => {
  const vieux = Array.from({ length: 9 }, (_, i) => ({ id: "v" + i, name: "vieux " + i, dueDate: iso(9, 0, 10 + i) }));
  const j = journee({ taches: [...TACHES, ...vieux], evenements: [], maintenant: MAINTENANT, tz: TZ });
  assert.equal(j.retard.total, 10, "9 vieilles + le comptable");
  assert.equal(j.retard.items.length, 6, "l'écran n'en montre que 6");
  assert.equal(j.retard.items[0].id, "v0");
});

test("une heure de grâce : due à 10 h, pas en retard à 10 h 30", () => {
  const j = journee({ taches: [{ id: "g", name: "g", dueDate: iso(10) }], evenements: [], maintenant: MAINTENANT, tz: TZ });
  assert.equal(j.retard.total, 0);
  assert.deepEqual(j.aFaire.map((t) => t.id), ["g"]);
});

test("rien du tout ne fait pas planter, et dit qu'il n'y a pas de prochain", () => {
  const j = journee({ maintenant: MAINTENANT, tz: TZ });
  assert.deepEqual(j.items, []);
  assert.equal(j.prochain, null);
  assert.equal(j.retard.total, 0);
});

test("une source qui rend n'importe quoi ne casse pas la frise", () => {
  const j = journee({ taches: [null, 42, "x", {}], evenements: [null, { start: { dateTime: "zzz" } }], maintenant: MAINTENANT, tz: TZ });
  assert.deepEqual(j.items, []);
});

// --- Coûts ------------------------------------------------------------------------------

test("les coûts « aujourd'hui » partent de minuit à Paris", () => {
  const entrees = [
    { ts: Date.UTC(2026, 8, 22, 22, 30), usd: 0.1 }, // 00:30 le 23 à Paris → aujourd'hui
    { ts: Date.UTC(2026, 8, 22, 21, 30), usd: 0.2 }, // 23:30 le 22 à Paris → hier
    { ts: MAINTENANT - 20 * 86_400_000, usd: 1 },
    { ts: MAINTENANT - 40 * 86_400_000, usd: 5 },
  ];
  const c = resumeCouts(entrees, MAINTENANT, TZ);
  assert.equal(c.aujourdhui, 0.1);
  assert.equal(c.appelsAujourdhui, 1);
  assert.equal(c.jours7, 0.3);
  assert.equal(c.jours30, 1.3);
});

test("un journal vide ou corrompu donne des zéros", () => {
  assert.deepEqual(resumeCouts(null, MAINTENANT), { aujourdhui: 0, jours7: 0, jours30: 0, appelsAujourdhui: 0 });
  assert.equal(resumeCouts([{ usd: "abc" }, null], MAINTENANT).jours30, 0);
});

// --- Mémoire ----------------------------------------------------------------------------

test("la mémoire se résume en mots et sections remplies, sans son contenu", () => {
  const m = resumeMemoire("## Identité & contexte\nSam monte une boîte.\n\n## Objectifs\n\n## Personnes\n- Léa, sa compagne");
  assert.equal(m.sections, 2, "Objectifs est vide");
  assert.equal(m.totalSections, 7);
  assert.ok(m.mots > 5);
  assert.ok(!("texte" in m) && !("text" in m));
});

test("une mémoire vide vaut zéro", () => {
  assert.deepEqual(resumeMemoire(""), { mots: 0, sections: 0, totalSections: 7 });
  assert.deepEqual(resumeMemoire(null), { mots: 0, sections: 0, totalSections: 7 });
});
