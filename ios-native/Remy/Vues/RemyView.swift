import SwiftUI
import UIKit
import RemyCore

/// L'onglet Rémy : une conversation, et rien d'autre. La liste des fils est
/// dans une feuille ; « Nouvelle » vide l'écran sans rien créer.
struct RemyView: View {
    @Environment(AppModel.self) private var app
    @State private var listeOuverte = false
    @FocusState private var focus: Bool

    var body: some View {
        let chat = app.chat
        VStack(spacing: 0) {
            EnTeteRemy(listeOuverte: $listeOuverte)
            BandeauSession()
            if chat.lignes.isEmpty && chat.ouverture {
                Squelette(largeurs: [0.6, 0.9, 0.75]).padding(18)
                Spacer()
            } else if chat.lignes.isEmpty {
                AccueilRemy(focus: $focus)
            } else {
                Fil(focus: $focus)
            }
            if let o = chat.origine {
                BandeauImporte(origine: o)
            } else {
                Composeur(focus: $focus)
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
            focus = true
            chat.focusDemande = false
        }
    }
}

private struct EnTeteRemy: View {
    @Environment(AppModel.self) private var app
    @Binding var listeOuverte: Bool

    var body: some View {
        let chat = app.chat
        let titre = chat.idCourant == nil ? "" : chat.titre
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                BoutonEnTete(titre: "Conversations", symbole: "list.bullet") { listeOuverte = true }
                Spacer()
                // Parler à Rémy à voix haute, comme au téléphone.
                BoutonEnTete(titre: "Appel", symbole: "phone") {
                    Haptique.leger()
                    app.appel.decrocher()
                }
                .disabled(chat.origine != nil)
                .accessibilityLabel("Appeler Rémy")
                BoutonEnTete(titre: "Nouvelle", symbole: "square.and.pencil") {
                    Haptique.leger()
                    chat.nouvelle()
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 52)
            if !titre.isEmpty {
                Text(titre)
                    .font(Police.texte(13, .medium))
                    .foregroundStyle(Palette.encre2)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 18)
                    .padding(.bottom, 8)
                    .accessibilityLabel("Conversation : \(titre)")
            }
        }
        .overlay(alignment: .bottom) { Filet(couleur: Palette.encre) }
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
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.fond2)
            .overlay(alignment: .bottom) { Filet() }
        }
    }
}

/// Écran vide : ce que Rémy sait faire, en boutons.
private struct AccueilRemy: View {
    @Environment(AppModel.self) private var app
    var focus: FocusState<Bool>.Binding

