import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// MARK: - La feuille de partage : ce qui part, et comment (24/10)
//
// Depuis n'importe quelle app, Sam partage un texte, un lien ou une image vers
// Rémy. Le texte et le lien partent par la capture (POST /api/capture, source
// « partage ») ; une image par POST /api/capture/image : la tour la range dans
// le coffre et n'apprend que du texte que l'iPhone y a lu (Vision, sur
// l'appareil), avec le modèle local seulement.
// Ce fichier ne dépend ni d'UIKit ni de Vision : la préparation se teste sous
// Linux, l'extension (RemyPartage) ne fait que lire les pièces jointes.

/// Une image prête à partir : déjà réduite et compressée (JPEG) par l'extension.
public struct ImagePartagee: Equatable, Sendable {
    public var donnees: Data
    public var largeur: Int
    public var hauteur: Int
    /// Le texte lu sur l'image par l'iPhone (capture d'écran), nil s'il n'y en a pas.
    public var texteLu: String?

    public init(donnees: Data, largeur: Int, hauteur: Int, texteLu: String? = nil) {
        self.donnees = donnees
        self.largeur = largeur
        self.hauteur = hauteur
        let t = texteLu?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.texteLu = (t?.isEmpty ?? true) ? nil : t
    }

    /// Le nombre de lignes lues (aperçu : « 12 lignes lues sur l'image »).
    public var lignesLues: Int {
        texteLu?.split(separator: "\n", omittingEmptySubsequences: true).count ?? 0
    }
}

/// Ce qui arrive d'une autre app, une fois démêlé : un texte, un lien (avec
/// son titre) et/ou une image.
public struct ContenuPartage: Equatable, Sendable {
    public var texte: String?
    public var lien: URL?
    public var titre: String?
    public var image: ImagePartagee?

    public enum Genre: Equatable, Sendable { case vide, texte, lien, image }

    /// `textes` : tout le texte reçu (pièces jointes, texte de l'élément) ;
    /// `liens` : les URL reçues. Un texte qui n'est qu'une adresse web devient
    /// le lien ; Safari et beaucoup d'apps envoient le lien deux fois (URL et
    /// texte) : il n'est gardé qu'une fois. Seuls http et https sont des liens.
    public init(textes: [String] = [], liens: [URL] = [], titre: String? = nil, image: ImagePartagee? = nil) {
        var restants: [String] = []
        var adresses = liens.filter(Self.estWeb)
        for brut in textes {
            let t = brut.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !t.isEmpty else { continue }
            if let u = Self.lienSeul(t) {
                if !adresses.contains(where: { Self.meme($0, u) }) { adresses.append(u) }
            } else if !restants.contains(t) {
                restants.append(t)
            }
        }
        let lien = adresses.first
        var texte = restants.joined(separator: "\n\n")
        var nom = titre?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let lien {
            // « Titre de la page https://… » : l'adresse sort du texte.
            texte = texte.replacingOccurrences(of: lien.absoluteString, with: "").trimmingCharacters(in: .whitespacesAndNewlines)
            // Ce qui reste d'une seule ligne courte, c'est le titre du lien.
            if (nom ?? "").isEmpty, !texte.isEmpty, !texte.contains("\n"), texte.count <= 140 {
                nom = texte
                texte = ""
            }
            if let n = nom, Self.meme(lien, URL(string: n)) { nom = nil }
        }
        self.texte = texte.isEmpty ? nil : texte
        self.lien = lien
        self.titre = (nom ?? "").isEmpty ? nil : nom
        self.image = image
    }

    public var genre: Genre {
        if image != nil { return .image }
        if lien != nil { return .lien }
        if texte != nil { return .texte }
        return .vide
    }

    static func estWeb(_ u: URL) -> Bool {
        guard let s = u.scheme?.lowercased(), s == "http" || s == "https" else { return false }
        return !(u.host ?? "").isEmpty
    }

    /// Le texte n'est qu'une adresse web (sans espace ni autre mot).
    static func lienSeul(_ t: String) -> URL? {
        guard !t.contains(where: { $0.isWhitespace }), let u = URL(string: t), estWeb(u) else { return nil }
        return u
    }

