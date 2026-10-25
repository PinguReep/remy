import XCTest
import Network

/// Le banc des parcours : lance l'app contre la tour de démo (comme les
/// captures de la CI), compte les gestes, chronomètre et capture chaque étape.
/// Données fictives seulement ; aucune vraie tour, aucune vraie clé.
enum Banc {
    private static let env = ProcessInfo.processInfo.environment
    /// Passées par xcodebuild (préfixe TEST_RUNNER_), sinon les valeurs de la CI.
    static var tour: String { env["REMY_PARCOURS_TOUR"] ?? "http://127.0.0.1:3000" }
    static var mdp: String { env["REMY_PARCOURS_MDP"] ?? "demo-demo-demo" }
    static var portPilote: UInt16 { UInt16(env["REMY_PARCOURS_PILOTE"] ?? "") ?? 3099 }
    /// La même tour, sous un autre nom : un trousseau vierge (jeton rangé par hôte).
    static var tourAutreNom: String { tour.replacingOccurrences(of: "127.0.0.1", with: "localhost") }
}

/// Le pilote de la tour de démo (ios-native/RemyParcours/tour-pilote.mjs) :
/// remettre les données d'origine, couper ou relancer la tour en plein parcours.
/// En TCP brut (Network) : l'ATS du lanceur de tests ne s'en mêle pas.
enum Pilote {
    @discardableResult
    static func demander(_ chemin: String, delai: TimeInterval = 90) -> String {
        let fini = DispatchSemaphore(value: 0)
        let recu = Tampon()
        let connexion = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: Banc.portPilote)!, using: .tcp)
        connexion.stateUpdateHandler = { etat in
            switch etat {
            case .ready:
                let requete = "POST \(chemin) HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                connexion.send(content: Data(requete.utf8), completion: .contentProcessed { _ in })
                func lire() {
                    connexion.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { donnees, _, termine, erreur in
                        if let donnees { recu.ajouter(donnees) }
                        if termine || erreur != nil {
                            connexion.cancel()
                            fini.signal()
                        } else {
                            lire()
                        }
                    }
                }
                lire()
            case .failed, .cancelled:
                fini.signal()
            default:
                break
            }
        }
        connexion.start(queue: .global())
        _ = fini.wait(timeout: .now() + delai)
        connexion.cancel()
        return recu.texte
    }

    /// Les données de démo d'origine, la journée recalée sur maintenant.
    static func reinitialiser() {
        let r = demander("/reinitialiser")
        if !r.contains("200") { print("PARCOURS|pilote|réinitialisation sans réponse : \(r.prefix(120))") }
    }

    static func couperTour() { demander("/couper") }
    static func relancerTour() { demander("/relancer") }
}

private final class Tampon: @unchecked Sendable {
    private let verrou = NSLock()
    private var donnees = Data()
    func ajouter(_ d: Data) { verrou.lock(); donnees.append(d); verrou.unlock() }
    var texte: String { verrou.lock(); defer { verrou.unlock() }; return String(decoding: donnees, as: UTF8.self) }
}

/// Une vérification ratée : le parcours s'arrête proprement (capture et
/// mesures gardées), sans exception Objective-C.
struct ArretParcours: Error {}

/// La base de chaque parcours.
class ParcoursBase: XCTestCase {
    var app: XCUIApplication!
    private var identifiant = "P00"
    private var titre = ""
    private var debut = Date()
    private var dernier = Date()
    private var gestes = 0
    private var gestesEtape = 0
    private var numero = 0
    private var etapes: [[String: Any]] = []
    private var constats: [String] = []
    /// Ce que cherche chaque élément (« texte « … » »), pour un échec lisible.
    private var noms: [ObjectIdentifier: String] = [:]

    func nomme(_ e: XCUIElement, _ n: String) -> XCUIElement {
        noms[ObjectIdentifier(e)] = n
        return e
    }

    @MainActor
    func nom(_ e: XCUIElement) -> String { noms[ObjectIdentifier(e)] ?? e.description }

