import Foundation

/// Une capture à plusieurs intentions, analysée par GLM puis VALIDÉE par Sam :
/// chaque élément coché part vers sa vraie place, une seule fois.
///   - tâche → Motion (échéance et durée seulement si dites) ;
///   - rappel → rappel (avec ses étiquettes) ;
///   - contrainte (« dispo limitée samedi ») → rappel ce jour-là : pas de
///     créneau inventé ;
///   - liste → la liste nommée (créée si besoin) ;
///   - note → le dossier « Notes » ;
///   - rendez-vous → l'agenda, seulement si l'heure est connue (sinon refusé) ;
///   - projet → un dossier de Remy (sous le projet ou dossier suggéré).
public struct BilanRangement: Equatable, Sendable {
    public var faits: [String] = []
    public var echecs: [String] = []
    /// Déjà là (Motion, l'agenda, une liste, les rappels) : ni fait, ni raté (24/10).
    public var dejaLa: [String] = []
    /// Les éléments réglés (rangés ou déjà là), par leur clé : un nouveau
    /// « Ranger » ne renvoie que ce qui a raté.
    public var regles: Set<String> = []

    public init(faits: [String] = [], echecs: [String] = [], dejaLa: [String] = []) {
        self.faits = faits
        self.echecs = echecs
        self.dejaLa = dejaLa
    }

    public var phrase: String {
        let deja = dejaLa.joined(separator: " ; ")
        if echecs.isEmpty {
            if faits.isEmpty { return dejaLa.isEmpty ? "Rien à ranger." : "Rien de nouveau, déjà là : \(deja)." }
            let base = faits.count == 1 ? "Rangé : \(faits[0])" : "\(faits.count) éléments rangés"
            return base + (dejaLa.isEmpty ? "." : " ; déjà là : \(deja).")
        }
        if faits.isEmpty && dejaLa.isEmpty { return "Rien n'a été rangé : " + echecs.joined(separator: " ; ") + "." }
        var morceaux: [String] = []
        if !faits.isEmpty { morceaux.append("\(faits.count) rangé\(faits.count > 1 ? "s" : "")") }
        if !dejaLa.isEmpty { morceaux.append((morceaux.isEmpty ? "Déjà là : " : "déjà là : ") + deja) }
        morceaux.append("pas fait : " + echecs.joined(separator: " ; "))
        return morceaux.joined(separator: " ; ") + "."
    }
}

extension ElementCapture {
    /// Où l'élément ira, en mots (récapitulatif avant validation).
    public func destination(agenda: Bool) -> String {
        let date = quand.map { heureConnue == true ? Format.jourSemaineCourt($0.date) + " " + Format.heure($0) : Format.jourSemaineCourt($0.date) }
        switch nature {
        case "tache": return "Tâche Motion" + (date.map { ", avant le \($0)" } ?? "") + (dureeMin.map { ", \(Format.duree(minutes: $0))" } ?? "")
        case "rappel": return "Rappel" + (date.map { " le \($0)" } ?? ", sans date")
        case "contrainte": return "Rappel" + (date.map { " le \($0)" } ?? "") + " (pas de créneau bloqué)"
        case "liste": return "Liste « \(liste ?? "Courses") »" + ((articles?.count ?? 0) > 1 ? " · \(articles!.count) articles" : "")
        case "note": return "Notes (Projets)"
        case "rendez-vous":
            guard let date, heureConnue == true else { return "Rendez-vous : heure manquante" }
            return (agenda ? "Agenda" : "Rappel") + " · \(date)" + (dureeMin.map { ", \(Format.duree(minutes: $0))" } ?? "")
        case "projet": return "Nouveau dossier" + (parent.map { " dans « \($0) »" } ?? "")
        default: return nature
        }
    }

    /// Prêt à partir sans précision de Sam.
    public var pret: Bool {
        if nature == "rendez-vous" { return quand != nil && heureConnue == true }
        return question == nil
    }
}

