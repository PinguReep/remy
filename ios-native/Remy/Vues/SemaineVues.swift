import SwiftUI
import RemyCore

// Demain et les 7 jours (24/10) : dans la vue « À l'échelle », un segment
// Aujourd'hui | Demain | 7 jours. Tout est lu par la tour dans Motion et
// l'agenda, sans IA ; la dernière vue reçue reste sur l'iPhone, datée.

/// Aujourd'hui | Demain | 7 jours : trois boutons de 44 pt, pas le segment
/// système (32 pt, trop petit au pouce).
struct SegmentEchelle: View {
    @Binding var portee: PorteeEchelle

    var body: some View {
        HStack(spacing: 4) {
            bouton("Aujourd'hui", .aujourdhui, actif: portee == .aujourdhui)
            bouton("Demain", .demain, actif: portee == .demain)
            bouton("7 jours", .semaine, actif: portee == .semaine || Self.estJour(portee))
        }
        .padding(3)
        .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    static func estJour(_ p: PorteeEchelle) -> Bool {
        if case .jour = p { return true }
        return false
    }

    private func bouton(_ titre: String, _ cible: PorteeEchelle, actif: Bool) -> some View {
        Button {
            guard portee != cible else { return }
            Haptique.leger()
            withAnimation(.easeOut(duration: 0.18)) { portee = cible }
        } label: {
            Text(titre)
                .font(Police.texte(15, actif ? .semibold : .medium))
                .foregroundStyle(actif ? Palette.fond : Palette.encre)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(actif ? Palette.encre : Color.clear, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(actif ? .isSelected : [])
    }
}

/// Ce que dit la vue quand elle n'a pas (encore) de jours à montrer :
/// chargement, tour pas à jour, erreur avec « Réessayer », rien de prévu.
struct EtatSemaine: View {
    @Environment(AppModel.self) private var app
    let vide: String

    var body: some View {
        let s = app.semaine
        VStack(alignment: .leading, spacing: 14) {
            if !s.disponible {
                Vide(texte: "Demain et les 7 jours arrivent avec la mise à jour de ta tour (scripts/installer-tour.ps1).")
            } else if s.donnees == nil && (s.chargement || s.erreur == nil) {
                Squelette(largeurs: [0.85, 0.6, 0.75])
                Squelette(largeurs: [0.7, 0.9])
            } else if let e = s.erreur, s.donnees == nil {
                Vide(texte: s.erreurReseau ? "La tour ne répond pas : Tailscale est-il actif ? Rien n'est gardé sur l'iPhone pour ces jours-là." : e,
                     titreAction: "Réessayer") {
                    Haptique.leger()
                    Task { await app.semaine.charger() }
                }
            } else {
                Vide(texte: vide)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Le bandeau daté d'une vue gardée sur l'iPhone (tour injoignable, copie).
struct BandeauSemaine: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if let t = app.semaine.etat() {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: app.semaine.erreur != nil ? "wifi.slash" : "clock.arrow.circlepath")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.encre2)
                Text(t)
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if app.semaine.erreur != nil {
                    BoutonTexte("Réessayer", couleur: Palette.encre) {
                        Haptique.leger()
                        Task { await app.semaine.charger() }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal, 12)
            .padding(.top, 8)
        }
    }
}

/// Les 7 jours en vue compacte : une carte par jour (charge, rendez-vous
/// fixes, échéances, ce qui déborde). Toucher l'en-tête d'un jour l'ouvre à
/// l'échelle ; toucher une tâche ouvre « Gérer », comme dans la journée.
struct SemaineCompacte: View {
    @Environment(AppModel.self) private var app
    let ouvrirJour: (String) -> Void
    let ouvrir: (ElementJour) -> Void

    var body: some View {
        let jours = app.semaine.jours()
        if jours.isEmpty {
            EtatSemaine(vide: "Rien de prévu sur les 7 prochains jours : ni rendez-vous, ni tâche placée par Motion.")
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if app.semaine.donnees?.horaires == nil {
                        Text("Heures libres inconnues : Motion n'a pas transmis d'horaires de travail. Les heures prévues restent justes.")
                            .font(Police.texte(13))
                            .foregroundStyle(Palette.encre3)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 4)
                    }
                    ForEach(jours) { j in
                        CarteJour(j: j, ouvrirJour: ouvrirJour, ouvrir: ouvrir)
                    }
                    sources
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 12)
            }
            .scrollIndicators(.hidden)
            .refreshable { await app.semaine.charger() }
        }
    }

    @ViewBuilder
    private var sources: some View {
        let s = app.semaine.donnees?.sources
        let manque = [s?.motion == "erreur" ? "Motion" : nil, s?.agenda == "erreur" ? "l'agenda" : nil].compactMap { $0 }
        if !manque.isEmpty {
            Text("\(manque.joined(separator: " et ")) n'a pas répondu : ces jours peuvent être incomplets. Tire pour réessayer.")
                .font(Police.texte(13))
                .foregroundStyle(Palette.danger)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
        }
    }
}

/// Un jour en vue compacte : un en-tête touchable (le jour à l'échelle) qui
/// dit la charge, les rendez-vous fixes et ce qui dure toute la journée ; en
/// dessous, seulement ce qui est menacé, touchable comme dans la journée.
private struct CarteJour: View {
    @Environment(AppModel.self) private var app
    let j: JourSemaine
    let ouvrirJour: (String) -> Void
    let ouvrir: (ElementJour) -> Void

