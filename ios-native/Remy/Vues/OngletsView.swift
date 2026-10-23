import SwiftUI
import UIKit
import RemyCore

/// Ce que les onglets partagent : les panneaux superposés de l'accueil et les
/// feuilles ouvertes depuis n'importe où (le « + »).
@MainActor
@Observable
final class EtatInterface {
    /// La tâche ouverte dans « Gérer ».
    var gerer: ElementJour?
    /// La journée à l'échelle (appui long sur la suite).
    var journeeEtendue = false
    var captureOuverte = false
    var boiteOuverte = false
    /// Captures de la CI : la prolongation à montrer déjà choisie dans « Gérer ».
    var choixDemo: Int?
    /// Captures de la CI : le texte déjà tapé dans « + ».
    var texteDemo: String?
    /// La pile de l'onglet Projets (une liste, les rappels) : toucher l'onglet
    /// déjà ouvert revient à sa racine.
    var cheminProjets: [RouteProjets] = []
    /// La fiche « Modifier » ouverte hors d'une ligne (captures de la CI).
    var modifier: ElementJour?
    /// Le conseil du moment en grand (toucher) ou avec son « pourquoi » (appui).
    var conseil: ModeConseil?
    /// La tâche du moment vient d'être terminée : « Et maintenant ? »
    var suite: String?
    var choixTache = false
    var historiqueOuvert = false
    /// Captures de la CI : la capture analysée d'emblée, le filtre des
    /// rappels, le mini-onboarding à l'étape donnée.
    var analyseDemo = false
    var filtreDemo = false
    var onboardingDemo: Int?
}

enum ModeConseil: Equatable { case detail, pourquoi }

/// Trois onglets (Lot 1, J1.1) : « Aujourd'hui » (l'accueil), « Rémy » (la
/// conversation), « Projets » (listes et projets). Le « + » est posé sur la
/// barre, à portée de pouce depuis tous les onglets. La barre reste visible
/// clavier ouvert : il y a toujours une sortie.
struct OngletsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scene
    @State private var ui = EtatInterface()

    var body: some View {
        @Bindable var app = app
        @Bindable var ui = ui
        VStack(spacing: 0) {
            ZStack {
                AujourdhuiView()
                    .opacity(app.onglet == .aujourdhui ? 1 : 0)
                    .allowsHitTesting(app.onglet == .aujourdhui)
                    .accessibilityHidden(app.onglet != .aujourdhui)
                // Le « + » déborde au-dessus de la barre : le composeur garde sa place.
                RemyView()
                    .padding(.bottom, 26)
                    .opacity(app.onglet == .remy ? 1 : 0)
                    .allowsHitTesting(app.onglet == .remy)
                    .accessibilityHidden(app.onglet != .remy)
                ProjetsView()
                    .opacity(app.onglet == .projets ? 1 : 0)
                    .allowsHitTesting(app.onglet == .projets)
                    .accessibilityHidden(app.onglet != .projets)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            BarreOnglets { ui.captureOuverte = true }
        }
        .background(Palette.fond.ignoresSafeArea())
        .overlay {
            ZStack {
                if let e = ui.gerer {
                    Surimpression(fermer: { ui.gerer = nil }) {
                        if e.estRendezVous { RendezVousPanneau(e: e) } else { GererPanneau(e: e) }
                    }
                    .transition(.opacity)
                    .zIndex(1)
                }
                if ui.journeeEtendue {
                    Surimpression(fermer: { ui.journeeEtendue = false }, depuisLeBas: false) { JourneeEtendue() }
                        .transition(.opacity)
                        .zIndex(2)
                }
                if let mode = ui.conseil {
                    Surimpression(fermer: { ui.conseil = nil }, depuisLeBas: false) { ConseilPanneau(mode: mode) }
                        .transition(.opacity)
                        .zIndex(3)
                }
            }
            .animation(.easeOut(duration: 0.2), value: ui.gerer?.cle)
            .animation(.easeOut(duration: 0.2), value: ui.journeeEtendue)
            .animation(.easeOut(duration: 0.2), value: ui.conseil)
        }
        .overlay(alignment: .bottom) {
            if let titre = ui.suite, app.onglet == .aujourdhui {
                EtMaintenant(terminee: titre)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 92)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: ui.suite)
        .environment(ui)
        .sheet(isPresented: $ui.choixTache) { ChoixTache().environment(ui) }
        .sheet(isPresented: $ui.historiqueOuvert) { HistoriqueView() }
        .sheet(isPresented: $ui.filtreDemo) { FiltreRappelsVue() }
        .sheet(isPresented: Binding(get: { ui.onboardingDemo != nil }, set: { if !$0 { ui.onboardingDemo = nil } })) {
            OnboardingRappels(etapeInitiale: ui.onboardingDemo ?? 1)
        }
        .sheet(isPresented: $app.reglagesOuverts) { ReglagesView() }
        .sheet(isPresented: $ui.captureOuverte) { CaptureView().environment(ui) }
        .sheet(isPresented: $ui.boiteOuverte) { BoiteView() }
        // Les nouveautés d'une mise à jour (21/10), une fois : Réglages › Nouveautés pour revoir.
        .sheet(item: Binding(get: { app.nouveautes.affichees }, set: { if $0 == nil { app.nouveautes.fermer() } })) { lot in
            NouveautesFeuille(lot: lot) { app.nouveautes.fermer() }
        }
        .sheet(item: $ui.modifier) { e in
            ModifierTache(id: e.id, titre: e.titre, echeance: e.echeance, duree: e.duree, priorite: e.priorite)
        }
        .task { await demo() }
        // Revenir sur l'onglet Rémy, c'est voir la réponse du fil ouvert.
        .onChange(of: app.onglet) { _, o in if o == .remy { app.chat.marquerVu() } }
        // Les rappels sonnent sur l'iPhone : reprogrammés à chaque changement.
        .task(id: app.carnet.rappels) { await Notifications.planifier(app.carnet.rappels) }
        // Signe de vie tant que l'app est au premier plan : c'est la mesure
        // d'activité (le temps passé devant Rémy, pas le temps où il existe).
        // Une dictée de plusieurs minutes : l'écran ne se verrouille pas (le
        // micro serait coupé). L'app quittée quand même : le vocal attend.
        .onChange(of: app.dictee.etat) { _, e in
            UIApplication.shared.isIdleTimerDisabled = e != .repos || app.appel.actif
        }
        .onChange(of: scene) { _, s in
            if s == .background { app.dictee.interrompre() }
        }
        .task(id: scene) {
            guard scene == .active else { return }
            // La localisation (20/10) : capteurs rebranchés, positions en attente envoyées.
            if app.lieux.disponible {
                CapteurLocalisation.partage.brancher(app.lieux)
                await CapteurLocalisation.partage.controlerMouvements()
                await app.lieux.envoyer()
            }
            // De retour au premier plan : la journée a pu changer (et le jour aussi).
            if app.tableau.misAJour.map({ Date().timeIntervalSince($0) > 60 }) ?? true {
                await app.chargerTout()
            } else {
                await app.tableau.envoyerEnAttente()
            }
            // Le tutoriel d'une mise à jour : après le chargement, jamais par-dessus
            // une dictée, un appel ou les réglages ; jamais en démo (captures de la CI).
            if ProcessInfo.processInfo.environment["REMY_DEMO_ECRAN"] == nil {
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                if !app.reglagesOuverts, app.dictee.etat == .repos, !app.appel.actif { app.nouveautes.verifier() }
            }
            while !Task.isCancelled {
                await app.api.signeDeVie()
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                // Tailscale réactivé sans changement de réseau : rien ne le
                // signale, on retente chaque minute ce qui attend.
                if app.tableau.gestesEnAttente > 0 { await app.tableau.envoyerEnAttente() }
            }
        }
    }
}

