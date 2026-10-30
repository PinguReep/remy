// Projets et le carnet sur le site (lot « projets » de la parité, 29/10) :
// - le module pur public/app/analyse/carnet.js, avec les cas des tests de
//   l'iPhone (CarnetTests, OrganisationTests, ErgonomieTests) : rappels à
//   traiter, filtre par étiquettes, groupes, « Plus tard », disposition des
//   listes, arborescence des dossiers, projets Motion, historique, tri ;
// - les chemins que le site écrit, joués contre les vraies routes de la tour
//   (lib/routes.js) sur des données FICTIVES : supprimer un dossier puis tout
//   remettre, ranger une tâche, une liste supprimée puis recréée, le tri des
//   rappels, l'historique paginé.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const C = await import("../public/app/analyse/carnet.js");

const date = (j, m, h, mi = 0, an = 2026) => new Date(an, m - 1, j, h, mi, 0, 0);
const ms = (...a) => date(...a).getTime();

// --- Rappels à traiter (CarnetTests.testRappelsATraiterPuisRanges) ---

test("à traiter : sans date, ou sans aucune des étiquettes du compte ; un rappel fait n'attend plus rien", () => {
  const rappels = [
    { id: "a", texte: "Caler le contrôle technique", quand: null, etiquettes: ["voiture"] },
    { id: "b", texte: "Appeler le garage", quand: ms(16, 10, 9) },
    { id: "c", texte: "Payer le loyer", quand: ms(17, 10, 9), etiquettes: ["admin"] },
    { id: "d", texte: "Ancienne étiquette", quand: ms(17, 10, 9), etiquettes: ["supprimee"] },
    { id: "e", texte: "Réserver le tennis", quand: null, fait: true },
  ];
  const etiquettes = [{ id: "voiture", nom: "Voiture" }, { id: "admin", nom: "Administratif" }];
  assert.deepEqual(C.aTraiter(rappels, etiquettes).map((r) => r.texte), ["Appeler le garage", "Ancienne étiquette", "Caler le contrôle technique"]);
  assert.deepEqual(C.aTraiter(rappels, new Set(["voiture", "admin"])).map((r) => r.id), ["b", "d", "a"], "des identifiants suffisent");
  assert.deepEqual(C.aTraiter(rappels, []).map((r) => r.texte), ["Caler le contrôle technique"], "sans catégorie sur le compte : seule la date compte");
  const ranges = rappels.map((r) => (r.id === "a" ? { ...r, quand: ms(20, 10, 14, 30) } : r.id === "b" ? { ...r, etiquettes: ["voiture"] } : r));
  assert.deepEqual(C.aTraiter(ranges, etiquettes).map((r) => r.texte), ["Ancienne étiquette"]);
  assert.deepEqual(C.aTraiter(ranges.map((r) => (r.id === "d" ? { ...r, fait: true } : r)), etiquettes), []);
});

test("le filtre : vide → tout ; « Sans étiquette » ; au moins une étiquette cochée ; la clé triée", () => {
  const sans = { id: "1", etiquettes: [] };
  const pro = { id: "2", etiquettes: ["et-pro"] };
  const deux = { id: "3", etiquettes: ["et-pro", "et-sante"] };
  assert.ok([sans, pro, deux].every((r) => C.garderRappel(r, new Set())));
  assert.deepEqual([sans, pro, deux].filter((r) => C.garderRappel(r, C.lireFiltre("et-sante"))).map((r) => r.id), ["3"]);
  assert.deepEqual([sans, pro, deux].filter((r) => C.garderRappel(r, C.lireFiltre("_sans"))).map((r) => r.id), ["1"]);
  assert.deepEqual([sans, pro, deux].filter((r) => C.garderRappel(r, C.lireFiltre("_sans,et-pro"))).map((r) => r.id), ["1", "2", "3"]);
  assert.ok(C.garderRappel({ id: "4" }, C.lireFiltre("_sans")), "un rappel sans champ etiquettes est sans étiquette");
  assert.deepEqual([...C.lireFiltre(",a,,b,")], ["a", "b"]);
  assert.equal(C.lireFiltre(null).size, 0);
  assert.equal(C.ecrireFiltre(new Set(["et-sante", "_sans", "et-pro"])), "_sans,et-pro,et-sante");
  assert.equal(C.piedFiltre(new Set()), "Tout est affiché. Coche une ou plusieurs étiquettes pour ne voir qu'elles.");
  assert.equal(C.piedFiltre(new Set(["a"])), "Seuls les rappels de ces étiquettes s'affichent.");
  assert.deepEqual(C.boutonFiltreTextes(0), { libelle: "Filtrer", etiquette: "Filtrer les rappels" });
  assert.deepEqual(C.boutonFiltreTextes(2), { libelle: "Filtré (2)", etiquette: "Filtre des rappels, 2 choix" });
  assert.equal(C.phraseMasques(1), "Aucun rappel du jour avec ces étiquettes (1 masqué).");
  assert.equal(C.phraseMasques(3), "Aucun rappel du jour avec ces étiquettes (3 masqués).");
});

test("les noms des étiquettes : dans l'ordre du compte, une étiquette inconnue n'est pas affichée", () => {
  const e = [{ id: "et-perso", nom: "Personnel" }, { id: "et-pro", nom: "Professionnel" }];
  assert.deepEqual(C.nomsEtiquettes(["et-pro", "et-perso", "supprimee"], e), ["Personnel", "Professionnel"]);
  assert.deepEqual(C.nomsEtiquettes([], e), []);
  assert.deepEqual(C.dansLOrdre(new Set(["et-pro", "inconnue", "et-perso"]), e), ["et-perso", "et-pro"]);
});

