import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Ce qui casse à J+30 (simulation du 24/10) : doublons à l'entrée, « déjà là »
/// qui n'est pas un échec, propositions périmées, brouillon du « + »,
/// « Retirer les pris » en une requête, historique paginé.
final class UsageIntensifPurTests: XCTestCase {
    func testCleTexteCommeLaTour() {
        XCTAssertEqual(cleTexte("  Payer le LOYER ! "), "payer le loyer")
        XCTAssertEqual(cleTexte("Crème brûlée"), "creme brulee")
        XCTAssertEqual(cleTexte("lait"), cleTexte("Lait."))
        XCTAssertEqual(cleTexte("¿?"), "")
    }

    func testDejaLaNEstPasUnEchec() throws {
        let neuf = #"{"etat":"deja_la","echecs":0,"results":[{"ok":true,"type":"creer","nom":"Appeler","dejaLa":true,"note":"« Appeler » est déjà dans Motion"}]}"#
        let r = try JSONDecoder().decode(ResultatApplication.self, from: Data(neuf.utf8))
        XCTAssertTrue(r.toutDejaLa)
        XCTAssertEqual(r.statut, "applique")
        XCTAssertEqual(r.bilan.faits, [])
        XCTAssertEqual(r.bilan.dejaLa, ["Appeler"])
        XCTAssertEqual(r.vraisEchecs, 0)
        // Une tour d'avant le 24/10 le rendait comme un échec : relu pareil.
        let ancien = #"{"etat":"echouee","echecs":1,"results":[{"ok":false,"type":"creer","nom":"Appeler","erreur":"« Appeler » existe déjà dans Motion — rien n'a été créé","doublon":true}]}"#
        let a = try JSONDecoder().decode(ResultatApplication.self, from: Data(ancien.utf8))
        XCTAssertTrue(a.toutDejaLa)
        XCTAssertEqual(a.statut, "applique")
        XCTAssertEqual(a.vraisEchecs, 0)
        // Une vraie panne reste une panne.
        let panne = #"{"etat":"echouee","echecs":1,"results":[{"ok":false,"nom":"Appeler","erreur":"Motion ne répond pas"}]}"#
        let p = try JSONDecoder().decode(ResultatApplication.self, from: Data(panne.utf8))
        XCTAssertFalse(p.toutDejaLa)
        XCTAssertEqual(p.statut, "echec")
    }

