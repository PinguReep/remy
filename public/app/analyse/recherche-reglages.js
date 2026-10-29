// Chercher dans les réglages : le port de RechercheReglages.swift (29/10).
// Un index déclaratif de chaque ligne de Réglages (titre, sous-titre,
// mots-clés et synonymes, capacité de la tour qu'elle demande), et la même
// recherche que l'iPhone : mot à mot, sans accents ni majuscules ni ordre,
// les mots vides retirés, puis une faute de frappe tolérée quand rien ne
// correspond exactement. Sans IA, sans réseau.
// Les entrées propres au site (Ordinateur, Jeton, Agenda, Envoi en attente,
// Avancé) sont gardées ; celles qui n'existent que sur l'iPhone (Activité en
// direct, Siri, Partager, réglages d'iOS) n'y sont pas.
// Une nouvelle ligne dans Réglages = une entrée ici (test/site-recherche-reglages
// relit vues/reglages.js : une ancre absente de l'écran fait échouer).
// Module pur : importé par le site et par les tests node.

/**
 * Les sections de Réglages (le maître du site), dans l'ordre, par groupe.
 * Celles que la tour doit connaître : CAPACITE_SECTION, dans vues/reglages.js.
 */
export const SECTIONS = [
  { id: "ordinateur", titre: "Ordinateur", icone: "ecran", groupe: "Cet ordinateur" },
  { id: "apparence", titre: "Apparence", icone: "soleil", groupe: "Cet ordinateur" },
  { id: "noter", titre: "Noter", icone: "plus", groupe: "Cet ordinateur" },
  { id: "file", titre: "Envoi en attente", icone: "envoyer", groupe: "Cet ordinateur" },
  { id: "remy", titre: "Rémy", icone: "remy", groupe: "Rémy" },
  { id: "memoire", titre: "Ce que Rémy sait de toi", icone: "ampoule", groupe: "Rémy" },
  { id: "priorites", titre: "Ce qui compte", icone: "etoile", groupe: "Rémy" },
  { id: "modele", titre: "Modèle", icone: "cpu", groupe: "Rémy" },
  { id: "regles", titre: "Règles de Rémy", icone: "liste", groupe: "Rémy" },
  { id: "revue", titre: "À trancher et revue", icone: "calendrier", groupe: "Rémy" },
  { id: "activite", titre: "Activité du PC", icone: "ecran", groupe: "Ta tour" },
  { id: "lieux", titre: "Localisation", icone: "lieu", groupe: "Ta tour" },
  { id: "conversations", titre: "Sources des conversations", icone: "conversations", groupe: "Ta tour" },
  { id: "agenda", titre: "Agenda Google", icone: "horloge", groupe: "Ta tour" },
  { id: "appareils", titre: "Appareils connectés", icone: "cadenas", groupe: "Ta tour" },
  { id: "jeton", titre: "Jeton de capture", icone: "copier", groupe: "Ta tour" },
  { id: "couts", titre: "Coûts", icone: "jauge", groupe: "Suivi" },
  { id: "usage", titre: "Ce que tu utilises vraiment", icone: "graphique", groupe: "Suivi" },
  { id: "nouveautes", titre: "Nouveautés", icone: "etincelles", groupe: "Suivi" },
  { id: "diagnostic", titre: "Diagnostic", icone: "alerte", groupe: "Suivi" },
  { id: "avance", titre: "Avancé", icone: "curseurs", groupe: "Suivi" },
];
export const titreSection = (id) => SECTIONS.find((s) => s.id === id)?.titre || "Réglages";

// Ce dont dépend une ligne (ConditionReglage) :
// « capacite:x » la tour connaît x ; « rechercheWeb » la tour a dit ce réglage ;
// « contexteCloud » recherche web allumée et passant par Claude ; « recherchePrivee » ;
// « secours » le secours Claude a un objet ; « circuit:x » ; « briefingAllume »,
// « bilanAllume » (l'heure n'est affichée qu'alors) ; « bureau » (l'app Windows) ;
// « iphone » : la ligne n'existe que sur l'iPhone (jamais vraie ici).
const BUREAU = { condition: "bureau", ancre: "Ordinateur", note: "Ce réglage vit dans l'app Rémy pour Windows : un navigateur ne l'a pas." };

