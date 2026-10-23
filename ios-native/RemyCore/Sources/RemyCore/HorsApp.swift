import Foundation
import Observation
#if canImport(ActivityKit) && os(iOS)
import ActivityKit
#endif

// MARK: - Rémy hors de l'app (24/10)
//
// Le widget « Maintenant », l'activité en direct (écran verrouillé, Dynamic
// Island) et Siri disent tous la même chose : la tâche en cours, ou la
// suivante. Le choix vit ici, testé une fois ; les vues ne font qu'afficher.

/// Ce qu'on montre de la journée, hors de l'app.
public struct ApercuMaintenant: Equatable, Sendable {
    public enum Genre: Equatable, Sendable {
        /// Une tâche ou un rendez-vous en ce moment (`debut`…`fin`).
        case enCours
        /// Rien en ce moment ; la suite commence à `debut`.
        case suivant
        /// Rien à heure fixe ; `total` tâches à faire aujourd'hui.
        case aFaire(total: Int)
        /// Plus rien de prévu ; `retards` tâches en retard.
        case libre(retards: Int)
        /// Ni Motion ni l'agenda ne sont branchés.
        case aucuneSource
        /// Branchés, mais rien ne répond.
        case enPanne
        /// Pas de jeton ni d'adresse : l'app n'a jamais été connectée ici.
        case nonConnecte
        /// La tour ne répond pas, et aucune journée d'aujourd'hui en réserve.
        case injoignable
    }

    public var genre: Genre
    public var titre: String?
    public var projet: String?
    public var debut: Date?
    public var fin: Date?
    public var rendezVous = false
    /// Ce qui suit l'élément en cours (titre, début), s'il y a.
    public var ensuite: (titre: String, debut: Date)?
    /// La journée vient d'une copie (tour injoignable) : son heure.
    public var copieDu: Date?

    public init(genre: Genre, titre: String? = nil, projet: String? = nil, debut: Date? = nil, fin: Date? = nil,
                rendezVous: Bool = false, ensuite: (titre: String, debut: Date)? = nil, copieDu: Date? = nil) {
        self.genre = genre
        self.titre = titre
        self.projet = projet
        self.debut = debut
        self.fin = fin
        self.rendezVous = rendezVous
        self.ensuite = ensuite
        self.copieDu = copieDu
    }

    public static func == (a: ApercuMaintenant, b: ApercuMaintenant) -> Bool {
        a.genre == b.genre && a.titre == b.titre && a.projet == b.projet && a.debut == b.debut && a.fin == b.fin
            && a.rendezVous == b.rendezVous && a.ensuite?.titre == b.ensuite?.titre && a.ensuite?.debut == b.ensuite?.debut
            && a.copieDu == b.copieDu
    }

    /// L'aperçu d'une journée à l'instant `maintenant`. Une copie d'un autre
    /// jour ne dit plus rien de juste : la tour est alors « injoignable ».
    public static func pour(_ j: Journee?, maintenant: Date, copieDu: Date? = nil) -> ApercuMaintenant {
        guard let j else { return ApercuMaintenant(genre: .injoignable) }
        if Jour.estPerimee(j, maintenant: maintenant) { return ApercuMaintenant(genre: .injoignable) }
        let ms = maintenant.millis
        var a: ApercuMaintenant
        switch Jour.prochain(j, maintenant: ms) {
        case .enCours(let e):
            a = ApercuMaintenant(genre: .enCours, titre: e.titre, projet: e.projet, debut: e.debut.date,
                                 fin: e.finEffective.date, rendezVous: e.estRendezVous)
            if let s = (j.items ?? []).first(where: { $0.id != e.id && Jour.etat($0, maintenant: ms) == .avenir }) {
                a.ensuite = (s.titre, s.debut.date)
            }
        case .suivant(let e):
            a = ApercuMaintenant(genre: .suivant, titre: e.titre, projet: e.projet, debut: e.debut.date,
                                 fin: e.finEffective.date, rendezVous: e.estRendezVous)
        case .aFaire(let t, let total):
            a = ApercuMaintenant(genre: .aFaire(total: total), titre: t.titre, projet: t.projet)
        case .rienDePrevu(let retards):
            a = ApercuMaintenant(genre: .libre(retards: retards))
        case .aucuneSource:
            a = ApercuMaintenant(genre: .aucuneSource)
        case .enPanne:
            a = ApercuMaintenant(genre: .enPanne)
        case .inconnu:
            a = ApercuMaintenant(genre: .injoignable)
        }
        a.copieDu = copieDu
        return a
    }

