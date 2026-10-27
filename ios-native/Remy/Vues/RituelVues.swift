import SwiftUI
import UIKit
import RemyCore

// MARK: - Le rendez-vous quotidien (24/10)
//
// Le briefing du matin (ouvert par sa notification, ou par la boîte de
// l'accueil), le bilan du soir, le bandeau « menacée » et les réglages.
// Rien n'appelle l'IA tout seul : « Organiser ma journée » reste un geste.

/// Une tâche dont l'échéance ne tient plus, et l'action utile.
struct CarteMenacee: View {
    @Environment(AppModel.self) private var app
    let m: MenaceeTour
    var autres = 0
    var voirTout: (() -> Void)? = nil
    /// Avant de partir vers Rémy (fermer la feuille ouverte).
    var avant: () -> Void = {}
    @State private var enCours = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 13, weight: .semibold))
                Text("Menacée")
                    .font(Police.texte(13, .semibold))
                Spacer(minLength: 6)
                if autres > 0, let voirTout {
                    Button {
                        Haptique.leger()
                        voirTout()
                    } label: {
                        Text("+ \(autres) autre\(autres > 1 ? "s" : "")")
                            .font(Police.texte(14, .medium))
                            .underline()
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Palette.encre2)
                    .accessibilityLabel("Voir les \(autres + 1) tâches menacées")
                }
            }
            .foregroundStyle(Palette.danger)
            .frame(minHeight: 22)
            Text("« \(m.titre) »")
                .font(Police.texte(17, .semibold))
                .foregroundStyle(Palette.encre)
                .fixedSize(horizontal: false, vertical: true)
            Text(m.phrase)
                .font(Police.texte(15))
                .foregroundStyle(Palette.encre2)
                .fixedSize(horizontal: false, vertical: true)
            if let a = m.action {
                BoutonA(titre: enCours ? "Envoi à Motion…" : a.libelle,
                        symbole: a.type == "caser" ? "bubble.left" : "calendar.badge.clock",
                        principal: false, hauteur: 44) { agir(a) }
                    .disabled(enCours)
                    .padding(.top, 4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .carte(rayon: 18)
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Palette.danger.opacity(0.55), lineWidth: 1.5)
        }
        .accessibilityElement(children: .contain)
    }

    private func agir(_ a: MenaceeTour.Action) {
        Haptique.leger()
        if a.type == "repousser", let e = a.echeance {
            enCours = true
            Task {
                // Annulable depuis le bandeau, comme toute replanification.
                _ = await app.tableau.replanifier(id: m.id, titre: m.titre, echeance: e.date)
                enCours = false
                await app.rituel.charger()
            }
            return
        }
        // « Caser » : la question est préparée pour Rémy, jamais envoyée seule.
        avant()
        let texte = "« \(m.titre) » est menacée : \(m.phrase) Trouve-lui un créneau avant son échéance, sans toucher à mes rendez-vous."
        Task {
            if !(await app.preparer(texte, dansFil: Fils.journee(Date()))) {
                app.dire("Tu as déjà un message en cours pour Rémy : envoie-le ou efface-le d'abord.")
            }
        }
    }
}

