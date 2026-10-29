// L'aperçu de « Noter » du site (public/app/analyse/) : le port JS de
// `AnalyseDate` (Dates.swift) et de `GenreCapture` (Accueil.swift), vérifié
// avec LES MÊMES PHRASES que les tests Swift de l'iPhone (CarnetTests,
// AccueilTests, OrganisationTests, RituelTests), transcrites une à une. Si une
// règle change d'un côté, ce test le dit avant que l'ordinateur et l'iPhone ne
// lisent la même phrase différemment.
//
// L'heure de référence est celle des tests Swift : jeudi 15 octobre 2026,
// 10:40 à Paris. Le module suit l'heure de la machine : on la fixe ici.
process.env.TZ = "Europe/Paris";
import test from "node:test";
import assert from "node:assert/strict";
import { extraire, sansFormule } from "../public/app/analyse/dates.js";
import { deviner, texte, articles, plusieursIntentions, projet, apercu } from "../public/app/analyse/genre.js";

const date = (j, m, h, mi = 0, an = 2026) => new Date(an, m - 1, j, h, mi, 0, 0);
const le = date;
const maintenant = date(15, 10, 10, 40);
const analyse = (t) => extraire(t, maintenant);
const plus = (d, s) => new Date(d.getTime() + s * 1000);
const tache = (t, quand) => {
  const d = extraire(t, quand);
  return { titre: texte(t, d, "tache"), echeance: d?.echeance };
};
/** `AnalyseDate.Resultat(quand:reste:heureDite:)` et ses valeurs par défaut. */
const R = ({ quand, reste, heureDite = true }) => ({
  quand, reste, heureDite,
  echeance: heureDite ? quand : new Date(quand.getFullYear(), quand.getMonth(), quand.getDate(), 23, 0),
  dejaPassee: null, limite: false,
});
const valeur = (v) => (v instanceof Date ? v.toISOString() : v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valeur(x)])) : v);
const eq = (a, b, msg) => assert.deepEqual(valeur(a) ?? null, valeur(b) ?? null, msg);
const nul = (a, msg) => assert.equal(a ?? null, null, msg);
const pasNul = (a, msg) => assert.notEqual(a ?? null, null, msg);
const vrai = (a, msg) => assert.equal(a, true, msg);
const faux = (a, msg) => assert.equal(a, false, msg);

// --- CarnetTests.swift (dates, échéances, genres) ---

// MARK: Dates

test("testDemainAHeure", () => {
    eq(analyse("Appeler le garage demain à 9h"), R({ quand: date(16, 10, 9, 0), reste: "Appeler le garage" }));
});

test("testJourDeLaSemaineEtMinutes", () => {
    eq(analyse("Rdv dentiste lundi 9h30"), R({ quand: date(19, 10, 9, 30), reste: "Rdv dentiste" }));
    eq(analyse("Point d'équipe jeudi 18h")?.quand, date(15, 10, 18, 0), "jeudi, un jeudi matin : aujourd'hui");
    eq(analyse("Courir jeudi 8h")?.quand, date(22, 10, 8, 0), "l'heure est passée : la semaine prochaine");
    eq(analyse("Bilan jeudi prochain")?.quand, date(22, 10, 9, 0));
});

test("testDatesEnChiffresEtEnLettres", () => {
    eq(analyse("Payer la cantine le 12/11"), R({ quand: date(12, 11, 9, 0), reste: "Payer la cantine", heureDite: false }));
    eq(analyse("Anniversaire de Nina le 3 février")?.quand, date(3, 2, 9, 0, 2027), "déjà passé cette année");
    eq(analyse("Anniversaire de Nina le 3 février")?.reste, "Anniversaire de Nina");
});

test("testHeureSeuleEtRelatif", () => {
    eq(analyse("Sortir les poubelles à 8h")?.quand, date(16, 10, 8, 0), "8h est passé : demain");
    eq(analyse("Appeler maman à 18:30")?.quand, date(15, 10, 18, 30));
    eq(analyse("Appeler maman ce soir")?.quand, date(15, 10, 20, 0));
    const r = analyse("Rappelle-moi dans 20 min de sortir le linge");
    eq(r?.quand, plus(maintenant, 1200));
    eq(r?.reste, "Sortir le linge");
});

// Sam, TestFlight 13 : « rappelle moi d'aller sur l'ordi à 13h59 »
// donnait le rappel « rappelle moi d'aller sur l'ordi ».
test("testLaFormuleDeDemandeNEstPasLeRappel", () => {
    eq(analyse("rappelle moi d'aller sur l'ordi à 13h59")?.reste, "Aller sur l'ordi");
    eq(analyse("Rappelle-moi demain d'appeler Hugo")?.reste, "Appeler Hugo");
    eq(analyse("n'oublie pas de payer la cantine lundi")?.reste, "Payer la cantine");
    eq(analyse("il faut que j'appelle le garage demain")?.reste, "Appelle le garage");
    eq(analyse("tu peux me rappeler de sortir les poubelles ce soir")?.reste, "Sortir les poubelles");
    eq(sansFormule("rappelle-moi que le loyer tombe le 5"), "Le loyer tombe le 5");
    eq(sansFormule("Rappeler Hugo"), "Rappeler Hugo", "un vrai verbe reste");
    eq(sansFormule("Pense à prendre le chargeur"), "Prendre le chargeur");
    eq(deviner("rappelle-moi de racheter du café", undefined), "rappel");
});

// Parcours P07 : un jour sans heure n'est pas un créneau. Pour une tâche,
// c'est une échéance, en fin de journée ; l'heure dite reste l'heure.
test("testUnJourSansHeureEstUneEcheance", () => {
    const r = analyse("Envoyer le devis à Hugo vendredi");
    eq(r?.heureDite, false);
    eq(r?.reste, "Envoyer le devis à Hugo");
    eq(r?.echeance, date(16, 10, 23, 0), "vendredi, fin de journée");
    eq(analyse("Appeler le garage demain à 9h")?.heureDite, true);
    eq(analyse("Appeler le garage demain à 9h")?.echeance, date(16, 10, 9, 0));
    eq(analyse("Appeler maman ce soir")?.heureDite, true);
    eq(analyse("Rappelle-moi dans 20 min de sortir le linge")?.heureDite, true);
    eq(analyse("Relancer Léa dans 3 jours")?.heureDite, false);
    eq(analyse("Relancer Léa dans 3 jours")?.echeance, date(18, 10, 23, 0));
    eq(analyse("Payer la cantine le 12/11")?.echeance, date(12, 11, 23, 0));
    // Le lien vers la date part avec elle.
    eq(analyse("Préparer la facture avant vendredi")?.reste, "Préparer la facture");
    eq(analyse("Rendre le dossier d'ici lundi")?.reste, "Rendre le dossier");
});

