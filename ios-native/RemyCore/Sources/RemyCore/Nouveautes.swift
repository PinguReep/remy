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
//
// Le suivi (12/11) : chaque tutoriel est « à découvrir » (jamais ouvert),
// « commencé » (ouvert, dernière page pas atteinte) ou « suivi » (dernière
// page atteinte), avec sa date, gardé sur l'iPhone. Présenté d'office au
// lancement seulement s'il appartient aux DEUX DERNIÈRES SÉRIES du catalogue
// (`Nouveautes.seriesPresentees`) : au-delà, il attend dans Réglages ›
// Nouveautés sans s'imposer. Une fonction qui change : `aRemplacer` (plus
// présentée d'office), puis sa remplaçante, avec `remplace` (l'ancienne sort
// du suivi dès que la tour connaît la nouvelle). Une fonction disparue :
// son id dans `Nouveautes.retirees`, l'entrée hors du catalogue.

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
    /// L'entrée qu'elle remplace (son id) : l'ancienne sort du suivi et du
    /// lancement dès que la tour connaît la nouvelle ; la nouvelle, avec son
    /// propre id, part « à découvrir » même pour qui avait suivi l'ancienne.
    public var remplace: String? = nil
    /// Décrit une fonction en train de changer : plus présentée d'office,
    /// toujours dans le suivi (« bientôt remplacé ») jusqu'à sa remplaçante.
    public var aRemplacer = false
}

