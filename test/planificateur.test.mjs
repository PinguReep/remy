// Le planificateur « fantôme » (lib/planificateur.js) : module pur, sans
// entrée/sortie ni horloge implicite. Ce qui est garanti ici :
//   - le temps libre : horaires de travail à l'heure de Sam (changements
//     d'heure compris), moins l'agenda, sur une grille de 5 min ;
//   - les règles dans l'ordre (attend, pas avant, échéance ferme, ASAP,
//     priorités confirmées, échéance, priorité Motion, ne pas bouger), et pour
//     chaque placement une raison en mots de tous les jours ;
//   - une échéance ferme tenue dès que c'est possible (elle passe devant), et
//     dite quand elle ne peut pas l'être ;
//   - la stabilité : un petit changement ne rebat pas le planning ;
//   - le résultat ne dépend ni de la machine, ni de son fuseau, ni de l'ordre
//     des tâches en entrée ;
//   - la comparaison avec Motion : tâche bloquée placée quand même, échéance
//     ferme tenue par l'un et pas par l'autre, ordre inverse avec sa raison.
// Données fictives (Sam, la boutique de bougies, la musique).

import test from "node:test";
import assert from "node:assert/strict";

const P = await import("../lib/planificateur.js");
const { planifier, comparer, depuisMotion, tempsLibre, auPlusTot, tenables, quand, dureeDite, HORAIRES_DEFAUT } = P;

const TZ = "Europe/Paris";
const M = 60_000;
const H = 60 * M;
// Lundi 16 novembre 2026, 09:00 à Paris (UTC+1).
const a = (jour, h, m = 0) => Date.UTC(2026, 10, 16 + jour, h - 1, m);
const LUNDI_9H = a(0, 9);
const SEMAINE = HORAIRES_DEFAUT;
const PRIOS = [{ titre: "La musique", projetId: "p4" }, { titre: "Lancer la boutique de bougies", projetId: "p1" }];

const plan = (taches, extra = {}) => planifier({ maintenant: LUNDI_9H, tz: TZ, taches, horaires: SEMAINE, ...extra });
const place = (r, id) => r.placements.find((p) => p.id === id);
const nonPlace = (r, id) => r.nonPlaces.find((p) => p.id === id);
const avant = (r, x, y) => place(r, x).debut < place(r, y).debut;
const heurePar = (ms) => new Date(ms).toISOString().slice(11, 16);
const creneau = (r, id) => JSON.stringify(place(r, id)?.morceaux?.map((m) => [heurePar(m.debut), heurePar(m.fin)]));

// --- Le temps libre ---------------------------------------------------------------------

test("le temps libre : les horaires de chaque jour, moins l'agenda, sur la grille de 5 min", () => {
  const libres = tempsLibre({ debut: a(0, 9, 2), fin: a(1, 0), horaires: SEMAINE, occupe: [{ debut: a(0, 10), fin: a(0, 10, 40) }, { debut: a(0, 12, 30), fin: a(0, 13, 45) }], tz: TZ });
  assert.deepEqual(libres, [[a(0, 9, 5), a(0, 10)], [a(0, 10, 40), a(0, 12, 30)], [a(0, 13, 45), a(0, 18)]]);
  // « 23:59 » va jusqu'à minuit ; un jour sans plage n'a rien.
  const tard = tempsLibre({ debut: a(5, 0), fin: a(7, 0), horaires: { saturday: [{ start: "20:00", end: "23:59" }] }, tz: TZ });
  assert.deepEqual(tard, [[a(5, 20), a(6, 0)]]);
  // Des plages illisibles sont ignorées, sans erreur.
  assert.deepEqual(tempsLibre({ debut: a(0, 0), fin: a(1, 0), horaires: { monday: [{ start: "9h", end: "18:00" }, { start: "12:00", end: "11:00" }, null] }, tz: TZ }), []);
});

test("le temps libre suit les changements d'heure (heure de Paris, quel que soit le fuseau de la machine)", () => {
  // Dimanche 25 octobre 2026 : on recule d'une heure. 9 h à Paris = 8 h UTC le vendredi, 8 h UTC… le lundi aussi (UTC+1).
  const v = tempsLibre({ debut: Date.UTC(2026, 9, 23, 0), fin: Date.UTC(2026, 9, 27, 0), horaires: SEMAINE, tz: TZ });
  assert.deepEqual(v.map(([x, y]) => [new Date(x).toISOString(), new Date(y).toISOString()]), [
    ["2026-10-23T07:00:00.000Z", "2026-10-23T16:00:00.000Z"], // vendredi, UTC+2
    ["2026-10-26T08:00:00.000Z", "2026-10-26T17:00:00.000Z"], // lundi, UTC+1
  ]);
  // Dimanche 29 mars 2026 : on avance d'une heure.
  const p = tempsLibre({ debut: Date.UTC(2026, 2, 27, 0), fin: Date.UTC(2026, 2, 31, 0), horaires: SEMAINE, tz: TZ });
  assert.equal(new Date(p[0][0]).toISOString(), "2026-03-27T08:00:00.000Z", "vendredi, UTC+1");
  assert.equal(new Date(p[1][0]).toISOString(), "2026-03-30T07:00:00.000Z", "lundi, UTC+2");
  // Un autre fuseau, d'autres heures absolues.
  const ny = tempsLibre({ debut: a(0, 0), fin: a(1, 6), horaires: SEMAINE, tz: "America/New_York" });
  assert.equal(new Date(ny[0][0]).toISOString(), "2026-11-16T14:00:00.000Z");
});

