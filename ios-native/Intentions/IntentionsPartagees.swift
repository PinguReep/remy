import AppIntents
import Foundation
import RemyCore

// Les intentions que l'app ET les widgets connaissent (24/10) : les boutons de
// l'activité en direct et le contrôle « Capturer » les référencent depuis
// l'extension, mais iOS les exécute dans le processus de l'app (activité en
// direct, ouverture de l'app). L'app s'y branche par `Raccourcis` (RemyCore) ;
// dans l'extension, tout y est nil et rien ne s'exécute.

/// « Terminer » sur l'activité en direct : le même geste que dans l'app
/// (coche optimiste, file d'envoi, annulable depuis l'historique).
struct TerminerTacheIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Terminer la tâche"
    static let isDiscoverable = false

    @Parameter(title: "Tâche")
    var id: String

    @Parameter(title: "Titre")
    var titre: String

    init() {}

    init(id: String, titre: String) {
        self.id = id
        self.titre = titre
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        await Raccourcis.terminer?(id, titre)
        return .result()
    }
}

/// « +15 min » sur l'activité en direct : la prolongation de « Gérer ».
struct ProlongerTacheIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Prolonger la tâche"
    static let isDiscoverable = false

    @Parameter(title: "Tâche")
    var id: String

    @Parameter(title: "Minutes")
    var minutes: Int

    init() {}

    init(id: String, minutes: Int) {
        self.id = id
        self.minutes = minutes
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        await Raccourcis.prolonger?(id, minutes)
        return .result()
    }
}

/// « Capturer avec Rémy » : ouvre l'app sur la capture (bouton Action,
/// Centre de contrôle, Siri).
struct OuvrirCaptureIntent: AppIntent {
    static let title: LocalizedStringResource = "Capturer avec Rémy"
    static let openAppWhenRun = true

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        Raccourcis.app?.lien = .capture
        return .result()
    }
}
