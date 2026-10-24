// Le cerveau relié à la vie (nuit du 24/10) : les priorités déclarées de Sam
// (versionnées, jamais écrasées, « négligée depuis N jours » calculé sans IA),
// le conseil et la nuit qui les reçoivent sans rien inventer, et les outils du
// carnet — « ajoute du lait » va dans Courses, « rappelle-moi… » devient un
// rappel — proposés par un faux modèle, validés par Sam.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

// Un faux modèle local (format OpenAI) : chaque tour = une liste d'événements SSE,
// ou une réponse complète pour complete().
let script = [];
const recus = [];
const glm = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "GLM-test" }] }));
    }
    const b = JSON.parse(corps || "{}");
    recus.push(b);
    const tour = script.shift() || [];
    if (!b.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(tour));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const e of tour) res.write(`data: ${JSON.stringify(e)}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => glm.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-cerveau-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "ANTHROPIC_API_KEY"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${glm.address().port}/v1`;
process.env.REMY_CONSEIL_AUTO_MS = "0";

const priorites = await import("../lib/priorites.js");
const conseil = await import("../lib/conseil.js");
const store = await import("../lib/store.js");
const carnet = await import("../lib/carnet.js");
const { glmProvider, _executerOutil, _outilsClient, actionCarnet } = await import("../lib/providers.js");
const { contenuPourModele } = await import("../lib/chat.js");
const { routeApi } = await import("../lib/routes.js");
const { db, fermer } = await import("../lib/db.js");
const { appliquer } = await import("../lib/ecriture.js");
const instantanes = await import("../lib/instantanes.js");

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => {
  remy.close();
  glm.close();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});
