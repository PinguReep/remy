import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// L'adresse de la tour n'est pas dans le code (dépôt public) : saisie une fois,
/// gardée sur l'iPhone. Une adresse mal tapée ne doit ni planter ni partir en clair.
final class AdresseTests: XCTestCase {
    override func tearDown() { ClientAPI.retenirAdresse(nil) }

    func testUneAdresseSaisieEstNormalisee() {
        XCTAssertEqual(ClientAPI.normaliserAdresse("ma-tour.mon-tailnet.ts.net:8444")?.absoluteString, "https://ma-tour.mon-tailnet.ts.net:8444")
        XCTAssertEqual(ClientAPI.normaliserAdresse("  HTTPS://Ma-Tour.Mon-Tailnet.ts.net:8444/  ")?.absoluteString, "https://ma-tour.mon-tailnet.ts.net:8444")
        XCTAssertEqual(ClientAPI.normaliserAdresse("http://localhost:3000")?.absoluteString, "http://localhost:3000", "en local, pour le développement")
    }

    func testUneAdresseDouteuseEstRefusee() {
        XCTAssertNil(ClientAPI.normaliserAdresse(""))
        XCTAssertNil(ClientAPI.normaliserAdresse("$(REMY_ADRESSE_TOUR)"), "réglage de compilation vide")
        XCTAssertNil(ClientAPI.normaliserAdresse("http://ma-tour.mon-tailnet.ts.net:8444"), "jamais en clair hors de l'iPhone")
        XCTAssertNil(ClientAPI.normaliserAdresse("https://ma-tour.ts.net/api/health"), "un hôte, pas une page")
        XCTAssertNil(ClientAPI.normaliserAdresse("pas une adresse"))
    }

    func testLAdresseRetenueEstCelleDeLApp() {
        XCTAssertNil(ClientAPI.adresseTour)
        ClientAPI.retenirAdresse(ClientAPI.normaliserAdresse("ma-tour.mon-tailnet.ts.net:8444"))
        XCTAssertEqual(ClientAPI.adresseTour?.host, "ma-tour.mon-tailnet.ts.net")
        XCTAssertEqual(ClientAPI().base.host, "ma-tour.mon-tailnet.ts.net")
        ClientAPI.retenirAdresse(nil)
        XCTAssertNil(ClientAPI.adresseTour)
    }

    /// Une vraie tour (mot de passe posé) ne donne, sans session, que `api` et
    /// `appMin` : l'écran d'adresse doit y voir une tour qui répond.
    func testUneTourSansSessionRepond() async throws {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        let client = ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf))
        FauxServeur.reponses = ["GET /api/version": [(200, #"{"api":1,"appMin":null}"#)]]
        try await client.tourRepond()
        FauxServeur.reponses = ["GET /api/version": [(200, "<html>une autre machine</html>")]]
        do {
            try await client.tourRepond()
            XCTFail("une page qui n'est pas Rémy n'est pas une tour")
        } catch {}
    }
}
