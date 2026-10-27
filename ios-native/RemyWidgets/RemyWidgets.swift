import WidgetKit
import SwiftUI
import RemyCore

// Les widgets de Rémy (24/10) : « Capturer » (sans réseau), « Maintenant »
// (lit la tour par le trousseau partagé), l'activité en direct de la tâche en
// cours, et sur iOS 18 le contrôle « Capturer » du Centre de contrôle.

/// Le point d'entrée choisit le paquet selon la version d'iOS : les contrôles
/// n'existent qu'à partir d'iOS 18.
@main
struct PointEntreeWidgets {
    static func main() {
        if #available(iOS 18.0, *) {
            WidgetsRemy18.main()
        } else {
            WidgetsRemy.main()
        }
    }
}

struct WidgetsRemy: WidgetBundle {
    var body: some Widget {
        WidgetCapture()
        WidgetMaintenant()
        WidgetActiviteTache()
    }
}

@available(iOS 18.0, *)
struct WidgetsRemy18: WidgetBundle {
    var body: some Widget {
        WidgetCapture()
        WidgetMaintenant()
        WidgetActiviteTache()
        ControleCapture()
    }
}

struct EntreeCapture: TimelineEntry {
    let date: Date
}

/// Rien à rafraîchir : le widget ne fait qu'ouvrir l'app.
struct FournisseurCapture: TimelineProvider {
    func placeholder(in context: Context) -> EntreeCapture { EntreeCapture(date: Date()) }

    func getSnapshot(in context: Context, completion: @escaping (EntreeCapture) -> Void) {
        completion(EntreeCapture(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<EntreeCapture>) -> Void) {
        completion(Timeline(entries: [EntreeCapture(date: Date())], policy: .never))
    }
}

struct WidgetCapture: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "remy.capture", provider: FournisseurCapture()) { _ in
            VueCapture()
        }
        .configurationDisplayName("Capturer")
        .description("Une idée, une tâche, un rappel : un toucher ouvre la capture de Rémy.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

struct VueCapture: View {
    @Environment(\.widgetFamily) private var famille

    var body: some View {
        Group {
            if famille == .accessoryCircular {
                ZStack {
                    AccessoryWidgetBackground()
                    Image(systemName: "plus")
                        .font(.system(size: 24, weight: .semibold))
                }
                .accessibilityLabel("Capturer dans Rémy")
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Rémy")
                        .font(.system(size: 17, weight: .bold, design: .serif))
                        .foregroundStyle(Teinte.encre)
                    Spacer(minLength: 8)
                    Image(systemName: "plus")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(Teinte.surSignal)
                        .frame(width: 52, height: 52)
                        .background(Circle().fill(Teinte.signal))
                    Spacer(minLength: 8)
                    Text("Capturer")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Teinte.encre)
                    Text("idée, tâche, rappel")
                        .font(.system(size: 12))
                        .foregroundStyle(Teinte.encre2)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Capturer dans Rémy")
            }
        }
        .widgetURL(LienRemy.capture.url)
        .containerBackground(for: .widget) { Teinte.fond }
    }
}
