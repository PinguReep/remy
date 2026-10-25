import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// La file d'envoi des captures (25/10) : une tâche, une idée, « Retenir » ou
/// un dossier noté sans réseau attend sur l'iPhone, tel que compris, et part
/// au retour de Rémy — une seule fois. Un refus reste visible et récupérable.
@MainActor
final class EnvoiCapturesTests: XCTestCase {
    private nonisolated let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("remy-captures-" + UUID().uuidString)
    private var rangement: Rangement { Rangement(dossier: dossier) }
    private let creee = #"{"ledgerId":"L9","echecs":0,"etat":"appliquee","results":[{"ok":true,"type":"creer","nom":"Envoyer le devis"}]}"#
    private let refus = #"{"echecs":1,"etat":"echouee","results":[{"ok":false,"type":"creer","nom":"Envoyer le devis","erreur":"Motion refuse ce nom"}]}"#

    override func tearDown() {
        try? FileManager.default.removeItem(at: dossier)
        FauxServeur.coupures = [:]
        FauxServeur.reponses = [:]
        super.tearDown()
    }

    private func neuf(_ reponses: [String: [(Int, String)]] = [:], coupures: [String: Int] = [:]) {
        FauxServeur.reponses = reponses
        FauxServeur.coupures = coupures
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.historique = [:]
    }