    /// Les instants où l'aperçu change (débuts et fins à venir), triés, sans
    /// doublon : le widget prépare une entrée pour chacun, sans réseau.
    public static func bornes(_ j: Journee?, depuis: Date, jusqua: Date, limite: Int = 24) -> [Date] {
        let ms = depuis.millis, fin = jusqua.millis
        var instants = Set<Millis>()
        for e in j?.items ?? [] {
            for t in [e.debut, e.finEffective] where t > ms && t <= fin { instants.insert(t) }
        }
        return instants.sorted().prefix(limite).map(\.date)
    }

    /// Ce que dit Siri (« Que dois-je faire maintenant ? »).
    public func phrase(maintenant: Date = Date()) -> String {
        var texte: String
        switch genre {
        case .enCours:
            let t = titre ?? "?"
            texte = "En ce moment : « \(t) »"
            if let fin {
                let reste = max(1, Int((fin.timeIntervalSince(maintenant) / 60).rounded(.up)))
                texte += ", jusqu'à \(Format.heure(fin)) (\(Format.duree(minutes: reste)) restantes)"
            }
            texte += "."
            if let s = ensuite { texte += " Ensuite : « \(s.titre) » à \(Format.heure(s.debut))." }
        case .suivant:
            texte = "Rien en cours. Ensuite : « \(titre ?? "?") »"
            if let debut { texte += " à \(Format.heure(debut)), \(Format.dansCombien(debut.timeIntervalSince(maintenant)))" }
            texte += "."
        case .aFaire(let total):
            texte = "Rien à heure fixe. À faire aujourd'hui : « \(titre ?? "?") »"
            if total > 1 { texte += ", et \(total - 1) autre\(total > 2 ? "s" : "")" }
            texte += "."
        case .libre(let retards):
            texte = "Plus rien de prévu aujourd'hui."
            if retards > 0 { texte += retards > 1 ? " \(retards) tâches sont en retard." : " Une tâche est en retard." }
        case .aucuneSource:
            texte = "Rémy ne voit pas encore ta journée : branche Motion ou ton agenda depuis le site."
        case .enPanne:
            texte = "Motion et ton agenda ne répondent pas pour l'instant. Réessaie dans un moment."
        case .nonConnecte:
            return ErreurPartage.nonConnecte.errorDescription ?? ""
        case .injoignable:
            return "Ta tour ne répond pas. Vérifie que Tailscale est allumé, puis réessaie."
        }
        if let c = copieDu {
            return "Ta tour ne répond pas ; d'après ta journée \(Format.depuis(c, maintenant: maintenant)) : " + texte
        }
        return texte
    }
}

// MARK: - L'activité en direct « tâche en cours »

/// Ce que l'activité en direct montre d'une tâche (ActivityKit sur l'iPhone).
/// Les attributs ne changent pas ; `Etat` suit la tâche (prolongée, finie).
public struct ActiviteTache: Codable, Hashable, Sendable {
    public var id: String
    public var titre: String
    public var projet: String?

    public struct Etat: Codable, Hashable, Sendable {
        public var debut: Date
        public var fin: Date
        /// La durée Motion (minutes), pour « +15 min » (valeur absolue envoyée).
        public var duree: Int?
        /// « Fait » s'affiche juste avant que l'activité se ferme.
        public var terminee: Bool
        /// Une phrase brève : « +15 min », « Pas de réseau… ». nil : rien.
        public var message: String?

        public init(debut: Date, fin: Date, duree: Int?, terminee: Bool = false, message: String? = nil) {
            self.debut = debut
            self.fin = max(fin, debut.addingTimeInterval(60))
            self.duree = duree
            self.terminee = terminee
            self.message = message
        }
    }

    public init(id: String, titre: String, projet: String?) {
        self.id = id
        self.titre = titre
        self.projet = projet
    }

