import Foundation
import Observation

// L'état des écrans. Les vues SwiftUI ne font que le lire et appeler ces
// méthodes : toute la logique vit ici, compilée et testée sans iPhone.

/// Un message bref en bas de l'écran. Quand l'action est réversible, il porte
/// son « Annuler ».
public struct MessageBas: Identifiable, Equatable {
    public let id: UUID
    public let texte: String
    public let annuler: (@MainActor () -> Void)?
    /// Durée d'affichage imposée, en secondes (le bandeau d'une coche ne vit
    /// que le temps où « Annuler » n'envoie rien). Sinon 4 s, ou 6 s avec « Annuler ».
    public let duree: Double?

    public init(texte: String, annuler: (@MainActor () -> Void)? = nil, duree: Double? = nil) {
        self.id = UUID()
        self.texte = texte
        self.annuler = annuler
        self.duree = duree
    }

    public static func == (a: MessageBas, b: MessageBas) -> Bool { a.id == b.id }
}

/// Les phrases que Rémy reçoit quand Sam touche une ligne de sa journée.
/// Elles sont préparées dans le composeur, jamais envoyées sans lui.
public enum Brouillons {
    public static let journee = "Organise ma journée : regarde mon agenda et mes tâches, dis-moi par quoi commencer et ce qui est en retard. Pose tes questions d'un coup si tu en as."
    public static let retards = "Qu'est-ce qui est en retard, et par quoi je commence ?"

    /// La demande de plan du jour, telle que l'app ou le site l'envoie.
    public static func estDemandeDePlan(_ texte: String) -> Bool {
        ["Organise ma journée", "Rémy, organisons ma journée", "Rémy, aide-moi à organiser ma journée"]
            .contains { texte.hasPrefix($0) }
    }

    public static func rendezVous(_ e: ElementJour) -> String {
        "Aide-moi à préparer « \(e.titre) » (\(Format.heure(e.debut)))."
    }

    public static func tache(_ titre: String) -> String {
        "Aide-moi à avancer sur « \(titre) »."
    }

    public static func retard(_ t: TacheResume) -> String {
        "« \(t.titre) » est en retard" + (t.echeance.map { " depuis le \(Format.jourCourt($0.date))" } ?? "") + ". Qu'est-ce que je fais ?"
    }

    public static func sujet(_ s: Sujet, generatedAt: Millis?, maintenant: Date = Date()) -> String {
        let quand = Nuit.estRecente(generatedAt, maintenant: maintenant) || generatedAt == nil
            ? "cette nuit" : "le " + Format.jourCourt((generatedAt ?? 0).date)
        return "À propos de ce que tu as remarqué \(quand) : « \(s.texte) ». Qu'est-ce que tu proposes ?"
    }
}

@MainActor
@Observable
public final class AppModel {
    public enum Phase: Equatable, Sendable { case demarrage, connexion, pret }
    public enum Onglet: Hashable, Sendable { case aujourdhui, remy }

    public var phase: Phase = .demarrage
    /// L'onglet affiché : « Aujourd'hui » est l'accueil.
    public var onglet: Onglet = .aujourdhui
    /// Message bref affiché en bas de l'écran.
    public var message: MessageBas?
    public var reglagesOuverts = false
    /// Le serveur auquel l'app parle (nil tant qu'il n'a pas répondu, ou s'il
    /// est trop ancien pour connaître /api/version).
    public var serveur: VersionServeur?
    /// Le nom sous lequel cet iPhone apparaît dans « Appareils connectés »
    /// (posé par l'app au lancement).
    @ObservationIgnored public var nomAppareil = "iPhone"
    /// Les appareils connectés à la tour (Réglages), nil tant que pas lus.
    public var appareils: [Appareil]?
    public var erreurAppareils: String?
    public let api: ClientAPI
    public let tableau: TableauModel
    public let chat: ChatModel
    /// La dictée du composeur et le mode appel (le micro et la voix sont
    /// branchés par l'app : le cœur ne connaît pas AVFoundation).
    public let dictee: DicteeModel
    public let appel: AppelModel

    public init(api: ClientAPI = ClientAPI()) {
        self.api = api
        self.tableau = TableauModel(api: api)
        self.chat = ChatModel(api: api)
        self.dictee = DicteeModel(api: api)
        self.appel = AppelModel(api: api)
        tableau.app = self
        chat.app = self
        dictee.app = self
        appel.app = self
        chat.surSujetsTraites = { [weak self] in
            Task { await self?.tableau.charger() }
        }
    }

    /// Le texte du message en cours (pratique pour les tests).
    public var toast: String? { message?.texte }

    /// Rend l'identifiant du message : qui l'a posé peut le retirer, et
    /// seulement lui (un message plus récent reste affiché).
    @discardableResult
    public func dire(_ texte: String, annuler: (@MainActor () -> Void)? = nil, duree: Double? = nil) -> UUID {
        let m = MessageBas(texte: texte, annuler: annuler, duree: duree)
        message = m
        return m.id
    }

    /// Au lancement : si le cookie de session est encore bon, on entre direct.
    public func demarrer() async {
        do {
            _ = try await api.conversations()
            phase = .pret
            await chargerTout()
        } catch ErreurAPI.nonConnecte {
            phase = .connexion
        } catch {
            // Hors ligne au lancement : on montre l'app quand même, et chaque
            // écran dit ce qui manque (avec « Réessayer ») plutôt qu'un
            // squelette qui tourne sans fin.
            phase = .pret
            await chargerTout()
        }
    }

    public func connecter(motDePasse: String) async throws {
        try await api.connexion(motDePasse: motDePasse, appareil: nomAppareil)
        phase = .pret
        await chargerTout()
    }

    /// Tout revient à zéro : rien de la session précédente ne doit rester
    /// affiché (brouillon, feuille ouverte, tâches cochées).
    public func deconnecter() async {
        appel.raccrocher()
        dictee.annuler(sansMessage: true)
        await api.deconnexion()
        chat.vider()
        tableau.vider()
        onglet = .aujourdhui
        reglagesOuverts = false
        message = nil
        phase = .connexion
    }

    public func chargerTout(frais: Bool = false) async {
        async let a: Void = tableau.charger(frais: frais)
        async let b: Void = chat.rafraichirListe()
        async let c: Void = lireVersionServeur()
        _ = await (a, b, c)
        // Installée avant le Lot 0 : l'app n'a qu'un cookie. Elle demande son
        // jeton d'appareil une fois, sans redemander le mot de passe.
        if serveur?.sait("appareils") == true { try? await api.obtenirJeton(appareil: nomAppareil) }
    }

    public func chargerAppareils() async {
        erreurAppareils = nil
        do {
            appareils = try await api.appareils()
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { signaler(e); return }
            erreurAppareils = (error as? LocalizedError)?.errorDescription ?? "Liste indisponible."
        }
    }

