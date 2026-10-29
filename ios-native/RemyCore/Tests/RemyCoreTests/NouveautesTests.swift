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

    /// Les AppModel des essais : `NouveautesModel.app` est faible.
    private var gardes: [AppModel] = []

    /// Le modèle des nouveautés sur le catalogue d'essai. L'AppModel (pour les
    /// capacités) a ses propres réglages : il range les « vues » du vrai catalogue.
    func essai(_ capacites: [String], reglages: UserDefaults) -> NouveautesModel {
        let a = app(capacites, reglages: suite())
        gardes.append(a)
        let m = NouveautesModel(reglages: reglages, catalogue: Self.essai)
        m.app = a
        return m
    }

    func testLePremierLancementNeMontreQueLaDerniereMiseAJour() {
        let r = suite()
        let m = essai(["modeles-v1", "lieux-v1", "jauge-v1"], reglages: r)
        m.verifier()
        XCTAssertEqual(Set(m.affichees?.entrees.map(\.id) ?? []), ["modele", "lieux"], "l'historique ne s'impose pas")
        XCTAssertFalse(m.estNouvelle(Self.essai[2]))
        // Parcouru jusqu'au bout : plus jamais à l'ouverture, même après un relancement.
        m.pageVue(1)
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

    /// Parcours P01 : la feuille s'arrêtait à 6 pages, au milieu d'une
    /// entrée, et tout le lot passait pour vu. Des entrées entières dans la
    /// limite (au moins une) ; seules celles montrées sont vues ; la suite
    /// vient au lancement suivant.
    func testUnLongLotNeCoupeJamaisUneEntree() {
        let p = Self.page
        let catalogue = [
            Nouveaute(id: "a", serie: 3, date: "", titre: "A", capacite: nil, pages: [p, p, p]),
            Nouveaute(id: "b", serie: 3, date: "", titre: "B", capacite: nil, pages: [p, p]),
            Nouveaute(id: "c", serie: 3, date: "", titre: "C", capacite: nil, pages: [p, p]),
            Nouveaute(id: "x", serie: 3, date: "", titre: "X", capacite: "inconnue-v1", pages: [p]),
            Nouveaute(id: "d", serie: 3, date: "", titre: "D", capacite: nil, pages: [p, p, p]),
            Nouveaute(id: "e", serie: 3, date: "", titre: "E", capacite: nil, pages: [p]),
        ]
        let r = suite()
        let a = app([], reglages: suite())
        gardes.append(a)
        func lancement() -> NouveautesModel {
            let m = NouveautesModel(reglages: r, catalogue: catalogue)
            m.app = a
            return m
        }
        let m1 = lancement()
        m1.verifier()
        XCTAssertEqual(m1.affichees?.entrees.map(\.id), ["a", "b"], "3 + 2 pages ; « c » ferait 7")
        XCTAssertEqual(m1.affichees?.pages.count, 5, "chaque entrée entière")
        for i in 0..<5 { m1.pageVue(i) }
        m1.fermer()
        XCTAssertFalse(m1.estNouvelle(catalogue[0]))
        XCTAssertTrue(m1.estNouvelle(catalogue[2]), "pas montrée : pas vue")
        m1.verifier()
        XCTAssertNil(m1.affichees, "une feuille par lancement")

        let m2 = lancement()
        m2.verifier()
        XCTAssertEqual(m2.affichees?.entrees.map(\.id), ["c", "d", "e"], "« x » attend la tour")
        m2.pageVue(5)
        m2.fermer()

        let m3 = lancement()
        m3.verifier()
        XCTAssertNil(m3.affichees)
        XCTAssertTrue(m3.estNouvelle(catalogue[3]), "la tour ne la connaît pas : ni montrée, ni vue")

        // Une entrée plus longue que la limite passe quand même, seule et entière.
        XCTAssertEqual(Nouveautes.lot(catalogue, pagesMax: 2).map(\.id), ["a"])
        XCTAssertEqual(Nouveautes.lot([], pagesMax: 6), [])
    }

    /// « Plus tard » (ou la feuille balayée) à la première page : l'entrée
    /// affichée est vue, celles jamais atteintes restent nouvelles et viennent
    /// au lancement suivant.
    func testPlusTardLaisseNouvellesLesEntreesPasAtteintes() {
        let p = Self.page
        let catalogue = [
            Nouveaute(id: "a", serie: 3, date: "", titre: "A", capacite: nil, pages: [p, p, p]),
            Nouveaute(id: "b", serie: 3, date: "", titre: "B", capacite: nil, pages: [p, p]),
        ]
        let r = suite()
        let a = app([], reglages: suite())
        gardes.append(a)
        let m1 = NouveautesModel(reglages: r, catalogue: catalogue)
        m1.app = a
        m1.verifier()
        XCTAssertEqual(m1.affichees?.entrees.map(\.id), ["a", "b"])
        m1.pageVue(1)
        m1.fermer()
        XCTAssertFalse(m1.estNouvelle(catalogue[0]), "affichée : vue")
        XCTAssertTrue(m1.estNouvelle(catalogue[1]), "jamais atteinte : toujours nouvelle")
        let m2 = NouveautesModel(reglages: r, catalogue: catalogue)
        m2.app = a
        m2.verifier()
        XCTAssertEqual(m2.affichees?.entrees.map(\.id), ["b"], "au lancement suivant")
        // La première page de « b » (page 3 du lot d'avant) suffit à la marquer.
        XCTAssertEqual(LotNouveautes(id: "x", entrees: catalogue).entrees(jusqua: 3).map(\.id), ["a", "b"])
        XCTAssertEqual(LotNouveautes(id: "x", entrees: catalogue).entrees(jusqua: 2).map(\.id), ["a"])
    }

    /// Le build 37 coupait sa feuille à 6 pages (« partage », « hors-app »)
    /// et marquait vue toute la série 3 que la tour connaissait. Au premier
    /// lancement d'après, ce qu'il n'a jamais montré redevient nouveau — une
    /// fois : ce qui est vu ensuite le reste.
    func testRepriseDesVuesDuBuild37() {
        let r = suite()
        // Les vues telles que le build 37 les a laissées : l'historique (séries
        // 1 et 2) et toute la série 3 sans capacité (tour sans les nouvelles).
        // Les entrées ajoutées depuis (25/10) n'existaient pas dans le build 37.
        let depuis37: Set<String> = ["capture-hors-ligne"]
        let serie3SansCapacite = Nouveautes.catalogue.filter { $0.serie == 3 && $0.capacite == nil && !depuis37.contains($0.id) }.map(\.id)
        XCTAssertEqual(Array(serie3SansCapacite.prefix(2)), ["partage", "hors-app"], "les 6 premières pages du build 37")
        let anciennes = Nouveautes.catalogue.filter { $0.serie < 3 }.map(\.id)
        r.set((anciennes + serie3SansCapacite).sorted(), forKey: "nouveautes.vues")
        let a = app([], reglages: r)
        a.nouveautes.verifier()
        XCTAssertEqual(a.nouveautes.affichees?.entrees.map(\.id), ["au-pouce", "fil-du-jour"])
        XCTAssertFalse(a.nouveautes.estNouvelle(Nouveautes.catalogue.first { $0.id == "partage" }!), "déjà montrée : pas revue")
        XCTAssertFalse(a.nouveautes.estNouvelle(Nouveautes.catalogue.first { $0.id == "modele" }!), "l'historique ne bouge pas")
        a.nouveautes.pageVue(a.nouveautes.affichees!.pages.count - 1)
        a.nouveautes.fermer()
        // Une seule fois : au lancement suivant, la reprise ne revient pas ;
        // seules les entrées plus récentes, qui n'ont pas tenu dans la feuille,
        // viennent (la série 4 sans capacité derrière la fin de la série 3).
        let b = app([], reglages: r)
        b.nouveautes.verifier()
        XCTAssertEqual(b.nouveautes.affichees?.entrees.map(\.id), ["capture-hors-ligne", "privee-iphone"])
        b.nouveautes.pageVue(b.nouveautes.affichees!.pages.count - 1)
        b.nouveautes.fermer()
        // Puis les séries suivantes (sans capacité : la tour n'en a aucune ici),
        // au lancement d'après, et plus rien ensuite.
        let b2 = app([], reglages: r)
        b2.nouveautes.verifier()
        let suivantes = Nouveautes.catalogue.filter { $0.serie > 4 && $0.capacite == nil }.map(\.id)
        XCTAssertEqual(b2.nouveautes.affichees?.entrees.map(\.id) ?? [], suivantes)
        b2.nouveautes.pageVue(99)
        b2.nouveautes.fermer()
        let b3 = app([], reglages: r)
        b3.nouveautes.verifier()
        XCTAssertNil(b3.nouveautes.affichees)
        // Une installation neuve n'a rien à reprendre : seule la dernière série
        // (ses entrées que la tour connaît : ici, celles sans capacité).
        let neuve = suite()
        let c = app([], reglages: neuve)
        XCTAssertTrue(neuve.bool(forKey: "nouveautes.reprise37"))
        c.nouveautes.verifier()
        let derniere = Nouveautes.catalogue.map(\.serie).max()!
        XCTAssertEqual(c.nouveautes.affichees?.entrees.first?.serie, derniere)
        XCTAssertEqual(c.nouveautes.affichees?.entrees.first?.id, Nouveautes.catalogue.first { $0.serie == derniere && $0.capacite == nil }?.id)
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

    /// Série 4 (27/10) : la conversation privée et la jauge tiennent dans une
    /// seule feuille (règle des 6 pages), entières, dans cet ordre.
    func testLaSerie4TientDansUneFeuille() {
        let serie4 = Nouveautes.catalogue.filter { $0.serie == 4 }
        XCTAssertEqual(serie4.map(\.id), ["privee-iphone", "jauge-retour"])
        XCTAssertEqual(Nouveautes.lot(serie4).map(\.id), ["privee-iphone", "jauge-retour"])
        XCTAssertLessThanOrEqual(serie4.reduce(0) { $0 + $1.pages.count }, Nouveautes.pagesMax)
        // Telle qu'elle s'affichait quand elle était la dernière série.
        let jusqua4 = Nouveautes.catalogue.filter { $0.serie <= 4 }
        let modele = { (capacites: [String]) -> NouveautesModel in
            let a = self.app(capacites, reglages: self.suite())
            self.gardes.append(a)
            let m = NouveautesModel(reglages: self.suite(), catalogue: jusqua4)
            m.app = a
            return m
        }
        let a = modele(["jauge-v1"])
        a.verifier()
        XCTAssertEqual(a.affichees?.entrees.map(\.id), ["privee-iphone", "jauge-retour"])
        // Une tour sans la jauge : la conversation privée seule (elle n'a besoin de rien).
        let b = modele([])
        b.verifier()
        XCTAssertEqual(b.affichees?.entrees.map(\.id), ["privee-iphone"])
    }

    /// Série 5 (29/10) : les conversations d'ailleurs, montrées seulement
    /// quand la tour sait les lire ; une feuille suffit.
    func testLaSerie5AttendLaTour() {
        let serie5 = Nouveautes.catalogue.filter { $0.serie == 5 }
        XCTAssertTrue(serie5.map(\.id).contains("conversations-externes"))
        XCTAssertLessThanOrEqual(Nouveautes.lot(serie5).reduce(0) { $0 + $1.pages.count }, Nouveautes.pagesMax)
        let a = app(["conversations-externes-v1"], reglages: suite())
        a.nouveautes.verifier()
        XCTAssertTrue(a.nouveautes.affichees?.entrees.map(\.id).contains("conversations-externes") == true)
        let b = app([], reglages: suite())
        b.nouveautes.verifier()
        XCTAssertFalse(b.nouveautes.affichees?.entrees.map(\.id).contains("conversations-externes") == true, "la tour ne la connaît pas : cachée")
    }

    /// Série 5 (29/10) : la recherche dans les réglages pour tous ; le bilan à
    /// 22 h 45 seulement si la tour a le rendez-vous quotidien.
    func testLaSerie5() {
        let serie5 = Nouveautes.catalogue.filter { $0.serie == 5 }.map(\.id)
        XCTAssertTrue(serie5.contains("reglages-recherche") && serie5.contains("bilan-coucher"), "\(serie5)")
        let a = app(["rituel-v1"], reglages: suite())
        a.nouveautes.verifier()
        XCTAssertTrue(Set(a.nouveautes.affichees?.entrees.map(\.id) ?? []).isSuperset(of: ["reglages-recherche", "bilan-coucher"]))
        let b = app([], reglages: suite())
        b.nouveautes.verifier()
        XCTAssertFalse(b.nouveautes.affichees?.entrees.map(\.id).contains("bilan-coucher") ?? true, "sans rituel-v1 : pas de bilan")
        XCTAssertTrue(b.nouveautes.affichees?.entrees.map(\.id).contains("reglages-recherche") == true)
    }

    /// Série 5 entière (#24 et #26) : les conversations d'ailleurs, la
    /// recherche dans Réglages et le bilan de 22 h 45 tiennent dans une seule
    /// feuille (règle des 6 pages, entrées entières), dans l'ordre du catalogue.
    func testLaSerie5TientDansUneFeuille() {
        let serie5 = Nouveautes.catalogue.filter { $0.serie == 5 }
        XCTAssertEqual(serie5.map(\.id), ["conversations-externes", "reglages-recherche", "bilan-coucher"])
        XCTAssertLessThanOrEqual(serie5.reduce(0) { $0 + $1.pages.count }, Nouveautes.pagesMax)
        XCTAssertEqual(Nouveautes.lot(serie5).map(\.id), serie5.map(\.id))
        let a = app(["conversations-externes-v1", "rituel-v1"], reglages: suite())
        a.nouveautes.verifier()
        XCTAssertEqual(a.nouveautes.affichees?.entrees.map(\.id), ["conversations-externes", "reglages-recherche", "bilan-coucher"])
    }
}