/// Le briefing : les trois lignes, ce qui est menacé, le conseil du moment,
/// les sujets de la nuit, et « Organiser ma journée ».
struct BriefingVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer

    var body: some View {
        let r = app.rituel
        let b = r.briefing()
        let d = app.tableau.donnees
        let menaces = d?.menacees ?? b?.menacees ?? []
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !r.disponible {
                        encadre("Ta tour ne sait pas encore préparer le briefing : relance son installeur pour la mettre à jour.")
                    } else if let b {
                        TroisLignes(b: b, le: r.le, chargement: r.chargement, erreur: r.erreur) { Task { await r.charger() } }
                    } else if r.chargement {
                        Squelette(largeurs: [0.55, 0.95, 0.85, 0.9])
                            .padding(18)
                            .carte(rayon: 18)
                    } else {
                        Vide(texte: r.erreur ?? "Le briefing de ce jour n'est pas encore prêt.", titreAction: "Réessayer") {
                            Task { await r.charger() }
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .carte(rayon: 18)
                    }

                    if !menaces.isEmpty {
                        Intertitre(texte: menaces.count > 1 ? "Menacées (\(menaces.count))" : "Menacée")
                        ForEach(menaces) { m in CarteMenacee(m: m, avant: { fermer() }) }
                    }

                    if let c = d?.conseil?.conseil {
                        Intertitre(texte: "Le conseil du moment")
                        Text(c.texte)
                            .font(Police.texte(16))
                            .foregroundStyle(Palette.encre)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .carte(rayon: 18)
                    }

                    let sujets = d?.briefing?.items ?? []
                    Intertitre(texte: "À voir avec Rémy" + (sujets.isEmpty ? "" : " (\(sujets.filter { $0.etat == "ouvert" }.count))"))
                    if sujets.isEmpty {
                        Text(BoiteView.rien(d?.briefing, recente: Nuit.estRecente(d?.briefing?.generatedAt, maintenant: Date()),
                                            reflexion: d?.systeme?.reflexion))
                            .font(Police.texte(15))
                            .foregroundStyle(Palette.encre2)
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .carte(rayon: 18)
                    } else {
                        ForEach(sujets) { s in CarteSujet(sujet: s, generatedAt: d?.briefing?.generatedAt) { fermer() } }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        BoutonA(titre: "Organiser ma journée avec Rémy", symbole: "wand.and.stars") {
                            Haptique.leger()
                            fermer()
                            Task { await app.organiserJournee() }
                        }
                        Text("Rémy (ton modèle local) prépare un plan : rien ne bouge dans Motion sans ton « Oui ».")
                            .font(Police.texte(13))
                            .foregroundStyle(Palette.encre3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 6)
                }
                .padding(16)
                .padding(.bottom, 24)
            }
            .refreshable { await r.charger() }
            .background(Palette.fond)
            .overlay(alignment: .bottom) { ToastView(marge: 12, annoncer: false) }
            .navigationTitle("Ton briefing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fermer") { fermer() } }
            }
        }
        .task { await r.charger() }
    }

    private func encadre(_ texte: String) -> some View {
        Text(texte)
            .font(Police.texte(15))
            .foregroundStyle(Palette.encre2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .carte(rayon: 18)
    }
}

/// Ce qui compte, pourquoi, ce qui est menacé — et d'où ça vient.
private struct TroisLignes: View {
    let b: BriefingMatin
    let le: Date?
    let chargement: Bool
    let erreur: String?
    let reessayer: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(b.jour.map { String($0.prefix(1)).uppercased() + String($0.dropFirst()) } ?? b.titre)
                .font(Police.titre(24))
                .foregroundStyle(Palette.encre)
            ligne(b.compte, symbole: "scope", fort: true)
            ligne(b.pourquoi, symbole: "questionmark.circle")
            ligne(b.menace, symbole: b.menace.hasPrefix("Menacée") ? "exclamationmark.triangle" : "checkmark.shield",
                  couleur: b.menace.hasPrefix("Menacée") ? Palette.danger : Palette.encre2)
            if let resume = b.resume {
                Text(resume)
                    .font(Police.mono(13))
                    .foregroundStyle(Palette.encre3)
            }
            if let a = b.avertissement {
                Label(a, systemImage: "exclamationmark.circle")
                    .font(Police.texte(14))
                    .foregroundStyle(Palette.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 6) {
                if chargement { ProgressView().controlSize(.small) }
                Text(provenance)
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre3)
                    .fixedSize(horizontal: false, vertical: true)
                if erreur != nil, !chargement {
                    Spacer(minLength: 4)
                    BoutonTexte("Réessayer", action: reessayer)
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .carte(rayon: 18)
        .accessibilityElement(children: .contain)
    }

    private var provenance: String {
        let quand = le.map { Rituel.fraicheur($0, maintenant: Date()) } ?? "—"
        if chargement { return "Calculé par ta tour \(quand), sans IA · mise à jour…" }
        if let erreur { return "Calculé par ta tour \(quand). Pas actualisé : \(erreur)" }
        return "Calculé par ta tour \(quand), sans IA."
    }

    private func ligne(_ texte: String, symbole: String, fort: Bool = false, couleur: Color = Palette.encre) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: symbole)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(couleur == Palette.encre ? Palette.signal : couleur)
                .frame(width: 20)
            Text(texte)
                .font(Police.texte(fort ? 17 : 15, fort ? .semibold : .regular))
                .foregroundStyle(couleur)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct Intertitre: View {
    let texte: String
    var body: some View {
        Text(texte.uppercased())
            .font(Police.texte(12, .semibold))
            .tracking(0.6)
            .foregroundStyle(Palette.encre3)
            .padding(.top, 4)
    }
}

/// Le bilan du soir : fait, glissé, ce qui reste (→ demain d'un geste), et
/// une ligne facultative pour la nuit.
struct BilanVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var ressenti = ""
    @State private var envoi = false
    @State private var pousse = false

