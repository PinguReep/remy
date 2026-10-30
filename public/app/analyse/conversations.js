// Les conversations d'ailleurs (Claude Code, T3 Code, ChatGPT ; capacité
// conversations-externes-v1) : les chemins du contrat
// (docs/conversations-externes.md) et les phrases de l'iPhone
// (ios-native/RemyCore/Sources/RemyCore/ConversationsExternes.swift), pour que
// le site dise la même chose. Module pur, sans DOM : importé par la vue
// (public/app/vues/conversations-externes.js), par Réglages et par les tests
// node (test/site-conversations.test.mjs).

export const CAPACITE = "conversations-externes-v1";
export const SOURCES = ["claude-code", "t3", "chatgpt"];
const NOMS = { "claude-code": "Claude Code", t3: "T3 Code", chatgpt: "ChatGPT" };

export const nomSource = (id) => NOMS[id] || String(id ?? "");

/** Qui parle : « Toi », « Toi (collé) », l'assistant, « Résumé de Claude Code ». */
export function auteur(m, assistant) {
  switch (m?.auteur) {
    case "utilisateur": return "Toi";
    case "colle": return "Toi (collé)";
    case "resume": return "Résumé de Claude Code";
    default: return assistant || "L'assistant";
  }
}
export const deToi = (m) => m?.auteur === "utilisateur" || m?.auteur === "colle";

const entier = (n) => new Intl.NumberFormat("fr-FR").format(n);
const pluriel = (n, un, plusieurs) => (n === 1 ? `1 ${un}` : `${entier(n)} ${plusieurs}`);
const F_HEURE = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const F_JOUR_COURT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const F_JOUR_LONG = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const debutJour = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** « de 10:40 », « d'hier, 18:02 », « du 13 oct., 18:02 » (Format.depuis). */
export function depuis(ms, maintenant = Date.now()) {
  const d = new Date(ms);
  const debut = debutJour(new Date(maintenant));
  if (d.getTime() >= debut) return `de ${F_HEURE.format(d)}`;
  if (d.getTime() >= debut - 86_400_000) return `d'hier, ${F_HEURE.format(d)}`;
  return `du ${F_JOUR_COURT.format(d)}, ${F_HEURE.format(d)}`;
}

/** L'heure aujourd'hui, « Hier », sinon la date (Format.relatif). */
export function relatif(ms, maintenant = Date.now()) {
  if (ms == null) return "";
  const d = new Date(ms);
  const debut = debutJour(new Date(maintenant));
  if (d.getTime() >= debut) return F_HEURE.format(d);
  if (d.getTime() >= debut - 86_400_000) return "Hier";
  return F_JOUR_COURT.format(d);
}

/** « Aujourd'hui », « Hier », « Lundi 26 octobre » (l'année si ce n'est pas celle-ci). */
export function titreJour(ms, maintenant = Date.now()) {
  if (ms == null) return "Sans date";
  const d = new Date(ms);
  const m = new Date(maintenant);
  const ecart = Math.round((debutJour(d) - debutJour(m)) / 86_400_000);
  if (ecart === 0) return "Aujourd'hui";
  if (ecart === -1) return "Hier";
  const t = F_JOUR_LONG.format(d);
  return t.charAt(0).toUpperCase() + t.slice(1) + (d.getFullYear() === m.getFullYear() ? "" : ` ${d.getFullYear()}`);
}

/** « 2026-10-28 » → le même titre que la liste ; une chaîne illisible reste telle quelle. */
export function titreJourIso(iso, maintenant = Date.now()) {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!p) return String(iso ?? "");
  return titreJour(new Date(Number(p[1]), Number(p[2]) - 1, Number(p[3]), 12).getTime(), maintenant);
}

