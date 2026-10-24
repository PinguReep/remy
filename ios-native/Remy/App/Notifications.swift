import Foundation
import UserNotifications
import RemyCore

/// Les rappels sonnent sur l'iPhone (D14 : notifications locales, calculées
/// ici, sans service de plus). La permission est demandée au premier rappel
/// daté, jamais au lancement.
@MainActor
enum Notifications {
    private static let prefixe = ActionRappel.prefixe

    /// Les actions des rappels, déclarées à iOS une fois au lancement.
    static func declarerActions() {
        let symboles: [ActionRappel: String] = [.fait: "checkmark", .dansUneHeure: "clock", .demain: "sunrise"]
        let actions = ActionRappel.allCases.map { a in
            UNNotificationAction(identifier: a.rawValue, title: a.libelle, options: [],
                                 icon: UNNotificationActionIcon(systemImageName: symboles[a] ?? "bell"))
        }
        let categorie = UNNotificationCategory(identifier: ActionRappel.categorie, actions: actions, intentIdentifiers: [], options: [])
        UNUserNotificationCenter.current().setNotificationCategories([categorie])
    }

    /// Demande la permission (une fois) ; rend vrai si les rappels peuvent sonner.
    @discardableResult
    static func demander() async -> Bool {
        let centre = UNUserNotificationCenter.current()
        let r = await centre.notificationSettings()
        switch r.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return true
        case .denied: return false
        default: return (try? await centre.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        }
    }

    /// Reprogramme les rappels à venir (iOS en garde 64 au plus : les plus proches).
    static func planifier(_ rappels: [Rappel]) async {
        let centre = UNUserNotificationCenter.current()
        let r = await centre.notificationSettings()
        guard [.authorized, .provisional, .ephemeral].contains(r.authorizationStatus) else { return }
        let anciens = await centre.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefixe) }
        centre.removePendingNotificationRequests(withIdentifiers: anciens)
        let maintenant = Date()
        let aVenir = rappels
            .filter { !$0.fait && ($0.quand.map { $0.date > maintenant } ?? false) }
            .sorted { ($0.quand ?? 0) < ($1.quand ?? 0) }
            .prefix(60)
        for rappel in aVenir {
            guard let q = rappel.quand else { continue }
            let contenu = UNMutableNotificationContent()
            contenu.title = "Rappel"
            contenu.body = rappel.texte
            contenu.sound = .default
            // « Fait », « Dans 1 h », « Demain » sous la notification (24/10).
            contenu.categoryIdentifier = ActionRappel.categorie
            let quand = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: q.date)
            let requete = UNNotificationRequest(identifier: prefixe + rappel.id, content: contenu,
                                                trigger: UNCalendarNotificationTrigger(dateMatching: quand, repeats: false))
            try? await centre.add(requete)
        }
    }
}

extension Notification.Name {
    /// Un toucher sur la notification d'un rappel : Projets › Rappels.
    static let remyOuvrirRappels = Notification.Name("remy.ouvrirRappels")
}

/// Les réponses à une notification de rappel (24/10). « Fait », « Dans 1 h »
/// et « Demain » s'appliquent sans ouvrir l'app (iOS la lance en arrière-plan) :
/// le carnet de l'iPhone change, la file part vers la tour, les notifications
/// sont reprogrammées. Un toucher ouvre Projets › Rappels.
final class DelegueNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let partage = DelegueNotifications()
    weak var app: AppModel?
    /// Touchée avant que l'interface soit prête (app lancée par la notification).
    var rappelsEnAttente = false

    /// Au premier plan aussi, le rappel s'affiche (sans délégué, iOS le taisait).
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let id = response.notification.request.identifier
        let action = response.actionIdentifier
        Task { @MainActor in
            await self.traiter(id: id, action: action)
            completionHandler()
        }
    }

    @MainActor
    private func traiter(id: String, action: String) async {
        guard let rappel = ActionRappel.rappel(dansNotification: id) else { return }
        if let a = ActionRappel(rawValue: action) {
            guard let app, app.carnet.depuisNotification(id: rappel, fait: a == .fait, quand: a.report()) else { return }
            await Notifications.planifier(app.carnet.rappels)
            await app.carnet.envoyer()
        } else if action == UNNotificationDefaultActionIdentifier {
            app?.onglet = .projets
            rappelsEnAttente = true
            NotificationCenter.default.post(name: .remyOuvrirRappels, object: nil)
        }
    }
}
