import Foundation

// Les données telles que le serveur les rend (mêmes noms de champs que l'API
// web : on ne traduit pas, on décode). Presque tout est optionnel : une réponse
// incomplète doit s'afficher partiellement, jamais faire planter l'écran.

/// Horodatage en millisecondes depuis 1970, comme côté serveur.
public typealias Millis = Double

public extension Millis {
    var date: Date { Date(timeIntervalSince1970: self / 1000) }
}

public extension Date {
    var millis: Millis { timeIntervalSince1970 * 1000 }
}

// MARK: - Conversations

public struct ConversationResume: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public var title: String
    public var updatedAt: Millis?
    public var pinned: Bool?
    public var origine: Origine?

    public init(id: String, title: String, updatedAt: Millis? = nil, pinned: Bool? = nil, origine: Origine? = nil) {
        self.id = id
        self.title = title
        self.updatedAt = updatedAt
        self.pinned = pinned
        self.origine = origine
    }
}

public struct Origine: Codable, Equatable, Sendable {
    public var source: String
    public var at: Millis?

    /// « ChatGPT », « Claude » — le nom que Sam reconnaît.
    public var nom: String {
        switch source {
        case "chatgpt": return "ChatGPT"
        case "claude": return "Claude"
        default: return source
        }
    }
}

public struct Conversation: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public var title: String
    public var messages: [Message]
    public var session: String?
    public var origine: Origine?
    public var pinned: Bool?
    public var updatedAt: Millis?
}

public struct Message: Codable, Equatable, Sendable {
    public var role: String
    public var content: String
    public var model: String?
    public var tier: String?
    public var usd: Double?
    public var proposal: Proposition?
    /// Rémy demande l'accord de Sam avant une recherche web (V8).
    public var autorisation: Autorisation?

    public init(role: String, content: String, model: String? = nil, tier: String? = nil, usd: Double? = nil,
                proposal: Proposition? = nil, autorisation: Autorisation? = nil) {
        self.role = role
        self.content = content
        self.model = model
        self.tier = tier
        self.usd = usd
        self.proposal = proposal
        self.autorisation = autorisation
    }

    public var estDeToi: Bool { role == "user" }
}

// MARK: - Autorisations (V8) : rien ne part chez Claude sans l'accord de Sam

/// Une recherche web passe par Claude (Anthropic) : Rémy demande d'abord, en
/// disant ce qui partirait. Seule la dernière demande d'un fil reste valable.
public struct Autorisation: Codable, Equatable, Sendable {
    public var id: String
    public var type: String?
    /// en_attente | acceptee | refusee | expiree
    public var statut: String
    /// Vrai : la conversation et la mémoire partiraient avec la question
    /// (réglage « Envoi de contexte au cloud »). Sinon, la question seule.
    public var contexte: Bool?
    public var requete: String?
    /// Position du message dans le fil (événement en flux seulement).
    public var index: Int?

    public init(id: String, type: String? = "web", statut: String, contexte: Bool? = false, requete: String? = nil, index: Int? = nil) {
        self.id = id
        self.type = type
        self.statut = statut
        self.contexte = contexte
        self.requete = requete
        self.index = index
    }

    public var enAttente: Bool { statut == "en_attente" }

    /// Ce qui partirait chez Anthropic, dit en clair sur la carte.
    public var partira: String {
        contexte == true
            ? "ta question, la conversation et ta mémoire"
            : "ta question seulement — ni la conversation, ni ta mémoire, ni ton planning"
    }

    public var titre: String {
        switch statut {
        case "en_attente": return "Recherche web · via Claude (Anthropic)"
        case "acceptee": return "Recherche autorisée"
        case "refusee": return "Sans le web, à ta demande"
        default: return "Demande expirée"
        }
    }
}

// MARK: - Propositions (Motion / Agenda) : Rémy propose, Sam valide

public struct Proposition: Codable, Equatable, Sendable {
    /// Identifiant stable donné par le serveur (Lot 0) : clé d'idempotence de
    /// « Oui, fais-le » et adresse de « Non merci ». Absent sur un ancien serveur.
    public var id: String?
    public var source: String?
    public var resume: String?
    public var actions: [ActionProposee]
    public var statut: String?
    public var ledgerId: String?
    public var index: Int?
    /// Ce qui a vraiment été fait, rendu par le serveur après application.
    public var bilan: Bilan?
    /// État local : annulée depuis l'app (ou constatée annulée dans le journal).
    public var annulee: Bool?
    /// État local : ce que « Annuler » n'a pas pu défaire.
    public var annulationRatee: [Echec]?

