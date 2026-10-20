import SwiftUI
import Observation

// Prototypes du Lot 1 (J1.1) : deux directions visuelles et deux navigations,
// sur des DONNÉES FICTIVES. Rien ici ne parle au serveur ni ne touche à la
// vraie journée de Sam. Ouverts par REMY_PROTO (captures de la CI) ou depuis
// Réglages → Prototypes de design.

enum ProtoDirection: String, CaseIterable, Identifiable {
    case atelier = "A"
    case clarte = "B"
    var id: String { rawValue }
    var nom: String { self == .atelier ? "Atelier" : "Clarté" }
}

enum ProtoNav: String, CaseIterable, Identifiable {
    case carnet
    case projets
    var id: String { rawValue }
    var titre: String { self == .carnet ? "Carnet" : "Projets" }
    var symbole: String { self == .carnet ? "book.closed" : "square.stack.3d.up" }
}

enum ProtoOnglet: Hashable { case aujourdhui, remy, tiers }

enum ProtoCategorie: String, CaseIterable {
    case pro, musique, proches, sport, admin, maison

    var nom: String {
        switch self {
        case .pro: return "Pro"
        case .musique: return "Musique"
        case .proches: return "Proches"
        case .sport: return "Sport"
        case .admin: return "Admin"
        case .maison: return "Maison"
        }
    }
}

enum ProtoGenre { case tache, rdv, trajet }

struct ProtoBloc: Identifiable, Equatable {
    let id: String
    var titre: String
    var projet: String? = nil
    var categorie: ProtoCategorie
    var debut: Date
    var fin: Date
    var genre: ProtoGenre = .tache
    var protege = false
    /// Échéance aujourd'hui : signalée par une FORME (triangle), pas par la
    /// couleur de catégorie (spec §4.3).
    var echeance = false
    var lieu: String? = nil
    var fait = false

    var minutes: Int { Int(fin.timeIntervalSince(debut) / 60) }
}

struct ProtoArticle: Identifiable, Equatable {
    let id = UUID()
    var texte: String
    var coche = false
    var nouveau = false
}

enum ProtoEtatProjet: String, CaseIterable {
    case active = "Priorité active"
    case legere = "Progression légère"
    case attente = "En attente"
    case idee = "Idée"
    case archive = "Archivé"
}

struct ProtoProjet: Identifiable {
    let id: String
    let nom: String
    let etat: ProtoEtatProjet
    let categorie: ProtoCategorie
    let prochaine: String
    let semaine: String
}

struct ProtoQuestion: Identifiable {
    let id: String
    let titre: String
    let quand: String
    let contexte: String
    let question: String
    let options: [String]
    let reformulations: [String]
}

struct ProtoToast: Identifiable {
    let id = UUID()
    let texte: String
    var annuler: (() -> Void)? = nil
}

enum ProtoTypeCapture: String, CaseIterable, Identifiable {
    case auto, tache, note, liste, rappel
    var id: String { rawValue }
    var titre: String {
        switch self {
        case .auto: return "Auto"
        case .tache: return "Tâche"
        case .note: return "Note"
        case .liste: return "Liste"
        case .rappel: return "Rappel"
        }
    }
    var symbole: String {
        switch self {
        case .auto: return "wand.and.stars"
        case .tache: return "checkmark.circle"
        case .note: return "lightbulb"
        case .liste: return "cart"
        case .rappel: return "bell"
        }
    }
}

/// Pré-classement DÉTERMINISTE d'une capture (plan §5.8) : ce que Remy fera du
/// texte, montré avant l'envoi. Le modèle n'intervient qu'à l'envoi, et
/// seulement pour ce qui reste ambigu.
enum ProtoAnalyse {
    case articles([String])
    case rappel(String)
    case tache(String)
    case note(String)