    /// Après un geste fait dans une feuille (le « + ») : la confirmation, avec
    /// son « Annuler », doit rester visible une fois la feuille refermée.
    /// Corrigé (ToastView ne l'efface plus quand la feuille l'annule) : une
    /// vraie vérification, plus un constat.
    @MainActor
    func confirmationApresFeuille(_ message: String, champ: XCUIElement) throws {
        let toast = texte(message)
        let pendant = toast.waitForExistence(timeout: 3)
        // Regardé dès que la feuille est partie, avant la capture : le message
        // vit 6 s depuis le geste, et chaque requête XCUITest sur l'accueil
        // (chargé depuis le build 37) prend son temps (vu : 12 s pour l'étape).
        let fermee = attendreDisparition(champ, delai: 10)
        let apres = fermee && toast.exists
        let annuler = apres && bouton("Annuler").exists
        try etape("feuille-fermee", absent: [champ], delai: 2)
        noter("confirmation « \(message) » vue pendant la fermeture : \(pendant ? "oui" : "non"), après : \(apres ? "oui" : "non"), « Annuler » : \(annuler ? "oui" : "non")")
        verifier("Après le « + », la confirmation (« \(message)… ») et son « Annuler » doivent rester visibles une fois la feuille refermée.",
                 apres && annuler)
    }

    /// Un défaut corrigé : ce que le constat attendait devient une vraie
    /// vérification — un échec rouge, avec sa capture, s'il revient.
    @MainActor
    func verifier(_ attendu: String, _ condition: Bool) {
        guard !condition else { return }
        capturer("verification-ECHEC")
        XCTFail("\(identifiant) : \(attendu)")
    }

    override func setUp() {
        super.setUp()
        // Les vérifications lèvent ArretParcours : la suite ne court pas après un écran faux.
        continueAfterFailure = true
    }

    // MARK: Déroulé

    /// Joue un parcours : réinitialise la tour, puis écrit ses mesures quoi qu'il arrive.
    @MainActor
    func jouer(_ id: String, _ titre: String, reinitialiser: Bool = true, _ corps: () throws -> Void) {
        identifiant = id
        self.titre = titre
        if reinitialiser { Pilote.reinitialiser() }
        debut = Date()
        dernier = debut
        do {
            try corps()
        } catch is ArretParcours {
            // Déjà signalé par XCTFail, capture prise.
        } catch {
            XCTFail("\(id) : \(error)")
        }
        conclure()
    }

    /// Lance l'app. `connecte` : connexion automatique (mot de passe de démo) et
    /// aucun tutoriel par-dessus, comme pour les captures de la CI.
    @MainActor
    func lancer(connecte: Bool = true, base: String? = Banc.tour, arguments: [String] = [], ecran: String = "parcours") {
        app = XCUIApplication()
        if let base { app.launchEnvironment["REMY_BASE_URL"] = base }
        if connecte {
            app.launchEnvironment["REMY_DEMO_MDP"] = Banc.mdp
            // Écran inconnu de l'app : elle reste sur Aujourd'hui, sans tutoriel.
            app.launchEnvironment["REMY_DEMO_ECRAN"] = ecran
        }
        app.launchArguments += arguments
        app.launch()
    }