// Contre-relecture : « vendredi » dit un vendredi après 9 h glissait
// d'une semaine (le 9 h posé pour un rappel). Une échéance part du jour
// dit et ne recule que si ce jour est fini.
test("testLeJourMemeLEcheanceEstCeSoir", () => {
    const vendredi10h = date(16, 10, 10, 0);
    const r = extraire("Envoyer le devis vendredi", vendredi10h);
    eq(r?.echeance, date(16, 10, 23, 0), "ce soir, pas dans une semaine");
    eq(r?.quand, date(23, 10, 9, 0), "un rappel sans heure garde la semaine suivante");
    eq(extraire("Commander les bougies vendredi", date(16, 10, 17, 0))?.echeance, date(16, 10, 23, 0));
    eq(extraire("Envoyer le devis vendredi", date(16, 10, 23, 30))?.echeance, date(23, 10, 23, 0), "ce vendredi est fini : le suivant");
    eq(extraire("Envoyer le devis aujourd'hui", date(16, 10, 23, 30))?.echeance, date(16, 10, 23, 59), "aujourd'hui, tard : jusqu'à minuit, pas une échéance passée");
});

// Contre-relecture : des heures et des moments mal lus.
test("testHeuresEtMomentsDuJour", () => {
    const quatorze = analyse("Appeler le garage demain à 14 heures");
    eq(quatorze?.quand, date(16, 10, 14, 0));
    eq(quatorze?.heureDite, true);
    eq(quatorze?.reste, "Appeler le garage");
    eq(analyse("Appeler le garage demain vers 9 heures 30")?.quand, date(16, 10, 9, 30));
    // Une durée n'est pas une heure.
    nul(analyse("Faire 2h de studio"));
    eq(analyse("Faire 2h de studio jeudi")?.heureDite, false);
    eq(analyse("Faire 2h de studio jeudi")?.reste, "Faire 2h de studio");
    eq(analyse("Préparer la réunion de 14h")?.quand, date(15, 10, 14, 0), "« de 14h » : une heure");
    // Le moment d'un jour dit.
    const soir = analyse("Rappelle-moi de sortir les poubelles demain soir");
    eq(soir?.quand, date(16, 10, 20, 0));
    eq(soir?.reste, "Sortir les poubelles");
    const aprem = analyse("Appeler le garage lundi après-midi");
    eq(aprem?.quand, date(19, 10, 14, 0));
    eq(aprem?.reste, "Appeler le garage");
    eq(analyse("Appeler le garage demain matin")?.quand, date(16, 10, 9, 0));
    eq(analyse("Appeler le garage demain à 3h de l'après-midi")?.quand, date(16, 10, 15, 0));
    eq(analyse("Appeler le garage demain à 3h de l'après-midi")?.reste, "Appeler le garage");
    eq(analyse("Dîner chez Léa demain soir à 8h")?.quand, date(16, 10, 20, 0), "le soir : 20 h");
    nul(analyse("Lire au calme l'après-midi"), "« après-midi » seul n'est pas midi");
    nul(analyse("Lire au calme l'après midi"), "ni sans trait d'union");
    // « a » sans accent, comme on le tape vite : une heure, sauf devant une durée.
    eq(analyse("Appeler le garage demain a 14h")?.quand, date(16, 10, 14, 0));
    eq(analyse("Appeler le garage demain a 14h")?.reste, "Appeler le garage");
    nul(analyse("Hugo a 2h de route"), "« a 2h de route » : une durée");
    nul(analyse("Léa a 3 heures de retard"));
    eq(analyse("Appeler le garage demain a 3h de l'après-midi")?.quand, date(16, 10, 15, 0));
    // « dans 1h30 », « dans une heure », « dans 2 semaines ».
    const linge = analyse("Rappelle-moi dans 1h30 de sortir le linge");
    eq(linge?.quand, plus(maintenant, 5400));
    eq(linge?.reste, "Sortir le linge");
    eq(analyse("Rappelle-moi dans une heure d'appeler Léa")?.quand, plus(maintenant, 3600));
    eq(analyse("Relancer Hugo dans 2 semaines")?.echeance, date(29, 10, 23, 0));
    eq(analyse("Relancer Léa dans une semaine")?.heureDite, false);
    // « dans 3 jours à 14h » : l'heure dite compte.
    const lea = analyse("Appeler Léa dans 3 jours à 14h");
    eq(lea?.quand, date(18, 10, 14, 0));
    eq(lea?.heureDite, true);
    eq(deviner("Appeler Léa dans 3 jours à 14h", maintenant), "rappel");
});

test("testDatesAbregeesEtJourAvecSaDate", () => {
    eq(analyse("Envoyer le devis le 30 oct")?.quand, date(30, 10, 9, 0));
    eq(analyse("Envoyer le devis le 30 oct.")?.reste, "Envoyer le devis");
    eq(analyse("Payer le loyer le 1er nov")?.quand, date(1, 11, 9, 0));
    const lundi = analyse("Rendre le devis lundi 2 novembre");
    eq(lundi?.quand, date(2, 11, 9, 0));
    eq(lundi?.reste, "Rendre le devis");
    eq(analyse("Envoyer le devis vendredi.")?.reste, "Envoyer le devis", "le point final ne reste pas seul");
    eq(sansFormule("Rappelle moi d appeler maman"), "Appeler maman", "dictée sans apostrophe");
    eq(sansFormule("N'oublie pas d envoyer le devis"), "Envoyer le devis");
});

// MARK: Échéances larges (décisions du 25/10)

// « cette semaine » va jusqu'au dimanche, 23 h ; « la semaine prochaine »
// au dimanche suivant. Jeudi 15 octobre → dimanche 18, puis 25.
test("testCetteSemaineVaJusquAuDimanche", () => {
    for (const p of ["Envoyer le devis cette semaine", "Envoyer le devis avant la fin de la semaine", "Envoyer le devis d'ici la fin de la semaine", "Envoyer le devis dans la semaine", "Envoyer le devis d’ici la fin de la semaine", "Envoyer le devis en fin de semaine"]) {
        const r = analyse(p);
        eq(r?.echeance, date(18, 10, 23, 0), p);
        eq(r?.heureDite, false, p);
        eq(r?.reste, "Envoyer le devis", p);
        eq(deviner(p, maintenant), "tache", p);
        eq(texte(p, r, "tache"), "Envoyer le devis", p);
    }
    for (const p of ["Relancer Hugo la semaine prochaine", "Relancer Hugo avant la fin de la semaine prochaine", "Relancer Hugo semaine prochaine"]) {
        eq(analyse(p)?.echeance, date(25, 10, 23, 0), p);
        eq(analyse(p)?.reste, "Relancer Hugo", p);
    }
    const enTete = "Dans la semaine, appeler le plombier";
    eq(texte(enTete, analyse(enTete), "tache"), "Appeler le plombier");
    eq(analyse(enTete)?.echeance, date(18, 10, 23, 0));
    // Un jour dit en plus est plus précis : il l'emporte (plus tôt, jamais raté).
    eq(analyse("Appeler Hugo samedi cette semaine")?.echeance, date(17, 10, 23, 0));
    eq(analyse("Appeler Hugo lundi de la semaine prochaine")?.echeance, date(19, 10, 23, 0));
});