extension OngletsView {
    /// Captures de la CI : ouvre le panneau demandé une fois la journée chargée.
    /// Inactif sans les variables d'environnement de démonstration.
    fileprivate func demo() async {
        let env = ProcessInfo.processInfo.environment
        guard env["REMY_DEMO_MDP"] != nil, let ecran = env["REMY_DEMO_ECRAN"] else { return }
        // Chaque capture part du même état : ni filtre ni onboarding gardés d'une précédente.
        UserDefaults.standard.removeObject(forKey: FiltreRappels.cle)
        UserDefaults.standard.removeObject(forKey: EtapeOnboardingRappels.cle)
        try? await Task.sleep(nanoseconds: 3_000_000_000)
        let j = app.tableau.journee
        switch ecran {
        case "gerer", "categorie":
            if case .enCours(let e) = Jour.prochain(j, maintenant: Date().millis), !e.estRendezVous {
                ui.gerer = e
            } else {
                ui.gerer = j?.items?.first { !$0.estRendezVous && $0.duree != nil } ?? j?.items?.first { !$0.estRendezVous }
            }
            ui.choixDemo = 15
        case "journee-etendue": ui.journeeEtendue = true
        case "nouveautes": app.nouveautes.montrerPourCapture(["modele", "lieux"])
        case "capture": ui.captureOuverte = true
        case "capture-liste", "capture-rappel":
            ui.texteDemo = ecran == "capture-liste" ? "tomates, lait d'avoine et œufs" : "Appeler le garage demain à 9h"
            ui.captureOuverte = true
        case "modifier":
            ui.modifier = j?.items?.first { !$0.estRendezVous && $0.bloquee != true }
        case "liste":
            if let l = app.carnet.listes.first { ui.cheminProjets = [.liste(l.id)] }
        case "rappels":
            ui.cheminProjets = [.rappels]
        case "conseil":
            await app.conseil.charger(.maintenant)
            ui.conseil = .pourquoi
        case "activite":
            ui.gerer = j?.items?.first { $0.estActivite && $0.titre == "Aspirateur" } ?? j?.items?.first { $0.estActivite }
        case "rendez-vous":
            ui.gerer = j?.items?.first { $0.estRendezVous && $0.avecAutres == true }
        case "et-maintenant":
            ui.suite = j?.items?.first { !$0.estRendezVous }?.titre ?? "Trier la boîte mail"
        case "choix-tache":
            ui.choixTache = true
        case "capture-plusieurs":
            ui.texteDemo = "Jeudi soir je suis chez Yanis, samedi je ne suis dispo que le matin, dimanche deux heures de studio pour la démo, ajoute vin et fromage aux courses, et nouveau projet site vitrine."
            ui.analyseDemo = true
            ui.captureOuverte = true
        case "capture-projet":
            ui.texteDemo = "Nouveau projet : Recrutement sous Boutiques"
            ui.captureOuverte = true
        case "filtre":
            UserDefaults.standard.set(FiltreRappels.ecrire(["et-admin", "et-pro"]), forKey: FiltreRappels.cle)
            ui.cheminProjets = [.rappels]
            try? await Task.sleep(nanoseconds: 600_000_000)
            ui.filtreDemo = true
        case "onboarding": ui.onboardingDemo = 1
        case "onboarding-2": ui.onboardingDemo = 2
        case "historique": ui.historiqueOuvert = true
        case "noeud":
            ui.cheminProjets = [.noeud(env["REMY_DEMO_ANCRE"] ?? "motion:p1")]
        case "boite": ui.boiteOuverte = true
        default: break
        }
    }
}

