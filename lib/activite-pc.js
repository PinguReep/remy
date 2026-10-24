// L'activité du PC (piste S4, 24/10) : ce que Sam fait sur sa tour, d'après
// ActivityWatch (http://127.0.0.1:5600), qui tourne sur la même machine.
//
//   - Rémy LIT ActivityWatch, en local, toutes les 20 min (moteur de jobs) ;
//     rien ne sort de la tour.
//   - Seul le temps ACTIF compte : la fenêtre au premier plan ∩ « présent »
//     (aw-watcher-afk). Quand les guetteurs se contredisent, l'absence l'emporte.
//   - Gardé : des totaux par jour et par application, et par domaine pour le
//     navigateur. Les titres de fenêtres ne sont JAMAIS gardés ni envoyés ; une
//     adresse web se réduit à son domaine (ni chemin, ni titre, ni onglet privé).
//   - Catégories par table de correspondance (sans IA), réglable.
//   - Coupé par défaut : s'allume depuis l'app ; REMY_ACTIVITE_PC=off coupe tout.
//   - Gardé 90 jours (REMY_ACTIVITE_PC_JOURS), puis effacé ; tout s'efface d'un geste.
//   - Les relevés n'entrent que dans la consigne du modèle local, jamais chez
//     Claude (lib/chat.js) ; ce que Rémy en dit reste dans la conversation.

import fs from "node:fs";
import { cheminBase, db, transaction } from "./db.js";
import { debutJour, finJour } from "./dashboard.js";
import { exigerBacASable } from "./bac-a-sable.js";
import { PRENOM } from "./profil.js";

export const JOURS = () => Number(process.env.REMY_ACTIVITE_PC_JOURS) || 90;
export const coupeParLaTour = () => process.env.REMY_ACTIVITE_PC === "off";
export const adresseAW = () => (process.env.REMY_ACTIVITYWATCH_URL || "http://127.0.0.1:5600").replace(/\/+$/, "");
const TZ = () => process.env.REMY_TZ || "Europe/Paris";

// Les dernières minutes ne sont pas encore sûres : l'absence n'est décidée
// qu'après 3 min sans clavier ni souris, datée en arrière. Relues au relevé suivant.
export const MARGE_MS = 5 * 60_000;
// Après une coupure de la tour, au plus 7 jours sont rattrapés.
const RATTRAPAGE_MS = 7 * 86_400_000;
const DELAI_MS = 5000;
export const RELEVE_MIN = 20;

const formats = new Map();
const format = (opts) => {
  const cle = `${TZ()}|${JSON.stringify(opts)}`;
  if (!formats.has(cle)) formats.set(cle, new Intl.DateTimeFormat("fr-CA", { timeZone: TZ(), ...opts }));
  return formats.get(cle);
};
export const jourDe = (ms) => format({ year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); // AAAA-MM-JJ
const heure = (ms) => new Date(ms).toLocaleTimeString("fr-FR", { timeZone: TZ(), hour: "2-digit", minute: "2-digit" });
// « 14:05 » aujourd'hui, « le 22 oct. à 18:35 » avant.
const quand = (ms) => (jourDe(ms) === jourDe(Date.now()) ? heure(ms) : `le ${new Date(ms).toLocaleDateString("fr-FR", { timeZone: TZ(), day: "numeric", month: "short" })} à ${heure(ms)}`);

// --- Catégories -------------------------------------------------------------------------

export const CATEGORIES = {
  developpement: "Développement",
  navigateur: "Navigateur",
  communication: "Communication",
  jeux: "Jeux",
  bureautique: "Bureautique",
  multimedia: "Multimédia",
  autre: "Autre",
};

// Le nom d'exécutable, sans « .exe », en minuscules : la clé d'une application.
// « .app » reste : agenda.app est aussi un domaine, qu'on doit pouvoir exclure.
export const cleAppli = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, "")
    .slice(0, 80);