// Le jour même et les bords : le dimanche, « cette semaine » c'est ce
// soir (23 h 59 passé 23 h) ; le lundi, la semaine recommence.
test("testCetteSemaineLeDimancheEtLeLundi", () => {
    const dimanche10h = date(18, 10, 10, 0);
    eq(extraire("Finir le site cette semaine", dimanche10h)?.echeance, date(18, 10, 23, 0));
    eq(extraire("Finir le site cette semaine", date(18, 10, 23, 30))?.echeance, date(18, 10, 23, 59), "dimanche soir tard : jusqu'à minuit, jamais une échéance passée");
    eq(extraire("Finir le site la semaine prochaine", dimanche10h)?.echeance, date(25, 10, 23, 0));
    eq(extraire("Finir le site cette semaine", date(19, 10, 8, 0))?.echeance, date(25, 10, 23, 0), "lundi : le dimanche qui vient");
    eq(extraire("Finir le site la semaine prochaine", date(19, 10, 8, 0))?.echeance, date(1, 11, 23, 0));
    // Une fin d'année au milieu de la semaine.
    eq(extraire("Finir le site cette semaine", date(30, 12, 9, 0))?.echeance, date(3, 1, 23, 0, 2027));
});

// « fin octobre », « fin du mois » : le dernier jour du mois, 23 h ; un
// mois passé, l'année suivante.
test("testFinDuMoisEtFinOctobre", () => {
    for (const p of ["Payer les impôts fin octobre", "Payer les impôts fin du mois", "Payer les impôts avant la fin du mois", "Payer les impôts d'ici fin octobre", "Payer les impôts pour la fin du mois", "Payer les impôts fin oct.", "Payer les impôts à la fin du mois", "Payer les impôts fin d'octobre"]) {
        const r = analyse(p);
        eq(r?.echeance, date(31, 10, 23, 0), p);
        eq(r?.heureDite, false, p);
        eq(r?.reste, "Payer les impôts", p);
        eq(deviner(p, maintenant), "tache", p);
    }
    eq(analyse("Payer les impôts fin novembre")?.echeance, date(30, 11, 23, 0));
    eq(analyse("Payer les impôts fin du mois prochain")?.echeance, date(30, 11, 23, 0));
    eq(analyse("Payer les impôts fin février")?.echeance, date(28, 2, 23, 0, 2027), "février 2027 : 28 jours");
    eq(analyse("Payer les impôts fin septembre")?.echeance, date(15, 10, 23, 0), "passée depuis 15 jours : ce soir");
    eq(analyse("Payer les impôts fin août")?.echeance, date(31, 8, 23, 0, 2027), "passée depuis plus de 31 jours : l'an prochain");
    eq(analyse("Payer les impôts fin décembre 2027")?.echeance, date(31, 12, 23, 0, 2027));
    eq(extraire("Payer les impôts fin octobre", date(31, 10, 23, 30))?.echeance, date(31, 10, 23, 59), "le dernier soir, tard : jusqu'à minuit");
    eq(extraire("Payer les impôts fin du mois", date(15, 2, 9, 0, 2028))?.echeance, date(29, 2, 23, 0, 2028), "année bissextile");
    eq(extraire("Payer les impôts fin du mois prochain", date(10, 12, 9, 0))?.echeance, date(31, 1, 23, 0, 2027));
});

// « avant le 3 » : la veille, 23 h 59 (« avant » est strict, 27/10 : une
// seule règle, jusqu'à la fin de la veille) ; « pour le 3 », « d'ici le
// 3 », « le 3 » : le 3, 23 h. Sans mois : le prochain 3.
test("testAvantLe3EstLaVeille", () => {
    eq(analyse("Envoyer le devis avant le 3")?.echeance, date(2, 11, 23, 59), "le prochain 3 : novembre");
    eq(analyse("Envoyer le devis avant le 3")?.reste, "Envoyer le devis");
    eq(analyse("Envoyer le devis avant le 3 novembre")?.echeance, date(2, 11, 23, 59));
    eq(analyse("Envoyer le devis avant le 3/11")?.echeance, date(2, 11, 23, 59));
    eq(analyse("Envoyer le devis avant le 1er novembre")?.echeance, date(31, 10, 23, 59), "la veille change de mois");
    eq(analyse("Envoyer le devis avant le 1er")?.echeance, date(31, 10, 23, 59));
    eq(analyse("Envoyer le devis avant le 1er janvier")?.echeance, date(31, 12, 23, 59), "et d'année");
    for (const p of ["Envoyer le devis pour le 3", "Envoyer le devis d'ici le 3", "Envoyer le devis le 3", "Envoyer le devis jusqu'au 3", "Envoyer le devis pour le 3 novembre", "Envoyer le devis d'ici le 3 novembre"]) {
        eq(analyse(p)?.echeance, date(3, 11, 23, 0), p);
        eq(analyse(p)?.reste, "Envoyer le devis", p);
        eq(deviner(p, maintenant), "tache", p);
    }
    eq(analyse("Payer le loyer le 20")?.echeance, date(20, 10, 23, 0), "pas encore passé ce mois-ci");
    eq(analyse("Payer le loyer le 15")?.echeance, date(15, 10, 23, 0), "le jour même : ce soir");
    eq(analyse("Payer le loyer avant le 16")?.echeance, date(15, 10, 23, 59), "la veille, c'est ce soir");
    eq(analyse("Payer le loyer avant le 15")?.echeance, date(15, 10, 23, 59), "la veille est passée : ce soir, jamais une date passée");
    eq(analyse("Payer le loyer avant le 31")?.echeance, date(30, 10, 23, 59));
    eq(extraire("Payer le loyer le 31", date(5, 11, 9, 0))?.echeance, date(31, 12, 23, 0), "novembre n'a pas de 31 : décembre");
    eq(extraire("Payer le loyer le 3", date(3, 11, 23, 30))?.echeance, date(3, 11, 23, 59));
    // En tête de phrase : le titre reste propre.
    const enTete = "Avant le 3 novembre, envoyer le devis";
    eq(texte(enTete, analyse(enTete), "tache"), "Envoyer le devis");
    eq(analyse(enTete)?.echeance, date(2, 11, 23, 59));
    // Un rappel « avant le 3 » sonne la veille.
    eq(analyse("Rappelle-moi avant le 3 d'appeler Hugo")?.quand, date(2, 11, 9, 0));
    eq(analyse("Rappelle-moi avant le 3 d'appeler Hugo")?.reste, "Appeler Hugo");
    // « le 3 » avec une heure : un rappel ce jour-là.
    eq(analyse("Appeler Hugo le 3 à 14h")?.quand, date(3, 11, 14, 0));
    eq(analyse("Appeler Hugo le 3 à 14h")?.heureDite, true);
});

// Les flous restent dans le titre, sans échéance : jamais une date
// arbitraire. Et un nombre après « le » n'est pas toujours un jour.
test("testLesFlousNeDeviennentPasDesDates", () => {
    for (const p of ["Préparer Noël mi-novembre", "Préparer Noël en novembre", "Préparer Noël mi novembre", "Préparer Noël milieu novembre", "Préparer Noël courant novembre", "Préparer le menu de la semaine", "Visiter le 2 pièces rue Haute", "Lire le 3e chapitre", "Appeler le 06 12 34 56 78", "Relire le 2 du dossier Hugo", "Monter le 3 h de vidéo", "Le 12 est mon numéro préféré", "Préparer la fin du film"]) {
        nul(analyse(p), p);
    }
    eq(texte("Préparer Noël mi-novembre", analyse("Préparer Noël mi-novembre"), "tache"), "Préparer Noël mi-novembre");
    eq(texte("Préparer Noël courant novembre", analyse("Préparer Noël courant novembre"), "tache"), "Préparer Noël courant novembre");
    eq(deviner("Préparer Noël mi-novembre", maintenant), "tache");
    // Une date au milieu reste dans le titre (règle du 25/10), l'échéance part quand même.
    const milieu = "Payer la facture de fin octobre à Hugo";
    eq(texte(milieu, analyse(milieu), "tache"), milieu);
    eq(analyse(milieu)?.echeance, date(31, 10, 23, 0));
    // « Avant vendredi, … » : le lien en tête part avec la date.
    eq(analyse("Avant vendredi, envoyer le devis")?.reste, "Envoyer le devis");
});

