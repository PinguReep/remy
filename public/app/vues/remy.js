// Rémy : les conversations, le fil, et à droite la jauge du contexte,
// « Compacter » et les étapes de la réponse. Les mêmes gestes et les mêmes
// mots que l'iPhone (RemyView.swift, ChatModel) : écran vide avec ses
// suggestions, conversation privée (puce « Privée » avant le premier message,
// « Rendre privée » sans retour, brouillon privé gardé à part), file
// « Envoyer après » qui part en un seul message et ne se perd jamais,
// « Rémy répond encore » (interrompre ou envoyer après), reprise d'une réponse
// qui s'écrit encore sur la tour, menus au clic droit (l'appui long), fil
// importé en lecture seule, jauge détaillée et résumé du début du fil.
// Les cartes de proposition, Retenir (long texte), la dictée et l'appel
// viennent des modules du lot « noter », chargés par import() (contrat D) :
// absents, la vue le dit et le texte de Sam reste.
// Aucun message ne part sans un geste : une question préparée attend dans le
// champ, Entrée l'envoie. Les calculs sont dans ../analyse/remy.js (testés).
import { api, ecrire, flux, seg, sait, evenements, nouvelId } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, texteErreur, squelette, blocErreur, vide, feuille, confirmer, demanderTexte, markdown, sansMarqueurs, occupe, local, kbd } from "../ui.js";
import { surMenu, ouvrirMenu } from "../menu.js";
import { questionEnAttente } from "./noter.js";
import { etatRecherchePrivee, sousTitrePrivee, ceQueCaChange, confirmationPrivee } from "../analyse/privee.js";
import * as R from "../analyse/remy.js";
import * as nonLus from "../non-lus.js";

// Les modules des autres lots : toujours par import(), jamais en statique
// (absents avant la fusion, un import statique manquant casserait la vue).
const MODULES = { propositions: "./propositions.js", retenir: "./retenir.js", appel: "./appel.js", dictee: "../dictee.js" };
const charger = (nom) => import(MODULES[nom]);
const FENETRE_ABSENTE = "Cette fenêtre n'a pas pu se charger : recharge la page (Ctrl+R).";
const PROPOSITION_ABSENTE = "Cette proposition n'a pas pu s'afficher : recharge la page (Ctrl+R).";
const OCCUPE = "Rémy finit sa réponse, réessaie dans un instant.";
const IMPORTEE = "Conversation importée : touche « Continuer avec Rémy » pour lui en parler.";
const PAS_DE_MEMOIRE = "Conversation privée : rien n'entre dans la mémoire. Ouvre une conversation ordinaire pour noter une idée.";
const REVENU = "Ton message n'est pas parti : tu as changé de conversation. Il est revenu dans le champ.";
const REVENU_QUITTE = "Ton message n'est pas parti : tu as quitté Rémy. Il est revenu dans le champ.";
const REVENU_ICI = "Ton message n'est pas parti : il est revenu dans le champ.";
const FIL_ABSENT = "Cette conversation n'existe plus : ouvre-en une nouvelle, ton message t'y attendra.";
const FIL_ILLISIBLE = "Cette conversation n'a pas pu se charger : touche « Réessayer ». Ton message reste dans le champ.";
const TRANSCRIPTION = "Je transcris ta voix sur la tour…";
// La relecture d'une réponse qui s'écrit encore sur la tour (ChatModel.recuperer).
const PAS_RECUPERATION = 4000;
const ESSAIS_RECUPERATION = 37;

let racine;
let ctx;
let refs = {};
let liste = null; // les résumés de la tour (GET /api/conversations)
let erreurListe = false;
let filtre = "";
let courante = null; // la conversation ouverte (objet de la tour) ou { nouvelle: true, prive }
let envoi = null; // { convId, ctrl, bloc, ligne, gen, creation?, reprise? } : la réponse en cours ICI
let generation = 0; // change à chaque changement de fil : un flux d'avant ne touche plus rien
let file = []; // « Envoyer après » : les messages tapés pendant la réponse de ce fil
let arretEnCours = false;
// Ce qui est tapé et pas envoyé, par fil (« nouvelle » et « nouvelle-privee »
// sont distinctes) ; le brouillon d'une privée quittée pour un fil ordinaire
// va à part, en mémoire seulement (jamais dans localStorage).
const brouillons = new Map();
let brouillonPrive = "";
const revenus = new Map(); // fils où un message est revenu dans le champ → la phrase du bandeau au retour
let modeRetenir = false;
let enCapture = false;
let miseEnPrive = false;
let compactageEnCours = false;
let etatPrivee = "inconnu";
let autoCompactage = null; // circuits.compactage.actif (GET /api/reglages)
let setup = null; // GET /api/setup (« Faire connaissance »)
let setupDemande = false;
let modProps; // le module des propositions (null : absent)
let modDictee = null;
let dicteeEnCours = null;
let etatDictee = "repos"; // surEtat du module : « enregistrement », « transcription », « repos »
let transcriptionDispo = null; // GET /api/transcribe : false si aucun moteur sur la tour
const groupesOuverts = new Set();
let activite = null; // le dernier geste sur le fil ouvert (ouvert, message envoyé)
let derniereQuitte = null;
let tic = null;
let suiviComposeur = null;
let placerBandeauxRemy = () => {};
let selectionDictee = null;

const cleDe = (c) => (c?.id ? c.id : c?.nouvelle && c.prive ? "nouvelle-privee" : "nouvelle");
const composeurPrive = (c) => Boolean(c?.prive) && !c?.origine;
const jaugeVisible = () => sait("jauge-v1") && local.lire("diagnostic.jauge", true) !== false;
const vitesseVisible = () => local.lire("diagnostic.vitesse", false) === true;
const colonne = () => refs.messages?.querySelector(".colonne");
const panneauVisible = () => matchMedia("(min-width: 1361px)").matches || refs.racine?.classList.contains("panneau-ouvert");
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const signalerSujets = (detail) => evenements.dispatchEvent(new CustomEvent("remy:sujets", { detail }));
const messagesTour = (c) => (c?.messages || []).filter((m) => !m._local);
// Le champ à l'écran : une vue démontée garde ses refs, détachées du document.
const champVivant = () => Boolean(refs.champ?.isConnected);

// Ce que la conversation privée peut promettre (Privee.swift) et si le résumé
// automatique est allumé : lus sur la tour à l'ouverture et au retour.
async function lireReglages() {
  if (!sait("recherche-privee-v1")) etatPrivee = "sansReglage";
  if (!sait("reglages")) return;
  let r;
  try {
    r = await api("/api/reglages", { delai: 10000 });
  } catch {
    return; // on garde ce qu'on savait (« inconnu » : aucune promesse de trop)
  }
  if (sait("recherche-privee-v1")) etatPrivee = etatRecherchePrivee(r);
  autoCompactage = typeof r?.circuits?.compactage?.actif === "boolean" ? r.circuits.compactage.actif : null;
  if (!refs.racine?.isConnected) return;
  dessinerEnTete();
  dessinerPanneau();
  if (courante?.prive && !courante.messages?.length) dessinerFil();
}

export default {
  async monter(el, args, contexte) {
    racine = el;
    ctx = contexte;
    courante = null;
    envoi = null;
    file = [];
    modeRetenir = false;
    etatDictee = "repos";
    construire();
    lireReglages();
    // Les cartes de proposition (lot « noter ») : chargées une fois.
    const props = modProps !== undefined ? Promise.resolve(modProps) : charger("propositions").catch((err) => {
      console.warn("Propositions indisponibles :", err?.message || err);
      return null;
    });
    const [, mp] = await Promise.all([chargerListe(), props]);
    modProps = mp;
    // Revenir sur un fil quitté un autre jour : l'écran vide plutôt que le fil d'hier.
    let cible = args[0] || null;
    if (cible && cible !== "nouvelle" && derniereQuitte?.id === cible && R.aRefermer(derniereQuitte.a) && !brouillons.get(cible)) {
      cible = null;
      history.replaceState(null, "", "#/remy");
    }
    await ouvrir(cible, { premier: true });
  },
  suivre(args) {
    const voulu = args[0] || null;
    const actuel = courante?.id || (courante?.nouvelle ? "nouvelle" : null);
    if (voulu === actuel && voulu !== "nouvelle") {
      // Déjà là (peut-être en pleine réponse) : seulement ce qu'on y envoie.
      if (voulu) consommerEntrees(voulu);
      return;
    }
    ouvrir(voulu);
  },
  demonter() {
    // La file et le champ restent attachés à leur fil, en mémoire.
    quitterFil({ versPrive: true });
    derniereQuitte = courante?.id ? { id: courante.id, a: activite } : null;
    arreterFlux();
    // Plus aucun fil à l'écran : ce qui finit après (une création de
    // conversation, une dictée) rend son texte aux brouillons, pas au champ détaché.
    courante = null;
    dicteeEnCours?.arreter?.();
    dicteeEnCours = null;
    etatDictee = "repos";
    clearInterval(tic);
    tic = null;
    suiviComposeur?.disconnect();
    suiviComposeur = null;
    window.removeEventListener("resize", placerBandeauxRemy);
    document.removeEventListener("selectionchange", majCorrection);
    document.documentElement.style.removeProperty("--bas-bandeaux");
  },
  chercher() {
    refs.recherche?.focus();
  },
  actualiser() {
    // Un fil laissé ouvert depuis un autre jour : la question suivante ne
    // tombera pas dans une conversation sans rapport. Rien n'est supprimé.
    if (courante?.id && !envoi && !file.length && !refs.champ?.value.trim() && !courante.origine && R.aRefermer(activite)) {
      ctx.aller("remy");
      return;
    }
    chargerListe();
    lireReglages();
    if (courante?.id && !envoi) recharger(courante.id, { fond: true });
  },
};

