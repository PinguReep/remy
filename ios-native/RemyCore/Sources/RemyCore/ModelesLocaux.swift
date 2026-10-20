import Foundation
import Observation

// MARK: - Le modèle local (modeles-v1, 20/10)
//
// Rémy suit le modèle que les Sparks chargent ; Réglages › Modèle permet d'en
// fixer un autre parmi ceux qu'elles servent. Claude n'est pas dans la liste :
// le cloud reste réservé aux recherches web autorisées et au secours.

public struct ModeleServi: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var libelle: String
    /// Taille maximale du contexte, en tokens, si le serveur la déclare.
    public var fenetre: Int?

    public init(id: String, libelle: String, fenetre: Int? = nil) {
        self.id = id
        self.libelle = libelle
        self.fenetre = fenetre
    }

    enum CodingKeys: String, CodingKey { case id, libelle, fenetre }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        libelle = (try? c.decodeIfPresent(String.self, forKey: .libelle)) ?? id
        fenetre = try? c.decodeIfPresent(Int.self, forKey: .fenetre)
    }
}

public struct ModelesLocaux: Codable, Equatable, Sendable {
    public struct Actif: Codable, Equatable, Sendable {
        public var id: String
        public var libelle: String
        /// choisi (dans l'app) | tour (REMY_GLM_MODEL) | auto (ce que les Sparks servent) | defaut
        public var source: String
        public init(id: String, libelle: String, source: String) {
            self.id = id
            self.libelle = libelle
            self.source = source
        }
    }
    public var joignable: Bool
    public var machine: String?
    public var actif: Actif?
    /// Le modèle fixé dans l'app ; nil = celui que les Sparks chargent.
    public var choisi: String?
    public var servis: [ModeleServi]

    public init(joignable: Bool, machine: String?, actif: Actif?, choisi: String?, servis: [ModeleServi]) {
        self.joignable = joignable
        self.machine = machine
        self.actif = actif
        self.choisi = choisi
        self.servis = servis
    }

    enum CodingKeys: String, CodingKey { case joignable, machine, actif, choisi, servis }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        joignable = (try? c.decodeIfPresent(Bool.self, forKey: .joignable)) ?? false
        machine = try? c.decodeIfPresent(String.self, forKey: .machine)
        actif = try? c.decodeIfPresent(Actif.self, forKey: .actif)
        choisi = try? c.decodeIfPresent(String.self, forKey: .choisi)
        servis = (try? c.decodeIfPresent([ModeleServi].self, forKey: .servis)) ?? []
    }

    /// Le choix fait dans l'app n'est plus chargé sur les Sparks : Rémy en prend un autre.
    public var choixAbsent: Bool {
        guard let choisi, joignable else { return false }
        return !servis.contains { $0.id == choisi }
    }

    /// « Choisi par toi », « Celui que tes Sparks chargent »…
    public var pourquoi: String {
        switch actif?.source {
        case "choisi": return "Choisi par toi"
        case "tour": return "Réglé sur la tour (REMY_GLM_MODEL)"
        case "auto": return choixAbsent ? "Ton choix n'est plus chargé : celui que tes Sparks servent" : "Celui que tes Sparks chargent"
        default: return "Les Sparks n'ont pas dit ce qu'elles servent"
        }
    }

    /// « 1 M de contexte », « 128 k de contexte ».
    public static func fenetreLisible(_ n: Int?) -> String? {
        guard let n, n > 0 else { return nil }
        if n >= 1_000_000 {
            let m = Double(n) / 1_048_576
            return (m >= 0.95 && m < 1.05 ? "1" : String(format: "%.1f", m).replacingOccurrences(of: ".", with: ",")) + " M de contexte"
        }
        return "\(Int((Double(n) / 1024).rounded())) k de contexte"
    }
}

@MainActor
@Observable
public final class ModelesModel {
    public private(set) var vue: ModelesLocaux?
    public private(set) var erreur: String?
    public private(set) var chargement = false
    /// Le choix en cours d'envoi ("" = l'automatique), pour l'indicateur de la ligne.
    public private(set) var enCours: String?

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI

    public init(api: ClientAPI) {
        self.api = api
    }

    public var disponible: Bool { app?.serveur?.sait("modeles-v1") == true }

    public func charger() async {
        guard disponible, !chargement else { return }
        chargement = true
        defer { chargement = false }
        do {
            vue = try await api.modelesLocaux()
            erreur = nil
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreur = (error as? LocalizedError)?.errorDescription ?? "La tour n'a pas pu lire les modèles des Sparks."
        }
    }

    /// `id` nil : suivre le modèle que les Sparks chargent.
    @discardableResult
    public func choisir(_ id: String?) async -> Bool {
        guard enCours == nil else { return false }
        enCours = id ?? ""
        defer { enCours = nil }
        do {
            let v = try await api.choisirModeleLocal(id)
            vue = v
            erreur = nil
            let nom = v.actif?.libelle ?? id ?? "le modèle des Sparks"
            app?.dire(id == nil ? "Rémy suit le modèle de tes Sparks (\(nom))." : "Rémy répond maintenant avec \(nom).")
            return true
        } catch {
            app?.signaler(error)
            return false
        }
    }

    /// Captures de la CI seulement.
    public func montrerPourCapture(_ v: ModelesLocaux) { vue = v }
}
