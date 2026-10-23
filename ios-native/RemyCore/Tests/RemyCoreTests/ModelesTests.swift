import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Réglages › Modèle (20/10) : la liste des Sparks, un choix envoyé à la tour,
/// le retour à l'automatique, et les erreurs dites clairement.
@MainActor
final class ModelesTests: XCTestCase {
    func app(capacites: [String] = ["modeles-v1"]) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.historique = [:]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)),
                         reglages: UserDefaults(suiteName: "modeles-tests-\(UUID().uuidString)")!)
        a.serveur = VersionServeur(api: 1, serveur: "0.6.0", capacites: capacites)
        return a
    }

    let vue = #"{"branche":true,"joignable":true,"machine":"DGX Spark","actif":{"id":"DeepSeek-V4.1-Flash-1017","libelle":"DeepSeek-V4.1-Flash-1017","source":"auto"},"choisi":null,"tour":null,"servis":[{"id":"DeepSeek-V4.1-Flash-1017","libelle":"DeepSeek-V4.1-Flash-1017","fenetre":1048576},{"id":"zai-org/GLM-5.3-FP8","libelle":"GLM-5.3","fenetre":131072}]}"#

    func testLaListeDesSparksSeLit() async {
        FauxServeur.reponses = ["GET /api/modeles": [(200, vue)]]
        let a = app()
        await a.modeles.charger()
        let v = a.modeles.vue
        XCTAssertEqual(v?.actif?.libelle, "DeepSeek-V4.1-Flash-1017")
        XCTAssertEqual(v?.servis.map(\.libelle), ["DeepSeek-V4.1-Flash-1017", "GLM-5.3"])
        XCTAssertEqual(v?.pourquoi, "Celui que tes Sparks chargent")
        XCTAssertEqual(ModelesLocaux.fenetreLisible(v?.servis.first?.fenetre), "1 M de contexte")
        XCTAssertEqual(ModelesLocaux.fenetreLisible(131_072), "128 k de contexte")
        XCTAssertNil(a.modeles.erreur)
    }

    func testChoisirPuisRevenirALAutomatique() async {
        let choisi = vue.replacingOccurrences(of: #""choisi":null"#, with: #""choisi":"zai-org/GLM-5.3-FP8""#)
            .replacingOccurrences(of: #""id":"DeepSeek-V4.1-Flash-1017","libelle":"DeepSeek-V4.1-Flash-1017","source":"auto""#,
                                  with: #""id":"zai-org/GLM-5.3-FP8","libelle":"GLM-5.3","source":"choisi""#)
        FauxServeur.reponses = ["PUT /api/modeles": [(200, choisi), (200, vue)]]
        let a = app()
        let ok = await a.modeles.choisir("zai-org/GLM-5.3-FP8")
        XCTAssertTrue(ok)
        XCTAssertEqual(FauxServeur.corps["PUT /api/modeles"]?["id"] as? String, "zai-org/GLM-5.3-FP8")
        XCTAssertEqual(a.modeles.vue?.actif?.source, "choisi")
        XCTAssertEqual(a.modeles.vue?.pourquoi, "Choisi par toi")
        // Retour à l'automatique : la tour reçoit { "id": null }.
        let auto = await a.modeles.choisir(nil)
        XCTAssertTrue(auto)
        XCTAssertTrue(FauxServeur.corps["PUT /api/modeles"]?["id"] is NSNull)
        XCTAssertNil(a.modeles.vue?.choisi)
        XCTAssertNil(a.modeles.enCours)
    }

    func testUnChoixRefuseLaisseLaVueIntacteEtLeDit() async {
        FauxServeur.reponses = [
            "GET /api/modeles": [(200, vue)],
            "PUT /api/modeles": [(409, #"{"error":"Les Sparks ne servent pas « X » : choisis un modèle de la liste."}"#)],
        ]
        let a = app()
        await a.modeles.charger()
        let ok = await a.modeles.choisir("X")
        XCTAssertFalse(ok)
        XCTAssertEqual(a.modeles.vue?.actif?.source, "auto", "rien n'a changé")
        XCTAssertNil(a.modeles.enCours)
    }

    func testLeChoixNEstPlusCharge() {
        let v = ModelesLocaux(joignable: true, machine: "DGX Spark",
                              actif: .init(id: "DeepSeek-V4.1-Flash-1017", libelle: "DeepSeek-V4.1-Flash-1017", source: "auto"),
                              choisi: "zai-org/GLM-5.3-FP8",
                              servis: [ModeleServi(id: "DeepSeek-V4.1-Flash-1017", libelle: "DeepSeek-V4.1-Flash-1017")])
        XCTAssertTrue(v.choixAbsent)
        XCTAssertTrue(v.pourquoi.hasPrefix("Ton choix n'est plus chargé"))
    }

    func testSansLaCapaciteRienNeSeDemande() async {
        let a = app(capacites: [])
        XCTAssertFalse(a.modeles.disponible)
        await a.modeles.charger()
        XCTAssertFalse(FauxServeur.recues.contains("GET /api/modeles"))
    }
}