    var body: some View {
        let r = app.rituel
        let b = r.bilan()
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !r.disponible {
                        Vide(texte: "Ta tour ne sait pas encore préparer le bilan : relance son installeur pour la mettre à jour.")
                            .padding(18)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .carte(rayon: 18)
                    } else if let b {
                        Text(b.phrase)
                            .font(Police.titre(22))
                            .foregroundStyle(Palette.encre)
                            .fixedSize(horizontal: false, vertical: true)
                        if let a = b.avertissement {
                            Label(a, systemImage: "exclamationmark.circle")
                                .font(Police.texte(14))
                                .foregroundStyle(Palette.danger)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        bloc("Fait", symbole: "checkmark.circle", lignes: b.fait,
                             vide: "Rien coché dans Rémy aujourd'hui. Ce que tu as coché dans Motion n'apparaît pas ici.")
                        bloc("A glissé", symbole: "arrow.uturn.forward", lignes: b.glisse.map(\.titre),
                             vide: "Rien n'a glissé de son créneau.")
                        let reste = b.reste.filter { !r.poussees.contains($0.id) }
                        bloc("Reste pour aujourd'hui", symbole: "tray", lignes: reste.map(\.titre),
                             vide: r.poussees.isEmpty ? "Rien ne reste : bravo." : "Poussé à demain. Motion recalcule.")
                        if !reste.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                BoutonA(titre: pousse ? "Envoi à Motion…" : "Tout ce qui reste → demain", symbole: "arrow.right.circle") {
                                    Haptique.leger()
                                    pousse = true
                                    Task {
                                        if await r.toutADemain() { Haptique.succes() }
                                        pousse = false
                                    }
                                }
                                .disabled(pousse)
                                Text("Une seule écriture dans Motion, même heure demain. Annulable depuis le bandeau ou l'Historique.")
                                    .font(Police.texte(13))
                                    .foregroundStyle(Palette.encre3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    } else if r.chargement {
                        Squelette(largeurs: [0.6, 0.9, 0.7])
                            .padding(18)
                            .carte(rayon: 18)
                    } else {
                        Vide(texte: r.erreur ?? "Le bilan d'aujourd'hui n'est pas encore prêt.", titreAction: "Réessayer") {
                            Task { await r.charger() }
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .carte(rayon: 18)
                    }

                    if r.disponible {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Comment ça s'est passé ?")
                                .font(Police.texte(16, .semibold))
                                .foregroundStyle(Palette.encre)
                            TextField("Une ligne pour Rémy (facultatif)", text: $ressenti, axis: .vertical)
                                .font(Police.texte(16))
                                .lineLimit(1...4)
                                .padding(12)
                                .frame(minHeight: 48)
                                .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .disabled(r.bilanRange)
                            BoutonA(titre: r.bilanRange ? "Rangé pour la nuit" : envoi ? "Envoi…" : "Ranger pour la nuit",
                                    symbole: r.bilanRange ? "checkmark" : "moon.stars", principal: false, hauteur: 48) {
                                Haptique.leger()
                                envoi = true
                                Task {
                                    if await r.rangerBilan(ressenti) { Haptique.succes() }
                                    envoi = false
                                }
                            }
                            .disabled(envoi || r.bilanRange)
                            Text("Rangé sur ta tour avec les faits du jour ; Rémy le relira cette nuit. Sans ligne, les faits suffisent.")
                                .font(Police.texte(13))
                                .foregroundStyle(Palette.encre3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(16)
                        .carte(rayon: 18)
                    }
                }
                .padding(16)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await r.charger() }
            .background(Palette.fond)
            .overlay(alignment: .bottom) { ToastView(marge: 12, annoncer: false) }
            .navigationTitle("Bilan du soir")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fermer") { fermer() } }
            }
        }
        .task { await r.charger() }
    }