    static func de(_ brut: String, type: ProtoTypeCapture) -> ProtoAnalyse {
        let t = brut.trimmingCharacters(in: .whitespacesAndNewlines)
        let morceaux = t.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        switch type {
        case .liste: return .articles(morceaux.isEmpty ? [t] : morceaux)
        case .note: return .note(t)
        case .tache: return .tache(t)
        case .rappel: return .rappel(t)
        case .auto:
            let bas = t.lowercased()
            if bas.contains("demain") || heure(dans: bas) != nil { return .rappel(t) }
            if morceaux.count > 1 { return .articles(morceaux) }
            if bas.hasPrefix("idée") || bas.hasPrefix("penser") { return .note(t) }
            if t.split(separator: " ").count <= 2 { return .articles([t]) }
            return .tache(t)
        }
    }

    static func heure(dans texte: String) -> String? {
        guard let r = texte.range(of: #"\d{1,2} ?h( ?\d{2})?"#, options: .regularExpression) else { return nil }
        return String(texte[r])
    }

    var apercu: String {
        switch self {
        case .articles(let a):
            return a.count == 1 ? "1 article → Courses" : "\(a.count) articles → Courses"
        case .rappel(let t):
            let jour = t.lowercased().contains("demain") ? "demain" : "aujourd'hui"
            let h = ProtoAnalyse.heure(dans: t.lowercased()).map { " à \($0)" } ?? ""
            return "Rappel → \(jour)\(h)"
        case .tache:
            return "Tâche → Motion la placera"
        case .note:
            return "Note → Idées, sans créneau"
        }
    }

    var symbole: String {
        switch self {
        case .articles: return "cart"
        case .rappel: return "bell"
        case .tache: return "checkmark.circle"
        case .note: return "lightbulb"
        }
    }
}

// MARK: - Temps fictif

/// Une journée figée : jeudi 15 octobre 2026, 10 h 40 à Paris. Les captures
/// sont ainsi identiques d'une exécution à l'autre.
enum ProtoTemps {
    static let calendrier: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.locale = Locale(identifier: "fr_FR")
        c.timeZone = TimeZone(identifier: "Europe/Paris") ?? .current
        return c
    }()

