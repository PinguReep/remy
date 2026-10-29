import SwiftUI
import UIKit
import RemyCore

// MARK: - Chercher dans les réglages (29/10)
//
// Le champ en haut de Réglages cherche dans l'index du cœur
// (RechercheReglages : titres, sous-titres, mots-clés, sans IA). Toucher un
// résultat ouvre son écran (feuille, page poussée, ou Réglages lui-même) et met
// la ligne en évidence : fond orange pâle, filet à gauche, quelques secondes ;
// VoiceOver y est amené. Une ligne se déclare avec `.repere(<son titre>)`.

/// La ligne à mettre en évidence après un résultat touché, partagée entre
/// Réglages et ses sous-écrans (une feuille ne voit pas l'état de Réglages).
@MainActor
@Observable
final class RepereReglages {
    static let partage = RepereReglages()

    private(set) var ecran: EcranReglages?
    private(set) var ancre: String?
    /// Change à chaque visée : la même ligne peut être visée deux fois de suite.
    private(set) var jeton = 0

    /// L'identifiant de défilement d'une ligne (deux écrans ont une ligne « Localisation »).
    static func cle(_ ancre: String, _ ecran: EcranReglages) -> String { "\(ecran.rawValue)·\(ancre)" }

    func vise(_ ancre: String, dans ecran: EcranReglages) -> Bool {
        self.ancre == ancre && self.ecran == ecran
    }

    /// Met la ligne en évidence `duree` secondes. VoiceOver dit où il est arrivé.
    func viser(_ ancre: String, dans ecran: EcranReglages, titre: String, duree: TimeInterval = 4) {
        self.ecran = ecran
        self.ancre = ancre
        jeton += 1
        let j = jeton
        Task { @MainActor in
            // Après l'ouverture de l'écran : sinon l'annonce se perd dans la transition.
            try? await Task.sleep(nanoseconds: 900_000_000)
            if UIAccessibility.isVoiceOverRunning, self.jeton == j {
                UIAccessibility.post(notification: .announcement, argument: "Réglage trouvé : \(titre)")
            }
            try? await Task.sleep(nanoseconds: UInt64(max(0, duree - 0.9) * 1_000_000_000))
            guard self.jeton == j else { return }
            self.ancre = nil
            self.ecran = nil
        }
    }

    /// Réglages de l'iPhone › Rémy (autorisations d'iOS).
    static var reglagesIPhone: URL? { URL(string: UIApplication.openSettingsURLString) }
}

extension View {
    /// Une ligne de réglage que la recherche sait retrouver : `ancre` est son
    /// titre tel qu'affiché (RechercheReglagesTests vérifie qu'il est dans l'index).
    func repere(_ ancre: String, dans ecran: EcranReglages = .reglages) -> some View {
        modifier(Repere(ancre: ancre, ecran: ecran))
    }

    /// Le défilement jusqu'à la ligne visée, à poser sur la liste de l'écran.
    func allerAuRepere(_ ecran: EcranReglages) -> some View {
        modifier(AllerAuRepere(ecran: ecran))
    }
}

/// La mise en évidence : un fond orange pâle et un filet à gauche, sans rien
/// déplacer ; VoiceOver se pose sur la ligne.
private struct Repere: ViewModifier {
    let ancre: String
    let ecran: EcranReglages
    @AccessibilityFocusState private var focus: Bool
    @Environment(\.accessibilityReduceMotion) private var reduire

    func body(content: Content) -> some View {
        let vise = RepereReglages.partage.vise(ancre, dans: ecran)
        content
            .background {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Palette.signal.opacity(vise ? 0.14 : 0))
                    .padding(.horizontal, -8)
                    .padding(.vertical, 2)
            }
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(Palette.signal)
                    .frame(width: 3)
                    .padding(.vertical, 8)
                    .offset(x: -8)
                    .opacity(vise ? 1 : 0)
                    .accessibilityHidden(true)
            }
            .animation(reduire ? nil : .easeInOut(duration: 0.3), value: vise)
            .id(RepereReglages.cle(ancre, ecran))
            .accessibilityFocused($focus)
            .onChange(of: vise) { _, v in if v { focus = true } }
            // L'écran s'ouvre alors que la ligne est déjà visée (feuille, page poussée).
            .onAppear { if vise { focus = true } }
    }
}

