// Les nouveautés (port de Nouveautes.swift, 21/10) : à chaque mise à jour qui
// apporte une fonction visible, un mini tutoriel de une à trois pages, une
// fois, au lancement suivant — jamais par-dessus une autre feuille ni pendant
// une saisie, et seulement quand la tour connaît la fonction (sinon elle est
// encore cachée). Réglages › Nouveautés garde l'historique pour les revoir.
// Le catalogue reprend les entrées de l'iPhone qui valent sur l'ordinateur,
// textes adaptés (clic, clic droit, Réglages › Ordinateur) ; celles propres à
// l'iPhone (Siri et widgets, Partager, au pouce, sélection) n'y sont pas. La
// conversation privée et l'image (Partager, sur l'iPhone) ont leur entrée
// d'ici, au clic (contre-relecture du 30/10, tour 2).
// Le suivi (12/11, comme l'iPhone) : chaque tutoriel est « à découvrir »
// (jamais ouvert), « commencé » (ouvert, dernière page pas atteinte) ou
// « suivi » (dernière page atteinte), avec sa date, gardé sur cet ordinateur.
// Présenté d'office au lancement seulement s'il appartient aux DEUX DERNIÈRES
// SÉRIES du catalogue (SERIES_PRESENTEES) ; au-delà, il attend dans Réglages ›
// Nouveautés. `aRemplacer` : plus présenté d'office ; `remplace` : la
// remplaçante sort l'ancienne du suivi ; RETIREES : les ids retirés.
// La logique est pure (le stockage passe par `local`, lu à l'appel) ; la
// feuille n'utilise le document qu'à l'ouverture : importable sous node.
import { h, vider, icone, bouton, feuille, local } from "./ui.js";

const p = (icone, titre, texte) => Object.freeze({ icone, titre, texte });
const n = (id, serie, date, titre, capacite, pages, { remplace = null, aRemplacer = false } = {}) => Object.freeze({ id, serie, date, titre, capacite, pages, remplace, aRemplacer });

