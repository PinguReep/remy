import Foundation

// MARK: - Chercher dans Projets (12/11)
//
// Le champ en haut de Projets cherche dans ce que l'app a déjà en mémoire —
// projets Motion et leurs tâches, dossiers et leurs idées, listes et leurs
// articles, rappels (et leur note) —, sans IA, sans réseau, sans accents ni
// majuscules : chaque mot de la saisie doit commencer un mot du texte, dans
// n'importe quel ordre (« lait avo » trouve « Lait d'avoine »). Les résultats
// sont groupés par genre, le texte découpé en morceaux pour mettre en évidence
// ce qui a été trouvé, chacun avec l'écran qu'il ouvre. La vue ne fait
// qu'afficher. Même logique sur le site : public/app/analyse/recherche-projets.js.

/// Un morceau du titre d'un résultat ; `trouve` : à mettre en évidence.
public struct MorceauTrouve: Equatable, Sendable {
    public let texte: String
    public let trouve: Bool
    public init(texte: String, trouve: Bool) {
        self.texte = texte
        self.trouve = trouve
    }
}

/// Ce qu'un résultat est, dans l'ordre de l'écran.
public enum GenreTrouve: String, CaseIterable, Sendable {
    case projet, tache, dossier, note, liste, article, rappel

    public var titre: String {
        switch self {
        case .projet: return "Projets Motion"
        case .tache: return "Tâches"
        case .dossier: return "Dossiers"
        case .note: return "Idées et notes"
        case .liste: return "Listes"
        case .article: return "Articles"
        case .rappel: return "Rappels"
        }
    }
}

/// L'écran qu'un résultat ouvre.
public enum CibleTrouvee: Equatable, Sendable {
    /// Un projet Motion (son identifiant Motion).
    case projet(String)
    /// Une tâche (son projet renseigné) et le nœud où elle vit : le
    /// sous-projet où elle est rangée, sinon « motion:<id du projet> ».
    case tache(TacheResume, noeud: String)
    /// Un dossier de Remy (aussi pour une de ses idées).
    case dossier(String)
    /// Une liste (aussi pour un de ses articles).
    case liste(String)
    /// Un rappel (son identifiant).
    case rappel(String)
}

public struct ElementTrouve: Identifiable, Equatable, Sendable {
    /// Unique dans tous les résultats : « <genre>:<identifiant> ».
    public let id: String
    public let genre: GenreTrouve
    public let titre: String
    /// Où il vit, ou ce qu'il en reste (« Boutique › Démo client », « Courses », « 2 à prendre »…).
    public let contexte: String?
    /// Fait, pris, relu : affiché après ce qui reste à faire.
    public let fait: Bool
    /// L'heure d'un rappel (la vue la met en forme).
    public let quand: Millis?
    public let morceaux: [MorceauTrouve]
    public let cible: CibleTrouvee
    let note: Int
    let rang: Int
}

public struct GroupeTrouve: Identifiable, Equatable, Sendable {
    public let genre: GenreTrouve
    /// Les premiers (au plus `RechercheProjets.parGroupe`).
    public let elements: [ElementTrouve]
    /// Combien d'autres ne sont pas montrés.
    public let reste: Int

    public var id: String { genre.rawValue }
    public var titre: String { genre.titre }
    public var total: Int { elements.count + reste }
}

/// Ce que montre la recherche pour une saisie.
public struct ResultatsProjets: Equatable, Sendable {
    /// La saisie, sans espaces autour.
    public let requete: String
    /// Rien à chercher (saisie vide, ou sans un mot) : l'écran reste tel quel.
    public let vide: Bool
    public let groupes: [GroupeTrouve]
    public let total: Int
    /// Les projets Motion n'étaient pas encore lus : leurs tâches manquent.
    public let sansProjets: Bool

    /// Au-dessus des résultats : combien.
    public var enTete: String? {
        guard total > 0 else { return nil }
        return total == 1 ? "1 résultat" : "\(total) résultats"
    }

    /// L'état vide : la phrase principale.
    public var titreVide: String? {
        guard !vide, total == 0 else { return nil }
        return "Rien pour « \(requete) »."
    }

