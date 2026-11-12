import SwiftUI
import RemyCore

// Réglages › Ce qui compte (12/11, priorites-v2) : « Ce que Rémy a compris ».
// Sam n'écrit plus ses priorités : la tour en propose un classement, sans IA,
// avec ce qu'elle a vu (« d'après Motion… »). Sam confirme (« C'est ça »),
// corrige (monter, descendre) ou écarte (« Pas une priorité »), puis
// enregistre. Seul le classement confirmé sert au conseil et à la nuit.
// L'ajout à la main reste possible, en bas, discret. Le même écran que le
// site (public/app/vues/reglages.js) ; la logique est dans RemyCore
// (CeQuiCompte.swift). Une tour d'avant : l'écran écrit d'avant
// (PrioritesEcritesVue, CerveauVues.swift).

/// Réglages › Ce qui compte : l'écran que la tour sait servir.
struct PrioritesVue: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if app.priorites.disponible {
            CeQueRemyAComprisVue()
        } else {
            PrioritesEcritesVue()
        }
    }
}

/// « Ce que Rémy a compris » : le classement confirmé, puis les pistes.
struct CeQueRemyAComprisVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var ajoutOuvert = false
    @State private var aModifier: LigneClassement?
    @State private var quitterOuvert = false

    var body: some View {
        let m = app.priorites
        NavigationStack {
            List {
                SectionEtatPriorites()
                if let c = m.classement {
                    ContenuClassement(classement: c, ajouter: { ajoutOuvert = true }, modifier: { aModifier = $0 })
                } else if let e = m.erreur, !m.chargement {
                    SectionErreurPriorites(texte: e)
                } else {
                    Section {
                        Squelette(largeurs: [0.45, 0.9, 0.7])
                        Squelette(largeurs: [0.35, 0.8, 0.6, 0.5])
                    }
                }
                SectionNotificationsPropositions()
            }
            .overlay(alignment: .bottom) { ToastView(marge: 24, annoncer: false) }
            .navigationTitle("Ce qui compte")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") {
                        if m.modifie { quitterOuvert = true } else { fermer() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(m.enregistrement ? "…" : "Enregistrer") { Task { await m.enregistrer() } }
                        .disabled(!m.peutEnregistrer)
                }
            }
            .task { await m.charger() }
            .refreshable { await m.charger() }
            .sheet(isPresented: $ajoutOuvert) {
                FeuillePriorite(titreFeuille: "Ajouter à la main", titre: "", pourquoi: "", mots: "", avecMots: false) { t, q, _ in
                    m.ajouter(titre: t, pourquoi: q)
                }
            }
            .sheet(item: $aModifier) { l in
                FeuillePriorite(titreFeuille: "Modifier", titre: l.titre, pourquoi: l.pourquoiTexte, mots: l.motsTexte, avecMots: true) { t, q, mo in
                    m.modifier(l.id, titre: t, pourquoi: q, mots: mo)
                }
            }
            .confirmationDialog("Tes corrections ne sont pas enregistrées", isPresented: $quitterOuvert, titleVisibility: .visible) {
                Button("Enregistrer le classement") {
                    Task {
                        if await m.enregistrer() { fermer() }
                    }
                }
                Button("Fermer, elles restent ici") { fermer() }
                Button("Annuler", role: .cancel) {}
            } message: {
                Text("Rien ne sert à Rémy avant « Enregistrer ». Fermées, elles restent ici tant que l'app reste ouverte et que ton classement ne change pas ailleurs.")
            }
        }
    }
}

/// Le contenu, une fois quelque chose lu (de la tour, ou gardé sur l'iPhone).
private struct ContenuClassement: View {
    let classement: ClassementPriorites
    let ajouter: () -> Void
    let modifier: (LigneClassement) -> Void

    var body: some View {
        // Vide sans aucun geste : dire pourquoi. Vidé par Sam : ce qui reste à enregistrer.
        let vide = classement.vide && !classement.modifie
        if vide {
            SectionVidePriorites(ajouter: ajouter)
        } else {
            SectionClassement(classement: classement, modifier: modifier)
            SectionPistes(classement: classement)
        }
        SectionLimitesProposition(vide: vide)
        SectionEnregistrer(classement: classement, avecAjout: !vide, ajouter: ajouter)
    }
}

