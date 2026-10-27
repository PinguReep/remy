import SwiftUI
import RemyCore

/// Le « + » : un champ déjà prêt, au clavier ou à la voix. Le genre est deviné
/// pendant la frappe (sans IA) et se corrige d'un toucher :
/// - une tâche va dans Motion (sans réseau, elle attend sur l'iPhone et part
///   au retour de Rémy, comme une idée, « Retenir » ou un dossier) ;
/// - « tomates, lait et œufs » va dans une liste (Courses par défaut) ;
/// - une phrase avec une date devient un rappel qui sonnera sur l'iPhone ;
/// - « Retenir » va dans la mémoire de Rémy ;
/// - une question s'ouvre chez Rémy ;
/// - « Projet » crée un dossier (sous-projet, catégorie) dans Remy.
/// Plusieurs choses d'un coup : Rémy (GLM, sur tes machines) les range une à
/// une, et rien ne part avant le récapitulatif validé.
struct CaptureView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @Environment(EtatInterface.self) private var ui
    @State private var texte = ""
    @State private var choisi: GenreCapture?
    @State private var listeChoisie: String?
    @State private var envoi = false
    @State private var etiquetteRetiree = false
    @State private var parentChoisi: String??
    @State private var analyse: [ElementCapture]?
    @State private var garde: Set<String> = []
    @State private var analyseEnCours = false
    @FocusState private var focus: Bool
    /// Réglages : une pensée sans action claire va dans les Idées (défaut) ou dans Motion.
    @AppStorage(GenreCapture.cleParDefaut) private var parDefaut = "idees"

    private var genre: GenreCapture {
        choisi ?? GenreCapture.deviner(texte, parDefaut: parDefaut == "motion" || !projetPret ? .tache : .idee)
    }
    private var propre: String { texte.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var dateLue: AnalyseDate.Resultat? { AnalyseDate.extraire(propre) }
    private var articles: [String] {
        let a = GenreCapture.articles(propre)
        return a.isEmpty ? (propre.isEmpty ? [] : [propre]) : a
    }
    /// Listes et rappels vivent sur la tour : sans sa mise à jour, ils attendent.
    private var carnetPret: Bool { app.carnet.disponible }
    private var projetPret: Bool { app.organisation.dossiersDisponibles }
    private var analysePossible: Bool { app.serveur?.sait("analyse-capture-v1") == true }
    /// Une capture qui part vers la tour, alors que la tour ne répond pas.
    private var attendraLaTour: Bool {
        [.tache, .idee, .retenir, .projet].contains(genre) && (app.horsLigne || app.tableau.erreurReseau)
    }
    private var micro: Bool { app.dictee.micro != nil && app.tableau.donnees?.systeme?.transcription != false }
    private var pret: Bool {
        guard !propre.isEmpty, !envoi else { return false }
        switch genre {
        case .retenir: return propre.count >= GenreCapture.minimumRetenir
        case .liste, .rappel: return carnetPret
        case .projet, .idee: return projetPret
        default: return true
        }
    }

    var body: some View {
        Group {
            if let elements = analyse {
                recapitulatif(elements)
            } else {
                formulaire
            }
        }
        .padding(20)
        // En haut de la feuille : sinon le contenu flotte au milieu du détent.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // L'envoi collé au clavier, sous le pouce (24/10 : il était en haut,
        // au-dessus de 300 pt de vide).
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if analyse == nil { barreEnvoi }
        }
        .background(Palette.surface)
        // La feuille a sa copie du message : sinon il passerait dessous.
        .overlay(alignment: .bottom) { ToastView(marge: 12, annoncer: false) }
        .presentationDetents(analyse != nil ? [.large] : [.height(genre == .liste || genre == .projet ? 470 : 430), .medium, .large])
        .presentationDragIndicator(.visible)
        .onAppear {
            if let t = ui.texteDemo { texte = t; ui.texteDemo = nil }
            // Fermée en route (un appel, une notification) : le texte revient (24/10).
            if texte.isEmpty, let b = BrouillonCapture.lire() {
                texte = b
                app.dire("Ton brouillon est revenu.")
            }
            focus = true
            if ui.analyseDemo {
                ui.analyseDemo = false
                Task {
                    try? await Task.sleep(nanoseconds: 800_000_000)
                    await analyser()
                }
            }
            app.dictee.destination = { dit in
                texte = texte.isEmpty ? dit : texte + (texte.hasSuffix(" ") ? "" : " ") + dit
            }
        }
        .onChange(of: texte) { _, t in BrouillonCapture.garder(t) }
        .onDisappear {
            app.dictee.annuler(sansMessage: true)
            app.dictee.destination = nil
        }
    }

    /// Réussi : le brouillon n'a plus lieu d'être, la feuille se ferme.
    private func finir() {
        BrouillonCapture.effacer()
        fermer()
    }

    // MARK: Saisie

    private var formulaire: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Noter").font(Police.titre(22)).foregroundStyle(Palette.encre)
                Spacer()
                bouton("xmark", "Fermer") { fermer() }
            }
            if app.dictee.etat == .repos, !app.dictee.enAttente.isEmpty {
                VocauxEnAttente()
            }
            switch app.dictee.etat {
            case .enregistrement(let debut):
                BarreEnregistrement(debut: debut)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Palette.signal, lineWidth: 1.5))
            case .transcription:
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Je transcris ta voix sur la tour…").font(Police.texte(15, .medium)).foregroundStyle(Palette.encre2)
                }
                .frame(minHeight: 50)
            case .repos:
                TextField("Une idée, une tâche, des courses, un rappel…", text: $texte, axis: .vertical)
                    .font(Police.texte(19))
                    .foregroundStyle(Palette.encre)
                    .lineLimit(1...6)
                    .focused($focus)
                    // Retour reste un saut de ligne : « tomates⏎lait » fait deux
                    // articles, deux lignes deux intentions. Ajouter est sous le pouce.
                    .accessibilityIdentifier("capture.champ")
            }
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: icone(genre)).font(.system(size: 12, weight: .semibold))
                Text(apercu).fixedSize(horizontal: false, vertical: true)
            }
            .font(Police.texte(13, .medium))
            .foregroundStyle(propre.isEmpty ? Palette.encre3 : Palette.encre2)
            .animation(.snappy, value: genre)
            // Rémy injoignable (25/10) : dit avant d'ajouter, rien ne se perd.
            if !propre.isEmpty, attendraLaTour {
                Label("Rémy est injoignable : ce sera gardé sur l'iPhone et envoyé dès qu'il répond.", systemImage: "tray.and.arrow.up")
                    .font(Police.texte(13, .medium))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("capture.attendra")
            }
            if analysePossible && GenreCapture.plusieursIntentions(propre) {
                Button {
                    Task { await analyser() }
                } label: {
                    HStack(spacing: 8) {
                        if analyseEnCours { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles") }
                        Text(analyseEnCours ? "Rémy range…" : "Plusieurs choses ? Rémy les range une à une")
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .font(Police.texte(14, .semibold))
                    .foregroundStyle(Palette.signal)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(Palette.signal.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(Appui())
                .disabled(analyseEnCours)
            }
            // Les six genres passent à la ligne : aucun n'est caché hors de l'écran (24/10).
            Flux(espacement: 8) {
                ForEach(GenreCapture.allCases, id: \.self) { g in
                    puce(g.libelle, symbole: icone(g), actif: genre == g) {
                        choisi = (choisi == g) ? nil : g
                    }
                    .accessibilityIdentifier("capture.genre." + g.rawValue)
                }
            }
            if genre == .liste && carnetPret && !app.carnet.listes.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(app.carnet.listes) { l in
                            puce(l.nom, symbole: nil, actif: cible?.id == l.id, discrete: true) { listeChoisie = l.id }
                        }
                    }
                }
            }
            if genre == .rappel, let e = etiquetteDevinee {
                HStack(spacing: 8) {
                    puce(e.nom, symbole: "tag", actif: !etiquetteRetiree, discrete: true) { etiquetteRetiree.toggle() }
                    Text(etiquetteRetiree ? "sans étiquette" : "étiquette devinée").font(Police.texte(12)).foregroundStyle(Palette.encre3)
                }
            }
            if genre == .projet && projetPret {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        puce("À part", symbole: "folder", actif: parentEffectif == nil, discrete: true) { parentChoisi = .some(nil) }
                        ForEach(parents, id: \.id) { p in
                            puce(p.nom, symbole: nil, actif: parentEffectif == p.id, discrete: true) { parentChoisi = .some(p.id) }
                        }
                    }
                }
            }
        }
    }

    /// Sous le pouce, juste au-dessus du clavier : dicter, et ajouter.
    private var barreEnvoi: some View {
        HStack(spacing: 10) {
            if micro, app.dictee.etat == .repos {
                Button {
                    Haptique.leger()
                    focus = false
                    Task { await app.dictee.commencer() }
                } label: {
                    Image(systemName: "mic")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Palette.encre)
                        .frame(width: 50, height: 50)
                        .background(Palette.fond2, in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(Appui())
                .accessibilityLabel("Dicter")
            }
            BoutonA(titre: envoi ? "…" : action, symbole: "arrow.up") { Task { await noter() } }
                .accessibilityIdentifier("capture.valider")
                .disabled(!pret)
                .opacity(pret ? 1 : 0.45)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(Palette.surface)
        .overlay(alignment: .top) { Rectangle().fill(Palette.filet).frame(height: 1) }
    }

    /// La liste visée : celle choisie, sinon « Courses », sinon la première.
    private var cible: Liste? {
        if let id = listeChoisie, let l = app.carnet.listes.first(where: { $0.id == id }) { return l }
        return app.carnet.listes.first { $0.nom.compare("courses", options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }
            ?? app.carnet.listes.first
    }

    private var etiquetteDevinee: RemyCore.Etiquette? { EtiquetteDevinee.pour(propre, parmi: app.organisation.etiquettes) }

    /// Les endroits où ranger un projet : projets Motion et dossiers existants.
    private var parents: [(id: String, nom: String)] {
        (app.projets.liste?.projets ?? []).map { ("motion:" + $0.id, $0.nom) } + app.organisation.dossiers.map { ($0.id, $0.nom) }
    }

    /// Choisi, sinon dit dans la phrase (« dans Boutique de bougies »), sinon deviné par les mots.
    private var parentEffectif: String? {
        if let c = parentChoisi { return c }
        let p = GenreCapture.projet(propre, parents: parents.map(\.nom))
        if let dit = app.parentPour(p.parent) { return dit }
        return app.organisation.suggestion(pour: p.titre, projets: app.projets.liste?.projets ?? [])?.id
    }

    private func bouton(_ symbole: String, _ libelle: String, _ faire: @escaping () -> Void) -> some View {
        Button { faire() } label: {
            Image(systemName: symbole)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Palette.encre2)
                .frame(width: 32, height: 32)
                .background(Palette.fond2, in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(libelle)
    }

    private func puce(_ titre: String, symbole: String?, actif: Bool, discrete: Bool = false, _ faire: @escaping () -> Void) -> some View {
        Button {
            Haptique.leger()
            faire()
        } label: {
            HStack(spacing: 5) {
                if let symbole { Image(systemName: symbole).font(.system(size: 12, weight: .semibold)) }
                Text(titre).lineLimit(1)
            }
            .font(Police.texte(14, .semibold))
            .foregroundStyle(actif ? Palette.fond : Palette.encre)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(actif ? (discrete ? Palette.encre2 : Palette.encre) : Palette.fond2, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(Appui())
        .accessibilityAddTraits(actif ? .isSelected : [])
    }

    private var apercu: String {
        guard !propre.isEmpty else { return micro ? "Écris ou dicte : Rémy devine où le ranger." : "Écris, Rémy devine où le ranger." }
        switch genre {
        case .tache:
            // Le jour compris reste une date limite, jamais un créneau fixe. Le
            // titre qui partira est montré tel quel : sans la date quand elle
            // était au bout, la phrase entière sinon.
            guard let d = dateLue else { return "Tâche → Motion lui trouvera un créneau" }
            let titre = GenreCapture.texte(propre, date: d, genre: .tache)
            return "Tâche « \(titre) » → Motion lui trouvera un créneau avant l'échéance : \(Format.echeanceLongue(d.echeance))"
        case .idee:
            guard projetPret else { return "Les Idées arriveront avec la mise à jour de ta tour." }
            return "Idée → gardée dans « Idées » (Projets), rien n'est planifié"
        case .liste:
            guard carnetPret else { return "Les listes arriveront avec la mise à jour de ta tour." }
            let n = articles.count
            return "\(n) article\(n > 1 ? "s" : "") → \(cible?.nom ?? "Courses (créée)")"
        case .rappel:
            guard carnetPret else { return "Les rappels arriveront avec la mise à jour de ta tour." }
            guard let d = dateLue else { return "Rappel sans date (ajoute « demain 9h », « lundi », « le 12/11 »…)" }
            return "Rappel → \(LigneRappel.quand(d.quand.millis)) : « \(GenreCapture.texte(propre, date: d, genre: .rappel)) »"
        case .retenir:
            let manque = GenreCapture.minimumRetenir - propre.count
            return manque > 0 ? "Retenir → encore \(manque) caractère\(manque > 1 ? "s" : "") pour que Rémy en tire quelque chose"
                              : "Retenir → dans la mémoire de Rémy"
        case .question: return "Question → s'ouvre chez Rémy, prête à envoyer"
        case .projet:
            guard projetPret else { return "Les sous-projets arriveront avec la mise à jour de ta tour." }
            let p = GenreCapture.projet(propre, parents: parents.map(\.nom))
            let ou = parentEffectif.flatMap { id in parents.first { $0.id == id }?.nom }
            return "Dossier « \(p.titre) »" + (ou.map { " dans « \($0) »" } ?? " à part") + " (Remy ; pas de projet Motion)"
        }
    }

    private var action: String {
        switch genre {
        case .tache: return "Ajouter à Motion"
        case .idee: return "Garder l'idée"
        case .liste: return "Ajouter à la liste"
        case .rappel: return "Créer le rappel"
        case .retenir: return "Retenir"
        case .question: return "Ouvrir chez Rémy"
        case .projet: return "Créer le dossier"
        }
    }

    private func icone(_ g: GenreCapture) -> String {
        switch g {
        case .tache: return "checkmark.circle"
        case .idee: return "tray.and.arrow.down"
        case .liste: return "cart"
        case .rappel: return "bell"
        case .retenir: return "lightbulb"
        case .question: return "bubble.left"
        case .projet: return "folder"
        }
    }

    /// Le texte reste dans le champ tant que rien n'a réussi.
    private func noter() async {
        guard pret else { return }
        envoi = true
        defer { envoi = false }
        Haptique.leger()
        switch genre {
        case .tache:
            // « Déjà dans Motion » compte comme réussi : la feuille se ferme.
            // Le jour compris (« vendredi ») part comme échéance, même si le
            // genre a été changé à la main. Sans réseau (25/10), la tâche
            // attend sur l'iPhone telle que comprise, et part au retour de Rémy.
            let d = dateLue
            let titre = GenreCapture.texte(propre, date: d, genre: .tache)
            if await app.noterTache(titre, echeance: d?.echeance) { finir() } else { Haptique.erreur() }
        case .idee:
            if await app.noterIdee(propre) { finir() } else { Haptique.erreur() }
        case .liste:
            let l = cible ?? app.carnet.listeParDefaut()
            let n = app.carnet.noter(articles, dans: l)
            guard !n.nouveaux.isEmpty || !n.dejaLa.isEmpty else { return }
            let deja = n.dejaLa.map { "« \($0) »" }.joined(separator: ", ")
            if n.nouveaux.isEmpty {
                app.dire("Déjà dans « \(l.nom) » : \(deja).")
            } else {
                let ajoutes = n.nouveaux
                app.dire("\(ajoutes.count) article\(ajoutes.count > 1 ? "s" : "") dans « \(l.nom) »." + (deja.isEmpty ? "" : " Déjà dans ta liste : \(deja)."), annuler: {
                    app.carnet.retirer(ajoutes, de: l)
                })
            }
            finir()
        case .rappel:
            await creerRappel(dateLue)
        case .retenir:
            if await app.retenirNote(propre) { finir() } else { Haptique.erreur() }
        case .question:
            if await app.preparer(propre, dansFil: "") {
                finir()
            } else {
                app.dire("Tu as déjà un message en cours pour Rémy : finis-le d'abord, ta question est toujours là.")
            }
        case .projet:
            let p = GenreCapture.projet(propre, parents: parents.map(\.nom))
            let ou = parentEffectif
            if await app.noterDossier(p.titre.isEmpty ? propre : p.titre, parent: ou, nomParent: ou.flatMap { id in parents.first { $0.id == id }?.nom }) {
                finir()
            } else {
                Haptique.erreur()
            }
        }
    }

    /// Un rappel du carnet, gardé sur l'iPhone.
    private func creerRappel(_ d: AnalyseDate.Resultat?) async {
        let texteRappel = GenreCapture.texte(propre, date: d, genre: .rappel)
        let etiquettes = etiquetteRetiree ? nil : etiquetteDevinee.map { [$0.id] }
        guard let n = app.carnet.noterRappel(texteRappel, quand: d?.quand, etiquettes: etiquettes) else { return }
        // L'autorisation d'iOS d'abord : la confirmation et son « Annuler »
        // ne s'usent pas derrière la question du système.
        if d != nil { await Notifications.demander() }
        if n.dejaLa {
            app.dire("Déjà dans tes rappels : « \(n.rappel.texte) ».")
        } else {
            let r = n.rappel
            app.dire(d.map { "Rappel : \(LigneRappel.quand($0.quand.millis))." } ?? "Rappel noté, sans date.", annuler: {
                app.carnet.supprimer(r)
            })
        }
        finir()
    }

    // MARK: Plusieurs intentions

    private func analyser() async {
        guard !analyseEnCours else { return }
        analyseEnCours = true
        defer { analyseEnCours = false }
        do {
            let elements = try await app.api.analyserCapture(propre)
            guard !elements.isEmpty else {
                app.dire("Rémy n'a rien trouvé à ranger : choisis le genre toi-même.")
                return
            }
            garde = Set(elements.filter(\.pret).map(\.cle))
            focus = false
            withAnimation(.snappy) { analyse = elements }
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app.signaler(e); return }
            app.dire((error as? LocalizedError)?.errorDescription ?? "Rémy n'a pas pu ranger : choisis le genre toi-même.")
        }
    }

    private func recapitulatif(_ elements: [ElementCapture]) -> some View {
        let agenda = app.tableau.donnees?.systeme?.agenda == true
        let choisis = elements.filter { garde.contains($0.cle) }
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Button { withAnimation(.snappy) { analyse = nil } } label: {
                    Label("Retour", systemImage: "chevron.left").font(Police.texte(15, .medium)).foregroundStyle(Palette.encre2)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                Spacer()
                bouton("xmark", "Fermer") { fermer() }
            }
            Text("Rémy a trouvé \(elements.count) chose\(elements.count > 1 ? "s" : "")").font(Police.titre(22)).foregroundStyle(Palette.encre)
            Text("Rien ne part avant que tu valides. Décoche ce qui ne va pas, complète ce qui manque.")
                .font(Police.texte(13)).foregroundStyle(Palette.encre2)
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(elements) { e in ligneElement(e, agenda: agenda) }
                }
            }
            BoutonA(titre: envoi ? "…" : "Ranger \(choisis.count) élément\(choisis.count > 1 ? "s" : "")", symbole: "tray.and.arrow.down") {
                guard !envoi, !choisis.isEmpty else { return }
                envoi = true
                Task {
                    let bilan = await app.ranger(choisis)
                    envoi = false
                    app.dire(bilan.phrase)
                    if bilan.echecs.isEmpty {
                        finir()
                    } else {
                        // Seul ce qui a raté reste coché : « Ranger » ne refait pas le reste.
                        garde.subtract(bilan.regles)
                        Haptique.erreur()
                    }
                }
            }
            .disabled(choisis.isEmpty || envoi || choisis.contains { !$0.pret })
            .opacity(choisis.isEmpty || choisis.contains { !$0.pret } ? 0.45 : 1)
            // File du quota Motion (24/10) : l'attente se dit, la feuille reste ouverte.
            if envoi, let a = app.attenteMotion {
                Label(a.phrase, systemImage: "hourglass")
                    .font(Police.texte(13, .medium))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func ligneElement(_ e: ElementCapture, agenda: Bool) -> some View {
        let actif = garde.contains(e.cle)
        let i = analyse?.firstIndex { $0.cle == e.cle }
        return HStack(alignment: .top, spacing: 12) {
            CaseACocher(cochee: actif) {
                if actif { garde.remove(e.cle) } else { garde.insert(e.cle) }
            }
            VStack(alignment: .leading, spacing: 4) {
                if let i {
                    TextField("Titre", text: Binding(get: { analyse?[i].titre ?? "" }, set: { analyse?[i].titre = $0 }))
                        .font(Police.texte(16, .medium))
                        .foregroundStyle(Palette.encre)
                }
                Label(e.destination(agenda: agenda), systemImage: iconeNature(e.nature))
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                if !e.pret, let i {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(e.question ?? "À préciser").font(Police.texte(13, .semibold)).foregroundStyle(Palette.danger)
                        if e.nature == "rendez-vous" {
                            DatePicker("Quand", selection: Binding(
                                get: { (analyse?[i].quand ?? Date().millis).date },
                                set: { analyse?[i].quand = $0.millis; analyse?[i].heureConnue = true; analyse?[i].question = nil; garde.insert(e.cle) }
                            ))
                            .environment(\.locale, Format.locale)
                            .environment(\.timeZone, Format.fuseau)
                            .font(Police.texte(14))
                        } else {
                            Button("C'est bon comme ça") { analyse?[i].question = nil; garde.insert(e.cle) }
                                .font(Police.texte(14, .semibold))
                                .frame(minHeight: 36)
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(Palette.fond2.opacity(actif ? 1 : 0.5), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func iconeNature(_ n: String) -> String {
        switch n {
        case "tache": return "checkmark.circle"
        case "rappel": return "bell"
        case "contrainte": return "hourglass"
        case "liste": return "cart"
        case "note": return "note.text"
        case "rendez-vous": return "calendar"
        case "projet": return "folder"
        default: return "questionmark.circle"
        }
    }
}
