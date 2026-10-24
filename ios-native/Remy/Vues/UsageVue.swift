import SwiftUI
import RemyCore

/// « Ce que tu utilises vraiment » (Réglages, 24/10) : les gestes des 30
/// derniers jours, comptés sur cet iPhone, sans aucun contenu. Sert à décider
/// quoi garder et quoi retirer — rien ne part, pas même vers la tour.
struct UsageVue: View {
    @State private var resume = ResumeUsage.de(CompteursUsage.partages)
    @State private var confirmer = false

    var body: some View {
        List {
            Section {
                if resume.gestes.isEmpty {
                    Text("Aucun geste compté pour l'instant. Coche une tâche, parle à Rémy, note quelque chose : ça apparaîtra ici.")
                        .foregroundStyle(Palette.encre2)
                } else {
                    ForEach(resume.gestes) { l in ligne(l.fonction.libelle, l.nombre) }
                }
            } header: {
                Text("Tes gestes, \(resume.jours) derniers jours")
            } footer: {
                if !resume.assez && !resume.gestes.isEmpty {
                    Text("Encore peu de gestes : attends quelques jours avant d'en tirer une conclusion.")
                }
            }
            if !resume.vues.isEmpty {
                Section("Ce que tu regardes") {
                    ForEach(resume.vues) { l in ligne(l.fonction.libelle, l.nombre) }
                }
            }
            if resume.assez && !resume.jamais.isEmpty {
                Section {
                    ForEach(resume.jamais, id: \.self) { f in
                        Text(f.libelle).foregroundStyle(Palette.encre2)
                    }
                } header: {
                    Text("Jamais touché")
                } footer: {
                    Text(depuis)
                }
            }
            Section {
                Button(role: .destructive) { confirmer = true } label: {
                    Text("Remettre les compteurs à zéro").frame(minHeight: 44)
                }
            } footer: {
                Text("Compté sur cet iPhone seulement : un nom de fonction et un nombre par jour, jamais un texte, un titre ou un lieu. Rien ne part. Gardé 60 jours.")
            }
        }
        .font(Police.texte(15))
        .navigationTitle("Ce que tu utilises")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { resume = ResumeUsage.de(CompteursUsage.partages) }
        .onAppear { resume = ResumeUsage.de(CompteursUsage.partages) }
        .confirmationDialog("Remettre les compteurs à zéro ?", isPresented: $confirmer, titleVisibility: .visible) {
            Button("Remettre à zéro", role: .destructive) {
                CompteursUsage.partages.remettreAZero()
                resume = ResumeUsage.de(CompteursUsage.partages)
                Haptique.succes()
            }
            Button("Annuler", role: .cancel) {}
        }
    }

    private var depuis: String {
        guard let d = CompteursUsage.partages.debut else { return "" }
        return "Compté depuis le \(d.formatted(.dateTime.day().month(.wide))) — à revoir chaque mois."
    }

    private func ligne(_ titre: String, _ n: Int) -> some View {
        HStack {
            Text(titre).foregroundStyle(Palette.encre)
            Spacer()
            Text("\(n)").font(Police.mono(15, .medium)).foregroundStyle(Palette.encre2)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}
