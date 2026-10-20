import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Sélectionner et transmettre (19/10) : une réponse en clair pour en copier
/// un passage ; le code d'une erreur de la tour, pour la transmettre.
@MainActor
final class SelectionTests: XCTestCase {
    func app() -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        return AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
    }

    func testLeTexteEnClairGardeLeSensSansLaSyntaxe() {
        let md = "#### Le plan\n- **Mardi** : la démo\n- *Mercredi* : `invitations`\n\nVoir [le site](https://exemple.fr).\n\n| A | B |\n|---|---|\n| 1 | 2 |"
        XCTAssertEqual(Markdown.enClair(md),
                       "Le plan\n• Mardi : la démo\n• Mercredi : invitations\n\nVoir le site (https://exemple.fr).\n\nA · B\n1 · 2")
    }

    func testUneErreurDuChatPorteSonCode() async {
        let flux = #"event: error\#ndata: {"message":"Rémy a travaillé trop longtemps.","code":"R-7KQ2M"}"# + "\n\n"
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, flux)],
            "GET /api/conversations": [(200, "[]")],
            "GET /api/incidents/R-7KQ2M": [(200, #"{"code":"R-7KQ2M","etape":"reflexion"}"#)],
        ]
        let a = app()
        _ = await a.chat.envoyer("Une très longue dictée")
        let l = a.chat.lignes.last!
        XCTAssertEqual(l.erreur, "Rémy a travaillé trop longtemps.")
        XCTAssertEqual(l.codeErreur, "R-7KQ2M")
        let d = await a.chat.diagnostic("R-7KQ2M")
        XCTAssertTrue(d?.contains("\"etape\" : \"reflexion\"") == true, d ?? "nil")
    }

    func testUneErreurDeRouteGardeSonCodeDansLeMessage() async {
        FauxServeur.reponses = [
            "GET /api/mesures": [(500, #"{"error":"Erreur serveur","code":"R-ABCDE"}"#)],
        ]
        let a = app()
        do {
            _ = try await a.api.mesures()
            XCTFail("une erreur était attendue")
        } catch ErreurAPI.serveur(let code, let message) {
            XCTAssertEqual(code, 500)
            XCTAssertEqual(message, "Erreur serveur (code R-ABCDE)")
        } catch {
            XCTFail("\(error)")
        }
    }
}
