// La boîte et le rituel du site (lot boite) : ce que disent et décident
// public/app/analyse/rituel.js (port de Rituel.swift, ATrancher.swift,
// Logique.swift › Nuit, Modeles.swift › Brouillons, avec les cas de leurs
// tests Swift), les propositions que l'app Windows notifie
// (public/app/bureau.js, creerTic), et le contrat : chaque route que la boîte
// et « À trancher » lisent ou écrivent, jouée contre les vraies routes de la
// tour (lib/routes.js), rend ce que les vues lisent.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const R = await import("../public/app/analyse/rituel.js");
const B = await import("../public/app/bureau.js");

const M = 60e3;
const H = 3600e3;
const J = 86400e3;
const date = (an, mois, jour, h = 10, mi = 0) => new Date(an, mois - 1, jour, h, mi).getTime();

// --- La nuit (Nuit.estRecente, BoiteView, Brouillons.sujet) ---

test("nuit récente : depuis la veille à 18:00 ; sans date, non (les mêmes cas que CoeurTests.swift)", () => {
  const d = 1_790_152_200_000; // mer. 23/09/2026 10:30 à Paris
  assert.equal(R.nuitRecente(1_790_092_800_000 + 60_000, d), true);
  assert.equal(R.nuitRecente(1_790_092_800_000 - 60_000, d), false);
  assert.equal(R.nuitRecente(null, d), false);
  assert.equal(R.nuitRecente(undefined, d), false);
});

test("« cette nuit » seulement si la réflexion vient de passer, sinon « le 27 oct. »", () => {
  const maintenant = date(2026, 10, 29, 9);
  assert.equal(R.quandNuit(date(2026, 10, 29, 3), maintenant), "cette nuit");
  assert.equal(R.quandNuit(date(2026, 10, 28, 18, 1), maintenant), "cette nuit");
  assert.equal(R.quandNuit(null, maintenant), "cette nuit", "sans date : la nuit, comme l'iPhone");
  assert.equal(R.quandNuit(date(2026, 10, 27, 3), maintenant), "le 27 oct.");
  assert.equal(R.phraseSujet("Léa attend ta réponse", date(2026, 10, 29, 3), maintenant),
    "À propos de ce que tu as remarqué cette nuit : « Léa attend ta réponse ». Qu'est-ce que tu proposes ?");
  assert.equal(R.phraseSujet("Léa attend ta réponse", date(2026, 10, 27, 3), maintenant),
    "À propos de ce que tu as remarqué le 27 oct. : « Léa attend ta réponse ». Qu'est-ce que tu proposes ?");
});

test("l'intro et les états vides de la boîte disent pourquoi il n'y a rien", () => {
  const maintenant = date(2026, 10, 29, 9);
  assert.equal(R.introBoite({ generatedAt: date(2026, 10, 29, 3) }, maintenant), "Ce que Rémy a remarqué cette nuit. Rien ne presse : tu peux les laisser pour plus tard.");
  assert.equal(R.introBoite(null, maintenant), "Ce que Rémy a remarqué cette nuit. Rien ne presse : tu peux les laisser pour plus tard.");
  assert.equal(R.introBoite({ generatedAt: date(2026, 10, 27, 3) }, maintenant), "Ce que Rémy a remarqué le 27 oct.", "un seul point");
  assert.equal(R.rienBoite({ generatedAt: date(2026, 10, 29, 3) }, true, maintenant), "Rien de notable cette nuit.");
  assert.equal(R.rienBoite({ generatedAt: date(2026, 10, 25, 3) }, true, maintenant), "Rien de notable la dernière fois.");
  assert.equal(R.rienBoite(null, false, maintenant), "La préparation de nuit n'est pas active : rien ne s'affichera ici.");
  assert.equal(R.rienBoite({ text: "" }, true, maintenant), "Chaque nuit, Rémy relit tes échanges et note ici ce qui mérite ton attention.");
});

test("les sujets : les gestes en cours surchargent la tour, l'ordre reste celui de la tour, seuls les ouverts comptent", () => {
  const b = { items: [{ id: "a", texte: "A", etat: "ouvert" }, { id: "b", texte: "B", etat: "traite" }, { id: "c", texte: "C", etat: "ouvert" }, { texte: "sans id" }] };
  const vus = R.sujets(b, new Map([["a", "ignore"]]));
  assert.deepEqual(vus.map((s) => `${s.id}:${s.etat}`), ["a:ignore", "b:traite", "c:ouvert"], "le sujet réglé reste à sa place (ForEach(items) de l'iPhone) : rien ne glisse sous le pointeur");
  assert.equal(R.sujetsRanges, undefined, "plus de tri « ouverts en tête » : un double clic réglait le sujet voisin");
  assert.equal(R.compteOuverts(vus), 1);
  assert.equal(R.intertitreSujets(vus), "À voir avec Rémy (1)");
  assert.equal(R.intertitreSujets([]), "À voir avec Rémy");
  assert.equal(R.libelleBoite(2, true), "Ton briefing et les sujets de la nuit, 2 ouverts");
  assert.equal(R.libelleBoite(1, false), "À voir avec Rémy, 1 ouvert");
  assert.equal(R.libelleBoite(0, true), "Ton briefing et les sujets de la nuit");
  assert.equal(R.phraseEtatSujet("traite"), "Noté comme fait.");
  assert.equal(R.phraseEtatSujet("ignore"), "Laissé de côté : Rémy ne le reproposera pas.");
  assert.equal(R.phraseEtatSujet("ouvert"), null, "Rouvrir : sans bandeau de succès");
});

