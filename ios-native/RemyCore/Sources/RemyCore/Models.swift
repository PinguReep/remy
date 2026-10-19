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
    /// Nombre de messages et qui a parlé en dernier (« non lus », tour du 18/10).
    public var messages: Int?
    public var dernier: String?

    public init(id: String, title: String, updatedAt: Millis? = nil, pinned: Bool? = nil, origine: Origine? = nil,
                messages: Int? = nil, dernier: String? = nil) {
        self.id = id
        self.title = title
        self.updatedAt = updatedAt
        self.pinned = pinned
        self.origine = origine
        self.messages = messages
        self.dernier = dernier
    }
}

/// Où ranger un fil dans l'historique (Sam, 18/10) : aujourd'hui, les sept
/// derniers jours, avant.
public enum PeriodeFil: String, CaseIterable, Sendable {
    case epingles = "Épinglées"
    case aujourdhui = "Aujourd'hui"
    case semaine = "7 derniers jours"
    case avant = "Plus ancien"

    public static func de(_ c: ConversationResume, maintenant: Date = Date()) -> PeriodeFil {
        if c.pinned == true { return .epingles }
        guard let m = c.updatedAt else { return .avant }
        let debut = Format.debutDuJour(maintenant)
        if m >= debut.millis { return .aujourdhui }
        let semaine = Format.calendrier.date(byAdding: .day, value: -6, to: debut) ?? debut
        return m >= semaine.millis ? .semaine : .avant
    }
}

/// Une info que Rémy propose de retenir d'un long texte (à cocher).
public struct InfoProposee: Codable, Sendable, Equatable, Identifiable, Hashable {
    public var texte: String
    public var section: String?
    public var id: String { texte }
    public init(texte: String, section: String? = nil) {
        self.texte = texte
        self.section = section
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
    /// Le début du fil résumé pour le modèle (compactage-v1) ; rien d'effacé.
    public var compactage: Compactage?
}

/// Une conversation compactée (19/10) : les messages avant `jusqua` arrivent
/// au modèle sous forme de résumé ; ils restent tous dans le fil.
public struct Compactage: Codable, Equatable, Sendable {
    public var jusqua: Int
    public var a: Millis?
    public var resume: String?
    public var modele: String?

    public init(jusqua: Int, a: Millis? = nil, resume: String? = nil, modele: String? = nil) {
        self.jusqua = jusqua
        self.a = a
        self.resume = resume
        self.modele = modele
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        jusqua = (try? c.decodeIfPresent(Int.self, forKey: .jusqua)) ?? 0
        a = try? c.decodeIfPresent(Millis.self, forKey: .a)
        resume = try? c.decodeIfPresent(String.self, forKey: .resume)
        modele = try? c.decodeIfPresent(String.self, forKey: .modele)
    }
}

/// Une règle de Rémy (regles-v1, 19/10) : « avant une sortie, me raser ».
public struct RegleRemy: Decodable, Identifiable, Equatable, Sendable {
    public struct Tache: Decodable, Equatable, Sendable {
        public var nom: String
        public var duree: Int?
        public var priorite: String?
    }
    public var id: String
    public var nom: String
    public var mots: [String]
    public var tache: Tache
    public var avantMin: Int
    public var actif: Bool

    /// « au plus tard 3 h avant », « au plus tard la veille »
    public var delai: String {
        if avantMin <= 0 { return "avant l'événement" }
        if avantMin % 1440 == 0 { return avantMin == 1440 ? "au plus tard la veille" : "au plus tard \(avantMin / 1440) jours avant" }
        if avantMin % 60 == 0 { return "au plus tard \(avantMin / 60) h avant" }
        return "au plus tard \(avantMin) min avant"
    }
}

public struct ListeRegles: Decodable, Sendable { public var regles: [RegleRemy] }

/// Ce que rend une vérification des règles (compteurs).
public struct BilanRegles: Decodable, Sendable {
    public var regles: Int
    public var evenements: Int?
    public var proposees: Int
    public var deja: Int?
}

/// Ce que rend POST /api/conversations/:id/compacter.
public struct RetourCompactage: Decodable, Sendable {
    public var compacte: Bool
    public var raison: String?
    public var resumes: Int?
    public var compactage: Compactage?
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
    /// Débit et contexte de la réponse (jauge-v1) ; absent avant le 19/10.
    public var mesures: MesuresReponse?

