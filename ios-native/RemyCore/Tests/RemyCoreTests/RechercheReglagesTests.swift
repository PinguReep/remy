import XCTest
@testable import RemyCore

/// Chercher dans les réglages (29/10) : l'index, les synonymes, l'ordre des
/// résultats, les états vides, ce que la tour ne propose pas, et l'accord
/// entre l'index et les vues (une ligne oubliée fait échouer).
final class RechercheReglagesTests: XCTestCase {
    /// Une tour à jour, tous ses réglages dits, les interrupteurs allumés.
    static var tout: ContexteReglages {
        let capacites: Set<String> = ["rituel-v1", "dossiers-v1", "modeles-v1", "lieux-v1", "activite-pc-v1", "priorites-v1",
                                      "regles-v1", "appareils", "a-trancher-v1", "recherche-privee-v1"]
        let r = Reglages(secoursCloud: false, secoursCloudSansObjet: false,
                         circuits: ["nuit": Circuit(nom: "nuit", actif: true), "conseil": Circuit(nom: "conseil", actif: true),
                                    "compactage": Circuit(nom: "compactage", actif: true), "regles": Circuit(nom: "regles", actif: true)],
                         rechercheWeb: true, contexteCloud: false, rechercheLocale: nil, recherchePriveeReglage: false)
        return ContexteReglages(capacites: capacites, reglages: r, couts: true, briefing: true, bilan: true,
                                activiteEnDirect: true, lieuxActifs: true)
    }

    func ids(_ q: String, _ c: ContexteReglages = tout) -> [String] {
        RechercheReglages.chercher(q, contexte: c).entrees.map(\.id)
    }

    // MARK: L'index

    func testLIndexEstSansDoublon() {
        let index = RechercheReglages.index
        XCTAssertEqual(Set(index.map(\.id)).count, index.count, "deux entrées ont le même identifiant")
        let ancres = index.compactMap { e in e.ancre.map { "\(e.ecran.rawValue)·\($0)" } }
        XCTAssertEqual(Set(ancres).count, ancres.count, "deux entrées visent la même ligne")
        for e in index {
            XCTAssertFalse(e.titre.isEmpty, e.id)
            XCTAssertFalse(e.sousTitre.isEmpty, e.id)
            XCTAssertFalse(e.symbole.isEmpty, e.id)
            if let t = e.tutoriel {
                XCTAssertTrue(Nouveautes.catalogue.contains { $0.id == t }, "\(e.id) : tutoriel « \(t) » absent des Nouveautés")
            }
        }
    }

    /// Les sous-écrans sont dans l'index, pas seulement Réglages.
    func testLesSousEcransSontIndexes() {
        let ecrans = Set(RechercheReglages.index.filter { $0.ancre != nil }.map(\.ecran))
        for e in [EcranReglages.reglages, .diagnostic, .lieux, .activitePC, .usage] {
            XCTAssertTrue(ecrans.contains(e), "aucun réglage de « \(e.titre) » dans l'index")
        }
        XCTAssertEqual(Set(RechercheReglages.index.compactMap(\.section)), ["Rendez-vous quotidien", "Capture", "Activité en direct"])
    }

    // MARK: Les mots du propriétaire

    func testNotifTrouveLesNotifications() {
        let r = ids("notif")
        XCTAssertTrue(r.contains("rituel.matin") && r.contains("rituel.soir"), "\(r)")
        XCTAssertTrue(r.contains("iphone"), "les autorisations d'iOS aussi : \(r)")
        XCTAssertTrue(["rituel.matin", "rituel.soir"].contains(r.first ?? ""), "\(r)")
    }

    func testBilanJaugePriveLocalisationModeleSiri() {
        XCTAssertEqual(ids("bilan").first, "rituel.soir")
        XCTAssertTrue(ids("bilan").contains("rituel.heureSoir"))
        XCTAssertEqual(ids("jauge").first, "diagnostic.jauge")
        XCTAssertEqual(ids("privé").first, "privee")
        XCTAssertTrue(ids("privé").contains("secours"), "le secours Claude dit « jamais pour une conversation privée »")
        XCTAssertEqual(ids("localisation").first, "lieux")
        XCTAssertEqual(ids("modèle").first, "modeles")
        XCTAssertEqual(ids("modele").first, "modeles", "sans accent")
        let siri = ids("Siri")
        XCTAssertTrue(siri.contains("hors-app") && siri.contains("iphone"), "\(siri)")
    }

