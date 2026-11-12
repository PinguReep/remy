import Foundation

// « Bloquée par » (taches-dependances-v1, 12/11) : une tâche qui attend
// qu'une autre soit finie (« faire réparer la voiture au garage », PUIS « la
// porter chez le carrossier »).
//
// L'API publique de Motion n'expose pas ses « blockers » : le lien vit sur la
// tour, et Motion continue de planifier la tâche bloquée. La tour la marque
// `bloquee` (ce que toute l'app sait déjà écarter : elle n'est jamais
// proposée), avec `bloqueePar` ; la bloquante porte `debloque`. Elle se
// débloque seule quand ce qu'elle attend est terminé (ici ou dans Motion).
//
// La logique sans écran vit ici (testée par XCTest) ; le site a la même
// (public/app/analyse/dependances.js).

/// Une tâche citée par un lien : son identifiant Motion et son nom (le
/// dernier connu de la tour ; absent si elle ne l'a jamais su).
public struct LienTache: Codable, Sendable, Equatable, Identifiable, Hashable {
    public var id: String
    public var nom: String?
    public init(id: String, nom: String? = nil) {
        self.id = id
        self.nom = nom
    }
    /// Un projet Motion (« motion:<id> ») ou un dossier (« dossier:<id> ») : projets-bloques-v1.
    public var estNoeud: Bool { id.hasPrefix("motion:") || id.hasPrefix("dossier:") }
    public var libelle: String { (nom?.isEmpty == false ? nom : nil) ?? (estNoeud ? "un autre projet" : "une autre tâche") }
}

/// Le projet (ou le dossier parent) d'une tâche qui attend autre chose
/// (projets-bloques-v1) : toutes ses tâches attendent avec lui.
public struct ProjetBloque: Codable, Sendable, Equatable, Hashable {
    public var id: String
    public var nom: String?
    public var par: [LienTache]
    public init(id: String, nom: String? = nil, par: [LienTache] = []) {
        self.id = id
        self.nom = nom
        self.par = par
    }
}

/// Un lien « après » qu'une proposition validée n'a pas pu poser.
public struct LienRate: Codable, Sendable, Equatable {
    public var ref: String?
    public var id: String?
    public var nom: String?
    public var erreur: String?
}

/// Un lien actif : `tache` attend que `bloquante` soit finie.
public struct LienDependance: Codable, Sendable, Equatable {
    public var tache: LienTache
    public var bloquante: LienTache
    public var depuis: Millis?
}

/// Une tâche ouverte parmi lesquelles choisir (la liste Motion de la tour).
public struct TacheAChoisir: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var titre: String
    public var projet: String?
    public var echeance: Millis?
    /// projets-bloques-v1 : « projet » ou « dossier » pour un nœud (nil : une tâche),
    /// et ce qui le contient (son projet, ses dossiers parents).
    public var genre: String?
    public var dans: [String]?
    public init(id: String, titre: String, projet: String? = nil, echeance: Millis? = nil, genre: String? = nil, dans: [String]? = nil) {
        self.id = id
        self.titre = titre
        self.projet = projet
        self.echeance = echeance
        self.genre = genre
        self.dans = dans
    }
}

/// GET /api/dependances.
public struct ReponseDependances: Codable, Sendable {
    public var liens: [LienDependance]
    public var taches: [TacheAChoisir]
    public var motion: EtatMotion?
    /// Les projets et dossiers (projets-bloques-v1) ; absent d'une tour d'avant.
    public var noeuds: [TacheAChoisir]?
}

struct ReponseEtatTache: Codable {
    var bloqueePar: [LienTache]?
    var debloquees: [LienTache]?
}

