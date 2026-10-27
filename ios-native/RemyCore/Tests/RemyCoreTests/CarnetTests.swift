import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// J1.5 : listes et rappels (hors ligne d'abord), dates en français, tâche
/// modifiée ou bloquée.
@MainActor
final class CarnetTests: XCTestCase {
    // Jeudi 15 octobre 2026, 10:40 à Paris.
    private var cal: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = Format.fuseau
        return c
    }
    private var maintenant: Date { cal.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 10, minute: 40))! }
    private func date(_ j: Int, _ m: Int, _ h: Int, _ mi: Int = 0, an: Int = 2026) -> Date {
        cal.date(from: DateComponents(year: an, month: m, day: j, hour: h, minute: mi))!
    }
    private func analyse(_ t: String) -> AnalyseDate.Resultat? { AnalyseDate.extraire(t, maintenant: maintenant) }

    // MARK: Dates

    func testDemainAHeure() {
        XCTAssertEqual(analyse("Appeler le garage demain à 9h"), .init(quand: date(16, 10, 9), reste: "Appeler le garage"))
    }

    func testJourDeLaSemaineEtMinutes() {
        XCTAssertEqual(analyse("Rdv dentiste lundi 9h30"), .init(quand: date(19, 10, 9, 30), reste: "Rdv dentiste"))
        XCTAssertEqual(analyse("Point d'équipe jeudi 18h")?.quand, date(15, 10, 18), "jeudi, un jeudi matin : aujourd'hui")
        XCTAssertEqual(analyse("Courir jeudi 8h")?.quand, date(22, 10, 8), "l'heure est passée : la semaine prochaine")
        XCTAssertEqual(analyse("Bilan jeudi prochain")?.quand, date(22, 10, 9))
    }

    func testDatesEnChiffresEtEnLettres() {
        XCTAssertEqual(analyse("Payer la cantine le 12/11"), .init(quand: date(12, 11, 9), reste: "Payer la cantine", heureDite: false))
        XCTAssertEqual(analyse("Anniversaire de Nina le 3 février")?.quand, date(3, 2, 9, an: 2027), "déjà passé cette année")
        XCTAssertEqual(analyse("Anniversaire de Nina le 3 février")?.reste, "Anniversaire de Nina")
    }

    func testHeureSeuleEtRelatif() {
        XCTAssertEqual(analyse("Sortir les poubelles à 8h")?.quand, date(16, 10, 8), "8h est passé : demain")
        XCTAssertEqual(analyse("Appeler maman à 18:30")?.quand, date(15, 10, 18, 30))
        XCTAssertEqual(analyse("Appeler maman ce soir")?.quand, date(15, 10, 20))
        let r = analyse("Rappelle-moi dans 20 min de sortir le linge")
        XCTAssertEqual(r?.quand, maintenant.addingTimeInterval(1200))
        XCTAssertEqual(r?.reste, "Sortir le linge")
    }

    /// Sam, TestFlight 13 : « rappelle moi d'aller sur l'ordi à 13h59 »
    /// donnait le rappel « rappelle moi d'aller sur l'ordi ».
    func testLaFormuleDeDemandeNEstPasLeRappel() {
        XCTAssertEqual(analyse("rappelle moi d'aller sur l'ordi à 13h59")?.reste, "Aller sur l'ordi")
        XCTAssertEqual(analyse("Rappelle-moi demain d'appeler Hugo")?.reste, "Appeler Hugo")
        XCTAssertEqual(analyse("n'oublie pas de payer la cantine lundi")?.reste, "Payer la cantine")
        XCTAssertEqual(analyse("il faut que j'appelle le garage demain")?.reste, "Appelle le garage")
        XCTAssertEqual(analyse("tu peux me rappeler de sortir les poubelles ce soir")?.reste, "Sortir les poubelles")
        XCTAssertEqual(AnalyseDate.sansFormule("rappelle-moi que le loyer tombe le 5"), "Le loyer tombe le 5")
        XCTAssertEqual(AnalyseDate.sansFormule("Rappeler Hugo"), "Rappeler Hugo", "un vrai verbe reste")
        XCTAssertEqual(AnalyseDate.sansFormule("Pense à prendre le chargeur"), "Prendre le chargeur")
        XCTAssertEqual(GenreCapture.deviner("rappelle-moi de racheter du café"), .rappel)
    }

    /// Parcours P07 : un jour sans heure n'est pas un créneau. Pour une tâche,
    /// c'est une échéance, en fin de journée ; l'heure dite reste l'heure.
    func testUnJourSansHeureEstUneEcheance() {
        let r = analyse("Envoyer le devis à Hugo vendredi")
        XCTAssertEqual(r?.heureDite, false)
        XCTAssertEqual(r?.reste, "Envoyer le devis à Hugo")
        XCTAssertEqual(r?.echeance, date(16, 10, 23), "vendredi, fin de journée")
        XCTAssertEqual(analyse("Appeler le garage demain à 9h")?.heureDite, true)
        XCTAssertEqual(analyse("Appeler le garage demain à 9h")?.echeance, date(16, 10, 9))
        XCTAssertEqual(analyse("Appeler maman ce soir")?.heureDite, true)
        XCTAssertEqual(analyse("Rappelle-moi dans 20 min de sortir le linge")?.heureDite, true)
        XCTAssertEqual(analyse("Relancer Léa dans 3 jours")?.heureDite, false)
        XCTAssertEqual(analyse("Relancer Léa dans 3 jours")?.echeance, date(18, 10, 23))
        XCTAssertEqual(analyse("Payer la cantine le 12/11")?.echeance, date(12, 11, 23))
        // Le lien vers la date part avec elle.
        XCTAssertEqual(analyse("Préparer la facture avant vendredi")?.reste, "Préparer la facture")
        XCTAssertEqual(analyse("Rendre le dossier d'ici lundi")?.reste, "Rendre le dossier")
    }

    /// Contre-relecture : « vendredi » dit un vendredi après 9 h glissait
    /// d'une semaine (le 9 h posé pour un rappel). Une échéance part du jour
    /// dit et ne recule que si ce jour est fini.
    func testLeJourMemeLEcheanceEstCeSoir() {
        let vendredi10h = date(16, 10, 10)
        let r = AnalyseDate.extraire("Envoyer le devis vendredi", maintenant: vendredi10h)
        XCTAssertEqual(r?.echeance, date(16, 10, 23), "ce soir, pas dans une semaine")
        XCTAssertEqual(r?.quand, date(23, 10, 9), "un rappel sans heure garde la semaine suivante")
        XCTAssertEqual(AnalyseDate.extraire("Commander les bougies vendredi", maintenant: date(16, 10, 17))?.echeance, date(16, 10, 23))
        XCTAssertEqual(AnalyseDate.extraire("Envoyer le devis vendredi", maintenant: date(16, 10, 23, 30))?.echeance, date(23, 10, 23),
                       "ce vendredi est fini : le suivant")
        XCTAssertEqual(AnalyseDate.extraire("Envoyer le devis aujourd'hui", maintenant: date(16, 10, 23, 30))?.echeance, date(16, 10, 23, 59),
                       "aujourd'hui, tard : jusqu'à minuit, pas une échéance passée")
    }

    /// Contre-relecture : des heures et des moments mal lus.
    func testHeuresEtMomentsDuJour() {
        let quatorze = analyse("Appeler le garage demain à 14 heures")
        XCTAssertEqual(quatorze?.quand, date(16, 10, 14))
        XCTAssertEqual(quatorze?.heureDite, true)
        XCTAssertEqual(quatorze?.reste, "Appeler le garage")
        XCTAssertEqual(analyse("Appeler le garage demain vers 9 heures 30")?.quand, date(16, 10, 9, 30))
        // Une durée n'est pas une heure.
        XCTAssertNil(analyse("Faire 2h de studio"))
        XCTAssertEqual(analyse("Faire 2h de studio jeudi")?.heureDite, false)
        XCTAssertEqual(analyse("Faire 2h de studio jeudi")?.reste, "Faire 2h de studio")
        XCTAssertEqual(analyse("Préparer la réunion de 14h")?.quand, date(15, 10, 14), "« de 14h » : une heure")
        // Le moment d'un jour dit.
        let soir = analyse("Rappelle-moi de sortir les poubelles demain soir")
        XCTAssertEqual(soir?.quand, date(16, 10, 20))
        XCTAssertEqual(soir?.reste, "Sortir les poubelles")
        let aprem = analyse("Appeler le garage lundi après-midi")
        XCTAssertEqual(aprem?.quand, date(19, 10, 14))
        XCTAssertEqual(aprem?.reste, "Appeler le garage")
        XCTAssertEqual(analyse("Appeler le garage demain matin")?.quand, date(16, 10, 9))
        XCTAssertEqual(analyse("Appeler le garage demain à 3h de l'après-midi")?.quand, date(16, 10, 15))
        XCTAssertEqual(analyse("Appeler le garage demain à 3h de l'après-midi")?.reste, "Appeler le garage")
        XCTAssertEqual(analyse("Dîner chez Léa demain soir à 8h")?.quand, date(16, 10, 20), "le soir : 20 h")
        XCTAssertNil(analyse("Lire au calme l'après-midi"), "« après-midi » seul n'est pas midi")
        XCTAssertNil(analyse("Lire au calme l'après midi"), "ni sans trait d'union")
        // « a » sans accent, comme on le tape vite : une heure, sauf devant une durée.
        XCTAssertEqual(analyse("Appeler le garage demain a 14h")?.quand, date(16, 10, 14))
        XCTAssertEqual(analyse("Appeler le garage demain a 14h")?.reste, "Appeler le garage")
        XCTAssertNil(analyse("Hugo a 2h de route"), "« a 2h de route » : une durée")
        XCTAssertNil(analyse("Léa a 3 heures de retard"))
        XCTAssertEqual(analyse("Appeler le garage demain a 3h de l'après-midi")?.quand, date(16, 10, 15))
        // « dans 1h30 », « dans une heure », « dans 2 semaines ».
        let linge = analyse("Rappelle-moi dans 1h30 de sortir le linge")
        XCTAssertEqual(linge?.quand, maintenant.addingTimeInterval(5400))
        XCTAssertEqual(linge?.reste, "Sortir le linge")
        XCTAssertEqual(analyse("Rappelle-moi dans une heure d'appeler Léa")?.quand, maintenant.addingTimeInterval(3600))
        XCTAssertEqual(analyse("Relancer Hugo dans 2 semaines")?.echeance, date(29, 10, 23))
        XCTAssertEqual(analyse("Relancer Léa dans une semaine")?.heureDite, false)
        // « dans 3 jours à 14h » : l'heure dite compte.
        let lea = analyse("Appeler Léa dans 3 jours à 14h")
        XCTAssertEqual(lea?.quand, date(18, 10, 14))
        XCTAssertEqual(lea?.heureDite, true)
        XCTAssertEqual(GenreCapture.deviner("Appeler Léa dans 3 jours à 14h", maintenant: maintenant), .rappel)
    }

    func testDatesAbregeesEtJourAvecSaDate() {
        XCTAssertEqual(analyse("Envoyer le devis le 30 oct")?.quand, date(30, 10, 9))
        XCTAssertEqual(analyse("Envoyer le devis le 30 oct.")?.reste, "Envoyer le devis")
        XCTAssertEqual(analyse("Payer le loyer le 1er nov")?.quand, date(1, 11, 9))
        let lundi = analyse("Rendre le devis lundi 2 novembre")
        XCTAssertEqual(lundi?.quand, date(2, 11, 9))
        XCTAssertEqual(lundi?.reste, "Rendre le devis")
        XCTAssertEqual(analyse("Envoyer le devis vendredi.")?.reste, "Envoyer le devis", "le point final ne reste pas seul")
        XCTAssertEqual(AnalyseDate.sansFormule("Rappelle moi d appeler maman"), "Appeler maman", "dictée sans apostrophe")
        XCTAssertEqual(AnalyseDate.sansFormule("N'oublie pas d envoyer le devis"), "Envoyer le devis")
    }

    // MARK: Échéances larges (décisions du 25/10)

    /// « cette semaine » va jusqu'au dimanche, 23 h ; « la semaine prochaine »
    /// au dimanche suivant. Jeudi 15 octobre → dimanche 18, puis 25.
    func testCetteSemaineVaJusquAuDimanche() {
        for p in ["Envoyer le devis cette semaine", "Envoyer le devis avant la fin de la semaine",
                  "Envoyer le devis d'ici la fin de la semaine", "Envoyer le devis dans la semaine",
                  "Envoyer le devis d’ici la fin de la semaine", "Envoyer le devis en fin de semaine"] {
            let r = analyse(p)
            XCTAssertEqual(r?.echeance, date(18, 10, 23), p)
            XCTAssertEqual(r?.heureDite, false, p)
            XCTAssertEqual(r?.reste, "Envoyer le devis", p)
            XCTAssertEqual(GenreCapture.deviner(p, maintenant: maintenant), .tache, p)
            XCTAssertEqual(GenreCapture.texte(p, date: r, genre: .tache), "Envoyer le devis", p)
        }
        for p in ["Relancer Hugo la semaine prochaine", "Relancer Hugo avant la fin de la semaine prochaine",
                  "Relancer Hugo semaine prochaine"] {
            XCTAssertEqual(analyse(p)?.echeance, date(25, 10, 23), p)
            XCTAssertEqual(analyse(p)?.reste, "Relancer Hugo", p)
        }
        let enTete = "Dans la semaine, appeler le plombier"
        XCTAssertEqual(GenreCapture.texte(enTete, date: analyse(enTete), genre: .tache), "Appeler le plombier")
        XCTAssertEqual(analyse(enTete)?.echeance, date(18, 10, 23))
        // Un jour dit en plus est plus précis : il l'emporte (plus tôt, jamais raté).
        XCTAssertEqual(analyse("Appeler Hugo samedi cette semaine")?.echeance, date(17, 10, 23))
        XCTAssertEqual(analyse("Appeler Hugo lundi de la semaine prochaine")?.echeance, date(19, 10, 23))
    }

    /// Le jour même et les bords : le dimanche, « cette semaine » c'est ce
    /// soir (23 h 59 passé 23 h) ; le lundi, la semaine recommence.
    func testCetteSemaineLeDimancheEtLeLundi() {
        let dimanche10h = date(18, 10, 10)
        XCTAssertEqual(AnalyseDate.extraire("Finir le site cette semaine", maintenant: dimanche10h)?.echeance, date(18, 10, 23))
        XCTAssertEqual(AnalyseDate.extraire("Finir le site cette semaine", maintenant: date(18, 10, 23, 30))?.echeance, date(18, 10, 23, 59),
                       "dimanche soir tard : jusqu'à minuit, jamais une échéance passée")
        XCTAssertEqual(AnalyseDate.extraire("Finir le site la semaine prochaine", maintenant: dimanche10h)?.echeance, date(25, 10, 23))
        XCTAssertEqual(AnalyseDate.extraire("Finir le site cette semaine", maintenant: date(19, 10, 8))?.echeance, date(25, 10, 23),
                       "lundi : le dimanche qui vient")
        XCTAssertEqual(AnalyseDate.extraire("Finir le site la semaine prochaine", maintenant: date(19, 10, 8))?.echeance, date(1, 11, 23))
        // Une fin d'année au milieu de la semaine.
        XCTAssertEqual(AnalyseDate.extraire("Finir le site cette semaine", maintenant: date(30, 12, 9))?.echeance, date(3, 1, 23, an: 2027))
    }

    /// « fin octobre », « fin du mois » : le dernier jour du mois, 23 h ; un
    /// mois passé, l'année suivante.
    func testFinDuMoisEtFinOctobre() {
        for p in ["Payer les impôts fin octobre", "Payer les impôts fin du mois", "Payer les impôts avant la fin du mois",
                  "Payer les impôts d'ici fin octobre", "Payer les impôts pour la fin du mois", "Payer les impôts fin oct.",
                  "Payer les impôts à la fin du mois", "Payer les impôts fin d'octobre"] {
            let r = analyse(p)
            XCTAssertEqual(r?.echeance, date(31, 10, 23), p)
            XCTAssertEqual(r?.heureDite, false, p)
            XCTAssertEqual(r?.reste, "Payer les impôts", p)
            XCTAssertEqual(GenreCapture.deviner(p, maintenant: maintenant), .tache, p)
        }
        XCTAssertEqual(analyse("Payer les impôts fin novembre")?.echeance, date(30, 11, 23))
        XCTAssertEqual(analyse("Payer les impôts fin du mois prochain")?.echeance, date(30, 11, 23))
        XCTAssertEqual(analyse("Payer les impôts fin février")?.echeance, date(28, 2, 23, an: 2027), "février 2027 : 28 jours")
        XCTAssertEqual(analyse("Payer les impôts fin septembre")?.echeance, date(15, 10, 23), "passée depuis 15 jours : ce soir")
        XCTAssertEqual(analyse("Payer les impôts fin août")?.echeance, date(31, 8, 23, an: 2027), "passée depuis plus de 31 jours : l'an prochain")
        XCTAssertEqual(analyse("Payer les impôts fin décembre 2027")?.echeance, date(31, 12, 23, an: 2027))
        XCTAssertEqual(AnalyseDate.extraire("Payer les impôts fin octobre", maintenant: date(31, 10, 23, 30))?.echeance, date(31, 10, 23, 59),
                       "le dernier soir, tard : jusqu'à minuit")
        XCTAssertEqual(AnalyseDate.extraire("Payer les impôts fin du mois", maintenant: date(15, 2, 9, an: 2028))?.echeance, date(29, 2, 23, an: 2028),
                       "année bissextile")
        XCTAssertEqual(AnalyseDate.extraire("Payer les impôts fin du mois prochain", maintenant: date(10, 12, 9))?.echeance, date(31, 1, 23, an: 2027))
    }

    /// « avant le 3 » : la veille, 23 h 59 (« avant » est strict, 27/10 : une
    /// seule règle, jusqu'à la fin de la veille) ; « pour le 3 », « d'ici le
    /// 3 », « le 3 » : le 3, 23 h. Sans mois : le prochain 3.
    func testAvantLe3EstLaVeille() {
        XCTAssertEqual(analyse("Envoyer le devis avant le 3")?.echeance, date(2, 11, 23, 59), "le prochain 3 : novembre")
        XCTAssertEqual(analyse("Envoyer le devis avant le 3")?.reste, "Envoyer le devis")
        XCTAssertEqual(analyse("Envoyer le devis avant le 3 novembre")?.echeance, date(2, 11, 23, 59))
        XCTAssertEqual(analyse("Envoyer le devis avant le 3/11")?.echeance, date(2, 11, 23, 59))
        XCTAssertEqual(analyse("Envoyer le devis avant le 1er novembre")?.echeance, date(31, 10, 23, 59), "la veille change de mois")
        XCTAssertEqual(analyse("Envoyer le devis avant le 1er")?.echeance, date(31, 10, 23, 59))
        XCTAssertEqual(analyse("Envoyer le devis avant le 1er janvier")?.echeance, date(31, 12, 23, 59), "et d'année")
        for p in ["Envoyer le devis pour le 3", "Envoyer le devis d'ici le 3", "Envoyer le devis le 3", "Envoyer le devis jusqu'au 3",
                  "Envoyer le devis pour le 3 novembre", "Envoyer le devis d'ici le 3 novembre"] {
            XCTAssertEqual(analyse(p)?.echeance, date(3, 11, 23), p)
            XCTAssertEqual(analyse(p)?.reste, "Envoyer le devis", p)
            XCTAssertEqual(GenreCapture.deviner(p, maintenant: maintenant), .tache, p)
        }
        XCTAssertEqual(analyse("Payer le loyer le 20")?.echeance, date(20, 10, 23), "pas encore passé ce mois-ci")
        XCTAssertEqual(analyse("Payer le loyer le 15")?.echeance, date(15, 10, 23), "le jour même : ce soir")
        XCTAssertEqual(analyse("Payer le loyer avant le 16")?.echeance, date(15, 10, 23, 59), "la veille, c'est ce soir")
        XCTAssertEqual(analyse("Payer le loyer avant le 15")?.echeance, date(15, 10, 23, 59), "la veille est passée : ce soir, jamais une date passée")
        XCTAssertEqual(analyse("Payer le loyer avant le 31")?.echeance, date(30, 10, 23, 59))
        XCTAssertEqual(AnalyseDate.extraire("Payer le loyer le 31", maintenant: date(5, 11, 9))?.echeance, date(31, 12, 23),
                       "novembre n'a pas de 31 : décembre")
        XCTAssertEqual(AnalyseDate.extraire("Payer le loyer le 3", maintenant: date(3, 11, 23, 30))?.echeance, date(3, 11, 23, 59))
        // En tête de phrase : le titre reste propre.
        let enTete = "Avant le 3 novembre, envoyer le devis"
        XCTAssertEqual(GenreCapture.texte(enTete, date: analyse(enTete), genre: .tache), "Envoyer le devis")
        XCTAssertEqual(analyse(enTete)?.echeance, date(2, 11, 23, 59))
        // Un rappel « avant le 3 » sonne la veille.
        XCTAssertEqual(analyse("Rappelle-moi avant le 3 d'appeler Hugo")?.quand, date(2, 11, 9))
        XCTAssertEqual(analyse("Rappelle-moi avant le 3 d'appeler Hugo")?.reste, "Appeler Hugo")
        // « le 3 » avec une heure : un rappel ce jour-là.
        XCTAssertEqual(analyse("Appeler Hugo le 3 à 14h")?.quand, date(3, 11, 14))
        XCTAssertEqual(analyse("Appeler Hugo le 3 à 14h")?.heureDite, true)
    }

    /// Les flous restent dans le titre, sans échéance : jamais une date
    /// arbitraire. Et un nombre après « le » n'est pas toujours un jour.
    func testLesFlousNeDeviennentPasDesDates() {
        for p in ["Préparer Noël mi-novembre", "Préparer Noël en novembre", "Préparer Noël mi novembre", "Préparer Noël milieu novembre",
                  "Préparer Noël courant novembre", "Préparer le menu de la semaine", "Visiter le 2 pièces rue Haute",
                  "Lire le 3e chapitre", "Appeler le 06 12 34 56 78", "Relire le 2 du dossier Hugo", "Monter le 3 h de vidéo",
                  "Le 12 est mon numéro préféré", "Préparer la fin du film"] {
            XCTAssertNil(analyse(p), p)
        }
        XCTAssertEqual(GenreCapture.texte("Préparer Noël mi-novembre", date: analyse("Préparer Noël mi-novembre"), genre: .tache),
                       "Préparer Noël mi-novembre")
        XCTAssertEqual(GenreCapture.texte("Préparer Noël courant novembre", date: analyse("Préparer Noël courant novembre"), genre: .tache),
                       "Préparer Noël courant novembre")
        XCTAssertEqual(GenreCapture.deviner("Préparer Noël mi-novembre", maintenant: maintenant), .tache)
        // Une date au milieu reste dans le titre (règle du 25/10), l'échéance part quand même.
        let milieu = "Payer la facture de fin octobre à Hugo"
        XCTAssertEqual(GenreCapture.texte(milieu, date: analyse(milieu), genre: .tache), milieu)
        XCTAssertEqual(analyse(milieu)?.echeance, date(31, 10, 23))
        // « Avant vendredi, … » : le lien en tête part avec la date.
        XCTAssertEqual(analyse("Avant vendredi, envoyer le devis")?.reste, "Envoyer le devis")
    }

    // MARK: Contre-relecture des échéances (25/10)

    private func le(_ j: Int, _ m: Int, _ h: Int, _ mi: Int = 0, an: Int = 2026) -> Date { date(j, m, h, mi, an: an) }
    private func tache(_ t: String, _ maintenant: Date) -> (titre: String, echeance: Date?) {
        let d = AnalyseDate.extraire(t, maintenant: maintenant)
        return (GenreCapture.texte(t, date: d, genre: .tache), d?.echeance)
    }

    /// Whisper ponctue : « avant le 3. », « Avant le 3, payer… » restent des
    /// dates (constat bloquant). « le 3.2 du manuel » n'en est pas une.
    func testUnePonctuationApresLeNumeroGardeLaDate() {
        XCTAssertEqual(analyse("Payer la facture avant le 3.")?.echeance, date(2, 11, 23, 59))
        XCTAssertEqual(analyse("Payer la facture avant le 3.")?.reste, "Payer la facture")
        XCTAssertEqual(analyse("Payer la facture pour le 3.")?.echeance, date(3, 11, 23))
        XCTAssertEqual(analyse("Payer la facture le 3.")?.echeance, date(3, 11, 23))
        XCTAssertEqual(analyse("Payer la facture avant le 3, sinon pénalité")?.echeance, date(2, 11, 23, 59))
        for (p, e) in [("Avant le 3, payer la facture", date(2, 11, 23, 59)), ("Le 3, payer la facture", date(3, 11, 23)),
                       ("Pour le 3. Payer la facture", date(3, 11, 23))] {
            XCTAssertEqual(GenreCapture.deviner(p, maintenant: maintenant), .tache, p)
            XCTAssertEqual(tache(p, maintenant).titre, "Payer la facture", p)
            XCTAssertEqual(tache(p, maintenant).echeance, e, p)
        }
        XCTAssertNil(analyse("Lire le 3.2 du manuel"))
        XCTAssertNil(analyse("Lire le 3,5 du manuel"))
    }

    /// « vendredi de la semaine prochaine » : après le lundi qui vient, dit un
    /// lundi comme un jeudi. Les mots partent avec la date.
    func testUnJourDeLaSemaineProchaine() {
        let lundi = date(26, 10, 8)
        XCTAssertEqual(tache("Finir le site vendredi de la semaine prochaine", lundi).echeance, date(6, 11, 23))
        XCTAssertEqual(tache("Finir le site vendredi de la semaine prochaine", lundi).titre, "Finir le site")
        XCTAssertEqual(tache("Finir le site mardi de la semaine prochaine", lundi).echeance, date(3, 11, 23), "pas demain")
        XCTAssertEqual(tache("Finir le site vendredi la semaine prochaine", lundi).echeance, date(6, 11, 23))
        XCTAssertEqual(tache("Finir le site vendredi de la semaine prochaine", maintenant).echeance, date(23, 10, 23))
        XCTAssertEqual(tache("Finir le site jeudi de la semaine prochaine", maintenant).echeance, date(22, 10, 23), "dit un jeudi")
        XCTAssertEqual(tache("Appeler Hugo samedi cette semaine", maintenant).titre, "Appeler Hugo")
        XCTAssertEqual(tache("Appeler Hugo samedi cette semaine", maintenant).echeance, date(17, 10, 23))
    }

    /// « début / milieu / mi- (de la) semaine prochaine » : des flous, pas le
    /// dimanche (il tomberait après la période voulue). Le titre reste entier.
    func testLesFlousDeLaSemaineProchaine() {
        let lundi = date(26, 10, 8)
        for p in ["Rendre le dossier au début de la semaine prochaine", "Rendre le dossier en début de semaine prochaine",
                  "Rendre le dossier milieu de la semaine prochaine", "Rendre le dossier en milieu de semaine prochaine",
                  "Rendre le dossier mi-semaine prochaine", "Rendre le dossier courant de la semaine prochaine",
                  "Rendre le dossier en début de semaine"] {
            XCTAssertNil(AnalyseDate.extraire(p, maintenant: lundi), p)
            XCTAssertEqual(tache(p, lundi).titre, p)
        }
    }

    /// « le 20 du mois prochain » : le 20 du mois qui suit, même s'il reste
    /// un 20 ce mois-ci ; les mots partent avec la date.
    func testLeNumeroDuMoisProchain() {
        XCTAssertEqual(analyse("Payer la facture pour le 20 du mois prochain")?.echeance, date(20, 11, 23))
        XCTAssertEqual(analyse("Payer la facture pour le 20 du mois prochain")?.reste, "Payer la facture")
        XCTAssertEqual(analyse("Payer la facture le 20 du mois prochain")?.echeance, date(20, 11, 23))
        XCTAssertEqual(AnalyseDate.extraire("Payer la facture avant le 3 du mois prochain", maintenant: date(1, 10, 9))?.echeance, date(2, 11, 23, 59))
        XCTAssertEqual(AnalyseDate.extraire("Payer la facture le 31 du mois prochain", maintenant: date(1, 10, 9))?.echeance, date(31, 12, 23),
                       "novembre n'a pas de 31 : le suivant qui en a un")
        XCTAssertNil(analyse("Payer le loyer le 5 du mois"), "chaque mois : pas une date")
    }

    /// « avant le 3 » + une heure ou un moment : l'heure dite fixe la borne,
    /// le 3 ; la veille stricte ne joue que pour un jour sans heure.
    func testAvantLe3AvecUneHeure() {
        XCTAssertEqual(analyse("Payer la facture avant le 3 à 14h")?.quand, date(3, 11, 14))
        XCTAssertEqual(analyse("Rendre le dossier avant le 3 novembre à midi")?.quand, date(3, 11, 12))
        XCTAssertEqual(analyse("Rendre le dossier avant le 3/11 a 18h")?.quand, date(3, 11, 18))
        XCTAssertEqual(analyse("Payer la facture avant le 3 au soir")?.quand, date(3, 11, 20))
        XCTAssertEqual(analyse("Payer la facture avant le 3")?.echeance, date(2, 11, 23, 59), "sans heure : toujours la veille")
    }

    /// L'aperçu montre l'année quand ce n'est pas celle-ci : « fin août » dit
    /// le 1er novembre vise 2027 (passée depuis plus de 31 jours ⇒ année suivante).
    func testLAnneeSeVoitQuandElleChange() {
        let premierNovembre = date(1, 11, 10)
        let e = AnalyseDate.extraire("Rendre le dossier fin août", maintenant: premierNovembre)?.echeance
        XCTAssertEqual(e, date(31, 8, 23, an: 2027))
        XCTAssertEqual(e.map { Format.echeanceLongue($0, maintenant: premierNovembre) }, "mardi 31 août 2027")
        XCTAssertEqual(Format.echeanceLongue(date(30, 10, 23), maintenant: maintenant), "vendredi 30 octobre", "cette année : pas d'année")
        XCTAssertEqual(Format.echeanceLongue(date(1, 1, 23, an: 2027), maintenant: date(31, 12, 10)), "vendredi 1 janvier 2027")
        let q = AnalyseDate.extraire("Rappelle-moi de rendre le dossier fin août", maintenant: premierNovembre)?.quand
        XCTAssertEqual(q, date(31, 8, 9, an: 2027))
        XCTAssertTrue(q.map { CarnetModel.quand($0.millis, maintenant: premierNovembre).contains("2027") } == true, "l'aperçu du rappel aussi")
        XCTAssertFalse(CarnetModel.quand(date(30, 10, 9).millis, maintenant: maintenant).contains("2026"))
    }

    /// Non-régression de #16 : un « Avant » en tête qui ne mène pas à la date
    /// reste ; celui qui y mène part avec elle.
    func testAvantEnTeteNePartQuAvecSaDate() {
        for (p, reste) in [("Avant la réunion, relire le dossier demain", "Avant la réunion, relire le dossier"),
                           ("Avant les vacances, réserver l'hôtel lundi", "Avant les vacances, réserver l'hôtel"),
                           ("Avant de partir, fermer le gaz demain", "Avant de partir, fermer le gaz"),
                           ("D'ici là, finir le site vendredi", "D'ici là, finir le site")] {
            XCTAssertEqual(analyse(p)?.reste, reste, p)
            XCTAssertEqual(tache(p, maintenant).titre, reste, p)
        }
        for p in ["Avant vendredi, envoyer le devis", "D'ici demain, envoyer le devis", "Envoyer le devis avant vendredi",
                  "Envoyer le devis d'ici demain", "Envoyer le devis au plus tard vendredi"] {
            XCTAssertEqual(analyse(p)?.reste, "Envoyer le devis", p)
        }
    }

    /// Le texte d'un rappel (feuille « Nouveau rappel » comme « + ») ne perd
    /// jamais un morceau du milieu de sa phrase.
    func testLeTexteDUnRappelResteEntier() {
        for p in ["Payer la facture de fin octobre à Hugo", "Préparer la réunion de la semaine prochaine avec Hugo",
                  "Relire le bilan de la fin du mois"] {
            XCTAssertEqual(GenreCapture.texte(p, date: analyse(p), genre: .rappel), p, p)
        }
    }

    /// La dictée perd l'apostrophe : « d ici », « jusqu a » mènent quand même à
    /// la date, et ne restent pas au bout du titre.
    func testSansApostrophe() {
        for (p, titre, e) in [("Rendre le dossier d ici fin octobre", "Rendre le dossier", date(31, 10, 23)),
                              ("rendre le dossier d ici la fin du mois", "Rendre le dossier", date(31, 10, 23)),
                              ("finir le site d ici la fin de la semaine", "Finir le site", date(18, 10, 23)),
                              ("Payer la facture d ici le 3", "Payer la facture", date(3, 11, 23)),
                              ("Rendre le dossier jusqu a la fin du mois", "Rendre le dossier", date(31, 10, 23)),
                              ("payer la facture jusqu au 3", "Payer la facture", date(3, 11, 23)),
                              ("Rendre le dossier au plus tard la semaine prochaine", "Rendre le dossier", date(25, 10, 23)),
                              ("Envoyer le devis d ici vendredi", "Envoyer le devis", date(16, 10, 23))] {
            XCTAssertEqual(tache(p, maintenant).titre, titre, p)
            XCTAssertEqual(tache(p, maintenant).echeance, e, p)
        }
    }

    /// Un rappel sans heure qui tombe aujourd'hui, 9 h passé : il sonne à la
    /// prochaine heure pleine, jamais dans le passé. L'échéance d'une tâche
    /// reste la fin du jour.
    func testUnRappelDuJourNeSonneJamaisDansLePasse() {
        for (p, dit, jour) in [("Rappelle-moi de payer la facture avant le 3", date(2, 11, 10), date(2, 11, 11)),
                               ("Rappelle-moi de rendre le dossier fin octobre", date(31, 10, 10), date(31, 10, 11)),
                               ("Rappelle-moi cette semaine d'appeler Hugo", date(25, 10, 10, 20), date(25, 10, 11)),
                               ("Rappelle-moi avant le 3 d'appeler Hugo", date(3, 11, 10), date(3, 11, 11)),
                               ("Rappelle-moi aujourd'hui d'appeler Hugo", date(15, 10, 10, 40), date(15, 10, 11))] {
            let r = AnalyseDate.extraire(p, maintenant: dit)
            XCTAssertEqual(r?.quand, jour, p)
            XCTAssertEqual(r?.heureDite, false, p)
            XCTAssertGreaterThan(r?.quand ?? .distantPast, dit, p)
        }
        XCTAssertEqual(AnalyseDate.extraire("Payer la facture avant le 3", maintenant: date(2, 11, 10))?.echeance, date(2, 11, 23, 59))
        let tard = date(15, 10, 23, 30)
        XCTAssertEqual(AnalyseDate.extraire("Rappelle-moi aujourd'hui d'appeler Hugo", maintenant: tard)?.quand, tard.addingTimeInterval(600))
        XCTAssertEqual(analyse("Rappelle-moi demain d'appeler Hugo")?.quand, date(16, 10, 9), "un autre jour : 9 h, comme avant")
    }

    /// Un nombre qui n'est pas un jour : l'objet d'un verbe seul, une course,
    /// un « 5 à 7 ».
    func testUnNombreQuiNEstPasUnJour() {
        for p in ["Appeler le 15", "S'inscrire pour le 10 km", "Acheter du vin pour le 5 a 7", "Réserver pour le 4 personnes"] {
            XCTAssertNil(analyse(p), p)
        }
        XCTAssertEqual(analyse("Appeler Hugo le 3 à 14h")?.quand, date(3, 11, 14), "une heure, elle, reste une heure")
        XCTAssertEqual(analyse("Appeler le garage le 15")?.echeance, date(15, 10, 23))
    }

    /// « le 3 » au milieu d'une phrase naturelle : devant un moment, ou après
    /// « rappelle-moi ».
    func testLe3AuMilieuDUnePhrase() {
        XCTAssertEqual(analyse("Rappelle-moi le 3 d'appeler Hugo")?.quand, date(3, 11, 9))
        XCTAssertEqual(analyse("Rappelle-moi le 3 d'appeler Hugo")?.reste, "Appeler Hugo")
        XCTAssertEqual(analyse("Payer la facture le 3 dans la matinée")?.quand, date(3, 11, 9))
        XCTAssertNil(analyse("Relire le 3 de la liste"), "sans « rappelle-moi », « le 3 de » n'est pas une date")
    }

    /// « avant <jour nommé> » (27/10) : jusqu'à la fin de la veille, 23 h 59,
    /// comme « avant le 3 ». Une heure dite fixe la borne : ce jour-là, à
    /// cette heure. « avant mardi » dit un mardi : celui qui vient.
    func testAvantUnJourNommeEstLaVeille() {
        let lundi = date(26, 10, 8)
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier avant mardi", maintenant: lundi)?.echeance, date(26, 10, 23, 59), "lundi 23 h 59")
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier avant mardi", maintenant: lundi)?.reste, "Rendre le dossier")
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier avant vendredi", maintenant: lundi)?.echeance, date(29, 10, 23, 59))
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier avant lundi", maintenant: lundi)?.echeance, date(1, 11, 23, 59),
                       "dit un lundi : le lundi qui vient, la veille change de mois")
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier avant lundi prochain", maintenant: date(25, 10, 9))?.echeance, date(25, 10, 23, 59))
        XCTAssertEqual(analyse("Rendre le dossier avant demain")?.echeance, date(15, 10, 23, 59), "avant demain : ce soir")
        XCTAssertEqual(analyse("Rendre le dossier avant après-demain")?.echeance, date(16, 10, 23, 59))
        XCTAssertEqual(analyse("rendre le dossier avant apres demain")?.echeance, date(16, 10, 23, 59), "dictée sans accent")
        XCTAssertEqual(analyse("Rendre le dossier avant samedi")?.echeance, date(16, 10, 23, 59))
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier avant samedi", maintenant: date(31, 10, 9))?.echeance, date(6, 11, 23, 59),
                       "dit un samedi : le suivant")
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier avant mardi", maintenant: date(29, 12, 9))?.echeance, date(4, 1, 23, 59, an: 2027),
                       "dit un mardi : la veille du suivant, l'an prochain")
        // Avec une heure : ce jour-là, à cette heure.
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier avant mardi 14h", maintenant: lundi)?.echeance, date(27, 10, 14))
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier avant mardi à 14h", maintenant: lundi)?.heureDite, true)
        XCTAssertEqual(analyse("Rendre le dossier avant demain midi")?.echeance, date(16, 10, 12))
        XCTAssertEqual(analyse("Rendre le dossier avant vendredi soir")?.quand, date(16, 10, 20))
        // « pour », « d'ici » : le jour dit, 23 h, comme avant.
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier pour mardi", maintenant: lundi)?.echeance, date(27, 10, 23))
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier d'ici mardi", maintenant: lundi)?.echeance, date(27, 10, 23))
        XCTAssertEqual(analyse("Rendre le dossier demain")?.echeance, date(16, 10, 23))
        // Un rappel « avant mardi » sonne la veille au matin ; le genre ne change pas.
        XCTAssertEqual(AnalyseDate.extraire("Rappelle-moi avant mardi d'appeler Hugo", maintenant: lundi)?.quand, date(26, 10, 9))
        XCTAssertEqual(GenreCapture.deviner("Envoyer le devis avant mardi", maintenant: lundi), .tache)
        XCTAssertEqual(tache("Avant mardi, envoyer le devis", lundi).titre, "Envoyer le devis")
    }

    /// « début novembre » : le 5, 23 h (27/10) ; « fin novembre » : le
    /// dernier jour. Les bords de mois et l'année qui change.
    func testDebutDuMoisEstLe5() {
        for p in ["Préparer Noël début novembre", "Préparer Noël debut novembre", "Préparer Noël au début de novembre",
                  "Préparer Noël en début de novembre", "Préparer Noël d'ici début novembre", "Préparer Noël début nov.",
                  "Préparer Noël début du mois prochain"] {
            let r = analyse(p)
            XCTAssertEqual(r?.echeance, date(5, 11, 23), p)
            XCTAssertEqual(r?.heureDite, false, p)
            XCTAssertEqual(r?.reste, "Préparer Noël", p)
            XCTAssertNil(r?.dejaPassee, p)
            XCTAssertEqual(GenreCapture.deviner(p, maintenant: maintenant), .tache, p)
        }
        XCTAssertEqual(analyse("Rappelle-moi début novembre de préparer Noël")?.quand, date(5, 11, 9))
        XCTAssertEqual(analyse("Payer la taxe début janvier")?.echeance, date(5, 1, 23, an: 2027), "l'an prochain, mois après mois")
        XCTAssertEqual(analyse("Payer la taxe debut fevrier")?.echeance, date(5, 2, 23, an: 2027), "dictée sans accent")
        XCTAssertEqual(analyse("Payer la taxe début décembre 2027")?.echeance, date(5, 12, 23, an: 2027))
        XCTAssertEqual(AnalyseDate.extraire("Payer la taxe début janvier", maintenant: date(20, 12, 9))?.echeance, date(5, 1, 23, an: 2027))
        XCTAssertEqual(AnalyseDate.extraire("Payer la taxe début novembre", maintenant: date(5, 11, 9))?.echeance, date(5, 11, 23), "le 5 même : ce soir")
        XCTAssertEqual(AnalyseDate.extraire("Payer la taxe fin decembre", maintenant: date(1, 12, 9))?.echeance, date(31, 12, 23), "sans accent")
        XCTAssertEqual(AnalyseDate.extraire("Payer la taxe fin aout", maintenant: date(1, 8, 9))?.echeance, date(31, 8, 23))
        XCTAssertEqual(AnalyseDate.extraire("Payer la taxe fin février", maintenant: date(1, 2, 9, an: 2028))?.echeance, date(29, 2, 23, an: 2028),
                       "bissextile")
    }

    /// Une fin ou un début de mois déjà passés depuis 31 jours au plus :
    /// aujourd'hui (en retard de fait), jamais l'an prochain ; l'aperçu le dit.
    /// Au-delà de 31 jours : l'année suivante.
    func testUneFinDeMoisDejaPasseeTombeAujourdhui() {
        let deuxNovembre = date(2, 11, 10)
        let r = AnalyseDate.extraire("Rendre le dossier fin octobre", maintenant: deuxNovembre)
        XCTAssertEqual(r?.echeance, date(2, 11, 23), "ce soir")
        XCTAssertEqual(r?.reste, "Rendre le dossier")
        XCTAssertEqual(r?.dejaPassee, "fin octobre, déjà passée : ce soir")
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier début novembre", maintenant: date(7, 11, 10))?.dejaPassee,
                       "début novembre, déjà passé : ce soir")
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier début novembre", maintenant: date(7, 11, 10))?.echeance, date(7, 11, 23))
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier fin octobre", maintenant: date(30, 11, 10))?.echeance, date(30, 11, 23),
                       "30 jours : encore en retard")
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier fin octobre", maintenant: date(1, 12, 10))?.echeance, date(1, 12, 23),
                       "31 jours tout juste : en retard")
        let apres = AnalyseDate.extraire("Rendre le dossier fin octobre", maintenant: date(2, 12, 10))
        XCTAssertEqual(apres?.echeance, date(31, 10, 23, an: 2027), "32 jours : l'an prochain")
        XCTAssertNil(apres?.dejaPassee)
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier fin decembre", maintenant: date(3, 1, 10, an: 2027))?.echeance,
                       date(3, 1, 23, an: 2027), "décembre d'il y a trois jours, par-dessus le nouvel an")
        XCTAssertEqual(AnalyseDate.extraire("Rendre le dossier début du mois", maintenant: date(20, 10, 10))?.dejaPassee,
                       "début du mois, déjà passé : ce soir")
        XCTAssertNil(AnalyseDate.extraire("Rendre le dossier fin du mois", maintenant: date(20, 10, 10))?.dejaPassee)
        // Le rappel sonne dans l'heure, jamais dans le passé.
        let rappel = AnalyseDate.extraire("Rappelle-moi de rendre le dossier fin octobre", maintenant: deuxNovembre)
        XCTAssertEqual(rappel?.quand, date(2, 11, 11))
        XCTAssertEqual(GenreCapture.deviner("Rendre le dossier fin octobre", maintenant: deuxNovembre), .tache)
        // Une heure dite : pas de « ce soir » inventé.
        XCTAssertNil(AnalyseDate.extraire("Rendre le dossier fin octobre à 18h", maintenant: deuxNovembre)?.dejaPassee)
    }

    /// Contre-relecture : le texte d'une tâche ne perd jamais un morceau de
    /// sa phrase ; la date ne s'en retire que si elle était au bout.
    func testLeTexteDUneTacheResteEntier() {
        func texte(_ t: String, _ g: GenreCapture) -> String {
            GenreCapture.texte(t, date: AnalyseDate.extraire(t, maintenant: maintenant), genre: g)
        }
        XCTAssertEqual(texte("Envoyer le devis vendredi", .tache), "Envoyer le devis")
        XCTAssertEqual(texte("Demain, appeler le plombier", .tache), "Appeler le plombier")
        XCTAssertEqual(texte("Vendredi : envoyer le devis", .tache), "Envoyer le devis")
        XCTAssertEqual(texte("Préparer la réunion de demain avec Hugo", .tache), "Préparer la réunion de demain avec Hugo")
        XCTAssertEqual(texte("Relire le compte rendu de lundi", .tache), "Relire le compte rendu de lundi")
        XCTAssertEqual(texte("Payer la facture du 12/11", .tache), "Payer la facture du 12/11")
        XCTAssertEqual(texte("Préparer la sortie de dimanche avec Léa", .tache), "Préparer la sortie de dimanche avec Léa")
        XCTAssertEqual(texte("Envoyer le devis jeudi ou vendredi", .tache), "Envoyer le devis jeudi ou vendredi")
        XCTAssertEqual(texte("Rappelle-moi d'envoyer le devis vendredi", .tache), "Envoyer le devis", "genre changé à la main")
        XCTAssertEqual(texte("Préparer la réunion de 14h", .tache), "Préparer la réunion de 14h", "l'heure dite reste")
        XCTAssertEqual(texte("Appeler le garage demain à 9h", .tache), "Appeler le garage demain à 9h")
        XCTAssertEqual(texte("Appeler le garage demain à 9h", .rappel), "Appeler le garage", "le rappel sonne à 9 h")
        XCTAssertEqual(texte("Rappelle-moi de préparer la réunion de demain avec Hugo", .rappel), "Préparer la réunion de demain avec Hugo")
        XCTAssertEqual(texte("Acheter du pain", .tache), "Acheter du pain")
        XCTAssertEqual(texte("Rappelle-moi d'acheter du pain", .rappel), "Acheter du pain")
        // Ces phrases restent des tâches, avec leur échéance.
        for p in ["Préparer la réunion de demain avec Hugo", "Relire le compte rendu de lundi", "Payer la facture du 12/11",
                  "Préparer la sortie de dimanche avec Léa"] {
            XCTAssertEqual(GenreCapture.deviner(p, maintenant: maintenant), .tache, p)
            XCTAssertEqual(AnalyseDate.extraire(p, maintenant: maintenant)?.heureDite, false, p)
        }
    }

    func testPasDeDate() {
        XCTAssertNil(analyse("Acheter du lait"))
        XCTAssertNil(analyse("Lire 5 heures de musique"))
    }

    // MARK: Genre de capture

    func testGenresDevines() {
        XCTAssertEqual(GenreCapture.deviner("tomates, lait, œufs", maintenant: maintenant), .liste)
        XCTAssertEqual(GenreCapture.deviner("tomates, lait et œufs", maintenant: maintenant), .liste)
        XCTAssertEqual(GenreCapture.deviner("Appeler le garage demain à 9h", maintenant: maintenant), .rappel)
        XCTAssertEqual(GenreCapture.deviner("Relire le contrat de Hugo", maintenant: maintenant), .tache)
        XCTAssertEqual(GenreCapture.articles("tomates, lait et œufs"), ["tomates", "lait", "œufs"])
        XCTAssertEqual(GenreCapture.articles("pommes"), ["pommes"])
        XCTAssertEqual(GenreCapture.articles("Je dois appeler le garage pour la voiture, puis passer à la banque"), [])
    }

    /// Parcours P07 : « Envoyer le devis vendredi » était deviné « Rappel »
    /// (vendredi 9 h). Une action avec un jour sans heure est une tâche à
    /// échéance ; un rappel, c'est une heure dite ou « rappelle-moi ».
    func testUneActionAvecUnJourEstUneTache() {
        XCTAssertEqual(GenreCapture.deviner("Envoyer le devis a Hugo vendredi", maintenant: maintenant), .tache)
        XCTAssertEqual(GenreCapture.deviner("Payer la cantine le 12/11", maintenant: maintenant), .tache)
        XCTAssertEqual(GenreCapture.deviner("Il faut que j'appelle le garage demain", maintenant: maintenant), .tache)
        XCTAssertEqual(GenreCapture.deviner("Envoyer le devis vendredi à 14h", maintenant: maintenant), .rappel, "une heure dite")
        XCTAssertEqual(GenreCapture.deviner("Rappelle-moi d'envoyer le devis vendredi", maintenant: maintenant), .rappel)
        XCTAssertEqual(GenreCapture.deviner("N'oublie pas de payer la cantine lundi", maintenant: maintenant), .rappel)
        XCTAssertEqual(GenreCapture.deviner("Anniversaire de Nina le 3 février", maintenant: maintenant), .rappel, "pas une action : un rappel")
        XCTAssertEqual(GenreCapture.deviner("Appeler le garage demain à 9h", maintenant: maintenant), .rappel)
        // Le jour en tête : l'action se lit sans lui.
        XCTAssertEqual(GenreCapture.deviner("lundi je dois rendre le dossier", maintenant: maintenant), .tache)
        XCTAssertEqual(GenreCapture.deviner("Demain, appeler le plombier", maintenant: maintenant), .tache)
        XCTAssertEqual(GenreCapture.deviner("Vendredi : envoyer le devis", maintenant: maintenant), .tache)
        XCTAssertEqual(GenreCapture.deviner("apres demain envoyer le devis", maintenant: maintenant), .tache)
        XCTAssertEqual(GenreCapture.deviner("Faire 2h de studio jeudi", maintenant: maintenant), .tache, "une durée, pas une heure")
        XCTAssertEqual(GenreCapture.deviner("Appeler le garage demain à 14 heures", maintenant: maintenant), .rappel)
        XCTAssertEqual(GenreCapture.deviner("Hugo préfère qu'on lui écrive, surtout le lundi.", maintenant: maintenant), .rappel,
                       "une information sans action reste un rappel")
        // Ce que Sam annonce passe avant la date.
        XCTAssertEqual(GenreCapture.deviner("idée : un clip en noir pour vendredi", maintenant: maintenant), .idee)
        XCTAssertEqual(GenreCapture.deviner("Idée : un clip en noir", maintenant: maintenant, parDefaut: .tache), .idee)
        XCTAssertEqual(GenreCapture.deviner("Projet bougies pour lundi", maintenant: maintenant), .projet)
    }

    // MARK: Carnet hors ligne

    private let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("remy-carnet-" + UUID().uuidString)

    override func tearDown() {
        try? FileManager.default.removeItem(at: dossier)
        super.tearDown()
    }

    private func app(capable: Bool) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)),
                         rangement: Rangement(dossier: dossier))
        if capable { a.serveur = VersionServeur(api: 1, serveur: "0.3.0", capacites: ["listes-v1", "rappels-v1"]) }
        return a
    }

    private func neuf(_ r: [String: [(Int, String)]] = [:], coupures: [String: Int] = [:]) {
        FauxServeur.reponses = r
        FauxServeur.coupures = coupures
        FauxServeur.recues = []
        FauxServeur.historique = [:]
        FauxServeur.corps = [:]
    }

    func testCoursesSansReseauPuisEnvoyees() async throws {
        neuf()
        let a = app(capable: false) // tour pas encore joignable : rien ne part
        let l = try XCTUnwrap(a.carnet.creerListe("Courses"))
        a.carnet.ajouter(GenreCapture.articles("tomates, lait, œufs"), a: l)
        let lait = try XCTUnwrap(a.carnet.listes[0].elements.first { $0.texte == "lait" })
        a.carnet.basculer(lait, dans: a.carnet.listes[0])
        XCTAssertEqual(a.carnet.enAttente.count, 3)
        XCTAssertEqual(a.carnet.listes[0].restants, 2)

        // L'app relancée retrouve tout sur l'iPhone, file comprise.
        let b = app(capable: true)
        XCTAssertEqual(b.carnet.listes.first?.elements.map(\.texte), ["tomates", "lait", "œufs"])
        XCTAssertEqual(b.carnet.enAttente.count, 3)
        neuf([
            "PUT /api/listes/\(l.id)": [(200, #"{"ok":true}"#)],
            "POST /api/listes/\(l.id)/elements": [(200, #"{"ok":true}"#)],
            "GET /api/listes": [(200, #"{"listes":[{"id":"\#(l.id)","nom":"Courses","elements":[{"id":"x","texte":"tomates","fait":false},{"id":"y"}]}]}"#)],
            "GET /api/rappels": [(200, #"{"rappels":[]}"#)],
        ])
        await b.carnet.charger()
        XCTAssertTrue(b.carnet.enAttente.isEmpty)
        // Les écritures dans l'ordre ; la relecture lit listes et rappels en parallèle.
        XCTAssertEqual(Array(FauxServeur.recues.prefix(3)), ["PUT /api/listes/\(l.id)", "POST /api/listes/\(l.id)/elements",
                                                             "POST /api/listes/\(l.id)/elements"], "dans l'ordre")
        XCTAssertEqual(Set(FauxServeur.recues.dropFirst(3)), ["GET /api/listes", "GET /api/rappels"], "puis la relecture")
        XCTAssertEqual(FauxServeur.recues.count, 5)
        let envoye = try XCTUnwrap(FauxServeur.historique["POST /api/listes/\(l.id)/elements"]?.last?["elements"] as? [[String: Any]])
        XCTAssertEqual(envoye.first?["fait"] as? Bool, true, "le lait coché")
        XCTAssertEqual(b.carnet.listes.first?.elements.map(\.texte), ["tomates"], "relu depuis la tour (l'article illisible est sauté)")
    }

    func testCoupureGardeLaFile() async throws {
        neuf()
        let a = app(capable: false)
        let l = try XCTUnwrap(a.carnet.creerListe("Pharmacie"))
        neuf(coupures: ["PUT /api/listes/\(l.id)": 1])
        a.serveur = VersionServeur(api: 1, serveur: "0.3.0", capacites: ["listes-v1"])
        await a.carnet.envoyer()
        XCTAssertEqual(a.carnet.enAttente.count, 1, "toujours sur l'iPhone")
        XCTAssertEqual(a.carnet.listes.count, 1)
    }

    func testRefusDeLaTourLeDitEtRelit() async throws {
        neuf()
        let a = app(capable: false)
        let l = try XCTUnwrap(a.carnet.creerListe("Courses"))
        a.carnet.ajouter(["pain"], a: l)
        neuf([
            "PUT /api/listes/\(l.id)": [(200, #"{"ok":true}"#)],
            "POST /api/listes/\(l.id)/elements": [(409, #"{"error":"carnet","message":"Pas plus de 500 articles par liste."}"#)],
            "GET /api/listes": [(200, #"{"listes":[]}"#)],
            "GET /api/rappels": [(200, #"{"rappels":[]}"#)],
        ])
        a.serveur = VersionServeur(api: 1, serveur: "0.3.0", capacites: ["listes-v1"])
        await a.carnet.envoyer()
        XCTAssertTrue(a.carnet.enAttente.isEmpty)
        XCTAssertTrue(FauxServeur.recues.contains("GET /api/listes"), "la tour fait foi : relue")
    }

    func testRappelsTriesEtImport() {
        neuf()
        let a = app(capable: false)
        a.carnet.creerRappel("Idée cadeau", quand: nil)
        a.carnet.creerRappel("Appeler le garage", quand: date(16, 10, 9))
        a.carnet.importer([Rappel(id: "apple:1", texte: "Payer la cantine", quand: date(15, 10, 18).millis, source: "apple"),
                           Rappel(id: "apple:1", texte: "Payer la cantine", quand: date(15, 10, 18).millis, source: "apple")],
                          listes: [Liste(id: "apple-liste:A", nom: "Courses", elements: [ElementListe(id: "apple:2", texte: "farine")])])
        XCTAssertEqual(a.carnet.rappels.map(\.texte), ["Payer la cantine", "Appeler le garage", "Idée cadeau"])
        XCTAssertEqual(a.carnet.listes.first?.elements.map(\.texte), ["farine"])
        let r = a.carnet.rappels[0]
        a.carnet.basculer(r)
        XCTAssertEqual(a.carnet.rappels.last?.id, "apple:1", "fait : en dernier")
    }

    /// Sam, 18/10 : un rappel sans date, ou sans catégorie, est « à traiter ».
    func testRappelsATraiterPuisRanges() {
        neuf()
        let a = app(capable: false)
        let sansDate = a.carnet.creerRappel("Caler le contrôle technique", quand: nil, etiquettes: ["voiture"])
        let sansCategorie = a.carnet.creerRappel("Appeler le garage", quand: date(16, 10, 9))
        a.carnet.creerRappel("Payer le loyer", quand: date(17, 10, 9), etiquettes: ["admin"])
        a.carnet.creerRappel("Ancienne étiquette", quand: date(17, 10, 9), etiquettes: ["supprimee"])
        let etiquettes: Set<String> = ["voiture", "admin"]
        XCTAssertEqual(CarnetModel.aTraiter(a.carnet.rappels, etiquettes: etiquettes).map(\.texte),
                       ["Appeler le garage", "Ancienne étiquette", "Caler le contrôle technique"])
        XCTAssertEqual(CarnetModel.aTraiter(a.carnet.rappels, etiquettes: []).map(\.texte), ["Caler le contrôle technique"],
                       "sans catégorie sur le compte : seule la date compte")
        // Ranger : date et catégorie d'un coup, en une seule écriture.
        a.carnet.ranger(try! XCTUnwrap(sansDate), quand: date(20, 10, 14, 30), etiquettes: ["voiture"])
        a.carnet.ranger(try! XCTUnwrap(sansCategorie), quand: date(16, 10, 9), etiquettes: ["voiture"])
        XCTAssertEqual(CarnetModel.aTraiter(a.carnet.rappels, etiquettes: etiquettes).map(\.texte), ["Ancienne étiquette"])
        XCTAssertEqual(a.carnet.rappels.first { $0.texte == "Caler le contrôle technique" }?.quand, date(20, 10, 14, 30).millis)
        let fait = try! XCTUnwrap(a.carnet.rappels.first { $0.texte == "Ancienne étiquette" })
        a.carnet.basculer(fait)
        XCTAssertTrue(CarnetModel.aTraiter(a.carnet.rappels, etiquettes: etiquettes).isEmpty, "un rappel fait n'attend plus rien")
    }

    func testDeconnexionEffaceLeCarnet() async {
        neuf()
        let a = app(capable: false)
        a.carnet.creerListe("Courses")
        await a.deconnecter()
        XCTAssertFalse(FileManager.default.fileExists(atPath: dossier.appendingPathComponent("carnet.json").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: dossier.appendingPathComponent("envoi-carnet.json").path))
        XCTAssertTrue(app(capable: false).carnet.listes.isEmpty)
    }

    // MARK: Modifier, bloquer

    func testModifierEnvoieLesChampsChanges() async throws {
        neuf([
            "GET /api/dashboard": [(200, "{}")],
            "POST /api/motion/apply": [(200, #"{"ledgerId":"L2","echecs":0,"results":[{"ok":true,"type":"modifier"}]}"#)],
        ])
        let a = app(capable: false)
        let ok = await a.tableau.modifier(id: "t1", titre: "Devis", nouveauTitre: "Devis tennis", echeance: nil, duree: 45, priorite: "HIGH")
        XCTAssertTrue(ok)
        let action = try XCTUnwrap((FauxServeur.corps["POST /api/motion/apply"]?["actions"] as? [[String: Any]])?.first)
        XCTAssertEqual(action["type"] as? String, "modifier")
        XCTAssertEqual(action["nom"] as? String, "Devis")
        XCTAssertEqual(action["nouveau_nom"] as? String, "Devis tennis")
        XCTAssertEqual(action["duree"] as? Double, 45)
        XCTAssertEqual(action["priorite"] as? String, "HIGH")
        XCTAssertNil(action["echeance"])
        XCTAssertEqual(a.toast, "« Devis tennis » : modifiée.")
    }

    func testBloquerSeVoitTouteDeSuiteEtSAnnule() async throws {
        let journee = #"{"journee":{"jour":"2026-10-15","items":[{"type":"tache","id":"t1","titre":"Devis","debut":1790152200000}],"aFaire":[{"id":"t2","titre":"Facture"}],"sources":{"motion":"ok"}}}"#
        neuf(["GET /api/dashboard": [(200, journee)], "PUT /api/taches/t1/etat": [(200, #"{"ok":true}"#)]])
        let a = app(capable: false)
        await a.tableau.charger()
        let ok = await a.tableau.bloquer(id: "t1", titre: "Devis", bloquee: true, raison: "J'attends le client")
        XCTAssertTrue(ok)
        XCTAssertEqual(a.tableau.journee?.items?.first?.bloquee, true)
        XCTAssertEqual(a.tableau.journee?.items?.first?.raison, "J'attends le client")
        XCTAssertEqual(FauxServeur.corps["PUT /api/taches/t1/etat"]?["raison"] as? String, "J'attends le client")
        XCTAssertEqual(a.toast, "« Devis » : en attente.")

        neuf(["PUT /api/taches/t2/etat": [(500, #"{"error":"x","message":"Base illisible"}"#)]])
        let echec = await a.tableau.bloquer(id: "t2", titre: "Facture", bloquee: true)
        XCTAssertFalse(echec)
        XCTAssertNotEqual(a.tableau.journee?.aFaire?.first?.bloquee, true, "refusé : la marque revient en arrière")
    }
}