public enum Nouveautes {
    public static let catalogue: [Nouveaute] = [
        Nouveaute(id: "projets-bloques", serie: 11, date: "12 nov.", titre: "Un projet qui en attend un autre", capacite: "projets-bloques-v1", pages: [
            .init(symbole: "pause.circle", titre: "« Bloqué par… » sur un projet",
                  texte: "Dans Projets, ouvre un projet Motion ou un dossier : « Choisir ce qu'il attend… », une tâche ou un autre projet. Aucune de ses tâches ne t'est proposée avant ; elles disent « Projet … bloqué par … »."),
            .init(symbole: "checkmark.circle", titre: "Fini, et c'est dit",
                  texte: "Un projet est fini pour Rémy quand toutes ses tâches sont terminées (dans la liste Motion lue en entier), ou quand tu touches « C'est fini ». Ce qui l'attendait se débloque, et l'Historique le garde."),
        ]),
        // Remplace « priorites » (12/11) : Rémy propose le classement, Sam le
        // confirme ; deux pages, pour que la série 11 tienne dans une feuille.
        Nouveaute(id: "ce-que-remy-a-compris", serie: 11, date: "12 nov.", titre: "Rémy comprend ce qui compte", capacite: CeQuiCompte.capacite, pages: [
            .init(symbole: "eye", titre: "Rémy propose, tu confirmes",
                  texte: "Réglages › Ce qui compte : plus rien à écrire. Rémy classe ce qui compte d'après Motion et ce qui passe par lui, et dit ce qu'il a vu. « C'est ça » confirme : seul ce que tu confirmes lui sert."),
            .init(symbole: "hand.tap", titre: "Corrige d'un geste",
                  texte: "Monte, descends, ou « Pas une priorité » : Rémy ne la reproposera plus. Puis « Enregistrer ». Ce qui avance hors de Motion (du code, du papier, un appel) lui échappe : ajoute-le à la main, en bas."),
        ], remplace: "priorites"),
        Nouveaute(id: "pieces-jointes", serie: 10, date: "12 nov.", titre: "Joindre une photo ou un fichier", capacite: PiecesJointes.capacite, pages: [
            .init(symbole: "paperclip", titre: "Le trombone",
                  texte: "À gauche du champ : une photo de la photothèque, une prise maintenant, ou un fichier (PDF, texte, image). Jusqu'à 4 pièces de 10 Mo par message, avec ou sans texte."),
            .init(symbole: "eye", titre: "Ce que Rémy en lit",
                  texte: "La tour lit tout, pas l'iPhone : le texte d'une photo, les PDF, les textes, et décrit l'image si son modèle local voit. Pour un détail, Rémy relit la pièce. Sous chaque pièce : ce qui a été lu, ou pourquoi non."),
            .init(symbole: "lock.shield", titre: "Gardée chez toi",
                  texte: "L'original reste chiffré sur ta tour : touche la pièce pour la revoir en grand. Rien ne part chez un fournisseur cloud ; supprimer la conversation supprime ses pièces."),
        ]),
        Nouveaute(id: "dependances-taches", serie: 10, date: "12 nov.", titre: "Une tâche qui en attend une autre", capacite: "taches-dependances-v1", pages: [
            .init(symbole: "pause.circle", titre: "« Bloquée par… »",
                  texte: "Dans « Gérer » d'une tâche : « Choisir la tâche qu'elle attend… », cherche-la par son nom. Tant que l'autre n'est pas finie, Rémy ne te la propose jamais ; sa ligne dit « Bloquée par … », l'autre « Débloque … »."),
            .init(symbole: "arrow.right.circle", titre: "Elle se débloque seule",
                  texte: "Termine celle qu'elle attend (ici, ou dans Motion) : Rémy te dit qu'elle est débloquée, et l'Historique le garde. Motion ne connaît pas ce lien : il peut la planifier quand même."),
            .init(symbole: "bubble.left", titre: "Rémy le propose",
                  texte: "Décris un projet en étapes (« d'abord le garage, puis le carrossier ») : Rémy propose les tâches avec leur ordre, et rien n'est créé avant ton « Oui »."),
        ]),
        Nouveaute(id: "recherche-projets", serie: 9, date: "12 nov.", titre: "Chercher dans Projets", capacite: nil, pages: [
            .init(symbole: "magnifyingglass", titre: "Tout retrouver",
                  texte: "En haut de Projets, tape un mot : il cherche dans tes projets et tâches Motion, les idées des dossiers, les articles des listes et les rappels. Accents et majuscules n'y font rien ; le mot trouvé est surligné."),
            .init(symbole: "hand.tap", titre: "Droit au bon endroit",
                  texte: "Touche un résultat : sa liste, son dossier ou son projet s'ouvre ; une tâche s'ouvre dans « Gérer », un rappel dans sa fiche. Au retour, ta recherche est encore là."),
        ]),
        Nouveaute(id: "rappels-declencheurs", serie: 8, date: "11 nov.", titre: "Des rappels qui préviennent à temps", capacite: "rappels-declencheurs-v1", pages: [
            .init(symbole: "square.and.pencil", titre: "Une fiche par rappel",
                  texte: "Le « + » de Rappels ouvre une fiche : le texte, une note, la date et l'heure. Pour un rappel déjà là : appui long › « Détails… », ou « Détails » sous ses dates."),
            .init(symbole: "bell.badge", titre: "La veille, le matin, un peu avant",
                  texte: "« Me prévenir aussi » : la veille à l'heure que tu choisis, le matin même, ou quelques heures avant. La fiche écrit quand ça sonnera, et retient tes heures pour la prochaine fois."),
            .init(symbole: "location", titre: "En arrivant, en partant",
                  texte: "« Dans un lieu » : choisis un lieu nommé, ou nomme l'endroit où tu es. Le rappel sonne quand tu y arrives ou quand tu en pars, même app fermée. Et si demain commence tôt, le bilan du soir te dit de penser au réveil."),
        ]),
        Nouveaute(id: "telechargements-accord", serie: 7, date: "30 oct.", titre: "Un export ChatGPT attend ton accord", capacite: "telechargements-accord-v1", pages: [
            .init(symbole: "checkmark.shield", titre: "Rien n'entre sans toi",
                  texte: "Un .zip trouvé dans les Téléchargements de la tour attend sur une carte de Conversations : « Importer » si c'est ton export, « Pas celui-là » sinon. Les exports suivants du même compte entrent seuls."),
        ]),
        Nouveaute(id: "chatgpt-automatique", serie: 6, date: "29 oct.", titre: "ChatGPT, sans y penser", capacite: "conversations-externes-v2", pages: [
            .init(symbole: "arrow.down.circle", titre: "L'export trouvé dans Téléchargements",
                  texte: "Demande ton export à ChatGPT ; quand le mail arrive, clique son lien sur la tour : Rémy le trouve dans ses Téléchargements, en lecture seule, et te demande ton accord. Reçu sur l'iPhone ? « Importer le .zip » dans la carte."),
            .init(symbole: "bell.badge", titre: "Un rappel par mois",
                  texte: "Quand ton dernier export a plus de 30 jours, une carte « Exporter ChatGPT » dans Conversations ouvre la bonne page. Réglages › Sources des conversations pour la couper."),
            .init(symbole: "magnifyingglass", titre: "Claude Code et T3, bien trouvés",
                  texte: "Les sessions de l'app Claude de bureau et de Remote Control sont lues. Sources dit combien Rémy en a vu, et pourquoi il en écarte : ses propres appels, les « claude -p » d'un seul échange."),
        ]),
        Nouveaute(id: "conversations-externes", serie: 5, date: "29 oct.", titre: "Tes conversations d'ailleurs, ici", capacite: "conversations-externes-v1", pages: [
            .init(symbole: "bubble.left.and.bubble.right", titre: "Claude Code, T3, ChatGPT",
                  texte: "Projets › Conversations : tes sessions Claude Code et tes fils T3 Code (ordinateur ou téléphone), lus par ta tour. Par source, par jour (« Aller à un jour »), ou cherche un mot : la conversation s'ouvre au message trouvé."),
            .init(symbole: "square.and.arrow.down", titre: "ChatGPT en un geste",
                  texte: "Dans ChatGPT : Réglages › Contrôle des données › Exporter. Puis « Importer ChatGPT » ici, et choisis le .zip reçu par mail. Ou dépose-le dans le dossier Imports de ton coffre."),
            .init(symbole: "lock.shield", titre: "Rien ne repart",
                  texte: "Tout est chiffré sur ta tour ; rien ne retourne chez Claude ni chez OpenAI. Rémy s'en inspire avec son modèle local, et la nuit en tire thèmes et choses à faire. Réglages › Sources des conversations pour couper ou effacer."),
        ]),
        Nouveaute(id: "reglages-recherche", serie: 5, date: "29 oct.", titre: "Chercher dans les réglages", capacite: nil, pages: [
            .init(symbole: "magnifyingglass", titre: "Va droit au réglage",
                  texte: "En haut de Réglages, tape ce que tu cherches : « notif », « jauge », « privé », « Siri »… Touche un résultat : son écran s'ouvre, le réglage mis en évidence."),
        ]),
        Nouveaute(id: "privee-iphone", serie: 4, date: "27 oct.", titre: "Conversation privée sur l'iPhone", capacite: nil, pages: [
            .init(symbole: "lock", titre: "Une conversation qui reste chez toi",
                  texte: "Nouvelle conversation : touche « Privée » au-dessus du champ. Ou touche le titre en haut › « Rendre cette conversation privée » (sans retour). Le cadenas reste sur la marque de Rémy, en haut."),
            .init(symbole: "lock.shield", titre: "Ce que ça change",
                  texte: "Rien ne part chez Claude : le modèle local de ta tour répond, n'en retient rien dans sa mémoire, et la nuit ne la relit pas. Ni ailleurs, tant que la recherche y reste coupée. Tour éteinte : pas de réponse."),
            .init(symbole: "magnifyingglass", titre: "Et le web ?",
                  texte: "Coupé par défaut. Réglages › Recherche dans les conversations privées : partent alors des questions générales (Rémy, puis la salle blanche), filtrées ; les pages sont lues depuis ta tour."),
        ]),
        Nouveaute(id: "jauge-retour", serie: 4, date: "27 oct.", titre: "La jauge du contexte", capacite: "jauge-v1", pages: [
            .init(symbole: "gauge.with.dots.needle.33percent", titre: "Visible dès le premier message",
                  texte: "Le cadran en haut du chat montre la place que prend la conversation. Pour le masquer : Réglages › Diagnostic › Jauge du contexte."),
            .init(symbole: "rectangle.compress.vertical", titre: "Le résumé à 70 %",
                  texte: "Touche le cadran : il dit quand Rémy résumera le début du fil (dès 70 %), s'il l'a fait, et « Compacter maintenant » le fait tout de suite. Rien n'est effacé."),
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
                  texte: "Touche un rappel : « Dans 1 h », « Ce soir 19:00 », « Demain 9:00 »… Sur la notification aussi : appuie longuement dessus pour « Fait », « Dans 1 h » ou « Demain 9:00 »."),
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
                  texte: "Une pensée sans action claire va dans « Idées » (Projets), pas dans Motion. « Appeler le garage » reste une tâche. Réglages › « Une pensée sans action claire » › « Dans Motion » pour revenir à l'ancien comportement."),
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
        // Remplacée (12/11) par « ce-que-remy-a-compris » (série 11) dès que la
        // tour connaît priorites-v2 : Rémy propose le classement, Sam le
        // confirme. Avant, c'est encore elle qui décrit l'écran.
        Nouveaute(id: "priorites", serie: 3, date: "24 oct.", titre: "Dis à Rémy ce qui compte", capacite: "priorites-v1", pages: [
            .init(symbole: "star", titre: "Tes 3 à 5 priorités",
                  texte: "Réglages › Ce qui compte : écris-les avec leur pourquoi. Le conseil du moment et la réflexion de nuit s'en servent, et un conseil qui sert une priorité le dit."),
            .init(symbole: "clock.badge.exclamationmark", titre: "Ce qui n'a pas bougé",
                  texte: "Sans trace d'activité depuis une semaine, une priorité est marquée « négligée », avec sa dernière trace. Chaque version reste sur ta tour."),
        ], aRemplacer: true),
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
                  texte: "Quand tu charges un autre modèle sur tes Sparks, Rémy le suit tout seul. Touche le cadran en haut du chat : il dit quel modèle a répondu."),
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
        Nouveaute(id: "regles", serie: 1, date: "20 oct.", titre: "Les règles de Rémy", capacite: "regles-v1", pages: [
            .init(symbole: "arrow.triangle.branch", titre: "Avant X, fais Y",
                  texte: "Dis-lui « avant une sortie, propose-moi de me raser » : il te propose une règle. Ensuite, il relit ton agenda et te propose la tâche — jamais sans ton « Oui »."),
        ]),
        Nouveaute(id: "selection", serie: 1, date: "20 oct.", titre: "Sélectionner du texte", capacite: nil, pages: [
            .init(symbole: "text.cursor", titre: "Appui long sur une bulle",
                  texte: "« Sélectionner le texte » : la vraie sélection d'iOS, sur tes messages comme sur ceux de Rémy. Une erreur montre son code et « Copier le diagnostic »."),
        ]),
    ]

    /// Les entrées retirées du catalogue (12/11), et pourquoi. Leur id ne
    /// resservira pas : un état gardé sur l'iPhone sous cet id est ignoré
    /// (ni compté, ni montré, ni présenté). Retirer = l'id ici, l'entrée
    /// hors de `catalogue`.
    public static let retirees: [String: String] = [
        // Série 1 (20/10) : « Les tokens par seconde s'affichent pendant qu'il
        // écrit » est faux depuis le 27/10 (masqués par défaut, Diagnostic) ;
        // la jauge a son tutoriel à jour, « jauge-retour ».
        "jauge": "remplacée par « jauge-retour » ; la vitesse est masquée par défaut",
        // Série 1 : tout entière dans la deuxième page de « jauge-retour ».
        "compactage": "doublon de « jauge-retour » (le résumé à 70 %)",
        // Série 5 : l'annonce d'un changement d'heure par défaut (21 h 30 →
        // 22 h 45), passée ; « rituel » dit déjà « vers 22 h 45 ».
        "bilan-coucher": "annonce passée ; couverte par « rituel »",
    ]

    /// Présentées d'office au lancement : les entrées des deux dernières séries
    /// du catalogue. Une plus ancienne (mise à jour sautée, tour à jour plus
    /// tard) attend dans Réglages › Nouveautés, sans s'imposer.
    public static let seriesPresentees = 2

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

    /// « 12 nov. » : le jour d'un état du suivi, dans le fuseau de Rémy (les
    /// mêmes abréviations que les dates du catalogue et que le site).
    public static func jour(_ d: Date) -> String {
        let mois = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]
        let c = Format.calendrier.dateComponents([.day, .month], from: d)
        return "\(c.day ?? 1) \(mois[max(0, min(11, (c.month ?? 1) - 1))])"
    }

    /// « 3 à découvrir · 1 commencé · 22 suivis ».
    public static func resume(aDecouvrir: Int, commences: Int, suivis: Int) -> String {
        "\(aDecouvrir) à découvrir · \(commences) commencé\(commences > 1 ? "s" : "") · \(suivis) suivi\(suivis > 1 ? "s" : "")"
    }
}