const entree = (id, titre, sous, section, { ancre = null, mots = [], si = [], repli = [], icone = null } = {}) =>
  Object.freeze({ id, titre, sous, section, ancre, mots, si, repli: [].concat(repli), icone });

/** Chaque réglage et chaque section de réglages, dans l'ordre de l'écran. */
export const INDEX = [
  entree("memoire", "Ce que Rémy sait de toi", "Ce qu'il retient de toi : le lire, le corriger.", "memoire",
    { mots: ["mémoire", "souvenirs", "profil", "connaissance", "retient", "corriger", "oublier", "personnel", "infos", "moi"] }),
  // L'app Windows (propre au site) : raccourci, démarrage, notifications.
  entree("ordinateur", "Ordinateur", "L'app Rémy pour Windows : raccourci, démarrage, notifications.", "ordinateur",
    { mots: ["windows", "app", "bureau", "pc", "ordinateur", "application", "installer", "horloge"] }),
  entree("ordinateur.raccourci", "Noter de n'importe où", "Le raccourci global qui ouvre « Noter » (Ctrl+Alt+Espace par défaut).", "ordinateur",
    { ancre: "Noter de n'importe où", mots: ["raccourci", "clavier", "ctrl", "alt", "espace", "global", "noter", "touche"], repli: BUREAU }),
  entree("ordinateur.demarrage", "Démarrer avec Windows", "La fenêtre se charge cachée ; les notifications tournent.", "ordinateur",
    { ancre: "Démarrer avec Windows", mots: ["démarrage", "session", "ouverture", "automatique", "lancer", "allumer"], repli: BUREAU }),
  entree("ordinateur.fermer", "Fermer = rester près de l'horloge", "La croix range Rémy dans la zone de notification.", "ordinateur",
    { ancre: "Fermer = rester près de l'horloge", mots: ["fermer", "croix", "zone de notification", "barre des tâches", "horloge", "quitter"], repli: BUREAU }),
  entree("ordinateur.rappels", "Notifications des rappels", "Une notification Windows quand un rappel tombe.", "ordinateur",
    { ancre: "Notifications des rappels", mots: ["notification", "notifications", "rappel", "rappels", "alerte", "sonner", "windows"], repli: BUREAU }),
  // Rendez-vous quotidien (rituel-v1), en notifications Windows.
  entree("rituel.matin", "Briefing du matin", "Ce qui compte, pourquoi, ce qui est menacé : une notification le matin.", "ordinateur",
    { ancre: "Briefing du matin", mots: ["notification", "notifications", "matin", "réveil", "rituel", "rendez-vous", "quotidien", "résumé", "journée", "alerte", "alarme", "programme"],
      si: ["capacite:rituel-v1"], repli: BUREAU }),
  entree("rituel.heureMatin", "Heure du briefing", "7 h 30 par défaut.", "ordinateur",
    { ancre: "Heure du briefing", mots: ["heure", "horaire", "matin", "réveil", "notification", "notifications", "quand", "7 h 30"],
      si: ["capacite:rituel-v1"], repli: [BUREAU, { condition: "briefingAllume", ancre: "Briefing du matin", note: "Allume d'abord « Briefing du matin » : l'heure s'affiche dessous." }] }),
  entree("rituel.soir", "Bilan du soir", "Fait, glissé, ce qui reste pour demain : 22 h 45 par défaut, avant de te coucher.", "ordinateur",
    { ancre: "Bilan du soir", mots: ["notification", "notifications", "soir", "coucher", "dodo", "rituel", "rendez-vous", "quotidien", "récap", "fin de journée", "point", "journée", "alarme"],
      si: ["capacite:rituel-v1"], repli: BUREAU }),
  entree("rituel.heureSoir", "Heure du bilan", "22 h 45 par défaut, avant de te coucher.", "ordinateur",
    { ancre: "Heure du bilan", mots: ["heure", "horaire", "soir", "coucher", "notification", "notifications", "quand", "22 h 45"],
      si: ["capacite:rituel-v1"], repli: [BUREAU, { condition: "bilanAllume", ancre: "Bilan du soir", note: "Allume d'abord « Bilan du soir » : l'heure s'affiche dessous." }] }),
  entree("ordinateur.propositions", "Propositions de Rémy", "Les tâches de tes règles et les sujets de plus pour la nuit, en notification.", "ordinateur",
    { ancre: "Propositions de Rémy", mots: ["notification", "notifications", "propositions", "règles", "nuit", "oui", "plus tard"], si: ["capacite:propositions-attente-v1"], repli: BUREAU }),
  entree("ordinateur.essai", "Tester une notification", "Pour vérifier que Windows les laisse passer.", "ordinateur",
    { ancre: "Tester une notification", mots: ["essai", "tester", "test", "notification", "windows", "autoriser"], repli: BUREAU }),
  entree("ordinateur.adresse", "Adresse de la tour", "L'adresse que l'app Windows ouvre.", "ordinateur",
    { ancre: "Adresse de la tour", mots: ["adresse", "url", "tour", "tailscale", "serveur", "changer"], repli: BUREAU }),
  entree("capture", "Une pensée sans action claire", "Où va ce que tu notes sans verbe d'action : dans les Idées, ou dans Motion.", "noter",
    { ancre: "Une pensée sans action claire", mots: ["capture", "capturer", "noter", "note", "idée", "idées", "motion", "tâche", "plus", "dossier", "pensée", "par défaut", "ranger"],
      si: ["capacite:dossiers-v1"] }),
  entree("usage", "Ce que tu utilises vraiment", "Tes gestes, comptés sur cet ordinateur, sans aucun contenu.", "usage",
    { mots: ["usage", "utilisation", "statistiques", "stats", "compteurs", "fonctions", "gestes", "habitudes"] }),
  entree("usage.zero", "Remettre les compteurs à zéro", "Les gestes comptés sur cet ordinateur.", "usage",
    { ancre: "Remettre les compteurs à zéro", mots: ["réinitialiser", "effacer", "remise à zéro", "compteurs", "statistiques", "usage", "reset"] }),
  entree("couts", "Coût des 30 derniers jours", "Ce que les appels aux modèles ont coûté.", "couts",
    { ancre: "Coût des 30 derniers jours", mots: ["coût", "coûts", "prix", "dépenses", "argent", "facture", "budget", "dollars", "euros", "tokens", "combien"] }),
  entree("apparence", "Apparence", "Comme Windows, clair ou sombre.", "apparence",
    { ancre: "Apparence", mots: ["thème", "sombre", "clair", "mode sombre", "mode nuit", "dark", "couleurs", "noir", "blanc", "affichage", "écran"] }),
  entree("liens", "Prévenir avant d'ouvrir un lien", "Lire une page web coûte un peu plus qu'un message.", "remy",
    { ancre: "Prévenir avant d'ouvrir un lien", mots: ["lien", "liens", "url", "page", "web", "confirmation", "confirmer", "avertir", "coût"] }),
  entree("web", "Recherche web", "Rémy cherche sur le web quand il en a besoin.", "remy",
    { ancre: "Recherche web", mots: ["internet", "web", "google", "duckduckgo", "searxng", "chercher", "en ligne", "navigateur"], si: ["rechercheWeb"] }),
  entree("contexte", "Envoi de contexte au cloud", "Ce qui part avec une recherche autorisée.", "remy",
    { ancre: "Envoi de contexte au cloud", mots: ["cloud", "contexte", "claude", "anthropic", "vie privée", "confidentialité", "données", "privé", "envoi"], si: ["contexteCloud"] }),
  entree("privee", "Recherche dans les conversations privées", "Coupée par défaut : une conversation privée ne cherche jamais sur le web.", "remy",
    { ancre: "Recherche dans les conversations privées", mots: ["privé", "privée", "privées", "confidentialité", "cadenas", "secret", "web", "vie privée"], si: ["recherchePrivee"] }),
  entree("secours", "Secours Claude si la tour ne répond pas", "Coupé par défaut : rien ne part chez Anthropic.", "remy",
    { ancre: "Secours Claude si la tour ne répond pas", mots: ["claude", "anthropic", "cloud", "secours", "panne", "tour éteinte", "hors ligne", "vie privée", "privé", "modèle de secours"], si: ["secours"] }),
  entree("circuit.nuit", "Réflexion de la nuit", "Rémy relit tes échanges et prépare le briefing du matin.", "remy",
    { ancre: "Réflexion de la nuit", mots: ["nuit", "nocturne", "réflexion", "préparation", "relire", "sujets de la nuit", "briefing"], si: ["circuit:nuit"] }),
  entree("circuit.conseil", "Conseil réfléchi", "Le modèle local prépare le conseil du moment.", "remy",
    { ancre: "Conseil réfléchi", mots: ["conseil", "conseil du moment", "suggestion", "ia", "modèle local"], si: ["circuit:conseil"] }),
  entree("circuit.compactage", "Compacter les longues conversations", "Dès 70 % du contexte, le début du fil est résumé, rien n'est effacé.", "remy",
    { ancre: "Compacter les longues conversations", mots: ["compactage", "compacter", "résumé", "résumer", "70 %", "contexte", "jauge", "longues conversations"], si: ["circuit:compactage"] }),
  entree("remy.peremption", "Ancienneté d'une proposition", "Au-delà, « Oui » demande de confirmer.", "remy",
    { ancre: "Ancienneté d'une proposition", mots: ["proposition", "périmée", "vieille", "jours", "confirmer", "ancienne"] }),
  entree("modeles", "Modèle", "Le modèle local avec lequel Rémy répond, sur tes Sparks.", "modele",
    { mots: ["modèle", "modèles", "ia", "intelligence", "cerveau", "glm", "deepseek", "llm", "sparks", "changer"], si: ["capacite:modeles-v1"] }),
  entree("lieux", "Localisation", "Où ta tour croit que tu es, tes visites et tes lieux.", "lieux",
    { ancre: "Localisation", mots: ["localisation", "lieux", "lieu", "position", "gps", "où je suis", "voiture", "trajets", "visites", "carte", "géolocalisation", "batterie"], si: ["capacite:lieux-v1"] }),
  entree("lieux.pause", "Pause 2 h", "Couper la localisation pendant deux heures, depuis l'iPhone.", "lieux",
    { ancre: "Pause 2 h", mots: ["pause", "suspendre", "localisation", "position", "discret", "2 h"], si: ["capacite:lieux-v1"],
      repli: { condition: "iphone", ancre: "Localisation", note: "La pause se met depuis l'iPhone : ici, la localisation se lit et se range." } }),
  entree("lieux.nommer", "Nommer un lieu", "Rémy le reconnaîtra à chaque passage.", "lieux",
    { ancre: "Tes lieux", mots: ["nommer", "lieu", "maison", "travail", "ici", "adresse", "renommer", "position", "oublier"], si: ["capacite:lieux-v1"] }),
  entree("lieux.effacer", "Effacer l'historique des lieux", "Les visites gardées sur ta tour ; tes lieux nommés restent.", "lieux",
    { ancre: "Effacer l'historique", mots: ["effacer", "supprimer", "historique", "positions", "visites", "oublier", "localisation"], si: ["capacite:lieux-v1"] }),
  entree("activitePC", "Activité du PC", "Le temps passé dans tes applis, d'après ActivityWatch.", "activite",
    { ancre: "Activité du PC", mots: ["pc", "ordinateur", "activitywatch", "temps d'écran", "applis", "applications", "windows", "productivité"], si: ["capacite:activite-pc-v1"] }),
  entree("activitePC.exclure", "Ne plus compter une appli", "Une appli ou un site jamais comptés.", "activite",
    { ancre: "Ne plus compter une appli…", mots: ["exclure", "exclusion", "ignorer", "appli", "site", "jamais comptées", "pc"], si: ["capacite:activite-pc-v1"] }),
  entree("activitePC.effacer", "Effacer l'activité du PC", "Tout ce que la tour a relevé d'ActivityWatch.", "activite",
    { ancre: "Tout effacer", mots: ["effacer", "supprimer", "historique", "activité", "pc", "ordinateur"], si: ["capacite:activite-pc-v1"] }),
  // Tes conversations d'ailleurs (conversations-externes-v1) : les sources, l'import ChatGPT.
  entree("sourcesConversations", "Sources des conversations", "Claude Code, T3 Code, ChatGPT : lues sur ta tour, chiffrées.", "conversations",
    { mots: ["conversations", "conversation", "sources", "ChatGPT", "OpenAI", "Claude Code", "Claude", "T3", "T3 Code", "import", "importer", "export", "sessions", "fils", "historique", "discussions", "chats", "ailleurs", "lire maintenant"],
      si: ["capacite:conversations-externes-v1"] }),
  entree("sourcesConversations.import", "Importer un export ChatGPT", "Le .zip reçu par mail depuis ChatGPT, envoyé à ta tour.", "conversations",
    { ancre: "Importer un export ChatGPT", mots: ["import", "importer", "export", "exporter", "ChatGPT", "OpenAI", "zip", "fichier", "conversations", "historique", "envoyer"], si: ["capacite:conversations-externes-v1"] }),
  entree("sourcesConversations.chat", "S'en inspirer dans ses réponses", "Quand ta question en parle : quelques passages, modèle local seulement, la conversation devient privée.", "conversations",
    { ancre: "S'en inspirer dans ses réponses", mots: ["conversations", "ChatGPT", "Claude Code", "T3", "passages", "contexte", "réponses", "s'inspirer", "modèle local"], si: ["capacite:conversations-externes-v1"] }),
  entree("sourcesConversations.nuit", "Relire celles de la veille, la nuit", "Thèmes, décisions, choses à faire : une ligne dans ton briefing.", "conversations",
    { ancre: "Relire celles de la veille, la nuit", mots: ["conversations", "ChatGPT", "Claude Code", "T3", "nuit", "veille", "hier", "briefing", "thèmes", "choses à faire", "propositions"], si: ["capacite:conversations-externes-v1"] }),
  entree("sourcesConversations.effacer", "Effacer les conversations d'ailleurs", "Tout ce que la tour a gardé de Claude Code, T3 et ChatGPT.", "conversations",
    { ancre: "Tout effacer de la tour", mots: ["effacer", "supprimer", "oublier", "conversations", "ChatGPT", "Claude Code", "T3", "import", "clé", "vie privée"], si: ["capacite:conversations-externes-v1"] }),
  entree("priorites", "Ce qui compte", "Tes 3 à 5 priorités : le conseil et la nuit s'en servent.", "priorites",
    { mots: ["priorités", "priorité", "objectifs", "important", "focus", "valeurs"], si: ["capacite:priorites-v1"] }),
  entree("regles", "Règles de Rémy", "Les tâches à faire avant un type d'événement.", "regles",
    { mots: ["règles", "règle", "automatisme", "automatique", "avant", "événement", "si alors", "routine"], si: ["capacite:regles-v1"] }),
  entree("circuit.regles", "Vérifier les règles", "Toutes les 3 h, sans IA : ton agenda et Motion relus.", "remy",
    { ancre: "Vérifier les règles", mots: ["règles", "vérification", "automatique", "3 h", "agenda", "motion"], si: ["circuit:regles"] }),
  entree("appareils", "Appareils connectés", "Déconnecte un iPhone perdu ou prêté.", "appareils",
    { mots: ["appareils", "iphone", "ipad", "perdu", "volé", "prêté", "sessions", "jetons", "sécurité", "déconnecter"], si: ["capacite:appareils"] }),
  entree("jeton", "Jeton de capture", "Pour le raccourci « Envoyer à Rémy » de l'iPhone : il ne sert qu'à noter.", "jeton",
    { mots: ["jeton", "capture", "raccourci", "partage", "siri", "iphone", "token", "clé"] }),
  entree("agenda", "Agenda Google", "Connecter, tester ou déconnecter ton agenda.", "agenda",
    { mots: ["agenda", "google", "calendrier", "connexion", "rendez-vous", "calendar"] }),
  entree("file", "Envoi en attente", "Ce que tu as noté pendant que la tour ne répondait pas.", "file",
    { mots: ["file", "attente", "hors ligne", "envoi", "envoyer", "captures", "réseau", "en attente", "renvoyer"] }),
  entree("nouveautes", "Nouveautés", "Les tutoriels des mises à jour, à revoir.", "nouveautes",
    { mots: ["nouveautés", "nouveau", "quoi de neuf", "mise à jour", "mises à jour", "tutoriel", "tutoriels", "aide", "astuces"] }),
  entree("aTrancher", "À trancher", "Cartes, rappels, articles, vieux fils, idées : un geste chacun.", "revue",
    { ancre: "À trancher", mots: ["trancher", "trier", "tri", "ménage", "ranger", "vieux fils", "cartes", "en attente", "décider"], si: ["capacite:a-trancher-v1"] }),
  entree("revue", "Revue de la semaine", "Fait, glissé, idées, trois décisions. Sans IA.", "revue",
    { ancre: "Revue de la semaine", mots: ["revue", "semaine", "hebdo", "hebdomadaire", "bilan de la semaine", "dimanche", "rétrospective"], si: ["capacite:a-trancher-v1"] }),
  entree("revue.dimanche", "Revue du dimanche", "Proposée sur Aujourd'hui le dimanche, 10 minutes.", "revue",
    { ancre: "Revue du dimanche", mots: ["dimanche", "revue", "semaine", "hebdomadaire", "proposée"], si: ["capacite:a-trancher-v1"] }),
  entree("diagnostic", "Diagnostic", "Temps de réponse, jauge du chat, incidents.", "diagnostic",
    { mots: ["diagnostic", "debug", "débogage", "avancé", "avancés", "outils", "constructeur", "développeur", "technique", "erreur", "erreurs", "code d'erreur", "bug", "problème", "copier le diagnostic", "incidents"] }),
  entree("diagnostic.temps", "Temps de réponse", "Ce que prend chaque étape, ce poste et la tour.", "diagnostic",
    { ancre: "Temps de réponse", mots: ["lenteur", "lent", "latence", "vitesse", "performance", "mesures", "rapidité", "attente", "motion", "quota"] }),
  entree("diagnostic.jauge", "Jauge du contexte", "Le cadran en haut des conversations : la place prise, le résumé à 70 %.", "diagnostic",
    { ancre: "Jauge du contexte", mots: ["jauge", "contexte", "cadran", "70 %", "place", "tokens", "remplissage", "compteur"] }),
  entree("diagnostic.vitesse", "Vitesse de Rémy", "Les tokens par seconde sous chaque réponse.", "diagnostic",
    { ancre: "Vitesse de Rémy", mots: ["tokens par seconde", "tok/s", "vitesse", "débit", "rapidité", "performance"] }),
  entree("version", "Version de Rémy", "Le numéro du site et celui de ta tour.", "diagnostic",
    { ancre: "Version", mots: ["version", "build", "numéro", "serveur", "tour", "à jour"] }),
  entree("avance.classique", "Interface classique", "Le mode appel, l'onboarding guidé, la roadmap et la consigne de nuit.", "avance",
    { ancre: "Interface classique", mots: ["classique", "ancienne interface", "onboarding", "appel", "roadmap", "consigne"] }),
  entree("deconnexion", "Se déconnecter", "Il faudra retaper le mot de passe.", "avance",
    { ancre: "Se déconnecter", mots: ["déconnexion", "déconnecter", "quitter", "sortir", "compte", "mot de passe", "logout"] }),
];

