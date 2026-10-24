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

    /// Sans rien demander : Sam a-t-il refusé les notifications de Rémy dans iOS ?
    static func refusees() async -> Bool {
        let r = await UNUserNotificationCenter.current().notificationSettings()
        return r.authorizationStatus == .denied
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
            .prefix(54) // iOS en garde 64 : la place du rendez-vous quotidien reste libre
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

    // MARK: Le rendez-vous quotidien (24/10)

    /// Jours programmés d'avance : au-delà, il faut que l'app (ou iOS en
    /// arrière-plan) ait relu la tour.
    static let joursRituel = 4

    /// Reprogramme le briefing du matin et le bilan du soir aux heures
    /// choisies. Chaque notification porte le contenu préparé pour SON jour ;
    /// sans contenu pour ce jour-là, elle invite à ouvrir Rémy plutôt que
    /// d'inventer. Rien si c'est coupé ou si iOS refuse les notifications.
    static func planifierRituel(_ r: RituelTour?, prepareA: Date?, reglages: ReglagesRituel) async {
        let centre = UNUserNotificationCenter.current()
        let ids = (0..<joursRituel).flatMap { ["rituel-matin-\($0)", "rituel-soir-\($0)"] }
        centre.removePendingNotificationRequests(withIdentifiers: ids)
        let etat = await centre.notificationSettings()
        guard [.authorized, .provisional, .ephemeral].contains(etat.authorizationStatus) else { return }
        let maintenant = Date()
        if reglages.matin {
            for (i, quand) in Rituel.prochains(minutes: reglages.heureMatin, apres: maintenant, nombre: joursRituel).enumerated() {
                let b = r.flatMap { Rituel.briefing(pour: quand, dans: $0) }
                let n = Rituel.notificationMatin(b, prepareA: prepareA, declenchement: quand)
                await ajouter(centre, id: "rituel-matin-\(i)", titre: n.titre, sousTitre: n.sousTitre, corps: n.corps, quand: quand, quoi: "matin")
            }
        }
        if reglages.soir {
            for (i, quand) in Rituel.prochains(minutes: reglages.heureSoir, apres: maintenant, nombre: joursRituel).enumerated() {
                let n = Rituel.notificationSoir(r?.soir, prepareA: prepareA, declenchement: quand)
                await ajouter(centre, id: "rituel-soir-\(i)", titre: n.titre, sousTitre: nil, corps: n.corps, quand: quand, quoi: "soir")
            }
        }
    }

    private static func ajouter(_ centre: UNUserNotificationCenter, id: String, titre: String, sousTitre: String?,
                                corps: String, quand: Date, quoi: String) async {
        let contenu = UNMutableNotificationContent()
        contenu.title = titre
        if let sousTitre { contenu.subtitle = sousTitre }
        contenu.body = corps
        contenu.sound = .default
        contenu.userInfo = ["rituel": quoi]
        contenu.threadIdentifier = "rituel"
        let composantes = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: quand)
        let requete = UNNotificationRequest(identifier: id, content: contenu,
                                            trigger: UNCalendarNotificationTrigger(dateMatching: composantes, repeats: false))
        try? await centre.add(requete)
    }
}
