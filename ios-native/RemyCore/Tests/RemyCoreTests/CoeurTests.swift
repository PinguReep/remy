import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// MARK: - Flux de réponse

final class ParseurSSETests: XCTestCase {
    let flux = "event: delta\ndata: {\"text\":\"Bonjour \"}\n\nevent: delta\ndata: {\"text\":\"Sam, ça va ?\"}\n\nevent: done\ndata: {\"text\":\"Bonjour Sam, ça va ?\"}\n\n"

    func testEvenementsDansLOrdre() {
        var p = ParseurSSE()
        let e = p.alimenter(Array(flux.utf8)) + p.terminer()
        XCTAssertEqual(e.map(\.nom), ["delta", "delta", "done"])
        XCTAssertEqual(e[1].decode(Texte.self)?.text, "Sam, ça va ?")
    }

    func testPaquetsCoupesNImporteOuMemeDansUnAccent() {
        // Le réseau mobile coupe au milieu d'un « ç » (2 octets UTF-8) : le
        // texte ne doit jamais ressortir abîmé.
        let octets = Array(flux.utf8)
        for taille in [1, 2, 3, 7, 13] {
            var p = ParseurSSE()
            var e: [EvenementSSE] = []
            var i = 0
            while i < octets.count {
                e += p.alimenter(octets[i..<min(i + taille, octets.count)])
                i += taille
            }
            e += p.terminer()
            XCTAssertEqual(e.count, 3, "paquets de \(taille)")
            XCTAssertEqual(e[2].decode(Texte.self)?.text, "Bonjour Sam, ça va ?", "paquets de \(taille)")
        }
    }

    func testFinDeLigneWindowsEtCommentaires() {
        var p = ParseurSSE()
        let e = p.alimenter(Array(": ping\r\nevent: status\r\ndata: {\"text\":\"Rémy cherche\"}\r\n\r\n".utf8))
        XCTAssertEqual(e, [EvenementSSE(nom: "status", donnees: "{\"text\":\"Rémy cherche\"}")])
    }

    func testDernierEvenementSansLigneVide() {
        var p = ParseurSSE()
        XCTAssertTrue(p.alimenter(Array("event: done\ndata: {}".utf8)).isEmpty)
        XCTAssertEqual(p.terminer().map(\.nom), ["done"])
    }
}

final class MarqueursTests: XCTestCase {
    func testMarqueursCompletsRetires() {
        XCTAssertEqual(Marqueurs.retirer("C'est noté. [COUVERT:tete/vrac] [TRAITE:abcdef1234]"), "C'est noté.")
    }

    func testMarqueurEnCoursDeFrappeMasque() {
        XCTAssertEqual(Marqueurs.retirer("Fini. [SESSION-FA"), "Fini.")
        XCTAssertEqual(Marqueurs.retirer("Fini. [tra"), "Fini.")
    }

    func testLienMarkdownEnCoursDeFrappeGarde() {
        XCTAssertEqual(Marqueurs.retirer("Regarde [le site"), "Regarde [le site")
    }
}

// MARK: - Formats

final class FormatTests: XCTestCase {
    func testMontants() {
        XCTAssertEqual(Format.usd(0), "0 $")
        XCTAssertEqual(Format.usd(0.004), "< 0,01 $")
        XCTAssertEqual(Format.usd(1.5), "1,50 $")
    }

    func testDurees() {
        XCTAssertEqual(Format.duree(minutes: 40), "40 min")
        XCTAssertEqual(Format.duree(minutes: 170), "2 h 50")
        XCTAssertEqual(Format.dansCombien(25 * 60), "dans 25 min")
        XCTAssertEqual(Format.dansCombien(65 * 60), "dans 1 h 05")
        XCTAssertEqual(Format.dansCombien(10), "maintenant")
    }

    func testHeureAParis() {
        // 08:30 UTC en septembre = 10:30 à Paris.
        let d = Date(timeIntervalSince1970: 1_790_152_200) // 2026-09-23T08:30:00Z
        XCTAssertEqual(Format.heure(d), "10:30")
        XCTAssertEqual(Format.minuteDuJour(d), 630)
    }

    func testPuceModele() {
        XCTAssertEqual(Format.puceModele(model: "claude-sonnet-5", tier: "rapide", usd: 0.003), "rapide · sonnet-5 · < 0,01 $")
        XCTAssertEqual(Format.puceModele(model: "claude-sonnet-5-20260101", tier: "fixe", usd: nil), "sonnet-5")
        XCTAssertNil(Format.puceModele(model: nil, tier: nil, usd: nil))
    }

    func testDetailActionEnMotsDeTousLesJours() {
        // 11:00 UTC = 13:00 à Paris : l'heure d'une échéance en journée compte.
        let a = ActionProposee(type: "creer", nom: "Démo", echeance: "2026-09-29T11:00:00.000Z", duree: .nombre(120), priorite: "HIGH")
        XCTAssertEqual(Format.detailAction(a), "avant le mar. 29 sept. à 13:00 · 2 h · important")
        // 23:59 : « avant 23:59 » n'apprend rien, seul le jour reste.
        let b = ActionProposee(type: "creer", nom: "Rapport", echeance: "2026-09-29T21:59:00Z", priorite: "ASAP")
        XCTAssertEqual(Format.detailAction(b), "avant le mar. 29 sept. · urgent")
        let c = ActionProposee(type: "creer", nom: "Rappel", duree: .texte("REMINDER"), priorite: "MEDIUM")
        XCTAssertEqual(Format.detailAction(c), "simple rappel")
        let d = ActionProposee(type: "creer", nom: "Sans durée", duree: .texte("NONE"))
        XCTAssertEqual(Format.detailAction(d), "")
        let rdv = ActionProposee(type: "creer", titre: "Kiné", debut: "2026-09-29T08:30:00Z", lieu: "Cabinet Voltaire")
        XCTAssertEqual(Format.detailAction(rdv, versAgenda: true), "mar. 29 sept. à 10:30 · Cabinet Voltaire")
    }

