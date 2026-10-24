import AppIntents
import WidgetKit
import SwiftUI

// Le contrôle « Capturer » (iOS 18, 24/10) : Centre de contrôle, écran
// verrouillé ou bouton Action. Il ouvre l'app sur la capture
// (OuvrirCaptureIntent, exécutée dans l'app).

@available(iOS 18.0, *)
struct ControleCapture: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "remy.controle.capture") {
            ControlWidgetButton(action: OuvrirCaptureIntent()) {
                Label("Capturer", systemImage: "plus.circle")
            }
        }
        .displayName("Capturer avec Rémy")
        .description("Ouvre la capture de Rémy : une idée, une tâche, un rappel.")
    }
}
