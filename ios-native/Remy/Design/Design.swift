import SwiftUI
import UIKit

// Direction A « Atelier » (Lot 1, J1.1, choisie par Sam le 15/10) : papier
// chaud, titres en New York, heures en JetBrains Mono, cartes douces à bord
// fin, une seule couleur de signal. Toute couleur de l'app vient d'ici. Le
// thème suit celui de l'iPhone. Textes secondaires ≥ 4,5:1 sur le fond.

extension Color {
    /// Une couleur qui suit le thème (clair / sombre) de l'iPhone.
    init(clair: UInt32, sombre: UInt32) {
        self.init(uiColor: UIColor { trait in
            let v = trait.userInterfaceStyle == .dark ? sombre : clair
            return UIColor(
                red: CGFloat((v >> 16) & 0xFF) / 255,
                green: CGFloat((v >> 8) & 0xFF) / 255,
                blue: CGFloat(v & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}

enum Palette {
    static let fond = Color(clair: 0xF4EFE6, sombre: 0x14120F)
    /// Les cartes, posées sur le fond.
    static let surface = Color(clair: 0xFFFCF6, sombre: 0x1F1C18)
    static let fond2 = Color(clair: 0xEDE5D8, sombre: 0x2B2722)
    static let fond3 = Color(clair: 0xE2D8C8, sombre: 0x342F28)
    static let encre = Color(clair: 0x221E18, sombre: 0xF3ECE1)
    static let encre2 = Color(clair: 0x564E43, sombre: 0xC2B9AB)
    /// Texte secondaire encore lisible au soleil (contraste ≥ 4,5:1 sur le fond).
    static let encre3 = Color(clair: 0x6F675B, sombre: 0x9A9286)
    static let filet = Color(clair: 0xE2D8C8, sombre: 0x342F28)
    /// L'orange de la marque : des aplats et des repères, jamais du petit texte.
    static let signal = Color(clair: 0xF2541B, sombre: 0xFF6A33)
    static let surSignal = Color(clair: 0x221E18, sombre: 0x14120F)
    static let danger = Color(clair: 0xB2361D, sombre: 0xFF8A6B)
    /// L'ombre des cartes : chaude, à peine là.
    static let ombre = Color(clair: 0x5C4630, sombre: 0x000000).opacity(0.10)

    /// Une couleur par projet, stable d'un lancement à l'autre (même nom, même
    /// couleur). L'urgence se dit par une forme, jamais par ces couleurs.
    static func projet(_ nom: String?) -> Color {
        guard let nom, !nom.isEmpty else { return encre3 }
        let teintes: [Color] = [
            Color(clair: 0x3D6A8A, sombre: 0x82AACB), Color(clair: 0x7B4E90, sombre: 0xBA94CF),
            Color(clair: 0xC0603D, sombre: 0xE89878), Color(clair: 0x4F855A, sombre: 0x8EC399),
            Color(clair: 0xA67A28, sombre: 0xDDB466), Color(clair: 0x5B7882, sombre: 0x9AB5BC),
        ]
        // FNV-1a : le hachage de Swift change à chaque lancement.
        var h: UInt32 = 2_166_136_261
        for o in nom.lowercased().utf8 { h = (h ^ UInt32(o)) &* 16_777_619 }
        // Brassage final : sans lui, les bits bas se ressemblent et trois
        // projets sur trois tombaient sur la même couleur.
        h ^= h >> 16
        h = h &* 0x7FEB_352D
        h ^= h >> 15
        return teintes[Int(h % UInt32(teintes.count))]
    }
}

enum Police {
    /// New York, le serif d'Apple : titres et voix de Rémy. La taille suit le
    /// réglage de texte de l'iPhone (Dynamic Type), comme Inter : sinon, en
    /// grand texte, le détail dépassait le titre (24/10). Plafonnée au double.
    static func titre(_ taille: CGFloat, _ graisse: Font.Weight = .semibold, italique: Bool = false) -> Font {
        let suivie = min(UIFontMetrics(forTextStyle: .title2).scaledValue(for: taille), taille * 2)
        let f = Font.system(size: suivie, weight: graisse, design: .serif)
        return italique ? f.italic() : f
    }

    /// Inter, dans ses graisses embarquées.
    static func texte(_ taille: CGFloat, _ graisse: Font.Weight = .regular) -> Font {
        let nom: String
        switch graisse {
        case .heavy, .black: nom = "Inter-ExtraBold"
        case .bold: nom = "Inter-Bold"
        case .semibold: nom = "Inter-SemiBold"
        case .medium: nom = "Inter-Medium"
        default: nom = "Inter-Regular"
        }
        return .custom(nom, size: taille)
    }

    /// JetBrains Mono : heures et chiffres.
    static func mono(_ taille: CGFloat, _ graisse: Font.Weight = .regular) -> Font {
        let nom: String
        switch graisse {
        case .semibold, .bold, .heavy, .black: nom = "JetBrainsMono-SemiBold"
        case .medium: nom = "JetBrainsMono-Medium"
        default: nom = "JetBrainsMono-Regular"
        }
        return .custom(nom, size: taille)
    }
}

// MARK: - Éléments

/// Titre de section : mono, capitales, espacé. Réservé aux titres de section.
struct Etiquette: View {
    let texte: String
    var couleur: Color = Palette.encre2
    var taille: CGFloat = 12
    var graisse: Font.Weight = .medium

    init(_ texte: String, couleur: Color = Palette.encre2, taille: CGFloat = 12, graisse: Font.Weight = .medium) {
        self.texte = texte
        self.couleur = couleur
        self.taille = taille
        self.graisse = graisse
    }

    var body: some View {
        Text(texte.uppercased(with: Locale(identifier: "fr_FR")))
            .font(Police.mono(taille, graisse))
            .tracking(taille * 0.07)
            .foregroundStyle(couleur)
            .monospacedDigit()
            .accessibilityAddTraits(.isHeader)
    }
}

/// Filet horizontal : fin (séparation) ou épais (rupture de section).
struct Filet: View {
    var epais = false
    var couleur: Color? = nil

    var body: some View {
        Rectangle()
            .fill(couleur ?? (epais ? Palette.encre : Palette.filet))
            .frame(height: epais ? 3 : 1)
    }
}

/// Le carré orange de la marque.
struct CarreSignal: View {
    var taille: CGFloat = 8
    var body: some View { Rectangle().fill(Palette.signal).frame(width: taille, height: taille) }
}

struct Wordmark: View {
    var taille: CGFloat = 22
    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: taille * 0.22) {
            Text("RÉMY")
                .font(Police.texte(taille, .heavy))
                .tracking(-taille * 0.04)
                .foregroundStyle(Palette.encre)
            CarreSignal(taille: taille * 0.34)
        }
    }
}

/// Petite pastille d'état (« En cours », « En retard »).
struct Pastille: View {
    let texte: String
    var alerte = false
    var body: some View {
        Text(texte)
            .font(Police.texte(12, .semibold))
            .foregroundStyle(alerte ? Palette.danger : Palette.surSignal)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(alerte ? Color.clear : Palette.signal, in: Capsule())
            .overlay(Capsule().stroke(alerte ? Palette.danger : Palette.signal, lineWidth: 1))
            .fixedSize()
    }
}

// MARK: - Boutons

enum GenreBouton { case principal, discret, danger }

/// Bouton : angles doux, encre pleine (principal) ou papier (discret).
struct BoutonBrut: ButtonStyle {
    var genre: GenreBouton = .discret
    var pleineLargeur = false
    @Environment(\.isEnabled) private var actif

    func makeBody(configuration: Configuration) -> some View {
        let appuye = configuration.isPressed
        let (fond, texte, bord): (Color, Color, Color) = {
            switch (genre, appuye) {
            case (.principal, false): return (Palette.encre, Palette.fond, .clear)
            case (.principal, true): return (Palette.encre2, Palette.fond, .clear)
            case (.discret, false): return (Palette.fond2, Palette.encre, .clear)
            case (.discret, true): return (Palette.fond3, Palette.encre, .clear)
            case (.danger, false): return (.clear, Palette.danger, Palette.danger)
            case (.danger, true): return (Palette.danger.opacity(0.12), Palette.danger, Palette.danger)
            }
        }()
        return configuration.label
            .font(Police.texte(16, .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, 16)
            .frame(minHeight: 48)
            .frame(maxWidth: pleineLargeur ? .infinity : nil)
            .foregroundStyle(texte)
            .background(fond, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(bord, lineWidth: 1.5))
            .scaleEffect(appuye ? 0.98 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.8), value: appuye)
            .opacity(actif ? 1 : 0.4)
            .contentShape(Rectangle())
    }
}

/// Lien d'action discret : « Demander à Rémy › ».
struct LienTexte: View {
    let titre: String
    var couleur: Color = Palette.encre
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(titre)
                Text("›")
            }
            .font(Police.texte(15, .semibold))
            .foregroundStyle(couleur)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Bouton en texte seul (« Réessayer », « Annuler ») : la zone de 44 pt est
/// DANS le bouton, sinon seul le texte réagit au doigt.
struct BoutonTexte: View {
    let titre: String
    var couleur: Color = Palette.encre
    let action: () -> Void

    init(_ titre: String, couleur: Color = Palette.encre, action: @escaping () -> Void) {
        self.titre = titre
        self.couleur = couleur
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(titre)
                .font(Police.texte(15, .semibold))
                .foregroundStyle(couleur)
                .padding(.horizontal, 8)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Bouton d'en-tête : icône ET texte (pas d'icône mystère).
struct BoutonEnTete: View {
    let titre: String
    let symbole: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbole).font(.system(size: 16, weight: .medium))
                Text(titre).font(Police.texte(15, .semibold))
            }
            .foregroundStyle(Palette.encre)
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// La case d'une tâche : 20 pt dessinés, 44 pt touchables. `nom` : ce que
/// VoiceOver annonce (« Terminer « Relire le contrat » »), sinon N fois le
/// même bouton dans une liste.
struct CaseACocher: View {
    var cochee = false
    var enCours = false
    var nom: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(Palette.encre2, lineWidth: 1.5)
                    .background(cochee ? Palette.encre : Color.clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .frame(width: 22, height: 22)
                if cochee {
                    Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Palette.fond)
                }
            }
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
            .opacity(enCours ? 0.4 : 1)
        }
        .buttonStyle(.plain)
        .disabled(enCours)
        .accessibilityLabel(libelle)
    }

