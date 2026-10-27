import SwiftUI
import RemyCore

/// « En attente d'envoi » (25/10) : les captures du « + » notées sans réseau,
/// telles que l'iPhone les a comprises. Elles partent seules au retour de
/// Rémy ; ici, Sam les voit, les envoie tout de suite, ou les retire. Une
/// capture refusée (ou peut-être déjà reçue par une tour ancienne) attend
/// « Renvoyer » : jamais perdue en silence.
struct FileEnvoiVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var envoi = false

    var body: some View {
        let file = app.tableau.capturesEnAttente
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(file.isEmpty ? "Tout est parti : rien n'attend plus Rémy."
                                      : "Notées sans réseau, telles que l'iPhone les a comprises. Elles partent seules dès que Rémy répond, une seule fois chacune.")
                        .font(Police.texte(15))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                    let illisibles = app.tableau.capturesIllisibles
                    if illisibles > 0 {
                        // Laissées par une autre version de l'app : gardées à part, jamais envoyées ni effacées.
                        Text("\(illisibles) capture\(illisibles > 1 ? "s" : "") d'une autre version de l'app, illisible\(illisibles > 1 ? "s" : "") ici : gardée\(illisibles > 1 ? "s" : "") à part sur l'iPhone, sans être envoyée\(illisibles > 1 ? "s" : "").")
                            .font(Police.texte(13))
                            .foregroundStyle(Palette.encre2)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("attente.illisibles")
                    }
                    ForEach(file) { c in ligne(c) }
                    if file.contains(where: { app.tableau.partSeule($0) }) {
                        BoutonA(titre: envoi ? "Envoi…" : "Envoyer maintenant", symbole: "arrow.up") {
                            guard !envoi else { return }
                            envoi = true
                            Task {
                                await app.tableau.envoyerEnAttente(force: true)
                                if app.tableau.capturesEnAttente.contains(where: { app.tableau.partSeule($0) }) {
                                    app.dire("Rémy est toujours injoignable : elles partiront dès qu'il répond.")
                                }
                                envoi = false
                            }
                        }
                        .disabled(envoi)
                        .accessibilityIdentifier("attente.envoyer")
                        .padding(.top, 4)
                    }
                }
                .padding(16)
            }
            .background(Palette.fond)
            .overlay(alignment: .bottom) { ToastView(marge: 12, annoncer: false) }
            .navigationTitle("En attente d'envoi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fermer") { fermer() } }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func ligne(_ c: Commande) -> some View {
        let capture = c.capture
        let etat = app.tableau.etat(c)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: icone(capture?.genre))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.encre2)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 3) {
                    Text(capture?.texte ?? "")
                        .font(Police.texte(16, .medium))
                        .foregroundStyle(Palette.encre)
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("\(capture?.libelle ?? "") · \(capture?.detail ?? "")")
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(etat.aRevoir ? etat.texte : "\(etat.texte) · notée \(Self.quand(c.creeLe))")
                        .font(Police.texte(13, etat.aRevoir ? .semibold : .regular))
                        .foregroundStyle(etat.aRevoir ? Palette.danger : Palette.encre3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 4) {
                Spacer(minLength: 0)
                if etat.aRevoir {
                    BoutonTexte("Renvoyer") { Task { await app.tableau.renvoyerCapture(c.id) } }
                        .accessibilityLabel("Renvoyer « \(capture?.texte ?? "") »")
                }
                BoutonTexte("Retirer", couleur: Palette.danger) { app.tableau.retirerCapture(c.id) }
                    .accessibilityLabel("Retirer « \(capture?.texte ?? "") »")
            }
        }
        .padding(14)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(etat.aRevoir ? Palette.danger.opacity(0.5) : Palette.filet, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }

    /// « à 10:40 », « hier », « le 23 oct. ».
    static func quand(_ d: Date) -> String {
        let r = Format.relatif(d.millis)
        return r == "Hier" ? "hier" : r.contains(":") ? "à " + r : "le " + r
    }

    private func icone(_ g: CaptureFigee.Genre?) -> String {
        switch g {
        case .tache: return "checkmark.circle"
        case .idee: return "tray.and.arrow.down"
        case .retenir: return "lightbulb"
        case .projet: return "folder"
        case nil: return "questionmark.circle"
        }
    }
}
