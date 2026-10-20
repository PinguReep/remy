import SwiftUI
import UIKit
import RemyCore

/// L'onglet Rémy : une conversation, et rien d'autre. La liste des fils est
/// dans une feuille ; « Nouvelle » vide l'écran sans rien créer.
struct RemyView: View {
    @Environment(AppModel.self) private var app
    @State private var listeOuverte = false
    /// Le clavier est sur le composeur (champ UIKit : voir ChampTexte).
    @State private var clavier = false

    var body: some View {
        let chat = app.chat
        VStack(spacing: 0) {
            EnTeteRemy(listeOuverte: $listeOuverte)
            BandeauSession()
            if chat.lignes.isEmpty && chat.ouverture {
                Squelette(largeurs: [0.6, 0.9, 0.75]).padding(18)
                Spacer()
            } else if chat.lignes.isEmpty {
                AccueilRemy(clavier: $clavier)
            } else {
                Fil(clavier: $clavier)
            }
            if let o = chat.origine {
                BandeauImporte(origine: o)
            } else {
                Composeur(clavier: $clavier)
            }
        }
        .background(Palette.fond)
        .sheet(isPresented: $listeOuverte) { ConversationsView() }
        // Le mode appel occupe tout l'écran tant qu'il est décroché.
        .fullScreenCover(isPresented: Binding(get: { app.appel.actif }, set: { if !$0 { app.appel.raccrocher() } })) {
            AppelView()
        }
        .onChange(of: chat.focusDemande) { _, demande in
            guard demande else { return }
            clavier = true
            chat.focusDemande = false
        }
        .task { await demo() }
    }

    /// Captures de la CI : l'historique avec une réponse non vue (le fil de la
    /// nuit) ; la mesure de la frappe dans le vrai écran (« perf-remy »).
    /// Inactif sans les variables de démonstration.
    private func demo() async {
        let env = ProcessInfo.processInfo.environment
        if env["REMY_DEMO_MDP"] != nil, env["REMY_DEMO_ECRAN"] == "perf-remy" {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            await app.ouvrirConversation("c9")
            app.onglet = .remy
            app.chat.brouillon = MesureSaisie.dictee
            try? await Task.sleep(nanoseconds: 800_000_000)
            clavier = true
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            let avant = app.chat.brouillon.count
            var m = await Frappe().mesurer(lettres: 90)
            m.arrivees = app.chat.brouillon.count - avant
            let champ = "ChampTexte UIKit"
            MesureSaisie.noter("PERF-SAISIE vrai écran, fil de \(app.chat.lignes.count) messages, \(champ) : \(m.texte)")
            app.dire("\(champ) · \(m.texte)")
            return
        }
        guard env["REMY_DEMO_MDP"] != nil, env["REMY_DEMO_ECRAN"] == "conversations" else { return }
        try? await Task.sleep(nanoseconds: 3_000_000_000)
        await app.chat.rafraichirListe()
        app.chat.marquerNonLu("c2")
        listeOuverte = true
    }
}

private struct EnTeteRemy: View {
    @Environment(AppModel.self) private var app
    @Binding var listeOuverte: Bool
    @State private var jaugeOuverte = false

    var body: some View {
        let chat = app.chat
        let titre = chat.idCourant == nil ? "Nouvelle conversation" : chat.titre
        HStack(spacing: 10) {
            MarqueRemy(taille: 34)
            VStack(alignment: .leading, spacing: 1) {
                Text("Rémy").font(Police.titre(22)).foregroundStyle(Palette.encre)
                Text(titre)
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .lineLimit(1)
                    .accessibilityLabel("Conversation : \(titre)")
            }
            Spacer(minLength: 6)
            // Le compteur du contexte (Sam, 19/10) : seulement dans un fil de
            // Rémy, face à une tour qui sait mesurer.
            if chat.jaugeDisponible, chat.origine == nil, !chat.lignes.isEmpty {
                BoutonJauge(jauge: chat.jauge) {
                    Haptique.leger()
                    jaugeOuverte = true
                }
            }
            // Une réponse que Sam n'a pas vue : pastille rouge (Sam, 18/10).
            BoutonRond(symbole: "text.bubble", libelle: "Conversations", pastille: chat.nombreNonLus, pastilleRouge: true) {
                Haptique.leger()
                listeOuverte = true
            }
            // Parler à Rémy à voix haute, comme au téléphone.
            BoutonRond(symbole: "phone", libelle: "Appeler Rémy") {
                Haptique.leger()
                app.appel.decrocher()
            }
            .disabled(chat.origine != nil)
            BoutonRond(symbole: "square.and.pencil", libelle: "Nouvelle conversation") {
                Haptique.leger()
                chat.nouvelle()
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 10)
        .overlay(alignment: .bottom) { Filet() }
        .sheet(isPresented: $jaugeOuverte) { ContexteVue() }
        .task {
            // Captures de la CI : un fil mesuré, et le détail de la jauge.
            let env = ProcessInfo.processInfo.environment
            if env["REMY_DEMO_MDP"] != nil, env["REMY_DEMO_ECRAN"] == "erreur" {
                // Une réponse en échec : le message, son code, de quoi le transmettre.
                try? await Task.sleep(nanoseconds: 3_500_000_000)
                app.chat.montrerPourCapture(LigneChat(deToi: true, texte: "Voilà tout ce que j'ai en tête pour la semaine, dans l'ordre…"))
                var l = LigneChat(deToi: false, texte: "",
                                  erreur: "Rémy a travaillé plus de 6 minutes sans finir sa réponse : la demande est sans doute très longue ou très ouverte. Le modèle local tourne bien. Réessaie, ou découpe-la en deux ou trois messages.",
                                  question: "semaine")
                l.codeErreur = "R-7KQ2M"
                app.chat.montrerPourCapture(l)
                return
            }
            if env["REMY_DEMO_MDP"] != nil, env["REMY_DEMO_ECRAN"] == "regle" {
                // Une règle de Rémy proposée dans le chat, avant validation.
                try? await Task.sleep(nanoseconds: 3_500_000_000)
                app.chat.montrerPourCapture(LigneChat(deToi: true, texte: "Avant chaque sortie, rappelle-moi de me raser."))
                let a = ActionProposee(type: "regle", nom: "Rasage avant une sortie",
                                       description: "Avant un événement « sortie », « soirée », « resto », « verre » : « Rasage » (15 min), au plus tard 3 h avant.")
                app.chat.montrerPourCapture(LigneChat(deToi: false, texte: "Motion ne sait pas le faire, mais moi si : je te propose cette règle. Avant chaque sortie de ton agenda, je te proposerai le rasage.",
                                                      proposition: Proposition(id: "p-demo", source: "regle", resume: nil, actions: [a], statut: "en_attente")))
                return
            }
            guard env["REMY_DEMO_MDP"] != nil, env["REMY_DEMO_ECRAN"] == "jauge" else { return }
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            let reponses: [(String, String, MesuresReponse)] = [
                ("On reprend le budget de la boutique ?", "Oui : le poste qui bouge le plus, ce sont les frais de port.",
                 MesuresReponse(jetons: 640, tps: 46.2, decodeMs: 13_850, premierMs: 1900, contexte: 31_400, fenetre: 131_072, fenetreSource: "modele")),
                ("Et si je passe à la livraison en point relais ?", "Tu gagnes environ 1,80 € par colis, au prix d'un jour de délai.",
                 MesuresReponse(jetons: 1830, tps: 41.6, decodeMs: 44_000, premierMs: 2600, contexte: 44_230,
                                repartition: RepartitionContexte(systeme: 30_900, conversation: 9_800, outils: 1_700, reponse: 1_830),
                                fenetre: 131_072, fenetreSource: "modele", modele: "GLM-5.3-Flash-EXL3", machine: "DGX Spark")),
            ]
            for (question, reponse, m) in reponses {
                app.chat.montrerPourCapture(LigneChat(deToi: true, texte: question))
                app.chat.montrerPourCapture(LigneChat(deToi: false, texte: reponse, mesures: m))
            }
            jaugeOuverte = true
        }
    }
}

/// Le fil porte une étape « Faire connaissance » : ce qu'il reste à couvrir.
private struct BandeauSession: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if let id = app.chat.sessionCourante,
           let e = app.tableau.donnees?.setup,
           let s = e.sessions?.first(where: { $0.id == id }) {
            let reste = Onboarding.reste(s, e)
            VStack(alignment: .leading, spacing: 3) {
                Text("Faire connaissance · \(s.title)")
                    .font(Police.texte(14, .semibold))
                    .foregroundStyle(Palette.encre)
                Text(reste.isEmpty ? "Tout est couvert : Rémy peut clore l'étape."
                                   : "Il reste : " + reste.map(\.label).joined(separator: " · "))
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(.horizontal, 16)
            .padding(.top, 10)
        }
    }
}