    private func bloc(_ titre: String, symbole: String, lignes: [String], vide: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(titre + (lignes.isEmpty ? "" : " (\(lignes.count))"), systemImage: symbole)
                .font(Police.texte(14, .semibold))
                .foregroundStyle(Palette.encre2)
            if lignes.isEmpty {
                Text(vide)
                    .font(Police.texte(15))
                    .foregroundStyle(Palette.encre3)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(Array(lignes.enumerated()), id: \.offset) { _, l in
                    Text("· " + l)
                        .font(Police.texte(16))
                        .foregroundStyle(Palette.encre)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .carte(rayon: 18)
    }
}

/// Une fois, sur l'accueil : « Ton briefing chaque matin ? » (coupé par défaut).
struct PropositionRituel: View {
    @Environment(AppModel.self) private var app
    @AppStorage(ReglagesRituel.clePropose) private var propose = false
    @AppStorage(ReglagesRituel.cleMatin) private var matin = false
    @AppStorage(ReglagesRituel.cleHeureMatin) private var heureMatin = ReglagesRituel.heureMatinParDefaut

    var body: some View {
        if app.rituel.disponible && !propose && !matin {
            VStack(alignment: .leading, spacing: 10) {
                Label("Ton briefing chaque matin ?", systemImage: "sunrise")
                    .font(Police.texte(17, .semibold))
                    .foregroundStyle(Palette.encre)
                Text("À \(ReglagesRituelVue.texteHeure(heureMatin)) : ce qui compte, pourquoi, ce qui est menacé. Trois lignes calculées par ta tour, sans IA. L'heure se change dans Réglages.")
                    .font(Police.texte(15))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    BoutonA(titre: "Oui, à \(ReglagesRituelVue.texteHeure(heureMatin))", hauteur: 44) { activer() }
                    BoutonA(titre: "Non merci", principal: false, hauteur: 44) {
                        Haptique.leger()
                        propose = true
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .carte(rayon: 18)
            .padding(.horizontal, 16)
        }
    }

    private func activer() {
        Haptique.leger()
        Task {
            propose = true
            if await Notifications.demander() {
                matin = true
                app.dire("Briefing activé : chaque matin à \(ReglagesRituelVue.texteHeure(heureMatin)).")
            } else {
                app.dire("iOS refuse les notifications de Rémy : autorise-les dans Réglages › Notifications › Rémy.")
            }
        }
    }
}

/// Réglages › Rendez-vous quotidien.
struct ReglagesRituelVue: View {
    @Environment(\.openURL) private var ouvrirURL
    @AppStorage(ReglagesRituel.cleMatin) private var matin = false
    @AppStorage(ReglagesRituel.cleHeureMatin) private var heureMatin = ReglagesRituel.heureMatinParDefaut
    @AppStorage(ReglagesRituel.cleSoir) private var soir = false
    @AppStorage(ReglagesRituel.cleHeureSoir) private var heureSoir = ReglagesRituel.heureSoirParDefaut
    @AppStorage(ReglagesRituel.clePropose) private var propose = false
    @State private var refuse = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("RENDEZ-VOUS QUOTIDIEN")
                .font(Police.texte(12, .semibold))
                .tracking(0.6)
                .foregroundStyle(Palette.encre3)
                .padding(.top, 14)
                .padding(.bottom, 2)
            interrupteur("Briefing du matin", sous: "Ce qui compte, pourquoi, ce qui est menacé. Calculé par ta tour, sans IA.",
                         symbole: "sunrise", valeur: $matin)
            if matin { choixHeure("Heure du briefing", $heureMatin) }
            interrupteur("Bilan du soir", sous: "Fait, glissé, ce qui reste pour demain : 30 secondes.",
                         symbole: "moon.stars", valeur: $soir)
            if soir { choixHeure("Heure du bilan", $heureSoir) }
            if refuse {
                VStack(alignment: .leading, spacing: 6) {
                    Text("iOS refuse les notifications de Rémy.")
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.danger)
                    BoutonTexte("Ouvrir les réglages de l'iPhone") {
                        if let u = URL(string: UIApplication.openSettingsURLString) { ouvrirURL(u) }
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .foregroundStyle(Palette.encre)
        // Allumé, puis refusé dans les réglages de l'iPhone : rien ne sonnerait, c'est dit ici.
        .task(id: matin || soir) {
            if matin || soir { refuse = await Notifications.refusees() } else { refuse = false }
        }
    }

    static func texteHeure(_ minutes: Int) -> String {
        String(format: "%d:%02d", minutes / 60, minutes % 60)
    }

    private func interrupteur(_ titre: String, sous: String, symbole: String, valeur: Binding<Bool>) -> some View {
        Toggle(isOn: Binding(get: { valeur.wrappedValue }, set: { oui in
            Haptique.leger()
            guard oui else { valeur.wrappedValue = false; return }
            Task {
                propose = true
                if await Notifications.demander() {
                    valeur.wrappedValue = true
                    refuse = false
                } else {
                    refuse = true
                }
            }
        })) {
            HStack(spacing: 14) {
                Image(systemName: symbole).font(.system(size: 18)).frame(width: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text(titre).font(Police.texte(16, .medium))
                    Text(sous).font(Police.texte(13)).foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .tint(Palette.signal)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Filet() }
    }

    private func choixHeure(_ titre: String, _ minutes: Binding<Int>) -> some View {
        DatePicker(titre, selection: Binding(
            get: { Calendar.current.date(bySettingHour: minutes.wrappedValue / 60, minute: minutes.wrappedValue % 60, second: 0, of: Date()) ?? Date() },
            set: {
                let c = Calendar.current.dateComponents([.hour, .minute], from: $0)
                minutes.wrappedValue = (c.hour ?? 0) * 60 + (c.minute ?? 0)
            }), displayedComponents: .hourAndMinute)
            .font(Police.texte(15))
            .padding(.leading, 40)
            .frame(minHeight: 50)
            .overlay(alignment: .bottom) { Filet() }
    }
}

/// Réglages › Capture : où va une pensée sans action claire (24/10).
struct ReglageCapture: View {
    @AppStorage(GenreCapture.cleParDefaut) private var parDefaut = "idees"

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                Image(systemName: "tray.and.arrow.down").font(.system(size: 18)).frame(width: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Une pensée sans action claire").font(Police.texte(16, .medium))
                    Text("« Appeler le garage » reste une tâche Motion ; « un clip en noir » va où tu choisis.")
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Picker("Une pensée sans action claire", selection: $parDefaut) {
                Text("Dans les Idées").tag("idees")
                Text("Dans Motion").tag("motion")
            }
            .pickerStyle(.segmented)
        }
        .foregroundStyle(Palette.encre)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Filet() }
    }
}

/// Les outils du constructeur, rangés à part (24/10) : utiles pour comprendre
/// ce que fait Rémy, pas pour la journée.
enum Diagnostic {
    /// La jauge du contexte et les tokens par seconde dans le chat. Visibles
    /// par défaut depuis le 27/10 (demande du propriétaire) ; masquables ici.
    static let cleJauge = "diagnostic.jauge"
    static let jaugeParDefaut = true
    /// Captures de la CI des écrans de mesure : la jauge reste visible.
    static var demo: Bool {
        ["jauge", "etapes", "perf-remy"].contains(ProcessInfo.processInfo.environment["REMY_DEMO_ECRAN"] ?? "")
    }
}

struct DiagnosticVue: View {
    @AppStorage(Diagnostic.cleJauge) private var jauge = Diagnostic.jaugeParDefaut
    @AppStorage(Gestes.cleAppui) private var appuiMs = Gestes.appuiParDefaut

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Pour comprendre ce que fait Rémy et le signaler. Rien d'indispensable au quotidien.")
                    .font(Police.texte(14))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 12)
                NavigationLink {
                    MesuresView()
                } label: {
                    HStack(spacing: 14) {
                        Image(systemName: "speedometer").font(.system(size: 18)).frame(width: 26)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Temps de réponse").font(Police.texte(16, .medium))
                            Text("Ce que prend chaque étape, iPhone et tour").font(Police.texte(13)).foregroundStyle(Palette.encre2)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.encre3)
                    }
                    .padding(.vertical, 12)
                    .frame(minHeight: 56)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) { Filet() }
                Toggle(isOn: $jauge) {
                    HStack(spacing: 14) {
                        Image(systemName: "gauge.with.dots.needle.33percent").font(.system(size: 18)).frame(width: 26)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Jauge du contexte").font(Police.texte(16, .medium))
                            Text("Le cadran et les tokens par seconde, en haut des conversations. Allumée par défaut.")
                                .font(Police.texte(13)).foregroundStyle(Palette.encre2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .tint(Palette.signal)
                .padding(.vertical, 10)
                .frame(minHeight: 60)
                .overlay(alignment: .bottom) { Filet() }
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 14) {
                        Image(systemName: "hand.tap").font(.system(size: 18)).frame(width: 26)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Appui pour agrandir le planning").font(Police.texte(16, .medium))
                            Text("Plus long si ça s'ouvre sans le vouloir.").font(Police.texte(13)).foregroundStyle(Palette.encre2)
                        }
                    }
                    Picker("Appui pour agrandir le planning", selection: $appuiMs) {
                        ForEach(Gestes.choix, id: \.self) { Text("\($0) ms").tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                .padding(.vertical, 12)
                .overlay(alignment: .bottom) { Filet() }
                Text("Les codes d'erreur (R-…) restent sous chaque message raté, avec « Copier le diagnostic ».")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 14)
            }
            .foregroundStyle(Palette.encre)
            .padding(.horizontal, 18)
            .padding(.bottom, 24)
        }
        .background(Palette.fond)
        .navigationTitle("Diagnostic")
        .navigationBarTitleDisplayMode(.inline)
    }
}
