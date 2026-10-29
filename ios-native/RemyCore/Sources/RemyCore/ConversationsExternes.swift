import Foundation
import Observation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// MARK: - Les conversations externes (conversations-externes-v1, 29/10)
//
// Ce que tu as dit ailleurs — sessions Claude Code, fils de T3 Code (sur
// l'ordinateur ou le téléphone), export ChatGPT — lu par la tour, rangé
// chiffré dans ton coffre, montré ici. Rien ne repart vers Claude ni
// OpenAI : l'import est à sens unique, et Rémy ne s'en sert qu'avec son
// modèle local. Contrat : docs/conversations-externes.md.

public struct ProblemeSource: Codable, Equatable, Sendable {
    public var code: String
    public var message: String
    public var quoiFaire: String?

    public init(code: String, message: String, quoiFaire: String? = nil) {
        self.code = code
        self.message = message
        self.quoiFaire = quoiFaire
    }
}

public struct SourceConversations: Codable, Equatable, Identifiable, Sendable {
    public struct Emplacement: Codable, Equatable, Sendable {
        public var origine: String
        public var chemin: String
        public var trouve: Bool
    }
    public var id: String
    public var nom: String
    public var actif: Bool
    public var forceParLaTour: Bool
    public var disponible: Bool
    public var emplacements: [Emplacement]
    public var derniereLecture: Millis?
    public var derniereReussie: Millis?
    public var conversations: Int
    public var messages: Int
    public var derniereConversation: Millis?
    public var erreur: ProblemeSource?
    public var aide: ProblemeSource?

    public init(id: String, nom: String, actif: Bool = true, forceParLaTour: Bool = false, disponible: Bool = true, emplacements: [Emplacement] = [],
                derniereLecture: Millis? = nil, derniereReussie: Millis? = nil, conversations: Int = 0, messages: Int = 0,
                derniereConversation: Millis? = nil, erreur: ProblemeSource? = nil, aide: ProblemeSource? = nil) {
        self.id = id
        self.nom = nom
        self.actif = actif
        self.forceParLaTour = forceParLaTour
        self.disponible = disponible
        self.emplacements = emplacements
        self.derniereLecture = derniereLecture
        self.derniereReussie = derniereReussie
        self.conversations = conversations
        self.messages = messages
        self.derniereConversation = derniereConversation
        self.erreur = erreur
        self.aide = aide
    }

    enum CodingKeys: String, CodingKey {
        case id, nom, actif, forceParLaTour, disponible, emplacements, derniereLecture, derniereReussie, conversations, messages, derniereConversation, erreur, aide
    }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        nom = (try? c.decodeIfPresent(String.self, forKey: .nom)) ?? ConversationsExternes.nomSource(id)
        actif = (try? c.decodeIfPresent(Bool.self, forKey: .actif)) ?? false
        forceParLaTour = (try? c.decodeIfPresent(Bool.self, forKey: .forceParLaTour)) ?? false
        disponible = (try? c.decodeIfPresent(Bool.self, forKey: .disponible)) ?? true
        emplacements = (try? c.decodeIfPresent([Emplacement].self, forKey: .emplacements)) ?? []
        derniereLecture = try? c.decodeIfPresent(Millis.self, forKey: .derniereLecture)
        derniereReussie = try? c.decodeIfPresent(Millis.self, forKey: .derniereReussie)
        conversations = (try? c.decodeIfPresent(Int.self, forKey: .conversations)) ?? 0
        messages = (try? c.decodeIfPresent(Int.self, forKey: .messages)) ?? 0
        derniereConversation = try? c.decodeIfPresent(Millis.self, forKey: .derniereConversation)
        erreur = try? c.decodeIfPresent(ProblemeSource.self, forKey: .erreur)
        aide = try? c.decodeIfPresent(ProblemeSource.self, forKey: .aide)
    }

    /// Une ligne d'état : « Lue à 14:20 · 42 conversations », ou ce qui ne va pas.
    public func phrase(maintenant: Date = Date()) -> String {
        if !actif { return forceParLaTour ? "Coupée sur la tour (remy.env)." : "Coupée : rien n'est lu." }
        if let e = erreur { return e.message }
        if conversations == 0, let a = aide { return a.message }
        let n = conversations == 1 ? "1 conversation" : "\(Format.entier(conversations)) conversations"
        guard let l = derniereLecture else { return id == "chatgpt" ? n : "Pas encore lue : première lecture dans 30 min au plus." }
        return "Lue \(Format.depuis(Date(timeIntervalSince1970: l / 1000), maintenant: maintenant)) · \(n)"
    }
}

