import SwiftUI
import RemyCore

// Le carnet dans l'onglet Projets (J1.5) : les listes en tête, en tuiles qui
// s'adaptent à l'écran ; un appui long pour créer une liste et choisir la
// disposition (Sam, 15/10 : pas de bouton « Ajouter une liste »). Puis les
// rappels à venir.

/// Où mène un toucher dans l'onglet Projets.
enum RouteProjets: Hashable {
    case liste(String)
    case rappels
    /// Un projet Motion (« motion:<id> ») ou un dossier de Remy : son arborescence.
    case noeud(String)
}

/// 0 : automatique ; 1, 2 ou 3 listes par ligne.
enum DispositionListes {
    static func colonnes(_ choix: Int, nombre: Int) -> Int {
        if (1...3).contains(choix) { return choix }
        switch nombre {
        case 0, 1: return 1
        case 2: return 2
        case 3: return 3
        case 4: return 2
        default: return 3
        }
    }
}

// MARK: - Les listes en tuiles

struct SectionListes: View {
    @Environment(AppModel.self) private var app
    @AppStorage("dispositionListes") private var disposition = 0
    @State private var nouvelle = false
    @State private var nom = ""
    @State private var aRenommer: Liste?

    var body: some View {
        let listes = app.carnet.listes
        let colonnes = DispositionListes.colonnes(disposition, nombre: listes.count)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                TitreSection(texte: "Listes", compte: listes.isEmpty ? nil : listes.count).padding(.horizontal, 6)
                Spacer()
                // Visible (24/10) : l'appui long reste un raccourci.
                Menu { menu(nil) } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Palette.encre2)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Nouvelle liste, disposition")
            }
            if listes.isEmpty {
                Text("Touche « + » (ou appuie longuement ici) pour créer ta première liste : courses, anniversaires…")
                    .font(Police.texte(14))
                    .foregroundStyle(Palette.encre2)
                    .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
                    .padding(.horizontal, 16)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(Palette.filet, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                    .contentShape(Rectangle())
                    .contextMenu { menu(nil) }
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: colonnes), spacing: 10) {
                    ForEach(listes) { l in
                        NavigationLink(value: RouteProjets.liste(l.id)) {
                            TuileListe(liste: l, large: colonnes == 1)
                        }
                        .buttonStyle(Appui())
                        .contextMenu { menu(l) }
                    }
                }
                .animation(.snappy, value: colonnes)
            }
        }
        .padding(.horizontal, 16)
        .alert("Nouvelle liste", isPresented: $nouvelle) {
            TextField("Courses, anniversaires…", text: $nom)
            Button("Créer") {
                if app.carnet.creerListe(nom) != nil { Haptique.succes() }
                nom = ""
            }
            Button("Annuler", role: .cancel) { nom = "" }
        }
        .alert("Renommer la liste", isPresented: Binding(get: { aRenommer != nil }, set: { if !$0 { aRenommer = nil } })) {
            TextField("Nom", text: $nom)
            Button("Renommer") {
                if let l = aRenommer { app.carnet.renommer(l, en: nom) }
                nom = ""
            }
            Button("Annuler", role: .cancel) { nom = "" }
        }
    }

    /// L'appui long : créer, disposer, et pour une liste, la renommer ou la supprimer.
    @ViewBuilder
    private func menu(_ l: Liste?) -> some View {
        Button { nouvelle = true } label: { Label("Nouvelle liste", systemImage: "plus") }
        Menu {
            Picker("Disposition", selection: $disposition) {
                Text("Automatique").tag(0)
                Text("Une par ligne").tag(1)
                Text("Deux par ligne").tag(2)
                Text("Trois par ligne").tag(3)
            }
        } label: { Label("Disposition", systemImage: "square.grid.2x2") }
        if let l {
            Button {
                nom = l.nom
                aRenommer = l
            } label: { Label("Renommer", systemImage: "pencil") }
            Button(role: .destructive) { app.carnet.supprimer(l) } label: { Label("Supprimer", systemImage: "trash") }
        }
    }
}