// MARK: - États

/// Hors ligne, copie de l'iPhone, tour injoignable : ce qui est montré, et
/// pourquoi les gestes attendent. Une relecture ratée le dit aussi.
private struct SectionEtatPriorites: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let m = app.priorites
        if let b = m.bandeau() {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: app.horsLigne ? "wifi.slash" : "clock.arrow.circlepath")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(Palette.encre2)
                            .accessibilityHidden(true)
                        Text(b)
                            .font(Police.texte(14))
                            .foregroundStyle(Palette.encre)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !app.horsLigne && !m.chargement && m.erreur != nil {
                        BoutonTexte("Réessayer") { Task { await m.charger() } }
                    }
                }
            }
        } else if m.classement != nil, let e = m.erreur, !m.chargement {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Pas relu sur ta tour : \(e)")
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                    BoutonTexte("Réessayer") { Task { await m.charger() } }
                }
            }
        }
    }
}

/// Rien de lu : l'erreur, et « Réessayer ».
private struct SectionErreurPriorites: View {
    @Environment(AppModel.self) private var app
    let texte: String

    var body: some View {
        let m = app.priorites
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Text("Ce qui compte n'a pas pu être lu : \(texte)")
                    .font(Police.texte(15))
                    .foregroundStyle(Palette.danger)
                    .fixedSize(horizontal: false, vertical: true)
                if app.horsLigne {
                    Text("Pas de réseau : l'écran se relira dès que l'iPhone en aura.")
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                BoutonTexte("Réessayer") { Task { await m.charger() } }
            }
        }
    }
}

/// Rien à proposer, rien de confirmé : pourquoi, et quoi faire.
private struct SectionVidePriorites: View {
    @Environment(AppModel.self) private var app
    let ajouter: () -> Void

    var body: some View {
        let m = app.priorites
        Section {
            VStack(alignment: .leading, spacing: 12) {
                Text(CeQuiCompte.vide(m.proposition))
                    .font(Police.texte(15))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                if m.proposition == nil || m.proposition?.motion == "erreur" {
                    BoutonTexte("Réessayer") { Task { await m.charger() } }
                        .disabled(m.chargement || app.horsLigne)
                }
                Button { ajouter() } label: {
                    Label("Ajouter une priorité à la main", systemImage: "plus")
                }
                .buttonStyle(BoutonBrut())
                .disabled(!m.peutCorriger)
            }
            .padding(.vertical, 6)
        } header: {
            Text("Ce que Rémy a compris")
        }
    }
}

// MARK: - Le classement confirmé

private struct SectionClassement: View {
    @Environment(AppModel.self) private var app
    let classement: ClassementPriorites
    let modifier: (LigneClassement) -> Void

    var body: some View {
        if !classement.classees.isEmpty {
            Section {
                if classement.classees.count > 1 {
                    Text("Dans l'ordre : la n°1 passe devant la n°2, et ainsi de suite.")
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(Array(classement.classees.enumerated()), id: \.element.id) { i, l in
                    LignePrioriteConfirmee(ligne: l, rang: i + 1, total: classement.classees.count, modifier: { modifier(l) })
                }
            } header: {
                Text(entete)
            }
        }
    }

    private var entete: String {
        let m = app.priorites
        if m.modifie { return "Ton classement · à enregistrer" }
        if let d = m.vue?.classeA { return "Ton classement · confirmé le \(Format.jourCourt(d.date))" }
        return "Ton classement"
    }
}

private struct LignePrioriteConfirmee: View {
    @Environment(AppModel.self) private var app
    let ligne: LigneClassement
    let rang: Int
    let total: Int
    let modifier: () -> Void

