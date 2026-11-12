import Foundation
import Observation

// MARK: - Ce que Rémy a compris (priorites-v2, 12/11)
//
// Sam n'écrit plus ses priorités : la tour en PROPOSE un classement, sans IA,
// avec ses indices lisibles (GET /api/priorites/proposition). Sam confirme
// (« C'est ça »), corrige (↑ ↓) ou écarte (« Pas une priorité »). Tant qu'il
// n'a pas confirmé, c'est une hypothèse : seules les priorités confirmées
// (`classee`) forment le classement que lisent le conseil et la nuit.
// Ajouter une priorité à la main reste possible, discrètement.
//
// Le même écran que le site (public/app/vues/reglages.js, « Ce qui compte ») :
// etatClassement, confirmerPiste, deplacerPriorite, aEnregistrerClassement.
// Une différence voulue : l'iPhone ne renvoie JAMAIS une clé qu'il ne connaît
// pas. Pas de `projetMotion: null` (il ne retire pas de lien), pas de
// `confirmee: false` (une priorité qu'il n'a pas lue confirmée garde ce que
// la tour sait d'elle), pas d'`ecartees` si la tour ne les a pas rendues :
// côté tour, une clé absente = inchangé.
//
// Sans la capacité `priorites-v2` (tour d'avant), rien de tout ça : l'écran
// d'avant (Priorites.aEnvoyer, la liste écrite) reste tel quel.

/// Un indice de la proposition : ce qu'il dit, d'où il vient.
public struct IndicePriorite: Codable, Equatable, Sendable {
    /// « motion », « carnet », « declarees »… (nil : inconnue).
    public var source: String?
    public var texte: String

    public init(source: String? = nil, texte: String) {
        self.source = source
        self.texte = texte
    }
}

/// La priorité écrite par Sam qu'une piste reprend (ses mots l'emportent).
public struct PrioriteEcrite: Codable, Equatable, Sendable {
    public var id: String
    public var titre: String?

    public init(id: String, titre: String? = nil) {
        self.id = id
        self.titre = titre
    }
}

/// Une piste proposée par Rémy : un projet Motion, ou une priorité écrite.
public struct CandidatPriorite: Codable, Equatable, Sendable {
    /// `motion:<id>` ou `declaree:<id>` : ce que « Pas une priorité » écarte.
    public var cle: String
    public var titre: String
    public var projetMotion: String?
    public var projetNom: String?
    public var declaree: PrioriteEcrite?
    public var indices: [IndicePriorite]

    public init(cle: String, titre: String, projetMotion: String? = nil, projetNom: String? = nil,
                declaree: PrioriteEcrite? = nil, indices: [IndicePriorite] = []) {
        self.cle = cle
        self.titre = titre
        self.projetMotion = projetMotion
        self.projetNom = projetNom
        self.declaree = declaree
        self.indices = indices
    }

    enum CodingKeys: String, CodingKey { case cle, titre, projetMotion, projetNom, declaree, indices }

    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        cle = try c.decode(String.self, forKey: .cle)
        titre = (try? c.decodeIfPresent(String.self, forKey: .titre)) ?? ""
        projetMotion = try? c.decodeIfPresent(String.self, forKey: .projetMotion)
        projetNom = try? c.decodeIfPresent(String.self, forKey: .projetNom)
        declaree = try? c.decodeIfPresent(PrioriteEcrite.self, forKey: .declaree)
        let lus = (try? c.decodeIfPresent([Souple<IndicePriorite>].self, forKey: .indices)) ?? []
        indices = lus.compactMap(\.valeur).filter { !$0.texte.isEmpty }
    }
}

/// GET /api/priorites/proposition : « Ce que Rémy a compris ».
public struct PropositionPriorites: Codable, Equatable, Sendable {
    public var candidats: [CandidatPriorite]
    /// Ce que la proposition ne voit pas (dit à l'écran).
    public var limites: String?
    public var calculeA: Millis?
    public var version: Int?
    /// « ok », « erreur » (Motion n'a pas répondu) ou « off » (Motion pas relié).
    public var motion: String?

    public init(candidats: [CandidatPriorite] = [], limites: String? = nil, calculeA: Millis? = nil,
                version: Int? = nil, motion: String? = nil) {
        self.candidats = candidats
        self.limites = limites
        self.calculeA = calculeA
        self.version = version
        self.motion = motion
    }

    enum CodingKeys: String, CodingKey { case candidats, limites, calculeA, version, motion }

