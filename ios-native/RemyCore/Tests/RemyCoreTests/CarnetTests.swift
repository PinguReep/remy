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
        XCTAssertEqual(analyse("Payer la cantine le 12/11"), .init(quand: date(12, 11, 9), reste: "Payer la cantine"))
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
