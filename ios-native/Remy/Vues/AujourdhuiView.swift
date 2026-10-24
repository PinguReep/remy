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

/// L'accueil, direction A (Lot 1) : la date, le conseil du moment, ce qui se
/// passe maintenant avec son temps restant, puis la suite. Appui long sur la
/// suite : la journée à l'échelle. La boîte « À voir avec Rémy » est en haut.
struct AujourdhuiView: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    @State private var aRemplacer: Demande?

    var body: some View {
        ScrollViewReader { defilement in
            ScrollView {
                // Recalculé au début de chaque minute : une tâche devient « en
                // cours » à l'heure exacte, sans attendre le réseau.
                TimelineView(.everyMinute) { ctx in
                    VStack(alignment: .leading, spacing: 22) {
                        EnTete(maintenant: ctx.date)
                        Contenu(maintenant: ctx.date, demander: demander)
                    }
                    .padding(.bottom, 48)
                }
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

// MARK: - En-tête : la date, les réglages, la boîte

private struct EnTete: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    let maintenant: Date

    var body: some View {
        TitreEcran(titre: Format.jourMois(maintenant), surTitre: Format.jourSemaine(maintenant)) {
            HStack(spacing: 10) {
                if app.historique.disponible {
                    BoutonRond(symbole: "clock.arrow.circlepath", libelle: "Historique des actions") {
                        Haptique.leger()
                        ui.historiqueOuvert = true
                    }
                }
                BoutonRond(symbole: "gearshape", libelle: "Réglages") { app.reglagesOuverts = true }
                // Le briefing rassemble les sujets de la nuit (24/10) ; une tour
                // pas encore à jour garde la boîte seule.
                BoutonRond(symbole: ouverts > 0 ? "tray.full" : "tray",
                           libelle: app.rituel.disponible ? "Ton briefing et les sujets de la nuit" : "À voir avec Rémy", pastille: ouverts) {
                    Haptique.leger()
                    if app.rituel.disponible { ui.briefingOuvert = true } else { ui.boiteOuverte = true }
                }
            }
        }
    }

    /// Les sujets de la nuit encore ouverts.
    private var ouverts: Int {
        (app.tableau.donnees?.briefing?.items ?? []).filter { $0.etat == "ouvert" }.count
    }
}

// MARK: - Contenu

private struct Contenu: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    let maintenant: Date
    let demander: (String, String) -> Void

    var body: some View {
        let t = app.tableau
        let j = t.journee
        let sources = j?.sources
        let lisible = j != nil && sources?.aucune != true && sources?.enPanne != true
        Bandeau()
            .padding(.horizontal, 16)
        if t.donnees == nil {
            if t.erreur == nil {
                Squelette(largeurs: [0.4, 0.9, 0.7, 0.8])
                    .padding(20)
                    .carte()
                    .padding(.horizontal, 16)
            }
        } else if Jour.estPerimee(j, maintenant: maintenant) {
            Vide(texte: "Cette page date d'un autre jour : Rémy doit la rafraîchir.", titreAction: "Rafraîchir") {
                Task { await app.tableau.charger() }
            }
            .padding(20)
            .carte()
            .padding(.horizontal, 16)
        } else {
            // Le rendez-vous quotidien (24/10) : l'échéance menacée d'abord,
            // la proposition du briefing (une fois), le bilan le soir.
            if let ms = t.donnees?.menacees, let m = ms.first {
                CarteMenacee(m: m, autres: ms.count - 1, voirTout: { ui.briefingOuvert = true })
                    .padding(.horizontal, 16)
                    .id("menacee")
            }
            PropositionRituel()
            if app.rituel.disponible, !app.rituel.bilanRange, Format.calendrier.component(.hour, from: maintenant) >= 18 {
                EntreeBilan { ui.bilanOuvert = true }
                    .padding(.horizontal, 16)
            }
            if lisible, let local = Conseil.pour(.maintenant, j, maintenant: maintenant.millis) {
                ConseilDuMoment(local: local, maintenant: maintenant.millis)
            }
            CarteMaintenant(journee: j, maintenant: maintenant, demander: demander)
            if lisible {
                LaSuite(journee: j, maintenant: maintenant, demander: demander).id("journee")
                ATraiter(journee: j, demander: demander).id("a-traiter")
            }
            FaireConnaissance().id("connaissance")
            CarteATrancher().id("a-trancher")
        }
    }
}

// MARK: - Bandeau : seulement quand quelque chose ne va pas

/// Dit d'où vient ce qui est affiché, quand ce n'est pas frais de la tour :
/// une copie gardée sur l'iPhone (avec sa date), des gestes qui attendent le
/// réseau, une partie illisible. Jamais un succès qui n'a pas eu lieu.
private struct Bandeau: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let t = app.tableau
        let s = t.donnees?.journee?.sources
        let attente = t.gestesEnAttente + app.carnet.enAttente.count
        VStack(spacing: 8) {
            if let e = t.erreur {
                ligne(texte(e), reessayer: true)
            } else if app.horsLigne {
                ligne(sansReseau, reessayer: false)
            } else if t.copieLocale {
                // Lancement : la copie de l'iPhone, le temps que la tour réponde.
                ligne(t.misAJour.map { "Ta journée date \(Format.depuis($0)) — mise à jour…" } ?? "Mise à jour…",
                      reessayer: false, alerte: false)
            }
            if attente > 0 {
                ligne(attente == 1 ? "1 changement partira dès que Rémy sera joignable."
                                   : "\(attente) changements partiront dès que Rémy sera joignable.",
                      reessayer: t.erreur == nil && !app.horsLigne, envoyer: true, alerte: false)
            }
            if t.erreur == nil, let m = t.donnees?.journee?.motion, let p = m.phrase(maintenant: Date().millis) {
                // La tour dit pourquoi : quota, panne, liste ancienne (retours TestFlight 13).
                ligne(p, reessayer: ["panne", "reseau", "quota"].contains(m.etat),
                      alerte: ["panne", "reseau", "auth", "quota"].contains(m.etat))
            }
            if let s, !s.enPanne, t.erreur == nil {
                if s.motion == "erreur" && t.donnees?.journee?.motion == nil {
                    ligne("Motion ne répond pas : des tâches peuvent manquer.", reessayer: true)
                }
                if s.agenda == "erreur" { ligne("Ton agenda ne répond pas : des rendez-vous peuvent manquer.", reessayer: s.motion != "erreur") }
            }
            if t.erreur == nil, !(t.donnees?.partiesIllisibles.isEmpty ?? true) {
                ligne("Une partie de ta journée n'a pas pu être lue : elle est laissée de côté.", reessayer: true)
            }
        }
    }

    private var sansReseau: String {
        app.tableau.misAJour.map { "Pas de réseau. Ta journée date \(Format.depuis($0))." }
            ?? "Pas de réseau : Rémy ne peut pas charger ta journée."
    }

    private func texte(_ e: String) -> String {
        let t = app.tableau
        let depuis = t.misAJour.map { Format.depuis($0) }
        if app.horsLigne { return sansReseau }
        if t.erreurReseau {
            // Rémy vit sur la tour : sans le VPN Tailscale (ou tour éteinte), il est injoignable.
            return depuis.map { "Rémy est injoignable — Tailscale est-il actif ? Ta journée date \($0)." }
                ?? "Rémy est injoignable : active Tailscale sur l'iPhone (et vérifie que la tour est allumée)."
        }
        if t.donnees == nil { return "Rémy n'arrive pas à charger ta journée. \(e)" }
        return "Rémy n'a pas pu rafraîchir ta journée" + (depuis.map { " (elle date \($0))." } ?? ".")
    }

    /// `alerte` : liseré rouge (quelque chose manque) ; sinon une simple information.
    private func ligne(_ texte: String, reessayer: Bool, envoyer: Bool = false, alerte: Bool = true) -> some View {
        HStack(spacing: 12) {
            Image(systemName: alerte ? "exclamationmark.triangle.fill" : "clock.arrow.circlepath")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(alerte ? Palette.danger : Palette.encre2)
            Text(texte)
                .font(Police.texte(14, .medium))
                .foregroundStyle(Palette.encre)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 12)
            Spacer(minLength: 0)
            if reessayer {
                BoutonTexte(app.tableau.chargement ? "…" : "Réessayer") {
                    Task {
                        if envoyer {
                            await app.tableau.envoyerEnAttente()
                            await app.carnet.envoyer()
                        } else {
                            await app.chargerTout()
                        }
                    }
                }
                .disabled(app.tableau.chargement)
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .frame(minHeight: 44)
        .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

// MARK: - Le conseil du moment

/// Une ou deux phrases de Rémy : réfléchies par GLM sur la tour quand elles
/// sont là et à jour, sinon calculées sur l'iPhone (sans IA). Toucher : le
/// conseil en grand ; appui : avec son « pourquoi » (retours TestFlight 13 :
/// plus d'ouverture directe du chat).
private struct ConseilDuMoment: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    let local: ConseilLocal
    let maintenant: Millis

    var body: some View {
        let glm = ConseilAffiche.glm(app.conseil.tour(.maintenant), maintenant: maintenant)
        HStack(alignment: .top, spacing: 14) {
            RoundedRectangle(cornerRadius: 1.5).fill(Palette.signal).frame(width: 3)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text("Rémy").font(Police.texte(13, .semibold)).foregroundStyle(Palette.encre)
                    Text(glm != nil ? "· conseil réfléchi" : "· conseil du moment").font(Police.texte(13)).foregroundStyle(Palette.encre3)
                }
                Text(glm?.texte ?? local.texte)
                    .font(Police.titre(20, .regular, italique: true))
                    .foregroundStyle(Palette.encre)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .contentTransition(.opacity)
                    .animation(.easeOut(duration: 0.25), value: glm?.texte)
            }
        }
        .padding(.horizontal, 22)
        .contentShape(Rectangle())
        .modifier(ToucherOuAppui(toucher: {
            Haptique.leger()
            ui.conseil = .detail
        }, appui: { ui.conseil = .pourquoi }, duree: 0.35))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Ouvre le conseil en grand ; appui : avec son pourquoi")
        .accessibilityAction(named: "Pourquoi ce conseil ?") { ui.conseil = .pourquoi }
    }
}

