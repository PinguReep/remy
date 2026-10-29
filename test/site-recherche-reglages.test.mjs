// Chercher dans les réglages (site) : le port de RechercheReglages.swift,
// avec les cas de RechercheReglagesTests.swift. Les entrées propres à
// l'iPhone (Siri, Partager, Activité en direct, réglages d'iOS) n'existent pas
// ici : les cas qui les visaient sont adaptés, et disent pourquoi.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const R = await import("../public/app/analyse/recherche-reglages.js");

/** Une tour à jour, tous ses réglages dits, l'app Windows, briefing et bilan allumés. */
const tout = () => ({
  capacites: new Set(["rituel-v1", "dossiers-v1", "modeles-v1", "lieux-v1", "activite-pc-v1", "priorites-v1", "regles-v1", "appareils", "a-trancher-v1",
    "recherche-privee-v1", "conversations-externes-v1", "propositions-attente-v1"]),
  reglages: { secoursCloud: false, secoursCloudSansObjet: false, rechercheWeb: true, contexteCloud: false, rechercheLocale: null, recherchePriveeReglage: false,
    circuits: { nuit: { nom: "nuit", actif: true }, conseil: { nom: "conseil", actif: true }, compactage: { nom: "compactage", actif: true }, regles: { nom: "regles", actif: true } } },
  bureau: true, briefing: true, bilan: true,
});
const ids = (q, c = tout()) => R.chercher(q, c).entrees.map((e) => e.id);
const entree = (id) => R.INDEX.find((e) => e.id === id);

test("l'index : sans doublon, chaque ligne a son titre, son sous-titre et une section connue", () => {
  assert.equal(new Set(R.INDEX.map((e) => e.id)).size, R.INDEX.length, "deux entrées ont le même identifiant");
  const ancres = R.INDEX.filter((e) => e.ancre).map((e) => `${e.section}·${e.ancre}`);
  assert.equal(new Set(ancres).size, ancres.length, "deux entrées visent la même ligne");
  const sections = new Set(R.SECTIONS.map((s) => s.id));
  for (const e of R.INDEX) {
    assert.ok(e.titre && e.sous, e.id);
    assert.ok(sections.has(e.section), `${e.id} : section ${e.section} inconnue`);
  }
  // Chaque section du maître a au moins une entrée (on y arrive par la recherche).
  for (const s of R.SECTIONS) assert.ok(R.INDEX.some((e) => e.section === s.id), `aucune entrée pour la section ${s.id}`);
  // Les heures ne se coupent pas en fin de ligne (« 22 h » / « 45 »).
  assert.ok(entree("rituel.heureSoir").sous.startsWith("22 h 45"));
  assert.equal(ids("22 h 45")[0], "rituel.heureSoir");
  // « capture » : la pensée sans action claire, et le jeton de capture (propre au site).
  assert.ok(ids("capture").slice(0, 2).includes("capture"), ids("capture").join());
});

test("les mots du propriétaire : notif, bilan, jauge, privé, localisation, modèle", () => {
  const notif = ids("notif");
  assert.ok(notif.includes("rituel.matin") && notif.includes("rituel.soir"), notif.join());
  // Sur le site, « Notifications des rappels » (l'app Windows) est le titre qui commence par « notif ».
  assert.equal(notif[0], "ordinateur.rappels");
  assert.equal(ids("bilan")[0], "rituel.soir");
  assert.ok(ids("bilan").includes("rituel.heureSoir"));
  assert.equal(ids("jauge")[0], "diagnostic.jauge");
  assert.equal(ids("privé")[0], "privee");
  assert.ok(ids("privé").includes("secours"), "le secours Claude dit « jamais pour une conversation privée »");
  assert.equal(ids("localisation")[0], "lieux");
  assert.equal(ids("modèle")[0], "modeles");
  assert.equal(ids("modele")[0], "modeles", "sans accent");
  assert.equal(ids("memoire")[0], "memoire", "sans accent : la mémoire");
  assert.equal(ids("nouveautés")[0], "nouveautes");
});

