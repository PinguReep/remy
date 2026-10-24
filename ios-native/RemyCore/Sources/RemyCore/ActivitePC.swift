import Foundation
import Observation

// MARK: - L'activité du PC (activite-pc-v1, 24/10)
//
// ActivityWatch, installé sur la tour, note l'application au premier plan. La
// tour n'en garde que le temps ACTIF par application et par catégorie (et par
// domaine pour le navigateur) : jamais un titre de fenêtre. Coupée par défaut ;
// rien ne sort de la tour. Ici : l'afficher, l'allumer, exclure une appli, tout effacer.

public struct DureeCategorie: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var nom: String
    public var secondes: Double

    public init(id: String, nom: String, secondes: Double) {
        self.id = id
        self.nom = nom
        self.secondes = secondes
    }

    enum CodingKeys: String, CodingKey { case id, nom, secondes }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        nom = (try? c.decodeIfPresent(String.self, forKey: .nom)) ?? id
        secondes = (try? c.decodeIfPresent(Double.self, forKey: .secondes)) ?? 0
    }
}

public struct DureeAppli: Codable, Equatable, Identifiable, Sendable {
    /// L'exécutable sans « .exe », en minuscules : ce qu'on exclut.
    public var nom: String
    public var libelle: String
    public var categorie: String?
    public var secondes: Double
    public var id: String { nom }

    public init(nom: String, libelle: String, categorie: String?, secondes: Double) {
        self.nom = nom
        self.libelle = libelle
        self.categorie = categorie
        self.secondes = secondes
    }

    enum CodingKeys: String, CodingKey { case nom, libelle, categorie, secondes }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        nom = try c.decode(String.self, forKey: .nom)
        libelle = (try? c.decodeIfPresent(String.self, forKey: .libelle)) ?? nom
        categorie = try? c.decodeIfPresent(String.self, forKey: .categorie)
        secondes = (try? c.decodeIfPresent(Double.self, forKey: .secondes)) ?? 0
    }
}

public struct DureeDomaine: Codable, Equatable, Identifiable, Sendable {
    public var nom: String
    public var secondes: Double
    public var id: String { nom }

    public init(nom: String, secondes: Double) {
        self.nom = nom
        self.secondes = secondes
    }
}

public struct DureeJour: Codable, Equatable, Identifiable, Sendable {
    public var jour: String
    public var secondes: Double
    public var id: String { jour }

    public init(jour: String, secondes: Double) {
        self.jour = jour
        self.secondes = secondes
    }
}

/// Aujourd'hui, ou les 7 derniers jours.
public struct BilanActivite: Codable, Equatable, Sendable {
    public var total: Double
    public var categories: [DureeCategorie]
    public var applis: [DureeAppli]
    public var domaines: [DureeDomaine]
    public var parJour: [DureeJour]?

    public init(total: Double, categories: [DureeCategorie], applis: [DureeAppli], domaines: [DureeDomaine] = [], parJour: [DureeJour]? = nil) {
        self.total = total
        self.categories = categories
        self.applis = applis
        self.domaines = domaines
        self.parJour = parJour
    }

    public static let vide = BilanActivite(total: 0, categories: [], applis: [])

    enum CodingKeys: String, CodingKey { case total, categories, applis, domaines, parJour }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        total = (try? c.decodeIfPresent(Double.self, forKey: .total)) ?? 0
        categories = (try? c.decodeIfPresent([DureeCategorie].self, forKey: .categories)) ?? []
        applis = (try? c.decodeIfPresent([DureeAppli].self, forKey: .applis)) ?? []
        domaines = (try? c.decodeIfPresent([DureeDomaine].self, forKey: .domaines)) ?? []
        parJour = try? c.decodeIfPresent([DureeJour].self, forKey: .parJour)
    }

    /// La part d'une durée dans la plus longue catégorie (0…1), pour les barres.
    public func part(_ secondes: Double) -> Double {
        let max = categories.map(\.secondes).max() ?? 0
        return max > 0 ? min(1, secondes / max) : 0
    }
}

public struct EtatActivityWatch: Codable, Equatable, Sendable {
    /// nil : jamais essayé (coupée depuis toujours).
    public var joignable: Bool?
    public var version: String?
    public var fenetre: Bool?
    public var afk: Bool?
    public var web: Bool?
    public var message: String?

