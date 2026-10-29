// Repère une date ou une heure dans une phrase française, sans réseau ni IA :
// le port fidèle de `AnalyseDate` (ios-native/RemyCore/Sources/RemyCore/Dates.swift),
// pour que l'aperçu de « Noter » sur l'ordinateur dise la même chose que
// l'iPhone. Les tests (test/site-analyse.test.mjs) reprennent les phrases des
// tests Swift (CarnetTests, AccueilTests, RituelTests, OrganisationTests).
//
// « Appeler le garage demain à 9h » → demain 9:00, reste « Appeler le garage ».
// Une date seule tombe à 9:00 ; une heure seule déjà passée tombe le
// lendemain. « cette semaine » va jusqu'au dimanche, « fin octobre » au dernier
// jour du mois, « début novembre » au 5 ; « avant X » jusqu'à la fin de la
// veille, 23 h 59. Un flou (« mi-novembre ») n'est jamais une date.
//
// Différences de moteur (ICU → JavaScript) traitées ici :
// - `\b` d'ICU connaît les lettres accentuées, pas celui de JavaScript : il est
//   remplacé par une frontière Unicode explicite (FRONTIERE) ;
// - `(?i)` en tête de motif devient le drapeau `i` ;
// - l'heure est celle de la machine (la tour et le PC de Sam sont à Paris ;
//   l'iPhone force Europe/Paris).
// Module pur, sans DOM : importé par le site ET par les tests node.

const LETTRE = "[\\p{L}\\p{M}\\p{N}_]";
const FRONTIERE = `(?:(?<=${LETTRE})(?!${LETTRE})|(?<!${LETTRE})(?=${LETTRE}))`;

/** Un motif écrit comme en Swift (`\b`, `(?i)` en tête) → RegExp JavaScript. */
export function motif(source, drapeaux = "") {
  let s = source;
  let f = drapeaux;
  if (s.startsWith("(?i)")) {
    s = s.slice(4);
    if (!f.includes("i")) f += "i";
  }
  s = s.replace(/\\b/g, FRONTIERE);
  if (!f.includes("u")) f += "u";
  return new RegExp(s, f);
}

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
export const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
/** « début novembre » : le 5, assez tôt pour être un début. */
const JOUR_DU_DEBUT = 5;
/** Une fin ou un début de mois passés depuis au plus 31 jours : aujourd'hui. */
const RETARD_TOLERE = 31;

const MOTIF_MOIS = String.raw`(janv(?:ier|\.)?|f[ée]v(?:rier|r?\.)?|mars|avr(?:il|\.)?|mai|juin|juil(?:let|\.)?|ao[uû]t|sept(?:embre|\.)?|oct(?:obre|\.)?|nov(?:embre|\.)?|d[ée]c(?:embre|\.)?)(?![\p{L}])`;
const MOTIF_JOUR_SEMAINE = String.raw`(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)`;
const MOTIF_MOMENT = String.raw`(matin(?:[ée]e)?|apr[eè]s[- ]midi|aprem|soir(?:[ée]e)?)\b`;
const MOTIF_AVANT = String.raw`(?:avant|pour|d['’ ]\s*ici|jusqu['’ ]\s*(?:à|a)|au\s+plus\s+tard)`;
const MOTIF_LIEN = String.raw`(?:` + MOTIF_AVANT + String.raw`\s+)?(?:(?:à\s+)?la\s+|en\s+|au\s+|le\s+)?`;
const MOTIF_SEMAINE = String.raw`\b` + MOTIF_LIEN
  + String.raw`(?:fin\s+de\s+(?:la\s+)?semaine(?:\s+prochaine)?|cette\s+semaine|dans\s+la\s+semaine(?:\s+prochaine)?|semaine\s+prochaine)\b`;