/// Écran vide : ce que Rémy sait faire, en boutons.
private struct AccueilRemy: View {
    @Environment(AppModel.self) private var app
    @Binding var clavier: Bool

    var body: some View {
        let chat = app.chat
        let derniere = chat.conversations
            .filter { $0.origine == nil }
            .max { ($0.updatedAt ?? 0) < ($1.updatedAt ?? 0) }
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 12) {
                    MarqueRemy(taille: 44)
                    Text("Qu'est-ce qu'on règle ?")
                        .font(Police.titre(28))
                        .foregroundStyle(Palette.encre)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(chat.conversations.isEmpty && chat.erreurListe == nil
                         ? "Je suis Rémy, ton directeur de cabinet. Je vois ton agenda et tes tâches, et je t'aide à t'organiser. Écris-moi comme à quelqu'un."
                         : "Un conseil, un arbitrage, un changement de planning. Je dis toujours ce que je modifie, et tu gardes le dernier mot.")
                        .font(Police.texte(15))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(spacing: 10) {
                    suggestion("Organiser ma journée", symbole: "sun.max") {
                        Task { await app.organiserJournee() }
                    }
                    suggestion("Qu'est-ce qui est en retard ?", symbole: "clock.badge.exclamationmark") {
                        Task { await chat.envoyer(Brouillons.retards) }
                    }
                    .disabled(chat.envoi)
                    suggestion("Noter une idée", symbole: "lightbulb") {
                        chat.modeRetenir = true
                        clavier = true
                    }
                }
                if let d = derniere {
                    Button {
                        Haptique.leger()
                        Task { await app.ouvrirConversation(d.id) }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "clock.arrow.circlepath").font(.system(size: 13))
                            Text("Reprendre « \(d.title) »").font(Police.texte(14)).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .foregroundStyle(Palette.encre2)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 28)
            .padding(.bottom, 20)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
    }

    private func suggestion(_ titre: String, symbole: String, _ faire: @escaping () -> Void) -> some View {
        Button {
            Haptique.leger()
            faire()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: symbole)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.signal)
                    .frame(width: 22)
                Text(titre).font(Police.texte(15, .medium)).foregroundStyle(Palette.encre).multilineTextAlignment(.leading)
                Spacer(minLength: 6)
                Image(systemName: "arrow.up.left").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.encre3)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.filet, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(Appui())
    }
}

// MARK: - Le fil

/// Où se trouve la fin du fil dans la zone visible (pour savoir si Sam lit
/// plus haut).
private struct FinDuFil: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct Fil: View {
    @Environment(AppModel.self) private var app
    @Binding var clavier: Bool
    /// Sam est en bas du fil : la réponse qui s'écrit le suit. S'il remonte
    /// lire (Sam, 09/10 : impossible pendant une réponse, l'écran revenait en
    /// bas à chaque mot), on le laisse lire jusqu'à ce qu'il redescende.
    @State private var suitLaFin = true
    /// Sam fait défiler (doigt posé ou élan) : rien ne le ramène en bas.
    @State private var defile = false
    @State private var finY: CGFloat = 0
    @State private var hauteurFil: CGFloat = 0

    var body: some View {
        let chat = app.chat
        ScrollViewReader { proxy in
            ScrollView {
                // VStack et non LazyVStack : une pile paresseuse estime la
                // hauteur des messages pas encore dessinés, et « aller en bas »
                // dépassait la fin (vide sous iOS 26).
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(chat.lignes) { l in
                        // Ce qui précède arrive résumé au modèle (compactage, 19/10).
                        if let c = chat.compactage, c.jusqua > 0, l.indexMessage == c.jusqua {
                            RepereResume(compactage: c)
                        }
                        LigneMessage(ligne: l).id(l.id)
                    }
                    Color.clear.frame(height: 8).id("fin")
                        .background(GeometryReader { g in
                            Color.clear.preference(key: FinDuFil.self, value: g.frame(in: .named("fil")).minY)
                        })
                }
                .padding(.horizontal, 18)
                .padding(.top, 20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            // Sam (09/10) : toucher les messages, ou les faire défiler, range
            // le clavier. Le toucher est « simultané » : boutons, liens et menus
            // des messages continuent de répondre.
            .scrollDismissesKeyboard(.immediately)
            .simultaneousGesture(TapGesture().onEnded { clavier = false })
            // iOS 18+ : l'ancre du bas ne vaut qu'à l'ouverture. Sur « toutes
            // les tailles », chaque mot ajouté ramenait le fil en bas même quand
            // Sam était remonté lire (19/10).
            .modifier(SuiviDuFil(defile: $defile) {
                suitLaFin = finY <= hauteurFil + 60
            })
            .coordinateSpace(name: "fil")
            .background(GeometryReader { zone in
                Color.clear.onPreferenceChange(FinDuFil.self) { y in
                    finY = y
                    hauteurFil = zone.size.height
                    // La fin est visible (à 120 pt près) : on suit la réponse.
                    // Pendant que Sam fait défiler, on ne décide rien.
                    if !defile { suitLaFin = y <= zone.size.height + 120 }
                }
            })
            .onChange(of: chat.lignes.last?.texte) { _, _ in
                if suitLaFin, !defile { proxy.scrollTo("fin", anchor: .bottom) }
            }
            .onChange(of: chat.lignes.count) { _, _ in
                // Un message que Sam vient d'envoyer : on y va, où qu'il soit.
                if chat.lignes.last?.deToi == true || chat.lignes.dropLast().last?.deToi == true { suitLaFin = true }
                if suitLaFin { withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("fin", anchor: .bottom) } }
            }
            .onChange(of: chat.idCourant) { _, _ in
                suitLaFin = true
                proxy.scrollTo("fin", anchor: .bottom)
            }
            .onAppear { proxy.scrollTo("fin", anchor: .bottom) }
        }
    }
}

/// Le fil s'ouvre en bas ; ensuite, seule la décision « suivre la fin »
/// le fait descendre. Le doigt de Sam l'emporte toujours sur la réponse qui s'écrit.
private struct SuiviDuFil: ViewModifier {
    @Binding var defile: Bool
    /// Sam a lâché le fil : est-il revenu en bas ?
    let arrete: () -> Void

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content
                .defaultScrollAnchor(.bottom, for: .initialOffset)
                .onScrollPhaseChange { _, phase in
                    let parSam = phase == .tracking || phase == .interacting || phase == .decelerating
                    if defile, !parSam { arrete() }
                    defile = parSam
                }
        } else {
            content.defaultScrollAnchor(.bottom)
        }
    }
}

private struct LigneMessage: View {
    @Environment(AppModel.self) private var app
    let ligne: LigneChat
    /// « Sélectionner le texte » (19/10) : une partie du message, pas tout.
    @State private var aSelectionner: TexteASelectionner?

    var body: some View {
        contenu
            .sheet(item: $aSelectionner) { SelectionTexteVue(texte: $0.texte) }
    }

