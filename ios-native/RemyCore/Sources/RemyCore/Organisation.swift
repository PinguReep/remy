import Foundation
import Observation

// P2/P3 des retours TestFlight 13, en MVP : étiquettes des rappels, dossiers
// (sous-projets, catégories, idées — l'API Motion n'a pas de hiérarchie),
// historique lisible du journal, analyses par GLM local.

public struct Etiquette: Codable, Sendable, Equatable, Identifiable, Hashable {
    public var id: String
    public var nom: String
    public var ordre: Int?
    public init(id: String = UUID().uuidString, nom: String, ordre: Int? = nil) {
        self.id = id
        self.nom = nom
        self.ordre = ordre
    }
}

public struct NoteDossier: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var texte: String
    public var fait: Bool
    public init(id: String = UUID().uuidString, texte: String, fait: Bool = false) {
        self.id = id
        self.texte = texte
        self.fait = fait
    }
}

public struct Dossier: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var nom: String
    /// nil : racine ; « motion:<id> » : sous un projet Motion ; sinon un dossier.
    public var parent: String?
    public var projetMotion: String?
    public var ordre: Int?
    public var notes: [NoteDossier]
    /// Tâches Motion rangées ici.
    public var taches: [String]
    public init(id: String = UUID().uuidString, nom: String, parent: String? = nil, projetMotion: String? = nil, ordre: Int? = nil,
                notes: [NoteDossier] = [], taches: [String] = []) {
        self.id = id
        self.nom = nom
        self.parent = parent
        self.projetMotion = projetMotion
        self.ordre = ordre
        self.notes = notes
        self.taches = taches
    }
}

/// Un élément d'une capture analysée par GLM (rien n'est exécuté avant validation).
public struct ElementCapture: Codable, Sendable, Equatable, Identifiable {
    public var cle: String
    public var nature: String
    public var titre: String
    public var quand: Millis?
    public var heureConnue: Bool?
    public var dureeMin: Int?
    public var liste: String?
    public var articles: [String]?
    public var etiquettes: [String]?
    public var parent: String?
    public var question: String?
    public var id: String { cle }
}

public struct PropositionRappel: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    /// garder, tache, rien
    public var action: String
    public var etiquettes: [String]?
}

public struct EntreeHistorique: Codable, Sendable, Equatable, Identifiable {
    public struct Element: Codable, Sendable, Equatable {
        public var objet: String
        public var action: String
        public var changements: [String]?
        public var erreur: String?
    }
    public var id: String
    public var ts: Millis
    public var source: String
    public var origine: String
    public var resume: String?
    public var etat: String?
    public var annule: Bool?
    public var annulable: Bool?
    public var elements: [Element]
}

struct ReponseEtiquettes: Codable { var etiquettes: [Etiquette] }
struct ReponseDossiers: Codable { var dossiers: [Dossier] }
struct ReponseHistorique: Codable { var entrees: [EntreeHistorique] }

/// Une page de l'historique (historique-v2) : `suite` se renvoie pour lire
/// plus ancien ; nil, il n'y a plus rien.
public struct PageHistorique: Codable, Sendable {
    public var entrees: [EntreeHistorique]
    public var suite: Millis?
}

/// Les filtres de l'historique : vrais échecs, annulées, doublons évités.
public enum FiltreHistorique: String, CaseIterable, Sendable, Identifiable {
    case tout, echouee, annulee, dejaLa = "deja_la"
    public var id: String { rawValue }
    public var titre: String {
        switch self {
        case .tout: return "Tout"
        case .echouee: return "Échouées"
        case .annulee: return "Annulées"
        case .dejaLa: return "Déjà là"
        }
    }
}
struct ReponseAnalyse: Codable { var elements: [ElementCapture] }
struct ReponsePropositions: Codable { var propositions: [PropositionRappel] }
struct ReponseDossier: Codable { var projetMotion: String? }

