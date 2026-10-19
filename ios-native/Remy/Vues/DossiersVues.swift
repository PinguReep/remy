import SwiftUI
import RemyCore

// Projets, sous-projets, catégories (retours TestFlight 13, MVP) : l'API
// Motion n'a pas de hiérarchie — elle vit dans Remy. Les grands projets
// durables restent dans Motion ; un dossier peut devenir projet Motion sur
// demande (sans retour possible par l'API : Motion ne sait ni le renommer ni
// le supprimer). Les idées et notes n'encombrent pas l'agenda.

/// Les dossiers à part (catégories, idées, « Notes »).
struct SectionDossiers: View {
    @Environment(AppModel.self) private var app
    @State private var nouveau = false
    @State private var nom = ""

    var body: some View {
        let racines = app.organisation.enfants(de: nil)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                TitreSection(texte: "Dossiers", compte: racines.isEmpty ? nil : racines.count)
                Spacer()
                Button { nouveau = true } label: {
                    Image(systemName: "plus").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.encre2)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Nouveau dossier")
            }
            .padding(.horizontal, 6)
            VStack(spacing: 0) {
                if racines.isEmpty {
                    Text("Catégories, idées, sous-projets sans Motion : « + » ici, ou « Projet » dans le « + » du bas.")
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.encre2)
                        .padding(.vertical, 14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(Array(racines.enumerated()), id: \.element.id) { i, d in
                    NavigationLink(value: RouteProjets.noeud(d.id)) { LigneDossier(dossier: d) }
                        .buttonStyle(.plain)
                    if i < racines.count - 1 { Rectangle().fill(Palette.filet).frame(height: 1).padding(.leading, 46) }
                }
            }
            .padding(.horizontal, 14)
            .carte(rayon: 18)
        }
        .padding(.horizontal, 16)
        .alert("Nouveau dossier", isPresented: $nouveau) {
            TextField("Catégorie, projet perso…", text: $nom)
            Button("Créer") {
                let n = nom
                nom = ""
                Task { await app.organisation.creerDossier(n, parent: nil) }
            }
            Button("Annuler", role: .cancel) { nom = "" }
        }
    }
}

struct LigneDossier: View {
    @Environment(AppModel.self) private var app
    let dossier: Dossier
    /// Dans une List, NavigationLink dessine déjà le sien.
    var chevron = true

    var body: some View {
        let sous = app.organisation.enfants(de: dossier.id).count
        let notes = dossier.notes.filter { !$0.fait }.count
        HStack(spacing: 12) {
            Image(systemName: dossier.id == "notes" ? "note.text" : dossier.projetMotion != nil ? "square.stack.fill" : "folder")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Palette.encre2)
                .frame(width: 32, height: 32)
                .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(dossier.nom).font(Police.texte(16, .medium)).foregroundStyle(Palette.encre).multilineTextAlignment(.leading)
                let bits = [sous > 0 ? "\(sous) sous-projet\(sous > 1 ? "s" : "")" : nil,
                            dossier.taches.isEmpty ? nil : "\(dossier.taches.count) tâche\(dossier.taches.count > 1 ? "s" : "")",
                            notes > 0 ? "\(notes) idée\(notes > 1 ? "s" : "")" : nil].compactMap { $0 }
                if !bits.isEmpty { Text(bits.joined(separator: " · ")).font(Police.texte(13)).foregroundStyle(Palette.encre2) }
            }
            Spacer(minLength: 0)
            if chevron {
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.encre3)
            }
        }
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