    /// Déconnecte un appareil. Celui-ci : c'est une déconnexion tout court.
    public func deconnecterAppareil(_ a: Appareil) async {
        if a.actuel == true {
            await deconnecter()
            return
        }
        do {
            try await api.deconnecterAppareil(a.id)
            appareils?.removeAll { $0.id == a.id }
            dire("« \(a.nom) » est déconnecté : il devra retaper le mot de passe.")
        } catch {
            signaler(error)
        }
    }

    /// Une tour pas encore mise à jour ne connaît pas /api/version : ce n'est
    /// pas une erreur à montrer, l'app fait simplement sans ses nouveautés.
    func lireVersionServeur() async {
        if let v = try? await api.versionServeur() {
            serveur = v
            api.rejeuSur = v.sait("propositions-v1")
        }
    }

    /// Ouvre une conversation et bascule sur l'onglet Rémy.
    public func ouvrirConversation(_ id: String) async {
        if await chat.ouvrir(id) { onglet = .remy }
    }

    /// Nouveau fil nommé, avec une première demande. Le fil n'est créé sur le
    /// serveur qu'au moment de l'envoi, déjà renommé (pas de titre deviné, pas
    /// de fil vide). Un appel IA : uniquement sur un geste de Sam.
    public func nouveauFil(titre: String, message texte: String) async {
        chat.fermer()
        chat.titreEnAttente = String(titre.prefix(80))
        onglet = .remy
        await chat.envoyer(texte)
    }

    /// Le fil « 24/09/2026 · Journée » existe déjà (ouvert ici ou sur le site).
    public var filDuJourExiste: Bool {
        let t = Fils.journee(Date())
        return chat.conversations.contains { $0.title == t }
    }

    /// « Organiser ma journée » : une conversation neuve à chaque fois (Sam,
    /// 09/10). Le plan d'un matin n'est plus celui de l'après-midi ; la mémoire
    /// de Rémy garde le lien.
    public func organiserJournee() async {
        if chat.envoi {
            dire("Rémy finit sa réponse, réessaie dans un instant.")
            return
        }
        await nouveauFil(titre: Fils.journee(Date()), message: Brouillons.journee)
    }

    /// Prépare une question dans le composeur de Rémy, sans l'envoyer : Sam
    /// relit, complète, envoie. Rend `false` sans rien toucher si un autre
    /// brouillon est en cours (la vue demande alors s'il faut le remplacer).
    @discardableResult
    public func preparer(_ texte: String, dansFil titre: String, remplacer: Bool = false) async -> Bool {
        let enCours = chat.brouillon.trimmingCharacters(in: .whitespacesAndNewlines)
        // Un message en file d'attente compte comme un brouillon : changer de
        // fil le ramènerait au composeur, où il serait écrasé sans un mot.
        let enFile = !chat.fileEnvoi.isEmpty
        if ((!enCours.isEmpty && enCours != texte) || enFile) && !remplacer { return false }
        if remplacer { chat.oublierFile() }
        // Une conversation NEUVE à chaque geste (Sam, 09/10 : tout revenait
        // dans le même fil du jour). La mémoire de Rémy fait le lien entre les
        // conversations ; le titre est deviné au premier échange. `titre` ne sert
        // plus qu'à garder la signature des appelants.
        _ = titre
        chat.fermer()
        chat.modeRetenir = false
        chat.brouillon = texte
        chat.focusDemande = true
        onglet = .remy
        return true
    }

    public func signaler(_ erreur: Error) {
        if let e = erreur as? ErreurAPI, e == .nonConnecte {
            phase = .connexion
            return
        }
        dire((erreur as? LocalizedError)?.errorDescription ?? "Action impossible — réessaie.")
    }

    /// Ouvre (ou crée) la conversation d'une étape « Faire connaissance », et
    /// envoie son amorce si elle est neuve. Une étape n'a qu'UNE conversation.
    @discardableResult
    public func lancerSession(_ s: SessionOnboarding) async -> Bool {
        guard var etat = tableau.donnees?.setup else { return false }
        if chat.envoi {
            dire("Rémy finit sa réponse, réessaie dans un instant.")
            return false
        }
        var etats = etat.etats ?? [:]
        var convs = etat.convs ?? [:]
        do {
            if let id = convs[s.id], let existante = try? await api.conversation(id), !existante.messages.isEmpty {
                onglet = .remy
                return await chat.ouvrir(existante)
            }
            let conv = try await api.nouvelleConversation(session: s.id)
            let neuve = conv.messages.isEmpty
            convs[s.id] = conv.id
            if neuve && etats[s.id] != "faite" { etats[s.id] = "en_cours" }
            etat.etats = etats
            etat.convs = convs
            tableau.donnees?.setup = etat
            do {
                try await api.enregistrerOnboarding(etats: etats, convs: convs, vuA: etat.updatedAt)
            } catch {
                dire("Étape ouverte, mais son suivi n'a pas pu être enregistré.")
            }
            guard await chat.ouvrir(conv) else { return false }
            onglet = .remy
            if neuve, let amorce = s.prompt { await chat.envoyer(amorce) }
            return true
        } catch {
            signaler(error)
            return false
        }
    }
}

// MARK: - Aujourd'hui

/// Une tâche cochée depuis l'app : elle quitte la journée tout de suite, et
/// reste annulable depuis la liste « Cochées tout à l'heure ».
public struct Cochee: Identifiable, Equatable, Sendable {
    public let id: String
    public var titre: String
    public var ledgerId: String?
    public var enCours: Bool
    public let jour: String
    /// Pas encore envoyée à Motion : pendant ces deux secondes, « Annuler »
    /// la fait revenir sans rien écrire nulle part.
    public var enAttente: Bool = false
}

/// Ce qu'est devenue une coche.
public enum IssueCoche: Equatable, Sendable {
    /// Écrite dans Motion.
    case faite
    /// Sam s'est ravisé pendant le délai : rien n'est parti.
    case renoncee
    /// Motion a refusé ou n'a pas répondu : la tâche est revenue, et c'est dit.
    case echec
    /// Déjà cochée (double toucher).
    case deja
}

@MainActor
@Observable
public final class TableauModel {
    public var donnees: TableauDeBord?
    public private(set) var chargement = false
    public private(set) var erreur: String?
    /// Vrai quand le dernier échec vient du réseau (et non du serveur).
    public private(set) var erreurReseau = false
    public private(set) var misAJour: Date?
    public private(set) var cochees: [Cochee] = []

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI
    /// Le temps (secondes) pendant lequel une coche s'annule sans rien envoyer.
    /// Sam l'a voulu court : « deux secondes, pas plus ».
    @ObservationIgnored public var delaiAnnulation: Double = 2
    /// « Annuler » touché pile pendant l'envoi : la coche sera défaite dès
    /// que Motion l'aura enregistrée.
    @ObservationIgnored private var aDefaire: Set<String> = []

    public init(api: ClientAPI) { self.api = api }

