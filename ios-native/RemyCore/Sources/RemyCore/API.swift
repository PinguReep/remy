import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum ErreurAPI: Error, LocalizedError, Equatable {
    /// Session absente ou expirée : l'app repasse sur l'écran de connexion.
    case nonConnecte
    case serveur(Int, String)
    case reseau(String)
    case illisible

    public var errorDescription: String? {
        switch self {
        case .nonConnecte: return "Session expirée — reconnecte-toi."
        case .serveur(_, let m): return m
        case .reseau: return "Impossible de joindre Rémy. Vérifie ta connexion."
        case .illisible: return "Réponse illisible du serveur — réessaie."
        }
    }
}

/// Parle au même serveur que le site : mêmes routes /api, même session par
/// cookie (gardé par le système entre deux lancements).
public final class ClientAPI: @unchecked Sendable {
    /// Rémy tourne sur la tour depuis le 08/10/2026, publié par Tailscale Serve :
    /// joignable seulement quand le VPN Tailscale de l'iPhone est actif.
    public static let urlProduction = URL(string: "https://ma-tour.exemple.ts.net:8444")!

    public let base: URL
    private let session: URLSession
    /// Numéro de build de l'app, envoyé à chaque requête (X-Remy-App) : le
    /// serveur peut refuser proprement une app trop ancienne (426).
    public let build: String?
    /// Le jeton de cet appareil (J0.8b), envoyé à chaque requête.
    public let coffre: CoffreJeton
    /// Le serveur sait rendre le même résultat pour la même clé (Lot 0) : une
    /// coupure réseau peut alors être rejouée sans double effet. Faux face à une
    /// tour pas encore mise à jour — elle referait l'écriture.
    public var rejeuSur = false

    /// `coffre` : par défaut le Keychain ; avec une session fournie (tests,
    /// aperçus), la mémoire — un test ne touche jamais au vrai trousseau.
    public init(base: URL = ClientAPI.urlProduction, session: URLSession? = nil,
                build: String? = Bundle.main.infoDictionary?["CFBundleVersion"] as? String,
                coffre: CoffreJeton? = nil) {
        self.base = base
        self.build = build
        #if canImport(Security)
        self.coffre = coffre ?? (session == nil ? CoffreTrousseau(base: base) : CoffreMemoire())
        #else
        self.coffre = coffre ?? CoffreMemoire()
        #endif
        if let session {
            self.session = session
        } else {
            let conf = URLSessionConfiguration.default
            conf.httpCookieStorage = HTTPCookieStorage.shared
            conf.httpShouldSetCookies = true
            conf.httpCookieAcceptPolicy = .always
            conf.timeoutIntervalForRequest = 30
            self.session = URLSession(configuration: conf)
        }
    }

    // MARK: Requêtes de base

