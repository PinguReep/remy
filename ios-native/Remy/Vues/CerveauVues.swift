import SwiftUI
import RemyCore

// Le cerveau relié à la vie (24/10) : la carte « carnet » du chat (courses et
// rappels proposés par Rémy) et Réglages › Ce qui compte (les priorités de
// Sam, et les notifications des propositions).

/// Carte d'une proposition « carnet » : des articles pour une liste, un rappel.
/// Rien n'est écrit avant « Ajouter ».
struct CarteCarnet: View {
    @Environment(AppModel.self) private var app
    let ligne: LigneChat
    let p: Proposition
    @State private var enCours = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: p.appliquee ? "checkmark.circle.fill" : "cart")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(p.appliquee ? Palette.encre2 : Palette.signal)
                Text(p.appliquee ? "Dans ton carnet" : "Pour ton carnet")
                    .font(Police.texte(15, .semibold))
                    .foregroundStyle(Palette.encre)
            }
            ForEach(Array(p.actions.enumerated()), id: \.offset) { _, a in
                ligneAction(a)
            }
            if p.appliquee {
                Button {
                    Haptique.leger()
                    app.onglet = .projets
                } label: {
                    Text("Voir mes listes et rappels")
                        .font(Police.texte(14, .medium))
                        .underline()
                        .foregroundStyle(Palette.encre2)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else if !ligne.enCours {
                HStack(spacing: 10) {
                    BoutonA(titre: enCours ? "…" : "Ajouter", symbole: "checkmark", hauteur: 44) {
                        Haptique.leger()
                        enCours = true
                        Task {
                            // Un rappel daté doit pouvoir sonner : la permission se
                            // demande ici, au geste, jamais au lancement.
                            if p.actions.contains(where: { $0.type == "rappel" && $0.quand != nil }) {
                                await Notifications.demander()
                            }
                            if await app.chat.validerCarnet(ligne) { Haptique.succes() } else { Haptique.erreur() }
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

    @ViewBuilder
    private func ligneAction(_ a: ActionProposee) -> some View {
        if a.type == "liste" {
            VStack(alignment: .leading, spacing: 2) {
                Text((a.articles ?? []).joined(separator: ", "))
                    .font(Police.titre(18))
                    .foregroundStyle(Palette.encre)
                    .fixedSize(horizontal: false, vertical: true)
                Label("Liste « \(a.liste ?? "Courses") »", systemImage: "list.bullet")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
            }
            .accessibilityElement(children: .combine)
        } else if a.type == "rappel" {
            VStack(alignment: .leading, spacing: 2) {
                Text(a.texte ?? "Rappel")
                    .font(Police.titre(18))
                    .foregroundStyle(Palette.encre)
                    .fixedSize(horizontal: false, vertical: true)
                Label(Format.echeance(a.quand).map { "Rappel · \($0)" } ?? "Rappel sans heure", systemImage: "bell")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// Réglages › Ce qui compte : les 3 à 5 priorités de Sam (versionnées sur la
/// tour), ce qui n'a pas bougé, et les notifications des propositions.
struct PrioritesVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var vue: VuePriorites?
    @State private var brouillon: [Priorite] = []
    @State private var erreur: String?
    @State private var enregistrement = false
    @AppStorage(PropositionsAttente.cleActives) private var notifications = true

    private var modifie: Bool { Priorites.aEnvoyer(brouillon) != Priorites.aEnvoyer(vue?.priorites ?? []) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if vue != nil {
                        if brouillon.isEmpty {
                            Text("Écris les 3 à 5 choses qui comptent le plus en ce moment, avec pourquoi. Le conseil du moment et la réflexion de nuit s'en servent, et Rémy te dit quand l'une n'a pas bougé depuis une semaine.")
                                .font(Police.texte(15))
                                .foregroundStyle(Palette.encre2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        ForEach($brouillon) { $p in
                            ligne($p)
                        }
                        .onDelete { brouillon.remove(atOffsets: $0) }
                        if brouillon.count < Priorites.maximum {
                            Button {
                                Haptique.leger()
                                brouillon.append(Priorite(titre: ""))
                            } label: {
                                Label("Ajouter une priorité", systemImage: "plus")
                                    .frame(minHeight: 44)
                            }
                        } else {
                            Text("Cinq au plus : au-delà, plus rien n'est prioritaire.")
                                .font(Police.texte(13))
                                .foregroundStyle(Palette.encre3)
                        }
                    } else if let erreur {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(erreur).font(Police.texte(15)).foregroundStyle(Palette.danger)
                            BoutonTexte("Réessayer") { Task { await charger() } }
                        }
                    } else {
                        Squelette(largeurs: [0.7, 0.9, 0.5])
                    }
                } header: {
                    Text("Tes priorités")
                } footer: {
                    if let v = vue, v.version > 0 { Text(piedVersion(v)) }
                }
                Section {
                    Toggle(isOn: $notifications) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Me notifier").font(Police.texte(16, .medium)).foregroundStyle(Palette.encre)
                            Text("Les tâches proposées par tes règles et les sujets de plus pour la nuit, avec « Oui » et « Plus tard » dans la notification.")
                                .font(Police.texte(13))
                                .foregroundStyle(Palette.encre2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .tint(Palette.signal)
                    .frame(minHeight: 52)
                    .onChange(of: notifications) { _, actives in
                        Task {
                            if actives {
                                await Notifications.demander()
                                await NotificationsPropositions.rafraichir(app)
                            } else {
                                await NotificationsPropositions.retirerToutes()
                            }
                        }
                    }
                } header: {
                    Text("Propositions de Rémy")
                }
            }
            .navigationTitle("Ce qui compte")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Fermer") { fermer() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(enregistrement ? "…" : "Enregistrer") { Task { await enregistrer() } }
                        .disabled(!modifie || enregistrement || vue == nil)
                }
            }
            .task { await charger() }
            .refreshable { await charger() }
        }
    }

    private func ligne(_ p: Binding<Priorite>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Ce qui compte (ex. « La musique »)", text: p.titre)
                .font(Police.texte(17, .semibold))
                .foregroundStyle(Palette.encre)
                .frame(minHeight: 44)
            TextField("Pourquoi, avec tes mots", text: p.pourquoiTexte, axis: .vertical)
                .font(Police.texte(15))
                .foregroundStyle(Palette.encre2)
                .lineLimit(1...4)
                .frame(minHeight: 44)
            TextField("Mots qui la reconnaissent (facultatif : guitare, répétition)", text: p.motsTexte)
                .font(Police.texte(13))
                .foregroundStyle(Palette.encre3)
                .textInputAutocapitalization(.never)
                .frame(minHeight: 44)
            if let etat = Priorites.etat(p.wrappedValue) {
                Text(etat)
                    .font(Police.texte(13, p.wrappedValue.neglige == true ? .semibold : .regular))
                    .foregroundStyle(p.wrappedValue.neglige == true ? Palette.danger : Palette.encre3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
    }

    private func piedVersion(_ v: VuePriorites) -> String {
        let date = v.majA.map { " du " + Format.jourCourt($0.date) } ?? ""
        return "Version \(v.version)\(date) : chaque enregistrement garde les précédentes sur ta tour."
    }

    private func charger() async {
        do {
            let v = try await app.api.priorites()
            vue = v
            brouillon = v.priorites
            erreur = nil
        } catch {
            if vue == nil { erreur = "Priorités illisibles : \((error as? LocalizedError)?.errorDescription ?? "la tour ne répond pas"). Tire vers le bas pour réessayer." }
            app.signaler(error)
        }
    }

    private func enregistrer() async {
        guard let v = vue else { return }
        enregistrement = true
        defer { enregistrement = false }
        do {
            let r = try await app.api.enregistrerPriorites(Priorites.aEnvoyer(brouillon), base: v.version)
            vue = r
            brouillon = r.priorites
            Haptique.succes()
            app.dire(r.priorites.isEmpty ? "Priorités vidées (l'ancienne version reste sur ta tour)." : "Priorités enregistrées : Rémy s'en sert dès le prochain conseil.")
        } catch {
            Haptique.erreur()
            if let e = error as? ErreurAPI, case .serveur(409, _) = e {
                app.dire("Tes priorités ont changé ailleurs entre-temps : je recharge, refais ta modification.")
                await charger()
                return
            }
            app.signaler(error)
        }
    }
}
