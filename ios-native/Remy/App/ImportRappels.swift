import Foundation
import EventKit
import Observation
import RemyCore

/// Reprendre les rappels de l'iPhone dans Remy, en un geste et avec ta
/// permission : lus ici, envoyés à ta tour, nulle part ailleurs. Rien n'est
/// effacé côté Apple. Les rappels datés deviennent des rappels ; les autres,
/// des articles d'une liste du même nom (« Courses »…). Relancer l'import ne
/// double rien (identifiants « apple:… »).
@MainActor
@Observable
final class ImportRappels {
    var enCours = false

    func lancer(_ app: AppModel) async {
        guard !enCours else { return }
        guard app.carnet.disponible else {
            app.dire("L'import des rappels arrivera avec la mise à jour de ta tour.")
            return
        }
        enCours = true
        defer { enCours = false }
        let magasin = EKEventStore()
        let accord: Bool
        do {
            accord = try await magasin.requestFullAccessToReminders()
        } catch {
            app.dire("Impossible de lire tes rappels : \(error.localizedDescription)")
            return
        }
        guard accord else {
            app.dire("Sans accès à tes rappels, Rémy ne peut rien importer. Réglages iPhone → Rémy → Rappels pour l'autoriser.")
            return
        }
        let predicat = magasin.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        let lus: [Lu] = await withCheckedContinuation { suite in
            magasin.fetchReminders(matching: predicat) { rappels in
                suite.resume(returning: (rappels ?? []).map(Lu.init))
            }
        }
        var dates: [Rappel] = []
        var listes: [String: Liste] = [:]
        for r in lus where !r.titre.isEmpty {
            if let q = r.quand {
                dates.append(Rappel(id: "apple:" + r.id, texte: r.titre, quand: q.millis, source: "apple"))
            } else {
                let cle = "apple-liste:" + r.liste
                listes[cle, default: Liste(id: cle, nom: r.nomListe)].elements.append(ElementListe(id: "apple:" + r.id, texte: r.titre))
            }
        }
        guard !dates.isEmpty || !listes.isEmpty else {
            app.dire("Aucun rappel en cours dans l'app Rappels.")
            return
        }
        app.carnet.importer(dates, listes: Array(listes.values).sorted { $0.nom < $1.nom })
        let articles = listes.values.reduce(0) { $0 + $1.elements.count }
        app.dire("Importés : \(dates.count) rappel\(dates.count > 1 ? "s" : "") daté\(dates.count > 1 ? "s" : "") et \(articles) article\(articles > 1 ? "s" : "") dans \(listes.count) liste\(listes.count > 1 ? "s" : ""). Rien n'a été effacé chez Apple.")
        if !dates.isEmpty { await Notifications.demander() }
    }

    /// Un rappel Apple, copié tel quel hors du fil de lecture d'EventKit.
    private struct Lu: Sendable {
        let id: String
        let titre: String
        let quand: Date?
        let liste: String
        let nomListe: String

        init(_ r: EKReminder) {
            id = r.calendarItemIdentifier
            titre = (r.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if var c = r.dueDateComponents {
                if c.hour == nil { c.hour = 9; c.minute = 0 }
                quand = Calendar.current.date(from: c)
            } else {
                quand = nil
            }
            liste = r.calendar?.calendarIdentifier ?? "rappels"
            nomListe = r.calendar?.title ?? "Rappels"
        }
    }
}
