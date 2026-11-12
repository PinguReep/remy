// « Prochaines heures » sur le site (public/app/analyse/heures.js) : de
// maintenant à demain midi, les lignes dans l'ordre de Motion, une phrase de
// « pourquoi » tirée des seuls faits (jamais d'une raison inventée), « sert ta
// priorité n°k » par l'identifiant du projet Motion, les minutes par projet et
// par tranche, ce qui ne rentre pas avant demain midi, et la frise à la nuit
// resserrée. Données fictives (Sam, Boutiques, Musique).
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";

const H = await import("../public/app/analyse/heures.js");

const M = 60e3;
// Jeudi 12 novembre 2026, 10:47 à Paris.
const MAINTENANT = new Date(2026, 10, 12, 10, 47).getTime();
const at = (jour, h, m = 0) => new Date(2026, 10, 12 + jour, h, m).getTime();
const jourDe = (k) => ({ jour: `2026-11-${12 + k}`, debut: at(k, 0), fin: at(k + 1, 0) });

const priorites = [
  { id: "p-musique", titre: "La musique", projetMotion: "p4" },
  { id: "p-boutique", titre: "Lancer la boutique de bougies", projetMotion: "p1" },
  { id: "p-proches", titre: "Voir Léa et Hugo" },
];

const semaine = {
  sources: { motion: "ok", agenda: "ok" },
  jours: [
    { ...jourDe(0),
      items: [
        // Commencée il y a 20 min : la ligne « en cours ».
        { type: "tache", id: "t1", titre: "Finaliser la démo de la boutique", projet: "Boutiques", projetId: "p1", priorite: "HIGH", duree: 75, debut: at(0, 10, 27), fin: at(0, 11, 42), echeance: at(0, 15), deadlineType: "HARD" },
        // Passée : n'apparaît pas.
        { type: "rdv", id: "e1", titre: "Podologue", debut: at(0, 9), fin: at(0, 9, 45) },
        { type: "rdv", id: "e2", titre: "Déjeuner avec Léa", debut: at(0, 12, 30), fin: at(0, 13, 45), avecAutres: true },
        // Rien ne la distingue : pas d'échéance, priorité moyenne, pas de projet relié.
        { type: "tache", id: "t2", titre: "Trier la boîte mail", projet: "Admin", projetId: "p9", priorite: "MEDIUM", duree: 30, debut: at(0, 14), fin: at(0, 14, 30) },
        // Placée après son échéance.
        { type: "tache", id: "t3", titre: "Envoyer les visuels à l'imprimeur", projet: "Boutiques", projetId: "p1", priorite: "HIGH", duree: 60, debut: at(0, 16), fin: at(0, 17), echeance: at(0, 15, 30), apresEcheance: true },
        { type: "rdv", id: "e3", titre: "Aspirateur", debut: at(0, 19, 30), fin: at(0, 20), fait: true },
        // Ce soir, la musique (projet relié à la priorité n°1), pas avant aujourd'hui.
        { type: "tache", id: "t4", titre: "Répéter le morceau pour samedi", projet: "Musique", projetId: "p4", duree: 45, debut: at(0, 21), fin: at(0, 21, 45), startOn: "2026-11-12" },
        // Cochée ici, pas encore partie : n'apparaît pas.
        { type: "tache", id: "t5", titre: "Arroser les plantes", duree: 10, debut: at(0, 18), fin: at(0, 18, 10) },
      ],
      toute: [{ type: "rdv", id: "e4", titre: "Salon du design" }],
      echeances: [
        { id: "t1", titre: "Finaliser la démo de la boutique", echeance: at(0, 15), placee: true, menacee: false },
        { id: "t3", titre: "Envoyer les visuels à l'imprimeur", echeance: at(0, 15, 30), placee: true, menacee: true, projet: "Boutiques" },
        // Due ce soir, jamais placée par Motion.
        { id: "t6", titre: "Préparer la facture Ondine", echeance: at(0, 17), placee: false, menacee: true },
      ],
      deborde: [{ id: "t3", titre: "Envoyer les visuels à l'imprimeur", echeance: at(0, 15, 30), fin: at(0, 17) }],
    },
    { ...jourDe(1),
      items: [
        { type: "rdv", id: "e6", titre: "Kiné", debut: at(1, 8), fin: at(1, 8, 45) },
        { type: "tache", id: "t7", titre: "Préparer la réunion fournisseurs", projet: "Boutiques", projetId: "p1", duree: 90, debut: at(1, 9, 30), fin: at(1, 11), echeance: at(1, 18), priorite: "MEDIUM" },
        // Commence avant midi, finit après : elle compte jusqu'à midi seulement.
        { type: "tache", id: "t8", titre: "Écrire la newsletter", projet: "Boutiques", projetId: "p1", duree: 120, debut: at(1, 11, 30), fin: at(1, 13, 30), echeance: at(1, 9) , apresEcheance: true },
        // Après demain midi : hors de la feuille.
        { type: "tache", id: "t9", titre: "Commander les mèches", projet: "Boutiques", projetId: "p1", duree: 30, debut: at(1, 14), fin: at(1, 14, 30) },
      ],
      toute: [{ type: "rdv", id: "e4", titre: "Salon du design" }],
      echeances: [{ id: "t8", titre: "Écrire la newsletter", echeance: at(1, 9), placee: true, menacee: true }],
      deborde: [],
    },
  ],
};