// --- Charpente ---
function construire() {
  refs = {};
  refs.recherche = h("input", { class: "champ", type: "search", placeholder: "Chercher une conversation", "aria-label": "Chercher une conversation", oninput: (e) => { filtre = e.target.value; dessinerListe(); } });
  refs.liste = h("nav", { class: "defile", "aria-label": "Conversations" }, squelette([0.8, 0.6, 0.7, 0.5]));
  refs.titre = h("h1", { class: "titre-fil" }, "Rémy");
  refs.marque = h("span", { class: "marque-r", "aria-hidden": "true", style: { width: "32px", height: "32px", fontSize: "17px", flex: "none" } }, "R");
  refs.cadenas = h("button", { type: "button", class: "puce remy-puce-privee-tete", hidden: true, onclick: feuillePrivee });
  refs.actionsFil = h("div", { class: "rangee serree remy-actions-fil" });
  refs.valeurJauge = h("span", { class: "mono remy-jauge-court", hidden: true });
  refs.btnPanneau = h("button", { type: "button", class: "btn texte btn-panneau remy-btn-jauge", "aria-label": "Contexte et étapes", title: "Contexte et étapes", onclick: basculerPanneau }, icone("jauge"), refs.valeurJauge);
  refs.session = h("div", { class: "remy-session", hidden: true });
  refs.messages = h("div", { class: "fil-messages", tabindex: "-1" });
  refs.champ = h("textarea", { rows: 1, placeholder: "Écris à Rémy…", "aria-label": "Message à Rémy" });
  refs.envoyer = bouton("", { classe: "plein icone", icone: "envoyer", etiquette: "Envoyer (Entrée)", titre: "Envoyer (Entrée)" });
  refs.retenir = bouton("Retenir", { classe: "plein remy-retenir", titre: "Rémy la retient, sans répondre (Entrée)" });
  refs.retenir.hidden = true;
  refs.micro = bouton("", { classe: "texte icone", icone: "micro", etiquette: "Dicter", titre: "Dicter (l'audio est transcrit sur ta tour, puis effacé)" });
  refs.stop = bouton("Interrompre", { classe: "papier petit", icone: "stop", titre: "Interrompre la réponse (Échap)" });
  refs.stop.hidden = true;
  refs.corriger = bouton("Corriger la dictée", { classe: "texte petit", icone: "crayon", titre: "Le mot surligné a été mal transcrit : Dictée Locale apprendra le bon" });
  refs.corriger.hidden = true;
  refs.pucePrivee = h("button", { type: "button", class: "puce remy-puce-privee", "aria-pressed": "false", title: "Rien ne part chez Claude : le modèle local de ta tour répond" }, icone("cadenas-ouvert"), h("span", null, "Privée"));
  refs.bandes = h("div", { class: "remy-bandes" });
  refs.vocaux = h("div", { class: "remy-vocaux" });
  refs.aideEnvoi = h("span", null, " envoie");
  refs.boite = h("div", { class: "boite" }, refs.champ, refs.micro, refs.envoyer, refs.retenir);
  refs.panneau = h("aside", { class: "remy-panneau", "aria-label": "Contexte et étapes", tabindex: "-1" });
  refs.composeur = h("div", { class: "composeur" }, h("div", { class: "colonne" },
    refs.bandes, refs.vocaux,
    h("div", { class: "rangee serree remy-rangee-composeur" }, refs.pucePrivee, refs.stop, refs.corriger),
    refs.boite,
    h("div", { class: "aide-clavier" }, h("span", null, kbd("Entrée"), refs.aideEnvoi), h("span", null, kbd("Maj"), " ", kbd("Entrée"), " à la ligne"), h("span", null, kbd("Échap"), " interrompt"))));
  refs.importee = h("div", { class: "composeur remy-importee", hidden: true });
  const nouvelle = bouton("Nouvelle", { classe: "plein petit", icone: "plus", titre: "Nouvelle conversation", onclick: () => ctx.aller("remy/nouvelle") });
  const privee = bouton("", { classe: "papier petit icone", icone: "cadenas", etiquette: "Nouvelle conversation privée", titre: "Nouvelle conversation privée", onclick: nouvellePrivee });
  refs.retour = h("a", { class: "btn texte icone lien-retour", href: "#/remy", "aria-label": "Toutes les conversations" }, icone("retour"));
  refs.racine = h("div", { class: "remy" },
    h("section", { class: "remy-liste" },
      h("div", { class: "tete-liste" }, h("div", { class: "rangee", style: { justifyContent: "space-between" } }, h("h1", null, "Rémy"), h("div", { class: "rangee serree" }, privee, nouvelle)),
        h("div", { class: "recherche-champ" }, icone("recherche"), refs.recherche, h("span", { class: "kbd" }, "/"))),
      refs.liste),
    h("section", { class: "remy-fil" },
      h("header", { class: "fil-tete" }, refs.retour, refs.marque, refs.titre, refs.cadenas, refs.actionsFil, refs.btnPanneau),
      refs.session, refs.messages, refs.composeur, refs.importee),
    refs.panneau);
  vider(racine, refs.racine);
  // Les bandeaux se posent au-dessus du composeur, jamais sur le champ.
  placerBandeauxRemy = () => {
    const zone = refs.composeur.hidden ? refs.importee : refs.composeur;
    const r = zone.getBoundingClientRect();
    if (r.height) document.documentElement.style.setProperty("--bas-bandeaux", `${Math.round(window.innerHeight - r.top + 12)}px`);
  };
  suiviComposeur?.disconnect();
  suiviComposeur = typeof ResizeObserver === "function" ? new ResizeObserver(() => placerBandeauxRemy()) : null;
  suiviComposeur?.observe(refs.composeur);
  suiviComposeur?.observe(refs.importee);
  window.addEventListener("resize", placerBandeauxRemy);
  placerBandeauxRemy();

  refs.champ.addEventListener("input", () => {
    ajusterChamp();
    majBoutonRetenir();
    majCorrection();
  });
  refs.champ.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      soumettre();
    } else if (e.key === "Escape" && envoi) {
      e.preventDefault();
      interrompre();
    }
  });
  for (const ev of ["select", "keyup", "mouseup", "focus"]) refs.champ.addEventListener(ev, majCorrection);
  document.addEventListener("selectionchange", majCorrection);
  // Clic droit sur un mot surligné : « Corriger la dictée » en tête.
  surMenu(refs.champ, () => {
    const s = selectionChamp();
    if (!s) return [];
    return [
      sait("dictee-correction-v1") ? { libelle: "Corriger la dictée", icone: "micro", faire: () => corrigerDictee(s) } : null,
      { libelle: "Copier", icone: "copier", faire: () => copier(s.entendu) },
      { libelle: "Couper", icone: "fermer", faire: () => copier(s.entendu).then((ok) => ok && remplacerDansChamp(s, "")) },
    ];
  }, { titre: "Texte sélectionné" });
  refs.envoyer.addEventListener("click", soumettre);
  refs.retenir.addEventListener("click", retenir);
  refs.stop.addEventListener("click", () => interrompre());
  refs.micro.addEventListener("click", (e) => occupe(e.currentTarget, dicter));
  refs.corriger.addEventListener("mousedown", (e) => e.preventDefault()); // la sélection reste
  refs.corriger.addEventListener("click", () => {
    const s = selectionDictee || selectionChamp();
    if (s) corrigerDictee(s);
  });
  refs.pucePrivee.addEventListener("click", () => basculerPrivee());
  refs.panneau.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && refs.racine.classList.contains("panneau-ouvert") && !matchMedia("(min-width: 1361px)").matches) {
      e.preventDefault();
      basculerPanneau();
      refs.btnPanneau.focus();
    }
  });
}

function basculerPanneau() {
  const ouvert = refs.racine.classList.toggle("panneau-ouvert");
  if (ouvert) {
    dessinerPanneau();
    refs.panneau.focus();
    relireCompactage();
  }
}

function ajusterChamp() {
  const c = refs.champ;
  c.style.height = "auto";
  c.style.height = `${Math.min(240, c.scrollHeight)}px`;
}
function mettreAuChamp(texte) {
  refs.champ.value = texte;
  ajusterChamp();
  majBoutonRetenir();
  majCorrection();
}

// --- Liste des conversations ---
async function chargerListe() {
  try {
    const l = await api("/api/conversations");
    liste = Array.isArray(l) ? l : [];
    erreurListe = false;
    nonLus.initialiser(liste);
    // Le fil à l'écran est vu (iPhone : marquerVu).
    const ouvert = courante?.id && liste.find((x) => x.id === courante.id);
    if (ouvert && document.visibilityState !== "hidden") nonLus.marquerLu(ouvert);
    nonLus.maj(liste);
    dessinerListe();
    if (!courante || (courante.nouvelle && !courante.messages?.length && !envoi)) dessinerFil();
  } catch (err) {
    erreurListe = true;
    if (!liste) vider(refs.liste, blocErreur(err, chargerListe));
    else direErreur(err, chargerListe, "Liste des conversations");
  }
}

function optionsNonLu() {
  return { lus: nonLus.lus(), ouvert: courante?.id || null, capacite: sait("non-lus-v1") };
}

function dessinerListe() {
  if (!liste || !refs.liste) return;
  const f = filtre.trim();
  if (f) {
    const trouves = R.chercherFils(liste, f);
    vider(refs.liste, trouves.length ? trouves.map(ligneConv) : h("p", { class: "remy-liste-vide" }, "Aucune conversation ne s'appelle comme ça."));
    return;
  }
  if (!liste.length) {
    vider(refs.liste, h("p", { class: "remy-liste-vide" }, "Aucune conversation pour l'instant."));
    return;
  }
  const o = R.organiserListe(liste);
  vider(refs.liste,
    o.sections.map((s) => [
      h("div", { class: "conv-groupe" }, s.titre, h("span", { class: "compte" }, String(s.conversations.length))),
      s.conversations.map(ligneConv),
    ]),
    o.groupes.map((g) => {
      const ouvert = groupesOuverts.has(g.cle);
      const b = h("button", { type: "button", class: "remy-groupe", "aria-expanded": String(ouvert) }, icone("chevron"), h("span", null, g.titre));
      b.addEventListener("click", () => {
        if (groupesOuverts.has(g.cle)) groupesOuverts.delete(g.cle);
        else groupesOuverts.add(g.cle);
        dessinerListe();
        refs.liste.querySelector(`.remy-groupe[data-cle="${g.cle}"]`)?.focus();
      });
      b.dataset.cle = g.cle;
      return [b, ouvert ? h("div", { class: "remy-groupe-fils" }, g.conversations.map(ligneConv)) : null];
    }));
}

function ligneConv(c) {
  const nl = R.nonLu(c, optionsNonLu());
  const actif = courante?.id === c.id;
  const sous = nl ? h("span", { class: "remy-conv-sous remy-sous-nl" }, "Nouvelle réponse de Rémy")
    : c.origine ? h("span", { class: "remy-conv-sous" }, `Importée de ${c.origine.nom || "ailleurs"}`)
      : c.prive ? h("span", { class: "remy-conv-sous prive" }, icone("cadenas"), "Privée") : null;
  const a = h("a", { class: `conv remy-conv${nl ? " non-lue" : ""}`, href: `#/remy/${seg(c.id)}`, "aria-current": actif ? "page" : null, title: c.title || "Sans titre" },
    h("span", { class: `remy-point${nl ? " remy-point-nl" : actif ? " courant" : ""}`, "aria-hidden": "true" }),
    h("span", { class: "remy-conv-corps" }, h("span", { class: "t" }, c.title || "Sans titre"), sous),
    c.pinned ? h("span", { class: "remy-epingle", role: "img", "aria-label": "Épinglée" }, icone("epingle")) : null,
    h("span", { class: "remy-conv-heure mono" }, R.heureListe(c.updatedAt)));
  surMenu(a, () => actionsConv(c), { titre: `Conversation « ${c.title || "Sans titre"} »` });
  return a;
}

// Le menu d'une conversation (l'appui long de la liste sur l'iPhone).
function actionsConv(c) {
  const nl = R.nonLu(c, optionsNonLu());
  return [
    nl ? { libelle: "Marquer comme lu", icone: "coche", faire: () => { nonLus.marquerLu(c); dessinerListe(); dire("Marquée comme lue."); } }
      : sait("non-lus-v1") && R.peutMarquerNonLu(c, courante?.id || null) ? { libelle: "Marquer comme non lu", icone: "point-plein", faire: () => { nonLus.marquerNonLu(c); dessinerListe(); dire("Marquée comme non lue."); } } : null,
    { libelle: "Renommer", icone: "crayon", faire: () => renommerConv(c) },
    { libelle: c.pinned ? "Désépingler" : "Épingler", icone: "epingle", faire: () => patchConv(c, { pinned: !c.pinned }, c.pinned ? "Désépinglée." : "Épinglée.") },
    { libelle: "Supprimer", icone: "corbeille", danger: true, faire: () => supprimerConversation(c) },
  ];
}

async function patchConv(c, corps, message) {
  try {
    const r = await api(`/api/conversations/${seg(c.id)}`, { methode: "PATCH", corps });
    const ajout = { ...corps, ...(r?.title ? { title: r.title } : {}) };
    for (const x of new Set([c, liste?.find((y) => y.id === c.id), courante?.id === c.id ? courante : null])) if (x) Object.assign(x, ajout);
    dessinerListe();
    if (courante?.id === c.id) {
      dessinerEnTete();
      dessinerPanneau();
    }
    nonLus.maj(liste);
    if (message) dire(message, { genre: "succes" });
    return true;
  } catch (err) {
    direErreur(err, () => patchConv(c, corps, message), "Pas modifiée");
    return false;
  }
}
async function renommerConv(c) {
  const demande = demanderTexte("Renommer", { valeur: c.title || "", libelle: "Renommer", etiquette: "Titre" });
  const champ = [...document.querySelectorAll("dialog[open] input.champ")].pop();
  if (champ) champ.maxLength = 80;
  const t = await demande;
  if (t) await patchConv(c, { title: t.slice(0, 80) }, "Renommée.");
}
async function supprimerConversation(c) {
  if (!(await confirmer(`Supprimer « ${c.title || "cette conversation"} » ?`, { detail: "La conversation disparaîtra aussi du site. Ce que Rémy a retenu de toi reste.", libelle: "Supprimer", danger: true }))) return;
  try {
    await api(`/api/conversations/${seg(c.id)}`, { methode: "DELETE" });
    liste = (liste || []).filter((x) => x.id !== c.id);
    brouillons.delete(c.id);
    nonLus.maj(liste);
    dire("Conversation supprimée.", { genre: "succes" });
    if (courante?.id === c.id) {
      if (refs.champ) refs.champ.value = "";
      ctx.aller("remy");
    } else dessinerListe();
  } catch (err) {
    direErreur(err, null, "Pas supprimée");
  }
}

// --- Changer de fil : rien ne se perd, rien de privé ne fuit ---

/** Quitter le fil ouvert : son champ (et sa file d'attente) reste attaché à lui. */
function quitterFil({ versPrive = false } = {}) {
  if (!refs.champ) return;
  // Un fil supprimé ailleurs : ce qui est tapé suit vers la prochaine conversation neuve.
  const cle = courante?.absente ? "nouvelle" : cleDe(courante);
  const prive = composeurPrive(courante);
  let texte = refs.champ.value;
  if (file.length) {
    // La file revient au champ du fil où elle a été écrite, jamais jetée.
    texte = R.joindre(texte, file.join("\n\n"));
    file = [];
    if (!(prive && !versPrive)) revenus.set(cle, REVENU);
  }
  if (prive && !versPrive) {
    // Vers un fil ordinaire : le brouillon privé est mis de côté.
    brouillons.delete(cle);
    if (texte.trim()) {
      brouillonPrive = R.joindre(brouillonPrive, texte);
      dire("Ton brouillon privé est gardé de côté : il reviendra dans ta prochaine conversation privée.");
    }
  } else if (texte.trim()) brouillons.set(cle, texte);
  else brouillons.delete(cle);
}

/** Entrer dans le fil `courante` : son brouillon, et le brouillon privé s'il est privé. */
function entrerFil() {
  const cle = cleDe(courante);
  let texte = brouillons.get(cle) || "";
  if (composeurPrive(courante) && brouillonPrive) {
    texte = R.joindre(texte, brouillonPrive);
    brouillonPrive = "";
  }
  mettreAuChamp(texte);
  if (revenus.has(cle)) {
    const phrase = revenus.get(cle);
    revenus.delete(cle);
    if (texte.trim()) dire(phrase);
  }
  monterVocaux();
}

