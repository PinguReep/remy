import XCTest
@testable import RemyCore

/// Demain et les 7 jours (24/10) : la réponse de la tour se lit, une partie
/// illisible ne vide pas la vue, la charge se dit en mots.
final class SemaineTests: XCTestCase {
    static let exemple = """
    {"maintenant": 1793001600000, "aujourdhui": "2026-10-26", "horaires": "Work Hours",
     "sources": {"motion": "ok", "agenda": "ok"}, "motion": {"etat": "ok", "luA": 1793001500000},
     "jours": [
      {"jour": "2026-10-26", "debut": 1792969200000, "fin": 1793055600000,
       "items": [{"type": "tache", "id": "t1", "titre": "Finaliser la démo", "debut": 1793005200000, "fin": 1793010600000, "duree": 90, "min": 660, "minFin": 750, "etat": "avenir"}],
       "toute": [], "echeances": [], "deborde": [],
       "charge": {"taches": 90, "rdv": 0, "travail": 540, "disponible": 540}},
      {"jour": "2026-10-27", "debut": 1793055600000, "fin": 1793142000000,
       "items": [
         {"type": "tache", "id": "t2", "titre": "Relire le contrat de Hugo", "debut": 1793088000000, "fin": 1793091600000, "duree": 60, "echeance": 1793116800000},
         {"type": "rdv", "id": "e1", "titre": "Podologue", "debut": 1793095200000, "fin": 1793098800000, "avecAutres": false},
         {"type": "tache", "id": "t3", "titre": "Envoyer le devis", "debut": 1793109600000, "fin": 1793113200000, "duree": 60, "echeance": 1793095200000, "apresEcheance": true}],
       "toute": [{"type": "rdv", "id": "e4", "titre": "Salon du design"}],
       "echeances": [{"id": "t3", "titre": "Envoyer le devis", "echeance": 1793095200000, "placee": true, "menacee": true},
                     {"id": "t2", "titre": "Relire le contrat de Hugo", "echeance": 1793116800000, "placee": true, "menacee": false}],
       "deborde": [{"id": "t3", "titre": "Envoyer le devis", "echeance": 1793095200000, "fin": 1793113200000}],
       "charge": {"taches": 120, "rdv": 60, "travail": 420, "disponible": 360}},
      {"jour": "2026-10-28", "debut": "illisible"},
      {"jour": "2026-10-29", "debut": 1793228400000, "items": [{"type": "tache"}], "charge": {"taches": 600, "rdv": 0, "travail": 540, "disponible": 540}}
     ]}
    """

    func testLaReponseDeLaTourSeLitMemeAbimee() throws {
        let s = try JSONDecoder().decode(Semaine.self, from: Data(Self.exemple.utf8))
        XCTAssertEqual(s.horaires, "Work Hours")
        XCTAssertEqual(s.jours.map(\.jour), ["2026-10-26", "2026-10-27", "2026-10-29"], "un jour illisible est sauté, pas toute la vue")
        XCTAssertEqual(s.illisibles, ["jours (1)"])
        let mardi = s.jours[1]
        XCTAssertEqual(mardi.items.map(\.id), ["t2", "e1", "t3"])
        XCTAssertEqual(mardi.rendezVous.map(\.titre), ["Podologue"])
        XCTAssertEqual(mardi.taches.count, 2)
        XCTAssertEqual(mardi.toute.map(\.titre), ["Salon du design"])
        XCTAssertEqual(mardi.deborde.map(\.id), ["t3"])
        XCTAssertEqual(mardi.menaces, 1, "la même tâche ne compte qu'une fois")
        XCTAssertEqual(s.jours[2].items, [], "une tâche illisible est sautée")
        XCTAssertEqual(s.jours[2].illisibles, ["items (1)"])
        // Le format rangé sur l'iPhone se relit (vue hors ligne).
        let relu = try JSONDecoder().decode(Semaine.self, from: JSONEncoder().encode(s))
        XCTAssertEqual(relu.jours.map(\.jour), s.jours.map(\.jour))
        XCTAssertEqual(relu.jours[1].charge, mardi.charge)
    }

    func testLaChargeSeDitEnMots() {
        XCTAssertEqual(ChargeJour(taches: 0, disponible: 540).niveau, .libre)
        XCTAssertEqual(ChargeJour(taches: 0, disponible: 540).phrase, "Rien de prévu sur 9 h libres")
        XCTAssertEqual(ChargeJour(taches: 120, disponible: 360).niveau, .leger)
        XCTAssertEqual(ChargeJour(taches: 120, disponible: 360).phrase, "2 h prévues sur 6 h libres")
        XCTAssertEqual(ChargeJour(taches: 300, disponible: 360).niveau, .charge)
        XCTAssertEqual(ChargeJour(taches: 400, disponible: 360).niveau, .deborde)
        XCTAssertEqual(ChargeJour(taches: 400, disponible: 360).remplissage, 1)
        XCTAssertEqual(ChargeJour(taches: 45, disponible: nil).phrase, "45 min prévue")
        XCTAssertEqual(ChargeJour(taches: 45, disponible: nil).niveau, .leger)
        XCTAssertEqual(ChargeJour(taches: 0, disponible: 0).phrase, "Pas d'horaires de travail")
        XCTAssertEqual(ChargeJour(taches: 30, disponible: 0).niveau, .deborde)
    }

    func testLeJourSeLitEnCourtEtSeRelitCommeUneJournee() throws {
        let s = try JSONDecoder().decode(Semaine.self, from: Data(Self.exemple.utf8))
        XCTAssertEqual(s.jours[0].titreCourt, "Lun 26")
        XCTAssertEqual(s.jours[1].titreCourt, "Mar 27")
        XCTAssertEqual(s.jours[1].titreLong, "Mardi 27 octobre")
        let j = s.jours[1].journee
        XCTAssertEqual(j.jour, "2026-10-27")
        XCTAssertEqual(j.items?.count, 3)
        XCTAssertEqual(j.aFaire ?? [], [], "tout est placé")
        // Prolonger « Relire le contrat » : l'impact se lit avec les voisins DE CE JOUR.
        let t2 = try XCTUnwrap(j.items?.first { $0.id == "t2" })
        let i = ImpactProlongation.de(t2, minutes: 30, journee: j)
        XCTAssertNil(i.conflit, "le podologue commence après la nouvelle fin")
        XCTAssertEqual(i.tachesDecalees, 1)
        XCTAssertEqual(SemaineModel.demainISO(Date(timeIntervalSince1970: 1_793_001_600)), "2026-10-27")
    }
}
