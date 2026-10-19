import Foundation

/// Un événement du flux de réponse de Rémy (Server-Sent Events).
public struct EvenementSSE: Equatable, Sendable {
    public var nom: String
    public var donnees: String

    public init(nom: String, donnees: String) {
        self.nom = nom
        self.donnees = donnees
    }

    /// Les données JSON décodées dans le type demandé (nil si illisible).
    public func decode<T: Decodable>(_ type: T.Type) -> T? {
        guard let d = donnees.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(T.self, from: d)
    }
}

/// Lit le flux octet par octet. Le réseau mobile découpe les paquets n'importe
/// où — au milieu d'une ligne, voire au milieu d'un caractère accentué : on ne
/// décode une ligne qu'une fois complète, jamais un morceau.
public struct ParseurSSE: Sendable {
    private var ligne: [UInt8] = []
    private var nom = ""
    private var donnees: [String] = []

    public init() {}

    public mutating func alimenter(_ octets: some Sequence<UInt8>) -> [EvenementSSE] {
        var sortie: [EvenementSSE] = []
        for o in octets {
            if o == 0x0A { // \n
                if let e = traiterLigne() { sortie.append(e) }
            } else {
                ligne.append(o)
            }
        }
        return sortie
    }

    /// Fin du flux : un dernier événement sans ligne vide finale compte quand même.
    public mutating func terminer() -> [EvenementSSE] {
        var sortie: [EvenementSSE] = []
        if !ligne.isEmpty, let e = traiterLigne() { sortie.append(e) }
        if let e = emettre() { sortie.append(e) }
        return sortie
    }

    private mutating func traiterLigne() -> EvenementSSE? {
        if ligne.last == 0x0D { ligne.removeLast() } // \r\n
        let texte = String(decoding: ligne, as: UTF8.self)
        ligne.removeAll(keepingCapacity: true)
        if texte.isEmpty { return emettre() }
        if texte.hasPrefix(":") { return nil } // commentaire / battement de cœur
        let (champ, valeur): (Substring, Substring)
        if let i = texte.firstIndex(of: ":") {
            champ = texte[..<i]
            var v = texte[texte.index(after: i)...]
            if v.first == " " { v = v.dropFirst() }
            valeur = v
        } else {
            champ = Substring(texte)
            valeur = ""
        }
        switch champ {
        case "event": nom = String(valeur)
        case "data": donnees.append(String(valeur))
        default: break
        }
        return nil
    }

    private mutating func emettre() -> EvenementSSE? {
        defer { nom = ""; donnees = [] }
        guard !donnees.isEmpty else { return nil }
        return EvenementSSE(nom: nom.isEmpty ? "message" : nom, donnees: donnees.joined(separator: "\n"))
    }
}

/// Les marqueurs internes ([SESSION-FAITE:…], [COUVERT:…], [TRAITE:…]) sont
/// retirés par le serveur, mais ils traversent le flux caractère par caractère :
/// sans ce filtre, Sam les verrait s'écrire quelques secondes. Un marqueur en
/// cours de frappe (crochet ouvert, pas refermé) est aussi masqué — mais pas un
/// lien markdown « [texte](url) » en train de s'écrire.
public enum Marqueurs {
    static let noms = ["SESSION-FAITE", "COUVERT", "TRAITE"]

    public static func retirer(_ texte: String) -> String {
        var t = texte
        if let re = try? NSRegularExpression(pattern: #"\[(?:SESSION-FAITE|COUVERT|TRAITE):[^\]]*\]"#, options: [.caseInsensitive]) {
            t = re.stringByReplacingMatches(in: t, range: NSRange(t.startIndex..., in: t), withTemplate: "")
        }
        if let i = t.lastIndex(of: "["), !t[i...].contains("]") {
            let suite = t[t.index(after: i)...].uppercased()
            let nom = suite.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
            if noms.contains(where: { $0.hasPrefix(nom) }) { t = String(t[..<i]) }
        }
        while let dernier = t.last, dernier.isWhitespace { t.removeLast() }
        return t
    }
}