/** La ligne d'état d'une source (SourceConversations.phrase). */
export function phraseSource(s, maintenant = Date.now()) {
  if (!s?.actif) return s?.forceParLaTour ? "Coupée sur la tour (remy.env)." : "Coupée : rien n'est lu.";
  if (s.erreur) return s.erreur.message || "Lecture en échec.";
  const n = Number(s.conversations) || 0;
  if (n === 0 && s.aide) return s.aide.message || "";
  const nb = pluriel(n, "conversation", "conversations");
  if (s.derniereLecture == null) return s.id === "chatgpt" ? nb : "Pas encore lue : première lecture dans 30 min au plus.";
  return `Lue ${depuis(s.derniereLecture, maintenant)} · ${nb}`;
}

/**
 * Ce que la dernière lecture a vu, toutes sessions confondues : « 312
 * sessions : 280 lues, 30 d'un seul échange… » (la phrase vient de la tour,
 * la même pour l'iPhone), ou null (tour plus ancienne, rien lu encore).
 */
export const phraseRecensement = (s) => (typeof s?.recensement?.phrase === "string" && s.recensement.phrase) || null;

/** Quoi faire pour une source en erreur, ou sans rien (erreur.quoiFaire, aide.quoiFaire). */
export const quoiFaireSource = (s) => (s?.erreur || (Number(s?.conversations) ? null : s?.aide))?.quoiFaire || null;

/** Ce qui ne va pas, toutes sources confondues (la clé d'abord), ou null. */
export function probleme(etat) {
  if (etat?.cle?.erreur) return etat.cle.erreur;
  return (etat?.sources || []).find((s) => s.actif && s.erreur)?.erreur || null;
}

/** « 57 conversations · lues de 14:20 », ou ce qui ne va pas (ConversationsExternesModel.resume). */
export function resumeEtat(etat, maintenant = Date.now()) {
  if (!etat) return null;
  const p = probleme(etat);
  if (p) return p.message;
  const n = Number(etat.total?.conversations) || 0;
  if (n === 0) return "Rien encore : Claude Code, T3 Code, ChatGPT.";
  const lue = Math.max(0, ...(etat.sources || []).map((s) => Number(s.derniereReussie) || 0));
  return `${pluriel(n, "conversation", "conversations")}${lue ? ` · lues ${depuis(lue, maintenant)}` : ""}`;
}

/** Les exports gardés en clair hors du coffre (Imports.Originaux.phrase), ou null. */
export function phraseOriginaux(o) {
  const n = Number(o?.fichiers) || 0;
  if (!n) return null;
  const qui = n === 1 ? "1 export importé reste" : `${n} exports importés restent`;
  const ou = o.dossier ? ` (${o.dossier})` : "";
  const quand = o.gardeJours === 0 ? "effacé à la prochaine lecture"
    : o.gardeJours != null ? `effacé ${o.gardeJours} jour${o.gardeJours > 1 ? "s" : ""} après l'import`
      : "effacé après quelques jours";
  return `${qui} en clair hors du coffre${ou} : ${quand}.`;
}

/** Les exports déposés dans Imports, pas encore lus. */
export function phraseEnAttente(imports) {
  const n = Number(imports?.enAttente) || 0;
  if (!n) return null;
  return `${n === 1 ? "1 export attend" : `${n} exports attendent`} dans ${imports.dossier || "le dossier Imports"} : lu au prochain passage (30 min au plus), ou « Lire maintenant ».`;
}

/** L'assistant, s'il ne fait pas que répéter la source (pas « ChatGPT · ChatGPT »). */
export const assistantDistinct = (c) => (c?.assistant && c.assistant !== nomSource(c.source) ? c.assistant : null);

/** « Codex · 14:32 · 12 messages · Site de la boutique » (ConversationExterne.meta). */
export function metaConversation(c, maintenant = Date.now()) {
  const p = [];
  const a = assistantDistinct(c);
  if (a) p.push(a);
  if (c?.fin != null) p.push(relatif(c.fin, maintenant));
  const n = Number(c?.messages) || 0;
  p.push(n === 1 ? "1 message" : `${n} messages`);
  if (c?.projet?.nom) p.push(c.projet.nom);
  return p.join(" · ");
}