public enum Dependances {
    /// « Réparer la Voiture » et « reparer la voiture » : la même recherche.
    public static func cle(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "fr_FR"))
            .lowercased()
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
    }

    /// Les tâches qu'on peut choisir comme bloquantes de `tache` : pas
    /// elle-même, pas celles déjà choisies, pas celles qui l'attendent (même
    /// de loin : la tour refuserait la boucle). Tous les mots de `recherche`
    /// doivent être dans le titre ou le projet. Les échéances proches d'abord.
    public static func candidats(_ taches: [TacheAChoisir], tache: String, deja: [String] = [],
                                 liens: [LienDependance] = [], recherche: String = "", max: Int = 40) -> [TacheAChoisir] {
        var exclues = Set([tache] + deja)
        // Ce qui contient la cible, et ce qu'elle contient : la tour refuserait (projets-bloques-v1).
        for c in taches.first(where: { $0.id == tache })?.dans ?? [] { exclues.insert(c) }
        for t in taches where (t.dans ?? []).contains(tache) { exclues.insert(t.id) }
        var attendent: [String: [String]] = [:]
        for l in liens { attendent[l.bloquante.id, default: []].append(l.tache.id) }
        var pile = [tache]
        while let x = pile.popLast() {
            for t in attendent[x] ?? [] where !exclues.contains(t) {
                exclues.insert(t)
                pile.append(t)
            }
        }
        let mots = cle(recherche).split(separator: " ").map(String.init)
        return taches
            .filter { !exclues.contains($0.id) }
            .filter { t in
                guard !mots.isEmpty else { return true }
                let texte = cle(t.titre + " " + (t.projet ?? ""))
                return mots.allSatisfy { texte.contains($0) }
            }
            .sorted { a, b in
                let ea = a.echeance ?? .infinity
                let eb = b.echeance ?? .infinity
                if ea != eb { return ea < eb }
                return a.titre.localizedCompare(b.titre) == .orderedAscending
            }
            .prefix(max)
            .map { $0 }
    }

    /// Ce que dit la liste quand elle est vide.
    public static func phraseVide(total: Int, recherche: String) -> String {
        if total == 0 { return "Aucune autre tâche ouverte dans Motion : rien ne peut la bloquer pour l'instant." }
        let r = recherche.trimmingCharacters(in: .whitespaces)
        return r.isEmpty ? "Toutes les autres tâches l'attendent déjà, ou la bloquent déjà." : "Aucune tâche ne correspond à « \(r) »."
    }

    /// La marque d'une ligne : « Bloquée par « X » » (+N), sinon son projet
    /// qui attend, sinon l'ancien « En attente · raison ».
    public static func marque(raison: String?, par: [LienTache]?, projet: ProjetBloque? = nil) -> String {
        if let p = par, let premier = p.first {
            return "Bloquée par « \(premier.libelle) »" + (p.count > 1 ? " (+\(p.count - 1))" : "")
        }
        if let pr = projet, let premier = pr.par.first {
            return "Projet « \(pr.nom ?? "son projet") » bloqué par « \(premier.libelle) »" + (pr.par.count > 1 ? " (+\(pr.par.count - 1))" : "")
        }
        if let r = raison, !r.isEmpty { return "En attente · \(r)" }
        return "En attente"
    }

    /// Sur la bloquante : « Débloque « Y » » (+N), ou nil.
    public static func marqueDebloque(_ d: [LienTache]?) -> String? {
        guard let d, let premier = d.first else { return nil }
        return "Débloque « \(premier.libelle) »" + (d.count > 1 ? " (+\(d.count - 1))" : "")
    }

    /// « Reprendre » ne vaut que pour l'attente posée à la main (le bon de
    /// commande), jamais pour un lien : il se retire dans « Bloquée par… ».
    public static func attenteManuelle(bloquee: Bool?, par: [LienTache]?, attente: Bool?, projet: ProjetBloque? = nil) -> Bool {
        guard bloquee == true else { return false }
        return ((par ?? []).isEmpty && projet == nil) || attente == true
    }

    /// La marque d'un projet ou d'un dossier qui attend (lui, ou son parent), ou nil.
    public static func marqueNoeud(bloquePar: [LienTache]?, parentBloque: ProjetBloque?) -> String? {
        if let p = bloquePar, let premier = p.first {
            return "Bloqué par « \(premier.libelle) »" + (p.count > 1 ? " (+\(p.count - 1))" : "")
        }
        if let pb = parentBloque, let premier = pb.par.first { return "« \(pb.nom ?? "Son projet") » attend « \(premier.libelle) »" }
        return nil
    }

    /// Les mots de « Bloquée par… » : pour une tâche (au féminin), ou pour un
    /// projet ou un dossier (projets-bloques-v1), dont les tâches attendent avec lui.
    public struct Textes: Sendable, Equatable {
        public let titre: String
        public let rien: String
        public let choisir: String
        public let ajouter: String
        public let plusRien: String
        public let note: String
        let noeud: Bool
        public func attend(_ titre: String, _ nom: String) -> String {
            noeud ? "« \(titre) » attend « \(nom) » : aucune de ses tâches ne te sera proposée avant."
                : "« \(titre) » attend « \(nom) » : Rémy ne te la proposera pas avant."
        }
    }

    public static func textes(noeud: Bool) -> Textes {
        noeud
            ? Textes(titre: "Bloqué par…", rien: "Il n'attend rien.", choisir: "Choisir ce qu'il attend…", ajouter: "Ajouter autre chose…",
                     plusRien: "n'attend plus rien",
                     note: "Il se débloque seul quand ce qu'il attend est fini : une tâche terminée, ou un projet dont toutes les tâches sont terminées (ou que tu dis fini). Motion ne connaît pas ce lien : il peut planifier ses tâches quand même, Rémy ne te les proposera pas avant.",
                     noeud: true)
            : Textes(titre: "Bloquée par…", rien: "Elle n'attend aucune autre tâche.", choisir: "Choisir la tâche qu'elle attend…", ajouter: "Ajouter une autre tâche…",
                     plusRien: "n'attend plus aucune tâche",
                     note: "Elle se débloque seule quand celle qu'elle attend est terminée. Motion ne connaît pas ce lien : il peut la planifier quand même, Rémy ne te la proposera pas avant.",
                     noeud: false)
    }

    /// Ce que dit la ligne d'un choix : la tâche (projet, échéance), ou le nœud.
    public static func detailChoix(_ t: TacheAChoisir) -> String {
        if t.genre == "projet" { return "Projet Motion, fini quand toutes ses tâches le sont" }
        if t.genre == "dossier" { return "Dossier de Rémy" }
        var bits: [String] = []
        if let p = t.projet, !p.isEmpty { bits.append(p) }
        if let e = t.echeance { bits.append("échéance " + Format.jourCourt(e.date)) }
        return bits.isEmpty ? "Sans échéance" : bits.joined(separator: " · ")
    }

    /// Quand un projet est « fini » pour Rémy : dit à l'écran.
    public static func regleFini(_ nom: String) -> String {
        "« \(nom) » est fini pour Rémy quand toutes ses tâches sont terminées (dans la liste Motion lue en entier, après lui en avoir vu), ou quand tu le dis."
    }

    /// Après la fin d'une bloquante : « « Y » est débloquée : elle peut commencer. »
    public static func phraseDebloquees(_ d: [LienTache]?) -> String? {
        guard let d, !d.isEmpty else { return nil }
        let noms = d.compactMap { $0.nom?.isEmpty == false ? $0.nom : nil }
        if noms.isEmpty { return d.count > 1 ? "\(d.count) tâches débloquées : elles peuvent commencer." : "Une tâche est débloquée : elle peut commencer." }
        if noms.count == 1 {
            let noeud = d.first(where: { $0.nom == noms[0] })?.estNoeud == true
            return noeud ? "« \(noms[0]) » est débloqué : ses tâches peuvent commencer." : "« \(noms[0]) » est débloquée : elle peut commencer."
        }
        return "« \(noms[0]) » et " + (noms.count == 2 ? "« \(noms[1]) »" : "\(noms.count - 1) autres") + " sont débloquées."
    }

    /// Ce qu'une proposition validée a fait des liens « après », ou nil.
    public static func phraseLiens(_ r: ResultatApplication) -> String? {
        let res = r.results ?? []
        var out: [String] = []
        let lies = res.filter { $0.ok == true && !($0.bloqueePar ?? []).isEmpty }
        if lies.count == 1, let l = lies.first {
            out.append("« \(l.nom ?? "La tâche") » attendra « " + (l.bloqueePar ?? []).map(\.libelle).joined(separator: " » et « ") + " ».")
        } else if lies.count > 1 {
            out.append("\(lies.count) tâches attendront leur étape précédente.")
        }
        let rates = res.flatMap { $0.liensRates ?? [] }
        if rates.count == 1 { out.append("Un lien « après » n'a pas été posé (son étape n'a pas été créée).") }
        else if rates.count > 1 { out.append("\(rates.count) liens « après » n'ont pas été posés.") }
        if let d = phraseDebloquees(res.flatMap { $0.debloquees ?? [] }) { out.append(d) }
        return out.isEmpty ? nil : out.joined(separator: " ")
    }
}

