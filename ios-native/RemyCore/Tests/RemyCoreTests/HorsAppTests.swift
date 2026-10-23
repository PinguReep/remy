import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// Rémy hors de l'app (24/10) : le widget « Maintenant », Siri et l'activité
// en direct choisissent la même chose, ici.

final class ApercuMaintenantTests: XCTestCase {
    let t0: Millis = 1_790_152_200_000 // 10:30 à Paris
    var maintenant: Date { t0.date }

    func e(_ id: String, _ debutMin: Double, _ finMin: Double, rdv: Bool = false, duree: Int? = nil) -> ElementJour {
        ElementJour(type: rdv ? "rdv" : "tache", id: id, titre: "Tâche \(id)", projet: "Site",
                    debut: t0 + debutMin * 60_000, fin: t0 + finMin * 60_000, duree: duree)
    }

    func journee(_ items: [ElementJour], aFaire: [TacheResume]? = nil, retards: Int = 0, sources: Sources = Sources(motion: "ok", agenda: "ok")) -> Journee {
        Journee(items: items, aFaire: aFaire, retard: Retard(total: retards, items: []), sources: sources)
    }

    func testEnCoursAvecLaSuite() {
        let j = journee([e("a", -90, -45), e("b", -15, 45), e("c", 60, 90, rdv: true)])
        let a = ApercuMaintenant.pour(j, maintenant: maintenant)
        XCTAssertEqual(a.genre, .enCours)
        XCTAssertEqual(a.titre, "Tâche b")
        XCTAssertEqual(a.fin, (t0 + 45 * 60_000).date)
        XCTAssertEqual(a.ensuite?.titre, "Tâche c")
        XCTAssertEqual(a.phrase(maintenant: maintenant),
                       "En ce moment : « Tâche b », jusqu'à 11:15 (45 min restantes). Ensuite : « Tâche c » à 11:30.")
    }

    func testRienEnCoursLaSuivante() {
        let j = journee([e("a", -90, -45), e("c", 25, 90)])
        let a = ApercuMaintenant.pour(j, maintenant: maintenant)
        XCTAssertEqual(a.genre, .suivant)
        XCTAssertEqual(a.phrase(maintenant: maintenant), "Rien en cours. Ensuite : « Tâche c » à 10:55, dans 25 min.")
    }

    func testAFaireLibreEtSources() {
        let k = journee([], aFaire: [TacheResume(id: "x", titre: "Rappeler"), TacheResume(id: "y", titre: "y"), TacheResume(id: "z", titre: "z")])
        XCTAssertEqual(ApercuMaintenant.pour(k, maintenant: maintenant).genre, .aFaire(total: 3))
        XCTAssertEqual(ApercuMaintenant.pour(k, maintenant: maintenant).phrase(maintenant: maintenant),
                       "Rien à heure fixe. À faire aujourd'hui : « Rappeler », et 2 autres.")
        let libre = ApercuMaintenant.pour(journee([e("a", -90, -45)], aFaire: [], retards: 2), maintenant: maintenant)
        XCTAssertEqual(libre.genre, .libre(retards: 2))
        XCTAssertEqual(libre.phrase(maintenant: maintenant), "Plus rien de prévu aujourd'hui. 2 tâches sont en retard.")
        XCTAssertEqual(ApercuMaintenant.pour(journee([], sources: Sources(motion: "off", agenda: "off")), maintenant: maintenant).genre, .aucuneSource)
        XCTAssertEqual(ApercuMaintenant.pour(journee([], sources: Sources(motion: "erreur", agenda: "erreur")), maintenant: maintenant).genre, .enPanne)
    }

    func testHorsLigne() {
        // Pas de journée du tout : la tour est injoignable, et c'est dit avec quoi faire.
        let rien = ApercuMaintenant.pour(nil, maintenant: maintenant)
        XCTAssertEqual(rien.genre, .injoignable)
        XCTAssertTrue(rien.phrase(maintenant: maintenant).contains("Tailscale"))
        // Une copie d'aujourd'hui : utilisée, et datée.
        let copie = ApercuMaintenant.pour(journee([e("b", -15, 45)]), maintenant: maintenant,
                                          copieDu: (t0 - 20 * 60_000).date)
        XCTAssertEqual(copie.genre, .enCours)
        XCTAssertTrue(copie.phrase(maintenant: maintenant).hasPrefix("Ta tour ne répond pas ; d'après ta journée de 10:10 : En ce moment"))
        // Une copie d'un autre jour ne dit plus rien de juste.
        var hier = journee([e("b", -15, 45)])
        hier.jour = "2020-01-01"
        XCTAssertEqual(ApercuMaintenant.pour(hier, maintenant: maintenant, copieDu: (t0 - 86_400_000).date).genre, .injoignable)
        // Jamais connecté sur cet iPhone.
        XCTAssertEqual(ApercuMaintenant(genre: .nonConnecte).phrase(), "Ouvre Rémy une fois pour te connecter.")
    }

