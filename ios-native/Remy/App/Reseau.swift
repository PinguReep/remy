import Foundation
import Network
import RemyCore

/// Le réseau de l'iPhone (Wi-Fi, données, rien). Il ne dit pas si la tour est
/// joignable (Tailscale peut être coupé sur un bon réseau) : seulement si ça
/// vaut la peine d'essayer. Au retour du réseau, l'app relit la journée et
/// envoie les gestes restés sur l'iPhone.
@MainActor
final class SurveillanceReseau {
    private let moniteur = NWPathMonitor()

    func demarrer(_ app: AppModel) {
        moniteur.pathUpdateHandler = { [weak app] chemin in
            let horsLigne = chemin.status != .satisfied
            Task { @MainActor in await app?.changerReseau(horsLigne: horsLigne) }
        }
        moniteur.start(queue: DispatchQueue(label: "remy.reseau"))
    }
}
