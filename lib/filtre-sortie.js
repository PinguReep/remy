// Le filtre des requêtes sortantes (25/10) : ce qui part de la tour vers un
// moteur de recherche ou un site — la question de rechercher, les requêtes de
// chercher_web, l'adresse d'une page à ouvrir — passe d'abord ici, sans IA.
//
// Refusé, avec la raison (pour que le modèle reformule) :
//   - une adresse e-mail, un numéro de téléphone, un IBAN, un numéro de carte
//     bancaire, un numéro de sécurité sociale, une adresse postale (numéro + voie) ;
//   - un nom propre ou un terme rare tiré de la mémoire, du profil ou du
//     planning de Sam (le « lexique »), sauf s'il est d'usage courant (liste de
//     lib/mots-courants.js), ville, organisme public ou produit — ou si Sam
//     l'a écrit lui-même dans son message en cours.
// En conversation privée, le lexique prend en plus TOUTE la conversation, le
// message en cours compris : rien de ce qu'il y confie ne sort, seulement des
// mots courants.
//
// Limites (docs/journal-technique.md) : un nom qui est aussi un mot courant
// (« Rose ») passe ; un identifiant découpé autrement (« S E C R E T ») aussi.
// Le filtre est un filet, la salle blanche (lib/salle-blanche.js) le premier
// rempart : elle ne connaît pas la mémoire.

import { MOTS_COURANTS, LIEUX_PUBLICS, ORGANISMES, PRODUITS } from "./mots-courants.js";
import { baseGeo } from "./geocodage.js";