    /// Attend l'accueil connecté (la barre d'onglets, stable). Les données de démo
    /// sont neuves à chaque parcours : le jeton gardé ne vaut plus, l'app se
    /// reconnecte seule (mot de passe de démo) ; si elle n'y arrive pas, le banc
    /// tape le mot de passe — hors gestes de Sam.
    @MainActor
    func attendreAccueil(_ delai: TimeInterval = 40) throws {
        let mdp = app.secureTextFields["Mot de passe"]
        let fin = Date().addingTimeInterval(delai)
        var vuMdp: Date?
        var stable = 0
        while Date() < fin {
            if mdp.exists {
                stable = 0
                if vuMdp == nil { vuMdp = Date() }
                // La connexion automatique part 0,8 s après le lancement : on lui laisse sa chance.
                if let v = vuMdp, Date().timeIntervalSince(v) > 4, mdp.isHittable {
                    mdp.tap()
                    mdp.typeText(Banc.mdp + "\n")
                    vuMdp = nil
                }
            } else if onglet("aujourdhui").exists {
                vuMdp = nil
                stable += 1
                if stable >= 4 { break }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        try etape("accueil", attendu: [onglet("aujourdhui")], delai: 5)
    }

    /// Une étape : attend ce que l'écran doit montrer, capture, note gestes et temps.
    @MainActor
    func etape(_ nom: String, attendu: [XCUIElement] = [], absent: [XCUIElement] = [], delai: TimeInterval = 12) throws {
        var manque: [String] = []
        for e in attendu where !e.waitForExistence(timeout: delai) {
            manque.append("absent : " + self.nom(e))
        }
        for e in absent where !attendreDisparition(e, delai: delai) {
            manque.append("encore là : " + self.nom(e))
        }
        capturer(nom + (manque.isEmpty ? "" : "-ECHEC"))
        if !manque.isEmpty {
            XCTFail("\(identifiant) · \(nom) : l'écran ne montre pas ce qu'il doit.\n" + manque.joined(separator: "\n"))
            throw ArretParcours()
        }
    }

    /// Un défaut de l'app vu par le parcours : signalé comme attendu (le test reste
    /// vert) et noté dans le résumé. Ce n'est pas au parcours de corriger l'app.
    @MainActor
    func constat(_ note: String, siFaux condition: Bool) {
        guard !condition else { return }
        constats.append(note)
        capturer("constat")
        XCTExpectFailure("Constat d'ergonomie : \(note)") {
            XCTFail(note)
        }
    }

    /// Les zones tactiles de l'écran affiché, mesurées (DoD : 44 pt au moins).
    /// Un seul aller-retour (snapshot) ; seuls les boutons visibles comptent, et
    /// seulement ceux de l'app : les contrôles système (barre de navigation,
    /// segments, interrupteurs, dates, poignée de feuille) gardent leur taille Apple.
    /// `strict` : un écran déjà corrigé (plus aucune cible sous 44 pt) — une
    /// régression y devient un échec rouge, plus un constat.
    @MainActor
    func auditerCibles(_ ecran: String, strict: Bool = false) {
        guard let racine = try? app.snapshot() else { return }
        let visible = racine.frame
        var petites: [String] = []
        let systeme: [XCUIElement.ElementType] = [.navigationBar, .segmentedControl, .switch, .datePicker, .keyboard, .toolbar, .searchField]
        func parcourir(_ s: XCUIElementSnapshot) {
            if systeme.contains(s.elementType) || ["Poignée de feuille", "Sheet Grabber"].contains(s.label) { return }
            let f = s.frame
            if s.elementType == .button, f.width >= 1, f.height >= 1,
               visible.intersects(f), f.height < 43.5 || f.width < 43.5 {
                let nom = s.label.isEmpty ? (s.identifier.isEmpty ? "sans libellé" : s.identifier) : s.label
                petites.append("« \(nom.prefix(40)) » \(Int(f.width.rounded()))×\(Int(f.height.rounded()))")
            }
            s.children.forEach(parcourir)
        }
        parcourir(racine)
        print("PARCOURS|\(identifiant)|cibles \(ecran)|\(petites.count) sous 44 pt")
        let note = "Zones tactiles sous 44 pt (\(ecran)) : " + petites.prefix(10).joined(separator: " ; ")
            + (petites.count > 10 ? " … (\(petites.count) en tout)" : "")
        if strict { verifier(note, petites.isEmpty) } else { constat(note, siFaux: petites.isEmpty) }
    }

    /// Une remarque mesurée (pas un échec) : elle va dans le résumé.
    func noter(_ remarque: String) {
        constats.append("note : " + remarque)
    }

    @MainActor
    func capturer(_ nom: String) {
        numero += 1
        let maintenant = Date()
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        let propre = nom.replacingOccurrences(of: " ", with: "-")
        a.name = "\(identifiant)-\(String(format: "%02d", numero))-\(propre)"
        a.lifetime = .keepAlways
        add(a)
        etapes.append([
            "etape": propre,
            "numero": numero,
            "gestes": gestesEtape,
            "gestesCumules": gestes,
            "secondes": (maintenant.timeIntervalSince(dernier) * 10).rounded() / 10,
            "secondesCumulees": (maintenant.timeIntervalSince(debut) * 10).rounded() / 10,
        ])
        print("PARCOURS|\(identifiant)|\(propre)|gestes \(gestes)|\(String(format: "%.1f", maintenant.timeIntervalSince(debut))) s")
        gestesEtape = 0
        dernier = maintenant
    }

    @MainActor
    private func conclure() {
        let ok = testRun?.hasSucceeded ?? true
        let mesures: [String: Any] = [
            "id": identifiant,
            "titre": titre,
            "test": name,
            "reussi": ok,
            "gestes": gestes,
            "secondes": (Date().timeIntervalSince(debut) * 10).rounded() / 10,
            "etapes": etapes,
            "constats": constats,
        ]
        if let json = try? JSONSerialization.data(withJSONObject: mesures, options: [.prettyPrinted, .sortedKeys]) {
            let a = XCTAttachment(data: json, uniformTypeIdentifier: "public.json")
            a.name = "\(identifiant)-mesures"
            a.lifetime = .keepAlways
            add(a)
        }
        print("PARCOURS|\(identifiant)|FIN|\(ok ? "réussi" : "échec")|gestes \(gestes)|\(String(format: "%.1f", Date().timeIntervalSince(debut))) s|constats \(constats.count)")
    }

    // MARK: Gestes (comptés)

    @MainActor
    func toucher(_ e: XCUIElement, delai: TimeInterval = 10, _ quoi: String = "") throws {
        guard e.waitForExistence(timeout: delai) else {
            capturer("introuvable-" + (quoi.isEmpty ? "element" : quoi))
            XCTFail("\(identifiant) : introuvable \(quoi) \(e.description)")
            throw ArretParcours()
        }
        if !e.isHittable { _ = attendreTouchable(e, delai: 3) }
        // Désactivé le temps d'une réponse (Rémy écrit encore) : patienter un peu.
        let finActif = Date().addingTimeInterval(8)
        while !e.isEnabled && Date() < finActif { RunLoop.current.run(until: Date().addingTimeInterval(0.25)) }
        compter()
        // Hors de l'écran (bas d'une liste, sous le clavier) : XCUITest fait
        // défiler jusqu'à lui, comme Sam ; jamais de toucher au jugé.
        e.tap()
    }

    @MainActor
    func appuiLong(_ e: XCUIElement, duree: TimeInterval = 0.8) throws {
        guard e.waitForExistence(timeout: 10) else {
            XCTFail("\(identifiant) : introuvable pour l'appui long \(e.description)")
            throw ArretParcours()
        }
        compter()
        e.press(forDuration: duree)
    }

    /// Une saisie compte pour un geste (le toucher du champ en est un autre).
    @MainActor
    func saisir(_ texte: String, dans e: XCUIElement) throws {
        guard e.waitForExistence(timeout: 10) else {
            XCTFail("\(identifiant) : champ introuvable \(e.description)")
            throw ArretParcours()
        }
        compter()
        e.typeText(texte)
    }

    @MainActor
    func balayerVersLeHaut(_ e: XCUIElement? = nil) {
        compter()
        (e ?? (app as XCUIElement)).swipeUp()
    }

    @MainActor
    func balayerVersLeBas(_ e: XCUIElement? = nil) {
        compter()
        (e ?? (app as XCUIElement)).swipeDown()
    }

    /// Tirer l'écran vers le bas, franchement, pour rafraîchir.
    @MainActor
    func tirerPourRafraichir() {
        compter()
        let haut = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28))
        haut.press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)))
    }

    func compter() {
        gestes += 1
        gestesEtape += 1
    }

    /// Fait défiler d'un tiers d'écran, sans élan, jusqu'à ce que l'élément soit
    /// touchable (au plus `essais` gestes). Un toucher pendant que l'écran glisse
    /// encore ne fait que l'arrêter : vu le 25/10 sur « Terminer », passé sous les
    /// cartes du matin, que le défilement automatique de XCUITest ratait.
    @MainActor
    func amenerDoucement(_ e: XCUIElement, essais: Int = 5) {
        var n = 0
        while n < essais && e.exists && !e.isHittable {
            compter()
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.42)),
                       withVelocity: .slow, thenHoldForDuration: 0.3)
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
            n += 1
        }
    }

    /// Fait défiler jusqu'à ce que l'élément soit touchable (au plus `essais` balayages).
    @MainActor
    func amener(_ e: XCUIElement, dans conteneur: XCUIElement? = nil, essais: Int = 6) {
        var n = 0
        while n < essais && !(e.exists && e.isHittable) {
            balayerVersLeHaut(conteneur)
            n += 1
        }
    }

    // MARK: Requêtes

    @MainActor
    func onglet(_ n: String) -> XCUIElement { nomme(app.buttons["onglet.\(n)"], "onglet \(n)") }

    /// Un bouton par son libellé exact, ou terminé par lui (« Coche, Terminer »),
    /// ou suivi d'une pastille (« Conversations, 1 »).
    @MainActor
    func bouton(_ libelle: String) -> XCUIElement {
        // « Conversations, 1 » : le libellé porte parfois une pastille.
        nomme(app.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@ OR label ENDSWITH %@ OR label BEGINSWITH %@",
                                               libelle, libelle, ", " + libelle, libelle + ", ")).firstMatch, "bouton « \(libelle) »")
    }

    /// Un bouton dont le libellé contient ce texte.
    @MainActor
    func boutonContenant(_ texte: String) -> XCUIElement {
        nomme(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", texte)).firstMatch, "bouton contenant « \(texte) »")
    }

    /// N'importe quel élément dont le libellé contient ce texte.
    @MainActor
    func texte(_ t: String) -> XCUIElement {
        nomme(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", t)).firstMatch, "texte « \(t) »")
    }

    /// Sans tenir compte de la casse (les titres de section sont en capitales).
    @MainActor
    func texteI(_ t: String) -> XCUIElement {
        nomme(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", t)).firstMatch, "texte « \(t) » (casse ignorée)")
    }

    @MainActor
    func ident(_ id: String) -> XCUIElement {
        nomme(app.descendants(matching: .any).matching(identifier: id).firstMatch, "identifiant \(id)")
    }

    @MainActor
    func attendreDisparition(_ e: XCUIElement, delai: TimeInterval) -> Bool {
        let fin = Date().addingTimeInterval(delai)
        while e.exists && Date() < fin { RunLoop.current.run(until: Date().addingTimeInterval(0.25)) }
        return !e.exists
    }

    @MainActor
    func attendreTouchable(_ e: XCUIElement, delai: TimeInterval) -> Bool {
        let fin = Date().addingTimeInterval(delai)
        while !(e.exists && e.isHittable) && Date() < fin { RunLoop.current.run(until: Date().addingTimeInterval(0.25)) }
        return e.exists && e.isHittable
    }

    /// Les alertes système (notifications…) : accepter si elles apparaissent.
    /// `tantQue` : on cesse d'attendre dès que l'écran a continué sans elle
    /// (autorisation déjà donnée), pour ne pas laisser filer la confirmation.
    @MainActor
    func accepterAlerteSysteme(_ delai: TimeInterval = 3, tantQue encore: (() -> Bool)? = nil) {
        let tremplin = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let fin = Date().addingTimeInterval(delai)
        repeat {
            for libelle in ["Allow", "Autoriser", "OK"] {
                let b = tremplin.buttons[libelle]
                if b.exists {
                    compter()
                    b.tap()
                    return
                }
            }
            if let encore, !encore() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < fin
    }

    /// Le clavier, s'il couvre l'écran.
    @MainActor
    var clavier: XCUIElement { app.keyboards.firstMatch }
}
