import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// V8 : une recherche web passe par Claude (Anthropic). Rémy demande d'abord,
/// en disant ce qui partirait ; rien ne part sans l'accord de Sam.
@MainActor
final class RechercheWebTests: XCTestCase {
    private let demande = [
        "event: delta\ndata: {\"text\":\"Pour te répondre, il faut chercher sur le web.\"}\n\n",
        "event: autorisation\ndata: {\"id\":\"a1\",\"type\":\"web\",\"statut\":\"en_attente\",\"contexte\":false,\"requete\":\"La piscine est ouverte ?\",\"index\":1}\n\n",
        "event: done\ndata: {\"stop_reason\":\"autorisation\",\"model\":\"remy\",\"tier\":\"autorisation\",\"usd\":0,\"text\":\"Pour te répondre, il faut chercher sur le web.\"}\n\n",
    ].joined()
    private let reponseWeb = "event: done\ndata: {\"text\":\"La piscine ferme à 22 h.\",\"model\":\"claude-sonnet-5\",\"tier\":\"web\",\"usd\":0.01}\n\n"
    private let route = "POST /api/conversations/c1/autorisations/a1"

    private func app(_ reponses: [String: [(Int, String)]]) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.historique = [:]
        FauxServeur.coupures = [:]
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, demande)],
            "GET /api/conversations": [(200, "[]")],
        ].merging(reponses) { _, nouveau in nouveau }
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
        a.chat.pasRecuperation = 1_000_000
        return a
    }

    func testLaDemandeSAfficheEtRienNePartChezClaude() async {
        let a = app([:])
        await a.chat.envoyer("La piscine est ouverte ?")
        let l = a.chat.lignes
        XCTAssertEqual(l.count, 2)
        XCTAssertEqual(l[1].autorisation?.id, "a1")
        XCTAssertEqual(l[1].autorisation?.enAttente, true)
        XCTAssertEqual(l[1].indexMessage, 1)
        XCTAssertTrue(l[1].autorisation?.partira.hasPrefix("ta question seulement") ?? false)
        XCTAssertFalse(l[1].enCours)
        XCTAssertFalse(FauxServeur.recues.contains { $0.contains("/autorisations/") }, "pas d'accord sans tap")
    }

    func testChercherEnvoieLAccordEtAfficheLaReponse() async {
        let a = app([route: [(200, reponseWeb)]])
        await a.chat.envoyer("La piscine est ouverte ?")
        let ok = await a.chat.repondreAutorisation(a.chat.lignes[1], accord: true)
        XCTAssertTrue(ok)
        XCTAssertEqual(FauxServeur.corps[route]?["accord"] as? Bool, true)
        XCTAssertEqual(a.chat.lignes.count, 3)
        XCTAssertEqual(a.chat.lignes[1].autorisation?.statut, "acceptee")
        XCTAssertEqual(a.chat.lignes[1].autorisation?.titre, "Recherche autorisée")
        XCTAssertEqual(a.chat.lignes[2].texte, "La piscine ferme à 22 h.")
        XCTAssertFalse(a.chat.envoi)
    }

    func testNonRepondSansLeWeb() async {
        let a = app([route: [(200, "event: done\ndata: {\"text\":\"Sans le web, je ne peux pas vérifier.\"}\n\n")]])
        await a.chat.envoyer("La piscine est ouverte ?")
        await a.chat.repondreAutorisation(a.chat.lignes[1], accord: false)
        XCTAssertEqual(FauxServeur.corps[route]?["accord"] as? Bool, false)
        XCTAssertEqual(a.chat.lignes[1].autorisation?.statut, "refusee")
        XCTAssertEqual(a.chat.lignes.last?.texte, "Sans le web, je ne peux pas vérifier.")
    }

    func testRechercheRateeLaCarteRedevientUtilisable() async {
        let a = app([route: [
            (200, "event: error\ndata: {\"message\":\"Impossible de joindre l'API Claude.\"}\n\n"),
            (200, reponseWeb),
        ]])
        await a.chat.envoyer("La piscine est ouverte ?")
        let rate = await a.chat.repondreAutorisation(a.chat.lignes[1], accord: true)
        XCTAssertFalse(rate)
        XCTAssertEqual(a.chat.lignes[1].autorisation?.enAttente, true, "la tour remet la demande en attente")
        XCTAssertEqual(a.chat.lignes.last?.erreur, "Impossible de joindre l'API Claude. — touche à nouveau la carte pour réessayer.")
        // Second tap : la ligne d'erreur laisse la place à la réponse.
        let ok = await a.chat.repondreAutorisation(a.chat.lignes[1], accord: true)
        XCTAssertTrue(ok)
        XCTAssertEqual(a.chat.lignes.count, 3)
        XCTAssertNil(a.chat.lignes.last?.erreur)
    }

    func testDejaReponduAilleursLaTourDitLEtatReel() async {
        let a = app([
            route: [(409, #"{"error":"deja","message":"Tu as déjà répondu à cette demande."}"#)],
            "GET /api/conversations/c1": [(200, #"{"id":"c1","title":"x","messages":[{"role":"user","content":"La piscine est ouverte ?"},{"role":"assistant","content":"Pour te répondre…","autorisation":{"id":"a1","type":"web","statut":"acceptee","contexte":false}},{"role":"assistant","content":"La piscine ferme à 22 h.","model":"claude-sonnet-5"}]}"#)],
        ])
        await a.chat.envoyer("La piscine est ouverte ?")
        await a.chat.repondreAutorisation(a.chat.lignes[1], accord: true)
        XCTAssertEqual(a.toast, "Tu as déjà répondu à cette demande.")
        XCTAssertEqual(a.chat.lignes.count, 3)
        XCTAssertEqual(a.chat.lignes[1].autorisation?.statut, "acceptee")
        XCTAssertEqual(a.chat.lignes[2].texte, "La piscine ferme à 22 h.")
        XCTAssertFalse(a.chat.envoi)
    }

    func testConnexionCoupeeLaReponseEstRecupereeApresLaCarte() async {
        let a = app([
            route: [(200, "event: delta\ndata: {\"text\":\"La pisc\"}\n\n")],
            "GET /api/conversations/c1": [
                (200, #"{"id":"c1","title":"x","messages":[{"role":"user","content":"La piscine est ouverte ?"},{"role":"assistant","content":"…","autorisation":{"id":"a1","statut":"acceptee"}}]}"#),
                (200, #"{"id":"c1","title":"x","messages":[{"role":"user","content":"La piscine est ouverte ?"},{"role":"assistant","content":"…","autorisation":{"id":"a1","statut":"acceptee"}},{"role":"assistant","content":"La piscine ferme à 22 h.","model":"claude-sonnet-5"}]}"#),
            ],
        ])
        await a.chat.envoyer("La piscine est ouverte ?")
        let ok = await a.chat.repondreAutorisation(a.chat.lignes[1], accord: true)
        XCTAssertTrue(ok)
        XCTAssertEqual(a.chat.lignes.last?.texte, "La piscine ferme à 22 h.")
        XCTAssertFalse(a.chat.lignes.last?.enCours ?? true)
    }

    func testAccordJamaisArriveLaCarteRedevientUtilisable() async {
        let a = app([
            "GET /api/conversations/c1": [(200, #"{"id":"c1","title":"x","messages":[{"role":"user","content":"La piscine est ouverte ?"},{"role":"assistant","content":"…","autorisation":{"id":"a1","statut":"en_attente"}}]}"#)],
        ])
        FauxServeur.coupures = [route: 1]
        await a.chat.envoyer("La piscine est ouverte ?")
        let ok = await a.chat.repondreAutorisation(a.chat.lignes[1], accord: true)
        XCTAssertFalse(ok)
        XCTAssertEqual(a.chat.lignes[1].autorisation?.enAttente, true)
        XCTAssertEqual(a.chat.lignes.last?.erreur, "Ta réponse n'est pas arrivée jusqu'à Rémy — touche à nouveau la carte.")
    }

    func testOuiParMessageMetLaCarteAJour() async {
        let a = app([
            "GET /api/conversations/c1": [(200, #"{"id":"c1","title":"x","messages":[{"role":"user","content":"La piscine est ouverte ?"},{"role":"assistant","content":"…","autorisation":{"id":"a1","statut":"acceptee"}},{"role":"user","content":"oui"},{"role":"assistant","content":"La piscine ferme à 22 h."}]}"#)],
        ])
        await a.chat.envoyer("La piscine est ouverte ?")
        FauxServeur.reponses["POST /api/conversations/c1/messages"] = [(200, reponseWeb)]
        await a.chat.envoyer("oui")
        XCTAssertEqual(a.chat.lignes[1].autorisation?.statut, "acceptee")
        XCTAssertEqual(a.chat.lignes.last?.texte, "La piscine ferme à 22 h.")
    }

    func testUneDemandeSuivieDUneAutreQuestionAExpire() {
        let json = #"{"id":"c1","title":"x","messages":[{"role":"user","content":"q1"},{"role":"assistant","content":"…","autorisation":{"id":"a1","statut":"en_attente"}},{"role":"user","content":"autre chose"},{"role":"assistant","content":"ok"}]}"#
        let conv = try! JSONDecoder().decode(Conversation.self, from: Data(json.utf8))
        let l = ChatModel.lignes(de: conv)
        XCTAssertEqual(l[1].autorisation?.statut, "expiree")
        XCTAssertEqual(l[1].autorisation?.titre, "Demande expirée")
        // La dernière demande du fil, elle, reste valable.
        let seule = #"{"id":"c1","title":"x","messages":[{"role":"user","content":"q1"},{"role":"assistant","content":"…","autorisation":{"id":"a1","statut":"en_attente","contexte":true}}]}"#
        let l2 = ChatModel.lignes(de: try! JSONDecoder().decode(Conversation.self, from: Data(seule.utf8)))
        XCTAssertEqual(l2[1].autorisation?.enAttente, true)
        XCTAssertEqual(l2[1].autorisation?.partira, "ta question, la conversation et ta mémoire")
    }

    func testReglagesRechercheWebEtContexte() async throws {
        let a = app([
            "PUT /api/reglages": [(200, #"{"secoursCloud":false,"rechercheWeb":false,"rechercheWebCoupeeParLaTour":false,"contexteCloud":false}"#)],
        ])
        let r = try await a.api.changerRechercheWeb(false)
        XCTAssertEqual(r.rechercheWeb, false)
        XCTAssertEqual(FauxServeur.corps["PUT /api/reglages"]?["rechercheWeb"] as? Bool, false)
        _ = try await a.api.changerContexteCloud(true)
        XCTAssertEqual(FauxServeur.corps["PUT /api/reglages"]?["contexteCloud"] as? Bool, true)
        XCTAssertNil(FauxServeur.corps["PUT /api/reglages"]?["rechercheWeb"], "un réglage à la fois")
    }

    func testTourSansV8LesReglagesRestentLisibles() throws {
        let r = try JSONDecoder().decode(Reglages.self, from: Data(#"{"secoursCloud":false}"#.utf8))
        XCTAssertNil(r.rechercheWeb, "pas de ligne « Recherche web » face à une tour d'avant V8")
    }

    /// Recherche locale (recherche-locale-v1, 25/10) : la tour cherche elle-même.
    /// Le réglage le dit, et ne parle plus de Claude ; sans elle, l'ancien texte.
    func testRechercheLocaleLeReglageNeParlePlusDeClaude() throws {
        func lire(_ json: String) throws -> Reglages { try JSONDecoder().decode(Reglages.self, from: Data(json.utf8)) }
        let locale = try lire(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo"}"#)
        XCTAssertEqual(locale.phraseRechercheWeb, "Rémy cherche lui-même sur le web (DuckDuckGo), sans passer par Claude.")
        XCTAssertEqual(locale.confirmationRechercheWeb(true), "Recherche web permise : Rémy cherche lui-même quand il en a besoin, sans Claude.")
        XCTAssertEqual(try lire(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"searxng"}"#).moteurRecherche, "SearXNG")
        XCTAssertEqual(try lire(#"{"secoursCloud":false,"rechercheWeb":false,"rechercheLocale":"duckduckgo"}"#).phraseRechercheWeb,
                       "Coupée : Rémy répond sans le web.")
        // Une tour sans recherche locale (ou `REMY_RECHERCHE=off`) : null, ou rien.
        for json in [#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":null}"#, #"{"secoursCloud":false,"rechercheWeb":true}"#] {
            let claude = try lire(json)
            XCTAssertNil(claude.moteurRecherche)
            XCTAssertEqual(claude.phraseRechercheWeb, "Passe par Claude (Anthropic). Rémy te demande ton accord à chaque recherche.")
            XCTAssertEqual(claude.confirmationRechercheWeb(true), "Recherche web permise : Rémy te demandera avant chaque recherche.")
        }
        XCTAssertEqual(try lire(#"{"secoursCloud":false,"rechercheWeb":false,"rechercheWebCoupeeParLaTour":true,"rechercheLocale":"duckduckgo"}"#).phraseRechercheWeb,
                       "Coupée sur la tour (REMY_WEB_SEARCH=off) : à rallumer là-bas.")
        // Le tutoriel de la série 3 n'existe que si la tour cherche elle-même.
        let n = try XCTUnwrap(Nouveautes.catalogue.first { $0.id == "recherche-web" })
        XCTAssertEqual(n.serie, 3)
        XCTAssertEqual(n.capacite, "recherche-locale-v1")
        XCTAssertNil(Nouveautes.catalogue.first { $0.id == "capture-hors-ligne" }?.capacite, "la file d'envoi vit sur l'iPhone")
    }
}