test("les groupes : En retard, Aujourd'hui, Plus tard, Sans date, Faits ; vides masqués", () => {
  const m = ms(29, 10, 14);
  const rappels = [
    { id: "f", texte: "Réserver le tennis", quand: ms(28, 10, 12), fait: true },
    { id: "p", texte: "Renouveler le passeport", quand: ms(1, 11, 9) },
    { id: "r", texte: "Payer le loyer", quand: ms(29, 10, 13, 10) },
    { id: "a", texte: "Appeler le garage", quand: ms(29, 10, 16) },
    { id: "h", texte: "Rappeler Hugo", quand: ms(30, 10, 10) },
    { id: "s", texte: "Rendre le livre", quand: null },
    { id: "v", texte: "Vieux retard", quand: ms(20, 10, 9) },
  ];
  const g = C.groupesRappels(rappels, m);
  assert.deepEqual(g.map((x) => [x.titre, x.rappels.map((r) => r.id).join("")]), [["En retard", "vr"], ["Aujourd'hui", "a"], ["Plus tard", "hp"], ["Sans date", "s"], ["Faits", "f"]]);
  assert.equal(g[0].danger, true);
  assert.deepEqual(C.groupesRappels([{ id: "s", texte: "x", quand: null }], m).map((x) => x.titre), ["Sans date"]);
  assert.deepEqual(C.groupesRappels([], m), []);
});

test("Reporter : dans 1 h au quart d'heure, ce soir avant 18 h, demain, lundi sauf si lundi est demain (ErgonomieTests)", () => {
  const vendredi = date(23, 10, 14, 7);
  const c = C.choixRappel(vendredi);
  assert.deepEqual(c.map((x) => x.libelle), ["Dans 1 h", "Ce soir 19:00", "Demain 9:00", "Lundi 9:00"]);
  assert.equal(c[0].date.getTime(), ms(23, 10, 15, 15), "14:07 + 1 h, au quart d'heure suivant");
  assert.equal(c[1].date.getTime(), ms(23, 10, 19));
  assert.equal(c[2].date.getTime(), ms(24, 10, 9));
  assert.equal(c[3].date.getTime(), ms(26, 10, 9));
  assert.deepEqual(C.choixRappel(date(25, 10, 20)).map((x) => x.id), ["plus-60", "demain"], "après 18 h, et le dimanche");
  assert.equal(C.plusTard(date(29, 10, 10, 0)).getTime(), ms(29, 10, 11, 0), "pile au quart : juste +1 h");
  assert.equal(C.plusTard(new Date(ms(29, 10, 10, 0) + 400)).getTime(), ms(29, 10, 11, 0), "les millisecondes ne font pas sauter un quart");
  assert.equal(C.arrondiQuart(date(29, 10, 10, 46)).getTime(), ms(29, 10, 11, 0));
});

test("« Prévu … » : aujourd'hui, demain, hier, sinon le jour court ; l'année quand elle change (CarnetModel.quand)", () => {
  const m = date(29, 10, 10);
  assert.equal(C.quandRappel(ms(29, 10, 18), m), "aujourd'hui 18:00");
  assert.equal(C.quandRappel(ms(30, 10, 9), m), "demain 09:00");
  assert.equal(C.quandRappel(ms(28, 10, 9), m), "hier 09:00");
  assert.equal(C.quandRappel(ms(5, 11, 9), m), "jeu. 5 nov. 09:00");
  assert.ok(C.quandRappel(ms(31, 8, 9, 0, 2027), date(1, 11, 10)).includes("2027"));
  assert.ok(!C.quandRappel(ms(3, 11, 9), m).includes("2026"));
});

test("Nouveau rappel : la date part si elle est au bout, la formule toujours ; sélecteur touché : le texte reste", () => {
  const m = date(29, 10, 10);
  assert.equal(C.texteNouveauRappel("Appeler le garage demain à 9h", { maintenant: m }), "Appeler le garage");
  assert.equal(C.texteNouveauRappel("Rappelle-moi d'appeler Léa", { maintenant: m }), "Appeler Léa");
  assert.equal(C.texteNouveauRappel("Appeler le garage demain à 9h", { dateTouchee: true, maintenant: m }), "Appeler le garage demain à 9h");
  assert.equal(C.texteNouveauRappel("x".repeat(400), { maintenant: m }).length, 300);
});

// --- Le tri (OnboardingRappels) ---

test("étape 1 : retirées, renommées (ordre gardé), nouvelles à la suite, sans doublon de nom", () => {
  const etiquettes = [{ id: "e1", nom: "Personnel", ordre: 0 }, { id: "e2", nom: "Pro", ordre: 1 }, { id: "e3", nom: "Santé", ordre: 2 }];
  const plan = C.planCategories([
    { etiquette: "e1", nom: "Personnel" },
    { etiquette: "e2", nom: " Professionnel " },
    { idNouveau: "n1", nom: "Voiture" },
    { idNouveau: "n2", nom: "personnel" },
    { idNouveau: "n3", nom: "   " },
  ], etiquettes);
  assert.deepEqual(plan.supprimer, ["e3"]);
  assert.deepEqual(plan.ecrire, [{ id: "e2", nom: "Professionnel", ordre: 1 }, { id: "n1", nom: "Voiture", ordre: 3 }]);
  const reprise = C.planCategories([{ idNouveau: "n1", nom: "Voiture", ordre: 0 }, { idNouveau: "n2", nom: "Santé", ordre: 1 }], [{ id: "n2", nom: "Santé", ordre: 1 }]);
  assert.deepEqual(reprise.ecrire, [{ id: "n1", nom: "Voiture", ordre: 0 }], "un essai repris : le rang d'abord choisi");
  const premiere = C.planCategories(C.CATEGORIES_PROPOSEES.map((nom, i) => ({ idNouveau: `n${i}`, nom })), []);
  assert.deepEqual(premiere.ecrire.map((e) => [e.nom, e.ordre]), C.CATEGORIES_PROPOSEES.map((n, i) => [n, i]));
  assert.equal(C.libelleValiderCategories(7), "Valider ces 7 catégories");
  assert.equal(C.libelleValiderCategories(1), "Valider cette catégorie");
});

