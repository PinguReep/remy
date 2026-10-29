// La recherche web du modèle local (25/10) : Rémy cherche et lit lui-même,
// depuis la tour, sans passer par Claude ni demander à chaque fois. Même
// principe qu'Hermes Agent (Nous Research) : un outil de recherche et un outil
// de lecture dans la boucle d'outils du modèle, qui décide seul de s'en servir.
//
//   REMY_RECHERCHE         duckduckgo (défaut : sans clé ni installation) | searxng | off
//   REMY_SEARXNG_URL       l'instance SearXNG (ex. http://<spark>:8090), son API JSON
//   REMY_RECHERCHE_MAX     recherches par message (défaut 4)
//   REMY_LECTURE_MAX       pages lues (lire_page) par message (défaut 6)
//   REMY_RECHERCHE_DELAI_MS / REMY_LECTURE_DELAI_MS   délais (8 s / 15 s)
//   REMY_RECHERCHE_RELAIS_MS  le second point d'entrée part si le premier tarde (2 s)
//
// Ce qui part : la requête écrite par le modèle, vers le moteur choisi ; puis
// les pages qu'il ouvre. Depuis le 25/10, ce modèle-là est la SALLE BLANCHE
// (lib/salle-blanche.js) : une boucle qui ne voit que la question posée par le
// modèle principal, jamais la mémoire de Sam ; et chaque requête, chaque
// adresse composée passe d'abord le filtre des requêtes sortantes
// (lib/filtre-sortie.js). Les pages lues passent par la même garde anti-SSRF que
// le navigateur (lib/browse.js) : jamais la tour, les Sparks ni le tailnet.
// Et une page ne s'ouvre que si son adresse vient d'ailleurs que du modèle
// (urlPermise : un résultat de chercher_web, un message de Sam, un site
// officiel sans « ? ») : un extrait piégé ne peut pas lui faire fabriquer
// https://ailleurs/?d=<la mémoire de Sam> (relecture du 25/10).

import { telechargerSur } from "./browse.js";
import { PRENOM } from "./profil.js";

const entier = (v, defaut, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut;
};
export const backendRecherche = () => String(process.env.REMY_RECHERCHE || "duckduckgo").trim().toLowerCase();
// Les outils chercher_web / lire_page existent sur cette tour.
export const rechercheLocaleActive = () => backendRecherche() !== "off";
export const rechercheMax = () => entier(process.env.REMY_RECHERCHE_MAX, 4, 1, 20);
export const lectureMax = () => entier(process.env.REMY_LECTURE_MAX, 6, 1, 30);
const delaiRecherche = () => entier(process.env.REMY_RECHERCHE_DELAI_MS, 8_000, 1_000, 60_000);
const delaiLecture = () => entier(process.env.REMY_LECTURE_DELAI_MS, 15_000, 1_000, 120_000);
const MAX_OCTETS_PAGE = 3 * 1024 * 1024;
// Au-delà, le HTML n'est pas analysé : une page normale tient en quelques
// centaines de Ko, et l'analyse reste ainsi bornée en temps.
const MAX_HTML_ANALYSE = 1_500_000;
const MAX_TEXTE = 10_000;

// Une requête de navigateur ordinaire : DuckDuckGo et bien des sites
// officiels refusent (503, 202) un client sans en-têtes.
export const ENTETES_NAVIGATEUR = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
};

export class ErreurRecherche extends Error {
  constructor(message) {
    super(message);
    this.name = "ErreurRecherche";
  }
}

// --- Texte brut ---------------------------------------------------------------
const ENTITES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", euro: "€", laquo: "«", raquo: "»",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", ndash: "–", mdash: "—", deg: "°", middot: "·",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", agrave: "à", acirc: "â", ccedil: "ç", icirc: "î", iuml: "ï",
  ocirc: "ô", ugrave: "ù", ucirc: "û", uuml: "ü", oelig: "œ", Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç",
  thinsp: "\u2009", ensp: " ", emsp: " ", shy: "", times: "×", copy: "©", reg: "®", sup2: "²",
};
export function decoderEntites(t) {
  return String(t ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENTITES[e] ?? ENTITES[e.toLowerCase()] ?? m;
  });
}
// Toutes les expressions sur du HTML reçu restent en temps LINÉAIRE : jamais
// `[^>]*` (une page de « < » sans « > » se relisait à chaque « < » : 250 Ko,
// 56 s de tour gelée — relecture du 25/10), mais `[^<>]*`, qui s'arrête au
// « < » suivant ; et les blocs appariés (script, commentaires, lignes de
// tableau…) se retirent en un seul passage (blocs, sansCommentaires).
// Les balises de mise en forme collent au texte (« l'<b>Acre</b> ») ; les autres séparent.
const EN_LIGNE = /<\/?(?:a|abbr|b|strong|em|i|u|s|span|mark|small|sup|sub|code|time|q|cite|dfn|ins|del)\b[^<>]*>/gi;
const BALISE = /<[^<>]*>/g;
const texteBrut = (html) =>
  decoderEntites(String(html ?? "").replace(EN_LIGNE, "").replace(BALISE, " "))
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .trim();

// Les commentaires <!-- … -->, en un passage ; non fermé : la fin est coupée
// (c'est ce que fait un navigateur).
function sansCommentaires(h) {
  let out = "";
  let i = 0;
  for (;;) {
    const d = h.indexOf("<!--", i);
    if (d === -1) return out + h.slice(i);
    const f = h.indexOf("-->", d + 4);
    if (f === -1) return `${out}${h.slice(i, d)} `;
    out += `${h.slice(i, d)} `;
    i = f + 3;
  }
}

