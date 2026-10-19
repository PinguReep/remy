import AVFoundation
import UIKit
import RemyCore

/// Le micro de l'iPhone : AAC mono dans un m4a temporaire, lu puis effacé
/// aussitôt — l'audio n'est jamais conservé, ni ici ni sur la tour.
@MainActor
final class MicroiPhone: NSObject, Micro {
    private var enregistreur: AVAudioRecorder?
    private var fichier: URL?

    func demarrer() async throws {
        guard await Self.permission() else {
            throw ErreurMicro("Micro refusé — autorise-le dans Réglages › Rémy › Micro.")
        }
        jeter()
        let session = AVAudioSession.sharedInstance()
        do {
            // Lecture ET enregistrement : la voix de Rémy sort par le haut-parleur
            // (pas par l'écouteur) ou les écouteurs Bluetooth, sur la même
            // session que le micro.
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP])
            try session.setActive(true)
        } catch {
            throw ErreurMicro("Le micro est occupé par une autre app — réessaie.")
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("remy-\(UUID().uuidString).m4a")
        let reglages: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            let r = try AVAudioRecorder(url: url, settings: reglages)
            r.isMeteringEnabled = true
            guard r.record() else { throw ErreurMicro("Enregistrement impossible — réessaie.") }
            enregistreur = r
            fichier = url
        } catch {
            try? FileManager.default.removeItem(at: url)
            throw (error as? ErreurMicro) ?? ErreurMicro("Enregistrement impossible — réessaie.")
        }
    }

    func arreter() -> Enregistrement? {
        guard let r = enregistreur, let url = fichier else { return nil }
        let duree = r.currentTime
        r.stop()
        enregistreur = nil
        fichier = nil
        defer { try? FileManager.default.removeItem(at: url) }
        guard let audio = try? Data(contentsOf: url) else { return nil }
        return Enregistrement(audio: audio, duree: duree)
    }

    func jeter() {
        enregistreur?.stop()
        enregistreur = nil
        if let url = fichier { try? FileManager.default.removeItem(at: url) }
        fichier = nil
    }

    func niveau() -> Float {
        guard let r = enregistreur else { return -160 }
        r.updateMeters()
        return r.averagePower(forChannel: 0)
    }

    func liberer() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private static func permission() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return true
        case .denied: return false
        default:
            return await withCheckedContinuation { suite in
                AVAudioApplication.requestRecordPermission { ok in suite.resume(returning: ok) }
            }
        }
    }
}

/// La voix de Rémy : la synthèse de l'iPhone, en français, la plus belle voix
/// installée. Rien ne sort de l'appareil.
@MainActor
final class VoixiPhone: NSObject, Voix, AVSpeechSynthesizerDelegate {
    private let synthese = AVSpeechSynthesizer()
    private var attente: CheckedContinuation<Void, Never>?
    private var courante: ObjectIdentifier?

    override init() {
        super.init()
        synthese.delegate = self
    }

    func dire(_ texte: String) async {
        taire()
        guard !texte.isEmpty else { return }
        let u = AVSpeechUtterance(string: texte)
        u.voice = Self.voixFrancaise()
        u.rate = AVSpeechUtteranceDefaultSpeechRate
        courante = ObjectIdentifier(u)
        await withCheckedContinuation { (suite: CheckedContinuation<Void, Never>) in
            attente = suite
            synthese.speak(u)
        }
    }

    func taire() {
        courante = nil
        if synthese.isSpeaking { synthese.stopSpeaking(at: .immediate) }
        reprendre()
    }

    private func reprendre() {
        let a = attente
        attente = nil
        a?.resume()
    }

    private func fini(_ id: ObjectIdentifier) {
        guard courante == id else { return }
        courante = nil
        reprendre()
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in self.fini(id) }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in self.fini(id) }
    }

    private static func voixFrancaise() -> AVSpeechSynthesisVoice? {
        let fr = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == "fr-FR" }
        return fr.max { $0.quality.rawValue < $1.quality.rawValue } ?? AVSpeechSynthesisVoice(language: "fr-FR")
    }
}