test("les synonymes", () => {
  for (const [q, id] of [["sombre", "apparence"], ["thème", "apparence"], ["dark", "apparence"], ["GPS", "lieux"], ["tok/s", "diagnostic.vitesse"],
    ["lenteur", "diagnostic.temps"], ["coucher", "rituel.soir"], ["deepseek", "modeles"], ["ActivityWatch", "activitePC"], ["prix", "couts"],
    ["déconnexion", "deconnexion"], ["idées", "capture"], ["priorités", "priorites"], ["tutoriel", "nouveautes"], ["bug", "diagnostic"],
    ["code d'erreur", "diagnostic"], ["batterie", "lieux"], ["raccourci", "ordinateur.raccourci"], ["jeton", "jeton"], ["attente", "file"]]) {
    assert.equal(ids(q)[0], id, `« ${q} » : ${ids(q).join(", ")}`);
  }
  assert.deepEqual(new Set(ids("Anthropic").slice(0, 2)), new Set(["secours", "contexte"]));
  assert.deepEqual(new Set(ids("alarme").slice(0, 2)), new Set(["rituel.matin", "rituel.soir"]));
  // Sur l'iPhone, « rappels » mène aux autorisations d'iOS ; ici, aux notifications Windows des rappels.
  assert.equal(ids("rappels")[0], "ordinateur.rappels");
  assert.ok(!ids("rappels").includes("revue.dimanche"));
});

test("les sources des conversations : par leurs synonymes, l'import ChatGPT, et rien sur une tour qui ne les lit pas", () => {
  assert.equal(ids("Claude Code")[0], "sourcesConversations");
  assert.equal(ids("T3")[0], "sourcesConversations");
  assert.equal(ids("t3 code")[0], "sourcesConversations");
  assert.equal(ids("OpenAI")[0], "sourcesConversations");
  assert.deepEqual(new Set(ids("ChatGPT").slice(0, 2)), new Set(["sourcesConversations.import", "sourcesConversations"]));
  assert.equal(ids("import")[0], "sourcesConversations.import");
  assert.equal(ids("importer chatgpt")[0], "sourcesConversations.import");
  assert.ok(ids("import").includes("sourcesConversations"));
  assert.ok(ids("conversations").slice(0, 3).includes("sourcesConversations"), ids("conversations").join());
  assert.equal(ids("effacer chatgpt")[0], "sourcesConversations.effacer");
  assert.equal(ids("Claude")[0], "secours", "« Claude » seul reste d'abord le secours (son titre)");
  assert.equal(R.chemin(entree("sourcesConversations.import")), "Réglages › Sources des conversations");
  assert.deepEqual(R.cible(entree("sourcesConversations.import"), tout()), { section: "conversations", ancre: "Importer un export ChatGPT", note: null });
  assert.equal(R.chemin(entree("sourcesConversations")), "Réglages");
  assert.equal(R.cible(entree("sourcesConversations"), tout()).ancre, null);
  const c = tout();
  c.capacites.delete("conversations-externes-v1");
  const r = R.chercher("ChatGPT", c);
  assert.deepEqual(r.entrees, []);
  assert.ok(r.indisponibles.map((e) => e.id).includes("sourcesConversations"));
  assert.match(r.detailVide, /dépend de ta tour/);
});

test("plusieurs mots, mots vides, ordre des mots", () => {
  assert.equal(ids("heure bilan")[0], "rituel.heureSoir");
  assert.equal(ids("l'heure du bilan")[0], "rituel.heureSoir");
  assert.equal(ids("bilan heure")[0], "rituel.heureSoir", "l'ordre des mots ne compte pas");
  assert.equal(ids("heure du briefing")[0], "rituel.heureMatin");
  assert.equal(ids("effacer lieux")[0], "lieux.effacer");
  assert.equal(ids("pause localisation")[0], "lieux.pause");
  assert.deepEqual(ids("jauge trampoline"), [], "tous les mots doivent se trouver");
});

test("accents, majuscules, espaces", () => {
  assert.equal(ids("  LOCALISATION  ")[0], "lieux");
  assert.equal(ids("revue de la semaine")[0], "revue");
  assert.equal(ids("a trancher")[0], "aTrancher");
  assert.equal(R.normaliser("Œuvre Évite ÀÇ"), "oeuvre evite ac");
  assert.deepEqual(R.mots("tok/s, l'heure"), ["tok", "s", "l", "heure"]);
});