public struct UsageConversations: Codable, Equatable, Sendable {
    public var chat: Bool
    public var nuit: Bool
    public var forceParLaTour: Bool

    public init(chat: Bool = true, nuit: Bool = true, forceParLaTour: Bool = false) {
        self.chat = chat
        self.nuit = nuit
        self.forceParLaTour = forceParLaTour
    }

    enum CodingKeys: String, CodingKey { case chat, nuit, forceParLaTour }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        chat = (try? c.decodeIfPresent(Bool.self, forKey: .chat)) ?? false
        nuit = (try? c.decodeIfPresent(Bool.self, forKey: .nuit)) ?? false
        forceParLaTour = (try? c.decodeIfPresent(Bool.self, forKey: .forceParLaTour)) ?? false
    }
}

/// GET /api/conversations-externes.
public struct EtatConversations: Codable, Equatable, Sendable {
    public struct Cle: Codable, Equatable, Sendable {
        public var origine: String?
        public var emplacement: String?
        public var erreur: ProblemeSource?
    }
    public struct Imports: Codable, Equatable, Sendable {
        public var dossier: String?
        public var enAttente: Int?
        public var importes: Int?
    }
    public struct Total: Codable, Equatable, Sendable {
        public var conversations: Int
        public var messages: Int
    }
    public var sources: [SourceConversations]
    public var usage: UsageConversations
    public var chiffre: Bool
    public var cle: Cle?
    public var imports: Imports?
    public var total: Total

    public init(sources: [SourceConversations], usage: UsageConversations = UsageConversations(), chiffre: Bool = true, cle: Cle? = nil, imports: Imports? = nil, total: Total? = nil) {
        self.sources = sources
        self.usage = usage
        self.chiffre = chiffre
        self.cle = cle
        self.imports = imports
        self.total = total ?? Total(conversations: sources.reduce(0) { $0 + $1.conversations }, messages: sources.reduce(0) { $0 + $1.messages })
    }

    enum CodingKeys: String, CodingKey { case sources, usage, chiffre, cle, imports, total }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        sources = (try? c.decodeIfPresent([SourceConversations].self, forKey: .sources)) ?? []
        usage = (try? c.decodeIfPresent(UsageConversations.self, forKey: .usage)) ?? UsageConversations(chat: false, nuit: false)
        chiffre = (try? c.decodeIfPresent(Bool.self, forKey: .chiffre)) ?? false
        cle = try? c.decodeIfPresent(Cle.self, forKey: .cle)
        imports = try? c.decodeIfPresent(Imports.self, forKey: .imports)
        total = (try? c.decodeIfPresent(Total.self, forKey: .total))
            ?? Total(conversations: sources.reduce(0) { $0 + $1.conversations }, messages: sources.reduce(0) { $0 + $1.messages })
    }

    public func source(_ id: String) -> SourceConversations? { sources.first { $0.id == id } }

    /// Ce qui ne va pas, toutes sources confondues (clé d'abord), ou nil.
    public var probleme: ProblemeSource? {
        if let e = cle?.erreur { return e }
        return sources.first { $0.actif && $0.erreur != nil }?.erreur
    }
}

public struct ProjetExterne: Codable, Equatable, Hashable, Sendable {
    public var id: String
    public var nom: String
}

public struct ConversationExterne: Codable, Equatable, Hashable, Identifiable, Sendable {
    public var source: String
    public var id: String
    public var titre: String
    public var apercu: String?
    public var assistant: String?
    public var projet: ProjetExterne?
    public var debut: Millis?
    public var fin: Millis?
    public var messages: Int