private struct TuileListe: View {
    let liste: Liste
    let large: Bool

    var body: some View {
        let couleur = Palette.projet(liste.nom)
        let total = liste.elements.count
        Group {
            if large {
                HStack(spacing: 14) { icone(couleur); textes; Spacer(); chevron }
            } else {
                VStack(alignment: .leading, spacing: 10) { icone(couleur); textes }
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(14)
        .frame(minHeight: large ? 64 : 104, alignment: .topLeading)
        .carte(rayon: 18)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(liste.nom), \(liste.restants) sur \(total) à prendre")
    }

    private func icone(_ couleur: Color) -> some View {
        Image(systemName: Self.symbole(liste.nom))
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(couleur)
            .frame(width: 32, height: 32)
            .background(couleur.opacity(0.14), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private var textes: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(liste.nom).font(Police.texte(15, .semibold)).foregroundStyle(Palette.encre).lineLimit(2)
            Text(liste.elements.isEmpty ? "vide" : liste.restants == 0 ? "tout est pris" : "\(liste.restants) à prendre")
                .font(Police.texte(12))
                .foregroundStyle(Palette.encre2)
        }
    }

    private var chevron: some View {
        Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.encre3)
    }

    /// Une icône devinée du nom, sinon une liste.
    static func symbole(_ nom: String) -> String {
        let n = nom.lowercased()
        if n.contains("course") || n.contains("magasin") || n.contains("supermarch") { return "cart" }
        if n.contains("pharma") || n.contains("santé") { return "cross.case" }
        if n.contains("anniv") || n.contains("cadeau") { return "gift" }
        if n.contains("film") || n.contains("série") || n.contains("livre") { return "book" }
        if n.contains("voyage") || n.contains("valise") { return "suitcase" }
        return "checklist"
    }
}

// MARK: - Une liste

struct ListeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var retour
    let id: String
    @State private var saisie = ""
    @State private var renommer = false
    @State private var nom = ""
    @FocusState private var focus: Bool

    var body: some View {
        if let l = app.carnet.listes.first(where: { $0.id == id }) {
            let aFaire = l.elements.filter { !$0.fait }
            let faits = l.elements.filter(\.fait)
            List {
                if l.elements.isEmpty {
                    Text("Rien dans cette liste. Écris en bas : « tomates, lait » en ajoute deux.")
                        .font(Police.texte(15))
                        .foregroundStyle(Palette.encre2)
                        .listRowBackground(Palette.fond)
                }
                Section {
                    ForEach(aFaire) { e in ligne(e, l) }
                }
                if !faits.isEmpty {
                    Section {
                        ForEach(faits) { e in ligne(e, l) }
                    } header: {
                        TitreSection(texte: "Pris", compte: faits.count)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Palette.fond)
            .safeAreaInset(edge: .bottom) { ajout(l) }
            .navigationTitle(l.nom)
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { nom = l.nom; renommer = true } label: { Label("Renommer", systemImage: "pencil") }
                        Button { app.carnet.effacerCoches(l) } label: { Label("Retirer les articles pris", systemImage: "checkmark.circle") }
                            .disabled(faits.isEmpty)
                        Button(role: .destructive) {
                            retour()
                            app.carnet.supprimer(l)
                        } label: { Label("Supprimer la liste", systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis.circle").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Actions de la liste")
                }
            }
            .alert("Renommer la liste", isPresented: $renommer) {
                TextField("Nom", text: $nom)
                Button("Renommer") { app.carnet.renommer(l, en: nom) }
                Button("Annuler", role: .cancel) {}
            }
        } else {
            Vide(texte: "Cette liste n'existe plus.")
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(Palette.fond)
        }
    }

    private func ligne(_ e: ElementListe, _ l: Liste) -> some View {
        Button {
            Haptique.leger()
            withAnimation(.snappy) { app.carnet.basculer(e, dans: l) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: e.fait ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(e.fait ? Palette.encre3 : Palette.encre2)
                Text(e.texte)
                    .font(Police.texte(17))
                    .strikethrough(e.fait)
                    .foregroundStyle(e.fait ? Palette.encre3 : Palette.encre)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(Palette.fond)
        .swipeActions {
            Button(role: .destructive) { app.carnet.supprimer(e, dans: l) } label: { Label("Retirer", systemImage: "trash") }
        }
        .accessibilityAddTraits(e.fait ? .isSelected : [])
    }

    private func ajout(_ l: Liste) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "plus.circle.fill").font(.system(size: 22)).foregroundStyle(Palette.signal)
            TextField("Ajouter un article…", text: $saisie)
                .font(Police.texte(17))
                .focused($focus)
                .submitLabel(.done)
                .onSubmit {
                    let articles = GenreCapture.articles(saisie)
                    app.carnet.ajouter(articles.isEmpty ? [saisie] : articles, a: l)
                    saisie = ""
                    focus = true // on enchaîne les articles
                }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        .background(Palette.surface)
        .overlay(alignment: .top) { Rectangle().fill(Palette.filet).frame(height: 1) }
    }
}

// MARK: - Les rappels

struct SectionRappels: View {
    @Environment(AppModel.self) private var app
    @State private var nouveau = false
    @State private var import_ = ImportRappels()

