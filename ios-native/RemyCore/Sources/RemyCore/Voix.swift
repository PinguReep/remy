import Foundation
import Observation

// La voix dans l'app : dicter dans le composeur, et le mode appel (« speech to
// speech »). Le cœur ne connaît ni AVFoundation ni le micro : l'app branche
// ses implémentations (Remy/Voix), les tests des faux. Toute la logique —
// états, détection de fin de parole, enchaînement des tours — vit ici, testée.
//
// Vie privée : l'audio ne quitte l'iPhone que vers la tour (Dictée Locale),
// n'est jamais conservé ; la voix de Rémy est celle de l'appareil.

/// Un enregistrement terminé (AAC dans un conteneur m4a).
public struct Enregistrement: Sendable, Equatable {
    public var audio: Data
    public var duree: Double

    public init(audio: Data, duree: Double) {
        self.audio = audio
        self.duree = duree
    }
}

/// Une erreur de micro, déjà dite comme Sam doit la lire.
public struct ErreurMicro: Error, LocalizedError, Equatable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// Le micro de l'iPhone, vu du cœur.
@MainActor
public protocol Micro: AnyObject {
    /// Demande l'accès (une fois) et commence à enregistrer.
    func demarrer() async throws
    /// Arrête et rend l'enregistrement — effacé du disque aussitôt lu.
    func arreter() -> Enregistrement?
    /// Arrête et jette l'enregistrement.
    func jeter()
    /// Le volume instantané, en décibels (−160 : silence … 0 : maximum).
    func niveau() -> Float
    /// Rend l'audio aux autres apps (fin de dictée, fin d'appel).
    func liberer()
}

/// La voix de Rémy (synthèse de l'appareil, en français).
@MainActor
public protocol Voix: AnyObject {
    /// Lit le texte ; rend la main quand c'est fini, ou coupé par `taire()`.
    func dire(_ texte: String) async
    func taire()
}

// MARK: - Dictée

@MainActor
@Observable
public final class DicteeModel {
    public enum Etat: Equatable, Sendable {
        case repos
        case enregistrement(debut: Date)
        case transcription
    }

    public private(set) var etat: Etat = .repos
    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI
    /// Branché par l'app (AVAudioRecorder) ; nil dans un environnement sans micro.
    @ObservationIgnored public var micro: Micro?
    /// Le serveur refuse au-delà de 4 Mo : à ~3 minutes, la dictée s'arrête et
    /// part d'elle-même.
    @ObservationIgnored public var dureeMax: Double = 180
    @ObservationIgnored private var prise = 0
    /// Où va le texte dicté (le « + ») ; nil : le composeur de Rémy.
    @ObservationIgnored public var destination: ((String) -> Void)?

    public init(api: ClientAPI) { self.api = api }

    public var enregistre: Bool {
        if case .enregistrement = etat { return true }
        return false
    }

    /// La tour dit qu'aucun moteur de transcription n'est branché : inutile
    /// d'enregistrer pour rien, on le dit avant.
    static func sansTranscription(_ app: AppModel?) -> String? {
        app?.tableau.donnees?.systeme?.transcription == false
            ? "La dictée n'est pas branchée sur la tour : rien ne peut transcrire ta voix pour l'instant."
            : nil
    }

    public func commencer() async {
        guard etat == .repos else { return }
        guard let micro else {
            app?.dire("Pas de micro disponible sur cet appareil.")
            return
        }
        if app?.appel.actif == true { return }
        if let m = Self.sansTranscription(app) {
            app?.dire(m)
            return
        }
        do {
            try await micro.demarrer()
        } catch {
            app?.dire((error as? LocalizedError)?.errorDescription ?? "Micro indisponible — réessaie.")
            return
        }
        prise += 1
        let p = prise
        etat = .enregistrement(debut: Date())
        // Garde-fou : passé le plafond, la dictée part toute seule.
        let plafond = dureeMax
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(plafond * 1_000_000_000))
            guard let self, self.prise == p, self.enregistre else { return }
            await self.valider()
        }
    }

    /// ✕ : rien n'est envoyé, rien n'est gardé.
    public func annuler(sansMessage: Bool = false) {
        guard enregistre else { return }
        micro?.jeter()
        micro?.liberer()
        etat = .repos
        if !sansMessage { app?.dire("Vocal annulé : rien n'est parti.") }
    }

    /// ✓ : arrête, transcrit sur la tour, et AJOUTE le texte au composeur —
    /// jamais envoyé seul, Sam relit d'abord.
    public func valider() async {
        guard enregistre, let micro else { return }
        let e = micro.arreter()
        micro.liberer()
        guard let e else {
            etat = .repos
            app?.dire("Enregistrement illisible — réessaie.")
            return
        }
        guard e.duree >= 0.5, e.audio.count >= 1000 else {
            etat = .repos
            app?.dire("Trop court : rien n'est parti.")
            return
        }
        etat = .transcription
        defer { etat = .repos }
        do {
            let finDictee = Mesures.partagees.chrono("app.dictee")
            let texte = try await api.transcrire(audio: e.audio, duree: e.duree)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            finDictee()
            guard !texte.isEmpty else {
                app?.dire("Je n'ai rien entendu — réessaie plus près du micro.")
                return
            }
            if let destination { destination(texte) } else { app?.chat.ajouterDictee(texte) }
        } catch {
            if let x = error as? ErreurAPI, x == .nonConnecte { app?.signaler(x); return }
            app?.dire((error as? LocalizedError)?.errorDescription ?? "Transcription impossible — réessaie.")
        }
    }
}