/** Le fil chargé est privé : le brouillon privé mis de côté revient. */
function rendreBrouillonPrive() {
  if (!brouillonPrive || !composeurPrive(courante)) return;
  mettreAuChamp(R.joindre(refs.champ.value, brouillonPrive));
  brouillonPrive = "";
}

/**
 * Un message qui n'est pas parti revient au champ du fil où il a été écrit ;
 * privé et le fil à l'écran est ordinaire : au brouillon privé. Vue quittée
 * (le champ n'est plus à l'écran) : au brouillon du fil, dit au retour.
 * Rend true quand le texte est dans le champ à l'écran.
 */
function rendreAuChamp(texte, { cle, prive = false }) {
  const ici = champVivant() && cleDe(courante) === cle;
  if (ici) {
    const deja = refs.champ.value.trim();
    mettreAuChamp(!deja ? texte : deja === texte ? deja : R.joindre(deja, texte));
    return true;
  }
  if (prive && !composeurPrive(courante)) {
    brouillonPrive = R.joindre(brouillonPrive, texte);
    dire("Ton message privé n'est pas parti : il est gardé pour ta prochaine conversation privée.");
    return false;
  }
  brouillons.set(cle, R.joindre(brouillons.get(cle), texte));
  revenus.set(cle, champVivant() ? REVENU : REVENU_QUITTE);
  return false;
}

/** La réponse en cours continue sur la tour : on la relira en revenant sur ce fil. */
function arreterFlux() {
  generation += 1;
  envoi?.ctrl?.abort();
  envoi = null;
  arretEnCours = false;
}

function nouvellePrivee() {
  local.ecrire("remy-nouvelle-privee", true);
  ctx.aller("remy/nouvelle");
}

/** La puce « Privée » d'une conversation pas encore commencée : le texte reste dans le champ. */
function basculerPrivee(versPrive) {
  if (courante?.id) return;
  if (envoi) {
    dire("Rémy crée la conversation : réessaie dans un instant.");
    return;
  }
  const avant = cleDe(courante);
  if (!courante) courante = { nouvelle: true, prive: false, messages: [] };
  courante.prive = versPrive ?? !courante.prive;
  brouillons.delete(avant);
  if (courante.prive) {
    modeRetenir = false;
    rendreBrouillonPrive();
  }
  dessinerEnTete();
  dessinerFil();
  dessinerPanneau();
  majComposeur();
}

// --- Ouvrir une conversation ---
async function ouvrir(id, { premier = false } = {}) {
  const cible = id || null;
  let privee = false;
  if (cible === "nouvelle") {
    privee = Boolean(local.lire("remy-nouvelle-privee", false));
    local.effacer("remy-nouvelle-privee");
  }
  const versPrive = cible === "nouvelle" ? privee : cible ? Boolean(liste?.find((x) => x.id === cible && !x.origine)?.prive) : false;
  if (!premier) quitterFil({ versPrive });
  arreterFlux();
  modeRetenir = false;
  selectionDictee = null;
  if (!cible || cible === "nouvelle") {
    courante = cible ? { nouvelle: true, prive: privee, messages: [] } : null;
    refs.racine.classList.toggle("fil-ouvert", Boolean(cible));
    entrerFil();
    dessinerListe();
    dessinerEnTete();
    dessinerSession();
    dessinerFil();
    dessinerPanneau();
    majComposeur();
    if (cible || matchMedia("(min-width: 721px)").matches) refs.champ.focus();
    consommerEntrees(cible || "nouvelle");
    return;
  }
  refs.racine.classList.add("fil-ouvert");
  courante = { id: cible, chargement: true, messages: [], prive: versPrive, title: liste?.find((x) => x.id === cible)?.title };
  entrerFil();
  dessinerListe();
  dessinerEnTete();
  dessinerSession();
  majComposeur();
  dessinerPanneau();
  vider(refs.messages, h("div", { class: "colonne" }, squelette([0.5, 0.9, 0.7]), squelette([0.8, 0.6])));
  const ok = await recharger(cible);
  if (!ok || courante?.id !== cible) return;
  activite = Date.now();
  if (!courante.origine) refs.champ.focus();
  consommerEntrees(cible);
}

// Les annotations du site (étapes, durées) survivent à une relecture du fil.
function garderAnnotations(avant, apres) {
  if (avant?.id !== apres?.id) return;
  const anciens = messagesTour(avant);
  (apres.messages || []).forEach((m, i) => {
    const a = anciens[i];
    if (a && a.role === m.role && a._etapes) Object.assign(m, { _etapes: a._etapes, _debut: a._debut, _fin: a._fin, _barreOuverte: a._barreOuverte });
  });
}

/**
 * Relit le fil sur la tour. `fond` : relecture au retour au premier plan ou de
 * la tour ; si elle échoue (hors 404), le fil affiché reste tel quel.
 */
async function recharger(id, { fond = false } = {}) {
  try {
    const c = await api(`/api/conversations/${seg(id)}`);
    if (courante?.id !== id) return false;
    if (!Array.isArray(c.messages)) c.messages = [];
    garderAnnotations(courante, c);
    // Un message raté reste à l'écran avec « Réessayer » (la tour l'a retiré).
    c.messages = R.garderFinLocale(courante.messages, c.messages);
    courante = c;
    rendreBrouillonPrive();
    const l = liste?.find((x) => x.id === id);
    nonLus.marquerLu(l ? { ...l, updatedAt: Math.max(l.updatedAt || 0, c.updatedAt || 0) } : c);
    if (l && c.prive) l.prive = true;
    nonLus.maj(liste);
    dessinerListe();
    dessinerEnTete();
    dessinerSession();
    dessinerFil();
    dessinerPanneau();
    majComposeur();
    if (c.session) chargerSetup();
    reprendreSiEnCours(c);
    return true;
  } catch (err) {
    if (courante?.id !== id) return false;
    if (fond && err.statut !== 404 && !courante.chargement && !courante.introuvable) return false;
    // Fil absent ou illisible : rien ne part tant qu'il n'est pas affiché.
    courante = { id, introuvable: true, absente: err.statut === 404, messages: [] };
    dessinerEnTete();
    majComposeur();
    dessinerPanneau();
    if (err.statut === 404) {
      vider(refs.messages, h("div", { class: "colonne" }, vide("Conversation introuvable", "Elle a peut-être été supprimée.", bouton("Nouvelle conversation", { classe: "plein", onclick: () => ctx.aller("remy/nouvelle") }))));
      return false;
    }
    vider(refs.messages, h("div", { class: "colonne" }, blocErreur(err, () => { courante = { id, chargement: true, messages: [] }; return recharger(id); })));
    return false;
  }
}

// --- Ce que les autres vues envoient à Rémy (contrat C) ---
function consommerEntrees(cible) {
  // « Appeler Rémy » (Ctrl+K) : l'appel s'ouvre sur la conversation neuve (le choix est le geste).
  const appel = local.lire("remy-appeler", null);
  if (appel != null) {
    local.effacer("remy-appeler");
    if (cible === "nouvelle" && Date.now() - Number(appel) < 30e3) {
      appeler();
      return;
    }
  }
  const e = local.lire("remy-envoi", null);
  if (e && (e.conv ? e.conv === cible : cible === "nouvelle")) {
    local.effacer("remy-envoi");
    if (R.envoiValable(e)) {
      if (envoi) {
        dire(OCCUPE);
        return;
      }
      // Une conversation neuve par écriture : privée si demandé (le texte du champ reste).
      if (!e.conv && Boolean(e.prive) !== composeurPrive(courante)) basculerPrivee(Boolean(e.prive));
      envoyerMessage(e.texte.trim(), { titre: e.titre || null, session: e.session || null });
      return;
    }
  }
  if (cible === "nouvelle") {
    const q = questionEnAttente();
    if (q) preparerQuestion(q);
  }
}

/** Une question préparée ailleurs : dans le champ, jamais envoyée, jamais par-dessus un autre message. */
async function preparerQuestion(q) {
  if (R.conflitQuestion({ brouillon: refs.champ.value, texte: q, file })) {
    let f;
    const choix = (valeur) => () => f.fermer(valeur);
    f = feuille({
      titre: "Tu as déjà un message en cours pour Rémy.",
      contenu: h("p", { class: "aide" }, `La question préparée : « ${q} »`),
      pied: [bouton("Annuler", { classe: "papier", onclick: choix(null) }), bouton("Garder mon message", { classe: "papier", onclick: choix("garder") }), bouton("Le remplacer", { classe: "plein", onclick: choix("remplacer") })],
    });
    f.el.querySelector(".feuille-pied .btn:last-child")?.focus();
    const v = await f.fini;
    if (v === "remplacer") {
      file = [];
      modeRetenir = false;
      mettreAuChamp(q);
      majComposeur();
      refs.champ.focus();
    } else if (v === "garder") refs.champ.focus();
    else history.back(); // Annuler : on revient d'où l'on venait, rien n'a changé
    return;
  }
  modeRetenir = false;
  mettreAuChamp(q);
  majComposeur();
  refs.champ.focus();
  dire("Ta question est prête : Entrée pour l'envoyer à Rémy.", { duree: 4000 });
}

// --- En-tête du fil ---
function dessinerEnTete() {
  if (!refs.titre) return;
  const c = courante;
  const titre = !c ? "Rémy" : c.nouvelle ? (c.prive ? "Conversation privée" : "Nouvelle conversation") : c.title || "Conversation";
  const prive = Boolean(c?.prive);
  const existante = Boolean(c?.id && !c.chargement && !c.introuvable);
  vider(refs.titre, existante && (prive || miseEnPrive) ? [h("span", { class: "remy-titre-prive" }, prive ? "Privée" : "Mise en privé…"), h("span", { class: "remy-titre-point" }, " · ")] : null, titre);
  refs.titre.title = titre;
  // Le cadenas : ce que change « privée », et que c'est sans retour.
  refs.cadenas.hidden = !(existante && (prive || miseEnPrive));
  refs.cadenas.disabled = miseEnPrive;
  vider(refs.cadenas, miseEnPrive ? h("span", { class: "remy-roue", "aria-hidden": "true" }) : icone("cadenas"));
  refs.cadenas.title = miseEnPrive ? "Mise en privé…" : `Conversation privée : ${sousTitrePrivee(etatPrivee).toLowerCase()}. Ce que ça change`;
  refs.cadenas.setAttribute("aria-label", miseEnPrive ? "Mise en privé…" : "Conversation privée : ce que ça change");
  refs.marque.replaceChildren(miseEnPrive ? h("span", { class: "remy-roue", "aria-hidden": "true" }) : prive ? icone("cadenas") : "R");
  refs.marque.title = prive ? "Conversation privée" : "";
  vider(refs.actionsFil);
  if (existante) {
    const actions = [
      { libelle: c.pinned ? "Désépingler" : "Épingler", icone: "epingle", faire: () => patchConv(c, { pinned: !c.pinned }, c.pinned ? "Désépinglée." : "Épinglée.") },
      { libelle: "Renommer", icone: "crayon", faire: () => renommerConv(c) },
      !prive && !c.origine && !miseEnPrive ? { libelle: "Rendre privée", titre: "Rendre cette conversation privée", icone: "cadenas", faire: rendrePrivee } : null,
      { libelle: "Supprimer", icone: "corbeille", danger: true, faire: () => supprimerConversation(c) },
    ].filter(Boolean);
    ajouterA(refs.actionsFil, actions.map((a) => bouton("", { classe: "texte icone remy-action-large", icone: a.icone, etiquette: a.libelle, titre: a.titre || a.libelle, onclick: (e) => occupe(e.currentTarget, async () => a.faire()) })));
    // Au pouce (720 px et moins), les mêmes actions dans un menu.
    const plus = bouton("", { classe: "texte icone remy-action-plus", icone: "menu", etiquette: "Actions de la conversation", titre: "Actions de la conversation" });
    plus.addEventListener("click", () => ouvrirMenu(plus, actions, { titre: "Actions de la conversation" }));
    refs.actionsFil.append(plus);
  }
  // Parler à Rémy à voix haute (pas dans un fil importé).
  if (!c?.origine && !c?.chargement && !c?.introuvable) {
    refs.actionsFil.append(bouton("", { classe: "texte icone", icone: "telephone", etiquette: "Appeler Rémy", titre: "Appeler Rémy", onclick: appeler }));
  }
  majBoutonJauge();
}

function majBoutonJauge() {
  if (!refs.valeurJauge) return;
  const c = courante;
  const montre = jaugeVisible() && c && !c.origine && (c.messages?.length || envoi);
  const j = R.jauge(c?.messages);
  refs.valeurJauge.hidden = !montre;
  refs.valeurJauge.textContent = montre ? R.court(j) : "";
  refs.valeurJauge.className = `mono remy-jauge-court niveau-${j.niveau}`;
  refs.btnPanneau.setAttribute("aria-label", montre ? `Contexte de la conversation : ${R.lu(j)}` : "Contexte et étapes");
}

