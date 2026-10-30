// Le site et la conversation avec Rémy (lot « chat », 29/10) : la vue
// (public/app/vues/remy.js) calcule avec public/app/analyse/remy.js, qui dit
// les mêmes choses que l'iPhone (JaugeTests, EtapesTests, ConversationTests,
// AllegementTests, CoeurTests, SelectionTests, PriveeTests). Ici :
// - les calculs et les phrases, cas par cas (module pur) ;
// - le contrat : les chemins que la vue appelle, joués contre les vraies
//   routes de la tour (lib/routes.js), rendent ce qu'elle lit.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const R = await import("../public/app/analyse/remy.js");

const date = (j, m, h, mi = 0, an = 2026) => new Date(an, m - 1, j, h, mi, 0, 0);
const ms = (j, m, h, mi = 0) => date(j, m, h, mi).getTime();

// --- La jauge (JaugeTests.swift) ---

const reponse = (mesures) => ({ role: "assistant", content: "x", mesures });

test("jauge : les mesures exactes de la dernière réponse, niveau calme", () => {
  const j = R.jauge([{ role: "user", content: "Un créneau ?" },
    reponse({ jetons: 120, tps: 40, decodeMs: 3000, premierMs: 1800, contexte: 42500, fenetre: 131072, fenetreSource: "modele", repartition: { systeme: 31000, conversation: 9000, outils: 2380, reponse: 120 } })]);
  assert.equal(j.contexte, 42500);
  assert.ok(Math.abs(j.fraction - 42500 / 131072) < 1e-4);
  assert.equal(j.niveau, "calme");
  assert.equal(j.derniere.premier, 1.8);
  assert.equal(j.repartition.systeme, 31000);
});

test("jauge : une tour ancienne n'a pas de jauge", () => {
  const j = R.jauge([{ role: "user", content: "Ça va ?" }, { role: "assistant", content: "Oui." }]);
  assert.ok(j.vide);
  assert.equal(j.fraction, null);
  assert.equal(R.court(j), "–");
  assert.equal(R.lu(j), "pas encore mesuré");
});

test("jauge : la moyenne est pondérée par le temps d'écriture", () => {
  // 100 jetons en 1 s puis 900 en 30 s : 1000 jetons en 31 s ≈ 32 tok/s, pas 65.
  const j = R.jauge([
    { role: "user", content: "a" },
    reponse({ jetons: 100, tps: 100, decodeMs: 1000, premierMs: 1000, contexte: 9000 }),
    { role: "user", content: "c" },
    reponse({ jetons: 900, tps: 30, decodeMs: 30000, premierMs: 3000, contexte: 10000, fenetre: 10500 }),
    { role: "assistant", content: "e (réponse de Claude, sans mesure)" },
  ]);
  assert.equal(j.reponsesMesurees, 2);
  assert.equal(j.derniere.tps, 30);
  assert.ok(Math.abs(j.moyenne.tps - 1000 / 31) < 1e-3);
  assert.equal(j.moyenne.premier, 2);
  assert.equal(j.contexte, 10000, "la dernière réponse mesurée");
  assert.equal(j.niveau, "plein");
  assert.equal(R.detailMoyenne(j), "sur 2 réponses · 1,0 k tokens · premier mot après 2,0 s en moyenne");
});

test("jauge : sans taille connue, rien d'inventé (« – », « taille maximale inconnue », REMY_GLM_CONTEXTE)", () => {
  const j = R.jauge([reponse({ contexte: 52000 })]);
  assert.equal(j.contexte, 52000);
  assert.equal(j.fraction, null);
  assert.equal(j.derniere, null);
  assert.ok(!j.vide);
  assert.equal(j.niveau, "calme");
  assert.equal(R.court(j), "52k");
  assert.equal(R.lu(j), "52,0 k tokens utilisés");
  assert.equal(R.surFenetre(j), "taille maximale inconnue");
  assert.deepEqual(R.noteJauge(j).slice(1), ["Le modèle ne déclare pas sa taille maximale : elle se règle sur la tour (REMY_GLM_CONTEXTE)."]);
  assert.equal(R.court(R.jauge([reponse({ contexte: 850 })])), "850");
  // Une mesure lue sur la tour : la taille réglée sur la tour le dit.
  const reglee = R.jauge([{ role: "user", content: "a" }, reponse({ jetons: 50, tps: 25, decodeMs: 2000, contexte: 8000, fenetre: 65536, fenetreSource: "reglage" })]);
  assert.equal(reglee.derniere.tps, 25);
  assert.ok(reglee.fenetreReglee);
  assert.deepEqual(R.noteJauge(reglee).slice(1), ["Taille maximale réglée sur la tour."]);
  assert.equal(R.surFenetre(reglee), "sur 65,5 k que Rémy peut avoir en tête");
});

