import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// Les retours de Sam du 09/10 : écrire pendant que Rémy répond (file ou
// interruption), dicter dans le composeur, et le mode appel.

/// Un faux micro : rend l'enregistrement prévu, et dit ce qu'on lui a fait.
@MainActor
final class FauxMicro: Micro {
    var enregistrement: Enregistrement? = Enregistrement(audio: Data(count: 4000), duree: 3.2)
    var refus: ErreurMicro?
    var volume: Float = -20
    private(set) var demarrages = 0
    private(set) var jetes = 0
    private(set) var libere = 0
    private(set) var enMarche = false

    func demarrer() async throws {
        if let refus { throw refus }
        demarrages += 1
        enMarche = true
    }
    func arreter() -> Enregistrement? {
        enMarche = false
        return enregistrement
    }
    func jeter() {
        if enMarche { jetes += 1 }
        enMarche = false
    }
    func niveau() -> Float { volume }
    func liberer() { libere += 1 }
}

/// Une fausse voix : note ce qu'elle dit, rend la main tout de suite.
@MainActor
final class FausseVoix: Voix {
    private(set) var dits: [String] = []
    func dire(_ texte: String) async { dits.append(texte) }
    func taire() {}
}

@MainActor
final class FileEnvoiTests: XCTestCase {
    func app() -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.requetes = [:]
        return AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
    }

    /// Démarre un envoi qui met du temps à répondre, et attend qu'il soit en route.
    func envoiLent(_ a: AppModel, _ texte: String = "Salut") async -> Task<String?, Never> {
        FauxServeur.delais = ["POST /api/conversations/c1/messages": 300_000_000]
        let t = Task { await a.chat.envoyer(texte) }
        // Attendre que la requête soit vraiment PARTIE (pas seulement la ligne
        // affichée) : sinon les comptes de requêtes qui suivent sont aléatoires.
        for _ in 0..<500 where !FauxServeur.recues.contains(where: { $0.hasSuffix("/messages") }) {
            try? await Task.sleep(nanoseconds: 2_000_000)
        }
        XCTAssertTrue(a.chat.envoi)
        return t
    }

    func testEnvoyerApresPartALaFinDeLaReponse() async throws {
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, "event: done\ndata: {\"text\":\"Bonjour.\"}\n\n")],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        let envoi = await envoiLent(a)
        defer { FauxServeur.delais = [:] }
        a.chat.envoyerApres("Et aussi : demain ?")
        XCTAssertEqual(a.chat.fileEnvoi, ["Et aussi : demain ?"])
        XCTAssertEqual(FauxServeur.recues.filter { $0.hasSuffix("/messages") }.count, 1, "il attend la fin")
        let premiere = await envoi.value
        XCTAssertEqual(premiere, "Bonjour.")
        XCTAssertEqual(FauxServeur.recues.filter { $0.hasSuffix("/messages") }.count, 2)
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations/c1/messages"]?["text"] as? String, "Et aussi : demain ?")
        XCTAssertTrue(a.chat.fileEnvoi.isEmpty)
        XCTAssertEqual(a.chat.lignes.map(\.deToi), [true, false, true, false])
        XCTAssertFalse(a.chat.envoi)
    }

    func testInterrompreEtEnvoyerArreteAvantDEnvoyer() async throws {
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [
                (200, "event: delta\ndata: {\"text\":\"Je ré\"}\n\nevent: done\ndata: {\"text\":\"Je ré\\n\\n*(interrompu)*\",\"interrompu\":true}\n\n"),
                (200, "event: done\ndata: {\"text\":\"D'accord, autre chose.\"}\n\n"),
            ],
            "POST /api/conversations/c1/stop": [(200, #"{"ok":true,"arrete":true}"#)],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        let envoi = await envoiLent(a)
        defer { FauxServeur.delais = [:] }
        await a.chat.interrompreEtEnvoyer("Non, plutôt ça")
        XCTAssertTrue(FauxServeur.recues.contains("POST /api/conversations/c1/stop"))
        _ = await envoi.value
        let ordre = FauxServeur.recues.filter { $0.hasPrefix("POST /api/conversations/c1") }
        XCTAssertEqual(ordre, ["POST /api/conversations/c1/messages", "POST /api/conversations/c1/stop", "POST /api/conversations/c1/messages"],
                       "l'arrêt part AVANT le nouveau message")
        XCTAssertEqual(a.chat.lignes[1].texte, "Je ré\n\n*(interrompu)*", "la réponse coupée reste, avec sa mention")
        XCTAssertEqual(a.chat.lignes[2].texte, "Non, plutôt ça")
        XCTAssertEqual(a.chat.lignes.last?.texte, "D'accord, autre chose.")
    }

    func testArretImpossibleLeDitEtGardeLeMessage() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, "event: done\ndata: {\"text\":\"Fini.\"}\n\n")],
            "POST /api/conversations/c1/stop": [(500, #"{"error":"Erreur serveur"}"#)],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        let envoi = await envoiLent(a)
        defer { FauxServeur.delais = [:] }
        await a.chat.interrompreEtEnvoyer("Autre chose")
        XCTAssertEqual(a.toast, "Impossible d'interrompre Rémy : ton message partira à la fin de sa réponse.")
        _ = await envoi.value
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations/c1/messages"]?["text"] as? String, "Autre chose", "rien n'est perdu")
    }

    func testChangerDeFilRendLaFileAuComposeur() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, "event: done\ndata: {\"text\":\"Fini.\"}\n\n")],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        let envoi = await envoiLent(a)
        defer { FauxServeur.delais = [:] }
        a.chat.envoyerApres("Ma suite")
        a.chat.nouvelle()
        XCTAssertTrue(a.chat.fileEnvoi.isEmpty)
        XCTAssertEqual(a.chat.brouillon, "Ma suite", "le message en attente revient, il ne part pas dans le mauvais fil")
        _ = await envoi.value
        XCTAssertEqual(FauxServeur.recues.filter { $0.hasSuffix("/messages") }.count, 1)
    }

    func testPreparerNEcrasePasUnMessageEnFile() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, "event: done\ndata: {\"text\":\"Fini.\"}\n\n")],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        let envoi = await envoiLent(a)
        defer { FauxServeur.delais = [:] }
        a.chat.envoyerApres("Ma suite")
        let fait = await a.preparer(Brouillons.retards, dansFil: "Autre fil")
        XCTAssertFalse(fait, "Sam doit choisir : remplacer ou garder")
        XCTAssertEqual(a.chat.fileEnvoi, ["Ma suite"])
        _ = await envoi.value
    }

    func testModeAppelEnvoieCallTrue() async throws {
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, "event: done\ndata: {\"text\":\"Il est midi.\"}\n\n")],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        let r = await a.chat.envoyer("Quelle heure ?", appel: true)
        XCTAssertEqual(r, "Il est midi.")
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations/c1/messages"]?["call"] as? Bool, true)
    }
}