// MARK: - Maintenant

private struct CarteMaintenant: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    @Environment(\.openURL) private var ouvrirURL
    let journee: Journee?
    let maintenant: Date
    let demander: (String, String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            contenu(Jour.prochain(journee, maintenant: maintenant.millis))
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .carte()
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private func contenu(_ p: Jour.Prochain) -> some View {
        switch p {
        case .enCours(let e) where !e.estRendezVous:
            tache(e)
        case .enCours(let e):
            entete(e.titre, projet: nil, etat: "EN CE MOMENT")
            detail(Self.jusqua(e))
            BoutonA(titre: "En parler à Rémy", symbole: "bubble.left", principal: false) {
                demander(Brouillons.rendezVous(e), Fils.journee(Date()))
            }
        case .suivant(let e) where e.type == "tache" && peutCommencer:
            // « Commencer » : la tâche passe en cours tout de suite, et
            // l'activité en direct démarre (écran verrouillé, Dynamic Island).
            entete(e.titre, projet: e.projet, etat: "À VENIR")
            detail(avenir(e))
            HStack(spacing: 10) {
                BoutonA(titre: "Commencer", symbole: "play.fill") {
                    Haptique.leger()
                    Task { await app.tableau.commencer(id: e.id, titre: e.titre, duree: e.duree ?? e.dureeTotale) }
                }
                BoutonA(titre: "En parler", symbole: "bubble.left", principal: false) {
                    demander(Brouillons.tache(e.titre), Fils.journee(Date()))
                }
            }
        case .suivant(let e):
            entete(e.titre, projet: e.projet, etat: "À VENIR")
            detail(avenir(e))
            BoutonA(titre: "En parler à Rémy", symbole: "bubble.left", principal: false) {
                demander(e.estRendezVous ? Brouillons.rendezVous(e) : Brouillons.tache(e.titre), Fils.journee(Date()))
            }
        case .aFaire(let t, let total):
            entete(t.titre, projet: t.projet, etat: "À FAIRE AUJOURD'HUI")
            if total > 1 { detail("et \(total - 1) autre\(total > 2 ? "s" : "") tâche\(total > 2 ? "s" : "") aujourd'hui") }
            HStack(spacing: 10) {
                BoutonA(titre: "Terminer", symbole: "checkmark") { Cocher.tache(app, id: t.id, titre: t.titre, ui: ui) }
                    .accessibilityIdentifier("maintenant.terminer")
                if peutCommencer {
                    BoutonA(titre: "Commencer", symbole: "play.fill", principal: false) {
                        Haptique.leger()
                        Task { await app.tableau.commencer(id: t.id, titre: t.titre, duree: t.duree) }
                    }
                }
                // Le même « Gérer » que la tâche en cours (24/10) : décaler, modifier…
                BoutonA(titre: "Gérer", symbole: "slider.horizontal.3", principal: false) {
                    Haptique.leger()
                    ui.gerer = ElementJour.sansCreneau(t, retard: false)
                }
                .accessibilityIdentifier("maintenant.gerer")
            }
        case .rienDePrevu(let retards):
            TitreSection(texte: "Temps libre")
            Text("Plus rien de prévu").font(Police.titre(26)).foregroundStyle(Palette.encre)
            if retards > 0 {
                Risque(texte: retards > 1 ? "\(retards) tâches en retard" : "Une tâche en retard")
                BoutonA(titre: "Par quoi je commence ?", symbole: "bubble.left", principal: false) {
                    demander(Brouillons.retards, Fils.journee(Date()))
                }
            }
        case .aucuneSource:
            TitreSection(texte: "Ta journée")
            Text("Rémy ne voit pas encore ta journée").font(Police.titre(24)).foregroundStyle(Palette.encre)
            detail("Branche Motion ou ton agenda depuis le site : tes rendez-vous et tes tâches s'afficheront ici.")
            BoutonA(titre: "Ouvrir le site", principal: false) { ouvrirURL(app.api.base) }
        case .enPanne:
            TitreSection(texte: "Ta journée")
            Text("Impossible de lire ta journée pour l'instant").font(Police.titre(24)).foregroundStyle(Palette.encre)
            detail("Motion et ton agenda ne répondent pas.")
            BoutonA(titre: app.tableau.chargement ? "…" : "Réessayer", principal: false) { Task { await app.chargerTout() } }
                .disabled(app.tableau.chargement)
        default:
            TitreSection(texte: "Ta journée")
            detail("Rien à afficher pour le moment.")
        }
    }

    /// « Commencer » vit sur la tour (taches-etat-v2) : caché sans elle.
    private var peutCommencer: Bool { app.serveur?.sait("taches-etat-v2") == true }

    /// La tâche en cours : le gros chiffre du temps restant, rapporté au temps
    /// attribué (Sam, 15/10 : « 50 min sur 1 h 30 »), la barre du temps,
    /// Terminer et Gérer.
    @ViewBuilder
    private func tache(_ e: ElementJour) -> some View {
        let reste = max(1, Int(((e.finEffective - maintenant.millis) / 60_000).rounded(.up)))
        let progression = (maintenant.millis - e.debut) / max(60_000, e.finEffective - e.debut)
        HStack {
            if let p = e.projet, !p.isEmpty { Puce(texte: p, couleur: Palette.projet(p)) }
            Spacer()
            MarqueEnCours()
        }
        Text(e.titre)
            .font(Police.titre(26))
            .foregroundStyle(Palette.encre)
            .fixedSize(horizontal: false, vertical: true)
        if e.bloquee == true { MarqueBloquee(raison: e.raison) }
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(reste < 60 ? "\(reste)" : Format.duree(minutes: reste))
                .font(Police.titre(54))
                .foregroundStyle(Palette.encre)
                .contentTransition(.numericText())
                .monospacedDigit()
            Text(reste < 60 ? "min restantes" : "restantes")
                .font(Police.texte(16, .medium))
                .foregroundStyle(Palette.encre2)
            Text("· sur \(Format.duree(minutes: e.dureeTotale))")
                .font(Police.texte(16))
                .foregroundStyle(Palette.encre3)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        VStack(spacing: 4) {
            BarreTemps(progression: progression, couleur: Palette.projet(e.projet))
            HStack {
                Text(Format.heure(e.debut))
                Spacer()
                Text(Format.heure(e.finEffective))
            }
            .font(Police.mono(12))
            .foregroundStyle(Palette.encre3)
        }
        HStack(spacing: 10) {
            BoutonA(titre: "Terminer", symbole: "checkmark") { Cocher.tache(app, id: e.id, titre: e.titre, ui: ui) }
                .accessibilityIdentifier("maintenant.terminer")
            BoutonA(titre: "Gérer", symbole: "slider.horizontal.3", principal: false) {
                Haptique.leger()
                ui.gerer = e
            }
            .accessibilityIdentifier("maintenant.gerer")
        }
    }

    @ViewBuilder
    private func entete(_ titre: String, projet: String?, etat: String) -> some View {
        HStack {
            if let p = projet, !p.isEmpty { Puce(texte: p, couleur: Palette.projet(p)) }
            Spacer()
            Text(etat).font(Police.mono(11, .semibold)).tracking(1.2).foregroundStyle(Palette.encre2)
        }
        Text(titre)
            .font(Police.titre(26))
            .foregroundStyle(Palette.encre)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func detail(_ t: String) -> some View {
        Text(t).font(Police.texte(15)).foregroundStyle(Palette.encre2).fixedSize(horizontal: false, vertical: true)
    }

    /// « Jusqu'à 13:15 · Chez Paulette »
    static func jusqua(_ e: ElementJour) -> String {
        var bits = ["Jusqu'à \(Format.heure(e.finEffective))"]
        if let l = e.lieu, !l.isEmpty { bits.append(l) }
        return bits.joined(separator: " · ")
    }

    /// « 12:30 · dans 50 min · Chez Paulette »
    private func avenir(_ e: ElementJour) -> String {
        var bits = [Format.heure(e.debut), Format.dansCombien((e.debut - maintenant.millis) / 1000)]
        if let l = e.lieu, !l.isEmpty { bits.append(l) }
        return bits.joined(separator: " · ")
    }
}

// MARK: - La suite

/// Le planning compact : heures à gauche, couleur du projet, cadenas sur ce
/// qui ne bouge pas. La tâche en cours y reste (Sam, 15/10 : rien ne
/// disparaît parce que c'est aussi dans « Maintenant »). Toucher une ligne
/// l'ouvre ; appui d'environ 200 ms n'importe où : la journée à l'échelle.
private struct LaSuite: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    let journee: Journee?
    let maintenant: Date
    let demander: (String, String) -> Void
    @State private var plusTotOuvert = false
    @State private var organisation = false

    var body: some View {
        let now = maintenant.millis
        let items = journee?.items ?? []
        let passes = items.filter { Jour.etat($0, maintenant: now) == .passe }
        let suite = items.filter { Jour.etat($0, maintenant: now) != .passe }
        let toute = journee?.toute ?? []
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                TitreSection(texte: "La suite")
                    .frame(minHeight: 28, alignment: .bottomLeading)
                Spacer(minLength: 8)
                // Visible, à portée de pouce : la journée, demain, les 7 jours (24/10).
                BoutonEchelle { ui.journeeEtendue = true }
            }
            .padding(.leading, 22)
            .padding(.trailing, 10)
            VStack(alignment: .leading, spacing: 0) {
                if !toute.isEmpty {
                    Text("Toute la journée : " + toute.map(\.titre).joined(separator: " · "))
                        .font(Police.texte(15, .medium))
                        .foregroundStyle(Palette.encre)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 10)
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
                        .font(Police.texte(14, .medium))
                        .foregroundStyle(Palette.encre2)
                        .padding(.horizontal, 6)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if plusTotOuvert {
                        ForEach(passes, id: \.cle) { e in
                            LigneSuite(e: e, etat: .passe, demander: demander)
                        }
                    }
                }
                ForEach(Array(suite.enumerated()), id: \.element.cle) { i, e in
                    LigneSuite(e: e, etat: Jour.etat(e, maintenant: now), demander: demander)
                    if i < suite.count - 1 {
                        Rectangle().fill(Palette.filet).frame(height: 1).padding(.leading, 76)
                    }
                }
                if suite.isEmpty && toute.isEmpty {
                    Text("Plus rien à heure fixe aujourd'hui.")
                        .font(Police.texte(15))
                        .foregroundStyle(Palette.encre2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 12)
                }
            }
            .padding(.horizontal, 16)
            .contentShape(Rectangle())
            .modifier(ToucherOuAppui(toucher: {}, appui: { ui.journeeEtendue = true }))
            .accessibilityAction(named: "Voir toute la journée à l'échelle") { ui.journeeEtendue = true }
            LienTexte(titre: organisation && app.onglet == .aujourdhui && !app.chat.envoi ? "Ouverture…" : "Organiser ma journée avec Rémy",
                      couleur: Palette.encre2) {
                guard !organisation else { return }
                organisation = true
                Haptique.leger()
                Task {
                    await app.organiserJournee()
                    organisation = false
                }
            }
            .padding(.horizontal, 22)
        }
    }
}

