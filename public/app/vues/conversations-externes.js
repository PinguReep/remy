// Conversations : ce que tu as dit ailleurs (Claude Code, T3 Code, ChatGPT),
// lu et chiffré par la tour (contrat : docs/conversations-externes.md).
// Lecture seule : rien n'est écrit dans les sources, rien ne repart vers un
// service. La recherche est sans IA (mots exacts) et ouvre la conversation AU
// message trouvé. Visible seulement si la tour annonce
// `conversations-externes-v1` (main.js). Les phrases et les chemins viennent
// de analyse/conversations.js (les mêmes mots que l'iPhone, testés en node).
import { api, ecrire, remplacer, supprimer, evenements } from "../api.js";
import { h, vider, icone, bouton, dire, direErreur, squelette, blocErreur, vide, confirmer, occupe, feuille, markdown, jourCourt } from "../ui.js";
import * as C from "../analyse/conversations.js";

const FILTRES = [["", "Toutes"], ...C.SOURCES.map((id) => [id, C.nomSource(id)])];

let racine = null;
let ctx;
let etat = null;
let source = "";
let jour = "";
let jours = null; // [{ jour, conversations }]
let pages = null; // { conversations, suite, total }
let resultats = null; // la recherche en cours
let selection = null; // { source, id, autour }
let lecture = null;
let refs = {};
let minuterieRecherche = null;
let generation = 0; // la dernière liste demandée gagne (filtres touchés vite)

export default {
  async monter(el, args, contexte) {
    racine = el;
    ctx = contexte;
    selection = C.lireRoute(args);
    lecture = null;
    refs = {};
    refs.recherche = h("input", { class: "champ", type: "search", placeholder: "Chercher des mots", title: "Recherche par mots, sans IA", "aria-label": "Chercher dans les conversations externes" });
    refs.recherche.addEventListener("input", () => {
      clearTimeout(minuterieRecherche);
      minuterieRecherche = setTimeout(chercher, 300);
      dessinerCarte();
    });
    refs.filtres = h("div", { class: "rangee serree", role: "radiogroup", "aria-label": "Source" });
    refs.jour = h("select", { class: "champ", "aria-label": "Aller à un jour", title: "Aller à un jour", style: { minHeight: "44px", marginTop: "8px" } }, h("option", { value: "" }, "Tous les jours"));
    refs.jour.hidden = true;
    refs.jour.addEventListener("change", () => {
      jour = refs.jour.value;
      refs.recherche.value = "";
      dessinerCarte();
      chargerListe();
    });
    refs.etat = h("div", { class: "aide", role: "status" });
    refs.carte = h("div");
    refs.liste = h("div", null, squelette([0.8, 0.6, 0.7]));
    refs.detail = h("section", { class: "detail" });
    refs.grille = h("div", { class: "maitre-detail" },
      h("div", { class: "maitre" },
        h("div", { class: "recherche-champ", style: { marginBottom: "10px" } }, icone("recherche"), refs.recherche, h("span", { class: "kbd" }, "/")),
        refs.filtres, refs.jour, h("div", { style: { margin: "8px 0" } }, refs.etat), refs.carte, refs.liste),
      refs.detail);
    vider(el,
      h("header", { class: "entete-ecran" },
        h("div", { class: "titres" }, h("div", { class: "sur-titre" }, "Claude Code · T3 Code · ChatGPT"), h("h1", { class: "titre-ecran" }, "Conversations")),
        h("div", { class: "actions-entete" },
          bouton("Sources", { classe: "papier", icone: "curseurs", titre: "Sources des conversations : lire, couper, importer, effacer", onclick: () => ouvrirSources() }),
          bouton("Lire maintenant", { classe: "plein", icone: "rafraichir", titre: "Relire Claude Code, T3 et les exports ChatGPT sur la tour", onclick: (e) => occupe(e.currentTarget, () => synchroniser(source)) }))),
      refs.grille);
    dessinerFiltres();
    await Promise.all([chargerEtat(), chargerListe(), chargerJours()]);
    dessinerDetail();
  },
  suivre(args) {
    const avant = selection;
    selection = C.lireRoute(args);
    dessinerListe();
    // Même conversation, même message : rien à relire.
    if (avant && selection && avant.source === selection.source && avant.id === selection.id && avant.autour === selection.autour && lecture) return;
    dessinerDetail();
  },
  chercher() {
    refs.recherche?.focus();
  },
  actualiser() {
    chargerEtat();
  },
  demonter() {
    clearTimeout(minuterieRecherche);
    racine = null;
  },
};

const monte = () => Boolean(racine?.isConnected);

