// Le filtre des requêtes sortantes (25/10) : ce qui part de la tour vers un
// moteur de recherche ou un site — la question de rechercher, les requêtes de
// chercher_web, l'adresse d'une page à ouvrir (et ses clics) — passe d'abord
// ici, sans IA.
//
// Refusé, avec la raison (pour que le modèle reformule) :
//   - une adresse e-mail, un numéro de téléphone, un IBAN, un numéro de carte
//     bancaire, un numéro de sécurité sociale, une adresse postale (numéro + voie) ;
//   - un terme du « lexique » de Sam, tiré de sa mémoire, de son planning, de
//     son agenda… : ses NOMS PROPRES (majuscule hors début de phrase, ou nom
//     après « Dr », « chez », « appeler »…), ses sigles, ses identifiants (des
//     chiffres dans un mot, un long numéro), et tout mot rare d'une ligne de
//     santé (médicament, maladie) ; tout le profil (prénom, vocabulaire), même
//     courant. Les noms communs en minuscules (« pompe à chaleur », « combles »)
//     ne bloquent pas : ce sont les sujets mêmes des recherches (relecture du
//     25/10 : une question réaliste sur trois était refusée).
//   Passent toujours : les mots courants (lib/mots-courants.js), les villes,
//   organismes publics et produits, les communes de la tour ; hors conversation
//   privée, ce que Sam a écrit lui-même dans son message en cours.
// En conversation privée : la conversation entière entre au lexique (ses noms
// propres, identifiants, lignes de santé — et, pour les messages antérieurs de
// Sam, tous ses mots rares) ; le message en cours n'exempte que ces mots rares
// antérieurs, jamais un nom, un identifiant ou un terme de la mémoire.
//
// Le texte vérifié est d'abord nettoyé : formes de compatibilité (NFKC :
// lettres pleine chasse, mathématiques), caractères invisibles, sosies
// cyrilliques et grecs (« Fоntanel » avec un о cyrillique). Un terme coupé
// (« Font anel », « F.o.n.t.a.n.e.l ») ou écrit avec des chiffres
// (« F0ntanel ») est retrouvé.
//
// Limites (docs/journal-technique.md) : un nom qui est aussi un mot courant
// (« Rose ») ; un nom écrit en minuscules sans indice (« fontanel 14h » en
// début de tâche) ; un terme paraphrasé ou épelé en mots. Le filtre est un
// filet, la salle blanche (lib/salle-blanche.js) le premier rempart : elle ne
// connaît pas la mémoire.

import { MOTS_COURANTS, LIEUX_PUBLICS, ORGANISMES, PRODUITS } from "./mots-courants.js";
import { baseGeo } from "./geocodage.js";

// --- Le nettoyage -------------------------------------------------------------------
// Lettres cyrilliques et grecques qui ressemblent à des lettres latines (avant
// la mise en minuscules : « Η » grec est un H, « η » un n).
const SOSIES = {
  А: "A", В: "B", Е: "E", Ё: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X", Ѕ: "S", І: "I", Ї: "I", Ј: "J", Ԛ: "Q", Ԝ: "W", Ү: "Y", Ӏ: "I",
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", ѕ: "s", і: "i", ї: "i", ј: "j", ԁ: "d", ԛ: "q", ԝ: "w", һ: "h", ӏ: "l", ү: "y",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
  α: "a", β: "b", γ: "y", ε: "e", ζ: "z", η: "n", ι: "i", κ: "k", μ: "u", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w",
  ɡ: "g", ı: "i", ȷ: "j",
};
const SOSIE = new RegExp(`[${Object.keys(SOSIES).join("")}]`, "gu");
// Invisibles : trait d'union conditionnel, espaces de largeur nulle, marques de sens.
const INVISIBLES = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁦-⁯ㅤ﻿ﾠ]/gu;
export const nettoyer = (t) => String(t ?? "").normalize("NFKC").replace(INVISIBLES, "").replace(SOSIE, (c) => SOSIES[c]);

