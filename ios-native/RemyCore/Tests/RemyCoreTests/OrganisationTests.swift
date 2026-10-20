import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// P2/P3 (retours TestFlight 13, MVP) : capture à plusieurs intentions rangée
/// après validation, étiquette devinée, projet depuis « + ».
@MainActor
final class OrganisationTests: XCTestCase {
    private let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("remy-orga-" + UUID().uuidString)

    override func tearDown() {
        try? FileManager.default.removeItem(at: dossier)
        FauxServeur.reponses = [:]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.historique = [:]
    }

    private func app() -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)),
                         rangement: Rangement(dossier: dossier))
        a.serveur = VersionServeur(api: 1, serveur: "0.4.0", capacites: ["dossiers-v1", "etiquettes-v1"])
        return a
    }

    func testPlusieursIntentionsReconnues() {
        XCTAssertTrue(GenreCapture.plusieursIntentions("Soirée chez Yanis jeudi, dispo seulement le matin samedi, deux heures de studio dimanche à La Roseraie et la lessive avant"))
        XCTAssertFalse(GenreCapture.plusieursIntentions("tomates, lait d'avoine et œufs"), "une liste d'articles n'en est pas")
        XCTAssertFalse(GenreCapture.plusieursIntentions("Appeler le garage pour la révision demain"))
    }

    func testProjetDepuisLePlus() {
        XCTAssertEqual(GenreCapture.deviner("Nouveau projet location de vans"), .projet)
        let p = GenreCapture.projet("sous-projet étudier ElevenLabs dans « Boutique de bougies »")
        XCTAssertEqual(p.titre, "Étudier ElevenLabs")
        XCTAssertEqual(p.parent, "Boutique de bougies")
        let q = GenreCapture.projet("Projet : Corail")
        XCTAssertEqual(q.titre, "Corail")
        XCTAssertNil(q.parent)
        // Sans guillemets : seulement le nom d'un projet qui existe.
        let r = GenreCapture.projet("Nouveau projet : Recrutement sous ceramique", parents: ["Voyage", "Céramique"])
        XCTAssertEqual(r.titre, "Recrutement")
        XCTAssertEqual(r.parent, "Céramique")
        let s = GenreCapture.projet("Projet rangement sous l'escalier", parents: ["Boutiques"])
        XCTAssertEqual(s.titre, "Rangement sous l'escalier", "un « sous » ordinaire reste dans le titre")
        XCTAssertNil(s.parent)
    }

    func testEtiquetteDevinee() {
        let e = [Etiquette(id: "v", nom: "Voiture"), Etiquette(id: "s", nom: "Santé")]
        XCTAssertEqual(EtiquetteDevinee.pour("Contrôle technique de la Twingo", parmi: e)?.id, "v")
        XCTAssertEqual(EtiquetteDevinee.pour("Renouveler l'ordonnance", parmi: e)?.id, "s")
        XCTAssertNil(EtiquetteDevinee.pour("Payer le loyer", parmi: e), "« Administratif » n'existe pas chez Sam : rien")
    }

    func testRecapitulatifDitOuVaChaqueElement() {
        let rdv = ElementCapture(cle: "a", nature: "rendez-vous", titre: "Soirée chez Yanis", quand: nil, heureConnue: false, question: "À quelle heure ?")
        XCTAssertFalse(rdv.pret, "sans heure, pas de créneau inventé")
        XCTAssertEqual(rdv.destination(agenda: true), "Rendez-vous : heure manquante")
        let c = ElementCapture(cle: "b", nature: "contrainte", titre: "Dispo limitée samedi", quand: Date(timeIntervalSince1970: 1_792_828_800).millis, heureConnue: false)
        XCTAssertTrue(c.destination(agenda: true).hasSuffix("(pas de créneau bloqué)"))
        XCTAssertTrue(c.pret)
    }

    func testRangerUneCaptureValidee() async throws {
        let a = app()
        FauxServeur.reponses = [
            "POST /api/motion/apply": [(200, #"{"ok":true,"results":[{"ok":true,"type":"creer","nom":"Faire la lessive"}],"ledgerId":"j1","echecs":0}"#)],
            "POST /api/google/apply": [(200, #"{"ok":true,"results":[{"ok":true,"type":"creer","titre":"Studio"}],"ledgerId":"j2","echecs":0}"#)],
            "PUT /api/dossiers/notes": [(200, #"{"ok":true,"id":"notes"}"#)],
            "POST /api/dossiers/notes/notes": [(200, #"{"ok":true}"#)],
            "GET /api/dashboard": [(200, #"{"journee":{"items":[]}}"#)],
        ]
        a.tableau.donnees = TableauDeBord(systeme: Systeme(motion: true, agenda: true))
        let samedi = Date(timeIntervalSince1970: 1_792_828_800).millis
        let elements = [
            ElementCapture(cle: "1", nature: "tache", titre: "Faire la lessive", quand: samedi, heureConnue: false, dureeMin: 30),
            ElementCapture(cle: "2", nature: "contrainte", titre: "Dispo limitée samedi", quand: samedi, heureConnue: false),
            ElementCapture(cle: "3", nature: "rendez-vous", titre: "Studio", quand: samedi + 5 * 3_600_000, heureConnue: true, dureeMin: 120),
            ElementCapture(cle: "4", nature: "rendez-vous", titre: "Soirée chez Yanis", quand: nil, heureConnue: false),
            ElementCapture(cle: "5", nature: "liste", titre: "Courses", liste: "Courses", articles: ["tomates", "lait"]),
            ElementCapture(cle: "6", nature: "note", titre: "Le code du portail est 1234"),
        ]
        let bilan = await a.ranger(elements)
        XCTAssertEqual(bilan.faits.count, 5, bilan.phrase)
        XCTAssertEqual(bilan.echecs, ["« Soirée chez Yanis » : heure manquante"])
        // La tâche part avec son échéance et sa durée, marquée « capture » (historique).
        let motion = try XCTUnwrap(FauxServeur.corps["POST /api/motion/apply"])
        XCTAssertEqual(motion["origine"] as? String, "capture")
        let action = try XCTUnwrap((motion["actions"] as? [[String: Any]])?.first)
        XCTAssertEqual(action["nom"] as? String, "Faire la lessive")
        XCTAssertNotNil(action["echeance"])
        XCTAssertEqual(action["duree"] as? Double, 30)
        // Le rendez-vous à heure connue va dans l'agenda, avec sa durée.
        let agenda = try XCTUnwrap((FauxServeur.corps["POST /api/google/apply"]?["actions"] as? [[String: Any]])?.first)
        XCTAssertEqual(agenda["duree"] as? Double, 120)
        // La contrainte devient un rappel ce jour-là (pas un créneau), la liste reçoit ses articles.
        XCTAssertTrue(a.carnet.rappels.contains { $0.texte == "Dispo limitée samedi" && $0.quand == samedi })
        XCTAssertEqual(a.carnet.listes.first?.elements.map(\.texte), ["tomates", "lait"])
        XCTAssertEqual(a.organisation.dossiers.first { $0.id == "notes" }?.notes.map(\.texte), ["Le code du portail est 1234"])
        XCTAssertEqual(FauxServeur.recues.filter { $0 == "POST /api/motion/apply" }.count, 1, "rien en double")
    }

    func testParentSuggerePourUnProjet() {
        let a = app()
        let o = a.organisation
        XCTAssertNil(a.parentPour("Inconnu"))
        XCTAssertNil(o.suggestion(pour: "Étudier ElevenLabs", projets: []))
        let projets = [Projet(id: "p1", nom: "Boutiques", taches: 3)]
        XCTAssertEqual(o.suggestion(pour: "Comparer les voix des boutiques", projets: projets)?.id, "motion:p1")
    }
}