    /// Même adresse, à la barre finale et à la casse de l'hôte près.
    static func meme(_ a: URL, _ b: URL?) -> Bool {
        guard let b else { return false }
        func cle(_ u: URL) -> String {
            var s = u.absoluteString
            if let h = u.host { s = s.replacingOccurrences(of: h, with: h.lowercased()) }
            while s.hasSuffix("/") { s.removeLast() }
            return s
        }
        return cle(a) == cle(b)
    }
}

/// Préparer l'envoi : le texte qui part, ce qui manque, ce qu'on peut copier.
public enum EnvoiPartage {
    public static let source = "partage"
    /// En dessous, la tour refuse la capture (« trop court », lib/capture.js).
    static let minCaracteres = 30
    public static let motMax = 500
    /// La tour laisse 180 s au modèle local (lib/glm.js) : abandonner avant,
    /// c'est dire « vérifie Tailscale » à tort, et « Réessayer » ferait un doublon.
    static let delai: TimeInterval = 200

    /// Une image : le grand côté (pixels) et le poids visés. La tour en accepte
    /// 3 Mo ; on reste loin en dessous pour un envoi rapide en 4G.
    public static let coteImage = 1600
    public static let poidsImage = 1_500_000
    /// Les qualités JPEG essayées, de la meilleure à la plus légère.
    public static let qualitesImage: [Double] = [0.75, 0.6, 0.45, 0.3]

    /// Les dimensions d'une image réduite à `cote` pixels au plus (jamais agrandie).
    public static func dimensions(largeur: Int, hauteur: Int, cote: Int = coteImage) -> (largeur: Int, hauteur: Int) {
        guard largeur > 0, hauteur > 0 else { return (0, 0) }
        let plus = max(largeur, hauteur)
        guard plus > cote else { return (largeur, hauteur) }
        let r = Double(cote) / Double(plus)
        return (max(1, Int((Double(largeur) * r).rounded())), max(1, Int((Double(hauteur) * r).rounded())))
    }

    static func mot(_ m: String?) -> String? {
        let t = m?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? nil : t
    }

    /// Le texte de la capture (texte ou lien), avec le mot de Sam s'il y en a un.
    public static func texteCapture(_ c: ContenuPartage, mot m: String?) -> String {
        var parties: [String] = []
        if let lien = c.lien {
            parties.append("Lien partagé : " + (c.titre.map { "« \($0) »\n" } ?? "") + lien.absoluteString)
        }
        if let t = c.texte { parties.append(t) }
        if let m = mot(m) { parties.append("Mon mot pour Rémy : \(m)") }
        return parties.joined(separator: "\n\n")
    }

    /// Ce qui empêche l'envoi, dit à Sam sous le bouton ; nil : prêt à partir.
    public static func manque(_ c: ContenuPartage, mot m: String?) -> String? {
        if (m ?? "").count > motMax { return "Ton mot dépasse \(motMax) caractères : raccourcis-le." }
        switch c.genre {
        case .vide:
            return "Rien à envoyer : ce partage ne contient ni texte, ni lien, ni image."
        case .image:
            return nil
        case .texte, .lien:
            return texteCapture(c, mot: m).count < minCaracteres
                ? "Un peu court pour que Rémy en tire quelque chose : ajoute un mot pour lui."
                : nil
        }
    }

    /// De quoi ne rien perdre si l'envoi échoue (« Copier »).
    public static func texteACopier(_ c: ContenuPartage, mot m: String?) -> String {
        if c.genre == .image {
            // Le lien et le texte joints à l'image ne se perdent pas non plus.
            let joints = texteCapture(c, mot: nil)
            return [c.image?.texteLu, joints.isEmpty ? nil : joints, mot(m).map { "Mon mot pour Rémy : \($0)" }].compactMap { $0 }.joined(separator: "\n\n")
        }
        return texteCapture(c, mot: m)
    }

    /// Le corps de POST /api/capture/image.
    static func corpsImage(_ c: ContenuPartage, _ image: ImagePartagee, mot m: String?) -> [String: Any] {
        var corps: [String: Any] = ["image": image.donnees.base64EncodedString(), "source": source]
        if let t = image.texteLu { corps["texte"] = t }
        if let m = mot(m) { corps["mot"] = String(m.prefix(motMax)) }
        if let n = c.titre { corps["titre"] = n }
        // Partagés avec l'image (une app de vente : image, lien, titre) : ils partent aussi.
        if let l = c.lien { corps["lien"] = l.absoluteString }
        if let t = c.texte { corps["joint"] = String(t.prefix(8_000)) }
        return corps
    }
}

