import Foundation

// L'accueil « Aujourd'hui » de la direction A (Lot 1) : ce qui se calcule sur
// l'iPhone, sans appel IA ni réseau — le conseil du moment, l'effet d'une
// prolongation, le genre d'une capture.

/// Le conseil du moment : une ou deux phrases, lisibles en cinq secondes,
/// tirées de la journée telle qu'elle est (spec §4.1). Aucun appel IA.
/// Les quatre conseils que Sam peut choisir (retours TestFlight 13).
public enum TypeConseil: String, CaseIterable, Sendable, Identifiable {
    case maintenant, prochaine, libre, priorites
    public var id: String { rawValue }
    public var libelle: String {
        switch self {
        case .maintenant: return "Maintenant"
        case .prochaine: return "Prochaine tâche"
        case .libre: return "Temps libre"
        case .priorites: return "Priorités"
        }
    }
}

/// Le conseil calculé sur l'iPhone, par règles (sans IA, sans réseau) : ce que
/// l'accueil montre tant que GLM n'a pas réfléchi, ou quand il n'est pas là.
/// Sam, 15/10 : plus de « tu as 44 min, avance sur ta douche » — une tâche
/// n'est proposée dans un temps libre que si elle est urgente, importante ou
/// due aujourd'hui à une heure donnée.
public struct ConseilLocal: Equatable, Sendable {
    public let texte: String
    /// Les faits qui ont mené à ce conseil, en mots simples.
    public let pourquoi: [String]
}

public enum Conseil {
    public static func du(_ j: Journee?, maintenant: Millis) -> String? {
        pour(.maintenant, j, maintenant: maintenant)?.texte
    }

    public static func pour(_ type: TypeConseil, _ j: Journee?, maintenant: Millis) -> ConseilLocal? {
        guard let j, j.sources?.aucune != true, j.sources?.enPanne != true else { return nil }
        let items = j.items ?? []
        let avenir = items.filter { Jour.etat($0, maintenant: maintenant) == .avenir }
        let enCours = items.first { Jour.etat($0, maintenant: maintenant) == .encours }
        // Une tâche marquée bloquée n'est jamais proposée.
        let aFaire = (j.aFaire ?? []).filter { $0.bloquee != true }
        let enRetard = (j.retard?.items ?? []).filter { $0.bloquee != true }
        let prochainFixe = avenir.first { $0.estRendezVous }
        switch type {
        case .maintenant:
            return maintenantConseil(j, enCours: enCours, avenir: avenir, aFaire: aFaire, enRetard: enRetard, maintenant: maintenant)
        case .prochaine:
            guard let s = avenir.first else {
                return ConseilLocal(texte: "Plus rien de prévu à heure fixe aujourd'hui.", pourquoi: ["Aucun élément à venir dans ta journée"])
            }
            let dans = minutes(s.debut - maintenant)
            var t = "Prochain : « \(s.titre) » à \(Format.heure(s.debut))" + lieu(s) + ", dans \(Format.duree(minutes: dans))."
            if !s.estRendezVous { t += " Motion lui a donné \(Format.duree(minutes: s.dureeTotale))." }
            var p = [s.estRendezVous ? "Rendez-vous fixe à \(Format.heure(s.debut))" : "Tâche placée par Motion à \(Format.heure(s.debut))"]
            if let e = enCours { p.append("« \(e.titre) » se termine à \(Format.heure(e.finEffective))") }
            return ConseilLocal(texte: t, pourquoi: p)
        case .libre:
            let depuis = max(maintenant, enCours?.finEffective ?? maintenant)
            guard let f = prochainFixe else {
                return ConseilLocal(texte: "Aucun rendez-vous fixe d'ici ce soir : ton temps est à toi, Motion place tes tâches.",
                                    pourquoi: ["Pas de rendez-vous à venir aujourd'hui"])
            }
            let libre = minutes(f.debut - depuis)
            if libre < 15 {
                return ConseilLocal(texte: "Pas vraiment de temps libre avant « \(f.titre) » à \(Format.heure(f.debut)).",
                                    pourquoi: ["\(Format.duree(minutes: libre)) entre maintenant et ce rendez-vous"])
            }
            var t = "\(Format.duree(minutes: libre)) de libre avant « \(f.titre) » (\(Format.heure(f.debut)))."
            var p = ["Rendez-vous fixe à \(Format.heure(f.debut))" + lieu(f)]
            if let x = aProposer(aFaire) {
                t += " De quoi avancer « \(x.titre) »."
                p.append(raison(x))
            }
            return ConseilLocal(texte: t, pourquoi: p)
        case .priorites:
            let urgentes = aFaire.filter { ["ASAP", "HIGH"].contains($0.priorite?.uppercased() ?? "") }
            var bouts: [String] = []
            var p: [String] = []
            if !urgentes.isEmpty {
                bouts.append("D'abord " + urgentes.prefix(2).map { "« \($0.titre) »" }.joined(separator: " et ") + ".")
                p.append("\(urgentes.count) tâche\(urgentes.count > 1 ? "s" : "") urgente\(urgentes.count > 1 ? "s" : "") ou importante\(urgentes.count > 1 ? "s" : "")")
            } else if let x = aFaire.first(where: { $0.echeance != nil }) {
                bouts.append("D'abord « \(x.titre) », due avant \(Format.heure(x.echeance!)).")
                p.append("Échéance aujourd'hui")
            }
            if let r = j.retard, r.total > 0, let t = enRetard.first {
                bouts.append("\(r.total) en retard : commence par « \(t.titre) ».")
                p.append("\(r.total) tâche\(r.total > 1 ? "s" : "") en retard")
            }
            if bouts.isEmpty {
                return ConseilLocal(texte: "Rien d'urgent aujourd'hui : suis le planning de Motion.", pourquoi: ["Aucune tâche urgente, importante ou en retard"])
            }
            return ConseilLocal(texte: bouts.joined(separator: " "), pourquoi: p)
        }
    }

