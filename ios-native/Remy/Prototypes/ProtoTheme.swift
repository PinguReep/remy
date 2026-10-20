import SwiftUI

// Les deux directions visuelles du Lot 1 (D11). Même produit, même logique ;
// ce qui change : matière, typographie, profondeur, gestes de la barre.
//
// A — Atelier : papier chaud, titres en New York (le serif d'Apple), heures en
//     JetBrains Mono, cartes douces à bord fin. L'identité actuelle de Remy,
//     réchauffée et arrondie.
// B — Clarté : iOS natif et lumineux, SF Pro et SF Rounded pour les chiffres,
//     cartes blanches flottantes, barre d'onglets en capsule flottante.

struct ProtoTheme {
    let direction: ProtoDirection
    let fond: Color
    let surface: Color
    let surface2: Color
    let encre: Color
    let encre2: Color
    let encre3: Color
    let filet: Color
    let signal: Color
    let alerte: Color
    let ombre: Color
    /// Rayon des cartes.
    let rayon: CGFloat
    /// Rayon des boutons et champs (surfaces distinctes : on ne force pas la
    /// règle concentrique quand la marge intérieure est grande).
    let rayonControle: CGFloat
    let categories: [ProtoCategorie: Color]

    var estAtelier: Bool { direction == .atelier }

    func couleur(_ c: ProtoCategorie) -> Color { categories[c] ?? encre2 }

    /// Titres : New York pour l'Atelier, SF Pro pour Clarté.
    func titre(_ taille: CGFloat, _ graisse: Font.Weight = .semibold) -> Font {
        .system(size: taille, weight: graisse, design: estAtelier ? .serif : .default)
    }

    /// Texte courant : Inter (embarquée) pour l'Atelier, SF Pro pour Clarté.
    func texte(_ taille: CGFloat, _ graisse: Font.Weight = .regular) -> Font {
        estAtelier ? Police.texte(taille, graisse) : .system(size: taille, weight: graisse)
    }

    /// Heures et durées : JetBrains Mono pour l'Atelier, SF Rounded pour Clarté.
    func chiffres(_ taille: CGFloat, _ graisse: Font.Weight = .medium) -> Font {
        estAtelier ? Police.mono(taille, graisse) : .system(size: taille, weight: graisse, design: .rounded)
    }

    static let atelier = ProtoTheme(
        direction: .atelier,
        fond: Color(clair: 0xF4EFE6, sombre: 0x14120F),
        surface: Color(clair: 0xFFFCF6, sombre: 0x1F1C18),
        surface2: Color(clair: 0xEDE5D8, sombre: 0x2B2722),
        encre: Color(clair: 0x221E18, sombre: 0xF3ECE1),
        encre2: Color(clair: 0x675F53, sombre: 0xB8AFA1),
        encre3: Color(clair: 0x8A8174, sombre: 0x8C8478),
        filet: Color(clair: 0xE2D8C8, sombre: 0x342F28),
        signal: Color(clair: 0xF2541B, sombre: 0xFF6A33),
        alerte: Color(clair: 0xB2361D, sombre: 0xFF8A6B),
        ombre: Color(clair: 0x5C4630, sombre: 0x000000).opacity(0.10),
        rayon: 22,
        rayonControle: 13,
        categories: [
            .pro: Color(clair: 0x3D6A8A, sombre: 0x82AACB),
            .musique: Color(clair: 0x7B4E90, sombre: 0xBA94CF),
            .proches: Color(clair: 0xC0603D, sombre: 0xE89878),
            .sport: Color(clair: 0x4F855A, sombre: 0x8EC399),
            .admin: Color(clair: 0xA67A28, sombre: 0xDDB466),
            .maison: Color(clair: 0x5B7882, sombre: 0x9AB5BC),
        ]
    )

    static let clarte = ProtoTheme(
        direction: .clarte,
        fond: Color(clair: 0xF2F2F6, sombre: 0x000000),
        surface: Color(clair: 0xFFFFFF, sombre: 0x1C1C1E),
        surface2: Color(clair: 0xEDEDF2, sombre: 0x2C2C2F),
        encre: Color(clair: 0x111114, sombre: 0xFFFFFF),
        encre2: Color(clair: 0x5F5F68, sombre: 0xA6A6B0),
        encre3: Color(clair: 0x8B8B94, sombre: 0x7D7D86),
        filet: Color(clair: 0xE2E2E8, sombre: 0x303034),
        signal: Color(clair: 0xFF5A1F, sombre: 0xFF6B2C),
        alerte: Color(clair: 0xE0443F, sombre: 0xFF6B66),
        ombre: Color(clair: 0x1A1A2E, sombre: 0x000000).opacity(0.08),
        rayon: 28,
        rayonControle: 26,
        categories: [
            .pro: Color(clair: 0x2F78F0, sombre: 0x5C9DFF),
            .musique: Color(clair: 0xA055DB, sombre: 0xC28EF5),
            .proches: Color(clair: 0xEE4F78, sombre: 0xFF7C9C),
            .sport: Color(clair: 0x22A85A, sombre: 0x4DD786),
            .admin: Color(clair: 0xE8901A, sombre: 0xFFB547),
            .maison: Color(clair: 0x1499B2, sombre: 0x4ACDE3),
        ]
    )
}