test("étape 2 : la proposition de Rémy ne touche pas les lignes que Sam a changées ; Valider écrit ce qui change", () => {
  const choix = { a: { action: "garder", etiquettes: ["voiture"], quand: null }, b: { action: "garder", etiquettes: [], quand: ms(30, 10, 9) } };
  const p = C.appliquerPropositions(choix, [{ id: "a", action: "tache", etiquettes: ["admin"] }, { id: "b", action: "rien", etiquettes: ["admin"] }, { id: "z", action: "garder" }],
    { touchees: new Set(["b"]), ids: ["a", "b"] });
  assert.deepEqual(p.a, { action: "tache", etiquettes: ["voiture", "admin"], quand: null });
  assert.deepEqual(p.b, choix.b, "touchée à la main : intacte");
  assert.equal(p.z, undefined, "pas dans la liste figée : ignorée");
  const etiquettes = [{ id: "admin" }, { id: "voiture" }];
  const aTrier = [
    { id: "a", texte: "Contrôle technique", quand: null, etiquettes: [] },
    { id: "b", texte: "Payer le loyer", quand: ms(30, 10, 9), etiquettes: ["admin"] },
    { id: "c", texte: "Idée vague", quand: null },
    { id: "d", texte: "Appeler le garage", quand: null, etiquettes: [] },
  ];
  const plan = C.planTri(aTrier, {
    a: { action: "garder", etiquettes: ["voiture", "inconnue", "admin"], quand: ms(31, 10, 9) },
    b: { action: "garder", etiquettes: ["admin"], quand: ms(30, 10, 9) },
    c: { action: "rien", etiquettes: ["admin"], quand: ms(1, 11, 9) },
    d: { action: "tache", etiquettes: ["voiture"], quand: ms(2, 11, 9) },
  }, etiquettes);
  assert.deepEqual(plan.ranges.map((r) => [r.id, r.quand, r.etiquettes]), [["a", ms(31, 10, 9), ["admin", "voiture"]]], "b n'a pas changé, c : rien");
  assert.deepEqual(plan.convertir.map((r) => [r.id, r.quand, r.etiquettes]), [["d", ms(2, 11, 9), ["voiture"]]]);
  assert.equal(C.detailConversion(1), "1 rappel deviendra des tâches que Motion planifiera ; le rappel est alors retiré.");
  assert.equal(C.detailConversion(2), "2 rappels deviendront des tâches que Motion planifiera ; le rappel est alors retiré.");
});

test("le bilan du tri, mot pour mot (OnboardingRappels.appliquer)", () => {
  assert.equal(C.phraseBilanTri({ ranges: 0 }), "0 rappel rangé.");
  assert.equal(C.phraseBilanTri({ ranges: 3, restent: 1 }), "3 rappels rangés ; encore 1 à traiter.");
  assert.equal(C.phraseBilanTri({ ranges: 1, convertis: 2 }), "1 rappel rangé, 2 devenus tâches Motion.");
  assert.equal(C.phraseBilanTri({ ranges: 2, convertis: 0, echecs: ["« Appeler le garage » : quota"], restent: 2 }),
    "2 rappels rangés, 0 devenu tâche Motion (pas fait : « Appeler le garage » : quota) ; encore 2 à traiter.");
});

test("Valider le tri : des écritures que la tour prend en entier (500 rappels chacune) ; un refus dit où on en est", () => {
  const ranges = Array.from({ length: 1020 }, (_, i) => ({ id: `r${i}`, texte: `Rappel ${i}`, quand: null, etiquettes: ["perso"], source: "apple" }));
  const corps = C.ecrituresTri(ranges);
  assert.deepEqual(corps.map((c) => c.rappels.length), [500, 500, 20]);
  assert.ok(corps.every((c) => c.rappels.length <= C.LOT_RAPPELS));
  assert.deepEqual(corps[2].rappels[19], { id: "r1019", texte: "Rappel 1019", quand: null, fait: false, etiquettes: ["perso"] });
  assert.deepEqual(C.ecrituresTri([]), [], "rien de rangé : aucune écriture");
  assert.equal(C.prefixeRefusTri(0, 520), "Rien n'est rangé");
  assert.equal(C.prefixeRefusTri(500, 520), "500 rappels rangés sur 520, pas la suite");
  assert.equal(C.prefixeRefusTri(1, 2), "1 rappel rangé sur 2, pas la suite");
});

test("un rappel devenu tâche : l'action Motion, et le sort de chaque ligne d'un lot", () => {
  const iso = (d) => d.toISOString();
  assert.deepEqual(C.actionTache({ texte: "Appeler le garage", quand: null, etiquettes: [] }, iso), { type: "creer", nom: "Appeler le garage" });
  assert.deepEqual(C.actionTache({ texte: "Garage", quand: ms(2, 11, 9), etiquettes: ["v"] }, iso), { type: "creer", nom: "Garage", echeance: date(2, 11, 9).toISOString(), etiquettes: ["v"] });
  assert.deepEqual(C.etatsLot({ ok: true, results: [{ ok: true }, { ok: false, dejaLa: true }, { ok: false, erreur: "quota" }] }, 3).map((x) => x.etat), ["fait", "dejaLa", "echec"]);
  assert.deepEqual(C.etatsLot({ ok: false, results: [{ ok: false, erreur: "« X » existe déjà dans Motion" }] }, 1), [{ etat: "dejaLa" }], "une tour d'avant le 24/10");
  assert.deepEqual(C.etatsLot({ etat: "deja_la" }, 2).map((x) => x.etat), ["dejaLa", "dejaLa"]);
  assert.deepEqual(C.etatsLot({ ok: false, etat: "echouee" }, 1), [{ etat: "echec", erreur: "refusé par Motion" }]);
  assert.deepEqual(C.lots([1, 2, 3, 4, 5, 6, 7], 6), [[1, 2, 3, 4, 5, 6], [7]]);
  assert.deepEqual(C.lots([], 6), []);
});

