import Foundation

// MARK: - La file d'envoi des captures (25/10)
//
// Une capture notée sans réseau (tâche, idée, Retenir, projet) n'est plus
// proposée « en rappel » : elle attend sur l'iPhone, telle que l'iPhone l'a
// comprise (genre, titre, échéance figés), et part dès que Rémy est
// joignable — au retour du réseau, au premier plan, au lancement. Elle vit
// dans la même file que les coches (`Commande`), écrite sur le disque AVANT
// de partir. Son identifiant part avec elle et la tour le reconnaît : un
// envoi rejoué ne crée jamais deux tâches. Les rappels et les listes, déjà
// sur l'iPhone, ne changent pas.
//
// Contre-relecture (25/10) : une panne passagère (Rémy arrêté derrière
// Tailscale, base indisponible, Motion en quota ou en panne) n'est pas un
// refus — la capture repart seule, de plus en plus espacée ; seul un vrai
// refus attend Sam. Un envoi resté sans réponse rend « ne partira pas »
// impossible à promettre : on dit d'aller vérifier. Une session refusée
// (401) ne l'efface pas : seule la déconnexion voulue le fait.

/// Ce que le « + » a compris, figé au moment de la capture : rejoué tel quel,
/// jamais recalculé (« vendredi » reste le vendredi d'alors).
public struct CaptureFigee: Codable, Equatable, Sendable {
    public enum Genre: String, Codable, Sendable {
        case tache, idee, retenir, projet
    }

    public var genre: Genre
    /// Le titre de la tâche, le texte de l'idée ou à retenir, le nom du dossier.
    public var texte: String
    /// Une tâche : l'échéance comprise (une date limite, jamais un créneau).
    public var echeance: Date?
    /// Un projet : où le ranger (un dossier, ou « motion:… ») ; nil : à part.
    public var parent: String?
    /// Le nom de cet endroit, pour la liste d'attente.
    public var nomParent: String?

    public init(genre: Genre, texte: String, echeance: Date? = nil, parent: String? = nil, nomParent: String? = nil) {
        self.genre = genre
        self.texte = texte
        self.echeance = echeance
        self.parent = parent
        self.nomParent = nomParent
    }

    public var libelle: String {
        switch genre {
        case .tache: return "Tâche"
        case .idee: return "Idée"
        case .retenir: return "Retenir"
        case .projet: return "Dossier"
        }
    }

    /// Ce que la liste d'attente montre sous le texte.
    public var detail: String {
        switch genre {
        case .tache:
            guard let e = echeance else { return "Motion lui trouvera un créneau" }
            // Jamais déplacée en silence : elle part telle quelle, et c'est dit.
            return e < Date() ? "Motion, échéance déjà passée (\(Format.echeanceLongue(e))) : elle y arrivera en retard"
                              : "Motion, d'ici \(Format.echeanceLongue(e))"
        case .idee: return "Idées (Projets), rien n'est planifié"
        case .retenir: return "Mémoire de Rémy"
        case .projet: return "Projets" + (nomParent.map { ", dans « \($0) »" } ?? ", à part")
        }
    }

    /// Où vérifier qu'elle est arrivée.
    public var ou: String {
        switch genre {
        case .tache: return "dans Motion"
        case .idee: return "dans tes Idées (Projets)"
        case .retenir: return "dans la mémoire de Rémy"
        case .projet: return "dans Projets"
        }
    }

    /// Le début du texte, pour un message (« Préparer la réunion de… »).
    public static func court(_ texte: String, _ n: Int = 40) -> String {
        let t = texte.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.count <= n ? t : String(t.prefix(n - 1)).trimmingCharacters(in: .whitespaces) + "…"
    }

    /// Le début d'un message de refus, feuille ouverte.
    var refus: String {
        switch genre {
        case .tache: return "Pas ajouté à Motion"
        case .idee: return "Idée pas gardée"
        case .retenir: return "Pas retenu"
        case .projet: return "Dossier pas créé"
        }
    }
}

