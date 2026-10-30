// Les nouveautés du site (port de Nouveautes.swift) : une fois, seulement
// quand la tour connaît la fonction, jamais une entrée coupée ; l'historique
// garde tout. Les cas de NouveautesTests.swift, sur un catalogue d'essai figé.
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
  { id: "jauge", serie: 1, date: "", titre: "Jauge", capacite: "jauge-v1", pages: [page] },
  { id: "selection", serie: 1, date: "", titre: "Sélection", capacite: null, pages: [page] },
];
const sait = (liste) => (c) => liste.includes(c);
const modele = (capacites, catalogue = essai) => N.modele({ catalogue, sait: sait(capacites), cle: "essai-vues" });

test("le premier lancement ne montre que la dernière mise à jour ; vue une fois, plus jamais", () => {
  magasin.clear();
  const m = modele(["modeles-v1", "lieux-v1", "jauge-v1"]);
  const a = m.aMontrer();
  assert.deepEqual(new Set(a.map((e) => e.id)), new Set(["modele", "lieux"]), "l'historique ne s'impose pas");
  assert.equal(m.estNouvelle(essai[2]), false);
  m.marquerVues(N.entreesJusqua(a, 1));
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
  m.marquerVues(m.aMontrer());
  assert.deepEqual(modele(["lieux-v1", "modeles-v1"]).aMontrer().map((e) => e.id), ["modele"]);
  assert.equal(modele([]).existe({ id: "x", capacite: "inconnue-v1", pages: [] }), false);
  assert.equal(modele([]).existe({ id: "y", capacite: null, pages: [] }), true);
});

test("une mise à jour suivante montre seulement sa nouveauté ; l'historique, la plus récente d'abord", () => {
  magasin.clear();
  const ancien = [{ id: "a", serie: 1, titre: "A", capacite: null, pages: [page] }, { id: "b", serie: 2, titre: "B", capacite: null, pages: [page] }];
  const m1 = modele([], ancien);
  assert.deepEqual(m1.aMontrer().map((e) => e.id), ["b"]);
  m1.marquerVues(m1.aMontrer());
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
  m1.marquerVues(N.entreesJusqua(a, 4));
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
  m1.marquerVues(N.entreesJusqua(m1.aMontrer(), 1));
  assert.equal(m1.estNouvelle(catalogue[0]), false, "affichée : vue");
  assert.equal(m1.estNouvelle(catalogue[1]), true, "jamais atteinte : toujours nouvelle");
  assert.deepEqual(modele([], catalogue).aMontrer().map((e) => e.id), ["b"], "au lancement suivant");
  assert.deepEqual(N.entreesJusqua(catalogue, 3).map((e) => e.id), ["a", "b"], "la première page de « b » suffit");
  assert.deepEqual(N.entreesJusqua(catalogue, 2).map((e) => e.id), ["a"]);
});

test("revoir depuis l'historique ; « N nouvelle(s) à découvrir »", () => {
  magasin.clear();
  const m = modele(["modeles-v1"]);
  assert.equal(m.aDecouvrir(), 1, "« lieux » attend sa capacité ; « modele » est à découvrir");
  m.marquerVues([essai[0]]);
  assert.equal(m.estNouvelle(essai[0]), false);
  assert.equal(m.aDecouvrir(), 0);
});

test("le catalogue reste court, sans les entrées propres à l'iPhone", () => {
  const ids = N.CATALOGUE.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "identifiants uniques");
  for (const id of ["hors-app", "partage", "au-pouce", "privee-iphone", "selection"]) assert.ok(!ids.includes(id), id);
  for (const id of ["telechargements-accord", "image-noter", "conversation-privee", "conversations-externes", "reglages-recherche", "bilan-coucher", "jauge-retour", "activite-pc", "rituel", "a-trancher", "priorites", "carnet-remy", "recherche-web", "modele", "regles", "compactage"]) {
    assert.ok(ids.includes(id), id);
  }
  for (const e of N.CATALOGUE) {
    assert.ok(e.pages.length >= 1 && e.pages.length <= 3, `${e.id} : un mini tutoriel, pas un cours`);
    for (const p of e.pages) {
      assert.ok(p.titre && p.icone, e.id);
      assert.ok(p.texte.length <= 240, `${e.id} : « ${p.titre} » trop long (${p.texte.length})`);
      assert.doesNotMatch(p.texte, /glisse|appui long|touche |iPhone ›/i, `${e.id} : un geste de l'iPhone dans « ${p.titre} »`);
    }
  }
});
