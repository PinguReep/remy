import SwiftUI
import RemyCore

/// Les règles de Rémy (Sam, 19/10) : ce que Motion ne sait pas faire — « avant
/// une sortie, me raser ». Rémy propose la règle dans le chat, Sam la valide ;
/// ensuite, avant chaque événement qui correspond, Rémy propose la tâche (une
/// carte Motion ordinaire, dans le fil « Règles de Rémy »).

/// La carte d'une règle proposée dans le chat.
struct CarteRegle: View {
    @Environment(AppModel.self) private var app
    let ligne: LigneChat
    let p: Proposition
    @State private var enCours = false

    var body: some View {
        let a = p.actions.first
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: p.appliquee ? "checkmark.circle.fill" : "arrow.triangle.branch")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(p.appliquee ? Palette.encre2 : Palette.signal)
                Text(p.appliquee ? (p.toutDejaLa ? "Règle déjà là" : "Règle créée") : "Nouvelle règle")
                    .font(Police.texte(15, .semibold))
                    .foregroundStyle(Palette.encre)
            }
            if let nom = a?.nom {
                Text(nom).font(Police.titre(18)).foregroundStyle(Palette.encre)
            }
            if let d = a?.description, !d.isEmpty {
                Text(d)
                    .font(Police.texte(15))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if p.appliquee {
                Text("Avant chaque événement qui correspond, Rémy te proposera la tâche. Tes règles sont dans Réglages.")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre3)
                    .fixedSize(horizontal: false, vertical: true)
            } else if !ligne.enCours {
                HStack(spacing: 10) {
                    BoutonA(titre: enCours ? "…" : "Créer la règle", symbole: "checkmark", hauteur: 44) {
                        Haptique.leger()
                        enCours = true
                        Task {
                            if await app.chat.validerRegle(ligne) { Haptique.succes() }
                            enCours = false
                        }
                    }
                    .disabled(enCours)
                    BoutonA(titre: "Non merci", principal: false, hauteur: 44) {
                        Haptique.leger()
                        Task { await app.chat.ecarter(ligne) }
                    }
                    .disabled(enCours)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.filet, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }
}

/// Réglages › Règles de Rémy : les voir, les couper, les supprimer.
struct ReglesVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var regles: [RegleRemy]?
    @State private var erreur: String?
    @State private var verification = false

    var body: some View {
        NavigationStack {
            List {
                if let regles {
                    if regles.isEmpty {
                        Text("Aucune règle pour l'instant. Dis à Rémy, par exemple : « avant chaque sortie, rappelle-moi de me raser ».")
                            .font(Police.texte(15))
                            .foregroundStyle(Palette.encre2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(regles) { r in
                        Toggle(isOn: Binding(get: { r.actif }, set: { v in regler(r, v) })) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(r.nom).font(Police.texte(16, .medium)).foregroundStyle(Palette.encre)
                                Text("« \(r.tache.nom) »\(r.tache.duree.map { " (\($0) min)" } ?? ""), \(r.delai), avant : \(r.mots.joined(separator: ", "))")
                                    .font(Police.texte(13))
                                    .foregroundStyle(Palette.encre2)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .tint(Palette.signal)
                        .frame(minHeight: 52)
                        .swipeActions {
                            Button(role: .destructive) { supprimer(r) } label: { Label("Supprimer", systemImage: "trash") }
                        }
                    }
                    if !regles.isEmpty {
                        Button {
                            verifier()
                        } label: {
                            Label(verification ? "Rémy regarde ton agenda…" : "Vérifier maintenant", systemImage: "calendar.badge.clock")
                                .frame(minHeight: 44)
                        }
                        .disabled(verification)
                    }
                } else if let erreur {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(erreur).font(Police.texte(15)).foregroundStyle(Palette.danger)
                        BoutonTexte("Réessayer") { Task { await charger() } }
                    }
                } else {
                    Squelette(largeurs: [0.7, 0.9, 0.5])
                }
                Section {
                    Text("Rémy relit ton agenda et Motion toutes les 3 heures (de 7 h à 22 h), sans IA. Quand un événement correspond, il te propose la tâche dans le fil « Règles de Rémy » : rien n'est créé sans toi.")
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .navigationTitle("Règles de Rémy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK") { fermer() } } }
            .task { await charger() }
            .refreshable { await charger() }
        }
    }

    private func charger() async {
        do {
            regles = try await app.api.regles()
            erreur = nil
        } catch {
            if regles == nil { erreur = "Règles illisibles : \((error as? LocalizedError)?.errorDescription ?? "la tour ne répond pas")." }
            app.signaler(error)
        }
    }

    private func regler(_ r: RegleRemy, _ actif: Bool) {
        Task {
            do {
                regles = try await app.api.reglerRegle(r.id, actif: actif)
                app.dire(actif ? "Règle « \(r.nom) » allumée." : "Règle « \(r.nom) » coupée.")
            } catch {
                app.signaler(error)
            }
        }
    }

    private func supprimer(_ r: RegleRemy) {
        Task {
            do {
                regles = try await app.api.supprimerRegle(r.id)
                app.dire("Règle « \(r.nom) » supprimée.")
            } catch {
                app.signaler(error)
            }
        }
    }

    private func verifier() {
        verification = true
        Task {
            defer { verification = false }
            do {
                let b = try await app.api.verifierRegles()
                app.dire(b.proposees > 0
                         ? "\(b.proposees) tâche\(b.proposees > 1 ? "s" : "") proposée\(b.proposees > 1 ? "s" : "") dans le fil « Règles de Rémy »."
                         : "Rien de nouveau : aucun événement à venir ne demande de tâche.")
                await app.chat.rafraichirListe()
            } catch {
                app.signaler(error)
            }
        }
    }
}
