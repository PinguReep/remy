import XCTest
@testable import RemyCore

/// L'activité du PC (activite-pc-v1, 24/10) : la réponse de la tour se lit,
/// même partielle, et l'écran sait dire ce qui empêche de compter.
final class ActivitePCTests: XCTestCase {
    let reponse = """
    {"actif":true,"coupeParLaTour":false,
     "activitywatch":{"joignable":true,"version":"v0.13.2","fenetre":true,"afk":true,"web":true,"message":null,"essai":1761300000000},
     "derniereCollecte":1761300000000,"releveMin":20,"jours":90,
     "aujourdhui":{"total":12000,
       "categories":[{"id":"developpement","nom":"Développement","secondes":9000},{"id":"navigateur","nom":"Navigateur","secondes":1800}],
       "applis":[{"nom":"code","libelle":"VS Code","categorie":"developpement","secondes":9000}],
       "domaines":[{"nom":"exemple.org","secondes":1800}]},
     "semaine":{"total":40000,"categories":[],"applis":[],"domaines":[],
       "parJour":[{"jour":"2026-10-18","secondes":0},{"jour":"2026-10-24","secondes":12000}]},
     "exclusions":["discord"],"exclusionsTour":[],"categories":[{"id":"jeux","nom":"Jeux"}]}
    """

    func testLaReponseDeLaTourSeLit() throws {
        let v = try JSONDecoder().decode(VueActivitePC.self, from: Data(reponse.utf8))
        XCTAssertTrue(v.actif)
        XCTAssertEqual(v.aujourdhui.categories.first?.nom, "Développement")
        XCTAssertEqual(v.aujourdhui.applis.first?.libelle, "VS Code")
        XCTAssertEqual(v.aujourdhui.domaines.first?.nom, "exemple.org")
        XCTAssertEqual(v.semaine.parJour?.count, 2)
        XCTAssertEqual(v.exclusions, ["discord"])
        XCTAssertNil(v.probleme)
        XCTAssertEqual(v.aujourdhui.part(1800), 0.2, accuracy: 0.001)
        XCTAssertEqual(v.aujourdhui.part(9000), 1)
    }

    func testUneReponsePartielleNeCassePasLEcran() throws {
        let v = try JSONDecoder().decode(VueActivitePC.self, from: Data(#"{"actif":false}"#.utf8))
        XCTAssertFalse(v.actif)
        XCTAssertEqual(v.aujourdhui, .vide)
        XCTAssertNil(v.activitywatch.joignable)
        XCTAssertNil(v.probleme, "coupée : rien à signaler")
        XCTAssertEqual(v.releve, "Premier relevé dans 20 min au plus")
        XCTAssertEqual(BilanActivite.vide.part(10), 0)
    }

    func testCeQuiEmpecheDeCompterEstDitAvecQuoiFaire() {
        var v = VueActivitePC(actif: true, activitywatch: EtatActivityWatch(joignable: false), derniereCollecte: nil,
                              aujourdhui: .vide, semaine: .vide)
        XCTAssertTrue(v.probleme?.contains("installe-le") == true)
        v.activitywatch = EtatActivityWatch(joignable: true, fenetre: true, afk: false)
        XCTAssertTrue(v.probleme?.contains("aw-qt") == true)
        v.activitywatch = EtatActivityWatch(joignable: true, fenetre: true, afk: true)
        XCTAssertNil(v.probleme)
    }

    func testDureesEtNoms() {
        XCTAssertEqual(ActivitePC.duree(190 * 60), "3 h 10")
        XCTAssertEqual(ActivitePC.duree(45 * 60), "45 min")
        XCTAssertEqual(ActivitePC.duree(10), "moins d'une minute")
        XCTAssertEqual(ActivitePC.cle(" Discord.exe "), "discord")
        XCTAssertEqual(ActivitePC.cle("Code"), "code")
    }
}
