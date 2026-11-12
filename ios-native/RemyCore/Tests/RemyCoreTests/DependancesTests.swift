import XCTest
@testable import RemyCore

/// « Bloquée par » (taches-dependances-v1, 12/11) : ce que la tour envoie se
/// lit, le choix des bloquantes, les marques, ce que disent les bandeaux.
final class DependancesTests: XCTestCase {
    let journee = """
    {"jour": "2026-11-12", "minute": 600,
     "items": [
       {"type": "tache", "id": "a", "titre": "Réparer la voiture au garage", "debut": 1794470400000, "fin": 1794474000000,
        "debloque": [{"id": "b", "nom": "Porter la voiture chez le carrossier"}]}],
     "aFaire": [
       {"id": "b", "titre": "Porter la voiture chez le carrossier", "echeance": 1794481200000, "bloquee": true,
        "raison": "après « Réparer la voiture au garage »", "bloqueePar": [{"id": "a", "nom": "Réparer la voiture au garage"}],
        "menaceBlocage": "Due bientôt, et elle attend encore « Réparer la voiture au garage »."},
       {"id": "c", "titre": "Payer le carrossier", "bloquee": true, "raison": "le bon de commande", "attente": true,
        "bloqueePar": [{"id": "b", "nom": null}]}],
     "retard": {"total": 0, "items": []}}
    """

