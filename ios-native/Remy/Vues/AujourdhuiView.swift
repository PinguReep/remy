import SwiftUI
import RemyCore

/// Une question préparée pour Rémy depuis une ligne de la journée.
struct Demande: Equatable {
    let texte: String
    let fil: String
}

extension ElementJour {
    /// Rendez-vous et tâches viennent de deux services : leurs identifiants
    /// peuvent se croiser.
    var cle: String { type + ":" + id }
}

/// L'accueil : ce qui se passe maintenant, la journée, ce que Rémy a remarqué.
/// Chaque ligne se touche pour en parler à Rémy ; chaque tâche se coche.
struct AujourdhuiView: View {
    @Environment(AppModel.self) private var app
    @State private var aRemplacer: Demande?

    var body: some View {
        VStack(spacing: 0) {
            EnTete()
            ScrollViewReader { defilement in
                ScrollView {
                    TimelineView(.periodic(from: .now, by: 30)) { ctx in
                        Contenu(maintenant: ctx.date, demander: demander)
                    }
                    .padding(.bottom, 32)
                }
                .refreshable { await app.chargerTout(frais: true) }
                .scrollDismissesKeyboard(.immediately)
                .task {
                    // Captures de la CI : descendre jusqu'à la partie demandée.
                    guard let ancre = ProcessInfo.processInfo.environment["REMY_DEMO_ANCRE"], !ancre.isEmpty else { return }
                    try? await Task.sleep(nanoseconds: 3_500_000_000)
                    defilement.scrollTo(ancre, anchor: .top)
                }
            }
        }
        .background(Palette.fond)
        .confirmationDialog(
            "Tu as déjà un message en cours pour Rémy.",
            isPresented: Binding(get: { aRemplacer != nil }, set: { if !$0 { aRemplacer = nil } }),
            titleVisibility: .visible,
            presenting: aRemplacer
        ) { d in
            Button("Le remplacer") { Task { await app.preparer(d.texte, dansFil: d.fil, remplacer: true) } }
            Button("Garder mon message") { app.onglet = .remy }
            Button("Annuler", role: .cancel) {}
        }
    }

    /// Prépare la question dans le composeur de Rémy (jamais envoyée seule).
    private func demander(_ texte: String, _ fil: String) {
        Haptique.leger()
        Task {
            if !(await app.preparer(texte, dansFil: fil)) { aRemplacer = Demande(texte: texte, fil: fil) }
        }
    }
}

private struct EnTete: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(spacing: 8) {
            TimelineView(.periodic(from: .now, by: 60)) { ctx in
                Text(Format.jourTitre(ctx.date))
                    .font(Police.texte(24, .heavy))
                    .tracking(-0.8)
                    .foregroundStyle(Palette.encre)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 8)
            BoutonEnTete(titre: "Réglages", symbole: "gearshape") { app.reglagesOuverts = true }
        }
        .padding(.leading, 18)
        .padding(.trailing, 8)
        .frame(height: 56)
        .overlay(alignment: .bottom) { Filet(couleur: Palette.encre) }
    }
}

private struct Contenu: View {
    @Environment(AppModel.self) private var app
    let maintenant: Date
    let demander: (String, String) -> Void

    var body: some View {
        let t = app.tableau
        let j = t.journee
        let sources = j?.sources
        let journeeLisible = j != nil && sources?.aucune != true && sources?.enPanne != true
        VStack(alignment: .leading, spacing: 0) {
            Bandeau()
            if t.donnees == nil {
                if t.erreur == nil {
                    Squelette(largeurs: [0.4, 0.9, 0.7, 0.8]).padding(18)
                }
            } else if Jour.estPerimee(j, maintenant: maintenant) {
                Vide(texte: "Cette page date d'un autre jour : Rémy doit la rafraîchir.", titreAction: "Rafraîchir") {
                    Task { await app.tableau.charger() }
                }
                .padding(18)
            } else {
                CarteMaintenant(journee: j, maintenant: maintenant, demander: demander)
                BoutonOrganiser()
                    .padding(.horizontal, 18)
                    .padding(.bottom, 22)
                if journeeLisible {
                    TaJournee(journee: j, maintenant: maintenant, demander: demander).id("journee")
                }
            }
            if t.donnees != nil {
                RemyARemarque(maintenant: maintenant, demander: demander).id("remarque")
                FaireConnaissance().id("connaissance")
            }
        }
    }
}

