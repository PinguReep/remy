import Foundation
import Observation

// MARK: - Demain et les 7 jours (24/10)
//
// « On ne voit que la journée en cours » : la tour lit Motion et l'agenda
// pour les jours qui viennent (GET /api/semaine, sans IA, capacité
// semaine-v1). L'app garde la dernière vue reçue, datée, pour l'afficher
// hors ligne comme la journée. Tout s'efface à la déconnexion.

/// GET /api/semaine : un jour par entrée, à partir d'aujourd'hui.
public struct Semaine: Codable, Sendable, Equatable {
    public var maintenant: Millis?
    public var aujourdhui: String?
    public var jours: [JourSemaine]
    /// Le nom de l'horaire Motion qui donne les heures disponibles (nil : inconnu).
    public var horaires: String?
    public var sources: Sources?
    public var motion: EtatMotion?
    public var illisibles: [String] = []

    enum CodingKeys: String, CodingKey { case maintenant, aujourdhui, jours, horaires, sources, motion }

    public init(maintenant: Millis? = nil, aujourdhui: String? = nil, jours: [JourSemaine], horaires: String? = nil,
                sources: Sources? = nil, motion: EtatMotion? = nil) {
        self.maintenant = maintenant
        self.aujourdhui = aujourdhui
        self.jours = jours
        self.horaires = horaires
        self.sources = sources
        self.motion = motion
    }
}

extension Semaine {
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var i: [String] = []
        maintenant = c.souple(Millis.self, .maintenant, &i)
        aujourdhui = c.souple(String.self, .aujourdhui, &i)
        jours = c.listeSouple(JourSemaine.self, .jours, &i) ?? []
        horaires = c.souple(String.self, .horaires, &i)
        sources = c.souple(Sources.self, .sources, &i)
        motion = c.souple(EtatMotion.self, .motion, &i)
        illisibles = i
    }
}

/// Une échéance du jour : placée à temps par Motion, ou menacée (placée après,
/// ou pas placée du tout).
public struct EcheanceJour: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var titre: String
    public var echeance: Millis?
    public var projet: String?
    public var priorite: String?
    public var duree: Int?
    public var placee: Bool?
    public var menacee: Bool?
    public var bloquee: Bool?
    public var raison: String?
    public var etiquettes: [String]?

    public init(id: String, titre: String, echeance: Millis? = nil, projet: String? = nil, duree: Int? = nil,
                placee: Bool? = nil, menacee: Bool? = nil) {
        self.id = id
        self.titre = titre
        self.echeance = echeance
        self.projet = projet
        self.duree = duree
        self.placee = placee
        self.menacee = menacee
    }
}

/// Heures de tâches placées contre heures disponibles (horaires Motion moins
/// les rendez-vous), en minutes.
public struct ChargeJour: Codable, Sendable, Equatable {
    public var taches: Int
    public var rdv: Int
    /// Les heures de travail du jour (nil : horaires Motion inconnus).
    public var travail: Int?
    public var disponible: Int?

    public init(taches: Int, rdv: Int = 0, travail: Int? = nil, disponible: Int? = nil) {
        self.taches = taches
        self.rdv = rdv
        self.travail = travail
        self.disponible = disponible
    }

    public enum Niveau: Equatable, Sendable { case libre, leger, charge, deborde }

    /// Libre (rien de placé), léger, chargé (80 % du disponible ou plus),
    /// débordé (plus que le disponible). Sans horaires connus : au-delà de 8 h.
    public var niveau: Niveau {
        guard taches > 0 else { return .libre }
        guard let d = disponible else { return taches > 8 * 60 ? .charge : .leger }
        if taches > d { return .deborde }
        return Double(taches) >= Double(d) * 0.8 ? .charge : .leger
    }

    /// Entre 0 et 1 : la part du disponible déjà prise (1 si ça déborde).
    public var remplissage: Double {
        guard let d = disponible else { return min(1, Double(taches) / Double(8 * 60)) }
        guard d > 0 else { return taches > 0 ? 1 : 0 }
        return min(1, Double(taches) / Double(d))
    }