const MOTIF_SEMAINE_FLOUE = String.raw`\b(?:d[ée]but|milieu|courant|mi)\s*(?:-|de\s+|du\s+)?(?:la\s+)?semaine`;
const MOTIF_BORD_MOIS = String.raw`\b` + MOTIF_LIEN + String.raw`(fin|d[ée]but)\s+(?:(du\s+mois(?:\s+prochain)?|de\s+(?:ce\s+)?mois)|(?:d['’]\s*|de\s+)?`
  + MOTIF_MOIS + String.raw`(?:\s+(20\d{2})\b)?)`;
const MOTIF_PREFIXE_DATE = String.raw`(avant|pour|d['’ ]\s*ici|jusqu['’ ]\s*au|au\s+plus\s+tard)`;
const MOTIF_NUMERO_JOUR = String.raw`\b(?:(avant|pour|d['’ ]\s*ici|au\s+plus\s+tard)\s+le|(jusqu['’ ]\s*au)|(le))\s+(\d{1,2})(?:er)?`
  + String.raw`(\s+du\s+mois\s+(prochain))?(?![\p{L}\d/:%€]|[.,]\d)`
  + String.raw`(?!\s*(?:h|heures?|min(?:utes?)?|mn|ans?|jours?|mois|semaines?|fois|pi[eè]ces?|euros?|€|%|km|kg|m|cm|personnes?|places?)(?![\p{L}]))`
  + String.raw`(?!\s*(?:à|a)\s*\d{1,2}(?![\d:h])(?!\s*(?:h|heures?)(?![\p{L}])))`;
const MOTIF_FORMULE_RAPPEL = String.raw`^\s*(?:(?:tu\s+peux\s+|peux[- ]tu\s+)?(?:me\s+)?rappel|n['’]?\s*oublie\s+pas|fais[- ]moi\s+penser|pense\s+(?:à|a)\s)`;

// Les motifs compilés une fois (ceux qui ne dépendent de rien).
const RE = new Map();
const re = (source, drapeaux = "i") => {
  const cle = drapeaux + "\u0000" + source;
  if (!RE.has(cle)) RE.set(cle, motif(source, drapeaux));
  return RE.get(cle);
};

/** Sans accents ni casse (le `folding` de Swift). */
export function plier(s) {
  return String(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Le numéro d'un mois (« oct. » → 10). */
function numeroMois(nom) {
  const n = plier(nom);
  const debuts = ["jan", "fev", "mar", "avr", "mai", "juin", "juil", "aou", "sep", "oct", "nov", "dec"];
  const i = debuts.findIndex((d) => n.startsWith(d));
  return i < 0 ? null : i + 1;
}

/** L'heure d'un moment de la journée. */
function heureDuMoment(mot) {
  const m = mot.toLowerCase();
  return m.startsWith("matin") ? 9 : m.startsWith("soir") ? 20 : 14;
}

// --- Le calendrier (heure locale, lundi premier jour) ---

const debutDuJour = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const plusJours = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
const plusMois = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
const aHeure = (d, h, mi) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi, 0, 0);
const memeJour = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const plusSecondes = (d, s) => new Date(d.getTime() + s * 1000);
const max = (a, b) => (a >= b ? a : b);

const F_JOUR_LONG = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const F_HEURE = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
/**
 * Une échéance dite en entier, comme `Format.echeanceLongue` : « jeudi 29
 * octobre », « vendredi 30 octobre, 14:00 » (heure entre 5 h et 20 h),
 * « mardi 31 août 2027 » (autre année).
 */
export function echeanceLongue(d, maintenant = new Date()) {
  const jour = F_JOUR_LONG.format(d) + (d.getFullYear() === maintenant.getFullYear() ? "" : ` ${d.getFullYear()}`);
  const h = d.getHours();
  return h >= 20 || h < 5 ? jour : `${jour}, ${F_HEURE.format(d)}`;
}
/**
 * « avant ce soir » (le jour même), « avant 14:00 » (aujourd'hui, à une
 * heure), sinon « avant l'échéance : vendredi 30 octobre » (CaptureView).
 */
export function avantEcheance(d, maintenant = new Date()) {
  const memeJour = d.getFullYear() === maintenant.getFullYear() && d.getMonth() === maintenant.getMonth() && d.getDate() === maintenant.getDate();
  const h = d.getHours();
  if (memeJour) return h >= 20 || h < 5 ? "avant ce soir" : `avant ${F_HEURE.format(d)}`;
  return `avant l'échéance : ${echeanceLongue(d, maintenant)}`;
}

/** La fin du jour pour une tâche : 23 h (comme `Format.echeanceDans`). */
export function echeanceDans(jours, depuis = new Date()) {
  const j = plusJours(debutDuJour(depuis), jours);
  return aHeure(j, 23, 0);
}

/** Une date à venir (le 3/02 en décembre : l'an prochain). */
function dateAVenir(jour, mois, annee, debut) {
  if (annee != null) {
    let a = annee;
    if (a < 100) a += 2000;
    return new Date(a, mois - 1, jour);
  }
  const d = new Date(debut.getFullYear(), mois - 1, jour);
  return d < debut ? new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()) : d;
}