extension AppModel {
    public func ranger(_ elements: [ElementCapture]) async -> BilanRangement {
        var bilan = BilanRangement()
        let agenda = tableau.donnees?.systeme?.agenda == true
        for e in elements {
            let titre = e.titre.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !titre.isEmpty else { continue }
            let avant = bilan.echecs.count
            defer { if bilan.echecs.count == avant { bilan.regles.insert(e.cle) } }
            switch e.nature {
            case "tache":
                var action = ActionProposee(type: "creer", nom: String(titre.prefix(200)),
                                            echeance: e.quand.map { Format.isoAvecFuseau($0.date) },
                                            duree: e.dureeMin.map { .nombre(Double($0)) })
                action.etiquettes = e.etiquettes
                await ecrire(Proposition(source: "motion", resume: "Capture rangée", actions: [action]), titre, "Motion", &bilan)
            case "rappel", "contrainte":
                if let n = carnet.noterRappel(titre, quand: e.quand?.date, etiquettes: e.etiquettes) {
                    if n.dejaLa { bilan.dejaLa.append("« \(titre) » (rappels)") } else { bilan.faits.append("« \(titre) » (rappel)") }
                } else {
                    bilan.echecs.append("« \(titre) »")
                }
            case "liste":
                let nom = (e.liste?.isEmpty == false ? e.liste! : "Courses")
                let l = carnet.listes.first { $0.nom.compare(nom, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }
                    ?? carnet.creerListe(nom)
                if let l {
                    let n = carnet.noter(e.articles?.isEmpty == false ? e.articles! : [titre], dans: l)
                    if !n.nouveaux.isEmpty { bilan.faits.append("liste « \(l.nom) »") }
                    if !n.dejaLa.isEmpty { bilan.dejaLa.append(n.dejaLa.map { "« \($0) »" }.joined(separator: ", ") + " (liste « \(l.nom) »)") }
                    if n.nouveaux.isEmpty && n.dejaLa.isEmpty { bilan.echecs.append("« \(titre) » (liste)") }
                } else {
                    bilan.echecs.append("« \(titre) » (liste)")
                }
            case "note":
                if let d = await organisation.dossierNotes(), await organisation.ajouterNote(titre, dans: d.id) {
                    bilan.faits.append("« \(titre) » (note)")
                } else {
                    bilan.echecs.append("« \(titre) » (note)")
                }
            case "rendez-vous":
                guard let q = e.quand, e.heureConnue == true else {
                    bilan.echecs.append("« \(titre) » : heure manquante")
                    continue
                }
                if agenda {
                    let action = ActionProposee(type: "creer", titre: String(titre.prefix(200)), debut: Format.isoAvecFuseau(q.date),
                                                duree: .nombre(Double(e.dureeMin ?? 60)))
                    await ecrire(Proposition(source: "agenda", resume: "Capture rangée", actions: [action]), titre, "agenda", &bilan)
                } else if let n = carnet.noterRappel(titre, quand: q.date) {
                    if n.dejaLa { bilan.dejaLa.append("« \(titre) » (rappels)") } else { bilan.faits.append("« \(titre) » (rappel : agenda non branché)") }
                } else {
                    bilan.echecs.append("« \(titre) » (rappel)")
                }
            case "projet":
                let parent = parentPour(e.parent)
                if await organisation.creerDossier(titre, parent: parent) != nil { bilan.faits.append("dossier « \(titre) »") }
                else { bilan.echecs.append("« \(titre) » (dossier)") }
            default:
                bilan.echecs.append("« \(titre) » : nature inconnue")
            }
        }
        if !bilan.faits.isEmpty { await tableau.apresGeste() }
        return bilan
    }

    /// Le nom suggéré par GLM → un projet Motion ou un dossier existant.
    public func parentPour(_ nom: String?) -> String? {
        guard let n = nom?.trimmingCharacters(in: .whitespacesAndNewlines), !n.isEmpty else { return nil }
        let egal = { (x: String) in x.compare(n, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }
        if let d = organisation.dossiers.first(where: { egal($0.nom) }) { return d.id }
        if let p = projets.liste?.projets.first(where: { egal($0.nom) }) { return "motion:" + p.id }
        return nil
    }

    func ecrire(_ p: Proposition, _ titre: String, _ ou: String, _ bilan: inout BilanRangement) async {
        do {
            let r = try await api.appliquer(p, convId: nil, index: nil, idCommande: UUID().uuidString, depuisCapture: true)
            let res = r.results?.first
            if r.toutDejaLa {
                // Déjà là : ni échec, ni haptique d'erreur (24/10).
                bilan.dejaLa.append("« \(titre) » (\(ou))")
            } else if r.vraisEchecs > 0 || (res?.ok == false && res?.estDejaLa != true) {
                bilan.echecs.append("« \(titre) » : \(res?.erreur ?? "refusé par \(ou)")")
            } else {
                bilan.faits.append("« \(titre) » (\(ou))")
            }
        } catch {
            if let e = error as? ErreurAPI, e == .nonConnecte { signaler(e) }
            bilan.echecs.append("« \(titre) » : \((error as? LocalizedError)?.errorDescription ?? "erreur")")
        }
    }
}

/// Étiquette suggérée pour un rappel, sans IA (corrigeable d'un toucher).
public enum EtiquetteDevinee {
    static let indices: [(String, [String])] = [
        ("Voiture", ["garage", "voiture", "controle technique", "contrôle technique", "pneu", "vidange", "twingo", "parking", "carte grise", "permis"]),
        ("Santé", ["medecin", "médecin", "docteur", "dentiste", "pharmacie", "ordonnance", "kine", "kiné", "podologue", "vaccin", "analyse", "mutuelle"]),
        ("Administratif", ["impot", "impôt", "caf", "banque", "declaration", "déclaration", "papiers", "passeport", "carte d'identité", "urssaf", "facture", "loyer", "assurance"]),
        ("Anniversaire", ["anniversaire", "anniv"]),
        ("Famille et amis", ["maman", "papa", "frère", "frere", "sœur", "soeur", "mamie", "papi", "ami"]),
        ("Professionnel", ["client", "devis", "reunion", "réunion", "demo", "démo", "contrat", "associé", "prospect"]),
    ]

    /// L'étiquette existante qui correspond, ou nil.
    public static func pour(_ texte: String, parmi etiquettes: [Etiquette]) -> Etiquette? {
        let t = " " + texte.lowercased() + " "
        for (nom, mots) in indices where mots.contains(where: { t.contains($0) }) {
            if let e = etiquettes.first(where: { $0.nom.compare(nom, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }) { return e }
        }
        return nil
    }
}

extension AppModel {
    /// Des rappels deviennent des tâches Motion (validé par Sam) : chaque
    /// tâche créée retire son rappel ; un échec le laisse en place.
    /// Les rappels à trier, avec les catégories du compte (pastille, tri).
    public var rappelsATraiter: [Rappel] {
        CarnetModel.aTraiter(carnet.rappels, etiquettes: Set(organisation.etiquettes.map(\.id)))
    }

    public func convertirEnTaches(_ rappels: [Rappel]) async -> BilanRangement {
        var bilan = BilanRangement()
        var retires: Set<String> = []
        for r in rappels {
            var action = ActionProposee(type: "creer", nom: String(r.texte.prefix(200)), echeance: r.quand.map { Format.isoAvecFuseau($0.date) })
            action.etiquettes = r.etiquettes
            let avant = bilan.faits.count + bilan.dejaLa.count
            await ecrire(Proposition(source: "motion", resume: "Rappel devenu tâche", actions: [action]), r.texte, "Motion", &bilan)
            // Créée, ou déjà dans Motion : le rappel a fait son travail.
            if bilan.faits.count + bilan.dejaLa.count > avant { retires.insert(r.id) }
        }
        carnet.retirerRappels(retires)
        if !retires.isEmpty { await tableau.apresGeste() }
        return bilan
    }
}