    /// L'état vide : pourquoi, et quoi faire.
    public var detailVide: String? {
        guard !vide, total == 0 else { return nil }
        let base = "Aucun projet, tâche, dossier, idée, liste, article ni rappel ne contient un mot qui commence ainsi. Essaie un autre mot, ou son début."
        return sansProjets ? base + " Tes projets Motion ne sont pas encore lus : leurs tâches n'y sont pas." : base
    }
}

public enum RechercheProjets {
    /// Au plus, par genre : au-delà, « et N autres ».
    public static let parGroupe = 20

    /// « et 4 autres : précise ta recherche ».
    public static func phraseReste(_ n: Int) -> String {
        "et \(n) autre\(n > 1 ? "s" : "") : précise ta recherche"
    }

    /// Ce que montre la recherche pour une saisie, dans ce que l'app a lu.
    /// `projets` : nil s'ils ne sont pas encore lus. Les mieux notés d'abord,
    /// ce qui reste à faire avant ce qui est fait, puis l'ordre lu.
    public static func chercher(_ requete: String, projets: [Projet]?, dossiers: [Dossier], listes: [Liste], rappels: [Rappel],
                                limite: Int = RechercheProjets.parGroupe) -> ResultatsProjets {
        let propre = requete.trimmingCharacters(in: .whitespacesAndNewlines)
        let q = RechercheReglages.motsRequete(propre)
        guard !q.isEmpty else {
            return ResultatsProjets(requete: propre, vide: true, groupes: [], total: 0, sansProjets: projets == nil)
        }
        let ps = projets ?? []
        var trouves: [GenreTrouve: [ElementTrouve]] = [:]
        var rang = 0
        func ajouter(_ genre: GenreTrouve, _ note: Int, id: String, titre: String, contexte: String?,
                     fait: Bool = false, quand: Millis? = nil, cible: CibleTrouvee) {
            guard note > 0 else { return }
            let e = ElementTrouve(id: genre.rawValue + ":" + id, genre: genre, titre: titre, contexte: contexte, fait: fait, quand: quand,
                                  morceaux: RechercheProjets.morceaux(titre, q), cible: cible, note: note, rang: rang)
            trouves[genre, default: []].append(e)
            rang += 1
        }

        var nomDossier: [String: String] = [:]
        for d in dossiers where nomDossier[d.id] == nil { nomDossier[d.id] = d.nom }
        var nomProjet: [String: String] = [:]
        for p in ps { nomProjet["motion:" + p.id] = p.nom }
        var rangeeDans: [String: Dossier] = [:]
        for d in dossiers {
            for t in d.taches where rangeeDans[t] == nil { rangeeDans[t] = d }
        }

        for p in ps {
            let contexte = p.taches == 0 ? "aucune tâche ouverte" : "\(p.taches) tâche\(p.taches > 1 ? "s" : "")"
            ajouter(.projet, noter(q, p.nom), id: p.id, titre: p.nom, contexte: contexte, cible: .projet(p.id))
        }
        var vues = Set<String>()
        for p in ps {
            for t in p.liste ?? [] where !vues.contains(t.id) {
                vues.insert(t.id)
                let d = rangeeDans[t.id]
                var tache = t
                if tache.projet == nil { tache.projet = p.nom }
                let contexte = d.map { p.nom + " › " + $0.nom } ?? p.nom
                ajouter(.tache, noter(q, t.titre), id: t.id, titre: t.titre, contexte: contexte,
                        cible: .tache(tache, noeud: d?.id ?? "motion:" + p.id))
            }
        }
        for d in dossiers {
            let parent = d.parent.flatMap { nomProjet[$0] ?? nomDossier[$0] }
            ajouter(.dossier, noter(q, d.nom), id: d.id, titre: d.nom, contexte: parent.map { "Dans « \($0) »" }, cible: .dossier(d.id))
            for n in d.notes {
                ajouter(.note, noter(q, n.texte), id: d.id + "/" + n.id, titre: n.texte, contexte: d.nom, fait: n.fait, cible: .dossier(d.id))
            }
        }
        for l in listes {
            ajouter(.liste, noter(q, l.nom), id: l.id, titre: l.nom, contexte: reste(l), cible: .liste(l.id))
            for e in l.elements {
                ajouter(.article, noter(q, e.texte), id: l.id + "/" + e.id, titre: e.texte, contexte: l.nom, fait: e.fait, cible: .liste(l.id))
            }
        }
        for r in rappels {
            let note = (r.note ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            ajouter(.rappel, noter(q, r.texte, secondaire: note), id: r.id, titre: r.texte, contexte: note.isEmpty ? nil : note,
                    fait: r.fait, quand: r.quand, cible: .rappel(r.id))
        }

        var groupes: [GroupeTrouve] = []
        var total = 0
        for g in GenreTrouve.allCases {
            let liste = (trouves[g] ?? []).sorted { a, b in
                if a.note != b.note { return a.note > b.note }
                if a.fait != b.fait { return !a.fait }
                return a.rang < b.rang
            }
            guard !liste.isEmpty else { continue }
            total += liste.count
            groupes.append(GroupeTrouve(genre: g, elements: Array(liste.prefix(limite)), reste: max(0, liste.count - limite)))
        }
        return ResultatsProjets(requete: propre, vide: false, groupes: groupes, total: total, sansProjets: projets == nil)
    }

    /// « vide », « tout est pris », « 3 à prendre » (comme la tuile d'une liste).
    static func reste(_ l: Liste) -> String {
        if l.elements.isEmpty { return "vide" }
        return l.restants == 0 ? "tout est pris" : "\(l.restants) à prendre"
    }

    /// La note d'un texte : chaque mot de la saisie doit être un mot du texte
    /// (12) ou son début (10) ; à défaut, du texte secondaire (la note d'un
    /// rappel : 5, début 4). +15 si le texte commence par la saisie entière.
    /// 0 : pas trouvé.
    static func noter(_ q: [String], _ texte: String, secondaire: String = "") -> Int {
        let t = RechercheReglages.mots(texte)
        let s = secondaire.isEmpty ? [] : RechercheReglages.mots(secondaire)
        var total = 0
        for m in q {
            var n = 0
            for w in t {
                if w == m { n = 12; break }
                if w.hasPrefix(m) { n = 10 }
            }
            if n == 0 {
                for w in s {
                    if w == m { n = 5; break }
                    if w.hasPrefix(m) { n = 4 }
                }
            }
            if n == 0 { return 0 }
            total += n
        }
        if t.joined(separator: " ").hasPrefix(q.joined(separator: " ")) { total += 15 }
        return total
    }

    /// Le texte en morceaux, `trouve` sur le début de chaque mot qui répond à
    /// la saisie (« Lait d'avoine », « avo » : « Lait d' », « avo », « ine »).
    /// Recollés, les morceaux redonnent le texte tel quel.
    public static func morceaux(_ texte: String, _ q: [String]) -> [MorceauTrouve] {
        let car = Array(texte)
        var marque = [Bool](repeating: false, count: car.count)
        var i = 0
        while i < car.count {
            guard estMot(car[i]) else {
                i += 1
                continue
            }
            var j = i
            while j < car.count && estMot(car[j]) { j += 1 }
            let norm: [String] = car[i..<j].map { RechercheReglages.normaliser(String($0)) }
            let mot = norm.joined()
            var meilleur: String?
            for m in q where mot.hasPrefix(m) {
                if meilleur == nil || m.count > meilleur!.count { meilleur = m }
            }
            if let m = meilleur {
                var n = 0
                var k = i
                while k < j && n < m.count {
                    n += norm[k - i].count
                    marque[k] = true
                    k += 1
                }
            }
            i = j
        }
        var out: [MorceauTrouve] = []
        for (k, c) in car.enumerated() {
            if let d = out.last, d.trouve == marque[k] {
                out[out.count - 1] = MorceauTrouve(texte: d.texte + String(c), trouve: d.trouve)
            } else {
                out.append(MorceauTrouve(texte: String(c), trouve: marque[k]))
            }
        }
        return out
    }

    private static func estMot(_ c: Character) -> Bool { c.isLetter || c.isNumber }
}
