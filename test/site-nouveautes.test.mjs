// Les nouveautés du site (port de Nouveautes.swift) : une fois, seulement
// quand la tour connaît la fonction, jamais une entrée coupée ; l'historique
// garde tout. Le suivi (12/11) : à découvrir, commencé, suivi ; présentées
// d'office, les deux dernières séries. Les cas de NouveautesTests.swift, sur
// un catalogue d'essai figé.
import test from "node:test";
import assert from "node:assert/strict";

const magasin = new Map();
globalThis.localStorage = {
  getItem: (k) => (magasin.has(k) ? magasin.get(k) : null),
  setItem: (k, v) => magasin.set(k, String(v)),
  removeItem: (k) => magasin.delete(k),
  clear: () => magasin.clear(),
};
const N = await import("../public/app/nouveautes.js");

const page = { icone: "etoile", titre: "T", texte: "Texte" };
const essai = [
  { id: "modele", serie: 2, date: "", titre: "Modèle", capacite: "modeles-v1", pages: [page] },
  { id: "lieux", serie: 2, date: "", titre: "Lieux", capacite: "lieux-v1", pages: [page] },
  { id: "cadran", serie: 1, date: "", titre: "Cadran", capacite: "jauge-v1", pages: [page] },
  { id: "selection", serie: 1, date: "", titre: "Sélection", capacite: null, pages: [page] },
];
const sait = (liste) => (c) => liste.includes(c);
const modele = (capacites, catalogue = essai) => N.modele({ catalogue, sait: sait(capacites), cle: "essai-vues" });

test("le premier lancement ne montre que la dernière mise à jour ; vue une fois, plus jamais", () => {
  magasin.clear();
  const m = modele(["modeles-v1", "lieux-v1", "jauge-v1"]);
  const a = m.aMontrer();
  assert.deepEqual(new Set(a.map((e) => e.id)), new Set(["modele", "lieux"]), "l'historique ne s'impose pas");
  assert.equal(m.etat(essai[2]), "aDecouvrir", "jamais ouverte : à découvrir, honnêtement");
  assert.equal(m.presentable(essai[2]), false, "plus ancienne que le premier lancement");
  m.noter(a, 1);
  assert.deepEqual(modele(["modeles-v1", "lieux-v1"]).aMontrer(), [], "même après un relancement");
});

test("le vrai catalogue, la tour à jour : seule la dernière série s'affiche", () => {
  magasin.clear();
  const m = N.modele({ sait: () => true, cle: "vrai" });
  const derniere = Math.max(...N.CATALOGUE.map((e) => e.serie));
  assert.deepEqual(new Set(m.aMontrer().map((e) => e.serie)), new Set([derniere]));
  assert.ok(N.pagesDe(m.aMontrer()).length <= N.PAGES_MAX);
});

test("une fonction que la tour ne connaît pas n'est pas présentée, puis arrive avec sa mise à jour", () => {
  magasin.clear();
  const m = modele(["lieux-v1"]);
  assert.deepEqual(m.aMontrer().map((e) => e.id), ["lieux"], "le modèle attend la mise à jour de la tour");
  m.noter(m.aMontrer(), 0);
  assert.deepEqual(modele(["lieux-v1", "modeles-v1"]).aMontrer().map((e) => e.id), ["modele"]);
  assert.equal(modele([]).existe({ id: "x", capacite: "inconnue-v1", pages: [] }), false);
  assert.equal(modele([]).existe({ id: "y", capacite: null, pages: [] }), true);
});

