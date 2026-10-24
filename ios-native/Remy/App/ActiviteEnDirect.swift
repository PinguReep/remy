import ActivityKit
import Foundation
import RemyCore

// L'activité en direct « tâche en cours » (24/10) : écran verrouillé et
// Dynamic Island, avec Terminer et +15 min. Sans push (pas d'APNs) : l'app la
// démarre, la suit tant qu'elle est ouverte, et la barre de temps et la
// minuterie avancent seules (ProgressView/Text(timerInterval:)). À la fin
// prévue, iOS la marque périmée (staleDate) ; l'app la ferme au plus tard à
// son prochain passage. Aucun réseau, aucun appel IA.

@MainActor
final class ActiviteEnDirect {
    static let partagee = ActiviteEnDirect()

    /// Réglages › Activité en direct (coupée : jamais d'activité).
    static let cleActive = "activite.active"
    /// Démarrer seule quand une tâche commence, l'app ouverte.
    static let cleAuto = "activite.auto"

    var active: Bool { UserDefaults.standard.object(forKey: Self.cleActive) as? Bool ?? true }
    var auto: Bool { UserDefaults.standard.object(forKey: Self.cleAuto) as? Bool ?? true }
    /// Sam les a coupées dans les réglages de l'iPhone (ou l'appareil ne sait pas).
    var autorisee: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    /// Les tâches déjà montrées (ou fermées d'un glissement) : jamais relancées
    /// d'office ; « Commencer » les relance.
    private var dejaVues: Set<String> = []
    /// Les tâches dont un bouton de l'activité est en train d'agir : un
    /// deuxième toucher n'y refait rien, et le suivi n'y touche pas.
    private var occupees: Set<String> = []
    private weak var app: AppModel?

    /// L'activité affichée (une à la fois).
    private var actuelle: Activity<ActiviteTache>? {
        Activity<ActiviteTache>.activities.first { $0.activityState == .active || $0.activityState == .stale }
    }

    /// Au lancement : les boutons de l'activité et « Commencer » passent par ici.
    func brancher(_ app: AppModel) {
        self.app = app
        app.tableau.surCommencee = { [weak self] e in await self?.demarrer(e) }
        Raccourcis.terminer = { [weak self] id, titre in await self?.terminerDepuisActivite(id: id, titre: titre) }
        Raccourcis.prolonger = { [weak self] id, minutes in await self?.prolongerDepuisActivite(id: id, minutes: minutes) }
        // Une activité d'un lancement précédent : ses tâches ne repartent pas d'office.
        for a in Activity<ActiviteTache>.activities { dejaVues.insert(a.attributes.id) }
    }

    // MARK: Démarrer, suivre, finir

    /// « Commencer » : l'activité démarre, même si le démarrage seul est coupé.
    func demarrer(_ e: ElementJour) async {
        guard active, autorisee, let paire = ActiviteTache.depuis(e) else { return }
        let (attributs, etat) = paire
        dejaVues.insert(e.id)
        if let a = actuelle {
            if a.attributes.id == e.id {
                await a.update(ActivityContent(state: etat, staleDate: etat.fin))
                return
            }
            await a.end(nil, dismissalPolicy: .immediate)
            // Pendant l'attente, un autre appel (suivi, double toucher) a pu
            // la lancer : jamais deux activités pour la même tâche.
            if let b = actuelle, b.attributes.id == e.id { return }
        }
        do {
            _ = try Activity<ActiviteTache>.request(attributes: attributs,
                                     content: ActivityContent(state: etat, staleDate: etat.fin, relevanceScore: 100),
                                     pushType: nil)
        } catch {
            // Trop d'activités, coupées entre-temps, ou l'app déjà en
            // arrière-plan : l'app reste la référence, le suivi réessaiera.
            dejaVues.remove(e.id)
            print("Activité en direct refusée : \(error.localizedDescription)")
        }
    }

