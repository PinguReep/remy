import Foundation
import Observation

// MARK: - « À trancher » et la revue du dimanche (24/10)
//
// Tout s'empilait : cartes en attente dans des fils oubliés, rappels sans date
// ou redits, articles pris, fils d'un seul échange, idées jamais relues. La
// tour rassemble (GET /api/a-trancher) ; ici, un geste par ligne, par les
// chemins qui existent déjà (chaîne d'écriture, carnet), toujours annulable.
// Aucun appel IA.

public struct LigneATrancher: Codable, Sendable, Equatable, Identifiable {
    public var cle: String
    /// carte | doublon | rappel | articles | idee | fil | retard | rappel-retard
    public var type: String
    public var texte: String
    public var detail: String?
    public var depuis: Millis?
    public var convId: String?
    public var propositionId: String?
    public var source: String?
    public var rappelId: String?
    public var doublons: [String]?
    public var listeId: String?
    public var nombre: Int?
    public var dossierId: String?
    public var noteId: String?
    public var tacheId: String?
    public var id: String { cle }

    public init(cle: String, type: String, texte: String, detail: String? = nil, depuis: Millis? = nil, convId: String? = nil,
                propositionId: String? = nil, source: String? = nil, rappelId: String? = nil, doublons: [String]? = nil,
                listeId: String? = nil, nombre: Int? = nil, dossierId: String? = nil, noteId: String? = nil, tacheId: String? = nil) {
        self.cle = cle
        self.type = type
        self.texte = texte
        self.detail = detail
        self.depuis = depuis
        self.convId = convId
        self.propositionId = propositionId
        self.source = source
        self.rappelId = rappelId
        self.doublons = doublons
        self.listeId = listeId
        self.nombre = nombre
        self.dossierId = dossierId
        self.noteId = noteId
        self.tacheId = tacheId
    }
}

public struct GroupeATrancher: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var titre: String
    public var total: Int
    public var lignes: [LigneATrancher]
    public init(id: String, titre: String, total: Int, lignes: [LigneATrancher]) {
        self.id = id
        self.titre = titre
        self.total = total
        self.lignes = lignes
    }
}

public struct VueATrancher: Codable, Sendable, Equatable {
    public var genereA: Millis?
    public var total: Int?
    public var reportes: Int?
    public var groupes: [GroupeATrancher]?
    public var retards: [LigneATrancher]?
    public init(genereA: Millis? = nil, total: Int? = nil, reportes: Int? = nil, groupes: [GroupeATrancher]? = nil, retards: [LigneATrancher]? = nil) {
        self.genereA = genereA
        self.total = total
        self.reportes = reportes
        self.groupes = groupes
        self.retards = retards
    }
}

/// La semaine par domaine (GET /api/revue), calculée sans IA par la tour.
public struct VueRevue: Codable, Sendable, Equatable {
    public struct Domaine: Codable, Sendable, Equatable, Identifiable {
        public var nom: String
        public var faites: Int
        public var glissees: Int
        public var minutes: Int
        public var id: String { nom }
    }
    public struct Faite: Codable, Sendable, Equatable {
        public var nom: String
        public var projet: String?
        public var minutes: Int?
        public var a: Millis?
    }
    public struct Glissee: Codable, Sendable, Equatable, Identifiable {
        public var id: String
        public var nom: String
        public var projet: String?
        public var echeance: Millis?
    }
    public struct Decisions: Codable, Sendable, Equatable {
        public var semaine: Millis?
        public var liste: [String]
        public var a: Millis?
    }
    public var debut: Millis?
    public var fin: Millis?
    public var domaines: [Domaine]?
    public var faites: [Faite]?
    public var glissees: [Glissee]?
    public var rappelsFaits: Int?
    /// « Ce que j'ai appris sur toi » : les hypothèses déjà écrites par la nuit.
    public var appris: [String]?
    public var decisions: Decisions?
    public var aTrancher: Int?
}

/// Un geste sur une ligne. Chaque type de ligne a les siens.
public enum GesteTri: String, Sendable, CaseIterable {
    case oui, non, plusTard, supprimer, fusionner, retirer, garder, fait, demain, abandonner

