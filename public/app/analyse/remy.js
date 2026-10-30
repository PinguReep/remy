// Ce qui se calcule dans la vue Rémy (public/app/vues/remy.js), avec les
// mêmes règles et les mêmes mots que l'iPhone : la liste des fils
// (Logique.swift : Fils, PeriodeFil ; Format.relatif), les non-lus
// (ChatModel.nonLu), le composeur (file « Envoyer après », dictée, liens), la
// barre d'étapes (BarreEtapes), la jauge et le résumé automatique
// (Jauge.swift, JaugeVues.swift), le texte en clair d'une réponse
// (Markdown.enClair), le diagnostic d'une erreur. Module pur, sans DOM :
// importé par la vue, par non-lus.js et par les tests node
// (test/site-remy.test.mjs).

import { plier } from "./dates.js";

// --- Les phrases préparées (Brouillons, Modeles.swift) ---

export const BROUILLONS = {
  journee: "Organise ma journée : regarde mon agenda et mes tâches, dis-moi par quoi commencer et ce qui est en retard. Pose tes questions d'un coup si tu en as.",
  retards: "Qu'est-ce qui est en retard, et par quoi je commence ?",
};
/** « Continuer avec Rémy » depuis un fil importé (BandeauImporte). */
export const suiteImportee = (titre) => ({
  titre: `Suite · ${titre || ""}`.slice(0, 80),
  texte: `Reprenons ce que j'avais commencé ailleurs, dans « ${titre || ""} » : où est-ce que ça nous mène ?`,
});

// --- Dates des fils (heure de la machine, comme l'iPhone) ---

const F_HEURE = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const F_JOUR_COURT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const debutJour = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const decaler = (d, jours) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + jours, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
const deux = (n) => String(n).padStart(2, "0");
export const heureCourte = (ms) => F_HEURE.format(new Date(ms));
export const memeJour = (a, b) => debutJour(new Date(a)).getTime() === debutJour(new Date(b)).getTime();

/** « 24/10/2026 » (Format.dateFil). */
export const dateFil = (d = new Date()) => `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()}`;
/** Le titre du fil « Organiser ma journée » : le même que l'iPhone et le site. */
export const titreJournee = (d = new Date()) => `${dateFil(d)} · Journée`;

/** À droite d'une ligne : l'heure aujourd'hui, « Hier », sinon le jour court (Format.relatif). */
export function heureListe(ms, maintenant = new Date()) {
  if (ms == null || !Number.isFinite(Number(ms))) return "";
  const d = new Date(Number(ms));
  const debut = debutJour(maintenant);
  if (d >= debut) return F_HEURE.format(d);
  if (d >= decaler(debut, -1)) return "Hier";
  return F_JOUR_COURT.format(d);
}

// --- La liste des fils (ConversationsView, Fils, PeriodeFil) ---

export const PERIODES = ["Épinglées", "Aujourd'hui", "7 derniers jours", "Plus ancien"];
export const JOURS_AVANT_REPLI = 14;

export function periode(c, maintenant = new Date()) {
  if (c?.pinned) return "Épinglées";
  if (c?.updatedAt == null) return "Plus ancien";
  const debut = debutJour(maintenant);
  if (c.updatedAt >= debut.getTime()) return "Aujourd'hui";
  return c.updatedAt >= decaler(debut, -6).getTime() ? "7 derniers jours" : "Plus ancien";
}

/** Un fil « Journée » ou « Nocturne » d'un autre jour : rangé à part. */
export function estAncienFilDuJour(titre, maintenant = new Date()) {
  if (!/^\d{2}\/\d{2}\/\d{4} · (Journée|Nocturne)$/.test(String(titre || ""))) return false;
  return !String(titre).startsWith(dateFil(maintenant));
}

