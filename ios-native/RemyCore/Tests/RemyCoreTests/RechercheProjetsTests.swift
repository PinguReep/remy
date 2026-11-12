import XCTest
@testable import RemyCore

/// Chercher dans Projets (12/11) : les mêmes cas que test/site-recherche-projets.test.mjs
/// (données FICTIVES : Sam, Léa, Hugo, la boutique de bougies).
final class RechercheProjetsTests: XCTestCase {
    static var projets: [Projet] {
        var p1 = Projet(id: "p1", nom: "Boutique de bougies", taches: 3)
        p1.liste = [TacheResume(id: "t1", titre: "Finaliser la démo de la boutique", duree: 120),
                    TacheResume(id: "t2", titre: "Commander les mèches en coton"),
                    TacheResume(id: "t3", titre: "Préparer la caisse de bougies")]
        var p2 = Projet(id: "p2", nom: "Album « Été »", taches: 1)
        p2.liste = [TacheResume(id: "t4", titre: "Retoucher les photos de l'été"),
                    TacheResume(id: "t1", titre: "Finaliser la démo de la boutique")]
        return [p1, p2]
    }
    static let dossiers = [
        Dossier(id: "d-demo", nom: "Démo client", parent: "motion:p1", taches: ["t1"]),
        Dossier(id: "d-maison", nom: "Maison", notes: [NoteDossier(id: "n1", texte: "Devis plombier")]),
        Dossier(id: "d-cuisine", nom: "Travaux cuisine", parent: "d-maison",
                notes: [NoteDossier(id: "n2", texte: "Choisir le carrelage", fait: true), NoteDossier(id: "n3", texte: "Carrelage mural blanc")]),
        Dossier(id: "idees", nom: "Idées", notes: [NoteDossier(id: "n4", texte: "Un atelier bougies parfumées pour les fêtes")]),
    ]
    static let listes = [
        Liste(id: "l-courses", nom: "Courses", elements: [ElementListe(id: "e1", texte: "Lait d'avoine"), ElementListe(id: "e2", texte: "Œufs"),
                                                          ElementListe(id: "e3", texte: "Café", fait: true)]),
        Liste(id: "l-anniv", nom: "Anniversaires", elements: [ElementListe(id: "e4", texte: "Léa — 14 mars"), ElementListe(id: "e5", texte: "Hugo — 2 juin")]),
        Liste(id: "l-vide", nom: "Cadeaux"),
    ]
    static let rappels = [
        Rappel(id: "r1", texte: "Rendre le livre à Léa"),
        Rappel(id: "r2", texte: "Rappeler Hugo", quand: 1_800_000_000_000),
        Rappel(id: "r3", texte: "Renouveler le passeport", note: "Photos d'identité et ancien passeport."),
        Rappel(id: "r4", texte: "Appeler Léa", fait: true),
    ]

    func chercher(_ q: String, projets: [Projet]? = RechercheProjetsTests.projets,
                  rappels: [Rappel] = RechercheProjetsTests.rappels) -> ResultatsProjets {
        RechercheProjets.chercher(q, projets: projets, dossiers: RechercheProjetsTests.dossiers,
                                  listes: RechercheProjetsTests.listes, rappels: rappels)
    }
    func ids(_ r: ResultatsProjets, _ genre: GenreTrouve) -> [String] {
        r.groupes.first { $0.genre == genre }?.elements.map(\.id) ?? []
    }

    func testUneSaisieVideNeChercheRien() {
        for q in ["", "   ", "…"] {
            let r = chercher(q)
            XCTAssertTrue(r.vide, q)
            XCTAssertTrue(r.groupes.isEmpty)
            XCTAssertNil(r.titreVide)
            XCTAssertNil(r.enTete)
        }
    }