// MARK: - Bandeau : seulement quand quelque chose ne va pas

private struct Bandeau: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let t = app.tableau
        let s = t.donnees?.journee?.sources
        VStack(spacing: 1) {
            if let e = t.erreur {
                ligne(texte(e), reessayer: true)
            }
            if let s, !s.enPanne, t.erreur == nil {
                if s.motion == "erreur" { ligne("Motion ne répond pas : des tâches peuvent manquer.", reessayer: true) }
                if s.agenda == "erreur" { ligne("Ton agenda ne répond pas : des rendez-vous peuvent manquer.", reessayer: s.motion != "erreur") }
            }
        }
    }

    private func texte(_ e: String) -> String {
        let t = app.tableau
        let depuis = t.misAJour.map { Format.heure($0) }
        if t.erreurReseau {
            // Rémy vit sur la tour : sans le VPN Tailscale (ou tour éteinte), il est injoignable.
            return depuis.map { "Rémy est injoignable — Tailscale est-il actif ? Ta journée date de \($0)." }
                ?? "Rémy est injoignable : active Tailscale sur l'iPhone (et vérifie que la tour est allumée)."
        }
        if t.donnees == nil { return "Rémy n'arrive pas à charger ta journée. \(e)" }
        return "Rémy n'a pas pu rafraîchir ta journée" + (depuis.map { " (elle date de \($0))." } ?? ".")
    }

    private func ligne(_ texte: String, reessayer: Bool) -> some View {
        HStack(spacing: 12) {
            Text(texte)
                .font(Police.texte(14, .medium))
                .foregroundStyle(Palette.encre)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 12)
            Spacer(minLength: 0)
            if reessayer {
                BoutonTexte(app.tableau.chargement ? "…" : "Réessayer") {
                    Task { await app.chargerTout() }
                }
                .disabled(app.tableau.chargement)
            }
        }
        .padding(.leading, 18)
        .padding(.trailing, 12)
        .background(Palette.fond2)
        .overlay(alignment: .leading) { Rectangle().fill(Palette.danger).frame(width: 4) }
    }
}

// MARK: - Maintenant

