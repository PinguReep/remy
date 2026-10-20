import SwiftUI
import UIKit

/// Le champ de saisie des longs textes (composeur de Rémy) : un UITextView qui
/// grandit jusqu'à `lignesMax` lignes, puis défile.
///
/// Pourquoi pas `TextField(axis: .vertical)` : Sam (18/10) — après une dictée
/// de deux minutes, chaque touche mettait longtemps à s'afficher. Le champ
/// SwiftUI repasse tout son texte à chaque frappe ; mesuré en CI (écran
/// « perf-saisie », `MesureSaisie.swift`), avant de remplacer quoi que ce soit.
struct ChampTexte: UIViewRepresentable {
    @Binding var texte: String
    /// Le clavier est-il sur ce champ ? (posé par l'app pour le donner ou le
    /// rendre ; tenu à jour quand Sam touche le champ ou le quitte).
    @Binding var actif: Bool
    var invite: String
    var taille: CGFloat = 16
    var lignesMax: Int = 6
    /// « Corriger la dictée » dans le menu d'une sélection (19/10) : les mots
    /// surlignés, et leur place dans le texte (sans les espaces autour).
    var corriger: ((String, NSRange) -> Void)? = nil

    private var police: UIFont { UIFont(name: "Inter-Regular", size: taille) ?? .systemFont(ofSize: taille) }

    func makeCoordinator() -> Coordinateur { Coordinateur(self) }

    func makeUIView(context: Context) -> UITextView {
        let v = UITextView()
        v.delegate = context.coordinator
        v.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: police)
        v.adjustsFontForContentSizeCategory = true
        v.backgroundColor = .clear
        v.textColor = UIColor(Palette.encre)
        v.tintColor = UIColor(Palette.signal)
        v.textContainerInset = .zero
        v.textContainer.lineFragmentPadding = 0
        v.isScrollEnabled = false
        v.showsVerticalScrollIndicator = false
        v.keyboardDismissMode = .interactive
        v.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        v.text = texte
        let l = UILabel()
        l.font = v.font
        l.adjustsFontForContentSizeCategory = true
        l.textColor = UIColor(Palette.encre3)
        l.text = invite
        l.isHidden = !texte.isEmpty
        l.isAccessibilityElement = false
        l.translatesAutoresizingMaskIntoConstraints = false
        v.addSubview(l)
        NSLayoutConstraint.activate([
            l.leadingAnchor.constraint(equalTo: v.leadingAnchor),
            l.topAnchor.constraint(equalTo: v.topAnchor),
        ])
        v.accessibilityLabel = invite
        context.coordinator.invite = l
        return v
    }

    func updateUIView(_ v: UITextView, context: Context) {
        context.coordinator.parent = self
        // Seulement un texte venu d'ailleurs (dictée, brouillon préparé, envoi) :
        // la frappe, elle, est déjà dans la vue.
        if v.text != texte {
            v.text = texte
            context.coordinator.invite?.isHidden = !texte.isEmpty
        }
        if context.coordinator.invite?.text != invite {
            context.coordinator.invite?.text = invite
            v.accessibilityLabel = invite
        }
        if actif && !v.isFirstResponder {
            DispatchQueue.main.async { if v.window != nil { v.becomeFirstResponder() } }
        } else if !actif && v.isFirstResponder {
            DispatchQueue.main.async { v.resignFirstResponder() }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView v: UITextView, context: Context) -> CGSize? {
        guard let largeur = proposal.width, largeur > 0, largeur.isFinite else { return nil }
        let ligne = (v.font ?? police).lineHeight
        let plafond = ceil(ligne * CGFloat(lignesMax))
        let mesure = v.sizeThatFits(CGSize(width: largeur, height: .greatestFiniteMagnitude)).height
        let defile = mesure > plafond + 1
        if v.isScrollEnabled != defile {
            DispatchQueue.main.async { v.isScrollEnabled = defile }
        }
        return CGSize(width: largeur, height: min(max(mesure, ceil(ligne)), plafond))
    }

    final class Coordinateur: NSObject, UITextViewDelegate {
        var parent: ChampTexte
        weak var invite: UILabel?

        init(_ parent: ChampTexte) { self.parent = parent }

        func textViewDidChange(_ v: UITextView) {
            invite?.isHidden = !v.text.isEmpty
            parent.texte = v.text
        }

        func textViewDidBeginEditing(_ v: UITextView) {
            if !parent.actif { parent.actif = true }
        }

        func textViewDidEndEditing(_ v: UITextView) {
            if parent.actif { parent.actif = false }
        }

        /// Une sélection de quelques mots propose « Corriger la dictée » en premier.
        func textView(_ v: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            guard let corriger = parent.corriger, range.length > 0 else { return nil }
            let texte = v.text as NSString
            guard range.location + range.length <= texte.length else { return nil }
            let brut = texte.substring(with: range)
            let mot = brut.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !mot.isEmpty, mot.count <= 80 else { return nil }
            // La place des seuls mots, sans les espaces sélectionnés autour.
            let debut = (brut as NSString).range(of: mot).location
            let place = NSRange(location: range.location + debut, length: (mot as NSString).length)
            let action = UIAction(title: "Corriger la dictée", image: UIImage(systemName: "waveform")) { _ in
                corriger(mot, place)
            }
            return UIMenu(children: [action] + suggestedActions)
        }
    }
}
