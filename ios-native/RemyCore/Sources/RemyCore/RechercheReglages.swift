import Foundation

// MARK: - Chercher dans les réglages (29/10)
//
// « Un système de recherche dans les paramètres pour aller directement à ce
// qu'on cherche » : un index déclaratif de chaque réglage et de chaque écran de
// réglages (titre, sous-titre, mots-clés et synonymes : « notif », « privé »,
// « Siri »…), y compris ceux des sous-écrans (Diagnostic, Rendez-vous
// quotidien, Localisation…). Sans IA, sans réseau : la saisie est comparée
// mot à mot, sans accents ni majuscules, avec une tolérance aux fautes de
// frappe quand rien ne correspond exactement.
//
// Une nouvelle ligne dans Réglages = une entrée ici. RechercheReglagesTests
// relit les vues : une ligne oubliée, ou une ancre renommée, fait échouer les
// tests.

/// Un écran de réglages : celui qui s'ouvre quand on touche un résultat.
public enum EcranReglages: String, CaseIterable, Sendable {
    case reglages
    case memoire
    case usage
    case modeles
    case lieux
    case activitePC
    case priorites
    case regles
    case appareils
    case nouveautes
    case aTrancher
    case revue
    case diagnostic
    /// Réglages de l'iPhone › Rémy (autorisations d'iOS) : hors de l'app.
    case iphone

    /// Le titre de l'écran, tel qu'il s'affiche.
    public var titre: String {
        switch self {
        case .reglages: return "Réglages"
        case .memoire: return "Ce que Rémy sait de toi"
        case .usage: return "Ce que tu utilises vraiment"
        case .modeles: return "Modèle"
        case .lieux: return "Localisation"
        case .activitePC: return "Activité du PC"
        case .priorites: return "Ce qui compte"
        case .regles: return "Règles de Rémy"
        case .appareils: return "Appareils connectés"
        case .nouveautes: return "Nouveautés"
        case .aTrancher: return "À trancher"
        case .revue: return "Revue de la semaine"
        case .diagnostic: return "Diagnostic"
        case .iphone: return "Réglages de l'iPhone"
        }
    }
}

/// Ce dont dépend la présence d'un réglage à l'écran : une capacité de la
/// tour, un réglage qu'elle a dit, un interrupteur allumé.
public enum ConditionReglage: Hashable, Sendable {
    /// La tour connaît cette fonction (sinon la ligne est cachée).
    case capacite(String)
    /// Le coût des 30 derniers jours est connu.
    case couts
    /// La tour a dit son réglage de recherche web.
    case rechercheWeb
    /// Recherche web allumée et passant par Claude (pas de recherche locale).
    case contexteCloud
    /// Recherche dans les conversations privées (recherche-privee-v1).
    case recherchePrivee
    /// Le secours Claude a un objet (un modèle local répond d'habitude).
    case secours
    /// Un circuit de fond que la tour expose (nuit, conseil, compactage, règles).
    case circuit(String)
    /// Le briefing du matin est allumé (son heure n'est affichée qu'alors).
    case briefingAllume
    /// Le bilan du soir est allumé (son heure n'est affichée qu'alors).
    case bilanAllume
    /// L'activité en direct est allumée (« Démarrer seule » n'est affiché qu'alors).
    case activiteEnDirect
    /// La localisation est allumée (« Pause 2 h » n'est affichée qu'alors).
    case lieuxActifs
}

/// Un réglage, ou un écran de réglages, tel que la recherche le connaît.
public struct EntreeReglage: Identifiable, Equatable, Sendable {
    /// Quand la ligne visée n'est pas affichée (son interrupteur est coupé) :
    /// on met en évidence celle qui la fait apparaître, et on le dit.
    public struct Repli: Equatable, Sendable {
        public let condition: ConditionReglage
        public let ancre: String
        public let note: String
    }

    public let id: String
    public let titre: String
    public let sousTitre: String
    public let symbole: String
    /// L'écran à ouvrir.
    public let ecran: EcranReglages
    /// La ligne à mettre en évidence dans cet écran (son libellé). nil : l'écran
    /// lui-même est le résultat.
    public let ancre: String?
    /// La partie de l'écran (« Rendez-vous quotidien »), pour le chemin.
    public let section: String?
    public let motsCles: [String]
    /// Toutes vraies, sinon l'entrée n'est pas proposée (l'écran ne la montre pas).
    public let conditions: [ConditionReglage]
    public let repli: Repli?
    /// Un tutoriel des Nouveautés à ouvrir directement (« Siri » : le tutoriel « Rémy sans ouvrir l'app »).
    public let tutoriel: String?

