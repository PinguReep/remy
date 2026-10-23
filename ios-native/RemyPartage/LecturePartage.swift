import UIKit
import ImageIO
import UniformTypeIdentifiers
import Vision
import RemyCore

// Lire ce qu'une autre app partage (24/10) : les textes, les liens, une
// image. L'image est réduite ici (ImageIO, sans la décoder en entier : une
// photo de 48 Mpx tiendrait mal dans la mémoire d'une extension) et son texte
// est lu sur l'iPhone (Vision). Rien ne part avant « Envoyer à Rémy ».

/// Une image prête : ce qui part, et l'aperçu montré à Sam.
struct ImageLue: @unchecked Sendable {
    let image: ImagePartagee
    let apercu: UIImage
}

enum LecturePartage {
    /// Tout ce que contiennent les éléments partagés, démêlé par le cœur.
    static func lire(_ elements: [NSExtensionItem]) async -> (contenu: ContenuPartage, apercu: UIImage?) {
        var textes: [String] = []
        var liens: [URL] = []
        var titre: String?
        var lue: ImageLue?
        for element in elements {
            if titre == nil, let t = element.attributedTitle?.string, !t.isEmpty { titre = t }
            if let t = element.attributedContentText?.string, !t.isEmpty { textes.append(t) }
            for fournisseur in element.attachments ?? [] {
                if fournisseur.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    // Une seule image (règle d'activation) ; la première gagne.
                    guard lue == nil, let donnees = await donneesImage(fournisseur) else { continue }
                    lue = await Task.detached(priority: .userInitiated) { preparer(donnees) }.value
                } else if fournisseur.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    if let u = await lien(fournisseur) { liens.append(u) }
                } else if fournisseur.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    if let t = await texte(fournisseur) { textes.append(t) }
                }
            }
        }
        return (ContenuPartage(textes: textes, liens: liens, titre: titre, image: lue?.image), lue?.apercu)
    }

    // MARK: Pièces jointes (converties dans le rappel : rien d'autre ne traverse)

    private static func texte(_ f: NSItemProvider) async -> String? {
        await withCheckedContinuation { suite in
            f.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                guard let item else { return suite.resume(returning: nil) }
                switch item {
                case let s as String: suite.resume(returning: s)
                case let s as NSAttributedString: suite.resume(returning: s.string)
                case let d as Data: suite.resume(returning: String(data: d, encoding: .utf8))
                case let u as URL: suite.resume(returning: try? String(contentsOf: u, encoding: .utf8))
                default: suite.resume(returning: nil)
                }
            }
        }
    }

    private static func lien(_ f: NSItemProvider) async -> URL? {
        await withCheckedContinuation { suite in
            f.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
                guard let item else { return suite.resume(returning: nil) }
                switch item {
                case let u as URL: suite.resume(returning: u)
                case let s as String: suite.resume(returning: URL(string: s.trimmingCharacters(in: .whitespacesAndNewlines)))
                case let d as Data:
                    suite.resume(returning: URL(dataRepresentation: d, relativeTo: nil)
                        ?? String(data: d, encoding: .utf8).flatMap { URL(string: $0) })
                default: suite.resume(returning: nil)
                }
            }
        }
    }

    /// Les octets de l'image : un fichier (Photos), des données, ou une
    /// UIImage (capture d'écran retouchée, partagée sans être enregistrée).
    private static func donneesImage(_ f: NSItemProvider) async -> Data? {
        await withCheckedContinuation { suite in
            f.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { item, _ in
                guard let item else { return suite.resume(returning: nil) }
                switch item {
                case let u as URL: suite.resume(returning: try? Data(contentsOf: u, options: .mappedIfSafe))
                case let d as Data: suite.resume(returning: d)
                case let i as UIImage: suite.resume(returning: i.pngData() ?? i.jpegData(compressionQuality: 0.95))
                default: suite.resume(returning: nil)
                }
            }
        }
    }

    // MARK: Image : réduire, compresser, lire le texte

    /// Réduite à `EnvoiPartage.coteImage` px (dans le bon sens), JPEG sous
    /// `EnvoiPartage.poidsImage` si possible, texte lu sur l'iPhone.
    static func preparer(_ donnees: Data) -> ImageLue? {
        guard let source = CGImageSourceCreateWithData(donnees as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: EnvoiPartage.coteImage,
        ]
        guard let reduite = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let ui = UIImage(cgImage: reduite)
        var jpeg: Data?
        for q in EnvoiPartage.qualitesImage {
            guard let d = ui.jpegData(compressionQuality: CGFloat(q)) else { continue }
            jpeg = d
            if d.count <= EnvoiPartage.poidsImage { break }
        }
        // La tour en accepte 3 Mo : au-delà (rarissime à 1600 px), on renonce.
        guard let jpeg, jpeg.count < 2_900_000 else { return nil }
        let image = ImagePartagee(donnees: jpeg, largeur: reduite.width, hauteur: reduite.height, texteLu: lireTexte(reduite))
        return ImageLue(image: image, apercu: ui)
    }

    /// Le texte de l'image, lu sur l'iPhone (Vision, hors ligne). nil : aucun.
    static func lireTexte(_ image: CGImage) -> String? {
        let requete = VNRecognizeTextRequest()
        requete.recognitionLevel = .accurate
        requete.usesLanguageCorrection = true
        requete.recognitionLanguages = ["fr-FR", "en-US"]
        do {
            try VNImageRequestHandler(cgImage: image, options: [:]).perform([requete])
        } catch {
            return nil
        }
        let lignes = (requete.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        return lignes.isEmpty ? nil : lignes.joined(separator: "\n")
    }
}