export const CATALOGUE = [
  // Série 10 (12/11, second lot) : la série 9 tient déjà sur deux feuilles (11 pages).
  n("projets-bloques", 10, "12 nov.", "Un projet qui en attend un autre", "projets-bloques-v1", [
    p("pause", "« Bloqué par… » sur un projet", "Dans Projets, ouvre un projet Motion ou un dossier : « Choisir ce qu'il attend… », une tâche ou un autre projet. Aucune de ses tâches ne t'est proposée avant ; elles disent « Projet … bloqué par … »."),
    p("coche", "Fini, et c'est dit", "Un projet est fini pour Rémy quand toutes ses tâches sont terminées (dans la liste Motion lue en entier), ou quand tu touches « C'est fini ». Ce qui l'attendait se débloque, et l'Historique le garde."),
  ]),
  n("planning-remy", 10, "12 nov.", "Le planning de Rémy, à côté de Motion", "planning-remy-v1", [
    p("deplacer", "Deux plannings côte à côte", "Sur la carte « Demain et 7 jours », « Rémy et Motion » (aussi dans Ctrl+K) : Rémy calcule son propre planning avec les mêmes tâches, et montre d'abord là où il ne fait pas comme Motion. Rien n'est écrit chez Motion."),
    p("question", "Une ligne de pourquoi", "Chaque écart dit sa raison : une tâche bloquée que Motion place quand même, une échéance ferme que l'un tient et pas l'autre, un ordre différent parce qu'une tâche sert ta priorité n°1."),
    p("coche", "À toi de juger", "« Rémy a raison » ou « Motion a raison » : ton choix est gardé sur ta tour, daté, et compté. Dans quelques semaines, le compte dira si Rémy peut planifier seul. Coupable dans Réglages › Rémy."),
  ]),
  // Série 9 (12/11) : une seule mise à jour, quatre tutoriels — présentés en
  // deux feuilles (PAGES_MAX), dans cet ordre.
  n("prochaines-heures", 9, "12 nov.", "Tes prochaines heures, et pourquoi", "priorites-v2", [
    p("horloge", "H, et tout s'affiche", "H ouvre « Prochaines heures » : de maintenant à demain midi, ce que Motion a placé, dans son ordre, et sur quel projet. Échap, un clic à côté ou H de nouveau la referment. Aussi dans Ctrl+K."),
    p("question", "Une ligne de pourquoi", "Sous chaque ligne, ce que les données disent : rendez-vous fixe, échéance ferme, priorité Motion, menacée… Quand rien ne la distingue, Rémy le dit au lieu d'inventer une raison."),
    p("etoile", "Ce que Rémy a compris", "Réglages › Ce qui compte : Rémy propose un classement de tes projets, avec ce qu'il a vu. « C'est ça », ↑ ↓ ou « Pas une priorité » ; seul ce que tu confirmes devient « sert ta priorité n°1 »."),
  ], { remplace: "priorites" }),
  n("dependances-taches", 9, "12 nov.", "Une tâche qui en attend une autre", "taches-dependances-v1", [
    p("pause", "« Bloquée par… »", "Dans « Gérer » d'une tâche : « Choisir la tâche qu'elle attend… », cherche par son nom. Tant que l'autre n'est pas finie, Rémy ne te la propose jamais, et sa ligne dit « Bloquée par … » ; l'autre dit « Débloque … »."),
    p("fleche", "Elle se débloque seule", "Termine celle qu'elle attend (ici, ou dans Motion) : Rémy te dit qu'elle est débloquée, et l'Historique le garde. Motion ne connaît pas ce lien : il peut la planifier quand même."),
    p("remy", "Rémy le propose", "Décris un projet en étapes (« d'abord le garage, puis le carrossier ») : Rémy propose les tâches avec leur ordre, et rien n'est créé avant ton « Oui »."),
  ]),
  n("pieces-jointes", 9, "12 nov.", "Joindre un fichier à Rémy", "pieces-v1", [
    p("trombone", "Le trombone, ou Ctrl+V", "Dans Rémy, le trombone à gauche du champ joint une image, un PDF ou un texte (.txt, .md) ; coller une capture ou déposer un fichier marche aussi. 4 pièces de 10 Mo au plus par message."),
    p("oeil", "Ce que Rémy en lit", "Tout est lu sur la tour : un texte, un PDF ; une image, son texte et, si le modèle local voit, sa description. Pour un détail, Rémy relit la pièce. Sous chaque pièce : ce qui a été lu, ou pourquoi non (essai : Réglages › Diagnostic)."),
    p("cadenas", "Gardée chez toi", "L'original reste chiffré sur ta tour : tu le revois dans le fil (clic pour l'agrandir ou le télécharger). Rien ne part chez un fournisseur cloud ; supprimer la conversation supprime ses pièces."),
  ]),
  n("maj-auto", 9, "12 nov.", "Ta tour se met à jour seule", "maj-auto-v1", [
    p("rafraichir", "Ce qui passe ses contrôles", "Une fois activée sur la tour, elle installe d'elle-même ce qui arrive sur main, seulement si tous ses contrôles ont réussi, et jamais pendant que Rémy travaille. Sinon, elle revient à la version d'avant."),
    p("pause", "La voir, la mettre en pause", "Réglages › Diagnostic : « Mise à jour automatique », activée ou non, la dernière (commit, jour, réussie ou annulée et pourquoi), et un interrupteur pour la mettre en pause."),
  ]),
  n("recherche-projets", 8, "12 nov.", "Chercher dans Projets", null, [
    p("recherche", "Tout retrouver", "Le champ en haut de Projets (ou /) cherche aussi dans les tâches Motion, les idées des dossiers, les articles des listes et les rappels. Accents et majuscules n'y font rien ; le mot trouvé est surligné."),
    p("fleche", "Droit au bon endroit", "Clique un résultat : sa liste, son dossier ou son projet s'ouvre ; une tâche s'ouvre dans « Gérer », un rappel dans « Quand ? ». Entrée ouvre le premier, Échap vide le champ."),
  ]),
  n("rappels-declencheurs", 7, "11 nov.", "Des rappels qui préviennent à temps", "rappels-declencheurs-v1", [
    p("cloche", "La veille, le matin, un peu avant", "Un rappel peut te prévenir avant son heure : la veille à l'heure choisie, le matin même, ou quelques heures avant. Avec « Rappels à l'heure » (Réglages › Ordinateur), Windows te le dit aussi."),
    p("lieu", "Sa note, son lieu", "La ligne d'un rappel montre sa note, son lieu (« En arrivant : … ») et une cloche s'il a des alertes. Tout se règle dans la fiche du rappel, sur ton téléphone : c'est lui qui sonne sur place."),
  ]),
  n("telechargements-accord", 6, "30 oct.", "Un export ChatGPT attend ton accord", "telechargements-accord-v1", [
    p("bouclier", "Rien n'entre sans toi", "Un .zip trouvé dans les Téléchargements de la tour attend sur une carte de Conversations : « Importer » si c'est ton export, « Pas celui-là » sinon. Les exports suivants du même compte entrent seuls."),
  ]),
  n("image-noter", 6, "30 oct.", "Une image dans Noter", "partage-v1", [
    p("plateauRanger", "Colle ou dépose une image", "Dans Noter (N), Ctrl+V d'une capture d'écran, ou dépose une image depuis l'Explorateur : un aperçu s'affiche. Échap la retire."),
    p("crayon", "Un mot, puis « Ranger l'image »", "Elle est rangée dans ton coffre, Captures/Images. Le texte de l'image n'est pas lu ici : un mot (facultatif) dit à Rémy ce qu'il doit en retenir."),
  ]),
  n("conversation-privee", 6, "30 oct.", "Une conversation privée", null, [
    p("cadenas", "Privée, d'un clic", "Dans Rémy, avant le premier message : la puce « Privée » au-dessus du champ, ou le cadenas en haut de la liste. Une conversation commencée : « Rendre privée » parmi ses actions, en haut du fil (sans retour)."),
    p("bouclier", "Ce que ça change", "Rien ne part chez Claude : le modèle local de ta tour répond, n'en retient rien dans sa mémoire, et la nuit ne la relit pas. Ni ailleurs, tant que la recherche y reste coupée. Tour éteinte : pas de réponse."),
  ]),
  n("conversations-externes", 5, "29 oct.", "Tes conversations d'ailleurs, ici", "conversations-externes-v1", [
    p("conversations", "Claude Code, T3, ChatGPT", "La vue Conversations : tes sessions Claude Code et tes fils T3 Code, lus par ta tour. Par source, par jour, ou cherche un mot : la conversation s'ouvre au message trouvé."),
    p("envoyer", "ChatGPT en un geste", "Dans ChatGPT : Réglages › Contrôle des données › Exporter. Puis Réglages › Sources des conversations › « Importer un export ChatGPT », et choisis le .zip reçu par mail."),
    p("cadenas", "Rien ne repart", "Tout est chiffré sur ta tour ; rien ne retourne chez Claude ni chez OpenAI. Rémy s'en inspire avec son modèle local, et la nuit en tire thèmes et choses à faire."),
  ]),
  n("reglages-recherche", 5, "29 oct.", "Chercher dans les réglages", null, [
    p("recherche", "Va droit au réglage", "En haut de Réglages (ou avec Ctrl+K), tape ce que tu cherches : « notif », « jauge », « privé »… Entrée ouvre le premier résultat, le réglage mis en évidence."),
  ]),
  // Série 6 de l'iPhone, rangée ici en série 5 : le site reçoit tout le 29/10
  // d'un coup (6 pages au plus par feuille).
  n("chatgpt-automatique", 5, "29 oct.", "ChatGPT, sans y penser", "conversations-externes-v2", [
    p("ranger", "L'export trouvé dans Téléchargements", "Demande ton export à ChatGPT ; quand le mail arrive, clique son lien sur la tour : Rémy le trouve dans ses Téléchargements, en lecture seule, et te demande ton accord. Reçu ailleurs ? « Importer le .zip » dans la carte."),
    p("cloche", "Un rappel par mois", "Quand ton dernier export a plus de 30 jours, une carte « Exporter ChatGPT » dans Conversations ouvre la bonne page. Réglages › Sources des conversations pour la couper."),
    p("recherche", "Claude Code et T3, bien trouvés", "Les sessions de l'app Claude de bureau et de Remote Control sont lues. Sources dit combien Rémy en a vu, et pourquoi il en écarte : ses propres appels, les « claude -p » d'un seul échange."),
  ]),
  n("jauge-retour", 4, "27 oct.", "La jauge du contexte", "jauge-v1", [
    p("jauge", "Visible dès le premier message", "Le cadran en haut du chat montre la place que prend la conversation. Pour le masquer : Réglages › Diagnostic › Jauge du contexte."),
    p("compresser", "Le résumé à 70 %", "Clique le cadran : il dit quand Rémy résumera le début du fil (dès 70 %), s'il l'a fait, et « Compacter maintenant » le fait tout de suite. Rien n'est effacé."),
  ]),
  n("activite-pc", 3, "24 oct.", "Le temps passé sur ton PC", "activite-pc-v1", [
    p("ecran", "Ce que tu fais sur ta tour", "Réglages › Activité du PC. ActivityWatch, installé sur la tour, note l'appli au premier plan ; Rémy n'en garde que le temps actif, par appli et par catégorie."),
    p("cadenas", "Rien ne sort de chez toi", "Les titres de fenêtres ne sont jamais gardés, un site se réduit à son domaine. Coupé par défaut, gardé 90 jours, effaçable d'un geste. Exclus une appli d'un clic droit."),
    p("graphique", "Des repères pour Rémy", "Le modèle local sait « développement 3 h 10 aujourd'hui » et s'en sert pour t'aider, jamais pour te juger. Claude ne reçoit jamais ces relevés."),
  ]),
  n("deja-la", 3, "24 oct.", "Moins de bruit, rien de perdu", "deja-la-v1", [
    p("coche", "Déjà là n'est pas un échec", "Une tâche déjà dans Motion, un article déjà sur ta liste, un rappel déjà noté : Rémy ne le recrée pas et te le dit, sans alerte."),
    p("horloge", "Les vieilles propositions", "Une proposition de plus de 7 jours, ou dont la date est passée, est marquée sur sa carte : « Oui » te demande de confirmer, ou d'ajuster la ligne d'abord."),
  ]),
  n("proposition-partielle", 3, "24 oct.", "Garder une partie d'une proposition", "propositions-partielles-v1", [
    p("liste", "Décoche ce que tu ne veux pas", "Dans une proposition de Rémy, décoche une ligne : seules les lignes cochées partent, et la carte dit ce qui a été écarté."),
  ]),
  n("rituel", 3, "24 oct.", "Ton rendez-vous quotidien", "rituel-v1", [
    p("soleil", "Le matin, trois lignes", "Ce qui compte aujourd'hui, pourquoi, et ce qui est menacé, dans une notification Windows à l'heure que tu choisis. Calculé par ta tour, sans IA. Coupé tant que tu ne l'allumes pas."),
    p("alerte", "Les échéances menacées", "En haut d'Aujourd'hui : une tâche qui ne tiendra plus son échéance, avant qu'elle soit en retard, avec l'action utile (repousser, ou demander à Rémy)."),
    p("lune", "Le soir, 30 secondes", "Vers 22 h 45, avant de te coucher : fait, glissé, et tout ce qui reste vers demain d'un geste (annulable). Réglages › Ordinateur pour l'heure."),
  ]),
  n("idees", 3, "24 oct.", "Tes idées restent des idées", "dossiers-v1", [
    p("plus", "Plus de tâche par erreur", "Une pensée sans action claire va dans « Idées » (Projets), pas dans Motion. « Appeler le garage » reste une tâche. Réglages › Noter pour revenir à l'ancien comportement."),
  ]),
  n("semaine", 3, "24 oct.", "Demain et les 7 jours", "semaine-v1", [
    p("calendrier", "« À l'échelle », à côté de la journée", "Aujourd'hui, Demain ou 7 jours. Demain s'affiche en entier, à l'échelle, avec les mêmes gestes : cliquer une tâche ouvre « Gérer »."),
    p("graphique", "La semaine d'un coup d'œil", "Par jour : les heures prévues contre tes heures libres, les rendez-vous, les échéances, et ce que Motion place trop tard. Lu dans Motion et ton agenda, sans IA."),
  ]),
  n("a-trancher", 3, "24 oct.", "À trancher, et la revue du dimanche", "a-trancher-v1", [
    p("liste", "Ce qui s'empile, d'un geste", "Cartes en attente, rappels sans date ou en double, articles pris, vieux fils, idées : tout est réuni dans « À trancher », sur Aujourd'hui. Oui, Non, Plus tard… toujours avec « Annuler »."),
    p("calendrier", "Le dimanche, 10 minutes", "Ta semaine par projet, tes idées, trois décisions pour la suite, et ce que Rémy a remarqué la nuit. Sans IA en plus. Réglages › À trancher et revue pour la couper."),
    p("retour", "De retour après une absence ?", "Après plus de 3 jours, Rémy propose de trier tes retards ligne par ligne : Fait, Demain ou Abandonner."),
  ]),
  // Remplacée (12/11) par « prochaines-heures » dès que la tour propose
  // elle-même le classement (priorites-v2) ; d'ici là, plus présentée d'office.
  n("priorites", 3, "24 oct.", "Dis à Rémy ce qui compte", "priorites-v1", [
    p("etoile", "Tes 3 à 5 priorités", "Réglages › Ce qui compte : Rémy te propose ce qu'il a compris, tu confirmes ou tu corriges. Le conseil du moment et la réflexion de nuit s'en servent, et un conseil qui sert une priorité le dit."),
    p("horloge", "Ce qui n'a pas bougé", "Sans trace d'activité depuis une semaine, une priorité est marquée « négligée », avec sa dernière trace. Chaque version reste sur ta tour."),
  ], { aRemplacer: true }),
  n("carnet-remy", 3, "24 oct.", "Les courses et les rappels, en parlant", "carnet-outils-v1", [
    p("liste", "« Ajoute du lait »", "Rémy te propose l'article dans Courses, et « rappelle-moi d'appeler Léa demain à 9 h » devient un rappel, pas une tâche Motion. Rien n'est écrit avant « Ajouter »."),
  ]),
  n("propositions-notif", 3, "24 oct.", "Les propositions viennent à toi", "propositions-attente-v1", [
    p("cloche", "Une notification, puis ton geste", "Les tâches proposées par tes règles et les sujets de plus pour la nuit arrivent en notification Windows. Clique-la : la proposition t'attend, rien ne part sans ton « Oui »."),
  ]),
  n("fil-du-jour", 3, "24 oct.", "Plus léger au quotidien", null, [
    p("graphique", "Ce que tu utilises vraiment", "Réglages › Ce que tu utilises vraiment : les gestes que tu fais le plus, et ceux que tu ne touches jamais. Compté sur cet ordinateur, sans aucun contenu, et rien ne part."),
  ]),
  n("capture-hors-ligne", 3, "25 oct.", "Noté sans réseau, envoyé ensuite", null, [
    p("plateauEnvoi", "Rien ne se perd", "Tour injoignable : une tâche, une idée, « Retenir » ou un dossier noté avec « Noter » attend sur cet ordinateur, et part dès que Rémy répond. Une seule fois : jamais deux tâches dans Motion."),
    p("liste", "« En attente d'envoi »", "En bas du rail, l'état de la tour : clique-le pour voir ce qui attend, l'envoyer tout de suite ou le retirer. Un refus de Motion y reste, avec sa raison."),
    p("calendrier", "Des échéances comprises", "« cette semaine » : jusqu'à dimanche soir. « fin octobre » : le 31. « avant mardi » : la veille au soir. Un flou comme « mi-novembre » reste dans le titre."),
  ]),
  n("recherche-web", 3, "25 oct.", "Rémy cherche sur le web", "recherche-locale-v1", [
    p("globe", "Lui-même, sans Claude", "Une question récente, chiffrée ou réglementaire : Rémy cherche sur le web (DuckDuckGo) et lit les pages, avec le modèle de ta tour. Rien ne part chez Claude."),
    p("coche", "Ses sources, et ce qui reste à vérifier", "Il cite le site, le lien et la date. Un chiffre qu'aucune page lue ne contient est signalé « à vérifier ». Une conversation privée ne cherche pas, sauf permission."),
    p("curseurs", "À ta main", "Réglages › Rémy › Recherche web pour la couper : Rémy répond alors sans le web."),
  ]),
  n("modele", 2, "21 oct.", "Choisis le modèle de Rémy", "modeles-v1", [
    p("cpu", "Rémy suit tes Sparks", "Quand tu charges un autre modèle sur tes Sparks, Rémy le suit tout seul. Son nom s'affiche sous chaque réponse et dans la jauge."),
    p("curseurs", "Ou fixe-le toi-même", "Réglages › Modèle : garde « Automatique », ou choisis un modèle parmi ceux que tes Sparks servent. Claude n'est pas dans la liste : tes conversations restent chez toi."),
  ]),
  n("lieux", 2, "21 oct.", "Rémy sait où tu en es", "lieux-v1", [
    p("lieu", "Allumée depuis l'iPhone", "La localisation s'allume sur l'iPhone. Ici, Réglages › Localisation montre où ta tour croit que tu es, tes visites du jour et tes lieux."),
    p("lieu", "Le coiffeur, le drive, la salle", "Les adresses et les commerces sont reconnus sur ta tour : « sans doute Salon Lumière (coiffeur) ». Aucune position ne part ailleurs."),
    p("crayon", "Nomme tes lieux", "Clique un lieu pour le renommer, clic droit pour l'oublier. Gardé 90 jours, puis effacé."),
  ]),
  n("regles", 1, "20 oct.", "Les règles de Rémy", "regles-v1", [
    p("liste", "Avant X, fais Y", "Dis-lui « avant une sortie, propose-moi de me raser » : il te propose une règle. Ensuite, il relit ton agenda et te propose la tâche — jamais sans ton « Oui »."),
  ]),
];

