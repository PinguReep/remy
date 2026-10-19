import SwiftUI
import RemyCore

/// La jauge du chat (Sam, 19/10) : un petit compteur, comme dans une voiture,
/// pour la place que prend la conversation dans le contexte du modèle ; au
/// toucher, le détail et la vitesse d'écriture de Rémy.

/// Le cadran : un arc ouvert en bas (270°), rempli selon la place prise, avec
/// son aiguille. Sans taille connue, l'arc reste vide : rien d'inventé.
struct CadranJauge: View {
    let fraction: Double?
    let niveau: JaugeContexte.Niveau
    var diametre: CGFloat = 26
    var aiguille = true

    var body: some View {
        let f = fraction ?? 0
        let trait = max(2.5, diametre * 0.11)
        ZStack {
            Circle()
                .trim(from: 0, to: 0.75)
                .stroke(Palette.fond3, style: StrokeStyle(lineWidth: trait, lineCap: .round))
                .rotationEffect(.degrees(135))
            Circle()
                .trim(from: 0, to: 0.75 * f)
                .stroke(Self.couleur(niveau), style: StrokeStyle(lineWidth: trait, lineCap: .round))
                .rotationEffect(.degrees(135))
                .opacity(fraction == nil ? 0 : 1)
            if aiguille {
                Capsule()
                    .fill(Palette.encre)
                    .frame(width: diametre * 0.36, height: max(1.5, diametre * 0.07))
                    .offset(x: diametre * 0.18)
                    .rotationEffect(.degrees(135 + 270 * f))
                Circle().fill(Palette.encre).frame(width: diametre * 0.16, height: diametre * 0.16)
            }
        }
        .frame(width: diametre, height: diametre)
        .animation(.snappy(duration: 0.45), value: f)
        .accessibilityHidden(true)
    }

    static func couleur(_ n: JaugeContexte.Niveau) -> Color {
        switch n {
        case .calme: return Palette.encre2
        case .attention: return Palette.signal
        case .plein: return Palette.danger
        }
    }
}

/// Le bouton de l'en-tête : le cadran, et le pourcentage dans l'ouverture.
struct BoutonJauge: View {
    let jauge: JaugeContexte
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            CadranJauge(fraction: jauge.fraction, niveau: jauge.niveau, diametre: 26)
                .offset(y: -2)
                .overlay(alignment: .bottom) {
                    Text(Self.court(jauge))
                        .font(Police.mono(9, .semibold))
                        .foregroundStyle(jauge.niveau == .calme ? Palette.encre2 : CadranJauge.couleur(jauge.niveau))
                        .monospacedDigit()
                        .fixedSize()
                        .offset(y: 5)
                }
                .frame(width: 44, height: 44)
                .background(Palette.surface, in: Circle())
                .overlay(Circle().strokeBorder(Palette.filet, lineWidth: 1))
        }
        .buttonStyle(Appui())
        .accessibilityLabel("Contexte de la conversation")
        .accessibilityValue(Self.lu(jauge))
        .accessibilityHint("Montre la place prise et la vitesse de Rémy")
    }

    /// « 34 », « 44k », « – »
    static func court(_ j: JaugeContexte) -> String {
        if let f = j.fraction { return "\(Int((f * 100).rounded()))" }
        if let c = j.contexte { return c < 1000 ? "\(c)" : "\(Int((Double(c) / 1000).rounded()))k" }
        return "–"
    }

    static func lu(_ j: JaugeContexte) -> String {
        if let f = j.fraction { return "\(JaugeContexte.pourcent(f)) utilisés" }
        if let c = j.contexte { return "\(JaugeContexte.jetons(c)) jetons utilisés" }
        return "pas encore mesuré"
    }
}