    var body: some View {
        let charge = j.charge ?? ChargeJour(taches: j.taches.reduce(0) { $0 + $1.dureeTotale })
        let aujourdhui = j.jour == Format.jourISO(Date())
        let menaces = menacees
        VStack(alignment: .leading, spacing: 0) {
            Button {
                Haptique.leger()
                ouvrirJour(j.jour)
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(aujourdhui ? "Aujourd'hui" : j.titreCourt)
                            .font(Police.titre(18))
                            .foregroundStyle(Palette.encre)
                        if charge.niveau == .deborde { Risque(texte: "Débordée") } else if charge.niveau == .charge { Pastille(texte: "Chargée") }
                        Spacer(minLength: 4)
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.encre3)
                    }
                    JaugeCharge(charge: charge)
                    Text(resume(charge))
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                    if !j.rendezVous.isEmpty {
                        Label {
                            Text(j.rendezVous.map { "\(Format.heure($0.debut)) \($0.titre)" }.joined(separator: " · "))
                                .lineLimit(2)
                        } icon: {
                            Image(systemName: "lock.fill").font(.system(size: 10, weight: .semibold))
                        }
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.encre)
                    }
                    if !j.toute.isEmpty {
                        Text("Toute la journée : " + j.toute.map(\.titre).joined(separator: " · "))
                            .font(Police.texte(14))
                            .foregroundStyle(Palette.encre2)
                            .lineLimit(1)
                    }
                }
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint("Ouvre ce jour à l'échelle")
            ForEach(menaces.prefix(2)) { t in
                LigneEcheance(t: t, element: element(t), ouvrir: ouvrir)
            }
            if menaces.count > 2 {
                Button {
                    Haptique.leger()
                    ouvrirJour(j.jour)
                } label: {
                    Text("+ \(menaces.count - 2) autre\(menaces.count > 3 ? "s" : "") à surveiller")
                        .font(Police.texte(14, .medium))
                        .foregroundStyle(Palette.encre2)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, menaces.isEmpty ? 0 : 6)
        .carte(rayon: 18)
    }

    /// Ce qui est menacé ce jour-là : échéance que Motion tient mal, ou tâche
    /// placée après son échéance (même due un autre jour).
    private var menacees: [EcheanceJour] {
        let ids = Set(j.echeances.map(\.id))
        let horsJour = j.deborde.filter { !ids.contains($0.id) }.map {
            EcheanceJour(id: $0.id, titre: $0.titre, echeance: $0.echeance, projet: $0.projet, duree: $0.duree, placee: true, menacee: true)
        }
        return j.echeances.filter { $0.menacee == true } + horsJour
    }

    /// La tâche telle que la frise la connaît (placée ce jour ou un autre).
    private func element(_ t: EcheanceJour) -> ElementJour? {
        for d in app.semaine.jours() {
            if let e = d.items.first(where: { $0.type == "tache" && $0.id == t.id }) { return e }
        }
        return app.tableau.journee?.items?.first { $0.type == "tache" && $0.id == t.id }
    }

