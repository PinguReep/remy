import SwiftUI
import PhotosUI
import QuickLook
import UniformTypeIdentifiers
import ImageIO
import RemyCore

// Les pièces jointes du chat (12/11) : le trombone du composeur (photothèque,
// appareil photo, Fichiers), les pièces en attente, et dans le fil la vignette
// d'une image ou la puce d'un fichier, avec ce que Rémy en a lu. Une photo est
// réduite ici (JPEG) ; la tour range l'original chiffré et le LIT (OCR de
// Windows, modèle de vision local) — l'iPhone ne reconnaît plus le texte
// lui-même. La logique est dans RemyCore (PiecesJointes.swift, testée).

/// Préparer une pièce sur l'iPhone, hors du fil principal.
enum PreparationPiece {
    /// Une image : l'original réduit à `coteOriginal` px (JPEG), un aperçu à
    /// `coteVision` px pour le modèle de vision local de la tour, et une
    /// vignette pour le composeur. Le texte, c'est la tour qui le lit.
    static func image(_ donnees: Data, nom: String) -> PieceAEnvoyer? {
        guard let source = CGImageSourceCreateWithData(donnees as CFData, nil) else { return nil }
        func reduite(_ cote: Int) -> CGImage? {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: cote,
            ]
            return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        }
        guard let grande = reduite(PiecesJointes.coteOriginal) else { return nil }
        var jpeg = UIImage(cgImage: grande).jpegData(compressionQuality: 0.85)
        if let j = jpeg, j.count > PiecesJointes.pieceMax { jpeg = UIImage(cgImage: grande).jpegData(compressionQuality: 0.6) }
        guard let original = jpeg, original.count <= PiecesJointes.pieceMax else { return nil }
        let vision = reduite(PiecesJointes.coteVision)
        let apercu = vision.flatMap { UIImage(cgImage: $0).jpegData(compressionQuality: 0.8) }
        let vignette = reduite(160).flatMap { UIImage(cgImage: $0).jpegData(compressionQuality: 0.7) }
        return PieceAEnvoyer(nom: PiecesJointes.enJPEG(nom), donnees: original, apercu: apercu, vignette: vignette)
    }

    /// Un fichier choisi dans Fichiers : une image passe par `image`, le reste
    /// part tel quel (la tour vérifie son contenu). Rend la pièce, ou la raison.
    static func fichier(_ url: URL) -> (piece: PieceAEnvoyer?, refus: String?) {
        let acces = url.startAccessingSecurityScopedResource()
        defer { if acces { url.stopAccessingSecurityScopedResource() } }
        let nom = url.lastPathComponent
        let taille = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if let r = PiecesJointes.refus(nom: nom, taille: max(taille, 1), deja: 0) { return (nil, r) }
        guard let donnees = try? Data(contentsOf: url) else { return (nil, "« \(nom) » n'a pas pu être lu sur l'iPhone.") }
        if PiecesJointes.famille(nom) == "image" {
            guard let p = image(donnees, nom: nom) else { return (nil, "« \(nom) » : image illisible sur l'iPhone.") }
            return (p, nil)
        }
        if let r = PiecesJointes.refus(nom: nom, taille: donnees.count, deja: 0) { return (nil, r) }
        return (PieceAEnvoyer(nom: nom, donnees: donnees), nil)
    }
}

/// Le trombone du composeur : photothèque, appareil photo, Fichiers.
struct BoutonJoindre: View {
    @Environment(AppModel.self) private var app
    @State private var photosOuvert = false
    @State private var selection: [PhotosPickerItem] = []
    @State private var fichiersOuvert = false
    @State private var cameraOuverte = false
    @State private var prepare = false

    static let types: [UTType] = [.image, .pdf, .plainText] + [UTType(filenameExtension: "md")].compactMap { $0 }

