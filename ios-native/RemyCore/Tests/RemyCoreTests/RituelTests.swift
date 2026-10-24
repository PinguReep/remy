import XCTest
@testable import RemyCore

/// Le rendez-vous quotidien (24/10) : quand les notifications partent, ce
/// qu'elles disent (honnêtes si préparées la veille), et le geste du soir.
final class RituelTests: XCTestCase {
    var cal: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Paris")!
        return c
    }

    func date(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }

    let json = """
    {"maintenant": 1792787400000,
     "sources": {"motion": "ok", "agenda": "ok"},
     "aujourdhui": {"pour": "2026-10-23", "jour": "vendredi 23 octobre", "titre": "Ta journée — vendredi 23 octobre",
       "compte": "Ce qui compte : « Finaliser la démo », avant 16:00.", "pourquoi": "Pourquoi : priorité importante.",
       "menace": "Menacée : « Facture Ondine » — due aujourd'hui 17:00, aucun créneau prévu.", "resume": "1 rendez-vous",
       "menacees": [{"id": "t3", "titre": "Facture Ondine", "echeance": 1792818000000, "raison": "sans-creneau",
                     "phrase": "Due aujourd'hui 17:00, aucun créneau prévu.", "action": {"type": "caser", "libelle": "Demander à Rémy de la caser"}}],
       "sujets": 1},
     "demain": {"pour": "2026-10-24", "titre": "Ta journée — samedi 24 octobre", "compte": "Journée libre : aucun rendez-vous ni échéance.",
       "pourquoi": "Pourquoi : rien d'autre n'est fixé ce jour-là.", "menace": "Rien de menacé : la journée tient."},
     "soir": {"jour": "2026-10-23", "fait": ["Trier la boîte mail"], "glisse": [{"id": "t2", "titre": "Relire le contrat"}],
       "reste": [{"id": "t2", "titre": "Relire le contrat", "echeance": 1792825200000, "versDemain": 1792911600000}],
       "phrase": "1 fait, 1 reste pour aujourd'hui."},
     "menacees": []}
    """

    func rituel() throws -> RituelTour { try JSONDecoder().decode(RituelTour.self, from: Data(json.utf8)) }

    func testLaReponseDeLaTourSeLit() throws {
        let r = try rituel()
        XCTAssertEqual(r.aujourdhui?.menacees?.first?.action?.type, "caser")
        XCTAssertEqual(r.soir?.reste.first?.id, "t2")
        XCTAssertEqual(r.demain?.menacees, nil, "champs absents tolérés")
    }

    func testLesProchainsPassages() {
        let soir = date("2026-10-23T20:00:00Z") // 22 h à Paris
        let p = Rituel.prochains(minutes: 7 * 60 + 30, apres: soir, nombre: 3, calendrier: cal)
        XCTAssertEqual(p.map { Rituel.cleJour($0, calendrier: cal) }, ["2026-10-24", "2026-10-25", "2026-10-26"])
        XCTAssertEqual(cal.component(.hour, from: p[2]), 7, "même heure après le passage à l'heure d'hiver")
        // Avant l'heure : le premier passage est aujourd'hui.
        let matin = date("2026-10-23T04:00:00Z") // 6 h
        XCTAssertEqual(Rituel.prochains(minutes: 7 * 60 + 30, apres: matin, nombre: 1, calendrier: cal).map { Rituel.cleJour($0, calendrier: cal) }, ["2026-10-23"])
    }

    func testLeBriefingDuBonJour() throws {
        let r = try rituel()
        XCTAssertEqual(Rituel.briefing(pour: date("2026-10-24T05:30:00Z"), dans: r, calendrier: cal)?.pour, "2026-10-24")
        XCTAssertEqual(Rituel.briefing(pour: date("2026-10-23T05:30:00Z"), dans: r, calendrier: cal)?.pour, "2026-10-23")
        XCTAssertNil(Rituel.briefing(pour: date("2026-10-26T05:30:00Z"), dans: r, calendrier: cal), "jamais le briefing d'un autre jour")
    }

    func testUneNotificationPrepareeLaVeilleLeDit() throws {
        let r = try rituel()
        let declenchement = date("2026-10-24T05:30:00Z")
        let veille = date("2026-10-23T20:10:00Z")
        let n = Rituel.notificationMatin(Rituel.briefing(pour: declenchement, dans: r, calendrier: cal), prepareA: veille,
                                         declenchement: declenchement, calendrier: cal)
        XCTAssertEqual(n.titre, "Ta journée — samedi 24 octobre")
        XCTAssertEqual(n.corps.split(separator: "\n").count, 3, "trois lignes")
        XCTAssertTrue(n.sousTitre?.hasPrefix("Préparé hier à") == true, n.sousTitre ?? "")
        // Fraîche (rafraîchie en arrière-plan une heure avant) : rien à dire.
        let frais = Rituel.notificationMatin(r.demain, prepareA: date("2026-10-24T04:40:00Z"), declenchement: declenchement, calendrier: cal)
        XCTAssertNil(frais.sousTitre)
        // Rien pour ce jour : elle n'invente rien.
        let rien = Rituel.notificationMatin(nil, prepareA: veille, declenchement: declenchement, calendrier: cal)
        XCTAssertTrue(rien.corps.contains("Ouvre Rémy"))
    }

    func testLeSoirNeReprendQueLeBilanDuJour() throws {
        let r = try rituel()
        let fin = date("2026-10-23T18:00:00Z") // relu à 20 h
        XCTAssertTrue(Rituel.notificationSoir(r.soir, prepareA: fin, declenchement: date("2026-10-23T19:30:00Z"), calendrier: cal).corps.hasPrefix("1 fait"))
        XCTAssertTrue(Rituel.notificationSoir(r.soir, prepareA: fin, declenchement: date("2026-10-24T19:30:00Z"), calendrier: cal).corps.hasPrefix("Fait, glissé"))
    }

    func testLeSoirNeDitPasDesChiffresDuMatin() throws {
        let r = try rituel()
        // Relu à 8 h : « 1 fait » serait faux à 21 h 30, la notification reste générique.
        let n = Rituel.notificationSoir(r.soir, prepareA: date("2026-10-23T06:00:00Z"), declenchement: date("2026-10-23T19:30:00Z"), calendrier: cal)
        XCTAssertTrue(n.corps.hasPrefix("Fait, glissé"), n.corps)
        XCTAssertTrue(Rituel.notificationSoir(r.soir, prepareA: nil, declenchement: date("2026-10-23T19:30:00Z"), calendrier: cal).corps.hasPrefix("Fait, glissé"))
    }

    func testUneSourceMuetteResteDiteMemeAncienne() throws {
        var b = try rituel().demain!
        b.avertissement = "Motion n'a pas répondu : ce briefing peut être incomplet."
        let n = Rituel.notificationMatin(b, prepareA: date("2026-10-23T20:10:00Z"), declenchement: date("2026-10-24T05:30:00Z"), calendrier: cal)
        XCTAssertTrue(n.sousTitre?.hasPrefix("Préparé hier") == true)
        XCTAssertTrue(n.corps.contains("Motion n'a pas répondu"), n.corps)
    }

    func testLeReveilEnFondVisePlusProche() {
        let apres = date("2026-10-23T12:00:00Z") // 14 h à Paris
        XCTAssertNil(Rituel.prochainReveil(ReglagesRituel(), apres: apres, calendrier: cal), "coupé : aucun réveil")
        let matin = Rituel.prochainReveil(ReglagesRituel(matin: true), apres: apres, calendrier: cal)
        XCTAssertEqual(matin.map { Rituel.cleJour($0, calendrier: cal) }, "2026-10-24")
        XCTAssertEqual(matin.map { cal.component(.hour, from: $0) }, 6, "une heure avant 7 h 30")
        // Le soir allumé aussi : le bilan de ce soir passe avant le briefing de demain.
        let deux = Rituel.prochainReveil(ReglagesRituel(matin: true, soir: true), apres: apres, calendrier: cal)
        XCTAssertEqual(deux.map { Rituel.cleJour($0, calendrier: cal) }, "2026-10-23")
        XCTAssertEqual(deux.map { cal.component(.hour, from: $0) }, 20)
    }

    func testToutCeQuiResteADemainEnUneEcriture() throws {
        let p = Rituel.versDemain(try rituel().soir!.reste)
        XCTAssertEqual(p.source, "motion")
        XCTAssertEqual(p.actions.count, 1)
        XCTAssertEqual(p.actions.first?.type, "modifier")
        XCTAssertEqual(p.actions.first?.id, "t2")
        XCTAssertNotNil(p.actions.first?.echeance)
    }

    func testLaFraicheur() {
        let m = date("2026-10-23T08:00:00Z")
        XCTAssertEqual(Rituel.fraicheur(m.addingTimeInterval(-30), maintenant: m, calendrier: cal), "à l'instant")
        XCTAssertEqual(Rituel.fraicheur(m.addingTimeInterval(-12 * 60), maintenant: m, calendrier: cal), "il y a 12 min")
    }

    func testCoupeParDefaut() {
        let d = UserDefaults(suiteName: "rituel-tests-\(UUID().uuidString)")!
        let r = ReglagesRituel.lire(d)
        XCTAssertFalse(r.matin)
        XCTAssertFalse(r.soir)
        XCTAssertEqual(r.heureMatin, 7 * 60 + 30)
    }

    func testLeTableauPorteLesMenacees() throws {
        let t = try JSONDecoder().decode(TableauDeBord.self, from: Data("""
        {"menacees": [{"id": "t10", "titre": "Visuels", "raison": "apres-echeance", "phrase": "Planifiée demain 10:00, après son échéance (aujourd'hui 17:00).",
                       "action": {"type": "repousser", "libelle": "Repousser l'échéance à demain", "echeance": 1792900000000}},
                      {"id": 3}]}
        """.utf8))
        XCTAssertEqual(t.menacees?.map(\.id), ["t10"], "une menacée illisible est sautée, pas tout l'écran")
    }
}

