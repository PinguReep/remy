import SwiftUI
import RemyCore

// MARK: - Réglages

/// Tout ce qui ne sert pas tous les jours, rangé derrière « Réglages ».
struct ReglagesView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @Environment(\.openURL) private var ouvrirURL
    @AppStorage("confirmerLiens") private var confirmerLiens = true
    @AppStorage("theme") private var theme = "auto"
    @State private var memoire = false
    @State private var appareilsOuverts = false
    @State private var deconnexion = false
    /// Réglages gardés sur la tour (secours Claude). nil : pas encore lus, ou
    /// tour trop ancienne pour les connaître — la ligne ne s'affiche pas.
    @State private var reglages: Reglages?
    @State private var changementSecours = false

    var body: some View {
        let d = app.tableau.donnees
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ligne("Ce que Rémy sait de toi", symbole: "person.text.rectangle") { memoire = true }
                    ligne("Ouvrir le site", sous: "Le site te redemandera le mot de passe.", symbole: "safari") {
                        ouvrirURL(app.api.base)
                    }
                    if let c = d?.couts {
                        info("Coût des 30 derniers jours", valeur: Format.usd(c.jours30), symbole: "creditcard")
                    }
                    if let n = joursActifs(d?.activite) {
                        info(n == 0 ? "Tu n'as pas parlé à Rémy ces 14 derniers jours."
                                    : "Tu as parlé à Rémy \(n) jour\(n > 1 ? "s" : "") sur les 14 derniers.",
                             symbole: "calendar")
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 14) {
                            Image(systemName: "circle.lefthalf.filled").font(.system(size: 18)).frame(width: 26)
                            Text("Apparence").font(Police.texte(16, .medium))
                        }
                        Picker("Apparence", selection: $theme) {
                            Text("Comme l'iPhone").tag("auto")
                            Text("Clair").tag("clair")
                            Text("Sombre").tag("sombre")
                        }
                        .pickerStyle(.segmented)
                    }
                    .foregroundStyle(Palette.encre)
                    .padding(.vertical, 12)
                    .overlay(alignment: .bottom) { Filet() }
                    Toggle(isOn: $confirmerLiens) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Prévenir avant d'ouvrir un lien").font(Police.texte(16, .medium))
                            Text("Lire une page web coûte un peu plus qu'un message.")
                                .font(Police.texte(13))
                                .foregroundStyle(Palette.encre2)
                        }
                    }
                    .tint(Palette.signal)
                    .foregroundStyle(Palette.encre)
                    .padding(.vertical, 10)
                    .frame(minHeight: 60)
                    .overlay(alignment: .bottom) { Filet() }
                    if let r = reglages, r.rechercheWeb != nil {
                        rechercheWeb(r)
                        if r.rechercheWeb == true { contexteCloud(r) }
                    }
                    if let r = reglages, r.secoursCloudSansObjet != true {
                        secours(r)
                    }
                    if let r = reglages, let nuit = r.circuits?["nuit"] {
                        circuitNuit(nuit)
                    }
                    if d?.systeme?.reflexion == false {
                        info("Préparation de nuit désactivée : « Rémy a remarqué » restera vide.", symbole: "moon.zzz")
                    }
                    if app.serveur?.sait("appareils") == true {
                        ligne("Appareils connectés", sous: "Déconnecte un iPhone perdu ou prêté.", symbole: "iphone") {
                            appareilsOuverts = true
                        }
                    }
                    ligne("Se déconnecter", symbole: "rectangle.portrait.and.arrow.right", couleur: Palette.danger, fleche: false) {
                        deconnexion = true
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Rémy \(version)")
                        if let s = app.serveur {
                            Text("Serveur \(s.libelle)")
                        }
                    }
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre3)
                    .padding(.top, 24)
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 24)
            }
            .background(Palette.fond)
            .navigationTitle("Réglages")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fermer") { fermer() }.font(Police.texte(16, .semibold))
                }
            }
        }
        .tint(Palette.encre)
        .overlay(alignment: .bottom) { ToastView(marge: 24, annoncer: false) }
        .sheet(isPresented: $memoire) { MemoireView() }
        .sheet(isPresented: $appareilsOuverts) { AppareilsView() }
        .task {
            guard app.serveur?.sait("reglages") ?? false else { return }
            reglages = try? await app.api.reglages()
        }
        .confirmationDialog("Se déconnecter de Rémy ?", isPresented: $deconnexion, titleVisibility: .visible) {
            Button("Se déconnecter", role: .destructive) { Task { await app.deconnecter() } }
            Button("Annuler", role: .cancel) {}
        } message: {
            Text("Il faudra retaper le mot de passe pour revenir.")
        }
    }

    /// Secours Claude (D21) : coupé par défaut. L'activer, c'est accepter que
    /// la conversation et la mémoire partent chez Anthropic quand la tour
    /// (GLM) ne répond pas — jamais pour une conversation privée.
    private func secours(_ r: Reglages) -> some View {
        let force = r.secoursCloudForceParLaTour == true
        return Toggle(isOn: Binding(
            get: { r.secoursCloud },
            set: { nouveau in changerSecours(nouveau) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Secours Claude si la tour ne répond pas").font(Police.texte(16, .medium))
                Text(force
                     ? "Activé sur la tour (REMY_SECOURS_CLOUD) : à couper là-bas."
                     : "Tes messages et ta mémoire partent alors chez Anthropic. Jamais pour une conversation privée.")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Palette.signal)
        .disabled(force || changementSecours)
        .foregroundStyle(Palette.encre)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Filet() }
    }

    /// Recherche web (V8) : elle passe par Claude (Anthropic). Permise, Rémy
    /// demande quand même l'accord à chaque recherche ; coupée, il répond sans.
    private func rechercheWeb(_ r: Reglages) -> some View {
        let force = r.rechercheWebCoupeeParLaTour == true
        return Toggle(isOn: Binding(
            get: { r.rechercheWeb == true },
            set: { nouveau in changerCloud(web: nouveau) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Recherche web").font(Police.texte(16, .medium))
                Text(force
                     ? "Coupée sur la tour (REMY_WEB_SEARCH=off) : à rallumer là-bas."
                     : r.rechercheWeb == true
                        ? "Passe par Claude (Anthropic). Rémy te demande ton accord à chaque recherche."
                        : "Coupée : Rémy répond sans le web, rien ne part chez Anthropic.")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Palette.signal)
        .disabled(force || changementSecours)
        .foregroundStyle(Palette.encre)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Filet() }
    }

    /// Envoi de contexte au cloud (V8) : coupé, une recherche autorisée
    /// n'emporte que la question ; allumé, la conversation et la mémoire
    /// partent avec. Jamais pour une conversation privée.
    private func contexteCloud(_ r: Reglages) -> some View {
        Toggle(isOn: Binding(
            get: { r.contexteCloud == true },
            set: { nouveau in changerCloud(contexte: nouveau) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Envoi de contexte au cloud").font(Police.texte(16, .medium))
                Text(r.contexteCloud == true
                     ? "Une recherche autorisée emporte la conversation et ta mémoire. Jamais pour une conversation privée."
                     : "Une recherche autorisée n'emporte que ta question.")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Palette.signal)
        .disabled(changementSecours)
        .foregroundStyle(Palette.encre)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Filet() }
    }

    private func changerCloud(web: Bool? = nil, contexte: Bool? = nil) {
        guard !changementSecours else { return }
        changementSecours = true
        Task {
            defer { changementSecours = false }
            do {
                if let web {
                    reglages = try await app.api.changerRechercheWeb(web)
                    app.dire(web ? "Recherche web permise : Rémy te demandera avant chaque recherche."
                                 : "Recherche web coupée : Rémy répond sans le web.")
                } else if let contexte {
                    reglages = try await app.api.changerContexteCloud(contexte)
                    app.dire(contexte ? "Une recherche autorisée emportera la conversation et ta mémoire."
                                      : "Une recherche autorisée n'emportera que ta question.")
                }
                Haptique.succes()
            } catch {
                app.signaler(error)
            }
        }
    }

    /// Réflexion de la nuit (J0.9) : Rémy relit et prépare le briefing pendant
    /// que Sam dort. Coupable d'un geste ; la tour peut la forcer.
    private func circuitNuit(_ c: Circuit) -> some View {
        let force = c.forceParLaTour == true
        return Toggle(isOn: Binding(
            get: { c.actif },
            set: { nouveau in changerCircuit("nuit", nouveau) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Réflexion de la nuit").font(Police.texte(16, .medium))
                Text(force
                     ? "Réglée sur la tour (REMY_CIRCUIT_NUIT) : à changer là-bas."
                     : "Rémy relit tes échanges et prépare le briefing du matin.")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Palette.signal)
        .disabled(force || changementSecours)
        .foregroundStyle(Palette.encre)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Filet() }
    }

    private func changerCircuit(_ id: String, _ actif: Bool) {
        guard !changementSecours else { return }
        changementSecours = true
        Task {
            defer { changementSecours = false }
            do {
                reglages = try await app.api.changerCircuit(id, actif: actif)
                app.dire(actif ? "Réflexion de la nuit allumée." : "Réflexion de la nuit coupée : Rémy ne travaillera plus la nuit.")
                Haptique.succes()
            } catch {
                app.signaler(error)
            }
        }
    }

    private func changerSecours(_ actif: Bool) {
        guard !changementSecours else { return }
        changementSecours = true
        Task {
            defer { changementSecours = false }
            do {
                reglages = try await app.api.changerSecoursCloud(actif)
                app.dire(actif ? "Secours Claude activé." : "Secours Claude coupé : rien ne part chez Anthropic quand la tour ne répond pas.")
                Haptique.succes()
            } catch {
                app.signaler(error)
            }
        }
    }

    /// Jours avec au moins un échange, sur les 14 derniers.
    private func joursActifs(_ a: Activite?) -> Int? {
        guard let a, !a.jours.isEmpty else { return nil }
        return a.jours.suffix(14).filter { $0.messages > 0 || $0.actif == true }.count
    }

    private var version: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "\(v) (\(b))"
    }

    private func ligne(_ titre: String, sous: String? = nil, symbole: String, couleur: Color = Palette.encre,
                       fleche: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: symbole).font(.system(size: 18)).frame(width: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text(titre).font(Police.texte(16, .medium))
                    if let sous {
                        Text(sous).font(Police.texte(13)).foregroundStyle(Palette.encre2)
                    }
                }
                Spacer()
                if fleche { Text("›").font(Police.texte(20)).foregroundStyle(Palette.encre3) }
            }
            .foregroundStyle(couleur)
            .padding(.vertical, 10)
            .frame(minHeight: 60)
            .overlay(alignment: .bottom) { Filet() }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func info(_ titre: String, valeur: String? = nil, symbole: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbole).font(.system(size: 18)).frame(width: 26)
            Text(titre).font(Police.texte(16)).fixedSize(horizontal: false, vertical: true)
            Spacer()
            if let valeur { Text(valeur).font(Police.mono(15, .medium)) }
        }
        .foregroundStyle(Palette.encre)
        .padding(.vertical, 10)
        .frame(minHeight: 60)
        .overlay(alignment: .bottom) { Filet() }
    }
}