    public init(role: String, content: String, model: String? = nil, tier: String? = nil, usd: Double? = nil,
                proposal: Proposition? = nil, autorisation: Autorisation? = nil, mesures: MesuresReponse? = nil) {
        self.role = role
        self.content = content
        self.model = model
        self.tier = tier
        self.usd = usd
        self.proposal = proposal
        self.autorisation = autorisation
        self.mesures = mesures
    }

    public var estDeToi: Bool { role == "user" }
}

/// Ce que la tour a mesuré sur une réponse (jauge du chat, 19/10) : des
/// compteurs, jamais de contenu. Chaque champ peut manquer (modèle muet,
/// réponse de Claude) : l'app dit alors qu'elle ne sait pas.
public struct MesuresReponse: Codable, Equatable, Sendable {
    /// Jetons écrits par le modèle, réflexion comprise.
    public var jetons: Int?
    /// Jetons par seconde pendant l'écriture (ni lecture du contexte, ni outils).
    public var tps: Double?
    public var decodeMs: Int?
    /// Du départ de la requête au premier jeton.
    public var premierMs: Int?
    /// Vrai : jetons estimés d'après les caractères (le modèle n'a pas compté).
    public var estime: Bool?
    /// Place prise dans le contexte du modèle au dernier appel.
    public var contexte: Int?
    public var repartition: RepartitionContexte?
    /// Taille maximale du contexte, si la tour la connaît.
    public var fenetre: Int?
    /// « modele » (déclarée par le serveur du modèle) ou « reglage » (tour).
    public var fenetreSource: String?
    /// Le modèle qui a écrit la réponse, et la machine qui le sert.
    public var modele: String?
    public var machine: String?

    public init(jetons: Int? = nil, tps: Double? = nil, decodeMs: Int? = nil, premierMs: Int? = nil, estime: Bool? = nil,
                contexte: Int? = nil, repartition: RepartitionContexte? = nil, fenetre: Int? = nil, fenetreSource: String? = nil,
                modele: String? = nil, machine: String? = nil) {
        self.jetons = jetons
        self.tps = tps
        self.decodeMs = decodeMs
        self.premierMs = premierMs
        self.estime = estime
        self.contexte = contexte
        self.repartition = repartition
        self.fenetre = fenetre
        self.fenetreSource = fenetreSource
        self.modele = modele
        self.machine = machine
    }

    // Tolérant champ par champ : une mesure mal formée ne doit jamais empêcher
    // d'ouvrir la conversation qui la porte.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        jetons = try? c.decodeIfPresent(Int.self, forKey: .jetons)
        tps = try? c.decodeIfPresent(Double.self, forKey: .tps)
        decodeMs = try? c.decodeIfPresent(Int.self, forKey: .decodeMs)
        premierMs = try? c.decodeIfPresent(Int.self, forKey: .premierMs)
        estime = try? c.decodeIfPresent(Bool.self, forKey: .estime)
        contexte = try? c.decodeIfPresent(Int.self, forKey: .contexte)
        repartition = try? c.decodeIfPresent(RepartitionContexte.self, forKey: .repartition)
        fenetre = try? c.decodeIfPresent(Int.self, forKey: .fenetre)
        fenetreSource = try? c.decodeIfPresent(String.self, forKey: .fenetreSource)
        modele = try? c.decodeIfPresent(String.self, forKey: .modele)
        machine = try? c.decodeIfPresent(String.self, forKey: .machine)
    }
}

