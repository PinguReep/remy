import Foundation
import Observation

// MARK: - Les nouveautés (21/10)
//
// À chaque mise à jour qui apporte une fonction visible, un mini tutoriel de
// deux ou trois pages, une fois, au lancement suivant — jamais par-dessus une
// saisie, et seulement quand la tour connaît la fonction (sinon elle est
// encore cachée). Réglages › Nouveautés garde l'historique pour le revoir.
//
// Une nouvelle fonction = une entrée ici, avec la série suivante
// (CLAUDE.md, Definition of Done).

public struct Nouveaute: Identifiable, Equatable, Sendable {
    public struct Page: Equatable, Sendable {
        public let symbole: String
        public let titre: String
        public let texte: String
    }
    public let id: String
    /// Une série par mise à jour : 1, 2, 3… (pas le numéro de build).
    public let serie: Int
    public let date: String
    public let titre: String
    /// La fonction n'existe que si la tour la connaît.
    public let capacite: String?
    public let pages: [Page]
}

public enum Nouveautes {
    public static let catalogue: [Nouveaute] = [
        Nouveaute(id: "privee-iphone", serie: 4, date: "27 oct.", titre: "Conversation privée sur l'iPhone", capacite: nil, pages: [
            .init(symbole: "lock", titre: "Une conversation qui reste chez toi",
                  texte: "Nouvelle conversation : touche « Privée » au-dessus du champ. Ou touche le titre en haut › « Rendre privée » (sans retour). Le cadenas reste sur la marque de Rémy, en haut."),
            .init(symbole: "lock.shield", titre: "Ce que ça change",
                  texte: "Rien ne part chez Claude : le modèle local de ta tour répond, n'en retient rien dans sa mémoire, et la nuit ne la relit pas. Ni ailleurs, tant que la recherche y reste coupée. Tour éteinte : pas de réponse."),
            .init(symbole: "magnifyingglass", titre: "Et le web ?",
                  texte: "Coupé par défaut. Réglages › Recherche dans les conversations privées : partent alors des questions générales (Rémy, puis la salle blanche), filtrées ; les pages sont lues depuis ta tour."),
        ]),
        Nouveaute(id: "jauge-retour", serie: 4, date: "27 oct.", titre: "La jauge du contexte, de retour", capacite: "jauge-v1", pages: [
            .init(symbole: "gauge.with.dots.needle.33percent", titre: "Visible dès le premier message",
                  texte: "Le cadran en haut du chat montre la place que prend la conversation. Pour le masquer : Réglages › Diagnostic › Jauge du contexte."),
            .init(symbole: "rectangle.compress.vertical", titre: "Le résumé à 70 %",
                  texte: "Touche le cadran : il dit quand Rémy résumera le début du fil (dès 70 %), s'il l'a fait, et « Compacter maintenant » le fait tout de suite. Rien n'est effacé."),
        ]),
        Nouveaute(id: "reglages-recherche", serie: 5, date: "29 oct.", titre: "Chercher dans les réglages", capacite: nil, pages: [
            .init(symbole: "magnifyingglass", titre: "Va droit au réglage",
                  texte: "En haut de Réglages, tape ce que tu cherches : « notif », « jauge », « privé », « Siri »… Touche un résultat : son écran s'ouvre, le réglage mis en évidence."),
        ]),
        Nouveaute(id: "bilan-coucher", serie: 5, date: "29 oct.", titre: "Le bilan, avant de te coucher", capacite: "rituel-v1", pages: [
            .init(symbole: "moon.stars", titre: "22 h 45 par défaut",
                  texte: "Allumé sans heure choisie, le bilan du soir arrive désormais à 22 h 45 (21 h 30 avant). Une heure que tu avais choisie reste la tienne : Réglages › Rendez-vous quotidien."),
        ]),
        Nouveaute(id: "partage", serie: 3, date: "24 oct.", titre: "Partager vers Rémy", capacite: nil, pages: [
            .init(symbole: "square.and.arrow.up", titre: "Depuis n'importe quelle app",
                  texte: "Un texte, un lien, une capture d'écran : Partager › Rémy. Ajoute un mot si tu veux, puis « Envoyer à Rémy » : il le lit, le classe et te dit ce qu'il en a retenu."),
            .init(symbole: "ellipsis.circle", titre: "Rémy n'est pas dans la liste ?",
                  texte: "Fais défiler la rangée d'apps jusqu'à « Plus », touche « Modifier », puis le « + » à côté de Rémy : il passe dans tes favoris, en tête de la feuille de partage."),
            .init(symbole: "text.viewfinder", titre: "Les captures d'écran",
                  texte: "Ton iPhone lit lui-même le texte de l'image ; Rémy n'apprend que de ce texte, avec le modèle local de ta tour. L'image est rangée dans ton coffre (Captures)."),
        ]),
        Nouveaute(id: "hors-app", serie: 3, date: "24 oct.", titre: "Rémy sans ouvrir l'app", capacite: nil, pages: [
            .init(symbole: "timer", titre: "La tâche en cours, partout",
                  texte: "Touche « Commencer » : la tâche reste sur l'écran verrouillé et dans la Dynamic Island, avec « Terminer » et « +15 min ». Réglages › Activité en direct pour la couper."),
            .init(symbole: "square.grid.2x2", titre: "Deux widgets",
                  texte: "Appui long sur l'écran d'accueil › « + » › Rémy : « Maintenant » (ta tâche, puis la suivante) et « Capturer ». Aussi sur l'écran verrouillé, et « Capturer » dans le Centre de contrôle (iOS 18)."),
            .init(symbole: "mic", titre: "Siri et le bouton Action",
                  texte: "« Dis Siri, noter dans Rémy », ou « Que dois-je faire maintenant avec Rémy ? ». Bouton Action : Réglages de l'iPhone › Bouton Action › Raccourci › Rémy › « Capturer avec Rémy »."),
        ]),
        Nouveaute(id: "activite-pc", serie: 3, date: "24 oct.", titre: "Le temps passé sur ton PC", capacite: "activite-pc-v1", pages: [
            .init(symbole: "desktopcomputer", titre: "Ce que tu fais sur ta tour",
                  texte: "Réglages › Activité du PC. ActivityWatch, installé sur la tour, note l'appli au premier plan ; Rémy n'en garde que le temps actif, par appli et par catégorie."),
            .init(symbole: "lock.shield", titre: "Rien ne sort de chez toi",
                  texte: "Les titres de fenêtres ne sont jamais gardés, un site se réduit à son domaine. Coupé par défaut, gardé 90 jours, effaçable d'un geste. Exclus une appli d'un glissement."),
            .init(symbole: "chart.bar", titre: "Des repères pour Rémy",
                  texte: "Le modèle local sait « développement 3 h 10 aujourd'hui » et s'en sert pour t'aider, jamais pour te juger. Claude ne reçoit jamais ces relevés ; avec le secours Claude, il peut lire ce que Rémy t'en a dit."),
        ]),
        Nouveaute(id: "deja-la", serie: 3, date: "24 oct.", titre: "Moins de bruit, rien de perdu", capacite: "deja-la-v1", pages: [
            .init(symbole: "checkmark.seal", titre: "Déjà là n'est pas un échec",
                  texte: "Une tâche déjà dans Motion, un article déjà sur ta liste, un rappel déjà noté : Rémy ne le recrée pas et te le dit, sans alerte. Ta capture se ferme ; ton brouillon reste si tu la fermes avant."),
            .init(symbole: "clock.arrow.circlepath", titre: "Les vieilles propositions",
                  texte: "Une proposition de plus de 7 jours, ou dont la date est passée, est marquée sur sa carte : « Oui » te demande de confirmer, ou d'ajuster la ligne d'abord."),
            .init(symbole: "line.3.horizontal.decrease.circle", titre: "Tout l'historique",
                  texte: "Historique : filtre les échouées, les annulées ou les « déjà là », et « Plus ancien » remonte au-delà des derniers jours. Les articles pris ne bloquent plus jamais une liste."),
        ]),
        Nouveaute(id: "au-pouce", serie: 3, date: "24 oct.", titre: "Plus vite, au pouce", capacite: nil, pages: [
            .init(symbole: "calendar.badge.clock", titre: "Décaler en un toucher",
                  texte: "Touche une tâche, même en retard : « Demain », « Lundi » ou une date, d'un geste, avec « Annuler ». Le panneau se ferme en le glissant vers le bas."),
            .init(symbole: "bell.badge", titre: "Les rappels se reportent",
                  texte: "Touche un rappel : « Dans 1 h », « Ce soir », « Demain 9:00 »… Sur la notification aussi : appuie longuement dessus pour « Fait », « Dans 1 h » ou « Demain »."),
            .init(symbole: "keyboard.chevron.compact.down", titre: "Noter sous le pouce",
                  texte: "Le bouton d'envoi suit le clavier, sous ton pouce."),
        ]),
        Nouveaute(id: "proposition-partielle", serie: 3, date: "24 oct.", titre: "Garder une partie d'une proposition",
                  capacite: "propositions-partielles-v1", pages: [
            .init(symbole: "checklist", titre: "Décoche ce que tu ne veux pas",
                  texte: "Dans une proposition de Rémy, décoche une ligne : seules les lignes cochées partent, et la carte dit ce qui a été écarté."),
        ]),
        Nouveaute(id: "rituel", serie: 3, date: "24 oct.", titre: "Ton rendez-vous quotidien", capacite: "rituel-v1", pages: [
            .init(symbole: "sunrise", titre: "Le matin, trois lignes",
                  texte: "Ce qui compte aujourd'hui, pourquoi, et ce qui est menacé, dans une notification à l'heure que tu choisis. Calculé par ta tour, sans IA. Coupé tant que tu ne l'allumes pas."),
            .init(symbole: "exclamationmark.triangle", titre: "Les échéances menacées",
                  texte: "En haut d'Aujourd'hui : une tâche qui ne tiendra plus son échéance, avant qu'elle soit en retard, avec l'action utile (repousser, ou demander à Rémy)."),
            .init(symbole: "moon.stars", titre: "Le soir, 30 secondes",
                  texte: "Vers 22 h 45, avant de te coucher : fait, glissé, et tout ce qui reste vers demain d'un geste (annulable). Une ligne sur ta journée si tu veux : Rémy la relit la nuit. Réglages › Rendez-vous quotidien."),
        ]),
        Nouveaute(id: "idees", serie: 3, date: "24 oct.", titre: "Tes idées restent des idées", capacite: "dossiers-v1", pages: [
            .init(symbole: "tray.and.arrow.down", titre: "Plus de tâche par erreur",
                  texte: "Une pensée sans action claire va dans « Idées » (Projets), pas dans Motion. « Appeler le garage » reste une tâche. Réglages › Capture pour revenir à l'ancien comportement."),
        ]),
        Nouveaute(id: "semaine", serie: 3, date: "24 oct.", titre: "Demain et les 7 jours", capacite: "semaine-v1", pages: [
            .init(symbole: "calendar.day.timeline.left", titre: "« À l'échelle », à côté de LA SUITE",
                  texte: "Aujourd'hui, Demain ou 7 jours. Demain s'affiche en entier, à l'échelle, avec les mêmes gestes : toucher une tâche ouvre « Gérer »."),
            .init(symbole: "chart.bar.xaxis", titre: "La semaine d'un coup d'œil",
                  texte: "Par jour : les heures prévues contre tes heures libres, les rendez-vous, les échéances, et ce que Motion place trop tard. Lu dans Motion et ton agenda, sans IA."),
            .init(symbole: "wifi.slash", titre: "Même sans réseau",
                  texte: "La dernière vue reçue reste sur l'iPhone, datée. Toucher un jour l'ouvre à l'échelle ; glisse vers la gauche ou la droite pour passer au jour d'à côté."),
        ]),
        Nouveaute(id: "a-trancher", serie: 3, date: "24 oct.", titre: "À trancher, et la revue du dimanche", capacite: "a-trancher-v1", pages: [
            .init(symbole: "tray.2", titre: "Ce qui s'empile, d'un geste",
                  texte: "Cartes en attente, rappels sans date ou en double, articles pris, vieux fils, idées : tout est réuni dans « À trancher », sur Aujourd'hui. Oui, Non, Plus tard… toujours avec « Annuler »."),
            .init(symbole: "calendar.badge.checkmark", titre: "Le dimanche, 10 minutes",
                  texte: "Ta semaine par projet, tes idées, trois décisions pour la suite, et ce que Rémy a remarqué la nuit. Sans IA en plus. Réglages › Revue du dimanche pour la couper."),
            .init(symbole: "arrow.uturn.backward", titre: "De retour après une absence ?",
                  texte: "Après plus de 3 jours, Rémy propose de trier tes retards ligne par ligne : Fait, Demain ou Abandonner."),
        ]),
        Nouveaute(id: "priorites", serie: 3, date: "24 oct.", titre: "Dis à Rémy ce qui compte", capacite: "priorites-v1", pages: [
            .init(symbole: "star", titre: "Tes 3 à 5 priorités",
                  texte: "Réglages › Ce qui compte : écris-les avec leur pourquoi. Le conseil du moment et la réflexion de nuit s'en servent, et un conseil qui sert une priorité le dit."),
            .init(symbole: "clock.badge.exclamationmark", titre: "Ce qui n'a pas bougé",
                  texte: "Sans trace d'activité depuis une semaine, une priorité est marquée « négligée », avec sa dernière trace. Chaque version reste sur ta tour."),
        ]),
        Nouveaute(id: "carnet-remy", serie: 3, date: "24 oct.", titre: "Les courses et les rappels, en parlant", capacite: "carnet-outils-v1", pages: [
            .init(symbole: "cart", titre: "« Ajoute du lait »",
                  texte: "Rémy te propose l'article dans Courses, et « rappelle-moi d'appeler Léa demain à 9 h » devient un rappel qui sonne ici, pas une tâche Motion. Rien n'est écrit avant « Ajouter »."),
        ]),
        Nouveaute(id: "propositions-notif", serie: 3, date: "24 oct.", titre: "Oui ou Plus tard, depuis la notification", capacite: "propositions-attente-v1", pages: [
            .init(symbole: "bell.badge", titre: "Les propositions viennent à toi",
                  texte: "Les tâches proposées par tes règles et les sujets de plus pour la nuit arrivent en notification. Appui long : « Oui » l'applique, « Plus tard » la ramène dans 3 h."),
        ]),
        Nouveaute(id: "fil-du-jour", serie: 3, date: "24 oct.", titre: "Plus léger au quotidien", capacite: nil, pages: [
            .init(symbole: "sun.horizon", titre: "Rémy s'ouvre sur ta journée",
                  texte: "Le fil d'hier ne reste plus ouvert : l'onglet Rémy repart sur un écran neuf, et « Reprendre » rouvre le dernier fil d'un geste. Les échanges d'un seul message de plus de 14 jours sont repliés dans la liste."),
            .init(symbole: "chart.bar", titre: "Ce que tu utilises vraiment",
                  texte: "Réglages › Ce que tu utilises vraiment : les gestes que tu fais le plus, et ceux que tu ne touches jamais. Compté sur cet iPhone, sans aucun contenu, et rien ne part."),
        ]),
        Nouveaute(id: "capture-hors-ligne", serie: 3, date: "25 oct.", titre: "Noté sans réseau, envoyé ensuite", capacite: nil, pages: [
            .init(symbole: "tray.and.arrow.up", titre: "Rien ne se perd",
                  texte: "Sans réseau, une tâche, une idée, « Retenir » ou un dossier noté avec le « + » attend sur l'iPhone, tel que tu l'as écrit, et part dès que Rémy répond. Une seule fois : jamais deux tâches dans Motion."),
            .init(symbole: "list.bullet", titre: "« En attente d'envoi »",
                  texte: "En haut d'Aujourd'hui, la ligne « 1 en attente d'envoi » : touche-la pour voir ce qui attend, l'envoyer tout de suite ou le retirer. Un refus de Motion y reste, avec sa raison."),
            .init(symbole: "calendar", titre: "Des échéances comprises",
                  texte: "« cette semaine » : jusqu'à dimanche soir. « fin octobre » : le 31. « début novembre » : le 5. « avant le 3 », « avant mardi » : la veille au soir. Un flou comme « mi-novembre » reste dans le titre."),
        ]),
        Nouveaute(id: "recherche-web", serie: 3, date: "25 oct.", titre: "Rémy cherche sur le web", capacite: "recherche-locale-v1", pages: [
            .init(symbole: "globe", titre: "Lui-même, sans Claude",
                  texte: "Une question récente, chiffrée ou réglementaire : Rémy cherche sur le web (DuckDuckGo) et lit les pages, avec le modèle de ta tour. Plus de carte « Tu autorises ? », rien ne part chez Claude."),
            .init(symbole: "checkmark.shield", titre: "Ses sources, et ce qui reste à vérifier",
                  texte: "Il cite le site, le lien et la date. Un chiffre qu'aucune page lue ne contient est signalé « à vérifier ». Une conversation privée ne cherche pas, sauf permission."),
            .init(symbole: "switch.2", titre: "À ta main",
                  texte: "Réglages › Recherche web pour la couper : Rémy répond alors sans le web."),
        ]),
        Nouveaute(id: "modele", serie: 2, date: "21 oct.", titre: "Choisis le modèle de Rémy", capacite: "modeles-v1", pages: [
            .init(symbole: "cpu", titre: "Rémy suit tes Sparks",
                  texte: "Quand tu charges un autre modèle sur tes Sparks, Rémy le suit tout seul. Son nom s'affiche sous chaque réponse et dans la jauge."),
            .init(symbole: "slider.horizontal.3", titre: "Ou fixe-le toi-même",
                  texte: "Réglages › Modèle : garde « Automatique », ou choisis un modèle parmi ceux que tes Sparks servent. Claude n'est pas dans la liste : tes conversations restent chez toi."),
        ]),
        Nouveaute(id: "lieux", serie: 2, date: "21 oct.", titre: "Rémy sait où tu en es", capacite: "lieux-v1", pages: [
            .init(symbole: "location", titre: "Coupée tant que tu ne l'allumes pas",
                  texte: "Réglages › Localisation. iOS détecte tes arrivées et départs presque sans batterie : choisis « Toujours » quand il te le demande."),
            .init(symbole: "storefront", titre: "Le coiffeur, le drive, la salle",
                  texte: "Les adresses et les commerces sont reconnus sur ta tour : « sans doute Salon Lumière (coiffeur) ». Aucune position ne part ailleurs."),
            .init(symbole: "mappin.and.ellipse", titre: "Nomme tes lieux",
                  texte: "Touche un lieu pour le nommer. « Pause 2 h » n'enregistre rien, et tout s'efface d'un geste. Gardé 90 jours, puis effacé."),
        ]),
        Nouveaute(id: "jauge", serie: 1, date: "20 oct.", titre: "La jauge du contexte", capacite: "jauge-v1", pages: [
            .init(symbole: "gauge.with.dots.needle.33percent", titre: "Ce que Rémy a en tête",
                  texte: "Le cadran, en haut du chat, montre la place prise dans la mémoire de travail du modèle. Les tokens par seconde s'affichent pendant qu'il écrit."),
            .init(symbole: "hand.tap", titre: "Touche-le",
                  texte: "La place prise et d'où elle vient, la vitesse de la dernière réponse, la moyenne du fil, et le modèle qui a répondu."),
        ]),
        Nouveaute(id: "compactage", serie: 1, date: "20 oct.", titre: "Les longues conversations se compactent", capacite: "compactage-v1", pages: [
            .init(symbole: "rectangle.compress.vertical", titre: "Rien n'est effacé",
                  texte: "Dès 70 % du contexte, le modèle local résume le début du fil pour continuer. À la demande aussi, depuis la jauge."),
        ]),
        Nouveaute(id: "regles", serie: 1, date: "20 oct.", titre: "Les règles de Rémy", capacite: "regles-v1", pages: [
            .init(symbole: "arrow.triangle.branch", titre: "Avant X, fais Y",
                  texte: "Dis-lui « avant une sortie, propose-moi de me raser » : il te propose une règle. Ensuite, il relit ton agenda et te propose la tâche — jamais sans ton « Oui »."),
        ]),
        Nouveaute(id: "selection", serie: 1, date: "20 oct.", titre: "Sélectionner du texte", capacite: nil, pages: [
            .init(symbole: "text.cursor", titre: "Appui long sur une bulle",
                  texte: "« Sélectionner le texte » : la vraie sélection d'iOS, sur tes messages comme sur ceux de Rémy. Une erreur montre son code et « Copier le diagnostic »."),
        ]),
    ]

