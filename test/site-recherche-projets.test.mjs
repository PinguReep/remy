// Chercher dans Projets (12/11) : le module pur public/app/analyse/recherche-projets.js,
// avec les cas de RechercheProjetsTests.swift (données FICTIVES : Sam, Léa, Hugo,
// la boutique de bougies), puis la vue qui s'en sert.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const R = await import("../public/app/analyse/recherche-projets.js");

const donnees = {
  projets: [
    { id: "p1", nom: "Boutique de bougies", taches: 3, liste: [
      { id: "t1", titre: "Finaliser la démo de la boutique", duree: 120 },
      { id: "t2", titre: "Commander les mèches en coton" },
      { id: "t3", titre: "Préparer la caisse de bougies" },
    ] },
    { id: "p2", nom: "Album « Été »", taches: 1, liste: [{ id: "t4", titre: "Retoucher les photos de l'été" }, { id: "t1", titre: "Finaliser la démo de la boutique" }] },
  ],
  dossiers: [
    { id: "d-demo", nom: "Démo client", parent: "motion:p1", notes: [], taches: ["t1"] },
    { id: "d-maison", nom: "Maison", parent: null, notes: [{ id: "n1", texte: "Devis plombier", fait: false }], taches: [] },
    { id: "d-cuisine", nom: "Travaux cuisine", parent: "d-maison", notes: [{ id: "n2", texte: "Choisir le carrelage", fait: true }, { id: "n3", texte: "Carrelage mural blanc" }], taches: [] },
    { id: "idees", nom: "Idées", parent: null, notes: [{ id: "n4", texte: "Un atelier bougies parfumées pour les fêtes" }], taches: [] },
  ],
  listes: [
    { id: "l-courses", nom: "Courses", elements: [{ id: "e1", texte: "Lait d'avoine", fait: false }, { id: "e2", texte: "Œufs", fait: false }, { id: "e3", texte: "Café", fait: true }] },
    { id: "l-anniv", nom: "Anniversaires", elements: [{ id: "e4", texte: "Léa — 14 mars" }, { id: "e5", texte: "Hugo — 2 juin" }] },
    { id: "l-vide", nom: "Cadeaux", elements: [] },
  ],
  rappels: [
    { id: "r1", texte: "Rendre le livre à Léa", quand: null, fait: false },
    { id: "r2", texte: "Rappeler Hugo", quand: 1_800_000_000_000, fait: false },
    { id: "r3", texte: "Renouveler le passeport", fait: false, note: "Photos d'identité et ancien passeport." },
    { id: "r4", texte: "Appeler Léa", fait: true },
  ],
};
const ids = (r, genre) => r.groupes.find((g) => g.genre === genre)?.trouves.map((t) => t.id) || [];
const genres = (r) => r.groupes.map((g) => g.genre);

test("une saisie vide ne cherche rien ; l'écran garde son arborescence", () => {
  for (const q of ["", "   ", "…", null, undefined]) {
    const r = R.chercher(q, donnees);
    assert.equal(r.vide, true, String(q));
    assert.deepEqual(r.groupes, []);
    assert.equal(r.titreVide, null);
  }
});

test("chaque genre est trouvé, groupé dans l'ordre de l'écran, avec l'écran qu'il ouvre", () => {
  const r = R.chercher("léa", donnees);
  assert.deepEqual(genres(r), ["article", "rappel"]);
  assert.deepEqual(ids(r, "article"), ["l-anniv/e4"]);
  assert.deepEqual(ids(r, "rappel"), ["r1", "r4"], "le fait après ce qui reste à faire");
  assert.equal(r.groupes[0].titre, "Articles");
  assert.deepEqual(r.groupes[0].trouves[0].cible, { type: "liste", id: "l-anniv" });
  assert.equal(r.groupes[0].trouves[0].contexte, "Anniversaires");
  assert.deepEqual(r.groupes[1].trouves[0].cible, { type: "rappel", id: "r1" });
  assert.equal(r.enTete, "3 résultats");

  const b = R.chercher("bougies", donnees);
  assert.deepEqual(genres(b), ["projet", "tache", "note"]);
  assert.deepEqual(b.groupes[0].trouves[0].cible, { type: "projet", id: "p1" });
  assert.equal(b.groupes[0].trouves[0].contexte, "3 tâches");
  assert.equal(b.groupes[1].trouves[0].id, "t3");
  assert.equal(b.groupes[1].trouves[0].contexte, "Boutique de bougies");
  assert.deepEqual(b.groupes[2].trouves[0].cible, { type: "dossier", id: "idees" });
  assert.equal(b.groupes[2].trouves[0].contexte, "Idées");
});