/** Un seul échange il y a plus de 14 jours : replié, jamais supprimé. Épinglé ou importé : jamais. */
export function estEchangeCourtAncien(c, maintenant = new Date()) {
  if (!c || c.origine || c.pinned || typeof c.messages !== "number" || c.messages > 2 || c.updatedAt == null) return false;
  return c.updatedAt < decaler(maintenant, -JOURS_AVANT_REPLI).getTime();
}

const trier = (l) => [...(l || [])].sort((a, b) => (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))) || (b.updatedAt || 0) - (a.updatedAt || 0));

/**
 * La liste rangée comme sur l'iPhone : les sections (avec leurs fils), puis
 * trois groupes repliés (échanges courts anciens, anciennes journées, importées).
 */
export function organiserListe(liste, maintenant = new Date()) {
  const toutes = trier(liste);
  const importees = toutes.filter((c) => c.origine);
  const anciennes = toutes.filter((c) => !c.origine && estAncienFilDuJour(c.title, maintenant));
  const courtes = toutes.filter((c) => !c.origine && !estAncienFilDuJour(c.title, maintenant) && estEchangeCourtAncien(c, maintenant));
  const principales = toutes.filter((c) => !c.origine && !estAncienFilDuJour(c.title, maintenant) && !estEchangeCourtAncien(c, maintenant));
  const sections = PERIODES.map((titre) => ({ titre, conversations: principales.filter((c) => periode(c, maintenant) === titre) })).filter((s) => s.conversations.length);
  return {
    sections,
    groupes: [
      { cle: "courtes", titre: `Échanges courts, plus de ${JOURS_AVANT_REPLI} jours (${courtes.length})`, conversations: courtes },
      { cle: "anciennes", titre: `Anciennes journées (${anciennes.length})`, conversations: anciennes },
      { cle: "importees", titre: `Importées (${importees.length})`, conversations: importees },
    ].filter((g) => g.conversations.length),
    total: toutes.length,
  };
}

/** La recherche ignore la casse et les accents (« creat » trouve « créateurs »). */
export function chercherFils(liste, q) {
  const p = plier(String(q || "").trim());
  if (!p) return trier(liste);
  return trier(liste).filter((c) => plier(c.title || "").includes(p));
}

/** Le fil à proposer sur l'écran vide : le plus récent hors importés, et s'il a bougé aujourd'hui. */
export function aReprendre(liste, maintenant = new Date()) {
  const propres = (liste || []).filter((c) => !c.origine);
  if (!propres.length) return null;
  const fil = propres.reduce((a, b) => ((b.updatedAt || 0) > (a.updatedAt || 0) ? b : a));
  return { fil, duJour: fil.updatedAt != null && memeJour(fil.updatedAt, maintenant) };
}
export const libelleReprise = (r) => (r?.duJour ? `Reprendre le fil du jour « ${r.fil.title} »` : `Reprendre « ${r?.fil?.title || ""} »`);

/** Un fil laissé ouvert depuis un autre jour se referme au retour (Fils.aRefermer). */
export const aRefermer = (derniere, maintenant = new Date()) => derniere != null && !memeJour(derniere, maintenant);

// --- Non lus (ChatModel.nonLu) ---

/** La marque locale : par fil, l'updatedAt de la dernière réponse vue. */
export const CLE_LUS = "remy-conversations-lues";

/**
 * Une réponse de Rémy pas encore vue : la dernière parole est la sienne, plus
 * récente que la marque, ni dans le fil ouvert ni dans un fil importé.
 * `lus` null : première visite, rien n'est compté.
 */
