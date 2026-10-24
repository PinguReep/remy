import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// MARK: - Ce que tu utilises vraiment (24/10)
//
// Des compteurs par fonction et par jour, sur cet iPhone seulement. Aucun
// contenu : un nom de fonction et un nombre, jamais un texte, un titre ou un
// lieu. Ils ne partent nulle part (pas même vers la tour). But : savoir ce qui
// sert avant d'ajouter une brique, et ce qu'on pourrait retirer.
//
// Comptés : les onglets ouverts, et les GESTES — les écritures envoyées à la
// tour (une coche, un message, une validation). Les lectures, les rejeux et ce
// que l'app envoie seule (lieux, signe de vie) ne comptent pas.

public enum FonctionUsage: String, CaseIterable, Sendable {
    case ouverture, aujourdhui, remy, projets
    case parler, valider, refuser, annuler
    case terminer, gerer, capture, retenir
    case listes, rappels, dictee, dossiers
    case regles, conseil, nuit, lieux, reglages

    public var libelle: String {
        switch self {
        case .ouverture: return "Ouvrir l'app"
        case .aujourdhui: return "Onglet Aujourd'hui"
        case .remy: return "Onglet Rémy"
        case .projets: return "Onglet Projets"
        case .parler: return "Parler à Rémy"
        case .valider: return "Valider une proposition"
        case .refuser: return "Refuser ou ajuster une proposition"
        case .annuler: return "Annuler une action"
        case .terminer: return "Cocher une tâche"
        case .gerer: return "Décaler, prolonger, modifier"
        case .capture: return "Noter avec « + »"
        case .retenir: return "Retenir une idée"
        case .listes: return "Listes de courses"
        case .rappels: return "Rappels"
        case .dictee: return "Dictée"
        case .dossiers: return "Dossiers et étiquettes"
        case .regles: return "Règles de Rémy"
        case .conseil: return "Renouveler le conseil"
        case .nuit: return "Sujets de la nuit"
        case .lieux: return "Lieux"
        case .reglages: return "Réglages de la tour"
        }
    }

    /// Les onglets et l'ouverture disent qu'on regarde ; le reste, qu'on agit.
    public var estUnGeste: Bool { ![.ouverture, .aujourdhui, .remy, .projets].contains(self) }

    /// Quelle fonction une écriture vers la tour représente. nil : une lecture,
    /// ou un envoi que l'app fait seule. Seul le TYPE d'action est lu dans le
    /// corps, jamais un texte.
    public static func de(methode: String, chemin: String, corps: Data?) -> FonctionUsage? {
        guard methode != "GET" else { return nil }
        let p = chemin.split(separator: "?").first.map(String.init) ?? chemin
        let m = p.split(separator: "/").map(String.init)
        guard m.count >= 2, m[0] == "api" else { return nil }
        switch m[1] {
        case "conversations":
            if m.count == 4 && m[3] == "messages" { return .parler }
            if m.count == 5 && m[3] == "autorisations" { return .parler }
            if m.count == 6 && m[3] == "propositions" {
                return m[5] == "regle" ? .regles : .refuser
            }
            return nil
        case "motion", "google":
            if m.count == 3 && m[2] == "undo" { return .annuler }
            guard m.count == 3 && m[2] == "apply" else { return nil }
            let obj = corps.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            if obj?["origine"] as? String == "capture" { return .capture }
            if obj?["convId"] != nil { return .valider }
            let type = ((obj?["actions"] as? [[String: Any]])?.first?["type"] as? String) ?? ""
            switch type {
            case "terminer": return .terminer
            case "creer": return .capture
            case "modifier", "replanifier", "prolonger": return .gerer
            default: return .valider
            }
        case "taches": return m.last == "etiquettes" ? .dossiers : .gerer
        case "capture": return m.count == 3 && m[2] == "analyser" ? .capture : .retenir
        case "listes": return .listes
        case "rappels": return .rappels
        case "transcribe", "dictee": return .dictee
        case "etiquettes", "dossiers", "rattachements": return .dossiers
        case "regles": return .regles
        case "conseil": return .conseil
        case "briefing": return .nuit
        case "lieux": return m.count == 3 && m[2] == "evenements" ? nil : .lieux
        case "reglages", "modeles": return .reglages
        default: return nil
        }
    }
}

/// Les compteurs, gardés 60 jours dans les réglages de l'iPhone.
public final class CompteursUsage: @unchecked Sendable {
    public static let partages = CompteursUsage()
    static let cle = "remy.usage.v1"
    static let cleDebut = "remy.usage.debut"
    static let joursGardes = 60