// MARK: - Fin de parole

/// Décide, au volume du micro, quand Sam a fini de parler : un silence de
/// ~1,7 s après de la voix. Le bruit de fond est mesuré au début de chaque
/// écoute (cuisine, rue, voiture : le seuil suit).
public struct DetecteurParole: Sendable {
    /// Le silence qui clôt une phrase (Sam l'a voulu entre 1,5 et 2 s).
    public var silenceFin: Double = 1.7
    /// Durée de mesure du bruit de fond, au début de l'écoute.
    public var calibrage: Double = 0.4
    /// Écart au-dessus du bruit de fond pour compter comme de la voix (dB).
    public var marge: Float = 12
    /// Jamais de la voix en dessous de ce volume (dB).
    public var seuilMin: Float = -50
    /// Un fond plus fort que ça, c'est que Sam parlait déjà : on le plafonne.
    public var fondMax: Float = -35
    /// Rien dit pendant ce temps : l'écoute repart à neuf (fichier vidé).
    public var attenteMax: Double = 30
    /// Plafond d'une prise de parole.
    public var paroleMax: Double = 90

    public enum Verdict: Equatable, Sendable { case continuer, finDeParole, rienEntendu }

    private var mesures: [Float] = []
    private var fond: Float?
    public private(set) var parole = false
    private var derniereVoix: Double = 0
    private var debutParole: Double = 0

    public init() {}

    public var seuil: Float { max(min(fond ?? -60, fondMax) + marge, seuilMin) }

    /// `db` : le volume mesuré ; `t` : secondes depuis le début de l'écoute.
    public mutating func analyser(_ db: Float, a t: Double) -> Verdict {
        if fond == nil {
            if t < calibrage {
                mesures.append(db)
                return .continuer
            }
            fond = mesures.isEmpty ? -60 : mesures.reduce(0, +) / Float(mesures.count)
        }
        if db > seuil {
            if !parole {
                parole = true
                debutParole = t
            }
            derniereVoix = t
        }
        if parole {
            if t - derniereVoix >= silenceFin || t - debutParole >= paroleMax { return .finDeParole }
        } else if t >= attenteMax {
            return .rienEntendu
        }
        return .continuer
    }

    /// Le volume ramené entre 0 et 1, pour l'animation.
    public static func normaliser(_ db: Float) -> Float {
        max(0, min(1, (db + 55) / 45))
    }
}

