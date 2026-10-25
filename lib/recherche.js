// La recherche web du modèle local (25/10) : Rémy cherche et lit lui-même,
// depuis la tour, sans passer par Claude ni demander à chaque fois. Même
// principe qu'Hermes Agent (Nous Research) : un outil de recherche et un outil
// de lecture dans la boucle d'outils du modèle, qui décide seul de s'en servir.
//
//   REMY_RECHERCHE         duckduckgo (défaut : sans clé ni installation) | searxng | off
//   REMY_SEARXNG_URL       l'instance SearXNG (ex. http://<spark>:8888), son API JSON
//   REMY_RECHERCHE_MAX     recherches par message (défaut 4)
//   REMY_LECTURE_MAX       pages lues (lire_page) par message (défaut 6)
//   REMY_RECHERCHE_DELAI_MS / REMY_LECTURE_DELAI_MS   délais (8 s / 15 s)
//
// Ce qui part : la requête écrite par le modèle, vers le moteur choisi ; puis
// les pages qu'il ouvre. Jamais en conversation privée (lib/providers.js,
// outilsClient) : une page piégée pourrait lui faire chercher « <ce que Sam
// vient de confier> ». Les pages lues passent par la même garde anti-SSRF que
// le navigateur (lib/browse.js) : jamais la tour, les Sparks ni le tailnet.

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
// Les balises de mise en forme collent au texte (« l'<b>Acre</b> ») ; les autres séparent.
const EN_LIGNE = /<\/?(?:a|abbr|b|strong|em|i|u|s|span|mark|small|sup|sub|code|time|q|cite|dfn|ins|del)\b[^>]*>/gi;
const texteBrut = (html) =>
  decoderEntites(String(html ?? "").replace(EN_LIGNE, "").replace(/<[^>]*>/g, " "))
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .trim();

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
  const h = String(html || "");
  if (VERIFICATION.test(h)) throw new ErreurRecherche("vérification anti-robot");
  const liens = [...h.matchAll(/<a\b([^>]*\bclass\s*=\s*["'][^"']*\b(?:result__a|result-link)\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)];
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

async function duckduckgo(requete) {
  if (Date.now() < bloqueJusqua) throw new ErreurRecherche(BLOQUE);
  const echecs = [];
  let bloques = 0;
  const points = pointsDuckDuckGo();
  for (const p of points) {
    try {
      const r = await fetch(p.url, {
        method: "POST",
        headers: { ...ENTETES_NAVIGATEUR, "Content-Type": "application/x-www-form-urlencoded", Referer: new URL(p.url).origin + "/" },
        body: new URLSearchParams({ q: requete, kl: "fr-fr" }).toString(),
        signal: AbortSignal.timeout(delaiRecherche()),
      });
      const html = await r.text();
      if (r.status === 202 || VERIFICATION.test(html)) {
        bloques++;
        echecs.push(`${p.nom} : vérification anti-robot`);
        continue;
      }
      if (!r.ok) {
        echecs.push(`${p.nom} : réponse ${r.status}`);
        continue;
      }
      return { resultats: analyserDuckDuckGo(html), pointDEntree: p.nom };
    } catch (err) {
      echecs.push(`${p.nom} : ${err.name === "TimeoutError" ? "délai dépassé" : err.message}`);
    }
  }
  if (bloques === points.length) {
    bloqueJusqua = Date.now() + 5 * 60_000;
    throw new ErreurRecherche(BLOQUE);
  }
  throw new ErreurRecherche(`Recherche impossible (DuckDuckGo) : ${echecs.join(" ; ")}. Dis-le à ${PRENOM} plutôt que de répondre de mémoire.`);
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

const BLOCS = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|main|header|footer|blockquote|pre|hr|dd|dt|dl|figure|figcaption|caption|summary|details)\b[^>]*>/gi;

// Le texte principal d'une page : sans scripts, styles, menus ni pied de page ;
// <main> (ou <article>) quand il existe et porte vraiment le contenu.
export function extraireTexte(html) {
  let h = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|object|canvas|select|button|head)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const plat = (x) =>
    decoderEntites(
      x
        .replace(/<(nav|footer|aside)\b[\s\S]*?<\/\1\s*>/gi, " ")
        // Une ligne de tableau reste UNE ligne (« Prestations de services | 83 600 € | 77 700 € ») :
        // un seuil sans son libellé ne veut rien dire.
        .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi, (m, l) => `\n${l.replace(/<\/t[dh]\s*>/gi, " | ").replace(BLOCS, " ")}\n`)
        .replace(/<li\b[^>]*>/gi, "\n- ")
        .replace(/<\/?t[dh]\b[^>]*>/gi, " ")
        .replace(BLOCS, "\n")
        .replace(EN_LIGNE, "")
        .replace(/<[^>]*>/g, " "),
    )
      .replace(/[ \t\u00a0\u202f\u2009]+/g, " ")
      .split("\n")
      .map((l) => l.trim().replace(/^(?:\|\s*)+|(?:\s*\|)+$/g, "").replace(/\s*\|\s*(?:\|\s*)+/g, " | ").trim())
      .filter((l, i, t) => l && !(l === "-" || (l === t[i - 1] && l.length < 80)))
      .join("\n");
  for (const balise of ["main", "article"]) {
    const debut = h.search(new RegExp(`<${balise}\\b`, "i"));
    const fin = h.toLowerCase().lastIndexOf(`</${balise}>`);
    if (debut !== -1 && fin > debut) {
      const t = plat(h.slice(debut, fin));
      if (t.length >= 300) return t;
    }
  }
  const corps = h.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? h;
  return plat(corps);
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const enFrancais = (a, m, j) => (m >= 1 && m <= 12 && j >= 1 && j <= 31 ? `${j === 1 ? "1er" : j} ${MOIS[m - 1]} ${a}` : null);
const isoEnFrancais = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? enFrancais(m[1], Number(m[2]), Number(m[3])) : null;
};

function metas(html) {
  const out = {};
  for (const [tag] of String(html).matchAll(/<meta\b[^>]*>/gi)) {
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
export function dateDePage(html, texte = "") {
  const m = metas(html);
  const json = (cle) => String(html).match(new RegExp(`"${cle}"\\s*:\\s*"(\\d{4}-\\d{2}-\\d{2}[^"]*)"`))?.[1];
  const modif = ["article:modified_time", "og:updated_time", "dcterms.modified", "dc.date.modified", "last-modified", "datemodified"].map((k) => m[k]).find(Boolean) || json("dateModified");
  if (isoEnFrancais(modif)) return `mise à jour le ${isoEnFrancais(modif)}`;
  const texteDate = dateDansTexte(texte, false);
  if (texteDate) return texteDate;
  const publie = ["article:published_time", "dcterms.created", "dc.date", "date", "datepublished"].map((k) => m[k]).find(Boolean) || json("datePublished");
  if (isoEnFrancais(publie)) return `publiée le ${isoEnFrancais(publie)}`;
  return dateDansTexte(texte, true);
}

// Lecture rapide d'une page (sans JavaScript) : { url_finale, titre, date, texte }.
// `telecharger` : remplaçable dans les tests ; par défaut, celui du navigateur,
// qui vérifie chaque adresse (et chaque redirection) avant de s'y connecter.
export async function lirePage({ url } = {}, { telecharger = telechargerSur } = {}) {
  let brut = String(url || "").trim();
  // « urssaf.fr/… » sans schéma : le modèle l'écrit parfois ainsi.
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(brut)) brut = `https://${brut}`;
  if (!/^https?:\/\//i.test(brut)) throw new Error("URL http(s) complète attendue");
  let r;
  try {
    r = await telecharger(brut, { headers: ENTETES_NAVIGATEUR, signal: AbortSignal.timeout(delaiLecture()), maxOctets: MAX_OCTETS_PAGE });
  } catch (err) {
    throw new Error(err.name === "TimeoutError" || err.name === "AbortError" ? "délai dépassé" : err.message);
  }
  if (r.status >= 400) throw new Error(`la page répond ${r.status}`);
  const type = String(r.headers["content-type"] || "").toLowerCase();
  if (/pdf/.test(type)) throw new Error("c'est un PDF, que lire_page ne lit pas");
  if (type && !/html|xml|text\/plain/.test(type)) throw new Error(`contenu non textuel (${type.split(";")[0]})`);
  const html = decoderCorps(r.corps, type);
  const texte = /text\/plain/.test(type) ? html.trim() : extraireTexte(html);
  const titre = texteBrut(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || metas(html)["og:title"] || "").slice(0, 200);
  return {
    url_finale: r.urlFinale || brut,
    titre,
    date: dateDePage(html, texte),
    texte: texte.length > MAX_TEXTE ? texte.slice(0, MAX_TEXTE) + "\n[… texte tronqué]" : texte,
  };
}

// --- La consigne du modèle local ----------------------------------------------------
export const consigneRecherche = () =>
  `# Chercher sur le web\n\n` +
  `Ici, la recherche s'appelle chercher_web (un moteur de recherche) et la lecture lire_page (lit vite une page, sans JavaScript) ; browse_page, quand tu l'as, reste pour une page qui a besoin de JavaScript ou de clics.\n` +
  `- Cherche SANS demander la permission dès que l'information est récente, chiffrée, réglementaire, locale ou incertaine : un montant, un seuil, un taux, une aide, une date limite, un horaire, une actualité. Dans le doute, cherche.\n` +
  `- Règles et montants (impôts, cotisations, aides, droit du travail, santé) : sources officielles d'abord — service-public.fr, urssaf.fr, impots.gouv.fr, legifrance.gouv.fr, economie.gouv.fr, ameli.fr, caf.fr. Mets le nom du site dans ta requête au besoin (« seuil micro-entreprise 2026 urssaf »).\n` +
  `- Un extrait de résultat ne suffit pas pour un chiffre : lis la page avec lire_page avant de l'avancer.\n` +
  `- Chaque chiffre que tu donnes vient d'une page lue dans CETTE réponse. Ce que tu crois savoir peut être périmé : ne le présente jamais comme à jour.\n` +
  `- Cite tes sources à la fin : nom du site, lien, et date de la page (« date non indiquée » si elle n'en a pas).\n` +
  `- Pas trouvé ? Dis-le franchement (« je n'ai pas trouvé de source officielle pour… ») plutôt que d'inventer.\n` +
  `- Budget : ${rechercheMax()} recherches et ${lectureMax()} pages par message. Une ou deux requêtes bien formulées, puis les pages les plus fiables.`;

// --- Fiabilité vérifiable sans IA ----------------------------------------------------
// Après la réponse : les montants (€, %) et années qu'elle avance, mais qui
// n'apparaissent dans AUCUN des textes lus pendant ce tour (résultats et
// pages), sont signalés. Prudent : formats français (1 000 €, 1 000,50 €,
// 12,5 %), et rien de ce que la question contenait déjà.
const NOMBRE = String.raw`\d{1,3}(?:[ \u00a0\u202f.]\d{3})+(?:,\d+)?|\d+(?:[,.]\d+)?`;

// « 1 000,50 » → « 1000.5 » ; « 1.000 » → « 1000 » ; null si illisible.
export function valeurNombre(brut) {
  let s = String(brut).replace(/[ \u00a0\u202f]/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? String(n) : null;
}

// Toutes les valeurs numériques d'un texte lu, généreusement : « 77 700 » vaut
// 77700 mais aussi 77 et 700 (une liste de nombres n'est pas un millier), et
// « 1,000 » (anglais) vaut aussi 1000.
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

// Les chiffres que la réponse avance : [{ brut, valeurs }].
function affirmations(texte) {
  // Les liens ne sont pas des chiffres (« …/2026/… » dans une adresse citée).
  let t = String(texte || "").replace(/\]\([^)]*\)/g, "]").replace(/https?:\/\/\S+/g, " ");
  const out = [];
  const prendre = (re, valeurs) => {
    t = t.replace(re, (m, nombre, unite) => {
      const v = valeurNombre(nombre);
      if (v) out.push({ brut: m.replace(/[\s\u00a0\u202f]+/g, " ").trim(), valeurs: valeurs(v, unite || "") });
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
  prendre(POURCENT, (v) => [v]);
  for (const [annee] of t.matchAll(ANNEE)) out.push({ brut: annee, valeurs: [annee] });
  return out;
}

// Ce qui reste à vérifier : les formes écrites dans la réponse, sans doublon.
export function chiffresAVerifier(reponse, lus = [], question = "") {
  if (!lus.length) return [];
  const sources = valeursLues(lus.join("\n"));
  const dejaDits = valeursLues(question);
  const vus = new Set();
  const out = [];
  for (const a of affirmations(reponse)) {
    if (a.valeurs.some((v) => sources.has(v) || dejaDits.has(v))) continue;
    if (vus.has(a.brut)) continue;
    vus.add(a.brut);
    out.push(a.brut);
  }
  return out;
}

export const ligneAVerifier = (chiffres) =>
  chiffres.length ? `_À vérifier (absent des pages lues) : ${chiffres.slice(0, 6).join(", ")}${chiffres.length > 6 ? "…" : ""}._` : "";