    var body: some View {
        let prochains = app.carnet.rappels.filter { !$0.fait }.prefix(4)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                TitreSection(texte: "Rappels", compte: app.carnet.rappels.filter { !$0.fait }.count).padding(.horizontal, 6)
                Spacer()
                // Visible (24/10) : le même menu que l'appui long sur la carte.
                Menu {
                    Button { nouveau = true } label: { Label("Nouveau rappel", systemImage: "plus") }
                    Button { Task { await import_.lancer(app) } } label: { Label("Importer mes rappels Apple", systemImage: "square.and.arrow.down") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(Palette.encre2)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Nouveau rappel, importer")
                NavigationLink(value: RouteProjets.rappels) {
                    Text("Tout voir").font(Police.texte(13, .medium)).foregroundStyle(Palette.encre2)
                        .frame(minHeight: 44).contentShape(Rectangle())
                }
            }
            VStack(spacing: 0) {
                if prochains.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Aucun rappel. Note-en un avec le « + » (« appeler le garage demain à 9h »), ou reprends ceux de l'iPhone.")
                            .font(Police.texte(14))
                            .foregroundStyle(Palette.encre2)
                            .fixedSize(horizontal: false, vertical: true)
                        BoutonA(titre: import_.enCours ? "Import…" : "Importer mes rappels Apple", symbole: "square.and.arrow.down",
                                principal: false, hauteur: 44) {
                            Task { await import_.lancer(app) }
                        }
                        .disabled(import_.enCours)
                    }
                    .padding(.vertical, 12)
                } else {
                    ForEach(Array(prochains.enumerated()), id: \.element.id) { i, r in
                        LigneRappel(rappel: r)
                        if i < prochains.count - 1 { Rectangle().fill(Palette.filet).frame(height: 1).padding(.leading, 44) }
                    }
                }
            }
            .padding(.horizontal, 14)
            .carte(rayon: 18)
            .contextMenu {
                Button { nouveau = true } label: { Label("Nouveau rappel", systemImage: "plus") }
                Button { Task { await import_.lancer(app) } } label: { Label("Importer mes rappels Apple", systemImage: "square.and.arrow.down") }
            }
        }
        .padding(.horizontal, 16)
        .sheet(isPresented: $nouveau) { NouveauRappel() }
    }
}

/// Un rappel : le rond le coche ; toucher le texte ouvre « Quand ? »
/// (reporter, étiquettes, retirer — 24/10 : on ne pouvait pas le reporter).
struct LigneRappel: View {
    @Environment(AppModel.self) private var app
    let rappel: Rappel
    @State private var etiquetter = false
    @State private var quand = false