/** Proposées quand rien ne correspond. */
export const SUGGESTIONS = ["Notifications", "Thème", "Modèle"];

/** Où il se trouve : « Réglages › Diagnostic » ; une section elle-même : « Réglages ». */
export const chemin = (e) => (e.ancre == null ? "Réglages" : `Réglages › ${titreSection(e.section)}`);

// --- Chercher ---

/** Les mots qui ne disent rien de ce qu'on cherche (« l'heure du bilan »). */
const VIDES = new Set(["de", "du", "des", "la", "le", "les", "l", "d", "un", "une", "a", "au", "aux", "en", "et", "pour", "dans", "sur", "mon", "ma", "mes",
  "ton", "ta", "tes", "ou", "je", "j", "me", "m", "qu", "que", "quoi", "est", "comment", "avec"]);

/** Sans accents ni majuscules ; « œ » devient « oe », « æ » « ae ». */
export const normaliser = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae");

/** Les mots d'un texte, normalisés (« tok/s » : « tok », « s »). */
export const mots = (s) => normaliser(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Les mots d'une saisie : sans ceux vides de sens, sauf s'il ne reste qu'eux. */
export function motsRequete(s) {
  const tous = mots(s);
  const utiles = tous.filter((m) => !VIDES.has(m));
  return utiles.length ? utiles : tous;
}

/** Ce que l'écran montre en ce moment permet-il cette condition ? */
export function permet(c, contexte = {}) {
  const r = contexte.reglages || null;
  const capacites = contexte.capacites instanceof Set ? contexte.capacites : new Set(contexte.capacites || []);
  if (c.startsWith("capacite:")) return capacites.has(c.slice(9));
  if (c.startsWith("circuit:")) return r?.circuits?.[c.slice(8)] != null;
  switch (c) {
    case "rechercheWeb": return r?.rechercheWeb != null;
    case "contexteCloud": return r != null && r.rechercheWeb === true && !moteur(r);
    case "recherchePrivee": return capacites.has("recherche-privee-v1") && r?.recherchePriveeReglage != null;
    case "secours": return r != null && r.secoursCloudSansObjet !== true;
    case "briefingAllume": return contexte.briefing === true;
    case "bilanAllume": return contexte.bilan === true;
    case "bureau": return contexte.bureau === true;
    case "iphone": return false;
    default: return false;
  }
}

/** Le moteur de la recherche locale (« duckduckgo » → « DuckDuckGo »), ou null : elle passe par Claude. */
export function moteur(r) {
  const m = String(r?.rechercheLocale ?? "").trim();
  if (!m) return null;
  return { duckduckgo: "DuckDuckGo", searxng: "SearXNG" }[m.toLowerCase()] || m;
}

/** Une entrée et ses mots normalisés : titre, mots-clés, le reste (sous-titre, chemin). */
const preparer = (e) => ({ e, titre: mots(e.titre), cles: e.mots.flatMap(mots), reste: [...mots(e.sous), ...mots(chemin(e))] });
let prepares = null;

/** Distance d'édition (Levenshtein), arrêtée dès qu'elle dépasse `seuil`. */
export function distance(a, b, seuil) {
  if (Math.abs(a.length - b.length) > seuil) return seuil + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prec = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cour = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cour[0] = i;
    let mini = cour[0];
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + cout);
      mini = Math.min(mini, cour[j]);
    }
    if (mini > seuil) return seuil + 1;
    [prec, cour] = [cour, prec];
  }
  return prec[b.length];
}