    @ViewBuilder
    private var contenu: some View {
        if ligne.deToi {
            HStack {
                Spacer(minLength: 48)
                Text(ligne.texte)
                    .font(Police.texte(16))
                    .lineSpacing(2)
                    .foregroundStyle(Palette.fond)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 11)
                    .background(Palette.encre, in: UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 20,
                                                                          bottomTrailingRadius: 6, topTrailingRadius: 20, style: .continuous))
                    .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .contextMenu { ActionsTexte(texte: ligne.texte, aSelectionner: $aSelectionner) }
            }
            .padding(.bottom, 22)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                // Seuls les fils importés disent qui parle : Rémy ne doit pas
                // endosser ce que ChatGPT a dit.
                if ligne.auteur != "Rémy" {
                    Etiquette(ligne.auteur, couleur: Palette.encre2, graisse: .semibold)
                }
                if ligne.texte.isEmpty && ligne.enCours {
                    Curseur()
                } else if !ligne.texte.isEmpty {
                    TexteRemy(texte: ligne.texte)
                        .contentShape(Rectangle())
                        .contextMenu { ActionsTexte(texte: Markdown.enClair(ligne.texte), aSelectionner: $aSelectionner) }
                }
                if !ligne.etapes.isEmpty, ligne.enCours || app.chat.lignes.last?.id == ligne.id {
                    // Ce que fait Rémy (19/10) ; la dernière réponse garde son
                    // résumé pour savoir pourquoi elle a pris du temps.
                    BarreEtapes(ligne: ligne)
                } else if let s = ligne.statut {
                    HStack(spacing: 8) {
                        Curseur(taille: 7)
                        Text(s).font(Police.texte(14)).foregroundStyle(Palette.encre2)
                    }
                }
                if ligne.secours && !ligne.enCours {
                    Text("Réponse de secours : le modèle habituel n'a pas répondu.")
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre3)
                }
                if let e = ligne.erreur {
                    // Copiable (19/10) : le message, et le code de la tour à transmettre.
                    let copie = ligne.codeErreur.map { "\(e) (code \($0))" } ?? e
                    Text(e)
                        .font(Police.texte(15))
                        .foregroundStyle(Palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .contentShape(Rectangle())
                        .contextMenu {
                            ActionsTexte(texte: copie, aSelectionner: $aSelectionner)
                            if let c = ligne.codeErreur {
                                Button { Task { await copierDiagnostic(c, message: e) } } label: {
                                    Label("Copier le diagnostic", systemImage: "stethoscope")
                                }
                            }
                        }
                    if let c = ligne.codeErreur {
                        HStack(spacing: 12) {
                            Text("Code \(c)")
                                .font(Police.mono(13, .medium))
                                .foregroundStyle(Palette.encre2)
                                .textSelection(.enabled)
                            BoutonTexte("Copier le diagnostic") { Task { await copierDiagnostic(c, message: e) } }
                        }
                        .accessibilityElement(children: .contain)
                    }
                    if ligne.question != nil {
                        BoutonA(titre: "Réessayer", symbole: "arrow.clockwise", principal: false, hauteur: 44) { Task { await app.chat.reessayer(ligne) } }
                            .frame(width: 150)
                            .disabled(app.chat.envoi)
                    }
                }
                if let p = ligne.proposition {
                    // Une règle de Rémy (19/10) n'est pas une tâche : sa propre carte.
                    if p.source == "regle" { CarteRegle(ligne: ligne, p: p) } else { PropositionView(ligne: ligne, p: p) }
                }
                if let a = ligne.autorisation { AutorisationView(ligne: ligne, a: a) }
            }
            .padding(.bottom, 30)
        }
    }

    /// Ce que la tour sait de l'erreur (jamais le contenu des messages), prêt à
    /// coller ; tour injoignable : au moins le message et son code.
    private func copierDiagnostic(_ code: String, message: String) async {
        if let d = await app.chat.diagnostic(code) {
            UIPasteboard.general.string = d
            Haptique.succes()
            app.dire("Diagnostic \(code) copié : colle-le où tu veux.")
        } else {
            UIPasteboard.general.string = "\(message) (code \(code))"
            Haptique.leger()
            app.dire("Tour injoignable : le code est copié, sans le détail.")
        }
    }
}

/// La petite barre sous la réponse : l'étape en cours et le chrono ; un appui
/// déroule les étapes, leur durée et un extrait de la réflexion. Le texte ne
/// change qu'au rythme des étapes (la réflexion, toutes les 1,5 s au plus) :
/// lisible à l'œil nu.
struct BarreEtapes: View {
    let ligne: LigneChat
    // Ouverte d'office pour la capture de la CI seulement.
    @State private var ouverte = ProcessInfo.processInfo.environment["REMY_DEMO_ECRAN"] == "etapes"

    var body: some View {
        let etapes = ligne.etapes
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Haptique.leger()
                withAnimation(.snappy(duration: 0.25)) { ouverte.toggle() }
            } label: {
                HStack(spacing: 8) {
                    if ligne.enCours {
                        Curseur(taille: 7)
                    } else {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Palette.encre3)
                    }
                    Image(systemName: Self.icone(ligne.enCours ? etapes.last?.cle : nil))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Palette.encre2)
                        .frame(width: 18)
                    Text(ligne.enCours ? (etapes.last?.texte ?? "") : "Réponse en \(Self.duree(total(etapes)))" + vitesseFinale)
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.encre2)
                        .lineLimit(1)
                        .contentTransition(.opacity)
                        .animation(.easeOut(duration: 0.2), value: etapes.last?.texte)
                    Spacer(minLength: 4)
                    // La vitesse d'écriture en direct (jauge-v1), une fois par seconde.
                    if ligne.enCours, let d = ligne.debit {
                        Text(JaugeContexte.tps(d))
                            .font(Police.mono(13, .medium))
                            .foregroundStyle(Palette.encre2)
                            .monospacedDigit()
                            .lineLimit(1)
                            .fixedSize()
                            .contentTransition(.numericText())
                            .animation(.easeOut(duration: 0.25), value: d)
                            .accessibilityLabel("\(Int(d.rounded())) tokens par seconde")
                    }
                    if ligne.enCours, let debut = ligne.debutEtapes {
                        TimelineView(.periodic(from: debut, by: 1)) { ctx in
                            Text("\(max(0, Int(ctx.date.timeIntervalSince(debut)))) s")
                                .font(Police.mono(13, .medium))
                                .foregroundStyle(Palette.encre3)
                                .monospacedDigit()
                        }
                    }
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Palette.encre3)
                        .rotationEffect(.degrees(ouverte ? 180 : 0))
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 34)
                .background(Palette.fond2, in: Capsule())
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ligne.enCours
                ? (etapes.last?.texte ?? "Rémy travaille") + (ligne.debit.map { ", \(Int($0.rounded())) tokens par seconde" } ?? "")
                : "Réponse en \(Self.duree(total(etapes)))" + vitesseFinale)
            .accessibilityHint(ouverte ? "Masque les étapes" : "Montre ce que Rémy a fait")
            if ouverte {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(etapes.enumerated()), id: \.element.id) { i, e in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 8) {
                                Image(systemName: Self.icone(e.cle))
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Palette.encre3)
                                    .frame(width: 18)
                                Text(e.texte)
                                    .font(Police.texte(13))
                                    .foregroundStyle(Palette.encre2)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 4)
                                Text(dureeEtape(i))
                                    .font(Police.mono(12))
                                    .foregroundStyle(Palette.encre3)
                                    .monospacedDigit()
                            }
                            if let d = e.detail, !d.isEmpty {
                                Text("« \(d) »")
                                    .font(Police.texte(12).italic())
                                    .foregroundStyle(Palette.encre3)
                                    .lineLimit(3)
                                    .padding(.leading, 26)
                                    .contentTransition(.opacity)
                                    .animation(.easeOut(duration: 0.2), value: d)
                            }
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Palette.fond2.opacity(0.6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    /// « · 42 tok/s » après la durée, une fois la réponse mesurée.
    private var vitesseFinale: String {
        guard let t = ligne.mesures?.tps, t > 0 else { return "" }
        return " · " + JaugeContexte.tps(t)
    }

    /// Durée totale de la réponse (iPhone), ou à défaut la dernière étape (tour).
    private func total(_ etapes: [EtapeReponse]) -> Int {
        if let d = ligne.debutEtapes, let f = ligne.finEtapes { return Int(f.timeIntervalSince(d) * 1000) }
        return etapes.last?.t ?? 0
    }

    private func dureeEtape(_ i: Int) -> String {
        if let ms = ligne.etapes.duree(de: i) { return Self.duree(ms) }
        if ligne.enCours { return "en cours" }
        guard let d = ligne.debutEtapes, let f = ligne.finEtapes else { return "" }
        return Self.duree(max(0, Int(f.timeIntervalSince(d) * 1000) - ligne.etapes[i].t))
    }

    /// « 0,4 s », « 12 s », « 1 min 05 »
    static func duree(_ ms: Int) -> String {
        if ms < 10_000 { return String(format: "%.1f s", Double(ms) / 1000).replacingOccurrences(of: ".", with: ",") }
        let s = ms / 1000
        return s < 60 ? "\(s) s" : String(format: "%d min %02d", s / 60, s % 60)
    }

    static func icone(_ cle: String?) -> String {
        switch cle {
        case "contexte": return "tray.full"
        case "choix": return "arrow.triangle.branch"
        case "modele": return "cpu"
        case "reflexion": return "brain"
        case "motion": return "list.bullet.rectangle"
        case "web": return "globe"
        case "navigateur": return "safari"
        case "proposition": return "calendar.badge.plus"
        case "budget": return "hourglass"
        case "secours": return "exclamationmark.triangle"
        case "ecrit": return "pencil"
        case nil: return "clock"
        default: return "circle.dotted"
        }
    }
}

