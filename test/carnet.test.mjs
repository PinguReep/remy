// Carnet (Lot 1, J1.5) : listes, rappels, tâche bloquée. Base SQLite dans un
// dossier temporaire ; aucune donnée réelle.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const racine = fs.mkdtempSync(path.join(os.tmpdir(), "remy-carnet-"));
for (const v of ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "REMY_DATA_DIR", "MOTION_API_KEY", "VERCEL"]) delete process.env[v];
process.env.REMY_VAULT = path.join(racine, "coffre");
const dbm = await import("../lib/db.js");
const c = await import("../lib/carnet.js");
test.after(() => {
  dbm.fermer();
  fs.rmSync(racine, { recursive: true, force: true });
});

test("une liste et ses articles ; rejouer la même écriture ne double rien", () => {
  c.ecrireListe("L1", { nom: "Courses", ordre: 0 });
  c.ecrireElements("L1", [{ id: "e1", texte: "tomates" }, { id: "e2", texte: " lait  " }, { id: "e3", texte: "œufs" }]);
  c.ecrireElements("L1", [{ id: "e1", texte: "tomates" }]); // renvoyé après une coupure
  const [l] = c.lireListes();
  assert.equal(l.nom, "Courses");
  assert.deepEqual(l.elements.map((e) => e.texte), ["tomates", "lait", "œufs"], "dans l'ordre noté");
});

