import Foundation

/// Repère une date ou une heure dans une phrase française, sans réseau ni IA
/// (spec §5, plan §5.8) : « Appeler le garage demain à 9h » → demain 9:00,
/// reste « Appeler le garage ». Une date seule tombe à 9:00 ; une heure seule
/// déjà passée tombe le lendemain.
public enum AnalyseDate {
    public struct Resultat: Equatable, Sendable {
        public let quand: Date
        /// La phrase sans les mots de date (le texte du rappel).
        public let reste: String
        /// Une heure a été dite (« à 9h », « ce soir », « dans 20 min »).
        /// Sinon c'est un jour seul, posé à 9:00 faute de mieux : pour une
        /// tâche, une échéance (`echeance`), jamais un créneau.
        public let heureDite: Bool

        public init(quand: Date, reste: String, heureDite: Bool = true) {
            self.quand = quand
            self.reste = reste
            self.heureDite = heureDite
        }

        /// L'échéance d'une tâche : l'heure dite, sinon la fin du jour dit
        /// (23 h, comme `Format.echeanceDans`) — Motion la place avant.
        public var echeance: Date {
            heureDite ? quand : Format.echeanceDans(jours: 0, depuis: quand)
        }
    }

    static let jours = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"]
    static let mois = ["janvier", "février", "fevrier", "mars", "avril", "mai", "juin", "juillet", "août", "aout",
                       "septembre", "octobre", "novembre", "décembre", "decembre"]