    func testSynonymes() {
        XCTAssertEqual(ids("sombre").first, "apparence")
        XCTAssertEqual(ids("thème").first, "apparence")
        XCTAssertEqual(ids("dark").first, "apparence")
        XCTAssertEqual(ids("GPS").first, "lieux")
        XCTAssertEqual(ids("tok/s").first, "diagnostic.vitesse")
        XCTAssertEqual(ids("lenteur").first, "diagnostic.temps")
        XCTAssertEqual(ids("Dynamic Island").first, "activite")
        XCTAssertEqual(Set(ids("Anthropic").prefix(2)), ["secours", "contexte"])
        XCTAssertEqual(ids("coucher").first, "rituel.soir")
        XCTAssertEqual(ids("widget").first, "hors-app")
        XCTAssertEqual(ids("deepseek").first, "modeles")
        XCTAssertEqual(ids("ActivityWatch").first, "activitePC")
        XCTAssertEqual(ids("prix").first, "couts")
        XCTAssertEqual(ids("déconnexion").first, "deconnexion")
        XCTAssertEqual(ids("idées").first, "capture")
        XCTAssertEqual(ids("priorités").first, "priorites")
        XCTAssertEqual(ids("iPhone perdu").first, "appareils")
        XCTAssertEqual(ids("tutoriel").first, "nouveautes")
        XCTAssertEqual(ids("micro").first, "iphone")
    }

    func testPlusieursMotsEtMotsVides() {
        XCTAssertEqual(ids("heure bilan").first, "rituel.heureSoir")
        XCTAssertEqual(ids("l'heure du bilan").first, "rituel.heureSoir")
        XCTAssertEqual(ids("heure du briefing").first, "rituel.heureMatin")
        XCTAssertEqual(ids("effacer lieux").first, "lieux.effacer")
        XCTAssertEqual(ids("pause localisation").first, "lieux.pause")
        // Tous les mots doivent se trouver : « jauge trampoline » ne donne rien.
        XCTAssertEqual(ids("jauge trampoline"), [])
    }

    func testAccentsMajusculesEtEspaces() {
        XCTAssertEqual(ids("  LOCALISATION  ").first, "lieux")
        XCTAssertEqual(ids("Reglages de l'iphone").first, "iphone")
        XCTAssertEqual(ids("revue de la semaine").first, "revue")
        XCTAssertEqual(ids("a trancher").first, "aTrancher")
        XCTAssertEqual(RechercheReglages.normaliser("Œuvre Évite ÀÇ"), "oeuvre evite ac")
    }

    /// Le titre d'abord : « diagnostic » montre l'écran, puis ses réglages.
    func testLeTitrePasseDevant() {
        let r = ids("diagnostic")
        XCTAssertEqual(r.first, "diagnostic")
        XCTAssertTrue(r.contains("diagnostic.jauge"), "ses réglages suivent (par leur chemin) : \(r)")
        XCTAssertEqual(ids("rendez-vous").prefix(2).sorted(), ["rituel.matin", "rituel.soir"])
    }

    func testUneFauteDeFrappe() {
        let r = RechercheReglages.chercher("notifcations", contexte: Self.tout)
        XCTAssertTrue(r.approchee)
        XCTAssertTrue(r.entrees.map(\.id).contains("rituel.matin"), "\(r.entrees.map(\.id))")
        XCTAssertEqual(r.enTete, "Rien d'exact pour « notifcations » : ce qui s'en approche")
        XCTAssertEqual(ids("localistion").first, "lieux")
        XCTAssertEqual(ids("jaueg").first, "diagnostic.jauge")
        // Trois lettres : trop court pour deviner.
        XCTAssertEqual(ids("jzu"), [])
        // Exact d'abord : une saisie juste n'est jamais « approchée ».
        XCTAssertFalse(RechercheReglages.chercher("jauge", contexte: Self.tout).approchee)
    }

