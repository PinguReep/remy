import WidgetKit
import SwiftUI
import RemyCore

// Les widgets de Rémy (24/10). Pour l'instant un seul, sans réseau : « + »
// qui ouvre la capture (remy://capture). Les widgets qui lisent la tour passent
// par TrousseauPartage.systeme.client() (lecture seule du trousseau partagé).

@main
struct WidgetsRemy: WidgetBundle {
    var body: some Widget {
        WidgetCapture()
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
