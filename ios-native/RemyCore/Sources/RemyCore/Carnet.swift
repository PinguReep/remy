import Foundation
import Observation

// Le carnet (Lot 1, J1.5) : listes (courses, anniversaires…) et rappels.
// Tout vit sur la tour ; l'iPhone en garde une copie datée et une file
// d'envoi, pour cocher les courses au magasin même sans réseau. Les
// identifiants naissent ici : une écriture renvoyée après une coupure retombe
// sur la même ligne, jamais en double.

public struct ElementListe: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var texte: String
    public var fait: Bool
    public var ordre: Int?

    public init(id: String = UUID().uuidString, texte: String, fait: Bool = false, ordre: Int? = nil) {
        self.id = id
        self.texte = texte
        self.fait = fait
        self.ordre = ordre
    }
}

public struct Liste: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var nom: String
    public var ordre: Int?
    public var elements: [ElementListe]

    public init(id: String = UUID().uuidString, nom: String, ordre: Int? = nil, elements: [ElementListe] = []) {
        self.id = id
        self.nom = nom
        self.ordre = ordre
        self.elements = elements
    }

    public var restants: Int { elements.filter { !$0.fait }.count }
}

public struct Rappel: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var texte: String
    public var quand: Millis?
    public var fait: Bool
    /// « remy » ou « apple » (importé des Rappels de l'iPhone).
    public var source: String?
    /// Identifiants d'étiquettes (Santé, Voiture…) ; nil : non envoyé (une
    /// tour à jour garde alors celles déjà posées).
    public var etiquettes: [String]?

    public init(id: String = UUID().uuidString, texte: String, quand: Millis? = nil, fait: Bool = false, source: String? = nil, etiquettes: [String]? = nil) {
        self.id = id
        self.texte = texte
        self.quand = quand
        self.fait = fait
        self.source = source
        self.etiquettes = etiquettes
    }
}

// Décodage tolérant : une liste, un article ou un rappel illisible est sauté,
// le reste s'affiche.
struct ReponseListes: Codable {
    var listes: [Liste]
    enum CodingKeys: String, CodingKey { case listes }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var i: [String] = []
        listes = c.listeSouple(Liste.self, .listes, &i) ?? []
    }
}

struct ReponseRappels: Codable {
    var rappels: [Rappel]
    enum CodingKeys: String, CodingKey { case rappels }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var i: [String] = []
        rappels = c.listeSouple(Rappel.self, .rappels, &i) ?? []
    }
}

extension Liste {
    enum CodingKeys: String, CodingKey { case id, nom, ordre, elements }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        var i: [String] = []
        id = try c.decode(String.self, forKey: .id)
        nom = try c.decode(String.self, forKey: .nom)
        ordre = c.souple(Int.self, .ordre, &i)
        elements = c.listeSouple(ElementListe.self, .elements, &i) ?? []
    }
}

/// Une écriture du carnet, gardée sur l'iPhone tant que la tour ne l'a pas reçue.
public enum OperationCarnet: Codable, Sendable, Equatable {
    case liste(id: String, nom: String, ordre: Int?)
    case supprimerListe(id: String)
    case elements(liste: String, [ElementListe])
    case supprimerElement(liste: String, id: String)
    case rappels([Rappel])
    case supprimerRappel(id: String)
}

/// Ce que l'iPhone garde du carnet.
struct CopieCarnet: Codable {
    var listes: [Liste]
    var rappels: [Rappel]
}

@MainActor
@Observable
public final class CarnetModel {
    public private(set) var listes: [Liste] = []
    public private(set) var rappels: [Rappel] = []
    public private(set) var misAJour: Date?
    public private(set) var chargement = false
    public private(set) var erreur: String?
    /// Écritures pas encore reçues par la tour.
    public private(set) var enAttente: [OperationCarnet] = []

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI
    @ObservationIgnored let rangement: Rangement?
    @ObservationIgnored private var envoiEnCours = false

    static let fichier = "carnet.json"
    static let fichierEnvoi = "envoi-carnet.json"

    public init(api: ClientAPI, rangement: Rangement? = nil) {
        self.api = api
        self.rangement = rangement
        if let c = rangement?.copie(CopieCarnet.self, Self.fichier) {
            listes = c.valeur.listes
            rappels = c.valeur.rappels
            misAJour = c.le
        }
        enAttente = rangement?.copie([OperationCarnet].self, Self.fichierEnvoi)?.valeur ?? []
    }