    public func vider() {
        donnees = nil
        misAJour = nil
        erreur = nil
        erreurReseau = false
        cochees = []
        aDefaire = []
    }

    public func charger(frais: Bool = false) async {
        guard !chargement else { return }
        chargement = true
        defer { chargement = false }
        do {
            donnees = try await api.tableauDeBord(frais: frais)
            misAJour = Date()
            erreur = nil
            erreurReseau = false
            let aujourdhui = Format.jourISO(Date())
            cochees.removeAll { $0.jour != aujourdhui }
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            if case ErreurAPI.reseau = error { erreurReseau = true } else { erreurReseau = false }
            erreur = (error as? LocalizedError)?.errorDescription ?? "Chargement impossible."
        }
    }

    /// La journée à afficher, sans les tâches cochées depuis l'app. Le serveur
    /// garde quelques minutes sa liste Motion en cache : sans ce filtre, une
    /// tâche cochée pourrait revenir au rafraîchissement suivant.
    public var journee: Journee? {
        guard var j = donnees?.journee else { return nil }
        let ids = Set(cochees.map(\.id))
        guard !ids.isEmpty else { return j }
        j.items = j.items?.filter { !($0.type == "tache" && ids.contains($0.id)) }
        j.aFaire = j.aFaire?.filter { !ids.contains($0.id) }
        if var r = j.retard {
            let avant = r.items.count
            r.items = r.items.filter { !ids.contains($0.id) }
            r.total = max(0, r.total - (avant - r.items.count))
            j.retard = r
        }
        return j
    }

    /// Marque une tâche Motion comme faite. Optimiste : elle quitte la journée
    /// à l'instant même, avec un bandeau « Annuler » de deux secondes. Pendant
    /// ce délai RIEN n'est envoyé (Motion est lent : attendre sa réponse pour
    /// faire disparaître la ligne rendait la coche molle). Le délai passé,
    /// l'écriture part ; si Motion refuse, la tâche revient et c'est dit.
    /// Aucun appel IA.
    @discardableResult
    public func terminer(id: String, titre: String) async -> IssueCoche {
        guard !cochees.contains(where: { $0.id == id }) else { return .deja }
        cochees.append(Cochee(id: id, titre: titre, ledgerId: nil, enCours: false,
                              jour: Format.jourISO(Date()), enAttente: true))
        let bandeau = app?.dire("« \(titre) » : fait.", annuler: { [weak self] in
            self?.renoncer(id)
        }, duree: delaiAnnulation)
        if delaiAnnulation > 0 { try? await Task.sleep(nanoseconds: UInt64(delaiAnnulation * 1_000_000_000)) }
        // Annulée pendant le délai (ou session fermée) : rien n'est parti.
        guard let i = cochees.firstIndex(where: { $0.id == id }), cochees[i].enAttente else { return .renoncee }
        // Le délai est passé : le bandeau ne peut plus rien annuler sans écrire.
        if let bandeau, app?.message?.id == bandeau { app?.message = nil }
        cochees[i].enAttente = false
        cochees[i].enCours = true
        let p = Proposition(source: "motion", resume: "Coché depuis l'app",
                            actions: [ActionProposee(type: "terminer", nom: titre, id: id)])
        do {
            // Une clé par geste : renvoyée après une coupure, la coche n'est pas refaite.
            let r = try await api.appliquer(p, convId: nil, index: nil, idCommande: UUID().uuidString)
            let res = r.results?.first
            if (r.echecs ?? 0) > 0 || res?.ok == false {
                cochees.removeAll { $0.id == id }
                aDefaire.remove(id)
                app?.dire("Motion n'a pas pu marquer « \(titre) » comme fait : \(res?.erreur ?? "raison inconnue").")
                return .echec
            }
            if let j = cochees.firstIndex(where: { $0.id == id }) {
                cochees[j].ledgerId = r.ledgerId
                cochees[j].enCours = false
            }
            if aDefaire.remove(id) != nil { await annulerCoche(id) }
            return .faite
        } catch {
            cochees.removeAll { $0.id == id }
            aDefaire.remove(id)
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return .echec }
            if let e = error as? ErreurAPI, case .reseau = e {
                // Réponse perdue : la coche a peut-être été faite. On relit la
                // liste au lieu d'affirmer que la tâche est de retour.
                app?.dire("Réseau coupé pendant la coche de « \(titre) » : je relis la liste pour vérifier.")
                await charger(frais: true)
                return .echec
            }
            let raison = (error as? LocalizedError)?.errorDescription ?? "erreur"
            app?.dire("Motion n'a pas pu marquer « \(titre) » comme fait : \(raison) La tâche est de retour.")
            return .echec
        }
    }

    /// Replanifier une tâche depuis « Aujourd'hui » (Sam, 09/10 : il touchait
    /// une tâche en retard pour la décaler, et rien ne le permettait). Seule
    /// l'échéance change ; Motion recalcule le créneau. Annulable depuis le
    /// bandeau, comme une coche.
    @discardableResult
    public func replanifier(id: String, titre: String, echeance: Date) async -> Bool {
        let p = Proposition(source: "motion", resume: "Replanifié depuis l'app",
                            actions: [ActionProposee(type: "modifier", nom: titre,
                                                     echeance: Format.isoAvecFuseau(echeance), id: id)])
        do {
            let r = try await api.appliquer(p, convId: nil, index: nil, idCommande: UUID().uuidString)
            let res = r.results?.first
            if (r.echecs ?? 0) > 0 || res?.ok == false {
                _ = app?.dire("Motion n'a pas pu replanifier « \(titre) » : \(res?.erreur ?? "raison inconnue").")
                return false
            }
            var annuler: (@MainActor () -> Void)? = nil
            if let ledger = r.ledgerId {
                annuler = { [weak self] in
                    Task { await self?.annulerReplanification(ledger, titre: titre) }
                }
            }
            _ = app?.dire("« \(titre) » : à faire d'ici \(Format.jourLong(echeance)).", annuler: annuler)
            await charger(frais: true)
            return true
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            let raison = (error as? LocalizedError)?.errorDescription ?? "erreur"
            _ = app?.dire("Motion n'a pas pu replanifier « \(titre) » : \(raison)")
            return false
        }
    }

    private func annulerReplanification(_ ledger: String, titre: String) async {
        do {
            let r = try await api.annuler(Proposition(source: "motion", resume: nil, actions: [], ledgerId: ledger))
            _ = app?.dire(r.ok == false
                ? "Impossible de remettre l'ancienne échéance de « \(titre) »."
                : "« \(titre) » : ancienne échéance remise.")
            await charger(frais: true)
        } catch {
            app?.signaler(error)
        }
    }

    /// « Annuler » sur le bandeau (ou sur la ligne) d'une coche pas encore
    /// envoyée : la tâche revient, Motion n'en saura rien. Trop tard (l'envoi
    /// vient de partir) : elle est défaite dès que Motion l'a enregistrée.
    public func renoncer(_ id: String) {
        guard let i = cochees.firstIndex(where: { $0.id == id }) else { return }
        if cochees[i].enAttente {
            cochees.remove(at: i)
        } else if cochees[i].ledgerId != nil {
            Task { await annulerCoche(id) }
        } else {
            aDefaire.insert(id)
        }
    }

    /// Défait une coche : la tâche redevient ouverte dans Motion.
    public func annulerCoche(_ id: String) async {
        guard let i = cochees.firstIndex(where: { $0.id == id }), let ledger = cochees[i].ledgerId else { return }
        let titre = cochees[i].titre
        cochees[i].enCours = true
        do {
            let r = try await api.annuler(Proposition(source: "motion", resume: nil, actions: [], ledgerId: ledger))
            cochees.removeAll { $0.id == id }
            app?.dire(r.ok == false
                ? "Annulation incomplète : vérifie « \(titre) » dans Motion."
                : "Annulé : « \(titre) » est de retour.")
            await charger()
        } catch {
            if let j = cochees.firstIndex(where: { $0.id == id }) { cochees[j].enCours = false }
            app?.signaler(error)
        }
    }

    /// Trier un sujet de la nuit : traité (barré) ou laissé de côté (grisé,
    /// jamais reproposé). Optimiste, et réversible (« Rouvrir »).
    public func changer(_ sujet: Sujet, vers etat: String) async {
        guard let i = donnees?.briefing?.items?.firstIndex(where: { $0.id == sujet.id }) else { return }
        let avant = donnees?.briefing?.items?[i].etat
        donnees?.briefing?.items?[i].etat = etat
        do {
            try await api.etatSujet(sujet.id, etat: etat)
            let revenir: @MainActor () -> Void = { [weak self] in
                Task { await self?.changer(sujet, vers: avant ?? "ouvert") }
            }
            switch etat {
            case "traite": app?.dire("Noté comme fait.", annuler: revenir)
            case "ignore": app?.dire("Laissé de côté : Rémy ne le reproposera pas.", annuler: revenir)
            default: break
            }
        } catch {
            if let j = donnees?.briefing?.items?.firstIndex(where: { $0.id == sujet.id }) {
                donnees?.briefing?.items?[j].etat = avant ?? "ouvert"
            }
            app?.signaler(error)
        }
    }

    /// La couverture de l'onboarding avance pendant la conversation (événement
    /// « done ») : la carte « Faire connaissance » suit sans recharger.
    func majCouverture(_ c: [String: [String]]) {
        guard donnees?.setup != nil else { return }
        var actuelle = donnees?.setup?.couverture ?? [:]
        for (k, v) in c { actuelle[k] = v }
        donnees?.setup?.couverture = actuelle
    }
}