// --- Les listes ---

test("listes : disposition automatique (1→1, 2→2, 3→3, 4→2, 5+→3), icône devinée, reste", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((n) => C.colonnesListes(0, n)), [1, 1, 2, 3, 2, 3, 3]);
  assert.deepEqual([1, 2, 3].map((c) => C.colonnesListes(c, 7)), [1, 2, 3]);
  assert.equal(C.colonnesListes("2", 1), 2, "le choix lu du stockage local");
  assert.deepEqual(["Courses", "Magasin bio", "Pharmacie", "Santé", "Anniversaires", "Cadeaux de Noël", "Films à voir", "Séries", "Livres", "Valise Porto", "Voyage", "Idées"].map(C.iconeListe),
    ["chariot", "chariot", "trousse", "trousse", "cadeau", "cadeau", "livre", "livre", "livre", "valise", "valise", "liste"]);
  assert.equal(C.resteListe({ elements: [] }), "vide");
  assert.equal(C.resteListe({ elements: [{ fait: true }] }), "tout est pris");
  assert.equal(C.resteListe({ elements: [{ fait: true }, { fait: false }, { fait: false }] }), "2 à prendre");
  assert.equal(C.phraseDejaListe(["lait"]), "Déjà dans ta liste : « lait ».");
  assert.equal(C.phraseDejaListe(["lait", "œufs"]), "Déjà dans ta liste : « lait », « œufs ».");
  assert.equal(C.phraseCochesRetires(1), "1 article coché retiré.");
  assert.equal(C.phraseCochesRetires(2), "2 articles cochés retirés.");
});

// --- Dossiers ---

const DOSSIERS = [
  { id: "idees", nom: "Idées", parent: null, ordre: -2, notes: [{ id: "i1", fait: false }], taches: [] },
  { id: "d-demo", nom: "Démo client", parent: "motion:p1", ordre: 0, notes: [], taches: ["t1"] },
  { id: "d-site", nom: "Site vitrine", parent: "motion:p1", ordre: 1, notes: [{ id: "n1", fait: false }, { id: "n2", fait: false }, { id: "n3", fait: true }], taches: [] },
  { id: "d-pages", nom: "Pages", parent: "d-site", ordre: 0, notes: [], taches: ["t2", "t3"] },
  { id: "d-maison", nom: "Maison", parent: null, ordre: 0, notes: [], taches: [] },
  { id: "d-cuisine", nom: "Travaux cuisine", parent: "d-maison", ordre: 0, notes: [{ id: "n4", fait: false }], taches: [] },
  { id: "d-carrelage", nom: "Carrelage", parent: "d-cuisine", ordre: 0, notes: [], taches: ["t9"] },
];

test("dossiers : descendants au point fixe, à restaurer parents d'abord avec notes et tâches", () => {
  assert.deepEqual([...C.descendants(DOSSIERS, "d-maison")].sort(), ["d-carrelage", "d-cuisine", "d-maison"]);
  assert.deepEqual([...C.descendants(DOSSIERS, "d-carrelage")], ["d-carrelage"]);
  const melanges = [DOSSIERS[6], DOSSIERS[5], DOSSIERS[4]]; // l'enfant avant le parent dans la liste
  assert.deepEqual(C.aRestaurer(melanges, "d-maison").map((d) => d.id), ["d-maison", "d-cuisine", "d-carrelage"]);
  const r = C.aRestaurer(DOSSIERS, "d-site");
  assert.deepEqual(r.map((d) => [d.id, d.notes.length, d.taches]), [["d-site", 3, []], ["d-pages", 0, ["t2", "t3"]]]);
  assert.notEqual(r[0].notes, DOSSIERS[2].notes, "une copie : la relecture ne la change pas");
});

test("« Annuler » une suppression : seules les idées absentes de la relecture repartent, par envois de 100", () => {
  const notes = Array.from({ length: 270 }, (_, i) => ({ id: `n${i}`, texte: `Idée ${i}`, fait: i % 2 === 1, maj: 1 }));
  const copie = [{ id: "d-bougies", notes }, { id: "d-cires", notes: [{ id: "c1", texte: "Cire de soja" }] }];
  assert.deepEqual(C.notesARemettre(copie, [{ id: "d-bougies", notes }, { id: "d-cires", notes: [{ id: "c1" }] }]), [], "revenues avec le dossier : rien à renvoyer");
  const sans = C.notesARemettre(copie, [{ id: "d-bougies", notes: notes.slice(0, 20) }]);
  assert.deepEqual(sans.map((e) => [e.dossier, e.notes.length]), [["d-bougies", 100], ["d-bougies", 100], ["d-bougies", 50], ["d-cires", 1]]);
  assert.deepEqual(sans[0].notes[0], { id: "n20", texte: "Idée 20", fait: false });
  assert.deepEqual(sans[3].notes[0], { id: "c1", texte: "Cire de soja", fait: false });
  assert.deepEqual(C.notesARemettre(copie, null).map((e) => e.notes.length), [100, 100, 70, 1], "relecture vide : tout repart");
});