function dessinerFiltres() {
  vider(refs.filtres, FILTRES.map(([id, lib]) => {
    const b = h("button", { type: "button", class: "puce", role: "radio", "aria-pressed": String(source === id), "aria-checked": String(source === id) }, lib);
    b.addEventListener("click", () => {
      source = id;
      dessinerFiltres();
      dessinerCarte();
      chargerJours();
      if (refs.recherche.value.trim()) chercher();
      else chargerListe();
    });
    return b;
  }));
}

// --- L'état des sources (sous les filtres) ---
async function chargerEtat() {
  try {
    etat = await api(C.cheminEtat());
    if (monte()) dessinerEtat();
  } catch (err) {
    if (monte()) vider(refs.etat, h("span", { class: "risque" }, icone("alerte"), err.message));
  }
}

function dessinerEtat() {
  if (!etat) return;
  const p = C.probleme(etat);
  const enAttente = C.phraseEnAttente(etat.imports);
  vider(refs.etat,
    p ? h("span", { class: "risque", style: { display: "flex" } }, icone("alerte"), `${p.message}${p.quoiFaire ? ` ${p.quoiFaire}` : ""}`) : C.resumeEtat(etat),
    // Les autres sources en échec (la première est déjà dite).
    (etat.sources || []).filter((s) => s.actif && s.erreur && s.erreur !== p).map((s) => h("span", { class: "risque", style: { display: "flex" } }, icone("alerte"), `${s.nom} : ${s.erreur.message}`)),
    enAttente ? h("span", { style: { display: "block", marginTop: "4px" } }, enAttente) : null);
  dessinerCarte({ forcer: true });
}

// --- La carte « Exporter ChatGPT » (soir du 29/10) ---
// La tour dit quand la montrer (dernier import de plus de 30 jours, ou
// jamais) ; le bouton ouvre la page d'export de ChatGPT (dans l'app de
// bureau : le navigateur par défaut). Rémy ne s'y connecte jamais : le mail
// arrive, tu cliques son lien sur la tour, Rémy prend le .zip dans ses
// Téléchargements ; reçu ailleurs (autre ordinateur), « Importer le .zip ».
// Comme l'iPhone, la carte ne se montre que sur « Toutes » ou ChatGPT, et
// jamais à la place des résultats d'une recherche (contre-relecture du 30/10).
function dessinerCarte({ forcer = false } = {}) {
  if (!refs.carte || !refs.recherche) return;
  const visible = C.carteExportVisible({ source, recherche: refs.recherche.value });
  // Redessinée seulement quand elle apparaît ou disparaît (ou que l'état
  // change) : un import en cours garde sa progression pendant la frappe.
  if (!forcer && refs.carte.dataset.visible === String(visible)) return;
  refs.carte.dataset.visible = String(visible);
  const redessiner = () => dessinerCarte({ forcer: true });
  vider(refs.carte, visible ? [cartesTelechargements(redessiner), carteExport(redessiner)] : null);
}

// --- Un export trouvé dans Téléchargements : « l'importer ? » (revue du 30/10) ---
// Rien de ce qu'un site range dans Téléchargements n'entre sans ce geste.
function cartesTelechargements(dessiner) {
  const liste = C.propositionsTelechargements(etat);
  if (!liste.length) return null;
  return liste.map((p) => {
    const c = C.carteProposition(p);
    const repondre = (importer) => async (e) => occupe(e.currentTarget, async () => {
      try {
        const r = await ecrire(C.cheminReponseTelechargement(), { id: p.id, importer }, { delai: 300000 });
        dire(importer ? `Import ChatGPT : ${C.phraseImport(r?.bilan || {})}` : r?.message || "Pas importé.", { genre: importer ? "succes" : "info", duree: importer ? 7000 : undefined });
        apres(dessiner, r?.etat);
      } catch (err) {
        direErreur(err, importer ? () => repondre(true)({ currentTarget: null }) : null, importer ? "Pas importé" : "Pas enregistré", { rafraichir: () => synchroniser("chatgpt") });
      }
    });
    return h("section", { class: "carte", "aria-label": c.titre, dataset: { carte: "export-trouve" }, style: { margin: "0 0 12px" } },
      h("div", { class: "sur-titre" }, "ChatGPT"),
      h("h3", { class: "carte-titre", style: { margin: "2px 0 6px" } }, c.titre),
      h("p", { style: { margin: "0 0 4px", overflowWrap: "anywhere" } }, c.texte),
      h("p", { class: "aide", style: { margin: "0 0 10px" } }, c.detail),
      h("div", { class: "rangee serree" },
        bouton(c.importer, { classe: "plein", icone: "envoyer", onclick: repondre(true) }),
        bouton(c.refuser, { classe: "papier", onclick: repondre(false) })));
  });
}
function lienExport(libelle, { classe = "plein", lien = C.LIEN_EXPORT_CHATGPT, apres = null } = {}) {
  return h("a", {
    class: `btn ${classe}`,
    href: lien,
    target: "_blank",
    rel: "noopener noreferrer",
    title: "Ouvre ChatGPT › Réglages › Contrôle des données",
    onclick: () => dire(apres || "Dans ChatGPT : Contrôle des données › Exporter les données, puis confirme. Le mail arrive en quelques minutes.", { duree: 9000 }),
  }, icone("externe"), h("span", { class: "lib" }, libelle));
}

