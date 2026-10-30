// « Noter », Retenir, les cartes de proposition, Ajuster et la voix du site
// (lot noter) : les modules purs avec LES MÊMES CAS que les tests Swift de
// l'iPhone (OrganisationTests, VoixEtFileTests, ErgonomieTests), puis les
// chemins du site joués contre les vraies routes de la tour (lib/routes.js),
// avec un faux Motion et un faux Google Calendar.
// L'heure de référence est celle des tests Swift : on fixe Paris.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFauxMotion } from "./outils/faux-motion.mjs";

console.log = () => {};
console.warn = () => {};

const E = await import("../public/app/analyse/etiquettes.js");
const R = await import("../public/app/analyse/rangement.js");
const P = await import("../public/app/vues/propositions.js");
const A = await import("../public/app/vues/ajuster.js");
const D = await import("../public/app/dictee.js");
const V = await import("../public/app/vues/appel.js");
const T = await import("../public/app/vues/retenir.js");
const N = await import("../public/app/vues/noter.js");
const { apercu } = await import("../public/app/analyse/genre.js");
const { plier } = await import("../public/app/analyse/dates.js");

const date = (j, m, h, mi = 0, an = 2026) => new Date(an, m - 1, j, h, mi, 0, 0);
const ms = (...a) => date(...a).getTime();

// --- L'étiquette devinée (EtiquetteDevinee, OrganisationTests.testEtiquetteDevinee) ---

test("étiquette devinée : les cas de l'iPhone", () => {
  const e = [{ id: "v", nom: "Voiture" }, { id: "s", nom: "Santé" }];
  assert.equal(E.etiquetteDevinee("Contrôle technique de la Twingo", e), "v");
  assert.equal(E.etiquetteDevinee("Renouveler l'ordonnance", e), "s");
  assert.equal(E.etiquetteDevinee("Payer le loyer", e), null, "« Administratif » n'existe pas chez Sam : rien");
  assert.equal(E.etiquetteDevinee("Rendez-vous Twingo samedi", [{ id: "v", nom: "Voiture" }]), "v", "« twingo » : un indice de l'iPhone");
});

