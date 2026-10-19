// Les sessions guidées de l'onboarding — SOURCE DE VÉRITÉ UNIQUE.
//
// Le serveur en a besoin pour analyser les conversations passées, le client
// pour afficher le panneau : les dupliquer ferait diverger le pourcentage
// affiché et le pourcentage calculé. Le client les reçoit via GET /api/setup.
//
// Chaque session porte des REPÈRES : les choses concrètes que Rémy doit avoir
// apprises sur Sam pour que la section soit complète. C'est ce qui donne le
// pourcentage de complétion, et donc « combien de questions il reste ».

export const SESSIONS = [
  {
    id: "tete",
    icon: "🌪️",
    title: "Vider ta tête",
    desc: "Tout ce qui traîne — tâches, idées, trucs à ne pas oublier — sans classer.",
    prompt:
      "Rémy, on lance la session 1 de ta configuration : vider ma tête. Aide-moi à tout sortir — tâches, idées, engagements, trucs à ne pas oublier — sans rien classer pour l'instant. Groupe tes questions : toutes celles d'un même domaine dans un seul message, numérotées. Relance-moi par domaines (maison, admin, achats, projets, personnes…), et mémorise tout.",
    reperes: [
      { id: "vrac", label: "Une vraie liste de ce qui traîne", critere: "Au moins 8 éléments concrets et distincts, en attente, nommés par Sam lui-même : une tâche, un achat, un truc à ne pas oublier. Des choses actionnables (« rappeler le garage »), pas des catégories (« des trucs de voiture »). Une liste écrite par Rémy et non reprise par Sam ne compte pas." },
      { id: "plusieurs-domaines", label: "Plusieurs pans de ta vie balayés", critere: "Au moins 3 domaines distincts contiennent chacun un élément concret cité par Sam, parmi : maison, administratif, achats, travail, santé, véhicule, personnes, loisirs." },
      { id: "ce-qui-presse", label: "Ce qui a une date ou qui presse", critere: "Au moins 2 éléments portent une date, une échéance ou un délai donné par Sam (« avant le 15 », « cette semaine »). « Bientôt » ou « dès que possible » ne compte pas." },
      { id: "ce-qui-pese", label: "Ce qui te pèse le plus en ce moment", critere: "Sam a désigné lui-même 1 à 3 éléments qui lui pèsent le plus ou lui prennent la tête. Une liste sans hiérarchie ne suffit pas : il faut qu'il ait dit lesquels comptent le plus." },
      { id: "envies-sans-date", label: "Les envies que tu gardes sous le coude", critere: "Au moins une envie, idée ou intention sans échéance a été sortie par Sam (« un jour j'aimerais… », « faudrait que je me remette à… »). C'est de la capture, pas du tri : on la note sans décider quoi en faire." },
    ],
  },
  {
    id: "projets",
    icon: "🎯",
    title: "Projets actifs",
    desc: "Résultat attendu, échéance réelle, prochaine preuve d'avancement.",
    prompt:
      "Rémy, session 2 : mes projets réellement actifs. Passe-les en revue avec moi, un par un : le résultat attendu, l'échéance réelle, et la prochaine preuve d'avancement concrète. Ce qui n'est pas vraiment actif va dans l'incubateur. Groupe tes questions par lots : toutes celles d'un même point dans un seul message, numérotées, en me disant combien il en reste après.",
    reperes: [
      { id: "actifs", label: "Tes projets vraiment actifs, nommés", critere: "Au moins 2 projets en cours nommés par Sam. Un projet cité en passant dans une autre conversation compte s'il est clairement présenté comme actif." },
      { id: "fini-a-quoi", label: "À quoi tu verras que c'est fini", critere: "Pour au moins 2 projets, le résultat concret attendu est décrit — ce qui existera quand ce sera terminé. « Avancer sur X » ne compte pas." },
      { id: "vraie-date", label: "Une vraie date, pas « un jour »", critere: "Pour au moins 2 projets, une échéance datée ou un délai chiffré est donné, avec l'indication si la date est imposée de l'extérieur ou choisie par Sam." },
      { id: "prochaine-action", label: "La prochaine action concrète", critere: "Pour au moins 2 projets, la prochaine action est nommée assez précisément pour devenir une tâche, avec une durée ou un ordre de grandeur." },
      { id: "qui-passe-devant", label: "Lequel passe devant si tout ne rentre pas", critere: "Sam a donné son arbitrage entre au moins deux projets quand le temps manque, ou a mis explicitement un projet en pause ou à l'arrêt." },
    ],
  },
  {
    id: "quotidien",
    icon: "🏠",
    title: "Le quotidien",
    desc: "Ménage, courses, abonnements, dossiers administratifs, routines.",
    prompt:
      "Rémy, session 3 : mon quotidien. Aide-moi à lister ce qui revient tout le temps : ménage, courses et consommables, abonnements (lesquels garder ou résilier), dossiers administratifs en cours, routines. Groupe tes questions par lots dans un seul message, et mémorise.",
    reperes: [
      { id: "recurrences", label: "Ce qui revient, et à quel rythme", critere: "Au moins 4 tâches récurrentes nommées AVEC leur fréquence donnée par Sam (« courses une fois par semaine », « ménage le samedi »). Une tâche citée sans fréquence ne compte pas." },
      { id: "durees", label: "Combien de temps ça te prend vraiment", critere: "Pour au moins 3 de ces récurrences, une durée chiffrée en minutes ou en heures est donnée par Sam." },
      { id: "moments-imposes", label: "Ce qui tombe à un moment imposé", critere: "Sam a distingué au moins 2 choses qui tombent un jour ou un moment imposé (poubelles le mardi soir, marché le dimanche) de ce que Rémy peut placer librement." },
      { id: "dossiers-admin", label: "Les dossiers en cours et l'étape suivante", critere: "Au moins 2 dossiers administratifs en cours sont nommés avec, pour chacun, la prochaine étape concrète — ou Sam a dit explicitement qu'il n'en a aucun." },
      { id: "abonnements", label: "Abonnements : gardés ou résiliés", critere: "Au moins 2 abonnements sont nommés avec une décision tranchée (garder / résilier). Un « faudrait que je regarde » ne compte pas." },
    ],
  },
  {
    id: "personnes",
    icon: "👥",
    title: "Personnes & promesses",
    desc: "Qui compte, ce que tu as promis, les anniversaires.",
    prompt:
      "Rémy, session 4 : les personnes qui comptent. Famille, amis, contacts importants : qui, quel lien, ce que je leur ai promis, les anniversaires et dates à retenir. Groupe tes questions par lots : toutes celles d'un même point dans un seul message, numérotées, en me disant combien il en reste après.",
    reperes: [
      { id: "qui-compte", label: "Qui compte pour toi, et quel lien", critere: "Au moins 3 personnes nommées avec leur lien à Sam (famille, ami, associé, client)." },
      { id: "rythme", label: "À quelle fréquence tu veux les voir", critere: "Pour au moins 2 personnes, la fréquence souhaitée ou constatée est donnée (« mes parents, un appel par semaine »)." },
      { id: "promesses", label: "Ce que tu as promis et pas encore tenu", critere: "Au moins 2 engagements envers une personne nommée, avec ce qui est promis. Une intention vague (« il faudrait que je le rappelle un jour ») ne compte pas." },
      { id: "dates", label: "Anniversaires et dates à ne pas rater", critere: "Au moins 2 dates récurrentes connues avec leur jour, ET Sam a dit combien de temps à l'avance il veut être prévenu — ou qu'il ne veut pas l'être." },
      { id: "moments-proteges", label: "Les moments avec eux qu'on ne déplace pas", critere: "Sam a nommé au moins un moment avec ses proches à protéger du travail, en précisant quand il tombe — ou a dit qu'il n'en a aucun." },
    ],
  },
  {
    id: "lieux",
    icon: "📍",
    title: "Lieux & trajets",
    desc: "Lieux fréquents, temps de trajet, temps de préparation.",
    prompt:
      "Rémy, session 5 : mes lieux et trajets. Les endroits où je vais souvent, les temps de trajet réels, et ce qu'une sortie implique vraiment pour moi (préparation avant, récupération après). Groupe tes questions par lots : toutes celles d'un même point dans un seul message, numérotées, en me disant combien il en reste après.",
    reperes: [
      { id: "point-depart", label: "D'où tu pars, et comment tu te déplaces", critere: "Le lieu de départ habituel de Sam et son ou ses moyens de transport principaux sont connus." },
      { id: "lieux-frequents", label: "Les endroits où tu vas souvent", critere: "Au moins 3 lieux où Sam se rend régulièrement sont nommés, avec la ville, le quartier ou une indication de distance." },
      { id: "trajets", label: "Le temps de trajet réel, porte à porte", critere: "Pour au moins 2 lieux, le temps de trajet est chiffré en minutes par Sam. Une distance en kilomètres ne suffit pas." },
      { id: "avant-apres", label: "Ce qu'une sortie demande avant et après", critere: "Pour au moins un type de sortie, Sam a chiffré le temps de préparation avant et/ou de récupération après (« 30 min pour me préparer », « après le sport je ne suis bon à rien pendant une heure »)." },
      { id: "regroupement", label: "Ce qui peut se faire sur le même trajet", critere: "Sam a donné sa règle de regroupement des déplacements : accepte-t-il un détour et jusqu'à combien de minutes, préfère-t-il enchaîner ou étaler." },
    ],
  },
  {
    id: "horaires",
    icon: "⏰",
    title: "Horaires & énergie",
    desc: "Tes vraies heures, tes pics d'énergie, tes contraintes fixes.",
    prompt:
      "Rémy, session 6 : mes horaires et mon énergie. Quand je travaille vraiment, quand j'ai de l'énergie, mes contraintes fixes de la semaine. Compare avec les horaires configurés dans Motion (tu les vois dans ton instantané) et dis-moi ce qui cloche. Groupe tes questions par lots : toutes celles d'un même point dans un seul message, numérotées, en me disant combien il en reste après.",
    reperes: [
      { id: "plages", label: "Tes vraies heures de travail", critere: "Les plages de travail réelles de Sam sont données, en distinguant au moins deux cas (jours de semaine et week-end, ou deux types de journée). Une plage unique valable pour tous les jours compte si Sam le dit explicitement." },
      { id: "energie", label: "Quand tu es au top, quand tu es cuit", critere: "Sam a nommé au moins un moment de haute énergie et un moment de baisse, avec des heures ou des périodes." },
      { id: "quel-travail-quand", label: "Quel type de travail à quel moment", critere: "Sam a associé au moins 2 types de tâches (concentration, créatif, admin, appels) à des moments de la journée." },
      { id: "rdv-fixes", label: "Les créneaux bloqués de ta semaine", critere: "Au moins 2 rendez-vous ou créneaux fixes hebdomadaires sont connus avec leur jour et leur heure — ou Sam a dit qu'il n'en a aucun." },
      { id: "limite", label: "L'heure où on arrête, les jours protégés", critere: "Sam a donné sa limite : heure de fin, charge maximale, ou jours qu'il ne veut jamais voir planifiés." },
    ],
  },
  {
    id: "tri-motion",
    icon: "🧹",
    title: "Grand tri Motion",
    desc: "Passer l'ancien planning au crible : garder, corriger ou jeter.",
    prompt:
      "Rémy, session 7 : le grand tri de mon planning Motion. Je l'ai construit puis abandonné plusieurs fois, il contient du périmé. Liste ce que tu vois dans ton instantané (projets, tâches, retards) groupe par groupe, et pour chaque élément demande-moi : on garde, on corrige, ou on jette ? Note les réponses. Groupe tes questions par lots : toutes celles d'un même point dans un seul message, numérotées, en me disant combien il en reste après.",
    reperes: [
      { id: "projets-tries", label: "Tes projets Motion : gardés ou jetés", critere: "Au moins 2 projets présents dans Motion ont reçu un verdict de Sam (garder, corriger, jeter). Si Motion ne contient aucun projet et que Sam le constate explicitement, coché." },
      { id: "retards", label: "Les tâches en retard, tranchées", critere: "Au moins 3 tâches en retard ont reçu un verdict de Sam — ou il a constaté explicitement qu'il n'y a aucun retard." },
      { id: "durees-priorites", label: "Durées et priorités remises d'aplomb", critere: "Au moins 2 durées ou priorités de tâches Motion existantes ont été corrigées ou confirmées par Sam." },
      { id: "manquants", label: "Ce qui manque dans Motion", critere: "Au moins 2 choses dont Sam a parlé ailleurs et qui devraient être dans Motion ont été identifiées — ou il a confirmé que tout y est." },
      { id: "mot-urgent", label: "Ce que « urgent » veut dire pour toi", critere: "Sam a donné sa règle de priorité : ce qui mérite ASAP ou HIGH chez lui, avec au moins un exemple. Une préférence générale (« je déteste être en retard ») ne suffit pas." },
    ],
  },
  {
    id: "autonomie",
    icon: "🔑",
    title: "Autonomie & style",
    desc: "Ce que Rémy peut décider seul, les sujets sensibles, le ton à éviter.",
    prompt:
      "Rémy, session 8 : ton autonomie et ton style. Aide-moi à définir ce que tu peux faire sans me demander, ce qui exige toujours ma confirmation (les dépenses : toujours), les sujets sensibles, et le ton que je ne veux pas. Groupe tes questions par lots : toutes celles d'un même point dans un seul message, numérotées, en me disant combien il en reste après.",
    reperes: [
      { id: "sans-demander", label: "Ce que Rémy peut faire sans te demander", critere: "Sam a nommé au moins 2 types d'actions que Rémy peut faire de sa propre initiative." },
      { id: "feu-vert", label: "Ce qui exige toujours ton feu vert", critere: "Sam a nommé au moins 2 types d'actions qui exigent sa validation. Il doit l'avoir dit lui-même : la règle des dépenses est écrite dans Rémy, elle ne compte pas comme réponse de Sam." },
      { id: "lignes-rouges", label: "Les sujets où Rémy ne s'aventure pas", critere: "Sam a nommé au moins un sujet à ne pas aborder, ou a dit explicitement qu'il n'y en a aucun." },
      { id: "ton-refuse", label: "Le ton que tu ne veux jamais entendre", critere: "Sam a décrit un ton, une formulation ou une attitude qu'il refuse. Le ton défini dans la personnalité de Rémy ne compte pas : il faut les mots de Sam." },
      { id: "relance", label: "Quand Rémy a le droit de te relancer", critere: "Sam a dit à quel moment et à quelle fréquence Rémy peut le solliciter ou le relancer, ou a dit qu'il ne veut jamais l'être." },
    ],
  },
];

export const SESSION_IDS = SESSIONS.map((s) => s.id);

export function session(id) {
  return SESSIONS.find((s) => s.id === id) || null;
}

// Ce que le client a besoin d'afficher (le prompt d'amorce compris : c'est lui
// qui part quand Sam tape « Lancer ▶ »).
export function sessionsPubliques() {
  return SESSIONS.map(({ id, icon, title, desc, prompt, reperes }) => ({
    id, icon, title, desc, prompt,
    reperes: reperes.map(({ id, label }) => ({ id, label })), // le critère ne sert qu'à l'analyse
  }));
}

// Repères qui restent à couvrir dans une section — c'est ce que Rémy reçoit
// dans son prompt (lib/couverture.js) pour ne pas redemander ce qu'il sait déjà.
// Le POURCENTAGE, lui, est calculé côté écran uniquement : une seconde formule
// ici ne serait jamais lue, mais pourrait diverger silencieusement.
export function reperesRestants(id, etats, couverture) {
  const s = session(id);
  if (!s || etats?.[id] === "faite") return [];
  const couverts = new Set(couverture?.[id] || []);
  return s.reperes.filter((r) => !couverts.has(r.id));
}
