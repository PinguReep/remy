// Réglages › Envoi en attente (site) : ce que chaque ligne dit (où elle ira,
// où elle en est, « peut-être déjà reçue »), Renvoyer seulement à revoir,
// Retirer annulable. Les phrases de FileEnvoiVue et d'EnvoiCaptures.swift.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";

const magasin = new Map();
globalThis.localStorage = {
  getItem: (k) => (magasin.has(k) ? magasin.get(k) : null),
  setItem: (k, v) => magasin.set(k, String(v)),
  removeItem: (k) => magasin.delete(k),
  clear: () => magasin.clear(),
};
const F = await import("../public/app/file-envoi.js");

const maintenant = new Date(2026, 9, 29, 15, 0);
const ms = (j, h, mi = 0) => new Date(2026, 9, j, h, mi).getTime();
const tache = (echeance, extra = {}) => ({ id: "t1", genre: "tache", resume: "Tâche « Appeler le garage »", cree: ms(29, 10, 40), tentatives: 0, prochain: 0, refus: null,
  requetes: [{ chemin: "/api/motion/apply", corps: { actions: [{ type: "creer", nom: "Appeler le garage", ...(echeance ? { echeance } : {}) }], origine: "capture" } }], ...extra });

test("où va chaque genre (CaptureFigee.detail) : Motion, Idées, Mémoire, Projets, Liste, Rappel, Tâche cochée", () => {
  assert.deepEqual([F.decrire(tache(), maintenant).libelle, F.decrire(tache(), maintenant).detail], ["Tâche", "Motion lui trouvera un créneau"]);
  assert.equal(F.decrire(tache("2026-10-31T18:00:00+01:00"), maintenant).detail, "Motion, d'ici samedi 31 octobre, 18:00");
  assert.equal(F.decrire(tache("2026-10-27T18:00:00+01:00"), maintenant).detail, "Motion, échéance déjà passée (mardi 27 octobre, 18:00) : elle y arrivera en retard");
  assert.equal(F.decrire(tache(), maintenant).texte, "Appeler le garage");
  const idee = { genre: "idee", resume: "Idée « Une bougie »", requetes: [{ chemin: "/api/dossiers/idees", methode: "PUT", corps: { nom: "Idées" } }, { chemin: "/api/dossiers/idees/notes", corps: { notes: [{ id: "n", texte: "Une bougie au sapin" }] } }] };
  assert.deepEqual(F.decrire(idee), { genre: "idee", icone: "ampoule", libelle: "Idée", texte: "Une bougie au sapin", detail: "Idées (Projets), rien n'est planifié", ou: "dans tes Idées (Projets)" });
  const retenir = { genre: "retenir", resume: "À retenir", requetes: [{ chemin: "/api/capture", corps: { texte: "Léa préfère le thé" } }] };
  assert.deepEqual([F.decrire(retenir).libelle, F.decrire(retenir).detail, F.decrire(retenir).texte], ["Retenir", "Mémoire de Rémy", "Léa préfère le thé"]);
  const dossier = { genre: "projet", resume: "Dossier « Site »", requetes: [{ chemin: "/api/dossiers/d1", methode: "PUT", corps: { nom: "Site", parent: null } }] };
  assert.equal(F.decrire(dossier).detail, "Projets, à part");
  assert.equal(F.decrire({ ...dossier, nomParent: "Boutique" }).detail, "Projets, dans « Boutique »");
  const liste = { genre: "liste", resume: "2 articles dans « Courses »", requetes: [{ chemin: "/api/listes/l1/elements", corps: { elements: [{ texte: "lait" }, { texte: "pain" }] } }] };
  assert.deepEqual([F.decrire(liste).libelle, F.decrire(liste).texte, F.decrire(liste).detail], ["Liste", "lait, pain", "Carnet, dans « Courses »"]);
  const rappel = { genre: "rappel", resume: "Rappel « Appeler Léa »", requetes: [{ chemin: "/api/rappels", corps: { rappels: [{ texte: "Appeler Léa", quand: ms(29, 18) }] } }] };
  assert.equal(F.decrire(rappel, maintenant).detail, "Rappels, aujourd'hui 18:00");
  assert.equal(F.decrire({ genre: "terminer", resume: "« Payer le loyer »", requetes: [] }).libelle, "Tâche cochée");
});

