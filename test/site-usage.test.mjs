// Ce que tu utilises vraiment (site) : le port de Usage.swift, avec les cas
// d'AllegementTests.swift ; et le comptage fait par api.js (chaque requête
// autre que GET, classée sans lire aucun contenu ; la file ne recompte pas).
import test from "node:test";
import assert from "node:assert/strict";

const magasin = new Map();
globalThis.localStorage = {
  getItem: (k) => (magasin.has(k) ? magasin.get(k) : null),
  setItem: (k, v) => magasin.set(k, String(v)),
  removeItem: (k) => magasin.delete(k),
  clear: () => magasin.clear(),
};
const U = await import("../public/app/usage.js");
const { api, flux } = await import("../public/app/api.js");
const fileEnvoi = await import("../public/app/file-envoi.js");

const maintenant = new Date(2026, 9, 29, 15, 0);
const jours = (n) => new Date(maintenant.getTime() - n * 86400e3);

test("une écriture devient un geste, sans contenu", () => {
  assert.equal(U.fonctionDe("GET", "/api/dashboard"), null, "une lecture ne compte pas");
  assert.equal(U.fonctionDe("POST", "/api/conversations/abc/messages"), "parler");
  assert.equal(U.fonctionDe("POST", "/api/motion/apply", { actions: [{ type: "terminer", id: "t1" }] }), "terminer");
  assert.equal(U.fonctionDe("POST", "/api/motion/apply", { actions: [{ type: "modifier" }] }), "gerer");
  assert.equal(U.fonctionDe("POST", "/api/motion/apply", { actions: [{ type: "creer" }], convId: "c1" }), "valider");
  assert.equal(U.fonctionDe("POST", "/api/motion/apply", { actions: [], origine: "capture" }), "capture");
  assert.equal(U.fonctionDe("POST", "/api/motion/undo"), "annuler");
  assert.equal(U.fonctionDe("PUT", "/api/listes/l1/elements/e1"), "listes");
  assert.equal(U.fonctionDe("POST", "/api/conversations/c/propositions/p/refus"), "refuser");
  assert.equal(U.fonctionDe("POST", "/api/conversations/c/propositions/p/regle"), "regles");
  assert.equal(U.fonctionDe("POST", "/api/lieux/evenements"), null, "envoyé par l'app seule");
  assert.equal(U.fonctionDe("POST", "/api/activite/ping"), null, "le signe de vie ne compte pas");
  assert.equal(U.fonctionDe("PUT", "/api/taches/t1/etiquettes"), "dossiers");
  assert.equal(U.fonctionDe("PUT", "/api/taches/t1/etat"), "gerer");
  assert.equal(U.fonctionDe("POST", "/api/capture"), "retenir");
  assert.equal(U.fonctionDe("POST", "/api/capture/analyser"), "capture");
  assert.equal(U.fonctionDe("PUT", "/api/reglages?x=1"), "reglages");
  assert.equal(U.fonctionDe("DELETE", "/api/lieux/l1"), "lieux");
  assert.equal(U.fonctionDe("POST", "/api/conversations"), null, "ouvrir un fil vide n'est pas un geste");
});

test("le résumé dit ce qui sert et ce qui ne sert pas ; 30 jours, pas plus", () => {
  magasin.clear();
  for (let i = 0; i < 6; i++) U.noter("terminer", maintenant);
  for (let i = 0; i < 3; i++) U.noter("listes", maintenant);
  U.noter("parler", maintenant);
  U.noter("remy", maintenant);
  U.noter("terminer", jours(40));
  const r = U.resume(U.totaux({ maintenant }), { depuis: U.debut() });
  assert.deepEqual(r.gestes.map((l) => l.fonction), ["terminer", "listes", "parler"]);
  assert.equal(r.gestes[0].nombre, 6, "un geste d'il y a 40 jours ne compte plus");
  assert.deepEqual(r.vues.map((l) => l.fonction), ["remy"]);
  assert.ok(r.jamais.includes("lieux"));
  assert.ok(!r.jamais.includes("terminer"));
  assert.equal(r.assez, true);
  assert.ok(r.phrase.startsWith("Surtout : cocher une tâche, listes de courses, parler à rémy."), r.phrase);
  assert.match(r.phrase, /\d+ fonctions jamais touchées\.$/);
  U.remettreAZero();
  assert.equal(U.resume(U.totaux({ maintenant })).assez, false);
  assert.equal(U.debut(), null);
});

