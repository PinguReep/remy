import SwiftUI
import UIKit
import UniformTypeIdentifiers
import RemyCore

// La feuille « Envoyer à Rémy » (24/10) : l'aperçu de ce qui part, un mot
// facultatif, puis le reçu de la tour — ou une erreur claire, avec « Copier »
// pour ne rien perdre. Au style de l'app (papier, encre, un carré orange),
// en polices système : l'extension n'embarque pas Inter.

@MainActor
final class ModelePartage: ObservableObject {
    enum Etat: Equatable {
        case lecture
        case pret
        case envoi
        case recu(RecuPartage)
        case echec(EchecPartage)
    }

    @Published var etat: Etat = .lecture
    @Published var contenu = ContenuPartage()
    @Published var apercu: UIImage?
    @Published var mot = ""
    /// L'envoi dure : le modèle local lit et classe (jusqu'à une minute).
    @Published var lent = false
    @Published var copie = false

    private let trousseau: TrousseauPartage
    let terminer: () -> Void
    let annuler: () -> Void

    init(trousseau: TrousseauPartage = .systeme, terminer: @escaping () -> Void, annuler: @escaping () -> Void) {
        self.trousseau = trousseau
        self.terminer = terminer
        self.annuler = annuler
    }

    /// Ce qui empêche l'envoi, dit sous le bouton.
    var manque: String? { EnvoiPartage.manque(contenu, mot: mot) }

    func charger(_ elements: [NSExtensionItem]) async {
        let lu = await LecturePartage.lire(elements)
        contenu = lu.contenu
        apercu = lu.apercu
        // Pas connecté : on le dit tout de suite, avant que Sam écrive un mot.
        do {
            _ = try trousseau.client()
            etat = .pret
        } catch {
            etat = .echec(EchecPartage(error))
        }
    }

    func envoyer() async {
        guard manque == nil, etat != .envoi else { return }
        etat = .envoi
        lent = false
        copie = false
        let attente = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            if !Task.isCancelled { self?.lent = true }
        }
        defer { attente.cancel() }
        do {
            let recu = try await trousseau.client().partager(contenu, mot: mot)
            etat = .recu(recu)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            etat = .echec(EchecPartage(error))
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }

    /// Le texte (et l'image) dans le presse-papiers : rien n'est perdu.
    func copier() {
        var element: [String: Any] = [:]
        let texte = EnvoiPartage.texteACopier(contenu, mot: mot)
        if !texte.isEmpty { element[UTType.utf8PlainText.identifier] = texte }
        if let image = contenu.image?.donnees { element[UTType.jpeg.identifier] = image }
        guard !element.isEmpty else { return }
        UIPasteboard.general.setItems([element])
        copie = true
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}

struct FeuillePartage: View {
    @ObservedObject var modele: ModelePartage

    var body: some View {
        VStack(spacing: 0) {
            enTete
            Rectangle().fill(Teinte.filet).frame(height: 1)
            switch modele.etat {
            case .lecture: chargement
            case .pret: formulaire
            case .envoi: envoi
            case .recu(let r): recu(r)
            case .echec(let e): echec(e)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Teinte.fond.ignoresSafeArea())
    }

    // MARK: En-tête

    private var enTete: some View {
        HStack(spacing: 8) {
            HStack(alignment: .lastTextBaseline, spacing: 5) {
                Text("RÉMY")
                    .font(.system(size: 20, weight: .heavy))
                    .tracking(-0.8)
                    .foregroundStyle(Teinte.encre)
                Rectangle().fill(Teinte.signal).frame(width: 7, height: 7)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Rémy")
            Spacer()
            // Toujours là pendant l'envoi : une tour éteinte ferait attendre
            // jusqu'au délai de la requête.
            if !estRecu {
                BoutonTexteSeul(titre: "Annuler", action: modele.annuler)
            }
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .frame(minHeight: 56)
    }

    private var estRecu: Bool {
        if case .recu = modele.etat { return true }
        return false
    }

    // MARK: États

    private var chargement: some View {
        VStack(alignment: .leading, spacing: 14) {
            EnTetePartage(texte: "Ce qui part")
            VStack(alignment: .leading, spacing: 10) {
                ForEach(0..<3, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 4).fill(Teinte.fond3)
                        .frame(maxWidth: i == 2 ? CGFloat(160) : CGFloat.infinity)
                        .frame(height: 12)
                }
            }
            .padding(14)
            .background(Teinte.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            Text("Je regarde ce que tu partages…")
                .font(.system(size: 15))
                .foregroundStyle(Teinte.encre2)
            Spacer()
        }
        .padding(20)
        .accessibilityElement(children: .combine)
    }

    private var formulaire: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                EnTetePartage(texte: "Ce qui part")
                CarteApercu(contenu: modele.contenu, apercu: modele.apercu)
                EnTetePartage(texte: "Un mot pour Rémy ?")
                TextField("Facultatif : pourquoi tu le gardes, quoi en faire…", text: $modele.mot, axis: .vertical)
                    .lineLimit(1...5)
                    .font(.system(size: 16))
                    .foregroundStyle(Teinte.encre)
                    .tint(Teinte.signal)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 12)
                    .frame(minHeight: 48)
                    .background(Teinte.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Teinte.filet, lineWidth: 1))
                if let m = modele.manque {
                    Text(m)
                        .font(.system(size: 14))
                        .foregroundStyle(Teinte.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            Button("Envoyer à Rémy") { Task { await modele.envoyer() } }
                .buttonStyle(BoutonPartage(principal: true))
                .disabled(modele.manque != nil)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(Teinte.fond)
        }
    }

    private var envoi: some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView()
                .controlSize(.large)
                .tint(Teinte.encre)
            Text("Envoi à ta tour…")
                .font(.system(size: 20, weight: .semibold, design: .serif))
                .foregroundStyle(Teinte.encre)
            Text(modele.lent
                 ? "Rémy le lit avec le modèle local : ça peut prendre une minute. Garde cette feuille ouverte."
                 : "Rémy le lit et le classe.")
                .font(.system(size: 15))
                .foregroundStyle(Teinte.encre2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func recu(_ r: RecuPartage) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Rectangle().fill(Teinte.signal).frame(width: 10, height: 10)
                Text(r.titre)
                    .font(.system(size: 26, weight: .bold, design: .serif))
                    .foregroundStyle(Teinte.encre)
            }
            Text(r.detail)
                .font(.system(size: 16))
                .foregroundStyle(Teinte.encre)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            Spacer()
            Button("Terminé", action: modele.terminer)
                .buttonStyle(BoutonPartage(principal: true))
        }
        .padding(20)
    }

