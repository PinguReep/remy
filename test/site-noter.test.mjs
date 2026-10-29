// « Noter », Retenir, les cartes de proposition, Ajuster et la voix du site
// (lot noter) : les modules purs avec LES MÊMES CAS que les tests Swift de
// l'iPhone (OrganisationTests, VoixEtFileTests, ErgonomieTests), puis les
// chemins du site joués contre les vraies routes de la tour (lib/routes.js),
// avec un faux Motion et un faux Google Calendar.
// L'heure de référence est celle des tests Swift : on fixe Paris.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFauxMotion } from "./outils/faux-motion.mjs";

console.log = () => {};
console.warn = () => {};

const E = await import("../public/app/analyse/etiquettes.js");
const R = await import("../public/app/analyse/rangement.js");
const D = await import("../public/app/dictee.js");
const T = await import("../public/app/vues/retenir.js");
const N = await import("../public/app/vues/noter.js");
const { apercu } = await import("../public/app/analyse/genre.js");

const date = (j, m, h, mi = 0, an = 2026) => new Date(an, m - 1, j, h, mi, 0, 0);
const ms = (...a) => date(...a).getTime();

// --- L'étiquette devinée (EtiquetteDevinee, OrganisationTests.testEtiquetteDevinee) ---

test("étiquette devinée : les cas de l'iPhone", () => {
  const e = [{ id: "v", nom: "Voiture" }, { id: "s", nom: "Santé" }];
  assert.equal(E.etiquetteDevinee("Contrôle technique de la Twingo", e), "v");
  assert.equal(E.etiquetteDevinee("Renouveler l'ordonnance", e), "s");
  assert.equal(E.etiquetteDevinee("Payer le loyer", e), null, "« Administratif » n'existe pas chez Sam : rien");
});

test("étiquette devinée : sans casse ni accents, seulement une étiquette qui existe", () => {
  const e = [{ id: "a", nom: "ADMINISTRATIF" }, { id: "f", nom: "Famille et amis" }, { id: "p", nom: "Professionnel" }, { id: "an", nom: "Anniversaire" }, { id: "s", nom: "sante" }];
  assert.equal(E.etiquetteDevinee("Appeler le garage demain à 9h", e), null, "pas de « Voiture » chez lui");
  assert.equal(E.etiquetteDevinee("DENTISTE jeudi", e), "s", "« Santé » écrit « sante » : la même");
  assert.equal(E.etiquetteDevinee("Déclaration d'impôts", e), "a");
  assert.equal(E.etiquetteDevinee("Appeler ma sœur", e), "f");
  assert.equal(E.etiquetteDevinee("Anniv de Léa", e), "an");
  assert.equal(E.etiquetteDevinee("Préparer la réunion client", e), "p");
  assert.equal(E.etiquettePour("Rendez-vous chez le médecin", [{ id: "x", nom: "Santé", couleur: "vert" }])?.couleur, "vert", "rend l'étiquette entière");
  assert.equal(E.etiquetteDevinee("", e), null);
  assert.equal(E.etiquetteDevinee("garage", null), null, "sans étiquettes lues : rien");
});

// --- Le récapitulatif (Rangement.swift, OrganisationTests) ---

const samedi = ms(31, 10, 9);

test("récapitulatif : un rendez-vous sans heure n'est pas prêt, la contrainte l'est", () => {
  const rdv = { cle: "a", nature: "rendez-vous", titre: "Soirée chez Yanis", quand: null, heureConnue: false, question: "À quelle heure ?" };
  assert.equal(R.pret(rdv), false, "sans heure, pas de créneau inventé");
  assert.equal(R.destination(rdv, { agenda: true }), "Rendez-vous : heure manquante");
  assert.equal(R.pret({ ...rdv, quand: samedi, heureConnue: false }), false, "une date sans heure non plus");
  assert.equal(R.pret({ ...rdv, quand: samedi, heureConnue: true }), true, "l'heure posée : prêt, même avec sa question");
  const c = { cle: "b", nature: "contrainte", titre: "Dispo limitée samedi", quand: samedi, heureConnue: false };
  assert.ok(R.destination(c, { agenda: true }).endsWith("(pas de créneau bloqué)"));
  assert.equal(R.destination(c), "Rappel le sam. 31 oct. (pas de créneau bloqué)");
  assert.equal(R.pret(c), true);
  assert.equal(R.pret({ nature: "tache", titre: "x", question: "Pour quand ?" }), false, "une question en suspens : pas prêt");
});

