import SwiftUI

// La racine d'un prototype : trois onglets, le « + » toujours à portée de
// pouce, les panneaux superposés et le message d'annulation.

struct ProtoRacine: View {
    @State private var modele: ProtoEtat
    var quitter: (() -> Void)? = nil

    init(etat: ProtoEtat, quitter: (() -> Void)? = nil) {
        _modele = State(initialValue: etat)
        self.quitter = quitter
    }

    var body: some View {
        @Bindable var etat = modele
        let t = etat.direction == .atelier ? ProtoTheme.atelier : ProtoTheme.clarte
        ZStack(alignment: .bottom) {
            t.fond.ignoresSafeArea()
            ProtoContenuOnglets()
            if etat.direction == .atelier { ProtoBarreA() } else { ProtoBarreB() }
        }
        .overlay {
            ZStack {
                if let id = etat.gererId, let b = etat.bloc(id) {
                    ProtoSurimpression(fermer: { etat.fermerPanneaux() }) { ProtoGerer(bloc: b) }
                        .transition(.opacity)
                        .zIndex(1)
                }
                if etat.planningEtendu {
                    ProtoSurimpression(fermer: { etat.fermerPanneaux() }, depuisLeBas: false) { ProtoPlanningEtendu() }
                        .transition(.opacity)
                        .zIndex(2)
                }
            }
        }
        .overlay(alignment: .bottom) {
            ProtoToastVue()
                .padding(.bottom, etat.direction == .atelier ? 96 : 90)
                .animation(.spring(response: 0.38, dampingFraction: 0.86), value: etat.toast?.id)
        }
        // Ouvert depuis Réglages : un bandeau réservé en haut, pour ne rien
        // masquer de l'en-tête que l'on est justement venu juger.
        .safeAreaInset(edge: .top, spacing: 0) {
            if etat.dansGalerie, let quitter {
                HStack {
                    Text("Prototype \(etat.direction.rawValue) — \(etat.direction.nom) · \(etat.nav.titre)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(t.encre2)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Button("Quitter", action: quitter)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(t.signal)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .padding(.horizontal, 16)
                .background(t.fond)
            }
        }
        .overlay(alignment: .top) {
            ProtoLegende()
                .animation(.easeOut(duration: 0.25), value: etat.legende)
        }
        .sheet(isPresented: $etat.captureOuverte) {
            ProtoCapture().environment(etat).environment(\.protoTheme, t)
        }
        .sheet(isPresented: $etat.boiteOuverte) {
            ProtoBoite().environment(etat).environment(\.protoTheme, t)
        }
        .environment(etat)
        .environment(\.protoTheme, t)
        .task {
            if etat.enDemo { await etat.jouerDemo() }
        }
    }
}

/// Les trois onglets restent en vie : on retrouve son défilement en revenant.
struct ProtoContenuOnglets: View {
    @Environment(ProtoEtat.self) private var etat

    var body: some View {
        ZStack {
            Group {
                if etat.direction == .atelier { ProtoAccueilA() } else { ProtoAccueilB() }
            }
            .opacity(etat.onglet == .aujourdhui ? 1 : 0)
            .allowsHitTesting(etat.onglet == .aujourdhui)
            .accessibilityHidden(etat.onglet != .aujourdhui)
            ProtoRemyEcran()
                .opacity(etat.onglet == .remy ? 1 : 0)
                .allowsHitTesting(etat.onglet == .remy)
                .accessibilityHidden(etat.onglet != .remy)
            Group {
                if etat.nav == .carnet { ProtoCarnet() } else { ProtoProjets() }
            }
            .opacity(etat.onglet == .tiers ? 1 : 0)
            .allowsHitTesting(etat.onglet == .tiers)
            .accessibilityHidden(etat.onglet != .tiers)
        }
    }
}

// MARK: - Barre A (Atelier) : barre pleine, « + » posé sur son bord

struct ProtoBarreA: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        // Le « + » est en surimpression : la barre seule fixe la mise en page et
        // touche le bas de la zone sûre, sinon son fond ne descend pas jusqu'au bord.
        HStack(spacing: 0) {
            onglet(.aujourdhui, "Aujourd'hui", "sun.max")
            onglet(.remy, "Remy", "bubble.left")
            onglet(.tiers, etat.nav.titre, etat.nav.symbole)
            Color.clear.frame(width: 92, height: 1)
        }
        .padding(.top, 6)
        .background(t.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(t.filet).frame(height: 1) }
        .overlay(alignment: .topTrailing) {
            Button { etat.ouvrirCapture() } label: {
                Image(systemName: "plus")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 62, height: 62)
                    .background(t.signal, in: Circle())
                    .overlay(Circle().strokeBorder(t.surface, lineWidth: 4))
                    .shadow(color: t.signal.opacity(0.35), radius: 10, x: 0, y: 5)
            }
            .buttonStyle(ProtoAppui())
            .padding(.trailing, 18)
            .offset(y: -24)
            .accessibilityLabel("Noter quelque chose")
        }
    }

    private func onglet(_ o: ProtoOnglet, _ titre: String, _ symbole: String) -> some View {
        let actif = etat.onglet == o
        return Button {
            Haptique.leger()
            withAnimation(.snappy) { etat.onglet = o }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: actif ? symbole + ".fill" : symbole)
                    .font(.system(size: 19, weight: actif ? .semibold : .regular))
                    .frame(height: 24)
                Text(titre).font(t.texte(11, actif ? .semibold : .medium))
            }
            .foregroundStyle(actif ? t.encre : t.encre3)
            .frame(maxWidth: .infinity, minHeight: 52)
            .overlay(alignment: .top) {
                if actif {
                    Capsule().fill(t.signal).frame(width: 22, height: 3).offset(y: -6)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(titre)
        .accessibilityAddTraits(actif ? .isSelected : [])
    }
}