/// D'où vient la place prise (≈, selon la part de caractères de chaque bloc).
public struct RepartitionContexte: Codable, Equatable, Sendable {
    /// Consigne de Rémy : sa mémoire, ton planning, ton agenda.
    public var systeme: Int
    public var conversation: Int
    /// Résultats d'outils lus pendant la réponse (Motion, pages…).
    public var outils: Int
    public var reponse: Int

    public init(systeme: Int, conversation: Int, outils: Int, reponse: Int) {
        self.systeme = systeme
        self.conversation = conversation
        self.outils = outils
        self.reponse = reponse
    }
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
    /// Ajustée par Sam avant de dire oui (date, durée, catégorie…) : ces
    /// actions-là partiront (18/10).
    public var ajustee: Bool?
    /// Ce que Rémy avait proposé, avant ajustement (la tour l'envoie).
    public var actionsOrigine: [ActionProposee]?

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
    /// Tout a été rangé en rappels : plus rien à envoyer à Motion.
    public var convertie: Bool { statut == "converti" }
    /// Encore modifiable : ni appliquée, ni refusée, ni rangée.
    public var ajustable: Bool { !appliquee && !refusee && !convertie }
    /// Combien de lignes Sam a rangées en rappels (elles ont quitté la proposition).
    public var rangeesEnRappels: Int { max(0, (actionsOrigine?.count ?? actions.count) - actions.count) }
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
    /// Sa place dans la proposition d'origine (une proposition ajustée la garde).
    public var rang: Int?
    /// Catégories (identifiants d'étiquettes) que la tâche gardera, créée.
    public var etiquettes: [String]?

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
    /// Le conseil « maintenant » réfléchi par GLM sur la tour (conseil-v1).
    public var conseil: ConseilTour?
    /// Les parties illisibles laissées de côté (« activite », « journee.items (1) ») :
    /// l'écran s'affiche sans elles et le dit. Jamais envoyé ni gardé.
    public var illisibles: [String] = []

    enum CodingKeys: String, CodingKey {
        case maintenant, briefing, journee, activite, setup, memoire, couts, systeme, conseil
    }

    /// Toutes les parties illisibles, y compris dans la journée et les sujets.
    public var partiesIllisibles: [String] {
        illisibles
            + (journee?.illisibles ?? []).map { "journee." + $0 }
            + (briefing?.illisibles ?? []).map { "briefing." + $0 }
    }
}

// Décodage tolérant (J1.2, défaut n°18) : une section illisible devient nil,
// un élément illisible est sauté. On perd une ligne, jamais tout l'écran.
extension TableauDeBord {
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var i: [String] = []
        maintenant = c.souple(Millis.self, .maintenant, &i)
        briefing = c.souple(Briefing.self, .briefing, &i)
        journee = c.souple(Journee.self, .journee, &i)
        activite = c.souple(Activite.self, .activite, &i)
        setup = c.souple(EtatOnboarding.self, .setup, &i)
        memoire = c.souple(ResumeMemoire.self, .memoire, &i)
        couts = c.souple(ResumeCouts.self, .couts, &i)
        systeme = c.souple(Systeme.self, .systeme, &i)
        conseil = c.souple(ConseilTour.self, .conseil, &i)
        illisibles = i
    }
}

/// GET /api/conseil : le dernier conseil gardé par la tour pour ce type, s'il
/// correspond encore à la situation (`aJour`), et si un calcul tourne.
public struct ConseilTour: Codable, Sendable, Equatable {
    public struct Texte: Codable, Sendable, Equatable {
        public var texte: String
        public var pourquoi: [String]?
        public var tache: String?
        public var genereA: Millis?
        public var source: String?
    }
    public var type: String?
    public var conseil: Texte?
    public var aJour: Bool?
    public var enCours: Bool?
    public var disponible: Bool?
    public var raison: String?
}