    public init(source: String, id: String, titre: String, apercu: String? = nil, assistant: String? = nil, projet: ProjetExterne? = nil,
                debut: Millis? = nil, fin: Millis? = nil, messages: Int = 0) {
        self.source = source
        self.id = id
        self.titre = titre
        self.apercu = apercu
        self.assistant = assistant
        self.projet = projet
        self.debut = debut
        self.fin = fin
        self.messages = messages
    }

    enum CodingKeys: String, CodingKey { case source, id, titre, apercu, assistant, projet, debut, fin, messages }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        source = try c.decode(String.self, forKey: .source)
        id = try c.decode(String.self, forKey: .id)
        titre = (try? c.decodeIfPresent(String.self, forKey: .titre)) ?? "Conversation"
        apercu = try? c.decodeIfPresent(String.self, forKey: .apercu)
        assistant = try? c.decodeIfPresent(String.self, forKey: .assistant)
        projet = try? c.decodeIfPresent(ProjetExterne.self, forKey: .projet)
        debut = try? c.decodeIfPresent(Millis.self, forKey: .debut)
        fin = try? c.decodeIfPresent(Millis.self, forKey: .fin)
        messages = (try? c.decodeIfPresent(Int.self, forKey: .messages)) ?? 0
    }

    /// « Claude · 14:32 · 12 messages · bougies »
    public func meta(maintenant: Date = Date()) -> String {
        var p: [String] = []
        if let a = assistant { p.append(a) }
        if let f = fin { p.append(Format.relatif(f, maintenant: maintenant)) }
        p.append(messages == 1 ? "1 message" : "\(messages) messages")
        if let n = projet?.nom { p.append(n) }
        return p.joined(separator: " · ")
    }
}

public struct PageConversations: Codable, Equatable, Sendable {
    public var conversations: [ConversationExterne]
    public var suite: Int?
    public var total: Int

    enum CodingKeys: String, CodingKey { case conversations, suite, total }
    public init(conversations: [ConversationExterne], suite: Int? = nil, total: Int? = nil) {
        self.conversations = conversations
        self.suite = suite
        self.total = total ?? conversations.count
    }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        conversations = (try? c.decodeIfPresent([ConversationExterne].self, forKey: .conversations)) ?? []
        suite = try? c.decodeIfPresent(Int.self, forKey: .suite)
        total = (try? c.decodeIfPresent(Int.self, forKey: .total)) ?? conversations.count
    }
}

public struct MessageExterne: Codable, Equatable, Identifiable, Sendable {
    public var id: Int
    /// utilisateur, colle, assistant, resume.
    public var auteur: String
    public var ts: Millis?
    public var texte: String

    public init(id: Int, auteur: String, ts: Millis? = nil, texte: String) {
        self.id = id
        self.auteur = auteur
        self.ts = ts
        self.texte = texte
    }

    public var deToi: Bool { auteur == "utilisateur" || auteur == "colle" }
}

public struct LectureConversation: Codable, Equatable, Sendable {
    public var conversation: ConversationExterne
    public var messages: [MessageExterne]
    public var suite: Int?
}

public struct ResultatRecherche: Codable, Equatable, Identifiable, Sendable {
    public var source: String
    public var conversation: String
    public var titre: String
    public var projet: ProjetExterne?
    public var message: Int
    public var auteur: String?
    public var ts: Millis?
    public var score: Int?
    public var extrait: String
    public var id: Int { message }
}

public struct JourConversations: Codable, Equatable, Identifiable, Sendable {
    public var jour: String
    public var conversations: Int
    public var id: String { jour }
}

/// Ce que la nuit a tiré des conversations d'un jour (des propositions).
public struct DigestNuit: Codable, Equatable, Sendable {
    public struct AFaire: Codable, Equatable, Identifiable, Sendable {
        public var texte: String
        public var source: String?
        public var id: String { texte }
    }
    public var jour: String
    public var creeA: Millis?
    public var sources: [String]
    public var themes: [String]
    public var decisions: [String]
    public var aFaire: [AFaire]
    public var ligne: String?