    public init(id: String? = nil, source: String?, resume: String?, actions: [ActionProposee], statut: String? = nil,
                ledgerId: String? = nil, index: Int? = nil, bilan: Bilan? = nil, annulee: Bool? = nil) {
        self.id = id
        self.source = source
        self.resume = resume
        self.actions = actions
        self.statut = statut
        self.ledgerId = ledgerId
        self.index = index
        self.bilan = bilan
        self.annulee = annulee
    }

    public var appliquee: Bool { statut == "applique" }
    /// « Non merci » enregistré : la carte ne revient pas.
    public var refusee: Bool { statut == "refuse" }
    /// Rien n'a pu être écrit : la carte reste, avec la raison, et peut être retentée.
    public var echouee: Bool { statut == "echec" }
    public var versAgenda: Bool { source == "agenda" }

    /// La raison d'un échec complet, telle que le serveur l'a rangée.
    public var raisonEchec: String? { bilan?.echoues?.compactMap(\.erreur).first }

    /// Nombre d'actions ratées d'après le bilan (0 si inconnu).
    public var nombreEchecs: Int { bilan?.echoues?.count ?? 0 }

    /// L'erreur d'une action précise, retrouvée par son nom dans le bilan.
    public func erreur(pour a: ActionProposee) -> String? {
        bilan?.echoues?.first { $0.nom == a.libelle || $0.nom == a.nom || $0.nom == a.titre }?.erreur
    }

    /// Ce qui n'a pas pu être défait pour cette action, s'il y a lieu.
    public func echecAnnulation(pour a: ActionProposee) -> Echec? {
        annulationRatee?.first { $0.nom == a.libelle || $0.nom == a.nom || $0.nom == a.titre }
    }
}

public struct Bilan: Codable, Equatable, Sendable {
    public var faits: [String]?
    public var echoues: [Echec]?
    public var espace: String?

    public init(faits: [String]? = nil, echoues: [Echec]? = nil, espace: String? = nil) {
        self.faits = faits
        self.echoues = echoues
        self.espace = espace
    }
}

public struct Echec: Codable, Equatable, Sendable {
    public var nom: String?
    public var erreur: String?

    public init(nom: String?, erreur: String?) {
        self.nom = nom
        self.erreur = erreur
    }
}

public struct ActionProposee: Codable, Equatable, Sendable {
    public var type: String?
    public var nom: String?
    public var nouveau_nom: String?
    public var titre: String?
    public var nouveau_titre: String?
    public var echeance: String?
    public var debut: String?
    public var fin: String?
    public var lieu: String?
    public var duree: ValeurSouple?
    public var priorite: String?
    public var id: String?
    /// Les notes que Rémy joint à la tâche : renvoyées telles quelles à l'application.
    public var description: String?

    public init(type: String? = nil, nom: String? = nil, nouveau_nom: String? = nil, titre: String? = nil,
                nouveau_titre: String? = nil, echeance: String? = nil, debut: String? = nil, fin: String? = nil,
                lieu: String? = nil, duree: ValeurSouple? = nil, priorite: String? = nil, id: String? = nil,
                description: String? = nil) {
        self.type = type
        self.nom = nom
        self.nouveau_nom = nouveau_nom
        self.titre = titre
        self.nouveau_titre = nouveau_titre
        self.echeance = echeance
        self.debut = debut
        self.fin = fin
        self.lieu = lieu
        self.duree = duree
        self.priorite = priorite
        self.id = id
        self.description = description
    }

    /// Le verbe affiché : liste blanche stricte. `type` vient du modèle, qui peut
    /// être influencé par une page web hostile — jamais affiché brut.
    public var verbe: String {
        switch type {
        case "creer": return "creer"
        case "terminer": return "terminer"
        case "supprimer": return "supprimer"
        default: return "modifier"
        }
    }

    public var libelle: String {
        nouveau_nom ?? nom ?? nouveau_titre ?? titre ?? "(sans nom)"
    }
}

/// Une valeur que le modèle rend tantôt en nombre, tantôt en texte (« 30 »,
/// 30, « REMINDER »). On la garde telle quelle, sous forme lisible.
public enum ValeurSouple: Codable, Equatable, Sendable {
    case nombre(Double)
    case texte(String)

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Double.self) { self = .nombre(n) }
        else { self = .texte((try? c.decode(String.self)) ?? "") }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .nombre(let n): try c.encode(n)
        case .texte(let t): try c.encode(t)
        }
    }

    public var texte: String {
        switch self {
        case .nombre(let n): return n == n.rounded() ? String(Int(n)) : String(n)
        case .texte(let t): return t
        }
    }
}