/// Une ligne du planning : touchée, elle s'ouvre dans son panneau (tâche,
/// activité fixe ou rendez-vous) ; maintenue, la journée s'agrandit.
private struct LigneSuite: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    let e: ElementJour
    let etat: EtatMoment
    let demander: (String, String) -> Void

    var body: some View {
        let passe = etat == .passe
        let grise = (passe && e.estRendezVous) || e.fait == true
        let couleur = e.estRendezVous ? Palette.encre2 : Palette.projet(e.projet)
        HStack(alignment: .center, spacing: 0) {
            Group {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(Format.heure(e.debut)).font(Police.mono(14, .medium)).foregroundStyle(grise ? Palette.encre3 : Palette.encre)
                        Text(Format.heure(e.finEffective)).font(Police.mono(12)).foregroundStyle(Palette.encre3)
                    }
                    .frame(width: 50, alignment: .trailing)
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(couleur.opacity(grise ? 0.4 : 1))
                        .frame(width: 3)
                        .frame(maxHeight: .infinity)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            if e.estRendezVous {
                                Image(systemName: "lock.fill").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.encre2)
                            }
                            Text(e.titre)
                                .font(Police.texte(16, etat == .encours ? .semibold : .medium))
                                .foregroundStyle(grise ? Palette.encre3 : Palette.encre)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        let d = detail
                        if !d.isEmpty {
                            Text(d).font(Police.texte(13)).foregroundStyle(Palette.encre2).lineLimit(1)
                        }
                        if e.retard == true && !passe { Risque(texte: "En retard") }
                        if e.bloquee == true { MarqueBloquee(raison: e.raison) }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 12)
                .padding(.horizontal, 6)
                .contentShape(Rectangle())
            }
            .modifier(ToucherOuAppui(toucher: {
                Haptique.leger()
                ui.gerer = e
            }, appui: { ui.journeeEtendue = true }))
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Ouvre ses actions")
            if !e.estRendezVous {
                CaseACocher(nom: e.titre) { Cocher.tache(app, id: e.id, titre: e.titre, ui: etat == .encours ? ui : nil) }
            } else if e.estActivite && app.serveur?.sait("taches-etat-v2") == true {
                // Une activité à soi (« Aspirateur ») se coche aussi : gardé dans Remy, l'agenda ne change pas.
                CaseACocher(cochee: e.fait == true, nom: e.titre) {
                    Haptique.leger()
                    Task { await app.tableau.marquerFaite(e, fait: e.fait != true) }
                }
            }
        }
        .frame(minHeight: 56)
    }

    private var detail: String {
        var bits: [String] = etat == .encours ? ["en cours"] : []
        if let l = e.lieu, !l.isEmpty { bits.append(l) }
        if let p = e.projet, !p.isEmpty { bits.append(p) }
        bits.append(contentsOf: app.organisation.noms(e.etiquettes))
        if !e.estRendezVous { bits.append(Format.duree(minutes: e.dureeTotale)) }
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
}