function carteExport(dessiner) {
  const c = C.carteExportChatGPT(etat);
  if (!c) return null;
  // Le .zip reçu ailleurs que sur la tour : envoyé d'ici, comme dans Sources.
  const progression = h("div", { class: "aide envoi-export", role: "status", "aria-live": "polite", hidden: true, style: { marginTop: "8px" } },
    h("progress", { max: "1", style: { width: "160px", marginRight: "8px", verticalAlign: "middle" } }), h("span"));
  const fichier = h("input", { type: "file", accept: ".zip,.json,application/zip,application/json", class: "sr", id: "fichier-carte-export", tabindex: "-1" });
  fichier.addEventListener("change", () => {
    importer(fichier.files?.[0], { progression, apres: (r) => apres(null, r?.etat) });
    fichier.value = "";
  });
  return h("section", { class: "carte", "aria-label": c.titre, dataset: { carte: "export-chatgpt" }, style: { margin: "0 0 12px" } },
    h("div", { class: "sur-titre" }, "ChatGPT"),
    h("h3", { class: "carte-titre", style: { margin: "2px 0 6px" } }, c.titre),
    h("p", { style: { margin: "0 0 4px" } }, c.texte),
    h("p", { class: "aide", style: { margin: "0 0 10px" } }, c.detail),
    h("div", { class: "rangee serree" },
      lienExport(c.bouton, { lien: c.lien, apres: c.apresOuverture }),
      h("label", { class: "btn papier", for: "fichier-carte-export", tabindex: "0", role: "button", title: "Envoyer à la tour le .zip reçu par mail", onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fichier.click(); } } }, icone("envoyer"), c.importer || "Importer le .zip"), fichier,
      bouton("Ne plus me le rappeler", { classe: "texte", titre: "Couper ce rappel (il se rallume dans Sources)", onclick: (e) => occupe(e.currentTarget, () => reglerChatGPT({ rappel: false }, "Plus de rappel d'export. Il se rallume dans Sources.", dessiner)) })),
    progression);
}

/** Un réglage de l'import ChatGPT (Téléchargements, rappel) : l'état revient, la vue suit. */
async function reglerChatGPT(changement, phrase, dessiner) {
  try {
    apres(dessiner, await remplacer(C.cheminSource("chatgpt"), changement));
    dire(phrase, { genre: "succes" });
    return true;
  } catch (err) {
    direErreur(err, null, "Réglage pas enregistré");
    return false;
  }
}

// --- Les jours (« Aller à un jour », comme l'iPhone) ---
async function chargerJours() {
  try {
    const r = await api(C.cheminJours({ source: source || null }));
    jours = r?.jours || [];
  } catch {
    jours = null; // le sélecteur se cache : la liste, elle, dit son erreur
  }
  if (!monte()) return;
  if (jour && !(jours || []).some((j) => j.jour === jour)) jour = "";
  vider(refs.jour, h("option", { value: "" }, "Tous les jours"),
    (jours || []).map((j) => h("option", { value: j.jour }, `${C.titreJourIso(j.jour)} · ${j.conversations}`)));
  refs.jour.value = jour;
  refs.jour.hidden = !(jours || []).length;
}

// --- La liste ---
async function chargerListe({ suite = false } = {}) {
  resultats = null;
  const g = ++generation;
  if (!suite) vider(refs.liste, squelette([0.8, 0.6, 0.7, 0.5]));
  try {
    const r = await api(C.cheminListe({ source: source || null, jour: jour || null, decalage: suite ? pages?.suite : null }));
    if (g !== generation || !monte()) return;
    pages = suite && pages ? { ...r, conversations: [...pages.conversations, ...(r.conversations || [])] } : r;
    dessinerListe();
  } catch (err) {
    if (g !== generation || !monte()) return;
    if (suite) {
      direErreur(err, () => chargerListe({ suite: true }));
      return;
    }
    vider(refs.liste, blocErreur(err, () => chargerListe()));
  }
}

async function chercher() {
  const q = refs.recherche.value.trim();
  if (!q) return chargerListe();
  const g = ++generation;
  vider(refs.liste, squelette([0.7, 0.6]));
  try {
    const r = await api(C.cheminRecherche({ q, source: source || null }));
    if (g !== generation || !monte()) return;
    resultats = r?.resultats || [];
    dessinerListe();
  } catch (err) {
    if (g !== generation || !monte()) return;
    vider(refs.liste, blocErreur(err, chercher));
  }
}