private struct BoutonCopier: View {
    let texte: String
    var body: some View {
        Button {
            UIPasteboard.general.string = texte
            Haptique.leger()
        } label: {
            Label("Copier", systemImage: "doc.on.doc")
        }
    }
}

/// Rémy écrit : un bloc orange qui clignote (fixe si « Réduire les animations »).
struct Curseur: View {
    var taille: CGFloat = 9
    @Environment(\.accessibilityReduceMotion) private var reduire

    var body: some View {
        let bloc = Rectangle().fill(Palette.signal).frame(width: taille, height: taille == 9 ? 18 : taille)
        Group {
            if reduire {
                bloc
            } else {
                TimelineView(.periodic(from: .now, by: 0.5)) { ctx in
                    bloc.opacity(Int(ctx.date.timeIntervalSince1970 * 2) % 2 == 0 ? 1 : 0)
                }
            }
        }
        .accessibilityLabel("Rémy écrit")
    }
}

/// Le texte de Rémy : titres, listes, code ; gras et liens rendus par le système.
struct TexteRemy: View {
    let texte: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(Markdown.blocs(texte).enumerated()), id: \.offset) { _, bloc in
                switch bloc {
                case .titre(let t):
                    Text(t).font(Police.texte(17, .bold)).foregroundStyle(Palette.encre).padding(.top, 8)
                case .paragraphe(let t):
                    enLigne(t)
                case .puce(let t):
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Circle().fill(Palette.signal).frame(width: 6, height: 6).alignmentGuide(.firstTextBaseline) { d in d[.bottom] + 5 }
                        enLigne(t)
                    }
                case .numero(let n, let t):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("\(n).").font(Police.mono(14)).foregroundStyle(Palette.encre2)
                        enLigne(t)
                    }
                case .code(let c):
                    Text(c)
                        .font(Police.mono(13))
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                case .tableau(let entetes, let lignes):
                    TableauRemy(entetes: entetes, lignes: lignes)
                case .trait:
                    Rectangle().fill(Palette.filet).frame(height: 1).padding(.vertical, 6)
                case .espace:
                    Color.clear.frame(height: 6)
                }
            }
        }
    }

    private func enLigne(_ t: String) -> some View {
        let attr = (try? AttributedString(markdown: t, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(t)
        return Text(attr)
            .font(Police.texte(16))
            .lineSpacing(4)
            .foregroundStyle(Palette.encre)
            .tint(Palette.encre)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Un tableau de Rémy (19/10 : il s'affichait en lignes de « | »). En-têtes en
/// gras, lignes alternées ; trop large pour l'écran, il défile de côté sans
/// pousser la conversation.
struct TableauRemy: View {
    let entetes: [String]
    let lignes: [[String]]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(entetes.enumerated()), id: \.offset) { _, e in
                        cellule(e, gras: true)
                    }
                }
                .background(Palette.fond2)
                ForEach(Array(lignes.enumerated()), id: \.offset) { i, l in
                    Divider().overlay(Palette.filet).gridCellUnsizedAxes(.horizontal)
                    GridRow {
                        ForEach(Array(l.enumerated()), id: \.offset) { _, c in
                            cellule(c, gras: false)
                        }
                    }
                    .background(i % 2 == 1 ? Palette.fond2.opacity(0.45) : Color.clear)
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.filet, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .padding(.vertical, 4)
        .contextMenu { BoutonCopier(texte: texteBrut) }
    }

    private func cellule(_ t: String, gras: Bool) -> some View {
        let attr = (try? AttributedString(markdown: t, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(t)
        return Text(attr)
            .font(Police.texte(14, gras ? .semibold : .regular))
            .foregroundStyle(Palette.encre)
            .fixedSize(horizontal: false, vertical: true)
            .frame(minWidth: 64, maxWidth: 220, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
    }

    /// Pour « Copier » : le tableau en texte, une ligne par rangée.
    private var texteBrut: String {
        ([entetes] + lignes).map { $0.joined(separator: " | ") }.joined(separator: "\n")
    }
}

// MARK: - Proposition : Rémy propose, Sam décide

private struct PropositionView: View {
    @Environment(AppModel.self) private var app
    let ligne: LigneChat
    let p: Proposition
    @State private var enCours = false
    @State private var ajustement: DemandeAjustement?

    /// Sam peut régler une ligne (date, durée, catégorie, rappel) avant de dire oui.
    private var ajustable: Bool {
        p.ajustable && !p.echouee && !ligne.enCours && p.id != nil && app.chat.ajustementDisponible
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: symbole)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(couleur)
                Text(entete)
                    .font(Police.texte(15, .semibold))
                    .foregroundStyle(Palette.encre)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if p.ajustee == true && !p.appliquee && !p.convertie {
                    Text("ajustée par toi")
                        .font(Police.texte(12, .medium))
                        .foregroundStyle(Palette.encre2)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Palette.fond2, in: Capsule())
                        .fixedSize()
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
            .padding(.bottom, 4)
            if !p.appliquee, !p.convertie, let r = p.resume, !r.isEmpty {
                Text(r)
                    .font(Police.texte(15))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.top, 4)
            }
            ForEach(Array(p.actions.enumerated()), id: \.offset) { i, a in
                let ligneAction = LigneAction(action: a,
                                              versAgenda: p.versAgenda,
                                              erreur: erreurAffichee(a),
                                              barree: estDefaite(a),
                                              premiere: i == 0 && (p.appliquee || (p.resume ?? "").isEmpty),
                                              ajustable: ajustable && peutAjuster(a))
                if ajustable && peutAjuster(a) {
                    Button {
                        Haptique.leger()
                        ajustement = DemandeAjustement(ligne: ligne, rang: a.rang ?? i, action: a, versAgenda: p.versAgenda)
                    } label: { ligneAction.contentShape(Rectangle()) }
                    .buttonStyle(AppuiLigne())
                    .accessibilityHint("Régler la date, la durée ou la catégorie avant de dire oui")
                } else {
                    ligneAction
                }
            }
            if p.rangeesEnRappels > 0 && !p.convertie {
                Label(p.rangeesEnRappels > 1 ? "\(p.rangeesEnRappels) lignes rangées dans tes rappels" : "1 ligne rangée dans tes rappels",
                      systemImage: "bell")
                    .font(Police.texte(14))
                    .foregroundStyle(Palette.encre2)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .top) { if !p.actions.isEmpty { Filet() } }
            }
            pied
        }
        .sheet(item: $ajustement) { AjusterAction(demande: $0) }
        .task {
            // Captures de la CI : la feuille « Ajuster » sur la première ligne.
            let env = ProcessInfo.processInfo.environment
            guard env["REMY_DEMO_MDP"] != nil, ["ajuster", "ajuster-rappel"].contains(env["REMY_DEMO_ECRAN"] ?? ""),
                  ajustable, let a = p.actions.first, peutAjuster(a) else { return }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            ajustement = DemandeAjustement(ligne: ligne, rang: a.rang ?? 0, action: a, versAgenda: p.versAgenda)
        }
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(p.appliquee || p.convertie ? Palette.filet : Palette.signal.opacity(0.5), lineWidth: 1))
        .padding(.top, 12)
    }

    /// Une création ou une modification ; pas « Marquer fait » ni « Supprimer ».
    private func peutAjuster(_ a: ActionProposee) -> Bool { a.verbe == "creer" || a.verbe == "modifier" }

    private var symbole: String {
        if p.convertie { return "bell.fill" }
        if p.echouee || !(p.annulationRatee ?? []).isEmpty { return "exclamationmark.triangle.fill" }
        if !p.appliquee { return "sparkles" }
        if p.annulee == true { return "arrow.uturn.backward.circle.fill" }
        return p.nombreEchecs == 0 ? "checkmark.circle.fill" : "exclamationmark.circle.fill"
    }

    private var couleur: Color {
        if p.convertie { return Palette.encre2 }
        if p.echouee || !(p.annulationRatee ?? []).isEmpty { return Palette.danger }
        if !p.appliquee { return Palette.signal }
        return Palette.encre2
    }

    /// « Pas défait : … » après une annulation incomplète, sinon « Pas fait : … ».
    private func erreurAffichee(_ a: ActionProposee) -> String? {
        if let rate = p.echecAnnulation(pour: a) { return "Pas défait : " + (rate.erreur ?? "raison inconnue") }
        guard p.appliquee || p.echouee, p.annulee != true, let e = p.erreur(pour: a) else { return nil }
        return "Pas fait : " + e
    }

    /// L'action a bien été défaite (annulation totale, ou partielle sans elle).
    private func estDefaite(_ a: ActionProposee) -> Bool {
        if p.annulee == true { return true }
        guard let rates = p.annulationRatee, !rates.isEmpty else { return false }
        return p.echecAnnulation(pour: a) == nil
    }

    private var entete: String {
        if p.convertie { return "Rangé dans tes rappels" }
        if p.echouee {
            // La raison est sous chaque ligne quand elle est connue ligne par ligne.
            let parLigne = p.actions.contains { p.erreur(pour: $0) != nil }
            return parLigne ? "Rien n'a pu être fait" : "Pas fait : " + (p.raisonEchec ?? "raison inconnue")
        }
        if !p.appliquee { return p.versAgenda ? "Rémy propose de changer ton agenda" : "Rémy propose de changer ton planning" }
        if !(p.annulationRatee ?? []).isEmpty { return "Annulation incomplète" }
        if p.annulee == true { return "Annulé : tout est revenu comme avant." }
        let echecs = p.nombreEchecs
        if echecs == 0 { return p.versAgenda ? "C'est fait dans ton agenda" : "C'est fait dans ton planning" }
        return echecs >= p.actions.count ? "Rien n'a pu être fait" : "En partie fait"
    }

    @ViewBuilder
    private var pied: some View {
        if p.convertie {
            EmptyView()
        } else if !p.appliquee {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    BoutonA(titre: "Non merci", principal: false, hauteur: 46) { agir { await app.chat.ecarter(ligne) } }
                    BoutonA(titre: enCours ? "…" : p.echouee ? "Réessayer" : "Oui, fais-le", hauteur: 46) {
                        agir {
                            if await app.chat.appliquer(ligne) { Haptique.succes() }
                        }
                    }
                    // Tant que Rémy écrit, la proposition n'est pas enregistrée.
                    .disabled(ligne.enCours)
                }
                Text(ajustable ? "Touche une ligne pour régler la date, la durée ou la catégorie, ou en faire un rappel."
                               : "Pour changer un détail, réponds-le simplement à Rémy.")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .disabled(enCours)
            .padding(14)
            .overlay(alignment: .top) { Filet() }
        } else if !(p.annulationRatee ?? []).isEmpty {
            Text("Vérifie \(p.versAgenda ? "ton agenda" : "ton planning") : ce qui est marqué n'a pas pu être défait.")
                .font(Police.texte(14))
                .foregroundStyle(Palette.encre2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .top) { Filet() }
        } else if p.annulee != true, p.ledgerId != nil, p.nombreEchecs < p.actions.count {
            HStack(spacing: 8) {
                Text(ou)
                    .font(Police.texte(14))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                BoutonA(titre: enCours ? "…" : "Annuler", symbole: "arrow.uturn.backward", principal: false, hauteur: 44) {
                    agir { await app.chat.annuler(ligne) }
                }
                .frame(width: 130)
                .disabled(enCours)
            }
            .padding(14)
            .overlay(alignment: .top) { Filet() }
        }
    }

    private var ou: String {
        if p.versAgenda { return "Fait, dans ton agenda." }
        if let e = p.bilan?.espace { return "Fait, dans « \(e) »." }
        return "Fait, dans ton planning."
    }

    private func agir(_ f: @escaping () async -> Void) {
        guard !enCours else { return }
        enCours = true
        Task {
            await f()
            enCours = false
        }
    }
}