    public init(jour: String, sources: [String] = [], themes: [String] = [], decisions: [String] = [], aFaire: [AFaire] = [], ligne: String? = nil) {
        self.jour = jour
        self.sources = sources
        self.themes = themes
        self.decisions = decisions
        self.aFaire = aFaire
        self.ligne = ligne
    }

    enum CodingKeys: String, CodingKey { case jour, creeA, sources, themes, decisions, aFaire, ligne }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        jour = (try? c.decodeIfPresent(String.self, forKey: .jour)) ?? ""
        creeA = try? c.decodeIfPresent(Millis.self, forKey: .creeA)
        sources = (try? c.decodeIfPresent([String].self, forKey: .sources)) ?? []
        themes = (try? c.decodeIfPresent([String].self, forKey: .themes)) ?? []
        decisions = (try? c.decodeIfPresent([String].self, forKey: .decisions)) ?? []
        aFaire = (try? c.decodeIfPresent([AFaire].self, forKey: .aFaire)) ?? []
        ligne = try? c.decodeIfPresent(String.self, forKey: .ligne)
    }

    public var vide: Bool { themes.isEmpty && decisions.isEmpty && aFaire.isEmpty }
}

struct RetourDigest: Codable, Sendable { var digest: DigestNuit? }
struct RetourChercher: Codable, Sendable { var resultats: [ResultatRecherche] }
struct RetourJours: Codable, Sendable { var jours: [JourConversations] }
struct RetourGeste: Codable, Sendable { var message: String?; var etat: EtatConversations? }

public struct BilanImport: Codable, Equatable, Sendable {
    public var deja: Bool
    public var conversations: Int
    public var nouvelles: Int
    public var misesAJour: Int
    public var ignorees: Int
    public var masques: Int

    public init(deja: Bool = false, conversations: Int = 0, nouvelles: Int = 0, misesAJour: Int = 0, ignorees: Int = 0, masques: Int = 0) {
        self.deja = deja
        self.conversations = conversations
        self.nouvelles = nouvelles
        self.misesAJour = misesAJour
        self.ignorees = ignorees
        self.masques = masques
    }

    enum CodingKeys: String, CodingKey { case deja, conversations, nouvelles, misesAJour, ignorees, masques }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        deja = (try? c.decodeIfPresent(Bool.self, forKey: .deja)) ?? false
        conversations = (try? c.decodeIfPresent(Int.self, forKey: .conversations)) ?? 0
        nouvelles = (try? c.decodeIfPresent(Int.self, forKey: .nouvelles)) ?? 0
        misesAJour = (try? c.decodeIfPresent(Int.self, forKey: .misesAJour)) ?? 0
        ignorees = (try? c.decodeIfPresent(Int.self, forKey: .ignorees)) ?? 0
        masques = (try? c.decodeIfPresent(Int.self, forKey: .masques)) ?? 0
    }

    /// « 12 conversations importées, 3 mises à jour. » / « Déjà importé : rien de nouveau. »
    public var phrase: String {
        if deja { return "Cet export était déjà importé : rien de nouveau." }
        var p: [String] = []
        if nouvelles > 0 { p.append(nouvelles == 1 ? "1 conversation importée" : "\(nouvelles) conversations importées") }
        if misesAJour > 0 { p.append(misesAJour == 1 ? "1 mise à jour" : "\(misesAJour) mises à jour") }
        if p.isEmpty { p.append("Rien de nouveau dans cet export") }
        var s = p.joined(separator: ", ") + "."
        if masques > 0 { s += masques == 1 ? " 1 secret masqué." : " \(masques) secrets masqués." }
        return s
    }
}

struct RetourImport: Codable, Sendable { var bilan: BilanImport; var etat: EtatConversations? }
struct RetourSynchro: Codable, Sendable { var etat: EtatConversations? }

/// La ligne du matin dans GET /api/rituel.
public struct LigneConversations: Codable, Equatable, Sendable {
    public var ligne: String
    public var jour: String?
    public var sources: [String]?