    // MARK: États vides

    func testRienNeCorrespond() {
        let r = RechercheReglages.chercher("trampoline", contexte: Self.tout)
        XCTAssertFalse(r.vide)
        XCTAssertEqual(r.entrees, [])
        XCTAssertEqual(r.titreVide, "Rien ne correspond à « trampoline ».")
        XCTAssertEqual(r.detailVide, "Essaie un autre mot, ou l'un de ceux-ci :")
        XCTAssertNil(r.enTete)
        // Chaque suggestion donne quelque chose.
        for s in RechercheReglages.suggestions {
            XCTAssertFalse(ids(s).isEmpty, s)
        }
    }

    func testSaisieVide() {
        for q in ["", "   ", "\n"] {
            let r = RechercheReglages.chercher(q, contexte: Self.tout)
            XCTAssertTrue(r.vide, "« \(q) »")
            XCTAssertEqual(r.entrees, [])
            XCTAssertNil(r.titreVide)
            XCTAssertNil(r.enTete)
        }
        XCTAssertEqual(RechercheReglages.chercher("deepseek", contexte: Self.tout).enTete, "1 réglage")
        XCTAssertEqual(RechercheReglages.chercher("jauge", contexte: Self.tout).enTete, "\(ids("jauge").count) réglages")
    }

    /// Une fonction que la tour ne propose pas n'est pas proposée ; l'état vide dit pourquoi.
    func testCeQueLaTourNeProposePas() {
        var c = Self.tout
        c.capacites.remove("lieux-v1")
        let r = RechercheReglages.chercher("localisation", contexte: c)
        XCTAssertFalse(r.entrees.map(\.id).contains("lieux"))
        XCTAssertTrue(r.indisponibles.map(\.id).contains("lieux"))
        XCTAssertTrue(r.entrees.map(\.id).contains("iphone"), "l'autorisation d'iOS, elle, reste")
        // Réglages de la tour pas encore relus : la recherche web attend.
        c.reglages = nil
        let web = RechercheReglages.chercher("duckduckgo", contexte: c)
        XCTAssertEqual(web.entrees, [])
        XCTAssertEqual(web.indisponibles.map(\.id), ["web"])
        XCTAssertEqual(web.titreVide, "Rien ne correspond à « duckduckgo ».")
        XCTAssertTrue(web.detailVide?.contains("« Recherche web » dépend de ta tour") == true, web.detailVide ?? "")
        // Une tour sans rien : la jauge et l'apparence restent.
        let nue = ContexteReglages()
        XCTAssertEqual(ids("jauge", nue).first, "diagnostic.jauge")
        XCTAssertEqual(ids("sombre", nue).first, "apparence")
        XCTAssertFalse(ids("notif", nue).contains("rituel.matin"))
    }

    func testConditionsDesReglagesDeLaTour() {
        var r = Self.tout.reglages!
        var c = Self.tout
        // Recherche locale : l'envoi de contexte au cloud n'a plus d'objet.
        r.rechercheLocale = "duckduckgo"
        c.reglages = r
        XCTAssertFalse(c.permet(.contexteCloud))
        XCTAssertTrue(c.permet(.rechercheWeb))
        // Pas de modèle local : le secours Claude n'a pas d'objet.
        r.secoursCloudSansObjet = true
        c.reglages = r
        XCTAssertFalse(c.permet(.secours))
        XCTAssertFalse(c.permet(.circuit("inconnu")))
        XCTAssertTrue(c.permet(.circuit("nuit")))
        // La recherche privée : la capacité ET le réglage dit.
        c.capacites.remove("recherche-privee-v1")
        XCTAssertFalse(c.permet(.recherchePrivee))
    }

    // MARK: Où mène un résultat