/// Un nœud de l'arborescence : un projet Motion ou un dossier de Remy.
struct NoeudView: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    @Environment(\.dismiss) private var retour
    let id: String
    @State private var nouveau = false
    @State private var renommer = false
    @State private var supprimer = false
    @State private var motion = false
    @State private var nom = ""
    @State private var note = ""

    private var projet: Projet? {
        guard id.hasPrefix("motion:") else { return nil }
        return app.projets.liste?.projets.first { "motion:" + $0.id == id }
    }
    private var dossier: Dossier? { app.organisation.dossiers.first { $0.id == id } }
    private var titre: String { projet?.nom ?? dossier?.nom ?? "Introuvable" }

    /// Toutes les tâches Motion connues (projets, journée), pour retrouver un titre.
    private var toutesTaches: [String: TacheResume] {
        var t: [String: TacheResume] = [:]
        for p in app.projets.liste?.projets ?? [] { for x in p.liste ?? [] { t[x.id] = x } }
        return t
    }

    /// La racine (projet Motion) d'un nœud, pour proposer où ranger ses tâches.
    private var racine: String {
        var courant = id
        var garde = 0
        while let d = app.organisation.dossiers.first(where: { $0.id == courant }), let p = d.parent, garde < 30 {
            courant = p
            garde += 1
        }
        return courant
    }

    /// Les sous-dossiers de la racine (où ranger une tâche).
    private var rangements: [Dossier] {
        var r: [Dossier] = []
        var file = [racine]
        while let x = file.first {
            file.removeFirst()
            let e = app.organisation.enfants(de: x)
            r += e
            file += e.map(\.id)
        }
        return r
    }

    var body: some View {
        let sous = app.organisation.enfants(de: id)
        let rangees = Set(app.organisation.dossiers.flatMap(\.taches))
        let taches: [TacheResume] = projet.map { ($0.liste ?? []).filter { !rangees.contains($0.id) } }
            ?? (dossier?.taches ?? []).map { toutesTaches[$0] ?? TacheResume(id: $0, titre: "Tâche Motion (terminée ou hors liste)") }
        List {
            if projet == nil && dossier == nil {
                Text("Ce dossier n'existe plus.").foregroundStyle(Palette.encre2)
            }
            Section {
                ForEach(sous) { d in
                    NavigationLink(value: RouteProjets.noeud(d.id)) { LigneDossier(dossier: d, chevron: false) }
                }
                Button { nouveau = true } label: {
                    Label("Nouveau sous-projet", systemImage: "plus").font(Police.texte(15, .medium)).frame(minHeight: 44)
                }
            } header: {
                Text("Sous-projets")
            } footer: {
                if projet != nil { Text("Les sous-projets vivent dans Remy : l'API Motion n'a pas de hiérarchie.") }
            }
            Section(projet != nil ? "Tâches Motion" : "Tâches rangées ici") {
                if taches.isEmpty {
                    Text(projet != nil ? "Aucune tâche ouverte hors sous-projets." : "Range ici des tâches depuis le projet (appui long sur une tâche).")
                        .font(Police.texte(14)).foregroundStyle(Palette.encre2)
                }
                ForEach(taches) { t in ligneTache(t) }
            }
            if let d = dossier {
                Section("Idées et notes") {
                    ForEach(d.notes) { n in
                        Button {
                            Haptique.leger()
                            Task { await app.organisation.basculer(n, dans: d.id) }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: n.fait ? "checkmark.circle.fill" : "circle").foregroundStyle(n.fait ? Palette.encre3 : Palette.encre2)
                                Text(n.texte).strikethrough(n.fait).foregroundStyle(n.fait ? Palette.encre3 : Palette.encre)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .swipeActions {
                            Button(role: .destructive) { Task { await app.organisation.supprimer(n, dans: d.id) } } label: { Label("Retirer", systemImage: "trash") }
                        }
                    }
                    HStack {
                        TextField("Une idée, une note…", text: $note).submitLabel(.done).onSubmit { ajouterNote(d.id) }
                        Button("Ajouter") { ajouterNote(d.id) }.disabled(note.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .frame(minHeight: 44)
                }
            }
        }
        .listeAtelier()
        .navigationTitle(titre)
        .toolbar {
            // Comme avant P3 : en parler à Rémy reste à un toucher.
            if let p = projet {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Haptique.leger()
                        Task {
                            _ = await app.preparer("Où en est le projet « \(p.nom) » ? Propose-moi les prochaines étapes.", dansFil: p.nom)
                        }
                    } label: {
                        Image(systemName: "bubble.left").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("En parler à Rémy")
                }
            }
            if let d = dossier {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { nom = d.nom; renommer = true } label: { Label("Renommer", systemImage: "pencil") }
                        if d.parent == nil && d.projetMotion == nil && d.id != "notes" {
                            Button { motion = true } label: { Label("Aussi dans Motion…", systemImage: "square.stack") }
                        }
                        Button(role: .destructive) { supprimer = true } label: { Label("Supprimer", systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis.circle").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Actions du dossier")
                }
            }
        }
        .alert("Nouveau sous-projet", isPresented: $nouveau) {
            TextField("Nom", text: $nom)
            Button("Créer") {
                let n = nom
                nom = ""
                Task { await app.organisation.creerDossier(n, parent: id) }
            }
            Button("Annuler", role: .cancel) { nom = "" }
        }
        .alert("Renommer", isPresented: $renommer) {
            TextField("Nom", text: $nom)
            Button("Renommer") { if let d = dossier { Task { await app.organisation.renommer(d, en: nom) } } }
            Button("Annuler", role: .cancel) {}
        }
        .confirmationDialog("Supprimer « \(titre) » ?", isPresented: $supprimer, titleVisibility: .visible) {
            Button("Supprimer le dossier et son contenu", role: .destructive) {
                if let d = dossier {
                    retour()
                    Task { await app.organisation.supprimer(d) }
                }
            }
        } message: {
            Text("Les sous-projets et les idées partent avec ; les tâches Motion restent dans Motion. « Annuler » juste après.")
        }
        .confirmationDialog("Créer « \(titre) » dans Motion ?", isPresented: $motion, titleVisibility: .visible) {
            Button("Créer le projet Motion") { if let d = dossier { Task { await app.organisation.aussiDansMotion(d) } } }
        } message: {
            Text("Pour un grand projet durable. Motion ne permet pas de le supprimer ou de le renommer depuis Rémy : ce sera à faire dans Motion.")
        }
    }

    private func ajouterNote(_ dossier: String) {
        let t = note
        note = ""
        Task { await app.organisation.ajouterNote(t, dans: dossier) }
    }

    private func ligneTache(_ t: TacheResume) -> some View {
        let item = app.tableau.donnees?.journee?.items?.first { $0.id == t.id && !$0.estRendezVous }
        return Button {
            if let item { ui.gerer = item }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(t.titre).font(Police.texte(16, .medium)).foregroundStyle(Palette.encre)
                let bits = [t.echeance.map { "avant le \(Format.jourCourt($0.date))" }, t.duree.map { Format.duree(minutes: $0) }].compactMap { $0 }
                if !bits.isEmpty { Text(bits.joined(separator: " · ")).font(Police.texte(13)).foregroundStyle(Palette.encre2) }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            if !rangements.isEmpty {
                Menu("Ranger dans…") {
                    ForEach(rangements) { d in
                        Button(d.nom) { Task { await app.organisation.ranger(tache: t.id, dans: d.id) } }
                    }
                }
            }
            if dossier != nil {
                Button("Sortir du sous-projet") { Task { await app.organisation.ranger(tache: t.id, dans: nil) } }
            }
        }
    }
}