    private var libelle: String {
        guard let nom else { return cochee ? "Fait" : "Marquer comme fait" }
        return cochee ? "« \(nom) » : fait" : "Terminer « \(nom) »"
    }
}

// MARK: - Sections

/// Une section de l'écran : titre en capitales, contenu dessous.
struct Partie<Contenu: View>: View {
    let titre: String
    var couleur: Color = Palette.encre
    @ViewBuilder let contenu: () -> Contenu

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Etiquette(titre, couleur: couleur, graisse: .semibold)
            contenu()
        }
        .padding(.horizontal, 18)
        .padding(.top, 22)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Filet() }
    }
}

/// Squelette de chargement : un aplat qui pulse, pas un dégradé qui brille.
struct Squelette: View {
    var largeurs: [CGFloat] = [0.9, 0.65, 0.8]
    @State private var pulse = false
    @Environment(\.accessibilityReduceMotion) private var reduire

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(largeurs.enumerated()), id: \.offset) { _, l in
                GeometryReader { g in
                    Capsule().fill(Palette.fond3).frame(width: g.size.width * l, height: 12)
                }
                .frame(height: 12)
            }
        }
        .opacity(pulse ? 1 : 0.45)
        .onAppear {
            guard !reduire else { pulse = true; return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
        }
        .accessibilityLabel("Chargement")
    }
}

/// Texte d'état vide ou d'erreur, avec l'action qui débloque.
struct Vide: View {
    let texte: String
    var titreAction: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(texte).font(Police.texte(15)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
            if let titreAction, let action {
                Button(titreAction, action: action).buttonStyle(BoutonBrut())
            }
        }
    }
}

// MARK: - Retour haptique

enum Haptique {
    static func leger() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func succes() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func erreur() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}