// MARK: Contre-relecture des échéances (25/10)


// Whisper ponctue : « avant le 3. », « Avant le 3, payer… » restent des
// dates (constat bloquant). « le 3.2 du manuel » n'en est pas une.
test("testUnePonctuationApresLeNumeroGardeLaDate", () => {
    eq(analyse("Payer la facture avant le 3.")?.echeance, date(2, 11, 23, 59));
    eq(analyse("Payer la facture avant le 3.")?.reste, "Payer la facture");
    eq(analyse("Payer la facture pour le 3.")?.echeance, date(3, 11, 23, 0));
    eq(analyse("Payer la facture le 3.")?.echeance, date(3, 11, 23, 0));
    eq(analyse("Payer la facture avant le 3, sinon pénalité")?.echeance, date(2, 11, 23, 59));
    for (const [p, e] of [["Avant le 3, payer la facture", date(2, 11, 23, 59)], ["Le 3, payer la facture", date(3, 11, 23, 0)], ["Pour le 3. Payer la facture", date(3, 11, 23, 0)]]) {
        eq(deviner(p, maintenant), "tache", p);
        eq(tache(p, maintenant).titre, "Payer la facture", p);
        eq(tache(p, maintenant).echeance, e, p);
    }
    nul(analyse("Lire le 3.2 du manuel"));
    nul(analyse("Lire le 3,5 du manuel"));
});

// « vendredi de la semaine prochaine » : après le lundi qui vient, dit un
// lundi comme un jeudi. Les mots partent avec la date.
test("testUnJourDeLaSemaineProchaine", () => {
    const lundi = date(26, 10, 8, 0);
    eq(tache("Finir le site vendredi de la semaine prochaine", lundi).echeance, date(6, 11, 23, 0));
    eq(tache("Finir le site vendredi de la semaine prochaine", lundi).titre, "Finir le site");
    eq(tache("Finir le site mardi de la semaine prochaine", lundi).echeance, date(3, 11, 23, 0), "pas demain");
    eq(tache("Finir le site vendredi la semaine prochaine", lundi).echeance, date(6, 11, 23, 0));
    eq(tache("Finir le site vendredi de la semaine prochaine", maintenant).echeance, date(23, 10, 23, 0));
    eq(tache("Finir le site jeudi de la semaine prochaine", maintenant).echeance, date(22, 10, 23, 0), "dit un jeudi");
    eq(tache("Appeler Hugo samedi cette semaine", maintenant).titre, "Appeler Hugo");
    eq(tache("Appeler Hugo samedi cette semaine", maintenant).echeance, date(17, 10, 23, 0));
});

// « début / milieu / mi- (de la) semaine prochaine » : des flous, pas le
// dimanche (il tomberait après la période voulue). Le titre reste entier.
test("testLesFlousDeLaSemaineProchaine", () => {
    const lundi = date(26, 10, 8, 0);
    for (const p of ["Rendre le dossier au début de la semaine prochaine", "Rendre le dossier en début de semaine prochaine", "Rendre le dossier milieu de la semaine prochaine", "Rendre le dossier en milieu de semaine prochaine", "Rendre le dossier mi-semaine prochaine", "Rendre le dossier courant de la semaine prochaine", "Rendre le dossier en début de semaine"]) {
        nul(extraire(p, lundi), p);
        eq(tache(p, lundi).titre, p);
    }
});

// « le 20 du mois prochain » : le 20 du mois qui suit, même s'il reste
// un 20 ce mois-ci ; les mots partent avec la date.
test("testLeNumeroDuMoisProchain", () => {
    eq(analyse("Payer la facture pour le 20 du mois prochain")?.echeance, date(20, 11, 23, 0));
    eq(analyse("Payer la facture pour le 20 du mois prochain")?.reste, "Payer la facture");
    eq(analyse("Payer la facture le 20 du mois prochain")?.echeance, date(20, 11, 23, 0));
    eq(extraire("Payer la facture avant le 3 du mois prochain", date(1, 10, 9, 0))?.echeance, date(2, 11, 23, 59));
    eq(extraire("Payer la facture le 31 du mois prochain", date(1, 10, 9, 0))?.echeance, date(31, 12, 23, 0), "novembre n'a pas de 31 : le suivant qui en a un");
    nul(analyse("Payer le loyer le 5 du mois"), "chaque mois : pas une date");
});

// « avant le 3 » + une heure ou un moment : l'heure dite fixe la borne,
// le 3 ; la veille stricte ne joue que pour un jour sans heure.
test("testAvantLe3AvecUneHeure", () => {
    eq(analyse("Payer la facture avant le 3 à 14h")?.quand, date(3, 11, 14, 0));
    eq(analyse("Rendre le dossier avant le 3 novembre à midi")?.quand, date(3, 11, 12, 0));
    eq(analyse("Rendre le dossier avant le 3/11 a 18h")?.quand, date(3, 11, 18, 0));
    eq(analyse("Payer la facture avant le 3 au soir")?.quand, date(3, 11, 20, 0));
    eq(analyse("Payer la facture avant le 3")?.echeance, date(2, 11, 23, 59), "sans heure : toujours la veille");
});

// L'aperçu montre l'année quand ce n'est pas celle-ci : « fin août » dit
// le 1er novembre vise 2027 (passée depuis plus de 31 jours ⇒ année suivante).
test("testLAnneeSeVoitQuandElleChange", () => {
    const premierNovembre = date(1, 11, 10, 0);
    const e = extraire("Rendre le dossier fin août", premierNovembre)?.echeance;
    eq(e, date(31, 8, 23, 0, 2027));
    // (non porté : l'aperçu en toutes lettres est propre à l'iPhone)
    // (non porté : l'aperçu en toutes lettres est propre à l'iPhone)
    // (non porté : l'aperçu en toutes lettres est propre à l'iPhone)
    const q = extraire("Rappelle-moi de rendre le dossier fin août", premierNovembre)?.quand;
    eq(q, date(31, 8, 9, 0, 2027));
    // (non porté : l'aperçu en toutes lettres est propre à l'iPhone)
    // (non porté : l'aperçu en toutes lettres est propre à l'iPhone)
});