/**
 * Les entrées retirées (12/11), et pourquoi — les mêmes que l'iPhone. Leur id
 * ne resservira pas : un état gardé sous cet id est ignoré.
 */
export const RETIREES = Object.freeze({
  jauge: "remplacée par « jauge-retour »",
  compactage: "doublon de « jauge-retour » (le résumé à 70 %)",
  "bilan-coucher": "annonce passée ; couverte par « rituel »",
});
/** Présentées d'office au lancement : les deux dernières séries du catalogue. */
export const SERIES_PRESENTEES = 2;
/** Au plus, par feuille : une mise à jour n'est pas un cours magistral. */
export const PAGES_MAX = 6;
/** Avant le suivi : les ids « vus », lus une fois pour la reprise. */
export const CLE_VUES = "remy-nouveautes-vues";

/**
 * Ce qu'une feuille montre : des entrées entières, dans l'ordre, tant
 * qu'elles tiennent dans `pagesMax` pages — au moins une. Jamais une entrée
 * coupée ; les suivantes attendent le lancement suivant.
 */
export function lot(entrees, pagesMax = PAGES_MAX) {
  const pris = [];
  let pages = 0;
  for (const e of entrees) {
    if (pris.length && pages + e.pages.length > pagesMax) break;
    pris.push(e);
    pages += e.pages.length;
  }
  return pris;
}

