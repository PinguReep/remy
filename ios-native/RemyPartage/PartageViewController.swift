import UIKit
import SwiftUI
import RemyCore

// La feuille de partage de Rémy (24/10) : depuis n'importe quelle app, un
// texte, un lien ou une image part à la tour (trousseau partagé, lecture
// seule : adresse et jeton rangés par l'app). Le contenu de la feuille est en
// SwiftUI (FeuillePartage) ; ce contrôleur ne fait que l'héberger et rendre la
// main à l'app d'origine.

final class PartageViewController: UIViewController {
    private lazy var modele = ModelePartage(
        terminer: { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        },
        annuler: { [weak self] in
            self?.extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
        }
    )

    override func viewDidLoad() {
        super.viewDidLoad()
        let hote = UIHostingController(rootView: FeuillePartage(modele: modele))
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

        let elements = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let modele = self.modele
        Task { await modele.charger(elements) }
    }
}
