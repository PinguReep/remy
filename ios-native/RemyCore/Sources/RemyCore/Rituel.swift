import Foundation
import Observation

// MARK: - Le rendez-vous quotidien (24/10)
//
// Rémy vient à Sam deux fois par jour, par des notifications locales (aucun
// service de plus) : le briefing du matin (trois lignes : ce qui compte,
// pourquoi, ce qui est menacé) et le bilan du soir (30 s). Le contenu est
// calculé par la tour SANS IA (rituel-v1), relu à chaque ouverture et en
// arrière-plan quand iOS le permet ; une notification préparée la veille le
// dit. Coupé par défaut, proposé une fois.

/// Une tâche dont l'échéance ne tient plus, avec l'action utile.
public struct MenaceeTour: Codable, Sendable, Equatable, Identifiable {
    public struct Action: Codable, Sendable, Equatable {
        /// « repousser » (l'échéance, annulable) ou « caser » (demander à Rémy).
        public var type: String
        public var libelle: String
        public var echeance: Millis?
    }
    public var id: String
    public var titre: String
    public var echeance: Millis?
    public var priorite: String?
    public var projet: String?
    /// apres-echeance, sans-creneau, capacite
    public var raison: String
    public var phrase: String
    public var action: Action?

    public init(id: String, titre: String, echeance: Millis? = nil, raison: String, phrase: String, action: Action? = nil) {
        self.id = id
        self.titre = titre
        self.echeance = echeance
        self.raison = raison
        self.phrase = phrase
        self.action = action
    }
}

/// Les trois lignes du matin, pour un jour (`pour` : AAAA-MM-JJ).
public struct BriefingMatin: Codable, Sendable, Equatable {
    public var pour: String
    public var jour: String?
    public var titre: String
    public var compte: String
    public var pourquoi: String
    public var menace: String
    public var resume: String?
    public var menacees: [MenaceeTour]?
    /// Les sujets de la nuit encore ouverts.
    public var sujets: Int?
}

/// Le bilan du soir : fait, glissé, ce qui reste (avec son échéance de demain).
public struct BilanSoirTour: Codable, Sendable, Equatable {
    public struct Glisse: Codable, Sendable, Equatable, Identifiable {
        public var id: String
        public var titre: String
    }
    public struct Reste: Codable, Sendable, Equatable, Identifiable {
        public var id: String
        public var titre: String
        public var echeance: Millis?
        public var versDemain: Millis
    }
    public var jour: String?
    public var fait: [String]
    public var glisse: [Glisse]
    public var reste: [Reste]
    public var phrase: String
}

/// GET /api/rituel.
public struct RituelTour: Codable, Sendable, Equatable {
    public struct Sources: Codable, Sendable, Equatable {
        public var motion: String?
        public var agenda: String?
    }
    public var maintenant: Millis
    public var sources: Sources?
    public var aujourdhui: BriefingMatin?
    public var demain: BriefingMatin?
    public var soir: BilanSoirTour?
    public var menacees: [MenaceeTour]?
}

public struct RetourBilan: Codable, Sendable { public var ok: Bool?; public var phrase: String? }

/// Les heures choisies dans Réglages. Coupé par défaut.
public struct ReglagesRituel: Equatable, Sendable {
    public static let cleMatin = "rituel.matin"
    public static let cleHeureMatin = "rituel.heureMatin"
    public static let cleSoir = "rituel.soir"
    public static let cleHeureSoir = "rituel.heureSoir"
    /// La proposition de l'accueil (« Recevoir ton briefing chaque matin ? ») : une fois.
    public static let clePropose = "rituel.propose"
    public static let heureMatinParDefaut = 7 * 60 + 30
    public static let heureSoirParDefaut = 21 * 60 + 30

    public var matin: Bool
    public var heureMatin: Int
    public var soir: Bool
    public var heureSoir: Int

    public init(matin: Bool = false, heureMatin: Int = heureMatinParDefaut, soir: Bool = false, heureSoir: Int = heureSoirParDefaut) {
        self.matin = matin
        self.heureMatin = heureMatin
        self.soir = soir
        self.heureSoir = heureSoir
    }

    public static func lire(_ d: UserDefaults = .standard) -> ReglagesRituel {
        ReglagesRituel(matin: d.bool(forKey: cleMatin),
                       heureMatin: (d.object(forKey: cleHeureMatin) as? Int) ?? heureMatinParDefaut,
                       soir: d.bool(forKey: cleSoir),
                       heureSoir: (d.object(forKey: cleHeureSoir) as? Int) ?? heureSoirParDefaut)
    }
}

/// Le calcul, sans réseau ni interface (testé sous Linux).
public enum Rituel {
    /// Au-delà, le contenu est dit « préparé à … » plutôt que présenté comme frais.
    public static let fraicheurMax: TimeInterval = 3 * 3600