test("une mise à jour suivante montre seulement sa nouveauté ; l'historique, la plus récente d'abord", () => {
  magasin.clear();
  const ancien = [{ id: "a", serie: 1, titre: "A", capacite: null, pages: [page] }, { id: "b", serie: 2, titre: "B", capacite: null, pages: [page] }];
  const m1 = modele([], ancien);
  assert.deepEqual(m1.aMontrer().map((e) => e.id), ["b"]);
  m1.noter(m1.aMontrer(), 0);
  const m2 = modele([], [...ancien, { id: "c", serie: 3, titre: "C", capacite: null, pages: [page, page] }]);
  assert.deepEqual(m2.aMontrer().map((e) => e.id), ["c"]);
  assert.equal(N.pagesDe(m2.aMontrer()).length, 2);
  assert.deepEqual(m2.historique().map((e) => e.id), ["c", "b", "a"]);
});

test("un long lot ne coupe jamais une entrée ; seules celles montrées sont vues", () => {
  magasin.clear();
  const pp = (k) => Array(k).fill(page);
  const catalogue = [
    { id: "a", serie: 3, capacite: null, pages: pp(3) }, { id: "b", serie: 3, capacite: null, pages: pp(2) }, { id: "c", serie: 3, capacite: null, pages: pp(2) },
    { id: "x", serie: 3, capacite: "inconnue-v1", pages: pp(1) }, { id: "d", serie: 3, capacite: null, pages: pp(3) }, { id: "e", serie: 3, capacite: null, pages: pp(1) },
  ];
  const m1 = modele([], catalogue);
  const a = m1.aMontrer();
  assert.deepEqual(a.map((e) => e.id), ["a", "b"], "3 + 2 pages ; « c » ferait 7");
  assert.equal(N.pagesDe(a).length, 5);
  m1.noter(a, 4);
  assert.equal(m1.estNouvelle(catalogue[2]), true, "pas montrée : pas vue");
  const m2 = modele([], catalogue);
  assert.deepEqual(m2.aMontrer().map((e) => e.id), ["c", "d", "e"]);
  // Au moins une entrée, même plus longue que la limite.
  assert.deepEqual(N.lot([{ id: "z", pages: pp(8) }]).map((e) => e.id), ["z"]);
});

test("« Plus tard » laisse nouvelles les entrées pas atteintes", () => {
  magasin.clear();
  const catalogue = [{ id: "a", serie: 3, capacite: null, pages: [page, page, page] }, { id: "b", serie: 3, capacite: null, pages: [page, page] }];
  const m1 = modele([], catalogue);
  m1.noter(m1.aMontrer(), 1);
  assert.equal(m1.estNouvelle(catalogue[0]), false, "affichée : vue");
  assert.equal(m1.etat(catalogue[0]), "commence", "page 2 sur 3 : commencée");
  assert.equal(m1.estNouvelle(catalogue[1]), true, "jamais atteinte : toujours nouvelle");
  assert.deepEqual(modele([], catalogue).aMontrer().map((e) => e.id), ["b"], "au lancement suivant");
  assert.deepEqual(N.entreesJusqua(catalogue, 3).map((e) => e.id), ["a", "b"], "la première page de « b » suffit");
  assert.deepEqual(N.entreesJusqua(catalogue, 2).map((e) => e.id), ["a"]);
});

test("revoir depuis l'historique ; « N à découvrir »", () => {
  magasin.clear();
  const m = modele(["modeles-v1"]);
  assert.equal(m.aDecouvrir(), 2, "« modele » et « selection » ; « lieux » et « cadran » attendent leur capacité");
  m.noter([essai[0]], 0);
  assert.equal(m.estNouvelle(essai[0]), false);
  assert.equal(m.etat(essai[0]), "suivi", "une page sur une : suivie");
  assert.equal(m.aDecouvrir(), 1);
});