extension ClientAPI {
    /// Les liens et les tâches ouvertes à choisir (la liste Motion de la tour, aucune requête Motion de plus).
    public func dependances() async throws -> ReponseDependances {
        try await json(ReponseDependances.self, "api/dependances", delai: 15)
    }

    /// « C'est fini » sur un projet ou un dossier (projets-bloques-v1), ou
    /// false pour le rouvrir. Rend ce qui est débloqué.
    public func finirNoeud(_ id: String, fait: Bool) async throws -> [LienTache] {
        try await json(ReponseEtatTache.self, "api/taches/\(chemin(id))/etat", methode: "PUT", corps: ["fait": fait]).debloquees ?? []
    }

    /// Remplace les bloquantes de `id` ([] : plus aucune). Rend la liste gardée.
    public func poserBloquantes(_ id: String, _ ids: [String]) async throws -> [LienTache] {
        try await json(ReponseEtatTache.self, "api/taches/\(chemin(id))/etat", methode: "PUT", corps: ["bloqueePar": ids]).bloqueePar ?? []
    }
}

extension TableauModel {
    /// « Bloquée par… » : enregistre la liste complète, la dit (avec
    /// « Annuler »), puis relit la journée (la liste Motion en cache : aucune
    /// requête Motion). Rend la liste gardée, ou nil si la tour a refusé.
    @discardableResult
    public func poserBloquantes(id: String, titre: String, liste: [LienTache], avant: [LienTache], phrase: String) async -> [LienTache]? {
        do {
            let gardee = try await api.poserBloquantes(id, liste.map(\.id))
            app?.dire(phrase, annuler: { [weak self] in
                Task { await self?.poserBloquantes(id: id, titre: titre, liste: avant, avant: gardee, phrase: "« \(titre) » : remise comme avant.") }
            })
            await charger()
            if LienTache(id: id).estNoeud { await rechargerProjets() }
            return gardee
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return nil }
            app?.dire("« \(titre) » : \((error as? LocalizedError)?.errorDescription ?? "erreur").")
            return nil
        }
    }
}

extension TableauModel {
    /// Projets et dossiers relus après un changement de « bloqué par » ou de « fini ».
    func rechargerProjets() async {
        await app?.organisation.charger()
        await app?.projets.charger()
    }

    /// « C'est fini » (ou « Pas fini, finalement ») sur un projet ou un
    /// dossier : dit, avec « Annuler » ; ce qu'il retenait se débloque.
    @discardableResult
    public func finirNoeud(id: String, titre: String, fait: Bool) async -> Bool {
        do {
            let libres = try await api.finirNoeud(id, fait: fait)
            let phrase = fait
                ? "« \(titre) » : fini." + (Dependances.phraseDebloquees(libres).map { " " + $0 } ?? "")
                : "« \(titre) » n'est plus fini : ce qu'il retenait attend de nouveau."
            app?.dire(phrase, annuler: { [weak self] in
                Task { await self?.finirNoeud(id: id, titre: titre, fait: !fait) }
            })
            await charger()
            await rechargerProjets()
            return true
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            app?.dire("« \(titre) » n'a pas pu être marqué : \((error as? LocalizedError)?.errorDescription ?? "erreur").")
            return false
        }
    }
}
