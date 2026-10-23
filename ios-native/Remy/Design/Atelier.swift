import SwiftUI

// Les éléments de la direction A « Atelier » (Lot 1), repris des prototypes de
// J1.1 et branchés sur la vraie Palette.

extension View {
    /// Carte : surface papier, bord fin, ombre chaude portée par la forme seule.
    func carte(rayon: CGFloat = 22) -> some View {
        background {
            RoundedRectangle(cornerRadius: rayon, style: .continuous)
                .fill(Palette.surface)
                .shadow(color: Palette.ombre, radius: 18, x: 0, y: 8)
        }
        .overlay {
            RoundedRectangle(cornerRadius: rayon, style: .continuous)
                .strokeBorder(Palette.filet, lineWidth: 1)
        }
    }

    /// Une liste groupée sur le fond de l'Atelier plutôt que le gris système.
    func listeAtelier() -> some View {
        scrollContentBackground(.hidden).background(Palette.fond)
    }
}

/// Des puces qui passent à la ligne (étiquettes) : aucune n'est cachée hors
/// de l'écran, contrairement à une rangée qui défile.
struct Flux: Layout {
    var espacement: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let largeur = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, ligne: CGFloat = 0, plusLarge: CGFloat = 0
        for s in subviews {
            let t = s.sizeThatFits(.unspecified)
            if x > 0 && x + t.width > largeur {
                x = 0
                y += ligne + espacement
                ligne = 0
            }
            x += t.width + espacement
            plusLarge = max(plusLarge, x - espacement)
            ligne = max(ligne, t.height)
        }
        return CGSize(width: proposal.width ?? plusLarge, height: y + ligne)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, ligne: CGFloat = 0
        for s in subviews {
            let t = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + t.width > bounds.maxX {
                x = bounds.minX
                y += ligne + espacement
                ligne = 0
            }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(t))
            x += t.width + espacement
            ligne = max(ligne, t.height)
        }
    }
}

/// Appui tactile : léger enfoncement, interruptible.
struct Appui: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.8), value: configuration.isPressed)
    }
}

/// Toucher : une action ; appui court (200 ms par défaut, réglable dans les
/// Réglages) : une autre. Le toucher est déclaré avant l'appui : c'est ce qui
/// laisse le défilement libre dans une ScrollView. Un glissé de plus de 10 pt
/// annule l'appui (on fait défiler, on n'agrandit pas).
struct ToucherOuAppui: ViewModifier {
    @AppStorage(Gestes.cleAppui) private var ms = Gestes.appuiParDefaut
    let toucher: () -> Void
    let appui: () -> Void
    /// nil : la durée réglée pour le planning.
    var duree: Double? = nil
    @State private var presse = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(presse ? 0.985 : 1)
            .opacity(presse ? 0.8 : 1)
            .animation(.easeOut(duration: 0.12), value: presse)
            .onTapGesture { toucher() }
            .onLongPressGesture(minimumDuration: duree ?? Double(ms) / 1000, maximumDistance: 10) {
                Haptique.leger()
                appui()
            } onPressingChanged: { presse = $0 }
    }
}

enum Gestes {
    static let cleAppui = "appuiPlanningMs"
    /// Sam, 15/10 : « environ 200 ms, 250 si ça déclenche par accident ».
    static let appuiParDefaut = 200
    static let choix = [200, 250, 300]
}

/// Titre de section : mono, capitales, espacé (« LA SUITE »).
struct TitreSection: View {
    let texte: String
    var compte: Int? = nil
    var couleur: Color = Palette.encre2

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(texte.uppercased(with: Locale(identifier: "fr_FR")))
                .font(Police.mono(12, .medium))
                .tracking(1.6)
                .foregroundStyle(couleur)
            if let compte {
                Text("\(compte)").font(Police.mono(12, .medium)).foregroundStyle(Palette.encre3)
            }
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// Titre d'écran : sur-titre orange en capitales mono, grand titre en serif.
struct TitreEcran<Accessoire: View>: View {
    let titre: String
    var surTitre: String? = nil
    @ViewBuilder var accessoire: () -> Accessoire