const TABLE = {
  developpement: [
    "code", "code - insiders", "cursor", "windsurf", "zed", "devenv", "idea64", "idea", "pycharm64", "pycharm", "webstorm64", "rider64",
    "clion64", "goland64", "phpstorm64", "studio64", "sublime_text", "notepad++", "windowsterminal", "wt", "powershell", "pwsh", "cmd",
    "conhost", "mintty", "git-bash", "githubdesktop", "github desktop", "docker desktop", "postman", "wsl", "wslhost", "unity",
    "unrealeditor", "godot", "nvim", "vim", "alacritty", "wezterm-gui", "warp", "dbeaver", "ssms", "putty", "winscp", "filezilla",
  ],
  navigateur: ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc", "safari", "chromium", "librewolf", "zen", "waterfox", "iexplore"],
  communication: [
    "discord", "slack", "teams", "ms-teams", "outlook", "olk", "hxoutlook", "thunderbird", "whatsapp", "telegram", "signal", "zoom",
    "skype", "mailspring", "element", "messenger",
  ],
  jeux: [
    "steam", "steamwebhelper", "epicgameslauncher", "battle.net", "riotclientservices", "leagueclient", "league of legends", "valorant",
    "cs2", "csgo", "dota2", "minecraft", "javaw", "galaxyclient", "eadesktop", "origin", "ubisoftconnect", "upc", "xboxapp", "rocketleague",
    "fortniteclient-win64-shipping", "overwatch", "gta5", "eldenring", "factorio", "rimworldwin64", "stardew valley",
  ],
  bureautique: [
    "winword", "excel", "powerpnt", "onenote", "msaccess", "mspub", "notion", "obsidian", "acrobat", "acrord32", "soffice", "soffice.bin",
    "wps", "evernote", "todoist", "logseq", "anytype", "notepad", "wordpad", "sumatrapdf", "foxitpdfreader", "calculatorapp",
  ],
  multimedia: [
    "spotify", "vlc", "mpv", "mpc-hc64", "mpc-hc", "potplayer", "potplayermini64", "obs64", "obs", "audacity", "photoshop", "illustrator",
    "adobe premiere pro", "afterfx", "resolve", "blender", "gimp", "gimp-2.10", "krita", "figma", "netflix", "music.ui", "video.ui",
    "applemusic", "itunes", "lightroom", "davinci resolve", "reaper", "ableton live 12 suite", "fl64", "photos", "paintdotnet", "mspaint",
  ],
};
const PAR_APPLI = new Map(Object.entries(TABLE).flatMap(([c, noms]) => noms.map((n) => [n, c])));
// Ce qui n'est pas une activité (écran verrouillé, ouverture de session).
const IGNOREES = new Set(["", "lockapp", "logonui", "unknown", "scrnsave", "screensaver"]);

const LIBELLES = {
  code: "VS Code", "code - insiders": "VS Code Insiders", devenv: "Visual Studio", idea64: "IntelliJ IDEA", pycharm64: "PyCharm",
  webstorm64: "WebStorm", rider64: "Rider", studio64: "Android Studio", sublime_text: "Sublime Text", windowsterminal: "Terminal",
  wt: "Terminal", pwsh: "PowerShell", powershell: "PowerShell", cmd: "Invite de commandes", msedge: "Edge", chrome: "Chrome",
  firefox: "Firefox", winword: "Word", excel: "Excel", powerpnt: "PowerPoint", onenote: "OneNote", olk: "Outlook", hxoutlook: "Outlook",
  "ms-teams": "Teams", steamwebhelper: "Steam", explorer: "Explorateur", obs64: "OBS", acrord32: "Acrobat Reader", soffice: "LibreOffice",
  "soffice.bin": "LibreOffice", applicationframehost: "Appli Windows", javaw: "Java (Minecraft ?)", resolve: "DaVinci Resolve",
};
export const libelleAppli = (cle) => LIBELLES[cle] || (cle ? cle.charAt(0).toUpperCase() + cle.slice(1) : "Inconnue");

// « jeu.exe=jeux, outil=developpement » (sur la tour) : réglé une fois pour toutes.
const categoriesTour = () =>
  Object.fromEntries(
    String(process.env.REMY_ACTIVITE_CATEGORIES || "")
      .split(",")
      .map((p) => p.split("="))
      .filter(([a, c]) => cleAppli(a) && CATEGORIES[String(c || "").trim()])
      .map(([a, c]) => [cleAppli(a), String(c).trim()]),
  );

// La catégorie d'une application : le choix de Sam, puis la tour, puis la table.
export function categorieDe(cle, choix = {}) {
  const k = cleAppli(cle);
  if (choix[k] && CATEGORIES[choix[k]]) return choix[k];
  const tour = categoriesTour();
  if (tour[k]) return tour[k];
  if (PAR_APPLI.has(k)) return PAR_APPLI.get(k);
  if (/-win(64|32)-shipping$/.test(k)) return "jeux"; // Unreal : la plupart des jeux
  return "autre";
}