async function rendrePrivee() {
  const c = courante;
  if (!c?.id || c.prive || c.origine || miseEnPrive) return;
  lireReglages();
  const ok = await confirmer("Rendre cette conversation privée ?", { detail: confirmationPrivee(etatPrivee), libelle: "Rendre privée, sans retour" });
  if (!ok || courante !== c) return;
  miseEnPrive = true;
  dessinerEnTete();
  try {
    await api(`/api/conversations/${seg(c.id)}`, { methode: "PATCH", corps: { prive: true } });
    c.prive = true;
    const l = liste?.find((x) => x.id === c.id);
    if (l) l.prive = true;
    if (courante === c) {
      modeRetenir = false;
      dire("Conversation privée : elle reste sur tes machines.", { genre: "succes" });
    }
  } catch (err) {
    direErreur(err, null, "Pas rendue privée");
  } finally {
    miseEnPrive = false;
    dessinerEnTete();
    dessinerPanneau();
    dessinerListe();
    majComposeur();
  }
}

/** La tour a rendu la conversation privée pendant la réponse (elle cite tes conversations d'ailleurs). */
function marquerPrivee(c) {
  const l = liste?.find((x) => x.id === c.id);
  if (l) l.prive = true;
  if (c.prive) return;
  c.prive = true;
  if (courante !== c) return;
  modeRetenir = false;
  dessinerEnTete();
  dessinerPanneau();
  dessinerListe();
  majComposeur();
  dire("Conversation passée en privée : elle cite tes conversations d'ailleurs, qui ne sortent pas de ta tour.");
}

function feuillePrivee() {
  let f;
  f = feuille({
    titre: "Conversation privée",
    contenu: [h("p", null, ceQueCaChange(etatPrivee)), h("p", { class: "aide", style: { marginTop: "10px" } }, "Sans retour : elle reste privée. Pour repasser par Claude, ouvre une nouvelle conversation.")],
    pied: [bouton("OK", { classe: "plein", onclick: () => f.fermer() })],
  });
  f.el.querySelector(".feuille-pied .btn")?.focus();
}

// « Faire connaissance » : l'étape portée par ce fil, et ce qu'il reste à couvrir.
function chargerSetup() {
  if (setup || setupDemande) return;
  setupDemande = true;
  api("/api/setup", { delai: 10000 }).then((s) => {
    setup = s;
    dessinerSession();
  }).catch((err) => {
    setupDemande = false;
    console.warn("Étape « Faire connaissance » illisible :", err?.message || err);
  });
}
function dessinerSession() {
  if (!refs.session) return;
  const s = courante?.session && setup?.sessions?.find((x) => x.id === courante.session);
  refs.session.hidden = !s;
  if (s) vider(refs.session, h("strong", null, `Faire connaissance · ${s.title}`), h("p", null, R.phraseSession(s, setup)));
}

// --- Le fil ---
function dessinerFil() {
  if (!refs.messages) return;
  const c = courante;
  if (c?.chargement || c?.introuvable) return;
  const col = h("div", { class: "colonne" });
  const messages = c?.messages || [];
  if (!messages.length && !(envoi?.bloc && envoi.convId === c?.id)) col.append(accueil(c));
  const total = messagesTour(c).length;
  let dernier = -1;
  messages.forEach((m, i) => { if (m.role !== "user") dernier = i; });
  let tour = 0;
  messages.forEach((m, i) => {
    if (!m._local && tour === (Number(c.compactage?.jusqua) || 0) && tour > 0) col.append(repereResume(c.compactage));
    col.append(m.role === "user" ? blocSam(m) : blocReponse(m, c, { indexTour: m._local ? null : tour, total, dernier: i === dernier && !envoi?.bloc }));
    if (!m._local) tour += 1;
  });
  if (envoi?.bloc && envoi.convId === c?.id) col.append(envoi.bloc);
  vider(refs.messages, col);
  defilerEnBas(true);
}