public struct Briefing: Codable, Sendable, Equatable {
    public var text: String?
    public var generatedAt: Millis?
    public var items: [Sujet]?
    public var illisibles: [String] = []

    enum CodingKeys: String, CodingKey { case text, generatedAt, items }
}

extension Briefing {
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var i: [String] = []
        text = c.souple(String.self, .text, &i)
        generatedAt = c.souple(Millis.self, .generatedAt, &i)
        items = c.listeSouple(Sujet.self, .items, &i)
        illisibles = i
    }
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
    /// Fraîcheur des tâches Motion, dite par la tour (Lot 1, motion-etat-v1).
    public var motion: EtatMotion?
    public var illisibles: [String] = []

    enum CodingKeys: String, CodingKey { case jour, minute, items, toute, aFaire, retard, sources, motion }
}

/// « Tâches d'il y a 4 min : Motion limite les requêtes ». L'état vient de la
/// tour, qui seule sait si c'est le quota, une panne ou une mise à jour.
public struct EtatMotion: Codable, Sendable, Equatable {
    /// ok, maj, quota, menage, panne, reseau, auth, attente, off
    public var etat: String
    public var luA: Millis?
    public var raison: String?
    public var quota: Quota?

    public struct Quota: Codable, Sendable, Equatable {
        public var utilise: Int
        public var max: Int
    }

    public init(etat: String, luA: Millis? = nil, raison: String? = nil) {
        self.etat = etat
        self.luA = luA
        self.raison = raison
    }

    /// Ce que l'accueil dit (nil : rien à dire). Une liste de moins de 3 min
    /// sans souci ne mérite pas de bandeau.
    public func phrase(maintenant: Millis) -> String? {
        let age = luA.map { max(0, Int((maintenant - $0) / 60_000)) }
        let depuis = age.map { $0 < 1 ? "à l'instant" : "il y a \(Format.duree(minutes: $0))" }
        let liste = depuis.map { "Tâches Motion lues \($0)" }
        switch etat {
        case "auth":
            return "Motion refuse la clé de la tour : vérifie MOTION_API_KEY dans remy.env."
        case "quota":
            return (liste.map { $0 + " : " } ?? "") + "Motion limite les requêtes, mise à jour dès que possible."
        case "menage":
            guard let a = age, a >= 3 else { return nil }
            return (liste ?? "Tâches Motion") + " : Rémy garde le quota Motion pour tes gestes, mise à jour dans un instant."
        case "panne":
            return (liste.map { $0 + " : " } ?? "") + "Motion ne répond pas pour l'instant."
        case "reseau":
            return (liste.map { $0 + " : " } ?? "") + "la tour ne joint pas Motion (réseau)."
        case "attente":
            return "Première lecture de Motion en cours…"
        case "ok", "maj":
            guard let a = age, a >= 10, let l = liste else { return nil }
            return l + (etat == "maj" ? ", mise à jour en cours." : ".")
        default:
            return nil
        }
    }
}

