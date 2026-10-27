import Foundation
#if canImport(Security)
import Security
#endif

/// Où l'app range son jeton d'appareil (Lot 0, J0.8b) : le Keychain sur
/// l'iPhone, la mémoire dans les tests. La tour n'en garde que l'empreinte ;
/// Sam peut déconnecter l'appareil depuis la liste des appareils.
public protocol CoffreJeton: AnyObject, Sendable {
    func lire() -> String?
    func ecrire(_ jeton: String?)
}

/// En mémoire : les tests, et le repli quand le Keychain refuse.
public final class CoffreMemoire: CoffreJeton, @unchecked Sendable {
    private let verrou = NSLock()
    private var valeur: String?

    public init(_ valeur: String? = nil) { self.valeur = valeur }

    public func lire() -> String? {
        verrou.lock(); defer { verrou.unlock() }
        return valeur
    }

    public func ecrire(_ jeton: String?) {
        verrou.lock(); defer { verrou.unlock() }
        valeur = jeton
    }
}

#if canImport(Security)
/// Le Keychain : le jeton survit aux mises à jour de l'app, ne quitte pas
/// l'appareil (« ThisDeviceOnly » : ni sauvegarde iCloud, ni nouvel iPhone) et
/// reste lisible après le premier déverrouillage (requêtes en arrière-plan).
/// Aucun groupe d'accès dans les requêtes : l'écriture va dans le groupe par
/// défaut (le trousseau partagé avec les extensions, 24/10), la lecture
/// cherche dans tous ceux de l'app ou de l'extension.
public final class CoffreTrousseau: CoffreJeton, @unchecked Sendable {
    private let service: String
    private let compte: String
    /// Si le Keychain refuse (simulateur sans trousseau, test sans signature),
    /// l'app garde le jeton pour la session : le cookie prend le relais ensuite.
    private let secours = CoffreMemoire()

    /// Le jeton d'appareil de la tour `base`.
    public convenience init(base: URL) {
        self.init(service: "remy.jeton-appareil", compte: base.host ?? base.absoluteString)
    }

    /// Une autre valeur du trousseau (l'adresse de la tour pour les extensions).
    public init(service: String, compte: String) {
        self.service = service
        self.compte = compte
    }

    private var requete: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: compte]
    }

    public func lire() -> String? {
        var q = requete
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var resultat: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &resultat) == errSecSuccess,
              let d = resultat as? Data, let j = String(data: d, encoding: .utf8) else { return secours.lire() }
        return j
    }

    public func ecrire(_ jeton: String?) {
        SecItemDelete(requete as CFDictionary)
        secours.ecrire(nil)
        guard let jeton else { return }
        var q = requete
        q[kSecValueData as String] = Data(jeton.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        if SecItemAdd(q as CFDictionary, nil) != errSecSuccess { secours.ecrire(jeton) }
    }
}
#endif

/// Un appareil connecté à la tour (/api/appareils).
public struct Appareil: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var nom: String
    public var cree_a: Double?
    public var vu_a: Double?
    public var actuel: Bool?

    public init(id: String, nom: String, cree_a: Double? = nil, vu_a: Double? = nil, actuel: Bool? = nil) {
        self.id = id
        self.nom = nom
        self.cree_a = cree_a
        self.vu_a = vu_a
        self.actuel = actuel
    }

    public var vuLe: Date? { (vu_a ?? cree_a).map { Date(timeIntervalSince1970: $0 / 1000) } }
}

struct ListeAppareils: Codable, Sendable {
    var appareils: [Appareil]
}

struct JetonEmis: Codable, Sendable {
    var ok: Bool?
    var jeton: String?
}