function lienConv({ source: src, id, autour = null }, titre, meta, extrait) {
  const courant = selection?.source === src && selection?.id === id && (autour == null || selection?.autour === autour);
  return h("a", { class: "element-maitre", href: `#/${C.route({ source: src, id, autour })}`, "aria-current": courant ? "page" : null, style: { minHeight: "56px", alignItems: "flex-start", padding: "8px 12px" } },
    h("span", { style: { minWidth: 0, flex: 1 } },
      h("span", { class: "t", style: { display: "block" } }, titre || "Sans titre"),
      h("span", { class: "aide", style: { display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, meta),
      extrait ? h("span", { class: "aide", style: { display: "block" } }, extrait) : null));
}

function dessinerListe() {
  if (!refs.grille) return;
  refs.grille.classList.toggle("detail-ouvert", Boolean(selection));
  if (resultats) {
    vider(refs.liste, resultats.length
      ? [h("p", { class: "aide", style: { margin: "0 0 6px" } }, resultats.length === 1 ? "1 message trouvé" : `${resultats.length} messages trouvés`),
        resultats.map((r) => lienConv({ source: r.source, id: r.conversation, autour: r.message }, r.titre,
          `${C.nomSource(r.source)} · ${C.relatif(r.ts)}${r.projet ? ` · ${r.projet.nom}` : ""}`, r.extrait))]
      : vide(null, "Aucun message ne contient ces mots.", source ? bouton("Chercher dans toutes les sources", { classe: "papier petit", onclick: () => { source = ""; dessinerFiltres(); dessinerCarte(); chargerJours(); chercher(); } }) : null));
    return;
  }
  if (!pages) return;
  const convs = pages.conversations || [];
  if (!convs.length) {
    const s = source ? (etat?.sources || []).find((x) => x.id === source) : null;
    const aide = s?.erreur || s?.aide || (etat?.sources || []).map((x) => x.aide).find(Boolean);
    const texte = jour ? "Rien ce jour-là." : aide ? `${aide.message}${aide.quoiFaire ? ` ${aide.quoiFaire}` : ""}` : "« Lire maintenant » relit Claude Code, T3 et les exports ChatGPT sur la tour ; un export ChatGPT s'envoie aussi depuis « Sources ».";
    vider(refs.liste, vide("Rien pour l'instant", texte, bouton("Sources", { classe: "papier", onclick: () => ouvrirSources() })));
    return;
  }
  vider(refs.liste,
    C.parJour(convs).map((g) => [
      h("div", { class: "etat-mono", style: { margin: "12px 0 4px", textTransform: "uppercase" } }, g.titre),
      g.conversations.map((c) => lienConv({ source: c.source, id: c.id }, c.titre, `${C.nomSource(c.source)} · ${C.metaConversation(c)}`)),
    ]),
    pages.suite != null ? bouton(`Plus (${convs.length} sur ${pages.total})`, { classe: "texte petit", onclick: (e) => occupe(e.currentTarget, () => chargerListe({ suite: true })) }) : null);
}

// --- La lecture ---
async function dessinerDetail() {
  if (!refs.detail) return;
  if (!selection) {
    lecture = null;
    vider(refs.detail, h("section", { class: "carte" },
      vide("Choisis une conversation", "Ce que tu as dit à Claude Code, T3 Code ou ChatGPT, lisible ici. Rémy s'en inspire seulement avec le modèle local, et une conversation qui les cite devient privée."),
      digestNuit()));
    return;
  }
  const { source: src, id, autour } = selection;
  vider(refs.detail, h("section", { class: "carte" }, squelette([0.6, 0.9, 0.8, 0.7], true)));
  try {
    const r = await api(C.cheminLecture({ source: src, id, autour }), { delai: 30000 });
    if (selection?.id !== id || selection?.source !== src || !monte()) return;
    lecture = r;
    afficherLecture();
  } catch (err) {
    if (selection?.id !== id || !monte()) return;
    lecture = null;
    const introuvable = err?.statut === 404;
    vider(refs.detail, h("section", { class: "carte" }, retourListe(),
      blocErreur(err, introuvable ? null : dessinerDetail),
      introuvable ? h("p", { class: "aide" }, "Elle a peut-être été effacée, ou sa source coupée puis effacée.") : null));
  }
}

const retourListe = () => h("a", { class: "btn texte petit lien-retour-projets", href: "#/conversations" }, icone("retour"), "Conversations");

function message(m, c, cible) {
  const attrs = { id: `msg-${m.id}`, "data-message": String(m.id), "aria-current": cible ? "true" : null };
  const classeCible = cible ? " msg-cible" : "";
  if (m.auteur === "assistant") {
    return h("div", { ...attrs, class: `msg-remy${classeCible}` },
      h("div", { class: "auteur" }, C.auteur(m, c.assistant), h("span", { class: "aide mono" }, m.ts ? ` ${C.relatif(m.ts)}` : "")),
      h("div", { class: "md", html: markdown(m.texte) }));
  }
  if (m.auteur === "resume") return h("div", { ...attrs, class: `carte-privee${classeCible}` }, h("strong", null, C.auteur(m)), m.texte);
  return h("div", { ...attrs, class: `msg-sam${classeCible}`, style: { maxWidth: "88%" } },
    m.auteur === "colle" ? h("div", { class: "aide", style: { marginBottom: "4px" } }, C.auteur(m)) : null, m.texte);
}

function afficherLecture() {
  const c = lecture.conversation || {};
  const messages = lecture.messages || [];
  const cible = lecture.cible ?? null;
  const depuisLeDebut = cible != null && lecture.avant
    ? bouton("Depuis le début", { classe: "papier petit", icone: "retour", titre: "Relire la conversation depuis son premier message", onclick: () => ctx.aller(C.route({ source: c.source, id: c.id })) })
    : null;
  const plus = lecture.suite != null ? bouton("Suite de la conversation", { classe: "papier", onclick: (e) => occupe(e.currentTarget, async () => {
    try {
      const r = await api(C.cheminLecture({ source: c.source, id: c.id, apres: lecture.suite }), { delai: 30000 });
      lecture = { ...r, cible, avant: lecture.avant, messages: [...messages, ...(r.messages || [])] };
      afficherLecture();
    } catch (err) {
      direErreur(err, null, "Suite pas chargée");
    }
  }) }) : null;
  const n = c.messages ?? messages.length;
  vider(refs.detail, h("section", { class: "carte" },
    retourListe(),
    h("div", { class: "sur-titre" }, [C.nomSource(c.source), C.assistantDistinct(c), c.projet?.nom].filter(Boolean).join(" · ")),
    h("h2", { class: "titre-ecran", style: { fontSize: "26px" } }, c.titre || "Sans titre"),
    h("p", { class: "aide", style: { margin: "4px 0 14px" } }, `${c.debut ? `${jourCourt(c.debut)} · ` : ""}${n === 1 ? "1 message" : `${n} messages`} · lecture seule`),
    depuisLeDebut ? h("div", { class: "rangee", style: { marginBottom: "12px", alignItems: "center" } }, depuisLeDebut, h("span", { class: "aide" }, "Ouverte au message trouvé.")) : null,
    h("div", { class: "colonne", style: { display: "flex", flexDirection: "column", gap: "14px" } }, messages.map((m) => message(m, c, m.id === cible))),
    plus ? h("div", { class: "rangee", style: { marginTop: "14px" } }, plus) : null));
  if (cible != null) requestAnimationFrame(() => refs.detail?.querySelector(".msg-cible")?.scrollIntoView({ block: "center" }));
}

function digestNuit() {
  const zone = h("div", { style: { marginTop: "16px" } });
  const sous = (texte) => h("div", { class: "etat-mono", style: { marginTop: "10px" } }, texte);
  api(C.cheminNuit()).then((r) => {
    const d = r?.digest;
    if (!d || !zone.isConnected) return;
    const hier = C.titreJourIso(d.jour) === "Hier";
    vider(zone, h("h3", { class: "titre-section" }, `Cette nuit · conversations ${hier ? "d'hier" : `du ${jourCourt(new Date(`${d.jour}T12:00:00`).getTime())}`}`),
      d.ligne ? h("p", { class: "carte-titre" }, d.ligne) : null,
      d.themes?.length ? h("div", { class: "rangee serree", style: { marginTop: "8px" } }, d.themes.map((t) => h("span", { class: "puce" }, t))) : null,
      d.decisions?.length ? [sous("DÉCISIONS"), h("ul", { style: { margin: "6px 0 0 18px" } }, d.decisions.map((x) => h("li", null, x)))] : null,
      d.aFaire?.length ? [sous("À FAIRE"), h("ul", { class: "liste" }, d.aFaire.map((x) => h("li", { class: "ligne" },
        h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, x.texte), x.source ? h("div", { class: "meta" }, x.source) : null),
        bouton("Noter", { classe: "papier petit", icone: "plus", onclick: () => ctx.noter(x.texte) }))))] : null,
      h("p", { class: "aide", style: { marginTop: "8px" } }, "Des propositions, tirées par le modèle local : rien n'est fait seul."));
  }).catch(() => {});
  return zone;
}