/** Le prochain « 3 » à venir, aujourd'hui compris. */
function prochain(n, debut) {
  if (!(n >= 1 && n <= 31)) return null;
  const premier = new Date(debut.getFullYear(), debut.getMonth(), 1);
  for (let k = 0; k < 13; k++) {
    const mois = plusMois(premier, k);
    const d = plusJours(mois, n - 1);
    if (d.getMonth() !== mois.getMonth() || d < debut) continue;
    return d;
  }
  return null;
}

// --- Petits outils de texte (Swift → JS) ---

const ESPACES = " \t              　";
/** `trimmingCharacters(in: .whitespaces ∪ autres)`. */
export function rogner(s, autres = "", lignes = false) {
  const ens = new Set([...ESPACES, ...autres, ...(lignes ? "\n\r  \u0085\u000b\u000c" : "")]);
  const t = [...String(s)];
  let a = 0;
  let b = t.length;
  while (a < b && ens.has(t[a])) a++;
  while (b > a && ens.has(t[b - 1])) b--;
  return t.slice(a, b).join("");
}

const estMinuscule = (c) => c !== c.toUpperCase() && c === c.toLowerCase();

/**
 * Lit une date dans `texte`. Rend `null` sans date, sinon
 * `{ quand, reste, heureDite, echeance, dejaPassee, limite }` (`quand` et
 * `echeance` sont des `Date`).
 */