test("sans accents ni majuscules, mot à mot dans n'importe quel ordre, le début d'un mot suffit", () => {
  assert.deepEqual(ids(R.chercher("DEMO", donnees), "tache"), ["t1"]);
  assert.deepEqual(ids(R.chercher("demo", donnees), "dossier"), ["d-demo"]);
  assert.deepEqual(ids(R.chercher("oeufs", donnees), "article"), ["l-courses/e2"], "« œ » se cherche « oe »");
  assert.deepEqual(ids(R.chercher("avo lait", donnees), "article"), ["l-courses/e1"]);
  assert.deepEqual(ids(R.chercher("cafe", donnees), "article"), ["l-courses/e3"]);
  assert.deepEqual(ids(R.chercher("meches coton", donnees), "tache"), ["t2"]);
  // Un mot au milieu d'un autre ne compte pas : « ache » ne trouve pas « Préparer la caisse ».
  assert.equal(R.chercher("aisse", donnees).total, 0);
  // Tous les mots doivent y être.
  assert.equal(R.chercher("lait cafe", donnees).total, 0);
  // Les mots vides de sens ne comptent pas, sauf s'il n'y a qu'eux.
  assert.deepEqual(ids(R.chercher("le livre de Léa", donnees), "rappel"), ["r1"]);
});

test("tâches : une seule fois même dans deux projets ; son sous-projet dans le contexte ; la cible porte la tâche", () => {
  const r = R.chercher("finaliser", donnees);
  assert.deepEqual(ids(r, "tache"), ["t1"]);
  const t = r.groupes[0].trouves[0];
  assert.equal(t.contexte, "Boutique de bougies › Démo client");
  assert.equal(t.cible.type, "tache");
  assert.equal(t.cible.projet, "Boutique de bougies");
  assert.equal(t.cible.tache.duree, 120);
});

test("dossiers et idées : le parent dit où il vit (un projet Motion ou un dossier) ; une idée relue après", () => {
  const r = R.chercher("carrelage", donnees);
  assert.deepEqual(ids(r, "note"), ["d-cuisine/n3", "d-cuisine/n2"], "l'idée relue (faite) après");
  assert.equal(r.groupes[0].trouves[1].fait, true);
  assert.equal(R.chercher("travaux", donnees).groupes[0].trouves[0].contexte, "Dans « Maison »");
  assert.equal(R.chercher("démo client", donnees).groupes.find((g) => g.genre === "dossier").trouves[0].contexte, "Dans « Boutique de bougies »");
  assert.equal(R.chercher("maison", donnees).groupes[0].trouves[0].contexte, null);
});

test("listes : le nom et ce qui reste à prendre ; rappels : la note compte, moins que le titre", () => {
  assert.equal(R.chercher("courses", donnees).groupes[0].trouves[0].contexte, "2 à prendre");
  assert.equal(R.chercher("cadeaux", donnees).groupes[0].trouves[0].contexte, "vide");
  const r = R.chercher("identité", donnees);
  assert.deepEqual(ids(r, "rappel"), ["r3"]);
  assert.equal(r.groupes[0].trouves[0].contexte, "Photos d'identité et ancien passeport.");
  const p = R.chercher("passeport", donnees);
  assert.ok(p.groupes[0].trouves[0].note > R.chercher("ancien", donnees).groupes[0].trouves[0].note, "le titre avant la note");
  assert.equal(R.chercher("rappeler", donnees).groupes[0].trouves[0].quand, 1_800_000_000_000);
});