/// Une ligne touchable dans une carte : elle s'éclaire sous le doigt, sans bouger.
private struct AppuiLigne: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Palette.fond2 : .clear)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// « Chercher sur le web ? » (V8) : la recherche passe par Claude (Anthropic),
/// rien ne part sans ce tap. La carte dit ce qui partirait.
private struct AutorisationView: View {
    @Environment(AppModel.self) private var app
    let ligne: LigneChat
    let a: Autorisation

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "globe").font(.system(size: 14, weight: .semibold)).foregroundStyle(a.enAttente ? Palette.signal : Palette.encre2)
                Text(a.titre)
                    .font(Police.texte(15, .semibold))
                    .foregroundStyle(Palette.encre)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            if a.enAttente {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Partira : \(a.partira).")
                        .font(Police.texte(15))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        BoutonA(titre: "Non, sans le web", principal: false, hauteur: 46) { repondre(false) }
                        BoutonA(titre: "Chercher", symbole: "magnifyingglass", hauteur: 46) { repondre(true) }
                    }
                    // Rémy répond (ici ou à cette question) : on attend la fin.
                    .disabled(app.chat.envoi || ligne.enCours)
                }
                .padding(14)
                .overlay(alignment: .top) { Filet() }
            }
        }
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(a.enAttente ? Palette.signal.opacity(0.5) : Palette.filet, lineWidth: 1))
        .padding(.top, 12)
    }

    private func repondre(_ accord: Bool) {
        Task {
            if await app.chat.repondreAutorisation(ligne, accord: accord), accord { Haptique.succes() }
        }
    }
}

private struct LigneAction: View {
    @Environment(AppModel.self) private var app
    let action: ActionProposee
    let versAgenda: Bool
    let erreur: String?
    let barree: Bool
    let premiere: Bool
    var ajustable = false

    private var verbe: String {
        switch action.verbe {
        case "creer": return "Ajouter"
        case "terminer": return "Marquer fait"
        case "supprimer": return "Supprimer"
        default: return "Modifier"
        }
    }

    var body: some View {
        let d = Format.detailAction(action, versAgenda: versAgenda)
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            let teinte = action.verbe == "supprimer" ? Palette.danger : Palette.encre
            Text(verbe)
                .font(Police.texte(12, .semibold))
                .foregroundStyle(teinte)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(teinte.opacity(0.1), in: Capsule())
                .fixedSize()
            VStack(alignment: .leading, spacing: 3) {
                Text(action.libelle)
                    .font(Police.texte(16, .semibold))
                    .strikethrough(barree)
                    .foregroundStyle(barree ? Palette.encre3 : Palette.encre)
                    .fixedSize(horizontal: false, vertical: true)
                if !d.isEmpty {
                    Text(d).font(Police.texte(14)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
                } else if ajustable, action.verbe == "creer", !versAgenda {
                    Text("Sans date : Motion la case quand il peut")
                        .font(Police.texte(14)).foregroundStyle(Palette.encre3).fixedSize(horizontal: false, vertical: true)
                }
                if !categories.isEmpty {
                    Text(categories.joined(separator: " · "))
                        .font(Police.texte(12, .semibold))
                        .foregroundStyle(Palette.encre2)
                }
                if let erreur {
                    Text(erreur)
                        .font(Police.texte(14, .medium))
                        .foregroundStyle(Palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            if ajustable {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Palette.signal)
                    .frame(width: 32, height: 32)
                    .background(Palette.signal.opacity(0.1), in: Circle())
                    .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 5 }
                    .accessibilityHidden(true)
            }
        }
        .padding(14)
        .frame(minHeight: 44)
        .overlay(alignment: .top) { if !premiere { Filet() } }
    }

    /// Les noms des catégories choisies (seules celles qui existent encore).
    private var categories: [String] {
        let ids = Set(action.etiquettes ?? [])
        return app.organisation.etiquettes.filter { ids.contains($0.id) }.map(\.nom)
    }
}

// MARK: - Fil importé

private struct BandeauImporte: View {
    @Environment(AppModel.self) private var app
    let origine: Origine