    /// Vrai quand la tour sait garder listes et rappels.
    public var disponible: Bool { app?.serveur?.sait("listes-v1") == true }

    // MARK: Lecture

    /// Envoie d'abord ce qui attend (sinon la tour rendrait un état périmé),
    /// puis relit tout.
    public func charger() async {
        guard disponible, !chargement else { return }
        chargement = true
        defer { chargement = false }
        if !enAttente.isEmpty {
            await envoyer()
            guard enAttente.isEmpty else { return } // toujours hors ligne : on garde l'état local
        }
        do {
            async let l = api.listes()
            async let r = api.rappels()
            let (ll, rr) = try await (l, r)
            listes = ll
            rappels = rr
            misAJour = Date()
            erreur = nil
            garder()
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreur = (error as? LocalizedError)?.errorDescription ?? "Carnet illisible."
        }
    }

    // MARK: Listes

    @discardableResult
    public func creerListe(_ nom: String) -> Liste? {
        let n = nom.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return nil }
        let l = Liste(nom: String(n.prefix(80)), ordre: (listes.compactMap(\.ordre).max() ?? 0) + 1)
        listes.append(l)
        ecrire(.liste(id: l.id, nom: l.nom, ordre: l.ordre))
        return l
    }

    public func renommer(_ liste: Liste, en nom: String) {
        let n = nom.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty, let i = listes.firstIndex(where: { $0.id == liste.id }) else { return }
        listes[i].nom = String(n.prefix(80))
        ecrire(.liste(id: liste.id, nom: listes[i].nom, ordre: listes[i].ordre))
    }

    /// Supprime une liste ; « Annuler » la fait revenir avec ses articles.
    public func supprimer(_ liste: Liste) {
        guard let i = listes.firstIndex(where: { $0.id == liste.id }) else { return }
        let gardee = listes.remove(at: i)
        ecrire(.supprimerListe(id: liste.id))
        app?.dire("Liste « \(gardee.nom) » supprimée.", annuler: { [weak self] in
            guard let self else { return }
            self.listes.insert(gardee, at: min(i, self.listes.count))
            self.ecrire(.liste(id: gardee.id, nom: gardee.nom, ordre: gardee.ordre))
        })
    }

    /// « tomates, lait, œufs » : un article par morceau. Rend les articles
    /// créés (pour « Annuler »).
    @discardableResult
    public func ajouter(_ textes: [String], a liste: Liste) -> [ElementListe] {
        guard let i = listes.firstIndex(where: { $0.id == liste.id }) else { return [] }
        let base = (listes[i].elements.compactMap(\.ordre).max() ?? 0) + 1
        let nouveaux = textes
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .enumerated()
            .map { ElementListe(texte: String($0.element.prefix(300)), ordre: base + $0.offset) }
        guard !nouveaux.isEmpty else { return [] }
        listes[i].elements.append(contentsOf: nouveaux)
        ecrire(.elements(liste: liste.id, nouveaux))
        return nouveaux
    }

    /// Retire des articles sans message (l'« Annuler » d'un ajout).
    public func retirer(_ elements: [ElementListe], de liste: Liste) {
        guard let i = listes.firstIndex(where: { $0.id == liste.id }) else { return }
        let ids = Set(elements.map(\.id))
        listes[i].elements.removeAll { ids.contains($0.id) }
        for e in elements { ecrire(.supprimerElement(liste: liste.id, id: e.id), envoyerTout: false) }
        Task { await envoyer() }
    }

    /// La liste où vont les courses notées au « + » : « Courses » si elle
    /// existe, sinon la première ; aucune liste : « Courses » est créée.
    public func listeParDefaut() -> Liste {
        if let l = listes.first(where: { $0.nom.compare("courses", options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }) {
            return l
        }
        return listes.first ?? creerListe("Courses")!
    }

    /// Les rappels à voir aujourd'hui : en retard ou dans la journée.
    public func duJour(_ maintenant: Date = Date()) -> [Rappel] {
        let fin = Format.calendrier.date(byAdding: .day, value: 1, to: Format.debutDuJour(maintenant))?.millis ?? maintenant.millis
        return rappels.filter { !$0.fait && ($0.quand ?? .infinity) < fin }
    }

    public func basculer(_ element: ElementListe, dans liste: Liste) {
        guard let i = listes.firstIndex(where: { $0.id == liste.id }),
              let j = listes[i].elements.firstIndex(where: { $0.id == element.id }) else { return }
        listes[i].elements[j].fait.toggle()
        ecrire(.elements(liste: liste.id, [listes[i].elements[j]]))
    }

    public func supprimer(_ element: ElementListe, dans liste: Liste) {
        guard let i = listes.firstIndex(where: { $0.id == liste.id }),
              let j = listes[i].elements.firstIndex(where: { $0.id == element.id }) else { return }
        let garde = listes[i].elements.remove(at: j)
        ecrire(.supprimerElement(liste: liste.id, id: element.id))
        app?.dire("« \(garde.texte) » retiré.", annuler: { [weak self] in
            guard let self, let k = self.listes.firstIndex(where: { $0.id == liste.id }) else { return }
            self.listes[k].elements.insert(garde, at: min(j, self.listes[k].elements.count))
            self.ecrire(.elements(liste: liste.id, [garde]))
        })
    }

    /// Retire les articles cochés (après les courses).
    public func effacerCoches(_ liste: Liste) {
        guard let i = listes.firstIndex(where: { $0.id == liste.id }) else { return }
        let coches = listes[i].elements.filter(\.fait)
        guard !coches.isEmpty else { return }
        listes[i].elements.removeAll(where: \.fait)
        for e in coches { ecrire(.supprimerElement(liste: liste.id, id: e.id), envoyerTout: false) }
        Task { await envoyer() }
        app?.dire("\(coches.count) article\(coches.count > 1 ? "s" : "") coché\(coches.count > 1 ? "s" : "") retiré\(coches.count > 1 ? "s" : "").", annuler: { [weak self] in
            guard let self, let k = self.listes.firstIndex(where: { $0.id == liste.id }) else { return }
            self.listes[k].elements.append(contentsOf: coches)
            self.ecrire(.elements(liste: liste.id, coches))
        })
    }

    // MARK: Rappels

    @discardableResult
    public func creerRappel(_ texte: String, quand: Date?, etiquettes: [String]? = nil) -> Rappel? {
        let t = texte.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return nil }
        let r = Rappel(texte: String(t.prefix(300)), quand: quand?.millis, source: "remy", etiquettes: etiquettes?.isEmpty == false ? etiquettes : nil)
        rappels.append(r)
        trierRappels()
        ecrire(.rappels([r]))
        return r
    }

    /// Les rappels à trier (Sam, 18/10) : il y note dans la journée ce qu'il
    /// faut caser. Un rappel en cours attend tant qu'il n'a pas de date, ou pas
    /// de catégorie dès qu'il en existe (`etiquettes` : celles du compte).
    public static func aTraiter(_ rappels: [Rappel], etiquettes: Set<String>) -> [Rappel] {
        rappels.filter { r in
            !r.fait && (r.quand == nil || (!etiquettes.isEmpty && Set(r.etiquettes ?? []).isDisjoint(with: etiquettes)))
        }
    }

    /// Range un rappel en une écriture : sa date (nil : sans date) et ses étiquettes.
    public func ranger(_ rappel: Rappel, quand: Date?, etiquettes ids: [String]) {
        guard let i = rappels.firstIndex(where: { $0.id == rappel.id }) else { return }
        rappels[i].quand = quand?.millis
        rappels[i].etiquettes = ids
        let r = rappels[i]
        trierRappels()
        ecrire(.rappels([r]))
    }

    /// Les étiquettes d'un rappel (Santé, Voiture…).
    public func etiqueter(_ rappel: Rappel, _ ids: [String]) {
        guard let i = rappels.firstIndex(where: { $0.id == rappel.id }) else { return }
        rappels[i].etiquettes = ids
        ecrire(.rappels([rappels[i]]))
    }

    /// Reporter un rappel (« Quand ? », balayage) : sa date seule change, avec
    /// « Annuler ». La notification suit (reprogrammée par l'app).
    public func reporter(_ rappel: Rappel, a quand: Date) {
        guard let i = rappels.firstIndex(where: { $0.id == rappel.id }) else { return }
        let avant = rappels[i]
        rappels[i].quand = quand.millis
        rappels[i].fait = false
        let r = rappels[i]
        trierRappels()
        ecrire(.rappels([r]))
        app?.dire("Rappel : \(Self.quand(quand.millis)).", annuler: { [weak self] in
            guard let self, let k = self.rappels.firstIndex(where: { $0.id == avant.id }) else { return }
            self.rappels[k].quand = avant.quand
            self.rappels[k].fait = avant.fait
            let remis = self.rappels[k]
            self.trierRappels()
            self.ecrire(.rappels([remis]))
        })
    }

    /// Depuis la notification (« Fait », « Dans 1 h », « Demain ») : sans
    /// message (l'app n'est peut-être pas à l'écran), et rien si le rappel a
    /// disparu entre-temps. Rend vrai si quelque chose a changé.
    @discardableResult
    public func depuisNotification(id: String, fait: Bool, quand: Date?) -> Bool {
        guard let i = rappels.firstIndex(where: { $0.id == id }) else { return false }
        if fait {
            guard !rappels[i].fait else { return false }
            rappels[i].fait = true
        } else if let quand {
            rappels[i].quand = quand.millis
            rappels[i].fait = false
        } else {
            return false
        }
        let r = rappels[i]
        trierRappels()
        ecrire(.rappels([r]))
        return true
    }

    /// « aujourd'hui 18:00 », « demain 09:00 », « jeu. 22 oct. 09:00 »
    public static func quand(_ ms: Millis, maintenant: Date = Date()) -> String {
        let d = ms.date
        let auj = Format.debutDuJour(maintenant)
        let jour = Format.debutDuJour(d)
        let ecart = Int((jour.timeIntervalSince(auj) / 86_400).rounded())
        let j = ecart == 0 ? "aujourd'hui" : ecart == 1 ? "demain" : ecart == -1 ? "hier" : Format.jourSemaineCourt(d)
        return j + " " + Format.heure(d)
    }

    public func basculer(_ rappel: Rappel) {
        guard let i = rappels.firstIndex(where: { $0.id == rappel.id }) else { return }
        rappels[i].fait.toggle()
        let r = rappels[i]
        trierRappels()
        ecrire(.rappels([r]))
    }

    public func supprimer(_ rappel: Rappel) {
        guard let i = rappels.firstIndex(where: { $0.id == rappel.id }) else { return }
        let garde = rappels.remove(at: i)
        ecrire(.supprimerRappel(id: rappel.id))
        app?.dire("Rappel retiré.", annuler: { [weak self] in
            guard let self else { return }
            self.rappels.append(garde)
            self.trierRappels()
            self.ecrire(.rappels([garde]))
        })
    }

    /// Retire des rappels sans message (devenus des tâches Motion).
    public func retirerRappels(_ ids: Set<String>) {
        for id in ids where rappels.contains(where: { $0.id == id }) {
            rappels.removeAll { $0.id == id }
            ecrire(.supprimerRappel(id: id))
        }
    }

    /// L'import des rappels de l'iPhone : par lots, rejouable (les identifiants
    /// « apple:… » ne doublent jamais).
    public func importer(_ importes: [Rappel], listes nouvellesListes: [Liste]) {
        for l in nouvellesListes {
            if let i = listes.firstIndex(where: { $0.id == l.id }) {
                listes[i].nom = l.nom
                let deja = Set(listes[i].elements.map(\.id))
                listes[i].elements.append(contentsOf: l.elements.filter { !deja.contains($0.id) })
            } else {
                listes.append(l)
            }
            ecrire(.liste(id: l.id, nom: l.nom, ordre: l.ordre), envoyerTout: false)
            for lot in stride(from: 0, to: l.elements.count, by: 100) {
                ecrire(.elements(liste: l.id, Array(l.elements[lot..<min(lot + 100, l.elements.count)])), envoyerTout: false)
            }
        }
        var vus = Set(rappels.map(\.id))
        let importes = importes.filter { vus.insert($0.id).inserted }
        rappels.append(contentsOf: importes)
        trierRappels()
        for lot in stride(from: 0, to: importes.count, by: 400) {
            ecrire(.rappels(Array(importes[lot..<min(lot + 400, importes.count)])), envoyerTout: false)
        }
        Task { await envoyer() }
    }

    /// À faire, datés d'abord (les plus proches en tête), puis sans date ; les
    /// faits à la fin.
    public static func trier(_ r: [Rappel]) -> [Rappel] {
        r.sorted {
            if $0.fait != $1.fait { return !$0.fait }
            switch ($0.quand, $1.quand) {
            case let (a?, b?): return a < b
            case (_?, nil): return true
            case (nil, _?): return false
            default: return $0.texte < $1.texte
            }
        }
    }

    private func trierRappels() { rappels = Self.trier(rappels) }

    // MARK: Envoi

    private func ecrire(_ op: OperationCarnet, envoyerTout: Bool = true) {
        enAttente.append(op)
        sauverFile()
        garder()
        if envoyerTout { Task { await envoyer() } }
    }

    /// Envoie la file dans l'ordre. Réseau absent : tout reste sur l'iPhone et
    /// repart plus tard. Refus de la tour : l'écriture est abandonnée, c'est
    /// dit, et le carnet est relu (la tour fait foi).
    public func envoyer() async {
        guard !envoiEnCours, disponible else { return }
        envoiEnCours = true
        defer { envoiEnCours = false }
        var refus: String?
        while let op = enAttente.first {
            do {
                try await api.appliquer(op)
            } catch ErreurAPI.reseau {
                return
            } catch ErreurAPI.nonConnecte {
                app?.signaler(ErreurAPI.nonConnecte)
                return
            } catch {
                refus = (error as? LocalizedError)?.errorDescription ?? "écriture refusée"
            }
            enAttente.removeFirst()
            sauverFile()
        }
        if let refus {
            app?.dire("Le carnet n'a pas tout enregistré : \(refus)")
            envoiEnCours = false
            await charger()
        }
    }

    private func garder() {
        try? rangement?.garder(CopieCarnet(listes: listes, rappels: rappels), le: misAJour ?? Date(), Self.fichier)
    }

    private func sauverFile() {
        guard let r = rangement else { return }
        if enAttente.isEmpty { r.effacer(Self.fichierEnvoi) } else { try? r.garder(enAttente, le: Date(), Self.fichierEnvoi) }
    }

    public func vider() {
        listes = []
        rappels = []
        enAttente = []
        misAJour = nil
        erreur = nil
        rangement?.effacer(Self.fichier)
        rangement?.effacer(Self.fichierEnvoi)
    }
}

