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
    /// Le libellé du bouton d'`annuler` : « Annuler » le plus souvent, ou ce
    /// que le geste propose à la place.
    public let libelle: String

    public init(texte: String, annuler: (@MainActor () -> Void)? = nil, duree: Double? = nil, libelle: String = "Annuler") {
        self.id = UUID()
        self.texte = texte
        self.annuler = annuler
        self.duree = duree
        self.libelle = libelle
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

    /// Appui long sur le conseil du moment : en demander la raison.
    public static func conseil(_ texte: String) -> String {
        "Tu me conseilles : « \(texte) » Explique-moi, ou propose autre chose si tu vois mieux."
    }

    /// « Est-ce raisonnable ? » depuis « Gérer », avec ce que l'app a estimé.
    public static func raisonnable(_ e: ElementJour, minutes: Int, impact: ImpactProlongation) -> String {
        "Je pense prolonger « \(e.titre) » de \(minutes) min. \(impact.phrase) Est-ce raisonnable vu la suite de ma journée ?"
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
    public enum Onglet: Hashable, Sendable { case aujourdhui, remy, projets }

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
    public let projets: ProjetsModel
    /// Demain et les 7 jours (semaine-v1, 24/10).
    public let semaine: SemaineModel
    public let conseil: ConseilModel
    public let organisation: OrganisationModel
    public let historique: HistoriqueModel
    public let carnet: CarnetModel
    public let chat: ChatModel
    /// La dictée du composeur et le mode appel (le micro et la voix sont
    /// branchés par l'app : le cœur ne connaît pas AVFoundation).
    public let dictee: DicteeModel
    public let appel: AppelModel
    /// La localisation (lieux-v1, 20/10) : coupée par défaut.
    public let lieux: LieuxModel
    /// Le modèle local que Rémy utilise (modeles-v1, 20/10).
    public let modeles: ModelesModel
    /// L'activité du PC, d'après ActivityWatch sur la tour (activite-pc-v1, 24/10).
    public let activitePC: ActivitePCModel
    /// Les mini tutoriels des mises à jour (21/10).
    public let nouveautes: NouveautesModel
    /// Le rendez-vous quotidien (rituel-v1, 24/10) : briefing et bilan.
    public let rituel: RituelModel
    /// « À trancher », la revue du dimanche et le tri des retards (24/10).
    public let aTrancher: ATrancherModel
    /// La file du quota Motion pendant qu'une écriture attend (motion-file-v1,
    /// 24/10) : la carte dit « En file chez Motion : ~20 s ». nil : rien à dire.
    public var attenteMotion: AttenteMotion?
    /// L'iPhone n'a aucun réseau (mode avion, pas de Wi-Fi ni de données) —
    /// posé par l'app. Différent de « Rémy injoignable » (Tailscale coupé).
    public private(set) var horsLigne = false
    /// Pour mesurer le temps jusqu'à la journée à l'écran.
    @ObservationIgnored let lancement = Date()
    /// Le trousseau partagé avec les widgets et la feuille de partage (24/10),
    /// posé par l'app : l'adresse de la tour y est recopiée. nil : les tests.
    @ObservationIgnored public var partage: TrousseauPartage?
    /// Un lien remy:// qui attend les onglets (la capture ouverte depuis un widget).
    public var lien: LienRemy?

    /// `rangement` : où garder la journée et les gestes pas encore envoyés
    /// (nil : rien sur le disque, pour les tests et les aperçus).
    public init(api: ClientAPI = ClientAPI(), rangement: Rangement? = nil, reglages: UserDefaults = .standard) {
        self.api = api
        self.tableau = TableauModel(api: api, rangement: rangement)
        self.projets = ProjetsModel(api: api, rangement: rangement)
        self.semaine = SemaineModel(api: api, rangement: rangement)
        self.conseil = ConseilModel(api: api)
        self.organisation = OrganisationModel(api: api)
        self.historique = HistoriqueModel(api: api)
        self.carnet = CarnetModel(api: api, rangement: rangement)
        self.chat = ChatModel(api: api)
        self.dictee = DicteeModel(api: api)
        self.appel = AppelModel(api: api)
        self.lieux = LieuxModel(api: api, reglages: reglages)
        self.modeles = ModelesModel(api: api)
        self.activitePC = ActivitePCModel(api: api)
        self.nouveautes = NouveautesModel(reglages: reglages)
        self.rituel = RituelModel(api: api, rangement: rangement)
        self.aTrancher = ATrancherModel(api: api, reglages: reglages)
        tableau.app = self
        projets.app = self
        semaine.app = self
        conseil.app = self
        organisation.app = self
        historique.app = self
        carnet.app = self
        chat.app = self
        dictee.app = self
        appel.app = self
        lieux.app = self
        modeles.app = self
        activitePC.app = self
        nouveautes.app = self
        rituel.app = self
        aTrancher.app = self
        chat.surSujetsTraites = { [weak self] in
            Task { await self?.tableau.charger() }
        }
        api.surFileMotion = { [weak self] a in
            self?.attenteMotion = a?.visible == true ? a : nil
        }
        tableau.restaurer()
        if let v = rangement?.copie(VersionServeur.self, Rangement.serveur)?.valeur {
            serveur = v
            api.rejeuSur = v.sait("propositions-v1")
            api.fileMotionSue = v.sait("motion-file-v1")
        }
    }

    /// Le réseau de l'iPhone change. Au retour : on relit la journée et on
    /// envoie ce qui attendait.
    public func changerReseau(horsLigne: Bool) async {
        guard horsLigne != self.horsLigne else { return }
        self.horsLigne = horsLigne
        if !horsLigne && phase == .pret { await chargerTout() }
    }

    /// Le texte du message en cours (pratique pour les tests).
    public var toast: String? { message?.texte }

    /// Rend l'identifiant du message : qui l'a posé peut le retirer, et
    /// seulement lui (un message plus récent reste affiché).
    @discardableResult
    public func dire(_ texte: String, annuler: (@MainActor () -> Void)? = nil, duree: Double? = nil, libelle: String = "Annuler") -> UUID {
        let m = MessageBas(texte: texte, annuler: annuler, duree: duree, libelle: libelle)
        message = m
        return m.id
    }

    /// Au lancement : si le cookie de session est encore bon, on entre direct.
    /// Une journée gardée sur l'iPhone s'affiche sans attendre la tour (qui
    /// peut mettre longtemps à ne pas répondre, Tailscale coupé).
    public func demarrer() async {
        partage?.publier(api.base)
        if tableau.donnees != nil || !tableau.envoi.isEmpty { phase = .pret }
        if tableau.donnees != nil { Mesures.partagees.noter("app.affichage", ms: Date().timeIntervalSince(lancement) * 1000) }
        do {
            _ = try await api.conversations()
            phase = .pret
            await chargerTout()
        } catch ErreurAPI.nonConnecte {
            tableau.vider(garderCaptures: true)
            projets.vider()
            semaine.vider()
            conseil.vider()
            organisation.vider()
            historique.vider()
            carnet.vider()
            rituel.vider()
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
        partage?.publier(api.base)
        phase = .pret
        await chargerTout()
    }

    /// Tout revient à zéro : rien de la session précédente ne doit rester
    /// affiché (brouillon, feuille ouverte, tâches cochées).
    public func deconnecter() async {
        appel.raccrocher()
        dictee.annuler(sansMessage: true)
        dictee.oublierEnAttente()
        await api.deconnexion()
        // Les extensions n'ont plus de tour à qui parler.
        partage?.publier(nil)
        lien = nil
        chat.vider()
        tableau.vider()
        projets.vider()
        semaine.vider()
        conseil.vider()
        organisation.vider()
        historique.vider()
        carnet.vider()
        rituel.vider()
        aTrancher.vider()
        onglet = .aujourdhui
        reglagesOuverts = false
        message = nil
        phase = .connexion
    }

    /// Un lien remy:// (widget, feuille de partage) : l'onglet tout de suite ;
    /// la capture attend les onglets (`lien`), qui ferment d'abord la feuille
    /// ouverte. Rend faux si le lien est inconnu.
    @discardableResult
    public func ouvrir(_ url: URL) -> Bool {
        guard let l = LienRemy(url: url) else { return false }
        switch l {
        case .onglet(let o):
            reglagesOuverts = false
            onglet = o
        case .capture:
            lien = .capture
        }
        return true
    }

    public func chargerTout(frais: Bool = false) async {
        async let a: Void = tableau.charger(frais: frais)
        async let b: Void = chat.rafraichirListe()
        async let c: Void = lireVersionServeur()
        _ = await (a, b, c)
        async let p: Void = projets.charger()
        async let k: Void = carnet.charger()
        async let o: Void = organisation.charger()
        async let r: Void = rituel.charger()
        // Les 7 jours, pour les avoir hors ligne : sans IA ni Motion de plus.
        async let s: Void = semaine.charger()
        _ = await (p, k, o, r, s)
        // La tour répond : ce qui attendait sur l'iPhone part maintenant.
        if !tableau.envoi.isEmpty && !tableau.erreurReseau { await tableau.envoyerEnAttente() }
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
            api.fileMotionSue = v.sait("motion-file-v1")
            try? tableau.rangement?.garder(v, le: Date(), Rangement.serveur)
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
    /// Le « + » : une tâche de plus dans Motion, qui lui trouvera un créneau.
    /// La tour refuse un doublon (même nom déjà ouvert) et le dit.
    /// `echeance` : le jour compris dans la phrase (« vendredi »), une date
    /// limite et jamais un créneau — Motion place la tâche avant.
    /// Sans réseau (25/10) : la tâche attend sur l'iPhone, telle que comprise,
    /// et part dès que Rémy est joignable (`TableauModel.noter`). Rend vrai si
    /// elle est partie ou gardée ; faux si la tour ou Motion l'a refusée (le
    /// texte reste dans le champ).
    @discardableResult
    public func noterTache(_ titre: String, echeance: Date? = nil) async -> Bool {
        let t = titre.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return false }
        return await tableau.noter(CaptureFigee(genre: .tache, texte: String(t.prefix(200)), echeance: echeance))
    }

    /// Le « + », genre « Retenir » : Rémy garde l'idée en mémoire, sans
    /// conversation. Au moins 30 caractères (il la distille). Sans réseau,
    /// elle attend sur l'iPhone comme une tâche.
    @discardableResult
    public func retenirNote(_ texte: String) async -> Bool {
        let t = texte.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count >= GenreCapture.minimumRetenir else {
            dire("Encore quelques mots pour que Rémy puisse le retenir.")
            return false
        }
        return await tableau.noter(CaptureFigee(genre: .retenir, texte: t))
    }

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
            // La tour ne reconnaît plus cet appareil (déconnecté depuis la
            // liste, peut-être perdu) : rien de ta journée ne reste dessus. Les
            // captures tapées ici et pas encore parties restent, comptées sur
            // l'écran de connexion : elles partiront après la reconnexion.
            tableau.vider(garderCaptures: true)
            projets.vider()
            semaine.vider()
            conseil.vider()
            organisation.vider()
            historique.vider()
            carnet.vider()
            rituel.vider()
            phase = .connexion
            // Le dernier message promettait peut-être « partira dès que Rémy
            // sera joignable » : on dit ce qui se passe vraiment.
            let n = tableau.capturesEnAttente.count
            if n > 0 {
                dire("Session refusée par Rémy : reconnecte-toi. \(n) capture\(n > 1 ? "s" : "") notée\(n > 1 ? "s" : "") sur l'iPhone t'attend\(n > 1 ? "ent" : "") : elle\(n > 1 ? "s" : "") partir\(n > 1 ? "ont" : "a") ensuite.")
            } else {
                message = nil
            }
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
    /// Restée sur l'iPhone faute de réseau : elle partira au retour de Rémy.
    public var horsLigne: Bool = false
    /// La commande qui la porte dans la file d'envoi (son id part au serveur).
    public var commande: String? = nil
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
    /// Pas de réseau : gardée sur l'iPhone, elle partira au retour de Rémy.
    case enAttente
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
    /// La journée affichée vient de l'iPhone (dernier lancement), pas encore
    /// relue sur la tour.
    public private(set) var copieLocale = false
    public private(set) var cochees: [Cochee] = []
    /// La file d'envoi : chaque geste y est écrit avant de partir, et n'en
    /// sort qu'une fois la tour l'ayant reçu.
    public private(set) var envoi: [Commande] = []
    /// Une tâche vient d'être commencée (« Commencer », où que ce soit) :
    /// l'app y démarre l'activité en direct (24/10).
    @ObservationIgnored public var surCommencee: (@MainActor (ElementJour) async -> Void)?

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI
    /// nil : rien sur le disque (tests, aperçus).
    @ObservationIgnored public let rangement: Rangement?
    @ObservationIgnored var envoisEnCours: Set<String> = []
    /// Les captures que le « + » envoie en ce moment, feuille ouverte : pas
    /// encore « en attente » (la ligne d'Aujourd'hui ne les compte pas).
    var enEnvoiDirect: Set<String> = []
    /// Des captures qu'une autre version de l'app a laissées et que celle-ci
    /// ne sait pas relire : gardées à part sur l'iPhone, jamais envoyées.
    public private(set) var capturesIllisibles = 0
    /// Le temps (secondes) pendant lequel une coche s'annule sans rien envoyer.
    /// Sam l'a voulu court : « deux secondes, pas plus ».
    @ObservationIgnored public var delaiAnnulation: Double = 2
    /// « Annuler » touché pile pendant l'envoi : la coche sera défaite dès
    /// que Motion l'aura enregistrée.
    @ObservationIgnored private var aDefaire: Set<String> = []

    public init(api: ClientAPI, rangement: Rangement? = nil) {
        self.api = api
        self.rangement = rangement
    }

    /// Au lancement, avant tout réseau : la dernière journée reçue (datée) et
    /// les coches pas encore parties. L'écran s'affiche tout de suite, même
    /// sans Tailscale.
    public func restaurer() {
        guard let r = rangement else { return }
        if donnees == nil, let c = r.copie(TableauDeBord.self, Rangement.journee) {
            donnees = c.valeur
            misAJour = c.le
            copieLocale = true
        }
        // Les gestes, puis les captures du « + » (un fichier chacun). Les
        // captures se relisent une à une : une illisible est mise de côté,
        // jamais toute la file.
        let captures = r.lireCaptures()
        envoi = (r.copie([Commande].self, Rangement.envoi)?.valeur ?? []) + captures.lues
        capturesIllisibles = r.nombreIllisibles()
        for c in envoi {
            guard case let .terminer(tache, titre) = c.geste, !cochees.contains(where: { $0.id == tache }) else { continue }
            cochees.append(Cochee(id: tache, titre: titre, ledgerId: nil, enCours: false,
                                  jour: Format.jourISO(c.creeLe), horsLigne: true, commande: c.id))
        }
    }

    /// Les gestes qui attendent le réseau (le délai d'annulation passé). Les
    /// captures du « + » sont comptées à part (`capturesEnAttente`).
    public var gestesEnAttente: Int {
        let enDelai = Set(cochees.filter(\.enAttente).compactMap(\.commande))
        return envoi.filter { $0.capture == nil && !enDelai.contains($0.id) }.count
    }

    /// Quelque chose peut repartir seul (le retour de la tour, chaque minute).
    public var aEnvoyer: Bool { gestesEnAttente > 0 || capturesEnAttente.contains { partSeule($0) } }

    /// La commande d'une coche encore dans la file d'envoi.
    public func commande(de c: Cochee) -> Commande? {
        envoi.first { $0.id == c.commande }
    }

    /// Déconnexion, ou appareil plus reconnu par la tour : rien ne reste, ni
    /// à l'écran ni sur le disque. `garderCaptures` (session refusée par la
    /// tour, pas déconnexion voulue) : les captures tapées sur l'iPhone et pas
    /// encore parties restent (protégées par iOS, hors iCloud) et partiront
    /// après la reconnexion — jamais perdues en silence. Seule la déconnexion
    /// voulue, qui les compte avant, les efface.
    public func vider(garderCaptures: Bool = false) {
        donnees = nil
        misAJour = nil
        copieLocale = false
        erreur = nil
        erreurReseau = false
        cochees = []
        aDefaire = []
        envoi = garderCaptures ? envoi.filter { $0.capture != nil } : []
        rangement?.effacer(Rangement.journee)
        rangement?.effacer(Rangement.envoi)
        if !garderCaptures {
            rangement?.effacer(Rangement.captures)
            rangement?.effacer(Rangement.capturesIllisibles)
            capturesIllisibles = 0
        }
        rangement?.effacer(Rangement.serveur)
    }

    public func charger(frais: Bool = false) async {
        guard !chargement else { return }
        chargement = true
        defer { chargement = false }
        let fin = Mesures.partagees.chrono("app.journee")
        do {
            let d = try await api.tableauDeBord(frais: frais)
            fin()
            let le = Date()
            donnees = d
            misAJour = le
            copieLocale = false
            erreur = nil
            erreurReseau = false
            let aujourdhui = Format.jourISO(Date())
            cochees.removeAll { $0.jour != aujourdhui && !$0.horsLigne }
            // Meilleur effort : sans copie, le prochain lancement hors ligne
            // montrera seulement qu'il n'a rien.
            try? rangement?.garder(d, le: le, Rangement.journee)
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
    /// faire disparaître la ligne rendait la coche molle). Le geste est écrit
    /// sur l'iPhone dès le toucher : l'app peut être fermée pendant le délai,
    /// ou le réseau absent, la coche partira plus tard (J1.2). Si Motion
    /// refuse, la tâche revient et c'est dit. Aucun appel IA.
    @discardableResult
    public func terminer(id: String, titre: String) async -> IssueCoche {
        guard !cochees.contains(where: { $0.id == id }) else { return .deja }
        let commande = Commande(geste: .terminer(tache: id, titre: titre), delai: delaiAnnulation)
        cochees.append(Cochee(id: id, titre: titre, ledgerId: nil, enCours: false,
                              jour: Format.jourISO(Date()), enAttente: true, commande: commande.id))
        ajouter(commande)
        let bandeau = app?.dire("« \(titre) » : fait.", annuler: { [weak self] in
            self?.renoncer(id)
        }, duree: delaiAnnulation)
        if delaiAnnulation > 0 { try? await Task.sleep(nanoseconds: UInt64(delaiAnnulation * 1_000_000_000)) }
        // Annulée pendant le délai (ou session fermée) : rien n'est parti.
        guard let i = cochees.firstIndex(where: { $0.id == id }), cochees[i].enAttente else { return .renoncee }
        // Le délai est passé : le bandeau ne peut plus rien annuler sans écrire.
        if let bandeau, app?.message?.id == bandeau { app?.message = nil }
        cochees[i].enAttente = false
        return await envoyer(commande, reprise: false)
    }

    /// Renvoie les gestes et les captures restés sur l'iPhone (réseau revenu,
    /// app relancée ou revenue au premier plan), dans l'ordre. S'arrête au
    /// premier échec réseau : inutile d'insister. Une capture qui attend Sam
    /// (refusée, ou peut-être déjà reçue) ne repart pas seule.
    /// `force` (« Envoyer maintenant ») : une capture part même si son
    /// prochain essai, après une panne passagère, n'est pas encore venu.
    public func envoyerEnAttente(force: Bool = false) async {
        var envoyees: [String] = []
        for c in envoi {
            // Relue à chaque tour : retirée pendant la vidange, elle ne part
            // pas ; sinon, avec ses tentatives et sa raison à jour.
            guard let actuelle = envoi.first(where: { $0.id == c.id }) else { continue }
            guard actuelle.partApres <= Date() || (force && actuelle.capture != nil) else { continue }
            if cochees.first(where: { $0.commande == actuelle.id })?.enAttente == true { continue }
            if actuelle.capture != nil && !partSeule(actuelle) { continue }
            let issue = await envoyer(actuelle, reprise: true)
            // La tour ne reconnaît plus la session : inutile d'insister.
            if app?.phase == .connexion { break }
            if issue == .enAttente { break }
            if issue == .faite, let capture = actuelle.capture { envoyees.append(capture.texte) }
        }
        // Plusieurs captures parties d'un coup : un seul message les dit toutes.
        if envoyees.count > 1 {
            app?.dire("Envoyé : \(envoyees.count) captures en attente (" + envoyees.prefix(2).map { "« \(CaptureFigee.court($0)) »" }.joined(separator: ", ")
                      + (envoyees.count > 2 ? "…" : "") + ").")
        }
    }

    /// Envoie une commande de la file. `reprise` : renvoi automatique, qui ne
    /// répète pas « pas de réseau » à chaque essai, mais dit quand c'est parti.
    func envoyer(_ commande: Commande, reprise: Bool) async -> IssueCoche {
        if commande.capture != nil { return await envoyerCapture(commande, reprise: reprise) }
        guard case let .terminer(id, titre) = commande.geste else { return .echec }
        guard envoisEnCours.insert(commande.id).inserted else { return .deja }
        defer { envoisEnCours.remove(commande.id) }
        if let i = cochees.firstIndex(where: { $0.id == id }) {
            cochees[i].enCours = true
            cochees[i].horsLigne = false
        }
        let p = Proposition(source: "motion", resume: "Coché depuis l'app",
                            actions: [ActionProposee(type: "terminer", nom: titre, id: id)])
        do {
            // La clé de la commande : renvoyée après une coupure, la coche n'est pas refaite.
            let finGeste = Mesures.partagees.chrono("app.geste")
            let r = try await api.appliquer(p, convId: nil, index: nil, idCommande: commande.id)
            finGeste()
            let defaire = envoi.first(where: { $0.id == commande.id })?.puisDefaire == true
            retirer(commande.id)
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
            if aDefaire.remove(id) != nil || defaire {
                await annulerCoche(id)
            } else if reprise {
                app?.dire("Envoyé : « \(titre) » est marqué fait.")
            }
            return .faite
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return .echec }
            if let e = error as? ErreurAPI, case .reseau = e, !api.rejeuSur {
                // Tour d'avant le Lot 0 : elle ignore la clé, un renvoi referait
                // l'écriture. On relit la liste au lieu d'affirmer quoi que ce soit.
                retirer(commande.id)
                cochees.removeAll { $0.id == id }
                aDefaire.remove(id)
                app?.dire("Réseau coupé pendant la coche de « \(titre) » : je relis la liste pour vérifier.")
                await charger(frais: true)
                return .echec
            }
            if let e = error as? ErreurAPI, case .reseau = e {
                // Pas de réponse : la coche est peut-être arrivée. Elle reste
                // sur l'iPhone et repartira avec la même clé ; la tour ne la
                // refera pas. Un « Annuler » touché pendant l'envoi la défera
                // une fois arrivée, même après une fermeture de l'app.
                modifier(commande.id) {
                    $0.tentatives += 1
                    if aDefaire.remove(id) != nil { $0.puisDefaire = true }
                }
                if let j = cochees.firstIndex(where: { $0.id == id }) {
                    cochees[j].enCours = false
                    cochees[j].horsLigne = true
                }
                if !reprise { app?.dire("Pas de réseau : « \(titre) » partira dès que Rémy sera joignable.") }
                return .enAttente
            }
            retirer(commande.id)
            cochees.removeAll { $0.id == id }
            aDefaire.remove(id)
            let raison = (error as? LocalizedError)?.errorDescription ?? "erreur"
            app?.dire("Motion n'a pas pu marquer « \(titre) » comme fait : \(raison) La tâche est de retour.")
            return .echec
        }
    }

    // MARK: File d'envoi sur le disque

    func ajouter(_ c: Commande) {
        envoi.append(c)
        sauverEnvoi()
    }

    func retirer(_ id: String) {
        guard envoi.contains(where: { $0.id == id }) else { return }
        envoi.removeAll { $0.id == id }
        sauverEnvoi()
    }

    func modifier(_ id: String, _ changement: (inout Commande) -> Void) {
        guard let i = envoi.firstIndex(where: { $0.id == id }) else { return }
        changement(&envoi[i])
        sauverEnvoi()
    }

    private func sauverEnvoi() {
        guard let r = rangement else { return }
        for (nom, file) in [(Rangement.envoi, envoi.filter { $0.capture == nil }), (Rangement.captures, envoi.filter { $0.capture != nil })] {
            if file.isEmpty { r.effacer(nom); continue }
            do {
                try r.garder(file, le: Date(), nom)
            } catch {
                app?.dire(nom == Rangement.envoi ? "L'iPhone n'a pas pu garder ce geste : il sera perdu si l'app se ferme avant l'envoi."
                                                 : "L'iPhone n'a pas pu garder cette capture : elle sera perdue si l'app se ferme avant l'envoi.")
            }
        }
    }

    /// Après un geste réussi : la tour a déjà mis sa liste à jour (sans relire
    /// Motion), on la relit tout de suite ; Motion recalcule le planning
    /// derrière, une seconde lecture douce suit ~35 s plus tard.
    public func apresGeste() async {
        await charger()
        relireBientot()
    }

    /// La relecture d'après un geste, lancée sans être attendue (le « + »
    /// se ferme tout de suite) ; gardée pour que les tests l'attendent.
    @ObservationIgnored public private(set) var relectureApresGeste: Task<Void, Never>?

    public func apresGesteSansAttendre() {
        relectureApresGeste = Task { [weak self] in await self?.apresGeste() }
    }

    @ObservationIgnored private var relecture: Task<Void, Never>?

    public func relireBientot(secondes: Double = 35) {
        relecture?.cancel()
        relecture = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(secondes * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self?.charger()
        }
    }

    /// Change une ligne de la journée à l'écran tout de suite ; rend de quoi
    /// revenir en arrière si la tour refuse.
    func modifierLocal(_ id: String, type: String = "tache", _ f: (inout ElementJour) -> Void) -> (() -> Void)? {
        guard var j = donnees?.journee, var items = j.items,
              let i = items.firstIndex(where: { $0.type == type && $0.id == id }) else { return nil }
        let avant = items[i]
        f(&items[i])
        j.items = items
        donnees?.journee = j
        return { [weak self] in
            guard let self, var j = self.donnees?.journee, var items = j.items,
                  let k = items.firstIndex(where: { $0.type == type && $0.id == id }) else { return }
            items[k] = avant
            j.items = items
            self.donnees?.journee = j
        }
    }

    /// Replanifier une tâche depuis « Aujourd'hui » (Sam, 09/10 : il touchait
    /// une tâche en retard pour la décaler, et rien ne le permettait). Seule
    /// l'échéance change ; Motion recalcule le créneau. Annulable depuis le
    /// bandeau, comme une coche.
    @discardableResult
    public func replanifier(id: String, titre: String, echeance: Date) async -> Bool {
        let fin = Mesures.partagees.chrono("app.geste")
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
            fin()
            await apresGeste()
            return true
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            let raison = (error as? LocalizedError)?.errorDescription ?? "erreur"
            _ = app?.dire("Motion n'a pas pu replanifier « \(titre) » : \(raison)")
            return false
        }
    }

    /// Prolonger la tâche en cours (« Gérer » : +5, +15, +30 min). La durée
    /// part en valeur ABSOLUE (durée Motion + n) : un envoi rejoué après une
    /// coupure ne l'allonge pas deux fois. Motion recalcule la suite ;
    /// annulable depuis le bandeau. En ligne seulement : sans réseau, c'est dit.
    @discardableResult
    public func prolonger(_ e: ElementJour, de minutes: Int) async -> Bool {
        guard let duree = e.duree else {
            app?.dire("Motion ne donne pas de durée pour « \(e.titre) » : impossible de la prolonger d'ici.")
            return false
        }
        let p = Proposition(source: "motion", resume: "Prolongé depuis l'app",
                            actions: [ActionProposee(type: "modifier", nom: e.titre,
                                                     duree: .nombre(Double(duree + minutes)), id: e.id)])
        let fin = Mesures.partagees.chrono("app.geste")
        // À l'écran tout de suite ; défait si Motion refuse.
        let defaire = modifierLocal(e.id) {
            $0.fin = $0.finEffective + Double(minutes) * 60_000
            $0.duree = duree + minutes
        }
        do {
            let r = try await api.appliquer(p, convId: nil, index: nil, idCommande: UUID().uuidString)
            let res = r.results?.first
            if (r.echecs ?? 0) > 0 || res?.ok == false {
                defaire?()
                app?.dire("Motion n'a pas pu prolonger « \(e.titre) » : \(res?.erreur ?? "raison inconnue").")
                return false
            }
            fin()
            var annuler: (@MainActor () -> Void)? = nil
            if let ledger = r.ledgerId {
                annuler = { [weak self] in
                    Task { await self?.annulerReplanification(ledger, titre: e.titre) }
                }
            }
            _ = app?.dire("« \(e.titre) » : +\(minutes) min. Motion recalcule la suite.", annuler: annuler)
            await apresGeste()
            return true
        } catch {
            defaire?()
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            if let er = error as? ErreurAPI, case .reseau = er {
                app?.dire("Pas de réseau : « \(e.titre) » n'a pas été prolongée.")
                return false
            }
            let raison = (error as? LocalizedError)?.errorDescription ?? "erreur"
            app?.dire("Motion n'a pas pu prolonger « \(e.titre) » : \(raison)")
            return false
        }
    }

    /// Modifier une tâche (« Gérer » → Modifier) : nom, échéance, durée,
    /// priorité. Motion fait foi ; annulable depuis le bandeau.
    @discardableResult
    public func modifier(id: String, titre: String, nouveauTitre: String?, echeance: Date?, duree: Int?, priorite: String?) async -> Bool {
        let nom = nouveauTitre?.trimmingCharacters(in: .whitespacesAndNewlines)
        let action = ActionProposee(type: "modifier", nom: titre,
                                    nouveau_nom: (nom?.isEmpty == false && nom != titre) ? nom : nil,
                                    echeance: echeance.map { Format.isoAvecFuseau($0) },
                                    duree: duree.map { .nombre(Double($0)) },
                                    priorite: priorite, id: id)
        let p = Proposition(source: "motion", resume: "Modifié depuis l'app", actions: [action])
        let fin = Mesures.partagees.chrono("app.geste")
        let defaire = modifierLocal(id) {
            if let n = action.nouveau_nom { $0.titre = n }
            if let d = duree {
                $0.duree = d
                $0.fin = $0.debut + Double(d) * 60_000
            }
            if let pr = priorite { $0.priorite = pr }
        }
        do {
            let r = try await api.appliquer(p, convId: nil, index: nil, idCommande: UUID().uuidString)
            let res = r.results?.first
            if (r.echecs ?? 0) > 0 || res?.ok == false {
                defaire?()
                app?.dire("Motion n'a pas pu modifier « \(titre) » : \(res?.erreur ?? "raison inconnue").")
                return false
            }
            fin()
            var annuler: (@MainActor () -> Void)? = nil
            if let ledger = r.ledgerId {
                annuler = { [weak self] in Task { await self?.annulerReplanification(ledger, titre: titre) } }
            }
            _ = app?.dire("« \(action.nouveau_nom ?? titre) » : modifiée.", annuler: annuler)
            await apresGeste()
            return true
        } catch {
            defaire?()
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            let raison = (error as? LocalizedError)?.errorDescription ?? "erreur"
            app?.dire("Motion n'a pas pu modifier « \(titre) » : \(raison)")
            return false
        }
    }

    public var categoriesDisponibles: Bool { app?.serveur?.sait("categories-taches-v1") == true }

    /// La catégorie d'une tâche (Voiture, Santé…), gardée par Remy (Sam, 18/10).
    /// Visible tout de suite ; revient en arrière si la tour refuse.
    @discardableResult
    public func categoriser(id: String, titre: String, etiquettes: [String]) async -> Bool {
        let valeur = etiquettes.isEmpty ? nil : etiquettes
        let defaire = modifierLocal(id) { $0.etiquettes = valeur }
        let avant = (aFaire: donnees?.journee?.aFaire, retard: donnees?.journee?.retard)
        if let i = donnees?.journee?.aFaire?.firstIndex(where: { $0.id == id }) {
            donnees?.journee?.aFaire?[i].etiquettes = valeur
        }
        if let i = donnees?.journee?.retard?.items.firstIndex(where: { $0.id == id }) {
            donnees?.journee?.retard?.items[i].etiquettes = valeur
        }
        do {
            try await api.categoriserTache(id, etiquettes)
            return true
        } catch {
            defaire?()
            donnees?.journee?.aFaire = avant.aFaire
            donnees?.journee?.retard = avant.retard
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            app?.dire("Catégorie de « \(titre) » pas enregistrée : \((error as? LocalizedError)?.errorDescription ?? "erreur")")
            return false
        }
    }

    /// « Bloquée » : Motion n'a pas ce champ, Remy le garde (D12). La tâche
    /// le montre aussitôt ; annulable.
    @discardableResult
    public func bloquer(id: String, titre: String, bloquee: Bool, raison: String? = nil) async -> Bool {
        let avant = etatBloque(id)
        poserBloque(id, bloquee, raison)
        do {
            try await api.marquerTache(id, bloquee: bloquee, raison: raison)
            app?.dire(bloquee ? "« \(titre) » : en attente." : "« \(titre) » : reprise.", annuler: { [weak self] in
                Task { await self?.bloquer(id: id, titre: titre, bloquee: avant.0, raison: avant.1) }
            })
            return true
        } catch {
            poserBloque(id, avant.0, avant.1)
            app?.signaler(error)
            return false
        }
    }

    private func etatBloque(_ id: String) -> (Bool, String?) {
        let j = donnees?.journee
        if let e = j?.items?.first(where: { $0.id == id && !$0.estRendezVous }) { return (e.bloquee ?? false, e.raison) }
        if let t = (j?.aFaire ?? []).first(where: { $0.id == id }) ?? j?.retard?.items.first(where: { $0.id == id }) {
            return (t.bloquee ?? false, t.raison)
        }
        return (false, nil)
    }

    private func poserBloque(_ id: String, _ b: Bool, _ raison: String?) {
        guard var j = donnees?.journee else { return }
        j.items = j.items?.map { e in
            guard e.id == id, !e.estRendezVous else { return e }
            var e = e
            e.bloquee = b
            e.raison = b ? raison : nil
            return e
        }
        let marque: (TacheResume) -> TacheResume = { t in
            guard t.id == id else { return t }
            var t = t
            t.bloquee = b
            t.raison = b ? raison : nil
            return t
        }
        j.aFaire = j.aFaire?.map(marque)
        if var r = j.retard {
            r.items = r.items.map(marque)
            j.retard = r
        }
        donnees?.journee = j
    }

    private func annulerReplanification(_ ledger: String, titre: String) async {
        do {
            let r = try await api.annuler(Proposition(source: "motion", resume: nil, actions: [], ledgerId: ledger))
            _ = app?.dire(r.ok == false
                ? "Impossible de remettre l'ancienne échéance de « \(titre) »."
                : "« \(titre) » : ancienne échéance remise.")
            await apresGeste()
        } catch {
            app?.signaler(error)
        }
    }

    /// « Annuler » sur le bandeau (ou sur la ligne) d'une coche pas encore
    /// envoyée : la tâche revient, Motion n'en saura rien. Trop tard (l'envoi
    /// vient de partir) : elle est défaite dès que Motion l'a enregistrée.
    public func renoncer(_ id: String) {
        guard let i = cochees.firstIndex(where: { $0.id == id }) else { return }
        let c = cochees[i]
        let enFile = commande(de: c)
        if c.enAttente || (c.horsLigne && (enFile?.tentatives ?? 0) == 0) {
            // Jamais partie : on la retire de la file, la tour n'en saura rien.
            cochees.remove(at: i)
            if let cmd = c.commande { retirer(cmd) }
        } else if c.horsLigne, let cmd = c.commande {
            // Déjà tentée sans réponse : elle est peut-être arrivée. Elle
            // repartira, puis sera défaite.
            modifier(cmd) { $0.puisDefaire = true }
            app?.dire("« \(c.titre) » sera rouverte dès que Rémy sera joignable.")
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

/// Une étape de la réponse en cours (« Rémy relit… », « Rémy réfléchit… »),
/// pour la petite barre du chat (etapes-v1, 19/10).
public struct EtapeReponse: Identifiable, Equatable, Sendable {
    public let id: UUID
    /// contexte, choix, modele, reflexion, motion, web, navigateur, proposition,
    /// budget, secours, ecrit — une clé inconnue s'affiche quand même.
    public var cle: String
    public var texte: String
    /// Un court extrait de la réflexion du modèle local (jamais enregistré).
    public var detail: String?
    /// Millisecondes depuis le début de la réponse, horloge de la tour.
    public var t: Int

    public init(id: UUID = UUID(), cle: String, texte: String, detail: String? = nil, t: Int) {
        self.id = id
        self.cle = cle
        self.texte = texte
        self.detail = detail
        self.t = t
    }
}

public extension Array where Element == EtapeReponse {
    /// La durée de chaque étape terminée, en ms (la dernière court encore).
    func duree(de i: Int) -> Int? {
        guard indices.contains(i), i + 1 < count else { return nil }
        return Swift.max(0, self[i + 1].t - self[i].t)
    }

    /// Ajoute une étape, ou met à jour la dernière si c'est la même (la
    /// réflexion envoie un nouvel extrait sans créer de ligne).
    mutating func recevoir(cle: String, texte: String, detail: String?, t: Int) {
        if let d = last, d.cle == cle {
            self[count - 1].texte = texte
            if let detail { self[count - 1].detail = detail }
            return
        }
        append(EtapeReponse(cle: cle, texte: texte, detail: detail, t: t))
    }
}

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
    /// Ce que Rémy a fait pendant cette réponse (vide face à une tour ancienne).
    public var etapes: [EtapeReponse] = []
    /// Quand la première étape est arrivée (horloge de l'iPhone), pour le chrono.
    public var debutEtapes: Date?
    /// Fin de la réponse (pour « Réponse en 14 s »).
    public var finEtapes: Date?
    /// Jetons par seconde en direct, pendant que Rémy écrit (jauge-v1).
    public var debit: Double?
    /// Débit et contexte mesurés sur la tour, une fois la réponse finie.
    public var mesures: MesuresReponse?
    /// Le code d'incident d'une erreur de la tour (« R-7KQ2M »).
    public var codeErreur: String?

    public init(id: UUID = UUID(), deToi: Bool, texte: String, puce: String? = nil, proposition: Proposition? = nil,
                indexMessage: Int? = nil, statut: String? = nil, erreur: String? = nil, enCours: Bool = false,
                question: String? = nil, auteur: String = "Rémy", secours: Bool = false, autorisation: Autorisation? = nil,
                mesures: MesuresReponse? = nil) {
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
        self.mesures = mesures
    }
}

struct FinDeReponse: Decodable {
    var text: String?
    var model: String?
    var tier: String?
    var usd: Double?
    var session_done: String?
    var couverture: [String: [String]]?
    var mesures: MesuresReponse?
}

/// Un événement « debit » (jauge-v1) : la vitesse d'écriture en direct.
struct DebitSSE: Decodable { var tps: Double?; var jetons: Int? }

struct Texte: Decodable { var text: String? }
/// Un événement « status » : `text` seul face à une tour ancienne ; avec
/// etapes-v1, la clé de l'étape, le temps écoulé et un éventuel extrait.
struct StatutSSE: Decodable { var text: String?; var cle: String?; var t: Int?; var detail: String? }
/// `code` : le code d'incident de la tour (« R-7KQ2M »), à transmettre.
struct MessageErreur: Decodable { var message: String?; var code: String? }
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
    /// Le début du fil ouvert, résumé pour le modèle (compactage-v1).
    public private(set) var compactage: Compactage?
    public private(set) var compactageEnCours = false
    /// Le fil ouvert (ou celui que le prochain envoi créera) est privé : le
    /// modèle local seulement, jamais Claude (27/10, comme le cadenas du site).
    public private(set) var privee = false
    /// La recherche dans les conversations privées s'applique sur la tour
    /// (recherche-privee-v1) ; nil : pas encore lue, ou tour sans ce réglage.
    public private(set) var recherchePrivee: Bool?
    public private(set) var miseEnPrive = false

    /// Captures de la CI seulement : une réponse figée en cours, avec ses étapes.
    public func montrerPourCapture(_ ligne: LigneChat) { lignes.append(ligne) }
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
    /// La jauge du fil ouvert (contexte, débit) ; la tour doit savoir mesurer.
    public var jaugeDisponible: Bool { app?.serveur?.sait("jauge-v1") == true }
    public var jauge: JaugeContexte { JaugeContexte.de(lignes) }

    public var compactageDisponible: Bool { app?.serveur?.sait("compactage-v1") == true }

    /// Résumer le début du fil maintenant (GLM, sur les machines de Sam) : la
    /// suite repart plus légère, rien n'est effacé. Vrai si c'est fait.
    @discardableResult
    public func compacter() async -> Bool {
        guard let id = idCourant, !envoi, !compactageEnCours else { return false }
        compactageEnCours = true
        defer { compactageEnCours = false }
        do {
            let r = try await api.compacter(id)
            guard idCourant == id else { return r.compacte }
            if let c = r.compactage { compactage = c }
            if r.compacte {
                let n = r.resumes ?? r.compactage?.jusqua ?? 0
                app?.dire("Rémy a résumé \(n) message\(n > 1 ? "s" : "") : la suite repart plus légère. Rien n'est effacé.")
            } else {
                app?.dire(r.raison == "rien-a-resumer" ? "Le fil est encore court : rien à résumer." : "Déjà résumé récemment.")
            }
            return r.compacte
        } catch {
            app?.signaler(error)
            return false
        }
    }

    /// Relit le résumé du fil (la jauge ouverte) : le résumé automatique se
    /// fait après la réponse, sur la tour ; l'app ne l'apprend qu'en relisant.
    public func relireCompactage() async {
        guard let id = idCourant, !envoi, compactageDisponible,
              let conv = try? await api.conversation(id), idCourant == id else { return }
        if (conv.compactage?.jusqua ?? 0) > (compactage?.jusqua ?? 0) { compactage = conv.compactage }
    }

    /// Ce que la tour sait d'un code d'erreur, prêt à coller (jamais le
    /// contenu des messages). Nil si la tour ne répond pas.
    public func diagnostic(_ code: String) async -> String? {
        try? await api.diagnostic(code)
    }

    // MARK: Non lus (Sam, 18/10)

    /// Par fil, le nombre de messages qu'il avait la dernière fois que Sam
    /// l'avait sous les yeux. Un compte, pas une heure : pas de décalage
    /// d'horloge entre la tour et l'iPhone.
    public private(set) var vus: [String: Int] = (UserDefaults.standard.dictionary(forKey: ChatModel.cleVus) as? [String: Int]) ?? [:]
    nonisolated public static let cleVus = "remy.conversationsVues"

    public var nonLusDisponibles: Bool { app?.serveur?.sait("non-lus-v1") == true }

    /// Rémy a répondu (ou écrit, la nuit) depuis la dernière fois que Sam a regardé ce fil.
    public func nonLu(_ c: ConversationResume) -> Bool {
        guard nonLusDisponibles, c.origine == nil, c.dernier == "assistant", let n = c.messages else { return false }
        if c.id == idCourant && app?.onglet == .remy { return false }
        return n > (vus[c.id] ?? 0)
    }

    public var nombreNonLus: Int { conversations.filter { nonLu($0) }.count }

    /// Le fil à l'écran est lu (retour sur l'onglet, réponse finie sous les yeux).
    public func marquerVu() {
        guard let id = idCourant, app?.onglet == .remy,
              let n = conversations.first(where: { $0.id == id })?.messages else { return }
        noterVu(id, n)
    }

    /// « Marquer comme lu » sans l'ouvrir.
    public func noterLu(_ id: String) {
        guard let n = conversations.first(where: { $0.id == id })?.messages else { return }
        noterVu(id, n)
    }

    /// « Marquer comme non lu » (comme Mail) : la dernière réponse redevient à voir.
    public func marquerNonLu(_ id: String) {
        guard let c = conversations.first(where: { $0.id == id }), c.dernier == "assistant",
              let n = c.messages, n > 0 else { return }
        vus[id] = n - 1
        UserDefaults.standard.set(vus, forKey: Self.cleVus)
    }

    private func noterVu(_ id: String, _ n: Int) {
        guard (vus[id] ?? -1) < n else { return }
        vus[id] = n
        UserDefaults.standard.set(vus, forKey: Self.cleVus)
    }

    /// La première fois que la tour donne les comptes : tout ce qui existe est lu.
    private func initialiserVus() {
        guard UserDefaults.standard.object(forKey: Self.cleVus) == nil,
              conversations.contains(where: { $0.messages != nil }) else { return }
        vus = Dictionary(conversations.compactMap { c in c.messages.map { (c.id, $0) } }, uniquingKeysWith: max)
        UserDefaults.standard.set(vus, forKey: Self.cleVus)
    }

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
        privee = false
        recherchePrivee = nil
        vus = [:]
        UserDefaults.standard.removeObject(forKey: Self.cleVus)
    }

    public func rafraichirListe() async {
        do {
            conversations = try await api.conversations()
            erreurListe = nil
            initialiserVus()
            marquerVu()
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
        activiteLe = Date()
        idCourant = conv.id
        titre = conv.title
        origine = conv.origine
        sessionCourante = conv.session
        titreEnAttente = nil
        modeRetenir = false
        compactage = conv.compactage
        // Une conversation importée est privée d'office (la tour le dit aussi).
        privee = conv.prive == true || conv.origine != nil
        lignes = Self.lignes(de: conv)
        noterVu(conv.id, max(conv.messages.count, conversations.first(where: { $0.id == conv.id })?.messages ?? 0))
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
                autorisation: demande,
                mesures: m.mesures
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

    /// « Nouvelle conversation privée » : un écran vide, marqué privé ; le fil
    /// naît privé au premier message (jamais un instant public sur la tour).
    public func nouvellePrivee() {
        fermer()
        privee = true
        focusDemande = true
    }

    /// Rendre privée la conversation en cours. Sans retour : la tour refuse
    /// ensuite de la rendre publique. Pas encore créée : elle le sera privée.
    /// Vrai si elle l'est.
    @discardableResult
    public func rendrePrivee() async -> Bool {
        if privee { return true }
        guard origine == nil, !miseEnPrive else { return false }
        guard let id = idCourant else {
            privee = true
            return true
        }
        miseEnPrive = true
        defer { miseEnPrive = false }
        do {
            try await api.rendrePrivee(id)
            if let i = conversations.firstIndex(where: { $0.id == id }) { conversations[i].prive = true }
            guard idCourant == id else { return true }
            privee = true
            app?.dire("Conversation privée : elle reste sur tes machines.")
            return true
        } catch {
            app?.signaler(error)
            return false
        }
    }

    /// Relit sur la tour si la recherche est permise dans les conversations
    /// privées (pour le dire en clair). Sans le réglage : elle ne cherche pas.
    public func lireRecherchePrivee() async {
        guard app?.serveur?.sait("recherche-privee-v1") == true else {
            recherchePrivee = nil
            return
        }
        if let r = try? await api.reglages() { recherchePrivee = r.recherchePrivee == true }
    }

    /// Dernier geste sur le fil ouvert (ouvert, message envoyé) : un fil laissé
    /// ouvert depuis un autre jour est refermé au retour sur l'onglet.
    @ObservationIgnored public private(set) var activiteLe: Date?

    /// Retour sur l'onglet Rémy : le fil du jour plutôt que celui d'hier (24/10).
    /// Jamais pendant une réponse, ni avec un brouillon ou un message en file.
    @discardableResult
    public func ouvrirFilDuJour(maintenant: Date = Date()) -> Bool {
        guard idCourant != nil, !envoi, fileEnvoi.isEmpty, origine == nil,
              brouillon.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              Fils.aRefermer(derniereActivite: activiteLe, maintenant: maintenant) else { return false }
        fermer()
        return true
    }

    public func fermer() {
        reprendreFile()
        interrompreFlux()
        activiteLe = nil
        idCourant = nil
        titre = ""
        origine = nil
        sessionCourante = nil
        lignes = []
        compactage = nil
        titreEnAttente = nil
        modeRetenir = false
        privee = false
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
        activiteLe = Date()
        generation += 1
        let g = generation
        if idCourant == nil {
            do {
                let conv = try await api.nouvelleConversation(prive: privee)
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
                    conversations.insert(ConversationResume(id: conv.id, title: titre, updatedAt: Date().millis,
                                                            prive: conv.prive == true || privee ? true : nil), at: 0)
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
                    let st = e.decode(StatutSSE.self)
                    lignes[i].statut = st?.text
                    if let cle = st?.cle, let texte = st?.text {
                        if lignes[i].debutEtapes == nil { lignes[i].debutEtapes = Date() }
                        lignes[i].etapes.recevoir(cle: cle, texte: texte, detail: st?.detail, t: st?.t ?? 0)
                    }
                case "debit":
                    if let tps = e.decode(DebitSSE.self)?.tps, tps.isFinite, tps >= 0 { lignes[i].debit = tps }
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
                    lignes[i].debit = nil
                    if let m = f?.mesures { lignes[i].mesures = m }
                    if lignes[i].debutEtapes != nil { lignes[i].finEtapes = Date() }
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
                    lignes[i].debit = nil
                    let me = e.decode(MessageErreur.self)
                    lignes[i].erreur = me?.message ?? "Erreur côté serveur."
                    lignes[i].codeErreur = me?.code
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
                    $0.mesures = reponse.mesures
                    $0.debit = nil
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
    public var retenirChoixDisponible: Bool { app?.serveur?.sait("retenir-choix-v1") == true }

    /// Retenir seulement les infos cochées du texte (Sam, 18/10) : le reste
    /// n'entre pas en mémoire, et le texte entier n'est pas gardé.
    @discardableResult
    public func retenirInfos(_ infos: [String], source: String, texte: String) async -> Bool {
        let choisies = infos.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard !choisies.isEmpty, !captureEnCours else { return false }
        captureEnCours = true
        defer { captureEnCours = false }
        do {
            let r = try await api.retenirInfos(choisies, source: source)
            if brouillon.trimmingCharacters(in: .whitespacesAndNewlines) == texte.trimmingCharacters(in: .whitespacesAndNewlines) { brouillon = "" }
            modeRetenir = false
            app?.dire(r.phrase)
            return true
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            let raison = (error as? LocalizedError)?.errorDescription ?? "erreur"
            app?.dire("Pas retenu : \(raison) Ton texte est toujours là.")
            return false
        }
    }

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
            app?.dire(r.phrase)
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
    /// `confirmer` : Sam a vu que la proposition est périmée (ancienne ou date
    /// passée) et la veut quand même (24/10).
    /// `rangs` : une partie seulement (les lignes cochées, propositions-partielles-v1) ;
    /// nil, tout part.
    @discardableResult
    public func appliquer(_ ligne: LigneChat, confirmer: Bool = false, rangs: [Int]? = nil) async -> Bool {
        guard let p = ligne.proposition else { return false }
        if let rangs, rangs.isEmpty {
            app?.dire("Rien de coché : coche au moins une ligne, ou « Non merci ».")
            return false
        }
        do {
            let r = try await api.appliquer(p, convId: idCourant, index: ligne.indexMessage, confirmer: confirmer, rangs: rangs)
            let bilan = r.bilan
            if let i = lignes.firstIndex(where: { $0.id == ligne.id }) {
                lignes[i].proposition?.statut = r.statut
                lignes[i].proposition?.ledgerId = r.ledgerId
                lignes[i].proposition?.bilan = bilan
                lignes[i].proposition?.annulee = false
                lignes[i].proposition?.perimee = nil
                lignes[i].proposition?.raisonPeremption = nil
            }
            let echecs = bilan.echoues?.count ?? 0
            let ecartees = bilan.ecartees?.count ?? 0
            if r.toutDejaLa {
                // Pas un échec : tout y était déjà.
                app?.dire(p.versAgenda ? "Déjà dans ton agenda : rien à ajouter." : "Déjà dans ton planning : rien à ajouter.")
            } else if echecs == 0 {
                let ou = p.versAgenda ? " dans ton agenda" : bilan.espace.map { " dans « \($0) »" } ?? " dans ton planning"
                app?.dire(ecartees > 0 ? "C'est fait\(ou) (\(p.actions.count - ecartees) sur \(p.actions.count))." : "C'est fait\(ou).")
            } else if echecs >= p.actions.count - ecartees {
                app?.dire("Rien n'a pu être fait : la raison est sous chaque ligne.")
            } else {
                app?.dire("\(echecs) changement\(echecs > 1 ? "s" : "") sur \(p.actions.count) n'\(echecs > 1 ? "ont" : "a") pas pu être fait\(echecs > 1 ? "s" : "") : la raison est sous la ligne.")
            }
            // L'accueil reflète le changement tout de suite (lecture, aucun appel IA).
            await app?.tableau.charger()
            return echecs == 0
        } catch ErreurAPI.serveur(409, let m) where m.contains("confirme pour l'appliquer") {
            // Périmée (la tour l'a vu avant la carte) : rien n'est écrit, la
            // carte le dit et « Oui » demandera de confirmer.
            if let i = lignes.firstIndex(where: { $0.id == ligne.id }) {
                lignes[i].proposition?.perimee = true
                lignes[i].proposition?.raisonPeremption = m
            }
            app?.dire("Rien n'a été fait : \(m)")
            return false
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

    // MARK: Corriger la dictée (19/10)

    public var correctionDicteeDisponible: Bool { app?.serveur?.sait("dictee-correction-v1") == true }

    /// Un mot mal compris, surligné dans le champ : Dictée Locale (sur la tour)
    /// apprend le bon pour les dictées suivantes. Le résultat est dit.
    @discardableResult
    public func corrigerDictee(entendu: String, voulu: String) async -> Bool {
        do {
            try await api.corrigerDictee(entendu: entendu, voulu: voulu)
            app?.dire("Dictée Locale retiendra « \(voulu) ».")
            return true
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            app?.dire("Pas envoyé à Dictée Locale : \((error as? LocalizedError)?.errorDescription ?? "erreur")")
            return false
        }
    }

    // MARK: Ajuster une proposition avant de dire oui (Sam, 18/10)

    public var ajustementDisponible: Bool { app?.serveur?.sait("propositions-ajustables-v1") == true }

    /// Ajuste une action (rang d'origine) : seuls les champs passés changent
    /// (`NSNull()` les vide). La tour garde la version ajustée ; rien ne part.
    @discardableResult
    public func ajuster(_ ligne: LigneChat, rang: Int, champs: [String: Any]) async -> Bool {
        await envoyerAjustement(ligne, actions: [champs.merging(["rang": rang]) { a, _ in a }], convertis: [])
    }

    /// Une création proposée devient un rappel (une to-do datée) : elle sort de
    /// la proposition, et le rappel est noté sur l'iPhone (il part à la tour).
    @discardableResult
    public func rangerEnRappel(_ ligne: LigneChat, rang: Int, texte: String, quand: Date?, etiquettes: [String]) async -> Bool {
        guard await envoyerAjustement(ligne, actions: [], convertis: [rang]) else { return false }
        guard let carnet = app?.carnet, let n = carnet.noterRappel(texte, quand: quand, etiquettes: etiquettes) else { return false }
        if n.dejaLa {
            app?.dire("Déjà dans tes rappels : « \(n.rappel.texte) ».")
        } else {
            app?.dire(quand.map { "Rangé en rappel, \(Format.jourSemaineCourt($0)) \(Format.heure($0))." } ?? "Rangé en rappel, sans date.")
        }
        return true
    }

    private func envoyerAjustement(_ ligne: LigneChat, actions: [[String: Any]], convertis: [Int]) async -> Bool {
        guard let convId = idCourant, let pid = ligne.proposition?.id else {
            app?.dire("Cette proposition ne peut pas être ajustée : redemande-la à Rémy.")
            return false
        }
        do {
            let r = try await api.ajusterProposition(convId: convId, propositionId: pid, actions: actions, convertis: convertis)
            if let i = lignes.firstIndex(where: { $0.id == ligne.id }), var p = lignes[i].proposition {
                if p.actionsOrigine == nil { p.actionsOrigine = p.actions }
                p.actions = r.actions
                p.ajustee = true
                // Ajustée, la tour la remet à neuf ; une date encore passée rendra
                // 409 « perimee » au « Oui », et la carte le redira.
                p.perimee = nil
                p.raisonPeremption = nil
                if r.statut == "converti" { p.statut = "converti" }
                lignes[i].proposition = p
            }
            return true
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            if let e = error as? ErreurAPI, case .serveur(409, _) = e { app?.signaler(error); await ouvrir(convId); return false }
            let raison = (error as? LocalizedError)?.errorDescription ?? "erreur"
            app?.dire("Pas ajusté : \(raison)")
            return false
        }
    }

    public var reglesDisponibles: Bool { app?.serveur?.sait("regles-v1") == true }

    /// Sam valide une règle proposée par Rémy (19/10). Vrai si elle est créée.
    @discardableResult
    public func validerRegle(_ ligne: LigneChat) async -> Bool {
        guard let convId = idCourant, let p = ligne.proposition, let pid = p.id else { return false }
        do {
            let r = try await api.validerRegle(convId: convId, propositionId: pid)
            if let i = lignes.firstIndex(where: { $0.id == ligne.id }) {
                lignes[i].proposition?.statut = "applique"
                if r.deja { lignes[i].proposition?.bilan = Bilan(faits: [], dejaLa: [p.actions.first?.nom ?? "règle"]) }
            }
            // Redemandée : dite telle quelle ou mise à jour, jamais « créée » à tort.
            app?.dire(r.phrase)
            return true
        } catch {
            app?.signaler(error)
            return false
        }
    }

    /// Sam valide les courses ou le rappel proposés par Rémy (24/10) : la tour
    /// les écrit dans le carnet, puis l'iPhone relit le carnet (le rappel daté
    /// sonne alors ici). Vrai si c'est écrit.
    @discardableResult
    public func validerCarnet(_ ligne: LigneChat) async -> Bool {
        guard let convId = idCourant, let p = ligne.proposition, let pid = p.id else {
            app?.dire("Cette proposition n'a pas d'identifiant : redemande-la à Rémy.")
            return false
        }
        do {
            let bilan = try await api.validerCarnet(convId: convId, propositionId: pid)
            if let i = lignes.firstIndex(where: { $0.id == ligne.id }) {
                lignes[i].proposition?.statut = "applique"
                if let bilan { lignes[i].proposition?.bilan = bilan }
            }
            await app?.carnet.charger()
            let faits = bilan?.faits ?? []
            app?.dire(faits.isEmpty ? "C'est dans ton carnet." : "Ajouté : \(faits.joined(separator: ", ")).")
            return true
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return false }
            if let e = error as? ErreurAPI, case .serveur(409, _) = e { app?.signaler(error); await ouvrir(convId); return false }
            var raison = (error as? LocalizedError)?.errorDescription ?? "erreur"
            if raison.hasSuffix(".") { raison.removeLast() }
            app?.dire("Pas ajouté : \(raison). Réessaie, ou ajoute-le à la main dans Projets.")
            return false
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