// --- Les gestes ---
async function synchroniser(src = "") {
  try {
    const r = await ecrire(C.cheminSynchro(), C.corpsSynchro(src), { delai: 300000 });
    const p = C.phraseSynchro(r);
    dire(p.texte, { genre: p.erreur ? "erreur" : "succes" });
    if (r?.etat) etat = r.etat;
    rafraichirVue();
    return r;
  } catch (err) {
    direErreur(err, null, "Pas relu");
    return null;
  }
}

/** Après un geste (import, effacement, lecture) : l'état, les jours, la liste. */
function rafraichirVue() {
  if (!monte()) return;
  dessinerEtat();
  chargerEtat();
  chargerJours();
  if (refs.recherche.value.trim()) chercher();
  else chargerListe();
  if (selection) dessinerDetail();
}

function ouvrirSources() {
  const contenu = h("div", null, squelette([0.6, 0.8]));
  const f = feuille({ titre: "Sources des conversations", sousTitre: "La tour lit, chiffre, n'écrit jamais dans les originaux.", large: true, contenu });
  dessinerSources(contenu);
  return f;
}

// --- Les sources : lire, couper, effacer ; importer un export ChatGPT ---
/**
 * Dessine les sources dans `conteneur` — la feuille « Sources » de cette vue,
 * ou Réglages › Sources des conversations — et les tient à jour après chaque geste.
 */
