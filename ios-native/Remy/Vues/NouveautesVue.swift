import SwiftUI
import RemyCore

/// Le mini tutoriel d'une mise à jour (21/10) : quelques pages, une moitié
/// d'écran, « Plus tard » toujours à portée. Vu une fois, puis rangé dans
/// Réglages › Nouveautés, qui suit où tu en es (12/11).
struct NouveautesFeuille: View {
    let lot: LotNouveautes
    let fini: () -> Void
    /// La page affichée (0 : la première), dès l'ouverture : le suivi note
    /// « commencé » ou « suivi » (dernière page) ; « Plus tard » garde le reste.
    let pageVue: (Int) -> Void
    @State private var index: Int

    /// `lot.depart` : un tutoriel commencé reprend à sa page la plus loin.
    init(lot: LotNouveautes, fini: @escaping () -> Void, pageVue: @escaping (Int) -> Void = { _ in }) {
        self.lot = lot
        self.fini = fini
        self.pageVue = pageVue
        _index = State(initialValue: min(max(0, lot.depart), max(0, lot.pages.count - 1)))
    }

    var body: some View {
        let pages = lot.pages
        VStack(spacing: 0) {
            HStack {
                Text(pages.count > 1 ? "Nouveau · \(index + 1)/\(pages.count)" : "Nouveau")
                    .font(Police.mono(12))
                    .foregroundStyle(Palette.encre3)
                    .monospacedDigit()
                Spacer()
                Button("Plus tard") { fini() }
                    .font(Police.texte(15))
                    .foregroundStyle(Palette.encre2)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)

            TabView(selection: $index) {
                ForEach(Array(pages.enumerated()), id: \.offset) { i, p in
                    VStack(alignment: .leading, spacing: 14) {
                        Image(systemName: p.page.symbole)
                            .font(.system(size: 26, weight: .medium))
                            .foregroundStyle(Palette.fond)
                            .frame(width: 56, height: 56)
                            .background(Palette.signal, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .accessibilityHidden(true)
                        Text(p.nouveaute.titre.uppercased())
                            .font(Police.mono(11))
                            .foregroundStyle(Palette.encre3)
                        Text(p.page.titre)
                            .font(Police.texte(22, .semibold))
                            .foregroundStyle(Palette.encre)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(p.page.texte)
                            .font(Police.texte(16))
                            .foregroundStyle(Palette.encre2)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 24)
                    .padding(.top, 8)
                    .tag(i)
                }
            }
            // Le compteur « 1/5 » suffit : les points blancs se perdaient sur le fond clair.
            .tabViewStyle(.page(indexDisplayMode: .never))

            Button {
                Haptique.leger()
                if index < pages.count - 1 {
                    withAnimation(.easeOut(duration: 0.25)) { index += 1 }
                } else {
                    fini()
                }
            } label: {
                Text(index < pages.count - 1 ? "Suivant" : "C'est parti")
                    .font(Police.texte(17, .semibold))
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .tint(Palette.encre)
            .foregroundStyle(Palette.fond)
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
        .background(Palette.fond)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .onAppear { pageVue(index) }
        .onChange(of: index) { _, i in pageVue(i) }
    }
}

/// Réglages › Nouveautés, le suivi (12/11) : « 3 à découvrir · 1 commencé ·
/// 22 suivis », puis chaque tutoriel rangé par état (à découvrir d'abord),
/// son état en mots et sa date. Toucher l'ouvre — un commencé reprend à sa
/// page. « Tout marquer comme suivi », avec « Annuler ».
struct NouveautesListe: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var revu: LotNouveautes?

    var body: some View {
        let m = app.nouveautes
        NavigationStack {
            List {
                Section {
                    Text(m.resume)
                        .font(Police.texte(16, .semibold))
                        .foregroundStyle(Palette.encre)
                        .frame(minHeight: 44, alignment: .leading)
                        .accessibilityLabel(m.resume.replacingOccurrences(of: " · ", with: ", "))
                        .accessibilityIdentifier("nouveautes.resume")
                    if !m.aMarquer.isEmpty {
                        Button {
                            Haptique.leger()
                            m.toutMarquerSuivi()
                        } label: {
                            Label("Tout marquer comme suivi", systemImage: "checkmark.circle")
                                .font(Police.texte(15, .medium))
                                .foregroundStyle(Palette.encre)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Range tout ce qui reste ; « Annuler » ensuite pour revenir en arrière")
                    }
                } footer: {
                    Text("Gardé sur cet iPhone. À l'ouverture de l'app, Rémy ne présente que les tutoriels des deux dernières mises à jour ; les autres t'attendent ici.")
                        .font(Police.texte(12))
                }
                ForEach(m.groupes) { g in
                    Section {
                        ForEach(g.entrees) { n in ligne(n, m) }
                    } header: {
                        Text("\(g.titre) (\(g.entrees.count))")
                    }
                }
            }
            .navigationTitle("Nouveautés")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK") { fermer() } } }
            .overlay(alignment: .bottom) { ToastView(marge: 24, annoncer: false) }
            .sheet(item: $revu) { lot in
                NouveautesFeuille(lot: lot, fini: { revu = nil }, pageVue: { m.noter(lot, page: $0) })
            }
        }
    }

    private func ligne(_ n: Nouveaute, _ m: NouveautesModel) -> some View {
        let etat = m.etat(n)
        let libelle = m.libelle(n)
        return Button {
            Haptique.leger()
            revu = m.lot(pour: n)
        } label: {
            HStack(spacing: 14) {
                Image(systemName: n.pages.first?.symbole ?? "sparkles")
                    .font(.system(size: 17))
                    .foregroundStyle(Palette.encre)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(n.titre).font(Police.texte(16, .medium)).foregroundStyle(Palette.encre)
                    Text(libelle)
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                // La forme dit l'état (vide, à moitié, coché), pas la couleur seule.
                Image(systemName: etat.symbole)
                    .font(.system(size: 20))
                    .foregroundStyle(etat == .aDecouvrir ? Palette.signal : Palette.encre2)
            }
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(n.titre). \(libelle)")
        .accessibilityHint(m.indice(n))
    }
}