extension Journee {
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var i: [String] = []
        jour = c.souple(String.self, .jour, &i)
        minute = c.souple(Int.self, .minute, &i)
        items = c.listeSouple(ElementJour.self, .items, &i)
        toute = c.listeSouple(ElementJourneeEntiere.self, .toute, &i)
        aFaire = c.listeSouple(TacheResume.self, .aFaire, &i)
        retard = c.souple(Retard.self, .retard, &i)
        sources = c.souple(Sources.self, .sources, &i)
        motion = c.souple(EtatMotion.self, .motion, &i)
        illisibles = i
    }
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
    /// La durée que Motion attribue à la tâche, en minutes (absente : rendez-vous,
    /// ou tour d'avant le Lot 1).
    public var duree: Int?
    public var echeance: Millis?
    /// Bloquée (état gardé par Remy, D12), et pourquoi.
    public var bloquee: Bool?
    public var raison: String?
    /// Rendez-vous avec d'autres personnes (invités, organisé par un autre) :
    /// rien ne s'y modifie d'un geste. Sinon, une activité à soi (« Aspirateur »).
    public var avecAutres: Bool?
    /// Commencée depuis l'app (« commencer maintenant », gardé par Remy).
    public var commencee: Bool?
    /// Activité de l'agenda marquée faite (gardé par Remy, l'agenda ne change pas).
    public var fait: Bool?
    /// Catégories de la tâche (Voiture, Santé…), gardées par Remy (18/10).
    public var etiquettes: [String]?

    public var estRendezVous: Bool { type == "rdv" }
    /// Une activité à soi, à heure fixe dans l'agenda (pas un vrai rendez-vous).
    public var estActivite: Bool { type == "rdv" && avecAutres != true }
    public var finEffective: Millis { fin ?? debut + 30 * 60_000 }
    /// La référence de « 50 min restantes sur 1 h 15 » : la durée Motion, à
    /// défaut celle du créneau.
    public var dureeTotale: Int { duree ?? max(1, Int(((finEffective - debut) / 60_000).rounded())) }

    public init(type: String, id: String, titre: String, lieu: String? = nil, projet: String? = nil,
                priorite: String? = nil, debut: Millis, fin: Millis? = nil, retard: Bool? = nil,
                duree: Int? = nil, echeance: Millis? = nil, avecAutres: Bool? = nil) {
        self.avecAutres = avecAutres
        self.type = type
        self.id = id
        self.titre = titre
        self.lieu = lieu
        self.projet = projet
        self.priorite = priorite
        self.debut = debut
        self.fin = fin
        self.retard = retard
        self.duree = duree
        self.echeance = echeance
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
    public var bloquee: Bool?
    public var raison: String?
    /// Durée Motion (minutes), pour « commencer maintenant ».
    public var duree: Int?
    /// Catégories de la tâche (Voiture, Santé…), gardées par Remy (18/10).
    public var etiquettes: [String]?

    public init(id: String, titre: String, echeance: Millis? = nil, projet: String? = nil, priorite: String? = nil,
                bloquee: Bool? = nil, raison: String? = nil, duree: Int? = nil) {
        self.id = id
        self.titre = titre
        self.echeance = echeance
        self.projet = projet
        self.priorite = priorite
        self.bloquee = bloquee
        self.raison = raison
        self.duree = duree
    }
}

public struct Retard: Codable, Sendable, Equatable {
    public var total: Int
    public var items: [TacheResume]

    enum CodingKeys: String, CodingKey { case total, items }
}

extension Retard {
    /// Une tâche en retard illisible est sautée ; le total reste celui du serveur.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var i: [String] = []
        items = c.listeSouple(TacheResume.self, .items, &i) ?? []
        total = c.souple(Int.self, .total, &i) ?? items.count
        _ = i
    }
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

    enum CodingKeys: String, CodingKey { case jours, aujourdhui, serie, joursActifs, minutesTotal, messagesTotal }
}

extension Activite {
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var i: [String] = []
        jours = c.listeSouple(JourActivite.self, .jours, &i) ?? []
        aujourdhui = c.souple(JourActivite.self, .aujourdhui, &i)
        serie = c.souple(Int.self, .serie, &i)
        joursActifs = c.souple(Int.self, .joursActifs, &i)
        minutesTotal = c.souple(Int.self, .minutesTotal, &i)
        messagesTotal = c.souple(Int.self, .messagesTotal, &i)
        _ = i
    }
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

    enum CodingKeys: String, CodingKey { case etats, convs, couverture, sessions, updatedAt }
}

extension EtatOnboarding {
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var i: [String] = []
        etats = c.souple([String: String].self, .etats, &i)
        convs = c.souple([String: String].self, .convs, &i)
        couverture = c.souple([String: [String]].self, .couverture, &i)
        sessions = c.listeSouple(SessionOnboarding.self, .sessions, &i)
        updatedAt = c.souple(Millis.self, .updatedAt, &i)
        _ = i
    }
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

