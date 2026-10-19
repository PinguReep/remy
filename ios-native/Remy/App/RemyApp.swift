import SwiftUI
import UIKit
import RemyCore

@main
struct RemyApp: App {
    @State private var app: AppModel
    /// « auto » suit l'iPhone ; « clair » ou « sombre » forcent l'apparence.
    @AppStorage("theme") private var theme = "auto"

    init() {
        // REMY_BASE_URL : pour la CI et les essais sur un serveur de démo.
        // Par défaut, l'app parle au serveur de production.
        let env = ProcessInfo.processInfo.environment
        let base = env["REMY_BASE_URL"].flatMap(URL.init(string:)) ?? ClientAPI.urlProduction
        let modele = AppModel(api: ClientAPI(base: base))
        modele.nomAppareil = UIDevice.current.name
        // Un seul micro pour la dictée et l'appel : l'un coupe l'autre.
        let micro = MicroiPhone()
        modele.dictee.micro = micro
        modele.appel.micro = micro
        modele.appel.voix = VoixiPhone()
        _app = State(initialValue: modele)
    }

    var body: some Scene {
        WindowGroup {
            RacineView()
                .environment(app)
                .tint(Palette.encre)
                .preferredColorScheme(theme == "clair" ? .light : theme == "sombre" ? .dark : nil)
        }
    }
}

struct RacineView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        ZStack {
            Palette.fond.ignoresSafeArea()
            switch app.phase {
            case .demarrage:
                Wordmark(taille: 44)
            case .connexion:
                ConnexionView()
                    .transition(.opacity)
            case .pret:
                OngletsView()
                    .transition(.opacity)
            }
        }
        // Au-dessus de la barre d'onglets, et du composeur dans l'onglet Rémy.
        .overlay(alignment: .bottom) {
            ToastView(marge: app.phase != .pret ? 24 : app.onglet == .remy ? 150 : 72)
        }
        .task { await app.demarrer() }
        .task { await Demo.appliquer(app) }
        .animation(.easeOut(duration: 0.2), value: app.phase)
    }
}

/// Message bref en bas de l'écran. S'il porte « Annuler », il reste plus
/// longtemps et un toucher ailleurs ne le ferme pas.
struct ToastView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduire
    var marge: CGFloat = 72
    /// Les feuilles ont leur propre copie : une seule doit parler à VoiceOver.
    var annoncer = true

    var body: some View {
        Group {
            if let m = app.message {
                HStack(spacing: 0) {
                    Text(m.texte)
                        .font(Police.texte(15, .medium))
                        .foregroundStyle(Palette.fond)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.leading, 18)
                        .padding(.trailing, 12)
                        .padding(.vertical, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let annuler = m.annuler {
                        Button {
                            app.message = nil
                            Haptique.leger()
                            annuler()
                        } label: {
                            Text("Annuler")
                                .font(Police.texte(15, .semibold))
                                .underline()
                                .foregroundStyle(Palette.fond)
                                .padding(.horizontal, 14)
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .background(Palette.encre)
                .overlay(alignment: .leading) { Rectangle().fill(Palette.signal).frame(width: 5) }
                .padding(.horizontal, 16)
                .padding(.bottom, marge)
                .transition(reduire ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                .onTapGesture { if m.annuler == nil { app.message = nil } }
                .task(id: m.id) {
                    let secondes = m.duree ?? (m.annuler == nil ? 4 : 6)
                    try? await Task.sleep(nanoseconds: UInt64(secondes * 1_000_000_000))
                    if app.message?.id == m.id { app.message = nil }
                }
                .accessibilityElement(children: .contain)
                .onAppear { if annoncer { UIAccessibility.post(notification: .announcement, argument: m.texte) } }
            }
        }
        .animation(.easeOut(duration: 0.18), value: app.message?.id)
    }
}

/// Démonstration automatique pour les captures de la CI : se connecte et
/// ouvre l'écran demandé. Inactif sans les variables d'environnement.
enum Demo {
    @MainActor
    static func appliquer(_ app: AppModel) async {
        let env = ProcessInfo.processInfo.environment
        guard let mdp = env["REMY_DEMO_MDP"] else { return }
        try? await Task.sleep(nanoseconds: 800_000_000)
        if app.phase != .pret { try? await app.connecter(motDePasse: mdp) }
        switch env["REMY_DEMO_ECRAN"] {
        case "remy":
            if let c = app.chat.conversations.first(where: { $0.origine == nil && $0.pinned == true })
                ?? app.chat.conversations.first {
                await app.ouvrirConversation(c.id)
            }
        case "remy-vide":
            app.chat.fermer()
            app.onglet = .remy
        case "remy-fil":
            // Un fil précis (REMY_DEMO_ANCRE = son identifiant).
            if let id = env["REMY_DEMO_ANCRE"] { await app.ouvrirConversation(id) }
        case "appel", "dictee":
            if let c = app.chat.conversations.first(where: { $0.origine == nil && $0.pinned == true })
                ?? app.chat.conversations.first {
                await app.ouvrirConversation(c.id)
            }
            app.onglet = .remy
            if env["REMY_DEMO_ECRAN"] == "appel" {
                app.appel.decrocher()
            } else {
                await app.dictee.commencer()
            }
        case "reglages":
            app.onglet = .aujourdhui
            app.reglagesOuverts = true
        default:
            app.onglet = .aujourdhui
        }
    }
}
