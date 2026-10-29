import SwiftUI
import RemyCore

// MARK: - Réglages

/// Tout ce qui ne sert pas tous les jours, rangé derrière « Réglages ».
struct ReglagesView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @Environment(\.openURL) private var ouvrirURL
    @AppStorage("confirmerLiens") private var confirmerLiens = true
    @AppStorage("theme") private var theme = "auto"
    @AppStorage(ActiviteEnDirect.cleActive) private var activiteActive = true
    @AppStorage(ActiviteEnDirect.cleAuto) private var activiteAuto = true
    @AppStorage(ATrancherModel.cleRevue) private var revueDimanche = true
    /// Chercher dans les réglages (29/10) : la saisie, le champ actif, le
    /// tutoriel ouvert depuis un résultat (« Siri »).
    @State private var recherche = ""
    @State private var rechercheActive = false
    @State private var tutoriel: LotNouveautes?
    @State private var memoire = false
    @State private var triOuvert = false
    @State private var revueOuverte = false
    @State private var appareilsOuverts = false
    @State private var reglesOuvertes = false
    @State private var lieuxOuverts = false
    @State private var modelesOuverts = false
    @State private var activitePCOuverte = false
    @State private var nouveautesOuvertes = false
    @State private var prioritesOuvertes = false
    @State private var sourcesConversationsOuvertes = false
    @State private var deconnexion = false
    /// Réglages gardés sur la tour (secours Claude). nil : pas encore lus, ou
    /// tour trop ancienne pour les connaître — la ligne ne s'affiche pas.
    @State private var reglages: Reglages?
    @State private var changementSecours = false
    @State private var diagnostic = false
    @State private var usage = false

    var body: some View {
        let d = app.tableau.donnees
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ligne("Ce que Rémy sait de toi", symbole: "person.text.rectangle") { memoire = true }
                    // Le rendez-vous quotidien (24/10) : coupé par défaut.
                    if app.rituel.disponible {
                        ReglagesRituelVue()
                            .padding(.bottom, 8)
                    }
                    if app.organisation.dossiersDisponibles {
                        ReglageCapture()
                    }
                    ligne("Ouvrir le site", sous: "Le site te redemandera le mot de passe.", symbole: "safari") {
                        ouvrirURL(app.api.base)
                    }
                    // J1.8 (24/10) : compté sur l'iPhone, sans contenu.
                    ligne("Ce que tu utilises vraiment", sous: ResumeUsage.de(CompteursUsage.partages).phrase, symbole: "chart.bar") { usage = true }
                    if let c = d?.couts {
                        info("Coût des 30 derniers jours", valeur: Format.usd(c.jours30), symbole: "creditcard")
                    }
                    if let n = joursActifs(d?.activite) {
                        info(n == 0 ? "Tu n'as pas parlé à Rémy ces 14 derniers jours."
                                    : "Tu as parlé à Rémy \(n) jour\(n > 1 ? "s" : "") sur les 14 derniers.",
                             symbole: "calendar")
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 14) {
                            Image(systemName: "circle.lefthalf.filled").font(.system(size: 18)).frame(width: 26)
                            Text("Apparence").font(Police.texte(16, .medium))
                        }
                        Picker("Apparence", selection: $theme) {
                            Text("Comme l'iPhone").tag("auto")
                            Text("Clair").tag("clair")
                            Text("Sombre").tag("sombre")
                        }
                        .pickerStyle(.segmented)
                    }
                    .foregroundStyle(Palette.encre)
                    .padding(.vertical, 12)
                    .overlay(alignment: .bottom) { Filet() }
                    .repere("Apparence")
                    Toggle(isOn: $confirmerLiens) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Prévenir avant d'ouvrir un lien").font(Police.texte(16, .medium))
                            Text("Lire une page web coûte un peu plus qu'un message.")
                                .font(Police.texte(13))
                                .foregroundStyle(Palette.encre2)
                        }
                    }
                    .tint(Palette.signal)
                    .foregroundStyle(Palette.encre)
                    .padding(.vertical, 10)
                    .frame(minHeight: 60)
                    .overlay(alignment: .bottom) { Filet() }
                    .repere("Prévenir avant d'ouvrir un lien")
                    activiteEnDirect
                    if let r = reglages, r.rechercheWeb != nil {
                        rechercheWeb(r)
                        // Rémy cherche lui-même (recherche locale) : rien ne part
                        // au cloud pour chercher, ce réglage n'a plus d'objet.
                        if r.rechercheWeb == true && r.moteurRecherche == nil { contexteCloud(r) }
                    }
                    // Recherche dans les conversations privées (recherche-privee-v1,
                    // 27/10) : coupée par défaut ; cachée sur une tour qui ne la
                    // connaît pas, grisée quand la tour la verrouille.
                    if let r = reglages, app.serveur?.sait("recherche-privee-v1") == true, r.recherchePriveeReglage != nil {
                        recherchePrivee(r)
                    }
                    if let r = reglages, r.secoursCloudSansObjet != true {
                        secours(r)
                    }
                    if let r = reglages, let nuit = r.circuits?["nuit"] {
                        circuitNuit(nuit)
                    }
                    if let r = reglages, let c = r.circuits?["conseil"] {
                        circuit("conseil", c, titre: "Conseil réfléchi",
                                detail: "Le modèle local, sur tes machines, prépare le conseil du moment en arrière-plan. Coupé : conseil calculé sur l'iPhone, sans IA.")
                    }
                    if let r = reglages, let c = r.circuits?["compactage"] {
                        circuit("compactage", c, titre: "Compacter les longues conversations",
                                detail: "Dès 70 % du contexte, le modèle local résume le début du fil (rien n'est effacé). Coupé : seulement à la demande, depuis la jauge.")
                    }
                    if d?.systeme?.reflexion == false {
                        info("Préparation de nuit désactivée : « Rémy a remarqué » restera vide.", symbole: "moon.zzz")
                    }
                    if app.modeles.disponible {
                        ligne("Modèle", sous: app.modeles.vue?.actif.map { "\($0.libelle), sur tes Sparks" } ?? "Le modèle local avec lequel Rémy répond",
                              symbole: "cpu") {
                            modelesOuverts = true
                        }
                    }
                    if app.lieux.disponible {
                        ligne("Localisation", sous: app.lieux.active ? (app.lieux.enPause ? "En pause" : "Allumée : ta tour sait où tu en es") : "Coupée", symbole: "location") {
                            lieuxOuverts = true
                        }
                    }
                    if app.activitePC.disponible {
                        ligne("Activité du PC", sous: activitePCSous, symbole: "desktopcomputer") {
                            activitePCOuverte = true
                        }
                    }
                    // Tes conversations d'ailleurs (29/10) : leurs sources, l'import ChatGPT.
                    if app.conversationsExternes.disponible {
                        ligne("Sources des conversations", sous: app.conversationsExternes.resume ?? "Claude Code, T3 Code, ChatGPT : lues sur ta tour.",
                              symbole: "bubble.left.and.bubble.right") {
                            sourcesConversationsOuvertes = true
                        }
                    }
                    if app.serveur?.sait("priorites-v1") == true {
                        ligne("Ce qui compte", sous: "Tes 3 à 5 priorités : le conseil et la nuit s'en servent.", symbole: "star") {
                            prioritesOuvertes = true
                        }
                    }
                    if app.chat.reglesDisponibles {
                        ligne("Règles de Rémy", sous: "Les tâches à faire avant un type d'événement.", symbole: "arrow.triangle.branch") {
                            reglesOuvertes = true
                        }
                    }
                    if let r = reglages, let c = r.circuits?["regles"] {
                        circuit("regles", c, titre: "Vérifier les règles",
                                detail: "Toutes les 3 h, sans IA : Rémy relit ton agenda et Motion pour te proposer les tâches de tes règles.")
                    }
                    if app.serveur?.sait("appareils") == true {
                        ligne("Appareils connectés", sous: "Déconnecte un iPhone perdu ou prêté.", symbole: "iphone") {
                            appareilsOuverts = true
                        }
                    }
                    ligne("Nouveautés", sous: nouveautesSous, symbole: "sparkles") {
                        nouveautesOuvertes = true
                    }
                    if app.aTrancher.disponible {
                        ligne("À trancher", sous: "Cartes, rappels, articles, vieux fils, idées : un geste chacun.", symbole: "tray.2") {
                            triOuvert = true
                        }
                        ligne("Revue de la semaine", sous: "Fait, glissé, idées, trois décisions. Sans IA.", symbole: "calendar.badge.checkmark") {
                            revueOuverte = true
                        }
                        Toggle(isOn: $revueDimanche) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Revue du dimanche").font(Police.texte(16, .medium))
                                Text("Proposée sur Aujourd'hui le dimanche, 10 minutes. Coupée : seulement depuis ici.")
                                    .font(Police.texte(13))
                                    .foregroundStyle(Palette.encre2)
                            }
                        }
                        .tint(Palette.signal)
                        .foregroundStyle(Palette.encre)
                        .padding(.vertical, 10)
                        .frame(minHeight: 60)
                        .overlay(alignment: .bottom) { Filet() }
                        .repere("Revue du dimanche")
                    }
                    // Les outils du constructeur, à part (24/10) : temps de réponse,
                    // jauge du chat (visible par défaut depuis le 27/10), appui du planning.
                    ligne("Diagnostic", sous: "Temps de réponse, jauge du chat, réglages fins", symbole: "stethoscope") {
                        diagnostic = true
                    }
                    ligne("Se déconnecter", symbole: "rectangle.portrait.and.arrow.right", couleur: Palette.danger, fleche: false) {
                        deconnexion = true
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Rémy \(version)")
                        if let s = app.serveur {
                            Text("Serveur \(s.libelle)")
                        }
                    }
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre3)
                    .padding(.top, 24)
                    .repere("Version")
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 24)
            }
            .background(Palette.fond)
            .allerAuRepere(.reglages)
            .accessibilityHidden(enRecherche)
            .overlay { if enRecherche { resultatsRecherche } }
            .navigationTitle("Réglages")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $recherche, isPresented: $rechercheActive,
                        placement: .navigationBarDrawer(displayMode: .always), prompt: "Chercher un réglage")
            .autocorrectionDisabled()
            .onSubmit(of: .search) { allerAuPremier() }
            .sheet(item: $tutoriel) { lot in
                NouveautesFeuille(lot: lot) { tutoriel = nil }
                    .onDisappear { app.nouveautes.marquerVues(lot) }
            }
            .task { await demoRecherche() }
            .navigationDestination(isPresented: $diagnostic) { DiagnosticVue() }
            .navigationDestination(isPresented: $usage) { UsageVue() }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fermer") { fermer() }.font(Police.texte(16, .semibold))
                }
            }
        }
        .tint(Palette.encre)
        .overlay(alignment: .bottom) { ToastView(marge: 24, annoncer: false) }
        .sheet(isPresented: $memoire) { MemoireView() }
        .sheet(isPresented: $appareilsOuverts) { AppareilsView() }
        .sheet(isPresented: $reglesOuvertes) { ReglesVue() }
        .sheet(isPresented: $lieuxOuverts) { LieuxVue() }
        .sheet(isPresented: $modelesOuverts) { ModelesVue() }
        .sheet(isPresented: $activitePCOuverte) { ActivitePCVue() }
        .sheet(isPresented: $nouveautesOuvertes) { NouveautesListe() }
        .sheet(isPresented: $triOuvert) { ATrancherFeuille() }
        .sheet(isPresented: $revueOuverte) { RevueDimanche() }
        .sheet(isPresented: $prioritesOuvertes) { PrioritesVue() }
        .sheet(isPresented: $sourcesConversationsOuvertes) { SourcesConversationsVue(dansFeuille: true) }
        .task {
            guard app.serveur?.sait("reglages") ?? false else { return }
            reglages = try? await app.api.reglages()
        }
        .task { await app.modeles.charger() }
        .task {
            if ProcessInfo.processInfo.environment["REMY_DEMO_ECRAN"] != "activite-pc" { await app.activitePC.charger() }
        }
        .task {
            // Captures de la CI : l'écran Activité du PC, avec une semaine fictive.
            guard ProcessInfo.processInfo.environment["REMY_DEMO_ECRAN"] == "activite-pc" else { return }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            app.activitePC.montrerPourCapture(ActivitePCDemo.vue())
            activitePCOuverte = true
        }
        .task {
            // Captures de la CI : l'écran Modèle, sur le serveur de démo.
            let ecran = ProcessInfo.processInfo.environment["REMY_DEMO_ECRAN"]
            guard ecran == "modeles" || ecran == "nouveautes-liste" || ecran == "priorites" else { return }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            if ecran == "modeles" { modelesOuverts = true } else if ecran == "priorites" { prioritesOuvertes = true } else { nouveautesOuvertes = true }
        }
        .task {
            // Captures de la CI : « Ce que tu utilises vraiment », gestes fictifs.
            guard ProcessInfo.processInfo.environment["REMY_DEMO_ECRAN"] == "usage" else { return }
            let c = CompteursUsage.partages
            c.remettreAZero()
            let jour: Double = 86_400
            c.noter(.ouverture, le: Date().addingTimeInterval(-19 * jour))
            let gestes: [(FonctionUsage, Int)] = [(.aujourdhui, 64), (.terminer, 41), (.remy, 30), (.parler, 27), (.capture, 18), (.listes, 9), (.gerer, 6)]
            for (f, n) in gestes {
                for i in 0..<n { c.noter(f, le: Date().addingTimeInterval(-Double(i % 20) * jour)) }
            }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            usage = true
        }
        .task {
            // Captures de la CI : l'écran Localisation, avec des lieux fictifs.
            guard ProcessInfo.processInfo.environment["REMY_DEMO_ECRAN"] == "lieux" else { return }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            app.lieux.montrerPourCapture(LieuxDemo.vue())
            lieuxOuverts = true
        }
        .confirmationDialog("Se déconnecter de Rémy ?", isPresented: $deconnexion, titleVisibility: .visible) {
            Button("Se déconnecter", role: .destructive) { Task { await app.deconnecter() } }
            Button("Annuler", role: .cancel) {}
        } message: {
            let attente = app.tableau.gestesEnAttente + app.carnet.enAttente.count + app.tableau.capturesEnAttente.count
            Text("Il faudra retaper le mot de passe pour revenir."
                 + (attente == 0 ? "" : attente == 1 ? " Un changement pas encore envoyé sera perdu."
                                                     : " \(attente) changements pas encore envoyés seront perdus."))
        }
    }

    /// Secours Claude (D21) : coupé par défaut. L'activer, c'est accepter que
    /// la conversation et la mémoire partent chez Anthropic quand la tour
    /// (GLM) ne répond pas — jamais pour une conversation privée.
    private func secours(_ r: Reglages) -> some View {
        let force = r.secoursCloudForceParLaTour == true
        return Toggle(isOn: Binding(
            get: { r.secoursCloud },
            set: { nouveau in changerSecours(nouveau) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Secours Claude si la tour ne répond pas").font(Police.texte(16, .medium))
                Text(force
                     ? "Activé sur la tour (REMY_SECOURS_CLOUD) : à couper là-bas."
                     : "Tes messages et ta mémoire partent alors chez Anthropic. Jamais pour une conversation privée.")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Palette.signal)
        .disabled(force || changementSecours)
        .foregroundStyle(Palette.encre)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Filet() }
        .repere("Secours Claude si la tour ne répond pas")
    }

    /// Recherche web : avec la recherche locale (recherche-locale-v1, 25/10),
    /// Rémy cherche lui-même (DuckDuckGo), sans Claude ; sinon (V8) elle passe
    /// par Claude, et Rémy demande l'accord à chaque recherche. Coupée, il
    /// répond sans le web.
    private func rechercheWeb(_ r: Reglages) -> some View {
        let force = r.rechercheWebCoupeeParLaTour == true
        return Toggle(isOn: Binding(
            get: { r.rechercheWeb == true },
            set: { nouveau in changerCloud(web: nouveau) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Recherche web").font(Police.texte(16, .medium))
                Text(r.phraseRechercheWeb)
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Palette.signal)
        .disabled(force || changementSecours)
        .foregroundStyle(Palette.encre)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Filet() }
        .repere("Recherche web")
    }

    /// Envoi de contexte au cloud (V8) : coupé, une recherche autorisée
    /// n'emporte que la question ; allumé, la conversation et la mémoire
    /// partent avec. Jamais pour une conversation privée.
    private func contexteCloud(_ r: Reglages) -> some View {
        Toggle(isOn: Binding(
            get: { r.contexteCloud == true },
            set: { nouveau in changerCloud(contexte: nouveau) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Envoi de contexte au cloud").font(Police.texte(16, .medium))
                Text(r.contexteCloud == true
                     ? "Une recherche autorisée emporte la conversation et ta mémoire. Jamais pour une conversation privée."
                     : "Une recherche autorisée n'emporte que ta question.")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Palette.signal)
        .disabled(changementSecours)
        .foregroundStyle(Palette.encre)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Filet() }
        .repere("Envoi de contexte au cloud")
    }

    /// Recherche dans les conversations privées : ce qui sort quand elle est
    /// allumée (des questions générales, par la salle blanche et le filtre ;
    /// ConversationPrivee.ceQuiSort), et pourquoi elle est grisée quand la
    /// tour la verrouille.
    private func recherchePrivee(_ r: Reglages) -> some View {
        let verrou = r.verrouRecherchePrivee != nil
        return Toggle(isOn: Binding(
            get: { r.recherchePriveeAffichee },
            set: { nouveau in changerCloud(privee: nouveau) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Recherche dans les conversations privées").font(Police.texte(16, .medium))
                Text(r.phraseRecherchePrivee)
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Palette.signal)
        .disabled(verrou || changementSecours)
        .accessibilityIdentifier("reglages.recherchePrivee")
        .foregroundStyle(verrou ? Palette.encre2 : Palette.encre)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Filet() }
        .repere("Recherche dans les conversations privées")
    }

    private func changerCloud(web: Bool? = nil, contexte: Bool? = nil, privee: Bool? = nil) {
        guard !changementSecours else { return }
        changementSecours = true
        Task {
            defer { changementSecours = false }
            do {
                if let privee {
                    let r = try await app.api.changerRecherchePrivee(privee)
                    reglages = r
                    app.chat.noter(reglages: r)
                    app.dire(r.confirmationRecherchePrivee(privee))
                } else if let web {
                    let r = try await app.api.changerRechercheWeb(web)
                    reglages = r
                    app.chat.noter(reglages: r)
                    app.dire(r.confirmationRechercheWeb(web))
                } else if let contexte {
                    reglages = try await app.api.changerContexteCloud(contexte)
                    app.dire(contexte ? "Une recherche autorisée emportera la conversation et ta mémoire."
                                      : "Une recherche autorisée n'emportera que ta question.")
                }
                Haptique.succes()
            } catch {
                app.signaler(error)
            }
        }
    }

    /// Réflexion de la nuit (J0.9) : Rémy relit et prépare le briefing pendant
    /// que Sam dort. Coupable d'un geste ; la tour peut la forcer.
    private func circuitNuit(_ c: Circuit) -> some View {
        circuit("nuit", c, titre: "Réflexion de la nuit", detail: "Rémy relit tes échanges et prépare le briefing du matin.")
    }

    private func circuit(_ id: String, _ c: Circuit, titre: String, detail: String) -> some View {
        let force = c.forceParLaTour == true
        return Toggle(isOn: Binding(
            get: { c.actif },
            set: { nouveau in changerCircuit(id, nouveau) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text(titre).font(Police.texte(16, .medium))
                Text(force
                     ? "Réglé sur la tour (REMY_CIRCUIT_\(id.uppercased())) : à changer là-bas."
                     : detail)
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Palette.signal)
        .disabled(force || changementSecours)
        .foregroundStyle(Palette.encre)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Filet() }
        .repere(titre)
    }

    private func changerCircuit(_ id: String, _ actif: Bool) {
        guard !changementSecours else { return }
        changementSecours = true
        Task {
            defer { changementSecours = false }
            do {
                reglages = try await app.api.changerCircuit(id, actif: actif)
                app.dire(Self.annonce(id, actif))
                Haptique.succes()
            } catch {
                app.signaler(error)
            }
        }
    }

    /// Ce que dit le bandeau après un changement de circuit.
    static func annonce(_ id: String, _ actif: Bool) -> String {
        switch id {
        case "nuit": return actif ? "Réflexion de la nuit allumée." : "Réflexion de la nuit coupée : Rémy ne travaillera plus la nuit."
        case "conseil": return actif ? "Conseil réfléchi allumé." : "Conseil réfléchi coupé : le conseil se calcule sur l'iPhone."
        case "compactage": return actif ? "Compactage automatique allumé." : "Compactage automatique coupé : à la demande seulement."
        case "regles": return actif ? "Vérification des règles allumée." : "Vérification des règles coupée : Rémy ne propose plus leurs tâches."
        default: return actif ? "Circuit allumé." : "Circuit coupé."
        }
    }

    private func changerSecours(_ actif: Bool) {
        guard !changementSecours else { return }
        changementSecours = true
        Task {
            defer { changementSecours = false }
            do {
                reglages = try await app.api.changerSecoursCloud(actif)
                app.dire(actif ? "Secours Claude activé." : "Secours Claude coupé : rien ne part chez Anthropic quand la tour ne répond pas.")
                Haptique.succes()
            } catch {
                app.signaler(error)
            }
        }
    }

    /// Jours avec au moins un échange, sur les 14 derniers.
    private func joursActifs(_ a: Activite?) -> Int? {
        guard let a, !a.jours.isEmpty else { return nil }
        return a.jours.suffix(14).filter { $0.messages > 0 || $0.actif == true }.count
    }

    /// « 2 nouvelles », sinon de quoi revoir les tutoriels.
    private var nouveautesSous: String {
        let n = app.nouveautes.historique.filter { app.nouveautes.estNouvelle($0) && app.nouveautes.existe($0) }.count
        return n > 0 ? "\(n) nouvelle\(n > 1 ? "s" : "") à découvrir" : "Les tutoriels des mises à jour, à revoir"
    }

    /// « Coupée », « Aujourd'hui : 3 h 10 actives », « ActivityWatch ne répond pas ».
    private var activitePCSous: String {
        guard let v = app.activitePC.vue else { return "Le temps passé dans tes applis, d'après ActivityWatch" }
        if !v.actif { return v.coupeParLaTour ? "Coupée sur la tour" : "Coupée" }
        if v.probleme != nil { return "Allumée, mais ActivityWatch ne répond pas" }
        return v.aujourdhui.total >= 60 ? "Aujourd'hui : \(ActivitePC.duree(v.aujourdhui.total)) actives" : "Allumée : rien encore aujourd'hui"
    }

    private var version: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "\(v) (\(b))"
    }

    private func ligne(_ titre: String, sous: String? = nil, symbole: String, couleur: Color = Palette.encre,
                       fleche: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: symbole).font(.system(size: 18)).frame(width: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text(titre).font(Police.texte(16, .medium))
                    if let sous {
                        Text(sous).font(Police.texte(13)).foregroundStyle(Palette.encre2)
                    }
                }
                Spacer()
                if fleche { Text("›").font(Police.texte(20)).foregroundStyle(Palette.encre3) }
            }
            .foregroundStyle(couleur)
            .padding(.vertical, 10)
            .frame(minHeight: 60)
            .overlay(alignment: .bottom) { Filet() }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .repere(titre)
    }

    private func info(_ titre: String, valeur: String? = nil, symbole: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbole).font(.system(size: 18)).frame(width: 26)
            Text(titre).font(Police.texte(16)).fixedSize(horizontal: false, vertical: true)
            Spacer()
            if let valeur { Text(valeur).font(Police.mono(15, .medium)) }
        }
        .foregroundStyle(Palette.encre)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Filet() }
        .repere(titre)
    }
}