    public init(ligne: String, jour: String? = nil, sources: [String]? = nil) {
        self.ligne = ligne
        self.jour = jour
        self.sources = sources
    }
}

public enum ConversationsExternes {
    public static let capacite = "conversations-externes-v1"
    public static let sources = ["claude-code", "t3", "chatgpt"]

    public static func nomSource(_ id: String) -> String {
        switch id {
        case "claude-code": return "Claude Code"
        case "t3": return "T3 Code"
        case "chatgpt": return "ChatGPT"
        default: return id
        }
    }

    public static func symbole(_ id: String) -> String {
        switch id {
        case "claude-code": return "terminal"
        case "t3": return "square.split.2x1"
        case "chatgpt": return "bubble.left.and.bubble.right"
        default: return "text.bubble"
        }
    }

    /// Qui parle : « Toi », « Toi (collé) », l'assistant, « Résumé ».
    public static func auteur(_ m: MessageExterne, assistant: String?) -> String {
        switch m.auteur {
        case "utilisateur": return "Toi"
        case "colle": return "Toi (collé)"
        case "resume": return "Résumé de Claude Code"
        default: return assistant ?? "L'assistant"
        }
    }

    /// Les conversations groupées par jour (de leur dernier message), dans l'ordre reçu.
    public static func parJour(_ liste: [ConversationExterne], maintenant: Date = Date(), calendrier: Calendar = Format.calendrier) -> [(titre: String, conversations: [ConversationExterne])] {
        var sortie: [(titre: String, conversations: [ConversationExterne])] = []
        for c in liste {
            let titre = titreJour(c.fin, maintenant: maintenant, calendrier: calendrier)
            if let i = sortie.lastIndex(where: { $0.titre == titre }), i == sortie.count - 1 {
                sortie[i].conversations.append(c)
            } else {
                sortie.append((titre, [c]))
            }
        }
        return sortie
    }

    /// « Aujourd'hui », « Hier », « Lundi 26 octobre » (l'année si ce n'est pas celle-ci).
    public static func titreJour(_ ms: Millis?, maintenant: Date = Date(), calendrier: Calendar = Format.calendrier) -> String {
        guard let ms else { return "Sans date" }
        let d = Date(timeIntervalSince1970: ms / 1000)
        if calendrier.isDate(d, inSameDayAs: maintenant) { return "Aujourd'hui" }
        if let hier = calendrier.date(byAdding: .day, value: -1, to: maintenant), calendrier.isDate(d, inSameDayAs: hier) { return "Hier" }
        return Format.jourTitre(d) + Format.anneeSiAutre(d, maintenant: maintenant)
    }

    /// Un fichier que la tour sait importer (le .zip de l'export, ou conversations.json).
    public static func importable(_ nom: String) -> Bool {
        let n = nom.lowercased()
        return n.hasSuffix(".zip") || n.hasSuffix(".json")
    }

    public static func typeFichier(_ nom: String) -> String {
        nom.lowercased().hasSuffix(".json") ? "application/json" : "application/zip"
    }
}

// MARK: - Les appels à la tour

extension ClientAPI {
    public func etatConversations() async throws -> EtatConversations {
        try await json(EtatConversations.self, "api/conversations-externes")
    }

    public func conversationsExternes(source: String? = nil, jour: String? = nil, decalage: Int = 0, limite: Int = 40) async throws -> PageConversations {
        var q = ["decalage=\(decalage)", "limite=\(limite)"]
        if let source { q.append("source=\(source)") }
        if let jour { q.append("jour=\(jour)") }
        return try await json(PageConversations.self, "api/conversations-externes/liste?" + q.joined(separator: "&"))
    }

    public func joursConversations(source: String? = nil) async throws -> [JourConversations] {
        try await json(RetourJours.self, "api/conversations-externes/jours" + (source.map { "?source=\($0)" } ?? "")).jours
    }