test("le catalogue reste court, sans les entrées propres à l'iPhone", () => {
  const ids = N.CATALOGUE.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "identifiants uniques");
  for (const id of ["hors-app", "partage", "au-pouce", "privee-iphone", "selection"]) assert.ok(!ids.includes(id), id);
  for (const id of ["planning-remy", "projets-bloques", "dependances-taches", "pieces-jointes", "maj-auto", "prochaines-heures", "recherche-projets", "rappels-declencheurs", "telechargements-accord", "image-noter", "conversation-privee", "conversations-externes", "reglages-recherche", "jauge-retour", "activite-pc", "rituel", "a-trancher", "priorites", "carnet-remy", "recherche-web", "modele", "regles"]) {
    assert.ok(ids.includes(id), id);
  }
  // Retirées (12/11), comme sur l'iPhone : l'id dans RETIREES, l'entrée hors du catalogue.
  for (const id of Object.keys(N.RETIREES)) assert.ok(!ids.includes(id), `${id} : retirée mais encore au catalogue`);
  assert.deepEqual(Object.keys(N.RETIREES).sort(), ["bilan-coucher", "compactage", "jauge"]);
  for (const e of N.CATALOGUE) if (e.remplace) assert.ok(e.remplace !== e.id && (ids.includes(e.remplace) || N.RETIREES[e.remplace]), e.id);
  assert.equal(N.CATALOGUE.find((e) => e.id === "priorites").aRemplacer, true, "« Ce qui compte » est à remplacer");
  for (const e of N.CATALOGUE) {
    assert.ok(e.pages.length >= 1 && e.pages.length <= 3, `${e.id} : un mini tutoriel, pas un cours`);
    for (const p of e.pages) {
      assert.ok(p.titre && p.icone, e.id);
      assert.ok(p.texte.length <= 240, `${e.id} : « ${p.titre} » trop long (${p.texte.length})`);
      assert.doesNotMatch(p.texte, /glisse|appui long|touche |iPhone ›/i, `${e.id} : un geste de l'iPhone dans « ${p.titre} »`);
    }
  }
});

// --- Le suivi (12/11) ---

test("trois états : à découvrir, commencé (avec sa page et sa date), suivi ; la reprise à la page", () => {
  magasin.clear();
  const trois = { id: "trois", serie: 1, date: "1 nov.", titre: "Trois", capacite: null, pages: [page, page, page] };
  let t = Date.UTC(2026, 10, 3, 10); // 3 nov., 11 h à Paris
  const m = N.modele({ catalogue: [trois], cle: "essai-vues", maintenant: () => t });
  assert.equal(m.etat(trois), "aDecouvrir");
  assert.equal(m.libelle(trois), "À découvrir · paru le 1 nov.");
  assert.deepEqual(m.lotPour(trois), { entrees: [trois], depart: 0 });
  m.noter([trois], 0);
  m.noter([trois], 1, t + 60000);
  assert.equal(m.etat(trois), "commence");
  assert.equal(m.suivi(trois).date, t, "la date de l'ouverture");
  assert.equal(m.libelle(trois), "Commencé le 3 nov. · page 2 sur 3");
  // Un autre modèle (un autre écran, un relancement) lit le même suivi.
  const m2 = N.modele({ catalogue: [trois], cle: "essai-vues", maintenant: () => t });
  assert.equal(m2.lotPour(trois).depart, 1, "reprise à la page où il s'était arrêté");
  t = Date.UTC(2026, 10, 5, 10);
  m2.noter([trois], 2);
  assert.equal(m2.etat(trois), "suivi");
  assert.equal(m2.libelle(trois), "Suivi le 5 nov.");
  assert.equal(m2.lotPour(trois).depart, 0, "suivi : revu depuis le début");
  m2.noter([trois], 0, t + 86400000);
  assert.equal(m2.suivi(trois).date, t, "jamais en arrière, la date ne bouge pas");
  // Un lot : l'entrée dépassée est suivie, la suivante commencée.
  magasin.clear();
  const un = { id: "un", serie: 1, capacite: null, pages: [page, page] };
  const deux = { id: "deux", serie: 1, capacite: null, pages: [page, page] };
  const m3 = modele([], [un, deux]);
  m3.noter([un, deux], 2);
  assert.equal(m3.etat(un), "suivi");
  assert.equal(m3.etat(deux), "commence");
  assert.deepEqual(N.avancement([un, deux], 2).map((x) => x.page), [1, 0]);
});

