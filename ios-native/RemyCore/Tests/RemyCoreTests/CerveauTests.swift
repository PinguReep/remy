import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Le cerveau relié à la vie (24/10) : les réponses de la tour se décodent,
/// les notifications ne se répètent pas, et la carte « carnet » se valide.
final class CerveauDecodageTests: XCTestCase {
    func testLesPrioritesSeLisentEtPartentPropres() throws {
        let json = #"{"version":2,"majA":1761300000000,"priorites":[{"id":"p-musique","titre":"La musique","pourquoi":"Jouer me rend calme","mots":["musique","guitare"],"declareeA":1759500000000,"joursSans":12,"neglige":true,"constat":"rien depuis 12 jours","derniereActivite":{"a":1760200000000,"quoi":"conversation","texte":"Choisir une guitare"}},{"id":"p-proches","titre":"Voir Léa et Hugo","joursSans":1,"neglige":false,"constat":null}],"historique":[{"version":2,"a":1761300000000,"titres":["La musique","Voir Léa et Hugo"],"appareil":null},{"version":1,"a":1759500000000,"titres":["La musique"]}]}"#
        let v = try JSONDecoder().decode(VuePriorites.self, from: Data(json.utf8))
        XCTAssertEqual(v.version, 2)
        XCTAssertEqual(v.priorites.count, 2)
        XCTAssertEqual(v.historique?.count, 2)
        XCTAssertEqual(Priorites.etat(v.priorites[0]), "Négligée : rien depuis 12 jours")
        XCTAssertEqual(Priorites.etat(v.priorites[1]), "Dernière trace hier")

        // Ce qui part : vides et doublons retirés, mots découpés à l'envoi.
        var brouillon = v.priorites
        brouillon[0].motsTexte = "musique, guitare, répétition, x"
        brouillon.append(Priorite(titre: "  la MUSIQUE "))
        brouillon.append(Priorite(titre: "   "))
        let envoi = Priorites.aEnvoyer(brouillon)
        XCTAssertEqual(envoi.map(\.titre), ["La musique", "Voir Léa et Hugo"])
        XCTAssertEqual(envoi[0].mots, ["musique", "guitare", "répétition"], "« x » est trop court pour reconnaître quoi que ce soit")
        XCTAssertNil(envoi[0].joursSans, "les calculs de la tour ne repartent pas")
        XCTAssertNil(envoi[1].pourquoi)
        // Le champ « mots » se tape librement (la virgule finale reste).
        var p = Priorite(titre: "Sport")
        p.motsTexte = "course, "
        XCTAssertEqual(p.motsTexte, "course, ")
        p.pourquoiTexte = ""
        XCTAssertNil(p.pourquoi)
    }

    func testLesPropositionsEnAttenteNeSeNotifientQuUneFois() throws {
        let json = #"{"propositions":[{"id":"p-rasage","origine":"regles","convId":"c-regles","source":"motion","titre":"Règles de Rémy","texte":"« Rasage » avant « Soirée chez Léo » (samedi 25 19:00)","nombre":1,"a":2000},{"id":"nuit-abc","origine":"nuit","titre":"Cette nuit, aussi ?","texte":"Compare deux fournisseurs de cire","sujet":"Compare deux fournisseurs de cire","nombre":1,"a":1000},{"id":"p-valise","origine":"regles","convId":"c-regles","source":"agenda","titre":"Règles de Rémy","texte":"« Valise »","nombre":2,"a":3000}]}"#
        let liste = try JSONDecoder().decode(ListePropositionsEnAttente.self, from: Data(json.utf8)).propositions
        XCTAssertEqual(liste.count, 3)
        XCTAssertEqual(liste[0].notification.titre, "Une tâche d'après tes règles")
        XCTAssertEqual(liste[1].notification.titre, "Cette nuit, je creuse aussi ?")
        XCTAssertEqual(liste[2].notification.titre, "2 rendez-vous d'après tes règles")

        // Deux au plus par passage, les plus anciennes d'abord.
        let premier = PropositionsAttente.aNotifier(liste, deja: [])
        XCTAssertEqual(premier.nouvelles.map(\.id), ["nuit-abc", "p-rasage"])
        // Au passage suivant : la troisième seulement ; une tranchée ailleurs est oubliée.
        let second = PropositionsAttente.aNotifier(Array(liste.dropFirst()), deja: premier.garder.union(["ancienne"]))
        XCTAssertEqual(second.nouvelles.map(\.id), ["p-valise"])
        XCTAssertEqual(second.garder, ["nuit-abc", "p-valise"])
        XCTAssertTrue(PropositionsAttente.aNotifier(Array(liste.dropFirst()), deja: second.garder).nouvelles.isEmpty)
    }

