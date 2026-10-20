import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Onglet Rémy (Sam, 18/10) : réponses non vues, historique par période,
/// « Retenir » seulement les infos cochées.
@MainActor
final class ConversationTests: XCTestCase {
    private let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("remy-conv-" + UUID().uuidString)

    override func setUp() {
        UserDefaults.standard.removeObject(forKey: ChatModel.cleVus)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dossier)
        UserDefaults.standard.removeObject(forKey: ChatModel.cleVus)
        FauxServeur.reponses = [:]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.historique = [:]
    }

    private func app() -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)),
                         rangement: Rangement(dossier: dossier))
        a.serveur = VersionServeur(api: 1, serveur: "0.5.0", capacites: ["non-lus-v1", "retenir-choix-v1"])
        return a
    }

    private func liste(_ fils: [(String, Int, String)]) -> String {
        "[" + fils.map { #"{"id":"\#($0.0)","title":"\#($0.0)","updatedAt":1,"messages":\#($0.1),"dernier":"\#($0.2)"}"# }.joined(separator: ",") + "]"
    }

    func testUneReponseNonVueSeVoitPuisSEfface() async {
        let a = app()
        // Première fois : ce qui existe est lu, aucune pastille d'un coup.
        FauxServeur.reponses = ["GET /api/conversations": [(200, liste([("c1", 4, "assistant"), ("c2", 2, "assistant")]))]]
        await a.chat.rafraichirListe()
        XCTAssertEqual(a.chat.nombreNonLus, 0)
        // Rémy a répondu dans c1 pendant que Sam était sur l'accueil, et a écrit la nuit (c3).
        FauxServeur.reponses = ["GET /api/conversations": [(200, liste([("c1", 6, "assistant"), ("c2", 3, "user"), ("c3", 1, "assistant")]))]]
        await a.chat.rafraichirListe()
        XCTAssertEqual(Set(a.chat.conversations.filter { a.chat.nonLu($0) }.map(\.id)), ["c1", "c3"], "c2 : c'est Sam qui a parlé en dernier")
        // Sam ouvre c1 : lu.
        FauxServeur.reponses["GET /api/conversations/c1"] = [(200, #"{"id":"c1","title":"c1","messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]}"#)]
        _ = await a.chat.ouvrir("c1")
        a.onglet = .remy
        XCTAssertFalse(a.chat.nonLu(a.chat.conversations[0]), "à l'écran : jamais non lu")
        a.onglet = .aujourdhui
        XCTAssertFalse(a.chat.nonLu(a.chat.conversations[0]), "vu à l'ouverture (6 messages comptés par la liste)")
        XCTAssertEqual(a.chat.nombreNonLus, 1)
        // « Marquer comme non lu » : la dernière réponse redevient à voir ; pas un fil où Sam a parlé en dernier.
        a.chat.marquerNonLu("c1")
        XCTAssertTrue(a.chat.nonLu(a.chat.conversations[0]))
        a.chat.marquerNonLu("c2")
        XCTAssertFalse(a.chat.nonLu(a.chat.conversations[1]))
        XCTAssertEqual(a.chat.nombreNonLus, 2)
        // La déconnexion oublie tout.
        a.chat.vider()
        XCTAssertNil(UserDefaults.standard.object(forKey: ChatModel.cleVus))
    }

    func testSansLaTourAJourAucunePastille() async {
        let a = app()
        a.serveur = VersionServeur(api: 1, serveur: "0.4.0", capacites: [])
        FauxServeur.reponses = ["GET /api/conversations": [(200, #"[{"id":"c1","title":"x","updatedAt":1}]"#)]]
        await a.chat.rafraichirListe()
        XCTAssertEqual(a.chat.nombreNonLus, 0)
        XCTAssertNil(UserDefaults.standard.object(forKey: ChatModel.cleVus), "pas de comptes : rien d'initialisé")
    }

    func testHistoriqueParPeriode() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = Format.fuseau
        let maintenant = cal.date(from: DateComponents(year: 2026, month: 10, day: 18, hour: 10))!
        let ms = { (j: Int, h: Int) in cal.date(from: DateComponents(year: 2026, month: 10, day: j, hour: h))!.millis }
        XCTAssertEqual(PeriodeFil.de(ConversationResume(id: "a", title: "", updatedAt: ms(18, 0) + 60_000), maintenant: maintenant), .aujourdhui)
        XCTAssertEqual(PeriodeFil.de(ConversationResume(id: "b", title: "", updatedAt: ms(17, 23)), maintenant: maintenant), .semaine, "hier")
        XCTAssertEqual(PeriodeFil.de(ConversationResume(id: "c", title: "", updatedAt: ms(12, 9)), maintenant: maintenant), .semaine, "il y a 6 jours")
        XCTAssertEqual(PeriodeFil.de(ConversationResume(id: "d", title: "", updatedAt: ms(11, 23)), maintenant: maintenant), .avant)
        XCTAssertEqual(PeriodeFil.de(ConversationResume(id: "e", title: "", updatedAt: ms(1, 9), pinned: true), maintenant: maintenant), .epingles)
    }

    func testRetenirSeulementLesInfosCochees() async throws {
        let a = app()
        FauxServeur.reponses = [
            "POST /api/capture/extraire": [(200, #"{"elements":[{"texte":"Sam lance la démo jeudi","section":"Projets en cours"},{"texte":"On lui a suggéré de facturer à l'usage","section":"Objectifs"}]}"#)],
            "POST /api/capture": [(200, #"{"ok":true,"ajouts":["Démo jeudi"],"memoire":true}"#)],
        ]
        let texte = String(repeating: "Je lance la démo jeudi, ChatGPT dit de facturer à l'usage. ", count: 6)
        let infos = try await a.api.proposerInfos(texte, source: "chatgpt")
        XCTAssertEqual(infos.map(\.section), ["Projets en cours", "Objectifs"])
        a.chat.brouillon = texte
        let ok = await a.chat.retenirInfos([infos[0].texte], source: "chatgpt", texte: texte)
        XCTAssertTrue(ok)
        let corps = try XCTUnwrap(FauxServeur.corps["POST /api/capture"])
        XCTAssertEqual(corps["choisis"] as? [String], ["Sam lance la démo jeudi"])
        XCTAssertNil(corps["texte"], "le texte entier ne part pas")
        XCTAssertEqual(corps["source"] as? String, "chatgpt")
        XCTAssertEqual(a.chat.brouillon, "", "retenu : le composeur se vide")
        XCTAssertEqual(a.toast, "Retenu : Démo jeudi")
    }
}
