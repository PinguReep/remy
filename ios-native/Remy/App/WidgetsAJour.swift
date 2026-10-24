import Foundation
import WidgetKit
import RemyCore

// Le widget « Maintenant » relit la tour seul, toutes les ~15 min (24/10).
// L'app ouverte le prévient quand ce qu'il montre change (commencée, cochée,
// prolongée) : ces rechargements, l'app au premier plan, ne comptent pas dans
// le budget d'iOS. Rien en arrière-plan, aucun appel IA.

@MainActor
enum WidgetsAJour {
    /// Le genre du widget « Maintenant » (WidgetMaintenant, extension).
    static let maintenant = "remy.maintenant"

    private static var dernier: ApercuMaintenant?
    private static var attente: Task<Void, Never>?

    /// La journée de l'app a changé : « Maintenant » se relit si son aperçu
    /// bouge. Quelques secondes d'attente : le temps que le geste parte (une
    /// coche part après son délai d'annulation) et qu'une rafale se calme.
    static func journee(_ j: Journee?) {
        guard let j else { return }
        let a = ApercuMaintenant.pour(j, maintenant: Date())
        guard a != dernier else { return }
        dernier = a
        attente?.cancel()
        attente = Task {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard !Task.isCancelled else { return }
            WidgetCenter.shared.reloadTimelines(ofKind: maintenant)
        }
    }

    /// Connexion ou déconnexion : tous les widgets se relisent (« Pas connecté »).
    static func tout() {
        dernier = nil
        attente?.cancel()
        WidgetCenter.shared.reloadAllTimelines()
    }
}
