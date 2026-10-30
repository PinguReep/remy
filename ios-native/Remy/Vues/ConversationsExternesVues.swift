import SwiftUI
import UniformTypeIdentifiers
import RemyCore

// MARK: - Projets › Conversations (conversations-externes-v1, 29/10)
//
// Tes conversations d'ailleurs — sessions Claude Code, fils de T3 Code,
// export ChatGPT —, lues par la tour, rangées chiffrées : par source et par
// date, une recherche, la lecture d'une conversation, l'état des sources et
// l'import ChatGPT. Rien ne repart vers Claude ni OpenAI.

/// La carte d'entrée, dans l'onglet Projets.
struct CarteConversationsExternes: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let m = app.conversationsExternes
        NavigationLink(value: RouteProjets.conversations) {
            HStack(spacing: 14) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Palette.signal)
                    .frame(width: 36, height: 36)
                    .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Conversations")
                        .font(Police.texte(17, .semibold))
                        .foregroundStyle(Palette.encre)
                    Text(m.resume ?? "Claude Code, T3 Code, ChatGPT : ce que tu as dit ailleurs")
                        .font(Police.texte(13))
                        .foregroundStyle(m.etat?.probleme != nil ? Palette.danger : Palette.encre2)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Palette.encre3)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .contentShape(Rectangle())
            .carte(rayon: 18)
        }
        .buttonStyle(Appui())
        .accessibilityIdentifier("projets.conversations")
        .task { if m.etat == nil { await m.charger() } }
    }
}

/// L'écran « Conversations ».
struct ConversationsExternesVue: View {
    @Environment(AppModel.self) private var app
    @State private var texte = ""
    @State private var recherche: Task<Void, Never>?
    @State private var importOuvert = false
    @State private var joursOuverts = false

