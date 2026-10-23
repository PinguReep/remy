import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// 24/10, ergonomie de l'iPhone : décaler en un toucher, reporter un rappel
/// (feuille et notification), accepter une partie d'une proposition.
final class ErgonomieTests: XCTestCase {
    private var cal: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = Format.fuseau
        return c
    }
    private func date(_ j: Int, _ m: Int, _ h: Int, _ mi: Int = 0) -> Date {
        cal.date(from: DateComponents(year: 2026, month: m, day: j, hour: h, minute: mi))!
    }
    // Vendredi 23 octobre 2026, 14:07 à Paris.
    private var vendredi: Date { date(23, 10, 14, 7) }

    // MARK: Décaler une tâche (échéance seulement : Motion choisit l'heure)

    func testUneTacheSeDecaleADemainOuLundi() {
        let c = Decaler.tache(echeance: date(23, 10, 23).millis, maintenant: vendredi)
        XCTAssertEqual(c.map(\.libelle), ["Demain", "Lundi"])
        XCTAssertEqual(c[0].date, date(24, 10, 23), "échéance en fin de journée, comme « Replanifier »")
        XCTAssertEqual(c[1].date, date(26, 10, 23))
    }

    func testUneTacheEnRetardPeutRevenirAujourdhui() {
        let c = Decaler.tache(echeance: date(20, 10, 18).millis, maintenant: vendredi)
        XCTAssertEqual(c.map(\.id), ["aujourdhui", "demain", "lundi"])
        XCTAssertEqual(c[0].date, date(23, 10, 23))
    }

    func testLeDimancheLundiEstDemain() {
        let dimanche = date(25, 10, 10)
        XCTAssertEqual(Decaler.tache(echeance: nil, maintenant: dimanche).map(\.libelle), ["Demain", "Dans 1 sem."])
        XCTAssertEqual(Decaler.joursJusquaLundi(date(26, 10, 9)), 7, "un lundi : le suivant")
    }

    // MARK: Décaler une activité (à l'heure)

    func testUneActiviteSeDecaleAuQuartDHeure() {
        let e = ElementJour(type: "rdv", id: "a1", titre: "Aspirateur", debut: date(23, 10, 15, 0).millis, fin: date(23, 10, 15, 45).millis)
        let c = Decaler.activite(e, maintenant: vendredi)
        XCTAssertEqual(c.map(\.libelle), ["+15 min", "+1 h", "Ce soir", "Demain"])
        XCTAssertEqual(c[0].date, date(23, 10, 15, 15))
        XCTAssertEqual(c[2].date, date(23, 10, 19))
        XCTAssertEqual(c[3].date, date(24, 10, 15))
    }

    func testUneActiviteCommenceeSeDecaleDepuisMaintenant() {
        let e = ElementJour(type: "rdv", id: "a1", titre: "Aspirateur", debut: date(23, 10, 13, 30).millis, fin: date(23, 10, 14, 30).millis)
        let c = Decaler.activite(e, maintenant: vendredi)
        XCTAssertEqual(c[0].date, date(23, 10, 14, 15), "14:07 + 15 min, arrondi au quart d'heure")
    }

    func testLeSoirOnNeProposePlusCeSoir() {
        let e = ElementJour(type: "rdv", id: "a1", titre: "Lessive", debut: date(23, 10, 18, 30).millis)
        XCTAssertFalse(Decaler.activite(e, maintenant: date(23, 10, 18, 0)).contains { $0.id == "ce-soir" })
    }

    // MARK: Reporter un rappel

    func testReporterUnRappel() {
        let c = Decaler.rappel(maintenant: vendredi)
        XCTAssertEqual(c.map(\.libelle), ["Dans 1 h", "Ce soir 19:00", "Demain 9:00", "Lundi 9:00"])
        XCTAssertEqual(c[0].date, date(23, 10, 15, 0))
        XCTAssertEqual(c[2].date, date(24, 10, 9))
        XCTAssertEqual(c[3].date, date(26, 10, 9))
        // Après 18 h, plus de « ce soir » ; le dimanche, lundi est déjà « demain ».
        XCTAssertEqual(Decaler.rappel(maintenant: date(25, 10, 20)).map(\.id), ["plus-60", "demain"])
    }

    func testLesActionsDeLaNotification() {
        XCTAssertEqual(ActionRappel.rappel(dansNotification: "rappel-r42"), "r42")
        XCTAssertNil(ActionRappel.rappel(dansNotification: "autre-r42"))
        XCTAssertNil(ActionRappel.fait.report(maintenant: vendredi))
        XCTAssertEqual(ActionRappel.dansUneHeure.report(maintenant: vendredi), date(23, 10, 15, 0))
        XCTAssertEqual(ActionRappel.demain.report(maintenant: vendredi), date(24, 10, 9))
        XCTAssertEqual(Set(ActionRappel.allCases.map(\.rawValue)).count, 3, "identifiants distincts")
    }

    // MARK: Une partie d'une proposition

    func testSeulesLesLignesCocheesPartent() {
        var a = [ActionProposee(type: "creer", nom: "Relire le devis"), ActionProposee(type: "creer", nom: "Appeler Léa"),
                 ActionProposee(type: "creer", nom: "Réserver la salle")]
        XCTAssertNil(SelectionLignes.rangs(a, decoches: []), "rien de décoché : tout part, comme avant")
        XCTAssertEqual(SelectionLignes.rangs(a, decoches: [1]), [0, 2])
        // Une proposition ajustée garde le rang d'origine de chaque ligne.
        a[0].rang = 0
        a[1].rang = 2
        XCTAssertEqual(SelectionLignes.rangs(Array(a.prefix(2)), decoches: [2]), [0])
        XCTAssertEqual(SelectionLignes.rangs(a, decoches: [0, 1, 2]), [])
        XCTAssertEqual(SelectionLignes.libelle(total: 3, gardes: 3), "Oui, fais-le")
        XCTAssertEqual(SelectionLignes.libelle(total: 3, gardes: 2), "Oui, les 2")
        XCTAssertEqual(SelectionLignes.libelle(total: 3, gardes: 1), "Oui, celle-ci")
        XCTAssertEqual(SelectionLignes.libelle(total: 3, gardes: 0), "Rien de coché")
    }

    func testLeBilanDitCeQuiAEteEcarte() throws {
        let json = #"{"ok":true,"results":[{"ok":true,"nom":"Relire le devis"}],"ledgerId":"j1","echecs":0,"etat":"appliquee","ecartees":["Appeler Léa"]}"#
        let r = try JSONDecoder().decode(ResultatApplication.self, from: Data(json.utf8))
        XCTAssertEqual(r.bilan.ecartees, ["Appeler Léa"])
        XCTAssertEqual(r.bilan.faits, ["Relire le devis"])
        let ancien = try JSONDecoder().decode(ResultatApplication.self, from: Data(#"{"ok":true,"results":[]}"#.utf8))
        XCTAssertNil(ancien.bilan.ecartees, "une tour d'avant : rien d'écarté")
    }

    // MARK: Le même « Gérer » pour une tâche sans créneau

    func testUneTacheSansCreneauSOuvreDansGerer() {
        var t = TacheResume(id: "t9", titre: "Payer la facture", echeance: date(20, 10, 18).millis, projet: "Maison", priorite: "HIGH",
                            bloquee: true, raison: "le devis", duree: 20)
        t.etiquettes = ["et-admin"]
        let e = ElementJour.sansCreneau(t, retard: true, maintenant: vendredi)
        XCTAssertTrue(e.sansCreneau)
        XCTAssertFalse(e.estRendezVous)
        XCTAssertEqual(e.retard, true)
        XCTAssertEqual(e.resume, t, "rien ne se perd entre la liste et le panneau")
        XCTAssertFalse(ElementJour(type: "tache", id: "x", titre: "x", debut: 0).sansCreneau)
    }
}

/// Le carnet : reporter un rappel, et les actions de sa notification.
@MainActor
final class ReportRappelsTests: XCTestCase {
    private let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("remy-report-" + UUID().uuidString)

    override func tearDown() {
        try? FileManager.default.removeItem(at: dossier)
        super.tearDown()
    }

    /// Sans tour joignable (aucune capacité) : tout reste dans la file de l'iPhone.
    private func app() -> AppModel {
        AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!), rangement: Rangement(dossier: dossier))
    }

    func testReporterUnRappelSAnnule() async throws {
        let a = app()
        let r = try XCTUnwrap(a.carnet.creerRappel("Payer le loyer", quand: Date().addingTimeInterval(-600)))
        let demain = Date().addingTimeInterval(86_400)
        a.carnet.reporter(r, a: demain)
        XCTAssertEqual(a.carnet.rappels.first?.quand, demain.millis)
        XCTAssertEqual(a.carnet.enAttente.count, 2, "la création, puis le report")
        XCTAssertTrue(a.toast?.hasPrefix("Rappel : demain") == true, a.toast ?? "")
        a.message?.annuler?()
        XCTAssertEqual(a.carnet.rappels.first?.quand, r.quand, "« Annuler » remet l'heure d'avant")
    }

    func testLesActionsDeNotificationSontSansDoubleEffet() async throws {
        let a = app()
        let r = try XCTUnwrap(a.carnet.creerRappel("Sortir les poubelles", quand: Date().addingTimeInterval(60)))
        XCTAssertTrue(a.carnet.depuisNotification(id: r.id, fait: true, quand: nil))
        XCTAssertEqual(a.carnet.rappels.first?.fait, true)
        XCTAssertFalse(a.carnet.depuisNotification(id: r.id, fait: true, quand: nil), "déjà fait : rien de plus")
        XCTAssertFalse(a.carnet.depuisNotification(id: "inconnu", fait: true, quand: nil), "disparu : rien")
        let plusTard = Date().addingTimeInterval(3600)
        XCTAssertTrue(a.carnet.depuisNotification(id: r.id, fait: false, quand: plusTard))
        XCTAssertEqual(a.carnet.rappels.first?.quand, plusTard.millis)
        XCTAssertEqual(a.carnet.rappels.first?.fait, false, "reporté : il sonnera de nouveau")
    }
}