    var body: some View {
        let m = app.priorites
        VStack(alignment: .leading, spacing: 8) {
            TetePriorite(rang: "n°\(rang)", titre: ligne.titre, projet: ligne.projetNom, etat: ligne.etat,
                         neglige: ligne.neglige, propose: false, lu: lu)
            Flux(espacement: 6) {
                if total > 1 {
                    FlechePriorite(monter: true, titre: ligne.titre, actif: m.peutCorriger && rang > 1) { m.monter(ligne.id) }
                    FlechePriorite(monter: false, titre: ligne.titre, actif: m.peutCorriger && rang < total) { m.descendre(ligne.id) }
                }
                BoutonLigne(titre: "Modifier", libelle: CeQuiCompte.libelle(.modifier, ligne.titre), actif: m.peutCorriger, action: modifier)
                BoutonLigne(titre: "Pas une priorité", libelle: CeQuiCompte.libelle(.ecarter, ligne.titre), actif: m.peutCorriger) {
                    m.ecarter(ligne.id)
                }
            }
        }
        .padding(.vertical, 6)
    }

    /// Ce que VoiceOver lit de la ligne : son rang d'abord.
    private var lu: String {
        var t = "Numéro \(rang) de ton classement : \(ligne.titre)"
        if let p = ligne.projetNom { t += ", projet Motion \(p)" }
        if let e = ligne.etat { t += ". \(e)" }
        return t
    }
}

// MARK: - Les pistes de Rémy

private struct SectionPistes: View {
    @Environment(AppModel.self) private var app
    let classement: ClassementPriorites

    var body: some View {
        let m = app.priorites
        if !classement.proposees.isEmpty {
            Section {
                Text(classement.classees.isEmpty
                     ? "Voilà ce que Rémy a compris, dans cet ordre. Rien ne s'en sert tant que tu n'as pas dit « C'est ça »."
                     : "Rémy voit aussi ces pistes. Rien ne s'en sert tant que tu n'as pas dit « C'est ça ».")
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(Array(classement.proposees.enumerated()), id: \.element.id) { i, l in
                    LignePiste(ligne: l, rang: i + 1, total: classement.proposees.count)
                }
                if classement.proposees.count > 1 && !classement.plein {
                    Button {
                        Haptique.leger()
                        m.toutConfirmer()
                    } label: {
                        Label(classement.classees.isEmpty ? "Tout est juste, dans cet ordre" : "Les confirmer toutes, dans cet ordre",
                              systemImage: "checkmark")
                    }
                    .buttonStyle(BoutonBrut(pleineLargeur: true))
                    .disabled(!m.peutCorriger)
                }
            } header: {
                Text("Proposé par Rémy, à confirmer")
            }
        }
    }
}

private struct LignePiste: View {
    @Environment(AppModel.self) private var app
    let ligne: LigneClassement
    let rang: Int
    let total: Int

    var body: some View {
        let m = app.priorites
        VStack(alignment: .leading, spacing: 8) {
            TetePriorite(rang: "\(rang) ?", titre: ligne.titre, projet: projet, etat: nil,
                         neglige: false, propose: true, lu: lu)
            if !ligne.indices.isEmpty {
                IndicesPiste(titre: ligne.titre, indices: ligne.indices)
            }
            Flux(espacement: 6) {
                Button {
                    Haptique.leger()
                    m.confirmer(ligne.id)
                } label: {
                    Label("C'est ça", systemImage: "checkmark")
                }
                .buttonStyle(BoutonBrut(genre: .principal))
                .disabled(!m.peutCorriger)
                .accessibilityLabel(CeQuiCompte.libelle(.confirmer, ligne.titre))
                if total > 1 {
                    FlechePriorite(monter: true, titre: ligne.titre, actif: m.peutCorriger && rang > 1) { m.monter(ligne.id) }
                    FlechePriorite(monter: false, titre: ligne.titre, actif: m.peutCorriger && rang < total) { m.descendre(ligne.id) }
                }
                BoutonLigne(titre: "Pas une priorité", libelle: CeQuiCompte.libelle(.ecarter, ligne.titre), actif: m.peutCorriger) {
                    m.ecarter(ligne.id)
                }
            }
        }
        .padding(.vertical, 6)
    }