    public init(joignable: Bool?, version: String? = nil, fenetre: Bool? = nil, afk: Bool? = nil, web: Bool? = nil, message: String? = nil) {
        self.joignable = joignable
        self.version = version
        self.fenetre = fenetre
        self.afk = afk
        self.web = web
        self.message = message
    }
}

public struct VueActivitePC: Codable, Equatable, Sendable {
    public var actif: Bool
    public var coupeParLaTour: Bool
    public var activitywatch: EtatActivityWatch
    public var derniereCollecte: Millis?
    public var releveMin: Int?
    public var jours: Int?
    public var aujourdhui: BilanActivite
    public var semaine: BilanActivite
    /// Les 7 jours d'avant (total et catégories), pour comparer.
    public var semainePrecedente: BilanActivite?
    public var exclusions: [String]
    public var exclusionsTour: [String]

    public init(actif: Bool, coupeParLaTour: Bool = false, activitywatch: EtatActivityWatch, derniereCollecte: Millis?, releveMin: Int? = 20,
                jours: Int? = 90, aujourdhui: BilanActivite, semaine: BilanActivite, semainePrecedente: BilanActivite? = nil,
                exclusions: [String] = [], exclusionsTour: [String] = []) {
        self.actif = actif
        self.coupeParLaTour = coupeParLaTour
        self.activitywatch = activitywatch
        self.derniereCollecte = derniereCollecte
        self.releveMin = releveMin
        self.jours = jours
        self.aujourdhui = aujourdhui
        self.semaine = semaine
        self.semainePrecedente = semainePrecedente
        self.exclusions = exclusions
        self.exclusionsTour = exclusionsTour
    }

    enum CodingKeys: String, CodingKey {
        case actif, coupeParLaTour, activitywatch, derniereCollecte, releveMin, jours, aujourdhui, semaine, semainePrecedente, exclusions, exclusionsTour
    }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        actif = (try? c.decodeIfPresent(Bool.self, forKey: .actif)) ?? false
        coupeParLaTour = (try? c.decodeIfPresent(Bool.self, forKey: .coupeParLaTour)) ?? false
        activitywatch = (try? c.decodeIfPresent(EtatActivityWatch.self, forKey: .activitywatch)) ?? EtatActivityWatch(joignable: nil)
        derniereCollecte = try? c.decodeIfPresent(Millis.self, forKey: .derniereCollecte)
        releveMin = try? c.decodeIfPresent(Int.self, forKey: .releveMin)
        jours = try? c.decodeIfPresent(Int.self, forKey: .jours)
        aujourdhui = (try? c.decodeIfPresent(BilanActivite.self, forKey: .aujourdhui)) ?? .vide
        semaine = (try? c.decodeIfPresent(BilanActivite.self, forKey: .semaine)) ?? .vide
        semainePrecedente = try? c.decodeIfPresent(BilanActivite.self, forKey: .semainePrecedente)
        exclusions = (try? c.decodeIfPresent([String].self, forKey: .exclusions)) ?? []
        exclusionsTour = (try? c.decodeIfPresent([String].self, forKey: .exclusionsTour)) ?? []
    }

    /// Ce qui empêche de compter, en une phrase avec quoi faire ; nil si tout va bien.
    public var probleme: String? {
        guard actif else { return nil }
        let aw = activitywatch
        if aw.joignable == false {
            return aw.message ?? "ActivityWatch ne répond pas : installe-le sur la tour (aw-qt) et lance-le avec Windows."
        }
        if aw.joignable == true, aw.fenetre == false || aw.afk == false {
            return aw.message ?? "ActivityWatch répond, mais un de ses guetteurs ne tourne pas : relance aw-qt sur la tour."
        }
        return nil
    }

    /// « Les 7 jours d'avant : 11 h 30 (2 h 50 de plus cette semaine) » ; nil
    /// sans rien à comparer.
    public var comparaison: String? {
        guard let avant = semainePrecedente?.total, avant >= 60, semaine.total >= 60 else { return nil }
        let ecart = semaine.total - avant
        let suite = abs(ecart) < 60 ? "autant cette semaine" : "\(ActivitePC.duree(abs(ecart))) de \(ecart > 0 ? "plus" : "moins") cette semaine"
        return "Les 7 jours d'avant : \(ActivitePC.duree(avant)) (\(suite))."
    }

    /// « Relevé à 14:20 », « Premier relevé dans 20 min au plus ».
    public var releve: String {
        if let d = derniereCollecte { return "Relevé à \(Format.heure(d))" }
        return "Premier relevé dans \(releveMin ?? 20) min au plus"
    }
}

