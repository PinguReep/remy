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

// Le classement confirmé (« C'est ça ») : la musique, puis la boutique. Les proches sont écrits, pas classés ;
// l'atelier est relié à un projet mais pas confirmé : il n'a pas de rang.
const priorites = [
  { id: "p-musique", titre: "La musique", projetMotion: "p4", classee: true },
  { id: "p-atelier", titre: "Ranger l'atelier", projetMotion: "p9" },
  { id: "p-boutique", titre: "Lancer la boutique de bougies", projetMotion: "p1", classee: true },
  { id: "p-proches", titre: "Voir Léa et Hugo" },
];
const sansClassement = priorites.map(({ classee, ...p }) => p);

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

test("sans classement confirmé (une saisie, ou une proposition de Rémy), aucune ligne ne dit quelle priorité elle sert", () => {
  const v = H.prochainesHeures({ semaine, priorites: sansClassement, maintenant: MAINTENANT, cochees: new Set(["t5"]) });
  assert.ok(v.lignes.every((l) => !/priorité n°/.test(l.pourquoi) && l.rang === null));
  assert.equal(v.lignes.find((l) => l.id === "t2").pourquoi, "Rien ne la distingue : Motion l'a mise là");
  assert.equal(v.lignes.find((l) => l.id === "t4").pourquoi, "Pas avant aujourd'hui : sa date de début dans Motion");
  assert.equal(v.tranches.find((t) => t.id === "soir").projets[0].rang, null);
  assert.match(v.notes.map((n) => n.texte).join(" "), /pas encore confirmé/);
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
  assert.deepEqual([...H.rangsParProjet([{ titre: "A", projetMotion: "p1", classee: true }, { titre: "B", projetMotion: "p1", classee: true }]).entries()], [["p1", { rang: 1, titre: "A" }]], "deux priorités sur le même projet : la mieux classée");
  assert.deepEqual([...H.rangsParProjet(priorites).entries()].map(([id, r]) => [id, r.rang]), [["p4", 1], ["p1", 2]], "le rang se compte parmi les confirmées");
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
  assert.match(H.notesHeures({ sources: { motion: "ok" } }, null)[0].texte, /n'a pas pu être lu/);
  assert.match(H.notesHeures({ sources: { motion: "ok" } }, [{ titre: "A", classee: true }])[0].texte, /Aucune priorité de ton classement n'est reliée/, "classées, mais sans lien : où le faire");
  assert.match(H.notesHeures({ sources: { motion: "ok" } }, sansClassement)[0].texte, /pas encore confirmé/);
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

// --- La frise qui se parcourt (12/11, second lot) ---------------------------------------

// Le même jeudi, avec ce qui a été coché : par Rémy (le journal de la tour : une
// avec son créneau, une sans), et ici (la cochée t5, à 10:30).
const avecPasse = {
  ...semaine,
  jours: semaine.jours.map((j, k) => (k === 0 ? {
    ...j,
    faites: [
      { type: "tache", id: "f1", titre: "Répondre au devis du plombier", projet: null, a: at(0, 8, 52), debut: at(0, 7, 30), fin: at(0, 7, 50), duree: 20 },
      { type: "tache", id: "f2", titre: "Payer la cantine", projet: null, a: at(0, 10, 5) },
      // Cochée par Rémy ET encore dans la liste Motion lue : une seule ligne, faite.
      { type: "tache", id: "t2", titre: "Trier la boîte mail", a: at(0, 9) },
    ],
  } : { ...j, faites: [] })),
};
const vueComplete = (maintenant = MAINTENANT) => H.prochainesHeures({ semaine: avecPasse, priorites, maintenant, cochees: new Set(["t5"]), cocheesA: new Map([["t5", at(0, 10, 30)]]) });

test("la plage : aujourd'hui dès 7 h (plus tôt si quelque chose y est), jusqu'à demain 22 h, à l'heure ronde", () => {
  assert.deepEqual(H.plageFrise(MAINTENANT, []), { debut: at(0, 7), fin: at(1, 22) });
  assert.deepEqual(H.plageFrise(MAINTENANT, [{ debut: at(0, 6, 15), fin: at(0, 6, 40) }]), { debut: at(0, 6), fin: at(1, 22) });
  assert.deepEqual(H.plageFrise(MAINTENANT, [{ debut: at(1, 21), fin: at(1, 23, 20) }]), { debut: at(0, 7), fin: at(2, 0) }, "finit à 23 h 20 : jusqu'à minuit, pas au-delà");
  assert.deepEqual(H.plageFrise(MAINTENANT, [{ debut: at(-1, 22), fin: at(0, 1) }, { debut: at(3, 9), fin: at(3, 10) }]), { debut: at(0, 0), fin: at(1, 22) }, "hier et après-demain n'élargissent pas la frise au-delà de ses bornes");
  assert.deepEqual(H.plageFrise(at(0, 5, 30), []), { debut: at(0, 5), fin: at(1, 22) }, "levé à 5 h 30 : maintenant est dedans");
  assert.equal(H.phrasePlage({ debut: at(0, 7), fin: at(1, 22) }, MAINTENANT), "Aujourd'hui dès 7 h, jusqu'à demain 22 h");
  assert.equal(H.phrasePlage({ debut: at(0, 6), fin: at(2, 0) }, MAINTENANT), "Aujourd'hui dès 6 h, jusqu'à demain minuit");
});

test("le passé de la journée est là : fait (par Rémy, ici, une activité cochée) distingué de ce qui a glissé", () => {
  const v = vueComplete();
  const par = Object.fromEntries(v.toutes.map((l) => [l.id, l]));
  assert.deepEqual(v.plage, { debut: at(0, 7), fin: at(1, 22) });
  // Tout ce qui est dans la plage, passé et fait compris, dans l'ordre du temps ; t9 (demain 14 h) aussi.
  assert.deepEqual(v.toutes.map((l) => l.id), ["f1", "e1", "f2", "t1", "e2", "t2", "t3", "t5", "e3", "t4", "e6", "t7", "t8", "t9"]);
  // Le journal, à son créneau gardé.
  assert.equal(par.f1.fait, true);
  assert.equal(par.f1.statut, "Faite · cochée à 08:52");
  assert.equal(par.f1.gerable, false, "plus chez Motion : rien à gérer, l'Historique l'annule");
  assert.equal(par.f1.source, null);
  // Sans créneau gardé : une marque à l'heure de la coche, rien d'inventé.
  assert.equal(par.f2.ponctuel, true);
  assert.equal(par.f2.debut, at(0, 10, 5));
  assert.equal(par.f2.fin, at(0, 10, 5));
  assert.match(par.f2.statut, /^Cochée à 10:05 dans Rémy/);
  // Cochée par Rémy et encore lue chez Motion : une ligne, faite, à son créneau de Motion.
  assert.equal(v.toutes.filter((l) => l.id === "t2").length, 1);
  assert.equal(par.t2.fait, true);
  assert.equal(par.t2.debut, at(0, 14));
  // Cochée ici : faite, avec son heure.
  assert.equal(par.t5.statut, "Faite · cochée à 10:30");
  assert.equal(par.e3.fait, true, "l'aspirateur, coché dans Rémy");
  assert.equal(par.e3.gerable, true, "une activité faite se rouvre dans Gérer (« Pas encore terminée »)");
  // Passé sans coche : le rendez-vous de 9 h (une activité à soi), « pas cochée ».
  assert.equal(par.e1.etat, "passe");
  assert.equal(par.e1.issue, "pasCochee");
  assert.equal(par.e1.statut, "Passée, pas cochée");
  assert.equal(par.t1.etat, "encours");
  assert.deepEqual(v.bilanPasse, { faites: 5, pasCochees: 1, total: 6 });
  // Ce qui reste à faire ne change pas : la liste « prochaines heures » de toujours.
  assert.deepEqual(v.lignes.map((l) => l.id), ["t1", "e2", "t3", "t4", "e6", "t7", "t8"]);
  assert.equal(v.neRentrePas.some((t) => t.id === "t2"), false);
  // Un rendez-vous passé avec d'autres : passé, sans « pas coché ».
  const avecAutres = H.prochainesHeures({ semaine: { jours: [{ ...jourDe(0), items: [{ type: "rdv", id: "r", titre: "Point", avecAutres: true, debut: at(0, 8), fin: at(0, 9) }] }] }, maintenant: MAINTENANT });
  assert.deepEqual([avecAutres.toutes[0].issue, avecAutres.toutes[0].statut], [null, "Passé"]);
  // Une tâche dont le créneau est passé sans coche : elle a glissé.
  const glisse = H.prochainesHeures({ semaine: { jours: [{ ...jourDe(0), items: [{ type: "tache", id: "g", titre: "G", debut: at(0, 8), fin: at(0, 8, 30) }] }] }, maintenant: MAINTENANT });
  assert.equal(glisse.toutes[0].statut, "Créneau passé, pas cochée : Motion la replacera");
  assert.equal(glisse.vide, true);
  assert.equal(glisse.rienDuTout, false, "plus rien à venir, mais la journée n'est pas vide");
});

test("la liste : ce qui vient par tranche (en cours dans la tranche de maintenant), le passé et le fait à part", () => {
  const v = vueComplete();
  assert.deepEqual(v.groupes.aVenir.map((g) => [g.id, g.lignes.map((l) => l.id)]), [
    ["matin", ["t1"]], ["apresmidi", ["e2", "t3"]], ["soir", ["t4"]], ["demain", ["e6", "t7", "t8"]], ["demainApresmidi", ["t9"]],
  ]);
  assert.deepEqual(v.groupes.passees.map((g) => [g.id, g.lignes.map((l) => l.id)]), [["matin", ["f1", "e1", "f2"]], ["apresmidi", ["t2"]], ["soir", ["t5", "e3"]]]);
  // Commencée à 11 h 30, en cours à 12 h 10 : dans « Cet après-midi », pas dans un matin fini.
  const midi = H.prochainesHeures({ semaine: { jours: [{ ...jourDe(0), items: [{ type: "tache", id: "x", titre: "x", debut: at(0, 11, 30), fin: at(0, 12, 30) }] }] }, maintenant: at(0, 12, 10) });
  assert.deepEqual(midi.groupes.aVenir.map((g) => [g.id, g.etat, g.lignes.map((l) => l.id)]), [["apresmidi", "encours", ["x"]]]);
});

test("la frise en pixels : l'échelle, l'aller-retour pixel ↔ heure, la nuit resserrée, maintenant", () => {
  const v = vueComplete();
  const g = H.friseDe(v.toutes, v.plage, MAINTENANT, { pxParHeure: 120 });
  // 7 h → 23 h (16 h), la nuit resserrée (1 h), 7 h → 22 h (15 h) : 32 h dessinées.
  assert.equal(g.total, 32 * 120);
  assert.equal(g.x(v.plage.debut), 0);
  assert.equal(g.x(v.plage.fin), g.total);
  assert.ok(Math.abs(g.maintenant - (3 + 47 / 60) * 120) < 1e-6, "10:47 : 3 h 47 après 7 h");
  for (const t of [at(0, 7), at(0, 10, 47), at(0, 23), at(1, 2), at(1, 7), at(1, 18, 30)]) assert.ok(Math.abs(g.temps(g.x(t)) - t) < 1000, `aller-retour ${new Date(t).toISOString()}`);
  assert.ok(Math.abs(g.demain - (16 + 1 / 8) * 120) < 1e-6, "minuit : au huitième de la nuit resserrée (23 h → 7 h)");
  assert.ok(g.heures.every((r) => r.ms <= at(0, 23) || r.ms >= at(1, 7)), "aucune heure dans la nuit");
  assert.equal(g.heures[0].libelle, "7h", "la première heure, au bord gauche");
  // L'étiquette d'une heure ne passe pas sous la pastille de maintenant : à 10:55, « 11h » (8 px à droite) est masquée.
  const masques = (m) => Object.fromEntries(H.friseDe(v.toutes, v.plage, m, { pxParHeure: 120 }).heures.filter((r) => r.ms < at(1, 0)).map((r) => [r.libelle, r.masque]));
  assert.deepEqual([masques(at(0, 10, 55))["10h"], masques(at(0, 10, 55))["11h"], masques(at(0, 10, 55))["12h"]], [false, true, false]);
  assert.deepEqual(Object.values(masques(MAINTENANT)).filter(Boolean), [], "à 10:47, la pastille tient entre 10h et 11h");
});

test("les blocs : la largeur dit la durée, deux qui se chevauchent sont l'un sur l'autre, aucune zone de clic sous 44 px", () => {
  const ligne = (id, h0, m0, h1, m1, extra = {}) => ({ cle: `tache:${id}`, type: "tache", id, debut: at(0, h0, m0), fin: at(0, h1, m1), ...extra });
  const toutes = [
    ligne("long", 9, 0, 10, 30), // 1 h 30 : 180 px à 120 px/h
    ligne("court", 11, 0, 11, 10), // 10 min : 20 px dessinés, 44 px de zone
    ligne("a", 13, 0, 13, 15), ligne("b", 13, 15, 13, 30), // collées, 15 min chacune (30 px)
    ligne("p1", 15, 0, 16, 0), ligne("p2", 15, 30, 16, 30), // qui se chevauchent
    { cle: "tache:coche", type: "tache", id: "coche", debut: at(0, 17), fin: at(0, 17), ponctuel: true },
  ];
  const g = H.friseDe(toutes, { debut: at(0, 7), fin: at(0, 22) }, at(0, 8), { pxParHeure: 120, cible: 44 });
  const b = (id) => g.parCle.get(`tache:${id}`);
  assert.equal(b("long").x1 - b("long").x0, 180);
  assert.equal(b("long").etiquette, "complete");
  assert.equal(b("court").x1 - b("court").x0, 20);
  assert.equal(b("court").etiquette, "icone", "trop étroit pour un titre lisible : son icône seule");
  assert.equal(b("court").hit1 - b("court").hit0, 44);
  assert.ok(b("court").hit0 <= b("court").x0 && b("court").hit1 >= b("court").x1, "la zone contient le dessin");
  // Collées : chacune s'étend du côté libre, sans empiéter sur l'autre.
  assert.ok(b("a").hit1 <= b("b").hit0, "pas de chevauchement des zones");
  assert.ok(b("a").hit1 - b("a").hit0 >= 44 && b("b").hit1 - b("b").hit0 >= 44, `a ${b("a").hit1 - b("a").hit0}, b ${b("b").hit1 - b("b").hit0}`);
  assert.deepEqual([b("p1").couloir, b("p1").couloirs, b("p2").couloir, b("p2").couloirs], [0, 2, 1, 2]);
  assert.equal(b("p1").etiquette, "titre", "à deux étages : le titre seul");
  assert.equal(b("long").couloirs, 1);
  assert.equal(b("coche").x1 - b("coche").x0, 20, "une coche sans créneau : une marque, pas une durée");
  assert.ok(b("coche").hit1 - b("coche").hit0 >= 44);
  // Trois blocs de 5 min serrés : la zone ne déborde jamais sur un voisin (au pire, sous 44 px ; dit dans le journal).
  const serres = ["x", "y", "z"].map((id, i) => ligne(id, 18, i * 5, 18, i * 5 + 5));
  const s = H.friseDe(serres, { debut: at(0, 7), fin: at(0, 22) }, at(0, 8), { pxParHeure: 120 });
  const z = serres.map((l) => s.parCle.get(l.cle));
  assert.ok(z[0].hit1 <= z[1].hit0 && z[1].hit1 <= z[2].hit0);
});

test("centrer, viser un moment, et la phrase qui le dit", () => {
  assert.equal(H.defilementPour(1000, 800, 4000), 600, "maintenant au milieu");
  assert.equal(H.defilementPour(100, 800, 4000), 0, "tout au début : borné");
  assert.equal(H.defilementPour(3900, 800, 4000), 3200, "tout à la fin : borné");
  assert.equal(H.defilementPour(100, 800, 500), 0, "une frise plus courte que la vue");
  const v = vueComplete();
  const r = H.ligneA(v.toutes, at(0, 11));
  assert.equal(r.ligne.id, "t1");
  assert.equal(r.exact, true);
  assert.equal(H.phraseMoment(at(0, 11), r), "11:00 · « Finaliser la démo de la boutique » (10:27 – 11:42)");
  const creux = H.ligneA(v.toutes, at(0, 11, 50));
  assert.deepEqual([creux.ligne.id, creux.exact, creux.sens], ["e2", false, "apres"]);
  assert.equal(H.phraseMoment(at(0, 11, 50), creux), "11:50 · rien de prévu ; ensuite « Déjeuner avec Léa » à 12:30");
  const coche = H.ligneA(v.toutes, at(0, 10, 10));
  assert.equal(coche.ligne.id, "f2", "une coche sans créneau se vise à 10 min près");
  assert.match(H.phraseMoment(at(0, 10, 10), coche), /^10:10 · « Payer la cantine », cochée à 10:05/);
  const tard = H.ligneA(v.toutes, at(1, 21));
  assert.deepEqual([tard.ligne.id, tard.sens], ["t9", "avant"]);
  assert.equal(H.phraseMoment(at(1, 21), tard), "21:00 · plus rien après « Commander les mèches » (fini à 14:30)");
  assert.equal(H.ligneA([], at(0, 12)), null);
  assert.equal(H.phraseMoment(at(0, 12), null), "12:00 · rien de prévu");
  // Ce qui reste à faire passe devant ce qui est fait au même moment.
  const deux = [{ cle: "a", id: "a", type: "tache", debut: at(0, 9), fin: at(0, 10), fait: true }, { cle: "b", id: "b", type: "tache", debut: at(0, 9), fin: at(0, 10), fait: false }];
  assert.equal(H.ligneA(deux, at(0, 9, 30)).ligne.id, "b");
  // Le point de départ (focus, sélection) et la voisine au clavier.
  assert.equal(H.ligneCourante(v.toutes, MAINTENANT).id, "t1");
  assert.equal(H.ligneCourante(vueComplete(at(1, 23)).toutes, at(1, 23)).id, "t9", "plus rien après : la dernière");
  assert.equal(H.voisine(v.toutes, "tache:t1", -1).id, "f2");
  assert.equal(H.voisine(v.toutes, "tache:t1", 1).id, "e2");
  assert.equal(H.voisine(v.toutes, "tache:f1", -1).id, "f1", "au bout : on y reste");
});

test("glisser n'est pas cliquer : le seuil, la vitesse au lâcher, l'inertie qui s'arrête", () => {
  assert.equal(H.estGlisser(3, 2, "mouse"), false, "un clic qui tremble reste un clic");
  assert.equal(H.estGlisser(6, 0, "mouse"), true);
  assert.equal(H.estGlisser(8, 0, "touch"), false, "le doigt tremble plus");
  assert.equal(H.estGlisser(0, 10, "touch"), true);
  // Vitesse : sur les 100 dernières ms ; immobile avant de lâcher, 0.
  const e = [{ t: 0, x: 0 }, { t: 50, x: 40 }, { t: 100, x: 100 }, { t: 116, x: 120 }];
  assert.ok(Math.abs(H.vitesseRelachee(e, 120) - 80 / 66) < 1e-9, "de t = 50 à t = 116");
  assert.equal(H.vitesseRelachee(e, 400), 0, "tenu immobile avant de lâcher");
  assert.equal(H.vitesseRelachee([{ t: 0, x: 0 }, { t: 10, x: 500 }], 12), 3, "bornée");
  assert.equal(H.vitesseRelachee([], 0), 0);
  // L'inertie freine et s'arrête : en moins de 2 s, sur une distance bornée.
  let v = 2;
  let d = 0;
  let pas = 0;
  while (v !== 0 && pas < 500) {
    const r = H.pasInertie(v, 16);
    d += r.dx;
    v = r.v;
    pas++;
  }
  assert.ok(pas < 125, `${pas} images`);
  assert.ok(d > 200 && d < 600, `${Math.round(d)} px`);
  assert.ok(Math.abs(H.pasInertie(-2, 16).dx + H.pasInertie(2, 16).dx) < 1e-12, "symétrique");
});
