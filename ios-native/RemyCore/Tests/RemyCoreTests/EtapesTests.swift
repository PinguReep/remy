import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// La petite barre du chat (19/10) : ce que Rémy fait pendant qu'il répond.
@MainActor
final class EtapesTests: XCTestCase {
    func app() -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        return AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
    }

    func testLesEtapesSeSuiventEtLaReflexionSeMetAJour() async {
        let flux = [
            #"event: status\#ndata: {"text":"Rémy relit…","cle":"contexte","t":0}"#,
            #"event: status\#ndata: {"text":"Rémy interroge son modèle local…","cle":"modele","t":420}"#,
            #"event: status\#ndata: {"text":"Rémy réfléchit…","cle":"reflexion","t":1900,"detail":"il veut"}"#,
            #"event: status\#ndata: {"text":"Rémy réfléchit…","cle":"reflexion","t":3400,"detail":"il veut un créneau demain"}"#,
            #"event: status\#ndata: {"text":"Rémy écrit sa réponse…","cle":"ecrit","t":6000}"#,
            #"event: delta\#ndata: {"text":"Demain 9 h."}"#,
            #"event: done\#ndata: {"text":"Demain 9 h."}"#,
        ].joined(separator: "\n\n") + "\n\n"
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, flux)],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        _ = await a.chat.envoyer("Un créneau ?")
        let l = a.chat.lignes.last!
        XCTAssertEqual(l.etapes.map(\.cle), ["contexte", "modele", "reflexion", "ecrit"], "la réflexion se met à jour sans nouvelle ligne")
        XCTAssertEqual(l.etapes[2].detail, "il veut un créneau demain")
        XCTAssertEqual(l.etapes.duree(de: 1), 1480)
        XCTAssertNil(l.etapes.duree(de: 3), "la dernière court encore")
        XCTAssertNotNil(l.debutEtapes)
        XCTAssertNil(l.statut, "la barre se range à la fin")
        XCTAssertEqual(l.texte, "Demain 9 h.")
    }

    func testUneTourAncienneNeDonneQueLeTexte() async {
        let flux = #"event: status\#ndata: {"text":"Rémy réfléchit…"}"# + "\n\n" + #"event: done\#ndata: {"text":"Oui."}"# + "\n\n"
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, flux)],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        _ = await a.chat.envoyer("Ça va ?")
        XCTAssertTrue(a.chat.lignes.last!.etapes.isEmpty)
    }
}
