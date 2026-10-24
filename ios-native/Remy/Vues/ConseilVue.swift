import SwiftUI
import RemyCore

/// Le conseil du moment en grand (retours TestFlight 13) : toucher l'ouvre,
/// un appui l'ouvre avec son « pourquoi ». On y choisit le type de conseil,
/// on en demande un autre, et on en parle à Rémy seulement si on le décide.
struct ConseilPanneau: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    let mode: ModeConseil
    @State private var type: TypeConseil = .maintenant
    @State private var pourquoiOuvert = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { ctx in
            let maintenant = ctx.date.millis
            let j = app.tableau.donnees?.journee
            let local = Conseil.pour(type, j, maintenant: maintenant)
            let tour = app.conseil.tour(type)
            let glm = ConseilAffiche.glm(tour, maintenant: maintenant)
            let texte = glm?.texte ?? local?.texte
            VStack(spacing: 0) {
                entete(tour: tour)
                Rectangle().fill(Palette.filet).frame(height: 1)
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        types
                        Text(texte ?? "Rémy n'a pas encore ta journée : tire l'accueil vers le bas pour la charger.")
                            .font(Police.titre(24, .regular, italique: true))
                            .foregroundStyle(Palette.encre)
                            .lineSpacing(4)
                            .fixedSize(horizontal: false, vertical: true)
                            .contentTransition(.opacity)
                            .animation(.easeOut(duration: 0.2), value: texte)
                        source(glm: glm, tour: tour)
                        if glm != nil, let prio = tour?.conseil?.priorite {
                            // Le lien vers une priorité déclarée, vérifié par la tour (jamais inventé).
                            Label("Sert ta priorité « \(prio) »", systemImage: "star.fill")
                                .font(Police.texte(14, .medium))
                                .foregroundStyle(Palette.signal)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        pourquoi(glm?.pourquoi ?? local?.pourquoi ?? [], journee: j, maintenant: maintenant)
                        actions(texte: texte, tache: glm?.tache, journee: j)
                    }
                    .padding(20)
                }
                .scrollIndicators(.hidden)
            }
            .containerRelativeFrame(.vertical) { hauteur, _ in hauteur * 0.92 }
            .carte(rayon: 26)
        }
        .task(id: type) { await app.conseil.charger(type) }
        .onAppear { pourquoiOuvert = mode == .pourquoi }
    }

    private func entete(tour: ConseilTour?) -> some View {
        HStack(spacing: 4) {
            Text("Conseil du moment").font(Police.titre(22)).foregroundStyle(Palette.encre)
            Spacer()
            // « Un autre conseil » : seulement si GLM peut réfléchir (pas de faux bouton).
            if app.conseil.disponible && tour?.disponible != false {
                let tourne = app.conseil.renouvellement.contains(type)
                Button {
                    Haptique.leger()
                    Task { await app.conseil.renouveler(type) }
                } label: {
                    Group {
                        if tourne { ProgressView().controlSize(.small) } else {
                            Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 15, weight: .semibold))
                        }
                    }
                    .foregroundStyle(Palette.encre2)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(tourne)
                .accessibilityLabel("Un autre conseil")
            }
            Button { ui.conseil = nil } label: {
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
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
    }

    private var types: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(TypeConseil.allCases) { t in
                    let actif = t == type
                    Button {
                        Haptique.leger()
                        withAnimation(.snappy) { type = t }
                    } label: {
                        Text(t.libelle)
                            .font(Police.texte(14, .semibold))
                            .foregroundStyle(actif ? Palette.fond : Palette.encre)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 40)
                            .background(actif ? Palette.encre : Palette.fond2, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(Appui())
                    .accessibilityAddTraits(actif ? .isSelected : [])
                }
            }
        }
    }

    @ViewBuilder
    private func source(glm: ConseilTour.Texte?, tour: ConseilTour?) -> some View {
        let tourne = tour?.enCours == true || app.conseil.chargement.contains(type) || app.conseil.renouvellement.contains(type)
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: glm != nil ? "sparkle" : "iphone").font(.system(size: 11, weight: .semibold))
            Text(ConseilAffiche.source(glm: glm, tour: tour, disponible: app.conseil.disponible, tourne: tourne))
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(Police.texte(13))
        .foregroundStyle(Palette.encre3)
    }

    @ViewBuilder
    private func pourquoi(_ raisons: [String], journee: Journee?, maintenant: Millis) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                Haptique.leger()
                withAnimation(.snappy) { pourquoiOuvert.toggle() }
            } label: {
                HStack {
                    TitreSection(texte: "Pourquoi")
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .rotationEffect(.degrees(pourquoiOuvert ? 180 : 0))
                        .foregroundStyle(Palette.encre3)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if pourquoiOuvert {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(raisons, id: \.self) { r in puce(r) }
                    if raisons.isEmpty { puce("Rémy n'a pas encore de raison à donner.") }
                }
                let faits = ConseilAffiche.faits(journee, maintenant: maintenant)
                if !faits.isEmpty {
                    TitreSection(texte: "Ce que Rémy a regardé").padding(.top, 6)
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(faits, id: \.self) { f in puce(f, discret: true) }
                    }
                }
            }
        }
    }

    private func puce(_ t: String, discret: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle().fill(discret ? Palette.encre3 : Palette.signal).frame(width: 5, height: 5)
            Text(t).font(Police.texte(15)).foregroundStyle(discret ? Palette.encre2 : Palette.encre)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func actions(texte: String?, tache: String?, journee: Journee?) -> some View {
        VStack(spacing: 10) {
            if let t = tache, let e = journee?.items?.first(where: { !$0.estRendezVous && $0.titre == t }) {
                BoutonA(titre: "Ouvrir « \(e.titre) »", symbole: "slider.horizontal.3") {
                    ui.conseil = nil
                    ui.gerer = e
                }
            }
            if let texte {
                BoutonA(titre: "En parler avec Rémy", symbole: "bubble.left", principal: false) {
                    ui.conseil = nil
                    Task { _ = await app.preparer(Brouillons.conseil(texte), dansFil: Fils.journee(Date())) }
                }
            }
        }
        .padding(.top, 4)
    }
}

