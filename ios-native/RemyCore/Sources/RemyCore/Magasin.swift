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
    /// Les captures du « + » qui attendent la tour (25/10). À part des gestes :
    /// un build plus ancien, réinstallé, ne sait pas les lire et perdrait
    /// sinon toute la file (ses coches comprises).
    static let captures = "captures.json"
    /// Les captures qu'un build n'a pas su relire (fichier abîmé, genre d'une
    /// version plus récente) : mises de côté, jamais écrasées ni envoyées.
    static let capturesIllisibles = "captures-illisibles.json"
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

    /// Les captures de la file, relues une à une (25/10) : un élément illisible
    /// est mis de côté dans `capturesIllisibles` (ajouté, jamais écrasé), les
    /// autres restent. Un fichier entièrement illisible est mis de côté tel
    /// quel. Rend les captures lues et le nombre de celles mises de côté.
    func lireCaptures() -> (lues: [Commande], illisibles: Int) {
        guard let d = lire(Rangement.captures) else { return ([], 0) }
        guard let racine = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let elements = racine["valeur"] as? [Any] else {
            mettreDeCote([String(decoding: d, as: UTF8.self)])
            effacer(Rangement.captures)
            return ([], 1)
        }
        var lues: [Commande] = []
        var aPart: [Any] = []
        for e in elements {
            if let brut = try? JSONSerialization.data(withJSONObject: e), let c = try? JSONDecoder().decode(Commande.self, from: brut) {
                lues.append(c)
            } else {
                aPart.append(e)
            }
        }
        if !aPart.isEmpty {
            // Mises de côté une fois : la file relue n'a plus que les lisibles.
            mettreDeCote(aPart)
            if lues.isEmpty { effacer(Rangement.captures) } else { try? garder(lues, le: Date(), Rangement.captures) }
        }
        return (lues, aPart.count)
    }

    /// Ajoute à `capturesIllisibles`, sans rien écraser de ce qui y est déjà.
    private func mettreDeCote(_ elements: [Any]) {
        var tout = (lire(Rangement.capturesIllisibles).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [Any]) ?? []
        tout.append(contentsOf: elements)
        if let d = try? JSONSerialization.data(withJSONObject: tout) { try? ecrire(d, Rangement.capturesIllisibles) }
    }

    /// Combien de captures attendent à part, illisibles.
    func nombreIllisibles() -> Int {
        (lire(Rangement.capturesIllisibles).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [Any])?.count ?? 0
    }

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
/// n'est pas refait. Une capture du « + » y vient aussi (25/10), figée telle
/// que l'iPhone l'a comprise.
public struct Commande: Codable, Identifiable, Equatable, Sendable {
    public enum Geste: Codable, Equatable, Sendable {
        case terminer(tache: String, titre: String)
        case capture(CaptureFigee)
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
    /// Une capture qui ne repart plus seule : refusée par la tour ou Motion,
    /// ou peut-être déjà reçue par une tour qui ne reconnaît pas un renvoi.
    /// Elle attend Sam (« Renvoyer » ou « Retirer »), jamais perdue en silence.
    public var raison: String?
    /// Une capture : les pannes passagères essuyées (Rémy arrêté, Motion en
    /// quota…), pour espacer les essais (1, 2, 5, puis 15 min).
    public var reports: Int?
    /// Ce que la tour ou Motion a répondu au dernier essai passager.
    public var dernierEchec: String?

    /// La capture que porte cette commande, s'il s'agit d'une capture.
    public var capture: CaptureFigee? {
        if case let .capture(c) = geste { return c }
        return nil
    }

    public init(geste: Geste, creeLe: Date = Date(), delai: Double = 0, id: String = UUID().uuidString) {
        self.id = id
        self.geste = geste
        self.creeLe = creeLe
        self.partApres = creeLe.addingTimeInterval(delai)
        self.tentatives = 0
        self.puisDefaire = false
    }
}
