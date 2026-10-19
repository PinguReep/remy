import XCTest
@testable import RemyCore

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
}
