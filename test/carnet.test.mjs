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