    func testTitresDesFilsCommeLeSite() {
        let d = Date(timeIntervalSince1970: 1_790_152_200) // 23/09/2026
        XCTAssertEqual(Fils.journee(d), "23/09/2026 · Journée")
        XCTAssertEqual(Fils.nocturne(d), "23/09/2026 · Nocturne")
        XCTAssertEqual(Format.jourTitre(d), "Mercredi 23 septembre")
        XCTAssertEqual(Format.jourISO(d), "2026-09-23")
        XCTAssertTrue(Fils.estAncienFilDuJour("22/09/2026 · Journée", maintenant: d))
        XCTAssertFalse(Fils.estAncienFilDuJour("23/09/2026 · Nocturne", maintenant: d), "le fil du jour reste en haut")
        XCTAssertFalse(Fils.estAncienFilDuJour("Tennis", maintenant: d))
    }

    func testVerbeInconnuRetombeSurModifier() {
        XCTAssertEqual(ActionProposee(type: "<script>").verbe, "modifier")
    }
}

// MARK: - Journée, onboarding, markdown

final class LogiqueTests: XCTestCase {
    let t0: Millis = 1_790_152_200_000 // 10:30 à Paris
    func e(_ id: String, _ debutMin: Double, _ finMin: Double, rdv: Bool = true) -> ElementJour {
        ElementJour(type: rdv ? "rdv" : "tache", id: id, titre: id, debut: t0 + debutMin * 60_000, fin: t0 + finMin * 60_000)
    }

    func testEtatsDuMoment() {
        XCTAssertEqual(Jour.etat(e("a", -90, -45), maintenant: t0), .passe)
        XCTAssertEqual(Jour.etat(e("b", -15, 45), maintenant: t0), .encours)
        XCTAssertEqual(Jour.etat(e("c", 60, 90), maintenant: t0), .avenir)
    }

    func testProchainPrefereCeQuiEstEnCours() {
        let j = Journee(items: [e("a", -90, -45), e("b", -15, 45, rdv: false), e("c", 60, 90)], sources: Sources(motion: "ok", agenda: "ok"))
        XCTAssertEqual(Jour.prochain(j, maintenant: t0), .enCours(e("b", -15, 45, rdv: false)))
        XCTAssertEqual(Jour.prochain(j, maintenant: t0 + 50 * 60_000), .suivant(e("c", 60, 90)))
    }

    func testSansSourceOnLeDitPlutotQueRienDePrevu() {
        let j = Journee(items: [], sources: Sources(motion: "off", agenda: "off"))
        XCTAssertEqual(Jour.prochain(j, maintenant: t0), .aucuneSource)
        XCTAssertEqual(Jour.prochain(nil, maintenant: t0), .inconnu)
    }

    func testAucuneSourceNestPasUnePanne() {
        XCTAssertTrue(Sources(motion: "off", agenda: "off").aucune)
        XCTAssertFalse(Sources(motion: "off", agenda: "off").enPanne)
        XCTAssertTrue(Sources(motion: "erreur", agenda: "off").enPanne)
        XCTAssertFalse(Sources(motion: "erreur", agenda: "off").aucune)
        XCTAssertFalse(Sources(motion: "ok", agenda: "erreur").enPanne, "une source qui répond suffit")
        let j = Journee(items: [], sources: Sources(motion: "erreur", agenda: "erreur"))
        XCTAssertEqual(Jour.prochain(j, maintenant: t0), .enPanne)
    }

    func testRienDePrevuDitCombienSontEnRetard() {
        let j = Journee(items: [e("a", -90, -45)], aFaire: [], retard: Retard(total: 3, items: []), sources: Sources(motion: "ok", agenda: "ok"))
        XCTAssertEqual(Jour.prochain(j, maintenant: t0), .rienDePrevu(retards: 3))
        let k = Journee(items: [], aFaire: [TacheResume(id: "x", titre: "x"), TacheResume(id: "y", titre: "y")], sources: Sources(motion: "ok"))
        XCTAssertEqual(Jour.prochain(k, maintenant: t0), .aFaire(TacheResume(id: "x", titre: "x"), total: 2))
    }

    func testJourneePerimeeEtNuitRecente() {
        let d = Date(timeIntervalSince1970: 1_790_152_200) // mer. 23/09 10:30
        XCTAssertFalse(Jour.estPerimee(Journee(jour: "2026-09-23"), maintenant: d))
        XCTAssertTrue(Jour.estPerimee(Journee(jour: "2026-09-22"), maintenant: d))
        XCTAssertFalse(Jour.estPerimee(Journee(jour: nil), maintenant: d))
        // Nuit dernière = depuis hier 18:00 (Paris) = 22/09 16:00 UTC.
        XCTAssertTrue(Nuit.estRecente(1_790_092_800_000 + 60_000, maintenant: d))
        XCTAssertFalse(Nuit.estRecente(1_790_092_800_000 - 60_000, maintenant: d))
        XCTAssertFalse(Nuit.estRecente(nil, maintenant: d))
    }

    let sessions = [
        SessionOnboarding(id: "tete", title: "Vider ta tête", reperes: [Repere(id: "a", label: "A"), Repere(id: "b", label: "B")]),
        SessionOnboarding(id: "projets", title: "Projets actifs", reperes: [Repere(id: "c", label: "C"), Repere(id: "d", label: "D"), Repere(id: "e", label: "E"), Repere(id: "f", label: "F")]),
    ]

    func testPourcentagesOnboardingCommeLeSite() {
        let e = EtatOnboarding(etats: ["tete": "faite", "projets": "en_cours"], couverture: ["projets": ["c", "inconnu"]], sessions: sessions)
        XCTAssertEqual(Onboarding.pct(sessions[0], e), 100, "cochée à la main = 100 %")
        XCTAssertEqual(Onboarding.pct(sessions[1], e), 25, "un repère inventé ne compte pas")
        XCTAssertEqual(Onboarding.global(e), 63)
        XCTAssertEqual(Onboarding.reste(sessions[1], e).map(\.id), ["d", "e", "f"])
        XCTAssertEqual(Onboarding.prochaine(e)?.id, "projets")
        XCTAssertEqual(Onboarding.faites(e), 1)
    }

    func testEtapesFinesDansLeDesordre() {
        let s3 = sessions + [SessionOnboarding(id: "rythme", title: "Ton rythme", reperes: [Repere(id: "g", label: "G")])]
        let e = EtatOnboarding(etats: ["rythme": "faite"], couverture: [:], sessions: s3)
        XCTAssertEqual(Onboarding.faites(e), 1)
        XCTAssertEqual(Onboarding.prochaine(e)?.id, "tete", "la première pas finie, même si une suivante l'est")
    }

