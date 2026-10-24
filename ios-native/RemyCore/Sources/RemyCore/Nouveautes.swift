import Foundation
import Observation

// MARK: - Les nouveautés (21/10)
//
// À chaque mise à jour qui apporte une fonction visible, un mini tutoriel de
// deux ou trois pages, une fois, au lancement suivant — jamais par-dessus une
// saisie, et seulement quand la tour connaît la fonction (sinon elle est
// encore cachée). Réglages › Nouveautés garde l'historique pour le revoir.
//
// Une nouvelle fonction = une entrée ici, avec la série suivante
// (CLAUDE.md, Definition of Done).

public struct Nouveaute: Identifiable, Equatable, Sendable {
    public struct Page: Equatable, Sendable {
        public let symbole: String
        public let titre: String
        public let texte: String
    }
    public let id: String
    /// Une série par mise à jour : 1, 2, 3… (pas le numéro de build).
    public let serie: Int
    public let date: String
    public let titre: String
    /// La fonction n'existe que si la tour la connaît.
    public let capacite: String?
    public let pages: [Page]
}

public enum Nouveautes {
    public static let catalogue: [Nouveaute] = [
        Nouveaute(id: "semaine", serie: 3, date: "24 oct.", titre: "Demain et les 7 jours", capacite: "semaine-v1", pages: [
            .init(symbole: "calendar.day.timeline.left", titre: "« À l'échelle », à côté de LA SUITE",
                  texte: "Aujourd'hui, Demain ou 7 jours. Demain s'affiche en entier, à l'échelle, avec les mêmes gestes : toucher une tâche ouvre « Gérer »."),
            .init(symbole: "chart.bar.xaxis", titre: "La semaine d'un coup d'œil",
                  texte: "Par jour : les heures prévues contre tes heures libres, les rendez-vous, les échéances, et ce que Motion place trop tard. Lu dans Motion et ton agenda, sans IA."),
            .init(symbole: "wifi.slash", titre: "Même sans réseau",
                  texte: "La dernière vue reçue reste sur l'iPhone, datée. Toucher un jour l'ouvre à l'échelle."),
        ]),
        Nouveaute(id: "modele", serie: 2, date: "21 oct.", titre: "Choisis le modèle de Rémy", capacite: "modeles-v1", pages: [
            .init(symbole: "cpu", titre: "Rémy suit tes Sparks",
                  texte: "Quand tu charges un autre modèle sur tes Sparks, Rémy le suit tout seul. Son nom s'affiche sous chaque réponse et dans la jauge."),
            .init(symbole: "slider.horizontal.3", titre: "Ou fixe-le toi-même",
                  texte: "Réglages › Modèle : garde « Automatique », ou choisis un modèle parmi ceux que tes Sparks servent. Claude n'est pas dans la liste : tes conversations restent chez toi."),
        ]),
        Nouveaute(id: "lieux", serie: 2, date: "21 oct.", titre: "Rémy sait où tu en es", capacite: "lieux-v1", pages: [
            .init(symbole: "location", titre: "Coupée tant que tu ne l'allumes pas",
                  texte: "Réglages › Localisation. iOS détecte tes arrivées et départs presque sans batterie : choisis « Toujours » quand il te le demande."),
            .init(symbole: "storefront", titre: "Le coiffeur, le drive, la salle",
                  texte: "Les adresses et les commerces sont reconnus sur ta tour : « sans doute Salon Lumière (coiffeur) ». Aucune position ne part ailleurs."),
            .init(symbole: "mappin.and.ellipse", titre: "Nomme tes lieux",
                  texte: "Touche un lieu pour le nommer. « Pause 2 h » n'enregistre rien, et tout s'efface d'un geste. Gardé 90 jours, puis effacé."),
        ]),
        Nouveaute(id: "jauge", serie: 1, date: "20 oct.", titre: "La jauge du contexte", capacite: "jauge-v1", pages: [
            .init(symbole: "gauge.with.dots.needle.33percent", titre: "Ce que Rémy a en tête",
                  texte: "Le cadran, en haut du chat, montre la place prise dans la mémoire de travail du modèle. Les tokens par seconde s'affichent pendant qu'il écrit."),
            .init(symbole: "hand.tap", titre: "Touche-le",
                  texte: "La place prise et d'où elle vient, la vitesse de la dernière réponse, la moyenne du fil, et le modèle qui a répondu."),
        ]),
        Nouveaute(id: "compactage", serie: 1, date: "20 oct.", titre: "Les longues conversations se compactent", capacite: "compactage-v1", pages: [
            .init(symbole: "rectangle.compress.vertical", titre: "Rien n'est effacé",
                  texte: "Dès 70 % du contexte, le modèle local résume le début du fil pour continuer. À la demande aussi, depuis la jauge."),
        ]),
        Nouveaute(id: "regles", serie: 1, date: "20 oct.", titre: "Les règles de Rémy", capacite: "regles-v1", pages: [
            .init(symbole: "arrow.triangle.branch", titre: "Avant X, fais Y",
                  texte: "Dis-lui « avant une sortie, propose-moi de me raser » : il te propose une règle. Ensuite, il relit ton agenda et te propose la tâche — jamais sans ton « Oui »."),
        ]),
        Nouveaute(id: "selection", serie: 1, date: "20 oct.", titre: "Sélectionner du texte", capacite: nil, pages: [
            .init(symbole: "text.cursor", titre: "Appui long sur une bulle",
                  texte: "« Sélectionner le texte » : la vraie sélection d'iOS, sur tes messages comme sur ceux de Rémy. Une erreur montre son code et « Copier le diagnostic »."),
        ]),
    ]