// MARK: - Conversation

public struct LigneChat: Identifiable, Equatable, Sendable {
    public let id: UUID
    public var deToi: Bool
    public var texte: String
    public var puce: String?
    public var proposition: Proposition?
    public var indexMessage: Int?
    public var statut: String?
    public var erreur: String?
    public var enCours: Bool
    /// Le message de Sam qui a déclenché cette réponse (pour « Réessayer »).
    public var question: String?
    /// Auteur d'un fil importé (« ChatGPT »), sinon « Rémy ».
    public var auteur: String
    /// Réponse produite en mode secours (le routeur de modèles a échoué).
    public var secours: Bool
    /// Rémy demande l'accord de Sam avant une recherche web (V8).
    public var autorisation: Autorisation?

    public init(id: UUID = UUID(), deToi: Bool, texte: String, puce: String? = nil, proposition: Proposition? = nil,
                indexMessage: Int? = nil, statut: String? = nil, erreur: String? = nil, enCours: Bool = false,
                question: String? = nil, auteur: String = "Rémy", secours: Bool = false, autorisation: Autorisation? = nil) {
        self.id = id
        self.deToi = deToi
        self.texte = texte
        self.puce = puce
        self.proposition = proposition
        self.indexMessage = indexMessage
        self.statut = statut
        self.erreur = erreur
        self.enCours = enCours
        self.question = question
        self.auteur = auteur
        self.secours = secours
        self.autorisation = autorisation
    }
}

struct FinDeReponse: Decodable {
    var text: String?
    var model: String?
    var tier: String?
    var usd: Double?
    var session_done: String?
    var couverture: [String: [String]]?
}

struct Texte: Decodable { var text: String? }
struct MessageErreur: Decodable { var message: String? }
struct Titre: Decodable { var title: String? }

@MainActor
@Observable
public final class ChatModel {
    public private(set) var conversations: [ConversationResume] = []
    public private(set) var erreurListe: String?
    public private(set) var idCourant: String?
    public var titre = ""
    public private(set) var origine: Origine?
    /// L'étape « Faire connaissance » portée par le fil ouvert, s'il y en a une.
    public private(set) var sessionCourante: String?
    public private(set) var lignes: [LigneChat] = []
    public private(set) var envoi = false
    public private(set) var ouverture = false

    /// Le texte en cours dans le composeur (partagé : « Aujourd'hui » peut y
    /// préparer une question).
    public var brouillon = ""
    /// Le composeur doit prendre le clavier (brouillon préparé, « Nouvelle »).
    public var focusDemande = false
    /// Composeur en mode « Noter une idée » : le texte est retenu, sans réponse.
    public var modeRetenir = false
    public private(set) var captureEnCours = false
    /// Messages écrits pendant que Rémy répondait (« Envoyer après ») : ils
    /// partent ensemble, en un seul message, dès que la réponse est finie.
    public private(set) var fileEnvoi: [String] = []
    /// Une demande d'arrêt est en route vers le serveur.
    public private(set) var arretEnCours = false

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored var surSujetsTraites: (() -> Void)?
    @ObservationIgnored let api: ClientAPI
    /// Titre à donner au fil créé par le prochain envoi (fil pas encore créé).
    @ObservationIgnored var titreEnAttente: String?
    /// Change à chaque envoi et à chaque changement de fil : un flux dont la
    /// génération n'est plus la bonne s'arrête sans rien toucher.
    @ObservationIgnored private var generation = 0
    /// Délai entre deux relectures quand la connexion a lâché en route.
    @ObservationIgnored public var pasRecuperation: UInt64 = 4_000_000_000

    public init(api: ClientAPI) { self.api = api }

    public var lectureSeule: Bool { origine != nil }

    public func vider() {
        interrompreFlux()
        conversations = []
        erreurListe = nil
        idCourant = nil
        titre = ""
        origine = nil
        sessionCourante = nil
        lignes = []
        brouillon = ""
        focusDemande = false
        modeRetenir = false
        titreEnAttente = nil
        fileEnvoi = []
    }

    public func rafraichirListe() async {
        do {
            conversations = try await api.conversations()
            erreurListe = nil
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            erreurListe = (error as? LocalizedError)?.errorDescription ?? "Impossible de charger tes conversations."
        }
    }