test("ranger une tâche : la racine, puis tous ses sous-dossiers en largeur (NoeudView.rangements)", () => {
  assert.equal(C.racineDe(DOSSIERS, "d-pages"), "motion:p1");
  assert.equal(C.racineDe(DOSSIERS, "motion:p1"), "motion:p1");
  assert.equal(C.racineDe(DOSSIERS, "d-carrelage"), "d-maison");
  assert.deepEqual(C.rangements(DOSSIERS, "motion:p1").map((d) => d.id), ["d-demo", "d-site", "d-pages"]);
  assert.deepEqual(C.rangements(DOSSIERS, "d-pages").map((d) => d.id), ["d-demo", "d-site", "d-pages"]);
  assert.deepEqual(C.rangements(DOSSIERS, "d-cuisine").map((d) => d.id), ["d-cuisine", "d-carrelage"]);
  const boucle = [{ id: "a", parent: "b" }, { id: "b", parent: "a" }];
  assert.ok(Array.isArray(C.rangements(boucle, "a")), "une boucle (impossible sur la tour) ne bloque pas");
});

test("la ligne d'un dossier : sous-projets, tâches, idées non relues ; icône ; Aussi dans Motion", () => {
  assert.equal(C.metaDossier(DOSSIERS[2], DOSSIERS), "1 sous-projet · 2 idées", "n3 est relue");
  assert.equal(C.metaDossier(DOSSIERS[3], DOSSIERS), "2 tâches");
  assert.equal(C.metaDossier(DOSSIERS[4], DOSSIERS), "1 sous-projet");
  assert.equal(C.metaDossier({ id: "x", notes: [], taches: [] }, DOSSIERS), "");
  assert.equal(C.iconeDossier({ id: "notes" }), "blocnotes");
  assert.equal(C.iconeDossier({ id: "x", projetMotion: "pm1" }), "pile");
  assert.equal(C.iconeDossier({ id: "x" }), "dossier");
  assert.ok(C.peutAllerDansMotion({ id: "d-maison", parent: null }));
  assert.ok(!C.peutAllerDansMotion({ id: "d-cuisine", parent: "d-maison" }), "pas un sous-dossier");
  assert.ok(!C.peutAllerDansMotion({ id: "d-maison", parent: null, projetMotion: "pm" }), "déjà lié");
  assert.ok(!C.peutAllerDansMotion({ id: "notes", parent: null }) && !C.peutAllerDansMotion({ id: "idees", parent: null }));
  assert.equal(C.phraseRefusMotion("Motion n'a pas créé le projet : quota"), "Motion n'a pas créé le projet : quota.");
  assert.equal(C.phraseRefusMotion("La tour ne répond pas."), "Motion n'a pas créé le projet : La tour ne répond pas.");
});

test("tâches : celles du projet hors sous-projets ; celles d'un dossier, titre retrouvé ou inconnu", () => {
  const p = { nom: "Boutiques", liste: [{ id: "t1", titre: "Préparer la démo" }, { id: "t4", titre: "Commander" }, { id: "t2", titre: "Page d'accueil", echeance: ms(27, 10, 23), duree: 45 }] };
  assert.deepEqual(C.tachesHorsSousProjets(p, DOSSIERS).map((t) => t.id), ["t4"]);
  const r = C.tachesRangees(DOSSIERS[3], [p], [{ id: "t3", type: "tache", titre: "Textes du site" }]);
  assert.deepEqual(r.map((t) => t.titre), ["Page d'accueil", "Textes du site"]);
  assert.deepEqual(C.tachesRangees({ taches: ["t404"] }, [p]), [{ id: "t404", titre: C.TACHE_INCONNUE, inconnue: true }]);
  const duree = (m) => `${m} min`;
  assert.equal(C.metaTache(r[0], duree), "avant le 27 oct. · 45 min");
  assert.equal(C.metaTache({ id: "x" }, duree), "");
});

test("projets Motion : nombre, prochaine et son jour, retard, sans projet, mémoire", () => {
  assert.equal(C.detailProjet({ taches: 0 }), "aucune tâche ouverte");
  assert.equal(C.detailProjet({ taches: 5, prochaine: { titre: "Envoyer les visuels", echeance: ms(27, 10, 18) } }), "5 tâches · prochaine : Envoyer les visuels (27 oct.)");
  assert.equal(C.detailProjet({ taches: 1, prochaine: { titre: "Retoucher" } }), "1 tâche · prochaine : Retoucher");
  assert.equal(C.phraseRetard(1), "1 en retard");
  assert.equal(C.phraseRetard(3), "3 en retard");
  assert.equal(C.phraseSansProjet(7), "7 tâches sans projet dans Motion.");
  assert.equal(C.phraseSansProjet(1), "1 tâche sans projet dans Motion.");
  assert.equal(C.questionProjet("Boutiques"), "Où en est le projet « Boutiques » ? Propose-moi les prochaines étapes.");
  assert.equal(C.resumeMemoire({ mots: 37, sections: 6, totalSections: 7 }), "37 mots · 6 sections remplies sur 7");
  assert.equal(C.resumeMemoire({ mots: 1234, sections: 1, totalSections: 7 }), "1 234 mots · 1 section remplie sur 7");
  assert.equal(C.resumeMemoire(null), "Lire et corriger sa mémoire");
});