    func testMarkdownEnBlocs() {
        let b = Markdown.blocs("#### Ce que je propose\n- Une tâche\n  suite de la tâche\n- Une autre\n\n1. Premier\n2. Second\n\n```\ncode\n```\nFin **gras**.")
        XCTAssertEqual(b, [
            .titre("Ce que je propose"), .puce("Une tâche suite de la tâche"), .puce("Une autre"), .espace,
            .numero(1, "Premier"), .numero(2, "Second"), .espace, .code("code"), .paragraphe("Fin **gras**."),
        ])
    }

    /// 19/10 : un tableau de Rémy s'affichait en lignes brutes de « | ».
    func testUnTableauMarkdownDevientUnTableau() {
        let t = """
        Voici le comparatif :

        | Option | Prix | **Délai** |
        |:-------|-----:|:---:|
        | Site seul | 80 € | 1 sem. |
        | Site + RDV | 120 €
        | Tout \\| compris | 200 € | 2 sem. | en trop |

        ---
        Fin.
        """
        XCTAssertEqual(Markdown.blocs(t), [
            .paragraphe("Voici le comparatif :"), .espace,
            .tableau(entetes: ["Option", "Prix", "**Délai**"], lignes: [
                ["Site seul", "80 €", "1 sem."],
                ["Site + RDV", "120 €", ""],
                ["Tout | compris", "200 €", "2 sem."],
            ]),
            .espace, .trait, .paragraphe("Fin."),
        ])
    }

    func testDesBarresDansUnePhraseNeFontPasUnTableau() {
        XCTAssertEqual(Markdown.blocs("Choix : A | B\nEt la suite."), [.paragraphe("Choix : A | B"), .paragraphe("Et la suite.")])
        // En cours d'écriture : l'en-tête seul reste du texte jusqu'à sa ligne de séparation.
        XCTAssertEqual(Markdown.blocs("| A | B |"), [.paragraphe("| A | B |")])
    }

    func testTableauDeBordReelSeDecode() throws {
        let json = """
        {"maintenant":1790152200000,"briefing":{"text":"- a","generatedAt":1790127610506,"items":[{"id":"e53fd37418","texte":"a","etat":"ouvert","depuis":null}]},
        "journee":{"jour":"2026-09-23","minute":640,"items":[{"type":"tache","id":"t1","titre":"Démo","projet":"R","priorite":"HIGH","debut":1790152200000,"fin":1790155800000,"min":630,"minFin":690,"etat":"encours","retard":false}],
        "toute":[{"type":"rdv","id":"e4","titre":"Salon","lieu":null}],"aFaire":[],"retard":{"total":2,"items":[{"id":"t4","titre":"Relancer","echeance":1789833600000,"projet":null,"priorite":"ASAP"}]},
        "prochain":null,"sources":{"motion":"ok","agenda":"erreur"}},
        "activite":{"jours":[{"jour":"2026-09-23","minutes":170,"messages":9,"actif":true,"plages":[{"debut":"08:20","fin":"11:10"}]}],"aujourdhui":{"jour":"2026-09-23","minutes":170,"messages":9,"actif":true,"plages":[]},"serie":2,"joursActifs":10,"minutesTotal":900,"messagesTotal":40},
        "setup":{"etats":{"tete":"faite"},"convs":{},"couverture":{},"sessions":[{"id":"tete","icon":"🌪️","title":"Vider ta tête","desc":"d","prompt":"p","reperes":[{"id":"vrac","label":"L"}]}]},
        "memoire":{"mots":37,"sections":6,"totalSections":7,"updatedAt":null},
        "couts":{"aujourdhui":0.082,"jours7":0.6,"jours30":0.78,"appelsAujourdhui":4},
        "systeme":{"motion":true,"agenda":true,"transcription":false,"reflexion":true}}
        """
        let t = try JSONDecoder().decode(TableauDeBord.self, from: Data(json.utf8))
        XCTAssertEqual(t.journee?.items?.first?.titre, "Démo")
        XCTAssertEqual(t.journee?.sources?.agenda, "erreur")
        XCTAssertEqual(t.activite?.aujourdhui?.minutes, 170)
        XCTAssertEqual(t.setup?.sessions?.first?.reperes?.count, 1)
        XCTAssertEqual(t.couts?.appelsAujourdhui, 4)
    }