/// La barre pleine de la direction A, le « + » orange posé sur son bord droit.
struct BarreOnglets: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    let noter: () -> Void

    var body: some View {
        // Le « + » est en surimpression : la barre seule fixe la mise en page et
        // touche le bas de la zone sûre, sinon son fond ne descend pas jusqu'au bord.
        HStack(spacing: 0) {
            onglet(.aujourdhui, "Aujourd'hui", "sun.max")
            onglet(.remy, "Rémy", "bubble.left")
            onglet(.projets, "Projets", "square.stack")
            Color.clear.frame(width: 92, height: 1)
        }
        .padding(.top, 6)
        .background(Palette.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Palette.filet).frame(height: 1) }
        .overlay(alignment: .topTrailing) {
            Button {
                Haptique.leger()
                noter()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 62, height: 62)
                    .background(Palette.signal, in: Circle())
                    .overlay(Circle().strokeBorder(Palette.surface, lineWidth: 4))
                    .shadow(color: Palette.signal.opacity(0.35), radius: 10, x: 0, y: 5)
            }
            .buttonStyle(Appui())
            .padding(.trailing, 18)
            .offset(y: -24)
            .accessibilityLabel("Noter quelque chose")
            .accessibilityIdentifier("noter")
        }
    }

    private func onglet(_ o: AppModel.Onglet, _ titre: String, _ symbole: String) -> some View {
        let actif = app.onglet == o
        return Button {
            // Quitter Rémy range le clavier : il masquerait l'écran.
            if o != .remy {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
            Haptique.leger()
            // L'onglet Projets déjà ouvert : retour à sa racine.
            if o == .projets && actif { ui.cheminProjets = [] }
            withAnimation(.snappy) { app.onglet = o }
        } label: {
            let nonLus = o == .remy ? app.chat.nombreNonLus : 0
            VStack(spacing: 4) {
                Image(systemName: actif ? symbole + ".fill" : symbole)
                    .font(.system(size: 19, weight: actif ? .semibold : .regular))
                    .frame(height: 24)
                    // Une réponse de Rémy pas encore vue (Sam, 18/10).
                    .overlay(alignment: .topTrailing) {
                        if nonLus > 0 {
                            Text("\(nonLus)")
                                .font(Police.mono(10, .semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 4)
                                .frame(minWidth: 17, minHeight: 17)
                                .background(Color.red, in: Capsule())
                                .offset(x: 10, y: -5)
                        }
                    }
                Text(titre).font(Police.texte(11, actif ? .semibold : .medium))
            }
            .foregroundStyle(actif ? Palette.encre : Palette.encre3)
            .frame(maxWidth: .infinity, minHeight: 52)
            .overlay(alignment: .top) {
                if actif { Capsule().fill(Palette.signal).frame(width: 22, height: 3).offset(y: -6) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(o == .remy && app.chat.nombreNonLus > 0 ? "\(titre), \(app.chat.nombreNonLus) réponse\(app.chat.nombreNonLus > 1 ? "s" : "") non vue\(app.chat.nombreNonLus > 1 ? "s" : "")" : titre)
        .accessibilityAddTraits(actif ? .isSelected : [])
        // Les parcours (ios-native/RemyParcours) retrouvent l'onglet quel que soit son libellé.
        .accessibilityIdentifier("onglet." + Self.cle(o))
    }

    private static func cle(_ o: AppModel.Onglet) -> String {
        switch o {
        case .aujourdhui: return "aujourdhui"
        case .remy: return "remy"
        case .projets: return "projets"
        }
    }
}