test("historique : chemins, groupes par jour, pages sans doublon, phrases", () => {
  assert.equal(C.cheminHistorique(), "/api/historique?limite=80");
  assert.equal(C.cheminHistorique({ filtre: "deja_la", avant: 1793109582386.4 }), "/api/historique?limite=80&avant=1793109582386&filtre=deja_la");
  assert.equal(C.cheminHistorique({ filtre: "tout", avant: 5 }), "/api/historique?limite=80&avant=5");
  const g = C.groupesHistorique([{ id: "a", ts: ms(29, 10, 15) }, { id: "b", ts: ms(29, 10, 9) }, { id: "c", ts: ms(27, 10, 9) }]);
  assert.deepEqual(g.map((x) => [x.titre, x.entrees.length]), [["Jeudi 29 octobre", 2], ["Mardi 27 octobre", 1]]);
  assert.deepEqual(C.ajouterPage([{ id: "a" }], [{ id: "a" }, { id: "b" }]).map((e) => e.id), ["a", "b"]);
  assert.equal(C.detailAnnulation("agenda"), "Rémy remet ton agenda comme avant, si personne n'y a touché depuis.");
  assert.equal(C.detailAnnulation("motion"), "Rémy remet Motion comme avant, si personne n'y a touché depuis.");
  assert.equal(C.phraseAnnulation("motion", true), "Annulé.");
  assert.equal(C.phraseAnnulation("agenda", false), "Pas tout à fait annulé : vérifie dans ton agenda.");
  assert.equal(C.videHistorique("tout"), "Rien encore : chaque geste qui change Motion ou ton agenda s'inscrira ici.");
  assert.equal(C.videHistorique("annulee"), "Rien dans « Annulées ».");
});

// --- Les chemins du site, contre les vraies routes de la tour ---

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-site-projets-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "MOTION_API_KEY", "REMY_GLM_URL"]) delete process.env[v];
process.env.REMY_DATA_DIR = path.join(dossier, "data");
process.env.REMY_CLES_DIR = path.join(dossier, "cles");
process.env.HOME = path.join(dossier, "maison");
process.env.USERPROFILE = process.env.HOME;
const { routeApi } = await import("../lib/routes.js");
const { CAPACITES } = await import("../lib/version.js");
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
const appel = async (chemin, { methode = "GET", corps } = {}) => {
  const r = await fetch(base + chemin, { method: methode, headers: { Accept: "application/json", ...(corps !== undefined ? { "Content-Type": "application/json" } : {}) }, body: corps === undefined ? undefined : JSON.stringify(corps) });
  const texte = await r.text();
  return { statut: r.status, corps: texte ? JSON.parse(texte) : null };
};

test("contrat : les capacités que le site attend sont annoncées par la tour", () => {
  for (const c of ["etiquettes-v1", "dossiers-v1", "historique-v2", "analyse-rappels-v1", "projets-v1", "carnet-lot-v1"]) assert.ok(CAPACITES.includes(c), c);
});

test("contrat : supprimer un dossier à sous-dossiers, puis « Annuler » remet dossiers, notes et tâches rangées", async () => {
  await appel("/api/dossiers/d-maison", { methode: "PUT", corps: { nom: "Maison", parent: null, ordre: 0 } });
  await appel("/api/dossiers/d-cuisine", { methode: "PUT", corps: { nom: "Travaux cuisine", parent: "d-maison", ordre: 0 } });
  await appel("/api/dossiers/d-carrelage", { methode: "PUT", corps: { nom: "Carrelage", parent: "d-cuisine", ordre: 0 } });
  await appel("/api/dossiers/d-cuisine/notes", { methode: "POST", corps: { notes: [{ id: "n4", texte: "Devis plombier", fait: false }] } });
  assert.equal((await appel("/api/rattachements/t9", { methode: "PUT", corps: { dossier: "d-carrelage" } })).statut, 200);
  const avant = (await appel("/api/dossiers")).corps.dossiers;
  // Ce que fait le site : une copie d'abord, puis DELETE.
  const copie = C.aRestaurer(avant, "d-maison");
  assert.deepEqual(copie.map((d) => d.id), ["d-maison", "d-cuisine", "d-carrelage"]);
  assert.equal((await appel("/api/dossiers/d-maison", { methode: "DELETE" })).corps.supprimes, 3);
  assert.deepEqual((await appel("/api/dossiers")).corps.dossiers.map((d) => d.id), [], "la tour supprime aussi les descendants");
  // « Annuler » : chaque dossier gardé, ses notes, ses tâches.
  for (const d of copie) {
    assert.equal((await appel(`/api/dossiers/${encodeURIComponent(d.id)}`, { methode: "PUT", corps: { nom: d.nom, parent: d.parent, ordre: d.ordre ?? 0 } })).statut, 200, d.id);
    if (d.notes.length) assert.equal((await appel(`/api/dossiers/${d.id}/notes`, { methode: "POST", corps: { notes: d.notes } })).statut, 200);
    for (const t of d.taches) assert.equal((await appel(`/api/rattachements/${t}`, { methode: "PUT", corps: { dossier: d.id } })).statut, 200);
  }
  const apres = (await appel("/api/dossiers")).corps.dossiers;
  const resume = (l) => l.map((d) => [d.id, d.parent, d.notes.map((n) => n.texte).join(), d.taches.join()]).sort();
  assert.deepEqual(resume(apres), resume(avant), "tout est revenu");
});