/// Ce qu'une capture est devenue chez la tour.
enum CaptureEcrite {
    /// Faite (ou déjà là) : le message, feuille ouverte ; le même, partie plus tard.
    case faite(phrase: String, envoye: String, annuler: (@MainActor () -> Void)?)
    /// Refusée par la tour ou Motion : sa raison.
    case refusee(String)
    /// Motion n'a pas pu cette fois (quota, panne, délai) : rien n'est écrit,
    /// elle repartira seule.
    case passagere(String)
}

/// Ce qu'un échec d'envoi dit de la capture.
enum NatureEchec: Equatable {
    /// Pas de réponse nette (réseau coupé, délai, 500, 504, réponse
    /// illisible) : la tour l'a peut-être écrite.
    case incertain
    /// Une réponse nette, rien d'écrit, et ça passera : Rémy arrêté derrière
    /// Tailscale (502), base indisponible (503), quota (429), délai (408).
    case passager
    /// Un refus (400, 404, 409, 422…) : il attend Sam.
    case refus

    init(_ e: Error) {
        switch e as? ErreurAPI {
        case .reseau, .illisible: self = .incertain
        case let .serveur(code, _):
            self = [500, 504].contains(code) ? .incertain : [408, 425, 429, 502, 503].contains(code) ? .passager : .refus
        default: self = .refus
        }
    }
}

extension TableauModel {
    /// Les captures qui attendent la tour (sans celle que la feuille du « + »
    /// envoie en ce moment).
    public var capturesEnAttente: [Commande] {
        envoi.filter { $0.capture != nil && !enEnvoiDirect.contains($0.id) }
    }

    /// La tour reconnaîtra cette capture si elle la reçoit deux fois : une
    /// tâche par sa clé (`idCommande`, propositions-v1), une idée ou un dossier
    /// par leur identifiant (écrits, jamais ajoutés), Retenir par
    /// `idCapture` (capture-idempotente-v1).
    func sansDoublon(_ c: CaptureFigee) -> Bool {
        switch c.genre {
        case .tache: return api.rejeuSur
        case .idee, .projet: return true
        case .retenir: return app?.serveur?.sait("capture-idempotente-v1") == true
        }
    }

    /// Repart seule : rien ne l'arrête (refus, doute), et la tour ne risque
    /// pas de la faire deux fois — une tour plus ancienne ne la reçoit qu'une
    /// fois, jamais de renvoi à l'aveugle.
    public func partSeule(_ c: Commande) -> Bool {
        guard let capture = c.capture, c.raison == nil else { return false }
        return sansDoublon(capture) || c.tentatives == 0
    }

    /// Ce que la liste d'attente dit d'une capture, et si elle attend Sam
    /// (« Renvoyer ») : refusée, ou peut-être déjà reçue par une tour qui ne
    /// reconnaît pas un renvoi — jamais bloquée sans bouton.
    public func etat(_ c: Commande, maintenant: Date = Date()) -> (texte: String, aRevoir: Bool) {
        if let r = c.raison { return (r, true) }
        guard partSeule(c) else { return (Self.peutEtreRecue, true) }
        guard let e = c.dernierEchec else { return ("Partira dès que Rémy sera joignable", false) }
        let quand = c.partApres > maintenant ? ", nouvel essai seul vers \(Format.heure(c.partApres))" : ", nouvel essai seul dès que possible"
        return ("Dernier essai : \(e)\(quand)", false)
    }

    /// Le temps d'attendre avant un nouvel essai, après `n` pannes passagères.
    static func attente(apres n: Int) -> TimeInterval {
        switch n {
        case ...1: return 60
        case 2: return 120
        case 3: return 300
        default: return 900
        }
    }

