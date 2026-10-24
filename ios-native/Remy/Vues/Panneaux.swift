import SwiftUI
import RemyCore

// Les panneaux superposés de l'accueil (spec §4.2 à §4.4) : « Gérer » une
// tâche, et la journée à l'échelle.

/// « Gérer » : les gestes fréquents, sans vingt réglages à la fois. Prolonger
/// montre d'abord ce que ça change (estimation) ; rien ne part sans un second
/// geste.
struct GererPanneau: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    let e: ElementJour
    @State private var choix: Int?
    @State private var envoi = false
    @State private var replanifier = false
    @State private var bloquer = false
    @State private var raison = ""
    @State private var categoriser = false

    var body: some View {
        let maintenant = Date().millis
        let categories = app.organisation.noms(e.etiquettes)
        let reste = max(0, Int(((e.finEffective - maintenant) / 60_000).rounded(.up)))
        VStack(alignment: .leading, spacing: 16) {
            Capsule().fill(Palette.fond3).frame(width: 36, height: 5).frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 6) {
                if (e.projet ?? "").isEmpty == false || !categories.isEmpty {
                    HStack(spacing: 6) {
                        if let p = e.projet, !p.isEmpty { Puce(texte: p, couleur: Palette.projet(p)) }
                        ForEach(categories, id: \.self) { c in
                            Label(c, systemImage: "tag")
                                .font(Police.texte(13, .medium))
                                .foregroundStyle(Palette.encre2)
                                .lineLimit(1)
                        }
                    }
                }
                Text(e.titre)
                    .font(Police.titre(22))
                    .foregroundStyle(Palette.encre)
                    .fixedSize(horizontal: false, vertical: true)
                Text(horaires(maintenant: maintenant, reste: reste))
                    .font(Police.mono(12))
                    .foregroundStyle(Palette.encre2)
            }
            prolonger
            Rectangle().fill(Palette.filet).frame(height: 1)
            VStack(spacing: 0) {
                action("Replanifier ou modifier", detail: "Une autre date ; nom, durée, priorité", symbole: "calendar") {
                    replanifier = true
                }
                if app.tableau.categoriesDisponibles {
                    action("Catégorie", detail: categories.isEmpty ? "Voiture, Santé, Pro, Perso…" : categories.joined(separator: ", "), symbole: "tag") {
                        categoriser = true
                    }
                }
                if app.serveur?.sait("taches-etat-v1") == true {
                    if e.bloquee == true {
                        action("Reprendre", detail: e.raison ?? "Elle n'est plus en attente", symbole: "play.circle") {
                            ui.gerer = nil
                            Task { await app.tableau.bloquer(id: e.id, titre: e.titre, bloquee: false) }
                        }
                    } else {
                        action("En attente de…", detail: "Mise de côté, avec ce que tu attends", symbole: "pause.circle") { bloquer = true }
                    }
                }
                if app.serveur?.sait("taches-etat-v2") == true {
                    if e.commencee == true {
                        action("Remettre à sa place", detail: "Annule « commencer » : Motion garde son créneau", symbole: "arrow.uturn.backward") {
                            ui.gerer = nil
                            Task { await app.tableau.arreter(id: e.id, titre: e.titre) }
                        }
                    } else if Jour.etat(e, maintenant: maintenant) == .avenir {
                        action("Commencer maintenant", detail: "Elle devient ta tâche en cours, pour \(Format.duree(minutes: e.dureeTotale))", symbole: "play.circle") {
                            ui.gerer = nil
                            Task { await app.tableau.commencer(id: e.id, titre: e.titre, duree: e.duree) }
                        }
                    }
                }
                action("Est-ce raisonnable ?", detail: "Demander l'avis de Rémy", symbole: "questionmark.bubble") {
                    let m = choix ?? 15
                    demander(Brouillons.raisonnable(e, minutes: m, impact: ImpactProlongation.de(e, minutes: m, journee: app.semaine.journee(contenant: e) ?? app.tableau.journee)))
                }
                action("Terminer", detail: "Elle quitte la journée, avec « Annuler »", symbole: "checkmark.circle") {
                    ui.gerer = nil
                    Cocher.tache(app, id: e.id, titre: e.titre, ui: ui)
                }
            }
        }
        .padding(20)
        .carte(rayon: 28)
        .onAppear {
            if let c = ui.choixDemo, e.duree != nil { choix = c }
            ui.choixDemo = nil
            // Capture de la CI : la feuille « Catégorie ».
            let env = ProcessInfo.processInfo.environment
            if env["REMY_DEMO_MDP"] != nil, env["REMY_DEMO_ECRAN"] == "categorie" { categoriser = true }
        }
        .modifier(ActionsTache(id: e.id, titre: e.titre, ouvert: $replanifier, echeance: e.echeance,
                               duree: e.duree, priorite: e.priorite, bloquee: e.bloquee ?? false, etiquettes: e.etiquettes) {
            demander(Brouillons.tache(e.titre))
        })
        .sheet(isPresented: $categoriser) { CategoriserTache(id: e.id, titre: e.titre, actuelles: e.etiquettes ?? []) }
        .alert("En attente de quoi ?", isPresented: $bloquer) {
            TextField("Le devis, une réponse de Hugo… (facultatif)", text: $raison)
            Button("Mettre en attente") {
                let r = raison
                raison = ""
                ui.gerer = nil
                Task { await app.tableau.bloquer(id: e.id, titre: e.titre, bloquee: true, raison: r) }
            }
            Button("Annuler", role: .cancel) { raison = "" }
        } message: {
            Text("Elle reste dans ta journée, marquée « en attente », et le conseil du moment ne te la propose plus.")
        }
    }

    @ViewBuilder
    private var prolonger: some View {
        VStack(alignment: .leading, spacing: 10) {
            TitreSection(texte: "Prolonger")
            if e.duree == nil {
                // Tour pas encore à jour : elle ne transmet pas la durée Motion.
                Text(app.serveur?.sait("duree-taches") == true
                     ? "Motion ne donne pas de durée à cette tâche : prolonge-la dans Motion."
                     : "Prolonger arrivera avec la mise à jour de ta tour.")
                    .font(Police.texte(14))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                HStack(spacing: 8) {
                    ForEach([5, 15, 30], id: \.self) { m in
                        let actif = choix == m
                        Button {
                            Haptique.leger()
                            withAnimation(.snappy) { choix = actif ? nil : m }
                        } label: {
                            Text("+\(m) min")
                                .font(Police.texte(15, .semibold))
                                .foregroundStyle(actif ? Palette.fond : Palette.encre)
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(actif ? Palette.encre : Palette.fond2,
                                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(Appui())
                        .accessibilityAddTraits(actif ? .isSelected : [])
                    }
                }
                if let m = choix {
                    let i = ImpactProlongation.de(e, minutes: m, journee: app.semaine.journee(contenant: e) ?? app.tableau.journee)
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: i.conflit != nil ? "exclamationmark.triangle.fill" : "info.circle")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(i.conflit != nil ? Palette.danger : Palette.encre2)
                            Text(i.phrase)
                                .font(Police.texte(14))
                                .foregroundStyle(Palette.encre)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        BoutonA(titre: envoi ? "…" : (i.conflit != nil ? "Prolonger quand même" : "Prolonger de \(m) min"),
                                principal: i.conflit == nil, hauteur: 46) {
                            guard !envoi else { return }
                            envoi = true
                            Haptique.leger()
                            Task {
                                let ok = await app.tableau.prolonger(e, de: m)
                                envoi = false
                                if ok { ui.gerer = nil } else { Haptique.erreur() }
                            }
                        }
                        .disabled(envoi)
                        Text("Estimation : Motion recalcule la suite, Rémy vérifie après coup.")
                            .font(Police.texte(12))
                            .foregroundStyle(Palette.encre3)
                    }
                    .padding(14)
                    .background((i.conflit != nil ? Palette.danger : Palette.encre2).opacity(0.08),
                                in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .transition(.opacity)
                }
            }
        }
    }

    /// « 10:15 – 11:30 · il reste 50 min · 1 h 15 au total »
    private func horaires(maintenant: Millis, reste: Int) -> String {
        var bits = ["\(Format.heure(e.debut)) – \(Format.heure(e.finEffective))"]
        // Ouverte depuis Demain ou les 7 jours : le jour d'abord.
        if let j = Format.autreJour(e.debut) { bits.insert(j, at: 0) }
        if Jour.etat(e, maintenant: maintenant) == .encours { bits.append("il reste \(Format.duree(minutes: reste))") }
        bits.append("\(Format.duree(minutes: e.dureeTotale)) au total")
        return bits.joined(separator: " · ")
    }

    private func action(_ titre: String, detail: String, symbole: String, faire: @escaping () -> Void) -> some View {
        Button {
            Haptique.leger()
            faire()
        } label: {
            HStack(spacing: 14) {
                Image(systemName: symbole)
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Palette.encre2)
                    .frame(width: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text(titre).font(Police.texte(16, .medium)).foregroundStyle(Palette.encre)
                    Text(detail).font(Police.texte(13)).foregroundStyle(Palette.encre3)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.encre3)
            }
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func demander(_ texte: String) {
        ui.gerer = nil
        Task { _ = await app.preparer(texte, dansFil: Fils.journee(Date())) }
    }
}

/// Modifier une tâche Motion : nom, échéance, durée, priorité. Seuls les
/// champs changés partent ; Motion recalcule le créneau.
struct ModifierTache: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    let id: String
    let titre: String
    let echeanceInitiale: Date?
    let dureeInitiale: Int?
    let prioriteInitiale: String?
    @State private var nom: String
    @State private var avecEcheance: Bool
    @State private var echeance: Date
    @State private var duree: Int
    @State private var priorite: String
    @State private var envoi = false

    static let priorites: [(String, String)] = [("ASAP", "Urgente"), ("HIGH", "Importante"), ("MEDIUM", "Normale"), ("LOW", "Basse")]

    init(id: String, titre: String, echeance: Millis?, duree: Int?, priorite: String?) {
        self.id = id
        self.titre = titre
        echeanceInitiale = echeance?.date
        dureeInitiale = duree
        prioriteInitiale = priorite?.uppercased()
        _nom = State(initialValue: titre)
        _avecEcheance = State(initialValue: echeance != nil)
        _echeance = State(initialValue: echeance?.date ?? Format.echeanceDans(jours: 1))
        _duree = State(initialValue: duree ?? 30)
        _priorite = State(initialValue: priorite?.uppercased() ?? "MEDIUM")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Nom") {
                    TextField("Nom", text: $nom, axis: .vertical)
                }
                Section("Échéance") {
                    Toggle("Une échéance", isOn: $avecEcheance)
                    if avecEcheance {
                        DatePicker("Avant le", selection: $echeance)
                            .environment(\.locale, Format.locale)
                            .environment(\.timeZone, Format.fuseau)
                    }
                }
                Section {
                    Stepper(value: $duree, in: 5...480, step: 5) {
                        HStack {
                            Text("Durée")
                            Spacer()
                            Text(Format.duree(minutes: duree)).font(Police.mono(15)).foregroundStyle(Palette.encre2)
                        }
                    }
                } footer: {
                    Text(dureeInitiale == nil ? "Motion ne donnait pas de durée : en fixer une l'aide à placer la tâche." : "")
                }
                Section("Priorité") {
                    Picker("Priorité", selection: $priorite) {
                        ForEach(Self.priorites, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .pickerStyle(.segmented)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.fond)
            .navigationTitle("Modifier")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { fermer() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(envoi ? "…" : "Enregistrer") { Task { await enregistrer() } }
                        .disabled(envoi || !change || nom.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.large])
    }

    private var change: Bool {
        nom != titre || (avecEcheance && echeance != echeanceInitiale) || duree != (dureeInitiale ?? -1) || priorite != (prioriteInitiale ?? "")
    }

    private func enregistrer() async {
        envoi = true
        defer { envoi = false }
        let ok = await app.tableau.modifier(
            id: id, titre: titre,
            nouveauTitre: nom != titre ? nom : nil,
            echeance: avecEcheance && echeance != echeanceInitiale ? echeance : nil,
            duree: duree != dureeInitiale ? duree : nil,
            priorite: priorite != prioriteInitiale ? priorite : nil)
        if ok { fermer() } else { Haptique.erreur() }
    }
}

/// La journée à l'échelle (spec §4.3) : une tâche de 15 min n'a pas la hauteur
/// d'une tâche de deux heures. Deux éléments qui se chevauchent se partagent la
/// largeur. Fermeture : toucher à l'extérieur, ou la croix.
/// Depuis le 24/10 (semaine-v1) : Aujourd'hui | Demain | 7 jours, et un jour
/// de la semaine touché s'ouvre à l'échelle, avec les mêmes gestes.
struct JourneeEtendue: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    private let echelle: CGFloat = 1.15
    @State private var portee: PorteeEchelle = .aujourdhui

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 0) {
                if SegmentEchelle.estJour(portee) {
                    Button {
                        Haptique.leger()
                        withAnimation(.easeOut(duration: 0.18)) { portee = .semaine }
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Palette.encre)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Retour aux 7 jours")
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(titre).font(Police.titre(22)).foregroundStyle(Palette.encre)
                    Text(sousTitre).font(Police.texte(13)).foregroundStyle(Palette.encre2)
                }
                .padding(.leading, SegmentEchelle.estJour(portee) ? 0 : 18)
                Spacer()
                Button { ui.journeeEtendue = false } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Palette.encre2)
                        .frame(width: 30, height: 30)
                        .background(Palette.fond2, in: Circle())
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Fermer")
            }
            .padding(.trailing, 8)
            .padding(.vertical, 10)
            if app.semaine.disponible {
                SegmentEchelle(portee: $portee)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 10)
            }
            Rectangle().fill(Palette.filet).frame(height: 1)
            contenu
                // Glisser ← → : le jour suivant ou précédent (le défilement
                // vertical de la frise reste libre).
                .simultaneousGesture(DragGesture(minimumDistance: 30).onEnded { g in
                    let dx = g.translation.width
                    guard abs(dx) > 70, abs(dx) > abs(g.translation.height) * 2 else { return }
                    decaler(dx < 0 ? 1 : -1)
                })
        }
        .containerRelativeFrame(.vertical) { hauteur, _ in hauteur * 0.92 }
        .carte(rayon: 26)
        .onAppear {
            // Captures de la CI : la vue demandée d'emblée.
            let env = ProcessInfo.processInfo.environment
            guard env["REMY_DEMO_MDP"] != nil else { return }
            if env["REMY_DEMO_ECRAN"] == "semaine" { portee = .semaine }
            if env["REMY_DEMO_ECRAN"] == "demain" { portee = .demain }
        }
        .task(id: portee) {
            guard portee != .aujourdhui else { return }
            // Relue si elle a plus d'une minute (ou vient de l'iPhone) ; sinon
            // celle de l'ouverture de l'app suffit.
            let vieille = app.semaine.misAJour.map { Date().timeIntervalSince($0) > 60 } ?? true
            if vieille || app.semaine.copieLocale { await app.semaine.charger() }
        }
    }

    /// Le jour d'à côté, dans les 7 jours (rien depuis la vue des 7 jours).
    private func decaler(_ sens: Int) {
        guard app.semaine.disponible else { return }
        let auj = Format.jourISO(Date())
        let demain = SemaineModel.demainISO()
        let actuel: String
        switch portee {
        case .aujourdhui: actuel = auj
        case .demain: actuel = demain
        case .jour(let iso): actuel = iso
        case .semaine: return
        }
        var jours = app.semaine.jours().map(\.jour)
        if jours.isEmpty { jours = [auj, demain] }
        guard let i = jours.firstIndex(of: actuel), jours.indices.contains(i + sens) else { return }
        let cible = jours[i + sens]
        Haptique.leger()
        withAnimation(.easeOut(duration: 0.18)) {
            portee = cible == auj ? .aujourdhui : cible == demain ? .demain : .jour(cible)
        }
    }

    private var titre: String {
        switch portee {
        case .aujourdhui: return Format.jourTitre(Date())
        case .demain: return "Demain"
        case .semaine: return "Les 7 jours"
        case .jour(let iso): return app.semaine.jour(iso)?.titreLong ?? iso
        }
    }

    private var sousTitre: String {
        switch portee {
        case .semaine: return "Heures prévues sur tes heures libres"
        case .demain:
            let d = app.semaine.demain()?.titreLong
            return (d.map { $0 + " · " } ?? "") + "les durées sont à l'échelle"
        default: return "Les durées sont à l'échelle"
        }
    }

    @ViewBuilder
    private var contenu: some View {
        switch portee {
        case .aujourdhui:
            frise(app.tableau.journee?.items ?? [], aujourdhui: true, vide: "Rien à heure fixe aujourd'hui.")
        case .demain:
            jourVue(SemaineModel.demainISO(), vide: "Rien de prévu demain : ni rendez-vous, ni tâche placée par Motion.")
        case .semaine:
            VStack(spacing: 0) {
                BandeauSemaine()
                SemaineCompacte(ouvrirJour: { iso in
                    withAnimation(.easeOut(duration: 0.18)) {
                        portee = iso == Format.jourISO(Date()) ? .aujourdhui : iso == SemaineModel.demainISO() ? .demain : .jour(iso)
                    }
                }, ouvrir: ouvrir)
            }
        case .jour(let iso):
            jourVue(iso, vide: "Rien de prévu ce jour-là : ni rendez-vous, ni tâche placée par Motion.")
        }
    }

    /// Un jour qui vient : sa charge, ses échéances pas encore tenues, puis la
    /// frise à l'échelle.
    @ViewBuilder
    private func jourVue(_ iso: String, vide: String) -> some View {
        VStack(spacing: 0) {
            BandeauSemaine()
            if let j = app.semaine.jour(iso), !j.estVide {
                ResumeJour(j: j, ouvrir: ouvrir)
                frise(j.items, aujourdhui: false, vide: "Rien à heure fixe ce jour-là.")
            } else {
                EtatSemaine(vide: vide)
            }
        }
    }

    @ViewBuilder
    private func frise(_ items: [ElementJour], aujourdhui: Bool, vide: String) -> some View {
        let bornes = Self.heures(items)
        let premiere = bornes.0
        let derniere = bornes.1
        let places = Couloirs.de(items)
        if items.isEmpty {
            Text(vide)
                .font(Police.texte(15))
                .foregroundStyle(Palette.encre2)
                .multilineTextAlignment(.center)
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollViewReader { defilement in
                ScrollView {
                    ZStack(alignment: .topLeading) {
                        grille(premiere...derniere)
                        GeometryReader { g in
                            let largeur = g.size.width - 64
                            ForEach(items, id: \.cle) { e in
                                let p = places[e.cle] ?? Couloirs.Place(index: 0, total: 1)
                                let l = largeur / CGFloat(p.total)
                                bloc(e)
                                    .frame(width: l - 2, height: hauteur(e))
                                    .offset(x: 60 + l * CGFloat(p.index), y: y(e.debut, depuis: premiere))
                                    .onTapGesture { ouvrir(e) }
                            }
                            if aujourdhui { ligneMaintenant(largeur: g.size.width, depuis: premiere, jusqua: derniere) }
                        }
                    }
                    .frame(height: CGFloat(derniere - premiere) * 60 * echelle + 24)
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                }
                .scrollIndicators(.hidden)
                .task {
                    try? await Task.sleep(nanoseconds: 60_000_000)
                    // Aujourd'hui : là où on en est ; un autre jour : son premier élément.
                    let depart = aujourdhui ? Format.minuteDuJour(Date()) / 60 - 1 : (items.map { Format.minuteDuJour($0.debut.date) / 60 }.min() ?? premiere)
                    let h = max(premiere, min(derniere, depart))
                    defilement.scrollTo("h\(h)", anchor: .top)
                }
            }
            .id(aujourdhui ? "aujourdhui" : items.first?.cle ?? "jour")
        }
    }

    /// De la première heure utile à la dernière (8 h – 22 h au moins).
    static func heures(_ items: [ElementJour]) -> (Int, Int) {
        let debuts = items.map { Format.minuteDuJour($0.debut.date) / 60 }
        let fins = items.map { (Format.minuteDuJour($0.finEffective.date) + 59) / 60 }
        return (max(0, min(8, debuts.min() ?? 8)), min(24, max(22, fins.max() ?? 22)))
    }

    private func grille(_ heures: ClosedRange<Int>) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(heures), id: \.self) { h in
                HStack(alignment: .top, spacing: 8) {
                    Text(String(format: "%02d:00", h % 24))
                        .font(Police.mono(11, .medium))
                        .foregroundStyle(Palette.encre3)
                        .frame(width: 44, alignment: .trailing)
                        .offset(y: -7)
                    Rectangle().fill(Palette.filet).frame(height: 1)
                }
                .frame(height: h == heures.upperBound ? 12 : 60 * echelle, alignment: .top)
                .id("h\(h)")
            }
        }
    }

    private func y(_ ms: Millis, depuis premiere: Int) -> CGFloat {
        CGFloat(Format.minuteDuJour(ms.date) - premiere * 60) * echelle
    }

    private func hauteur(_ e: ElementJour) -> CGFloat {
        max(CGFloat((e.finEffective - e.debut) / 60_000) * echelle - 2, 20)
    }

    @ViewBuilder
    private func bloc(_ e: ElementJour) -> some View {
        let couleur = e.estRendezVous ? Palette.encre2 : Palette.projet(e.projet)
        let h = hauteur(e)
        let passe = Jour.etat(e, maintenant: Date().millis) == .passe
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                if e.estRendezVous { Image(systemName: "lock.fill").font(.system(size: 9, weight: .bold)) }
                Text(e.titre).font(Police.texte(12, .semibold)).lineLimit(1)
                if e.retard == true { Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 9)).foregroundStyle(Palette.danger) }
            }
            .foregroundStyle(Palette.encre)
            if h >= 38 {
                Text("\(Format.heure(e.debut)) – \(Format.heure(e.finEffective))")
                    .font(Police.mono(11))
                    .foregroundStyle(Palette.encre2)
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, 6)
        .padding(.vertical, h >= 38 ? 6 : 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(couleur.opacity(0.14), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 1.5).fill(couleur).frame(width: 3).padding(.vertical, 4).padding(.leading, 3)
        }
        .overlay {
            if e.estRendezVous {
                RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(couleur.opacity(0.6), lineWidth: 1)
            }
        }
        .opacity(passe ? 0.55 : 1)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    private func ligneMaintenant(largeur: CGFloat, depuis premiere: Int, jusqua derniere: Int) -> some View {
        let m = Format.minuteDuJour(Date())
        return Group {
            if m >= premiere * 60 && m <= derniere * 60 {
                HStack(spacing: 0) {
                    Text(Format.heure(Date()))
                        .font(Police.mono(10, .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Palette.signal, in: Capsule())
                    Rectangle().fill(Palette.signal).frame(height: 1.5)
                }
                .frame(width: largeur)
                .offset(x: 4, y: CGFloat(m - premiere * 60) * echelle - 8)
                .accessibilityHidden(true)
            }
        }
    }

    /// Toucher un bloc : une tâche s'ouvre dans « Gérer » ; un rendez-vous se
    /// prépare avec Rémy.
    private func ouvrir(_ e: ElementJour) {
        Haptique.leger()
        ui.journeeEtendue = false
        ui.gerer = e // tâche, activité ou rendez-vous : chacun son panneau
    }
}