test("le titre passe devant : « diagnostic » montre la section, puis ses réglages", () => {
  const r = ids("diagnostic");
  assert.equal(r[0], "diagnostic");
  assert.ok(r.includes("diagnostic.jauge"), r.join());
  assert.deepEqual(ids("rendez-vous").slice(0, 2).sort(), ["rituel.matin", "rituel.soir"]);
});

test("une faute de frappe : à demi-note, et dit « ce qui s'en approche »", () => {
  const r = R.chercher("notifcations", tout());
  assert.ok(r.approchee);
  assert.ok(r.entrees.map((e) => e.id).includes("rituel.matin"));
  assert.equal(r.enTete, "Rien d'exact pour « notifcations » : ce qui s'en approche");
  assert.equal(ids("localistion")[0], "lieux");
  assert.equal(ids("jaueg")[0], "diagnostic.jauge");
  assert.deepEqual(ids("jzu"), [], "trois lettres : trop court pour deviner");
  assert.equal(R.chercher("jauge", tout()).approchee, false, "exact d'abord");
  // Levenshtein : une faute de 4 à 7 lettres, deux dès 8.
  assert.equal(R.proche("jauj", "jauge"), true);
  assert.equal(R.proche("jzzz", "jauge"), false);
  assert.equal(R.proche("priorietes", "priorites"), true);
  assert.equal(R.distance([..."chat"], [..."chien"], 1), 2);
});

test("rien ne correspond : la phrase, et trois suggestions qui donnent chacune quelque chose", () => {
  const r = R.chercher("trampoline", tout());
  assert.equal(r.vide, false);
  assert.deepEqual(r.entrees, []);
  assert.equal(r.titreVide, "Rien ne correspond à « trampoline ».");
  assert.equal(r.detailVide, "Essaie un autre mot, ou l'un de ceux-ci :");
  assert.equal(r.enTete, null);
  assert.deepEqual(R.SUGGESTIONS, ["Notifications", "Thème", "Modèle"]);
  for (const s of R.SUGGESTIONS) assert.ok(ids(s).length, s);
});

test("une saisie vide ne cherche rien ; l'en-tête compte les réglages", () => {
  for (const q of ["", "   ", "\n"]) {
    const r = R.chercher(q, tout());
    assert.equal(r.vide, true, `« ${q} »`);
    assert.deepEqual(r.entrees, []);
    assert.equal(r.titreVide, null);
    assert.equal(r.enTete, null);
  }
  assert.equal(R.chercher("deepseek", tout()).enTete, "1 réglage");
  assert.equal(R.chercher("jauge", tout()).enTete, `${ids("jauge").length} réglages`);
});

test("ce que la tour ne propose pas n'est pas proposé ; l'état vide dit pourquoi", () => {
  const c = tout();
  c.capacites.delete("lieux-v1");
  const r = R.chercher("localisation", c);
  assert.ok(!r.entrees.map((e) => e.id).includes("lieux"));
  assert.ok(r.indisponibles.map((e) => e.id).includes("lieux"));
  assert.equal(r.detailVide, "« Localisation » dépend de ta tour, qui ne le propose pas pour l'instant (mise à jour de la tour, ou réglages pas encore relus).");
  // Réglages de la tour pas encore relus : la recherche web attend.
  c.reglages = null;
  const web = R.chercher("duckduckgo", c);
  assert.deepEqual(web.entrees, []);
  assert.deepEqual(web.indisponibles.map((e) => e.id), ["web"]);
  assert.equal(web.titreVide, "Rien ne correspond à « duckduckgo ».");
  assert.match(web.detailVide, /« Recherche web » dépend de ta tour/);
  // Une tour sans rien : la jauge et l'apparence restent.
  assert.equal(ids("jauge", {})[0], "diagnostic.jauge");
  assert.equal(ids("sombre", {})[0], "apparence");
  assert.ok(!ids("notif", {}).includes("rituel.matin"));
});