    var body: some View {
        let titre = app.chat.titre
        VStack(alignment: .leading, spacing: 10) {
            Text("Conversation importée de \(origine.nom) : on ne peut que la lire.")
                .font(Police.texte(14))
                .foregroundStyle(Palette.encre2)
            BoutonA(titre: "Continuer avec Rémy", symbole: "arrow.right", hauteur: 46) {
                Task {
                    await app.nouveauFil(titre: "Suite · " + titre,
                                         message: "Reprenons ce que j'avais commencé ailleurs, dans « \(titre) » : où est-ce que ça nous mène ?")
                }
            }
            .disabled(app.chat.envoi)
        }
        .padding(14)
        .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}

// MARK: - Composeur

/// Les mots surlignés et leur place dans le champ, le temps de demander le bon.
private struct CorrectionDictee: Identifiable {
    let id = UUID()
    let entendu: String
    let place: NSRange
}

private struct Composeur: View {
    @Environment(AppModel.self) private var app
    @Binding var clavier: Bool
    /// Un lien fait lire une page web à Rémy : ça coûte un peu plus.
    @AppStorage("confirmerLiens") private var confirmerLiens = true
    @State private var lienAConfirmer: String?
    /// Écrit pendant que Rémy répond : l'interrompre, ou envoyer après ?
    @State private var choixEnvoi: String?
    /// « Retenir » un long texte : Rémy propose, Sam coche (18/10).
    @State private var aRetenir: DemandeRetenir?
    /// Un mot mal transcrit, surligné dans le champ (19/10).
    @State private var correction: CorrectionDictee?
    @State private var bonMot = ""

    var body: some View {
        @Bindable var chat = app.chat
        let retenir = chat.modeRetenir
        let dictee = app.dictee
        VStack(spacing: 0) {
            if !chat.fileEnvoi.isEmpty {
                bande(texteFile(chat.fileEnvoi)) {
                    BoutonTexte("Reprendre") {
                        Haptique.leger()
                        chat.reprendreFile()
                    }
                    .accessibilityHint("Remet le message en attente dans le champ")
                }
            }
            if dictee.etat == .repos, !dictee.enAttente.isEmpty {
                VocauxEnAttente()
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
            }
            if retenir {
                bande("Noter une idée : Rémy la retient, sans répondre.") {
                    BoutonTexte("Plutôt en parler") { chat.modeRetenir = false }
                }
            }
            Group {
                switch dictee.etat {
                case .enregistrement(let debut):
                    BarreEnregistrement(debut: debut)
                case .transcription:
                    HStack(spacing: 12) {
                        ProgressView()
                        Text("Je transcris ta voix sur la tour…")
                            .font(Police.texte(15, .medium))
                            .foregroundStyle(Palette.encre2)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 14)
                    .frame(minHeight: 50)
                    .accessibilityElement(children: .combine)
                case .repos:
                    saisie(chat, retenir: retenir)
                }
            }
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(dictee.enregistre ? Palette.signal : Palette.filet, lineWidth: dictee.enregistre ? 1.5 : 1))
            .padding(.horizontal, 12)
            .padding(.top, 6)
            .padding(.bottom, 10)
            .confirmationDialog(
                "Rémy répond encore",
                isPresented: Binding(get: { choixEnvoi != nil }, set: { if !$0 { choixEnvoi = nil } }),
                titleVisibility: .visible,
                presenting: choixEnvoi
            ) { t in
                Button("Interrompre et envoyer") { interrompre(t) }
                Button("Envoyer après sa réponse") { apres(t) }
                Button("Annuler", role: .cancel) {}
            } message: { t in
                Text(contientLien(t)
                     ? "Sa réponse coupée restera, marquée « interrompu ». Rémy lira aussi ton lien (quelques centimes)."
                     : "Sa réponse coupée restera, marquée « interrompu ».")
            }
        }
        .background(Palette.fond)
        // Le bandeau « Long texte ? » est parti (Sam, 19/10) : il s'affichait
        // après chaque longue dictée, qui arrive d'un bloc comme un collage.
        // Retenir un texte reste possible par « Noter une idée ».
        .sheet(item: $aRetenir) { d in RetenirInfosVue(demande: d) }
        .alert("Corriger la dictée", isPresented: Binding(get: { correction != nil }, set: { if !$0 { correction = nil } }),
               presenting: correction) { c in
            TextField("Le bon mot", text: $bonMot)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Envoyer à Dictée Locale") {
                let voulu = bonMot.trimmingCharacters(in: .whitespacesAndNewlines)
                Task { await envoyerCorrection(c, voulu: voulu) }
            }
            .disabled(bonMot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Button("Annuler", role: .cancel) {}
        } message: { c in
            Text("« \(c.entendu) » a été mal compris ? Tape le bon mot : Dictée Locale l'apprendra pour tes prochaines dictées.")
        }
        .task {
            // Captures de la CI : un long collage, et ce que Rémy en retiendrait.
            let env = ProcessInfo.processInfo.environment
            if env["REMY_DEMO_MDP"] != nil, env["REMY_DEMO_ECRAN"] == "etapes" {
                // Captures de la CI : une réponse en cours, barre d'étapes ouverte.
                try? await Task.sleep(nanoseconds: 3_500_000_000)
                app.chat.montrerPourCapture(LigneChat(deToi: true, texte: "Tu peux me trouver un créneau pour la vidange demain ?"))
                var l = LigneChat(deToi: false, texte: "", enCours: true, question: "créneau")
                l.etapes = [
                    EtapeReponse(cle: "contexte", texte: "Rémy relit sa mémoire, ton planning et ton agenda…", t: 0),
                    EtapeReponse(cle: "choix", texte: "Rémy choisit comment te répondre…", t: 380),
                    EtapeReponse(cle: "modele", texte: "Rémy interroge son modèle local…", t: 420),
                    EtapeReponse(cle: "motion", texte: "Rémy parcourt ton Motion…", t: 2100),
                    EtapeReponse(cle: "reflexion", texte: "Rémy réfléchit…",
                                 detail: "…demain 9 h est libre, mais le garage ouvre à 8 h 30 : je propose 8 h 30 et je garde 9 h en repli", t: 3900),
                ]
                l.statut = l.etapes.last?.texte
                l.debutEtapes = Date().addingTimeInterval(-9)
                l.debit = 41.6
                app.chat.montrerPourCapture(l)
                return
            }
            if env["REMY_DEMO_MDP"] != nil, env["REMY_DEMO_ECRAN"] == "corriger-dictee" {
                // Captures de la CI : un mot mal compris, surligné, et la bulle.
                try? await Task.sleep(nanoseconds: 3_500_000_000)
                let t = "Rappelle-moi d'appeler Rémi Sanchez demain matin"
                app.chat.brouillon = t
                let place = (t as NSString).range(of: "Rémi Sanchez")
                bonMot = "Rémy Sanchez"
                correction = CorrectionDictee(entendu: "Rémi Sanchez", place: place)
                return
            }
            guard env["REMY_DEMO_MDP"] != nil, env["REMY_DEMO_ECRAN"] == "retenir" else { return }
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            let t = "Je veux lancer la démo de la boutique avant la fin du mois. Hugo s'occupe des contrats et moi du produit. ChatGPT me conseille une facturation à l'usage plutôt qu'un abonnement. Je préfère travailler le matin et garder mes soirées libres. Il faut aussi que je pense au cadeau de Léa pour le 14 mars."
            app.chat.brouillon = t
            aRetenir = DemandeRetenir(texte: t, source: "chatgpt")
        }
        .confirmationDialog(
            "Rémy va lire ce lien",
            isPresented: Binding(get: { lienAConfirmer != nil }, set: { if !$0 { lienAConfirmer = nil } }),
            titleVisibility: .visible,
            presenting: lienAConfirmer
        ) { t in
            Button("Envoyer") { partir(t) }
            Button("Envoyer, et ne plus demander") {
                confirmerLiens = false
                partir(t)
            }
            Button("Annuler", role: .cancel) {}
        } message: { _ in
            Text("Lire une page web coûte un peu plus qu'un message (quelques centimes).")
        }
    }