    func testChaqueGenreEstTrouveGroupeAvecSonEcran() {
        let r = chercher("léa")
        XCTAssertEqual(r.groupes.map(\.genre), [.article, .rappel])
        XCTAssertEqual(ids(r, .article), ["article:l-anniv/e4"])
        XCTAssertEqual(ids(r, .rappel), ["rappel:r1", "rappel:r4"], "le fait après ce qui reste à faire")
        XCTAssertEqual(r.groupes[0].titre, "Articles")
        XCTAssertEqual(r.groupes[0].elements[0].cible, .liste("l-anniv"))
        XCTAssertEqual(r.groupes[0].elements[0].contexte, "Anniversaires")
        XCTAssertEqual(r.groupes[1].elements[0].cible, .rappel("r1"))
        XCTAssertEqual(r.enTete, "3 résultats")

        let b = chercher("bougies")
        XCTAssertEqual(b.groupes.map(\.genre), [.projet, .tache, .note])
        XCTAssertEqual(b.groupes[0].elements[0].cible, .projet("p1"))
        XCTAssertEqual(b.groupes[0].elements[0].contexte, "3 tâches")
        XCTAssertEqual(b.groupes[1].elements[0].id, "tache:t3")
        XCTAssertEqual(b.groupes[1].elements[0].contexte, "Boutique de bougies")
        XCTAssertEqual(b.groupes[2].elements[0].cible, .dossier("idees"))
        XCTAssertEqual(b.groupes[2].elements[0].contexte, "Idées")
        XCTAssertEqual(GenreTrouve.allCases.map(\.titre), ["Projets Motion", "Tâches", "Dossiers", "Idées et notes", "Listes", "Articles", "Rappels"])
    }

    func testSansAccentsNiMajusculesMotAMotLeDebutSuffit() {
        XCTAssertEqual(ids(chercher("DEMO"), .tache), ["tache:t1"])
        XCTAssertEqual(ids(chercher("demo"), .dossier), ["dossier:d-demo"])
        XCTAssertEqual(ids(chercher("oeufs"), .article), ["article:l-courses/e2"], "« œ » se cherche « oe »")
        XCTAssertEqual(ids(chercher("avo lait"), .article), ["article:l-courses/e1"])
        XCTAssertEqual(ids(chercher("cafe"), .article), ["article:l-courses/e3"])
        XCTAssertEqual(ids(chercher("meches coton"), .tache), ["tache:t2"])
        XCTAssertEqual(chercher("aisse").total, 0, "un mot au milieu d'un autre ne compte pas")
        XCTAssertEqual(chercher("lait cafe").total, 0, "tous les mots doivent y être")
        XCTAssertEqual(ids(chercher("le livre de Léa"), .rappel), ["rappel:r1"], "les mots vides de sens ne comptent pas")
    }

    func testUneTacheUneSeuleFoisAvecSonSousProjetEtSaCible() {
        let r = chercher("finaliser")
        XCTAssertEqual(ids(r, .tache), ["tache:t1"])
        let t = r.groupes[0].elements[0]
        XCTAssertEqual(t.contexte, "Boutique de bougies › Démo client")
        guard case .tache(let tache, let noeud) = t.cible else { return XCTFail("\(t.cible)") }
        XCTAssertEqual(noeud, "d-demo", "rangée : son sous-projet")
        XCTAssertEqual(tache.projet, "Boutique de bougies")
        XCTAssertEqual(tache.duree, 120)
        guard case .tache(_, let noeud2) = chercher("meches").groupes[0].elements[0].cible else { return XCTFail() }
        XCTAssertEqual(noeud2, "motion:p1", "pas rangée : son projet")
    }

    func testDossiersEtIdees() {
        let r = chercher("carrelage")
        XCTAssertEqual(ids(r, .note), ["note:d-cuisine/n3", "note:d-cuisine/n2"], "le texte qui commence par la saisie d'abord")
        XCTAssertTrue(r.groupes[0].elements[1].fait)
        XCTAssertEqual(r.groupes[0].elements[0].cible, .dossier("d-cuisine"))
        XCTAssertEqual(chercher("travaux").groupes[0].elements[0].contexte, "Dans « Maison »")
        XCTAssertEqual(chercher("démo client").groupes.first { $0.genre == .dossier }?.elements[0].contexte, "Dans « Boutique de bougies »")
        XCTAssertNil(chercher("maison").groupes[0].elements[0].contexte)
    }