    /// Changer de fil pendant que Rémy répond : le flux s'arrête ici, le
    /// serveur finit et enregistre la réponse (elle sera là à la réouverture).
    private func interrompreFlux() {
        guard envoi else { return }
        generation += 1
        envoi = false
    }

    @discardableResult
    public func ouvrir(_ id: String) async -> Bool {
        // Rouvrir le fil où Rémy est en train de répondre : rien à faire (le
        // recharger couperait la réponse).
        if id == idCourant && envoi { return true }
        ouverture = true
        defer { ouverture = false }
        do {
            return await ouvrir(try await api.conversation(id))
        } catch {
            app?.signaler(error)
            return false
        }
    }

    @discardableResult
    public func ouvrir(_ conv: Conversation) async -> Bool {
        // Un message « Envoyer après » visait l'autre fil : il revient au composeur.
        if conv.id != idCourant { reprendreFile() }
        interrompreFlux()
        idCourant = conv.id
        titre = conv.title
        origine = conv.origine
        sessionCourante = conv.session
        titreEnAttente = nil
        modeRetenir = false
        lignes = Self.lignes(de: conv)
        reprendreSiEnCours(conv)
        if !conversations.contains(where: { $0.id == conv.id }) { await rafraichirListe() }
        await verifierAnnulations()
        return true
    }

    /// Le fil se termine par une question toute récente sans réponse : Rémy
    /// est sans doute encore en train de répondre (quitté en cours de route).
    /// On attend sa réponse au lieu d'afficher une question orpheline.
    private func reprendreSiEnCours(_ conv: Conversation) {
        guard conv.origine == nil, let derniere = conv.messages.last, derniere.estDeToi,
              let maj = conv.updatedAt, Date().millis - maj < 5 * 60_000 else { return }
        let attente = LigneChat(deToi: false, texte: "", enCours: true, question: derniere.content)
        lignes.append(attente)
        envoi = true
        generation += 1
        let g = generation
        Task { [weak self] in
            guard let self else { return }
            await self.recuperer(convId: conv.id, question: derniere.content, ligne: attente.id, generation: g,
                                 statut: "Rémy termine sa réponse…")
            if self.generation == g {
                self.envoi = false
                await self.envoyerLaFile()
            }
        }
    }

    /// La carte à montrer pour une proposition : aucune si elle est vide ou si
    /// Sam l'a refusée (« Non merci » est enregistré sur la tour).
    static func carte(_ p: Proposition?) -> Proposition? {
        guard let p, !p.actions.isEmpty, !p.refusee else { return nil }
        return p
    }

    static func lignes(de conv: Conversation) -> [LigneChat] {
        let auteur = conv.origine?.nom ?? "Rémy"
        let derniere = conv.messages.count - 1
        return conv.messages.enumerated().map { i, m in
            // Une question posée depuis a remplacé la demande : elle a expiré.
            var demande = m.autorisation
            if demande?.enAttente == true && i != derniere { demande?.statut = "expiree" }
            return LigneChat(
                deToi: m.estDeToi,
                texte: m.estDeToi ? m.content : Marqueurs.retirer(m.content),
                puce: Format.puceModele(model: m.model, tier: m.tier, usd: m.usd),
                proposition: carte(m.proposal),
                indexMessage: i,
                auteur: auteur,
                secours: m.tier == "dégradé",
                autorisation: demande
            )
        }
    }

    /// Une proposition annulée (ici, sur le site, ou avant un redémarrage)
    /// garde « appliquée » dans la conversation : le journal dit la vérité.
    func verifierAnnulations() async {
        let convId = idCourant
        let aVerifier = lignes.contains {
            $0.proposition?.appliquee == true && $0.proposition?.ledgerId != nil && $0.proposition?.annulee != true
        }
        guard aVerifier, let entrees = try? await api.journal(), idCourant == convId else { return }
        let annulees = Set(entrees.filter { $0.annule == true }.map(\.id))
        for i in lignes.indices {
            if let l = lignes[i].proposition?.ledgerId, annulees.contains(l) { lignes[i].proposition?.annulee = true }
        }
    }

    /// « Nouvelle » : un écran vide, clavier ouvert. Le fil n'existe sur le
    /// serveur qu'au premier message — plus de fils vides dans la liste.
    public func nouvelle() {
        fermer()
        focusDemande = true
    }

    public func fermer() {
        reprendreFile()
        interrompreFlux()
        idCourant = nil
        titre = ""
        origine = nil
        sessionCourante = nil
        lignes = []
        titreEnAttente = nil
        modeRetenir = false
    }

    // MARK: Envoi

    /// Envoie un message et rend le texte final de la réponse (nil si elle a
    /// échoué). `appel` : le message vient du mode appel — Rémy répond court,
    /// sans markdown, pour être lu à voix haute. Les messages mis en file
    /// pendant la réponse partent juste après.
    @discardableResult
    public func envoyer(_ brut: String, appel: Bool = false) async -> String? {
        let reponse = await envoyerUn(brut, appel: appel)
        await envoyerLaFile()
        return reponse
    }

    /// « Envoyer après » : le message attend la fin de la réponse en cours.
    public func envoyerApres(_ brut: String) {
        let texte = brut.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !texte.isEmpty else { return }
        guard envoi else {
            Task { await envoyer(texte) }
            return
        }
        fileEnvoi.append(texte)
    }

    /// « Interrompre et envoyer » : Rémy s'arrête (le serveur garde sa réponse
    /// partielle, marquée « (interrompu) »), puis le message part — le modèle
    /// voit la réponse coupée, puis la suite de Sam.
    public func interrompreEtEnvoyer(_ brut: String) async {
        let texte = brut.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !texte.isEmpty else { return }
        guard envoi else {
            await envoyer(texte)
            return
        }
        fileEnvoi.insert(texte, at: 0)
        await arreter()
    }

    /// Le bouton stop : coupe la réponse en cours de ce fil. La fin du flux
    /// (« done », marqué interrompu) libère le composeur et vide la file.
    public func arreter() async {
        guard envoi, !arretEnCours else { return }
        guard let id = idCourant else {
            app?.dire("Rémy n'a pas encore commencé — réessaie dans un instant.")
            return
        }
        arretEnCours = true
        defer { arretEnCours = false }
        do {
            try await api.arreter(id)
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            app?.dire(fileEnvoi.isEmpty
                ? "Impossible d'interrompre Rémy — réessaie."
                : "Impossible d'interrompre Rémy : ton message partira à la fin de sa réponse.")
        }
    }

    /// Rend au composeur les messages en attente : rien n'est perdu.
    public func reprendreFile() {
        guard !fileEnvoi.isEmpty else { return }
        let texte = fileEnvoi.joined(separator: "\n\n")
        fileEnvoi = []
        let deja = brouillon.trimmingCharacters(in: .whitespacesAndNewlines)
        brouillon = deja.isEmpty ? texte : deja + "\n\n" + texte
    }