    /// Le champ, le micro, et le bouton qui envoie — ou qui arrête Rémy
    /// pendant qu'il répond, tant que le champ est vide.
    @ViewBuilder
    private func saisie(_ modele: ChatModel, retenir: Bool) -> some View {
        @Bindable var chat = modele
        let vide = chat.brouillon.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        HStack(alignment: .bottom, spacing: 2) {
            // UIKit et non TextField(axis: .vertical) : mesuré le 18/10 dans cet
            // écran (fil de 60 messages, dictée de 2 min dans le champ), 96,6 ms
            // par image et 429 images sautées pour 90 lettres avec le champ
            // SwiftUI, 17,6 ms avec celui-ci (CI, « perf-remy »).
            ChampTexte(texte: $chat.brouillon, actif: $clavier, invite: retenir ? "Ton idée, en quelques phrases…" : "Écris à Rémy…",
                       corriger: chat.correctionDicteeDisponible ? { mot, place in
                           bonMot = mot
                           correction = CorrectionDictee(entendu: mot, place: place)
                       } : nil)
                .padding(.leading, 16)
                .padding(.vertical, 13)
            Button {
                Haptique.leger()
                Task { await app.dictee.commencer() }
            } label: {
                Image(systemName: "mic")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Palette.encre2)
                    .frame(width: 44, height: 48)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dicter")
            .accessibilityHint("L'audio est transcrit sur ta tour, puis effacé")
            if retenir {
                Button {
                    Haptique.leger()
                    // Une idée courte part telle quelle ; un long texte passe par le choix des infos.
                    if chat.retenirChoixDisponible && chat.brouillon.count >= 280 {
                        aRetenir = DemandeRetenir(texte: chat.brouillon, source: "note")
                    } else {
                        Task { await chat.retenir() }
                    }
                } label: {
                    Text(chat.captureEnCours ? "…" : "Retenir")
                        .font(Police.texte(15, .semibold))
                        .foregroundStyle(vide || chat.captureEnCours ? Palette.encre3 : Palette.fond)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 40)
                        .background(vide || chat.captureEnCours ? Palette.fond3 : Palette.encre, in: Capsule())
                        .padding(4)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(vide || chat.captureEnCours)
            } else if chat.envoi && vide {
                Button {
                    Haptique.leger()
                    Task { await chat.arreter() }
                } label: {
                    Image(systemName: chat.arretEnCours ? "ellipsis" : "stop.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Palette.fond)
                        .frame(width: 40, height: 40)
                        .background(Palette.encre, in: Circle())
                        .padding(4)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(chat.arretEnCours)
                .accessibilityLabel("Arrêter la réponse de Rémy")
            } else {
                Button(action: envoyer) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(vide ? Palette.encre3 : Palette.surSignal)
                        .frame(width: 40, height: 40)
                        .background(vide ? Palette.fond3 : Palette.signal, in: Circle())
                        .padding(4)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(vide)
                .accessibilityLabel(chat.envoi ? "Envoyer (Rémy répond encore)" : "Envoyer")
            }
        }
    }

    private func bande<Actions: View>(_ texte: String, @ViewBuilder actions: () -> Actions) -> some View {
        HStack(spacing: 4) {
            Text(texte)
                .font(Police.texte(13, .medium))
                .foregroundStyle(Palette.encre)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            actions()
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }

    private func texteFile(_ file: [String]) -> String {
        let premier = file.first ?? ""
        let extrait = premier.count > 50 ? String(premier.prefix(47)) + "…" : premier
        return (file.count > 1 ? "\(file.count) messages partiront" : "Partira") + " à la fin de la réponse : « \(extrait) »"
    }

    private func contientLien(_ t: String) -> Bool {
        t.contains("http://") || t.contains("https://")
    }

    private func envoyer() {
        let t = app.chat.brouillon
        guard !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        // Rémy répond encore : Sam choisit (le texte reste dans le champ
        // tant qu'il n'a pas choisi). Le lien, s'il y en a un, est dit dans le
        // même choix — pas deux questions de suite.
        if app.chat.envoi {
            choixEnvoi = t
            return
        }
        if confirmerLiens && contientLien(t) {
            lienAConfirmer = t
            return
        }
        partir(t)
    }

    private func partir(_ t: String) {
        app.chat.brouillon = ""
        Haptique.leger()
        Task { await app.chat.envoyer(t) }
    }

    private func interrompre(_ t: String) {
        app.chat.brouillon = ""
        Haptique.leger()
        Task { await app.chat.interrompreEtEnvoyer(t) }
    }

    private func apres(_ t: String) {
        app.chat.brouillon = ""
        Haptique.leger()
        app.chat.envoyerApres(t)
    }

    /// Envoie la correction ; acceptée, le mot est aussi corrigé dans le champ.
    private func envoyerCorrection(_ c: CorrectionDictee, voulu: String) async {
        guard !voulu.isEmpty, voulu != c.entendu else { return }
        Haptique.leger()
        guard await app.chat.corrigerDictee(entendu: c.entendu, voulu: voulu) else {
            Haptique.erreur()
            return
        }
        let texte = app.chat.brouillon as NSString
        if c.place.location + c.place.length <= texte.length, texte.substring(with: c.place) == c.entendu {
            app.chat.brouillon = texte.replacingCharacters(in: c.place, with: voulu)
        }
    }
}

/// Les vocaux qui ne sont pas partis (19/10 : un vocal de 2 min perdu sur un
/// délai dépassé). Ils attendent en mémoire : « Renvoyer », ou la poubelle.
struct VocauxEnAttente: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 6) {
            ForEach(app.dictee.enAttente) { v in
                HStack(alignment: .center, spacing: 4) {
                    Image(systemName: "waveform.badge.exclamationmark")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Palette.signal)
                        .frame(width: 28)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Vocal de \(v.duree) pas parti")
                            .font(Police.texte(14, .semibold))
                            .foregroundStyle(Palette.encre)
                        Text(v.raison)
                            .font(Police.texte(12))
                            .foregroundStyle(Palette.encre2)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 4)
                    BoutonTexte("Renvoyer", couleur: Palette.signal) {
                        Haptique.leger()
                        Task { await app.dictee.renvoyer(v.id) }
                    }
                    .accessibilityHint("Retente la transcription sur la tour")
                    Button {
                        Haptique.leger()
                        app.dictee.jeter(v.id)
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Palette.encre2)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Jeter ce vocal")
                }
                .padding(.leading, 10)
                .padding(.trailing, 2)
                .padding(.vertical, 4)
                .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityElement(children: .contain)
            }
        }
    }
}

/// Pendant la dictée : ✕ pour annuler (rien ne part), la durée qui avance,
/// ✓ pour transcrire. Comme sur le site : impossible d'envoyer par accident.
struct BarreEnregistrement: View {
    @Environment(AppModel.self) private var app
    let debut: Date
    @Environment(\.accessibilityReduceMotion) private var reduire

    var body: some View {
        HStack(spacing: 0) {
            Button {
                Haptique.leger()
                app.dictee.annuler()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Palette.danger)
                    .frame(width: 50, height: 50)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Annuler le vocal")
            TimelineView(.periodic(from: debut, by: 0.5)) { ctx in
                let s = max(0, Int(ctx.date.timeIntervalSince(debut)))
                HStack(spacing: 10) {
                    Circle()
                        .fill(Palette.signal)
                        .frame(width: 10, height: 10)
                        .opacity(reduire || s % 2 == 0 ? 1 : 0.35)
                    Text(String(format: "%ld:%02ld", s / 60, s % 60))
                        .font(Police.mono(15, .medium))
                        .foregroundStyle(Palette.encre)
                        .monospacedDigit()
                    // La dernière minute avant le plafond se voit : rien ne
                    // s'arrête par surprise.
                    let reste = Int(app.dictee.dureeMax) - s
                    Text(reste <= 60 ? "Encore \(max(0, reste)) s" : "Je t'écoute…")
                        .font(Police.texte(15, reste <= 60 ? .semibold : .regular))
                        .foregroundStyle(reste <= 60 ? Palette.signal : Palette.encre2)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Enregistrement en cours, \(s) secondes")
            }
            .padding(.leading, 4)
            Button {
                Haptique.leger()
                Task { await app.dictee.valider() }
            } label: {
                Image(systemName: "checkmark")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Palette.fond)
                    .frame(width: 40, height: 40)
                    .background(Palette.encre, in: Circle())
                    .padding(5)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Transcrire le vocal")
        }
    }
}

// MARK: - Liste des conversations

struct ConversationsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var recherche = ""
    @State private var aRenommer: ConversationResume?
    @State private var nouveauTitre = ""
    @State private var aSupprimer: ConversationResume?
    @State private var anciennesOuvertes = false
    @State private var importeesOuvertes = false

