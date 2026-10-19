import XCTest
@testable import RemyCore

/// Contre un vrai serveur Rémy (local, données de démo) — lancé seulement si
/// REMY_TEST_URL et REMY_TEST_MDP sont fournis. Vérifie que les réponses
/// RÉELLES se décodent, pas des exemples écrits à la main.
@MainActor
final class IntegrationTests: XCTestCase {
    func testContreLeVraiServeur() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let u = env["REMY_TEST_URL"], let url = URL(string: u), let mdp = env["REMY_TEST_MDP"] else {
            throw XCTSkip("REMY_TEST_URL absent")
        }
        let app = AppModel(api: ClientAPI(base: url))
        await app.demarrer()
        XCTAssertEqual(app.phase, .connexion, "sans cookie, on demande le mot de passe")
        do {
            try await app.connecter(motDePasse: "mauvais")
            XCTFail("un mauvais mot de passe doit échouer")
        } catch {}
        try await app.connecter(motDePasse: mdp)
        XCTAssertEqual(app.phase, .pret)
        let t = try XCTUnwrap(app.tableau.donnees, "tableau de bord décodé")
        XCTAssertNotNil(t.journee?.sources)
        XCTAssertFalse(t.setup?.sessions?.isEmpty ?? true)
        XCTAssertFalse(app.chat.conversations.isEmpty)
        let premiere = try XCTUnwrap(app.chat.conversations.first)
        let ok = await app.chat.ouvrir(premiere.id)
        XCTAssertTrue(ok)
        XCTAssertFalse(app.chat.lignes.isEmpty)
        // Cocher une tâche va jusqu'à Motion (faux Motion en CI), et « Annuler » la rouvre.
        do {
            let tache = try XCTUnwrap(t.journee?.aFaire?.first ?? t.journee?.retard?.items.first, "la démo a des tâches à cocher")
            app.tableau.delaiAnnulation = 0.2
            let issue = await app.tableau.terminer(id: tache.id, titre: tache.titre)
            XCTAssertEqual(issue, .faite, app.toast ?? "")
            XCTAssertNotNil(app.tableau.cochees.first?.ledgerId)
            await app.tableau.annulerCoche(tache.id)
            XCTAssertTrue(app.tableau.cochees.isEmpty, app.toast ?? "")
            XCTAssertEqual(app.toast, "Annulé : « \(tache.titre) » est de retour.")
        }
        // Lot 0 : le vrai serveur dit sa version, et l'app la lit.
        let v = try await app.api.versionServeur()
        XCTAssertEqual(v.api, 1)
        XCTAssertTrue(v.sait("reglages"))
        XCTAssertEqual(app.serveur, v, "lue au chargement")
        // Réglages : le secours Claude se lit et se règle (sans objet en démo : pas de GLM).
        let r = try await app.api.reglages()
        XCTAssertEqual(r.secoursCloudSansObjet, true)
        let active = try await app.api.changerSecoursCloud(true)
        XCTAssertTrue(active.secoursCloud)
        let coupe = try await app.api.changerSecoursCloud(false)
        XCTAssertFalse(coupe.secoursCloud)
        // Contrat : chaque réponse que l'app lit se décode, telle que le serveur la rend.
        _ = try await app.api.memoire()
        _ = try await app.api.journal()
        _ = try await app.api.tableauDeBord(frais: true)
        // L'arrêt existe côté serveur (rien en cours : pas une erreur).
        try await app.api.arreter(premiere.id)
        // La dictée part en audio brut jusqu'à Dictée Locale (fausse en CI) et le texte revient.
        let dicte = try await app.api.transcrire(audio: Data(count: 2000), duree: 1.5)
        XCTAssertEqual(dicte, "Qu'est-ce que j'ai cet après-midi ?")
        print("INTEGRATION", t.journee?.items?.count ?? -1, "éléments ·", app.chat.lignes.count, "lignes")
    }
}