export async function dessinerSources(conteneur) {
  const dessiner = async () => {
    try {
      etat = await api(C.cheminEtat());
    } catch (err) {
      vider(conteneur, blocErreur(err, dessiner));
      return;
    }
    vider(conteneur, contenuSources(dessiner));
  };
  vider(conteneur, squelette([0.6, 0.8]));
  await dessiner();
}

function apres(dessiner, nouvelEtat) {
  if (nouvelEtat) etat = nouvelEtat;
  dessiner?.();
  rafraichirVue();
}

function contenuSources(dessiner) {
  const usage = etat.usage || {};
  const basculeUsage = (cle, titre, detail) => {
    const i = h("input", { type: "checkbox", role: "switch", disabled: usage.forceParLaTour, "aria-label": titre });
    i.checked = usage[cle] === true;
    i.addEventListener("change", async () => {
      i.disabled = true;
      try {
        apres(dessiner, await remplacer(C.cheminUsage(), { [cle]: i.checked }));
        dire(`${titre} : ${i.checked ? "allumé" : "coupé"}.`, { genre: "succes" });
      } catch (err) {
        i.checked = !i.checked;
        i.disabled = Boolean(usage.forceParLaTour);
        direErreur(err, null, "Réglage pas enregistré");
      }
    });
    return h("label", { class: "bascule reglage" }, h("span", { class: "textes" }, h("strong", null, titre), h("span", null, detail)), i);
  };
  const cle = etat.cle || {};
  return [
    (etat.sources || []).map((s) => blocSource(s, dessiner)),
    h("h3", { class: "titre-section", style: { marginTop: "16px" } }, "Ce que Rémy en fait"),
    basculeUsage("chat", "S'en inspirer dans ses réponses", "Quand ta question en parle, le modèle local en relit quelques passages ; la conversation devient privée (jamais Claude)."),
    basculeUsage("nuit", "Relire celles de la veille, la nuit", "Thèmes, décisions, choses à faire : des propositions, et une ligne dans ton briefing. Modèle local seulement."),
    usage.forceParLaTour ? h("p", { class: "aide" }, "Coupé sur la tour (REMY_CONVERSATIONS_USAGE=off).") : null,
    h("h3", { class: "titre-section", style: { marginTop: "16px" } }, "Vie privée"),
    h("p", { class: "aide" }, `Chiffré sur ta tour${cle.emplacement ? ` (clé : ${cle.emplacement}, hors du coffre)` : ""}. Rien ne repart vers Claude ni OpenAI : la lecture est à sens unique, et les secrets (clés, mots de passe) sont masqués avant d'être gardés.`),
    cle.erreur ? h("p", { class: "risque", style: { display: "flex" } }, icone("alerte"), `${cle.erreur.message}${cle.erreur.quoiFaire ? ` ${cle.erreur.quoiFaire}` : ""}`) : null,
    h("div", { class: "rangee", style: { marginTop: "8px" } }, bouton("Tout effacer de la tour", { classe: "danger", icone: "corbeille", onclick: async (e) => {
      if (!(await confirmer("Tout effacer ?", { detail: "Utile si la clé a changé. « Lire maintenant » relira Claude Code et T3 ; un export ChatGPT se réenvoie. Tes conversations d'origine ne sont pas touchées.", libelle: "Tout effacer", danger: true }))) return;
      await occupe(e.currentTarget, async () => {
        try {
          const r = await supprimer(C.cheminToutEffacer(), { delai: 120000 });
          dire(r?.message || "Effacé de la tour.", { genre: "succes" });
          apres(dessiner, r?.etat);
        } catch (err) {
          direErreur(err, null, "Rien d'effacé");
        }
      });
    } })),
  ];
}