export function nonLu(c, { lus, ouvert = null, capacite = true } = {}) {
  if (!capacite || !lus || !c || c.origine) return false;
  if (c.id === ouvert) return false;
  return c.dernier === "assistant" && (c.updatedAt || 0) > (lus[c.id] || 0);
}
export const nombreNonLus = (liste, options) => (liste || []).filter((c) => nonLu(c, options)).length;
/** « Marquer comme non lu » : la dernière réponse redevient à voir (seulement si Rémy a parlé en dernier). */
export const peutMarquerNonLu = (c, ouvert) => Boolean(c && !c.origine && c.dernier === "assistant" && c.id !== ouvert);
export const marqueNonLue = (c) => Math.max(0, (c?.updatedAt || 1) - 1);
export const phraseNonVues = (n) => `${n} réponse${n > 1 ? "s" : ""} non vue${n > 1 ? "s" : ""}`;

// --- Le composeur ---

/** « Partira à la fin de la réponse : « … » » (Composeur.texteFile). */
export function texteFile(textes) {
  const premier = textes?.[0] || "";
  const extrait = [...premier].length > 50 ? [...premier].slice(0, 47).join("") + "…" : premier;
  return `${textes?.length > 1 ? `${textes.length} messages partiront` : "Partira"} à la fin de la réponse : « ${extrait} »`;
}

/** Ce qui revient au champ s'ajoute après ce qui y est déjà, séparé d'une ligne vide. */
export function joindre(deja, texte) {
  const a = String(deja || "").trim();
  const b = String(texte || "").trim();
  if (!b) return a;
  return a ? `${a}\n\n${b}` : b;
}

/** Le texte dicté s'ajoute après une espace (ChatModel.ajouterDictee), jamais envoyé seul. */
export function ajouterDictee(deja, texte) {
  const t = String(texte || "").trim();
  if (!t) return String(deja || "");
  const d = String(deja || "").replace(/\s+$/, "");
  return d ? `${d} ${t}` : t;
}

export const contientLien = (t) => /https?:\/\//.test(String(t || ""));

/** Une question préparée ne remplace jamais un autre message en cours (AppModel.preparer). */
export function conflitQuestion({ brouillon, texte, file = [] }) {
  const b = String(brouillon || "").trim();
  return (Boolean(b) && b !== String(texte || "").trim()) || file.length > 0;
}

/**
 * Relire un fil sans perdre ce qui n'existe qu'à l'écran (l'iPhone ne relit
 * pas le fil au retour : ses lignes locales restent). Les lignes locales de la
 * fin (une question que la tour a retirée, sa réponse en erreur et
 * « Réessayer ») se recollent après les messages de la tour. Une erreur seule,
 * dont la question est sur la tour, s'efface si la tour a écrit depuis : la
 * réponse est peut-être arrivée.
 */
export function garderFinLocale(avant, tour) {
  const a = Array.isArray(avant) ? avant : [];
  const t = Array.isArray(tour) ? tour : [];
  let i = a.length;
  while (i > 0 && a[i - 1]?._local) i -= 1;
  const fin = a.slice(i);
  if (!fin.length) return t;
  const connus = a.slice(0, i).filter((m) => !m?._local).length;
  if (!fin.some((m) => m.role === "user") && t.length > connus) return t;
  return [...t, ...fin];
}

/** « remy-envoi » : un texte, écrit il y a 2 min au plus (contrat C). */
export function envoiValable(e, maintenant = Date.now()) {
  if (!e || typeof e.texte !== "string" || !e.texte.trim()) return false;
  const a = Number(e.a);
  return Number.isFinite(a) && maintenant - a <= 120000 && a - maintenant <= 60000;
}

// --- Erreurs et diagnostic ---

/** Le message sans le « (code R-…) » que api.js lui ajoute : le code s'affiche à part. */
export function sansCode(message, code) {
  const m = String(message || "");
  return code ? m.replace(` (code ${code})`, "").trim() : m;
}
const trie = (v) => (Array.isArray(v) ? v.map(trie) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, trie(v[k])])) : v);
/** Le diagnostic d'un incident, en JSON indenté aux clés triées (prêt à coller). */
export const jsonTrie = (v) => JSON.stringify(trie(v), null, 2);
export const copieSansDetail = (message, code) => `${message} (code ${code})`;