test("la reprise des « vus » d'avant : commencés, jamais « à découvrir », une seule fois", () => {
  magasin.clear();
  magasin.set("essai-vues", JSON.stringify(["modele", "cadran", "disparue"]));
  const t = Date.UTC(2026, 10, 12, 10);
  const m = N.modele({ catalogue: essai, sait: sait(["modeles-v1", "lieux-v1", "jauge-v1"]), cle: "essai-vues", maintenant: () => t });
  assert.equal(m.etat(essai[0]), "commence");
  assert.equal(m.etat(essai[2]), "commence");
  assert.equal(m.etat(essai[1]), "aDecouvrir");
  assert.equal(m.libelle(essai[0]), "Commencé · ouvert avant le 12 nov.");
  assert.equal(m.resume(), "2 à découvrir · 2 commencés · 0 suivi", "« disparue » n'est plus au catalogue");
  // Une installation d'avant : les deux dernières séries (1 et 2) peuvent encore se présenter.
  assert.deepEqual(m.aMontrer().map((e) => e.id), ["selection", "lieux"]);
  m.noter([essai[2]], 0, t + 86400000);
  assert.equal(m.libelle(essai[2]), "Suivi le 13 nov.");
  magasin.set("essai-vues", JSON.stringify(["lieux"]));
  const m2 = modele(["modeles-v1", "lieux-v1", "jauge-v1"]);
  assert.equal(m2.etat(essai[1]), "aDecouvrir", "l'ancienne clé n'est plus relue");
  assert.equal(m2.etat(essai[2]), "suivi");
});

test("la péremption : seules les deux dernières séries se présentent ; « à remplacer » ne se présente plus", () => {
  magasin.clear();
  magasin.set("essai-vues", "[]"); // une installation d'avant, rien de vu
  const c = [
    { id: "s4", serie: 4, date: "", titre: "S4", capacite: null, pages: [page] },
    { id: "s4-change", serie: 4, date: "", titre: "Va changer", capacite: null, pages: [page], aRemplacer: true },
    { id: "s3", serie: 3, date: "", titre: "S3", capacite: null, pages: [page] },
    { id: "s2", serie: 2, date: "", titre: "S2", capacite: null, pages: [page] },
    { id: "s1", serie: 1, date: "", titre: "S1", capacite: null, pages: [page] },
  ];
  const m = modele([], c);
  assert.equal(N.SERIES_PRESENTEES, 2);
  assert.equal(m.serieMinimale(), 3);
  const a = m.aMontrer();
  assert.deepEqual(a.map((e) => e.id), ["s3", "s4"]);
  m.noter(a, 1);
  assert.ok(m.libelle(c[1]).endsWith("· bientôt remplacé"));
  assert.deepEqual(m.groupes().map((g) => g.id), ["a-decouvrir", "suivis"]);
  assert.deepEqual(m.groupes()[0].entrees.map((e) => e.id), ["s4-change", "s2", "s1"], "à découvrir d'abord, la plus récente en tête");
  assert.deepEqual(modele([], c).aMontrer(), [], "le reste attend dans le suivi");
  // Le vrai catalogue : « Ce qui compte » ne se présente jamais, même tour à jour.
  magasin.clear();
  const montrees = [];
  for (let i = 0; i < 12; i++) {
    const v = N.modele({ catalogue: N.CATALOGUE.filter((e) => e.serie <= 3), sait: () => true, cle: "vrai-vues" });
    const l = v.aMontrer();
    if (!l.length) break;
    montrees.push(...l.map((e) => e.id));
    v.noter(l, N.pagesDe(l).length - 1);
  }
  assert.ok(montrees.length > 3);
  assert.ok(!montrees.includes("priorites"), montrees.join(", "));
});

