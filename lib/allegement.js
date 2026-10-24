// Alléger le modèle local (nuit du 24/10) : chaque message coûtait ~4 appels
// au modèle (routeur, réponse, relance après outil, mémoire, titre), même pour
// « acheter des ampoules ». Deux appels de fond deviennent des tests
// déterministes, sans IA :
//
//   - le ROUTEUR n'est appelé que si un autre cerveau peut répondre à CE
//     message (la recherche web, qui passe par Claude). Sinon le cerveau est
//     local et unique : le palier (réflexion ou pas) se décide ici ;
//   - la MÉMOIRE n'est réécrite que si l'échange apprend quelque chose sur Sam
//     (une préférence, une habitude, un fait de sa vie, un « retiens que »).
//
// REMY_ALLEGEMENT=off rend l'ancien comportement (routeur et mémoire à chaque
// message) : utile pour comparer, ou revenir en arrière sans redéployer.

export const allegementActif = () => String(process.env.REMY_ALLEGEMENT || "").toLowerCase() !== "off";

const norm = (t) =>
  String(t || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Ce qui ressemble à une question pour internet : actualité, prix, horaires,
// météo, disponibilité, avis, « cherche ». Large exprès : un faux positif coûte
// un appel au routeur (comme avant), un oubli ferait répondre le modèle local
// sans proposer la recherche.
const WEB = new RegExp(
  [
    "\\b(cherche|recherche|google|internet|en ligne|sur le web|site (web|officiel)|lien)\\b",
    "https?://|www\\.",
    "\\b(actu|actualite|actualites|news|info(s)? du jour|dernieres? nouvelles?)\\b",
    "\\b(meteo|quel temps|temps (qu'il|fera|demain|ce week-end)|pleuvoir|pluie demain|temperature)\\b",
    "\\b(programme (du|de la|des|ce)|seances?|cinema|a l'affiche|concert|spectacle|exposition|festival)\\b",
    "\\b(prix|tarif|combien coute|coute combien|cout de|promo|soldes?|en stock|rupture de stock)\\b",
    "\\b(horaires?|ouvert|ouverte|ferme a|fermeture|jours? feries?)\\b",
    "\\b(avis|critique|note sur|classement|meilleur(e|s)? .{0,30}(du moment|actuel))\\b",
    "\\b(score|resultat|match|elections?|bourse|cours de|bitcoin|taux de change|inflation)\\b",
    "\\b(trafic|greve|bouchons?|vol [a-z]{2}\\d|train .{0,20}retard)\\b",
    "\\b(qui est|c'est qui|qu'est-ce que .{0,40} (sorti|nouveau))\\b",
    "\\b(recent|recente|dernier (album|film|livre|episode|modele|iphone)|derniere (version|mise a jour)|sorti(e)? (quand|recemment)|quand sort)\\b",
  ].join("|"),
);

export function indiceWeb(texte) {
  return WEB.test(norm(texte));
}

// Décision ou sujet lourd : réflexion complète (le palier « conseil »).
// « je devrais acheter du pain » n'est pas une décision : seulement les tournures
// qui demandent vraiment de peser le pour et le contre.
const CONSEIL = /\b(dois-je|devrais-je|est-ce que je devrais|est-ce que je dois|j'hesite|hesite entre|que ferais-tu|ton avis sur|conseille-moi|prendre une decision|grosse decision|choisir entre|strategie|demissionner|quitter (mon|ma)|separation|divorce|carriere|angoisse|deprime|burn-?out|je n'en peux plus|je craque)\b/;
// Organiser, planifier, rédiger, expliquer : réflexion bornée.
const RAISONNEMENT = /\b(organise|organiser|planifie|planifier|planning|ma journee|ma semaine|priorites?|prioriser|range|ranger|trie|trier|reorganise|replanifie|decale|redige|rediger|ecris|ecrire|explique|expliquer|pourquoi|comment faire|compare|comparer|resume|resumer|analyse|analyser|propose|proposer|aide-moi a|retard|en retard)\b/;

// Le palier sans routeur : « reflexe » (sans réflexion) pour un message court
// et simple, « raisonnement » pour ce qui demande d'organiser ou d'écrire,
// « conseil » pour une décision. Une demande longue n'est jamais un réflexe
// (lib/chat.js, demandeComplexe : l'incident du 09/10).
export function palierDeterministe(texte, { complexe = false } = {}) {
  const t = norm(texte);
  if (CONSEIL.test(t)) return "conseil";
  if (complexe || RAISONNEMENT.test(t)) return "raisonnement";
  if (t.length > 160) return "raisonnement";
  return "reflexe";
}

// Le palier de CE message sans appeler le routeur, ou null s'il faut
// l'appeler. Le routeur ne sert que si un autre cerveau peut répondre : la
// recherche web autorisée (hors conversation privée) pour un message qui y
// ressemble, ou le conseil confié à Claude (REMY_CONSEIL_CLOUD=on) — là, une
// expression régulière ne décide jamais seule d'envoyer une conversation chez
// un tiers. Cerveau local et unique (web coupé, conversation privée) : un
// message qui ressemble au web est classé « web » sans appel, pour que Rémy
// dise qu'il ne peut pas chercher (lib/chat.js, NOTES_WEB).
export function palierSansRouteur(texte, { rechercheWeb = false, prive = false, conseilCloud = false, complexe = false } = {}) {
  if (!allegementActif()) return null;
  const web = indiceWeb(texte);
  if (prive || !rechercheWeb) {
    if (web) return "web";
    if (conseilCloud && !prive) return null;
    return palierDeterministe(texte, { complexe });
  }
  if (web || conseilCloud) return null;
  return palierDeterministe(texte, { complexe });
}

// L'échange apprend-il quelque chose sur Sam ? Une préférence, une habitude,
// un fait de sa vie, un état, un objectif, ou une demande explicite de retenir.
// « acheter des ampoules », « ok merci », « organise ma journée » : non — la
// mémoire n'est pas réécrite (~30 s de modèle local en moins).
const SUR_SAM = [
  // Demande explicite.
  /\b(retiens|souviens-toi|rappelle-toi que|n'oublie pas que|note que|sache que|pour info|a savoir|garde en tete|en memoire)\b/,
  // Préférences et rejets.
  /\b(j'aime|je n'aime|j'aime pas|j'adore|je deteste|j'ai horreur|je prefere|je supporte (pas|plus)|ca m'enerve|ca me saoule|ca me stresse|ca m'angoisse|mon truc|pas mon truc)\b/,
  // Habitudes et rythmes.
  /\b(d'habitude|en general|tous les (jours|matins|soirs|lundis|mardis|mercredis|jeudis|vendredis|samedis|dimanches|week-ends|mois)|chaque (jour|matin|soir|semaine|mois|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)|le (lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) je|je me leve|je me couche|je commence|je finis|toujours|jamais|souvent|rarement)\b/,
  // Faits de sa vie.
  /\b(je suis|je m'appelle|j'ai \d+ ans|je travaille|je bosse|mon boulot|mon travail|mon metier|mon job|j'habite|je vis|je viens de|je fais du|je fais de la|je joue|mon (fils|frere|pere|copain|mari|compagnon|chef|patron|boss|associe|medecin|coach|chien|chat|anniversaire|velo|sport)|ma (fille|soeur|mere|copine|femme|compagne|cheffe|patronne|associee|famille|sante|maison)|mes (enfants|parents|amis|potes|collegues|clients))\b/,
  // État, énergie, objectifs.
  /\b(je me sens|je suis (fatigue|creve|epuise|stresse|motive|content|decu|malade)|j'en ai marre|je galere|j'ai peur|j'ai du mal|energie|mon objectif|mes objectifs|je veux (arreter|commencer|devenir|reussir)|j'aimerais|je voudrais (arreter|commencer|devenir|apprendre)|mon reve|j'ai decide|ma priorite|mes priorites|cette annee je)\b/,
];

export function apprendSurSam(texte) {
  if (!allegementActif()) return true;
  const t = norm(texte);
  if (!t.trim()) return false;
  // Une longue confidence (dictée, récit) apprend presque toujours quelque chose.
  if (t.length > 400) return true;
  return SUR_SAM.some((re) => re.test(t));
}