    var body: some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                if let surTitre {
                    Text(surTitre.uppercased(with: Locale(identifier: "fr_FR")))
                        .font(Police.mono(12, .medium))
                        .tracking(1.6)
                        .foregroundStyle(Palette.signal)
                }
                Text(titre)
                    .font(Police.titre(34))
                    .foregroundStyle(Palette.encre)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 0)
            accessoire()
        }
        .padding(.horizontal, 22)
        .padding(.top, 10)
    }
}

extension TitreEcran where Accessoire == EmptyView {
    init(titre: String, surTitre: String? = nil) {
        self.titre = titre
        self.surTitre = surTitre
        self.accessoire = { EmptyView() }
    }
}

/// Bouton rond d'en-tête (44 pt touchables), avec une pastille facultative.
struct BoutonRond: View {
    let symbole: String
    let libelle: String
    var pastille: Int = 0
    /// Rouge : une notification (réponse non vue) ; sinon l'orange de la marque.
    var pastilleRouge = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbole)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Palette.encre)
                .frame(width: 44, height: 44)
                .background(Palette.surface, in: Circle())
                .overlay(Circle().strokeBorder(Palette.filet, lineWidth: 1))
                .overlay(alignment: .topTrailing) {
                    if pastille > 0 {
                        Text("\(pastille)")
                            .font(Police.mono(11, .semibold))
                            .foregroundStyle(.white)
                            .frame(minWidth: 19, minHeight: 19)
                            .background(pastilleRouge ? Color.red : Palette.signal, in: Capsule())
                            .offset(x: 3, y: -3)
                    }
                }
        }
        .buttonStyle(Appui())
        .accessibilityLabel(pastille > 0 ? "\(libelle), \(pastille)" : libelle)
    }
}

/// Bouton plein (encre) ou secondaire (papier).
struct BoutonA: View {
    let titre: String
    var symbole: String? = nil
    var principal = true
    var hauteur: CGFloat = 50
    let action: () -> Void
    @Environment(\.isEnabled) private var actif

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if let symbole { Image(systemName: symbole).font(.system(size: 15, weight: .semibold)) }
                Text(titre)
            }
            .font(Police.texte(16, .semibold))
            // Deux lignes plutôt qu'un libellé tronqué (« Commencer « Prépa… »).
            .lineLimit(2)
            .multilineTextAlignment(.center)
            .minimumScaleFactor(0.85)
            .foregroundStyle(principal ? Palette.fond : Palette.encre)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: hauteur)
            .background(principal ? Palette.encre : Palette.fond2,
                        in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .opacity(actif ? 1 : 0.45)
            .contentShape(Rectangle())
        }
        .buttonStyle(Appui())
    }
}

/// La marque de Rémy : un « R » en serif sur le carré orange arrondi.
struct MarqueRemy: View {
    var taille: CGFloat = 32

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: taille * 0.3, style: .continuous).fill(Palette.signal)
            Text("R")
                .font(.system(size: taille * 0.54, weight: .bold, design: .serif))
                .foregroundStyle(.white)
        }
        .frame(width: taille, height: taille)
        .accessibilityHidden(true)
    }
}

/// La barre de temps : elle représente le TEMPS écoulé sur le créneau, pas un
/// pourcentage de travail fait (spec §4.2).
struct BarreTemps: View {
    let progression: Double
    var couleur: Color = Palette.encre2
    var epaisseur: CGFloat = 8

    var body: some View {
        let p = min(max(progression, 0), 1)
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.fond2).frame(height: epaisseur)
                Capsule().fill(couleur).frame(width: max(epaisseur, g.size.width * p), height: epaisseur)
                Capsule().fill(Palette.signal).frame(width: 3, height: epaisseur + 8)
                    .offset(x: max(0, g.size.width * p - 1.5))
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: epaisseur + 8)
        .accessibilityElement()
        .accessibilityLabel("Temps écoulé : \(Int(p * 100)) pour cent du créneau")
    }
}

/// Projet ou catégorie : un point de couleur et son nom.
struct Puce: View {
    let texte: String
    let couleur: Color

    var body: some View {
        HStack(spacing: 7) {
            Circle().fill(couleur).frame(width: 8, height: 8)
            Text(texte).font(Police.texte(13, .medium)).foregroundStyle(Palette.encre2).lineLimit(1)
        }
    }
}