private struct CarteMaintenant: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var ouvrirURL
    let journee: Journee?
    let maintenant: Date
    let demander: (String, String) -> Void

    var body: some View {
        let p = Jour.prochain(journee, maintenant: maintenant.millis)
        Group {
            if let b = Self.brouillon(p) {
                Button { demander(b, Fils.journee(Date())) } label: { carte(p, lien: true) }
                    .buttonStyle(.plain)
                    .accessibilityHint("Prépare une question pour Rémy")
            } else {
                carte(p, lien: false)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 14)
    }

    /// Ce que Rémy reçoit quand Sam touche la carte.
    static func brouillon(_ p: Jour.Prochain) -> String? {
        switch p {
        case .enCours(let e), .suivant(let e): return e.estRendezVous ? Brouillons.rendezVous(e) : Brouillons.tache(e.titre)
        case .aFaire(let t, _): return Brouillons.tache(t.titre)
        case .rienDePrevu(let retards): return retards > 0 ? Brouillons.retards : nil
        default: return nil
        }
    }

    private func carte(_ p: Jour.Prochain, lien: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            contenu(p)
            if lien {
                Text("Demander à Rémy ›")
                    .font(Police.texte(15, .semibold))
                    .foregroundStyle(Palette.encre)
                    .padding(.top, 6)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.fond2)
        .overlay(alignment: .leading) { Rectangle().fill(Palette.signal).frame(width: 4) }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func contenu(_ p: Jour.Prochain) -> some View {
        switch p {
        case .enCours(let e):
            Etiquette("En ce moment")
            titre(e.titre)
            Text(restant(e)).font(Police.texte(15, .semibold)).foregroundStyle(Palette.encre)
            if let l = e.lieu, !l.isEmpty { detail(l) }
        case .suivant(let e):
            Etiquette("À venir")
            titre(e.titre)
            Text(Format.heure(e.debut) + " · " + Format.dansCombien((e.debut - maintenant.millis) / 1000))
                .font(Police.texte(15, .semibold)).foregroundStyle(Palette.encre)
            if let l = e.lieu, !l.isEmpty { detail(l) }
        case .aFaire(let t, let total):
            Etiquette("À faire aujourd'hui")
            titre(t.titre)
            if total > 1 { detail("et \(total - 1) autre\(total > 2 ? "s" : "") tâche\(total > 2 ? "s" : "") aujourd'hui") }
        case .rienDePrevu(let retards):
            Etiquette("Maintenant")
            titre("Plus rien de prévu")
            if retards > 0 {
                Text(retards > 1 ? "Mais \(retards) tâches sont en retard." : "Mais une tâche est en retard.")
                    .font(Police.texte(15, .semibold)).foregroundStyle(Palette.danger)
            }
        case .aucuneSource:
            Etiquette("Ta journée")
            titre("Rémy ne voit pas encore ta journée")
            detail("Branche Motion ou ton agenda depuis le site : tes rendez-vous et tes tâches s'afficheront ici.")
            Button("Ouvrir le site") { ouvrirURL(app.api.base) }
                .buttonStyle(BoutonBrut())
                .padding(.top, 6)
        case .enPanne:
            Etiquette("Ta journée")
            titre("Impossible de lire ta journée pour l'instant")
            detail("Motion et ton agenda ne répondent pas.")
            Button(app.tableau.chargement ? "…" : "Réessayer") { Task { await app.chargerTout() } }
                .buttonStyle(BoutonBrut())
                .disabled(app.tableau.chargement)
                .padding(.top, 6)
        case .inconnu:
            Etiquette("Ta journée")
            detail("Rien à afficher pour le moment.")
        }
    }

    private func titre(_ t: String) -> some View {
        Text(t)
            .font(Police.texte(22, .bold))
            .tracking(-0.4)
            .foregroundStyle(Palette.encre)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func detail(_ t: String) -> some View {
        Text(t).font(Police.texte(15)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
    }

    /// « encore 35 min · jusqu'à 11:30 »
    private func restant(_ e: ElementJour) -> String {
        let min = max(1, Int(((e.finEffective - maintenant.millis) / 60_000).rounded(.up)))
        return "encore " + Format.duree(minutes: min) + " · jusqu'à " + Format.heure(e.finEffective)
    }
}

private struct BoutonOrganiser: View {
    @Environment(AppModel.self) private var app
    @State private var enCours = false

    var body: some View {
        // L'attente ne couvre que l'ouverture du fil, pas toute la réponse de Rémy.
        let attente = enCours && !app.chat.envoi && app.onglet == .aujourdhui
        Button {
            guard !attente else { return }
            enCours = true
            Haptique.leger()
            Task {
                await app.organiserJournee()
                enCours = false
            }
        } label: {
            Text(attente ? "Ouverture…" : "Organiser ma journée")
        }
        .buttonStyle(BoutonBrut(genre: .principal, pleineLargeur: true))
        .disabled(attente)
    }
}

// MARK: - Ta journée

private struct TaJournee: View {
    @Environment(AppModel.self) private var app
    let journee: Journee?
    let maintenant: Date
    let demander: (String, String) -> Void
    @State private var plusTotOuvert = false

    var body: some View {
        let now = maintenant.millis
        let items = journee?.items ?? []
        let passes = items.filter { Jour.etat($0, maintenant: now) == .passe }
        let actuels = items.filter { Jour.etat($0, maintenant: now) != .passe }
        let aFaire = journee?.aFaire ?? []
        let retard = journee?.retard
        let toute = journee?.toute ?? []
        let cochees = app.tableau.cochees
        let rien = items.isEmpty && aFaire.isEmpty && (retard?.total ?? 0) == 0 && toute.isEmpty && cochees.isEmpty

        Partie(titre: "Ta journée") {
            VStack(alignment: .leading, spacing: 0) {
                if !toute.isEmpty {
                    Text("Toute la journée : " + toute.map(\.titre).joined(separator: " · "))
                        .font(Police.texte(15, .medium))
                        .foregroundStyle(Palette.encre)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 10)
                }
                if !passes.isEmpty {
                    Button {
                        withAnimation(.easeOut(duration: 0.2)) { plusTotOuvert.toggle() }
                    } label: {
                        HStack(spacing: 6) {
                            Text("Plus tôt aujourd'hui (\(passes.count))")
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .semibold))
                                .rotationEffect(.degrees(plusTotOuvert ? 90 : 0))
                            Spacer()
                        }
                        .font(Police.texte(15, .medium))
                        .foregroundStyle(Palette.encre2)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if plusTotOuvert {
                        ForEach(passes, id: \.cle) { e in
                            LigneJour(e: e, etat: .passe, demander: demander)
                        }
                    }
                }
                ForEach(actuels, id: \.cle) { e in
                    LigneJour(e: e, etat: Jour.etat(e, maintenant: now), demander: demander)
                }
                if !cochees.isEmpty {
                    SousTitre(texte: "Cochées tout à l'heure")
                    ForEach(cochees) { c in LigneCochee(c: c) }
                }
                if !aFaire.isEmpty {
                    SousTitre(texte: "À faire aujourd'hui · \(aFaire.count)")
                    ForEach(aFaire) { t in LigneTache(t: t, enRetard: false, demander: demander) }
                }
                if let r = retard, r.total > 0 {
                    SousTitre(texte: "En retard · \(r.total)", couleur: Palette.danger)
                    ForEach(r.items) { t in LigneTache(t: t, enRetard: true, demander: demander) }
                    if r.total > r.items.count {
                        let n = r.total - r.items.count
                        Text(n > 1 ? "Et \(n) autres en retard." : "Et une autre en retard.")
                            .font(Police.texte(14))
                            .foregroundStyle(Palette.encre2)
                            .padding(.top, 8)
                    }
                }
                if rien {
                    Text("Rien de prévu aujourd'hui.")
                        .font(Police.texte(15))
                        .foregroundStyle(Palette.encre2)
                } else {
                    Text("Touche une ligne pour en parler à Rémy.")
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre3)
                        .padding(.top, 14)
                }
            }
        }
    }
}

