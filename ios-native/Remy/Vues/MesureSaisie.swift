import SwiftUI
import UIKit

/// Mesure de la frappe (CI seulement, REMY_DEMO_ECRAN=perf-saisie) — Sam,
/// 18/10 : « les touches mettent longtemps à s'afficher », après une dictée de
/// deux minutes. On tape pour de vrai (insertText sur le champ qui a le
/// clavier, comme le clavier de l'iPhone) une lettre par image, et on mesure
/// l'écart entre deux images : 16,7 ms quand tout suit, plus quand la frappe
/// bloque l'écran. Trois cas : le champ SwiftUI avec un texte court, le même
/// avec un texte de dictée (≈ 2 min), et le champ UIKit avec ce même texte.
struct MesureSaisie: View {
    enum Cas: String, CaseIterable, Identifiable {
        case swiftUICourt = "TextField SwiftUI · texte court"
        case swiftUILong = "TextField SwiftUI · dictée de 2 min"
        case uiKitLong = "ChampTexte UIKit · dictée de 2 min"
        var id: String { rawValue }
    }

    static let dictee = String(repeating: "Bon alors pour la démo de jeudi il faut que je cale le rendez-vous avec Hugo, que je relance le comptable et que je pense à réserver la salle. ", count: 14)

    @State private var cas: Cas?
    @State private var texte = ""
    @State private var actif = false
    @FocusState private var focus: Bool
    @State private var resultats: [(Cas, Mesure)] = []
    @State private var fini = false

    struct Mesure {
        var moyenneMs: Double
        var pireMs: Double
        var imagesSautees: Int
        /// Lettres vraiment arrivées dans le champ (preuve que la frappe a eu lieu).
        var arrivees = 0

        var texte: String {
            String(format: "image moyenne %.1f ms · pire %.0f ms · %d images sautées · %d/90 lettres", moyenneMs, pireMs, imagesSautees, arrivees)
        }
    }

    /// Le journal de la CI (stderr : pas de tampon, contrairement à print).
    static func noter(_ ligne: String) {
        FileHandle.standardError.write(Data((ligne + "\n").utf8))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Mesure de la frappe").font(Police.titre(24)).foregroundStyle(Palette.encre)
            Text("Une lettre par image, 90 lettres par cas. \(Self.dictee.count) caractères pour « dictée de 2 min ».")
                .font(Police.texte(13)).foregroundStyle(Palette.encre2)
            ForEach(resultats, id: \.0.id) { c, m in
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.rawValue).font(Police.texte(15, .semibold)).foregroundStyle(Palette.encre)
                    Text(m.texte)
                        .font(Police.mono(13)).foregroundStyle(m.moyenneMs > 25 ? Palette.danger : Palette.encre2)
                }
            }
            if !fini { HStack { ProgressView(); Text(cas?.rawValue ?? "…").font(Police.texte(13)) } }
            Spacer(minLength: 0)
            Group {
                switch cas {
                case .swiftUICourt, .swiftUILong:
                    TextField("Écris à Rémy…", text: $texte, axis: .vertical)
                        .font(Police.texte(16))
                        .lineLimit(1...6)
                        .focused($focus)
                case .uiKitLong:
                    ChampTexte(texte: $texte, actif: $actif, invite: "Écris à Rémy…")
                case nil:
                    Color.clear.frame(height: 20)
                }
            }
            .padding(14)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Palette.fond)
        .task { await toutMesurer() }
    }

    private func toutMesurer() async {
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        for c in Cas.allCases {
            texte = c == .swiftUICourt ? "Bon alors" : Self.dictee
            cas = c
            try? await Task.sleep(nanoseconds: 600_000_000)
            if c == .uiKitLong { actif = true } else { focus = true }
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            let avant = texte.count
            var m = await Frappe().mesurer(lettres: 90)
            m.arrivees = texte.count - avant
            resultats.append((c, m))
            Self.noter("PERF-SAISIE \(c.rawValue) : \(m.texte)")
            focus = false
            actif = false
            cas = nil
            try? await Task.sleep(nanoseconds: 600_000_000)
        }
        fini = true
    }
}

/// Tape une lettre à chaque image dans le champ qui a le clavier, et note
/// l'écart entre les images.
@MainActor
final class Frappe: NSObject {
    private var lien: CADisplayLink?
    private var dernier: CFTimeInterval = 0
    private var ecarts: [Double] = []
    private var reste = 0
    private var fin: CheckedContinuation<MesureSaisie.Mesure, Never>?

    func mesurer(lettres: Int) async -> MesureSaisie.Mesure {
        reste = lettres
        return await withCheckedContinuation { c in
            fin = c
            let l = CADisplayLink(target: self, selector: #selector(image(_:)))
            l.add(to: .main, forMode: .common)
            lien = l
        }
    }

    @objc private func image(_ l: CADisplayLink) {
        if dernier > 0 { ecarts.append((l.timestamp - dernier) * 1000) }
        dernier = l.timestamp
        guard reste > 0 else {
            l.invalidate()
            let periode = l.duration > 0 ? l.duration * 1000 : 16.7
            let moyenne = ecarts.isEmpty ? 0 : ecarts.reduce(0, +) / Double(ecarts.count)
            let sautees = ecarts.reduce(0) { $0 + max(0, Int(($1 / periode).rounded()) - 1) }
            fin?.resume(returning: .init(moyenneMs: moyenne, pireMs: ecarts.max() ?? 0, imagesSautees: sautees))
            fin = nil
            return
        }
        reste -= 1
        (UIResponder.actuel() as? UIKeyInput)?.insertText("a")
    }
}

private extension UIResponder {
    private static weak var trouve: UIResponder?

    /// Le champ qui a le clavier (là où le clavier de l'iPhone écrirait).
    static func actuel() -> UIResponder? {
        trouve = nil
        UIApplication.shared.sendAction(#selector(UIResponder.signaler), to: nil, from: nil, for: nil)
        return trouve
    }

    @objc func signaler() { UIResponder.trouve = self }
}
