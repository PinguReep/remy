// Réglages du site (vues/reglages.js) : les calculs portés de l'iPhone, avec
// les cas des tests Swift (Priorites.aEnvoyer, ModelesLocaux.fenetreLisible,
// RegleRemy.delai, ActivitePC.duree…), puis les chemins de Réglages joués
// contre les vraies routes de la tour (priorités et leur 409, mémoire, règles,
// lieux, activité du PC, réglages), sur des données fictives.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const magasin = new Map();
globalThis.localStorage = {
  getItem: (k) => (magasin.has(k) ? magasin.get(k) : null),
  setItem: (k, v) => magasin.set(k, String(v)),
  removeItem: (k) => magasin.delete(k),
  clear: () => magasin.clear(),
};
const V = await import("../public/app/vues/reglages.js");
const { phraseFile } = await import("../public/app/vues/connexion.js");
const { CE_QUI_SORT } = await import("../public/app/analyse/privee.js");

test("Ce qui compte : ce qui part (vides et doublons retirés, mots découpés) et la ligne d'état", () => {
  const brouillon = [
    { id: "p-musique", titre: "La musique", pourquoi: "Jouer me rend calme", mots: ["musique", "guitare"], joursSans: 12, neglige: true, constat: "rien depuis 12 jours", motsTexte: "musique, guitare, répétition, x" },
    { id: "p-proches", titre: "Voir Léa et Hugo", joursSans: 1, neglige: false, constat: null },
    { id: "p-double", titre: "  la MUSIQUE " },
    { id: "p-vide", titre: "   " },
  ];
  const envoi = V.aEnvoyerPriorites(brouillon);
  assert.deepEqual(envoi.map((p) => p.titre), ["La musique", "Voir Léa et Hugo"]);
  assert.deepEqual(envoi[0].mots, ["musique", "guitare", "répétition"], "« x » est trop court pour reconnaître quoi que ce soit");
  assert.equal(envoi[0].joursSans, undefined, "les calculs de la tour ne repartent pas");
  assert.equal(envoi[1].pourquoi, undefined);
  assert.deepEqual(Object.keys(envoi[0]).sort(), ["id", "mots", "pourquoi", "titre"]);
  // Bornes : titre 80, pourquoi 240, 8 mots au plus ; « ; » et retour à la ligne découpent aussi.
  const long = V.aEnvoyerPriorites([{ id: "l", titre: "é".repeat(90), pourquoi: "a".repeat(300), motsTexte: "un1;deux\ntrois, quatre, cinq, six, sept, huit, neuf, dix" }])[0];
  assert.equal([...long.titre].length, 80);
  assert.equal(long.pourquoi.length, 240);
  assert.deepEqual(long.mots, ["un1", "deux", "trois", "quatre", "cinq", "six", "sept", "huit"]);
  // Le brouillon et la tour, comparés par ce qui partirait (Enregistrer actif seulement si ça diffère).
  const serveur = [{ id: "p1", titre: "Sport", mots: ["course", "vélo"] }];
  assert.deepEqual(V.aEnvoyerPriorites([{ ...serveur[0], motsTexte: "course, vélo" }]), V.aEnvoyerPriorites(serveur));
  assert.equal(V.etatPriorite(brouillon[0]), "Négligée : rien depuis 12 jours");
  assert.equal(V.etatPriorite(brouillon[1]), "Dernière trace hier");
  assert.equal(V.etatPriorite({ joursSans: 0 }), "Active aujourd'hui");
  assert.equal(V.etatPriorite({ joursSans: 5 }), "Dernière trace il y a 5 jours");
  assert.equal(V.etatPriorite({}), null);
});

test("Modèle : la fenêtre en clair, et pourquoi c'est lui", () => {
  assert.equal(V.fenetreLisible(1048576), "1 M de contexte");
  assert.equal(V.fenetreLisible(1000000), "1 M de contexte");
  assert.equal(V.fenetreLisible(131072), "128 k de contexte");
  assert.equal(V.fenetreLisible(1572864), "1,5 M de contexte");
  assert.equal(V.fenetreLisible(null), null);
  assert.equal(V.fenetreLisible(0), null);
  const m = { joignable: true, choisi: null, actif: { id: "d", libelle: "DeepSeek", source: "auto" }, servis: [{ id: "d" }] };
  assert.equal(V.pourquoiModele(m), "Celui que tes Sparks chargent");
  assert.equal(V.pourquoiModele({ ...m, actif: { source: "choisi" } }), "Choisi par toi");
  assert.equal(V.pourquoiModele({ ...m, actif: { source: "tour" } }), "Réglé sur la tour (REMY_GLM_MODEL)");
  assert.equal(V.pourquoiModele({ ...m, choisi: "glm" }), "Ton choix n'est plus chargé : celui que tes Sparks servent");
  assert.equal(V.pourquoiModele({ ...m, choisi: "glm", joignable: false }), "Celui que tes Sparks chargent", "Sparks muettes : on ne sait pas");
  assert.equal(V.pourquoiModele({ joignable: false }), "Les Sparks n'ont pas dit ce qu'elles servent");
});