test("un geste sur un sujet reste montré jusqu'au tableau lu après lui, jamais effacé au seul passage du temps", () => {
  const geste = { etat: "traite", a: date(2026, 10, 29, 9, 10) };
  assert.equal(R.surchargeRelue(geste, "traite", null), true, "la tour l'a rattrapé : confirmé");
  assert.equal(R.surchargeRelue(geste, "ouvert", null), false, "tableau sans heure (ou relu d'avant) : on garde le geste");
  assert.equal(R.surchargeRelue(geste, "ouvert", date(2026, 10, 29, 9, 9)), false, "un tableau plus vieux que le geste ne le défait pas");
  assert.equal(R.surchargeRelue(geste, "ouvert", date(2026, 10, 29, 9, 30)), true, "un tableau lu après le contredit (rouvert ailleurs) : la tour l'emporte");
  assert.equal(R.surchargeRelue({ etat: "traite", a: null }, "ouvert", date(2026, 10, 29, 9, 30)), false, "écriture en route : pas encore prise par la tour");
});

test("double clic : le second clic, moins de 400 ms après un geste qui a fait bouger la liste, est ignoré", () => {
  const t = date(2026, 10, 29, 9, 10);
  assert.equal(R.clicEnEcho(null, t), false, "aucun geste encore");
  assert.equal(R.clicEnEcho(t, t + 120), true, "un double clic humain (120 ms)");
  assert.equal(R.clicEnEcho(t, t + 399), true);
  assert.equal(R.clicEnEcho(t, t + R.DOUBLE_CLIC), false, "au-delà : un geste voulu passe");
  assert.equal(R.clicEnEcho(t, t + 700), false);
  assert.equal(R.clicEnEcho(t + 10, t), false, "horloge revenue en arrière : on ne bloque rien");
});

// --- Le briefing et le bilan (Rituel.swift, RituelTests.swift) ---

const rituel = {
  maintenant: 1792787400000,
  aujourdhui: { pour: "2026-10-23", jour: "vendredi 23 octobre", titre: "Ta journée — vendredi 23 octobre", compte: "Ce qui compte : « Finaliser la démo », avant 16:00.",
    pourquoi: "Pourquoi : priorité importante.", menace: "Menacée : « Facture Ondine » — due aujourd'hui 17:00, aucun créneau prévu.", resume: "1 rendez-vous" },
  demain: { pour: "2026-10-24", titre: "Ta journée — samedi 24 octobre", compte: "Journée libre : aucun rendez-vous ni échéance.", pourquoi: "Pourquoi : rien d'autre n'est fixé ce jour-là.", menace: "Rien de menacé : la journée tient." },
  soir: { jour: "2026-10-23", fait: ["Trier la boîte mail"], glisse: [{ id: "t2", titre: "Relire le contrat" }],
    reste: [{ id: "t2", titre: "Relire le contrat", echeance: 1792825200000, versDemain: 1792911600000 }], phrase: "1 fait, 1 reste pour aujourd'hui." },
};

test("le briefing du bon jour, jamais celui d'un autre (sauf lecture fraîche d'une tour dans un autre fuseau)", () => {
  assert.equal(R.briefingDuJour(rituel, { maintenant: Date.parse("2026-10-24T05:30:00Z") })?.pour, "2026-10-24");
  assert.equal(R.briefingDuJour(rituel, { maintenant: Date.parse("2026-10-23T05:30:00Z") })?.pour, "2026-10-23");
  assert.equal(R.briefingDuJour(rituel, { maintenant: Date.parse("2026-10-26T05:30:00Z") }), null, "jamais le briefing d'un autre jour");
  const m = Date.parse("2026-10-26T05:30:00Z");
  assert.equal(R.briefingDuJour(rituel, { maintenant: m, luA: m - 2 * H })?.pour, "2026-10-23", "lu il y a moins de 3 h : l'« aujourd'hui » de la tour");
  assert.equal(R.briefingDuJour(rituel, { maintenant: m, luA: m - 4 * H }), null);
  assert.equal(R.briefingDuJour(null), null);
});

test("le bilan n'est montré que s'il est d'aujourd'hui, ou tout frais", () => {
  assert.equal(R.soirDuJour(rituel, { maintenant: date(2026, 10, 23, 19, 40) })?.phrase, "1 fait, 1 reste pour aujourd'hui.");
  assert.equal(R.soirDuJour(rituel, { maintenant: date(2026, 10, 24, 19, 40) }), null);
  assert.ok(R.soirDuJour(rituel, { maintenant: date(2026, 10, 24, 0, 30), luA: date(2026, 10, 24, 0, 10) }));
  assert.equal(R.soirDuJour({ soir: null }), null);
});

test("le titre du jour, la menace, la fraîcheur et la provenance (TroisLignes)", () => {
  assert.equal(R.jourTitre(rituel.aujourdhui), "Vendredi 23 octobre");
  assert.equal(R.jourTitre(rituel.demain), "Ta journée — samedi 24 octobre");
  assert.ok(R.estMenace(rituel.aujourdhui));
  assert.ok(!R.estMenace(rituel.demain));
  const m = date(2026, 10, 23, 10);
  assert.equal(R.fraicheur(m - 30e3, m), "à l'instant");
  assert.equal(R.fraicheur(m - 12 * M, m), "il y a 12 min");
  assert.equal(R.fraicheur(m - 59 * M - 59e3, m), "il y a 59 min");
  assert.equal(R.fraicheur(date(2026, 10, 23, 7, 12), m), "à 07:12");
  assert.equal(R.fraicheur(date(2026, 10, 22, 22, 10), m), "hier à 22:10");
  assert.equal(R.fraicheur(date(2026, 10, 21, 22, 10), m), "le 21 oct.");
  assert.equal(R.provenance({ luA: m - 30e3, maintenant: m }), "Calculé par ta tour à l'instant, sans IA.");
  assert.equal(R.provenance({ luA: m - 12 * M, chargement: true, maintenant: m }), "Calculé par ta tour il y a 12 min, sans IA · mise à jour…");
  assert.equal(R.provenance({ luA: m - 12 * M, erreur: "La tour ne répond pas.", maintenant: m }), "Calculé par ta tour il y a 12 min. Pas actualisé : La tour ne répond pas.");
  assert.equal(R.intertitreMenacees(1), "Menacée");
  assert.equal(R.intertitreMenacees(3), "Menacées (3)");
});