    private func resume(_ c: ChargeJour) -> String {
        var bits = [c.phrase]
        let e = j.echeances.count
        if e > 0 { bits.append("\(e) échéance\(e > 1 ? "s" : "")") }
        return bits.joined(separator: " · ")
    }
}

/// Une échéance : placée, elle s'ouvre dans « Gérer » ; pas encore placée par
/// Motion, elle a les mêmes actions qu'une tâche « À faire » de l'accueil.
struct LigneEcheance: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    let t: EcheanceJour
    let element: ElementJour?
    let ouvrir: (ElementJour) -> Void
    @State private var actions = false

    var body: some View {
        Button {
            Haptique.leger()
            if let e = element { ouvrir(e) } else { actions = true }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: t.menacee == true ? "exclamationmark.triangle.fill" : "flag")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(t.menacee == true ? Palette.danger : Palette.encre2)
                    .frame(width: 16)
                    .padding(.top, 3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.titre)
                        .font(Police.texte(15))
                        .foregroundStyle(Palette.encre)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                    Text(detail).font(Police.texte(12, .medium)).foregroundStyle(t.menacee == true ? Palette.danger : Palette.encre3)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Ouvre ses actions")
        .modifier(ActionsTache(id: t.id, titre: t.titre, ouvert: $actions, echeance: t.echeance,
                               duree: t.duree, priorite: t.priorite, bloquee: t.bloquee ?? false, etiquettes: t.etiquettes) {
            ui.journeeEtendue = false
            Task { _ = await app.preparer(Brouillons.tache(t.titre), dansFil: Fils.journee(Date())) }
        })
    }

    private var detail: String {
        let heure = t.echeance.map { "échéance \(Format.heure($0))" } ?? "échéance"
        if t.placee != true { return heure + " · pas encore placée par Motion" }
        if t.menacee == true { return heure + " · Motion la place après" }
        return heure
    }
}

/// La charge d'un jour : la part des heures libres déjà prise par les tâches.
struct JaugeCharge: View {
    let charge: ChargeJour

    var body: some View {
        let couleur: Color = charge.niveau == .deborde ? Palette.danger : charge.niveau == .charge ? Palette.signal : Palette.encre2
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.fond3)
                Capsule().fill(couleur).frame(width: max(charge.taches > 0 ? 6 : 0, g.size.width * charge.remplissage))
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

/// En tête d'un jour qui vient, au-dessus de sa frise : la charge, ce qui
/// dure toute la journée, et les échéances menacées ou pas encore placées
/// (elles n'ont pas de place sur la frise).
struct ResumeJour: View {
    @Environment(AppModel.self) private var app
    let j: JourSemaine
    let ouvrir: (ElementJour) -> Void

    var body: some View {
        let charge = j.charge ?? ChargeJour(taches: j.taches.reduce(0) { $0 + $1.dureeTotale })
        let ids = Set(j.items.map(\.id))
        let aSignaler = j.echeances.filter { $0.menacee == true || !ids.contains($0.id) }
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(charge.phrase)
                    .font(Police.texte(14, .medium))
                    .foregroundStyle(Palette.encre)
                if charge.niveau == .deborde { Risque(texte: "Débordée") }
            }
            JaugeCharge(charge: charge)
            if !j.toute.isEmpty {
                Text("Toute la journée : " + j.toute.map(\.titre).joined(separator: " · "))
                    .font(Police.texte(14))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(aSignaler.prefix(3)) { t in
                LigneEcheance(t: t, element: j.items.first { $0.type == "tache" && $0.id == t.id }, ouvrir: ouvrir)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.filet).frame(height: 1) }
    }
}

/// « À l'échelle », à côté de LA SUITE : la vue agrandie sans appui long
/// (l'appui long reste un raccourci).
struct BoutonEchelle: View {
    let action: () -> Void

    var body: some View {
        Button {
            Haptique.leger()
            action()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "calendar.day.timeline.left").font(.system(size: 13, weight: .semibold))
                Text("À l'échelle").font(Police.texte(14, .semibold))
            }
            .foregroundStyle(Palette.encre2)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("À l'échelle : aujourd'hui, demain et les 7 jours")
    }
}