test("Règles : le délai et le détail (RegleRemy.delai)", () => {
  assert.equal(V.delaiRegle(180), "au plus tard 3 h avant");
  assert.equal(V.delaiRegle(1440), "au plus tard la veille");
  assert.equal(V.delaiRegle(2880), "au plus tard 2 jours avant");
  assert.equal(V.delaiRegle(45), "au plus tard 45 min avant");
  assert.equal(V.delaiRegle(0), "avant l'événement");
  assert.equal(V.detailRegle({ nom: "Avant une sortie", mots: ["sortie", "soirée"], tache: { nom: "Rasage", duree: 15 }, avantMin: 180 }), "« Rasage » (15 min), au plus tard 3 h avant, avant : sortie, soirée");
});

test("Activité du PC : durées, problème et quoi faire, semaine d'avant, relevé, exclusions", () => {
  assert.equal(V.dureeActivite(190 * 60), "3 h 10");
  assert.equal(V.dureeActivite(45 * 60), "45 min");
  assert.equal(V.dureeActivite(10), "moins d'une minute");
  assert.equal(V.cleExclusion(" Discord.exe "), "discord");
  assert.equal(V.cleExclusion("Code"), "code");
  assert.equal(V.cleExclusion("Agenda.app"), "agenda.app", "un domaine en .app reste un domaine");
  assert.equal([...V.cleExclusion("x".repeat(100))].length, 80);
  const v = (aw) => ({ actif: true, activitywatch: aw, aujourdhui: { total: 0 }, semaine: { total: 0 } });
  assert.match(V.problemeActivite(v({ joignable: false })), /installe-le/);
  assert.match(V.problemeActivite(v({ joignable: true, fenetre: true, afk: false })), /aw-qt/);
  assert.equal(V.problemeActivite(v({ joignable: true, fenetre: true, afk: true })), null);
  assert.equal(V.problemeActivite({ actif: false, activitywatch: { joignable: false } }), null, "coupée : rien à signaler");
  assert.equal(V.problemeActivite(v({ joignable: false, message: "Port fermé." })), "Port fermé.");
  const semaine = (cette, avant) => ({ semaine: { total: cette }, semainePrecedente: avant == null ? null : { total: avant } });
  assert.equal(V.comparaisonActivite(semaine(10 * 3600, 8 * 3600 + 50 * 60)), "Les 7 jours d'avant : 8 h 50 (1 h 10 de plus cette semaine).");
  assert.equal(V.comparaisonActivite(semaine(3600, 2 * 3600)), "Les 7 jours d'avant : 2 h (1 h de moins cette semaine).");
  assert.equal(V.comparaisonActivite(semaine(3600, 3600 + 20)), "Les 7 jours d'avant : 1 h (autant cette semaine).");
  assert.equal(V.comparaisonActivite(semaine(3600, null)), null);
  assert.equal(V.comparaisonActivite(semaine(3600, 0)), null);
  assert.equal(V.releveActivite({}), "Premier relevé dans 20 min au plus");
  assert.equal(V.releveActivite({ derniereCollecte: new Date(2026, 9, 29, 14, 20).getTime() }), "Relevé à 14:20");
  assert.equal(V.messageActivation({}, false), "Activité du PC coupée : plus rien n'est relevé.");
  assert.equal(V.messageActivation({ actif: true, activitywatch: { joignable: true }, derniereCollecte: new Date(2026, 9, 29, 14, 20).getTime() }, true), "Activité du PC allumée : relevé à 14:20.");
  assert.equal(V.messageActivation({ actif: true, activitywatch: { joignable: false } }, true), "Allumée, mais ActivityWatch ne répond pas encore.");
  assert.equal(V.messageExclusion({ categorie: "navigateur", secondes: 2400 }), "Ses 40 min de la semaine, tout son historique et les sites relevés s'effacent sur la tour, sans retour.");
  assert.equal(V.messageExclusion({ categorie: "communication", secondes: 1500 }), "Ses 25 min de la semaine et tout son historique s'effacent sur la tour, sans retour.");
  assert.equal(V.messageExclusion({ secondes: 2400, site: true }), "Ses 40 min de la semaine et tout son historique s'effacent sur la tour, sans retour.");
});

