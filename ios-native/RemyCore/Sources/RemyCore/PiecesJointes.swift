import Foundation

// MARK: - Les pièces jointes du chat (12/11)
//
// Une image, un PDF ou un texte joint à un message. L'iPhone prépare la pièce
// (photo réduite en JPEG, texte reconnu sur l'appareil par Vision), la tour la
// range CHIFFRÉE et lit ce qu'elle peut (texte, PDF, OCR, modèle de vision
// local) ; le fil montre chaque pièce et ce que Rémy en a lu, ou pourquoi non.
// Mêmes limites et mêmes mots que la tour (lib/pieces.js) et le site.

/// Une pièce envoyée, telle que la tour la décrit (sans le texte lu).
public struct PieceJointe: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var nom: String
    public var type: String?
    /// « image », « pdf » ou « texte ».
    public var famille: String?
    public var taille: Int?
    /// « texte », « ocr », « decrite » ou « non ».
    public var lu: String?
    /// D'où vient le texte reconnu d'une image : « iphone » ou « tour ».
    public var par: String?
    public var pages: Int?
    public var caracteres: Int?
    public var tronque: Bool?
    public var decrite: Bool?
    /// Pourquoi rien n'a été lu (dit par la tour).
    public var raison: String?
    /// Ce qui s'est passé, en clair (« lue par Rémy », « non lue par Rémy : … »).
    public var mention: String?

    public init(id: String, nom: String, type: String? = nil, famille: String? = nil, taille: Int? = nil, lu: String? = nil,
                par: String? = nil, pages: Int? = nil, caracteres: Int? = nil, tronque: Bool? = nil, decrite: Bool? = nil,
                raison: String? = nil, mention: String? = nil) {
        self.id = id
        self.nom = nom
        self.type = type
        self.famille = famille
        self.taille = taille
        self.lu = lu
        self.par = par
        self.pages = pages
        self.caracteres = caracteres
        self.tronque = tronque
        self.decrite = decrite
        self.raison = raison
        self.mention = mention
    }

    enum CodingKeys: String, CodingKey {
        case id, nom, type, famille, taille, lu, par, pages, caracteres, tronque, decrite, raison, mention
    }

    /// Tolérante champ par champ : une fiche mal formée ne doit jamais
    /// empêcher d'ouvrir la conversation.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? ""
        nom = (try? c.decodeIfPresent(String.self, forKey: .nom)) ?? "pièce"
        type = try? c.decodeIfPresent(String.self, forKey: .type)
        famille = try? c.decodeIfPresent(String.self, forKey: .famille)
        taille = try? c.decodeIfPresent(Int.self, forKey: .taille)
        lu = try? c.decodeIfPresent(String.self, forKey: .lu)
        par = try? c.decodeIfPresent(String.self, forKey: .par)
        pages = try? c.decodeIfPresent(Int.self, forKey: .pages)
        caracteres = try? c.decodeIfPresent(Int.self, forKey: .caracteres)
        tronque = try? c.decodeIfPresent(Bool.self, forKey: .tronque)
        decrite = try? c.decodeIfPresent(Bool.self, forKey: .decrite)
        raison = try? c.decodeIfPresent(String.self, forKey: .raison)
        mention = try? c.decodeIfPresent(String.self, forKey: .mention)
    }

    /// Une vignette est possible (l'iPhone sait dessiner le HEIC aussi).
    public var estImage: Bool { (famille ?? PiecesJointes.famille(nom)) == "image" }
    /// Lue, en tout ou en partie, par Rémy.
    public var estLue: Bool { lu == "texte" || lu == "ocr" || lu == "decrite" }

    /// La phrase sous la pièce : celle de la tour, sinon la même règle.
    public var libelle: String {
        if let m = mention, !m.isEmpty { return m }
        switch lu {
        case "texte": return famille == "pdf" ? "lue par Rémy (texte du PDF)" : "lue par Rémy"
        case "ocr": return (par == "iphone" ? "texte reconnu sur l'iPhone" : "texte reconnu sur la tour") + " — peut se tromper"
        case "decrite": return "décrite par le modèle local — peut se tromper"
        default: return "non lue par Rémy" + (raison.map { " : \($0)" } ?? "")
        }
    }

    /// « 240 Ko · 3 p. »
    public var detail: String {
        var t = PiecesJointes.tailleLisible(taille ?? 0)
        if let p = pages { t += " · \(p) p." }
        return t
    }
}

/// Une pièce prête à partir, dans le composeur.
public struct PieceAEnvoyer: Identifiable, Equatable, Sendable {
    public let id: UUID
    public var nom: String
    /// L'original envoyé (une photo : JPEG réduit à `coteOriginal` px).
    public var donnees: Data
    /// Le texte reconnu sur l'iPhone (Vision), s'il y en a.
    public var texteLu: String?
    /// L'iPhone a cherché du texte (même sans en trouver) : la tour ne relit pas.
    public var lecture: Bool
    /// L'image réduite à `coteVision` px, pour le modèle de vision local de la tour.
    public var apercu: Data?
    /// Une petite image pour la puce du composeur.
    public var vignette: Data?
    /// Déjà sur la tour (un envoi revenu au composeur) : sa fiche, et le fil
    /// où elle est rangée (pour un autre fil, elle repart).
    public var fiche: PieceJointe?
    public var ficheConversation: String?
    public var envoi = false