// MARK: - À faire, en retard, cochées

/// Les tâches sans heure (Motion ne les a pas encore placées), le retard, et
/// ce qui vient d'être coché (avec « Annuler »).
private struct ATraiter: View {
    @Environment(AppModel.self) private var app
    @AppStorage(FiltreRappels.cle) private var filtreRappels = ""
    let journee: Journee?
    let demander: (String, String) -> Void

    var body: some View {
        let aFaire = journee?.aFaire ?? []
        let retard = journee?.retard
        let cochees = app.tableau.cochees
        let tousRappels = app.carnet.duJour()
        let filtre = FiltreRappels.lire(filtreRappels)
        let rappels = tousRappels.filter { FiltreRappels.garder($0, filtre) }
        // Sans date ou sans catégorie : à traiter dans la journée (Sam, 18/10).
        let aTrier = app.organisation.etiquettesDisponibles ? app.rappelsATraiter.count : 0
        if !aFaire.isEmpty || (retard?.total ?? 0) > 0 || !cochees.isEmpty || !tousRappels.isEmpty || aTrier > 0 {
            VStack(alignment: .leading, spacing: 18) {
                if !tousRappels.isEmpty || aTrier > 0 {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            TitreSection(texte: "Rappels du jour", compte: rappels.isEmpty ? nil : rappels.count)
                            Spacer()
                            if app.organisation.etiquettesDisponibles && !tousRappels.isEmpty { BoutonFiltreRappels() }
                        }
                        .padding(.horizontal, 6)
                        VStack(alignment: .leading, spacing: 0) {
                            if aTrier > 0 {
                                LigneTriRappels(nombre: aTrier)
                                if !rappels.isEmpty || !tousRappels.isEmpty { Rectangle().fill(Palette.filet).frame(height: 1) }
                            }
                            ForEach(rappels) { r in LigneRappel(rappel: r) }
                            if rappels.isEmpty && !tousRappels.isEmpty {
                                Text("Aucun rappel du jour avec ces étiquettes (\(tousRappels.count) masqué\(tousRappels.count > 1 ? "s" : "")).")
                                    .font(Police.texte(14))
                                    .foregroundStyle(Palette.encre2)
                                    .padding(.vertical, 12)
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 4)
                        .carte(rayon: 18)
                    }
                    .padding(.horizontal, 16)
                }
                if !aFaire.isEmpty {
                    bloc(titre: "À faire aujourd'hui", compte: aFaire.count) {
                        ForEach(aFaire) { t in LigneTache(t: t, enRetard: false, demander: demander) }
                    }
                }
                if let r = retard, r.total > 0 {
                    bloc(titre: "En retard", compte: r.total, couleur: Palette.danger) {
                        ForEach(r.items) { t in LigneTache(t: t, enRetard: true, demander: demander) }
                        if r.total > r.items.count {
                            let n = r.total - r.items.count
                            Text(n > 1 ? "Et \(n) autres en retard." : "Et une autre en retard.")
                                .font(Police.texte(14))
                                .foregroundStyle(Palette.encre2)
                                .padding(.vertical, 10)
                        }
                    }
                }
                if !cochees.isEmpty {
                    bloc(titre: "Cochées tout à l'heure", compte: nil) {
                        ForEach(cochees) { c in LigneCochee(c: c) }
                    }
                }
            }
        }
    }

    private func bloc<C: View>(titre: String, compte: Int?, couleur: Color = Palette.encre2,
                               @ViewBuilder _ contenu: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            TitreSection(texte: titre, compte: compte, couleur: couleur).padding(.horizontal, 6)
            VStack(alignment: .leading, spacing: 0) { contenu() }
                .padding(.horizontal, 14)
                .padding(.vertical, 4)
                .carte(rayon: 18)
        }
        .padding(.horizontal, 16)
    }
}