    public func conversationExterne(source: String, id: String, apres: Int? = nil) async throws -> LectureConversation {
        let ident = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_."))) ?? id
        return try await json(LectureConversation.self, "api/conversations-externes/conversations/\(source)/\(ident)" + (apres.map { "?apres=\($0)" } ?? ""), delai: 30)
    }

    public func chercherConversations(_ q: String, source: String? = nil) async throws -> [ResultatRecherche] {
        let mots = q.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        return try await json(RetourChercher.self, "api/conversations-externes/chercher?q=\(mots)" + (source.map { "&source=\($0)" } ?? "")).resultats
    }

    public func digestConversations(jour: String? = nil) async throws -> DigestNuit? {
        try await json(RetourDigest.self, "api/conversations-externes/nuit" + (jour.map { "?jour=\($0)" } ?? "")).digest
    }

    public func lireConversationsMaintenant(source: String? = nil) async throws -> EtatConversations? {
        var corps: [String: Any] = [:]
        if let source { corps["source"] = source }
        return try await json(RetourSynchro.self, "api/conversations-externes/synchroniser", methode: "POST", corps: corps, delai: 300).etat
    }

    public func reglerSourceConversations(_ id: String, actif: Bool) async throws -> EtatConversations {
        try await json(EtatConversations.self, "api/conversations-externes/sources/\(id)", methode: "PUT", corps: ["actif": actif])
    }

    public func effacerSourceConversations(_ id: String) async throws -> (message: String?, etat: EtatConversations?) {
        let r = try await json(RetourGeste.self, "api/conversations-externes/sources/\(id)", methode: "DELETE", delai: 120)
        return (r.message, r.etat)
    }

    public func toutEffacerConversations() async throws -> (message: String?, etat: EtatConversations?) {
        let r = try await json(RetourGeste.self, "api/conversations-externes/tout", methode: "DELETE", delai: 120)
        return (r.message, r.etat)
    }

    public func reglerUsageConversations(chat: Bool? = nil, nuit: Bool? = nil) async throws -> EtatConversations {
        var corps: [String: Any] = [:]
        if let chat { corps["chat"] = chat }
        if let nuit { corps["nuit"] = nuit }
        return try await json(EtatConversations.self, "api/conversations-externes/usage", methode: "PUT", corps: corps)
    }

    /// Envoie l'export ChatGPT (le .zip reçu par mail, ou conversations.json)
    /// depuis le disque, sans le charger en entier sur l'iPhone.
    func importerChatGPT(fichier: URL) async throws -> RetourImport {
        let d = try await envoyerFichier("api/conversations-externes/chatgpt", fichier: fichier, type: ConversationsExternes.typeFichier(fichier.lastPathComponent))
        do {
            return try JSONDecoder().decode(RetourImport.self, from: d)
        } catch {
            throw ErreurAPI.illisible
        }
    }
}

// MARK: - Le modèle de l'écran « Conversations »

@MainActor
@Observable
public final class ConversationsExternesModel {
    public private(set) var etat: EtatConversations?
    public private(set) var erreurEtat: String?
    public private(set) var liste: [ConversationExterne] = []
    public private(set) var total = 0
    public private(set) var suite: Int?
    public private(set) var chargement = false
    public private(set) var erreurListe: String?
    /// nil : toutes les sources.
    public private(set) var filtre: String?
    public private(set) var resultats: [ResultatRecherche]?
    public private(set) var recherche = ""
    public private(set) var enRecherche = false
    public private(set) var erreurRecherche: String?
    public private(set) var digest: DigestNuit?
    /// Un geste en cours (lire maintenant, interrupteur, effacer).
    public private(set) var enCours = false
    /// L'envoi d'un export ChatGPT en cours.
    public private(set) var importEnCours = false
    public private(set) var dernierImport: BilanImport?

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI
    @ObservationIgnored private var generationRecherche = 0

    public init(api: ClientAPI) {
        self.api = api
    }

    public var disponible: Bool { app?.serveur?.sait(ConversationsExternes.capacite) == true }