    private static func maintenantConseil(_ j: Journee, enCours: ElementJour?, avenir: [ElementJour], aFaire: [TacheResume],
                                          enRetard: [TacheResume], maintenant: Millis) -> ConseilLocal {
        if let e = enCours {
            let fin = e.finEffective
            if e.estRendezVous {
                return ConseilLocal(texte: "« \(e.titre) » jusqu'à \(Format.heure(fin))." + ensuite(avenir.first),
                                    pourquoi: ["Rendez-vous en cours"])
            }
            let phrase = "Il te reste \(Format.duree(minutes: minutes(fin - maintenant))) sur « \(e.titre) »."
            // Un rendez-vous fixe commence avant la fin prévue : c'est ça qu'il faut savoir.
            if let r = avenir.first(where: { $0.estRendezVous && $0.debut < fin }) {
                return ConseilLocal(texte: phrase + " Attention : « \(r.titre) » commence à \(Format.heure(r.debut)), avant la fin prévue.",
                                    pourquoi: ["Tâche en cours jusqu'à \(Format.heure(fin))", "Rendez-vous fixe à \(Format.heure(r.debut))"])
            }
            return ConseilLocal(texte: phrase + ensuite(avenir.first), pourquoi: ["Tâche en cours jusqu'à \(Format.heure(fin))"])
        }
        if let s = avenir.first {
            let libre = minutes(s.debut - maintenant)
            if libre >= 15, let t = aProposer(aFaire) {
                return ConseilLocal(texte: "\(Format.duree(minutes: libre)) devant toi avant « \(s.titre) » (\(Format.heure(s.debut))). De quoi avancer « \(t.titre) ».",
                                    pourquoi: ["\(Format.duree(minutes: libre)) avant le prochain élément", raison(t)])
            }
            if libre >= 15 {
                return ConseilLocal(texte: "\(Format.duree(minutes: libre)) devant toi avant « \(s.titre) » à \(Format.heure(s.debut))" + lieu(s) + ".",
                                    pourquoi: ["\(Format.duree(minutes: libre)) avant le prochain élément"])
            }
            return ConseilLocal(texte: "Prochain : « \(s.titre) » à \(Format.heure(s.debut))" + lieu(s) + ".",
                                pourquoi: ["Commence dans \(Format.duree(minutes: libre))"])
        }
        if let t = aFaire.first {
            let autres = aFaire.count - 1
            return ConseilLocal(texte: "Plus rien à heure fixe. Reste à faire : « \(t.titre) »" + (autres > 0 ? " et \(autres) autre\(autres > 1 ? "s" : "")." : "."),
                                pourquoi: ["Plus de créneau fixe aujourd'hui", "\(aFaire.count) tâche\(aFaire.count > 1 ? "s" : "") à faire"])
        }
        if let r = j.retard, r.total > 0, let t = enRetard.first {
            return ConseilLocal(texte: "Journée dégagée. \(r.total) tâche\(r.total > 1 ? "s" : "") en retard : commence par « \(t.titre) ».",
                                pourquoi: ["\(r.total) tâche\(r.total > 1 ? "s" : "") en retard"])
        }
        return ConseilLocal(texte: "Plus rien de prévu aujourd'hui.", pourquoi: ["Journée terminée dans Motion et ton agenda"])
    }