    var body: some View {
        let toutes = app.chat.conversations.sorted {
            let a = ($0.pinned == true ? 0 : 1, -($0.updatedAt ?? 0))
            let b = ($1.pinned == true ? 0 : 1, -($1.updatedAt ?? 0))
            return a < b
        }
        let maintenant = Date()
        let trouvees = toutes.filter {
            $0.title.range(of: recherche, options: [.caseInsensitive, .diacriticInsensitive]) != nil
        }
        let importees = toutes.filter { $0.origine != nil }
        let anciennes = toutes.filter { $0.origine == nil && Fils.estAncienFilDuJour($0.title, maintenant: maintenant) }
        let principales = toutes.filter { $0.origine == nil && !Fils.estAncienFilDuJour($0.title, maintenant: maintenant) }

        NavigationStack {
            List {
                if let e = app.chat.erreurListe {
                    Vide(texte: e, titreAction: "Réessayer") { Task { await app.chat.rafraichirListe() } }
                        .listRowBackground(Palette.fond)
                }
                if !recherche.isEmpty {
                    ForEach(trouvees) { c in ligne(c) }
                    if trouvees.isEmpty {
                        Text("Aucune conversation ne s'appelle comme ça.")
                            .font(Police.texte(15))
                            .foregroundStyle(Palette.encre2)
                            .listRowBackground(Palette.fond)
                    }
                } else {
                    Button {
                        app.chat.nouvelle()
                        fermer()
                    } label: {
                        Label("Nouvelle conversation", systemImage: "square.and.pencil")
                            .font(Police.texte(16, .semibold))
                            .foregroundStyle(Palette.encre)
                            .frame(minHeight: 44)
                    }
                    .listRowBackground(Palette.fond)
                    // Sam, 18/10 : aujourd'hui, les sept derniers jours, avant.
                    ForEach(PeriodeFil.allCases, id: \.self) { periode in
                        let fils = principales.filter { PeriodeFil.de($0, maintenant: maintenant) == periode }
                        if !fils.isEmpty {
                            Section {
                                ForEach(fils) { c in ligne(c) }
                            } header: {
                                TitreSection(texte: periode.rawValue, compte: fils.count)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.top, 6)
                            }
                        }
                    }
                    if !anciennes.isEmpty {
                        DisclosureGroup(isExpanded: $anciennesOuvertes) {
                            ForEach(anciennes) { c in ligne(c) }
                        } label: {
                            titreGroupe("Anciennes journées (\(anciennes.count))")
                        }
                        .listRowBackground(Palette.fond)
                    }
                    if !importees.isEmpty {
                        DisclosureGroup(isExpanded: $importeesOuvertes) {
                            ForEach(importees) { c in ligne(c) }
                        } label: {
                            titreGroupe("Importées (\(importees.count))")
                        }
                        .listRowBackground(Palette.fond)
                    }
                    if toutes.isEmpty && app.chat.erreurListe == nil {
                        Text("Aucune conversation pour l'instant.")
                            .font(Police.texte(15))
                            .foregroundStyle(Palette.encre2)
                            .listRowBackground(Palette.fond)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Palette.fond)
            .searchable(text: $recherche, placement: .navigationBarDrawer(displayMode: .always), prompt: "Chercher une conversation")
            .refreshable { await app.chat.rafraichirListe() }
            .navigationTitle("Conversations")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fermer") { fermer() }.font(Police.texte(16, .semibold))
                }
            }
        }
        .tint(Palette.encre)
        .overlay(alignment: .bottom) { ToastView(marge: 24, annoncer: false) }
        .task { await app.chat.rafraichirListe() }
        .alert("Renommer", isPresented: Binding(get: { aRenommer != nil }, set: { if !$0 { aRenommer = nil } })) {
            TextField("Titre", text: $nouveauTitre)
            Button("Annuler", role: .cancel) { aRenommer = nil }
            Button("Renommer") {
                if let c = aRenommer { Task { await app.chat.renommer(c.id, en: nouveauTitre) } }
                aRenommer = nil
            }
        }
        .confirmationDialog(
            "Supprimer « \(aSupprimer?.title ?? "") » ?",
            isPresented: Binding(get: { aSupprimer != nil }, set: { if !$0 { aSupprimer = nil } }),
            titleVisibility: .visible,
            presenting: aSupprimer
        ) { c in
            Button("Supprimer", role: .destructive) { Task { await app.chat.supprimer(c.id) } }
            Button("Annuler", role: .cancel) {}
        } message: { _ in
            Text("La conversation disparaîtra aussi du site. Ce que Rémy a retenu de toi reste.")
        }
    }

    private func titreGroupe(_ t: String) -> some View {
        Text(t)
            .font(Police.texte(15, .semibold))
            .foregroundStyle(Palette.encre2)
            .frame(minHeight: 44)
    }

    private func ligne(_ c: ConversationResume) -> some View {
        let courante = c.id == app.chat.idCourant
        let nonLu = app.chat.nonLu(c)
        return Button {
            if courante {
                // Déjà ouvert (peut-être en pleine réponse) : on y retourne.
                app.onglet = .remy
                fermer()
                return
            }
            Task {
                await app.ouvrirConversation(c.id)
                if app.chat.idCourant == c.id { fermer() }
            }
        } label: {
            HStack(spacing: 10) {
                // Une réponse pas encore vue : un point rouge, comme une notification.
                Circle()
                    .fill(nonLu ? Color.red : courante ? Palette.signal : Color.clear)
                    .frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.title)
                        .font(Police.texte(16, courante || nonLu ? .semibold : .regular))
                        .foregroundStyle(Palette.encre)
                        .lineLimit(2)
                    if nonLu {
                        Text("Nouvelle réponse de Rémy").font(Police.texte(13, .medium)).foregroundStyle(Color.red)
                    } else if let o = c.origine {
                        Text("Importée de \(o.nom)").font(Police.texte(13)).foregroundStyle(Palette.encre3)
                    }
                }
                Spacer(minLength: 8)
                if c.pinned == true {
                    Image(systemName: "pin.fill").font(.system(size: 12)).foregroundStyle(Palette.encre2)
                        .accessibilityLabel("Épinglée")
                }
                Text(Format.relatif(c.updatedAt)).font(Police.mono(12)).foregroundStyle(Palette.encre3)
            }
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(nonLu ? "Nouvelle réponse de Rémy" : "")
        .listRowBackground(Palette.fond)
        .listRowSeparatorTint(Palette.filet)
        .contextMenu {
            if nonLu {
                Button { app.chat.noterLu(c.id) } label: { Label("Marquer comme lu", systemImage: "envelope.open") }
            } else if !courante && c.dernier == "assistant" && app.chat.nonLusDisponibles {
                Button { app.chat.marquerNonLu(c.id) } label: { Label("Marquer comme non lu", systemImage: "envelope.badge") }
            }
            Button { nouveauTitre = c.title; aRenommer = c } label: { Label("Renommer", systemImage: "pencil") }
            Button { Task { await app.chat.epingler(c) } } label: {
                Label(c.pinned == true ? "Désépingler" : "Épingler", systemImage: c.pinned == true ? "pin.slash" : "pin")
            }
            Button(role: .destructive) { aSupprimer = c } label: { Label("Supprimer", systemImage: "trash") }
        }
        .swipeActions(edge: .trailing) {
            Button { aSupprimer = c } label: { Label("Supprimer", systemImage: "trash") }
                .tint(Palette.danger)
            Button { nouveauTitre = c.title; aRenommer = c } label: { Label("Renommer", systemImage: "pencil") }
                .tint(Palette.encre2)
        }
    }
}
