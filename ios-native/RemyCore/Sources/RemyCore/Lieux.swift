import Foundation
import Observation

// MARK: - La localisation (Sam, 20/10)
//
// L'iPhone détecte des VISITES (arrivée, puis départ : iOS les repère seul,
// presque sans batterie) et des TRAJETS en voiture (capteurs de mouvement).
// Ils partent vers la tour, qui les range par lieu et traduit l'adresse chez
// elle — rien ne part chez Apple ni ailleurs. Coupé par défaut ; « pause 2 h »
// n'enregistre rien ; tout s'efface depuis l'app.

/// Un événement envoyé à la tour. Une visite revient au départ avec le même
/// identifiant : la tour complète la première.
public struct EvenementLieu: Codable, Equatable, Sendable {
    public var type: String          // visite | trajet
    public var id: String
    public var arrivee: Millis?
    public var depart: Millis?
    public var lat: Double?
    public var lon: Double?
    public var precision: Double?
    public var debut: Millis?
    public var fin: Millis?
    public var mode: String?

    public static func visite(arrivee: Date, depart: Date?, lat: Double, lon: Double, precision: Double?) -> EvenementLieu {
        // Stable entre l'arrivée et le départ : même instant d'arrivée, même endroit.
        let id = "v-\(Int(arrivee.timeIntervalSince1970))-\(Int((lat * 1000).rounded()))-\(Int((lon * 1000).rounded()))"
        return EvenementLieu(type: "visite", id: id, arrivee: arrivee.millis, depart: depart?.millis, lat: lat, lon: lon,
                             precision: precision, debut: nil, fin: nil, mode: nil)
    }

    public static func trajet(debut: Date, fin: Date?) -> EvenementLieu {
        EvenementLieu(type: "trajet", id: "t-\(Int(debut.timeIntervalSince1970))", arrivee: nil, depart: nil, lat: nil, lon: nil,
                      precision: nil, debut: debut.millis, fin: fin?.millis, mode: "voiture")
    }
}

/// Le commerce où Sam se trouve sans doute (OpenStreetMap, sur la tour) : une
/// supposition, pour un lieu qu'il n'a pas nommé.
public struct CommerceProche: Codable, Equatable, Sendable {
    public var nom: String?
    public var type: String
    public var distance: Int?

    public init(nom: String?, type: String, distance: Int? = nil) {
        self.nom = nom
        self.type = type
        self.distance = distance
    }

    /// « Salon Lumière (coiffeur) », « pharmacie (sans nom) ».
    public var libelle: String {
        guard let nom, !nom.isEmpty else { return "\(type) (sans nom)" }
        return nom.lowercased().contains(type) ? nom : "\(nom) (\(type))"
    }
}

public struct LieuTour: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var nom: String?
    public var adresse: String?
    public var lat: Double
    public var lon: Double
    public var rayon: Int?
    public var source: String?
    public var visites: Int?
    public var derniere: Millis?
    public var commerce: CommerceProche?

    public init(id: String, nom: String?, adresse: String?, lat: Double, lon: Double, rayon: Int? = nil,
                source: String? = nil, visites: Int? = nil, derniere: Millis? = nil, commerce: CommerceProche? = nil) {
        self.id = id
        self.nom = nom
        self.adresse = adresse
        self.lat = lat
        self.lon = lon
        self.rayon = rayon
        self.source = source
        self.visites = visites
        self.derniere = derniere
        self.commerce = commerce
    }

    /// Ce qu'on lit : son nom, sinon son adresse.
    public var affiche: String { nom ?? adresse ?? "Lieu sans adresse connue" }
}

public struct EtatLieux: Codable, Equatable, Sendable {
    public struct Ici: Codable, Equatable, Sendable {
        public var id: String?
        public var nom: String?
        public var adresse: String?
        public var commerce: CommerceProche?

        public init(id: String?, nom: String?, adresse: String?, commerce: CommerceProche? = nil) {
            self.id = id
            self.nom = nom
            self.adresse = adresse
            self.commerce = commerce
        }

        /// Son nom, sinon « sans doute Salon Lumière (coiffeur) », sinon son adresse.
        public var lisible: String? {
            nom ?? commerce.map { "Sans doute \($0.libelle)" } ?? adresse
        }
    }
    public var ou: String            // lieu | voiture | inconnu
    public var depuis: Millis?
    public var lieu: Ici?

