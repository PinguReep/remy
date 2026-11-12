// Les pièces jointes du chat, côté site (12/11) : public/app/analyse/pieces.js
// (mêmes limites et mêmes mots que la tour), et le branchement dans la vue.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const P = await import("../public/app/analyse/pieces.js");
const T = await import("../lib/pieces.js");

test("les mêmes limites que la tour", () => {
  assert.equal(P.PIECE_MAX, T.PIECE_MAX);
  assert.equal(P.PIECES_PAR_MESSAGE, T.PIECES_PAR_MESSAGE);
  for (const n of [0, 512, 240 * 1024, 1.25 * 1024 * 1024, 10 * 1024 * 1024]) assert.equal(P.tailleLisible(n), T.tailleLisible(n));
});

test("avant l'envoi : type, taille, nombre — refusé avec la raison", () => {
  assert.equal(P.refus({ nom: "capture.png", taille: 1000 }), null);
  assert.equal(P.refus({ nom: "notes.MD", taille: 10 }), null);
  assert.equal(P.refus({ nom: "devis.pdf", taille: P.PIECE_MAX }), null);
  assert.match(P.refus({ nom: "logo.svg", taille: 10 }), /type non pris/);
  assert.match(P.refus({ nom: "page.html", taille: 10 }), /type non pris/);
  assert.match(P.refus({ nom: "gros.pdf", taille: P.PIECE_MAX + 1 }), /trop lourd \(10 Mo\) : 10 Mo au plus/);
  assert.match(P.refus({ nom: "vide.txt", taille: 0 }), /vide/);
  assert.match(P.refus({ nom: "x.png", taille: 1 }, 4), /4 pièces au plus/);
});

test("une capture collée a un nom ; l'aperçu pour le modèle tient dans 1344 px", () => {
  assert.equal(P.nomCollage("image/png", new Date(2026, 10, 12, 9, 5, 7)), "capture-20261112-090507.png");
  assert.equal(P.nomCollage("image/jpeg", new Date(2026, 0, 2, 3, 4, 5)), "capture-20260102-030405.jpg");
  assert.deepEqual(P.reduction(4032, 3024), { largeur: 1344, hauteur: 1008 });
  assert.deepEqual(P.reduction(800, 600), { largeur: 800, hauteur: 600 }, "jamais agrandie");
  assert.equal(P.reduction(0, 10), null);
});

test("la mention : celle de la tour, sinon la même règle", () => {
  assert.equal(P.mention({ mention: "lue par Rémy (texte du PDF, 2 pages)" }), "lue par Rémy (texte du PDF, 2 pages)");
  for (const f of [
    { famille: "texte", lu: "texte" },
    { famille: "pdf", lu: "texte", pages: 3 },
    { famille: "pdf", lu: "non", raison: "PDF protégé par un mot de passe" },
    { famille: "image", lu: "ocr", par: "iphone", texte: "x" },
    { famille: "image", lu: "ocr", par: "tour", texte: "x", description: "y" },
    { famille: "image", lu: "decrite", description: "y" },
    { famille: "image", lu: "non", raison: "pas de modèle de vision local" },
  ]) {
    assert.equal(P.mention(T.vuePublique(f)), T.mention(f));
    assert.equal(T.vuePublique(f).texte, undefined);
    assert.equal(T.vuePublique(f).description, undefined);
  }
  assert.equal(T.mention({ famille: "image", lu: "ocr", par: "tour", texte: "x", description: "y" }), "texte reconnu sur la tour, décrite par le modèle local — peut se tromper");
  assert.equal(T.mention({ famille: "pdf", lu: "non", raison: "PDF protégé par un mot de passe" }), "non lue par Rémy : PDF protégé par un mot de passe");
  assert.equal(P.estLue({ lu: "non" }), false);
  assert.equal(P.adresse("c 1", "ab", { telecharger: true }), "/api/conversations/c%201/pieces/ab?telecharger=1");
  assert.equal(P.peutPartir("", [{}]), true);
  assert.equal(P.peutPartir("  ", []), false);
});

test("la vue : trombone sous la capacité, coller, déposer ; jamais localStorage pour les pièces", () => {
  const v = fs.readFileSync(new URL("../public/app/vues/remy.js", import.meta.url), "utf8");
  assert.match(v, /refs\.joindre\.hidden = !sait\("pieces-v1"\) \|\| modeRetenir/);
  assert.match(v, /addEventListener\("paste"/);
  assert.match(v, /addEventListener\("drop"/);
  assert.match(v, /pieces: fiches\.map\(\(f\) => f\.id\)/);
  assert.doesNotMatch(v, /local\.ecrire\([^)]*piece/i);
  const r = fs.readFileSync(new URL("../public/app/vues/reglages.js", import.meta.url), "utf8");
  assert.match(r, /sait\("pieces-v1"\) \? essaiPieces\(\) : null/);
  assert.match(r, /\/api\/pieces\/essai/);
});