    /// Une tâche à glisser dans un temps libre : urgente, importante, ou due
    /// aujourd'hui à une heure donnée. Sinon rien (pas de « douche » à avancer).
    static func aProposer(_ aFaire: [TacheResume]) -> TacheResume? {
        aFaire.first { ["ASAP", "HIGH"].contains($0.priorite?.uppercased() ?? "") } ?? aFaire.first { $0.echeance != nil }
    }

    private static func raison(_ t: TacheResume) -> String {
        switch t.priorite?.uppercased() {
        case "ASAP": return "« \(t.titre) » est urgente"
        case "HIGH": return "« \(t.titre) » est importante"
        default: return t.echeance.map { "« \(t.titre) » est due avant \(Format.heure($0))" } ?? "« \(t.titre) » est à faire aujourd'hui"
        }
    }

    private static func ensuite(_ e: ElementJour?) -> String {
        guard let e else { return "" }
        return " Ensuite : « \(e.titre) » à \(Format.heure(e.debut))" + lieu(e) + "."
    }

    private static func lieu(_ e: ElementJour) -> String {
        guard let l = e.lieu, !l.isEmpty else { return "" }
        return " (\(l))"
    }

    static func minutes(_ ms: Millis) -> Int { max(1, Int((ms / 60_000).rounded(.up))) }
}

/// Ce que changerait une prolongation de la tâche en cours (spec §4.2) : une
/// estimation, pas une promesse — Motion recalcule la suite après coup.
public struct ImpactProlongation: Equatable, Sendable {
    public let nouvelleFin: Millis
    /// Le premier rendez-vous fixe qui commencerait avant la nouvelle fin.
    public let conflit: ElementJour?
    /// Minutes de retard sur ce rendez-vous.
    public let retard: Int
    /// Tâches placées plus tard dans la journée, que Motion déplacera.
    public let tachesDecalees: Int

    public static func de(_ e: ElementJour, minutes: Int, journee: Journee?) -> ImpactProlongation {
        let fin = e.finEffective
        let nouvelle = fin + Double(minutes) * 60_000
        let autres = (journee?.items ?? []).filter { !($0.type == e.type && $0.id == e.id) }
        let apres = autres.filter { $0.debut >= fin - 60_000 }
        // Un rendez-vous qui commence pendant la tâche compte aussi : il est
        // déjà coupé par la fin actuelle, la prolongation aggrave le retard.
        let conflit = autres.filter { $0.estRendezVous && $0.debut > e.debut && $0.debut < nouvelle }
            .min { $0.debut < $1.debut }
        return ImpactProlongation(
            nouvelleFin: nouvelle,
            conflit: conflit,
            retard: conflit.map { Int(((nouvelle - $0.debut) / 60_000).rounded(.up)) } ?? 0,
            tachesDecalees: apres.filter { !$0.estRendezVous }.count
        )
    }

