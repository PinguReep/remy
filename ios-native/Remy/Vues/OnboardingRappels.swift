import SwiftUI
import RemyCore

/// Le tri des rappels. La première fois : d'abord les catégories (proposées, à
/// ajouter, renommer, supprimer, valider). Ensuite, et à chaque fois qu'il y a
/// des rappels « à traiter » (Sam, 18/10 : il y note dans la journée ce qu'il
/// faut caser — sans date, ou sans catégorie, un rappel attend) : pour chacun,
/// une date et une heure, des catégories, et garder / tâche Motion / rien.
/// GLM (sur tes machines) propose ; rien n'est converti ni déplacé avant
/// « Valider ». N'ouvre pas le grand onboarding de la mémoire.
enum EtapeOnboardingRappels { static let cle = "onboardingRappels" } // "" | "reporte" | "fait"

struct OnboardingRappels: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @AppStorage(EtapeOnboardingRappels.cle) private var etat = ""
    /// 2 : directement au tri (catégories déjà là).
    var etapeInitiale = 1
    @State private var etape = 1
    /// Une ligne de l'étape 1 : une étiquette existante (id) ou à créer.
    private struct Categorie: Identifiable {
        let id = UUID()
        var etiquette: String?
        var nom: String
    }
    @State private var categories: [Categorie] = []
    @State private var nouvelle = ""

    /// Ce que Sam (ou GLM, tant qu'il n'y a pas touché) choisit pour un rappel.
    private struct Choix {
        var action = "garder" // garder, tache, rien
        var etiquettes: Set<String> = []
        var quand: Date?
    }
    /// Les rappels à trier, figés à l'ouverture : une ligne ne disparaît pas
    /// sous le doigt dès qu'elle reçoit sa date.
    @State private var aTrier: [String] = []
    @State private var choix: [String: Choix] = [:]
    /// Lignes modifiées à la main : la proposition de GLM, arrivée après, ne les écrase pas.
    @State private var touchees: Set<String> = []
    @State private var analyse = false
    @State private var erreur: String?
    @State private var envoi = false
    @State private var confirmer = false

    private var premiereFois: Bool { etapeInitiale == 1 }

    var body: some View {
        NavigationStack {
            Group {
                if etape == 1 { categoriesVue } else { rappelsVue }
            }
            .navigationTitle(etape == 1 ? "Tes catégories" : "Rappels à traiter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Plus tard") {
                        if etat != "fait" { etat = "reporte" }
                        fermer()
                    }
                }
            }
        }
        .onAppear {
            if etapeInitiale == 2 && etape == 1 && !app.organisation.etiquettes.isEmpty {
                etape = 2
                commencerTri()
            }
            if app.organisation.etiquettes.isEmpty {
                categories = OrganisationModel.proposees.map { Categorie(etiquette: nil, nom: $0) }
            } else {
                categories = app.organisation.etiquettes.map { Categorie(etiquette: $0.id, nom: $0.nom) }
            }
        }
        .alert("Convertir en tâches Motion ?", isPresented: $confirmer) {
            Button("Convertir et valider") { Task { await appliquer() } }
            Button("Annuler", role: .cancel) {}
        } message: {
            let n = aTrier.filter { choix[$0]?.action == "tache" }.count
            Text("\(n) rappel\(n > 1 ? "s" : "") deviendr\(n > 1 ? "ont" : "a") des tâches que Motion planifiera ; le rappel est alors retiré.")
        }
    }

    // MARK: Étape 1 : catégories

    private var categoriesVue: some View {
        List {
            Section {
                ForEach($categories) { $c in
                    HStack {
                        TextField("Nom", text: $c.nom)
                        Button { categories.removeAll { $0.id == c.id } } label: {
                            Image(systemName: "minus.circle.fill").foregroundStyle(Palette.danger).frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Retirer \(c.nom)")
                    }
                }
                HStack {
                    TextField("Ajouter une catégorie", text: $nouvelle).submitLabel(.done).onSubmit { ajouter() }
                    Button("Ajouter") { ajouter() }.disabled(nouvelle.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .frame(minHeight: 44)
            } header: {
                Text("Étape 1 sur 2")
            } footer: {
                Text("Ce sont des exemples : garde, renomme, supprime ou ajoute ce qui te parle. Une catégorie dit le domaine d'un rappel (Santé, Voiture…), pas s'il est daté.")
            }
        }
        .listeAtelier()
        .safeAreaInset(edge: .bottom) {
            barreBas {
                BoutonA(titre: envoi ? "…" : "Valider ces \(categories.filter { !$0.nom.trimmingCharacters(in: .whitespaces).isEmpty }.count) catégories") {
                    guard !envoi else { return }
                    Task { await validerCategories() }
                }
            }
        }
    }

    private func ajouter() {
        let n = nouvelle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return }
        categories.append(Categorie(etiquette: nil, nom: n))
        nouvelle = ""
    }

    private func validerCategories() async {
        envoi = true
        defer { envoi = false }
        let gardees = categories.filter { !$0.nom.trimmingCharacters(in: .whitespaces).isEmpty }
        let ids = Set(gardees.compactMap(\.etiquette))
        for e in app.organisation.etiquettes where !ids.contains(e.id) { await app.organisation.supprimerEtiquette(e) }
        for c in gardees {
            if let id = c.etiquette, let e = app.organisation.etiquettes.first(where: { $0.id == id }) {
                if e.nom != c.nom { await app.organisation.renommerEtiquette(e, en: c.nom) }
            } else {
                await app.organisation.ajouterEtiquette(c.nom)
            }
        }
        withAnimation(.snappy) { etape = 2 }
        commencerTri()
    }

    // MARK: Étape 2 : le tri

    private func rappel(_ id: String) -> Rappel? { app.carnet.rappels.first { $0.id == id } }

    private var rappelsVue: some View {
        List {
            Section {
                if analyse {
                    HStack(spacing: 10) {
                        ProgressView().controlSize(.small)
                        Text("Rémy propose un classement, sur tes machines…").font(Police.texte(14)).foregroundStyle(Palette.encre2)
                    }
                    .frame(minHeight: 36)
                } else if let erreur {
                    Text(erreur).font(Police.texte(14)).foregroundStyle(Palette.encre2)
                    Button("Réessayer") { Task { await analyser() } }.frame(minHeight: 44)
                }
                if aTrier.isEmpty {
                    Text("Rien à traiter : chaque rappel a une date et une catégorie.").foregroundStyle(Palette.encre2)
                }
            } header: {
                if premiereFois { Text("Étape 2 sur 2") }
            } footer: {
                if !aTrier.isEmpty {
                    Text("Un rappel est rangé quand il a une date et une catégorie. Garder (rappel ou to-do), en faire une tâche Motion, ou ne rien changer : rien ne part avant « Valider ».")
                }
            }
            ForEach(aTrier, id: \.self) { id in
                if let r = rappel(id) { ligne(r) }
            }
        }
        .listeAtelier()
        .safeAreaInset(edge: .bottom) {
            barreBas {
                if aTrier.isEmpty {
                    BoutonA(titre: "Fermer", principal: false) { fermer() }
                } else {
                    BoutonA(titre: envoi ? "…" : "Valider (\(aTrier.count))", symbole: "checkmark") {
                        guard !envoi else { return }
                        if aTrier.contains(where: { choix[$0]?.action == "tache" }) { confirmer = true } else { Task { await appliquer() } }
                    }
                }
            }
        }
    }

    /// Le bouton du bas, toujours visible et touchable au-dessus de la liste.
    private func barreBas<C: View>(@ViewBuilder _ contenu: () -> C) -> some View {
        contenu()
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 6)
            .frame(maxWidth: .infinity)
            .background(Palette.fond.opacity(0.97))
            .overlay(alignment: .top) { Rectangle().fill(Palette.filet).frame(height: 1) }
    }

    private func modifier(_ id: String, _ f: (inout Choix) -> Void) {
        var c = choix[id] ?? Choix()
        f(&c)
        // Toucher une date ou une catégorie, c'est vouloir ranger : « Rien » devient « Garder ».
        if c.action == "rien" { c.action = "garder" }
        choix[id] = c
        touchees.insert(id)
    }

    private func ligne(_ r: Rappel) -> some View {
        let c = choix[r.id] ?? Choix()
        return VStack(alignment: .leading, spacing: 10) {
            Text(r.texte).font(Police.texte(16, .medium)).foregroundStyle(Palette.encre)
            // La date et l'heure, réglables ici (Sam, 18/10).
            if let q = c.quand {
                HStack(spacing: 8) {
                    DatePicker("Quand", selection: Binding(get: { q }, set: { d in modifier(r.id) { $0.quand = d } }),
                               displayedComponents: [.date, .hourAndMinute])
                        .labelsHidden()
                        .environment(\.locale, Format.locale)
                        .environment(\.timeZone, Format.fuseau)
                    Spacer(minLength: 0)
                    Button {
                        modifier(r.id) { $0.quand = nil }
                    } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundStyle(Palette.encre3)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Retirer la date")
                }
            } else {
                Button {
                    Haptique.leger()
                    modifier(r.id) { $0.quand = Self.parDefaut() }
                } label: {
                    Label("Ajouter une date et une heure", systemImage: "calendar.badge.plus")
                        .font(Police.texte(14, .semibold))
                        .foregroundStyle(Palette.signal)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
            }
            Flux {
                ForEach(app.organisation.etiquettes) { e in
                    let actif = c.etiquettes.contains(e.id)
                    Button {
                        Haptique.leger()
                        modifier(r.id) { if actif { $0.etiquettes.remove(e.id) } else { $0.etiquettes.insert(e.id) } }
                    } label: {
                        Text(e.nom)
                            .font(Police.texte(13, .semibold))
                            .foregroundStyle(actif ? Palette.fond : Palette.encre)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 40)
                            .background(actif ? Palette.encre2 : Palette.fond2, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(actif ? .isSelected : [])
                }
            }
            Picker("Que faire", selection: Binding(get: { c.action }, set: { a in
                var n = choix[r.id] ?? Choix()
                n.action = a
                choix[r.id] = n
                touchees.insert(r.id)
            })) {
                Text("Garder").tag("garder")
                Text("Tâche Motion").tag("tache")
                Text("Rien").tag("rien")
            }
            .pickerStyle(.segmented)
        }
        .padding(.vertical, 6)
    }

    /// Une date à régler : demain 9 h (heure de Paris).
    private static func parDefaut() -> Date {
        let demain = Format.calendrier.date(byAdding: .day, value: 1, to: Format.debutDuJour(Date())) ?? Date()
        return Format.calendrier.date(byAdding: .hour, value: 9, to: demain) ?? demain
    }

    /// Les rappels à traiter, avec un point de départ sans IA (leurs étiquettes,
    /// l'étiquette devinée par les mots), puis la proposition de GLM.
    private func commencerTri() {
        let rappels = app.rappelsATraiter
        aTrier = rappels.map(\.id)
        for r in rappels where choix[r.id] == nil {
            let devinee = EtiquetteDevinee.pour(r.texte, parmi: app.organisation.etiquettes).map { [$0.id] } ?? []
            choix[r.id] = Choix(action: "garder", etiquettes: Set((r.etiquettes ?? []) + devinee), quand: r.quand?.date)
        }
        Task { await analyser() }
    }

    private func analyser() async {
        guard !aTrier.isEmpty else { return }
        guard app.serveur?.sait("analyse-rappels-v1") == true else {
            erreur = "Rémy pourra proposer un classement après la mise à jour de ta tour ; d'ici là, choisis toi-même."
            return
        }
        analyse = true
        erreur = nil
        defer { analyse = false }
        do {
            for p in try await app.api.analyserRappels() where aTrier.contains(p.id) && !touchees.contains(p.id) {
                var c = choix[p.id] ?? Choix()
                c.action = p.action
                c.etiquettes.formUnion(p.etiquettes ?? [])
                choix[p.id] = c
            }
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app.signaler(e); return }
            erreur = ((error as? LocalizedError)?.errorDescription ?? "Rémy n'a pas pu lire tes rappels.") + " Choisis toi-même ci-dessous."
        }
    }

    private func appliquer() async {
        envoi = true
        defer { envoi = false }
        let existantes = app.organisation.etiquettes.map(\.id)
        var ranges = 0
        var aConvertir: [Rappel] = []
        for id in aTrier {
            guard let r = rappel(id), let c = choix[id], c.action != "rien" else { continue }
            if c.action == "tache" {
                var t = r
                t.quand = c.quand?.millis // l'échéance réglée ici
                aConvertir.append(t)
                continue
            }
            let ids = existantes.filter { c.etiquettes.contains($0) }
            if ids != (r.etiquettes ?? []) || c.quand?.millis != r.quand {
                app.carnet.ranger(r, quand: c.quand, etiquettes: ids)
                ranges += 1
            }
        }
        var phrase = "\(ranges) rappel\(ranges > 1 ? "s" : "") rangé\(ranges > 1 ? "s" : "")"
        if !aConvertir.isEmpty {
            let b = await app.convertirEnTaches(aConvertir)
            phrase += ", \(b.faits.count) devenu\(b.faits.count > 1 ? "s" : "") tâche\(b.faits.count > 1 ? "s" : "") Motion"
            if !b.echecs.isEmpty { phrase += " (pas fait : " + b.echecs.joined(separator: " ; ") + ")" }
        }
        let restent = app.rappelsATraiter.count
        if restent > 0 { phrase += " ; encore \(restent) à traiter" }
        etat = "fait"
        app.dire(phrase + ".")
        fermer()
    }
}

/// « Rappels à traiter » et sa pastille rouge (Sam, 18/10) : sur l'accueil et
/// dans Projets → Rappels. Ouvre le tri (les catégories d'abord, la première fois).
struct LigneTriRappels: View {
    @Environment(AppModel.self) private var app
    let nombre: Int
    @State private var ouvert = false

    var body: some View {
        Button {
            Haptique.leger()
            ouvert = true
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "tray.full")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.encre2)
                    .frame(width: 32, height: 32)
                    .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Rappels à traiter").font(Police.texte(16, .semibold)).foregroundStyle(Palette.encre)
                    Text("Une date et une catégorie pour chacun").font(Police.texte(13)).foregroundStyle(Palette.encre2)
                }
                Spacer(minLength: 0)
                PastilleRouge(nombre: nombre)
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.encre3)
            }
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Rappels à traiter, \(nombre)")
        .sheet(isPresented: $ouvert) { OnboardingRappels(etapeInitiale: app.organisation.etiquettes.isEmpty ? 1 : 2) }
    }
}

/// Une pastille de notification rouge, comme celles de l'iPhone.
struct PastilleRouge: View {
    let nombre: Int

    var body: some View {
        Text("\(nombre)")
            .font(Police.mono(12, .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .frame(minWidth: 22, minHeight: 22)
            .background(Color.red, in: Capsule())
            .accessibilityHidden(true)
    }
}
