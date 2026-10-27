import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Conversation privée depuis l'iPhone (27/10) : naître privée, le devenir
/// (sans retour), le dire ; l'interrupteur de recherche ; la jauge et le
/// résumé à 70 %.
@MainActor
final class PriveeTests: XCTestCase {
    override func tearDown() {
        FauxServeur.reponses = [:]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.historique = [:]
    }

    private func app(_ capacites: [String] = ["recherche-privee-v1", "jauge-v1", "compactage-v1"]) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
        a.serveur = VersionServeur(api: 1, serveur: "0.9.0", capacites: capacites)
        return a
    }

    private let flux = "event: done\ndata: {\"text\":\"Je réponds d'ici.\",\"model\":\"glm\",\"tier\":\"local\"}\n\n"

    // MARK: Naître privée

    func testUneNouvelleConversationPriveeNaitPrivee() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(201, #"{"id":"p1","title":"Nouvelle conversation","messages":[],"prive":true}"#)],
            "POST /api/conversations/p1/messages": [(200, flux)],
            "GET /api/conversations": [(200, #"[{"id":"p1","title":"Nouvelle conversation","updatedAt":1,"prive":true}]"#)],
        ]
        let a = app()
        a.chat.nouvellePrivee()
        XCTAssertTrue(a.chat.privee, "le signe est là avant même le premier message")
        XCTAssertNil(a.chat.idCourant, "rien n'existe sur la tour avant le premier message")
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/conversations"))
        await a.chat.envoyer("Un secret")
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations"]?["prive"] as? Bool, true, "créée privée, jamais un instant publique")
        XCTAssertTrue(a.chat.privee)
        XCTAssertEqual(a.chat.conversations.first?.prive, true)
        // « Nouvelle » (ordinaire) : le signe s'en va.
        a.chat.nouvelle()
        XCTAssertFalse(a.chat.privee)
    }

    func testUneConversationOrdinaireNEnvoiePasPrive() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(201, #"{"id":"c1","title":"Nouvelle conversation","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, flux)],
            "GET /api/conversations": [(200, #"[{"id":"c1","title":"x","updatedAt":1}]"#)],
        ]
        let a = app()
        a.chat.nouvelle()
        await a.chat.envoyer("Bonjour")
        XCTAssertNil(FauxServeur.corps["POST /api/conversations"]?["prive"])
        XCTAssertFalse(a.chat.privee)
    }

    // MARK: Le devenir

    func testRendrePriveeLaConversationEnCours() async {
        FauxServeur.reponses = [
            "GET /api/conversations/c1": [(200, #"{"id":"c1","title":"Budget","messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]}"#)],
            "GET /api/conversations": [(200, #"[{"id":"c1","title":"Budget","updatedAt":1}]"#)],
            "PATCH /api/conversations/c1": [(200, #"{"id":"c1","title":"Budget","pinned":false,"prive":true}"#)],
        ]
        let a = app()
        _ = await a.chat.ouvrir("c1")
        XCTAssertFalse(a.chat.privee)
        let ok = await a.chat.rendrePrivee()
        XCTAssertTrue(ok)
        XCTAssertTrue(a.chat.privee)
        XCTAssertEqual(FauxServeur.corps["PATCH /api/conversations/c1"]?["prive"] as? Bool, true)
        XCTAssertEqual(a.chat.conversations.first { $0.id == "c1" }?.prive, true)
        XCTAssertEqual(a.toast, "Conversation privée : elle reste sur tes machines.")
        // Déjà privée : rien ne repart vers la tour.
        FauxServeur.recues = []
        _ = await a.chat.rendrePrivee()
        XCTAssertFalse(FauxServeur.recues.contains("PATCH /api/conversations/c1"))
    }

    func testUnRefusDeLaTourLaisseLaConversationTelleQuelle() async {
        FauxServeur.reponses = [
            "GET /api/conversations/c1": [(200, #"{"id":"c1","title":"Budget","messages":[{"role":"user","content":"a"}]}"#)],
            "GET /api/conversations": [(200, #"[{"id":"c1","title":"Budget","updatedAt":1}]"#)],
            "PATCH /api/conversations/c1": [(500, #"{"error":"Erreur serveur"}"#)],
        ]
        let a = app()
        _ = await a.chat.ouvrir("c1")
        let ok = await a.chat.rendrePrivee()
        XCTAssertFalse(ok)
        XCTAssertFalse(a.chat.privee, "pas de cadenas affiché tant que la tour ne l'a pas fait")
        XCTAssertNotNil(a.toast, "l'échec se dit")
    }

    func testRendrePriveeUnEcranVideNeContactePasLaTour() async {
        let a = app()
        a.chat.nouvelle()
        let ok = await a.chat.rendrePrivee()
        XCTAssertTrue(ok)
        XCTAssertTrue(a.chat.privee)
        XCTAssertTrue(FauxServeur.recues.isEmpty)
    }

    func testOuvrirUneConversationPriveeOuImporteeMontreLeSigne() async {
        FauxServeur.reponses = [
            "GET /api/conversations/p1": [(200, #"{"id":"p1","title":"Secret","prive":true,"messages":[]}"#)],
            "GET /api/conversations/i1": [(200, #"{"id":"i1","title":"Import","origine":{"source":"chatgpt"},"messages":[]}"#)],
            "GET /api/conversations/c1": [(200, #"{"id":"c1","title":"Ordinaire","messages":[]}"#)],
            "GET /api/conversations": [(200, #"[{"id":"p1","title":"Secret","updatedAt":1,"prive":true},{"id":"c1","title":"Ordinaire","updatedAt":1,"prive":false}]"#)],
        ]
        let a = app()
        _ = await a.chat.ouvrir("p1")
        XCTAssertTrue(a.chat.privee)
        _ = await a.chat.ouvrir("c1")
        XCTAssertFalse(a.chat.privee)
        _ = await a.chat.ouvrir("i1")
        XCTAssertTrue(a.chat.privee, "importée : privée d'office")
        XCTAssertEqual(a.chat.conversations.first { $0.id == "p1" }?.prive, true)
        a.chat.vider()
        XCTAssertFalse(a.chat.privee)
    }

    // MARK: Le dire

    func testCeQueCaChangeSeDitEnClair() {
        let coupe = ConversationPrivee.ceQueCaChange(recherche: false)
        XCTAssertTrue(coupe.contains("Rien ne part chez Claude ni ailleurs"))
        XCTAssertTrue(coupe.contains("Pas de recherche web"))
        XCTAssertEqual(ConversationPrivee.ceQueCaChange(recherche: nil), coupe, "inconnu : elle ne cherche pas")
        let permise = ConversationPrivee.ceQueCaChange(recherche: true)
        XCTAssertTrue(permise.contains("seule la question sort, passée par la salle blanche et le filtre"))
        XCTAssertFalse(permise.contains("Pas de recherche web"))
        XCTAssertTrue(ConversationPrivee.confirmation(recherche: false).hasPrefix("C'est sans retour"), "l'irréversible se dit avant de confirmer")
    }

    func testLaRecherchePriveeSeLitSurLaTour() async {
        FauxServeur.reponses = ["GET /api/reglages": [(200, #"{"secoursCloud":false,"recherchePrivee":true,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true,"rechercheLocale":"duckduckgo","rechercheWeb":true}"#)]]
        let a = app()
        await a.chat.lireRecherchePrivee()
        XCTAssertEqual(a.chat.recherchePrivee, true)
        let ancienne = app([])
        await ancienne.chat.lireRecherchePrivee()
        XCTAssertNil(ancienne.chat.recherchePrivee, "tour sans le réglage : rien à lire")
    }

    // MARK: L'interrupteur (Réglages)

    private func reglages(_ json: String) -> Reglages {
        try! JSONDecoder().decode(Reglages.self, from: Data(json.utf8))
    }

    func testLInterrupteurDitCeQuiSortEtSonVerrou() {
        let coupe = reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":false,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)
        XCTAssertNil(coupe.verrouRecherchePrivee)
        XCTAssertFalse(coupe.recherchePriveeAffichee, "coupé par défaut")
        XCTAssertTrue(coupe.phraseRecherchePrivee.hasPrefix("Coupé"))
        XCTAssertTrue(coupe.phraseRecherchePrivee.contains("seule la question part"))
        XCTAssertTrue(coupe.phraseRecherchePrivee.contains("salle blanche"))
        let allume = reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":true,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)
        XCTAssertTrue(allume.recherchePriveeAffichee)
        XCTAssertTrue(allume.phraseRecherchePrivee.hasPrefix("Allumé, seule la question part"))
        let sansWeb = reglages(#"{"secoursCloud":false,"rechercheWeb":false,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)
        XCTAssertTrue(sansWeb.phraseRecherchePrivee.contains("la recherche web est coupée"))
        // Verrouillée sur la tour : grisée, et pourquoi.
        let verrou = reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":true,"salleBlanche":true}"#)
        XCTAssertEqual(verrou.verrouRecherchePrivee?.contains("REMY_RECHERCHE_PRIVEE=off"), true)
        XCTAssertFalse(verrou.recherchePriveeAffichee, "verrouillée : affichée coupée, même si le réglage est allumé")
        let sansSalle = reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":false,"recherchePriveeVerrouillee":true,"salleBlanche":false}"#)
        XCTAssertEqual(sansSalle.verrouRecherchePrivee?.contains("REMY_SALLE_BLANCHE=off"), true)
        let sansRecherche = reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":null,"recherchePrivee":false,"recherchePriveeReglage":false,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)
        XCTAssertNotNil(sansRecherche.verrouRecherchePrivee)
    }

    func testLInterrupteurEcritSurLaTour() async throws {
        FauxServeur.reponses = ["PUT /api/reglages": [(200, #"{"secoursCloud":false,"recherchePrivee":true,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true,"rechercheLocale":"duckduckgo","rechercheWeb":true}"#)]]
        let a = app()
        let r = try await a.api.changerRecherchePrivee(true)
        XCTAssertEqual(FauxServeur.corps["PUT /api/reglages"]?["recherchePrivee"] as? Bool, true)
        XCTAssertEqual(FauxServeur.corps["PUT /api/reglages"]?.count, 1, "seul ce réglage part")
        XCTAssertEqual(r.recherchePrivee, true)
    }

    // MARK: La jauge et le résumé à 70 %

    private func jauge(_ contexte: Int, sur fenetre: Int = 100_000) -> JaugeContexte {
        var j = JaugeContexte()
        j.contexte = contexte
        j.fenetre = fenetre
        return j
    }

    func testLaJaugeDitQuandLeResumeSeFera() {
        XCTAssertEqual(JaugeContexte.phraseCompactage(jauge(40_000), compactage: nil, automatique: true, messages: 20),
                       "Résumé automatique à 70 % : encore 30 points avant que Rémy résume le début du fil.")
        XCTAssertEqual(JaugeContexte.phraseCompactage(jauge(69_500), compactage: nil, automatique: nil, messages: 20),
                       "Résumé automatique à 70 % : encore 1 point avant que Rémy résume le début du fil.")
        XCTAssertTrue(JaugeContexte.phraseCompactage(jauge(72_000), compactage: nil, automatique: true, messages: 20)
            .hasPrefix("70 % atteints : Rémy résume le début du fil juste après sa réponse"))
        XCTAssertTrue(JaugeContexte.phraseCompactage(jauge(72_000), compactage: nil, automatique: true, messages: 4)
            .contains("trop court pour être résumé"))
        XCTAssertEqual(JaugeContexte.phraseCompactage(jauge(72_000), compactage: nil, automatique: false, messages: 20),
                       "Résumé automatique coupé (Réglages) : seulement à la main, ici.")
        XCTAssertEqual(JaugeContexte.phraseCompactage(JaugeContexte(), compactage: nil, automatique: true, messages: 2),
                       "Résumé automatique à 70 % de la place, dès qu'elle est mesurée.")
    }

    func testLaJaugeDitQuandLeResumeSEstFait() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = Format.fuseau
        let a = cal.date(from: DateComponents(year: 2026, month: 10, day: 27, hour: 14, minute: 2))!
        let c = Compactage(jusqua: 12, a: a.millis, resume: "…")
        let p = JaugeContexte.phraseCompactage(jauge(30_000), compactage: c, automatique: true, messages: 20)
        XCTAssertTrue(p.hasPrefix("Déjà résumé à 14:02 : les 12 premiers messages."), p)
        XCTAssertTrue(p.contains("encore 40 points"), p)
    }

    func testLaJaugeRelitLeResumeFaitSurLaTour() async {
        FauxServeur.reponses = [
            "GET /api/conversations/c1": [
                (200, #"{"id":"c1","title":"Long","messages":[{"role":"user","content":"a"}]}"#),
                (200, #"{"id":"c1","title":"Long","messages":[{"role":"user","content":"a"}],"compactage":{"jusqua":8,"a":1790000000000,"resume":"r"}}"#),
            ],
            "GET /api/conversations": [(200, #"[{"id":"c1","title":"Long","updatedAt":1}]"#)],
        ]
        let a = app()
        _ = await a.chat.ouvrir("c1")
        XCTAssertNil(a.chat.compactage)
        await a.chat.relireCompactage()
        XCTAssertEqual(a.chat.compactage?.jusqua, 8, "le résumé automatique, fait après la réponse, se voit en rouvrant la jauge")
    }
}