    func testCibleEtRepli() {
        let heure = RechercheReglages.index.first { $0.id == "rituel.heureSoir" }!
        XCTAssertEqual(RechercheReglages.cible(heure, contexte: Self.tout),
                       CibleReglage(ecran: .reglages, ancre: "Heure du bilan", tutoriel: nil, note: nil))
        // Bilan coupé : l'heure n'est pas affichée, on montre l'interrupteur et on le dit.
        var c = Self.tout
        c.bilan = false
        let repli = RechercheReglages.cible(heure, contexte: c)
        XCTAssertEqual(repli.ancre, "Bilan du soir")
        XCTAssertEqual(repli.note, "Allume d'abord « Bilan du soir » : l'heure s'affiche dessous.")
        // Activité en direct coupée : « Démarrer seule » mène à elle.
        c.activiteEnDirect = false
        let seule = RechercheReglages.index.first { $0.id == "activite.auto" }!
        XCTAssertEqual(RechercheReglages.cible(seule, contexte: c).ancre, "Activité en direct")
        // La jauge : Diagnostic, la ligne mise en évidence.
        let jauge = RechercheReglages.premier("jauge", contexte: Self.tout)!
        XCTAssertEqual(RechercheReglages.cible(jauge, contexte: Self.tout),
                       CibleReglage(ecran: .diagnostic, ancre: "Jauge du contexte", tutoriel: nil, note: nil))
        // Siri : le tutoriel « Rémy sans ouvrir l'app ».
        let siri = RechercheReglages.index.first { $0.id == "hors-app" }!
        XCTAssertEqual(RechercheReglages.cible(siri, contexte: Self.tout).tutoriel, "hors-app")
    }

    func testChemins() {
        func chemin(_ id: String) -> String { RechercheReglages.index.first { $0.id == id }!.chemin }
        XCTAssertEqual(chemin("diagnostic.jauge"), "Réglages › Diagnostic")
        XCTAssertEqual(chemin("rituel.heureSoir"), "Réglages › Rendez-vous quotidien")
        XCTAssertEqual(chemin("modeles"), "Réglages")
        XCTAssertEqual(chemin("lieux.pause"), "Réglages › Localisation")
        XCTAssertEqual(chemin("iphone"), "Réglages de l'iPhone › Rémy")
        XCTAssertEqual(chemin("hors-app"), "Réglages › Nouveautés")
        XCTAssertEqual(chemin("activite.auto"), "Réglages › Activité en direct")
        XCTAssertEqual(RechercheReglages.index.first { $0.id == "diagnostic.jauge" }!.cheminLu, "Réglages, Diagnostic")
    }

    func testLeContexteSuitLAppEtLaTour() async {
        await MainActor.run { contexteDeLApp() }
    }