extension ClientAPI {
    func chemin(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#"))) ?? s
    }

    public func listes() async throws -> [Liste] {
        try await json(ReponseListes.self, "api/listes", delai: 20).listes
    }

    public func rappels() async throws -> [Rappel] {
        try await json(ReponseRappels.self, "api/rappels", delai: 20).rappels
    }

    /// Une écriture du carnet (idempotente : rejouable sans double effet).
    public func appliquer(_ op: OperationCarnet) async throws {
        func corps<T: Encodable>(_ v: T) throws -> [String: Any] {
            (try JSONSerialization.jsonObject(with: JSONEncoder().encode(v)) as? [String: Any]) ?? [:]
        }
        switch op {
        case let .liste(id, nom, ordre):
            var c: [String: Any] = ["nom": nom]
            if let ordre { c["ordre"] = ordre }
            try await brut("api/listes/\(chemin(id))", methode: "PUT", corps: JSONSerialization.data(withJSONObject: c))
        case let .supprimerListe(id):
            try await brut("api/listes/\(chemin(id))", methode: "DELETE")
        case let .elements(liste, elements):
            let c = ["elements": try elements.map { try corps($0) }]
            try await brut("api/listes/\(chemin(liste))/elements", methode: "POST", corps: JSONSerialization.data(withJSONObject: c))
        case let .supprimerElement(liste, id):
            try await brut("api/listes/\(chemin(liste))/elements/\(chemin(id))", methode: "DELETE")
        case let .rappels(r):
            let c = ["rappels": try r.map { try corps($0) }]
            try await brut("api/rappels", methode: "POST", corps: JSONSerialization.data(withJSONObject: c), delai: 60)
        case let .supprimerRappel(id):
            try await brut("api/rappels/\(chemin(id))", methode: "DELETE")
        }
    }

    /// « Bloquée » (ou débloquée) : vit dans Remy, Motion n'a pas ce champ (D12).
    /// Les états gardés par Remy (taches-etat-v2) : seuls les champs envoyés
    /// changent (« commencee » : l'heure du geste ou false ; « fait »).
    public func etatTache(_ id: String, _ corps: [String: Any]) async throws {
        try await brut("api/taches/\(chemin(id))/etat", methode: "PUT", corps: JSONSerialization.data(withJSONObject: corps))
    }

    public func marquerTache(_ id: String, bloquee: Bool, raison: String?) async throws {
        var c: [String: Any] = ["bloquee": bloquee]
        if let raison, !raison.isEmpty { c["raison"] = raison }
        try await brut("api/taches/\(chemin(id))/etat", methode: "PUT", corps: JSONSerialization.data(withJSONObject: c))
    }
}