// MARK: - Appareils connectés

/// Les appareils qui ont un jeton sur la tour (J0.8b) : nommés, avec leur
/// dernière visite ; un geste en déconnecte un.
struct AppareilsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var aDeconnecter: Appareil?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // Rafraîchissement raté : l'ancienne liste reste, mais c'est dit.
                    if app.appareils != nil, let e = app.erreurAppareils {
                        Vide(texte: e, titreAction: "Réessayer") { Task { await app.chargerAppareils() } }
                            .padding(.bottom, 8)
                    }
                    if let liste = app.appareils {
                        if liste.isEmpty {
                            Text("Aucun appareil n'a encore de jeton. Le site, lui, garde son cookie.")
                                .font(Police.texte(15))
                                .foregroundStyle(Palette.encre2)
                                .padding(.vertical, 16)
                        }
                        ForEach(liste) { a in
                            HStack(spacing: 14) {
                                Image(systemName: "iphone").font(.system(size: 18)).frame(width: 26)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(a.nom + (a.actuel == true ? " · celui-ci" : "")).font(Police.texte(16, .medium))
                                    if let vu = a.vuLe {
                                        Text("Vu \(vu.formatted(.relative(presentation: .named)))")
                                            .font(Police.texte(13))
                                            .foregroundStyle(Palette.encre2)
                                    }
                                }
                                Spacer(minLength: 8)
                                Button("Déconnecter") { aDeconnecter = a }
                                    .buttonStyle(BoutonBrut())
                            }
                            .foregroundStyle(Palette.encre)
                            .padding(.vertical, 10)
                            .frame(minHeight: 60)
                            .overlay(alignment: .bottom) { Filet() }
                        }
                    } else if let e = app.erreurAppareils {
                        Vide(texte: e, titreAction: "Réessayer") { Task { await app.chargerAppareils() } }
                    } else {
                        Squelette(largeurs: [0.7, 0.5, 0.6])
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
            }
            .background(Palette.fond)
            .navigationTitle("Appareils connectés")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fermer") { fermer() }.font(Police.texte(16, .semibold))
                }
            }
        }
        .tint(Palette.encre)
        .overlay(alignment: .bottom) { ToastView(marge: 24, annoncer: false) }
        .task { await app.chargerAppareils() }
        .confirmationDialog(aDeconnecter.map { "Déconnecter « \($0.nom) » ?" } ?? "",
                            isPresented: Binding(get: { aDeconnecter != nil }, set: { if !$0 { aDeconnecter = nil } }),
                            titleVisibility: .visible) {
            Button("Déconnecter", role: .destructive) {
                if let a = aDeconnecter { Task { await app.deconnecterAppareil(a) } }
            }
            Button("Annuler", role: .cancel) {}
        } message: {
            Text("Il faudra retaper le mot de passe sur cet appareil.")
        }
    }
}