test("au plus tôt : d'un bloc jusqu'à une heure ; au-delà, en morceaux d'au moins 30 min, jamais un reste trop court", () => {
  const libres = [[a(0, 9), a(0, 9, 40)], [a(0, 10), a(0, 11, 20)], [a(0, 14), a(0, 18)]];
  assert.deepEqual(auPlusTot(libres, 45 * M, a(0, 9)), [[a(0, 10), a(0, 10, 45)]], "45 min : le premier trou assez grand");
  assert.deepEqual(auPlusTot(libres, 60 * M, a(0, 10, 30)), [[a(0, 14), a(0, 15)]], "après `des`");
  // 2 h : 40 min, puis 1 h 20 → mais il ne doit pas rester moins de 30 min.
  assert.deepEqual(auPlusTot(libres, 120 * M, a(0, 9)), [[a(0, 9), a(0, 9, 40)], [a(0, 10), a(0, 11, 20)]]);
  // 1 h 40 : 40 + 60 (et pas 40 + 1 h 20 qui déborderait, ni un reste de 20 min).
  assert.deepEqual(auPlusTot(libres, 100 * M, a(0, 9)), [[a(0, 9), a(0, 9, 40)], [a(0, 10), a(0, 11)]]);
  // 1 h 10 avec des trous de 40 et 80 min : 40 puis 30 (pas un reste de 10 min).
  assert.deepEqual(auPlusTot([[a(0, 9), a(0, 9, 40)], [a(0, 10), a(0, 10, 50)]], 70 * M, a(0, 9)), [[a(0, 9), a(0, 9, 40)], [a(0, 10), a(0, 10, 30)]]);
  assert.equal(auPlusTot(libres, 9 * H, a(0, 9)), null, "ne rentre pas");
});

test("la vérification des échéances fermes : la plus proche d'abord, après ce qu'elle attend", () => {
  const libres = [[a(0, 9), a(0, 12)], [a(0, 14), a(0, 18)]];
  const g = (id, h, e, apres = [], des = a(0, 9)) => ({ id, duree: h * H, des, echeance: e, apres });
  assert.equal(tenables(libres, [g("x", 2, a(0, 12)), g("y", 1, a(0, 15))]).ok, true);
  const v = tenables(libres, [g("x", 2, a(0, 11)), g("y", 2, a(0, 12))]);
  assert.equal(v.ok, false);
  assert.equal(v.id, "y");
  assert.equal(v.manque, 60 * M, "il manque une heure de travail (finie à 15 h au lieu de midi, la pause ne compte pas)");
  // y attend x : même avec une échéance plus proche, elle passe après.
  assert.equal(tenables(libres, [g("x", 2, a(0, 17)), g("y", 1, a(0, 12), ["x"])]).ok, true);
  assert.equal(tenables(libres, [g("x", 3, a(0, 17)), g("y", 1, a(0, 12), ["x"])]).ok, false);
  // Pas encore possible avant `des`.
  assert.equal(tenables(libres, [g("x", 1, a(0, 15), [], a(0, 14, 30))]).ok, false);
  assert.equal(tenables([], [g("x", 1, a(0, 15))]).ok, false, "aucun temps libre");
  assert.equal(tenables(libres, []).ok, true);
});

// --- Les règles, dans l'ordre -----------------------------------------------------------

test("R4 ASAP d'abord, R5 les priorités confirmées dans l'ordre, R7 la priorité Motion ensuite", () => {
  const r = plan([
    { id: "mail", titre: "Trier la boîte mail", duree: 30, priorite: "HIGH" },
    { id: "meches", titre: "Commander les mèches en coton", duree: 30, projetId: "p1", priorite: "LOW" },
    { id: "morceau", titre: "Répéter le morceau", duree: 45, projetId: "p4", priorite: "MEDIUM" },
    { id: "compta", titre: "Relancer le comptable", duree: 15, priorite: "ASAP" },
    { id: "factures", titre: "Trier les factures", duree: 30, priorite: "LOW" },
    { id: "photos", titre: "Retoucher les photos", duree: 30, priorite: "MEDIUM" },
  ], { priorites: PRIOS });
  assert.deepEqual(r.placements.map((p) => p.id), ["compta", "morceau", "meches", "mail", "photos", "factures"]);
  assert.equal(place(r, "compta").raison, "Marquée ASAP dans Motion : au plus tôt.");
  assert.equal(place(r, "morceau").raison, "Sert ta priorité n°1 (« La musique »).");
  assert.equal(place(r, "meches").raison, "Sert ta priorité n°2 (« Lancer la boutique de bougies »).");
  assert.equal(place(r, "mail").raison, "Priorité haute dans Motion.");
  assert.equal(place(r, "compta").regle, "asap");
  assert.equal(place(r, "morceau").regle, "priorite");
  // Au plus tôt, les uns derrière les autres.
  assert.equal(place(r, "compta").debut, a(0, 9));
  assert.equal(place(r, "morceau").debut, a(0, 9, 15));
});