function blocSource(s, dessiner) {
  const i = h("input", { type: "checkbox", role: "switch", disabled: s.forceParLaTour, "aria-label": s.id === "chatgpt" ? "Importer ChatGPT" : `Lire ${s.nom}` });
  i.checked = Boolean(s.actif);
  i.addEventListener("change", async () => {
    i.disabled = true;
    try {
      apres(dessiner, await remplacer(C.cheminSource(s.id), { actif: i.checked }));
      dire(`${s.nom} : ${i.checked ? "allumée" : "coupée"}.`, { genre: "succes" });
    } catch (err) {
      i.checked = !i.checked;
      i.disabled = Boolean(s.forceParLaTour);
      direErreur(err, null, "Réglage pas enregistré");
    }
  });
  const quoiFaire = C.quoiFaireSource(s);
  const progression = h("div", { class: "aide envoi-export", role: "status", "aria-live": "polite", hidden: true },
    h("progress", { max: "1", style: { width: "160px", marginRight: "8px", verticalAlign: "middle" } }), h("span"));
  const fichier = h("input", { type: "file", accept: ".zip,.json,application/zip,application/json", class: "sr", id: `fichier-${s.id}`, tabindex: "-1" });
  fichier.addEventListener("change", () => {
    const f = fichier.files?.[0];
    importer(f, { progression, apres: (r) => apres(dessiner, r?.etat) });
    fichier.value = "";
  });
  const originaux = s.id === "chatgpt" ? C.phraseOriginaux(etat?.imports?.originaux) : null;
  const enAttente = s.id === "chatgpt" ? C.phraseEnAttente(etat?.imports) : null;
  const recensement = C.phraseRecensement(s);
  return h("div", { class: "reglage", dataset: { source: s.id } },
    h("label", { class: "bascule" }, h("span", { class: "textes" }, h("strong", null, s.nom),
      h("span", { style: s.erreur ? { color: "var(--danger)" } : null }, C.phraseSource(s))), i),
    recensement && recensement !== C.phraseSource(s) ? h("p", { class: "aide", dataset: { recensement: s.id } }, recensement) : null,
    quoiFaire ? h("p", { class: "aide" }, quoiFaire) : null,
    s.emplacements?.length ? h("div", { class: "aide mono", "aria-label": "Où la tour cherche", style: { fontSize: "11px", margin: "4px 0" } },
      s.emplacements.map((l) => h("div", { style: { overflowWrap: "anywhere" } }, `${l.trouve ? "✓" : "–"} ${l.chemin}  (${l.origine})`))) : null,
    s.id === "chatgpt" ? [
      h("div", { class: "rangee serree", style: { marginTop: "6px" } },
        h("label", { class: "btn papier", for: `fichier-${s.id}`, tabindex: "0", role: "button", onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fichier.click(); } } }, icone("envoyer"), "Importer un export ChatGPT"), fichier),
      progression,
      // La tour dit déjà comment faire (aide.quoiFaire) : pas deux fois.
      quoiFaire ? null : h("p", { class: "aide" }, "Dans ChatGPT : Réglages › Contrôle des données › Exporter. Choisis ici le .zip reçu par mail (ou dépose-le dans le dossier Imports de ton coffre)."),
      originaux ? h("p", { class: "aide" }, originaux) : null,
      enAttente ? h("p", { class: "aide" }, enAttente) : null,
      cartesTelechargements(dessiner),
      reglagesChatGPT(dessiner),
    ] : null,
    h("div", { class: "rangee serree", style: { marginTop: "6px" } },
      s.actif ? bouton("Lire maintenant", { classe: "papier petit", icone: "rafraichir", titre: s.id === "chatgpt" ? "Relire le dossier Imports et Téléchargements sur la tour" : `Relire ${s.nom} sur la tour`, onclick: (e) => occupe(e.currentTarget, async () => {
        // synchroniser rafraîchit déjà la vue ; ici, la source elle-même.
        if (await synchroniser(s.id)) dessiner();
      }) }) : null,
      (s.conversations ?? 0) > 0 ? bouton("Effacer ce que Rémy en a gardé", { classe: "texte petit", icone: "corbeille", onclick: async (e) => {
        if (!(await confirmer(`Effacer ${s.nom} de la tour ?`, { detail: s.id === "chatgpt" ? "Les conversations importées et ce que la nuit en a tiré. Ton compte ChatGPT n'est pas touché." : `Ce que la tour en a lu, et ce que la nuit en a tiré ; la lecture est coupée. Tes conversations dans ${s.nom} ne sont pas touchées.`, libelle: "Effacer", danger: true }))) return;
        await occupe(e.currentTarget, async () => {
          try {
            const r = await supprimer(C.cheminSource(s.id), { delai: 120000 });
            dire(r?.message || "Effacé de la tour.", { genre: "succes" });
            apres(dessiner, r?.etat);
          } catch (err) {
            direErreur(err, null, "Rien d'effacé");
          }
        });
      } }) : null));
}