test("où en est chaque envoi : partira, dernier essai et prochain essai, refus, peut-être déjà reçue", () => {
  const t = maintenant.getTime();
  assert.deepEqual(F.etat(tache(), t), { texte: "Partira dès que Rémy sera joignable · notée à 10:40", aRevoir: false });
  assert.equal(F.etat(tache(null, { cree: ms(28, 9) }), t).texte, "Partira dès que Rémy sera joignable · notée hier");
  assert.equal(F.etat(tache(null, { cree: ms(23, 9) }), t).texte, "Partira dès que Rémy sera joignable · notée le 23 oct.");
  assert.deepEqual(F.etat(tache(null, { raison: "Rémy ne répond pas derrière Tailscale (502)", dernierEchec: "x", prochain: ms(29, 15, 5) }), t),
    { texte: "Dernier essai : Rémy ne répond pas derrière Tailscale (502), nouvel essai seul vers 15:05 · notée à 10:40", aRevoir: false });
  assert.match(F.etat(tache(null, { raison: "la tour ne répond pas", prochain: 0 }), t).texte, /nouvel essai seul dès que possible/);
  assert.deepEqual(F.etat(tache(null, { refus: "Motion refuse ce nom." }), t), { texte: "Motion refuse ce nom.", aRevoir: true });
  assert.deepEqual(F.etat(tache(null, { refus: "Erreur 500", peutEtreRecue: true }), t), { texte: F.PEUT_ETRE_RECUE, aRevoir: true });
  assert.equal(F.PEUT_ETRE_RECUE, "Pas de réponse de Rémy pendant l'envoi : il l'a peut-être déjà reçue. Renvoie-la seulement si elle n'est pas arrivée.");
});

test("Retirer : la phrase dit si elle est peut-être déjà arrivée ; Annuler la remet à sa place", () => {
  assert.equal(F.phraseRetiree(tache()), "Retirée : « Appeler le garage » ne partira pas.");
  assert.equal(F.phraseRetiree(tache(null, { sansReponse: true })), "Retirée de la file : « Appeler le garage ». Un envoi est resté sans réponse, elle est peut-être déjà arrivée : vérifie dans Motion.");
  magasin.clear();
  F.ajouter({ id: "a", resume: "A", genre: "idee", requetes: [] });
  F.ajouter({ id: "b", resume: "B", genre: "idee", requetes: [] });
  const a = F.liste()[0];
  const place = F.retirer("a");
  assert.equal(place, 0);
  assert.deepEqual(F.liste().map((e) => e.id), ["b"]);
  assert.equal(F.remettre(a, place), true);
  assert.deepEqual(F.liste().map((e) => e.id), ["a", "b"], "à sa place (ordre de capture)");
  assert.deepEqual(F.liste()[0], a, "telle qu'elle était");
  assert.equal(F.remettre(a), true, "déjà là : rien en double");
  assert.equal(F.liste().length, 2);
});

const vraiFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = vraiFetch; });

test("un envoi sans réponse le note ; répété, il attend Sam comme « peut-être déjà reçu » ; Renvoyer ne relance que lui", async () => {
  magasin.clear();
  let statut = 500;
  const recues = [];
  globalThis.fetch = async (url, init = {}) => {
    recues.push(JSON.parse(init.body || "{}").rappels?.[0]?.id);
    if (statut === "coupe") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(statut === 200 ? { ok: true } : { error: "Erreur serveur" }), { status: statut, headers: { "Content-Type": "application/json" } });
  };
  const rappel = (id) => ({ id, resume: `Rappel « ${id} »`, genre: "rappel", requetes: [{ chemin: "/api/rappels", corps: { rappels: [{ id, texte: id }] } }] });
  F.ajouter(rappel("r1"));
  statut = "coupe";
  await F.vider({ force: true });
  assert.equal(F.liste()[0].sansReponse, true, "réseau coupé pendant l'envoi : peut-être reçu");
  assert.equal(F.liste()[0].raison, "la tour ne répond pas");
  statut = 500;
  for (let i = 0; i < F.ESSAIS_INCERTAINS; i++) await F.vider({ force: true });
  assert.ok(F.liste()[0].refus);
  assert.equal(F.liste()[0].peutEtreRecue, true);
  assert.equal(F.etat(F.liste()[0]).texte, F.PEUT_ETRE_RECUE);
  // Un autre refus attend aussi : « Renvoyer » sur r1 ne le relance pas.
  F.ajouter(rappel("r2"));
  F.liste();
  const f = F.liste().map((e) => (e.id === "r2" ? { ...e, refus: "Texte vide" } : e));
  localStorage.setItem("remy-file-envoi", JSON.stringify(f));
  statut = 200;
  recues.length = 0;
  await F.renvoyer("r1");
  assert.deepEqual(recues, ["r1"]);
  assert.deepEqual(F.liste().map((e) => e.id), ["r2"]);
  assert.equal(F.enVol(), null);
});