    static func a(_ h: Int, _ m: Int) -> Date {
        calendrier.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: h, minute: m)) ?? Date()
    }

    static let maintenant = a(10, 40)

    /// « 10:15 »
    static func heure(_ d: Date) -> String {
        let c = calendrier.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    /// « 11 h 35 »
    static func heureFR(_ d: Date) -> String {
        let c = calendrier.dateComponents([.hour, .minute], from: d)
        let h = c.hour ?? 0
        let m = c.minute ?? 0
        return m == 0 ? "\(h)\u{00A0}h" : String(format: "%d\u{00A0}h\u{00A0}%02d", h, m)
    }

    /// « 50 min », « 1 h 15 »
    static func duree(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes)\u{00A0}min" }
        let h = minutes / 60
        let m = minutes % 60
        return m == 0 ? "\(h)\u{00A0}h" : String(format: "%d\u{00A0}h\u{00A0}%02d", h, m)
    }

    /// Typographie française : « 11 h 35 », « 20 min » et « : » ne se coupent
    /// jamais en fin de ligne (espaces insécables).
    static func insecable(_ s: String) -> String {
        var r = s.replacingOccurrences(of: #"(\d) (h|min)\b"#, with: "$1\u{00A0}$2", options: .regularExpression)
        r = r.replacingOccurrences(of: #"\bh (\d)"#, with: "h\u{00A0}$1", options: .regularExpression)
        r = r.replacingOccurrences(of: " :", with: "\u{00A0}:")
        return r
    }

    /// Minutes depuis 8 h (le haut du planning étendu).
    static func minutesDepuisMatin(_ d: Date) -> CGFloat {
        CGFloat(d.timeIntervalSince(a(8, 0)) / 60)
    }
}

extension String {
    var protoMajuscule: String { prefix(1).uppercased() + dropFirst() }
}

// MARK: - Données fictives

enum ProtoDonnees {
    static var blocs: [ProtoBloc] {
        let a = ProtoTemps.a
        return [
            ProtoBloc(id: "footing", titre: "Footing", categorie: .sport, debut: a(8, 30), fin: a(9, 0), fait: true),
            ProtoBloc(id: "devis", titre: "Relancer les devis en attente", projet: "Sites vitrines", categorie: .pro,
                      debut: a(9, 0), fin: a(9, 45), fait: true),
            ProtoBloc(id: "maquette", titre: "Maquette du site — Fleuriste Martin", projet: "Sites vitrines", categorie: .pro,
                      debut: a(10, 15), fin: a(11, 30)),
            ProtoBloc(id: "trajet", titre: "Trajet", categorie: .proches, debut: a(11, 35), fin: a(11, 55),
                      genre: .trajet, protege: true, lieu: "Bistrot des Halles"),
            ProtoBloc(id: "dejeuner", titre: "Déjeuner avec Léa", categorie: .proches, debut: a(12, 0), fin: a(13, 15),
                      genre: .rdv, protege: true, lieu: "Bistrot des Halles"),
            ProtoBloc(id: "prospection", titre: "Prospection — 4 boutiques, zone nord", projet: "Sites vitrines", categorie: .pro,
                      debut: a(13, 45), fin: a(15, 15)),
            ProtoBloc(id: "assurance", titre: "Appeler l'assurance auto", categorie: .admin, debut: a(15, 30), fin: a(15, 45),
                      echeance: true),
            ProtoBloc(id: "mix", titre: "Retouche des photos", projet: "Album « Été »", categorie: .musique,
                      debut: a(16, 0), fin: a(17, 30)),
            ProtoBloc(id: "salle", titre: "Salle — séance jambes", categorie: .sport, debut: a(18, 30), fin: a(19, 30)),
            ProtoBloc(id: "cs", titre: "CS avec les potes", categorie: .proches, debut: a(21, 0), fin: a(23, 0),
                      genre: .rdv, protege: true, lieu: "En ligne"),
        ]
    }

    static let courses: [ProtoArticle] = [
        ProtoArticle(texte: "Café en grains"),
        ProtoArticle(texte: "Papier cuisson"),
    ]

    static let projets: [ProtoProjet] = [
        ProtoProjet(id: "ep", nom: "Album « Été »", etat: .active, categorie: .musique,
                    prochaine: "Aujourd'hui 16 h · Retouche des photos", semaine: "2 sessions cette semaine"),
        ProtoProjet(id: "garages", nom: "Sites vitrines", etat: .active, categorie: .pro,
                    prochaine: "Aujourd'hui 13 h 45 · Prospection", semaine: "4 tâches cette semaine"),
        ProtoProjet(id: "remy", nom: "App Remy", etat: .legere, categorie: .pro,
                    prochaine: "Lot 1 · choisir le design", semaine: "1 tâche cette semaine"),
        ProtoProjet(id: "bmw", nom: "BMW E46 — finitions", etat: .legere, categorie: .maison,
                    prochaine: "Samedi · Commander les silent-blocs", semaine: "1 tâche cette semaine"),
        ProtoProjet(id: "porto", nom: "Voyage à Porto", etat: .attente, categorie: .proches,
                    prochaine: "En pause jusqu'en janvier", semaine: ""),
        ProtoProjet(id: "podcast", nom: "Podcast sur la vente terrain", etat: .idee, categorie: .pro,
                    prochaine: "Noté le 2 octobre", semaine: ""),
        ProtoProjet(id: "carrosserie", nom: "Template de site pour carrosseries", etat: .idee, categorie: .pro,
                    prochaine: "Noté hier", semaine: ""),
    ]

    static let questions: [ProtoQuestion] = [
        ProtoQuestion(
            id: "prospection", titre: "Prospection", quand: "ce matin",
            contexte: "Elle a sauté deux fois cette semaine : les maquettes débordent sur la matinée.",
            question: "On fait quoi ?",
            options: ["La protéger le matin, de 9 h à 10 h 30", "La passer l'après-midi", "La réduire à 2 garages par session"],
            reformulations: [
                "J'ai compris : la prospection devient un créneau protégé, de 9 h à 10 h 30, du lundi au jeudi. Je l'applique dès lundi ?",
                "J'ai compris : la prospection passe l'après-midi, après 14 h, et les maquettes gardent tes matinées. Je l'applique dès lundi ?",
                "J'ai compris : deux garages par session, mais une session chaque jour. Je l'applique dès lundi ?",
            ]),
        ProtoQuestion(
            id: "cloud", titre: "Abonnement cloud", quand: "hier",
            contexte: "Il se renouvelle le 25 octobre (119 €). Tu ne t'en sers plus depuis août.",
            question: "Je te le rappelle quand ?",
            options: ["3 jours avant", "La veille", "Je résilie : rappelle-moi demain matin"],
            reformulations: [
                "J'ai compris : un rappel le 22 octobre au matin. C'est noté ?",
                "J'ai compris : un rappel le 24 octobre au matin. C'est noté ?",
                "J'ai compris : demain à 9 h, un rappel « résilier le cloud ». C'est noté ?",
            ]),
    ]

    static let fiches: [(texte: String, statut: String)] = [
        ("Week-ends protégés, sauf urgence client", "Confirmé"),
        ("La prospection marche mieux le matin", "Hypothèse · 60 %"),
        ("Deux sessions de musique par semaine", "Objectif"),
    ]

    static let suggestions = [
        "Qu'est-ce que je fais après la maquette ?",
        "Prépare ma prospection de 13 h 45",
        "Est-ce raisonnable de lancer un 3ᵉ projet ?",
    ]
}

// MARK: - État

@Observable
@MainActor
final class ProtoEtat: Identifiable {
    let id = UUID()
    var direction: ProtoDirection
    var nav: ProtoNav
    var onglet: ProtoOnglet = .aujourdhui
    var blocs: [ProtoBloc] = ProtoDonnees.blocs
    var prolongation = 0
    var gererId: String? = nil
    var choixProlongation: Int? = nil
    var planningEtendu = false
    var captureOuverte = false
    var texteCapture = ""
    var typeCapture: ProtoTypeCapture = .auto
    var boiteOuverte = false
    var toast: ProtoToast? = nil
    /// Captures de la CI : le message reste affiché.
    var figerToast = false
    var courses: [ProtoArticle] = ProtoDonnees.courses
    var cheminTiers: [String] = []
    var reponses: [String: Int] = [:]
    var questionsTraitees: Set<String> = []
    var composeur = ""
    /// Légende de la démo animée (vidéos de la CI).
    var legende: String? = nil
    var enDemo = false
    /// Ouvert depuis Réglages : un bouton permet d'en sortir.
    var dansGalerie = false

    init(direction: ProtoDirection, nav: ProtoNav) {
        self.direction = direction
        self.nav = nav
    }

    // MARK: Lecture

    var maintenant: Date { ProtoTemps.maintenant }

    func fin(_ b: ProtoBloc) -> Date {
        b.id == "maquette" ? b.fin.addingTimeInterval(TimeInterval(prolongation * 60)) : b.fin
    }

    var enCours: ProtoBloc? {
        blocs.first { $0.genre == .tache && !$0.fait && $0.debut <= maintenant && fin($0) > maintenant }
    }

    var suite: [ProtoBloc] { blocs.filter { !$0.fait && $0.debut > maintenant } }
    var faits: [ProtoBloc] { blocs.filter { $0.fait } }
    var prochain: ProtoBloc? { suite.first }

    var minutesLibres: Int {
        guard let p = prochain else { return 0 }
        return Int(p.debut.timeIntervalSince(maintenant) / 60)
    }

    func bloc(_ id: String?) -> ProtoBloc? { blocs.first { $0.id == id } }

    var questionsOuvertes: [ProtoQuestion] {
        ProtoDonnees.questions.filter { !questionsTraitees.contains($0.id) }
    }

    func restant(_ b: ProtoBloc) -> Int { Int(fin(b).timeIntervalSince(maintenant) / 60) }

    /// Le micro-conseil : déterministe, calculé sur le planning (plan §5.7).
    var conseil: String {
        if let b = enCours {
            return ProtoTemps.insecable("Il te reste \(ProtoTemps.duree(restant(b))) sur la maquette. Pars à 11 h 35 : 20 min de trajet jusqu'au déjeuner avec Léa.")
        }
        return ProtoTemps.insecable("\(ProtoTemps.duree(minutesLibres)) devant toi avant de partir : appelle l'assurance, l'échéance tombe aujourd'hui.")
    }

    func sousTitre(_ b: ProtoBloc) -> String {
        switch b.genre {
        case .rdv: return "\(b.lieu ?? "Rendez-vous") · protégé"
        case .trajet: return "\(b.minutes) min · vers \(b.lieu ?? "le rendez-vous")"
        case .tache:
            let duree = ProtoTemps.duree(Int(fin(b).timeIntervalSince(b.debut) / 60))
            return "\(b.projet ?? b.categorie.nom) · \(duree)"
        }
    }

    // MARK: Gestes

    func montrer(_ texte: String, annuler: (() -> Void)? = nil) {
        withAnimation(.spring(response: 0.38, dampingFraction: 0.86)) {
            toast = ProtoToast(texte: texte, annuler: annuler)
        }
    }

    func terminer(_ id: String) {
        guard let i = blocs.firstIndex(where: { $0.id == id }) else { return }
        let titre = blocs[i].titre
        Haptique.succes()
        withAnimation(.spring(response: 0.5, dampingFraction: 0.86)) {
            blocs[i].fait = true
            gererId = nil
        }
        montrer("Terminée : \(titre)") { [weak self] in self?.defaire(id) }
    }

    func defaire(_ id: String) {
        guard let i = blocs.firstIndex(where: { $0.id == id }) else { return }
        withAnimation(.spring(response: 0.5, dampingFraction: 0.86)) { blocs[i].fait = false }
    }

    func ouvrirGerer(_ id: String) {
        guard !planningEtendu else { return }
        Haptique.leger()
        choixProlongation = nil
        withAnimation(.spring(response: 0.4, dampingFraction: 0.88)) { gererId = id }
    }

    func fermerPanneaux() {
        withAnimation(.easeOut(duration: 0.18)) {
            gererId = nil
            planningEtendu = false
        }
    }

    func choisir(_ minutes: Int) {
        Haptique.leger()
        withAnimation(.snappy) { choixProlongation = choixProlongation == minutes ? nil : minutes }
    }

    func prolonger(_ minutes: Int) {
        let avant = prolongation
        withAnimation(.spring(response: 0.45, dampingFraction: 0.86)) {
            prolongation += minutes
            gererId = nil
            choixProlongation = nil
        }
        montrer("Prolongée de \(minutes) min") { [weak self] in
            withAnimation(.spring(response: 0.45, dampingFraction: 0.86)) { self?.prolongation = avant }
        }
    }

    func reprendrePlusTard() {
        withAnimation(.easeOut(duration: 0.18)) {
            gererId = nil
            choixProlongation = nil
        }
        montrer("15 min de maquette ajoutées à 15 h 45") {}
    }

    func ouvrirPlanning() {
        guard gererId == nil, !planningEtendu else { return }
        Haptique.leger()
        withAnimation(.spring(response: 0.42, dampingFraction: 0.9)) { planningEtendu = true }
    }

    func ouvrirCapture() {
        Haptique.leger()
        captureOuverte = true
    }

    func envoyerCapture() {
        let brut = texteCapture.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !brut.isEmpty else { return }
        let analyse = ProtoAnalyse.de(brut, type: typeCapture)
        captureOuverte = false
        texteCapture = ""
        typeCapture = .auto
        Haptique.succes()
        switch analyse {
        case .articles(let mots):
            let nouveaux = mots.map { ProtoArticle(texte: $0.protoMajuscule, nouveau: true) }
            let ids = Set(nouveaux.map { $0.id })
            withAnimation(.spring(response: 0.4, dampingFraction: 0.86)) { courses.insert(contentsOf: nouveaux, at: 0) }
            montrer(mots.count == 1 ? "Ajouté à Courses" : "\(mots.count) articles ajoutés à Courses") { [weak self] in
                withAnimation { self?.courses.removeAll { ids.contains($0.id) } }
            }
        case .rappel:
            montrer("Rappel créé, notification programmée") {}
        case .tache:
            montrer("Tâche ajoutée : Motion la placera") {}
        case .note:
            montrer("Noté dans Idées") {}
        }
    }

    func cocher(_ id: UUID) {
        guard let i = courses.firstIndex(where: { $0.id == id }) else { return }
        Haptique.leger()
        withAnimation(.snappy) { courses[i].coche.toggle() }
    }

    func repondre(_ question: String, _ option: Int) {
        Haptique.leger()
        withAnimation(.snappy) { reponses[question] = option }
    }

    func confirmer(_ question: String) {
        Haptique.succes()
        withAnimation(.spring(response: 0.45, dampingFraction: 0.86)) { _ = questionsTraitees.insert(question) }
        montrer("C'est noté") { [weak self] in
            withAnimation { _ = self?.questionsTraitees.remove(question) }
        }
    }

    // MARK: Captures et démo de la CI

    static func depuisEnvironnement() -> ProtoEtat? {
        let env = ProcessInfo.processInfo.environment
        guard let d = env["REMY_PROTO"].flatMap(ProtoDirection.init(rawValue:)) else { return nil }
        let nav = env["REMY_PROTO_NAV"].flatMap(ProtoNav.init(rawValue:)) ?? .carnet
        let e = ProtoEtat(direction: d, nav: nav)
        e.preparer(ecran: env["REMY_PROTO_ECRAN"] ?? "accueil")
        e.enDemo = env["REMY_PROTO_DEMO"] == "1"
        return e
    }

    func preparer(ecran: String) {
        switch ecran {
        case "libre":
            if let i = blocs.firstIndex(where: { $0.id == "maquette" }) { blocs[i].fait = true }
            toast = ProtoToast(texte: "Terminée : Maquette du site — Fleuriste Martin", annuler: {})
            figerToast = true
        case "gerer":
            gererId = "maquette"
            choixProlongation = 15
        case "planning":
            planningEtendu = true
        case "capture":
            captureOuverte = true
            texteCapture = "tomates, lait, œufs"
        case "boite":
            boiteOuverte = true
            reponses["prospection"] = 0
        case "remy":
            onglet = .remy
        case "tiers":
            onglet = .tiers
        case "detail":
            onglet = .tiers
            if nav == .carnet {
                courses.insert(contentsOf: ["Tomates", "Lait", "Œufs"].map { ProtoArticle(texte: $0, nouveau: true) }, at: 0)
                cheminTiers = ["liste-courses"]
            } else {
                cheminTiers = ["projet-ep"]
            }
        default:
            break
        }
    }

    /// Joue les gestes essentiels, avec une légende, pour les vidéos de la CI.
    func jouerDemo() async {
        func pause(_ s: Double) async { try? await Task.sleep(nanoseconds: UInt64(s * 1_000_000_000)) }
        func legender(_ texte: String?) {
            withAnimation(.easeOut(duration: 0.25)) { legende = texte }
        }
        await pause(1.0)
        legender("Aujourd'hui : quoi faire maintenant")
        await pause(2.6)
        legender("Gérer : +15 min, Remy mesure l'impact")
        ouvrirGerer("maquette")
        await pause(1.3)
        choisir(15)
        await pause(3.0)
        fermerPanneaux()
        await pause(0.8)
        legender("Appui long : la journée à l'échelle")
        ouvrirPlanning()
        await pause(3.0)
        fermerPanneaux()
        await pause(0.8)
        legender("+ : noter en deux secondes")
        ouvrirCapture()
        await pause(1.0)
        for c in "tomates, lait, œufs" {
            texteCapture.append(c)
            await pause(0.1)
        }
        await pause(1.8)
        envoyerCapture()
        await pause(2.3)
        legender("Terminer, avec Annuler")
        if enCours != nil { terminer("maquette") }
        await pause(3.0)
        legender(nav == .carnet ? "Carnet : listes, projets, mémoire" : "Projets : actifs, légers, en attente")
        withAnimation(.snappy) { onglet = .tiers }
        await pause(2.0)
        cheminTiers = [nav == .carnet ? "liste-courses" : "projet-ep"]
        await pause(2.6)
        cheminTiers = []
        await pause(0.8)
        legender("Remy : une conversation neuve à chaque fois")
        withAnimation(.snappy) { onglet = .remy }
        await pause(2.8)
        legender(nil)
    }
}