    private func requete(_ chemin: String, methode: String = "GET", corps: Data? = nil, delai: TimeInterval = 30,
                         typeCorps: String = "application/json") -> URLRequest {
        // appendingPathComponent encode « ? » en %3F : la requête (« ?frais=1 »)
        // se pose à part, sinon le serveur reçoit une route inconnue.
        let morceaux = chemin.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        var url = base.appendingPathComponent(String(morceaux[0]))
        if morceaux.count == 2, var c = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            c.percentEncodedQuery = String(morceaux[1])
            url = c.url ?? url
        }
        var r = URLRequest(url: url)
        r.httpMethod = methode
        r.timeoutInterval = delai
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if let build, Int(build) != nil { r.setValue(build, forHTTPHeaderField: "X-Remy-App") }
        if let jeton = coffre.lire() { r.setValue("Bearer \(jeton)", forHTTPHeaderField: "Authorization") }
        if let corps {
            r.httpBody = corps
            r.setValue(typeCorps, forHTTPHeaderField: "Content-Type")
        }
        return r
    }

    /// Transforme une réponse HTTP en erreur lisible par Sam.
    static func verifier(_ reponse: URLResponse, _ donnees: Data) throws {
        guard let http = reponse as? HTTPURLResponse else { throw ErreurAPI.illisible }
        guard !(200..<300).contains(http.statusCode) else { return }
        let obj = (try? JSONSerialization.jsonObject(with: donnees)) as? [String: Any]
        // Un mot de passe refusé n'est pas une session expirée.
        if http.statusCode == 401 && (obj?["error"] as? String) != "bad_password" { throw ErreurAPI.nonConnecte }
        let message = (obj?["message"] as? String) ?? (obj?["error"] as? String) ?? "Erreur \(http.statusCode) — réessaie."
        throw ErreurAPI.serveur(http.statusCode, message)
    }

    @discardableResult
    func brut(_ chemin: String, methode: String = "GET", corps: Data? = nil, delai: TimeInterval = 30,
              typeCorps: String = "application/json") async throws -> Data {
        let (donnees, reponse): (Data, URLResponse)
        do {
            (donnees, reponse) = try await session.data(for: requete(chemin, methode: methode, corps: corps, delai: delai, typeCorps: typeCorps))
        } catch {
            throw ErreurAPI.reseau(error.localizedDescription)
        }
        do {
            try Self.verifier(reponse, donnees)
        } catch ErreurAPI.nonConnecte {
            // Jeton révoqué (appareil déconnecté depuis la liste) ou session
            // expirée : il ne sert plus, la connexion en redonnera un.
            coffre.ecrire(nil)
            throw ErreurAPI.nonConnecte
        }
        return donnees
    }

    func json<T: Decodable>(_ type: T.Type, _ chemin: String, methode: String = "GET", corps: [String: Any]? = nil, delai: TimeInterval = 30) async throws -> T {
        let donnees = try await brut(chemin, methode: methode, corps: try corps.map { try JSONSerialization.data(withJSONObject: $0) }, delai: delai)
        do {
            return try JSONDecoder().decode(T.self, from: donnees)
        } catch {
            throw ErreurAPI.illisible
        }
    }

    private func envoyer(_ chemin: String, methode: String, corps: [String: Any]? = nil) async throws {
        try await brut(chemin, methode: methode, corps: try corps.map { try JSONSerialization.data(withJSONObject: $0) })
    }

    // MARK: Connexion

    /// Se connecter. `appareil` : le nom sous lequel cet iPhone apparaît dans la
    /// liste des appareils ; la tour rend un jeton à lui, rangé dans le Keychain.
    public func connexion(motDePasse: String, appareil: String = "iPhone") async throws {
        let d = try await brut("api/login", methode: "POST",
                               corps: try JSONSerialization.data(withJSONObject: ["password": motDePasse, "appareil": appareil]))
        if let j = (try? JSONDecoder().decode(JetonEmis.self, from: d))?.jeton { coffre.ecrire(j) }
    }

    /// Se déconnecter : la tour révoque le jeton de cet appareil, et l'app oublie tout.
    public func deconnexion() async {
        _ = try? await brut("api/logout", methode: "POST")
        coffre.ecrire(nil)
        if let cookies = HTTPCookieStorage.shared.cookies(for: base) {
            for c in cookies { HTTPCookieStorage.shared.deleteCookie(c) }
        }
    }

    /// L'app installée avant le Lot 0 n'a qu'un cookie : elle demande son jeton
    /// une fois, sans redemander le mot de passe.
    public func obtenirJeton(appareil: String = "iPhone") async throws {
        guard coffre.lire() == nil else { return }
        let r = try await json(JetonEmis.self, "api/appareils", methode: "POST", corps: ["nom": appareil])
        if let j = r.jeton { coffre.ecrire(j) }
    }

    public func appareils() async throws -> [Appareil] {
        try await json(ListeAppareils.self, "api/appareils").appareils
    }

    public func deconnecterAppareil(_ id: String) async throws {
        try await envoyer("api/appareils/\(id)", methode: "DELETE")
    }

    // MARK: Conversations

    public func conversations() async throws -> [ConversationResume] {
        try await json([ConversationResume].self, "api/conversations")
    }

    public func conversation(_ id: String) async throws -> Conversation {
        try await json(Conversation.self, "api/conversations/\(id)")
    }

    public func nouvelleConversation(session sessionOnboarding: String? = nil) async throws -> Conversation {
        try await json(Conversation.self, "api/conversations", methode: "POST", corps: sessionOnboarding.map { ["session": $0] } ?? [:])
    }

    public func renommer(_ id: String, titre: String) async throws {
        try await envoyer("api/conversations/\(id)", methode: "PATCH", corps: ["title": titre])
    }

    public func epingler(_ id: String, _ epingle: Bool) async throws {
        try await envoyer("api/conversations/\(id)", methode: "PATCH", corps: ["pinned": epingle])
    }

    public func supprimer(_ id: String) async throws {
        try await envoyer("api/conversations/\(id)", methode: "DELETE")
    }

    // MARK: Tableau de bord, sujets, capture, mémoire

    /// `frais` : Sam a tiré pour rafraîchir — le serveur relit Motion au lieu
    /// de rendre sa copie de la dernière minute.
    public func tableauDeBord(frais: Bool = false) async throws -> TableauDeBord {
        try await json(TableauDeBord.self, frais ? "api/dashboard?frais=1" : "api/dashboard", delai: 20)
    }

    public func etatSujet(_ id: String, etat: String) async throws {
        try await envoyer("api/briefing/etat", methode: "PUT", corps: ["id": id, "etat": etat])
    }

    /// Retenir un texte sans conversation. `source` dit d'où il vient :
    /// « note » (Sam lui-même), « chatgpt », « claude » — une réponse d'un
    /// autre assistant ne doit jamais devenir un fait sur Sam.
    public func capturer(_ texte: String, source: String = "note") async throws -> RetourCapture {
        let s = ["note", "chatgpt", "claude", "web"].contains(source) ? source : "note"
        return try await json(RetourCapture.self, "api/capture", methode: "POST", corps: ["texte": texte, "source": s], delai: 90)
    }

    public func memoire() async throws -> Memoire {
        try await json(Memoire.self, "api/memory")
    }

    public func enregistrerMemoire(_ texte: String) async throws {
        try await envoyer("api/memory", methode: "PUT", corps: ["text": texte])
    }

    public func onboarding() async throws -> EtatOnboarding {
        try await json(EtatOnboarding.self, "api/setup")
    }

    /// Enregistre l'état des sessions. `vuA` : l'horodatage lu, pour ne pas
    /// écraser une session que Rémy vient de cocher entre-temps.
    public func enregistrerOnboarding(etats: [String: String], convs: [String: String], vuA: Millis?) async throws {
        var corps: [String: Any] = ["etats": etats, "convs": convs]
        if let vuA { corps["vuA"] = vuA }
        try await envoyer("api/setup", methode: "PUT", corps: corps)
    }

    /// Signe de vie : l'app est ouverte devant Sam (mesure d'activité).
    public func signeDeVie() async {
        _ = try? await brut("api/activite/ping", methode: "POST")
    }

    // MARK: Version et réglages (Lot 0)

    public func versionServeur() async throws -> VersionServeur {
        try await json(VersionServeur.self, "api/version", delai: 10)
    }

    public func reglages() async throws -> Reglages {
        try await json(Reglages.self, "api/reglages")
    }

    /// Allume ou coupe un circuit de travail de fond (« nuit »…). Rend l'état effectif.
    public func changerCircuit(_ id: String, actif: Bool) async throws -> Reglages {
        try await json(Reglages.self, "api/reglages", methode: "PUT", corps: ["circuits": [id: actif]])
    }

    /// Active ou coupe le secours Claude (D21). Rend l'état effectif.
    public func changerSecoursCloud(_ actif: Bool) async throws -> Reglages {
        try await json(Reglages.self, "api/reglages", methode: "PUT", corps: ["secoursCloud": actif])
    }

    /// Recherche web (V8) : permise ou non. Permise, chaque recherche demande
    /// encore l'accord de Sam.
    public func changerRechercheWeb(_ actif: Bool) async throws -> Reglages {
        try await json(Reglages.self, "api/reglages", methode: "PUT", corps: ["rechercheWeb": actif])
    }

    /// Envoi de contexte au cloud (V8) : la conversation et la mémoire
    /// partent-elles avec une recherche autorisée ? Coupé par défaut.
    public func changerContexteCloud(_ actif: Bool) async throws -> Reglages {
        try await json(Reglages.self, "api/reglages", methode: "PUT", corps: ["contexteCloud": actif])
    }

    // MARK: Propositions Motion / Agenda

    /// Applique une proposition du chat (`p.id` : une seule écriture, quel que
    /// soit le nombre de taps ou d'appareils) ou un geste direct (`idCommande` :
    /// la même coche renvoyée après une coupure n'est pas refaite). Une coupure
    /// réseau est réessayée UNE fois avec la même clé : le serveur rend alors
    /// le résultat déjà obtenu au lieu d'écrire deux fois.
    public func appliquer(_ p: Proposition, convId: String?, index: Int?, idCommande: String? = nil) async throws -> ResultatApplication {
        let actions = try JSONSerialization.jsonObject(with: JSONEncoder().encode(p.actions))
        var corps: [String: Any] = ["actions": actions]
        if let r = p.resume { corps["resume"] = r }
        if let convId { corps["convId"] = convId }
        if let index { corps["index"] = index }
        if convId != nil, let id = p.id { corps["propositionId"] = id }
        if let idCommande { corps["idCommande"] = idCommande }
        let chemin = p.versAgenda ? "api/google/apply" : "api/motion/apply"
        let rejouable = rejeuSur && (corps["propositionId"] != nil || idCommande != nil)
        do {
            return try await json(ResultatApplication.self, chemin, methode: "POST", corps: corps, delai: 60)
        } catch ErreurAPI.reseau where rejouable {
            return try await json(ResultatApplication.self, chemin, methode: "POST", corps: corps, delai: 60)
        }
    }

    /// « Non merci » enregistré sur le serveur : la carte ne revient pas au
    /// rechargement, et Rémy sait que Sam a refusé.
    public func refuser(convId: String, propositionId: String) async throws {
        let pid = propositionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? propositionId
        try await envoyer("api/conversations/\(convId)/propositions/\(pid)/refus", methode: "POST", corps: [:])
    }

    /// Défait une proposition appliquée. « Déjà annulé » (409) est un succès :
    /// l'état voulu est atteint. Une écriture encore en cours (409 aussi) ne
    /// l'est pas : l'erreur remonte telle quelle.
    public func annuler(_ p: Proposition) async throws -> RetourAnnulation {
        guard let id = p.ledgerId else { return RetourAnnulation(ok: true, dejaAnnule: true) }
        do {
            return try await json(RetourAnnulation.self, p.versAgenda ? "api/google/undo" : "api/motion/undo",
                                  methode: "POST", corps: ["id": id], delai: 60)
        } catch ErreurAPI.serveur(409, let m) where m.hasPrefix("Déjà annulé") {
            return RetourAnnulation(ok: true, dejaAnnule: true)
        }
    }

    /// Le journal des changements appliqués (Motion et agenda) : sert à savoir
    /// si une proposition a été annulée depuis (ailleurs, ou avant un redémarrage).
    public func journal() async throws -> [EntreeJournal] {
        try await json(Journal.self, "api/motion/ledger").entries ?? []
    }

    // MARK: Voix

    /// Transcrit un enregistrement (AAC/m4a) sur la tour — Dictée Locale :
    /// l'audio n'est pas conservé, seul le texte revient. `duree` sert au
    /// journal des coûts (0 $ en local).
    public func transcrire(audio: Data, type: String = "audio/mp4", duree: Double) async throws -> String {
        let d = String(format: "%.1f", max(0, duree))
        let donnees = try await brut("api/transcribe?type=\(type)&dur=\(d)", methode: "POST", corps: audio, delai: 90,
                                     typeCorps: "application/octet-stream")
        guard let t = try? JSONDecoder().decode(Texte.self, from: donnees) else { throw ErreurAPI.illisible }
        return t.text ?? ""
    }

    // MARK: Message en flux

    /// Interrompt la réponse en cours de ce fil. Le serveur ne rend la main
    /// qu'une fois la réponse partielle enregistrée : le message suivant peut
    /// partir sans risque d'être écrasé.
    public func arreter(_ id: String) async throws {
        try await envoyer("api/conversations/\(id)/stop", methode: "POST")
    }

    /// Envoie un message et rend les événements au fil de l'eau (delta, status,
    /// proposal, title, done, error…). `appel` : mode appel, réponse courte et
    /// sans markdown, faite pour être lue à voix haute.
    public func envoyerMessage(conversation id: String, texte: String, appel: Bool = false) -> AsyncThrowingStream<EvenementSSE, Error> {
        flux("api/conversations/\(id)/messages", ["text": texte, "call": appel])
    }

    /// Réponse de Sam à une demande d'autorisation (V8) : accordée, Rémy
    /// cherche ; refusée, il répond sans le web. La réponse arrive en flux,
    /// comme pour un message.
    public func repondreAutorisation(conversation id: String, autorisation: String, accord: Bool) -> AsyncThrowingStream<EvenementSSE, Error> {
        let aid = autorisation.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? autorisation
        return flux("api/conversations/\(id)/autorisations/\(aid)", ["accord": accord])
    }

    private func flux(_ chemin: String, _ objet: [String: Any]) -> AsyncThrowingStream<EvenementSSE, Error> {
        let corps = try? JSONSerialization.data(withJSONObject: objet)
        let r = requete(chemin, methode: "POST", corps: corps, delai: 180)
        let session = self.session
        return AsyncThrowingStream { continuation in
            let tache = Task {
                var parseur = ParseurSSE()
                do {
                    #if canImport(FoundationNetworking)
                    // Linux (tests) : pas de flux octet par octet, on lit tout d'un coup.
                    let (donnees, reponse) = try await session.data(for: r)
                    try Self.verifier(reponse, donnees)
                    for e in parseur.alimenter(donnees) { continuation.yield(e) }
                    #else
                    let (octets, reponse) = try await session.bytes(for: r)
                    if let http = reponse as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        var corpsErreur = Data()
                        for try await o in octets { corpsErreur.append(o) }
                        try Self.verifier(reponse, corpsErreur)
                    }
                    var tampon: [UInt8] = []
                    tampon.reserveCapacity(512)
                    for try await o in octets {
                        tampon.append(o)
                        if o == 0x0A {
                            for e in parseur.alimenter(tampon) { continuation.yield(e) }
                            tampon.removeAll(keepingCapacity: true)
                        }
                    }
                    if !tampon.isEmpty { for e in parseur.alimenter(tampon) { continuation.yield(e) } }
                    #endif
                    for e in parseur.terminer() { continuation.yield(e) }
                    continuation.finish()
                } catch let e as ErreurAPI {
                    continuation.finish(throwing: e)
                } catch {
                    continuation.finish(throwing: ErreurAPI.reseau(error.localizedDescription))
                }
            }
            continuation.onTermination = { _ in tache.cancel() }
        }
    }
}
