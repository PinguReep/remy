import UIKit
import SwiftUI
import RemyCore

// La feuille de partage de Rémy (24/10). Pour l'instant « Bientôt » : elle dit
// seulement si l'iPhone sait parler à la tour (trousseau partagé, lecture
// seule) et se ferme proprement. Rien n'est envoyé.

final class PartageViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let etat: String
        do {
            _ = try TrousseauPartage.systeme.client()
            etat = "Ta tour est connue : le partage vers Rémy arrive dans une prochaine version."
        } catch {
            etat = (error as? LocalizedError)?.errorDescription ?? "Ouvre Rémy une fois pour te connecter."
        }
        let hote = UIHostingController(rootView: BientotVue(etat: etat) { [weak self] in self?.fermer() })
        addChild(hote)
        hote.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hote.view)
        NSLayoutConstraint.activate([
            hote.view.topAnchor.constraint(equalTo: view.topAnchor),
            hote.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hote.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hote.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        hote.didMove(toParent: self)
    }

    /// Rend la main à l'app d'origine, sans rien renvoyer.
    private func fermer() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}

struct BientotVue: View {
    let etat: String
    let fermer: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Rémy")
                    .font(.system(size: 22, weight: .bold, design: .serif))
                    .foregroundStyle(Teinte.encre)
                Spacer()
                Button(action: fermer) {
                    Text("Fermer")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Teinte.encre)
                        .padding(.horizontal, 12)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Text("Bientôt")
                .font(.system(size: 28, weight: .bold, design: .serif))
                .foregroundStyle(Teinte.encre)
            Text("Envoyer à Rémy un texte, un lien ou une photo depuis n'importe quelle app.")
                .font(.system(size: 16))
                .foregroundStyle(Teinte.encre)
                .fixedSize(horizontal: false, vertical: true)
            Text(etat)
                .font(.system(size: 15))
                .foregroundStyle(Teinte.encre2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Teinte.fond.ignoresSafeArea())
    }
}