    func testLaJourneeDeLaTourSeLit() throws {
        let j = try JSONDecoder().decode(Journee.self, from: Data(journee.utf8))
        XCTAssertEqual(j.items?.first?.debloque, [LienTache(id: "b", nom: "Porter la voiture chez le carrossier")])
        let b = try XCTUnwrap(j.aFaire?.first)
        XCTAssertEqual(b.bloquee, true, "toute l'app l'écarte déjà : jamais proposée")
        XCTAssertEqual(b.bloqueePar?.first?.id, "a")
        XCTAssertNotNil(b.menaceBlocage)
        XCTAssertEqual(j.aFaire?.last?.bloqueePar?.first?.libelle, "une autre tâche", "nom inconnu de la tour")
        // Ouverte dans « Gérer » : les liens suivent.
        let e = ElementJour.sansCreneau(b, retard: false)
        XCTAssertEqual(e.bloqueePar, b.bloqueePar)
        XCTAssertEqual(e.resume.menaceBlocage, b.menaceBlocage)
        // Une tour d'avant : aucun champ, rien ne change.
        let vieux = try JSONDecoder().decode(TacheResume.self, from: Data(#"{"id": "x", "titre": "X", "bloquee": true, "raison": "le devis"}"#.utf8))
        XCTAssertNil(vieux.bloqueePar)
        XCTAssertEqual(Dependances.marque(raison: vieux.raison, par: vieux.bloqueePar), "En attente · le devis")
    }

    func testLesMarques() {
        XCTAssertEqual(Dependances.marque(raison: "après « A »", par: [LienTache(id: "a", nom: "Garage")]), "Bloquée par « Garage »")
        XCTAssertEqual(Dependances.marque(raison: nil, par: [LienTache(id: "a", nom: "Garage"), LienTache(id: "d", nom: "Devis")]), "Bloquée par « Garage » (+1)")
        XCTAssertEqual(Dependances.marque(raison: nil, par: nil), "En attente")
        XCTAssertEqual(Dependances.marque(raison: nil, par: []), "En attente")
        XCTAssertEqual(Dependances.marqueDebloque([LienTache(id: "b", nom: "Carrossier")]), "Débloque « Carrossier »")
        XCTAssertNil(Dependances.marqueDebloque([]))
        XCTAssertNil(Dependances.marqueDebloque(nil))
    }

    /// « Reprendre » ne lève que l'attente posée à la main.
    func testReprendreNeVautQueLAttenteManuelle() {
        let lien = [LienTache(id: "a", nom: "Garage")]
        XCTAssertTrue(Dependances.attenteManuelle(bloquee: true, par: nil, attente: nil))
        XCTAssertFalse(Dependances.attenteManuelle(bloquee: true, par: lien, attente: nil))
        XCTAssertTrue(Dependances.attenteManuelle(bloquee: true, par: lien, attente: true))
        XCTAssertFalse(Dependances.attenteManuelle(bloquee: nil, par: nil, attente: nil))
    }

    let taches = [
        TacheAChoisir(id: "a", titre: "Réparer la voiture au garage", projet: "Voiture", echeance: 3),
        TacheAChoisir(id: "b", titre: "Porter la voiture chez le carrossier", projet: "Voiture", echeance: 5),
        TacheAChoisir(id: "c", titre: "Payer le carrossier"),
        TacheAChoisir(id: "d", titre: "Appeler Léa", projet: "Perso", echeance: 1),
    ]

    func testChoisirUneBloquanteSansBoucle() {
        let liens = [LienDependance(tache: LienTache(id: "b"), bloquante: LienTache(id: "a")),
                     LienDependance(tache: LienTache(id: "c"), bloquante: LienTache(id: "b"))]
        XCTAssertEqual(Dependances.candidats(taches, tache: "a", liens: liens).map(\.id), ["d"], "b et c l'attendent : elles boucleraient")
        XCTAssertEqual(Dependances.candidats(taches, tache: "c", deja: ["b"], liens: liens).map(\.id), ["d", "a"], "les échéances proches d'abord")
    }

    func testChercherParNom() {
        XCTAssertEqual(Dependances.candidats(taches, tache: "d", recherche: "REPARER voiture").map(\.id), ["a"])
        XCTAssertEqual(Dependances.candidats(taches, tache: "d", recherche: "voiture").map(\.id), ["a", "b"])
        XCTAssertEqual(Dependances.candidats(taches, tache: "d", recherche: "perso").map(\.id), [])
        XCTAssertEqual(Dependances.phraseVide(total: 3, recherche: " zèbre "), "Aucune tâche ne correspond à « zèbre ».")
        XCTAssertTrue(Dependances.phraseVide(total: 0, recherche: "").hasPrefix("Aucune autre tâche ouverte dans Motion"))
    }

    func testCeQueDisentLesBandeaux() throws {
        XCTAssertEqual(Dependances.phraseDebloquees([LienTache(id: "b", nom: "Carrossier")]), "« Carrossier » est débloquée : elle peut commencer.")
        XCTAssertEqual(Dependances.phraseDebloquees([LienTache(id: "b", nom: "A"), LienTache(id: "c", nom: "B")]), "« A » et « B » sont débloquées.")
        XCTAssertNil(Dependances.phraseDebloquees([]))
        // La réponse de /api/motion/apply : une coche qui débloque, une proposition qui lie.
        let coche = try JSONDecoder().decode(ResultatApplication.self, from: Data(#"""
        {"ok": true, "ledgerId": "j1", "echecs": 0, "etat": "appliquee",
         "results": [{"ok": true, "type": "terminer", "nom": "Garage", "debloquees": [{"id": "b", "nom": "Carrossier"}]}]}
        """#.utf8))
        XCTAssertEqual(coche.results?.first?.debloquees?.first?.nom, "Carrossier")
        XCTAssertEqual(Dependances.phraseLiens(coche), "« Carrossier » est débloquée : elle peut commencer.")
        let projet = try JSONDecoder().decode(ResultatApplication.self, from: Data(#"""
        {"ok": true, "ledgerId": "j2", "echecs": 0, "etat": "appliquee",
         "results": [{"ok": true, "type": "creer", "nom": "Garage"},
                     {"ok": true, "type": "creer", "nom": "Carrossier", "bloqueePar": [{"id": "t1", "nom": "Garage"}]},
                     {"ok": true, "type": "creer", "nom": "Payer", "liensRates": [{"ref": "x", "erreur": "écartée de la proposition"}]}]}
        """#.utf8))
        XCTAssertEqual(Dependances.phraseLiens(projet), "« Carrossier » attendra « Garage ». Un lien « après » n'a pas été posé (son étape n'a pas été créée).")
        let rien = try JSONDecoder().decode(ResultatApplication.self, from: Data(#"{"results": [{"ok": true, "nom": "X"}]}"#.utf8))
        XCTAssertNil(Dependances.phraseLiens(rien))
    }

    /// La carte d'une proposition « d'abord A, puis B » dit ce que l'étape attend.
    func testLaCarteDitCeQueLEtapeAttend() throws {
        let a = try JSONDecoder().decode(ActionProposee.self, from: Data(#"""
        {"type": "creer", "nom": "Porter la voiture chez le carrossier", "ref": "etape-2", "bloquee_par": ["garage"], "apres": ["Réparer la voiture au garage"]}
        """#.utf8))
        XCTAssertEqual(a.bloquee_par, ["garage"])
        XCTAssertEqual(Format.detailAction(a), "après « Réparer la voiture au garage »")
        // Réencodée telle quelle (une proposition ajustée repart avec ses liens).
        let retour = try JSONDecoder().decode(ActionProposee.self, from: JSONEncoder().encode(a))
        XCTAssertEqual(retour, a)
    }

    func testUneMenaceDeBlocageNeDemandePasDeLaCaser() throws {
        let m = try JSONDecoder().decode(MenaceeTour.self, from: Data(#"""
        {"id": "b", "titre": "Carrossier", "raison": "bloquee", "phrase": "Due demain 18:00. Elle attend « Garage », prévue après son échéance.",
         "bloqueePar": [{"id": "a", "nom": "Garage"}], "action": {"type": "caser", "libelle": "En parler à Rémy"}}
        """#.utf8))
        XCTAssertEqual(m.bloqueePar?.first?.nom, "Garage")
        XCTAssertTrue(m.questionPourRemy.contains("avancer ce qu'elle attend, ou repousser son échéance"))
        let autre = MenaceeTour(id: "x", titre: "X", raison: "sans-creneau", phrase: "Due ce soir.")
        XCTAssertTrue(autre.questionPourRemy.contains("Trouve-lui un créneau"))
    }
}
