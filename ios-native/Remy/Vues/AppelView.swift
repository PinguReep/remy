import SwiftUI
import UIKit
import RemyCore

/// Le mode appel : parler à Rémy comme au téléphone. J'écoute → une pause (ou
/// « J'ai fini ») → je transcris sur la tour → je réfléchis → je parle, micro
/// coupé → j'écoute de nouveau. L'échange s'écrit aussi dans la conversation.
struct AppelView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var ouvrirURL
    @Environment(\.accessibilityReduceMotion) private var reduire

    var body: some View {
        let appel = app.appel
        VStack(spacing: 0) {
            HStack {
                Etiquette("Appel avec Rémy", couleur: Palette.encre, graisse: .semibold)
                Spacer()
                CarreSignal(taille: 10)
            }
            .padding(.horizontal, 22)
            .frame(height: 56)
            .overlay(alignment: .bottom) { Filet(couleur: Palette.encre) }

            Spacer(minLength: 12)

            Button {
                Haptique.leger()
                appel.toucher()
            } label: {
                carre(appel)
            }
            .buttonStyle(.plain)
            .disabled(!(appel.etat == .ecoute || appel.etat == .parole))
            .accessibilityLabel(appel.etat == .parole ? "Couper la parole à Rémy" : "J'ai fini de parler")

            VStack(spacing: 6) {
                Text(libelle(appel))
                    .font(Police.texte(24, .heavy))
                    .tracking(-0.6)
                    .foregroundStyle(Palette.encre)
                Text(sousTitre(appel))
                    .font(Police.texte(15))
                    .foregroundStyle(estErreur(appel) ? Palette.danger : Palette.encre2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                if appel.etat == .transcription || appel.etat == .reflexion {
                    ProgressView().padding(.top, 4)
                }
            }
            .padding(.horizontal, 26)
            .padding(.top, 18)
            .accessibilityElement(children: .combine)

            Spacer(minLength: 12)

            echange(appel)

            VStack(spacing: 10) {
                switch appel.etat {
                case .ecoute:
                    Button("J'ai fini de parler") {
                        Haptique.leger()
                        appel.toucher()
                    }
                    .buttonStyle(BoutonBrut(pleineLargeur: true))
                case .parole:
                    Button("Couper la parole") {
                        Haptique.leger()
                        appel.toucher()
                    }
                    .buttonStyle(BoutonBrut(pleineLargeur: true))
                case .erreur(let message):
                    if message.contains("Réglages") {
                        Button("Ouvrir les réglages") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { ouvrirURL(url) }
                        }
                        .buttonStyle(BoutonBrut(pleineLargeur: true))
                    }
                    Button("Réessayer") {
                        Haptique.leger()
                        appel.reessayer()
                    }
                    .buttonStyle(BoutonBrut(genre: .principal, pleineLargeur: true))
                default:
                    EmptyView()
                }
                Button {
                    Haptique.leger()
                    appel.raccrocher()
                } label: {
                    Label("Raccrocher", systemImage: "phone.down.fill")
                }
                .buttonStyle(BoutonBrut(genre: .danger, pleineLargeur: true))
            }
            .padding(.horizontal, 22)
            .padding(.top, 12)
            .padding(.bottom, 16)
        }
        .background(Palette.fond.ignoresSafeArea())
        // Pendant l'appel, l'écran ne s'éteint pas (on parle, on ne touche pas).
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
        .onChange(of: appel.etat) { _, etat in
            switch etat {
            case .ecoute: Haptique.leger() // « à toi »
            case .erreur: Haptique.erreur()
            default: break
            }
        }
    }

    /// Le carré de Rémy : orange quand il écoute (il respire avec la voix),
    /// à l'encre quand il parle.
    private func carre(_ a: AppelModel) -> some View {
        let ecoute = a.etat == .ecoute
        let parle = a.etat == .parole
        let echelle: CGFloat = ecoute && !reduire ? 1 + CGFloat(a.niveau) * 0.16 : 1
        return ZStack {
            Rectangle()
                .fill(ecoute ? Palette.signal : parle ? Palette.encre : Palette.fond3)
                .frame(width: 150, height: 150)
                .scaleEffect(echelle)
                .animation(reduire ? nil : .easeOut(duration: 0.12), value: a.niveau)
            Text("R")
                .font(Police.texte(64, .heavy))
                .foregroundStyle(ecoute ? Palette.surSignal : parle ? Palette.fond : Palette.encre2)
        }
        .frame(width: 190, height: 190)
        .contentShape(Rectangle())
    }

    /// Ce que Sam a dit, et ce que Rémy répond (en direct pendant qu'il réfléchit).
    private func echange(_ a: AppelModel) -> some View {
        let reponse = texteReponse(a)
        return ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if !a.entendu.isEmpty {
                    Etiquette("Tu as dit")
                    Text("« \(a.entendu) »")
                        .font(Police.texte(16))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !reponse.isEmpty {
                    Etiquette("Rémy")
                        .padding(.top, 8)
                    Text(reponse)
                        .font(Police.texte(17))
                        .foregroundStyle(Palette.encre)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 22)
        }
        .frame(maxHeight: 200)
        .defaultScrollAnchor(.bottom)
    }

    private func texteReponse(_ a: AppelModel) -> String {
        if a.etat == .reflexion {
            guard let l = app.chat.lignes.last, !l.deToi else { return "" }
            return Parole.pourVoix(l.texte)
        }
        return a.reponse.isEmpty ? "" : Parole.pourVoix(a.reponse)
    }

    private func estErreur(_ a: AppelModel) -> Bool {
        if case .erreur = a.etat { return true }
        return false
    }

    private func libelle(_ a: AppelModel) -> String {
        switch a.etat {
        case .ecoute: return a.parleDeja ? "Je t'écoute…" : "Parle quand tu veux"
        case .transcription: return "Je transcris…"
        case .reflexion: return "Je réfléchis…"
        case .parole: return "Je parle"
        case .erreur: return "Ça coince"
        case .arrete: return "Appel terminé"
        }
    }

    private func sousTitre(_ a: AppelModel) -> String {
        switch a.etat {
        case .ecoute: return "Une pause, et je t'envoie la question. Ou touche le carré."
        case .transcription: return "Sur ta tour : l'audio n'est pas gardé."
        case .reflexion:
            if let s = app.chat.lignes.last?.statut, !s.isEmpty { return s }
            return "Réponse courte, à voix haute."
        case .parole: return "Le micro est coupé. Touche le carré pour me couper."
        case .erreur(let m): return m
        case .arrete: return ""
        }
    }
}