test("cocher, supprimer puis annuler (réécrire fait revenir)", () => {
  const avant = c.lireListes()[0].elements.map((e) => e.id);
  c.ecrireElements("L1", [{ id: "e2", texte: "lait", fait: true }]);
  assert.equal(c.lireListes()[0].elements.find((e) => e.id === "e2").fait, true);
  assert.deepEqual(c.lireListes()[0].elements.map((e) => e.id), avant, "cocher ne déplace pas l'article");
  c.supprimerElement("L1", "e3");
  assert.ok(!c.lireListes()[0].elements.some((e) => e.id === "e3"));
  c.ecrireElements("L1", [{ id: "e3", texte: "œufs" }]);
  assert.ok(c.lireListes()[0].elements.some((e) => e.id === "e3"));
  c.supprimerListe("L1");
  assert.equal(c.lireListes().length, 0);
  assert.throws(() => c.ecrireElements("L1", [{ id: "e9", texte: "pain" }]), /n'existe plus/);
  c.ecrireListe("L1", { nom: "Courses" });
  assert.equal(c.lireListes()[0].elements.length, 3, "la liste revient avec ses articles");
});

test("entrées refusées proprement", () => {
  assert.throws(() => c.ecrireListe("a b", { nom: "x" }), /liste invalide/);
  assert.throws(() => c.ecrireListe("L2", { nom: "   " }), /nom de liste vide/);
  assert.throws(() => c.ecrireElements("L1", []), /Aucun article/);
});

test("rappels : datés d'abord, import Apple rejouable", () => {
  const demain = Date.now() + 86_400_000;
  c.ecrireRappels([{ id: "r1", texte: "Appeler le garage", quand: demain }, { id: "r2", texte: "Idée cadeau" }]);
  c.ecrireRappels([{ id: "apple:x1", texte: "Payer la cantine", quand: demain - 3600_000, source: "apple" }]);
  c.ecrireRappels([{ id: "apple:x1", texte: "Payer la cantine", quand: demain - 3600_000, source: "apple" }]);
  const r = c.lireRappels();
  assert.deepEqual(r.map((x) => x.id), ["apple:x1", "r1", "r2"]);
  assert.equal(r[0].source, "apple");
  assert.equal(r[2].quand, null);
  c.ecrireRappels([{ id: "r1", texte: "Appeler le garage", quand: demain, fait: true }]);
  assert.equal(c.lireRappels().at(-1).id, "r1", "un rappel fait passe en dernier");
  c.supprimerRappel("r2");
  assert.ok(!c.lireRappels().some((x) => x.id === "r2"));
});

// Ce qui déclenche un rappel en plus de sa date (rappels-declencheurs-v1) :
// une note, des alertes avant l'échéance, un lieu (arrivée ou départ).
test("rappel : note, alertes et lieu gardés ; clé absente = inchangé, clé présente = remplacé", () => {
  const jeudi = Date.now() + 3 * 86_400_000;
  const boulangerie = { id: "l-boul", nom: "  Boulangerie  du coin ", lat: 48.8566, lon: 2.3522, rayon: 30, sens: "arrivee" };
  c.ecrireRappels([{
    id: "d1", texte: "Rendez-vous chez le dentiste", quand: jeudi,
    note: "  Apporter la   carte vitale\net la radio ",
    alertes: [{ type: "veille", minutes: 1200 }, { type: "matin", minutes: 480 }, { type: "avant", minutes: 120 }, { type: "avant", minutes: 120 }],
    lieu: null,
  }]);
  c.ecrireRappels([{ id: "d2", texte: "Acheter du pain", lieu: boulangerie }]);
  const lire = (id) => c.lireRappels().find((r) => r.id === id);
  assert.equal(lire("d1").note, "Apporter la carte vitale\net la radio", "espaces réduits, retours gardés");
  assert.deepEqual(lire("d1").alertes, [{ type: "veille", minutes: 1200 }, { type: "matin", minutes: 480 }, { type: "avant", minutes: 120 }], "le doublon est écarté");
  assert.equal(lire("d1").lieu, null);
  assert.deepEqual(lire("d2").lieu, { id: "l-boul", nom: "Boulangerie du coin", lat: 48.8566, lon: 2.3522, rayon: 100, sens: "arrivee" }, "rayon d'au moins 100 m (iOS)");
  assert.deepEqual(lire("d2").alertes, []);
  assert.equal(lire("d2").note, null);

  // Une app d'avant (ou le site) réécrit le rappel sans ces clés : rien ne se perd.
  c.ecrireRappels([{ id: "d1", texte: "Rendez-vous chez le dentiste", quand: jeudi + 3600_000, fait: false, etiquettes: [] }]);
  c.ecrireRappels([{ id: "d2", texte: "Acheter du pain", fait: true }]);
  assert.equal(lire("d1").quand, jeudi + 3600_000);
  assert.equal(lire("d1").alertes.length, 3);
  assert.match(lire("d1").note, /carte vitale/);
  assert.equal(lire("d2").lieu.sens, "arrivee");

  // Clés présentes : remplacé, ou retiré.
  c.ecrireRappels([{ id: "d1", texte: "Rendez-vous chez le dentiste", quand: jeudi, note: "", alertes: [], lieu: { ...boulangerie, sens: "depart", rayon: 9000 } }]);
  assert.equal(lire("d1").note, null);
  assert.deepEqual(lire("d1").alertes, []);
  assert.equal(lire("d1").lieu.sens, "depart");
  assert.equal(lire("d1").lieu.rayon, 2000);
  c.ecrireRappels([{ id: "d1", texte: "Rendez-vous chez le dentiste", quand: jeudi, lieu: null }]);
  assert.equal(lire("d1").lieu, null);

  // Refusé proprement, rien d'écrit à moitié.
  assert.throws(() => c.ecrireRappels([{ id: "d3", texte: "x", alertes: [{ type: "lundi", minutes: 10 }] }]), /alerte invalide/);
  assert.throws(() => c.ecrireRappels([{ id: "d3", texte: "x", alertes: [{ type: "veille", minutes: 1440 }] }]), /alerte invalide/);
  assert.throws(() => c.ecrireRappels([{ id: "d3", texte: "x", alertes: [{ type: "avant", minutes: 0 }] }]), /alerte invalide/);
  assert.throws(() => c.ecrireRappels([{ id: "d3", texte: "x", lieu: { nom: "Ici", lat: 91, lon: 0, sens: "arrivee" } }]), /lieu invalide/);
  assert.throws(() => c.ecrireRappels([{ id: "d3", texte: "x", lieu: { nom: "Ici", lat: 1, lon: 1, sens: "passage" } }]), /lieu invalide/);
  assert.ok(!c.lireRappels().some((r) => r.id === "d3"));
  for (const id of ["d1", "d2"]) c.supprimerRappel(id);
});

test("rappel redit avec un lieu : l'existant le prend, sans rien écraser", () => {
  const gare = { nom: "Gare", lat: 45.76, lon: 4.86, rayon: 200, sens: "depart" };
  c.ecrireRappels([{ id: "g1", texte: "Composter le billet" }]);
  const r = c.ecrireRappels([{ id: "g2", texte: "composter le billet !", lieu: gare, note: "Voie B", alertes: [{ type: "avant", minutes: 30 }] }]);
  assert.deepEqual(r.dejaLa.map((d) => d.existant), ["g1"]);
  const g1 = c.lireRappels().find((x) => x.id === "g1");
  assert.equal(g1.lieu.nom, "Gare");
  assert.equal(g1.note, "Voie B");
  assert.deepEqual(g1.alertes, [{ type: "avant", minutes: 30 }]);
  // Redit encore, avec un autre lieu : celui déjà posé reste.
  c.ecrireRappels([{ id: "g3", texte: "Composter le billet", lieu: { ...gare, nom: "Aéroport" } }]);
  assert.equal(c.lireRappels().find((x) => x.id === "g1").lieu.nom, "Gare");
  c.supprimerRappel("g1");
});

test("tâche bloquée : posée sur la journée, levée ensuite", () => {
  c.marquerTache("t7", { bloquee: true, raison: "J'attends le devis" });
  const j = c.avecEtats({ items: [{ type: "tache", id: "t7", titre: "A" }, { type: "rdv", id: "t7", titre: "RDV" }], aFaire: [{ id: "t8" }], retard: { total: 0, items: [] } });
  assert.equal(j.items[0].bloquee, true);
  assert.equal(j.items[0].raison, "J'attends le devis");
  assert.equal(j.items[1].bloquee, undefined, "un rendez-vous n'est jamais « bloqué »");
  c.marquerTache("t7", { bloquee: false });
  assert.equal(c.etatsTaches().size, 0);
});

test("commencer maintenant : la tâche devient l'élément en cours, pour sa durée, et sort de « à faire »", () => {
  const maintenant = Date.now();
  const debut = maintenant - 5 * 60_000;
  c.marquerTache("a9", { commencee: debut });
  const j = c.avecEtats(
    {
      items: [{ type: "rdv", id: "e1", titre: "Déjeuner", debut: maintenant + 3600_000, fin: maintenant + 7200_000 }],
      aFaire: [{ id: "a9", titre: "Relancer le comptable", duree: 20 }, { id: "a10", titre: "Autre" }],
      retard: { total: 0, items: [] },
    },
    c.etatsTaches(),
    maintenant,
  );
  assert.equal(j.items[0].id, "a9", "en tête : elle a commencé avant le déjeuner");
  assert.equal(j.items[0].debut, debut, "l'heure du geste, pas celle de l'envoi");
  assert.equal(j.items[0].fin, debut + 20 * 60_000);
  assert.equal(j.items[0].commencee, true);
  assert.deepEqual(j.aFaire.map((t) => t.id), ["a10"]);
  // Un renvoi du même geste ne décale rien ; « arrêter » l'annule.
  c.marquerTache("a9", { commencee: debut });
  assert.equal(c.etatsTaches().get("a9").commenceeA, debut);
  c.marquerTache("a9", { commencee: false });
  assert.equal(c.etatsTaches().has("a9"), false);
});

test("une activité de l'agenda se marque faite (rdv:<id>), sans toucher à l'agenda", () => {
  c.marquerTache("rdv:e5", { fait: true });
  const j = c.avecEtats({ items: [{ type: "rdv", id: "e5", titre: "Aspirateur", debut: 1, fin: 2 }], aFaire: [], retard: null });
  assert.equal(j.items[0].fait, true);
  // « Bloquée » et « faite » sont indépendants : changer l'un garde l'autre.
  c.marquerTache("rdv:e5", { bloquee: false });
  assert.equal(c.etatsTaches().get("rdv:e5").faitA > 0, true);
  c.marquerTache("rdv:e5", { fait: false });
  assert.equal(c.etatsTaches().has("rdv:e5"), false);
});