    public var libelle: String {
        switch self {
        case .oui: return "Oui"
        case .non: return "Non"
        case .plusTard: return "Plus tard"
        case .supprimer: return "Supprimer"
        case .fusionner: return "Fusionner"
        case .retirer: return "Retirer"
        case .garder: return "Gardée"
        case .fait: return "Fait"
        case .demain: return "Demain"
        case .abandonner: return "Abandonner"
        }
    }

    public var symbole: String {
        switch self {
        case .oui, .fait: return "checkmark"
        case .non: return "xmark"
        case .plusTard: return "clock"
        case .supprimer, .retirer: return "trash"
        case .fusionner: return "arrow.triangle.merge"
        case .garder: return "tray.and.arrow.down"
        case .demain: return "sunrise"
        case .abandonner: return "minus.circle"
        }
    }

    /// Le geste principal d'une ligne (mis en avant).
    public var principal: Bool { [.oui, .fusionner, .retirer, .fait].contains(self) }

    public static func pour(_ type: String) -> [GesteTri] {
        switch type {
        case "carte": return [.oui, .non, .plusTard]
        case "doublon": return [.fusionner, .plusTard]
        case "rappel": return [.supprimer, .plusTard]
        case "articles": return [.retirer, .plusTard]
        case "idee": return [.garder, .supprimer, .plusTard]
        case "fil": return [.supprimer, .plusTard]
        case "retard", "rappel-retard": return [.fait, .demain, .abandonner]
        default: return [.plusTard]
        }
    }
}

/// Les rendez-vous de la semaine, purs (testés sous Linux).
public enum RituelSemaine {
    static let jour: TimeInterval = 86_400
    /// Au-delà, Rémy propose de trier les retards au retour.
    public static let absenceJours = 3