test("les conditions des réglages de la tour", () => {
  const c = tout();
  c.reglages = { ...c.reglages, rechercheLocale: "duckduckgo" };
  assert.equal(R.permet("contexteCloud", c), false, "recherche locale : l'envoi de contexte n'a plus d'objet");
  assert.equal(R.permet("rechercheWeb", c), true);
  assert.equal(R.moteur(c.reglages), "DuckDuckGo");
  assert.equal(R.moteur({ rechercheLocale: " searxng " }), "SearXNG");
  assert.equal(R.moteur({ rechercheLocale: "  " }), null);
  c.reglages = { ...c.reglages, secoursCloudSansObjet: true };
  assert.equal(R.permet("secours", c), false, "pas de modèle local : le secours n'a pas d'objet");
  assert.equal(R.permet("circuit:inconnu", c), false);
  assert.equal(R.permet("circuit:nuit", c), true);
  c.capacites.delete("recherche-privee-v1");
  assert.equal(R.permet("recherchePrivee", c), false);
  assert.equal(R.permet("iphone", c), false);
});

test("où mène un résultat, et le repli quand la ligne n'est pas affichée", () => {
  assert.deepEqual(R.cible(entree("rituel.heureSoir"), tout()), { section: "ordinateur", ancre: "Heure du bilan", note: null });
  const c = tout();
  c.bilan = false;
  assert.deepEqual(R.cible(entree("rituel.heureSoir"), c), { section: "ordinateur", ancre: "Bilan du soir", note: "Allume d'abord « Bilan du soir » : l'heure s'affiche dessous." });
  // Dans un navigateur : l'app Windows d'abord.
  c.bureau = false;
  assert.equal(R.cible(entree("rituel.heureSoir"), c).ancre, "Ordinateur");
  assert.match(R.cible(entree("rituel.heureSoir"), c).note, /app Rémy pour Windows/);
  // La pause de la localisation se met depuis l'iPhone : on arrive sur la localisation, et c'est dit.
  assert.deepEqual(R.cible(entree("lieux.pause"), tout()), { section: "lieux", ancre: "Localisation", note: "La pause se met depuis l'iPhone : ici, la localisation se lit et se range." });
  assert.deepEqual(R.cible(R.premier("jauge", tout()), tout()), { section: "diagnostic", ancre: "Jauge du contexte", note: null });
});

test("les chemins", () => {
  assert.equal(R.chemin(entree("diagnostic.jauge")), "Réglages › Diagnostic");
  assert.equal(R.chemin(entree("rituel.heureSoir")), "Réglages › Ordinateur");
  assert.equal(R.chemin(entree("modeles")), "Réglages");
  assert.equal(R.chemin(entree("lieux.pause")), "Réglages › Localisation");
  assert.equal(R.chemin(entree("activitePC.exclure")), "Réglages › Activité du PC");
});

test("l'index et l'écran s'accordent : chaque ancre est repérée dans vues/reglages.js", () => {
  const vue = fs.readFileSync(new URL("../public/app/vues/reglages.js", import.meta.url), "utf8");
  for (const e of R.INDEX) {
    // Les sources des conversations sont dessinées par leur propre module (lot conversations).
    if (e.section === "conversations") continue;
    // Une ligne qui n'existe que sur l'iPhone (la pause de la localisation) mène toujours à son repli.
    const surIphone = e.repli.some((r) => r.condition === "iphone");
    for (const a of [surIphone ? null : e.ancre, ...e.repli.map((r) => r.ancre)].filter(Boolean)) {
      // Une ligne se repère par repere("…"), ou par le titre d'une brique qui la repère d'office.
      const formes = ["repere(", "bascule(", "ligne(", "choixHeure(", "["].map((f) => `${f}"${a}"`);
      assert.ok(formes.some((f) => vue.includes(f)), `« ${a} » (${e.id}) n'est pas repéré dans reglages.js`);
    }
  }
  // Et la palette classe le groupe Réglages avec la même recherche.
  const palette = fs.readFileSync(new URL("../public/app/palette.js", import.meta.url), "utf8");
  assert.match(palette, /indexVisible|rechercherReglages/);
});