    func testUneActionDuCarnetEtLaPrioriteDuConseilSeLisent() throws {
        let p = try JSONDecoder().decode(Proposition.self, from: Data(#"{"id":"p1","source":"carnet","statut":"en_attente","actions":[{"type":"liste","liste":"Courses","articles":["lait","œufs"]},{"type":"rappel","texte":"Appeler Léa","quand":"2026-10-25T07:00:00.000Z"}]}"#.utf8))
        XCTAssertEqual(p.actions[0].articles, ["lait", "œufs"])
        XCTAssertEqual(p.actions[1].texte, "Appeler Léa")
        XCTAssertNotNil(Format.echeance(p.actions[1].quand), "l'heure du rappel s'affiche")
        let c = try JSONDecoder().decode(ConseilTour.self, from: Data(#"{"type":"libre","conseil":{"texte":"Joue vingt minutes.","pourquoi":["Tu as dit que la musique compte"],"tache":null,"priorite":"La musique","genereA":1,"source":"glm"},"aJour":true}"#.utf8))
        XCTAssertEqual(c.conseil?.priorite, "La musique")
    }
}

@MainActor
final class CerveauTests: XCTestCase {
    func app() -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        return AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
    }

    func testAjouterAuCarnetDepuisLaCarte() async throws {
        let json = #"{"id":"c1","title":"x","messages":[{"role":"user","content":"Ajoute du lait."},{"role":"assistant","content":"Je te propose ça.","proposal":{"id":"p1","source":"carnet","actions":[{"type":"liste","liste":"Courses","articles":["lait"]}],"statut":"en_attente"}}]}"#
        FauxServeur.reponses = [
            "POST /api/conversations/c1/propositions/p1/carnet": [(200, #"{"ok":true,"statut":"applique","bilan":{"faits":["« lait » dans « Courses »"]}}"#)],
            "GET /api/conversations": [(200, "[]")],
        ]
        let a = app()
        await a.chat.ouvrir(try JSONDecoder().decode(Conversation.self, from: Data(json.utf8)))
        let l = try XCTUnwrap(a.chat.lignes.last)
        XCTAssertEqual(l.proposition?.source, "carnet")
        let ok = await a.chat.validerCarnet(l)
        XCTAssertTrue(ok)
        XCTAssertEqual(a.chat.lignes.last?.proposition?.statut, "applique")
        XCTAssertEqual(a.toast, "Ajouté : « lait » dans « Courses ».")
        XCTAssertTrue(FauxServeur.recues.contains("POST /api/conversations/c1/propositions/p1/carnet"))
    }

    func testUnRefusDeLaTourEstDitAvecQuoiFaire() async throws {
        let json = #"{"id":"c2","title":"x","messages":[{"role":"assistant","content":"…","proposal":{"id":"p2","source":"carnet","actions":[{"type":"rappel","texte":"Appeler Léa"}],"statut":"en_attente"}}]}"#
        FauxServeur.reponses = [
            "POST /api/conversations/c2/propositions/p2/carnet": [(400, #"{"error":"carnet","message":"Pas plus de 2000 rappels."}"#)],
        ]
        let a = app()
        await a.chat.ouvrir(try JSONDecoder().decode(Conversation.self, from: Data(json.utf8)))
        let ok = await a.chat.validerCarnet(try XCTUnwrap(a.chat.lignes.last))
        XCTAssertFalse(ok)
        XCTAssertEqual(a.chat.lignes.last?.proposition?.statut, "en_attente", "la carte reste, retentable")
        XCTAssertTrue(a.toast?.hasPrefix("Pas ajouté : Pas plus de 2000 rappels.") ?? false, a.toast ?? "")
    }

    /// Contre le vrai serveur de la CI (données de démo) : priorités, carnet, attente.
    func testCerveauContreLeVraiServeur() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let u = env["REMY_TEST_URL"], let url = URL(string: u), let mdp = env["REMY_TEST_MDP"] else {
            throw XCTSkip("REMY_TEST_URL absent")
        }
        let api = ClientAPI(base: url, session: URLSession(configuration: .ephemeral))
        try await api.connexion(motDePasse: mdp, appareil: "Tests du cerveau")
        let v = try await api.priorites()
        XCTAssertEqual(v.priorites.map(\.titre), ["La musique", "Lancer la boutique de bougies", "Voir Léa et Hugo"], "priorités de la démo")
        XCTAssertNotNil(v.priorites.first?.joursSans, "la tour calcule les jours sans trace")
        // La même liste renvoyée : pas de nouvelle version ; une base périmée : refus.
        let meme = try await api.enregistrerPriorites(Priorites.aEnvoyer(v.priorites), base: v.version)
        XCTAssertEqual(meme.version, v.version)
        do {
            _ = try await api.enregistrerPriorites([Priorite(titre: "Autre chose")], base: v.version - 1)
            XCTFail("une version périmée doit être refusée")
        } catch let e as ErreurAPI {
            guard case .serveur(409, _) = e else { return XCTFail("attendu 409, reçu \(e)") }
        }
        let bilan = try await api.validerCarnet(convId: "c-carnet", propositionId: "p-carnet-demo")
        XCTAssertEqual(bilan?.faits?.count, 2, "un article et un rappel")
        let rejoue = try await api.validerCarnet(convId: "c-carnet", propositionId: "p-carnet-demo")
        XCTAssertEqual(rejoue?.faits?.count, 2, "un second oui rend le même bilan")
        _ = try await api.propositionsEnAttente()
    }
}