test("peu de gestes ne concluent rien ; ouvrir l'app n'est pas un geste", () => {
  const r = U.resume({ terminer: 3, ouverture: 40 }, { depuis: null });
  assert.equal(r.assez, false);
  assert.equal(r.phrase, "Pas encore assez de gestes comptés pour le dire. Compté sur cet ordinateur, sans contenu.");
  assert.deepEqual(r.vues.map((l) => l.libelle), ["Ouvrir l'app"]);
});

test("gardé 60 jours : les plus vieux jours s'effacent", () => {
  magasin.clear();
  for (let i = 0; i < 70; i++) U.noter("rappels", jours(i));
  const brut = JSON.parse(magasin.get(U.CLE));
  assert.equal(Object.keys(brut.parJour).length, U.JOURS_GARDES);
  assert.ok(!Object.keys(brut.parJour).includes("2026-08-21"), "le plus vieux jour est parti");
  // Jamais de texte : seulement des noms de fonction et des nombres.
  for (const j of Object.values(brut.parJour)) for (const [f, n] of Object.entries(j)) assert.ok(U.libelle(f) !== f && Number.isInteger(n));
});

// --- Le comptage par api.js, contre une fausse tour ---
const vraiFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = vraiFetch; });

test("api.js compte chaque écriture une fois, jamais une lecture ni un renvoi de la file", async () => {
  magasin.clear();
  const recues = [];
  globalThis.fetch = async (url, init = {}) => {
    recues.push(`${init.method || "GET"} ${url}`);
    if (String(url) === "/api/rappels" && init.method === "POST" && JSON.parse(init.body).rappels[0].id === "r-coupe") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await api("/api/dashboard");
  await api("/api/motion/apply", { methode: "POST", corps: { actions: [{ type: "terminer", id: "t1" }], resume: "un texte qui ne doit jamais être lu" } });
  await api("/api/activite/ping", { methode: "POST", corps: {} });
  let t = U.totaux();
  assert.deepEqual(t, { terminer: 1 });
  // Une capture de « Noter » : un geste, même faite de deux requêtes.
  await fileEnvoi.envoyerElement({ requetes: [{ chemin: "/api/dossiers/idees", methode: "PUT", corps: { nom: "Idées" } }, { chemin: "/api/dossiers/idees/notes", corps: { notes: [{ id: "n1", texte: "x" }] } }] });
  t = U.totaux();
  assert.equal(t.capture, 1);
  assert.equal(t.dossiers, undefined, "les requêtes d'une capture ne comptent pas à part");
  // Un renvoi de la file (vider) ne recompte pas : le geste a été compté quand Sam l'a fait.
  fileEnvoi.ajouter({ id: "r-file", resume: "Rappel", genre: "rappel", requetes: [{ chemin: "/api/rappels", corps: { rappels: [{ id: "r-file", texte: "t" }] } }] });
  await fileEnvoi.vider({ force: true });
  assert.equal(U.totaux().rappels, undefined);
  assert.ok(recues.includes("POST /api/rappels"));
  // Le message à Rémy, en flux : « Parler à Rémy ».
  globalThis.fetch = async () => new Response("event: done\ndata: {}\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
  await flux("/api/conversations/c1/messages", { text: "bonjour" }, () => {});
  assert.equal(U.totaux().parler, 1);
});