// Non-régression de #16 : un « Avant » en tête qui ne mène pas à la date
// reste ; celui qui y mène part avec elle.
test("testAvantEnTeteNePartQuAvecSaDate", () => {
    for (const [p, reste] of [["Avant la réunion, relire le dossier demain", "Avant la réunion, relire le dossier"], ["Avant les vacances, réserver l'hôtel lundi", "Avant les vacances, réserver l'hôtel"], ["Avant de partir, fermer le gaz demain", "Avant de partir, fermer le gaz"], ["D'ici là, finir le site vendredi", "D'ici là, finir le site"]]) {
        eq(analyse(p)?.reste, reste, p);
        eq(tache(p, maintenant).titre, reste, p);
    }
    for (const p of ["Avant vendredi, envoyer le devis", "D'ici demain, envoyer le devis", "Envoyer le devis avant vendredi", "Envoyer le devis d'ici demain", "Envoyer le devis au plus tard vendredi"]) {
        eq(analyse(p)?.reste, "Envoyer le devis", p);
    }
});

// Le texte d'un rappel (feuille « Nouveau rappel » comme « + ») ne perd
// jamais un morceau du milieu de sa phrase.
test("testLeTexteDUnRappelResteEntier", () => {
    for (const p of ["Payer la facture de fin octobre à Hugo", "Préparer la réunion de la semaine prochaine avec Hugo", "Relire le bilan de la fin du mois"]) {
        eq(texte(p, analyse(p), "rappel"), p, p);
    }
});

// La dictée perd l'apostrophe : « d ici », « jusqu a » mènent quand même à
// la date, et ne restent pas au bout du titre.
test("testSansApostrophe", () => {
    for (const [p, titre, e] of [["Rendre le dossier d ici fin octobre", "Rendre le dossier", date(31, 10, 23, 0)], ["rendre le dossier d ici la fin du mois", "Rendre le dossier", date(31, 10, 23, 0)], ["finir le site d ici la fin de la semaine", "Finir le site", date(18, 10, 23, 0)], ["Payer la facture d ici le 3", "Payer la facture", date(3, 11, 23, 0)], ["Rendre le dossier jusqu a la fin du mois", "Rendre le dossier", date(31, 10, 23, 0)], ["payer la facture jusqu au 3", "Payer la facture", date(3, 11, 23, 0)], ["Rendre le dossier au plus tard la semaine prochaine", "Rendre le dossier", date(25, 10, 23, 0)], ["Envoyer le devis d ici vendredi", "Envoyer le devis", date(16, 10, 23, 0)]]) {
        eq(tache(p, maintenant).titre, titre, p);
        eq(tache(p, maintenant).echeance, e, p);
    }
});

// Un rappel sans heure qui tombe aujourd'hui, 9 h passé : il sonne à la
// prochaine heure pleine, jamais dans le passé. L'échéance d'une tâche
// reste la fin du jour.
test("testUnRappelDuJourNeSonneJamaisDansLePasse", () => {
    for (const [p, dit, jour] of [["Rappelle-moi de payer la facture avant le 3", date(2, 11, 10, 0), date(2, 11, 11, 0)], ["Rappelle-moi de rendre le dossier fin octobre", date(31, 10, 10, 0), date(31, 10, 11, 0)], ["Rappelle-moi cette semaine d'appeler Hugo", date(25, 10, 10, 20), date(25, 10, 11, 0)], ["Rappelle-moi avant le 3 d'appeler Hugo", date(3, 11, 10, 0), date(3, 11, 11, 0)], ["Rappelle-moi aujourd'hui d'appeler Hugo", date(15, 10, 10, 40), date(15, 10, 11, 0)]]) {
        const r = extraire(p, dit);
        eq(r?.quand, jour, p);
        eq(r?.heureDite, false, p);
        vrai((r?.quand ?? new Date(0)) > dit, p);
    }
    eq(extraire("Payer la facture avant le 3", date(2, 11, 10, 0))?.echeance, date(2, 11, 23, 59));
    const tard = date(15, 10, 23, 30);
    eq(extraire("Rappelle-moi aujourd'hui d'appeler Hugo", tard)?.quand, plus(tard, 600));
    eq(analyse("Rappelle-moi demain d'appeler Hugo")?.quand, date(16, 10, 9, 0), "un autre jour : 9 h, comme avant");
});

// Un nombre qui n'est pas un jour : l'objet d'un verbe seul, une course,
// un « 5 à 7 ».
test("testUnNombreQuiNEstPasUnJour", () => {
    for (const p of ["Appeler le 15", "S'inscrire pour le 10 km", "Acheter du vin pour le 5 a 7", "Réserver pour le 4 personnes"]) {
        nul(analyse(p), p);
    }
    eq(analyse("Appeler Hugo le 3 à 14h")?.quand, date(3, 11, 14, 0), "une heure, elle, reste une heure");
    eq(analyse("Appeler le garage le 15")?.echeance, date(15, 10, 23, 0));
});

// « le 3 » au milieu d'une phrase naturelle : devant un moment, ou après
// « rappelle-moi ».
test("testLe3AuMilieuDUnePhrase", () => {
    eq(analyse("Rappelle-moi le 3 d'appeler Hugo")?.quand, date(3, 11, 9, 0));
    eq(analyse("Rappelle-moi le 3 d'appeler Hugo")?.reste, "Appeler Hugo");
    eq(analyse("Payer la facture le 3 dans la matinée")?.quand, date(3, 11, 9, 0));
    nul(analyse("Relire le 3 de la liste"), "sans « rappelle-moi », « le 3 de » n'est pas une date");
});

// « avant <jour nommé> » (27/10) : jusqu'à la fin de la veille, 23 h 59,
// comme « avant le 3 ». Une heure dite fixe la borne : ce jour-là, à
// cette heure. « avant mardi » dit un mardi : celui qui vient.
test("testAvantUnJourNommeEstLaVeille", () => {
    const lundi = date(26, 10, 8, 0);
    eq(extraire("Rendre le dossier avant mardi", lundi)?.echeance, date(26, 10, 23, 59), "lundi 23 h 59");
    eq(extraire("Rendre le dossier avant mardi", lundi)?.reste, "Rendre le dossier");
    eq(extraire("Rendre le dossier avant vendredi", lundi)?.echeance, date(29, 10, 23, 59));
    eq(extraire("Rendre le dossier avant lundi", lundi)?.echeance, date(1, 11, 23, 59), "dit un lundi : le lundi qui vient, la veille change de mois");
    eq(extraire("Rendre le dossier avant lundi prochain", date(25, 10, 9, 0))?.echeance, date(25, 10, 23, 59));
    eq(analyse("Rendre le dossier avant demain")?.echeance, date(15, 10, 23, 59), "avant demain : ce soir");
    eq(analyse("Rendre le dossier avant après-demain")?.echeance, date(16, 10, 23, 59));
    eq(analyse("rendre le dossier avant apres demain")?.echeance, date(16, 10, 23, 59), "dictée sans accent");
    eq(analyse("Rendre le dossier avant samedi")?.echeance, date(16, 10, 23, 59));
    eq(extraire("Rendre le dossier avant samedi", date(31, 10, 9, 0))?.echeance, date(6, 11, 23, 59), "dit un samedi : le suivant");
    eq(extraire("Rendre le dossier avant mardi", date(29, 12, 9, 0))?.echeance, date(4, 1, 23, 59, 2027), "dit un mardi : la veille du suivant, l'an prochain");
    // Avec une heure : ce jour-là, à cette heure.
    eq(extraire("Rendre le dossier avant mardi 14h", lundi)?.echeance, date(27, 10, 14, 0));
    eq(extraire("Rendre le dossier avant mardi à 14h", lundi)?.heureDite, true);
    eq(analyse("Rendre le dossier avant demain midi")?.echeance, date(16, 10, 12, 0));
    eq(analyse("Rendre le dossier avant vendredi soir")?.quand, date(16, 10, 20, 0));
    // « pour », « d'ici » : le jour dit, 23 h, comme avant.
    eq(extraire("Rendre le dossier pour mardi", lundi)?.echeance, date(27, 10, 23, 0));
    eq(extraire("Rendre le dossier d'ici mardi", lundi)?.echeance, date(27, 10, 23, 0));
    eq(analyse("Rendre le dossier demain")?.echeance, date(16, 10, 23, 0));
    // Un rappel « avant mardi » sonne la veille au matin ; le genre ne change pas.
    eq(extraire("Rappelle-moi avant mardi d'appeler Hugo", lundi)?.quand, date(26, 10, 9, 0));
    eq(deviner("Envoyer le devis avant mardi", lundi), "tache");
    eq(tache("Avant mardi, envoyer le devis", lundi).titre, "Envoyer le devis");
});

