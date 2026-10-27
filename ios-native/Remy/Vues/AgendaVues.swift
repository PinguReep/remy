import SwiftUI
import RemyCore

/// Toucher un élément de l'agenda (retours TestFlight 13 : « toucher Aspirateur
/// ouvre “Aide-moi à préparer” : ce n'est pas ce que je veux »). Le panneau
/// suit la nature réelle de l'élément :
///   - une activité à soi, à heure fixe (« Aspirateur ») : décaler, prolonger,
///     marquer faite — c'est le vrai cadenas, Motion planifie autour ;
///   - un rendez-vous avec d'autres personnes : rien ne se modifie d'un geste
///     (ni en silence) ; on l'ouvre dans Calendrier ou on en parle à Rémy.
struct RendezVousPanneau: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    @Environment(\.openURL) private var ouvrirURL
    let e: ElementJour
    @State private var decaler = false
    @State private var heure = Date()
    @State private var envoi = false
    /// Prolonger : choisir, puis confirmer (le même contrat que les tâches, 24/10).
    @State private var choix: Int?
    /// Le choix de « Décaler » en cours d'envoi (son id).
    @State private var decalage: String?

    private var gestes: Bool { app.serveur?.sait("agenda-gestes-v1") == true && app.tableau.donnees?.systeme?.agenda == true }

    var body: some View {
        let maintenant = Date().millis
        VStack(alignment: .leading, spacing: 16) {
            Capsule().fill(Palette.fond3).frame(width: 36, height: 5).frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "lock.fill").font(.system(size: 11, weight: .semibold))
                    Text(e.estActivite ? "Activité à heure fixe" : "Rendez-vous avec d'autres personnes")
                }
                .font(Police.texte(13, .medium))
                .foregroundStyle(Palette.encre2)
                Text(e.titre)
                    .font(Police.titre(22))
                    .foregroundStyle(Palette.encre)
                    .strikethrough(e.fait == true)
                    .fixedSize(horizontal: false, vertical: true)
                Text(horaires(maintenant))
                    .font(Police.mono(12))
                    .foregroundStyle(Palette.encre2)
                Text(e.estActivite
                     ? "Dans ton agenda : Motion place tes tâches autour, elle ne bouge pas toute seule."
                     : "Il vit dans ton agenda : Rémy ne le modifie jamais d'un geste.")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // La croix « Fermer » est posée en haut à droite (Surimpression).
            .padding(.trailing, 34)
            if e.estActivite {
                if gestes && Jour.etat(e, maintenant: maintenant) != .passe { prolonger }
                if gestes { decalerRangee }
                Rectangle().fill(Palette.filet).frame(height: 1)
                VStack(spacing: 0) {
                    if app.serveur?.sait("taches-etat-v2") == true {
                        ligne(e.fait == true ? "Pas encore terminée" : "Terminer",
                              detail: e.fait == true ? "Elle redevient à faire" : "Cochée dans Rémy ; ton agenda ne change pas",
                              symbole: e.fait == true ? "arrow.uturn.backward.circle" : "checkmark.circle") {
                            ui.gerer = nil
                            Task { await app.tableau.marquerFaite(e, fait: e.fait != true) }
                        }
                    }
                    if !gestes {
                        Text("Décaler et prolonger arriveront avec la mise à jour de ta tour.")
                            .font(Police.texte(13))
                            .foregroundStyle(Palette.encre2)
                            .padding(.vertical, 10)
                    }
                    preparer
                }
            } else {
                Rectangle().fill(Palette.filet).frame(height: 1)
                VStack(spacing: 0) {
                    if let url = URL(string: "calshow:\(Int(e.debut.date.timeIntervalSinceReferenceDate))") {
                        ligne("Ouvrir Calendrier à cette heure", detail: "Pour le déplacer toi-même", symbole: "calendar") {
                            ui.gerer = nil
                            ouvrirURL(url)
                        }
                    }
                    ligne("Demander à Rémy de le déplacer", detail: "Il propose, tu valides avant tout changement", symbole: "arrow.left.arrow.right") {
                        demander("Je voudrais déplacer « \(e.titre) » (\(Format.heure(e.debut))). Quels créneaux proposes-tu, et qui faut-il prévenir ?")
                    }
                    preparer
                }
            }
        }
        .padding(20)
        .carte(rayon: 28)
        .sheet(isPresented: $decaler) { feuilleDecaler }
    }

    /// Choisir, puis confirmer : la fin d'avant et d'après est dite avant d'agir.
    @ViewBuilder
    private var prolonger: some View {
        VStack(alignment: .leading, spacing: 10) {
            TitreSection(texte: "Prolonger")
            HStack(spacing: 8) {
                ForEach([15, 30, 60], id: \.self) { m in
                    let actif = choix == m
                    PuceGeste(titre: m < 60 ? "+\(m) min" : "+1 h", actif: actif) {
                        withAnimation(.snappy) { choix = actif ? nil : m }
                    }
                    .accessibilityLabel(m < 60 ? "Prolonger de \(m) minutes" : "Prolonger d'une heure")
                    .accessibilityAddTraits(actif ? .isSelected : [])
                }
            }
            if let m = choix {
                BoutonA(titre: envoi ? "…" : "Prolonger jusqu'à \(Format.heure(e.finEffective + Double(m) * 60_000))", hauteur: 46) {
                    guard !envoi else { return }
                    envoi = true
                    Haptique.leger()
                    Task {
                        if await app.tableau.prolongerActivite(e, de: m) { ui.gerer = nil } else { Haptique.erreur() }
                        envoi = false
                    }
                }
                .disabled(envoi)
                .transition(.opacity)
            }
        }
    }

    /// « Décaler » en un toucher, même durée, annulable ; l'heure exacte au 📅.
    private var decalerRangee: some View {
        VStack(alignment: .leading, spacing: 10) {
            TitreSection(texte: "Décaler")
            HStack(spacing: 8) {
                ForEach(Decaler.activite(e)) { c in
                    PuceGeste(titre: decalage == c.id ? "…" : c.libelle, actif: decalage == c.id) {
                        guard decalage == nil else { return }
                        decalage = c.id
                        Task {
                            let ok = await app.tableau.decaler(e, a: c.date)
                            decalage = nil
                            if ok { ui.gerer = nil } else { Haptique.erreur() }
                        }
                    }
                    .accessibilityLabel("Décaler à \(Format.heure(c.date))" + (c.id == "demain" ? ", demain" : ""))
                }
                PuceGeste(symbole: "calendar", actif: false) {
                    heure = e.debut.date
                    decaler = true
                }
                .frame(width: 50)
                .accessibilityLabel("Choisir une autre heure")
            }
            .disabled(decalage != nil)
        }
    }

    private var preparer: some View {
        ligne("En parler à Rémy", detail: "Une question prête, envoyée seulement si tu le décides", symbole: "bubble.left") {
            demander(Brouillons.rendezVous(e))
        }
    }

    private var feuilleDecaler: some View {
        NavigationStack {
            Form {
                DatePicker("Nouvelle heure", selection: $heure, displayedComponents: [.date, .hourAndMinute])
                    .environment(\.locale, Format.locale)
                    .environment(\.timeZone, Format.fuseau)
                Text("Même durée (\(Format.duree(minutes: Int(((e.finEffective - e.debut) / 60_000).rounded())))). Annulable juste après.")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
            }
            .navigationTitle(e.titre)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { decaler = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(envoi ? "…" : "Décaler") {
                        guard !envoi else { return }
                        envoi = true
                        Task {
                            let ok = await app.tableau.decaler(e, a: heure)
                            envoi = false
                            decaler = false
                            if ok { ui.gerer = nil }
                        }
                    }
                    .disabled(envoi || abs(heure.millis - e.debut) < 60_000)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func horaires(_ maintenant: Millis) -> String {
        var bits = ["\(Format.heure(e.debut)) – \(Format.heure(e.finEffective))"]
        if let j = Format.autreJour(e.debut) { bits.insert(j, at: 0) }
        if let l = e.lieu, !l.isEmpty { bits.append(l) }
        if e.fait == true { bits.append("faite") } else if Jour.etat(e, maintenant: maintenant) == .encours { bits.append("en cours") }
        return bits.joined(separator: " · ")
    }

    private func ligne(_ titre: String, detail: String, symbole: String, faire: @escaping () -> Void) -> some View {
        Button {
            Haptique.leger()
            faire()
        } label: {
            HStack(spacing: 14) {
                Image(systemName: symbole).font(.system(size: 17, weight: .medium)).foregroundStyle(Palette.encre2).frame(width: 26)
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

/// Après la tâche du moment : « Et maintenant ? » (retours TestFlight 13 :
/// proposer discrètement la suivante, ou en choisir une autre).
struct EtMaintenant: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    let terminee: String

    var body: some View {
        let suivante = ChoixTache.suivante(app.tableau.donnees?.journee, maintenant: Date().millis)
        let peutCommencer = app.serveur?.sait("taches-etat-v2") == true
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("« \(terminee) » terminée. Et maintenant ?")
                    .font(Police.texte(15, .semibold))
                    .foregroundStyle(Palette.encre)
                    .lineLimit(2)
                Spacer()
                Button { ui.suite = nil } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Palette.encre3)
                        .frame(width: 44, height: 32).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Fermer")
            }
            HStack(spacing: 8) {
                if let s = suivante {
                    let enCours = s.item.map { Jour.etat($0, maintenant: Date().millis) == .encours } ?? false
                    BoutonA(titre: enCours ? "Continuer « \(s.titre) »" : peutCommencer ? "Commencer « \(s.titre) »" : "Ouvrir « \(s.titre) »",
                            symbole: enCours || !peutCommencer ? "slider.horizontal.3" : "play.fill", hauteur: 44) {
                        ui.suite = nil
                        if peutCommencer, let item = s.item, Jour.etat(item, maintenant: Date().millis) == .encours {
                            ui.gerer = item
                        } else if peutCommencer {
                            Task { await app.tableau.commencer(id: s.id, titre: s.titre, duree: s.duree) }
                        } else if let item = s.item {
                            ui.gerer = item
                        }
                    }
                }
                BoutonA(titre: "Choisir…", principal: suivante == nil, hauteur: 44) {
                    ui.suite = nil
                    ui.choixTache = true
                }
                .frame(maxWidth: suivante == nil ? .infinity : 120)
            }
        }
        .padding(14)
        .carte(rayon: 20)
        .task(id: terminee) {
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            if ui.suite == terminee { ui.suite = nil }
        }
    }
}

/// Choisir la prochaine tâche : celles du jour, en retard, puis la prochaine de
/// chaque projet cette semaine. Toucher : la commencer (gardé dans Remy).
struct ChoixTache: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    @Environment(\.dismiss) private var fermer

    struct Candidate: Identifiable, Equatable {
        let id: String
        let titre: String
        let detail: String
        let duree: Int?
        var item: ElementJour? = nil
    }

    /// La prochaine tâche placée par Motion (pas un rendez-vous, pas en attente).
    static func suivante(_ j: Journee?, maintenant: Millis) -> Candidate? {
        let items = (j?.items ?? []).filter { !$0.estRendezVous && $0.bloquee != true && $0.finEffective > maintenant }
        if let e = items.first(where: { Jour.etat($0, maintenant: maintenant) == .avenir }) ?? items.first {
            return Candidate(id: e.id, titre: e.titre, detail: Format.heure(e.debut), duree: e.duree, item: e)
        }
        if let t = (j?.aFaire ?? []).first(where: { $0.bloquee != true }) {
            return Candidate(id: t.id, titre: t.titre, detail: "à faire aujourd'hui", duree: t.duree)
        }
        return nil
    }

    var body: some View {
        let maintenant = Date().millis
        let j = app.tableau.donnees?.journee
        let aujourdhui: [Candidate] =
            (j?.items ?? []).filter { !$0.estRendezVous && $0.bloquee != true && Jour.etat($0, maintenant: maintenant) == .avenir }
                .map { Candidate(id: $0.id, titre: $0.titre, detail: "\(Format.heure($0.debut)) · \(Format.duree(minutes: $0.dureeTotale))", duree: $0.duree, item: $0) }
            + (j?.aFaire ?? []).filter { $0.bloquee != true }
                .map { Candidate(id: $0.id, titre: $0.titre, detail: $0.echeance.map { "avant \(Format.heure($0))" } ?? "aujourd'hui", duree: $0.duree) }
        let retard = (j?.retard?.items ?? []).filter { $0.bloquee != true }
            .map { Candidate(id: $0.id, titre: $0.titre, detail: "en retard", duree: $0.duree) }
        let dejaVus = Set((aujourdhui + retard).map(\.id) + (j?.items ?? []).map(\.id))
        let semaine = (app.projets.liste?.projets ?? []).compactMap { p -> Candidate? in
            guard let t = p.prochaine, !dejaVus.contains(t.id), t.bloquee != true else { return nil }
            if let e = t.echeance, e > maintenant + 7 * 86_400_000 { return nil }
            return Candidate(id: t.id, titre: t.titre, detail: p.nom + (t.echeance.map { " · \(Format.jourCourt($0.date))" } ?? ""), duree: t.duree)
        }
        let peutCommencer = app.serveur?.sait("taches-etat-v2") == true
        NavigationStack {
            List {
                if !peutCommencer {
                    Text("« Commencer » arrivera avec la mise à jour de ta tour ; d'ici là, une tâche placée s'ouvre dans « Gérer ».")
                        .font(Police.texte(13)).foregroundStyle(Palette.encre2)
                }
                section("Aujourd'hui", aujourdhui, peutCommencer)
                section("En retard", retard, peutCommencer)
                section("Cette semaine", semaine, peutCommencer)
                if aujourdhui.isEmpty && retard.isEmpty && semaine.isEmpty {
                    Text("Rien d'autre à proposer : Motion n'a plus de tâche ouverte pour toi.")
                        .foregroundStyle(Palette.encre2)
                }
            }
            .navigationTitle("Et maintenant ?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Fermer") { fermer() } } }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private func section(_ titre: String, _ liste: [Candidate], _ peutCommencer: Bool) -> some View {
        if !liste.isEmpty {
            Section(titre) {
                ForEach(liste) { c in
                    Button {
                        Haptique.leger()
                        fermer()
                        if peutCommencer {
                            Task { await app.tableau.commencer(id: c.id, titre: c.titre, duree: c.duree) }
                        } else if let item = c.item {
                            ui.gerer = item
                        }
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.titre).font(Police.texte(16, .medium)).foregroundStyle(Palette.encre)
                                Text(c.detail).font(Police.texte(13)).foregroundStyle(Palette.encre2)
                            }
                            Spacer()
                            if peutCommencer || c.item != nil {
                                Image(systemName: peutCommencer ? "play.circle" : "chevron.right").foregroundStyle(Palette.encre2)
                            }
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!peutCommencer && c.item == nil)
                }
            }
        }
    }
}