test("R6 une échéance dans les 48 h passe avant les priorités ; plus loin, après elles", () => {
  const r = plan([
    { id: "morceau", titre: "Répéter le morceau", duree: 60, projetId: "p4" },
    { id: "banque", titre: "Envoyer le dossier à la banque", duree: 60, echeance: a(1, 12) },
    { id: "tva", titre: "Faire la déclaration de TVA", duree: 60, echeance: a(5, 23) },
    { id: "retard", titre: "Envoyer le devis tennis", duree: 30, echeance: a(-2, 12) },
  ], { priorites: PRIOS });
  assert.deepEqual(r.placements.map((p) => p.id), ["retard", "banque", "morceau", "tva"]);
  assert.match(place(r, "retard").raison, /^En retard depuis sam\. 14 à 12:00 : à rattraper d'abord\.$/);
  assert.equal(place(r, "banque").raison, "Due demain à 12:00 : dans moins de 48 h, elle passe devant.");
  assert.equal(place(r, "tva").raison, "Échéance sam. 21 à 23:00.");
  assert.equal(place(r, "retard").tenue, false);
  assert.match(place(r, "retard").alerte, /après son échéance/);
});

test("R1 une tâche bloquée passe après ce qu'elle attend, même plus prioritaire ; la bloquante dit pourquoi elle passe devant", () => {
  const r = plan([
    { id: "carrossier", titre: "Porter la voiture chez le carrossier", duree: 60, priorite: "ASAP", bloqueePar: [{ id: "garage", nom: "Garage" }] },
    { id: "mail", titre: "Trier la boîte mail", duree: 30, priorite: "HIGH" },
    { id: "garage", titre: "Faire réparer la voiture au garage", duree: 90, priorite: "LOW" },
  ]);
  assert.ok(avant(r, "garage", "carrossier"));
  assert.ok(place(r, "carrossier").debut >= place(r, "garage").fin);
  assert.equal(place(r, "carrossier").raison, "Après « Faire réparer la voiture au garage » : elle l'attend.");
  assert.equal(place(r, "garage").raison, "Avant « Porter la voiture chez le carrossier », qui l'attend.");
  assert.equal(place(r, "garage").regle, "attend");
  assert.ok(avant(r, "carrossier", "mail"), "l'ASAP passe quand même dès que possible");
});

test("R1 bloquée par un projet : après toutes ses tâches ouvertes", () => {
  const r = plan([
    { id: "vitrine", titre: "Installer la vitrine", duree: 60, priorite: "ASAP", bloqueePar: [{ id: "p1", nom: "Boutiques", type: "projet" }] },
    { id: "b1", titre: "Commander les mèches", duree: 30, projetId: "p1" },
    { id: "b2", titre: "Écrire la fiche produit", duree: 60, projetId: "p1", echeance: a(4, 18) },
    { id: "autre", titre: "Trier les factures", duree: 30 },
  ]);
  assert.ok(place(r, "vitrine").debut >= Math.max(place(r, "b1").fin, place(r, "b2").fin));
  assert.match(place(r, "vitrine").raison, /^Après « .+ » et 1 autre : elle les attend\.$/);
});

test("R1 ce qu'elle attend ne peut pas être placé : elle non plus, et c'est dit", () => {
  const r = plan([
    { id: "t1", titre: "Envoyer la facture", duree: 30, bloqueePar: [{ id: "t2", nom: "Bon de commande" }] },
    { id: "t2", titre: "Recevoir le bon de commande" },
    { id: "t3", titre: "Relancer", duree: 20, bloqueePar: [{ id: "t1" }] },
  ]);
  assert.equal(nonPlace(r, "t2").genre, "sans-duree");
  assert.equal(nonPlace(r, "t1").genre, "attend");
  assert.equal(nonPlace(r, "t1").raison, "Elle attend « Recevoir le bon de commande », que Rémy ne peut pas placer.");
  assert.equal(nonPlace(r, "t3").genre, "attend", "de proche en proche");
  // Une tâche attendue qui n'est plus dans la liste (finie ailleurs) ne retient plus rien.
  const r2 = plan([{ id: "x", titre: "Après le garage", duree: 30, bloqueePar: [{ id: "disparue" }] }]);
  assert.equal(place(r2, "x").debut, a(0, 9));
});

test("R2 la date « pas avant » est respectée", () => {
  const r = plan([
    { id: "musique", titre: "Répéter le morceau pour samedi", duree: 45, pasAvant: "2026-11-19", priorite: "ASAP" },
    { id: "mail", titre: "Trier la boîte mail", duree: 30 },
  ]);
  assert.equal(place(r, "musique").debut, a(3, 9), "jeudi à l'ouverture");
  assert.equal(place(r, "musique").raison, "Pas avant jeu. 19 : la date « pas avant » de Motion.");
  assert.equal(place(r, "mail").debut, a(0, 9));
});

test("R3 une échéance ferme qui ne tiendrait plus passe devant les priorités, et le dit", () => {
  const taches = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, titre: `Boutique ${i}`, duree: 180, projetId: "p1" })),
    { id: "banque", titre: "Envoyer le dossier à la banque", duree: 240, echeance: a(2, 12), echeanceType: "ferme", priorite: "LOW" },
  ];
  const r = plan(taches, { priorites: PRIOS });
  const banque = place(r, "banque");
  assert.ok(banque.fin <= a(2, 12), "tenue");
  assert.equal(banque.tenue, true);
  assert.equal(banque.regle, "ferme");
  assert.match(banque.raison, /^Avant « Boutique 5 » : son échéance est ferme \(mer\. 18 à 12:00\), et elle ne tiendrait plus après\.$/);
  // Sans la garde, la priorité n°2 remplirait lundi et mardi : l'échéance serait ratée.
  const souple = plan(taches.map((t) => (t.id === "banque" ? { ...t, echeanceType: "souple" } : t)), { priorites: PRIOS });
  assert.equal(place(souple, "banque").tenue, false, "une échéance souple, elle, n'est pas protégée ainsi");
  assert.ok(r.promues.banque.includes("b5"));
});

