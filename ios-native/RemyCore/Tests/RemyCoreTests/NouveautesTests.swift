import XCTest
@testable import RemyCore

/// Les mini tutoriels des mises à jour (21/10) : une fois, seulement quand la
/// tour connaît la fonction ; l'historique garde tout. Le suivi (12/11) : à
/// découvrir, commencé, suivi ; présentés d'office les deux dernières séries.
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
        // Pas « jauge » : un id retiré du vrai catalogue (12/11) serait ignoré.
        Nouveaute(id: "cadran", serie: 1, date: "", titre: "Cadran", capacite: "jauge-v1", pages: [page]),
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
        // Jamais ouverte : « à découvrir » dans le suivi, mais pas présentée.
        XCTAssertEqual(m.etat(Self.essai[2]), .aDecouvrir)
        XCTAssertFalse(m.presentable(Self.essai[2]), "plus ancienne que le premier lancement")
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
        XCTAssertEqual(m1.etat(catalogue[0]), .commence, "page 2 sur 3 : commencée, pas suivie")
        XCTAssertEqual(m1.suivi(de: catalogue[0])?.page, 1)
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
    /// lancement d'après, ce qu'il n'a jamais montré redevient « à découvrir »
    /// — une fois. Depuis le suivi (12/11), ses « vus » deviennent « commencés »
    /// et la série 3, trop ancienne, attend dans le suivi au lieu de revenir.
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
        let m = a.nouveautes
        func entree(_ id: String) -> Nouveaute { Nouveautes.catalogue.first(where: { $0.id == id })! }
        XCTAssertEqual(m.etat(entree("partage")), .commence, "déjà montrée : pas « à découvrir »")
        XCTAssertEqual(m.etat(entree("modele")), .commence, "l'historique ne redevient pas « jamais ouvert »")
        XCTAssertEqual(m.suivi(de: entree("modele"))?.repris, true)
        XCTAssertTrue(m.libelle(entree("modele")).hasPrefix("Commencé · ouvert avant le "), m.libelle(entree("modele")))
        XCTAssertEqual(m.etat(entree("au-pouce")), .aDecouvrir, "jamais montrée par le build 37")
        // Mais trop ancienne pour s'imposer : seules les deux dernières séries
        // (ici, sans capacité : la tour n'en a aucune) sont présentées.
        let derniere = Nouveautes.catalogue.map(\.serie).max()!
        let fraiches = Nouveautes.lot(Nouveautes.catalogue.filter { $0.serie >= derniere - 1 && $0.capacite == nil }.sorted { $0.serie < $1.serie })
        m.verifier()
        XCTAssertEqual(m.affichees?.entrees.map(\.id) ?? [], fraiches.map(\.id))
        XCTAssertFalse(m.affichees?.entrees.contains { $0.serie == 3 } ?? false)
        XCTAssertTrue(m.groupes.first { $0.id == "a-decouvrir" }?.entrees.contains { $0.id == "au-pouce" } == true, "elle attend dans le suivi")
        m.pageVue(99)
        m.fermer()
        // Une seule fois : au lancement suivant, la reprise ne revient pas, et
        // ce qui a été suivi ne revient pas non plus.
        let b = app([], reglages: r)
        XCTAssertEqual(b.nouveautes.etat(entree("au-pouce")), .aDecouvrir)
        b.nouveautes.verifier()
        XCTAssertTrue(Set(b.nouveautes.affichees?.entrees.map(\.id) ?? []).isDisjoint(with: fraiches.map(\.id)))
        // Une installation neuve n'a rien à reprendre : seule la dernière série
        // (ses entrées que la tour connaît : ici, celles sans capacité).
        let neuve = suite()
        let c = app([], reglages: neuve)
        XCTAssertTrue(neuve.bool(forKey: "nouveautes.reprise37"))
        c.nouveautes.verifier()
        if let attendue = Nouveautes.catalogue.first(where: { $0.serie == derniere && $0.capacite == nil }) {
            XCTAssertEqual(c.nouveautes.affichees?.entrees.first?.serie, derniere)
            XCTAssertEqual(c.nouveautes.affichees?.entrees.first?.id, attendue.id)
        } else {
            // Toute la dernière série attend sa tour : rien à montrer.
            XCTAssertNil(c.nouveautes.affichees)
        }
    }

    func testRevoirDepuisLHistorique() {
        let m = essai([], reglages: suite())
        let jauge = Self.essai[2]
        let lot = m.lot(pour: jauge)
        XCTAssertEqual(lot.entrees, [jauge])
        XCTAssertEqual(lot.depart, 0)
        XCTAssertNil(m.affichees, "revoir ne passe pas par la feuille du lancement")
        let modele = Self.essai[0]
        XCTAssertTrue(m.estNouvelle(modele))
        // Une page sur une : affichée, elle est suivie jusqu'au bout.
        m.noter(m.lot(pour: modele), page: 0)
        XCTAssertFalse(m.estNouvelle(modele))
        XCTAssertEqual(m.etat(modele), .suivi)
    }

    func testLeCatalogueResteCourt() {
        let ids = Nouveautes.catalogue.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count, "identifiants uniques")
        // Retirer = l'id dans `retirees`, l'entrée hors du catalogue ; un id
        // retiré ne resert pas (son état gardé serait repris).
        XCTAssertTrue(Set(ids).isDisjoint(with: Nouveautes.retirees.keys), "une entrée retirée est encore au catalogue")
        for n in Nouveautes.catalogue {
            if let r = n.remplace {
                XCTAssertNotEqual(r, n.id, "\(n.id) : une remplaçante a son propre id (elle part « à découvrir »)")
                XCTAssertTrue(ids.contains(r) || Nouveautes.retirees[r] != nil, "\(n.id) remplace « \(r) », inconnue")
            }
        }
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

    /// Le vrai catalogue tel qu'il s'affichait quand `serie` était la
    /// dernière (un premier lancement ne montre que la dernière série).
    func jusqua(_ serie: Int, _ capacites: [String]) -> NouveautesModel {
        let a = app(capacites, reglages: suite())
        gardes.append(a)
        let m = NouveautesModel(reglages: suite(), catalogue: Nouveautes.catalogue.filter { $0.serie <= serie })
        m.app = a
        return m
    }

    /// Série 5 (29/10) : les conversations d'ailleurs, montrées seulement
    /// quand la tour sait les lire ; une feuille suffit.
    func testLaSerie5AttendLaTour() {
        let serie5 = Nouveautes.catalogue.filter { $0.serie == 5 }
        XCTAssertTrue(serie5.map(\.id).contains("conversations-externes"))
        XCTAssertLessThanOrEqual(Nouveautes.lot(serie5).reduce(0) { $0 + $1.pages.count }, Nouveautes.pagesMax)
        let a = jusqua(5, ["conversations-externes-v1"])
        a.verifier()
        XCTAssertTrue(a.affichees?.entrees.map(\.id).contains("conversations-externes") == true)
        let b = jusqua(5, [])
        b.verifier()
        XCTAssertFalse(b.affichees?.entrees.map(\.id).contains("conversations-externes") == true, "la tour ne la connaît pas : cachée")
    }

    /// Série 5 (29/10) : la recherche dans les réglages pour tous. Le bilan
    /// de 22 h 45 (l'annonce d'un changement d'heure par défaut) est retiré
    /// le 12/11 : « rituel » dit déjà « vers 22 h 45 ».
    func testLaSerie5() {
        let serie5 = Nouveautes.catalogue.filter { $0.serie == 5 }.map(\.id)
        XCTAssertTrue(serie5.contains("reglages-recherche"), "\(serie5)")
        XCTAssertFalse(serie5.contains("bilan-coucher"))
        XCTAssertNotNil(Nouveautes.retirees["bilan-coucher"])
        XCTAssertTrue(Nouveautes.catalogue.first { $0.id == "rituel" }?.pages.contains { $0.texte.contains("22 h 45") } == true)
        let b = jusqua(5, [])
        b.verifier()
        XCTAssertTrue(b.affichees?.entrees.map(\.id).contains("reglages-recherche") == true)
    }

    /// Série 5 entière (#24 et #26) : les conversations d'ailleurs et la
    /// recherche dans Réglages tiennent dans une seule feuille (règle des 6
    /// pages, entrées entières), dans l'ordre du catalogue.
    func testLaSerie5TientDansUneFeuille() {
        let serie5 = Nouveautes.catalogue.filter { $0.serie == 5 }
        XCTAssertEqual(serie5.map(\.id), ["conversations-externes", "reglages-recherche"])
        XCTAssertLessThanOrEqual(serie5.reduce(0) { $0 + $1.pages.count }, Nouveautes.pagesMax)
        XCTAssertEqual(Nouveautes.lot(serie5).map(\.id), serie5.map(\.id))
        let a = jusqua(5, ["conversations-externes-v1", "rituel-v1"])
        a.verifier()
        XCTAssertEqual(a.affichees?.entrees.map(\.id), ["conversations-externes", "reglages-recherche"])
    }

    /// Série 6 (soir du 29/10) : l'export ChatGPT pris dans Téléchargements,
    /// la carte du rappel, Claude Code et T3 bien trouvés — seulement quand la
    /// tour le sait (conversations-externes-v2) ; une feuille.
    func testLaSerie6AttendLaTour() {
        let serie6 = Nouveautes.catalogue.filter { $0.serie == 6 }
        XCTAssertEqual(serie6.map(\.id), ["chatgpt-automatique"])
        XCTAssertLessThanOrEqual(serie6.reduce(0) { $0 + $1.pages.count }, Nouveautes.pagesMax)
        let a = jusqua(6, ["conversations-externes-v1", ConversationsExternes.capaciteExport])
        a.verifier()
        XCTAssertEqual(a.affichees?.entrees.map(\.id), ["chatgpt-automatique"])
        let b = jusqua(6, ["conversations-externes-v1"])
        b.verifier()
        XCTAssertNil(b.affichees, "une tour pas encore à jour : rien à présenter")
        // Le premier export attend ton accord : la page le dit (contre-relecture du 30/10, tour 2).
        XCTAssertTrue(serie6[0].pages[0].texte.contains("te demande ton accord"))
        XCTAssertFalse(serie6.flatMap(\.pages).contains { $0.texte.contains("prend le .zip") })
    }

    /// Série 7 (30/10) : la carte d'un export trouvé dans Téléchargements,
    /// seulement quand la tour la connaît (telechargements-accord-v1).
    func testLaSerie7AttendLaTour() {
        let serie7 = Nouveautes.catalogue.filter { $0.serie == 7 }
        XCTAssertEqual(serie7.map(\.id), ["telechargements-accord"])
        let a = jusqua(7, ["conversations-externes-v1", ConversationsExternes.capaciteExport, ConversationsExternes.capaciteAccord])
        a.verifier()
        XCTAssertEqual(a.affichees?.entrees.map(\.id), ["telechargements-accord"])
        let b = jusqua(7, ["conversations-externes-v1", ConversationsExternes.capaciteExport])
        b.verifier()
        XCTAssertNil(b.affichees, "une tour pas encore à jour : rien à présenter")
    }

    /// Série 8 (11/11) : la fiche d'un rappel (note, alertes, lieu), seulement
    /// quand la tour sait les garder (rappels-declencheurs-v1).
    func testLaSerie8AttendLaTour() {
        let serie8 = Nouveautes.catalogue.filter { $0.serie == 8 }
        XCTAssertEqual(serie8.map(\.id), ["rappels-declencheurs"])
        XCTAssertLessThanOrEqual(serie8.reduce(0) { $0 + $1.pages.count }, Nouveautes.pagesMax)
        // Telle qu'elle s'affichait quand elle était la dernière série.
        let a = jusqua(8, ["rappels-declencheurs-v1"])
        a.verifier()
        XCTAssertEqual(a.affichees?.entrees.map(\.id), ["rappels-declencheurs"])
        let b = jusqua(8, ["rituel-v1"])
        b.verifier()
        XCTAssertNil(b.affichees, "une tour pas encore à jour : rien à présenter")
    }

    /// Série 9 (12/11) : chercher dans Projets. Rien à attendre de la tour
    /// (la recherche lit ce que l'app a déjà) : montrée à tous, une feuille.
    func testLaSerie9EstPourTous() {
        let serie9 = Nouveautes.catalogue.filter { $0.serie == 9 }
        XCTAssertEqual(serie9.map(\.id), ["recherche-projets"])
        XCTAssertNil(serie9[0].capacite)
        XCTAssertLessThanOrEqual(serie9.reduce(0) { $0 + $1.pages.count }, Nouveautes.pagesMax)
        let a = app([], reglages: suite())
        a.nouveautes.verifier()
        XCTAssertEqual(a.nouveautes.affichees?.entrees.map(\.id), ["recherche-projets"])
        let b = app(Nouveautes.catalogue.compactMap(\.capacite), reglages: suite())
        b.nouveautes.verifier()
        XCTAssertEqual(b.nouveautes.affichees?.entrees.map(\.id), ["recherche-projets"], "une tour à jour : la dernière série seule")
    }

    // MARK: - Le suivi (12/11)

    /// Un tutoriel de trois pages : à découvrir, commencé (page 2 sur 3, avec
    /// sa date), repris à sa page, puis suivi à la dernière — jamais en arrière,
    /// et gardé d'un lancement à l'autre.
    func testTroisEtatsEtLaRepriseALaPage() {
        let p = Self.page
        let trois = Nouveaute(id: "trois", serie: 1, date: "1 nov.", titre: "Trois", capacite: nil, pages: [p, p, p])
        let r = suite()
        let a = app([], reglages: suite())
        gardes.append(a)
        let m = NouveautesModel(reglages: r, catalogue: [trois])
        m.app = a
        XCTAssertEqual(m.etat(trois), .aDecouvrir)
        XCTAssertEqual(m.libelle(trois), "À découvrir · paru le 1 nov.")
        XCTAssertEqual(m.indice(trois), "Ouvre le tutoriel")
        XCTAssertEqual(m.lot(pour: trois).depart, 0)
        // Ouvert, arrêté à la deuxième page, le 3 novembre.
        let le3 = Date(timeIntervalSince1970: 1_793_700_000) // 3 nov. 2026, 11 h (Paris)
        XCTAssertEqual(Nouveautes.jour(le3), "3 nov.")
        m.noter(m.lot(pour: trois), page: 0, maintenant: le3)
        m.noter(m.lot(pour: trois), page: 1, maintenant: le3.addingTimeInterval(60))
        XCTAssertEqual(m.etat(trois), .commence)
        XCTAssertEqual(m.suivi(de: trois)?.page, 1)
        XCTAssertEqual(m.suivi(de: trois)?.date, le3, "la date de l'ouverture")
        XCTAssertEqual(m.libelle(trois), "Commencé le 3 nov. · page 2 sur 3")
        // La reprise : à la page où il s'était arrêté, même après un relancement.
        let m2 = NouveautesModel(reglages: r, catalogue: [trois])
        m2.app = a
        let reprise = m2.lot(pour: trois)
        XCTAssertEqual(reprise.depart, 1)
        XCTAssertEqual(m2.indice(trois), "Reprend à la page 2")
        let le5 = le3.addingTimeInterval(2 * 86_400)
        m2.noter(reprise, page: 2, maintenant: le5)
        XCTAssertEqual(m2.etat(trois), .suivi)
        XCTAssertEqual(m2.libelle(trois), "Suivi le 5 nov.")
        // Revu depuis le début : il reste suivi, sa date ne bouge pas.
        XCTAssertEqual(m2.lot(pour: trois).depart, 0, "suivi : on le revoit depuis le début")
        m2.noter(m2.lot(pour: trois), page: 0, maintenant: le5.addingTimeInterval(86_400))
        XCTAssertEqual(m2.etat(trois), .suivi)
        XCTAssertEqual(m2.suivi(de: trois)?.date, le5)
        // Un lot de plusieurs entrées : la dépassée est suivie, la suivante commencée.
        let un = Nouveaute(id: "un", serie: 1, date: "", titre: "Un", capacite: nil, pages: [p, p])
        let deux = Nouveaute(id: "deux", serie: 1, date: "", titre: "Deux", capacite: nil, pages: [p, p])
        let m3 = NouveautesModel(reglages: suite(), catalogue: [un, deux])
        m3.noter(LotNouveautes(id: "x", entrees: [un, deux]), page: 2)
        XCTAssertEqual(m3.etat(un), .suivi)
        XCTAssertEqual(m3.etat(deux), .commence)
        XCTAssertEqual(m3.suivi(de: deux)?.page, 0)
    }

    /// La reprise de l'état d'avant (« vus ») : rien ne redevient « jamais
    /// ouvert » ; un vu devient « commencé » (on ne sait pas s'il a été fini),
    /// daté du jour de la reprise, une seule fois.
    func testLaMigrationDesVues() {
        let r = suite()
        r.set(["modele", "cadran", "disparue"], forKey: "nouveautes.vues")
        r.set(true, forKey: "nouveautes.reprise37")
        let le12 = Date(timeIntervalSince1970: 1_794_480_000) // 12 nov. 2026
        let a = app(["modeles-v1", "lieux-v1", "jauge-v1"], reglages: suite())
        gardes.append(a)
        let m = NouveautesModel(reglages: r, catalogue: Self.essai, maintenant: le12)
        m.app = a
        XCTAssertEqual(m.etat(Self.essai[0]), .commence)
        XCTAssertEqual(m.etat(Self.essai[2]), .commence)
        XCTAssertEqual(m.etat(Self.essai[1]), .aDecouvrir, "pas vue avant : à découvrir")
        XCTAssertEqual(m.libelle(Self.essai[0]), "Commencé · ouvert avant le 12 nov.")
        XCTAssertNotNil(r.data(forKey: "nouveautes.suivi"), "gardée sous la nouvelle clé")
        XCTAssertEqual(m.resume, "2 à découvrir · 2 commencés · 0 suivi", "« disparue » n'est plus au catalogue : pas comptée")
        // Une installation d'avant le suivi n'a pas de série de départ : les
        // deux dernières séries (ici, 1 et 2) peuvent encore se présenter.
        m.verifier()
        XCTAssertEqual(m.affichees?.entrees.map(\.id), ["selection", "lieux"], "de la plus ancienne série à la plus récente")
        // Rouvert, un « repris » prend la date du jour.
        m.noter(m.lot(pour: Self.essai[2]), page: 0, maintenant: le12.addingTimeInterval(86_400))
        XCTAssertEqual(m.libelle(Self.essai[2]), "Suivi le 13 nov.")
        // Une seule fois : l'ancienne clé n'est plus relue.
        r.set(["lieux"], forKey: "nouveautes.vues")
        let m2 = NouveautesModel(reglages: r, catalogue: Self.essai)
        XCTAssertEqual(m2.etat(Self.essai[1]), .aDecouvrir)
        XCTAssertEqual(m2.etat(Self.essai[2]), .suivi)
    }

    /// La péremption : présentées d'office, seulement les deux dernières
    /// séries ; les plus anciennes attendent dans le suivi, sans s'imposer. Une
    /// entrée « à remplacer » ne se présente plus, mais reste suivie.
    func testLesVieillesNouveautesAttendentDansLeSuivi() {
        let p = Self.page
        let catalogue = [
            Nouveaute(id: "s4", serie: 4, date: "", titre: "S4", capacite: nil, pages: [p]),
            Nouveaute(id: "s4-change", serie: 4, date: "", titre: "Va changer", capacite: nil, pages: [p], aRemplacer: true),
            Nouveaute(id: "s3", serie: 3, date: "", titre: "S3", capacite: nil, pages: [p]),
            Nouveaute(id: "s2", serie: 2, date: "", titre: "S2", capacite: nil, pages: [p]),
            Nouveaute(id: "s1", serie: 1, date: "", titre: "S1", capacite: nil, pages: [p]),
        ]
        let r = suite()
        r.set([String](), forKey: "nouveautes.vues") // une installation d'avant, rien de vu
        let a = app([], reglages: suite())
        gardes.append(a)
        let m = NouveautesModel(reglages: r, catalogue: catalogue)
        m.app = a
        XCTAssertEqual(Nouveautes.seriesPresentees, 2)
        XCTAssertEqual(m.serieMinimale, 3)
        m.verifier()
        XCTAssertEqual(m.affichees?.entrees.map(\.id), ["s3", "s4"], "ni s1, ni s2, ni celle à remplacer")
        m.pageVue(1)
        m.fermer()
        XCTAssertEqual(m.etat(catalogue[1]), .aDecouvrir)
        XCTAssertTrue(m.libelle(catalogue[1]).hasSuffix("· bientôt remplacé"))
        XCTAssertEqual(m.groupes.first?.id, "a-decouvrir", "à découvrir d'abord")
        XCTAssertEqual(m.groupes.first?.entrees.map(\.id), ["s4-change", "s2", "s1"], "la plus récente d'abord")
        let m2 = NouveautesModel(reglages: r, catalogue: catalogue)
        m2.app = a
        m2.verifier()
        XCTAssertNil(m2.affichees, "le reste n'est jamais présenté d'office")
        // Le vrai catalogue : « Ce qui compte » ne se présente plus, nulle part.
        let priorites = Nouveautes.catalogue.first { $0.id == "priorites" }
        XCTAssertEqual(priorites?.aRemplacer, true)
        let p3 = jusqua(3, Nouveautes.catalogue.compactMap(\.capacite))
        var montrees: [String] = []
        for _ in 0..<12 {
            let l = NouveautesModel(reglages: p3.reglages, catalogue: p3.catalogue)
            l.app = p3.app
            l.verifier()
            guard let lot = l.affichees else { break }
            montrees += lot.entrees.map(\.id)
            l.pageVue(lot.pages.count - 1)
            l.fermer()
        }
        XCTAssertFalse(montrees.isEmpty)
        XCTAssertFalse(montrees.contains("priorites"), "\(montrees)")
    }

    /// Retirer une entrée : son état gardé ne casse rien ; elle sort du
    /// suivi, des comptes et du lancement.
    func testUneEntreeRetireeDisparaitDuSuiviEtDuLancement() {
        let p = Self.page
        let catalogue = [
            Nouveaute(id: "gardee", serie: 2, date: "", titre: "Gardée", capacite: nil, pages: [p]),
            Nouveaute(id: "partie", serie: 2, date: "", titre: "Partie", capacite: nil, pages: [p, p]),
        ]
        let r = suite()
        r.set(["partie"], forKey: "nouveautes.vues")
        let a = app([], reglages: suite())
        gardes.append(a)
        let m = NouveautesModel(reglages: r, catalogue: catalogue, retirees: ["partie"])
        m.app = a
        XCTAssertEqual(m.historique.map(\.id), ["gardee"])
        XCTAssertFalse(m.groupes.flatMap(\.entrees).contains { $0.id == "partie" })
        XCTAssertEqual(m.resume, "1 à découvrir · 0 commencé · 0 suivi")
        m.verifier()
        XCTAssertEqual(m.affichees?.entrees.map(\.id), ["gardee"])
        m.fermer()
        XCTAssertTrue(m.aMarquer.isEmpty)
        // Le vrai catalogue : rien de retiré dans le suivi.
        let vrai = app(Nouveautes.catalogue.compactMap(\.capacite), reglages: suite()).nouveautes
        XCTAssertTrue(Set(vrai.groupes.flatMap(\.entrees).map(\.id)).isDisjoint(with: Nouveautes.retirees.keys))
        XCTAssertNil(vrai.historique.first { $0.id == "jauge" || $0.id == "compactage" || $0.id == "bilan-coucher" })
    }

    /// Remplacer : la nouvelle a son propre id, « à découvrir » même pour qui
    /// a suivi l'ancienne ; l'ancienne sort du suivi dès que la tour connaît
    /// la nouvelle (avant, c'est encore elle qui décrit la fonction).
    func testUneRemplacanteSortLAncienneEtPartADecouvrir() {
        let p = Self.page
        let catalogue = [
            Nouveaute(id: "classement", serie: 3, date: "", titre: "Le classement", capacite: "classement-v1", pages: [p], remplace: "ancienne"),
            Nouveaute(id: "ancienne", serie: 2, date: "", titre: "Écris-les", capacite: nil, pages: [p], aRemplacer: true),
        ]
        let r = suite()
        let sans = app([], reglages: suite())
        gardes.append(sans)
        let m = NouveautesModel(reglages: r, catalogue: catalogue)
        m.app = sans
        m.noter(m.lot(pour: catalogue[1]), page: 0)
        XCTAssertEqual(m.etat(catalogue[1]), .suivi)
        XCTAssertEqual(m.historique.map(\.id), ["classement", "ancienne"], "la tour ne connaît pas encore la nouvelle")
        XCTAssertEqual(m.groupes.last?.id, "tour")
        let avec = app(["classement-v1"], reglages: suite())
        gardes.append(avec)
        let m2 = NouveautesModel(reglages: r, catalogue: catalogue)
        m2.app = avec
        XCTAssertEqual(m2.historique.map(\.id), ["classement"])
        XCTAssertEqual(m2.etat(catalogue[0]), .aDecouvrir, "suivre l'ancienne ne dispense pas de la nouvelle")
        XCTAssertEqual(m2.resume, "1 à découvrir · 0 commencé · 0 suivi")
        m2.verifier()
        XCTAssertEqual(m2.affichees?.entrees.map(\.id), ["classement"])
    }

    /// « Tout marquer comme suivi », puis « Annuler » : l'état d'avant revient
    /// tel quel (commencés compris). Ce qui attend la tour n'est pas rangé.
    func testToutMarquerCommeSuiviSAnnule() {
        let r = suite()
        let m = essai(["modeles-v1", "jauge-v1"], reglages: r)
        m.noter(m.lot(pour: Self.essai[0]), page: 0)
        XCTAssertEqual(m.resume, "2 à découvrir · 0 commencé · 1 suivi")
        XCTAssertEqual(Set(m.aMarquer.map(\.id)), ["cadran", "selection"], "« lieux » attend la tour")
        XCTAssertEqual(m.toutMarquerSuivi(), 2)
        XCTAssertEqual(m.resume, "0 à découvrir · 0 commencé · 3 suivis")
        XCTAssertEqual(m.groupes.map(\.id), ["suivis", "tour"])
        XCTAssertEqual(m.app?.message?.texte, "2 tutoriels marqués comme suivis.")
        m.app?.message?.annuler?()
        XCTAssertEqual(m.resume, "2 à découvrir · 0 commencé · 1 suivi")
        XCTAssertEqual(m.etat(Self.essai[2]), .aDecouvrir)
        // Gardé : un relancement voit l'état rétabli.
        let m2 = essai(["modeles-v1", "jauge-v1"], reglages: r)
        XCTAssertEqual(m2.etat(Self.essai[0]), .suivi)
        XCTAssertEqual(m2.etat(Self.essai[3]), .aDecouvrir)
        XCTAssertEqual(m2.toutMarquerSuivi(), 2)
        XCTAssertEqual(m2.toutMarquerSuivi(), 0, "rien de plus à ranger")
    }

    func testLeResumeSAccorde() {
        XCTAssertEqual(Nouveautes.resume(aDecouvrir: 0, commences: 1, suivis: 0), "0 à découvrir · 1 commencé · 0 suivi")
        XCTAssertEqual(Nouveautes.resume(aDecouvrir: 3, commences: 2, suivis: 22), "3 à découvrir · 2 commencés · 22 suivis")
        XCTAssertEqual(EtatTutoriel.aDecouvrir.symbole, "circle")
        XCTAssertNotEqual(EtatTutoriel.commence.symbole, EtatTutoriel.suivi.symbole, "la forme dit l'état, pas la couleur seule")
    }
}
