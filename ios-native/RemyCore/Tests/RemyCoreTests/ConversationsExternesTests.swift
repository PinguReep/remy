import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Les conversations externes (conversations-externes-v1, 29/10) : ce que la
/// tour rend se lit (même partiel), l'écran sait dire l'état de chaque source
/// et quoi faire, la liste se range par jour, et les gestes partent vers les
/// bonnes routes. Données fictives.
@MainActor
final class ConversationsExternesTests: XCTestCase {
    lazy var reglages = UserDefaults(suiteName: "conversations-externes-tests-\(UUID().uuidString)")!

    func app(capacites: [String] = ["conversations-externes-v1", "rappels-v1"]) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.historique = [:]
        FauxServeur.corps = [:]
        FauxServeur.requetes = [:]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)), reglages: reglages)
        a.serveur = VersionServeur(api: 1, serveur: "0.7.0", capacites: capacites)
        return a
    }

    // La forme décrite dans docs/conversations-externes.md.
    static let etat = """
    {"sources":[
      {"id":"claude-code","nom":"Claude Code","actif":true,"forceParLaTour":false,"disponible":true,
       "emplacements":[{"origine":"dossier de l'utilisateur","chemin":"~\\\\.claude\\\\projects","trouve":true}],
       "derniereLecture":1793235865350,"derniereReussie":1793235865350,"conversations":42,"messages":1310,
       "derniereConversation":1793228665297,"bilan":{"lus":3},"erreur":null,"aide":null},
      {"id":"t3","nom":"T3 Code","actif":true,"forceParLaTour":false,"disponible":false,"emplacements":[],
       "conversations":0,"messages":0,"erreur":null,
       "aide":{"code":"introuvable","message":"Aucune base de T3 Code trouvée sur la tour.","quoiFaire":"Ouvre T3 Code une fois sur la tour."}},
      {"id":"chatgpt","nom":"ChatGPT","actif":true,"forceParLaTour":false,"disponible":true,"conversations":3,"messages":20,
       "derniereLecture":1793235865350,
       "erreur":{"code":"zip-invalide","message":"Archive illisible : pas de fin d'archive.","quoiFaire":"Retélécharge l'export."},"aide":null}],
     "usage":{"chat":true,"nuit":false,"forceParLaTour":false},
     "chiffre":true,
     "cle":{"origine":"fichier","emplacement":"~\\\\.remy\\\\conversations.cle","erreur":null},
     "imports":{"dossier":"~\\\\Documents\\\\Imports","enAttente":0,"importes":1},
     "total":{"conversations":45,"messages":1330},"lectureToutesLesMin":30}
    """

    static let liste = """
    {"conversations":[
      {"source":"t3","id":"fil-paiement","titre":"Paiement en trois fois","apercu":"Ajoute le paiement en trois fois.","assistant":"Codex",
       "projet":{"id":"p-0123456789","nom":"Site de la boutique"},"debut":1793225065297,"fin":1793228665297,"messages":2},
      {"source":"chatgpt","id":"6f1c-1","titre":"Idées de coffrets","apercu":null,"assistant":"ChatGPT","projet":null,
       "debut":1793142325000,"fin":1793142455000,"messages":4}],
     "suite":2,"total":5}
    """

    func testLEtatDeLaTourSeLitEtDitQuoiFaire() async throws {
        let e = try JSONDecoder().decode(EtatConversations.self, from: Data(Self.etat.utf8))
        XCTAssertEqual(e.sources.map(\.id), ["claude-code", "t3", "chatgpt"])
        XCTAssertTrue(e.chiffre)
        XCTAssertEqual(e.total.conversations, 45)
        XCTAssertEqual(e.usage, UsageConversations(chat: true, nuit: false))
        XCTAssertEqual(e.cle?.emplacement, "~\\.remy\\conversations.cle")
        XCTAssertEqual(e.source("t3")?.aide?.code, "introuvable")
        XCTAssertEqual(e.source("t3")?.phrase(), "Aucune base de T3 Code trouvée sur la tour.")
        XCTAssertEqual(e.source("chatgpt")?.phrase(), "Archive illisible : pas de fin d'archive.")
        XCTAssertEqual(e.probleme?.code, "zip-invalide", "une erreur de source remonte en tête de l'écran")
        let claude = try XCTUnwrap(e.source("claude-code"))
        XCTAssertTrue(claude.phrase(maintenant: Date(timeIntervalSince1970: 1_793_240_000)).hasSuffix("· 42 conversations"))
        XCTAssertEqual(claude.emplacements.first?.trouve, true)
    }

    func testUneReponsePartielleNeCassePasLEcran() async throws {
        let e = try JSONDecoder().decode(EtatConversations.self, from: Data(#"{"sources":[{"id":"t3"}]}"#.utf8))
        XCTAssertEqual(e.sources.first?.nom, "T3 Code")
        XCTAssertFalse(e.sources.first?.actif ?? true)
        XCTAssertEqual(e.sources.first?.phrase(), "Coupée : rien n'est lu.")
        XCTAssertEqual(e.total.conversations, 0)
        XCTAssertFalse(e.chiffre)
        let p = try JSONDecoder().decode(PageConversations.self, from: Data("{}".utf8))
        XCTAssertTrue(p.conversations.isEmpty)
        XCTAssertNil(p.suite)
        let c = try JSONDecoder().decode(ConversationExterne.self, from: Data(#"{"source":"chatgpt","id":"x"}"#.utf8))
        XCTAssertEqual(c.titre, "Conversation")
        let d = try JSONDecoder().decode(DigestNuit.self, from: Data(#"{"jour":"2026-10-28"}"#.utf8))
        XCTAssertTrue(d.vide)
    }

    func testCoupeeSurLaTourEtPasEncoreLue() async {
        var s = SourceConversations(id: "claude-code", nom: "Claude Code", actif: false, forceParLaTour: true)
        XCTAssertEqual(s.phrase(), "Coupée sur la tour (remy.env).")
        s.actif = true
        s.forceParLaTour = false
        XCTAssertEqual(s.phrase(), "Pas encore lue : première lecture dans 30 min au plus.")
    }

    func testLaListeSeRangeParJour() async throws {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Paris")!
        let maintenant = cal.date(from: DateComponents(year: 2026, month: 10, day: 29, hour: 15))!
        let ilYa = { (h: Double) in (maintenant.timeIntervalSince1970 - h * 3600) * 1000 }
        let liste = [
            ConversationExterne(source: "t3", id: "a", titre: "A", fin: ilYa(1)),
            ConversationExterne(source: "t3", id: "b", titre: "B", fin: ilYa(2)),
            ConversationExterne(source: "chatgpt", id: "c", titre: "C", fin: ilYa(24)),
            ConversationExterne(source: "chatgpt", id: "d", titre: "D", fin: ilYa(72)),
            ConversationExterne(source: "chatgpt", id: "e", titre: "E", fin: nil),
        ]
        let g = ConversationsExternes.parJour(liste, maintenant: maintenant, calendrier: cal)
        XCTAssertEqual(g.map(\.titre), ["Aujourd'hui", "Hier", "Lundi 26 octobre", "Sans date"])
        XCTAssertEqual(g[0].conversations.map(\.id), ["a", "b"])
        XCTAssertEqual(g[1].conversations.map(\.id), ["c"])
        let p = try JSONDecoder().decode(PageConversations.self, from: Data(Self.liste.utf8))
        let fin = try XCTUnwrap(p.conversations[0].fin)
        XCTAssertEqual(p.conversations[0].meta(maintenant: Date(timeIntervalSince1970: fin / 1000 + 60)), "Codex · \(Format.heure(fin)) · 2 messages · Site de la boutique")
        XCTAssertEqual(p.suite, 2)
        XCTAssertEqual(p.total, 5)
    }

    func testQuiParleEtCeQuiSImporte() async {
        XCTAssertEqual(ConversationsExternes.auteur(MessageExterne(id: 1, auteur: "utilisateur", texte: "x"), assistant: "Claude"), "Toi")
        XCTAssertEqual(ConversationsExternes.auteur(MessageExterne(id: 2, auteur: "colle", texte: "x"), assistant: "Claude"), "Toi (collé)")
        XCTAssertEqual(ConversationsExternes.auteur(MessageExterne(id: 3, auteur: "assistant", texte: "x"), assistant: "Codex"), "Codex")
        XCTAssertEqual(ConversationsExternes.auteur(MessageExterne(id: 4, auteur: "assistant", texte: "x"), assistant: nil), "L'assistant")
        XCTAssertTrue(MessageExterne(id: 5, auteur: "colle", texte: "x").deToi)
        XCTAssertTrue(ConversationsExternes.importable("export-chatgpt.ZIP"))
        XCTAssertTrue(ConversationsExternes.importable("conversations.json"))
        XCTAssertFalse(ConversationsExternes.importable("photo.png"))
        XCTAssertEqual(ConversationsExternes.typeFichier("conversations.json"), "application/json")
        XCTAssertEqual(ConversationsExternes.typeFichier("export.zip"), "application/zip")
        XCTAssertEqual(ConversationsExternes.nomSource("t3"), "T3 Code")
    }

    func testLeBilanDUnImportSeDit() async {
        XCTAssertEqual(BilanImport(deja: true).phrase, "Cet export était déjà importé : rien de nouveau.")
        XCTAssertEqual(BilanImport(nouvelles: 12, misesAJour: 3, masques: 1).phrase, "12 conversations importées, 3 mises à jour. 1 secret masqué.")
        XCTAssertEqual(BilanImport(nouvelles: 1).phrase, "1 conversation importée.")
        XCTAssertEqual(BilanImport().phrase, "Rien de nouveau dans cet export.")
    }

    func testCacheeTantQueLaTourNeLaConnaitPas() async {
        let a = app(capacites: [])
        XCTAssertFalse(a.conversationsExternes.disponible)
        await a.conversationsExternes.charger()
        XCTAssertFalse(FauxServeur.recues.contains("GET /api/conversations-externes"), "rien n'est demandé à une tour trop ancienne")
    }

    func testChargerPuisFiltrerPuisChercher() async {
        FauxServeur.reponses = [
            "GET /api/conversations-externes": [(200, Self.etat)],
            "GET /api/conversations-externes/liste": [(200, Self.liste)],
            "GET /api/conversations-externes/nuit": [(200, #"{"digest":{"jour":"2026-10-28","sources":["t3"],"themes":["Paiement"],"decisions":[],"aFaire":[{"texte":"Activer l'option chez le prestataire","source":"T3 Code"}],"ligne":"Paiement en trois fois prêt côté panier."}}"#)],
            "GET /api/conversations-externes/chercher": [(200, #"{"resultats":[{"source":"t3","conversation":"fil-paiement","titre":"Paiement en trois fois","projet":null,"message":7,"auteur":"utilisateur","ts":1793228665297,"score":2,"extrait":"le paiement en trois fois"}]}"#)],
        ]
        let a = app()
        let m = a.conversationsExternes
        XCTAssertTrue(m.disponible)
        await m.charger()
        XCTAssertEqual(m.etat?.total.conversations, 45)
        XCTAssertEqual(m.liste.count, 2)
        XCTAssertEqual(m.suite, 2)
        XCTAssertEqual(m.digest?.aFaire.first?.source, "T3 Code")
        XCTAssertEqual(m.resume, "Archive illisible : pas de fin d'archive.")
        await m.filtrer("t3")
        XCTAssertEqual(m.filtre, "t3")
        XCTAssertTrue(FauxServeur.requetes["GET /api/conversations-externes/liste"]?.contains("source=t3") == true)
        await m.chercher("p")
        XCTAssertNil(m.resultats, "une lettre ne cherche pas")
        await m.chercher("paiement trois")
        XCTAssertEqual(m.resultats?.first?.extrait, "le paiement en trois fois")
        XCTAssertTrue(FauxServeur.requetes["GET /api/conversations-externes/chercher"]?.contains("q=paiement%20trois") == true)
        XCTAssertTrue(FauxServeur.requetes["GET /api/conversations-externes/chercher"]?.contains("source=t3") == true)
        await m.chercher("")
        XCTAssertNil(m.resultats)
        await m.plus()
        XCTAssertTrue(FauxServeur.requetes["GET /api/conversations-externes/liste"]?.contains("decalage=2") == true)
    }

    func testLesGestesPartentVersLesBonnesRoutesEtSeDisent() async {
        FauxServeur.reponses = [
            "POST /api/conversations-externes/synchroniser": [(200, #"{"bilan":{"ok":true,"sources":{}},"etat":\#(Self.etat)}"#)],
            "GET /api/conversations-externes/liste": [(200, Self.liste)],
            "PUT /api/conversations-externes/sources/t3": [(200, Self.etat)],
            "DELETE /api/conversations-externes/sources/chatgpt": [(200, #"{"ok":true,"message":"Effacé de la tour. Ton compte ChatGPT n'est pas touché.","etat":\#(Self.etat)}"#)],
            "PUT /api/conversations-externes/usage": [(200, Self.etat)],
        ]
        let a = app()
        let m = a.conversationsExternes
        let ok1 = await m.lireMaintenant()
        XCTAssertTrue(ok1)
        XCTAssertEqual(a.toast, "Lu, mais : Archive illisible : pas de fin d'archive.")
        // Une seule source : son bilan à elle, pas l'erreur d'une autre ni le
        // total (T3 n'a rien : la tour dit pourquoi).
        FauxServeur.reponses["POST /api/conversations-externes/synchroniser"] = [(200, #"{"bilan":{"ok":true,"sources":{}},"etat":\#(Self.etat)}"#)]
        let ok1b = await m.lireMaintenant("t3")
        XCTAssertTrue(ok1b)
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations-externes/synchroniser"]?["source"] as? String, "t3")
        XCTAssertEqual(a.toast, "Lu : Aucune base de T3 Code trouvée sur la tour.")
        FauxServeur.reponses["POST /api/conversations-externes/synchroniser"] = [(200, #"{"bilan":{"ok":true,"sources":{}},"etat":\#(Self.etat)}"#)]
        _ = await m.lireMaintenant("claude-code")
        XCTAssertEqual(a.toast, "Lu : Claude Code, 42 conversations.")
        let ok2 = await m.regler("t3", actif: false)
        XCTAssertTrue(ok2)
        XCTAssertEqual(FauxServeur.corps["PUT /api/conversations-externes/sources/t3"]?["actif"] as? Bool, false)
        XCTAssertTrue(a.toast?.hasPrefix("T3 Code : lecture coupée") == true)
        let ok3 = await m.effacer("chatgpt")
        XCTAssertTrue(ok3)
        XCTAssertEqual(a.toast, "Effacé de la tour. Ton compte ChatGPT n'est pas touché.")
        let ok4 = await m.reglerUsage(nuit: true)
        XCTAssertTrue(ok4)
        XCTAssertEqual(FauxServeur.corps["PUT /api/conversations-externes/usage"]?["nuit"] as? Bool, true)
        XCTAssertNil(FauxServeur.corps["PUT /api/conversations-externes/usage"]?["chat"])
        XCTAssertEqual(a.toast, "La nuit, Rémy relira tes conversations de la veille.")
    }

    func testUneTourInjoignableLeDitSansRienCasser() async {
        FauxServeur.reponses = ["POST /api/conversations-externes/synchroniser": [(409, #"{"error":"source-coupee","message":"Toutes les sources sont coupées : allume-en une d'abord."}"#)]]
        let a = app()
        let ok5 = await a.conversationsExternes.lireMaintenant()
        XCTAssertFalse(ok5)
        XCTAssertEqual(a.toast, "Toutes les sources sont coupées : allume-en une d'abord.")
        FauxServeur.reponses = ["GET /api/conversations-externes": [(500, #"{"error":"Erreur serveur"}"#)], "GET /api/conversations-externes/liste": [(500, "{}")]]
        await a.conversationsExternes.charger()
        XCTAssertNotNil(a.conversationsExternes.erreurEtat)
        XCTAssertNotNil(a.conversationsExternes.erreurListe)
    }

    func testImporterUnExportChatGPT() async throws {
        FauxServeur.reponses = [
            "POST /api/conversations-externes/chatgpt": [(200, #"{"bilan":{"deja":false,"conversations":4,"nouvelles":3,"misesAJour":1,"ignorees":0,"masques":0},"etat":\#(Self.etat)}"#)],
            "GET /api/conversations-externes/liste": [(200, Self.liste)],
        ]
        let a = app()
        let f = FileManager.default.temporaryDirectory.appendingPathComponent("export-\(UUID().uuidString).zip")
        try Data("PK fictif".utf8).write(to: f)
        defer { try? FileManager.default.removeItem(at: f) }
        let ok6 = await a.conversationsExternes.importer(f)
        XCTAssertTrue(ok6)
        XCTAssertTrue(FauxServeur.recues.contains("POST /api/conversations-externes/chatgpt"))
        XCTAssertEqual(a.toast, "3 conversations importées, 1 mise à jour.")
        XCTAssertEqual(a.conversationsExternes.dernierImport?.nouvelles, 3)
        // Un fichier qui n'est pas l'export : rien ne part, et l'app le dit.
        FauxServeur.recues = []
        let image = FileManager.default.temporaryDirectory.appendingPathComponent("photo.png")
        let ok7 = await a.conversationsExternes.importer(image)
        XCTAssertFalse(ok7)
        XCTAssertTrue(FauxServeur.recues.isEmpty)
        XCTAssertTrue(a.toast?.contains(".zip") == true)
        // Refusé par la tour : la raison est dite.
        FauxServeur.reponses["POST /api/conversations-externes/chatgpt"] = [(422, #"{"error":"sans-conversations","message":"Pas de conversations.json dans cette archive : est-ce bien l'export de ChatGPT ?"}"#)]
        let ok8 = await a.conversationsExternes.importer(f)
        XCTAssertFalse(ok8)
        XCTAssertEqual(a.toast, "Pas de conversations.json dans cette archive : est-ce bien l'export de ChatGPT ?")
    }

    func testUneChoseAFaireDeLaNuitDevientUnRappelSeulementSurTonGeste() async {
        let a = app()
        let avant = a.carnet.rappels.count
        XCTAssertTrue(a.conversationsExternes.rappeler(DigestNuit.AFaire(texte: "Relire le contrat du prestataire", source: "Claude Code")))
        XCTAssertEqual(a.carnet.rappels.count, avant + 1)
        XCTAssertEqual(a.toast, "Noté dans tes rappels : « Relire le contrat du prestataire ».")
    }

    func testLaLigneDuMatinSeLitDansLeRituel() async throws {
        let r = try JSONDecoder().decode(RituelTour.self, from: Data(#"{"maintenant":1793232000000,"conversations":{"ligne":"Les fiches sortent vendredi.","jour":"2026-10-28","sources":["claude-code"]}}"#.utf8))
        XCTAssertEqual(r.conversations?.ligne, "Les fiches sortent vendredi.")
        let ancien = try JSONDecoder().decode(RituelTour.self, from: Data(#"{"maintenant":1793232000000}"#.utf8))
        XCTAssertNil(ancien.conversations, "une tour d'avant le 29/10 : pas de ligne")
    }

    func testLaConversationPasseeEnPriveeParLaTourPrendLeCadenas() async {
        FauxServeur.reponses = [
            "GET /api/conversations/c1": [(200, #"{"id":"c1","title":"Paiement","messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]}"#)],
            "GET /api/conversations/c2": [(200, #"{"id":"c2","title":"Autre","messages":[{"role":"user","content":"a"}]}"#)],
            "GET /api/conversations": [(200, #"[{"id":"c1","title":"Paiement","updatedAt":1},{"id":"c2","title":"Autre","updatedAt":1}]"#)],
        ]
        let a = app()
        _ = await a.chat.ouvrir("c1")
        XCTAssertFalse(a.chat.privee)
        a.chat.marquerPrivee("c1")
        XCTAssertTrue(a.chat.privee)
        XCTAssertTrue(a.toast?.hasPrefix("Conversation passée en privée") == true)
        // Une autre conversation que celle ouverte : le cadenas de l'écran ne bouge pas.
        let b = app()
        _ = await b.chat.ouvrir("c2")
        b.chat.marquerPrivee("c1")
        XCTAssertFalse(b.chat.privee)
    }
}