test("R3 RÉGRESSION : la vérification ne compte pas un trou trop court pour une tâche qui ne se coupe pas", () => {
  // 35 min libres ce soir, puis 2 h 30 demain matin. La banque (1 h, ferme demain midi) ne
  // tient pas dans 35 min : avant, la vérification la croyait coupable et la laissait filer.
  const occupe = [{ debut: a(0, 9), fin: a(0, 17, 25) }, { debut: a(1, 11, 30), fin: a(1, 13) }];
  const r = plan([
    { id: "visuels", titre: "Envoyer les visuels à l'imprimeur", duree: 60, echeance: a(0, 19) },
    { id: "dossier", titre: "Préparer le dossier de subvention", duree: 45, echeance: a(0, 19) },
    { id: "banque", titre: "Envoyer le dossier à la banque", duree: 60, echeance: a(1, 12), echeanceType: "ferme" },
  ], { occupe });
  assert.equal(place(r, "banque").tenue, true, creneau(r, "banque"));
  assert.ok(place(r, "banque").fin <= a(1, 12));
  assert.match(place(r, "banque").raison, /^Avant « .+ » : son échéance est ferme \(demain à 12:00\)/);
});

test("R3 une échéance ferme impossible dans les horaires : placée au plus tôt, et le manque est dit", () => {
  const r = plan([
    { id: "dossier", titre: "Dossier de subvention", duree: 600, echeance: a(0, 18), echeanceType: "ferme" },
    { id: "mail", titre: "Trier la boîte mail", duree: 30, priorite: "HIGH" },
  ]);
  const d = place(r, "dossier");
  assert.equal(d.debut, a(0, 9));
  assert.equal(d.tenue, false);
  assert.match(d.raison, /^Échéance ferme aujourd'hui à 18:00 : même au plus tôt, elle ne tient pas dans tes horaires \(il manque 1 h\)\.$/);
  assert.ok(avant(r, "dossier", "mail"));
});

test("ce qui ne se place pas : sans durée, en attente, un rappel, trop long pour l'horizon", () => {
  const r = plan([
    { id: "a", titre: "Préparer la facture Ondine" },
    { id: "b", titre: "Relancer Hugo", duree: 30, enAttente: "J'attends le bon de commande d'Ondine" },
    { id: "c", titre: "Appeler le garage", duree: 5, rappel: true },
    { id: "d", titre: "Tout refaire", duree: 200 * 60 },
    { id: "e", titre: "Trier", duree: 30 },
  ]);
  assert.deepEqual(r.nonPlaces.map((x) => [x.id, x.genre]), [["a", "sans-duree"], ["b", "attente"], ["c", "rappel"], ["d", "ne-rentre-pas"]]);
  assert.equal(nonPlace(r, "b").raison, "Tu l'as mise en attente : « J'attends le bon de commande d'Ondine ».");
  assert.equal(nonPlace(r, "d").raison, "Elle ne rentre pas dans tes horaires des 14 jours qui viennent.");
  assert.ok(place(r, "e"));
});

test("aucun placement ne chevauche l'agenda, un autre placement, ni ne sort des horaires ; chaque durée est complète", () => {
  const occupe = [{ debut: a(0, 10), fin: a(0, 11) }, { debut: a(0, 12, 30), fin: a(0, 13, 45) }, { debut: a(1, 8), fin: a(1, 9, 45) }, { debut: a(2, 9), fin: a(2, 18) }];
  const taches = Array.from({ length: 30 }, (_, i) => ({ id: `t${String(i).padStart(2, "0")}`, titre: `Tâche ${i}`, duree: [15, 30, 45, 90, 150][i % 5], echeance: i % 3 ? a(i % 9, 17) : null, priorite: ["HIGH", "MEDIUM", "LOW"][i % 3], projetId: i % 4 ? "p1" : null }));
  const r = plan(taches, { occupe, priorites: PRIOS });
  const libres = tempsLibre({ debut: LUNDI_9H, fin: r.horizon.fin, horaires: SEMAINE, occupe, tz: TZ });
  const tous = r.placements.flatMap((p) => p.morceaux.map((m) => [m.debut, m.fin, p.id])).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < tous.length; i++) assert.ok(tous[i][0] >= tous[i - 1][1], `chevauchement ${tous[i - 1][2]} / ${tous[i][2]}`);
  for (const [d, f, id] of tous) assert.ok(libres.some(([x, y]) => x <= d && f <= y), `${id} hors du temps libre`);
  for (const p of r.placements) {
    assert.equal(p.morceaux.reduce((s, m) => s + (m.fin - m.debut), 0), p.duree * M, p.id);
    for (const m of p.morceaux) assert.ok(m.fin - m.debut >= 30 * M || p.morceaux.length === 1, "morceau trop court");
    assert.ok(p.raison.length > 5 && !/undefined|null|NaN/.test(p.raison + p.details.join(" ")), p.raison);
  }
  assert.equal(r.placements.length + r.nonPlaces.length, taches.length);
});