    var body: some View {
        let m = app.conversationsExternes
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                TitreEcran(titre: "Conversations", surTitre: "Claude Code · T3 · ChatGPT")
                if !m.disponible {
                    encadre("Ta tour ne lit pas encore tes conversations d'ailleurs : relance son installeur pour la mettre à jour.")
                } else {
                    champRecherche
                    filtres
                    if m.resultats == nil {
                        if let j = m.jour {
                            jourChoisi(j)
                        } else {
                            // Aller à une date sans dérouler des pages (contre-relecture du 29/10).
                            LienTexte(titre: "Aller à un jour") {
                                Haptique.leger()
                                joursOuverts = true
                            }
                            .accessibilityIdentifier("conversations.jour")
                            .padding(.horizontal, 22)
                            .padding(.top, -8)
                        }
                    }
                    if let r = m.resultats {
                        resultats(r)
                    } else {
                        if let p = m.etat?.probleme { probleme(p) }
                        if m.filtre == nil || m.filtre == "chatgpt" {
                            // Un export trouvé dans Téléchargements attend ton geste (sa carte cache le rappel).
                            ForEach(m.propositions) { p in CartePropositionTelechargementVue(proposition: p) }
                            if let c = m.carteExport { CarteExportChatGPTVue(carte: c, importer: { importOuvert = true }) }
                        }
                        if m.filtre == nil, let d = m.digest, !d.vide { CarteNuitConversations(digest: d) }
                        liste
                    }
                }
            }
            .padding(.bottom, 48)
        }
        .background(Palette.fond)
        .scrollDismissesKeyboard(.immediately)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: RouteProjets.sourcesConversations) {
                    Label("Sources", systemImage: "slider.horizontal.3")
                        .labelStyle(.titleAndIcon)
                        .font(Police.texte(15, .semibold))
                        .frame(minHeight: 44)
                }
                .accessibilityIdentifier("conversations.sources")
            }
        }
        .refreshable { await m.charger() }
        .task { await m.charger() }
        .fileImporter(isPresented: $importOuvert, allowedContentTypes: [.zip, .json], allowsMultipleSelection: false) { r in
            importerChoisi(r, m)
        }
        .sheet(isPresented: $joursOuverts) { ChoixJourConversations() }
        .onDisappear { recherche?.cancel() }
    }

    /// Le jour choisi, en changer, ou revenir à tous.
    private func jourChoisi(_ j: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "calendar").foregroundStyle(Palette.signal).accessibilityHidden(true)
            Text(ConversationsExternes.titreJour(iso: j))
                .font(Police.texte(16, .semibold))
                .foregroundStyle(Palette.encre)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 2)
            BoutonTexte("Changer") {
                Haptique.leger()
                joursOuverts = true
            }
            .accessibilityIdentifier("conversations.jour.changer")
            BoutonTexte("Tous les jours") {
                Haptique.leger()
                Task { await app.conversationsExternes.choisirJour(nil) }
            }
            .accessibilityIdentifier("conversations.jour.tous")
        }
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .frame(minHeight: 52)
        .carte(rayon: 16)
        .padding(.horizontal, 16)
    }

    // MARK: Recherche et filtres

    private var champRecherche: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Palette.encre3)
            TextField("Chercher dans tes conversations", text: $texte)
                .font(Police.texte(16))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .accessibilityIdentifier("conversations.recherche")
                .onChange(of: texte) { _, t in
                    recherche?.cancel()
                    recherche = Task {
                        try? await Task.sleep(nanoseconds: 350_000_000)
                        guard !Task.isCancelled else { return }
                        await app.conversationsExternes.chercher(t)
                    }
                }
            if app.conversationsExternes.enRecherche {
                ProgressView().controlSize(.small)
            } else if !texte.isEmpty {
                Button {
                    texte = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.encre3).frame(width: 44, height: 44)
                }
                .accessibilityLabel("Effacer la recherche")
            }
        }
        .padding(.leading, 14)
        .frame(minHeight: 48)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.filet, lineWidth: 1))
        .padding(.horizontal, 16)
    }

    private var filtres: some View {
        let m = app.conversationsExternes
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                puce("Toutes", nil, actif: m.filtre == nil)
                ForEach(ConversationsExternes.sources, id: \.self) { s in
                    puce(ConversationsExternes.nomSource(s), s, actif: m.filtre == s, compte: m.etat?.source(s)?.conversations)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func puce(_ titre: String, _ source: String?, actif: Bool, compte: Int? = nil) -> some View {
        Button {
            Haptique.leger()
            Task { await app.conversationsExternes.filtrer(source) }
        } label: {
            HStack(spacing: 6) {
                if let source { Image(systemName: ConversationsExternes.symbole(source)).font(.system(size: 13, weight: .medium)) }
                Text(titre)
                if let compte, compte > 0 { Text("\(compte)").font(Police.mono(12)).opacity(0.7) }
            }
            .font(Police.texte(15, .semibold))
            .foregroundStyle(actif ? Palette.fond : Palette.encre)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(actif ? Palette.encre : Palette.fond2, in: Capsule())
        }
        .buttonStyle(Appui())
        .accessibilityIdentifier("conversations.filtre.\(source ?? "toutes")")
        .accessibilityAddTraits(actif ? .isSelected : [])
    }

    // MARK: États

    private func probleme(_ p: ProblemeSource) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(p.message, systemImage: "exclamationmark.triangle")
                .font(Police.texte(15, .semibold))
                .foregroundStyle(Palette.danger)
                .fixedSize(horizontal: false, vertical: true)
            if let q = p.quoiFaire {
                Text(q).font(Police.texte(14)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
            }
            NavigationLink(value: RouteProjets.sourcesConversations) {
                Text("Voir les sources ›").font(Police.texte(15, .semibold)).foregroundStyle(Palette.encre).frame(minHeight: 44)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .carte(rayon: 18)
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private var liste: some View {
        let m = app.conversationsExternes
        if m.liste.isEmpty {
            if m.chargement || (m.etat == nil && m.erreurEtat == nil) {
                Squelette(largeurs: [0.7, 0.95, 0.6, 0.85])
                    .padding(18)
                    .carte(rayon: 18)
                    .padding(.horizontal, 16)
            } else if let e = m.erreurListe ?? m.erreurEtat {
                Vide(texte: e, titreAction: "Réessayer") { Task { await m.charger() } }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .carte(rayon: 18)
                    .padding(.horizontal, 16)
            } else {
                vide
            }
        } else {
            ForEach(Array(ConversationsExternes.parJour(m.liste).enumerated()), id: \.offset) { _, groupe in
                VStack(alignment: .leading, spacing: 6) {
                    TitreSection(texte: groupe.titre, compte: groupe.conversations.count).padding(.horizontal, 22)
                    VStack(spacing: 0) {
                        ForEach(Array(groupe.conversations.enumerated()), id: \.element.id) { i, c in
                            NavigationLink(value: RouteProjets.conversationExterne(source: c.source, id: c.id)) {
                                LigneConversationExterne(c: c)
                            }
                            .buttonStyle(.plain)
                            if i < groupe.conversations.count - 1 {
                                Rectangle().fill(Palette.filet).frame(height: 1).padding(.leading, 62)
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .carte(rayon: 18)
                    .padding(.horizontal, 16)
                }
            }
            if m.suite != nil {
                BoutonA(titre: m.chargement ? "Chargement…" : "Plus ancien", symbole: "clock.arrow.circlepath", principal: false) {
                    Task { await m.plus() }
                }
                .disabled(m.chargement)
                .padding(.horizontal, 16)
            } else if m.total > 0 {
                Text(m.total == 1 ? "1 conversation." : "\(m.total) conversations, toutes là.")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre3)
                    .padding(.horizontal, 22)
            }
            Text("Lu sur ta tour et chiffré là-bas. Rien ne repart vers Claude ni OpenAI ; Rémy s'en inspire avec son modèle local.")
                .font(Police.texte(12))
                .foregroundStyle(Palette.encre3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 22)
        }
    }

    /// Rien à montrer : ce que chaque source attend, et les deux gestes utiles.
    private var vide: some View {
        let m = app.conversationsExternes
        let sources = (m.etat?.sources ?? []).filter { m.filtre == nil || $0.id == m.filtre }
        return VStack(alignment: .leading, spacing: 14) {
            Text(m.jour.map { "Aucune conversation \(ConversationsExternes.ceJour(iso: $0))." }
                 ?? m.filtre.map { "Aucune conversation \(ConversationsExternes.nomSource($0)) pour l'instant." } ?? "Rien encore ici.")
                .font(Police.titre(20))
                .foregroundStyle(Palette.encre)
            ForEach(sources) { s in
                VStack(alignment: .leading, spacing: 3) {
                    Label(s.nom, systemImage: ConversationsExternes.symbole(s.id))
                        .font(Police.texte(15, .semibold))
                        .foregroundStyle(Palette.encre)
                    Text(s.phrase()).font(Police.texte(14)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
                    if let q = (s.erreur ?? s.aide)?.quoiFaire {
                        Text(q).font(Police.texte(13)).foregroundStyle(Palette.encre3).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            BoutonA(titre: m.enCours ? "Lecture…" : "Lire maintenant", symbole: "arrow.clockwise") {
                Task { await m.lireMaintenant() }
            }
            .disabled(m.enCours)
            .accessibilityIdentifier("conversations.lire")
            if m.filtre == nil || m.filtre == "chatgpt" {
                BoutonA(titre: m.importEnCours ? m.libelleImport : "Importer ChatGPT", symbole: "square.and.arrow.down", principal: false) {
                    importOuvert = true
                }
                .disabled(m.importEnCours)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .carte(rayon: 18)
        .padding(.horizontal, 16)
    }

    private func resultats(_ r: [ResultatRecherche]) -> some View {
        let m = app.conversationsExternes
        return VStack(alignment: .leading, spacing: 6) {
            TitreSection(texte: "Trouvé", compte: r.count).padding(.horizontal, 22)
            if let e = m.erreurRecherche {
                Vide(texte: e, titreAction: "Réessayer") { Task { await m.chercher(texte) } }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .carte(rayon: 18)
                    .padding(.horizontal, 16)
            } else if r.isEmpty {
                Text("Rien trouvé pour « \(m.recherche) ». Essaie un autre mot, ou le début d'un mot.")
                    .font(Police.texte(15))
                    .foregroundStyle(Palette.encre2)
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .carte(rayon: 18)
                    .padding(.horizontal, 16)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(r.enumerated()), id: \.element.id) { i, x in
                        NavigationLink(value: RouteProjets.conversationExterne(source: x.source, id: x.conversation, autour: x.message)) {
                            LigneResultat(r: x)
                        }
                        .buttonStyle(.plain)
                        if i < r.count - 1 { Rectangle().fill(Palette.filet).frame(height: 1).padding(.leading, 62) }
                    }
                }
                .padding(.horizontal, 12)
                .carte(rayon: 18)
                .padding(.horizontal, 16)
            }
        }
    }

    private func encadre(_ t: String) -> some View {
        Text(t)
            .font(Police.texte(15))
            .foregroundStyle(Palette.encre2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .carte(rayon: 18)
            .padding(.horizontal, 16)
    }

    private func importerChoisi(_ r: Result<[URL], Error>, _ m: ConversationsExternesModel) {
        switch r {
        case .success(let urls):
            guard let u = urls.first else { return }
            Task { await ImportChatGPT.envoyer(u, m) }
        case .failure:
            app.dire("Fichier inaccessible : réessaie depuis Fichiers (le .zip reçu par mail de ChatGPT).")
        }
    }
}

/// L'envoi d'un fichier choisi dans Fichiers : l'accès au fichier n'est
/// ouvert que le temps de l'envoi.
enum ImportChatGPT {
    @MainActor
    static func envoyer(_ u: URL, _ m: ConversationsExternesModel) async {
        let acces = u.startAccessingSecurityScopedResource()
        defer { if acces { u.stopAccessingSecurityScopedResource() } }
        Haptique.leger()
        if await m.importer(u) { Haptique.succes() } else { Haptique.erreur() }
    }
}

/// Une conversation dans la liste.
struct LigneConversationExterne: View {
    let c: ConversationExterne

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconeSource(source: c.source)
            VStack(alignment: .leading, spacing: 3) {
                Text(c.titre)
                    .font(Police.texte(16, .semibold))
                    .foregroundStyle(Palette.encre)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if let a = c.apercu, a != c.titre {
                    Text(a)
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.encre2)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Text(c.ligne())
                    .font(Police.mono(11))
                    .foregroundStyle(Palette.encre3)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct LigneResultat: View {
    let r: ResultatRecherche

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconeSource(source: r.source)
            VStack(alignment: .leading, spacing: 3) {
                Text(r.titre).font(Police.texte(15, .semibold)).foregroundStyle(Palette.encre).lineLimit(1)
                Text(r.extrait).font(Police.texte(14)).foregroundStyle(Palette.encre2).lineLimit(3).multilineTextAlignment(.leading)
                Text([ConversationsExternes.nomSource(r.source), r.ts.map { Format.relatif($0) } ?? "", r.auteur == "assistant" ? "réponse" : "toi"]
                    .filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(Police.mono(11))
                    .foregroundStyle(Palette.encre3)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct IconeSource: View {
    let source: String
    var body: some View {
        Image(systemName: ConversationsExternes.symbole(source))
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(Palette.encre)
            .frame(width: 38, height: 38)
            .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Ce que la nuit a tiré des conversations d'hier : des propositions.
struct CarteNuitConversations: View {
    @Environment(AppModel.self) private var app
    let digest: DigestNuit

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "moon.stars").foregroundStyle(Palette.signal)
                Text("Cette nuit, Rémy a relu tes conversations")
                    .font(Police.texte(16, .semibold))
                    .foregroundStyle(Palette.encre)
            }
            if !digest.themes.isEmpty {
                Flux(espacement: 6) {
                    ForEach(digest.themes, id: \.self) { t in
                        Text(t)
                            .font(Police.texte(13, .medium))
                            .foregroundStyle(Palette.encre)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Palette.fond2, in: Capsule())
                    }
                }
            }
            if !digest.decisions.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    TitreSection(texte: "Décidé")
                    ForEach(digest.decisions, id: \.self) { d in
                        Text("• \(d)").font(Police.texte(14)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if !digest.aFaire.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    TitreSection(texte: "À faire ?")
                    ForEach(digest.aFaire) { a in
                        HStack(alignment: .center, spacing: 8) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(a.texte).font(Police.texte(14)).foregroundStyle(Palette.encre).fixedSize(horizontal: false, vertical: true)
                                if let s = a.source { Text(s).font(Police.mono(11)).foregroundStyle(Palette.encre3) }
                            }
                            Spacer(minLength: 4)
                            BoutonTexte("Me le rappeler") {
                                Haptique.leger()
                                app.conversationsExternes.rappeler(a)
                            }
                        }
                    }
                }
            }
            Text("Des propositions, tirées par le modèle local : rien n'est fait sans ton geste.")
                .font(Police.texte(12))
                .foregroundStyle(Palette.encre3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .carte(rayon: 18)
        .padding(.horizontal, 16)
    }
}

// MARK: - Lire une conversation

struct ConversationExterneVue: View {
    @Environment(AppModel.self) private var app
    let source: String
    let id: String
    /// Ouverte depuis une recherche : au message trouvé (contre-relecture du 29/10).
    var autour: Int? = nil
    @State private var lecture: LectureConversation?
    @State private var messages: [MessageExterne] = []
    @State private var suite: Int?
    @State private var erreur: String?
    @State private var chargement = false
    @State private var ouverts: Set<Int> = []
    /// Le message trouvé, mis en avant ; et s'il y a plus ancien avant la page.
    @State private var cible: Int?
    @State private var avant = false
    @State private var depuisLeDebut = false

    var body: some View {
        ScrollViewReader { defiler in
            ScrollView {
                contenu
                    .padding(16)
                    .padding(.bottom, 32)
            }
            .onChange(of: cible) { _, c in
                guard let c else { return }
                withAnimation(.easeOut(duration: 0.25)) { defiler.scrollTo(c, anchor: .center) }
            }
        }
        .background(Palette.fond)
        .navigationTitle(lecture.map { ConversationsExternes.nomSource($0.conversation.source) } ?? "Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .task { if lecture == nil { await charger(suite: false) } }
        .refreshable { await charger(suite: false) }
    }

    private var contenu: some View {
            LazyVStack(alignment: .leading, spacing: 12) {
                if let c = lecture?.conversation {
                    entete(c)
                    if avant {
                        BoutonA(titre: chargement ? "Chargement…" : "Depuis le début", symbole: "arrow.up", principal: false) {
                            depuisLeDebut = true
                            Task { await charger(suite: false) }
                        }
                        .disabled(chargement)
                        .accessibilityIdentifier("conversation.debut")
                    }
                    ForEach(messages) { m in
                        bulle(m, assistant: c.assistant)
                            .id(m.id)
                    }
                    if suite != nil {
                        BoutonA(titre: chargement ? "Chargement…" : "La suite", symbole: "arrow.down", principal: false) {
                            Task { await charger(suite: true) }
                        }
                        .disabled(chargement)
                    }
                } else if let erreur {
                    Vide(texte: erreur, titreAction: "Réessayer") { Task { await charger(suite: false) } }
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .carte(rayon: 18)
                } else {
                    Squelette(largeurs: [0.6, 0.9, 0.8, 0.95, 0.5])
                        .padding(18)
                        .carte(rayon: 18)
                }
            }
    }

    private func entete(_ c: ConversationExterne) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(c.titre)
                .font(Police.titre(24))
                .foregroundStyle(Palette.encre)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .accessibilityIdentifier("conversation.titre")
            Text([ConversationsExternes.nomSource(c.source), c.assistantDistinct, c.projet?.nom].compactMap { $0 }.joined(separator: " · "))
                .font(Police.texte(14))
                .foregroundStyle(Palette.encre2)
            if let d = c.debut {
                Text(periode(d, c.fin) + " · \(c.messages) message\(c.messages > 1 ? "s" : "")")
                    .font(Police.mono(12))
                    .foregroundStyle(Palette.encre3)
            }
            Label("Lu sur ta tour, chiffré. Rien ne repart vers Claude ni OpenAI.", systemImage: "lock")
                .font(Police.texte(12))
                .foregroundStyle(Palette.encre3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, 6)
    }

    private func periode(_ d: Millis, _ f: Millis?) -> String {
        let debut = Date(timeIntervalSince1970: d / 1000)
        let jour = Format.jourCourt(debut) + ", " + Format.heure(debut)
        guard let f, f - d > 60_000 else { return jour }
        let fin = Date(timeIntervalSince1970: f / 1000)
        return Format.calendrier.isDate(debut, inSameDayAs: fin) ? "\(jour) → \(Format.heure(fin))" : "\(jour) → \(Format.jourCourt(fin)), \(Format.heure(fin))"
    }

    private static let replie = 1500

    private func bulle(_ m: MessageExterne, assistant: String?) -> some View {
        let long = m.texte.count > Self.replie && !ouverts.contains(m.id)
        let texte = long ? String(m.texte.prefix(Self.replie)) + "…" : m.texte
        let trouve = m.id == cible
        return VStack(alignment: m.deToi ? .trailing : .leading, spacing: 4) {
            Text([trouve ? "Trouvé" : nil, ConversationsExternes.auteur(m, assistant: assistant), m.ts.map { Format.heure($0) }].compactMap { $0 }.joined(separator: " · "))
                .font(Police.mono(11))
                .foregroundStyle(trouve ? Palette.signal : Palette.encre3)
            Text(texte)
                .font(Police.texte(15))
                .foregroundStyle(Palette.encre)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(12)
                .background(m.deToi ? Palette.fond2 : Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(trouve ? Palette.signal : (m.deToi ? Color.clear : Palette.filet), lineWidth: trouve ? 2 : 1))
            if long {
                BoutonTexte("Lire tout") { ouverts.insert(m.id) }
            }
        }
        .frame(maxWidth: .infinity, alignment: m.deToi ? .trailing : .leading)
        .padding(m.deToi ? .leading : .trailing, 28)
    }

    private func charger(suite plus: Bool) async {
        guard !chargement else { return }
        chargement = true
        defer { chargement = false }
        do {
            let pres = !plus && !depuisLeDebut ? autour : nil
            let l = try await app.api.conversationExterne(source: source, id: id, apres: plus ? suite : nil, autour: pres)
            lecture = l
            messages = plus ? messages + l.messages : l.messages
            suite = l.suite
            if !plus {
                avant = pres != nil && l.avant == true
                if pres != nil { cible = l.cible ?? pres }
            }
            erreur = nil
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app.signaler(e); return }
            if let e = error as? ErreurAPI, case .serveur(404, _) = e {
                erreur = "Cette conversation n'est plus sur ta tour (source effacée ou coupée)."
            } else {
                erreur = (error as? LocalizedError)?.errorDescription ?? "La conversation n'a pas pu être lue."
            }
        }
    }
}

// MARK: - Aller à un jour

/// Les jours qui ont des conversations (de la source choisie), pour y aller
/// d'un geste au lieu de dérouler « Plus ancien ».
struct ChoixJourConversations: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer

    var body: some View {
        let m = app.conversationsExternes
        NavigationStack {
            List {
                if let j = m.jours {
                    if j.isEmpty {
                        Text("Aucun jour avec des conversations\(m.filtre.map { " \(ConversationsExternes.nomSource($0))" } ?? "") pour l'instant.")
                            .font(Police.texte(15))
                            .foregroundStyle(Palette.encre2)
                    } else {
                        if m.jour != nil {
                            ligne("Tous les jours", compte: nil, jour: nil)
                        }
                        ForEach(j) { x in ligne(ConversationsExternes.titreJour(iso: x.jour), compte: x.conversations, jour: x.jour) }
                    }
                } else if let e = m.erreurJours {
                    Text(e).font(Police.texte(15)).foregroundStyle(Palette.danger).fixedSize(horizontal: false, vertical: true)
                    BoutonTexte("Réessayer") { Task { await m.chargerJours() } }
                } else {
                    Squelette(largeurs: [0.5, 0.7, 0.4, 0.6])
                }
            }
            .listeAtelier()
            .navigationTitle("Aller à un jour")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Fermer") { fermer() } } }
            .task { await m.chargerJours() }
        }
        .presentationDetents([.medium, .large])
    }

    private func ligne(_ titre: String, compte: Int?, jour: String?) -> some View {
        let choisi = app.conversationsExternes.jour == jour
        return Button {
            Haptique.leger()
            fermer()
            Task { await app.conversationsExternes.choisirJour(jour) }
        } label: {
            HStack {
                Text(titre).font(Police.texte(16, choisi ? .semibold : .regular)).foregroundStyle(Palette.encre)
                Spacer()
                if let compte {
                    Text(compte == 1 ? "1 conversation" : "\(compte) conversations").font(Police.mono(12)).foregroundStyle(Palette.encre3)
                }
                if choisi { Image(systemName: "checkmark").foregroundStyle(Palette.signal) }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("conversations.jour.\(jour ?? "tous")")
    }
}

// MARK: - Les sources (Projets › Conversations › Sources, et Réglages)

struct SourcesConversationsVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @Environment(\.openURL) private var ouvrirURL
    /// Ouverte depuis Réglages : sa propre pile et un bouton « OK ».
    var dansFeuille = false
    @State private var aEffacer: SourceConversations?
    @State private var toutEffacer = false
    @State private var importOuvert = false

    var body: some View {
        if dansFeuille {
            NavigationStack {
                contenu
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK") { fermer() } } }
            }
            .overlay(alignment: .bottom) { ToastView(marge: 24, annoncer: false) }
        } else {
            contenu
        }
    }

    private var contenu: some View {
        let m = app.conversationsExternes
        return List {
            if let e = m.etat {
                ForEach(e.sources) { s in section(s) }
                usage(e.usage)
                viePrivee(e)
            } else if let err = m.erreurEtat {
                Section {
                    Text(err).font(Police.texte(15)).foregroundStyle(Palette.danger).fixedSize(horizontal: false, vertical: true)
                    BoutonTexte("Réessayer") { Task { await m.charger() } }
                }
            } else {
                Section { Squelette(largeurs: [0.6, 0.9, 0.5]) }
                Section { Squelette(largeurs: [0.8, 0.7, 0.4]) }
            }
        }
        .listeAtelier()
        // Un résultat de la recherche dans Réglages : la ligne visée, mise en évidence.
        .allerAuRepere(.sourcesConversations)
        .navigationTitle("Sources des conversations")
        .navigationBarTitleDisplayMode(.inline)
        .task { if m.etat == nil { await m.charger() } }
        .refreshable { await m.charger() }
        .fileImporter(isPresented: $importOuvert, allowedContentTypes: [.zip, .json], allowsMultipleSelection: false) { r in
            if case .success(let urls) = r, let u = urls.first {
                Task { await ImportChatGPT.envoyer(u, m) }
            } else if case .failure = r {
                app.dire("Fichier inaccessible : réessaie depuis Fichiers (le .zip reçu par mail de ChatGPT).")
            }
        }
        .confirmationDialog("Effacer ce que Rémy a gardé ?",
                            isPresented: Binding(get: { aEffacer != nil }, set: { if !$0 { aEffacer = nil } }),
                            titleVisibility: .visible, presenting: aEffacer) { s in
            Button("Effacer \(s.nom) de la tour", role: .destructive) { Task { await m.effacer(s.id) } }
            Button("Annuler", role: .cancel) {}
        } message: { s in
            Text(s.id == "chatgpt"
                 ? "Les conversations importées et ce que la nuit en a tiré. Ton compte ChatGPT n'est pas touché."
                 : "Ce que la tour en a lu, et ce que la nuit en a tiré ; la lecture est coupée. Tes conversations dans \(s.nom) ne sont pas touchées.")
        }
        .confirmationDialog("Tout effacer ?", isPresented: $toutEffacer, titleVisibility: .visible) {
            Button("Tout effacer de la tour", role: .destructive) { Task { await m.toutEffacer() } }
            Button("Annuler", role: .cancel) {}
        } message: {
            Text("Utile si la clé a changé. « Lire maintenant » relira Claude Code et T3 ; un export ChatGPT se réenvoie.")
        }
    }

    private func section(_ s: SourceConversations) -> some View {
        let m = app.conversationsExternes
        return Section {
            Toggle(isOn: Binding(get: { s.actif }, set: { oui in
                Haptique.leger()
                Task { await m.regler(s.id, actif: oui) }
            })) {
                VStack(alignment: .leading, spacing: 3) {
                    Label(s.id == "chatgpt" ? "Importer ChatGPT" : "Lire \(s.nom)", systemImage: ConversationsExternes.symbole(s.id))
                        .font(Police.texte(16, .medium))
                        .foregroundStyle(Palette.encre)
                    Text(s.phrase())
                        .font(Police.texte(13))
                        .foregroundStyle(s.erreur != nil ? Palette.danger : Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(Palette.signal)
            .frame(minHeight: 60)
            .disabled(s.forceParLaTour || m.enCours)
            .accessibilityIdentifier("sources.\(s.id)")
            // Ce que la dernière lecture a vu (« 312 sessions : 280 lues… »).
            if let r = s.phraseRecensement {
                Text(r).font(Police.texte(13)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("sources.recensement.\(s.id)")
            }
            if let q = (s.erreur ?? s.aide)?.quoiFaire {
                Text(q).font(Police.texte(13)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
            }
            if !s.emplacements.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(s.emplacements.enumerated()), id: \.offset) { _, l in
                        Text("\(l.trouve ? "✓" : "–") \(l.chemin)  (\(l.origine))")
                            .font(Police.mono(11))
                            .foregroundStyle(l.trouve ? Palette.encre2 : Palette.encre3)
                            .lineLimit(2)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Où la tour cherche")
            }
            if s.id == "chatgpt" {
                Button {
                    importOuvert = true
                } label: {
                    HStack {
                        Label(m.libelleImport, systemImage: "square.and.arrow.down")
                        if m.importEnCours {
                            Spacer()
                            if let p = m.progressionImport, p > 0 { ProgressView(value: p).frame(width: 60) } else { ProgressView() }
                        }
                    }
                    .frame(minHeight: 44)
                }
                .disabled(m.importEnCours)
                .accessibilityIdentifier("sources.importer")
                .repere("Importer un export ChatGPT", dans: .sourcesConversations)
                Text(m.dernierImport?.phrase ?? "Dans ChatGPT : Réglages › Contrôle des données › Exporter. Choisis ici le .zip reçu par mail (ou dépose-le dans le dossier Imports de ton coffre).")
                    .font(Police.texte(12))
                    .foregroundStyle(Palette.encre3)
                    .fixedSize(horizontal: false, vertical: true)
                if let o = m.etat?.imports?.originaux?.phrase {
                    Text(o)
                        .font(Police.texte(12))
                        .foregroundStyle(Palette.encre3)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("sources.originaux")
                }
                reglagesExport(m.etat?.chatgpt)
            }
            if s.actif {
                Button {
                    Task { await m.lireMaintenant(s.id) }
                } label: {
                    HStack {
                        Label(m.enCours ? "Lecture…" : "Lire maintenant", systemImage: "arrow.clockwise")
                        if m.enCours { Spacer(); ProgressView() }
                    }
                    .frame(minHeight: 44)
                }
                .disabled(m.enCours)
                .accessibilityIdentifier("sources.lire.\(s.id)")
            }
            if s.conversations > 0 {
                Button(role: .destructive) { aEffacer = s } label: {
                    Label("Effacer ce que Rémy en a gardé", systemImage: "trash").frame(minHeight: 44)
                }
                .disabled(m.enCours)
            }
        } header: {
            Text(s.nom)
        }
    }

    /// Les deux réglages de l'import ChatGPT (soir du 29/10), et la page
    /// d'export. Une tour plus ancienne ne les connaît pas : rien.
    @ViewBuilder
    private func reglagesExport(_ e: EtatConversations.ExportChatGPT?) -> some View {
        let m = app.conversationsExternes
        if let t = e?.telechargements {
            Toggle(isOn: Binding(get: { t.actif }, set: { oui in
                Haptique.leger()
                Task { await m.reglerExportChatGPT(telechargements: oui) }
            })) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Prendre l'export dans Téléchargements").font(Police.texte(16, .medium)).foregroundStyle(Palette.encre)
                    if let p = ConversationsExternes.phraseTelechargements(t) {
                        Text(p).font(Police.texte(13)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .tint(Palette.signal)
            .frame(minHeight: 60)
            .disabled(t.forceParLaTour || m.enCours)
            .accessibilityIdentifier("sources.telechargements")
            .repere("Prendre l'export dans Téléchargements", dans: .sourcesConversations)
        }
        if let r = e?.rappel {
            Toggle(isOn: Binding(get: { r.actif }, set: { oui in
                Haptique.leger()
                Task { await m.reglerExportChatGPT(rappel: oui) }
            })) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Me rappeler d'exporter ChatGPT").font(Police.texte(16, .medium)).foregroundStyle(Palette.encre)
                    Text("Une carte quand ton dernier export a plus de 30 jours : un bouton ouvre ChatGPT ; tu cliques le lien du mail sur la tour, Rémy fait le reste.")
                        .font(Police.texte(13)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(Palette.signal)
            .frame(minHeight: 60)
            .disabled(m.enCours)
            .accessibilityIdentifier("sources.rappel-export")
            .repere("Me rappeler d'exporter ChatGPT", dans: .sourcesConversations)
        }
        if e != nil {
            Button {
                ouvrirURL(ConversationsExternes.lienExportChatGPT)
                app.dire("Dans ChatGPT : Contrôle des données › Exporter les données, puis confirme. Le mail arrive en quelques minutes.")
            } label: {
                Label("Demander un export à ChatGPT", systemImage: "arrow.up.right.square").frame(minHeight: 44)
            }
            .accessibilityIdentifier("sources.demander-export")
        }
    }

    private func usage(_ u: UsageConversations) -> some View {
        let m = app.conversationsExternes
        return Section {
            Toggle(isOn: Binding(get: { u.chat }, set: { oui in Task { await m.reglerUsage(chat: oui) } })) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("S'en inspirer dans ses réponses").font(Police.texte(16, .medium))
                    Text("Quand ta question en parle, le modèle local en relit quelques passages ; la conversation devient privée (jamais Claude).")
                        .font(Police.texte(13)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(Palette.signal)
            .frame(minHeight: 60)
            .disabled(u.forceParLaTour || m.enCours)
            .repere("S'en inspirer dans ses réponses", dans: .sourcesConversations)
            Toggle(isOn: Binding(get: { u.nuit }, set: { oui in Task { await m.reglerUsage(nuit: oui) } })) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Relire celles de la veille, la nuit").font(Police.texte(16, .medium))
                    Text("Thèmes, décisions, choses à faire : des propositions, et une ligne dans ton briefing. Modèle local seulement.")
                        .font(Police.texte(13)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(Palette.signal)
            .frame(minHeight: 60)
            .disabled(u.forceParLaTour || m.enCours)
            .repere("Relire celles de la veille, la nuit", dans: .sourcesConversations)
            if u.forceParLaTour {
                Text("Coupé sur la tour (REMY_CONVERSATIONS_USAGE=off).").font(Police.texte(13)).foregroundStyle(Palette.encre2)
            }
        } header: {
            Text("Ce que Rémy en fait")
        }
    }

    private func viePrivee(_ e: EtatConversations) -> some View {
        Section {
            Text("Chiffré sur ta tour\(e.cle?.emplacement.map { " (clé : \($0), hors du coffre)" } ?? ""). Rien ne repart vers Claude ni OpenAI : la lecture est à sens unique, et les secrets (clés, mots de passe) sont masqués avant d'être gardés.")
                .font(Police.texte(12))
                .foregroundStyle(Palette.encre3)
                .fixedSize(horizontal: false, vertical: true)
            if let p = e.cle?.erreur {
                Text(p.message).font(Police.texte(13, .medium)).foregroundStyle(Palette.danger).fixedSize(horizontal: false, vertical: true)
            }
            Button(role: .destructive) { toutEffacer = true } label: {
                Label("Tout effacer de la tour", systemImage: "trash").frame(minHeight: 44)
            }
            .disabled(app.conversationsExternes.enCours)
            .repere("Tout effacer de la tour", dans: .sourcesConversations)
        } header: {
            Text("Vie privée")
        }
    }
}

/// Un export ChatGPT trouvé dans les Téléchargements de la tour (contre-relecture
/// du 30/10, tour 2) : rien n'entre dans ta mémoire sans ce geste. Les mêmes
/// mots et les mêmes gestes que le site ; les deux boutons attendent la réponse
/// (« Pas celui-là » pendant un import importait quand même).
struct CartePropositionTelechargementVue: View {
    @Environment(AppModel.self) private var app
    let proposition: PropositionTelechargement
    /// Le geste en cours sur cette carte : true « Importer », false « Pas celui-là ».
    @State private var geste: Bool?

    var body: some View {
        let m = app.conversationsExternes
        let c = ConversationsExternes.carteProposition(proposition)
        VStack(alignment: .leading, spacing: 10) {
            Label("ChatGPT", systemImage: ConversationsExternes.symbole("chatgpt"))
                .font(Police.mono(12, .medium))
                .foregroundStyle(Palette.encre2)
            Text(c.titre)
                .font(Police.titre(20))
                .foregroundStyle(Palette.encre)
                .fixedSize(horizontal: false, vertical: true)
            Text(c.texte)
                .font(Police.texte(15))
                .foregroundStyle(Palette.encre)
                .fixedSize(horizontal: false, vertical: true)
            Text(c.detail)
                .font(Police.texte(13))
                .foregroundStyle(Palette.encre3)
                .fixedSize(horizontal: false, vertical: true)
            BoutonA(titre: geste == true ? "Import en cours sur la tour…" : c.importer, symbole: "square.and.arrow.down") {
                repondre(true)
            }
            .accessibilityIdentifier("conversations.trouve.importer")
            BoutonA(titre: c.refuser, symbole: "xmark", principal: false) {
                repondre(false)
            }
            .accessibilityIdentifier("conversations.trouve.refuser")
        }
        .disabled(m.enCours || geste != nil)
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .carte(rayon: 18)
        .padding(.horizontal, 16)
    }

    private func repondre(_ importer: Bool) {
        Haptique.leger()
        geste = importer
        Task {
            await app.conversationsExternes.repondre(proposition, importer: importer)
            geste = nil
        }
    }
}

/// La carte « Exporter ChatGPT » (soir du 29/10) : la tour dit quand la
/// montrer (dernier import de plus de 30 jours, ou jamais). Le bouton ouvre
/// la page d'export de ChatGPT ; Rémy ne s'y connecte jamais : le mail
/// arrive, tu cliques son lien sur l'ordinateur, Rémy trouve le .zip dans
/// Téléchargements et te demande ton accord (la carte ci-dessus).
struct CarteExportChatGPTVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var ouvrirURL
    let carte: CarteExportChatGPT
    /// Le lien du mail touché sur l'iPhone : le .zip est dans Fichiers, pas
    /// dans les Téléchargements de la tour — il s'importe d'ici.
    var importer: (() -> Void)? = nil

    var body: some View {
        let m = app.conversationsExternes
        VStack(alignment: .leading, spacing: 10) {
            Label("ChatGPT", systemImage: ConversationsExternes.symbole("chatgpt"))
                .font(Police.mono(12, .medium))
                .foregroundStyle(Palette.encre2)
            Text(carte.titre)
                .font(Police.titre(20))
                .foregroundStyle(Palette.encre)
            Text(carte.texte)
                .font(Police.texte(15))
                .foregroundStyle(Palette.encre)
                .fixedSize(horizontal: false, vertical: true)
            Text(carte.detail)
                .font(Police.texte(13))
                .foregroundStyle(Palette.encre3)
            BoutonA(titre: carte.bouton, symbole: "arrow.up.right.square") {
                Haptique.leger()
                ouvrirURL(carte.lien)
                app.dire(carte.apresOuverture)
            }
            .accessibilityIdentifier("conversations.exporter")
            if let importer {
                BoutonA(titre: m.importEnCours ? m.libelleImport : carte.importer, symbole: "square.and.arrow.down", principal: false) {
                    Haptique.leger()
                    importer()
                }
                .disabled(m.importEnCours)
                .accessibilityIdentifier("conversations.exporter.importer")
            }
            LienTexte(titre: "Ne plus me le rappeler") {
                Task { await m.reglerExportChatGPT(rappel: false) }
            }
            .disabled(m.enCours)
            .accessibilityIdentifier("conversations.exporter.couper")
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .carte(rayon: 18)
        .padding(.horizontal, 16)
    }
}

/// La ligne du matin, dans le briefing : tirée la nuit des conversations d'hier.
struct LigneConversationsBriefing: View {
    let ligne: LigneConversations
    var ouvrir: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Hier, dans tes conversations", systemImage: "bubble.left.and.bubble.right")
                .font(Police.mono(12, .medium))
                .foregroundStyle(Palette.encre2)
            Text(ligne.ligne)
                .font(Police.texte(16))
                .foregroundStyle(Palette.encre)
                .fixedSize(horizontal: false, vertical: true)
            if let s = ligne.sources, !s.isEmpty {
                Text(s.map(ConversationsExternes.nomSource).joined(separator: " · "))
                    .font(Police.mono(11))
                    .foregroundStyle(Palette.encre3)
            }
            if let ouvrir {
                LienTexte(titre: "Voir les conversations", action: ouvrir)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .carte(rayon: 18)
    }
}
