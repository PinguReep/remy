import SwiftUI
import UIKit

// Les couleurs de l'app (Design.swift, direction « Atelier ») pour les
// extensions : widgets et feuille de partage n'embarquent pas le design de
// l'app. Mêmes valeurs ; à garder en accord avec Palette.

extension Color {
    /// Une couleur qui suit le thème (clair / sombre) de l'iPhone.
    static func teinte(clair: UInt32, sombre: UInt32) -> Color {
        Color(uiColor: UIColor { trait in
            let v = trait.userInterfaceStyle == .dark ? sombre : clair
            return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255,
                           green: CGFloat((v >> 8) & 0xFF) / 255,
                           blue: CGFloat(v & 0xFF) / 255,
                           alpha: 1)
        })
    }
}

enum Teinte {
    static let fond = Color.teinte(clair: 0xF4EFE6, sombre: 0x14120F)
    static let surface = Color.teinte(clair: 0xFFFCF6, sombre: 0x1F1C18)
    static let encre = Color.teinte(clair: 0x221E18, sombre: 0xF3ECE1)
    static let encre2 = Color.teinte(clair: 0x564E43, sombre: 0xC2B9AB)
    static let filet = Color.teinte(clair: 0xE2D8C8, sombre: 0x342F28)
    static let signal = Color.teinte(clair: 0xF2541B, sombre: 0xFF6A33)
    static let surSignal = Color.teinte(clair: 0x221E18, sombre: 0x14120F)
}
