import Foundation

/// La jauge du chat (Sam, 19/10) : « comme le compteur de Claude Code » — la
/// place prise par la conversation dans le contexte du modèle, la vitesse
/// d'écriture de la dernière réponse et la moyenne du fil. Tout vient des
/// mesures de la tour ; ce qui manque est dit, jamais deviné.
public struct JaugeContexte: Equatable, Sendable {
    public struct Debit: Equatable, Sendable {
        public var tps: Double
        public var jetons: Int
        public var secondes: Double
        /// Secondes avant le premier jeton (lecture du contexte par le modèle).
        public var premier: Double?
        /// Jetons estimés d'après les caractères (le modèle n'a pas compté).
        public var estime: Bool
    }

    public enum Niveau: Equatable, Sendable { case calme, attention, plein }

    /// Jetons occupés au dernier appel mesuré.
    public var contexte: Int?
    public var fenetre: Int?
    /// Taille réglée sur la tour (REMY_GLM_CONTEXTE) plutôt que déclarée par le modèle.
    public var fenetreReglee = false
    public var repartition: RepartitionContexte?
    public var derniere: Debit?
    /// Tous les jetons écrits du fil sur tout le temps d'écriture (pondérée).
    public var moyenne: Debit?
    public var reponsesMesurees = 0
    /// Le modèle de la dernière réponse, et la machine qui le sert.
    public var modele: String?
    public var machine: String?

    public var vide: Bool { contexte == nil && derniere == nil && modele == nil }

    public var fraction: Double? {
        guard let c = contexte, let f = fenetre, f > 0 else { return nil }
        return min(1, max(0, Double(c) / Double(f)))
    }

    public var niveau: Niveau {
        guard let x = fraction else { return .calme }
        return x >= 0.9 ? .plein : x >= 0.7 ? .attention : .calme
    }

    public init() {}

    public static func de(_ lignes: [LigneChat]) -> JaugeContexte {
        var j = JaugeContexte()
        let mesurees = lignes.filter { !$0.deToi }.compactMap(\.mesures)
        if let m = mesurees.last(where: { $0.contexte != nil }) {
            j.contexte = m.contexte
            j.fenetre = m.fenetre
            j.fenetreReglee = m.fenetreSource == "reglage"
            j.repartition = m.repartition
        }
        if let m = mesurees.last(where: { $0.modele != nil || $0.machine != nil }) {
            j.modele = m.modele
            j.machine = m.machine
        }
        let debits = mesurees.compactMap(debit(de:))
        j.reponsesMesurees = debits.count
        j.derniere = debits.last
        if !debits.isEmpty {
            let jetons = debits.reduce(0) { $0 + $1.jetons }
            let secondes = debits.reduce(0) { $0 + $1.secondes }
            let premiers = debits.compactMap(\.premier)
            if secondes > 0 {
                j.moyenne = Debit(tps: Double(jetons) / secondes, jetons: jetons, secondes: secondes,
                                  premier: premiers.isEmpty ? nil : premiers.reduce(0, +) / Double(premiers.count),
                                  estime: debits.contains(where: \.estime))
            }
        }
        return j
    }

    static func debit(de m: MesuresReponse) -> Debit? {
        guard let tps = m.tps, tps.isFinite, tps > 0, let jetons = m.jetons, jetons > 0 else { return nil }
        let secondes = m.decodeMs.map { Double($0) / 1000 } ?? Double(jetons) / tps
        return Debit(tps: tps, jetons: jetons, secondes: secondes, premier: m.premierMs.map { Double($0) / 1000 },
                     estime: m.estime == true)
    }

    // MARK: Écriture des nombres (à la française)

    /// « 850 », « 44,2 k », « 128 k »
    public static func jetons(_ n: Int) -> String {
        if n < 1000 { return "\(n)" }
        if n < 100_000 { return virgule(String(format: "%.1f", Double(n) / 1000)) + " k" }
        return "\(Int((Double(n) / 1000).rounded())) k"
    }

    /// « 42 tok/s », « 8,4 tok/s »
    public static func tps(_ x: Double) -> String {
        (x < 10 ? virgule(String(format: "%.1f", x)) : "\(Int(x.rounded()))") + " tok/s"
    }

    /// « 34 % »
    public static func pourcent(_ x: Double) -> String {
        let p = x * 100
        return (p > 0 && p < 1 ? "<1" : "\(Int(p.rounded()))") + " %"
    }

    /// « 2,1 s », « 43 s », « 1 min 05 »
    public static func secondes(_ s: Double) -> String {
        if s < 10 { return virgule(String(format: "%.1f", s)) + " s" }
        let n = Int(s.rounded())
        return n < 60 ? "\(n) s" : String(format: "%d min %02d", n / 60, n % 60)
    }

    private static func virgule(_ s: String) -> String { s.replacingOccurrences(of: ".", with: ",") }
}
