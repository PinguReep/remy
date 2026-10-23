import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Le rendez-vous quotidien côté app (24/10) : lu sur la tour, gardé sur
/// l'iPhone, « tout ce qui reste → demain » en une écriture, la ligne du soir.
@MainActor
final class RituelModelTests: XCTestCase {
    private let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("remy-rituel-" + UUID().uuidString)

    override func tearDown() {
        try? FileManager.default.removeItem(at: dossier)
        FauxServeur.reponses = [:]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.historique = [:]
    }

    private func app(capacites: [String] = ["rituel-v1", "propositions-v1"]) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)),
                         rangement: Rangement(dossier: dossier))
        a.serveur = VersionServeur(api: 1, serveur: "0.6.0", capacites: capacites)
        return a
    }

    /// Un rendez-vous du jour « 2026-10-23 » vu par la tour, quel que soit le jour du test.
    private let rituel = #"""
    {"maintenant": 1792787400000,
     "aujourdhui": {"pour": "2026-10-23", "titre": "Ta journée — vendredi 23 octobre", "compte": "Ce qui compte : « Finaliser la démo », avant 16:00.",
       "pourquoi": "Pourquoi : priorité importante.", "menace": "Rien de menacé : la journée tient."},
     "soir": {"jour": "2026-10-23", "fait": [], "glisse": [],
       "reste": [{"id": "t2", "titre": "Relire le contrat", "echeance": 1792825200000, "versDemain": 1792911600000},
                 {"id": "t3", "titre": "Facture Ondine", "versDemain": 1792911600000}],
       "phrase": "0 fait, 2 restent pour aujourd'hui."},
     "menacees": []}
    """#

    func testSansLaCapaciteRienNePart() async {
        let a = app(capacites: [])
        await a.rituel.charger()
        XCTAssertNil(a.rituel.donnees)
        XCTAssertFalse(FauxServeur.recues.contains("GET /api/rituel"))
    }

    func testLuEtGardeSurLIPhone() async {
        FauxServeur.reponses["GET /api/rituel"] = [(200, rituel)]
        let a = app()
        await a.rituel.charger()
        XCTAssertEqual(a.rituel.donnees?.aujourdhui?.pour, "2026-10-23")
        XCTAssertNotNil(a.rituel.briefing(), "frais de la tour : affiché même si l'iPhone n'est pas au même jour")
        XCTAssertNotNil(a.rituel.bilan())
        XCTAssertFalse(a.rituel.perime())
        // Relancée hors ligne : la copie de l'iPhone, datée.
        let b = app()
        XCTAssertEqual(b.rituel.donnees?.soir?.reste.count, 2)
        XCTAssertNotNil(b.rituel.le)
    }

    func testToutCeQuiResteADemainEnUneEcritureAnnulable() async {
        FauxServeur.reponses["GET /api/rituel"] = [(200, rituel)]
        FauxServeur.reponses["POST /api/motion/apply"] = [(200, #"{"ledgerId":"j1","echecs":0,"results":[{"ok":true},{"ok":true}]}"#)]
        let a = app()
        await a.rituel.charger()
        let ok = await a.rituel.toutADemain()
        XCTAssertTrue(ok)
        XCTAssertEqual(FauxServeur.historique["POST /api/motion/apply"]?.count, 1, "une seule écriture")
        let actions = FauxServeur.corps["POST /api/motion/apply"]?["actions"] as? [[String: Any]]
        XCTAssertEqual(actions?.compactMap { $0["id"] as? String }, ["t2", "t3"])
        XCTAssertEqual(actions?.compactMap { $0["type"] as? String }, ["modifier", "modifier"])
        XCTAssertEqual(a.rituel.poussees, ["t2", "t3"])
        XCTAssertTrue(a.toast?.hasPrefix("2 tâches pour demain") == true, a.toast ?? "")
        XCTAssertNotNil(a.message?.annuler, "annulable depuis le bandeau")
        // Plus rien à pousser : c'est dit, rien ne part.
        let encore = await a.rituel.toutADemain()
        XCTAssertFalse(encore)
        XCTAssertEqual(FauxServeur.historique["POST /api/motion/apply"]?.count, 1)
    }

    func testMotionRefuseToutRienNEstMarquePousse() async {
        FauxServeur.reponses["GET /api/rituel"] = [(200, rituel)]
        FauxServeur.reponses["POST /api/motion/apply"] = [(200, #"{"echecs":2,"results":[{"ok":false,"erreur":"quota"},{"ok":false,"erreur":"quota"}]}"#)]
        let a = app()
        await a.rituel.charger()
        let ok = await a.rituel.toutADemain()
        XCTAssertFalse(ok)
        XCTAssertTrue(a.rituel.poussees.isEmpty)
        XCTAssertTrue(a.toast?.contains("quota") == true, a.toast ?? "")
    }

    func testLaLigneDuSoirEstRangee() async {
        FauxServeur.reponses["POST /api/rituel/bilan"] = [(200, #"{"ok":true,"phrase":"Bilan rangé : Rémy le relira cette nuit."}"#)]
        let a = app()
        let ok = await a.rituel.rangerBilan("  Bonne journée  ")
        XCTAssertTrue(ok)
        XCTAssertTrue(a.rituel.bilanRange)
        XCTAssertEqual(FauxServeur.corps["POST /api/rituel/bilan"]?["ressenti"] as? String, "Bonne journée")
    }

    func testLaDeconnexionEffaceLeRendezVous() async {
        FauxServeur.reponses["GET /api/rituel"] = [(200, rituel)]
        let a = app()
        await a.rituel.charger()
        a.rituel.vider()
        XCTAssertNil(a.rituel.donnees)
        XCTAssertNil(app().rituel.donnees, "plus rien sur l'iPhone")
    }
}