    func oublierFile() { fileEnvoi = [] }

    /// La réponse est finie : ce qui attendait part, en un seul message (ce
    /// sont des suites de la même pensée).
    func envoyerLaFile() async {
        guard !envoi, !fileEnvoi.isEmpty else { return }
        let texte = fileEnvoi.joined(separator: "\n\n")
        fileEnvoi = []
        await envoyer(texte)
    }

    /// Le texte dicté s'ajoute à ce qui est déjà écrit (jamais envoyé seul).
    public func ajouterDictee(_ texte: String) {
        let t = texte.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        var deja = brouillon
        while let c = deja.last, c.isWhitespace { deja.removeLast() }
        brouillon = deja.isEmpty ? t : deja + " " + t
    }

    private func envoyerUn(_ brut: String, appel: Bool) async -> String? {
        let texte = brut.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !texte.isEmpty, !envoi else { return nil }
        if lectureSeule {
            app?.dire("Conversation importée : touche « Continuer avec Rémy » pour lui en parler.")
            return nil
        }
        envoi = true
        generation += 1
        let g = generation
        if idCourant == nil {
            do {
                let conv = try await api.nouvelleConversation()
                guard generation == g else { return nil }
                idCourant = conv.id
                titre = conv.title
                if let t = titreEnAttente {
                    titreEnAttente = nil
                    // Renommé AVANT le premier message : le serveur ne devine
                    // pas de titre (un appel IA de moins). Un échec n'empêche
                    // pas d'envoyer.
                    if (try? await api.renommer(conv.id, titre: t)) != nil { titre = t }
                }
                // Visible tout de suite dans la liste (et pour « Organiser ma
                // journée »), sans attendre la fin de la réponse.
                if !conversations.contains(where: { $0.id == conv.id }) {
                    conversations.insert(ConversationResume(id: conv.id, title: titre, updatedAt: Date().millis), at: 0)
                }
            } catch {
                if generation == g {
                    envoi = false
                    // Le composeur a été vidé à l'envoi : le texte revient.
                    if brouillon.isEmpty && !appel { brouillon = texte }
                }
                app?.signaler(error)
                return nil
            }
        }
        guard generation == g, let convId = idCourant else { return nil }
        // Une demande d'autorisation en attente : « oui » / « non » y répond,
        // toute autre question la remplace. La tour tranche ; on relit après.
        let demandeEnAttente = lignes.contains { $0.autorisation?.enAttente == true }
        lignes.append(LigneChat(deToi: true, texte: texte))
        let reponse = LigneChat(deToi: false, texte: "", enCours: true, question: texte)
        lignes.append(reponse)
        let id = reponse.id

        let b = await lire(api.envoyerMessage(conversation: convId, texte: texte, appel: appel),
                           ligne: id, convId: convId, generation: g)
        if b.sessionExpiree { return nil }
        // Fil changé entre-temps : le serveur finit seul, rien à toucher ici.
        guard generation == g else { return nil }
        if !b.fini && !b.erreurServeur {
            await recuperer(convId: convId, question: texte, ligne: id, generation: g,
                            statut: b.recu ? "Connexion coupée, je récupère la réponse…" : "Connexion difficile, j'essaie de joindre Rémy…")
        }
        if generation == g { envoi = false }
        if demandeEnAttente { await relireAutorisations(convId) }
        await rafraichirListe()
        guard let l = lignes.first(where: { $0.id == id }), l.erreur == nil, !l.texte.isEmpty else { return nil }
        return l.texte
    }

    /// Ce qu'a donné un flux de réponse.
    struct BilanFlux {
        var fini = false
        var erreurServeur = false
        var recu = false
        /// Refus net du serveur (409, 404…), avant tout flux.
        var codeServeur: Int?
        var sessionExpiree = false
    }

    /// Lit un flux de réponse (message ou reprise après autorisation) et met
    /// à jour la ligne `id` au fil de l'eau.
    private func lire(_ flux: AsyncThrowingStream<EvenementSSE, Error>, ligne id: UUID, convId: String,
                      generation g: Int) async -> BilanFlux {
        var b = BilanFlux()
        var accumule = ""
        do {
            for try await e in flux {
                guard generation == g, let i = lignes.firstIndex(where: { $0.id == id }) else { break }
                b.recu = true
                switch e.nom {
                case "delta":
                    accumule += e.decode(Texte.self)?.text ?? ""
                    lignes[i].texte = Marqueurs.retirer(accumule)
                case "status":
                    lignes[i].statut = e.decode(Texte.self)?.text
                case "proposal":
                    if let p = e.decode(Proposition.self), !p.actions.isEmpty {
                        lignes[i].proposition = p
                        lignes[i].indexMessage = p.index
                    }
                case "autorisation":
                    // Rémy demande avant de chercher sur le web : rien n'est parti.
                    if let a = e.decode(Autorisation.self) {
                        lignes[i].autorisation = a
                        lignes[i].indexMessage = a.index
                    }
                case "traites":
                    surSujetsTraites?()
                    app?.dire("Rémy a noté un sujet de la nuit comme réglé.")
                case "title":
                    if let t = e.decode(Titre.self)?.title, idCourant == convId { titre = t }
                case "done":
                    b.fini = true
                    let f = e.decode(FinDeReponse.self)
                    // Le texte complet voyage dans « done » : il répare un flux
                    // qui aurait perdu des morceaux en route.
                    if let t = f?.text, !t.isEmpty { lignes[i].texte = Marqueurs.retirer(t) }
                    lignes[i].puce = Format.puceModele(model: f?.model, tier: f?.tier, usd: f?.usd)
                    lignes[i].secours = f?.tier == "dégradé"
                    lignes[i].statut = nil
                    lignes[i].enCours = false
                    if let c = f?.couverture { app?.tableau.majCouverture(c) }
                    if f?.session_done != nil {
                        sessionCourante = nil
                        app?.dire("Étape terminée : Rémy te connaît un peu mieux.")
                        surSujetsTraites?()
                    }
                case "error":
                    b.erreurServeur = true
                    lignes[i].enCours = false
                    lignes[i].statut = nil
                    lignes[i].erreur = e.decode(MessageErreur.self)?.message ?? "Erreur côté serveur."
                default:
                    break
                }
            }
        } catch let e as ErreurAPI where e == .nonConnecte {
            if let i = lignes.firstIndex(where: { $0.id == id }) {
                lignes[i].enCours = false
                lignes[i].erreur = "Session expirée — reconnecte-toi."
            }
            if generation == g { envoi = false }
            app?.signaler(e)
            b.sessionExpiree = true
        } catch ErreurAPI.serveur(let code, let message) {
            // Refus net du serveur (limite atteinte, fil introuvable…) : le
            // dire, sans faire semblant de récupérer une réponse.
            b.erreurServeur = true
            b.codeServeur = code
            if let i = lignes.firstIndex(where: { $0.id == id }) {
                lignes[i].enCours = false
                lignes[i].statut = nil
                lignes[i].erreur = message
            }
        } catch {
            // Réseau coupé en route : le serveur, lui, a peut-être fini.
        }
        return b
    }