// --- Déterministe, indépendant de la machine --------------------------------------------

const JEU = [
  { id: "t1", titre: "Finaliser la démo de la boutique", duree: 75, echeance: a(0, 13), echeanceType: "ferme", priorite: "HIGH", projetId: "p1" },
  { id: "t2", titre: "Relire le contrat de Hugo", duree: 45, echeance: a(0, 19), priorite: "MEDIUM", projetId: "p1" },
  { id: "t8", titre: "Retoucher les photos", duree: 90, echeance: a(2, 20), projetId: "p2" },
  { id: "t11", titre: "Commander les mèches en coton", duree: 30, echeance: a(3, 19), projetId: "p1" },
  { id: "t12", titre: "Envoyer le dossier à la banque", duree: 60, echeance: a(1, 12), echeanceType: "ferme", priorite: "HIGH" },
  { id: "t13", titre: "Écrire la newsletter d'automne", duree: 210, echeance: a(4, 18), projetId: "p1", bloqueePar: [{ id: "t14", nom: "Tri des photos" }] },
  { id: "t14", titre: "Tri des photos de l'été", duree: 240, echeance: a(2, 20), projetId: "p2" },
  { id: "t15", titre: "Faire la déclaration de TVA", duree: 90, echeance: a(5, 23) },
  { id: "t16", titre: "Répéter le morceau pour samedi", duree: 45, pasAvant: "2026-11-16", priorite: "MEDIUM", projetId: "p4" },
  { id: "t17", titre: "Trier les factures du mois", duree: 30, priorite: "MEDIUM" },
  { id: "t18", titre: "Préparer la réunion fournisseurs", duree: 90, echeance: a(1, 18), echeanceType: "ferme", priorite: "HIGH", projetId: "p1" },
  { id: "t20", titre: "Ranger l'atelier", duree: 120, priorite: "LOW" },
];
const AGENDA = [{ debut: a(0, 12, 30), fin: a(0, 13, 45) }, { debut: a(0, 17, 30), fin: a(0, 18, 30) }, { debut: a(1, 8), fin: a(1, 8, 45) }, { debut: a(1, 11, 30), fin: a(1, 13) }, { debut: a(3, 10), fin: a(3, 11) }];
const calcul = (extra = {}) => plan(JEU, { occupe: AGENDA, priorites: PRIOS, ...extra });

test("même entrée, même sortie ; l'ordre des tâches en entrée n'y change rien", () => {
  const r1 = calcul();
  const r2 = calcul();
  assert.deepEqual(r1, r2);
  const melange = [...JEU].reverse();
  melange.splice(3, 0, melange.shift());
  assert.deepEqual(plan(melange, { occupe: [...AGENDA].reverse(), priorites: PRIOS }).placements, r1.placements);
});