function defilerEnBas(force = false) {
  const el = refs.messages;
  if (force || el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
}

// L'écran vide : ce que Rémy sait faire, en boutons (AccueilRemy).
function accueil(c) {
  const prive = composeurPrive(c);
  const zone = h("div", { class: "remy-accueil" });
  if (prive) {
    zone.append(h("div", { class: "carte-privee" }, h("strong", null, icone("cadenas"), "Conversation privée"),
      h("p", null, ceQueCaChange(etatPrivee)), h("p", { class: "aide", style: { marginTop: "6px" } }, "La dictée y passe par la tour seulement.")));
  } else {
    zone.append(h("div", { class: "remy-accueil-tete" },
      h("span", { class: "marque-r", "aria-hidden": "true", style: { width: "44px", height: "44px", fontSize: "24px", borderRadius: "13px" } }, "R"),
      h("h2", null, "Qu'est-ce qu'on règle ?"),
      h("p", { class: "aide" }, Array.isArray(liste) && !liste.length && !erreurListe
        ? "Je suis Rémy, ton directeur de cabinet. Je vois ton agenda et tes tâches, et je t'aide à t'organiser. Écris-moi comme à quelqu'un."
        : "Un conseil, un arbitrage, un changement de planning. Je dis toujours ce que je modifie, et tu gardes le dernier mot.")));
    const carte = h("button", { type: "button", class: "remy-carte-privee", disabled: Boolean(envoi), onclick: nouvellePrivee },
      icone("cadenas"), h("span", null, h("strong", null, "Nouvelle conversation privée"), h("span", { class: "aide" }, sousTitrePrivee(etatPrivee))));
    zone.append(carte);
  }
  const suggestion = (titre, ic, faire, { desactive = false } = {}) => h("button", { type: "button", class: "remy-suggestion", disabled: desactive, onclick: faire },
    icone(ic), h("span", null, titre), icone("haut-gauche", "remy-fleche"));
  zone.append(h("div", { class: "remy-suggestions" },
    suggestion("Organiser ma journée", "soleil", organiser),
    suggestion("Qu'est-ce qui est en retard ?", "horloge", () => envoyerDepuisAccueil(R.BROUILLONS.retards), { desactive: Boolean(envoi) }),
    // Retenir écrit dans la mémoire : jamais depuis une conversation privée.
    !prive ? suggestion("Noter une idée", "ampoule", () => basculerRetenir(true)) : null));
  const reprise = R.aReprendre(liste || []);
  if (reprise) zone.append(h("a", { class: "remy-reprise", href: `#/remy/${seg(reprise.fil.id)}` }, icone("rafraichir"), h("span", null, R.libelleReprise(reprise))));
  return zone;
}

/** Une nouvelle conversation, avec un premier message (le clic est le geste). */
async function nouveauFil(texte, { titre = null } = {}) {
  if (envoi) {
    dire(OCCUPE);
    return;
  }
  // Depuis un écran vide privé (même celui d'un fil privé resté vide), la
  // conversation neuve reste privée : un geste ne fait jamais quitter le privé.
  if (courante?.id) {
    const prive = composeurPrive(courante);
    quitterFil({ versPrive: prive });
    arreterFlux();
    courante = { nouvelle: true, prive, messages: [] };
    entrerFil();
  }
  await envoyerMessage(texte, { titre });
}
function organiser() {
  return nouveauFil(R.BROUILLONS.journee, { titre: R.titreJournee() });
}
function envoyerDepuisAccueil(texte) {
  if (envoi) return dire(OCCUPE);
  envoyerMessage(texte);
}

/** « Continuer avec Rémy » depuis un fil importé : une suite, dans une conversation neuve. */
async function continuer() {
  const c = courante;
  if (!c?.origine || envoi) return;
  const s = R.suiteImportee(c.title);
  quitterFil({ versPrive: false });
  arreterFlux();
  courante = { nouvelle: true, prive: false, messages: [] };
  history.replaceState(null, "", "#/remy/nouvelle");
  entrerFil();
  dessinerEnTete();
  dessinerFil();
  majComposeur();
  await envoyerMessage(s.texte, { titre: s.titre });
}

function blocSam(m) {
  const el = h("div", { class: "msg-sam", tabindex: "0" }, m.content);
  m._el = el;
  menuTexte(el, () => m.content);
  return el;
}

/** Clic droit (ou Maj+F10) sur une bulle : « Copier ». Sur un lien ou une sélection, le menu du navigateur. */
function menuTexte(el, texte) {
  el.addEventListener("contextmenu", (e) => { el._cible = e.target; }, true);
  el.addEventListener("keydown", () => { el._cible = null; }, true);
  surMenu(el, () => {
    const cible = el._cible;
    el._cible = null;
    if (cible?.closest?.("a, button, input, textarea")) return [];
    const sel = document.getSelection?.();
    if (sel && !sel.isCollapsed && el.contains(sel.anchorNode)) return [];
    const t = texte();
    return t ? [{ libelle: "Copier", icone: "copier", faire: () => copier(t) }] : [];
  }, { titre: "Message" });
}

function blocReponse(m, c, { indexTour = null, total = 0, dernier = false } = {}) {
  const z = {
    barre: h("div", { class: "remy-barre-zone" }),
    md: h("div", { class: "md" }),
    statut: h("div", { class: "remy-statut", "aria-live": "polite" }),
    secours: h("p", { class: "remy-secours" }),
    erreur: h("div", { class: "remy-erreur-zone" }),
    puce: h("div", { class: "puce-modele" }),
    cartes: h("div", { class: "remy-cartes" }),
  };
  const bloc = h("div", { class: "msg-remy", tabindex: "0", dataset: indexTour != null ? { index: String(indexTour) } : null },
    h("div", { class: "auteur" }, c?.origine ? null : h("span", { class: "marque-r", "aria-hidden": "true" }, "R"), c?.origine?.nom || "Rémy"),
    z.barre, z.md, z.statut, z.secours, z.erreur, z.puce, z.cartes);
  Object.assign(bloc, { _m: m, _c: c, _z: z, _dernier: dernier, _indexTour: indexTour, _total: total });
  m._bloc = bloc;
  menuTexte(bloc, () => (m.content ? R.enClair(sansMarqueurs(m.content)) : ""));
  peindre(bloc);
  return bloc;
}

/** Redessine une réponse (en tout ou en partie) depuis son message. */
function peindre(bloc, quoi = "tout") {
  const { _m: m, _z: z, _c: c } = bloc;
  if (quoi === "texte" || quoi === "tout") {
    if (m.content) {
      z.md.innerHTML = markdown(sansMarqueurs(m.content));
      for (const t of z.md.querySelectorAll("table")) {
        t.tabIndex = 0;
        surMenu(t, () => [{ libelle: "Copier", icone: "copier", faire: () => copier(R.tableEnTexte([...t.rows].map((r) => [...r.cells].map((x) => x.textContent.trim())))) }], { titre: "Tableau" });
      }
    } else vider(z.md, m._enCours ? h("span", { class: "remy-curseur", role: "img", "aria-label": "Rémy écrit" }) : null);
  }
  if (quoi === "barre" || quoi === "tout") {
    vider(z.barre, m._etapes?.length && (m._enCours || bloc._dernier) ? barreEtapes(m) : null);
    vider(z.statut, m._enCours && m._statut && (m._recup || !m._etapes?.length) ? [h("span", { class: "remy-curseur petit", "aria-hidden": "true" }), h("span", null, m._statut)] : null);
  }
  if (quoi === "puce" || quoi === "tout") {
    const bouts = [R.libelleModele(m), m._interrompu ? "interrompue" : null,
      vitesseVisible() && !m._enCours && m.mesures?.tps > 0 ? R.fmtTps(m.mesures.tps) : null,
      vitesseVisible() && m._enCours && m._debit > 0 ? `${R.fmtTps(m._debit)}…` : null].filter(Boolean);
    z.puce.textContent = bouts.join(" · ");
  }
  if (quoi === "tout") {
    z.secours.textContent = R.estSecours(m) && !m._enCours ? "Réponse de secours : le modèle habituel n'a pas répondu." : "";
    vider(z.erreur, m._erreur ? zoneErreur(m, bloc) : m._note ? noteDelai(m, c) : null);
    if (m.proposal?.actions?.length && !bloc._prop) {
      bloc._prop = h("div", { class: "remy-prop" }, carteProp(m.proposal, c, m._index ?? bloc._indexTour));
      z.cartes.append(bloc._prop);
    }
    if (m.autorisation) {
      const carte = carteAutorisation(m, bloc);
      if (bloc._auto) bloc._auto.replaceWith(carte);
      else z.cartes.append(carte);
      bloc._auto = carte;
    }
  }
}

// La proposition : la carte du lot « noter » (contrat D), ou ce qui l'empêche.
function carteProp(p, c, index) {
  if (modProps?.carteProposition) {
    try {
      const el = modProps.carteProposition(p, c, index, {
        ecrit: Boolean(envoi && envoi.convId === c?.id),
        relire: () => { if (c?.id && courante?.id === c.id && !envoi) return recharger(c.id); },
        ctx,
      });
      if (el instanceof Node) return el;
    } catch (err) {
      console.warn("Proposition :", err);
    }
  }
  return h("p", { class: "msg-erreur remy-absent" }, PROPOSITION_ABSENTE);
}

// La barre d'étapes (BarreEtapes) : l'étape en cours et son chrono ; dépliée,
// chaque étape avec SA durée et l'extrait de la réflexion.
function barreEtapes(m) {
  const etapes = m._etapes;
  const enCours = Boolean(m._enCours);
  const totalMs = enCours ? null : R.totalReponse({ debut: m._debut, fin: m._fin, etapes });
  const vitesse = vitesseVisible();
  const derniere = etapes[etapes.length - 1];
  const texte = enCours ? derniere?.texte || "" : R.libelleFinEtapes(totalMs, m.mesures?.tps, vitesse);
  const chrono = enCours && m._debut ? h("span", { class: "mono remy-chrono", dataset: { debut: String(m._debut) } }, `${Math.max(0, Math.floor((Date.now() - m._debut) / 1000))} s`) : null;
  const ouverte = Boolean(m._barreOuverte);
  const bascule = h("button", { type: "button", class: "remy-barre", "aria-expanded": String(ouverte), title: ouverte ? "Masque les étapes" : "Montre ce que Rémy a fait" },
    enCours ? h("span", { class: "remy-curseur petit", "aria-hidden": "true" }) : icone("coche", "remy-fait"),
    icone(R.iconeEtape(enCours ? derniere?.cle : null)),
    h("span", { class: "lib" }, texte),
    enCours && vitesse && m._debit > 0 ? h("span", { class: "mono" }, R.fmtTps(m._debit)) : null,
    chrono,
    icone("bas", "remy-chevron"));
  const detail = h("div", { class: "remy-etapes", hidden: !ouverte },
    etapes.map((e, i) => h("div", { class: "remy-etape" },
      h("div", { class: "remy-etape-ligne" }, icone(R.iconeEtape(e.cle)), h("span", { class: "txt" }, e.texte), h("span", { class: "mono t" }, R.dureeEtape(etapes, i, { enCours, totalMs }))),
      e.detail ? h("p", { class: "remy-extrait" }, `« ${e.detail} »`) : null)));
  bascule.addEventListener("click", () => {
    m._barreOuverte = !m._barreOuverte;
    detail.hidden = !m._barreOuverte;
    bascule.setAttribute("aria-expanded", String(m._barreOuverte));
    bascule.title = m._barreOuverte ? "Masque les étapes" : "Montre ce que Rémy a fait";
  });
  return h("div", { class: "remy-barre-bloc" }, bascule, detail);
}
function demarrerChronos() {
  if (tic) return;
  tic = setInterval(() => {
    for (const el of document.querySelectorAll(".remy-chrono[data-debut]")) el.textContent = `${Math.max(0, Math.floor((Date.now() - Number(el.dataset.debut)) / 1000))} s`;
    if (!envoi) {
      clearInterval(tic);
      tic = null;
    }
  }, 1000);
}

// Une erreur de la tour : son message, son code à part, de quoi le transmettre.
function zoneErreur(m, bloc) {
  const msg = h("p", { class: "msg-erreur", tabindex: "0" }, m._erreur);
  const copie = m._code ? R.copieSansDetail(m._erreur, m._code) : m._erreur;
  surMenu(msg, () => [
    { libelle: "Copier", icone: "copier", faire: () => copier(copie) },
    m._code ? { libelle: "Copier le diagnostic", icone: "diagnostic", faire: () => copierDiagnostic(m._code, m._erreur) } : null,
  ], { titre: "Erreur" });
  const reessayer = m._question && !bloc._c?.origine ? bouton("Réessayer", { classe: "papier petit", icone: "rafraichir", onclick: () => reessayerReponse(m, bloc) }) : null;
  return [msg,
    m._code ? h("div", { class: "remy-code" }, h("span", { class: "mono remy-code-valeur" }, `Code ${m._code}`),
      bouton("Copier le diagnostic", { classe: "texte petit", icone: "diagnostic", onclick: (e) => occupe(e.currentTarget, () => copierDiagnostic(m._code, m._erreur)) })) : null,
    reessayer];
}
function noteDelai(m, c) {
  return h("div", { class: "note-flux" }, h("p", { class: "aide" }, m._note),
    h("div", { class: "rangee", style: { marginTop: "8px" } }, bouton("Relire la conversation", { classe: "papier petit", icone: "rafraichir", onclick: () => { if (courante?.id === c?.id && !envoi) recharger(c.id); } })));
}

/** « Réessayer » : retire la réponse ratée et sa question, puis renvoie la question. */
function reessayerReponse(m, bloc) {
  if (envoi) return dire(OCCUPE);
  const c = courante;
  const i = c?.messages?.indexOf(m) ?? -1;
  let sam = null;
  if (i >= 0) {
    c.messages.splice(i, 1);
    if (c.messages[i - 1]?.role === "user") sam = c.messages.splice(i - 1, 1)[0];
  } else if (c?.messages?.[c.messages.length - 1]?.role === "user") sam = c.messages.pop();
  sam?._el?.remove();
  bloc.remove();
  envoyerMessage(m._question);
}

// Le repère « Rémy a résumé ce qui précède » (RepereResume).
function repereResume(k) {
  const b = h("button", { type: "button", class: "remy-repere-btn", title: "Montre le résumé que Rémy relit à la place des messages au-dessus", disabled: !String(k?.resume || "").trim(), onclick: () => feuilleResume(k.resume) },
    icone("compresser"), h("span", null, "Rémy a résumé ce qui précède"));
  return h("div", { class: "remy-repere" }, b);
}
function feuilleResume(texte) {
  let f;
  f = feuille({
    titre: "Le résumé que Rémy relit",
    sousTitre: "À la place des messages au-dessus du repère, qui restent là.",
    contenu: h("div", { class: "remy-resume", tabindex: "0" }, texte || ""),
    pied: [bouton("Tout copier", { classe: "papier", icone: "copier", onclick: () => { copier(texte || ""); f.fermer(); } }), bouton("OK", { classe: "plein", onclick: () => f.fermer() })],
    large: true,
  });
  f.el.querySelector(".feuille-pied .btn:last-child")?.focus();
}
function insererRepere(c) {
  const col = colonne();
  const k = Number(c?.compactage?.jusqua) || 0;
  if (!col || k <= 0) return;
  col.querySelector(".remy-repere")?.remove();
  const cible = [...col.children].find((el) => el.dataset?.index === String(k)) || [...col.querySelectorAll(".msg-sam, .msg-remy")].filter((el) => !el._m?._local)[k];
  if (cible) cible.before(repereResume(c.compactage));
}

// --- Autorisations (une recherche web qui passerait par Claude) ---
function carteAutorisation(m, bloc) {
  const a = m.autorisation;
  const c = bloc._c;
  const statut = R.statutAutorisation(a, bloc._indexTour, messagesTour(c).length);
  const enAttente = statut === "en_attente";
  const el = h("div", { class: `autorisation remy-autorisation${enAttente ? " en-attente" : ""}` },
    h("div", { class: "remy-autorisation-tete" }, icone("globe"), h("strong", null, R.titreAutorisation(statut))));
  if (!enAttente) return el;
  const non = bouton("Non, sans le web", { classe: "papier" });
  const oui = bouton("Chercher", { classe: "plein", icone: "recherche" });
  non.disabled = oui.disabled = Boolean(envoi);
  const repondre = (accord) => {
    if (envoi) return dire(OCCUPE);
    if (!c?.id) return;
    // Un essai raté juste avant : sa ligne d'erreur laisse la place.
    const i = c.messages.indexOf(m);
    for (const x of c.messages.slice(i + 1).filter((y) => y._local && y._erreur)) {
      c.messages.splice(c.messages.indexOf(x), 1);
      x._bloc?.remove();
    }
    a.statut = accord ? "acceptee" : "refusee";
    peindre(bloc);
    lancerFlux(`/api/conversations/${seg(c.id)}/autorisations/${seg(a.id)}`, { accord }, { autorisation: { a, accord, bloc } });
  };
  non.addEventListener("click", () => repondre(false));
  oui.addEventListener("click", () => repondre(true));
  ajouterA(el, h("p", { class: "aide" }, `Partira : ${R.partira(a)}.`), h("div", { class: "rangee", style: { marginTop: "8px" } }, non, oui));
  return el;
}

/** Une réponse finie : les cartes d'autorisation retrouvent leurs boutons. */
function rafraichirCartes() {
  for (const b of colonne()?.querySelectorAll(".msg-remy") || []) if (b._m?.autorisation && b._auto) peindre(b);
}

/** Après un message envoyé pendant qu'une demande attendait : la tour dit si c'était oui, non, ou expiré. */
async function relireAutorisations(id) {
  try {
    const conv = await api(`/api/conversations/${seg(id)}`);
    if (courante?.id !== id || envoi) return;
    for (const m of courante.messages) {
      const neuve = m.autorisation && conv.messages?.find((x) => x.autorisation?.id === m.autorisation.id)?.autorisation;
      if (neuve) m.autorisation.statut = neuve.statut;
    }
    dessinerFil();
  } catch {}
}

// --- Le composeur ---
function bande(texte, action) {
  return h("div", { class: "remy-bande" }, h("span", null, texte), action);
}
function majComposeur() {
  if (!refs.champ) return;
  const c = courante;
  const importee = Boolean(c?.origine);
  refs.composeur.hidden = importee;
  refs.importee.hidden = !importee;
  if (importee) {
    const suite = bouton("Continuer avec Rémy", { classe: "plein", icone: "fleche", onclick: continuer });
    suite.disabled = Boolean(envoi);
    vider(refs.importee, h("div", { class: "colonne remy-importee-corps" }, h("p", null, `Conversation importée de ${c.origine.nom || "ailleurs"} : on ne peut que la lire.`), suite));
  }
  refs.stop.hidden = !envoi;
  refs.stop.disabled = arretEnCours;
  const neuve = !c?.id;
  refs.pucePrivee.hidden = !neuve || modeRetenir;
  refs.pucePrivee.disabled = Boolean(envoi);
  const active = neuve && composeurPrive(c);
  refs.pucePrivee.setAttribute("aria-pressed", String(active));
  refs.pucePrivee.replaceChildren(icone(active ? "cadenas" : "cadenas-ouvert"), h("span", null, "Privée"));
  refs.pucePrivee.title = active ? "La conversation à venir redevient ordinaire" : `Privée : ${sousTitrePrivee(etatPrivee).toLowerCase()}, même en secours`;
  vider(refs.bandes,
    file.length ? bande(R.texteFile(file), bouton("Reprendre", { classe: "texte petit", titre: "Remet le message en attente dans le champ", onclick: reprendreFile })) : null,
    modeRetenir ? bande("Noter une idée : Rémy la retient, sans répondre.", bouton("Plutôt en parler", { classe: "texte petit", onclick: () => basculerRetenir(false) })) : null);
  refs.champ.placeholder = modeRetenir ? "Ton idée, en quelques phrases…" : composeurPrive(c) ? "Message privé à Rémy…" : "Écris à Rémy…";
  refs.envoyer.hidden = modeRetenir;
  refs.retenir.hidden = !modeRetenir;
  majBoutonRetenir();
  majEnvoyer();
  const lib = envoi ? "Envoyer (Rémy répond encore)" : "Envoyer (Entrée)";
  refs.envoyer.title = lib;
  refs.envoyer.setAttribute("aria-label", lib);
  refs.aideEnvoi.textContent = modeRetenir ? " retient" : " envoie";
  majCorrection();
  placerBandeauxRemy();
}
/** Rien ne part vers un fil pas affiché (en chargement, absent, illisible), ni pendant la transcription. */
function majEnvoyer() {
  if (!refs.envoyer) return;
  refs.envoyer.disabled = Boolean(courante?.chargement || courante?.introuvable) || etatDictee === "transcription";
}
function majBoutonRetenir() {
  if (!refs.retenir) return;
  refs.retenir.disabled = enCapture || !refs.champ.value.trim();
  refs.retenir.querySelector(".lib").textContent = enCapture ? "…" : "Retenir";
}

function reprendreFile() {
  if (!file.length) return;
  const t = file.join("\n\n");
  file = [];
  mettreAuChamp(R.joindre(refs.champ.value, t));
  majComposeur();
  refs.champ.focus();
}

/** Une question à trois boutons (confirmationDialog de l'iPhone) : rend la valeur choisie, ou null. */
function choisir(titre, { detail, choix }) {
  let f;
  const boutons = choix.map((c) => bouton(c.libelle, { classe: c.classe || "papier", onclick: () => f.fermer(c.valeur) }));
  f = feuille({ titre, contenu: detail ? h("p", { class: "aide" }, detail) : null, pied: boutons });
  boutons[choix.findIndex((c) => c.defaut)]?.focus();
  return f.fini.then((v) => v ?? null);
}

async function soumettre() {
  if (modeRetenir) return retenir();
  const texte = refs.champ.value.trim();
  if (!texte) return refs.champ.focus();
  if (courante?.origine) return dire(IMPORTEE);
  if (courante?.chargement) return;
  // Fil pas affiché : le texte reste dans le champ (fil absent : il suivra
  // vers la prochaine conversation neuve, voir quitterFil).
  if (courante?.introuvable) {
    dire(courante.absente ? FIL_ABSENT : FIL_ILLISIBLE, { genre: "erreur" });
    return refs.champ.focus();
  }
  if (etatDictee === "transcription") return dire(TRANSCRIPTION);
  const lien = R.contientLien(texte);
  if (envoi) {
    // Rémy répond encore : Sam choisit ; le lien est dit dans la même question.
    const v = await choisir("Rémy répond encore", {
      detail: `Sa réponse coupée restera, marquée « interrompu ».${lien ? " Rémy lira aussi ton lien (quelques centimes)." : ""}`,
      choix: [{ libelle: "Annuler", valeur: null }, { libelle: "Interrompre et envoyer", valeur: "interrompre" }, { libelle: "Envoyer après sa réponse", valeur: "apres", classe: "plein", defaut: true }],
    });
    if (!v || refs.champ.value.trim() !== texte) return refs.champ.focus();
    mettreAuChamp("");
    brouillons.delete(cleDe(courante));
    if (!envoi) {
      // La réponse s'est finie pendant la question : le message part tout de suite.
      envoyerMessage(texte);
      return;
    }
    if (v === "apres") file.push(texte);
    else file.unshift(texte);
    majComposeur();
    refs.champ.focus();
    if (v === "interrompre") interrompre({ pourEnvoyer: true });
    return;
  }
  if (lien && local.lire("confirmerLiens", true) !== false) {
    const v = await choisir("Rémy va lire ce lien", {
      detail: "Lire une page web coûte un peu plus qu'un message (quelques centimes).",
      choix: [{ libelle: "Annuler", valeur: null }, { libelle: "Envoyer, et ne plus demander", valeur: "jamais" }, { libelle: "Envoyer", valeur: "envoyer", classe: "plein", defaut: true }],
    });
    if (!v || refs.champ.value.trim() !== texte) return refs.champ.focus();
    if (v === "jamais") local.ecrire("confirmerLiens", false);
    if (envoi) return soumettre();
  }
  mettreAuChamp("");
  brouillons.delete(cleDe(courante));
  envoyerMessage(texte);
}

async function envoyerMessage(texte, { titre = null, session = null } = {}) {
  if (courante?.origine) {
    dire(IMPORTEE);
    return;
  }
  if (envoi) {
    dire(OCCUPE);
    return;
  }
  const gen = generation;
  activite = Date.now();
  let redessiner = false;
  // Pas de fil ouvert : une conversation naît avec le premier message (privée
  // si l'écran l'est), renommée AVANT le message si un titre est voulu.
  if (!courante?.id) {
    const prive = composeurPrive(courante);
    const cle = cleDe(courante);
    const moi = { convId: null, creation: true, gen };
    envoi = moi;
    majComposeur();
    const liberer = () => {
      if (envoi === moi) envoi = null;
      if (generation === gen) majComposeur();
    };
    let c;
    let existante = false;
    try {
      c = await ecrire("/api/conversations", { ...(prive ? { prive: true } : {}), ...(session ? { session } : {}) });
      // Une étape « Faire connaissance » n'a qu'UNE conversation : la tour rend
      // celle qui existe, avec ses messages (ni renommée, ni retouchée ici).
      existante = Boolean(session) && Array.isArray(c?.messages) && c.messages.length > 0;
      // Le cadenas ne croit que la tour : pas née privée, elle l'est rendue avant le message, ou rien ne part.
      if (!existante && prive && c?.prive !== true) {
        try {
          await api(`/api/conversations/${seg(c.id)}`, { methode: "PATCH", corps: { prive: true } });
          c.prive = true;
        } catch (err) {
          liberer();
          rendreAuChamp(texte, { cle, prive });
          if (err.nature !== "auth") dire("La tour n'a pas pu rendre la conversation privée : rien n'est parti, ton message est revenu dans le champ.", { genre: "erreur" });
          api(`/api/conversations/${seg(c.id)}`, { methode: "DELETE" }).catch(() => {});
          return;
        }
      }
      if (!existante && titre && generation === gen) {
        try {
          const r = await api(`/api/conversations/${seg(c.id)}`, { methode: "PATCH", corps: { title: titre.slice(0, 80) } });
          c.title = r?.title || titre.slice(0, 80);
        } catch {}
      }
    } catch (err) {
      liberer();
      rendreAuChamp(texte, { cle, prive });
      direErreur(err, () => soumettre(), "Conversation pas créée");
      return;
    }
    if (generation !== gen) {
      // Sam a changé de fil (ou quitté Rémy) pendant la création : le fil vide
      // s'en va, le message revient (dans le champ, ou dit au retour).
      if (envoi === moi) envoi = null;
      if (rendreAuChamp(texte, { cle, prive })) dire(REVENU_ICI);
      if (!c.messages?.length) api(`/api/conversations/${seg(c.id)}`, { methode: "DELETE" }).catch(() => {});
      return;
    }
    if (existante) {
      // On l'ouvre, sans renvoyer l'amorce (AppModel.lancerSession).
      if (envoi === moi) envoi = null;
      history.replaceState(null, "", `#/remy/${seg(c.id)}`);
      await ouvrir(c.id);
      return;
    }
    envoi = null;
    courante = { ...c, messages: Array.isArray(c.messages) ? c.messages : [] };
    brouillons.delete(cle);
    liste = [{ id: c.id, title: c.title, updatedAt: Date.now(), prive: Boolean(c.prive), pinned: Boolean(c.pinned), messages: courante.messages.length, dernier: null, origine: null }, ...(liste || []).filter((x) => x.id !== c.id)];
    history.replaceState(null, "", `#/remy/${seg(c.id)}`);
    refs.racine.classList.add("fil-ouvert");
    if (c.session) chargerSetup();
    dessinerListe();
    dessinerEnTete();
    dessinerSession();
    redessiner = true;
  }
  const c = courante;
  const demandeEnAttente = c.messages.some((m) => m.autorisation?.statut === "en_attente");
  const msg = { role: "user", content: texte };
  c.messages.push(msg);
  // Un fil qui vient de remplacer l'écran vide se dessine en entier.
  if (redessiner || c.messages.length === 1 || !colonne()) dessinerFil();
  else colonne().append(blocSam(msg));
  defilerEnBas(true);
  await lancerFlux(`/api/conversations/${seg(c.id)}/messages`, { text: texte, call: false }, { question: texte, msgSam: msg, demandeEnAttente });
}

/** Lit une réponse en flux (message ou autorisation) et la montre au fil de l'eau. */
async function lancerFlux(chemin, corps, { question = null, msgSam = null, demandeEnAttente = false, autorisation = null } = {}) {
  const c = courante;
  const gen = generation;
  const l = { role: "assistant", content: "", _enCours: true, _etapes: [], _question: question, _statut: autorisation ? (autorisation.accord ? "Rémy cherche sur le web…" : "Rémy répond sans le web…") : null };
  // Une seule barre d'étapes : celle de la dernière réponse.
  for (const b of colonne()?.querySelectorAll(".msg-remy") || []) {
    if (b._dernier) {
      b._dernier = false;
      peindre(b, "barre");
    }
  }
  const bloc = blocReponse(l, c, { dernier: true });
  colonne()?.append(bloc);
  defilerEnBas(true);
  const ctrl = new AbortController();
  const moi = { convId: c.id, ctrl, bloc, ligne: l, gen };
  envoi = moi;
  modProps?.majEcriture?.(true);
  demarrerChronos();
  majComposeur();
  majBoutonJauge();
  dessinerPanneau();
  let fini = false;
  let recu = false;
  let erreurServeur = null;
  const remettreEnAttente = () => {
    if (!autorisation) return;
    autorisation.a.statut = "en_attente";
    if (autorisation.bloc.isConnected) peindre(autorisation.bloc);
  };
  const echec = (message, code = null, { local: estLocal = true } = {}) => {
    l._erreur = message;
    l._code = code || null;
    l._enCours = false;
    l._statut = null;
    l._recup = false;
    l._fin = Date.now();
    if (estLocal) {
      if (msgSam) msgSam._local = true;
      l._local = true;
    }
    if (!c.messages.includes(l)) c.messages.push(l);
    peindre(bloc);
  };
  try {
    await flux(chemin, corps, (nom, d) => {
      if (generation !== gen) return;
      recu = true;
      if (nom === "delta") {
        l.content += d.text || "";
        peindre(bloc, "texte");
        defilerEnBas();
      } else if (nom === "status") {
        if (!l._debut) l._debut = Date.now();
        if (d.cle) R.recevoirEtape(l._etapes, d);
        else l._statut = d.text || l._statut;
        peindre(bloc, "barre");
        dessinerPanneau();
      } else if (nom === "debit") {
        if (Number.isFinite(d.tps) && d.tps >= 0) l._debit = d.tps;
        peindre(bloc, "puce");
        peindre(bloc, "barre");
        dessinerPanneau();
      } else if (nom === "proposal") {
        l.proposal = d;
        l._index = d.index;
        peindre(bloc);
        defilerEnBas();
      } else if (nom === "autorisation") {
        l.autorisation = d;
        l._index = d.index;
        peindre(bloc);
        defilerEnBas();
      } else if (nom === "traites") {
        // Rémy a barré un sujet de la nuit : la boîte d'Aujourd'hui suit.
        dire("Rémy a noté un sujet de la nuit comme réglé.");
        signalerSujets(d);
      } else if (nom === "title") {
        c.title = d.title;
        const e = liste?.find((x) => x.id === c.id);
        if (e) e.title = d.title;
        dessinerEnTete();
        dessinerListe();
      } else if (nom === "done") {
        fini = true;
        if (typeof d.text === "string" && d.text && d.text !== l.content) l.content = d.text;
        Object.assign(l, { model: d.model, tier: d.tier, usd: d.usd, ...(d.mesures ? { mesures: d.mesures } : {}) });
        l._interrompu = Boolean(d.interrompu);
        l._fin = Date.now();
        l._enCours = false;
        l._statut = null;
        l._debit = null;
        if (d.couverture && setup) {
          setup.couverture = d.couverture;
          dessinerSession();
        }
        if (d.session_done) {
          c.session = null;
          dessinerSession();
          dire("Étape terminée : Rémy te connaît un peu mieux.");
          signalerSujets(d);
        }
        if (d.prive === true) marquerPrivee(c);
        c.messages.push(l);
        peindre(bloc);
      } else if (nom === "error") {
        erreurServeur = d;
      }
    }, { signal: ctrl.signal });
    if (generation !== gen) return;
    if (erreurServeur) {
      // La tour a retiré ce message (rien d'écrit) : « Réessayer » le renverra.
      if (autorisation) {
        remettreEnAttente();
        echec(`${erreurServeur.message || "Erreur côté serveur."} — touche à nouveau la carte pour réessayer.`, erreurServeur.code);
      } else echec(erreurServeur.message || "Erreur côté serveur.", erreurServeur.code);
    } else if (!fini) {
      // Le flux s'est fermé sans fin : la tour a peut-être fini, on relit.
      await recuperer(c, l, moi, { question, msgSam, apresDemande: autorisation?.a.id, remettreEnAttente, statut: recu ? "Connexion coupée, je récupère la réponse…" : "Connexion difficile, j'essaie de joindre Rémy…" });
    }
  } catch (err) {
    if (err.nature === "annule" || generation !== gen) return;
    if (err.nature === "auth") echec("Session expirée — reconnecte-toi.", null, { local: false });
    else if (err.nature === "reseau" && !recu && !/coupée pendant la réponse/.test(err.message || "")) {
      // Rien n'est arrivé jusqu'à la tour : le message revient dans le champ.
      bloc.remove();
      if (msgSam) {
        c.messages.splice(c.messages.indexOf(msgSam), 1);
        msgSam._el?.remove();
        rendreAuChamp(question, { cle: cleDe(c), prive: composeurPrive(c) });
        dire("La tour ne répond pas : ton message est revenu dans le champ.", { genre: "erreur", action: { libelle: "Réessayer", faire: () => soumettre() } });
      } else {
        remettreEnAttente();
        dire("La tour ne répond pas : touche à nouveau la carte pour réessayer.", { genre: "erreur" });
      }
    } else if (err.nature === "reseau") {
      await recuperer(c, l, moi, { question, msgSam, apresDemande: autorisation?.a.id, remettreEnAttente, statut: recu ? "Connexion coupée, je récupère la réponse…" : "Connexion difficile, j'essaie de joindre Rémy…" });
    } else if (err.nature === "delai") {
      // Silence de 3 min (ou réponse de plus de 30 min) : la tour écrit
      // peut-être encore. Le message de Sam reste ; on relit sur un geste.
      Object.assign(l, { _enCours: false, _statut: null, _note: err.message, _fin: Date.now() });
      peindre(bloc);
    } else if (autorisation && (err.statut === 409 || err.statut === 404)) {
      // Déjà répondu ailleurs, ou expirée : la tour dit l'état réel.
      bloc.remove();
      dire(R.sansCode(err.message, err.code), { genre: "erreur" });
      if (envoi === moi) envoi = null;
      await recharger(c.id);
    } else if (autorisation) {
      remettreEnAttente();
      echec(`${R.sansCode(err.message, err.code)} — touche à nouveau la carte pour réessayer.`, err.code);
    } else echec(R.sansCode(err.message, err.code), err.code);
  } finally {
    const etait = envoi === moi;
    if (etait) envoi = null;
    if (generation === gen) {
      modProps?.majEcriture?.(false);
      majComposeur();
      majBoutonJauge();
      dessinerPanneau();
      rafraichirCartes();
      chargerListe();
      if (demandeEnAttente) relireAutorisations(c.id);
      if (fini && panneauVisible()) setTimeout(() => { if (courante === c) relireCompactage(); }, 5000);
      if (etait) envoyerLaFile();
    }
  }
}

/**
 * La réponse s'écrit encore sur la tour (fil rouvert en route, connexion
 * coupée) : on relit la conversation toutes les 4 s, 37 fois au plus, jusqu'à
 * la retrouver. Lecture seule, aucun appel IA. Changer de fil l'arrête.
 */
async function recuperer(c, l, moi, { question, msgSam = null, apresDemande = null, remettreEnAttente = () => {}, statut }) {
  const gen = moi.gen;
  const bloc = moi.bloc;
  Object.assign(l, { _enCours: true, _recup: true, _statut: statut });
  peindre(bloc);
  const finir = (message) => {
    Object.assign(l, { _enCours: false, _recup: false, _statut: null, _erreur: message, _local: true, _fin: Date.now() });
    if (!c.messages.includes(l)) c.messages.push(l);
    peindre(bloc);
  };
  let sansReseau = 0;
  for (let essai = 0; essai < ESSAIS_RECUPERATION; essai++) {
    await attendre(PAS_RECUPERATION);
    if (generation !== gen) return;
    let conv;
    try {
      conv = await api(`/api/conversations/${seg(c.id)}`, { delai: 15000 });
      sansReseau = 0;
    } catch (err) {
      if (generation !== gen) return;
      if (err.nature === "auth") return finir("Session expirée — reconnecte-toi.");
      sansReseau += 1;
      // Toujours injoignable après cinq essais : Sam réessaiera quand le réseau reviendra.
      if (sansReseau >= 5) return finir("Pas de connexion : réessaie quand le réseau revient.");
      continue;
    }
    if (generation !== gen) return;
    const messages = Array.isArray(conv.messages) ? conv.messages : [];
    let debut;
    if (apresDemande) {
      const k = messages.findIndex((m) => m.autorisation?.id === apresDemande);
      if (k < 0 || messages[k].autorisation.statut === "en_attente") {
        remettreEnAttente();
        return finir("Ta réponse n'est pas arrivée jusqu'à Rémy — touche à nouveau la carte.");
      }
      debut = k + 1;
    } else {
      const iq = messages.findLastIndex((m) => m.role === "user" && m.content === question);
      if (iq < 0) {
        // Pas sur la tour : la question reste à l'écran avec son erreur et « Réessayer ».
        if (msgSam) msgSam._local = true;
        return finir("Ton message n'est pas arrivé jusqu'à Rémy.");
      }
      debut = iq + 1;
    }
    const k = messages.findIndex((m, i) => i >= debut && m.role !== "user");
    if (k >= 0) {
      // Retrouvée : la conversation de la tour fait foi ; la barre d'étapes reste.
      Object.assign(messages[k], { _etapes: l._etapes, _debut: l._debut, _fin: Date.now(), _barreOuverte: l._barreOuverte });
      conv.messages = messages;
      courante = conv;
      moi.bloc = null;
      dessinerFil();
      dessinerEnTete();
      dessinerPanneau();
      return true;
    }
  }
  finir("Impossible de récupérer la réponse.");
}

/** Le fil se termine par une question toute récente sans réponse : Rémy est sans doute en train de répondre. */
function reprendreSiEnCours(c) {
  if (c.origine || envoi) return;
  const der = c.messages[c.messages.length - 1];
  if (der?.role !== "user" || !(Date.now() - (c.updatedAt || 0) < 5 * 60000)) return;
  const gen = generation;
  const l = { role: "assistant", content: "", _enCours: true, _etapes: [], _question: der.content };
  const bloc = blocReponse(l, c, { dernier: true });
  colonne()?.append(bloc);
  defilerEnBas(true);
  const moi = { convId: c.id, ctrl: null, bloc, ligne: l, gen, reprise: true };
  envoi = moi;
  majComposeur();
  dessinerPanneau();
  (async () => {
    try {
      await recuperer(c, l, moi, { question: der.content, statut: "Rémy termine sa réponse…" });
    } finally {
      const etait = envoi === moi;
      if (etait) envoi = null;
      if (generation === gen) {
        majComposeur();
        dessinerPanneau();
        rafraichirCartes();
        chargerListe();
        if (etait) envoyerLaFile();
      }
    }
  })();
}

/** La réponse est finie : ce qui attendait part, en un seul message (des suites de la même pensée). */
function envoyerLaFile() {
  if (envoi || !file.length || !courante?.id) return;
  const t = file.join("\n\n");
  file = [];
  majComposeur();
  envoyerMessage(t);
}

/** Le bouton stop (ou Échap) : coupe la réponse de ce fil ; la fin du flux libère le composeur. */
async function interrompre({ pourEnvoyer = false } = {}) {
  if (!envoi || arretEnCours) return;
  if (!envoi.convId) {
    dire("Rémy n'a pas encore commencé — réessaie dans un instant.");
    return;
  }
  const id = envoi.convId;
  arretEnCours = true;
  majComposeur();
  try {
    await ecrire(`/api/conversations/${seg(id)}/stop`, {});
    if (!pourEnvoyer) dire("Réponse interrompue : ce qui était écrit est gardé.");
  } catch (err) {
    if (err.nature !== "auth") dire(file.length ? "Impossible d'interrompre Rémy : ton message partira à la fin de sa réponse." : "Impossible d'interrompre Rémy — réessaie.", { genre: "erreur" });
  } finally {
    arretEnCours = false;
    majComposeur();
  }
}

// --- « Noter une idée » : Rémy retient, sans répondre ---
function basculerRetenir(oui) {
  if (oui && composeurPrive(courante)) {
    dire(PAS_DE_MEMOIRE, { genre: "erreur" });
    return;
  }
  modeRetenir = Boolean(oui);
  majComposeur();
  refs.champ.focus();
}

async function retenir() {
  if (composeurPrive(courante)) return dire(PAS_DE_MEMOIRE, { genre: "erreur" });
  const texte = refs.champ.value.trim();
  if ([...texte].length < 30) return dire("Encore quelques mots pour que Rémy puisse le retenir.");
  if (enCapture) return;
  // Un long texte : Rémy propose les infos à retenir, Sam coche (lot « noter »).
  if ([...texte].length >= 280 && sait("retenir-choix-v1")) {
    let m;
    try {
      m = await charger("retenir");
    } catch {
      return dire(FENETRE_ABSENTE, { genre: "erreur" });
    }
    try {
      const r = await m.ouvrirRetenir?.({ texte, source: "note" });
      if (!r) return;
      if (refs.champ.value.trim() === texte) mettreAuChamp("");
      modeRetenir = false;
      majComposeur();
      dire(r.phrase || "Retenu.", { genre: "succes" });
    } catch (err) {
      dire(`Pas retenu : ${texteErreur(err)} Ton texte est toujours là.`, { genre: "erreur" });
    }
    return;
  }
  enCapture = true;
  majBoutonRetenir();
  refs.retenir.setAttribute("aria-busy", "true");
  try {
    const r = await ecrire("/api/capture", { texte, source: "note", idCapture: nouvelId() }, { delai: 95000 });
    if (refs.champ.value.trim() === texte) mettreAuChamp("");
    modeRetenir = false;
    dire(R.phraseCapture(r), { genre: "succes" });
  } catch (err) {
    if (err.nature !== "auth") dire(`Pas retenu : ${texteErreur(err)} Ton texte est toujours là.`, { genre: "erreur" });
  } finally {
    enCapture = false;
    refs.retenir.removeAttribute("aria-busy");
    majComposeur();
  }
}

// --- Dictée (module du lot « noter ») ---
function ajouterDictee(texte, cle, prive) {
  const t = String(texte || "").trim();
  if (!t) return;
  // Le texte va au champ du fil où la dictée a commencé, jamais ailleurs.
  if (champVivant() && cleDe(courante) === cle) {
    mettreAuChamp(R.ajouterDictee(refs.champ.value, t));
    refs.champ.focus();
  } else rendreAuChamp(t, { cle, prive });
}
function monterVocaux() {
  if (!refs.vocaux || !modDictee?.monterAttente) return;
  const cle = cleDe(courante);
  const prive = composeurPrive(courante);
  vider(refs.vocaux);
  try {
    modDictee.monterAttente(refs.vocaux, { prive, surTexte: (t) => ajouterDictee(t, cle, prive) });
  } catch (err) {
    console.warn("Vocaux en attente :", err);
  }
}
/** La tour sait-elle transcrire ? (GET /api/transcribe, sans appel IA) ; muette : ce qu'on savait. */
async function sonderTranscription() {
  if (transcriptionDispo === true) return true;
  try {
    const t = await api("/api/transcribe", { delai: 8000 });
    transcriptionDispo = t?.available !== false;
  } catch {}
  return transcriptionDispo;
}
async function dicter() {
  if (!modDictee) {
    try {
      modDictee = await charger("dictee");
    } catch {
      dire(FENETRE_ABSENTE, { genre: "erreur" });
      return;
    }
    monterVocaux();
  }
  try {
    if ((await modDictee.disponible?.()) === false) {
      dire("La dictée n'est pas disponible ici (micro non accessible).", { genre: "erreur" });
      return;
    }
    const gen = generation;
    const transcription = await sonderTranscription();
    if (generation !== gen || !champVivant()) return; // Sam est parti entre-temps : rien ne s'enregistre
    const cle = cleDe(courante);
    const prive = composeurPrive(courante);
    dicteeEnCours = await modDictee.demarrerDictee?.({
      ancre: refs.boite,
      prive,
      // false : aucun moteur sur la tour, le module le dit AVANT d'enregistrer.
      transcription: transcription !== false,
      // Pendant la transcription, rien ne part (le texte arrive dans le champ).
      surEtat: (e) => {
        etatDictee = e;
        majEnvoyer();
      },
      surTexte: (t) => ajouterDictee(t, cle, prive),
    });
  } catch (err) {
    dire(`Dictée impossible : ${texteErreur(err)}`, { genre: "erreur" });
  }
}

// --- Corriger la dictée : un mot surligné, mal transcrit ---
function selectionChamp() {
  const c = refs.champ;
  if (!c) return null;
  const debut = c.selectionStart;
  const fin = c.selectionEnd;
  if (debut == null || fin == null || fin <= debut) return null;
  const entendu = c.value.slice(debut, fin);
  if (!entendu.trim() || [...entendu].length > 80) return null;
  return { debut, fin, entendu };
}
function majCorrection() {
  if (!refs.corriger) return;
  if (document.activeElement === refs.champ) selectionDictee = selectionChamp();
  refs.corriger.hidden = !(sait("dictee-correction-v1") && !courante?.origine && selectionDictee && document.activeElement === refs.champ);
}
function remplacerDansChamp(s, par) {
  const v = refs.champ.value;
  if (v.slice(s.debut, s.fin) !== s.entendu) return false;
  mettreAuChamp(v.slice(0, s.debut) + par + v.slice(s.fin));
  refs.champ.focus();
  refs.champ.setSelectionRange(s.debut + par.length, s.debut + par.length);
  return true;
}
function corrigerDictee(s) {
  const id = `bon-mot-${Math.random().toString(36).slice(2, 8)}`;
  const champ = h("input", { class: "champ", id, type: "text", autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false", placeholder: "Le bon mot" });
  champ.value = s.entendu;
  const envoyer = bouton("Envoyer à Dictée Locale", { classe: "plein" });
  const maj = () => {
    const v = champ.value.trim();
    envoyer.disabled = !v || v === s.entendu;
  };
  let f;
  let enCours = false;
  const valider = (e) => {
    e?.preventDefault();
    // Une seule correction à la fois : Entrée soumet le formulaire même bouton désactivé.
    if (enCours) return;
    const voulu = champ.value.trim();
    if (!voulu || voulu === s.entendu) return champ.focus();
    enCours = true;
    occupe(envoyer, async () => {
      try {
        await ecrire("/api/dictee/correction", { entendu: s.entendu, voulu });
        f.fermer();
        remplacerDansChamp(s, voulu);
        dire(`Dictée Locale retiendra « ${voulu} ».`, { genre: "succes" });
      } catch (err) {
        if (err.nature !== "auth") dire(`Pas envoyé à Dictée Locale : ${texteErreur(err)}`, { genre: "erreur" });
      }
    }).then(() => {
      enCours = false;
      maj();
    });
  };
  champ.addEventListener("input", maj);
  envoyer.addEventListener("click", valider);
  const form = h("form", { onsubmit: valider },
    h("p", { class: "aide", style: { marginBottom: "10px" } }, `« ${s.entendu} » a été mal compris ? Tape le bon mot : Dictée Locale l'apprendra pour tes prochaines dictées.`),
    h("label", { class: "etiquette-champ", for: id }, "Le bon mot"), champ);
  f = feuille({ titre: "Corriger la dictée", contenu: form, pied: [bouton("Annuler", { classe: "papier", onclick: () => f.fermer() }), envoyer] });
  maj();
  champ.focus();
  champ.select();
}

// --- Appeler Rémy (module du lot « noter ») ---
async function appeler() {
  if (courante?.origine) return;
  if (envoi) return dire(OCCUPE);
  let m;
  try {
    m = await charger("appel");
  } catch {
    return dire(FENETRE_ABSENTE, { genre: "erreur" });
  }
  try {
    const id = await m.ouvrirAppel?.({ ctx, conv: courante?.id || null, prive: composeurPrive(courante) });
    await chargerListe();
    if (!id) return;
    if (id === courante?.id) {
      if (!envoi) await recharger(id);
    } else ctx.aller(`remy/${seg(id)}`);
  } catch (err) {
    direErreur(err, null, "Appel impossible");
  }
}

// --- Copier ---
async function copier(texte, { annonce = "Copié.", genre = "succes" } = {}) {
  try {
    await navigator.clipboard.writeText(texte);
    dire(annonce, { genre });
    return true;
  } catch {
    // Repli : la commande du navigateur (champ temporaire, sélectionné).
    try {
      const hote = [...document.querySelectorAll("dialog[open]")].pop() || document.body;
      const t = h("textarea", { "aria-hidden": "true", style: { position: "fixed", opacity: "0", left: "-9999px" } });
      t.value = texte;
      hote.append(t);
      t.select();
      const ok = document.execCommand("copy");
      t.remove();
      if (ok) {
        dire(annonce, { genre });
        return true;
      }
    } catch {}
    dire("Copie impossible : sélectionne-le à la main.", { genre: "erreur" });
    return false;
  }
}
/** Ce que la tour sait de l'erreur (jamais le contenu des messages) ; tour injoignable : le message et son code. */
async function copierDiagnostic(code, message) {
  let d = null;
  try {
    d = await api(`/api/incidents/${seg(code)}`, { delai: 10000 });
  } catch {}
  if (d) await copier(R.jsonTrie(d), { annonce: `Diagnostic ${code} copié : colle-le où tu veux.` });
  else await copier(R.copieSansDetail(message, code), { annonce: "Tour injoignable : le code est copié, sans le détail.", genre: "info" });
}

// --- Le panneau : jauge du contexte, Compacter, étapes ---
const SVG = "http://www.w3.org/2000/svg";
function svg(tag, attrs, ...enfants) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  el.append(...enfants);
  return el;
}
/** Le cadran (CadranJauge) : un arc ouvert en bas, rempli selon la place ; sans taille connue, il reste vide. */
function cadran(j) {
  const f = j.fraction ?? 0;
  const arc = (classe, longueur) => svg("circle", { cx: 18, cy: 18, r: 15, pathLength: 100, class: classe, "stroke-dasharray": `${longueur} 100`, transform: "rotate(135 18 18)" });
  const texte = svg("text", { x: 18, y: 20.5, "text-anchor": "middle", class: "remy-cadran-texte" });
  texte.textContent = j.fraction != null ? R.fmtPourcent(j.fraction) : "–";
  return svg("svg", { viewBox: "0 0 36 36", class: `remy-cadran niveau-${j.niveau}`, "aria-hidden": "true" },
    arc("piste", 75), j.fraction != null ? arc("valeur", Math.max(0.5, 75 * f)) : "", texte);
}
const ligneInfo = (titre, valeur, { detail, vif = false } = {}) => h("div", { class: "remy-info" },
  h("div", { class: "remy-info-ligne" }, h("span", null, titre), h("span", { class: `mono${vif ? " vif" : ""}` }, valeur)),
  detail ? h("p", { class: "aide" }, detail) : null);

function dessinerPanneau() {
  const p = refs.panneau;
  if (!p) return;
  const c = courante;
  const blocs = [h("button", { type: "button", class: "btn texte icone remy-fermer-panneau", "aria-label": "Fermer le panneau", title: "Fermer (Échap)", onclick: () => { basculerPanneau(); refs.btnPanneau.focus(); } }, icone("fermer"))];
  if (c?.prive) {
    blocs.push(h("div", { class: "carte-privee" }, h("strong", null, icone("cadenas"), "Privée"), h("p", null, `${sousTitrePrivee(etatPrivee)}.`),
      etatPrivee === "permise" ? h("p", { class: "aide", style: { marginTop: "4px" } }, "Recherche web permise : des questions générales, filtrées, peuvent sortir vers le moteur.") : null,
      c.id ? bouton("Ce que change « privée »", { classe: "texte petit", onclick: feuillePrivee }) : null));
  }
  const j = R.jauge(c?.messages);
  const avecJauge = jaugeVisible() && c && !c.origine && (c.messages?.length || envoi);
  if (avecJauge) blocs.push(sectionPlace(j));
  // Compacter : seulement un fil affiché (ni en chargement, ni absent, ni illisible).
  if (c?.id && !c.origine && !c.chargement && !c.introuvable && sait("compactage-v1")) blocs.push(sectionCompacter(j, c));
  if (avecJauge) blocs.push(...sectionsDetail(j));
  const source = envoi?.ligne || [...(c?.messages || [])].reverse().find((m) => m.role !== "user" && m._etapes?.length);
  const etapes = source?._etapes || [];
  const enCours = Boolean(source?._enCours);
  const totalMs = enCours ? null : R.totalReponse({ debut: source?._debut, fin: source?._fin, etapes });
  blocs.push(h("section", null, h("h2", { class: "titre-section" }, "Étapes"),
    etapes.length ? h("div", { class: "etapes" }, etapes.map((e, i) => h("div", { class: `etape${enCours && i === etapes.length - 1 ? " courante" : ""}` }, h("span", { class: "point" }), h("span", null, e.texte), h("span", { class: "t" }, R.dureeEtape(etapes, i, { enCours, totalMs })))))
      : h("p", { class: "aide" }, "Ce que fait Rémy pendant sa prochaine réponse : relire ton planning, chercher sur le web en local, lire des pages…")));
  const focus = p.contains(document.activeElement) ? document.activeElement?.dataset?.cle : null;
  vider(p, blocs);
  if (focus) p.querySelector(`[data-cle="${focus}"]`)?.focus();
  majBoutonJauge();
}

function sectionPlace(j) {
  const s = h("section", { class: "jauge remy-jauge", "aria-label": "Jauge du contexte" }, h("h2", { class: "titre-section" }, "Contexte"));
  s.append(h("div", { class: "remy-place" }, cadran(j),
    h("div", null, j.contexte != null
      ? [h("p", { class: "remy-gros" }, `${R.fmtJetons(j.contexte)} tokens`), h("p", { class: "aide" }, R.surFenetre(j))]
      : [h("p", { class: "remy-gros" }, "Pas encore mesuré"), h("p", { class: "aide" }, R.pasEncoreMesure({ envoi: Boolean(envoi), machine: j.machine }))])));
  const phrase = R.phraseNiveau(j);
  if (phrase) {
    const b = bouton("Nouvelle conversation", { classe: j.niveau === "plein" ? "plein petit" : "papier petit", icone: "plus", onclick: () => { refs.racine.classList.remove("panneau-ouvert"); ctx.aller("remy/nouvelle"); } });
    b.disabled = Boolean(envoi);
    s.append(h("div", { class: `remy-niveau niveau-${j.niveau}` }, h("p", null, phrase), b));
  }
  return s;
}

function sectionsDetail(j) {
  const sections = [];
  if (j.modele != null || j.machine != null) {
    sections.push(h("section", { class: "remy-qui" }, h("h2", { class: "titre-section" }, "Dernière réponse écrite par"),
      j.modele != null ? ligneInfo("Modèle", j.modele) : null, j.machine != null ? ligneInfo("Machine", j.machine) : null));
  }
  const r = R.repartitionJauge(j);
  if (r) {
    const couleurs = { systeme: "var(--encre)", conversation: "var(--signal)", outils: "var(--encre-3)" };
    sections.push(h("section", { class: "jauge remy-repartition" }, h("h2", { class: "titre-section" }, "D'où vient la place"),
      h("div", { class: "barre", role: "img", "aria-label": r.blocs.map((b) => `${b.libelle} ≈ ${R.fmtJetons(b.jetons)}`).join(", ") },
        r.blocs.filter((b) => b.jetons > 0).map((b) => h("span", { style: { width: `${Math.max(1.5, (b.jetons / r.total) * 100)}%`, background: couleurs[b.cle] } }))),
      h("ul", { class: "legende" },
        r.blocs.map((b) => h("li", null, h("i", { style: { background: couleurs[b.cle] } }), b.libelle, h("span", { class: "mono", style: { marginLeft: "auto" } }, `≈ ${R.fmtJetons(b.jetons)}`))),
        r.libre != null ? h("li", null, h("i", { class: "libre" }), "Libre", h("span", { class: "mono", style: { marginLeft: "auto" } }, R.fmtJetons(r.libre))) : null)));
  }
  const direct = envoi?.ligne?._enCours ? envoi.ligne._debit : null;
  sections.push(h("section", { class: "remy-vitesse" }, h("h2", { class: "titre-section" }, "Vitesse de Rémy"),
    direct > 0 ? ligneInfo("En ce moment", R.fmtTps(direct), { detail: "réponse en cours", vif: true }) : null,
    j.derniere ? ligneInfo("Dernière réponse", R.fmtTps(j.derniere.tps), { detail: R.detailDebit(j.derniere) }) : null,
    j.moyenne && j.reponsesMesurees > 1 ? ligneInfo("Moyenne du fil", R.fmtTps(j.moyenne.tps), { detail: R.detailMoyenne(j) }) : null,
    !j.derniere && !(direct > 0) ? h("p", { class: "aide" }, "Pas encore de vitesse mesurée dans ce fil.") : null));
  sections.push(h("p", { class: "remy-note" }, R.noteJauge(j).map((t) => h("span", null, t))));
  return sections;
}

function sectionCompacter(j, c) {
  const atteint = j.fraction != null && j.fraction >= R.SEUIL_COMPACTAGE;
  const action = compactageEnCours
    ? h("p", { class: "remy-statut" }, h("span", { class: "remy-curseur petit", "aria-hidden": "true" }), h("span", null, "Rémy résume le début du fil…"))
    : (() => {
      const b = bouton("Compacter maintenant", { classe: `${j.niveau !== "calme" ? "plein" : "papier"} petit`, icone: "compresser", titre: "Résumer le début du fil (modèle local, sur tes machines)", onclick: () => compacterMaintenant(c) });
      b.dataset.cle = "compacter";
      b.disabled = Boolean(envoi);
      return b;
    })();
  const resume = Number(c.compactage?.jusqua) > 0 && String(c.compactage?.resume || "").trim();
  return h("section", { class: "remy-compacter" }, h("h2", { class: "titre-section" }, "Compacter"),
    h("p", { class: `remy-phrase-compactage${atteint ? " atteint" : ""}` }, R.phraseCompactage(j, { compactage: c.compactage, automatique: autoCompactage, messages: messagesTour(c).length })),
    action,
    h("p", { class: "aide" }, "Rémy résume le début du fil (sur tes machines) et garde les derniers messages en entier : la suite repart plus légère. Rien n'est effacé."),
    resume ? bouton("Voir le résumé", { classe: "texte petit", onclick: () => feuilleResume(c.compactage.resume) }) : null);
}

async function compacterMaintenant(c) {
  if (compactageEnCours || envoi || !c?.id) return;
  compactageEnCours = true;
  dessinerPanneau();
  try {
    const r = await ecrire(`/api/conversations/${seg(c.id)}/compacter`, {}, { delai: 300000 });
    if (r?.compactage) {
      c.compactage = r.compactage;
      if (courante === c) insererRepere(c);
    }
    dire(R.phraseCompacte(r), { genre: r?.compacte ? "succes" : "info" });
  } catch (err) {
    direErreur(err, () => compacterMaintenant(c), "Pas compacté");
  } finally {
    compactageEnCours = false;
    if (courante === c) dessinerPanneau();
  }
}

/** Le résumé automatique se fait sur la tour après la réponse : relu quand le panneau est sous les yeux. */
async function relireCompactage() {
  const c = courante;
  if (!c?.id || envoi || !sait("compactage-v1") || c.origine) return;
  try {
    const conv = await api(`/api/conversations/${seg(c.id)}`);
    if (courante !== c || envoi) return;
    if ((Number(conv.compactage?.jusqua) || 0) > (Number(c.compactage?.jusqua) || 0)) {
      c.compactage = conv.compactage;
      insererRepere(c);
      dessinerPanneau();
    }
  } catch {}
}