const vue = () => H.prochainesHeures({ semaine, priorites, maintenant: MAINTENANT, cochees: new Set(["t5"]) });

test("les lignes : de maintenant à demain midi, dans l'ordre de Motion, sans le passé, le fait, le coché ni l'après-midi de demain", () => {
  const v = vue();
  assert.deepEqual(v.lignes.map((l) => l.id), ["t1", "e2", "t2", "t3", "t4", "e6", "t7", "t8"]);
  assert.equal(v.enCours.id, "t1");
  assert.equal(v.ensuite.id, "e2");
  assert.equal(v.fin, at(1, 12));
  assert.deepEqual(v.toute, ["Salon du design"], "une fois, même sur deux jours");
  assert.equal(H.phraseTete(v, MAINTENANT), "En ce moment : « Finaliser la démo de la boutique », jusqu'à 11:42, ensuite : « Déjeuner avec Léa » à 12:30.");
});

test("le pourquoi ne dit que des faits, et avoue quand rien ne distingue une ligne", () => {
  const par = Object.fromEntries(vue().lignes.map((l) => [l.id, l.pourquoi]));
  assert.equal(par.t1, "Sert ta priorité n°2 (« Lancer la boutique de bougies ») · Échéance ferme aujourd'hui à 15:00 · Priorité Motion : haute");
  assert.equal(par.e2, "Rendez-vous à heure fixe, avec d'autres : Motion place le reste autour");
  assert.equal(par.e6, "À heure fixe dans ton agenda : Motion place le reste autour");
  assert.equal(par.t2, "Rien ne la distingue : Motion l'a mise là", "un projet qui n'est relié à aucune priorité ne compte pas");
  assert.equal(par.t3, "Menacée : Motion la finit après son échéance (aujourd'hui à 15:30) · Sert ta priorité n°2 (« Lancer la boutique de bougies ») · Priorité Motion : haute");
  assert.equal(par.t4, "Sert ta priorité n°1 (« La musique ») · Pas avant aujourd'hui : sa date de début dans Motion");
  assert.equal(par.t7, "Sert ta priorité n°2 (« Lancer la boutique de bougies ») · Due demain à 18:00");
  const t3 = vue().lignes.find((l) => l.id === "t3");
  assert.equal(t3.menace, true);
  assert.equal(t3.rang, 2);
});

test("les faits, un à un : échéance souple lointaine, sans échéance, ASAP, en retard, en attente", () => {
  const f = (e) => H.pourquoi(H.faitsDe({ type: "tache", id: "x", titre: "x", debut: at(0, 15), fin: at(0, 16), ...e }, { maintenant: MAINTENANT }));
  assert.equal(f({ echeance: at(20, 18) }), "Rien ne la distingue : Motion l'a mise là", "due dans trois semaines : ne dit rien de ce créneau");
  assert.equal(f({ echeance: at(20, 18), deadlineType: "HARD" }), "Échéance ferme mer 2 à 18:00");
  assert.equal(f({ echeance: at(0, 18), deadlineType: "NONE" }), "Rien ne la distingue : Motion l'a mise là", "« pas d'échéance » pour Motion");
  assert.equal(f({ priorite: "ASAP" }), "Priorité Motion : au plus vite");
  assert.equal(f({ echeance: at(-1, 18), retard: true }), "En retard : elle était due hier à 18:00");
  assert.equal(f({ bloquee: true, raison: "J'attends le devis de Hugo" }), "En attente : J'attends le devis de Hugo");
  assert.equal(f({ startOn: "2026-11-10" }), "Rien ne la distingue : Motion l'a mise là", "une date de début passée n'explique rien");
  // Sans le classement, plus de « sert ta priorité » ; une priorité sans lien ne relie rien.
  assert.equal(H.rangsParProjet(null).size, 0);
  assert.deepEqual([...H.rangsParProjet([{ titre: "A", projetMotion: "p1" }, { titre: "B", projetMotion: "p1" }]).entries()], [["p1", { rang: 1, titre: "A" }]], "deux priorités sur le même projet : la mieux classée");
});