/** Les conversations groupées par jour (de leur dernier message), dans l'ordre reçu. */
export function parJour(liste, maintenant = Date.now()) {
  const sortie = [];
  for (const c of liste || []) {
    const titre = titreJour(c.fin ?? c.debut, maintenant);
    const dernier = sortie[sortie.length - 1];
    if (dernier && dernier.titre === titre) dernier.conversations.push(c);
    else sortie.push({ titre, conversations: [c] });
  }
  return sortie;
}

// --- Les chemins du contrat ---

const q = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const cheminEtat = () => "/api/conversations-externes";
/** GET …/liste : `source`, `jour` (AAAA-MM-JJ), `decalage`, `limite` (1–100). */
export const cheminListe = ({ source, jour, decalage, limite = 40 } = {}) =>
  `/api/conversations-externes/liste${q({ source, jour, decalage: decalage || null, limite: Math.min(100, Math.max(1, limite)) })}`;
/** GET …/jours : les jours qui ont des conversations. */
export const cheminJours = ({ source, nombre = 400 } = {}) => `/api/conversations-externes/jours${q({ source, nombre })}`;
/** GET …/chercher : `q` (200 caractères au plus), `source`, `limite` (1–50). */
export const cheminRecherche = ({ q: mots, source, limite = 30 } = {}) =>
  `/api/conversations-externes/chercher${q({ q: String(mots || "").trim().slice(0, 200), source, limite: Math.min(50, Math.max(1, limite)) })}`;
/** GET …/conversations/:source/:id : `apres` (page suivante) ou `autour` (un message trouvé). */
export const cheminLecture = ({ source, id, apres, autour, limite = 300 } = {}) =>
  `/api/conversations-externes/conversations/${encodeURIComponent(source)}/${encodeURIComponent(id)}${q({ apres, autour, limite })}`;
export const cheminNuit = (jour) => `/api/conversations-externes/nuit${q({ jour })}`;
export const cheminSynchro = () => "/api/conversations-externes/synchroniser";
export const cheminSource = (id) => `/api/conversations-externes/sources/${encodeURIComponent(id)}`;
export const cheminUsage = () => "/api/conversations-externes/usage";
export const cheminToutEffacer = () => "/api/conversations-externes/tout";
export const cheminImport = () => "/api/conversations-externes/chatgpt";

/**
 * Le corps de « Lire maintenant » : une source, ou toutes. ChatGPT aussi : la
 * tour relit alors le dossier Imports et Téléchargements (soir du 29/10).
 */
export const corpsSynchro = (source) => (source ? { source } : {});

// --- Les adresses du site (#/conversations/<source>/<id>[/<message>]) ---

/**
 * L'adresse d'une conversation ; `autour` : le message trouvé par la recherche.
 * L'identifiant est encodé deux fois : main.js décode tout le fragment avant
 * de le découper aux « / », et un identifiant peut en contenir.
 */
export function route({ source, id, autour } = {}) {
  const parts = ["conversations", encodeURIComponent(source), encodeURIComponent(encodeURIComponent(id))];
  if (autour != null && autour !== "") parts.push(String(autour));
  return parts.join("/");
}

/** Les arguments de la route (après « conversations ») → { source, id, autour } ou null. */
export function lireRoute(args = []) {
  if (!Array.isArray(args) || args.length < 2 || !args[0] || !args[1]) return null;
  let id = args[1];
  try { id = decodeURIComponent(id); } catch {}
  const autour = args[2] != null && /^\d+$/.test(args[2]) ? Number(args[2]) : null;
  return { source: args[0], id, autour };
}

// --- L'import ChatGPT ---

// L'export ChatGPT automatique (soir du 29/10) : Rémy prend l'export dans
// Téléchargements, et une carte rappelle de le demander quand le dernier a
// plus de 30 jours. Les mêmes phrases que l'iPhone (ConversationsExternes.swift).
export const LIEN_EXPORT_CHATGPT = "https://chatgpt.com/#settings/DataControls";