/// Ce que la voix de Rémy lit : sans markdown, sans lien, sans marqueur.
public enum Parole {
    public static func pourVoix(_ texte: String) -> String {
        var t = Marqueurs.retirer(texte)
        t = remplacer(t, #"\*\(interrompu\)\*"#, "")
        t = remplacer(t, #"```[\s\S]*?```"#, " (code) ")
        t = remplacer(t, #"\[([^\]]+)\]\((https?://[^)\s]+)\)"#, "$1")
        t = remplacer(t, #"https?://\S+"#, "(lien)")
        t = remplacer(t, #"[*_#>`~]"#, "")
        t = remplacer(t, #"\s+"#, " ")
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func remplacer(_ t: String, _ motif: String, _ par: String) -> String {
        guard let re = try? NSRegularExpression(pattern: motif) else { return t }
        return re.stringByReplacingMatches(in: t, range: NSRange(t.startIndex..., in: t), withTemplate: par)
    }
}

// MARK: - Mode appel

/// Parler à Rémy comme au téléphone : j'écoute → fin de parole (silence, ou
/// « J'ai fini ») → transcription sur la tour → message avec `call: true`
/// (réponse courte, sans markdown) → Rémy le dit à voix haute → j'écoute.
/// Le micro est COUPÉ pendant que Rémy parle : sinon il s'entendrait.
@MainActor
@Observable
public final class AppelModel {
    public enum Etat: Equatable, Sendable {
        case arrete
        case ecoute
        case transcription
        case reflexion
        case parole
        case erreur(String)
    }

    public private(set) var etat: Etat = .arrete
    /// Ce que Rémy a compris de la dernière phrase de Sam.
    public private(set) var entendu = ""
    /// La dernière réponse de Rémy (texte affiché pendant qu'il la dit).
    public private(set) var reponse = ""
    /// Sam parle en ce moment (au-dessus du seuil depuis le début de l'écoute).
    public private(set) var parleDeja = false
    /// Volume du micro entre 0 et 1, pour l'animation.
    public private(set) var niveau: Float = 0

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let api: ClientAPI
    @ObservationIgnored public var micro: Micro?
    @ObservationIgnored public var voix: Voix?
    /// Le réglage de la détection de fin de parole.
    @ObservationIgnored public var detecteur = DetecteurParole()
    /// Intervalle entre deux mesures du micro.
    @ObservationIgnored public var pasEcoute: UInt64 = 100_000_000
    @ObservationIgnored private var session = 0
    @ObservationIgnored private var finDemandee = false

    public init(api: ClientAPI) { self.api = api }

    public var actif: Bool { etat != .arrete }

    /// Ouvre l'appel. Refusé (et dit) si Rémy écrit déjà une réponse.
    public func decrocher() {
        guard etat == .arrete else { return }
        if app?.chat.envoi == true {
            app?.dire("Rémy finit sa réponse, réessaie dans un instant.")
            return
        }
        if app?.chat.lectureSeule == true {
            app?.dire("Conversation importée : touche « Continuer avec Rémy » pour lui en parler.")
            return
        }
        if let m = DicteeModel.sansTranscription(app) {
            app?.dire(m)
            return
        }
        app?.dictee.annuler(sansMessage: true)
        entendu = ""
        reponse = ""
        lancer()
    }

    /// Raccroche : micro coupé, voix coupée. Une réponse en cours d'écriture
    /// continue sur la tour et restera dans la conversation.
    public func raccrocher() {
        session += 1
        micro?.jeter()
        micro?.liberer()
        voix?.taire()
        etat = .arrete
        parleDeja = false
        niveau = 0
    }

    /// Le grand bouton : « J'ai fini » pendant l'écoute, « Laisse-moi parler »
    /// pendant que Rémy parle (il se tait, et l'écoute reprend).
    public func toucher() {
        switch etat {
        case .ecoute: finDemandee = true
        case .parole: voix?.taire()
        default: break
        }
    }

    /// Après une erreur : on repart à l'écoute.
    public func reessayer() {
        guard case .erreur = etat else { return }
        lancer()
    }

    private func lancer() {
        session += 1
        let s = session
        Task { [weak self] in await self?.boucle(s) }
    }

    private func enCours(_ s: Int) -> Bool { session == s }

    private func boucle(_ s: Int) async {
        while enCours(s) {
            guard let micro else {
                etat = .erreur("Pas de micro disponible sur cet appareil.")
                return
            }
            // 1. J'écoute.
            etat = .ecoute
            parleDeja = false
            finDemandee = false
            do {
                try await micro.demarrer()
            } catch {
                guard enCours(s) else { return }
                etat = .erreur((error as? LocalizedError)?.errorDescription ?? "Micro indisponible.")
                return
            }
            guard enCours(s) else { micro.jeter(); return }
            var d = detecteur
            var verdict = DetecteurParole.Verdict.continuer
            let debut = Date()
            while verdict == .continuer {
                try? await Task.sleep(nanoseconds: pasEcoute)
                guard enCours(s) else { return } // raccroché : le micro est déjà jeté
                let db = micro.niveau()
                niveau = DetecteurParole.normaliser(db)
                verdict = d.analyser(db, a: Date().timeIntervalSince(debut))
                parleDeja = d.parole
                if finDemandee { verdict = .finDeParole }
            }
            niveau = 0
            if verdict == .rienEntendu {
                micro.jeter()
                continue
            }
            // 2. Je transcris.
            guard let e = micro.arreter(), e.duree >= 0.5, e.audio.count >= 1000 else { continue }
            etat = .transcription
            let texte: String
            do {
                texte = try await api.transcrire(audio: e.audio, duree: e.duree)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            } catch {
                guard enCours(s) else { return }
                if let x = error as? ErreurAPI, x == .nonConnecte {
                    raccrocher()
                    app?.signaler(x)
                    return
                }
                etat = .erreur((error as? LocalizedError)?.errorDescription ?? "Transcription impossible.")
                return
            }
            guard enCours(s) else { return }
            if texte.isEmpty { continue }
            entendu = texte
            // 3. Je réfléchis (la réponse s'écrit aussi dans la conversation).
            etat = .reflexion
            reponse = ""
            guard let chat = app?.chat else { return }
            let r = await chat.envoyer(texte, appel: true)
            guard enCours(s) else { return }
            guard let r, !r.isEmpty else {
                etat = .erreur(chat.lignes.last?.erreur ?? "Rémy n'a pas pu répondre — réessaie.")
                return
            }
            reponse = r
            // 4. Je parle — micro coupé.
            etat = .parole
            await voix?.dire(Parole.pourVoix(r))
        }
    }
}