/// « EN COURS », avec un point qui respire (immobile si « Réduire les animations »).
struct MarqueEnCours: View {
    @Environment(\.accessibilityReduceMotion) private var reduire
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(Palette.signal).frame(width: 7, height: 7).opacity(pulse ? 0.35 : 1)
            Text("EN COURS").font(Police.mono(11, .semibold)).tracking(1.2)
        }
        .foregroundStyle(Palette.signal)
        .onAppear {
            guard !reduire else { return }
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { pulse = true }
        }
    }
}

/// Un risque : signalé par une forme (triangle) et un mot, pas par une couleur
/// de projet.
struct Risque: View {
    let texte: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10, weight: .semibold))
            Text(texte).font(Police.texte(12, .semibold))
        }
        .foregroundStyle(Palette.danger)
    }
}

/// Panneau superposé (spec §4.4) : fond flouté, bords visibles, fermeture en
/// touchant à l'extérieur. `depuisLeBas` : une feuille d'actions, qui se ferme
/// aussi en la glissant vers le bas (sa poignée n'est plus factice, 24/10) et
/// par « Fermer » en haut à droite ; sinon une carte presque plein écran (la
/// journée à l'échelle). Modal pour VoiceOver : il ne sort pas vers l'accueil.
struct Surimpression<Contenu: View>: View {
    let fermer: () -> Void
    var depuisLeBas = true
    @ViewBuilder let contenu: () -> Contenu
    @State private var visible = false
    @State private var glisse: CGFloat = 0
    /// La hauteur du panneau : au-delà de l'écran (petit iPhone, grand
    /// texte), il défile au lieu d'être coupé.
    @State private var hauteur: CGFloat = 0

    var body: some View {
        if depuisLeBas { feuille } else { carteCentree }
    }

    private var fond: some View {
        Rectangle()
            .fill(.ultraThinMaterial)
            .overlay(Color.black.opacity(0.12))
            .ignoresSafeArea()
            .onTapGesture { fermer() }
            .accessibilityHidden(true)
    }

    private var feuille: some View {
        GeometryReader { geo in
            let dispo = max(240, geo.size.height - 8)
            let defile = hauteur > dispo
            ZStack(alignment: .bottom) {
                fond
                ScrollView {
                    contenu()
                        .overlay(alignment: .topTrailing) { BoutonFermer(action: fermer).padding(8) }
                        .background(GeometryReader { g in Color.clear.preference(key: HauteurPanneau.self, value: g.size.height) })
                }
                .scrollDisabled(!defile)
                .scrollClipDisabled()
                .frame(height: hauteur > 0 ? min(hauteur, dispo) : nil)
                .padding(.horizontal, 10)
                .padding(.bottom, 8)
                .offset(y: (visible ? 0 : 60) + glisse)
                .opacity(visible ? 1 : 0)
                // Glisser pour fermer, tant que le panneau ne défile pas.
                .simultaneousGesture(defile ? nil : glisser)
                .accessibilityAddTraits(.isModal)
            }
        }
        .onPreferenceChange(HauteurPanneau.self) { hauteur = $0 }
        .onAppear { withAnimation(.spring(response: 0.38, dampingFraction: 0.86)) { visible = true } }
        .accessibilityAction(.escape) { fermer() }
    }

    private var carteCentree: some View {
        ZStack {
            fond
            contenu()
                .padding(.horizontal, 12)
                .offset(y: visible ? 0 : 24)
                .scaleEffect(visible ? 1 : 0.97)
                .opacity(visible ? 1 : 0)
                .accessibilityAddTraits(.isModal)
        }
        .onAppear { withAnimation(.spring(response: 0.38, dampingFraction: 0.86)) { visible = true } }
        .accessibilityAction(.escape) { fermer() }
    }

    /// Vers le bas seulement ; au-delà de 110 pt (ou d'un geste vif), fermé.
    private var glisser: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { g in glisse = max(0, g.translation.height) }
            .onEnded { g in
                if g.translation.height > 110 || g.predictedEndTranslation.height > 260 {
                    Haptique.leger()
                    fermer()
                } else {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { glisse = 0 }
                }
            }
    }
}

private struct HauteurPanneau: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// « Fermer » : toujours en haut à droite, la même croix partout (24/10).
struct BoutonFermer: View {
    let action: () -> Void

    var body: some View {
        Button {
            Haptique.leger()
            action()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Palette.encre2)
                .frame(width: 30, height: 30)
                .background(Palette.fond2, in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Fermer")
    }
}
