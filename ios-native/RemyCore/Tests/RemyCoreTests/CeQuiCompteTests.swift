import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// « Ce que Rémy a compris » (priorites-v2, 12/11) : la proposition se lit
/// même abîmée, les gestes se font et se défont, et rien de ce que l'iPhone
/// ne connaît pas ne repart vers la tour (clé absente = inchangé).
final class CeQuiCompteTests: XCTestCase {
    static let vue = #"""
    {"version":4,"majA":1762900000000,"classeA":1762900000000,"ecartees":["motion:p9", 7],
     "priorites":[
      {"id":"p-musique","titre":"La musique","pourquoi":"Jouer me rend calme","mots":["musique","guitare"],"projetMotion":"p4","projetNom":"Musique","classee":true,"joursSans":1,"neglige":false},
      {"id":"p-boutique","titre":"Lancer la boutique","mots":["boutique"],"classee":true},
      {"id":"p-proches","titre":"Voir Léa et Hugo","mots":["Léa", 3],"classee":"oui","constat":null}
     ],
     "historique":[{"version":4,"a":1762900000000,"titres":["La musique"]},{"bizarre":true}]}
    """#

    static let proposition = #"""
    {"candidats":[
      {"cle":"motion:p2","titre":"Album photo","projetMotion":"p2","projetNom":"Album photo","declaree":null,"score":9,
       "indices":[{"source":"motion","texte":"4 h planifiées sur les 14 prochains jours"},{"source":"carnet","texte":"Avancé dans Rémy hier"},{"texte":42},{"source":"motion","texte":""}]},
      {"titre":"Sans clé"},
      {"cle":"motion:p5","titre":"Voir Léa et Hugo","projetMotion":"p5","projetNom":"Amis","declaree":{"id":"p-proches","titre":"Voir Léa et Hugo","pourquoi":"x","mots":[]},
       "indices":[{"source":"declarees","texte":"Tu as écrit « Voir Léa et Hugo », qui ressemble à ce projet"}]},
      {"cle":"motion:p4","titre":"Musique","projetMotion":"p4","indices":[{"source":"motion","texte":"1 tâche ouverte"}]}
     ],
     "sources":[{"id":"motion","nom":"Motion"}],"limites":"Ce que la tour ne voit pas.","calculeA":1762900000000,"version":4,"classeA":null,"motion":"ok"}
    """#

    func lire() throws -> (VuePriorites, PropositionPriorites) {
        let v = try JSONDecoder().decode(VuePriorites.self, from: Data(Self.vue.utf8))
        let p = try JSONDecoder().decode(PropositionPriorites.self, from: Data(Self.proposition.utf8))
        return (v, p)
    }

    func testLaPropositionEtLeClassementSeLisentMemeAbimes() throws {
        let (v, p) = try lire()
        XCTAssertEqual(v.version, 4)
        XCTAssertEqual(v.priorites.map(\.id), ["p-musique", "p-boutique", "p-proches"], "aucune priorité sautée")
        XCTAssertEqual(v.priorites.map(\.classee), [true, true, nil], "« oui » n'est pas une confirmation")
        XCTAssertEqual(v.priorites[0].projetMotion, "p4")
        XCTAssertEqual(v.priorites[2].mots ?? [], ["Léa"])
        XCTAssertEqual(v.ecartees ?? [], ["motion:p9"])
        XCTAssertEqual(v.historique?.count, 1)
        XCTAssertNotNil(v.classeA)

        XCTAssertEqual(p.candidats.map(\.cle), ["motion:p2", "motion:p5", "motion:p4"], "une piste sans clé est laissée de côté")
        XCTAssertEqual(p.candidats[0].indices.map(\.texte), ["4 h planifiées sur les 14 prochains jours", "Avancé dans Rémy hier"])
        XCTAssertNil(p.candidats[0].declaree)
        XCTAssertEqual(p.candidats[1].declaree?.id, "p-proches")
        XCTAssertEqual(p.limites, "Ce que la tour ne voit pas.")
        XCTAssertEqual(p.motion, "ok")

        // Une tour d'avant priorites-v2 : rien de neuf, et rien d'inventé.
        let ancienne = try JSONDecoder().decode(VuePriorites.self, from: Data(#"{"version":2,"priorites":[{"id":"p-a","titre":"A"}]}"#.utf8))
        XCTAssertNil(ancienne.ecartees)
        XCTAssertNil(ancienne.priorites[0].classee)
        XCTAssertNil(ancienne.priorites[0].projetMotion)
        let vide = try JSONDecoder().decode(PropositionPriorites.self, from: Data(#"{"candidats":"pas une liste"}"#.utf8))
        XCTAssertTrue(vide.candidats.isEmpty)
    }

    func testLEcranSepareLeConfirmeDeCeQuiEstPropose() throws {
        let (v, p) = try lire()
        let c = ClassementPriorites(vue: v, proposition: p)
        XCTAssertEqual(c.classees.map(\.titre), ["La musique", "Lancer la boutique"], "le classement confirmé, dans l'ordre")
        // « Musique » (p4) est déjà classée : pas reproposée ; la piste p5
        // reprend la priorité écrite (ses mots l'emportent).
        XCTAssertEqual(c.proposees.map(\.titre), ["Album photo", "Voir Léa et Hugo"])
        XCTAssertEqual(c.proposees.map(\.id), ["motion:p2", "p:p-proches"])
        XCTAssertEqual(c.proposees[0].indices.count, 2)
        XCTAssertFalse(c.proposees[0].ecrite)
        XCTAssertTrue(c.proposees[1].ecrite)
        XCTAssertEqual(c.classees[0].etat, "Dernière trace hier")
        XCTAssertFalse(c.modifie)
        XCTAssertFalse(c.peutAnnuler)

        // Sans la proposition : les priorités écrites restent proposées.
        let seule = ClassementPriorites(vue: v, proposition: nil)
        XCTAssertEqual(seule.proposees.map(\.titre), ["Voir Léa et Hugo"])
        XCTAssertEqual(seule.proposees[0].indices.map(\.texte), ["Tu l'as écrite toi-même"])
        XCTAssertEqual(seule.proposees[0].cle, "declaree:p-proches")
    }

    /// Le cœur de la règle : ce que l'iPhone ne sait pas ne repart pas.
    func testRienDInconnuNeRepart() throws {
        let (v, p) = try lire()
        let c = ClassementPriorites(vue: v, proposition: p)
        let envoi = c.aEnvoyer()
        XCTAssertEqual(envoi.priorites.map(\.id), ["p-musique", "p-boutique", "p-proches"])
        XCTAssertEqual(envoi.priorites.map(\.confirmee), [true, true, nil])
        XCTAssertEqual(envoi.ecartees ?? [], ["motion:p9"])
        let musique = envoi.priorites[0].corps
        XCTAssertEqual(musique["projetMotion"] as? String, "p4", "un lien connu repart tel quel")
        XCTAssertEqual(musique["projetNom"] as? String, "Musique")
        let boutique = envoi.priorites[1].corps
        XCTAssertNil(boutique["projetMotion"], "pas de lien connu : clé absente, jamais null")
        XCTAssertEqual(boutique["confirmee"] as? Bool, true)
        let proches = envoi.priorites[2].corps
        XCTAssertNil(proches["confirmee"], "pas confirmée ici : la tour garde ce qu'elle sait")
        XCTAssertNil(proches["projetMotion"], "un projet seulement « ressemblant » n'est pas relié en silence")
        XCTAssertEqual((proches["mots"] as? [String]) ?? [], ["Léa"])
        XCTAssertNil(proches["pourquoi"])

        // Une tour qui n'a pas rendu ses pistes écartées : on ne les renvoie pas.
        var sans = v
        sans.ecartees = nil
        let c2 = ClassementPriorites(vue: sans, proposition: p)
        XCTAssertNil(c2.aEnvoyer().ecartees)
        var c3 = c2
        let r = c3.ecarter("motion:p2")
        XCTAssertTrue(r.fait)
        XCTAssertNil(c3.aEnvoyer().ecartees, "sans liste lue, la clé reste absente")
    }

    func testConfirmerMonterDescendreEcarterEtAnnuler() throws {
        let (v, p) = try lire()
        var c = ClassementPriorites(vue: v, proposition: p)

        let confirme = c.confirmer("motion:p2", nouvelId: { "p-album" })
        XCTAssertTrue(confirme.fait)
        XCTAssertEqual(confirme.phrase, "« Album photo » entre dans ton classement en n°3.")
        XCTAssertEqual(c.classees.map(\.id), ["p:p-musique", "p:p-boutique", "p:p-album"])
        XCTAssertTrue(c.classees[2].indices.isEmpty)
        XCTAssertTrue(c.modifie)
        let envoi = c.aEnvoyer()
        XCTAssertEqual(envoi.priorites.map(\.id), ["p-musique", "p-boutique", "p-album", "p-proches"])
        XCTAssertEqual(envoi.priorites[2].confirmee, true)
        XCTAssertEqual(envoi.priorites[2].projetMotion, "p2", "confirmée : son projet est relié")

        let monte = c.monter("p:p-album")
        XCTAssertEqual(monte.phrase, "« Album photo » passe en n°2.")
        XCTAssertEqual(c.classees.map(\.titre), ["La musique", "Album photo", "Lancer la boutique"])
        let tete = c.monter("p:p-musique")
        XCTAssertFalse(tete.fait)
        XCTAssertEqual(tete.phrase, "« La musique » est déjà en tête.")
        XCTAssertFalse(c.descendre("p:p-proches").fait, "seule piste : déjà en dernier")
        let descend = c.descendre("p:p-musique")
        XCTAssertEqual(descend.phrase, "« La musique » passe en n°2.")

        let ecarte = c.ecarter("p:p-proches")
        XCTAssertTrue(ecarte.fait)
        XCTAssertTrue(ecarte.phrase.contains("sort de tes priorités"), ecarte.phrase)
        XCTAssertTrue(c.proposees.isEmpty)
        XCTAssertEqual(c.ecartees, ["motion:p9", "motion:p5"])
        XCTAssertFalse(c.aEnvoyer().priorites.map(\.id).contains("p-proches"), "écartée : elle sort de la tour")

        // Annuler, un geste à la fois, jusqu'à l'état lu.
        XCTAssertEqual(c.annuler().phrase, "Annulé : l'écart de « Voir Léa et Hugo ».")
        XCTAssertEqual(c.ecartees, ["motion:p9"])
        XCTAssertEqual(c.proposees.map(\.id), ["p:p-proches"])
        XCTAssertTrue(c.annuler().fait)
        XCTAssertTrue(c.annuler().fait)
        XCTAssertTrue(c.annuler().fait)
        XCTAssertEqual(c.proposees.map(\.id), ["motion:p2", "p:p-proches"])
        XCTAssertFalse(c.modifie, "tout défait : rien à enregistrer")
        XCTAssertEqual(c.annuler().phrase, "Rien à annuler.")
    }

    func testCinqAuPlusEtLAjoutALaMain() throws {
        let (v, p) = try lire()
        var c = ClassementPriorites(vue: v, proposition: p)
        XCTAssertEqual(c.ajouter(titre: "   ").phrase, "Écris d'abord ce qui compte.")
        XCTAssertEqual(c.ajouter(titre: "la MUSIQUE").phrase, "« la MUSIQUE » est déjà là.")
        let tout = c.toutConfirmer(nouvelId: { "p-x" })
        XCTAssertEqual(tout.phrase, "2 confirmées, dans cet ordre.")
        XCTAssertEqual(c.classees.count, 4)
        XCTAssertTrue(c.ajouter(titre: "Le sport", pourquoi: " Pour dormir ", nouvelId: { "p-sport" }).fait)
        XCTAssertTrue(c.plein)
        XCTAssertEqual(c.classees.last?.pourquoi, "Pour dormir")
        XCTAssertFalse(c.ajouter(titre: "Encore une").fait)
        // Modifier une priorité du classement : titre, pourquoi, mots.
        XCTAssertEqual(c.modifier("p:p-sport", titre: "Le sport", pourquoi: "Pour dormir", mots: "").phrase, "Rien n'a changé.")
        XCTAssertTrue(c.modifier("p:p-sport", titre: "Courir", pourquoi: "", mots: "course, footing, x").fait)
        let sport = c.aEnvoyer().priorites.first { $0.id == "p-sport" }
        XCTAssertEqual(sport?.titre, "Courir")
        XCTAssertNil(sport?.pourquoi)
        XCTAssertEqual(sport?.mots ?? [], ["course", "footing"])
        // Reproposer les pistes écartées.
        XCTAssertTrue(c.reproposer().fait)
        XCTAssertTrue(c.ecartees.isEmpty)
        XCTAssertFalse(c.reproposer().fait)
    }

    func testLesMotsDeLEcran() throws {
        XCTAssertEqual(CeQuiCompte.libelle(.confirmer, "La musique"), "C'est ça : « La musique » est une priorité")
        XCTAssertEqual(CeQuiCompte.libelle(.monter, "La musique"), "Monter « La musique »")
        XCTAssertEqual(CeQuiCompte.libelle(.descendre, "La musique"), "Descendre « La musique »")
        XCTAssertEqual(CeQuiCompte.libelle(.ecarter, "La musique"), "« La musique » n'est pas une priorité")
        let (_, p) = try lire()
        let g = CeQuiCompte.groupes(p.candidats[0].indices)
        XCTAssertEqual(g.map(\.titre), ["D'après Motion", "D'après Rémy"])
        XCTAssertTrue(CeQuiCompte.indicesLus("Album photo", p.candidats[0].indices).hasPrefix("Ce que Rémy a vu pour « Album photo » : D'après Motion : 4 h"))
        XCTAssertTrue(CeQuiCompte.vide(nil).contains("réessaie"))
        XCTAssertTrue(CeQuiCompte.vide(PropositionPriorites(motion: "off")).contains("Motion n'est pas relié"))
        XCTAssertTrue(CeQuiCompte.vide(PropositionPriorites(motion: "ok")).contains("à la main"))
        XCTAssertNil(CeQuiCompte.noteMotion(p))
        XCTAssertNil(CeQuiCompte.bandeau(horsLigne: false, copieLocale: false, injoignable: false, recuLe: nil, modifie: false))
        let b = CeQuiCompte.bandeau(horsLigne: true, copieLocale: false, injoignable: false, recuLe: nil, modifie: true)
        XCTAssertEqual(b, "Pas de réseau : tu lis la dernière version gardée sur l'iPhone. Confirmer ou corriger attend le réseau. Tes corrections pas encore enregistrées restent ici.")
        XCTAssertGreaterThan(CeQuiCompte.limites.count, 40)
        XCTAssertLessThanOrEqual(CeQuiCompte.nom(String(repeating: "a", count: 90)).count, 44)
    }
}

/// Le modèle de l'écran, contre une fausse tour.
@MainActor
final class CeQuiCompteModelTests: XCTestCase {
    private let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("remy-cqc-" + UUID().uuidString)
    /// Les AppModel des essais : `PrioritesModel.app` est faible.
    private var gardes: [AppModel] = []

    override func tearDown() {
        try? FileManager.default.removeItem(at: dossier)
        FauxServeur.reponses = [:]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.historique = [:]
        FauxServeur.coupures = [:]
        gardes = []
    }

    private func app(_ capacites: [String], rangement: Rangement? = nil) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)),
                         rangement: rangement, reglages: UserDefaults(suiteName: "remy-cqc-\(UUID().uuidString)")!)
        a.serveur = VersionServeur(api: 1, serveur: "0.6.0", capacites: capacites)
        gardes.append(a)
        return a
    }

    private func reponses(put: (Int, String)? = nil) {
        var r: [String: [(Int, String)]] = [
            "GET /api/priorites": [(200, CeQuiCompteTests.vue)],
            "GET /api/priorites/proposition": [(200, CeQuiCompteTests.proposition)],
        ]
        if let put { r["PUT /api/priorites"] = [put] }
        FauxServeur.reponses = r
        FauxServeur.recues = []
        FauxServeur.corps = [:]
    }

    /// Une tour d'avant : l'écran d'avant, et aucune requête nouvelle.
    func testUneTourAncienneGardeLEcranDAvant() async {
        reponses()
        let a = app(["priorites-v1"])
        let m = a.priorites
        XCTAssertFalse(m.disponible)
        await m.charger()
        XCTAssertNil(m.classement)
        XCTAssertFalse(FauxServeur.recues.contains("GET /api/priorites/proposition"))
        XCTAssertFalse(FauxServeur.recues.contains("GET /api/priorites"))
    }

    func testConfirmerPuisEnregistrer() async throws {
        let apres = #"{"version":5,"classeA":1762990000000,"ecartees":["motion:p9"],"priorites":[{"id":"p-musique","titre":"La musique","classee":true},{"id":"p-boutique","titre":"Lancer la boutique","classee":true},{"id":"p-album","titre":"Album photo","projetMotion":"p2","classee":true},{"id":"p-proches","titre":"Voir Léa et Hugo"}]}"#
        reponses(put: (200, apres))
        let a = app([CeQuiCompte.capacite])
        let m = a.priorites
        XCTAssertTrue(m.disponible)
        await m.charger()
        XCTAssertEqual(m.classement?.classees.map(\.titre) ?? [], ["La musique", "Lancer la boutique"])
        XCTAssertEqual(m.classement?.proposees.count, 2)
        XCTAssertNil(m.erreur)
        XCTAssertTrue(m.peutCorriger)
        XCTAssertFalse(m.peutEnregistrer, "rien de changé")
        XCTAssertNil(m.bandeau())

        m.confirmer("motion:p2")
        XCTAssertEqual(m.classement?.classees.count, 3)
        XCTAssertTrue(a.toast?.hasSuffix("Enregistrer pour confirmer.") == true, a.toast ?? "")
        XCTAssertNotNil(a.message?.annuler, "le geste s'annule depuis le bandeau")
        XCTAssertTrue(m.peutEnregistrer)
        // Annuler depuis le bandeau, puis refaire.
        a.message?.annuler?()
        XCTAssertEqual(m.classement?.classees.count, 2)
        XCTAssertFalse(m.modifie)
        m.confirmer("motion:p2")

        let ok = await m.enregistrer()
        XCTAssertTrue(ok)
        let corps = try XCTUnwrap(FauxServeur.corps["PUT /api/priorites"])
        XCTAssertEqual(corps["base"] as? Int, 4)
        XCTAssertEqual((corps["ecartees"] as? [String]) ?? [], ["motion:p9"])
        let lignes = try XCTUnwrap(corps["priorites"] as? [[String: Any]])
        XCTAssertEqual(lignes.map { $0["titre"] as? String ?? "" }, ["La musique", "Lancer la boutique", "Album photo", "Voir Léa et Hugo"])
        XCTAssertEqual(lignes[2]["confirmee"] as? Bool, true)
        XCTAssertEqual(lignes[2]["projetMotion"] as? String, "p2")
        XCTAssertNil(lignes[3]["confirmee"])
        XCTAssertNil(lignes[3]["projetMotion"])
        XCTAssertNil(lignes[1]["projetMotion"])
        XCTAssertEqual(a.toast, CeQuiCompte.enregistre(3))
        XCTAssertFalse(m.enregistrement)
    }

    func testUnRefus409RelitSansRienEcraser() async {
        reponses(put: (409, #"{"error":"priorites","message":"Tes priorités ont changé ailleurs entre-temps."}"#))
        let a = app([CeQuiCompte.capacite])
        let m = a.priorites
        await m.charger()
        m.confirmer("motion:p2")
        let ok = await m.enregistrer()
        XCTAssertFalse(ok)
        XCTAssertEqual(a.toast, "Ton classement a changé ailleurs entre-temps : je recharge, refais ta correction.")
        XCTAssertFalse(m.modifie, "relu depuis la tour")
        XCTAssertEqual(m.classement?.classees.count, 2)
    }

    func testHorsLigneLesGestesAttendent() async {
        reponses()
        let a = app([CeQuiCompte.capacite])
        let m = a.priorites
        await m.charger()
        await a.changerReseau(horsLigne: true)
        XCTAssertFalse(m.peutCorriger)
        m.confirmer("motion:p2")
        XCTAssertEqual(m.classement?.classees.count, 2, "rien ne bouge sans réseau")
        XCTAssertEqual(a.toast, CeQuiCompte.attente(horsLigne: true, enregistrement: false))
        XCTAssertTrue(m.bandeau()?.hasPrefix("Pas de réseau") == true, m.bandeau() ?? "")
    }

    /// La copie gardée sur l'iPhone se lit au lancement, gestes coupés tant
    /// que la tour n'a pas été relue ; tour injoignable : le bandeau le dit.
    func testLaCopieDeLIPhoneResteLisible() async {
        reponses()
        let premier = app([CeQuiCompte.capacite], rangement: Rangement(dossier: dossier))
        await premier.priorites.charger()
        XCTAssertNotNil(premier.priorites.classement)

        let second = app([CeQuiCompte.capacite], rangement: Rangement(dossier: dossier))
        let m = second.priorites
        XCTAssertTrue(m.copieLocale)
        XCTAssertEqual(m.classement?.classees.map(\.titre) ?? [], ["La musique", "Lancer la boutique"])
        XCTAssertFalse(m.peutCorriger)
        XCTAssertTrue(m.bandeau()?.hasPrefix("Tu lis la dernière version gardée") == true, m.bandeau() ?? "")
        FauxServeur.coupures = ["GET /api/priorites": 1]
        await m.charger()
        XCTAssertTrue(m.erreurReseau)
        XCTAssertTrue(m.bandeau()?.hasPrefix("Rémy ne répond pas") == true, m.bandeau() ?? "")
        XCTAssertNotNil(m.classement, "ce qui est gardé reste lisible")
        // La tour revient : tout se relit, les gestes reviennent.
        await m.charger()
        XCTAssertFalse(m.copieLocale)
        XCTAssertTrue(m.peutCorriger)
        m.vider()
        XCTAssertNil(m.classement)
        let troisieme = app([CeQuiCompte.capacite], rangement: Rangement(dossier: dossier))
        XCTAssertNil(troisieme.priorites.classement, "déconnexion : rien ne reste sur l'iPhone")
    }

    func testUneErreurSansRienDeGardeSeDit() async {
        FauxServeur.reponses = ["GET /api/priorites": [(500, #"{"error":"x","message":"La base de la tour est illisible."}"#)]]
        let a = app([CeQuiCompte.capacite])
        let m = a.priorites
        await m.charger()
        XCTAssertNil(m.classement)
        XCTAssertEqual(m.erreur, "La base de la tour est illisible.")
        XCTAssertFalse(m.erreurReseau)
        // La liste se lit, la proposition non : les priorités écrites restent proposées.
        FauxServeur.reponses = ["GET /api/priorites": [(200, CeQuiCompteTests.vue)]]
        await m.charger()
        XCTAssertNil(m.erreur)
        XCTAssertNotNil(m.erreurProposition)
        XCTAssertEqual(m.classement?.proposees.map(\.titre) ?? [], ["Voir Léa et Hugo"])
    }
}