    public init(id: UUID = UUID(), nom: String, donnees: Data, texteLu: String? = nil, lecture: Bool = false,
                apercu: Data? = nil, vignette: Data? = nil, fiche: PieceJointe? = nil) {
        self.id = id
        self.nom = nom
        self.donnees = donnees
        self.texteLu = texteLu
        self.lecture = lecture
        self.apercu = apercu
        self.vignette = vignette
        self.fiche = fiche
    }

    public var famille: String? { PiecesJointes.famille(nom) }
    public var taille: Int { fiche?.taille ?? donnees.count }
}

/// Ce que la tour a essayé (Réglages › Diagnostic › « Essayer la lecture des pièces »).
public struct EssaiPieces: Decodable, Equatable, Sendable {
    public struct Ligne: Decodable, Equatable, Sendable, Identifiable {
        public var cle: String
        public var libelle: String
        public var ok: Bool
        public var detail: String
        public var id: String { cle }
    }
    public var lignes: [Ligne]
    public var diagnostic: String
}

public enum PiecesJointes {
    public static let capacite = "pieces-v1"
    public static let pieceMax = 10 * 1024 * 1024
    public static let parMessage = 4
    /// Le côté le plus long d'une photo envoyée (l'original gardé) et de l'aperçu
    /// montré au modèle de vision local.
    public static let coteOriginal = 3000
    public static let coteVision = 1344
    /// Le texte reconnu sur l'iPhone, au plus (la tour coupe au même endroit).
    public static let texteMax = 8000

    static let familles: [String: String] = [
        "png": "image", "jpg": "image", "jpeg": "image", "webp": "image", "heic": "image", "heif": "image",
        "pdf": "pdf", "txt": "texte", "md": "texte", "markdown": "texte",
    ]

    public static func extensionDe(_ nom: String) -> String {
        guard let point = nom.lastIndex(of: ".") else { return "" }
        let ext = nom[nom.index(after: point)...].lowercased()
        return ext.count <= 10 ? ext : ""
    }

    public static func famille(_ nom: String) -> String? { familles[extensionDe(nom)] }

    public static func tailleLisible(_ o: Int) -> String {
        if o < 1024 { return "\(o) o" }
        if o < 1024 * 1024 { return "\(max(1, Int((Double(o) / 1024).rounded()))) Ko" }
        let mo = (Double(o) / (1024 * 1024) * 10).rounded() / 10
        let t = mo == mo.rounded() ? String(Int(mo)) : String(format: "%.1f", mo).replacingOccurrences(of: ".", with: ",")
        return "\(t) Mo"
    }

    /// Nil si la pièce peut être jointe ; sinon la phrase qui dit pourquoi non.
    public static func refus(nom: String, taille: Int, deja: Int) -> String? {
        if deja >= parMessage { return "\(parMessage) pièces au plus par message : envoie celles-ci d'abord." }
        if famille(nom) == nil { return "« \(nom) » : type non pris. Images (PNG, JPEG, HEIC, WebP), PDF, et texte (.txt, .md)." }
        if taille <= 0 { return "« \(nom) » est vide." }
        if taille > pieceMax { return "« \(nom) » est trop lourd (\(tailleLisible(taille))) : \(tailleLisible(pieceMax)) au plus." }
        return nil
    }

    /// Le nom d'une photo (photothèque, appareil photo), qui n'en a pas.
    public static func nomPhoto(_ d: Date = Date(), calendrier: Calendar = .current) -> String {
        let c = calendrier.dateComponents([.year, .month, .day, .hour, .minute, .second], from: d)
        func deux(_ n: Int?) -> String { String(format: "%02d", n ?? 0) }
        return "photo-\(c.year ?? 0)\(deux(c.month))\(deux(c.day))-\(deux(c.hour))\(deux(c.minute))\(deux(c.second)).jpg"
    }

    /// Le nom d'une photo venue de Fichiers, une fois réduite en JPEG.
    public static func enJPEG(_ nom: String) -> String {
        let ext = extensionDe(nom)
        guard !ext.isEmpty else { return nom + ".jpg" }
        if ext == "jpg" || ext == "jpeg" { return nom }
        return String(nom.dropLast(ext.count)) + "jpg"
    }

    /// La taille qui tient dans `cote` px, proportions gardées, jamais agrandie.
    public static func reduction(largeur: Int, hauteur: Int, cote: Int) -> (largeur: Int, hauteur: Int)? {
        guard largeur > 0, hauteur > 0 else { return nil }
        let k = min(1, Double(cote) / Double(max(largeur, hauteur)))
        return (max(1, Int((Double(largeur) * k).rounded())), max(1, Int((Double(hauteur) * k).rounded())))
    }

    /// Le corps d'un envoi (POST /api/conversations/:id/pieces).
    public static func corps(_ p: PieceAEnvoyer) -> [String: Any] {
        var c: [String: Any] = ["nom": p.nom, "donnees": p.donnees.base64EncodedString()]
        if let t = p.texteLu?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty { c["texte"] = String(t.prefix(texteMax)) }
        if p.lecture { c["lecture"] = "iphone" }
        if let a = p.apercu { c["apercu"] = a.base64EncodedString() }
        return c
    }
}