// Les applications que la tour ne compte jamais (REMY_ACTIVITE_EXCLURE).
export const exclusionsTour = () => [...new Set(String(process.env.REMY_ACTIVITE_EXCLURE || "").split(",").map(cleAppli).filter(Boolean))];

// --- Intervalles [début, fin[ en ms -------------------------------------------------------

// Triés et disjoints.
export function reunir(liste) {
  const t = liste.filter((x) => x && x[1] > x[0]).map((x) => [x[0], x[1]]).sort((a, b) => a[0] - b[0]);
  const r = [];
  for (const [d, f] of t) {
    const der = r.at(-1);
    if (der && d <= der[1]) der[1] = Math.max(der[1], f);
    else r.push([d, f]);
  }
  return r;
}

// A privé de B (deux listes triées et disjointes).
export function soustraire(A, B) {
  const r = [];
  let j = 0;
  for (const [d0, f] of A) {
    let d = d0;
    while (j < B.length && B[j][1] <= d) j++;
    for (let k = j; k < B.length && B[k][0] < f && d < f; k++) {
      if (B[k][0] > d) r.push([d, B[k][0]]);
      d = Math.max(d, B[k][1]);
    }
    if (d < f) r.push([d, f]);
  }
  return r;
}

// Des segments étiquetés qui peuvent se chevaucher (un guetteur qui bégaie) :
// chaque instant n'est compté qu'une fois, pour le segment commencé le plus tard.
export function sansChevauchement(segments) {
  const t = segments.filter((s) => s && s.fin > s.debut).sort((a, b) => a.debut - b.debut);
  const points = [...new Set(t.flatMap((s) => [s.debut, s.fin]))].sort((a, b) => a - b);
  const r = [];
  let ouverts = [];
  let i = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const p = points[k];
    const q = points[k + 1];
    while (i < t.length && t[i].debut <= p) ouverts.push(t[i++]);
    ouverts = ouverts.filter((s) => s.fin > p);
    if (!ouverts.length) continue;
    const s = ouverts[ouverts.length - 1];
    const der = r.at(-1);
    if (der && der.cle === s.cle && der.fin === p) der.fin = q;
    else r.push({ cle: s.cle, debut: p, fin: q });
  }
  return r;
}

// Des segments triés et disjoints, coupés à des intervalles triés et disjoints.
function decouper(segments, intervalles) {
  const r = [];
  let j = 0;
  for (const s of segments) {
    while (j < intervalles.length && intervalles[j][1] <= s.debut) j++;
    for (let k = j; k < intervalles.length && intervalles[k][0] < s.fin; k++) {
      const d = Math.max(s.debut, intervalles[k][0]);
      const f = Math.min(s.fin, intervalles[k][1]);
      if (f > d) r.push({ cle: s.cle, debut: d, fin: f });
    }
  }
  return r;
}

// Un événement d'ActivityWatch ({ timestamp, duration en s }) coupé à [a, b[.
function intervalle(e, a, b) {
  const d = Date.parse(e?.timestamp);
  const duree = Number(e?.duration);
  if (!Number.isFinite(d) || !Number.isFinite(duree) || duree <= 0) return null;
  const debut = Math.max(a, d);
  const fin = Math.min(b, d + duree * 1000);
  return fin > debut ? [debut, fin] : null;
}

// « https://www.exemple.org/compte/123?x » → « exemple.org ». Rien d'autre.
export function domaineDe(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./, "").toLowerCase().slice(0, 120) || null;
  } catch {
    return null;
  }
}

