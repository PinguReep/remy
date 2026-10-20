import CoreLocation
import CoreMotion
import Foundation
import RemyCore

/// Les capteurs de la localisation (20/10) : les VISITES d'iOS (arrivée,
/// départ ; iOS réveille l'app, presque sans batterie) et l'historique des
/// mouvements (« en voiture »). Pas de GPS continu, pas de traduction en
/// adresse sur l'iPhone : la tour s'en charge, chez elle.
@MainActor
final class CapteurLocalisation: NSObject, CLLocationManagerDelegate {
    static let partage = CapteurLocalisation()

    private let gestionnaire = CLLocationManager()
    private let mouvements = CMMotionActivityManager()
    private weak var lieux: LieuxModel?
    /// « Nommer ce lieu » : la position demandée une fois.
    private var demandeIci: CheckedContinuation<CLLocation?, Never>?
    private static let cleControle = "lieux.mouvements.controle"

    /// L'autorisation, pour l'écran Lieux.
    var autorisation: CLAuthorizationStatus { gestionnaire.authorizationStatus }

    override init() {
        super.init()
        gestionnaire.delegate = self
    }

    /// Branché au lancement : si Sam l'a allumée, les visites reprennent.
    func brancher(_ m: LieuxModel) {
        lieux = m
        if m.active { demarrer() }
    }

    func demarrer() {
        switch gestionnaire.authorizationStatus {
        case .notDetermined:
            gestionnaire.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            // Les visites en arrière-plan demandent « Toujours » (iOS le propose).
            gestionnaire.requestAlwaysAuthorization()
            gestionnaire.startMonitoringVisits()
        case .authorizedAlways:
            gestionnaire.startMonitoringVisits()
        default:
            break
        }
        Task { await controlerMouvements() }
    }

    func arreter() {
        gestionnaire.stopMonitoringVisits()
    }

    /// La position actuelle, une fois (pour nommer un lieu). Nil si refusée.
    func positionIci() async -> CLLocation? {
        if let l = gestionnaire.location, Date().timeIntervalSince(l.timestamp) < 120, l.horizontalAccuracy < 100 { return l }
        return await withCheckedContinuation { c in
            demandeIci?.resume(returning: nil)
            demandeIci = c
            gestionnaire.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            gestionnaire.requestLocation()
        }
    }

    // MARK: CLLocationManagerDelegate

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            guard let m = self.lieux, m.active else { return }
            if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
                manager.startMonitoringVisits()
                if manager.authorizationStatus == .authorizedWhenInUse { manager.requestAlwaysAuthorization() }
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        let arrivee = visit.arrivalDate
        let depart = visit.departureDate
        let c = visit.coordinate
        let precision = visit.horizontalAccuracy
        Task { @MainActor in
            guard let m = self.lieux else { return }
            // Arrivée inconnue (la visite a commencé avant le suivi) : on la date de son départ.
            let debut = arrivee == .distantPast ? depart : arrivee
            guard debut != .distantFuture, debut != .distantPast else { return }
            let fin: Date? = depart == .distantFuture ? nil : depart
            await m.recevoir(.visite(arrivee: debut, depart: fin, lat: c.latitude, lon: c.longitude, precision: precision))
            await self.controlerMouvements()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let l = locations.last
        Task { @MainActor in
            self.demandeIci?.resume(returning: l)
            self.demandeIci = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.demandeIci?.resume(returning: nil)
            self.demandeIci = nil
        }
    }

    // MARK: En voiture

    /// Relit l'historique des mouvements depuis le dernier contrôle (iOS en
    /// garde 7 jours) et en tire les trajets en voiture de plus de 3 min.
    func controlerMouvements() async {
        guard let m = lieux, m.active, !m.enPause, CMMotionActivityManager.isActivityAvailable() else { return }
        // Deux heures avant le dernier contrôle : un trajet commencé avant garde
        // le même début, donc le même identifiant (la tour le complète).
        let dernier = UserDefaults.standard.double(forKey: Self.cleControle)
        let depuis = Date(timeIntervalSince1970: max(dernier - 2 * 3600, Date().addingTimeInterval(-6 * 3600).timeIntervalSince1970))
        let jusqua = Date()
        let activites: [CMMotionActivity] = await withCheckedContinuation { c in
            mouvements.queryActivityStarting(from: depuis, to: jusqua, to: .main) { a, _ in c.resume(returning: a ?? []) }
        }
        UserDefaults.standard.set(jusqua.timeIntervalSince1970, forKey: Self.cleControle)
        for t in Self.trajets(activites, maintenant: jusqua) {
            await m.recevoir(.trajet(debut: t.debut, fin: t.fin))
        }
    }

    /// Les segments « en voiture » (confiance moyenne ou haute). Un arrêt de
    /// moins de 3 min (feu rouge, péage) ne coupe pas le trajet ; le dernier
    /// reste ouvert s'il dure encore.
    static func trajets(_ a: [CMMotionActivity], maintenant: Date) -> [(debut: Date, fin: Date?)] {
        var sortie: [(debut: Date, fin: Date?)] = []
        var debut: Date?
        var arret: Date? // la voiture a cessé ici… peut-être
        func clore(_ d: Date, _ f: Date) { if f.timeIntervalSince(d) >= 180 { sortie.append((d, f)) } }
        for x in a.sorted(by: { $0.startDate < $1.startDate }) {
            let voiture = x.automotive && x.confidence != .low
            if voiture {
                if let d = debut, let f = arret {
                    if x.startDate.timeIntervalSince(f) > 180 {
                        clore(d, f)
                        debut = x.startDate
                    }
                    arret = nil
                } else if debut == nil {
                    debut = x.startDate
                }
            } else if debut != nil, arret == nil {
                arret = x.startDate
            }
        }
        if let d = debut {
            if let f = arret, maintenant.timeIntervalSince(f) > 180 { clore(d, f) }
            else if maintenant.timeIntervalSince(d) >= 180 { sortie.append((d, nil)) }
        }
        return sortie
    }
}