private struct ProtoThemeCle: EnvironmentKey {
    static let defaultValue = ProtoTheme.atelier
}

extension EnvironmentValues {
    var protoTheme: ProtoTheme {
        get { self[ProtoThemeCle.self] }
        set { self[ProtoThemeCle.self] = newValue }
    }
}

// MARK: - Surfaces

extension View {
    /// Carte : surface, bord fin (Atelier) ou presque invisible (Clarté), ombre
    /// portée seulement par la forme (le texte n'en a pas).
    func protoCarte(_ t: ProtoTheme, rayon: CGFloat? = nil) -> some View {
        let r = rayon ?? t.rayon
        return self
            .background {
                RoundedRectangle(cornerRadius: r, style: .continuous)
                    .fill(t.surface)
                    .shadow(color: t.ombre, radius: t.estAtelier ? 18 : 16, x: 0, y: t.estAtelier ? 8 : 6)
            }
            .overlay {
                RoundedRectangle(cornerRadius: r, style: .continuous)
                    .strokeBorder(t.filet.opacity(t.estAtelier ? 1 : 0.6), lineWidth: t.estAtelier ? 1 : 0.5)
            }
    }
}

/// Appui tactile : léger enfoncement, interruptible.
struct ProtoAppui: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.8), value: configuration.isPressed)
    }
}

// MARK: - Éléments partagés

/// La marque de Remy : le carré orange arrondi (Atelier) ou une pastille (Clarté).
struct ProtoRemyMarque: View {
    @Environment(\.protoTheme) private var t
    var taille: CGFloat = 28

    var body: some View {
        ZStack {
            if t.estAtelier {
                RoundedRectangle(cornerRadius: taille * 0.3, style: .continuous).fill(t.signal)
            } else {
                Circle().fill(t.signal)
            }
            Text("R")
                .font(.system(size: taille * 0.52, weight: .bold, design: t.estAtelier ? .serif : .rounded))
                .foregroundStyle(.white)
        }
        .frame(width: taille, height: taille)
        .accessibilityHidden(true)
    }
}

/// Titre de section.
struct ProtoTitreSection: View {
    @Environment(\.protoTheme) private var t
    let texte: String
    var compte: Int? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if t.estAtelier {
                Text(texte.uppercased(with: Locale(identifier: "fr_FR")))
                    .font(t.chiffres(12, .medium))
                    .tracking(1.6)
                    .foregroundStyle(t.encre2)
            } else {
                Text(texte)
                    .font(t.titre(21, .bold))
                    .foregroundStyle(t.encre)
            }
            if let compte {
                Text("\(compte)")
                    .font(t.chiffres(t.estAtelier ? 12 : 15, .medium))
                    .foregroundStyle(t.encre3)
            }
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// Titre d'écran : date ou rubrique au-dessus, grand titre dessous.
struct ProtoTitreEcran<Accessoire: View>: View {
    @Environment(\.protoTheme) private var t
    let titre: String
    var surTitre: String? = nil
    @ViewBuilder var accessoire: () -> Accessoire

    var body: some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: t.estAtelier ? 4 : 2) {
                if let surTitre {
                    if t.estAtelier {
                        Text(surTitre.uppercased(with: Locale(identifier: "fr_FR")))
                            .font(t.chiffres(12, .medium))
                            .tracking(1.6)
                            .foregroundStyle(t.signal)
                    } else {
                        Text(surTitre)
                            .font(t.texte(15, .semibold))
                            .foregroundStyle(t.encre2)
                    }
                }
                Text(titre)
                    .font(t.titre(34, t.estAtelier ? .semibold : .bold))
                    .foregroundStyle(t.encre)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 0)
            accessoire()
        }
        .padding(.horizontal, t.estAtelier ? 22 : 20)
        .padding(.top, 10)
    }
}

extension ProtoTitreEcran where Accessoire == EmptyView {
    init(titre: String, surTitre: String? = nil) {
        self.titre = titre
        self.surTitre = surTitre
        self.accessoire = { EmptyView() }
    }
}

/// Bouton rond d'en-tête (44 pt touchables).
struct ProtoBoutonRond: View {
    @Environment(\.protoTheme) private var t
    let symbole: String
    let libelle: String
    var action: () -> Void = {}