test("jauge : niveaux 70 % et 90 %, phrases et bouton court", () => {
  const a = R.jauge([reponse({ contexte: 75000, fenetre: 100000 })]);
  assert.equal(a.niveau, "attention");
  assert.equal(R.phraseNiveau(a), "Ça se remplit : au-delà de 90 %, mieux vaut repartir d'une conversation neuve.");
  assert.equal(R.court(a), "75");
  const p = R.jauge([reponse({ contexte: 95000, fenetre: 100000 })]);
  assert.equal(p.niveau, "plein");
  assert.equal(R.phraseNiveau(p), "Presque plein : une nouvelle conversation gardera des réponses rapides et justes.");
  assert.equal(R.phraseNiveau(R.jauge([reponse({ contexte: 1000, fenetre: 100000 })])), null);
  assert.equal(R.lu(a), "75 % utilisés");
  // Une réponse en erreur (locale) ne compte pas.
  assert.equal(R.jauge([reponse({ contexte: 1000, fenetre: 100000 }), { role: "assistant", _local: true, mesures: { contexte: 99000, fenetre: 100000 } }]).contexte, 1000);
});

test("jauge : pas encore mesuré, selon le cas", () => {
  assert.equal(R.pasEncoreMesure({ envoi: true }), "La mesure arrive à la fin de la réponse de Rémy.");
  assert.equal(R.pasEncoreMesure({ machine: "API Anthropic" }), "Cette réponse vient de Claude : la place n'est mesurée que sur le modèle local.");
  assert.equal(R.pasEncoreMesure({}), "La mesure arrive avec la prochaine réponse de Rémy dans ce fil.");
});

test("jauge : d'où vient la place, et ce qui reste libre", () => {
  const j = R.jauge([reponse({ contexte: 44230, fenetre: 131072, repartition: { systeme: 30900, conversation: 9800, outils: 1700, reponse: 1830 } })]);
  const r = R.repartitionJauge(j);
  assert.deepEqual(r.blocs.map((b) => [b.libelle, R.fmtJetons(b.jetons)]), [["Mémoire, planning, agenda", "30,9 k"], ["Conversation", "11,6 k"], ["Outils lus (Motion, pages…)", "1,7 k"]]);
  assert.equal(R.fmtJetons(r.libre), "86,8 k");
  assert.equal(r.total, 131072);
  assert.equal(R.repartitionJauge(R.jauge([reponse({ contexte: 100 })])), null);
});

test("les nombres s'écrivent à la française", () => {
  assert.equal(R.fmtJetons(850), "850");
  assert.equal(R.fmtJetons(44230), "44,2 k");
  assert.equal(R.fmtJetons(131072), "131 k");
  assert.equal(R.fmtTps(41.6), "42 tok/s");
  assert.equal(R.fmtTps(8.44), "8,4 tok/s");
  assert.equal(R.fmtPourcent(0.324), "32 %");
  assert.equal(R.fmtPourcent(0.004), "<1 %");
  assert.equal(R.fmtSecondes(2.14), "2,1 s");
  assert.equal(R.fmtSecondes(65), "1 min 05");
  assert.equal(R.fmtSecondes(43), "43 s");
  assert.equal(R.detailDebit({ jetons: 1830, secondes: 43, premier: 2.1, estime: true }), "1 830 tokens en 43 s · premier mot après 2,1 s · estimé");
});

// --- Le résumé automatique (PriveeTests.swift, Jauge.phraseCompactage) ---

const place = (contexte, fenetre = 100000) => R.jauge([reponse({ contexte, fenetre })]);

test("compactage : quand le résumé automatique se fera", () => {
  assert.equal(R.phraseCompactage(place(40000), { automatique: true, messages: 20 }), "Résumé automatique à 70 % : encore 30 points avant que Rémy résume le début du fil.");
  assert.equal(R.phraseCompactage(place(69500), { automatique: null, messages: 20 }), "Résumé automatique à 70 % : encore 1 point avant que Rémy résume le début du fil.");
  assert.ok(R.phraseCompactage(place(72000), { automatique: true, messages: 20 }).startsWith("70 % atteints : Rémy résume le début du fil juste après sa réponse"));
  assert.ok(R.phraseCompactage(place(72000), { automatique: true, messages: 4 }).includes("trop court pour être résumé"));
  assert.equal(R.phraseCompactage(place(72000), { automatique: false, messages: 20 }), "Résumé automatique coupé (Réglages) : seulement à la main, ici.");
  assert.equal(R.phraseCompactage(R.jauge([]), { automatique: true, messages: 2 }), "Résumé automatique à 70 % de la place, dès qu'elle est mesurée.");
});

test("compactage : quand il s'est fait, et ce que dit le bandeau", () => {
  const p = R.phraseCompactage(place(30000), { compactage: { jusqua: 12, a: ms(27, 10, 14, 2), resume: "…" }, automatique: true, messages: 20 });
  assert.ok(p.startsWith("Déjà résumé à 14:02 : les 12 premiers messages. Rémy relit ce résumé, puis la suite en entier."), p);
  assert.ok(p.includes("encore 40 points"), p);
  assert.equal(R.phraseCompacte({ compacte: true, resumes: 2, compactage: { jusqua: 2 } }), "Rémy a résumé 2 messages : la suite repart plus légère. Rien n'est effacé.");
  assert.equal(R.phraseCompacte({ compacte: true, resumes: 1 }), "Rémy a résumé 1 message : la suite repart plus légère. Rien n'est effacé.");
  assert.equal(R.phraseCompacte({ compacte: false, raison: "rien-a-resumer" }), "Le fil est encore court : rien à résumer.");
  assert.equal(R.phraseCompacte({ compacte: false, raison: "deja-fait" }), "Déjà résumé récemment.");
});

// --- Les étapes (EtapesTests.swift, BarreEtapes) ---

