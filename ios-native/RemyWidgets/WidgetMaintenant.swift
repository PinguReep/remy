import WidgetKit
import SwiftUI
import RemyCore

// Le widget « Maintenant » (24/10) : la tâche en cours ou la suivante, lue sur
// la tour avec l'adresse et le jeton du trousseau partagé (lecture seule).
// Une lecture prépare une entrée par borne (débuts et fins des prochaines
// heures) : le widget change de tâche à l'heure sans réseau, et relit la tour
// toutes les ~15 min. Tour injoignable : la dernière journée lue, datée.

struct EntreeMaintenant: TimelineEntry {
    let date: Date
    let apercu: ApercuMaintenant
}

/// La dernière journée lue par le widget, gardée dans SON conteneur (pas de
/// groupe d'app) : seulement pour l'afficher hors ligne, datée.
enum CopieWidget {
    private static let cle = "widget.maintenant.journee"
    private static let cleDate = "widget.maintenant.le"

    static func garder(_ j: Journee, le: Date) {
        guard let d = try? JSONEncoder().encode(j) else { return }
        UserDefaults.standard.set(d, forKey: cle)
        UserDefaults.standard.set(le.timeIntervalSince1970, forKey: cleDate)
    }

    static func lire() -> (Journee, Date)? {
        guard let d = UserDefaults.standard.data(forKey: cle),
              let j = try? JSONDecoder().decode(Journee.self, from: d) else { return nil }
        let t = UserDefaults.standard.double(forKey: cleDate)
        return (j, Date(timeIntervalSince1970: t))
    }

    static func effacer() {
        UserDefaults.standard.removeObject(forKey: cle)
        UserDefaults.standard.removeObject(forKey: cleDate)
    }
}

struct FournisseurMaintenant: TimelineProvider {
    func placeholder(in context: Context) -> EntreeMaintenant {
        EntreeMaintenant(date: Date(), apercu: Self.exemple)
    }

    func getSnapshot(in context: Context, completion: @escaping (EntreeMaintenant) -> Void) {
        if context.isPreview {
            completion(EntreeMaintenant(date: Date(), apercu: Self.exemple))
            return
        }
        Task {
            let (journee, copie, probleme) = await Self.lire()
            let maintenant = Date()
            completion(EntreeMaintenant(date: maintenant, apercu: probleme ?? ApercuMaintenant.pour(journee, maintenant: maintenant, copieDu: copie)))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<EntreeMaintenant>) -> Void) {
        Task {
            let (journee, copie, probleme) = await Self.lire()
            let maintenant = Date()
            let relire = maintenant.addingTimeInterval(15 * 60)
            if let probleme {
                completion(Timeline(entries: [EntreeMaintenant(date: maintenant, apercu: probleme)], policy: .after(relire)))
                return
            }
            let bornes = ApercuMaintenant.bornes(journee, depuis: maintenant, jusqua: maintenant.addingTimeInterval(6 * 3600))
            let entrees = ([maintenant] + bornes).map {
                EntreeMaintenant(date: $0, apercu: ApercuMaintenant.pour(journee, maintenant: $0, copieDu: copie))
            }
            completion(Timeline(entries: entrees, policy: .after(relire)))
        }
    }

    /// La journée (fraîche, ou la copie et son heure), ou l'aperçu d'un
    /// problème sans journée de secours (pas connecté, tour injoignable).
    static func lire() async -> (Journee?, Date?, ApercuMaintenant?) {
        let client: ClientAPI
        do {
            client = try TrousseauPartage.systeme.client()
        } catch {
            CopieWidget.effacer()
            return (nil, nil, ApercuMaintenant(genre: .nonConnecte))
        }
        do {
            let d = try await client.tableauDeBord()
            if let j = d.journee { CopieWidget.garder(j, le: Date()) }
            return (d.journee, nil, d.journee == nil ? ApercuMaintenant(genre: .injoignable) : nil)
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte {
                CopieWidget.effacer()
                return (nil, nil, ApercuMaintenant(genre: .nonConnecte))
            }
            if let copie = CopieWidget.lire() { return (copie.0, copie.1, nil) }
            return (nil, nil, ApercuMaintenant(genre: .injoignable))
        }
    }

    static let exemple = ApercuMaintenant(genre: .enCours, titre: "Préparer le dossier", projet: "Site",
                                          debut: Date().addingTimeInterval(-20 * 60), fin: Date().addingTimeInterval(40 * 60),
                                          ensuite: ("Appeler le garage", Date().addingTimeInterval(60 * 60)))
}