// Les blocs <nom …>…</nom> (noms : « script|style|… »), en un passage :
// `rendu(interieur)` remplace chacun. Une balise ouvrante sans fermeture : la
// fin est coupée (`couper`, un script non fermé avale la page) ou gardée telle
// quelle — et ce nom n'est plus cherché ensuite (aucune fermeture plus loin).
function blocs(h, noms, { rendu = () => " ", couper = true } = {}) {
  const ouvre = new RegExp(`<(${noms})\\b[^<>]*>`, "gi");
  const sansFin = new Set();
  let out = "";
  let i = 0;
  for (;;) {
    ouvre.lastIndex = i;
    const m = ouvre.exec(h);
    if (!m) return out + h.slice(i);
    const nom = m[1].toLowerCase();
    let f = null;
    let ferme = null;
    if (!sansFin.has(nom)) {
      ferme = new RegExp(`<\\/${nom}\\s*>`, "gi");
      ferme.lastIndex = ouvre.lastIndex;
      f = ferme.exec(h);
      if (!f) sansFin.add(nom);
    }
    if (!f) {
      if (couper) return `${out}${h.slice(i, m.index)} `;
      out += h.slice(i, ouvre.lastIndex);
      i = ouvre.lastIndex;
      continue;
    }
    out += h.slice(i, m.index) + rendu(h.slice(ouvre.lastIndex, f.index));
    i = ferme.lastIndex;
  }
}

// La dernière position d'un motif (global), ou -1.
const derniere = (h, re) => {
  let k = -1;
  for (const m of h.matchAll(re)) k = m.index;
  return k;
};

// --- DuckDuckGo (sans clé) ------------------------------------------------------
// La version HTML d'abord, la version « lite » si la première bloque : deux
// points d'entrée, deux mises en page, une seule lecture.
const pointsDuckDuckGo = () => [
  { nom: "html.duckduckgo.com", url: process.env.REMY_DUCKDUCKGO_URL || "https://html.duckduckgo.com/html/" },
  { nom: "lite.duckduckgo.com", url: process.env.REMY_DUCKDUCKGO_LITE_URL || "https://lite.duckduckgo.com/lite/" },
];

// Un lien de résultat : direct, ou par la redirection de DuckDuckGo
// (//duckduckgo.com/l/?uddg=<adresse>). Une publicité (y.js) n'en est pas un.
function urlResultat(href) {
  if (!href) return null;
  let u;
  try {
    u = new URL(decoderEntites(href), "https://duckduckgo.com/");
  } catch {
    return null;
  }
  if (/(^|\.)duckduckgo\.com$/i.test(u.hostname)) {
    const cible = u.searchParams.get("uddg");
    if (!cible) return null;
    try {
      u = new URL(cible);
    } catch {
      return null;
    }
  }
  return /^https?:$/.test(u.protocol) && !/(^|\.)duckduckgo\.com$/i.test(u.hostname) ? u.href : null;
}

const VERIFICATION = /anomaly-modal|challenge-form|anomaly\.js/i;