test("étiquette devinée : la table du site est celle de l'iPhone (EtiquetteDevinee.indices)", () => {
  const swift = fs.readFileSync(new URL("../ios-native/RemyCore/Sources/RemyCore/Rangement.swift", import.meta.url), "utf8");
  const bloc = swift.slice(swift.indexOf("public enum EtiquetteDevinee"));
  const pli = (m) => plier(m).replace(/œ/g, "oe");
  const iphone = [...bloc.slice(0, bloc.indexOf("]\n")).matchAll(/\("([^"]+)", \[([^\]]*)\]\)/g)]
    .map(([, nom, mots]) => [nom, [...new Set([...mots.matchAll(/"([^"]+)"/g)].map((x) => pli(x[1])))].sort()]);
  assert.equal(iphone.length, 6, "les six domaines lus dans Rangement.swift");
  assert.deepEqual(E.INDICES.map(([nom, mots]) => [nom, [...new Set(mots.map(pli))].sort()]), iphone, "mêmes domaines, mêmes mots, même ordre");
});

test("étiquette devinée : sans casse ni accents, seulement une étiquette qui existe", () => {
  const e = [{ id: "a", nom: "ADMINISTRATIF" }, { id: "f", nom: "Famille et amis" }, { id: "p", nom: "Professionnel" }, { id: "an", nom: "Anniversaire" }, { id: "s", nom: "sante" }];
  assert.equal(E.etiquetteDevinee("Appeler le garage demain à 9h", e), null, "pas de « Voiture » chez lui");
  assert.equal(E.etiquetteDevinee("DENTISTE jeudi", e), "s", "« Santé » écrit « sante » : la même");
  assert.equal(E.etiquetteDevinee("Déclaration d'impôts", e), "a");
  assert.equal(E.etiquetteDevinee("Appeler ma sœur", e), "f");
  assert.equal(E.etiquetteDevinee("Anniv de Léa", e), "an");
  assert.equal(E.etiquetteDevinee("Préparer la réunion client", e), "p");
  assert.equal(E.etiquettePour("Rendez-vous chez le médecin", [{ id: "x", nom: "Santé", couleur: "vert" }])?.couleur, "vert", "rend l'étiquette entière");
  assert.equal(E.etiquetteDevinee("", e), null);
  assert.equal(E.etiquetteDevinee("garage", null), null, "sans étiquettes lues : rien");
});

// --- Le récapitulatif (Rangement.swift, OrganisationTests) ---

const samedi = ms(31, 10, 9);

test("récapitulatif : un rendez-vous sans heure n'est pas prêt, la contrainte l'est", () => {
  const rdv = { cle: "a", nature: "rendez-vous", titre: "Soirée chez Yanis", quand: null, heureConnue: false, question: "À quelle heure ?" };
  assert.equal(R.pret(rdv), false, "sans heure, pas de créneau inventé");
  assert.equal(R.destination(rdv, { agenda: true }), "Rendez-vous : heure manquante");
  assert.equal(R.pret({ ...rdv, quand: samedi, heureConnue: false }), false, "une date sans heure non plus");
  assert.equal(R.pret({ ...rdv, quand: samedi, heureConnue: true }), true, "l'heure posée : prêt, même avec sa question");
  const c = { cle: "b", nature: "contrainte", titre: "Dispo limitée samedi", quand: samedi, heureConnue: false };
  assert.ok(R.destination(c, { agenda: true }).endsWith("(pas de créneau bloqué)"));
  assert.equal(R.destination(c), "Rappel le sam. 31 oct. (pas de créneau bloqué)");
  assert.equal(R.pret(c), true);
  assert.equal(R.pret({ nature: "tache", titre: "x", question: "Pour quand ?" }), false, "une question en suspens : pas prêt");
});

test("récapitulatif : où va chaque élément, en mots", () => {
  assert.equal(R.destination({ nature: "tache", quand: samedi, heureConnue: false, dureeMin: 30 }), "Tâche Motion, avant le sam. 31 oct., 30 min");
  assert.equal(R.destination({ nature: "tache", quand: ms(30, 10, 14, 5), heureConnue: true, dureeMin: 90 }), "Tâche Motion, avant le ven. 30 oct. 14:05, 1 h 30");
  assert.equal(R.destination({ nature: "tache" }), "Tâche Motion");
  assert.equal(R.destination({ nature: "rappel" }), "Rappel, sans date");
  assert.equal(R.destination({ nature: "rappel", quand: ms(2, 11, 18, 30), heureConnue: true }), "Rappel le lun. 2 nov. 18:30");
  assert.equal(R.destination({ nature: "liste", liste: "Courses", articles: ["tomates", "lait"] }), "Liste « Courses » · 2 articles");
  assert.equal(R.destination({ nature: "liste", liste: null, articles: ["pain"] }), "Liste « Courses »");
  assert.equal(R.destination({ nature: "note" }), "Notes (Projets)");
  assert.equal(R.destination({ nature: "rendez-vous", quand: ms(29, 10, 20, 30), heureConnue: true, dureeMin: 120 }, { agenda: true }), "Agenda · jeu. 29 oct. 20:30, 2 h");
  assert.equal(R.destination({ nature: "rendez-vous", quand: ms(29, 10, 20, 30), heureConnue: true }, { agenda: false }), "Rappel · jeu. 29 oct. 20:30");
  assert.equal(R.destination({ nature: "projet", parent: "Boutiques" }), "Nouveau dossier dans « Boutiques »");
  assert.equal(R.destination({ nature: "projet" }), "Nouveau dossier");
});

test("récapitulatif : « Ranger » refuse tant qu'un élément coché n'est pas prêt", () => {
  const el = [{ cle: "a", nature: "rendez-vous", titre: "x", heureConnue: false, question: "?" }, { cle: "b", nature: "note", titre: "y" }];
  assert.deepEqual(R.etatRangement(el, new Set(["b"])), { choisis: [el[1]], possible: true });
  assert.equal(R.etatRangement(el, new Set(["a", "b"])).possible, false);
  assert.equal(R.etatRangement(el, new Set()).possible, false, "rien de coché");
  assert.equal(R.libelleRanger(1), "Ranger 1 élément");
  assert.equal(R.libelleRanger(4), "Ranger 4 éléments");
});

test("bilan : les phrases de BilanRangement", () => {
  assert.equal(R.phraseBilan({ faits: ["« A » (note)"] }), "Rangé : « A » (note).");
  assert.equal(R.phraseBilan({ faits: ["a", "b", "c"] }), "3 éléments rangés.");
  assert.equal(R.phraseBilan({ faits: ["a", "b"], dejaLa: ["« lait » (liste « Courses »)"] }), "2 éléments rangés ; déjà là : « lait » (liste « Courses »).");
  assert.equal(R.phraseBilan({ dejaLa: ["« X » (Motion)", "« Y » (rappels)"] }), "Rien de nouveau, déjà là : « X » (Motion) ; « Y » (rappels).");
  assert.equal(R.phraseBilan({}), "Rien à ranger.");
  assert.equal(R.phraseBilan({ echecs: ["« A » : heure manquante", "« B » : Motion ne répond pas"] }), "Rien n'a été rangé : « A » : heure manquante ; « B » : Motion ne répond pas.");
  assert.equal(R.phraseBilan({ faits: ["a"], dejaLa: ["« X » (Motion)"], echecs: ["« B » : refusé"] }), "1 rangé ; déjà là : « X » (Motion) ; pas fait : « B » : refusé.");
  assert.equal(R.phraseBilan({ dejaLa: ["« X » (Motion)"], echecs: ["« B » : refusé"] }), "Déjà là : « X » (Motion) ; pas fait : « B » : refusé.");
  assert.equal(R.phraseBilan({ faits: ["a", "b"], echecs: ["« B » : refusé"] }), "2 rangés ; pas fait : « B » : refusé.");
});

test("tâches : par lots de 6, et l'état de chaque ligne (ecrireTaches)", () => {
  assert.deepEqual(R.lots([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]).map((l) => l.length), [6, 6, 1]);
  assert.deepEqual(R.lots([]), []);
  const r = { etat: "appliquee_partiellement", results: [{ ok: true, nom: "A" }, { ok: true, nom: "B", dejaLa: true }, { ok: false, nom: "C", erreur: "quota" }] };
  assert.deepEqual(R.etatsLot(r, 3), [{ etat: "fait" }, { etat: "dejaLa" }, { etat: "echec", erreur: "quota" }]);
  assert.deepEqual(R.etatsLot({ etat: "deja_la", results: [] }, 2), [{ etat: "dejaLa" }, { etat: "dejaLa" }], "tout déjà là, sans détail");
  assert.deepEqual(R.etatsLot({ etat: "echouee" }, 1), [{ etat: "echec", erreur: "refusé par Motion" }]);
  assert.deepEqual(R.etatsLot({ etat: "appliquee" }, 1), [{ etat: "fait" }], "réponse sans détail : l'état d'ensemble");
  assert.equal(R.estDejaLa({ ok: false, erreur: "« X » existe déjà dans Motion" }), true, "une tour d'avant le 24/10 le disait en échec");
  assert.equal(R.estDejaLa({ ok: true, deja_la: true }), true);
  assert.equal(R.toutDejaLa({ results: [{ ok: true, dejaLa: true }] }), true);
  assert.equal(R.vraisEchecs({ results: [{ ok: false, erreur: "x" }, { ok: false, erreur: "« Y » existe déjà dans Motion" }] }), 1);
});

test("où ranger un projet : nommé, sinon les mots en commun (OrganisationTests.testParentSuggerePourUnProjet)", () => {
  const connu = { dossiers: [{ id: "d1", nom: "Maison", parent: null, ordre: 0 }], projets: [{ id: "p1", nom: "Boutiques" }] };
  assert.equal(R.parentPour("Inconnu", connu), null);
  assert.equal(R.parentPour("maison", connu), "d1", "sans casse");
  assert.equal(R.parentPour("BOUTIQUES", connu), "motion:p1");
  assert.equal(R.suggestion("Étudier ElevenLabs", { dossiers: [], projets: [] }), null);
  assert.deepEqual(R.suggestion("Comparer les voix des boutiques", connu), { id: "motion:p1", nom: "Boutiques" });
  assert.equal(R.suggestion("Un vélo", connu), null, "moins de 4 lettres : pas un mot");
  assert.deepEqual(R.candidatsParent(connu).map((c) => c.id), ["motion:p1", "d1"], "les projets Motion, puis les dossiers");
  assert.equal(R.ordreApres([{ parent: null, ordre: 0 }, { parent: null, ordre: 4 }, { parent: "x", ordre: 9 }], null), 5);
  assert.equal(R.ordreApres([], "x"), 0);
  assert.equal(R.ordreApres(null, null), 0);
});

test("Noter : les phrases de l'iPhone (déjà là, rappel, file de Motion)", () => {
  assert.equal(R.phraseListe("Courses", [], ["tomates", "œufs"]), "Déjà dans « Courses » : « tomates », « œufs ».");
  assert.equal(R.phraseListe("Courses", ["beurre"], ["tomates"]), "1 article dans « Courses ». Déjà dans ta liste : « tomates ».");
  assert.equal(R.phraseListe("Courses", ["a", "b"], []), "2 articles dans « Courses ».");
  const now = date(15, 10, 10, 40);
  assert.equal(R.quandRappel(ms(15, 10, 18, 0), now), "aujourd'hui 18:00");
  assert.equal(R.quandRappel(ms(16, 10, 9, 0), now), "demain 09:00");
  assert.equal(R.quandRappel(ms(20, 10, 9, 5), now), "mar. 20 oct. 09:05");
  assert.equal(R.quandRappel(ms(3, 1, 9, 0, 2027), now), "dim. 3 janv. 2027 09:00");
  assert.equal(R.phraseAttenteMotion({ enFile: 2, attenteMs: 18200, quotaParMinute: 12 }), "En file chez Motion : ~20 s (12 requêtes par minute). Rien à refaire, ça part tout seul.");
  assert.equal(R.phraseAttenteMotion({ enFile: 1, attenteMs: 1500 }), null, "moins de 2 s : rien à dire");
  assert.equal(R.phraseAttenteMotion({ enFile: 9, attenteMs: 125000 }), "En file chez Motion : ~2 min. Rien à refaire, ça part tout seul.");
});

test("Noter : l'aperçu et le bouton parlent comme l'iPhone (CaptureView)", () => {
  const now = date(15, 10, 10, 40);
  const ap = (t, genre = null) => apercu(t, { maintenant: now, genre });
  const phrase = (t, o = {}) => N.phraseApercu(ap(t, o.genre), t, { maintenant: now, ...o });
  assert.equal(phrase("", { micro: true }), "Écris ou dicte : Rémy devine où le ranger.");
  assert.equal(phrase(""), "Écris, Rémy devine où le ranger.");
  assert.equal(phrase("Appeler le comptable"), "Tâche → Motion lui trouvera un créneau");
  assert.equal(phrase("Finir le devis vendredi"), "Tâche « Finir le devis » → Motion lui trouvera un créneau avant l'échéance : vendredi 16 octobre");
  assert.equal(phrase("Idée : un atelier bougies"), "Idée → gardée dans « Idées » (Projets), rien n'est planifié");
  assert.equal(phrase("Idée : un atelier bougies", { dossiers: false }), "Les Idées arriveront avec la mise à jour de ta tour.");
  assert.equal(phrase("tomates, lait et œufs", { nomListe: "Courses" }), "3 articles → Courses");
  assert.equal(phrase("tomates, lait et œufs"), "3 articles → Courses (créée)");
  assert.equal(phrase("Rappelle-moi d'appeler Léa demain à 9h"), "Rappel → demain 09:00 : « Appeler Léa »");
  assert.equal(phrase("Rappelle-moi d'appeler Léa"), "Rappel sans date (ajoute « demain 9h », « lundi », « le 12/11 »…)");
  assert.equal(phrase("Un truc à garder", { genre: "retenir" }), "Retenir → encore 14 caractères pour que Rémy en tire quelque chose");
  assert.equal(phrase("Une chose assez longue pour Rémy, vraiment.", { genre: "retenir" }), "Retenir → dans la mémoire de Rémy");
  assert.equal(phrase("Quand passe le plombier ?"), "Question → s'ouvre chez Rémy, prête à envoyer");
  assert.equal(phrase("Nouveau projet : Recrutement", { nomParent: "Boutiques" }), "Dossier « Recrutement » dans « Boutiques » (Remy ; pas de projet Motion)");
  assert.equal(phrase("Nouveau projet : Recrutement"), "Dossier « Recrutement » à part (Remy ; pas de projet Motion)");
  // Le bouton : grisé tant que ce n'est pas prêt.
  assert.equal(N.prete(ap("Un truc à garder", "retenir"), "Un truc à garder"), false);
  assert.equal(N.prete(ap("tomates, lait"), "tomates, lait", { carnet: false }), false, "liste sans listes-v1");
  assert.equal(N.prete(ap("Nouveau projet X"), "Nouveau projet X", { dossiers: false }), false);
  assert.equal(N.prete(ap("Quand passe le plombier ?"), "Quand passe le plombier ?"), true);
  assert.equal(N.prete(ap(""), "   "), false);
  assert.deepEqual(Object.keys(N.ACTIONS).map((g) => N.ACTIONS[g]), ["Ajouter à Motion", "Garder l'idée", "Ajouter à la liste", "Créer le rappel", "Retenir", "Ouvrir chez Rémy", "Créer le dossier"]);
});

// --- Les cartes de proposition (PropositionView, Format.detailAction) ---

test("proposition : un verbe par ligne (liste blanche), le nom, le détail", () => {
  assert.equal(P.verbe({ type: "creer" }), "Ajouter");
  assert.equal(P.verbe({ type: "terminer" }), "Marquer fait");
  assert.equal(P.verbe({ type: "supprimer" }), "Supprimer");
  assert.equal(P.verbe({ type: "<script>" }), "Modifier", "jamais le type brut");
  assert.equal(P.libelleAction({ nom: "A", nouveau_nom: "B" }), "B");
  assert.equal(P.libelleAction({ titre: "Rdv" }), "Rdv");
  assert.equal(P.libelleAction({}), "(sans nom)");
  const iso = (d) => R.isoAvecFuseau(d);
  assert.equal(P.detailAction({ debut: iso(date(30, 10, 9)), lieu: "Cabinet Voltaire" }, true), "ven. 30 oct. à 09:00 · Cabinet Voltaire");
  assert.equal(P.detailAction({ echeance: iso(date(31, 10, 23)), duree: 30, priorite: "ASAP" }), "avant le sam. 31 oct. · 30 min · urgent");
  assert.equal(P.detailAction({ echeance: iso(date(31, 10, 13)), duree: "120", priorite: "HIGH" }), "avant le sam. 31 oct. à 13:00 · 2 h · important");
  assert.equal(P.detailAction({ echeance: "2026-10-31", duree: "REMINDER" }), "avant le sam. 31 oct. · simple rappel", "une date seule : sans heure");
  assert.equal(P.detailAction({ echeance: iso(date(31, 10, 13)) }, true), "", "l'agenda n'a pas d'échéance");
  assert.equal(P.detailAction({ duree: "NONE", priorite: "LOW" }), "");
});

test("proposition : l'en-tête avant et après « Oui »", () => {
  const actions = [{ type: "creer", nom: "A" }, { type: "creer", nom: "B" }, { type: "creer", nom: "C" }];
  assert.equal(P.entete({ actions, statut: "en_attente" }), "Rémy propose de changer ton planning");
  assert.equal(P.entete({ actions, source: "agenda" }), "Rémy propose de changer ton agenda");
  assert.equal(P.entete({ actions, statut: "applique", bilan: { faits: ["A", "B", "C"], echoues: [] } }), "C'est fait dans ton planning");
  assert.equal(P.entete({ actions, statut: "applique", source: "agenda", bilan: { faits: ["A", "B"], echoues: [], ecartees: ["C"] } }), "C'est fait dans ton agenda (2 sur 3)");
  assert.equal(P.entete({ actions, statut: "applique", bilan: { faits: ["A"], echoues: [{ nom: "B", erreur: "x" }], ecartees: ["C"] } }), "En partie fait");
  assert.equal(P.entete({ actions, statut: "applique", bilan: { faits: [], echoues: actions.map((a) => ({ nom: a.nom, erreur: "x" })) } }), "Rien n'a pu être fait");
  assert.equal(P.entete({ actions, statut: "applique", bilan: { faits: [], echoues: [], dejaLa: ["A"] } }), "Déjà dans ton planning : rien à ajouter");
  assert.equal(P.entete({ actions, statut: "applique", annulee: true, bilan: { faits: ["A"] } }), "Annulé : tout est revenu comme avant.");
  assert.equal(P.entete({ actions, statut: "applique", annulationRatee: [{ nom: "A", erreur: "modifiée" }] }), "Annulation incomplète");
  assert.equal(P.entete({ actions, statut: "echec", bilan: { echoues: [{ nom: null, erreur: "Motion ne répond pas" }] } }), "Pas fait : Motion ne répond pas");
  assert.equal(P.entete({ actions, statut: "echec", bilan: { echoues: [{ nom: "B", erreur: "quota" }] } }), "Rien n'a pu être fait", "la raison est sous la ligne");
  assert.equal(P.entete({ actions: [], statut: "converti" }), "Rangé dans tes rappels");
});

test("proposition : rangée en rappels, la carte reste ; refusée ou vide, elle s'en va", () => {
  assert.equal(P.carteCachee({ actions: [], statut: "converti" }), false, "« Rangé dans tes rappels », comme sur l'iPhone");
  assert.equal(P.carteCachee({ statut: "converti" }), false);
  assert.equal(P.carteCachee({ actions: [{ type: "creer", nom: "A" }], statut: "refuse" }), true, "« Non merci »");
  assert.equal(P.carteCachee({ actions: [], statut: "en_attente" }), true, "rien à proposer");
  assert.equal(P.carteCachee({ actions: [{ type: "creer", nom: "A" }], statut: "en_attente" }), false);
});

test("proposition : ligne par ligne, raté, écarté, défait", () => {
  const p = { statut: "applique", actions: [{ nom: "A" }, { nom: "B" }, { nom: "C" }], bilan: { faits: ["A"], echoues: [{ nom: "B", erreur: "quota Motion" }], ecartees: ["C"] } };
  assert.equal(P.erreurAffichee(p, p.actions[1]), "Pas fait : quota Motion");
  assert.equal(P.erreurAffichee(p, p.actions[0]), null);
  assert.equal(P.estEcartee(p, p.actions[2]), true);
  assert.equal(P.erreurAffichee(p, p.actions[2]), null, "écartée : barrée, pas en rouge");
  const q = { ...p, annulationRatee: [{ nom: "A", erreur: "modifiée depuis" }] };
  assert.equal(P.erreurAffichee(q, q.actions[0]), "Pas défait : modifiée depuis");
  assert.equal(P.estDefaite(q, q.actions[0]), false);
  assert.equal(P.estDefaite(q, q.actions[1]), true);
  assert.equal(P.estDefaite({ annulee: true }, { nom: "X" }), true);
  assert.equal(P.ouFait({ bilan: { espace: "Perso" } }), "Fait, dans « Perso ».");
  assert.equal(P.ouFait({ source: "agenda" }), "Fait, dans ton agenda.");
  assert.equal(P.ouFait({}), "Fait, dans ton planning.");
  assert.equal(P.rangeesEnRappels({ actionsOrigine: [1, 2, 3], actions: [1] }), 2);
});

test("proposition : une partie seulement (SelectionLignes) et l'aide", () => {
  assert.equal(P.libelleOui(3, 3), "Oui, fais-le");
  assert.equal(P.libelleOui(3, 0), "Rien de coché");
  assert.equal(P.libelleOui(3, 1), "Oui, celle-ci");
  assert.equal(P.libelleOui(3, 2), "Oui, les 2");
  const actions = [{ rang: 0 }, { rang: 3 }, {}];
  assert.equal(P.rangsGardes(actions, new Set()), null, "rien de décoché : tout part");
  assert.deepEqual(P.rangsGardes(actions, new Set([3])), [0, 2], "le rang d'origine, sinon la position");
  assert.equal(P.aideReglage({ partielle: true, ajustable: true }), "Décoche ce que tu ne veux pas ; touche une ligne pour la régler.");
  assert.equal(P.aideReglage({ partielle: true, ajustable: false }), "Décoche ce que tu ne veux pas.");
  assert.equal(P.aideReglage({ partielle: false, ajustable: true }), "Touche une ligne pour régler la date, la durée ou la catégorie, ou en faire un rappel.");
  assert.equal(P.aideReglage({}), "Pour changer un détail, réponds-le simplement à Rémy.");
});

test("proposition : le bilan d'une réponse et le bandeau", () => {
  const p = { actions: [{ nom: "A" }, { nom: "B" }, { nom: "C" }] };
  const r = { etat: "appliquee_partiellement", ledgerId: "j1", results: [{ ok: true, nom: "A", espace: "Perso" }, { ok: false, nom: "B", erreur: "quota" }], ecartees: ["C"] };
  const b = P.bilanDeReponse(r);
  assert.deepEqual(b, { faits: ["A"], echoues: [{ nom: "B", erreur: "quota" }], espace: "Perso", ecartees: ["C"] });
  assert.equal(P.statutDeReponse(r), "applique");
  assert.equal(P.statutDeReponse({ etat: "echouee", results: [{ ok: false }] }), "echec");
  assert.equal(P.statutDeReponse({ etat: "echouee", results: [{ ok: false, erreur: "« A » existe déjà dans Motion" }] }), "applique", "un vieux doublon n'est pas un échec");
  assert.equal(P.phraseApplication(p, r, b), "1 changement sur 3 n'a pas pu être fait : la raison est sous la ligne.");
  const r0 = { etat: "echouee", results: [{ ok: false, nom: "A", erreur: "x" }, { ok: false, nom: "B", erreur: "y" }], ecartees: ["C"] };
  assert.equal(P.phraseApplication(p, r0, P.bilanDeReponse(r0)), "Rien n'a pu être fait : la raison est sous chaque ligne.", "tout ce qui partait a raté (une ligne écartée)");
  const r2 = { results: [{ ok: true, nom: "A" }, { ok: false, nom: "B", erreur: "x" }, { ok: true, nom: "C" }] };
  assert.equal(P.phraseApplication(p, r2, P.bilanDeReponse(r2)), "1 changement sur 3 n'a pas pu être fait : la raison est sous la ligne.");
  const r3 = { results: [{ ok: true, nom: "A" }, { ok: false, nom: "B", erreur: "x" }, { ok: false, nom: "C", erreur: "y" }, { ok: true, nom: "D" }] };
  assert.equal(P.phraseApplication({ actions: [1, 2, 3, 4] }, r3, P.bilanDeReponse(r3)), "2 changements sur 4 n'ont pas pu être faits : la raison est sous la ligne.");
  const ok = { results: [{ ok: true, nom: "A", espace: "Perso" }] };
  assert.equal(P.phraseApplication({ actions: [1] }, ok, P.bilanDeReponse(ok)), "C'est fait dans « Perso ».");
  assert.equal(P.phraseApplication({ actions: [1, 2], source: "agenda" }, { results: [{ ok: true, titre: "R" }], ecartees: ["S"] }, { echoues: [], ecartees: ["S"] }), "C'est fait dans ton agenda (1 sur 2).");
  assert.equal(P.phraseApplication(p, { etat: "deja_la", results: [] }, { echoues: [] }), "Déjà dans ton planning : rien à ajouter.");
});

test("règle et carnet : ce que dit la carte", () => {
  assert.equal(P.phraseRegle({ regles: [{ deja: true }] }), "Cette règle existait déjà : rien n'a changé.");
  assert.equal(P.phraseRegle({ regles: [{ deja: false, fusionnee: true }] }), "Règle mise à jour comme sur la carte : Rémy te proposera la tâche avant chaque événement qui correspond.");
  assert.equal(P.phraseRegle({ regles: [{ id: "r1" }] }), "Règle créée : Rémy te proposera la tâche avant chaque événement qui correspond.");
  assert.equal(P.quandCarnet(R.isoAvecFuseau(date(30, 10, 9))), "Rappel · ven. 30 oct., 09:00");
  assert.equal(P.quandCarnet(null), "Rappel sans heure");
});

// --- Ajuster une ligne (AjusterAction.swift) ---

test("ajuster : l'état de départ, sans date : demain soir (Motion) ou demain 9 h (agenda)", () => {
  const now = date(15, 10, 10, 40);
  const e = A.etatInitial({ type: "creer", nom: "Acheter abonnement", duree: 10 }, { maintenant: now });
  assert.equal(e.avecDate, false);
  assert.equal(e.quand.getTime(), ms(16, 10, 23), "échéance J+1 23 h (Format.echeanceDans)");
  assert.equal(e.duree, 10);
  assert.equal(e.priorite, "MEDIUM");
  const g = A.etatInitial({ type: "creer", titre: "Studio", debut: R.isoAvecFuseau(date(17, 10, 14)), fin: R.isoAvecFuseau(date(17, 10, 16)) }, { versAgenda: true, maintenant: now });
  assert.equal(g.avecDate, true, "un rendez-vous a toujours son heure");
  assert.equal(g.duree, 120, "la durée lue entre le début et la fin");
  assert.equal(A.etatInitial({ type: "creer", titre: "X" }, { versAgenda: true, maintenant: now }).quand.getTime(), ms(16, 10, 9));
  assert.equal(A.etatInitial({ type: "modifier", nom: "A", nouveau_nom: "B" }).nom, "B");
});

test("ajuster : seuls les champs changés partent, avec les bonnes clés", () => {
  const now = date(15, 10, 10, 40);
  const e = A.etatInitial({ type: "creer", nom: "A", duree: 10 }, { maintenant: now });
  assert.deepEqual(A.champsChanges(e), {}, "rien changé : rien ne part (Enregistrer reste grisé)");
  e.nom = "  B  ";
  e.duree = 30;
  e.priorite = "HIGH";
  assert.deepEqual(A.champsChanges(e), { nom: "B", duree: 30, priorite: "HIGH" });
  e.avecDate = true;
  assert.match(A.champsChanges(e).echeance, /^2026-10-16T23:00:00\+02:00$/, "l'échéance avec le décalage de Paris");
  const avec = A.etatInitial({ type: "creer", nom: "A", echeance: R.isoAvecFuseau(date(20, 10, 23)) }, { maintenant: now });
  avec.avecDate = false;
  assert.deepEqual(A.champsChanges(avec), { echeance: null }, "enlever l'échéance : null");
  const cat = A.etatInitial({ type: "creer", nom: "Vidange", etiquettes: ["x"] });
  cat.etiquettes = new Set(["et-voiture"]);
  assert.deepEqual(A.champsChanges(cat, { categoriesPossibles: true, etiquettesValides: ["et-voiture"] }), { etiquettes: ["et-voiture"] });
  assert.deepEqual(A.champsChanges(cat, { categoriesPossibles: false }), {}, "sans categories-taches-v1 : pas de catégorie");
  const m = A.etatInitial({ type: "modifier", nom: "Ancien" });
  m.nom = "Nouveau";
  assert.deepEqual(A.champsChanges(m), { nouveau_nom: "Nouveau" });
  const g = A.etatInitial({ type: "creer", titre: "Studio", debut: R.isoAvecFuseau(date(17, 10, 14)) }, { versAgenda: true, maintenant: now });
  g.duree = 90;
  assert.deepEqual(A.champsChanges(g, { versAgenda: true }), { debut: "2026-10-17T14:00:00+02:00", fin: "2026-10-17T15:30:00+02:00" }, "agenda : début + fin");
  g.nom = "Studio photo";
  assert.equal(A.champsChanges(g, { versAgenda: true }).titre, "Studio photo");
  const g2 = A.etatInitial({ type: "creer", titre: "R" }, { versAgenda: true, maintenant: now });
  g2.quand = date(18, 10, 10);
  assert.equal(A.champsChanges(g2, { versAgenda: true }).fin, "2026-10-18T11:00:00+02:00", "60 min par défaut");
});

test("ajuster : raccourcis de jour, rappel à une heure où l'on est debout", () => {
  const now = date(15, 10, 10, 40);
  assert.equal(A.avecJour(date(20, 10, 18, 15), 1, now).getTime(), ms(16, 10, 18, 15), "« Demain » garde l'heure");
  assert.equal(A.avecJour(date(20, 10, 18, 15), 7, now).getTime(), ms(22, 10, 18, 15));
  assert.equal(A.raccourciActif(date(16, 10, 18, 15), 1, now), true, "demain : « Demain »");
  assert.equal(A.raccourciActif(date(18, 10, 9), 3, now), true, "J+3 : « Dans 3 jours »");
  assert.deepEqual(A.RACCOURCIS.filter(([, j]) => A.raccourciActif(date(20, 10, 10), j, now)), [], "J+5 tapé à la main : aucun raccourci");
  assert.equal(A.versRappel(date(16, 10, 23)).getTime(), ms(16, 10, 9), "23 h → 9 h");
  assert.equal(A.versRappel(date(16, 10, 14)).getTime(), ms(16, 10, 14));
  assert.equal(A.phraseRangeEnRappel(date(16, 10, 9)), "Rangé en rappel, ven. 16 oct. 09:00.");
  assert.equal(A.phraseRangeEnRappel(null), "Rangé en rappel, sans date.");
  assert.deepEqual(A.DUREES, [5, 10, 15, 30, 45, 60, 90, 120]);
  assert.deepEqual(A.PRIORITES.map((p) => p[1]), ["Urgente", "Importante", "Normale", "Basse"]);
});

// --- Retenir, la dictée, l'appel ---

test("Retenir : les mots de la feuille", () => {
  assert.equal(T.nomSource("note"), "ta note");
  assert.equal(T.nomSource("chatgpt"), "cette réponse de ChatGPT");
  assert.equal(T.nomSource("claude"), "cette réponse de Claude");
  assert.equal(T.libelleRetenir(1), "Retenir 1 info");
  assert.equal(T.libelleRetenir(3), "Retenir 3 infos");
});

test("Retenir : chaque geste a son idCapture, le même au renvoi (capture-idempotente-v1)", () => {
  const base = "3f2a9c1e-7b4d-4e8a-9c21-5d6e7f8a9b0c";
  const infos = ["Reprend la boutique à plein temps en janvier", "Ne travaille plus le dimanche"];
  const choix = T.idGeste(base, "c", infos);
  assert.equal(T.idGeste(base, "c", [...infos]), choix, "le renvoi des mêmes cases : le même");
  assert.notEqual(T.idGeste(base, "c", infos.slice(0, 1)), choix, "d'autres cases : un autre");
  assert.notEqual(T.idGeste(base, "t", infos.join("\n")), choix, "tout le texte n'est pas la sélection");
  assert.notEqual(T.idGeste(base, "t", "Un autre texte"), T.idGeste(base, "t", "Un texte"), "un texte changé : un autre");
  assert.notEqual(T.idGeste("autre-capture-1234", "c", infos), choix, "une autre capture : un autre");
  // La forme que la tour reconnaît (cleCapture, lib/handlers.js) ; sinon elle retiendrait deux fois.
  for (const id of [choix, T.idGeste(base, "t", "x".repeat(5000))]) assert.match(id, /^[A-Za-z0-9_-]{8,100}$/);
});

test("dictée : la barre, le plafond, trop court", () => {
  assert.equal(D.mss(0), "0:00");
  assert.equal(D.mss(65.4), "1:05");
  assert.equal(D.texteBarre(10), "Je t'écoute…");
  assert.equal(D.texteBarre(D.DUREE_MAX - 61), "Je t'écoute…");
  assert.equal(D.texteBarre(D.DUREE_MAX - 45), "Encore 45 s", "la dernière minute se voit");
  assert.equal(D.texteBarre(D.DUREE_MAX - 45.2), "Encore 46 s", "les secondes entières écoulées, comme la barre de l'iPhone");
  assert.equal(D.texteBarre(D.DUREE_MAX + 3), "Encore 0 s");
  assert.equal(D.DUREE_MAX, 900, "15 minutes");
  assert.equal(D.assezLong(0.4, 5000), false);
  assert.equal(D.assezLong(2, 999), false);
  assert.equal(D.assezLong(0.5, 1000), true);
  assert.equal(D.delaiTranscription(600), 720000, "le délai grandit avec le vocal (testUnVocalLongALeTempsDEtreTranscrit)");
  assert.equal(D.phrasePasParti("Dictée Locale ne répond pas."), "Ton vocal n'est pas parti — Dictée Locale ne répond pas. Il t'attend : touche « Renvoyer ».");
  assert.equal(D.disponible(), false, "sous node : pas de micro");
  assert.equal(D.SANS_TRANSCRIPTION, "La dictée n'est pas branchée sur la tour : rien ne peut transcrire ta voix pour l'instant.");
});

/** Rejoue des volumes, une mesure toutes les 100 ms (DetecteurParoleTests.rejouer). */
function rejouer(d, morceaux) {
  let t = 0;
  for (const [db, duree] of morceaux) {
    const fin = t + duree;
    while (t < fin - 1e-9) {
      t = Math.round((t + 0.1) * 10) / 10;
      const v = d.analyser(db, t);
      if (v !== "continuer") return [v, t];
    }
  }
  return ["continuer", t];
}

test("appel : la fin de parole (DetecteurParoleTests)", () => {
  let [v, t] = rejouer(new V.DetecteurParole(), [[-55, 0.5], [-20, 2], [-55, 3]]);
  assert.equal(v, "finDeParole");
  assert.ok(Math.abs(t - (2.5 + 1.7)) <= 0.11, `≈ 1,7 s de silence après la voix (${t})`);
  [v] = rejouer(new V.DetecteurParole(), [[-55, 0.5], [-20, 1], [-55, 1], [-22, 1]]);
  assert.equal(v, "continuer", "une pause d'une seconde n'est pas une fin de phrase");
  [v, t] = rejouer(new V.DetecteurParole(), [[-55, 40]]);
  assert.equal(v, "rienEntendu");
  assert.ok(Math.abs(t - 30) <= 0.11);
  const rue = new V.DetecteurParole();
  [v] = rejouer(rue, [[-42, 5]]);
  assert.equal(v, "continuer", "une rue bruyante à −42 dB n'est pas de la voix");
  assert.equal(rue.parole, false);
  assert.equal(rue.seuil, -35 + 12 > -50 ? Math.max(Math.min(-42, -35) + 12, -50) : -50);
  [v, t] = rejouer(new V.DetecteurParole(), [[-55, 0.4], [-20, 95]]);
  assert.equal(v, "finDeParole", "90 s max");
  assert.ok(t <= 90.6);
  assert.equal(V.DetecteurParole.normaliser(-160), 0);
  assert.equal(V.DetecteurParole.normaliser(0), 1);
});

test("appel : la voix ne lit ni Markdown ni lien (ParoleTests), voix locales seulement", () => {
  assert.equal(V.pourVoix("**Oui.** Regarde [le site](https://exemple.fr/page) ou https://autre.fr. [COUVERT:tete/vrac]"), "Oui. Regarde le site ou (lien)");
  assert.equal(V.pourVoix("Je ré\n\n*(interrompu)*"), "Je ré");
  assert.equal(V.pourVoix("Voici :\n```js\nx()\n```\nfin"), "Voici : (code) fin");
  const voix = [
    { name: "En ligne", lang: "fr-FR", localService: false },
    { name: "Amélie", lang: "fr-CA", localService: true },
    { name: "Thomas", lang: "fr-FR", localService: true },
    { name: "Daniel", lang: "en-GB", localService: true },
  ];
  assert.deepEqual(V.voixLocales(voix).map((v) => v.name), ["Thomas", "Amélie"], "jamais une voix en ligne (aucun nouveau tiers), le français de France d'abord");
  assert.deepEqual(V.voixLocales([]), []);
  assert.equal(V.textesEtat("ecoute").titre, "Parle quand tu veux");
  assert.equal(V.textesEtat("ecoute", { parleDeja: true }).titre, "Je t'écoute…");
  assert.equal(V.textesEtat("transcription").sous, "Sur ta tour : l'audio n'est pas gardé.");
  assert.equal(V.textesEtat("reflexion").sous, "Réponse courte, à voix haute.");
  assert.equal(V.textesEtat("reflexion", { statut: "Je relis ton planning" }).sous, "Je relis ton planning");
  assert.equal(V.textesEtat("parole").sous, "Le micro est coupé. Touche le carré pour me couper.");
  assert.deepEqual(V.textesEtat("erreur", { message: "Micro refusé" }), { titre: "Ça coince", sous: "Micro refusé" });
});

test("les modules du lot sont dans le cache hors ligne (sw.js) et sans tiers", () => {
  const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  for (const f of ["/app/analyse/etiquettes.js", "/app/analyse/rangement.js", "/app/dictee.js", "/app/vues/retenir.js", "/app/vues/propositions.js", "/app/vues/ajuster.js", "/app/vues/appel.js"]) assert.ok(sw.includes(`"${f}"`), f);
  const appel = fs.readFileSync(new URL("../public/app/vues/appel.js", import.meta.url), "utf8");
  assert.match(appel, /localService === true/, "la voix : locale seulement");
  const dictee = fs.readFileSync(new URL("../public/app/dictee.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(dictee, /localStorage|indexedDB|caches\./, "l'audio n'est jamais gardé");
});

// --- Contre les vraies routes de la tour (faux Motion, faux Google) ---

const evenements = new Map();
let suivantEv = 1;
const google = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://g");
    const json = (code, v) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(v === undefined ? "" : JSON.stringify(v));
    };
    if (u.pathname === "/token") return json(200, { access_token: "faux", expires_in: 3600 });
    const b = corps ? JSON.parse(corps) : null;
    if (/\/events$/.test(u.pathname)) {
      if (req.method === "GET") return json(200, { items: [...evenements.values()] });
      const ev = { id: `e${suivantEv++}`, status: "confirmed", ...b };
      evenements.set(ev.id, ev);
      return json(200, ev);
    }
    const m = u.pathname.match(/\/events\/([^/]+)$/);
    const ev = m && evenements.get(decodeURIComponent(m[1]));
    if (!ev) return json(404, { error: "not found" });
    if (req.method === "DELETE") {
      evenements.delete(ev.id);
      return json(204);
    }
    return json(200, ev);
  });
});
await new Promise((r) => google.listen(0, "127.0.0.1", r));
const motion = await demarrerFauxMotion();
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-site-noter-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "MOTION_WORKSPACE_ID", "MOTION_WRITE", "REMY_MOTION_HORAIRE", "REMY_GLM_URL"]) delete process.env[v];
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
const { CAPACITES } = await import("../lib/version.js");
const { fermer: fermerBase } = await import("../lib/db.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(async () => {
  remy.close();
  google.close();
  await motion.fermer();
  fermerBase();
  fs.rmSync(dossier, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** Comme api.js : JSON, et une erreur lisible (message de la tour, statut). */
const appel = async (chemin, { methode = "GET", corps } = {}) => {
  const r = await fetch(base + chemin, { method: methode, headers: { Accept: "application/json", ...(corps !== undefined ? { "Content-Type": "application/json" } : {}) }, body: corps === undefined ? undefined : JSON.stringify(corps) });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(d?.message || d?.error || `Erreur ${r.status}`), { statut: r.status, nature: "serveur" });
  return d;
};
let n = 0;
const nouvelId = () => `cmd-test-${++n}`;

test("contrat : les capacités que le site attend sont annoncées par la tour", () => {
  for (const c of ["analyse-capture-v1", "retenir-choix-v1", "dossiers-v1", "listes-v1", "rappels-v1", "etiquettes-v1", "propositions-ajustables-v1", "propositions-partielles-v1", "categories-taches-v1", "regles-v1", "deja-la-v1"]) assert.ok(CAPACITES.includes(c), c);
});

test("ranger une capture validée : chaque nature à sa place (OrganisationTests.testRangerUneCaptureValidee)", async () => {
  const connu = { listes: [], dossiers: [], projets: [{ id: "p1", nom: "Boutiques" }] };
  const appels = [];
  const espion = (chemin, o = {}) => {
    appels.push({ chemin, methode: o.methode || "GET", corps: o.corps });
    return appel(chemin, o);
  };
  const elements = [
    { cle: "1", nature: "tache", titre: "Faire la lessive", quand: samedi, heureConnue: false, dureeMin: 30 },
    { cle: "2", nature: "contrainte", titre: "Dispo limitée samedi", quand: samedi, heureConnue: false },
    { cle: "3", nature: "rendez-vous", titre: "Studio", quand: samedi + 5 * 3600_000, heureConnue: true, dureeMin: 120 },
    { cle: "4", nature: "rendez-vous", titre: "Soirée chez Yanis", quand: null, heureConnue: false },
    { cle: "5", nature: "liste", titre: "Courses", liste: "Courses", articles: ["tomates", "lait"] },
    { cle: "6", nature: "note", titre: "Le code du portail est 1234" },
    { cle: "7", nature: "projet", titre: "Site vitrine", parent: "Boutiques" },
  ];
  const bilan = await R.ranger(elements, { appel: espion, connu, agenda: true, graine: "essai", nouvelId });
  assert.equal(bilan.faits.length, 6, R.phraseBilan(bilan));
  assert.deepEqual(bilan.echecs, ["« Soirée chez Yanis » : heure manquante"]);
  assert.deepEqual(bilan.regles.sort(), ["1", "2", "3", "5", "6", "7"], "le raté n'est pas réglé : il reste coché");
  // La tâche part avec son échéance et sa durée, marquée « capture » (historique), en UNE écriture.
  const motionAppels = appels.filter((a) => a.chemin === "/api/motion/apply");
  assert.equal(motionAppels.length, 1, "rien en double");
  assert.equal(motionAppels[0].corps.origine, "capture");
  assert.ok(motionAppels[0].corps.idCommande);
  assert.equal(motionAppels[0].corps.actions[0].nom, "Faire la lessive");
  assert.equal(motionAppels[0].corps.actions[0].duree, 30);
  assert.ok(motionAppels[0].corps.actions[0].echeance);
  // Le rendez-vous à heure connue va dans l'agenda, avec sa durée.
  const agenda = appels.find((a) => a.chemin === "/api/google/apply");
  assert.equal(agenda.corps.actions[0].duree, 120);
  assert.equal(agenda.corps.actions[0].titre, "Studio");
  assert.ok([...evenements.values()].some((e) => e.summary === "Studio"), "écrit dans le (faux) agenda");
  // La contrainte devient un rappel ce jour-là (pas un créneau), la liste reçoit ses articles.
  const rappels = (await appel("/api/rappels")).rappels;
  assert.ok(rappels.some((r) => r.texte === "Dispo limitée samedi" && r.quand === samedi));
  const listes = (await appel("/api/listes")).listes;
  assert.deepEqual(listes.find((l) => l.nom === "Courses").elements.map((e) => e.texte), ["tomates", "lait"], "la liste créée au besoin");
  const dossiers = (await appel("/api/dossiers")).dossiers;
  assert.deepEqual(dossiers.find((d) => d.id === "notes")?.notes.map((x) => x.texte), ["Le code du portail est 1234"], "le dossier « Notes », créé au besoin");
  assert.equal(dossiers.find((d) => d.id === "notes").ordre, -1);
  assert.equal(dossiers.find((d) => d.nom === "Site vitrine")?.parent, "motion:p1", "le projet sous son parent");
  // Le même rangement, rejoué : tout est déjà là (jamais « ajouté » deux fois).
  const encore = await R.ranger(elements.filter((e) => ["1", "5"].includes(e.cle)), { appel, connu, agenda: true, graine: "essai-2", nouvelId });
  assert.deepEqual(encore.faits, []);
  assert.deepEqual(encore.dejaLa, ["« tomates », « lait » (liste « Courses »)", "« Faire la lessive » (Motion)"]);
  assert.equal(R.phraseBilan(encore), "Rien de nouveau, déjà là : « tomates », « lait » (liste « Courses ») ; « Faire la lessive » (Motion).");
});

test("ranger : sans agenda, un rendez-vous daté devient un rappel ; 13 tâches = 3 écritures", async () => {
  const appels = [];
  const espion = (chemin, o = {}) => {
    appels.push(chemin);
    return appel(chemin, o);
  };
  const quand = ms(5, 11, 18);
  const taches = Array.from({ length: 13 }, (_, i) => ({ cle: `t${i}`, nature: "tache", titre: `Tâche numéro ${i + 1}` }));
  const bilan = await R.ranger([{ cle: "r", nature: "rendez-vous", titre: "Dentiste", quand, heureConnue: true }, ...taches], { appel: espion, connu: {}, agenda: false, graine: "lot", nouvelId });
  assert.equal(appels.filter((c) => c === "/api/motion/apply").length, 3, "par lots de 6");
  assert.ok(!appels.includes("/api/google/apply"));
  assert.ok(bilan.faits.includes("« Dentiste » (rappel : agenda non branché)"));
  assert.equal(bilan.faits.length, 14);
  assert.ok((await appel("/api/rappels")).rappels.some((r) => r.texte === "Dentiste" && r.quand === quand), "à son heure");
});

test("ranger : un échec par ligne (Motion refuse une tâche), seul le raté reste à refaire", async () => {
  motion.pannes.push({ methode: "POST", chemin: /\/tasks$/, code: 400, fois: 1, corps: { message: "Nom refusé par Motion" } });
  const bilan = await R.ranger([
    { cle: "a", nature: "tache", titre: "Première tâche refusée" },
    { cle: "b", nature: "tache", titre: "Deuxième tâche acceptée" },
    { cle: "c", nature: "note", titre: "Une note qui passe" },
  ], { appel, connu: {}, agenda: true, graine: "panne", nouvelId });
  assert.equal(bilan.echecs.length, 1, R.phraseBilan(bilan));
  assert.match(bilan.echecs[0], /^« Première tâche refusée » : /);
  assert.deepEqual(bilan.regles.sort(), ["b", "c"]);
  assert.match(R.phraseBilan(bilan), /^2 rangés ; pas fait : « Première tâche refusée » : /);
});

test("ranger : la tour coupée, toutes les écritures ratent avec leur raison", async () => {
  const coupe = async () => {
    throw Object.assign(new Error("La tour ne répond pas."), { nature: "reseau" });
  };
  const bilan = await R.ranger([{ cle: "a", nature: "tache", titre: "A" }, { cle: "b", nature: "rappel", titre: "B" }], { appel: coupe, connu: {}, graine: "x", nouvelId });
  assert.deepEqual(bilan.echecs, ["« B » : La tour ne répond pas.", "« A » : La tour ne répond pas."]);
  assert.deepEqual(bilan.regles, []);
  let auth = 0;
  await R.ranger([{ cle: "a", nature: "note", titre: "A" }], { appel: async () => { throw Object.assign(new Error("session"), { nature: "auth" }); }, connu: {}, surAuth: () => auth++ });
  assert.equal(auth, 1, "401 : la reconnexion est signalée");
});

test("Noter : déjà là dans une liste et dans les rappels (lib/carnet.js), comme le lit le site", async () => {
  await appel("/api/listes/l-essai", { methode: "PUT", corps: { nom: "Marché", ordre: 0 } });
  await appel("/api/listes/l-essai/elements", { methode: "POST", corps: { elements: [{ id: "x1", texte: "Tomates", fait: false }] } });
  const r = await appel("/api/listes/l-essai/elements", { methode: "POST", corps: { elements: [{ id: "n1", texte: "tomates", fait: false }, { id: "n2", texte: "beurre", fait: false }] } });
  assert.deepEqual(r.dejaLa.map((x) => x.id), ["n1"], "la tour rend l'existant, par l'id envoyé");
  const deja = new Set(r.dejaLa.map((x) => x.id));
  assert.equal(R.phraseListe("Marché", ["beurre"], ["tomates"].filter(() => deja.has("n1"))), "1 article dans « Marché ». Déjà dans ta liste : « tomates ».");
  await appel("/api/rappels", { methode: "POST", corps: { rappels: [{ id: "ra", texte: "Rendre le livre à Léa", quand: null }] } });
  const r2 = await appel("/api/rappels", { methode: "POST", corps: { rappels: [{ id: "rb", texte: "rendre le livre à Léa", quand: null, etiquettes: [] }] } });
  assert.equal(r2.dejaLa.length, 1, "« Déjà dans tes rappels »");
  const r3 = await appel("/api/motion/apply", { methode: "POST", corps: { actions: [{ type: "creer", nom: "Faire la lessive" }], resume: "Noté depuis le site", origine: "capture", idCommande: nouvelId() } });
  assert.equal(R.toutDejaLa(r3), true, "« Déjà dans Motion »");
});

async function conversation(id, proposal) {
  await store.putConversation({
    id, title: "t", createdAt: Date.now(), updatedAt: Date.now(),
    messages: [{ role: "user", content: "x" }, { role: "assistant", content: "je propose", proposal }],
  });
}

test("proposition : Oui sur une partie, bilan ligne par ligne, annuler, « Déjà annulé » est un succès", async () => {
  await conversation("cp", { id: "p-cp", source: "motion", resume: "r", statut: "en_attente", actions: [
    { type: "creer", nom: "Imprimer les étiquettes", duree: 30 }, { type: "creer", nom: "Appeler le stand", duree: 10 }, { type: "creer", nom: "Préparer la caisse", duree: 45 },
  ] });
  const p = (await appel("/api/conversations/cp")).messages[1].proposal;
  const r = await appel("/api/motion/apply", { methode: "POST", corps: { actions: p.actions, convId: "cp", index: 1, propositionId: p.id, idCommande: nouvelId(), rangs: [0, 1], confirmer: true } });
  const b = P.bilanDeReponse(r);
  Object.assign(p, { statut: P.statutDeReponse(r), bilan: b, ledgerId: r.ledgerId });
  assert.deepEqual(b.ecartees, ["Préparer la caisse"]);
  assert.equal(P.entete(p), "C'est fait dans ton planning (2 sur 3)");
  assert.equal(P.estEcartee(p, p.actions[2]), true);
  assert.equal(P.phraseApplication(p, r, b), `C'est fait dans « ${b.espace} » (2 sur 3).`);
  const relue = (await appel("/api/conversations/cp")).messages[1].proposal;
  assert.equal(relue.statut, "applique", "la tour garde l'état");
  const u = await appel("/api/motion/undo", { methode: "POST", corps: { id: r.ledgerId } });
  assert.equal(u.ok, true);
  await assert.rejects(appel("/api/motion/undo", { methode: "POST", corps: { id: r.ledgerId } }), (e) => e.statut === 409 && /^Déjà annulé/.test(e.message), "le site lit ce 409 comme un succès");
  const journal = await appel("/api/motion/ledger");
  assert.ok(journal.entries.find((e) => e.id === r.ledgerId)?.annule, "GET /api/motion/ledger dit « annulé »");
});

test("ajuster : les clés du site acceptées par la tour, puis « Ranger en rappel » (convertis d'abord)", async () => {
  await conversation("ca", { id: "p-ca", source: "motion", resume: "r", statut: "en_attente", actions: [
    { type: "creer", nom: "Prendre rendez-vous pour la vidange", duree: 10 }, { type: "creer", nom: "Acheter du liquide", duree: 20 },
  ] });
  const e = A.etatInitial({ type: "creer", nom: "Prendre rendez-vous pour la vidange", duree: 10 });
  e.nom = "Appeler le garage pour la vidange";
  e.avecDate = true;
  e.duree = 15;
  e.priorite = "HIGH";
  const r = await appel("/api/conversations/ca/propositions/p-ca/ajuster", { methode: "POST", corps: { actions: [{ rang: 0, ...A.champsChanges(e, { categoriesPossibles: true, etiquettesValides: [] }) }], convertis: [] } });
  assert.equal(r.statut, "en_attente");
  assert.equal(r.actions[0].nom, "Appeler le garage pour la vidange");
  assert.equal(r.actions[0].duree, 15);
  assert.equal(r.actions[0].priorite, "HIGH");
  assert.ok(r.actions[0].echeance);
  const c = await appel("/api/conversations/ca/propositions/p-ca/ajuster", { methode: "POST", corps: { actions: [], convertis: [1] } });
  assert.equal(c.actions.length, 1, "la ligne sort de la proposition");
  const rap = await appel("/api/rappels", { methode: "POST", corps: { rappels: [{ id: "prop-p-ca-1", texte: "Acheter du liquide", quand: null, etiquettes: [] }] } });
  assert.deepEqual(rap.dejaLa, []);
  const encore = await appel("/api/rappels", { methode: "POST", corps: { rappels: [{ id: "prop-p-ca-1", texte: "Acheter du liquide", quand: null, etiquettes: [] }] } });
  assert.deepEqual(encore.dejaLa, [], "le même id renvoyé : réécrit, pas doublé");
  assert.equal((await appel("/api/rappels")).rappels.filter((x) => x.texte === "Acheter du liquide").length, 1);
  const tout = await appel("/api/conversations/ca/propositions/p-ca/ajuster", { methode: "POST", corps: { actions: [], convertis: [0] } });
  assert.equal(tout.statut, "converti", "tout rangé en rappels");
  const convertie = { id: "p-ca", statut: tout.statut, actions: tout.actions };
  assert.equal(P.carteCachee(convertie), false, "la carte reste dans le fil…");
  assert.equal(P.entete(convertie), "Rangé dans tes rappels", "… avec la cloche et son en-tête");
  await assert.rejects(appel("/api/conversations/ca/propositions/p-ca/ajuster", { methode: "POST", corps: { actions: [{ rang: 0, duree: 30 }] } }), (err) => err.statut === 409, "409 : la carte relit la conversation");
});

test("règle et carnet proposés : ce que la tour rend, ce que la carte en dit", async () => {
  await conversation("cr", { id: "p-cr", source: "regle", resume: "", statut: "en_attente", actions: [
    { type: "regle", nom: "Se raser avant une sortie", description: "Avant chaque sortie, une tâche « Se raser » (10 min).", mots: ["sortie", "soirée"], tache: { nom: "Se raser", duree: 10 }, delai: "2 h avant" },
  ] });
  const r = await appel("/api/conversations/cr/propositions/p-cr/regle", { methode: "POST", corps: {} });
  assert.ok(Array.isArray(r.regles) && r.regles.length === 1, JSON.stringify(r));
  assert.match(P.phraseRegle(r), /^(Règle créée|Règle mise à jour|Cette règle existait déjà)/);
  await conversation("cc", { id: "p-cc", source: "carnet", resume: "", statut: "en_attente", actions: [
    { type: "liste", liste: "Courses", articles: ["Bougies chauffe-plat"] }, { type: "rappel", texte: "Appeler Léa pour le marché" },
  ] });
  const c = await appel("/api/conversations/cc/propositions/p-cc/carnet", { methode: "POST", corps: {} });
  assert.deepEqual(c.bilan.faits, ["« Bougies chauffe-plat » dans « Courses »", "rappel « Appeler Léa pour le marché »"]);
  await appel("/api/conversations/cc/propositions/p-cc/refus", { methode: "POST", corps: {} }).then(
    () => assert.fail("une proposition appliquée ne se refuse pas"),
    (err) => assert.equal(err.statut, 409, "409 : la carte relit la conversation"),
  );
});

test("Retenir : extraire puis { choisis } (les routes de RetenirInfosVue)", async () => {
  // Sans modèle local, la tour le dit : le site affiche son message et « Réessayer ».
  await assert.rejects(appel("/api/capture/extraire", { methode: "POST", corps: { texte: "Un long texte à retenir sur la boutique et ses projets pour l'hiver.", source: "note" } }), (e) => e.statut >= 400 && e.message.length > 0);
  await assert.rejects(appel("/api/capture/analyser", { methode: "POST", corps: { texte: "Jeudi soir chez Yanis, samedi studio." } }), (e) => e.statut >= 400 && e.message.length > 0, "l'analyse aussi : un message, pas un silence");
});

// --- Une image collée ou déposée dans Noter (la feuille de partage de l'iPhone) ---
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("RÉGRESSION : une capture d'écran collée dans Noter est une image ; un collage avec du texte reste du texte", () => {
  const fichier = { name: "image.png", type: "image/png", size: 68 };
  const presse = (texte, items) => ({ getData: (t) => (t === "text/plain" ? texte : ""), items, files: [] });
  assert.equal(N.imageCollee(presse("", [{ kind: "file", type: "image/png", getAsFile: () => fichier }])), fichier);
  assert.equal(N.imageCollee(presse("Facture 42", [{ kind: "file", type: "image/png", getAsFile: () => fichier }])), null, "une partie de page copiée : le texte");
  assert.equal(N.imageCollee(presse("", [{ kind: "string", type: "text/html" }])), null);
  assert.equal(N.imageCollee(null), null);
  assert.equal(N.titreImage({ name: "Facture bougies.PNG" }), "Facture bougies");
  assert.equal(N.titreImage(fichier, true), "Image collée", "un collage n'a pas de nom à lui");
});

test("l'image rangée se dit comme sur l'iPhone (RecuPartage), l'échec dit quoi faire (EchecPartage)", () => {
  assert.deepEqual(N.recuImage({ ok: true, ajouts: [], memoire: false, message: "Image rangée dans ton coffre (Captures/Images).", image: "Captures/Images/x.png" }),
    { titre: "Image rangée.", detail: "Image rangée dans ton coffre (Captures/Images)." });
  assert.equal(N.recuImage({ ajouts: [], memoire: false, message: "Image reçue, mais cette tour ne garde pas les images." }).titre, "Image reçue.");
  const classe = N.recuImage({ ajouts: ["La facture 42 est à payer"], memoire: true, image: "Captures/Images/y.jpg" });
  assert.equal(classe.titre, "J'ai compris. Classé.");
  assert.equal(classe.detail, "Image gardée sur ta tour. Retenu : La facture 42 est à payer");
  assert.match(N.phraseEchecImage({ nature: "auth", statut: 401 }), /^Tu n'es plus connecté à la tour : l'image n'est pas partie/);
  assert.match(N.phraseEchecImage({ nature: "reseau" }), /^La tour ne répond pas : l'image n'est pas partie\. Elle reste ici/);
  assert.equal(N.phraseEchecImage({ nature: "serveur", statut: 413, message: "Image trop lourde pour la tour (3 Mo au plus) : réduis-la avant de l'envoyer." }),
    "Pas rangée : Image trop lourde pour la tour (3 Mo au plus) : réduis-la avant de l'envoyer.");
  assert.ok(N.IMAGE_MAX_OCTETS < 3_000_000, "sous la limite de la tour");
});

test("contrat : POST /api/capture/image, ce que Noter envoie : sans mot, l'image est rangée sans appel IA", async () => {
  const r = await appel("/api/capture/image", { methode: "POST", corps: { image: PNG_1PX, titre: N.titreImage({ name: "capture.png" }) } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ajouts, []);
  assert.equal(N.recuImage(r).titre.startsWith("Image"), true, JSON.stringify(r));
  await assert.rejects(appel("/api/capture/image", { methode: "POST", corps: { image: "R0lGODlhAQABAAAAACw=" } }), (err) => err.statut === 415 && /JPEG ou PNG/.test(N.phraseEchecImage(err)));
});