public struct ResultatApplication: Codable, Sendable {
    public var ledgerId: String?
    public var echecs: Int?
    public var results: [ResultatAction]?
    /// appliquee | appliquee_partiellement | echouee (serveur Lot 0).
    public var etat: String?
    /// Vrai quand la même demande avait déjà été faite (réseau coupé, double tap).
    public var rejoue: Bool?

    /// Le statut de la carte après application, dans le vocabulaire de la conversation.
    public var statut: String { etat == "echouee" ? "echec" : "applique" }

    /// Le bilan au même format que celui que le serveur range dans la conversation.
    public var bilan: Bilan {
        let r = results ?? []
        return Bilan(
            faits: r.filter { $0.ok == true }.compactMap { $0.nom ?? $0.titre },
            echoues: r.filter { $0.ok != true }.map { Echec(nom: $0.nom ?? $0.titre, erreur: $0.erreur) },
            espace: r.first { $0.ok == true && $0.espace != nil }?.espace
        )
    }
}

public struct ResultatAction: Codable, Sendable {
    public var ok: Bool?
    public var espace: String?
    public var nom: String?
    public var titre: String?
    public var erreur: String?
}

/// Réponse de /api/motion/undo et /api/google/undo.
public struct RetourAnnulation: Codable, Sendable {
    public var ok: Bool?
    public var undone: [ResultatAction]?
    /// Vrai quand le serveur répond « Déjà annulé » (409) : c'est un succès.
    public var dejaAnnule: Bool?

    public init(ok: Bool? = nil, undone: [ResultatAction]? = nil, dejaAnnule: Bool? = nil) {
        self.ok = ok
        self.undone = undone
        self.dejaAnnule = dejaAnnule
    }

    /// La première action qui n'a pas pu être défaite, s'il y en a une.
    public var premierEchec: ResultatAction? { undone?.first { $0.ok == false } }
}

/// Une entrée du journal des changements (/api/motion/ledger, commun à Motion et à l'agenda).
public struct EntreeJournal: Codable, Sendable {
    public var id: String
    public var annule: Bool?
}

struct Journal: Codable, Sendable {
    var entries: [EntreeJournal]?
}

// MARK: - Tableau de bord

public struct TableauDeBord: Codable, Sendable, Equatable {
    public var maintenant: Millis?
    public var briefing: Briefing?
    public var journee: Journee?
    public var activite: Activite?
    public var setup: EtatOnboarding?
    public var memoire: ResumeMemoire?
    public var couts: ResumeCouts?
    public var systeme: Systeme?
}

public struct Briefing: Codable, Sendable, Equatable {
    public var text: String?
    public var generatedAt: Millis?
    public var items: [Sujet]?
}

public struct Sujet: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public var texte: String
    public var etat: String

    public init(id: String, texte: String, etat: String) {
        self.id = id
        self.texte = texte
        self.etat = etat
    }
}

public struct Journee: Codable, Sendable, Equatable {
    public var jour: String?
    public var minute: Int?
    public var items: [ElementJour]?
    public var toute: [ElementJourneeEntiere]?
    public var aFaire: [TacheResume]?
    public var retard: Retard?
    public var sources: Sources?
}

public struct ElementJour: Codable, Sendable, Equatable, Identifiable {
    public var type: String
    public var id: String
    public var titre: String
    public var lieu: String?
    public var projet: String?
    public var priorite: String?
    public var debut: Millis
    public var fin: Millis?
    public var retard: Bool?

    public var estRendezVous: Bool { type == "rdv" }
    public var finEffective: Millis { fin ?? debut + 30 * 60_000 }

    public init(type: String, id: String, titre: String, lieu: String? = nil, projet: String? = nil,
                priorite: String? = nil, debut: Millis, fin: Millis? = nil, retard: Bool? = nil) {
        self.type = type
        self.id = id
        self.titre = titre
        self.lieu = lieu
        self.projet = projet
        self.priorite = priorite
        self.debut = debut
        self.fin = fin
        self.retard = retard
    }
}

public struct ElementJourneeEntiere: Codable, Sendable, Equatable {
    public var id: String?
    public var titre: String
    public var lieu: String?
}

public struct TacheResume: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var titre: String
    public var echeance: Millis?
    public var projet: String?
    public var priorite: String?
}

public struct Retard: Codable, Sendable, Equatable {
    public var total: Int
    public var items: [TacheResume]
}

public struct Sources: Codable, Sendable, Equatable {
    public var motion: String?
    public var agenda: String?

    public init(motion: String? = nil, agenda: String? = nil) {
        self.motion = motion
        self.agenda = agenda
    }