extension ClientAPI {
    public func etiquettes() async throws -> [Etiquette] {
        try await json(ReponseEtiquettes.self, "api/etiquettes").etiquettes
    }
    public func ecrireEtiquette(_ e: Etiquette) async throws {
        try await brut("api/etiquettes/\(chemin(e.id))", methode: "PUT",
                       corps: JSONSerialization.data(withJSONObject: ["nom": e.nom, "ordre": e.ordre ?? 0]))
    }
    public func supprimerEtiquette(_ id: String) async throws {
        try await brut("api/etiquettes/\(chemin(id))", methode: "DELETE", corps: nil)
    }
    public func dossiers() async throws -> [Dossier] {
        try await json(ReponseDossiers.self, "api/dossiers").dossiers
    }
    /// `motion` : créer aussi le projet dans Motion (grand projet durable).
    @discardableResult
    public func ecrireDossier(_ d: Dossier, motion: Bool = false) async throws -> String? {
        var corps: [String: Any] = ["nom": d.nom, "ordre": d.ordre ?? 0, "motion": motion]
        corps["parent"] = d.parent ?? NSNull()
        return try await json(ReponseDossier.self, "api/dossiers/\(chemin(d.id))", methode: "PUT", corps: corps, delai: 45).projetMotion
    }
    public func supprimerDossier(_ id: String) async throws {
        try await brut("api/dossiers/\(chemin(id))", methode: "DELETE", corps: nil)
    }
    public func ecrireNotes(_ dossier: String, _ notes: [NoteDossier]) async throws {
        let corps: [String: Any] = ["notes": notes.map { ["id": $0.id, "texte": $0.texte, "fait": $0.fait] }]
        try await brut("api/dossiers/\(chemin(dossier))/notes", methode: "POST", corps: JSONSerialization.data(withJSONObject: corps))
    }
    public func supprimerNote(_ dossier: String, _ id: String) async throws {
        try await brut("api/dossiers/\(chemin(dossier))/notes/\(chemin(id))", methode: "DELETE", corps: nil)
    }
    public func rattacher(tache: String, dossier: String?) async throws {
        let corps: [String: Any] = ["dossier": dossier ?? NSNull()]
        try await brut("api/rattachements/\(chemin(tache))", methode: "PUT", corps: JSONSerialization.data(withJSONObject: corps))
    }
    public func historique() async throws -> [EntreeHistorique] {
        try await json(ReponseHistorique.self, "api/historique").entrees
    }

    /// Une page, du plus récent au plus ancien, éventuellement filtrée.
    public func pageHistorique(avant: Millis? = nil, filtre: FiltreHistorique = .tout, limite: Int = 80) async throws -> PageHistorique {
        var q = "limite=\(limite)"
        if let avant { q += "&avant=\(Int64(avant))" }
        if filtre != .tout { q += "&filtre=\(filtre.rawValue)" }
        return try await json(PageHistorique.self, "api/historique?" + q)
    }
    public func analyserCapture(_ texte: String) async throws -> [ElementCapture] {
        try await json(ReponseAnalyse.self, "api/capture/analyser", methode: "POST", corps: ["texte": texte], delai: 100).elements
    }
    public func analyserRappels() async throws -> [PropositionRappel] {
        try await json(ReponsePropositions.self, "api/rappels/analyser", methode: "POST", corps: [:], delai: 300).propositions
    }
}

/// Étiquettes et dossiers, en ligne (rarement hors réseau : un échec est dit
/// et l'écran revient à l'état d'avant).
@MainActor
@Observable
public final class OrganisationModel {
    public private(set) var etiquettes: [Etiquette] = []
    public private(set) var dossiers: [Dossier] = []
    public private(set) var chargement = false
    public private(set) var erreur: String?

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI

    public init(api: ClientAPI) { self.api = api }

    public var etiquettesDisponibles: Bool { app?.serveur?.sait("etiquettes-v1") == true }
    public var dossiersDisponibles: Bool { app?.serveur?.sait("dossiers-v1") == true }

    /// Les étiquettes proposées au premier rangement (Sam, 15/10 : des exemples, pas une liste figée).
    public static let proposees = ["Personnel", "Professionnel", "Santé", "Voiture", "Administratif", "Famille et amis", "Anniversaire"]

