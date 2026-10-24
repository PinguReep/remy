import SwiftUI
import RemyCore

// MARK: - « À trancher », la revue du dimanche, le tri des retards (24/10)
//
// Tout s'empilait sans rien qui invite à solder. Une carte sur Aujourd'hui
// (la revue le dimanche, sinon « À trancher » s'il y a quelque chose), une
// liste groupée avec un geste par ligne, une revue guidée de 10 minutes, et
// « On trie tes retards ? » au retour d'une absence. Aucun appel IA.

/// La carte d'Aujourd'hui : rien quand rien n'attend.
struct CarteATrancher: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let t = app.aTrancher
        if t.disponible {
            let dimanche = t.revueProposee()
            let n = t.total
            Group {
                if dimanche || n > 0 {
                    VStack(alignment: .leading, spacing: 10) {
                        TitreSection(texte: dimanche ? "Revue du dimanche" : "À trancher", compte: dimanche || n == 0 ? nil : n)
                        Text(dimanche
                             ? "Dix minutes pour solder la semaine : ce qui est fait, ce qui a glissé, tes idées, et trois décisions pour la suite."
                             : "\(n) chose\(n > 1 ? "s" : "") attend\(n > 1 ? "ent" : "") un geste : cartes, rappels, articles, vieux fils, idées.")
                            .font(Police.texte(15))
                            .foregroundStyle(Palette.encre2)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 10) {
                            BoutonA(titre: dimanche ? "Commencer la revue" : "Trancher", symbole: dimanche ? "calendar.badge.checkmark" : "tray.2", principal: dimanche) {
                                Haptique.leger()
                                t.feuille = dimanche ? .revue : .aTrancher
                            }
                            if dimanche && n > 0 {
                                BoutonA(titre: "À trancher · \(n)", principal: false) {
                                    Haptique.leger()
                                    t.feuille = .aTrancher
                                }
                            }
                        }
                    }
                    .padding(20)
                    .carte()
                    .padding(.horizontal, 16)
                }
            }
            .task { await t.chargerSiAncien() }
        }
    }
}

// MARK: - Une ligne et ses gestes

struct LigneTri: View {
    @Environment(AppModel.self) private var app
    let ligne: LigneATrancher

    var body: some View {
        let enCours = app.aTrancher.enCours.contains(ligne.cle)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: symbole).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.encre3).frame(width: 18)
                VStack(alignment: .leading, spacing: 3) {
                    Text(ligne.texte)
                        .font(Police.texte(16, .medium))
                        .foregroundStyle(Palette.encre)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                    if let d = sousTitre {
                        Text(d).font(Police.texte(13)).foregroundStyle(Palette.encre2).lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
                if enCours { ProgressView().controlSize(.small) }
            }
            HStack(spacing: 8) {
                ForEach(GesteTri.pour(ligne.type), id: \.self) { g in
                    Button {
                        Haptique.leger()
                        Task { await app.aTrancher.agir(g, sur: ligne) }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: g.symbole).font(.system(size: 12, weight: .semibold))
                            Text(g.libelle)
                        }
                        .font(Police.texte(14, .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .foregroundStyle(g.principal ? Palette.fond : Palette.encre)
                        .padding(.horizontal, 10)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(g.principal ? Palette.encre : Palette.fond2, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(Appui())
                    .accessibilityLabel("\(g.libelle) : \(ligne.texte)")
                }
            }
            .disabled(enCours)
            .opacity(enCours ? 0.5 : 1)
        }
        .padding(.vertical, 6)
    }

    private var symbole: String {
        switch ligne.type {
        case "carte": return "rectangle.and.pencil.and.ellipsis"
        case "doublon": return "square.on.square"
        case "rappel", "rappel-retard": return "bell"
        case "articles": return "cart"
        case "idee": return "lightbulb"
        case "fil": return "bubble.left"
        case "retard": return "exclamationmark.circle"
        default: return "circle"
        }
    }

    private var sousTitre: String? {
        var morceaux: [String] = []
        if let d = ligne.detail, !d.isEmpty { morceaux.append(d) }
        if let ms = ligne.depuis {
            morceaux.append(ligne.type == "retard" || ligne.type == "rappel-retard"
                            ? "prévu \(Format.jourCourt(ms.date))" : "depuis le \(Format.jourCourt(ms.date))")
        }
        return morceaux.isEmpty ? nil : morceaux.joined(separator: " · ")
    }
}