test("Localisation : le commerce, le lieu lisible, en ce moment, le sous-titre", () => {
  assert.equal(V.commerceLibelle({ nom: "Salon Lumière", type: "coiffeur" }), "Salon Lumière (coiffeur)");
  assert.equal(V.commerceLibelle({ nom: "", type: "pharmacie" }), "pharmacie (sans nom)");
  assert.equal(V.commerceLibelle({ nom: "Boulangerie des Vignes", type: "boulangerie" }), "Boulangerie des Vignes");
  const depuis = new Date(2026, 9, 29, 18, 42).getTime();
  assert.equal(V.phraseEtatLieux({ ou: "voiture", depuis: new Date(2026, 9, 29, 8, 5).getTime() }), "En voiture, depuis 08:05");
  assert.equal(V.phraseEtatLieux({ ou: "lieu", depuis, lieu: { nom: "Salle de sport" } }), "Salle de sport, depuis 18:42");
  assert.equal(V.phraseEtatLieux({ ou: "lieu", lieu: { commerce: { nom: "Salon Lumière", type: "coiffeur" } } }), "Sans doute Salon Lumière (coiffeur)");
  assert.equal(V.phraseEtatLieux({ ou: "lieu", lieu: {} }), "Un lieu sans adresse connue");
  assert.equal(V.phraseEtatLieux({ ou: "inconnu" }), "Pas de position récente");
  assert.equal(V.lieuAffiche({ adresse: "3 Avenue du Port" }), "3 Avenue du Port");
  assert.equal(V.lieuAffiche({}), "Lieu sans adresse connue");
  assert.equal(V.sousTitreLieu({ visites: 12, source: "sam" }), "12 visites · nommé par toi");
  assert.equal(V.sousTitreLieu({ visites: 1, source: "agenda" }), "1 visite · reconnu d'après ton agenda");
  assert.equal(V.sousTitreLieu({ visites: 3, source: "auto" }), "3 visites · à nommer ?");
});

test("Temps de réponse : durées, lignes, état de Motion", () => {
  assert.equal(V.dureeMesure(120), "120 ms");
  assert.equal(V.dureeMesure(1400), "1,4 s");
  assert.equal(V.ligneMesure({ n: 3, p50: 120, p95: 1400 }), "médiane 120 ms · 95 % sous 1,4 s · 3 mesures");
  assert.equal(V.ligneMesure({ n: 1, p50: 5, p95: 5 }), "médiane 5 ms · 95 % sous 5 ms · 1 mesure");
  assert.equal(V.ligneMesure(undefined), "pas encore mesuré");
  assert.deepEqual(["ok", "maj", "quota", "menage", "panne", "reseau", "auth", "attente"].map(V.etatMotion),
    ["à jour", "mise à jour en cours", "Motion limite les requêtes", "quota gardé pour tes gestes", "Motion ne répond pas", "la tour ne joint pas Motion", "clé Motion refusée", "première lecture"]);
  assert.deepEqual(V.MESURES_TOUR.map(([c]) => c), ["dashboard", "motion.liste", "motion.lecture", "motion.attente_quota", "motion.ecriture", "google.jour", "glm.premier_jeton", "glm.complete", "conseil.glm", "dictee", "capture"]);
});