test("étapes : elles se suivent, la réflexion se met à jour sans nouvelle ligne, chacune a SA durée", () => {
  const e = [];
  for (const s of [
    { text: "Rémy relit…", cle: "contexte", t: 0 },
    { text: "Rémy interroge son modèle local…", cle: "modele", t: 420 },
    { text: "Rémy réfléchit…", cle: "reflexion", t: 1900, detail: "il veut" },
    { text: "Rémy réfléchit…", cle: "reflexion", t: 3400, detail: "il veut un créneau demain" },
    { text: "Rémy écrit sa réponse…", cle: "ecrit", t: 6000 },
    { text: "Ancienne tour : sans clé" },
  ]) R.recevoirEtape(e, s);
  assert.deepEqual(e.map((x) => x.cle), ["contexte", "modele", "reflexion", "ecrit"]);
  assert.equal(e[2].detail, "il veut un créneau demain");
  assert.equal(R.dureeEtape(e, 0), "0,4 s", "pas le temps cumulé (0,0 s)");
  assert.equal(R.dureeEtape(e, 1), "1,5 s");
  assert.equal(R.dureeEtape(e, 3, { enCours: true }), "en cours", "la dernière court encore");
  assert.equal(R.dureeEtape(e, 3, { totalMs: 14500 }), "8,5 s", "la dernière : jusqu'à la fin");
  assert.equal(R.libelleFinEtapes(R.totalReponse({ etapes: e })), "Réponse en 6,0 s");
  assert.equal(R.libelleFinEtapes(R.totalReponse({ debut: 1000, fin: 66000, etapes: e }), 41.6, true), "Réponse en 1 min 05 · 42 tok/s");
  assert.equal(R.libelleFinEtapes(12400, 41.6, false), "Réponse en 12 s", "la vitesse est masquée par défaut");
  assert.equal(R.iconeEtape("web"), "globe");
  assert.equal(R.iconeEtape(null), "horloge");
  assert.equal(R.iconeEtape("inconnue"), "horloge");
});

// --- La liste des fils (ConversationTests, AllegementTests, CoeurTests) ---

test("liste : aujourd'hui, les 7 derniers jours, plus ancien, épinglées", () => {
  const maintenant = date(18, 10, 10);
  assert.equal(R.periode({ updatedAt: ms(18, 10, 0) + 60000 }, maintenant), "Aujourd'hui");
  assert.equal(R.periode({ updatedAt: ms(17, 10, 23) }, maintenant), "7 derniers jours", "hier");
  assert.equal(R.periode({ updatedAt: ms(12, 10, 9) }, maintenant), "7 derniers jours", "il y a 6 jours");
  assert.equal(R.periode({ updatedAt: ms(11, 10, 23) }, maintenant), "Plus ancien");
  assert.equal(R.periode({ updatedAt: ms(1, 10, 9), pinned: true }, maintenant), "Épinglées");
});

test("liste : l'heure, « Hier », ou le jour court", () => {
  const maintenant = date(29, 10, 15);
  assert.equal(R.heureListe(ms(29, 10, 9, 5), maintenant), "09:05");
  assert.equal(R.heureListe(ms(28, 10, 23, 59), maintenant), "Hier");
  assert.equal(R.heureListe(ms(25, 10, 9), maintenant), "25 oct.");
  assert.equal(R.heureListe(null, maintenant), "");
});

test("liste : échanges courts de plus de 14 jours, anciennes journées et importées repliés, jamais supprimés", () => {
  const maintenant = date(29, 10, 15);
  const jours = (n) => maintenant.getTime() - n * 86400e3;
  assert.ok(R.estEchangeCourtAncien({ id: "a", messages: 2, updatedAt: jours(15) }, maintenant));
  assert.ok(!R.estEchangeCourtAncien({ id: "b", messages: 2, updatedAt: jours(13) }, maintenant), "moins de 14 jours");
  assert.ok(!R.estEchangeCourtAncien({ id: "c", messages: 6, updatedAt: jours(30) }, maintenant), "un vrai fil");
  assert.ok(!R.estEchangeCourtAncien({ id: "d", messages: 2, updatedAt: jours(30), pinned: true }, maintenant), "épinglé");
  assert.ok(!R.estEchangeCourtAncien({ id: "e", updatedAt: jours(30) }, maintenant), "tour trop ancienne : on ne sait pas");
  assert.ok(!R.estEchangeCourtAncien({ id: "f", messages: 2, updatedAt: jours(30), origine: { nom: "Claude" } }, maintenant));
  const d = date(23, 9, 10);
  assert.ok(R.estAncienFilDuJour("22/09/2026 · Journée", d));
  assert.ok(!R.estAncienFilDuJour("23/09/2026 · Nocturne", d), "le fil du jour reste en haut");
  assert.ok(!R.estAncienFilDuJour("Tennis", d));
  const o = R.organiserListe([
    { id: "p", title: "Épinglé", pinned: true, messages: 2, updatedAt: jours(40) },
    { id: "auj", title: "Salon des créateurs", messages: 8, updatedAt: jours(0.1) },
    { id: "sem", title: "Budget", messages: 8, updatedAt: jours(3) },
    { id: "vieux", title: "Vieux fil", messages: 8, updatedAt: jours(40) },
    { id: "court", title: "Une question", messages: 2, updatedAt: jours(20) },
    { id: "journee", title: "20/10/2026 · Journée", messages: 9, updatedAt: jours(9) },
    { id: "imp", title: "Plan (ChatGPT)", messages: 30, updatedAt: jours(1), origine: { nom: "ChatGPT" } },
  ], maintenant);
  assert.deepEqual(o.sections.map((s) => [s.titre, s.conversations.map((c) => c.id)]), [["Épinglées", ["p"]], ["Aujourd'hui", ["auj"]], ["7 derniers jours", ["sem"]], ["Plus ancien", ["vieux"]]]);
  assert.deepEqual(o.groupes.map((g) => [g.titre, g.conversations.map((c) => c.id)]), [["Échanges courts, plus de 14 jours (1)", ["court"]], ["Anciennes journées (1)", ["journee"]], ["Importées (1)", ["imp"]]]);
  assert.equal(o.total, 7);
});