test("les minutes par projet et par tranche (au prorata d'une tâche étalée, rendez-vous à part)", () => {
  const v = vue();
  assert.deepEqual(v.tranches.map((t) => t.id), ["matin", "apresmidi", "soir", "demain"]);
  const [matin, aprem, soir, demain] = v.tranches;
  assert.equal(matin.debut, MAINTENANT, "la tranche en cours commence maintenant");
  assert.deepEqual(matin.lignes.map((l) => l.id), ["t1"]);
  // 10:47 → 11:42 de « Finaliser la démo » (75 min sur 75 min : pas étalée).
  assert.deepEqual(matin.projets, [{ cle: "id:p1", nom: "Boutiques", minutes: 55, rang: 2 }]);
  assert.deepEqual(aprem.projets.map((p) => [p.nom, p.minutes]), [["Boutiques", 60], ["Admin", 30]]);
  assert.equal(aprem.minutesRdv, 75);
  assert.equal(H.phraseTranche(aprem), "Boutiques 1 h · Admin 30 min · rendez-vous 1 h 15");
  assert.deepEqual(soir.projets.map((p) => [p.nom, p.minutes, p.rang]), [["Musique", 45, 1]]);
  assert.equal(H.heuresTranche(soir), "18:00 – minuit");
  // Demain : réunion 90 min + newsletter 30 min avant midi (2 h prévues sur 2 h : pas étalée), kiné 45 min.
  assert.deepEqual(demain.projets.map((p) => [p.nom, p.minutes]), [["Boutiques", 120]]);
  assert.equal(demain.minutesRdv, 45);
  // Étalée : 60 min de travail sur un créneau de 2 h, moitié dans la tranche.
  const etale = H.prochainesHeures({ semaine: { jours: [{ ...jourDe(0), items: [{ type: "tache", id: "z", titre: "z", projet: "P", duree: 60, debut: at(0, 17), fin: at(0, 19) }] }] }, priorites: [], maintenant: MAINTENANT });
  assert.equal(etale.tranches.find((t) => t.id === "apresmidi").projets[0].minutes, 30);
  assert.equal(etale.tranches.find((t) => t.id === "soir").projets[0].minutes, 30);
  assert.equal(H.phraseTranche({ projets: [], minutesRdv: 0 }), "Rien de placé");
});

test("les tranches selon l'heure : l'après-midi n'a plus de matin, le soir n'a que ce soir et demain matin", () => {
  assert.deepEqual(H.tranchesDe(at(0, 14)).map((t) => t.id), ["apresmidi", "soir", "demain"]);
  assert.deepEqual(H.tranchesDe(at(0, 20, 15)).map((t) => [t.id, t.debut]), [["soir", at(0, 20, 15)], ["demain", at(1, 0)]]);
});

test("ce qui ne rentre pas avant demain midi : seulement ce que Motion dit (pas placée, ou finie après l'échéance)", () => {
  const v = vue();
  assert.deepEqual(v.neRentrePas.map((t) => [t.id, t.texte]), [
    ["t3", "Due aujourd'hui à 15:30 : Motion la finit après, aujourd'hui à 17:00"],
    ["t6", "Due aujourd'hui à 17:00 : Motion ne l'a pas encore placée"],
    ["t8", "Due demain à 09:00 : Motion la finit après, demain à 13:30"],
  ]);
  // Déjà en retard (échéance passée) : pas « ne rentre pas », c'est la liste des retards.
  const retard = H.prochainesHeures({ semaine: { jours: [{ ...jourDe(0), items: [], echeances: [{ id: "r", titre: "r", echeance: at(0, 9), placee: false, menacee: true }] }] }, maintenant: MAINTENANT });
  assert.deepEqual(retard.neRentrePas, []);
  assert.equal(retard.vide, true);
});