    /// « 3 sources · 57 conversations » ; nil tant que rien n'est lu.
    public var resume: String? {
        guard let e = etat else { return nil }
        if let p = e.probleme { return p.message }
        let n = e.total.conversations
        if n == 0 { return "Rien encore : Claude Code, T3 Code, ChatGPT." }
        return n == 1 ? "1 conversation, lue sur ta tour" : "\(Format.entier(n)) conversations, lues sur ta tour"
    }

    /// Tout relire depuis la tour : l'état, la liste, le résumé de la nuit.
    public func charger() async {
        guard disponible, !chargement else { return }
        chargement = true
        defer { chargement = false }
        async let e: Void = chargerEtat()
        async let d: Void = chargerDigest()
        _ = await (e, d)
        await chargerListe(depuisDebut: true)
    }

    func chargerEtat() async {
        do {
            etat = try await api.etatConversations()
            erreurEtat = nil
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreurEtat = (error as? LocalizedError)?.errorDescription ?? "La tour n'a pas pu dire l'état des sources."
        }
    }

    func chargerDigest() async {
        digest = (try? await api.digestConversations()) ?? digest
    }

    func chargerListe(depuisDebut: Bool) async {
        let decalage = depuisDebut ? 0 : (suite ?? liste.count)
        do {
            let p = try await api.conversationsExternes(source: filtre, decalage: decalage)
            liste = depuisDebut ? p.conversations : liste + p.conversations.filter { c in !liste.contains { $0.id == c.id && $0.source == c.source } }
            total = p.total
            suite = p.suite
            erreurListe = nil
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreurListe = (error as? LocalizedError)?.errorDescription ?? "La liste n'a pas pu être lue."
        }
    }

    /// Une source, ou toutes (nil).
    public func filtrer(_ source: String?) async {
        guard source != filtre else { return }
        filtre = source
        liste = []
        suite = nil
        if !recherche.isEmpty { await chercher(recherche) }
        await chargerListe(depuisDebut: true)
    }

    /// Plus ancien.
    public func plus() async {
        guard suite != nil, !chargement else { return }
        chargement = true
        defer { chargement = false }
        await chargerListe(depuisDebut: false)
    }

