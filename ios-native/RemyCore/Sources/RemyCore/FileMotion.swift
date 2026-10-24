import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// MARK: - La file du quota Motion (24/10)
//
// Motion accepte 12 requêtes par minute : la tour fait attendre les suivantes
// dans une file, au lieu de se faire refuser. Une écriture pouvait donc rester
// une minute sur « … », et l'app finissait par dire « réseau » pendant que la
// tour écrivait. Désormais, pendant qu'une écriture attend, l'app lit la file
// (GET /api/motion/file, aucune requête vers Motion) et la carte le dit :
// « En file chez Motion : ~20 s ».

/// Ce que la tour sait de sa file : combien attendent, et quand partira la dernière.
public struct AttenteMotion: Decodable, Equatable, Sendable {
    public var enFile: Int
    public var attenteMs: Double
    public var quotaParMinute: Int?

    public init(enFile: Int, attenteMs: Double, quotaParMinute: Int? = 12) {
        self.enFile = enFile
        self.attenteMs = attenteMs
        self.quotaParMinute = quotaParMinute
    }

    /// Rien à dire : rien n'attend, ou moins de 2 s.
    public var visible: Bool { enFile > 0 && attenteMs >= 2000 }

    /// « ~25 s », arrondi aux 5 s supérieures (une attente annoncée trop
    /// courte inquiète plus qu'une attente un peu longue).
    public var duree: String {
        let s = Int((attenteMs / 1000).rounded(.up))
        if s >= 90 { return "~\(Int((Double(s) / 60).rounded())) min" }
        return "~\(max(5, Int((Double(s) / 5).rounded(.up)) * 5)) s"
    }

    /// La phrase de la carte.
    public var phrase: String {
        let q = quotaParMinute.map { " (\($0) requêtes par minute)" } ?? ""
        return "En file chez Motion : \(duree)\(q). Rien à refaire, ça part tout seul."
    }
}

/// Délais de l'app alignés sur la file de la tour : une écriture peut attendre
/// deux fenêtres d'une minute (une rafale de cartes) plus le délai de Motion
/// lui-même (15 s). En dessous, l'iPhone abandonnait pendant que la tour écrivait.
public enum DelaisMotion {
    public static let ecriture: TimeInterval = 150
    /// Projets lit plusieurs pages de Motion, derrière les écritures en file.
    public static let lecture: TimeInterval = 75
}

extension ClientAPI {
    public func fileMotion() async throws -> AttenteMotion {
        try await json(AttenteMotion.self, "api/motion/file", delai: 8)
    }

    /// Fait `travail` ; s'il dure, lit la file toutes les 2 s et la passe à
    /// `surFileMotion`, puis dit `nil` à la fin. Rien si la tour ne connaît pas
    /// la file (`fileMotionSue`) ou que personne n'écoute.
    func avecSuiviFile<T>(_ actif: Bool, _ travail: () async throws -> T) async throws -> T {
        guard actif, fileMotionSue, let ecoute = surFileMotion else { return try await travail() }
        let suivi = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            while !Task.isCancelled {
                if let a = try? await self?.fileMotion(), !Task.isCancelled { await ecoute(a) }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
        do {
            let r = try await travail()
            suivi.cancel()
            _ = await suivi.value
            await ecoute(nil)
            return r
        } catch {
            suivi.cancel()
            _ = await suivi.value
            await ecoute(nil)
            throw error
        }
    }
}
