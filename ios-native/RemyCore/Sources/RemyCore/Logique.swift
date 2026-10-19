import Foundation

/// Les calculs d'affichage, identiques à ceux du site (public/index.html) pour
/// que l'app et le web ne donnent jamais deux chiffres différents.

public enum EtatMoment: String, Sendable {
    case passe, encours, avenir
}

public enum Jour {
    /// Passé / en cours / à venir, recalculé avec l'heure du téléphone : la
    /// frise bouge toute seule entre deux rechargements.
    public static func etat(_ e: ElementJour, maintenant: Millis) -> EtatMoment {
        if e.finEffective <= maintenant { return .passe }
        if e.debut <= maintenant { return .encours }
        return .avenir
    }

    public enum Prochain: Equatable, Sendable {
        case enCours(ElementJour)
        case suivant(ElementJour)
        case aFaire(TacheResume, total: Int)
        /// Plus rien à heure fixe ; `retards` tâches restent en retard.
        case rienDePrevu(retards: Int)
        /// Rien de branché : ni Motion, ni l'agenda.
        case aucuneSource
        /// Branché, mais rien ne répond en ce moment.
        case enPanne
        case inconnu
    }

    public static func prochain(_ j: Journee?, maintenant: Millis) -> Prochain {
        guard let j else { return .inconnu }
        if j.sources?.aucune == true { return .aucuneSource }
        if j.sources?.enPanne == true { return .enPanne }
        let items = j.items ?? []
        if let e = items.first(where: { etat($0, maintenant: maintenant) == .encours }) { return .enCours(e) }
        if let e = items.first(where: { etat($0, maintenant: maintenant) == .avenir }) { return .suivant(e) }
        if let t = j.aFaire?.first { return .aFaire(t, total: j.aFaire?.count ?? 1) }
        return .rienDePrevu(retards: j.retard?.total ?? 0)
    }

    /// Position (0…1) d'un instant dans la journée.
    public static func position(_ ms: Millis, debutJour: Millis) -> Double {
        min(1, max(0, (ms - debutJour) / 86_400_000))
    }

    /// La journée affichée n'est pas celle d'aujourd'hui (app restée ouverte
    /// depuis la veille, rechargement raté) : l'afficher tromperait.
    public static func estPerimee(_ j: Journee?, maintenant: Date) -> Bool {
        guard let jour = j?.jour else { return false }
        return jour != Format.jourISO(maintenant)
    }
}

/// Les fils nommés par l'app, avec le MÊME titre que le site : un fil ouvert
/// d'un côté se retrouve de l'autre, sans doublon.
public enum Fils {
    public static func journee(_ d: Date) -> String { Format.dateFil(d) + " · Journée" }
    public static func nocturne(_ d: Date) -> String { Format.dateFil(d) + " · Nocturne" }

    /// Un fil « Journée » ou « Nocturne » d'un autre jour : rangé à part dans la liste.
    public static func estAncienFilDuJour(_ titre: String, maintenant: Date) -> Bool {
        guard titre.range(of: #"^\d{2}/\d{2}/\d{4} · (Journée|Nocturne)$"#, options: .regularExpression) != nil else { return false }
        return !titre.hasPrefix(Format.dateFil(maintenant))
    }
}

/// La réflexion date-t-elle de la nuit dernière ? (générée depuis hier 18 h)
public enum Nuit {
    public static func estRecente(_ generatedAt: Millis?, maintenant: Date) -> Bool {
        guard let g = generatedAt else { return false }
        let hier18h = Format.debutDuJour(maintenant).addingTimeInterval(-6 * 3600)
        return g.date >= hier18h
    }
}

public enum Onboarding {
    /// Même formule que le site : repères couverts / repères totaux ; une
    /// session cochée à la main vaut 100 %.
    public static func pct(_ s: SessionOnboarding, _ e: EtatOnboarding) -> Int {
        if e.etats?[s.id] == "faite" { return 100 }
        let reperes = s.reperes ?? []
        guard !reperes.isEmpty else { return 0 }
        let connus = Set(reperes.map(\.id))
        let couverts = Set(e.couverture?[s.id] ?? []).intersection(connus)
        return Int((Double(couverts.count) / Double(reperes.count) * 100).rounded())
    }

    public static func global(_ e: EtatOnboarding) -> Int {
        let s = e.sessions ?? []
        guard !s.isEmpty else { return 0 }
        return Int((Double(s.map { pct($0, e) }.reduce(0, +)) / Double(s.count)).rounded())
    }

    public static func reste(_ s: SessionOnboarding, _ e: EtatOnboarding) -> [Repere] {
        if e.etats?[s.id] == "faite" { return [] }
        let couverts = Set(e.couverture?[s.id] ?? [])
        return (s.reperes ?? []).filter { !couverts.contains($0.id) }
    }

    public static func faites(_ e: EtatOnboarding) -> Int {
        (e.sessions ?? []).filter { e.etats?[$0.id] == "faite" }.count
    }