/// Où en est un tutoriel, sur cet iPhone.
public enum EtatTutoriel: String, Codable, Sendable, CaseIterable {
    /// Jamais ouvert.
    case aDecouvrir
    /// Ouvert, sa dernière page pas encore atteinte.
    case commence
    /// Suivi jusqu'à sa dernière page.
    case suivi

    /// La forme, pas seulement la couleur : vide, à moitié, coché.
    public var symbole: String {
        switch self {
        case .aDecouvrir: return "circle"
        case .commence: return "circle.lefthalf.filled"
        case .suivi: return "checkmark.circle.fill"
        }
    }
}

/// L'état gardé d'un tutoriel ouvert au moins une fois (un tutoriel absent
/// du suivi est « à découvrir »).
public struct SuiviTutoriel: Codable, Equatable, Sendable {
    public var etat: EtatTutoriel
    /// La page la plus loin atteinte (0 : la première) : la reprise s'y ouvre.
    public var page: Int
    /// Ouvert (commencé) ou fini (suivi) ce jour-là.
    public var date: Date
    /// Repris d'un « vu » d'avant le suivi : on sait seulement qu'il a été
    /// ouvert avant `date` (le jour de la reprise).
    public var repris: Bool?
}

/// Une rubrique de l'écran de suivi (Réglages › Nouveautés).
public struct GroupeNouveautes: Identifiable, Equatable, Sendable {
    public let id: String
    public let titre: String
    public let entrees: [Nouveaute]
}

