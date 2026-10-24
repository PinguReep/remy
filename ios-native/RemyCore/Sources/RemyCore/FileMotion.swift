import Foundation

// La file du quota Motion (24/10) : pendant « Oui, fais-le », la tour dit si
// l'écriture attend sa place (Motion limite à 12 requêtes par minute) et pour
// combien de temps environ, au lieu de « … » pendant 40 s.
// GET /api/motion/file : une lecture locale de la tour, aucun appel à Motion.

public struct FileMotion: Codable, Sendable, Equatable {
    /// Requêtes par minute permises par Motion.
    public var quota: Int
    /// Requêtes de la tour qui attendent leur place.
    public var enAttente: Int
    /// Quand la dernière requête en file aura sa place (ms).
    public var attenteMs: Double
    /// Motion a répondu « trop de requêtes » : nouvel essai dans (ms).
    public var pause429: Double

    public init(quota: Int, enAttente: Int, attenteMs: Double, pause429: Double = 0) {
        self.quota = quota
        self.enAttente = enAttente
        self.attenteMs = attenteMs
        self.pause429 = pause429
    }

    /// La phrase sous les boutons de la carte, ou nil s'il n'y a rien à attendre.
    public var phrase: String? {
        let s = Int((attenteMs / 1000).rounded(.up))
        if pause429 > 0 { return "Motion demande une pause (trop de requêtes) : nouvel essai dans ~\(s) s" }
        if enAttente > 0 && s >= 2 { return "En file : Motion limite à \(quota) requêtes/min, ~\(s) s" }
        return nil
    }
}

extension ClientAPI {
    /// L'état de la file du quota Motion (capacité « motion-file-v1 »).
    public func fileMotion() async throws -> FileMotion {
        try await json(FileMotion.self, "api/motion/file", delai: 8)
    }
}