/// Le reçu affiché après l'envoi : un titre qui dit vrai (classé, image
/// rangée, ou gardé pour la nuit) et ce que Rémy en a fait.
public struct RecuPartage: Equatable, Sendable {
    public let titre: String
    public let detail: String

    public init(_ r: RetourCapture) {
        // « Classé » seulement si la mémoire a bougé (ou savait déjà) ; sinon on dit ce qui s'est passé.
        titre = r.ajouts?.isEmpty == false || r.memoire != false ? "J'ai compris. Classé."
            : r.message?.hasPrefix("Image") == true ? (r.image != nil ? "Image rangée." : "Image reçue.")
            : "Gardé, pas encore classé."
        var d = r.ajouts?.isEmpty == false || r.message == nil ? r.phrase : (r.message ?? r.phrase)
        // L'image est gardée même quand le modèle n'a rien appris : on le dit.
        if r.image != nil, !d.hasPrefix("Image") { d = "Image gardée sur ta tour. " + d }
        detail = d
    }
}

/// Un envoi qui n'a pas abouti, en clair : quoi, et quoi faire.
public struct EchecPartage: Equatable, Sendable, Error {
    public let titre: String
    public let detail: String
    /// Réessayer a un sens (tour injoignable, refus passager) ; pas quand
    /// l'iPhone n'est pas connecté : il faut d'abord ouvrir Rémy.
    public let reessayable: Bool

    public init(titre: String, detail: String, reessayable: Bool) {
        self.titre = titre
        self.detail = detail
        self.reessayable = reessayable
    }

    public init(_ e: Error) {
        switch e {
        case let e as EchecPartage:
            self = e
        case ErreurPartage.nonConnecte:
            self.init(titre: "Ouvre Rémy une fois", detail: "Cet iPhone ne sait pas encore parler à ta tour : ouvre l'app Rémy et connecte-toi, puis partage à nouveau.", reessayable: false)
        case ErreurAPI.nonConnecte:
            self.init(titre: "Ouvre Rémy pour te reconnecter", detail: "La tour ne reconnaît plus cet iPhone : ouvre l'app Rémy et reconnecte-toi, puis partage à nouveau.", reessayable: false)
        case ErreurAPI.reseau:
            self.init(titre: "Ta tour ne répond pas : vérifie Tailscale", detail: "Tailscale doit être actif sur l'iPhone et la tour allumée. Copie ce que tu partages pour ne rien perdre, puis réessaie.", reessayable: true)
        case ErreurAPI.serveur(_, let message):
            self.init(titre: "La tour a refusé", detail: message, reessayable: true)
        case ErreurAPI.illisible:
            self.init(titre: "Réponse illisible de la tour", detail: "Réessaie dans un instant ; si ça continue, mets ta tour à jour.", reessayable: true)
        default:
            self.init(titre: "Envoi impossible", detail: e.localizedDescription, reessayable: true)
        }
    }
}

extension ClientAPI {
    /// Envoie un partage à la tour et rend son reçu. Une tour pas encore à jour
    /// (pas de route d'image) ne reçoit rien : la capture ordinaire ne garderait
    /// pas le texte lu sur l'image au modèle local.
    public func partager(_ c: ContenuPartage, mot: String?) async throws -> RecuPartage {
        if let raison = EnvoiPartage.manque(c, mot: mot) {
            throw EchecPartage(titre: "Rien n'est parti", detail: raison, reessayable: false)
        }
        guard let image = c.image else {
            let r = try await capturer(EnvoiPartage.texteCapture(c, mot: mot), source: EnvoiPartage.source, delai: EnvoiPartage.delai)
            return RecuPartage(r)
        }
        do {
            let r = try await json(RetourCapture.self, "api/capture/image", methode: "POST",
                                   corps: EnvoiPartage.corpsImage(c, image, mot: mot), delai: EnvoiPartage.delai)
            return RecuPartage(r)
        } catch ErreurAPI.serveur(let code, _) where code == 404 {
            throw EchecPartage(titre: "Ta tour ne sait pas encore recevoir d'images",
                               detail: "Mets-la à jour (installeur de la tour), puis partage à nouveau. En attendant, « Copier » garde l'image et son texte ; un texte ou un lien passe déjà.",
                               reessayable: false)
        }
    }
}