export function extraire(texte, maintenant = new Date()) {
  let t = " " + texte + " ";
  let jour = null;
  let heure = null; // [h, mi]
  let relatif = null;
  let relatifEnJours = false;
  let memeJourSemaine = false;
  let moment = null;

  const retirer = (index, longueur) => {
    t = t.slice(0, index) + " " + t.slice(index + longueur);
  };
  const cherche = (source) => {
    const r = re(source);
    r.lastIndex = 0;
    return r.exec(t);
  };
  /** Juste à cet endroit (ce qui suit un jour ou une heure retirés). */
  const chercheA = (source, position) => {
    if (position > t.length) return null;
    const r = re(source, "iy");
    r.lastIndex = position;
    return r.exec(t);
  };
  const fin = (m) => m.index + m[0].length;
  const debut = debutDuJour(maintenant);

  // « dans 20 min », « dans 2 heures », « dans 1h30 », « dans 3 jours ».
  {
    const m = cherche(String.raw`\bdans\s+(\d{1,3}|une?)\s*(?:(h(?:eures?)?)(?:\s*([0-5]\d)(?!\s*(?:h|min)))?|(min(?:ute)?s?|mn)|(jours?)|(semaines?))\b`);
    if (m && m[1]) {
      const brut = m[1].toLowerCase();
      const lu = Number.parseInt(brut, 10);
      const n = Number.isNaN(lu) ? 1 : lu;
      let secondes;
      if (m[2] != null) {
        secondes = n * 3600 + (m[3] != null ? Number(m[3]) : 0) * 60;
      } else if (m[4] != null) {
        secondes = n * 60;
      } else {
        relatifEnJours = true;
        secondes = n * 86400 * (m[6] != null ? 7 : 1);
      }
      relatif = relatifEnJours ? plusJours(maintenant, Math.trunc(secondes / 86400)) : plusSecondes(maintenant, secondes);
      retirer(m.index, m[0].length);
    }
  }

  let finJour = null;
  let avantStrict = false;
  let finDeVeille = false;
  let dejaPassee = null;
  let limite = false;
  const estAvant = (p) => p != null && p.toLowerCase() === "avant";
  const estLimite = (p) => (p == null ? false : !p.toLowerCase().startsWith("pour"));
  const premierDuMois = new Date(debut.getFullYear(), debut.getMonth(), 1);

  /** « le 3 » seul ne se lit qu'en fin de phrase, devant une heure ou un moment… */
  const numeroJour = () => {
    const formule = cherche(MOTIF_FORMULE_RAPPEL) != null;
    const r = re(MOTIF_NUMERO_JOUR, "gi");
    for (const m of t.matchAll(r)) {
      if (m[3] == null) return m;
      const sans = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length);
      const mots = sans.split(/[\s,;:.!?…]+/u).filter(Boolean);
      if (mots.length === 1) continue;
      const suite = String.raw`\s*(?:$|[,.;:!?…)]|(?:à|a|vers|au|dès|matin|soir|apr[eè]s|midi)(?![\p{L}])|dans\s+la\s+(?:matin[ée]e|soir[ée]e)`
        + (formule ? String.raw`|d['’ ]|de\s+)` : ")");
      if (chercheA(suite, fin(m)) != null) return m;
    }
    return null;
  };

  let m;
  if ((m = cherche(String.raw`\b(?:aujourd'hui|aujourd’hui|ce\s+matin|ce\s+soir|cet\s+apr[eè]s[- ]midi|cet\s+aprem)\b`))) {
    const mot = m[0].toLowerCase();
    jour = debut;
    if (mot.includes("matin")) moment = 9;
    if (mot.includes("soir")) moment = 20;
    if (mot.includes("midi") || mot.includes("aprem")) moment = 14;
    heure = moment != null ? [moment, 0] : null;
    retirer(m.index, m[0].length);
    if (moment == null) finJour = m.index;
  } else if ((m = cherche(String.raw`\b(?:(` + MOTIF_AVANT + String.raw`)\s+)?apr[eè]s[- ]demain\b`))) {
    jour = plusJours(debut, 2);
    avantStrict = estAvant(m[1]);
    limite = estLimite(m[1]);
    retirer(m.index, m[0].length);
    finJour = m.index;
  } else if ((m = cherche(String.raw`\b(?:(` + MOTIF_AVANT + String.raw`)\s+)?demain\b`))) {
    jour = plusJours(debut, 1);
    avantStrict = estAvant(m[1]);
    limite = estLimite(m[1]);
    retirer(m.index, m[0].length);
    finJour = m.index;
  } else if ((m = (() => {
    const x = cherche(String.raw`\b(?:` + MOTIF_PREFIXE_DATE + String.raw`\s+)?(?:le\s+)?(?:` + MOTIF_JOUR_SEMAINE + String.raw`\s+)?(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b`);
    if (!x) return null;
    const j = Number(x[2]);
    const mo = Number(x[3]);
    if (!(j >= 1 && j <= 31) || !(mo >= 1 && mo <= 12)) return null;
    const d = dateAVenir(j, mo, x[4] != null ? Number(x[4]) : null, debut);
    return d ? Object.assign(x, { date: d }) : null;
  })())) {
    jour = m.date;
    avantStrict = estAvant(m[1]);
    limite = estLimite(m[1]);
    retirer(m.index, m[0].length);
    finJour = m.index;
  } else if ((m = (() => {
    const x = cherche(String.raw`\b(?:` + MOTIF_PREFIXE_DATE + String.raw`\s+)?(?:le\s+)?(?:` + MOTIF_JOUR_SEMAINE + String.raw`\s+)?(\d{1,2})(?:er)?\s+` + MOTIF_MOIS + String.raw`(?:\s+(20\d{2})\b)?`);
    if (!x) return null;
    const j = Number(x[2]);
    const mo = x[3] != null ? numeroMois(x[3]) : null;
    if (mo == null || !(j >= 1 && j <= 31)) return null;
    const d = dateAVenir(j, mo, x[4] != null ? Number(x[4]) : null, debut);
    return d ? Object.assign(x, { date: d }) : null;
  })())) {
    jour = m.date;
    avantStrict = estAvant(m[1]);
    limite = estLimite(m[1]);
    retirer(m.index, m[0].length);
    finJour = m.index;
  } else if ((m = cherche(String.raw`\b(?:(` + MOTIF_AVANT + String.raw`)\s+)?(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(\s+prochain)?\b`)) && JOURS.includes(m[2]?.toLowerCase())) {
    const cible = JOURS.indexOf(m[2].toLowerCase());
    const actuel = maintenant.getDay();
    const ecart = (cible - actuel + 7) % 7;
    avantStrict = estAvant(m[1]);
    limite = estLimite(m[1]);
    memeJourSemaine = ecart === 0 && m[3] == null;
    jour = plusJours(debut, ecart === 0 && !memeJourSemaine ? 7 : ecart);
    retirer(m.index, m[0].length);
    finJour = m.index;
    // « vendredi de la semaine prochaine » : celui qui suit le lundi qui vient.
    const s = chercheA(String.raw`\s*,?\s*(?:de\s+)?(?:(cette)\s+semaine|(?:la\s+)?semaine\s+prochaine)\b`, m.index);
    if (s) {
      if (s[1] == null && jour) {
        const versLundi = (1 - debut.getDay() + 7) % 7;
        const lundi = plusJours(debut, versLundi === 0 ? 7 : versLundi);
        if (jour < lundi) jour = plusJours(jour, 7);
        memeJourSemaine = false;
      }
      retirer(s.index, s[0].length);
    }
  } else if (cherche(MOTIF_SEMAINE_FLOUE) == null && (m = cherche(MOTIF_SEMAINE))) {
    // Jusqu'au dimanche de cette semaine (lundi → dimanche), ou de la suivante.
    const ecart = (0 - debut.getDay() + 7) % 7;
    const prochaine = m[0].toLowerCase().includes("prochaine");
    jour = plusJours(debut, ecart + (prochaine ? 7 : 0));
    retirer(m.index, m[0].length);
  } else if ((m = cherche(MOTIF_BORD_MOIS))) {
    const finMois = (m[1] || "").toLowerCase() === "fin";
    limite = re(String.raw`^\s*(?:avant|d['’ ]\s*ici|jusqu|au\s+plus\s+tard)`).test(m[0]);
    const borne = (premier) => (finMois
      ? new Date(premier.getFullYear(), premier.getMonth() + 1, 0)
      : plusJours(premier, JOUR_DU_DEBUT - 1));
    let candidates = [];
    let dit = "";
    if (m[2] != null) {
      const duMois = m[2].toLowerCase();
      const prochainMois = duMois.includes("prochain");
      const ceMois = /\bce\s+mois/.test(duMois);
      let decalage = prochainMois ? 1 : 0;
      if (!prochainMois && !ceMois && borne(premierDuMois) < debut) decalage = 1;
      candidates = [borne(plusMois(premierDuMois, decalage))];
      dit = prochainMois ? "du mois prochain" : ceMois ? "de ce mois" : "du mois";
    } else if (m[3] != null && numeroMois(m[3]) != null) {
      const mo = numeroMois(m[3]);
      const an = debut.getFullYear();
      const annees = m[4] != null ? [Number(m[4])] : [an - 1, an, an + 1];
      candidates = annees.map((a) => borne(new Date(a, mo - 1, 1)));
      dit = NOMS_MOIS[mo - 1];
    }
    const passees = candidates.filter((c) => c < debut);
    const aVenir = candidates.filter((c) => c >= debut);
    const recente = passees.length ? passees.reduce((a, b) => (a > b ? a : b)) : null;
    if (recente && (aVenir.length === 0 || Math.round((debut - recente) / 86400000) <= RETARD_TOLERE)) {
      jour = debut;
      dejaPassee = `${finMois ? "fin" : "début"} ${dit}, déjà passé${finMois ? "e" : ""}`;
    } else {
      jour = aVenir.length ? aVenir.reduce((a, b) => (a < b ? a : b)) : null;
    }
    if (jour) retirer(m.index, m[0].length);
  } else if ((m = numeroJour())) {
    const n = Number(m[4]);
    const depuis = m[6] != null ? plusMois(premierDuMois, 1) : debut;
    const d = prochain(n, depuis);
    if (d) {
      jour = d;
      avantStrict = estAvant(m[1]);
      limite = estLimite(m[1]) || m[2] != null;
      retirer(m.index, m[0].length);
      finJour = m.index;
    }
  }

  // « demain soir », « lundi après-midi », « vendredi dans la matinée ».
  if (finJour != null) {
    const x = chercheA(String.raw`\s*(?:au\s+|le\s+|du\s+|de\s+l['’]\s*|dans\s+la\s+|en\s+)?` + MOTIF_MOMENT, finJour);
    if (x && x[1]) {
      moment = heureDuMoment(x[1]);
      heure = [moment, 0];
      retirer(x.index, x[0].length);
    }
  }

  // L'heure : « à 18h30 », « 18 h », « 9h », « 18:30 », « à 14 heures », « à midi ».
  const duree = String.raw`\s*d(?:e\s+(?!l['’]\s*apr)|['’])`;
  let apresHeure = null;
  const h1 = cherche(String.raw`\b(?:à|vers)\s+([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b(?!\s*(?:min|jours?))`)
    ?? cherche(String.raw`\b(?:à|vers)\s+([01]?\d|2[0-3])\s*heures?(?:\s*([0-5]\d)\b)?(?![\p{L}])`)
    ?? cherche(String.raw`\ba\s+([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b(?!\s*(?:min|jours?)|` + duree + ")")
    ?? cherche(String.raw`\ba\s+([01]?\d|2[0-3])\s*heures?(?:\s*([0-5]\d)\b)?(?![\p{L}])(?!` + duree + ")")
    ?? cherche(String.raw`\b([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b(?!\s*(?:min|jours?)|` + duree + ")");
  if (h1 && h1[1] != null) {
    heure = [Number(h1[1]), h1[2] != null ? Number(h1[2]) : 0];
    retirer(h1.index, h1[0].length);
    apresHeure = h1.index;
  } else {
    const midi = cherche(String.raw`(?:\b(?:à|a|vers)\s+)?(?<![\p{L}-])(?<!apr[eè]s )midi\b`);
    if (midi) {
      heure = [12, 0];
      retirer(midi.index, midi[0].length);
    }
  }
  // « à 3h de l'après-midi », « à 8h du soir », « à 9h du matin ».
  if (apresHeure != null) {
    const x = chercheA(String.raw`\s*(?:du\s+|de\s+l['’]\s*)` + MOTIF_MOMENT, apresHeure);
    if (x && x[1]) {
      moment = heureDuMoment(x[1]);
      retirer(x.index, x[0].length);
    }
  }
  // « demain soir à 8h » : 20 h, pas 8 h du matin.
  if (heure && moment != null && moment >= 14 && heure[0] < 12) heure = [heure[0] + 12, heure[1]];
  // « avant le 3 » sans heure : la veille (23 h 59), jamais une date passée.
  if (avantStrict && heure == null && jour) {
    let j = jour;
    if (memeJourSemaine) {
      j = plusJours(j, 7);
      memeJourSemaine = false;
    }
    jour = max(plusJours(j, -1), debut);
    finDeVeille = true;
  }

  let quand;
  let echeance = null;
  if (relatif) {
    quand = relatifEnJours && heure ? aHeure(relatif, heure[0], heure[1]) : relatif;
  } else if (jour) {
    const [h, mi] = heure ?? [9, 0];
    const d = aHeure(jour, h, mi);
    let q = memeJourSemaine && d <= maintenant ? plusJours(d, 7) : d;
    // Un jour sans heure qui tombe aujourd'hui, 9 h passé : la prochaine heure pleine.
    const prochaineHeure = () => {
      const hh = maintenant.getHours();
      return hh < 23 ? aHeure(maintenant, hh + 1, 0) : plusSecondes(maintenant, 600);
    };
    if (heure == null && q <= maintenant && memeJour(jour, maintenant)) q = prochaineHeure();
    // Une fin de mois déjà passée, dite avec une heure : jamais dans le passé.
    if (heure != null && dejaPassee != null && q <= maintenant) {
      q = prochaineHeure();
      dejaPassee += " : dans l'heure";
    } else if (heure != null && dejaPassee != null) {
      const [hh, mm] = heure;
      dejaPassee += ` : aujourd'hui à ${hh} h` + (mm > 0 ? " " + String(mm).padStart(2, "0") : "");
    } else if (dejaPassee != null) {
      dejaPassee += " : ce soir";
    }
    quand = q;
    if (heure == null) {
      let e = finDeVeille ? aHeure(jour, 23, 59) : echeanceDans(0, jour);
      if (e <= maintenant) e = memeJourSemaine ? plusJours(e, 7) : aHeure(jour, 23, 59);
      echeance = e;
    }
  } else if (heure) {
    const d = aHeure(debut, heure[0], heure[1]);
    quand = d > maintenant ? d : plusJours(d, 1);
  } else {
    return null;
  }
  const heureDite = heure != null || (relatif != null && !relatifEnJours);
  if (echeance == null) echeance = heureDite ? quand : echeanceDans(0, quand);
  return { quand, reste: nettoyer(t), heureDite, echeance, dejaPassee, limite };
}