test("Rémy : recherche web, recherche privée, circuits — les phrases de l'iPhone", () => {
  assert.equal(V.phraseRechercheWeb({ rechercheWeb: true, rechercheLocale: "duckduckgo" }), "Rémy cherche lui-même sur le web (DuckDuckGo), sans passer par Claude.");
  assert.equal(V.phraseRechercheWeb({ rechercheWeb: false, rechercheLocale: "searxng" }), "Coupée : Rémy répond sans le web.");
  assert.equal(V.phraseRechercheWeb({ rechercheWeb: true }), "Passe par Claude (Anthropic). Rémy te demande ton accord à chaque recherche.");
  assert.equal(V.phraseRechercheWeb({ rechercheWeb: false }), "Coupée : Rémy répond sans le web, rien ne part chez Anthropic.");
  assert.equal(V.phraseRechercheWeb({ rechercheWeb: false, rechercheWebCoupeeParLaTour: true }), "Coupée sur la tour (REMY_WEB_SEARCH=off) : à rallumer là-bas.");
  assert.equal(V.confirmationRechercheWeb({ rechercheLocale: "duckduckgo" }, true), "Recherche web permise : Rémy cherche lui-même quand il en a besoin, sans Claude.");
  assert.equal(V.confirmationRechercheWeb({}, true), "Recherche web permise : Rémy te demandera avant chaque recherche.");
  assert.equal(V.confirmationRechercheWeb({}, false), "Recherche web coupée : Rémy répond sans le web.");
  const r = { rechercheLocale: "duckduckgo", salleBlanche: true, recherchePriveeVerrouillee: false, rechercheWeb: true };
  assert.equal(V.phraseRecherchePrivee({ ...r, recherchePriveeReglage: true }), `Allumé, Rémy peut chercher : ${CE_QUI_SORT}`);
  assert.equal(V.phraseRecherchePrivee({ ...r, recherchePriveeReglage: true, rechercheWeb: false }), `Allumé, mais la recherche web est coupée : rien ne sort. Allumé, Rémy peut chercher : ${CE_QUI_SORT}`);
  assert.equal(V.phraseRecherchePrivee({ ...r, recherchePriveeReglage: false }), `Coupé : une conversation privée ne cherche jamais sur le web. Allumé, Rémy peut chercher : ${CE_QUI_SORT}`);
  assert.match(V.phraseRecherchePrivee({ ...r, salleBlanche: false }), /REMY_SALLE_BLANCHE=off/);
  assert.match(V.phraseRecherchePrivee({ ...r, rechercheLocale: null }), /ne cherche pas elle-même/);
  assert.equal(V.recherchePriveeAffichee({ ...r, recherchePriveeReglage: true }), true);
  assert.equal(V.recherchePriveeAffichee({ ...r, recherchePriveeReglage: true, recherchePriveeVerrouillee: true }), false, "verrouillée : affichée coupée");
  assert.equal(V.annonceCircuit("nuit", false), "Réflexion de la nuit coupée : Rémy ne travaillera plus la nuit.");
  assert.equal(V.annonceCircuit("conseil", false), "Conseil réfléchi coupé : le conseil se calcule sans IA.");
  assert.equal(V.annonceCircuit("compactage", true), "Compactage automatique allumé.");
  assert.equal(V.annonceCircuit("regles", false), "Vérification des règles coupée : Rémy ne propose plus leurs tâches.");
  assert.equal(V.annonceCircuit("syntheses", true), "Circuit allumé.");
  assert.equal(V.detailCircuit("nuit", { forceParLaTour: true }), "Réglé sur la tour (REMY_CIRCUIT_NUIT) : à changer là-bas.");
  assert.equal(V.detailCircuit("syntheses", {}), null, "les autres circuits gardent leur nom seul");
});

test("Jours actifs, déconnexion, connexion, nouveautés : les phrases", () => {
  const jours = Array.from({ length: 20 }, (_, i) => ({ jour: `2026-10-${String(10 + i).padStart(2, "0")}`, messages: i < 6 ? 3 : 0, actif: i === 19 }));
  assert.equal(V.joursActifs({ jours }), 1, "les 14 plus récents seulement");
  assert.equal(V.joursActifs({ jours: [] }), null);
  assert.equal(V.joursActifs(undefined), null);
  assert.equal(V.phraseJoursActifs(0), "Tu n'as pas parlé à Rémy ces 14 derniers jours.");
  assert.equal(V.phraseJoursActifs(1), "Tu as parlé à Rémy 1 jour sur les 14 derniers.");
  assert.equal(V.phraseJoursActifs(9), "Tu as parlé à Rémy 9 jours sur les 14 derniers.");
  assert.equal(V.phraseDeconnexion(0), "Il faudra retaper le mot de passe pour revenir.");
  assert.equal(V.phraseDeconnexion(1), "Il faudra retaper le mot de passe pour revenir. Un envoi en attente partira après la reconnexion.");
  assert.equal(V.phraseDeconnexion(3), "Il faudra retaper le mot de passe pour revenir. 3 envois en attente partiront après la reconnexion.");
  assert.equal(phraseFile(0), null);
  assert.equal(phraseFile(1), "1 note tapée sur cet ordinateur : elle partira après la connexion.");
  assert.equal(phraseFile(2), "2 notes tapées sur cet ordinateur : elles partiront après la connexion.");
  assert.equal(V.sousTitreNouveautes(0), "Les tutoriels des mises à jour, à revoir");
  assert.equal(V.sousTitreNouveautes(2), "2 nouvelles à découvrir");
});

