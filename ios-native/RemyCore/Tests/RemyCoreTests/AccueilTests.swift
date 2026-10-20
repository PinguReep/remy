import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// L'accueil de la direction A (Lot 1) : conseil du moment, prolongation et
/// son effet estimé, capture, projets.
@MainActor
final class AccueilTests: XCTestCase {
    // Jeudi 15 octobre 2026, 10:40 à Paris.
    private let maintenant: Millis = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = Format.fuseau
        return c.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 10, minute: 40))!.millis
    }()
    private func h(_ heure: Int, _ minute: Int = 0) -> Millis {
        let ecart: Int = heure * 60 + minute - 640 // minutes depuis 10:40
        return maintenant + Double(ecart) * 60_000
    }

    private var maquette: ElementJour {
        ElementJour(type: "tache", id: "t1", titre: "Maquette du site", debut: h(10, 15), fin: h(11, 30), duree: 75)
    }
    private var dejeuner: ElementJour {
        ElementJour(type: "rdv", id: "e1", titre: "Déjeuner avec Léa", lieu: "Chez Paulette", debut: h(12), fin: h(13, 15))
    }
    private var prospection: ElementJour {
        ElementJour(type: "tache", id: "t2", titre: "Prospection", debut: h(13, 45), fin: h(15, 15), duree: 90)
    }
    private func jour(_ items: [ElementJour], aFaire: [TacheResume] = [], retard: Retard? = nil) -> Journee {
        Journee(jour: "2026-10-15", items: items, aFaire: aFaire, retard: retard, sources: Sources(motion: "ok", agenda: "ok"))
    }

    // MARK: Conseil du moment

    func testConseilPendantUneTache() {
        let c = Conseil.du(jour([maquette, dejeuner]), maintenant: maintenant)
        XCTAssertEqual(c, "Il te reste 50 min sur « Maquette du site ». Ensuite : « Déjeuner avec Léa » à 12:00 (Chez Paulette).")
    }

    func testConseilPrevientQuandUnRendezVousCoupeLaTache() {
        var tard = maquette
        tard.fin = h(12, 20)
        let c = Conseil.du(jour([tard, dejeuner]), maintenant: maintenant)
        XCTAssertEqual(c, "Il te reste 1 h 40 sur « Maquette du site ». Attention : « Déjeuner avec Léa » commence à 12:00, avant la fin prévue.")
    }

    func testConseilDuTempsLibre() {
        let c = Conseil.du(jour([dejeuner], aFaire: [TacheResume(id: "a", titre: "Appeler l'assurance", priorite: "HIGH")]), maintenant: maintenant)
        XCTAssertEqual(c, "1 h 20 devant toi avant « Déjeuner avec Léa » (12:00). De quoi avancer « Appeler l'assurance ».")
    }

    /// Sam, TestFlight 13 : « Tu as 44 minutes, avance sur ta douche ». Une
    /// tâche ordinaire (sans priorité ni heure) n'est plus proposée dans un trou.
    func testConseilNeProposePlusNImporteQuoiDansUnTrou() {
        let douche = TacheResume(id: "d", titre: "Prendre une douche")
        let c = Conseil.pour(.maintenant, jour([dejeuner], aFaire: [douche]), maintenant: maintenant)
        XCTAssertEqual(c?.texte, "1 h 20 devant toi avant « Déjeuner avec Léa » à 12:00 (Chez Paulette).")
        XCTAssertEqual(c?.pourquoi, ["1 h 20 avant le prochain élément"])
        let libre = Conseil.pour(.libre, jour([dejeuner], aFaire: [douche]), maintenant: maintenant)
        XCTAssertEqual(libre?.texte, "1 h 20 de libre avant « Déjeuner avec Léa » (12:00).")
    }

    func testLesQuatreTypesDeConseil() {
        let urgent = TacheResume(id: "u", titre: "Relancer le comptable", priorite: "ASAP")
        let r = Retard(total: 2, items: [TacheResume(id: "x", titre: "Envoyer le devis")])
        let j = jour([maquette, dejeuner], aFaire: [urgent], retard: r)
        XCTAssertEqual(Conseil.pour(.prochaine, j, maintenant: maintenant)?.texte,
                       "Prochain : « Déjeuner avec Léa » à 12:00 (Chez Paulette), dans 1 h 20.")
        XCTAssertEqual(Conseil.pour(.libre, j, maintenant: maintenant)?.texte,
                       "30 min de libre avant « Déjeuner avec Léa » (12:00). De quoi avancer « Relancer le comptable ».")
        XCTAssertEqual(Conseil.pour(.priorites, j, maintenant: maintenant)?.texte,
                       "D'abord « Relancer le comptable ». 2 en retard : commence par « Envoyer le devis ».")
        XCTAssertFalse(Conseil.pour(.maintenant, j, maintenant: maintenant)?.pourquoi.isEmpty ?? true)
    }

    func testConseilFinDeJournee() {
        let r = Retard(total: 2, items: [TacheResume(id: "x", titre: "Relancer le comptable")])
        XCTAssertEqual(Conseil.du(jour([], retard: r), maintenant: maintenant),
                       "Journée dégagée. 2 tâches en retard : commence par « Relancer le comptable ».")
        XCTAssertEqual(Conseil.du(jour([]), maintenant: maintenant), "Plus rien de prévu aujourd'hui.")
    }

    func testConseilNeProposePasUneTacheBloquee() {
        let bloquee = TacheResume(id: "a", titre: "Facture Ondine", bloquee: true, raison: "J'attends le bon")
        let libre = TacheResume(id: "b", titre: "Appeler l'assurance", priorite: "HIGH")
        XCTAssertEqual(Conseil.du(jour([dejeuner], aFaire: [bloquee, libre]), maintenant: maintenant),
                       "1 h 20 devant toi avant « Déjeuner avec Léa » (12:00). De quoi avancer « Appeler l'assurance ».")
        XCTAssertEqual(Conseil.du(jour([], aFaire: [bloquee]), maintenant: maintenant), "Plus rien de prévu aujourd'hui.")
        let r = Retard(total: 2, items: [TacheResume(id: "x", titre: "Relancer le comptable", bloquee: true),
                                         TacheResume(id: "y", titre: "Envoyer le devis")])
        XCTAssertEqual(Conseil.du(jour([], retard: r), maintenant: maintenant),
                       "Journée dégagée. 2 tâches en retard : commence par « Envoyer le devis ».")
    }

    func testPasDeConseilSansSource() {
        XCTAssertNil(Conseil.du(Journee(sources: Sources()), maintenant: maintenant))
        XCTAssertNil(Conseil.du(nil, maintenant: maintenant))
    }

    // MARK: Prolonger

    func testImpactSurUnRendezVousFixe() {
        let i = ImpactProlongation.de(maquette, minutes: 40, journee: jour([maquette, dejeuner, prospection]))
        XCTAssertEqual(i.conflit?.id, "e1")
        XCTAssertEqual(i.retard, 10)
        XCTAssertEqual(i.phrase, "Fin à 12:10 : tu arriverais à « Déjeuner avec Léa » 10 min en retard. C'est un rendez-vous fixe.")
    }

    /// RÉGRESSION (captures du 15/10) : le déjeuner commençait AVANT la fin
    /// actuelle de la tâche ; « +15 » disait « aucun rendez-vous touché ».
    func testImpactQuandLeRendezVousCoupeDejaLaTache() {
        var tard = maquette
        tard.fin = h(12, 10)
        let i = ImpactProlongation.de(tard, minutes: 15, journee: jour([tard, dejeuner, prospection]))
        XCTAssertEqual(i.conflit?.id, "e1")
        XCTAssertEqual(i.retard, 25)
        XCTAssertEqual(i.phrase, "Fin à 12:25 : tu arriverais à « Déjeuner avec Léa » 25 min en retard. C'est un rendez-vous fixe.")
    }

    func testImpactSansRendezVousTouche() {
        let i = ImpactProlongation.de(maquette, minutes: 15, journee: jour([maquette, dejeuner, prospection]))
        XCTAssertNil(i.conflit)
        XCTAssertEqual(i.tachesDecalees, 1)
        XCTAssertEqual(i.phrase, "Fin à 11:45. Aucun rendez-vous touché ; Motion décalera la tâche suivante.")
    }

    func testDeuxElementsQuiSeChevauchentSontCoteACote() {
        let appel = ElementJour(type: "rdv", id: "e2", titre: "Appel", debut: h(11), fin: h(11, 15))
        let p = Couloirs.de([maquette, appel, dejeuner])
        XCTAssertEqual(p["tache:t1"], Couloirs.Place(index: 0, total: 2))
        XCTAssertEqual(p["rdv:e2"], Couloirs.Place(index: 1, total: 2))
        XCTAssertEqual(p["rdv:e1"], Couloirs.Place(index: 0, total: 1), "le déjeuner ne chevauche rien")
    }

    func testDureeTotaleDeReference() {
        XCTAssertEqual(maquette.dureeTotale, 75, "la durée Motion")
        let sansDuree = ElementJour(type: "tache", id: "t", titre: "T", debut: h(10), fin: h(10, 45))
        XCTAssertEqual(sansDuree.dureeTotale, 45, "à défaut, celle du créneau")
    }

    private func app() -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.historique = [:]
        FauxServeur.coupures = [:]
        return AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
    }

    func testProlongerEnvoieLaDureeAbsolue() async throws {
        FauxServeur.reponses = [
            "GET /api/dashboard": [(200, "{}")],
            "POST /api/motion/apply": [(200, #"{"ledgerId":"L5","echecs":0,"results":[{"ok":true,"type":"modifier","nom":"Maquette du site"}]}"#)],
        ]
        let a = app()
        let ok = await a.tableau.prolonger(maquette, de: 15)
        XCTAssertTrue(ok)
        let action = try XCTUnwrap((FauxServeur.corps["POST /api/motion/apply"]?["actions"] as? [[String: Any]])?.first)
        XCTAssertEqual(action["type"] as? String, "modifier")
        XCTAssertEqual(action["id"] as? String, "t1")
        XCTAssertEqual(action["duree"] as? Double, 90, "75 + 15 : rejouée, la commande ne rallonge pas deux fois")
        XCTAssertNotNil(FauxServeur.corps["POST /api/motion/apply"]?["idCommande"])
        XCTAssertEqual(a.toast, "« Maquette du site » : +15 min. Motion recalcule la suite.")
        XCTAssertNotNil(a.message?.annuler)
    }

    func testProlongerSansDureeLeDitSansRienEnvoyer() async {
        FauxServeur.reponses = [:]
        let a = app()
        let ok = await a.tableau.prolonger(ElementJour(type: "tache", id: "t", titre: "Sans durée", debut: h(10)), de: 15)
        XCTAssertFalse(ok)
        XCTAssertTrue(FauxServeur.recues.isEmpty)
        XCTAssertEqual(a.toast, "Motion ne donne pas de durée pour « Sans durée » : impossible de la prolonger d'ici.")
    }

    func testProlongerSansReseauLeDit() async {
        FauxServeur.reponses = [:]
        let a = app()
        FauxServeur.coupures = ["POST /api/motion/apply": 1]
        defer { FauxServeur.coupures = [:] }
        let ok = await a.tableau.prolonger(maquette, de: 15)
        XCTAssertFalse(ok)
        XCTAssertEqual(a.toast, "Pas de réseau : « Maquette du site » n'a pas été prolongée.")
    }

    // MARK: Capture

    func testGenreDevine() {
        XCTAssertEqual(GenreCapture.deviner("Appeler le garage"), .tache)
        XCTAssertEqual(GenreCapture.deviner("Qu'est-ce que j'ai cet après-midi"), .question)
        XCTAssertEqual(GenreCapture.deviner("On mange où ce soir ?"), .question)
        XCTAssertEqual(GenreCapture.deviner(String(repeating: "Une longue idée à garder. ", count: 6)), .retenir)
    }

    func testNoterUneTacheVaDansMotion() async throws {
        FauxServeur.reponses = [
            "GET /api/dashboard": [(200, "{}")],
            "POST /api/motion/apply": [(200, #"{"ledgerId":"L6","echecs":0,"results":[{"ok":true,"type":"creer","nom":"Appeler le garage"}]}"#)],
        ]
        let a = app()
        let ok = await a.noterTache("  Appeler le garage ")
        XCTAssertTrue(ok)
        let action = try XCTUnwrap((FauxServeur.corps["POST /api/motion/apply"]?["actions"] as? [[String: Any]])?.first)
        XCTAssertEqual(action["type"] as? String, "creer")
        XCTAssertEqual(action["nom"] as? String, "Appeler le garage")
        XCTAssertEqual(a.toast, "Ajoutée à Motion : « Appeler le garage ». Il lui trouve un créneau.")
    }

    func testRetenirDepuisLePlus() async throws {
        FauxServeur.reponses = ["POST /api/capture": [(200, #"{"ajouts":["Sam veut un studio à Porto"],"memoire":true}"#)]]
        let a = app()
        let court = await a.retenirNote("Studio")
        XCTAssertFalse(court)
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/capture"))
        let ok = await a.retenirNote("J'aimerais un petit studio à Porto pour écrire l'hiver prochain.")
        XCTAssertTrue(ok)
        XCTAssertEqual(FauxServeur.corps["POST /api/capture"]?["source"] as? String, "note")
        XCTAssertEqual(a.toast, "Retenu : Sam veut un studio à Porto")
    }

    func testDoublonRefuseLeDit() async {
        FauxServeur.reponses = [
            "POST /api/motion/apply": [(200, #"{"echecs":1,"results":[{"ok":false,"type":"creer","nom":"Appeler","erreur":"« Appeler » existe déjà dans Motion — rien n'a été créé"}]}"#)],
        ]
        let a = app()
        let ok = await a.noterTache("Appeler")
        XCTAssertFalse(ok)
        XCTAssertEqual(a.toast, "Pas ajouté à Motion : « Appeler » existe déjà dans Motion — rien n'a été créé.")
    }

    // MARK: Projets

    func testProjetsSeulementSiLaTourSait() async {
        FauxServeur.reponses = ["GET /api/projets": [(200, #"{"projets":[]}"#)]]
        let a = app()
        await a.projets.charger()
        XCTAssertFalse(FauxServeur.recues.contains("GET /api/projets"), "une tour d'avant le Lot 1 n'a pas la route")
        a.serveur = VersionServeur(api: 1, serveur: "0.3.0", capacites: ["projets-v1"])
        await a.projets.charger()
        XCTAssertTrue(FauxServeur.recues.contains("GET /api/projets"))
    }

    func testProjetsGardesHorsLigne() async throws {
        let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("remy-projets-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dossier) }
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        let session = URLSession(configuration: conf)
        FauxServeur.coupures = [:]
        FauxServeur.reponses = ["GET /api/projets": [(200, #"""
        {"projets":[{"id":"p1","nom":"Album « Été »","statut":"En cours","taches":2,"enRetard":0,
          "prochaine":{"id":"a","titre":"Retouche des photos","echeance":1792080000000}},
          {"id":"p2","taches":"beaucoup"}],"sansProjet":1,"motion":true}
        """#)]]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: session), rangement: Rangement(dossier: dossier))
        a.serveur = VersionServeur(api: 1, serveur: "0.3.0", capacites: ["projets-v1"])
        await a.projets.charger()
        XCTAssertEqual(a.projets.liste?.projets.map(\.nom), ["Album « Été »"], "le projet illisible est sauté")
        XCTAssertEqual(a.projets.liste?.projets.first?.prochaine?.titre, "Retouche des photos")

        let b = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: session), rangement: Rangement(dossier: dossier))
        XCTAssertEqual(b.projets.liste?.projets.count, 1, "relus sur l'iPhone, sans la tour")
        XCTAssertNotNil(b.projets.misAJour)
        await b.deconnecter()
        XCTAssertFalse(FileManager.default.fileExists(atPath: dossier.appendingPathComponent("projets.json").path))
    }
}
