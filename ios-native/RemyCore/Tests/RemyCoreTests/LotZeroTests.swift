import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Lot 0 : l'app dit son numéro de build, lit la version du serveur (sans
/// rien casser face à une tour pas encore mise à jour), et règle le secours
/// Claude (D21).
@MainActor
final class LotZeroTests: XCTestCase {
    private func client(build: String?) -> ClientAPI {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.builds = [:]
        return ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf), build: build)
    }

    func testLeBuildPartAvecChaqueRequete() async throws {
        FauxServeur.reponses = ["GET /api/conversations": [(200, "[]")]]
        _ = try await client(build: "42").conversations()
        XCTAssertEqual(FauxServeur.builds["GET /api/conversations"], "42")
        // Sans numéro (tests, aperçus) : pas d'en-tête inventé.
        _ = try await client(build: nil).conversations()
        XCTAssertNil(FauxServeur.builds["GET /api/conversations"])
    }

    func testVersionDuServeurLueAuChargement() async {
        FauxServeur.reponses = [
            "GET /api/version": [(200, #"{"api":1,"serveur":"0.2.0","commit":"abc1234","appMin":null,"capacites":["version","reglages"]}"#)],
            "GET /api/conversations": [(200, "[]")],
            "GET /api/dashboard": [(200, "{}")],
        ]
        let app = AppModel(api: client(build: "42"))
        await app.chargerTout()
        XCTAssertEqual(app.serveur?.libelle, "0.2.0 · abc1234")
        XCTAssertEqual(app.serveur?.sait("reglages"), true)
        XCTAssertEqual(app.serveur?.sait("jobs"), false)
    }

    func testTourPasEncoreAJourRienNeCasse() async {
        // Un serveur d'avant le Lot 0 répond 404 à /api/version.
        FauxServeur.reponses = [
            "GET /api/conversations": [(200, "[]")],
            "GET /api/dashboard": [(200, "{}")],
        ]
        let app = AppModel(api: client(build: "42"))
        await app.chargerTout()
        XCTAssertNil(app.serveur)
        XCTAssertNil(app.toast, "pas de message d'erreur pour une nouveauté absente")
    }

    func testAppTropAncienneMessageClair() async {
        FauxServeur.reponses = [
            "GET /api/conversations": [(426, #"{"error":"app_trop_ancienne","message":"Cette version de l'app (build 9) est trop ancienne"}"#)],
        ]
        do {
            _ = try await client(build: "9").conversations()
            XCTFail("426 attendu")
        } catch {
            XCTAssertEqual((error as? LocalizedError)?.errorDescription, "Cette version de l'app (build 9) est trop ancienne")
        }
    }

    func testSecoursClaudeActiveEtCoupe() async throws {
        FauxServeur.reponses = [
            "GET /api/reglages": [(200, #"{"secoursCloud":false,"secoursCloudReglage":false,"secoursCloudForceParLaTour":false,"secoursCloudSansObjet":false}"#)],
            "PUT /api/reglages": [(200, #"{"secoursCloud":true,"secoursCloudReglage":true,"secoursCloudForceParLaTour":false,"secoursCloudSansObjet":false}"#)],
        ]
        let api = client(build: "42")
        let lu = try await api.reglages()
        XCTAssertFalse(lu.secoursCloud)
        let apres = try await api.changerSecoursCloud(true)
        XCTAssertTrue(apres.secoursCloud)
        XCTAssertEqual(FauxServeur.corps["PUT /api/reglages"]?["secoursCloud"] as? Bool, true)
    }

    func testCaptureMemoirePleineLeDit() async {
        FauxServeur.reponses = [
            "POST /api/capture": [(200, #"{"ok":true,"ajouts":[],"memoire":false,"message":"Mémoire pleine : capture gardée, mémoire inchangée."}"#)],
        ]
        let app = AppModel(api: client(build: "42"))
        app.chat.brouillon = "Une longue note à retenir, assez longue pour passer le minimum."
        await app.chat.retenir(source: "note")
        XCTAssertEqual(app.toast, "Gardé : Mémoire pleine : capture gardée, mémoire inchangée.")
    }

    // MARK: Chaîne d'écriture (J0.7)

    private func convAvec(_ proposition: String) -> String {
        #"{"id":"c1","title":"x","messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b","proposal":"# + proposition + "}]}"
    }

    private func ouvrirConv(_ proposition: String, autres: [String: [(Int, String)]] = [:]) async -> AppModel {
        var reponses: [String: [(Int, String)]] = [
            "GET /api/conversations/c1": [(200, convAvec(proposition))],
            "GET /api/conversations": [(200, #"[{"id":"c1","title":"x","updatedAt":1}]"#)],
            "GET /api/dashboard": [(200, "{}")],
        ]
        reponses.merge(autres) { _, b in b }
        FauxServeur.reponses = reponses
        FauxServeur.historique = [:]
        FauxServeur.coupures = [:]
        let app = AppModel(api: client(build: "42"))
        await app.chat.ouvrir("c1")
        return app
    }

    private let enAttente = #"{"id":"p1","source":"motion","actions":[{"type":"creer","nom":"A"}],"statut":"en_attente"}"#

    func testNonMerciEstEnregistreSurLaTour() async {
        let app = await ouvrirConv(enAttente, autres: [
            "POST /api/conversations/c1/propositions/p1/refus": [(200, #"{"ok":true,"statut":"refuse"}"#)],
        ])
        XCTAssertNotNil(app.chat.lignes[1].proposition)
        await app.chat.ecarter(app.chat.lignes[1])
        XCTAssertNil(app.chat.lignes[1].proposition)
        XCTAssertTrue(FauxServeur.recues.contains("POST /api/conversations/c1/propositions/p1/refus"))
        XCTAssertEqual(app.toast, "D'accord, rien n'a été changé.")
    }

    func testNonMerciPasEnregistreLaCarteRevient() async {
        let app = await ouvrirConv(enAttente, autres: [
            "POST /api/conversations/c1/propositions/p1/refus": [(500, #"{"error":"x","message":"Base illisible."}"#)],
        ])
        await app.chat.ecarter(app.chat.lignes[1])
        XCTAssertNotNil(app.chat.lignes[1].proposition, "jamais un tap muet : la carte revient")
        XCTAssertEqual(app.toast, "« Non merci » pas enregistré : Base illisible.")
    }

    func testPropositionRefuseeNeRevientPas() async {
        let app = await ouvrirConv(#"{"id":"p1","source":"motion","actions":[{"type":"creer","nom":"A"}],"statut":"refuse"}"#)
        XCTAssertNil(app.chat.lignes[1].proposition)
    }

    func testOuiEnvoieLaPropositionEtUnEchecTotalNEstPasUnSucces() async throws {
        let app = await ouvrirConv(enAttente, autres: [
            "POST /api/motion/apply": [(200, #"{"ok":false,"ledgerId":"L1","echecs":1,"etat":"echouee","results":[{"ok":false,"nom":"A","erreur":"espace introuvable"}]}"#)],
        ])
        let ok = await app.chat.appliquer(app.chat.lignes[1])
        XCTAssertFalse(ok)
        let envoye = try XCTUnwrap(FauxServeur.corps["POST /api/motion/apply"])
        XCTAssertEqual(envoye["propositionId"] as? String, "p1")
        let p = try XCTUnwrap(app.chat.lignes[1].proposition)
        XCTAssertTrue(p.echouee)
        XCTAssertFalse(p.appliquee, "la carte reste retentable")
        XCTAssertEqual(p.erreur(pour: p.actions[0]), "espace introuvable")
    }

    func testMotionInjoignableLaCarteLeDit() async throws {
        let app = await ouvrirConv(enAttente, autres: [
            "POST /api/motion/apply": [(502, #"{"error":"motion","message":"Motion ne répond pas (délai dépassé)."}"#)],
        ])
        let ok = await app.chat.appliquer(app.chat.lignes[1])
        XCTAssertFalse(ok)
        let p = try XCTUnwrap(app.chat.lignes[1].proposition)
        XCTAssertTrue(p.echouee)
        XCTAssertEqual(p.raisonEchec, "Motion ne répond pas (délai dépassé).")
        XCTAssertEqual(app.toast, "Pas fait : Motion ne répond pas (délai dépassé).")
    }

    func testCocheRejoueeApresCoupureAvecLaMemeCle() async throws {
        FauxServeur.reponses = [
            "GET /api/dashboard": [(200, "{}")],
            "POST /api/motion/apply": [(200, #"{"ok":true,"ledgerId":"L9","echecs":0,"etat":"appliquee","rejoue":true,"results":[{"ok":true,"type":"terminer","nom":"Démo"}]}"#)],
        ]
        FauxServeur.historique = [:]
        FauxServeur.coupures = ["POST /api/motion/apply": 1]
        let app = AppModel(api: client(build: "42"))
        app.api.rejeuSur = true // la tour sait rejouer (propositions-v1)
        app.tableau.delaiAnnulation = 0
        let issue = await app.tableau.terminer(id: "t1", titre: "Démo")
        XCTAssertEqual(issue, .faite)
        let envois = try XCTUnwrap(FauxServeur.historique["POST /api/motion/apply"])
        XCTAssertEqual(envois.count, 2, "une seule reprise")
        let cle = try XCTUnwrap(envois[0]["idCommande"] as? String)
        XCTAssertEqual(envois[1]["idCommande"] as? String, cle, "la même clé : le serveur ne refait rien")
    }

    func testAnnulationEnCoursNEstPasPrisePourUnSucces() async {
        let api = client(build: "42")
        FauxServeur.reponses = [
            "POST /api/motion/undo": [(409, #"{"error":"en_cours","message":"Cette écriture n'est pas terminée : réessaie dans un instant."}"#)],
        ]
        do {
            _ = try await api.annuler(Proposition(source: "motion", resume: nil, actions: [], ledgerId: "L1"))
            XCTFail("409 en cours attendu")
        } catch {
            XCTAssertEqual((error as? LocalizedError)?.errorDescription, "Cette écriture n'est pas terminée : réessaie dans un instant.")
        }
        FauxServeur.reponses = ["POST /api/motion/undo": [(409, #"{"error":"deja","message":"Déjà annulé"}"#)]]
        let r = try? await api.annuler(Proposition(source: "motion", resume: nil, actions: [], ledgerId: "L1"))
        XCTAssertEqual(r?.dejaAnnule, true)
    }

    // MARK: Jeton d'appareil (J0.8b)

    func testConnexionRangeLeJetonEtLEnvoieEnsuite() async throws {
        FauxServeur.reponses = [
            "POST /api/login": [(200, #"{"ok":true,"jeton":"rmy_jeton-de-test","appareil":{"id":"a1","nom":"iPhone de test"}}"#)],
            "GET /api/conversations": [(200, "[]")],
        ]
        FauxServeur.autorisations = [:]
        let api = client(build: "42")
        try await api.connexion(motDePasse: "x", appareil: "iPhone de test")
        XCTAssertEqual(FauxServeur.corps["POST /api/login"]?["appareil"] as? String, "iPhone de test")
        XCTAssertEqual(api.coffre.lire(), "rmy_jeton-de-test")
        _ = try await api.conversations()
        XCTAssertEqual(FauxServeur.autorisations["GET /api/conversations"], "Bearer rmy_jeton-de-test")
    }

    func testAppareilDeconnecteRetourALaConnexionEtJetonOublie() async {
        FauxServeur.reponses = ["GET /api/conversations": [(401, #"{"error":"auth","message":"Cet appareil a été déconnecté — reconnecte-toi."}"#)]]
        let api = client(build: "42")
        api.coffre.ecrire("rmy_revoque")
        let app = AppModel(api: api)
        await app.demarrer()
        XCTAssertEqual(app.phase, .connexion)
        XCTAssertNil(api.coffre.lire(), "un jeton révoqué ne sert plus")
    }

    func testAppDejaConnecteeObtientSonJetonSansMotDePasse() async {
        FauxServeur.reponses = [
            "GET /api/version": [(200, #"{"api":1,"serveur":"0.2.0","capacites":["appareils"]}"#)],
            "GET /api/conversations": [(200, "[]")],
            "GET /api/dashboard": [(200, "{}")],
            "POST /api/appareils": [(200, #"{"ok":true,"jeton":"rmy_migre"}"#)],
        ]
        let app = AppModel(api: client(build: "42"))
        app.nomAppareil = "iPhone de Sam"
        await app.chargerTout()
        XCTAssertEqual(app.api.coffre.lire(), "rmy_migre")
        XCTAssertEqual(FauxServeur.corps["POST /api/appareils"]?["nom"] as? String, "iPhone de Sam")
        // Déjà muni : pas de second jeton.
        FauxServeur.recues = []
        await app.chargerTout()
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/appareils"))
    }

    func testListeEtDeconnexionDUnAutreAppareil() async {
        FauxServeur.reponses = [
            "GET /api/appareils": [(200, #"{"appareils":[{"id":"a1","nom":"Cet iPhone","vu_a":1760000000000,"actuel":true},{"id":"a2","nom":"Vieil iPhone","cree_a":1750000000000}]}"#)],
            "DELETE /api/appareils/a2": [(200, #"{"ok":true}"#)],
        ]
        let app = AppModel(api: client(build: "42"))
        await app.chargerAppareils()
        XCTAssertEqual(app.appareils?.map(\.nom), ["Cet iPhone", "Vieil iPhone"])
        await app.deconnecterAppareil(app.appareils![1])
        XCTAssertEqual(app.appareils?.map(\.id), ["a1"])
        XCTAssertEqual(app.toast, "« Vieil iPhone » est déconnecté : il devra retaper le mot de passe.")
    }

    func testListeDesAppareilsIndisponibleLeDit() async {
        FauxServeur.reponses = ["GET /api/appareils": [(503, #"{"error":"appareils","message":"Liste des appareils indisponible : base illisible"}"#)]]
        let app = AppModel(api: client(build: "42"))
        await app.chargerAppareils()
        XCTAssertNil(app.appareils)
        XCTAssertEqual(app.erreurAppareils, "Liste des appareils indisponible : base illisible")
    }

    func testTourPasAJourPasDeRejeuAutomatique() async {
        // Une tour d'avant le Lot 0 ignore la clé : rejouer referait l'écriture.
        FauxServeur.reponses = [
            "GET /api/dashboard": [(200, "{}")],
            "POST /api/motion/apply": [(200, #"{"ledgerId":"L1","echecs":0,"results":[{"ok":true}]}"#)],
        ]
        FauxServeur.historique = [:]
        FauxServeur.coupures = ["POST /api/motion/apply": 1]
        let app = AppModel(api: client(build: "42"))
        XCTAssertFalse(app.api.rejeuSur)
        app.tableau.delaiAnnulation = 0
        let issue = await app.tableau.terminer(id: "t1", titre: "Démo")
        XCTAssertEqual(issue, .echec)
        XCTAssertEqual(FauxServeur.historique["POST /api/motion/apply"]?.count, 1, "pas de second envoi")
        XCTAssertEqual(app.toast, "Réseau coupé pendant la coche de « Démo » : je relis la liste pour vérifier.")
    }

    func testVersionDuServeurActiveLeRejeu() async {
        FauxServeur.reponses = [
            "GET /api/version": [(200, #"{"api":1,"serveur":"0.2.0","capacites":["propositions-v1"]}"#)],
            "GET /api/conversations": [(200, "[]")],
            "GET /api/dashboard": [(200, "{}")],
        ]
        let app = AppModel(api: client(build: "42"))
        await app.chargerTout()
        XCTAssertTrue(app.api.rejeuSur)
    }

    func testCircuitNuitSeCoupe() async throws {
        FauxServeur.reponses = [
            "PUT /api/reglages": [(200, #"{"secoursCloud":false,"circuits":{"nuit":{"nom":"Réflexion de la nuit","actif":false,"forceParLaTour":false,"reglage":false}}}"#)],
        ]
        let r = try await client(build: "42").changerCircuit("nuit", actif: false)
        XCTAssertEqual(r.circuits?["nuit"]?.actif, false)
        XCTAssertEqual((FauxServeur.corps["PUT /api/reglages"]?["circuits"] as? [String: Bool])?["nuit"], false)
    }
}