struct WidgetMaintenant: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "remy.maintenant", provider: FournisseurMaintenant()) { entree in
            VueMaintenant(entree: entree)
        }
        .configurationDisplayName("Maintenant")
        .description("Ta tâche en cours, ou la suivante, avec l'heure.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

struct VueMaintenant: View {
    @Environment(\.widgetFamily) private var famille
    let entree: EntreeMaintenant

    private var a: ApercuMaintenant { entree.apercu }

    var body: some View {
        Group {
            if famille == .accessoryRectangular {
                rectangulaire
            } else {
                accueil
            }
        }
        .widgetURL(LienRemy.onglet(.aujourdhui).url)
        .containerBackground(for: .widget) { Teinte.fond }
    }

    // MARK: Écran verrouillé

    @ViewBuilder
    private var rectangulaire: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(etiquette.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .widgetAccentable()
            Text(titre)
                .font(.system(size: 15, weight: .semibold))
                .lineLimit(1)
            ligneHeure
                .font(.system(size: 13))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: Écran d'accueil

    @ViewBuilder
    private var accueil: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(etiquette.uppercased())
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1)
                    .foregroundStyle(a.genre == .enCours ? Teinte.signal : Teinte.encre2)
                Spacer(minLength: 0)
                if let c = a.copieDu {
                    Text("hors ligne · \(Format.heure(c))")
                        .font(.system(size: 10))
                        .foregroundStyle(Teinte.encre2)
                        .lineLimit(1)
                }
            }
            Text(titre)
                .font(.system(size: famille == .systemSmall ? 16 : 18, weight: .bold, design: .serif))
                .foregroundStyle(Teinte.encre)
                .lineLimit(famille == .systemSmall ? 3 : 2)
                .minimumScaleFactor(0.85)
            Spacer(minLength: 2)
            if a.genre == .enCours, let debut = a.debut, let fin = a.fin, fin > debut {
                Text(timerInterval: debut...fin, countsDown: true)
                    .font(.system(size: famille == .systemSmall ? 26 : 30, weight: .semibold).monospacedDigit())
                    .foregroundStyle(Teinte.encre)
                ProgressView(timerInterval: debut...fin, countsDown: false, label: { EmptyView() }, currentValueLabel: { EmptyView() })
                    .tint(Teinte.signal)
                Text("jusqu'à \(Format.heure(fin))")
                    .font(.system(size: 12))
                    .foregroundStyle(Teinte.encre2)
            } else {
                ligneHeure
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Teinte.encre2)
                    .lineLimit(2)
            }
            if famille == .systemMedium, let s = a.ensuite {
                Text("Ensuite · \(Format.heure(s.debut)) · \(s.titre)")
                    .font(.system(size: 12))
                    .foregroundStyle(Teinte.encre2)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .combine)
    }

    // MARK: Textes

    private var etiquette: String {
        switch a.genre {
        case .enCours: return a.rendezVous ? "En ce moment" : "En cours"
        case .suivant: return "À venir"
        case .aFaire: return "À faire aujourd'hui"
        case .libre: return "Temps libre"
        case .aucuneSource, .enPanne: return "Ta journée"
        case .nonConnecte: return "Rémy"
        case .injoignable: return "Hors ligne"
        }
    }

    private var titre: String {
        switch a.genre {
        case .enCours, .suivant, .aFaire: return a.titre ?? "—"
        case .libre: return "Plus rien de prévu"
        case .aucuneSource: return "Rien de branché"
        case .enPanne: return "Motion ne répond pas"
        case .nonConnecte: return "Pas connecté"
        case .injoignable: return "Tour injoignable"
        }
    }

    @ViewBuilder
    private var ligneHeure: some View {
        switch a.genre {
        case .enCours:
            if let debut = a.debut, let fin = a.fin, fin > debut {
                Text("reste ") + Text(timerInterval: debut...fin, countsDown: true)
            } else {
                Text("en ce moment")
            }
        case .suivant:
            if let debut = a.debut {
                Text("à \(Format.heure(debut))")
            } else {
                Text("bientôt")
            }
        case .aFaire(let total):
            Text(total > 1 ? "et \(total - 1) autre\(total > 2 ? "s" : "")" : "sans heure fixe")
        case .libre(let retards):
            Text(retards > 0 ? "\(retards) en retard" : "rien à heure fixe")
        case .aucuneSource:
            Text("Branche Motion ou ton agenda")
        case .enPanne:
            Text("Réessaie dans un moment")
        case .nonConnecte:
            Text("Ouvre Rémy pour te connecter")
        case .injoignable:
            Text("Vérifie Tailscale")
        }
    }
}
