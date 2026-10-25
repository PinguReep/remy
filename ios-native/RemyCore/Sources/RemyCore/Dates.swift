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
        /// Une heure a été dite (« à 9h », « demain soir », « dans 20 min »).
        /// Sinon c'est un jour seul, posé à 9:00 faute de mieux : pour une
        /// tâche, une échéance (`echeance`), jamais un créneau.
        public let heureDite: Bool
        /// L'échéance d'une tâche : l'heure dite, sinon la fin du jour dit
        /// (23 h, comme `Format.echeanceDans`) — Motion la place avant. Elle
        /// part du jour dit, pas du 9 h posé pour un rappel : « vendredi », dit
        /// un vendredi à 10 h, c'est ce soir, pas dans une semaine.
        public let echeance: Date

        public init(quand: Date, reste: String, heureDite: Bool = true, echeance: Date? = nil) {
            self.quand = quand
            self.reste = reste
            self.heureDite = heureDite
            self.echeance = echeance ?? (heureDite ? quand : Format.echeanceDans(jours: 0, depuis: quand))
        }
    }

    static let jours = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"]
    static let mois = ["janvier", "février", "fevrier", "mars", "avril", "mai", "juin", "juillet", "août", "aout",
                       "septembre", "octobre", "novembre", "décembre", "decembre"]
    /// Un mois en toutes lettres ou abrégé (« oct. », « fév »).
    static let motifMois = #"(janv(?:ier|\.)?|f[ée]v(?:rier|r?\.)?|mars|avr(?:il|\.)?|mai|juin|juil(?:let|\.)?|ao[uû]t|sept(?:embre|\.)?|oct(?:obre|\.)?|nov(?:embre|\.)?|d[ée]c(?:embre|\.)?)(?![\p{L}])"#
    static let motifJourSemaine = #"(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)"#
    /// Le moment d'un jour (« demain soir », « lundi après-midi ») : son heure.
    static let motifMoment = #"(matin(?:[ée]e)?|apr[eè]s[- ]midi|aprem|soir(?:[ée]e)?)\b"#

    /// Le numéro d'un mois (« oct. » → 10).
    static func numeroMois(_ nom: String) -> Int? {
        let n = nom.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Format.locale)
        let debuts = ["jan", "fev", "mar", "avr", "mai", "juin", "juil", "aou", "sep", "oct", "nov", "dec"]
        return debuts.firstIndex { n.hasPrefix($0) }.map { $0 + 1 }
    }

    /// L'heure d'un moment de la journée.
    static func heureDuMoment(_ mot: String) -> Int {
        let m = mot.lowercased()
        return m.hasPrefix("matin") ? 9 : m.hasPrefix("soir") ? 20 : 14
    }

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
        /// « demain soir » : l'heure du moment (9, 14 ou 20) ; une heure dite l'emporte.
        var moment: Int?

        func retirer(_ r: NSRange) { t = (t as NSString).replacingCharacters(in: r, with: " ") }
        func cherche(_ motif: String) -> NSTextCheckingResult? {
            let re = try? NSRegularExpression(pattern: motif, options: [.caseInsensitive])
            return re?.firstMatch(in: t, range: NSRange(t.startIndex..., in: t))
        }
        /// Juste à cet endroit (ce qui suit un jour ou une heure retirés).
        func chercheA(_ motif: String, _ position: Int) -> NSTextCheckingResult? {
            let longueur = (t as NSString).length
            guard position <= longueur else { return nil }
            let re = try? NSRegularExpression(pattern: motif, options: [.caseInsensitive])
            return re?.firstMatch(in: t, options: [.anchored], range: NSRange(location: position, length: longueur - position))
        }
        func groupe(_ m: NSTextCheckingResult, _ i: Int) -> String? {
            guard m.range(at: i).location != NSNotFound, let r = Range(m.range(at: i), in: t) else { return nil }
            return String(t[r])
        }
        let debut = cal.startOfDay(for: maintenant)

        // « dans 20 min », « dans 2 heures », « dans 1h30 », « dans 3 jours »,
        // « dans une heure », « dans 2 semaines ».
        if let m = cherche(#"\bdans\s+(\d{1,3}|une?)\s*(?:(h(?:eures?)?)(?:\s*([0-5]\d)(?!\s*(?:h|min)))?|(min(?:ute)?s?|mn)|(jours?)|(semaines?))\b"#),
           let brut = groupe(m, 1)?.lowercased() {
            let n = Int(brut) ?? 1
            let secondes: Int
            if groupe(m, 2) != nil {
                secondes = n * 3600 + (groupe(m, 3).flatMap(Int.init) ?? 0) * 60
            } else if groupe(m, 4) != nil {
                secondes = n * 60
            } else {
                relatifEnJours = true
                secondes = n * 86_400 * (groupe(m, 6) != nil ? 7 : 1)
            }
            relatif = relatifEnJours
                ? cal.date(byAdding: .day, value: secondes / 86_400, to: maintenant)
                : maintenant.addingTimeInterval(TimeInterval(secondes))
            retirer(m.range)
        }

        // Le jour. Une date explicite (« lundi 2 novembre », « le 12/11 »)
        // passe avant le jour de la semaine qui l'accompagne.
        var finJour: Int?
        if let m = cherche(#"\b(?:aujourd'hui|aujourd’hui|ce\s+matin|ce\s+soir|cet\s+apr[eè]s[- ]midi|cet\s+aprem)\b"#) {
            let mot = (groupe(m, 0) ?? "").lowercased()
            jour = debut
            if mot.contains("matin") { moment = 9 }
            if mot.contains("soir") { moment = 20 }
            if mot.contains("midi") || mot.contains("aprem") { moment = 14 }
            heure = moment.map { ($0, 0) }
            retirer(m.range)
            if moment == nil { finJour = m.range.location }
        } else if let m = cherche(#"\bapr[eè]s[- ]demain\b"#) {
            jour = cal.date(byAdding: .day, value: 2, to: debut)
            retirer(m.range)
            finJour = m.range.location
        } else if let m = cherche(#"\bdemain\b"#) {
            jour = cal.date(byAdding: .day, value: 1, to: debut)
            retirer(m.range)
            finJour = m.range.location
        } else if let m = cherche(#"\b(?:le\s+)?(?:"# + motifJourSemaine + #"\s+)?(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b"#),
                  let j = groupe(m, 1).flatMap(Int.init), let mo = groupe(m, 2).flatMap(Int.init),
                  (1...31).contains(j), (1...12).contains(mo),
                  let d = date(jour: j, mois: mo, annee: groupe(m, 3).flatMap(Int.init), apres: debut, cal: cal) {
            jour = d
            retirer(m.range)
            finJour = m.range.location
        } else if let m = cherche(#"\b(?:le\s+)?(?:"# + motifJourSemaine + #"\s+)?(\d{1,2})(?:er)?\s+"# + motifMois + #"(?:\s+(20\d{2})\b)?"#),
                  let j = groupe(m, 1).flatMap(Int.init), let mo = groupe(m, 2).flatMap(numeroMois), (1...31).contains(j),
                  let d = date(jour: j, mois: mo, annee: groupe(m, 3).flatMap(Int.init), apres: debut, cal: cal) {
            jour = d
            retirer(m.range)
            finJour = m.range.location
        } else if let m = cherche(#"\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(\s+prochain)?\b"#),
                  let nom = groupe(m, 1)?.lowercased(), let cible = jours.firstIndex(of: nom) {
            let actuel = cal.component(.weekday, from: maintenant) - 1
            let ecart = (cible - actuel + 7) % 7
            memeJourSemaine = ecart == 0 && groupe(m, 2) == nil
            jour = cal.date(byAdding: .day, value: ecart == 0 && !memeJourSemaine ? 7 : ecart, to: debut)
            retirer(m.range)
            finJour = m.range.location
        }
        // « demain soir », « lundi après-midi », « vendredi dans la matinée ».
        if let p = finJour, let m = chercheA(#"\s*(?:au\s+|le\s+|du\s+|de\s+l['’]\s*|dans\s+la\s+|en\s+)?"# + motifMoment, p),
           let mot = groupe(m, 1) {
            moment = heureDuMoment(mot)
            heure = (moment!, 0)
            retirer(m.range)
        }

        // L'heure : « à 18h30 », « 18 h », « 9h », « 18:30 », « à 14 heures »,
        // « à midi ». Sans « à » ni « vers », « 2h de studio » est une durée ;
        // « a » sans accent aussi (« Hugo a 2h de route »), sauf « a 3h de
        // l'après-midi ».
        let duree = #"\s*d(?:e\s+(?!l['’]\s*apr)|['’])"#
        let apresHeure: Int?
        if let m = cherche(#"\b(?:à|vers)\s+([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b(?!\s*(?:min|jours?))"#)
                ?? cherche(#"\b(?:à|vers)\s+([01]?\d|2[0-3])\s*heures?(?:\s*([0-5]\d)\b)?(?![\p{L}])"#)
                ?? cherche(#"\ba\s+([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b(?!\s*(?:min|jours?)|"# + duree + ")")
                ?? cherche(#"\ba\s+([01]?\d|2[0-3])\s*heures?(?:\s*([0-5]\d)\b)?(?![\p{L}])(?!"# + duree + ")")
                ?? cherche(#"\b([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b(?!\s*(?:min|jours?)|"# + duree + ")"),
           let h = groupe(m, 1).flatMap(Int.init) {
            heure = (h, groupe(m, 2).flatMap(Int.init) ?? 0)
            retirer(m.range)
            apresHeure = m.range.location
        } else if let m = cherche(#"(?:\b(?:à|a|vers)\s+)?(?<![\p{L}-])(?<!apr[eè]s )midi\b"#) {
            heure = (12, 0)
            retirer(m.range)
            apresHeure = nil
        } else {
            apresHeure = nil
        }
        // « à 3h de l'après-midi », « à 8h du soir », « à 9h du matin ».
        if let p = apresHeure, let m = chercheA(#"\s*(?:du\s+|de\s+l['’]\s*)"# + motifMoment, p), let mot = groupe(m, 1) {
            moment = heureDuMoment(mot)
            retirer(m.range)
        }
        // « demain soir à 8h » : 20 h, pas 8 h du matin.
        if let (h, mi) = heure, let moment, moment >= 14, h < 12 { heure = (h + 12, mi) }

        let quand: Date
        var echeance: Date?
        if let relatif {
            // « dans 3 jours à 14h » : ce jour-là, à l'heure dite.
            if relatifEnJours, let (h, mi) = heure, let d = cal.date(bySettingHour: h, minute: mi, second: 0, of: relatif) {
                quand = d
            } else {
                quand = relatif
            }
        } else if let jour {
            let (h, mi) = heure ?? (9, 0)
            guard let d = cal.date(bySettingHour: h, minute: mi, second: 0, of: jour) else { return nil }
            quand = memeJourSemaine && d <= maintenant ? cal.date(byAdding: .day, value: 7, to: d) ?? d : d
            if heure == nil {
                // Un jour sans heure : sa fin (23 h). « vendredi » dit un
                // vendredi soir après 23 h vise la semaine suivante ; un autre
                // jour déjà presque fini (« aujourd'hui » à 23 h 30) garde
                // jusqu'à minuit plutôt qu'une échéance passée.
                var e = Format.echeanceDans(jours: 0, depuis: jour)
                if e <= maintenant {
                    e = memeJourSemaine
                        ? cal.date(byAdding: .day, value: 7, to: e) ?? e
                        : cal.date(bySettingHour: 23, minute: 59, second: 0, of: jour) ?? e
                }
                echeance = e
            }
        } else if let hm = heure {
            guard let d = cal.date(bySettingHour: hm.0, minute: hm.1, second: 0, of: debut) else { return nil }
            quand = d > maintenant ? d : cal.date(byAdding: .day, value: 1, to: d) ?? d
        } else {
            return nil
        }
        let heureDite = heure != nil || (relatif != nil && !relatifEnJours)
        return Resultat(quand: quand, reste: nettoyer(t), heureDite: heureDite, echeance: echeance)
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
        // Le point final (« Envoyer le devis vendredi. ») ne reste pas seul.
        s = s.replacingOccurrences(of: #"\s*[.!…]+\s*$"#, with: "", options: .regularExpression)
        // « … avant vendredi », « … d'ici lundi » : la date partie, le lien aussi.
        s = s.replacingOccurrences(of: #"(?i)\s(?:à|a|le|pour|vers|avant|d['’]ici|,)\s*$"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"(?i)^\s*(?:à|le|pour|,)\s"#, with: "", options: .regularExpression)
        return sansFormule(s.trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ",;:-"))))
    }

    /// Ce qu'il faut faire, sans la façon de le demander : « rappelle-moi
    /// d'aller sur l'ordi » → « Aller sur l'ordi ». Sert aussi sans date.
    public static func sansFormule(_ texte: String) -> String {
        let formules = [
            // En dictée, l'apostrophe manque parfois : « rappelle moi d appeler ».
            #"(?:tu\s+peux\s+|peux[- ]tu\s+)?(?:me\s+)?rappel(?:le|er)?[- ]?(?:moi\s+)?(?:de\s+|d['’]\s*|d\s+(?=[aeiouyhàâéèêîôû])|que\s+|qu['’]\s*)"#,
            #"rappel(?:le)?[- ]moi\s+"#,
            #"rappel\s*:\s*"#,
            #"n['’]?\s*oublie\s+pas\s+(?:de\s+|d['’]\s*|d\s+(?=[aeiouyhàâéèêîôû]))?"#,
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
