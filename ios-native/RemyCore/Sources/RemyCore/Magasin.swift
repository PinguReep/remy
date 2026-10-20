import Foundation

// Ce que l'app garde sur l'iPhone entre deux lancements (J1.2) : la dernière
// journée reçue, datée, et les gestes pas encore envoyés. Des fichiers JSON
// dans « Application Support », chiffrés par iOS dès le premier déverrouillage
// et exclus de la sauvegarde iCloud : rien ne sort du téléphone. Tout s'efface
// à la déconnexion, ou quand la tour ne reconnaît plus l'appareil.

/// Le dossier où l'app range ses fichiers.
public struct Rangement: Sendable {
    public let dossier: URL

    static let journee = "journee.json"
    static let envoi = "envoi.json"
    /// Ce que la tour sait faire : hors ligne dès le lancement, l'app doit
    /// savoir qu'elle reconnaît un geste renvoyé (sinon elle n'oserait pas).
    static let serveur = "serveur.json"
    static let projets = "projets.json"

    public init(dossier: URL) { self.dossier = dossier }

    /// Application Support/Remy, le dossier de l'app sur l'iPhone.
    public static func parDefaut() -> Rangement? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        return Rangement(dossier: base.appendingPathComponent("Remy", isDirectory: true))
    }

    func ecrire(_ donnees: Data, _ nom: String) throws {
        try preparer()
        #if os(iOS)
        try donnees.write(to: url(nom), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try donnees.write(to: url(nom), options: .atomic)
        #endif
    }

    func lire(_ nom: String) -> Data? { try? Data(contentsOf: url(nom)) }

    func effacer(_ nom: String) { try? FileManager.default.removeItem(at: url(nom)) }

    /// Une valeur datée, illisible = absente (un fichier abîmé ne bloque jamais l'app).
    func copie<T: Decodable>(_ type: T.Type, _ nom: String) -> Copie<T>? {
        guard let d = lire(nom) else { return nil }
        return try? JSONDecoder().decode(Copie<T>.self, from: d)
    }

    func garder<T: Encodable>(_ valeur: T, le: Date, _ nom: String) throws {
        try ecrire(JSONEncoder().encode(Copie(le: le, valeur: valeur)), nom)
    }

    private func url(_ nom: String) -> URL { dossier.appendingPathComponent(nom) }

    private func preparer() throws {
        guard !FileManager.default.fileExists(atPath: dossier.path) else { return }
        try FileManager.default.createDirectory(at: dossier, withIntermediateDirectories: true)
        #if os(iOS) || os(macOS)
        // Ta journée n'a rien à faire dans iCloud : elle se relit sur la tour.
        var u = dossier
        var v = URLResourceValues()
        v.isExcludedFromBackup = true
        try? u.setResourceValues(v)
        #endif
    }
}

/// Ce que le serveur a rendu, et quand.
public struct Copie<T> {
    public var le: Date
    public var valeur: T
}

extension Copie: Encodable where T: Encodable {}
extension Copie: Decodable where T: Decodable {}

/// Un geste fait dans l'app, écrit sur le disque AVANT de partir. Son `id` est
/// la clé envoyée au serveur (`idCommande`) : renvoyé après une coupure, il
/// n'est pas refait. Les captures y viendront au J1.5.
public struct Commande: Codable, Identifiable, Equatable, Sendable {
    public enum Geste: Codable, Equatable, Sendable {
        case terminer(tache: String, titre: String)
    }

    public let id: String
    public let geste: Geste
    public let creeLe: Date
    /// La fin du délai d'annulation : rien ne part avant.
    public var partApres: Date
    /// Envois partis sans réponse : à 0, la tour ne l'a jamais reçue.
    public var tentatives: Int
    /// « Annuler » touché alors qu'elle était peut-être arrivée : on la renvoie,
    /// puis on la défait.
    public var puisDefaire: Bool

    public init(geste: Geste, creeLe: Date = Date(), delai: Double = 0, id: String = UUID().uuidString) {
        self.id = id
        self.geste = geste
        self.creeLe = creeLe
        self.partApres = creeLe.addingTimeInterval(delai)
        self.tentatives = 0
        self.puisDefaire = false
    }
}