// « début novembre » : le 5, 23 h (27/10) ; « fin novembre » : le
// dernier jour. Les bords de mois et l'année qui change.
test("testDebutDuMoisEstLe5", () => {
    for (const p of ["Préparer Noël début novembre", "Préparer Noël debut novembre", "Préparer Noël au début de novembre", "Préparer Noël en début de novembre", "Préparer Noël d'ici début novembre", "Préparer Noël début nov.", "Préparer Noël début du mois prochain",
        // « début » est masculin : « le » part avec la date (contre-relecture).
        "Préparer Noël pour le début de novembre", "Préparer Noël d'ici le début de novembre", "Préparer Noël avant le début de novembre", "Préparer Noël d ici le debut de novembre", "Avant le début de novembre, préparer Noël", "Pour le début de novembre, préparer Noël"]) {
        const r = analyse(p);
        eq(r?.echeance, date(5, 11, 23, 0), p);
        eq(r?.heureDite, false, p);
        eq(r?.reste, "Préparer Noël", p);
        nul(r?.dejaPassee, p);
        eq(deviner(p, maintenant), "tache", p);
        eq(tache(p, maintenant).titre, "Préparer Noël", p);
    }
    eq(tache("Payer le loyer avant le début du mois prochain", maintenant).titre, "Payer le loyer");
    eq(tache("Payer le loyer avant le début du mois prochain", maintenant).echeance, date(5, 11, 23, 0));
    eq(analyse("Rappelle-moi début novembre de préparer Noël")?.quand, date(5, 11, 9, 0));
    eq(analyse("Payer la taxe début janvier")?.echeance, date(5, 1, 23, 0, 2027), "l'an prochain, mois après mois");
    eq(analyse("Payer la taxe debut fevrier")?.echeance, date(5, 2, 23, 0, 2027), "dictée sans accent");
    eq(analyse("Payer la taxe début décembre 2027")?.echeance, date(5, 12, 23, 0, 2027));
    eq(extraire("Payer la taxe début janvier", date(20, 12, 9, 0))?.echeance, date(5, 1, 23, 0, 2027));
    eq(extraire("Payer la taxe début novembre", date(5, 11, 9, 0))?.echeance, date(5, 11, 23, 0), "le 5 même : ce soir");
    eq(extraire("Payer la taxe fin decembre", date(1, 12, 9, 0))?.echeance, date(31, 12, 23, 0), "sans accent");
    eq(extraire("Payer la taxe fin aout", date(1, 8, 9, 0))?.echeance, date(31, 8, 23, 0));
    eq(extraire("Payer la taxe fin février", date(1, 2, 9, 0, 2028))?.echeance, date(29, 2, 23, 0, 2028), "bissextile");
});

// Une fin ou un début de mois déjà passés depuis 31 jours au plus :
// aujourd'hui (en retard de fait), jamais l'an prochain ; l'aperçu le dit.
// Au-delà de 31 jours : l'année suivante.
test("testUneFinDeMoisDejaPasseeTombeAujourdhui", () => {
    const deuxNovembre = date(2, 11, 10, 0);
    const r = extraire("Rendre le dossier fin octobre", deuxNovembre);
    eq(r?.echeance, date(2, 11, 23, 0), "ce soir");
    eq(r?.reste, "Rendre le dossier");
    eq(r?.dejaPassee, "fin octobre, déjà passée : ce soir");
    eq(extraire("Rendre le dossier début novembre", date(7, 11, 10, 0))?.dejaPassee, "début novembre, déjà passé : ce soir");
    eq(extraire("Rendre le dossier début novembre", date(7, 11, 10, 0))?.echeance, date(7, 11, 23, 0));
    eq(extraire("Rendre le dossier fin octobre", date(30, 11, 10, 0))?.echeance, date(30, 11, 23, 0), "30 jours : encore en retard");
    eq(extraire("Rendre le dossier fin octobre", date(1, 12, 10, 0))?.echeance, date(1, 12, 23, 0), "31 jours tout juste : en retard");
    const apres = extraire("Rendre le dossier fin octobre", date(2, 12, 10, 0));
    eq(apres?.echeance, date(31, 10, 23, 0, 2027), "32 jours : l'an prochain");
    nul(apres?.dejaPassee);
    eq(extraire("Rendre le dossier fin decembre", date(3, 1, 10, 0, 2027))?.echeance, date(3, 1, 23, 0, 2027), "décembre d'il y a trois jours, par-dessus le nouvel an");
    nul(extraire("Rendre le dossier fin du mois", date(20, 10, 10, 0))?.dejaPassee);
    // Le rappel sonne dans l'heure, jamais dans le passé.
    const rappel = extraire("Rappelle-moi de rendre le dossier fin octobre", deuxNovembre);
    eq(rappel?.quand, date(2, 11, 11, 0));
    eq(deviner("Rendre le dossier fin octobre", deuxNovembre), "tache");
});

// Contre-relecture : une fin ou un début de mois passés, dits avec une
// heure. L'heure encore à venir aujourd'hui : à cette heure ; déjà passée :
// à la prochaine heure pleine. Jamais un rappel dans le passé, et
// l'aperçu le dit.
test("testUneFinDeMoisPasseeAvecUneHeureNeTombeJamaisDansLePasse", () => {
    const deuxNovembre19h = date(2, 11, 19, 0);
    const rappel = extraire("Rappelle-moi fin octobre à 18h de payer Hugo", deuxNovembre19h);
    eq(rappel?.quand, date(2, 11, 20, 0), "18 h est passé : 20 h, l'heure pleine suivante");
    eq(rappel?.quand > deuxNovembre19h, true);
    eq(rappel?.dejaPassee, "fin octobre, déjà passée : dans l'heure");
    eq(deviner("Rappelle-moi fin octobre à 18h de payer Hugo", deuxNovembre19h), "rappel");
    const vingt = date(20, 11, 10, 0);
    const debut = extraire("Rappelle-moi début novembre à 9h de payer Hugo", vingt);
    eq(debut?.quand, date(20, 11, 11, 0));
    eq(debut?.dejaPassee, "début novembre, déjà passé : dans l'heure");
    const dossier = extraire("Rendre le dossier fin octobre à 18h", deuxNovembre19h);
    eq(dossier?.echeance, date(2, 11, 20, 0));
    eq(dossier?.echeance > deuxNovembre19h, true);
    pasNul(dossier?.dejaPassee);
    // L'heure dite vient encore aujourd'hui : à cette heure, et dit tel quel.
    const matin = extraire("Rendre le dossier fin octobre à 18h", date(2, 11, 10, 0));
    eq(matin?.echeance, date(2, 11, 18, 0));
    eq(matin?.dejaPassee, "fin octobre, déjà passée : aujourd'hui à 18 h");
    eq(extraire("Rendre le dossier fin octobre à 18h30", date(2, 11, 10, 0))?.dejaPassee, "fin octobre, déjà passée : aujourd'hui à 18 h 30");
    // 23 h passées : dix minutes plus tard, pas minuit d'hier.
    const tard = date(2, 11, 23, 20);
    const nuit = extraire("Rappelle-moi fin octobre à 18h de payer Hugo", tard);
    eq(nuit?.quand > tard, true);
});