    /// Tolérant : une piste mal formée est laissée de côté, les autres restent.
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        let lus = (try? c.decodeIfPresent([Souple<CandidatPriorite>].self, forKey: .candidats)) ?? []
        candidats = lus.compactMap(\.valeur).filter { !$0.cle.isEmpty && !$0.titre.isEmpty }
        limites = try? c.decodeIfPresent(String.self, forKey: .limites)
        calculeA = try? c.decodeIfPresent(Millis.self, forKey: .calculeA)
        version = try? c.decodeIfPresent(Int.self, forKey: .version)
        motion = try? c.decodeIfPresent(String.self, forKey: .motion)
    }
}

/// Une ligne de l'écran : une priorité confirmée, ou une piste proposée.
public struct LigneClassement: Equatable, Sendable, Identifiable {
    /// La clé de la piste (`motion:p4`, `declaree:p-x`) : ce qu'écarte « Pas une priorité ».
    public var cle: String
    /// L'identifiant de la priorité sur la tour (nil : une piste jamais écrite).
    public var idPriorite: String?
    public var titre: String
    public var pourquoi: String?
    public var mots: [String]?
    public var projetMotion: String?
    public var projetNom: String?
    /// Ce que Rémy a vu (« 4 h planifiées sur les 14 prochains jours »).
    public var indices: [IndicePriorite]
    /// Une priorité que Sam a écrite (elle est sur la tour), pas seulement une piste.
    public var ecrite: Bool
    /// La ligne d'état calculée par la tour (« Dernière trace hier »).
    public var etat: String?
    public var neglige: Bool

    /// Unique dans l'écran : la priorité si elle existe, sinon la piste.
    public var id: String { idPriorite.map { "p:" + $0 } ?? cle }

    /// Le pourquoi et les mots, pour les champs de « Modifier ».
    public var pourquoiTexte: String { pourquoi ?? "" }
    public var motsTexte: String { (mots ?? []).joined(separator: ", ") }

    static func depuis(_ p: Priorite, cle: String? = nil, indices: [IndicePriorite] = []) -> LigneClassement {
        LigneClassement(cle: cle ?? ClassementPriorites.cle(de: p), idPriorite: p.id, titre: p.titre, pourquoi: p.pourquoi,
                        mots: p.mots, projetMotion: p.projetMotion, projetNom: p.projetNom, indices: indices,
                        ecrite: true, etat: Priorites.etat(p), neglige: p.neglige == true)
    }
}

/// Une ligne telle qu'elle part vers la tour (PUT /api/priorites).
public struct LigneEnvoi: Equatable, Sendable {
    public var id: String
    public var titre: String
    public var pourquoi: String?
    public var mots: [String]?
    /// Seulement quand l'iPhone le connaît : jamais `null`, qui retirerait le lien.
    public var projetMotion: String?
    public var projetNom: String?
    /// `true` pour le classement ; nil : clé absente, la tour garde ce qu'elle sait.
    public var confirmee: Bool?

    /// Le corps JSON de la ligne : rien pour ce qui est nil.
    var corps: [String: Any] {
        var l: [String: Any] = ["id": id, "titre": titre]
        if let q = pourquoi { l["pourquoi"] = q }
        if let m = mots { l["mots"] = m }
        if let p = projetMotion {
            l["projetMotion"] = p
            if let n = projetNom { l["projetNom"] = n }
        }
        if let c = confirmee { l["confirmee"] = c }
        return l
    }
}

/// Ce que « Enregistrer » envoie.
public struct EnvoiClassement: Equatable, Sendable {
    public var priorites: [LigneEnvoi]
    /// nil : clé absente (la tour garde les siennes).
    public var ecartees: [String]?
}

/// Ce qu'un geste a fait, en une phrase (le bandeau, VoiceOver).
public struct CorrectionFaite: Equatable, Sendable {
    public let fait: Bool
    public let phrase: String
}

/// Le classement en cours de correction : ce que la tour a rendu, et les
/// gestes de Sam, annulables un à un, jusqu'à « Enregistrer ».
public struct ClassementPriorites: Equatable, Sendable {
    public static let maximum = Priorites.maximum

    public private(set) var classees: [LigneClassement]
    public private(set) var proposees: [LigneClassement]
    public private(set) var ecartees: [String]
    /// La version de la tour sous les yeux (la base de l'enregistrement).
    public let version: Int
    /// La tour a rendu ses pistes écartées : on peut les renvoyer sans en perdre.
    let ecarteesLues: Bool
    /// Ce qui partirait sans aucun geste (pour « modifié »).
    private(set) var initial: EnvoiClassement

    struct Pas: Equatable, Sendable {
        var classees: [LigneClassement]
        var proposees: [LigneClassement]
        var ecartees: [String]
        var quoi: String
    }
    private var pas: [Pas] = []