    public func charger() async {
        guard (etiquettesDisponibles || dossiersDisponibles), !chargement else { return }
        chargement = true
        defer { chargement = false }
        do {
            if etiquettesDisponibles { etiquettes = try await api.etiquettes() }
            if dossiersDisponibles { dossiers = try await api.dossiers() }
            erreur = nil
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreur = (error as? LocalizedError)?.errorDescription ?? "Organisation illisible."
        }
    }

    public func nom(_ etiquette: String) -> String? { etiquettes.first { $0.id == etiquette }?.nom }
    /// Les noms, dans l'ordre des étiquettes du compte ; une étiquette supprimée disparaît.
    public func noms(_ ids: [String]?) -> [String] {
        let s = Set(ids ?? [])
        return s.isEmpty ? [] : etiquettes.filter { s.contains($0.id) }.map(\.nom)
    }

    // MARK: Étiquettes

    @discardableResult
    public func ajouterEtiquette(_ nom: String) async -> Etiquette? {
        let n = nom.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return nil }
        if let e = etiquettes.first(where: { $0.nom.compare(n, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }) { return e }
        let e = Etiquette(nom: String(n.prefix(40)), ordre: (etiquettes.compactMap(\.ordre).max() ?? -1) + 1)
        etiquettes.append(e)
        do {
            try await api.ecrireEtiquette(e)
            return e
        } catch {
            etiquettes.removeAll { $0.id == e.id }
            echec(error, "L'étiquette « \(e.nom) » n'a pas été créée")
            return nil
        }
    }

    public func renommerEtiquette(_ e: Etiquette, en nom: String) async {
        let n = nom.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty, let i = etiquettes.firstIndex(where: { $0.id == e.id }) else { return }
        let avant = etiquettes[i]
        etiquettes[i].nom = String(n.prefix(40))
        do { try await api.ecrireEtiquette(etiquettes[i]) } catch {
            if let k = etiquettes.firstIndex(where: { $0.id == e.id }) { etiquettes[k] = avant }
            echec(error, "L'étiquette n'a pas été renommée")
        }
    }

    public func supprimerEtiquette(_ e: Etiquette) async {
        guard let i = etiquettes.firstIndex(where: { $0.id == e.id }) else { return }
        let garde = etiquettes.remove(at: i)
        do { try await api.supprimerEtiquette(e.id) } catch {
            etiquettes.insert(garde, at: min(i, etiquettes.count))
            echec(error, "L'étiquette n'a pas été supprimée")
        }
    }

    // MARK: Dossiers

    public func enfants(de parent: String?) -> [Dossier] {
        dossiers.filter { $0.parent == parent }.sorted { ($0.ordre ?? 0, $0.nom) < ($1.ordre ?? 0, $1.nom) }
    }

    /// Le dossier où ranger « titre », deviné par les mots en commun (sans IA).
    public func suggestion(pour titre: String, projets: [Projet]) -> (id: String, nom: String)? {
        let mots = Set(Self.mots(titre))
        guard !mots.isEmpty else { return nil }
        let candidats = projets.map { ("motion:" + $0.id, $0.nom) } + dossiers.map { ($0.id, $0.nom) }
        let meilleur = candidats.map { c in (c, mots.intersection(Self.mots(c.1)).count) }.filter { $0.1 > 0 }.max { $0.1 < $1.1 }
        return meilleur.map { (id: $0.0.0, nom: $0.0.1) }
    }

