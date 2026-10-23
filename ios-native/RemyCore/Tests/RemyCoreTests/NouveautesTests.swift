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

    /// Un catalogue d'essai figé : la logique ne dépend pas des vraies entrées,
    /// que chaque mise à jour allonge (série 3 le 24/10).
    static let page = Nouveaute.Page(symbole: "star", titre: "T", texte: "Texte")
    static let essai = [
        Nouveaute(id: "modele", serie: 2, date: "", titre: "Modèle", capacite: "modeles-v1", pages: [page]),
        Nouveaute(id: "lieux", serie: 2, date: "", titre: "Lieux", capacite: "lieux-v1", pages: [page]),
        Nouveaute(id: "jauge", serie: 1, date: "", titre: "Jauge", capacite: "jauge-v1", pages: [page]),
        Nouveaute(id: "selection", serie: 1, date: "", titre: "Sélection", capacite: nil, pages: [page]),
    ]

    /// Le modèle des nouveautés sur le catalogue d'essai. L'AppModel (pour les
    /// capacités) a ses propres réglages : il range les « vues » du vrai catalogue.
    func essai(_ capacites: [String], reglages: UserDefaults) -> NouveautesModel {
        let m = NouveautesModel(reglages: reglages, catalogue: Self.essai)
        m.app = app(capacites, reglages: suite())
        return m
    }

    func testLePremierLancementNeMontreQueLaDerniereMiseAJour() {
        let r = suite()
        let m = essai(["modeles-v1", "lieux-v1", "jauge-v1"], reglages: r)
        m.verifier()
        XCTAssertEqual(Set(m.affichees?.entrees.map(\.id) ?? []), ["modele", "lieux"], "l'historique ne s'impose pas")
        XCTAssertFalse(m.estNouvelle(Self.essai[2]))
        // Vu une fois : plus jamais à l'ouverture, même après un relancement.
        m.fermer()
        XCTAssertNil(m.affichees)
        let b = essai(["modeles-v1", "lieux-v1"], reglages: r)
        b.verifier()
        XCTAssertNil(b.affichees)
    }

    /// Le vrai catalogue, la tour à jour : seule la dernière série s'affiche.
    func testLeVraiCatalogueMontreSaDerniereSerie() {
        let a = app(Nouveautes.catalogue.compactMap(\.capacite), reglages: suite())
        a.nouveautes.verifier()
        let derniere = Nouveautes.catalogue.map(\.serie).max()!
        XCTAssertEqual(Set(a.nouveautes.affichees?.entrees.map(\.serie) ?? []), [derniere])
        a.nouveautes.fermer()
        XCTAssertNil(a.nouveautes.affichees)
    }

    func testUneFonctionQueLaTourNeConnaitPasNestPasPresentee() {
        let r = suite()
        let m = essai(["lieux-v1"], reglages: r)
        m.verifier()
        XCTAssertEqual(m.affichees?.entrees.map(\.id), ["lieux"], "le modèle attend la mise à jour de la tour")
        m.fermer()
        // La tour mise à jour : le tutoriel du modèle arrive à son tour.
        let b = essai(["lieux-v1", "modeles-v1"], reglages: r)
        b.verifier()
        XCTAssertEqual(b.affichees?.entrees.map(\.id), ["modele"])
        XCTAssertFalse(b.existe(Nouveaute(id: "x", serie: 9, date: "", titre: "", capacite: "inconnue-v1", pages: [])))
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
        let m = essai([], reglages: suite())
        let jauge = Self.essai[2]
        let lot = m.lot(pour: jauge)
        XCTAssertEqual(lot.entrees, [jauge])
        XCTAssertNil(m.affichees, "revoir ne passe pas par la feuille du lancement")
        let modele = Self.essai[0]
        XCTAssertTrue(m.estNouvelle(modele))
        m.marquerVues(m.lot(pour: modele))
        XCTAssertFalse(m.estNouvelle(modele))
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