    private let verrou = NSLock()
    private let reglages: UserDefaults
    /// jour (« 2026-10-24 ») → fonction → nombre.
    private var parJour: [String: [String: Int]]
    public private(set) var debut: Date?

    public init(reglages: UserDefaults = UserDefaults(suiteName: "remy.usage") ?? .standard) {
        self.reglages = reglages
        parJour = (reglages.dictionary(forKey: Self.cle) as? [String: [String: Int]]) ?? [:]
        debut = reglages.object(forKey: Self.cleDebut) as? Date
    }

    public func noter(_ f: FonctionUsage, le date: Date = Date()) {
        verrou.lock()
        defer { verrou.unlock() }
        let jour = Format.jourISO(date)
        parJour[jour, default: [:]][f.rawValue, default: 0] += 1
        if debut == nil {
            debut = date
            reglages.set(date, forKey: Self.cleDebut)
        }
        if parJour.count > Self.joursGardes {
            for j in parJour.keys.sorted().prefix(parJour.count - Self.joursGardes) { parJour[j] = nil }
        }
        reglages.set(parJour, forKey: Self.cle)
    }

    /// Une écriture vers la tour (ClientAPI) : comptée si c'est un geste connu.
    public func noter(methode: String, chemin: String, corps: Data?) {
        if let f = FonctionUsage.de(methode: methode, chemin: chemin, corps: corps) { noter(f) }
    }

    /// Les totaux des `jours` derniers jours (aujourd'hui compris).
    public func totaux(jours: Int = 30, maintenant: Date = Date()) -> [FonctionUsage: Int] {
        verrou.lock()
        defer { verrou.unlock() }
        let cal = Format.calendrier
        let depuis = cal.date(byAdding: .day, value: -(jours - 1), to: Format.debutDuJour(maintenant)) ?? maintenant
        let premier = Format.jourISO(depuis)
        var t: [FonctionUsage: Int] = [:]
        for (jour, compte) in parJour where jour >= premier {
            for (cle, n) in compte {
                if let f = FonctionUsage(rawValue: cle) { t[f, default: 0] += n }
            }
        }
        return t
    }

    public func remettreAZero() {
        verrou.lock()
        defer { verrou.unlock() }
        parJour = [:]
        debut = nil
        reglages.removeObject(forKey: Self.cle)
        reglages.removeObject(forKey: Self.cleDebut)
    }
}

/// Le résumé de Réglages : ce qui sert, ce qui ne sert pas.
public struct ResumeUsage: Equatable, Sendable {
    public struct Ligne: Equatable, Sendable, Identifiable {
        public let fonction: FonctionUsage
        public let nombre: Int
        public var id: String { fonction.rawValue }
    }
    /// Les gestes, du plus au moins utilisé.
    public let gestes: [Ligne]
    /// Les onglets et l'ouverture de l'app.
    public let vues: [Ligne]
    /// Les gestes jamais faits sur la période.
    public let jamais: [FonctionUsage]
    public let jours: Int
    public let depuis: Date?

    /// Moins de 10 gestes : trop tôt pour conclure.
    public var assez: Bool { gestes.reduce(0) { $0 + $1.nombre } >= 10 }

    public static func de(_ c: CompteursUsage, jours: Int = 30, maintenant: Date = Date()) -> ResumeUsage {
        de(c.totaux(jours: jours, maintenant: maintenant), depuis: c.debut, jours: jours)
    }

    public static func de(_ t: [FonctionUsage: Int], depuis: Date?, jours: Int = 30) -> ResumeUsage {
        let lignes = FonctionUsage.allCases.compactMap { f in t[f].map { Ligne(fonction: f, nombre: $0) } }
            .filter { $0.nombre > 0 }
            .sorted { $0.nombre != $1.nombre ? $0.nombre > $1.nombre : $0.fonction.libelle < $1.fonction.libelle }
        return ResumeUsage(gestes: lignes.filter { $0.fonction.estUnGeste },
                           vues: lignes.filter { !$0.fonction.estUnGeste },
                           jamais: FonctionUsage.allCases.filter { $0.estUnGeste && (t[$0] ?? 0) == 0 },
                           jours: jours, depuis: depuis)
    }

    /// La ligne de Réglages, sous « Ce que tu utilises vraiment ».
    public var phrase: String {
        guard assez else { return "Pas encore assez de gestes comptés pour le dire. Compté sur cet iPhone, sans contenu." }
        let top = gestes.prefix(3).map { $0.fonction.libelle.lowercased() }
        return "Surtout : " + top.joined(separator: ", ") + (jamais.isEmpty ? "." : ". \(jamais.count) fonction\(jamais.count > 1 ? "s" : "") jamais touchée\(jamais.count > 1 ? "s" : "").")
    }
}
