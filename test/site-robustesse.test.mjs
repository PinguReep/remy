// La contre-relecture du site (29/10) : ce qui doit tenir quand la tour,
// Motion, la session ou Windows ne répondent pas comme prévu.
// - natureEchec : le port de NatureEchec (EnvoiCaptures.swift), cas par cas ;
// - la file d'envoi : un 502 (Rémy arrêté derrière Tailscale) ou un 503 ne
//   rend pas une capture « refusée » : elle repart seule au retour ;
// - flux : coupé après 180 s de SILENCE, pas après 5 min de réponse ;
// - le pont Windows : une clé n'est « dite » qu'une fois Windows l'a prise,
//   le briefing raté est retenté, la session perdue se dit une fois par jour,
//   un refus de la coquille garde son explication ;
// - les phrases portées de l'iPhone : Motion.phrase, Privee.swift,
//   Format.echeanceLongue, Carnet.duJour.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";

// Un localStorage en mémoire (le site le lit à l'appel, jamais à l'import).
const magasin = new Map();
globalThis.localStorage = {
  getItem: (k) => (magasin.has(k) ? magasin.get(k) : null),
  setItem: (k, v) => magasin.set(k, String(v)),
  removeItem: (k) => magasin.delete(k),
  clear: () => magasin.clear(),
};

const { natureEchec, arretDerriereLeRelais, flux, sonder, api, tourJoignable } = await import("../public/app/api.js");
const fileEnvoi = await import("../public/app/file-envoi.js");
const { creerTic, cleSession, REESSAI_RITUEL, invoke } = await import("../public/app/bureau.js");
const { phraseMotion, motionFrais } = await import("../public/app/analyse/motion.js");
const { etatRecherchePrivee, ceQueCaChange, sousTitrePrivee, confirmationPrivee, CE_QUI_SORT } = await import("../public/app/analyse/privee.js");
const { echeanceLongue, avantEcheance } = await import("../public/app/analyse/dates.js");
const { rappelsDuJour } = await import("../public/app/vues/rappels.js");

const M = 60e3;
const date = (j, m, h, mi = 0, an = 2026) => new Date(an, m - 1, j, h, mi, 0, 0);

// --- Une fausse tour : une file de réponses par chemin ---
const vraiFetch = globalThis.fetch;
function fausseTour(reponses) {
  const recues = [];
  globalThis.fetch = async (url, init = {}) => {
    const chemin = String(url);
    recues.push(`${init.method || "GET"} ${chemin}`);
    const file = reponses[chemin];
    const r = Array.isArray(file) ? (file.length > 1 ? file.shift() : file[0]) : file;
    if (!r || r === "coupe") throw new TypeError("Failed to fetch");
    const corps = typeof r.corps === "string" ? r.corps : r.corps === undefined ? "" : JSON.stringify(r.corps);
    return new Response(corps, { status: r.statut || 200, headers: { "Content-Type": typeof r.corps === "string" ? "text/plain" : "application/json" } });
  };
  return recues;
}
test.after(() => {
  globalThis.fetch = vraiFetch;
});

// --- NatureEchec (EnvoiCaptures.swift) ---
test("natureEchec : incertain, passager, refus — les cas de l'iPhone", () => {
  const e = (nature, statut = 0) => ({ nature, statut });
  assert.equal(natureEchec(e("reseau")), "incertain", "réseau coupé : la tour l'a peut-être écrite");
  assert.equal(natureEchec(e("delai")), "incertain");
  assert.equal(natureEchec(e("illisible", 200)), "incertain");
  for (const c of [500, 504]) assert.equal(natureEchec(e("serveur", c)), "incertain", String(c));
  for (const c of [408, 425, 429, 502, 503]) assert.equal(natureEchec(e("serveur", c)), "passager", String(c));
  for (const c of [400, 404, 409, 422]) assert.equal(natureEchec(e("serveur", c)), "refus", String(c));
  assert.equal(natureEchec(e("auth", 401)), "auth", "session perdue : on attend la reconnexion");
  assert.equal(natureEchec(null), "refus");
});

test("un 502 sans JSON vient du relais (Rémy arrêté) ; un 502 de Rémy, non", () => {
  assert.equal(arretDerriereLeRelais(502, null), true);
  assert.equal(arretDerriereLeRelais(504, null), true);
  assert.equal(arretDerriereLeRelais(502, { error: "capture", message: "Rémy n'a pas pu garder ce texte — réessaie." }), false);
  assert.equal(arretDerriereLeRelais(503, null), false);
  assert.equal(arretDerriereLeRelais(500, null), false);
});

