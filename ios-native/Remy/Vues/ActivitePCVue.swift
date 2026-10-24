import SwiftUI
import RemyCore

/// Réglages › Activité du PC (24/10) : ActivityWatch, sur la tour, note
/// l'appli au premier plan ; la tour n'en garde que le temps actif par appli
/// et par catégorie, jamais un titre. Coupée par défaut ; rien ne sort de la tour.
struct ActivitePCVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var effacerOuvert = false
    @State private var ajoutOuvert = false
    @State private var nouvelleExclusion = ""
    /// L'appli ou le site glissé « Ne plus compter » : confirmé avant d'effacer son historique.
    @State private var aExclure: AExclure?

    private struct AExclure {
        let nom: String
        let libelle: String
        let message: String
    }

    var body: some View {
        let m = app.activitePC
        NavigationStack {
            List {
                if let v = m.vue {
                    interrupteur(v)
                    if v.actif {
                        etat(v)
                        bilan("Aujourd'hui", v.aujourdhui, vide: "Rien encore aujourd'hui : le temps compte quand tu es devant le PC. \(v.releve).")
                        bilan("Ces 7 jours", v.semaine, vide: "Pas encore assez de relevés pour la semaine.", pied: v.comparaison)
                        applis(v)
                    }
                    exclusions(v)
                    Section {
                        Text("Lu sur ta tour seulement. Les titres de fenêtres ne sont jamais gardés, un site se réduit à son domaine, la navigation privée est ignorée. Gardé \(v.jours ?? 90) jours, puis effacé. Le modèle local s'en sert comme repère ; Claude ne reçoit jamais ces relevés (avec le secours Claude, il peut lire ce que Rémy t'en a dit).")
                            .font(Police.texte(12))
                            .foregroundStyle(Palette.encre3)
                            .fixedSize(horizontal: false, vertical: true)
                        Button(role: .destructive) { effacerOuvert = true } label: {
                            Label("Tout effacer", systemImage: "trash").frame(minHeight: 44)
                        }
                        .disabled(m.enCours)
                    }
                } else if let e = m.erreur {
                    Section {
                        Text(e).font(Police.texte(15)).foregroundStyle(Palette.danger)
                            .fixedSize(horizontal: false, vertical: true)
                        BoutonTexte("Réessayer") { Task { await m.charger() } }
                    }
                } else {
                    Section { Squelette(largeurs: [0.6, 0.9, 0.5]) }
                    Section { Squelette(largeurs: [0.8, 0.7, 0.4]) }
                }
            }
            .navigationTitle("Activité du PC")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK") { fermer() } } }
            .task { if ProcessInfo.processInfo.environment["REMY_DEMO_ECRAN"] != "activite-pc" { await m.charger() } }
            .refreshable { await m.relever() }
            .alert("Ne plus compter une appli", isPresented: $ajoutOuvert) {
                TextField("Nom de l'appli (ex. Discord)", text: $nouvelleExclusion)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("Exclure") {
                    let nom = nouvelleExclusion
                    Task { await m.exclure(nom) }
                }
                .disabled(nouvelleExclusion.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Annuler", role: .cancel) {}
            } message: {
                Text("Son nom d'exécutable sans « .exe », ou un site (exemple.org). Ce qui était déjà compté s'efface.")
            }
            .confirmationDialog("Effacer toute l'activité du PC ?", isPresented: $effacerOuvert, titleVisibility: .visible) {
                Button("Tout effacer", role: .destructive) { Task { await m.toutEffacer() } }
            } message: {
                Text("Sur la tour. Ce qui précède ne sera pas relu dans ActivityWatch ; le relevé continue si l'activité reste allumée.")
            }
            .confirmationDialog("Ne plus compter ?",
                                isPresented: Binding(get: { aExclure != nil }, set: { if !$0 { aExclure = nil } }),
                                titleVisibility: .visible, presenting: aExclure) { a in
                Button("Ne plus compter \(a.libelle)", role: .destructive) { Task { await m.exclure(a.nom) } }
                Button("Annuler", role: .cancel) {}
            } message: { a in
                Text(a.message)
            }
        }
    }

    // MARK: Sections

    private func interrupteur(_ v: VueActivitePC) -> some View {
        let m = app.activitePC
        return Section {
            Toggle(isOn: Binding(get: { v.actif }, set: { oui in
                Haptique.leger()
                Task { await m.activer(oui) }
            })) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Activité du PC").font(Police.texte(16, .medium)).foregroundStyle(Palette.encre)
                    Text("Le temps passé dans chaque appli de ta tour, d'après ActivityWatch. Rémy y voit des repères sur ta journée.")
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(Palette.signal)
            .frame(minHeight: 60)
            .disabled(v.coupeParLaTour || m.enCours)
            if v.coupeParLaTour {
                Text("Coupée sur la tour (REMY_ACTIVITE_PC=off) : retire ce réglage de remy.env pour pouvoir l'allumer ici.")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            } else if m.enCours {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("La tour relit ActivityWatch…").font(Police.texte(13)).foregroundStyle(Palette.encre2)
                }
                .frame(minHeight: 44)
            }
        }
    }

    @ViewBuilder
    private func etat(_ v: VueActivitePC) -> some View {
        Section {
            if let p = v.probleme {
                VStack(alignment: .leading, spacing: 6) {
                    Label(p, systemImage: "exclamationmark.triangle")
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(v.activitywatch.joignable == true
                         ? "Sur la tour : ouvre ActivityWatch (l'icône près de l'horloge) et relance-le ; le dépannage est dans docs/tour.md."
                         : "Sur la tour : installe ActivityWatch (activitywatch.net) et lance-le avec Windows ; le pas à pas est dans docs/tour.md.")
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                    BoutonTexte("Réessayer maintenant") { Task { await app.activitePC.relever() } }
                        .disabled(app.activitePC.enCours)
                }
                .padding(.vertical, 4)
            } else {
                HStack {
                    Text(v.releve).font(Police.texte(14)).foregroundStyle(Palette.encre2)
                    Spacer(minLength: 8)
                    if let version = v.activitywatch.version {
                        Text("ActivityWatch \(version)").font(Police.texte(12)).foregroundStyle(Palette.encre3)
                    }
                }
                .frame(minHeight: 36)
                if v.activitywatch.web == false {
                    Text("Sans l'extension ActivityWatch du navigateur, les sites ne sont pas détaillés (le temps du navigateur compte quand même).")
                        .font(Police.texte(12))
                        .foregroundStyle(Palette.encre3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    @ViewBuilder
    private func bilan(_ titre: String, _ b: BilanActivite, vide: String, pied: String? = nil) -> some View {
        Section {
            if b.total < 60 {
                Text(vide).font(Police.texte(14)).foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(b.categories) { c in
                    barre(c.nom, c.secondes, part: b.part(c.secondes))
                }
            }
        } header: {
            HStack {
                Text(titre)
                Spacer()
                if b.total >= 60 {
                    Text(ActivitePC.duree(b.total)).monospacedDigit()
                }
            }
        } footer: {
            if let pied {
                Text(pied).font(Police.texte(12))
            }
        }
    }

    private func barre(_ nom: String, _ secondes: Double, part: Double) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(nom).font(Police.texte(15)).foregroundStyle(Palette.encre)
                Spacer(minLength: 8)
                Text(ActivitePC.duree(secondes))
                    .font(Police.mono(13))
                    .foregroundStyle(Palette.encre2)
                    .monospacedDigit()
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.fond3)
                    Capsule().fill(Palette.signal).frame(width: max(4, g.size.width * CGFloat(part)))
                }
            }
            .frame(height: 6)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(nom) : \(ActivitePC.duree(secondes))")
    }

    @ViewBuilder
    private func applis(_ v: VueActivitePC) -> some View {
        let liste = v.semaine.applis
        if !liste.isEmpty {
            Section {
                ForEach(liste) { a in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(a.libelle).font(Police.texte(15)).foregroundStyle(Palette.encre)
                            if let c = a.categorie, let nom = v.semaine.categories.first(where: { $0.id == c })?.nom ?? nomCategorie(c) {
                                Text(nom).font(Police.texte(12)).foregroundStyle(Palette.encre3)
                            }
                        }
                        Spacer(minLength: 8)
                        Text(ActivitePC.duree(a.secondes))
                            .font(Police.mono(13))
                            .foregroundStyle(Palette.encre2)
                            .monospacedDigit()
                    }
                    .frame(minHeight: 44)
                    // Pas de glissement complet ni de rôle destructif : la ligne
                    // ne disparaît pas avant la confirmation.
                    .swipeActions(allowsFullSwipe: false) {
                        Button {
                            let duree = ActivitePC.duree(a.secondes)
                            aExclure = AExclure(nom: a.nom, libelle: a.libelle, message: a.categorie == "navigateur"
                                ? "Ses \(duree) de la semaine, tout son historique et les sites relevés s'effacent sur la tour, sans retour."
                                : "Ses \(duree) de la semaine et tout son historique s'effacent sur la tour, sans retour.")
                        } label: {
                            Label("Ne plus compter", systemImage: "eye.slash")
                        }
                        .tint(Palette.danger)
                    }
                }
                if !v.semaine.domaines.isEmpty {
                    DisclosureGroup("Sites (domaines seulement)") {
                        ForEach(v.semaine.domaines) { d in
                            HStack {
                                Text(d.nom).font(Police.texte(14)).foregroundStyle(Palette.encre)
                                Spacer(minLength: 8)
                                Text(ActivitePC.duree(d.secondes)).font(Police.mono(13)).foregroundStyle(Palette.encre2).monospacedDigit()
                            }
                            .frame(minHeight: 44)
                            .swipeActions(allowsFullSwipe: false) {
                                Button {
                                    aExclure = AExclure(nom: d.nom, libelle: d.nom,
                                                        message: "Ses \(ActivitePC.duree(d.secondes)) de la semaine et tout son historique s'effacent sur la tour, sans retour.")
                                } label: {
                                    Label("Ne plus compter", systemImage: "eye.slash")
                                }
                                .tint(Palette.danger)
                            }
                        }
                    }
                    .font(Police.texte(14))
                    .frame(minHeight: 44)
                }
            } header: {
                Text("Applis les plus utilisées (7 jours)")
            } footer: {
                Text("Glisse une appli ou un site vers la gauche pour ne plus le compter.").font(Police.texte(12))
            }
        }
    }

    private func exclusions(_ v: VueActivitePC) -> some View {
        Section {
            if v.exclusions.isEmpty && v.exclusionsTour.isEmpty {
                Text("Aucune appli exclue.").font(Police.texte(14)).foregroundStyle(Palette.encre2)
            }
            ForEach(v.exclusions, id: \.self) { nom in
                Text(nom).font(Police.texte(15)).foregroundStyle(Palette.encre)
                    .frame(minHeight: 36)
                    .swipeActions {
                        Button { Task { await app.activitePC.retirerExclusion(nom) } } label: {
                            Label("Compter de nouveau", systemImage: "eye")
                        }
                        .tint(Palette.signal)
                    }
            }
            ForEach(v.exclusionsTour, id: \.self) { nom in
                HStack {
                    Text(nom).font(Police.texte(15)).foregroundStyle(Palette.encre2)
                    Spacer()
                    Text("réglée sur la tour").font(Police.texte(12)).foregroundStyle(Palette.encre3)
                }
                .frame(minHeight: 36)
            }
            Button {
                nouvelleExclusion = ""
                ajoutOuvert = true
            } label: {
                Label("Ne plus compter une appli…", systemImage: "plus.circle").frame(minHeight: 44)
            }
            .disabled(app.activitePC.enCours || v.coupeParLaTour)
        } header: {
            Text("Jamais comptées")
        }
    }

    private func nomCategorie(_ id: String) -> String? {
        ["developpement": "Développement", "navigateur": "Navigateur", "communication": "Communication", "jeux": "Jeux",
         "bureautique": "Bureautique", "multimedia": "Multimédia", "autre": "Autre"][id]
    }
}