/// Les nouveautés à montrer d'un coup (une feuille), dans l'ordre.
public struct LotNouveautes: Identifiable, Equatable, Sendable {
    public let id: String
    public let entrees: [Nouveaute]
    /// La page où la feuille s'ouvre (0 : la première) : un tutoriel
    /// commencé reprend où il s'était arrêté.
    public var depart: Int = 0
    /// Toutes les pages de ses entrées : la limite se prend à la
    /// composition du lot (`Nouveautes.lot`), jamais au milieu d'une entrée.
    public var pages: [(nouveaute: Nouveaute, page: Nouveaute.Page)] {
        entrees.flatMap { n in n.pages.map { (n, $0) } }
    }
    /// Les entrées dont au moins une page a été affichée, la feuille ayant
    /// atteint la page `index` (0 : la première).
    public func entrees(jusqua index: Int) -> [Nouveaute] {
        avancement(jusqua: index).map { $0.nouveaute }
    }
    /// La feuille ayant atteint la page `index` du lot : chaque entrée
    /// atteinte et sa page la plus loin (les pages se tournent une à une :
    /// une entrée dépassée a été vue jusqu'au bout).
    public func avancement(jusqua index: Int) -> [(nouveaute: Nouveaute, page: Int)] {
        var debut = 0
        var r: [(nouveaute: Nouveaute, page: Int)] = []
        for n in entrees {
            if debut <= index { r.append((n, min(index - debut, max(0, n.pages.count - 1)))) }
            debut += n.pages.count
        }
        return r
    }
    public static func == (a: LotNouveautes, b: LotNouveautes) -> Bool { a.id == b.id && a.entrees == b.entrees && a.depart == b.depart }
}