private struct SousTitre: View {
    let texte: String
    var couleur: Color = Palette.encre2

    var body: some View {
        Text(texte)
            .font(Police.texte(14, .semibold))
            .foregroundStyle(couleur)
            .padding(.top, 18)
            .padding(.bottom, 2)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Un rendez-vous ou une tâche calée à une heure.
private struct LigneJour: View {
    @Environment(AppModel.self) private var app
    let e: ElementJour
    let etat: EtatMoment
    let demander: (String, String) -> Void
    @State private var actions = false

    var body: some View {
        let passe = etat == .passe
        // Un rendez-vous passé est fini ; une tâche passée non cochée, non.
        let grise = passe && e.estRendezVous
        HStack(alignment: .center, spacing: 0) {
            Button {
                // Un rendez-vous (Google) se discute avec Rémy ; une tâche Motion
                // se replanifie d'un geste.
                if e.estRendezVous {
                    demander(Brouillons.rendezVous(e), Fils.journee(Date()))
                } else {
                    Haptique.leger()
                    actions = true
                }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(Format.heure(e.debut))
                        .font(Police.mono(14, .medium))
                        .foregroundStyle(grise ? Palette.encre3 : Palette.encre)
                        .frame(width: 50, alignment: .leading)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(e.titre)
                            .font(Police.texte(16, etat == .encours ? .semibold : .regular))
                            .foregroundStyle(grise ? Palette.encre3 : Palette.encre)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        let d = detail
                        if !d.isEmpty {
                            Text(d).font(Police.texte(14)).foregroundStyle(grise ? Palette.encre3 : Palette.encre2)
                        }
                        if etat == .encours || (e.retard == true && !passe) {
                            HStack(spacing: 6) {
                                if etat == .encours { Pastille(texte: "En cours") }
                                if e.retard == true && !passe { Pastille(texte: "En retard", alerte: true) }
                            }
                            .padding(.top, 2)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if !e.estRendezVous {
                CaseACocher { cocher(e.id, e.titre) }
            }
        }
        .frame(minHeight: 52)
        .overlay(alignment: .top) { Filet() }
        .modifier(ActionsTache(id: e.id, titre: e.titre, ouvert: $actions) {
            demander(Brouillons.tache(e.titre), Fils.journee(Date()))
        })
    }

    private var detail: String {
        var bits: [String] = []
        if let l = e.lieu, !l.isEmpty { bits.append(l) }
        if let p = e.projet, !p.isEmpty { bits.append(p) }
        if let p = Self.priorite(e.priorite) { bits.append(p) }
        return bits.joined(separator: " · ")
    }

    static func priorite(_ p: String?) -> String? {
        switch p?.uppercased() {
        case "ASAP": return "urgent"
        case "HIGH": return "important"
        default: return nil
        }
    }

    private func cocher(_ id: String, _ titre: String) {
        Cocher.tache(app, id: id, titre: titre)
    }
}

/// Cocher une tâche : elle part à l'instant, avec une petite vibration ; le
/// bandeau « Annuler » vit deux secondes, puis Motion est prévenu. Si Motion
/// refuse, la tâche revient — la vibration d'erreur accompagne le message.
enum Cocher {
    @MainActor
    static func tache(_ app: AppModel, id: String, titre: String) {
        Haptique.leger()
        Task {
            if await app.tableau.terminer(id: id, titre: titre) == .echec { Haptique.erreur() }
        }
    }
}

/// Toucher une tâche : la replanifier d'un geste, ou en parler à Rémy (Sam,
/// 09/10 : il touchait une tâche en retard pour la décaler, et ne pouvait que
/// préparer une question). Seule l'échéance change ; Motion recalcule le créneau.
private struct ActionsTache: ViewModifier {
    @Environment(AppModel.self) private var app
    let id: String
    let titre: String
    @Binding var ouvert: Bool
    let demander: () -> Void
    @State private var choixDate = false
    @State private var date = Format.echeanceDans(jours: 1)

    func body(content: Content) -> some View {
        content
            .confirmationDialog(titre, isPresented: $ouvert, titleVisibility: .visible) {
                Button("Aujourd'hui") { replanifier(Format.echeanceDans(jours: 0)) }
                Button("Demain") { replanifier(Format.echeanceDans(jours: 1)) }
                Button("Dans une semaine") { replanifier(Format.echeanceDans(jours: 7)) }
                Button("Choisir une date…") { choixDate = true }
                Button("En parler à Rémy") { demander() }
                Button("Annuler", role: .cancel) {}
            } message: {
                Text("Nouvelle échéance : Motion trouvera le créneau.")
            }
            .sheet(isPresented: $choixDate) {
                NavigationStack {
                    DatePicker("Échéance", selection: $date, in: Date()..., displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .environment(\.locale, Format.locale)
                        .padding(.horizontal, 18)
                        .navigationTitle(titre)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) { Button("Annuler") { choixDate = false } }
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Replanifier") {
                                    choixDate = false
                                    replanifier(Format.echeanceDans(jours: 0, depuis: date))
                                }
                            }
                        }
                }
                .presentationDetents([.medium, .large])
            }
    }

    private func replanifier(_ echeance: Date) {
        Haptique.leger()
        Task {
            if !(await app.tableau.replanifier(id: id, titre: titre, echeance: echeance)) { Haptique.erreur() }
        }
    }
}

/// Une tâche sans heure (à faire aujourd'hui, ou en retard).
private struct LigneTache: View {
    @Environment(AppModel.self) private var app
    let t: TacheResume
    let enRetard: Bool
    let demander: (String, String) -> Void
    @State private var actions = false