    static func mots(_ t: String) -> [String] {
        t.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "fr_FR"))
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count >= 4 }
    }

    @discardableResult
    public func creerDossier(_ nom: String, parent: String?, motion: Bool = false) async -> Dossier? {
        let n = nom.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return nil }
        var d = Dossier(nom: String(n.prefix(120)), parent: parent, ordre: (enfants(de: parent).compactMap(\.ordre).max() ?? -1) + 1)
        dossiers.append(d)
        do {
            if let pm = try await api.ecrireDossier(d, motion: motion), let i = dossiers.firstIndex(where: { $0.id == d.id }) {
                dossiers[i].projetMotion = pm
                d.projetMotion = pm
            }
            return d
        } catch {
            dossiers.removeAll { $0.id == d.id }
            echec(error, "« \(d.nom) » n'a pas été créé")
            return nil
        }
    }

    public func renommer(_ d: Dossier, en nom: String) async {
        let n = nom.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty, let i = dossiers.firstIndex(where: { $0.id == d.id }) else { return }
        let avant = dossiers[i]
        dossiers[i].nom = String(n.prefix(120))
        do { try await api.ecrireDossier(dossiers[i]) } catch {
            if let k = dossiers.firstIndex(where: { $0.id == d.id }) { dossiers[k] = avant }
            echec(error, "Le dossier n'a pas été renommé")
        }
    }

    /// Crée le projet dans Motion pour un dossier racine (grand projet durable).
    public func aussiDansMotion(_ d: Dossier) async {
        do {
            if let pm = try await api.ecrireDossier(d, motion: true), let i = dossiers.firstIndex(where: { $0.id == d.id }) {
                dossiers[i].projetMotion = pm
                app?.dire("« \(d.nom) » est aussi un projet Motion.")
                await app?.projets.charger()
            }
        } catch {
            echec(error, "Motion n'a pas créé le projet")
        }
    }

    /// Supprime le dossier et son contenu, avec « Annuler ».
    public func supprimer(_ d: Dossier) async {
        let avant = dossiers
        var aRetirer: Set<String> = [d.id]
        var change = true
        while change {
            change = false
            for x in dossiers where !aRetirer.contains(x.id) && x.parent.map({ aRetirer.contains($0) }) == true {
                aRetirer.insert(x.id)
                change = true
            }
        }
        dossiers.removeAll { aRetirer.contains($0.id) }
        do {
            try await api.supprimerDossier(d.id)
            app?.dire("« \(d.nom) » supprimé.", annuler: { [weak self] in
                Task { await self?.restaurer(avant.filter { aRetirer.contains($0.id) }) }
            })
        } catch {
            dossiers = avant
            echec(error, "« \(d.nom) » n'a pas été supprimé")
        }
    }

    private func restaurer(_ liste: [Dossier]) async {
        for d in liste {
            try? await api.ecrireDossier(d)
            if !d.notes.isEmpty { try? await api.ecrireNotes(d.id, d.notes) }
            for t in d.taches { try? await api.rattacher(tache: t, dossier: d.id) }
        }
        await charger()
        app?.dire("Remis comme avant.")
    }

    @discardableResult
    public func ajouterNote(_ texte: String, dans dossier: String) async -> Bool {
        let t = texte.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, let i = dossiers.firstIndex(where: { $0.id == dossier }) else { return false }
        let n = NoteDossier(texte: String(t.prefix(500)))
        dossiers[i].notes.append(n)
        do {
            try await api.ecrireNotes(dossier, [n])
            return true
        } catch {
            if let k = dossiers.firstIndex(where: { $0.id == dossier }) { dossiers[k].notes.removeAll { $0.id == n.id } }
            echec(error, "La note n'a pas été ajoutée")
            return false
        }
    }

    public func basculer(_ note: NoteDossier, dans dossier: String) async {
        guard let i = dossiers.firstIndex(where: { $0.id == dossier }), let k = dossiers[i].notes.firstIndex(where: { $0.id == note.id }) else { return }
        dossiers[i].notes[k].fait.toggle()
        let n = dossiers[i].notes[k]
        do { try await api.ecrireNotes(dossier, [n]) } catch {
            if let i2 = dossiers.firstIndex(where: { $0.id == dossier }), let k2 = dossiers[i2].notes.firstIndex(where: { $0.id == note.id }) {
                dossiers[i2].notes[k2].fait.toggle()
            }
            echec(error, "La note n'a pas été cochée")
        }
    }

    public func supprimer(_ note: NoteDossier, dans dossier: String) async {
        guard let i = dossiers.firstIndex(where: { $0.id == dossier }) else { return }
        dossiers[i].notes.removeAll { $0.id == note.id }
        do { try await api.supprimerNote(dossier, note.id) } catch {
            if let k = dossiers.firstIndex(where: { $0.id == dossier }) { dossiers[k].notes.append(note) }
            echec(error, "La note n'a pas été retirée")
        }
    }

    /// Range une tâche Motion dans un sous-projet (nil : la sortir).
    public func ranger(tache: String, dans dossier: String?) async {
        let avant = dossiers
        for i in dossiers.indices { dossiers[i].taches.removeAll { $0 == tache } }
        if let dossier, let i = dossiers.firstIndex(where: { $0.id == dossier }) { dossiers[i].taches.append(tache) }
        do { try await api.rattacher(tache: tache, dossier: dossier) } catch {
            dossiers = avant
            echec(error, "La tâche n'a pas été rangée")
        }
    }

    /// Le dossier des notes sans projet (créé au premier besoin).
    public func dossierNotes() async -> Dossier? {
        if let d = dossiers.first(where: { $0.id == "notes" }) { return d }
        let d = Dossier(id: "notes", nom: "Notes", parent: nil, ordre: -1)
        dossiers.append(d)
        do {
            try await api.ecrireDossier(d)
            return d
        } catch {
            dossiers.removeAll { $0.id == "notes" }
            echec(error, "Le dossier « Notes » n'a pas été créé")
            return nil
        }
    }

    private func echec(_ error: Error, _ quoi: String) {
        if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
        app?.dire("\(quoi) : \((error as? LocalizedError)?.errorDescription ?? "erreur").")
    }

    public func vider() {
        etiquettes = []
        dossiers = []
    }
}

