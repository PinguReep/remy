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
    public var libelle: String { (nom?.isEmpty == false ? nom : nil) ?? "une autre tâche" }
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
    public init(id: String, titre: String, projet: String? = nil, echeance: Millis? = nil) {
        self.id = id
        self.titre = titre
        self.projet = projet
        self.echeance = echeance
    }
}

/// GET /api/dependances.
public struct ReponseDependances: Codable, Sendable {
    public var liens: [LienDependance]
    public var taches: [TacheAChoisir]
    public var motion: EtatMotion?
}

struct ReponseEtatTache: Codable { var bloqueePar: [LienTache]? }

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

    /// La marque d'une ligne : « Bloquée par « X » » (+N), sinon l'ancien
    /// « En attente · raison ».
    public static func marque(raison: String?, par: [LienTache]?) -> String {
        if let p = par, let premier = p.first {
            return "Bloquée par « \(premier.libelle) »" + (p.count > 1 ? " (+\(p.count - 1))" : "")
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
    public static func attenteManuelle(bloquee: Bool?, par: [LienTache]?, attente: Bool?) -> Bool {
        guard bloquee == true else { return false }
        return (par ?? []).isEmpty || attente == true
    }

    /// Après la fin d'une bloquante : « « Y » est débloquée : elle peut commencer. »
    public static func phraseDebloquees(_ d: [LienTache]?) -> String? {
        guard let d, !d.isEmpty else { return nil }
        let noms = d.compactMap { $0.nom?.isEmpty == false ? $0.nom : nil }
        if noms.isEmpty { return d.count > 1 ? "\(d.count) tâches débloquées : elles peuvent commencer." : "Une tâche est débloquée : elle peut commencer." }
        if noms.count == 1 { return "« \(noms[0]) » est débloquée : elle peut commencer." }
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
            return gardee
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return nil }
            app?.dire("« \(titre) » : \((error as? LocalizedError)?.errorDescription ?? "erreur").")
            return nil
        }
    }
}
