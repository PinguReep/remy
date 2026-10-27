import XCTest
@testable import RemyCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Conversation privée depuis l'iPhone (27/10) : naître privée, le devenir
/// (sans retour), le dire ; l'interrupteur de recherche ; la jauge et le
/// résumé à 70 %.
@MainActor
final class PriveeTests: XCTestCase {
    override func tearDown() {
        FauxServeur.reponses = [:]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        FauxServeur.historique = [:]
        FauxServeur.delais = [:]
        FauxServeur.requetes = [:]
    }

    private func app(_ capacites: [String] = ["recherche-privee-v1", "jauge-v1", "compactage-v1"]) -> AppModel {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        let a = AppModel(api: ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf)))
        a.serveur = VersionServeur(api: 1, serveur: "0.9.0", capacites: capacites)
        return a
    }

    private let flux = "event: done\ndata: {\"text\":\"Je réponds d'ici.\",\"model\":\"glm\",\"tier\":\"local\"}\n\n"

    // MARK: Naître privée

    func testUneNouvelleConversationPriveeNaitPrivee() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(201, #"{"id":"p1","title":"Nouvelle conversation","messages":[],"prive":true}"#)],
            "POST /api/conversations/p1/messages": [(200, flux)],
            "GET /api/conversations": [(200, #"[{"id":"p1","title":"Nouvelle conversation","updatedAt":1,"prive":true}]"#)],
        ]
        let a = app()
        a.chat.nouvellePrivee()
        XCTAssertTrue(a.chat.privee, "le signe est là avant même le premier message")
        XCTAssertNil(a.chat.idCourant, "rien n'existe sur la tour avant le premier message")
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/conversations"))
        await a.chat.envoyer("Un secret")
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations"]?["prive"] as? Bool, true, "créée privée, jamais un instant publique")
        XCTAssertTrue(a.chat.privee)
        XCTAssertEqual(a.chat.conversations.first?.prive, true)
        // « Nouvelle » (ordinaire) : le signe s'en va.
        a.chat.nouvelle()
        XCTAssertFalse(a.chat.privee)
    }

    func testUneConversationOrdinaireNEnvoiePasPrive() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(201, #"{"id":"c1","title":"Nouvelle conversation","messages":[]}"#)],
            "POST /api/conversations/c1/messages": [(200, flux)],
            "GET /api/conversations": [(200, #"[{"id":"c1","title":"x","updatedAt":1}]"#)],
        ]
        let a = app()
        a.chat.nouvelle()
        await a.chat.envoyer("Bonjour")
        XCTAssertNil(FauxServeur.corps["POST /api/conversations"]?["prive"])
        XCTAssertFalse(a.chat.privee)
    }

    // MARK: Le devenir

    func testRendrePriveeLaConversationEnCours() async {
        FauxServeur.reponses = [
            "GET /api/conversations/c1": [(200, #"{"id":"c1","title":"Budget","messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]}"#)],
            "GET /api/conversations": [(200, #"[{"id":"c1","title":"Budget","updatedAt":1}]"#)],
            "PATCH /api/conversations/c1": [(200, #"{"id":"c1","title":"Budget","pinned":false,"prive":true}"#)],
        ]
        let a = app()
        _ = await a.chat.ouvrir("c1")
        XCTAssertFalse(a.chat.privee)
        let ok = await a.chat.rendrePrivee()
        XCTAssertTrue(ok)
        XCTAssertTrue(a.chat.privee)
        XCTAssertEqual(FauxServeur.corps["PATCH /api/conversations/c1"]?["prive"] as? Bool, true)
        XCTAssertEqual(a.chat.conversations.first { $0.id == "c1" }?.prive, true)
        XCTAssertEqual(a.toast, "Conversation privée : elle reste sur tes machines.")
        // Déjà privée : rien ne repart vers la tour.
        FauxServeur.recues = []
        _ = await a.chat.rendrePrivee()
        XCTAssertFalse(FauxServeur.recues.contains("PATCH /api/conversations/c1"))
    }

    func testUnRefusDeLaTourLaisseLaConversationTelleQuelle() async {
        FauxServeur.reponses = [
            "GET /api/conversations/c1": [(200, #"{"id":"c1","title":"Budget","messages":[{"role":"user","content":"a"}]}"#)],
            "GET /api/conversations": [(200, #"[{"id":"c1","title":"Budget","updatedAt":1}]"#)],
            "PATCH /api/conversations/c1": [(500, #"{"error":"Erreur serveur"}"#)],
        ]
        let a = app()
        _ = await a.chat.ouvrir("c1")
        let ok = await a.chat.rendrePrivee()
        XCTAssertFalse(ok)
        XCTAssertFalse(a.chat.privee, "pas de cadenas affiché tant que la tour ne l'a pas fait")
        XCTAssertNotNil(a.toast, "l'échec se dit")
    }

    func testRendrePriveeUnEcranVideNeContactePasLaTour() async {
        let a = app()
        a.chat.nouvelle()
        let ok = await a.chat.rendrePrivee()
        XCTAssertTrue(ok)
        XCTAssertTrue(a.chat.privee)
        XCTAssertTrue(FauxServeur.recues.isEmpty)
    }

    func testOuvrirUneConversationPriveeOuImporteeMontreLeSigne() async {
        FauxServeur.reponses = [
            "GET /api/conversations/p1": [(200, #"{"id":"p1","title":"Secret","prive":true,"messages":[]}"#)],
            "GET /api/conversations/i1": [(200, #"{"id":"i1","title":"Import","origine":{"source":"chatgpt"},"messages":[]}"#)],
            "GET /api/conversations/c1": [(200, #"{"id":"c1","title":"Ordinaire","messages":[]}"#)],
            "GET /api/conversations": [(200, #"[{"id":"p1","title":"Secret","updatedAt":1,"prive":true},{"id":"c1","title":"Ordinaire","updatedAt":1,"prive":false}]"#)],
        ]
        let a = app()
        _ = await a.chat.ouvrir("p1")
        XCTAssertTrue(a.chat.privee)
        _ = await a.chat.ouvrir("c1")
        XCTAssertFalse(a.chat.privee)
        _ = await a.chat.ouvrir("i1")
        XCTAssertTrue(a.chat.privee, "importée : privée d'office")
        XCTAssertEqual(a.chat.conversations.first { $0.id == "p1" }?.prive, true)
        a.chat.vider()
        XCTAssertFalse(a.chat.privee)
    }

    // MARK: Le dire

    func testCeQueCaChangeSeDitEnClair() {
        let coupe = ConversationPrivee.ceQueCaChange(.coupee)
        XCTAssertTrue(coupe.hasPrefix("Rien ne part chez Claude ni ailleurs"))
        XCTAssertTrue(coupe.contains("Pas de recherche web (Réglages › Recherche dans les conversations privées pour la permettre)"))
        // Contre-relecture : ce qui sort, exactement, quand elle est permise ;
        // « ni ailleurs » seulement quand rien d'autre ne sort.
        let permise = ConversationPrivee.ceQueCaChange(.permise)
        XCTAssertTrue(permise.hasPrefix("Rien ne part chez Claude :"))
        XCTAssertFalse(permise.contains("ni ailleurs"))
        XCTAssertFalse(permise.contains("seule la question"), "plus d'une question sort : celles de Rémy, puis de la salle blanche")
        XCTAssertTrue(permise.contains("questions générales, écrites par Rémy puis par la salle blanche"))
        XCTAssertTrue(permise.contains("les pages trouvées sont lues depuis ta tour"))
        XCTAssertTrue(permise.contains("le filtre bloque noms, numéros et mots de cette conversation"))
        XCTAssertFalse(permise.contains("Pas de recherche web"))
        XCTAssertFalse(ConversationPrivee.ceQueCaChange(.inconnu).contains("ni ailleurs"), "pas encore lu : pas de promesse")
        // Réglages n'est cité que si l'interrupteur y est actionnable.
        for etat in [EtatRecherchePrivee.sansReglage, .verrouillee] {
            let t = ConversationPrivee.ceQueCaChange(etat)
            XCTAssertFalse(t.contains("Réglages"), "\(etat) : l'interrupteur est caché ou grisé")
            XCTAssertTrue(t.contains("ni ailleurs"), "\(etat)")
        }
        XCTAssertTrue(ConversationPrivee.ceQueCaChange(.webCoupee).contains("Réglages › Recherche web"))
        XCTAssertFalse(ConversationPrivee.ceQueCaChange(.webCoupee).contains("Recherche dans les conversations privées"))
        // Le modèle local éteint : une condition, pas un état affirmé.
        XCTAssertTrue(coupe.hasSuffix("Si le modèle local est éteint, Rémy ne répond pas : rien ne bascule vers Claude."))
        XCTAssertFalse(coupe.contains("Modèle local éteint :"))
        XCTAssertTrue(ConversationPrivee.confirmation(.coupee).hasPrefix("C'est sans retour"), "l'irréversible se dit avant de confirmer")
        // Une seule phrase pour ce qui sort : la conversation, Réglages, les Nouveautés.
        let r = reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":true,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)
        XCTAssertTrue(r.phraseRecherchePrivee.contains(ConversationPrivee.ceQuiSort))
        let web = Nouveautes.catalogue.first { $0.id == "privee-iphone" }?.pages.map(\.texte).joined(separator: " ") ?? ""
        XCTAssertFalse(web.contains("seule la question"))
        XCTAssertTrue(web.contains("questions générales"))
    }

    func testLaRecherchePriveeSeLitSurLaTour() async {
        FauxServeur.reponses = ["GET /api/reglages": [(200, #"{"secoursCloud":false,"recherchePrivee":true,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true,"rechercheLocale":"duckduckgo","rechercheWeb":true}"#)]]
        let a = app()
        XCTAssertEqual(a.chat.etatRecherchePrivee, .inconnu)
        await a.chat.lireRecherchePrivee()
        XCTAssertEqual(a.chat.etatRecherchePrivee, .permise)
        let ancienne = app([])
        await ancienne.chat.lireRecherchePrivee()
        XCTAssertEqual(ancienne.chat.etatRecherchePrivee, .sansReglage, "tour sans le réglage : elle ne cherche pas")
    }

    /// Contre-relecture : l'état dit en clair suit la tour — verrou, web
    /// coupé (rien ne sort, interrupteur allumé ou non), coupé, permis.
    func testLEtatDeLaRecherchePriveeEtSaRaison() {
        XCTAssertEqual(EtatRecherchePrivee.de(reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":true,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)), .permise)
        XCTAssertEqual(EtatRecherchePrivee.de(reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":false,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)), .coupee)
        // Une tour d'avant la contre-relecture disait « permise » web coupé : l'app ne la croit pas.
        XCTAssertEqual(EtatRecherchePrivee.de(reglages(#"{"secoursCloud":false,"rechercheWeb":false,"rechercheLocale":"duckduckgo","recherchePrivee":true,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)), .webCoupee)
        XCTAssertEqual(EtatRecherchePrivee.de(reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheWebCoupeeParLaTour":true,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)), .webCoupee)
        XCTAssertEqual(EtatRecherchePrivee.de(reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":true,"salleBlanche":true}"#)), .verrouillee)
        XCTAssertEqual(EtatRecherchePrivee.de(reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":null,"recherchePrivee":false,"recherchePriveeReglage":false,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)), .verrouillee)
    }

    // MARK: Contre-relecture : rien de privé ne sort par un détour

    private let filPrive = #"{"id":"p1","title":"Secret","prive":true,"messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]}"#
    private let filOrdinaire = #"{"id":"c1","title":"Ordinaire","messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]}"#
    private let liste = #"[{"id":"p1","title":"Secret","updatedAt":1,"prive":true},{"id":"c1","title":"Ordinaire","updatedAt":1,"prive":false}]"#

    /// B1 : le brouillon d'une conversation privée ne suit pas dans une
    /// ordinaire (ouverte, ou « Nouvelle conversation ») ; il revient dans la
    /// prochaine privée.
    func testLeBrouillonPriveNeSuitPasDansUneConversationOrdinaire() async {
        FauxServeur.reponses = [
            "GET /api/conversations/p1": [(200, filPrive)],
            "GET /api/conversations/c1": [(200, filOrdinaire)],
            "GET /api/conversations": [(200, liste)],
            "POST /api/conversations": [(201, #"{"id":"n1","title":"Nouvelle conversation","messages":[]}"#)],
            "POST /api/conversations/n1/messages": [(200, flux)],
        ]
        let a = app()
        _ = await a.chat.ouvrir("p1")
        a.chat.brouillon = "BROUILLON-PRIVE"
        _ = await a.chat.ouvrir("c1")
        XCTAssertFalse(a.chat.privee)
        XCTAssertEqual(a.chat.brouillon, "", "le composeur ordinaire reste vide")
        XCTAssertEqual(a.chat.brouillonPrive, "BROUILLON-PRIVE")
        XCTAssertNotNil(a.toast, "Sam sait où est passé son texte")
        // Il revient dans la privée.
        _ = await a.chat.ouvrir("p1")
        XCTAssertEqual(a.chat.brouillon, "BROUILLON-PRIVE")
        XCTAssertEqual(a.chat.brouillonPrive, "")
        // « Nouvelle conversation » (ordinaire) : pareil, et rien ne part.
        a.chat.nouvelle()
        XCTAssertEqual(a.chat.brouillon, "")
        await a.chat.envoyer(a.chat.brouillon)
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/conversations/n1/messages"))
        // « Nouvelle conversation privée » : il revient.
        a.chat.nouvellePrivee()
        XCTAssertEqual(a.chat.brouillon, "BROUILLON-PRIVE")
        // Vers une conversation importée (sans composeur) : de côté aussi.
        FauxServeur.reponses["GET /api/conversations/i1"] = [(200, #"{"id":"i1","title":"Import","origine":{"source":"chatgpt"},"messages":[]}"#)]
        _ = await a.chat.ouvrir("i1")
        _ = await a.chat.ouvrir("c1")
        XCTAssertEqual(a.chat.brouillon, "", "privée → importée → ordinaire : toujours de côté")
        XCTAssertEqual(a.chat.brouillonPrive, "BROUILLON-PRIVE")
        // Un brouillon ordinaire, lui, suit comme avant.
        a.chat.brouillon = "ORDINAIRE"
        _ = await a.chat.ouvrir("c1")
        XCTAssertEqual(a.chat.brouillon, "ORDINAIRE")
        a.chat.vider()
        XCTAssertEqual(a.chat.brouillonPrive, "")
    }

    /// B2 : un « Envoyer après » mis en file dans une privée ne revient pas au
    /// composeur d'une ordinaire.
    func testLaFilePriveeNeRevientPasDansUneConversationOrdinaire() async throws {
        FauxServeur.reponses = [
            "GET /api/conversations/p1": [(200, filPrive)],
            "GET /api/conversations/c1": [(200, filOrdinaire)],
            "GET /api/conversations": [(200, liste)],
            "POST /api/conversations/p1/messages": [(200, flux)],
        ]
        FauxServeur.delais = ["POST /api/conversations/p1/messages": 400_000_000]
        let a = app()
        _ = await a.chat.ouvrir("p1")
        let envoi = Task { @MainActor in await a.chat.envoyer("question") }
        for _ in 0..<100 where !a.chat.envoi { try await Task.sleep(nanoseconds: 2_000_000) }
        XCTAssertTrue(a.chat.envoi)
        a.chat.envoyerApres("FILE-PRIVEE")
        _ = await a.chat.ouvrir("c1")
        _ = await envoi.value
        XCTAssertFalse(a.chat.privee)
        XCTAssertEqual(a.chat.brouillon, "")
        XCTAssertEqual(a.chat.fileEnvoi, [])
        XCTAssertEqual(a.chat.brouillonPrive, "FILE-PRIVEE")
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/conversations/c1/messages"))
    }

    /// B6 : « Noter une idée » depuis une conversation privée n'écrit rien
    /// dans la mémoire, et le dit.
    func testRetenirDepuisUneConversationPriveeNEcritRien() async {
        FauxServeur.reponses = ["POST /api/capture": [(200, #"{"ajouts":["x"],"memoire":true}"#)],
                                "POST /api/capture/infos": [(200, #"{"ajouts":["x"]}"#)]]
        let a = app()
        a.chat.nouvellePrivee()
        a.chat.modeRetenir = true
        a.chat.brouillon = "IDEE-PRIVEE : un texte assez long pour être retenu par Rémy."
        await a.chat.retenir()
        XCTAssertTrue(FauxServeur.recues.isEmpty, "rien vers /api/capture")
        XCTAssertEqual(a.toast, ConversationPrivee.pasDeMemoire)
        XCTAssertEqual(a.chat.brouillon, "IDEE-PRIVEE : un texte assez long pour être retenu par Rémy.", "le texte reste")
        let ok = await a.chat.retenirInfos(["une info"], source: "note", texte: a.chat.brouillon)
        XCTAssertFalse(ok)
        XCTAssertTrue(FauxServeur.recues.isEmpty)
        // La puce « Privée » coupe le mode Retenir.
        a.chat.nouvelle()
        a.chat.modeRetenir = true
        a.chat.basculerPriveeAvantEnvoi()
        XCTAssertTrue(a.chat.privee)
        XCTAssertFalse(a.chat.modeRetenir)
    }

    /// Bloquant : « Organiser ma journée » depuis l'écran vide d'une
    /// conversation privée garde le privé (le fil naît privé).
    func testOrganiserMaJourneeDepuisUnEcranPriveResteePrivee() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(201, #"{"id":"j1","title":"Nouvelle conversation","messages":[],"prive":true}"#)],
            "PATCH /api/conversations/j1": [(200, #"{"id":"j1","title":"x","prive":true}"#)],
            "POST /api/conversations/j1/messages": [(200, flux)],
            "GET /api/conversations": [(200, #"[{"id":"j1","title":"x","updatedAt":1,"prive":true}]"#)],
        ]
        let a = app()
        a.chat.nouvellePrivee()
        await a.organiserJournee()
        XCTAssertEqual(FauxServeur.corps["POST /api/conversations"]?["prive"] as? Bool, true)
        XCTAssertTrue(a.chat.privee, "le cadenas dit vrai")
        // Depuis une conversation ordinaire : ordinaire, comme avant.
        FauxServeur.corps = [:]
        a.chat.nouvelle()
        await a.organiserJournee()
        XCTAssertNil(FauxServeur.corps["POST /api/conversations"]?["prive"])
    }

    /// B3 : la tour ne dit pas « prive » à la création (tour qui l'ignorerait) :
    /// l'app la rend privée AVANT le premier message ; si la tour refuse, rien
    /// ne part et le texte revient.
    func testLeCadenasNeCroitQueLaTour() async {
        FauxServeur.reponses = [
            "POST /api/conversations": [(201, #"{"id":"x1","title":"Nouvelle conversation","messages":[]}"#)],
            "PATCH /api/conversations/x1": [(200, #"{"id":"x1","title":"Nouvelle conversation","prive":true}"#)],
            "POST /api/conversations/x1/messages": [(200, flux)],
            "GET /api/conversations": [(200, #"[{"id":"x1","title":"Nouvelle conversation","updatedAt":1,"prive":true}]"#)],
        ]
        let a = app()
        a.chat.nouvellePrivee()
        await a.chat.envoyer("Un secret")
        let ordre = FauxServeur.recues.filter { $0.hasPrefix("PATCH") || $0.hasPrefix("POST") }
        XCTAssertEqual(ordre, ["POST /api/conversations", "PATCH /api/conversations/x1", "POST /api/conversations/x1/messages"],
                       "rendue privée avant le premier message")
        XCTAssertEqual(FauxServeur.corps["PATCH /api/conversations/x1"]?["prive"] as? Bool, true)
        XCTAssertTrue(a.chat.privee)
        // La tour refuse : rien ne part, le fil vide s'en va, le texte revient.
        FauxServeur.reponses = [
            "POST /api/conversations": [(201, #"{"id":"x2","title":"Nouvelle conversation","messages":[]}"#)],
            "PATCH /api/conversations/x2": [(500, #"{"error":"Erreur serveur"}"#)],
            "DELETE /api/conversations/x2": [(200, "{}")],
        ]
        FauxServeur.recues = []
        a.chat.nouvellePrivee()
        let r = await a.chat.envoyer("Un autre secret")
        XCTAssertNil(r)
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/conversations/x2/messages"), "aucun message dans un fil ordinaire")
        XCTAssertTrue(FauxServeur.recues.contains("DELETE /api/conversations/x2"))
        XCTAssertEqual(a.chat.brouillon, "Un autre secret")
        XCTAssertNil(a.chat.idCourant, "le prochain envoi recrée un fil privé")
        XCTAssertFalse(a.chat.envoi)
        XCTAssertNotNil(a.toast)
    }

    /// B7 : « Rendre privée » pendant la création d'un fil ordinaire : refusé
    /// (le fil naîtrait ordinaire sous un cadenas), et dit.
    func testRendrePriveePendantLaCreationEstRefuse() async throws {
        FauxServeur.reponses = [
            "POST /api/conversations": [(201, #"{"id":"o2","title":"Nouvelle conversation","messages":[]}"#)],
            "POST /api/conversations/o2/messages": [(200, flux)],
            "GET /api/conversations": [(200, #"[{"id":"o2","title":"Nouvelle conversation","updatedAt":1}]"#)],
        ]
        FauxServeur.delais = ["POST /api/conversations": 300_000_000]
        let a = app()
        a.chat.nouvelle()
        let envoi = Task { @MainActor in await a.chat.envoyer("Bonjour") }
        for _ in 0..<100 where !FauxServeur.recues.contains("POST /api/conversations") { try await Task.sleep(nanoseconds: 2_000_000) }
        let ok = await a.chat.rendrePrivee()
        XCTAssertFalse(ok)
        XCTAssertFalse(a.chat.privee, "pas de cadenas sur un fil qui naît ordinaire")
        XCTAssertNotNil(a.toast)
        XCTAssertFalse(a.chat.basculerPriveeAvantEnvoi(), "la puce non plus")
        _ = await envoi.value
        XCTAssertFalse(a.chat.privee)
    }

    /// B4 : « Nouvelle conversation privée » touchée pendant la création d'une
    /// ordinaire : le message revient au champ (jamais perdu sans un mot), et
    /// le fil vide ne reste pas sur la tour.
    func testChangerDeFilPendantLaCreationRendLeMessage() async throws {
        FauxServeur.reponses = [
            "POST /api/conversations": [(201, #"{"id":"o1","title":"Nouvelle conversation","messages":[]}"#)],
            "POST /api/conversations/o1/messages": [(200, flux)],
            "DELETE /api/conversations/o1": [(200, "{}")],
            "GET /api/conversations": [(200, #"[{"id":"o1","title":"Nouvelle conversation","updatedAt":1}]"#)],
        ]
        FauxServeur.delais = ["POST /api/conversations": 300_000_000]
        let a = app()
        a.chat.nouvelle()
        let envoi = Task { @MainActor in await a.chat.envoyer("PREMIER-MESSAGE") }
        for _ in 0..<100 where !FauxServeur.recues.contains("POST /api/conversations") { try await Task.sleep(nanoseconds: 2_000_000) }
        a.chat.nouvellePrivee()
        let r = await envoi.value
        XCTAssertNil(r)
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/conversations/o1/messages"))
        XCTAssertEqual(a.chat.brouillon, "PREMIER-MESSAGE", "le texte revient au champ")
        XCTAssertTrue(FauxServeur.recues.contains("DELETE /api/conversations/o1"), "pas de fil vide laissé sur la tour")
        XCTAssertTrue(a.chat.privee)
        XCTAssertNil(a.chat.idCourant)
        XCTAssertNotNil(a.toast)
        // Dans l'autre sens : un message privé, Sam passe à une ordinaire
        // pendant la création → mis de côté, jamais dans le champ ordinaire.
        FauxServeur.reponses["POST /api/conversations"] = [(201, #"{"id":"o3","title":"Nouvelle conversation","messages":[],"prive":true}"#)]
        FauxServeur.reponses["DELETE /api/conversations/o3"] = [(200, "{}")]
        a.chat.brouillon = ""
        let prive = Task { @MainActor in await a.chat.envoyer("SECRET-PRIVE") }
        for _ in 0..<100 where !a.chat.envoi { try await Task.sleep(nanoseconds: 2_000_000) }
        a.chat.nouvelle()
        _ = await prive.value
        XCTAssertFalse(a.chat.privee)
        XCTAssertEqual(a.chat.brouillon, "")
        XCTAssertEqual(a.chat.brouillonPrive, "SECRET-PRIVE")
        XCTAssertFalse(FauxServeur.recues.contains("POST /api/conversations/o3/messages"))
    }

    /// La puce « Privée » au-dessus du champ : sur un écran vide seulement.
    func testLaPucePriveeBasculeUnEcranVide() async {
        FauxServeur.reponses = [
            "GET /api/conversations/c1": [(200, filOrdinaire)],
            "GET /api/conversations": [(200, liste)],
        ]
        let a = app()
        a.chat.nouvelle()
        XCTAssertTrue(a.chat.basculerPriveeAvantEnvoi())
        XCTAssertTrue(a.chat.privee)
        XCTAssertFalse(a.chat.basculerPriveeAvantEnvoi(), "touchée à nouveau : ordinaire")
        XCTAssertTrue(FauxServeur.recues.isEmpty, "rien n'existe encore sur la tour")
        _ = await a.chat.ouvrir("c1")
        XCTAssertFalse(a.chat.basculerPriveeAvantEnvoi(), "un fil existant passe par « Rendre privée » (sans retour)")
        XCTAssertFalse(a.chat.privee)
    }

    /// La dictée d'une conversation privée le dit à la tour (Dictée Locale seulement).
    func testLaDicteePriveeLeDitALaTour() async throws {
        FauxServeur.reponses = ["POST /api/transcribe": [(200, #"{"text":"bonjour"}"#)]]
        let a = app()
        _ = try await a.api.transcrire(audio: Data(count: 2000), duree: 1, prive: true)
        XCTAssertEqual(FauxServeur.requetes["POST /api/transcribe"]?.contains("prive=1"), true)
        _ = try await a.api.transcrire(audio: Data(count: 2000), duree: 1)
        XCTAssertEqual(FauxServeur.requetes["POST /api/transcribe"]?.contains("prive"), false)
    }

    // MARK: L'interrupteur (Réglages)

    private func reglages(_ json: String) -> Reglages {
        try! JSONDecoder().decode(Reglages.self, from: Data(json.utf8))
    }

    func testLInterrupteurDitCeQuiSortEtSonVerrou() {
        let coupe = reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":false,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)
        XCTAssertNil(coupe.verrouRecherchePrivee)
        XCTAssertFalse(coupe.recherchePriveeAffichee, "coupé par défaut")
        XCTAssertTrue(coupe.phraseRecherchePrivee.hasPrefix("Coupé"))
        XCTAssertTrue(coupe.phraseRecherchePrivee.contains("questions générales"))
        XCTAssertTrue(coupe.phraseRecherchePrivee.contains("salle blanche"))
        let allume = reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":true,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)
        XCTAssertTrue(allume.recherchePriveeAffichee)
        XCTAssertTrue(allume.phraseRecherchePrivee.hasPrefix("Allumé, Rémy peut chercher : partent vers le moteur"))
        let sansWeb = reglages(#"{"secoursCloud":false,"rechercheWeb":false,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)
        XCTAssertTrue(sansWeb.phraseRecherchePrivee.contains("la recherche web est coupée"))
        // Verrouillée sur la tour : grisée, et pourquoi.
        let verrou = reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":true,"salleBlanche":true}"#)
        XCTAssertEqual(verrou.verrouRecherchePrivee?.contains("REMY_RECHERCHE_PRIVEE=off"), true)
        XCTAssertFalse(verrou.recherchePriveeAffichee, "verrouillée : affichée coupée, même si le réglage est allumé")
        let sansSalle = reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":"duckduckgo","recherchePrivee":false,"recherchePriveeReglage":false,"recherchePriveeVerrouillee":true,"salleBlanche":false}"#)
        XCTAssertEqual(sansSalle.verrouRecherchePrivee?.contains("REMY_SALLE_BLANCHE=off"), true)
        let sansRecherche = reglages(#"{"secoursCloud":false,"rechercheWeb":true,"rechercheLocale":null,"recherchePrivee":false,"recherchePriveeReglage":false,"recherchePriveeVerrouillee":false,"salleBlanche":true}"#)
        XCTAssertNotNil(sansRecherche.verrouRecherchePrivee)
    }

    func testLInterrupteurEcritSurLaTour() async throws {
        FauxServeur.reponses = ["PUT /api/reglages": [(200, #"{"secoursCloud":false,"recherchePrivee":true,"recherchePriveeReglage":true,"recherchePriveeVerrouillee":false,"salleBlanche":true,"rechercheLocale":"duckduckgo","rechercheWeb":true}"#)]]
        let a = app()
        let r = try await a.api.changerRecherchePrivee(true)
        XCTAssertEqual(FauxServeur.corps["PUT /api/reglages"]?["recherchePrivee"] as? Bool, true)
        XCTAssertEqual(FauxServeur.corps["PUT /api/reglages"]?.count, 1, "seul ce réglage part")
        XCTAssertEqual(r.recherchePrivee, true)
    }

    // MARK: La jauge et le résumé à 70 %

    private func jauge(_ contexte: Int, sur fenetre: Int = 100_000) -> JaugeContexte {
        var j = JaugeContexte()
        j.contexte = contexte
        j.fenetre = fenetre
        return j
    }

    func testLaJaugeDitQuandLeResumeSeFera() {
        XCTAssertEqual(JaugeContexte.phraseCompactage(jauge(40_000), compactage: nil, automatique: true, messages: 20),
                       "Résumé automatique à 70 % : encore 30 points avant que Rémy résume le début du fil.")
        XCTAssertEqual(JaugeContexte.phraseCompactage(jauge(69_500), compactage: nil, automatique: nil, messages: 20),
                       "Résumé automatique à 70 % : encore 1 point avant que Rémy résume le début du fil.")
        XCTAssertTrue(JaugeContexte.phraseCompactage(jauge(72_000), compactage: nil, automatique: true, messages: 20)
            .hasPrefix("70 % atteints : Rémy résume le début du fil juste après sa réponse"))
        XCTAssertTrue(JaugeContexte.phraseCompactage(jauge(72_000), compactage: nil, automatique: true, messages: 4)
            .contains("trop court pour être résumé"))
        XCTAssertEqual(JaugeContexte.phraseCompactage(jauge(72_000), compactage: nil, automatique: false, messages: 20),
                       "Résumé automatique coupé (Réglages) : seulement à la main, ici.")
        XCTAssertEqual(JaugeContexte.phraseCompactage(JaugeContexte(), compactage: nil, automatique: true, messages: 2),
                       "Résumé automatique à 70 % de la place, dès qu'elle est mesurée.")
    }

    func testLaJaugeDitQuandLeResumeSEstFait() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = Format.fuseau
        let a = cal.date(from: DateComponents(year: 2026, month: 10, day: 27, hour: 14, minute: 2))!
        let c = Compactage(jusqua: 12, a: a.millis, resume: "…")
        let p = JaugeContexte.phraseCompactage(jauge(30_000), compactage: c, automatique: true, messages: 20)
        XCTAssertTrue(p.hasPrefix("Déjà résumé à 14:02 : les 12 premiers messages."), p)
        XCTAssertTrue(p.contains("encore 40 points"), p)
    }

    func testLaJaugeRelitLeResumeFaitSurLaTour() async {
        FauxServeur.reponses = [
            "GET /api/conversations/c1": [
                (200, #"{"id":"c1","title":"Long","messages":[{"role":"user","content":"a"}]}"#),
                (200, #"{"id":"c1","title":"Long","messages":[{"role":"user","content":"a"}],"compactage":{"jusqua":8,"a":1790000000000,"resume":"r"}}"#),
            ],
            "GET /api/conversations": [(200, #"[{"id":"c1","title":"Long","updatedAt":1}]"#)],
        ]
        let a = app()
        _ = await a.chat.ouvrir("c1")
        XCTAssertNil(a.chat.compactage)
        await a.chat.relireCompactage()
        XCTAssertEqual(a.chat.compactage?.jusqua, 8, "le résumé automatique, fait après la réponse, se voit en rouvrant la jauge")
    }
}
