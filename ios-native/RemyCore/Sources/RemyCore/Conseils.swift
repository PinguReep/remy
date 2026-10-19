import Foundation
import Observation

/// Le conseil du moment venu de la tour (GLM local, conseil-v1), par type.
/// Jamais attendu : l'accueil montre d'abord le conseil par règles de
/// l'iPhone, puis celui de Rémy quand il est là.
@MainActor
@Observable
public final class ConseilModel {
    public private(set) var parType: [TypeConseil: ConseilTour] = [:]
    public private(set) var chargement: Set<TypeConseil> = []
    public private(set) var renouvellement: Set<TypeConseil> = []

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI
    /// Entre deux relectures pendant que GLM réfléchit.
    @ObservationIgnored public var pause: Double = 1.5

    public init(api: ClientAPI) { self.api = api }

    /// La tour sait-elle réfléchir un conseil ?
    public var disponible: Bool { app?.serveur?.sait("conseil-v1") == true }

    /// Le conseil de la tour pour ce type (« maintenant » arrive avec la journée).
    public func tour(_ type: TypeConseil) -> ConseilTour? {
        if let c = parType[type] { return c }
        return type == .maintenant ? app?.tableau.donnees?.conseil : nil
    }

    /// Lit le conseil gardé par la tour ; si GLM réfléchit, repasse quelques
    /// fois (30 s au plus) sans rien bloquer.
    public func charger(_ type: TypeConseil) async {
        guard disponible, !chargement.contains(type) else { return }
        chargement.insert(type)
        defer { chargement.remove(type) }
        let fin = Mesures.partagees.chrono("app.conseil")
        guard let c = try? await api.conseil(type: type.rawValue) else { return }
        fin()
        parType[type] = c
        var essais = 0
        while parType[type]?.enCours == true, essais < 20, !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(pause * 1_000_000_000))
            essais += 1
            if let c = try? await api.conseil(type: type.rawValue) { parType[type] = c }
        }
    }

    /// « Un autre conseil » : GLM recalcule en proposant autre chose.
    public func renouveler(_ type: TypeConseil) async {
        guard disponible, !renouvellement.contains(type) else { return }
        renouvellement.insert(type)
        defer { renouvellement.remove(type) }
        let avant = tour(type)?.conseil?.genereA ?? 0
        do {
            let r = try await api.renouvelerConseil(type: type.rawValue)
            if r.disponible == false {
                app?.dire(r.raison ?? "Rémy ne peut pas réfléchir un autre conseil pour l'instant.")
                return
            }
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            app?.dire("Rémy n'a pas pu demander un autre conseil : \((error as? LocalizedError)?.errorDescription ?? "erreur").")
            return
        }
        for _ in 0..<30 where !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(pause * 1_000_000_000))
            guard let c = try? await api.conseil(type: type.rawValue) else { continue }
            parType[type] = c
            if (c.conseil?.genereA ?? 0) > avant || c.enCours != true { break }
        }
        if (tour(type)?.conseil?.genereA ?? 0) <= avant {
            app?.dire(tour(type)?.raison ?? "GLM n'a pas répondu à temps : le conseil précédent reste affiché.")
        }
    }

    public func vider() { parType = [:] }
}
