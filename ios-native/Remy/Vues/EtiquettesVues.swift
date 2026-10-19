import SwiftUI
import RemyCore

// Étiquettes des rappels (retours TestFlight 13) : libres (Personnel, Santé,
// Voiture… sont des exemples), un filtre à cases multiples à droite de
// « Rappels du jour », « Sans étiquette » et « Tout voir ». Une étiquette dit
// le domaine ; le type (rappel daté, to-do, tâche Motion) reste à part.

enum FiltreRappels {
    static let cle = "filtreRappels"
    static let sans = "_sans"

    static func lire(_ brut: String) -> Set<String> { Set(brut.split(separator: ",").map(String.init)) }
    static func ecrire(_ s: Set<String>) -> String { s.sorted().joined(separator: ",") }

    static func garder(_ r: Rappel, _ filtre: Set<String>) -> Bool {
        guard !filtre.isEmpty else { return true }
        let e = r.etiquettes ?? []
        if e.isEmpty { return filtre.contains(sans) }
        return !filtre.isDisjoint(with: e)
    }
}

/// Le bouton « Filtrer » et sa feuille.
struct BoutonFiltreRappels: View {
    @Environment(AppModel.self) private var app
    @AppStorage(FiltreRappels.cle) private var brut = ""
    @State private var ouvert = false