    var body: some View {
        Button(action: action) {
            Image(systemName: symbole)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(t.encre)
                .frame(width: 44, height: 44)
                .background(t.surface, in: Circle())
                .overlay(Circle().strokeBorder(t.filet, lineWidth: t.estAtelier ? 1 : 0.5))
        }
        .buttonStyle(ProtoAppui())
        .accessibilityLabel(libelle)
    }
}

/// Accès à la boîte « À voir avec Remy », avec sa pastille.
struct ProtoBoutonBoite: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        let n = etat.questionsOuvertes.count
        Button {
            Haptique.leger()
            etat.boiteOuverte = true
        } label: {
            Image(systemName: n > 0 ? "tray.full" : "tray")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(t.encre)
                .frame(width: 44, height: 44)
                .background(t.surface, in: Circle())
                .overlay(Circle().strokeBorder(t.filet, lineWidth: t.estAtelier ? 1 : 0.5))
                .overlay(alignment: .topTrailing) {
                    if n > 0 {
                        Text("\(n)")
                            .font(t.chiffres(11, .semibold))
                            .foregroundStyle(.white)
                            .frame(minWidth: 19, minHeight: 19)
                            .background(t.signal, in: Capsule())
                            .offset(x: 3, y: -3)
                    }
                }
        }
        .buttonStyle(ProtoAppui())
        .accessibilityLabel(n > 0 ? "À voir avec Remy, \(n) questions" : "À voir avec Remy")
    }
}

/// Un risque : signalé par une forme (triangle) et un mot, pas par la couleur
/// de catégorie.
struct ProtoRisque: View {
    @Environment(\.protoTheme) private var t
    let texte: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10, weight: .semibold))
            Text(texte).font(t.texte(12, .semibold))
        }
        .foregroundStyle(t.alerte)
    }
}

/// « En cours », avec un point qui respire (immobile si « Réduire les animations »).
struct ProtoEnCours: View {
    @Environment(\.protoTheme) private var t
    @Environment(\.accessibilityReduceMotion) private var reduire
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(t.signal)
                .frame(width: 7, height: 7)
                .opacity(pulse ? 0.35 : 1)
            if t.estAtelier {
                Text("EN COURS").font(t.chiffres(11, .semibold)).tracking(1.2)
            } else {
                Text("En cours").font(t.texte(13, .semibold))
            }
        }
        .foregroundStyle(t.signal)
        .onAppear {
            guard !reduire else { return }
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { pulse = true }
        }
    }
}

/// La barre de temps : elle représente le TEMPS écoulé sur le créneau, pas un
/// pourcentage de travail fait (spec §4.2).
struct ProtoBarreTemps: View {
    @Environment(\.protoTheme) private var t
    let progression: Double
    let couleur: Color
    var epaisseur: CGFloat = 8

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(t.surface2).frame(height: epaisseur)
                Capsule()
                    .fill(couleur)
                    .frame(width: max(epaisseur, g.size.width * min(max(progression, 0), 1)), height: epaisseur)
                Capsule()
                    .fill(t.signal)
                    .frame(width: 3, height: epaisseur + 8)
                    .offset(x: max(0, g.size.width * min(max(progression, 0), 1) - 1.5))
            }
        }
        .frame(height: epaisseur + 8)
        .accessibilityElement()
        .accessibilityLabel("Temps écoulé : \(Int(progression * 100)) pour cent du créneau")
    }
}

/// Puce de catégorie ou de projet.
struct ProtoPuce: View {
    @Environment(\.protoTheme) private var t
    let texte: String
    let couleur: Color

    var body: some View {
        if t.estAtelier {
            HStack(spacing: 7) {
                Circle().fill(couleur).frame(width: 8, height: 8)
                Text(texte).font(t.texte(13, .medium)).foregroundStyle(t.encre2)
            }
        } else {
            Text(texte)
                .font(t.texte(13, .semibold))
                .foregroundStyle(couleur)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(couleur.opacity(0.13), in: Capsule())
        }
    }
}

/// Bouton plein ou secondaire, à la forme de la direction.
struct ProtoBouton: View {
    @Environment(\.protoTheme) private var t
    let titre: String
    var symbole: String? = nil
    var principal = true
    var hauteur: CGFloat = 50
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if let symbole { Image(systemName: symbole).font(.system(size: 15, weight: .semibold)) }
                Text(ProtoTemps.insecable(titre))
            }
            .font(t.texte(16, .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .foregroundStyle(principal ? (t.estAtelier ? t.fond : Color.white) : t.encre)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: hauteur)
            .background(
                principal ? (t.estAtelier ? t.encre : t.signal) : t.surface2,
                in: RoundedRectangle(cornerRadius: t.estAtelier ? t.rayonControle : hauteur / 2, style: .continuous)
            )
        }
        .buttonStyle(ProtoAppui())
    }
}