test("les phrases pour Rémy : menacée, organiser ma journée (et son titre), heure du briefing", () => {
  assert.equal(R.phraseMenacee({ titre: "Facture Ondine", phrase: "Due aujourd'hui 17:00, aucun créneau prévu." }),
    "« Facture Ondine » est menacée : Due aujourd'hui 17:00, aucun créneau prévu. Trouve-lui un créneau avant son échéance, sans toucher à mes rendez-vous.");
  assert.equal(R.ORGANISER, "Organise ma journée : regarde mon agenda et mes tâches, dis-moi par quoi commencer et ce qui est en retard. Pose tes questions d'un coup si tu en as.");
  assert.equal(R.titreJournee(new Date(1_790_152_200_000)), "23/09/2026 · Journée", "comme Fils.journee");
  assert.equal(R.texteHeure("07:30"), "7:30");
  assert.equal(R.texteHeure("22:45"), "22:45");
});

test("le bilan rangé reste acquis pour son jour ; ce qui est poussé à demain sort de la liste", () => {
  assert.ok(R.bilanRange({ jour: "2026-10-23", range: true }, "2026-10-23"));
  assert.ok(!R.bilanRange({ jour: "2026-10-22", range: true }, "2026-10-23"), "un autre jour : à refaire");
  assert.ok(!R.bilanRange(null, "2026-10-23"));
  const soir = { reste: [{ id: "t2", titre: "A" }, { id: "t3", titre: "B" }] };
  assert.deepEqual(R.resteVisible(soir, new Set(["t2"])).map((t) => t.id), ["t3"]);
  assert.equal(R.videReste(new Set()), "Rien ne reste : bravo.");
  assert.equal(R.videReste(new Set(["t2"])), "Poussé à demain. Motion recalcule.");
});

test("tout ce qui reste → demain : combien sont parties, lesquelles, et pourquoi pas les autres", () => {
  const reste = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
  assert.deepEqual(R.bilanPoussee({ results: [{ ok: true }, { ok: false, erreur: "tâche introuvable" }, { ok: true }] }, reste),
    { reussies: 2, echecs: 1, ids: ["t1", "t3"], erreur: "tâche introuvable" });
  assert.deepEqual(R.bilanPoussee({ results: [], echecs: 0 }, reste).ids, ["t1", "t2", "t3"], "sans détail et sans échec : tout est parti");
  assert.equal(R.bilanPoussee({ results: [{ ok: false, erreur: "quota" }, { ok: false }, { ok: false }] }, reste).reussies, 0);
  assert.equal(R.phrasePoussees(1, 0), "1 tâche pour demain. Motion recalcule.");
  assert.equal(R.phrasePoussees(2, 1), "2 tâches pour demain. Motion recalcule. 1 n'a pas pu partir.");
});

// --- La semaine : « À trancher », revue, retards (ATrancherTests.swift) ---

test("la revue est proposée le dimanche, une fois par semaine, si elle n'est pas coupée", () => {
  const dimanche = date(2026, 10, 25);
  assert.ok(R.revueProposee({ maintenant: dimanche, active: true, faiteLe: null }));
  assert.ok(!R.revueProposee({ maintenant: date(2026, 10, 24), active: true }), "samedi : non");
  assert.ok(!R.revueProposee({ maintenant: dimanche, active: false }), "coupée dans Réglages");
  assert.ok(!R.revueProposee({ maintenant: dimanche, active: true, faiteLe: date(2026, 10, 25, 9) }), "déjà faite ce dimanche");
  assert.ok(R.revueProposee({ maintenant: dimanche, active: true, faiteLe: date(2026, 10, 18, 9) }), "faite la semaine d'avant");
  assert.equal(R.debutSemaine(dimanche).getTime(), date(2026, 10, 19, 0), "la semaine commence le lundi");
});

test("une absence de plus de trois jours ; le premier lancement n'a rien à rattraper", () => {
  const maintenant = date(2026, 10, 24);
  assert.ok(!R.apresAbsence(null, maintenant));
  assert.ok(!R.apresAbsence(date(2026, 10, 21, 12), maintenant));
  assert.ok(R.apresAbsence(date(2026, 10, 20, 9), maintenant));
});

test("un geste par ligne selon son type, le principal mis en avant", () => {
  const ids = (t) => R.gestesTri(t).map(([g]) => g);
  assert.deepEqual(ids("carte"), ["oui", "non", "plusTard"]);
  assert.deepEqual(ids("doublon"), ["fusionner", "plusTard"]);
  assert.deepEqual(ids("fil"), ["supprimer", "plusTard"]);
  assert.deepEqual(ids("retard"), ["fait", "demain", "abandonner"]);
  assert.deepEqual(ids("rappel-retard"), ["fait", "demain", "abandonner"]);
  assert.deepEqual(ids("inconnu"), ["plusTard"]);
  for (const l of Object.values(R.GESTES_TRI)) for (const [, lib] of l) assert.ok(lib.length);
  assert.ok(R.PRINCIPAUX.has("oui") && R.PRINCIPAUX.has("fait") && !R.PRINCIPAUX.has("plusTard"));
});

test("un geste qui échoue dit ce qui n'a pas été fait, avec les mots de l'iPhone (ATrancherModel.echec)", () => {
  assert.equal(R.prefixeEchec("plusTard", { type: "carte" }), "Pas reporté");
  assert.equal(R.prefixeEchec("plusTard", { type: "fil" }), "Pas reporté");
  assert.equal(R.prefixeEchec("oui", { type: "carte", source: "regle" }), "Règle pas créée");
  assert.equal(R.prefixeEchec("oui", { type: "carte", source: "motion" }), "Pas fait");
  assert.equal(R.prefixeEchec("non", { type: "carte" }), "« Non » pas enregistré");
  assert.equal(R.prefixeEchec("garder", { type: "idee" }), "Idée pas rangée");
  assert.equal(R.prefixeEchec("supprimer", { type: "idee" }), "Idée pas supprimée");
  assert.equal(R.prefixeEchec("abandonner", { type: "retard" }), "Pas abandonnée");
  assert.equal(R.prefixeEchec("supprimer", { type: "rappel" }), "Pas fait");
  assert.equal(R.prefixeEchec("retirer", { type: "articles" }), "Pas fait");
});