    var body: some View {
        HStack(alignment: .center, spacing: 0) {
            Button {
                Haptique.leger()
                actions = true
            } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(t.titre)
                        .font(Police.texte(16))
                        .foregroundStyle(Palette.encre)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    let d = detail
                    if !d.isEmpty {
                        Text(d).font(Police.texte(14)).foregroundStyle(enRetard ? Palette.danger : Palette.encre2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            CaseACocher { Cocher.tache(app, id: t.id, titre: t.titre) }
        }
        .frame(minHeight: 52)
        .overlay(alignment: .top) { Filet() }
        .modifier(ActionsTache(id: t.id, titre: t.titre, ouvert: $actions) {
            demander(enRetard ? Brouillons.retard(t) : Brouillons.tache(t.titre), Fils.journee(Date()))
        })
    }

    private var detail: String {
        var bits: [String] = []
        if let e = t.echeance {
            if enRetard {
                bits.append("prévue le " + Format.jourCourt(e.date))
            } else {
                let h = Format.minuteDuJour(e.date) / 60
                if h < 20 && h >= 5 { bits.append("avant " + Format.heure(e)) }
            }
        }
        if let p = t.projet, !p.isEmpty { bits.append(p) }
        if let p = LigneJour.priorite(t.priorite) { bits.append(p) }
        return bits.joined(separator: " · ")
    }
}

/// Une tâche cochée depuis l'app : barrée, avec son « Annuler ».
private struct LigneCochee: View {
    @Environment(AppModel.self) private var app
    let c: Cochee

    var body: some View {
        HStack(spacing: 8) {
            Text(c.titre)
                .font(Police.texte(16))
                .strikethrough()
                .foregroundStyle(Palette.encre3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 10)
            if c.enAttente {
                // Pas encore envoyée : « Annuler » la fait revenir, Motion n'en saura rien.
                BoutonTexte("Annuler") {
                    Haptique.leger()
                    app.tableau.renoncer(c.id)
                }
            } else if c.enCours {
                ProgressView().frame(width: 44, height: 44)
            } else if c.ledgerId != nil {
                BoutonTexte("Annuler") { Task { await app.tableau.annulerCoche(c.id) } }
            }
        }
        .frame(minHeight: 52)
        .overlay(alignment: .top) { Filet() }
    }
}

// MARK: - Rémy a remarqué (la réflexion de la nuit)

private struct RemyARemarque: View {
    @Environment(AppModel.self) private var app
    let maintenant: Date
    let demander: (String, String) -> Void

    var body: some View {
        let d = app.tableau.donnees
        let b = d?.briefing
        let recente = Nuit.estRecente(b?.generatedAt, maintenant: maintenant)
        let quand = recente ? "" : b?.generatedAt.map { " · le " + Format.jourCourt($0.date) } ?? ""
        Partie(titre: "Rémy a remarqué" + quand) {
            if let items = b?.items, !items.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(items) { s in
                        LigneSujet(sujet: s, generatedAt: b?.generatedAt, demander: demander)
                    }
                }
            } else if let texte = b?.text, !texte.isEmpty {
                TexteRemy(texte: texte)
            } else if b?.generatedAt != nil {
                phrase(recente ? "Rien de notable cette nuit." : "Rien de notable la dernière fois.")
            } else if d?.systeme?.reflexion == false {
                phrase("La préparation de nuit n'est pas active : rien ne s'affichera ici.")
            } else {
                phrase("Chaque nuit, Rémy relit tes échanges et note ici ce qui mérite ton attention.")
            }
        }
    }

