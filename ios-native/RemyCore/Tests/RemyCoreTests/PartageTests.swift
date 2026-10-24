import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import RemyCore

/// Le trousseau partagé avec les extensions (24/10) : l'app y recopie
/// l'adresse, une extension en tire un client, ou dit d'ouvrir Rémy.
final class PartageTests: XCTestCase {
    /// Un trousseau en mémoire : un coffre d'adresse, un coffre de jeton par tour.
    func trousseau(jetons: [String: String] = [:]) -> (TrousseauPartage, CoffreMemoire) {
        let adresse = CoffreMemoire()
        let coffres = jetons.mapValues { CoffreMemoire($0) }
        return (TrousseauPartage(adresse: adresse, jeton: { coffres[$0.host ?? ""] ?? CoffreMemoire() }), adresse)
    }

    func testSansAdresseNiJetonLExtensionDitDOuvrirRemy() {
        let (t, _) = trousseau()
        XCTAssertThrowsError(try t.client()) { e in
            XCTAssertEqual(e as? ErreurPartage, .nonConnecte)
            XCTAssertEqual(e.localizedDescription, "Ouvre Rémy une fois pour te connecter.")
        }
        // L'adresse seule ne suffit pas : sans jeton, la tour refuserait.
        t.publier(URL(string: "https://tour.exemple.ts.net:8444")!)
        XCTAssertThrowsError(try t.client()) { XCTAssertEqual($0 as? ErreurPartage, .nonConnecte) }
    }

    func testLAppPublieLAdresseEtLExtensionParleAvecLeJeton() throws {
        let (t, adresse) = trousseau(jetons: ["tour.exemple.ts.net": "jeton-essai"])
        t.publier(URL(string: "https://Tour.Exemple.ts.net:8444/")!)
        XCTAssertEqual(adresse.lire(), "https://tour.exemple.ts.net:8444", "adresse normalisée")
        let client = try t.client()
        XCTAssertEqual(client.base.absoluteString, "https://tour.exemple.ts.net:8444")
        XCTAssertEqual(client.coffre.lire(), "jeton-essai")
    }

    func testLExtensionNEffaceJamaisLeJeton() throws {
        let (t, _) = trousseau(jetons: ["tour.exemple.ts.net": "jeton-essai"])
        t.publier(URL(string: "https://tour.exemple.ts.net")!)
        let client = try t.client()
        // Un 401 dans l'extension appelle coffre.ecrire(nil) : sans effet.
        client.coffre.ecrire(nil)
        XCTAssertEqual(try t.client().coffre.lire(), "jeton-essai")
    }

    func testLaDeconnexionEffaceLAdresse() {
        let (t, adresse) = trousseau(jetons: ["tour.exemple.ts.net": "jeton-essai"])
        t.publier(URL(string: "https://tour.exemple.ts.net")!)
        t.publier(nil)
        XCTAssertNil(adresse.lire())
        XCTAssertNil(t.adresseTour)
        XCTAssertThrowsError(try t.client())
    }

    func testUneAdresseIllisibleNEstPasRecopiee() {
        let (t, adresse) = trousseau()
        // Du HTTP vers l'extérieur : le mot de passe passerait en clair.
        t.publier(URL(string: "http://tour.exemple.ts.net")!)
        XCTAssertNil(adresse.lire())
    }

    func testLiens() {
        XCTAssertEqual(LienRemy(url: URL(string: "remy://capture")!), .capture)
        XCTAssertEqual(LienRemy(url: URL(string: "REMY://Capture/")!), .capture)
        XCTAssertEqual(LienRemy(url: URL(string: "remy://projets")!), .onglet(.projets))
        XCTAssertEqual(LienRemy(url: URL(string: "remy://aujourdhui")!), .onglet(.aujourdhui))
        XCTAssertEqual(LienRemy(url: URL(string: "remy://remy")!), .onglet(.remy))
        XCTAssertNil(LienRemy(url: URL(string: "remy://inconnu")!))
        XCTAssertNil(LienRemy(url: URL(string: "https://capture")!))
        for l in [LienRemy.capture, .onglet(.aujourdhui), .onglet(.remy), .onglet(.projets)] {
            XCTAssertEqual(LienRemy(url: l.url), l, "aller-retour \(l)")
        }
    }
}

/// Le lien arrive dans l'app : l'onglet tout de suite, la capture en attente.
@MainActor
final class LienAppTests: XCTestCase {
    func testOuvrirUnLien() async {
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: .ephemeral)))
        a.reglagesOuverts = true
        XCTAssertTrue(a.ouvrir(URL(string: "remy://capture")!))
        XCTAssertEqual(a.lien, .capture, "la capture attend les onglets, qui ferment la feuille ouverte")
        XCTAssertTrue(a.ouvrir(URL(string: "remy://projets")!))
        XCTAssertEqual(a.onglet, .projets)
        XCTAssertFalse(a.reglagesOuverts, "l'onglet demandé se voit")
        XCTAssertFalse(a.ouvrir(URL(string: "remy://ailleurs")!))
    }

    func testLaDeconnexionRetireLAdresseDesExtensions() async {
        let adresse = CoffreMemoire()
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: .ephemeral)))
        a.partage = TrousseauPartage(adresse: adresse, jeton: { _ in CoffreMemoire() })
        a.partage?.publier(a.api.base)
        XCTAssertEqual(adresse.lire(), "https://remy.test")
        await a.deconnecter()
        XCTAssertNil(adresse.lire())
    }
}
