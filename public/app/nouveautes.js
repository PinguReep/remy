// Les nouveautés (port de Nouveautes.swift, 21/10) : à chaque mise à jour qui
// apporte une fonction visible, un mini tutoriel de une à trois pages, une
// fois, au lancement suivant — jamais par-dessus une autre feuille ni pendant
// une saisie, et seulement quand la tour connaît la fonction (sinon elle est
// encore cachée). Réglages › Nouveautés garde l'historique pour les revoir.
// Le catalogue reprend les entrées de l'iPhone qui valent sur l'ordinateur,
// textes adaptés (clic, clic droit, Réglages › Ordinateur) ; celles propres à
// l'iPhone (Siri et widgets, Partager, au pouce, conversation privée de
// l'iPhone, sélection) n'y sont pas.
// La logique est pure (le stockage passe par `local`, lu à l'appel) ; la
// feuille n'utilise le document qu'à l'ouverture : importable sous node.
import { h, vider, icone, bouton, feuille, local } from "./ui.js";

const p = (icone, titre, texte) => Object.freeze({ icone, titre, texte });
const n = (id, serie, date, titre, capacite, pages) => Object.freeze({ id, serie, date, titre, capacite, pages });

export const CATALOGUE = [
  n("conversations-externes", 5, "29 oct.", "Tes conversations d'ailleurs, ici", "conversations-externes-v1", [
    p("conversations", "Claude Code, T3, ChatGPT", "La vue Conversations : tes sessions Claude Code et tes fils T3 Code, lus par ta tour. Par source, par jour, ou cherche un mot : la conversation s'ouvre au message trouvé."),
    p("envoyer", "ChatGPT en un geste", "Dans ChatGPT : Réglages › Contrôle des données › Exporter. Puis Réglages › Sources des conversations › « Importer un export ChatGPT », et choisis le .zip reçu par mail."),
    p("cadenas", "Rien ne repart", "Tout est chiffré sur ta tour ; rien ne retourne chez Claude ni chez OpenAI. Rémy s'en inspire avec son modèle local, et la nuit en tire thèmes et choses à faire."),
  ]),
  n("reglages-recherche", 5, "29 oct.", "Chercher dans les réglages", null, [
    p("recherche", "Va droit au réglage", "En haut de Réglages (ou avec Ctrl+K), tape ce que tu cherches : « notif », « jauge », « privé »… Entrée ouvre le premier résultat, le réglage mis en évidence."),
  ]),
  n("bilan-coucher", 5, "29 oct.", "Le bilan, avant de te coucher", "rituel-v1", [
    p("lune", "22 h 45 par défaut", "Allumé sans heure choisie, le bilan du soir arrive désormais à 22 h 45 (21 h 30 avant). Une heure que tu avais choisie reste la tienne : Réglages › Ordinateur."),
  ]),
  n("jauge-retour", 4, "27 oct.", "La jauge du contexte, de retour", "jauge-v1", [
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
    p("calendrier", "Le dimanche, 10 minutes", "Ta semaine par projet, tes idées, trois décisions pour la suite, et ce que Rémy a remarqué la nuit. Sans IA en plus. Réglages › Revue du dimanche pour la couper."),
    p("retour", "De retour après une absence ?", "Après plus de 3 jours, Rémy propose de trier tes retards ligne par ligne : Fait, Demain ou Abandonner."),
  ]),
  n("priorites", 3, "24 oct.", "Dis à Rémy ce qui compte", "priorites-v1", [
    p("etoile", "Tes 3 à 5 priorités", "Réglages › Ce qui compte : écris-les avec leur pourquoi. Le conseil du moment et la réflexion de nuit s'en servent, et un conseil qui sert une priorité le dit."),
    p("horloge", "Ce qui n'a pas bougé", "Sans trace d'activité depuis une semaine, une priorité est marquée « négligée », avec sa dernière trace. Chaque version reste sur ta tour."),
  ]),
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
    p("plateau", "Rien ne se perd", "Tour injoignable : une tâche, une idée, « Retenir » ou un dossier noté avec « Noter » attend sur cet ordinateur, et part dès que Rémy répond. Une seule fois : jamais deux tâches dans Motion."),
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
  n("jauge", 1, "20 oct.", "La jauge du contexte", "jauge-v1", [
    p("jauge", "Ce que Rémy a en tête", "Le cadran, en haut du chat, montre la place prise dans la mémoire de travail du modèle."),
    p("jauge", "Clique-le", "La place prise et d'où elle vient, la vitesse de la dernière réponse, la moyenne du fil, et le modèle qui a répondu."),
  ]),
  n("compactage", 1, "20 oct.", "Les longues conversations se compactent", "compactage-v1", [
    p("compresser", "Rien n'est effacé", "Dès 70 % du contexte, le modèle local résume le début du fil pour continuer. À la demande aussi, depuis la jauge."),
  ]),
  n("regles", 1, "20 oct.", "Les règles de Rémy", "regles-v1", [
    p("liste", "Avant X, fais Y", "Dis-lui « avant une sortie, propose-moi de me raser » : il te propose une règle. Ensuite, il relit ton agenda et te propose la tâche — jamais sans ton « Oui »."),
  ]),
];