test("sonder : un 502 ou un 503 veut dire que la tour ne répond pas", async () => {
  fausseTour({ "/api/health": { statut: 502, corps: "Bad Gateway" } });
  assert.equal(await sonder(1000), false);
  assert.equal(tourJoignable(), false, "le bandeau « La tour ne répond pas » peut s'afficher");
  fausseTour({ "/api/health": { statut: 503, corps: { error: "base_illisible" } } });
  assert.equal(await sonder(1000), false);
  fausseTour({ "/api/health": { statut: 200, corps: { ok: true } } });
  assert.equal(await sonder(1000), true);
  assert.equal(tourJoignable(), true);
});

// --- La file d'envoi (preuve-file-502 de la contre-relecture) ---
const rappel = (id) => ({ id, resume: `Rappel ${id}`, genre: "rappel", requetes: [{ chemin: "/api/rappels", corps: { rappels: [{ id, texte: "Arroser les plantes", quand: null }] } }] });

test("file d'envoi : un 502 du relais garde la capture, qui part seule au retour de la tour", async () => {
  magasin.clear();
  fausseTour({ "/api/rappels": "coupe" });
  fileEnvoi.ajouter(rappel("r-502"));
  await fileEnvoi.vider();
  assert.equal(fileEnvoi.compte(), 1);
  // Rémy arrêté derrière Tailscale : 502 sans JSON.
  fausseTour({ "/api/rappels": { statut: 502, corps: "Bad Gateway" } });
  const a = await fileEnvoi.vider({ force: true });
  assert.deepEqual(a, { envoyes: [], restants: 1 });
  assert.equal(fileEnvoi.liste()[0].refus, null, "pas un refus : elle n'attend pas Sam");
  // La tour revient : la capture part sans que Sam fasse rien.
  const recues = fausseTour({ "/api/rappels": { statut: 200, corps: { ok: true } } });
  const b = await fileEnvoi.vider({ force: true });
  assert.deepEqual(b, { envoyes: ["Rappel r-502"], restants: 0 });
  assert.deepEqual(recues, ["POST /api/rappels"]);
});

test("file d'envoi : 503 et 429 sont passagers, 422 est un refus, 500 répété finit par attendre Sam", async () => {
  magasin.clear();
  fausseTour({ "/api/rappels": { statut: 503, corps: { error: "base_illisible" } } });
  fileEnvoi.ajouter(rappel("r-503"));
  await fileEnvoi.vider({ force: true });
  assert.equal(fileEnvoi.liste()[0].refus, null);
  assert.ok(fileEnvoi.liste()[0].prochain > Date.now(), "repart plus tard, avec un délai");
  // Dans l'ordre : celle d'après attend que la première passe.
  fileEnvoi.ajouter(rappel("r-suivante"));
  fausseTour({ "/api/rappels": { statut: 429, corps: { error: "trop" } } });
  await fileEnvoi.vider({ force: true });
  assert.equal(fileEnvoi.compte(), 2);
  assert.ok(fileEnvoi.liste().every((x) => x.refus == null));
  // Un vrai refus : il attend Sam (Réglages › Envoi en attente).
  magasin.clear();
  fausseTour({ "/api/rappels": { statut: 422, corps: { error: "Texte vide" } } });
  fileEnvoi.ajouter(rappel("r-422"));
  await fileEnvoi.vider({ force: true });
  assert.match(fileEnvoi.liste()[0].refus, /Texte vide/);
  // 500 : incertain, renvoyé avec le même id… mais pas indéfiniment.
  magasin.clear();
  const recues = fausseTour({ "/api/rappels": { statut: 500, corps: { error: "Erreur serveur" } } });
  fileEnvoi.ajouter(rappel("r-500"));
  for (let i = 0; i < fileEnvoi.ESSAIS_INCERTAINS - 1; i++) {
    await fileEnvoi.vider({ force: true });
    assert.equal(fileEnvoi.liste()[0].refus, null, `essai ${i + 1}`);
  }
  await fileEnvoi.vider({ force: true });
  assert.match(fileEnvoi.liste()[0].refus, /Erreur serveur/, "au 6e essai, elle attend Sam");
  assert.equal(recues.length, fileEnvoi.ESSAIS_INCERTAINS);
});