    func testTableauDeBordPartielSeDecodeQuandMeme() throws {
        // Une source en panne rend null : l'écran doit s'afficher sans elle.
        let t = try JSONDecoder().decode(TableauDeBord.self, from: Data(#"{"briefing":null,"activite":null,"setup":null,"couts":null}"#.utf8))
        XCTAssertNil(t.briefing)
        XCTAssertNil(t.journee)
    }
}

// MARK: - Bout en bout contre un faux serveur

/// Faux serveur : chaque requête reçoit la réponse que le test a prévue pour son chemin.
final class FauxServeur: URLProtocol {
    nonisolated(unsafe) static var reponses: [String: [(Int, String)]] = [:]
    nonisolated(unsafe) static var recues: [String] = []
    /// La chaîne de requête (après « ? ») reçue pour chaque chemin.
    nonisolated(unsafe) static var requetes: [String: String] = [:]
    /// Le dernier corps JSON reçu pour chaque chemin.
    nonisolated(unsafe) static var corps: [String: [String: Any]] = [:]
    /// Réponses volontairement lentes (nanosecondes), pour les tests de flux.
    nonisolated(unsafe) static var delais: [String: UInt64] = [:]
    /// Le numéro de build (X-Remy-App) reçu pour chaque chemin.
    nonisolated(unsafe) static var builds: [String: String] = [:]
    /// L'en-tête Authorization reçu pour chaque chemin (jeton d'appareil).
    nonisolated(unsafe) static var autorisations: [String: String] = [:]
    /// Tous les corps JSON reçus, dans l'ordre, pour chaque chemin.
    nonisolated(unsafe) static var historique: [String: [[String: Any]]] = [:]
    /// Coupures réseau à simuler (nombre de requêtes) pour un chemin.
    nonisolated(unsafe) static var coupures: [String: Int] = [:]

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let cle = "\(request.httpMethod ?? "GET") \(request.url?.path ?? "")"
        Self.recues.append(cle)
        if let q = request.url?.query { Self.requetes[cle] = q }
        if let b = request.value(forHTTPHeaderField: "X-Remy-App") { Self.builds[cle] = b }
        Self.autorisations[cle] = request.value(forHTTPHeaderField: "Authorization")
        if let d = lireCorps(), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            Self.corps[cle] = o
            Self.historique[cle, default: []].append(o)
        }
        if let n = Self.coupures[cle], n > 0 {
            Self.coupures[cle] = n - 1
            client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
            return
        }
        var file = Self.reponses[cle] ?? []
        let (code, corps) = file.isEmpty ? (404, "{\"error\":\"introuvable\"}") : file.removeFirst()
        if file.count >= 1 { Self.reponses[cle] = file } // la dernière réponse se répète
        let r = HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        let repondre = { [self] in
            client?.urlProtocol(self, didReceive: r, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(corps.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
        if let d = Self.delais[cle] {
            DispatchQueue.global().asyncAfter(deadline: .now() + .nanoseconds(Int(d)), execute: repondre)
        } else {
            repondre()
        }
    }

    private func lireCorps() -> Data? {
        if let b = request.httpBody { return b }
        guard let flux = request.httpBodyStream else { return nil }
        flux.open()
        defer { flux.close() }
        var d = Data()
        var tampon = [UInt8](repeating: 0, count: 4096)
        while flux.hasBytesAvailable {
            let n = flux.read(&tampon, maxLength: tampon.count)
            if n <= 0 { break }
            d.append(tampon, count: n)
        }
        return d
    }
    override func stopLoading() {}
}

@MainActor
final class BoutEnBoutTests: XCTestCase {
    func app() -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        return AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
    }

    func testSessionExpireeRenvoieALaConnexion() async {
        FauxServeur.reponses = ["GET /api/conversations": [(401, #"{"error":"auth"}"#)]]
        let a = app()
        await a.demarrer()
        XCTAssertEqual(a.phase, .connexion)
    }

    func testEnvoiEnFluxAvecPropositionEtTitre() async {
        let flux = [
            "event: delta\ndata: {\"text\":\"Je te propose \"}\n\n",
            "event: delta\ndata: {\"text\":\"ça. [COUVERT:tete/vrac]\"}\n\n",
            "event: proposal\ndata: {\"source\":\"motion\",\"resume\":\"r\",\"actions\":[{\"type\":\"creer\",\"nom\":\"Démo\"}],\"index\":1}\n\n",
            "event: title\ndata: {\"title\":\"Démo\"}\n\n",
            "event: done\ndata: {\"text\":\"Je te propose ça.\",\"model\":\"claude-sonnet-5\",\"tier\":\"standard\",\"usd\":0.012}\n\n",
        ].joined()
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"Nouvelle conversation","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, flux)],
            "GET /api/conversations": [(200, #"[{"id":"c1","title":"Démo","updatedAt":1}]"#)],
            "POST /api/motion/apply": [(200, #"{"ledgerId":"L1","echecs":0,"results":[{"ok":true,"espace":"Perso"}]}"#)],
        ]
        let a = app()
        await a.chat.envoyer("Cale la démo")
        let l = a.chat.lignes
        XCTAssertEqual(l.count, 2)
        XCTAssertTrue(l[0].deToi)
        XCTAssertEqual(l[1].texte, "Je te propose ça.")
        XCTAssertEqual(l[1].puce, "standard · sonnet-5 · 0,01 $")
        XCTAssertEqual(l[1].proposition?.actions.first?.libelle, "Démo")
        XCTAssertFalse(l[1].enCours)
        XCTAssertEqual(a.chat.titre, "Démo")

        await a.chat.appliquer(a.chat.lignes[1])
        XCTAssertTrue(a.chat.lignes[1].proposition?.appliquee ?? false)
        XCTAssertEqual(a.chat.lignes[1].proposition?.ledgerId, "L1")
        XCTAssertEqual(a.toast, "C'est fait dans « Perso ».")
    }

    func testErreurServeurProposeDeReessayer() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, "event: error\ndata: {\"message\":\"Limite de débit atteinte.\"}\n\n")],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        await a.chat.envoyer("Salut")
        XCTAssertEqual(a.chat.lignes.last?.erreur, "Limite de débit atteinte.")
        XCTAssertEqual(a.chat.lignes.last?.question, "Salut")
    }

    func testFluxCoupeLaReponseEstRecuperee() async {
        // Le flux s'arrête sans « done » (écran verrouillé) : la réponse est
        // retrouvée dans la conversation enregistrée par le serveur.
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, "event: delta\ndata: {\"text\":\"Je réfl\"}\n\n")],
            "GET /api/conversations/c1": [
                (200, #"{"id":"c1","title":"x","messages":[{"role":"user","content":"Salut"}]}"#),
                (200, #"{"id":"c1","title":"x","messages":[{"role":"user","content":"Salut"},{"role":"assistant","content":"Je réfléchis, voilà.","model":"claude-sonnet-5"}]}"#),
            ],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        a.chat.pasRecuperation = 1_000_000
        await a.chat.envoyer("Salut")
        XCTAssertEqual(a.chat.lignes.last?.texte, "Je réfléchis, voilà.")
        XCTAssertNil(a.chat.lignes.last?.erreur)
        XCTAssertFalse(a.chat.lignes.last?.enCours ?? true)
    }

    func testSujetCocheRevientSiLeServeurRefuse() async {
        FauxServeur.reponses = [
            "GET /api/dashboard": [(200, #"{"briefing":{"text":"- a","items":[{"id":"abc","texte":"a","etat":"ouvert"}]}}"#)],
            "PUT /api/briefing/etat": [(500, #"{"error":"Enregistrement impossible — réessaie."}"#)],
        ]
        let a = app()
        await a.tableau.charger()
        let s = a.tableau.donnees!.briefing!.items![0]
        await a.tableau.changer(s, vers: "traite")
        XCTAssertEqual(a.tableau.donnees?.briefing?.items?[0].etat, "ouvert")
        XCTAssertEqual(a.toast, "Enregistrement impossible — réessaie.")
    }

    func testRetenirTropCourtNePartPas() async {
        FauxServeur.reponses = [:]
        let a = app()
        a.chat.brouillon = "trop court"
        await a.chat.retenir()
        XCTAssertEqual(a.toast, "Encore quelques mots pour que Rémy puisse le retenir.")
        XCTAssertEqual(a.chat.brouillon, "trop court", "le texte reste là")
        XCTAssertTrue(FauxServeur.recues.isEmpty, "aucun appel IA pour un texte trop court")
    }

    func testRetenirDitDOuVientLeTexte() async throws {
        FauxServeur.reponses = ["POST /api/capture": [(200, #"{"ajouts":["Sam fait du tennis le samedi","Il vise un chrono"],"memoire":true}"#)]]
        let a = app()
        a.chat.modeRetenir = true
        a.chat.brouillon = "Réponse de ChatGPT sur le tennis : réglages de pression et trajectoires."
        await a.chat.retenir(source: "chatgpt")
        XCTAssertEqual(a.toast, "Retenu : Sam fait du tennis le samedi — et 1 autre chose.")
        XCTAssertEqual(a.chat.brouillon, "")
        XCTAssertFalse(a.chat.modeRetenir)
        let corps = try XCTUnwrap(FauxServeur.corps["POST /api/capture"])
        XCTAssertEqual(corps["source"] as? String, "chatgpt")
    }

    func testRetenirEchoueGardeLeTexte() async {
        FauxServeur.reponses = ["POST /api/capture": [(500, #"{"error":"Mémoire indisponible."}"#)]]
        let a = app()
        a.chat.brouillon = "Une idée assez longue pour être retenue par Rémy cette nuit."
        await a.chat.retenir()
        XCTAssertEqual(a.chat.brouillon, "Une idée assez longue pour être retenue par Rémy cette nuit.")
        XCTAssertTrue(a.toast?.hasPrefix("Pas retenu") ?? false, a.toast ?? "")
    }

    let journeeDemo = #"{"journee":{"jour":"2026-09-23","items":[{"type":"tache","id":"t1","titre":"Démo","debut":1790152200000,"fin":1790155800000}],"aFaire":[{"id":"t2","titre":"Devis"}],"retard":{"total":1,"items":[{"id":"t3","titre":"Relancer"}]},"sources":{"motion":"ok","agenda":"ok"}}}"#

    /// RÉGRESSION (08/10) : tirer pour rafraîchir envoyait « /api/dashboard%3Ffrais=1 »,
    /// une route inconnue — « Rémy n'a pas pu rafraîchir ta journée » jusqu'à « Réessayer ».
    func testTirerPourRafraichirGardeLaRouteEtPoseLaRequete() async {
        FauxServeur.reponses = ["GET /api/dashboard": [(200, journeeDemo)]]
        FauxServeur.requetes = [:]
        let a = app()
        await a.chargerTout(frais: true)
        XCTAssertNil(a.tableau.erreur)
        XCTAssertEqual(FauxServeur.requetes["GET /api/dashboard"], "frais=1")
    }

    func testCocherUneTacheEtAnnuler() async throws {
        FauxServeur.reponses = [
            "GET /api/dashboard": [(200, journeeDemo)],
            "POST /api/motion/apply": [(200, #"{"ledgerId":"L7","echecs":0,"results":[{"ok":true,"type":"terminer","nom":"Démo"}]}"#)],
            "POST /api/motion/undo": [(200, #"{"ok":true,"undone":[{"ok":true,"nom":"Démo"}]}"#)],
        ]
        let a = app()
        a.tableau.delaiAnnulation = 0
        await a.tableau.charger()
        let issue = await a.tableau.terminer(id: "t1", titre: "Démo")
        XCTAssertEqual(issue, .faite)
        XCTAssertNil(a.message, "le bandeau « Annuler » ne survit pas à l'envoi")
        XCTAssertEqual(a.tableau.cochees.map(\.id), ["t1"])
        XCTAssertEqual(a.tableau.cochees.first?.ledgerId, "L7")
        XCTAssertEqual(a.tableau.journee?.items?.count, 0)
        let envoye = try XCTUnwrap(FauxServeur.corps["POST /api/motion/apply"])
        let action = try XCTUnwrap((envoye["actions"] as? [[String: Any]])?.first)
        XCTAssertEqual(action["type"] as? String, "terminer")
        XCTAssertEqual(action["id"] as? String, "t1")
        XCTAssertEqual(action["nom"] as? String, "Démo")

        // Le serveur garde Motion en cache : la tâche revient dans sa réponse,
        // mais ne doit pas ressusciter à l'écran.
        await a.tableau.charger()
        XCTAssertEqual(a.tableau.journee?.items?.count, 0)
        XCTAssertEqual(a.tableau.journee?.aFaire?.count, 1)

        await a.tableau.annulerCoche("t1")
        XCTAssertTrue(a.tableau.cochees.isEmpty)
        XCTAssertEqual(a.toast, "Annulé : « Démo » est de retour.")
        XCTAssertEqual(a.tableau.journee?.items?.count, 1)
    }

    func testCocheRefuseeParMotionRevient() async {
        FauxServeur.reponses = [
            "GET /api/dashboard": [(200, journeeDemo)],
            "POST /api/motion/apply": [(200, #"{"echecs":1,"results":[{"ok":false,"nom":"Relancer","erreur":"tâche introuvable"}]}"#)],
        ]
        let a = app()
        a.tableau.delaiAnnulation = 0
        await a.tableau.charger()
        let issue = await a.tableau.terminer(id: "t3", titre: "Relancer")
        XCTAssertEqual(issue, .echec)
        XCTAssertTrue(a.tableau.cochees.isEmpty)
        XCTAssertEqual(a.tableau.journee?.retard?.total, 1)
        XCTAssertEqual(a.toast, "Motion n'a pas pu marquer « Relancer » comme fait : tâche introuvable.")
    }

    func testCocherUnRetardBaisseLeCompte() async {
        FauxServeur.reponses = [
            "GET /api/dashboard": [(200, journeeDemo)],
            "POST /api/motion/apply": [(200, #"{"ledgerId":"L8","echecs":0,"results":[{"ok":true}]}"#)],
        ]
        let a = app()
        a.tableau.delaiAnnulation = 0
        await a.tableau.charger()
        await a.tableau.terminer(id: "t3", titre: "Relancer")
        XCTAssertEqual(a.tableau.journee?.retard?.total, 0)
        XCTAssertEqual(a.tableau.journee?.retard?.items.count, 0)
    }

    /// Sam (09/10) : la tâche doit disparaître AU TOUCHER, pas après la
    /// réponse de Motion. Pendant deux secondes, rien n'est envoyé.
    func testCocheOptimisteDisparaitAvantMotion() async throws {
        FauxServeur.reponses = [
            "GET /api/dashboard": [(200, journeeDemo)],
            "POST /api/motion/apply": [(200, #"{"ledgerId":"L9","echecs":0,"results":[{"ok":true}]}"#)],
        ]
        let a = app()
        a.tableau.delaiAnnulation = 0.4
        await a.tableau.charger()
        let coche = Task { await a.tableau.terminer(id: "t1", titre: "Démo") }
        for _ in 0..<200 where a.tableau.cochees.isEmpty { try? await Task.sleep(nanoseconds: 2_000_000) }
        XCTAssertEqual(a.tableau.journee?.items?.count, 0, "partie tout de suite")
        XCTAssertEqual(a.tableau.cochees.first?.enAttente, true)
        XCTAssertEqual(a.toast, "« Démo » : fait.")
        XCTAssertNotNil(a.message?.annuler)
        XCTAssertEqual(a.message?.duree, 0.4, "le bandeau ne vit que le temps du délai")
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/motion/apply"), "rien n'est encore parti")
        let issue = await coche.value
        XCTAssertEqual(issue, .faite)
        XCTAssertTrue(FauxServeur.recues.contains("POST /api/motion/apply"))
        XCTAssertEqual(a.tableau.cochees.first?.ledgerId, "L9")
        XCTAssertEqual(a.tableau.cochees.first?.enAttente, false)
        XCTAssertNil(a.message)
    }

    func testAnnulerPendantLeDelaiNEnvoieRien() async {
        FauxServeur.reponses = [
            "GET /api/dashboard": [(200, journeeDemo)],
            "POST /api/motion/apply": [(200, #"{"ledgerId":"L9","echecs":0,"results":[{"ok":true}]}"#)],
        ]
        let a = app()
        a.tableau.delaiAnnulation = 0.5
        await a.tableau.charger()
        let coche = Task { await a.tableau.terminer(id: "t2", titre: "Devis") }
        for _ in 0..<200 where a.tableau.cochees.isEmpty { try? await Task.sleep(nanoseconds: 2_000_000) }
        XCTAssertEqual(a.tableau.journee?.aFaire?.count, 0)
        a.message?.annuler?() // le bouton « Annuler » du bandeau
        XCTAssertTrue(a.tableau.cochees.isEmpty)
        XCTAssertEqual(a.tableau.journee?.aFaire?.count, 1, "la tâche revient aussitôt")
        let issue = await coche.value
        XCTAssertEqual(issue, .renoncee)
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/motion/apply"), "Motion n'en sait rien")
    }

    func testCocheSansReseauRevientEtLeDit() async {
        FauxServeur.reponses = [
            "GET /api/dashboard": [(200, journeeDemo)],
            "POST /api/motion/apply": [(502, #"{"error":"motion","message":"Motion ne répond pas."}"#)],
        ]
        let a = app()
        a.tableau.delaiAnnulation = 0
        await a.tableau.charger()
        let issue = await a.tableau.terminer(id: "t2", titre: "Devis")
        XCTAssertEqual(issue, .echec)
        XCTAssertTrue(a.tableau.cochees.isEmpty)
        XCTAssertEqual(a.tableau.journee?.aFaire?.count, 1)
        XCTAssertEqual(a.toast, "Motion n'a pas pu marquer « Devis » comme fait : Motion ne répond pas. La tâche est de retour.")
    }

    func testNouvelleNAppellePasLeServeur() async {
        FauxServeur.reponses = [:]
        let a = app()
        a.chat.nouvelle()
        XCTAssertTrue(FauxServeur.recues.isEmpty, "plus de fil vide créé pour rien")
        XCTAssertTrue(a.chat.focusDemande)
        XCTAssertNil(a.chat.idCourant)
    }

    /// Sam (09/10) : une conversation neuve à chaque fois, même si le fil du jour existe.
    func testOrganiserMaJourneeOuvreToujoursUnFilNeuf() async {
        let titre = Fils.journee(Date())
        FauxServeur.reponses = [
            "GET /api/conversations": [(200, #"[{"id":"j1","title":"\#(titre)"}]"#)],
            "POST /api/conversations": [(200, #"{"id":"c2","title":"Nouvelle conversation","messages":[]}"#)],
            "PATCH /api/conversations/c2": [(200, #"{"ok":true}"#)],
            "POST /api/conversations/c2/messages": [(200, "event: done\ndata: {\"text\":\"Voici ton plan.\"}\n\n")],
        ]
        let a = app()
        await a.chat.rafraichirListe()
        await a.organiserJournee()
        XCTAssertEqual(a.chat.idCourant, "c2")
        XCTAssertFalse(FauxServeur.recues.contains("GET /api/conversations/j1"), "l'ancien fil n'est pas rouvert")
        XCTAssertEqual(a.chat.lignes.last?.texte, "Voici ton plan.")
    }

    func testOrganiserMaJourneeNommeLeFilAvantDEnvoyer() async {
        let titre = Fils.journee(Date())
        FauxServeur.reponses = [
            "GET /api/conversations": [(200, "[]")],
            "POST /api/conversations": [(200, #"{"id":"c1","title":"Nouvelle conversation","messages":[]}"#)],
            "PATCH /api/conversations/c1": [(200, #"{"ok":true}"#)],
            "POST /api/conversations/c1/messages": [(200, "event: done\ndata: {\"text\":\"Commence par la démo.\"}\n\n")],
        ]
        let a = app()
        await a.chat.rafraichirListe()
        await a.organiserJournee()
        XCTAssertEqual(a.chat.titre, titre)
        let ordre = FauxServeur.recues.filter { $0.hasPrefix("POST") || $0.hasPrefix("PATCH") }
        XCTAssertEqual(ordre, ["POST /api/conversations", "PATCH /api/conversations/c1", "POST /api/conversations/c1/messages"])
        XCTAssertEqual(FauxServeur.corps["PATCH /api/conversations/c1"]?["title"] as? String, titre)
        XCTAssertEqual(a.chat.lignes.last?.texte, "Commence par la démo.")
    }

    /// Préparer une question depuis « Aujourd'hui » ouvre une conversation neuve,
    /// même quand une autre est ouverte.
    func testPreparerOuvreUneConversationNeuve() async {
        FauxServeur.reponses = [
            "GET /api/conversations": [(200, #"[{"id":"j1","title":"x"}]"#)],
            "GET /api/conversations/j1": [(200, #"{"id":"j1","title":"x","messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]}"#)],
        ]
        let a = app()
        await a.chat.rafraichirListe()
        _ = await a.chat.ouvrir("j1")
        XCTAssertEqual(a.chat.idCourant, "j1")
        let fait = await a.preparer("Aide-moi pour « Devis ».", dansFil: Fils.journee(Date()))
        XCTAssertTrue(fait)
        XCTAssertNil(a.chat.idCourant)
        XCTAssertEqual(a.chat.brouillon, "Aide-moi pour « Devis ».")
        XCTAssertEqual(a.onglet, .remy)
    }

    /// Sam (09/10) : toucher une tâche en retard pour la replanifier.
    func testReplanifierEnvoieUneEcheanceAvecFuseau() async throws {
        FauxServeur.reponses = [
            "POST /api/motion/apply": [(200, #"{"ledgerId":"L9","echecs":0,"results":[{"ok":true,"type":"modifier","nom":"Devis"}]}"#)],
            "GET /api/dashboard": [(200, journeeDemo)],
        ]
        let a = app()
        let demain = Format.echeanceDans(jours: 1)
        let ok = await a.tableau.replanifier(id: "t2", titre: "Devis", echeance: demain)
        XCTAssertTrue(ok)
        let envoye = try XCTUnwrap(FauxServeur.corps["POST /api/motion/apply"])
        let action = try XCTUnwrap((envoye["actions"] as? [[String: Any]])?.first)
        XCTAssertEqual(action["type"] as? String, "modifier")
        XCTAssertEqual(action["id"] as? String, "t2")
        XCTAssertEqual(action["nom"] as? String, "Devis")
        let iso = try XCTUnwrap(action["echeance"] as? String)
        XCTAssertFalse(iso.hasSuffix("Z"), "jamais en UTC : \(iso)")
        XCTAssertTrue(iso.contains("T23:00:00"), iso)
        XCTAssertNotNil(a.message?.annuler, "replanifier s'annule depuis le bandeau")
    }

    func testReplanifierRefuseParMotionLeDit() async {
        FauxServeur.reponses = [
            "POST /api/motion/apply": [(200, #"{"ledgerId":"L9","echecs":1,"results":[{"ok":false,"type":"modifier","erreur":"quota"}]}"#)],
        ]
        let a = app()
        let ok = await a.tableau.replanifier(id: "t2", titre: "Devis", echeance: Date())
        XCTAssertFalse(ok)
        XCTAssertTrue(a.message?.texte.contains("quota") ?? false, a.message?.texte ?? "")
    }

    func testRouvrirLeFilPendantLaReponseNeLaCoupePas() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, "event: done\ndata: {\"text\":\"Fini.\"}\n\n")],
            "GET /api/conversations": [(200, #"[{"id":"c1","title":"x"}]"#)],
        ]
        FauxServeur.delais = ["POST /api/conversations/c1/messages": 300_000_000]
        defer { FauxServeur.delais = [:] }
        let a = app()
        let envoi = Task { await a.chat.envoyer("Salut") }
        for _ in 0..<200 where a.chat.lignes.isEmpty { try? await Task.sleep(nanoseconds: 5_000_000) }
        XCTAssertEqual(a.chat.conversations.map(\.id), ["c1"], "le fil créé est dans la liste avant la fin de la réponse")
        let ok = await a.chat.ouvrir("c1")
        XCTAssertTrue(ok)
        XCTAssertTrue(a.chat.envoi, "la réponse continue")
        XCTAssertFalse(FauxServeur.recues.contains("GET /api/conversations/c1"))
        await envoi.value
        XCTAssertEqual(a.chat.lignes.last?.texte, "Fini.")
    }

    func testFilQuitteEnCoursDeReponseEstRepris() async {
        let maintenant = Int(Date().millis)
        FauxServeur.reponses = [
            "GET /api/conversations/c1": [
                (200, #"{"id":"c1","title":"x","updatedAt":\#(maintenant),"messages":[{"role":"user","content":"Salut"}]}"#),
                (200, #"{"id":"c1","title":"x","updatedAt":\#(maintenant),"messages":[{"role":"user","content":"Salut"}]}"#),
                (200, #"{"id":"c1","title":"x","updatedAt":\#(maintenant),"messages":[{"role":"user","content":"Salut"},{"role":"assistant","content":"Bonjour !"}]}"#),
            ],
            "GET /api/conversations": [(200, #"[{"id":"c1","title":"x"}]"#)],
        ]
        let a = app()
        a.chat.pasRecuperation = 1_000_000
        await a.chat.ouvrir("c1")
        XCTAssertTrue(a.chat.envoi)
        XCTAssertEqual(a.chat.lignes.last?.statut, "Rémy termine sa réponse…")
        for _ in 0..<200 where a.chat.envoi { try? await Task.sleep(nanoseconds: 5_000_000) }
        XCTAssertFalse(a.chat.envoi)
        XCTAssertEqual(a.chat.lignes.last?.texte, "Bonjour !")
        XCTAssertEqual(a.chat.lignes.count, 2)
    }

    func testRefusDuServeurAvantLeFluxEstDitTelQuel() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(429, #"{"error":"Trop de messages : attends une minute."}"#)],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        await a.chat.envoyer("Salut")
        XCTAssertEqual(a.chat.lignes.last?.erreur, "Trop de messages : attends une minute.")
        XCTAssertFalse(a.chat.envoi)
        XCTAssertFalse(FauxServeur.recues.contains("GET /api/conversations/c1"), "pas de fausse récupération")
    }

    func testMauvaisMotDePasseNEstPasUneSessionExpiree() async {
        FauxServeur.reponses = ["POST /api/login": [(401, #"{"error":"bad_password","message":"Mot de passe incorrect."}"#)]]
        let a = app()
        do {
            try await a.connecter(motDePasse: "faux")
            XCTFail("doit échouer")
        } catch {
            XCTAssertEqual((error as? LocalizedError)?.errorDescription, "Mot de passe incorrect.")
        }
    }

    func testAnnulationPartielleNEstPasPresenteeCommeTotale() async throws {
        let flux = "event: proposal\ndata: {\"source\":\"motion\",\"actions\":[{\"type\":\"creer\",\"nom\":\"A\",\"description\":\"Notes de Rémy\"},{\"type\":\"creer\",\"nom\":\"B\"}],\"index\":1}\n\nevent: done\ndata: {\"text\":\"Voilà.\"}\n\n"
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, flux)],
            "GET /api/conversations": [(200, "[]")],
            "POST /api/motion/apply": [(200, #"{"ledgerId":"L3","echecs":0,"results":[{"ok":true,"nom":"A"},{"ok":true,"nom":"B"}]}"#)],
            "POST /api/motion/undo": [(200, #"{"ok":false,"undone":[{"ok":true,"nom":"A"},{"ok":false,"nom":"B","erreur":"tâche déjà modifiée"}]}"#)],
        ]
        let a = app()
        await a.chat.envoyer("Ajoute A et B")
        await a.chat.appliquer(a.chat.lignes[1])
        let envoye = try XCTUnwrap(FauxServeur.corps["POST /api/motion/apply"])
        XCTAssertEqual((envoye["actions"] as? [[String: Any]])?.first?["description"] as? String, "Notes de Rémy",
                       "les notes jointes par Rémy partent avec la tâche")
        await a.chat.annuler(a.chat.lignes[1])
        let p = try XCTUnwrap(a.chat.lignes[1].proposition)
        XCTAssertNotEqual(p.annulee, true)
        XCTAssertEqual(p.echecAnnulation(pour: p.actions[1])?.erreur, "tâche déjà modifiée")
        XCTAssertNil(p.echecAnnulation(pour: p.actions[0]))
        XCTAssertTrue(a.toast?.hasPrefix("Annulation incomplète") ?? false, a.toast ?? "")
    }

    func testPreparerNEcrasePasUnBrouillon() async {
        FauxServeur.reponses = ["GET /api/conversations": [(200, "[]")]]
        let a = app()
        a.chat.brouillon = "Mon message à moitié écrit"
        let fait = await a.preparer(Brouillons.retards, dansFil: Fils.journee(Date()))
        XCTAssertFalse(fait)
        XCTAssertEqual(a.chat.brouillon, "Mon message à moitié écrit")
        let remplace = await a.preparer(Brouillons.retards, dansFil: Fils.journee(Date()), remplacer: true)
        XCTAssertTrue(remplace)
        XCTAssertEqual(a.chat.brouillon, Brouillons.retards)
        XCTAssertEqual(a.onglet, .remy)
        XCTAssertTrue(FauxServeur.recues.isEmpty, "préparer n'envoie rien")
    }

    func testDeconnexionRemetToutAZero() async {
        FauxServeur.reponses = ["POST /api/logout": [(200, "{}")], "GET /api/dashboard": [(200, journeeDemo)]]
        let a = app()
        await a.tableau.charger()
        a.onglet = .remy
        a.reglagesOuverts = true
        a.chat.brouillon = "secret"
        a.chat.modeRetenir = true
        a.dire("coucou")
        await a.deconnecter()
        XCTAssertEqual(a.phase, .connexion)
        XCTAssertEqual(a.onglet, .aujourdhui)
        XCTAssertFalse(a.reglagesOuverts)
        XCTAssertEqual(a.chat.brouillon, "")
        XCTAssertFalse(a.chat.modeRetenir)
        XCTAssertNil(a.message)
        XCTAssertNil(a.tableau.donnees)
        XCTAssertTrue(a.tableau.cochees.isEmpty)
    }

    func testChangerDeFilPendantUneReponseCoupeProprement() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, "event: delta\ndata: {\"text\":\"Je réfléchis\"}\n\nevent: done\ndata: {\"text\":\"Je réfléchis longtemps.\"}\n\n")],
            "GET /api/conversations": [(200, "[]")],
        ]
        FauxServeur.delais = ["POST /api/conversations/c1/messages": 300_000_000]
        defer { FauxServeur.delais = [:] }
        let a = app()
        let envoi = Task { await a.chat.envoyer("Salut") }
        for _ in 0..<200 where a.chat.lignes.isEmpty { try? await Task.sleep(nanoseconds: 5_000_000) }
        XCTAssertTrue(a.chat.envoi)
        a.chat.nouvelle()
        XCTAssertFalse(a.chat.envoi, "le composeur est libre tout de suite")
        await envoi.value
        XCTAssertTrue(a.chat.lignes.isEmpty, "la réponse de l'ancien fil ne s'écrit pas dans le nouveau")
        XCTAssertNil(a.chat.idCourant)
    }

    func testPropositionEnPartieFaite() async {
        let flux = "event: proposal\ndata: {\"source\":\"motion\",\"actions\":[{\"type\":\"creer\",\"nom\":\"A\"},{\"type\":\"creer\",\"nom\":\"B\"}],\"index\":1}\n\nevent: done\ndata: {\"text\":\"Voilà.\"}\n\n"
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, flux)],
            "GET /api/conversations": [(200, "[]")],
            "POST /api/motion/apply": [(200, #"{"ledgerId":"L2","echecs":1,"results":[{"ok":true,"nom":"A","espace":"Perso"},{"ok":false,"nom":"B","erreur":"projet inconnu"}]}"#)],
            "POST /api/motion/undo": [(409, #"{"error":"Déjà annulé"}"#)],
        ]
        let a = app()
        await a.chat.envoyer("Ajoute A et B")
        let ok = await a.chat.appliquer(a.chat.lignes[1])
        XCTAssertFalse(ok)
        let p = a.chat.lignes[1].proposition
        XCTAssertEqual(p?.nombreEchecs, 1)
        XCTAssertEqual(p.flatMap { $0.erreur(pour: $0.actions[1]) }, "projet inconnu")
        XCTAssertNil(p.flatMap { $0.erreur(pour: $0.actions[0]) })
        XCTAssertEqual(a.toast, "1 changement sur 2 n'a pas pu être fait : la raison est sous la ligne.")
        // Déjà annulé ailleurs (409) : c'est l'état voulu, pas une erreur.
        await a.chat.annuler(a.chat.lignes[1])
        XCTAssertEqual(a.chat.lignes[1].proposition?.annulee, true)
        XCTAssertEqual(a.toast, "Annulé : tout est revenu comme avant.")
    }

    func testConversationImporteeEnLectureSeule() async {
        FauxServeur.reponses = [
            "GET /api/conversations/c9": [(200, #"{"id":"c9","title":"Tennis","origine":{"source":"chatgpt"},"messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]}"#)],
            "GET /api/conversations": [(200, #"[{"id":"c9","title":"Tennis"}]"#)],
        ]
        let a = app()
        await a.chat.ouvrir("c9")
        XCTAssertTrue(a.chat.lectureSeule)
        XCTAssertEqual(a.chat.lignes.last?.auteur, "ChatGPT", "Rémy ne doit pas endosser ce que ChatGPT a dit")
        await a.chat.envoyer("Reprenons")
        XCTAssertFalse(FauxServeur.recues.contains { $0.hasSuffix("/messages") })
    }
}