/** Téléchargements surveillé, sur cette tour : { actif, forceParLaTour, dossiers } ou null (tour plus ancienne). */
export const telechargements = (etat) => etat?.chatgpt?.telechargements || null;

/**
 * Ce que l'interrupteur « Téléchargements » dit sous son titre : le dossier
 * est celui de la TOUR (pas de l'ordinateur où l'on lit), et les .zip
 * illisibles de la dernière lecture, nommés par la tour (`phraseIllisibles`).
 */
export function phraseTelechargements(t) {
  if (!t) return null;
  if (t.forceParLaTour) return "Coupé sur la tour (REMY_TELECHARGEMENTS=off).";
  const ou = (t.dossiers || []).map((d) => d.chemin).filter(Boolean).join(", ") || "Téléchargements";
  const phrase = `Rémy regarde ${ou} sur la tour, en lecture seule : il n'y prend que les exports ChatGPT de moins de ${t.joursMax || 90} jours, sans jamais rien y déplacer ni effacer.`;
  return typeof t.phraseIllisibles === "string" && t.phraseIllisibles ? `${phrase} ${t.phraseIllisibles}` : phrase;
}

/**
 * La carte « Exporter ChatGPT », ou null : la tour dit quand la montrer
 * (dernier import de plus de 30 jours, ou jamais, la source allumée). Le
 * lien du mail se clique SUR LA TOUR (Rémy ne regarde que ses
 * Téléchargements) ; reçu ailleurs (iPhone, autre ordinateur), le .zip
 * s'importe depuis la carte (`importer`).
 */
export function carteExportChatGPT(etat) {
  const r = etat?.chatgpt?.rappel;
  if (!r?.aMontrer) return null;
  const t = telechargements(etat);
  const dansTelechargements = Boolean(t?.actif && (t.dossiers || []).length);
  const jours = Number(r.depuisJours);
  return {
    titre: "Exporter ChatGPT",
    texte: dansTelechargements
      ? "Exporte tes données ; quand le mail arrive, clique son lien sur la tour : Rémy prend le fichier dans ses Téléchargements. Ailleurs, importe le .zip ici."
      : "Exporte tes données ; quand le mail arrive, clique le lien, puis importe le .zip ici.",
    detail: r.dernierImport == null || !Number.isFinite(jours) ? "Aucun export importé pour l'instant." : `Dernier import il y a ${jours} jour${jours > 1 ? "s" : ""}.`,
    lien: typeof r.lien === "string" && /^https:\/\/chatgpt\.com\//.test(r.lien) ? r.lien : LIEN_EXPORT_CHATGPT,
    bouton: "Ouvrir ChatGPT",
    importer: "Importer le .zip",
    apresOuverture: "Dans ChatGPT : Contrôle des données › Exporter les données, puis confirme. Le mail arrive en quelques minutes.",
  };
}

/**
 * La carte se montre-t-elle ? Comme l'iPhone (ConversationsExternesVues) :
 * sur « Toutes » ou ChatGPT, et jamais à la place des résultats d'une recherche.
 */
export const carteExportVisible = ({ source = "", recherche = "" } = {}) => (!source || source === "chatgpt") && !String(recherche || "").trim();