@MainActor
@Observable
public final class NouveautesModel {
    /// La feuille à montrer (nil : rien).
    public private(set) var affichees: LotNouveautes?
    /// L'état de chaque tutoriel ouvert au moins une fois, par id.
    public private(set) var suivis: [String: SuiviTutoriel]

    @ObservationIgnored weak var app: AppModel?
    @ObservationIgnored let reglages: UserDefaults
    @ObservationIgnored let catalogue: [Nouveaute]
    @ObservationIgnored let retirees: Set<String>
    /// Sur une installation neuve, la série du premier lancement : rien de
    /// plus ancien n'est présenté d'office (0 : une installation d'avant).
    @ObservationIgnored let serieDepart: Int
    /// Une feuille par lancement : la suite d'un long lot attend le suivant.
    @ObservationIgnored private var lotMontre = false
    /// La page la plus loin affichée dans la feuille du lancement.
    @ObservationIgnored private var pageAtteinte = 0
    static let cleSuivi = "nouveautes.suivi"
    static let cleDepart = "nouveautes.depart"
    /// Avant le suivi (jusqu'au 12/11) : les ids « vus ». Lu une fois, pour
    /// la reprise ; plus écrit.
    static let cleVues = "nouveautes.vues"
    /// Reprise unique du build 37 (25/10), faite au premier lancement d'après.
    static let cleReprise37 = "nouveautes.reprise37"
    /// Le build 37 coupait sa feuille à 6 pages mais marquait vu tout le lot :
    /// ces deux entrées (sans capacité, en tête de la série 3) sont les seules
    /// qu'il a pu montrer. Revoir un tutoriel coûte moins qu'en perdre un.
    static let montreesParLeBuild37: Set<String> = ["partage", "hors-app"]

