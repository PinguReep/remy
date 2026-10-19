import SwiftUI
import RemyCore

/// « Temps de réponse » (Réglages) : ce que chaque étape prend vraiment, sur
/// l'iPhone et sur la tour (retours TestFlight 13 : diagnostiquer avant de
/// masquer). Médiane et 95e centile ; rien n'est inventé, une série vide le dit.
struct MesuresView: View {
    @Environment(AppModel.self) private var app
    @State private var tour: MesuresTour?
    @State private var erreur: String?
    @State private var chargement = false

    private static let iphone: [(String, String)] = [
        ("app.affichage", "Ouverture → journée à l'écran (copie de l'iPhone)"),
        ("app.journee", "Charger la journée (iPhone → tour → iPhone)"),
        ("app.geste", "Geste → confirmé par la tour"),
        ("app.conseil", "Conseil de Rémy (iPhone → tour)"),
        ("app.dictee", "Dictée (envoi → texte)"),
    ]
    private static let serveur: [(String, String)] = [
        ("dashboard", "Préparer la journée"),
        ("motion.liste", "Lire toutes les tâches Motion"),
        ("motion.lecture", "Une requête de lecture Motion"),
        ("motion.attente_quota", "Attente du quota Motion (12/min)"),
        ("motion.ecriture", "Écrire dans Motion (geste complet)"),
        ("google.jour", "Lire l'agenda Google du jour"),
        ("glm.premier_jeton", "GLM : premier mot d'une réponse"),
        ("glm.complete", "GLM : réponse courte complète"),
        ("conseil.glm", "Conseil réfléchi par GLM"),
        ("dictee", "Dictée locale (transcription)"),
        ("capture", "Classer une capture"),
    ]

    var body: some View {
        let local = Mesures.partagees.resume()
        List {
            Section {
                ForEach(Self.iphone, id: \.0) { cle, titre in ligne(titre, local[cle].map(Serie.init)) }
            } header: {
                Text("Sur l'iPhone")
            } footer: {
                Text("Depuis l'ouverture de l'app. Médiane : la moitié des fois plus rapide ; 95 % : presque toujours sous cette durée.")
            }
            Section("Sur la tour") {
                if app.serveur?.sait("mesures-v1") != true {
                    Text("Les mesures de la tour arriveront avec sa mise à jour.").foregroundStyle(Palette.encre2)
                } else if let tour {
                    ForEach(Self.serveur, id: \.0) { cle, titre in ligne(titre, tour.mesures[cle].map(Serie.init)) }
                } else if let erreur {
                    Text(erreur).foregroundStyle(Palette.danger)
                } else {
                    ProgressView()
                }
            }
            if let m = tour?.motion, m.etat != "off" {
                Section("Motion") {
                    if let q = m.quota {
                        LabeledContent("Quota cette minute", value: "\(q.utilise) / \(q.max) requêtes")
                    }
                    if let lu = m.luA {
                        LabeledContent("Tâches lues", value: Format.depuis(lu.date).replacingOccurrences(of: "de ", with: "à "))
                    }
                    LabeledContent("État", value: Self.etat(m.etat))
                    if let r = m.raison { Text(r).font(Police.texte(13)).foregroundStyle(Palette.encre2) }
                }
            }
        }
        .font(Police.texte(15))
        .navigationTitle("Temps de réponse")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await charger() }
        .task { await charger() }
    }

    private struct Serie {
        let n: Int, p50: Int, p95: Int
        init(_ r: Mesures.Resume) { n = r.n; p50 = r.p50; p95 = r.p95 }
        init(_ s: MesuresTour.Serie) { n = s.n; p50 = s.p50 ?? 0; p95 = s.p95 ?? 0 }
    }

    private func ligne(_ titre: String, _ s: Serie?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(titre).foregroundStyle(Palette.encre)
            Text(s.map { "médiane \(Self.duree($0.p50)) · 95 % sous \(Self.duree($0.p95)) · \($0.n) mesure\($0.n > 1 ? "s" : "")" }
                 ?? "pas encore mesuré")
                .font(Police.mono(12))
                .foregroundStyle(s == nil ? Palette.encre3 : Palette.encre2)
        }
        .padding(.vertical, 2)
    }

    static func duree(_ ms: Int) -> String {
        ms < 1000 ? "\(ms) ms" : String(format: "%.1f s", Double(ms) / 1000).replacingOccurrences(of: ".", with: ",")
    }

    static func etat(_ e: String) -> String {
        switch e {
        case "ok": return "à jour"
        case "maj": return "mise à jour en cours"
        case "quota": return "Motion limite les requêtes"
        case "menage": return "quota gardé pour tes gestes"
        case "panne": return "Motion ne répond pas"
        case "reseau": return "la tour ne joint pas Motion"
        case "auth": return "clé Motion refusée"
        case "attente": return "première lecture"
        default: return e
        }
    }

    private func charger() async {
        guard app.serveur?.sait("mesures-v1") == true, !chargement else { return }
        chargement = true
        defer { chargement = false }
        do {
            tour = try await app.api.mesures()
            erreur = nil
        } catch {
            erreur = (error as? LocalizedError)?.errorDescription ?? "Mesures de la tour illisibles."
        }
    }
}
