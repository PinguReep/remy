import SwiftUI
import RemyCore

/// Réglages › Modèle (20/10) : le modèle local avec lequel Rémy répond. Par
/// défaut, celui que les Sparks chargent ; on peut en fixer un autre parmi
/// ceux qu'elles servent. Claude n'est pas dans la liste, exprès.
struct ModelesVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer

    var body: some View {
        let m = app.modeles
        NavigationStack {
            List {
                if let v = m.vue {
                    Section("En ce moment") {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(v.actif?.libelle ?? "Modèle inconnu")
                                .font(Police.texte(17, .semibold))
                                .foregroundStyle(Palette.encre)
                            Text([v.pourquoi, v.machine].compactMap { $0 }.joined(separator: " · "))
                                .font(Police.texte(13))
                                .foregroundStyle(Palette.encre2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.vertical, 4)
                        if !v.joignable {
                            Text("Les Sparks ne répondent pas : la liste ci-dessous peut dater. Rémy reprendra dès qu'elles reviennent.")
                                .font(Police.texte(13))
                                .foregroundStyle(Palette.danger)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Section {
                        ligne(titre: "Automatique",
                              sous: "Celui que tes Sparks chargent" + (v.servis.first.map { " : \($0.libelle)" } ?? ""),
                              coche: v.choisi == nil, enCours: m.enCours == "") {
                            Task { await m.choisir(nil) }
                        }
                        ForEach(v.servis) { s in
                            ligne(titre: s.libelle, sous: ModelesLocaux.fenetreLisible(s.fenetre),
                                  coche: v.choisi == s.id, enCours: m.enCours == s.id) {
                                Task { await m.choisir(s.id) }
                            }
                        }
                        if v.servis.isEmpty {
                            Text(v.joignable ? "Les Sparks ne déclarent aucun modèle." : "Aucun modèle connu tant que les Sparks ne répondent pas.")
                                .font(Police.texte(14))
                                .foregroundStyle(Palette.encre2)
                        }
                    } header: {
                        Text("Modèle")
                    } footer: {
                        // La recherche locale (recherche-locale-v1, 25/10) : Claude ne cherche plus pour Rémy.
                        Text("Seuls les modèles chargés sur tes Sparks apparaissent ici : tes conversations restent chez toi. "
                             + (app.serveur?.sait("recherche-locale-v1") == true
                                ? "Rémy cherche lui-même sur le web, sans Claude (Réglages › Recherche web)."
                                : "Claude ne sert qu'aux recherches web que tu autorises."))
                            .font(Police.texte(12))
                    }
                } else if let e = m.erreur {
                    Section {
                        Text(e).font(Police.texte(15)).foregroundStyle(Palette.danger)
                        BoutonTexte("Réessayer") { Task { await m.charger() } }
                    }
                } else {
                    Section { Squelette(largeurs: [0.5, 0.8, 0.6]) }
                }
            }
            .navigationTitle("Modèle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK") { fermer() } } }
            .task { await m.charger() }
            .refreshable { await m.charger() }
        }
    }

    private func ligne(titre: String, sous: String?, coche: Bool, enCours: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptique.leger()
            action()
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(titre).font(Police.texte(16, coche ? .semibold : .regular)).foregroundStyle(Palette.encre)
                    if let sous {
                        Text(sous).font(Police.texte(13)).foregroundStyle(Palette.encre2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                if enCours {
                    ProgressView()
                } else if coche {
                    Image(systemName: "checkmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.signal)
                }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(app.modeles.enCours != nil)
        .accessibilityAddTraits(coche ? .isSelected : [])
    }
}