/// La capture (24/10) : une pensée floue va dans les Idées, Motion seulement
/// si l'action est claire — ou si Sam l'a réglé ainsi.
final class CaptureIdeesTests: XCTestCase {
    func testUnePenseeFloueVaDansLesIdees() {
        XCTAssertEqual(GenreCapture.deviner("Un clip en noir pour le prochain son"), .idee)
        XCTAssertEqual(GenreCapture.deviner("Dossier subvention atelier"), .idee)
        XCTAssertEqual(GenreCapture.deviner("Peut-être un voyage à Porto au printemps"), .idee)
    }

    func testUneActionClaireVaDansMotion() {
        XCTAssertEqual(GenreCapture.deviner("Appeler le garage"), .tache)
        XCTAssertEqual(GenreCapture.deviner("Relire le contrat de Hugo"), .tache)
        XCTAssertEqual(GenreCapture.deviner("Me renseigner sur les assurances"), .tache)
        XCTAssertEqual(GenreCapture.deviner("Il faut que je trie mes mails"), .tache)
        XCTAssertEqual(GenreCapture.deviner("Studio : 90 min pour la démo"), .tache)
        // Dicté à l'impératif, comme on se parle.
        XCTAssertEqual(GenreCapture.deviner("Appelle le garage"), .tache)
        XCTAssertEqual(GenreCapture.deviner("Envoie le devis à Léa"), .tache)
        XCTAssertEqual(GenreCapture.deviner("Achète des ampoules"), .tache)
        // Un nom qui ressemble à un verbe reste une idée.
        XCTAssertEqual(GenreCapture.deviner("Livre de cuisine pour l'hiver"), .idee)
        XCTAssertEqual(GenreCapture.deviner("Note sur le mix du refrain"), .idee)
    }

    func testReglablePourRevenirAMotion() {
        XCTAssertEqual(GenreCapture.deviner("Un clip en noir pour le prochain son", parDefaut: .tache), .tache)
        // Les autres genres ne bougent pas.
        XCTAssertEqual(GenreCapture.deviner("tomates, lait et œufs"), .liste)
        XCTAssertEqual(GenreCapture.deviner("On mange où ce soir ?"), .question)
    }
}
