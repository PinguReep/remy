// Ce que devient un texte noté par « Noter » : le port de `GenreCapture`
// (ios-native/RemyCore/Sources/RemyCore/Accueil.swift). Deviné sans IA ; Sam
// corrige d'un clic. Une pensée floue va dans les Idées ; Motion seulement si
// l'action est claire (ou si Sam l'a réglé ainsi). Module pur, sans DOM.
import { extraire, sansFormule, plier, rogner, motif } from "./dates.js";

export const GENRES = ["tache", "idee", "liste", "rappel", "retenir", "question", "projet"];
export const LIBELLES = {
  tache: "Tâche",
  idee: "Idée",
  liste: "Liste",
  rappel: "Rappel",
  retenir: "Retenir",
  question: "Question",
  projet: "Projet",
};
/** Retenir demande assez de matière pour que la mémoire en tire quelque chose. */
export const MINIMUM_RETENIR = 30;

const longueur = (s) => [...s].length;

/** Des verbes d'action courants (à l'infinitif, sans accents). */
const VERBES = new Set([
  "faire", "dire", "prendre", "mettre", "ecrire", "lire", "relire", "rendre", "finir", "ranger", "envoyer", "appeler",
  "payer", "acheter", "reserver", "relancer", "repondre", "preparer", "reparer", "nettoyer", "contacter", "imprimer",
  "deposer", "recuperer", "commander", "inscrire", "valider", "signer", "terminer", "rediger", "changer", "verifier",
  "demander", "remplir", "trier", "laver", "sortir", "aller", "passer", "rappeler", "renouveler", "resilier", "declarer",
  "planifier", "organiser", "booker", "caler", "fixer", "noter", "regler", "rembourser", "virer", "vendre", "poster",
  "publier", "monter", "installer", "telephoner", "finaliser", "boucler", "livrer", "porter",
]);
/** Les mêmes à l'impératif, comme on se le dicte (« Appelle le garage »). */
const IMPERATIFS = new Set([
  "fais", "dis", "prends", "mets", "ecris", "lis", "relis", "rends", "finis", "range", "envoie", "appelle", "paie", "paye",
  "achete", "reserve", "relance", "reponds", "prepare", "repare", "nettoie", "contacte", "imprime", "depose", "recupere",
  "commande", "inscris", "valide", "signe", "termine", "redige", "verifie", "demande", "remplis", "trie", "lave", "sors",
  "va", "passe", "rappelle", "renouvelle", "resilie", "declare", "planifie", "organise", "cale", "fixe", "rembourse",
  "vends", "publie", "installe", "telephone", "finalise", "boucle",
]);
/** Des noms en -er/-ir qui ne sont pas des actions (« Dossier subvention »). */
const PAS_DES_VERBES = new Set([
  "dossier", "atelier", "papier", "clavier", "panier", "cahier", "premier", "dernier", "hiver", "super", "fichier",
  "loyer", "dimanche", "plaisir", "avenir", "souvenir", "desir", "loisir", "soir", "miroir", "espoir", "devoir",
  "pouvoir", "savoir", "quartier", "metier", "courrier", "calendrier", "chantier", "sentier", "danger", "diner",
  "dejeuner", "routier", "voilier", "escalier", "potager", "boulanger", "foyer", "cocher", "cavalier", "janvier", "fevrier",
]);

/** L'action est-elle claire ? Un verbe d'action en tête, « il faut », « je dois », ou une durée. */
export function actionClaire(texte) {
  const t = rogner(plier(texte), "", true);
  if (["il faut ", "faut ", "je dois ", "a faire", "todo"].some((p) => t.startsWith(p))) return true;
  if (motif(String.raw`\b\d+\s?(h|min|mn|minutes?|heures?)\b`).test(t)) return true;
  const mots = t.split(/[^\p{L}]+/u).filter(Boolean);
  if (!mots.length) return false;
  let premier = mots[0];
  // « Me renseigner », « se faire couper les cheveux » : le verbe suit.
  if (["me", "m", "se", "s", "te", "t"].includes(premier) && mots.length > 1) premier = mots[1];
  if (VERBES.has(premier) || IMPERATIFS.has(premier)) return true;
  if (PAS_DES_VERBES.has(premier)) return false;
  return longueur(premier) >= 5 && (premier.endsWith("er") || premier.endsWith("ir"));
}

/** « tomates, lait et œufs » → trois articles. Plus de cinq mots : pas un article. */
export function articles(texte) {
  const morceaux = String(texte)
    .replace(/\n/g, ",")
    .replace(/\s+et\s+(?=[^,]*$)/gu, ",")
    .split(",")
    .map((m) => rogner(m))
    .filter(Boolean);
  if (!(morceaux.length >= 2 && morceaux.every((m) => m.split(" ").filter(Boolean).length <= 5))) {
    return morceaux.length === 1 ? morceaux : [];
  }
  return morceaux;
}

/** Plusieurs choses dites d'un coup : Rémy peut les ranger une à une. */
export function plusieursIntentions(texte) {
  const t = rogner(texte, "", true);
  if (longueur(t) < 30) return false;
  const morceaux = t.replace(/\n/g, ",")
    .replace(/\s(?:et|puis|aussi)\s/giu, ",")
    .split(/[,;.]/)
    .map((m) => rogner(m))
    .filter(Boolean);
  if (morceaux.length < 2) return false;
  const longs = morceaux.filter((m) => m.split(" ").filter(Boolean).length >= 3);
  return longs.length >= 2;
}