    @MainActor
    private func contexteDeLApp() {
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!),
                         reglages: UserDefaults(suiteName: "recherche-reglages-\(UUID().uuidString)")!)
        a.serveur = VersionServeur(api: 1, serveur: "0.9.0", capacites: ["lieux-v1", "rituel-v1"])
        let c = ContexteReglages(app: a, reglages: nil, activiteEnDirect: false, rituel: ReglagesRituel(matin: true))
        XCTAssertTrue(c.permet(.capacite("lieux-v1")))
        XCTAssertFalse(c.permet(.capacite("modeles-v1")))
        XCTAssertTrue(c.permet(.briefingAllume))
        XCTAssertFalse(c.permet(.bilanAllume))
        XCTAssertFalse(c.permet(.activiteEnDirect))
        XCTAssertFalse(c.permet(.couts), "pas encore de tableau de bord")
        XCTAssertFalse(c.permet(.rechercheWeb), "réglages de la tour pas encore relus")
        XCTAssertEqual(RechercheReglages.chercher("modèle", contexte: c).indisponibles.first?.id, "modeles")
    }

    // MARK: L'index et les vues s'accordent

    /// Les vues SwiftUI, relues comme du texte : chaque ligne visée existe,
    /// chaque ligne de Réglages est dans l'index.
    func vues() throws -> [String: String] {
        let env = ProcessInfo.processInfo.environment["REMY_VUES"].map { URL(fileURLWithPath: $0) }
        let relatif = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Remy/Vues")
        let dossier = env ?? relatif
        guard let noms = try? FileManager.default.contentsOfDirectory(atPath: dossier.path) else {
            throw XCTSkip("Vues introuvables (\(dossier.path)) : REMY_VUES pour une copie hors du dépôt")
        }
        var out: [String: String] = [:]
        for n in noms where n.hasSuffix(".swift") {
            out[n] = try String(contentsOf: dossier.appendingPathComponent(n), encoding: .utf8)
        }
        return out
    }

    static func trouver(_ motif: String, _ texte: String) -> [[String]] {
        guard let re = try? NSRegularExpression(pattern: motif) else { return [] }
        let ns = texte as NSString
        return re.matches(in: texte, range: NSRange(location: 0, length: ns.length)).map { m in
            (0..<m.numberOfRanges).map { i in
                let r = m.range(at: i)
                return r.location == NSNotFound ? "" : ns.substring(with: r)
            }
        }
    }

    func testChaqueEntreeDeLIndexExisteALEcran() throws {
        let v = try vues()
        let reglages = (v["ReglagesView.swift"] ?? "") + (v["RituelVues.swift"] ?? "")
        let toutes = v.values.joined(separator: "\n")
        func present(_ ancre: String, _ ecran: EcranReglages) -> Bool {
            let a = "\"" + ancre + "\""
            if ecran == .reglages {
                return [".repere(" + a + ")", "ligne(" + a, "info(" + a, "titre: " + a, "interrupteur(" + a, "choixHeure(" + a]
                    .contains { reglages.contains($0) }
            }
            return toutes.contains(".repere(" + a + ", dans: ." + ecran.rawValue + ")")
        }
        for e in RechercheReglages.index {
            if let a = e.ancre {
                XCTAssertTrue(present(a, e.ecran), "« \(a) » (\(e.id)) n'est pas repéré dans « \(e.ecran.titre) » : .repere(\"\(a)\"…) ?")
            } else if e.tutoriel == nil && e.ecran != .iphone {
                XCTAssertTrue((v["ReglagesView.swift"] ?? "").contains("ligne(\"" + e.titre + "\""),
                              "« \(e.titre) » (\(e.id)) : aucune ligne de Réglages ne l'ouvre")
            }
            if let r = e.repli {
                XCTAssertTrue(present(r.ancre, e.ecran), "repli « \(r.ancre) » de \(e.id) introuvable")
            }
        }
    }

    /// Le sens inverse : une ligne ajoutée à Réglages (ou repérée dans un
    /// sous-écran) sans entrée dans l'index échoue ici.
    func testChaqueLigneDeReglagesEstTrouvable() throws {
        let v = try vues()
        let index = RechercheReglages.index
        func connue(_ libelle: String, _ ecran: EcranReglages) -> Bool {
            index.contains { e in
                (e.ecran == ecran && (e.ancre == libelle || e.repli?.ancre == libelle))
                    // Une ligne de Réglages qui ouvre son écran (« Localisation »).
                    || (ecran == .reglages && e.titre == libelle)
            }
        }
        var vus = 0
        let principal = (v["ReglagesView.swift"] ?? "") + (v["RituelVues.swift"] ?? "")
        for motif in [#"ligne\("([^"]+)""#, #"circuit\("[^"]+", c, titre: "([^"]+)""#,
                      #"interrupteur\("([^"]+)""#, #"choixHeure\("([^"]+)""#] {
            for m in Self.trouver(motif, principal) {
                vus += 1
                XCTAssertTrue(connue(m[1], .reglages), "« \(m[1]) » est dans Réglages mais pas dans RechercheReglages.index")
            }
        }
        for (_, texte) in v {
            for m in Self.trouver(#"\.repere\("([^"]+)"(?:, dans: \.(\w+))?\)"#, texte) {
                vus += 1
                let ecran = m[2].isEmpty ? EcranReglages.reglages : EcranReglages(rawValue: m[2])
                XCTAssertNotNil(ecran, "écran inconnu : \(m[2])")
                XCTAssertTrue(ecran.map { connue(m[1], $0) } ?? false, "« \(m[1]) » est repéré mais pas dans RechercheReglages.index")
            }
        }
        XCTAssertGreaterThan(vus, 30, "les vues n'ont pas été relues")
    }
}
