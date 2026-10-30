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
        XCTAssertEqual(p.conversations[0].ligne(maintenant: Date(timeIntervalSince1970: fin / 1000 + 60)), "T3 Code · Codex · \(Format.heure(fin)) · 2 messages · Site de la boutique")
        // ChatGPT n'est pas dit deux fois (source et assistant portent le même nom).
        var g2 = p.conversations[0]
        g2.source = "chatgpt"
        g2.assistant = "ChatGPT"
        g2.projet = nil
        XCTAssertNil(g2.assistantDistinct)
        XCTAssertEqual(g2.ligne(maintenant: Date(timeIntervalSince1970: fin / 1000 + 60)), "ChatGPT · \(Format.heure(fin)) · 2 messages")
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

    func testLeBilanDitAussiCeQuiNEstPasGarde() async {
        XCTAssertEqual(BilanImport(nouvelles: 3, ignorees: 2, tronquees: 1).phrase,
                       "3 conversations importées. 2 ignorées (sans texte lisible). 1 très longue : seule la fin est gardée.")
        let b = try? JSONDecoder().decode(BilanImport.self, from: Data(#"{"nouvelles":1,"ignorees":1,"tronquees":0}"#.utf8))
        XCTAssertEqual(b?.phrase, "1 conversation importée. 1 ignorée (sans texte lisible).")
    }

    func testUneErreurDeLaTourDitQuoiFaire() async {
        FauxServeur.reponses = ["POST /api/conversations-externes/chatgpt": [(413, #"{"error":"trop-gros","message":"Fichier trop gros pour la tour (2048 Mo au plus).","quoiFaire":"Dans Fichiers, touche le .zip pour le décompresser et envoie seulement conversations.json."}"#)]]
        let a = app()
        let f = FileManager.default.temporaryDirectory.appendingPathComponent("export-\(UUID().uuidString).zip")
        try? Data("PK fictif".utf8).write(to: f)
        defer { try? FileManager.default.removeItem(at: f) }
        let ok = await a.conversationsExternes.importer(f)
        XCTAssertFalse(ok)
        XCTAssertEqual(a.toast, "Fichier trop gros pour la tour (2048 Mo au plus). Dans Fichiers, touche le .zip pour le décompresser et envoie seulement conversations.json.")
        XCTAssertNil(a.conversationsExternes.progressionImport, "plus rien en cours")
        XCTAssertEqual(a.conversationsExternes.libelleImport, "Importer un export ChatGPT")
    }

    func testLesExportsImportesHorsDuCoffreSeDisent() async throws {
        let j = Self.etat.replacingOccurrences(of: #""imports":{"dossier":"~\\Documents\\Imports","enAttente":0,"importes":1}"#,
                                                with: #""imports":{"dossier":"~\\Documents\\Imports","enAttente":0,"importes":1,"originaux":{"dossier":"~\\.remy\\imports-importes","fichiers":1,"octets":2048,"gardeJours":7}}"#)
        XCTAssertNotEqual(j, Self.etat)
        let e = try JSONDecoder().decode(EtatConversations.self, from: Data(j.utf8))
        XCTAssertEqual(e.imports?.originaux?.fichiers, 1)
        XCTAssertEqual(e.imports?.originaux?.phrase, "1 export importé reste en clair hors du coffre (~\\.remy\\imports-importes) : effacé 7 jours après l'import.")
        XCTAssertNil(EtatConversations.Imports.Originaux(fichiers: 0).phrase, "rien à dire quand il n'en reste pas")
        XCTAssertNil(try JSONDecoder().decode(EtatConversations.self, from: Data(Self.etat.utf8)).imports?.originaux, "une tour d'avant : rien")
    }

    func testAllerAUnJourSansDeroulerDesPages() async {
        FauxServeur.reponses = [
            "GET /api/conversations-externes/jours": [(200, #"{"jours":[{"jour":"2026-10-28","conversations":4},{"jour":"2026-07-14","conversations":1}]}"#)],
            "GET /api/conversations-externes/liste": [(200, Self.liste)],
        ]
        let a = app()
        let m = a.conversationsExternes
        await m.filtrer("chatgpt")
        await m.chargerJours()
        XCTAssertEqual(m.jours?.map(\.jour), ["2026-10-28", "2026-07-14"])
        let q = FauxServeur.requetes["GET /api/conversations-externes/jours"] ?? ""
        XCTAssertTrue(q.contains("nombre=400") && q.contains("source=chatgpt"), q)
        await m.choisirJour("2026-07-14")
        XCTAssertEqual(m.jour, "2026-07-14")
        XCTAssertTrue(FauxServeur.requetes["GET /api/conversations-externes/liste"]?.contains("jour=2026-07-14") == true)
        XCTAssertTrue(FauxServeur.requetes["GET /api/conversations-externes/liste"]?.contains("source=chatgpt") == true, "le jour et la source se combinent")
        await m.choisirJour(nil)
        XCTAssertNil(m.jour)
        XCTAssertFalse(FauxServeur.requetes["GET /api/conversations-externes/liste"]?.contains("jour=") == true)
        // Changer de source oublie les jours (ils dépendent de la source).
        await m.filtrer(nil)
        XCTAssertNil(m.jours)
        // Le titre d'un jour est celui de la liste.
        let midi = Format.calendrier.date(from: DateComponents(year: 2026, month: 10, day: 29, hour: 12))!
        XCTAssertEqual(ConversationsExternes.titreJour(iso: "2026-10-28", maintenant: midi), "Hier")
        XCTAssertEqual(ConversationsExternes.titreJour(iso: "2026-10-29", maintenant: midi), "Aujourd'hui")
        XCTAssertEqual(ConversationsExternes.titreJour(iso: "pas-une-date", maintenant: midi), "pas-une-date")
        XCTAssertEqual(ConversationsExternes.ceJour(iso: "2026-10-28", maintenant: midi), "hier")
        XCTAssertTrue(ConversationsExternes.ceJour(iso: "2026-07-14", maintenant: midi).hasPrefix("le mardi 14"), ConversationsExternes.ceJour(iso: "2026-07-14", maintenant: midi))
    }

    func testUnResultatOuvreLaConversationAuMessageTrouve() async throws {
        FauxServeur.reponses = [
            "GET /api/conversations-externes/conversations/t3/fil-paiement": [(200, #"{"conversation":{"source":"t3","id":"fil-paiement","titre":"Paiement","messages":40},"messages":[{"id":6,"auteur":"assistant","texte":"avant"},{"id":7,"auteur":"utilisateur","texte":"le paiement en trois fois"}],"suite":8,"cible":7,"avant":true}"#)],
        ]
        let a = app()
        let l = try await a.api.conversationExterne(source: "t3", id: "fil-paiement", autour: 7)
        XCTAssertEqual(FauxServeur.requetes["GET /api/conversations-externes/conversations/t3/fil-paiement"], "autour=7")
        XCTAssertEqual(l.cible, 7)
        XCTAssertEqual(l.avant, true)
        XCTAssertEqual(l.messages.last?.texte, "le paiement en trois fois")
        _ = try await a.api.conversationExterne(source: "t3", id: "fil-paiement", apres: 8)
        XCTAssertEqual(FauxServeur.requetes["GET /api/conversations-externes/conversations/t3/fil-paiement"], "apres=8")
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

    // Soir du 29/10 : le recensement, Téléchargements et la carte « Exporter
    // ChatGPT », tels que la tour les rend (docs/conversations-externes.md).
    static let etatExport = """
    {"sources":[
      {"id":"claude-code","nom":"Claude Code","actif":true,"disponible":true,"conversations":0,"messages":0,"derniereLecture":1793235865350,
       "aide":{"code":"hors-filtre","message":"312 sessions trouvées, aucune gardée : 300 hors du filtre REMY_CONNAISSANCES_PROJETS (« essai »), 12 d'un seul échange lancées par un programme (claude -p).","quoiFaire":"Retire REMY_CONNAISSANCES_PROJETS de remy.env."},
       "recensement":{"sessions":312,"gardees":0,"ecartees":{"horsFiltre":300,"programme":12},"phrase":"312 sessions : aucune lue, 300 hors du filtre REMY_CONNAISSANCES_PROJETS (« essai »), 12 d'un seul échange lancées par un programme (claude -p)."}},
      {"id":"t3","nom":"T3 Code","actif":true,"disponible":true,"conversations":1,"messages":2,"derniereLecture":1793235865350,
       "recensement":{"bases":2,"fils":1,"gardes":1,"phrase":"2 bases, 1 fil : 1 lu."}},
      {"id":"chatgpt","nom":"ChatGPT","actif":true,"disponible":true,"conversations":0,"messages":0,
       "emplacements":[{"origine":"dossier surveillé","chemin":"~\\\\Documents\\\\Rémy\\\\Imports","trouve":true},{"origine":"Téléchargements, lecture seule","chemin":"~\\\\Downloads","trouve":true}],
       "aide":{"code":"rien-importe","message":"Aucun export ChatGPT importé.","quoiFaire":"Quand le mail arrive, clique son lien sur la tour : Rémy prend le .zip dans ses Téléchargements."},"recensement":null}],
     "usage":{"chat":true,"nuit":true},"chiffre":true,
     "chatgpt":{"telechargements":{"actif":true,"forceParLaTour":false,"dossiers":[{"chemin":"~\\\\Downloads","trouve":true}],"joursMax":90},
                "rappel":{"actif":true,"aMontrer":true,"dernierImport":null,"depuisJours":null,"seuilJours":30,"lien":"https://chatgpt.com/#settings/DataControls"}},
     "total":{"conversations":1,"messages":2}}
    """

    func testLeRecensementEtLaVraieRaisonSeLisent() async throws {
        let e = try JSONDecoder().decode(EtatConversations.self, from: Data(Self.etatExport.utf8))
        let claude = try XCTUnwrap(e.source("claude-code"))
        // L'ancien champ suffit à un iPhone déjà installé : il dit la vraie raison.
        XCTAssertEqual(claude.phrase(), "312 sessions trouvées, aucune gardée : 300 hors du filtre REMY_CONNAISSANCES_PROJETS (« essai »), 12 d'un seul échange lancées par un programme (claude -p).")
        XCTAssertEqual(claude.aide?.code, "hors-filtre")
        XCTAssertEqual(claude.phraseRecensement, "312 sessions : aucune lue, 300 hors du filtre REMY_CONNAISSANCES_PROJETS (« essai »), 12 d'un seul échange lancées par un programme (claude -p).")
        XCTAssertEqual(e.source("t3")?.phraseRecensement, "2 bases, 1 fil : 1 lu.")
        XCTAssertNil(e.source("chatgpt")?.phraseRecensement)
        XCTAssertTrue(e.source("chatgpt")?.emplacements.contains { $0.origine == "Téléchargements, lecture seule" && $0.chemin == "~\\Downloads" } == true)
        // Une tour plus ancienne : aucun des nouveaux champs, rien ne casse.
        let ancien = try JSONDecoder().decode(EtatConversations.self, from: Data(Self.etat.utf8))
        XCTAssertNil(ancien.chatgpt)
        XCTAssertNil(ancien.source("claude-code")?.recensement)
        XCTAssertNil(ConversationsExternes.carteExportChatGPT(ancien))
    }

    func testLaCarteExporterChatGPTDitLesMemesMotsQueLeSite() async throws {
        var e = try JSONDecoder().decode(EtatConversations.self, from: Data(Self.etatExport.utf8))
        let c = try XCTUnwrap(ConversationsExternes.carteExportChatGPT(e))
        XCTAssertEqual(c.titre, "Exporter ChatGPT")
        // Le lien se clique sur la tour ; reçu sur l'iPhone, la carte importe le .zip (contre-relecture du 30/10).
        XCTAssertEqual(c.texte, "Exporte tes données ; quand le mail arrive, clique son lien sur la tour : Rémy le trouve dans ses Téléchargements et te demande ton accord. Ailleurs, importe le .zip ici.")
        XCTAssertEqual(c.importer, "Importer le .zip")
        XCTAssertEqual(c.detail, "Aucun export importé pour l'instant.")
        XCTAssertEqual(c.lien.absoluteString, "https://chatgpt.com/#settings/DataControls")
        XCTAssertEqual(c.bouton, "Ouvrir ChatGPT")
        XCTAssertEqual(ConversationsExternes.phraseTelechargements(e.chatgpt?.telechargements),
                       "Rémy regarde ~\\Downloads sur la tour, en lecture seule : il n'y prend que les exports ChatGPT de moins de 90 jours, avec ton accord, sans jamais rien y déplacer ni effacer.")
        // Un .zip illisible : la phrase de la tour, à la suite (tour plus ancienne : rien).
        let illisible = "1 .zip illisible dans les Téléchargements de la tour : « export.zip » (du 9/10). Un export plus récent est déjà importé : efface-le quand tu veux (Rémy n'y touche jamais)."
        let avecIllisible = try JSONDecoder().decode(EtatConversations.ExportChatGPT.Telechargements.self,
                                                     from: Data(#"{"actif":true,"dossiers":[{"chemin":"~\\Downloads","trouve":true}],"joursMax":90,"phraseIllisibles":"\#(illisible)"}"#.utf8))
        XCTAssertEqual(ConversationsExternes.phraseTelechargements(avecIllisible),
                       "Rémy regarde ~\\Downloads sur la tour, en lecture seule : il n'y prend que les exports ChatGPT de moins de 90 jours, avec ton accord, sans jamais rien y déplacer ni effacer. \(illisible)")
        XCTAssertNil(e.chatgpt?.telechargements?.phraseIllisibles)
        // Le dernier import a 45 jours, Téléchargements coupé : importer à la main.
        e.chatgpt?.rappel = .init(actif: true, aMontrer: true, dernierImport: 1_790_000_000_000, depuisJours: 45, lien: "https://ailleurs.example/")
        e.chatgpt?.telechargements?.actif = false
        let d = try XCTUnwrap(ConversationsExternes.carteExportChatGPT(e))
        XCTAssertEqual(d.texte, "Exporte tes données ; quand le mail arrive, clique le lien, puis importe le .zip ici.")
        XCTAssertEqual(d.importer, "Importer le .zip")
        XCTAssertEqual(d.detail, "Dernier import il y a 45 jours.")
        XCTAssertEqual(d.lien, ConversationsExternes.lienExportChatGPT, "un lien qui ne mène pas à ChatGPT n'est jamais suivi")
        e.chatgpt?.rappel?.aMontrer = false
        XCTAssertNil(ConversationsExternes.carteExportChatGPT(e))
        e.chatgpt?.telechargements = .init(actif: false, forceParLaTour: true)
        XCTAssertEqual(ConversationsExternes.phraseTelechargements(e.chatgpt?.telechargements), "Coupé sur la tour (REMY_TELECHARGEMENTS=off).")
    }

    // Un export trouvé dans Téléchargements (contre-relecture du 30/10, tour 2) :
    // l'iPhone a sa carte, avec « Importer » et « Pas celui-là ».
    static let etatProposition = etatExport.replacingOccurrences(
        of: #""joursMax":90},"#,
        with: #""joursMax":90,"propositions":[{"id":"f-0123456789abcdef01234567","nom":"export-premier.zip","octets":4200000,"date":1793142325000,"autreCompte":false},{"id":"","nom":"sans clé"},{"nom":"mal formée"}]},"#)

    func testUnExportTrouveDansTelechargementsAttendTonGesteSurLiPhone() async throws {
        let e = try JSONDecoder().decode(EtatConversations.self, from: Data(Self.etatProposition.utf8))
        let props = ConversationsExternes.propositions(e)
        XCTAssertEqual(props.map(\.nom), ["export-premier.zip"], "les propositions mal formées sont laissées de côté")
        // Le rappel reste dû pour un iPhone plus ancien ; ici, c'est la carte de l'export trouvé qui parle.
        XCTAssertEqual(e.chatgpt?.rappel?.aMontrer, true)
        XCTAssertNil(ConversationsExternes.carteExportChatGPT(e))
        var paris = Calendar(identifier: .gregorian)
        paris.timeZone = TimeZone(identifier: "Europe/Paris")!
        let c = ConversationsExternes.carteProposition(props[0], calendrier: paris)
        // Les mêmes mots que le site (analyse/conversations.js).
        XCTAssertEqual(c.titre, "Un export ChatGPT trouvé dans Téléchargements")
        XCTAssertEqual(c.texte, "« export-premier.zip » (4,2 Mo, du 28/10) : l'importer ?")
        XCTAssertEqual(c.importer, "Importer")
        XCTAssertEqual(c.refuser, "Pas celui-là")
        XCTAssertEqual(ConversationsExternes.taille(820), "1 ko")
        XCTAssertEqual(ConversationsExternes.taille(12_400), "12 ko")
        XCTAssertEqual(ConversationsExternes.taille(128_000_000), "128 Mo")
        // Une tour plus ancienne : aucune proposition, rien ne casse.
        let ancien = try JSONDecoder().decode(EtatConversations.self, from: Data(Self.etatExport.utf8))
        XCTAssertEqual(ConversationsExternes.propositions(ancien), [])
        XCTAssertNotNil(ConversationsExternes.carteExportChatGPT(ancien))
    }

    func testImporterOuPasCeluiLaPartentVersLaTourEtSeDisent() async throws {
        let apres = Self.etatExport
        FauxServeur.reponses = [
            "POST /api/conversations-externes/chatgpt/telechargements": [
                (200, #"{"ok":true,"bilan":{"conversations":2,"nouvelles":2,"misesAJour":0},"etat":\#(apres)}"#),
                (200, #"{"ok":true,"message":"Pas importé : Rémy ne le proposera plus (sauf s'il change).","etat":\#(apres)}"#),
                (409, #"{"error":"deja-importe","message":"Déjà importé : cet export est entré dans ta mémoire juste avant.","quoiFaire":"Pour le retirer : Sources › ChatGPT › « Effacer ce que Rémy en a gardé »."}"#),
            ],
            "GET /api/conversations-externes/liste": [(200, Self.liste)],
            "GET /api/conversations-externes": [(200, Self.etatExport)],
        ]
        let a = app(capacites: ["conversations-externes-v1", ConversationsExternes.capaciteExport])
        let m = a.conversationsExternes
        let e = try JSONDecoder().decode(EtatConversations.self, from: Data(Self.etatProposition.utf8))
        m.montrerPourCapture(etat: e, liste: [])
        let p = try XCTUnwrap(m.propositions.first)
        let ok1 = await m.repondre(p, importer: true)
        XCTAssertTrue(ok1)
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations-externes/chatgpt/telechargements"]?["id"] as? String, "f-0123456789abcdef01234567")
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations-externes/chatgpt/telechargements"]?["importer"] as? Bool, true)
        XCTAssertEqual(a.toast, "Import ChatGPT : 2 conversations importées.")
        XCTAssertEqual(m.propositions, [], "l'état revenu de la tour fait foi")
        m.montrerPourCapture(etat: e, liste: [])
        let ok2 = await m.repondre(p, importer: false)
        XCTAssertTrue(ok2)
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations-externes/chatgpt/telechargements"]?["importer"] as? Bool, false)
        XCTAssertEqual(a.toast, "Pas importé : Rémy ne le proposera plus (sauf s'il change).")
        // Déjà importé : dit tel quel, et l'état est relu.
        m.montrerPourCapture(etat: e, liste: [])
        let ok3 = await m.repondre(p, importer: false)
        XCTAssertFalse(ok3)
        XCTAssertEqual(a.toast, "Déjà importé : cet export est entré dans ta mémoire juste avant. Pour le retirer : Sources › ChatGPT › « Effacer ce que Rémy en a gardé ».")
        XCTAssertEqual(m.propositions, [], "relu après l'échec")
    }

    func testLesReglagesDeLExportPartentEtSeDisent() async {
        FauxServeur.reponses = [
            "PUT /api/conversations-externes/sources/chatgpt": [(200, Self.etatExport), (200, Self.etatExport), (500, "<h1>Erreur interne</h1>")],
            "POST /api/conversations-externes/synchroniser": [(200, #"{"bilan":{"ok":true,"sources":{}},"etat":\#(Self.etatExport)}"#)],
            "GET /api/conversations-externes/liste": [(200, Self.liste)],
        ]
        let a = app(capacites: ["conversations-externes-v1", ConversationsExternes.capaciteExport])
        let m = a.conversationsExternes
        let ok1 = await m.reglerExportChatGPT(rappel: false)
        XCTAssertTrue(ok1)
        XCTAssertEqual(FauxServeur.corps["PUT /api/conversations-externes/sources/chatgpt"]?["rappel"] as? Bool, false)
        XCTAssertNil(FauxServeur.corps["PUT /api/conversations-externes/sources/chatgpt"]?["actif"], "jamais la source elle-même")
        XCTAssertEqual(a.toast, "Plus de rappel d'export. Il se rallume dans Sources.")
        XCTAssertNotNil(m.carteExport, "l'état revenu de la tour fait foi")
        let ok2 = await m.reglerExportChatGPT(telechargements: true)
        XCTAssertTrue(ok2)
        XCTAssertEqual(FauxServeur.corps["PUT /api/conversations-externes/sources/chatgpt"]?["telechargements"] as? Bool, true)
        XCTAssertEqual(a.toast, "Rémy prend de nouveau l'export ChatGPT dans Téléchargements.")
        // La tour en panne : le geste échoue, et le dit.
        let ok3 = await m.reglerExportChatGPT(telechargements: false)
        XCTAssertFalse(ok3)
        XCTAssertNotNil(a.toast)
        // « Lire maintenant » sur ChatGPT : Imports et Téléchargements.
        let ok4 = await m.lireMaintenant("chatgpt")
        XCTAssertTrue(ok4)
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations-externes/synchroniser"]?["source"] as? String, "chatgpt")
        XCTAssertEqual(a.toast, "Lu : Aucun export ChatGPT importé.")
    }
}