    var body: some View {
        Menu {
            Button { photosOuvert = true } label: { Label("Photothèque", systemImage: "photo.on.rectangle") }
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button { cameraOuverte = true } label: { Label("Appareil photo", systemImage: "camera") }
            }
            Button { fichiersOuvert = true } label: { Label("Fichiers (PDF, texte, image)", systemImage: "folder") }
        } label: {
            Group {
                if prepare {
                    ProgressView()
                } else {
                    Image(systemName: "paperclip")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(Palette.encre2)
                }
            }
            .frame(width: 44, height: 48)
            .contentShape(Rectangle())
        }
        .disabled(prepare)
        .accessibilityLabel("Joindre une pièce")
        .accessibilityHint("Une image, un PDF ou un texte ; Rémy dit ce qu'il en a lu")
        .photosPicker(isPresented: $photosOuvert, selection: $selection, maxSelectionCount: PiecesJointes.parMessage, matching: .images)
        .onChange(of: selection) { _, items in
            guard !items.isEmpty else { return }
            selection = []
            Task { await photos(items) }
        }
        .fileImporter(isPresented: $fichiersOuvert, allowedContentTypes: Self.types, allowsMultipleSelection: true) { r in
            guard case .success(let urls) = r else { return }
            Task { await fichiers(urls) }
        }
        .fullScreenCover(isPresented: $cameraOuverte) {
            AppareilPhoto(ouverte: $cameraOuverte) { photo in
                guard let d = photo.jpegData(compressionQuality: 0.95) else { return }
                Task { await ajouter([d], noms: [PiecesJointes.nomPhoto()]) }
            }
            .ignoresSafeArea()
        }
    }

    private func photos(_ items: [PhotosPickerItem]) async {
        prepare = true
        defer { prepare = false }
        var donnees: [Data] = []
        for item in items {
            if let d = try? await item.loadTransferable(type: Data.self) { donnees.append(d) }
        }
        if donnees.count < items.count { app.dire("Une photo n'a pas pu être lue sur l'iPhone (iCloud injoignable ?).") }
        await ajouter(donnees, noms: donnees.indices.map { i in
            let n = PiecesJointes.nomPhoto()
            return i == 0 ? n : n.replacingOccurrences(of: ".jpg", with: "-\(i + 1).jpg")
        })
    }

    private func ajouter(_ images: [Data], noms: [String]) async {
        prepare = true
        defer { prepare = false }
        for (d, nom) in zip(images, noms) {
            let p = await Task.detached(priority: .userInitiated) { PreparationPiece.image(d, nom: nom) }.value
            if let p { app.chat.ajouterPiece(p) } else { app.dire("« \(nom) » : image illisible ou trop lourde.") }
        }
    }

    private func fichiers(_ urls: [URL]) async {
        prepare = true
        defer { prepare = false }
        for u in urls {
            let r = await Task.detached(priority: .userInitiated) { PreparationPiece.fichier(u) }.value
            if let p = r.piece { app.chat.ajouterPiece(p) } else if let raison = r.refus { app.dire(raison) }
        }
    }
}

/// L'appareil photo (UIKit) : une photo, puis la feuille se ferme.
struct AppareilPhoto: UIViewControllerRepresentable {
    @Binding var ouverte: Bool
    let surPhoto: (UIImage) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let c = UIImagePickerController()
        c.sourceType = .camera
        c.delegate = context.coordinator
        return c
    }

    func updateUIViewController(_ c: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinateur { Coordinateur(self) }

    final class Coordinateur: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: AppareilPhoto
        init(_ parent: AppareilPhoto) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let i = info[.originalImage] as? UIImage { parent.surPhoto(i) }
            parent.ouverte = false
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.ouverte = false
        }
    }
}

/// Les pièces du composeur, pas encore parties.
struct PiecesEnAttente: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(app.chat.piecesEnAttente) { p in
                    HStack(spacing: 8) {
                        if let v = p.vignette, let i = UIImage(data: v) {
                            Image(uiImage: i).resizable().scaledToFill()
                                .frame(width: 38, height: 38)
                                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                        } else {
                            Image(systemName: p.famille == "pdf" ? "doc.richtext" : "doc.text")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(Palette.encre2)
                                .frame(width: 38, height: 38)
                                .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                        }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(p.nom).font(Police.texte(14, .semibold)).foregroundStyle(Palette.encre).lineLimit(1)
                            Text(p.envoi ? "Envoi et lecture…" : PiecesJointes.tailleLisible(p.taille))
                                .font(Police.texte(12)).foregroundStyle(Palette.encre3)
                        }
                        .frame(maxWidth: 170, alignment: .leading)
                        if p.envoi {
                            ProgressView().frame(width: 44, height: 44)
                        } else {
                            Button {
                                Haptique.leger()
                                app.chat.retirerPiece(p.id)
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Palette.encre2)
                                    .frame(width: 44, height: 44)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Retirer \(p.nom)")
                        }
                    }
                    .padding(.leading, 6)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.filet, lineWidth: 1))
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.horizontal, 12)
        }
        .padding(.top, 8)
    }
}

/// Les pièces d'un message de Sam, dans le fil : une vignette par image, une
/// puce par fichier ; un geste les ouvre en grand (Coup d'œil).
struct PiecesDuMessage: View {
    @Environment(AppModel.self) private var app
    let pieces: [PieceJointe]
    @State private var apercu: URL?
    @State private var ouverture: String?

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            ForEach(pieces) { p in
                Button {
                    Haptique.leger()
                    Task { await ouvrir(p) }
                } label: {
                    if p.estImage {
                        VignettePiece(piece: p, chargement: ouverture == p.id)
                    } else {
                        PuceFichier(piece: p, chargement: ouverture == p.id)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(p.nom), \(p.libelle)")
                .accessibilityHint("Ouvre la pièce en grand")
            }
        }
        .quickLookPreview($apercu)
        .onChange(of: apercu) { ancien, nouveau in
            // Coup d'œil refermé : la copie temporaire part.
            if nouveau == nil, let u = ancien { try? FileManager.default.removeItem(at: u.deletingLastPathComponent()) }
        }
    }