    static var calendrier: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = .current
        c.firstWeekday = 2
        return c
    }

    /// Le lundi 00:00 de la semaine de `d`.
    public static func debutSemaine(_ d: Date) -> Date {
        let c = calendrier
        let jour = c.startOfDay(for: d)
        let decalage = (c.component(.weekday, from: jour) + 5) % 7
        return c.date(byAdding: .day, value: -decalage, to: jour) ?? jour
    }

    /// La revue est proposée le dimanche, tant qu'elle n'a pas été faite cette
    /// semaine-là, et seulement si Sam ne l'a pas coupée.
    public static func revueProposee(maintenant: Date, active: Bool, faiteLe: Date?) -> Bool {
        guard active, calendrier.component(.weekday, from: maintenant) == 1 else { return false }
        guard let f = faiteLe else { return true }
        return debutSemaine(f) != debutSemaine(maintenant)
    }

    /// Plus de 3 jours sans ouvrir l'app.
    public static func apresAbsence(derniere: Date?, maintenant: Date) -> Bool {
        guard let derniere else { return false }
        return maintenant.timeIntervalSince(derniere) > Double(absenceJours) * jour
    }

    /// Les rappels datés passés, pas faits : à trier avec les tâches en retard.
    public static func rappelsEnRetard(_ rappels: [Rappel], maintenant: Date) -> [LigneATrancher] {
        rappels.filter { !$0.fait && ($0.quand ?? .infinity) < maintenant.millis - 3_600_000 }
            .sorted { ($0.quand ?? 0) < ($1.quand ?? 0) }
            .map { LigneATrancher(cle: "rappelretard:\($0.id)", type: "rappel-retard", texte: $0.texte, detail: "Rappel", depuis: $0.quand, rappelId: $0.id) }
    }

    /// Les groupes tels qu'ils restent après les gestes faits sur l'iPhone :
    /// une ligne réglée (ou reportée) sort ; une ligne du carnet suit l'état
    /// local (le carnet de l'iPhone est en avance sur la tour).
    public static func filtrer(_ groupes: [GroupeATrancher], masquees: Set<String>, rappels: [Rappel]?, listes: [Liste]?) -> [GroupeATrancher] {
        let ouverts = rappels.map { Dictionary($0.filter { !$0.fait }.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }
        let parListe = listes.map { Dictionary($0.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }
        return groupes.compactMap { g in
            var lignes: [LigneATrancher] = []
            for l in g.lignes where !masquees.contains(l.cle) {
                switch l.type {
                case "rappel":
                    if let o = ouverts, let id = l.rappelId { guard let r = o[id], r.quand == nil else { continue } }
                case "doublon":
                    if let o = ouverts, let id = l.rappelId {
                        guard o[id] != nil, (l.doublons ?? []).contains(where: { o[$0] != nil }) else { continue }
                    }
                case "articles":
                    if let p = parListe, let id = l.listeId {
                        guard let liste = p[id] else { continue }
                        let pris = liste.elements.filter(\.fait)
                        guard !pris.isEmpty else { continue }
                        var m = l
                        m.nombre = pris.count
                        m.texte = "\(liste.nom) : \(pris.count) article\(pris.count > 1 ? "s" : "") pris"
                        lignes.append(m)
                        continue
                    }
                default: break
                }
                lignes.append(l)
            }
            let partis = g.lignes.count - lignes.count
            guard !lignes.isEmpty else { return nil }
            return GroupeATrancher(id: g.id, titre: g.titre, total: max(lignes.count, g.total - partis), lignes: lignes)
        }
    }
}

@MainActor
@Observable
public final class ATrancherModel {
    public enum Feuille: String, Identifiable, Sendable {
        case aTrancher, revue, retards
        public var id: String { rawValue }
    }

    /// La feuille ouverte (À trancher, la revue, « On trie tes retards ? »).
    public var feuille: Feuille?
    public private(set) var vue: VueATrancher?
    public private(set) var chargement = false
    public private(set) var erreur: String?
    public private(set) var luA: Date?
    /// Les lignes dont le geste est en route.
    public private(set) var enCours: Set<String> = []
    /// Les lignes réglées sur l'iPhone (elles reviennent si « Annuler »).
    public private(set) var masquees: Set<String> = []
    public private(set) var revue: VueRevue?
    public private(set) var chargementRevue = false
    public private(set) var erreurRevue: String?

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI
    @ObservationIgnored let reglages: UserDefaults
    /// Un fil supprimé attend ce délai avant de partir (« Annuler » d'abord).
    @ObservationIgnored public var delaiSuppression: Double = 6
    @ObservationIgnored private var renonces: Set<String> = []

    public static let cleRevue = "remy.revueDimanche"
    public static let cleRevueFaite = "remy.revueFaiteLe"
    public static let cleDerniereVisite = "remy.derniereVisite"

    public init(api: ClientAPI, reglages: UserDefaults = .standard) {
        self.api = api
        self.reglages = reglages
    }

    public var disponible: Bool { app?.serveur?.sait("a-trancher-v1") == true }

    // MARK: Lecture

    public func charger() async {
        guard disponible, !chargement else { return }
        chargement = true
        defer { chargement = false }
        do {
            vue = try await api.aTrancher()
            luA = Date()
            masquees = []
            erreur = nil
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreur = (error as? LocalizedError)?.errorDescription ?? "Lecture impossible."
        }
    }

    /// Relu s'il date de plus de 10 minutes (ou jamais lu).
    public func chargerSiAncien() async {
        if luA.map({ Date().timeIntervalSince($0) > 600 }) ?? true { await charger() }
    }

    public var groupes: [GroupeATrancher] {
        let carnet = app?.carnet
        let charge = carnet?.misAJour != nil
        return RituelSemaine.filtrer(vue?.groupes ?? [], masquees: masquees,
                                     rappels: charge ? carnet?.rappels : nil, listes: charge ? carnet?.listes : nil)
    }

    public var total: Int { groupes.reduce(0) { $0 + $1.total } }

    /// Ce qui est en retard : les tâches Motion (tour) et les rappels datés passés.
    public func retards(maintenant: Date = Date()) -> [LigneATrancher] {
        let motion = (vue?.retards ?? []).filter { !masquees.contains($0.cle) }
        let rappels = RituelSemaine.rappelsEnRetard(app?.carnet.rappels ?? [], maintenant: maintenant)
            .filter { !masquees.contains($0.cle) }
        return motion + rappels
    }

    // MARK: Rendez-vous de la semaine

    public var revueActive: Bool {
        get { reglages.object(forKey: Self.cleRevue) as? Bool ?? true }
        set { reglages.set(newValue, forKey: Self.cleRevue) }
    }

    public func revueProposee(maintenant: Date = Date()) -> Bool {
        let faite = reglages.object(forKey: Self.cleRevueFaite) as? Double
        return disponible && RituelSemaine.revueProposee(maintenant: maintenant, active: revueActive,
                                                         faiteLe: faite.map { Date(timeIntervalSince1970: $0) })
    }

    public func marquerRevueFaite(maintenant: Date = Date()) {
        reglages.set(maintenant.timeIntervalSince1970, forKey: Self.cleRevueFaite)
    }

    /// Au retour au premier plan : vrai après plus de 3 jours d'absence. La
    /// visite est notée dans tous les cas.
    @discardableResult
    public func noterVisite(maintenant: Date = Date()) -> Bool {
        let avant = reglages.object(forKey: Self.cleDerniereVisite) as? Double
        reglages.set(maintenant.timeIntervalSince1970, forKey: Self.cleDerniereVisite)
        return RituelSemaine.apresAbsence(derniere: avant.map { Date(timeIntervalSince1970: $0) }, maintenant: maintenant)
    }

    /// Après une absence : « On trie tes retards ? », s'il y en a.
    public func auRetour(absent: Bool) async {
        guard absent, disponible else { return }
        await charger()
        if feuille == nil, !retards().isEmpty { feuille = .retards }
    }

    // MARK: La revue

    public func chargerRevue() async {
        guard disponible, !chargementRevue else { return }
        chargementRevue = true
        defer { chargementRevue = false }
        do {
            revue = try await api.revue()
            erreurRevue = nil
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreurRevue = (error as? LocalizedError)?.errorDescription ?? "Lecture impossible."
        }
    }

    /// Les trois décisions de la semaine, gardées sur la tour.
    @discardableResult
    public func enregistrerDecisions(_ liste: [String]) async -> Bool {
        let propres = liste.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        do {
            let d = try await api.ecrireDecisions(propres)
            revue?.decisions = d
            app?.dire(propres.isEmpty ? "Aucune décision gardée." : "Gardé : \(propres.count) décision\(propres.count > 1 ? "s" : "") pour la semaine.")
            return true
        } catch {
            echec(error, "Décisions pas enregistrées")
            return false
        }
    }

    // MARK: Gestes

    public func agir(_ g: GesteTri, sur l: LigneATrancher) async {
        guard enCours.insert(l.cle).inserted else { return }
        defer { enCours.remove(l.cle) }
        switch (g, l.type) {
        case (.plusTard, _): await reporter(l)
        case (.oui, "carte"): await accepter(l)
        case (.non, "carte"): await refuser(l)
        case (.fusionner, "doublon"): fusionner(l)
        case (.supprimer, "rappel"), (.abandonner, "rappel-retard"): supprimerRappel(l)
        case (.retirer, "articles"): retirerArticles(l)
        case (.garder, "idee"): await noter(l, fait: true)
        case (.supprimer, "idee"): await noter(l, fait: nil)
        case (.supprimer, "fil"): await supprimerFil(l)
        case (.fait, "retard"): await terminer(l)
        case (.demain, "retard"): await aDemain(l)
        case (.abandonner, "retard"): await abandonner(l)
        case (.fait, "rappel-retard"): rappelFait(l)
        case (.demain, "rappel-retard"): rappelDemain(l)
        default: break
        }
    }

    private func masquer(_ l: LigneATrancher) { masquees.insert(l.cle) }
    private func montrer(_ l: LigneATrancher) { masquees.remove(l.cle) }

    private func echec(_ error: Error, _ quoi: String) {
        if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
        let raison = (error as? LocalizedError)?.errorDescription ?? "erreur"
        app?.dire("\(quoi) : \(raison)")
    }

    private func reporter(_ l: LigneATrancher) async {
        do {
            try await api.reporterTri(l.cle)
            masquer(l)
            app?.dire("Revient dans une semaine.", annuler: { [weak self] in
                Task { await self?.annulerReport(l) }
            })
        } catch { echec(error, "Pas reporté") }
    }

    private func annulerReport(_ l: LigneATrancher) async {
        do {
            try await api.annulerReportTri(l.cle)
            montrer(l)
        } catch { echec(error, "Le report n'a pas été annulé") }
    }

    /// « Oui » sur une carte : la chaîne d'écriture lit la proposition dans la
    /// conversation stockée (jamais dans la requête) ; « Annuler » la défait.
    private func accepter(_ l: LigneATrancher) async {
        guard let conv = l.convId, let pid = l.propositionId else { return }
        if l.source == "regle" {
            do {
                let ids = try await api.validerRegleTri(convId: conv, propositionId: pid)
                masquer(l)
                var annuler: (@MainActor () -> Void)?
                if !ids.isEmpty {
                    annuler = { [weak self] in
                        Task {
                            for id in ids { _ = try? await self?.api.supprimerRegle(id) }
                            self?.app?.dire("Règle retirée.")
                        }
                    }
                }
                app?.dire("Règle créée.", annuler: annuler)
            } catch { echec(error, "Règle pas créée") }
            return
        }
        let p = Proposition(id: pid, source: l.source ?? "motion", resume: nil, actions: [])
        do {
            let r = try await api.appliquer(p, convId: conv, index: nil)
            let rates = r.bilan.echoues ?? []
            if r.etat == "echouee" {
                app?.dire("Pas fait : \(rates.first?.erreur ?? "raison inconnue").")
                return
            }
            masquer(l)
            var annuler: (@MainActor () -> Void)?
            if let ledger = r.ledgerId {
                annuler = { [weak self] in
                    Task { await self?.defaire(ledger, source: l.source, ligne: nil) }
                }
            }
            app?.dire(rates.isEmpty ? "C'est fait." : "Fait en partie : \(rates.count) changement\(rates.count > 1 ? "s" : "") refusé\(rates.count > 1 ? "s" : "").",
                      annuler: annuler)
            await app?.tableau.apresGeste()
        } catch { echec(error, "Pas fait") }
    }

    /// Défait une écriture de la chaîne (journal). `ligne` : à remontrer.
    private func defaire(_ ledger: String, source: String?, ligne: LigneATrancher?) async {
        do {
            let r = try await api.annuler(Proposition(source: source ?? "motion", resume: nil, actions: [], ledgerId: ledger))
            if r.ok == false {
                app?.dire("Annulation incomplète : vérifie ton planning.")
            } else {
                app?.dire("Annulé : tout est revenu comme avant.")
                if let ligne { montrer(ligne) }
            }
            await app?.tableau.apresGeste()
        } catch { echec(error, "Pas annulé") }
    }

    private func refuser(_ l: LigneATrancher) async {
        guard let conv = l.convId, let pid = l.propositionId else { return }
        do {
            try await api.refuser(convId: conv, propositionId: pid)
            masquer(l)
            app?.dire("Écartée : rien n'a été changé.", annuler: { [weak self] in
                Task {
                    do {
                        try await self?.api.rouvrirCarte(pid)
                        self?.montrer(l)
                    } catch { self?.echec(error, "La carte n'a pas été rouverte") }
                }
            })
        } catch { echec(error, "« Non » pas enregistré") }
    }

    /// Les doublons partent, le rappel gardé reste ; « Annuler » les remet.
    private func fusionner(_ l: LigneATrancher) {
        guard let carnet = app?.carnet else { return }
        let ids = Set(l.doublons ?? [])
        let retires = carnet.rappels.filter { ids.contains($0.id) }
        guard !retires.isEmpty else {
            masquer(l)
            app?.dire("Déjà fusionnés.")
            return
        }
        carnet.retirerRappels(ids)
        app?.dire("Fusionnés : « \(l.texte) » ne reste qu'une fois.", annuler: { [weak carnet] in
            carnet?.remettre(retires)
        })
    }

    private func supprimerRappel(_ l: LigneATrancher) {
        guard let carnet = app?.carnet else { return }
        guard let r = carnet.rappels.first(where: { $0.id == l.rappelId }) else {
            masquer(l)
            app?.dire("Ce rappel n'est plus là.")
            return
        }
        // Le carnet dit « Rappel retiré » avec son propre « Annuler ».
        carnet.supprimer(r)
    }

    private func retirerArticles(_ l: LigneATrancher) {
        guard let carnet = app?.carnet else { return }
        guard let liste = carnet.listes.first(where: { $0.id == l.listeId }) else {
            masquer(l)
            app?.dire("Cette liste n'existe plus.")
            return
        }
        carnet.effacerCoches(liste)
    }

    /// Une idée gardée (marquée relue) ou supprimée ; « Annuler » la remet telle quelle.
    private func noter(_ l: LigneATrancher, fait: Bool?) async {
        guard let dossier = l.dossierId, let id = l.noteId else { return }
        let avant = NoteDossier(id: id, texte: l.texte, fait: false)
        do {
            if let fait {
                try await api.ecrireNotes(dossier, [NoteDossier(id: id, texte: l.texte, fait: fait)])
            } else {
                try await api.supprimerNote(dossier, id)
            }
            masquer(l)
            app?.dire(fait == nil ? "Idée supprimée." : "Gardée dans « Idées », marquée relue.", annuler: { [weak self] in
                Task {
                    do {
                        try await self?.api.ecrireNotes(dossier, [avant])
                        self?.montrer(l)
                        await self?.app?.organisation.charger()
                    } catch { self?.echec(error, "L'idée n'est pas revenue") }
                }
            })
            await app?.organisation.charger()
        } catch { echec(error, fait == nil ? "Idée pas supprimée" : "Idée pas rangée") }
    }

    /// Un fil supprimé ne part qu'après le délai : « Annuler » pendant ce temps,
    /// et rien n'a été effacé (une suppression de fil ne se rattrape pas).
    private func supprimerFil(_ l: LigneATrancher) async {
        guard let conv = l.convId else { return }
        masquer(l)
        renonces.remove(l.cle)
        app?.dire("Fil supprimé.", annuler: { [weak self] in
            self?.renonces.insert(l.cle)
            self?.montrer(l)
        }, duree: delaiSuppression)
        if delaiSuppression > 0 { try? await Task.sleep(nanoseconds: UInt64(delaiSuppression * 1_000_000_000)) }
        guard !renonces.contains(l.cle) else { return }
        do {
            try await api.supprimer(conv)
            await app?.chat.rafraichirListe()
        } catch {
            montrer(l)
            echec(error, "Le fil n'a pas été supprimé")
        }
    }

    // MARK: Retards

    /// « Fait » : la coche habituelle (file d'envoi, « Annuler » du bandeau).
    private func terminer(_ l: LigneATrancher) async {
        guard let id = l.tacheId, let tableau = app?.tableau else { return }
        masquer(l)
        let issue = await tableau.terminer(id: id, titre: l.texte)
        if issue == .renoncee || issue == .echec { montrer(l) }
    }

    private func aDemain(_ l: LigneATrancher) async {
        guard let id = l.tacheId, let tableau = app?.tableau else { return }
        if await tableau.replanifier(id: id, titre: l.texte, echeance: Format.echeanceDans(jours: 1)) { masquer(l) }
    }

    /// « Abandonner » : la tâche est close dans Motion (il n'a pas d'« abandonné »),
    /// par la chaîne d'écriture ; « Annuler » la rouvre.
    private func abandonner(_ l: LigneATrancher) async {
        guard let id = l.tacheId else { return }
        let p = Proposition(source: "motion", resume: "Abandonnée (tri des retards)",
                            actions: [ActionProposee(type: "terminer", nom: l.texte, id: id)])
        do {
            let r = try await api.appliquer(p, convId: nil, index: nil, idCommande: UUID().uuidString)
            if (r.echecs ?? 0) > 0 || r.results?.first?.ok == false {
                app?.dire("Motion n'a pas pu retirer « \(l.texte) » : \(r.results?.first?.erreur ?? "raison inconnue").")
                return
            }
            masquer(l)
            var annuler: (@MainActor () -> Void)?
            if let ledger = r.ledgerId {
                annuler = { [weak self] in
                    Task { await self?.defaire(ledger, source: "motion", ligne: l) }
                }
            }
            app?.dire("« \(l.texte) » abandonnée : retirée de ton planning.", annuler: annuler)
            await app?.tableau.apresGeste()
        } catch { echec(error, "Pas abandonnée") }
    }

    private func rappelFait(_ l: LigneATrancher) {
        guard let carnet = app?.carnet, let r = carnet.rappels.first(where: { $0.id == l.rappelId }) else { return }
        carnet.basculer(r)
        app?.dire("« \(l.texte) » : fait.", annuler: { [weak carnet] in
            if let c = carnet, let x = c.rappels.first(where: { $0.id == r.id }), x.fait { c.basculer(x) }
        })
    }

    /// Demain, à la même heure.
    private func rappelDemain(_ l: LigneATrancher) {
        guard let carnet = app?.carnet, let r = carnet.rappels.first(where: { $0.id == l.rappelId }) else { return }
        let avant = r.quand
        let heure = (r.quand ?? Date().millis).date
        let cal = RituelSemaine.calendrier
        let demain = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: Date())) ?? Date()
        let h = cal.dateComponents([.hour, .minute], from: heure)
        let quand = cal.date(bySettingHour: h.hour ?? 9, minute: h.minute ?? 0, second: 0, of: demain) ?? demain
        carnet.ranger(r, quand: quand, etiquettes: r.etiquettes ?? [])
        app?.dire("« \(l.texte) » : demain, \(Format.heure(quand)).", annuler: { [weak carnet] in
            if let c = carnet, let x = c.rappels.first(where: { $0.id == r.id }) {
                c.ranger(x, quand: avant?.date, etiquettes: x.etiquettes ?? [])
            }
        })
    }

    public func vider() {
        vue = nil
        revue = nil
        masquees = []
        luA = nil
        feuille = nil
    }
}