/** Les pages d'un lot, chacune avec son entrée. */
export const pagesDe = (entrees) => entrees.flatMap((e) => e.pages.map((page) => ({ nouveaute: e, page })));

/**
 * La feuille ayant atteint la page `index` (0 : la première) : chaque entrée
 * atteinte et sa page la plus loin (une entrée dépassée a été vue en entier).
 */
export function avancement(entrees, index) {
  let debut = 0;
  const r = [];
  for (const e of entrees) {
    if (debut <= index) r.push({ nouveaute: e, page: Math.min(index - debut, Math.max(0, e.pages.length - 1)) });
    debut += e.pages.length;
  }
  return r;
}

/** Les entrées dont au moins une page a été affichée, la feuille ayant atteint la page `index` (0 : la première). */
export const entreesJusqua = (entrees, index) => avancement(entrees, index).map((x) => x.nouveaute);

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
/** « 12 nov. » : le jour d'un état du suivi, à l'heure de Paris (comme l'iPhone). */
export function jour(ms) {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "numeric" }).formatToParts(new Date(ms));
  const v = (t) => Number(parts.find((x) => x.type === t)?.value || 1);
  return `${v("day")} ${MOIS[Math.max(0, Math.min(11, v("month") - 1))]}`;
}

/** « 3 à découvrir · 1 commencé · 22 suivis ». */
export const resume = (aDecouvrir, commences, suivis) =>
  `${aDecouvrir} à découvrir · ${commences} commencé${commences > 1 ? "s" : ""} · ${suivis} suivi${suivis > 1 ? "s" : ""}`;