    /// « Fin à 11:45 : tu arriverais à « Déjeuner » 15 min en retard. C'est un rendez-vous fixe. »
    public var phrase: String {
        let fin = "Fin à \(Format.heure(nouvelleFin))"
        if let c = conflit {
            return "\(fin) : tu arriverais à « \(c.titre) » \(Format.duree(minutes: retard)) en retard. C'est un rendez-vous fixe."
        }
        if tachesDecalees > 0 {
            return "\(fin). Aucun rendez-vous touché ; Motion décalera \(tachesDecalees > 1 ? "les \(tachesDecalees) tâches suivantes" : "la tâche suivante")."
        }
        return "\(fin). Rien d'autre n'est touché."
    }
}

/// La journée à l'échelle : deux éléments qui se chevauchent sont posés côte à
/// côte (couloirs), au lieu de se recouvrir.
public enum Couloirs {
    public struct Place: Equatable, Sendable {
        public let index: Int
        public let total: Int

        public init(index: Int, total: Int) {
            self.index = index
            self.total = total
        }
    }

    /// La place de chaque élément, par sa clé `type:id`.
    public static func de(_ items: [ElementJour]) -> [String: Place] {
        let tries = items.sorted { $0.debut < $1.debut || ($0.debut == $1.debut && $0.finEffective > $1.finEffective) }
        var places: [String: Place] = [:]
        var groupe: [(cle: String, couloir: Int)] = []
        var finsCouloirs: [Millis] = []
        var finGroupe: Millis = -.infinity
        func clore() {
            let total = max(1, finsCouloirs.count)
            for g in groupe { places[g.cle] = Place(index: g.couloir, total: total) }
            groupe = []
            finsCouloirs = []
        }
        for e in tries {
            if e.debut >= finGroupe { clore() }
            let cle = e.type + ":" + e.id
            if let libre = finsCouloirs.firstIndex(where: { $0 <= e.debut }) {
                finsCouloirs[libre] = e.finEffective
                groupe.append((cle, libre))
            } else {
                finsCouloirs.append(e.finEffective)
                groupe.append((cle, finsCouloirs.count - 1))
            }
            finGroupe = max(finGroupe, e.finEffective)
        }
        clore()
        return places
    }
}

/// Ce que devient un texte noté par le « + ».
public enum GenreCapture: String, CaseIterable, Sendable {
    /// Une tâche dans Motion (qui lui trouve un créneau).
    case tache
    /// Une pensée floue, gardée dans « Idées » (24/10) : rien n'est planifié.
    case idee
    /// Des articles dans une liste (« tomates, lait, œufs »).
    case liste
    /// Un rappel à une date (« appeler le garage demain à 9h »).
    case rappel
    /// Rémy le garde en mémoire (au moins 30 caractères : il le distille).
    case retenir
    /// Une question pour Rémy, préparée dans la conversation.
    case question
    /// Un projet, une catégorie ou un sous-projet (rangé dans Remy).
    case projet

    public var libelle: String {
        switch self {
        case .tache: return "Tâche"
        case .idee: return "Idée"
        case .liste: return "Liste"
        case .rappel: return "Rappel"
        case .retenir: return "Retenir"
        case .question: return "Question"
        case .projet: return "Projet"
        }
    }