// MARK: - Routes

private struct RetourRegleTri: Decodable {
    var ids: [String]
    enum CodingKeys: String, CodingKey { case regles }
    private struct Creee: Decodable { var id: String }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let r = try? c.decode([Creee].self, forKey: .regles) { ids = r.map(\.id) }
        else { ids = (try? c.decode([String].self, forKey: .regles)) ?? [] }
    }
}

extension ClientAPI {
    public func aTrancher() async throws -> VueATrancher {
        try await json(VueATrancher.self, "api/a-trancher", delai: 30)
    }

    public func reporterTri(_ cle: String, jours: Int = 7) async throws {
        try await brut("api/a-trancher/reports", methode: "POST",
                       corps: JSONSerialization.data(withJSONObject: ["cle": cle, "jours": jours]))
    }

    public func annulerReportTri(_ cle: String) async throws {
        try await brut("api/a-trancher/reports/\(chemin(cle))", methode: "DELETE", corps: nil)
    }

    public func rouvrirCarte(_ propositionId: String) async throws {
        try await brut("api/a-trancher/rouvrir", methode: "POST",
                       corps: JSONSerialization.data(withJSONObject: ["propositionId": propositionId]))
    }

    /// Valide une règle proposée et rend les règles créées (pour « Annuler »).
    public func validerRegleTri(convId: String, propositionId: String) async throws -> [String] {
        let pid = chemin(propositionId)
        return try await json(RetourRegleTri.self, "api/conversations/\(chemin(convId))/propositions/\(pid)/regle", methode: "POST", corps: [:]).ids
    }

    public func revue() async throws -> VueRevue {
        try await json(VueRevue.self, "api/revue", delai: 30)
    }

    public func ecrireDecisions(_ liste: [String]) async throws -> VueRevue.Decisions {
        try await json(VueRevue.Decisions.self, "api/revue/decisions", methode: "PUT", corps: ["decisions": liste])
    }
}
