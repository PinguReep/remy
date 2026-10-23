import SwiftUI
import RemyCore

/// « À voir avec Rémy » : ce que Rémy a remarqué en relisant tes échanges la
/// nuit. Chaque sujet se règle d'un geste (fait, laissé de côté) ou se
/// discute avec lui. Ouverte par la boîte en haut de l'accueil.
struct BoiteView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer

    var body: some View {
        let d = app.tableau.donnees
        let b = d?.briefing
        let recente = Nuit.estRecente(b?.generatedAt, maintenant: Date())
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(Self.intro(b, recente: recente))
                        .font(Police.texte(15))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                    if let items = b?.items, !items.isEmpty {
                        ForEach(items) { s in
                            CarteSujet(sujet: s, generatedAt: b?.generatedAt) { fermer() }
                        }
                    } else if let texte = b?.text, !texte.isEmpty {
                        TexteRemy(texte: texte)
                            .padding(18)
                            .carte(rayon: 18)
                    } else {
                        Text(Self.rien(b, recente: recente, reflexion: d?.systeme?.reflexion))
                            .font(Police.texte(15))
                            .foregroundStyle(Palette.encre2)
                            .padding(18)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .carte(rayon: 18)
                    }
                }
                .padding(16)
            }
            .background(Palette.fond)
            .overlay(alignment: .bottom) { ToastView(marge: 12, annoncer: false) }
            .navigationTitle("À voir avec Rémy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fermer") { fermer() } }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

extension BoiteView {
    /// Rien à voir : dit pourquoi (nuit calme, préparation coupée, pas encore passée).
    static func rien(_ b: Briefing?, recente: Bool, reflexion: Bool?) -> String {
        if b?.generatedAt != nil { return recente ? "Rien de notable cette nuit." : "Rien de notable la dernière fois." }
        if reflexion == false { return "La préparation de nuit n'est pas active : rien ne s'affichera ici." }
        return "Chaque nuit, Rémy relit tes échanges et note ici ce qui mérite ton attention."
    }

    static func intro(_ b: Briefing?, recente: Bool) -> String {
        guard let g = b?.generatedAt, !recente else {
            return "Ce que Rémy a remarqué cette nuit. Rien ne presse : tu peux les laisser pour plus tard."
        }
        return "Ce que Rémy a remarqué le \(Format.jourCourt(g.date))."
    }
}

/// Un sujet de la nuit : en parler, c'est fait, laisser tomber — ou le rouvrir.
struct CarteSujet: View {
    @Environment(AppModel.self) private var app
    let sujet: Sujet
    let generatedAt: Millis?
    let fermer: () -> Void

    var body: some View {
        let ouvert = sujet.etat == "ouvert"
        VStack(alignment: .leading, spacing: 12) {
            Text(sujet.texte)
                .font(Police.texte(16, ouvert ? .medium : .regular))
                .strikethrough(sujet.etat == "traite")
                .foregroundStyle(ouvert ? Palette.encre : Palette.encre3)
                .fixedSize(horizontal: false, vertical: true)
            if ouvert {
                BoutonA(titre: "En parler à Rémy", symbole: "bubble.left", hauteur: 44) {
                    fermer()
                    Haptique.leger()
                    Task {
                        _ = await app.preparer(Brouillons.sujet(sujet, generatedAt: generatedAt),
                                               dansFil: Fils.nocturne((generatedAt ?? Date().millis).date))
                    }
                }
                HStack(spacing: 8) {
                    BoutonA(titre: "C'est fait", principal: false, hauteur: 44) { changer("traite") }
                    BoutonA(titre: "Laisser tomber", principal: false, hauteur: 44) { changer("ignore") }
                }
            } else {
                HStack {
                    Text(sujet.etat == "traite" ? "Fait" : "Laissé de côté")
                        .font(Police.texte(14))
                        .foregroundStyle(Palette.encre3)
                    Spacer()
                    BoutonTexte("Rouvrir") { changer("ouvert") }
                }
            }
        }
        .padding(18)
        .carte(rayon: 18)
    }

    private func changer(_ etat: String) {
        Haptique.leger()
        Task { await app.tableau.changer(sujet, vers: etat) }
    }
}
