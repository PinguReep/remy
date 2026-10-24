import Foundation
import UIKit
import UserNotifications
import BackgroundTasks
import Observation
import RemyCore

/// Où une notification du rendez-vous veut mener : « matin » (Briefing) ou
/// « soir » (Bilan). Posé par le délégué, lu par les onglets (même au
/// lancement depuis la notification, avant que l'écran existe).
@MainActor
@Observable
final class RouteRituel {
    static let partagee = RouteRituel()
    var demande: String?
}

/// Le délégué de l'app : toucher une notification du rendez-vous, et le
/// rafraîchissement en arrière-plan (enregistré dès le lancement, comme iOS l'exige).
final class DelegueApp: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        FondRituel.enregistrer()
        return true
    }

    // App ouverte à l'heure du briefing : il s'affiche quand même. Les rappels
    // gardent leur comportement d'avant (rien au premier plan).
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let rituel = notification.request.content.userInfo["rituel"] != nil
        completionHandler(rituel ? [.banner, .list, .sound] : [])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let quoi = response.notification.request.content.userInfo["rituel"] as? String {
            Task { @MainActor in RouteRituel.partagee.demande = quoi }
        }
        completionHandler()
    }
}

/// Rafraîchir le rendez-vous en arrière-plan quand iOS le permet (une heure
/// avant le prochain, briefing ou bilan) : la notification part avec le contenu frais.
enum FondRituel {
    static let identifiant = "com.pingureep.remy.rituel"

    static func enregistrer() {
        _ = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifiant, using: nil) { tache in
            let travail = Task { @MainActor in
                let ok = await rafraichir()
                tache.setTaskCompleted(success: ok)
            }
            tache.expirationHandler = { travail.cancel() }
        }
    }

    /// Prochain passage demandé à iOS (rien si le rendez-vous est coupé).
    static func programmer() {
        guard let quand = Rituel.prochainReveil(ReglagesRituel.lire(), apres: Date()) else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifiant)
            return
        }
        let requete = BGAppRefreshTaskRequest(identifier: identifiant)
        requete.earliestBeginDate = quand
        try? BGTaskScheduler.shared.submit(requete)
    }

    /// Hors de l'app : la tour relue, les notifications reprogrammées.
    @MainActor
    static func rafraichir() async -> Bool {
        defer { programmer() }
        guard let base = ClientAPI.adresseTour else { return false }
        guard let r = await RituelModel.rafraichirEnFond(api: ClientAPI(base: base), rangement: Rangement.parDefaut()) else { return false }
        await Notifications.planifierRituel(r, prepareA: Date(), reglages: .lire())
        return true
    }
}