test("le fuseau de la machine n'y change rien (tz est un paramètre)", () => {
  const avantTZ = process.env.TZ;
  try {
    process.env.TZ = "Pacific/Kiritimati";
    const x = JSON.stringify(calcul());
    process.env.TZ = "America/Los_Angeles";
    const y = JSON.stringify(calcul());
    process.env.TZ = "UTC";
    const z = JSON.stringify(calcul());
    assert.equal(x, y);
    assert.equal(y, z);
    assert.match(x, /aujourd'hui à|demain à/);
  } finally {
    if (avantTZ === undefined) delete process.env.TZ;
    else process.env.TZ = avantTZ;
  }
});

test("le jeu de démo : les échéances fermes tenues, la newsletter après le tri des photos, la musique d'abord", () => {
  const r = calcul();
  for (const id of ["t1", "t12", "t18"]) assert.equal(place(r, id).tenue, true, id);
  assert.ok(place(r, "t13").debut >= place(r, "t14").fin);
  assert.equal(place(r, "t13").regle, "attend");
  assert.ok(avant(r, "t16", "t17"), "la priorité n°1 avant une tâche sans projet");
  assert.equal(r.placements.length, JEU.length);
});

// --- Stabilité ----------------------------------------------------------------------------

const precedentDe = (r) => ({ placements: r.placements.map((p) => ({ id: p.id, duree: p.duree, morceaux: p.morceaux })) });
const bouges = (r0, r1) => r1.placements.filter((p) => {
  const q = place(r0, p.id);
  return !q || JSON.stringify(q.morceaux) !== JSON.stringify(p.morceaux);
}).map((p) => p.id);
const ordreDe = (r, ids) => [...ids].sort((x, y) => place(r, x).debut - place(r, y).debut);

test("stabilité : recalculer avec le planning d'avant ne change rien, et chaque tâche le dit (« gardée à sa place »)", () => {
  const r0 = calcul();
  const r1 = calcul({ precedent: precedentDe(r0) });
  assert.deepEqual(bouges(r0, r1), []);
  const gardees = r1.placements.filter((p) => p.gardee).map((p) => p.id);
  assert.ok(gardees.length >= 6, gardees.join());
  assert.ok(r1.placements.some((p) => p.details.includes("Gardée à sa place : rien ne l'oblige à bouger.") || p.raison === "Gardée à sa place : rien ne l'oblige à bouger."));
});

test("stabilité : un rendez-vous ajouté mercredi ne touche à rien de lundi ni de mardi, et garde l'ordre", () => {
  const r0 = calcul();
  const occupe = [...AGENDA, { debut: a(2, 9), fin: a(2, 9, 30) }];
  const r1 = calcul({ occupe, precedent: precedentDe(r0) });
  const mercredi = a(2, 0);
  for (const p of r0.placements.filter((x) => x.fin <= mercredi)) assert.deepEqual(place(r1, p.id).morceaux, p.morceaux, `${p.id} a bougé`);
  // Ce qui bouge : seulement ce qui était placé après le rendez-vous, et d'au plus sa durée (le premier trou absorbe).
  for (const id of bouges(r0, r1)) {
    assert.ok(place(r0, id).debut >= a(2, 9), `${id} était avant le changement`);
    assert.ok(place(r1, id).debut - place(r0, id).debut <= 30 * M, `${id} glisse de plus de 30 min`);
  }
  assert.ok(bouges(r0, r1).length <= 3);
  const ids = r0.placements.map((p) => p.id);
  assert.deepEqual(ordreDe(r1, ids), ordreDe(r0, ids), "l'ordre ne change pas");
  // Même sans planning d'avant, « au plus tôt » protège ce qui est placé avant le changement.
  const r2 = calcul({ occupe });
  for (const p of r0.placements.filter((x) => x.fin <= mercredi)) assert.deepEqual(place(r2, p.id).morceaux, p.morceaux);
});

test("stabilité : une tâche finie (disparue) laisse les autres à leur place ; sans le planning d'avant, tout avancerait", () => {
  const r0 = calcul();
  const sans = JEU.filter((t) => t.id !== "t2");
  const r1 = plan(sans, { occupe: AGENDA, priorites: PRIOS, precedent: precedentDe(r0) });
  assert.deepEqual(bouges(r0, r1), []);
  const r2 = plan(sans, { occupe: AGENDA, priorites: PRIOS });
  assert.ok(bouges(r0, r2).length >= 3, "sans R8, les suivantes remontent toutes");
});

test("stabilité : le temps qui passe (20 min) ne rebat rien de ce qui est à venir", () => {
  const r0 = calcul();
  const r1 = planifier({ maintenant: LUNDI_9H + 20 * M, tz: TZ, taches: JEU, horaires: SEMAINE, occupe: AGENDA, priorites: PRIOS, precedent: precedentDe(r0) });
  const avenir = r0.placements.filter((p) => p.debut >= LUNDI_9H + 20 * M);
  for (const p of avenir) assert.deepEqual(place(r1, p.id).morceaux, p.morceaux, p.id);
  assert.ok(avenir.length >= JEU.length - 2);
});

test("stabilité : une durée allongée de 15 min ne bouge que la tâche et sa voisine", () => {
  const r0 = calcul();
  const plusLong = JEU.map((t) => (t.id === "t17" ? { ...t, duree: 45 } : t));
  const r1 = plan(plusLong, { occupe: AGENDA, priorites: PRIOS, precedent: precedentDe(r0) });
  const b = bouges(r0, r1);
  assert.ok(b.includes("t17"));
  assert.ok(b.length <= 3, b.join());
});

test("stabilité : une nouvelle tâche ASAP passe devant, sans rebattre l'ordre des autres", () => {
  const r0 = calcul();
  const r1 = plan([...JEU, { id: "t99", titre: "Rappeler la banque", duree: 30, priorite: "ASAP" }], { occupe: AGENDA, priorites: PRIOS, precedent: precedentDe(r0) });
  assert.equal(r1.placements[0].id, "t99");
  const ids = r0.placements.map((p) => p.id);
  assert.deepEqual(ordreDe(r1, ids), ordreDe(r0, ids));
});

test("stabilité : une ancienne place qui ne vaut plus n'est pas reprise (avant ce qu'elle attend, durée changée, passée)", () => {
  const r0 = calcul();
  const faux = precedentDe(r0);
  const t13 = faux.placements.find((p) => p.id === "t13");
  t13.morceaux = [{ debut: a(0, 9), fin: a(0, 12, 30) }]; // avant le tri des photos
  const r1 = calcul({ precedent: faux });
  assert.ok(place(r1, "t13").debut >= place(r1, "t14").fin);
  assert.ok(!place(r1, "t13").gardee);
  // Des données d'avant abîmées sont ignorées sans erreur.
  assert.doesNotThrow(() => calcul({ precedent: { placements: [null, { id: "t1" }, { id: "t2", morceaux: [{ debut: "x" }] }] } }));
});

// --- Robustesse ---------------------------------------------------------------------------

test("des entrées abîmées ne font jamais tomber le calcul ; `maintenant` est obligatoire", () => {
  assert.throws(() => planifier({ taches: [] }), TypeError);
  const r = planifier({ maintenant: LUNDI_9H, tz: TZ, taches: [null, {}, { id: "" }, { id: "x", duree: "abc" }, { id: "y", duree: -5 }, { id: "z", duree: 30, echeance: "pas une date", priorite: "URGENT", pasAvant: "demain" }, { id: "z", duree: 60 }], horaires: { monday: "n'importe quoi" }, occupe: [null, { debut: "x" }] });
  assert.deepEqual(r.nonPlaces.map((x) => x.id), ["x", "y"]);
  assert.equal(place(r, "z").duree, 30, "le premier exemplaire d'un identifiant compte");
  assert.equal(r.horairesSupposes, true, "horaires illisibles : 9 h-18 h en semaine, et c'est dit");
  // Une attente circulaire est ignorée, sans boucle infinie.
  const c = plan([{ id: "a", titre: "A", duree: 30, bloqueePar: [{ id: "b" }] }, { id: "b", titre: "B", duree: 30, bloqueePar: [{ id: "a" }] }]);
  assert.equal(c.placements.length, 2);
});

test("300 tâches et un agenda chargé : moins de deux secondes", () => {
  const taches = Array.from({ length: 300 }, (_, i) => ({
    id: `t${i}`, titre: `Tâche ${i}`, duree: [15, 30, 45, 60, 90, 120][i % 6],
    echeance: i % 4 ? a(i % 13, 9 + (i % 8)) : null, echeanceType: i % 10 === 0 ? "ferme" : "souple",
    priorite: ["ASAP", "HIGH", "MEDIUM", "LOW"][i % 17 === 0 ? 0 : 1 + (i % 3)], projetId: `p${i % 5}`,
    bloqueePar: i % 11 === 0 && i > 0 ? [{ id: `t${i - 1}` }] : [],
  }));
  const occupe = Array.from({ length: 40 }, (_, i) => ({ debut: a(i % 14, 9 + (i % 7)), fin: a(i % 14, 9 + (i % 7), 45) }));
  const t0 = performance.now();
  const r = planifier({ maintenant: LUNDI_9H, tz: TZ, taches, horaires: SEMAINE, occupe, priorites: PRIOS });
  const dt = performance.now() - t0;
  assert.ok(dt < 2000, `${Math.round(dt)} ms`);
  assert.equal(r.placements.length + r.nonPlaces.length, 300);
});

// --- Depuis Motion, et la comparaison ---------------------------------------------------------

test("depuisMotion : échéance ferme, « pas avant », morceaux de Motion, rappel, projet attendu, attente à la main", () => {
  const { taches, motion } = depuisMotion([
    { id: "m1", name: "Dossier", duration: 120, dueDate: new Date(a(1, 12)).toISOString(), deadlineType: "HARD", startOn: "2026-11-17", priority: "HIGH", project: { id: "p1", name: "Boutiques" },
      chunks: [{ scheduledStart: new Date(a(1, 9)).toISOString(), scheduledEnd: new Date(a(1, 10)).toISOString() }, { scheduledStart: new Date(a(0, 14)).toISOString(), scheduledEnd: new Date(a(0, 15)).toISOString() }] },
    { id: "m2", name: "Appeler", duration: "REMINDER", deadlineType: "NONE", dueDate: new Date(a(0, 12)).toISOString() },
    { id: "m3", name: "Vitrine", duration: 30, bloqueePar: [{ id: "motion:p1", nom: "Boutiques" }, { id: "dossier:d1", nom: "Atelier" }, { id: "m1", nom: "Dossier" }], scheduledStart: new Date(a(0, 9)).toISOString() },
    { id: "m4", name: "Relancer", duration: 15, bloquee: true, raison: "J'attends Hugo" },
    { id: "m5", name: "Finie", completed: true },
  ]);
  assert.equal(taches.length, 4);
  assert.deepEqual([taches[0].echeanceType, taches[0].pasAvant, taches[0].projetId], ["ferme", "2026-11-17", "p1"]);
  assert.deepEqual(motion[0].morceaux.map((m) => m.debut), [a(0, 14), a(1, 9)], "les morceaux de Motion, dans l'ordre");
  assert.equal(taches[1].rappel, true);
  assert.deepEqual(taches[2].bloqueePar, [{ id: "p1", nom: "Boutiques", type: "projet" }, { id: "m1", nom: "Dossier", type: "tache" }]);
  assert.equal(motion[2].fin, a(0, 9, 30), "sans fin donnée : la durée");
  assert.equal(taches[3].enAttente, "J'attends Hugo");
  const r = plan(taches);
  assert.equal(nonPlace(r, "m2").genre, "rappel");
  assert.equal(nonPlace(r, "m4").genre, "attente");
  assert.ok(place(r, "m1").debut >= a(1, 0), "pas avant mardi");
});

test("comparer : la tâche bloquée que Motion place quand même, avec sa raison", () => {
  const taches = [
    { id: "news", titre: "Écrire la newsletter d'automne", duree: 120, bloqueePar: [{ id: "photos", nom: "Tri des photos" }] },
    { id: "photos", titre: "Tri des photos de l'été", duree: 120 },
    { id: "relance", titre: "Relancer Hugo", duree: 15, enAttente: "J'attends sa réponse" },
  ];
  const r = plan(taches);
  const motion = [
    { id: "news", morceaux: [{ debut: a(0, 9), fin: a(0, 11) }], debut: a(0, 9), fin: a(0, 11) },
    { id: "photos", morceaux: [{ debut: a(0, 14), fin: a(0, 16) }], debut: a(0, 14), fin: a(0, 16) },
    { id: "relance", morceaux: [{ debut: a(1, 9), fin: a(1, 9, 15) }], debut: a(1, 9), fin: a(1, 9, 15) },
  ];
  const e = comparer({ plan: r, motion, taches, maintenant: LUNDI_9H, tz: TZ });
  const b = e.find((x) => x.id === "bloquee:news");
  assert.ok(b, JSON.stringify(e));
  assert.equal(b.pourquoi, "Elle attend « Tri des photos de l'été » : Motion la place aujourd'hui à 09:00, avant que « Tri des photos de l'été » soit finie (aujourd'hui à 16:00). Rémy la met après.");
  assert.equal(b.remy, "aujourd'hui à 11:00–13:00");
  const at = e.find((x) => x.id === "bloquee:relance");
  assert.equal(at.pourquoi, "Tu l'as mise en attente (« J'attends sa réponse ») : Rémy ne la place pas, Motion la place quand même demain à 09:00.");
  assert.ok(!e.some((x) => x.genre === "ordre" && x.taches.includes("news")), "pas deux fois le même écart");
});

test("comparer : une échéance ferme tenue par Rémy et pas par Motion — et l'inverse, dit honnêtement", () => {
  const taches = [
    { id: "banque", titre: "Envoyer le dossier à la banque", duree: 60, echeance: a(1, 12), echeanceType: "ferme" },
    { id: "long", titre: "Dossier de subvention", duree: 600, echeance: a(0, 18), echeanceType: "ferme" },
  ];
  const r = plan(taches);
  const motion = [
    { id: "banque", morceaux: [{ debut: a(1, 16), fin: a(1, 17) }], debut: a(1, 16), fin: a(1, 17) },
    // Motion déborde des horaires (il le fait pour une échéance ferme) : il la tient.
    { id: "long", morceaux: [{ debut: a(0, 7), fin: a(0, 17) }], debut: a(0, 7), fin: a(0, 17) },
  ];
  const e = comparer({ plan: r, motion, taches, maintenant: LUNDI_9H, tz: TZ });
  const banque = e.find((x) => x.id === "ferme:banque");
  assert.equal(banque.gagnant, "remy");
  assert.match(banque.pourquoi, /^Échéance ferme demain à 12:00 : Rémy la tient \(finie .+\), Motion non \(finie demain à 17:00\)\.$/);
  const long = e.find((x) => x.id === "ferme:long");
  assert.equal(long.gagnant, "motion");
  assert.equal(long.pourquoi, "Échéance ferme aujourd'hui à 18:00 : Motion la tient, Rémy non (il la finit demain à 10:00).");
});

test("comparer : l'ordre inverse, quand une règle de Rémy départage — et rien quand rien ne départage", () => {
  const taches = [
    { id: "morceau", titre: "Répéter le morceau", duree: 60, projetId: "p4" },
    { id: "factures", titre: "Trier les factures", duree: 60 },
    { id: "x1", titre: "Arroser", duree: 30 },
    { id: "x2", titre: "Ranger", duree: 30 },
  ];
  const r = plan(taches, { priorites: PRIOS });
  const motion = [
    { id: "factures", morceaux: [{ debut: a(0, 9), fin: a(0, 10) }], debut: a(0, 9), fin: a(0, 10) },
    { id: "morceau", morceaux: [{ debut: a(0, 14), fin: a(0, 15) }], debut: a(0, 14), fin: a(0, 15) },
    { id: "x2", morceaux: [{ debut: a(0, 15), fin: a(0, 15, 30) }], debut: a(0, 15), fin: a(0, 15, 30) },
    { id: "x1", morceaux: [{ debut: a(0, 16), fin: a(0, 16, 30) }], debut: a(0, 16), fin: a(0, 16, 30) },
  ];
  const e = comparer({ plan: r, motion, taches, priorites: PRIOS, maintenant: LUNDI_9H, tz: TZ });
  const o = e.filter((x) => x.genre === "ordre");
  assert.equal(o.length, 1, JSON.stringify(o));
  assert.equal(o[0].id, "ordre:morceau:factures");
  assert.equal(o[0].pourquoi, "Rémy fait « Répéter le morceau » avant « Trier les factures » : « Répéter le morceau » sert ta priorité n°1 (« La musique »), pas « Trier les factures ». Motion fait l'inverse.");
  // Les mêmes plannings : aucun écart.
  const pareil = r.placements.map((p) => ({ id: p.id, morceaux: p.morceaux, debut: p.debut, fin: p.fin }));
  assert.deepEqual(comparer({ plan: r, motion: pareil, taches, priorites: PRIOS, maintenant: LUNDI_9H, tz: TZ }), []);
  // L'identifiant d'un écart ne change pas d'un calcul à l'autre.
  const r2 = plan(taches, { priorites: PRIOS, precedent: precedentDe(r) });
  assert.deepEqual(comparer({ plan: r2, motion, taches, priorites: PRIOS, maintenant: LUNDI_9H, tz: TZ }).map((x) => x.id), e.map((x) => x.id));
});

test("les mots : quand, durées", () => {
  assert.equal(quand(a(0, 15), LUNDI_9H, TZ), "aujourd'hui à 15:00");
  assert.equal(quand(a(1, 9), LUNDI_9H, TZ), "demain à 09:00");
  assert.equal(quand(a(-1, 18), LUNDI_9H, TZ), "hier à 18:00");
  assert.equal(quand(a(3, 18), LUNDI_9H, TZ), "jeu. 19 à 18:00");
  assert.equal(dureeDite(45), "45 min");
  assert.equal(dureeDite(90), "1 h 30");
  assert.equal(dureeDite(120), "2 h");
  assert.equal(heurePar(a(0, 9)), "08:00", "Paris = UTC+1 en novembre");
});