    public init(_ id: String, _ titre: String, sous: String, symbole: String, ecran: EcranReglages = .reglages,
                ancre: String? = nil, section: String? = nil, mots: [String] = [], si conditions: [ConditionReglage] = [],
                repli: Repli? = nil, tutoriel: String? = nil) {
        self.id = id
        self.titre = titre
        self.sousTitre = sous
        self.symbole = symbole
        self.ecran = ecran
        self.ancre = ancre
        self.section = section
        self.motsCles = mots
        self.conditions = conditions
        self.repli = repli
        self.tutoriel = tutoriel
    }

    /// Où il se trouve : « Réglages › Diagnostic », « Réglages › Rendez-vous quotidien ».
    public var chemin: String {
        var parties: [String]
        switch ecran {
        case .iphone: parties = ["Réglages de l'iPhone", "Rémy"]
        case .reglages: parties = ["Réglages"]
        default: parties = ancre == nil && tutoriel == nil ? ["Réglages"] : ["Réglages", ecran.titre]
        }
        if let section { parties.append(section) }
        return parties.joined(separator: " › ")
    }

    /// Le chemin pour VoiceOver (« Réglages, Diagnostic ») : « › » ne se lit pas.
    public var cheminLu: String { chemin.replacingOccurrences(of: " › ", with: ", ") }
}

/// Ce que l'écran montre en ce moment : les capacités de la tour, ses
/// réglages, les interrupteurs de l'iPhone dont d'autres lignes dépendent.
public struct ContexteReglages: Sendable {
    public var capacites: Set<String>
    public var reglages: Reglages?
    public var couts: Bool
    public var briefing: Bool
    public var bilan: Bool
    public var activiteEnDirect: Bool
    public var lieuxActifs: Bool

    public init(capacites: Set<String> = [], reglages: Reglages? = nil, couts: Bool = false, briefing: Bool = false,
                bilan: Bool = false, activiteEnDirect: Bool = true, lieuxActifs: Bool = false) {
        self.capacites = capacites
        self.reglages = reglages
        self.couts = couts
        self.briefing = briefing
        self.bilan = bilan
        self.activiteEnDirect = activiteEnDirect
        self.lieuxActifs = lieuxActifs
    }

    public func permet(_ c: ConditionReglage) -> Bool {
        switch c {
        case .capacite(let k): return capacites.contains(k)
        case .couts: return couts
        case .rechercheWeb: return reglages?.rechercheWeb != nil
        case .contexteCloud:
            guard let r = reglages, r.rechercheWeb != nil else { return false }
            return r.rechercheWeb == true && r.moteurRecherche == nil
        case .recherchePrivee: return capacites.contains("recherche-privee-v1") && reglages?.recherchePriveeReglage != nil
        case .secours: return reglages.map { $0.secoursCloudSansObjet != true } ?? false
        case .circuit(let id): return reglages?.circuits?[id] != nil
        case .briefingAllume: return briefing
        case .bilanAllume: return bilan
        case .activiteEnDirect: return activiteEnDirect
        case .lieuxActifs: return lieuxActifs
        }
    }
}

extension ContexteReglages {
    /// Le contexte de l'écran Réglages ouvert.
    @MainActor
    public init(app: AppModel, reglages: Reglages?, activiteEnDirect: Bool, rituel: ReglagesRituel = .lire()) {
        self.init(capacites: Set(app.serveur?.capacites ?? []), reglages: reglages,
                  couts: app.tableau.donnees?.couts != nil, briefing: rituel.matin, bilan: rituel.soir,
                  activiteEnDirect: activiteEnDirect, lieuxActifs: app.lieux.active)
    }
}

/// Où mène un résultat touché.
public struct CibleReglage: Equatable, Sendable {
    public let ecran: EcranReglages
    /// La ligne à mettre en évidence (nil : l'écran seul).
    public let ancre: String?
    public let tutoriel: String?
    /// Dit quand la ligne visée n'est pas affichée (« Allume d'abord… »).
    public let note: String?
}

/// Ce que montre la recherche pour une saisie.
public struct ResultatsReglages: Equatable, Sendable {
    /// La saisie, sans espaces autour.
    public let requete: String
    public let entrees: [EntreeReglage]
    /// Ce qui correspond mais que l'écran ne montre pas (fonction que la tour
    /// ne propose pas, réglages pas encore relus).
    public let indisponibles: [EntreeReglage]
    /// Trouvé en tolérant une faute de frappe.
    public let approchee: Bool

    public var vide: Bool { requete.isEmpty }

