import AppIntents
import Foundation
import RemyCore

// Siri, Raccourcis et le bouton Action (24/10). Les intentions tournent dans
// le processus de l'app, sans l'ouvrir (sauf « Capturer ») : elles passent par
// le modèle de l'app (`Raccourcis.app`, posé au lancement). Rien ne part
// ailleurs que vers la tour ; aucun appel IA de plus qu'avec le « + ».

/// Un texte calculé (pas une clé de traduction) dit par Siri.
private func dialogue(_ texte: String) -> IntentDialog {
    IntentDialog(LocalizedStringResource(stringLiteral: texte))
}

/// « Noter dans Rémy » : la note part à la tour (source « siri »), qui
/// répond tout de suite et l'absorbe ensuite (un appel au modèle, comme
/// « Retenir », journalisé « capture »).
struct NoterDansRemyIntent: AppIntent {
    static let title: LocalizedStringResource = "Noter dans Rémy"

    @Parameter(title: "Note", requestValueDialog: IntentDialog("Que veux-tu noter ?"))
    var texte: String

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let t = texte.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count >= 3 else {
            return .result(dialog: dialogue("Rien de noté : dis-en un peu plus."))
        }
        guard let app = Raccourcis.app else {
            return .result(dialog: dialogue(ErreurPartage.nonConnecte.errorDescription ?? ""))
        }
        // Tour pas encore à jour (sans capture-siri-v1) : elle veut 30 caractères.
        if app.serveur != nil, app.serveur?.sait("capture-siri-v1") != true, t.count < 30 {
            return .result(dialog: dialogue("Ta tour n'est pas à jour : elle veut au moins 30 caractères. Rien de noté."))
        }
        do {
            _ = try await app.api.capturer(t, source: "siri", differe: true)
            return .result(dialog: dialogue("Noté : « \(t) »"))
        } catch {
            return .result(dialog: dialogue("Rien de noté. " + Raccourcis.phrase(error)))
        }
    }
}

/// « Que dois-je faire maintenant ? » : la tâche en cours, ou la suivante.
/// Tour injoignable : la dernière journée gardée sur l'iPhone, datée.
struct QueFaireMaintenantIntent: AppIntent {
    static let title: LocalizedStringResource = "Que faire maintenant"

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let app = Raccourcis.app else {
            return .result(dialog: dialogue(ApercuMaintenant(genre: .nonConnecte).phrase()))
        }
        let maintenant = Date()
        do {
            let d = try await app.api.tableauDeBord()
            return .result(dialog: dialogue(ApercuMaintenant.pour(d.journee, maintenant: maintenant).phrase(maintenant: maintenant)))
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte {
                return .result(dialog: dialogue(Raccourcis.phrase(e)))
            }
            // La copie de l'iPhone (lancée en arrière-plan, l'app ne l'a pas encore relue).
            if app.tableau.donnees == nil { app.tableau.restaurer() }
            guard let j = app.tableau.donnees?.journee else {
                return .result(dialog: dialogue(Raccourcis.phrase(error)))
            }
            let a = ApercuMaintenant.pour(j, maintenant: maintenant, copieDu: app.tableau.misAJour ?? maintenant)
            return .result(dialog: dialogue(a.phrase(maintenant: maintenant)))
        }
    }
}

/// Les phrases de Siri, et ce que propose l'app Raccourcis (bouton Action :
/// Réglages › Bouton Action › Raccourci › Rémy › « Capturer avec Rémy »).
struct RaccourcisRemy: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: NoterDansRemyIntent(),
                    phrases: ["Noter dans \(.applicationName)",
                              "Note dans \(.applicationName)",
                              "Ajoute une note dans \(.applicationName)"],
                    shortTitle: "Noter",
                    systemImageName: "square.and.pencil")
        AppShortcut(intent: OuvrirCaptureIntent(),
                    phrases: ["Capturer avec \(.applicationName)",
                              "Ouvre la capture de \(.applicationName)"],
                    shortTitle: "Capturer",
                    systemImageName: "plus.circle")
        AppShortcut(intent: QueFaireMaintenantIntent(),
                    phrases: ["Que dois-je faire maintenant avec \(.applicationName)",
                              "Qu'est-ce que je fais maintenant dans \(.applicationName)",
                              "Ma tâche du moment dans \(.applicationName)"],
                    shortTitle: "Maintenant",
                    systemImageName: "clock")
    }
}
