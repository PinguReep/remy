// « Ce que Rémy a compris » (lib/proposition-priorites.js) : une proposition
// de classement calculée sans IA, chaque candidat avec ses indices lisibles.
// Garanti ici : le temps planifié, les échéances fermes, les tâches ouvertes,
// l'activité dans Rémy et ce que Sam a écrit pèsent ; ce qui est écarté ou
// déjà classé n'est pas reproposé ; une source qui casse n'enlève que ses
// indices ; on peut ajouter une source. Données fictives.
process.env.TZ = "Europe/Paris";
process.env.REMY_TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

console.warn = () => {};
process.env.REMY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "remy-proposition-"));
const P = await import("../lib/proposition-priorites.js");

const H = 3600_000;
const J = 24 * H;
const MAINTENANT = Date.parse("2026-11-12T09:47:00Z");
const tache = (id, projetId, projet, extra = {}) => ({ id, titre: id, projetId, projet, duree: 60, debut: null, fin: null, echeance: null, priorite: "MEDIUM", ...extra });

const contexte = () => ({
  maintenant: MAINTENANT,
  projets: [{ id: "p1", nom: "Boutiques" }, { id: "p2", nom: "Album « Été »" }, { id: "p4", nom: "Musique" }, { id: "p5", nom: "Vieux projet" }],
  taches: [
    // Boutiques : 4 h planifiées, une échéance ferme dans 2 jours, 4 tâches.
    tache("t1", "p1", "Boutiques", { debut: MAINTENANT + 2 * H, duree: 120, echeance: MAINTENANT + 2 * J, deadlineType: "HARD" }),
    tache("t2", "p1", "Boutiques", { debut: MAINTENANT + J, duree: 90 }),
    tache("t3", "p1", "Boutiques", { debut: MAINTENANT + 3 * J, duree: 30 }),
    tache("t4", "p1", "Boutiques"),
    // Album : une seule tâche placée dans 20 jours (hors horizon), en retard sur une autre.
    tache("t5", "p2", "Album « Été »", { debut: MAINTENANT + 20 * J, duree: 240 }),
    tache("t6", "p2", "Album « Été »", { echeance: MAINTENANT - 3 * J }),
    // Musique : 45 min ce soir.
    tache("t7", "p4", "Musique", { debut: MAINTENANT + 10 * H, duree: 45 }),
    // Sans projet : ne fait pas de candidat.
    tache("t8", null, null, { debut: MAINTENANT + H }),
  ],
  dossiers: [
    { id: "d-demo", nom: "Démo client", parent: "motion:p1", dernier: MAINTENANT - 2 * J, ouvertes: 0 },
    { id: "d-sous", nom: "Visuels", parent: "d-demo", dernier: MAINTENANT - 9 * J, ouvertes: 3 },
    { id: "d-album", nom: "Photos", parent: null, projetMotion: "p2", dernier: MAINTENANT - 30 * J, ouvertes: 0 },
  ],
  coches: [{ a: MAINTENANT - J, projet: "Musique" }],
  declarees: [
    { id: "p-musique", titre: "La musique", mots: ["musique", "guitare"] },
    { id: "p-proches", titre: "Voir Léa et Hugo" },
  ],
});

test("les candidats, classés par leurs indices, chacun avec des indices lisibles", () => {
  const { candidats, sources, limites } = P.proposerClassement(contexte());
  assert.deepEqual(candidats.map((c) => c.cle), ["motion:p1", "motion:p4", "declaree:p-proches", "motion:p2"]);
  const [boutiques, musique, proches, album] = candidats;
  assert.deepEqual(boutiques.indices.map((i) => i.texte), [
    "4 h planifiées sur les 14 prochains jours",
    "Échéance ferme sam. 14 nov.",
    "4 tâches ouvertes",
    "Avancé dans Rémy il y a 2 jours",
    "3 idées ouvertes dans ses dossiers",
  ]);
  assert.equal(boutiques.projetMotion, "p1");
  assert.equal(boutiques.titre, "Boutiques");
  // Les mots de Sam l'emportent sur le nom du projet ; « ressemble » est dit comme tel.
  assert.equal(musique.titre, "La musique");
  assert.equal(musique.declaree.id, "p-musique");
  assert.equal(musique.indices[0].texte, "Tu as écrit « La musique », qui ressemble à ce projet");
  assert.ok(musique.indices.some((i) => i.texte === "Avancé dans Rémy hier"), "une tâche cochée depuis Rémy");
  assert.equal(proches.projetMotion, null);
  assert.deepEqual(proches.indices.map((i) => i.texte), ["Tu l'as écrite toi-même, sans projet Motion"]);
  assert.deepEqual(album.indices.map((i) => i.texte), ["1 tâche en retard", "2 tâches ouvertes", "Rien dans Rémy depuis 30 jours"], "planifiée dans 20 jours : hors des 14");
  assert.ok(!candidats.some((c) => c.cle === "motion:p5"), "un projet vide, sans trace, n'est pas une piste");
  assert.deepEqual(sources.map((s) => s.id), ["declarees", "motion", "carnet"]);
  assert.match(limites, /Claude Code ou T3/);
  assert.ok(candidats.every((c) => c.indices.every((i) => !("points" in i))), "les poids restent sur la tour");
});

test("une priorité reliée par identifiant renforce son projet ; l'écarté et le déjà classé ne reviennent pas", () => {
  const ctx = contexte();
  ctx.declarees = [{ id: "p-album", titre: "Finir l'album", projetMotion: "p2", projetNom: "Album « Été »" }];
  let { candidats } = P.proposerClassement(ctx);
  const album = candidats.find((c) => c.cle === "motion:p2");
  assert.equal(album.titre, "Finir l'album");
  assert.equal(album.indices[0].texte, "Tu l'as écrite toi-même : « Finir l'album »");
  ({ candidats } = P.proposerClassement({ ...ctx, ecartees: ["motion:p1"] }));
  assert.ok(!candidats.some((c) => c.cle === "motion:p1"), "« pas une priorité »");
  ({ candidats } = P.proposerClassement({ ...ctx, classees: { priorites: ["p-album"], projets: ["p4"] } }));
  assert.ok(!candidats.some((c) => c.cle === "motion:p2"), "déjà dans le classement (par la priorité)");
  assert.ok(!candidats.some((c) => c.cle === "motion:p4"), "déjà dans le classement (par le projet)");
});

test("sans Motion, sans rien : une proposition vide, pas une erreur", () => {
  assert.deepEqual(P.proposerClassement({ maintenant: MAINTENANT }).candidats, []);
  const seul = P.proposerClassement({ maintenant: MAINTENANT, declarees: [{ id: "p-x", titre: "Courir" }] });
  assert.deepEqual(seul.candidats.map((c) => c.titre), ["Courir"]);
});

test("les sources sont une liste : une source qui casse n'enlève que ses indices, une nouvelle s'ajoute", () => {
  const casse = { id: "casse", nom: "En panne", indices: () => { throw new Error("illisible"); } };
  const t3 = { id: "t3", nom: "Fils T3 Code", indices: () => [{ cle: "motion:p2", indices: [{ source: "t3", texte: "Un fil T3 t'attend sur ce projet", points: 30 }] }] };
  const { candidats, sources } = P.proposerClassement(contexte(), [...P.SOURCES_INDICES, casse, t3]);
  assert.equal(candidats[0].cle, "motion:p2", "la nouvelle source pèse");
  assert.equal(candidats[0].indices.at(-1).texte, "Un fil T3 t'attend sur ce projet");
  assert.deepEqual(sources.map((s) => s.id), ["declarees", "motion", "carnet", "casse", "t3"]);
});