test("liste : la recherche ignore la casse et les accents", () => {
  const l = [{ id: "a", title: "Salon des créateurs", updatedAt: 2 }, { id: "b", title: "Préparer la levée de fonds", updatedAt: 1 }, { id: "c", title: "Courses", updatedAt: 3 }];
  assert.deepEqual(R.chercherFils(l, "creat").map((c) => c.id), ["a"]);
  assert.deepEqual(R.chercherFils(l, "leve").map((c) => c.id), ["b"]);
  assert.deepEqual(R.chercherFils(l, "LEVÉE").map((c) => c.id), ["b"]);
  assert.deepEqual(R.chercherFils(l, "rien").map((c) => c.id), []);
  assert.deepEqual(R.chercherFils(l, "  ").map((c) => c.id), ["c", "a", "b"]);
});

test("écran vide : « Reprendre » propose le fil le plus récent, hors importés ; un fil d'un autre jour se referme", () => {
  const maintenant = date(29, 10, 15);
  const r = R.aReprendre([{ id: "ancien", title: "Ancien", updatedAt: ms(26, 10, 9) }, { id: "hier", title: "Hier", updatedAt: ms(28, 10, 9) }, { id: "importe", title: "Importé", updatedAt: ms(29, 10, 9), origine: { nom: "ChatGPT" } }], maintenant);
  assert.equal(r.fil.id, "hier", "un fil importé n'est pas « le dernier fil »");
  assert.equal(r.duJour, false);
  assert.equal(R.libelleReprise(r), "Reprendre « Hier »");
  const m = R.aReprendre([{ id: "matin", title: "Matin", updatedAt: ms(29, 10, 8) }], maintenant);
  assert.equal(R.libelleReprise(m), "Reprendre le fil du jour « Matin »");
  assert.equal(R.aReprendre([], maintenant), null);
  assert.ok(R.aRefermer(ms(28, 10, 15), maintenant));
  assert.ok(!R.aRefermer(ms(29, 10, 14, 50), maintenant));
  assert.ok(!R.aRefermer(null, maintenant), "rien d'ouvert : rien à refermer");
  assert.equal(R.titreJournee(date(24, 9, 8)), "24/09/2026 · Journée");
});

test("non lus : la dernière réponse de Rémy, plus récente que la marque, ni le fil ouvert ni un import", () => {
  const lus = { c1: 100, c2: 100 };
  const liste = [
    { id: "c1", dernier: "assistant", updatedAt: 200 },
    { id: "c2", dernier: "user", updatedAt: 200 },
    { id: "c3", dernier: "assistant", updatedAt: 50 },
    { id: "c4", dernier: "assistant", updatedAt: 300, origine: { nom: "ChatGPT" } },
  ];
  assert.deepEqual(liste.filter((c) => R.nonLu(c, { lus })).map((c) => c.id), ["c1", "c3"], "c2 : Sam a parlé en dernier ; c3 jamais vu");
  assert.equal(R.nombreNonLus(liste, { lus, ouvert: "c1" }), 1, "à l'écran : jamais non lu");
  assert.equal(R.nombreNonLus(liste, { lus: null }), 0, "première visite : rien d'un coup");
  assert.equal(R.nombreNonLus(liste, { lus, capacite: false }), 0, "tour sans non-lus-v1");
  // « Marquer comme non lu » : seulement si Rémy a parlé en dernier, pas le fil ouvert.
  assert.ok(R.peutMarquerNonLu(liste[0], "c2"));
  assert.ok(!R.peutMarquerNonLu(liste[1], null));
  assert.ok(!R.peutMarquerNonLu(liste[0], "c1"));
  assert.ok(R.nonLu(liste[0], { lus: { c1: R.marqueNonLue(liste[0]) } }));
  assert.equal(R.phraseNonVues(1), "1 réponse non vue");
  assert.equal(R.phraseNonVues(3), "3 réponses non vues");
});

// --- Le composeur (Composeur, ChatModel) ---

test("file d'attente : un extrait de 50 caractères au plus, et « N messages partiront »", () => {
  assert.equal(R.texteFile(["Et demain ?"]), "Partira à la fin de la réponse : « Et demain ? »");
  const long = "Je voulais aussi te dire que la réunion de jeudi est déplacée à vendredi";
  assert.equal(R.texteFile([long, "b"]), `2 messages partiront à la fin de la réponse : « ${long.slice(0, 47)}… »`);
  assert.equal(R.texteFile(["x".repeat(50)]), `Partira à la fin de la réponse : « ${"x".repeat(50)} »`);
});

