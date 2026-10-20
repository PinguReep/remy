import Foundation

/// Les temps mesurés sur l'iPhone (retours TestFlight 13 : « jusqu'à 15 s » —
/// diagnostiquer avant de masquer). En mémoire seulement, les 100 dernières
/// valeurs par série ; rien de personnel, des durées.
///
/// Séries : app.affichage (lancement → journée à l'écran), app.journee
/// (iPhone → tour → iPhone), app.geste (geste → confirmation de la tour),
/// app.conseil, app.dictee, app.capture.
@MainActor
public final class Mesures {
    public static let partagees = Mesures()

    public struct Resume: Sendable, Equatable {
        public let n: Int
        public let p50: Int
        public let p95: Int
        public let max: Int
        public let dernier: Int
    }

    private var series: [String: [Double]] = [:]

    public func noter(_ nom: String, ms: Double) {
        guard ms.isFinite, ms >= 0 else { return }
        var s = series[nom, default: []]
        s.append(ms)
        if s.count > 100 { s.removeFirst(s.count - 100) }
        series[nom] = s
    }

    /// let fin = Mesures.partagees.chrono("app.geste") … fin()
    public func chrono(_ nom: String) -> () -> Void {
        let debut = Date()
        return { [weak self] in self?.noter(nom, ms: Date().timeIntervalSince(debut) * 1000) }
    }

    public func resume() -> [String: Resume] {
        series.compactMapValues { s in
            guard let dernier = s.last else { return nil }
            let tri = s.sorted()
            let q = { (p: Double) in Int(tri[min(tri.count - 1, Int(p * Double(tri.count)))].rounded()) }
            return Resume(n: s.count, p50: q(0.5), p95: q(0.95), max: Int(tri.last!.rounded()), dernier: Int(dernier.rounded()))
        }
    }

    public func vider() { series = [:] }
}
