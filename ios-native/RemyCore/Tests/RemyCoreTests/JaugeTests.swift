import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// La jauge du chat (19/10) : contexte de la conversation, débit de la
/// dernière réponse, moyenne du fil, débit en direct pendant l'écriture.
@MainActor
final class JaugeTests: XCTestCase {
    func app() -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        return AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
    }

    func testLeDebitEnDirectPuisLesMesuresExactes() async {
        let flux = [
            #"event: status\#ndata: {"text":"Rémy écrit sa réponse…","cle":"ecrit","t":900}"#,
            #"event: debit\#ndata: {"tps":38.5,"jetons":40}"#,
            #"event: delta\#ndata: {"text":"Demain 9 h."}"#,
            #"event: debit\#ndata: {"tps":41.2,"jetons":82}"#,
            #"event: done\#ndata: {"text":"Demain 9 h.","mesures":{"jetons":120,"tps":40,"decodeMs":3000,"premierMs":1800,"contexte":42500,"fenetre":131072,"fenetreSource":"modele","repartition":{"systeme":31000,"conversation":9000,"outils":2380,"reponse":120}}}"#,
        ].joined(separator: "\n\n") + "\n\n"
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, flux)],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        _ = await a.chat.envoyer("Un créneau ?")
        let l = a.chat.lignes.last!
        XCTAssertNil(l.debit, "le direct s'efface quand la réponse est finie")
        XCTAssertEqual(l.mesures?.tps, 40)
        let j = a.chat.jauge
        XCTAssertEqual(j.contexte, 42500)
        XCTAssertEqual(j.fraction!, 42500.0 / 131072.0, accuracy: 0.0001)
        XCTAssertEqual(j.niveau, .calme)
        XCTAssertEqual(j.derniere?.premier, 1.8)
        XCTAssertEqual(j.repartition?.systeme, 31000)
    }

    func testUneTourAncienneNaPasDeJauge() async {
        let flux = #"event: done\#ndata: {"text":"Oui."}"# + "\n\n"
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, flux)],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        _ = await a.chat.envoyer("Ça va ?")
        XCTAssertTrue(a.chat.jauge.vide)
        XCTAssertNil(a.chat.jauge.fraction)
        XCTAssertFalse(a.chat.jaugeDisponible)
    }

    func testLaMoyenneEstPondereeParLeTempsDEcriture() {
        // 100 jetons en 1 s (100 tok/s) puis 900 jetons en 30 s (30 tok/s) :
        // 1000 jetons en 31 s ≈ 32 tok/s, pas (100 + 30) / 2 = 65.
        let lignes = [
            LigneChat(deToi: true, texte: "a"),
            LigneChat(deToi: false, texte: "b", mesures: MesuresReponse(jetons: 100, tps: 100, decodeMs: 1000, premierMs: 1000, contexte: 9000)),
            LigneChat(deToi: true, texte: "c"),
            LigneChat(deToi: false, texte: "d", mesures: MesuresReponse(jetons: 900, tps: 30, decodeMs: 30_000, premierMs: 3000, contexte: 10_000, fenetre: 10_500)),
            LigneChat(deToi: false, texte: "e (réponse de Claude, sans mesure)"),
        ]
        let j = JaugeContexte.de(lignes)
        XCTAssertEqual(j.reponsesMesurees, 2)
        XCTAssertEqual(j.derniere?.tps, 30)
        XCTAssertEqual(j.moyenne!.tps, 1000.0 / 31.0, accuracy: 0.001)
        XCTAssertEqual(j.moyenne?.premier, 2.0)
        XCTAssertEqual(j.contexte, 10_000, "la dernière réponse mesurée")
        XCTAssertEqual(j.niveau, .plein)
    }

    func testSansTailleConnueOnNInventePasDePourcentage() {
        let j = JaugeContexte.de([LigneChat(deToi: false, texte: "x", mesures: MesuresReponse(contexte: 12_000))])
        XCTAssertEqual(j.contexte, 12_000)
        XCTAssertNil(j.fraction)
        XCTAssertNil(j.derniere)
        XCTAssertFalse(j.vide)
    }

    func testLesNombresSEcriventALaFrancaise() {
        XCTAssertEqual(JaugeContexte.jetons(850), "850")
        XCTAssertEqual(JaugeContexte.jetons(44_230), "44,2 k")
        XCTAssertEqual(JaugeContexte.jetons(131_072), "131 k")
        XCTAssertEqual(JaugeContexte.tps(41.6), "42 tok/s")
        XCTAssertEqual(JaugeContexte.tps(8.44), "8,4 tok/s")
        XCTAssertEqual(JaugeContexte.pourcent(0.324), "32 %")
        XCTAssertEqual(JaugeContexte.pourcent(0.004), "<1 %")
        XCTAssertEqual(JaugeContexte.secondes(2.14), "2,1 s")
        XCTAssertEqual(JaugeContexte.secondes(65), "1 min 05")
    }

    func testLaMesureSurvitAuRechargement() throws {
        let json = #"{"id":"c1","title":"x","messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b","mesures":{"jetons":50,"tps":25,"decodeMs":2000,"contexte":8000,"fenetre":65536,"fenetreSource":"reglage"}}]}"#
        let conv = try JSONDecoder().decode(Conversation.self, from: Data(json.utf8))
        let j = JaugeContexte.de(ChatModel.lignes(de: conv))
        XCTAssertEqual(j.derniere?.tps, 25)
        XCTAssertTrue(j.fenetreReglee)
    }
}