test("ce qui revient au champ s'ajoute après le texte déjà là ; la dictée après une espace", () => {
  assert.equal(R.joindre("", "a\n\nb"), "a\n\nb");
  assert.equal(R.joindre("déjà là  \n", "suite"), "déjà là\n\nsuite");
  assert.equal(R.joindre("déjà", ""), "déjà");
  assert.equal(R.ajouterDictee("Rappelle-moi ", " d'appeler Léa "), "Rappelle-moi d'appeler Léa");
  assert.equal(R.ajouterDictee("", "Bonjour"), "Bonjour");
  assert.equal(R.ajouterDictee("Rien", "  "), "Rien");
});

test("question préparée : jamais par-dessus un autre message en cours", () => {
  assert.ok(!R.conflitQuestion({ brouillon: "", texte: "Aide-moi à avancer sur « Devis »." }));
  assert.ok(!R.conflitQuestion({ brouillon: " Aide-moi à avancer sur « Devis ». ", texte: "Aide-moi à avancer sur « Devis »." }), "le même texte : rien à demander");
  assert.ok(R.conflitQuestion({ brouillon: "Mon message à moi", texte: "Aide-moi à avancer sur « Devis »." }));
  assert.ok(R.conflitQuestion({ brouillon: "", texte: "x", file: ["en attente"] }), "un message en file compte comme un brouillon");
});

test("RÉGRESSION : une relecture du fil garde la question ratée, son erreur et « Réessayer »", () => {
  const tour = [{ role: "user", content: "Un créneau pour Léa ?" }, { role: "assistant", content: "Jeudi 10 h." }];
  const question = { role: "user", content: "Question importante qui va échouer", _local: true };
  const erreur = { role: "assistant", content: "", _erreur: "Le modèle local ne répond pas.", _code: "R-7KQ2M", _local: true, _question: question.content };
  // La tour a retiré la question (event: error) : elle revient après ses messages.
  const relu = R.garderFinLocale([...tour, question, erreur], tour.map((m) => ({ ...m })));
  assert.deepEqual(relu.map((m) => m.content), ["Un créneau pour Léa ?", "Jeudi 10 h.", "Question importante qui va échouer", ""]);
  assert.equal(relu[3], erreur, "la même ligne : son code et « Réessayer » restent");
  // Un autre appareil a écrit depuis : la question ratée n'est toujours pas sur la tour, elle reste.
  const ailleurs = [...tour, { role: "user", content: "Depuis l'iPhone" }, { role: "assistant", content: "Noté." }];
  assert.equal(R.garderFinLocale([...tour, question, erreur], ailleurs).length, 6);
  // Une erreur seule (la question est arrivée) : elle reste tant que la tour n'a rien de plus…
  const arrivee = { role: "user", content: "Et demain ?" };
  const coupee = { role: "assistant", content: "", _erreur: "Impossible de récupérer la réponse.", _local: true, _question: "Et demain ?" };
  assert.equal(R.garderFinLocale([...tour, arrivee, coupee], [...tour, arrivee]).at(-1), coupee);
  // … et s'efface quand la réponse est arrivée entre-temps.
  const repondu = [...tour, arrivee, { role: "assistant", content: "Demain, rien de prévu." }];
  assert.equal(R.garderFinLocale([...tour, arrivee, coupee], repondu), repondu);
  // Rien de local en fin de fil : la tour fait foi, telle quelle.
  assert.equal(R.garderFinLocale(tour, repondu), repondu);
  assert.deepEqual(R.garderFinLocale(undefined, undefined), []);
});

test("remy-envoi : valable 2 min, avec un texte", () => {
  const t = 1_800_000_000_000;
  assert.ok(R.envoiValable({ texte: "Organise ma journée", a: t - 60000 }, t));
  assert.ok(!R.envoiValable({ texte: "Organise ma journée", a: t - 121000 }, t));
  assert.ok(!R.envoiValable({ texte: "  ", a: t }, t));
  assert.ok(!R.envoiValable({ texte: "x" }, t));
  assert.ok(!R.envoiValable(null, t));
  assert.ok(R.contientLien("Lis https://exemple.org/page"));
  assert.ok(R.contientLien("http://exemple.org"));
  assert.ok(!R.contientLien("exemple.org"));
  assert.equal(R.BROUILLONS.retards, "Qu'est-ce qui est en retard, et par quoi je commence ?");
  assert.match(R.BROUILLONS.journee, /^Organise ma journée : regarde mon agenda et mes tâches/);
  assert.deepEqual(R.suiteImportee("Plan marketing"), { titre: "Suite · Plan marketing", texte: "Reprenons ce que j'avais commencé ailleurs, dans « Plan marketing » : où est-ce que ça nous mène ?" });
  assert.equal(R.suiteImportee("x".repeat(100)).titre.length, 80);
});

// --- Copier, diagnostic, Retenir ---

