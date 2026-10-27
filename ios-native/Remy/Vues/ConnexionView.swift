import SwiftUI
import RemyCore

/// Plein écran, le nom en très grand, un seul champ.
struct ConnexionView: View {
    @Environment(AppModel.self) private var app
    @State private var motDePasse = ""
    @State private var erreur: String?
    @State private var envoi = false
    @FocusState private var focus: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            HStack(alignment: .lastTextBaseline, spacing: 6) {
                Text("Rémy")
                    .font(Police.texte(104, .heavy))
                    .tracking(-7)
                    .foregroundStyle(Palette.encre)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                CarreSignal(taille: 18)
            }
            Filet(epais: true).padding(.top, 8)
            Etiquette("Espace privé — mot de passe")
                .padding(.top, 18)
                .padding(.bottom, 16)

            SecureField("Mot de passe", text: $motDePasse)
                .font(Police.texte(17))
                .textContentType(.password)
                .submitLabel(.go)
                .focused($focus)
                .onSubmit(entrer)
                .padding(.horizontal, 14)
                .frame(height: 54)
                .overlay(Rectangle().stroke(Palette.encre, lineWidth: focus ? 2 : 1))

            Button(action: entrer) {
                Text(envoi ? "Connexion…" : "Entrer")
            }
            .buttonStyle(BoutonBrut(genre: .principal, pleineLargeur: true))
            .disabled(motDePasse.isEmpty || envoi)
            .padding(.top, 10)

            Text(erreur ?? " ")
                .font(Police.texte(14))
                .foregroundStyle(Palette.danger)
                .padding(.top, 10)
            // Session refusée par la tour : les captures tapées sur l'iPhone
            // restent, et c'est dit (le nombre seulement, pas leur texte).
            let n = app.tableau.capturesEnAttente.count
            if n > 0 {
                Label("\(n) capture\(n > 1 ? "s" : "") notée\(n > 1 ? "s" : "") sur l'iPhone : elle\(n > 1 ? "s" : "") partir\(n > 1 ? "ont" : "a") après la connexion.",
                      systemImage: "tray.and.arrow.up")
                    .font(Police.texte(14))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 6)
                    .accessibilityIdentifier("connexion.captures")
            }
            Spacer()
            Spacer()
        }
        .padding(.horizontal, 24)
        .onAppear { focus = true }
    }

    private func entrer() {
        guard !motDePasse.isEmpty, !envoi else { return }
        envoi = true
        erreur = nil
        Task {
            do {
                try await app.connecter(motDePasse: motDePasse)
                motDePasse = ""
                Haptique.succes()
            } catch {
                Haptique.erreur()
                erreur = (error as? LocalizedError)?.errorDescription ?? "Connexion impossible."
            }
            envoi = false
        }
    }
}