// Les deux réglages de l'import ChatGPT, et le lien vers son export. Une tour
// plus ancienne ne les connaît pas (pas de `chatgpt` dans l'état) : rien.
function reglagesChatGPT(dessiner) {
  const t = C.telechargements(etat);
  const r = etat?.chatgpt?.rappel;
  if (!t && !r) return null;
  const bascule = (cle, titre, detail, actif, force = false) => {
    const i = h("input", { type: "checkbox", role: "switch", disabled: force, "aria-label": titre });
    i.checked = Boolean(actif);
    i.addEventListener("change", async () => {
      i.disabled = true;
      const oui = i.checked;
      const phrase = cle === "telechargements"
        ? (oui ? "Rémy prend de nouveau l'export ChatGPT dans Téléchargements." : "Téléchargements n'est plus surveillé : envoie l'export depuis « Importer ».")
        : (oui ? "Rappel d'export allumé : une carte quand ton dernier export a plus de 30 jours." : "Plus de rappel d'export.");
      if (!(await reglerChatGPT({ [cle]: oui }, phrase, dessiner))) {
        i.checked = !oui;
        i.disabled = force;
      }
    });
    return h("label", { class: "bascule reglage", dataset: { reglage: cle } }, h("span", { class: "textes" }, h("strong", null, titre), h("span", null, detail)), i);
  };
  return [
    t ? bascule("telechargements", "Prendre l'export dans Téléchargements", C.phraseTelechargements(t), t.actif, t.forceParLaTour) : null,
    r ? bascule("rappel", "Me rappeler d'exporter ChatGPT", "Une carte quand ton dernier export a plus de 30 jours : un bouton ouvre ChatGPT ; tu cliques le lien du mail sur la tour, Rémy fait le reste.", r.actif) : null,
    // Suivi de la rangée « Lire maintenant » : 10 px entre les deux, sinon leurs zones de 46 px se chevauchent (42 px).
    h("div", { class: "rangee serree", style: { marginTop: "6px", paddingBottom: "4px" } }, lienExport("Demander un export à ChatGPT", { classe: "papier petit", lien: r?.lien || C.LIEN_EXPORT_CHATGPT })),
  ];
}

/**
 * L'export ChatGPT part en corps brut (XHR, pour suivre l'envoi d'un gros
 * .zip : la tour allonge son délai le temps de l'envoi). La progression
 * s'affiche dans la source ChatGPT ; le bilan, dans un bandeau.
 */
function importer(fichier, { progression, apres: ensuite } = {}) {
  if (!fichier) return;
  if (!C.importable(fichier.name)) {
    dire("Ce fichier n'est pas un export ChatGPT : choisis le .zip reçu par mail (ou conversations.json).", { genre: "erreur" });
    return;
  }
  const barre = progression?.querySelector("progress");
  const texte = progression?.querySelector("span");
  const montrer = (p) => {
    if (!progression) return;
    progression.hidden = false;
    if (barre) {
      if (p == null) barre.removeAttribute("value");
      else barre.value = p;
    }
    if (texte) texte.textContent = `« ${fichier.name} » : ${C.libelleEnvoi(p)}`;
  };
  montrer(null);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", C.cheminImport());
  xhr.setRequestHeader("Content-Type", C.typeFichier(fichier.name));
  xhr.setRequestHeader("Accept", "application/json");
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable && e.total) montrer(Math.min(1, e.loaded / e.total));
  };
  xhr.upload.onload = () => montrer(1);
  const finir = () => {
    if (progression) progression.hidden = true;
  };
  xhr.onload = () => {
    finir();
    let d = null;
    try { d = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status >= 200 && xhr.status < 300 && d?.bilan) {
      dire(`Import ChatGPT : ${C.phraseImport(d.bilan)}`, { genre: "succes", duree: 7000 });
      ensuite?.(d);
    } else if (xhr.status === 401) {
      evenements.dispatchEvent(new CustomEvent("session-perdue"));
      dire("Ta session a expiré : reconnecte-toi, puis renvoie l'export.", { genre: "erreur" });
    } else {
      dire(C.erreurImport(xhr.status, d), { genre: "erreur" });
    }
  };
  xhr.onerror = () => {
    finir();
    dire(C.erreurImport(0), { genre: "erreur" });
  };
  xhr.send(fichier);
}
