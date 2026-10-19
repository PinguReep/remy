import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// J1.2 : ce que l'iPhone garde entre deux lancements (la journée, datée ; les
/// gestes pas encore envoyés) et le décodage qui ne perd jamais tout l'écran.
@MainActor
final class MagasinTests: XCTestCase {
    private nonisolated let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("remy-tests-" + UUID().uuidString)
    private var rangement: Rangement { Rangement(dossier: dossier) }
    private let version = #"{"api":1,"serveur":"0.2.0","capacites":["propositions-v1"]}"#
    private let applique = #"{"ledgerId":"L1","echecs":0,"etat":"appliquee","results":[{"ok":true,"type":"terminer","nom":"Démo"}]}"#

    private var journee: String {
        #"{"journee":{"jour":"\#(Format.jourISO(Date()))","items":[{"type":"tache","id":"t1","titre":"Démo","debut":1790152200000,"fin":1790155800000}],"aFaire":[{"id":"t2","titre":"Devis"}],"sources":{"motion":"ok","agenda":"ok"}}}"#
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: dossier)
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
    private func app() -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)),
                         rangement: rangement)
        a.api.rejeuSur = true // la tour du Lot 0 reconnaît une commande déjà reçue
        a.tableau.delaiAnnulation = 0
        return a
    }

    private func existe(_ nom: String) -> Bool {
        FileManager.default.fileExists(atPath: dossier.appendingPathComponent(nom).path)
    }

    // MARK: La journée gardée

    func testLaJourneeSeRelitHorsLigneAvecSaDate() async throws {
        neuf(["GET /api/dashboard": [(200, journee)]])
        let a = app()
        await a.tableau.charger()
        let le = try XCTUnwrap(a.tableau.misAJour)
        XCTAssertTrue(existe("journee.json"))

        // Relancée sans réseau : la journée est là tout de suite, avec SA date.
        neuf(coupures: ["GET /api/conversations": 1, "GET /api/dashboard": 1])
        let b = app()
        XCTAssertEqual(b.tableau.journee?.items?.first?.titre, "Démo")
        XCTAssertTrue(b.tableau.copieLocale)
        XCTAssertEqual(b.tableau.misAJour?.timeIntervalSince1970 ?? 0, le.timeIntervalSince1970, accuracy: 0.01)
        await b.demarrer()
        XCTAssertEqual(b.phase, .pret)
        XCTAssertTrue(b.tableau.erreurReseau, "le bandeau dira que Rémy est injoignable")
        XCTAssertEqual(b.tableau.journee?.items?.count, 1, "la copie reste affichée")
        XCTAssertTrue(b.tableau.copieLocale)
    }

    func testUneCopieAbimeeNeBloquePasLApp() throws {
        try FileManager.default.createDirectory(at: dossier, withIntermediateDirectories: true)
        try Data("{pas du json".utf8).write(to: dossier.appendingPathComponent("journee.json"))
        try Data("[]]".utf8).write(to: dossier.appendingPathComponent("envoi.json"))
        let a = app()
        XCTAssertNil(a.tableau.donnees)
        XCTAssertTrue(a.tableau.envoi.isEmpty)
    }

    // MARK: La file d'envoi

    func testLeGesteEstEcritAvantDePartir() async throws {
        neuf(["GET /api/dashboard": [(200, journee)], "POST /api/motion/apply": [(200, applique)]])
        let a = app()
        a.tableau.delaiAnnulation = 0.4
        await a.tableau.charger()
        let coche = Task { await a.tableau.terminer(id: "t1", titre: "Démo") }
        for _ in 0..<200 where a.tableau.cochees.isEmpty { try? await Task.sleep(nanoseconds: 2_000_000) }
        // Pendant le délai : rien n'est parti, mais le geste est déjà sur le disque.
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/motion/apply"))
        let surDisque = try XCTUnwrap(rangement.copie([Commande].self, Rangement.envoi)?.valeur)
        XCTAssertEqual(surDisque.map(\.geste), [.terminer(tache: "t1", titre: "Démo")])
        XCTAssertEqual(a.tableau.gestesEnAttente, 0, "pendant le délai, ce n'est pas « en attente du réseau »")
        let issue = await coche.value
        XCTAssertEqual(issue, .faite)
        XCTAssertEqual(FauxServeur.corps["POST /api/motion/apply"]?["idCommande"] as? String, surDisque.first?.id,
                       "la clé envoyée est celle écrite sur le disque")
        XCTAssertTrue(a.tableau.envoi.isEmpty)
        XCTAssertFalse(existe("envoi.json"), "reçue par la tour : plus rien sur l'iPhone")
    }

    func testAppFermeePendantLeDelaiLaCochePartAuLancement() async throws {
        // Ce que l'app laisse sur le disque si elle est tuée pendant les deux secondes.
        let c = Commande(geste: .terminer(tache: "t1", titre: "Démo"), creeLe: Date().addingTimeInterval(-60), delai: 2)
        try rangement.garder([c], le: Date(), Rangement.envoi)
        neuf([
            "GET /api/dashboard": [(200, journee)],
            "GET /api/version": [(200, version)],
            "POST /api/motion/apply": [(200, applique)],
        ])
        let a = app()
        XCTAssertEqual(a.tableau.cochees.map(\.id), ["t1"])
        XCTAssertEqual(a.tableau.cochees.first?.horsLigne, true)
        await a.chargerTout()
        XCTAssertEqual(FauxServeur.historique["POST /api/motion/apply"]?.count, 1)
        XCTAssertEqual(FauxServeur.corps["POST /api/motion/apply"]?["idCommande"] as? String, c.id)
        XCTAssertEqual(a.tableau.journee?.items?.count, 0, "la tâche cochée ne revient pas")
        XCTAssertEqual(a.tableau.cochees.first?.ledgerId, "L1")
        XCTAssertEqual(a.toast, "Envoyé : « Démo » est marqué fait.")
        XCTAssertFalse(existe("envoi.json"))
    }

    func testSansReseauLaCocheAttendPuisPartAvecLaMemeCle() async throws {
        neuf(["GET /api/dashboard": [(200, journee)]], coupures: ["POST /api/motion/apply": 2])
        let a = app()
        await a.tableau.charger()
        let issue = await a.tableau.terminer(id: "t1", titre: "Démo")
        XCTAssertEqual(issue, .enAttente)
        XCTAssertEqual(a.toast, "Pas de réseau : « Démo » partira dès que Rémy sera joignable.")
        XCTAssertEqual(a.tableau.journee?.items?.count, 0, "pas de succès affiché, pas de retour trompeur non plus")
        XCTAssertEqual(a.tableau.cochees.first?.horsLigne, true)
        XCTAssertEqual(a.tableau.gestesEnAttente, 1)
        XCTAssertEqual(a.tableau.envoi.first?.tentatives, 1)

        // Relancée plus tard, réseau revenu.
        neuf([
            "GET /api/dashboard": [(200, journee)],
            "GET /api/version": [(200, version)],
            "POST /api/motion/apply": [(200, applique)],
        ])
        let b = app()
        XCTAssertEqual(b.tableau.gestesEnAttente, 1)
        XCTAssertEqual(b.tableau.cochees.first?.horsLigne, true)
        b.phase = .pret
        await b.changerReseau(horsLigne: true)
        XCTAssertTrue(b.horsLigne)
        await b.changerReseau(horsLigne: false)
        XCTAssertEqual(FauxServeur.historique["POST /api/motion/apply"]?.count, 1)
        XCTAssertEqual(FauxServeur.corps["POST /api/motion/apply"]?["idCommande"] as? String,
                       a.tableau.envoi.first?.id, "la même clé : la tour ne refait rien si la première était arrivée")
        XCTAssertEqual(b.tableau.gestesEnAttente, 0)
        XCTAssertEqual(b.tableau.cochees.first?.horsLigne, false)
        XCTAssertEqual(b.tableau.cochees.first?.ledgerId, "L1")
    }

    /// Lancée sans réseau : l'app ne peut pas demander à la tour ce qu'elle sait
    /// faire. Elle s'en souvient, et garde la coche au lieu de l'abandonner.
    func testHorsLigneDesLeLancementLaCocheEstGardee() async {
        neuf(["GET /api/dashboard": [(200, journee)], "GET /api/version": [(200, version)]])
        let a = app()
        a.api.rejeuSur = false
        await a.chargerTout()
        XCTAssertTrue(a.api.rejeuSur)

        neuf(coupures: ["GET /api/conversations": 1, "GET /api/dashboard": 1, "GET /api/version": 1,
                        "POST /api/motion/apply": 2])
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        let b = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)),
                         rangement: rangement)
        b.tableau.delaiAnnulation = 0
        XCTAssertTrue(b.api.rejeuSur, "relu sur l'iPhone, sans la tour")
        await b.demarrer()
        let issue = await b.tableau.terminer(id: "t1", titre: "Démo")
        XCTAssertEqual(issue, .enAttente)
        XCTAssertEqual(b.tableau.gestesEnAttente, 1)
    }

    func testRepriseSansReseauNeRepetePasLeMessage() async {
        neuf(["GET /api/dashboard": [(200, journee)]], coupures: ["POST /api/motion/apply": 4])
        let a = app()
        await a.tableau.charger()
        _ = await a.tableau.terminer(id: "t1", titre: "Démo")
        a.message = nil
        await a.tableau.envoyerEnAttente()
        XCTAssertNil(a.message, "l'essai automatique échoue en silence : le bandeau le dit déjà")
        XCTAssertEqual(a.tableau.envoi.first?.tentatives, 2)
    }

    func testAnnulerUnGesteJamaisPartiLeRetireDuDisque() async throws {
        let c = Commande(geste: .terminer(tache: "t1", titre: "Démo"))
        try rangement.garder([c], le: Date(), Rangement.envoi)
        neuf()
        let a = app()
        a.tableau.renoncer("t1")
        XCTAssertTrue(a.tableau.cochees.isEmpty)
        XCTAssertTrue(a.tableau.envoi.isEmpty)
        XCTAssertFalse(existe("envoi.json"))
        await a.tableau.envoyerEnAttente()
        XCTAssertTrue(FauxServeur.recues.isEmpty, "la tour n'en saura rien")
    }

    func testAnnulerUnGestePeutEtreArriveLeDefaitAuRetour() async throws {
        neuf(["GET /api/dashboard": [(200, journee)]], coupures: ["POST /api/motion/apply": 2])
        let a = app()
        await a.tableau.charger()
        _ = await a.tableau.terminer(id: "t1", titre: "Démo")
        a.tableau.renoncer("t1")
        XCTAssertEqual(a.toast, "« Démo » sera rouverte dès que Rémy sera joignable.")
        XCTAssertEqual(a.tableau.envoi.first?.puisDefaire, true)

        neuf([
            "GET /api/dashboard": [(200, journee)],
            "POST /api/motion/apply": [(200, applique)],
            "POST /api/motion/undo": [(200, #"{"ok":true,"undone":[{"ok":true,"nom":"Démo"}]}"#)],
        ])
        let b = app()
        await b.tableau.envoyerEnAttente()
        XCTAssertTrue(FauxServeur.recues.contains("POST /api/motion/apply"))
        XCTAssertTrue(FauxServeur.recues.contains("POST /api/motion/undo"))
        XCTAssertTrue(b.tableau.cochees.isEmpty)
        XCTAssertEqual(b.toast, "Annulé : « Démo » est de retour.")
        XCTAssertTrue(b.tableau.envoi.isEmpty)
    }

    func testRefusDeMotionALaRepriseLaTacheRevient() async throws {
        let c = Commande(geste: .terminer(tache: "t1", titre: "Démo"))
        try rangement.garder([c], le: Date(), Rangement.envoi)
        neuf([
            "GET /api/dashboard": [(200, journee)],
            "POST /api/motion/apply": [(200, #"{"echecs":1,"results":[{"ok":false,"nom":"Démo","erreur":"tâche introuvable"}]}"#)],
        ])
        let a = app()
        await a.tableau.charger()
        await a.tableau.envoyerEnAttente()
        XCTAssertTrue(a.tableau.cochees.isEmpty)
        XCTAssertEqual(a.tableau.journee?.items?.count, 1)
        XCTAssertEqual(a.toast, "Motion n'a pas pu marquer « Démo » comme fait : tâche introuvable.")
        XCTAssertFalse(existe("envoi.json"))
    }

    // MARK: Rien ne reste

    func testDeconnexionEffaceToutDeLIPhone() async throws {
        neuf(["GET /api/dashboard": [(200, journee)]], coupures: ["POST /api/motion/apply": 2])
        let a = app()
        await a.tableau.charger()
        _ = await a.tableau.terminer(id: "t1", titre: "Démo")
        XCTAssertTrue(existe("journee.json"))
        XCTAssertTrue(existe("envoi.json"))
        await a.deconnecter()
        XCTAssertFalse(existe("journee.json"))
        XCTAssertFalse(existe("envoi.json"))
        XCTAssertFalse(existe("serveur.json"))
        XCTAssertNil(app().tableau.donnees)
    }

    func testAppareilPlusReconnuEffaceToutDeLIPhone() async {
        neuf(["GET /api/dashboard": [(200, journee)]])
        await app().tableau.charger()
        XCTAssertTrue(existe("journee.json"))
        neuf(["GET /api/conversations": [(401, #"{"error":"auth"}"#)]])
        let b = app()
        await b.demarrer()
        XCTAssertEqual(b.phase, .connexion)
        XCTAssertNil(b.tableau.donnees)
        XCTAssertFalse(existe("journee.json"))
    }

    // MARK: Décodage tolérant

    func testUnElementIllisibleNeFaitPasPerdreLaJournee() throws {
        let json = #"""
        {"journee":{"jour":"2026-10-15","items":[
          {"type":"tache","id":"t1","titre":"Démo","debut":1790152200000},
          {"type":"tache","id":"t2","debut":1790155800000}],
          "retard":{"items":[{"id":"t3","titre":"Relancer"},{"id":"t4"}]},
          "sources":{"motion":"ok"}},
         "couts":{"aujourdhui":0.1,"jours7":0.2,"jours30":0.3}}
        """#
        let t = try JSONDecoder().decode(TableauDeBord.self, from: Data(json.utf8))
        XCTAssertEqual(t.journee?.items?.map(\.id), ["t1"])
        XCTAssertEqual(t.journee?.retard?.items.map(\.id), ["t3"])
        XCTAssertEqual(t.journee?.retard?.total, 1, "sans total, on compte ce qu'on a")
        XCTAssertEqual(t.journee?.sources?.motion, "ok")
        XCTAssertEqual(t.couts?.jours30, 0.3)
        XCTAssertEqual(t.partiesIllisibles, ["journee.items (1)"])
    }

    func testUneSectionIllisibleEstMiseDeCote() throws {
        let json = #"""
        {"journee":{"jour":"2026-10-15","items":[{"type":"tache","id":"t1","titre":"Démo","debut":1790152200000}]},
         "activite":"oups", "memoire":{"mots":"beaucoup"},
         "briefing":{"text":"a","items":[{"id":"s1","texte":"x","etat":"ouvert"},{"id":"s2"}]}}
        """#
        let t = try JSONDecoder().decode(TableauDeBord.self, from: Data(json.utf8))
        XCTAssertEqual(t.journee?.items?.count, 1)
        XCTAssertNil(t.activite)
        XCTAssertNil(t.memoire)
        XCTAssertEqual(t.briefing?.items?.map(\.id), ["s1"])
        XCTAssertEqual(t.partiesIllisibles, ["activite", "memoire", "briefing.items (1)"])
    }

    func testLaCopieGardeTout() throws {
        let t = try JSONDecoder().decode(TableauDeBord.self, from: Data(journee.utf8))
        try rangement.garder(t, le: Date(), Rangement.journee)
        let relue = try XCTUnwrap(rangement.copie(TableauDeBord.self, Rangement.journee))
        XCTAssertEqual(relue.valeur, t)
        XCTAssertTrue(relue.valeur.partiesIllisibles.isEmpty)
    }

    // MARK: Le bandeau

    func testDepuisQuandDateLaJournee() {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = Format.fuseau
        let maintenant = c.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 10, minute: 50))!
        let ce = c.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 10, minute: 40))!
        let hier = c.date(from: DateComponents(year: 2026, month: 10, day: 14, hour: 18, minute: 2))!
        let avant = c.date(from: DateComponents(year: 2026, month: 10, day: 13, hour: 18, minute: 2))!
        XCTAssertEqual(Format.depuis(ce, maintenant: maintenant), "de 10:40")
        XCTAssertEqual(Format.depuis(hier, maintenant: maintenant), "d'hier, 18:02")
        XCTAssertEqual(Format.depuis(avant, maintenant: maintenant), "du 13 oct., 18:02")
        XCTAssertEqual(Format.jourMois(maintenant), "15 octobre")
        XCTAssertEqual(Format.jourSemaine(maintenant), "jeudi")
        XCTAssertEqual(Format.jourMois(c.date(from: DateComponents(year: 2026, month: 11, day: 1, hour: 9))!), "1er novembre")
    }
}