    public init(ou: String, depuis: Millis?, lieu: Ici?) {
        self.ou = ou
        self.depuis = depuis
        self.lieu = lieu
    }

    /// « Salle de sport, depuis 18:42 », « En voiture, depuis 8:05 », « — ».
    public var phrase: String {
        switch ou {
        case "voiture": return "En voiture" + (depuis.map { ", depuis \(Format.heure($0))" } ?? "")
        case "lieu": return (lieu?.lisible ?? "Un lieu sans adresse connue") + (depuis.map { ", depuis \(Format.heure($0))" } ?? "")
        default: return "Pas de position récente"
        }
    }
}

public struct VisiteTour: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var arrivee: Millis
    public var depart: Millis?
    public var lieu: EtatLieux.Ici?

    public init(id: String, arrivee: Millis, depart: Millis?, lieu: EtatLieux.Ici?) {
        self.id = id
        self.arrivee = arrivee
        self.depart = depart
        self.lieu = lieu
    }
}

public struct GeocodageTour: Codable, Equatable, Sendable {
    public var pret: Bool
    public var adresses: Int?
    public var departements: [String]?

    public init(pret: Bool, adresses: Int?, departements: [String]?) {
        self.pret = pret
        self.adresses = adresses
        self.departements = departements
    }
}

/// La base des commerces de la tour (OpenStreetMap), si elle est importée.
public struct CommercesTour: Codable, Equatable, Sendable {
    public var pret: Bool
    public var commerces: Int?

    public init(pret: Bool, commerces: Int?) {
        self.pret = pret
        self.commerces = commerces
    }
}

public struct VueLieux: Codable, Equatable, Sendable {
    public var actif: Bool
    public var jours: Int?
    public var etat: EtatLieux
    public var aujourdhui: [VisiteTour]
    public var lieux: [LieuTour]
    public var geocodage: GeocodageTour?
    public var commerces: CommercesTour?

    public init(actif: Bool, jours: Int? = 90, etat: EtatLieux, aujourdhui: [VisiteTour], lieux: [LieuTour], geocodage: GeocodageTour?,
                commerces: CommercesTour? = nil) {
        self.actif = actif
        self.jours = jours
        self.etat = etat
        self.aujourdhui = aujourdhui
        self.lieux = lieux
        self.geocodage = geocodage
        self.commerces = commerces
    }
}

struct RetourEvenementsLieux: Decodable { var visites: Int?; var trajets: Int?; var ecartes: Int? }

@MainActor
@Observable
public final class LieuxModel {
    /// Sam a allumé la localisation (sur cet iPhone). Coupée par défaut.
    public private(set) var active: Bool
    /// Rien n'est enregistré avant cette date (« pause 2 h »).
    public private(set) var pauseJusqua: Date?
    public private(set) var vue: VueLieux?
    public private(set) var erreur: String?
    public private(set) var chargement = false
    /// Événements pas encore reçus par la tour (hors ligne, Tailscale coupé).
    public private(set) var enAttente: [EvenementLieu]

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI
    @ObservationIgnored let reglages: UserDefaults
    @ObservationIgnored var maintenant: () -> Date = { Date() }
    @ObservationIgnored private var envoiEnCours = false

    static let cleActive = "lieux.active"
    static let clePause = "lieux.pause"
    static let cleFile = "lieux.file"
    static let fileMax = 500

    public init(api: ClientAPI, reglages: UserDefaults = .standard) {
        self.api = api
        self.reglages = reglages
        active = reglages.bool(forKey: Self.cleActive)
        let p = reglages.double(forKey: Self.clePause)
        pauseJusqua = p > 0 ? Date(timeIntervalSince1970: p) : nil
        enAttente = (reglages.data(forKey: Self.cleFile)).flatMap { try? JSONDecoder().decode([EvenementLieu].self, from: $0) } ?? []
    }

    public var disponible: Bool { app?.serveur?.sait("lieux-v1") == true }
    public var enPause: Bool { (pauseJusqua ?? .distantPast) > maintenant() }