/// Une tâche sans heure fixe (à faire aujourd'hui, ou en retard). Touchée,
/// elle s'ouvre dans le même « Gérer » que les tâches du planning (24/10).
private struct LigneTache: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    let t: TacheResume
    let enRetard: Bool
    let demander: (String, String) -> Void

    var body: some View {
        HStack(spacing: 4) {
            Button {
                Haptique.leger()
                ui.gerer = ElementJour.sansCreneau(t, retard: enRetard)
            } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(t.titre)
                        .font(Police.texte(16, .medium))
                        .foregroundStyle(Palette.encre)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if !detail.isEmpty {
                        Text(detail).font(Police.texte(13)).foregroundStyle(enRetard ? Palette.danger : Palette.encre2)
                    }
                    if t.bloquee == true { MarqueBloquee(raison: t.raison) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Ouvre ses actions : décaler, modifier, terminer")
            CaseACocher(nom: t.titre) { Cocher.tache(app, id: t.id, titre: t.titre) }
        }
        .frame(minHeight: 52)
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
        bits.append(contentsOf: app.organisation.noms(t.etiquettes))
        if let p = LigneSuite.priorite(t.priorite) { bits.append(p) }
        return bits.joined(separator: " · ")
    }
}

/// « En attente » (ex-« Bloquée », 15/10) : une forme et un mot (pas une couleur), avec ce qui est attendu.
struct MarqueBloquee: View {
    let raison: String?

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "pause.circle.fill").font(.system(size: 11, weight: .semibold))
            Text(raison.map { "En attente · \($0)" } ?? "En attente").font(Police.texte(12, .semibold)).lineLimit(1)
        }
        .foregroundStyle(Palette.encre2)
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
            } else if c.horsLigne {
                // Restée sur l'iPhone faute de réseau : elle partira au retour de Rémy.
                if app.tableau.commande(de: c)?.puisDefaire == true {
                    etat("sera rouverte")
                } else {
                    etat("pas encore envoyée")
                    BoutonTexte("Annuler") {
                        Haptique.leger()
                        app.tableau.renoncer(c.id)
                    }
                }
            } else if c.enCours {
                ProgressView().frame(width: 44, height: 44)
            } else if c.ledgerId != nil {
                BoutonTexte("Annuler") { Task { await app.tableau.annulerCoche(c.id) } }
            }
        }
        .frame(minHeight: 52)
    }

    private func etat(_ texte: String) -> some View {
        Text(texte)
            .font(Police.texte(13, .medium))
            .foregroundStyle(Palette.encre3)
            .lineLimit(1)
    }
}