    /// Rien de branché du tout (ni Motion, ni l'agenda) — pas une panne.
    public var aucune: Bool {
        motion != "ok" && agenda != "ok" && motion != "erreur" && agenda != "erreur"
    }

    /// Branché, mais rien ne répond en ce moment.
    public var enPanne: Bool {
        motion != "ok" && agenda != "ok" && (motion == "erreur" || agenda == "erreur")
    }
}

public struct Activite: Codable, Sendable, Equatable {
    public var jours: [JourActivite]
    public var aujourdhui: JourActivite?
    public var serie: Int?
    public var joursActifs: Int?
    public var minutesTotal: Int?
    public var messagesTotal: Int?
}

public struct JourActivite: Codable, Sendable, Equatable, Identifiable {
    public var jour: String
    public var minutes: Int
    public var messages: Int
    public var actif: Bool?
    public var plages: [Plage]?
    public var id: String { jour }
}

public struct Plage: Codable, Sendable, Equatable {
    public var debut: String
    public var fin: String
}

public struct EtatOnboarding: Codable, Sendable, Equatable {
    public var etats: [String: String]?
    public var convs: [String: String]?
    public var couverture: [String: [String]]?
    public var sessions: [SessionOnboarding]?
    public var updatedAt: Millis?
}

public struct SessionOnboarding: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var desc: String?
    public var prompt: String?
    public var reperes: [Repere]?
}

public struct Repere: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var label: String
}

public struct ResumeMemoire: Codable, Sendable, Equatable {
    public var mots: Int
    public var sections: Int
    public var totalSections: Int
    public var updatedAt: Millis?
}

public struct ResumeCouts: Codable, Sendable, Equatable {
    public var aujourdhui: Double
    public var jours7: Double
    public var jours30: Double
    public var appelsAujourdhui: Int?
}

public struct Systeme: Codable, Sendable, Equatable {
    public var motion: Bool?
    public var agenda: Bool?
    public var transcription: Bool?
    public var reflexion: Bool?
}

// MARK: - Divers

public struct Memoire: Codable, Sendable, Equatable {
    public var text: String
    public var updatedAt: Millis?
}

public struct RetourCapture: Codable, Sendable {
    public var ajouts: [String]?
    public var memoire: Bool?
    /// Dit pourquoi la mémoire n'a pas bougé (ex. « Mémoire pleine »).
    public var message: String?
}

// MARK: - Version et réglages (Lot 0)

/// Ce que dit /api/version : la tour et l'app se mettent à jour séparément,
/// l'app sait ainsi à quel serveur elle parle et ce qu'il sait faire.
public struct VersionServeur: Codable, Sendable, Equatable {
    public var api: Int
    public var serveur: String
    public var commit: String?
    public var appMin: Int?
    public var capacites: [String]?

    public init(api: Int, serveur: String, commit: String? = nil, appMin: Int? = nil, capacites: [String]? = nil) {
        self.api = api
        self.serveur = serveur
        self.commit = commit
        self.appMin = appMin
        self.capacites = capacites
    }

    public func sait(_ capacite: String) -> Bool { capacites?.contains(capacite) ?? false }

    /// « 0.2.0 · abc1234 »
    public var libelle: String { commit.map { "\(serveur) · \($0)" } ?? serveur }
}

/// Réglages de Sam gardés sur la tour (GET/PUT /api/reglages).
public struct Reglages: Codable, Sendable, Equatable {
    /// Secours Claude effectif (D21) : si GLM tombe, Claude répond à sa place.
    public var secoursCloud: Bool
    /// Posé sur la tour (REMY_SECOURS_CLOUD=on) : l'app ne peut pas le couper.
    public var secoursCloudForceParLaTour: Bool?
    /// Pas de GLM : Claude est le cerveau, le réglage ne change rien.
    public var secoursCloudSansObjet: Bool?
    /// Ce que Rémy fait sans qu'on le lui demande, circuit par circuit (Lot 0).
    public var circuits: [String: Circuit]?
    /// Recherche web permise (V8) — chaque recherche demande quand même l'accord.
    public var rechercheWeb: Bool?
    /// Coupée sur la tour (REMY_WEB_SEARCH=off) : l'app ne peut pas la rallumer.
    public var rechercheWebCoupeeParLaTour: Bool?
    /// La conversation et la mémoire partent avec une recherche autorisée.
    public var contexteCloud: Bool?
}

/// Un circuit de travail de fond (nuit, synthèses…) : allumé ou coupé par Sam.
public struct Circuit: Codable, Sendable, Equatable {
    public var nom: String
    public var actif: Bool
    /// Forcé sur la tour (REMY_CIRCUIT_…) : l'app ne peut pas le changer.
    public var forceParLaTour: Bool?
}