// Les résultats d'une page DuckDuckGo (html ou lite). Lève une ErreurRecherche
// si la page est une vérification anti-robot ou n'a pas la forme attendue.
export function analyserDuckDuckGo(html) {
  const h = String(html || "").slice(0, MAX_HTML_ANALYSE);
  if (VERIFICATION.test(h)) throw new ErreurRecherche("vérification anti-robot");
  const liens = [...h.matchAll(/<a\b([^<>]*\bclass\s*=\s*["'][^"']*\b(?:result__a|result-link)\b[^"']*["'][^<>]*)>([\s\S]*?)<\/a>/gi)];
  const resultats = [];
  const vus = new Set();
  for (let i = 0; i < liens.length; i++) {
    const m = liens[i];
    const url = urlResultat(m[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]);
    if (!url || vus.has(url)) continue;
    vus.add(url);
    // L'extrait est entre ce lien et le suivant (balise a, td ou div selon la version).
    const bloc = h.slice(m.index + m[0].length, liens[i + 1]?.index ?? h.length);
    const extrait = bloc.match(/class\s*=\s*["'][^"']*\bresult(?:__|-)snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|td|div|span)>/i)?.[1];
    resultats.push({ titre: texteBrut(m[2]).slice(0, 200), url, extrait: texteBrut(extrait).slice(0, 400) });
  }
  if (!resultats.length && !/no-results|No results|Aucun résultat/i.test(h)) {
    throw new ErreurRecherche("page de résultats illisible (sa mise en page a peut-être changé)");
  }
  return resultats;
}

// Bloqué partout : on n'insiste pas pendant 5 minutes (chaque essai prolonge
// le blocage chez DuckDuckGo).
let bloqueJusqua = 0;
export const _oublierBlocage = () => {
  bloqueJusqua = 0;
};
const BLOQUE =
  "DuckDuckGo bloque les recherches de la tour pour le moment (vérification anti-robot, sur ses deux points d'entrée). " +
  `Dis-le à ${PRENOM} : réessayer dans quelques minutes, ou installer SearXNG sur un Spark (docs/tour.md, « Recherche web »).`;

// Un point d'entrée : { resultats, pointDEntree }, ou une erreur (`bloque` :
// vérification anti-robot).
async function interrogerPoint(p, requete, signal) {
  let r;
  let html;
  try {
    r = await fetch(p.url, {
      method: "POST",
      headers: { ...ENTETES_NAVIGATEUR, "Content-Type": "application/x-www-form-urlencoded", Referer: new URL(p.url).origin + "/" },
      body: new URLSearchParams({ q: requete, kl: "fr-fr" }).toString(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(delaiRecherche())]),
    });
    html = await r.text();
  } catch (err) {
    throw new Error(`${p.nom} : ${err.name === "TimeoutError" || err.name === "AbortError" ? "délai dépassé" : err.message}`);
  }
  if (r.status === 202 || VERIFICATION.test(html)) {
    const e = new Error(`${p.nom} : vérification anti-robot`);
    e.bloque = true;
    throw e;
  }
  if (!r.ok) throw new Error(`${p.nom} : réponse ${r.status}`);
  try {
    return { resultats: analyserDuckDuckGo(html), pointDEntree: p.nom };
  } catch (err) {
    throw new Error(`${p.nom} : ${err.message}`);
  }
}

// Le point suivant part en RELAIS si le premier tarde (29/10, mesuré : la
// plupart des réponses en moins d'une seconde, quelques-unes à 6 s ou au délai
// de 8 s) : le premier qui répond l'emporte, l'autre est coupé. Une réponse
// rapide ne coûte donc qu'une requête ; une lente, deux.
// REMY_RECHERCHE_RELAIS_MS (défaut 2 000 ; 0 : l'un après l'autre).
const relaisMs = () => entier(process.env.REMY_RECHERCHE_RELAIS_MS, 2_000, 0, 30_000);

async function duckduckgo(requete) {
  if (Date.now() < bloqueJusqua) throw new ErreurRecherche(BLOQUE);
  const points = pointsDuckDuckGo();
  const relais = relaisMs();
  const echecs = [];
  let bloques = 0;
  return new Promise((resolve, reject) => {
    let fini = false;
    let lances = 0;
    let enCours = 0;
    let minuteur = null;
    const controleurs = [];
    const conclure = () => {
      if (fini || enCours > 0 || lances < points.length) return;
      fini = true;
      if (bloques === points.length) {
        bloqueJusqua = Date.now() + 5 * 60_000;
        return reject(new ErreurRecherche(BLOQUE));
      }
      reject(new ErreurRecherche(`Recherche impossible (DuckDuckGo) : ${echecs.join(" ; ")}. Dis-le à ${PRENOM} plutôt que de répondre de mémoire.`));
    };
    const suivant = () => {
      clearTimeout(minuteur);
      if (fini) return;
      if (lances >= points.length) return conclure();
      const p = points[lances++];
      const ctrl = new AbortController();
      controleurs.push(ctrl);
      enCours++;
      if (relais && lances < points.length) minuteur = setTimeout(suivant, relais);
      interrogerPoint(p, requete, ctrl.signal).then(
        (r) => {
          enCours--;
          if (fini) return;
          fini = true;
          clearTimeout(minuteur);
          for (const c of controleurs) if (c !== ctrl) c.abort();
          resolve(r);
        },
        (err) => {
          enCours--;
          if (fini) return;
          if (err.bloque) bloques++;
          echecs.push(err.message);
          if (lances < points.length) suivant();
          else conclure();
        },
      );
    };
    suivant();
  });
}

// --- SearXNG (sur un Spark) -----------------------------------------------------
export function analyserSearxng(j) {
  const vus = new Set();
  const resultats = [];
  for (const x of Array.isArray(j?.results) ? j.results : []) {
    let url;
    try {
      url = new URL(String(x?.url || ""));
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || vus.has(url.href)) continue;
    vus.add(url.href);
    const date = /^\d{4}-\d{2}-\d{2}/.test(String(x.publishedDate || "")) ? String(x.publishedDate).slice(0, 10) : null;
    resultats.push({ titre: texteBrut(x.title).slice(0, 200), url: url.href, extrait: texteBrut(x.content).slice(0, 400), ...(date ? { date } : {}) });
  }
  return resultats;
}

async function searxng(requete) {
  const base = String(process.env.REMY_SEARXNG_URL || "").trim();
  if (!base) throw new ErreurRecherche("REMY_RECHERCHE=searxng, mais REMY_SEARXNG_URL manque dans remy.env (l'adresse de SearXNG).");
  let u;
  try {
    u = new URL("search", base.replace(/\/*$/, "/"));
  } catch {
    throw new ErreurRecherche(`REMY_SEARXNG_URL illisible (« ${base.slice(0, 80)} »).`);
  }
  u.searchParams.set("q", requete);
  u.searchParams.set("format", "json");
  u.searchParams.set("language", "fr-FR");
  let r;
  try {
    r = await fetch(u, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(delaiRecherche()) });
  } catch (err) {
    throw new ErreurRecherche(`SearXNG injoignable (${err.name === "TimeoutError" ? "délai dépassé" : err.message}) : vérifie qu'il tourne sur le Spark.`);
  }
  if (r.status === 403) throw new ErreurRecherche("SearXNG refuse le format JSON : ajoute « json » à search.formats dans son settings.yml, puis redémarre-le.");
  if (!r.ok) throw new ErreurRecherche(`SearXNG : réponse ${r.status}.`);
  const j = await r.json().catch(() => null);
  if (!j || !Array.isArray(j.results)) throw new ErreurRecherche("SearXNG : réponse illisible (JSON attendu).");
  const resultats = analyserSearxng(j);
  const muets = (j.unresponsive_engines || []).map((e) => (Array.isArray(e) ? e.join(" : ") : String(e))).slice(0, 4);
  if (!resultats.length && muets.length) throw new ErreurRecherche(`SearXNG n'a rien rendu : ses moteurs ne répondent pas (${muets.join(", ")}).`);
  return { resultats, pointDEntree: "searxng" };
}

// La recherche elle-même : { backend, pointDEntree, resultats: [{ titre, url, extrait, date? }] }.
// Toute panne devient une ErreurRecherche au message clair, que le modèle relit.
export async function chercherWeb({ requete, nombre } = {}) {
  const q = String(requete || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!q) throw new ErreurRecherche("Requête vide : écris les mots à chercher (« seuil micro-entreprise 2026 urssaf »).");
  const n = entier(nombre, 6, 1, 10);
  const backend = backendRecherche();
  let r;
  if (backend === "duckduckgo") r = await duckduckgo(q);
  else if (backend === "searxng") r = await searxng(q);
  else if (backend === "off") throw new ErreurRecherche("La recherche web locale est coupée sur la tour (REMY_RECHERCHE=off).");
  else throw new ErreurRecherche(`Moteur de recherche inconnu (REMY_RECHERCHE=${backend.slice(0, 40)}) : duckduckgo, searxng ou off.`);
  return { backend, pointDEntree: r.pointDEntree, resultats: r.resultats.slice(0, n) };
}

// --- Lire une page ------------------------------------------------------------------
function decoderCorps(corps, type) {
  let jeu = type.match(/charset=["']?([\w-]+)/i)?.[1];
  if (!jeu) jeu = corps.subarray(0, 4096).toString("latin1").match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  try {
    return new TextDecoder(jeu || "utf-8").decode(corps);
  } catch {
    return new TextDecoder("utf-8").decode(corps);
  }
}

const BLOCS = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|main|header|footer|blockquote|pre|hr|dd|dt|dl|figure|figcaption|caption|summary|details)\b[^<>]*>/gi;
// Une ligne de gabarit JavaScript (« ${prix} € », « {{ temperature }} ») : du
// bruit pour le modèle — la page a besoin de JavaScript (browse_page).
const GABARIT = /\$\{|\{\{/;

// Le texte principal d'une page : { texte, gabarits, lignes } — sans scripts,
// styles, menus ni pied de page ; <main> (ou <article>) quand il existe et
// porte vraiment le contenu. `gabarits` : lignes de gabarit écartées.
function extraire(html) {
  const h = blocs(sansCommentaires(String(html || "").slice(0, MAX_HTML_ANALYSE)), "script|style|noscript|svg|template|iframe|object|canvas|select|button|head");
  const plat = (x) => {
    const lignes = decoderEntites(
      // Une ligne de tableau reste UNE ligne (« Prestations de services | 83 600 € | 77 700 € ») :
      // un seuil sans son libellé ne veut rien dire. Le séparateur se pose à
      // l'OUVERTURE de chaque cellule : un <th> non fermé (HTML valide) sépare aussi.
      blocs(blocs(x, "nav|footer|aside", { couper: false }), "tr", {
        couper: false,
        rendu: (l) => `\n${l.replace(/<t[dh]\b[^<>]*>/gi, " | ").replace(/<\/t[dh]\s*>/gi, " ").replace(BLOCS, " ")}\n`,
      })
        .replace(/<li\b[^<>]*>/gi, "\n- ")
        .replace(/<\/?t[dh]\b[^<>]*>/gi, " ")
        .replace(BLOCS, "\n")
        .replace(EN_LIGNE, "")
        .replace(BALISE, " "),
    )
      .replace(/[^\S\n]+/g, " ")
      .split("\n")
      .map((l) =>
        l
          .replace(/\s*\|(?:\s*\|)*\s*/g, " | ")
          .replace(/^\s*\|\s*/, "")
          .replace(/\s*\|\s*$/, "")
          .trim(),
      );
    let gabarits = 0;
    const gardees = lignes.filter((l, i, t) => {
      if (!l || l === "-" || (l === t[i - 1] && l.length < 80)) return false;
      if (GABARIT.test(l)) {
        gabarits++;
        return false;
      }
      return true;
    });
    return { texte: gardees.join("\n"), gabarits, lignes: gardees.length };
  };
  for (const balise of ["main", "article"]) {
    const debut = h.search(new RegExp(`<${balise}\\b`, "i"));
    const fin = derniere(h, new RegExp(`<\\/${balise}\\s*>`, "gi"));
    if (debut !== -1 && fin > debut) {
      const t = plat(h.slice(debut, fin));
      if (t.texte.length >= 300) return t;
    }
  }
  const ouvreCorps = /<body\b[^<>]*>/i.exec(h);
  const debutCorps = ouvreCorps ? ouvreCorps.index + ouvreCorps[0].length : 0;
  const finCorps = derniere(h, /<\/body\s*>/gi);
  return plat(h.slice(debutCorps, finCorps > debutCorps ? finCorps : h.length));
}
export const extraireTexte = (html) => extraire(html).texte;

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const enFrancais = (a, m, j) => (m >= 1 && m <= 12 && j >= 1 && j <= 31 ? `${j === 1 ? "1er" : j} ${MOIS[m - 1]} ${a}` : null);
const isoEnFrancais = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? enFrancais(m[1], Number(m[2]), Number(m[3])) : null;
};

function metas(html) {
  const out = {};
  for (const [tag] of String(html).slice(0, MAX_HTML_ANALYSE).matchAll(/<meta\b[^<>]*>/gi)) {
    const attr = (n) => tag.match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
    const cle = (attr("property") || attr("name") || attr("itemprop") || "").toLowerCase();
    const val = attr("content");
    if (cle && val && !(cle in out)) out[cle] = val;
  }
  return out;
}

const MOIS_RE = "janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre";
const DATE_TEXTE = new RegExp(
  `\\b(mis(?:e)? à jour|actualisée?|modifiée?|vérifiée?|publiée?)\\s*(?:le\\s*|:\\s*(?:le\\s*)?)?(?:(\\d{1,2})(?:er)?\\s+(${MOIS_RE})\\s+(\\d{4})|(\\d{1,2})[/.](\\d{1,2})[/.](\\d{4}))`,
  "i",
);
const sansAccent = (t) => String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const NATURE = (mot) =>
  /^mis/i.test(mot) ? "mise à jour" : /^actualis/i.test(mot) ? "actualisée" : /^modifi/i.test(mot) ? "modifiée" : /^vérifi/i.test(mot) ? "vérifiée" : "publiée";

function dateDansTexte(texte, publication) {
  const re = new RegExp(DATE_TEXTE.source, "gi");
  for (const m of String(texte || "").matchAll(re)) {
    if (/^publi/i.test(m[1]) !== publication) continue;
    const jour = m[2]
      ? enFrancais(m[4], MOIS.findIndex((x) => sansAccent(x) === sansAccent(m[3])) + 1, Number(m[2]))
      : enFrancais(m[7], Number(m[6]), Number(m[5]));
    if (jour) return `${NATURE(m[1])} le ${jour}`;
  }
  return null;
}

// La date d'une page, quand elle se lit : métadonnées de mise à jour, puis
// « mis à jour le / vérifié le … » dans le texte, puis la date de publication.
// Dans le texte, seulement en tête et en pied : une page d'accueil ou de liste
// porte au milieu les dates de ses cartes d'articles (« actualisé le 7 octobre »
// d'une carte n'est pas la date de la page — relecture du 25/10).
const TETE_DATE = 1500;
const PIED_DATE = 600;
export function dateDePage(html, texte = "") {
  const h = String(html || "").slice(0, MAX_HTML_ANALYSE);
  const t = String(texte || "");
  const zone = t.length > TETE_DATE + PIED_DATE ? `${t.slice(0, TETE_DATE)}\n${t.slice(-PIED_DATE)}` : t;
  const m = metas(h);
  const json = (cle) => h.match(new RegExp(`"${cle}"\\s*:\\s*"(\\d{4}-\\d{2}-\\d{2}[^"]*)"`))?.[1];
  const modif = ["article:modified_time", "og:updated_time", "dcterms.modified", "dc.date.modified", "last-modified", "datemodified"].map((k) => m[k]).find(Boolean) || json("dateModified");
  if (isoEnFrancais(modif)) return `mise à jour le ${isoEnFrancais(modif)}`;
  const texteDate = dateDansTexte(zone, false);
  if (texteDate) return texteDate;
  const publie = ["article:published_time", "dcterms.created", "dc.date", "date", "datepublished"].map((k) => m[k]).find(Boolean) || json("datePublished");
  if (isoEnFrancais(publie)) return `publiée le ${isoEnFrancais(publie)}`;
  return dateDansTexte(zone, true);
}

// Le titre (<title>, sinon og:title), sans relire la page à chaque « <title ».
function titreDe(html) {
  const ouvre = /<title\b[^<>]*>/i.exec(html);
  if (ouvre) {
    const debut = ouvre.index + ouvre[0].length;
    const ferme = /<\/title\s*>/gi;
    ferme.lastIndex = debut;
    const f = ferme.exec(html);
    if (f) return texteBrut(html.slice(debut, Math.min(f.index, debut + 2000))).slice(0, 200);
  }
  return texteBrut(metas(html)["og:title"] || "").slice(0, 200);
}

// Une page refusée par une protection anti-robot (Cloudflare, DataDome…) :
// lire_page n'y peut rien, un vrai navigateur parfois.
function protection(h = {}) {
  if (h["x-datadome"] || /datadome/i.test(String(h["set-cookie"] || ""))) return "DataDome";
  if (h["cf-ray"] || h["cf-mitigated"] || /cloudflare/i.test(String(h.server || ""))) return "Cloudflare";
  if (/akamai/i.test(String(h.server || ""))) return "Akamai";
  return null;
}

// --- D'où vient une adresse ------------------------------------------------------
// « urssaf.fr/… » sans schéma : le modèle l'écrit parfois ainsi.
export function urlComplete(url) {
  const brut = String(url || "").trim();
  return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(brut) ? `https://${brut}` : brut;
}

// La forme comparable d'une adresse : hôte sans « www. », chemin sans « / »
// final, requête — ni schéma ni fragment. null si ce n'est pas du http(s).
export function cleUrl(url) {
  try {
    const u = new URL(urlComplete(url));
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.hostname.replace(/^www\./, "")}${u.port ? `:${u.port}` : ""}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return null;
  }
}

// Les adresses http(s) écrites dans un texte (les messages de Sam).
export const urlsDuTexte = (t) =>
  [...String(t || "").matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)].map((m) => m[0].replace(/[.,;:!?»]+$/, ""));

// Sites publics qu'on peut ouvrir sans les avoir cherchés — en https, SANS
// « ? » ni port : une adresse fabriquée n'y emporte rien chez un tiers.
const OFFICIELS = /(^|\.)(gouv\.fr|service-public\.fr|urssaf\.fr|ameli\.fr|caf\.fr|msa\.fr|francetravail\.fr|lassuranceretraite\.fr|info-retraite\.fr|insee\.fr)$/i;

// Une page peut-elle s'ouvrir ? Oui si son adresse est CONNUE (`connues` : les
// cleUrl des résultats de chercher_web de ce tour et des messages de Sam), ou
// sur un site officiel sans requête. Sinon c'est le modèle qui l'a écrite — et
// un extrait piégé peut lui faire écrire https://ailleurs/?d=<la mémoire de Sam>.
export function urlPermise(url, connues) {
  const cle = cleUrl(url);
  if (!cle) return false;
  if (connues?.has(cle)) return true;
  try {
    const u = new URL(urlComplete(url));
    return u.protocol === "https:" && !u.search && !u.port && !u.username && !u.password && OFFICIELS.test(u.hostname);
  } catch {
    return false;
  }
}

// Lecture rapide d'une page (sans JavaScript) : { url_finale, titre, date, texte, squelettique }.
// `squelettique` : presque rien sans JavaScript (moins de 300 caractères utiles,
// ou plus d'une ligne sur cinq en gabarit « ${…} ») — browse_page la verra mieux.
// `telecharger` : remplaçable dans les tests ; par défaut, celui du navigateur,
// qui vérifie chaque adresse (et chaque redirection) avant de s'y connecter.
// `signal` : un arrêt de plus (la recherche directe coupe les lectures trop
// longues, lib/recherche-rapide.js).
export async function lirePage({ url } = {}, { telecharger = telechargerSur, signal = null } = {}) {
  const brut = urlComplete(url);
  if (!/^https?:\/\//i.test(brut)) throw new Error("URL http(s) complète attendue");
  let r;
  try {
    // Plafond APRÈS décompression aussi serré qu'avant : 3 Mo, pas 12.
    const delai = AbortSignal.timeout(delaiLecture());
    r = await telecharger(brut, { headers: ENTETES_NAVIGATEUR, signal: signal ? AbortSignal.any([signal, delai]) : delai, maxOctets: MAX_OCTETS_PAGE, maxDecompresse: MAX_OCTETS_PAGE });
  } catch (err) {
    throw new Error(err.name === "TimeoutError" || err.name === "AbortError" ? "délai dépassé" : err.message);
  }
  if (r.status >= 400) {
    const p = [401, 403, 429, 503].includes(r.status) ? protection(r.headers) : null;
    if (p) {
      const e = new Error(`page protégée anti-robot (${p}, réponse ${r.status})`);
      e.protegee = true;
      throw e;
    }
    throw new Error(`la page répond ${r.status}`);
  }
  const type = String(r.headers["content-type"] || "").toLowerCase();
  if (/pdf/.test(type)) throw new Error("c'est un PDF, que lire_page ne lit pas");
  if (type && !/html|xml|text\/plain/.test(type)) throw new Error(`contenu non textuel (${type.split(";")[0]})`);
  const html = decoderCorps(r.corps, type).slice(0, MAX_HTML_ANALYSE);
  const brutTexte = /text\/plain/.test(type);
  const ex = brutTexte ? { texte: html.trim(), gabarits: 0, lignes: 1 } : extraire(html);
  const texte = ex.texte;
  return {
    url_finale: r.urlFinale || brut,
    titre: brutTexte ? "" : titreDe(html),
    date: dateDePage(brutTexte ? "" : html, texte),
    texte: texte.length > MAX_TEXTE ? texte.slice(0, MAX_TEXTE) + "\n[… texte tronqué]" : texte,
    squelettique: texte.length < 300 || ex.gabarits > 0.2 * (ex.lignes + ex.gabarits),
  };
}

// --- La consigne du modèle local ----------------------------------------------------
// `qui` : d'où viennent les adresses permises — Sam, ou « la question » pour la
// salle blanche (lib/salle-blanche.js), qui ne sait même pas son prénom.
export const consigneRecherche = ({ qui = PRENOM } = {}) =>
  `# Chercher sur le web\n\n` +
  `Ici, la recherche s'appelle chercher_web (un moteur de recherche) et la lecture lire_page (lit vite une page, sans JavaScript) ; browse_page, quand tu l'as, reste pour une page qui a besoin de JavaScript ou de clics.\n` +
  `- Cherche SANS demander la permission dès que l'information est récente, chiffrée, réglementaire, locale ou incertaine : un montant, un seuil, un taux, une aide, une date limite, un horaire, une actualité. Dans le doute, cherche.\n` +
  `- Règles et montants (impôts, cotisations, aides, droit du travail, santé) : sources officielles d'abord — service-public.gouv.fr, urssaf.fr, impots.gouv.fr, legifrance.gouv.fr, economie.gouv.fr, ameli.fr, caf.fr. Mets le nom du site dans ta requête au besoin (« seuil micro-entreprise 2026 urssaf »).\n` +
  `- Un extrait de résultat ne suffit pas pour un chiffre : lis la page avec lire_page avant de l'avancer.\n` +
  `- N'ouvre que des adresses trouvées par chercher_web ou données par ${qui} (ou la page d'un site officiel, sans « ? ») : n'en fabrique jamais, les autres sont refusées.\n` +
  `- Chaque chiffre que tu donnes vient d'une page lue dans CETTE réponse. Ce que tu crois savoir peut être périmé : ne le présente jamais comme à jour.\n` +
  `- Cite tes sources à la fin : nom du site, lien, et date de la page (« date non indiquée » si elle n'en a pas).\n` +
  `- Pas trouvé ? Dis-le franchement (« je n'ai pas trouvé de source officielle pour… ») plutôt que d'inventer.\n` +
  `- Budget : ${rechercheMax()} recherches et ${lectureMax()} pages par message. Une ou deux requêtes bien formulées, puis les pages les plus fiables.`;

// --- Fiabilité vérifiable sans IA ----------------------------------------------------
// Après la réponse : les montants (€, %) et années qu'elle avance, mais
// qu'aucune PAGE lue pendant ce tour ne contient, sont signalés — à part ceux
// vus seulement dans un extrait de résultat (page jamais lue). Prudent :
// formats français (1 000 €, 1 000,50 €, 12,5 %), et rien de ce que Sam a
// déjà écrit (ses messages, sa mémoire). Limite : la vérification dit « ce
// nombre a été vu sur une page lue », pas « c'est la bonne ligne du tableau ».
const NOMBRE = String.raw`\d{1,3}(?:[ \u00a0\u202f.]\d{3})+(?:,\d+)?|\d+(?:[,.]\d+)?`;

// « 1 000,50 » → « 1000.5 » ; « 1.000 » → « 1000 » ; null si illisible.
export function valeurNombre(brut) {
  let s = String(brut).replace(/[ \u00a0\u202f]/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? String(n) : null;
}

// Toutes les valeurs numériques d'un texte lu, généreusement (montants et
// années) : « 77 700 » vaut 77700 mais aussi 77 et 700 (une liste de nombres
// n'est pas un millier), et « 1,000 » (anglais) vaut aussi 1000.
function valeursLues(texte) {
  const out = new Set();
  for (const [brut] of String(texte || "").matchAll(new RegExp(NOMBRE, "g"))) {
    const v = valeurNombre(brut);
    if (v) out.add(v);
    for (const morceau of brut.split(/[ \u00a0\u202f]/)) {
      const w = valeurNombre(morceau);
      if (w) out.add(w);
    }
    if (/^\d{1,3}(,\d{3})+$/.test(brut)) out.add(String(Number(brut.replace(/,/g, ""))));
  }
  return out;
}

// Jamais au milieu d'un nombre : dans « en 2025 300 € », le montant est 300 €.
const AVANT = String.raw`(?<!\d|\d[,.])`;
const MONTANT = new RegExp(String.raw`${AVANT}(${NOMBRE})\s?(k\s?€|M€|millions? d'euros|milliards? d'euros|€|euros?\b|EUR\b)`, "gi");
const POURCENT = new RegExp(String.raw`${AVANT}(${NOMBRE})\s?(%|pour ?cent\b)`, "gi");
const ANNEE = /(?<!\d|\d[,.])(?:19|20)\d{2}(?!\d|[,.]\d)/g;

// Les pourcentages d'un texte lu, AVEC leur unité : un « 50 % » de la réponse
// doit retrouver « 50 % » (ou « 50 pour cent »), pas un 50 quelconque (« plus de
// 50 salariés », le 26 d'une date, le 83 de « 83 600 €»).
function pourcentsLus(texte) {
  const out = new Set();
  for (const m of String(texte || "").matchAll(new RegExp(POURCENT.source, "gi"))) {
    const v = valeurNombre(m[1]);
    if (v) out.add(v);
  }
  return out;
}

// Les chiffres que la réponse avance : [{ brut, valeurs, pourcent }].
function affirmations(texte) {
  // Les liens ne sont pas des chiffres (« …/2026/… » dans une adresse citée).
  let t = String(texte || "").replace(/\]\([^()\s]*\)/g, "]").replace(/https?:\/\/\S+/g, " ");
  const out = [];
  const prendre = (re, valeurs, pourcent = false) => {
    t = t.replace(re, (m, nombre, unite) => {
      const v = valeurNombre(nombre);
      if (v) out.push({ brut: m.replace(/[\s\u00a0\u202f]+/g, " ").trim(), valeurs: valeurs(v, unite || ""), pourcent });
      return " ".repeat(m.length);
    });
  };
  prendre(MONTANT, (v, u) => {
    const n = Number(v);
    if (/^k/i.test(u)) return [v, String(n * 1000)];
    if (/^M€|^million/i.test(u)) return [v, String(n * 1e6)];
    if (/^milliard/i.test(u)) return [v, String(n * 1e9)];
    return [v];
  });
  prendre(POURCENT, (v) => [v], true);
  for (const [annee] of t.matchAll(ANNEE)) out.push({ brut: annee, valeurs: [annee], pourcent: false });
  return out;
}

// Ce qui reste à vérifier : { absents, extraitsSeuls } — les formes écrites
// dans la réponse, sans doublon. `web` : ce que le tour a lu ({ pages,
// extraits, tentatives }) ; sans aucune tentative ni lecture, rien n'est
// signalé (une réponse qui n'a pas cherché n'est pas contrôlée). Une recherche
// ratée, elle, laisse tous les chiffres « de mémoire » : ils sont signalés.
// `question` : ce que Sam a écrit (messages, mémoire) — jamais signalé.
export function chiffresAVerifier(reponse, web = {}, question = "") {
  const pages = (web.pages || []).join("\n");
  const extraits = (web.extraits || []).join("\n");
  const out = { absents: [], extraitsSeuls: [] };
  if (!pages && !extraits && !web.tentatives) return out;
  const dans = (t) => ({ valeurs: valeursLues(t), pourcents: pourcentsLus(t) });
  const lu = dans(pages);
  const vuEnExtrait = dans(extraits);
  const dejaDits = valeursLues(question);
  const trouve = (a, src) => a.valeurs.some((v) => (a.pourcent ? src.pourcents : src.valeurs).has(v));
  const vus = new Set();
  for (const a of affirmations(reponse)) {
    if (vus.has(a.brut) || a.valeurs.some((v) => dejaDits.has(v)) || trouve(a, lu)) continue;
    vus.add(a.brut);
    (trouve(a, vuEnExtrait) ? out.extraitsSeuls : out.absents).push(a.brut);
  }
  return out;
}

// Le bilan chiffré d'une réponse (banc de la recherche, scripts/banc-recherche.mjs) :
// { avances, verifies, aVerifier, extraitsSeuls } — les chiffres qu'elle avance
// (sans doublon, hors ce que Sam a écrit), ceux retrouvés dans une page lue,
// ceux absents, ceux vus seulement dans un extrait de résultat.
export function bilanChiffres(reponse, web = {}, question = "") {
  const dejaDits = valeursLues(question);
  const avances = [...new Set(affirmations(reponse).filter((a) => !a.valeurs.some((v) => dejaDits.has(v))).map((a) => a.brut))];
  const { absents, extraitsSeuls } = chiffresAVerifier(reponse, { ...web, tentatives: web.tentatives || 1 }, question);
  return { avances: avances.length, verifies: Math.max(0, avances.length - absents.length - extraitsSeuls.length), aVerifier: absents.length, extraitsSeuls: extraitsSeuls.length };
}

// Les durées et les dates d'une synthèse (« 5 ans », « 2 mois », « 31 octobre ») :
// pour les passages seulement — la vérification des chiffres, elle, reste sur
// les montants, pourcentages et années. [{ brut, re }] : `re` retrouve la même
// durée ou date dans une ligne sans accents.
const DUREE = /(?<![\d,.])(\d+(?:[,.]\d+)?)\s?(ans?|ann[ée]es?|mois|semaines?|jours?|heures?|h|minutes?|min)(?![\p{L}])/giu;
const UNITES = [
  [/^(?:ans?|ann[ée]es?)$/i, "(?:ans?|annees?)"],
  [/^mois$/i, "mois"],
  [/^semaines?$/i, "semaines?"],
  [/^jours?$/i, "jours?"],
  [/^(?:heures?|h)$/i, "(?:heures?|h)"],
  [/^(?:minutes?|min)$/i, "(?:minutes?|min)"],
];
const JOUR_MOIS = new RegExp(String.raw`(?<!\d)(1er|\d{1,2})\s+(${MOIS_RE})(?![\p{L}])`, "giu");
function reperes(texte) {
  const t = String(texte || "").replace(/\]\([^()\s]*\)/g, "]").replace(/https?:\/\/\S+/g, " ");
  const out = [];
  for (const m of t.matchAll(DUREE)) {
    const unite = UNITES.find(([re]) => re.test(m[2]))?.[1];
    if (unite) out.push({ brut: m[0].trim(), re: new RegExp(String.raw`(?<![\d,.])${m[1].replace(/[.,]/, "[.,]")}\s?${unite}(?![a-z])`, "i") });
  }
  for (const m of t.matchAll(JOUR_MOIS)) {
    const n = m[1].toLowerCase() === "1er" ? 1 : Number(m[1]);
    if (!(n >= 1 && n <= 31)) continue;
    const jour = n === 1 ? "(?:0?1|1er)" : `0?${n}`;
    out.push({ brut: m[0].trim(), re: new RegExp(String.raw`(?<!\d)${jour}\s+${sansAccent(m[2]).replace(/[^a-z]/g, "")}(?![a-z])`, "i") });
  }
  return out;
}

// Un passage de 240 caractères au plus, centré sur ce qu'il doit montrer.
function fenetre(ligne, index, taille = 240) {
  const l = ligne.trim().replace(/^[-–•]\s*/, "");
  const decale = ligne.indexOf(l);
  if (l.length <= taille) return l;
  const i = Math.max(0, Math.min(l.length - taille, Math.max(0, index - decale) - Math.floor(taille / 3)));
  return `${i > 0 ? "…" : ""}${l.slice(i, i + taille).trim()}${i + taille < l.length ? "…" : ""}`;
}
// Où, dans une ligne, se trouve un nombre qui porte l'une de ces valeurs.
function positionNombre(ligne, a) {
  for (const m of ligne.matchAll(new RegExp(NOMBRE, "g"))) {
    const vals = [valeurNombre(m[0]), ...m[0].split(/[ \u00a0\u202f]/).map(valeurNombre)];
    if (a.valeurs.some((v) => vals.includes(v))) return m.index;
  }
  return 0;
}

// Les passages qui portent les chiffres d'une synthèse (salle blanche) : pour
// chaque montant, pourcentage, durée ou date avancé, la première ligne d'une
// page lue qui le contient (240 caractères au plus, centrés sur lui) —
// [{ chiffre, passage, url, date }]. Sans IA : le modèle principal relit ce que
// les pages disent vraiment, pas seulement ce qu'on lui en dit. `detail` :
// { passages, avances } — `avances` : combien de chiffres la synthèse avance.
export function passagesCites(synthese, pages = [], options = {}) {
  const { max = 6, detail = false } = typeof options === "number" ? { max: options } : options;
  const out = [];
  const vus = new Set();
  let avances = 0;
  const chercher = (brut, trouve) => {
    if (vus.has(brut)) return;
    vus.add(brut);
    avances++;
    if (out.length >= max) return;
    for (const p of pages) {
      for (const ligne of String(p.texte || "").split("\n")) {
        const index = trouve(ligne);
        if (index >= 0) {
          out.push({ chiffre: brut, passage: fenetre(ligne, index), url: p.url, date: p.date || null });
          return;
        }
      }
    }
  };
  for (const a of affirmations(synthese)) {
    if (/^\d{4}$/.test(a.brut)) continue; // une année seule : partout
    chercher(a.brut, (l) => {
      const src = a.pourcent ? pourcentsLus(l) : valeursLues(l);
      return a.valeurs.some((v) => src.has(v)) ? positionNombre(l, a) : -1;
    });
  }
  for (const r of reperes(synthese)) {
    chercher(r.brut, (l) => {
      const m = sansAccent(l).match(r.re);
      return m ? m.index : -1;
    });
  }
  return detail ? { passages: out, avances } : out;
}

// La ligne discrète sous la réponse. `pagesLues` : combien de pages ce tour a
// lues ; `rienAbouti` : tout ce qui a été tenté a échoué (moteur bloqué…).
export function ligneAVerifier({ absents = [], extraitsSeuls = [] } = {}, { pagesLues = 0, rienAbouti = false } = {}) {
  const liste = (l) => `${l.slice(0, 6).join(", ")}${l.length > 6 ? "…" : ""}`;
  const parts = [];
  if (absents.length) {
    const pourquoi = pagesLues ? "absent des pages lues" : rienAbouti ? "recherche impossible, chiffres de mémoire" : "aucune page lue, chiffres de mémoire";
    parts.push(`À vérifier (${pourquoi}) : ${liste(absents)}`);
  }
  if (extraitsSeuls.length) parts.push(`Vu seulement dans un extrait de recherche, page non lue : ${liste(extraitsSeuls)}`);
  return parts.length ? `_${parts.join(". ")}._` : "";
}
