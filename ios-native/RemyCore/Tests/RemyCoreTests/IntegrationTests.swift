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
        // Décodage tolérant (J1.2) : face au vrai serveur, rien n'est laissé de côté.
        XCTAssertEqual(t.partiesIllisibles, [], "parties illisibles : le contrat a dérivé")
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
        // J1.5 : une liste et un rappel font l'aller-retour avec la vraie tour.
        if v.sait("listes-v1") {
            let l = try XCTUnwrap(app.carnet.creerListe("Courses intégration"))
            app.carnet.ajouter(GenreCapture.articles("tomates, lait et œufs"), a: l)
            let r = try XCTUnwrap(app.carnet.creerRappel("Appeler le garage (intégration)", quand: Date().addingTimeInterval(86_400)))
            await app.carnet.envoyer()
            XCTAssertTrue(app.carnet.enAttente.isEmpty, app.toast ?? "")
            let relues = try await app.api.listes()
            XCTAssertEqual(relues.first { $0.id == l.id }?.elements.map(\.texte), ["tomates", "lait", "œufs"])
            let rappels = try await app.api.rappels()
            XCTAssertTrue(rappels.contains { $0.id == r.id })
            // Rien ne reste derrière (les captures de la CI suivent ce test).
            try await app.api.appliquer(.supprimerListe(id: l.id))
            try await app.api.appliquer(.supprimerRappel(id: r.id))
            let apres = try await app.api.listes()
            XCTAssertFalse(apres.contains { $0.id == l.id })
        }
        // Activité du PC (24/10) : allumée, la tour relit le faux ActivityWatch de la CI.
        if v.sait("activite-pc-v1") {
            let allumee = await app.activitePC.activer(true)
            XCTAssertTrue(allumee, app.toast ?? "")
            let a = try XCTUnwrap(app.activitePC.vue, "vue de l'activité décodée")
            XCTAssertTrue(a.actif)
            XCTAssertEqual(a.activitywatch.joignable, true, a.activitywatch.message ?? "")
            XCTAssertNil(a.probleme)
            XCTAssertEqual(a.semaine.parJour?.count, 7)
            let exclue = await app.activitePC.exclure("Discord.exe")
            XCTAssertTrue(exclue, app.toast ?? "")
            XCTAssertEqual(app.activitePC.vue?.exclusions, ["discord"])
            XCTAssertFalse(app.activitePC.vue?.semaine.applis.contains { $0.nom == "discord" } ?? true)
            // Rien ne reste derrière (les captures suivent ce test).
            _ = await app.activitePC.retirerExclusion("discord")
            _ = await app.activitePC.toutEffacer()
            _ = await app.activitePC.activer(false)
            XCTAssertEqual(app.activitePC.vue?.actif, false)
            XCTAssertEqual(app.activitePC.vue?.exclusions, [])
        }
        // Lot 1 : état de Motion, mesures et conseil, tels que la tour les rend.
        if v.sait("motion-etat-v1") { XCTAssertNotNil(t.journee?.motion, "journee.motion lu") }
        if v.sait("mesures-v1") {
            let m = try await app.api.mesures()
            XCTAssertNotNil(m.mesures["dashboard"], "le tableau de bord est mesuré")
        }
        if v.sait("conseil-v1") {
            let c = try await app.api.conseil(type: "priorites")
            XCTAssertEqual(c.type, "priorites")
        }
        // P2/P3 : étiquettes, sous-projets, analyses (faux GLM en CI) et historique.
        if v.sait("etiquettes-v1") {
            let e = Etiquette(nom: "Intégration")
            try await app.api.ecrireEtiquette(e)
            let avec = try await app.api.etiquettes()
            XCTAssertTrue(avec.contains { $0.id == e.id })
            try await app.api.supprimerEtiquette(e.id)
            let sans = try await app.api.etiquettes()
            XCTAssertFalse(sans.contains { $0.id == e.id })
        }
        if v.sait("dossiers-v1") {
            let d = Dossier(nom: "Sous-projet intégration", parent: "motion:p1")
            try await app.api.ecrireDossier(d)
            try await app.api.ecrireNotes(d.id, [NoteDossier(texte: "Une idée")])
            try await app.api.rattacher(tache: "t2", dossier: d.id)
            let lus = try await app.api.dossiers()
            let lu = try XCTUnwrap(lus.first { $0.id == d.id })
            XCTAssertEqual(lu.parent, "motion:p1")
            XCTAssertEqual(lu.notes.map(\.texte), ["Une idée"])
            XCTAssertEqual(lu.taches, ["t2"])
            try await app.api.rattacher(tache: "t2", dossier: nil)
            try await app.api.supprimerDossier(d.id)
            let apres = try await app.api.dossiers()
            XCTAssertFalse(apres.contains { $0.id == d.id })
        }
        if v.sait("analyse-capture-v1") {
            let elements = try await app.api.analyserCapture("Jeudi soir chez Yanis, samedi dispo le matin seulement, dimanche deux heures de studio")
            XCTAssertEqual(elements.first?.nature, "rendez-vous")
            XCTAssertEqual(elements.first?.pret, false, "un rendez-vous sans heure demande l'heure")
            XCTAssertEqual(elements.first { $0.nature == "tache" }?.dureeMin, 120)
        }
        if v.sait("analyse-rappels-v1") {
            let p = try await app.api.analyserRappels()
            XCTAssertFalse(p.isEmpty, "une proposition par rappel en cours")
        }
        // 18/10 : une proposition ajustée avant de dire oui (date, durée, catégorie),
        // une ligne rangée en rappel, puis « Oui » : c'est la version ajustée qui part.
        if v.sait("propositions-ajustables-v1") && v.sait("categories-taches-v1") {
            let ouvert = await app.chat.ouvrir("c11")
            XCTAssertTrue(ouvert)
            let p = { app.chat.lignes.first { $0.proposition?.id == "p-vidange" } }
            var ligne = try XCTUnwrap(p(), "la proposition de démo")
            let ajuste = await app.chat.ajuster(ligne, rang: 0, champs: ["echeance": Format.isoAvecFuseau(Format.echeanceDans(jours: 0)),
                                                                       "duree": 15, "etiquettes": ["et-voiture"], "type": "supprimer"])
            XCTAssertTrue(ajuste, app.toast ?? "")
            ligne = try XCTUnwrap(p())
            XCTAssertEqual(ligne.proposition?.actions.first?.duree?.texte, "15")
            XCTAssertEqual(ligne.proposition?.actions.first?.type, "creer", "le type vient toujours de la proposition d'origine")
            let range = await app.chat.rangerEnRappel(ligne, rang: 1, texte: "Acheter du liquide de refroidissement",
                                                      quand: Date().addingTimeInterval(86_400), etiquettes: ["et-voiture"])
            XCTAssertTrue(range, app.toast ?? "")
            let rappel = try XCTUnwrap(app.carnet.rappels.first { $0.texte == "Acheter du liquide de refroidissement" })
            await app.carnet.envoyer()
            XCTAssertTrue(app.carnet.enAttente.isEmpty, app.toast ?? "")
            // Relue depuis la tour : la version ajustée, une ligne en moins.
            let relu = await app.chat.ouvrir("c11")
            XCTAssertTrue(relu)
            ligne = try XCTUnwrap(p())
            XCTAssertEqual(ligne.proposition?.ajustee, true)
            XCTAssertEqual(ligne.proposition?.actions.map(\.libelle), ["Prendre rendez-vous pour la vidange"])
            XCTAssertEqual(ligne.proposition?.rangeesEnRappels, 1)
            let fait = await app.chat.appliquer(ligne)
            XCTAssertTrue(fait, app.toast ?? "")
            let jour = try await app.api.tableauDeBord(frais: true).journee
            let toutes = (jour?.aFaire ?? []) + (jour?.retard?.items ?? [])
            let creee = try XCTUnwrap(toutes.first { $0.titre == "Prendre rendez-vous pour la vidange" }, "la tâche créée est dans la journée")
            XCTAssertEqual(creee.etiquettes, ["et-voiture"], "la catégorie choisie est gardée par la tour")
            XCTAssertEqual(creee.duree, 15)
            let encore = await app.chat.ajuster(try XCTUnwrap(p()), rang: 0, champs: ["duree": 30])
            XCTAssertFalse(encore, "appliquée : plus d'ajustement")
            // Rien ne reste derrière (les captures suivent ce test).
            await app.chat.annuler(try XCTUnwrap(p()))
            XCTAssertEqual(p()?.proposition?.annulee, true, app.toast ?? "")
            try await app.api.appliquer(.supprimerRappel(id: rappel.id))
        }
        if v.sait("historique-v1") {
            // La coche puis « Annuler » plus haut sont dans l'historique, en mots.
            let h = try await app.api.historique()
            let e = try XCTUnwrap(h.first { $0.elements.contains { $0.action == "Terminée" } }, "la coche du test est journalisée")
            XCTAssertEqual(e.annule, true)
            XCTAssertTrue(e.origine.hasPrefix("Toi"), e.origine)
            // Une modification laissée en place (faux Motion) : la capture de
            // l'historique qui suit montre une entrée encore annulable.
            let modifiee = await app.tableau.modifier(id: "t8", titre: "Retoucher les photos", nouveauTitre: nil, echeance: nil, duree: 120, priorite: nil)
            XCTAssertTrue(modifiee, app.toast ?? "")
            let h2 = try await app.api.historique()
            let m = try XCTUnwrap(h2.first)
            XCTAssertEqual(m.elements.first?.action, "Durée changée", "\(m.elements)")
            XCTAssertEqual(m.annulable, true)
        }
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