test("les rappels datés passés depuis plus d'une heure sont des retards", () => {
  const maintenant = date(2026, 10, 24);
  const r = R.rappelsEnRetard([
    { id: "a", texte: "Payer le loyer", quand: maintenant - 3 * J, fait: false },
    { id: "b", texte: "Déjà fait", quand: maintenant - J, fait: true },
    { id: "c", texte: "Plus tard", quand: maintenant + J, fait: false },
    { id: "d", texte: "Sans date", quand: null, fait: false },
    { id: "e", texte: "Il y a 30 min", quand: maintenant - 30 * M },
    { id: "f", texte: "Supprimé", quand: maintenant - 2 * J, supprime: true },
  ], maintenant);
  assert.deepEqual(r.map((x) => x.rappelId), ["a"]);
  assert.deepEqual(r[0], { cle: "rappelretard:a", type: "rappel-retard", texte: "Payer le loyer", detail: "Rappel", depuis: maintenant - 3 * J, rappelId: "a" });
  assert.equal(R.sousTitreLigne(r[0]), `Rappel · prévu ${R.jourCourt(maintenant - 3 * J)}`);
  assert.equal(R.demainMemeHeure(date(2026, 10, 20, 8, 15), maintenant), date(2026, 10, 25, 8, 15), "demain, à la même heure");
});

test("une ligne réglée sort, le total suit, une ligne du carnet suit l'état lu (RituelSemaine.filtrer)", () => {
  const groupes = [
    { id: "rappels", titre: "Rappels sans date", total: 2, lignes: [
      { cle: "rappel:r1", type: "rappel", texte: "Changer les essuie-glaces", rappelId: "r1" },
      { cle: "rappel:r2", type: "rappel", texte: "Rangé depuis", rappelId: "r2" }] },
    { id: "doublons", titre: "Rappels en double", total: 1, lignes: [{ cle: "doublon:r3", type: "doublon", texte: "Appeler le garage", rappelId: "r3", doublons: ["r4"] }] },
    { id: "articles", titre: "Articles pris", total: 1, lignes: [{ cle: "articles:l1", type: "articles", texte: "Courses : 2 articles pris", listeId: "l1", nombre: 2 }] },
    { id: "fils", titre: "Fils d'un seul échange", total: 41, lignes: [
      { cle: "fil:c1", type: "fil", texte: "Idée de cadeau", convId: "c1" },
      { cle: "fil:c2", type: "fil", texte: "Budget", convId: "c2" }] },
  ];
  const rappels = [
    { id: "r1", texte: "Changer les essuie-glaces", quand: null, fait: false },
    { id: "r2", texte: "Rangé depuis", quand: Date.now(), fait: false },
    { id: "r3", texte: "Appeler le garage", quand: null, fait: false },
  ];
  const listes = [{ id: "l1", nom: "Courses", elements: [{ id: "e1", texte: "Tomates", fait: true }, { id: "e2", texte: "Lait", fait: false }] }];
  const reste = R.filtrerGroupes(groupes, { masquees: new Set(["fil:c1"]), rappels, listes });
  assert.deepEqual(reste.map((g) => g.id), ["rappels", "articles", "fils"], "le doublon fusionné est réglé");
  assert.deepEqual(reste[0].lignes.map((l) => l.rappelId), ["r1"], "un rappel daté entre-temps sort");
  assert.equal(reste[1].lignes[0].texte, "Courses : 1 article pris", "le compte suit la liste");
  assert.equal(reste[2].total, 40, "le total suit les lignes réglées");
  assert.equal(R.filtrerGroupes(groupes).length, 4, "carnet pas encore lu : on croit la tour");
  assert.equal(R.totalGroupes(reste), 1 + 1 + 40);
});

test("les sous-titres et les phrases de la liste (LigneTri, ListeTri, CarteATrancher)", () => {
  const d = date(2026, 10, 20);
  assert.equal(R.sousTitreLigne({ type: "carte", detail: "Abonnement de Tom · 1 action", depuis: d }), "Abonnement de Tom · 1 action · depuis le 20 oct.");
  assert.equal(R.sousTitreLigne({ type: "retard", detail: null, depuis: d }), "prévu 20 oct.");
  assert.equal(R.sousTitreLigne({ type: "articles", detail: "Café, Lessive", depuis: null }), "Café, Lessive");
  assert.equal(R.sousTitreLigne({ type: "fil" }), null);
  assert.equal(R.phrasePlusDe(38), "Et 38 de plus : elles viendront une fois celles-ci réglées.");
  assert.equal(R.phraseReportes(1), "1 ligne remise à plus tard : elle reviendra dans la semaine.");
  assert.equal(R.phraseReportes(3), "3 lignes remises à plus tard : elles reviendront dans la semaine.");
  assert.equal(R.phraseCarteTrancher(1), "1 chose attend un geste : cartes, rappels, articles, vieux fils, idées.");
  assert.equal(R.phraseCarteTrancher(14), "14 choses attendent un geste : cartes, rappels, articles, vieux fils, idées.");
});