// --- Les chemins de Réglages, joués contre les vraies routes de la tour ---
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-reglages-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "ANTHROPIC_API_KEY", "REMY_ACTIVITE_PC", "REMY_ACTIVITYWATCH_URL"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = "http://127.0.0.1:9/v1";
const { routeApi } = await import("../lib/routes.js");
const { creerRegle } = await import("../lib/regles.js");
const { fermer } = await import("../lib/db.js");
const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) { res.statusCode = 404; res.end("{}"); }
});
await new Promise((r) => remy.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${remy.address().port}`;
test.after(() => { remy.close(); fermer(); fs.rmSync(dossier, { recursive: true, force: true }); });
// Comme api.js (même origine : la tour refuse une écriture venue d'ailleurs).
const appel = async (chemin, { methode = "GET", corps } = {}) => {
  const r = await fetch(base + chemin, { method: methode, headers: { Accept: "application/json", Origin: base, ...(corps !== undefined ? { "Content-Type": "application/json" } : {}) }, body: corps === undefined ? undefined : JSON.stringify(corps) });
  const t = await r.text();
  return { statut: r.status, corps: t ? JSON.parse(t) : null };
};

test("contrat : Ce qui compte — une version de plus, la même liste ne bouge rien, une base périmée rend 409", async () => {
  const v0 = (await appel("/api/priorites")).corps;
  assert.equal(v0.version, 0);
  const brouillon = [{ id: "p-musique", titre: "La musique", pourquoi: "Jouer me rend calme", motsTexte: "musique, guitare" }];
  const r1 = await appel("/api/priorites", { methode: "PUT", corps: { priorites: V.aEnvoyerPriorites(brouillon), base: v0.version } });
  assert.equal(r1.statut, 200, JSON.stringify(r1.corps));
  assert.equal(r1.corps.version, 1);
  assert.deepEqual(r1.corps.priorites[0].mots, ["musique", "guitare"]);
  assert.ok(Number.isFinite(r1.corps.priorites[0].joursSans), "la tour calcule les jours sans trace");
  // Rien de changé à l'écran : Enregistrer reste grisé (même envoi que la tour).
  assert.deepEqual(V.aEnvoyerPriorites(r1.corps.priorites.map((p) => ({ ...p, motsTexte: p.mots.join(", ") }))), V.aEnvoyerPriorites(r1.corps.priorites));
  const meme = await appel("/api/priorites", { methode: "PUT", corps: { priorites: V.aEnvoyerPriorites(r1.corps.priorites), base: 1 } });
  assert.equal(meme.corps.version, 1);
  const perimee = await appel("/api/priorites", { methode: "PUT", corps: { priorites: [{ id: "p-x", titre: "Autre chose" }], base: 0 } });
  assert.equal(perimee.statut, 409, "une autre version est passée entre-temps");
});

test("contrat : la mémoire se relit avant d'écrire (le conflit se voit)", async () => {
  const lue = (await appel("/api/memory")).corps;
  assert.equal(typeof lue.text, "string");
  // Rémy écrit pendant la correction : la relecture diffère de ce qu'on corrigeait.
  await appel("/api/memory", { methode: "PUT", corps: { text: "## Préférences\n- Réponses courtes (ajouté par la nuit)" } });
  const relue = (await appel("/api/memory")).corps;
  assert.notEqual(relue.text, lue.text);
  const ecrit = await appel("/api/memory", { methode: "PUT", corps: { text: "Ma version" } });
  assert.equal(ecrit.statut, 200);
  assert.equal((await appel("/api/memory")).corps.text, "Ma version");
});

test("contrat : Règles — PATCH et DELETE rendent la liste, Vérifier maintenant sans événement ne propose rien", async () => {
  const r = creerRegle({ nom: "Avant une sortie", mots: ["sortie"], tache: { nom: "Rasage", duree: 15 }, avantMin: 180 });
  const liste = (await appel("/api/regles")).corps.regles;
  assert.equal(V.detailRegle(liste[0]), "« Rasage » (15 min), au plus tard 3 h avant, avant : sortie");
  const coupee = await appel(`/api/regles/${encodeURIComponent(r.id)}`, { methode: "PATCH", corps: { actif: false } });
  assert.equal(coupee.statut, 200);
  assert.equal(coupee.corps.regles[0].actif, false);
  const verif = await appel("/api/regles/verifier", { methode: "POST", corps: {} });
  assert.equal(verif.statut, 200);
  assert.equal(verif.corps.proposees, 0);
  const sup = await appel(`/api/regles/${encodeURIComponent(r.id)}`, { methode: "DELETE" });
  assert.deepEqual(sup.corps.regles, []);
});

test("contrat : Localisation — nommer, renommer, oublier, effacer l'historique (DELETE /api/lieux/historique)", async () => {
  const cree = await appel("/api/lieux", { methode: "POST", corps: { nom: "Salle de sport", lat: 0.001, lon: 0.001 } });
  assert.equal(cree.statut, 200, JSON.stringify(cree.corps));
  const id = cree.corps.lieu.id;
  const renomme = await appel(`/api/lieux/${encodeURIComponent(id)}`, { methode: "PATCH", corps: { nom: "La salle" } });
  assert.equal(renomme.corps.lieux.find((l) => l.id === id).nom, "La salle");
  assert.equal(V.sousTitreLieu(renomme.corps.lieux.find((l) => l.id === id)), "0 visite · nommé par toi");
  const histo = await appel("/api/lieux/historique", { methode: "DELETE" });
  assert.equal(histo.statut, 200);
  assert.ok(histo.corps.lieux.some((l) => l.id === id), "les lieux nommés restent");
  const oublie = await appel(`/api/lieux/${encodeURIComponent(id)}`, { methode: "DELETE" });
  assert.ok(!oublie.corps.lieux.some((l) => l.id === id));
  assert.equal(V.phraseEtatLieux(oublie.corps.etat), "Pas de position récente");
});

test("contrat : Activité du PC — exclusions et Compter de nouveau rendent la vue ; Rémy : un circuit à la fois", async () => {
  const v = (await appel("/api/activite-pc")).corps;
  assert.equal(v.actif, false);
  const exclue = await appel("/api/activite-pc", { methode: "PUT", corps: { exclusions: [V.cleExclusion("Discord.exe")] } });
  assert.equal(exclue.statut, 200, JSON.stringify(exclue.corps));
  assert.deepEqual(exclue.corps.exclusions, ["discord"]);
  const remise = await appel("/api/activite-pc", { methode: "PUT", corps: { exclusions: [] } });
  assert.deepEqual(remise.corps.exclusions, []);
  const r = (await appel("/api/reglages")).corps;
  assert.ok(r.circuits.nuit, "le circuit de la nuit est dit");
  const coupe = await appel("/api/reglages", { methode: "PUT", corps: { circuits: { nuit: false } } });
  assert.equal(coupe.corps.circuits.nuit.actif, false, "la réponse redessine la section");
  assert.equal((await appel("/api/reglages", { methode: "PUT", corps: { circuits: { inconnu: true } } })).statut, 400);
});

test("Ctrl+K sans passage par Réglages : recherche web, secours et circuits se trouvent (réglages lus à l'ouverture de la palette)", async () => {
  const { chargerVersion } = await import("../public/app/api.js");
  const vraiFetch = globalThis.fetch;
  // api.js parle à la tour par des chemins relatifs (même origine) : ici, vers la tour de test.
  globalThis.fetch = (chemin, init = {}) => vraiFetch(String(chemin).startsWith("/") ? base + chemin : chemin, { ...init, headers: { ...(init.headers || {}), Origin: base } });
  try {
    await chargerVersion();
    const titres = (q) => V.rechercherReglages(q, { aller: () => {} }).map((r) => r.titre);
    const attendus = { secours: "Secours Claude si la tour ne répond pas", "recherche web": "Recherche web", "réflexion de la nuit": "Réflexion de la nuit", compacter: "Compacter les longues conversations" };
    for (const q of Object.keys(attendus)) assert.ok(!titres(q).includes(attendus[q]), `avant la lecture, « ${q} » ne peut pas savoir`);
    const r = await V.prechargerReglages();
    assert.equal(typeof r?.circuits, "object", "GET /api/reglages lu");
    for (const [q, titre] of Object.entries(attendus)) assert.ok(titres(q).includes(titre), `Ctrl+K « ${q} » → ${titre} (${JSON.stringify(titres(q))})`);
    assert.equal(await V.prechargerReglages(), r, "une seule lecture : la seconde ouverture reprend la première");
  } finally {
    globalThis.fetch = vraiFetch;
  }
});
