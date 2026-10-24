import SwiftUI
import UIKit
import RemyCore

@main
struct RemyApp: App {
    /// Notifications du rendez-vous quotidien et rafraîchissement en arrière-plan (24/10).
    @UIApplicationDelegateAdaptor(DelegueApp.self) private var delegue
    /// Absent tant que l'app ne connaît pas l'adresse de la tour (saisie une fois).
    @State private var app: AppModel?
    /// Prototypes de design (Lot 1, J1.1) : REMY_PROTO=A|B ouvre directement un
    /// prototype sur données fictives, sans serveur (captures de la CI).
    @State private var proto: ProtoEtat?
    private let reseau = SurveillanceReseau()
    /// « auto » suit l'iPhone ; « clair » ou « sombre » forcent l'apparence.
    @AppStorage("theme") private var theme = "auto"

    init() {
        // REMY_BASE_URL : pour la CI et les essais sur un serveur de démo.
        // Sinon, l'adresse de la tour gardée sur l'iPhone (ou posée à la compilation).
        let env = ProcessInfo.processInfo.environment
        let base = env["REMY_BASE_URL"].flatMap(URL.init(string:)) ?? ClientAPI.adresseTour
        let modele = base.map(Self.modele)
        _app = State(initialValue: modele)
        _proto = State(initialValue: ProtoEtat.depuisEnvironnement())
        if let modele { reseau.demarrer(modele) }
    }

    private static func modele(_ base: URL) -> AppModel {
        // La journée et les gestes pas encore envoyés restent sur l'iPhone (J1.2).
        let modele = AppModel(api: ClientAPI(base: base), rangement: Rangement.parDefaut())
        modele.nomAppareil = UIDevice.current.name
        // Un seul micro pour la dictée et l'appel : l'un coupe l'autre.
        let micro = MicroiPhone()
        micro.coupure = { [weak modele] in modele?.dictee.interrompre() }
        modele.dictee.micro = micro
        modele.appel.micro = micro
        modele.appel.voix = VoixiPhone()
        // iOS relance l'app en arrière-plan pour une visite : le capteur doit
        // être là dès le lancement (coupé tant que Sam ne l'a pas allumé).
        CapteurLocalisation.partage.brancher(modele.lieux)
        return modele
    }

    var body: some Scene {
        WindowGroup {
            if let proto {
                ProtoRacine(etat: proto)
            } else if let app {
                RacineView()
                    .environment(app)
                    .tint(Palette.encre)
                    .preferredColorScheme(theme == "clair" ? .light : theme == "sombre" ? .dark : nil)
            } else {
                AdresseTourVue { url in
                    ClientAPI.retenirAdresse(url)
                    let m = Self.modele(url)
                    reseau.demarrer(m)
                    app = m
                }
                .tint(Palette.encre)
                .preferredColorScheme(theme == "clair" ? .light : theme == "sombre" ? .dark : nil)
            }
        }
    }
}

struct RacineView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        ZStack {
            Palette.fond.ignoresSafeArea()
            if ProcessInfo.processInfo.environment["REMY_DEMO_ECRAN"] == "perf-saisie" {
                // CI : mesure de la frappe, sans tour ni connexion.
                MesureSaisie()
            } else {
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
        }
        // Au-dessus de la barre d'onglets, et du composeur dans l'onglet Rémy.
        .overlay(alignment: .bottom) {
            ToastView(marge: app.phase != .pret ? 24 : app.onglet == .remy ? 176 : 96)
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
        // Lancée sur la journée gardée, l'app est « prête » avant d'avoir relu
        // les conversations : les écrans de Rémy les attendent (5 s au plus).
        let fil = ["remy", "appel", "dictee", "vocal-en-attente", "remy-fil", "ajuster", "ajuster-rappel"].contains(env["REMY_DEMO_ECRAN"] ?? "")
        for _ in 0..<25 where fil && app.chat.conversations.isEmpty {
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        switch env["REMY_DEMO_ECRAN"] {
        case "remy":
            if let c = app.chat.conversations.first(where: { $0.origine == nil && $0.pinned == true })
                ?? app.chat.conversations.first {
                await app.ouvrirConversation(c.id)
            }
        case "remy-vide":
            app.chat.fermer()
            app.onglet = .remy
        case "conversations", "retenir", "corriger-dictee", "etapes", "jauge", "erreur", "regle":
            app.chat.fermer()
            app.onglet = .remy
        case "remy-fil", "ajuster", "ajuster-rappel":
            // Un fil précis (REMY_DEMO_ANCRE = son identifiant).
            if let id = env["REMY_DEMO_ANCRE"] { await app.ouvrirConversation(id) }
        case "appel", "dictee", "vocal-en-attente":
            if let c = app.chat.conversations.first(where: { $0.origine == nil && $0.pinned == true })
                ?? app.chat.conversations.first {
                await app.ouvrirConversation(c.id)
            }
            app.onglet = .remy
            if env["REMY_DEMO_ECRAN"] == "appel" {
                app.appel.decrocher()
            } else {
                await app.dictee.commencer()
                if env["REMY_DEMO_ECRAN"] == "vocal-en-attente" {
                    // Le micro coupé en pleine dictée : le vocal attend « Renvoyer ».
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    app.dictee.interrompre()
                }
            }
        case "reglages", "lieux", "modeles", "nouveautes-liste":
            app.onglet = .aujourdhui
            app.reglagesOuverts = true
        case "projets", "liste", "rappels", "filtre", "noeud":
            app.onglet = .projets
        case "cocher":
            // J1.2, tour coupée : la coche reste sur l'iPhone et le dit.
            app.onglet = .aujourdhui
            if let t = app.tableau.journee?.aFaire?.first ?? app.tableau.journee?.retard?.items.first {
                app.tableau.delaiAnnulation = 0
                await app.tableau.terminer(id: t.id, titre: t.titre)
            }
        default:
            app.onglet = .aujourdhui
        }
    }
}
