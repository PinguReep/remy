import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// La localisation (20/10) : coupée par défaut, pause 2 h, file d'envoi qui
/// survit au hors-ligne, une visite complétée à son départ.
@MainActor
final class LieuxTests: XCTestCase {
    var reglages: UserDefaults!

    override func setUp() {
        reglages = UserDefaults(suiteName: "lieux-tests-\(UUID().uuidString)")
    }

    func app() -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.historique = [:]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)), reglages: reglages)
        a.serveur = VersionServeur(api: 1, serveur: "0.6.0", capacites: ["lieux-v1"])
        return a
    }

    let arrivee = Date(timeIntervalSince1970: 1_760_950_000)

    func testCoupeeParDefautRienNePart() async {
        let a = app()
        XCTAssertFalse(a.lieux.active)
        await a.lieux.recevoir(.visite(arrivee: arrivee, depart: nil, lat: 45.7, lon: 4.8, precision: 30))
        XCTAssertTrue(a.lieux.enAttente.isEmpty)
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/lieux/evenements"))
    }

    func testUneVisiteArrivePuisRepartAvecLeMemeIdentifiant() async {
        FauxServeur.reponses = ["POST /api/lieux/evenements": [(200, #"{"ok":true,"visites":1}"#)]]
        let a = app()
        a.lieux.activer(true)
        let v = EvenementLieu.visite(arrivee: arrivee, depart: nil, lat: 45.70001, lon: 4.80001, precision: 30)
        let w = EvenementLieu.visite(arrivee: arrivee, depart: arrivee.addingTimeInterval(3600), lat: 45.70001, lon: 4.80001, precision: 30)
        XCTAssertEqual(v.id, w.id, "le départ complète l'arrivée")
        await a.lieux.recevoir(v)
        await a.lieux.recevoir(w)
        XCTAssertTrue(a.lieux.enAttente.isEmpty, "tout est parti")
        let lots = FauxServeur.historique["POST /api/lieux/evenements"] ?? []
        XCTAssertEqual(lots.count, 2)
        let dernier = (lots.last?["evenements"] as? [[String: Any]])?.first
        XCTAssertEqual(dernier?["type"] as? String, "visite")
        XCTAssertNotNil(dernier?["depart"])
    }

    func testHorsLigneLesPositionsAttendentEtSurviventAuRelancement() async {
        FauxServeur.reponses = ["POST /api/lieux/evenements": [(503, #"{"error":"tour injoignable"}"#)]]
        let a = app()
        a.lieux.activer(true)
        await a.lieux.recevoir(.visite(arrivee: arrivee, depart: nil, lat: 45.7, lon: 4.8, precision: 30))
        await a.lieux.recevoir(.trajet(debut: arrivee.addingTimeInterval(4000), fin: nil))
        XCTAssertEqual(a.lieux.enAttente.count, 2)
        XCTAssertNotNil(a.lieux.erreur)
        // Relancée : la file est toujours là, et part quand la tour répond.
        FauxServeur.reponses = ["POST /api/lieux/evenements": [(200, #"{"ok":true}"#)]]
        let b = app()
        XCTAssertTrue(b.lieux.active, "le réglage survit")
        XCTAssertEqual(b.lieux.enAttente.count, 2)
        await b.lieux.envoyer()
        XCTAssertTrue(b.lieux.enAttente.isEmpty)
    }

    func testEnPauseRienNEstEnregistre() async {
        let a = app()
        a.lieux.activer(true)
        a.lieux.pause(heures: 2)
        XCTAssertTrue(a.lieux.enPause)
        await a.lieux.recevoir(.visite(arrivee: arrivee, depart: nil, lat: 45.7, lon: 4.8, precision: 30))
        XCTAssertTrue(a.lieux.enAttente.isEmpty)
        a.lieux.reprendre()
        XCTAssertFalse(a.lieux.enPause)
        a.lieux.activer(false)
        XCTAssertNil(a.lieux.pauseJusqua)
    }

    func testLaVueDeLaTourSeLit() async {
        let json = #"{"actif":true,"jours":90,"etat":{"ou":"lieu","depuis":1760950000000,"lieu":{"id":"lieu-1","nom":"Salle de sport","adresse":"3 Avenue du Port, 99001 Villefictive"}},"aujourdhui":[{"id":"v1","arrivee":1760950000000,"depart":null,"lieu":{"id":"lieu-1","nom":"Salle de sport","adresse":null}}],"lieux":[{"id":"lieu-1","nom":"Salle de sport","adresse":"3 Avenue du Port, 99001 Villefictive","lat":45.71,"lon":4.82,"rayon":80,"source":"sam","visites":4,"derniere":1760950000000}],"geocodage":{"pret":true,"adresses":3,"departements":["99"],"importeA":1760900000000}}"#
        FauxServeur.reponses = ["GET /api/lieux": [(200, json)], "POST /api/lieux": [(200, json)]]
        let a = app()
        await a.lieux.charger()
        XCTAssertEqual(a.lieux.vue?.etat.ou, "lieu")
        XCTAssertTrue(a.lieux.vue?.etat.phrase.hasPrefix("Salle de sport, depuis ") == true)
        XCTAssertEqual(a.lieux.vue?.lieux.first?.affiche, "Salle de sport")
        let ok = await a.lieux.nommerIci("Salle de sport", lat: 45.71, lon: 4.82)
        XCTAssertTrue(ok)
        XCTAssertEqual(FauxServeur.corps["POST /api/lieux"]?["nom"] as? String, "Salle de sport")
        XCTAssertEqual(EtatLieux(ou: "inconnu", depuis: nil, lieu: nil).phrase, "Pas de position récente")
    }
}