    var body: some View {
        let n = FiltreRappels.lire(brut).count
        Button {
            Haptique.leger()
            ouvert = true
        } label: {
            HStack(spacing: 4) {
                Image(systemName: n > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                Text(n > 0 ? "Filtré (\(n))" : "Filtrer")
            }
            .font(Police.texte(13, .medium))
            .foregroundStyle(n > 0 ? Palette.signal : Palette.encre2)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(n > 0 ? "Filtre des rappels, \(n) choix" : "Filtrer les rappels")
        .sheet(isPresented: $ouvert) { FiltreRappelsVue() }
    }
}

struct FiltreRappelsVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @AppStorage(FiltreRappels.cle) private var brut = ""

    var body: some View {
        let filtre = FiltreRappels.lire(brut)
        NavigationStack {
            List {
                Section {
                    ForEach(app.organisation.etiquettes) { e in
                        ligne(e.nom, actif: filtre.contains(e.id)) { basculer(e.id) }
                    }
                    ligne("Sans étiquette", actif: filtre.contains(FiltreRappels.sans), discret: true) { basculer(FiltreRappels.sans) }
                } footer: {
                    Text(filtre.isEmpty ? "Tout est affiché. Coche une ou plusieurs étiquettes pour ne voir qu'elles." : "Seuls les rappels de ces étiquettes s'affichent.")
                }
                if app.organisation.etiquettes.isEmpty {
                    Text("Pas encore d'étiquette : crée-les dans « Gérer les étiquettes ».").foregroundStyle(Palette.encre2)
                }
                Section {
                    NavigationLink("Gérer les étiquettes…") { GestionEtiquettes() }
                }
            }
            .listeAtelier()
            .navigationTitle("Filtrer les rappels")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Tout voir") { brut = "" }.disabled(filtre.isEmpty)
                }
                ToolbarItem(placement: .confirmationAction) { Button("OK") { fermer() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func basculer(_ id: String) {
        var f = FiltreRappels.lire(brut)
        if f.contains(id) { f.remove(id) } else { f.insert(id) }
        brut = FiltreRappels.ecrire(f)
    }

    private func ligne(_ titre: String, actif: Bool, discret: Bool = false, _ faire: @escaping () -> Void) -> some View {
        Button {
            Haptique.leger()
            faire()
        } label: {
            HStack {
                Text(titre).foregroundStyle(discret ? Palette.encre2 : Palette.encre)
                Spacer()
                Image(systemName: actif ? "checkmark.circle.fill" : "circle").foregroundStyle(actif ? Palette.signal : Palette.encre3)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(actif ? .isSelected : [])
    }
}

/// Créer, renommer, supprimer ses étiquettes.
struct GestionEtiquettes: View {
    @Environment(AppModel.self) private var app
    @State private var nouvelle = ""
    @State private var aRenommer: RemyCore.Etiquette?
    @State private var nom = ""

    var body: some View {
        List {
            Section {
                ForEach(app.organisation.etiquettes) { e in
                    Text(e.nom)
                        .frame(minHeight: 44, alignment: .leading)
                        .swipeActions {
                            Button(role: .destructive) { Task { await app.organisation.supprimerEtiquette(e) } } label: { Label("Supprimer", systemImage: "trash") }
                            Button { nom = e.nom; aRenommer = e } label: { Label("Renommer", systemImage: "pencil") }.tint(Palette.encre2)
                        }
                        .contextMenu {
                            Button { nom = e.nom; aRenommer = e } label: { Label("Renommer", systemImage: "pencil") }
                            Button(role: .destructive) { Task { await app.organisation.supprimerEtiquette(e) } } label: { Label("Supprimer", systemImage: "trash") }
                        }
                }
            } footer: {
                Text("Glisse une étiquette vers la gauche pour la renommer ou la supprimer. Supprimer ne supprime aucun rappel.")
            }
            Section {
                HStack {
                    TextField("Nouvelle étiquette", text: $nouvelle)
                        .submitLabel(.done)
                        .onSubmit { ajouter() }
                    Button("Ajouter") { ajouter() }.disabled(nouvelle.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .frame(minHeight: 44)
            }
        }
        .listeAtelier()
        .navigationTitle("Étiquettes")
        .alert("Renommer l'étiquette", isPresented: Binding(get: { aRenommer != nil }, set: { if !$0 { aRenommer = nil } })) {
            TextField("Nom", text: $nom)
            Button("Renommer") { if let e = aRenommer { Task { await app.organisation.renommerEtiquette(e, en: nom) } } }
            Button("Annuler", role: .cancel) {}
        }
    }

    private func ajouter() {
        let n = nouvelle
        nouvelle = ""
        Task { await app.organisation.ajouterEtiquette(n) }
    }
}

/// La catégorie d'une tâche Motion (Sam, 18/10 : « qu'on catégorise chaque
/// tâche… comme voiture, santé, pro, perso »). Les mêmes étiquettes que les
/// rappels ; gardée par Remy, Motion n'y voit rien. Celle que les mots
/// suggèrent est pré-cochée quand la tâche n'en a pas.
struct CategoriserTache: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    let id: String
    let titre: String
    let actuelles: [String]
    @State private var choix: Set<String> = []
    @State private var envoi = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if app.organisation.etiquettes.isEmpty {
                        Text("Pas encore de catégorie : crée-les (Voiture, Santé, Pro, Perso…).").foregroundStyle(Palette.encre2)
                    }
                    ForEach(app.organisation.etiquettes) { e in
                        Button {
                            Haptique.leger()
                            if choix.contains(e.id) { choix.remove(e.id) } else { choix.insert(e.id) }
                        } label: {
                            HStack {
                                Text(e.nom).foregroundStyle(Palette.encre)
                                Spacer()
                                Image(systemName: choix.contains(e.id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(choix.contains(e.id) ? Palette.signal : Palette.encre3)
                            }
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(choix.contains(e.id) ? .isSelected : [])
                    }
                } header: {
                    Text(titre)
                } footer: {
                    Text("Le domaine de la tâche, pour filtrer et voir où passe ton temps. Motion n'est pas modifié.")
                }
                Section { NavigationLink("Gérer les étiquettes…") { GestionEtiquettes() } }
            }
            .listeAtelier()
            .navigationTitle("Catégorie")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { fermer() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(envoi ? "…" : "Enregistrer") { Task { await enregistrer() } }
                        .disabled(envoi || Set(valides) == Set(actuelles))
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear {
            choix = Set(actuelles)
            if choix.isEmpty, let e = EtiquetteDevinee.pour(titre, parmi: app.organisation.etiquettes) { choix = [e.id] }
        }
    }

    private var valides: [String] { app.organisation.etiquettes.map(\.id).filter { choix.contains($0) } }

    private func enregistrer() async {
        envoi = true
        defer { envoi = false }
        if await app.tableau.categoriser(id: id, titre: titre, etiquettes: valides) {
            Haptique.succes()
            fermer()
        } else {
            Haptique.erreur()
        }
    }
}

/// Les étiquettes d'un rappel (appui long sur un rappel).
struct EtiquetterRappel: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    let rappel: Rappel
    @State private var choix: Set<String> = []

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(app.organisation.etiquettes) { e in
                        Button {
                            Haptique.leger()
                            if choix.contains(e.id) { choix.remove(e.id) } else { choix.insert(e.id) }
                        } label: {
                            HStack {
                                Text(e.nom).foregroundStyle(Palette.encre)
                                Spacer()
                                Image(systemName: choix.contains(e.id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(choix.contains(e.id) ? Palette.signal : Palette.encre3)
                            }
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text(rappel.texte)
                }
                Section { NavigationLink("Gérer les étiquettes…") { GestionEtiquettes() } }
            }
            .listeAtelier()
            .navigationTitle("Étiquettes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { fermer() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("OK") {
                        app.carnet.etiqueter(rappel, app.organisation.etiquettes.map(\.id).filter { choix.contains($0) })
                        fermer()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear { choix = Set(rappel.etiquettes ?? []) }
    }
}