/// L'historique des actions (journal du Lot 0), avec « Annuler » quand c'est possible.
@MainActor
@Observable
public final class HistoriqueModel {
    public private(set) var entrees: [EntreeHistorique] = []
    public private(set) var chargement = false
    public private(set) var erreur: String?
    public private(set) var annulations: Set<String> = []
    /// Le filtre affiché (historique-v2) ; changer de filtre relit la première page.
    public private(set) var filtre: FiltreHistorique = .tout
    /// De quoi lire plus ancien ; nil : tout est affiché.
    public private(set) var suite: Millis?
    public private(set) var chargementSuite = false
    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI

    public init(api: ClientAPI) { self.api = api }

    public var disponible: Bool { app?.serveur?.sait("historique-v1") == true }
    /// Pages et filtres : tour à jour du 24/10.
    public var paginable: Bool { app?.serveur?.sait("historique-v2") == true }

    public func charger() async {
        guard disponible, !chargement else { return }
        chargement = true
        defer { chargement = false }
        do {
            if paginable {
                let p = try await api.pageHistorique(filtre: filtre)
                entrees = p.entrees
                suite = p.suite
            } else {
                entrees = try await api.historique()
                suite = nil
            }
            erreur = nil
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreur = (error as? LocalizedError)?.errorDescription ?? "Historique illisible."
        }
    }

    public func filtrer(_ f: FiltreHistorique) async {
        guard f != filtre else { return }
        filtre = f
        entrees = []
        suite = nil
        await charger()
    }

    /// « Plus ancien » : la page suivante, ajoutée sous les autres.
    public func plusAncien() async {
        guard paginable, let avant = suite, !chargementSuite else { return }
        chargementSuite = true
        defer { chargementSuite = false }
        do {
            let p = try await api.pageHistorique(avant: avant, filtre: filtre)
            let connus = Set(entrees.map(\.id))
            entrees += p.entrees.filter { !connus.contains($0.id) }
            suite = p.suite
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            app?.dire("Plus ancien illisible : \((error as? LocalizedError)?.errorDescription ?? "erreur")")
        }
    }

    public func annuler(_ e: EntreeHistorique) async {
        guard e.annulable == true, !annulations.contains(e.id) else { return }
        annulations.insert(e.id)
        defer { annulations.remove(e.id) }
        do {
            let r = try await api.annuler(Proposition(source: e.source, resume: nil, actions: [], ledgerId: e.id))
            app?.dire(r.ok == false ? "Pas tout à fait annulé : vérifie dans \(e.source == "agenda" ? "ton agenda" : "Motion")." : "Annulé.")
            await charger()
            await app?.tableau.apresGeste()
        } catch {
            if let x = error as? ErreurAPI, x == .nonConnecte { app?.signaler(x); return }
            app?.dire("Impossible d'annuler : \((error as? LocalizedError)?.errorDescription ?? "erreur").")
        }
    }

    public func vider() { entrees = [] }
}