test("récapitulatif : où va chaque élément, en mots", () => {
  assert.equal(R.destination({ nature: "tache", quand: samedi, heureConnue: false, dureeMin: 30 }), "Tâche Motion, avant le sam. 31 oct., 30 min");
  assert.equal(R.destination({ nature: "tache", quand: ms(30, 10, 14, 5), heureConnue: true, dureeMin: 90 }), "Tâche Motion, avant le ven. 30 oct. 14:05, 1 h 30");
  assert.equal(R.destination({ nature: "tache" }), "Tâche Motion");
  assert.equal(R.destination({ nature: "rappel" }), "Rappel, sans date");
  assert.equal(R.destination({ nature: "rappel", quand: ms(2, 11, 18, 30), heureConnue: true }), "Rappel le lun. 2 nov. 18:30");
  assert.equal(R.destination({ nature: "liste", liste: "Courses", articles: ["tomates", "lait"] }), "Liste « Courses » · 2 articles");
  assert.equal(R.destination({ nature: "liste", liste: null, articles: ["pain"] }), "Liste « Courses »");
  assert.equal(R.destination({ nature: "note" }), "Notes (Projets)");
  assert.equal(R.destination({ nature: "rendez-vous", quand: ms(29, 10, 20, 30), heureConnue: true, dureeMin: 120 }, { agenda: true }), "Agenda · jeu. 29 oct. 20:30, 2 h");
  assert.equal(R.destination({ nature: "rendez-vous", quand: ms(29, 10, 20, 30), heureConnue: true }, { agenda: false }), "Rappel · jeu. 29 oct. 20:30");
  assert.equal(R.destination({ nature: "projet", parent: "Boutiques" }), "Nouveau dossier dans « Boutiques »");
  assert.equal(R.destination({ nature: "projet" }), "Nouveau dossier");
});

test("récapitulatif : « Ranger » refuse tant qu'un élément coché n'est pas prêt", () => {
  const el = [{ cle: "a", nature: "rendez-vous", titre: "x", heureConnue: false, question: "?" }, { cle: "b", nature: "note", titre: "y" }];
  assert.deepEqual(R.etatRangement(el, new Set(["b"])), { choisis: [el[1]], possible: true });
  assert.equal(R.etatRangement(el, new Set(["a", "b"])).possible, false);
  assert.equal(R.etatRangement(el, new Set()).possible, false, "rien de coché");
  assert.equal(R.libelleRanger(1), "Ranger 1 élément");
  assert.equal(R.libelleRanger(4), "Ranger 4 éléments");
});

test("bilan : les phrases de BilanRangement", () => {
  assert.equal(R.phraseBilan({ faits: ["« A » (note)"] }), "Rangé : « A » (note).");
  assert.equal(R.phraseBilan({ faits: ["a", "b", "c"] }), "3 éléments rangés.");
  assert.equal(R.phraseBilan({ faits: ["a", "b"], dejaLa: ["« lait » (liste « Courses »)"] }), "2 éléments rangés ; déjà là : « lait » (liste « Courses »).");
  assert.equal(R.phraseBilan({ dejaLa: ["« X » (Motion)", "« Y » (rappels)"] }), "Rien de nouveau, déjà là : « X » (Motion) ; « Y » (rappels).");
  assert.equal(R.phraseBilan({}), "Rien à ranger.");
  assert.equal(R.phraseBilan({ echecs: ["« A » : heure manquante", "« B » : Motion ne répond pas"] }), "Rien n'a été rangé : « A » : heure manquante ; « B » : Motion ne répond pas.");
  assert.equal(R.phraseBilan({ faits: ["a"], dejaLa: ["« X » (Motion)"], echecs: ["« B » : refusé"] }), "1 rangé ; déjà là : « X » (Motion) ; pas fait : « B » : refusé.");
  assert.equal(R.phraseBilan({ dejaLa: ["« X » (Motion)"], echecs: ["« B » : refusé"] }), "Déjà là : « X » (Motion) ; pas fait : « B » : refusé.");
  assert.equal(R.phraseBilan({ faits: ["a", "b"], echecs: ["« B » : refusé"] }), "2 rangés ; pas fait : « B » : refusé.");
});