test("la revue : la semaine, les domaines, ce qui a glissé, les décisions", () => {
  const revue = { domaines: [{ nom: "Boutiques", faites: 2, glissees: 0, minutes: 75 }, { nom: "Sans projet", faites: 1, glissees: 3, minutes: 10 }], rappelsFaits: 1 };
  assert.equal(R.resumeSemaine(revue), "Cette semaine : 3 tâches faites, 1 rappel fait, 3 qui ont glissé.");
  assert.equal(R.resumeSemaine({ domaines: [{ nom: "A", faites: 1, glissees: 0 }] }), "Cette semaine : 1 tâche faite, rien n'a glissé.");
  assert.equal(R.resumeSemaine({ domaines: [{ nom: "A", faites: 0, glissees: 1 }] }), "Cette semaine : 0 tâche faite, 1 qui a glissé.");
  assert.equal(R.ligneDomaine(revue.domaines[0]), "2 faites");
  assert.equal(R.ligneDomaine(revue.domaines[1]), "1 faite · 3 glissées");
  assert.equal(R.dureeCourte(75), "1 h 15");
  assert.equal(R.dureeCourte(10), "10 min");
  assert.equal(R.dureeCourte(120), "2 h");
  assert.equal(R.ligneGlissee({ nom: "Relancer le comptable", echeance: date(2026, 10, 20) }), "· Relancer le comptable — prévu 20 oct.");
  assert.equal(R.ligneGlissee({ nom: "Sans date" }), "· Sans date");
  assert.deepEqual(R.decisionsPropres(["  Finir la boutique ", "", "   ", "Voir Léa"]), ["Finir la boutique", "Voir Léa"]);
  assert.equal(R.phraseDecisions(2), "Gardé : 2 décisions pour la semaine.");
  assert.equal(R.phraseDecisions(1), "Gardé : 1 décision pour la semaine.");
  assert.equal(R.phraseDecisions(0), "Aucune décision gardée.");
  assert.deepEqual(R.TITRES_REVUE, ["Ta semaine", "Tes idées", "À trancher", "Trois décisions", "Ce que j'ai appris sur toi"]);
});

// --- Les propositions qui attendent un « oui » (app Windows, CerveauTests.swift) ---

const attente = [
  { id: "p-rasage", origine: "regles", convId: "c-regles", source: "motion", titre: "Règles de Rémy", texte: "« Rasage » avant « Soirée chez Léo » (samedi 25 19:00)", nombre: 1, a: 2000 },
  { id: "nuit-abc123def456", origine: "nuit", titre: "Cette nuit, aussi ?", texte: "Compare deux fournisseurs de cire", sujet: "Compare deux fournisseurs de cire", nombre: 1, a: 1000 },
  { id: "p-valise", origine: "regles", convId: "c-regles", source: "agenda", titre: "Règles de Rémy", texte: "« Valise »", nombre: 2, a: 3000 },
];

test("le texte et la vue d'une proposition : la règle s'ouvre dans son fil, le sujet de nuit dans sa feuille", () => {
  assert.deepEqual(B.texteProposition(attente[0]), { titre: "Une tâche d'après tes règles", corps: attente[0].texte });
  assert.equal(B.texteProposition(attente[1]).titre, "Cette nuit, je creuse aussi ?");
  assert.equal(B.texteProposition(attente[2]).titre, "2 rendez-vous d'après tes règles");
  assert.equal(B.texteProposition({ origine: "regles", source: "agenda", nombre: 1, texte: "x" }).titre, "Un rendez-vous d'après tes règles");
  assert.equal(B.texteProposition({ origine: "regles", nombre: 4, texte: "x" }).titre, "4 tâches d'après tes règles");
  assert.equal(B.texteProposition({ origine: "nuit", texte: "x".repeat(300) }).corps.length, 220);
  assert.equal(B.vueProposition(attente[0]), "remy/c-regles");
  assert.equal(B.vueProposition(attente[1]), "aujourdhui/nuit/nuit-abc123def456");
  assert.equal(B.vueProposition({ origine: "regles", convId: "Pas Sûr!" }), "remy", "une adresse que la coquille refuserait : Rémy");
  for (const p of attente) assert.match(B.vueProposition(p), /^[a-z0-9/-]{1,60}$/);
});

test("chaque proposition est dite une fois, la plus ancienne d'abord ; une tranchée ailleurs est oubliée", () => {
  const premier = B.propositionsADire(attente, { deja: new Set() });
  assert.deepEqual(premier.notifications.map((n) => n.ids[0]), ["nuit-abc123def456", "p-rasage", "p-valise"], "trois : chacune la sienne, pas de plafond à 2");
  assert.deepEqual(premier.garder, []);
  const deja = new Set(["nuit-abc123def456", "p-rasage", "ancienne"]);
  const second = B.propositionsADire(attente.slice(0, 2).concat(attente[2]), { deja });
  assert.deepEqual(second.notifications.map((n) => n.ids[0]), ["p-valise"]);
  assert.deepEqual(second.garder.sort(), ["nuit-abc123def456", "p-rasage"], "« ancienne » n'est plus en attente : oubliée");
});

test("au-delà de trois, les plus anciennes sont regroupées en une seule notification", () => {
  const liste = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, origine: "regles", convId: "c-regles", source: "motion", texte: `Tâche ${i}`, nombre: 1, a: 1000 + i }));
  const { notifications } = B.propositionsADire(liste, { deja: new Set() });
  assert.equal(notifications.length, 4, "un groupe + les trois plus récentes");
  assert.equal(notifications[0].titre, "3 propositions de Rémy attendent ta réponse");
  assert.deepEqual(notifications[0].ids, ["p0", "p1", "p2"]);
  assert.equal(notifications[0].vue, "remy/c-regles", "toutes du même fil : ce fil");
  assert.deepEqual(notifications.slice(1).map((n) => n.ids[0]), ["p3", "p4", "p5"]);
  const mele = [...liste.slice(0, 4), { id: "nuit-1", origine: "nuit", texte: "Sujet", sujet: "Sujet", a: 1 }];
  assert.equal(B.propositionsADire(mele).notifications[0].vue, "aujourdhui/nuit", "mêlées : la feuille qui les montre toutes");
});

