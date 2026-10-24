import SwiftUI
import UIKit
import UniformTypeIdentifiers
import RemyCore

/// CI seulement (REMY_DEMO_ECRAN=partage-…) : la feuille de partage montrée
/// dans l'app, contre la tour de démo. L'extension ne se lance pas en ligne de
/// commande dans le simulateur ; ici, le vrai chemin tourne quand même : les
/// pièces jointes passent par LecturePartage (texte lu par Vision compris), et
/// l'envoi part à la vraie route.
struct DemoPartageVue: View {
    @Environment(AppModel.self) private var app
    let ecran: String
    @State private var modele: ModelePartage?

    var body: some View {
        Group {
            if let modele {
                FeuillePartage(modele: modele)
            } else {
                Teinte.fond.ignoresSafeArea()
            }
        }
        .task { await preparer() }
    }

    @MainActor
    private func preparer() async {
        guard modele == nil else { return }
        // Le trousseau de l'extension, ici en mémoire : l'adresse et le jeton de
        // la session de démo (port 9 fermé pour la tour injoignable).
        var jeton = app.api.coffre.lire()
        if jeton == nil, let mdp = ProcessInfo.processInfo.environment["REMY_DEMO_MDP"] {
            // Trousseau du simulateur indisponible : un jeton à part, en mémoire.
            let c = ClientAPI(base: app.api.base, session: URLSession(configuration: .ephemeral), coffre: CoffreMemoire())
            try? await c.connexion(motDePasse: mdp, appareil: "Démo partage")
            jeton = c.coffre.lire()
        }
        let base = ecran == "partage-erreur" ? "http://127.0.0.1:9" : app.api.base.absoluteString
        let lu = jeton
        let trousseau = TrousseauPartage(adresse: CoffreMemoire(base), jeton: { _ in CoffreMemoire(lu) })
        let m = ModelePartage(trousseau: trousseau, terminer: {}, annuler: {})
        modele = m
        switch ecran {
        case "partage-lien":
            // Comme Safari : l'URL, la même en texte, et le titre de la page.
            let element = NSExtensionItem()
            element.attributedTitle = NSAttributedString(string: "Bougies artisanales : bien choisir sa cire")
            element.attachments = [
                NSItemProvider(item: URL(string: "https://exemple.org/bougies/cire")! as NSURL, typeIdentifier: UTType.url.identifier),
                NSItemProvider(item: "https://exemple.org/bougies/cire" as NSString, typeIdentifier: UTType.plainText.identifier),
            ]
            await m.charger([element])
            m.mot = "À lire avant de commander la cire pour Léa"
        case "partage-image", "partage-recu":
            // L'aperçu (texte lu par Vision), puis le reçu de la vraie route.
            let element = NSExtensionItem()
            if let png = Self.imageEssai() {
                element.attachments = [NSItemProvider(item: png as NSData, typeIdentifier: UTType.png.identifier)]
            }
            await m.charger([element])
            m.mot = "À noter"
            if ecran == "partage-recu" { await m.envoyer() }
        default:
            let element = NSExtensionItem()
            element.attachments = [
                NSItemProvider(item: "Penser à commander les mèches en coton pour l'atelier de Léa avant vendredi." as NSString,
                               typeIdentifier: UTType.plainText.identifier),
            ]
            await m.charger([element])
            await m.envoyer()
        }
    }

    /// Une fausse capture d'écran, avec du texte à lire.
    @MainActor
    static func imageEssai() -> Data? {
        let vue = VStack(alignment: .leading, spacing: 14) {
            Text("Atelier bougies").font(.system(size: 40, weight: .bold))
            Text("Jeudi 18 h chez Hugo").font(.system(size: 30))
            Text("Apporter 2 kg de cire de soja").font(.system(size: 30))
        }
        .foregroundStyle(Color.black)
        .padding(48)
        .frame(width: 720, height: 420, alignment: .topLeading)
        .background(Color.white)
        let rendu = ImageRenderer(content: vue)
        rendu.scale = 2
        return rendu.uiImage?.pngData()
    }
}