    /// La connexion est morte en route (écran verrouillé, métro…) mais le serveur
    /// continue et enregistre la réponse. On relit la conversation jusqu'à la
    /// retrouver, au lieu d'afficher une erreur qui serait fausse.
    /// `apresDemande` : la réponse suit une demande d'autorisation (tap sur la
    /// carte, pas de message de Sam) — on la cherche juste après elle.
    func recuperer(convId: String, question: String, ligne id: UUID, generation g: Int, essais: Int = 37,
                   statut: String = "Connexion coupée, je récupère la réponse…", apresDemande: String? = nil) async {
        func maj(_ f: (inout LigneChat) -> Void) {
            if let i = lignes.firstIndex(where: { $0.id == id }) { f(&lignes[i]) }
        }
        maj { $0.statut = statut }
        var sansReseau = 0
        for _ in 0..<essais {
            try? await Task.sleep(nanoseconds: pasRecuperation)
            guard generation == g else { return }
            let conv: Conversation
            do {
                conv = try await api.conversation(convId)
                sansReseau = 0
            } catch {
                guard generation == g else { return }
                sansReseau += 1
                // Toujours injoignable après cinq essais : inutile de faire
                // attendre, Sam réessaiera quand le réseau reviendra.
                if sansReseau >= 5 {
                    maj { $0.enCours = false; $0.statut = nil; $0.erreur = "Pas de connexion : réessaie quand le réseau revient." }
                    return
                }
                continue
            }
            guard generation == g else { return }
            let debut: Int
            if let aid = apresDemande {
                // Toujours en attente sur la tour : l'accord n'est pas arrivé,
                // ou la recherche a échoué — la carte redevient utilisable.
                guard let k = conv.messages.firstIndex(where: { $0.autorisation?.id == aid }),
                      conv.messages[k].autorisation?.enAttente == false else {
                    maj { $0.enCours = false; $0.statut = nil; $0.erreur = "Ta réponse n'est pas arrivée jusqu'à Rémy — touche à nouveau la carte." }
                    remettreEnAttente(aid)
                    return
                }
                debut = k + 1
            } else {
                guard let iQuestion = conv.messages.lastIndex(where: { $0.estDeToi && $0.content == question }) else {
                    maj { $0.enCours = false; $0.statut = nil; $0.erreur = "Ton message n'est pas arrivé jusqu'à Rémy." }
                    return
                }
                debut = iQuestion + 1
            }
            if debut < conv.messages.count, let reponse = conv.messages[debut...].first(where: { !$0.estDeToi }) {
                maj {
                    $0.texte = Marqueurs.retirer(reponse.content)
                    $0.puce = Format.puceModele(model: reponse.model, tier: reponse.tier, usd: reponse.usd)
                    $0.secours = reponse.tier == "dégradé"
                    $0.proposition = Self.carte(reponse.proposal)
                    $0.indexMessage = conv.messages.firstIndex(of: reponse)
                    $0.enCours = false
                    $0.statut = nil
                }
                return
            }
        }
        maj { $0.enCours = false; $0.statut = nil; $0.erreur = "Impossible de récupérer la réponse." }
    }

    // MARK: Autorisations (V8)

    /// Sam répond à « Chercher sur le web ? ». Accordée, seule la question
    /// part chez Claude (sauf réglage « Envoi de contexte au cloud ») ;
    /// refusée, Rémy répond sans le web. Rend vrai si la réponse est arrivée.
    @discardableResult
    public func repondreAutorisation(_ ligne: LigneChat, accord: Bool) async -> Bool {
        guard !envoi, let convId = idCourant, let i = lignes.firstIndex(where: { $0.id == ligne.id }),
              let a = lignes[i].autorisation, a.enAttente else { return false }
        envoi = true
        generation += 1
        let g = generation
        lignes[i].autorisation?.statut = accord ? "acceptee" : "refusee"
        // Un essai raté juste avant : sa ligne d'erreur laisse la place.
        let ratees = Set(lignes[(i + 1)...].filter { !$0.deToi && $0.erreur != nil }.map(\.id))
        lignes.removeAll { ratees.contains($0.id) }
        let reponse = LigneChat(deToi: false, texte: "", statut: accord ? "Rémy cherche sur le web…" : "Rémy répond sans le web…",
                                enCours: true)
        lignes.append(reponse)
        let id = reponse.id
        let b = await lire(api.repondreAutorisation(conversation: convId, autorisation: a.id, accord: accord),
                           ligne: id, convId: convId, generation: g)
        if b.sessionExpiree {
            remettreEnAttente(a.id)
            return false
        }
        guard generation == g else { return false }
        if b.codeServeur == 409 || b.codeServeur == 404 {
            // Déjà répondu (sur le site ?) ou expirée : la tour dit l'état réel.
            let raison = lignes.first(where: { $0.id == id })?.erreur ?? "Demande expirée."
            envoi = false
            app?.dire(raison)
            await ouvrir(convId)
            return false
        }
        if b.erreurServeur {
            // La recherche a échoué : la tour remet la demande en attente.
            remettreEnAttente(a.id)
            if let j = lignes.firstIndex(where: { $0.id == id }), let e = lignes[j].erreur {
                lignes[j].erreur = e + " — touche à nouveau la carte pour réessayer."
            }
        } else if !b.fini {
            await recuperer(convId: convId, question: "", ligne: id, generation: g,
                            statut: b.recu ? "Connexion coupée, je récupère la réponse…" : "Connexion difficile, j'essaie de joindre Rémy…",
                            apresDemande: a.id)
        }
        if generation == g { envoi = false }
        await rafraichirListe()
        guard let l = lignes.first(where: { $0.id == id }) else { return false }
        return l.erreur == nil && !l.texte.isEmpty
    }

    private func remettreEnAttente(_ autorisation: String) {
        if let j = lignes.firstIndex(where: { $0.autorisation?.id == autorisation }) {
            lignes[j].autorisation?.statut = "en_attente"
        }
    }

    /// Après un message envoyé pendant qu'une demande attendait : la tour dit
    /// si c'était un « oui », un « non », ou une autre question (expirée).
    func relireAutorisations(_ convId: String) async {
        guard let conv = try? await api.conversation(convId), idCourant == convId else { return }
        let fraiches = Self.lignes(de: conv)
        for k in lignes.indices {
            guard let a = lignes[k].autorisation,
                  let neuve = fraiches.first(where: { $0.autorisation?.id == a.id })?.autorisation else { continue }
            lignes[k].autorisation?.statut = neuve.statut
        }
    }

    /// Retire la réponse ratée et sa question, puis renvoie la question.
    public func reessayer(_ ligne: LigneChat) async {
        guard let question = ligne.question, let i = lignes.firstIndex(where: { $0.id == ligne.id }) else { return }
        lignes.remove(at: i)
        if i > 0, lignes[i - 1].deToi { lignes.remove(at: i - 1) }
        await envoyer(question)
    }