test("tâches : par lots de 6, et l'état de chaque ligne (ecrireTaches)", () => {
  assert.deepEqual(R.lots([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]).map((l) => l.length), [6, 6, 1]);
  assert.deepEqual(R.lots([]), []);
  const r = { etat: "appliquee_partiellement", results: [{ ok: true, nom: "A" }, { ok: true, nom: "B", dejaLa: true }, { ok: false, nom: "C", erreur: "quota" }] };
  assert.deepEqual(R.etatsLot(r, 3), [{ etat: "fait" }, { etat: "dejaLa" }, { etat: "echec", erreur: "quota" }]);
  assert.deepEqual(R.etatsLot({ etat: "deja_la", results: [] }, 2), [{ etat: "dejaLa" }, { etat: "dejaLa" }], "tout déjà là, sans détail");
  assert.deepEqual(R.etatsLot({ etat: "echouee" }, 1), [{ etat: "echec", erreur: "refusé par Motion" }]);
  assert.deepEqual(R.etatsLot({ etat: "appliquee" }, 1), [{ etat: "fait" }], "réponse sans détail : l'état d'ensemble");
  assert.equal(R.estDejaLa({ ok: false, erreur: "« X » existe déjà dans Motion" }), true, "une tour d'avant le 24/10 le disait en échec");
  assert.equal(R.estDejaLa({ ok: true, deja_la: true }), true);
  assert.equal(R.toutDejaLa({ results: [{ ok: true, dejaLa: true }] }), true);
  assert.equal(R.vraisEchecs({ results: [{ ok: false, erreur: "x" }, { ok: false, erreur: "« Y » existe déjà dans Motion" }] }), 1);
});

test("où ranger un projet : nommé, sinon les mots en commun (OrganisationTests.testParentSuggerePourUnProjet)", () => {
  const connu = { dossiers: [{ id: "d1", nom: "Maison", parent: null, ordre: 0 }], projets: [{ id: "p1", nom: "Boutiques" }] };
  assert.equal(R.parentPour("Inconnu", connu), null);
  assert.equal(R.parentPour("maison", connu), "d1", "sans casse");
  assert.equal(R.parentPour("BOUTIQUES", connu), "motion:p1");
  assert.equal(R.suggestion("Étudier ElevenLabs", { dossiers: [], projets: [] }), null);
  assert.deepEqual(R.suggestion("Comparer les voix des boutiques", connu), { id: "motion:p1", nom: "Boutiques" });
  assert.equal(R.suggestion("Un vélo", connu), null, "moins de 4 lettres : pas un mot");
  assert.deepEqual(R.candidatsParent(connu).map((c) => c.id), ["motion:p1", "d1"], "les projets Motion, puis les dossiers");
  assert.equal(R.ordreApres([{ parent: null, ordre: 0 }, { parent: null, ordre: 4 }, { parent: "x", ordre: 9 }], null), 5);
  assert.equal(R.ordreApres([], "x"), 0);
  assert.equal(R.ordreApres(null, null), 0);
});