/** La forme de l'état (pas la couleur seule) et son mot. */
export const ETATS = Object.freeze({
  aDecouvrir: Object.freeze({ mot: "À découvrir", icone: "etincelles" }),
  commence: Object.freeze({ mot: "Commencé", icone: "horloge" }),
  suivi: Object.freeze({ mot: "Suivi", icone: "coche" }),
});

/**
 * Le modèle des nouveautés (NouveautesModel) : le suivi gardé dans `local`
 * ({ id: { etat, page, date, repris? } }, relu à chaque appel : plusieurs
 * modèles vivent dans la page). Sans suivi, une installation d'avant reprend
 * ses « vus » (CLE_VUES) en « commencés » ; une installation neuve ne se voit
 * présenter que la dernière série. `sait` : la tour connaît-elle une capacité ?
 */
export function modele({ catalogue = CATALOGUE, sait = () => false, cle = CLE_VUES, retirees = Object.keys(RETIREES), maintenant = () => Date.now() } = {}) {
  const base = cle.replace(/-vues$/, "");
  const cleSuivi = `${base}-suivi`;
  const cleDepart = `${base}-depart`;
  const horsCatalogue = new Set(retirees);
  const derniere = Math.max(0, ...catalogue.filter((e) => !horsCatalogue.has(e.id)).map((e) => e.serie));
  const lire = () => {
    const s = local.lire(cleSuivi, null);
    return s && typeof s === "object" && !Array.isArray(s) ? s : {};
  };
  const ecrire = (s) => local.ecrire(cleSuivi, s);
  if (local.lire(cleSuivi, null) == null) {
    const vues = local.lire(cle, null);
    if (Array.isArray(vues)) {
      // La reprise des « vus » : « commencé », pas « suivi » — un vu disait
      // seulement qu'une page avait été affichée (ou rien, pour l'historique
      // marqué vu au premier lancement). Rien ne redevient « à découvrir ».
      const t = maintenant();
      ecrire(Object.fromEntries(vues.filter((x) => typeof x === "string").map((id) => [id, { etat: "commence", page: 0, date: t, repris: true }])));
      local.ecrire(cleDepart, 0);
    } else {
      ecrire({});
      local.ecrire(cleDepart, derniere);
    }
  }
  const serieDepart = Number(local.lire(cleDepart, 0)) || 0;
  const m = {
    existe: (e) => !e.capacite || Boolean(sait(e.capacite)),
    suivi: (e) => lire()[e.id] || null,
    etat: (e) => lire()[e.id]?.etat || "aDecouvrir",
    estNouvelle: (e) => m.etat(e) === "aDecouvrir",
    /** Le catalogue vivant : sans les retirées, ni celles dont la remplaçante est là (et connue de la tour). */
    actives: () => {
      const remplacees = new Set(catalogue.filter((e) => e.remplace && !horsCatalogue.has(e.id) && m.existe(e)).map((e) => e.remplace));
      return catalogue.filter((e) => !horsCatalogue.has(e.id) && !remplacees.has(e.id));
    },
    /** L'historique (Réglages › Nouveautés) : la plus récente d'abord, l'ordre du catalogue dans une série. */
    historique: () => m.actives().map((e, i) => [e, i]).sort((a, b) => (a[0].serie !== b[0].serie ? b[0].serie - a[0].serie : a[1] - b[1])).map((x) => x[0]),
    /** La plus ancienne série encore présentée d'office. */
    serieMinimale: () => Math.max(derniere - SERIES_PRESENTEES + 1, serieDepart),
    presentable: (e) => m.estNouvelle(e) && !e.aRemplacer && e.serie >= m.serieMinimale() && m.existe(e),
    /** Au lancement : les présentables, de la plus ancienne série à la plus récente (une feuille, ≤ 6 pages). */
    aMontrer: () => lot(m.actives().filter(m.presentable).map((e, i) => [e, i]).sort((a, b) => a[0].serie - b[0].serie || a[1] - b[1]).map((x) => x[0])),
    /** Ouvrir depuis le suivi : un commencé reprend à sa page la plus loin. */
    lotPour: (e) => {
      const s = m.suivi(e);
      return { entrees: [e], depart: s?.etat === "commence" ? Math.min(s.page || 0, Math.max(0, e.pages.length - 1)) : 0 };
    },
    /** Une feuille affiche la page `index` de `entrees` : commencé, ou suivi à la dernière page. Jamais en arrière. */
    noter: (entrees, index, t = maintenant()) => {
      const s = lire();
      let change = false;
      for (const { nouveaute: e, page } of avancement(entrees, index)) {
        const fini = page >= e.pages.length - 1;
        const avant = s[e.id];
        if (!avant) {
          s[e.id] = { etat: fini ? "suivi" : "commence", page, date: t };
          change = true;
          continue;
        }
        const x = { ...avant, page: Math.max(avant.page || 0, page) };
        if (x.repris) {
          delete x.repris;
          x.date = t;
        }
        if (fini && x.etat !== "suivi") Object.assign(x, { etat: "suivi", date: t });
        if (JSON.stringify(x) !== JSON.stringify(avant)) {
          s[e.id] = x;
          change = true;
        }
      }
      if (change) ecrire(s);
    },
    compte: (etat) => m.actives().filter((e) => m.etat(e) === etat && (etat !== "aDecouvrir" || m.existe(e))).length,
    /** Combien en découvrir (pastille du maître). */
    aDecouvrir: () => m.compte("aDecouvrir"),
    resume: () => resume(m.compte("aDecouvrir"), m.compte("commence"), m.compte("suivi")),
    /** À découvrir, commencés, suivis, puis ce qui attend la tour ; la plus récente d'abord. */
    groupes: () => {
      const h = m.historique();
      return [
        { id: "a-decouvrir", titre: "À découvrir", entrees: h.filter((e) => m.etat(e) === "aDecouvrir" && m.existe(e)) },
        { id: "commences", titre: "Commencés", entrees: h.filter((e) => m.etat(e) === "commence") },
        { id: "suivis", titre: "Suivis", entrees: h.filter((e) => m.etat(e) === "suivi") },
        { id: "tour", titre: "Avec la mise à jour de ta tour", entrees: h.filter((e) => m.etat(e) === "aDecouvrir" && !m.existe(e)) },
      ].filter((g) => g.entrees.length);
    },
    /** La ligne d'un tutoriel : son état en mots, sa date ; « page 2 sur 3 » pour un commencé. */
    libelle: (e) => {
      const s = m.suivi(e);
      let t;
      if (s?.etat === "suivi") t = `Suivi le ${jour(s.date)}`;
      else if (s?.repris) t = `Commencé · ouvert avant le ${jour(s.date)}`;
      else if (s) t = `Commencé le ${jour(s.date)}${e.pages.length > 1 ? ` · page ${Math.min(s.page || 0, e.pages.length - 1) + 1} sur ${e.pages.length}` : ""}`;
      else t = m.existe(e) ? `À découvrir · paru le ${e.date}` : `Arrive avec la mise à jour de ta tour · ${e.date}`;
      return e.aRemplacer ? `${t} · bientôt remplacé` : t;
    },
    /** Ce que « Tout marquer comme suivi » rangerait (la tour connaît la fonction). */
    aMarquer: () => m.actives().filter((e) => m.existe(e) && m.etat(e) !== "suivi"),
    /** Tout ranger d'un geste ; rend { n, annuler } (l'état d'avant revient tel quel). */
    toutMarquerSuivi: (t = maintenant()) => {
      const a = m.aMarquer();
      const avant = lire();
      if (!a.length) return { n: 0, annuler: () => {} };
      const s = { ...avant };
      for (const e of a) s[e.id] = { etat: "suivi", page: Math.max(0, e.pages.length - 1), date: t };
      ecrire(s);
      return { n: a.length, annuler: () => ecrire(avant) };
    },
  };
  return m;
}