    /// Une app sur cet iPhone : en créer une seconde, c'est relancer l'app.
    private func app(capacites: [String] = ["propositions-v1", "dossiers-v1", "capture-idempotente-v1"]) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)),
                         rangement: rangement)
        a.serveur = VersionServeur(api: 1, serveur: "0.9.0", capacites: capacites)
        a.api.rejeuSur = capacites.contains("propositions-v1")
        return a
    }

    private func existe(_ nom: String) -> Bool {
        FileManager.default.fileExists(atPath: dossier.appendingPathComponent(nom).path)
    }

    private func dimanche() -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = Format.fuseau
        return cal.date(from: DateComponents(year: 2026, month: 11, day: 1, hour: 23))!
    }

    /// Le cœur de la décision : notée tour coupée, la tâche attend sur le
    /// disque (même après une relance), puis part au retour de Rémy avec la
    /// même clé et la même échéance. Motion ne la reçoit qu'une fois.
    func testUneTacheNoteeSansReseauPartAuRetourAvecSaCle() async throws {
        neuf(coupures: ["POST /api/motion/apply": 10])
        let a = app()
        let ok = await a.noterTache("Envoyer le devis", echeance: dimanche())
        XCTAssertTrue(ok)
        XCTAssertEqual(a.toast, "Pas de réseau : « Envoyer le devis » partira dès que Rémy sera joignable.")
        XCTAssertEqual(a.tableau.capturesEnAttente.count, 1)
        XCTAssertTrue(existe("captures.json"), "écrite sur le disque avant de partir")
        XCTAssertFalse(existe("envoi.json"), "à part des coches : un build plus ancien ne la lirait pas")
        let cle = try XCTUnwrap(a.tableau.capturesEnAttente.first?.id)
        let essais = FauxServeur.historique["POST /api/motion/apply"] ?? []
        XCTAssertFalse(essais.isEmpty)
        XCTAssertTrue(essais.allSatisfy { $0["idCommande"] as? String == cle }, "chaque essai porte la clé de la capture")

        // Relancée, la tour revenue.
        neuf(["POST /api/motion/apply": [(200, creee)], "GET /api/dashboard": [(200, "{}")]])
        let b = app()
        XCTAssertEqual(b.tableau.capturesEnAttente.map(\.id), [cle], "relue sur le disque")
        XCTAssertTrue(b.tableau.aEnvoyer)
        await b.tableau.envoyerEnAttente()
        await b.tableau.relectureApresGeste?.value
        XCTAssertEqual(FauxServeur.historique["POST /api/motion/apply"]?.count, 1, "une seule écriture")
        XCTAssertEqual(FauxServeur.corps["POST /api/motion/apply"]?["idCommande"] as? String, cle, "la même clé : la tour ne refait rien")
        let action = try XCTUnwrap((FauxServeur.corps["POST /api/motion/apply"]?["actions"] as? [[String: Any]])?.first)
        XCTAssertEqual(action["nom"] as? String, "Envoyer le devis")
        XCTAssertEqual(action["echeance"] as? String, "2026-11-01T23:00:00+01:00", "l'échéance comprise à la capture, figée")
        XCTAssertEqual(b.toast, "Envoyé : « Envoyer le devis » est dans Motion, à faire d'ici dimanche 1 novembre.")
        XCTAssertNotNil(b.message?.annuler, "« Annuler » la retire de Motion")
        XCTAssertTrue(b.tableau.capturesEnAttente.isEmpty)
        XCTAssertFalse(existe("captures.json"))
        // Un nouvel essai ne renvoie rien.
        await b.tableau.envoyerEnAttente()
        XCTAssertEqual(FauxServeur.historique["POST /api/motion/apply"]?.count, 1)
    }

    /// L'iPhone sait qu'il n'a aucun réseau : rien ne part, la capture est
    /// gardée sans essai (donc sans doute sur son arrivée).
    func testHorsLigneConnuRienNePart() async {
        neuf()
        let a = app()
        await a.changerReseau(horsLigne: true)
        let ok = await a.retenirNote("J'aimerais un petit studio à Porto pour écrire l'hiver prochain.")
        XCTAssertTrue(ok)
        XCTAssertTrue(FauxServeur.recues.isEmpty, "aucune requête")
        XCTAssertEqual(a.tableau.capturesEnAttente.first?.tentatives, 0)
        XCTAssertEqual(a.toast, "Pas de réseau : « J'aimerais un petit studio à Porto pour… » partira dès que Rémy sera joignable.")
    }

    /// « Retenir » rejoué : la tour reconnaît l'identifiant (capture-idempotente-v1).
    func testRetenirPartAvecSonIdentifiant() async throws {
        neuf(coupures: ["POST /api/capture": 1])
        let a = app()
        let texte = "J'aimerais un petit studio à Porto pour écrire l'hiver prochain."
        _ = await a.retenirNote(texte)
        let id = try XCTUnwrap(a.tableau.capturesEnAttente.first?.id)
        XCTAssertEqual(FauxServeur.corps["POST /api/capture"]?["idCapture"] as? String, id)
        neuf(["POST /api/capture": [(200, #"{"ajouts":["Sam veut un studio à Porto"],"memoire":true,"rejoue":true}"#)]])
        await a.tableau.envoyerEnAttente()
        XCTAssertEqual(FauxServeur.corps["POST /api/capture"]?["idCapture"] as? String, id, "le même identifiant")
        XCTAssertEqual(FauxServeur.corps["POST /api/capture"]?["texte"] as? String, texte)
        XCTAssertEqual(a.toast, "Envoyé à Rémy. Retenu : Sam veut un studio à Porto")
        XCTAssertTrue(a.tableau.capturesEnAttente.isEmpty)
    }

    /// Une tour qui ne reconnaît pas un renvoi (avant capture-idempotente-v1) :
    /// « Retenir » ne part qu'une fois. Coupée pendant l'envoi, elle est
    /// peut-être arrivée : elle attend Sam, jamais renvoyée à l'aveugle.
    func testTourAncienneRetenirNePartQuUneFois() async throws {
        neuf(coupures: ["POST /api/capture": 1])
        let a = app(capacites: ["propositions-v1", "dossiers-v1"])
        _ = await a.retenirNote("J'aimerais un petit studio à Porto pour écrire l'hiver prochain.")
        XCTAssertNil(FauxServeur.corps["POST /api/capture"]?["idCapture"], "une tour ancienne ne connaît pas l'identifiant")
        XCTAssertEqual(FauxServeur.historique["POST /api/capture"]?.count, 1)
        let c = try XCTUnwrap(a.tableau.capturesEnAttente.first)
        XCTAssertEqual(c.raison, TableauModel.peutEtreRecue)
        XCTAssertFalse(a.tableau.partSeule(c))
        XCTAssertFalse(a.tableau.aEnvoyer)
        XCTAssertTrue(a.toast?.hasPrefix("Réseau coupé pendant l'envoi : Rémy l'a peut-être reçue.") == true)
        neuf(["POST /api/capture": [(200, #"{"ajouts":[],"memoire":false}"#)]])
        await a.tableau.envoyerEnAttente()
        XCTAssertNil(FauxServeur.historique["POST /api/capture"], "pas de renvoi à l'aveugle")
        // Sam a vérifié : « Renvoyer ».
        await a.tableau.renvoyerCapture(c.id)
        XCTAssertEqual(FauxServeur.historique["POST /api/capture"]?.count, 1)
        XCTAssertTrue(a.tableau.capturesEnAttente.isEmpty)
    }

    /// Une capture gardée sans essai (iPhone hors ligne) part une fois vers
    /// une tour ancienne ; l'app fermée en route, elle ne repart pas seule.
    func testTourAncienneUneCaptureJamaisEssayeePartUneFois() async throws {
        neuf()
        let a = app(capacites: ["propositions-v1", "dossiers-v1"])
        await a.changerReseau(horsLigne: true)
        _ = await a.retenirNote("J'aimerais un petit studio à Porto pour écrire l'hiver prochain.")
        let c = try XCTUnwrap(a.tableau.capturesEnAttente.first)
        XCTAssertTrue(a.tableau.partSeule(c), "jamais partie : elle peut partir une fois")
        // La tentative est notée AVANT de partir : relue après une fermeture, elle attend Sam.
        neuf(["POST /api/capture": [(200, #"{"ajouts":[],"memoire":false}"#)]])
        FauxServeur.delais = ["POST /api/capture": 400_000_000]
        defer { FauxServeur.delais = [:] }
        let envoi = Task { await a.tableau.envoyerEnAttente() }
        for _ in 0..<200 where !FauxServeur.recues.contains("POST /api/capture") { try? await Task.sleep(nanoseconds: 2_000_000) }
        let relue = try XCTUnwrap(rangement.copie([Commande].self, Rangement.captures)?.valeur.first)
        XCTAssertEqual(relue.tentatives, 1)
        await envoi.value
        XCTAssertTrue(a.tableau.capturesEnAttente.isEmpty)
    }

    /// Partie plus tard, refusée par Motion : elle reste dans la liste, avec
    /// sa raison, ne repart pas seule, et Sam la renvoie ou la retire.
    func testRefusEnRepriseResteRecuperable() async throws {
        neuf(coupures: ["POST /api/motion/apply": 10])
        let a = app()
        _ = await a.noterTache("Envoyer le devis")
        let id = try XCTUnwrap(a.tableau.capturesEnAttente.first?.id)
        neuf(["POST /api/motion/apply": [(200, refus)]])
        await a.tableau.envoyerEnAttente()
        XCTAssertEqual(a.toast, "Pas envoyé : « Envoyer le devis » — Motion refuse ce nom. Elle reste dans « En attente d'envoi ».")
        let c = try XCTUnwrap(a.tableau.capturesEnAttente.first)
        XCTAssertEqual(c.raison, "Motion refuse ce nom")
        XCTAssertTrue(existe("captures.json"), "jamais perdue en silence")
        await a.tableau.envoyerEnAttente()
        XCTAssertEqual(FauxServeur.historique["POST /api/motion/apply"]?.count, 1, "refusée : elle ne repart pas seule")
        // Retirée, puis remise par « Annuler ».
        a.tableau.retirerCapture(id)
        XCTAssertTrue(a.tableau.capturesEnAttente.isEmpty)
        XCTAssertEqual(a.toast, "Retirée : « Envoyer le devis » ne partira pas.")
        a.message?.annuler?()
        XCTAssertEqual(a.tableau.capturesEnAttente.map(\.id), [id])
        // Corrigé côté Motion : « Renvoyer ».
        neuf(["POST /api/motion/apply": [(200, creee)], "GET /api/dashboard": [(200, "{}")]])
        await a.tableau.renvoyerCapture(id)
        await a.tableau.relectureApresGeste?.value
        XCTAssertEqual(FauxServeur.corps["POST /api/motion/apply"]?["idCommande"] as? String, id)
        XCTAssertTrue(a.tableau.capturesEnAttente.isEmpty)
        XCTAssertEqual(a.toast, "Envoyé : « Envoyer le devis » est dans Motion.")
    }

    /// Feuille ouverte, refusée : le texte reste dans le champ, rien n'attend.
    func testRefusFeuilleOuverteNeGardeRien() async {
        neuf(["POST /api/motion/apply": [(200, refus)]])
        let a = app()
        let ok = await a.noterTache("Envoyer le devis")
        XCTAssertFalse(ok)
        XCTAssertEqual(a.toast, "Pas ajouté à Motion : Motion refuse ce nom.")
        XCTAssertTrue(a.tableau.capturesEnAttente.isEmpty)
        XCTAssertFalse(existe("captures.json"))
    }

    /// Une idée et un dossier : écrits par leur identifiant (celui de la
    /// capture) — un renvoi réécrit la même note, le même dossier.
    func testIdeeEtDossierPartentAvecLeurIdentifiant() async throws {
        neuf()
        let a = app()
        await a.changerReseau(horsLigne: true)
        _ = await a.noterIdee("Un clip en noir pour la boutique")
        _ = await a.noterDossier("Site vitrine", parent: "boutiques", nomParent: "Boutiques")
        let ids = a.tableau.capturesEnAttente.map(\.id)
        XCTAssertEqual(ids.count, 2)
        XCTAssertEqual(a.tableau.capturesEnAttente.last?.capture?.detail, "Projets, dans « Boutiques »")
        await a.changerReseau(horsLigne: false)
        neuf([
            "GET /api/dossiers": [(200, #"{"dossiers":[]}"#)],
            "PUT /api/dossiers/idees": [(200, #"{"ok":true,"id":"idees"}"#)],
            "POST /api/dossiers/idees/notes": [(200, #"{"ok":true}"#)],
            "PUT /api/dossiers/\(ids[1])": [(200, #"{"ok":true}"#)],
        ])
        await a.tableau.envoyerEnAttente()
        let note = try XCTUnwrap((FauxServeur.corps["POST /api/dossiers/idees/notes"]?["notes"] as? [[String: Any]])?.first)
        XCTAssertEqual(note["id"] as? String, ids[0], "la note porte l'identifiant de la capture")
        XCTAssertEqual(note["texte"] as? String, "Un clip en noir pour la boutique")
        XCTAssertTrue(FauxServeur.recues.contains("PUT /api/dossiers/idees"), "le dossier « Idées » créé au premier besoin")
        XCTAssertEqual(FauxServeur.corps["PUT /api/dossiers/\(ids[1])"]?["nom"] as? String, "Site vitrine")
        XCTAssertEqual(FauxServeur.corps["PUT /api/dossiers/\(ids[1])"]?["parent"] as? String, "boutiques")
        XCTAssertTrue(a.tableau.capturesEnAttente.isEmpty)
        XCTAssertEqual(a.toast, "Envoyé : 2 captures en attente (« Un clip en noir pour la boutique », « Site vitrine »).")
    }

    /// Une capture n'est pas une coche : les coches gardent leur fichier et
    /// leur compte, les deux files se relisent ensemble.
    func testCochesEtCapturesCohabitent() async throws {
        let coche = Commande(geste: .terminer(tache: "t1", titre: "Démo"))
        try rangement.garder([coche], le: Date(), Rangement.envoi)
        let capture = Commande(geste: .capture(CaptureFigee(genre: .tache, texte: "Envoyer le devis")))
        try rangement.garder([capture], le: Date(), Rangement.captures)
        neuf()
        let a = app()
        XCTAssertEqual(a.tableau.gestesEnAttente, 1)
        XCTAssertEqual(a.tableau.capturesEnAttente.map(\.id), [capture.id])
        XCTAssertEqual(a.tableau.cochees.map(\.id), ["t1"])
        a.tableau.retirerCapture(capture.id)
        XCTAssertTrue(existe("envoi.json"))
        XCTAssertFalse(existe("captures.json"))
        // Déconnexion : rien ne reste.
        a.tableau.vider()
        XCTAssertFalse(existe("envoi.json"))
    }

    /// Les captures dans leur fichier ne bloquent pas un build qui ne les
    /// connaît pas : le fichier des coches reste lisible tel quel.
    func testLeFichierDesCochesResteLisibleSansLesCaptures() throws {
        let capture = CaptureFigee(genre: .tache, texte: "Envoyer le devis", echeance: dimanche())
        let c = Commande(geste: .capture(capture))
        let d = try JSONEncoder().encode(c)
        let relue = try JSONDecoder().decode(Commande.self, from: d)
        XCTAssertEqual(relue, c)
        // Une commande d'avant le 25/10 (sans « raison ») se relit.
        let ancienne = #"{"id":"x","geste":{"terminer":{"tache":"t1","titre":"Démo"}},"creeLe":0,"partApres":0,"tentatives":0,"puisDefaire":false}"#
        XCTAssertNil(try JSONDecoder().decode(Commande.self, from: Data(ancienne.utf8)).raison)
    }
}