    /// « 4 h 30 prévues sur 7 h libres », « 2 h prévues », « Rien de prévu ».
    public var phrase: String {
        let prevu = taches > 0 ? "\(Format.duree(minutes: taches)) prévue\(taches >= 120 ? "s" : "")" : "Rien de prévu"
        guard let d = disponible else { return prevu }
        if d == 0 { return taches > 0 ? prevu + ", hors horaires" : "Pas d'horaires de travail" }
        return prevu + " sur \(Format.duree(minutes: d)) libre\(d >= 120 ? "s" : "")"
    }
}

public struct JourSemaine: Codable, Sendable, Equatable, Identifiable {
    /// « 2026-10-26 »
    public var jour: String
    public var debut: Millis
    public var fin: Millis?
    public var items: [ElementJour]
    public var toute: [ElementJourneeEntiere]
    public var echeances: [EcheanceJour]
    /// Tâches que Motion place après leur échéance.
    public var deborde: [TacheResume]
    public var charge: ChargeJour?
    public var illisibles: [String] = []

    public var id: String { jour }

    enum CodingKeys: String, CodingKey { case jour, debut, fin, items, toute, echeances, deborde, charge }

    public init(jour: String, debut: Millis, fin: Millis? = nil, items: [ElementJour] = [], toute: [ElementJourneeEntiere] = [],
                echeances: [EcheanceJour] = [], deborde: [TacheResume] = [], charge: ChargeJour? = nil) {
        self.jour = jour
        self.debut = debut
        self.fin = fin
        self.items = items
        self.toute = toute
        self.echeances = echeances
        self.deborde = deborde
        self.charge = charge
    }

    public var date: Date { debut.date }

    /// Les rendez-vous à heure fixe (le cadenas : Motion place autour).
    public var rendezVous: [ElementJour] { items.filter(\.estRendezVous) }
    public var taches: [ElementJour] { items.filter { !$0.estRendezVous } }

    /// « Lun 26 »
    public var titreCourt: String {
        let nom = Format.jourSemaine(date)
        let jourDuMois = Format.calendrier.component(.day, from: date)
        return nom.prefix(1).uppercased() + nom.dropFirst().prefix(2) + " \(jourDuMois)"
    }

    /// « Lundi 26 octobre »
    public var titreLong: String { Format.jourTitre(date) }

    /// Ce qui mérite un signe dans la vue compacte : échéance menacée ou tâche
    /// placée après son échéance.
    public var menaces: Int {
        let ids = Set(deborde.map(\.id))
        return deborde.count + echeances.filter { $0.menacee == true && !ids.contains($0.id) }.count
    }

    /// Rien du tout ce jour-là.
    public var estVide: Bool { items.isEmpty && toute.isEmpty && echeances.isEmpty }

    /// La journée telle que l'accueil la lit (frise à l'échelle, impact d'une
    /// prolongation dans « Gérer »).
    public var journee: Journee {
        Journee(jour: jour, items: items, toute: toute,
                aFaire: echeances.filter { $0.placee != true }.map {
                    TacheResume(id: $0.id, titre: $0.titre, echeance: $0.echeance, projet: $0.projet, priorite: $0.priorite,
                                bloquee: $0.bloquee, raison: $0.raison, duree: $0.duree)
                })
    }
}

extension JourSemaine {
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var i: [String] = []
        jour = try c.decode(String.self, forKey: .jour)
        debut = try c.decode(Millis.self, forKey: .debut)
        fin = c.souple(Millis.self, .fin, &i)
        items = c.listeSouple(ElementJour.self, .items, &i) ?? []
        toute = c.listeSouple(ElementJourneeEntiere.self, .toute, &i) ?? []
        echeances = c.listeSouple(EcheanceJour.self, .echeances, &i) ?? []
        deborde = c.listeSouple(TacheResume.self, .deborde, &i) ?? []
        charge = c.souple(ChargeJour.self, .charge, &i)
        illisibles = i
    }
}

extension Rangement {
    static let semaine = "semaine.json"
}

extension ClientAPI {
    /// Les `jours` à venir, aujourd'hui compris (semaine-v1).
    public func semaine(jours: Int = 7) async throws -> Semaine {
        try await json(Semaine.self, "api/semaine?jours=\(jours)", delai: 20)
    }
}

/// La vue « À l'échelle » : Aujourd'hui, Demain ou les 7 jours.
public enum PorteeEchelle: Hashable, Sendable {
    case aujourdhui, demain, semaine
    /// Un jour choisi dans les 7 jours (« 2026-10-28 »).
    case jour(String)
}