/** Une faute de frappe (lettre oubliée, en trop, changée) pour 4 à 7 lettres, deux dès 8 ; sur le mot entier ou un début de longueur voisine. */
export function proche(m, w) {
  const a = [...m];
  if (a.length < 4) return false;
  const permis = a.length >= 8 ? 2 : 1;
  const b = [...w];
  const candidats = [b];
  for (let l = Math.max(1, a.length - permis); l <= a.length + permis; l++) if (l < b.length) candidats.push(b.slice(0, l));
  return candidats.some((c) => distance(a, c, permis) <= permis);
}

/** La note d'un mot de la saisie contre une liste : le mot entier, son début, ou (tolérance) à une faute près, à demi-note. */
function note(m, liste, plein, debut, tolerance) {
  let meilleure = 0;
  for (const w of liste) {
    if (w === m) return plein;
    if (w.startsWith(m)) meilleure = Math.max(meilleure, debut);
    else if (tolerance && proche(m, w)) meilleure = Math.max(meilleure, Math.floor(debut / 2));
  }
  return meilleure;
}

/**
 * Les entrées dont chaque mot de la saisie trouve un mot (ou son début) dans
 * le titre (12, début 10), les mots-clés (9, 8), le sous-titre ou le chemin
 * (5, 4) ; +15 si le titre commence par la phrase entière. Les mieux notées
 * d'abord, l'ordre de l'écran à égalité.
 */