/** Ce que Sam lit après « Retenir » (RetourCapture.phrase). */
export function phraseCapture(r) {
  const a = Array.isArray(r?.ajouts) ? r.ajouts : [];
  if (a.length) {
    const reste = a.length - 1;
    return `Retenu : ${a[0]}${reste > 0 ? ` — et ${reste} autre${reste > 1 ? "s" : ""} chose${reste > 1 ? "s" : ""}.` : ""}`;
  }
  if (r?.memoire === false) return r?.message ? `Gardé : ${r.message}` : "Gardé : Rémy le relira cette nuit.";
  return "Rien de nouveau : Rémy le savait déjà.";
}

/** « glm-5.3 · sur tes machines · 0,02 $ » sous une réponse. */
export function libelleModele(m) {
  if (!m?.model || m.model === "remy") return null;
  const usd = typeof m.usd === "number" && m.usd > 0 ? ` · ${m.usd < 0.01 ? "< 0,01" : m.usd.toFixed(2).replace(".", ",")} $` : "";
  return `${m.model}${m.tier === "local" ? " · sur tes machines" : ""}${usd}`;
}
export const estSecours = (m) => m?.tier === "dégradé";

// --- Les autorisations (AutorisationView) ---

export function titreAutorisation(statut) {
  if (statut === "en_attente") return "Recherche web · via Claude (Anthropic)";
  if (["acceptee", "accordee", "accorde"].includes(statut)) return "Recherche autorisée";
  if (statut === "refusee") return "Sans le web, à ta demande";
  return "Demande expirée";
}
export const partira = (a) => (a?.contexte === true ? "ta question, la conversation et ta mémoire" : "ta question seulement — ni la conversation, ni ta mémoire, ni ton planning");
/** Une demande en attente qui n'est plus le dernier message a expiré (ChatModel.lignes). */
export const statutAutorisation = (a, index, total) => (a?.statut === "en_attente" && index != null && index !== total - 1 ? "expiree" : a?.statut || "expiree");

// --- « Faire connaissance » (Onboarding.reste) ---

export function resteSession(s, e) {
  if (!s) return [];
  if (e?.etats?.[s.id] === "faite") return [];
  const couverts = new Set(e?.couverture?.[s.id] || []);
  return (s.reperes || []).filter((r) => !couverts.has(r.id));
}
export function phraseSession(s, e) {
  const reste = resteSession(s, e);
  return reste.length ? `Il reste : ${reste.map((r) => r.label).join(" · ")}` : "Tout est couvert : Rémy peut clore l'étape.";
}

// --- La barre d'étapes (BarreEtapes, EtapeReponse) ---

/** L'icône de chaque étape (clés de lib/chat.js). */
export const ICONES_ETAPE = { contexte: "plateau", choix: "branche", modele: "puce-calcul", reflexion: "cerveau", motion: "liste", web: "globe", navigateur: "boussole", proposition: "calendrier-plus", budget: "sablier", secours: "alerte", ecrit: "crayon" };
export const iconeEtape = (cle) => (cle == null ? "horloge" : ICONES_ETAPE[cle] || "horloge");

/** Ajoute une étape, ou met à jour la dernière si c'est la même (la réflexion envoie un nouvel extrait). */
export function recevoirEtape(etapes, { cle, text, detail, t } = {}) {
  if (!cle || !text) return etapes;
  const d = etapes[etapes.length - 1];
  if (d && d.cle === cle) {
    d.texte = text;
    if (detail) d.detail = detail;
    return etapes;
  }
  etapes.push({ cle, texte: text, detail: detail || null, t: Number(t) || 0 });
  return etapes;
}