    /// « Erreur 502 — réessaie. », « … (429) : réessaie dans une minute » :
    /// l'app réessaie seule, la consigne n'a pas à rester.
    static func sansConsigne(_ raison: String) -> String {
        let r = raison.replacingOccurrences(of: #"\s*(?:—|-|:|,)\s*réessaie[^.]*\.?\s*$"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        return r.isEmpty ? raison : r
    }

    /// Une capture tapée feuille ouverte : la tour la reconnaît si elle est
    /// renvoyée, donc un essai court suffit (une tour muette ne fait pas
    /// attendre 2 × 150 s), puis la file prend le relais avec la même clé.
    static let delaiCourt: TimeInterval = 30

    /// Le « + » : la capture est écrite sur l'iPhone, puis part. Rend vrai si
    /// elle est partie ou gardée pour plus tard (la feuille se ferme), faux si
    /// la tour ou Motion l'a refusée (le texte reste dans le champ).
    @discardableResult
    public func noter(_ capture: CaptureFigee) async -> Bool {
        let commande = Commande(geste: .capture(capture))
        ajouter(commande)
        // L'iPhone sait qu'il n'a aucun réseau, ou que Rémy ne répond pas (la
        // journée vient d'échouer, ce que le « + » annonçait) : rien ne part
        // d'ici, la feuille se ferme tout de suite. Rémy injoignable, la file
        // l'essaie derrière, sans faire attendre.
        if app?.horsLigne == true {
            direEnAttente(commande.id, .sansReseau)
            return true
        }
        if erreurReseau {
            direEnAttente(commande.id, .injoignable)
            Task { [weak self] in await self?.envoyerEnAttente() }
            return true
        }
        enEnvoiDirect.insert(commande.id)
        defer { enEnvoiDirect.remove(commande.id) }
        switch await envoyerCapture(commande, reprise: false) {
        case .faite, .deja, .enAttente: return true
        case .echec, .renoncee: return false
        }
    }

    /// « Retirer » dans la liste d'attente : elle ne partira pas. « Annuler »
    /// la remet telle quelle.
    public func retirerCapture(_ id: String) {
        guard let c = envoi.first(where: { $0.id == id }), let capture = c.capture else { return }
        guard !envoisEnCours.contains(id) else {
            app?.dire("« \(CaptureFigee.court(capture.texte)) » part en ce moment : attends la réponse de Rémy.")
            return
        }
        retirer(id)
        app?.dire(Self.phraseRetiree(c, "Retirée"), annuler: { [weak self] in
            guard let self, !self.envoi.contains(where: { $0.id == id }) else { return }
            self.ajouter(c)
        })
    }

    /// « ne partira pas » seulement si aucun envoi n'est resté sans réponse :
    /// sinon la tour l'a peut-être écrite (réponse perdue en route), et on le dit.
    static func phraseRetiree(_ c: Commande, _ verbe: String) -> String {
        guard let capture = c.capture else { return verbe + "." }
        let court = CaptureFigee.court(capture.texte)
        return c.tentatives > 0
            ? "\(verbe) de la file : « \(court) ». Un envoi est resté sans réponse, elle est peut-être déjà arrivée : vérifie \(capture.ou)."
            : "\(verbe) : « \(court) » ne partira pas."
    }

    /// « Renvoyer » : Sam a vérifié (refusée, ou peut-être déjà reçue) ; elle
    /// repart maintenant, avec le même identifiant.
    public func renvoyerCapture(_ id: String) async {
        guard let attente = envoi.first(where: { $0.id == id }) else { return }
        // Déjà en route : effacer son doute maintenant la ferait repartir à l'aveugle.
        guard !envoisEnCours.contains(id) else {
            app?.dire("« \(CaptureFigee.court(attente.capture?.texte ?? "")) » part en ce moment : attends la réponse de Rémy.")
            return
        }
        modifier(id) {
            $0.raison = nil
            $0.tentatives = 0
            $0.reports = nil
            $0.dernierEchec = nil
            $0.partApres = Date()
        }
        guard let c = envoi.first(where: { $0.id == id }), let capture = c.capture else { return }
        if await envoyerCapture(c, reprise: true) == .enAttente {
            app?.dire(sansDoublon(capture) ? "Toujours pas de réponse : elle repartira seule dès que Rémy sera joignable."
                                           : "Toujours pas de réponse de Rémy : elle reste dans « En attente d'envoi ».")
        }
    }

    enum MotifAttente { case sansReseau, injoignable, sansReponse, passager }

    /// Feuille ouverte : la capture est gardée, c'est dit, « Annuler » la retire.
    private func direEnAttente(_ id: String, _ motif: MotifAttente) {
        guard let c = envoi.first(where: { $0.id == id })?.capture else { return }
        let court = CaptureFigee.court(c.texte)
        let texte: String
        switch motif {
        case .sansReseau: texte = "Pas de réseau : « \(court) » partira dès que Rémy sera joignable."
        case .injoignable: texte = "Rémy ne répond pas : « \(court) » est gardée sur l'iPhone, elle partira dès qu'il sera joignable."
        case .sansReponse: texte = "Pas de réponse de Rémy : « \(court) » est gardée sur l'iPhone, elle partira dès qu'il sera joignable."
        case .passager: texte = "Rémy ne peut pas la prendre pour l'instant : « \(court) » est gardée sur l'iPhone, elle repartira seule."
        }
        app?.dire(texte, annuler: { [weak self] in
            guard let self, let actuelle = self.envoi.first(where: { $0.id == id }) else { return }
            if self.envoisEnCours.contains(id) {
                self.app?.dire("Elle part en ce moment : retire-la ensuite si besoin.")
                return
            }
            self.retirer(id)
            self.app?.dire(Self.phraseRetiree(actuelle, "Annulée"))
        }, duree: 8)
    }

    /// Envoie une capture de la file. `reprise` : partie plus tard (la feuille
    /// est fermée) — un refus la garde, avec sa raison, dans la liste.
    func envoyerCapture(_ commande: Commande, reprise: Bool) async -> IssueCoche {
        guard let c = commande.capture else { return .echec }
        guard envoisEnCours.insert(commande.id).inserted else { return .deja }
        defer { envoisEnCours.remove(commande.id) }
        // Retirée entre-temps (« Retirer » pendant que la file part) : elle ne
        // part pas — « ne partira pas » a été dit.
        guard envoi.contains(where: { $0.id == commande.id }) else { return .deja }
        let sur = sansDoublon(c)
        // Une tour qui ne reconnaît pas un renvoi : la tentative est notée
        // AVANT de partir, avec son doute. L'app fermée en route, elle attend
        // Sam (« Renvoyer » ou « Retirer ») au lieu de rester bloquée.
        if !sur {
            modifier(commande.id) {
                $0.tentatives += 1
                $0.raison = Self.peutEtreRecue
            }
        }
        /// Une réponse nette de la tour. Elle reconnaît la clé : sa réponse vaut
        /// pour les envois restés sans réponse, le doute tombe. Sinon, seul le
        /// doute de CET envoi tombe (rien d'écrit cette fois).
        func reponseNette() {
            modifier(commande.id) {
                if sur {
                    $0.tentatives = 0
                } else {
                    $0.tentatives = max(0, $0.tentatives - 1)
                    $0.raison = nil
                }
            }
        }
        do {
            switch try await ecrire(c, id: commande.id, court: !reprise && sur) {
            case let .faite(phrase, envoye, annuler):
                retirer(commande.id)
                app?.dire(reprise ? envoye : phrase, annuler: annuler)
                return .faite
            case let .refusee(raison):
                reponseNette()
                refusee(commande, raison, reprise: reprise, avecPoint: true)
                return .echec
            case let .passagere(raison):
                reponseNette()
                return reporter(commande.id, raison, reprise: reprise, incertain: false)
            }
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte {
                // Refusée à l'entrée : rien n'est parti. Elle reste sur
                // l'iPhone et repartira après la reconnexion ; seule la
                // déconnexion voulue l'efface.
                reponseNette()
                app?.signaler(e)
                return .echec
            }
            let raison = (error as? LocalizedError)?.errorDescription ?? "erreur"
            switch NatureEchec(error) {
            case .incertain:
                guard sur else {
                    // Le doute (noté avant l'envoi) reste : elle attend Sam.
                    modifier(commande.id) {
                        $0.raison = Self.peutEtreRecue
                        $0.tentatives = max(1, $0.tentatives)
                    }
                    if !reprise {
                        app?.dire("Pas de réponse de Rémy pendant l'envoi : il l'a peut-être reçue. Elle reste dans « En attente d'envoi » : renvoie-la seulement si elle n'est pas arrivée.",
                                  duree: 8)
                    }
                    return .enAttente
                }
                if case .reseau = error as? ErreurAPI {
                    // Coupé : elle repart au retour du réseau, avec la même clé.
                    modifier(commande.id) { $0.tentatives += 1 }
                    if !reprise { direEnAttente(commande.id, .sansReponse) }
                    return .enAttente
                }
                return reporter(commande.id, raison, reprise: reprise, incertain: true)
            case .passager:
                reponseNette()
                return reporter(commande.id, raison, reprise: reprise, incertain: false)
            case .refus:
                // Refus de la tour (un code d'erreur) : il attend Sam.
                reponseNette()
                refusee(commande, raison, reprise: reprise, avecPoint: false)
                return .echec
            }
        }
    }

    static let peutEtreRecue = "Pas de réponse de Rémy pendant l'envoi : il l'a peut-être déjà reçue. Renvoie-la seulement si elle n'est pas arrivée."

    /// Une panne passagère : la capture reste, sans raison (elle n'attend pas
    /// Sam), et repart seule de plus en plus espacée (1, 2, 5, puis 15 min).
    /// `incertain` : sans réponse nette, elle est peut-être arrivée.
    private func reporter(_ id: String, _ raison: String, reprise: Bool, incertain: Bool) -> IssueCoche {
        let n = (envoi.first { $0.id == id }?.reports ?? 0) + 1
        modifier(id) {
            if incertain { $0.tentatives += 1 }
            $0.reports = n
            $0.dernierEchec = Self.sansConsigne(raison)
            $0.partApres = Date().addingTimeInterval(Self.attente(apres: n))
        }
        if !reprise { direEnAttente(id, .passager) }
        return .enAttente
    }

    /// Feuille ouverte : la capture quitte la file, le texte reste dans le
    /// champ. Partie plus tard : elle reste dans la liste, avec sa raison,
    /// jusqu'à ce que Sam la renvoie ou la retire.
    private func refusee(_ commande: Commande, _ raison: String, reprise: Bool, avecPoint: Bool) {
        guard let c = commande.capture else { return }
        if reprise {
            modifier(commande.id) { $0.raison = raison }
            app?.dire("Pas envoyé : « \(CaptureFigee.court(c.texte)) » — \(raison)\(avecPoint ? "." : "") Elle reste dans « En attente d'envoi ».")
        } else {
            retirer(commande.id)
            app?.dire(avecPoint ? "\(c.refus) : \(raison)." : "\(c.refus) : \(raison) Ton texte est toujours là.")
        }
    }

    /// L'écriture elle-même, avec l'identifiant de la capture.
    private func ecrire(_ c: CaptureFigee, id: String, court: Bool) async throws -> CaptureEcrite {
        switch c.genre {
        case .tache:
            let p = Proposition(source: "motion", resume: "Noté depuis l'app", actions: [
                ActionProposee(type: "creer", nom: c.texte, echeance: c.echeance.map { Format.isoAvecFuseau($0) }),
            ])
            let r = try await api.appliquer(p, convId: nil, index: nil, idCommande: id,
                                            delai: court ? Self.delaiCourt : DelaisMotion.ecriture, rejouer: !court)
            let res = r.results?.first
            if r.toutDejaLa {
                // Déjà là n'est pas un échec (24/10).
                return .faite(phrase: "Déjà dans Motion : « \(c.texte) ».", envoye: "Envoyé : « \(c.texte) » était déjà dans Motion.", annuler: nil)
            }
            if (r.echecs ?? 0) > 0 || res?.ok == false {
                // Motion en quota, en panne ou lent : rien n'est écrit, elle repartira.
                if res?.passager == true { return .passagere(res?.erreur ?? "Motion indisponible") }
                return .refusee(res?.erreur ?? "raison inconnue")
            }
            var annuler: (@MainActor () -> Void)?
            if let ledger = r.ledgerId {
                annuler = { [weak self] in
                    Task {
                        guard let self else { return }
                        do {
                            let a = try await self.api.annuler(Proposition(source: "motion", resume: nil, actions: [], ledgerId: ledger))
                            self.app?.dire(a.ok == false ? "Impossible de retirer « \(c.texte) » de Motion." : "Retirée de Motion : « \(c.texte) ».")
                            await self.apresGeste()
                        } catch {
                            self.app?.signaler(error)
                        }
                    }
                }
            }
            // La journée se relit derrière : attendre ici gardait la feuille
            // ouverte pendant que la confirmation s'usait dessous.
            apresGesteSansAttendre()
            // Partie après son échéance (notée hors ligne hier) : envoyée telle
            // quelle, jamais déplacée en silence — et c'est dit.
            let quand = c.echeance.map {
                $0 < Date() ? " — son échéance (\(Format.echeanceLongue($0))) était déjà passée : elle y est en retard."
                            : ", à faire d'ici \(Format.echeanceLongue($0))."
            }
            return .faite(phrase: "Ajoutée à Motion : « \(c.texte) »" + (quand ?? ". Il lui trouve un créneau."),
                          envoye: "Envoyé : « \(c.texte) » est dans Motion" + (quand ?? "."),
                          annuler: annuler)
        case .idee:
            let org = app?.organisation
            if org?.dossiers.contains(where: { $0.id == "idees" }) != true {
                // Lu d'abord : un dossier « Idées » renommé ou déplacé ne se réécrit pas.
                let lus = try await api.dossiers()
                if !lus.contains(where: { $0.id == "idees" }) {
                    try await api.ecrireDossier(Dossier(id: "idees", nom: "Idées", parent: nil, ordre: -2))
                }
            }
            // L'identifiant de la capture est celui de la note : la réécrire ne la double pas.
            let note = NoteDossier(id: id, texte: String(c.texte.prefix(500)))
            try await api.ecrireNotes("idees", [note])
            await org?.charger()
            return .faite(phrase: "Gardée dans « Idées » (Projets) : rien n'est planifié.",
                          envoye: "Envoyé : « \(CaptureFigee.court(c.texte)) » est dans tes Idées (Projets).",
                          annuler: { Task { await org?.supprimer(note, dans: "idees") } })
        case .retenir:
            let r = try await api.capturer(c.texte, source: "note", idCapture: sansDoublon(c) ? id : nil)
            return .faite(phrase: r.phrase, envoye: "Envoyé à Rémy. " + r.phrase, annuler: nil)
        case .projet:
            let org = app?.organisation
            let ordre = ((org?.enfants(de: c.parent).compactMap(\.ordre).max()) ?? -1) + 1
            // L'identifiant de la capture est celui du dossier : le réécrire ne le double pas.
            try await api.ecrireDossier(Dossier(id: id, nom: String(c.texte.prefix(120)), parent: c.parent, ordre: ordre))
            await org?.charger()
            return .faite(phrase: "Dossier « \(c.texte) » créé (Projets).", envoye: "Envoyé : le dossier « \(c.texte) » est créé (Projets).", annuler: nil)
        }
    }
}

extension AppModel {
    /// Le « + », genre Idée : gardée dans « Idées » (Projets), rien n'est
    /// planifié. Sans réseau, elle attend sur l'iPhone.
    @discardableResult
    public func noterIdee(_ texte: String) async -> Bool {
        let t = texte.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return false }
        guard organisation.dossiersDisponibles else {
            dire("Les Idées arriveront avec la mise à jour de ta tour.")
            return false
        }
        return await tableau.noter(CaptureFigee(genre: .idee, texte: String(t.prefix(500))))
    }

    /// Le « + », genre Projet : un dossier dans Remy (pas de projet Motion),
    /// rangé dans `parent` (son nom dans `nomParent`). Sans réseau, il attend.
    @discardableResult
    public func noterDossier(_ nom: String, parent: String?, nomParent: String? = nil) async -> Bool {
        let n = nom.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return false }
        return await tableau.noter(CaptureFigee(genre: .projet, texte: String(n.prefix(120)), parent: parent, nomParent: nomParent))
    }
}