// --- La feuille paginée ---

/**
 * Ouvre le tutoriel d'un lot : « Nouveau · i/N », « Plus tard », titre et
 * texte, puis « Suivant » ou « C'est parti ». ← et → tournent les pages,
 * Échap vaut « Plus tard ». `depart` : la page où elle s'ouvre (reprise) ;
 * `surPage(i)` : chaque page affichée, dès l'ouverture (le suivi la note).
 * Rend une promesse : la page la plus loin affichée.
 */
export function ouvrirFeuille(entrees, { titre = "Nouveautés", depart = 0, surPage = () => {} } = {}) {
  const pages = pagesDe(entrees);
  let index = Math.max(0, Math.min(pages.length - 1, depart));
  let atteinte = index;
  const compteur = h("span", { class: "nouveautes-compteur mono" });
  const corps = h("div", { class: "nouveautes-page", "aria-live": "polite" });
  const suivant = bouton("Suivant", { classe: "plein large", onclick: () => (index < pages.length - 1 ? aller(index + 1) : f.fermer("fini")) });
  const plusTard = bouton("Plus tard", { classe: "texte", onclick: () => f.fermer("plus-tard") });
  const dessiner = () => {
    const { nouveaute, page } = pages[index];
    compteur.textContent = pages.length > 1 ? `Nouveau · ${index + 1}/${pages.length}` : "Nouveau";
    vider(corps,
      h("span", { class: "nouveautes-icone", "aria-hidden": "true" }, icone(page.icone)),
      h("div", { class: "nouveautes-sur-titre mono" }, nouveaute.titre.toUpperCase()),
      h("h3", null, page.titre),
      h("p", null, page.texte));
    suivant.querySelector(".lib").textContent = index < pages.length - 1 ? "Suivant" : "C'est parti";
  };
  const aller = (i) => {
    index = Math.max(0, Math.min(pages.length - 1, i));
    atteinte = Math.max(atteinte, index);
    dessiner();
    surPage(index);
  };
  const f = feuille({
    titre,
    classe: "nouveautes-feuille",
    contenu: [h("div", { class: "nouveautes-tete" }, compteur, plusTard), corps],
    pied: [suivant],
  });
  f.el.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      aller(index + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      aller(index - 1);
    }
  });
  dessiner();
  surPage(index);
  suivant.focus();
  return f.fini.then(() => atteinte);
}

