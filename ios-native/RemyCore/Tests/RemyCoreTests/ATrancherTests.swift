import XCTest
@testable import RemyCore

/// « À trancher », la revue du dimanche et le tri des retards (24/10) : la
/// logique pure (dates, gestes, ce qui reste après un geste) et le contrat.
final class ATrancherTests: XCTestCase {
    private func date(_ a: Int, _ m: Int, _ j: Int, _ h: Int = 10) -> Date {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = .current
        return c.date(from: DateComponents(year: a, month: m, day: j, hour: h))!
    }

    func testLaRevueEstProposeeLeDimancheUneFoisParSemaine() {
        let dimanche = date(2026, 10, 25)
        XCTAssertTrue(RituelSemaine.revueProposee(maintenant: dimanche, active: true, faiteLe: nil))
        XCTAssertFalse(RituelSemaine.revueProposee(maintenant: date(2026, 10, 24), active: true, faiteLe: nil), "samedi : non")
        XCTAssertFalse(RituelSemaine.revueProposee(maintenant: dimanche, active: false, faiteLe: nil), "coupée dans Réglages")
        XCTAssertFalse(RituelSemaine.revueProposee(maintenant: dimanche, active: true, faiteLe: date(2026, 10, 25, 9)), "déjà faite ce dimanche")
        XCTAssertTrue(RituelSemaine.revueProposee(maintenant: dimanche, active: true, faiteLe: date(2026, 10, 18, 9)), "faite la semaine d'avant")
        XCTAssertEqual(RituelSemaine.debutSemaine(dimanche), date(2026, 10, 19, 0), "la semaine commence le lundi")
    }

    func testAbsenceDePlusDeTroisJours() {
        let maintenant = date(2026, 10, 24)
        XCTAssertFalse(RituelSemaine.apresAbsence(derniere: nil, maintenant: maintenant), "premier lancement : rien à rattraper")
        XCTAssertFalse(RituelSemaine.apresAbsence(derniere: date(2026, 10, 21, 12), maintenant: maintenant))
        XCTAssertTrue(RituelSemaine.apresAbsence(derniere: date(2026, 10, 20, 9), maintenant: maintenant))
    }

    func testUnGesteParLigneSelonSonType() {
        XCTAssertEqual(GesteTri.pour("carte"), [.oui, .non, .plusTard])
        XCTAssertEqual(GesteTri.pour("doublon"), [.fusionner, .plusTard])
        XCTAssertEqual(GesteTri.pour("fil"), [.supprimer, .plusTard])
        XCTAssertEqual(GesteTri.pour("retard"), [.fait, .demain, .abandonner])
        XCTAssertEqual(GesteTri.pour("rappel-retard"), [.fait, .demain, .abandonner])
        for g in GesteTri.allCases { XCTAssertFalse(g.libelle.isEmpty) }
    }

    func testLesRappelsPassesSontDesRetards() {
        let maintenant = date(2026, 10, 24)
        let rappels = [
            Rappel(id: "a", texte: "Payer le loyer", quand: maintenant.addingTimeInterval(-3 * 86_400).millis, fait: false),
            Rappel(id: "b", texte: "Déjà fait", quand: maintenant.addingTimeInterval(-86_400).millis, fait: true),
            Rappel(id: "c", texte: "Plus tard", quand: maintenant.addingTimeInterval(86_400).millis, fait: false),
            Rappel(id: "d", texte: "Sans date", quand: nil, fait: false),
        ]
        let r = RituelSemaine.rappelsEnRetard(rappels, maintenant: maintenant)
        XCTAssertEqual(r.map(\.rappelId), ["a"])
        XCTAssertEqual(r.first?.type, "rappel-retard")
    }