/** « 0,4 s », « 12 s », « 1 min 05 » (BarreEtapes.duree). */
export function dureeCourte(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(".", ",")} s`;
  const s = Math.floor(n / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${deux(s % 60)}`;
}
/** La durée totale : l'horloge du site s'il a vu le début et la fin, sinon la dernière étape (tour). */
export function totalReponse({ debut, fin, etapes } = {}) {
  if (debut != null && fin != null) return Math.max(0, fin - debut);
  return etapes?.length ? etapes[etapes.length - 1].t || 0 : 0;
}
/** La durée de CHAQUE étape : jusqu'à la suivante ; « en cours » pour celle qui court ; la dernière jusqu'à la fin. */
export function dureeEtape(etapes, i, { enCours = false, totalMs = null } = {}) {
  if (!etapes?.[i]) return "";
  if (i + 1 < etapes.length) return dureeCourte(Math.max(0, etapes[i + 1].t - etapes[i].t));
  if (enCours) return "en cours";
  if (totalMs == null) return "";
  return dureeCourte(Math.max(0, totalMs - etapes[i].t));
}
export const libelleFinEtapes = (totalMs, tps, vitesse = false) => `Réponse en ${dureeCourte(totalMs)}${vitesse && tps > 0 ? ` · ${fmtTps(tps)}` : ""}`;

// --- Les nombres de la jauge, à la française (JaugeContexte) ---

const virgule = (s) => s.replace(".", ",");
const ENTIER = new Intl.NumberFormat("fr-FR");
/** « 850 », « 44,2 k », « 131 k » */
export function fmtJetons(n) {
  const x = Number(n) || 0;
  if (x < 1000) return String(Math.round(x));
  if (x < 100000) return `${virgule((x / 1000).toFixed(1))} k`;
  return `${Math.round(x / 1000)} k`;
}
/** « 42 tok/s », « 8,4 tok/s » */
export const fmtTps = (x) => `${x < 10 ? virgule(Number(x).toFixed(1)) : Math.round(x)} tok/s`;
/** « 34 % », « <1 % » */
export function fmtPourcent(x) {
  const p = x * 100;
  return `${p > 0 && p < 1 ? "<1" : Math.round(p)} %`;
}
/** « 2,1 s », « 43 s », « 1 min 05 » */
export function fmtSecondes(s) {
  if (s < 10) return `${virgule(Number(s).toFixed(1))} s`;
  const n = Math.round(s);
  return n < 60 ? `${n} s` : `${Math.floor(n / 60)} min ${deux(n % 60)}`;
}

// --- La jauge du contexte (JaugeContexte.de) ---

export const SEUIL_COMPACTAGE = 0.7;
export const MESSAGES_GARDES = 6;
const fini = (x) => typeof x === "number" && Number.isFinite(x);

function debitDe(m) {
  if (!fini(m?.tps) || m.tps <= 0 || !fini(m?.jetons) || m.jetons <= 0) return null;
  return {
    tps: m.tps,
    jetons: m.jetons,
    secondes: fini(m.decodeMs) ? m.decodeMs / 1000 : m.jetons / m.tps,
    premier: fini(m.premierMs) ? m.premierMs / 1000 : null,
    estime: m.estime === true,
  };
}