    /// Au plus, pour ne pas transformer une mise à jour en cours magistral.
    static let pagesMax = 6

    /// Ce qu'une feuille montre : des entrées entières, dans l'ordre, tant
    /// qu'elles tiennent dans `pagesMax` pages — au moins une. Jamais une
    /// entrée coupée ; les suivantes attendent les lancements suivants.
    static func lot(_ entrees: [Nouveaute], pagesMax: Int = pagesMax) -> [Nouveaute] {
        var pris: [Nouveaute] = []
        var pages = 0
        for n in entrees {
            if !pris.isEmpty && pages + n.pages.count > pagesMax { break }
            pris.append(n)
            pages += n.pages.count
        }
        return pris
    }
}

/// Les nouveautés à montrer d'un coup (une feuille), dans l'ordre.
public struct LotNouveautes: Identifiable, Equatable, Sendable {
    public let id: String
    public let entrees: [Nouveaute]
    /// Toutes les pages de ses entrées : la limite se prend à la
    /// composition du lot (`Nouveautes.lot`), jamais au milieu d'une entrée.
    public var pages: [(nouveaute: Nouveaute, page: Nouveaute.Page)] {
        entrees.flatMap { n in n.pages.map { (n, $0) } }
    }
    /// Les entrées dont au moins une page a été affichée, la feuille ayant
    /// atteint la page `index` (0 : la première).
    public func entrees(jusqua index: Int) -> [Nouveaute] {
        var debut = 0
        return entrees.filter { n in
            defer { debut += n.pages.count }
            return debut <= index
        }
    }
    public static func == (a: LotNouveautes, b: LotNouveautes) -> Bool { a.id == b.id && a.entrees == b.entrees }
}

