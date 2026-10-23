import Foundation

// MARK: - Les gestes en un toucher (24/10, ergonomie de l'iPhone)
//
// Décaler une tâche, reporter un rappel, accepter une partie d'une
// proposition : les choix sont calculés ici, sans réseau, avec l'heure de
// l'iPhone (fuseau de Format). Les écrans ne font que les afficher.

/// Un choix de la rangée « Décaler » (Gérer) ou « Quand ? » (rappel).
public struct ChoixDate: Identifiable, Hashable, Sendable {
    /// Stable d'un affichage à l'autre (« demain », « plus-15 »…).
    public let id: String
    public let libelle: String
    /// La nouvelle échéance (tâche Motion), la nouvelle heure (activité de
    /// l'agenda) ou le nouveau moment du rappel.
    public let date: Date

    public init(id: String, libelle: String, date: Date) {
        self.id = id
        self.libelle = libelle
        self.date = date
    }
}

public enum Decaler {
    /// Une tâche Motion ne se décale QUE par son échéance : Motion choisit
    /// l'heure. En retard : « Aujourd'hui » d'abord ; puis demain, lundi (ou
    /// dans une semaine quand lundi est demain).
    public static func tache(echeance: Millis?, maintenant: Date = Date()) -> [ChoixDate] {
        let aujourdhui = Format.debutDuJour(maintenant)
        var choix: [ChoixDate] = []
        if let e = echeance, e.date < aujourdhui {
            choix.append(ChoixDate(id: "aujourdhui", libelle: "Aujourd'hui", date: Format.echeanceDans(jours: 0, depuis: maintenant)))
        }
        choix.append(ChoixDate(id: "demain", libelle: "Demain", date: Format.echeanceDans(jours: 1, depuis: maintenant)))
        let lundi = joursJusquaLundi(maintenant)
        if lundi > 1 {
            choix.append(ChoixDate(id: "lundi", libelle: "Lundi", date: Format.echeanceDans(jours: lundi, depuis: maintenant)))
        } else {
            choix.append(ChoixDate(id: "semaine", libelle: "Dans 1 sem.", date: Format.echeanceDans(jours: 7, depuis: maintenant)))
        }
        return choix
    }

    /// Une activité à soi (« Aspirateur ») se décale à l'heure : +15 min,
    /// +1 h, ce soir (19:00, si c'est encore plus tard), demain même heure.
    public static func activite(_ e: ElementJour, maintenant: Date = Date()) -> [ChoixDate] {
        let debut = e.debut.date
        // Déjà commencée : on décale à partir de maintenant, pas du passé.
        let base = max(debut, maintenant)
        var choix = [
            ChoixDate(id: "plus-15", libelle: "+15 min", date: arrondi(base.addingTimeInterval(15 * 60))),
            ChoixDate(id: "plus-60", libelle: "+1 h", date: arrondi(base.addingTimeInterval(3600))),
        ]
        if let soir = a(19, 0, jours: 0, depuis: maintenant), soir > base.addingTimeInterval(3600) {
            choix.append(ChoixDate(id: "ce-soir", libelle: "Ce soir", date: soir))
        }
        if let demain = Format.calendrier.date(byAdding: .day, value: 1, to: debut) {
            choix.append(ChoixDate(id: "demain", libelle: "Demain", date: demain))
        }
        return choix
    }

    /// Reporter un rappel : dans 1 h, ce soir 19:00 (avant 18 h), demain 9:00,
    /// lundi 9:00 (quand lundi n'est pas demain).
    public static func rappel(maintenant: Date = Date()) -> [ChoixDate] {
        var choix = [ChoixDate(id: "plus-60", libelle: "Dans 1 h", date: arrondi(maintenant.addingTimeInterval(3600)))]
        if Format.minuteDuJour(maintenant) < 18 * 60, let soir = a(19, 0, jours: 0, depuis: maintenant) {
            choix.append(ChoixDate(id: "ce-soir", libelle: "Ce soir 19:00", date: soir))
        }
        if let demain = a(9, 0, jours: 1, depuis: maintenant) {
            choix.append(ChoixDate(id: "demain", libelle: "Demain 9:00", date: demain))
        }
        let lundi = joursJusquaLundi(maintenant)
        if lundi > 1, let l = a(9, 0, jours: lundi, depuis: maintenant) {
            choix.append(ChoixDate(id: "lundi", libelle: "Lundi 9:00", date: l))
        }
        return choix
    }