// Sans accents ni majuscules, ligatures dépliées, apostrophes droites.
export const normaliser = (t) =>
  String(t ?? "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[’`]/g, "'")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Un mot, ou un composé (tirets, points, soulignés, apostrophes) : « Jean-Marc »,
// « SECRET-MEMOIRE-42 », « l'Urssaf », « urssaf.fr ».
const MOT = /[\p{L}\p{N}]+(?:[-_.'][\p{L}\p{N}]+)*/gu;
const parties = (n) => n.split(/[-_.']+/).filter(Boolean);
// Pluriel ôté : « bougies » et « bougie » se retrouvent.
const racine = (w) => (w.length > 4 ? w.replace(/[sx]$/, "") : w);

// --- Ce qui peut sortir --------------------------------------------------------
const COURANTS = new Set(MOTS_COURANTS.map(normaliser));
// Un verbe ou un adjectif accordé : « trouve », « cherches », « créée »,
// « entreprises » retrouvent leur forme de la liste.
const FINS = ["aient", "ait", "ent", "ons", "ez", "ees", "es", "ee", "e", "s", "x"];
export function estCourant(w) {
  if (COURANTS.has(w) || COURANTS.has(racine(w))) return true;
  for (const f of FINS) {
    if (w.length - f.length < 3 || !w.endsWith(f)) continue;
    const base = w.slice(0, -f.length);
    if (COURANTS.has(base) || COURANTS.has(`${base}er`) || COURANTS.has(`${base}e`) || COURANTS.has(`${base}ir`)) return true;
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
};

// REMY_FILTRE_PERMIS : mots ou noms toujours permis (« ma-ville, mon-club »).
const permisTour = () =>
  String(process.env.REMY_FILTRE_PERMIS || "")
    .split(/[,;\n]+/)
    .map((x) => normaliser(x).trim().replace(/\s+/g, "-"))
    .filter(Boolean);

// { simples, composes (« saint etienne »), long : le plus de morceaux d'un composé }.
function permis() {
  const simples = new Set();
  const composes = new Set();
  let long = 1;
  for (const x of [...PERMIS_BASE, ...communesLocales(), ...permisTour()]) {
    const morceaux = parties(x);
    if (morceaux.length > 1) {
      composes.add(morceaux.join(" "));
      long = Math.max(long, morceaux.length);
    } else if (morceaux[0]) simples.add(morceaux[0]);
  }
  return { simples, composes, long };
}

// Un nombre (année, montant, heure, mesure) ne dit rien de personne.
const MESURE = /^\d+(?:[.,]\d+)?(?:h\d*|min|mn|s|e|er|re|eme|k|ke|keur|eur|euros?|km|m|m2|kg|g|mg|ml|cl|l|j|ans?|jours?|mois|pm|am|go|mo|ko|gb|mb|kw|kwh|w|v|x)?$/;
const estNombre = (p) => /^\d+$/.test(p) || MESURE.test(p);

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
// Les mots d'un texte, avec leur place : [{ brut, n, morceaux, debut, fin }].
function mots(texte) {
  const out = [];
  for (const m of String(texte ?? "").matchAll(MOT)) {
    const n = normaliser(m[0]);
    out.push({ brut: m[0], n, morceaux: parties(n), debut: m.index, fin: m.index + m[0].length });
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

// Les morceaux couverts par un nom composé permis (« Saint-Étienne », « New
// York »), qu'il tienne en un mot ou en plusieurs : un Set de « mot:morceau ».
// Mot à mot, sans expression géante : la tour peut connaître des milliers de communes.
function couvertsPermis(toks, p) {
  const plat = toks.flatMap((m, i) => m.morceaux.map((x, k) => ({ x, cle: `${i}:${k}` })));
  const ok = new Set();
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
const COMMUNE = /(?<!\d)\d{5}\s+([a-z][a-z'-]*(?:\s+(?:sur|sous|en|les|la|le|de|du|des|d'|l')\s*[a-z][a-z'-]*)*)/g;

// Les termes d'un texte qui pourraient dire quelque chose de quelqu'un.
// `force` : le profil (prénom, vocabulaire) — personnel même s'il est courant.
function termes(texte, p, { force = false } = {}) {
  const simples = new Set();
  const composes = new Set();
  const n = normaliser(texte).replace(COMMUNE, (m, ville) => {
    for (const x of parties(ville.replace(/\s+/g, "-"))) p.simples.add(x);
    return " ";
  });
  const toks = mots(n);
  const ok = couvertsPermis(toks, p);
  toks.forEach((m, i) => {
    const libres = m.morceaux.filter((_, k) => !ok.has(`${i}:${k}`));
    const chiffre = m.morceaux.some((x) => /\d/.test(x));
    const lettre = m.morceaux.some((x) => /[a-z]/.test(x));
    // Un identifiant (« SECRET-MEMOIRE-42 », « AB-123-CD ») : le composé entier.
    if (libres.length === m.morceaux.length && m.morceaux.length > 1 && chiffre && lettre && !estNombre(m.morceaux.join(""))) composes.add(m.morceaux.join(" "));
    for (const x of libres) {
      if (x.length < 3 || estNombre(x) || p.simples.has(x) || p.simples.has(racine(x))) continue;
      if (!force && !/\d/.test(x) && estCourant(x)) continue;
      simples.add(x);
      simples.add(racine(x));
    }
  });
  return { simples, composes };
}

// Le filtre d'une réponse. `sources` : mémoire, planning, agenda, lieux… ;
// `profil` : prénom et vocabulaire ; `conversation` : en privé, tous ses
// messages ; `messageEnCours` : ce que Sam vient d'écrire (hors privé) — ses
// mots à lui peuvent sortir.
export function creerFiltre({ sources = [], profil = [], conversation = [], messageEnCours = "", prive = false } = {}) {
  const p = permis();
  const simples = new Set();
  const composes = new Set();
  const ajouter = (texte, opts) => {
    const t = termes(texte, p, opts);
    for (const x of t.simples) simples.add(x);
    for (const x of t.composes) composes.add(x);
  };
  for (const s of sources) if (s) ajouter(String(s));
  for (const s of profil) if (s) ajouter(String(s), { force: true });
  if (prive) for (const s of conversation) if (s) ajouter(String(s));
  // Hors privé, ce que Sam vient d'écrire lui-même sort s'il le demande.
  const siens = new Set();
  const siensComposes = new Set();
  if (!prive && messageEnCours) {
    for (const m of mots(messageEnCours)) {
      for (const x of m.morceaux) siens.add(x), siens.add(racine(x));
      if (m.morceaux.length > 1) siensComposes.add(m.morceaux.join(" "));
    }
  }
  const sensible = (x) =>
    (simples.has(x) || simples.has(racine(x))) && !siens.has(x) && !siens.has(racine(x)) && !p.simples.has(x) && !p.simples.has(racine(x));

  // null si le texte peut sortir ; sinon { raisons, termes, masque }.
  // `url` : une adresse de page — décodée avant d'être lue (%20, +).
  function verifier(texte, { url = false } = {}) {
    let t = String(texte ?? "");
    if (url) {
      try {
        t = decodeURIComponent(t.replace(/\+/g, " "));
      } catch {
        t = t.replace(/%[0-9a-f]{2}/gi, " ").replace(/\+/g, " ");
      }
    }
    const spans = motifs(t);
    const toks = mots(t);
    const ok = couvertsPermis(toks, p);
    const touches = new Set();
    toks.forEach((m, i) => {
      const c = m.morceaux.join(" ");
      if (m.morceaux.some((x, k) => !ok.has(`${i}:${k}`) && sensible(x)) || (composes.has(c) && !siensComposes.has(c))) touches.add(i);
    });
    // Un identifiant écrit en morceaux (« SECRET MEMOIRE 42 »).
    const { ligne, places } = enLigne(toks);
    const bornee = ` ${ligne} `;
    for (const c of composes) {
      if (siensComposes.has(c)) continue;
      for (let k = bornee.indexOf(` ${c} `); k !== -1; k = bornee.indexOf(` ${c} `, k + 1)) {
        for (const i of couverts(places, k, k + c.length)) touches.add(i);
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
    return { raisons, termes: termesTrouves, masque: masque.replace(/(?:•••\s*)+•••/g, "•••").replace(/\s+/g, " ").trim().slice(0, 120) };
  }

  return {
    prive,
    verifier,
    // Ce que le modèle lit en route (une liste Motion…) entre aussi au lexique.
    ajouter: (texte) => ajouter(String(texte ?? "")),
    get taille() {
      return simples.size + composes.size;
    },
    // Pour les tests : le lexique lui-même (jamais journalisé).
    _lexique: () => ({ simples: [...simples], composes: [...composes] }),
  };
}

// Ce que le modèle relit après un refus. `salleBlanche` : le module de
// recherche n'apprend NI le terme refusé NI d'où il vient (il pourrait sinon
// sonder la mémoire mot par mot) — et il s'arrête là.
export function refusPourModele(v, { salleBlanche = false, qui = "l'utilisateur" } = {}) {
  if (salleBlanche) {
    return "Requête refusée par le filtre de confidentialité de la tour. Plus aucune recherche pour cette question : rédige ta synthèse avec ce que tu as déjà lu, et dis ce qui manque.";
  }
  return (
    `Requête refusée par le filtre de confidentialité de la tour, rien n'est parti : elle contient ${v.raisons.join(", ")} ` +
    `(${v.termes.map((x) => `« ${x} »`).join(", ")}). Reformule une question générale, sans ces éléments — ni nom, ni coordonnées, ` +
    `ni détail de la mémoire, du planning ou de la conversation —, ou dis à ${qui} que tu ne peux pas chercher ça d'ici.`
  );
}

// La raison pour le journal et la barre d'étapes : courte, sans la donnée.
export const raisonCourte = (v) =>
  v.raisons.map((r) => (r.startsWith("un nom ou un terme") ? "terme personnel" : r.replace(/^(une?|un) /, ""))).join(", ");