test("Noter : les phrases de l'iPhone (déjà là, rappel, file de Motion)", () => {
  assert.equal(R.phraseListe("Courses", [], ["tomates", "œufs"]), "Déjà dans « Courses » : « tomates », « œufs ».");
  assert.equal(R.phraseListe("Courses", ["beurre"], ["tomates"]), "1 article dans « Courses ». Déjà dans ta liste : « tomates ».");
  assert.equal(R.phraseListe("Courses", ["a", "b"], []), "2 articles dans « Courses ».");
  const now = date(15, 10, 10, 40);
  assert.equal(R.quandRappel(ms(15, 10, 18, 0), now), "aujourd'hui 18:00");
  assert.equal(R.quandRappel(ms(16, 10, 9, 0), now), "demain 09:00");
  assert.equal(R.quandRappel(ms(20, 10, 9, 5), now), "mar. 20 oct. 09:05");
  assert.equal(R.quandRappel(ms(3, 1, 9, 0, 2027), now), "dim. 3 janv. 2027 09:00");
  assert.equal(R.phraseAttenteMotion({ enFile: 2, attenteMs: 18200, quotaParMinute: 12 }), "En file chez Motion : ~20 s (12 requêtes par minute). Rien à refaire, ça part tout seul.");
  assert.equal(R.phraseAttenteMotion({ enFile: 1, attenteMs: 1500 }), null, "moins de 2 s : rien à dire");
  assert.equal(R.phraseAttenteMotion({ enFile: 9, attenteMs: 125000 }), "En file chez Motion : ~2 min. Rien à refaire, ça part tout seul.");
});

test("Noter : l'aperçu et le bouton parlent comme l'iPhone (CaptureView)", () => {
  const now = date(15, 10, 10, 40);
  const ap = (t, genre = null) => apercu(t, { maintenant: now, genre });
  const phrase = (t, o = {}) => N.phraseApercu(ap(t, o.genre), t, { maintenant: now, ...o });
  assert.equal(phrase("", { micro: true }), "Écris ou dicte : Rémy devine où le ranger.");
  assert.equal(phrase(""), "Écris, Rémy devine où le ranger.");
  assert.equal(phrase("Appeler le comptable"), "Tâche → Motion lui trouvera un créneau");
  assert.equal(phrase("Finir le devis vendredi"), "Tâche « Finir le devis » → Motion lui trouvera un créneau avant l'échéance : vendredi 16 octobre");
  assert.equal(phrase("Idée : un atelier bougies"), "Idée → gardée dans « Idées » (Projets), rien n'est planifié");
  assert.equal(phrase("Idée : un atelier bougies", { dossiers: false }), "Les Idées arriveront avec la mise à jour de ta tour.");
  assert.equal(phrase("tomates, lait et œufs", { nomListe: "Courses" }), "3 articles → Courses");
  assert.equal(phrase("tomates, lait et œufs"), "3 articles → Courses (créée)");
  assert.equal(phrase("Rappelle-moi d'appeler Léa demain à 9h"), "Rappel → demain 09:00 : « Appeler Léa »");
  assert.equal(phrase("Rappelle-moi d'appeler Léa"), "Rappel sans date (ajoute « demain 9h », « lundi », « le 12/11 »…)");
  assert.equal(phrase("Un truc à garder", { genre: "retenir" }), "Retenir → encore 14 caractères pour que Rémy en tire quelque chose");
  assert.equal(phrase("Une chose assez longue pour Rémy, vraiment.", { genre: "retenir" }), "Retenir → dans la mémoire de Rémy");
  assert.equal(phrase("Quand passe le plombier ?"), "Question → s'ouvre chez Rémy, prête à envoyer");
  assert.equal(phrase("Nouveau projet : Recrutement", { nomParent: "Boutiques" }), "Dossier « Recrutement » dans « Boutiques » (Remy ; pas de projet Motion)");
  assert.equal(phrase("Nouveau projet : Recrutement"), "Dossier « Recrutement » à part (Remy ; pas de projet Motion)");
  // Le bouton : grisé tant que ce n'est pas prêt.
  assert.equal(N.prete(ap("Un truc à garder", "retenir"), "Un truc à garder"), false);
  assert.equal(N.prete(ap("tomates, lait"), "tomates, lait", { carnet: false }), false, "liste sans listes-v1");
  assert.equal(N.prete(ap("Nouveau projet X"), "Nouveau projet X", { dossiers: false }), false);
  assert.equal(N.prete(ap("Quand passe le plombier ?"), "Quand passe le plombier ?"), true);
  assert.equal(N.prete(ap(""), "   "), false);
  assert.deepEqual(Object.keys(N.ACTIONS).map((g) => N.ACTIONS[g]), ["Ajouter à Motion", "Garder l'idée", "Ajouter à la liste", "Créer le rappel", "Retenir", "Ouvrir chez Rémy", "Créer le dossier"]);
});