    public static func extraire(_ texte: String, maintenant: Date = Date()) -> Resultat? {
        let cal = Format.calendrier
        var t = " " + texte + " "
        var jour: Date?
        var heure: (Int, Int)?
        var relatif: Date?
        /// « dans 3 jours » : un jour, pas une heure.
        var relatifEnJours = false
        /// « jeudi » dit un jeudi : aujourd'hui si l'heure n'est pas passée, sinon dans une semaine.
        var memeJourSemaine = false

        func retirer(_ r: NSRange) { t = (t as NSString).replacingCharacters(in: r, with: " ") }
        func cherche(_ motif: String) -> NSTextCheckingResult? {
            let re = try? NSRegularExpression(pattern: motif, options: [.caseInsensitive])
            return re?.firstMatch(in: t, range: NSRange(t.startIndex..., in: t))
        }
        func groupe(_ m: NSTextCheckingResult, _ i: Int) -> String? {
            guard m.range(at: i).location != NSNotFound, let r = Range(m.range(at: i), in: t) else { return nil }
            return String(t[r])
        }
        let debut = cal.startOfDay(for: maintenant)

        // « dans 20 min », « dans 2 heures », « dans 3 jours »
        if let m = cherche(#"\bdans\s+(\d{1,3})\s*(min(?:ute)?s?|h(?:eures?)?|jours?)\b"#),
           let n = groupe(m, 1).flatMap(Int.init), let u = groupe(m, 2)?.lowercased() {
            let secondes = u.hasPrefix("min") ? n * 60 : u.hasPrefix("h") ? n * 3600 : n * 86_400
            relatif = maintenant.addingTimeInterval(TimeInterval(secondes))
            relatifEnJours = u.hasPrefix("j")
            retirer(m.range)
        }

        // Le jour.
        if let m = cherche(#"\b(?:aujourd'hui|aujourd’hui|ce\s+matin|ce\s+soir|cet\s+apr[eè]s[- ]midi|cet\s+aprem)\b"#) {
            let mot = (groupe(m, 0) ?? "").lowercased()
            jour = debut
            if mot.contains("matin") { heure = (9, 0) }
            if mot.contains("soir") { heure = (20, 0) }
            if mot.contains("midi") || mot.contains("aprem") { heure = (14, 0) }
            retirer(m.range)
        } else if let m = cherche(#"\bapr[eè]s[- ]demain\b"#) {
            jour = cal.date(byAdding: .day, value: 2, to: debut)
            retirer(m.range)
        } else if let m = cherche(#"\bdemain\b"#) {
            jour = cal.date(byAdding: .day, value: 1, to: debut)
            retirer(m.range)
        } else if let m = cherche(#"\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(\s+prochain)?\b"#),
                  let nom = groupe(m, 1)?.lowercased(), let cible = jours.firstIndex(of: nom) {
            let actuel = cal.component(.weekday, from: maintenant) - 1
            let ecart = (cible - actuel + 7) % 7
            memeJourSemaine = ecart == 0 && groupe(m, 2) == nil
            jour = cal.date(byAdding: .day, value: ecart == 0 && !memeJourSemaine ? 7 : ecart, to: debut)
            retirer(m.range)
        } else if let m = cherche(#"\b(?:le\s+)?(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b"#),
                  let j = groupe(m, 1).flatMap(Int.init), let mo = groupe(m, 2).flatMap(Int.init),
                  (1...31).contains(j), (1...12).contains(mo) {
            jour = date(jour: j, mois: mo, annee: groupe(m, 3).flatMap(Int.init), apres: debut, cal: cal)
            if jour != nil { retirer(m.range) }
        } else if let m = cherche(#"\b(?:le\s+)?(\d{1,2})(?:er)?\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\b"#),
                  let j = groupe(m, 1).flatMap(Int.init), let nom = groupe(m, 2)?.lowercased() {
            let normal = nom.replacingOccurrences(of: "é", with: "e").replacingOccurrences(of: "û", with: "u")
            let ordre = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"]
            if let mo = ordre.firstIndex(of: normal), (1...31).contains(j) {
                jour = date(jour: j, mois: mo + 1, annee: nil, apres: debut, cal: cal)
                if jour != nil { retirer(m.range) }
            }
        }

        // L'heure : « à 18h30 », « 18 h », « 9h », « 18:30 », « à midi ».
        if let m = cherche(#"(?:\bà\s+)?\b([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b(?!\s*(?:min|jours?))"#),
           let h = groupe(m, 1).flatMap(Int.init) {
            heure = (h, groupe(m, 2).flatMap(Int.init) ?? 0)
            retirer(m.range)
        } else if let m = cherche(#"(?:\bà\s+)?\bmidi\b"#) {
            heure = (12, 0)
            retirer(m.range)
        }

        let quand: Date
        if let relatif {
            quand = relatif
        } else if let jour {
            let (h, mi) = heure ?? (9, 0)
            guard let d = cal.date(bySettingHour: h, minute: mi, second: 0, of: jour) else { return nil }
            quand = memeJourSemaine && d <= maintenant ? cal.date(byAdding: .day, value: 7, to: d) ?? d : d
        } else if let hm = heure {
            guard let d = cal.date(bySettingHour: hm.0, minute: hm.1, second: 0, of: debut) else { return nil }
            quand = d > maintenant ? d : cal.date(byAdding: .day, value: 1, to: d) ?? d
        } else {
            return nil
        }
        return Resultat(quand: quand, reste: nettoyer(t), heureDite: relatif != nil ? !relatifEnJours : heure != nil)
    }

    /// Une date à venir (le 3/02 en décembre : l'an prochain).
    static func date(jour: Int, mois: Int, annee: Int?, apres debut: Date, cal: Calendar) -> Date? {
        var c = DateComponents()
        c.day = jour
        c.month = mois
        if var a = annee {
            if a < 100 { a += 2000 }
            c.year = a
            return cal.date(from: c)
        }
        c.year = cal.component(.year, from: debut)
        guard let d = cal.date(from: c) else { return nil }
        return d < debut ? cal.date(byAdding: .year, value: 1, to: d) : d
    }

    /// Les restes de liaison (« à », « le », virgules) autour des mots retirés,
    /// puis la formule de demande (« rappelle-moi de… »).
    static func nettoyer(_ t: String) -> String {
        var s = t.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        // « … avant vendredi », « … d'ici lundi » : la date partie, le lien aussi.
        s = s.replacingOccurrences(of: #"(?i)\s(?:à|a|le|pour|vers|avant|d['’]ici|,)\s*$"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"(?i)^\s*(?:à|le|pour|,)\s"#, with: "", options: .regularExpression)
        return sansFormule(s.trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ",;:-"))))
    }

    /// Ce qu'il faut faire, sans la façon de le demander : « rappelle-moi
    /// d'aller sur l'ordi » → « Aller sur l'ordi ». Sert aussi sans date.
    public static func sansFormule(_ texte: String) -> String {
        let formules = [
            #"(?:tu\s+peux\s+|peux[- ]tu\s+)?(?:me\s+)?rappel(?:le|er)?[- ]?(?:moi\s+)?(?:de\s+|d['’]\s*|que\s+|qu['’]\s*)"#,
            #"rappel(?:le)?[- ]moi\s+"#,
            #"rappel\s*:\s*"#,
            #"n['’]?\s*oublie\s+pas\s+(?:de\s+|d['’]\s*)?"#,
            #"fais[- ]moi\s+penser\s+(?:à\s+|a\s+)"#,
            #"pense(?:r)?\s+(?:à\s+|a\s+)"#,
            #"(?:il\s+)?faut\s+que\s+(?:je\s+|j['’]\s*)"#,
            #"je\s+dois\s+"#,
        ]
        var s = texte.trimmingCharacters(in: .whitespaces)
        for f in formules {
            let r = s.replacingOccurrences(of: "(?i)^" + f, with: "", options: .regularExpression)
            if r != s { s = r; break }
        }
        s = s.trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ",;:-")))
        guard let premiere = s.first, premiere.isLowercase else { return s.isEmpty ? texte : s }
        return premiere.uppercased() + s.dropFirst()
    }
}
