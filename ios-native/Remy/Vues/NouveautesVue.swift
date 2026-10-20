import SwiftUI
import RemyCore

/// Le mini tutoriel d'une mise à jour (21/10) : quelques pages, une moitié
/// d'écran, « Plus tard » toujours à portée. Vu une fois, puis rangé dans
/// Réglages › Nouveautés.
struct NouveautesFeuille: View {
    let lot: LotNouveautes
    let fini: () -> Void
    @State private var index = 0

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
            .tabViewStyle(.page(indexDisplayMode: pages.count > 1 ? .always : .never))
            .indexViewStyle(.page(backgroundDisplayMode: .interactive))

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
    }
}

/// Réglages › Nouveautés : chaque mise à jour et son tutoriel, à revoir.
struct NouveautesListe: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var revu: LotNouveautes?

    var body: some View {
        let m = app.nouveautes
        NavigationStack {
            List {
                ForEach(m.historique) { n in
                    Button {
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
                                Text(m.existe(n) ? n.date : "\(n.date) · arrive avec la mise à jour de ta tour")
                                    .font(Police.texte(13))
                                    .foregroundStyle(Palette.encre2)
                            }
                            Spacer(minLength: 8)
                            if m.estNouvelle(n) {
                                Text("Nouveau")
                                    .font(Police.mono(11))
                                    .foregroundStyle(Palette.fond)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(Palette.signal, in: Capsule())
                            }
                        }
                        .frame(minHeight: 48)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .navigationTitle("Nouveautés")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK") { fermer() } } }
            .sheet(item: $revu) { lot in
                NouveautesFeuille(lot: lot) { revu = nil }
                    .onDisappear { m.marquerVues(lot) }
            }
        }
    }
}