    private func ouvrir(_ p: PieceJointe) async {
        guard ouverture == nil else { return }
        ouverture = p.id
        defer { ouverture = nil }
        guard let d = await app.chat.originalPiece(p.id) else {
            app.dire("La pièce n'a pas pu être relue sur la tour : réessaie.")
            return
        }
        let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("piece-\(UUID().uuidString)")
        do {
            try FileManager.default.createDirectory(at: dossier, withIntermediateDirectories: true)
            let u = dossier.appendingPathComponent(p.nom.isEmpty ? "piece" : p.nom)
            try d.write(to: u, options: [.atomic, .completeFileProtection])
            apercu = u
        } catch {
            app.dire("La pièce n'a pas pu s'ouvrir sur l'iPhone.")
        }
    }
}

/// La vignette d'une image du fil, relue depuis la tour.
struct VignettePiece: View {
    @Environment(AppModel.self) private var app
    let piece: PieceJointe
    var chargement = false
    @State private var image: UIImage?
    @State private var echec = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.fond2)
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else if echec {
                    Image(systemName: "photo").font(.system(size: 22)).foregroundStyle(Palette.encre3)
                } else {
                    ProgressView()
                }
                if chargement { ProgressView().padding(8).background(.ultraThinMaterial, in: Circle()) }
            }
            .frame(width: 220, height: 150)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            Text(piece.nom).font(Police.texte(13, .semibold)).foregroundStyle(Palette.encre).lineLimit(1)
            Text(piece.libelle).font(Police.texte(12)).foregroundStyle(piece.estLue ? Palette.encre2 : Palette.encre3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(width: 220, alignment: .leading)
        .padding(6)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.filet, lineWidth: 1))
        .task(id: piece.id) {
            guard image == nil else { return }
            if let d = await app.chat.originalPiece(piece.id), let i = UIImage(data: d) { image = i } else { echec = true }
        }
    }
}

/// La puce d'un fichier du fil (PDF, texte).
struct PuceFichier: View {
    let piece: PieceJointe
    var chargement = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: piece.famille == "pdf" ? "doc.richtext" : "doc.text")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Palette.encre2)
                .frame(width: 40, height: 40)
                .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(piece.nom).font(Police.texte(14, .semibold)).foregroundStyle(Palette.encre).lineLimit(1)
                Text(piece.detail).font(Police.texte(12)).foregroundStyle(Palette.encre3)
                Text(piece.libelle).font(Police.texte(12)).foregroundStyle(piece.estLue ? Palette.encre2 : Palette.encre3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if chargement { ProgressView() } else {
                Image(systemName: "eye").font(.system(size: 14)).foregroundStyle(Palette.encre3)
            }
        }
        .padding(10)
        .frame(width: 280, alignment: .leading)
        .frame(minHeight: 60)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.filet, lineWidth: 1))
        .contentShape(Rectangle())
    }
}

/// Réglages › Diagnostic : « Essayer la lecture des pièces » (la tour essaie
/// son OCR, son modèle local et un PDF, sur des fichiers d'essai).
struct EssaiLecturePieces: View {
    @Environment(AppModel.self) private var app
    @State private var essai: EssaiPieces?
    @State private var enCours = false
    @State private var erreur: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                Image(systemName: "paperclip").font(.system(size: 18)).frame(width: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Lecture des pièces jointes").font(Police.texte(16, .medium))
                    Text("Ce que ta tour sait lire de ce que tu joins, ici comme sur le site : le texte des images, les images (modèle local), les PDF ; et si le modèle peut relire une pièce. Des fichiers d'essai, rien de toi.")
                        .font(Police.texte(13)).foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Button {
                Haptique.leger()
                Task { await essayer() }
            } label: {
                HStack(spacing: 8) {
                    if enCours { ProgressView() }
                    Text(enCours ? "La tour essaie… (jusqu'à une minute)" : "Essayer la lecture des pièces")
                        .font(Police.texte(15, .semibold))
                }
                .foregroundStyle(Palette.encre)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(Palette.fond2, in: Capsule())
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(enCours)
            if let e = essai {
                ForEach(e.lignes) { l in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: l.ok ? "checkmark" : "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(l.ok ? Palette.encre : Palette.danger)
                        (Text("\(l.libelle) : ").font(Police.texte(14, .semibold)) + Text(l.detail).font(Police.texte(14)))
                            .foregroundStyle(Palette.encre)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityElement(children: .combine)
                }
                BoutonTexte("Copier le diagnostic", couleur: Palette.signal) {
                    UIPasteboard.general.string = e.diagnostic
                    Haptique.succes()
                    app.dire("Diagnostic copié.")
                }
            }
            if let erreur {
                Text(erreur).font(Police.texte(14)).foregroundStyle(Palette.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Filet() }
    }

    private func essayer() async {
        enCours = true
        erreur = nil
        defer { enCours = false }
        do {
            essai = try await app.api.essaiPieces()
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app.signaler(e); return }
            erreur = "Essai impossible : \(error.localizedDescription)"
        }
    }
}
