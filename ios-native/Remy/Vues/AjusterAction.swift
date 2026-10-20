import SwiftUI
import RemyCore

/// Ajuster une ligne d'une proposition de Rémy avant de dire oui (Sam, 18/10,
/// devant « Ajouter : Acheter abonnement Claude Code pour Tom · 10 min » sans
/// date) : nom, date et heure, durée, priorité, catégorie — ou en faire un
/// rappel plutôt qu'une tâche Motion. Rien ne part dans Motion ni dans le fil :
/// la tour garde la version ajustée, et « Oui, fais-le » enverra celle-là.
struct DemandeAjustement: Identifiable {
    var id: Int { rang }
    let ligne: LigneChat
    let rang: Int
    let action: ActionProposee
    let versAgenda: Bool
}

struct AjusterAction: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    let demande: DemandeAjustement

    enum Forme: String { case tache, rappel }
    @State private var forme = Forme.tache
    @State private var nom: String
    @State private var avecDate: Bool
    @State private var quand: Date
    @State private var duree: Int?
    @State private var priorite: String
    @State private var etiquettes: Set<String>
    @State private var envoi = false

    private let nomInitial: String
    private let quandInitial: Date?
    private let dureeInitiale: Int?
    private let prioriteInitiale: String?
    private let etiquettesInitiales: Set<String>

    static let durees = [5, 10, 15, 30, 45, 60, 90, 120]

    init(demande: DemandeAjustement) {
        self.demande = demande
        let a = demande.action
        let n = a.type == "creer" ? (a.nom ?? a.titre ?? "") : (a.nouveau_nom ?? a.nouveau_titre ?? a.nom ?? a.titre ?? "")
        nomInitial = n
        let q = (demande.versAgenda ? a.debut : a.echeance).flatMap(Format.dateISO)
        quandInitial = q
        var d = a.duree.flatMap { Int($0.texte) }
        if demande.versAgenda, d == nil, let debut = a.debut.flatMap(Format.dateISO), let fin = a.fin.flatMap(Format.dateISO) {
            d = Int(fin.timeIntervalSince(debut) / 60)
        }
        dureeInitiale = d
        prioriteInitiale = a.priorite?.uppercased()
        etiquettesInitiales = Set(a.etiquettes ?? [])
        _nom = State(initialValue: n)
        _avecDate = State(initialValue: q != nil || demande.versAgenda)
        _quand = State(initialValue: q ?? (demande.versAgenda ? Self.demainNeufHeures() : Format.echeanceDans(jours: 1)))
        _duree = State(initialValue: d)
        _priorite = State(initialValue: a.priorite?.uppercased() ?? "MEDIUM")
        _etiquettes = State(initialValue: Set(a.etiquettes ?? []))
    }

    private var action: ActionProposee { demande.action }
    private var creation: Bool { action.type == "creer" }
    /// Une tâche Motion à créer peut devenir un rappel ; un rendez-vous ou une
    /// tâche existante, non.
    private var rappelPossible: Bool { creation && !demande.versAgenda && app.carnet.disponible }
    private var enRappel: Bool { forme == .rappel }
    private var categoriesPossibles: Bool {
        !demande.versAgenda && (enRappel || app.tableau.categoriesDisponibles)
    }

    var body: some View {
        NavigationStack {
            List {
                if rappelPossible {
                    Section {
                        Picker("Ranger comme", selection: $forme.animation(.snappy)) {
                            Text("Tâche Motion").tag(Forme.tache)
                            Text("Rappel").tag(Forme.rappel)
                        }
                        .pickerStyle(.segmented)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    } footer: {
                        Text(enRappel
                             ? "Un rappel te prévient au moment dit, sans prendre de créneau : pour une petite chose à ne pas oublier."
                             : "Motion lui trouve un créneau avant l'échéance : pour ce qui demande du temps.")
                    }
                }
                Section("Nom") {
                    TextField("Nom", text: $nom, axis: .vertical)
                        .font(Police.texte(16))
                        .frame(minHeight: 44)
                }
                quandSection
                if !enRappel {
                    dureeSection
                    if !demande.versAgenda {
                        Section("Priorité") {
                            Picker("Priorité", selection: $priorite) {
                                ForEach(ModifierTache.priorites, id: \.0) { Text($0.1).tag($0.0) }
                            }
                            .pickerStyle(.segmented)
                        }
                    }
                }
                if categoriesPossibles { categorieSection }
            }
            .listeAtelier()
            .navigationTitle(creation ? "Ajuster l'ajout" : "Ajuster la modification")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { fermer() } }
            }
            .safeAreaInset(edge: .bottom) { barre }
        }
        .presentationDetents([.large])
        .onAppear {
            // Pas de catégorie proposée par Rémy : celle que les mots suggèrent (sans IA).
            if etiquettes.isEmpty, let e = EtiquetteDevinee.pour(nom, parmi: app.organisation.etiquettes) {
                etiquettes = [e.id]
            }
            // Capture de la CI : la même ligne, rangée en rappel.
            let env = ProcessInfo.processInfo.environment
            if env["REMY_DEMO_MDP"] != nil, env["REMY_DEMO_ECRAN"] == "ajuster-rappel", rappelPossible {
                forme = .rappel
                avecDate = true
            }
        }
        .onChange(of: forme) { _, f in
            // Une échéance « avant demain soir » devient un rappel à une heure où l'on est debout.
            if f == .rappel, Format.calendrier.component(.hour, from: quand) >= 21 {
                quand = Format.calendrier.date(bySettingHour: 9, minute: 0, second: 0, of: quand) ?? quand
            }
        }
    }

    // MARK: Sections

    private var quandSection: some View {
        Section {
            // Un rendez-vous a toujours son heure : pas d'interrupteur.
            if !demande.versAgenda {
                Toggle(enRappel ? "Une date et une heure" : "Une échéance", isOn: $avecDate.animation(.snappy))
                    .frame(minHeight: 44)
            }
            if avecDate {
                DatePicker(enRappel ? "Le" : demande.versAgenda ? "Début" : "Avant le", selection: $quand, displayedComponents: [.date, .hourAndMinute])
                    .environment(\.locale, Format.locale)
                    .environment(\.timeZone, Format.fuseau)
                    .frame(minHeight: 44)
                Flux {
                    raccourci("Aujourd'hui", jours: 0)
                    raccourci("Demain", jours: 1)
                    raccourci("Dans 3 jours", jours: 3)
                    raccourci("Dans 1 semaine", jours: 7)
                }
                .padding(.vertical, 4)
            }
        } header: {
            Text("Quand")
        } footer: {
            if !avecDate && !enRappel {
                Text("Sans échéance, Motion la case quand il peut.")
            } else if avecDate && !enRappel && !demande.versAgenda {
                Text("C'est une limite, pas un créneau : Motion place la tâche avant.")
            }
        }
    }

    /// Change le jour, garde l'heure choisie.
    private func raccourci(_ titre: String, jours: Int) -> some View {
        let cible = Format.calendrier.date(byAdding: .day, value: jours, to: Format.debutDuJour(Date())) ?? Date()
        let actif = Format.calendrier.isDate(quand, inSameDayAs: cible)
        return PuceChoix(titre: titre, actif: actif) {
            let h = Format.calendrier.dateComponents([.hour, .minute], from: quand)
            quand = Format.calendrier.date(bySettingHour: h.hour ?? 9, minute: h.minute ?? 0, second: 0, of: cible) ?? cible
        }
    }

    private var dureeSection: some View {
        Section {
            Flux {
                ForEach(Self.durees, id: \.self) { m in
                    PuceChoix(titre: Format.duree(minutes: m), actif: duree == m) { duree = m }
                }
            }
            .padding(.vertical, 4)
        } header: {
            Text("Durée")
        } footer: {
            if duree == nil { Text("Rémy n'a pas donné de durée : en choisir une aide Motion à la placer.") }
        }
    }

    @ViewBuilder
    private var categorieSection: some View {
        Section {
            if app.organisation.etiquettes.isEmpty {
                NavigationLink("Créer tes catégories (Voiture, Santé, Pro…)") { GestionEtiquettes() }
                    .frame(minHeight: 44)
            } else {
                Flux {
                    ForEach(app.organisation.etiquettes) { e in
                        PuceChoix(titre: e.nom, actif: etiquettes.contains(e.id)) {
                            if etiquettes.contains(e.id) { etiquettes.remove(e.id) } else { etiquettes.insert(e.id) }
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        } header: {
            Text("Catégorie")
        } footer: {
            Text("Le domaine (Voiture, Santé, Pro, Perso…), pour filtrer et voir où passe ton temps.")
        }
    }

    // MARK: Envoi

    private var barre: some View {
        VStack(spacing: 6) {
            if enRappel {
                BoutonA(titre: envoi ? "…" : "Ranger en rappel", symbole: "bell") { Task { await rangerEnRappel() } }
                    .disabled(envoi || nomPropre.isEmpty)
                Text("Le rappel est noté tout de suite ; il sort de la proposition.")
                    .font(Police.texte(12)).foregroundStyle(Palette.encre3)
            } else {
                BoutonA(titre: envoi ? "…" : "Enregistrer", symbole: "checkmark") { Task { await enregistrer() } }
                    .disabled(envoi || !change || nomPropre.isEmpty)
                Text("Rien ne part avant « Oui, fais-le ».")
                    .font(Police.texte(12)).foregroundStyle(Palette.encre3)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity)
        .background(Palette.fond.opacity(0.97))
        .overlay(alignment: .top) { Rectangle().fill(Palette.filet).frame(height: 1) }
    }

    private var nomPropre: String { nom.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var etiquettesValides: [String] { app.organisation.etiquettes.map(\.id).filter { etiquettes.contains($0) } }

    private var change: Bool { !champs.isEmpty }

    /// Seuls les champs changés partent ; `NSNull()` vide un champ.
    private var champs: [String: Any] {
        var c: [String: Any] = [:]
        if nomPropre != nomInitial {
            let cle = demande.versAgenda ? (creation ? "titre" : "nouveau_titre") : (creation ? "nom" : "nouveau_nom")
            c[cle] = nomPropre
        }
        let dateVoulue = avecDate ? quand : nil
        if demande.versAgenda {
            let d = duree ?? 60
            if dateVoulue != quandInitial || duree != dureeInitiale, let debut = dateVoulue {
                c["debut"] = Format.isoAvecFuseau(debut)
                c["fin"] = Format.isoAvecFuseau(debut.addingTimeInterval(TimeInterval(d * 60)))
            }
        } else {
            if dateVoulue != quandInitial {
                if let d = dateVoulue { c["echeance"] = Format.isoAvecFuseau(d) } else { c["echeance"] = NSNull() }
            }
            if duree != dureeInitiale, let d = duree { c["duree"] = d }
            if priorite != (prioriteInitiale ?? "MEDIUM") { c["priorite"] = priorite }
            if categoriesPossibles, Set(etiquettesValides) != etiquettesInitiales { c["etiquettes"] = etiquettesValides }
        }
        return c
    }

    private func enregistrer() async {
        guard !envoi else { return }
        envoi = true
        defer { envoi = false }
        if await app.chat.ajuster(demande.ligne, rang: demande.rang, champs: champs) {
            Haptique.succes()
            fermer()
        } else {
            Haptique.erreur()
        }
    }

    private func rangerEnRappel() async {
        guard !envoi else { return }
        envoi = true
        defer { envoi = false }
        if await app.chat.rangerEnRappel(demande.ligne, rang: demande.rang, texte: nomPropre,
                                         quand: avecDate ? quand : nil, etiquettes: etiquettesValides) {
            Haptique.succes()
            fermer()
        } else {
            Haptique.erreur()
        }
    }

    private static func demainNeufHeures() -> Date {
        let demain = Format.calendrier.date(byAdding: .day, value: 1, to: Format.debutDuJour(Date())) ?? Date()
        return Format.calendrier.date(bySettingHour: 9, minute: 0, second: 0, of: demain) ?? demain
    }
}

/// Une puce à choisir (durée, jour, catégorie) : 40 pt de haut, dans un `Flux`.
private struct PuceChoix: View {
    let titre: String
    let actif: Bool
    let faire: () -> Void

    var body: some View {
        Button {
            Haptique.leger()
            faire()
        } label: {
            Text(titre)
                .font(Police.texte(13, .semibold))
                .foregroundStyle(actif ? Palette.fond : Palette.encre)
                .padding(.horizontal, 12)
                .frame(minHeight: 40)
                .background(actif ? Palette.encre2 : Palette.fond2, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(actif ? .isSelected : [])
    }
}