// Le temps actif d'une tranche [a, b[, par application et, pour le navigateur,
// par domaine (en secondes). Les titres ne sortent jamais de cette fonction.
export function calculer({ fenetres = [], absences = [], web = [] }, a, b, { categorie = (c) => categorieDe(c), exclues = new Set() } = {}) {
  const present = reunir(absences.filter((e) => e?.data?.status === "not-afk").map((e) => intervalle(e, a, b)));
  const absent = reunir(absences.filter((e) => e?.data?.status === "afk").map((e) => intervalle(e, a, b)));
  const actifs = soustraire(present, absent);
  // Une application exclue garde sa place au premier plan (son temps ne passe
  // pas à la voisine), mais n'est pas comptée.
  const segments = sansChevauchement(
    fenetres.map((e) => {
      const i = intervalle(e, a, b);
      return i ? { cle: cleAppli(e?.data?.app), debut: i[0], fin: i[1] } : null;
    }),
  );
  const applis = new Map();
  const navigateur = [];
  for (const m of decouper(segments, actifs)) {
    if (IGNOREES.has(m.cle) || exclues.has(m.cle)) continue;
    applis.set(m.cle, (applis.get(m.cle) || 0) + (m.fin - m.debut) / 1000);
    if (categorie(m.cle) === "navigateur") navigateur.push([m.debut, m.fin]);
  }
  const domaines = new Map();
  if (web.length && navigateur.length) {
    const onglets = sansChevauchement(
      web.map((e) => {
        // Navigation privée, ou onglet d'un navigateur exclu (l'extension écrit
        // aussi quand il est derrière) : rien.
        if (e?.data?.incognito || exclues.has(e?.navigateur)) return null;
        const i = intervalle(e, a, b);
        const d = domaineDe(e?.data?.url);
        return i && d ? { cle: d, debut: i[0], fin: i[1] } : null;
      }),
    );
    for (const m of decouper(onglets, reunir(navigateur))) {
      if (exclues.has(m.cle)) continue;
      domaines.set(m.cle, (domaines.get(m.cle) || 0) + (m.fin - m.debut) / 1000);
    }
  }
  return { applis, domaines };
}

// --- Réglages et état (table meta) ----------------------------------------------------------