    /// La session à reprendre : celle en cours, sinon la première pas finie.
    public static func prochaine(_ e: EtatOnboarding) -> SessionOnboarding? {
        let s = e.sessions ?? []
        return s.first { e.etats?[$0.id] == "en_cours" }
            ?? s.first { e.etats?[$0.id] != "faite" && pct($0, e) < 100 }
    }
}

/// Le texte markdown de Rémy, découpé en blocs que l'interface sait dessiner.
/// Volontairement petit : titres, listes, code, paragraphes. Le gras,
/// l'italique et les liens sont rendus par le système (AttributedString).
public enum BlocTexte: Equatable, Sendable {
    case titre(String)
    case paragraphe(String)
    case puce(String)
    case numero(Int, String)
    case code(String)
    /// Un tableau markdown (« | a | b | » + ligne « |---|---| ») : en-têtes et
    /// lignes, toutes ramenées au nombre de colonnes des en-têtes.
    case tableau(entetes: [String], lignes: [[String]])
    /// « --- » seul sur sa ligne : un trait.
    case trait
    case espace
}

public enum Markdown {
    public static func blocs(_ texte: String) -> [BlocTexte] {
        var sortie: [BlocTexte] = []
        var code: [String]? = nil
        var numero = 0
        let lignesTexte = texte.components(separatedBy: "\n")
        var i = 0
        while i < lignesTexte.count {
            let brute = lignesTexte[i]
            i += 1
            let ligne = brute.trimmingCharacters(in: .whitespaces)
            // Un tableau : une ligne à « | », suivie de sa ligne de séparation.
            if code == nil, ligne.contains("|"), i < lignesTexte.count,
               estSeparation(lignesTexte[i].trimmingCharacters(in: .whitespaces)) {
                let entetes = cellules(ligne)
                var lignes: [[String]] = []
                i += 1
                while i < lignesTexte.count {
                    let l = lignesTexte[i].trimmingCharacters(in: .whitespaces)
                    guard l.contains("|"), !l.isEmpty else { break }
                    var c = cellules(l)
                    if c.count < entetes.count { c += Array(repeating: "", count: entetes.count - c.count) }
                    lignes.append(Array(c.prefix(entetes.count)))
                    i += 1
                }
                sortie.append(.tableau(entetes: entetes, lignes: lignes))
                numero = 0
                continue
            }
            if code == nil, ligne.range(of: #"^(-{3,}|\*{3,}|_{3,})$"#, options: .regularExpression) != nil {
                sortie.append(.trait)
                continue
            }
            if ligne.hasPrefix("```") {
                if let c = code { sortie.append(.code(c.joined(separator: "\n"))); code = nil }
                else { code = [] }
                continue
            }
            if code != nil { code?.append(brute); continue }
            if ligne.isEmpty {
                if sortie.last != .espace && !sortie.isEmpty { sortie.append(.espace) }
                numero = 0
                continue
            }
            if let r = ligne.range(of: #"^#{1,4}\s+"#, options: .regularExpression) {
                sortie.append(.titre(String(ligne[r.upperBound...])))
            } else if let r = ligne.range(of: #"^[-•*]\s+"#, options: .regularExpression) {
                sortie.append(.puce(String(ligne[r.upperBound...])))
            } else if let r = ligne.range(of: #"^\d+[.)]\s+"#, options: .regularExpression) {
                numero += 1
                let n = Int(ligne[..<r.upperBound].filter(\.isNumber)) ?? numero
                sortie.append(.numero(n, String(ligne[r.upperBound...])))
            } else if brute.hasPrefix("  "), case .puce(let p)? = sortie.last {
                sortie[sortie.count - 1] = .puce(p + " " + ligne) // suite de la puce
            } else {
                sortie.append(.paragraphe(ligne))
            }
        }
        if let c = code { sortie.append(.code(c.joined(separator: "\n"))) }
        while sortie.last == .espace { sortie.removeLast() }
        return sortie
    }

    /// « |---|:---:| » (deux colonnes au moins, ou une seule entourée de « | »).
    static func estSeparation(_ l: String) -> Bool {
        guard l.contains("-"), l.contains("|") || l.hasPrefix(":") else { return false }
        let c = cellules(l)
        return !c.isEmpty && c.allSatisfy { $0.range(of: #"^:?-{1,}:?$"#, options: .regularExpression) != nil }
    }

    /// Les cellules d'une ligne de tableau, sans les « | » du bord ; « \| » reste un caractère.
    static func cellules(_ l: String) -> [String] {
        var t = l
        if t.hasPrefix("|") { t.removeFirst() }
        if t.hasSuffix("|") && !t.hasSuffix("\\|") { t.removeLast() }
        var sortie: [String] = []
        var courant = ""
        var echappe = false
        for ch in t {
            if echappe { courant.append(ch); echappe = false; continue }
            if ch == "\\" { echappe = true; continue }
            if ch == "|" { sortie.append(courant.trimmingCharacters(in: .whitespaces)); courant = ""; continue }
            courant.append(ch)
        }
        sortie.append(courant.trimmingCharacters(in: .whitespaces))
        return sortie
    }
}