    /// L'app ouverte : l'activité suit la journée (prolongée, cochée, finie)
    /// et, si Sam le veut, démarre quand une tâche commence.
    func suivre() async {
        guard let app else { return }
        guard active else { await toutArreter(); return }
        let a = actuelle
        let suivie = a.map { (id: $0.attributes.id, fin: $0.content.state.fin) }
        let gestes = SuiviActivite.gestes(journee: app.tableau.journee, maintenant: Date().millis, suivie: suivie,
                                          auto: auto && autorisee, dejaVues: dejaVues,
                                          copie: app.tableau.copieLocale, occupees: occupees)
        for g in gestes {
            switch g {
            case .mettreAJour(let e):
                guard let a, var etat = ActiviteTache.depuis(e)?.1 else { continue }
                etat.message = a.content.state.message
                await a.update(ActivityContent(state: etat, staleDate: etat.fin))
            case .terminer:
                guard let a else { continue }
                var etat = a.content.state
                let finie = etat.fin <= Date()
                etat.message = finie ? "Temps écoulé" : nil
                // Cochée dans l'app : partie tout de suite ; l'heure passée : visible encore 15 min.
                await a.end(ActivityContent(state: etat, staleDate: nil),
                            dismissalPolicy: finie ? .after(Date().addingTimeInterval(15 * 60)) : .immediate)
            case .demarrer(let e):
                await demarrer(e)
            }
        }
    }

    /// Réglage coupé, ou déconnexion : plus rien à l'écran.
    func toutArreter() async {
        for a in Activity<ActiviteTache>.activities {
            await a.end(nil, dismissalPolicy: .immediate)
        }
    }

    // MARK: Les boutons de l'activité (dans le processus de l'app)

    private func activite(_ id: String) -> Activity<ActiviteTache>? {
        Activity<ActiviteTache>.activities.first { $0.attributes.id == id }
    }

    /// « Terminer » : « Fait » s'affiche tout de suite ; la coche part comme
    /// depuis l'app (2 s d'annulation, file d'envoi si pas de réseau).
    func terminerDepuisActivite(id: String, titre: String) async {
        // Un deuxième toucher pendant le premier : rien de plus.
        guard let app, occupees.insert(id).inserted else { return }
        defer { occupees.remove(id) }
        let a = activite(id)
        if let a {
            var etat = a.content.state
            etat.terminee = true
            etat.message = nil
            await a.update(ActivityContent(state: etat, staleDate: nil))
        }
        let issue = await app.tableau.terminer(id: id, titre: titre)
        guard let a else { return }
        var etat = a.content.state
        switch issue {
        case .faite, .deja:
            await a.end(ActivityContent(state: etat, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(4)))
        case .renoncee:
            // « Annuler » touché dans l'app pendant le délai : la tâche reste en cours.
            etat.terminee = false
            etat.message = nil
            await a.update(ActivityContent(state: etat, staleDate: etat.fin))
        case .enAttente:
            etat.message = "Pas de réseau : partira dès que Rémy sera joignable."
            await a.end(ActivityContent(state: etat, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(30)))
        case .echec:
            // La tâche est revenue : l'activité aussi, avec la raison.
            etat.terminee = false
            etat.message = app.message?.texte ?? "Motion a refusé : réessaie depuis Rémy."
            await a.update(ActivityContent(state: etat, staleDate: etat.fin))
        }
    }

    /// « +15 min » : la prolongation de « Gérer » (durée absolue, annulable
    /// depuis l'historique). La nouvelle fin s'affiche quand Motion a dit oui.
    func prolongerDepuisActivite(id: String, minutes: Int) async {
        // Un deuxième toucher pendant le premier : rien de plus (sinon la
        // barre gagnerait 30 min quand Motion n'en a reçu que 15 de plus).
        guard let app, let a = activite(id), occupees.insert(id).inserted else { return }
        defer { occupees.remove(id) }
        // Le toucher se voit tout de suite ; la nouvelle fin, quand Motion a dit oui.
        var avant = a.content.state
        avant.message = "+\(minutes) min : Motion recalcule…"
        await a.update(ActivityContent(state: avant, staleDate: avant.fin))
        // Lancée en arrière-plan : la journée gardée sur l'iPhone, si besoin.
        if app.tableau.donnees == nil { app.tableau.restaurer() }
        let e = app.tableau.donnees?.journee?.items?.first { $0.type == "tache" && $0.id == id } ?? a.attributes.element(avant)
        let ok = await app.tableau.prolonger(e, de: minutes)
        // Relue après l'attente : c'est l'état affiché maintenant qui compte.
        var etat = a.content.state
        if ok {
            etat.fin = max(etat.fin, Date()).addingTimeInterval(Double(minutes) * 60)
            etat.duree = e.duree.map { $0 + minutes }
            etat.message = "+\(minutes) min · Motion recalcule la suite"
        } else {
            etat.message = app.message?.texte ?? "Pas prolongée : réessaie depuis Rémy."
        }
        await a.update(ActivityContent(state: etat, staleDate: etat.fin))
    }
}