// --- Un export trouvé dans Téléchargements : il attend un geste (revue du 30/10) ---
// Un site peut ranger n'importe quel .zip dans Téléchargements : la tour ne
// l'importe pas sans Sam (sauf un export d'un compte déjà accepté).
export const cheminReponseTelechargement = () => "/api/conversations-externes/chatgpt/telechargements";
/** Les exports trouvés qui attendent un geste ({ id, nom, octets, date }), [] sur une tour plus ancienne. */
export const propositionsTelechargements = (etat) => (Array.isArray(etat?.chatgpt?.telechargements?.propositions) ? etat.chatgpt.telechargements.propositions.filter((p) => p?.id && p?.nom) : []);
const taille = (o) => (o >= 1e6 ? `${(o / 1e6).toFixed(o >= 1e7 ? 0 : 1).replace(".", ",")} Mo` : `${Math.max(1, Math.round((o || 0) / 1e3))} ko`);
/** La carte d'un export trouvé : son titre, son texte (nom, taille, date) et ce qu'il faut savoir. */
export function carteProposition(p) {
  const d = p?.date ? new Date(p.date) : null;
  const date = d ? ` du ${d.getDate()}/${d.getMonth() + 1}` : "";
  return {
    titre: "Un export ChatGPT trouvé dans Téléchargements",
    texte: `« ${p.nom} » (${taille(p.octets)}${date ? `,${date}` : ""}) : l'importer ?`,
    detail: "Rémy n'importe rien de Téléchargements sans toi : si c'est l'export que tu as demandé, importe-le ; sinon, laisse-le (un site peut y ranger n'importe quel fichier).",
    importer: "Importer",
    refuser: "Pas celui-là",
  };
}

/** Un fichier que la tour sait importer : le .zip de l'export, ou conversations.json. */
export const importable = (nom) => /\.(zip|json)$/i.test(String(nom || ""));
/** Le type envoyé avec le fichier (le même que l'iPhone). */
export const typeFichier = (nom) => (/\.json$/i.test(String(nom || "")) ? "application/json" : "application/zip");

/** Ce que dit un import réussi (BilanImport.phrase). */
export function phraseImport(b = {}) {
  if (b.deja) return "Cet export était déjà importé : rien de nouveau.";
  const p = [];
  const n = Number(b.nouvelles) || 0;
  const m = Number(b.misesAJour) || 0;
  if (n > 0) p.push(n === 1 ? "1 conversation importée" : `${n} conversations importées`);
  if (m > 0) p.push(m === 1 ? "1 mise à jour" : `${m} mises à jour`);
  if (!p.length) p.push("Rien de nouveau dans cet export");
  let s = `${p.join(", ")}.`;
  const ig = Number(b.ignorees) || 0;
  const tr = Number(b.tronquees) || 0;
  const ma = Number(b.masques) || 0;
  if (ig > 0) s += ig === 1 ? " 1 ignorée (sans texte lisible)." : ` ${ig} ignorées (sans texte lisible).`;
  if (tr > 0) s += tr === 1 ? " 1 très longue : seule la fin est gardée." : ` ${tr} très longues : seule la fin est gardée.`;
  if (ma > 0) s += ma === 1 ? " 1 secret masqué." : ` ${ma} secrets masqués.`;
  return s;
}

/** « Envoi de l'export… 42 % » (ConversationsExternesModel.libelleImport). */
export function libelleEnvoi(progression) {
  if (progression == null || !(progression > 0)) return "Envoi de l'export à la tour…";
  return progression >= 0.999 ? "Lecture de l'export sur la tour…" : `Envoi de l'export… ${Math.floor(progression * 100)} %`;
}

/** Le message d'un import refusé : celui de la tour et quoi faire, sinon le statut. */
export function erreurImport(statut, corps) {
  if (!statut) return "La tour ne répond pas : l'export n'est pas parti. Vérifie que le PC est allumé, puis réessaie.";
  const m = corps?.message || `Erreur ${statut} : l'export n'a pas été importé.`;
  return corps?.quoiFaire ? `${m} ${corps.quoiFaire}` : m;
}

/** Ce que dit « Lire maintenant » : les sources relues, ou celles en échec. */
export function phraseSynchro(r) {
  const rates = Object.entries(r?.bilan?.sources || {}).filter(([, b]) => b && b.ok === false);
  if (!rates.length) return { texte: "Conversations relues.", erreur: false };
  return { texte: `Lu, sauf : ${rates.map(([id, b]) => `${nomSource(id)} (${b.erreur?.message || "erreur"})`).join(", ")}.`, erreur: true };
}