    /// Chercher (sans IA, sur la tour). Une recherche plus récente l'emporte.
    public func chercher(_ q: String) async {
        let t = q.trimmingCharacters(in: .whitespacesAndNewlines)
        recherche = t
        generationRecherche += 1
        let g = generationRecherche
        guard t.count >= 2 else {
            resultats = nil
            erreurRecherche = nil
            enRecherche = false
            return
        }
        enRecherche = true
        do {
            let r = try await api.chercherConversations(t, source: filtre)
            guard g == generationRecherche else { return }
            resultats = r
            erreurRecherche = nil
        } catch {
            guard g == generationRecherche else { return }
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e) }
            erreurRecherche = (error as? LocalizedError)?.errorDescription ?? "La recherche n'a pas abouti."
        }
        if g == generationRecherche { enRecherche = false }
    }

    /// Lire tout de suite (toutes les sources allumées, ou une seule).
    @discardableResult
    public func lireMaintenant(_ source: String? = nil) async -> Bool {
        await geste {
            let e = try await self.api.lireConversationsMaintenant(source: source)
            if let e { self.etat = e }
            await self.chargerListe(depuisDebut: true)
            // Une seule source lue : son bilan à elle, pas le total.
            if let source, let s = e?.sources.first(where: { $0.id == source }) {
                if let p = e?.cle?.erreur ?? s.erreur { return "Lu, mais : \(p.message)" }
                let nom = ConversationsExternes.nomSource(source)
                if s.conversations == 0 { return "Lu : \(s.aide?.message ?? "rien de \(nom) pour l'instant.")" }
                return "Lu : \(nom), \(Self.conversations(s.conversations))."
            }
            let n = e?.total.conversations ?? self.total
            if let p = e?.probleme { return "Lu, mais : \(p.message)" }
            return n == 0 ? "Lu : rien à montrer pour l'instant." : "Lu : \(Self.conversations(n))."
        }
    }

    static func conversations(_ n: Int) -> String {
        n == 1 ? "1 conversation" : "\(Format.entier(n)) conversations"
    }

    @discardableResult
    public func regler(_ source: String, actif: Bool) async -> Bool {
        await geste {
            self.etat = try await self.api.reglerSourceConversations(source, actif: actif)
            let nom = ConversationsExternes.nomSource(source)
            if actif {
                if let e = try? await self.api.lireConversationsMaintenant(source: source) { self.etat = e }
                await self.chargerListe(depuisDebut: true)
                return "\(nom) : lecture allumée."
            }
            return "\(nom) : lecture coupée. Ce qui est déjà lu reste ; « Effacer » le retire."
        }
    }

    @discardableResult
    public func effacer(_ source: String) async -> Bool {
        await geste {
            let r = try await self.api.effacerSourceConversations(source)
            if let e = r.etat { self.etat = e }
            self.digest = nil
            await self.chargerListe(depuisDebut: true)
            return r.message ?? "Effacé de la tour."
        }
    }

    @discardableResult
    public func toutEffacer() async -> Bool {
        await geste {
            let r = try await self.api.toutEffacerConversations()
            if let e = r.etat { self.etat = e }
            self.digest = nil
            self.liste = []
            self.total = 0
            self.suite = nil
            return r.message ?? "Tout est effacé de la tour."
        }
    }

    @discardableResult
    public func reglerUsage(chat: Bool? = nil, nuit: Bool? = nil) async -> Bool {
        await geste {
            self.etat = try await self.api.reglerUsageConversations(chat: chat, nuit: nuit)
            if let chat { return chat ? "Rémy s'en inspire de nouveau dans ses réponses (modèle local)." : "Rémy ne s'en sert plus dans ses réponses." }
            if let nuit { return nuit ? "La nuit, Rémy relira tes conversations de la veille." : "La nuit ne relit plus tes conversations." }
            return "Réglé."
        }
    }

    /// Envoie l'export ChatGPT choisi dans Fichiers.
    @discardableResult
    public func importer(_ fichier: URL) async -> Bool {
        guard !importEnCours else {
            app?.dire("Un import est déjà en cours : attends sa fin.")
            return false
        }
        guard ConversationsExternes.importable(fichier.lastPathComponent) else {
            app?.dire("Choisis le .zip reçu par mail de ChatGPT (ou le conversations.json qu'il contient).")
            return false
        }
        importEnCours = true
        defer { importEnCours = false }
        do {
            let r = try await api.importerChatGPT(fichier: fichier)
            dernierImport = r.bilan
            if let e = r.etat { etat = e }
            await chargerListe(depuisDebut: true)
            app?.dire(r.bilan.phrase)
            return true
        } catch {
            app?.signaler(error)
            return false
        }
    }

    /// « Me le rappeler » : une chose à faire tirée la nuit devient un rappel
    /// de ton carnet (sans date). C'est ton geste : rien n'est fait seul.
    @discardableResult
    public func rappeler(_ a: DigestNuit.AFaire) -> Bool {
        guard let app else { return false }
        guard let n = app.carnet.noterRappel(a.texte, quand: nil) else {
            app.dire("Le rappel n'a pas pu être noté.")
            return false
        }
        app.dire(n.dejaLa ? "Déjà dans tes rappels : « \(n.rappel.texte) »." : "Noté dans tes rappels : « \(a.texte) ».")
        return true
    }

    private func geste(_ f: @escaping () async throws -> String) async -> Bool {
        guard !enCours else {
            app?.dire("Un geste est déjà en cours sur la tour : réessaie dans un instant.")
            return false
        }
        enCours = true
        defer { enCours = false }
        do {
            let phrase = try await f()
            app?.dire(phrase)
            return true
        } catch {
            app?.signaler(error)
            return false
        }
    }

    /// Captures de la CI et tests.
    public func montrerPourCapture(etat: EtatConversations, liste: [ConversationExterne], digest: DigestNuit? = nil) {
        self.etat = etat
        self.liste = liste
        self.total = liste.count
        self.digest = digest
    }
}