// MARK: - La liste groupée

struct ATrancherFeuille: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    /// Dans la revue : seulement ces groupes (nil : tous).
    var seulement: Set<String>? = nil
    var sauf: Set<String> = []
    var titre = "À trancher"

    var body: some View {
        NavigationStack {
            ListeTri(seulement: seulement, sauf: sauf)
                .navigationTitle(titre)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fermer") { fermer() } } }
        }
        .overlay(alignment: .bottom) { ToastView(marge: 12, annoncer: false) }
        .task { await app.aTrancher.charger() }
    }
}

/// Le contenu groupé, partagé par la feuille et les étapes de la revue.
struct ListeTri: View {
    @Environment(AppModel.self) private var app
    var seulement: Set<String>? = nil
    var sauf: Set<String> = []
    var vide = "Rien à trancher : tout est rangé."

    var body: some View {
        let t = app.aTrancher
        let groupes = t.groupes.filter { g in (seulement?.contains(g.id) ?? true) && !sauf.contains(g.id) }
        List {
            if groupes.isEmpty {
                Section {
                    if t.vue == nil && t.chargement {
                        HStack(spacing: 12) { ProgressView(); Text("Rémy rassemble ce qui attend…").foregroundStyle(Palette.encre2) }.frame(minHeight: 44)
                    } else if let e = t.erreur, t.vue == nil {
                        Text(e).foregroundStyle(Palette.danger)
                        Button("Réessayer") { Task { await t.charger() } }.frame(minHeight: 44)
                    } else {
                        Text(vide).foregroundStyle(Palette.encre2).frame(minHeight: 44, alignment: .leading)
                    }
                }
            }
            ForEach(groupes) { g in
                Section {
                    ForEach(g.lignes) { l in LigneTri(ligne: l) }
                    if g.total > g.lignes.count {
                        Text("Et \(g.total - g.lignes.count) de plus : elles viendront une fois celles-ci réglées.")
                            .font(Police.texte(13)).foregroundStyle(Palette.encre3)
                    }
                } header: {
                    TitreSection(texte: g.titre, compte: g.total)
                }
            }
            if let r = t.vue?.reportes, r > 0, seulement == nil {
                Section {
                    Text("\(r) ligne\(r > 1 ? "s" : "") remise\(r > 1 ? "s" : "") à plus tard : elle\(r > 1 ? "s" : "") reviendr\(r > 1 ? "ont" : "a") dans la semaine.")
                        .font(Police.texte(13)).foregroundStyle(Palette.encre3)
                }
            }
        }
        .listeAtelier()
        .refreshable { await t.charger() }
        .animation(.easeOut(duration: 0.2), value: t.masquees)
    }
}

// MARK: - « On trie tes retards ? »