    public func activer(_ oui: Bool) {
        active = oui
        reglages.set(oui, forKey: Self.cleActive)
        if !oui {
            pauseJusqua = nil
            reglages.removeObject(forKey: Self.clePause)
        }
    }

    /// « Pause 2 h » : rien n'est enregistré ni envoyé pendant ce temps.
    public func pause(heures: Double = 2) {
        pauseJusqua = maintenant().addingTimeInterval(heures * 3600)
        reglages.set(pauseJusqua!.timeIntervalSince1970, forKey: Self.clePause)
        app?.dire("Localisation en pause jusqu'à \(Format.heure(pauseJusqua!)).")
    }

    public func reprendre() {
        pauseJusqua = nil
        reglages.removeObject(forKey: Self.clePause)
    }

    /// Un événement des capteurs. Ignoré si la localisation est coupée ou en
    /// pause ; sinon gardé (la version la plus récente d'une visite l'emporte)
    /// puis envoyé dès que possible.
    public func recevoir(_ e: EvenementLieu) async {
        guard active, !enPause else { return }
        if let i = enAttente.firstIndex(where: { $0.id == e.id }) { enAttente[i] = e } else { enAttente.append(e) }
        if enAttente.count > Self.fileMax { enAttente.removeFirst(enAttente.count - Self.fileMax) }
        ranger()
        await envoyer()
    }

    /// Envoie ce qui attend. Échec : tout reste, réessayé au prochain événement
    /// ou au retour de l'app.
    public func envoyer() async {
        guard disponible, !enAttente.isEmpty, !envoiEnCours else { return }
        envoiEnCours = true
        defer { envoiEnCours = false }
        let lot = Array(enAttente.prefix(200))
        do {
            _ = try await api.envoyerEvenementsLieux(lot)
            let partis = Set(lot.map(\.id))
            // Une visite complétée entre-temps (son départ) reste à envoyer.
            enAttente.removeAll { e in partis.contains(e.id) && lot.contains(e) }
            ranger()
            erreur = nil
        } catch {
            erreur = (error as? LocalizedError)?.errorDescription ?? "La tour n'a pas reçu tes positions : elles attendent sur l'iPhone."
        }
    }

    public func charger() async {
        guard disponible, !chargement else { return }
        chargement = true
        defer { chargement = false }
        do {
            vue = try await api.lieux()
            erreur = nil
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreur = (error as? LocalizedError)?.errorDescription ?? "Lieux illisibles."
        }
    }

    /// « Nommer ce lieu » : là où est l'iPhone maintenant.
    @discardableResult
    public func nommerIci(_ nom: String, lat: Double, lon: Double) async -> Bool {
        await geste { try await self.api.nommerLieu(nom: nom, lat: lat, lon: lon) } dire: { "« \(nom) » est noté." }
    }

    @discardableResult
    public func renommer(_ l: LieuTour, _ nom: String) async -> Bool {
        await geste { try await self.api.renommerLieu(l.id, nom: nom) } dire: { "Renommé en « \(nom) »." }
    }

    @discardableResult
    public func supprimer(_ l: LieuTour) async -> Bool {
        await geste { try await self.api.supprimerLieu(l.id) } dire: { "« \(l.affiche) » oublié." }
    }

    /// Visites et trajets effacés sur la tour (et ce qui attendait sur l'iPhone) ;
    /// les lieux nommés restent.
    @discardableResult
    public func toutEffacer() async -> Bool {
        let ok = await geste { try await self.api.effacerHistoriqueLieux() } dire: { "Historique des lieux effacé." }
        if ok {
            enAttente = []
            ranger()
        }
        return ok
    }

    private func geste(_ f: @escaping () async throws -> VueLieux, dire: () -> String) async -> Bool {
        do {
            vue = try await f()
            erreur = nil
            app?.dire(dire())
            return true
        } catch {
            app?.signaler(error)
            return false
        }
    }

    private func ranger() {
        if let d = try? JSONEncoder().encode(enAttente) { reglages.set(d, forKey: Self.cleFile) }
    }

    /// Captures de la CI seulement : allumée en mémoire, rien d'enregistré
    /// (sinon les lancements suivants demanderaient l'autorisation d'iOS).
    public func montrerPourCapture(_ v: VueLieux) {
        active = v.actif
        vue = v
    }
}
