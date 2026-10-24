import Foundation
import Observation

// MARK: - Le cerveau relié à la vie (nuit du 24/10)
//
// Trois choses que la tour sait faire et que l'iPhone montre :
//   - les priorités déclarées de Sam (priorites-v1) : versionnées sur la tour,
//     « négligée depuis N jours » calculé là-bas, sans IA ;
//   - le carnet proposé par Rémy (carnet-outils-v1) : « ajoute du lait » va
//     dans Courses, « rappelle-moi… » devient un rappel, sur un « Oui » ;
//   - les propositions qui attendent hors du chat (propositions-attente-v1) :
//     règles et sujets de plus pour la nuit, en notifications Oui / Plus tard.

/// Une priorité déclarée, telle que la tour la rend (avec ce qu'elle a calculé).
public struct Priorite: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var titre: String
    public var pourquoi: String?
    public var mots: [String]?
    public var declareeA: Millis?
    /// Jours sans trace d'activité qui reprenne ses mots (ou depuis sa déclaration).
    public var joursSans: Int?
    public var neglige: Bool?
    /// La phrase de la tour : un fait daté, jamais une supposition.
    public var constat: String?

    public init(id: String = "p-\(UUID().uuidString.prefix(8).lowercased())", titre: String, pourquoi: String? = nil, mots: [String]? = nil) {
        self.id = id
        self.titre = titre
        self.pourquoi = pourquoi
        self.mots = mots
    }
}

extension Priorite {
    /// Pour un champ de saisie : le pourquoi, vide plutôt qu'absent.
    public var pourquoiTexte: String {
        get { pourquoi ?? "" }
        set { pourquoi = newValue.isEmpty ? nil : newValue }
    }

    /// Les mots qui la reconnaissent, en une ligne (« musique, guitare »).
    public var motsTexte: String {
        get { (mots ?? []).joined(separator: ", ") }
        // Gardé tel que tapé (« musique, » doit pouvoir s'écrire) : découpé à l'envoi.
        set { mots = newValue.isEmpty ? nil : [newValue] }
    }
}

public struct VersionPriorites: Codable, Equatable, Sendable {
    public var version: Int
    public var a: Millis?
    public var titres: [String]?
    public var appareil: String?
}

/// GET /api/priorites
public struct VuePriorites: Codable, Equatable, Sendable {
    public var version: Int
    public var majA: Millis?
    public var priorites: [Priorite]
    public var historique: [VersionPriorites]?

    public init(version: Int = 0, majA: Millis? = nil, priorites: [Priorite] = [], historique: [VersionPriorites]? = nil) {
        self.version = version
        self.majA = majA
        self.priorites = priorites
        self.historique = historique
    }
}

public enum Priorites {
    public static let maximum = 5