    func testBornesPourLeWidget() {
        let j = journee([e("a", -90, -45), e("b", -15, 45), e("c", 45, 90), e("d", 600, 660)])
        let b = ApercuMaintenant.bornes(j, depuis: maintenant, jusqua: (t0 + 6 * 3_600_000).date)
        // Fin de b = début de c : une seule entrée ; d est au-delà de 6 h.
        XCTAssertEqual(b, [(t0 + 45 * 60_000).date, (t0 + 90 * 60_000).date])
        XCTAssertEqual(ApercuMaintenant.bornes(nil, depuis: maintenant, jusqua: maintenant.addingTimeInterval(3600)), [])
        // À chaque borne, l'aperçu a bien changé.
        XCTAssertEqual(ApercuMaintenant.pour(j, maintenant: b[0]).titre, "Tâche c")
        XCTAssertEqual(ApercuMaintenant.pour(j, maintenant: b[1]).genre, .suivant)
    }
}

final class SuiviActiviteTests: XCTestCase {
    let t0: Millis = 1_790_152_200_000

    func e(_ id: String, _ debutMin: Double, _ finMin: Double, rdv: Bool = false) -> ElementJour {
        ElementJour(type: rdv ? "rdv" : "tache", id: id, titre: id, debut: t0 + debutMin * 60_000, fin: t0 + finMin * 60_000, duree: 30)
    }

    func j(_ items: [ElementJour]) -> Journee { Journee(items: items, sources: Sources(motion: "ok", agenda: "ok")) }

    func testDemarreSeuleUneFois() {
        let jour = j([e("a", -10, 20)])
        XCTAssertEqual(SuiviActivite.gestes(journee: jour, maintenant: t0, suivie: nil, auto: true, dejaVues: []), [.demarrer(e("a", -10, 20))])
        // Démarrage seul coupé, ou déjà montrée (Sam l'a peut-être fermée) : rien.
        XCTAssertEqual(SuiviActivite.gestes(journee: jour, maintenant: t0, suivie: nil, auto: false, dejaVues: []), [])
        XCTAssertEqual(SuiviActivite.gestes(journee: jour, maintenant: t0, suivie: nil, auto: true, dejaVues: ["a"]), [])
    }

    func testUnRendezVousNaPasDActivite() {
        XCTAssertNil(SuiviActivite.tacheEnCours(j([e("r", -10, 20, rdv: true)]), maintenant: t0))
        XCTAssertNil(SuiviActivite.tacheEnCours(nil, maintenant: t0))
    }

    func testSuitLaTache() {
        let fin = (t0 + 20 * 60_000).date
        // Inchangée : rien.
        XCTAssertEqual(SuiviActivite.gestes(journee: j([e("a", -10, 20)]), maintenant: t0, suivie: ("a", fin), auto: true, dejaVues: ["a"]), [])
        // Prolongée dans l'app : nouvelle fin.
        XCTAssertEqual(SuiviActivite.gestes(journee: j([e("a", -10, 35)]), maintenant: t0, suivie: ("a", fin), auto: true, dejaVues: ["a"]),
                       [.mettreAJour(e("a", -10, 35))])
        // Cochée (plus dans la journée) : l'activité se termine.
        XCTAssertEqual(SuiviActivite.gestes(journee: j([]), maintenant: t0, suivie: ("a", fin), auto: true, dejaVues: ["a"]), [.terminer])
        // L'heure est passée, la suivante commence : fin de l'une, début de l'autre.
        let apres = t0 + 25 * 60_000
        XCTAssertEqual(SuiviActivite.gestes(journee: j([e("a", -10, 20), e("b", 20, 50)]), maintenant: apres, suivie: ("a", fin), auto: true, dejaVues: ["a"]),
                       [.terminer, .demarrer(e("b", 20, 50))])
        // Journée pas encore lue : on ne touche à rien.
        XCTAssertEqual(SuiviActivite.gestes(journee: nil, maintenant: t0, suivie: ("a", fin), auto: true, dejaVues: []), [])
    }

    func testEtatDeLActivite() {
        let (attributs, etat) = ActiviteTache.depuis(e("a", -10, 20))!
        XCTAssertEqual(attributs.titre, "a")
        XCTAssertEqual(etat.fin, (t0 + 20 * 60_000).date)
        XCTAssertEqual(etat.duree, 30)
        XCTAssertNil(ActiviteTache.depuis(e("r", -10, 20, rdv: true)))
        // Une fin avant le début ne casse pas la barre de temps.
        let bizarre = ActiviteTache.Etat(debut: t0.date, fin: (t0 - 60_000).date, duree: nil)
        XCTAssertGreaterThan(bizarre.fin, bizarre.debut)
        // Retour vers les gestes de l'app (prolonger).
        let el = attributs.element(etat)
        XCTAssertEqual(el.id, "a")
        XCTAssertEqual(el.duree, 30)
        XCTAssertEqual(el.finEffective, t0 + 20 * 60_000)
        // L'état voyage en JSON (ActivityKit).
        let donnees = try! JSONEncoder().encode(etat)
        XCTAssertEqual(try! JSONDecoder().decode(ActiviteTache.Etat.self, from: donnees), etat)
    }

    func testPhrasesDErreurPourSiri() {
        XCTAssertTrue(Raccourcis.phrase(ErreurAPI.reseau("x")).contains("Tailscale"))
        XCTAssertTrue(Raccourcis.phrase(ErreurPartage.nonConnecte).contains("Ouvre Rémy"))
        XCTAssertEqual(Raccourcis.phrase(ErreurAPI.serveur(400, "trop court")), "Ta tour a refusé : trop court")
    }
}
