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
        case .tache: return echeance.map { "Motion, d'ici \(Format.echeanceLongue($0))" } ?? "Motion lui trouvera un créneau"
        case .idee: return "Idées (Projets), rien n'est planifié"
        case .retenir: return "Mémoire de Rémy"
        case .projet: return "Projets" + (nomParent.map { ", dans « \($0) »" } ?? ", à part")
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

    /// Le « + » : la capture est écrite sur l'iPhone, puis part. Rend vrai si
    /// elle est partie ou gardée pour plus tard (la feuille se ferme), faux si
    /// la tour ou Motion l'a refusée (le texte reste dans le champ).
    @discardableResult
    public func noter(_ capture: CaptureFigee) async -> Bool {
        let commande = Commande(geste: .capture(capture))
        ajouter(commande)
        // L'iPhone sait qu'il n'a aucun réseau : rien ne part, rien ne peut
        // arriver deux fois.
        if app?.horsLigne == true {
            direEnAttente(commande)
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
        app?.dire("Retirée : « \(CaptureFigee.court(capture.texte)) » ne partira pas.", annuler: { [weak self] in
            guard let self, !self.envoi.contains(where: { $0.id == id }) else { return }
            self.ajouter(c)
        })
    }

    /// « Renvoyer » : Sam a vérifié (refusée, ou peut-être déjà reçue) ; elle
    /// repart maintenant, avec le même identifiant.
    public func renvoyerCapture(_ id: String) async {
        guard envoi.contains(where: { $0.id == id }) else { return }
        modifier(id) {
            $0.raison = nil
            $0.tentatives = 0
        }
        guard let c = envoi.first(where: { $0.id == id }), let capture = c.capture else { return }
        if await envoyerCapture(c, reprise: true) == .enAttente {
            app?.dire(sansDoublon(capture) ? "Toujours pas de réseau : elle partira dès que Rémy sera joignable."
                                           : "Toujours pas de réponse de Rémy : elle reste dans « En attente d'envoi ».")
        }
    }

    private func direEnAttente(_ commande: Commande) {
        guard let c = commande.capture else { return }
        let id = commande.id
        app?.dire("Pas de réseau : « \(CaptureFigee.court(c.texte)) » partira dès que Rémy sera joignable.", annuler: { [weak self] in
            guard let self else { return }
            if self.envoisEnCours.contains(id) {
                self.app?.dire("Elle part en ce moment : retire-la ensuite si besoin.")
                return
            }
            self.retirer(id)
            self.app?.dire("Annulée : « \(CaptureFigee.court(c.texte)) » ne partira pas.")
        }, duree: 8)
    }

    /// Envoie une capture de la file. `reprise` : partie plus tard (la feuille
    /// est fermée) — un refus la garde, avec sa raison, dans la liste.
    func envoyerCapture(_ commande: Commande, reprise: Bool) async -> IssueCoche {
        guard let c = commande.capture else { return .echec }
        guard envoisEnCours.insert(commande.id).inserted else { return .deja }
        defer { envoisEnCours.remove(commande.id) }
        let sur = sansDoublon(c)
        // Une tour qui ne reconnaît pas un renvoi : la tentative est notée
        // AVANT de partir. L'app fermée en route, elle ne repartira pas seule.
        if !sur { modifier(commande.id) { $0.tentatives += 1 } }
        do {
            switch try await ecrire(c, id: commande.id) {
            case let .faite(phrase, envoye, annuler):
                retirer(commande.id)
                app?.dire(reprise ? envoye : phrase, annuler: annuler)
                return .faite
            case let .refusee(raison):
                refusee(commande, raison, reprise: reprise, avecPoint: true)
                return .echec
            }
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app?.signaler(e); return .echec }
            if case .reseau = error as? ErreurAPI {
                if sur {
                    modifier(commande.id) { $0.tentatives += 1 }
                    if !reprise { direEnAttente(commande) }
                } else {
                    modifier(commande.id) { $0.raison = Self.peutEtreRecue }
                    if !reprise {
                        app?.dire("Réseau coupé pendant l'envoi : Rémy l'a peut-être reçue. Elle reste dans « En attente d'envoi » : renvoie-la seulement si elle n'est pas arrivée.",
                                  duree: 8)
                    }
                }
                return .enAttente
            }
            // Refus de la tour (un code d'erreur), ou une réponse illisible.
            refusee(commande, (error as? LocalizedError)?.errorDescription ?? "erreur", reprise: reprise, avecPoint: false)
            return .echec
        }
    }

    static let peutEtreRecue = "Réseau coupé pendant l'envoi : Rémy l'a peut-être déjà reçue. Renvoie-la seulement si elle n'est pas arrivée."

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
    private func ecrire(_ c: CaptureFigee, id: String) async throws -> CaptureEcrite {
        switch c.genre {
        case .tache:
            let p = Proposition(source: "motion", resume: "Noté depuis l'app", actions: [
                ActionProposee(type: "creer", nom: c.texte, echeance: c.echeance.map { Format.isoAvecFuseau($0) }),
            ])
            let r = try await api.appliquer(p, convId: nil, index: nil, idCommande: id)
            let res = r.results?.first
            if r.toutDejaLa {
                // Déjà là n'est pas un échec (24/10).
                return .faite(phrase: "Déjà dans Motion : « \(c.texte) ».", envoye: "Envoyé : « \(c.texte) » était déjà dans Motion.", annuler: nil)
            }
            if (r.echecs ?? 0) > 0 || res?.ok == false { return .refusee(res?.erreur ?? "raison inconnue") }
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
            let quand = c.echeance.map { ", à faire d'ici \(Format.echeanceLongue($0))." } ?? ". Il lui trouve un créneau."
            return .faite(phrase: "Ajoutée à Motion : « \(c.texte) »" + quand,
                          envoye: "Envoyé : « \(c.texte) » est dans Motion" + (c.echeance.map { ", à faire d'ici \(Format.echeanceLongue($0))." } ?? "."),
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