test("le texte en clair garde le sens sans la syntaxe ; un tableau seul se copie ligne par ligne", () => {
  const md = "#### Le plan\n- **Mardi** : la démo\n- *Mercredi* : `invitations`\n\nVoir [le site](https://exemple.fr).\n\n| A | B |\n|---|---|\n| 1 | 2 |";
  assert.equal(R.enClair(md), "Le plan\n• Mardi : la démo\n• Mercredi : invitations\n\nVoir le site.\n\nA · B\n1 · 2");
  assert.equal(R.enClair("1. Un\n2) Deux\n\n---\n```\ncode *brut*\n```"), "1. Un\n2. Deux\n\n—\ncode *brut*");
  assert.equal(R.tableEnTexte([["A", "B"], ["1", "2"]]), "A | B\n1 | 2");
});

test("erreur : le code à part, le diagnostic en JSON trié, le repli sans la tour", () => {
  assert.equal(R.sansCode("Rémy a travaillé trop longtemps. (code R-7KQ2M)", "R-7KQ2M"), "Rémy a travaillé trop longtemps.");
  assert.equal(R.sansCode("Sans code", null), "Sans code");
  assert.equal(R.jsonTrie({ type: "chat", code: "R-7KQ2M", etapes: [{ t: 0, cle: "contexte" }] }), '{\n  "code": "R-7KQ2M",\n  "etapes": [\n    {\n      "cle": "contexte",\n      "t": 0\n    }\n  ],\n  "type": "chat"\n}');
  assert.equal(R.copieSansDetail("Erreur.", "R-7KQ2M"), "Erreur. (code R-7KQ2M)");
});

test("Retenir : ce que Sam lit (RetourCapture.phrase)", () => {
  assert.equal(R.phraseCapture({ ajouts: ["Sam préfère le matin"] }), "Retenu : Sam préfère le matin");
  assert.equal(R.phraseCapture({ ajouts: ["a", "b", "c"] }), "Retenu : a — et 2 autres choses.");
  assert.equal(R.phraseCapture({ ajouts: ["a", "b"] }), "Retenu : a — et 1 autre chose.");
  assert.equal(R.phraseCapture({ ajouts: [], memoire: false }), "Gardé : Rémy le relira cette nuit.");
  assert.equal(R.phraseCapture({ ajouts: [], memoire: false, message: "Mémoire pleine." }), "Gardé : Mémoire pleine.");
  assert.equal(R.phraseCapture({ ajouts: [] }), "Rien de nouveau : Rémy le savait déjà.");
});

test("modèle, secours, autorisations, étape « Faire connaissance »", () => {
  assert.equal(R.libelleModele({ model: "glm-5.3", tier: "local", usd: 0 }), "glm-5.3 · sur tes machines");
  assert.equal(R.libelleModele({ model: "claude-haiku", tier: "dégradé", usd: 0.004 }), "claude-haiku · < 0,01 $");
  assert.equal(R.libelleModele({ model: "remy" }), null);
  assert.ok(R.estSecours({ tier: "dégradé" }) && !R.estSecours({ tier: "local" }));
  assert.equal(R.titreAutorisation("en_attente"), "Recherche web · via Claude (Anthropic)");
  assert.equal(R.titreAutorisation("acceptee"), "Recherche autorisée");
  assert.equal(R.titreAutorisation("refusee"), "Sans le web, à ta demande");
  assert.equal(R.titreAutorisation("expiree"), "Demande expirée");
  assert.equal(R.partira({ contexte: false }), "ta question seulement — ni la conversation, ni ta mémoire, ni ton planning");
  assert.equal(R.partira({ contexte: true }), "ta question, la conversation et ta mémoire");
  assert.equal(R.statutAutorisation({ statut: "en_attente" }, 1, 2), "en_attente", "le dernier message : encore en attente");
  assert.equal(R.statutAutorisation({ statut: "en_attente" }, 1, 4), "expiree", "une question a suivi : expirée");
  assert.equal(R.statutAutorisation({ statut: "acceptee" }, 1, 4), "acceptee");
  const s = { id: "vie", title: "Ta vie", reperes: [{ id: "a", label: "Ta famille" }, { id: "b", label: "Tes amis" }, { id: "c", label: "Ton sport" }] };
  assert.equal(R.phraseSession(s, { couverture: { vie: ["a"] } }), "Il reste : Tes amis · Ton sport");
  assert.equal(R.phraseSession(s, { couverture: { vie: ["a", "b", "c"] } }), "Tout est couvert : Rémy peut clore l'étape.");
  assert.equal(R.phraseSession(s, { etats: { vie: "faite" } }), "Tout est couvert : Rémy peut clore l'étape.");
});

// --- Le contrat, contre les vraies routes de la tour ---

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-site-remy-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_GLM_URL", "ANTHROPIC_API_KEY", "DICTEE_LOCALE_URL", "OPENAI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "TRANSCRIBE_PROVIDER"]) delete process.env[v];
process.env.REMY_DATA_DIR = path.join(dossier, "data");
process.env.REMY_CLES_DIR = path.join(dossier, "cles");
process.env.HOME = path.join(dossier, "maison");
process.env.USERPROFILE = process.env.HOME;

