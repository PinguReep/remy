import XCTest
@testable import RemyCore

/// Nuit du 24/10 : fil du jour, échanges courts repliés, compteurs d'usage
/// sans contenu, file du quota Motion.
final class AllegementTests: XCTestCase {
    private let maintenant = Date(timeIntervalSince1970: 1_792_828_800) // un samedi midi (UTC)

    private func conv(_ id: String, joursAvant: Double, messages: Int? = 2, pinned: Bool? = nil, origine: Origine? = nil) -> ConversationResume {
        ConversationResume(id: id, title: id, updatedAt: (maintenant.timeIntervalSince1970 - joursAvant * 86_400) * 1000,
                           pinned: pinned, origine: origine, messages: messages)
    }

    // MARK: Fil du jour

    func testUnFilOuvertHierEstReferme() {
        XCTAssertTrue(Fils.aRefermer(derniereActivite: maintenant.addingTimeInterval(-86_400), maintenant: maintenant))
        XCTAssertFalse(Fils.aRefermer(derniereActivite: maintenant.addingTimeInterval(-600), maintenant: maintenant))
        XCTAssertFalse(Fils.aRefermer(derniereActivite: nil, maintenant: maintenant), "rien d'ouvert : rien à refermer")
    }

    func testReprendreProposeLeFilLePlusRecent() {
        let r = Fils.aReprendre([conv("ancien", joursAvant: 3), conv("hier", joursAvant: 1),
                                 conv("importe", joursAvant: 0, origine: Origine(source: "chatgpt"))], maintenant: maintenant)
        XCTAssertEqual(r?.fil.id, "hier", "un fil importé n'est pas « le dernier fil »")
        XCTAssertEqual(r?.duJour, false)
        XCTAssertEqual(Fils.aReprendre([conv("matin", joursAvant: 0.1)], maintenant: maintenant)?.duJour, true)
        XCTAssertNil(Fils.aReprendre([], maintenant: maintenant))
    }

    func testLesEchangesCourtsDePlusDe14JoursSontReplies() {
        XCTAssertTrue(Fils.estEchangeCourtAncien(conv("a", joursAvant: 15), maintenant: maintenant))
        XCTAssertFalse(Fils.estEchangeCourtAncien(conv("b", joursAvant: 13), maintenant: maintenant), "moins de 14 jours")
        XCTAssertFalse(Fils.estEchangeCourtAncien(conv("c", joursAvant: 30, messages: 6), maintenant: maintenant), "un vrai fil")
        XCTAssertFalse(Fils.estEchangeCourtAncien(conv("d", joursAvant: 30, pinned: true), maintenant: maintenant), "épinglé")
        XCTAssertFalse(Fils.estEchangeCourtAncien(conv("e", joursAvant: 30, messages: nil), maintenant: maintenant), "tour trop ancienne : on ne sait pas")
        XCTAssertFalse(Fils.estEchangeCourtAncien(conv("f", joursAvant: 30, origine: Origine(source: "claude")), maintenant: maintenant))
    }

    // MARK: Compteurs d'usage

    private func compteurs() -> CompteursUsage {
        let nom = "remy.tests.usage.\(UUID().uuidString)"
        let r = UserDefaults(suiteName: nom)!
        r.removePersistentDomain(forName: nom)
        return CompteursUsage(reglages: r)
    }

