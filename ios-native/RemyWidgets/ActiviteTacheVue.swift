import ActivityKit
import AppIntents
import WidgetKit
import SwiftUI
import RemyCore

// L'activité en direct « tâche en cours » (24/10) : écran verrouillé et
// Dynamic Island. La minuterie et la barre avancent seules ; « Terminer » et
// « +15 min » s'exécutent dans l'app (LiveActivityIntent), sans l'ouvrir.

struct WidgetActiviteTache: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ActiviteTache.self) { contexte in
            EcranVerrouille(attributs: contexte.attributes, etat: contexte.state, perimee: contexte.isStale)
                .activityBackgroundTint(Teinte.fond)
                .activitySystemActionForegroundColor(Teinte.encre)
                .widgetURL(LienRemy.onglet(.aujourdhui).url)
        } dynamicIsland: { contexte in
            let etat = contexte.state
            let attributs = contexte.attributes
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("En cours", systemImage: "timer")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Teinte.signal)
                        .labelStyle(.iconOnly)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Minuterie(etat: etat, perimee: contexte.isStale)
                        .font(.system(size: 17, weight: .semibold).monospacedDigit())
                        .frame(maxWidth: 76, alignment: .trailing)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(attributs.titre)
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        Barre(etat: etat)
                        if etat.terminee {
                            Fait(message: etat.message)
                        } else {
                            if let m = etat.message {
                                Text(m).font(.system(size: 12)).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                            }
                            Boutons(attributs: attributs)
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: etat.terminee ? "checkmark" : "timer")
                    .foregroundStyle(Teinte.signal)
                    .accessibilityLabel(attributs.titre)
            } compactTrailing: {
                Minuterie(etat: etat, perimee: contexte.isStale)
                    .monospacedDigit()
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: etat.terminee ? "checkmark" : "timer")
                    .foregroundStyle(Teinte.signal)
            }
            .widgetURL(LienRemy.onglet(.aujourdhui).url)
            .keylineTint(Teinte.signal)
        }
    }
}

/// Le temps restant, qui avance seul ; « 0:00 » remplacé par un mot à la fin.
private struct Minuterie: View {
    let etat: ActiviteTache.Etat
    let perimee: Bool

    var body: some View {
        if etat.terminee {
            Text("Fait")
        } else if perimee || etat.fin <= Date() {
            Text("Fini")
        } else {
            Text(timerInterval: etat.debut...etat.fin, countsDown: true)
                .multilineTextAlignment(.trailing)
        }
    }
}

private struct Barre: View {
    let etat: ActiviteTache.Etat

    var body: some View {
        ProgressView(timerInterval: etat.debut...etat.fin, countsDown: false, label: { EmptyView() }, currentValueLabel: { EmptyView() })
            .tint(Teinte.signal)
    }
}

private struct Fait: View {
    let message: String?

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Teinte.signal)
            Text(message ?? "Fait. Rémy prévient Motion.")
                .font(.system(size: 14, weight: .medium))
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .frame(minHeight: 44)
    }
}

/// « Terminer » et « +15 min » : zones d'au moins 44 pt.
private struct Boutons: View {
    let attributs: ActiviteTache

    var body: some View {
        HStack(spacing: 10) {
            Button(intent: TerminerTacheIntent(id: attributs.id, titre: attributs.titre)) {
                Label("Terminer", systemImage: "checkmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Teinte.surSignal)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Teinte.signal))
            }
            .buttonStyle(.plain)
            Button(intent: ProlongerTacheIntent(id: attributs.id, minutes: 15)) {
                Label("+15 min", systemImage: "plus")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Teinte.encre)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(RoundedRectangle(cornerRadius: 12).stroke(Teinte.filet, lineWidth: 1.5))
            }
            .buttonStyle(.plain)
        }
    }
}

private struct EcranVerrouille: View {
    let attributs: ActiviteTache
    let etat: ActiviteTache.Etat
    let perimee: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(etat.terminee ? "FAIT" : perimee || etat.fin <= Date() ? "TEMPS ÉCOULÉ" : "EN COURS")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(Teinte.signal)
                if let p = attributs.projet, !p.isEmpty {
                    Text("· \(p)")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Teinte.encre2)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Minuterie(etat: etat, perimee: perimee)
                    .font(.system(size: 22, weight: .semibold).monospacedDigit())
                    .foregroundStyle(Teinte.encre)
                    .frame(maxWidth: 110, alignment: .trailing)
            }
            Text(attributs.titre)
                .font(.system(size: 18, weight: .bold, design: .serif))
                .foregroundStyle(Teinte.encre)
                .lineLimit(2)
            Barre(etat: etat)
            HStack {
                Text(Format.heure(etat.debut))
                Spacer()
                Text(Format.heure(etat.fin))
            }
            .font(.system(size: 11).monospacedDigit())
            .foregroundStyle(Teinte.encre2)
            if etat.terminee {
                Fait(message: etat.message)
            } else {
                if let m = etat.message {
                    Text(m)
                        .font(.system(size: 13))
                        .foregroundStyle(Teinte.encre2)
                        .lineLimit(2)
                }
                Boutons(attributs: attributs)
            }
        }
        .padding(16)
    }
}