const { routeApi } = await import("../lib/routes.js");
const { CAPACITES } = await import("../lib/version.js");
const store = await import("../lib/store.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
const { fermer: fermerRemy } = await import("../lib/db.js");
test.after(() => {
  remy.close();
  fermerRemy();
  fs.rmSync(dossier, { recursive: true, force: true });
});

// Comme api.js : JSON, même origine (pas de mot de passe ici, en test).
const appel = async (chemin, { methode = "GET", corps } = {}) => {
  const r = await fetch(base + chemin, { method: methode, headers: { Accept: "application/json", Origin: base, ...(corps !== undefined ? { "Content-Type": "application/json" } : {}) }, body: corps === undefined ? undefined : JSON.stringify(corps) });
  const texte = await r.text();
  return { statut: r.status, corps: texte ? JSON.parse(texte) : null };
};

test("contrat : les capacités que la vue Rémy attend sont annoncées", () => {
  for (const c of ["non-lus-v1", "jauge-v1", "compactage-v1", "dictee-correction-v1", "retenir-choix-v1", "etapes-v1", "recherche-privee-v1", "reglages"]) assert.ok(CAPACITES.includes(c), c);
});

test("contrat : nouvelle conversation privée, titre de 80 caractères au plus, épingler, liste lue par la pastille", async () => {
  const c = await appel("/api/conversations", { methode: "POST", corps: { prive: true } });
  assert.equal(c.statut, 201);
  assert.equal(c.corps.prive, true, "la tour la fait naître privée");
  const titre = R.titreJournee(new Date());
  const p = await appel(`/api/conversations/${encodeURIComponent(c.corps.id)}`, { methode: "PATCH", corps: { title: titre } });
  assert.equal(p.statut, 200);
  assert.equal(p.corps.title, titre);
  const trop = await appel(`/api/conversations/${encodeURIComponent(c.corps.id)}`, { methode: "PATCH", corps: { title: "x".repeat(81) } });
  assert.equal(trop.statut, 400, "le site coupe à 80 caractères (Renommer)");
  const e = await appel(`/api/conversations/${encodeURIComponent(c.corps.id)}`, { methode: "PATCH", corps: { pinned: true } });
  assert.equal(e.corps.pinned, true);
  const ordinaire = await appel("/api/conversations", { methode: "POST", corps: {} });
  assert.ok(!ordinaire.corps.prive);
  const l = await appel("/api/conversations");
  assert.equal(l.statut, 200);
  const vue = l.corps.find((x) => x.id === c.corps.id);
  assert.deepEqual([vue.prive, vue.pinned, vue.messages, vue.dernier, vue.origine], [true, true, 0, null, null], "ce que lisent nonLu() et organiserListe()");
  assert.equal(R.organiserListe(l.corps).sections[0].titre, "Épinglées");
  // Rendre privée : sans retour.
  const r = await appel(`/api/conversations/${encodeURIComponent(ordinaire.corps.id)}`, { methode: "PATCH", corps: { prive: true } });
  assert.equal(r.corps.prive, true);
  const retour = await appel(`/api/conversations/${encodeURIComponent(ordinaire.corps.id)}`, { methode: "PATCH", corps: { prive: false } });
  assert.equal(retour.statut, 400);
  const d = await appel(`/api/conversations/${encodeURIComponent(ordinaire.corps.id)}`, { methode: "DELETE" });
  assert.ok(d.statut < 300);
  assert.equal((await appel(`/api/conversations/${encodeURIComponent(ordinaire.corps.id)}`)).statut, 404, "« Conversation introuvable » côté site");
});

test("contrat : une conversation importée se lit avec son origine, privée d'office ; la relecture voit la question", async () => {
  const t = Date.now();
  await store.putConversation({ id: "x-import", title: "Plan marketing", createdAt: t, updatedAt: t, origine: { source: "chatgpt", nom: "ChatGPT", cle: "k1" },
    messages: [{ role: "user", content: "Comment lancer une boutique de bougies ?" }, { role: "assistant", content: "Commence par trois parfums." }] });
  const l = await appel("/api/conversations");
  const imp = l.corps.find((x) => x.id === "x-import");
  assert.equal(imp.origine.nom, "ChatGPT");
  assert.equal(imp.prive, true);
  assert.ok(!R.nonLu(imp, { lus: {} }), "un fil importé n'est jamais « non lu »");
  assert.deepEqual(R.organiserListe(l.corps).groupes.map((g) => g.cle), ["importees"]);
  const c = await appel("/api/conversations/x-import");
  assert.equal(c.corps.origine.nom, "ChatGPT");
  // La relecture (reprise d'une réponse) cherche la dernière question identique.
  assert.equal(c.corps.messages.findLastIndex((m) => m.role === "user" && m.content === "Comment lancer une boutique de bougies ?"), 0);
});

test("contrat : compacter un fil court, interrompre sans réponse en cours, diagnostic d'un code inconnu", async () => {
  const c = await appel("/api/conversations", { methode: "POST", corps: {} });
  const id = encodeURIComponent(c.corps.id);
  // Sans modèle local branché : un refus clair, avec un code à transmettre (rien ne part chez Claude).
  const k = await appel(`/api/conversations/${id}/compacter`, { methode: "POST", corps: {} });
  assert.equal(k.statut, 502);
  assert.match(k.corps.error, /modèle local n'est pas branché/);
  assert.match(k.corps.code, /^R-[0-9A-Z]{5}$/);
  const s = await appel(`/api/conversations/${id}/stop`, { methode: "POST", corps: {} });
  assert.equal(s.statut, 200);
  assert.equal(s.corps.arrete, false, "rien en cours : pas une erreur");
  const i = await appel("/api/incidents/R-ZZZZZ");
  assert.equal(i.statut, 404, "« Copier le diagnostic » se replie sur le message et son code");
  assert.equal((await appel("/api/incidents/pas-un-code")).statut, 400);
});

test("contrat : Retenir et Corriger la dictée refusent clairement ce qui ne peut pas partir", async () => {
  const r = await appel("/api/capture", { methode: "POST", corps: { texte: "", source: "note" } });
  assert.ok(r.statut >= 400 && r.statut < 500, `un texte vide est refusé (${r.statut})`);
  assert.ok(r.corps?.error || r.corps?.message, "avec une raison à dire");
  const d = await appel("/api/dictee/correction", { methode: "POST", corps: { entendu: "Rémi", voulu: "Rémy" } });
  assert.ok(d.statut >= 400, "sans Dictée Locale branchée : un refus, jamais un silence");
  assert.ok(d.corps?.error || d.corps?.message);
});

test("contrat : l'étape « Faire connaissance » et le circuit du résumé automatique se lisent sur la tour", async () => {
  const s = await appel("/api/setup");
  assert.equal(s.statut, 200);
  assert.ok(Array.isArray(s.corps.sessions) && s.corps.sessions.length, "les sessions de la tour");
  const premiere = s.corps.sessions[0];
  assert.ok(premiere.id && premiere.title && Array.isArray(premiere.reperes));
  assert.match(R.phraseSession(premiere, s.corps), /^Il reste : /);
  const g = await appel("/api/reglages");
  assert.equal(g.statut, 200);
  assert.equal(typeof g.corps.circuits?.compactage?.actif, "boolean", "phraseCompactage lit circuits.compactage.actif");
});

test("contrat : un message raté est retiré par la tour ; la relecture le garde à l'écran", async () => {
  // Un faux modèle local en panne, secours Claude coupé : rien ne part ailleurs.
  const panne = http.createServer((req, res) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "panne" }));
  });
  await new Promise((r) => panne.listen(0, "127.0.0.1", r));
  const avant = { glm: process.env.REMY_GLM_URL, secours: process.env.REMY_SECOURS_CLOUD, cerveau: process.env.REMY_CERVEAU };
  process.env.REMY_GLM_URL = `http://127.0.0.1:${panne.address().port}/v1`;
  delete process.env.REMY_SECOURS_CLOUD;
  delete process.env.REMY_CERVEAU;
  const c = await appel("/api/conversations", { methode: "POST", corps: {} });
  const id = encodeURIComponent(c.corps.id);
  let brut;
  try {
    const r = await fetch(`${base}/api/conversations/${id}/messages`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ text: "Question importante qui va échouer", call: false }) });
    brut = await r.text();
  } finally {
    panne.close();
    for (const [v, x] of [["REMY_GLM_URL", avant.glm], ["REMY_SECOURS_CLOUD", avant.secours], ["REMY_CERVEAU", avant.cerveau]]) {
      if (x === undefined) delete process.env[v];
      else process.env[v] = x;
    }
  }
  const erreur = brut.split("\n\n").find((b) => /^event: error$/m.test(b));
  assert.ok(erreur, `un event: error (${brut.slice(0, 200)})`);
  const d = JSON.parse(erreur.match(/^data: (.+)$/m)[1]);
  assert.ok(d.message, "un message à dire");
  const tour = (await appel(`/api/conversations/${id}`)).corps.messages;
  assert.ok(!tour.some((m) => m.role === "user" && m.content === "Question importante qui va échouer"), "la tour n'a plus la question");
  // Ce que fait la vue en relisant (retour au premier plan, tour revenue) :
  const q = { role: "user", content: "Question importante qui va échouer", _local: true };
  const l = { role: "assistant", content: "", _erreur: d.message, _code: d.code || null, _local: true, _question: q.content };
  assert.deepEqual(R.garderFinLocale([q, l], tour).slice(-2), [q, l]);
});

