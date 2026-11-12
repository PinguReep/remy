import SwiftUI
import UIKit
import RemyCore

// MARK: - Chercher dans Projets (12/11)
//
// Ce que montre Projets pendant une recherche : les résultats du cœur
// (RechercheProjets), groupés par genre, le début des mots trouvés surligné.
// Toucher une ligne ouvre son écran (ProjetsView.ouvrir). Rien n'est calculé ici.

struct ResultatsProjetsVue: View {
    let resultats: ResultatsProjets
    let choisir: (ElementTrouve) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let titre = resultats.titreVide {
                vide(titre)
            } else {
                if let t = resultats.enTete {
                    Text(t)
                        .font(Police.texte(13, .medium))
                        .foregroundStyle(Palette.encre3)
                        .padding(.horizontal, 22)
                        .accessibilityAddTraits(.isHeader)
                }
                ForEach(resultats.groupes) { g in groupe(g) }
            }
        }
        // VoiceOver : combien de résultats, une fois la frappe posée.
        .task(id: resultats.requete) {
            try? await Task.sleep(nanoseconds: 900_000_000)
            guard !Task.isCancelled, UIAccessibility.isVoiceOverRunning,
                  let annonce = resultats.enTete ?? resultats.titreVide else { return }
            UIAccessibility.post(notification: .announcement, argument: annonce)
        }
    }

    private func groupe(_ g: GroupeTrouve) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            TitreSection(texte: g.titre, compte: g.total).padding(.horizontal, 6)
            VStack(spacing: 0) {
                ForEach(Array(g.elements.enumerated()), id: \.element.id) { i, e in
                    ligne(e)
                    if i < g.elements.count - 1 {
                        Rectangle().fill(Palette.filet).frame(height: 1).padding(.leading, 46)
                    }
                }
            }
            .padding(.horizontal, 14)
            .carte(rayon: 18)
            if g.reste > 0 {
                Text(RechercheProjets.phraseReste(g.reste))
                    .font(Police.texte(13))
                    .foregroundStyle(Palette.encre3)
                    .padding(.horizontal, 6)
            }
        }
        .padding(.horizontal, 16)
    }

    private func ligne(_ e: ElementTrouve) -> some View {
        let sous = detail(e)
        return Button { choisir(e) } label: {
            HStack(spacing: 12) {
                Image(systemName: symbole(e.genre))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(e.genre == .projet ? Palette.projet(e.titre) : Palette.encre2)
                    .frame(width: 32, height: 32)
                    .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(titre(e))
                        .strikethrough(e.fait)
                        .font(Police.texte(16, .medium))
                        .foregroundStyle(e.fait ? Palette.encre3 : Palette.encre)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if !sous.isEmpty {
                        Text(sous)
                            .font(Police.texte(13))
                            .foregroundStyle(Palette.encre2)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Palette.encre3)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 10)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(sous.isEmpty ? e.titre : "\(e.titre). \(sous)")
        .accessibilityHint(indice(e.genre))
        .accessibilityIdentifier("projets.trouve.\(e.id)")
    }

    /// Le titre, le début des mots trouvés surligné (fond orange pâle, gras).
    private func titre(_ e: ElementTrouve) -> AttributedString {
        var a = AttributedString()
        for m in e.morceaux {
            var p = AttributedString(m.texte)
            if m.trouve {
                p[AttributeScopes.SwiftUIAttributes.BackgroundColorAttribute.self] = Palette.signal.opacity(0.22)
                p[AttributeScopes.SwiftUIAttributes.FontAttribute.self] = Police.texte(16, .semibold)
            }
            a.append(p)
        }
        return a
    }

    /// Où il vit, l'heure d'un rappel, et s'il est fait.
    private func detail(_ e: ElementTrouve) -> String {
        var bits: [String] = []
        if let c = e.contexte { bits.append(c) }
        if e.genre == .rappel, let q = e.quand { bits.append(Format.quandRelatif(q)) }
        if e.fait {
            switch e.genre {
            case .tache: bits.append("faite")
            case .note: bits.append("relue")
            case .article: bits.append("pris")
            default: bits.append("fait")
            }
        }
        return bits.joined(separator: " · ")
    }

    private func symbole(_ g: GenreTrouve) -> String {
        switch g {
        case .projet: return "square.stack.fill"
        case .tache: return "checkmark.circle"
        case .dossier: return "folder"
        case .note: return "lightbulb"
        case .liste: return "list.bullet"
        case .article: return "checklist"
        case .rappel: return "bell"
        }
    }

    private func indice(_ g: GenreTrouve) -> String {
        switch g {
        case .projet: return "Ouvre le projet"
        case .tache: return "Ouvre la tâche dans Gérer"
        case .dossier, .note: return "Ouvre le dossier"
        case .liste, .article: return "Ouvre la liste"
        case .rappel: return "Ouvre la fiche du rappel"
        }
    }

    private func vide(_ titre: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 26))
                .foregroundStyle(Palette.encre3)
                .accessibilityHidden(true)
            Text(titre)
                .font(Police.texte(18, .semibold))
                .foregroundStyle(Palette.encre)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let d = resultats.detailVide {
                Text(d)
                    .font(Police.texte(15))
                    .foregroundStyle(Palette.encre2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .carte()
        .padding(.horizontal, 16)
    }
}