/// Le détail : place prise, d'où elle vient, vitesse de la dernière réponse et
/// moyenne du fil.
struct ContexteVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer

    var body: some View {
        let j = app.chat.jauge
        let direct = app.chat.lignes.last(where: { !$0.deToi && $0.enCours })?.debit
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    place(j)
                    if j.modele != nil || j.machine != nil { quiARepondu(j) }
                    if let r = j.repartition { repartition(r, j) }
                    vitesse(j, direct: direct)
                    note(j)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .background(Palette.fond)
            .navigationTitle("Contexte")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("OK") { fermer() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: Place prise

    @ViewBuilder
    private func place(_ j: JaugeContexte) -> some View {
        HStack(alignment: .center, spacing: 18) {
            CadranJauge(fraction: j.fraction, niveau: j.niveau, diametre: 96, aiguille: false)
                .overlay {
                    Text(j.fraction.map(JaugeContexte.pourcent) ?? "–")
                        .font(Police.mono(20, .semibold))
                        .foregroundStyle(Palette.encre)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                }
            VStack(alignment: .leading, spacing: 4) {
                if let c = j.contexte {
                    Text("\(JaugeContexte.jetons(c)) jetons")
                        .font(Police.titre(24))
                        .foregroundStyle(Palette.encre)
                    Text(j.fenetre.map { "sur \(JaugeContexte.jetons($0)) que Rémy peut avoir en tête" } ?? "taille maximale inconnue")
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("Pas encore mesuré")
                        .font(Police.titre(22))
                        .foregroundStyle(Palette.encre)
                    Text(app.chat.envoi ? "La mesure arrive à la fin de la réponse de Rémy."
                         : j.machine?.contains("Anthropic") == true ? "Cette réponse vient de Claude : la place n'est mesurée que sur le modèle local."
                         : "La mesure arrive avec la prochaine réponse de Rémy dans ce fil.")
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .accessibilityElement(children: .combine)
        if j.niveau != .calme {
            VStack(alignment: .leading, spacing: 10) {
                Text(j.niveau == .plein
                     ? "Presque plein : une nouvelle conversation gardera des réponses rapides et justes."
                     : "Ça se remplit : au-delà de 90 %, mieux vaut repartir d'une conversation neuve.")
                    .font(Police.texte(14))
                    .foregroundStyle(Palette.encre)
                    .fixedSize(horizontal: false, vertical: true)
                BoutonA(titre: "Nouvelle conversation", symbole: "square.and.pencil", principal: j.niveau == .plein, hauteur: 44) {
                    Haptique.leger()
                    app.chat.nouvelle()
                    fermer()
                }
                .disabled(app.chat.envoi)
            }
        }
    }

    // MARK: Qui a répondu (19/10 : le modèle, et sur quelle machine)

    private func quiARepondu(_ j: JaugeContexte) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Etiquette("Dernière réponse écrite par")
            if let m = j.modele { info("Modèle", m) }
            if let m = j.machine { info("Machine", m) }
        }
    }

    private func info(_ titre: String, _ valeur: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(titre).font(Police.texte(15, .medium)).foregroundStyle(Palette.encre)
            Spacer(minLength: 6)
            Text(valeur)
                .font(Police.mono(14))
                .foregroundStyle(Palette.encre)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(minHeight: 24)
        .accessibilityElement(children: .combine)
    }

    // MARK: D'où vient la place

    private func repartition(_ r: RepartitionContexte, _ j: JaugeContexte) -> some View {
        let blocs: [(String, Int, Color)] = [
            ("Mémoire, planning, agenda", r.systeme, Palette.encre),
            ("Conversation", r.conversation + r.reponse, Palette.signal),
            ("Outils lus (Motion, pages…)", r.outils, Palette.encre3),
        ]
        let occupe = max(1, r.systeme + r.conversation + r.reponse + r.outils)
        let total = max(occupe, j.fenetre ?? occupe)
        return VStack(alignment: .leading, spacing: 10) {
            Etiquette("D'où vient la place")
            GeometryReader { g in
                HStack(spacing: 2) {
                    ForEach(Array(blocs.enumerated()), id: \.offset) { _, b in
                        if b.1 > 0 {
                            Rectangle().fill(b.2)
                                .frame(width: max(3, g.size.width * CGFloat(b.1) / CGFloat(total)))
                        }
                    }
                    Spacer(minLength: 0)
                }
                .frame(height: 10)
                .background(Palette.fond2)
                .clipShape(Capsule())
            }
            .frame(height: 10)
            .accessibilityHidden(true)
            ForEach(Array(blocs.enumerated()), id: \.offset) { _, b in
                HStack(spacing: 10) {
                    Circle().fill(b.2).frame(width: 8, height: 8)
                    Text(b.0).font(Police.texte(14)).foregroundStyle(Palette.encre2)
                    Spacer(minLength: 6)
                    Text("≈ \(JaugeContexte.jetons(b.1))")
                        .font(Police.mono(13))
                        .foregroundStyle(Palette.encre)
                        .monospacedDigit()
                }
                .frame(minHeight: 24)
                .accessibilityElement(children: .combine)
            }
            if let f = j.fenetre, f > occupe {
                HStack(spacing: 10) {
                    Circle().strokeBorder(Palette.encre3, lineWidth: 1).frame(width: 8, height: 8)
                    Text("Libre").font(Police.texte(14)).foregroundStyle(Palette.encre2)
                    Spacer(minLength: 6)
                    Text(JaugeContexte.jetons(f - occupe))
                        .font(Police.mono(13))
                        .foregroundStyle(Palette.encre)
                        .monospacedDigit()
                }
                .frame(minHeight: 24)
                .accessibilityElement(children: .combine)
            }
        }
    }

    // MARK: Vitesse

    private func vitesse(_ j: JaugeContexte, direct: Double?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Etiquette("Vitesse de Rémy")
            if let d = direct {
                ligne("En ce moment", JaugeContexte.tps(d), detail: "réponse en cours", vif: true)
            }
            if let d = j.derniere {
                ligne("Dernière réponse", JaugeContexte.tps(d.tps), detail: Self.detail(d))
            }
            if let m = j.moyenne, j.reponsesMesurees > 1 {
                ligne("Moyenne du fil", JaugeContexte.tps(m.tps),
                      detail: "sur \(j.reponsesMesurees) réponses · \(JaugeContexte.jetons(m.jetons)) jetons"
                        + (m.premier.map { " · premier mot après \(JaugeContexte.secondes($0)) en moyenne" } ?? ""))
            }
            if j.derniere == nil && direct == nil {
                Text("Pas encore de vitesse mesurée dans ce fil.")
                    .font(Police.texte(14))
                    .foregroundStyle(Palette.encre2)
            }
        }
    }

    private func ligne(_ titre: String, _ valeur: String, detail: String, vif: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(titre).font(Police.texte(15, .medium)).foregroundStyle(Palette.encre)
                Spacer(minLength: 6)
                Text(valeur)
                    .font(Police.mono(17, .semibold))
                    .foregroundStyle(vif ? Palette.signal : Palette.encre)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.easeOut(duration: 0.25), value: valeur)
            }
            Text(detail)
                .font(Police.texte(13))
                .foregroundStyle(Palette.encre2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    /// « 1 830 jetons en 43 s · premier mot après 2,1 s »
    static func detail(_ d: JaugeContexte.Debit) -> String {
        let n = d.jetons.formatted(.number.locale(Locale(identifier: "fr_FR")))
        var s = "\(n) jetons en \(JaugeContexte.secondes(d.secondes))"
        if let p = d.premier { s += " · premier mot après \(JaugeContexte.secondes(p))" }
        if d.estime { s += " · estimé" }
        return s
    }

    // MARK: Ce que veulent dire ces chiffres

    private func note(_ j: JaugeContexte) -> some View {
        var lignes = ["Mesuré sur la tour, par le modèle lui-même. La vitesse compte la réflexion de Rémy ; ni la lecture du contexte, ni le temps des outils."]
        if j.contexte != nil && j.fenetre == nil {
            lignes.append("Le modèle ne déclare pas sa taille maximale : elle se règle sur la tour (REMY_GLM_CONTEXTE).")
        } else if j.fenetreReglee {
            lignes.append("Taille maximale réglée sur la tour.")
        }
        return Text(lignes.joined(separator: "\n"))
            .font(Police.texte(12))
            .foregroundStyle(Palette.encre3)
            .fixedSize(horizontal: false, vertical: true)
    }
}