test("contrat : une étape « Faire connaissance » déjà commencée revient avec ses messages (la vue l'ouvre sans renvoyer l'amorce)", async () => {
  const s = (await appel("/api/setup")).corps.sessions[0];
  const neuve = await appel("/api/conversations", { methode: "POST", corps: { session: s.id } });
  assert.equal(neuve.statut, 201);
  assert.deepEqual(neuve.corps.messages, [], "neuve : la vue envoie l'amorce");
  const conv = await store.getConversation(neuve.corps.id);
  conv.messages = [{ role: "user", content: "Mes projets : la boutique de bougies." }, { role: "assistant", content: "Lequel passe devant ?" }];
  await store.putConversation(conv);
  const reprise = await appel("/api/conversations", { methode: "POST", corps: { session: s.id } });
  assert.equal(reprise.corps.id, neuve.corps.id, "une étape n'a qu'UNE conversation");
  assert.equal(reprise.corps.messages.length, 2, "déjà commencée : la vue l'ouvre, rien ne part");
});

test("contrat : sans moteur de transcription, GET /api/transcribe le dit (le micro prévient avant d'enregistrer)", async () => {
  const t = await appel("/api/transcribe");
  assert.equal(t.statut, 200);
  assert.equal(t.corps.available, false, "la vue passe transcription: false au module de dictée");
  assert.ok(t.corps.raison);
});