    func testListesEtRappels() {
        XCTAssertEqual(chercher("courses").groupes[0].elements[0].contexte, "2 à prendre")
        XCTAssertEqual(chercher("cadeaux").groupes[0].elements[0].contexte, "vide")
        let r = chercher("identité")
        XCTAssertEqual(ids(r, .rappel), ["rappel:r3"], "la note d'un rappel compte")
        XCTAssertEqual(r.groupes[0].elements[0].contexte, "Photos d'identité et ancien passeport.")
        XCTAssertGreaterThan(chercher("passeport").groupes[0].elements[0].note, chercher("ancien").groupes[0].elements[0].note, "le titre avant la note")
        XCTAssertEqual(chercher("rappeler").groupes[0].elements[0].quand, 1_800_000_000_000)
    }

    func testLeMieuxNoteDAbord() {
        let rappels = [Rappel(id: "a", texte: "Penser aux rappels de vaccin"), Rappel(id: "b", texte: "Rappel du dentiste"),
                       Rappel(id: "c", texte: "Le rappel de la banque")]
        XCTAssertEqual(ids(chercher("rappel", rappels: rappels), .rappel), ["rappel:b", "rappel:c", "rappel:a"])
    }

    func testLesMorceauxDuTexteTrouve() {
        XCTAssertEqual(RechercheProjets.morceaux("Lait d'avoine", ["avo", "lait"]),
                       [MorceauTrouve(texte: "Lait", trouve: true), MorceauTrouve(texte: " d'", trouve: false),
                        MorceauTrouve(texte: "avo", trouve: true), MorceauTrouve(texte: "ine", trouve: false)])
        XCTAssertEqual(RechercheProjets.morceaux("Œufs frais", ["oe"]),
                       [MorceauTrouve(texte: "Œ", trouve: true), MorceauTrouve(texte: "ufs frais", trouve: false)])
        XCTAssertEqual(RechercheProjets.morceaux("Démo", ["dem"]),
                       [MorceauTrouve(texte: "Dém", trouve: true), MorceauTrouve(texte: "o", trouve: false)])
        XCTAssertEqual(RechercheProjets.morceaux("Rien", ["xyz"]), [MorceauTrouve(texte: "Rien", trouve: false)])
        XCTAssertEqual(RechercheProjets.morceaux("", ["a"]), [])
        let r = chercher("bougies")
        for g in r.groupes {
            for e in g.elements { XCTAssertEqual(e.morceaux.map(\.texte).joined(), e.titre, "recollés, ils redonnent le texte") }
        }
        XCTAssertTrue(r.groupes[0].elements[0].morceaux.contains(MorceauTrouve(texte: "bougies", trouve: true)))
    }

    func testLEtatVide() {
        let r = chercher("trampoline")
        XCTAssertEqual(r.total, 0)
        XCTAssertTrue(r.groupes.isEmpty)
        XCTAssertEqual(r.titreVide, "Rien pour « trampoline ».")
        XCTAssertTrue(r.detailVide?.contains("autre mot") == true)
        XCTAssertFalse(r.detailVide?.contains("pas encore lus") == true)
        let sans = chercher("trampoline", projets: nil)
        XCTAssertTrue(sans.detailVide?.contains("projets Motion ne sont pas encore lus") == true)
        XCTAssertEqual(ids(chercher("léa", projets: nil), .rappel), ["rappel:r1", "rappel:r4"], "sans projets, le reste se cherche")
        XCTAssertEqual(chercher("1").enTete, "1 résultat")
    }

    func testAuPlusVingtParGenreLeResteCompte() {
        let beaucoup = (0..<27).map { Rappel(id: "r\($0)", texte: "Appeler Sam \($0)") }
        let r = chercher("sam", rappels: beaucoup)
        XCTAssertEqual(r.total, 27)
        XCTAssertEqual(r.groupes[0].elements.count, RechercheProjets.parGroupe)
        XCTAssertEqual(r.groupes[0].reste, 7)
        XCTAssertEqual(r.groupes[0].total, 27)
        XCTAssertEqual(RechercheProjets.phraseReste(7), "et 7 autres : précise ta recherche")
        XCTAssertEqual(RechercheProjets.phraseReste(1), "et 1 autre : précise ta recherche")
    }
}