    /// Au-dessus de la liste : le nombre de résultats, ou que c'est approché.
    public var enTete: String? {
        guard !entrees.isEmpty else { return nil }
        if approchee { return "Rien d'exact pour « \(requete) » : ce qui s'en approche" }
        return entrees.count == 1 ? "1 réglage" : "\(entrees.count) réglages"
    }

    /// L'état vide : la phrase principale.
    public var titreVide: String? {
        guard !vide, entrees.isEmpty else { return nil }
        return "Rien ne correspond à « \(requete) »."
    }

    /// L'état vide : pourquoi, et quoi faire.
    public var detailVide: String? {
        guard !vide, entrees.isEmpty else { return nil }
        if let e = indisponibles.first {
            return "« \(e.titre) » dépend de ta tour, qui ne le propose pas pour l'instant (mise à jour de la tour, ou réglages pas encore relus)."
        }
        return "Essaie un autre mot, ou l'un de ceux-ci :"
    }
}

public enum RechercheReglages {
    /// Proposées quand rien ne correspond.
    public static let suggestions = ["Notifications", "Thème", "Modèle"]

    // MARK: L'index

    /// Chaque réglage et chaque écran de réglages, dans l'ordre de l'écran.
    public static let index: [EntreeReglage] = [
        EntreeReglage("memoire", "Ce que Rémy sait de toi", sous: "Ce qu'il retient de toi : le lire, le corriger.",
                      symbole: "person.text.rectangle", ecran: .memoire,
                      mots: ["mémoire", "souvenirs", "profil", "connaissance", "retient", "corriger", "oublier", "personnel", "infos", "moi"]),
        // Rendez-vous quotidien (rituel-v1).
        EntreeReglage("rituel.matin", "Briefing du matin", sous: "Ce qui compte, pourquoi, ce qui est menacé : une notification le matin.",
                      symbole: "sunrise", ancre: "Briefing du matin", section: "Rendez-vous quotidien",
                      mots: ["notification", "notifications", "matin", "réveil", "rituel", "rendez-vous", "quotidien", "résumé", "journée", "alerte", "alarme", "programme"],
                      si: [.capacite("rituel-v1")]),
        EntreeReglage("rituel.heureMatin", "Heure du briefing", sous: "7 h 30 par défaut.",
                      symbole: "clock", ancre: "Heure du briefing", section: "Rendez-vous quotidien",
                      mots: ["heure", "horaire", "matin", "réveil", "notification", "notifications", "quand", "7 h 30"],
                      si: [.capacite("rituel-v1")],
                      repli: .init(condition: .briefingAllume, ancre: "Briefing du matin", note: "Allume d'abord « Briefing du matin » : l'heure s'affiche dessous.")),
        EntreeReglage("rituel.soir", "Bilan du soir", sous: "Fait, glissé, ce qui reste pour demain : 22 h 45 par défaut, avant de te coucher.",
                      symbole: "moon.stars", ancre: "Bilan du soir", section: "Rendez-vous quotidien",
                      mots: ["notification", "notifications", "soir", "coucher", "dodo", "rituel", "rendez-vous", "quotidien", "récap", "fin de journée", "point", "journée", "alarme"],
                      si: [.capacite("rituel-v1")]),
        EntreeReglage("rituel.heureSoir", "Heure du bilan", sous: "22 h 45 par défaut, avant de te coucher.",
                      symbole: "clock", ancre: "Heure du bilan", section: "Rendez-vous quotidien",
                      mots: ["heure", "horaire", "soir", "coucher", "notification", "notifications", "quand", "22 h 45"],
                      si: [.capacite("rituel-v1")],
                      repli: .init(condition: .bilanAllume, ancre: "Bilan du soir", note: "Allume d'abord « Bilan du soir » : l'heure s'affiche dessous.")),
        EntreeReglage("capture", "Une pensée sans action claire", sous: "Où va ce que tu notes sans verbe d'action : dans les Idées, ou dans Motion.",
                      symbole: "tray.and.arrow.down", ancre: "Une pensée sans action claire", section: "Capture",
                      mots: ["capture", "capturer", "noter", "note", "idée", "idées", "motion", "tâche", "plus", "dossier", "pensée", "par défaut", "ranger"],
                      si: [.capacite("dossiers-v1")]),
        EntreeReglage("site", "Ouvrir le site", sous: "Le même Rémy dans un navigateur.", symbole: "safari", ancre: "Ouvrir le site",
                      mots: ["site", "web", "navigateur", "ordinateur", "mac", "pc", "internet", "page"]),
        EntreeReglage("usage", "Ce que tu utilises vraiment", sous: "Tes gestes, comptés sur l'iPhone, sans aucun contenu.",
                      symbole: "chart.bar", ecran: .usage,
                      mots: ["usage", "utilisation", "statistiques", "stats", "compteurs", "fonctions", "gestes", "habitudes"]),
        EntreeReglage("usage.zero", "Remettre les compteurs à zéro", sous: "Les gestes comptés sur cet iPhone.",
                      symbole: "arrow.counterclockwise", ecran: .usage, ancre: "Remettre les compteurs à zéro",
                      mots: ["réinitialiser", "effacer", "remise à zéro", "compteurs", "statistiques", "usage", "reset"]),
        EntreeReglage("couts", "Coût des 30 derniers jours", sous: "Ce que les appels aux modèles ont coûté.",
                      symbole: "creditcard", ancre: "Coût des 30 derniers jours",
                      mots: ["coût", "coûts", "prix", "dépenses", "argent", "facture", "budget", "dollars", "euros", "tokens", "combien"],
                      si: [.couts]),
        EntreeReglage("apparence", "Apparence", sous: "Comme l'iPhone, clair ou sombre.", symbole: "circle.lefthalf.filled", ancre: "Apparence",
                      mots: ["thème", "sombre", "clair", "mode sombre", "mode nuit", "dark", "couleurs", "noir", "blanc", "affichage", "écran"]),
        EntreeReglage("liens", "Prévenir avant d'ouvrir un lien", sous: "Lire une page web coûte un peu plus qu'un message.",
                      symbole: "link", ancre: "Prévenir avant d'ouvrir un lien",
                      mots: ["lien", "liens", "url", "page", "web", "confirmation", "confirmer", "avertir", "coût"]),
        EntreeReglage("activite", "Activité en direct", sous: "La tâche en cours sur l'écran verrouillé et dans la Dynamic Island.",
                      symbole: "timer", ancre: "Activité en direct",
                      mots: ["écran verrouillé", "verrouillage", "dynamic island", "live activity", "activités en direct", "minuterie", "chrono", "tâche en cours"]),
        EntreeReglage("activite.auto", "Démarrer seule", sous: "L'activité en direct démarre quand une tâche commence, app ouverte.",
                      symbole: "play.circle", ancre: "Démarrer seule", section: "Activité en direct",
                      mots: ["automatique", "auto", "démarrer", "lancer", "commencer", "activité en direct", "dynamic island"],
                      repli: .init(condition: .activiteEnDirect, ancre: "Activité en direct", note: "Allume d'abord « Activité en direct » : ce réglage s'affiche dessous.")),
        EntreeReglage("web", "Recherche web", sous: "Rémy cherche sur le web quand il en a besoin.", symbole: "globe", ancre: "Recherche web",
                      mots: ["internet", "web", "google", "duckduckgo", "searxng", "chercher", "en ligne", "navigateur"],
                      si: [.rechercheWeb]),
        EntreeReglage("contexte", "Envoi de contexte au cloud", sous: "Ce qui part avec une recherche autorisée.", symbole: "icloud.and.arrow.up",
                      ancre: "Envoi de contexte au cloud",
                      mots: ["cloud", "contexte", "claude", "anthropic", "vie privée", "confidentialité", "données", "privé", "envoi"],
                      si: [.contexteCloud]),
        EntreeReglage("privee", "Recherche dans les conversations privées", sous: "Coupée par défaut : une conversation privée ne cherche jamais sur le web.",
                      symbole: "lock", ancre: "Recherche dans les conversations privées",
                      mots: ["privé", "privée", "privées", "confidentialité", "cadenas", "secret", "web", "vie privée"],
                      si: [.recherchePrivee]),
        EntreeReglage("secours", "Secours Claude si la tour ne répond pas", sous: "Coupé par défaut : rien ne part chez Anthropic.",
                      symbole: "lifepreserver", ancre: "Secours Claude si la tour ne répond pas",
                      mots: ["claude", "anthropic", "cloud", "secours", "panne", "tour éteinte", "hors ligne", "vie privée", "privé", "modèle de secours"],
                      si: [.secours]),
        EntreeReglage("circuit.nuit", "Réflexion de la nuit", sous: "Rémy relit tes échanges et prépare le briefing du matin.",
                      symbole: "moon.zzz", ancre: "Réflexion de la nuit",
                      mots: ["nuit", "nocturne", "réflexion", "préparation", "relire", "sujets de la nuit", "briefing"],
                      si: [.circuit("nuit")]),
        EntreeReglage("circuit.conseil", "Conseil réfléchi", sous: "Le modèle local prépare le conseil du moment.",
                      symbole: "lightbulb", ancre: "Conseil réfléchi",
                      mots: ["conseil", "conseil du moment", "suggestion", "ia", "modèle local"],
                      si: [.circuit("conseil")]),
        EntreeReglage("circuit.compactage", "Compacter les longues conversations", sous: "Dès 70 % du contexte, le début du fil est résumé, rien n'est effacé.",
                      symbole: "rectangle.compress.vertical", ancre: "Compacter les longues conversations",
                      mots: ["compactage", "compacter", "résumé", "résumer", "70 %", "contexte", "jauge", "longues conversations"],
                      si: [.circuit("compactage")]),
        EntreeReglage("modeles", "Modèle", sous: "Le modèle local avec lequel Rémy répond, sur tes Sparks.", symbole: "cpu", ecran: .modeles,
                      mots: ["modèle", "modèles", "ia", "intelligence", "cerveau", "glm", "deepseek", "llm", "sparks", "changer"],
                      si: [.capacite("modeles-v1")]),
        EntreeReglage("lieux", "Localisation", sous: "Tes arrivées, départs et trajets, envoyés à ta tour seulement.",
                      symbole: "location", ecran: .lieux, ancre: "Localisation",
                      mots: ["localisation", "lieux", "lieu", "position", "gps", "où je suis", "voiture", "trajets", "visites", "carte", "géolocalisation", "batterie"],
                      si: [.capacite("lieux-v1")]),
        EntreeReglage("lieux.pause", "Pause 2 h", sous: "Couper la localisation pendant deux heures.", symbole: "pause.circle",
                      ecran: .lieux, ancre: "Pause 2 h",
                      mots: ["pause", "suspendre", "localisation", "position", "discret", "2 h"],
                      si: [.capacite("lieux-v1")],
                      repli: .init(condition: .lieuxActifs, ancre: "Localisation", note: "La pause n'existe que localisation allumée.")),
        EntreeReglage("lieux.nommer", "Nommer ce lieu", sous: "Rémy le reconnaîtra à chaque passage.", symbole: "mappin.and.ellipse",
                      ecran: .lieux, ancre: "Nommer ce lieu",
                      mots: ["nommer", "lieu", "maison", "travail", "ici", "adresse", "renommer", "position"],
                      si: [.capacite("lieux-v1")],
                      repli: .init(condition: .lieuxActifs, ancre: "Localisation", note: "Allume d'abord la localisation.")),
        EntreeReglage("lieux.effacer", "Effacer l'historique des lieux", sous: "Les visites gardées sur ta tour ; tes lieux nommés restent.",
                      symbole: "trash", ecran: .lieux, ancre: "Effacer l'historique",
                      mots: ["effacer", "supprimer", "historique", "positions", "visites", "oublier", "localisation"],
                      si: [.capacite("lieux-v1")]),
        EntreeReglage("activitePC", "Activité du PC", sous: "Le temps passé dans tes applis, d'après ActivityWatch.",
                      symbole: "desktopcomputer", ecran: .activitePC, ancre: "Activité du PC",
                      mots: ["pc", "ordinateur", "activitywatch", "temps d'écran", "applis", "applications", "windows", "productivité"],
                      si: [.capacite("activite-pc-v1")]),
        EntreeReglage("activitePC.exclure", "Ne plus compter une appli", sous: "Une appli ou un site jamais comptés.",
                      symbole: "eye.slash", ecran: .activitePC, ancre: "Ne plus compter une appli…",
                      mots: ["exclure", "exclusion", "ignorer", "appli", "site", "jamais comptées", "pc"],
                      si: [.capacite("activite-pc-v1")]),
        EntreeReglage("activitePC.effacer", "Effacer l'activité du PC", sous: "Tout ce que la tour a relevé d'ActivityWatch.",
                      symbole: "trash", ecran: .activitePC, ancre: "Tout effacer",
                      mots: ["effacer", "supprimer", "historique", "activité", "pc", "ordinateur"],
                      si: [.capacite("activite-pc-v1")]),
        EntreeReglage("priorites", "Ce qui compte", sous: "Tes 3 à 5 priorités : le conseil et la nuit s'en servent.",
                      symbole: "star", ecran: .priorites,
                      mots: ["priorités", "priorité", "objectifs", "important", "focus", "valeurs"],
                      si: [.capacite("priorites-v1")]),
        EntreeReglage("regles", "Règles de Rémy", sous: "Les tâches à faire avant un type d'événement.",
                      symbole: "arrow.triangle.branch", ecran: .regles,
                      mots: ["règles", "règle", "automatisme", "automatique", "avant", "événement", "si alors", "routine"],
                      si: [.capacite("regles-v1")]),
        EntreeReglage("circuit.regles", "Vérifier les règles", sous: "Toutes les 3 h, sans IA : ton agenda et Motion relus.",
                      symbole: "arrow.triangle.2.circlepath", ancre: "Vérifier les règles",
                      mots: ["règles", "vérification", "automatique", "3 h", "agenda", "motion"],
                      si: [.circuit("regles")]),
        EntreeReglage("appareils", "Appareils connectés", sous: "Déconnecte un iPhone perdu ou prêté.", symbole: "iphone", ecran: .appareils,
                      mots: ["appareils", "iphone", "ipad", "perdu", "volé", "prêté", "sessions", "jetons", "sécurité", "déconnecter"],
                      si: [.capacite("appareils")]),
        EntreeReglage("nouveautes", "Nouveautés", sous: "Les tutoriels des mises à jour, à revoir.", symbole: "sparkles", ecran: .nouveautes,
                      mots: ["nouveautés", "nouveau", "quoi de neuf", "mise à jour", "mises à jour", "tutoriel", "tutoriels", "aide", "astuces"]),
        EntreeReglage("hors-app", "Siri, widgets et bouton Action", sous: "Rémy sans ouvrir l'app : le tutoriel.", symbole: "mic",
                      ecran: .nouveautes,
                      mots: ["siri", "widget", "widgets", "bouton action", "centre de contrôle", "raccourci", "raccourcis", "écran d'accueil",
                             "voix", "commande vocale", "dis siri"],
                      tutoriel: "hors-app"),
        EntreeReglage("partage", "Partager vers Rémy", sous: "Un texte, un lien, une capture d'écran depuis n'importe quelle app : le tutoriel.",
                      symbole: "square.and.arrow.up", ecran: .nouveautes,
                      mots: ["partager", "partage", "feuille de partage", "capture d'écran", "image", "photo", "lien", "safari", "envoyer"],
                      tutoriel: "partage"),
        EntreeReglage("conversation-privee", "Conversation privée", sous: "Une conversation qui reste chez toi : comment l'ouvrir, ce qu'elle change.",
                      symbole: "lock", ecran: .nouveautes,
                      mots: ["privée", "privé", "cadenas", "confidentiel", "secret", "conversation", "intime"],
                      tutoriel: "privee-iphone"),
        EntreeReglage("iphone", "Réglages de l'iPhone pour Rémy", sous: "Notifications, localisation, micro, Siri : ce qu'iOS autorise à Rémy.",
                      symbole: "gear", ecran: .iphone,
                      mots: ["autorisations", "autorisation", "permissions", "notifications", "micro", "microphone", "siri", "localisation",
                             "activités en direct", "dictée", "ios", "système", "refusé", "refusées"]),
        EntreeReglage("aTrancher", "À trancher", sous: "Cartes, rappels, articles, vieux fils, idées : un geste chacun.",
                      symbole: "tray.2", ecran: .aTrancher,
                      mots: ["trancher", "trier", "tri", "ménage", "ranger", "vieux fils", "cartes", "en attente", "décider"],
                      si: [.capacite("a-trancher-v1")]),
        EntreeReglage("revue", "Revue de la semaine", sous: "Fait, glissé, idées, trois décisions. Sans IA.",
                      symbole: "calendar.badge.checkmark", ecran: .revue,
                      mots: ["revue", "semaine", "hebdo", "hebdomadaire", "bilan de la semaine", "dimanche", "rétrospective"],
                      si: [.capacite("a-trancher-v1")]),
        EntreeReglage("revue.dimanche", "Revue du dimanche", sous: "Proposée sur Aujourd'hui le dimanche, 10 minutes.",
                      symbole: "calendar", ancre: "Revue du dimanche",
                      mots: ["dimanche", "revue", "semaine", "hebdomadaire", "proposée", "rappel"],
                      si: [.capacite("a-trancher-v1")]),
        EntreeReglage("diagnostic", "Diagnostic", sous: "Temps de réponse, jauge du chat, réglages fins.", symbole: "stethoscope", ecran: .diagnostic,
                      mots: ["diagnostic", "debug", "débogage", "avancé", "avancés", "outils", "constructeur", "développeur", "technique",
                             "erreur", "erreurs", "code d'erreur", "bug", "problème", "copier le diagnostic"]),
        EntreeReglage("diagnostic.temps", "Temps de réponse", sous: "Ce que prend chaque étape, iPhone et tour.", symbole: "speedometer",
                      ecran: .diagnostic, ancre: "Temps de réponse",
                      mots: ["lenteur", "lent", "latence", "vitesse", "performance", "mesures", "rapidité", "attente", "motion", "quota"]),
        EntreeReglage("diagnostic.jauge", "Jauge du contexte", sous: "Le cadran en haut des conversations : la place prise, le résumé à 70 %.",
                      symbole: "gauge.with.dots.needle.33percent", ecran: .diagnostic, ancre: "Jauge du contexte",
                      mots: ["jauge", "contexte", "cadran", "70 %", "place", "tokens", "remplissage", "compteur"]),
        EntreeReglage("diagnostic.vitesse", "Vitesse de Rémy", sous: "Les tokens par seconde sous chaque réponse.", symbole: "hare",
                      ecran: .diagnostic, ancre: "Vitesse de Rémy",
                      mots: ["tokens par seconde", "tok/s", "vitesse", "débit", "rapidité", "performance"]),
        EntreeReglage("diagnostic.appui", "Appui pour agrandir le planning", sous: "Plus long si le planning s'ouvre sans le vouloir.",
                      symbole: "hand.tap", ecran: .diagnostic, ancre: "Appui pour agrandir le planning",
                      mots: ["appui long", "appui", "planning", "geste", "ms", "millisecondes", "sensibilité", "agrandir", "journée"]),
        EntreeReglage("deconnexion", "Se déconnecter", sous: "Il faudra retaper le mot de passe.", symbole: "rectangle.portrait.and.arrow.right",
                      ancre: "Se déconnecter",
                      mots: ["déconnexion", "déconnecter", "quitter", "sortir", "compte", "mot de passe", "logout"]),
        EntreeReglage("version", "Version de Rémy", sous: "Le numéro de l'app et celui de ta tour.", symbole: "info.circle", ancre: "Version",
                      mots: ["version", "build", "numéro", "serveur", "tour", "à jour"]),
    ]