/// Ce que l'accueil et le panneau disent du conseil (testable sans écran).
enum ConseilAffiche {
    /// Le conseil de GLM s'il vaut encore : à jour, ou réfléchi il y a moins de 20 min.
    static func glm(_ tour: ConseilTour?, maintenant: Millis) -> ConseilTour.Texte? {
        guard let c = tour?.conseil, c.source == "glm" else { return nil }
        if tour?.aJour == true { return c }
        guard let g = c.genereA, maintenant - g < 20 * 60_000 else { return nil }
        return c
    }

    static func source(glm: ConseilTour.Texte?, tour: ConseilTour?, disponible: Bool, tourne: Bool) -> String {
        if let g = glm {
            let quand = g.genereA.map { " · \(Format.depuis($0.date).replacingOccurrences(of: "de ", with: "à "))" } ?? ""
            return "Réfléchi par Rémy (sur tes machines)" + quand + (tourne ? " · il réfléchit à nouveau…" : "")
        }
        if tourne { return "Calculé sur l'iPhone en attendant : Rémy réfléchit…" }
        if !disponible { return "Calculé sur l'iPhone, sans IA (le conseil réfléchi arrivera avec la mise à jour de ta tour)." }
        if let r = tour?.raison { return "Calculé sur l'iPhone, sans IA. \(r)" }
        return "Calculé sur l'iPhone, sans IA."
    }

    /// Les faits de la journée, en mots simples.
    static func faits(_ j: Journee?, maintenant: Millis) -> [String] {
        guard let j else { return [] }
        var f: [String] = []
        let items = j.items ?? []
        if let e = items.first(where: { Jour.etat($0, maintenant: maintenant) == .encours }) {
            f.append("En cours : « \(e.titre) » jusqu'à \(Format.heure(e.finEffective))")
        }
        if let r = items.first(where: { $0.estRendezVous && Jour.etat($0, maintenant: maintenant) == .avenir }) {
            f.append("Prochain rendez-vous fixe : « \(r.titre) » à \(Format.heure(r.debut))")
        }
        let aFaire = (j.aFaire ?? []).filter { $0.bloquee != true }
        if !aFaire.isEmpty { f.append("\(aFaire.count) tâche\(aFaire.count > 1 ? "s" : "") à faire aujourd'hui sans créneau") }
        if let r = j.retard, r.total > 0 { f.append("\(r.total) tâche\(r.total > 1 ? "s" : "") en retard") }
        let bloquees = ((j.aFaire ?? []).filter { $0.bloquee == true }.count) + items.filter { $0.bloquee == true }.count
        if bloquees > 0 { f.append("\(bloquees) en attente (jamais proposée\(bloquees > 1 ? "s" : ""))") }
        return f
    }
}