    /// L'écran à partir de ce que la tour a rendu (site : etatClassement).
    /// `proposition` nil : elle n'a pas pu être lue ; les priorités écrites
    /// restent alors proposées, sans autre indice.
    public init(vue: VuePriorites, proposition: PropositionPriorites?) {
        let confirmees = vue.priorites.filter { $0.classee == true }
        let ecrites = vue.priorites.filter { $0.classee != true }
        let idsClasses = Set(confirmees.map(\.id))
        let projetsClasses = Set(confirmees.compactMap(\.projetMotion))
        var proposees: [LigneClassement] = []
        for c in proposition?.candidats ?? [] {
            // Déjà dans le classement, ou déjà proposée : pas deux fois.
            if let d = c.declaree?.id, idsClasses.contains(d) { continue }
            if let p = c.projetMotion, projetsClasses.contains(p) { continue }
            if proposees.contains(where: { $0.cle == c.cle }) { continue }
            if let d = c.declaree, let e = ecrites.first(where: { $0.id == d.id }) {
                if proposees.contains(where: { $0.idPriorite == e.id }) { continue }
                var l = LigneClassement.depuis(e, cle: c.cle, indices: c.indices)
                l.projetMotion = c.projetMotion ?? e.projetMotion
                l.projetNom = c.projetNom ?? e.projetNom
                proposees.append(l)
            } else {
                proposees.append(LigneClassement(cle: c.cle, idPriorite: nil, titre: c.titre, pourquoi: nil, mots: nil,
                                                 projetMotion: c.projetMotion, projetNom: c.projetNom, indices: c.indices,
                                                 ecrite: false, etat: nil, neglige: false))
            }
        }
        // Une priorité écrite que la proposition ne montre pas : proposée quand même.
        for e in ecrites where !proposees.contains(where: { $0.idPriorite == e.id }) {
            proposees.append(LigneClassement.depuis(e, indices: [IndicePriorite(source: "declarees", texte: "Tu l'as écrite toi-même")]))
        }
        self.classees = confirmees.map { LigneClassement.depuis($0) }
        self.proposees = proposees
        self.ecartees = vue.ecartees ?? []
        self.version = vue.version
        self.ecarteesLues = vue.ecartees != nil
        self.initial = EnvoiClassement(priorites: [], ecartees: nil)
        self.initial = aEnvoyer()
    }

    // MARK: Ce que l'écran demande

    /// Cinq au plus : au-delà, plus rien n'est prioritaire.
    public var plein: Bool { classees.count >= Self.maximum }
    public var vide: Bool { classees.isEmpty && proposees.isEmpty }
    public var peutAnnuler: Bool { !pas.isEmpty }
    /// Quelque chose partirait à l'enregistrement.
    public var modifie: Bool { aEnvoyer() != initial }

    /// La clé d'une priorité dans la proposition (site : clePiste).
    static func cle(de p: Priorite) -> String {
        if let m = p.projetMotion, !m.isEmpty { return "motion:" + m }
        return "declaree:" + p.id
    }