function banc({ maintenant = date(2026, 10, 29, 14), reglages = {}, propositions = attente, sait = () => true } = {}) {
  const horloge = { t: maintenant };
  const memoire = new Set();
  const plusTard = new Map();
  const notifs = [];
  const lectures = [];
  const refus = [];
  const tic = B.creerTic({
    horloge: () => horloge.t,
    reglages: () => ({ ...B.REGLAGES_PAR_DEFAUT, rappels: false, ...reglages }),
    memoire: { deja: () => new Set(), noter: () => {} },
    sait,
    memoirePropositions: {
      lire: () => new Set(memoire),
      ecrire: (ids) => { memoire.clear(); for (const id of ids) memoire.add(id); },
      plusTard: () => new Map(plusTard),
      ecrirePlusTard: (m) => { plusTard.clear(); for (const [id, t] of m) plusTard.set(id, t); },
    },
    lire: async (chemin) => {
      lectures.push(chemin);
      if (chemin === "/api/propositions/attente") return { propositions: typeof propositions === "function" ? propositions() : propositions };
      return {};
    },
    notif: async (titre, corps, cle, vue) => {
      if (refus.length) throw new Error(refus.shift());
      notifs.push({ titre, corps, cle, vue });
    },
  });
  return { tic, horloge, memoire, plusTard, notifs, lectures, refus };
}

test("la boucle d'une minute : dite une fois, relue au plus chaque minute, refus de Windows = pas marquée", async () => {
  const b = banc();
  b.refus.push("Trop de notifications en une minute");
  await b.tic();
  assert.deepEqual(b.notifs.map((n) => n.titre), ["Une tâche d'après tes règles", "2 rendez-vous d'après tes règles"], "la première refusée");
  assert.deepEqual([...b.memoire].sort(), ["p-rasage", "p-valise"], "seules celles prises par Windows sont marquées");
  assert.equal(b.notifs[0].vue, "remy/c-regles");
  await b.tic();
  assert.equal(b.lectures.length, 1, "pas deux lectures dans la même minute");
  b.horloge.t += 60e3;
  await b.tic();
  assert.deepEqual(b.notifs.map((n) => n.titre).slice(2), ["Cette nuit, je creuse aussi ?"], "la refusée repart, une seule fois");
  assert.equal(b.notifs[2].vue, "aujourdhui/nuit/nuit-abc123def456");
  b.horloge.t += 60e3;
  await b.tic();
  assert.equal(b.notifs.length, 3, "rien de plus");
});

test("« Plus tard » sur un sujet de nuit : redit dans 3 heures, une fois, s'il attend toujours (delaiPlusTard de l'iPhone)", async () => {
  const b = banc();
  await b.tic();
  assert.equal(b.notifs.length, 3);
  const memoire = { lire: () => new Set(b.memoire), ecrire: () => {}, plusTard: () => new Map(b.plusTard), ecrirePlusTard: (m) => { b.plusTard.clear(); for (const [id, t] of m) b.plusTard.set(id, t); } };
  B.reporterProposition("nuit-abc123def456", { maintenant: b.horloge.t, memoire });
  assert.equal(b.plusTard.get("nuit-abc123def456"), b.horloge.t + B.PLUS_TARD_PROPOSITION);
  assert.equal(B.PLUS_TARD_PROPOSITION, 3 * H);
  for (const plus of [M, 2 * H, 2 * H + 59 * M]) {
    b.horloge.t = date(2026, 10, 29, 14) + plus;
    await b.tic();
  }
  assert.equal(b.notifs.length, 3, "pas avant 3 heures");
  b.horloge.t = date(2026, 10, 29, 17, 1);
  await b.tic();
  assert.deepEqual(b.notifs.slice(3).map((n) => [n.titre, n.vue]), [["Cette nuit, je creuse aussi ?", "aujourdhui/nuit/nuit-abc123def456"]], "redite une fois l'heure passée");
  assert.equal(b.plusTard.size, 0, "redite : le « plus tard » est oublié");
  b.horloge.t += M;
  await b.tic();
  assert.equal(b.notifs.length, 4, "une seule fois");
  // Remise à plus tard puis tranchée ailleurs : oubliée, rien ne part.
  B.reporterProposition("p-rasage", { maintenant: b.horloge.t, memoire });
  const sans = attente.filter((p) => p.id !== "p-rasage");
  const c = banc({ propositions: sans });
  for (const [id, t] of b.plusTard) c.plusTard.set(id, t);
  await c.tic();
  assert.equal(c.plusTard.has("p-rasage"), false, "plus en attente : oubliée");
  assert.deepEqual(B.propositionsADire(attente, { deja: new Set(["p-rasage"]), plusTard: new Map([["p-rasage", 5000]]), maintenant: 1000 }).garder, [], "remise à plus tard : plus comptée comme dite");
});

test("les propositions : coupées par la bascule, ou sur une tour sans propositions-attente-v1", async () => {
  const coupe = banc({ reglages: { propositions: false } });
  await coupe.tic();
  assert.equal(coupe.lectures.length, 0);
  const vieille = banc({ sait: () => false });
  await vieille.tic();
  assert.equal(vieille.lectures.length, 0, "rien n'est lu sur une tour qui ne sait pas");
  assert.equal(B.REGLAGES_PAR_DEFAUT.propositions, true, "allumées par défaut, comme sur l'iPhone");
});

test("session perdue pendant la lecture des propositions : la notification de reconnexion", async () => {
  const notifs = [];
  const tic = B.creerTic({
    horloge: () => date(2026, 10, 29, 14),
    reglages: () => ({ ...B.REGLAGES_PAR_DEFAUT, rappels: false }),
    memoire: { deja: () => new Set(), noter: () => {} },
    sait: () => true,
    memoirePropositions: { lire: () => new Set(), ecrire: () => {} },
    lire: async () => { throw Object.assign(new Error("Ta session a expiré : reconnecte-toi."), { nature: "auth", statut: 401 }); },
    notif: async (titre) => notifs.push(titre),
  });
  await tic();
  assert.deepEqual(notifs, ["Rémy est déconnecté"]);
});