// MARK: - Chercher dans les réglages (29/10)

extension ReglagesView {
    /// Une saisie qui cherche vraiment (des espaces seuls : l'écran reste tel quel).
    fileprivate var enRecherche: Bool { !recherche.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// Ce que l'écran montre en ce moment (capacités de la tour, ses réglages,
    /// les interrupteurs dont d'autres lignes dépendent).
    fileprivate var contexteRecherche: ContexteReglages {
        ContexteReglages(app: app, reglages: reglages, activiteEnDirect: activiteActive)
    }

    fileprivate var resultatsRecherche: some View {
        ResultatsReglagesVue(resultats: RechercheReglages.chercher(recherche, contexte: contexteRecherche),
                             choisir: { aller($0) },
                             suggerer: { recherche = $0 })
    }

    /// La touche « Rechercher » du clavier : le premier résultat.
    fileprivate func allerAuPremier() {
        if let e = RechercheReglages.premier(recherche, contexte: contexteRecherche) { aller(e) }
    }

    /// Ouvre l'écran du résultat, la ligne mise en évidence. La saisie reste
    /// (retour = les résultats), sauf pour une ligne de cet écran-ci.
    fileprivate func aller(_ e: EntreeReglage, duree: TimeInterval = 4) {
        Haptique.leger()
        let c = RechercheReglages.cible(e, contexte: contexteRecherche)
        if let a = c.ancre { RepereReglages.partage.viser(a, dans: c.ecran, titre: e.titre, duree: duree) }
        if let note = c.note { app.dire(note) }
        switch c.ecran {
        case .reglages:
            rechercheActive = false
            recherche = ""
        case .diagnostic: diagnostic = true
        case .usage: usage = true
        case .memoire: memoire = true
        case .modeles: modelesOuverts = true
        case .lieux: lieuxOuverts = true
        case .activitePC: activitePCOuverte = true
        case .sourcesConversations: sourcesConversationsOuvertes = true
        case .priorites: prioritesOuvertes = true
        case .regles: reglesOuvertes = true
        case .appareils: appareilsOuverts = true
        case .aTrancher: triOuvert = true
        case .revue: revueOuverte = true
        case .nouveautes:
            if let id = c.tutoriel, let n = Nouveautes.catalogue.first(where: { $0.id == id }) {
                tutoriel = app.nouveautes.lot(pour: n)
            } else {
                nouveautesOuvertes = true
            }
        case .iphone:
            if let u = RepereReglages.reglagesIPhone { ouvrirURL(u) }
        }
    }

    /// Captures de la CI : une recherche, une recherche vide, un résultat touché.
    fileprivate func demoRecherche() async {
        let ecran = ProcessInfo.processInfo.environment["REMY_DEMO_ECRAN"] ?? ""
        guard ecran.hasPrefix("reglages-") else { return }
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        rechercheActive = true
        switch ecran {
        case "reglages-recherche": recherche = "notif"
        case "reglages-recherche-vide": recherche = "trampoline"
        case "reglages-repere", "reglages-repere-ici":
            // Un sous-écran (Diagnostic), puis une ligne de Réglages même, en bas.
            recherche = ecran == "reglages-repere" ? "jauge" : "dimanche"
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if let e = RechercheReglages.premier(recherche, contexte: contexteRecherche) { aller(e, duree: 60) }
        default: break
        }
    }
}

// MARK: - Appareils connectés

/// Les appareils qui ont un jeton sur la tour (J0.8b) : nommés, avec leur
/// dernière visite ; un geste en déconnecte un.
struct AppareilsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var aDeconnecter: Appareil?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // Rafraîchissement raté : l'ancienne liste reste, mais c'est dit.
                    if app.appareils != nil, let e = app.erreurAppareils {
                        Vide(texte: e, titreAction: "Réessayer") { Task { await app.chargerAppareils() } }
                            .padding(.bottom, 8)
                    }
                    if let liste = app.appareils {
                        if liste.isEmpty {
                            Text("Aucun appareil n'a encore de jeton. Le site, lui, garde son cookie.")
                                .font(Police.texte(15))
                                .foregroundStyle(Palette.encre2)
                                .padding(.vertical, 16)
                        }
                        ForEach(liste) { a in
                            HStack(spacing: 14) {
                                Image(systemName: "iphone").font(.system(size: 18)).frame(width: 26)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(a.nom + (a.actuel == true ? " · celui-ci" : "")).font(Police.texte(16, .medium))
                                    if let vu = a.vuLe {
                                        Text("Vu \(vu.formatted(.relative(presentation: .named)))")
                                            .font(Police.texte(13))
                                            .foregroundStyle(Palette.encre2)
                                    }
                                }
                                Spacer(minLength: 8)
                                Button("Déconnecter") { aDeconnecter = a }
                                    .buttonStyle(BoutonBrut())
                            }
                            .foregroundStyle(Palette.encre)
                            .padding(.vertical, 10)
                            .frame(minHeight: 60)
                            .overlay(alignment: .bottom) { Filet() }
                        }
                    } else if let e = app.erreurAppareils {
                        Vide(texte: e, titreAction: "Réessayer") { Task { await app.chargerAppareils() } }
                    } else {
                        Squelette(largeurs: [0.7, 0.5, 0.6])
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
            }
            .background(Palette.fond)
            .navigationTitle("Appareils connectés")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fermer") { fermer() }.font(Police.texte(16, .semibold))
                }
            }
        }
        .tint(Palette.encre)
        .overlay(alignment: .bottom) { ToastView(marge: 24, annoncer: false) }
        .task { await app.chargerAppareils() }
        .confirmationDialog(aDeconnecter.map { "Déconnecter « \($0.nom) » ?" } ?? "",
                            isPresented: Binding(get: { aDeconnecter != nil }, set: { if !$0 { aDeconnecter = nil } }),
                            titleVisibility: .visible) {
            Button("Déconnecter", role: .destructive) {
                if let a = aDeconnecter { Task { await app.deconnecterAppareil(a) } }
            }
            Button("Annuler", role: .cancel) {}
        } message: {
            Text("Il faudra retaper le mot de passe sur cet appareil.")
        }
    }
}