/// Une semaine fictive pour la capture de la CI (aucune vraie donnée).
enum ActivitePCDemo {
    static func vue() -> VueActivitePC {
        let maintenant = Date().millis
        func cat(_ id: String, _ nom: String, _ min: Double) -> DureeCategorie { DureeCategorie(id: id, nom: nom, secondes: min * 60) }
        func app(_ nom: String, _ libelle: String, _ c: String, _ min: Double) -> DureeAppli {
            DureeAppli(nom: nom, libelle: libelle, categorie: c, secondes: min * 60)
        }
        let aujourdhui = BilanActivite(total: 330 * 60,
                                       categories: [cat("developpement", "Développement", 190), cat("navigateur", "Navigateur", 65),
                                                    cat("communication", "Communication", 40), cat("multimedia", "Multimédia", 35)],
                                       applis: [app("code", "VS Code", "developpement", 170), app("chrome", "Chrome", "navigateur", 65)])
        let semaine = BilanActivite(total: 1_710 * 60,
                                    categories: [cat("developpement", "Développement", 860), cat("navigateur", "Navigateur", 410),
                                                 cat("jeux", "Jeux", 220), cat("communication", "Communication", 130),
                                                 cat("bureautique", "Bureautique", 90)],
                                    applis: [app("code", "VS Code", "developpement", 780), app("chrome", "Chrome", "navigateur", 410),
                                             app("steam", "Steam", "jeux", 220), app("discord", "Discord", "communication", 130),
                                             app("obsidian", "Obsidian", "bureautique", 90), app("windowsterminal", "Terminal", "developpement", 80)],
                                    domaines: [DureeDomaine(nom: "developer.example.org", secondes: 150 * 60), DureeDomaine(nom: "video.example", secondes: 95 * 60)])
        return VueActivitePC(actif: true, activitywatch: EtatActivityWatch(joignable: true, version: "v0.13.2", fenetre: true, afk: true, web: true),
                             derniereCollecte: maintenant - 8 * 60_000, aujourdhui: aujourdhui, semaine: semaine,
                             semainePrecedente: BilanActivite(total: 1_540 * 60, categories: [], applis: []),
                             exclusions: ["lecteur-de-mots-de-passe"], exclusionsTour: [])
    }
}