// --- Les cartes de proposition (PropositionView, Format.detailAction) ---







// --- Ajuster une ligne (AjusterAction.swift) ---




// --- Retenir, la dictée, l'appel ---

test("Retenir : les mots de la feuille", () => {
  assert.equal(T.nomSource("note"), "ta note");
  assert.equal(T.nomSource("chatgpt"), "cette réponse de ChatGPT");
  assert.equal(T.nomSource("claude"), "cette réponse de Claude");
  assert.equal(T.libelleRetenir(1), "Retenir 1 info");
  assert.equal(T.libelleRetenir(3), "Retenir 3 infos");
});

test("dictée : la barre, le plafond, trop court", () => {
  assert.equal(D.mss(0), "0:00");
  assert.equal(D.mss(65.4), "1:05");
  assert.equal(D.texteBarre(10), "Je t'écoute…");
  assert.equal(D.texteBarre(D.DUREE_MAX - 61), "Je t'écoute…");
  assert.equal(D.texteBarre(D.DUREE_MAX - 45), "Encore 45 s", "la dernière minute se voit");
  assert.equal(D.texteBarre(D.DUREE_MAX - 45.2), "Encore 46 s", "les secondes entières écoulées, comme la barre de l'iPhone");
  assert.equal(D.texteBarre(D.DUREE_MAX + 3), "Encore 0 s");
  assert.equal(D.DUREE_MAX, 900, "15 minutes");
  assert.equal(D.assezLong(0.4, 5000), false);
  assert.equal(D.assezLong(2, 999), false);
  assert.equal(D.assezLong(0.5, 1000), true);
  assert.equal(D.delaiTranscription(600), 720000, "le délai grandit avec le vocal (testUnVocalLongALeTempsDEtreTranscrit)");
  assert.equal(D.phrasePasParti("Dictée Locale ne répond pas."), "Ton vocal n'est pas parti — Dictée Locale ne répond pas. Il t'attend : touche « Renvoyer ».");
  assert.equal(D.disponible(), false, "sous node : pas de micro");
  assert.equal(D.SANS_TRANSCRIPTION, "La dictée n'est pas branchée sur la tour : rien ne peut transcrire ta voix pour l'instant.");
});

/** Rejoue des volumes, une mesure toutes les 100 ms (DetecteurParoleTests.rejouer). */
function rejouer(d, morceaux) {
  let t = 0;
  for (const [db, duree] of morceaux) {
    const fin = t + duree;
    while (t < fin - 1e-9) {
      t = Math.round((t + 0.1) * 10) / 10;
      const v = d.analyser(db, t);
      if (v !== "continuer") return [v, t];
    }
  }
  return ["continuer", t];
}



