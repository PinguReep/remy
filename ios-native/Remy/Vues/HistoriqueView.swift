import SwiftUI
import RemyCore

/// L'historique des actions (retours TestFlight 13) : le journal fiable du
/// Lot 0 relu pour un humain — quand, quoi, qui (toi, Rémy, une capture…),
/// avant → après, et « Annuler » tant que c'est possible.
struct HistoriqueView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var aAnnuler: EntreeHistorique?

    var body: some View {
        let h = app.historique
        NavigationStack {
            List {
                if h.paginable {
                    // Filtres (24/10) : les vraies pannes, les annulations, les doublons évités.
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(FiltreHistorique.allCases) { f in
                                Button {
                                    Haptique.leger()
                                    Task { await h.filtrer(f) }
                                } label: {
                                    Text(f.titre)
                                        .font(Police.texte(14, .semibold))
                                        .foregroundStyle(h.filtre == f ? Palette.surface : Palette.encre)
                                        .padding(.horizontal, 14)
                                        .frame(minHeight: 44)
                                        .background(h.filtre == f ? Palette.encre : Palette.fond2, in: Capsule())
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(h.filtre == f ? .isSelected : [])
                            }
                        }
                    }
                    .listRowSeparator(.hidden)
                }
                if h.entrees.isEmpty {
                    if h.chargement {
                        HStack(spacing: 12) { ProgressView(); Text("Lecture du journal…").foregroundStyle(Palette.encre2) }.frame(minHeight: 44)
                    } else if let e = h.erreur {
                        Text(e).foregroundStyle(Palette.danger)
                        Button("Réessayer") { Task { await h.charger() } }.frame(minHeight: 44)
                    } else if h.filtre != .tout {
                        Text("Rien dans « \(h.filtre.titre) ».").foregroundStyle(Palette.encre2)
                    } else {
                        Text("Rien encore : chaque geste qui change Motion ou ton agenda s'inscrira ici.").foregroundStyle(Palette.encre2)
                    }
                }
                ForEach(groupes(h.entrees)) { g in
                    Section(g.id) {
                        ForEach(g.entrees) { e in ligne(e) }
                    }
                }
                if h.suite != nil {
                    // Au-delà des 80 dernières : on remonte page par page.
                    Button {
                        Task { await h.plusAncien() }
                    } label: {
                        HStack(spacing: 8) {
                            if h.chargementSuite { ProgressView().controlSize(.small) }
                            Text(h.chargementSuite ? "Lecture…" : "Plus ancien")
                        }
                        .font(Police.texte(15, .semibold))
                        .foregroundStyle(Palette.signal)
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .disabled(h.chargementSuite)
                }
            }
            .listeAtelier()
            .navigationTitle("Historique")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fermer") { fermer() } } }
            .refreshable { await h.charger() }
            .task { await h.charger() }
            .confirmationDialog("Annuler cette action ?", isPresented: Binding(get: { aAnnuler != nil }, set: { if !$0 { aAnnuler = nil } }),
                                titleVisibility: .visible, presenting: aAnnuler) { e in
                Button("Annuler l'action") { Task { await h.annuler(e) } }
                Button("Garder", role: .cancel) {}
            } message: { e in
                Text("Rémy remet \(e.source == "agenda" ? "ton agenda" : "Motion") comme avant, si personne n'y a touché depuis.")
            }
        }
        .overlay(alignment: .bottom) { ToastView(marge: 12, annoncer: false) }
    }

    private struct Jour: Identifiable {
        let id: String
        var entrees: [EntreeHistorique]
    }

    private func groupes(_ entrees: [EntreeHistorique]) -> [Jour] {
        var jours: [Jour] = []
        for e in entrees {
            let j = Format.jourLong(e.ts.date).capitalized
            if jours.last?.id == j { jours[jours.count - 1].entrees.append(e) } else { jours.append(Jour(id: j, entrees: [e])) }
        }
        return jours
    }

    private func ligne(_ e: EntreeHistorique) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(Format.heure(e.ts)).font(Police.mono(13, .medium)).foregroundStyle(Palette.encre)
                Text(e.origine).font(Police.texte(13)).foregroundStyle(Palette.encre2).lineLimit(1)
                Spacer()
                Image(systemName: e.source == "agenda" ? "calendar" : "checklist").font(.system(size: 12)).foregroundStyle(Palette.encre3)
            }
            ForEach(Array(e.elements.enumerated()), id: \.offset) { _, x in
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(x.action) · « \(x.objet) »")
                        .font(Police.texte(15, .medium))
                        .foregroundStyle(x.erreur != nil ? Palette.danger : x.action == "Déjà là" ? Palette.encre2 : Palette.encre)
                        .strikethrough(e.annule == true)
                        .fixedSize(horizontal: false, vertical: true)
                    ForEach(x.changements ?? [], id: \.self) { c in
                        Text(c).font(Police.mono(12)).foregroundStyle(Palette.encre2)
                    }
                    if let er = x.erreur { Text(er).font(Police.texte(12)).foregroundStyle(Palette.encre2) }
                }
            }
            if e.annule == true {
                Text("Annulée").font(Police.texte(12, .semibold)).foregroundStyle(Palette.encre3)
            } else if e.annulable == true {
                Button {
                    Haptique.leger()
                    aAnnuler = e
                } label: {
                    HStack(spacing: 6) {
                        if app.historique.annulations.contains(e.id) { ProgressView().controlSize(.mini) }
                        Text("Annuler")
                    }
                    .font(Police.texte(14, .semibold))
                    .foregroundStyle(Palette.signal)
                    .frame(minHeight: 36)
                }
                .buttonStyle(.plain)
                .disabled(app.historique.annulations.contains(e.id))
            }
        }
        .padding(.vertical, 4)
    }
}