    // MARK: Chercher

    /// Les mots qui ne disent rien de ce qu'on cherche (« l'heure du bilan »).
    static let videsDeSens: Set<String> = ["de", "du", "des", "la", "le", "les", "l", "d", "un", "une", "a", "au", "aux", "en", "et",
                                           "pour", "dans", "sur", "mon", "ma", "mes", "ton", "ta", "tes", "ou", "je", "j", "me", "m",
                                           "qu", "que", "quoi", "est", "comment", "avec"]

    /// Sans accents ni majuscules ; « œ » devient « oe ».
    public static func normaliser(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "fr_FR"))
            .lowercased()
            .replacingOccurrences(of: "œ", with: "oe")
            .replacingOccurrences(of: "æ", with: "ae")
    }

    /// Les mots d'un texte, normalisés (« tok/s » : « tok », « s »).
    public static func mots(_ s: String) -> [String] {
        normaliser(s).split { !$0.isLetter && !$0.isNumber }.map(String.init)
    }

    /// Les mots d'une saisie : sans ceux vides de sens, sauf s'il ne reste qu'eux.
    static func motsRequete(_ s: String) -> [String] {
        let tous = mots(s)
        let utiles = tous.filter { !videsDeSens.contains($0) }
        return utiles.isEmpty ? tous : utiles
    }

    /// Ce que l'écran montre pour cette saisie. Une saisie vide : rien (l'écran
    /// Réglages reste tel quel).
    public static func chercher(_ requete: String, contexte: ContexteReglages,
                                index: [EntreeReglage]? = nil) -> ResultatsReglages {
        let propre = requete.trimmingCharacters(in: .whitespacesAndNewlines)
        let q = motsRequete(propre)
        guard !q.isEmpty else { return ResultatsReglages(requete: propre, entrees: [], indisponibles: [], approchee: false) }
        var approchee = false
        // L'index de l'app : ses mots normalisés une fois pour toutes (une saisie par lettre tapée).
        let prepares = index.map { $0.map(Prepare.init) } ?? Self.prepares
        var trouves = classer(q, prepares, tolerance: false)
        if trouves.isEmpty {
            trouves = classer(q, prepares, tolerance: true)
            approchee = !trouves.isEmpty
        }
        let dispo = trouves.filter { e in e.conditions.allSatisfy(contexte.permet) }
        let indispo = trouves.filter { e in !e.conditions.allSatisfy(contexte.permet) }
        return ResultatsReglages(requete: propre, entrees: dispo, indisponibles: indispo, approchee: approchee && !dispo.isEmpty)
    }

    /// Où aller : l'écran, la ligne (ou son repli si elle n'est pas affichée).
    public static func cible(_ e: EntreeReglage, contexte: ContexteReglages) -> CibleReglage {
        if let r = e.repli, !contexte.permet(r.condition) {
            return CibleReglage(ecran: e.ecran, ancre: r.ancre, tutoriel: e.tutoriel, note: r.note)
        }
        return CibleReglage(ecran: e.ecran, ancre: e.ancre, tutoriel: e.tutoriel, note: nil)
    }

    /// Le premier résultat, pour la touche « Rechercher » du clavier.
    public static func premier(_ requete: String, contexte: ContexteReglages) -> EntreeReglage? {
        chercher(requete, contexte: contexte).entrees.first
    }

    // MARK: Score

    /// Une entrée et ses mots normalisés : titre, mots-clés, le reste.
    struct Prepare: Sendable {
        let entree: EntreeReglage
        let titre: [String]
        let cles: [String]
        let reste: [String]
        init(_ e: EntreeReglage) {
            entree = e
            titre = RechercheReglages.mots(e.titre)
            cles = e.motsCles.flatMap(RechercheReglages.mots)
            reste = RechercheReglages.mots(e.sousTitre) + RechercheReglages.mots(e.chemin)
        }
    }

    static let prepares: [Prepare] = index.map(Prepare.init)

    /// Les entrées dont chaque mot de la saisie trouve un mot (le début d'un
    /// mot) dans le titre, les mots-clés, le sous-titre ou le chemin ; les
    /// mieux placées d'abord (le titre compte plus que le reste), l'ordre de
    /// l'écran à égalité.
    static func classer(_ q: [String], _ index: [Prepare], tolerance: Bool) -> [EntreeReglage] {
        let phrase = q.joined(separator: " ")
        var notes: [(Int, Int, EntreeReglage)] = []
        for (rang, p) in index.enumerated() {
            let (e, titre, cles, reste) = (p.entree, p.titre, p.cles, p.reste)
            var total = 0
            var toutTrouve = true
            for m in q {
                let n = max(note(m, titre, plein: 12, debut: 10, tolerance: tolerance),
                            note(m, cles, plein: 9, debut: 8, tolerance: tolerance),
                            note(m, reste, plein: 5, debut: 4, tolerance: tolerance))
                if n == 0 { toutTrouve = false; break }
                total += n
            }
            guard toutTrouve else { continue }
            if titre.joined(separator: " ").hasPrefix(phrase) { total += 15 }
            notes.append((total, rang, e))
        }
        return notes.sorted { $0.0 != $1.0 ? $0.0 > $1.0 : $0.1 < $1.1 }.map(\.2)
    }

    /// La note d'un mot de la saisie contre une liste de mots : le mot entier,
    /// son début, ou (tolérance) à une ou deux fautes près.
    static func note(_ m: String, _ liste: [String], plein: Int, debut: Int, tolerance: Bool) -> Int {
        var meilleure = 0
        for w in liste {
            if w == m { return plein }
            if w.hasPrefix(m) { meilleure = max(meilleure, debut) }
            else if tolerance, proche(m, w) { meilleure = max(meilleure, debut / 2) }
        }
        return meilleure
    }

    /// Une faute de frappe (lettre oubliée, en trop, changée) pour 4 à 7
    /// lettres, deux au-delà ; sur le mot entier ou son début.
    static func proche(_ m: String, _ w: String) -> Bool {
        let a = Array(m)
        guard a.count >= 4 else { return false }
        let permis = a.count >= 8 ? 2 : 1
        let b = Array(w)
        // Le mot entier, ou ses débuts de longueur voisine (« notifcat » ↔ « notification »).
        var candidats = [b]
        for l in max(1, a.count - permis)...(a.count + permis) where l < b.count { candidats.append(Array(b.prefix(l))) }
        return candidats.contains { distance(a, $0, max: permis) <= permis }
    }

    /// Distance d'édition (Levenshtein), arrêtée dès qu'elle dépasse `max`.
    static func distance(_ a: [Character], _ b: [Character], max seuil: Int) -> Int {
        if abs(a.count - b.count) > seuil { return seuil + 1 }
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var prec = Array(0...b.count)
        var cour = [Int](repeating: 0, count: b.count + 1)
        for i in 1...a.count {
            cour[0] = i
            var mini = cour[0]
            for j in 1...b.count {
                let cout = a[i - 1] == b[j - 1] ? 0 : 1
                cour[j] = Swift.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + cout)
                mini = Swift.min(mini, cour[j])
            }
            if mini > seuil { return seuil + 1 }
            swap(&prec, &cour)
        }
        return prec[b.count]
    }
}