// MARK: - Mémoire

/// Ce que Rémy sait de Sam : lu tel quel, corrigé à la demande.
struct MemoireView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var charge = false
    @State private var texteServeur = ""
    @State private var texte = ""
    @State private var edition = false
    @State private var erreur: String?
    @State private var enregistrement = false
    @State private var conflit = false

    private var modifie: Bool { edition && texte != texteServeur }

    var body: some View {
        NavigationStack {
            Group {
                if !charge {
                    if let erreur {
                        Vide(texte: erreur, titreAction: "Réessayer") { Task { await charger() } }
                            .padding(18)
                            .frame(maxHeight: .infinity, alignment: .top)
                    } else {
                        Squelette(largeurs: [0.5, 0.9, 0.8, 0.95, 0.6])
                            .padding(18)
                            .frame(maxHeight: .infinity, alignment: .top)
                    }
                } else if edition {
                    TextEditor(text: $texte)
                        .font(Police.texte(15))
                        .scrollContentBackground(.hidden)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("Rémy met ce texte à jour après vos échanges. Si quelque chose est faux, corrige-le : tu as le dernier mot.")
                                .font(Police.texte(14))
                                .foregroundStyle(Palette.encre2)
                                .fixedSize(horizontal: false, vertical: true)
                            if texteServeur.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                Text("Rémy ne sait encore rien de toi. Parle-lui, ou commence « Faire connaissance ».")
                                    .font(Police.texte(16))
                                    .foregroundStyle(Palette.encre)
                            } else {
                                Filet()
                                TexteRemy(texte: texteServeur)
                            }
                        }
                        .padding(18)
                    }
                }
            }
            .background(Palette.fond)
            .navigationTitle("Ce que Rémy sait de toi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if edition {
                        Button("Annuler") {
                            texte = texteServeur
                            edition = false
                        }
                    } else {
                        Button("Fermer") { fermer() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if edition {
                        Button(enregistrement ? "…" : "Enregistrer") { enregistrer(malgreConflit: false) }
                            .font(Police.texte(16, .semibold))
                            .disabled(!modifie || enregistrement)
                    } else if charge {
                        Button("Corriger") {
                            texte = texteServeur
                            edition = true
                        }
                        .font(Police.texte(16, .semibold))
                    }
                }
            }
        }
        .tint(Palette.encre)
        .interactiveDismissDisabled(modifie)
        .overlay(alignment: .bottom) { ToastView(marge: 24, annoncer: false) }
        .task { await charger() }
        .alert("Rémy a modifié ce texte pendant que tu le corrigeais", isPresented: $conflit) {
            Button("Garder ma version", role: .destructive) { enregistrer(malgreConflit: true) }
            Button("Voir la sienne", role: .cancel) {
                edition = false
                Task { await charger() }
            }
        } message: {
            Text("Si tu gardes ta version, ce que Rémy vient d'ajouter sera perdu.")
        }
    }

    private func charger() async {
        erreur = nil
        do {
            let m = try await app.api.memoire()
            texteServeur = m.text
            if !edition { texte = m.text }
            charge = true
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { app.signaler(e); return }
            erreur = (error as? LocalizedError)?.errorDescription ?? "Impossible de lire la mémoire de Rémy."
        }
    }

    private func enregistrer(malgreConflit: Bool) {
        guard !enregistrement else { return }
        enregistrement = true
        Task {
            defer { enregistrement = false }
            do {
                if !malgreConflit {
                    // Rémy réécrit ce texte après les échanges : ne pas écraser
                    // en silence ce qu'il vient d'ajouter.
                    let actuelle = try await app.api.memoire()
                    if actuelle.text != texteServeur {
                        conflit = true
                        return
                    }
                }
                try await app.api.enregistrerMemoire(texte)
                texteServeur = texte
                edition = false
                app.dire("Enregistré : Rémy s'en servira dès maintenant.")
                Haptique.succes()
            } catch {
                app.signaler(error)
            }
        }
    }
}