    private func phrase(_ t: String) -> some View {
        Text(t).font(Police.texte(15)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
    }
}

private struct LigneSujet: View {
    @Environment(AppModel.self) private var app
    let sujet: Sujet
    let generatedAt: Millis?
    let demander: (String, String) -> Void

    var body: some View {
        let ouvert = sujet.etat == "ouvert"
        VStack(alignment: .leading, spacing: 6) {
            Text(sujet.texte)
                .font(Police.texte(16))
                .strikethrough(sujet.etat == "traite")
                .foregroundStyle(ouvert ? Palette.encre : Palette.encre3)
                .fixedSize(horizontal: false, vertical: true)
            if ouvert {
                LienTexte(titre: "Demander à Rémy") {
                    demander(Brouillons.sujet(sujet, generatedAt: generatedAt),
                             Fils.nocturne((generatedAt ?? Date().millis).date))
                }
                HStack(spacing: 8) {
                    Button("C'est fait") { changer("traite") }.buttonStyle(BoutonBrut())
                    Button("Laisser tomber") { changer("ignore") }.buttonStyle(BoutonBrut())
                }
            } else {
                HStack {
                    Text(sujet.etat == "traite" ? "Fait" : "Laissé de côté")
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.encre3)
                    Spacer()
                    BoutonTexte("Rouvrir") { changer("ouvert") }
                }
            }
        }
        .padding(.vertical, 12)
        .overlay(alignment: .top) { Filet() }
    }