test("le mieux noté d'abord : le mot entier, puis le texte qui commence par la saisie", () => {
  const extra = { ...donnees, rappels: [
    { id: "a", texte: "Penser aux rappels de vaccin", fait: false },
    { id: "b", texte: "Rappel du dentiste", fait: false },
    { id: "c", texte: "Le rappel de la banque", fait: false },
  ] };
  assert.deepEqual(ids(R.chercher("rappel", extra), "rappel"), ["b", "c", "a"]);
});

test("le texte trouvé, en morceaux : le début de chaque mot qui répond, accents et majuscules d'origine gardés", () => {
  const q = ["avo", "lait"];
  assert.deepEqual(R.morceaux("Lait d'avoine", q), [{ texte: "Lait", trouve: true }, { texte: " d'", trouve: false }, { texte: "avo", trouve: true }, { texte: "ine", trouve: false }]);
  assert.deepEqual(R.morceaux("Œufs frais", ["oe"]), [{ texte: "Œ", trouve: true }, { texte: "ufs frais", trouve: false }]);
  assert.deepEqual(R.morceaux("Démo", ["dem"]), [{ texte: "Dém", trouve: true }, { texte: "o", trouve: false }]);
  assert.deepEqual(R.morceaux("Rien", ["xyz"]), [{ texte: "Rien", trouve: false }]);
  assert.deepEqual(R.morceaux("", ["a"]), []);
  // Recollés, les morceaux redonnent le texte.
  const r = R.chercher("bougies", donnees);
  for (const g of r.groupes) for (const t of g.trouves) assert.equal(t.morceaux.map((m) => m.texte).join(""), t.titre.normalize("NFC"));
  assert.ok(r.groupes[0].trouves[0].morceaux.some((m) => m.trouve && m.texte === "bougies"));
});

test("l'état vide : « Rien pour … », et ce qui manque quand les projets ne sont pas lus", () => {
  const r = R.chercher("trampoline", donnees);
  assert.equal(r.total, 0);
  assert.deepEqual(r.groupes, []);
  assert.equal(r.titreVide, "Rien pour « trampoline ».");
  assert.match(r.detailVide, /autre mot/);
  assert.doesNotMatch(r.detailVide, /pas encore lus/);
  const sans = R.chercher("trampoline", { ...donnees, projets: null });
  assert.match(sans.detailVide, /projets Motion ne sont pas encore lus/);
  // Sans projets, le reste se cherche quand même.
  assert.deepEqual(ids(R.chercher("léa", { ...donnees, projets: null }), "rappel"), ["r1", "r4"]);
  assert.equal(R.chercher("1", donnees).enTete, "1 résultat", "« Léa — 14 mars »");
});

test("des données abîmées ne cassent rien ; au plus 20 par genre, le reste compté", () => {
  const abime = { projets: [null, { id: "x" }, { id: "y", nom: "Sans liste", liste: [null, { id: "z" }] }], dossiers: [{ id: "d", nom: "D", notes: [null, { id: "n" }] }, {}],
    listes: [{ id: "l", nom: "L", elements: null }, null], rappels: [{ id: "r" }, null, { texte: "sans id" }] };
  assert.doesNotThrow(() => R.chercher("sans", abime));
  assert.deepEqual(R.chercher("sans", abime).groupes.map((g) => g.genre), ["projet"]);
  const beaucoup = { rappels: Array.from({ length: 27 }, (_, i) => ({ id: `r${i}`, texte: `Appeler Sam ${i}`, fait: false })) };
  const r = R.chercher("sam", beaucoup);
  assert.equal(r.total, 27);
  assert.equal(r.groupes[0].trouves.length, R.PAR_GROUPE);
  assert.equal(r.groupes[0].reste, 7);
  assert.equal(R.phraseReste(7), "et 7 autres : précise ta recherche");
  assert.equal(R.phraseReste(1), "et 1 autre : précise ta recherche");
});

test("la vue Projets cherche avec ce module, pas seulement dans les titres de la colonne", () => {
  const vue = fs.readFileSync(new URL("../public/app/vues/projets.js", import.meta.url), "utf8");
  assert.match(vue, /from "\.\.\/analyse\/recherche-projets\.js"/);
  assert.match(vue, /R\.chercher\(/);
  assert.match(vue, /titreVide/);
  assert.match(vue, /placeholder: "Chercher une tâche, une liste, un rappel…"/);
});