test("vide, Motion absent ou en panne, priorités illisibles ou sans lien : la feuille le dit", () => {
  const vide = H.prochainesHeures({ semaine: { sources: { motion: "ok", agenda: "ok" }, jours: [{ ...jourDe(0), items: [] }, { ...jourDe(1), items: [] }] }, priorites, maintenant: MAINTENANT });
  assert.equal(vide.vide, true);
  assert.deepEqual(vide.notes, []);
  const sansMotion = H.notesHeures({ sources: { motion: "off", agenda: "ok" } }, []);
  assert.deepEqual(sansMotion.map((n) => n.texte), ["Motion n'est pas relié à ta tour : seuls tes rendez-vous apparaissent ici."]);
  assert.equal(H.notesHeures({ sources: { motion: "erreur", agenda: "erreur" } }, priorites).filter((n) => n.alerte).length, 2);
  assert.match(H.notesHeures({ sources: { motion: "ok" } }, null)[0].texte, /n'ont pas pu être lues/);
  assert.equal(H.notesHeures({ sources: { motion: "ok" } }, [{ titre: "A" }])[0].reglage, true, "aucune priorité reliée : où le faire");
  assert.equal(H.semaineLisible({ jours: [] }), true);
  assert.equal(H.semaineLisible("<html>"), false);
  assert.equal(H.semaineLisible({ erreur: "x" }), false);
  // Des éléments abîmés sont sautés, la feuille s'affiche quand même.
  const abime = H.prochainesHeures({ semaine: { jours: [{ ...jourDe(0), items: [null, { type: "tache", titre: "sans id", debut: at(0, 15) }, { type: "tache", id: "ok", titre: "Ok", debut: at(0, 15), fin: at(0, 15, 30) }] }, { jour: 3 }] }, maintenant: MAINTENANT });
  assert.deepEqual(abime.lignes.map((l) => l.id), ["ok"]);
});

test("une tâche à cheval sur minuit : une seule ligne", () => {
  const e = { type: "tache", id: "nuit", titre: "Rendre le mémoire", duree: 120, debut: at(0, 23), fin: at(1, 1) };
  const v = H.prochainesHeures({ semaine: { jours: [{ ...jourDe(0), items: [e] }, { ...jourDe(1), items: [e] }] }, maintenant: MAINTENANT });
  assert.deepEqual(v.lignes.map((l) => l.id), ["nuit"]);
  assert.equal(v.tranches.find((t) => t.id === "soir").projets[0].minutes, 60);
  assert.equal(v.tranches.find((t) => t.id === "demain").projets[0].minutes, 60);
});

test("la frise : de maintenant à demain midi, la nuit vide resserrée à la place d'une heure", () => {
  const v = vue();
  const f = H.echelleFrise(v.lignes, v.debut, v.fin);
  assert.equal(f.pos(v.debut), 0);
  assert.equal(f.pos(v.fin), 1);
  // Creux de 23:00 (après la musique) à 07:00 demain (avant le kiné, 8 h) : resserré.
  assert.equal(f.nuit.debut, at(0, 23));
  assert.equal(f.nuit.fin, at(1, 7));
  // 12 h 13 de jour aujourd'hui + 1 h de nuit + 5 h demain = 1093 min dessinées.
  assert.ok(Math.abs(f.pos(at(0, 23)) - 733 / 1093) < 1e-9);
  assert.ok(f.pos(at(1, 8)) > f.pos(at(0, 23)), "l'ordre du temps est gardé");
  assert.ok(f.heures.every((x) => x.ms <= f.nuit.debut || x.ms >= f.nuit.fin), "pas de repère dans la nuit resserrée");
  assert.equal(f.heures[0].libelle, "11h");
  // Une tâche à 3 h du matin : le creux le plus long est gardé, s'il fait 3 h ou plus.
  const tard = H.echelleFrise([{ debut: at(1, 2), fin: at(1, 3) }], MAINTENANT, at(1, 12));
  assert.deepEqual([tard.nuit.debut, tard.nuit.fin], [at(1, 3), at(1, 7)], "de 3 h à 7 h, plus long que de 23 h à 2 h");
  const pleine = H.echelleFrise([{ debut: at(0, 23), fin: at(1, 6) }], MAINTENANT, at(1, 12));
  assert.equal(pleine.nuit, null, "une nuit occupée n'est pas resserrée");
});