@MainActor
@Observable
public final class SemaineModel {
    public private(set) var donnees: Semaine?
    public private(set) var misAJour: Date?
    public private(set) var chargement = false
    public private(set) var erreur: String?
    public private(set) var erreurReseau = false
    /// La vue affichée vient de l'iPhone (dernière reçue), pas encore relue.
    public private(set) var copieLocale = false

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI
    @ObservationIgnored let rangement: Rangement?

    public init(api: ClientAPI, rangement: Rangement? = nil) {
        self.api = api
        self.rangement = rangement
        if let c = rangement?.copie(Semaine.self, Rangement.semaine) {
            donnees = c.valeur
            misAJour = c.le
            copieLocale = true
        }
    }

    /// La tour sait rendre les jours qui viennent.
    public var disponible: Bool { app?.serveur?.sait("semaine-v1") == true }

    public func charger() async {
        guard disponible, !chargement else { return }
        chargement = true
        defer { chargement = false }
        do {
            let s = try await api.semaine()
            let le = Date()
            donnees = s
            misAJour = le
            copieLocale = false
            erreur = nil
            erreurReseau = false
            try? rangement?.garder(s, le: le, Rangement.semaine)
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            if case ErreurAPI.reseau = error { erreurReseau = true } else { erreurReseau = false }
            erreur = (error as? LocalizedError)?.errorDescription ?? "Semaine illisible."
        }
    }

    /// Déconnexion, ou appareil plus reconnu : rien ne reste.
    public func vider() {
        donnees = nil
        misAJour = nil
        copieLocale = false
        erreur = nil
        erreurReseau = false
        rangement?.effacer(Rangement.semaine)
    }

    /// Les jours à afficher, à partir d'aujourd'hui (une copie d'hier perd
    /// son premier jour), sans les tâches cochées depuis l'app.
    public func jours(maintenant: Date = Date()) -> [JourSemaine] {
        let aujourdhui = Format.jourISO(maintenant)
        let cochees = Set(app?.tableau.cochees.map(\.id) ?? [])
        return (donnees?.jours ?? []).filter { $0.jour >= aujourdhui }.map { j in
            guard !cochees.isEmpty else { return j }
            var j = j
            j.items = j.items.filter { !($0.type == "tache" && cochees.contains($0.id)) }
            j.echeances = j.echeances.filter { !cochees.contains($0.id) }
            j.deborde = j.deborde.filter { !cochees.contains($0.id) }
            return j
        }
    }

    public func jour(_ iso: String, maintenant: Date = Date()) -> JourSemaine? {
        jours(maintenant: maintenant).first { $0.jour == iso }
    }

    /// « 2026-10-25 » quand on est le 24 (heure de Sam).
    nonisolated public static func demainISO(_ maintenant: Date = Date()) -> String {
        let cal = Format.calendrier
        let d = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: maintenant)) ?? maintenant.addingTimeInterval(86_400)
        return Format.jourISO(d)
    }

    public func demain(maintenant: Date = Date()) -> JourSemaine? {
        jour(Self.demainISO(maintenant), maintenant: maintenant)
    }

    /// La journée qui contient cet élément, s'il n'est pas d'aujourd'hui : pour
    /// que « Gérer » estime une prolongation avec les bons voisins.
    public func journee(contenant e: ElementJour, maintenant: Date = Date()) -> Journee? {
        let iso = Format.jourISO(e.debut.date)
        guard iso != Format.jourISO(maintenant) else { return nil }
        return jour(iso, maintenant: maintenant)?.journee
    }

    /// Le bandeau de la vue : copie ancienne, tour injoignable (nil : rien à dire).
    public func etat(maintenant: Date = Date()) -> String? {
        guard let le = misAJour else { return nil }
        if erreurReseau || (copieLocale && erreur != nil) {
            return "Vue \(Format.depuis(le, maintenant: maintenant)) : la tour ne répond pas. Tailscale est-il actif ?"
        }
        if erreur != nil { return "Vue \(Format.depuis(le, maintenant: maintenant)) : \(erreur ?? "")" }
        if copieLocale { return "Vue \(Format.depuis(le, maintenant: maintenant)), mise à jour…" }
        return nil
    }
}
