import SwiftUI
import RemyCore

/// Un long texte à retenir (Sam, 18/10) : « il y a certaines infos que je
/// veux qu'il garde en mémoire, mais pas toutes ». Rémy (GLM, sur tes machines)
/// propose les infos qu'il garderait ; Sam coche ; seules les infos cochées
/// entrent dans sa mémoire, et le texte entier n'est pas gardé. « Tout le
/// texte » reste possible : c'est l'ancien « Retenir » (Rémy trie seul).
struct DemandeRetenir: Identifiable {
    let id = UUID()
    let texte: String
    let source: String
}

struct RetenirInfosVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    let demande: DemandeRetenir
    @State private var infos: [InfoProposee] = []
    @State private var cochees: Set<String> = []
    @State private var chargement = true
    @State private var erreur: String?

    private var nomSource: String {
        switch demande.source {
        case "chatgpt": return "cette réponse de ChatGPT"
        case "claude": return "cette réponse de Claude"
        default: return "ta note"
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if chargement {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Rémy lit \(nomSource), sur tes machines…").font(Police.texte(15)).foregroundStyle(Palette.encre2)
                        }
                        .frame(minHeight: 44)
                    } else if let erreur {
                        Text(erreur).font(Police.texte(15)).foregroundStyle(Palette.encre2)
                        Button("Réessayer") { Task { await charger() } }.frame(minHeight: 44)
                    } else if infos.isEmpty {
                        Text("Rémy n'y voit rien de nouveau à retenir sur toi. Tu peux quand même tout lui donner, il triera seul.")
                            .font(Police.texte(15)).foregroundStyle(Palette.encre2)
                    }
                } footer: {
                    Text("Seules les infos cochées entrent dans sa mémoire ; le texte entier n'est pas gardé.")
                }
                if !infos.isEmpty {
                    Section {
                        ForEach(infos) { i in
                            let coche = cochees.contains(i.id)
                            Button {
                                Haptique.leger()
                                if coche { cochees.remove(i.id) } else { cochees.insert(i.id) }
                            } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: coche ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 20))
                                        .foregroundStyle(coche ? Palette.signal : Palette.encre3)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(i.texte).font(Police.texte(15)).foregroundStyle(Palette.encre)
                                            .fixedSize(horizontal: false, vertical: true)
                                        if let s = i.section, s != "Autre" {
                                            Text(s).font(Police.texte(12, .medium)).foregroundStyle(Palette.encre3)
                                        }
                                    }
                                    Spacer(minLength: 0)
                                }
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(coche ? .isSelected : [])
                        }
                    } header: {
                        Text("Ce que Rémy retiendrait")
                    }
                }
            }
            .listeAtelier()
            .navigationTitle("Retenir")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { fermer() } }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    if !infos.isEmpty {
                        BoutonA(titre: app.chat.captureEnCours ? "…" : "Retenir \(cochees.count) info\(cochees.count > 1 ? "s" : "")", symbole: "brain") {
                            let choisies = infos.filter { cochees.contains($0.id) }.map(\.texte)
                            Task { if await app.chat.retenirInfos(choisies, source: demande.source, texte: demande.texte) { fermer() } }
                        }
                        .disabled(cochees.isEmpty || app.chat.captureEnCours)
                    }
                    // L'ancien « Retenir » : tout le texte, Rémy trie seul.
                    Button {
                        Task {
                            await app.chat.retenir(source: demande.source)
                            fermer()
                        }
                    } label: {
                        Text("Tout le texte, Rémy trie seul")
                            .font(Police.texte(14, .medium))
                            .foregroundStyle(infos.isEmpty && !chargement ? Palette.encre : Palette.encre2)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .disabled(chargement || app.chat.captureEnCours)
                }
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .background(Palette.fond.opacity(0.97))
            }
        }
        .task { await charger() }
    }

    private func charger() async {
        chargement = true
        erreur = nil
        defer { chargement = false }
        do {
            infos = try await app.api.proposerInfos(demande.texte, source: demande.source)
            cochees = Set(infos.map(\.id))
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app.signaler(e); fermer(); return }
            erreur = (error as? LocalizedError)?.errorDescription ?? "Rémy n'a pas pu lire ce texte. Tu peux tout lui donner, il triera seul."
        }
    }
}