struct RetardsFeuille: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer

    var body: some View {
        let t = app.aTrancher
        let lignes = t.retards()
        NavigationStack {
            List {
                Section {
                    Text("Tu as été absent quelques jours. Ligne par ligne : c'est fait, ça passe à demain, ou tu abandonnes. Tout s'annule.")
                        .font(Police.texte(15)).foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Section {
                    if lignes.isEmpty {
                        if t.chargement {
                            HStack(spacing: 12) { ProgressView(); Text("Lecture des retards…").foregroundStyle(Palette.encre2) }.frame(minHeight: 44)
                        } else if let e = t.erreur, t.vue == nil {
                            Text(e).foregroundStyle(Palette.danger)
                            Button("Réessayer") { Task { await t.charger() } }.frame(minHeight: 44)
                        } else {
                            Text("Plus rien en retard. Bon retour !").foregroundStyle(Palette.encre2).frame(minHeight: 44, alignment: .leading)
                        }
                    }
                    ForEach(lignes) { l in LigneTri(ligne: l) }
                } header: {
                    TitreSection(texte: "En retard", compte: lignes.count)
                }
            }
            .listeAtelier()
            .animation(.easeOut(duration: 0.2), value: t.masquees)
            .navigationTitle("On trie tes retards ?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(lignes.isEmpty ? "Fermer" : "Plus tard") { fermer() } } }
        }
        .overlay(alignment: .bottom) { ToastView(marge: 12, annoncer: false) }
    }
}

// MARK: - La revue du dimanche, guidée

struct RevueDimanche: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var etape = 0
    @State private var decisions = ["", "", ""]
    @State private var decisionsLues = false
    @State private var enregistrement = false

    private let titres = ["Ta semaine", "Tes idées", "À trancher", "Trois décisions", "Ce que j'ai appris sur toi"]

    var body: some View {
        let t = app.aTrancher
        NavigationStack {
            VStack(spacing: 0) {
                Barre(etape: etape, total: titres.count)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                Group {
                    switch etape {
                    case 0: semaine(t)
                    case 1: ListeTri(seulement: ["idees"], vide: "Aucune idée en attente : rien à trier cette semaine.")
                    case 2: ListeTri(sauf: ["idees"])
                    case 3: troisDecisions(t)
                    default: appris(t)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                navigation(t)
            }
            .background(Palette.fond)
            .navigationTitle(titres[etape])
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Plus tard") { fermer() } } }
        }
        .overlay(alignment: .bottom) { ToastView(marge: 84, annoncer: false) }
        .task {
            async let a: Void = t.chargerRevue()
            async let b: Void = t.charger()
            _ = await (a, b)
            if !decisionsLues, let d = t.revue?.decisions?.liste {
                for (i, x) in d.prefix(3).enumerated() { decisions[i] = x }
                decisionsLues = true
            }
        }
    }

    @ViewBuilder
    private func semaine(_ t: ATrancherModel) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let r = t.revue {
                    let domaines = r.domaines ?? []
                    let faites = domaines.reduce(0) { $0 + $1.faites }
                    let glissees = domaines.reduce(0) { $0 + $1.glissees }
                    Text(resume(faites: faites, glissees: glissees, rappels: r.rappelsFaits ?? 0))
                        .font(Police.texte(16)).foregroundStyle(Palette.encre)
                        .fixedSize(horizontal: false, vertical: true)
                    if domaines.isEmpty {
                        Vide(texte: "Rien de coché par Rémy ces 7 derniers jours. Une semaine calme, ou cochée ailleurs que dans l'app.")
                    } else {
                        VStack(spacing: 0) {
                            ForEach(domaines) { d in
                                HStack(alignment: .firstTextBaseline, spacing: 10) {
                                    Circle().fill(Palette.projet(d.nom)).frame(width: 9, height: 9)
                                    Text(d.nom).font(Police.texte(16, .medium)).foregroundStyle(Palette.encre).lineLimit(2)
                                    Spacer(minLength: 8)
                                    VStack(alignment: .trailing, spacing: 2) {
                                        Text("\(d.faites) fait\(d.faites > 1 ? "es" : "e")\(d.glissees > 0 ? " · \(d.glissees) glissée\(d.glissees > 1 ? "s" : "")" : "")")
                                            .font(Police.texte(14)).foregroundStyle(Palette.encre2)
                                        if d.minutes > 0 {
                                            Text(Format.duree(minutes: d.minutes)).font(Police.mono(13, .medium)).foregroundStyle(Palette.encre3)
                                        }
                                    }
                                }
                                .padding(.vertical, 10)
                                .frame(minHeight: 44)
                                .overlay(alignment: .bottom) { Filet() }
                            }
                        }
                        .padding(.horizontal, 16)
                        .carte()
                    }
                    if let g = r.glissees, !g.isEmpty {
                        TitreSection(texte: "Ce qui a glissé", compte: g.count)
                        ForEach(g.prefix(8)) { x in
                            Text("· \(x.nom)\(x.echeance.map { " — prévu \(Format.jourCourt($0.date))" } ?? "")")
                                .font(Police.texte(14)).foregroundStyle(Palette.encre2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Text("Elles sont dans « À trancher » si tu veux les régler maintenant.")
                            .font(Police.texte(13)).foregroundStyle(Palette.encre3)
                    }
                } else if t.chargementRevue {
                    Squelette(largeurs: [0.8, 0.6, 0.9, 0.5]).padding(20).carte()
                } else if let e = t.erreurRevue {
                    Vide(texte: e, titreAction: "Réessayer") { Task { await t.chargerRevue() } }
                }
            }
            .padding(16)
        }
    }

    private func resume(faites: Int, glissees: Int, rappels: Int) -> String {
        var s = "Cette semaine : \(faites) tâche\(faites > 1 ? "s" : "") faite\(faites > 1 ? "s" : "")"
        if rappels > 0 { s += ", \(rappels) rappel\(rappels > 1 ? "s" : "") fait\(rappels > 1 ? "s" : "")" }
        s += glissees > 0 ? ", \(glissees) qui \(glissees > 1 ? "ont" : "a") glissé." : ", rien n'a glissé."
        return s
    }

    @ViewBuilder
    private func troisDecisions(_ t: ATrancherModel) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Trois choses qui comptent pour la semaine qui vient. Rémy les garde sur ta tour ; tu peux en laisser vides.")
                    .font(Police.texte(15)).foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(0..<3, id: \.self) { i in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("\(i + 1)").font(Police.mono(15, .semibold)).foregroundStyle(Palette.signal).frame(width: 18)
                        TextField("Décision \(i + 1)", text: $decisions[i], axis: .vertical)
                            .font(Police.texte(16))
                            .lineLimit(1...3)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 48)
                            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.filet, lineWidth: 1))
                    }
                }
                BoutonA(titre: enregistrement ? "Enregistrement…" : "Garder ces décisions", symbole: "checkmark", principal: false) {
                    guard !enregistrement else { return }
                    enregistrement = true
                    Haptique.leger()
                    Task {
                        await t.enregistrerDecisions(decisions)
                        enregistrement = false
                    }
                }
                .disabled(enregistrement)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder
    private func appris(_ t: ATrancherModel) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                let lignes = t.revue?.appris ?? []
                if lignes.isEmpty {
                    Vide(texte: "La nuit n'a rien noté de neuf sur toi cette semaine. Plus tu parles à Rémy, plus il a de matière.")
                } else {
                    Text("Relevé par la réflexion de nuit — des hypothèses, pas des faits :")
                        .font(Police.texte(14)).foregroundStyle(Palette.encre2)
                    ForEach(lignes, id: \.self) { l in
                        Text(l)
                            .font(Police.texte(16))
                            .foregroundStyle(Palette.encre)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .carte(rayon: 16)
                    }
                }
            }
            .padding(16)
        }
    }

    private func navigation(_ t: ATrancherModel) -> some View {
        HStack(spacing: 10) {
            if etape > 0 {
                BoutonA(titre: "Précédent", principal: false) {
                    Haptique.leger()
                    withAnimation(.snappy) { etape -= 1 }
                }
            }
            BoutonA(titre: etape == titres.count - 1 ? "Terminer la revue" : "Suivant", principal: true) {
                Haptique.leger()
                if etape == titres.count - 1 {
                    t.marquerRevueFaite()
                    app.dire("Revue faite. Bonne semaine !")
                    fermer()
                } else {
                    withAnimation(.snappy) { etape += 1 }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Palette.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Filet() }
    }

    /// L'avancement : cinq traits, celui de l'étape en orange.
    private struct Barre: View {
        let etape: Int
        let total: Int
        var body: some View {
            HStack(spacing: 6) {
                ForEach(0..<total, id: \.self) { i in
                    Capsule().fill(i <= etape ? Palette.signal : Palette.fond3).frame(height: 4)
                }
            }
            .accessibilityElement()
            .accessibilityLabel("Étape \(etape + 1) sur \(total)")
        }
    }
}

// MARK: - Les feuilles, et le retour après une absence

struct FeuillesTri: ViewModifier {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scene

    func body(content: Content) -> some View {
        @Bindable var t = app.aTrancher
        content
            .sheet(item: $t.feuille) { f in
                switch f {
                case .aTrancher: ATrancherFeuille()
                case .revue: RevueDimanche()
                case .retards: RetardsFeuille()
                }
            }
            .task(id: scene) {
                guard scene == .active else { return }
                guard ProcessInfo.processInfo.environment["REMY_DEMO_ECRAN"] == nil else { return }
                let m = app.aTrancher
                guard m.noterVisite() else { return }
                // La tour d'abord (capacités), et jamais par-dessus une autre feuille.
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                guard !app.reglagesOuverts, app.nouveautes.affichees == nil else { return }
                await m.auRetour(absent: true)
            }
    }
}

extension View {
    func feuillesTri() -> some View { modifier(FeuillesTri()) }
}