    var body: some View {
        HStack(spacing: 12) {
            Button {
                Haptique.leger()
                withAnimation(.snappy) { app.carnet.basculer(rappel) }
            } label: {
                Image(systemName: rappel.fait ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(rappel.fait ? Palette.encre3 : Palette.encre2)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(rappel.fait ? "« \(rappel.texte) » : fait" : "Marquer « \(rappel.texte) » comme fait")
            Button {
                Haptique.leger()
                quand = true
            } label: {
                details.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Reporter, étiqueter ou retirer")
        }
        .frame(minHeight: 52)
        .contentShape(Rectangle())
        .contextMenu {
            Button { quand = true } label: { Label("Reporter…", systemImage: "clock.arrow.circlepath") }
            if app.organisation.etiquettesDisponibles {
                Button { etiquetter = true } label: { Label("Étiquettes…", systemImage: "tag") }
            }
            Button(role: .destructive) { app.carnet.supprimer(rappel) } label: { Label("Retirer", systemImage: "trash") }
        }
        .sheet(isPresented: $etiquetter) { EtiquetterRappel(rappel: rappel) }
        .sheet(isPresented: $quand) { QuandRappel(rappel: rappel) }
    }

    private var details: some View {
            VStack(alignment: .leading, spacing: 2) {
                Text(rappel.texte)
                    .font(Police.texte(16, .medium))
                    .strikethrough(rappel.fait)
                    .foregroundStyle(rappel.fait ? Palette.encre3 : Palette.encre)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    if let q = rappel.quand {
                        let enRetard = !rappel.fait && q < Date().millis
                        Text(Self.quand(q))
                            .font(Police.mono(12))
                            .foregroundStyle(enRetard ? Palette.danger : Palette.encre2)
                    } else {
                        Text("sans date").font(Police.texte(12)).foregroundStyle(Palette.encre3)
                    }
                    if rappel.source == "apple" {
                        Text("importé").font(Police.texte(11, .semibold)).foregroundStyle(Palette.encre3)
                    }
                    ForEach(rappel.etiquettes ?? [], id: \.self) { id in
                        if let nom = app.organisation.nom(id) {
                            Text(nom)
                                .font(Police.texte(11, .semibold))
                                .foregroundStyle(Palette.encre2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Palette.fond2, in: Capsule())
                        }
                    }
                }
            }
    }

    /// « aujourd'hui 18:00 », « demain 09:00 », « jeu. 22 oct. 09:00 »
    static func quand(_ ms: Millis) -> String { CarnetModel.quand(ms) }
}

/// « Quand ? » : reporter un rappel en un toucher (avec « Annuler »), ou à une
/// date choisie ; ses étiquettes ; le retirer. La notification suit.
struct QuandRappel: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    let rappel: Rappel
    @State private var choisir = false
    @State private var date = Date().addingTimeInterval(3600)
    @State private var etiquetter = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(rappel.texte)
                        .font(Police.titre(22))
                        .foregroundStyle(Palette.encre)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    Text(rappel.quand.map { "Prévu " + LigneRappel.quand($0) } ?? "Sans date")
                        .font(Police.mono(12))
                        .foregroundStyle(Palette.encre2)
                }
                Spacer(minLength: 8)
                BoutonFermer { fermer() }
            }
            VStack(alignment: .leading, spacing: 10) {
                TitreSection(texte: "Quand ?")
                Flux(espacement: 8) {
                    ForEach(Decaler.rappel()) { c in
                        PuceRappel(titre: c.libelle) { reporter(c.date) }
                    }
                    PuceRappel(titre: "Choisir…", symbole: "calendar") {
                        withAnimation(.snappy) { choisir.toggle() }
                    }
                }
                if choisir {
                    DatePicker("Le", selection: $date, in: Date()...)
                        .environment(\.locale, Format.locale)
                        .environment(\.timeZone, Format.fuseau)
                        .font(Police.texte(15))
                    BoutonA(titre: "Reporter : \(LigneRappel.quand(date.millis))", symbole: "clock.arrow.circlepath", hauteur: 46) {
                        reporter(date)
                    }
                }
            }
            Rectangle().fill(Palette.filet).frame(height: 1)
            HStack(spacing: 10) {
                if app.organisation.etiquettesDisponibles {
                    BoutonA(titre: "Étiquettes", symbole: "tag", principal: false, hauteur: 46) { etiquetter = true }
                }
                BoutonA(titre: rappel.fait ? "Pas encore fait" : "Fait", symbole: rappel.fait ? "arrow.uturn.backward" : "checkmark", hauteur: 46) {
                    Haptique.leger()
                    app.carnet.basculer(rappel)
                    fermer()
                }
            }
            Button(role: .destructive) {
                Haptique.leger()
                app.carnet.supprimer(rappel)
                fermer()
            } label: {
                Label("Retirer ce rappel", systemImage: "trash")
                    .font(Police.texte(15, .medium))
                    .foregroundStyle(Palette.danger)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.plain)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Palette.surface)
        // La feuille a sa copie du message : sinon il passerait dessous.
        .overlay(alignment: .bottom) { ToastView(marge: 12, annoncer: false) }
        .presentationDetents(choisir ? [.large] : [.medium, .large])
        .presentationDragIndicator(.visible)
        .sheet(isPresented: $etiquetter) { EtiquetterRappel(rappel: rappel) }
    }

    private func reporter(_ d: Date) {
        Haptique.leger()
        app.carnet.reporter(rappel, a: d)
        // Le rappel sonnera : la permission est demandée au premier rappel daté.
        Task { await Notifications.demander() }
        fermer()
    }
}