// MARK: - Barre B (Clarté) : capsule flottante, « + » à côté

struct ProtoBarreB: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t
    @Namespace private var espace

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 0) {
                onglet(.aujourdhui, "Aujourd'hui", "sun.max")
                onglet(.remy, "Remy", "bubble.left")
                onglet(.tiers, etat.nav.titre, etat.nav.symbole)
            }
            .padding(5)
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(t.filet.opacity(0.8), lineWidth: 0.5))
            .shadow(color: Color.black.opacity(0.12), radius: 18, x: 0, y: 8)
            Button { etat.ouvrirCapture() } label: {
                Image(systemName: "plus")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 64, height: 64)
                    .background(t.signal, in: Circle())
                    .shadow(color: t.signal.opacity(0.4), radius: 14, x: 0, y: 6)
            }
            .buttonStyle(ProtoAppui())
            .accessibilityLabel("Noter quelque chose")
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 2)
    }

    private func onglet(_ o: ProtoOnglet, _ titre: String, _ symbole: String) -> some View {
        let actif = etat.onglet == o
        return Button {
            Haptique.leger()
            withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) { etat.onglet = o }
        } label: {
            VStack(spacing: 2) {
                Image(systemName: actif ? symbole + ".fill" : symbole)
                    .font(.system(size: 18, weight: actif ? .semibold : .regular))
                    .frame(height: 22)
                Text(titre).font(t.texte(11, .semibold)).lineLimit(1)
            }
            .foregroundStyle(actif ? t.signal : t.encre2)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background {
                if actif {
                    Capsule().fill(t.encre.opacity(0.07)).matchedGeometryEffect(id: "pastille", in: espace)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(titre)
        .accessibilityAddTraits(actif ? .isSelected : [])
    }
}

// MARK: - Galerie (Réglages → Prototypes de design)

struct ProtoGalerie: View {
    @Environment(\.dismiss) private var fermer
    @State private var ouvert: ProtoEtat?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Deux directions visuelles et deux navigations, sur des données fictives : rien ne touche à ta vraie journée, à Motion ni à ton agenda.")
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                }
                Section("À essayer") {
                    ForEach(Self.essais, id: \.self) { e in
                        Text(e).font(.system(size: 15))
                    }
                }
                ForEach(ProtoDirection.allCases) { d in
                    Section("\(d.rawValue) — \(d.nom)") {
                        ForEach(ProtoNav.allCases) { n in
                            Button("Aujourd'hui · Remy · \(n.titre)") { ouvrir(d, n, demo: false) }
                        }
                        Button("Démo animée") { ouvrir(d, d == .atelier ? .carnet : .projets, demo: true) }
                    }
                }
            }
            .navigationTitle("Prototypes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fermer") { fermer() } }
            }
        }
        .fullScreenCover(item: $ouvert) { e in
            ProtoRacine(etat: e) { ouvert = nil }
        }
    }

    private static let essais = [
        "Gérer → +15 min : l'impact sur le déjeuner protégé",
        "Appui long sur la suite de la journée : la journée à l'échelle",
        "Terminer, puis Annuler",
        "« + » depuis n'importe quel onglet : « tomates, lait, œufs »",
        "La boîte en haut à droite : répondre à une question",
        "Le 3ᵉ onglet : Carnet ou Projets",
    ]

    private func ouvrir(_ d: ProtoDirection, _ n: ProtoNav, demo: Bool) {
        let e = ProtoEtat(direction: d, nav: n)
        e.dansGalerie = true
        e.enDemo = demo
        ouvert = e
    }
}