    /// Une tâche Motion seulement (un rendez-vous ne se termine pas d'un geste).
    public static func depuis(_ e: ElementJour) -> (ActiviteTache, Etat)? {
        guard e.type == "tache" else { return nil }
        return (ActiviteTache(id: e.id, titre: e.titre, projet: e.projet),
                Etat(debut: e.debut.date, fin: e.finEffective.date, duree: e.duree))
    }

    /// La tâche telle que les gestes de l'app l'attendent (prolonger).
    public func element(_ etat: Etat) -> ElementJour {
        ElementJour(type: "tache", id: id, titre: titre, projet: projet, debut: etat.debut.millis,
                    fin: etat.fin.millis, duree: etat.duree)
    }
}

#if canImport(ActivityKit) && os(iOS)
extension ActiviteTache: ActivityAttributes {
    public typealias ContentState = Etat
}
#endif

/// Que faire de l'activité en direct, l'app ouverte : décidé ici, appliqué
/// par l'app (ActivityKit n'existe que sur l'iPhone).
public enum SuiviActivite {
    public enum Geste: Equatable, Sendable {
        /// Démarrer une activité pour cette tâche.
        case demarrer(ElementJour)
        /// La tâche suivie a changé (prolongée, décalée) : nouvelle fin.
        case mettreAJour(ElementJour)
        /// La tâche suivie n'est plus en cours (finie, cochée, l'heure passée).
        case terminer
    }

    /// La tâche Motion en cours (pas un rendez-vous), nil sinon.
    public static func tacheEnCours(_ j: Journee?, maintenant: Millis) -> ElementJour? {
        guard let j, j.sources?.aucune != true, j.sources?.enPanne != true else { return nil }
        guard case .enCours(let e) = Jour.prochain(j, maintenant: maintenant), e.type == "tache" else { return nil }
        return e
    }

    /// `suivie` : la tâche de l'activité en cours (id, fin), nil s'il n'y en a
    /// pas. `auto` : démarrer seule quand une tâche commence. `dejaVues` : les
    /// tâches déjà montrées (ou fermées par Sam), jamais relancées d'office.
    /// Sans journée (pas encore lue), rien ne bouge.
    public static func gestes(journee j: Journee?, maintenant: Millis, suivie: (id: String, fin: Date)?,
                              auto: Bool, dejaVues: Set<String>) -> [Geste] {
        guard j != nil else { return [] }
        let enCours = tacheEnCours(j, maintenant: maintenant)
        var gestes: [Geste] = []
        if let s = suivie {
            if let e = enCours, e.id == s.id {
                if abs(e.finEffective.date.timeIntervalSince(s.fin)) >= 1 { gestes.append(.mettreAJour(e)) }
                return gestes
            }
            gestes.append(.terminer)
        }
        if auto, let e = enCours, !dejaVues.contains(e.id) { gestes.append(.demarrer(e)) }
        return gestes
    }
}

// MARK: - Les intentions (Siri, widgets, activité en direct) parlent à l'app

/// Les intentions s'exécutent dans le processus de l'app : l'app s'y branche
/// au lancement. Dans une extension, tout reste nil (et rien ne s'y exécute).
@MainActor
public enum Raccourcis {
    /// Le modèle de l'app (nil tant que l'adresse de la tour est inconnue).
    public static weak var app: AppModel?
    /// « Terminer » sur l'activité en direct (id, titre).
    public static var terminer: ((String, String) async -> Void)?
    /// « +15 min » sur l'activité en direct (id, minutes).
    public static var prolonger: ((String, Int) async -> Void)?

    /// Une erreur dite à Sam par Siri : courte, avec quoi faire.
    nonisolated public static func phrase(_ erreur: Error) -> String {
        if let e = erreur as? ErreurAPI {
            switch e {
            case .nonConnecte: return "Rémy ne te reconnaît plus sur cet iPhone : ouvre l'app pour te reconnecter."
            case .reseau: return "Ta tour ne répond pas. Vérifie que Tailscale est allumé, puis réessaie."
            case .serveur(_, let m): return "Ta tour a refusé : \(m)"
            case .illisible: return "Réponse illisible de ta tour : réessaie."
            }
        }
        if let e = erreur as? ErreurPartage { return e.errorDescription ?? "Ouvre Rémy une fois pour te connecter." }
        return (erreur as? LocalizedError)?.errorDescription ?? "Ça n'a pas marché : réessaie."
    }
}
