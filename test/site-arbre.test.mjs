// Le site et l'arbre des projets (arbre-v1, verrou-v1) — données FICTIVES :
// ce que la ligne de l'arbre montre sans clic, l'origine de chaque champ dite
// en clair, les gestes « C'est ça / Corriger / Pas ça », le bandeau de
// conversation, « Rattacher à… », et ce que l'écran du verrou dit de lui-même.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const A = await import("../public/app/analyse/arbre.js");
const lire = (f) => fs.readFileSync(new URL(`../public/app/${f}`, import.meta.url), "utf8");
const J = 86_400_000;
const T0 = new Date(2026, 10, 12, 18, 0).getTime();

const interface_ = {
  noeud: "dossier:d-interface", type: "dossier", nom: "Interface", parent: "dossier:d-fonction", niveau: 2, chemin: ["Assistant", "Fonctionnalité", "Interface"],
  fiche: { pourquoi: { texte: "Voir où on en est sans chercher", origine: "ecrit", source: null, a: T0 - J }, etat: { texte: "en_cours", origine: "confirme", source: "d'après une tâche cochée hier", a: T0 - 3 * J }, point: null },
  propositions: { point: { texte: "Ensuite : « Tester au pouce ».", source: "d'après 1 tâche Motion", origine: "deduit" } },
};
const boutique = {
  noeud: "motion:p1", type: "motion", nom: "Boutique", parent: null, niveau: 0, chemin: ["Boutique"],
  fiche: { pourquoi: null, etat: null, point: null },
  propositions: { etat: { texte: "en_attente", source: "tu as dit qu'il attend « Maison »", origine: "deduit" }, pourquoi: { texte: "Mon revenu de l'an prochain", source: "tes mots pour ta priorité n°1", origine: "deduit" } },
};

test("la ligne de l'arbre : la pastille (forme + mot), où on en est OU pourquoi, son âge ; une déduction se voit comme telle", () => {
  const l = A.ligneArbre(interface_, T0);
  assert.deepEqual(l.pastille, { code: "en_cours", libelle: "en cours", forme: "plein", propose: false });
  assert.deepEqual(l.ligne, { champ: "point", texte: "Ensuite : « Tester au pouce ».", origine: "deduit", age: null, vieux: false });
  assert.equal(l.pourquoi.texte, "Voir où on en est sans chercher");
  assert.equal(l.pourquoi.age, "hier");
  const b = A.ligneArbre(boutique, T0);
  assert.equal(b.pastille.propose, true, "un état proposé n'est pas montré comme un fait");
  assert.equal(b.pastille.forme, "sablier");
  assert.equal(b.ligne.champ, "pourquoi", "sans point, le pourquoi");
  assert.equal(b.pourquoi, null);
  // Toutes les formes sont distinctes : la couleur n'est jamais seule.
  assert.equal(new Set(Object.values(A.PASTILLES).map((p) => p.forme)).size, A.ETATS.length);
  // Un point écrit il y a longtemps s'atténue.
  const vieux = { ...interface_, fiche: { ...interface_.fiche, point: { texte: "Maquette faite", origine: "ecrit", a: T0 - 30 * J } }, propositions: {} };
  assert.equal(A.ligneArbre(vieux, T0).ligne.vieux, true);
  assert.equal(A.ligneArbre({ fiche: {}, propositions: {} }, T0).ligne, null);
});

test("l'origine en clair : proposé (de quoi), confirmé (et ce que Rémy avait déduit), écrit — avec la date", () => {
  assert.equal(A.origine(A.valeur(boutique, "pourquoi"), T0), "Proposé par Rémy, tes mots pour ta priorité n°1");
  assert.equal(A.origine(A.valeur(interface_, "etat"), T0), "Confirmé par toi il y a 3 j — Rémy l'avait déduit d'après une tâche cochée hier");
  assert.equal(A.origine(A.valeur(interface_, "pourquoi"), T0), "Écrit par toi hier");
  assert.equal(A.origine({ texte: "x", origine: "deduit", source: "d'après ta mémoire", memoire: true }), "Proposé par Rémy, d'après ta mémoire (sa mémoire)");
  // Jours du calendrier : hier soir, c'est « hier », même à moins de 24 h.
  assert.equal(A.age(new Date(2026, 10, 11, 23, 30).getTime(), new Date(2026, 10, 12, 8, 0).getTime()), "hier");
  assert.equal(A.age(T0 - 90 * J, T0), "il y a 3 mois");
});