test("activer le briefing : un essai de notification ; refusé par Windows, le réglage est remis et c'est dit", async () => {
  // Hors navigateur, le stockage local est absent : reglerNotifs n'écrit rien, il rend les réglages.
  const ok = await B.activerRituel("briefing", { essai: async (titre, corps, cle, vue) => {
    assert.equal(vue, "aujourdhui/briefing");
    assert.match(corps, /chaque matin à 7:30/);
  } });
  assert.deepEqual(ok, { ok: true, erreur: null });
  const non = await B.activerRituel("bilan", { essai: async () => { throw new Error("Windows a refusé la notification."); } });
  assert.equal(non.ok, false);
  assert.match(non.erreur, /Windows a refusé/);
  assert.match(B.REFUS_NOTIFICATIONS, /^Windows refuse les notifications de Rémy : autorise-les dans Paramètres › Système › Notifications/);
});

// --- Le contrat, contre les vraies routes de la tour ---

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-site-boite-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_GLM_URL", "CRON_SECRET"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
const store = await import("../lib/store.js");
const carnet = await import("../lib/carnet.js");
const { routeApi } = await import("../lib/routes.js");
const { CAPACITES } = await import("../lib/version.js");
const { db, fermer } = await import("../lib/db.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => {
  remy.close();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});
const appel = async (chemin, { methode = "GET", corps } = {}) => {
  const r = await fetch(base + chemin, { method: methode, headers: { Accept: "application/json", ...(corps !== undefined ? { "Content-Type": "application/json" } : {}) }, body: corps === undefined ? undefined : JSON.stringify(corps) });
  const t = await r.text();
  return { statut: r.status, corps: t ? JSON.parse(t) : null };
};

test("contrat : les capacités que la boîte et « À trancher » attendent sont annoncées", () => {
  for (const c of ["rituel-v1", "a-trancher-v1", "propositions-attente-v1", "conversations-externes-v1"]) assert.ok(CAPACITES.includes(c), c);
});

test("contrat : les sujets de la nuit (tableau), C'est fait puis Rouvrir, et un sujet inconnu refusé", async () => {
  await store.putBriefing("Voici ce que j'ai vu cette nuit.\n\n- Léa attend ta réponse pour samedi.\n- Le comptable attend depuis quatre jours.");
  const t = (await appel("/api/dashboard")).corps;
  assert.equal(t.systeme.reflexion, false, "sans CRON_SECRET : la préparation de nuit n'est pas active");
  const items = t.briefing.items;
  assert.equal(items.length, 2);
  assert.ok(items.every((s) => /^[a-f0-9]{10}$/.test(s.id) && s.etat === "ouvert"));
  assert.equal(R.compteOuverts(R.sujets(t.briefing)), 2);
  assert.ok(R.nuitRecente(t.briefing.generatedAt));
  const r = await appel("/api/briefing/etat", { methode: "PUT", corps: { id: items[0].id, etat: "traite" } });
  assert.equal(r.statut, 200);
  const apres = (await appel("/api/dashboard")).corps.briefing;
  assert.equal(apres.items.find((s) => s.id === items[0].id).etat, "traite", "le sujet réglé reste dans la liste");
  assert.equal(R.compteOuverts(R.sujets(apres)), 1);
  assert.equal((await appel("/api/briefing/etat", { methode: "PUT", corps: { id: items[0].id, etat: "ouvert" } })).statut, 200);
  const refus = await appel("/api/briefing/etat", { methode: "PUT", corps: { id: "pas-un-id", etat: "traite" } });
  assert.equal(refus.statut, 400);
  assert.ok(refus.corps.error, "une erreur que direErreur sait dire");
});

test("contrat : /api/rituel rend ce que lisent les trois lignes et le bilan ; le bilan se range", async () => {
  const r = (await appel("/api/rituel")).corps;
  const b = R.briefingDuJour(r, { luA: Date.now() });
  assert.ok(b, "le briefing d'aujourd'hui");
  for (const k of ["pour", "compte", "pourquoi", "menace"]) assert.equal(typeof b[k], "string", k);
  assert.ok(R.jourTitre(b).length);
  const s = R.soirDuJour(r, { luA: Date.now() });
  assert.ok(s && Array.isArray(s.fait) && Array.isArray(s.glisse) && Array.isArray(s.reste) && typeof s.phrase === "string");
  assert.ok("conversations" in r, "la ligne des conversations d'hier (null sans conversations)");
  const p = await appel("/api/rituel/bilan", { methode: "POST", corps: { ressenti: "Bonne journée." } });
  assert.equal(p.statut, 200);
  assert.equal(p.corps.phrase, "Bilan rangé : Rémy le relira cette nuit.");
});