    private func echec(_ e: EchecPartage) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(e.titre)
                .font(.system(size: 22, weight: .bold, design: .serif))
                .foregroundStyle(Teinte.encre)
                .fixedSize(horizontal: false, vertical: true)
            Text(e.detail)
                .font(.system(size: 16))
                .foregroundStyle(Teinte.encre2)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            Spacer()
            if modele.contenu.genre != .vide {
                Button(modele.copie ? "Copié dans le presse-papiers" : "Copier ce que je partage", action: modele.copier)
                    .buttonStyle(BoutonPartage(principal: !e.reessayable))
            }
            if e.reessayable {
                Button("Réessayer") { Task { await modele.envoyer() } }
                    .buttonStyle(BoutonPartage(principal: true))
            }
            HStack {
                Spacer()
                BoutonTexteSeul(titre: "Fermer", action: modele.annuler)
                Spacer()
            }
        }
        .padding(20)
    }
}

/// L'aperçu de ce qui part : l'image et le texte lu, le lien et son titre, ou le texte.
struct CarteApercu: View {
    let contenu: ContenuPartage
    let apercu: UIImage?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            switch contenu.genre {
            case .image:
                if let apercu {
                    Image(uiImage: apercu)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .accessibilityLabel("Image partagée")
                }
                Text(legendeImage)
                    .font(.system(size: 14))
                    .foregroundStyle(Teinte.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                if let t = contenu.image?.texteLu {
                    Text(t)
                        .font(.system(size: 14))
                        .foregroundStyle(Teinte.encre)
                        .lineLimit(4)
                }
            case .lien:
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "link")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Teinte.encre2)
                        .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(contenu.titre ?? contenu.lien?.host ?? "Lien")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Teinte.encre)
                            .lineLimit(3)
                        Text(contenu.lien?.absoluteString ?? "")
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(Teinte.encre2)
                            .lineLimit(2)
                            .truncationMode(.middle)
                    }
                }
                if let t = contenu.texte {
                    Text(t)
                        .font(.system(size: 15))
                        .foregroundStyle(Teinte.encre)
                        .lineLimit(6)
                }
            case .texte:
                Text(contenu.texte ?? "")
                    .font(.system(size: 15))
                    .foregroundStyle(Teinte.encre)
                    .lineLimit(10)
            case .vide:
                Text("Rien de lisible dans ce partage : ni texte, ni lien, ni image.")
                    .font(.system(size: 15))
                    .foregroundStyle(Teinte.encre2)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Teinte.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Teinte.filet, lineWidth: 1))
    }

    private var legendeImage: String {
        let n = contenu.image?.lignesLues ?? 0
        if n == 0 { return "Aucun texte repéré : l'image sera rangée dans ton coffre." }
        return "\(n) ligne\(n > 1 ? "s" : "") lue\(n > 1 ? "s" : "") sur l'image, par ton iPhone : Rémy apprendra de ce texte, l'image ira dans ton coffre."
    }
}

// MARK: - Éléments (repris du design de l'app, en polices système)

/// Titre de section : capitales espacées.
struct EnTetePartage: View {
    let texte: String
    var body: some View {
        Text(texte.uppercased(with: Locale(identifier: "fr_FR")))
            .font(.system(size: 12, weight: .medium, design: .monospaced))
            .tracking(0.84)
            .foregroundStyle(Teinte.encre2)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Bouton plein (encre) ou discret (papier), 48 pt de haut, toute la largeur.
struct BoutonPartage: ButtonStyle {
    var principal = false
    @Environment(\.isEnabled) private var actif

    func makeBody(configuration: Configuration) -> some View {
        let appuye = configuration.isPressed
        let fond: Color = principal ? (appuye ? Teinte.encre2 : Teinte.encre) : (appuye ? Teinte.fond3 : Teinte.fond2)
        return configuration.label
            .font(.system(size: 16, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(principal ? Teinte.fond : Teinte.encre)
            .background(fond, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .opacity(actif ? 1 : 0.4)
            .contentShape(Rectangle())
    }
}

/// Bouton en texte seul : la zone de 44 pt est dans le bouton.
struct BoutonTexteSeul: View {
    let titre: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(titre)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Teinte.encre)
                .padding(.horizontal, 12)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