/// Cocher une tâche : elle part à l'instant, avec une petite vibration ; le
/// bandeau « Annuler » vit deux secondes, puis Motion est prévenu. Si Motion
/// refuse, la tâche revient — la vibration d'erreur accompagne le message.
enum Cocher {
    /// `ui` : après la tâche du moment, proposer discrètement la suivante.
    @MainActor
    static func tache(_ app: AppModel, id: String, titre: String, ui: EtatInterface? = nil) {
        Haptique.leger()
        Task {
            switch await app.tableau.terminer(id: id, titre: titre) {
            case .echec: Haptique.erreur()
            case .faite: ui?.suite = titre
            default: break
            }
        }
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
            VStack(alignment: .leading, spacing: 10) {
                TitreSection(texte: "Faire connaissance")
                Text(faites == 0
                     ? "Quelques conversations pour que Rémy te connaisse vraiment : \(sessions.count) étapes, à ton rythme."
                     : "\(faites) étape\(faites > 1 ? "s" : "") finie\(faites > 1 ? "s" : "") sur \(sessions.count).")
                    .font(Police.texte(15))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                Text(s.title)
                    .font(Police.titre(22))
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
                BoutonA(titre: attente ? "Ouverture…" : (e.convs?[s.id] != nil ? "Continuer" : "Commencer"), principal: false) {
                    guard !attente else { return }
                    ouverture = true
                    Haptique.leger()
                    Task {
                        await app.lancerSession(s)
                        ouverture = false
                    }
                }
                .disabled(attente)
            }
            .padding(20)
            .carte()
            .padding(.horizontal, 16)
        }
    }
}

/// Le soir, une porte vers le bilan (30 s).
private struct EntreeBilan: View {
    let ouvrir: () -> Void

    var body: some View {
        Button {
            Haptique.leger()
            ouvrir()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "moon.stars")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Palette.signal)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Faire le bilan du soir")
                        .font(Police.texte(16, .semibold))
                        .foregroundStyle(Palette.encre)
                    Text("Fait, glissé, ce qui reste → demain. 30 secondes.")
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.encre2)
                }
                Spacer(minLength: 6)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.encre3)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .carte(rayon: 18)
            .contentShape(Rectangle())
        }
        .buttonStyle(Appui())
    }
}