    // MARK: Retenir (capture sans conversation)

    /// Rémy retient le texte du composeur sans répondre ni poser de question.
    /// `source` : « note » (une idée de Sam), « chatgpt » ou « claude » (un
    /// extrait d'une autre IA — jamais présenté comme la parole de Sam).
    public func retenir(source: String = "note") async {
        let texte = brouillon.trimmingCharacters(in: .whitespacesAndNewlines)
        guard texte.count >= 30 else {
            app?.dire("Encore quelques mots pour que Rémy puisse le retenir.")
            return
        }
        guard !captureEnCours else { return }
        captureEnCours = true
        defer { captureEnCours = false }
        do {
            let r = try await api.capturer(texte, source: source)
            if brouillon.trimmingCharacters(in: .whitespacesAndNewlines) == texte { brouillon = "" }
            modeRetenir = false
            let ajouts = r.ajouts ?? []
            if let premier = ajouts.first {
                let reste = ajouts.count - 1
                app?.dire("Retenu : \(premier)" + (reste > 0 ? " — et \(reste) autre\(reste > 1 ? "s" : "") chose\(reste > 1 ? "s" : "")." : ""))
            } else if r.memoire == false {
                app?.dire(r.message.map { "Gardé : \($0)" } ?? "Gardé : Rémy le relira cette nuit.")
            } else {
                app?.dire("Rien de nouveau : Rémy le savait déjà.")
            }
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            let raison = (error as? LocalizedError)?.errorDescription ?? "erreur"
            app?.dire("Pas retenu : \(raison) Ton texte est toujours là.")
        }
    }

    // MARK: Propositions

    /// Applique une proposition. Rend vrai seulement si TOUT a été fait (c'est
    /// ce qui déclenche la vibration de réussite). L'identifiant de la
    /// proposition rend l'application idempotente : un second tap, ou le même
    /// « Oui » sur le site, rend le même résultat sans rien refaire.
    @discardableResult
    public func appliquer(_ ligne: LigneChat) async -> Bool {
        guard let p = ligne.proposition else { return false }
        do {
            let r = try await api.appliquer(p, convId: idCourant, index: ligne.indexMessage)
            let bilan = r.bilan
            if let i = lignes.firstIndex(where: { $0.id == ligne.id }) {
                lignes[i].proposition?.statut = r.statut
                lignes[i].proposition?.ledgerId = r.ledgerId
                lignes[i].proposition?.bilan = bilan
                lignes[i].proposition?.annulee = false
            }
            let echecs = bilan.echoues?.count ?? 0
            if echecs == 0 {
                let ou = p.versAgenda ? " dans ton agenda" : bilan.espace.map { " dans « \($0) »" } ?? " dans ton planning"
                app?.dire("C'est fait\(ou).")
            } else if echecs >= p.actions.count {
                app?.dire("Rien n'a pu être fait : la raison est sous chaque ligne.")
            } else {
                app?.dire("\(echecs) changement\(echecs > 1 ? "s" : "") sur \(p.actions.count) n'\(echecs > 1 ? "ont" : "a") pas pu être fait\(echecs > 1 ? "s" : "") : la raison est sous la ligne.")
            }
            // L'accueil reflète le changement tout de suite (lecture, aucun appel IA).
            await app?.tableau.charger()
            return echecs == 0
        } catch ErreurAPI.serveur(let code, let m) where code == 502 || code == 503 {
            // Motion ou Google n'a rien pu écrire : la carte le dit et reste retentable.
            if let i = lignes.firstIndex(where: { $0.id == ligne.id }) {
                lignes[i].proposition?.statut = "echec"
                lignes[i].proposition?.bilan = Bilan(faits: [], echoues: [Echec(nom: nil, erreur: m)])
            }
            app?.dire("Pas fait : \(m)")
            return false
        } catch {
            app?.signaler(error)
            return false
        }
    }

    public func annuler(_ ligne: LigneChat) async {
        guard let p = ligne.proposition else { return }
        do {
            let r = try await api.annuler(p)
            let rates = (r.undone ?? []).filter { $0.ok == false }.map { Echec(nom: $0.nom ?? $0.titre, erreur: $0.erreur) }
            if let i = lignes.firstIndex(where: { $0.id == ligne.id }) {
                if r.ok == false && !rates.isEmpty {
                    lignes[i].proposition?.annulationRatee = rates
                } else {
                    lignes[i].proposition?.annulee = true
                }
            }
            if r.ok == false, let e = r.premierEchec {
                app?.dire("Annulation incomplète : « \(e.nom ?? e.titre ?? "?") » — vérifie \(p.versAgenda ? "ton agenda" : "ton planning").")
            } else {
                app?.dire("Annulé : tout est revenu comme avant.")
            }
            await app?.tableau.charger()
        } catch {
            app?.signaler(error)
        }
    }

    /// « Non merci » : la carte disparaît tout de suite et le refus est
    /// enregistré, pour qu'elle ne revienne pas au rechargement. Si la tour ne
    /// l'a pas noté, la carte revient et c'est dit.
    public func ecarter(_ ligne: LigneChat) async {
        guard let i = lignes.firstIndex(where: { $0.id == ligne.id }), let p = lignes[i].proposition else { return }
        lignes[i].proposition = nil
        guard let convId = idCourant, let pid = p.id else {
            app?.dire("D'accord, rien n'a été changé.")
            return
        }
        do {
            try await api.refuser(convId: convId, propositionId: pid)
            app?.dire("D'accord, rien n'a été changé.")
        } catch {
            if let j = lignes.firstIndex(where: { $0.id == ligne.id }) { lignes[j].proposition = p }
            if let e = error as? ErreurAPI, case .serveur(409, _) = e {
                // Appliquée entre-temps (ailleurs) : l'état réel est relu.
                app?.signaler(error)
                if idCourant == convId { await ouvrir(convId) }
                return
            }
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return }
            let raison = (error as? LocalizedError)?.errorDescription ?? "erreur"
            app?.dire("« Non merci » pas enregistré : \(raison)")
        }
    }

    // MARK: Liste

    public func renommer(_ id: String, en nouveau: String) async {
        let t = String(nouveau.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        guard !t.isEmpty else { return }
        do {
            try await api.renommer(id, titre: t)
            if id == idCourant { titre = t }
            await rafraichirListe()
        } catch { app?.signaler(error) }
    }

    public func epingler(_ c: ConversationResume) async {
        do {
            try await api.epingler(c.id, !(c.pinned ?? false))
            await rafraichirListe()
        } catch { app?.signaler(error) }
    }

    public func supprimer(_ id: String) async {
        do {
            try await api.supprimer(id)
            if id == idCourant { fermer() }
            await rafraichirListe()
        } catch { app?.signaler(error) }
    }
}
