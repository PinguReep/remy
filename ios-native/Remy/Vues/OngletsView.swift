import SwiftUI
import UIKit
import RemyCore

/// Deux onglets : « Aujourd'hui » (l'accueil) et « Rémy » (la conversation).
/// La barre est dessinée à la main, comme sur le site, et reste visible
/// clavier ouvert : il y a toujours une sortie.
struct OngletsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scene

    var body: some View {
        @Bindable var app = app
        VStack(spacing: 0) {
            ZStack {
                AujourdhuiView()
                    .opacity(app.onglet == .aujourdhui ? 1 : 0)
                    .allowsHitTesting(app.onglet == .aujourdhui)
                    .accessibilityHidden(app.onglet != .aujourdhui)
                RemyView()
                    .opacity(app.onglet == .remy ? 1 : 0)
                    .allowsHitTesting(app.onglet == .remy)
                    .accessibilityHidden(app.onglet != .remy)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            BarreOnglets()
        }
        .sheet(isPresented: $app.reglagesOuverts) { ReglagesView() }
        // Signe de vie tant que l'app est au premier plan : c'est la mesure
        // d'activité (le temps passé devant Rémy, pas le temps où il existe).
        .task(id: scene) {
            guard scene == .active else { return }
            // De retour au premier plan : la journée a pu changer (et le jour aussi).
            if app.tableau.misAJour.map({ Date().timeIntervalSince($0) > 60 }) ?? true {
                await app.chargerTout()
            }
            while !Task.isCancelled {
                await app.api.signeDeVie()
                try? await Task.sleep(nanoseconds: 60_000_000_000)
            }
        }
    }
}

struct BarreOnglets: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Palette.encre).frame(height: 1)
            HStack(spacing: 0) {
                onglet(.aujourdhui, "Aujourd'hui", "calendar")
                onglet(.remy, "Rémy", "bubble.left")
            }
        }
        .background(Palette.fond.ignoresSafeArea(edges: .bottom))
    }

    private func onglet(_ o: AppModel.Onglet, _ titre: String, _ symbole: String) -> some View {
        let actif = app.onglet == o
        return Button {
            // Quitter Rémy range le clavier : il masquerait « Aujourd'hui ».
            if o != .remy {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
            app.onglet = o
        } label: {
            VStack(spacing: 4) {
                Image(systemName: symbole)
                    .font(.system(size: 20, weight: actif ? .semibold : .regular))
                    .frame(height: 24)
                Text(titre).font(Police.texte(12, actif ? .semibold : .medium))
            }
            .foregroundStyle(actif ? Palette.encre : Palette.encre3)
            .frame(maxWidth: .infinity, minHeight: 56)
            .overlay(alignment: .top) {
                if actif { Rectangle().fill(Palette.signal).frame(width: 44, height: 3) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(titre)
        .accessibilityAddTraits(actif ? .isSelected : [])
    }
}
