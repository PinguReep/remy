import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Sam (18/10), devant « Ajouter : Acheter abonnement Claude Code pour Tom ·
/// 10 min » sans date : ajuster la proposition avant de dire oui (date, heure,
/// durée, catégorie), ou la ranger en rappel. Et une catégorie sur chaque tâche.
@MainActor
final class AjustementTests: XCTestCase {
    private let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("remy-ajust-" + UUID().uuidString)

    override func tearDown() {
        try? FileManager.default.removeItem(at: dossier)
        FauxServeur.reponses = [:]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.historique = [:]
    }

    private func app(capacites: [String] = ["propositions-ajustables-v1", "categories-taches-v1"]) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)),
                         rangement: Rangement(dossier: dossier))
        a.serveur = VersionServeur(api: 1, serveur: "0.5.0", capacites: capacites)
        return a
    }

    private let fil = #"{"id":"c1","title":"Tom","messages":[{"role":"user","content":"Rappelle-moi l'abonnement de Tom"},{"role":"assistant","content":"Je l'ajoute ?","proposal":{"id":"p1","source":"motion","resume":"Abonnement","statut":"en_attente","actions":[{"type":"creer","nom":"Acheter abonnement Claude Code pour Tom","duree":10}]}}]}"#
    private let ajustee = #"{"ok":true,"statut":"en_attente","actions":[{"type":"creer","nom":"Acheter abonnement Claude Code pour Tom","duree":10,"rang":0,"echeance":"2026-10-20T09:00:00+02:00","etiquettes":["perso"]}]}"#

    private func ouvrirFil(_ a: AppModel) async throws -> LigneChat {
        FauxServeur.reponses["GET /api/conversations/c1"] = [(200, fil)]
        FauxServeur.reponses["GET /api/conversations"] = [(200, "[]")]
        _ = await a.chat.ouvrir("c1")
        return try XCTUnwrap(a.chat.lignes.first { $0.proposition != nil })
    }

    func testAjusterEnvoieLeRangEtLesChampsPuisMontreLaVersionDeLaTour() async throws {
        let a = app()
        XCTAssertTrue(a.chat.ajustementDisponible)
        let ligne = try await ouvrirFil(a)
        XCTAssertEqual(ligne.proposition?.ajustable, true)
        FauxServeur.reponses["POST /api/conversations/c1/propositions/p1/ajuster"] = [(200, ajustee)]
        let ok = await a.chat.ajuster(ligne, rang: 0, champs: ["echeance": "2026-10-20T09:00:00+02:00", "etiquettes": ["perso"]])
        XCTAssertTrue(ok)
        let corps = try XCTUnwrap(FauxServeur.corps["POST /api/conversations/c1/propositions/p1/ajuster"])
        let envoyee = try XCTUnwrap((corps["actions"] as? [[String: Any]])?.first)
        XCTAssertEqual(envoyee["rang"] as? Int, 0)
        XCTAssertEqual(envoyee["echeance"] as? String, "2026-10-20T09:00:00+02:00")
        XCTAssertNil(envoyee["type"], "le type n'est jamais envoyé : il vient de l'originale")
        let p = try XCTUnwrap(a.chat.lignes.first { $0.id == ligne.id }?.proposition)
        XCTAssertEqual(p.ajustee, true)
        XCTAssertEqual(p.actions.first?.echeance, "2026-10-20T09:00:00+02:00")
        XCTAssertEqual(p.actions.first?.etiquettes, ["perso"])
        XCTAssertEqual(p.actions.first?.rang, 0)
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/motion/apply"), "ajuster n'écrit rien dans Motion")
        XCTAssertFalse(FauxServeur.recues.contains { $0.hasSuffix("/messages") }, "ni dans le fil")
    }

    func testRangerEnRappelSortLActionEtNoteLeRappel() async throws {
        let a = app()
        let ligne = try await ouvrirFil(a)
        FauxServeur.reponses["POST /api/conversations/c1/propositions/p1/ajuster"] = [(200, #"{"ok":true,"statut":"converti","actions":[]}"#)]
        let quand = Date(timeIntervalSince1970: 1_792_479_600) // 20/10/2026 9 h (Paris)
        let ok = await a.chat.rangerEnRappel(ligne, rang: 0, texte: "Acheter abonnement Claude Code pour Tom", quand: quand, etiquettes: ["perso"])
        XCTAssertTrue(ok)
        let corps = try XCTUnwrap(FauxServeur.corps["POST /api/conversations/c1/propositions/p1/ajuster"])
        XCTAssertEqual(corps["convertis"] as? [Int], [0])
        let p = try XCTUnwrap(a.chat.lignes.first { $0.id == ligne.id }?.proposition)
        XCTAssertTrue(p.convertie)
        XCTAssertFalse(p.ajustable)
        let r = try XCTUnwrap(a.carnet.rappels.first)
        XCTAssertEqual(r.texte, "Acheter abonnement Claude Code pour Tom")
        XCTAssertEqual(r.quand, quand.millis)
        XCTAssertEqual(r.etiquettes, ["perso"])
        XCTAssertTrue(a.toast?.hasPrefix("Rangé en rappel") ?? false, a.toast ?? "")
    }

    func testRangerEnRappelRefuseParLaTourNeCreeRien() async throws {
        let a = app()
        let ligne = try await ouvrirFil(a)
        FauxServeur.reponses["POST /api/conversations/c1/propositions/p1/ajuster"] = [(409, #"{"error":"Déjà appliquée : utilise « Annuler » pour revenir en arrière."}"#)]
        let ok = await a.chat.rangerEnRappel(ligne, rang: 0, texte: "Acheter", quand: nil, etiquettes: [])
        XCTAssertFalse(ok)
        XCTAssertTrue(a.carnet.rappels.isEmpty, "pas de doublon : la tâche existe déjà dans Motion")
        XCTAssertEqual(FauxServeur.recues.filter { $0 == "GET /api/conversations/c1" }.count, 2, "l'état réel est relu")
    }

    func testSansLaTourAJourPasDAjustement() async {
        let a = app(capacites: [])
        XCTAssertFalse(a.chat.ajustementDisponible)
        XCTAssertFalse(a.tableau.categoriesDisponibles)
    }

    func testCategoriserUneTacheSeVoitToutDeSuiteEtRevientSiRefuse() async throws {
        let a = app()
        let jour = #"{"journee":{"jour":"2026-10-18","items":[{"type":"tache","id":"t1","titre":"Vidange","debut":1792486800000,"fin":1792490400000}],"aFaire":[{"id":"t2","titre":"Devis"}],"retard":{"total":1,"items":[{"id":"t3","titre":"Relancer"}]},"sources":{"motion":"ok","agenda":"ok"}}}"#
        FauxServeur.reponses["GET /api/dashboard"] = [(200, jour)]
        await a.tableau.charger()
        FauxServeur.reponses["PUT /api/taches/t1/etiquettes"] = [(200, #"{"ok":true}"#)]
        let ok = await a.tableau.categoriser(id: "t1", titre: "Vidange", etiquettes: ["voiture"])
        XCTAssertTrue(ok)
        XCTAssertEqual(FauxServeur.corps["PUT /api/taches/t1/etiquettes"]?["etiquettes"] as? [String], ["voiture"])
        XCTAssertEqual(a.tableau.journee?.items?.first?.etiquettes, ["voiture"])
        // En retard : la ligne aussi.
        FauxServeur.reponses["PUT /api/taches/t3/etiquettes"] = [(200, #"{"ok":true}"#)]
        await a.tableau.categoriser(id: "t3", titre: "Relancer", etiquettes: ["pro"])
        XCTAssertEqual(a.tableau.journee?.retard?.items.first?.etiquettes, ["pro"])
        // Refusé : la catégorie d'avant revient, et c'est dit.
        FauxServeur.reponses["PUT /api/taches/t2/etiquettes"] = [(500, #"{"error":"base indisponible"}"#)]
        let refuse = await a.tableau.categoriser(id: "t2", titre: "Devis", etiquettes: ["pro"])
        XCTAssertFalse(refuse)
        XCTAssertNil(a.tableau.journee?.aFaire?.first?.etiquettes)
        XCTAssertTrue(a.toast?.hasPrefix("Catégorie de « Devis » pas enregistrée") ?? false, a.toast ?? "")
    }
}

/// Corriger la dictée (19/10) : un mot surligné part à la tour, qui le transmet
/// à Dictée Locale ; le résultat est dit, l'échec aussi.
@MainActor
final class CorrectionDicteeTests: XCTestCase {
    override func tearDown() {
        FauxServeur.reponses = [:]
        FauxServeur.corps = [:]
    }

    private func app() -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
        a.serveur = VersionServeur(api: 1, serveur: "0.5.0", capacites: ["dictee-correction-v1"])
        return a
    }

    func testUneCorrectionPartEtCestDit() async throws {
        let a = app()
        XCTAssertTrue(a.chat.correctionDicteeDisponible)
        FauxServeur.reponses["POST /api/dictee/correction"] = [(200, #"{"ok":true,"de":"remi","vers":"Rémy"}"#)]
        let ok = await a.chat.corrigerDictee(entendu: "Rémi", voulu: "Rémy")
        XCTAssertTrue(ok)
        let corps = try XCTUnwrap(FauxServeur.corps["POST /api/dictee/correction"])
        XCTAssertEqual(corps["entendu"] as? String, "Rémi")
        XCTAssertEqual(corps["voulu"] as? String, "Rémy")
        XCTAssertEqual(a.toast, "Dictée Locale retiendra « Rémy ».")
    }

    func testUneDicteeLocaleTropAncienneLeDit() async {
        let a = app()
        FauxServeur.reponses["POST /api/dictee/correction"] = [(501, #"{"error":"dictee","message":"Dictée Locale ne sait pas encore apprendre depuis Rémy : mets-la à jour."}"#)]
        let ok = await a.chat.corrigerDictee(entendu: "cloud", voulu: "Claude")
        XCTAssertFalse(ok)
        XCTAssertEqual(a.toast, "Pas envoyé à Dictée Locale : Dictée Locale ne sait pas encore apprendre depuis Rémy : mets-la à jour.")
    }
}