// Contre-relecture : « début du mois » sans mois nommé, dit après le 5,
// vise le 5 du mois qui vient (« payer le loyer début du mois », dit le
// 27) ; jamais « déjà passé ». « de ce mois », dit exprès, reste ce mois.
test("testDebutDuMoisApresLe5VisLeMoisSuivant", () => {
    for (const [p, quand] of [["Payer le loyer début du mois", date(27, 10, 10, 0)], ["Payer le loyer début du mois", date(6, 10, 10, 0)], ["Faire les comptes en début de mois", date(27, 10, 10, 0)], ["Payer le loyer au début du mois", date(20, 10, 10, 0)], ["Rendre le dossier début du mois", date(20, 10, 10, 0)], ["payer le loyer debut du mois", date(27, 10, 10, 0)]]) {
        const r = extraire(p, quand);
        eq(r?.echeance, date(5, 11, 23, 0), p);
        nul(r?.dejaPassee, p);
    }
    eq(extraire("Payer le loyer début du mois", date(3, 10, 10, 0))?.echeance, date(5, 10, 23, 0), "avant le 5 : ce mois-ci");
    eq(extraire("Payer le loyer début du mois", date(5, 10, 10, 0))?.echeance, date(5, 10, 23, 0), "le 5 même : ce soir");
    eq(extraire("Payer la taxe début du mois", date(20, 12, 10, 0))?.echeance, date(5, 1, 23, 0, 2027), "par-dessus le nouvel an");
    const ceMois = extraire("Rendre le dossier début de ce mois", date(20, 10, 10, 0));
    eq(ceMois?.echeance, date(20, 10, 23, 0));
    eq(ceMois?.dejaPassee, "début de ce mois, déjà passé : ce soir");
    eq(extraire("Payer le loyer début du mois prochain", date(27, 10, 10, 0))?.echeance, date(5, 11, 23, 0));
});

// Contre-relecture : « avant mardi 14h » est une date limite. Avec une
// action claire, une tâche avec cette échéance, pas un rappel qui sonne
// quand il est trop tard ; « rappelle-moi » reste un rappel.
test("testUneDateLimiteAvecHeureEstUneTache", () => {
    const lundi = date(26, 10, 10, 0);
    eq(deviner("Rendre le dossier avant mardi 14h", lundi), "tache");
    eq(tache("Rendre le dossier avant mardi 14h", lundi).titre, "Rendre le dossier");
    eq(tache("Rendre le dossier avant mardi 14h", lundi).echeance, date(27, 10, 14, 0));
    const deux = date(2, 11, 10, 0);
    eq(deviner("Rendre le dossier avant le 3 à 14h", deux), "tache");
    eq(tache("Rendre le dossier avant le 3 à 14h", deux).echeance, date(3, 11, 14, 0));
    eq(deviner("Rendre le dossier d'ici demain 18h", lundi), "tache");
    eq(deviner("Rendre le dossier au plus tard vendredi à 12h", lundi), "tache");
    eq(deviner("Rendre le dossier jusqu'au 3 à 14h", deux), "tache");
    // Un rappel dit comme tel, une heure sans « avant », « pour » : rappel.
    eq(deviner("Rappelle-moi avant mardi 14h de rendre le dossier", lundi), "rappel");
    eq(deviner("Appeler Hugo mardi 14h", lundi), "rappel");
    eq(deviner("Réserver le resto pour mardi 20h", lundi), "rappel");
    eq(extraire("Appeler Hugo mardi 14h", lundi)?.limite, false);
    // Une tâche changée à la main, heure dite sans « avant » : l'heure reste dans le titre.
    eq(texte("Appeler Hugo mardi 14h", extraire("Appeler Hugo mardi 14h", lundi), "tache"), "Appeler Hugo mardi 14h");
});

// Contre-relecture : le texte d'une tâche ne perd jamais un morceau de
// sa phrase ; la date ne s'en retire que si elle était au bout.
test("testLeTexteDUneTacheResteEntier", () => {
    const t2 = (t, g) => texte(t, extraire(t, maintenant), g);
    eq(t2("Envoyer le devis vendredi", "tache"), "Envoyer le devis");
    eq(t2("Demain, appeler le plombier", "tache"), "Appeler le plombier");
    eq(t2("Vendredi : envoyer le devis", "tache"), "Envoyer le devis");
    eq(t2("Préparer la réunion de demain avec Hugo", "tache"), "Préparer la réunion de demain avec Hugo");
    eq(t2("Relire le compte rendu de lundi", "tache"), "Relire le compte rendu de lundi");
    eq(t2("Payer la facture du 12/11", "tache"), "Payer la facture du 12/11");
    eq(t2("Préparer la sortie de dimanche avec Léa", "tache"), "Préparer la sortie de dimanche avec Léa");
    eq(t2("Envoyer le devis jeudi ou vendredi", "tache"), "Envoyer le devis jeudi ou vendredi");
    eq(t2("Rappelle-moi d'envoyer le devis vendredi", "tache"), "Envoyer le devis", "genre changé à la main");
    eq(t2("Préparer la réunion de 14h", "tache"), "Préparer la réunion de 14h", "l'heure dite reste");
    eq(t2("Appeler le garage demain à 9h", "tache"), "Appeler le garage demain à 9h");
    eq(t2("Appeler le garage demain à 9h", "rappel"), "Appeler le garage", "le rappel sonne à 9 h");
    eq(t2("Rappelle-moi de préparer la réunion de demain avec Hugo", "rappel"), "Préparer la réunion de demain avec Hugo");
    eq(t2("Acheter du pain", "tache"), "Acheter du pain");
    eq(t2("Rappelle-moi d'acheter du pain", "rappel"), "Acheter du pain");
    // Ces phrases restent des tâches, avec leur échéance.
    for (const p of ["Préparer la réunion de demain avec Hugo", "Relire le compte rendu de lundi", "Payer la facture du 12/11", "Préparer la sortie de dimanche avec Léa"]) {
        eq(deviner(p, maintenant), "tache", p);
        eq(extraire(p, maintenant)?.heureDite, false, p);
    }
});

test("testPasDeDate", () => {
    nul(analyse("Acheter du lait"));
    nul(analyse("Lire 5 heures de musique"));
});