/// Une puce de « Quand ? » : elle passe à la ligne (Flux), rien n'est caché.
private struct PuceRappel: View {
    let titre: String
    var symbole: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let symbole { Image(systemName: symbole).font(.system(size: 13, weight: .semibold)) }
                Text(titre)
            }
            .font(Police.texte(15, .semibold))
            .foregroundStyle(Palette.encre)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(Palette.fond2, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(Appui())
    }
}

struct RappelsView: View {
    @Environment(AppModel.self) private var app
    @AppStorage(FiltreRappels.cle) private var filtreRappels = ""
    @State private var nouveau = false
    @State private var filtrer = false
    @State private var organiser = false
    @State private var import_ = ImportRappels()
    /// Captures de la CI : « Quand ? » ouvert sur le premier rappel.
    @State private var demoQuand: Rappel?

    var body: some View {
        let filtre = FiltreRappels.lire(filtreRappels)
        let rappels = app.carnet.rappels.filter { FiltreRappels.garder($0, filtre) }
        let maintenant = Date().millis
        let finJour = (Format.calendrier.date(byAdding: .day, value: 1, to: Format.debutDuJour(Date())) ?? Date()).millis
        let groupes: [(String, [Rappel])] = [
            ("En retard", rappels.filter { !$0.fait && ($0.quand ?? .infinity) < maintenant }),
            ("Aujourd'hui", rappels.filter { !$0.fait && ($0.quand ?? -1) >= maintenant && ($0.quand ?? .infinity) < finJour }),
            ("Plus tard", rappels.filter { !$0.fait && ($0.quand ?? -1) >= finJour }),
            ("Sans date", rappels.filter { !$0.fait && $0.quand == nil }),
            ("Faits", rappels.filter(\.fait)),
        ]
        let aTrier = app.organisation.etiquettesDisponibles ? app.rappelsATraiter.count : 0
        List {
            if aTrier > 0 {
                LigneTriRappels(nombre: aTrier)
                    .listRowBackground(Palette.fond)
            }
            if rappels.isEmpty {
                Text("Aucun rappel pour l'instant.")
                    .font(Police.texte(15))
                    .foregroundStyle(Palette.encre2)
                    .listRowBackground(Palette.fond)
            }
            ForEach(groupes.filter { !$0.1.isEmpty }, id: \.0) { titre, liste in
                Section {
                    ForEach(liste) { r in
                        LigneRappel(rappel: r)
                            .listRowBackground(Palette.fond)
                            // Glisser → : fait ; ← : plus tard (+1 h) ou retirer (24/10).
                            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                Button {
                                    Haptique.leger()
                                    app.carnet.basculer(r)
                                } label: { Label(r.fait ? "Pas fait" : "Fait", systemImage: r.fait ? "arrow.uturn.backward" : "checkmark") }
                                .tint(Palette.encre)
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) { app.carnet.supprimer(r) } label: { Label("Retirer", systemImage: "trash") }
                                if !r.fait, let plusTard = Decaler.rappel().first {
                                    Button {
                                        Haptique.leger()
                                        app.carnet.reporter(r, a: plusTard.date)
                                    } label: { Label("Plus tard", systemImage: "clock.arrow.circlepath") }
                                    .tint(Palette.signal)
                                }
                            }
                    }
                } header: {
                    TitreSection(texte: titre, compte: liste.count, couleur: titre == "En retard" ? Palette.danger : Palette.encre2)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Palette.fond)
        .navigationTitle("Rappels")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { nouveau = true } label: { Label("Nouveau rappel", systemImage: "plus") }
                    Button { Task { await import_.lancer(app) } } label: { Label("Importer mes rappels Apple", systemImage: "square.and.arrow.down") }
                    if app.organisation.etiquettesDisponibles {
                        Button { filtrer = true } label: { Label(filtre.isEmpty ? "Filtrer…" : "Filtré (\(filtre.count))…", systemImage: "line.3.horizontal.decrease.circle") }
                        Button { organiser = true } label: { Label("Organiser mes rappels…", systemImage: "sparkles") }
                    }
                } label: {
                    Image(systemName: "plus.circle").frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("Ajouter, filtrer, organiser")
            }
        }
        .sheet(isPresented: $nouveau) { NouveauRappel() }
        .sheet(isPresented: $filtrer) { FiltreRappelsVue() }
        .sheet(isPresented: $organiser) { OnboardingRappels() }
        .sheet(item: $demoQuand) { QuandRappel(rappel: $0) }
        .task {
            let env = ProcessInfo.processInfo.environment
            guard env["REMY_DEMO_MDP"] != nil, env["REMY_DEMO_ECRAN"] == "rappel-quand" else { return }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            demoQuand = app.carnet.rappels.first { !$0.fait && $0.quand != nil } ?? app.carnet.rappels.first
        }
    }
}