/** La jauge d'un fil : la place prise (dernière réponse mesurée), la vitesse dernière et moyenne. */
export function jauge(messages) {
  const mesurees = (messages || []).filter((m) => m && m.role !== "user" && !m._local && m.mesures && typeof m.mesures === "object").map((m) => m.mesures);
  const j = { contexte: null, fenetre: null, fenetreReglee: false, repartition: null, derniere: null, moyenne: null, reponsesMesurees: 0, modele: null, machine: null };
  const avecContexte = [...mesurees].reverse().find((m) => fini(m.contexte));
  if (avecContexte) {
    j.contexte = avecContexte.contexte;
    j.fenetre = fini(avecContexte.fenetre) ? avecContexte.fenetre : null;
    j.fenetreReglee = avecContexte.fenetreSource === "reglage";
    j.repartition = avecContexte.repartition && typeof avecContexte.repartition === "object" ? avecContexte.repartition : null;
  }
  const qui = [...mesurees].reverse().find((m) => m.modele != null || m.machine != null);
  if (qui) {
    j.modele = qui.modele ?? null;
    j.machine = qui.machine ?? null;
  }
  const debits = mesurees.map(debitDe).filter(Boolean);
  j.reponsesMesurees = debits.length;
  j.derniere = debits[debits.length - 1] || null;
  if (debits.length) {
    const jetons = debits.reduce((s, d) => s + d.jetons, 0);
    const secondes = debits.reduce((s, d) => s + d.secondes, 0);
    const premiers = debits.map((d) => d.premier).filter((p) => p != null);
    if (secondes > 0) j.moyenne = { tps: jetons / secondes, jetons, secondes, premier: premiers.length ? premiers.reduce((s, p) => s + p, 0) / premiers.length : null, estime: debits.some((d) => d.estime) };
  }
  j.vide = j.contexte == null && j.derniere == null && j.modele == null;
  j.fraction = j.contexte != null && j.fenetre > 0 ? Math.min(1, Math.max(0, j.contexte / j.fenetre)) : null;
  j.niveau = j.fraction == null ? "calme" : j.fraction >= 0.9 ? "plein" : j.fraction >= 0.7 ? "attention" : "calme";
  return j;
}

/** Le bouton de l'en-tête : « 34 », « 44k », « – » (BoutonJauge.court). */
export function court(j) {
  if (j?.fraction != null) return String(Math.round(j.fraction * 100));
  if (j?.contexte != null) return j.contexte < 1000 ? String(j.contexte) : `${Math.round(j.contexte / 1000)}k`;
  return "–";
}
/** Ce que dit le lecteur d'écran (BoutonJauge.lu). */
export function lu(j) {
  if (j?.fraction != null) return `${fmtPourcent(j.fraction)} utilisés`;
  if (j?.contexte != null) return `${fmtJetons(j.contexte)} tokens utilisés`;
  return "pas encore mesuré";
}
export function phraseNiveau(j) {
  if (j?.niveau === "plein") return "Presque plein : une nouvelle conversation gardera des réponses rapides et justes.";
  if (j?.niveau === "attention") return "Ça se remplit : au-delà de 90 %, mieux vaut repartir d'une conversation neuve.";
  return null;
}
/** « sur 128 k que Rémy peut avoir en tête » ou « taille maximale inconnue ». */
export const surFenetre = (j) => (j?.fenetre != null ? `sur ${fmtJetons(j.fenetre)} que Rémy peut avoir en tête` : "taille maximale inconnue");
export function pasEncoreMesure({ envoi = false, machine = null } = {}) {
  if (envoi) return "La mesure arrive à la fin de la réponse de Rémy.";
  if (String(machine || "").includes("Anthropic")) return "Cette réponse vient de Claude : la place n'est mesurée que sur le modèle local.";
  return "La mesure arrive avec la prochaine réponse de Rémy dans ce fil.";
}
/** D'où vient la place : mémoire, conversation, outils, et ce qui reste libre. */
export function repartitionJauge(j) {
  const r = j?.repartition;
  if (!r) return null;
  const n = (x) => (fini(x) ? x : 0);
  const blocs = [
    { cle: "systeme", libelle: "Mémoire, planning, agenda", jetons: n(r.systeme) },
    { cle: "conversation", libelle: "Conversation", jetons: n(r.conversation) + n(r.reponse) },
    { cle: "outils", libelle: "Outils lus (Motion, pages…)", jetons: n(r.outils) },
  ];
  const occupe = Math.max(1, n(r.systeme) + n(r.conversation) + n(r.reponse) + n(r.outils));
  const total = Math.max(occupe, j.fenetre ?? occupe);
  return { blocs, total, libre: j.fenetre != null && j.fenetre > occupe ? j.fenetre - occupe : null };
}
/** « 1 830 tokens en 43 s · premier mot après 2,1 s » (ContexteVue.detail). */
export function detailDebit(d) {
  let s = `${ENTIER.format(d.jetons)} tokens en ${fmtSecondes(d.secondes)}`;
  if (d.premier != null) s += ` · premier mot après ${fmtSecondes(d.premier)}`;
  if (d.estime) s += " · estimé";
  return s;
}
export const detailMoyenne = (j) => `sur ${j.reponsesMesurees} réponses · ${fmtJetons(j.moyenne.jetons)} tokens${j.moyenne.premier != null ? ` · premier mot après ${fmtSecondes(j.moyenne.premier)} en moyenne` : ""}`;
export function noteJauge(j) {
  const lignes = ["Mesuré sur la tour, par le modèle lui-même. La vitesse compte la réflexion de Rémy ; ni la lecture du contexte, ni le temps des outils."];
  if (j?.contexte != null && j.fenetre == null) lignes.push("Le modèle ne déclare pas sa taille maximale : elle se règle sur la tour (REMY_GLM_CONTEXTE).");
  else if (j?.fenetreReglee) lignes.push("Taille maximale réglée sur la tour.");
  return lignes;
}

