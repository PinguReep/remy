import SwiftUI
import UIKit
import RemyCore

/// L'adresse de la tour, demandée une seule fois quand l'app ne la connaît pas
/// (elle n'est jamais écrite dans le code : le dépôt est public). Gardée
/// ensuite sur l'iPhone. Rémy vérifie qu'elle répond avant de la garder.
struct AdresseTourVue: View {
    let valider: (URL) -> Void
    @State private var texte = ""
    @State private var verification = false
    @State private var erreur: String?
    /// La tour n'a pas répondu : on peut garder l'adresse quand même.
    @State private var sansReponse: URL?
    @FocusState private var focus: Bool

    private var adresse: URL? { ClientAPI.normaliserAdresse(texte) }

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
            Etiquette("L'adresse de ta tour")
                .padding(.top, 18)
                .padding(.bottom, 8)
            Text("Celle que Tailscale publie, par exemple ma-tour.mon-tailnet.ts.net:8444. Elle reste sur cet iPhone.")
                .font(Police.texte(14))
                .foregroundStyle(Palette.encre2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 14)

            HStack(spacing: 0) {
                TextField("ma-tour.mon-tailnet.ts.net:8444", text: $texte)
                    .font(Police.texte(17))
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($focus)
                    .onSubmit(continuer)
                    .onChange(of: texte) { _, _ in erreur = nil; sansReponse = nil }
                    .padding(.horizontal, 14)
                Button("Coller") {
                    if let s = UIPasteboard.general.string { texte = s }
                }
                .font(Police.texte(15, .semibold))
                .foregroundStyle(Palette.encre2)
                .frame(minWidth: 64, minHeight: 54)
            }
            .frame(height: 54)
            .overlay(Rectangle().stroke(Palette.encre, lineWidth: focus ? 2 : 1))

            Button(action: continuer) {
                Text(verification ? "Je vérifie…" : "Continuer")
            }
            .buttonStyle(BoutonBrut(genre: .principal, pleineLargeur: true))
            .disabled(adresse == nil || verification)
            .padding(.top, 10)

            if let u = sansReponse {
                Button("Garder cette adresse quand même") { valider(u) }
                    .font(Police.texte(15, .semibold))
                    .foregroundStyle(Palette.encre)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .padding(.top, 4)
            }

            Text(erreur ?? (texte.isEmpty || adresse != nil ? " " : "Une adresse comme ma-tour.mon-tailnet.ts.net:8444 (https seulement)."))
                .font(Police.texte(14))
                .foregroundStyle(erreur == nil ? Palette.encre2 : Palette.danger)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 10)
            Spacer()
            Spacer()
        }
        .padding(.horizontal, 24)
        .background(Palette.fond.ignoresSafeArea())
        .onAppear { focus = true }
    }

    private func continuer() {
        guard let u = adresse, !verification else { return }
        verification = true
        erreur = nil
        Task {
            let conf = URLSessionConfiguration.ephemeral
            conf.timeoutIntervalForRequest = 8
            do {
                _ = try await ClientAPI(base: u, session: URLSession(configuration: conf)).versionServeur()
                Haptique.succes()
                valider(u)
            } catch {
                Haptique.erreur()
                sansReponse = u
                erreur = "Pas de réponse de \(u.host ?? "cette adresse"). Vérifie que Tailscale est actif sur l'iPhone et que la tour est allumée, puis réessaie."
            }
            verification = false
        }
    }
}