// MARK: Genre de capture

test("testGenresDevines", () => {
    eq(deviner("tomates, lait, œufs", maintenant), "liste");
    eq(deviner("tomates, lait et œufs", maintenant), "liste");
    eq(deviner("Appeler le garage demain à 9h", maintenant), "rappel");
    eq(deviner("Relire le contrat de Hugo", maintenant), "tache");
    eq(articles("tomates, lait et œufs"), ["tomates", "lait", "œufs"]);
    eq(articles("pommes"), ["pommes"]);
    eq(articles("Je dois appeler le garage pour la voiture, puis passer à la banque"), []);
});

// Parcours P07 : « Envoyer le devis vendredi » était deviné « Rappel »
// (vendredi 9 h). Une action avec un jour sans heure est une tâche à
// échéance ; un rappel, c'est une heure dite ou « rappelle-moi ».
test("testUneActionAvecUnJourEstUneTache", () => {
    eq(deviner("Envoyer le devis a Hugo vendredi", maintenant), "tache");
    eq(deviner("Payer la cantine le 12/11", maintenant), "tache");
    eq(deviner("Il faut que j'appelle le garage demain", maintenant), "tache");
    eq(deviner("Envoyer le devis vendredi à 14h", maintenant), "rappel", "une heure dite");
    eq(deviner("Rappelle-moi d'envoyer le devis vendredi", maintenant), "rappel");
    eq(deviner("N'oublie pas de payer la cantine lundi", maintenant), "rappel");
    eq(deviner("Anniversaire de Nina le 3 février", maintenant), "rappel", "pas une action : un rappel");
    eq(deviner("Appeler le garage demain à 9h", maintenant), "rappel");
    // Le jour en tête : l'action se lit sans lui.
    eq(deviner("lundi je dois rendre le dossier", maintenant), "tache");
    eq(deviner("Demain, appeler le plombier", maintenant), "tache");
    eq(deviner("Vendredi : envoyer le devis", maintenant), "tache");
    eq(deviner("apres demain envoyer le devis", maintenant), "tache");
    eq(deviner("Faire 2h de studio jeudi", maintenant), "tache", "une durée, pas une heure");
    eq(deviner("Appeler le garage demain à 14 heures", maintenant), "rappel");
    eq(deviner("Hugo préfère qu'on lui écrive, surtout le lundi.", maintenant), "rappel", "une information sans action reste un rappel");
    // Ce que Sam annonce passe avant la date.
    eq(deviner("idée : un clip en noir pour vendredi", maintenant), "idee");
    eq(deviner("Idée : un clip en noir", maintenant, "tache"), "idee");
    eq(deviner("Projet bougies pour lundi", maintenant), "projet");
});


// --- AccueilTests, OrganisationTests, RituelTests ---

test("testGenreDevine", () => {
    eq(deviner("Appeler le garage", undefined), "tache");
    eq(deviner("Qu'est-ce que j'ai cet après-midi", undefined), "question");
    eq(deviner("On mange où ce soir ?", undefined), "question");
    eq(deviner("Une longue idée à garder. ".repeat(6), undefined), "retenir");
});

test("testPlusieursIntentionsReconnues", () => {
    vrai(plusieursIntentions("Soirée chez Yanis jeudi, dispo seulement le matin samedi, deux heures de studio dimanche à La Roseraie et la lessive avant"));
    faux(plusieursIntentions("tomates, lait d'avoine et œufs"), "une liste d'articles n'en est pas");
    faux(plusieursIntentions("Appeler le garage pour la révision demain"));
});

test("testProjetDepuisLePlus", () => {
    eq(deviner("Nouveau projet location de vans", undefined), "projet");
    const p = projet("sous-projet étudier ElevenLabs dans « Boutique de bougies »");
    eq(p.titre, "Étudier ElevenLabs");
    eq(p.parent, "Boutique de bougies");
    const q = projet("Projet : Corail");
    eq(q.titre, "Corail");
    nul(q.parent);
    // Sans guillemets : seulement le nom d'un projet qui existe.
    const r = projet("Nouveau projet : Recrutement sous ceramique", ["Voyage", "Céramique"]);
    eq(r.titre, "Recrutement");
    eq(r.parent, "Céramique");
    const s = projet("Projet rangement sous l'escalier", ["Boutiques"]);
    eq(s.titre, "Rangement sous l'escalier", "un « sous » ordinaire reste dans le titre");
    nul(s.parent);
});

test("testUnePenseeFloueVaDansLesIdees", () => {
    eq(deviner("Un clip en noir pour le prochain son", undefined), "idee");
    eq(deviner("Dossier subvention atelier", undefined), "idee");
    eq(deviner("Peut-être un voyage à Porto au printemps", undefined), "idee");
});

test("testUneActionClaireVaDansMotion", () => {
    eq(deviner("Appeler le garage", undefined), "tache");
    eq(deviner("Relire le contrat de Hugo", undefined), "tache");
    eq(deviner("Me renseigner sur les assurances", undefined), "tache");
    eq(deviner("Il faut que je trie mes mails", undefined), "tache");
    eq(deviner("Studio : 90 min pour la démo", undefined), "tache");
    // Dicté à l'impératif, comme on se parle.
    eq(deviner("Appelle le garage", undefined), "tache");
    eq(deviner("Envoie le devis à Léa", undefined), "tache");
    eq(deviner("Achète des ampoules", undefined), "tache");
    // Un nom qui ressemble à un verbe reste une idée.
    eq(deviner("Livre de cuisine pour l'hiver", undefined), "idee");
    eq(deviner("Note sur le mix du refrain", undefined), "idee");
});

test("testReglablePourRevenirAMotion", () => {
    eq(deviner("Un clip en noir pour le prochain son", undefined, "tache"), "tache");
    // Les autres genres ne bougent pas.
    eq(deviner("tomates, lait et œufs", undefined), "liste");
    eq(deviner("On mange où ce soir ?", undefined), "question");
});

// --- L'aperçu complet, tel que la fenêtre « Noter » l'affiche ---

test("apercu : genre, date et titre ensemble", () => {
  const a = apercu("Envoyer le devis vendredi", { maintenant });
  eq(a.genre, "tache");
  eq(a.titre, "Envoyer le devis");
  eq(a.date?.echeance, date(16, 10, 23));
  const r = apercu("Appeler le garage demain à 9h", { maintenant });
  eq(r.genre, "rappel");
  eq(r.titre, "Appeler le garage");
  eq(r.date?.quand, date(16, 10, 9));
  const l = apercu("tomates, lait et œufs", { maintenant });
  eq(l.genre, "liste");
  eq(l.articles, ["tomates", "lait", "œufs"]);
  const corrige = apercu("Appeler le garage demain à 9h", { maintenant, genre: "tache" });
  eq(corrige.genre, "tache");
  eq(corrige.devine, false);
  eq(corrige.titre, "Appeler le garage demain à 9h", "une tâche garde l'heure dite dans son titre");
  vrai(apercu("Soirée chez Yanis jeudi, dispo seulement le matin samedi, deux heures de studio dimanche", { maintenant }).plusieurs);
  eq(apercu("", { maintenant }).genre, "idee");
  eq(apercu("Projet : Corail", { maintenant }).titre, "Corail");
});