    /// 1 (lundi est demain) à 7 (on est lundi : le suivant).
    static func joursJusquaLundi(_ d: Date) -> Int {
        let jour = Format.calendrier.component(.weekday, from: d) // 1 = dimanche, 2 = lundi
        let n = (2 - jour + 7) % 7
        return n == 0 ? 7 : n
    }

    /// Une heure ronde dans le fuseau de Sam, `jours` jours plus tard.
    static func a(_ h: Int, _ m: Int, jours: Int, depuis d: Date) -> Date? {
        let cal = Format.calendrier
        guard let jour = cal.date(byAdding: .day, value: jours, to: cal.startOfDay(for: d)) else { return nil }
        return cal.date(bySettingHour: h, minute: m, second: 0, of: jour)
    }

    /// Au quart d'heure inférieur : « 15:00 », pas « 15:07 ».
    static func arrondi(_ d: Date) -> Date {
        let minute = Format.calendrier.component(.minute, from: d)
        let seconde = Format.calendrier.component(.second, from: d)
        return d.addingTimeInterval(-Double((minute % 15) * 60 + seconde))
    }
}

// MARK: - Les actions d'une notification de rappel

/// « Fait », « Dans 1 h », « Demain » sous la notification d'un rappel.
/// Les identifiants sont ceux de la catégorie déclarée à iOS.
public enum ActionRappel: String, CaseIterable, Sendable {
    case fait = "rappel.fait"
    case dansUneHeure = "rappel.1h"
    case demain = "rappel.demain"

    public static let categorie = "rappel"
    public static let prefixe = "rappel-"

    public var libelle: String {
        switch self {
        case .fait: return "Fait"
        case .dansUneHeure: return "Dans 1 h"
        case .demain: return "Demain 9:00"
        }
    }

    /// Le nouveau moment du rappel (nil : il est fait).
    public func report(maintenant: Date = Date()) -> Date? {
        switch self {
        case .fait: return nil
        case .dansUneHeure: return Decaler.arrondi(maintenant.addingTimeInterval(3600))
        case .demain: return Decaler.a(9, 0, jours: 1, depuis: maintenant)
        }
    }

    /// L'identifiant du rappel caché dans celui de la notification.
    public static func rappel(dansNotification id: String) -> String? {
        id.hasPrefix(prefixe) ? String(id.dropFirst(prefixe.count)) : nil
    }
}

// MARK: - Une partie d'une proposition (une case par ligne)

public enum SelectionLignes {
    /// Les rangs à envoyer : ceux des lignes encore cochées (rang d'origine si
    /// la tour l'a donné, sinon la position). nil : tout part (rien de décoché).
    public static func rangs(_ actions: [ActionProposee], decoches: Set<Int>) -> [Int]? {
        let tous = actions.enumerated().map { $0.element.rang ?? $0.offset }
        let gardes = tous.filter { !decoches.contains($0) }
        return gardes.count == tous.count ? nil : gardes
    }

    /// « Oui, fais-le » ; « Oui, les 2 » ; « Oui, celle-ci » ; rien coché : « Rien de coché ».
    public static func libelle(total: Int, gardes: Int) -> String {
        if gardes == total { return "Oui, fais-le" }
        if gardes == 0 { return "Rien de coché" }
        return gardes == 1 ? "Oui, celle-ci" : "Oui, les \(gardes)"
    }
}

// MARK: - Une tâche sans créneau dans « Gérer »

extension ElementJour {
    /// Une tâche « à faire » ou en retard (pas encore placée par Motion),
    /// ouverte dans le même panneau « Gérer » que les tâches du planning.
    public static func sansCreneau(_ t: TacheResume, retard: Bool, maintenant: Date = Date()) -> ElementJour {
        var e = ElementJour(type: "sans-creneau", id: t.id, titre: t.titre, projet: t.projet, priorite: t.priorite,
                            debut: maintenant.millis, retard: retard, duree: t.duree, echeance: t.echeance)
        e.bloquee = t.bloquee
        e.raison = t.raison
        e.etiquettes = t.etiquettes
        return e
    }

    /// Pas de créneau : ni horaire, ni « prolonger ».
    public var sansCreneau: Bool { type == "sans-creneau" }

    /// La tâche telle que la liste « à faire » la décrit (brouillons de Rémy).
    public var resume: TacheResume {
        var t = TacheResume(id: id, titre: titre, echeance: echeance, projet: projet, priorite: priorite,
                            bloquee: bloquee, raison: raison, duree: duree)
        t.etiquettes = etiquettes
        return t
    }
}