test("les modules du lot sont dans le cache hors ligne (sw.js) et sans tiers", () => {
  const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  for (const f of ["/app/analyse/etiquettes.js", "/app/analyse/rangement.js", "/app/dictee.js", "/app/vues/retenir.js"]) assert.ok(sw.includes(`"${f}"`), f);
  const dictee = fs.readFileSync(new URL("../public/app/dictee.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(dictee, /localStorage|indexedDB|caches\./, "l'audio n'est jamais gardé");
});

// --- Contre les vraies routes de la tour (faux Motion, faux Google) ---

const evenements = new Map();
let suivantEv = 1;
const google = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://g");
    const json = (code, v) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(v === undefined ? "" : JSON.stringify(v));
    };
    if (u.pathname === "/token") return json(200, { access_token: "faux", expires_in: 3600 });
    const b = corps ? JSON.parse(corps) : null;
    if (/\/events$/.test(u.pathname)) {
      if (req.method === "GET") return json(200, { items: [...evenements.values()] });
      const ev = { id: `e${suivantEv++}`, status: "confirmed", ...b };
      evenements.set(ev.id, ev);
      return json(200, ev);
    }
    const m = u.pathname.match(/\/events\/([^/]+)$/);
    const ev = m && evenements.get(decodeURIComponent(m[1]));
    if (!ev) return json(404, { error: "not found" });
    if (req.method === "DELETE") {
      evenements.delete(ev.id);
      return json(204);
    }
    return json(200, ev);
  });
});
await new Promise((r) => google.listen(0, "127.0.0.1", r));
const motion = await demarrerFauxMotion();
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-site-noter-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "MOTION_WORKSPACE_ID", "MOTION_WRITE", "REMY_MOTION_HORAIRE", "REMY_GLM_URL"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.MOTION_API_KEY = "faux";
process.env.MOTION_BASE_URL = motion.url;
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_API_URL = `http://127.0.0.1:${google.address().port}`;
process.env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${google.address().port}/token`;
const store = await import("../lib/store.js");
await store.putGoogleToken({ refresh_token: "faux", access_token: "faux", expire_a: Date.now() + 3600_000 });
const { routeApi } = await import("../lib/routes.js");
const { CAPACITES } = await import("../lib/version.js");
const { fermer: fermerBase } = await import("../lib/db.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(async () => {
  remy.close();
  google.close();
  await motion.fermer();
  fermerBase();
  fs.rmSync(dossier, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** Comme api.js : JSON, et une erreur lisible (message de la tour, statut). */
const appel = async (chemin, { methode = "GET", corps } = {}) => {
  const r = await fetch(base + chemin, { method: methode, headers: { Accept: "application/json", ...(corps !== undefined ? { "Content-Type": "application/json" } : {}) }, body: corps === undefined ? undefined : JSON.stringify(corps) });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(d?.message || d?.error || `Erreur ${r.status}`), { statut: r.status, nature: "serveur" });
  return d;
};
let n = 0;
const nouvelId = () => `cmd-test-${++n}`;

test("contrat : les capacités que le site attend sont annoncées par la tour", () => {
  for (const c of ["analyse-capture-v1", "retenir-choix-v1", "dossiers-v1", "listes-v1", "rappels-v1", "etiquettes-v1", "propositions-ajustables-v1", "propositions-partielles-v1", "categories-taches-v1", "regles-v1", "deja-la-v1"]) assert.ok(CAPACITES.includes(c), c);
});

test("ranger une capture validée : chaque nature à sa place (OrganisationTests.testRangerUneCaptureValidee)", async () => {
  const connu = { listes: [], dossiers: [], projets: [{ id: "p1", nom: "Boutiques" }] };
  const appels = [];
  const espion = (chemin, o = {}) => {
    appels.push({ chemin, methode: o.methode || "GET", corps: o.corps });
    return appel(chemin, o);
  };
  const elements = [
    { cle: "1", nature: "tache", titre: "Faire la lessive", quand: samedi, heureConnue: false, dureeMin: 30 },
    { cle: "2", nature: "contrainte", titre: "Dispo limitée samedi", quand: samedi, heureConnue: false },
    { cle: "3", nature: "rendez-vous", titre: "Studio", quand: samedi + 5 * 3600_000, heureConnue: true, dureeMin: 120 },
    { cle: "4", nature: "rendez-vous", titre: "Soirée chez Yanis", quand: null, heureConnue: false },
    { cle: "5", nature: "liste", titre: "Courses", liste: "Courses", articles: ["tomates", "lait"] },
    { cle: "6", nature: "note", titre: "Le code du portail est 1234" },
    { cle: "7", nature: "projet", titre: "Site vitrine", parent: "Boutiques" },
  ];
  const bilan = await R.ranger(elements, { appel: espion, connu, agenda: true, graine: "essai", nouvelId });
  assert.equal(bilan.faits.length, 6, R.phraseBilan(bilan));
  assert.deepEqual(bilan.echecs, ["« Soirée chez Yanis » : heure manquante"]);
  assert.deepEqual(bilan.regles.sort(), ["1", "2", "3", "5", "6", "7"], "le raté n'est pas réglé : il reste coché");
  // La tâche part avec son échéance et sa durée, marquée « capture » (historique), en UNE écriture.
  const motionAppels = appels.filter((a) => a.chemin === "/api/motion/apply");
  assert.equal(motionAppels.length, 1, "rien en double");
  assert.equal(motionAppels[0].corps.origine, "capture");
  assert.ok(motionAppels[0].corps.idCommande);
  assert.equal(motionAppels[0].corps.actions[0].nom, "Faire la lessive");
  assert.equal(motionAppels[0].corps.actions[0].duree, 30);
  assert.ok(motionAppels[0].corps.actions[0].echeance);
  // Le rendez-vous à heure connue va dans l'agenda, avec sa durée.
  const agenda = appels.find((a) => a.chemin === "/api/google/apply");
  assert.equal(agenda.corps.actions[0].duree, 120);
  assert.equal(agenda.corps.actions[0].titre, "Studio");
  assert.ok([...evenements.values()].some((e) => e.summary === "Studio"), "écrit dans le (faux) agenda");
  // La contrainte devient un rappel ce jour-là (pas un créneau), la liste reçoit ses articles.
  const rappels = (await appel("/api/rappels")).rappels;
  assert.ok(rappels.some((r) => r.texte === "Dispo limitée samedi" && r.quand === samedi));
  const listes = (await appel("/api/listes")).listes;
  assert.deepEqual(listes.find((l) => l.nom === "Courses").elements.map((e) => e.texte), ["tomates", "lait"], "la liste créée au besoin");
  const dossiers = (await appel("/api/dossiers")).dossiers;
  assert.deepEqual(dossiers.find((d) => d.id === "notes")?.notes.map((x) => x.texte), ["Le code du portail est 1234"], "le dossier « Notes », créé au besoin");
  assert.equal(dossiers.find((d) => d.id === "notes").ordre, -1);
  assert.equal(dossiers.find((d) => d.nom === "Site vitrine")?.parent, "motion:p1", "le projet sous son parent");
  // Le même rangement, rejoué : tout est déjà là (jamais « ajouté » deux fois).
  const encore = await R.ranger(elements.filter((e) => ["1", "5"].includes(e.cle)), { appel, connu, agenda: true, graine: "essai-2", nouvelId });
  assert.deepEqual(encore.faits, []);
  assert.deepEqual(encore.dejaLa, ["« tomates », « lait » (liste « Courses »)", "« Faire la lessive » (Motion)"]);
  assert.equal(R.phraseBilan(encore), "Rien de nouveau, déjà là : « tomates », « lait » (liste « Courses ») ; « Faire la lessive » (Motion).");
});

test("ranger : sans agenda, un rendez-vous daté devient un rappel ; 13 tâches = 3 écritures", async () => {
  const appels = [];
  const espion = (chemin, o = {}) => {
    appels.push(chemin);
    return appel(chemin, o);
  };
  const quand = ms(5, 11, 18);
  const taches = Array.from({ length: 13 }, (_, i) => ({ cle: `t${i}`, nature: "tache", titre: `Tâche numéro ${i + 1}` }));
  const bilan = await R.ranger([{ cle: "r", nature: "rendez-vous", titre: "Dentiste", quand, heureConnue: true }, ...taches], { appel: espion, connu: {}, agenda: false, graine: "lot", nouvelId });
  assert.equal(appels.filter((c) => c === "/api/motion/apply").length, 3, "par lots de 6");
  assert.ok(!appels.includes("/api/google/apply"));
  assert.ok(bilan.faits.includes("« Dentiste » (rappel : agenda non branché)"));
  assert.equal(bilan.faits.length, 14);
  assert.ok((await appel("/api/rappels")).rappels.some((r) => r.texte === "Dentiste" && r.quand === quand), "à son heure");
});

test("ranger : un échec par ligne (Motion refuse une tâche), seul le raté reste à refaire", async () => {
  motion.pannes.push({ methode: "POST", chemin: /\/tasks$/, code: 400, fois: 1, corps: { message: "Nom refusé par Motion" } });
  const bilan = await R.ranger([
    { cle: "a", nature: "tache", titre: "Première tâche refusée" },
    { cle: "b", nature: "tache", titre: "Deuxième tâche acceptée" },
    { cle: "c", nature: "note", titre: "Une note qui passe" },
  ], { appel, connu: {}, agenda: true, graine: "panne", nouvelId });
  assert.equal(bilan.echecs.length, 1, R.phraseBilan(bilan));
  assert.match(bilan.echecs[0], /^« Première tâche refusée » : /);
  assert.deepEqual(bilan.regles.sort(), ["b", "c"]);
  assert.match(R.phraseBilan(bilan), /^2 rangés ; pas fait : « Première tâche refusée » : /);
});

test("ranger : la tour coupée, toutes les écritures ratent avec leur raison", async () => {
  const coupe = async () => {
    throw Object.assign(new Error("La tour ne répond pas."), { nature: "reseau" });
  };
  const bilan = await R.ranger([{ cle: "a", nature: "tache", titre: "A" }, { cle: "b", nature: "rappel", titre: "B" }], { appel: coupe, connu: {}, graine: "x", nouvelId });
  assert.deepEqual(bilan.echecs, ["« B » : La tour ne répond pas.", "« A » : La tour ne répond pas."]);
  assert.deepEqual(bilan.regles, []);
  let auth = 0;
  await R.ranger([{ cle: "a", nature: "note", titre: "A" }], { appel: async () => { throw Object.assign(new Error("session"), { nature: "auth" }); }, connu: {}, surAuth: () => auth++ });
  assert.equal(auth, 1, "401 : la reconnexion est signalée");
});

test("Noter : déjà là dans une liste et dans les rappels (lib/carnet.js), comme le lit le site", async () => {
  await appel("/api/listes/l-essai", { methode: "PUT", corps: { nom: "Marché", ordre: 0 } });
  await appel("/api/listes/l-essai/elements", { methode: "POST", corps: { elements: [{ id: "x1", texte: "Tomates", fait: false }] } });
  const r = await appel("/api/listes/l-essai/elements", { methode: "POST", corps: { elements: [{ id: "n1", texte: "tomates", fait: false }, { id: "n2", texte: "beurre", fait: false }] } });
  assert.deepEqual(r.dejaLa.map((x) => x.id), ["n1"], "la tour rend l'existant, par l'id envoyé");
  const deja = new Set(r.dejaLa.map((x) => x.id));
  assert.equal(R.phraseListe("Marché", ["beurre"], ["tomates"].filter(() => deja.has("n1"))), "1 article dans « Marché ». Déjà dans ta liste : « tomates ».");
  await appel("/api/rappels", { methode: "POST", corps: { rappels: [{ id: "ra", texte: "Rendre le livre à Léa", quand: null }] } });
  const r2 = await appel("/api/rappels", { methode: "POST", corps: { rappels: [{ id: "rb", texte: "rendre le livre à Léa", quand: null, etiquettes: [] }] } });
  assert.equal(r2.dejaLa.length, 1, "« Déjà dans tes rappels »");
  const r3 = await appel("/api/motion/apply", { methode: "POST", corps: { actions: [{ type: "creer", nom: "Faire la lessive" }], resume: "Noté depuis le site", origine: "capture", idCommande: nouvelId() } });
  assert.equal(R.toutDejaLa(r3), true, "« Déjà dans Motion »");
});

async function conversation(id, proposal) {
  await store.putConversation({
    id, title: "t", createdAt: Date.now(), updatedAt: Date.now(),
    messages: [{ role: "user", content: "x" }, { role: "assistant", content: "je propose", proposal }],
  });
}




test("Retenir : extraire puis { choisis } (les routes de RetenirInfosVue)", async () => {
  // Sans modèle local, la tour le dit : le site affiche son message et « Réessayer ».
  await assert.rejects(appel("/api/capture/extraire", { methode: "POST", corps: { texte: "Un long texte à retenir sur la boutique et ses projets pour l'hiver.", source: "note" } }), (e) => e.statut >= 400 && e.message.length > 0);
  await assert.rejects(appel("/api/capture/analyser", { methode: "POST", corps: { texte: "Jeudi soir chez Yanis, samedi studio." } }), (e) => e.statut >= 400 && e.message.length > 0, "l'analyse aussi : un message, pas un silence");
});