/** Ouvrir une entrée depuis Réglages › Nouveautés : un commencé reprend à sa page ; chaque page est notée. */
export async function revoir(e, m) {
  const l = m.lotPour(e);
  await ouvrirFeuille(l.entrees, { titre: e.titre, depart: l.depart, surPage: (i) => m.noter(l.entrees, i) });
}

/**
 * Au lancement (main.js), une fois : les nouveautés présentables (à
 * découvrir, des deux dernières séries), jamais par-dessus une autre feuille
 * ni pendant une saisie (réessayé un peu plus tard, au plus quelques fois).
 * Chaque page affichée est notée (commencé, puis suivi).
 */
export function auLancement({ sait, essais = 6, attente = 20000 } = {}) {
  const m = modele({ sait });
  const essayer = (reste) => {
    const entrees = m.aMontrer();
    if (!entrees.length) return;
    const actif = document.activeElement;
    const saisie = actif && (actif.isContentEditable || (/^(INPUT|TEXTAREA)$/.test(actif.tagName) && actif.value));
    if (document.querySelector("dialog[open]") || saisie || document.visibilityState !== "visible") {
      if (reste > 0) setTimeout(() => essayer(reste - 1), attente);
      return;
    }
    ouvrirFeuille(entrees, { surPage: (i) => m.noter(entrees, i) }).then((atteinte) => m.noter(entrees, atteinte));
  };
  essayer(essais);
}