    var body: some View {
        let chat = app.chat
        let derniere = chat.conversations
            .filter { $0.origine == nil }
            .max { ($0.updatedAt ?? 0) < ($1.updatedAt ?? 0) }
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Qu'est-ce que je peux faire pour toi ?")
                    .font(Police.texte(28, .heavy))
                    .tracking(-1)
                    .foregroundStyle(Palette.encre)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 4)
                if chat.conversations.isEmpty && chat.erreurListe == nil {
                    Text("Je suis Rémy, ton directeur de cabinet. Je vois ton agenda et tes tâches, et je t'aide à t'organiser. Écris-moi comme à quelqu'un.")
                        .font(Police.texte(16))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 8)
                }
                Button("Organiser ma journée") {
                    Haptique.leger()
                    Task { await app.organiserJournee() }
                }
                .buttonStyle(BoutonBrut(genre: .principal, pleineLargeur: true))
                Button("Qu'est-ce qui est en retard ?") {
                    Haptique.leger()
                    Task { await chat.envoyer(Brouillons.retards) }
                }
                .buttonStyle(BoutonBrut(pleineLargeur: true))
                .disabled(chat.envoi)
                Button("Noter une idée") {
                    chat.modeRetenir = true
                    focus.wrappedValue = true
                }
                .buttonStyle(BoutonBrut(pleineLargeur: true))
                if let d = derniere {
                    LienTexte(titre: "Reprendre « \(d.title) »") {
                        Task { await app.ouvrirConversation(d.id) }
                    }
                    .lineLimit(1)
                    .padding(.top, 4)
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 28)
            .padding(.bottom, 20)
        }
        .scrollDismissesKeyboard(.interactively)
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
    var focus: FocusState<Bool>.Binding
    /// Sam est en bas du fil : la réponse qui s'écrit le suit. S'il remonte
    /// lire (Sam, 09/10 : impossible pendant une réponse, l'écran revenait en
    /// bas à chaque mot), on le laisse lire jusqu'à ce qu'il redescende.
    @State private var suitLaFin = true

    var body: some View {
        let chat = app.chat
        ScrollViewReader { proxy in
            ScrollView {
                // VStack et non LazyVStack : une pile paresseuse estime la
                // hauteur des messages pas encore dessinés, et « aller en bas »
                // dépassait la fin (vide sous iOS 26).
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(chat.lignes) { l in
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
            .simultaneousGesture(TapGesture().onEnded { focus.wrappedValue = false })
            .defaultScrollAnchor(.bottom)
            .coordinateSpace(name: "fil")
            .background(GeometryReader { zone in
                Color.clear.onPreferenceChange(FinDuFil.self) { y in
                    // La fin est visible (à 120 pt près) : on suit la réponse.
                    suitLaFin = y <= zone.size.height + 120
                }
            })
            .onChange(of: chat.lignes.last?.texte) { _, _ in
                if suitLaFin { proxy.scrollTo("fin", anchor: .bottom) }
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

private struct LigneMessage: View {
    @Environment(AppModel.self) private var app
    let ligne: LigneChat

    var body: some View {
        if ligne.deToi {
            HStack {
                Spacer(minLength: 48)
                Text(ligne.texte)
                    .font(Police.texte(16))
                    .foregroundStyle(Palette.fond)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 11)
                    .background(Palette.encre)
                    .contextMenu { BoutonCopier(texte: ligne.texte) }
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
                        .contextMenu { BoutonCopier(texte: ligne.texte) }
                }
                if let s = ligne.statut {
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
                    Text(e).font(Police.texte(15)).foregroundStyle(Palette.danger)
                    if ligne.question != nil {
                        Button("Réessayer") { Task { await app.chat.reessayer(ligne) } }
                            .buttonStyle(BoutonBrut())
                            .disabled(app.chat.envoi)
                    }
                }
                if let p = ligne.proposition { PropositionView(ligne: ligne, p: p) }
                if let a = ligne.autorisation { AutorisationView(ligne: ligne, a: a) }
            }
            .padding(.bottom, 30)
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
                        Rectangle().fill(Palette.encre).frame(width: 5, height: 5).alignmentGuide(.firstTextBaseline) { d in d[.bottom] + 5 }
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
                        .background(Palette.fond2)
                        .overlay(alignment: .leading) { Rectangle().fill(Palette.encre).frame(width: 3) }
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

// MARK: - Proposition : Rémy propose, Sam décide

private struct PropositionView: View {
    @Environment(AppModel.self) private var app
    let ligne: LigneChat
    let p: Proposition
    @State private var enCours = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(entete)
                .font(Police.texte(15, .semibold))
                .foregroundStyle(p.appliquee ? Palette.encre : Palette.fond)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(p.appliquee ? Palette.fond2 : Palette.encre)
            if !p.appliquee, let r = p.resume, !r.isEmpty {
                Text(r)
                    .font(Police.texte(15))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.top, 12)
            }
            ForEach(Array(p.actions.enumerated()), id: \.offset) { i, a in
                LigneAction(action: a,
                            versAgenda: p.versAgenda,
                            erreur: erreurAffichee(a),
                            barree: estDefaite(a),
                            premiere: i == 0 && (p.appliquee || (p.resume ?? "").isEmpty))
            }
            pied
        }
        .overlay(Rectangle().stroke(Palette.encre, lineWidth: 1.5))
        .padding(.top, 12)
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
        if !p.appliquee {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Button("Non merci") { agir { await app.chat.ecarter(ligne) } }
                        .buttonStyle(BoutonBrut(pleineLargeur: true))
                    Button(enCours ? "…" : p.echouee ? "Réessayer" : "Oui, fais-le") {
                        agir {
                            if await app.chat.appliquer(ligne) { Haptique.succes() }
                        }
                    }
                    .buttonStyle(BoutonBrut(genre: .principal, pleineLargeur: true))
                    // Tant que Rémy écrit, la proposition n'est pas enregistrée.
                    .disabled(ligne.enCours)
                }
                Text("Pour changer un détail, réponds-le simplement à Rémy.")
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
                Button(enCours ? "…" : "Annuler") { agir { await app.chat.annuler(ligne) } }
                    .buttonStyle(BoutonBrut())
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

/// « Chercher sur le web ? » (V8) : la recherche passe par Claude (Anthropic),
/// rien ne part sans ce tap. La carte dit ce qui partirait.
private struct AutorisationView: View {
    @Environment(AppModel.self) private var app
    let ligne: LigneChat
    let a: Autorisation

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(a.titre)
                .font(Police.texte(15, .semibold))
                .foregroundStyle(a.enAttente ? Palette.fond : Palette.encre)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(a.enAttente ? Palette.encre : Palette.fond2)
            if a.enAttente {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Partira : \(a.partira).")
                        .font(Police.texte(15))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        Button("Non, sans le web") { repondre(false) }
                            .buttonStyle(BoutonBrut(pleineLargeur: true))
                        Button("Chercher") { repondre(true) }
                            .buttonStyle(BoutonBrut(genre: .principal, pleineLargeur: true))
                    }
                    // Rémy répond (ici ou à cette question) : on attend la fin.
                    .disabled(app.chat.envoi || ligne.enCours)
                }
                .padding(14)
                .overlay(alignment: .top) { Filet() }
            }
        }
        .overlay(Rectangle().stroke(Palette.encre, lineWidth: 1.5))
        .padding(.top, 12)
    }

    private func repondre(_ accord: Bool) {
        Task {
            if await app.chat.repondreAutorisation(ligne, accord: accord), accord { Haptique.succes() }
        }
    }
}

private struct LigneAction: View {
    let action: ActionProposee
    let versAgenda: Bool
    let erreur: String?
    let barree: Bool
    let premiere: Bool

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
            Text(verbe)
                .font(Police.texte(12, .semibold))
                .foregroundStyle(action.verbe == "supprimer" ? Palette.danger : Palette.encre)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .overlay(Rectangle().stroke(action.verbe == "supprimer" ? Palette.danger : Palette.encre, lineWidth: 1))
                .fixedSize()
            VStack(alignment: .leading, spacing: 3) {
                Text(action.libelle)
                    .font(Police.texte(16, .semibold))
                    .strikethrough(barree)
                    .foregroundStyle(barree ? Palette.encre3 : Palette.encre)
                    .fixedSize(horizontal: false, vertical: true)
                if !d.isEmpty {
                    Text(d).font(Police.texte(14)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
                }
                if let erreur {
                    Text(erreur)
                        .font(Police.texte(14, .medium))
                        .foregroundStyle(Palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .overlay(alignment: .top) { if !premiere { Filet() } }
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
            Button("Continuer avec Rémy") {
                Task {
                    await app.nouveauFil(titre: "Suite · " + titre,
                                         message: "Reprenons ce que j'avais commencé ailleurs, dans « \(titre) » : où est-ce que ça nous mène ?")
                }
            }
            .buttonStyle(BoutonBrut(genre: .principal, pleineLargeur: true))
            .disabled(app.chat.envoi)
        }
        .padding(14)
        .background(Palette.fond2)
        .overlay(alignment: .top) { Filet(couleur: Palette.encre) }
    }
}

// MARK: - Composeur

private struct Composeur: View {
    @Environment(AppModel.self) private var app
    var focus: FocusState<Bool>.Binding
    /// Un lien fait lire une page web à Rémy : ça coûte un peu plus.
    @AppStorage("confirmerLiens") private var confirmerLiens = true
    @State private var collageLong = false
    @State private var lienAConfirmer: String?
    /// Écrit pendant que Rémy répond : l'interrompre, ou envoyer après ?
    @State private var choixEnvoi: String?

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
            if retenir {
                bande("Noter une idée : Rémy la retient, sans répondre.") {
                    BoutonTexte("Plutôt en parler") { chat.modeRetenir = false }
                }
            } else if collageLong {
                bande("Long texte ? Rémy peut juste le retenir.") {
                    Menu {
                        Button("C'est une réponse de ChatGPT") { retenirCollage("chatgpt") }
                        Button("C'est une réponse de Claude") { retenirCollage("claude") }
                        Button("C'est une note à moi") { retenirCollage("note") }
                    } label: {
                        Text("Retenir")
                            .font(Police.texte(14, .semibold))
                            .foregroundStyle(Palette.encre)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    Button { collageLong = false } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Palette.encre2)
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Non, c'est pour en parler")
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
            .overlay(Rectangle().stroke(dictee.enregistre ? Palette.signal : Palette.encre, lineWidth: 1.5))
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
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
        .overlay(alignment: .top) { Filet() }
        .onChange(of: chat.brouillon) { ancien, nouveau in
            // Un gros bloc arrivé d'un coup, c'est un collage : peut-être une
            // réponse d'une autre IA à garder, pas une question.
            if nouveau.count - ancien.count >= 200, !chat.modeRetenir,
               !nouveau.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix("?") {
                collageLong = true
            }
            if nouveau.isEmpty { collageLong = false }
        }
        .onChange(of: chat.idCourant) { _, _ in collageLong = false }
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
        HStack(alignment: .bottom, spacing: 0) {
            TextField(retenir ? "Ton idée, en quelques phrases…" : "Écris à Rémy…", text: $chat.brouillon, axis: .vertical)
                .font(Police.texte(16))
                .lineLimit(1...6)
                .focused(focus)
                .padding(.horizontal, 14)
                .padding(.vertical, 14)
            Button {
                Haptique.leger()
                Task { await app.dictee.commencer() }
            } label: {
                Image(systemName: "mic")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Palette.encre)
                    .frame(width: 50, height: 50)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dicter")
            .accessibilityHint("L'audio est transcrit sur ta tour, puis effacé")
            if retenir {
                Button {
                    Haptique.leger()
                    Task { await chat.retenir() }
                } label: {
                    Text(chat.captureEnCours ? "…" : "Retenir")
                        .font(Police.texte(16, .semibold))
                        .foregroundStyle(vide || chat.captureEnCours ? Palette.encre3 : Palette.fond)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 50)
                        .background(vide || chat.captureEnCours ? Palette.fond3 : Palette.encre)
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
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Palette.fond)
                        .frame(width: 50, height: 50)
                        .background(Palette.encre)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(chat.arretEnCours)
                .accessibilityLabel("Arrêter la réponse de Rémy")
            } else {
                Button(action: envoyer) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(Palette.surSignal)
                        .frame(width: 50, height: 50)
                        .background(vide ? Palette.fond3 : Palette.signal)
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
        .background(Palette.fond2)
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
        collageLong = false
        Haptique.leger()
        Task { await app.chat.envoyer(t) }
    }

    private func interrompre(_ t: String) {
        app.chat.brouillon = ""
        collageLong = false
        Haptique.leger()
        Task { await app.chat.interrompreEtEnvoyer(t) }
    }

    private func apres(_ t: String) {
        app.chat.brouillon = ""
        collageLong = false
        Haptique.leger()
        app.chat.envoyerApres(t)
    }

    private func retenirCollage(_ source: String) {
        collageLong = false
        Task { await app.chat.retenir(source: source) }
    }
}

/// Pendant la dictée : ✕ pour annuler (rien ne part), la durée qui avance,
/// ✓ pour transcrire. Comme sur le site : impossible d'envoyer par accident.
private struct BarreEnregistrement: View {
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
                    Rectangle()
                        .fill(Palette.signal)
                        .frame(width: 10, height: 10)
                        .opacity(reduire || s % 2 == 0 ? 1 : 0.35)
                    Text(String(format: "%ld:%02ld", s / 60, s % 60))
                        .font(Police.mono(15, .medium))
                        .foregroundStyle(Palette.encre)
                        .monospacedDigit()
                    Text("Je t'écoute…")
                        .font(Police.texte(15))
                        .foregroundStyle(Palette.encre2)
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
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Palette.fond)
                    .frame(width: 50, height: 50)
                    .background(Palette.encre)
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
                    ForEach(principales) { c in ligne(c) }
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
                if courante { Rectangle().fill(Palette.signal).frame(width: 3, height: 22) }
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.title)
                        .font(Police.texte(16, courante ? .semibold : .regular))
                        .foregroundStyle(Palette.encre)
                        .lineLimit(2)
                    if let o = c.origine {
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
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(Palette.fond)
        .listRowSeparatorTint(Palette.filet)
        .contextMenu {
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