test("les gestes : « C'est ça » garde la source, « Corriger » prend les mots de Sam, « Pas ça » écarte ; la fiche relue retire la proposition", () => {
  const p = A.proposition(boutique, "pourquoi");
  assert.deepEqual(A.corpsConfirmer("pourquoi", p), { pourquoi: { texte: "Mon revenu de l'an prochain", origine: "confirme", source: "tes mots pour ta priorité n°1" } });
  assert.deepEqual(A.corpsCorriger("point", "  Reste   la page boutique "), { point: { texte: "Reste la page boutique", origine: "ecrit" } });
  assert.deepEqual(A.corpsEcarter("pourquoi", p), { ecarter: { champ: "pourquoi", texte: "Mon revenu de l'an prochain" } });
  const maj = A.avecFiche(boutique, { pourquoi: { texte: "Mon revenu de l'an prochain", origine: "confirme", source: "tes mots pour ta priorité n°1", a: T0 }, etat: null, point: null, ecartes: { etat: "en_attente" } });
  assert.equal(maj.propositions.pourquoi, undefined, "confirmée : plus proposée");
  assert.equal(maj.propositions.etat, undefined, "écartée : plus proposée");
  assert.equal(A.valeur(maj, "pourquoi").origine, "confirme");
});

test("le bandeau de conversation et « Rattacher à… »", () => {
  const b = A.bandeau(interface_, T0);
  assert.equal(b.chemin, "Assistant › Fonctionnalité › Interface");
  assert.equal(b.href, "#/projets/dossier/d-interface");
  assert.equal(b.pourquoi.age, "hier");
  assert.equal(b.point.origine, "deduit");
  assert.equal(A.hrefNoeud("motion:p 1"), "#/projets/motion/p%201");
  assert.deepEqual(A.choixRattacher([boutique, interface_], "fonctionnalite").map((x) => x.noeud), ["dossier:d-interface"], "accents ignorés, tout le chemin compte");
  assert.equal(A.choixRattacher([boutique, interface_], "").length, 2);
});

test("le verrou : l'écran dit ce qu'il protège ET ce qu'il ne protège pas, et ne simule rien sans mot de passe", () => {
  assert.match(A.phraseVerrou({ disponible: true, verrouille: true, dureeMin: 10 }), /^Verrouillé\. .*10 minutes/);
  assert.equal(A.phraseVerrou({ disponible: true, verrouille: false, jusqua: T0 + 8 * 60_000 - 1 }, T0), "Déverrouillé encore 8 min.");
  assert.match(A.phraseVerrou({ disponible: false, raison: "Aucun mot de passe : il n'y a pas de verrou." }), /pas de verrou/);
  const non = A.NE_PROTEGE_PAS.join(" ");
  assert.match(non, /pas chiffrée au repos/);
  assert.match(non, /iPhone/);
  assert.match(A.PROTEGE.join(" "), /vérifie à chaque demande/);
  // La vue verrouillée ne lit rien d'autre que la route protégée : pas de copie de la mémoire ailleurs.
  const projets = lire("vues/projets.js");
  const vue = projets.slice(projets.indexOf("async function detailCompris"), projets.indexOf("function dessinerCompris"));
  assert.match(vue, /api\("\/api\/compris"/);
  assert.match(vue, /statut === 423/);
  assert.doesNotMatch(lire("vues/arbre.js"), /localStorage|sessionStorage/, "rien du verrou dans le navigateur (le cookie est HttpOnly)");
  // Réglages › Mémoire passe par le même verrou.
  assert.match(lire("vues/reglages.js"), /statut === 423\) \{\r?\n\s+const c = carteVerrou/);
});

test("tour d'avant (clé absente) : rien ne change", () => {
  const projets = lire("vues/projets.js");
  assert.match(projets, /if \(!sait\("arbre-v1"\)\) return;/);
  assert.match(projets, /sait\("verrou-v1"\) && ok\("Ce que Rémy a compris"\)/);
  assert.match(lire("vues/remy.js"), /sait\("arbre-v1"\) && !c\.origine \? \{ libelle: "Rattacher à…"/);
  assert.ok(lire("../sw.js").includes('"/app/analyse/arbre.js", "/app/vues/arbre.js"'));
});