private struct AllerAuRepere: ViewModifier {
    let ecran: EcranReglages
    @Environment(\.accessibilityReduceMotion) private var reduire

    func body(content: Content) -> some View {
        let jeton = RepereReglages.partage.jeton
        ScrollViewReader { proxy in
            content
                .onChange(of: jeton) { _, _ in defiler(proxy) }
                .onAppear { defiler(proxy) }
        }
    }

    private func defiler(_ proxy: ScrollViewProxy) {
        let r = RepereReglages.partage
        guard let a = r.ancre, r.ecran == ecran else { return }
        let cle = RepereReglages.cle(a, ecran)
        let jeton = r.jeton
        Task { @MainActor in
            // Une fois l'écran posé (feuille qui monte, recherche qui se ferme),
            // puis encore une fois pour une liste qui finit de se charger.
            for attente: UInt64 in [350, 900] {
                try? await Task.sleep(nanoseconds: attente * 1_000_000)
                guard RepereReglages.partage.jeton == jeton else { return }
                withAnimation(reduire ? nil : .easeInOut(duration: 0.35)) { proxy.scrollTo(cle, anchor: .center) }
            }
        }
    }
}

// MARK: - Résultats

/// Ce que montre Réglages pendant une recherche : les réglages trouvés (titre,
/// chemin, sous-titre), ou « Rien ne correspond à … » avec de quoi rebondir.
struct ResultatsReglagesVue: View {
    let resultats: ResultatsReglages
    let choisir: (EntreeReglage) -> Void
    let suggerer: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let titre = resultats.titreVide {
                    vide(titre)
                } else {
                    if let t = resultats.enTete {
                        Text(t)
                            .font(Police.texte(13, .medium))
                            .foregroundStyle(Palette.encre3)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 12)
                            .padding(.bottom, 2)
                            .accessibilityAddTraits(.isHeader)
                    }
                    ForEach(resultats.entrees) { e in ligne(e) }
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.immediately)
        .background(Palette.fond)
    }

    private func ligne(_ e: EntreeReglage) -> some View {
        Button { choisir(e) } label: {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: e.symbole)
                    .font(.system(size: 18))
                    .frame(width: 26)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 3) {
                    Text(e.titre)
                        .font(Police.texte(16, .medium))
                        .foregroundStyle(Palette.encre)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(e.chemin)
                        .font(Police.texte(12, .medium))
                        .foregroundStyle(Palette.encre3)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(e.sousTitre)
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Image(systemName: e.ecran == .iphone ? "arrow.up.forward.app" : "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.encre3)
                    .padding(.top, 4)
            }
            .foregroundStyle(Palette.encre)
            .padding(.vertical, 10)
            .frame(minHeight: 60)
            .overlay(alignment: .bottom) { Filet() }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(e.titre). \(e.cheminLu). \(e.sousTitre)")
        .accessibilityHint(e.ecran == .iphone ? "Ouvre les réglages de l'iPhone." : "Ouvre ce réglage.")
        .accessibilityIdentifier("recherche.\(e.id)")
    }

    private func vide(_ titre: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 28))
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
            if resultats.indisponibles.isEmpty {
                // Côte à côte s'ils tiennent, sinon (grand texte) l'un sous l'autre.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { suggestions }
                    VStack(alignment: .leading, spacing: 8) { suggestions }
                }
            }
        }
        .padding(.top, 28)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var suggestions: some View {
        ForEach(RechercheReglages.suggestions, id: \.self) { s in
            Button(s) {
                Haptique.leger()
                suggerer(s)
            }
            .buttonStyle(BoutonBrut())
            .accessibilityHint("Cherche « \(s) ».")
        }
    }
}