    public init(reglages: UserDefaults = .standard, catalogue: [Nouveaute] = Nouveautes.catalogue,
                retirees: Set<String> = Set(Nouveautes.retirees.keys), maintenant: Date = Date()) {
        self.reglages = reglages
        self.catalogue = catalogue
        self.retirees = retirees
        let derniere = catalogue.filter { !retirees.contains($0.id) }.map(\.serie).max() ?? 0
        var suivis: [String: SuiviTutoriel] = [:]
        if let d = reglages.data(forKey: Self.cleSuivi),
           let s = try? JSONDecoder().decode([String: SuiviTutoriel].self, from: d) {
            suivis = s
        } else if var vues = reglages.stringArray(forKey: Self.cleVues).map(Set.init) {
            if !reglages.bool(forKey: Self.cleReprise37) {
                // Les entrées de la série 3 marquées vues sans avoir été
                // montrées redeviennent nouvelles, une fois pour toutes.
                let serie3 = Set(catalogue.filter { $0.serie == 3 }.map(\.id))
                vues.subtract(serie3.subtracting(Self.montreesParLeBuild37))
            }
            // La reprise des « vus » (12/11) : « commencé », pas « suivi ». Un
            // « vu » disait seulement qu'une page au moins avait été affichée
            // — ou rien du tout, pour l'historique marqué vu au premier
            // lancement. Rien ne redevient « à découvrir », rien ne revient au
            // lancement ; « Tout marquer comme suivi » range le reste d'un geste.
            for id in vues { suivis[id] = SuiviTutoriel(etat: .commence, page: 0, date: maintenant, repris: true) }
            Self.ecrire(suivis, dans: reglages)
            reglages.set(0, forKey: Self.cleDepart)
        } else {
            // Installation neuve : tout est « à découvrir », mais seule la
            // dernière série est présentée d'office (comme avant le suivi).
            Self.ecrire(suivis, dans: reglages)
            reglages.set(derniere, forKey: Self.cleDepart)
        }
        self.suivis = suivis
        self.serieDepart = reglages.integer(forKey: Self.cleDepart)
        reglages.set(true, forKey: Self.cleReprise37)
    }

    static func ecrire(_ s: [String: SuiviTutoriel], dans reglages: UserDefaults) {
        if let d = try? JSONEncoder().encode(s) { reglages.set(d, forKey: cleSuivi) }
    }
    private func enregistrer() { Self.ecrire(suivis, dans: reglages) }

    /// La tour connaît la fonction (sinon elle est encore cachée dans l'app).
    public func existe(_ n: Nouveaute) -> Bool {
        n.capacite.map { app?.serveur?.sait($0) == true } ?? true
    }

    /// Le catalogue vivant : sans les entrées retirées, ni celles dont la
    /// remplaçante est là (et connue de la tour).
    public var actives: [Nouveaute] {
        let remplacees = Set(catalogue.filter { $0.remplace != nil && !retirees.contains($0.id) && existe($0) }.compactMap(\.remplace))
        return catalogue.filter { !retirees.contains($0.id) && !remplacees.contains($0.id) }
    }

    /// L'historique (Réglages › Nouveautés) : la plus récente d'abord.
    public var historique: [Nouveaute] {
        actives.enumerated().sorted { a, b in a.element.serie != b.element.serie ? a.element.serie > b.element.serie : a.offset < b.offset }.map(\.element)
    }

