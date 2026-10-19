import Foundation
import Observation

/// L'onglet Projets : les projets Motion (lecture seule), gardés sur l'iPhone
/// comme la journée, pour s'afficher hors ligne avec leur date.
@MainActor
@Observable
public final class ProjetsModel {
    public private(set) var liste: ListeProjets?
    public private(set) var misAJour: Date?
    public private(set) var chargement = false
    public private(set) var erreur: String?

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI
    @ObservationIgnored let rangement: Rangement?

    public init(api: ClientAPI, rangement: Rangement? = nil) {
        self.api = api
        self.rangement = rangement
        if let c = rangement?.copie(ListeProjets.self, Rangement.projets) {
            liste = c.valeur
            misAJour = c.le
        }
    }

    /// Vrai quand la tour sait rendre les projets (capacité « projets-v1 »).
    public var disponible: Bool { app?.serveur?.sait("projets-v1") == true }

    public func charger() async {
        guard disponible, !chargement else { return }
        chargement = true
        defer { chargement = false }
        do {
            let l = try await api.projets()
            let le = Date()
            liste = l
            misAJour = le
            erreur = nil
            try? rangement?.garder(l, le: le, Rangement.projets)
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreur = (error as? LocalizedError)?.errorDescription ?? "Projets illisibles."
        }
    }

    public func vider() {
        liste = nil
        misAJour = nil
        erreur = nil
        rangement?.effacer(Rangement.projets)
    }
}