    func testPropositionPerimeeLue() throws {
        let j = #"{"id":"p1","source":"motion","statut":"en_attente","perimee":true,"raisonPeremption":"Proposée il y a 60 jours.","actions":[{"type":"creer","nom":"Abonnement"}]}"#
        let p = try JSONDecoder().decode(Proposition.self, from: Data(j.utf8))
        XCTAssertEqual(p.perimee, true)
        XCTAssertEqual(p.raisonPeremption, "Proposée il y a 60 jours.")
        let regle = try JSONDecoder().decode(Proposition.self, from: Data(#"{"statut":"applique","bilan":{"faits":[],"echoues":[],"dejaLa":["Payer le loyer"]},"actions":[{"type":"creer","nom":"Payer le loyer"}]}"#.utf8))
        XCTAssertTrue(regle.toutDejaLa)
        XCTAssertTrue(regle.dejaLa(regle.actions[0]))
    }

    func testBilanDeRangementDitDejaLa() {
        var b = BilanRangement(faits: ["« Pain » (liste)"], dejaLa: ["« Payer le loyer » (Motion)"])
        XCTAssertEqual(b.phrase, "Rangé : « Pain » (liste) ; déjà là : « Payer le loyer » (Motion).")
        b.faits = []
        XCTAssertEqual(b.phrase, "Rien de nouveau, déjà là : « Payer le loyer » (Motion).")
        b.echecs = ["« Appeler » : Motion ne répond pas"]
        XCTAssertEqual(b.phrase, "Déjà là : « Payer le loyer » (Motion) ; pas fait : « Appeler » : Motion ne répond pas.")
    }

    func testBrouillonGardeRestaureEtExpire() throws {
        let d = try XCTUnwrap(UserDefaults(suiteName: "brouillon-\(UUID().uuidString)"))
        XCTAssertNil(BrouillonCapture.lire(d))
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        BrouillonCapture.garder("Relancer le comptable, acheter du lait", d, maintenant: t0)
        XCTAssertEqual(BrouillonCapture.lire(d, maintenant: t0.addingTimeInterval(3600)), "Relancer le comptable, acheter du lait")
        XCTAssertNil(BrouillonCapture.lire(d, maintenant: t0.addingTimeInterval(8 * 86_400)), "une semaine au plus")
        BrouillonCapture.garder("x", d, maintenant: t0)
        BrouillonCapture.garder("   ", d, maintenant: t0)
        XCTAssertNil(BrouillonCapture.lire(d, maintenant: t0), "un champ vidé efface le brouillon")
        BrouillonCapture.garder("y", d, maintenant: t0)
        BrouillonCapture.effacer(d)
        XCTAssertNil(BrouillonCapture.lire(d, maintenant: t0))
    }

    func testUneEcritureEnAttenteSuitLExistant() throws {
        let fantome = ElementListe(id: "fantome", texte: "lait", fait: true)
        let op = OperationCarnet.elements(liste: "L", [fantome]).remplacant(["fantome": "orig"])
        guard case let .elements(_, e) = op else { return XCTFail("\(op)") }
        XCTAssertEqual(e.map(\.id), ["orig"])
        XCTAssertEqual(e.first?.fait, true)
        let lot = OperationCarnet.retirerElements(liste: "L", ids: ["a", "fantome"])
        XCTAssertEqual(lot.remplacant(["fantome": "orig"]), .retirerElements(liste: "L", ids: ["a", "orig"]))
        // La file se garde sur l'iPhone : le nouveau cas se relit.
        let relu = try JSONDecoder().decode(OperationCarnet.self, from: JSONEncoder().encode(lot))
        XCTAssertEqual(relu, lot)
    }
}

@MainActor
final class UsageIntensifTests: XCTestCase {
    private let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("remy-intensif-" + UUID().uuidString)

    override func tearDown() {
        try? FileManager.default.removeItem(at: dossier)
        FauxServeur.reponses = [:]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.historique = [:]
        FauxServeur.requetes = [:]
    }

    private func app(_ capacites: [String]) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)),
                         rangement: Rangement(dossier: dossier))
        a.serveur = VersionServeur(api: 1, serveur: "0.7.0", capacites: capacites)
        return a
    }

    func testUnArticleOuUnRappelDejaNoteNEstPasRecree() async throws {
        let a = app([]) // hors ligne : la vérification se fait sur l'iPhone
        let l = try XCTUnwrap(a.carnet.creerListe("Courses"))
        a.carnet.ajouter(["lait", "œufs"], a: l)
        let n = a.carnet.noter(["Lait !", "pain", "pain"], dans: l)
        XCTAssertEqual(n.nouveaux.map(\.texte), ["pain"])
        XCTAssertEqual(n.dejaLa, ["Lait !", "pain"])
        XCTAssertEqual(a.carnet.listes[0].elements.map(\.texte), ["lait", "œufs", "pain"])
        // Pris, il revient (on en rachète).
        let lait = try XCTUnwrap(a.carnet.listes[0].elements.first { $0.texte == "lait" })
        a.carnet.basculer(lait, dans: a.carnet.listes[0])
        XCTAssertEqual(a.carnet.noter(["lait"], dans: a.carnet.listes[0]).nouveaux.count, 1)
        // Par l'entrée habituelle, c'est dit.
        a.carnet.ajouter(["pain"], a: a.carnet.listes[0])
        XCTAssertEqual(a.toast, "Déjà dans ta liste : « pain ».")

        let r1 = try XCTUnwrap(a.carnet.noterRappel("Payer le loyer", quand: nil))
        XCTAssertFalse(r1.dejaLa)
        let demain = Date().addingTimeInterval(86_400)
        let r2 = try XCTUnwrap(a.carnet.noterRappel("payer le loyer", quand: demain))
        XCTAssertTrue(r2.dejaLa)
        XCTAssertEqual(r2.rappel.id, r1.rappel.id)
        XCTAssertEqual(a.carnet.rappels.count, 1)
        XCTAssertEqual(a.carnet.rappels[0].quand, demain.millis, "l'existant prend la date")
    }

    func testRetirerLesPrisEnUneSeuleRequete() async throws {
        let a = app(["listes-v1", "carnet-lot-v1"])
        let l = try XCTUnwrap(a.carnet.creerListe("Courses"))
        a.carnet.ajouter(["a", "b", "c"], a: l)
        for e in a.carnet.listes[0].elements { a.carnet.basculer(e, dans: a.carnet.listes[0]) }
        FauxServeur.reponses = [
            "PUT /api/listes/\(l.id)": [(200, #"{"ok":true}"#)],
            "POST /api/listes/\(l.id)/elements": [(200, #"{"ok":true,"dejaLa":[]}"#)],
            "POST /api/listes/\(l.id)/retirer": [(200, #"{"ok":true,"retires":3}"#)],
        ]
        await a.carnet.envoyer()
        FauxServeur.recues = []
        a.carnet.effacerCoches(a.carnet.listes[0])
        await a.carnet.envoyer()
        XCTAssertTrue(a.carnet.enAttente.isEmpty)
        XCTAssertEqual(FauxServeur.recues, ["POST /api/listes/\(l.id)/retirer"], "une requête, pas une par article")
        XCTAssertEqual((FauxServeur.corps["POST /api/listes/\(l.id)/retirer"]?["ids"] as? [String])?.count, 3)
        XCTAssertTrue(a.carnet.listes[0].elements.isEmpty)
    }

    func testLaTourFondUnDoublonEtLaFileSuit() async throws {
        let a = app([]) // rien ne part tant que la tour n'est pas joignable
        let l = try XCTUnwrap(a.carnet.creerListe("Courses"))
        a.carnet.ajouter(["lait"], a: l)
        let fantome = try XCTUnwrap(a.carnet.listes[0].elements.first)
        a.carnet.basculer(fantome, dans: a.carnet.listes[0])
        FauxServeur.reponses = [
            "PUT /api/listes/\(l.id)": [(200, #"{"ok":true}"#)],
            "POST /api/listes/\(l.id)/elements": [
                (200, #"{"ok":true,"dejaLa":[{"id":"\#(fantome.id)","existant":"orig","texte":"lait"}]}"#),
                (200, #"{"ok":true,"dejaLa":[]}"#),
            ],
        ]
        a.serveur = VersionServeur(api: 1, serveur: "0.7.0", capacites: ["listes-v1"])
        await a.carnet.envoyer()
        XCTAssertTrue(a.carnet.enAttente.isEmpty)
        let envois = FauxServeur.historique["POST /api/listes/\(l.id)/elements"] ?? []
        XCTAssertEqual(envois.count, 2)
        let coche = try XCTUnwrap((envois.last?["elements"] as? [[String: Any]])?.first)
        XCTAssertEqual(coche["id"] as? String, "orig", "cocher le doublon coche l'original")
        XCTAssertEqual(a.carnet.listes[0].elements.map(\.id), ["orig"])
    }

    func testHistoriquePagineEtFiltre() async throws {
        let a = app(["historique-v1", "historique-v2"])
        let entree = { (id: String, ts: Int) in #"{"id":"\#(id)","ts":\#(ts),"source":"motion","origine":"Toi","etat":"echouee","elements":[{"objet":"Appeler","action":"Échec","erreur":"Motion ne répond pas"}]}"# }
        FauxServeur.reponses = ["GET /api/historique": [
            (200, #"{"entrees":[\#(entree("h1", 2000))],"suite":2000}"#),
            (200, #"{"entrees":[\#(entree("h2", 1000))],"suite":null}"#),
        ]]
        await a.historique.filtrer(.echouee)
        XCTAssertEqual(FauxServeur.requetes["GET /api/historique"], "limite=80&filtre=echouee")
        XCTAssertEqual(a.historique.entrees.map(\.id), ["h1"])
        XCTAssertEqual(a.historique.suite, 2000)
        await a.historique.plusAncien()
        XCTAssertEqual(FauxServeur.requetes["GET /api/historique"], "limite=80&avant=2000&filtre=echouee")
        XCTAssertEqual(a.historique.entrees.map(\.id), ["h1", "h2"])
        XCTAssertNil(a.historique.suite, "tout est lu")
    }

    private let fil = #"{"id":"c1","title":"Tom","messages":[{"role":"user","content":"x"},{"role":"assistant","content":"Je l'ajoute ?","proposal":{"id":"p1","source":"motion","resume":"Abonnement","statut":"en_attente","perimee":true,"raisonPeremption":"Proposée il y a 60 jours.","actions":[{"type":"creer","nom":"Acheter abonnement pour Tom"}]}}]}"#

    func testUnePropositionPerimeeNeSAppliqueQuApresConfirmation() async throws {
        let a = app(["propositions-perimees-v1"])
        FauxServeur.reponses["GET /api/conversations/c1"] = [(200, fil)]
        FauxServeur.reponses["GET /api/conversations"] = [(200, "[]")]
        _ = await a.chat.ouvrir("c1")
        let ligne = try XCTUnwrap(a.chat.lignes.first { $0.proposition != nil })
        XCTAssertEqual(ligne.proposition?.perimee, true)
        // La tour refuse tant que Sam n'a pas confirmé.
        FauxServeur.reponses["POST /api/motion/apply"] = [
            (409, #"{"error":"perimee","message":"Proposée il y a 60 jours. Ajuste-la, ou confirme pour l'appliquer quand même."}"#),
            (200, #"{"etat":"appliquee","echecs":0,"ledgerId":"j1","results":[{"ok":true,"type":"creer","nom":"Acheter abonnement pour Tom"}]}"#),
        ]
        let refuse = await a.chat.appliquer(ligne)
        XCTAssertFalse(refuse)
        XCTAssertNil(FauxServeur.corps["POST /api/motion/apply"]?["confirmer"])
        XCTAssertTrue(a.toast?.hasPrefix("Rien n'a été fait") ?? false, a.toast ?? "")
        let ok = await a.chat.appliquer(ligne, confirmer: true)
        XCTAssertTrue(ok)
        XCTAssertEqual(FauxServeur.corps["POST /api/motion/apply"]?["confirmer"] as? Bool, true)
        let p = try XCTUnwrap(a.chat.lignes.first { $0.id == ligne.id }?.proposition)
        XCTAssertEqual(p.statut, "applique")
        XCTAssertNil(p.perimee)
    }
}