const envoyer = async (m, chemin, corps) => {
  const r = await fetch(base + chemin, { method: m, headers: { "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json() };
};
const JOUR = 86_400_000;
const delta = (d, fin = null) => ({ choices: [{ index: 0, delta: d, finish_reason: fin }] });

// --- Priorités déclarées ------------------------------------------------------------

test("priorités : 5 au plus, propres, et chaque enregistrement ajoute une version (jamais écrasée)", async () => {
  assert.match(priorites.nettoyerPriorites(Array.from({ length: 6 }, (_, k) => ({ titre: `P${k}` }))).erreur, /5 priorités au plus/);
  const { priorites: propres } = priorites.nettoyerPriorites([{ titre: "  Musique ", pourquoi: "Ça me tient debout" }, { titre: "musique" }, { titre: "" }]);
  assert.equal(propres.length, 1, "doublon et vide retirés");

  let r = await envoyer("GET", "/api/priorites");
  assert.equal(r.statut, 200);
  assert.equal(r.corps.version, 0);
  assert.deepEqual(r.corps.priorites, []);

  r = await envoyer("PUT", "/api/priorites", {
    base: 0,
    priorites: [
      { id: "p-musique", titre: "Musique", pourquoi: "Jouer me rend plus calme toute la semaine", mots: ["musique", "guitare", "répétition"] },
      { id: "p-bougies", titre: "La boutique de bougies", pourquoi: "C'est mon revenu de l'an prochain" },
      { id: "p-proches", titre: "Voir Léa et Hugo", pourquoi: "Je les vois trop peu" },
    ],
  });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.version, 1);
  assert.equal(r.corps.priorites.length, 3);
  assert.ok(r.corps.priorites[0].declareeA, "date de déclaration");

  // Un autre appareil enregistre depuis la version 0, périmée : refus, rien d'écrasé.
  r = await envoyer("PUT", "/api/priorites", { base: 0, priorites: [{ titre: "Autre chose" }] });
  assert.equal(r.statut, 409);
  assert.match(r.corps.message, /recharge/);
  assert.equal(priorites.lirePriorites().priorites.length, 3);

  // Sans base : refus aussi (on ne devine pas ce que l'appareil avait sous les yeux).
  assert.equal((await envoyer("PUT", "/api/priorites", { priorites: [] })).statut, 409);

  r = await envoyer("PUT", "/api/priorites", { base: 1, priorites: [...priorites.lirePriorites().priorites.slice(0, 2), { titre: "Dormir avant minuit", pourquoi: "Le reste en dépend" }] });
  assert.equal(r.corps.version, 2);
  assert.deepEqual(r.corps.historique.map((h) => h.version), [2, 1], "les deux versions restent");
  assert.ok(r.corps.historique[1].titres.includes("Voir Léa et Hugo"), "l'ancienne version garde ses titres");
  // La première déclaration date toujours une priorité gardée.
  const musique = r.corps.priorites.find((p) => p.id === "p-musique");
  assert.ok(musique.declareeA <= r.corps.majA);

  // Même liste renvoyée : pas de version vide de sens.
  const meme = priorites.enregistrerPriorites(priorites.lirePriorites().priorites, { base: 2 });
  assert.equal(meme.inchange, true);
  assert.equal(meme.version, 2);
});

test("négligée depuis N jours : la dernière trace qui reprend ses mots, sinon depuis sa déclaration", () => {
  const maintenant = Date.parse("2026-10-24T08:00:00Z");
  const p = [
    { id: "a", titre: "Musique", mots: ["musique", "guitare"], declareeA: maintenant - 40 * JOUR },
    { id: "b", titre: "La boutique de bougies", declareeA: maintenant - 40 * JOUR },
    { id: "c", titre: "Voir Léa et Hugo", declareeA: maintenant - 3 * JOUR },
    { id: "d", titre: "Dormir avant minuit", declareeA: maintenant - 20 * JOUR },
  ];
  const traces = [
    { a: maintenant - 2 * JOUR, texte: "Commander les mèches des bougies", quoi: "tâche" },
    { a: maintenant - 12 * JOUR, texte: "Changer les cordes de la guitare", quoi: "rappel fait" },
  ];
  const n = priorites.negligence(p, traces, { maintenant });
  assert.equal(n[0].joursSans, 12);
  assert.equal(n[0].neglige, true);
  assert.match(n[0].constat, /rien depuis 12 jours.*rappel fait « Changer les cordes de la guitare »/);
  assert.equal(n[1].neglige, false, "« bougies » tiré du titre, trace d'avant-hier");
  assert.equal(n[1].derniereActivite.quoi, "tâche");
  assert.equal(n[2].neglige, false, "déclarée il y a 3 jours : pas encore négligée");
  assert.equal(n[3].joursSans, 20);
  assert.match(n[3].constat, /aucune trace depuis qu'elle est déclarée, il y a 20 jours/);
  assert.deepEqual(priorites.motsDe({ titre: "Finir le projet de bougies" }), ["bougies"], "les mots vides ne reconnaissent rien");
  assert.equal(priorites.reconnait(["boutique"], "Stratégie de lancement — boutiques en ligne"), true, "au pluriel près");
  assert.equal(priorites.reconnait(["Léa"], "Déjeuner avec lea"), true, "sans accents ni casse");
  assert.equal(priorites.reconnait(["bougie"], "Bougeoir ancien"), false, "mot entier");
});

test("les traces viennent de la tour : écriture validée, rappel fait, titre de conversation", async () => {
  const maintenant = Date.now();
  // Des priorités déclarées il y a 40 jours (on vieillit les versions enregistrées).
  const v = instantanes.lire("priorites").valeur;
  instantanes.ecrire("priorites", { versions: v.versions.map((x) => ({ ...x, a: x.a - 40 * JOUR })) });
  db()
    .prepare("INSERT INTO journal (id, ts, source, origine, resume, etat, actions, maj_a) VALUES (?, ?, 'motion', 'tap', ?, 'appliquee', ?, ?)")
    .run("j-bougies", maintenant - 1 * JOUR, "Terminer", JSON.stringify([{ type: "terminer", nom: "Photos des bougies pour la boutique" }]), maintenant);
  await store.putConversation({ id: "c-guitare", title: "Choisir une guitare", messages: [], createdAt: maintenant - 30 * JOUR, updatedAt: maintenant - 9 * JOUR });
  priorites._viderCache();
  const ctx = await priorites.contextePriorites({ maintenant });
  const parTitre = Object.fromEntries(ctx.priorites.map((p) => [p.titre, p]));
  assert.equal(parTitre["La boutique de bougies"].negligeeDepuisJours, undefined, "photo des bougies hier : rien de négligé");
  assert.equal(parTitre.Musique.negligeeDepuisJours, 9, "conversation sur la guitare il y a 9 jours");
  assert.match(parTitre.Musique.constat, /conversation « Choisir une guitare »/);

  const texte = priorites.textePriorites(ctx);
  assert.match(texte, /Priorités déclarées par .+ version 2/);
  assert.match(texte, /- Musique — pourquoi : « Jouer me rend plus calme toute la semaine » — NÉGLIGÉE : rien depuis 9 jours/);
  assert.doesNotMatch(texte, /bougies » — NÉGLIGÉE/);

  // Le détail de l'écran Priorités : jours sans activité et constat.
  const r = await envoyer("GET", "/api/priorites");
  const m = r.corps.priorites.find((p) => p.titre === "Musique");
  assert.equal(m.neglige, true);
  assert.equal(m.joursSans, 9);
});

test("le conseil reçoit les priorités ; une priorité citée qui n'existe pas est retirée", async () => {
  const ctx = await priorites.contextePriorites();
  const s = conseil.situation({ items: [], aFaire: [] }, { maintenant: Date.now(), priorites: ctx });
  assert.deepEqual(s.priorites.map((p) => p.titre), ["Musique", "La boutique de bougies", "Dormir avant minuit"]);
  assert.equal(s.priorites[0].negligeeDepuisJours, 9);
  assert.equal(conseil.situation({ items: [] }, {}).priorites, undefined, "sans priorités, la situation ne change pas");

  const titres = ctx.priorites.map((p) => p.titre);
  const juste = conseil.lireReponse(
    JSON.stringify({ conseil: "Trente minutes de guitare avant le dîner.", pourquoi: ["Tu as dit que la musique te rend plus calme", "Rien depuis 9 jours"], tache: null, priorite: "musique" }),
    { priorites: titres },
  );
  assert.equal(juste.priorite, "Musique", "titre exact rendu");
  assert.equal(juste.pourquoi.length, 2);
  const invente = conseil.lireReponse(
    JSON.stringify({ conseil: "Va courir.", pourquoi: ["Le sport est ta priorité", "Il fait beau"], tache: null, priorite: "Le sport" }),
    { priorites: titres },
  );
  assert.equal(invente.priorite, null);
  assert.deepEqual(invente.pourquoi, ["Il fait beau"], "le pourquoi qui citait la priorité inventée part avec");

  // Bout à bout : la situation envoyée à GLM porte les priorités.
  script = [{ choices: [{ message: { content: JSON.stringify({ conseil: "Joue vingt minutes.", pourquoi: ["Tu as dit que la musique compte"], tache: null, priorite: "Musique" }) }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 5 } }];
  const avant = recus.length;
  await conseil.conseilPour("libre", { items: [], aFaire: [] });
  for (let k = 0; k < 50 && recus.length === avant; k++) await new Promise((r) => setTimeout(r, 20));
  const envoye = recus.at(-1).messages.map((m) => m.content).join("\n");
  assert.match(envoye, /"priorites":\[\{"titre":"Musique","pourquoi":"Jouer me rend plus calme toute la semaine","negligeeDepuisJours":9\}/);
  assert.match(recus.at(-1).messages[0].content, /ne force jamais le lien/);
  let rendu = null;
  for (let k = 0; k < 50 && !rendu; k++) {
    rendu = (await conseil.conseilPour("libre", { items: [], aFaire: [] }, { relancer: false })).conseil;
    if (!rendu) await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(rendu?.priorite, "Musique", "l'app reçoit la priorité servie");
});

test("la réflexion de nuit reçoit les priorités et ce qui est négligé (modèle local)", async () => {
  const { runReflection } = await import("../lib/reflection.js");
  script = [{ choices: [{ message: { content: "- La musique n'a pas bougé depuis 9 jours : vingt minutes demain ?" }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 12 } }];
  const avant = recus.length;
  const r = await runReflection();
  assert.equal(r.ok, true, JSON.stringify(r));
  const envoye = recus.slice(avant).find((b) => !b.stream);
  const texte = envoye.messages.map((m) => m.content).join("\n");
  assert.match(texte, /Priorités déclarées par .+ version 2/);
  assert.match(texte, /- Musique — pourquoi : « Jouer me rend plus calme toute la semaine » — NÉGLIGÉE : rien depuis 9 jours/);
  assert.match(texte, /N'en relève qu'une par nuit/);
});

// --- Outils du carnet ----------------------------------------------------------------

test("outils du carnet : toujours offerts (sans Motion), jamais pour une question seule", () => {
  const noms = (o) => _outilsClient(false, o).map((t) => t.name);
  assert.ok(noms({}).includes("liste_ajouter"));
  assert.ok(noms({}).includes("rappel_creer"));
  assert.equal(noms({}).includes("motion_proposer"), false, "Motion absent : pas d'outil Motion, le carnet reste");
  assert.equal(noms({ lectureMotion: false }).includes("liste_ajouter"), false);
  process.env.REMY_OUTILS_CARNET = "off";
  try {
    assert.equal(noms({}).includes("rappel_creer"), false, "coupables");
  } finally {
    delete process.env.REMY_OUTILS_CARNET;
  }
});

test("le modèle propose, le code borne : articles nettoyés, heure passée ou illisible refusée", async () => {
  const maintenant = Date.parse("2026-10-24T08:00:00Z");
  assert.deepEqual(actionCarnet("liste_ajouter", { articles: [" lait ", "Lait", "", "café"] }, maintenant).action, { type: "liste", liste: "Courses", articles: ["lait", "café"] });
  assert.deepEqual(actionCarnet("liste_ajouter", { articles: "œufs, beurre" }, maintenant).action.articles, ["œufs", "beurre"]);
  assert.match(actionCarnet("liste_ajouter", { articles: [] }, maintenant).erreur, /Aucun article/);
  assert.equal(actionCarnet("rappel_creer", { texte: "Appeler Léa", quand: "2026-10-25T09:00:00+02:00" }, maintenant).action.quand, "2026-10-25T07:00:00.000Z");
  assert.equal(actionCarnet("rappel_creer", { texte: "Appeler Léa" }, maintenant).action.quand, undefined, "sans heure : un rappel sans date");
  assert.match(actionCarnet("rappel_creer", { texte: "x", quand: "2026-10-20T09:00:00+02:00" }, maintenant).erreur, /déjà passée/);
  assert.match(actionCarnet("rappel_creer", { texte: "x", quand: "demain" }, maintenant).erreur, /illisible/);
  assert.match(actionCarnet("rappel_creer", { texte: " " }, maintenant).erreur, /vide/);

  // Une proposition Motion déjà affichée dans la même réponse : le carnet attend.
  const r = await _executerOutil("liste_ajouter", { articles: ["lait"] }, () => {}, { proposition: "motion" });
  assert.match(r.erreur, /n'en valide qu'une à la fois/);
});

test("faux modèle : « ajoute du lait et rappelle-moi d'appeler Léa demain à 9 h » → UNE carte carnet, rien d'écrit", async () => {
  const demain9h = new Date(Date.now() + JOUR);
  demain9h.setUTCHours(7, 0, 0, 0);
  const liste = JSON.stringify({ resume: "Lait aux courses", articles: ["lait"] });
  const rappel = JSON.stringify({ texte: "Appeler Léa", quand: demain9h.toISOString() });
  script = [
    [
      delta({ content: "Je te propose ça." }),
      delta({ tool_calls: [{ index: 0, id: "c1", function: { name: "liste_ajouter", arguments: liste } }] }),
      delta({ tool_calls: [{ index: 1, id: "c2", function: { name: "rappel_creer", arguments: rappel } }] }, "tool_calls"),
    ],
    [delta({ content: "Valide d'un tap." }, "stop")],
  ];
  const signaux = [];
  const r = await glmProvider.stream({
    system: "sys",
    messages: [{ role: "user", content: "ajoute du lait et rappelle-moi d'appeler Léa demain à 9 h" }],
    onText: () => {},
    onTool: (i) => i.type === "carnet" && signaux.push(i),
  });
  assert.equal(r.text, "Je te propose ça.\n\nValide d'un tap.");
  assert.equal(signaux.length, 2);
  assert.deepEqual(signaux[0].actions, [{ type: "liste", liste: "Courses", articles: ["lait"] }]);
  assert.deepEqual(signaux[1].actions, [{ type: "rappel", texte: "Appeler Léa", quand: demain9h.toISOString() }]);
  // Les outils sont bien présentés au modèle, et le modèle relit « affiché, pas fait ».
  const premier = recus.at(-2);
  assert.ok(premier.tools.some((t) => t.function?.name === "liste_ajouter"));
  const outils = recus.at(-1).messages.filter((m) => m.role === "tool");
  assert.equal(outils.length, 2);
  assert.match(outils[0].content, /Ne prétends PAS que c'est fait/);
  assert.equal(carnet.lireListes().length, 0, "le modèle n'a rien écrit");
  assert.equal(carnet.lireRappels().length, 0);
});

test("Sam valide : les articles vont dans SA liste Courses, le rappel est daté ; un second oui ne double rien", async () => {
  // La liste « Courses » créée sur l'iPhone (identifiant de l'iPhone) : c'est elle qui reçoit.
  carnet.ecrireListe("liste-iphone-1", { nom: "courses" });
  carnet.ecrireElements("liste-iphone-1", [{ id: "e-pain", texte: "pain" }]);
  const quand = new Date(Date.now() + JOUR).toISOString();
  const proposal = {
    id: "p-carnet",
    source: "carnet",
    resume: "Lait aux courses",
    actions: [
      { type: "liste", liste: "Courses", articles: ["lait", "œufs"] },
      { type: "rappel", texte: "Appeler Léa", quand },
      { type: "liste", liste: "Bricolage", articles: ["vis de 4"] },
    ],
    statut: "en_attente",
  };
  await store.putConversation({ id: "c-carnet", title: "Courses", createdAt: Date.now(), updatedAt: Date.now(), messages: [
    { role: "user", content: "ajoute du lait et des œufs" },
    { role: "assistant", content: "Je te propose ça.", proposal },
  ] });

  // Pas par le chemin Motion (une app d'avant qui l'afficherait en carte Motion) : la source est vérifiée.
  await assert.rejects(appliquer({ source: "motion", convId: "c-carnet", propositionId: "p-carnet" }), /concerne le carnet, pas Motion/);

  const ok = await envoyer("POST", "/api/conversations/c-carnet/propositions/p-carnet/carnet");
  assert.equal(ok.statut, 200);
  assert.equal(ok.corps.statut, "applique");
  assert.equal(ok.corps.bilan.faits.length, 3);
  assert.match(ok.corps.bilan.faits[0], /2 articles dans « courses »/);
  const listes = carnet.lireListes();
  const courses = listes.find((l) => l.id === "liste-iphone-1");
  assert.deepEqual(courses.elements.map((e) => e.texte), ["pain", "lait", "œufs"]);
  assert.equal(listes.filter((l) => l.nom.toLowerCase() === "courses").length, 1, "pas de seconde liste Courses");
  assert.ok(listes.some((l) => l.nom === "Bricolage" && l.elements[0].texte === "vis de 4"), "liste absente : créée");
  const rappels = carnet.lireRappels();
  assert.equal(rappels.length, 1);
  assert.equal(rappels[0].texte, "Appeler Léa");
  assert.equal(rappels[0].quand, Date.parse(quand));

  const encore = await envoyer("POST", "/api/conversations/c-carnet/propositions/p-carnet/carnet");
  assert.equal(encore.corps.rejoue, true);
  assert.equal(carnet.lireListes().find((l) => l.id === "liste-iphone-1").elements.length, 3);
  assert.equal(carnet.lireRappels().length, 1);

  // Ce que Rémy relit ensuite : c'est fait, ne pas reproposer.
  const conv = await envoyer("GET", "/api/conversations/c-carnet");
  const relu = contenuPourModele(conv.corps.messages[1]);
  assert.match(relu, /CARNET — .+ a validé : c'est dans son carnet/);
  // Déjà validée : « Non merci » n'a plus de sens.
  assert.equal((await envoyer("POST", "/api/conversations/c-carnet/propositions/p-carnet/refus")).statut, 409);
});

test("« Non merci » sur le carnet : enregistré, et un oui ensuite n'écrit rien", async () => {
  await store.putConversation({ id: "c-refus", title: "x", createdAt: Date.now(), updatedAt: Date.now(), messages: [
    { role: "assistant", content: "…", proposal: { id: "p-refus", source: "carnet", actions: [{ type: "liste", liste: "Courses", articles: ["chips"] }], statut: "en_attente" } },
  ] });
  assert.equal((await envoyer("POST", "/api/conversations/c-refus/propositions/p-refus/refus")).statut, 200);
  const oui = await envoyer("POST", "/api/conversations/c-refus/propositions/p-refus/carnet");
  assert.equal(oui.statut, 409);
  assert.ok(!carnet.lireListes().some((l) => l.elements.some((e) => e.texte === "chips")));
  assert.equal((await envoyer("POST", "/api/conversations/c-refus/propositions/inconnue/carnet")).statut, 404);
});

// --- Propositions en attente (notifications Oui / Plus tard) ----------------------------

test("en attente : les propositions des règles (pas les périmées ni les tranchées) et les sujets de plus pour la nuit", async () => {
  const futur = new Date(Date.now() + 2 * JOUR).toISOString();
  const passe = new Date(Date.now() - JOUR).toISOString();
  await store.putConversation({ id: "c-regles", title: "Règles de Rémy", systeme: "regles", createdAt: Date.now(), updatedAt: Date.now(), messages: [
    { role: "assistant", content: "…", proposal: { id: "p-futur", source: "motion", actions: [{ type: "creer", nom: "Rasage", echeance: futur, description: "Règle « Rasage avant une sortie » : avant « Soirée chez Léo » (samedi 25 19:00)." }], statut: "en_attente" } },
    { role: "assistant", content: "…", proposal: { id: "p-passe", source: "motion", actions: [{ type: "creer", nom: "Rasage", echeance: passe }], statut: "en_attente" } },
    { role: "assistant", content: "…", proposal: { id: "p-refusee", source: "motion", actions: [{ type: "creer", nom: "Valise", echeance: futur }], statut: "en_attente" } },
  ] });
  await envoyer("POST", "/api/conversations/c-regles/propositions/p-refusee/refus");
  await store.putReflectionSuggestions({ principal: { sujet: "Prépare la semaine", pourquoi: "…" }, options: [{ sujet: "Compare deux fournisseurs de cire", pourquoi: "Tu hésites depuis lundi" }] });
  await store.putReflectionFocus("Prépare la semaine");

  const r = await envoyer("GET", "/api/propositions/attente");
  assert.equal(r.statut, 200);
  const ids = r.corps.propositions.map((p) => p.id);
  assert.ok(ids.includes("p-futur"));
  assert.ok(!ids.includes("p-passe"), "périmée");
  assert.ok(!ids.includes("p-refusee"), "tranchée");
  assert.ok(!ids.includes("p-carnet"), "le chat n'envoie pas de notification : la carte est sous ses yeux");
  const regle = r.corps.propositions.find((p) => p.id === "p-futur");
  assert.equal(regle.origine, "regles");
  assert.equal(regle.convId, "c-regles");
  assert.equal(regle.texte, "« Rasage » avant « Soirée chez Léo » (samedi 25 19:00)");
  const nuit = r.corps.propositions.find((p) => p.origine === "nuit");
  assert.equal(nuit.sujet, "Compare deux fournisseurs de cire");

  // « Oui » au sujet de plus : ajouté à la consigne de la nuit, une seule fois.
  const oui = await envoyer("POST", "/api/propositions/nuit", { sujet: nuit.sujet });
  assert.equal(oui.statut, 200);
  assert.equal(oui.corps.focus.text, "Prépare la semaine\nAussi : Compare deux fournisseurs de cire");
  assert.equal((await envoyer("POST", "/api/propositions/nuit", { sujet: nuit.sujet })).corps.deja, true);
  assert.equal((await envoyer("POST", "/api/propositions/nuit", { sujet: "Écris à toute la famille" })).statut, 404, "seulement un sujet proposé par Rémy");
  const apres = await envoyer("GET", "/api/propositions/attente");
  assert.ok(!apres.corps.propositions.some((p) => p.origine === "nuit"), "accepté : il ne revient plus");
});

test("la tour annonce ce qu'elle sait faire", async () => {
  const { CAPACITES } = await import("../lib/version.js");
  for (const c of ["priorites-v1", "carnet-outils-v1", "propositions-attente-v1"]) assert.ok(CAPACITES.includes(c), c);
});