@MainActor
final class DicteeTests: XCTestCase {
    func app(_ micro: FauxMicro) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.requetes = [:]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
        a.dictee.micro = micro
        return a
    }

    func testLeTexteDicteSAjouteAuComposeur() async {
        FauxServeur.reponses = ["POST /api/transcribe": [(200, #"{"text":"rappelle Hugo demain"}"#)]]
        let micro = FauxMicro()
        let a = app(micro)
        a.chat.brouillon = "Note : "
        await a.dictee.commencer()
        XCTAssertTrue(a.dictee.enregistre)
        await a.dictee.valider()
        XCTAssertEqual(a.chat.brouillon, "Note : rappelle Hugo demain", "ajouté, jamais envoyé seul")
        XCTAssertEqual(a.dictee.etat, .repos)
        XCTAssertEqual(FauxServeur.requetes["POST /api/transcribe"], "type=audio/mp4&dur=3.2")
        XCTAssertFalse(FauxServeur.recues.contains { $0.hasSuffix("/messages") })
        XCTAssertEqual(micro.libere, 1, "le micro est rendu")
    }

    func testDicteeLocaleEteinteLeDitClairement() async {
        let msg = "Dictée Locale ne répond pas — vérifie que l'app tourne sur la tour (icône près de l'horloge)."
        FauxServeur.reponses = ["POST /api/transcribe": [(502, #"{"error":"transcribe","message":"\#(msg)"}"#)]]
        let a = app(FauxMicro())
        a.chat.brouillon = "Début"
        await a.dictee.commencer()
        await a.dictee.valider()
        XCTAssertEqual(a.toast, "Ton vocal n'est pas parti — \(msg) Il t'attend : touche « Renvoyer ».")
        XCTAssertEqual(a.chat.brouillon, "Début")
        XCTAssertEqual(a.dictee.etat, .repos)
        XCTAssertEqual(a.dictee.enAttente.map(\.raison), [msg], "le vocal n'est pas perdu")
    }

    /// 19/10 : un vocal de 2 min parti « dans le vent ». Il attend, on le
    /// renvoie quand la tour est revenue : le texte arrive, le vocal s'efface.
    func testUnVocalPasPartiSeRenvoie() async throws {
        FauxServeur.reponses = ["POST /api/transcribe": [
            (502, #"{"error":"transcribe","message":"Dictée Locale ne répond pas."}"#),
            (200, #"{"text":"une longue idée"}"#),
        ]]
        let micro = FauxMicro()
        micro.enregistrement = Enregistrement(audio: Data(count: 9000), duree: 161)
        let a = app(micro)
        await a.dictee.commencer()
        await a.dictee.valider()
        let v = try XCTUnwrap(a.dictee.enAttente.first)
        XCTAssertEqual(v.duree, "2:41")
        a.chat.brouillon = "Ce que j'ai écrit entre-temps"
        await a.dictee.renvoyer(v.id)
        XCTAssertEqual(a.chat.brouillon, "Ce que j'ai écrit entre-temps une longue idée", "à la fin du champ, à relire")
        XCTAssertFalse(FauxServeur.recues.contains { $0.hasSuffix("/messages") }, "jamais envoyé à Rémy tout seul")
        XCTAssertTrue(a.dictee.enAttente.isEmpty, "transcrit : plus rien n'est gardé")
        XCTAssertEqual(FauxServeur.recues.filter { $0 == "POST /api/transcribe" }.count, 2)
    }

    func testUnVocalEnAttenteSeJette() async throws {
        FauxServeur.reponses = ["POST /api/transcribe": [(502, #"{"error":"transcribe","message":"Hors d'atteinte."}"#)]]
        let a = app(FauxMicro())
        await a.dictee.commencer()
        await a.dictee.valider()
        let v = try XCTUnwrap(a.dictee.enAttente.first)
        a.dictee.jeter(v.id)
        XCTAssertTrue(a.dictee.enAttente.isEmpty)
        XCTAssertEqual(a.toast, "Vocal jeté : rien n'est parti.")
    }

    /// iPhone verrouillé ou appel pendant la dictée : le vocal ne part pas tout
    /// seul, et ce qui a été dit n'est pas perdu.
    func testUnMicroCoupeGardeLeVocal() async {
        let micro = FauxMicro()
        let a = app(micro)
        await a.dictee.commencer()
        a.dictee.interrompre()
        XCTAssertEqual(a.dictee.etat, .repos)
        XCTAssertEqual(a.dictee.enAttente.count, 1)
        XCTAssertTrue(FauxServeur.recues.isEmpty, "rien n'est parti tout seul")
        XCTAssertEqual(micro.libere, 1)
    }

    func testUnVocalLongALeTempsDEtreTranscrit() {
        XCTAssertEqual(ClientAPI.delaiTranscription(3), 123)
        XCTAssertEqual(ClientAPI.delaiTranscription(180), 300, "3 min : 5 min de patience, plus 90 s")
        XCTAssertGreaterThan(ClientAPI.delaiTranscription(900), 900)
        XCTAssertEqual(DicteeModel(api: ClientAPI(base: URL(string: "https://remy.test")!)).dureeMax, 900, "15 min avant l'arrêt")
    }

    func testLaDeconnexionOublieLesVocaux() async {
        FauxServeur.reponses = ["POST /api/transcribe": [(502, #"{"error":"x","message":"Hors d'atteinte."}"#)]]
        let a = app(FauxMicro())
        await a.dictee.commencer()
        await a.dictee.valider()
        XCTAssertEqual(a.dictee.enAttente.count, 1)
        await a.deconnecter()
        XCTAssertTrue(a.dictee.enAttente.isEmpty)
    }

    func testAnnulerNEnvoieRien() async {
        let micro = FauxMicro()
        let a = app(micro)
        await a.dictee.commencer()
        a.dictee.annuler()
        XCTAssertEqual(a.dictee.etat, .repos)
        XCTAssertEqual(micro.jetes, 1)
        XCTAssertEqual(a.toast, "Vocal annulé : rien n'est parti.")
        XCTAssertTrue(FauxServeur.recues.isEmpty)
    }

    func testMicroRefuseLeDit() async {
        let micro = FauxMicro()
        micro.refus = ErreurMicro("Micro refusé — autorise-le dans Réglages › Rémy.")
        let a = app(micro)
        await a.dictee.commencer()
        XCTAssertEqual(a.dictee.etat, .repos)
        XCTAssertEqual(a.toast, "Micro refusé — autorise-le dans Réglages › Rémy.")
    }

    func testTropCourtNePartPas() async {
        let micro = FauxMicro()
        micro.enregistrement = Enregistrement(audio: Data(count: 300), duree: 0.2)
        let a = app(micro)
        await a.dictee.commencer()
        await a.dictee.valider()
        XCTAssertEqual(a.toast, "Trop court : rien n'est parti.")
        XCTAssertTrue(FauxServeur.recues.isEmpty)
    }
}

final class DetecteurParoleTests: XCTestCase {
    /// Rejoue des volumes, une mesure toutes les 100 ms.
    func rejouer(_ d: inout DetecteurParole, _ morceaux: [(Float, Double)]) -> (DetecteurParole.Verdict, Double) {
        var t = 0.0
        for (db, duree) in morceaux {
            let fin = t + duree
            while t < fin - 1e-9 {
                t += 0.1
                let v = d.analyser(db, a: t)
                if v != .continuer { return (v, t) }
            }
        }
        return (.continuer, t)
    }

    func testFinDeParoleApresUnSilence() {
        var d = DetecteurParole()
        let (v, t) = rejouer(&d, [(-55, 0.5), (-20, 2), (-55, 3)])
        XCTAssertEqual(v, .finDeParole)
        XCTAssertEqual(t, 2.5 + 1.7, accuracy: 0.11, "≈ 1,7 s de silence après la voix")
    }

    func testUneRespirationNeCoupePas() {
        var d = DetecteurParole()
        let (v, _) = rejouer(&d, [(-55, 0.5), (-20, 1), (-55, 1), (-22, 1)])
        XCTAssertEqual(v, .continuer, "une pause d'une seconde n'est pas une fin de phrase")
    }

    func testRienDitRelanceLEcoute() {
        var d = DetecteurParole()
        let (v, t) = rejouer(&d, [(-55, 40)])
        XCTAssertEqual(v, .rienEntendu)
        XCTAssertEqual(t, 30, accuracy: 0.11)
    }

    func testBruitDeFondFortReleveLeSeuil() {
        var d = DetecteurParole()
        // Une rue bruyante à −42 dB : ce n'est pas de la voix.
        let (v, _) = rejouer(&d, [(-42, 5)])
        XCTAssertEqual(v, .continuer)
        XCTAssertFalse(d.parole)
    }

    func testVolumeNormalise() {
        XCTAssertEqual(DetecteurParole.normaliser(-160), 0)
        XCTAssertEqual(DetecteurParole.normaliser(0), 1)
    }
}

final class ParoleTests: XCTestCase {
    func testLaVoixNeLitNiMarkdownNiLien() {
        let t = "**Oui.** Regarde [le site](https://exemple.fr/page) ou https://autre.fr. [COUVERT:tete/vrac]"
        XCTAssertEqual(Parole.pourVoix(t), "Oui. Regarde le site ou (lien)")
        XCTAssertEqual(Parole.pourVoix("Je ré\n\n*(interrompu)*"), "Je ré")
    }
}

@MainActor
final class AppelTests: XCTestCase {
    func app(_ micro: FauxMicro, _ voix: FausseVoix) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.requetes = [:]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
        a.appel.micro = micro
        a.appel.voix = voix
        a.appel.pasEcoute = 2_000_000
        return a
    }

    func attendre(_ a: AppModel, _ etat: AppelModel.Etat) async {
        for _ in 0..<500 where a.appel.etat != etat { try? await Task.sleep(nanoseconds: 2_000_000) }
    }

    func testUnTourComplet() async {
        FauxServeur.reponses = [
            "POST /api/transcribe": [(200, #"{"text":"Quelle heure est-il ?"}"#)],
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, "event: done\ndata: {\"text\":\"Il est **midi**.\"}\n\n")],
            "GET /api/conversations": [(200, "[]")],
        ]
        let micro = FauxMicro()
        let voix = FausseVoix()
        let a = app(micro, voix)
        a.appel.decrocher()
        await attendre(a, .ecoute)
        XCTAssertEqual(a.appel.etat, .ecoute)
        a.appel.toucher() // « J'ai fini »
        for _ in 0..<500 where voix.dits.isEmpty { try? await Task.sleep(nanoseconds: 2_000_000) }
        XCTAssertEqual(voix.dits, ["Il est midi."], "lu sans markdown")
        XCTAssertEqual(a.appel.entendu, "Quelle heure est-il ?")
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations/c1/messages"]?["call"] as? Bool, true)
        // Et l'écoute reprend.
        await attendre(a, .ecoute)
        XCTAssertEqual(a.appel.etat, .ecoute)
        XCTAssertEqual(micro.demarrages, 2)
        a.appel.raccrocher()
        XCTAssertEqual(a.appel.etat, .arrete)
        XCTAssertFalse(micro.enMarche, "le micro est coupé en raccrochant")
        XCTAssertEqual(a.chat.lignes.count, 2, "l'échange reste dans la conversation")
    }

    func testTranscriptionRateeLeDitSansRaccrocher() async {
        FauxServeur.reponses = ["POST /api/transcribe": [(502, #"{"error":"transcribe","message":"Dictée Locale ne répond pas."}"#)]]
        let a = app(FauxMicro(), FausseVoix())
        a.appel.decrocher()
        await attendre(a, .ecoute)
        a.appel.toucher()
        await attendre(a, .erreur("Dictée Locale ne répond pas."))
        XCTAssertEqual(a.appel.etat, .erreur("Dictée Locale ne répond pas."))
        a.appel.raccrocher()
    }

    func testPasDAppelPendantUneReponse() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(200, #"{"id":"c1","title":"x","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, "event: done\ndata: {\"text\":\"Fini.\"}\n\n")],
            "GET /api/conversations": [(200, "[]")],
        ]
        FauxServeur.delais = ["POST /api/conversations/c1/messages": 200_000_000]
        defer { FauxServeur.delais = [:] }
        let a = app(FauxMicro(), FausseVoix())
        let envoi = Task { await a.chat.envoyer("Salut") }
        for _ in 0..<200 where a.chat.lignes.isEmpty { try? await Task.sleep(nanoseconds: 2_000_000) }
        a.appel.decrocher()
        XCTAssertEqual(a.appel.etat, .arrete)
        XCTAssertEqual(a.toast, "Rémy finit sa réponse, réessaie dans un instant.")
        _ = await envoi.value
    }
}
