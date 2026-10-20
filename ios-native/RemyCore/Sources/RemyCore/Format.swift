import Foundation

/// Tous les formats affichés, en français et à l'heure de Sam.
public enum Format {
    public static var fuseau = TimeZone(identifier: "Europe/Paris") ?? .current
    public static let locale = Locale(identifier: "fr_FR")

    public static var calendrier: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = fuseau
        c.locale = locale
        c.firstWeekday = 2
        c.minimumDaysInFirstWeek = 4
        return c
    }

    private static func formateur(_ gabarit: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = fuseau
        f.dateFormat = gabarit
        return f
    }

    /// « 09:05 »
    public static func heure(_ d: Date) -> String {
        let c = calendrier.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    public static func heure(_ ms: Millis) -> String { heure(ms.date) }

    /// Minutes écoulées depuis minuit (heure de Paris).
    public static func minuteDuJour(_ d: Date) -> Int {
        let c = calendrier.dateComponents([.hour, .minute], from: d)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }

    public static func debutDuJour(_ d: Date) -> Date { calendrier.startOfDay(for: d) }

    /// « mercredi 23 septembre »
    public static func jourLong(_ d: Date) -> String { formateur("EEEE d MMMM").string(from: d) }

    /// « 15 octobre », « 1er novembre »
    public static func jourMois(_ d: Date) -> String {
        let jour = calendrier.component(.day, from: d)
        return (jour == 1 ? "1er" : String(jour)) + " " + formateur("MMMM").string(from: d)
    }

    /// « jeudi »
    public static func jourSemaine(_ d: Date) -> String { formateur("EEEE").string(from: d) }

    /// « 23 sept. »
    public static func jourCourt(_ d: Date) -> String { formateur("d MMM").string(from: d) }

    /// « mer. 23 sept. »
    public static func jourSemaineCourt(_ d: Date) -> String { formateur("EEE d MMM").string(from: d) }

    /// Numéro de semaine ISO (S39).
    public static func semaine(_ d: Date) -> Int { calendrier.component(.weekOfYear, from: d) }

    /// « Bonjour » / « Bon après-midi » / « Bonsoir » / « Bonne nuit »
    public static func salutation(_ d: Date) -> String {
        let h = calendrier.component(.hour, from: d)
        return h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir"
    }

    /// « dans 25 min », « dans 1 h 05 », « maintenant »
    public static func dansCombien(_ secondes: TimeInterval) -> String {
        let min = max(0, Int((secondes / 60).rounded()))
        if min < 1 { return "maintenant" }
        if min < 60 { return "dans \(min) min" }
        let h = min / 60, r = min % 60
        return r == 0 ? "dans \(h) h" : String(format: "dans %d h %02d", h, r)
    }

    /// « 0,12 $ », « < 0,01 $ », « 0 $ »
    public static func usd(_ v: Double) -> String {
        if v == 0 { return "0 $" }
        if v > 0 && v < 0.01 { return "< 0,01 $" }
        return String(format: "%.2f", v).replacingOccurrences(of: ".", with: ",") + " $"
    }

    /// « 2 h 50 », « 40 min »
    public static func duree(minutes: Int) -> String {
        let m = max(0, minutes)
        if m < 60 { return "\(m) min" }
        let h = m / 60, r = m % 60
        return r == 0 ? "\(h) h" : String(format: "%d h %02d", h, r)
    }

    /// « 1 240 » (espace fine insécable, comme en français)
    public static func entier(_ n: Int) -> String {
        let f = NumberFormatter()
        f.locale = locale
        f.numberStyle = .decimal
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }

    /// Depuis quand date une copie : « de 10:40 », « d'hier, 18:02 », « du 13 oct., 18:02 ».
    public static func depuis(_ d: Date, maintenant: Date = Date()) -> String {
        let debut = debutDuJour(maintenant)
        if d >= debut { return "de " + heure(d) }
        if d >= debut.addingTimeInterval(-86_400) { return "d'hier, " + heure(d) }
        return "du " + jourCourt(d) + ", " + heure(d)
    }

    /// Pour la liste des conversations : l'heure aujourd'hui, « Hier », sinon la date.
    public static func relatif(_ ms: Millis?, maintenant: Date = Date()) -> String {
        guard let ms else { return "" }
        let d = ms.date
        let debut = debutDuJour(maintenant)
        if d >= debut { return heure(d) }
        if d >= debut.addingTimeInterval(-86_400) { return "Hier" }
        return jourCourt(d)
    }

    /// Date d'échéance d'une proposition (« lun. 28 sept., 10:40 »).
    public static func echeance(_ iso: String?) -> String? {
        guard let iso, let d = dateISO(iso) else { return nil }
        return formateur("EEE d MMM").string(from: d) + ", " + heure(d)
    }

    public static func dateISO(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withFullDate]
        return f.date(from: s)
    }

    /// Le détail d'une action proposée, en mots de tous les jours.
    /// Tâche : « avant le mar. 29 sept. à 13:00 · 2 h · important ».
    /// Rendez-vous : « mar. 29 sept. à 10:30 · Cabinet Voltaire ».
    /// L'heure d'une échéance est omise quand c'est une fin de journée (≥ 20 h
    /// ou < 5 h) : « avant 23:59 » n'apprend rien, « avant 13:00 » si.
    public static func detailAction(_ a: ActionProposee, versAgenda: Bool = false) -> String {
        var bits: [String] = []
        if let s = a.debut, let d = dateISO(s) {
            bits.append(formateur("EEE d MMM").string(from: d) + " à " + heure(d))
        }
        if let l = a.lieu, !l.isEmpty { bits.append(l) }
        if !versAgenda, let s = a.echeance, let d = dateISO(s) {
            let h = calendrier.component(.hour, from: d)
            let jour = formateur("EEE d MMM").string(from: d)
            bits.append(h >= 20 || h < 5 || s.count <= 10 ? "avant le \(jour)" : "avant le \(jour) à \(heure(d))")
        }
        if let du = a.duree?.texte.uppercased(), !du.isEmpty {
            switch du {
            case "NONE": break
            case "REMINDER": bits.append("simple rappel")
            default:
                if let n = Int(du) { bits.append(duree(minutes: n)) } else { bits.append(du.lowercased()) }
            }
        }
        switch a.priorite?.uppercased() {
        case "ASAP": bits.append("urgent")
        case "HIGH": bits.append("important")
        default: break
        }
        return bits.joined(separator: " · ")
    }

    /// Titre de page : « Jeudi 24 septembre ».
    public static func jourTitre(_ d: Date) -> String {
        let t = jourLong(d)
        return t.prefix(1).uppercased() + t.dropFirst()
    }

    /// Date des titres de fils, identique au site : « 24/09/2026 ».
    public static func dateFil(_ d: Date) -> String { formateur("dd/MM/yyyy").string(from: d) }

    /// « 2026-09-24 » : le jour tel que le serveur l'écrit (journee.jour).
    public static func jourISO(_ d: Date) -> String { formateur("yyyy-MM-dd").string(from: d) }

    /// « 2026-10-10T23:00:00+02:00 » : une échéance avec le décalage de Sam,
    /// jamais en UTC (« 17 h » devenait 19 h — DECISIONS, 08/10).
    public static func isoAvecFuseau(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.timeZone = calendrier.timeZone
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: d)
    }

    /// L'échéance « dans N jours » : ce jour-là à 23 h. Motion place alors la
    /// tâche où elle rentre avant, dans les horaires de travail.
    public static func echeanceDans(jours: Int, depuis d: Date = Date()) -> Date {
        let debut = calendrier.startOfDay(for: d)
        let jour = calendrier.date(byAdding: .day, value: jours, to: debut) ?? debut
        return calendrier.date(bySettingHour: 23, minute: 0, second: 0, of: jour) ?? jour
    }

    /// « sonnet-5 · 0,01 $ » sous une réponse de Rémy.
    public static func puceModele(model: String?, tier: String?, usd valeur: Double?) -> String? {
        guard let model else { return nil }
        var court = model.replacingOccurrences(of: "claude-", with: "")
        if let r = court.range(of: #"-\d{8}$"#, options: .regularExpression) { court.removeSubrange(r) }
        var label = court
        if let tier, !["fixe", "local"].contains(tier) { label = "\(tier) · \(court)" }
        if let valeur { label += " · " + usd(valeur) }
        return label
    }
}