@MainActor
@Observable
public final class NouveautesModel {
    /// La feuille à montrer (nil : rien).
    public private(set) var affichees: LotNouveautes?
    public private(set) var vues: Set<String>

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let reglages: UserDefaults
    @ObservationIgnored let catalogue: [Nouveaute]
    /// Une feuille par lancement : la suite d'un long lot attend le suivant.
    @ObservationIgnored private var lotMontre = false
    /// La page la plus loin affichée dans la feuille du lancement.
    @ObservationIgnored private var pageAtteinte = 0
    static let cleVues = "nouveautes.vues"
    /// Reprise unique du build 37 (25/10), faite au premier lancement d'après.
    static let cleReprise37 = "nouveautes.reprise37"
    /// Le build 37 coupait sa feuille à 6 pages mais marquait vu tout le lot :
    /// ces deux entrées (sans capacité, en tête de la série 3) sont les seules
    /// qu'il a pu montrer. Revoir un tutoriel coûte moins qu'en perdre un.
    static let montreesParLeBuild37: Set<String> = ["partage", "hors-app"]

    public init(reglages: UserDefaults = .standard, catalogue: [Nouveaute] = Nouveautes.catalogue) {
        self.reglages = reglages
        self.catalogue = catalogue
        if var vues = reglages.stringArray(forKey: Self.cleVues).map(Set.init) {
            if !reglages.bool(forKey: Self.cleReprise37) {
                // Les entrées de la série 3 marquées vues sans avoir été
                // montrées redeviennent nouvelles, une fois pour toutes.
                let serie3 = Set(catalogue.filter { $0.serie == 3 }.map(\.id))
                vues.subtract(serie3.subtracting(Self.montreesParLeBuild37))
                reglages.set(Array(vues).sorted(), forKey: Self.cleVues)
            }
            self.vues = vues
        } else {
            // Premier lancement avec les nouveautés : seules celles de la
            // dernière mise à jour sont nouvelles ; les autres, à l'historique.
            let derniere = catalogue.map(\.serie).max() ?? 0
            vues = Set(catalogue.filter { $0.serie < derniere }.map(\.id))
            reglages.set(Array(vues).sorted(), forKey: Self.cleVues)
        }
        reglages.set(true, forKey: Self.cleReprise37)
    }