test("contrat : « À trancher » groupé, un report et son annulation, la revue et ses décisions", async () => {
  carnet.ecrireRappels([{ id: "r-sans", texte: "Changer les essuie-glaces" }, { id: "r-passe", texte: "Payer le loyer", quand: Date.now() - 5 * H }]);
  // Un rappel sans date attend un geste au bout d'une semaine.
  db().prepare("UPDATE rappels SET cree_a = ? WHERE id = 'r-sans'").run(Date.now() - 9 * J);
  const v = (await appel("/api/a-trancher")).corps;
  assert.ok(Array.isArray(v.groupes) && Array.isArray(v.retards) && typeof v.reportes === "number");
  for (const g of v.groupes) {
    assert.ok(g.id && g.titre && typeof g.total === "number" && Array.isArray(g.lignes), JSON.stringify(g));
    for (const l of g.lignes) assert.ok(l.cle && R.GESTES_TRI[l.type], JSON.stringify(l));
  }
  const ligne = v.groupes.flatMap((g) => g.lignes).find((l) => l.rappelId === "r-sans");
  assert.ok(ligne, "le rappel sans date attend un geste");
  const rappels = (await appel("/api/rappels")).corps.rappels;
  assert.deepEqual(R.rappelsEnRetard(rappels).map((l) => l.rappelId), ["r-passe"], "le rappel passé est un retard");
  assert.equal(R.totalGroupes(R.filtrerGroupes(v.groupes, { rappels })), R.totalGroupes(v.groupes), "rien de réglé : le même compte");
  assert.equal((await appel("/api/a-trancher/reports", { methode: "POST", corps: { cle: ligne.cle, jours: 7 } })).statut, 200);
  const v2 = (await appel("/api/a-trancher")).corps;
  assert.equal(v2.reportes, 1);
  assert.ok(!v2.groupes.flatMap((g) => g.lignes).some((l) => l.cle === ligne.cle), "reportée : elle sort");
  assert.equal((await appel(`/api/a-trancher/reports/${encodeURIComponent(ligne.cle)}`, { methode: "DELETE" })).statut, 200);
  assert.ok((await appel("/api/a-trancher")).corps.groupes.flatMap((g) => g.lignes).some((l) => l.cle === ligne.cle), "Annuler : elle revient");
  // « Supprimer » puis « Annuler » : le même rappel revient (même identifiant).
  assert.equal((await appel("/api/rappels/r-sans", { methode: "DELETE" })).statut, 200);
  assert.equal((await appel("/api/rappels", { methode: "POST", corps: { rappels: [{ id: "r-sans", texte: "Changer les essuie-glaces", quand: null, fait: false, etiquettes: [] }] } })).statut, 200);
  assert.ok((await appel("/api/rappels")).corps.rappels.some((x) => x.id === "r-sans" && !x.supprime), "remis");

  const revue = (await appel("/api/revue")).corps;
  assert.ok(Array.isArray(revue.domaines) && Array.isArray(revue.appris) && Array.isArray(revue.decisions.liste));
  assert.match(R.resumeSemaine(revue), /^Cette semaine : /);
  const d = await appel("/api/revue/decisions", { methode: "PUT", corps: { decisions: R.decisionsPropres(["Finir la boutique", "", " Voir Léa "]) } });
  assert.equal(d.statut, 200);
  assert.deepEqual(d.corps.liste, ["Finir la boutique", "Voir Léa"]);
  assert.deepEqual((await appel("/api/revue")).corps.decisions.liste, ["Finir la boutique", "Voir Léa"], "pré-rempli à la prochaine ouverture");
});

test("contrat : les propositions en attente, et « Oui » à un sujet de nuit", async () => {
  await store.putReflectionSuggestions({ options: [{ sujet: "Compare deux fournisseurs de cire", pourquoi: "tu en as parlé deux fois" }] });
  const { propositions } = (await appel("/api/propositions/attente")).corps;
  const p = propositions.find((x) => x.origine === "nuit");
  assert.ok(p && p.sujet && p.id, JSON.stringify(propositions));
  assert.match(B.vueProposition(p), /^aujourdhui\/nuit\/nuit-[a-f0-9]{12}$/, "une vue que la coquille accepte");
  assert.equal(B.texteProposition(p).titre, "Cette nuit, je creuse aussi ?");
  const oui = await appel("/api/propositions/nuit", { methode: "POST", corps: { sujet: p.sujet } });
  assert.equal(oui.statut, 200);
  assert.ok(!(await appel("/api/propositions/attente")).corps.propositions.some((x) => x.id === p.id), "acceptée : elle n'attend plus");
  const inconnu = await appel("/api/propositions/nuit", { methode: "POST", corps: { sujet: "Un sujet jamais proposé" } });
  assert.equal(inconnu.statut, 404);
  assert.equal(inconnu.corps.message, "Ce sujet n'est plus proposé pour cette nuit.");
});

test("RÉGRESSION : « Oui » d'À trancher sur une carte de plus de 7 jours : un 409 que le site reconnaît, puis la confirmation passe", async () => {
  const maintenant = Date.now();
  await store.putConversation({ id: "c-vidange", title: "Vidange de la Twingo", createdAt: maintenant - 29 * J, updatedAt: maintenant - 29 * J, messages: [
    { role: "user", content: "Il faut faire la vidange." },
    { role: "assistant", content: "Je propose.", proposal: { id: "p-vidange", source: "motion", resume: "La vidange en deux temps", actions: [{ type: "creer", nom: "Vidange de la Twingo" }], statut: "en_attente" } },
  ] });
  // Le corps que trancher.js envoie au « Oui » d'une carte. Motion « connecté »
  // (le bac à sable refuse tout appel réel) : la péremption passe avant lui.
  const corps = { actions: [], convId: "c-vidange", propositionId: "p-vidange" };
  process.env.MOTION_API_KEY = "cle-de-test";
  try {
    const r = await appel("/api/motion/apply", { methode: "POST", corps });
    assert.equal(r.statut, 409, JSON.stringify(r.corps));
    assert.equal(r.corps.error, "perimee");
    assert.match(r.corps.message, /confirme pour l'appliquer/, "le motif qui ouvre « Proposition ancienne » au lieu d'un « Réessayer » sans fin");
    const c = await appel("/api/motion/apply", { methode: "POST", corps: { ...corps, confirmer: true } });
    assert.notEqual(c.statut, 409, `confirmée, la péremption ne la bloque plus : ${JSON.stringify(c.corps)}`);
  } finally {
    delete process.env.MOTION_API_KEY;
  }
  // Le site : la boîte de confirmation, le renvoi avec `confirmer`, et jamais « Réessayer » pour un 409.
  const vue = fs.readFileSync(new URL("../public/app/vues/trancher.js", import.meta.url), "utf8");
  assert.match(vue, /confirmerPerimee\(/);
  assert.match(vue, /\{ \.\.\.corps, confirmer: true \}/);
  assert.match(vue, /err\?\.statut === 409 && l\.convId\) dire\(/);
});