    /// Au plus, pour ne pas transformer une mise à jour en cours magistral.
    static let pagesMax = 6
}

/// Les nouveautés à montrer d'un coup (une feuille), dans l'ordre.
public struct LotNouveautes: Identifiable, Equatable, Sendable {
    public let id: String
    public let entrees: [Nouveaute]
    public var pages: [(nouveaute: Nouveaute, page: Nouveaute.Page)] {
        Array(entrees.flatMap { n in n.pages.map { (n, $0) } }.prefix(Nouveautes.pagesMax))
    }
    public static func == (a: LotNouveautes, b: LotNouveautes) -> Bool { a.id == b.id && a.entrees == b.entrees }
}

@MainActor
@Observable
public final class NouveautesModel {
    /// La feuille à montrer (nil : rien).
    public private(set) var affichees: LotNouveautes?
    public private(set) var vues: Set<String>

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let reglages: UserDefaults
    @ObservationIgnored let catalogue: [Nouveaute]
    static let cleVues = "nouveautes.vues"

    public init(reglages: UserDefaults = .standard, catalogue: [Nouveaute] = Nouveautes.catalogue) {
        self.reglages = reglages
        self.catalogue = catalogue
        if let liste = reglages.stringArray(forKey: Self.cleVues) {
            vues = Set(liste)
        } else {
            // Premier lancement avec les nouveautés : seules celles de la
            // dernière mise à jour sont nouvelles ; les autres, à l'historique.
            let derniere = catalogue.map(\.serie).max() ?? 0
            vues = Set(catalogue.filter { $0.serie < derniere }.map(\.id))
            reglages.set(Array(vues).sorted(), forKey: Self.cleVues)
        }
    }

    /// La tour connaît la fonction (sinon elle est encore cachée dans l'app).
    public func existe(_ n: Nouveaute) -> Bool {
        n.capacite.map { app?.serveur?.sait($0) == true } ?? true
    }

    /// L'historique (Réglages › Nouveautés) : la plus récente d'abord.
    public var historique: [Nouveaute] {
        catalogue.enumerated().sorted { a, b in a.element.serie != b.element.serie ? a.element.serie > b.element.serie : a.offset < b.offset }.map(\.element)
    }

    public func estNouvelle(_ n: Nouveaute) -> Bool { !vues.contains(n.id) }

    /// Au retour au premier plan : les nouveautés pas encore vues, dont la
    /// tour connaît la fonction. Rien si une feuille est déjà là.
    public func verifier() {
        guard affichees == nil else { return }
        let a = catalogue.filter { !vues.contains($0.id) && existe($0) }.sorted { $0.serie < $1.serie }
        guard !a.isEmpty else { return }
        affichees = LotNouveautes(id: a.map(\.id).joined(separator: "+"), entrees: a)
    }

    /// Revoir un tutoriel depuis l'historique (Réglages › Nouveautés).
    public func lot(pour n: Nouveaute) -> LotNouveautes {
        LotNouveautes(id: "revoir-\(n.id)", entrees: [n])
    }

    /// Un tutoriel parcouru, ou fermé : vu, plus de rappel.
    public func marquerVues(_ lot: LotNouveautes) {
        vues.formUnion(lot.entrees.map(\.id))
        reglages.set(Array(vues).sorted(), forKey: Self.cleVues)
    }

    /// La feuille du lancement fermée (finie, « Plus tard » ou balayée).
    public func fermer() {
        guard let a = affichees else { return }
        marquerVues(a)
        affichees = nil
    }

    /// Captures de la CI seulement.
    public func montrerPourCapture(_ ids: [String]) {
        let e = catalogue.filter { ids.contains($0.id) }
        affichees = e.isEmpty ? nil : LotNouveautes(id: "capture", entrees: e)
    }
}