public enum ActivitePC {
    /// « 3 h 10 », « 45 min », « moins d'une minute ».
    public static func duree(_ secondes: Double) -> String {
        let m = Int((secondes / 60).rounded())
        return m < 1 ? "moins d'une minute" : Format.duree(minutes: m)
    }

    /// « Discord.exe », «  discord » → « discord » (comme la tour). « .app » reste :
    /// agenda.app est aussi un domaine.
    public static func cle(_ appli: String) -> String {
        var s = appli.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if s.hasSuffix(".exe") { s.removeLast(4) }
        return String(s.prefix(80))
    }
}

@MainActor
@Observable
public final class ActivitePCModel {
    public private(set) var vue: VueActivitePC?
    public private(set) var erreur: String?
    public private(set) var chargement = false
    /// Un geste en cours (interrupteur, exclusion, effacement, relevé).
    public private(set) var enCours = false

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI

    public init(api: ClientAPI) {
        self.api = api
    }

    public var disponible: Bool { app?.serveur?.sait("activite-pc-v1") == true }

    public func charger() async {
        guard disponible, !chargement else { return }
        chargement = true
        defer { chargement = false }
        do {
            vue = try await api.activitePC()
            erreur = nil
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreur = (error as? LocalizedError)?.errorDescription ?? "La tour n'a pas pu lire l'activité du PC."
        }
    }

    @discardableResult
    public func activer(_ oui: Bool) async -> Bool {
        await geste({ try await self.api.reglerActivitePC(actif: oui) }) { v in
            guard oui else { return "Activité du PC coupée : plus rien n'est relevé." }
            return v.probleme == nil ? "Activité du PC allumée : \(v.releve.lowercased())." : "Allumée, mais ActivityWatch ne répond pas encore."
        }
    }

    /// Ne plus jamais compter cette appli, ou ce site (ce qui l'était s'efface sur la tour).
    @discardableResult
    public func exclure(_ appli: String) async -> Bool {
        let c = ActivitePC.cle(appli)
        guard !c.isEmpty, let v = vue else { return false }
        guard !v.exclusions.contains(c) else {
            app?.dire("« \(c) » est déjà exclue.")
            return false
        }
        return await geste({ try await self.api.reglerActivitePC(exclusions: v.exclusions + [c]) }) { _ in
            "« \(c) » : plus rien n'est compté, et ce qui l'était est effacé sur la tour."
        }
    }

    @discardableResult
    public func retirerExclusion(_ appli: String) async -> Bool {
        guard let v = vue else { return false }
        return await geste({ try await self.api.reglerActivitePC(exclusions: v.exclusions.filter { $0 != appli }) }) { _ in
            "« \(appli) » comptera de nouveau, à partir de maintenant."
        }
    }

    @discardableResult
    public func toutEffacer() async -> Bool {
        await geste({ try await self.api.effacerActivitePC() }) { _ in "Activité du PC effacée sur la tour." }
    }

    /// « Relever maintenant » (et tirer pour rafraîchir quand c'est allumé).
    public func relever() async {
        guard disponible, vue?.actif == true else {
            await charger()
            return
        }
        guard !enCours else { return }
        enCours = true
        defer { enCours = false }
        do {
            vue = try await api.releverActivitePC()
            erreur = nil
        } catch {
            app?.signaler(error)
        }
    }

    private func geste(_ f: @escaping () async throws -> VueActivitePC, dire: (VueActivitePC) -> String) async -> Bool {
        guard !enCours else {
            app?.dire("Un réglage est déjà en cours sur la tour : réessaie dans un instant.")
            return false
        }
        enCours = true
        defer { enCours = false }
        do {
            let v = try await f()
            vue = v
            erreur = nil
            app?.dire(dire(v))
            return true
        } catch {
            app?.signaler(error)
            return false
        }
    }

    /// Captures de la CI seulement.
    public func montrerPourCapture(_ v: VueActivitePC) { vue = v }
}