    public func etat(_ n: Nouveaute) -> EtatTutoriel { suivis[n.id]?.etat ?? .aDecouvrir }
    public func suivi(de n: Nouveaute) -> SuiviTutoriel? { suivis[n.id] }
    public func estNouvelle(_ n: Nouveaute) -> Bool { etat(n) == .aDecouvrir }

    /// La plus ancienne série encore présentée d'office : les
    /// `seriesPresentees` dernières, et rien d'avant le premier lancement.
    public var serieMinimale: Int {
        let derniere = catalogue.filter { !retirees.contains($0.id) }.map(\.serie).max() ?? 0
        return max(derniere - Nouveautes.seriesPresentees + 1, serieDepart)
    }

    /// Présentée d'office au lancement : jamais ouverte, récente, pas en
    /// train d'être remplacée, et la tour connaît la fonction.
    public func presentable(_ n: Nouveaute) -> Bool {
        estNouvelle(n) && !n.aRemplacer && n.serie >= serieMinimale && existe(n)
    }

    /// Au retour au premier plan : les nouveautés présentables (de la plus
    /// ancienne série à la plus récente). Rien si une feuille est déjà là.
    /// Une feuille ne dépasse pas `pagesMax` pages : le reste vient au
    /// lancement suivant.
    public func verifier() {
        guard affichees == nil, !lotMontre else { return }
        let a = Nouveautes.lot(actives.filter { presentable($0) }.sorted { $0.serie < $1.serie })
        guard !a.isEmpty else { return }
        lotMontre = true
        pageAtteinte = 0
        affichees = LotNouveautes(id: a.map(\.id).joined(separator: "+"), entrees: a)
    }

    /// La feuille du lancement affiche la page `index` (0 : la première).
    public func pageVue(_ index: Int) {
        pageAtteinte = max(pageAtteinte, index)
        if let a = affichees { noter(a, page: pageAtteinte) }
    }

    /// Ouvrir un tutoriel depuis le suivi (ou la recherche des réglages) :
    /// commencé, il reprend à sa page la plus loin ; sinon, au début.
    public func lot(pour n: Nouveaute) -> LotNouveautes {
        let s = suivis[n.id]
        let depart = s?.etat == .commence ? min(s?.page ?? 0, max(0, n.pages.count - 1)) : 0
        return LotNouveautes(id: "revoir-\(n.id)", entrees: [n], depart: depart)
    }

    /// Une feuille (lancement ou suivi) affiche la page `index` de `lot` :
    /// chaque entrée atteinte passe « commencé », ou « suivi » si sa dernière
    /// page l'est. Jamais en arrière.
    public func noter(_ lot: LotNouveautes, page index: Int, maintenant: Date = Date()) {
        var change = false
        for (n, p) in lot.avancement(jusqua: index) {
            let fini = p >= n.pages.count - 1
            if var s = suivis[n.id] {
                let avant = s
                s.page = max(s.page, p)
                if s.repris == true { s.repris = nil; s.date = maintenant }
                if fini && s.etat != .suivi { s.etat = .suivi; s.date = maintenant }
                if s != avant { suivis[n.id] = s; change = true }
            } else {
                suivis[n.id] = SuiviTutoriel(etat: fini ? .suivi : .commence, page: p, date: maintenant, repris: nil)
                change = true
            }
        }
        if change { enregistrer() }
    }

    /// La feuille du lancement fermée (finie, « Plus tard » ou balayée) :
    /// les entrées dont une page au moins a été affichée sont notées. Les
    /// autres restent à découvrir et viennent au lancement suivant.
    public func fermer() {
        guard let a = affichees else { return }
        noter(a, page: pageAtteinte)
        affichees = nil
        pageAtteinte = 0
    }

    // MARK: Le suivi (Réglages › Nouveautés)

    /// À découvrir (la tour connaît la fonction), commencés, suivis, puis
    /// ce qui attend la tour ; la plus récente d'abord dans chaque rubrique.
    public var groupes: [GroupeNouveautes] {
        let h = historique
        let g: [(String, String, [Nouveaute])] = [
            ("a-decouvrir", "À découvrir", h.filter { etat($0) == .aDecouvrir && existe($0) }),
            ("commences", "Commencés", h.filter { etat($0) == .commence }),
            ("suivis", "Suivis", h.filter { etat($0) == .suivi }),
            ("tour", "Avec la mise à jour de ta tour", h.filter { etat($0) == .aDecouvrir && !existe($0) }),
        ]
        return g.filter { !$0.2.isEmpty }.map { GroupeNouveautes(id: $0.0, titre: $0.1, entrees: $0.2) }
    }