// MARK: - Projets (onglet Projets, lecture seule depuis Motion)

public struct Projet: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var nom: String
    public var statut: String?
    public var taches: Int
    public var enRetard: Int?
    public var prochaine: TacheResume?
    /// Les tâches ouvertes du projet (dossiers-v1), pour les ranger.
    public var liste: [TacheResume]?

    public init(id: String, nom: String, statut: String? = nil, taches: Int, enRetard: Int? = nil, prochaine: TacheResume? = nil) {
        self.id = id
        self.nom = nom
        self.statut = statut
        self.taches = taches
        self.enRetard = enRetard
        self.prochaine = prochaine
    }
}

public struct ListeProjets: Codable, Sendable, Equatable {
    public var projets: [Projet]
    public var sansProjet: Int?
    /// Faux : Motion n'est pas branché sur la tour.
    public var motion: Bool?
    public var tronquee: Bool?

    enum CodingKeys: String, CodingKey { case projets, sansProjet, motion, tronquee }

    public init(projets: [Projet], sansProjet: Int? = nil, motion: Bool? = nil, tronquee: Bool? = nil) {
        self.projets = projets
        self.sansProjet = sansProjet
        self.motion = motion
        self.tronquee = tronquee
    }
}

extension ListeProjets {
    /// Un projet illisible est sauté, les autres s'affichent.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var i: [String] = []
        projets = c.listeSouple(Projet.self, .projets, &i) ?? []
        sansProjet = c.souple(Int.self, .sansProjet, &i)
        motion = c.souple(Bool.self, .motion, &i)
        tronquee = c.souple(Bool.self, .tronquee, &i)
        _ = i
    }
}

// MARK: - Décodage tolérant

/// Un élément de liste décodé sans faire échouer la liste qui le contient.
struct Souple<T: Decodable>: Decodable {
    let valeur: T?
    init(from decoder: Decoder) throws { valeur = try? T(from: decoder) }
}

extension KeyedDecodingContainer {
    /// Absente ou nulle : nil. Illisible : nil aussi, et notée dans `illisibles`.
    func souple<T: Decodable>(_ type: T.Type, _ cle: Key, _ illisibles: inout [String]) -> T? {
        do {
            return try decodeIfPresent(T.self, forKey: cle)
        } catch {
            illisibles.append(cle.stringValue)
            return nil
        }
    }

    /// Une liste dont les éléments illisibles sont sautés (et comptés).
    func listeSouple<T: Decodable>(_ type: T.Type, _ cle: Key, _ illisibles: inout [String]) -> [T]? {
        guard let brute = souple([Souple<T>].self, cle, &illisibles) else { return nil }
        let bons = brute.compactMap(\.valeur)
        if bons.count < brute.count { illisibles.append("\(cle.stringValue) (\(brute.count - bons.count))") }
        return bons
    }
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

    /// Ce que Sam lit après « Retenir ».
    public var phrase: String {
        let a = ajouts ?? []
        if let premier = a.first {
            let reste = a.count - 1
            return "Retenu : \(premier)" + (reste > 0 ? " — et \(reste) autre\(reste > 1 ? "s" : "") chose\(reste > 1 ? "s" : "")." : "")
        }
        if memoire == false { return message.map { "Gardé : \($0)" } ?? "Gardé : Rémy le relira cette nuit." }
        return "Rien de nouveau : Rémy le savait déjà."
    }
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


/// GET /api/mesures (capacité « mesures-v1 ») : les temps côté tour.
public struct MesuresTour: Codable, Sendable, Equatable {
    public struct Serie: Codable, Sendable, Equatable {
        public var n: Int
        public var p50: Int?
        public var p95: Int?
        public var max: Int?
        public var dernier: Int?
    }
    public var mesures: [String: Serie]
    public var motion: EtatMotion?
}
