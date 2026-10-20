// Les règles de Rémy (19/10) : « avant une sortie, me raser ». Motion ne sait
// pas faire de tâches conditionnelles ; Rémy les PROPOSE avant l'événement.
// Une règle est validée par Sam, une tâche aussi ; aucun appel IA.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-regles-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_GLM_URL"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;

const regles = await import("../lib/regles.js");
const store = await import("../lib/store.js");
const { _executerOutil } = await import("../lib/providers.js");
const { routeApi } = await import("../lib/routes.js");
const { fermer } = await import("../lib/db.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); fermer(); fs.rmSync(dossier, { recursive: true, force: true }); });
const envoyer = (m, chemin, corps) => fetch(base + chemin, { method: m, headers: { "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined });

const RASAGE = { nom: "Rasage avant une sortie", mots_cles: ["sortie", "soirée", "resto"], tache: { nom: "Rasage", duree: "15" }, avant_minutes: "180" };

test("une règle se lit, se borne et reconnaît ses événements (mots entiers, sans accents)", () => {
  const { regle } = regles.nettoyerRegle(RASAGE);
  assert.deepEqual(regle, { nom: "Rasage avant une sortie", mots: ["sortie", "soirée", "resto"], tache: { nom: "Rasage", duree: 15, priorite: "MEDIUM" }, avantMin: 180 });
  assert.equal(regles.correspond(regle.mots, "SOIREE chez Léo"), true);
  assert.equal(regles.correspond(regle.mots, "Resto avec Hugo"), true);
  assert.equal(regles.correspond(regle.mots, "Restauration du parquet"), false, "mot entier");
  assert.equal(regles.resumeRegle(regle), "Avant un événement « sortie », « soirée », « resto » : « Rasage » (15 min), au plus tard 3 h avant.");
  assert.equal(regles.delaiLisible(1440), "au plus tard la veille");
  assert.match(regles.nettoyerRegle({ tache: { nom: "x" } }).erreur, /au moins un mot/);
  assert.equal(regles.nettoyerRegle({ ...RASAGE, avant_minutes: "999999", tache: { nom: "R", duree: "9000", priorite: "PIRE" } }).regle.avantMin, 10080, "borné à 7 jours");
});

test("Rémy PROPOSE la règle (rien n'est créé) ; Sam la valide, une seule fois", async () => {
  const vus = [];
  const r = await _executerOutil("regle_proposer", RASAGE, (i) => vus.push(i), {});
  assert.equal(r.statut, "proposition_affichee");
  assert.equal(regles.listerRegles().length, 0, "rien n'est créé par le modèle");
  const action = vus[0].actions[0];
  assert.equal(action.type, "regle");
  assert.match(action.description, /au plus tard 3 h avant/);

  // La proposition telle que le chat l'enregistre sur le message.
  const conv = { id: "c-regle", title: "x", createdAt: Date.now(), updatedAt: Date.now(), messages: [
    { role: "user", content: "Avant chaque sortie, rappelle-moi de me raser." },
    { role: "assistant", content: "Je te propose cette règle.", proposal: { id: "p-regle", source: "regle", resume: "", actions: vus[0].actions, statut: "en_attente" } },
  ] };
  await store.putConversation(conv);
  const ok = await (await envoyer("POST", "/api/conversations/c-regle/propositions/p-regle/regle")).json();
  assert.equal(ok.statut, "applique", JSON.stringify(ok));
  assert.equal(ok.regles[0].tache.nom, "Rasage");
  const encore = await (await envoyer("POST", "/api/conversations/c-regle/propositions/p-regle/regle")).json();
  assert.equal(encore.rejoue, true);
  const liste = await (await fetch(`${base}/api/regles`)).json();
  assert.equal(liste.regles.length, 1, "créée une seule fois");
  // Relue, la conversation dit qu'elle est validée.
  const relue = await (await fetch(`${base}/api/conversations/c-regle`)).json();
  assert.equal(relue.messages[1].proposal.statut, "applique");
  // Une autre proposition déjà affichée dans la même réponse : refusée.
  assert.match((await _executerOutil("regle_proposer", RASAGE, () => {}, { proposition: "motion" })).erreur, /déjà affichée/);
});

test("avant chaque événement qui correspond, la tâche est proposée — une fois, et pas si elle est déjà prévue", async () => {
  const H = 3600_000;
  const maintenant = Date.parse("2026-10-20T09:00:00+02:00");
  const soiree = Date.parse("2026-10-22T20:00:00+02:00");
  const resto = Date.parse("2026-10-24T13:00:00+02:00");
  const sources = {
    agenda: [
      { id: "e1", summary: "Soirée chez Léo", start: { dateTime: new Date(soiree).toISOString() } },
      { id: "e2", summary: "Réunion budget", start: { dateTime: new Date(maintenant + 5 * H).toISOString() } },
      { id: "e3", summary: "Resto avec Hugo", start: { dateTime: new Date(resto).toISOString() } },
      { id: "e4", summary: "Sortie trop proche", start: { dateTime: new Date(maintenant + 2 * H).toISOString() } },
    ],
    motion: [{ id: "t1", name: "Rasage", dueDate: new Date(resto - 4 * H).toISOString() }],
  };
  const b = await regles.verifierRegles({ maintenant, sources });
  assert.equal(b.proposees, 1, JSON.stringify(b));
  assert.equal(b.deja, 1, "le rasage du resto est déjà dans Motion");
  const conv = await store.getConversation(b.conversation);
  assert.equal(conv.title, "Règles de Rémy");
  const p = conv.messages.at(-1).proposal;
  assert.equal(p.source, "motion", "une proposition Motion ordinaire : Sam la valide d'un tap");
  assert.equal(p.actions.length, 1);
  assert.equal(p.actions[0].nom, "Rasage");
  assert.equal(Date.parse(p.actions[0].echeance), soiree - 3 * H, "au plus tard 3 h avant");
  assert.equal(p.actions[0].duree, "15");
  assert.match(conv.messages.at(-1).content, /Soirée chez Léo/);
  // Deuxième passage : rien de neuf.
  const b2 = await regles.verifierRegles({ maintenant, sources });
  assert.equal(b2.proposees, 0);
  assert.equal((await store.getConversation(b.conversation)).messages.length, 1);
  // Le fil est reconnu comme celui de Rémy.
  assert.equal((await store.listConversations()).find((c) => c.id === b.conversation).systeme, "regles");
});

test("une règle coupée ou supprimée ne propose plus rien", async () => {
  const id = regles.listerRegles()[0].id;
  const coupee = await (await envoyer("PATCH", `/api/regles/${id}`, { actif: false })).json();
  assert.equal(coupee.regles[0].actif, false);
  const b = await regles.verifierRegles({ sources: { agenda: [{ id: "e9", summary: "Grosse soirée", start: { dateTime: new Date(Date.now() + 48 * 3600_000).toISOString() } }], motion: [] } });
  assert.equal(b.regles, 0);
  const sup = await (await envoyer("DELETE", `/api/regles/${id}`)).json();
  assert.equal(sup.regles.length, 0);
  assert.equal((await envoyer("DELETE", `/api/regles/${id}`)).status, 404);
  const v = await (await fetch(`${base}/api/version`)).json();
  assert.ok(v.capacites.includes("regles-v1"));
});