/**
 * Ce que la jauge dit du résumé du début du fil (JaugeContexte.phraseCompactage) :
 * quand l'automatique se fera (70 %), s'il s'est fait, ou qu'il est coupé.
 * `automatique` : le circuit « compactage » de la tour (null : pas lu, allumé
 * par défaut) ; `messages` : ceux du fil.
 */
export function phraseCompactage(j, { compactage = null, automatique = null, messages = 0 } = {}) {
  const bouts = [];
  const jusqua = Number(compactage?.jusqua) || 0;
  if (jusqua > 0) bouts.push(`Déjà résumé${compactage.a != null ? ` à ${heureCourte(compactage.a)}` : ""} : les ${jusqua} premiers messages. Rémy relit ce résumé, puis la suite en entier.`);
  const courtFil = messages - jusqua <= MESSAGES_GARDES;
  if (automatique === false) bouts.push("Résumé automatique coupé (Réglages) : seulement à la main, ici.");
  else if (j?.fraction != null) {
    if (j.fraction >= SEUIL_COMPACTAGE) {
      bouts.push(courtFil
        ? "70 % atteints, mais le fil est trop court pour être résumé : une nouvelle conversation repartira légère."
        : "70 % atteints : Rémy résume le début du fil juste après sa réponse, sur tes machines. La suivante repartira plus légère.");
    } else {
      const reste = Math.max(1, Math.ceil(Math.round((SEUIL_COMPACTAGE - j.fraction) * 1e9) / 1e7));
      bouts.push(`Résumé automatique à 70 % : encore ${reste} point${reste > 1 ? "s" : ""} avant que Rémy résume le début du fil.`);
    }
  } else bouts.push("Résumé automatique à 70 % de la place, dès qu'elle est mesurée.");
  return bouts.join(" ");
}
/** Après « Compacter maintenant » : ce que dit le bandeau. */
export function phraseCompacte(r) {
  if (r?.compacte) {
    const n = Number(r.resumes ?? r.compactage?.jusqua) || 0;
    return `Rémy a résumé ${n} message${n > 1 ? "s" : ""} : la suite repart plus légère. Rien n'est effacé.`;
  }
  return r?.raison === "rien-a-resumer" ? "Le fil est encore court : rien à résumer." : "Déjà résumé récemment.";
}

// --- Le texte en clair d'une réponse (Markdown.blocs, Markdown.enClair) ---

