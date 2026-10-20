import Foundation
import UserNotifications
import RemyCore

/// Les rappels sonnent sur l'iPhone (D14 : notifications locales, calculées
/// ici, sans service de plus). La permission est demandée au premier rappel
/// daté, jamais au lancement.
@MainActor
enum Notifications {
    private static let prefixe = "rappel-"

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
            let quand = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: q.date)
            let requete = UNNotificationRequest(identifier: prefixe + rappel.id, content: contenu,
                                                trigger: UNCalendarNotificationTrigger(dateMatching: quand, repeats: false))
            try? await centre.add(requete)
        }
    }
}