const CLE_REGLAGES = "activite_pc_reglages";
const CLE_ETAT = "activite_pc_etat";
const lireMeta = (cle, d = db()) => {
  try {
    return JSON.parse(d.prepare("SELECT valeur FROM meta WHERE cle = ?").get(cle)?.valeur || "{}") || {};
  } catch {
    return {};
  }
};
const ecrireMeta = (d, cle, v) =>
  d.prepare("INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(cle, JSON.stringify(v));

export function reglages(d = db()) {
  const r = lireMeta(CLE_REGLAGES, d);
  return {
    actif: r.actif === true,
    exclusions: Array.isArray(r.exclusions) ? r.exclusions.map(cleAppli).filter(Boolean) : [],
    categories: r.categories && typeof r.categories === "object" ? r.categories : {},
  };
}
const lireEtat = (d = db()) => lireMeta(CLE_ETAT, d);
const noterEtat = (champs) => transaction((d) => ecrireMeta(d, CLE_ETAT, { ...lireEtat(d), ...champs }));

// Ne plus compter ces applis : ce qui l'était déjà s'efface aussi. Un navigateur
// emporte tous les sites (un domaine gardé ne dit pas quel navigateur l'a vu).
function oublier(d, noms, choix) {
  const del = d.prepare("DELETE FROM activite_pc WHERE nom = ?");
  for (const n of noms) {
    del.run(n);
    if (categorieDe(n, choix) === "navigateur") d.exec("DELETE FROM activite_pc WHERE type = 'domaine'");
  }
}

// Allumée (sans créer la base pour rien : le chat lit ceci à chaque message).
export const activiteAllumee = () => !coupeParLaTour() && fs.existsSync(cheminBase()) && reglages().actif;

// --- ActivityWatch -------------------------------------------------------------------------

async function aw(chemin) {
  const url = `${adresseAW()}/api/0/${chemin}`;
  exigerBacASable(url, "ActivityWatch");
  const r = await fetch(url, { signal: AbortSignal.timeout(DELAI_MS), headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`ActivityWatch a répondu ${r.status}`);
  try {
    return await r.json();
  } catch {
    throw new Error("ActivityWatch a répondu autre chose que du JSON");
  }
}

// Les guetteurs de cette machine : fenêtre, absence, et les navigateurs.
async function trouverSeaux() {
  const [info, seaux] = await Promise.all([aw("info").catch(() => null), aw("buckets/")]);
  const liste = Object.values(seaux && typeof seaux === "object" ? seaux : {}).filter((s) => s?.id);
  const hote = info?.hostname;
  const de = (type, prefixe) => {
    const t = liste
      .filter((s) => s.type === type || String(s.id).startsWith(prefixe))
      .sort((a, b) => String(b.last_updated || "").localeCompare(String(a.last_updated || "")));
    const ici = hote ? t.filter((s) => s.hostname === hote) : [];
    return ici.length ? ici : t;
  };
  // Le dernier événement écrit (aw-server : last_updated ; aw-server-rust : metadata.end).
  const maj = (s) => Date.parse(s?.last_updated || s?.metadata?.end || "");
  const fenetre = de("currentwindow", "aw-watcher-window")[0];
  const afk = de("afkstatus", "aw-watcher-afk")[0];
  return {
    version: typeof info?.version === "string" ? info.version.slice(0, 40) : null,
    fenetre: fenetre?.id || null,
    afk: afk?.id || null,
    majFenetre: maj(fenetre),
    majAfk: maj(afk),
    web: de("web.tab.current", "aw-watcher-web").map((s) => s.id),
  };
}

// « aw-watcher-web-firefox_tour » → « firefox » (l'extension d'Edge dit « edge »).
export const navigateurDuSeau = (id) => {
  const n = String(id ?? "").match(/^aw-watcher-web-([^_]+)/)?.[1]?.toLowerCase();
  return n === "edge" ? "msedge" : n || null;
};

async function evenements(seau, debut, fin) {
  const q = new URLSearchParams({ start: new Date(debut).toISOString(), end: new Date(fin).toISOString() });
  const liste = await aw(`buckets/${encodeURIComponent(seau)}/events?${q}`);
  return Array.isArray(liste) ? liste : [];
}

// Un guetteur écrit toutes les 10 s au plus, même en absence ou écran verrouillé.
const MUET_MS = 10 * 60_000;
const PRESENT_MS = 2 * 60_000;
const MESSAGE_ABSENT = "ActivityWatch ne répond pas sur la tour : installe-le (aw-qt) et lance-le avec Windows. Rémy réessaie à chaque relevé.";

// --- Le relevé -----------------------------------------------------------------------------

let enCours = null;
// Un relevé à la fois (le job et un « relever maintenant » de l'app).
export function collecter(opts = {}) {
  if (!enCours) enCours = releve(opts).finally(() => (enCours = null));
  return enCours;
}

async function releve({ maintenant = Date.now(), budgetMs = 20_000 } = {}) {
  if (coupeParLaTour()) return { saute: "coupé sur la tour" };
  if (!reglages().actif) return { saute: "coupé" };
  // Exclue sur la tour depuis le relevé d'avant : ce qui était compté s'efface
  // aussi (même si ActivityWatch ne répond pas).
  transaction((d) => {
    const e = lireEtat(d);
    const tour = exclusionsTour();
    const deja = new Set(Array.isArray(e.exclusionsTour) ? e.exclusionsTour : []);
    if (tour.length === deja.size && tour.every((n) => deja.has(n))) return;
    oublier(d, tour.filter((n) => !deja.has(n)), reglages(d).categories);
    ecrireMeta(d, CLE_ETAT, { ...e, exclusionsTour: tour });
  });
  const avant = lireEtat();
  const essai = Date.now();
  let seaux;
  try {
    seaux = await trouverSeaux();
  } catch (err) {
    // Absent ou éteint : dit une fois, sans bruit ; le relevé suivant réessaie.
    if (avant.joignable !== false) console.warn(`Activité du PC : ActivityWatch injoignable (${err.message}) — nouvel essai au prochain relevé`);
    noterEtat({ joignable: false, message: MESSAGE_ABSENT, essai });
    return { saute: "ActivityWatch injoignable" };
  }
  // Un guetteur arrêté garde son seau : muet depuis le relevé d'avant (pas
  // seulement depuis une veille de la tour ou un redémarrage d'ActivityWatch).
  const muet = (t) => avant.joignable === true && Number.isFinite(t) && t < Number(avant.essai) - MUET_MS;
  const afkMuet = muet(seaux.majAfk);
  let fenetreMuette = muet(seaux.majFenetre);
  // Écran verrouillé, Sam absent : aw-watcher-window peut se taire sans être
  // arrêté. Il ne l'est que si Sam a été là (aw-watcher-afk) au moins 2 min depuis.
  if (fenetreMuette && seaux.afk && !afkMuet) {
    const a = Math.max(seaux.majFenetre, essai - 6 * 3_600_000);
    const depuis = await evenements(seaux.afk, a, essai).catch(() => null);
    if (depuis) {
      const present = reunir(depuis.filter((e) => e?.data?.status === "not-afk").map((e) => intervalle(e, a, essai)));
      fenetreMuette = present.reduce((t, [d, f]) => t + f - d, 0) >= PRESENT_MS;
    }
  }
  const arrete = fenetreMuette ? ["aw-watcher-window", seaux.majFenetre] : afkMuet ? ["aw-watcher-afk", seaux.majAfk] : null;
  const guetteurs = {
    joignable: true,
    version: seaux.version,
    fenetre: Boolean(seaux.fenetre) && !fenetreMuette,
    afk: Boolean(seaux.afk) && !afkMuet,
    web: seaux.web.length > 0,
    essai,
    message: arrete ? `${arrete[0]} n'écrit plus depuis ${quand(arrete[1])} : rien n'est compté. Relance aw-qt sur la tour.` : null,
  };
  if (!seaux.fenetre || !seaux.afk) {
    const manque = !seaux.fenetre ? "aw-watcher-window" : "aw-watcher-afk";
    noterEtat({ ...guetteurs, message: `ActivityWatch répond, mais ${manque} ne tourne pas : rien n'est compté. Relance aw-qt sur la tour.` });
    return { saute: `${manque} absent` };
  }
  const generation = avant.generation || 0;
  const fin = maintenant - MARGE_MS;
  let curseur = Math.max(Number(avant.curseur) || debutJour(maintenant, TZ()), maintenant - RATTRAPAGE_MS);
  const depart = Date.now();
  let tranches = 0;
  let secondes = 0;
  // Une tranche par jour (heure de la tour), enregistrée avec le curseur dans
  // la même transaction : une coupure n'en compte jamais une deux fois.
  while (curseur < fin && Date.now() - depart < budgetMs) {
    const b = Math.min(fin, finJour(curseur, TZ()));
    let lus;
    try {
      const [fenetres, absences, ...webs] = await Promise.all([
        evenements(seaux.fenetre, curseur, b),
        evenements(seaux.afk, curseur, b),
        ...seaux.web.map((s) => evenements(s, curseur, b).catch(() => [])),
      ]);
      lus = { fenetres, absences, web: webs.flatMap((l, i) => l.map((e) => ({ ...e, navigateur: navigateurDuSeau(seaux.web[i]) }))) };
    } catch (err) {
      if (avant.joignable !== false) console.warn(`Activité du PC : relevé interrompu (${err.message}) — repris au prochain`);
      noterEtat({ joignable: false, message: MESSAGE_ABSENT, essai });
      return { saute: "ActivityWatch injoignable", tranches };
    }
    const r = reglages();
    const exclues = new Set([...r.exclusions, ...exclusionsTour()]);
    const { applis, domaines } = calculer(lus, curseur, b, { categorie: (c) => categorieDe(c, r.categories), exclues });
    const jour = jourDe(curseur);
    const ecrit = transaction((d) => {
      const e = lireEtat(d);
      // Coupée ou effacée pendant le relevé : rien de ce qui était lu ne compte.
      if ((e.generation || 0) !== generation || !reglages(d).actif) return false;
      const ins = d.prepare(
        "INSERT INTO activite_pc (jour, type, nom, secondes) VALUES (?, ?, ?, ?) ON CONFLICT(jour, type, nom) DO UPDATE SET secondes = secondes + excluded.secondes",
      );
      for (const [nom, s] of applis) ins.run(jour, "app", nom, s);
      for (const [nom, s] of domaines) ins.run(jour, "domaine", nom, s);
      ecrireMeta(d, CLE_ETAT, { ...e, curseur: b });
      return true;
    });
    if (!ecrit) return { saute: "coupé ou effacé pendant le relevé", tranches };
    for (const s of applis.values()) secondes += s;
    curseur = b;
    tranches++;
  }
  if (avant.joignable === false) console.warn("Activité du PC : ActivityWatch répond de nouveau");
  noterEtat({ ...guetteurs, derniereCollecte: maintenant });
  return { tranches, secondes: Math.round(secondes), aJour: curseur >= fin };
}

// --- Réglages depuis l'app -------------------------------------------------------------------

const erreur = (status, message) => Object.assign(new Error(message), { status });

export function regler({ actif, exclusions, categories } = {}, maintenant = Date.now()) {
  if (coupeParLaTour()) throw erreur(409, "Activité du PC coupée sur la tour (REMY_ACTIVITE_PC=off).");
  if (actif !== undefined && typeof actif !== "boolean") throw erreur(400, "actif : true ou false.");
  if (exclusions !== undefined && (!Array.isArray(exclusions) || exclusions.length > 100 || !exclusions.every((x) => typeof x === "string"))) {
    throw erreur(400, "exclusions : une liste de noms d'applications (100 au plus).");
  }
  if (
    categories !== undefined &&
    (!categories || typeof categories !== "object" || Array.isArray(categories) || !Object.values(categories).every((c) => c === null || CATEGORIES[c]))
  ) {
    throw erreur(400, `categories : { appli: ${Object.keys(CATEGORIES).join(" | ")} | null }.`);
  }
  if (actif === undefined && exclusions === undefined && categories === undefined) throw erreur(400, "Attendu : actif, exclusions et/ou categories.");
  transaction((d) => {
    const r = reglages(d);
    const e = lireEtat(d);
    if (actif !== undefined && actif !== r.actif) {
      r.actif = actif;
      // Premier allumage : depuis ce matin. Rallumée après une coupure voulue :
      // à partir de maintenant, le trou reste vide.
      if (actif) e.curseur = e.curseur == null ? debutJour(maintenant, TZ()) : Math.max(Number(e.curseur) || 0, maintenant);
      else e.generation = (e.generation || 0) + 1;
    }
    if (exclusions !== undefined) {
      const nouvelles = [...new Set(exclusions.map(cleAppli).filter(Boolean))];
      // Jamais comptée : ce qui l'était déjà s'efface aussi.
      oublier(d, nouvelles.filter((x) => !r.exclusions.includes(x)), r.categories);
      r.exclusions = nouvelles;
    }
    if (categories !== undefined) {
      for (const [a, c] of Object.entries(categories)) {
        const k = cleAppli(a);
        if (!k) continue;
        if (c === null) delete r.categories[k];
        else r.categories[k] = c;
      }
    }
    ecrireMeta(d, CLE_REGLAGES, r);
    ecrireMeta(d, CLE_ETAT, e);
  });
  if (typeof actif === "boolean") console.warn(`Réglage : activité du PC ${actif ? "allumée" : "COUPÉE"} par ${PRENOM}`);
  return vue(maintenant);
}

// Tout oublier. Ce qui précède ne sera pas relu dans ActivityWatch.
export function effacer(maintenant = Date.now()) {
  transaction((d) => {
    d.exec("DELETE FROM activite_pc");
    const e = lireEtat(d);
    ecrireMeta(d, CLE_ETAT, { ...e, curseur: maintenant, generation: (e.generation || 0) + 1, derniereCollecte: null });
  });
  return vue(maintenant);
}

// Au-delà de 90 jours, plus rien.
export function purger(maintenant = Date.now()) {
  return Number(db().prepare("DELETE FROM activite_pc WHERE jour < ?").run(jourDe(maintenant - JOURS() * 86_400_000)).changes);
}

// --- Ce qu'on en lit -----------------------------------------------------------------------

export function dureeLisible(s) {
  const m = Math.round(Number(s) / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${h} h`;
}

function bilan(lignes, choix, exclues) {
  const applis = new Map();
  const domaines = new Map();
  for (const l of lignes) {
    if (exclues.has(l.nom)) continue;
    const m = l.type === "app" ? applis : l.type === "domaine" ? domaines : null;
    m?.set(l.nom, (m.get(l.nom) || 0) + Number(l.secondes));
  }
  const categories = new Map();
  for (const [nom, s] of applis) {
    const c = categorieDe(nom, choix);
    categories.set(c, (categories.get(c) || 0) + s);
  }
  const tri = (m) => [...m].sort((a, b) => b[1] - a[1]);
  return {
    total: Math.round([...applis.values()].reduce((a, b) => a + b, 0)),
    categories: tri(categories).map(([id, s]) => ({ id, nom: CATEGORIES[id], secondes: Math.round(s) })),
    applis: tri(applis)
      .filter(([, s]) => s >= 30)
      .slice(0, 10)
      .map(([nom, s]) => ({ nom, libelle: libelleAppli(nom), categorie: categorieDe(nom, choix), secondes: Math.round(s) })),
    domaines: tri(domaines)
      .filter(([, s]) => s >= 30)
      .slice(0, 8)
      .map(([nom, s]) => ({ nom, secondes: Math.round(s) })),
  };
}

// Les 14 derniers jours (heure de la tour), du plus récent au plus ancien.
function quatorzeJours(maintenant) {
  const tz = TZ();
  const jours = [];
  for (let d = debutJour(maintenant, tz), i = 0; i < 14; i++, d = debutJour(d - 1, tz)) jours.push(jourDe(d));
  return jours;
}

// Le bilan de la semaine (7 jours glissants) et celui des 7 jours d'avant, par
// catégorie : de quoi nourrir une analyse hebdomadaire, sans IA.
export function bilanSemaine(maintenant = Date.now()) {
  const r = reglages();
  const jours = quatorzeJours(maintenant);
  const lignes = db().prepare("SELECT jour, type, nom, secondes FROM activite_pc WHERE jour >= ? ORDER BY jour").all(jours.at(-1));
  const exclues = new Set([...r.exclusions, ...exclusionsTour()]);
  const cette = new Set(jours.slice(0, 7));
  const semaine = bilan(lignes.filter((l) => cette.has(l.jour)), r.categories, exclues);
  semaine.parJour = jours
    .slice(0, 7)
    .reverse()
    .map((jour) => ({
      jour,
      secondes: Math.round(lignes.filter((l) => l.jour === jour && l.type === "app" && !exclues.has(l.nom)).reduce((a, l) => a + Number(l.secondes), 0)),
    }));
  const avant = bilan(lignes.filter((l) => !cette.has(l.jour)), r.categories, exclues);
  return { semaine, precedente: { total: avant.total, categories: avant.categories }, lignes, exclues, choix: r.categories };
}

export function vue(maintenant = Date.now()) {
  const r = reglages();
  const e = lireEtat();
  const { semaine, precedente, lignes, exclues } = bilanSemaine(maintenant);
  return {
    actif: r.actif && !coupeParLaTour(),
    coupeParLaTour: coupeParLaTour(),
    activitywatch: {
      joignable: typeof e.joignable === "boolean" ? e.joignable : null,
      version: e.version || null,
      fenetre: e.fenetre ?? null,
      afk: e.afk ?? null,
      web: e.web ?? null,
      message: e.message || null,
      essai: e.essai || null,
    },
    derniereCollecte: e.derniereCollecte || null,
    releveMin: RELEVE_MIN,
    jours: JOURS(),
    aujourdhui: bilan(lignes.filter((l) => l.jour === jourDe(maintenant)), r.categories, exclues),
    semaine,
    semainePrecedente: precedente,
    exclusions: r.exclusions,
    exclusionsTour: exclusionsTour(),
    categories: Object.entries(CATEGORIES).map(([id, nom]) => ({ id, nom })),
  };
}

// Pour la consigne du modèle LOCAL seulement (lib/chat.js) : des repères.
export function noteActivitePC({ maintenant = Date.now() } = {}) {
  if (!activiteAllumee()) return null;
  const v = vue(maintenant);
  const liste = (b) =>
    b.categories
      .filter((c) => c.secondes >= 60)
      .slice(0, 5)
      .map((c) => `${c.nom.toLowerCase()} ${dureeLisible(c.secondes)}`)
      .join(", ");
  const lignes = [];
  if (v.aujourdhui.total >= 60) {
    const surtout = v.aujourdhui.applis.slice(0, 3).map((a) => a.libelle);
    lignes.push(`Sur le PC aujourd'hui : ${liste(v.aujourdhui)}${surtout.length ? ` (surtout ${surtout.join(", ")})` : ""}.`);
  }
  if (v.semaine.total >= 60) {
    const avant = v.semainePrecedente.total >= 60 ? ` (les 7 jours d'avant : ${dureeLisible(v.semainePrecedente.total)} au total)` : "";
    lignes.push(`Ces 7 jours : ${liste(v.semaine)}${avant}.`);
  }
  if (!lignes.length) return null;
  const releve = v.derniereCollecte ? `, relevé à ${heure(v.derniereCollecte)}` : "";
  return (
    `# Activité du PC de ${PRENOM} (temps actif d'après ActivityWatch, sur sa tour${releve})\n\n${lignes.join("\n")}\n\n` +
    `Ce sont des repères, pas des preuves : le temps devant une fenêtre ne dit pas ce que ${PRENOM} y faisait. ` +
    `Ne lui en fais jamais un reproche ; cite-les seulement s'ils l'aident (« tu as déjà beaucoup codé aujourd'hui »).`
  );
}