test("une entrée retirée disparaît du suivi et du lancement ; son état gardé ne casse rien", () => {
  magasin.clear();
  magasin.set("essai-vues", JSON.stringify(["partie"]));
  const c = [{ id: "gardee", serie: 2, date: "", titre: "Gardée", capacite: null, pages: [page] }, { id: "partie", serie: 2, date: "", titre: "Partie", capacite: null, pages: [page, page] }];
  const m = N.modele({ catalogue: c, cle: "essai-vues", retirees: ["partie"] });
  assert.deepEqual(m.historique().map((e) => e.id), ["gardee"]);
  assert.equal(m.resume(), "1 à découvrir · 0 commencé · 0 suivi");
  assert.deepEqual(m.aMontrer().map((e) => e.id), ["gardee"]);
  // Le vrai catalogue : rien de retiré au suivi.
  const vrai = N.modele({ sait: () => true, cle: "vrai2-vues" });
  for (const g of vrai.groupes()) for (const e of g.entrees) assert.ok(!N.RETIREES[e.id], e.id);
});

test("une remplaçante sort l'ancienne (quand la tour la connaît) et part « à découvrir »", () => {
  magasin.clear();
  const c = [
    { id: "classement", serie: 3, date: "", titre: "Le classement", capacite: "classement-v1", pages: [page], remplace: "ancienne" },
    { id: "ancienne", serie: 2, date: "", titre: "Écris-les", capacite: null, pages: [page], aRemplacer: true },
  ];
  const m = modele([], c);
  m.noter([c[1]], 0);
  assert.equal(m.etat(c[1]), "suivi");
  assert.deepEqual(m.historique().map((e) => e.id), ["classement", "ancienne"], "la tour ne connaît pas encore la nouvelle");
  assert.equal(m.groupes().at(-1).id, "tour");
  const m2 = modele(["classement-v1"], c);
  assert.deepEqual(m2.historique().map((e) => e.id), ["classement"]);
  assert.equal(m2.etat(c[0]), "aDecouvrir", "suivre l'ancienne ne dispense pas de la nouvelle");
  assert.deepEqual(m2.aMontrer().map((e) => e.id), ["classement"]);
});

test("« Tout marquer comme suivi », puis « Annuler » : l'état d'avant revient", () => {
  magasin.clear();
  const m = modele(["modeles-v1", "jauge-v1"]);
  m.noter([essai[0]], 0);
  assert.equal(m.resume(), "2 à découvrir · 0 commencé · 1 suivi");
  assert.deepEqual(new Set(m.aMarquer().map((e) => e.id)), new Set(["cadran", "selection"]), "« lieux » attend la tour");
  const r = m.toutMarquerSuivi();
  assert.equal(r.n, 2);
  assert.equal(m.resume(), "0 à découvrir · 0 commencé · 3 suivis");
  assert.deepEqual(m.groupes().map((g) => g.id), ["suivis", "tour"]);
  r.annuler();
  assert.equal(m.resume(), "2 à découvrir · 0 commencé · 1 suivi");
  assert.equal(m.etat(essai[2]), "aDecouvrir");
  assert.equal(m.toutMarquerSuivi().n, 2);
  assert.equal(m.toutMarquerSuivi().n, 0, "rien de plus à ranger");
});

test("le résumé s'accorde ; les jours à l'heure de Paris", () => {
  assert.equal(N.resume(0, 1, 0), "0 à découvrir · 1 commencé · 0 suivi");
  assert.equal(N.resume(3, 2, 22), "3 à découvrir · 2 commencés · 22 suivis");
  assert.equal(N.jour(Date.UTC(2026, 11, 31, 23, 30)), "1 janv.", "minuit passé à Paris");
  assert.equal(N.jour(Date.UTC(2026, 7, 15, 12)), "15 août");
  for (const etat of ["aDecouvrir", "commence", "suivi"]) assert.ok(N.ETATS[etat].mot && N.ETATS[etat].icone, etat);
});
