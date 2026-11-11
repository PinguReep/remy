import CoreLocation
import SwiftUI
import RemyCore

/// Les heures proposées pour les alertes d'un rappel : les dernières choisies.
enum PreferencesAlertes {
    static let cleVeille = "rappels.alerte.veille"
    static let cleMatin = "rappels.alerte.matin"
    static let cleAvant = "rappels.alerte.avant"
    static var veille: Int { (UserDefaults.standard.object(forKey: cleVeille) as? Int) ?? 20 * 60 }
    static var matin: Int { (UserDefaults.standard.object(forKey: cleMatin) as? Int) ?? 8 * 60 }
    static var avant: Int { (UserDefaults.standard.object(forKey: cleAvant) as? Int) ?? 120 }
    /// « Avant » : 15 min à 12 h.
    static let choixAvant = [15, 30, 60, 120, 180, 360, 720]
}

/// La fiche d'un rappel (Sam, 11/11) : créer ou modifier au même endroit — le
/// texte, une note, la date, les alertes avant (la veille, le matin, N heures
/// avant) et le lieu qui le déclenche (en arrivant, en partant).
struct FicheRappel: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    /// nil : un nouveau rappel.
    var rappel: Rappel?

    @State private var texte = ""
    @State private var note = ""
    @State private var avecDate = true
    @State private var date = Date().addingTimeInterval(3600)
    @State private var dateTouchee = false
    @State private var veille = false
    @State private var heureVeille = PreferencesAlertes.veille
    @State private var matin = false
    @State private var heureMatin = PreferencesAlertes.matin
    @State private var avant = false
    @State private var minutesAvant = PreferencesAlertes.avant
    /// 0 : pas de lieu ; 1 : en arrivant ; 2 : en partant.
    @State private var sensLieu = 0
    @State private var lieuId: String?
    /// Le lieu déjà posé sur le rappel (gardé même si la tour ne le liste plus).
    @State private var lieuGarde: LieuRappel?
    @State private var charge = false
    @State private var nommerOuvert = false
    @State private var nomIci = ""
    @State private var position = false
    @FocusState private var focus: Bool

    private static let idGarde = "_garde"

    /// La tour sait garder la note, les alertes et le lieu.
    private var declencheurs: Bool { app.serveur?.sait("rappels-declencheurs-v1") == true }

    private var lieuxNommes: [LieuTour] {
        (app.lieux.vue?.lieux ?? []).filter { !($0.nom ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private struct ChoixLieu: Identifiable {
        let id: String
        let nom: String
    }

    private var choixLieux: [ChoixLieu] {
        var c = lieuxNommes.map { ChoixLieu(id: $0.id, nom: $0.nom ?? $0.affiche) }
        let garde = lieuGarde.map { ChoixLieu(id: $0.id ?? Self.idGarde, nom: $0.nom) }
        if let garde, !c.contains(where: { $0.id == garde.id }) { c.insert(garde, at: 0) }
        return c
    }

    private var alertesChoisies: [AlerteRappel] {
        guard declencheurs, avecDate else { return [] }
        return (veille ? [.veille(heureVeille)] : []) + (matin ? [.matin(heureMatin)] : []) + (avant ? [.avant(minutesAvant)] : [])
    }

    private var lieuChoisi: LieuRappel? {
        guard declencheurs, sensLieu != 0, let id = lieuId else { return nil }
        if let l = lieuxNommes.first(where: { $0.id == id }) { return LieuRappel(l, arrivee: sensLieu == 1) }
        guard var g = lieuGarde, (g.id ?? Self.idGarde) == id else { return nil }
        g.sens = sensLieu == 1 ? "arrivee" : "depart"
        return g
    }

    /// Ce qui sonnera, dit avant d'enregistrer (jamais une alerte muette).
    private var resumeSonneries: String {
        guard avecDate else { return "" }
        let brouillon = Rappel(id: rappel?.id ?? "brouillon", texte: texte, quand: date.millis, alertes: alertesChoisies)
        let s = brouillon.sonneries(apres: Date())
        if s.isEmpty { return "Cette date est passée : rien ne sonnera." }
        var phrase = "Sonnera : " + s.map { Format.quandRelatif($0.date.millis) }.joined(separator: " · ") + "."
        if s.filter({ !$0.suffixe.isEmpty }).count < alertesChoisies.count {
            phrase += " Une alerte est déjà passée, ou tombe après l'heure du rappel : elle ne sonnera pas."
        }
        return phrase
    }

    private var incomplet: Bool {
        texte.trimmingCharacters(in: .whitespaces).isEmpty || (declencheurs && sensLieu != 0 && lieuChoisi == nil)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Appeler le garage demain à 9h", text: $texte, axis: .vertical)
                        .focused($focus)
                        .onChange(of: texte) {
                            guard rappel == nil, !dateTouchee, let r = AnalyseDate.extraire(texte) else { return }
                            avecDate = true
                            date = r.quand
                        }
                    if declencheurs {
                        TextField("Note", text: $note, axis: .vertical)
                            .lineLimit(1...5)
                            .font(Police.texte(15))
                    }
                }
                Section {
                    Toggle("À une date", isOn: $avecDate)
                    if avecDate {
                        DatePicker("Quand", selection: Binding(get: { date }, set: { date = $0; dateTouchee = true }))
                            .environment(\.locale, Format.locale)
                            .environment(\.timeZone, Format.fuseau)
                    }
                }
                if declencheurs, avecDate { sectionAlertes }
                if declencheurs { sectionLieu }
                if let r = rappel {
                    Section {
                        Button(r.fait ? "Pas encore fait" : "Fait") {
                            Haptique.leger()
                            app.carnet.basculer(r)
                            fermer()
                        }
                        Button("Retirer ce rappel", role: .destructive) {
                            Haptique.leger()
                            app.carnet.supprimer(r)
                            fermer()
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.fond)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(rappel == nil ? "Nouveau rappel" : "Rappel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { fermer() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(rappel == nil ? "Ajouter" : "Enregistrer") { enregistrer() }
                        .disabled(incomplet)
                }
            }
            // La fiche a sa copie du message : sinon il passerait dessous.
            .overlay(alignment: .bottom) { ToastView(marge: 12, annoncer: false) }
            .alert("Nommer ce lieu", isPresented: $nommerOuvert) {
                TextField("Maison, salle de sport…", text: $nomIci)
                Button("Nommer") { Task { await nommerIci() } }
                    .disabled(nomIci.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Annuler", role: .cancel) {}
            } message: {
                Text("L'endroit où tu es maintenant. Il servira aussi aux prochains rappels.")
            }
        }
        .presentationDetents(declencheurs ? [.large] : [.medium, .large])
        .presentationDragIndicator(.visible)
        .onAppear { charger() }
        .task { if declencheurs, app.lieux.disponible, app.lieux.vue == nil { await app.lieux.charger() } }
    }

    // MARK: Les alertes avant l'échéance

    private var sectionAlertes: some View {
        Section {
            Toggle("La veille", isOn: $veille)
            if veille {
                DatePicker("à", selection: heure($heureVeille), displayedComponents: .hourAndMinute)
                    .environment(\.locale, Format.locale)
                    .environment(\.timeZone, Format.fuseau)
            }
            Toggle("Le matin même", isOn: $matin)
            if matin {
                DatePicker("à", selection: heure($heureMatin), displayedComponents: .hourAndMinute)
                    .environment(\.locale, Format.locale)
                    .environment(\.timeZone, Format.fuseau)
            }
            Toggle("Un peu avant", isOn: $avant)
            if avant {
                Picker("Combien de temps avant", selection: $minutesAvant) {
                    ForEach(choixAvant, id: \.self) { m in Text(Format.duree(minutes: m)).tag(m) }
                }
            }
        } header: {
            Text("Me prévenir aussi")
        } footer: {
            Text(resumeSonneries)
        }
    }

    private var choixAvant: [Int] {
        PreferencesAlertes.choixAvant.contains(minutesAvant) ? PreferencesAlertes.choixAvant : (PreferencesAlertes.choixAvant + [minutesAvant]).sorted()
    }

    /// Une minute du jour (1200 = 20:00) éditée comme une heure.
    private func heure(_ minutes: Binding<Int>) -> Binding<Date> {
        Binding(
            get: { Format.calendrier.date(bySettingHour: minutes.wrappedValue / 60 % 24, minute: minutes.wrappedValue % 60, second: 0, of: Date()) ?? Date() },
            set: {
                let c = Format.calendrier.dateComponents([.hour, .minute], from: $0)
                minutes.wrappedValue = (c.hour ?? 0) * 60 + (c.minute ?? 0)
            }
        )
    }

    // MARK: Le lieu

    private var sectionLieu: some View {
        Section {
            Picker("Dans un lieu", selection: $sensLieu) {
                Text("Non").tag(0)
                Text("En arrivant").tag(1)
                Text("En partant").tag(2)
            }
            .pickerStyle(.segmented)
            .onChange(of: sensLieu) {
                // Un rappel « en arrivant » n'a pas besoin de l'heure proposée d'office.
                if rappel == nil, sensLieu != 0, !dateTouchee, AnalyseDate.extraire(texte) == nil { avecDate = false }
                if sensLieu != 0, lieuId == nil { lieuId = choixLieux.first?.id }
            }
            if sensLieu != 0 {
                if choixLieux.isEmpty {
                    Text(app.lieux.chargement ? "Je lis tes lieux…" : "Aucun lieu nommé pour l'instant.")
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.encre2)
                } else {
                    Picker("Lieu", selection: $lieuId) {
                        ForEach(choixLieux) { c in Text(c.nom).tag(Optional(c.id)) }
                    }
                }
                if app.lieux.disponible {
                    Button(position ? "Je cherche ta position…" : "Nommer l'endroit où je suis") {
                        nomIci = ""
                        nommerOuvert = true
                    }
                    .disabled(position)
                }
            }
        } header: {
            Text("Dans un lieu")
        } footer: {
            if sensLieu != 0 {
                Text("iOS surveille le lieu lui-même, même app fermée, et te le redit à chaque passage jusqu'à « Fait ». Ta position ne va que sur ta tour.")
            }
        }
    }

    private func nommerIci() async {
        let nom = nomIci.trimmingCharacters(in: .whitespaces)
        guard !nom.isEmpty else { return }
        position = true
        defer { position = false }
        guard await CapteurLocalisation.partage.demanderPourRappel(),
              let l = await CapteurLocalisation.partage.positionIci() else {
            app.dire("Position introuvable : vérifie que la localisation est autorisée pour Rémy.")
            return
        }
        if await app.lieux.nommerIci(nom, lat: l.coordinate.latitude, lon: l.coordinate.longitude) {
            lieuId = lieuxNommes.first { $0.nom == nom }?.id ?? lieuId
        }
    }

    // MARK: Lire et enregistrer

    private func charger() {
        guard !charge else { return }
        charge = true
        guard let r = rappel else {
            focus = true
            return
        }
        texte = r.texte
        note = r.note ?? ""
        avecDate = r.quand != nil
        if let q = r.quand {
            date = q.date
            dateTouchee = true
        }
        for a in r.alertes ?? [] {
            switch a.type {
            case "veille": veille = true; heureVeille = a.minutes
            case "matin": matin = true; heureMatin = a.minutes
            case "avant": avant = true; minutesAvant = a.minutes
            default: break
            }
        }
        if let l = r.lieu {
            sensLieu = l.arrivee ? 1 : 2
            lieuId = l.id ?? Self.idGarde
            lieuGarde = l
        }
    }

    private func enregistrer() {
        let alertes = alertesChoisies
        let lieu = lieuChoisi
        let quand = avecDate ? date : nil
        let ok: Bool
        if let r = rappel {
            // Une tour d'avant : la note, les alertes et le lieu déjà posés ne bougent pas.
            ok = app.carnet.modifier(r, texte: texte, quand: quand, note: declencheurs ? note : r.note,
                                     alertes: declencheurs ? alertes : (r.alertes ?? []), lieu: declencheurs ? lieu : r.lieu)
        } else {
            // Le texte du rappel comme au « + » : la date n'en part que si elle
            // était au bout (« Payer la facture de fin octobre à Hugo » reste entier).
            let lue = dateTouchee ? nil : AnalyseDate.extraire(texte)
            let t = lue.map { GenreCapture.texte(texte, date: $0, genre: .rappel) } ?? AnalyseDate.sansFormule(texte)
            ok = app.carnet.creerRappel(t, quand: quand, note: note, alertes: alertes, lieu: lieu) != nil
        }
        guard ok else { return }
        Haptique.succes()
        if veille { UserDefaults.standard.set(heureVeille, forKey: PreferencesAlertes.cleVeille) }
        if matin { UserDefaults.standard.set(heureMatin, forKey: PreferencesAlertes.cleMatin) }
        if avant { UserDefaults.standard.set(minutesAvant, forKey: PreferencesAlertes.cleAvant) }
        let modele = app
        Task { @MainActor in
            // Le rappel sonnera : les permissions sont demandées à ce moment-là, jamais au lancement.
            if quand != nil || lieu != nil { await Notifications.demander() }
            if lieu != nil, !(await CapteurLocalisation.partage.demanderPourRappel()) {
                modele.dire("Autorise la position pour Rémy dans les réglages d'iOS : sans elle, ce rappel ne sonnera pas sur place.")
            }
            await Notifications.planifier(modele.carnet.rappels)
        }
        fermer()
    }
}