/** Les restes de liaison autour des mots retirés, puis la formule de demande. */
function nettoyer(t) {
  let s = t.replace(/\s+/gu, " ").replace(/\s+,/gu, ",");
  s = s.replace(/\s*[.!…]+\s*$/u, "");
  s = s.replace(motif(String.raw`(?i)\s(?:à|a|le|pour|vers|avant|d['’ ]\s*ici|au\s+plus\s+tard|jusqu['’ ]\s*(?:à|a|au)?|,)\s*$`, "g"), "");
  s = s.replace(motif(String.raw`(?i)^\s*(?:à|le|pour|,)\s`, "g"), "");
  return sansFormule(rogner(s, ",;:-."));
}

const FORMULES = [
  String.raw`(?:tu\s+peux\s+|peux[- ]tu\s+)?(?:me\s+)?rappel(?:le|er)?[- ]?(?:moi\s+)?(?:de\s+|d['’]\s*|d\s+(?=[aeiouyhàâéèêîôû])|que\s+|qu['’]\s*)`,
  String.raw`rappel(?:le)?[- ]moi\s+`,
  String.raw`rappel\s*:\s*`,
  String.raw`n['’]?\s*oublie\s+pas\s+(?:de\s+|d['’]\s*|d\s+(?=[aeiouyhàâéèêîôû]))?`,
  String.raw`fais[- ]moi\s+penser\s+(?:à\s+|a\s+)`,
  String.raw`pense(?:r)?\s+(?:à\s+|a\s+)`,
  String.raw`(?:il\s+)?faut\s+que\s+(?:je\s+|j['’]\s*)`,
  String.raw`je\s+dois\s+`,
];

/** Ce qu'il faut faire, sans la façon de le demander (« rappelle-moi d'aller… » → « Aller… »). */
export function sansFormule(texte) {
  let s = rogner(texte);
  for (const f of FORMULES) {
    const r = s.replace(motif("(?i)^" + f), "");
    if (r !== s) {
      s = r;
      break;
    }
  }
  s = rogner(s, ",;:-");
  const premiere = [...s][0];
  if (premiere == null || !estMinuscule(premiere)) return s === "" ? texte : s;
  return premiere.toUpperCase() + s.slice(premiere.length);
}