    /// La tour connaît la fonction (sinon elle est encore cachée dans l'app).
    public func existe(_ n: Nouveaute) -> Bool {
        n.capacite.map { app?.serveur?.sait($0) == true } ?? true
    }

    /// L'historique (Réglages › Nouveautés) : la plus récente d'abord.
    public var historique: [Nouveaute] {
        catalogue.enumerated().sorted { a, b in a.element.serie != b.element.serie ? a.element.serie > b.element.serie : a.offset < b.offset }.map(\.element)
    }

    public func estNouvelle(_ n: Nouveaute) -> Bool { !vues.contains(n.id) }

    /// Au retour au premier plan : les nouveautés pas encore vues, dont la
    /// tour connaît la fonction. Rien si une feuille est déjà là. Une feuille
    /// ne dépasse pas `pagesMax` pages : le reste vient au lancement suivant.
    public func verifier() {
        guard affichees == nil, !lotMontre else { return }
        let a = Nouveautes.lot(catalogue.filter { !vues.contains($0.id) && existe($0) }.sorted { $0.serie < $1.serie })
        guard !a.isEmpty else { return }
        lotMontre = true
        pageAtteinte = 0
        affichees = LotNouveautes(id: a.map(\.id).joined(separator: "+"), entrees: a)
    }