    func testUneLigneDuCarnetSuitLEtatDeLiPhone() {
        let groupes = [
            GroupeATrancher(id: "rappels", titre: "Rappels sans date", total: 2, lignes: [
                LigneATrancher(cle: "rappel:r1", type: "rappel", texte: "Changer les essuie-glaces", rappelId: "r1"),
                LigneATrancher(cle: "rappel:r2", type: "rappel", texte: "Rangé depuis", rappelId: "r2"),
            ]),
            GroupeATrancher(id: "doublons", titre: "Rappels en double", total: 1, lignes: [
                LigneATrancher(cle: "doublon:r3", type: "doublon", texte: "Appeler le garage", rappelId: "r3", doublons: ["r4"]),
            ]),
            GroupeATrancher(id: "articles", titre: "Articles pris", total: 1, lignes: [
                LigneATrancher(cle: "articles:l1", type: "articles", texte: "Courses : 2 articles pris", listeId: "l1", nombre: 2),
            ]),
            GroupeATrancher(id: "fils", titre: "Fils d'un seul échange", total: 41, lignes: [
                LigneATrancher(cle: "fil:c1", type: "fil", texte: "Idée de cadeau", convId: "c1"),
                LigneATrancher(cle: "fil:c2", type: "fil", texte: "Budget", convId: "c2"),
            ]),
        ]
        let rappels = [
            Rappel(id: "r1", texte: "Changer les essuie-glaces", quand: nil, fait: false),
            Rappel(id: "r2", texte: "Rangé depuis", quand: Date().millis, fait: false),
            Rappel(id: "r3", texte: "Appeler le garage", quand: nil, fait: false),
        ]
        let listes = [Liste(id: "l1", nom: "Courses", ordre: 0, elements: [
            ElementListe(id: "e1", texte: "Tomates", fait: true, ordre: 0),
            ElementListe(id: "e2", texte: "Lait", fait: false, ordre: 1),
        ])]
        let reste = RituelSemaine.filtrer(groupes, masquees: ["fil:c1"], rappels: rappels, listes: listes)
        XCTAssertEqual(reste.map(\.id), ["rappels", "articles", "fils"], "le doublon fusionné sur l'iPhone est réglé")
        XCTAssertEqual(reste[0].lignes.map(\.rappelId), ["r1"], "un rappel daté entre-temps sort")
        XCTAssertEqual(reste[1].lignes.first?.texte, "Courses : 1 article pris", "le compte suit la liste")
        XCTAssertEqual(reste[2].total, 40, "le total suit les lignes réglées")
        // Carnet pas encore lu : on fait confiance à la tour.
        XCTAssertEqual(RituelSemaine.filtrer(groupes, masquees: [], rappels: nil, listes: nil).count, 4)
    }

    func testLaReponseDeLaTourSeDecode() throws {
        let json = """
        {"genereA":1761300000000,"total":2,"reportes":1,"groupes":[
          {"id":"cartes","titre":"Cartes en attente","total":1,"lignes":[{"cle":"carte:p-tom","type":"carte","texte":"Échéance proposée : jeudi soir.","detail":"Abonnement de Tom · 1 action","depuis":1761290000000,"convId":"c10","propositionId":"p-tom","source":"motion"}]},
          {"id":"idees","titre":"Idées à trier","total":1,"lignes":[{"cle":"idee:n1","type":"idee","texte":"Un atelier bougies","detail":"Idées","depuis":null,"dossierId":"idees","noteId":"n1"}]}],
         "retards":[{"cle":"retard:t4","type":"retard","texte":"Relancer le comptable","detail":null,"depuis":1761000000000,"tacheId":"t4"}]}
        """
        let v = try JSONDecoder().decode(VueATrancher.self, from: Data(json.utf8))
        XCTAssertEqual(v.groupes?.first?.lignes.first?.propositionId, "p-tom")
        XCTAssertEqual(v.retards?.first?.tacheId, "t4")
        let revue = """
        {"debut":1,"fin":2,"domaines":[{"nom":"Boutique","faites":2,"glissees":1,"minutes":75}],"faites":[{"nom":"Photos","projet":"Boutique","minutes":30,"a":3}],
         "glissees":[{"id":"t5","nom":"Envoyer le devis","projet":null,"echeance":4}],"rappelsFaits":1,"appris":["Tu avances mieux le matin (70 %)"],
         "decisions":{"semaine":5,"liste":["Finir la boutique"],"a":6},"aTrancher":7}
        """
        let r = try JSONDecoder().decode(VueRevue.self, from: Data(revue.utf8))
        XCTAssertEqual(r.domaines?.first?.minutes, 75)
        XCTAssertEqual(r.decisions?.liste, ["Finir la boutique"])
        XCTAssertEqual(r.appris?.count, 1)
    }
}
