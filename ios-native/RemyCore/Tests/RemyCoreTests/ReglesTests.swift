import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Les règles de Rémy (19/10) : la règle proposée se valide d'un tap ; la
/// liste se lit, se règle.
@MainActor
final class ReglesTests: XCTestCase {
    func app() -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        return AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
    }

    func testValiderUneRegleProposee() async throws {
        let json = #"{"id":"c1","title":"x","messages":[{"role":"user","content":"Avant chaque sortie, rasage."},{"role":"assistant","content":"Je te propose cette règle.","proposal":{"id":"p1","source":"regle","actions":[{"type":"regle","nom":"Rasage avant une sortie","description":"Avant un événement « sortie »…"}],"statut":"en_attente"}}]}"#
        FauxServeur.reponses = [
            "POST /api/conversations/c1/propositions/p1/regle": [(200, #"{"ok":true,"statut":"applique"}"#)],
            "GET /api/conversations": [(200, "[]")],
            "GET /api/journal": [(200, "[]")],
        ]
        let a = app()
        await a.chat.ouvrir(try JSONDecoder().decode(Conversation.self, from: Data(json.utf8)))
        let l = a.chat.lignes.last!
        XCTAssertEqual(l.proposition?.source, "regle")
        let ok = await a.chat.validerRegle(l)
        XCTAssertTrue(ok)
        XCTAssertEqual(a.chat.lignes.last?.proposition?.statut, "applique")
        XCTAssertTrue(FauxServeur.recues.contains("POST /api/conversations/c1/propositions/p1/regle"))
    }

    func testLaListeDesReglesSeLit() async throws {
        FauxServeur.reponses = [
            "GET /api/regles": [(200, #"{"regles":[{"id":"regle-1","nom":"Rasage avant une sortie","mots":["sortie","soirée"],"tache":{"nom":"Rasage","duree":15,"priorite":"MEDIUM"},"avantMin":180,"actif":true,"creeA":1760900000000}]}"#)],
        ]
        let r = try await app().api.regles()
        XCTAssertEqual(r.first?.tache.nom, "Rasage")
        XCTAssertEqual(r.first?.delai, "au plus tard 3 h avant")
        XCTAssertEqual(RegleRemy(id: "x", nom: "x", mots: [], tache: .init(nom: "x"), avantMin: 1440, actif: true).delai, "au plus tard la veille")
    }
}