function classer(q, liste, tolerance) {
  const phrase = q.join(" ");
  const notes = [];
  liste.forEach((p, rang) => {
    let total = 0;
    for (const m of q) {
      const n = Math.max(note(m, p.titre, 12, 10, tolerance), note(m, p.cles, 9, 8, tolerance), note(m, p.reste, 5, 4, tolerance));
      if (!n) return;
      total += n;
    }
    if (p.titre.join(" ").startsWith(phrase)) total += 15;
    notes.push([total, rang, p.e]);
  });
  return notes.sort((x, y) => (x[0] !== y[0] ? y[0] - x[0] : x[1] - y[1])).map((x) => x[2]);
}

/**
 * Ce que montre la recherche pour une saisie : `entrees` (proposées),
 * `indisponibles` (la tour ne les propose pas, ou ses réglages ne sont pas
 * encore relus), `approchee` (trouvé en tolérant une faute), et les phrases
 * de l'écran (enTete, titreVide, detailVide). `index` : un autre index (tests).
 */
export function chercher(requete, contexte = {}, index = null) {
  const propre = String(requete ?? "").trim();
  const q = motsRequete(propre);
  const vide = { requete: propre, entrees: [], indisponibles: [], approchee: false, vide: !propre, enTete: null, titreVide: null, detailVide: null };
  if (!q.length) return vide;
  const liste = index ? index.map(preparer) : (prepares ||= INDEX.map(preparer));
  let trouves = classer(q, liste, false);
  let approchee = false;
  if (!trouves.length) {
    trouves = classer(q, liste, true);
    approchee = trouves.length > 0;
  }
  const dispo = trouves.filter((e) => e.si.every((c) => permet(c, contexte)));
  const indispo = trouves.filter((e) => !e.si.every((c) => permet(c, contexte)));
  const r = { ...vide, entrees: dispo, indisponibles: indispo, approchee: approchee && dispo.length > 0 };
  if (dispo.length) r.enTete = r.approchee ? `Rien d'exact pour « ${propre} » : ce qui s'en approche` : dispo.length === 1 ? "1 réglage" : `${dispo.length} réglages`;
  else {
    r.titreVide = `Rien ne correspond à « ${propre} ».`;
    r.detailVide = indispo.length
      ? `« ${indispo[0].titre} » dépend de ta tour, qui ne le propose pas pour l'instant (mise à jour de la tour, ou réglages pas encore relus).`
      : "Essaie un autre mot, ou l'un de ceux-ci :";
  }
  return r;
}

/** Le premier résultat (Entrée dans le champ). */
export const premier = (requete, contexte) => chercher(requete, contexte).entrees[0] || null;

/** Où aller : la section, la ligne (ou son repli si elle n'est pas affichée), et ce qu'on dit. */
export function cible(e, contexte = {}) {
  const r = e.repli.find((x) => !permet(x.condition, contexte));
  if (r) return { section: e.section, ancre: r.ancre, note: r.note };
  return { section: e.section, ancre: e.ancre, note: null };
}

/** Les entrées d'une section que la tour propose (pour Ctrl+K sans saisie, et les tests). */
export const entreesVisibles = (contexte) => INDEX.filter((e) => e.si.every((c) => permet(c, contexte)));