    /// Le projet Motion, s'il ne répète pas le titre.
    private var projet: String? {
        guard let n = ligne.projetNom, n != ligne.titre else { return nil }
        return n
    }

    private var lu: String {
        var t = "Proposée par Rémy, numéro \(rang), à confirmer : \(ligne.titre)"
        if let p = projet { t += ", projet Motion \(p)" }
        return t
    }
}

/// Ce que Rémy a vu pour une piste, par source : « D'après Motion », etc.
private struct IndicesPiste: View {
    let titre: String
    let indices: [IndicePriorite]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(CeQuiCompte.groupes(indices), id: \.titre) { g in
                VStack(alignment: .leading, spacing: 2) {
                    Text(g.titre)
                        .font(Police.texte(13, .semibold))
                        .foregroundStyle(Palette.encre2)
                    ForEach(Array(g.textes.enumerated()), id: \.offset) { _, t in
                        Text("· " + t)
                            .font(Police.texte(13))
                            .foregroundStyle(Palette.encre2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .padding(.leading, 44)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(CeQuiCompte.indicesLus(titre, indices))
    }
}

// MARK: - Ce que la proposition ne voit pas

private struct SectionLimitesProposition: View {
    @Environment(AppModel.self) private var app
    let vide: Bool

    var body: some View {
        let m = app.priorites
        Section {
            if !vide && m.proposition == nil && !m.copieLocale {
                VStack(alignment: .leading, spacing: 8) {
                    Text("La proposition de Rémy n'a pas pu être lue : seules tes priorités écrites sont montrées.")
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                    BoutonTexte("Réessayer") { Task { await m.charger() } }
                        .disabled(m.chargement || app.horsLigne)
                }
            }
            if let n = CeQuiCompte.noteMotion(m.proposition) {
                Text(n)
                    .font(Police.texte(14))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "info.circle")
                    .font(.system(size: 15))
                    .foregroundStyle(Palette.encre3)
                    .accessibilityHidden(true)
                Text(m.proposition?.limites ?? CeQuiCompte.limites)
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } header: {
            Text("Ce que Rémy ne voit pas")
        }
    }
}

// MARK: - En bas : l'ajout discret, l'enregistrement

private struct SectionEnregistrer: View {
    @Environment(AppModel.self) private var app
    let classement: ClassementPriorites
    let avecAjout: Bool
    let ajouter: () -> Void

    var body: some View {
        let m = app.priorites
        Section {
            if avecAjout {
                if classement.plein {
                    Text("Cinq au plus : au-delà, plus rien n'est prioritaire.")
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre3)
                } else {
                    BoutonLigne(titre: "Ajouter une priorité à la main", libelle: "Ajouter une priorité à la main", actif: m.peutCorriger, action: ajouter)
                }
            }
            if !classement.ecartees.isEmpty {
                BoutonLigne(titre: "Reproposer les pistes écartées (\(classement.ecartees.count))",
                            libelle: "Reproposer les \(classement.ecartees.count) pistes écartées", actif: m.peutCorriger) {
                    m.reproposer()
                }
            }
            if classement.peutAnnuler {
                BoutonLigne(titre: "Annuler le dernier geste", libelle: "Annuler le dernier geste", actif: !m.enregistrement) {
                    m.annulerGeste()
                }
            }
            Button { Task { await m.enregistrer() } } label: {
                Text(m.enregistrement ? "Enregistrement…" : "Enregistrer le classement")
            }
            .buttonStyle(BoutonBrut(genre: .principal, pleineLargeur: true))
            .disabled(!m.peutEnregistrer)
        } footer: {
            Text(pied)
        }
    }

    private var pied: String {
        let m = app.priorites
        var t = m.modifie ? "Tes corrections ne servent à Rémy qu'une fois enregistrées." : "Rien à enregistrer pour l'instant."
        if let v = m.vue, v.version > 0 {
            let date = v.majA.map { " du " + Format.jourCourt($0.date) } ?? ""
            t += " Version \(v.version)\(date) : chaque enregistrement garde les précédentes sur ta tour."
        }
        return t
    }
}

// MARK: - Éléments d'une ligne

/// Le rang et le titre d'une ligne, lus d'une traite par VoiceOver.
private struct TetePriorite: View {
    let rang: String
    let titre: String
    let projet: String?
    let etat: String?
    let neglige: Bool
    let propose: Bool
    let lu: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(rang)
                .font(Police.mono(14, .semibold))
                .foregroundStyle(propose ? Palette.encre3 : Palette.encre)
                .frame(minWidth: 34, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(titre)
                    .font(Police.texte(17, .semibold))
                    .foregroundStyle(Palette.encre)
                    .fixedSize(horizontal: false, vertical: true)
                if let projet {
                    Text("Motion : \(projet)")
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre2)
                }
                if let etat {
                    Text(etat)
                        .font(Police.texte(13, neglige ? .semibold : .regular))
                        .foregroundStyle(neglige ? Palette.danger : Palette.encre3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(lu)
    }
}

/// Monter ou descendre : 44 pt, et VoiceOver dit quelle priorité bouge.
private struct FlechePriorite: View {
    let monter: Bool
    let titre: String
    let actif: Bool
    let action: () -> Void

    var body: some View {
        Button {
            Haptique.leger()
            action()
        } label: {
            Image(systemName: monter ? "arrow.up" : "arrow.down")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Palette.encre)
                .frame(width: 44, height: 44)
                .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!actif)
        .opacity(actif ? 1 : 0.35)
        .accessibilityLabel(CeQuiCompte.libelle(monter ? .monter : .descendre, titre))
    }
}

/// Un geste en texte (« Pas une priorité », « Modifier ») : 44 pt touchables.
private struct BoutonLigne: View {
    let titre: String
    let libelle: String
    let actif: Bool
    let action: () -> Void

    var body: some View {
        Button {
            Haptique.leger()
            action()
        } label: {
            Text(titre)
                .font(Police.texte(15, .semibold))
                .foregroundStyle(Palette.encre2)
                .padding(.horizontal, 10)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!actif)
        .opacity(actif ? 1 : 0.4)
        .accessibilityLabel(libelle)
    }
}

/// Ajouter à la main, ou modifier une priorité confirmée.
private struct FeuillePriorite: View {
    @Environment(\.dismiss) private var fermer
    let titreFeuille: String
    let avecMots: Bool
    /// Rend vrai si c'est fait : la feuille se ferme ; sinon le bandeau dit pourquoi.
    let valider: (String, String, String) -> Bool
    @State private var titre: String
    @State private var pourquoi: String
    @State private var mots: String

    init(titreFeuille: String, titre: String, pourquoi: String, mots: String, avecMots: Bool,
         valider: @escaping (String, String, String) -> Bool) {
        self.titreFeuille = titreFeuille
        self.avecMots = avecMots
        self.valider = valider
        _titre = State(initialValue: titre)
        _pourquoi = State(initialValue: pourquoi)
        _mots = State(initialValue: mots)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Ce qui compte (ex. « La musique »)", text: $titre, axis: .vertical)
                        .font(Police.texte(17, .semibold))
                        .frame(minHeight: 44)
                    TextField("Pourquoi, avec tes mots (facultatif)", text: $pourquoi, axis: .vertical)
                        .font(Police.texte(15))
                        .lineLimit(1...4)
                        .frame(minHeight: 44)
                    if avecMots {
                        TextField("Mots qui la reconnaissent (facultatif : guitare, répétition)", text: $mots)
                            .font(Police.texte(14))
                            .textInputAutocapitalization(.never)
                            .frame(minHeight: 44)
                    }
                } footer: {
                    Text(avecMots
                         ? "Enregistre ensuite ton classement : rien ne change pour Rémy avant."
                         : "Elle entre en dernier dans ton classement. Enregistre-le ensuite : rien ne change pour Rémy avant.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.fond)
            .navigationTitle(titreFeuille)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { fermer() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("OK") {
                        if valider(titre, pourquoi, mots) { fermer() }
                    }
                    .disabled(titre.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .overlay(alignment: .bottom) { ToastView(marge: 24, annoncer: false) }
        }
        .presentationDetents([.medium, .large])
    }
}