    func testUneEcritureDevientUnGesteSansContenu() {
        let json = { (o: [String: Any]) in try? JSONSerialization.data(withJSONObject: o) }
        XCTAssertNil(FonctionUsage.de(methode: "GET", chemin: "api/dashboard", corps: nil), "une lecture ne compte pas")
        XCTAssertEqual(FonctionUsage.de(methode: "POST", chemin: "api/conversations/abc/messages", corps: nil), .parler)
        XCTAssertEqual(FonctionUsage.de(methode: "POST", chemin: "api/motion/apply", corps: json(["actions": [["type": "terminer", "id": "t1"]]])), .terminer)
        XCTAssertEqual(FonctionUsage.de(methode: "POST", chemin: "api/motion/apply", corps: json(["actions": [["type": "modifier"]]])), .gerer)
        XCTAssertEqual(FonctionUsage.de(methode: "POST", chemin: "api/motion/apply", corps: json(["actions": [["type": "creer"]], "convId": "c1"])), .valider)
        XCTAssertEqual(FonctionUsage.de(methode: "POST", chemin: "api/motion/apply", corps: json(["actions": [], "origine": "capture"])), .capture)
        XCTAssertEqual(FonctionUsage.de(methode: "POST", chemin: "api/motion/undo", corps: nil), .annuler)
        XCTAssertEqual(FonctionUsage.de(methode: "PUT", chemin: "api/listes/l1/elements/e1", corps: nil), .listes)
        XCTAssertEqual(FonctionUsage.de(methode: "POST", chemin: "api/conversations/c/propositions/p/refus", corps: nil), .refuser)
        XCTAssertNil(FonctionUsage.de(methode: "POST", chemin: "api/lieux/evenements", corps: nil), "envoyé par l'app seule")
        XCTAssertNil(FonctionUsage.de(methode: "POST", chemin: "api/activite/ping", corps: nil))
    }

    func testLeResumeDitCeQuiSertEtCeQuiNeSertPas() {
        let c = compteurs()
        for _ in 0..<6 { c.noter(.terminer, le: maintenant) }
        for _ in 0..<3 { c.noter(.listes, le: maintenant) }
        c.noter(.parler, le: maintenant)
        c.noter(.remy, le: maintenant)
        c.noter(.terminer, le: maintenant.addingTimeInterval(-40 * 86_400)) // hors des 30 jours
        let r = ResumeUsage.de(c, maintenant: maintenant)
        XCTAssertEqual(r.gestes.map(\.fonction), [.terminer, .listes, .parler])
        XCTAssertEqual(r.gestes.first?.nombre, 6, "un geste d'il y a 40 jours ne compte plus")
        XCTAssertEqual(r.vues.map(\.fonction), [.remy])
        XCTAssertTrue(r.jamais.contains(.lieux))
        XCTAssertFalse(r.jamais.contains(.terminer))
        XCTAssertTrue(r.assez)
        XCTAssertTrue(r.phrase.hasPrefix("Surtout : cocher une tâche, listes de courses, parler à rémy."), r.phrase)
        c.remettreAZero()
        XCTAssertFalse(ResumeUsage.de(c, maintenant: maintenant).assez)
        XCTAssertNil(c.debut)
    }

    func testPeuDeGestesNeConcluentRien() {
        let r = ResumeUsage.de([.terminer: 3, .ouverture: 40], depuis: nil)
        XCTAssertFalse(r.assez, "ouvrir l'app n'est pas un geste")
        XCTAssertTrue(r.phrase.contains("Pas encore assez"))
    }

    // MARK: File du quota Motion

    func testLAttenteDeLaFileSeDitEnSecondesArrondies() {
        XCTAssertFalse(AttenteMotion(enFile: 0, attenteMs: 0).visible)
        XCTAssertFalse(AttenteMotion(enFile: 1, attenteMs: 800).visible, "moins de 2 s : rien à dire")
        let a = AttenteMotion(enFile: 3, attenteMs: 21_300, quotaParMinute: 12)
        XCTAssertTrue(a.visible)
        XCTAssertEqual(a.duree, "~25 s")
        XCTAssertEqual(a.phrase, "En file chez Motion : ~25 s (12 requêtes par minute). Rien à refaire, ça part tout seul.")
        XCTAssertEqual(AttenteMotion(enFile: 20, attenteMs: 125_000).duree, "~2 min")
        XCTAssertEqual(AttenteMotion(enFile: 1, attenteMs: 2_100).duree, "~5 s")
    }

    func testLesDelaisCouvrentLaFile() {
        XCTAssertGreaterThanOrEqual(DelaisMotion.ecriture, 135, "deux fenêtres d'une minute + le délai de Motion")
        XCTAssertGreaterThan(DelaisMotion.lecture, 58, "Projets a déjà attendu 58 s derrière la file")
    }
}