    private func changer(_ etat: String) {
        Haptique.leger()
        Task { await app.tableau.changer(sujet, vers: etat) }
    }
}

// MARK: - Faire connaissance (l'onboarding, tant qu'il reste une étape)

private struct FaireConnaissance: View {
    @Environment(AppModel.self) private var app
    @State private var ouverture = false

    var body: some View {
        if let e = app.tableau.donnees?.setup, let sessions = e.sessions, !sessions.isEmpty, let s = Onboarding.prochaine(e) {
            let faites = Onboarding.faites(e)
            let reste = Onboarding.reste(s, e)
            let attente = ouverture && !app.chat.envoi && app.onglet == .aujourdhui
            Partie(titre: "Faire connaissance") {
                Text(faites == 0
                     ? "Quelques conversations pour que Rémy te connaisse vraiment : \(sessions.count) étapes, à ton rythme."
                     : "\(faites) étape\(faites > 1 ? "s" : "") finie\(faites > 1 ? "s" : "") sur \(sessions.count).")
                    .font(Police.texte(15))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                Text(s.title)
                    .font(Police.texte(19, .bold))
                    .foregroundStyle(Palette.encre)
                if !reste.isEmpty && !(s.reperes ?? []).isEmpty && reste.count < (s.reperes ?? []).count {
                    Text("Il reste : " + reste.map(\.label).joined(separator: " · "))
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                } else if let desc = s.desc, !desc.isEmpty {
                    Text(desc)
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button(attente ? "Ouverture…" : (e.convs?[s.id] != nil ? "Continuer" : "Commencer")) {
                    guard !attente else { return }
                    ouverture = true
                    Haptique.leger()
                    Task {
                        await app.lancerSession(s)
                        ouverture = false
                    }
                }
                .buttonStyle(BoutonBrut(pleineLargeur: true))
                .disabled(attente)
            }
        }
    }
}