    /// « Nouveau projet Corail », « sous-projet Étudier ElevenLabs dans
    /// « Boutique de bougies » » → le nom, et où le ranger s'il est dit : entre
    /// guillemets, ou le nom d'un projet existant (`parents`). « Rangement sous
    /// l'escalier » garde donc son titre entier.
    public static func projet(_ texte: String, parents: [String] = []) -> (titre: String, parent: String?) {
        var t = texte.trimmingCharacters(in: .whitespacesAndNewlines)
        t = t.replacingOccurrences(of: #"(?i)^(?:nouveau\s+projet|nouvelle\s+cat[ée]gorie|sous[- ]projet|projet|cat[ée]gorie)\s*:?\s*"#,
                                   with: "", options: .regularExpression)
        var parent: String?
        let lien = #"(?i)\s+(?:dans|sous)\s+(?:le\s+projet\s+|la\s+cat[ée]gorie\s+)?"#
        // Accents et casse ignorés : on cherche dans le texte « plié » ; le motif
        // est ancré à la fin, on retire autant de caractères de l'original.
        let plier = { (x: String) in x.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil) }
        let plie = plier(t)
        let connu = parents.filter { !$0.isEmpty }.sorted { $0.count > $1.count }.lazy.compactMap { nom in
            plie.range(of: lien + NSRegularExpression.escapedPattern(for: plier(nom)) + #"\s*$"#, options: .regularExpression)
                .map { (plie.distance(from: $0.lowerBound, to: plie.endIndex), nom) }
        }.first
        if let (longueur, nom) = connu, plie.count == t.count {
            parent = nom
            t.removeLast(longueur)
        } else if let r = t.range(of: lien + #"« ?([^»]+?) ?»$"#, options: .regularExpression) {
            let bout = String(t[r])
            parent = bout.replacingOccurrences(of: #"(?i)^\s+(?:dans|sous)\s+(?:le\s+projet\s+|la\s+cat[ée]gorie\s+)?"#, with: "", options: .regularExpression)
                .trimmingCharacters(in: CharacterSet(charactersIn: "«» "))
            t.removeSubrange(r)
        }
        let titre = t.trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ":-")))
        return (titre.prefix(1).uppercased() + titre.dropFirst(), parent?.isEmpty == false ? parent : nil)
    }

    /// Plusieurs choses dites d'un coup (« soirée chez Yanis jeudi, dispo
    /// samedi matin, studio dimanche… ») : Rémy peut les ranger une à une.
    /// Une simple liste d'articles n'en est pas une.
    public static func plusieursIntentions(_ texte: String) -> Bool {
        let t = texte.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count >= 30 else { return false }
        let morceaux = t.replacingOccurrences(of: "\n", with: ",")
            .replacingOccurrences(of: #"(?i)\s(?:et|puis|aussi)\s"#, with: ",", options: .regularExpression)
            .components(separatedBy: CharacterSet(charactersIn: ",;."))
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard morceaux.count >= 2 else { return false }
        // Des articles courts (« tomates, lait ») : une liste, pas des intentions.
        let longs = morceaux.filter { $0.split(separator: " ").count >= 3 }
        return longs.count >= 2
    }

    /// Où va une pensée sans action claire (Réglages) : « idees » (défaut) ou « motion ».
    public static let cleParDefaut = "capture.parDefaut"

    /// Le genre probable, deviné sans IA ; Sam corrige d'un toucher. Une
    /// pensée floue va dans les Idées (24/10 : « il ne faut pas transformer
    /// chaque pensée en tâche Motion ») ; Motion seulement si l'action est
    /// claire — ou si Sam l'a réglé ainsi (`parDefaut: .tache`).
    public static func deviner(_ texte: String, maintenant: Date = Date(), parDefaut: GenreCapture = .idee) -> GenreCapture {
        let t = texte.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !t.isEmpty else { return parDefaut }
        if t.hasSuffix("?") { return .question }
        let interrogatifs = ["est-ce", "qu'est-ce", "quand ", "comment ", "pourquoi ", "combien ", "quel ", "quelle ", "quels ", "quelles ", "où "]
        if interrogatifs.contains(where: { t.hasPrefix($0) }) { return .question }
        if t.count >= 120 { return .retenir }
        if t.hasPrefix("rappelle") || t.hasPrefix("rappel ") || t.hasPrefix("n'oublie pas") || t.hasPrefix("fais-moi penser") { return .rappel }
        // Ce que Sam annonce lui-même passe avant la date : « idée : un clip
        // pour vendredi » reste une idée, « projet bougies pour lundi » un dossier.
        if t.range(of: #"^id[ée]es?\b"#, options: .regularExpression) != nil { return .idee }
        if ["projet ", "nouveau projet", "sous-projet", "sous projet", "catégorie ", "categorie ", "nouvelle catégorie"].contains(where: { t.hasPrefix($0) }) { return .projet }
        if let d = AnalyseDate.extraire(t, maintenant: maintenant) {
            // Un jour sans heure pour une action claire (« Envoyer le devis
            // vendredi ») : une tâche avec cette échéance, pas un rappel à 9 h
            // inventé. Un rappel, c'est une heure dite, ou « rappelle-moi ».
            // Le jour peut venir en tête (« Demain, appeler le plombier ») :
            // l'action se lit aussi dans la phrase sans sa date. Une date
            // limite avec son heure (« Rendre le dossier avant mardi 14h ») :
            // une tâche avec cette échéance, pas un rappel qui sonnerait quand
            // il est trop tard pour agir (27/10).
            return (!d.heureDite || d.limite) && (actionClaire(t) || actionClaire(d.reste)) ? .tache : .rappel
        }
        if articles(t).count >= 2 { return .liste }
        return actionClaire(t) ? .tache : parDefaut
    }

    /// Le texte d'une tâche ou d'un rappel noté avec une date. La phrase sans
    /// la date quand celle-ci était au bout (« Envoyer le devis vendredi » →
    /// « Envoyer le devis », « Demain, appeler le plombier » → « Appeler le
    /// plombier ») ; sinon la phrase entière, sans la formule de demande :
    /// « Préparer la réunion de demain avec Hugo » ne devient pas « Préparer
    /// la réunion de avec Hugo ». La date part à côté (échéance ou heure du
    /// rappel). Une tâche avec une heure dite (genre changé à la main) garde
    /// son heure dans le titre, sauf une date limite (« avant mardi 14h ») :
    /// l'heure est déjà son échéance.
    public static func texte(_ texte: String, date d: AnalyseDate.Resultat?, genre: GenreCapture) -> String {
        let propre = texte.trimmingCharacters(in: .whitespacesAndNewlines)
        let entier = AnalyseDate.sansFormule(propre)
        guard let d, !d.reste.isEmpty else { return genre == .tache ? propre : entier }
        if genre == .tache && d.heureDite && !d.limite { return entier }
        func plie(_ s: String) -> String {
            s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Format.locale)
                .replacingOccurrences(of: #"[\s,;:.!…-]+"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
        }
        let reste = plie(d.reste), tout = plie(entier)
        let auBout = tout.hasPrefix(reste) || tout.hasSuffix(reste)
        // « Relire le compte rendu de », « Payer la facture du » : la date
        // tenait au reste de la phrase.
        let coupe = reste.range(of: #"(?:^|\s)(?:de|du|des|d'|d’|ou|et|entre|la|le|les|l'|au|aux|a|avec|sur|en|par|chez|dans|sans)$"#, options: .regularExpression) != nil
        return auBout && !coupe ? d.reste : entier
    }

    /// Des verbes d'action courants (à l'infinitif, sans accents).
    static let verbes: Set<String> = [
        "faire", "dire", "prendre", "mettre", "ecrire", "lire", "relire", "rendre", "finir", "ranger", "envoyer", "appeler",
        "payer", "acheter", "reserver", "relancer", "repondre", "preparer", "reparer", "nettoyer", "contacter", "imprimer",
        "deposer", "recuperer", "commander", "inscrire", "valider", "signer", "terminer", "rediger", "changer", "verifier",
        "demander", "remplir", "trier", "laver", "sortir", "aller", "passer", "rappeler", "renouveler", "resilier", "declarer",
        "planifier", "organiser", "booker", "caler", "fixer", "noter", "regler", "rembourser", "virer", "vendre", "poster",
        "publier", "monter", "installer", "telephoner", "finaliser", "boucler", "livrer", "porter",
    ]
    /// Les mêmes à l'impératif, comme on se le dicte (« Appelle le garage »).
    /// Pas les formes qui sont aussi des noms courants (note, livre, poste, règle).
    static let imperatifs: Set<String> = [
        "fais", "dis", "prends", "mets", "ecris", "lis", "relis", "rends", "finis", "range", "envoie", "appelle", "paie", "paye",
        "achete", "reserve", "relance", "reponds", "prepare", "repare", "nettoie", "contacte", "imprime", "depose", "recupere",
        "commande", "inscris", "valide", "signe", "termine", "redige", "verifie", "demande", "remplis", "trie", "lave", "sors",
        "va", "passe", "rappelle", "renouvelle", "resilie", "declare", "planifie", "organise", "cale", "fixe", "rembourse",
        "vends", "publie", "installe", "telephone", "finalise", "boucle",
    ]
    /// Des noms en -er/-ir qui ne sont pas des actions (« Dossier subvention »).
    static let pasDesVerbes: Set<String> = [
        "dossier", "atelier", "papier", "clavier", "panier", "cahier", "premier", "dernier", "hiver", "super", "fichier",
        "loyer", "dimanche", "plaisir", "avenir", "souvenir", "desir", "loisir", "soir", "miroir", "espoir", "devoir",
        "pouvoir", "savoir", "quartier", "metier", "courrier", "calendrier", "chantier", "sentier", "danger", "diner",
        "dejeuner", "routier", "voilier", "escalier", "potager", "boulanger", "foyer", "cocher", "cavalier", "janvier", "fevrier",
    ]

    /// L'action est-elle claire ? Un verbe d'action en tête (« Appeler le
    /// garage », « Appelle le garage »), « il faut », « je dois », ou une durée
    /// (« 2 h de studio »). Sinon c'est une pensée à garder, pas à planifier.
    public static func actionClaire(_ texte: String) -> Bool {
        let t = texte.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "fr_FR"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if ["il faut ", "faut ", "je dois ", "a faire", "todo"].contains(where: { t.hasPrefix($0) }) { return true }
        if t.range(of: #"\b\d+\s?(h|min|mn|minutes?|heures?)\b"#, options: .regularExpression) != nil { return true }
        let mots = t.split(whereSeparator: { !$0.isLetter }).map(String.init)
        guard var premier = mots.first else { return false }
        // « Me renseigner », « se faire couper les cheveux » : le verbe suit.
        if ["me", "m", "se", "s", "te", "t"].contains(premier), mots.count > 1 { premier = mots[1] }
        if verbes.contains(premier) || imperatifs.contains(premier) { return true }
        if pasDesVerbes.contains(premier) { return false }
        return premier.count >= 5 && (premier.hasSuffix("er") || premier.hasSuffix("ir"))
    }

    /// « tomates, lait et œufs » → trois articles. Un morceau de plus de cinq
    /// mots n'est pas un article : ce n'est pas une liste.
    public static func articles(_ texte: String) -> [String] {
        let morceaux = texte
            .replacingOccurrences(of: "\n", with: ",")
            .replacingOccurrences(of: #"\s+et\s+(?=[^,]*$)"#, with: ",", options: .regularExpression)
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard morceaux.count >= 2, morceaux.allSatisfy({ $0.split(separator: " ").count <= 5 }) else {
            return morceaux.count == 1 ? morceaux : []
        }
        return morceaux
    }

    /// Retenir demande assez de matière pour que la mémoire en tire quelque chose.
    public static let minimumRetenir = 30
}