test("contrat : ranger une tâche, la sortir ; un dossier disparu le dit (404)", async () => {
  await appel("/api/dossiers/d-demo", { methode: "PUT", corps: { nom: "Démo client", parent: "motion:p1", ordre: 0 } });
  await appel("/api/rattachements/t1", { methode: "PUT", corps: { dossier: "d-demo" } });
  assert.deepEqual((await appel("/api/dossiers")).corps.dossiers.find((d) => d.id === "d-demo").taches, ["t1"]);
  await appel("/api/rattachements/t1", { methode: "PUT", corps: { dossier: null } });
  assert.deepEqual((await appel("/api/dossiers")).corps.dossiers.find((d) => d.id === "d-demo").taches, []);
  const r = await appel("/api/rattachements/t1", { methode: "PUT", corps: { dossier: "inconnu" } });
  assert.equal(r.statut, 404);
  assert.match(r.corps.message, /n'existe plus/);
});

test("contrat : une liste supprimée revient avec ses articles ; un article déjà là est rendu, pas recréé", async () => {
  await appel("/api/listes/l-courses", { methode: "PUT", corps: { nom: "Courses", ordre: 0 } });
  await appel("/api/listes/l-courses/elements", { methode: "POST", corps: { elements: [{ id: "e1", texte: "Lait", fait: false, ordre: 0 }, { id: "e2", texte: "Café", fait: true, ordre: 1 }] } });
  const avant = (await appel("/api/listes")).corps.listes.find((l) => l.id === "l-courses");
  await appel("/api/listes/l-courses", { methode: "DELETE" });
  assert.ok(!(await appel("/api/listes")).corps.listes.some((l) => l.id === "l-courses"));
  await appel("/api/listes/l-courses", { methode: "PUT", corps: { nom: avant.nom, ordre: avant.ordre } });
  for (const lot of C.lots(avant.elements, 100)) assert.equal((await appel("/api/listes/l-courses/elements", { methode: "POST", corps: { elements: lot } })).statut, 200);
  const apres = (await appel("/api/listes")).corps.listes.find((l) => l.id === "l-courses");
  assert.deepEqual(apres.elements.map((e) => [e.id, e.fait]), [["e1", false], ["e2", true]]);
  const r = await appel("/api/listes/l-courses/elements", { methode: "POST", corps: { elements: [{ id: "e3", texte: "lait", fait: false }, { id: "e4", texte: "Œufs", fait: false }] } });
  assert.deepEqual(r.corps.dejaLa.map((d) => d.texte), ["lait"]);
  assert.equal(C.phraseDejaListe(r.corps.dejaLa.map((d) => d.texte)), "Déjà dans ta liste : « lait ».");
  // « Retirer les articles pris », puis « Annuler » : réécrits.
  await appel("/api/listes/l-courses/retirer", { methode: "POST", corps: { ids: ["e2"] } });
  assert.ok(!(await appel("/api/listes")).corps.listes.find((l) => l.id === "l-courses").elements.some((e) => e.id === "e2"));
  await appel("/api/listes/l-courses/elements", { methode: "POST", corps: { elements: [{ id: "e2", texte: "Café", fait: true, ordre: 1 }] } });
  assert.ok((await appel("/api/listes")).corps.listes.find((l) => l.id === "l-courses").elements.some((e) => e.id === "e2" && e.fait));
});

test("contrat : étiquettes d'un rappel, à traiter, rangé ; nouveau rappel déjà là", async () => {
  for (const [id, nom, ordre] of [["et-pro", "Professionnel", 0], ["et-voiture", "Voiture", 1]]) await appel(`/api/etiquettes/${id}`, { methode: "PUT", corps: { nom, ordre } });
  await appel("/api/rappels", { methode: "POST", corps: { rappels: [{ id: "r1", texte: "Appeler le garage", quand: null }, { id: "r2", texte: "Rappeler Hugo", quand: Date.now() + 3600e3, etiquettes: ["et-pro"] }] } });
  const etiquettes = (await appel("/api/etiquettes")).corps.etiquettes;
  let rappels = (await appel("/api/rappels")).corps.rappels;
  assert.deepEqual(C.aTraiter(rappels, etiquettes).map((r) => r.id), ["r1"]);
  // « Étiquettes » : les ids cochés dans l'ordre du compte.
  const r1 = rappels.find((r) => r.id === "r1");
  const ok = await appel("/api/rappels", { methode: "POST", corps: { rappels: [{ id: r1.id, texte: r1.texte, quand: Date.now() + 7200e3, fait: false, etiquettes: C.dansLOrdre(new Set(["et-voiture"]), etiquettes) }] } });
  assert.equal(ok.statut, 200);
  rappels = (await appel("/api/rappels")).corps.rappels;
  assert.deepEqual(rappels.find((r) => r.id === "r1").etiquettes, ["et-voiture"]);
  assert.deepEqual(C.aTraiter(rappels, etiquettes), []);
  const deja = await appel("/api/rappels", { methode: "POST", corps: { rappels: [{ id: "r-neuf", texte: "rappeler hugo", quand: null }] } });
  assert.equal(deja.corps.dejaLa[0].texte, "rappeler hugo", "« Déjà dans tes rappels : « X ». »");
  // Retirer, puis « Annuler » : la même ligne réécrite revient.
  await appel("/api/rappels/r2", { methode: "DELETE" });
  assert.ok(!(await appel("/api/rappels")).corps.rappels.some((r) => r.id === "r2"));
  const r2 = rappels.find((r) => r.id === "r2");
  await appel("/api/rappels", { methode: "POST", corps: { rappels: [{ id: r2.id, texte: r2.texte, quand: r2.quand, fait: false, etiquettes: r2.etiquettes }] } });
  assert.ok((await appel("/api/rappels")).corps.rappels.some((r) => r.id === "r2"));
});

test("contrat : l'historique paginé et filtré répond à ce que le site lit", async () => {
  const r = await appel(C.cheminHistorique());
  assert.equal(r.statut, 200);
  assert.ok(Array.isArray(r.corps.entrees) && "suite" in r.corps);
  for (const f of C.FILTRES_HISTORIQUE) assert.equal((await appel(C.cheminHistorique({ filtre: f.id }))).statut, 200, f.id);
  const u = await appel("/api/motion/undo", { methode: "POST", corps: { id: "inconnu" } });
  assert.ok(u.statut >= 400 && typeof u.corps?.message === "string", "un refus dit pourquoi");
});

test("contrat : Aussi dans Motion sans Motion branché : un refus clair, le dossier reste", async () => {
  await appel("/api/dossiers/d-perso", { methode: "PUT", corps: { nom: "Perso", parent: null, ordre: 3 } });
  const r = await appel("/api/dossiers/d-perso", { methode: "PUT", corps: { nom: "Perso", parent: null, ordre: 3, motion: true } });
  assert.equal(r.statut, 502);
  assert.match(C.phraseRefusMotion(r.corps.message), /^Motion n'a pas créé le projet : .+\.$/);
  const d = (await appel("/api/dossiers")).corps.dossiers.find((x) => x.id === "d-perso");
  assert.equal(d.projetMotion, null);
});

test("contrat : « Annuler » la suppression d'un dossier de 270 idées les remet toutes, sans dépasser ce que la tour accepte", async () => {
  await appel("/api/dossiers/d-bougies", { methode: "PUT", corps: { nom: "Bougies", parent: null, ordre: 5 } });
  await appel("/api/dossiers/d-meches", { methode: "PUT", corps: { nom: "Mèches", parent: "d-bougies", ordre: 0 } });
  const idees = Array.from({ length: 270 }, (_, i) => ({ id: `nb-${i}`, texte: `Idée de bougie ${i}`, fait: false }));
  for (const lot of C.lots(idees, 100)) assert.equal((await appel("/api/dossiers/d-bougies/notes", { methode: "POST", corps: { notes: lot } })).statut, 200);
  await appel("/api/dossiers/d-meches/notes", { methode: "POST", corps: { notes: [{ id: "nm-1", texte: "Mèche en bois", fait: false }] } });
  const avant = (await appel("/api/dossiers")).corps.dossiers;
  const copie = C.aRestaurer(avant, "d-bougies");
  assert.equal(copie[0].notes.length, 270);
  assert.equal((await appel("/api/dossiers/d-bougies", { methode: "DELETE" })).corps.supprimes, 2);
  // Entre-temps, une idée retirée ailleurs (l'iPhone) : elle doit revenir aussi.
  assert.equal((await appel("/api/dossiers/d-bougies/notes/nb-7", { methode: "DELETE" })).statut, 200);
  // Ce que fait « Annuler » : les dossiers, puis seules les idées absentes de la relecture.
  for (const d of copie) assert.equal((await appel(`/api/dossiers/${d.id}`, { methode: "PUT", corps: { nom: d.nom, parent: d.parent, ordre: d.ordre ?? 0 } })).statut, 200);
  const relus = (await appel("/api/dossiers")).corps.dossiers;
  const envois = C.notesARemettre(copie, relus);
  assert.deepEqual(envois.map((e) => [e.dossier, e.notes.map((n) => n.id)]), [["d-bougies", ["nb-7"]]], "les autres sont revenues avec leur dossier");
  for (const e of envois) assert.equal((await appel(`/api/dossiers/${e.dossier}/notes`, { methode: "POST", corps: { notes: e.notes } })).statut, 200);
  const apres = (await appel("/api/dossiers")).corps.dossiers;
  assert.equal(apres.find((d) => d.id === "d-bougies").notes.length, 270);
  assert.deepEqual(apres.find((d) => d.id === "d-meches").notes.map((n) => n.id), ["nm-1"]);
  // Renvoyer toutes les idées (l'ancien « Annuler ») : la tour refuse de dépasser 500 par dossier.
  assert.equal((await appel("/api/dossiers/d-bougies/notes", { methode: "POST", corps: { notes: copie[0].notes } })).statut, 409);
});

test("contrat : le tri range plus de 500 rappels ; chaque écriture est prise en entier, le compte de la tour fait le bilan", async () => {
  await appel("/api/etiquettes/et-perso", { methode: "PUT", corps: { nom: "Personnel", ordre: 2 } });
  const N = 520;
  const neufs = Array.from({ length: N }, (_, i) => ({ id: `rx-${i}`, texte: `Acheter la bougie numéro ${i}`, quand: Date.now() + 3 * 86400e3 }));
  for (const lot of C.lots(neufs, 200)) assert.equal((await appel("/api/rappels", { methode: "POST", corps: { rappels: lot } })).statut, 200);
  const etiquettes = (await appel("/api/etiquettes")).corps.etiquettes;
  const aTrier = C.aTraiter((await appel("/api/rappels")).corps.rappels, etiquettes).filter((r) => r.id.startsWith("rx-"));
  assert.equal(aTrier.length, N);
  const choix = Object.fromEntries(aTrier.map((r) => [r.id, { action: "garder", etiquettes: ["et-perso"], quand: r.quand }]));
  const plan = C.planTri(aTrier, choix, etiquettes);
  assert.equal(plan.ranges.length, N);
  let ranges = 0;
  for (const corps of C.ecrituresTri(plan.ranges)) {
    const r = await appel("/api/rappels", { methode: "POST", corps });
    assert.equal(r.statut, 200);
    assert.equal(r.corps.nombre, corps.rappels.length, "la tour a tout pris");
    ranges += r.corps.nombre;
  }
  assert.equal(ranges, N);
  const relus = (await appel("/api/rappels")).corps.rappels.filter((r) => r.id.startsWith("rx-"));
  assert.equal(relus.filter((r) => r.etiquettes.includes("et-perso")).length, N, "tout est rangé");
  assert.equal(C.phraseBilanTri({ ranges, restent: 0 }), "520 rappels rangés.");
  // Une seule écriture de 520 (l'ancien « Valider ») : la tour n'en garde que 500.
  const trop = await appel("/api/rappels", { methode: "POST", corps: { rappels: plan.ranges.map((r) => ({ id: r.id, texte: r.texte, quand: r.quand, fait: false, etiquettes: [] })) } });
  assert.equal(trop.corps.nombre, C.LOT_RAPPELS);
});