test("file d'envoi : une session perdue n'est pas un refus", async () => {
  magasin.clear();
  fausseTour({ "/api/rappels": { statut: 401, corps: { error: "unauthorized" } } });
  fileEnvoi.ajouter(rappel("r-401"));
  await fileEnvoi.vider({ force: true });
  assert.equal(fileEnvoi.liste()[0].refus, null);
  assert.equal(fileEnvoi.liste()[0].tentatives, 0, "elle attend la reconnexion, sans compter d'essai");
});

// --- Le flux des réponses de Rémy (preuve-flux de la contre-relecture) ---
function fluxBavard({ toutesLesMs, pendantMs, pauseApres = null, pauseMs = 0 }) {
  // Comme un vrai fetch : l'arrêt (signal) fait échouer la lecture du corps.
  return async (_url, init = {}) => {
    const enc = new TextEncoder();
    let i = 0;
    const debut = Date.now();
    const corps = new ReadableStream({
      start(ctrl) {
        init.signal?.addEventListener("abort", () => ctrl.error(new DOMException("Arrêté", "AbortError")), { once: true });
      },
      async pull(ctrl) {
        if (init.signal?.aborted) return;
        if (Date.now() - debut >= pendantMs) {
          ctrl.enqueue(enc.encode(`event: done\ndata: {"text":"fini"}\n\n`));
          ctrl.close();
          return;
        }
        await new Promise((r) => setTimeout(r, pauseApres != null && i === pauseApres ? pauseMs : toutesLesMs));
        if (init.signal?.aborted) return;
        ctrl.enqueue(enc.encode(`event: delta\ndata: {"text":"${i++} "}\n\n`));
      },
    });
    return new Response(corps, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
}

test("flux : une réponse qui arrive encore n'est pas coupée (inactivité, pas durée totale)", async () => {
  globalThis.fetch = fluxBavard({ toutesLesMs: 30, pendantMs: 500 });
  const recus = [];
  await flux("/api/conversations/c1/messages", {}, (nom, d) => recus.push(nom), { inactivite: 200, plafond: 5000 });
  assert.ok(recus.length > 5, `reçus : ${recus.length}`);
  assert.equal(recus.at(-1), "done", "la réponse va jusqu'au bout, bien au-delà de 200 ms");
});

test("flux : un silence trop long coupe avec un message à part ; le plafond aussi", async () => {
  globalThis.fetch = fluxBavard({ toutesLesMs: 20, pendantMs: 2000, pauseApres: 3, pauseMs: 600 });
  await assert.rejects(flux("/api/x", {}, () => {}, { inactivite: 150, plafond: 5000 }),
    (err) => err.nature === "delai" && /ne dit plus rien/.test(err.message) && /continue peut-être sur la tour/.test(err.message));
  globalThis.fetch = fluxBavard({ toutesLesMs: 20, pendantMs: 2000 });
  await assert.rejects(flux("/api/x", {}, () => {}, { inactivite: 1000, plafond: 200 }),
    (err) => err.nature === "delai" && /plus de 30 min/.test(err.message));
});

test("flux : Rémy arrêté derrière le relais (502 sans JSON) se dit comme une tour qui ne répond pas", async () => {
  fausseTour({ "/api/x": { statut: 502, corps: "Bad Gateway" } });
  await assert.rejects(flux("/api/x", {}, () => {}), (err) => err.nature === "reseau" && err.statut === 502);
  fausseTour({ "/api/x": { statut: 502, corps: { error: "Compactage impossible." } } });
  await assert.rejects(flux("/api/x", {}, () => {}), (err) => err.nature === "serveur" && err.statut === 502 && /Compactage/.test(err.message));
});

test("api : un 502 du relais est une tour injoignable, pas « Erreur 502 : réessaie »", async () => {
  fausseTour({ "/api/dashboard": { statut: 502, corps: "" } });
  await assert.rejects(api("/api/dashboard"), (err) => err.nature === "reseau" && /Rémy n'y répond pas/.test(err.message));
});

// --- Le pont Windows : la boucle d'une minute (preuves-notifs de la contre-relecture) ---
function banc({ maintenant, reglages = {}, rappels = [], rituel = { aujourdhui: { compte: "3 choses", resume: "dont une menacée" } } }) {
  const horloge = { t: maintenant };
  const dites = new Set();
  const notifs = [];
  const lectures = [];
  const comportement = { notif: [], lire: {} };
  const tic = creerTic({
    horloge: () => horloge.t,
    reglages: () => ({ rappels: true, briefing: false, bilan: false, heureBriefing: "07:30", heureBilan: "21:30", ...reglages }),
    memoire: { deja: () => new Set(dites), noter: (cles) => cles.forEach((c) => dites.add(c)) },
    lire: async (chemin) => {
      lectures.push(chemin);
      const f = comportement.lire[chemin]?.shift();
      if (f) throw f;
      return chemin === "/api/rappels" ? { rappels } : rituel;
    },
    notif: async (titre, corps, cle) => {
      const refus = comportement.notif.shift();
      if (refus) throw new Error(refus);
      notifs.push({ titre, corps, cle });
    },
  });
  return { tic, horloge, dites, notifs, lectures, comportement };
}

test("une notification refusée par la coquille n'est pas marquée : elle repart la minute suivante, une seule fois", async () => {
  const t0 = date(29, 10, 9, 45).getTime();
  const b = banc({ maintenant: t0, rappels: [{ id: "r4", texte: "Payer le loyer", quand: t0 - 5 * M }] });
  b.comportement.notif.push("Trop de notifications en une minute");
  await b.tic();
  assert.equal(b.notifs.length, 0);
  assert.equal(b.dites.size, 0, "refusée : rien n'est marqué");
  b.horloge.t += 60e3;
  await b.tic();
  assert.deepEqual(b.notifs.map((n) => n.titre), ["Payer le loyer"]);
  b.horloge.t += 60e3;
  await b.tic();
  assert.equal(b.notifs.length, 1, "une seule fois");
});

test("le briefing raté (tour pas encore là au réveil) est retenté toutes les 5 min, et dit une fois", async () => {
  const t0 = date(29, 10, 7, 35).getTime();
  const b = banc({ maintenant: t0, reglages: { rappels: false, briefing: true } });
  b.comportement.lire["/api/rituel"] = [Object.assign(new Error("La tour ne répond pas."), { nature: "reseau" })];
  await b.tic();
  assert.equal(b.notifs.length, 0);
  assert.equal(b.dites.size, 0, "pas marqué avant d'avoir été dit");
  b.horloge.t += 60e3;
  await b.tic();
  assert.equal(b.lectures.filter((c) => c === "/api/rituel").length, 1, "pas de nouvel essai avant 5 min");
  b.horloge.t = t0 + REESSAI_RITUEL;
  await b.tic();
  assert.deepEqual(b.notifs.map((n) => n.titre), ["Briefing du matin"]);
  assert.match(b.notifs[0].corps, /3 choses dont une menacée/);
  b.horloge.t += 10 * 60e3;
  await b.tic();
  assert.equal(b.notifs.length, 1, "dit une fois");
  // Une notification de rituel refusée par Windows repart aussi.
  const c = banc({ maintenant: t0, reglages: { rappels: false, briefing: true } });
  c.comportement.notif.push("Windows a refusé");
  await c.tic();
  c.horloge.t += REESSAI_RITUEL;
  await c.tic();
  assert.equal(c.notifs.length, 1);
});

test("session perdue : une notification par jour, et rien d'autre ne casse", async () => {
  const t0 = date(29, 10, 9, 0).getTime();
  const b = banc({ maintenant: t0 });
  const auth = () => Object.assign(new Error("Ta session a expiré : reconnecte-toi."), { nature: "auth", statut: 401 });
  b.comportement.lire["/api/rappels"] = [auth(), auth(), auth()];
  await b.tic();
  assert.deepEqual(b.notifs.map((n) => n.titre), ["Rémy est déconnecté"]);
  assert.equal(b.notifs[0].cle, cleSession(t0));
  assert.match(b.notifs[0].corps, /reconnecter/);
  b.horloge.t += 60e3;
  await b.tic();
  assert.equal(b.notifs.length, 1, "pas deux fois le même jour");
  b.horloge.t = date(30, 10, 9, 0).getTime();
  await b.tic();
  assert.equal(b.notifs.length, 2, "le lendemain, encore une");
});

test("un refus de la coquille (une chaîne, le Err(String) de Rust) garde son explication", async () => {
  globalThis.window = { __TAURI__: { core: { invoke: () => Promise.reject("Windows a refusé de changer le démarrage automatique : accès refusé.") } } };
  await assert.rejects(invoke("bureau_regler", { demarrage: true }), (err) => err instanceof Error && err.nature === "bureau" && err.message.startsWith("Windows a refusé"));
  globalThis.window = { __TAURI__: { core: { invoke: () => { throw new Error("synchrone"); } } } };
  await assert.rejects(invoke("bureau_etat"), (err) => err.message === "synchrone");
  delete globalThis.window;
  await assert.rejects(invoke("bureau_etat"), (err) => err.nature === "bureau");
});

// --- Motion.phrase (Models.swift) ---
test("Motion : la phrase de l'accueil, comme l'iPhone ; « À jour. » seulement si c'est vrai", () => {
  const t = date(29, 10, 8, 41).getTime();
  const il = (min) => t - min * M;
  assert.equal(phraseMotion({ etat: "reseau", luA: il(4) }, t), "Tâches Motion lues il y a 4 min : la tour ne joint pas Motion (réseau).");
  assert.equal(phraseMotion({ etat: "panne", luA: il(75) }, t), "Tâches Motion lues il y a 1 h 15 : Motion ne répond pas pour l'instant.");
  assert.equal(phraseMotion({ etat: "panne" }, t), "Motion ne répond pas pour l'instant.");
  assert.equal(phraseMotion({ etat: "quota", luA: t - 20e3 }, t), "Tâches Motion lues à l'instant : Motion limite les requêtes, mise à jour dès que possible.");
  assert.equal(phraseMotion({ etat: "auth" }, t), "Motion refuse la clé de la tour : vérifie MOTION_API_KEY dans remy.env.");
  assert.equal(phraseMotion({ etat: "attente" }, t), "Première lecture de Motion en cours…");
  assert.equal(phraseMotion({ etat: "menage", luA: il(2) }, t), null, "moins de 3 min : rien à dire");
  assert.equal(phraseMotion({ etat: "menage", luA: il(5) }, t), "Tâches Motion lues il y a 5 min : Rémy garde le quota Motion pour tes gestes, mise à jour dans un instant.");
  assert.equal(phraseMotion({ etat: "ok", luA: il(9) }, t), null, "une liste fraîche ne mérite pas de bandeau");
  assert.equal(phraseMotion({ etat: "ok", luA: il(12) }, t), "Tâches Motion lues il y a 12 min.");
  assert.equal(phraseMotion({ etat: "maj", luA: il(60) }, t), "Tâches Motion lues il y a 1 h, mise à jour en cours.");
  assert.equal(phraseMotion({ etat: "off" }, t), null);
  assert.equal(phraseMotion(null, t), null);
  assert.equal(motionFrais({ etat: "ok" }), true);
  assert.equal(motionFrais({ etat: "maj" }), true);
  assert.equal(motionFrais({ etat: "reseau", raison: "Motion injoignable" }), false, "le cache n'est pas « À jour. »");
  assert.equal(motionFrais({ etat: "quota" }), false);
});

// --- Conversation privée (PriveeTests.swift) ---
const R = (json) => JSON.parse(json);
test("conversation privée : l'état suit la tour (testLEtatDeLaRecherchePriveeEtSaRaison)", () => {
  assert.equal(etatRecherchePrivee(R(`{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":true,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true}`)), "permise");
  assert.equal(etatRecherchePrivee(R(`{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":false,"recherchePriveeVerrouillee":false,"salleBlanche":true}`)), "coupee");
  assert.equal(etatRecherchePrivee(R(`{"secoursCloud":false,"rechercheWeb":false,"rechercheLocale":"duckduckgo","recherchePrivee":true,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true}`)), "webCoupee");
  assert.equal(etatRecherchePrivee(R(`{"secoursCloud":false,"rechercheWeb":true,"rechercheWebCoupeeParLaTour":true,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true}`)), "webCoupee");
  assert.equal(etatRecherchePrivee(R(`{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":true,"salleBlanche":true}`)), "verrouillee");
  assert.equal(etatRecherchePrivee(R(`{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":null,"recherchePrivee":false,"recherchePriveeReglage":false,"recherchePriveeVerrouillee":false,"salleBlanche":true}`)), "verrouillee");
  assert.equal(etatRecherchePrivee(null), "inconnu");
  assert.equal(etatRecherchePrivee({ rechercheWeb: true }, { capacite: false }), "sansReglage", "tour sans le réglage : elle ne cherche pas");
});

test("conversation privée : ce que ça change, dit en clair (testCeQueCaChangeSeDitEnClair)", () => {
  const coupe = ceQueCaChange("coupee");
  assert.ok(coupe.startsWith("Rien ne part chez Claude ni ailleurs"));
  assert.ok(coupe.includes("Pas de recherche web (Réglages › Recherche dans les conversations privées pour la permettre)"));
  const permise = ceQueCaChange("permise");
  assert.ok(permise.startsWith("Rien ne part chez Claude :"));
  assert.ok(!permise.includes("ni ailleurs"), "la recherche permise : pas de promesse de trop");
  assert.ok(!permise.includes("seule la question"));
  assert.ok(permise.includes("questions générales, écrites par Rémy puis par la salle blanche"));
  assert.ok(permise.includes("les pages trouvées sont lues depuis ta tour"));
  assert.ok(permise.includes("le filtre bloque noms, numéros et mots de cette conversation"));
  assert.ok(!permise.includes("Pas de recherche web"));
  assert.ok(!ceQueCaChange("inconnu").includes("ni ailleurs"), "pas encore lu : pas de promesse");
  for (const etat of ["sansReglage", "verrouillee"]) {
    assert.ok(!ceQueCaChange(etat).includes("Réglages"), `${etat} : l'interrupteur est caché ou grisé`);
    assert.ok(ceQueCaChange(etat).includes("ni ailleurs"), etat);
  }
  assert.ok(ceQueCaChange("webCoupee").includes("Réglages › Recherche web"));
  assert.ok(!ceQueCaChange("webCoupee").includes("Recherche dans les conversations privées"));
  assert.ok(coupe.endsWith("Si le modèle local est éteint, Rémy ne répond pas : rien ne bascule vers Claude."));
  assert.ok(confirmationPrivee("coupee").startsWith("C'est sans retour"), "l'irréversible se dit avant de confirmer");
  assert.ok(confirmationPrivee("permise").includes(CE_QUI_SORT));
  assert.equal(sousTitrePrivee("permise"), "Rien ne part chez Claude");
  assert.equal(sousTitrePrivee("coupee"), "Rien ne part chez Claude ni ailleurs");
});

// --- Format.echeanceLongue (CarnetTests.swift) et « avant ce soir » ---
test("échéance longue, comme l'iPhone ; le jour même : « avant ce soir »", () => {
  const maintenant = date(15, 10, 10, 40);
  assert.equal(echeanceLongue(date(31, 8, 23, 0, 2027), date(1, 11, 10)), "mardi 31 août 2027");
  assert.equal(echeanceLongue(date(30, 10, 23), maintenant), "vendredi 30 octobre", "cette année : pas d'année");
  assert.equal(echeanceLongue(date(1, 1, 23, 0, 2027), date(31, 12, 10)), "vendredi 1 janvier 2027");
  assert.equal(echeanceLongue(date(30, 10, 14), maintenant), "vendredi 30 octobre, 14:00", "une heure de journée se dit");
  // « Relire le devis avant vendredi », un jeudi : l'échéance est jeudi 23 h.
  const jeudi = date(29, 10, 8, 30);
  assert.equal(avantEcheance(date(29, 10, 23), jeudi), "avant ce soir", "plus de « d'ici aujourd'hui »");
  assert.equal(avantEcheance(date(29, 10, 14), jeudi), "avant 14:00");
  assert.equal(avantEcheance(date(30, 10, 23), jeudi), "avant l'échéance : vendredi 30 octobre");
});

// --- Carnet.duJour : les rappels du jour d'Aujourd'hui ---
test("rappels du jour : pas faits, dus avant minuit (retards compris), triés", () => {
  const m = date(29, 10, 9, 0).getTime();
  const l = rappelsDuJour([
    { id: "a", texte: "Arroser les plantes", quand: date(29, 10, 19).getTime() },
    { id: "b", texte: "Payer le loyer", quand: date(29, 10, 6, 49).getTime() },
    { id: "c", texte: "Vieux rappel", quand: date(27, 10, 9).getTime() },
    { id: "d", texte: "Demain", quand: date(30, 10, 9).getTime() },
    { id: "e", texte: "Fait", quand: date(29, 10, 8).getTime(), fait: true },
    { id: "f", texte: "Sans date" },
  ], m);
  assert.deepEqual(l.map((r) => r.id), ["c", "b", "a"]);
});