    static func normal(_ t: String) -> String {
        t.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "fr_FR"))
    }

    public static func nouvelId() -> String { "p-\(UUID().uuidString.prefix(8).lowercased())" }

    // MARK: Les gestes

    /// « C'est ça » : la piste entre dans le classement, en dernier.
    public mutating func confirmer(_ id: String, nouvelId: () -> String = ClassementPriorites.nouvelId) -> CorrectionFaite {
        guard let i = proposees.firstIndex(where: { $0.id == id }) else { return CorrectionFaite(fait: false, phrase: "Cette piste n'est plus là : tire vers le bas pour relire.") }
        if plein { return CorrectionFaite(fait: false, phrase: "Cinq au plus dans ton classement : retire ou écarte une priorité d'abord.") }
        let nom = CeQuiCompte.nom(proposees[i].titre)
        noter("la confirmation de \(nom)")
        var l = proposees.remove(at: i)
        Self.preparerConfirmee(&l, nouvelId: nouvelId)
        classees.append(l)
        return CorrectionFaite(fait: true, phrase: "\(nom) entre dans ton classement en n°\(classees.count).")
    }

    /// « Tout est juste, dans cet ordre » : les pistes, jusqu'à cinq en tout.
    public mutating func toutConfirmer(nouvelId: () -> String = ClassementPriorites.nouvelId) -> CorrectionFaite {
        let place = Self.maximum - classees.count
        guard place > 0, !proposees.isEmpty else {
            return CorrectionFaite(fait: false, phrase: plein ? "Cinq au plus dans ton classement : retire ou écarte une priorité d'abord." : "Rien à confirmer.")
        }
        noter("« Tout est juste »")
        let n = min(place, proposees.count)
        for _ in 0..<n {
            var l = proposees.removeFirst()
            Self.preparerConfirmee(&l, nouvelId: nouvelId)
            classees.append(l)
        }
        let reste = proposees.isEmpty ? "" : " Cinq au plus : les autres restent proposées."
        return CorrectionFaite(fait: true, phrase: "\(n) confirmée\(n > 1 ? "s" : ""), dans cet ordre.\(reste)")
    }

    private static func preparerConfirmee(_ l: inout LigneClassement, nouvelId: () -> String) {
        if l.idPriorite == nil { l.idPriorite = nouvelId() }
        l.titre = String(l.titre.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        l.ecrite = true
        l.indices = []
    }

    public mutating func monter(_ id: String) -> CorrectionFaite { deplacer(id, sens: -1) }
    public mutating func descendre(_ id: String) -> CorrectionFaite { deplacer(id, sens: 1) }

    /// ↑ (−1) ou ↓ (+1), dans sa liste : le classement, ou les pistes.
    mutating func deplacer(_ id: String, sens: Int) -> CorrectionFaite {
        let dansClassement = classees.contains { $0.id == id }
        var liste = dansClassement ? classees : proposees
        guard let i = liste.firstIndex(where: { $0.id == id }) else { return CorrectionFaite(fait: false, phrase: "Cette ligne n'est plus là.") }
        let nom = CeQuiCompte.nom(liste[i].titre)
        let j = i + sens
        guard j >= 0, j < liste.count else {
            return CorrectionFaite(fait: false, phrase: sens < 0 ? "\(nom) est déjà en tête." : "\(nom) est déjà en dernier.")
        }
        noter("le déplacement de \(nom)")
        liste.swapAt(i, j)
        if dansClassement { classees = liste } else { proposees = liste }
        let ou = dansClassement ? "n°\(j + 1)" : "proposition n°\(j + 1)"
        return CorrectionFaite(fait: true, phrase: "\(nom) passe en \(ou).")
    }

    /// « Pas une priorité » : la ligne sort, sa clé est écartée (Rémy ne la
    /// reproposera plus). Une priorité écrite sort aussi de la tour à l'enregistrement.
    public mutating func ecarter(_ id: String) -> CorrectionFaite {
        let dansClassement = classees.contains { $0.id == id }
        var liste = dansClassement ? classees : proposees
        guard let i = liste.firstIndex(where: { $0.id == id }) else { return CorrectionFaite(fait: false, phrase: "Cette ligne n'est plus là.") }
        let l = liste[i]
        let nom = CeQuiCompte.nom(l.titre)
        noter("l'écart de \(nom)")
        liste.remove(at: i)
        if dansClassement { classees = liste } else { proposees = liste }
        if !ecartees.contains(l.cle) { ecartees.append(l.cle) }
        let suite = l.ecrite ? " Elle sort de tes priorités à l'enregistrement ; Rémy ne la reproposera plus." : " Rémy ne la reproposera plus."
        return CorrectionFaite(fait: true, phrase: "\(nom) : pas une priorité.\(suite)")
    }

    /// Ajouter à la main (le chemin secondaire) : en dernier du classement.
    public mutating func ajouter(titre: String, pourquoi: String = "", nouvelId: () -> String = ClassementPriorites.nouvelId) -> CorrectionFaite {
        let t = String(titre.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        guard !t.isEmpty else { return CorrectionFaite(fait: false, phrase: "Écris d'abord ce qui compte.") }
        if plein { return CorrectionFaite(fait: false, phrase: "Cinq au plus dans ton classement : au-delà, plus rien n'est prioritaire.") }
        let cle = Self.normal(t)
        if classees.contains(where: { Self.normal($0.titre) == cle }) || proposees.contains(where: { $0.ecrite && Self.normal($0.titre) == cle }) {
            return CorrectionFaite(fait: false, phrase: "\(CeQuiCompte.nom(t)) est déjà là.")
        }
        noter("l'ajout de \(CeQuiCompte.nom(t))")
        let id = nouvelId()
        let pq = pourquoi.trimmingCharacters(in: .whitespacesAndNewlines)
        classees.append(LigneClassement(cle: "declaree:" + id, idPriorite: id, titre: t, pourquoi: pq.isEmpty ? nil : pq, mots: nil,
                                        projetMotion: nil, projetNom: nil, indices: [], ecrite: true, etat: nil, neglige: false))
        return CorrectionFaite(fait: true, phrase: "\(CeQuiCompte.nom(t)) entre dans ton classement en n°\(classees.count).")
    }

    /// « Modifier » une priorité du classement : son titre, son pourquoi, ses mots.
    public mutating func modifier(_ id: String, titre: String, pourquoi: String, mots: String) -> CorrectionFaite {
        guard let i = classees.firstIndex(where: { $0.id == id }) else { return CorrectionFaite(fait: false, phrase: "Cette priorité n'est plus là.") }
        let t = String(titre.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        guard !t.isEmpty else { return CorrectionFaite(fait: false, phrase: "Une priorité a besoin d'un titre.") }
        let pq = pourquoi.trimmingCharacters(in: .whitespacesAndNewlines)
        let m = mots.trimmingCharacters(in: .whitespacesAndNewlines)
        let avant = classees[i]
        if avant.titre == t && avant.pourquoiTexte == pq && avant.motsTexte == m { return CorrectionFaite(fait: false, phrase: "Rien n'a changé.") }
        noter("la modification de \(CeQuiCompte.nom(avant.titre))")
        classees[i].titre = t
        classees[i].pourquoi = pq.isEmpty ? nil : pq
        // Gardés tels que tapés : découpés à l'envoi (Priorites.mots).
        classees[i].mots = m.isEmpty ? nil : [m]
        return CorrectionFaite(fait: true, phrase: "\(CeQuiCompte.nom(t)) modifiée.")
    }

    /// Les pistes écartées reviendront (après l'enregistrement).
    public mutating func reproposer() -> CorrectionFaite {
        guard !ecartees.isEmpty else { return CorrectionFaite(fait: false, phrase: "Aucune piste écartée.") }
        noter("le retour des pistes écartées")
        ecartees = []
        return CorrectionFaite(fait: true, phrase: "Les pistes écartées seront reproposées après l'enregistrement.")
    }

    /// Le dernier geste, défait.
    public mutating func annuler() -> CorrectionFaite {
        guard let p = pas.popLast() else { return CorrectionFaite(fait: false, phrase: "Rien à annuler.") }
        classees = p.classees
        proposees = p.proposees
        ecartees = p.ecartees
        return CorrectionFaite(fait: true, phrase: "Annulé : \(p.quoi).")
    }

    private mutating func noter(_ quoi: String) {
        pas.append(Pas(classees: classees, proposees: proposees, ecartees: ecartees, quoi: quoi))
        if pas.count > 40 { pas.removeFirst() }
    }

    // MARK: L'envoi

    /// Ce qui part vers la tour (site : aEnregistrerClassement) : le
    /// classement (confirmées, dans l'ordre), puis les priorités écrites pas
    /// encore confirmées (elles restent à Sam, sans rang). Les pistes de Rémy
    /// non confirmées ne partent pas : ce ne sont que des hypothèses.
    public func aEnvoyer() -> EnvoiClassement {
        var vus = Set<String>()
        var lignes: [LigneEnvoi] = []
        var liste: [(LigneClassement, Bool)] = []
        for l in classees { liste.append((l, true)) }
        for l in proposees where l.ecrite { liste.append((l, false)) }
        for (l, confirmee) in liste {
            guard let id = l.idPriorite else { continue }
            let titre = String(l.titre.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
            let cle = Self.normal(titre)
            if titre.isEmpty || vus.contains(cle) { continue }
            vus.insert(cle)
            let pq = (l.pourquoi ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let mots = (l.mots ?? []).flatMap { Priorites.mots(depuis: $0) }.filter { $0.count >= 3 }
            let projet = (l.projetMotion ?? "").isEmpty ? nil : l.projetMotion
            let ligne = LigneEnvoi(id: id, titre: titre,
                                   pourquoi: pq.isEmpty ? nil : String(pq.prefix(240)),
                                   mots: mots.isEmpty ? nil : Array(mots.prefix(8)),
                                   projetMotion: projet,
                                   projetNom: projet == nil ? nil : l.projetNom.map { String($0.prefix(80)) },
                                   confirmee: confirmee ? true : nil)
            lignes.append(ligne)
        }
        return EnvoiClassement(priorites: lignes, ecartees: ecarteesLues ? ecartees : nil)
    }
}

// MARK: - Les mots de l'écran

public enum CeQuiCompte {
    /// La capacité de la tour qui propose le classement.
    public static let capacite = "priorites-v2"

    public static let sousTitre = "Ce que Rémy a compris de ce qui compte pour toi. Tu confirmes ou tu corriges : seul ce que tu confirmes lui sert."
    /// La ligne de Réglages.
    public static let ligneReglages = "Ce que Rémy a compris de ce qui compte pour toi : tu confirmes ou tu corriges."
    /// Ce que la proposition ne voit pas, si la tour ne l'a pas dit (le même
    /// texte que `LIMITES`, lib/proposition-priorites.js).
    public static let limites = "Rémy ne voit que Motion et ce qui passe par lui : ce qui avance ailleurs (du code dans Claude Code ou T3, du papier, un coup de fil) n'y apparaît pas, ni l'importance d'une chose courte."

    /// « « La musique » », raccourci pour une phrase ou VoiceOver.
    public static func nom(_ titre: String) -> String {
        let t = titre.trimmingCharacters(in: .whitespacesAndNewlines)
        let court = t.count > 40 ? String(t.prefix(39)) + "…" : t
        return "« \(court.isEmpty ? "Sans titre" : court) »"
    }

    /// Un bouton d'une ligne : ce que VoiceOver dit (sur QUELLE priorité il agit).
    public enum Bouton: Sendable { case confirmer, monter, descendre, ecarter, modifier }

    public static func libelle(_ b: Bouton, _ titre: String) -> String {
        let n = nom(titre)
        switch b {
        case .confirmer: return "C'est ça : \(n) est une priorité"
        case .monter: return "Monter \(n)"
        case .descendre: return "Descendre \(n)"
        case .ecarter: return "\(n) n'est pas une priorité"
        case .modifier: return "Modifier \(n)"
        }
    }

    /// Les indices d'une piste, par source : « D'après Motion », « D'après Rémy »…
    public struct Groupe: Equatable, Sendable {
        public let titre: String
        public let textes: [String]
    }

    public static func groupes(_ indices: [IndicePriorite]) -> [Groupe] {
        var ordre: [String] = []
        var par: [String: [String]] = [:]
        for i in indices where !i.texte.isEmpty {
            let t = dapres(i.source)
            if par[t] == nil { ordre.append(t) }
            par[t, default: []].append(i.texte)
        }
        return ordre.map { Groupe(titre: $0, textes: par[$0] ?? []) }
    }

    static func dapres(_ source: String?) -> String {
        switch source ?? "" {
        case "motion": return "D'après Motion"
        case "declarees": return "D'après ce que tu as écrit"
        default: return "D'après Rémy"
        }
    }

    /// Ce que VoiceOver lit des indices d'une piste, d'une traite.
    public static func indicesLus(_ titre: String, _ indices: [IndicePriorite]) -> String {
        let g = groupes(indices).map { "\($0.titre) : \($0.textes.joined(separator: ", "))" }
        return "Ce que Rémy a vu pour \(nom(titre)) : \(g.joined(separator: ". "))."
    }

    /// Rien à montrer : pourquoi, et quoi faire.
    public static func vide(_ p: PropositionPriorites?) -> String {
        guard let p else { return "La proposition de Rémy n'a pas pu être calculée : réessaie dans un instant, ou ajoute une priorité à la main." }
        switch p.motion ?? "" {
        case "off": return "Rémy n'a encore rien à te proposer : Motion n'est pas relié à ta tour, et tu n'as rien écrit. Relie Motion, ou ajoute une priorité à la main."
        case "erreur": return "Rémy n'a rien à te proposer pour l'instant : Motion n'a pas répondu à ta tour. Réessaie dans un instant, ou ajoute une priorité à la main."
        default: return "Rémy n'a encore rien à te proposer : ni projet Motion actif, ni priorité écrite. Il en proposera dès que Motion aura des tâches planifiées ; d'ici là, tu peux en ajouter une à la main."
        }
    }

    /// Ce qui manque à la proposition (Motion coupé ou muet), nil sinon.
    public static func noteMotion(_ p: PropositionPriorites?) -> String? {
        switch p?.motion ?? "" {
        case "off": return "Motion n'est pas relié à ta tour : Rémy ne propose que ce que tu as écrit."
        case "erreur": return "Motion n'a pas répondu à ta tour : la proposition ne tient compte que de Rémy."
        default: return nil
        }
    }

    /// Le bandeau du haut quand l'écran ne peut pas parler à la tour : ce qui
    /// est montré, et pourquoi les gestes attendent. nil : tout va bien.
    public static func bandeau(horsLigne: Bool, copieLocale: Bool, injoignable: Bool, recuLe: Date?, modifie: Bool,
                               maintenant: Date = Date()) -> String? {
        guard horsLigne || copieLocale else { return nil }
        let quand = recuLe.map { " (celle \(Format.depuis($0, maintenant: maintenant)))" } ?? ""
        let garde = modifie ? " Tes corrections pas encore enregistrées restent ici." : ""
        if horsLigne {
            return "Pas de réseau : tu lis la dernière version gardée sur l'iPhone\(quand). Confirmer ou corriger attend le réseau.\(garde)"
        }
        if injoignable {
            return "Rémy ne répond pas : tu lis la dernière version gardée sur l'iPhone\(quand). Confirmer ou corriger attend ta tour.\(garde)"
        }
        return "Tu lis la dernière version gardée sur l'iPhone\(quand), le temps de relire ta tour."
    }

    /// Après « Enregistrer ».
    public static func enregistre(_ n: Int) -> String {
        n > 0 ? "Classement enregistré : \(n) priorité\(n > 1 ? "s" : ""), dans cet ordre. Rémy s'en sert dès maintenant."
              : "Enregistré : pas de classement confirmé pour l'instant."
    }
}

// MARK: - Le modèle de l'écran

/// Ce qui est gardé sur l'iPhone : la dernière lecture, pour l'écran hors ligne.
struct CopiePriorites: Codable {
    var vue: VuePriorites
    var proposition: PropositionPriorites?
}

extension Rangement {
    static let priorites = "priorites.json"
}

@MainActor
@Observable
public final class PrioritesModel {
    public private(set) var vue: VuePriorites?
    public private(set) var proposition: PropositionPriorites?
    /// Les corrections de Sam, pas encore enregistrées (nil : rien de lu).
    public private(set) var classement: ClassementPriorites?
    public private(set) var chargement = false
    public private(set) var enregistrement = false
    /// La lecture a échoué (rien de lu, ou seulement la copie de l'iPhone).
    public private(set) var erreur: String?
    /// L'échec venait du réseau (tour injoignable).
    public private(set) var erreurReseau = false
    /// La proposition n'a pas pu être lue (la liste, si).
    public private(set) var erreurProposition: String?
    /// Ce qui est affiché vient de l'iPhone, pas encore relu sur la tour.
    public private(set) var copieLocale = false
    public private(set) var misAJour: Date?

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI
    @ObservationIgnored let rangement: Rangement?

    public init(api: ClientAPI, rangement: Rangement? = nil) {
        self.api = api
        self.rangement = rangement
        if let c = rangement?.copie(CopiePriorites.self, Rangement.priorites) {
            vue = c.valeur.vue
            proposition = c.valeur.proposition
            classement = ClassementPriorites(vue: c.valeur.vue, proposition: c.valeur.proposition)
            misAJour = c.le
            copieLocale = true
        }
    }

    /// La tour propose le classement (sinon : l'écran d'avant, la liste écrite).
    public var disponible: Bool { app?.serveur?.sait(CeQuiCompte.capacite) == true }

    /// Les gestes ne servent que s'ils pourront partir.
    public var peutCorriger: Bool {
        classement != nil && app?.horsLigne != true && !copieLocale && !enregistrement
    }

    public var modifie: Bool { classement?.modifie == true }

    public var peutEnregistrer: Bool { peutCorriger && modifie && vue != nil }

    /// Le bandeau du haut (hors ligne, copie de l'iPhone), nil sinon.
    public func bandeau(maintenant: Date = Date()) -> String? {
        guard classement != nil else { return nil }
        return CeQuiCompte.bandeau(horsLigne: app?.horsLigne == true, copieLocale: copieLocale, injoignable: erreurReseau,
                                   recuLe: misAJour, modifie: modifie, maintenant: maintenant)
    }

    /// Relit la liste et la proposition. Des corrections pas encore
    /// enregistrées restent, sauf si la tour a changé de version entre-temps.
    public func charger(garderBrouillon: Bool = true) async {
        guard disponible, !chargement else { return }
        chargement = true
        defer { chargement = false }
        let v: VuePriorites
        do {
            v = try await api.priorites()
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            if case ErreurAPI.reseau = error { erreurReseau = true } else { erreurReseau = false }
            erreur = (error as? LocalizedError)?.errorDescription ?? "La tour ne répond pas."
            return
        }
        var p: PropositionPriorites?
        do {
            p = try await api.propositionPriorites()
            erreurProposition = nil
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreurProposition = (error as? LocalizedError)?.errorDescription ?? "La proposition de Rémy n'a pas pu être lue."
        }
        appliquer(v, p, garderBrouillon: garderBrouillon)
    }

    private func appliquer(_ v: VuePriorites, _ p: PropositionPriorites?, garderBrouillon: Bool) {
        let brouillon = classement
        let etaitCopie = copieLocale
        vue = v
        proposition = p
        misAJour = Date()
        copieLocale = false
        erreur = nil
        erreurReseau = false
        if garderBrouillon, !etaitCopie, let b = brouillon, b.modifie {
            // Rien n'a changé sur la tour : les corrections restent. Sinon,
            // elles portaient sur une liste qui n'est plus la bonne.
            if b.version != v.version {
                classement = ClassementPriorites(vue: v, proposition: p)
                app?.dire("Ton classement a changé ailleurs entre-temps : tes corrections pas encore enregistrées sont retirées.")
            }
        } else {
            classement = ClassementPriorites(vue: v, proposition: p)
        }
        try? rangement?.garder(CopiePriorites(vue: v, proposition: p), le: Date(), Rangement.priorites)
    }

    // MARK: Les gestes (chacun dit ce qu'il a fait, avec « Annuler »)

    public func confirmer(_ id: String) { geste { $0.confirmer(id) } }
    public func toutConfirmer() { geste { $0.toutConfirmer() } }
    public func monter(_ id: String) { geste { $0.monter(id) } }
    public func descendre(_ id: String) { geste { $0.descendre(id) } }
    public func ecarter(_ id: String) { geste { $0.ecarter(id) } }
    public func reproposer() { geste { $0.reproposer() } }
    public func modifier(_ id: String, titre: String, pourquoi: String, mots: String) {
        geste { $0.modifier(id, titre: titre, pourquoi: pourquoi, mots: mots) }
    }

    /// Ajouter à la main ; vrai si c'est fait (le champ peut se vider).
    @discardableResult
    public func ajouter(titre: String, pourquoi: String = "") -> Bool {
        geste { $0.ajouter(titre: titre, pourquoi: pourquoi) }
    }

    /// Le dernier geste, défait (le bandeau « Annuler »).
    public func annulerGeste() {
        guard var c = classement else { return }
        let r = c.annuler()
        classement = c
        app?.dire(r.phrase)
    }

    @discardableResult
    private func geste(_ f: (inout ClassementPriorites) -> CorrectionFaite) -> Bool {
        guard var c = classement else { return false }
        guard peutCorriger else {
            app?.dire(app?.horsLigne == true ? "Pas de réseau : confirmer ou corriger attend le réseau." : "Pas encore : ta tour n'a pas été relue.")
            return false
        }
        let r = f(&c)
        classement = c
        if r.fait {
            app?.dire(r.phrase + " Enregistrer pour confirmer.", annuler: { [weak self] in self?.annulerGeste() })
        } else {
            app?.dire(r.phrase)
        }
        return r.fait
    }

    // MARK: L'enregistrement

    /// Une version de plus sur la tour. 409 (changé ailleurs) : on relit.
    @discardableResult
    public func enregistrer() async -> Bool {
        guard let c = classement, c.modifie, !enregistrement else { return false }
        if app?.horsLigne == true {
            app?.dire("Pas de réseau : ton classement attend ici. Enregistre-le quand l'iPhone aura du réseau.")
            return false
        }
        enregistrement = true
        defer { enregistrement = false }
        do {
            let r = try await api.enregistrerClassement(c.aEnvoyer(), base: c.version)
            vue = r
            classement = ClassementPriorites(vue: r, proposition: proposition)
            app?.dire(CeQuiCompte.enregistre(r.priorites.filter { $0.classee == true }.count))
        } catch {
            if let e = error as? ErreurAPI, case .serveur(409, _) = e {
                app?.dire("Ton classement a changé ailleurs entre-temps : je recharge, refais ta correction.")
                enregistrement = false
                await charger(garderBrouillon: false)
                return false
            }
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            let raison = (error as? LocalizedError)?.errorDescription ?? "la tour ne répond pas"
            app?.dire("Classement pas enregistré : \(raison) Tes corrections restent ici, réessaie.")
            return false
        }
        // La proposition change avec le classement : relue (ses pistes confirmées sortent).
        enregistrement = false
        await charger(garderBrouillon: false)
        return true
    }

    /// Déconnexion, ou appareil plus reconnu : rien ne reste.
    public func vider() {
        vue = nil
        proposition = nil
        classement = nil
        erreur = nil
        erreurReseau = false
        erreurProposition = nil
        copieLocale = false
        misAJour = nil
        rangement?.effacer(Rangement.priorites)
    }
}

// MARK: - Requêtes

extension ClientAPI {
    /// « Ce que Rémy a compris » (priorites-v2) : calculé sans IA par la tour.
    public func propositionPriorites() async throws -> PropositionPriorites {
        try await json(PropositionPriorites.self, "api/priorites/proposition", delai: 20)
    }

    /// Le classement (priorites-v2) : `base`, la version sous les yeux (409 sinon).
    public func enregistrerClassement(_ envoi: EnvoiClassement, base: Int) async throws -> VuePriorites {
        var corps: [String: Any] = ["priorites": envoi.priorites.map(\.corps), "base": base]
        if let e = envoi.ecartees { corps["ecartees"] = e }
        return try await json(VuePriorites.self, "api/priorites", methode: "PUT", corps: corps)
    }
}
