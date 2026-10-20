import SwiftUI
import UIKit

/// Sélectionner une partie d'un message (Sam, 19/10) : un appui long sur une
/// bulle ne permettait que « Copier » (tout le texte), et l'erreur ne se
/// copiait pas du tout. « Sélectionner le texte » ouvre le message dans un
/// champ en lecture seule : la vraie sélection d'iOS (poignées, loupe,
/// Copier, Partager, Rechercher), sur le passage voulu.
struct TexteASelectionner: Identifiable {
    let id = UUID()
    let texte: String
}

struct SelectionTexteVue: View {
    let texte: String
    @Environment(\.dismiss) private var fermer

    var body: some View {
        NavigationStack {
            TexteSelectionnable(texte: texte)
                .background(Palette.fond)
                .navigationTitle("Sélectionner")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Tout copier") {
                            UIPasteboard.general.string = texte
                            Haptique.succes()
                            fermer()
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("OK") { fermer() }
                    }
                }
        }
        .presentationDetents([.medium, .large])
    }
}

/// UITextView en lecture seule : sélectionnable, jamais modifiable.
struct TexteSelectionnable: UIViewRepresentable {
    let texte: String

    func makeUIView(context: Context) -> UITextView {
        let v = UITextView()
        v.isEditable = false
        v.isSelectable = true
        v.backgroundColor = .clear
        v.alwaysBounceVertical = true
        v.textContainerInset = UIEdgeInsets(top: 16, left: 14, bottom: 32, right: 14)
        v.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(name: "Inter-Regular", size: 17) ?? .systemFont(ofSize: 17))
        v.adjustsFontForContentSizeCategory = true
        v.textColor = UIColor(Palette.encre)
        v.dataDetectorTypes = [.link]
        v.text = texte
        return v
    }

    func updateUIView(_ v: UITextView, context: Context) {
        if v.text != texte { v.text = texte }
    }
}

/// Les deux actions de l'appui long d'une bulle : tout copier, ou choisir.
struct ActionsTexte: View {
    let texte: String
    @Binding var aSelectionner: TexteASelectionner?

    var body: some View {
        Button {
            UIPasteboard.general.string = texte
            Haptique.leger()
        } label: {
            Label("Copier", systemImage: "doc.on.doc")
        }
        Button {
            aSelectionner = TexteASelectionner(texte: texte)
        } label: {
            Label("Sélectionner le texte", systemImage: "text.cursor")
        }
    }
}