    /// La feuille du lancement affiche la page `index` (0 : la première).
    public func pageVue(_ index: Int) {
        pageAtteinte = max(pageAtteinte, index)
    }

    /// Revoir un tutoriel depuis l'historique (Réglages › Nouveautés).
    public func lot(pour n: Nouveaute) -> LotNouveautes {
        LotNouveautes(id: "revoir-\(n.id)", entrees: [n])
    }

    /// Un tutoriel parcouru, ou fermé : vu, plus de rappel.
    public func marquerVues(_ entrees: [Nouveaute]) {
        vues.formUnion(entrees.map(\.id))
        reglages.set(Array(vues).sorted(), forKey: Self.cleVues)
    }

    /// Un tutoriel revu en entier (Réglages › Nouveautés).
    public func marquerVues(_ lot: LotNouveautes) { marquerVues(lot.entrees) }

    /// La feuille du lancement fermée (finie, « Plus tard » ou balayée) :
    /// vues, les entrées dont une page au moins a été affichée. Les autres
    /// restent nouvelles et viennent au lancement suivant.
    public func fermer() {
        guard let a = affichees else { return }
        marquerVues(a.entrees(jusqua: pageAtteinte))
        affichees = nil
        pageAtteinte = 0
    }

    /// Captures de la CI seulement.
    public func montrerPourCapture(_ ids: [String]) {
        let e = catalogue.filter { ids.contains($0.id) }
        affichees = e.isEmpty ? nil : LotNouveautes(id: "capture", entrees: e)
    }
}
