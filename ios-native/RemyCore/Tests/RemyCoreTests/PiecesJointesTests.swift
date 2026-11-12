import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Les pièces jointes du chat (12/11) : mêmes limites et mêmes mots que la
/// tour, la fiche lue avec tolérance, et l'envoi (pièces d'abord, puis le
/// message qui les cite ; un échec ne perd ni le texte ni les pièces).
@MainActor
final class PiecesJointesTests: XCTestCase {
    override func tearDown() {
        FauxServeur.reponses = [:]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.historique = [:]
    }

    private func app(_ capacites: [String] = [PiecesJointes.capacite]) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
        a.serveur = VersionServeur(api: 1, serveur: "0.2.0", capacites: capacites)
        return a
    }

    func testLesLimitesEtLesMotsDeLaTour() {
        XCTAssertEqual(PiecesJointes.pieceMax, 10 * 1024 * 1024)
        XCTAssertEqual(PiecesJointes.parMessage, 4)
        XCTAssertEqual(PiecesJointes.tailleLisible(512), "512 o")
        XCTAssertEqual(PiecesJointes.tailleLisible(240 * 1024), "240 Ko")
        XCTAssertEqual(PiecesJointes.tailleLisible(1_310_720), "1,3 Mo")
        XCTAssertEqual(PiecesJointes.tailleLisible(10 * 1024 * 1024), "10 Mo")
        XCTAssertNil(PiecesJointes.refus(nom: "photo.jpg", taille: 1000, deja: 0))
        XCTAssertNil(PiecesJointes.refus(nom: "notes.MD", taille: 10, deja: 3))
        XCTAssertTrue(PiecesJointes.refus(nom: "logo.svg", taille: 10, deja: 0)?.contains("type non pris") == true)
        XCTAssertTrue(PiecesJointes.refus(nom: "gros.pdf", taille: PiecesJointes.pieceMax + 1, deja: 0)?.contains("10 Mo au plus") == true)
        XCTAssertTrue(PiecesJointes.refus(nom: "x.png", taille: 1, deja: 4)?.contains("4 pièces au plus") == true)
        XCTAssertTrue(PiecesJointes.refus(nom: "vide.txt", taille: 0, deja: 0)?.contains("vide") == true)
        XCTAssertEqual(PiecesJointes.famille("devis.PDF"), "pdf")
        XCTAssertNil(PiecesJointes.famille("sans-extension"))
        XCTAssertEqual(PiecesJointes.enJPEG("IMG_0042.HEIC"), "IMG_0042.jpg")
        XCTAssertEqual(PiecesJointes.enJPEG("capture.png"), "capture.jpg")
        XCTAssertEqual(PiecesJointes.enJPEG("photo.jpeg"), "photo.jpeg")
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Paris")!
        let d = cal.date(from: DateComponents(year: 2026, month: 11, day: 12, hour: 9, minute: 5, second: 7))!
        XCTAssertEqual(PiecesJointes.nomPhoto(d, calendrier: cal), "photo-20261112-090507.jpg")
        XCTAssertEqual(PiecesJointes.reduction(largeur: 4032, hauteur: 3024, cote: PiecesJointes.coteVision)?.largeur, 1344)
        XCTAssertEqual(PiecesJointes.reduction(largeur: 4032, hauteur: 3024, cote: PiecesJointes.coteVision)?.hauteur, 1008)
        XCTAssertEqual(PiecesJointes.reduction(largeur: 800, hauteur: 600, cote: 1344)?.largeur, 800, "jamais agrandie")
    }

    func testLeCorpsDUnEnvoiLaisseLaTourLire() {
        let p = PieceAEnvoyer(nom: "ticket.jpg", donnees: Data([1, 2, 3]), apercu: Data([9]))
        let c = PiecesJointes.corps(p)
        XCTAssertEqual(c["nom"] as? String, "ticket.jpg")
        XCTAssertEqual(c["donnees"] as? String, "AQID")
        XCTAssertNil(c["texte"], "aucun texte reconnu sur l'iPhone : la tour lit")
        XCTAssertNil(c["lecture"])
        XCTAssertEqual(c["apercu"] as? String, "CQ==")
        XCTAssertEqual(Set(c.keys), ["nom", "donnees", "apercu"])
        let pdf = PiecesJointes.corps(PieceAEnvoyer(nom: "devis.pdf", donnees: Data([1])))
        XCTAssertNil(pdf["texte"])
        XCTAssertNil(pdf["lecture"])
    }

    func testLaFicheSeLitAvecToleranceEtDitCeQuiAEteLu() throws {
        let json = #"""
        {"id":"c1","title":"x","messages":[{"role":"user","content":"Regarde","pieces":[
          {"id":"a","nom":"devis.pdf","famille":"pdf","taille":2048,"lu":"texte","pages":3,"mention":"lue par Rémy (texte du PDF, 3 pages)"},
          {"id":"b","nom":"photo.jpg","famille":"image","taille":"illisible","lu":"non","raison":"pas de modèle de vision local"},
          {"nom":"sans-id.txt","lu":"texte"}
        ]},{"role":"assistant","content":"Vu."}]}
        """#
        let conv = try JSONDecoder().decode(Conversation.self, from: Data(json.utf8))
        let pieces = conv.messages[0].pieces ?? []
        XCTAssertEqual(pieces.count, 3, "une fiche mal formée n'empêche pas d'ouvrir le fil")
        XCTAssertEqual(pieces[0].libelle, "lue par Rémy (texte du PDF, 3 pages)")
        XCTAssertEqual(pieces[0].detail, "2 Ko · 3 p.")
        XCTAssertTrue(pieces[0].estLue)
        XCTAssertNil(pieces[1].taille)
        XCTAssertEqual(pieces[1].libelle, "non lue par Rémy : pas de modèle de vision local")
        XCTAssertFalse(pieces[1].estLue)
        XCTAssertTrue(pieces[1].estImage)
        XCTAssertEqual(pieces[2].libelle, "lue par Rémy")
        XCTAssertEqual(PieceJointe(id: "x", nom: "t.png", famille: "image", lu: "ocr", par: "tour").libelle, "texte reconnu sur la tour — peut se tromper")
        // Une fiche d'avant (l'iPhone lisait encore) garde sa vérité.
        XCTAssertEqual(PieceJointe(id: "x", nom: "t.png", famille: "image", lu: "ocr", par: "iphone").libelle, "texte reconnu sur l'iPhone — peut se tromper")
        XCTAssertEqual(PieceJointe(id: "x", nom: "t.png", famille: "image", lu: "decrite").libelle, "décrite par le modèle local — peut se tromper")
        let lignes = ChatModel.lignes(de: conv)
        XCTAssertEqual(lignes[0].pieces.map(\.id), ["a", "b", ""])
        XCTAssertTrue(lignes[1].pieces.isEmpty)
        // Un message sans pièce (tour d'avant) : rien ne change.
        let ancien = try JSONDecoder().decode(Message.self, from: Data(#"{"role":"user","content":"x"}"#.utf8))
        XCTAssertNil(ancien.pieces)
    }

    func testSansLaCapaciteLeTromboneResteCache() {
        // Les apps sont gardées en variables : `chat.app` est une référence
        // faible, un AppModel temporaire disparaîtrait avant la lecture.
        let sans = app([])
        XCTAssertFalse(sans.chat.piecesDisponibles)
        let avec = app()
        XCTAssertTrue(avec.chat.piecesDisponibles)
    }

    func testLeComposeurRefuseCeQueLaTourRefuserait() {
        let a = app()
        XCTAssertFalse(a.chat.ajouterPiece(PieceAEnvoyer(nom: "logo.svg", donnees: Data([1]))))
        XCTAssertNotNil(a.toast)
        for i in 0..<4 { XCTAssertTrue(a.chat.ajouterPiece(PieceAEnvoyer(nom: "n\(i).txt", donnees: Data([65])))) }
        XCTAssertFalse(a.chat.ajouterPiece(PieceAEnvoyer(nom: "n5.txt", donnees: Data([65]))))
        XCTAssertEqual(a.chat.piecesEnAttente.count, 4)
        a.chat.retirerPiece(a.chat.piecesEnAttente[0].id)
        XCTAssertEqual(a.chat.piecesEnAttente.count, 3)
    }

    func testLesPiecesPartentDAbordPuisLeMessageLesCite() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(201, #"{"id":"c1","title":"Nouvelle conversation","messages":[]}"#)],
            "POST /api/conversations/c1/pieces": [
                (201, #"{"id":"p1","nom":"ticket.jpg","famille":"image","taille":3,"lu":"ocr","par":"tour","mention":"texte reconnu sur la tour — peut se tromper"}"#),
                (201, #"{"id":"p2","nom":"devis.pdf","famille":"pdf","taille":1,"lu":"texte","pages":1}"#),
            ],
            "POST /api/conversations/c1/messages": [(200, "event: done\ndata: {\"text\":\"Vu.\"}\n\n")],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        a.chat.ajouterPiece(PieceAEnvoyer(nom: "ticket.jpg", donnees: Data([1, 2, 3]), apercu: Data([9])))
        a.chat.ajouterPiece(PieceAEnvoyer(nom: "devis.pdf", donnees: Data([4])))
        let r = await a.chat.envoyer("")
        XCTAssertEqual(r, "Vu.", "un message fait seulement de pièces part")
        XCTAssertEqual(FauxServeur.recues.filter { $0 == "POST /api/conversations/c1/pieces" }.count, 2)
        XCTAssertNil(FauxServeur.historique["POST /api/conversations/c1/pieces"]?.first?["texte"], "la tour lit l'image elle-même")
        XCTAssertEqual(FauxServeur.historique["POST /api/conversations/c1/pieces"]?.first?["apercu"] as? String, "CQ==")
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations/c1/messages"]?["pieces"] as? [String], ["p1", "p2"])
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations/c1/messages"]?["text"] as? String, "")
        XCTAssertTrue(a.chat.piecesEnAttente.isEmpty)
        XCTAssertEqual(a.chat.lignes.first?.pieces.map(\.id), ["p1", "p2"])
        let ordre = FauxServeur.recues.filter { $0.hasPrefix("POST /api/conversations/c1/") }
        XCTAssertEqual(ordre.last, "POST /api/conversations/c1/messages", "le message après ses pièces")
    }

    func testUnRefusDeLaTourNeFaitRienPartirEtNePerdRien() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(201, #"{"id":"c1","title":"Nouvelle conversation","messages":[]}"#)],
            "POST /api/conversations/c1/pieces": [(415, #"{"error":"pieces","message":"« capture.png » n'est pas ce que dit son nom (une image attendue) : rien n'a été joint."}"#)],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        a.chat.ajouterPiece(PieceAEnvoyer(nom: "capture.png", donnees: Data([1])))
        let r = await a.chat.envoyer("Regarde ça")
        XCTAssertNil(r)
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/conversations/c1/messages"), "rien n'est parti")
        XCTAssertEqual(a.chat.brouillon, "Regarde ça", "le texte revient au champ")
        XCTAssertEqual(a.chat.piecesEnAttente.count, 1, "la pièce reste dans le composeur")
        XCTAssertTrue(a.toast?.contains("n'est pas ce que dit son nom") == true)
        XCTAssertFalse(a.chat.envoi)
    }

    func testLEssaiDeLaTourSeLitLigneParLigne() throws {
        let json = #"{"lignes":[{"cle":"ocr","libelle":"Reconnaissance de texte Windows","ok":true,"detail":"oui, français"},{"cle":"vision","libelle":"Le modèle local lit les images","ok":false,"detail":"non — il n'a pas su dire la couleur"},{"cle":"pdf","libelle":"PDF","ok":true,"detail":"oui"}],"diagnostic":"Lecture des pièces jointes (essai de la tour)\nPDF : oui","at":1}"#
        let e = try JSONDecoder().decode(EssaiPieces.self, from: Data(json.utf8))
        XCTAssertEqual(e.lignes.map(\.cle), ["ocr", "vision", "pdf"])
        XCTAssertEqual(e.lignes.map(\.ok), [true, false, true])
        XCTAssertTrue(e.diagnostic.hasPrefix("Lecture des pièces jointes"))
    }
}
