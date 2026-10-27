import Foundation

/// Repère une date ou une heure dans une phrase française, sans réseau ni IA
/// (spec §5, plan §5.8) : « Appeler le garage demain à 9h » → demain 9:00,
/// reste « Appeler le garage ». Une date seule tombe à 9:00 ; une heure seule
/// déjà passée tombe le lendemain. Les échéances larges (25/10) : « cette
/// semaine » va jusqu'au dimanche, « fin octobre » au dernier jour du mois,
/// « avant le 3 » à la veille ; un flou (« début novembre ») n'est jamais une date.
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
    /// Ce qui mène à une date (« avant », « d'ici », « au plus tard ») : retiré
    /// avec elle. La dictée perd parfois l'apostrophe (« d ici », « jusqu a »).
    static let motifAvant = #"(?:avant|pour|d['’ ]\s*ici|jusqu['’ ]\s*(?:à|a)|au\s+plus\s+tard)"#
    /// Ce qui mène à une échéance large (« d'ici la fin du mois », « pour
    /// la fin de la semaine ») : retiré avec elle.
    static let motifLien = #"(?:"# + motifAvant + #"\s+)?(?:(?:à\s+)?la\s+|en\s+)?"#
    /// « cette semaine », « d'ici la fin de la semaine », « la semaine
    /// prochaine » : jusqu'au dimanche (25/10). « la semaine » seule n'en est
    /// pas une (« le menu de la semaine »).
    static let motifSemaine = #"\b"# + motifLien
        + #"(?:fin\s+de\s+(?:la\s+)?semaine(?:\s+prochaine)?|cette\s+semaine|dans\s+la\s+semaine(?:\s+prochaine)?|semaine\s+prochaine)\b"#
    /// « début / milieu / mi- / courant (de la) semaine (prochaine) » : un flou,
    /// jamais une date (le dimanche tomberait APRÈS la période voulue).
    static let motifSemaineFloue = #"\b(?:d[ée]but|milieu|courant|mi)\s*(?:-|de\s+|du\s+)?(?:la\s+)?semaine"#
    /// « fin octobre », « fin du mois », « avant la fin du mois prochain » :
    /// le dernier jour du mois. « début novembre » reste un flou, jamais une date.
    static let motifFinMois = #"\b"# + motifLien + #"fin\s+(?:(du\s+mois(?:\s+prochain)?|de\s+(?:ce\s+)?mois)|(?:d['’]\s*|de\s+)?"#
        + motifMois + #"(?:\s+(20\d{2})\b)?)"#
    /// Devant une date dite (« avant le 12/11 », « d'ici le 3 novembre »).
    static let motifPrefixeDate = #"(avant|pour|d['’ ]\s*ici|jusqu['’ ]\s*au|au\s+plus\s+tard)"#
    /// « avant le 3 », « pour le 3 », « d'ici le 3 », « jusqu'au 3 », « le 3 »,
    /// « le 20 du mois prochain » : un numéro de jour, sans mois (« le 5 du
    /// mois », chaque mois, n'en est pas un). Pas « le 3e »,
    /// « le 3h », « le 2 pièces », « le 10 km », « le 5 à 7 », « le 3.2 » ; un
    /// point ou une virgule juste après (« avant le 3. », Whisper ponctue) n'y
    /// change rien.
    static let motifNumeroJour = #"\b(?:(avant|pour|d['’ ]\s*ici|au\s+plus\s+tard)\s+le|(jusqu['’ ]\s*au)|(le))\s+(\d{1,2})(?:er)?"#
        + #"(\s+du\s+mois\s+(prochain))?(?![\p{L}\d/:%€]|[.,]\d)"#
        + #"(?!\s*(?:h|heures?|min(?:utes?)?|mn|ans?|jours?|mois|semaines?|fois|pi[eè]ces?|euros?|€|%|km|kg|m|cm|personnes?|places?)(?![\p{L}]))"#
        + #"(?!\s*(?:à|a)\s*\d{1,2}(?![\d:h])(?!\s*(?:h|heures?)(?![\p{L}])))"#
    /// Une phrase qui commence par une demande de rappel (« Rappelle-moi le 3
    /// d'appeler Hugo ») : « le 3 » s'y lit aussi devant « de / d' ».
    static let motifFormuleRappel = #"^\s*(?:(?:tu\s+peux\s+|peux[- ]tu\s+)?(?:me\s+)?rappel|n['’]?\s*oublie\s+pas|fais[- ]moi\s+penser|pense\s+(?:à|a)\s)"#

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
        /// « avant le 3 » : la veille, posée plus bas si aucune heure n'est dite.
        var avantStrict = false
        func estAvant(_ prefixe: String?) -> Bool { prefixe?.lowercased() == "avant" }
        let premierDuMois = cal.date(from: cal.dateComponents([.year, .month], from: debut)) ?? debut
        /// « le 3 » seul ne se lit qu'en fin de phrase, devant une heure ou un
        /// moment (« Payer le loyer le 5 », « le 3 à 14h », « le 3 dans la
        /// matinée »), ou devant « d'appeler » après « rappelle-moi » :
        /// « Visiter le 2 pièces » n'est pas une date. Ni « Appeler le 15 » :
        /// un verbe seul, le nombre en était l'objet. « avant / pour / d'ici
        /// le 3 » se lit partout.
        func numeroJour() -> NSTextCheckingResult? {
            guard let re = try? NSRegularExpression(pattern: motifNumeroJour, options: [.caseInsensitive]) else { return nil }
            let formule = cherche(motifFormuleRappel) != nil
            return re.matches(in: t, range: NSRange(t.startIndex..., in: t)).first { m in
                guard groupe(m, 3) != nil else { return true }
                let sans = (t as NSString).replacingCharacters(in: m.range, with: " ")
                let mots = sans.split(whereSeparator: { $0.isWhitespace || ",;:.!?…".contains($0) })
                if mots.count == 1 { return false }
                let suite = #"\s*(?:$|[,.;:!?…)]|(?:à|a|vers|au|dès|matin|soir|apr[eè]s|midi)(?![\p{L}])|dans\s+la\s+(?:matin[ée]e|soir[ée]e)"#
                    + (formule ? #"|d['’ ]|de\s+)"# : ")")
                return chercheA(suite, m.range.location + m.range.length) != nil
            }
        }
        if let m = cherche(#"\b(?:aujourd'hui|aujourd’hui|ce\s+matin|ce\s+soir|cet\s+apr[eè]s[- ]midi|cet\s+aprem)\b"#) {
            let mot = (groupe(m, 0) ?? "").lowercased()
            jour = debut
            if mot.contains("matin") { moment = 9 }
            if mot.contains("soir") { moment = 20 }
            if mot.contains("midi") || mot.contains("aprem") { moment = 14 }
            heure = moment.map { ($0, 0) }
            retirer(m.range)
            if moment == nil { finJour = m.range.location }
        } else if let m = cherche(#"\b(?:"# + motifAvant + #"\s+)?apr[eè]s[- ]demain\b"#) {
            jour = cal.date(byAdding: .day, value: 2, to: debut)
            retirer(m.range)
            finJour = m.range.location
        } else if let m = cherche(#"\b(?:"# + motifAvant + #"\s+)?demain\b"#) {
            jour = cal.date(byAdding: .day, value: 1, to: debut)
            retirer(m.range)
            finJour = m.range.location
        } else if let m = cherche(#"\b(?:"# + motifPrefixeDate + #"\s+)?(?:le\s+)?(?:"# + motifJourSemaine + #"\s+)?(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b"#),
                  let j = groupe(m, 2).flatMap(Int.init), let mo = groupe(m, 3).flatMap(Int.init),
                  (1...31).contains(j), (1...12).contains(mo),
                  let d = date(jour: j, mois: mo, annee: groupe(m, 4).flatMap(Int.init), apres: debut, cal: cal) {
            jour = d
            avantStrict = estAvant(groupe(m, 1))
            retirer(m.range)
            finJour = m.range.location
        } else if let m = cherche(#"\b(?:"# + motifPrefixeDate + #"\s+)?(?:le\s+)?(?:"# + motifJourSemaine + #"\s+)?(\d{1,2})(?:er)?\s+"# + motifMois + #"(?:\s+(20\d{2})\b)?"#),
                  let j = groupe(m, 2).flatMap(Int.init), let mo = groupe(m, 3).flatMap(numeroMois), (1...31).contains(j),
                  let d = date(jour: j, mois: mo, annee: groupe(m, 4).flatMap(Int.init), apres: debut, cal: cal) {
            jour = d
            avantStrict = estAvant(groupe(m, 1))
            retirer(m.range)
            finJour = m.range.location
        // Un jour de la semaine passe avant « cette semaine » : « jeudi, cette
        // semaine » vise jeudi, et une échéance plus tôt ne fait jamais rater.
        // « avant vendredi » reste vendredi 23 h (et « avant demain », demain) :
        // la veille stricte ne vaut que pour une date chiffrée (« avant le 3 »,
        // décision du 25/10). À trancher par Sam s'il la veut partout.
        } else if let m = cherche(#"\b(?:"# + motifAvant + #"\s+)?(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(\s+prochain)?\b"#),
                  let nom = groupe(m, 1)?.lowercased(), let cible = jours.firstIndex(of: nom) {
            let actuel = cal.component(.weekday, from: maintenant) - 1
            let ecart = (cible - actuel + 7) % 7
            memeJourSemaine = ecart == 0 && groupe(m, 2) == nil
            jour = cal.date(byAdding: .day, value: ecart == 0 && !memeJourSemaine ? 7 : ecart, to: debut)
            retirer(m.range)
            finJour = m.range.location
            // « vendredi de la semaine prochaine » : celui qui suit le lundi qui
            // vient (dit un lundi, « mardi de la semaine prochaine » n'est pas
            // demain). « samedi, cette semaine » : samedi, les mots partent avec.
            if let s = chercheA(#"\s*,?\s*(?:de\s+)?(?:(cette)\s+semaine|(?:la\s+)?semaine\s+prochaine)\b"#, m.range.location) {
                if groupe(s, 1) == nil, let j = jour {
                    let versLundi = (2 - cal.component(.weekday, from: debut) + 7) % 7
                    if let lundi = cal.date(byAdding: .day, value: versLundi == 0 ? 7 : versLundi, to: debut), j < lundi {
                        jour = cal.date(byAdding: .day, value: 7, to: j)
                    }
                    memeJourSemaine = false
                }
                retirer(s.range)
            }
        } else if cherche(motifSemaineFloue) == nil, let m = cherche(motifSemaine) {
            // Jusqu'au dimanche de cette semaine (lundi → dimanche), ou de la suivante.
            let ecart = (1 - cal.component(.weekday, from: debut) + 7) % 7
            let prochaine = (groupe(m, 0) ?? "").lowercased().contains("prochaine")
            jour = cal.date(byAdding: .day, value: ecart + (prochaine ? 7 : 0), to: debut)
            retirer(m.range)
        } else if let m = cherche(motifFinMois) {
            // Le mois dit, sinon celui-ci (ou le suivant) ; un mois passé : l'an prochain.
            var mois: Date?
            if let dit = groupe(m, 1) {
                mois = cal.date(byAdding: .month, value: dit.lowercased().contains("prochain") ? 1 : 0, to: premierDuMois)
            } else if let mo = groupe(m, 2).flatMap(numeroMois) {
                var c = DateComponents()
                c.year = groupe(m, 3).flatMap(Int.init) ?? cal.component(.year, from: debut)
                c.month = mo
                c.day = 1
                mois = cal.date(from: c)
                if groupe(m, 3) == nil, let x = mois, x < premierDuMois { mois = cal.date(byAdding: .year, value: 1, to: x) }
            }
            if let mois, let fin = cal.date(byAdding: DateComponents(month: 1, day: -1), to: mois) {
                jour = fin
                retirer(m.range)
            }
        } else if let m = numeroJour(), let n = groupe(m, 4).flatMap(Int.init),
                  // « le 20 du mois prochain » : le 20 du mois qui suit, pas celui-ci.
                  let depuis = groupe(m, 6) != nil ? cal.date(byAdding: .month, value: 1, to: premierDuMois) : debut,
                  let d = prochain(jour: n, apres: depuis, cal: cal) {
            jour = d
            avantStrict = estAvant(groupe(m, 1))
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
        // « avant le 3 » sans heure : la veille. « Avant » est strict, et une
        // échéance plus tôt ne fait jamais rater (25/10). Une heure ou un moment
        // dits (« avant le 3 à 14h », « avant le 3 au soir ») fixent déjà la
        // borne : le 3, à cette heure. La veille déjà passée (« avant le 3 »,
        // dit le 3) : aujourd'hui, jamais une date passée.
        if avantStrict, heure == nil, let j = jour, let v = cal.date(byAdding: .day, value: -1, to: j) { jour = max(v, debut) }

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
            var q = memeJourSemaine && d <= maintenant ? cal.date(byAdding: .day, value: 7, to: d) ?? d : d
            // Un jour sans heure qui tombe aujourd'hui, 9 h passé (« cette
            // semaine » dit un dimanche, « avant le 3 » dit le 2) : le rappel
            // sonne à la prochaine heure pleine. Posé à 9 h, il ne sonnerait
            // jamais. L'échéance d'une tâche, elle, reste la fin du jour.
            if heure == nil, q <= maintenant, cal.isDate(jour, inSameDayAs: maintenant) {
                let h = cal.component(.hour, from: maintenant)
                q = (h < 23 ? cal.date(bySettingHour: h + 1, minute: 0, second: 0, of: maintenant) : nil) ?? maintenant.addingTimeInterval(600)
            }
            quand = q
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

    /// Le prochain « 3 » à venir, aujourd'hui compris : ce mois-ci s'il n'est
    /// pas passé, sinon le premier mois suivant qui a ce jour (« le 31 »).
    static func prochain(jour n: Int, apres debut: Date, cal: Calendar) -> Date? {
        guard (1...31).contains(n), let premier = cal.date(from: cal.dateComponents([.year, .month], from: debut)) else { return nil }
        for k in 0..<13 {
            guard let mois = cal.date(byAdding: .month, value: k, to: premier),
                  let d = cal.date(byAdding: .day, value: n - 1, to: mois),
                  cal.component(.month, from: d) == cal.component(.month, from: mois), d >= debut else { continue }
            return d
        }
        return nil
    }

    /// Les restes de liaison (« à », « le », virgules) autour des mots retirés,
    /// puis la formule de demande (« rappelle-moi de… »).
    static func nettoyer(_ t: String) -> String {
        var s = t.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+,"#, with: ",", options: .regularExpression)
        // Le point final (« Envoyer le devis vendredi. ») ne reste pas seul.
        s = s.replacingOccurrences(of: #"\s*[.!…]+\s*$"#, with: "", options: .regularExpression)
        // « … avant vendredi », « … d'ici lundi » : la date partie, le lien aussi.
        s = s.replacingOccurrences(of: #"(?i)\s(?:à|a|le|pour|vers|avant|d['’ ]\s*ici|au\s+plus\s+tard|jusqu['’ ]\s*(?:à|a|au)?|,)\s*$"#,
                                   with: "", options: .regularExpression)
        // En tête, seulement les liaisons : « Avant vendredi, … » part avec la
        // date (son lien est dans la plage retirée) ; « Avant la réunion, … »
        // garde son « Avant ».
        s = s.replacingOccurrences(of: #"(?i)^\s*(?:à|le|pour|,)\s"#, with: "", options: .regularExpression)
        return sansFormule(s.trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ",;:-."))))
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