    public var nombreADecouvrir: Int { actives.filter { etat($0) == .aDecouvrir && existe($0) }.count }
    public var nombreCommences: Int { actives.filter { etat($0) == .commence }.count }
    public var nombreSuivis: Int { actives.filter { etat($0) == .suivi }.count }

    /// « 3 à découvrir · 1 commencé · 22 suivis ».
    public var resume: String {
        Nouveautes.resume(aDecouvrir: nombreADecouvrir, commences: nombreCommences, suivis: nombreSuivis)
    }

    /// Ce que « Tout marquer comme suivi » rangerait (la tour connaît la fonction).
    public var aMarquer: [Nouveaute] { actives.filter { existe($0) && etat($0) != .suivi } }

    /// La ligne d'un tutoriel : son état en mots (pas seulement en couleur),
    /// sa date ; « page 2 sur 3 » pour un commencé.
    public func libelle(_ n: Nouveaute) -> String {
        var t: String
        switch suivis[n.id] {
        case .some(let s) where s.etat == .suivi:
            t = "Suivi le \(Nouveautes.jour(s.date))"
        case .some(let s) where s.repris == true:
            t = "Commencé · ouvert avant le \(Nouveautes.jour(s.date))"
        case .some(let s):
            t = "Commencé le \(Nouveautes.jour(s.date))"
            if n.pages.count > 1 { t += " · page \(min(s.page, n.pages.count - 1) + 1) sur \(n.pages.count)" }
        case .none:
            t = existe(n) ? "À découvrir · paru le \(n.date)" : "Arrive avec la mise à jour de ta tour · \(n.date)"
        }
        if n.aRemplacer { t += " · bientôt remplacé" }
        return t
    }

    /// Ce que fait le toucher (VoiceOver).
    public func indice(_ n: Nouveaute) -> String {
        let l = lot(pour: n)
        switch etat(n) {
        case .aDecouvrir: return "Ouvre le tutoriel"
        case .commence: return l.depart > 0 ? "Reprend à la page \(l.depart + 1)" : "Reprend le tutoriel"
        case .suivi: return "Le revoir depuis le début"
        }
    }

    /// Tout ce qui n'est pas suivi le devient d'un geste, avec « Annuler »
    /// (l'état d'avant revient tel quel). Rend combien ont été rangés.
    @discardableResult
    public func toutMarquerSuivi(maintenant: Date = Date()) -> Int {
        let a = aMarquer
        guard !a.isEmpty else { return 0 }
        let avant = suivis
        for n in a { suivis[n.id] = SuiviTutoriel(etat: .suivi, page: max(0, n.pages.count - 1), date: maintenant, repris: nil) }
        enregistrer()
        let s = a.count > 1 ? "s" : ""
        app?.dire("\(a.count) tutoriel\(s) marqué\(s) comme suivi\(s).", annuler: { [weak self] in self?.restaurer(avant) })
        return a.count
    }

    func restaurer(_ s: [String: SuiviTutoriel]) {
        suivis = s
        enregistrer()
    }

    /// Captures de la CI seulement.
    public func montrerPourCapture(_ ids: [String]) {
        let e = catalogue.filter { ids.contains($0.id) }
        affichees = e.isEmpty ? nil : LotNouveautes(id: "capture", entrees: e)
    }

    /// Captures de la CI seulement : un suivi entamé (des commencés, des
    /// suivis), en mémoire et sur le simulateur.
    public func suiviPourCapture(maintenant: Date = Date()) {
        let jour: TimeInterval = 86_400
        for (i, n) in historique.enumerated() where i >= 2 {
            if i % 3 == 0 {
                suivis[n.id] = SuiviTutoriel(etat: .commence, page: min(1, n.pages.count - 1), date: maintenant.addingTimeInterval(-Double(i) * jour), repris: nil)
            } else {
                suivis[n.id] = SuiviTutoriel(etat: .suivi, page: n.pages.count - 1, date: maintenant.addingTimeInterval(-Double(i) * jour), repris: nil)
            }
        }
        enregistrer()
    }
}