    /// Ce qui part vers la tour : titres non vides, pourquoi et mots propres,
    /// doublons retirés (même règle que la tour, pour un retour immédiat).
    public static func aEnvoyer(_ liste: [Priorite]) -> [Priorite] {
        var vus = Set<String>()
        return liste.compactMap { p in
            let titre = p.titre.trimmingCharacters(in: .whitespacesAndNewlines)
            let cle = titre.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "fr_FR"))
            guard !titre.isEmpty, !vus.contains(cle) else { return nil }
            vus.insert(cle)
            var q = Priorite(id: p.id, titre: String(titre.prefix(80)))
            let pq = (p.pourquoi ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            q.pourquoi = pq.isEmpty ? nil : String(pq.prefix(240))
            let mots = (p.mots ?? []).flatMap { Priorites.mots(depuis: $0) }.filter { $0.count >= 3 }
            q.mots = mots.isEmpty ? nil : Array(mots.prefix(8))
            return q
        }
    }

    /// « Mots : musique, guitare » saisi d'une traite → la liste.
    public static func mots(depuis texte: String) -> [String] {
        texte.split(whereSeparator: { $0 == "," || $0 == ";" || $0 == "\n" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    /// La ligne d'état sous une priorité.
    public static func etat(_ p: Priorite) -> String? {
        if p.neglige == true, let c = p.constat { return "Négligée : \(c)" }
        if let j = p.joursSans {
            return j == 0 ? "Active aujourd'hui" : j == 1 ? "Dernière trace hier" : "Dernière trace il y a \(j) jours"
        }
        return nil
    }
}

// MARK: - Propositions en attente (notifications Oui / Plus tard)

/// GET /api/propositions/attente : une proposition qui attend un « oui » hors du chat.
public struct PropositionEnAttente: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    /// « regles » (fil des règles de Rémy) ou « nuit » (un sujet de plus pour la réflexion).
    public var origine: String
    public var convId: String?
    /// « motion » ou « agenda » pour une proposition des règles.
    public var source: String?
    public var titre: String
    public var texte: String
    public var sujet: String?
    public var nombre: Int?
    public var a: Millis?

    public init(id: String, origine: String, convId: String? = nil, source: String? = nil, titre: String, texte: String, sujet: String? = nil, nombre: Int? = 1) {
        self.id = id
        self.origine = origine
        self.convId = convId
        self.source = source
        self.titre = titre
        self.texte = texte
        self.sujet = sujet
        self.nombre = nombre
    }

    /// Ce que dit la notification (titre, corps).
    public var notification: (titre: String, corps: String) {
        if origine == "nuit" { return ("Cette nuit, je creuse aussi ?", String(texte.prefix(220))) }
        let n = nombre ?? 1
        let quoi = source == "agenda" ? (n > 1 ? "\(n) rendez-vous" : "Un rendez-vous") : (n > 1 ? "\(n) tâches" : "Une tâche")
        return ("\(quoi) d'après tes règles", String(texte.prefix(220)))
    }
}

struct ListePropositionsEnAttente: Codable { var propositions: [PropositionEnAttente] }

public enum PropositionsAttente {
    public static let cleNotifiees = "remy.propositions.notifiees"
    public static let cleActives = "remy.propositions.notifications"
    /// Au plus, par passage : une pile de notifications n'aide personne.
    public static let maxParPassage = 2

    /// Les notifications sont-elles voulues (Réglages, allumées par défaut) ?
    public static func actives(_ r: UserDefaults = .standard) -> Bool {
        r.object(forKey: cleActives) == nil ? true : r.bool(forKey: cleActives)
    }

    /// Les nouvelles, jamais notifiées, les plus anciennes d'abord ; et les
    /// identifiants à garder en mémoire (seulement ceux encore en attente).
    public static func aNotifier(_ liste: [PropositionEnAttente], deja: Set<String>) -> (nouvelles: [PropositionEnAttente], garder: Set<String>) {
        let ids = Set(liste.map(\.id))
        let nouvelles = liste.filter { !deja.contains($0.id) }.sorted { ($0.a ?? 0) < ($1.a ?? 0) }.prefix(maxParPassage)
        return (Array(nouvelles), deja.intersection(ids).union(nouvelles.map(\.id)))
    }
}

// MARK: - Requêtes

extension ClientAPI {
    public func priorites() async throws -> VuePriorites {
        try await json(VuePriorites.self, "api/priorites")
    }

    /// Une version de plus ; `base` : celle qu'on avait sous les yeux (409 si une autre est passée entre-temps).
    public func enregistrerPriorites(_ liste: [Priorite], base: Int) async throws -> VuePriorites {
        let lignes: [[String: Any]] = liste.map { p in
            var l: [String: Any] = ["id": p.id, "titre": p.titre]
            if let q = p.pourquoi { l["pourquoi"] = q }
            if let m = p.mots { l["mots"] = m }
            return l
        }
        return try await json(VuePriorites.self, "api/priorites", methode: "PUT", corps: ["priorites": lignes, "base": base])
    }

    /// Sam valide les courses ou le rappel proposés : la tour les lit dans la conversation.
    public func validerCarnet(convId: String, propositionId: String) async throws -> Bilan? {
        let pid = propositionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? propositionId
        return try await json(ResultatCarnet.self, "api/conversations/\(convId)/propositions/\(pid)/carnet", methode: "POST", corps: [:]).bilan
    }

    public func propositionsEnAttente() async throws -> [PropositionEnAttente] {
        try await json(ListePropositionsEnAttente.self, "api/propositions/attente").propositions
    }

    /// « Oui » à un sujet de plus pour la nuit.
    public func accepterSujetNuit(_ sujet: String) async throws {
        try await brut("api/propositions/nuit", methode: "POST", corps: try JSONSerialization.data(withJSONObject: ["sujet": sujet]))
    }

    /// « Oui » depuis une notification : la tour relit la proposition dans son fil.
    public func accepter(_ p: PropositionEnAttente) async throws -> String {
        if p.origine == "nuit" {
            guard let s = p.sujet else { throw ErreurAPI.illisible }
            try await accepterSujetNuit(s)
            return "Ajouté à la réflexion de cette nuit."
        }
        guard let convId = p.convId else { throw ErreurAPI.illisible }
        let prop = Proposition(id: p.id, source: p.source ?? "motion", resume: nil, actions: [])
        let r = try await appliquer(prop, convId: convId, index: nil)
        if r.etat == "echouee" {
            let raison = r.results?.compactMap(\.erreur).first ?? "rien n'a pu être écrit"
            throw ErreurAPI.serveur(502, raison)
        }
        return p.source == "agenda" ? "C'est dans ton agenda." : "C'est dans Motion."
    }
}

struct ResultatCarnet: Codable {
    var ok: Bool?
    var statut: String?
    var bilan: Bilan?
}