// MARK: - Mémoire

/// Ce que Rémy sait de Sam : lu tel quel, corrigé à la demande.
struct MemoireView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var charge = false
    @State private var texteServeur = ""
    @State private var texte = ""
    @State private var edition = false
    @State private var erreur: String?
    @State private var enregistrement = false
    @State private var conflit = false

    private var modifie: Bool { edition && texte != texteServeur }

    var body: some View {
        NavigationStack {
            Group {
                if !charge {
                    if let erreur {
                        Vide(texte: erreur, titreAction: "Réessayer") { Task { await charger() } }
                            .padding(18)
                            .frame(maxHeight: .infinity, alignment: .top)
                    } else {
                        Squelette(largeurs: [0.5, 0.9, 0.8, 0.95, 0.6])
                            .padding(18)
                            .frame(maxHeight: .infinity, alignment: .top)
                    }
                } else if edition {
                    TextEditor(text: $texte)
                        .font(Police.texte(15))
                        .scrollContentBackground(.hidden)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("Rémy met ce texte à jour après vos échanges. Si quelque chose est faux, corrige-le : tu as le dernier mot.")
                                .font(Police.texte(14))
                                .foregroundStyle(Palette.encre2)
                                .fixedSize(horizontal: false, vertical: true)
                            if texteServeur.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                Text("Rémy ne sait encore rien de toi. Parle-lui, ou commence « Faire connaissance ».")
                                    .font(Police.texte(16))
                                    .foregroundStyle(Palette.encre)
                            } else {
                                Filet()
                                TexteRemy(texte: texteServeur)
                            }
                        }
                        .padding(18)
                    }
                }
            }
            .background(Palette.fond)
            .navigationTitle("Ce que Rémy sait de toi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if edition {
                        Button("Annuler") {
                            texte = texteServeur
                            edition = false
                        }
                    } else {
                        Button("Fermer") { fermer() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if edition {
                        Button(enregistrement ? "…" : "Enregistrer") { enregistrer(malgreConflit: false) }
                            .font(Police.texte(16, .semibold))
                            .disabled(!modifie || enregistrement)
                    } else if charge {
                        Button("Corriger") {
                            texte = texteServeur
                            edition = true
                        }
                        .font(Police.texte(16, .semibold))
                    }
                }
            }
        }
        .tint(Palette.encre)
        .interactiveDismissDisabled(modifie)
        .overlay(alignment: .bottom) { ToastView(marge: 24, annoncer: false) }
        .task { await charger() }
        .alert("Rémy a modifié ce texte pendant que tu le corrigeais", isPresented: $conflit) {
            Button("Garder ma version", role: .destructive) { enregistrer(malgreConflit: true) }
            Button("Voir la sienne", role: .cancel) {
                edition = false
                Task { await charger() }
            }
        } message: {
            Text("Si tu gardes ta version, ce que Rémy vient d'ajouter sera perdu.")
        }
    }

    private func charger() async {
        erreur = nil
        do {
            let m = try await app.api.memoire()
            texteServeur = m.text
            if !edition { texte = m.text }
            charge = true
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app.signaler(e); return }
            erreur = (error as? LocalizedError)?.errorDescription ?? "Impossible de lire la mémoire de Rémy."
        }
    }

    private func enregistrer(malgreConflit: Bool) {
        guard !enregistrement else { return }
        enregistrement = true
        Task {
            defer { enregistrement = false }
            do {
                if !malgreConflit {
                    // Rémy réécrit ce texte après les échanges : ne pas écraser
                    // en silence ce qu'il vient d'ajouter.
                    let actuelle = try await app.api.memoire()
                    if actuelle.text != texteServeur {
                        conflit = true
                        return
                    }
                }
                try await app.api.enregistrerMemoire(texte)
                texteServeur = texte
                edition = false
                app.dire("Enregistré : Rémy s'en servira dès maintenant.")
                Haptique.succes()
            } catch {
                app.signaler(error)
            }
        }
    }
}

