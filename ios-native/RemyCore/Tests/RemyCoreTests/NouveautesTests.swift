import XCTest
@testable import RemyCore

/// Les mini tutoriels des mises à jour (21/10) : une fois, seulement quand la
/// tour connaît la fonction ; l'historique garde tout.
@MainActor
final class NouveautesTests: XCTestCase {
    func app(_ capacites: [String], reglages: UserDefaults) -> AppModel {
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!), reglages: reglages)
        a.serveur = VersionServeur(api: 1, serveur: "0.6.0", capacites: capacites)
        return a
    }
    func suite() -> UserDefaults { UserDefaults(suiteName: "nouveautes-tests-\(UUID().uuidString)")! }

    func testLePremierLancementNeMontreQueLaDerniereMiseAJour() {
        let r = suite()
        let a = app(["modeles-v1", "lieux-v1", "jauge-v1", "compactage-v1", "regles-v1"], reglages: r)
        a.nouveautes.verifier()
        let derniere = Nouveautes.catalogue.map(\.serie).max()!
        XCTAssertEqual(Set(a.nouveautes.affichees?.entrees.map(\.serie) ?? []), [derniere], "l'historique ne s'impose pas")
        XCTAssertFalse(a.nouveautes.estNouvelle(Nouveautes.catalogue.first { $0.id == "jauge" }!))
        // Vu une fois : plus jamais à l'ouverture, même après un relancement.
        a.nouveautes.fermer()
        XCTAssertNil(a.nouveautes.affichees)
        let b = app(["modeles-v1", "lieux-v1"], reglages: r)
        b.nouveautes.verifier()
        XCTAssertNil(b.nouveautes.affichees)
    }

    func testUneFonctionQueLaTourNeConnaitPasNestPasPresentee() {
        let r = suite()
        // Un catalogue d'essai : le test ne dépend pas de la dernière série du vrai.
        let p = Nouveaute.Page(symbole: "star", titre: "T", texte: "Texte")
        let catalogue = [Nouveaute(id: "lieux", serie: 2, date: "", titre: "L", capacite: "lieux-v1", pages: [p]),
                         Nouveaute(id: "modele", serie: 2, date: "", titre: "M", capacite: "modeles-v1", pages: [p])]
        let m1 = NouveautesModel(reglages: r, catalogue: catalogue)
        let a = app(["lieux-v1"], reglages: suite()) // gardé : `app` est une référence faible
        m1.app = a
        m1.verifier()
        XCTAssertEqual(m1.affichees?.entrees.map(\.id), ["lieux"], "le modèle attend la mise à jour de la tour")
        m1.fermer()
        // La tour mise à jour : le tutoriel du modèle arrive à son tour.
        let m2 = NouveautesModel(reglages: r, catalogue: catalogue)
        let b = app(["lieux-v1", "modeles-v1"], reglages: suite())
        m2.app = b
        m2.verifier()
        XCTAssertEqual(m2.affichees?.entrees.map(\.id), ["modele"])
        XCTAssertFalse(m2.existe(Nouveaute(id: "x", serie: 9, date: "", titre: "", capacite: "inconnue-v1", pages: [])))
    }

    func testUneMiseAJourSuivanteMontreSeulementSaNouveaute() {
        let r = suite()
        // L'AppModel (pour les capacités) a ses propres réglages : il range déjà
        // les « vues » du vrai catalogue, celles du catalogue d'essai restent à part.
        let a = app(["modeles-v1"], reglages: suite())
        let p = Nouveaute.Page(symbole: "star", titre: "T", texte: "Texte")
        let ancien = [Nouveaute(id: "a", serie: 1, date: "", titre: "A", capacite: nil, pages: [p]),
                      Nouveaute(id: "b", serie: 2, date: "", titre: "B", capacite: nil, pages: [p])]
        let m1 = NouveautesModel(reglages: r, catalogue: ancien)
        m1.app = a
        m1.verifier()
        XCTAssertEqual(m1.affichees?.entrees.map(\.id), ["b"])
        m1.fermer()
        let m2 = NouveautesModel(reglages: r, catalogue: ancien + [Nouveaute(id: "c", serie: 3, date: "", titre: "C", capacite: nil, pages: [p, p])])
        m2.app = a
        m2.verifier()
        XCTAssertEqual(m2.affichees?.entrees.map(\.id), ["c"])
        XCTAssertEqual(m2.affichees?.pages.count, 2)
        XCTAssertEqual(m2.historique.map(\.id), ["c", "b", "a"], "la plus récente d'abord")
    }

    func testRevoirDepuisLHistorique() {
        let r = suite()
        let a = app([], reglages: r)
        let jauge = Nouveautes.catalogue.first { $0.id == "jauge" }!
        let lot = a.nouveautes.lot(pour: jauge)
        XCTAssertEqual(lot.entrees, [jauge])
        XCTAssertNil(a.nouveautes.affichees, "revoir ne passe pas par la feuille du lancement")
        // La dernière série est nouvelle au premier lancement (quelle qu'elle soit).
        let derniere = Nouveautes.catalogue.map(\.serie).max()!
        let recente = Nouveautes.catalogue.first { $0.serie == derniere }!
        XCTAssertTrue(a.nouveautes.estNouvelle(recente))
        a.nouveautes.marquerVues(a.nouveautes.lot(pour: recente))
        XCTAssertFalse(a.nouveautes.estNouvelle(recente))
    }

    func testLeCatalogueResteCourt() {
        let ids = Nouveautes.catalogue.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count, "identifiants uniques")
        for n in Nouveautes.catalogue {
            XCTAssertFalse(n.pages.isEmpty, n.id)
            XCTAssertLessThanOrEqual(n.pages.count, 3, "\(n.id) : un mini tutoriel, pas un cours")
            for p in n.pages {
                XCTAssertFalse(p.titre.isEmpty)
                XCTAssertLessThanOrEqual(p.texte.count, 240, "\(n.id) : « \(p.titre) » trop long")
            }
        }
    }
}