// En minuscules, ligatures dépliées, apostrophes droites — accents gardés.
const minuscules = (t) =>
  nettoyer(t)
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[’`]/g, "'");
// Sans accents ni majuscules.
export const normaliser = (t) => minuscules(t).normalize("NFD").replace(/[̀-ͯ]/g, "");

// Un mot, ou un composé (tirets, points, soulignés, apostrophes) : « Jean-Marc »,
// « SECRET-MEMOIRE-42 », « l'Urssaf », « urssaf.fr ».
const MOT = /[\p{L}\p{N}]+(?:[-_.'][\p{L}\p{N}]+)*/gu;
const SEP = /[-_.']+/;
const parties = (n) => n.split(SEP).filter(Boolean);
// Pluriel ôté : « bougies » et « bougie » se retrouvent.
const racine = (w) => (w.length > 4 ? w.replace(/[sx]$/, "") : w);

// --- Ce qui peut sortir --------------------------------------------------------
const COURANTS = new Set(MOTS_COURANTS.map(normaliser));
const COURANTS_ACCENTUES = new Set(MOTS_COURANTS.map(minuscules));
// Les composés courants (« week-end », « auto-entrepreneur ») : leurs morceaux
// ne sont pas des mots à part (« week », « auto »).
const COMPOSES_COURANTS = (() => {
  const composes = new Set();
  let long = 1;
  for (const m of MOTS_COURANTS) {
    const morceaux = parties(normaliser(m));
    if (morceaux.length > 1) {
      composes.add(morceaux.join(" "));
      long = Math.max(long, morceaux.length);
    }
  }
  return { composes, long };
})();
// Un verbe ou un adjectif accordé : « trouve », « cherches », « créée »,
// « entreprises » retrouvent leur forme de la liste. Un mot accentué se compare
// AVEC ses accents : « trouvère » n'est pas « trouver » (relecture du 25/10).
const FINS = ["aient", "ait", "ent", "ons", "ez", "ees", "es", "ee", "e", "s", "x"];
const FINS_ACCENTUEES = ["aient", "ait", "ent", "ons", "ez", "ées", "ée", "és", "é", "es", "e", "s", "x"];
const aDesAccents = (t) => /[^\x00-\x7f]/.test(t);
// `exact` : un nom propre — ni conjugaison ni accord ; `brut` : le mot en
// minuscules, avec ses accents.
export function estCourant(w, { exact = false, brut = null } = {}) {
  if (COURANTS.has(w) || COURANTS.has(racine(w))) return true;
  if (exact) return false;
  const [mot, fins, liste] = brut && aDesAccents(brut) ? [brut, FINS_ACCENTUEES, COURANTS_ACCENTUES] : [w, FINS, COURANTS];
  for (const f of fins) {
    if (mot.length - f.length < 3 || !mot.endsWith(f)) continue;
    const base = mot.slice(0, -f.length);
    if (liste.has(base) || liste.has(`${base}er`) || liste.has(`${base}e`) || liste.has(`${base}ir`)) return true;
  }
  return false;
}

// Lieux, organismes, produits, et ce que la tour ajoute : des noms simples
// et des composés (« saint-etienne », « new-york ») — « Saint-Étienne » ne
// laisse ni « saint » ni « etienne » derrière lui.
const PERMIS_BASE = [...LIEUX_PUBLICS, ...ORGANISMES, ...PRODUITS].map(normaliser);

let communes = null; // communes de la Base Adresse Nationale de la tour, lues une fois
function communesLocales() {
  if (communes) return communes;
  communes = [];
  try {
    const b = baseGeo();
    if (b) {
      for (const { commune } of b.prepare("SELECT DISTINCT commune FROM adresses WHERE commune IS NOT NULL").all()) {
        const n = normaliser(commune).trim().replace(/\s+/g, "-");
        if (n) communes.push(n);
      }
    }
  } catch (err) {
    console.warn("Filtre des requêtes : communes de la Base Adresse illisibles —", err.message);
  }
  return communes;
}
export const _oublierCommunes = () => {
  communes = null;
  permisGarde = null;
};

// REMY_FILTRE_PERMIS : mots ou noms toujours permis (« ma-ville, mon-club »).
const permisTour = () =>
  String(process.env.REMY_FILTRE_PERMIS || "")
    .split(/[,;\n]+/)
    .map((x) => normaliser(x).trim().replace(/\s+/g, "-"))
    .filter(Boolean);

// { simples, composes (« saint etienne »), long : le plus de morceaux d'un composé }.
// Gardé d'un message à l'autre (la tour peut connaître des dizaines de milliers
// de communes, et le filtre se construit à chaque réponse qui peut aller sur le
// web) ; chaque filtre reçoit sa copie des noms simples, qu'il complète (la
// commune qui suit un code postal).
let permisGarde = null;
function permis() {
  const cle = String(process.env.REMY_FILTRE_PERMIS || "");
  const liste = communesLocales();
  if (!permisGarde || permisGarde.cle !== cle || permisGarde.communes !== liste) {
    const simples = new Set();
    const composes = new Set();
    let long = 1;
    for (const x of [...PERMIS_BASE, ...liste, ...permisTour()]) {
      const morceaux = parties(x);
      if (morceaux.length > 1) {
        composes.add(morceaux.join(" "));
        long = Math.max(long, morceaux.length);
      } else if (morceaux[0]) simples.add(morceaux[0]);
    }
    permisGarde = { cle, communes: liste, simples, composes, long };
  }
  return { simples: new Set(permisGarde.simples), composes: permisGarde.composes, long: permisGarde.long };
}

// Un nombre (année, montant, heure, mesure) ne dit rien de personne ; un long
// numéro (6 chiffres et plus : dossier, contrat, SIRET), si.
const MESURE = /^\d+(?:[.,]\d+)?(?:h\d*|min|mn|s|e|er|re|eme|k|ke|keur|eur|euros?|km|m|m2|kg|g|mg|ml|cl|l|j|ans?|jours?|mois|pm|am|go|mo|ko|gb|mb|kw|kwh|w|v|x)?$/;
const estNombre = (p) => (/^\d+$/.test(p) ? p.length < 6 : MESURE.test(p));

// --- Les motifs : jamais, d'où qu'ils viennent ---------------------------------
const VOIE_SURE = "rue|avenue|av|boulevard|bd|impasse|all[ée]e|quai|faubourg|fbg|lieu-dit|lotissement|rond-point|ruelle|esplanade|parvis|sentier|mont[ée]e";
const VOIE_AMBIGUE = "chemin|place|route|cours|square|passage|voie|r[ée]sidence|hameau|domaine|villa|cit[ée]|clos|promenade|traverse|carrefour";

function luhn(chiffres) {
  let somme = 0;
  for (let i = 0; i < chiffres.length; i++) {
    let d = Number(chiffres[chiffres.length - 1 - i]);
    if (i % 2) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    somme += d;
  }
  return somme % 10 === 0;
}

// `garde(m)` : un second regard sur la correspondance (somme de contrôle…).
const MOTIFS = [
  {
    raison: "une adresse e-mail",
    re: /[\p{L}\p{N}._%+-]+(?:@|\s*(?:\[at\]|\(at\)|\[arobase\]|\(arobase\))\s*)[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu,
  },
  { raison: "un IBAN", re: /(?<![\p{L}\p{N}])[a-z]{2}\d{2}(?:[ ]?[a-z0-9]){11,30}(?![\p{L}\p{N}])/giu, garde: (m) => (m[0].match(/\d/g) || []).length >= 10 },
  {
    raison: "un numéro de sécurité sociale",
    re: /(?<!\d)[12][ .]?\d{2}[ .]?(?:0[1-9]|1[0-2]|[2-9]\d)[ .]?(?:\d{2}|2[ab])[ .]?\d{3}[ .]?\d{3}(?:[ .]?\d{2})?(?!\d)/giu,
  },
  {
    raison: "un numéro de carte bancaire",
    re: /(?<!\d)[2-6](?:[ -]?\d){12,18}(?!\d)/gu,
    // 14 chiffres : un SIRET (public), pas une carte.
    garde: (m) => {
      const c = m[0].replace(/\D/g, "");
      return c.length !== 14 && luhn(c);
    },
  },
  {
    raison: "un numéro de téléphone",
    re: /(?<![\p{L}\p{N}+])(?:(?:\+|00)33[ .-]?(?:\(0\))?[ .-]?[1-9]|0[1-9])(?:[ .-]?\d{2}){4}(?!\d)|(?<![\p{L}\p{N}])(?:\+|00)[1-9]\d{0,2}(?:[ .-]?\d{2,4}){3,6}(?!\d)/gu,
  },
  {
    // « 12 rue des Lilas », « 3 bis avenue Foch » ; une voie ambiguë seulement
    // suivie d'un nom propre (« 1 place Bellecour », pas « 10 cours de piano »).
    raison: "une adresse postale",
    re: new RegExp(
      String.raw`(?<![\p{L}\p{N}])\d{1,4}\s*(?:bis|ter|quater|[a-d])?\s*,?\s+(?:(?:${VOIE_SURE})\.?(?![\p{L}\p{N}])|(?:${VOIE_AMBIGUE})(?:\s+(?:de\s+la|de\s+l'|du|des|de)\s+|\s+d'|\s+)(\p{L}[\p{L}\p{N}'-]*))`,
      "giu",
    ),
    garde: (m) => m[1] === undefined || m[1][0] !== m[1][0].toLowerCase(),
  },
];

// Les motifs trouvés dans un texte : [{ raison, debut, fin }].
export function motifs(texte) {
  const t = String(texte ?? "");
  const out = [];
  for (const m of MOTIFS) {
    for (const x of t.matchAll(new RegExp(m.re.source, m.re.flags))) {
      if (m.garde && !m.garde(x)) continue;
      out.push({ raison: m.raison, debut: x.index, fin: x.index + x[0].length });
    }
  }
  return out;
}

// --- Le lexique ---------------------------------------------------------------------
// Les mots d'un texte (déjà nettoyé), avec leur place : [{ n, morceaux, bruts,
// debut, fin }] — `bruts` : les morceaux tels qu'écrits (majuscules, accents).
function mots(texte) {
  const out = [];
  for (const m of String(texte ?? "").matchAll(MOT)) {
    const n = normaliser(m[0]);
    out.push({ n, morceaux: parties(n), bruts: m[0].split(SEP).filter(Boolean), debut: m.index, fin: m.index + m[0].length });
  }
  return out;
}

// Les mots d'un texte mis bout à bout (« morceau morceau … ») : chaque mot y
// garde sa place, pour retrouver ce que couvre une correspondance.
function enLigne(toks) {
  let pos = 0;
  const places = toks.map((k) => {
    const texte = k.morceaux.join(" ");
    const place = { debut: pos, fin: pos + texte.length };
    pos += texte.length + 1;
    return place;
  });
  return { ligne: toks.map((k) => k.morceaux.join(" ")).join(" "), places };
}
const couverts = (places, a, b) => places.flatMap((pl, i) => (pl.debut < b && pl.fin > a ? [i] : []));

// Les morceaux couverts par un nom composé d'une liste (`p.composes` : « saint
// etienne », « week end »), qu'il tienne en un mot ou en plusieurs : un Set de
// « mot:morceau » (ajoutés à `ok`). Mot à mot, sans expression géante : la tour
// peut connaître des milliers de communes.
function couvertsPermis(toks, p, ok = new Set()) {
  const plat = toks.flatMap((m, i) => m.morceaux.map((x, k) => ({ x, cle: `${i}:${k}` })));
  for (let j = 0; j < plat.length; j++) {
    for (let n = Math.min(p.long, plat.length - j); n >= 2; n--) {
      const bout = plat.slice(j, j + n);
      if (p.composes.has(bout.map((e) => e.x).join(" "))) {
        for (const e of bout) ok.add(e.cle);
        break;
      }
    }
  }
  return ok;
}

// Après un code postal, c'est une commune : « 38190 Froges », « 13100 Aix en Provence ».
const COMMUNE = /(?<!\d)\d{5}\s+(\p{L}[\p{L}'-]*(?:\s+(?:sur|sous|en|les|la|le|de|du|des|d'|l')\s*\p{L}[\p{L}'-]*)*)/giu;

// Ce qui annonce un nom de personne ou d'entreprise, même écrit en minuscules :
// « Dr fontanel », « chez quilleboeuf », « appeler martin ». Pas « avec » ni
// « ma sœur » : derrière, un nom commun rare (« avec plaisir ») serait pris
// pour un nom — et les noms y portent presque toujours leur majuscule.
const INDICES = new Set("dr docteur maitre mme mlle mr monsieur madame mademoiselle pr professeur chez appeler rappeler relancer contacter".split(" "));
// Une ligne de santé : ce qui s'y dit (médicament, maladie) ne sort pas, même
// en minuscules. Et tout ce qui suit un titre « ## Santé ».
const LIGNE_SANTE = /(?<![a-z])(?:traitements?|medicaments?|maladies?|diagnostics?|ordonnances?|pathologies?|posologies?|therapies?|psychiatr[a-z]*|handicaps?|addictions?|allergies?)(?![a-z])/;
const TITRE_SANTE = /(?<![a-z])(?:sante|medical[a-z]*|traitements?|soins?)(?![a-z])/;
// Ce qui ouvre une phrase : le mot qui suit porte une majuscule de position —
// sauf le point d'une abréviation (« M. Boisdur », « Dr. Fontanel »).
const OUVRE = /[.!?:…«“"(\[\]•·|>#*–—]/;
const ABREVIATIONS = new Set(["m", "mm", "mr", "dr", "mme", "mlle", "me", "pr", "st", "ste", "prof", "cie"]);

// Les termes d'un texte qui pourraient dire quelque chose de quelqu'un.
// `mode` :
//   "structure" (mémoire, planning, conversation) : noms propres, sigles,
//               identifiants, nom après un indice, mots rares d'une ligne de santé ;
//   "strict"    (messages antérieurs de Sam, en privé) : tout mot rare ;
//   "profil"    (prénom, vocabulaire) : tout mot, même courant ;
//   "noms"      (un message de Sam, recherche directe) : comme « structure »,
//               sans les mots d'une ligne de santé (le sujet même de sa question).
function termes(texte, p, { mode = "structure" } = {}) {
  const simples = new Set();
  const composes = new Set();
  const t = nettoyer(texte).replace(COMMUNE, (m, ville) => {
    for (const x of parties(normaliser(ville).replace(/\s+/g, "-"))) p.simples.add(x);
    return " ".repeat(m.length);
  });
  let sante = false; // sous un titre « ## Santé »
  for (const ligne of t.split("\n")) {
    const nl = normaliser(ligne);
    const titre = /^\s*#/.test(ligne);
    if (titre) sante = TITRE_SANTE.test(nl);
    const ligneSante = mode !== "noms" && !titre && (sante || LIGNE_SANTE.test(nl));
    const toks = mots(ligne);
    const ok = couvertsPermis(toks, p);
    if (mode !== "profil") couvertsPermis(toks, COMPOSES_COURANTS, ok);
    // Les morceaux, à plat, avec ce qu'on sait de chacun.
    const plat = [];
    toks.forEach((m, i) => {
      const entre = i ? ligne.slice(toks[i - 1].fin, m.debut) : "";
      const debutPhrase = i === 0 || (OUVRE.test(entre) && !(entre.trim() === "." && ABREVIATIONS.has(toks[i - 1].n)));
      // Collé au mot suivant par de simples espaces (« Hugo Lemoine »).
      const colleSuivant = i < toks.length - 1 && /^\s+$/.test(ligne.slice(m.fin, toks[i + 1].debut));
      m.morceaux.forEach((x, k) => {
        const brut = m.bruts[k] || x;
        plat.push({
          x,
          brut,
          libre: !ok.has(`${i}:${k}`) && x.length >= 3 && !estNombre(x) && !p.simples.has(x) && !p.simples.has(racine(x)),
          majuscule: /^\p{Lu}/u.test(brut),
          sigle: /\p{Lu}.*\p{Lu}/u.test(brut) && brut === brut.toUpperCase(),
          debut: debutPhrase && k === 0,
          colle: k < m.morceaux.length - 1 || colleSuivant,
        });
      });
      // Un identifiant (« SECRET-MEMOIRE-42 », « AB-123-CD ») : le composé entier.
      const chiffre = m.morceaux.some((x) => /\d/.test(x));
      const lettre = m.morceaux.some((x) => /[a-z]/.test(x));
      if (m.morceaux.length > 1 && chiffre && lettre && !estNombre(m.morceaux.join("")) && m.morceaux.every((_, k) => !ok.has(`${i}:${k}`))) {
        composes.add(m.morceaux.join(" "));
      }
    });
    const rare = (e) => !estCourant(e.x, { brut: minuscules(e.brut) });
    const propre = (e) => Boolean(e) && e.libre && ((e.majuscule && !e.debut) || e.sigle) && !estCourant(e.x, { exact: true });
    let suite = 0; // après un indice : jusqu'à deux mots rares (« chez jean dupont »)
    plat.forEach((e, j) => {
      const avant = plat[j - 1];
      if (!avant || !avant.colle) suite = 0;
      else if (INDICES.has(avant.x)) suite = 2;
      let garder = false;
      if (e.libre) {
        if (mode === "profil" || /\d/.test(e.x)) garder = true;
        else if (mode === "strict") garder = rare(e);
        else {
          garder =
            propre(e) ||
            (ligneSante && rare(e)) ||
            (suite > 0 && rare(e)) ||
            // En tête de phrase, collé à un nom propre : « Hugo Lemoine ».
            (e.majuscule && e.debut && e.colle && propre(plat[j + 1]) && !estCourant(e.x, { exact: true }));
        }
      }
      if (garder) {
        simples.add(e.x);
        simples.add(racine(e.x));
      }
      if (suite > 0) suite = garder ? suite - 1 : 0;
    });
  }
  return { simples, composes };
}

// Les variantes d'un mot écrit avec des chiffres à la place des lettres
// (« F0ntanel », « L3moine », « 1emoine »).
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", 9: "g" };
function variantes(x) {
  if (!/\d/.test(x) || !/[a-z]/.test(x)) return [];
  const a = x.replace(/[01345789]/g, (c) => LEET[c]);
  const b = x.replace(/1/g, "l").replace(/[0345789]/g, (c) => LEET[c]);
  return [...new Set([a, b])].filter((v) => v !== x);
}
// Les petits mots qui ouvrent un nom de famille : « du pont » n'est pas « Dupont ».
const ARTICLES = new Set(["le", "la", "les", "l", "du", "de", "des", "d", "au", "aux"]);

// Le filtre d'une réponse. `sources` : mémoire, planning, agenda, lieux… ;
// `profil` : prénom et vocabulaire ; `conversation` : en privé, les messages
// ANTÉRIEURS ([{ role, content }], ou des textes de Sam) ; `messageEnCours` :
// ce que Sam vient d'écrire — hors privé, ses mots à lui peuvent sortir.
export function creerFiltre({ sources = [], profil = [], conversation = [], messageEnCours = "", prive = false } = {}) {
  const p = permis();
  // `doux` : ce que le message en cours de Sam peut lever ; `durs` : jamais.
  const doux = { simples: new Set(), composes: new Set() };
  const durs = { simples: new Set(), composes: new Set() };
  const verser = (cible, texte, mode) => {
    const t = termes(texte, p, { mode });
    for (const x of t.simples) cible.simples.add(x);
    for (const x of t.composes) cible.composes.add(x);
  };
  // Hors privé, Sam lève un terme en l'écrivant lui-même ; en privé, non.
  const lexique = prive ? durs : doux;
  for (const s of sources) if (s) verser(lexique, String(s), "structure");
  for (const s of profil) if (s) verser(lexique, String(s), "profil");
  if (prive) {
    for (const m of conversation) {
      const role = typeof m === "string" ? "user" : m?.role;
      const contenu = String((typeof m === "string" ? m : m?.content) ?? "");
      if (!contenu) continue;
      verser(durs, contenu, "structure");
      // Les mots rares que Sam a écrits plus tôt : ils ne sortent que s'il les réécrit maintenant.
      if (role === "user") verser(doux, contenu, "strict");
    }
    if (messageEnCours) verser(durs, String(messageEnCours), "structure");
  }
  // Ce que Sam vient d'écrire lui-même.
  const siens = new Set();
  const siensComposes = new Set();
  let siensSuite = " ";
  for (const m of messageEnCours ? mots(nettoyer(messageEnCours)) : []) {
    for (const x of m.morceaux) siens.add(x), siens.add(racine(x));
    if (m.morceaux.length > 1) siensComposes.add(m.morceaux.join(" "));
    siensSuite += `${m.morceaux.join(" ")} `;
  }
  const dans = (s, x) => s.has(x) || s.has(racine(x));
  // `exempte` : ce que Sam a écrit lève les termes « doux » (hors privé). La
  // recherche directe (lib/recherche-rapide.js) vérifie SANS cette exemption :
  // sa requête est tirée du message lui-même, aucun modèle ne l'a reformulée.
  const sensibleSi = (exempte) => (x) => !dans(p.simples, x) && (dans(durs.simples, x) || (dans(doux.simples, x) && !(exempte && dans(siens, x))));
  const composeSensibleSi = (exempte) => (c) => durs.composes.has(c) || (doux.composes.has(c) && !(exempte && siensComposes.has(c)));
  // Un terme que Sam ne peut pas lever en l'écrivant lui-même.
  const dur = (x) => !dans(p.simples, x) && dans(durs.simples, x);

  // null si le texte peut sortir ; sinon { raisons, termes, masque, lexique,
  // levable, prive } — `levable` : que des termes du lexique que Sam peut lever
  // en les écrivant lui-même (aucun motif, aucun terme « dur »).
  // `url` : une adresse de page — décodée avant d'être lue (%20, +).
  // `exempter` : faux pour ne rien lever de ce que Sam vient d'écrire.
  function verifier(texte, { url = false, exempter = true } = {}) {
    const sensible = sensibleSi(exempter);
    const composeSensible = composeSensibleSi(exempter);
    let t = String(texte ?? "");
    if (url) {
      try {
        t = decodeURIComponent(t.replace(/\+/g, " "));
      } catch {
        t = t.replace(/%[0-9a-f]{2}/gi, " ").replace(/\+/g, " ");
      }
    }
    t = nettoyer(t);
    const spans = motifs(t);
    const toks = mots(t);
    const ok = couvertsPermis(toks, p);
    couvertsPermis(toks, COMPOSES_COURANTS, ok);
    const touches = new Set();
    let durTouche = false;
    toks.forEach((m, i) => {
      const libres = m.morceaux.filter((_, k) => !ok.has(`${i}:${k}`)).flatMap((x) => [x, ...variantes(x)]);
      const c = m.morceaux.join(" ");
      if (libres.some(sensible) || composeSensible(c)) touches.add(i);
      if (libres.some(dur) || durs.composes.has(c)) durTouche = true;
    });
    // Un identifiant écrit en morceaux (« SECRET MEMOIRE 42 »).
    const { ligne, places } = enLigne(toks);
    const bornee = ` ${ligne} `;
    for (const c of new Set([...durs.composes, ...doux.composes])) {
      if (!composeSensible(c)) continue;
      for (let k = bornee.indexOf(` ${c} `); k !== -1; k = bornee.indexOf(` ${c} `, k + 1)) {
        for (const i of couverts(places, k, k + c.length)) touches.add(i);
        if (durs.composes.has(c)) durTouche = true;
      }
    }
    // Un terme coupé par des espaces ou des points (« Font anel », « F.o.n.t.a.n.e.l ») :
    // les morceaux voisins, recollés. Pas après un article (« du pont » n'est pas
    // « Dupont »), ni quand tous les morceaux sont des mots courants, ni ce que
    // Sam a écrit tel quel.
    const plat = toks.flatMap((m, i) => m.morceaux.map((x) => ({ x, i })));
    for (let j = 0; j < plat.length; j++) {
      if (ARTICLES.has(plat[j].x)) continue;
      let colle = plat[j].x;
      for (let n = 1; n < 12 && j + n < plat.length && colle.length <= 40; n++) {
        colle += plat[j + n].x;
        if (colle.length < 4 || !(sensible(colle) || variantes(colle).some(sensible))) continue;
        const bout = plat.slice(j, j + n + 1);
        if (bout.every((e) => estCourant(e.x)) || (exempter && siensSuite.includes(` ${bout.map((e) => e.x).join(" ")} `))) continue;
        for (const e of bout) touches.add(e.i);
        if (dur(colle) || variantes(colle).some(dur)) durTouche = true;
      }
    }
    for (const i of touches) spans.push({ raison: "lexique", debut: toks[i].debut, fin: toks[i].fin });
    if (!spans.length) return null;
    const raisons = [
      ...new Set(
        spans.map((s) =>
          s.raison !== "lexique"
            ? s.raison
            : prive
              ? "un nom ou un terme de ta conversation privée, de ta mémoire ou de ton planning"
              : "un nom ou un terme tiré de ta mémoire, de ton profil ou de ton planning",
        ),
      ),
    ];
    const tries = [...spans].sort((a, b) => a.debut - b.debut);
    const termesTrouves = [...new Set(tries.map((s) => t.slice(s.debut, s.fin).trim()).filter(Boolean))].slice(0, 6);
    // Le masque : le texte, sans rien de ce qui a été trouvé (pour le journal).
    let masque = "";
    let i = 0;
    for (const s of tries) {
      if (s.fin <= i) continue;
      masque += `${t.slice(i, Math.max(i, s.debut))}•••`;
      i = s.fin;
    }
    masque += t.slice(i);
    return {
      raisons,
      termes: termesTrouves,
      masque: masque.replace(/(?:•••\s*)+•••/g, "•••").replace(/\s+/g, " ").trim().slice(0, 120),
      lexique: touches.size > 0,
      levable: touches.size > 0 && !durTouche && spans.every((s) => s.raison === "lexique"),
      prive,
    };
  }

  return {
    prive,
    verifier,
    // Ce que le modèle lit en route (une liste Motion…) entre aussi au lexique.
    ajouter: (texte) => verser(lexique, String(texte ?? ""), "structure"),
    get taille() {
      return doux.simples.size + doux.composes.size + durs.simples.size + durs.composes.size;
    },
    // Pour les tests : le lexique lui-même (jamais journalisé).
    _lexique: () => ({
      simples: [...new Set([...doux.simples, ...durs.simples])],
      composes: [...new Set([...doux.composes, ...durs.composes])],
      durs: [...durs.simples],
    }),
  };
}

// Les noms propres, sigles inconnus et identifiants d'un texte — sans les
// villes, organismes, produits ni communes, qui sont publics : [termes
// normalisés]. La recherche directe (lib/recherche-rapide.js) ne fait pas
// d'une question qui en contient sa requête : c'est le modèle qui la
// reformule alors, en termes généraux (rechercher).
export function nomsDuTexte(texte) {
  const t = termes(String(texte ?? ""), permis(), { mode: "noms" });
  return [...new Set([...t.simples, ...t.composes])];
}

// Ce que le modèle relit après un refus. `salleBlanche` : le module de
// recherche n'apprend NI le terme refusé NI d'où il vient (il pourrait sinon
// sonder la mémoire mot par mot) — et il s'arrête là.
export function refusPourModele(v, { salleBlanche = false, qui = "l'utilisateur" } = {}) {
  if (salleBlanche) {
    return "Requête refusée par le filtre de confidentialité de la tour. Plus aucune recherche pour cette question : rédige ta synthèse avec ce que tu as déjà lu, et dis ce qui manque.";
  }
  // Un terme que Sam peut lever en l'écrivant lui-même dans son message : le lui proposer.
  const levier = v.levable
    ? ` Si c'est bien le sujet, ${qui} peut écrire lui-même ce mot dans son message : la recherche pourra alors partir — propose-le-lui.`
    : "";
  return (
    `Requête refusée par le filtre de confidentialité de la tour, rien n'est parti : elle contient ${v.raisons.join(", ")} ` +
    `(${v.termes.map((x) => `« ${x} »`).join(", ")}). Reformule une question générale, sans ces éléments — ni nom, ni coordonnées, ` +
    `ni détail de la mémoire, du planning ou de la conversation —, ou dis à ${qui} que tu ne peux pas chercher ça d'ici.${levier}`
  );
}

// La raison pour le journal et la barre d'étapes : courte, sans la donnée.
export const raisonCourte = (v) =>
  v.raisons.map((r) => (r.startsWith("un nom ou un terme") ? "terme personnel" : r.replace(/^(une?|un) /, ""))).join(", ");