// MARK: - Activité en direct (24/10)

extension ReglagesView {
    /// La tâche en cours sur l'écran verrouillé et dans la Dynamic Island.
    /// Coupée : plus aucune activité ; « Démarrer seule » coupé : seulement
    /// avec « Commencer ».
    @ViewBuilder
    var activiteEnDirect: some View {
        let autorisee = ActiviteEnDirect.partagee.autorisee
        Toggle(isOn: $activiteActive) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Activité en direct").font(Police.texte(16, .medium))
                Text(autorisee
                     ? "La tâche en cours sur l'écran verrouillé et dans la Dynamic Island, avec Terminer et +15 min."
                     : "Coupées dans les réglages de l'iPhone (Rémy › Activités en direct) : rien ne s'affichera.")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Palette.signal)
        .foregroundStyle(Palette.encre)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Filet() }
        .repere("Activité en direct")
        .onChange(of: activiteActive) { _, actif in
            Task {
                if actif { await ActiviteEnDirect.partagee.suivre() } else { await ActiviteEnDirect.partagee.toutArreter() }
            }
        }
        if activiteActive {
            Toggle(isOn: $activiteAuto) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Démarrer seule").font(Police.texte(16, .medium))
                    Text("Quand une tâche commence pendant que l'app est ouverte. Coupé : seulement avec « Commencer ».")
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(Palette.signal)
            .foregroundStyle(Palette.encre)
            .padding(.vertical, 10)
            .padding(.leading, 40)
            .frame(minHeight: 60)
            .overlay(alignment: .bottom) { Filet() }
            .repere("Démarrer seule")
        }
    }
}
