import Foundation

/// Le brouillon du « + » (24/10) : fermer la feuille (un appel, une
/// notification) ne perd plus le texte. Gardé sur l'iPhone seulement, une
/// semaine au plus ; effacé dès que la capture est rangée.
public enum BrouillonCapture {
    static let cle = "remy.brouillonCapture"
    static let cleDate = "remy.brouillonCapture.le"
    static let duree: TimeInterval = 7 * 86_400

    public static func lire(_ d: UserDefaults = .standard, maintenant: Date = Date()) -> String? {
        guard let t = d.string(forKey: cle), !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let le = d.double(forKey: cleDate)
        if le > 0, maintenant.timeIntervalSince1970 - le > duree {
            effacer(d)
            return nil
        }
        return t
    }

    public static func garder(_ texte: String, _ d: UserDefaults = .standard, maintenant: Date = Date()) {
        guard !texte.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            effacer(d)
            return
        }
        d.set(String(texte.prefix(4000)), forKey: cle)
        d.set(maintenant.timeIntervalSince1970, forKey: cleDate)
    }

    public static func effacer(_ d: UserDefaults = .standard) {
        d.removeObject(forKey: cle)
        d.removeObject(forKey: cleDate)
    }
}
