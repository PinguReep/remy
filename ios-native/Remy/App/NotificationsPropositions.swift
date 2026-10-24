import Foundation
import UIKit
import UserNotifications
import RemyCore

/// Les propositions qui attendent hors du chat (24/10) — tâches proposées par
/// les règles, sujets de plus pour la nuit — deviennent des notifications avec
/// « Oui » et « Plus tard ». Catégorie à part de celle des rappels. Sans
/// service de push : l'iPhone relit la tour quand l'app revient au premier
/// plan (et peut le faire en arrière-plan : `rafraichir` sans AppModel).
@MainActor
enum NotificationsPropositions {
    static let categorie = "remy.proposition"
    static let oui = "remy.proposition.oui"
    static let plusTard = "remy.proposition.plus-tard"
    private static let prefixe = "proposition-"
    /// « Plus tard » : elle revient dans 3 heures.
    static let delaiPlusTard: TimeInterval = 3 * 3600

    private static weak var app: AppModel?
    private static let delegue = DeleguePropositions()
    private static var observateur: NSObjectProtocol?

    /// Au lancement : la catégorie (ajoutée à celles qui existent, sans les
    /// écraser), le délégué, et la relecture au retour au premier plan.
    static func brancher(_ modele: AppModel) {
        app = modele
        let centre = UNUserNotificationCenter.current()
        if centre.delegate == nil { centre.delegate = delegue }
        Task { await enregistrerCategorie() }
        if observateur == nil {
            observateur = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
                Task { @MainActor in
                    if let a = NotificationsPropositions.app { await rafraichir(a) }
                }
            }
        }
    }

    static func enregistrerCategorie() async {
        let centre = UNUserNotificationCenter.current()
        let ouiAction = UNNotificationAction(identifier: oui, title: "Oui", options: [.authenticationRequired])
        let tardAction = UNNotificationAction(identifier: plusTard, title: "Plus tard", options: [])
        let c = UNNotificationCategory(identifier: categorie, actions: [ouiAction, tardAction], intentIdentifiers: [], options: [])
        let existantes = await centre.notificationCategories()
        centre.setNotificationCategories(existantes.filter { $0.identifier != categorie }.union([c]))
    }

    /// Relit ce qui attend sur la tour et notifie le nouveau (2 au plus par
    /// passage) ; retire ce qui a été tranché ailleurs. Silencieux en cas d'échec.
    static func rafraichir(_ modele: AppModel?) async {
        guard PropositionsAttente.actives() else { return }
        let api = modele?.api ?? ClientAPI.adresseTour.map { ClientAPI(base: $0) }
        guard let api else { return }
        if let m = modele, m.serveur?.sait("propositions-attente-v1") != true { return }
        let centre = UNUserNotificationCenter.current()
        let reglages = await centre.notificationSettings()
        guard [.authorized, .provisional, .ephemeral].contains(reglages.authorizationStatus) else { return }
        guard let liste = try? await api.propositionsEnAttente() else { return }
        let deja = Set(UserDefaults.standard.stringArray(forKey: PropositionsAttente.cleNotifiees) ?? [])
        let (nouvelles, garder) = PropositionsAttente.aNotifier(liste, deja: deja)
        UserDefaults.standard.set(Array(garder).sorted(), forKey: PropositionsAttente.cleNotifiees)
        // Tranchée ailleurs (le site, le fil) : sa notification n'a plus lieu d'être.
        let encore = Set(liste.map { prefixe + $0.id })
        let enAttente = await centre.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefixe) && !encore.contains($0) }
        centre.removePendingNotificationRequests(withIdentifiers: enAttente)
        let livrees = await centre.deliveredNotifications().map(\.request.identifier).filter { $0.hasPrefix(prefixe) && !encore.contains($0) }
        centre.removeDeliveredNotifications(withIdentifiers: livrees)
        for p in nouvelles { await notifier(p, dans: nil) }
    }

    static func retirerToutes() async {
        let centre = UNUserNotificationCenter.current()
        let ids = await centre.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefixe) }
        centre.removePendingNotificationRequests(withIdentifiers: ids)
        let livrees = await centre.deliveredNotifications().map(\.request.identifier).filter { $0.hasPrefix(prefixe) }
        centre.removeDeliveredNotifications(withIdentifiers: livrees)
    }

    private static func notifier(_ p: PropositionEnAttente, dans secondes: TimeInterval?) async {
        let contenu = UNMutableNotificationContent()
        let n = p.notification
        contenu.title = n.titre
        contenu.body = n.corps
        contenu.sound = .default
        contenu.categoryIdentifier = categorie
        if let donnees = try? JSONEncoder().encode(p) { contenu.userInfo = ["proposition": donnees.base64EncodedString()] }
        let declencheur = secondes.map { UNTimeIntervalNotificationTrigger(timeInterval: max(1, $0), repeats: false) }
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: prefixe + p.id, content: contenu, trigger: declencheur))
    }

    /// Un mot de retour, toujours : « c'est fait » ou ce qui a coincé.
    private static func dire(_ titre: String, _ corps: String) async {
        let contenu = UNMutableNotificationContent()
        contenu.title = titre
        contenu.body = corps
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "retour-proposition-\(UUID().uuidString)", content: contenu, trigger: nil))
    }

    static func lire(_ info: [AnyHashable: Any]) -> PropositionEnAttente? {
        guard let b64 = info["proposition"] as? String, let d = Data(base64Encoded: b64) else { return nil }
        return try? JSONDecoder().decode(PropositionEnAttente.self, from: d)
    }

    /// Ce que le délégué reçoit : vrai si c'était une notification de proposition.
    static func repondre(action: String, info: [AnyHashable: Any]) async -> Bool {
        guard let p = lire(info) else { return false }
        switch action {
        case oui:
            let api = app?.api ?? ClientAPI.adresseTour.map { ClientAPI(base: $0) }
            guard let api else {
                await dire("Pas fait", "Rémy ne connaît pas l'adresse de ta tour : ouvre l'app.")
                return true
            }
            do {
                let fait = try await api.accepter(p)
                await dire("C'est fait", fait)
                if let a = app { await a.chat.rafraichirListe() }
            } catch {
                let raison = (error as? LocalizedError)?.errorDescription ?? "la tour ne répond pas"
                await dire("Pas fait", "\(raison). Ouvre Rémy pour réessayer depuis le fil.")
            }
        case plusTard:
            await notifier(p, dans: delaiPlusTard)
        case UNNotificationDefaultActionIdentifier:
            // Toucher la notification : le fil où la proposition attend.
            if let a = app {
                if let conv = p.convId {
                    a.onglet = .remy
                    await a.ouvrirConversation(conv)
                } else {
                    a.onglet = .aujourdhui
                }
            }
        default:
            break
        }
        return true
    }
}

/// Le délégué des notifications quand aucun autre n'est posé. Un délégué de
/// l'app posé ailleurs doit transmettre à `NotificationsPropositions.repondre`
/// (catégorie « remy.proposition ») et montrer la bannière au premier plan.
final class DeleguePropositions: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Une proposition se voit aussi app ouverte ; les rappels gardent leur comportement d'avant.
        let proposition = notification.request.content.categoryIdentifier == NotificationsPropositions.categorie
            || notification.request.identifier.hasPrefix("retour-proposition-")
        completionHandler(proposition ? [.banner, .list, .sound] : [])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let action = response.actionIdentifier
        let info = response.notification.request.content.userInfo
        Task { @MainActor in
            _ = await NotificationsPropositions.repondre(action: action, info: info)
            completionHandler()
        }
    }
}