/** Au plus, par feuille : une mise à jour n'est pas un cours magistral. */
export const PAGES_MAX = 6;
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

/** Les entrées dont au moins une page a été affichée, la feuille ayant atteint la page `index` (0 : la première). */
export function entreesJusqua(entrees, index) {
  let debut = 0;
  return entrees.filter((e) => {
    const vue = debut <= index;
    debut += e.pages.length;
    return vue;
  });
}

/**
 * Le modèle des nouveautés (NouveautesModel) : les vues gardées dans `local`
 * (ids des entrées dont une page au moins a été affichée). Au tout premier
 * lancement, seules celles de la dernière série sont nouvelles. `sait` : la
 * tour connaît-elle une capacité ?
 */
export function modele({ catalogue = CATALOGUE, sait = () => false, cle = CLE_VUES } = {}) {
  const lireVues = () => {
    const v = local.lire(cle, null);
    if (Array.isArray(v)) return new Set(v.filter((x) => typeof x === "string"));
    const derniere = Math.max(0, ...catalogue.map((x) => x.serie));
    const vues = new Set(catalogue.filter((x) => x.serie < derniere).map((x) => x.id));
    local.ecrire(cle, [...vues].sort());
    return vues;
  };
  let vues = lireVues();
  const m = {
    existe: (e) => !e.capacite || Boolean(sait(e.capacite)),
    estNouvelle: (e) => !vues.has(e.id),
    /** L'historique (Réglages › Nouveautés) : la plus récente d'abord, l'ordre du catalogue dans une série. */
    historique: () => catalogue.map((e, i) => [e, i]).sort((a, b) => (a[0].serie !== b[0].serie ? b[0].serie - a[0].serie : a[1] - b[1])).map((x) => x[0]),
    /** Combien en découvrir (sous-titre de la ligne). */
    aDecouvrir: () => catalogue.filter((e) => m.estNouvelle(e) && m.existe(e)).length,
    /** Au lancement : les nouveautés pas encore vues, dont la tour connaît la fonction (une feuille, ≤ 6 pages). */
    aMontrer: () => lot(catalogue.filter((e) => !vues.has(e.id) && m.existe(e)).map((e, i) => [e, i]).sort((a, b) => a[0].serie - b[0].serie || a[1] - b[1]).map((x) => x[0])),
    marquerVues: (entrees) => {
      vues = lireVues();
      for (const e of entrees) vues.add(typeof e === "string" ? e : e.id);
      local.ecrire(cle, [...vues].sort());
    },
  };
  return m;
}

// --- La feuille paginée ---

/**
 * Ouvre le tutoriel d'un lot : « Nouveau · i/N », « Plus tard », titre et
 * texte, puis « Suivant » ou « C'est parti ». ← et → tournent les pages,
 * Échap vaut « Plus tard ». Rend une promesse : la page la plus loin affichée.
 */
export function ouvrirFeuille(entrees, { titre = "Nouveautés" } = {}) {
  const pages = pagesDe(entrees);
  let index = 0;
  let atteinte = 0;
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
  suivant.focus();
  return f.fini.then(() => atteinte);
}

/** Revoir une entrée depuis Réglages › Nouveautés : vue dès qu'elle est ouverte. */
export async function revoir(e, m) {
  m.marquerVues([e]);
  await ouvrirFeuille([e], { titre: e.titre });
}

/**
 * Au lancement (main.js), une fois : les nouveautés non vues, jamais
 * par-dessus une autre feuille ni pendant une saisie (réessayé un peu plus
 * tard, au plus quelques fois). Vues : celles dont une page a été affichée.
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
    ouvrirFeuille(entrees).then((atteinte) => m.marquerVues(entreesJusqua(entrees, atteinte)));
  };
  essayer(essais);
}