    /// Les `nombre` prochains passages à `minutes` après minuit, strictement après `apres`.
    public static func prochains(minutes: Int, apres: Date, nombre: Int, calendrier: Calendar = .current) -> [Date] {
        let m = min(max(0, minutes), 24 * 60 - 1)
        var out: [Date] = []
        var jour = calendrier.startOfDay(for: apres)
        var garde = 0
        while out.count < nombre && garde < nombre + 3 {
            garde += 1
            if let d = calendrier.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: jour), d > apres { out.append(d) }
            guard let suivant = calendrier.date(byAdding: .day, value: 1, to: jour) else { break }
            jour = suivant
        }
        return out
    }

    /// « 2026-10-24 » pour une date, dans le fuseau du calendrier (celui de l'iPhone).
    public static func cleJour(_ d: Date, calendrier: Calendar = .current) -> String {
        let c = calendrier.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Le briefing qui vaut pour ce jour-là (aujourd'hui ou demain vus par la tour), sinon nil.
    public static func briefing(pour jour: Date, dans r: RituelTour, calendrier: Calendar = .current) -> BriefingMatin? {
        let cle = cleJour(jour, calendrier: calendrier)
        return [r.aujourdhui, r.demain].compactMap { $0 }.first { $0.pour == cle }
    }

    /// « à l'instant », « il y a 12 min », « à 07:12 », « hier à 22:10 », « le 21 oct. ».
    public static func fraicheur(_ d: Date, maintenant: Date, calendrier: Calendar = .current) -> String {
        let s = maintenant.timeIntervalSince(d)
        if s < 90 { return "à l'instant" }
        if s < 3600 { return "il y a \(Int(s / 60)) min" }
        let h = Format.heure(d)
        if calendrier.isDate(d, inSameDayAs: maintenant) { return "à \(h)" }
        if let hier = calendrier.date(byAdding: .day, value: -1, to: maintenant), calendrier.isDate(d, inSameDayAs: hier) { return "hier à \(h)" }
        return "le \(Format.jourCourt(d))"
    }

    /// Ce que la notification du matin dira. Préparée la veille : elle le dit.
    public static func notificationMatin(_ b: BriefingMatin?, prepareA: Date?, declenchement: Date,
                                         calendrier: Calendar = .current) -> (titre: String, sousTitre: String?, corps: String) {
        guard let b else {
            let depuis = prepareA.map { " (dernière lecture \(fraicheur($0, maintenant: declenchement, calendrier: calendrier)))" } ?? ""
            return ("Ton briefing", nil, "Ta tour n'a pas encore préparé cette journée\(depuis). Ouvre Rémy pour le calculer.")
        }
        var sous: String?
        if let p = prepareA, declenchement.timeIntervalSince(p) > fraicheurMax {
            sous = "Préparé \(fraicheur(p, maintenant: declenchement, calendrier: calendrier)) · touche pour l'actualiser"
        }
        return (b.titre, sous, [b.compte, b.pourquoi, b.menace].joined(separator: "\n"))
    }

    /// Ce que la notification du soir dira (le bilan du jour seulement s'il est de ce jour-là).
    public static func notificationSoir(_ b: BilanSoirTour?, declenchement: Date,
                                        calendrier: Calendar = .current) -> (titre: String, corps: String) {
        let generique = "Fait, glissé, et ce qui reste pour demain : 30 secondes."
        guard let b, b.jour == cleJour(declenchement, calendrier: calendrier) else { return ("Bilan du soir", generique) }
        return ("Bilan du soir", b.phrase + " Touche pour faire le point.")
    }

    /// Tout ce qui reste → demain : UNE écriture (un seul « Annuler »).
    public static func versDemain(_ reste: [BilanSoirTour.Reste]) -> Proposition {
        Proposition(source: "motion", resume: "Bilan du soir : tout ce qui reste à demain",
                    actions: reste.map { ActionProposee(type: "modifier", nom: $0.titre,
                                                        echeance: Format.isoAvecFuseau($0.versDemain.date), id: $0.id) })
    }
}

extension Rangement {
    static let rituel = "rituel.json"
}

@MainActor
@Observable
public final class RituelModel {
    public private(set) var donnees: RituelTour?
    /// Quand la tour l'a calculé (ce qu'on dit à Sam).
    public private(set) var le: Date?
    public private(set) var erreur: String?
    public private(set) var chargement = false
    /// Les tâches poussées à demain depuis le bilan (retirées de l'écran).
    public private(set) var poussees: Set<String> = []
    public private(set) var bilanRange = false

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI
    @ObservationIgnored let rangement: Rangement?

    public init(api: ClientAPI, rangement: Rangement? = nil) {
        self.api = api
        self.rangement = rangement
        if let c = rangement?.copie(RituelTour.self, Rangement.rituel) {
            donnees = c.valeur
            le = c.le
        }
    }

    /// La tour sait-elle préparer le rendez-vous ?
    public var disponible: Bool { app?.serveur?.sait("rituel-v1") == true }

    /// Plus de 3 h : c'est dit, et l'écran propose de rafraîchir.
    public func perime(maintenant: Date = Date()) -> Bool {
        guard let le else { return true }
        return maintenant.timeIntervalSince(le) > Rituel.fraicheurMax
    }

    /// Le briefing de ce jour (ou nil s'il n'est pas encore calculé). Un
    /// iPhone dans un autre fuseau que la tour (voyage, simulateur) : le
    /// « aujourd'hui » de la tour vaut tant qu'il est frais.
    public func briefing(pour jour: Date = Date()) -> BriefingMatin? {
        guard let d = donnees else { return nil }
        if let b = Rituel.briefing(pour: jour, dans: d) { return b }
        return perime(maintenant: jour) ? nil : d.aujourdhui
    }

    /// Le bilan, s'il est bien celui d'aujourd'hui (ou tout frais de la tour).
    public func bilan(maintenant: Date = Date()) -> BilanSoirTour? {
        guard let s = donnees?.soir else { return nil }
        return s.jour == Rituel.cleJour(maintenant) || !perime(maintenant: maintenant) ? s : nil
    }

    public func charger() async {
        guard disponible, !chargement else { return }
        chargement = true
        defer { chargement = false }
        do {
            let r = try await api.rituel()
            garder(r, le: Date())
            erreur = nil
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreur = (error as? LocalizedError)?.errorDescription ?? "Rémy n'a pas pu préparer ton rendez-vous."
        }
    }

    func garder(_ r: RituelTour, le date: Date) {
        if r.soir?.jour != donnees?.soir?.jour { poussees = []; bilanRange = false }
        donnees = r
        le = date
        try? rangement?.garder(r, le: date, Rangement.rituel)
    }

    /// Hors de l'app (rafraîchissement en arrière-plan) : relu et gardé sur l'iPhone.
    public static func rafraichirEnFond(api: ClientAPI, rangement: Rangement?) async -> RituelTour? {
        guard let r = try? await api.rituel() else { return nil }
        try? rangement?.garder(r, le: Date(), Rangement.rituel)
        return r
    }

    public func vider() {
        donnees = nil
        le = nil
        erreur = nil
        poussees = []
        bilanRange = false
        rangement?.effacer(Rangement.rituel)
    }

    /// Bilan : tout ce qui reste part à demain, d'un geste, par la chaîne
    /// d'écriture (journal, Historique, « Annuler » dans le bandeau).
    @discardableResult
    public func toutADemain() async -> Bool {
        let reste = (bilan()?.reste ?? []).filter { !poussees.contains($0.id) }
        guard !reste.isEmpty else {
            _ = app?.dire("Rien ne reste pour aujourd'hui.")
            return false
        }
        do {
            let r = try await api.appliquer(Rituel.versDemain(reste), convId: nil, index: nil, idCommande: UUID().uuidString)
            let resultats = r.results ?? []
            let reussies: Int
            if resultats.isEmpty {
                reussies = (r.echecs ?? 0) == 0 ? reste.count : 0
            } else {
                reussies = resultats.filter { $0.ok != false }.count
            }
            guard reussies > 0 else {
                _ = app?.dire("Motion n'a rien déplacé : \(resultats.first?.erreur ?? "raison inconnue"). Réessaie.")
                return false
            }
            poussees.formUnion(reste.map(\.id))
            var annuler: (@MainActor () -> Void)? = nil
            if let ledger = r.ledgerId {
                annuler = { [weak self] in Task { await self?.annulerPoussee(ledger) } }
            }
            let echecs = reste.count - reussies
            _ = app?.dire("\(reussies) tâche\(reussies > 1 ? "s" : "") pour demain. Motion recalcule."
                          + (echecs > 0 ? " \(echecs) n'a pas pu partir." : ""), annuler: annuler, duree: 8)
            await app?.tableau.apresGeste()
            return true
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            if let e = error as? ErreurAPI, case .reseau = e {
                _ = app?.dire("Pas de réseau : rien n'a été déplacé. Réessaie quand Rémy est joignable.")
                return false
            }
            _ = app?.dire("Rien n'a été déplacé : \((error as? LocalizedError)?.errorDescription ?? "erreur").")
            return false
        }
    }

    private func annulerPoussee(_ ledger: String) async {
        do {
            let a = try await api.annuler(Proposition(source: "motion", resume: nil, actions: [], ledgerId: ledger))
            if a.ok == false {
                _ = app?.dire("Impossible de tout remettre à aujourd'hui : regarde l'Historique.")
            } else {
                poussees = []
                _ = app?.dire("Remis à aujourd'hui.")
            }
            await app?.tableau.apresGeste()
            await charger()
        } catch {
            app?.signaler(error)
        }
    }

    /// La ligne du soir (facultative), rangée pour la réflexion de nuit.
    @discardableResult
    public func rangerBilan(_ ressenti: String) async -> Bool {
        do {
            let r = try await api.envoyerBilan(ressenti.trimmingCharacters(in: .whitespacesAndNewlines))
            bilanRange = true
            _ = app?.dire(r.phrase ?? "Bilan rangé : Rémy le relira cette nuit.")
            return true
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            _ = app?.dire("Bilan pas rangé : \((error as? LocalizedError)?.errorDescription ?? "erreur") Ton texte est toujours là.")
            return false
        }
    }

    /// Captures de la CI seulement.
    public func montrerPourCapture(_ r: RituelTour) {
        donnees = r
        le = Date()
    }
}