/** Le genre probable, deviné sans IA. `parDefaut` : « idee » (défaut) ou « tache » (réglage). */
export function deviner(texte, maintenant = new Date(), parDefaut = "idee") {
  const t = rogner(texte, "", true).toLowerCase();
  if (!t) return parDefaut;
  if (t.endsWith("?")) return "question";
  const interrogatifs = ["est-ce", "qu'est-ce", "quand ", "comment ", "pourquoi ", "combien ", "quel ", "quelle ", "quels ", "quelles ", "où "];
  if (interrogatifs.some((p) => t.startsWith(p))) return "question";
  if (longueur(t) >= 120) return "retenir";
  if (t.startsWith("rappelle") || t.startsWith("rappel ") || t.startsWith("n'oublie pas") || t.startsWith("fais-moi penser")) return "rappel";
  // Ce que Sam annonce lui-même passe avant la date.
  if (motif(String.raw`^id[ée]es?\b`).test(t)) return "idee";
  if (["projet ", "nouveau projet", "sous-projet", "sous projet", "catégorie ", "categorie ", "nouvelle catégorie"].some((p) => t.startsWith(p))) return "projet";
  const d = extraire(t, maintenant);
  if (d) {
    // Un jour sans heure pour une action claire : une tâche à échéance. Une
    // date limite avec son heure : une tâche aussi, pas un rappel trop tard.
    return (!d.heureDite || d.limite) && (actionClaire(t) || actionClaire(d.reste)) ? "tache" : "rappel";
  }
  if (articles(t).length >= 2) return "liste";
  return actionClaire(t) ? "tache" : parDefaut;
}

/** Le texte d'une tâche ou d'un rappel noté avec une date (la date part à côté si elle était au bout). */
export function texte(brut, d, genre) {
  const propre = rogner(brut, "", true);
  const entier = sansFormule(propre);
  if (!d || !d.reste) return genre === "tache" ? propre : entier;
  if (genre === "tache" && d.heureDite && !d.limite) return entier;
  const plie = (s) => rogner(plier(s).replace(/[\s,;:.!…-]+/gu, " "));
  const reste = plie(d.reste);
  const tout = plie(entier);
  const auBout = tout.startsWith(reste) || tout.endsWith(reste);
  // « Relire le compte rendu de », « Payer la facture du » : la date tenait au reste.
  const coupe = /(?:^|\s)(?:de|du|des|d'|d’|ou|et|entre|la|le|les|l'|au|aux|a|avec|sur|en|par|chez|dans|sans)$/u.test(reste);
  return auBout && !coupe ? d.reste : entier;
}

/**
 * « Nouveau projet Corail », « sous-projet X dans « Boutique » » → le nom, et
 * où le ranger s'il est dit : entre guillemets, ou le nom d'un projet existant.
 */
export function projet(brut, parents = []) {
  let t = rogner(String(brut).normalize("NFC"), "", true);
  t = t.replace(motif(String.raw`(?i)^(?:nouveau\s+projet|nouvelle\s+cat[ée]gorie|sous[- ]projet|projet|cat[ée]gorie)\s*:?\s*`), "");
  let parent = null;
  const lien = String.raw`\s+(?:dans|sous)\s+(?:le\s+projet\s+|la\s+cat[ée]gorie\s+)?`;
  const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const plie = plier(t);
  const connus = parents.filter(Boolean).sort((a, b) => longueur(b) - longueur(a));
  let connu = null;
  for (const nom of connus) {
    const m = motif(lien + echapper(plier(nom)) + String.raw`\s*$`, "i").exec(plie);
    if (m) {
      connu = { longueur: plie.length - m.index, nom };
      break;
    }
  }
  if (connu && plie.length === t.length) {
    parent = connu.nom;
    t = t.slice(0, t.length - connu.longueur);
  } else {
    const m = motif("(?i)" + lien + String.raw`« ?([^»]+?) ?»$`).exec(t);
    if (m) {
      parent = rogner(m[0].replace(motif(String.raw`(?i)^\s+(?:dans|sous)\s+(?:le\s+projet\s+|la\s+cat[ée]gorie\s+)?`), ""), "«» ");
      t = t.slice(0, m.index) + t.slice(m.index + m[0].length);
    }
  }
  const titre = rogner(t, ":-");
  const premiere = [...titre][0] ?? "";
  return { titre: premiere.toUpperCase() + titre.slice(premiere.length), parent: parent ? parent : null };
}

/** Tout l'aperçu d'une phrase : genre, date lue, titre propre, plusieurs intentions. */
export function apercu(brut, { maintenant = new Date(), parDefaut = "idee", genre = null, parents = [] } = {}) {
  const g = genre ?? deviner(brut, maintenant, parDefaut);
  const d = extraire(rogner(brut, "", true), maintenant);
  let titre;
  if (g === "projet") titre = projet(brut, parents).titre;
  else if (g === "tache" || g === "rappel") titre = texte(brut, d, g);
  else titre = rogner(brut, "", true);
  return {
    genre: g,
    devine: genre == null,
    date: d,
    titre,
    articles: g === "liste" ? articles(brut) : [],
    plusieurs: plusieursIntentions(brut),
    projet: g === "projet" ? projet(brut, parents) : null,
  };
}