/// Un rappel : le texte, la date devinée pendant la frappe, ou choisie.
struct NouveauRappel: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var texte = ""
    @State private var avecDate = true
    @State private var date = Date().addingTimeInterval(3600)
    @State private var dateTouchee = false
    @FocusState private var focus: Bool

    var body: some View {
        NavigationStack {
            Form {
                TextField("Appeler le garage demain à 9h", text: $texte, axis: .vertical)
                    .focused($focus)
                    .onChange(of: texte) {
                        guard !dateTouchee, let r = AnalyseDate.extraire(texte) else { return }
                        avecDate = true
                        date = r.quand
                    }
                Toggle("À une date", isOn: $avecDate)
                if avecDate {
                    DatePicker("Quand", selection: Binding(get: { date }, set: { date = $0; dateTouchee = true }))
                        .environment(\.locale, Format.locale)
                        .environment(\.timeZone, Format.fuseau)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.fond)
            .navigationTitle("Nouveau rappel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { fermer() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Ajouter") {
                        let reste = AnalyseDate.extraire(texte)?.reste
                        let t = (reste?.isEmpty == false && !dateTouchee) ? reste! : AnalyseDate.sansFormule(texte)
                        if app.carnet.creerRappel(t, quand: avecDate ? date : nil) != nil {
                            Haptique.succes()
                            if avecDate { Task { await Notifications.demander() } }
                            fermer()
                        }
                    }
                    .disabled(texte.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
        .onAppear { focus = true }
    }
}
