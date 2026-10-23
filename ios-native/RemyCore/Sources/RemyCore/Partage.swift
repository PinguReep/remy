import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// MARK: - Ce que l'app partage avec ses extensions (24/10)
//
// Les widgets et la feuille de partage parlent à la tour comme l'app, avec le
// même jeton d'appareil. Pas de groupe d'app (Apple refuse de l'enregistrer
// par l'API, le build de nuit échouerait) : un TROUSSEAU PARTAGÉ
// (keychain-access-groups = <équipe>.com.pingureep.remy, le groupe par défaut
// de l'app, donc le jeton déjà rangé reste lisible). L'app y recopie
// l'adresse de la tour ; les extensions lisent l'adresse et le jeton, et
// n'écrivent jamais rien.

/// L'extension ne trouve pas de quoi parler à la tour.
public enum ErreurPartage: Error, LocalizedError, Equatable {
    /// Ni adresse ni jeton dans le trousseau : l'app n'a jamais été connectée
    /// sur cet iPhone, ou Sam s'est déconnecté.
    case nonConnecte

    public var errorDescription: String? {
        switch self {
        case .nonConnecte: return "Ouvre Rémy une fois pour te connecter."
        }
    }
}

/// Un coffre qu'on lit sans jamais y écrire : côté extension, un 401 ne doit
/// pas effacer le jeton de l'app (c'est l'app qui s'en charge).
public final class CoffreLecture: CoffreJeton, @unchecked Sendable {
    private let source: CoffreJeton
    public init(_ source: CoffreJeton) { self.source = source }
    public func lire() -> String? { source.lire() }
    public func ecrire(_ jeton: String?) {}
}

/// Le trousseau commun à l'app et à ses extensions. `adresse` : où l'app
/// recopie l'adresse de la tour ; `jeton(base)` : le coffre du jeton de cette
/// tour (le même que celui de ClientAPI).
public struct TrousseauPartage: Sendable {
    /// Le service de l'adresse dans le trousseau (un seul compte).
    public static let serviceAdresse = "remy.adresse-tour"
    static let compteAdresse = "tour"

    let adresse: CoffreJeton
    let jeton: @Sendable (URL) -> CoffreJeton

    public init(adresse: CoffreJeton, jeton: @escaping @Sendable (URL) -> CoffreJeton) {
        self.adresse = adresse
        self.jeton = jeton
    }

    /// Le vrai trousseau de l'iPhone (en mémoire là où il n'existe pas : Linux).
    public static var systeme: TrousseauPartage {
        #if canImport(Security)
        TrousseauPartage(adresse: CoffreTrousseau(service: serviceAdresse, compte: compteAdresse),
                         jeton: { CoffreTrousseau(base: $0) })
        #else
        TrousseauPartage(adresse: CoffreMemoire(), jeton: { _ in CoffreMemoire() })
        #endif
    }

    // MARK: Côté app

    /// Recopie l'adresse de la tour (nil : l'efface, à la déconnexion). Rien
    /// n'est réécrit si elle n'a pas changé.
    public func publier(_ base: URL?) {
        let texte = base.flatMap { ClientAPI.normaliserAdresse($0.absoluteString) }?.absoluteString
        guard adresse.lire() != texte else { return }
        adresse.ecrire(texte)
    }

    // MARK: Côté extension

    /// L'adresse recopiée par l'app, nil si elle ne l'a jamais fait.
    public var adresseTour: URL? {
        adresse.lire().flatMap(ClientAPI.normaliserAdresse)
    }

    /// Un client prêt (adresse + jeton lus dans le trousseau, rien d'écrit),
    /// ou `ErreurPartage.nonConnecte` : « Ouvre Rémy une fois pour te connecter ».
    public func client(session: URLSession? = nil) throws -> ClientAPI {
        guard let base = adresseTour else { throw ErreurPartage.nonConnecte }
        let coffre = CoffreLecture(jeton(base))
        guard coffre.lire() != nil else { throw ErreurPartage.nonConnecte }
        return ClientAPI(base: base, session: session, coffre: coffre)
    }
}

/// Les liens qui ouvrent l'app (schéma « remy », 24/10) : un widget, la
/// feuille de partage, un raccourci. Inconnu : l'app s'ouvre, sans plus.
public enum LienRemy: Equatable, Sendable {
    /// remy://capture : la feuille « + » ouverte.
    case capture
    /// remy://aujourdhui, remy://remy, remy://projets : l'onglet.
    case onglet(AppModel.Onglet)

    public static let schema = "remy"

    public init?(url: URL) {
        guard url.scheme?.lowercased() == Self.schema else { return nil }
        // « remy://capture » : l'hôte ; « remy:capture » : le chemin.
        let nom = (url.host ?? url.path).trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
        switch nom {
        case "capture": self = .capture
        case "aujourdhui": self = .onglet(.aujourdhui)
        case "remy": self = .onglet(.remy)
        case "projets": self = .onglet(.projets)
        default: return nil
        }
    }

    public var url: URL {
        switch self {
        case .capture: return URL(string: "remy://capture")!
        case .onglet(.aujourdhui): return URL(string: "remy://aujourdhui")!
        case .onglet(.remy): return URL(string: "remy://remy")!
        case .onglet(.projets): return URL(string: "remy://projets")!
        }
    }
}