const estSeparation = (l) => l.includes("-") && (l.includes("|") || l.startsWith(":")) && cellules(l).length > 0 && cellules(l).every((c) => /^:?-+:?$/.test(c));
function cellules(ligne) {
  let t = ligne;
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const sortie = [];
  let courant = "";
  let echappe = false;
  for (const ch of t) {
    if (echappe) {
      courant += ch;
      echappe = false;
    } else if (ch === "\\") echappe = true;
    else if (ch === "|") {
      sortie.push(courant.trim());
      courant = "";
    } else courant += ch;
  }
  sortie.push(courant.trim());
  return sortie;
}

/** Les blocs du markdown de Rémy : titre, paragraphe, puce, numéro, code, tableau, trait, espace. */
export function blocs(texte) {
  const sortie = [];
  let code = null;
  let numero = 0;
  const lignes = String(texte || "").split("\n");
  let i = 0;
  while (i < lignes.length) {
    const brute = lignes[i];
    i += 1;
    const ligne = brute.trim();
    if (code === null && ligne.includes("|") && i < lignes.length && estSeparation(lignes[i].trim())) {
      const entetes = cellules(ligne);
      const rangs = [];
      i += 1;
      while (i < lignes.length) {
        const l = lignes[i].trim();
        if (!l.includes("|") || !l) break;
        const c = cellules(l);
        while (c.length < entetes.length) c.push("");
        rangs.push(c.slice(0, entetes.length));
        i += 1;
      }
      sortie.push({ type: "tableau", entetes, rangs });
      numero = 0;
      continue;
    }
    if (code === null && /^(-{3,}|\*{3,}|_{3,})$/.test(ligne)) {
      sortie.push({ type: "trait" });
      continue;
    }
    if (ligne.startsWith("```")) {
      if (code !== null) {
        sortie.push({ type: "code", texte: code.join("\n") });
        code = null;
      } else code = [];
      continue;
    }
    if (code !== null) {
      code.push(brute);
      continue;
    }
    if (!ligne) {
      if (sortie.length && sortie[sortie.length - 1].type !== "espace") sortie.push({ type: "espace" });
      numero = 0;
      continue;
    }
    let m;
    if ((m = ligne.match(/^#{1,4}\s+/))) sortie.push({ type: "titre", texte: ligne.slice(m[0].length) });
    else if ((m = ligne.match(/^[-•*]\s+/))) sortie.push({ type: "puce", texte: ligne.slice(m[0].length) });
    else if ((m = ligne.match(/^\d+[.)]\s+/))) {
      numero += 1;
      sortie.push({ type: "numero", n: Number(m[0].replace(/\D/g, "")) || numero, texte: ligne.slice(m[0].length) });
    } else if (brute.startsWith("  ") && sortie[sortie.length - 1]?.type === "puce") sortie[sortie.length - 1].texte += ` ${ligne}`;
    else sortie.push({ type: "paragraphe", texte: ligne });
  }
  if (code !== null) sortie.push({ type: "code", texte: code.join("\n") });
  while (sortie.length && sortie[sortie.length - 1].type === "espace") sortie.pop();
  return sortie;
}

/** « **gras** », « *italique* », « `code` », « [lien](url) » → leur texte (le lien réduit à son texte). */
export function sansStyle(t) {
  return String(t)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

/** Le texte tel qu'on le lit, sans la syntaxe : ce que « Copier » met dans le presse-papiers. */
export function enClair(texte) {
  return blocs(texte).map((b) => {
    switch (b.type) {
      case "titre": case "paragraphe": return sansStyle(b.texte);
      case "puce": return `• ${sansStyle(b.texte)}`;
      case "numero": return `${b.n}. ${sansStyle(b.texte)}`;
      case "code": return b.texte;
      case "tableau": return [b.entetes, ...b.rangs].map((r) => r.map(sansStyle).join(" · ")).join("\n");
      case "trait": return "—";
      default: return "";
    }
  }).join("\n");
}
/** Un tableau copié seul : une ligne par rangée, cellules jointes par « | » (TableauRemy.texteBrut). */
export const tableEnTexte = (rangs) => (rangs || []).map((r) => r.join(" | ")).join("\n");
