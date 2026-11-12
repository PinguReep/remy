// Réglages, au niveau de l'iPhone (ReglagesView et ses écrans), adapté à
// l'ordinateur : un maître (les sections, par groupe) et le détail. La
// recherche en tête (analyse/recherche-reglages.js, aussi dans Ctrl+K) ouvre
// la section du résultat, fait défiler jusqu'à la ligne, lui donne le focus
// et la met en évidence 4 s. Sections : Ordinateur (app Windows), Apparence,
// Noter, Envoi en attente, Rémy (liens, recherche web, cloud, circuits),
// Ce que Rémy sait de toi, Ce qui compte, Modèle, Règles, À trancher et
// revue, Activité du PC, Localisation, Sources des conversations, Agenda,
// Appareils, Jeton, Coûts, Ce que tu utilises vraiment, Nouveautés,
// Diagnostic, Avancé. Une section dont la tour ne connaît pas la fonction
// est cachée. Le clic droit fait ce que fait l'appui long de l'iPhone.
// Les calculs (phrases, durées, délais, aEnvoyer…) sont exportés : testés
// sous node (test/site-reglages.test.mjs).
import { api, ecrire, remplacer, modifier, supprimer, seg, sait, versionTour, mesuresPoste } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, squelette, blocErreur, vide, confirmer, feuille, quand, heure, jourCourt, duree, markdown, occupe, appliquerTheme, themeChoisi, local, ctrl, texteErreur, memeJour } from "../ui.js";
import * as bureau from "../bureau.js";
import * as fileEnvoi from "../file-envoi.js";
import * as usage from "../usage.js";
import * as nouveautes from "../nouveautes.js";
import { surMenu } from "../menu.js";
import { CLE_PAR_DEFAUT, parDefaut } from "./noter.js";
import { verrouRecherchePrivee, CE_QUI_SORT } from "../analyse/privee.js";
import * as R from "../analyse/recherche-reglages.js";

let racine;
let ctx;
let section = "ordinateur";
let refs = {};
let recherche = "";
/** GET /api/reglages, relu à l'ouverture et après chaque changement (la recherche s'en sert). */
let reglagesTour = null;
/** GET /api/dashboard (jours actifs, réflexion de nuit) : au plus une lecture par minute. */
let tableau = { a: 0, promesse: null };
/** Ce qu'un résultat de recherche (ou Ctrl+K) a visé : { section, ancre, note }. */
let repereEnAttente = null;
/** Des changements pas encore enregistrés dans la section (Mémoire, Ce qui compte) : leur nom, ou null. */
let garde = () => null;
let minuteurRepere = null;
/** Le contrôle qui avait le focus au début d'un geste : il le retrouve une fois la section redessinée. */
let focusApres = null;
/** La file d'envoi suivie tant que Réglages est ouvert (pastille du maître, section « Envoi en attente »). */
let desabonnerFile = null;
let minuteurFile = null;

// Une section dont la tour ne connaît pas encore la fonction est cachée
// (comme sur l'iPhone), et la recherche dit que l'entrée en dépend.
const CAPACITE_SECTION = {
  conversations: "conversations-externes-v1",
  modele: "modeles-v1",
  activite: "activite-pc-v1",
  regles: "regles-v1",
  appareils: "appareils",
  priorites: "priorites-v1",
  lieux: "lieux-v1",
  revue: "a-trancher-v1",
  nouveautes: "version",
};
const sectionVisible = (id) => !CAPACITE_SECTION[id] || sait(CAPACITE_SECTION[id]);
const sectionsVisibles = () => R.SECTIONS.filter((s) => sectionVisible(s.id));

/** Ce que l'écran montre en ce moment, pour la recherche (capacités, réglages lus, app Windows). */
export function contexteRecherche() {
  const n = bureau.estBureau() ? bureau.reglagesNotifs() : {};
  return { capacites: versionTour()?.capacites || [], reglages: reglagesTour, bureau: bureau.estBureau(), briefing: n.briefing === true, bilan: n.bilan === true };
}
/** Les entrées de l'index que la tour propose (Ctrl+K sans saisie). */
export const indexVisible = () => R.entreesVisibles(contexteRecherche());

/**
 * Le groupe Réglages de Ctrl+K : le même classement que la recherche de
 * Réglages. Rend [{ titre, chemin, faire }].
 */
export function rechercherReglages(q, contexte) {
  return R.chercher(q, contexteRecherche()).entrees.map((e) => ({ id: e.id, titre: e.titre, chemin: R.chemin(e), sous: e.sous, faire: () => ouvrirEntree(e, contexte) }));
}

/**
 * Ctrl+K avant tout passage par Réglages : les réglages de la tour (recherche
 * web, secours, circuits) sont lus à l'ouverture de la palette, sinon ces
 * lignes resteraient introuvables. Une seule lecture ; un échec ne dit rien
 * (la palette garde le reste).
 */
export function prechargerReglages() {
  if (reglagesTour || !sait("reglages")) return Promise.resolve(reglagesTour);
  return lireReglages();
}

/** Ouvre la section d'une entrée, sa ligne mise en évidence (recherche, Ctrl+K). */
export function ouvrirEntree(e, contexte = ctx) {
  const c = R.cible(e, contexteRecherche());
  repereEnAttente = c;
  contexte.aller(`reglages/${c.section}`);
}

export default {
  async monter(el, args, contexte) {
    racine = el;
    ctx = contexte;
    section = sectionsVisibles().some((s) => s.id === args[0]) ? args[0] : null;
    refs.recherche = h("input", { class: "champ", type: "search", placeholder: "Chercher un réglage", "aria-label": "Chercher dans les réglages", autocomplete: "off",
      oninput: (e) => { recherche = e.target.value; dessinerMaitre(); },
      onkeydown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const p = R.premier(recherche, contexteRecherche());
          if (p) choisir(p);
        } else if (e.key === "ArrowDown") {
          const b = refs.maitre.querySelector(".reglages-resultat, .reglages-suggestions button");
          if (b) { e.preventDefault(); b.focus(); }
        }
      } });
    refs.maitre = h("nav", { class: "maitre", "aria-label": "Sections des réglages" });
    refs.detail = h("section", { class: "detail", "aria-live": "off" });
    refs.detail.addEventListener("keydown", (e) => {
      // Ctrl+S : enregistrer la section (Mémoire en correction, Ce qui compte).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        const b = refs.detail.querySelector("[data-enregistrer]");
        if (!b) return;
        e.preventDefault();
        if (!b.disabled) b.click();
      }
    });
    refs.grille = h("div", { class: "reglages-grille" }, h("div", null, h("div", { class: "recherche-champ" }, icone("recherche"), refs.recherche, h("span", { class: "kbd" }, "/")), refs.maitre), refs.detail);
    vider(el, h("header", { class: "entete-ecran" }, h("div", { class: "titres" }, h("div", { class: "sur-titre" }, "Rémy"), h("h1", { class: "titre-ecran" }, "Réglages"))), refs.grille);
    if (!section && matchMedia("(min-width: 721px)").matches) section = "ordinateur";
    dessinerMaitre();
    // Les réglages de la tour : la recherche en a besoin pour savoir ce qui s'affiche.
    if (sait("reglages")) lireReglages().then(() => recherche.trim() && dessinerMaitre()).catch(() => {});
    window.addEventListener("beforeunload", avantDeFermer);
    desabonnerFile?.();
    desabonnerFile = fileEnvoi.surChangement(fileChangee);
    await dessinerSection();
  },
  /** Une autre section (ou la même, par la recherche ou Ctrl+K). Rend false si Sam a gardé ses changements. */
  async suivre(args) {
    const voulue = sectionsVisibles().some((s) => s.id === args[0]) ? args[0] : null;
    if (voulue === section && garde()) {
      // Déjà ouverte, avec des changements pas enregistrés : la ligne visée
      // est mise en évidence sur place, rien n'est relu ni perdu.
      dessinerMaitre();
      appliquerRepere();
      return true;
    }
    if (voulue !== section && !(await peutQuitterSection())) {
      history.replaceState(null, "", `#/reglages${section ? `/${section}` : ""}`);
      return false;
    }
    section = voulue;
    dessinerMaitre();
    await dessinerSection();
    return true;
  },
  /** main.js le demande avant de changer de vue : des changements non enregistrés se confirment. */
  peutQuitter: () => peutQuitterSection(),
  actualiser() {
    dessinerMaitre();
    if (!garde()) dessinerSection();
  },
  chercher() {
    refs.recherche?.focus();
  },
  demonter() {
    window.removeEventListener("beforeunload", avantDeFermer);
    clearTimeout(minuteurRepere);
    desabonnerFile?.();
    desabonnerFile = null;
    clearTimeout(minuteurFile);
    minuteurFile = null;
    garde = () => null;
  },
};

/**
 * La file d'envoi a changé (une note part, revient, est retirée) : la pastille
 * du maître, le rail et la section « Envoi en attente » la suivent, comme
 * FileEnvoiVue. Les changements d'un même envoi se redessinent une fois.
 */
function fileChangee() {
  if (minuteurFile) return;
  minuteurFile = setTimeout(() => redessinerFile(), 0);
}
async function redessinerFile() {
  clearTimeout(minuteurFile);
  minuteurFile = null;
  ctx?.majCompteurs?.();
  majPastilleFile();
  if (section !== "file" || !refs.detail?.isConnected) return;
  // Le focus reste sur le même bouton de la même ligne ; si la ligne est partie, sur le titre.
  const avant = document.activeElement;
  const dedans = refs.detail.contains(avant);
  const cle = dedans ? avant.dataset?.cle : null;
  await dessinerSection(null);
  if (!dedans || section !== "file") return;
  const el = cle ? [...refs.detail.querySelectorAll("[data-cle]")].find((x) => x.dataset.cle === cle && !x.disabled) : null;
  (el || refs.detail.querySelector("h2"))?.focus();
}
/** La pastille « Envoi en attente » du maître, mise à jour sur place (le focus du maître ne bouge pas). */
function majPastilleFile() {
  const a = refs.maitre?.querySelector('a.element-maitre[href="#/reglages/file"]');
  if (!a) return;
  const n = fileEnvoi.compte();
  const p = a.querySelector(".pastille-compte");
  if (n && p) p.textContent = String(n);
  else if (n) a.append(h("span", { class: "pastille-compte" }, String(n)));
  else p?.remove();
  if (n) a.setAttribute("aria-label", `${R.titreSection("file")}, ${n}`);
  else a.removeAttribute("aria-label");
}

function avantDeFermer(e) {
  if (!garde()) return;
  e.preventDefault();
  e.returnValue = "";
}

/** Quitter la section avec des changements non enregistrés : confirmer() d'abord. */
async function peutQuitterSection() {
  const quoi = garde();
  if (!quoi) return true;
  const ok = await confirmer(`Quitter sans enregistrer ${quoi} ?`, { detail: "Tes changements ne sont pas encore partis vers ta tour : ils seront perdus.", libelle: "Quitter sans enregistrer", danger: true });
  if (ok) garde = () => null;
  return ok;
}

async function lireReglages() {
  reglagesTour = await api("/api/reglages", { delai: 10000 });
  return reglagesTour;
}

/** Le tableau du jour, lu au plus une fois par minute (jours actifs, réflexion de nuit). */
function lireTableau() {
  if (tableau.promesse && Date.now() - tableau.a < 60000) return tableau.promesse;
  tableau = { a: Date.now(), promesse: api("/api/dashboard", { delai: 20000 }).catch(() => null) };
  return tableau.promesse;
}

// --- Le maître : les sections, ou les résultats de la recherche ---

function dessinerMaitre() {
  const q = recherche.trim();
  refs.grille.classList.toggle("detail-ouvert", Boolean(section) && !q);
  if (q) return vider(refs.maitre, resultats(R.chercher(q, contexteRecherche())));
  const groupes = [];
  for (const s of sectionsVisibles()) {
    let g = groupes.find((x) => x.nom === s.groupe);
    if (!g) groupes.push((g = { nom: s.groupe, sections: [] }));
    g.sections.push(s);
  }
  const m = nouveautes.modele({ sait });
  vider(refs.maitre, groupes.map((g) => h("div", { class: "groupe" },
    h("div", { class: "reglages-groupe-titre" }, g.nom),
    g.sections.map((s) => {
      const n = s.id === "file" ? fileEnvoi.compte() : s.id === "nouveautes" ? m.aDecouvrir() : 0;
      return h("a", { class: "element-maitre", href: `#/reglages/${s.id}`, "aria-current": section === s.id ? "page" : null, "aria-label": n ? `${s.titre}, ${n}` : null },
        icone(s.icone), h("span", { class: "t" }, s.titre), n ? h("span", { class: "pastille-compte" }, String(n)) : null);
    }))));
}

/** Les résultats : en-tête, titre + chemin + sous-titre, ou l'état vide et trois suggestions. */
function resultats(r) {
  if (r.titreVide) {
    return h("div", { class: "resultats-recherche vide-recherche", role: "status" },
      icone("recherche", "reglages-loupe"),
      h("strong", null, r.titreVide),
      h("p", { class: "aide" }, r.detailVide),
      r.indisponibles.length ? null : h("div", { class: "rangee serree reglages-suggestions" }, R.SUGGESTIONS.map((s) => h("button", { type: "button", class: "puce", onclick: () => {
        recherche = s;
        refs.recherche.value = s;
        dessinerMaitre();
        refs.recherche.focus();
      } }, s))));
  }
  const lignes = r.entrees.map((e) => h("li", null, h("button", { type: "button", class: "reglages-resultat", onclick: () => choisir(e),
    onkeydown: (ev) => {
      const tous = [...refs.maitre.querySelectorAll(".reglages-resultat")];
      const i = tous.indexOf(ev.currentTarget);
      if (ev.key === "ArrowDown") { ev.preventDefault(); tous[Math.min(tous.length - 1, i + 1)]?.focus(); }
      if (ev.key === "ArrowUp") { ev.preventDefault(); (i > 0 ? tous[i - 1] : refs.recherche).focus(); }
    } },
  icone(R.SECTIONS.find((s) => s.id === e.section)?.icone || "reglages"),
  h("span", { class: "corps" }, h("span", { class: "titre-ligne" }, e.titre), h("span", { class: "chemin" }, R.chemin(e)), h("span", { class: "sous" }, e.sous)),
  icone("chevron"))));
  return h("div", { class: "resultats-recherche" }, h("p", { class: "reglages-entete", role: "status" }, r.enTete), h("ul", { class: "liste" }, lignes));
}

/** Un résultat choisi : sa section, la ligne visée. Au pouce, la recherche se ferme pour montrer la section. */
function choisir(e) {
  if (matchMedia("(max-width: 720px)").matches) {
    recherche = "";
    refs.recherche.value = "";
  }
  ouvrirEntree(e, ctx);
}

/** Va à la ligne visée : défilement centré, focus, mise en évidence ~4 s ; le repli est dit. */
function appliquerRepere(essai = 0) {
  const v = repereEnAttente;
  if (!v || v.section !== section) return;
  const cible = v.ancre ? trouverRepere(v.ancre) : refs.detail.querySelector("h2");
  // Une section qui finit de se charger (les sources des conversations) : encore un peu.
  if (!cible) {
    if (essai < 12) setTimeout(() => appliquerRepere(essai + 1), 250);
    else repereEnAttente = null;
    return;
  }
  repereEnAttente = null;
  refs.detail.querySelectorAll(".reglages-repere").forEach((x) => x.classList.remove("reglages-repere"));
  cible.classList.add("reglages-repere");
  const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
  cible.scrollIntoView({ block: "center", behavior: reduit ? "auto" : "smooth" });
  // Une section qui finit de se remplir (les mesures, les sources) pousse la ligne : on recentre.
  for (const ms of [450, 1000]) setTimeout(() => cible.isConnected && cible.classList.contains("reglages-repere") && cible.scrollIntoView({ block: "center", behavior: reduit ? "auto" : "smooth" }), ms);
  const controle = cible.matches("input, button, select, textarea, a[href]") ? cible : cible.querySelector("input:not([disabled]), button:not([disabled]), select, textarea, a[href]");
  if (controle) controle.focus({ preventScroll: true });
  else {
    cible.setAttribute("tabindex", "-1");
    cible.focus({ preventScroll: true });
  }
  if (v.note) dire(v.note);
  clearTimeout(minuteurRepere);
  minuteurRepere = setTimeout(() => cible.classList.remove("reglages-repere"), 4000);
}
function trouverRepere(ancre) {
  const parAttribut = [...refs.detail.querySelectorAll("[data-repere]")].find((x) => x.dataset.repere === ancre);
  if (parAttribut) return parAttribut;
  // Une ligne dessinée par un autre module (les sources des conversations) : par son texte.
  const t = (s) => s.replace(/\s+/g, " ").trim();
  const el = [...refs.detail.querySelectorAll("h2, h3, strong, button, label, summary, .titre-ligne")].find((x) => t(x.textContent) === ancre || t(x.textContent).startsWith(ancre));
  return el?.closest(".reglage, .ligne, label, button") || el || null;
}

// --- Briques de l'écran ---

/** Une ligne que la recherche sait retrouver : `ancre` est son titre, tel qu'affiché. */
const repere = (ancre, el) => {
  el.dataset.repere = ancre;
  return el;
};
const retour = () => h("a", { class: "btn texte petit lien-retour-projets", href: "#/reglages" }, icone("retour"), "Réglages");
/**
 * « Essayer la lecture des pièces » (12/11) : la tour essaie elle-même son OCR,
 * son modèle local avec une image d'essai et un PDF d'essai, et dit le
 * résultat ligne par ligne. Seulement sur ce geste (0 $, modèle local).
 */
function essaiPieces() {
  const resultat = h("div", { class: "reglages-essai-pieces", "aria-live": "polite" });
  let diagnostic = "";
  const copier = bouton("Copier le diagnostic", { classe: "papier petit", icone: "copier", onclick: async () => {
    try {
      await navigator.clipboard.writeText(diagnostic);
      dire("Diagnostic copié.", { genre: "succes" });
    } catch {
      dire("Copie impossible ici.", { genre: "erreur" });
    }
  } });
  copier.hidden = true;
  const essayer = bouton("Essayer la lecture des pièces", { classe: "papier", icone: "trombone", onclick: (e) => occupe(e.currentTarget, async () => {
    copier.hidden = true;
    vider(resultat, h("p", { class: "aide" }, "La tour essaie… (jusqu'à une minute : le modèle local regarde une image d'essai)"), squelette([0.7, 0.6, 0.4]));
    try {
      const r = await api("/api/pieces/essai", { methode: "POST", corps: {}, delai: 100000 });
      diagnostic = r.diagnostic || "";
      vider(resultat, ...(r.lignes || []).map((l) => h("div", { class: `ligne-essai ${l.ok ? "ok" : "non"}` }, icone(l.ok ? "coche" : "fermer"), h("span", null, h("strong", null, `${l.libelle} : `), l.detail))));
      copier.hidden = !diagnostic;
    } catch (err) {
      vider(resultat, erreurSection(`Essai impossible : ${texteErreur(err)}`, () => essayer.click()));
    }
  }) });
  return repere("Lecture des pièces jointes", h("div", { class: "reglage" },
    h("h3", { class: "titre-section reglages-sous-titre" }, "Lecture des pièces jointes"),
    h("p", { class: "aide" }, "Ce que ta tour sait lire de ce que tu joins, ici ou depuis l'iPhone : le texte des images (reconnaissance de Windows, sur la tour), les images (le modèle local), les PDF ; et si le modèle peut relire une pièce. Des fichiers d'essai, rien de toi."),
    h("div", { class: "rangee", style: { marginTop: "8px" } }, essayer, copier), resultat));
}

function carte(titre, aide, ...contenu) {
  return h("section", { class: "carte section-reglage" }, retour(), h("h2", { tabindex: "-1" }, titre), aide ? h("p", { class: "aide" }, aide) : null, ...contenu);
}
const sousTitre = (texte) => h("h3", { class: "titre-section reglages-sous-titre" }, texte);
const info = (texte, ic = "alerte") => h("p", { class: "reglages-info" }, icone(ic), h("span", null, texte));
const tourne = () => h("span", { class: "reglages-tourne", "aria-hidden": "true" });

/**
 * Un groupe de bascules qui écrivent sur la tour : un seul changement à la
 * fois, toutes désactivées pendant l'envoi.
 */
function groupeBascules() {
  const g = {
    occupe: false,
    inputs: new Set(),
    pendant(v) {
      g.occupe = v;
      for (const i of g.inputs) i.disabled = v || i.dataset.desactive === "1";
    },
  };
  return g;
}

/**
 * Un interrupteur : titre, détail, valeur, et `changer(voulu)` qui rend une
 * promesse (refusée : l'interrupteur revient et l'erreur est dite avec
 * Réessayer). `repere` : le titre par défaut.
 */
function bascule(titre, detail, valeur, changer, { desactive = false, groupe = null, ancre = titre, classe = "", grise = false } = {}) {
  const input = h("input", { type: "checkbox", role: "switch", disabled: desactive || groupe?.occupe, "aria-describedby": null });
  input.checked = Boolean(valeur);
  input.dataset.cle = ancre;
  input.dataset.desactive = desactive ? "1" : "0";
  groupe?.inputs.add(input);
  const essayer = async (voulu) => {
    if (groupe?.occupe) {
      input.checked = !voulu;
      return;
    }
    // Désactivé pendant l'envoi, il perdrait le focus : on le lui rendra après.
    focusApres = ancre;
    if (groupe) groupe.pendant(true);
    else input.disabled = true;
    try {
      await changer(voulu);
    } catch (err) {
      input.checked = !voulu;
      direErreur(err, () => {
        input.checked = voulu;
        return essayer(voulu);
      }, "Réglage pas enregistré");
    } finally {
      if (groupe) groupe.pendant(false);
      else input.disabled = desactive;
    }
  };
  input.addEventListener("change", () => essayer(input.checked));
  return h("label", { class: `bascule reglage ${grise ? "grise" : ""} ${classe}`.trim(), dataset: { repere: ancre } },
    h("span", { class: "textes" }, h("strong", null, titre), detail ? h("span", null, detail) : null), input);
}

/** Une ligne qui ouvre quelque chose (À trancher, Revue de la semaine, une nouveauté). */
function ligne(titre, sous, faire, { ic = null, ancre = titre, fin = null } = {}) {
  return h("button", { type: "button", class: "reglages-ligne-lien reglage", dataset: { repere: ancre }, onclick: faire },
    ic ? icone(ic) : null,
    h("span", { class: "corps" }, h("span", { class: "titre-ligne" }, titre), sous ? h("span", { class: "sous" }, sous) : null),
    fin, icone("chevron"));
}

/** Une petite feuille avec un champ : le bouton d'action reste grisé tant que le champ est vide. */
function demanderNom({ titre, valeur = "", placeholder = "", etiquette, aide, libelle }) {
  const id = `champ-${Math.random().toString(36).slice(2, 8)}`;
  const champ = h("input", { class: "champ", id, type: "text", placeholder, autocomplete: "off", "aria-label": etiquette || placeholder || titre });
  champ.value = valeur;
  const action = bouton(libelle, { classe: "plein", onclick: () => valider() });
  const maj = () => (action.disabled = !champ.value.trim());
  const valider = () => {
    if (champ.value.trim()) f.fermer(champ.value.trim());
  };
  champ.addEventListener("input", maj);
  champ.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      valider();
    }
  });
  const f = feuille({ titre, contenu: [aide ? h("p", { class: "aide", style: { marginBottom: "10px" } }, aide) : null, champ], pied: [bouton("Annuler", { classe: "papier", onclick: () => f.fermer(null) }), action] });
  maj();
  champ.focus();
  champ.select?.();
  return f.fini.then((v) => (typeof v === "string" ? v : null));
}

/** Un bloc d'erreur à sa phrase (« Priorités illisibles : … ») avec Réessayer. */
const erreurSection = (texte, reessayer) => vide(null, texte, bouton("Réessayer", { classe: "papier", icone: "rafraichir", onclick: (e) => occupe(e.currentTarget, reessayer) }));

async function dessinerSection(donnees) {
  garde = () => null;
  if (!section) return vider(refs.detail);
  const s = section;
  if (donnees === undefined) vider(refs.detail, h("section", { class: "carte" }, squelette([0.5, 0.8, 0.7])));
  try {
    const contenu = await (SECTIONS_RENDU[s] || (() => vide("Section inconnue")))(donnees);
    if (s !== section) return;
    vider(refs.detail, contenu);
    appliquerRepere();
  } catch (err) {
    if (s === section) vider(refs.detail, h("section", { class: "carte" }, blocErreur(err, () => dessinerSection())));
  }
}

/** Redessine la section avec ce que la tour vient de rendre, le focus gardé sur le même contrôle. */
async function redessiner(donnees) {
  const cle = document.activeElement?.dataset?.cle || focusApres;
  focusApres = null;
  await dessinerSection(donnees);
  if (cle) [...refs.detail.querySelectorAll("[data-cle]")].find((x) => x.dataset.cle === cle && !x.disabled)?.focus();
}

// --- Les calculs (exportés, testés sous node) ---

/** Recherche web : par qui elle passe (Reglages.phraseRechercheWeb). */
export function phraseRechercheWeb(r) {
  if (r?.rechercheWebCoupeeParLaTour === true) return "Coupée sur la tour (REMY_WEB_SEARCH=off) : à rallumer là-bas.";
  const m = R.moteur(r);
  if (m) return r.rechercheWeb === true ? `Rémy cherche lui-même sur le web (${m}), sans passer par Claude.` : "Coupée : Rémy répond sans le web.";
  return r?.rechercheWeb === true ? "Passe par Claude (Anthropic). Rémy te demande ton accord à chaque recherche." : "Coupée : Rémy répond sans le web, rien ne part chez Anthropic.";
}
export function confirmationRechercheWeb(r, actif) {
  if (!actif) return "Recherche web coupée : Rémy répond sans le web.";
  return R.moteur(r) ? "Recherche web permise : Rémy cherche lui-même quand il en a besoin, sans Claude." : "Recherche web permise : Rémy te demandera avant chaque recherche.";
}
/** Recherche dans les conversations privées : le verrou, sinon ce qui sort (Reglages.phraseRecherchePrivee). */
export function phraseRecherchePrivee(r) {
  const v = verrouRecherchePrivee(r);
  if (v) return v;
  const sort = `Allumé, Rémy peut chercher : ${CE_QUI_SORT}`;
  if (r?.recherchePriveeReglage === true) return r.rechercheWeb === true ? sort : `Allumé, mais la recherche web est coupée : rien ne sort. ${sort}`;
  return `Coupé : une conversation privée ne cherche jamais sur le web. ${sort}`;
}
/** L'interrupteur tel qu'il s'affiche : le réglage, sauf verrou (coupé). */
export const recherchePriveeAffichee = (r) => !verrouRecherchePrivee(r) && r?.recherchePriveeReglage === true;
export const confirmationRecherchePrivee = (actif) => (actif ? "Recherche permise dans les conversations privées : des questions générales sortent, filtrées." : "Recherche coupée dans les conversations privées : rien n'en sort.");

/** Les circuits que l'écran explique (ReglagesView.circuit) ; les autres gardent leur nom. */
export const CIRCUITS = {
  nuit: ["Réflexion de la nuit", "Rémy relit tes échanges et prépare le briefing du matin."],
  conseil: ["Conseil réfléchi", "Le modèle local, sur tes machines, prépare le conseil du moment en arrière-plan. Coupé : conseil calculé sans IA."],
  compactage: ["Compacter les longues conversations", "Dès 70 % du contexte, le modèle local résume le début du fil (rien n'est effacé). Coupé : seulement à la demande, depuis la jauge."],
  regles: ["Vérifier les règles", "Toutes les 3 h, sans IA : Rémy relit ton agenda et Motion pour te proposer les tâches de tes règles."],
};
export function detailCircuit(id, c) {
  if (c?.forceParLaTour) return `Réglé sur la tour (REMY_CIRCUIT_${id.toUpperCase()}) : à changer là-bas.`;
  return CIRCUITS[id]?.[1] || null;
}
/** Ce que dit le bandeau après un changement de circuit (ReglagesView.annonce). */
export function annonceCircuit(id, actif) {
  switch (id) {
    case "nuit": return actif ? "Réflexion de la nuit allumée." : "Réflexion de la nuit coupée : Rémy ne travaillera plus la nuit.";
    case "conseil": return actif ? "Conseil réfléchi allumé." : "Conseil réfléchi coupé : le conseil se calcule sans IA.";
    case "compactage": return actif ? "Compactage automatique allumé." : "Compactage automatique coupé : à la demande seulement.";
    case "regles": return actif ? "Vérification des règles allumée." : "Vérification des règles coupée : Rémy ne propose plus leurs tâches.";
    default: return actif ? "Circuit allumé." : "Circuit coupé.";
  }
}

/** Jours avec au moins un échange, sur les 14 derniers (null : rien à dire). */
export function joursActifs(activite) {
  const j = activite?.jours;
  if (!Array.isArray(j) || !j.length) return null;
  const tries = [...j].sort((a, b) => String(a.jour).localeCompare(String(b.jour)));
  return tries.slice(-14).filter((x) => (x.messages || 0) > 0 || x.actif === true).length;
}
export const phraseJoursActifs = (n) => (n === 0 ? "Tu n'as pas parlé à Rémy ces 14 derniers jours." : `Tu as parlé à Rémy ${n} jour${n > 1 ? "s" : ""} sur les 14 derniers.`);

/**
 * Priorités : ce qui part vers la tour (Priorites.aEnvoyer), dans l'ordre du
 * classement. `lien` (la tour sait priorites-v2) : le projet Motion relié
 * et la confirmation partent toujours, `null` et `false` compris (clé
 * présente = remplacé).
 */
export function aEnvoyerPriorites(liste, { lien = false } = {}) {
  const vus = new Set();
  const out = [];
  for (const p of liste || []) {
    const titre = String(p?.titre || "").trim();
    const cle = R.normaliser(titre);
    if (!titre || vus.has(cle)) continue;
    vus.add(cle);
    const q = { id: p.id, titre: [...titre].slice(0, 80).join("") };
    const pq = String(p.pourquoi || "").trim();
    if (pq) q.pourquoi = [...pq].slice(0, 240).join("");
    const brut = p.motsTexte != null ? [p.motsTexte] : Array.isArray(p.mots) ? p.mots : [];
    const mots = brut.flatMap((t) => String(t).split(/[,;\n]/)).map((t) => t.trim()).filter((t) => [...t].length >= 3);
    if (mots.length) q.mots = mots.slice(0, 8);
    if (lien) {
      q.projetMotion = typeof p.projetMotion === "string" && p.projetMotion ? p.projetMotion : null;
      if (q.projetMotion && p.projetNom) q.projetNom = String(p.projetNom).slice(0, 80);
      q.confirmee = p.classee === true;
    }
    out.push(q);
  }
  return out;
}
/** La ligne d'état sous une priorité (Priorites.etat). */
export function etatPriorite(p) {
  if (p?.neglige === true && p.constat) return `Négligée : ${p.constat}`;
  if (Number.isFinite(p?.joursSans)) return p.joursSans === 0 ? "Active aujourd'hui" : p.joursSans === 1 ? "Dernière trace hier" : `Dernière trace il y a ${p.joursSans} jours`;
  return null;
}

/** « 1 M de contexte », « 128 k de contexte » (ModelesLocaux.fenetreLisible). */
export function fenetreLisible(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1000000) {
    const m = n / 1048576;
    return `${m >= 0.95 && m < 1.05 ? "1" : m.toFixed(1).replace(".", ",")} M de contexte`;
  }
  return `${Math.round(n / 1024)} k de contexte`;
}
/** Pourquoi ce modèle répond (ModelesLocaux.pourquoi). */
export function pourquoiModele(m) {
  switch (m?.actif?.source) {
    case "choisi": return "Choisi par toi";
    case "tour": return "Réglé sur la tour (REMY_GLM_MODEL)";
    case "auto": {
      const absent = m.choisi != null && m.joignable === true && !(m.servis || []).some((s) => s.id === m.choisi);
      return absent ? "Ton choix n'est plus chargé : celui que tes Sparks servent" : "Celui que tes Sparks chargent";
    }
    default: return "Les Sparks n'ont pas dit ce qu'elles servent";
  }
}

/** « au plus tard 3 h avant », « au plus tard la veille » (RegleRemy.delai). */
export function delaiRegle(avantMin) {
  const n = Number(avantMin) || 0;
  if (n <= 0) return "avant l'événement";
  if (n % 1440 === 0) return n === 1440 ? "au plus tard la veille" : `au plus tard ${n / 1440} jours avant`;
  if (n % 60 === 0) return `au plus tard ${n / 60} h avant`;
  return `au plus tard ${n} min avant`;
}
export const detailRegle = (r) => `« ${r?.tache?.nom || "?"} »${r?.tache?.duree ? ` (${r.tache.duree} min)` : ""}, ${delaiRegle(r?.avantMin)}, avant : ${(r?.mots || []).join(", ")}`;

/** « 3 h 10 », « 45 min », « moins d'une minute » (ActivitePC.duree). */
export function dureeActivite(secondes) {
  const m = Math.round((Number(secondes) || 0) / 60);
  return m < 1 ? "moins d'une minute" : duree(m);
}
/** Ce qui empêche de compter, avec quoi faire ; null si tout va bien (VueActivitePC.probleme). */
export function problemeActivite(v) {
  if (!v?.actif) return null;
  const aw = v.activitywatch || {};
  if (aw.joignable === false) return aw.message || "ActivityWatch ne répond pas : installe-le sur la tour (aw-qt) et lance-le avec Windows.";
  if (aw.joignable === true && (aw.fenetre === false || aw.afk === false)) return aw.message || "ActivityWatch répond, mais un de ses guetteurs ne tourne pas : relance aw-qt sur la tour.";
  return null;
}
/** « Les 7 jours d'avant : 8 h 50 (1 h 10 de plus cette semaine). » ; null sans rien à comparer. */
export function comparaisonActivite(v) {
  const avant = v?.semainePrecedente?.total;
  const cette = v?.semaine?.total || 0;
  if (!(avant >= 60) || !(cette >= 60)) return null;
  const ecart = cette - avant;
  const suite = Math.abs(ecart) < 60 ? "autant cette semaine" : `${dureeActivite(Math.abs(ecart))} de ${ecart > 0 ? "plus" : "moins"} cette semaine`;
  return `Les 7 jours d'avant : ${dureeActivite(avant)} (${suite}).`;
}
/** « Relevé à 14:20 », « Premier relevé dans 20 min au plus ». */
export const releveActivite = (v) => (v?.derniereCollecte ? `Relevé à ${heure(v.derniereCollecte)}` : `Premier relevé dans ${v?.releveMin ?? 20} min au plus`);
/** « Discord.exe » → « discord » ; « Agenda.app » reste (un domaine). 80 caractères au plus. */
export function cleExclusion(appli) {
  let s = String(appli || "").trim().toLowerCase();
  if (s.endsWith(".exe")) s = s.slice(0, -4);
  return [...s].slice(0, 80).join("");
}
/** Le bandeau après l'interrupteur (ActivitePCModel.activer). */
export function messageActivation(v, oui) {
  if (!oui) return "Activité du PC coupée : plus rien n'est relevé.";
  return problemeActivite(v) == null ? `Activité du PC allumée : ${releveActivite(v).toLowerCase()}.` : "Allumée, mais ActivityWatch ne répond pas encore.";
}
/** La confirmation avant de ne plus compter une appli ou un site. */
export function messageExclusion({ categorie, secondes, site = false }) {
  const d = dureeActivite(secondes);
  return !site && categorie === "navigateur"
    ? `Ses ${d} de la semaine, tout son historique et les sites relevés s'effacent sur la tour, sans retour.`
    : `Ses ${d} de la semaine et tout son historique s'effacent sur la tour, sans retour.`;
}

/** « Salon Lumière (coiffeur) », « pharmacie (sans nom) » (CommerceProche.libelle). */
export function commerceLibelle(c) {
  if (!c) return null;
  const nom = String(c.nom || "").trim();
  if (!nom) return `${c.type} (sans nom)`;
  return nom.toLowerCase().includes(String(c.type || "").toLowerCase()) ? nom : `${nom} (${c.type})`;
}
/** Un lieu tel qu'on le lit : son nom, sinon « Sans doute … », sinon son adresse. */
export const lieuLisible = (ici) => ici?.nom || (ici?.commerce ? `Sans doute ${commerceLibelle(ici.commerce)}` : null) || ici?.adresse || null;
/** « En voiture, depuis 08:05 », « Salle de sport, depuis 18:42 », « Pas de position récente ». */
export function phraseEtatLieux(e) {
  const depuis = e?.depuis ? `, depuis ${heure(e.depuis)}` : "";
  if (e?.ou === "voiture") return `En voiture${depuis}`;
  if (e?.ou === "lieu") return `${lieuLisible(e.lieu) || "Un lieu sans adresse connue"}${depuis}`;
  return "Pas de position récente";
}
export const lieuAffiche = (l) => l?.nom || l?.adresse || "Lieu sans adresse connue";
export function sousTitreLieu(l) {
  const n = l?.visites || 0;
  const source = l?.source === "agenda" ? "reconnu d'après ton agenda" : l?.source === "sam" ? "nommé par toi" : "à nommer ?";
  return `${n} visite${n > 1 ? "s" : ""} · ${source}`;
}

/** « 120 ms », « 1,4 s » (MesuresView.duree). */
export const dureeMesure = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);
export const ligneMesure = (s) => (s && s.n ? `médiane ${dureeMesure(s.p50 ?? 0)} · 95 % sous ${dureeMesure(s.p95 ?? 0)} · ${s.n} mesure${s.n > 1 ? "s" : ""}` : "pas encore mesuré");
/** L'état de la lecture Motion, en clair (MesuresView.etat). */
export function etatMotion(e) {
  return { ok: "à jour", maj: "mise à jour en cours", quota: "Motion limite les requêtes", menage: "quota gardé pour tes gestes", panne: "Motion ne répond pas",
    reseau: "la tour ne joint pas Motion", auth: "clé Motion refusée", attente: "première lecture" }[e] || e;
}
export const MESURES_TOUR = [
  ["dashboard", "Préparer la journée"], ["motion.liste", "Lire toutes les tâches Motion"], ["motion.lecture", "Une requête de lecture Motion"],
  ["motion.attente_quota", "Attente du quota Motion (12/min)"], ["motion.ecriture", "Écrire dans Motion (geste complet)"], ["google.jour", "Lire l'agenda Google du jour"],
  ["glm.premier_jeton", "Modèle local : premier mot d'une réponse"], ["glm.complete", "Modèle local : réponse courte complète"], ["conseil.glm", "Conseil réfléchi par le modèle local"],
  ["dictee", "Dictée locale (transcription)"], ["capture", "Classer une capture"],
];
const MESURES_POSTE = [
  ["app.journee", "Charger la journée (ce poste → tour → ce poste)"], ["app.geste", "Geste → confirmé par la tour"],
  ["app.conseil", "Conseil de Rémy (ce poste → tour)"], ["app.dictee", "Dictée (envoi → texte)"],
];

/** Le détail de la déconnexion : la file d'envoi, gardée dans ce navigateur, partira après. */
export function phraseDeconnexion(n) {
  return `Il faudra retaper le mot de passe pour revenir.${n === 0 ? "" : n === 1 ? " Un envoi en attente partira après la reconnexion." : ` ${n} envois en attente partiront après la reconnexion.`}`;
}

/**
 * La ligne de Réglages › Diagnostic (maj-auto-v1) : « Mise à jour
 * automatique : activée — dernière : abc1234, hier 10:05, réussie ».
 */
export function phraseMajAuto(v, maintenant = Date.now()) {
  if (!v) return "Mise à jour automatique : état inconnu";
  const etat = v.coupeeParLaTour ? "coupée sur la tour" : !v.active ? "désactivée" : v.pause ? "en pause" : "activée";
  const d = v.derniere;
  if (!d) return `Mise à jour automatique : ${etat}${v.active ? " — aucune encore" : ""}`;
  const t = Date.parse(d.date);
  const resultat = d.resultat === "reussie" ? "réussie" : `annulée${d.raison ? ` (${d.raison})` : ""}`;
  return `Mise à jour automatique : ${etat} — dernière : ${d.commit}${Number.isFinite(t) ? `, ${quand(t, { maintenant })}` : ""}, ${resultat}`;
}
/** Ce qui se passe en ce moment (le dernier passage de la tâche), ou quoi faire. */
export function detailMajAuto(v, maintenant = Date.now()) {
  if (!v) return null;
  if (v.coupeeParLaTour) return "Coupée dans remy.env (REMY_MAJ_AUTO=off) : l'app ne peut pas la rallumer.";
  if (!v.active) return "Pour qu'elle installe seule ce qui arrive sur main après ses contrôles : une fois, sur la tour, dans un PowerShell administrateur, installer-tour.ps1 -MiseAJourAuto (docs/tour.md).";
  if (v.pause) return `En pause${v.pauseDepuis ? ` depuis ${quand(Date.parse(v.pauseDepuis), { maintenant })}` : ""} : rien n'est installé.`;
  const passe = Date.parse(v.dernierePasse);
  if (v.occupeLongtemps) return `Rémy est occupé sans relâche depuis ${quand(Date.parse(v.occupeDepuis), { maintenant })} : aucune mise à jour ne passe. Si ça dure, regarde ce qui tourne sur la tour (incidents ci-dessous), ou relance Rémy.`;
  if (v.retard) return `La tâche n'est pas passée depuis ${Number.isFinite(passe) ? quand(passe, { maintenant }) : "son activation"} : regarde le Planificateur de tâches de la tour (« Rémy - mise à jour »).`;
  return v.message ? `${v.message}${Number.isFinite(passe) ? ` (passage : ${quand(passe, { maintenant })})` : ""}` : `Premier passage dans ${v.intervalleMin || 15} min au plus.`;
}
export const confirmationMajAuto = (pause) => (pause ? "Mise à jour automatique en pause : la tour n'installera plus rien seule." : "Mise à jour automatique reprise : la tour installe de nouveau ce qui passe ses contrôles.");

// --- Les sections ---

const SECTIONS_RENDU = {
  async ordinateur() {
    if (!bureau.estBureau()) {
      return carte("Ordinateur", null,
        repere("Ordinateur", h("p", { class: "reglage" }, "Ces réglages vivent dans l'app Rémy pour Windows : une vraie fenêtre épinglable à la barre des tâches, une icône près de l'horloge, « Noter » de n'importe où et des notifications (rappels, briefing du matin, bilan du soir, propositions de Rémy).")),
        h("p", { class: "aide", style: { marginTop: "8px" } }, "Tu es dans un navigateur. Pour installer l'app : la page des Releases du dépôt (« bureau-v… »), puis le guide « docs/bureau.md »."),
        h("div", { class: "reglage" }, h("strong", null, "Raccourcis de ce site"), h("p", { class: "aide" }, `N pour noter, / pour chercher, ${ctrl}+K pour la palette, ? pour l'aide.`)));
    }
    const etat = await bureau.lireEtat();
    const notifs = bureau.reglagesNotifs();
    const raccourci = h("input", { class: "champ", type: "text", readonly: true, value: etat.raccourciLibelle || etat.raccourci || "", "aria-label": "Raccourci global", style: { maxWidth: "260px" }, title: "Clique puis tape la combinaison voulue" });
    const erreurRaccourci = h("p", { class: "erreur-champ", role: "alert" }, etat.raccourciErreur ? `${etat.raccourciErreur} Choisis-en un autre.` : "");
    raccourci.addEventListener("keydown", async (e) => {
      if (["Tab", "Escape"].includes(e.key)) return;
      e.preventDefault();
      const combi = combinaison(e);
      if (!combi) {
        erreurRaccourci.textContent = "Garde au moins Ctrl, Alt ou Windows, puis une touche.";
        return;
      }
      raccourci.value = combi;
      erreurRaccourci.textContent = "";
      try {
        const e2 = await bureau.regler({ raccourci: combi });
        raccourci.value = e2?.raccourciLibelle || combi;
        dire(`Raccourci : ${raccourci.value}.`, { genre: "succes" });
      } catch (err) {
        erreurRaccourci.textContent = `${typeof err === "string" ? err : err?.message || "Refusé"} L'ancien reste actif.`;
        raccourci.value = bureau.etatBureau()?.raccourciLibelle || bureau.etatBureau()?.raccourci || "";
      }
    });
    // Le rendez-vous quotidien (rituel-v1) : l'heure ne s'affiche que l'interrupteur allumé.
    // Allumé puis refusé par Windows : rien ne sonnerait, c'est dit ici avec quoi faire.
    const refus = refusRituel ? h("div", { class: "reglage", role: "alert" },
      h("p", { class: "erreur-champ" }, bureau.REFUS_NOTIFICATIONS || "Windows refuse les notifications de Rémy : autorise-les dans Paramètres › Système › Notifications, puis réessaie dans Réglages › Ordinateur."),
      refusRituel.raison ? h("p", { class: "aide" }, refusRituel.raison) : null,
      h("div", { class: "rangee", style: { marginTop: "6px" } }, bouton("Réessayer", { classe: "papier petit", icone: "rafraichir", onclick: (e) => occupe(e.currentTarget, () => allumerRituel(refusRituel.nom)) }))) : null;
    const allumerRituel = async (nom) => {
      const r = await activerRituel(nom);
      refusRituel = r.ok ? null : { nom, raison: r.erreur };
      if (!r.ok) {
        await redessinerOrdinateur();
        return;
      }
      const n = bureau.reglagesNotifs();
      dire(nom === "bilan" ? `Bilan du soir allumé : chaque soir à ${n.heureBilan}.` : `Briefing du matin allumé : chaque matin à ${n.heureBriefing}.`, { genre: "succes" });
      await redessinerOrdinateur();
    };
    const choixHeure = (titre, cle, valeur, phrase) => {
      const input = h("input", { class: "champ", type: "time", value: valeur, style: { width: "auto" }, "aria-label": titre });
      input.dataset.cle = titre;
      input.addEventListener("change", () => {
        if (!input.value) return;
        bureau.reglerNotifs({ [cle]: input.value });
        dire(phrase(input.value), { genre: "succes", duree: 2000 });
      });
      return repere(titre, h("label", { class: "rangee reglage reglages-heure" }, h("span", { style: { flex: 1 } }, titre), input));
    };
    const rituel = sait("rituel-v1") ? [
      sousTitre("Rendez-vous quotidien"),
      bascule("Briefing du matin", "Ce qui compte, pourquoi, ce qui est menacé. Calculé par ta tour, sans IA.", notifs.briefing, async (v) => {
        if (v) return allumerRituel("briefing");
        bureau.reglerNotifs({ briefing: false });
        dire("Briefing du matin coupé.", { genre: "succes", duree: 2000 });
        await redessinerOrdinateur();
      }),
      notifs.briefing ? choixHeure("Heure du briefing", "heureBriefing", notifs.heureBriefing, (h0) => `Briefing du matin à ${h0}.`) : null,
      bascule("Bilan du soir", "Fait, glissé, ce qui reste pour demain : 30 secondes avant de te coucher.", notifs.bilan, async (v) => {
        if (v) return allumerRituel("bilan");
        bureau.reglerNotifs({ bilan: false });
        dire("Bilan du soir coupé.", { genre: "succes", duree: 2000 });
        await redessinerOrdinateur();
      }),
      notifs.bilan ? choixHeure("Heure du bilan", "heureBilan", notifs.heureBilan, (h0) => `Bilan du soir à ${h0}.`) : null,
      refus,
    ] : [];
    return carte("Ordinateur", "L'app Rémy pour Windows.",
      repere("Noter de n'importe où", h("div", { class: "reglage" }, h("strong", null, "Noter de n'importe où"), h("p", { class: "aide" }, "Clique dans le champ, puis tape la combinaison voulue."), h("div", { class: "rangee", style: { marginTop: "6px" } }, raccourci), erreurRaccourci)),
      bascule("Démarrer avec Windows", "La fenêtre se charge cachée ; les notifications tournent.", etat.demarrage, async (v) => {
        await bureau.regler({ demarrage: v });
        dire(v ? "Rémy démarrera avec Windows." : "Rémy ne démarrera plus avec Windows.", { genre: "succes", duree: 2000 });
      }),
      bascule("Fermer = rester près de l'horloge", "La croix range Rémy dans la zone de notification. Quitter : clic droit sur l'icône.", etat.fermerDansZone, async (v) => {
        await bureau.regler({ fermerDansZone: v });
        dire(v ? "La croix range Rémy près de l'horloge." : "La croix ferme Rémy.", { genre: "succes", duree: 2000 });
      }),
      bascule("Notifications des rappels", "Une notification Windows quand un rappel tombe (lu au plus chaque minute, sans IA).", notifs.rappels, async (v) => {
        bureau.reglerNotifs({ rappels: v });
        dire(v ? "Les rappels arriveront en notification." : "Plus de notification pour les rappels.", { genre: "succes", duree: 2000 });
      }),
      ...rituel,
      sait("propositions-attente-v1") ? bascule("Propositions de Rémy", "Les tâches proposées par tes règles et les sujets de plus pour la nuit, en notification Windows : un clic les ouvre, rien ne part sans ton « Oui ».", notifs.propositions !== false, async (v) => {
        bureau.reglerNotifs({ propositions: v });
        dire(v ? "Les propositions de Rémy arriveront en notification." : "Plus de notification pour les propositions de Rémy.", { genre: "succes", duree: 2000 });
      }) : null,
      repere("Tester une notification", h("div", { class: "rangee reglage" }, bouton("Tester une notification", { classe: "papier", icone: "cloche", onclick: (e) => occupe(e.currentTarget, async () => {
        try {
          await bureau.notificationEssai();
          dire("Envoyée : elle doit apparaître en bas à droite.", { genre: "succes" });
        } catch (err) {
          dire(bureau.REFUS_NOTIFICATIONS || "Windows refuse les notifications de Rémy : autorise-les dans Paramètres › Système › Notifications, puis réessaie dans Réglages › Ordinateur.", { genre: "erreur", detail: texteErreur(err) });
        }
      }) }))),
      repere("Adresse de la tour", h("div", { class: "reglage" }, h("strong", null, "Adresse de la tour"), h("p", { class: "mono", style: { margin: "4px 0 8px", overflowWrap: "anywhere" } }, etat.adresse || location.origin),
        bouton("Changer l'adresse", { classe: "papier", onclick: async () => { if (await confirmer("Changer l'adresse de la tour ?", { detail: "La fenêtre revient à l'écran d'adresse.", libelle: "Changer" })) bureau.changerAdresse(); } }))),
      h("p", { class: "aide reglage" }, `App Rémy ${etat.version || "?"}`));
  },

  async apparence() {
    const t = themeChoisi();
    const choix = [["auto", "Auto (comme Windows)"], ["light", "Clair"], ["dark", "Sombre"]];
    const groupe = h("div", { class: "rangee serree", role: "radiogroup", "aria-label": "Thème" }, choix.map(([v, lib]) => {
      const b = h("button", { type: "button", class: "puce", role: "radio", "aria-checked": String(t === v), "aria-pressed": String(t === v) }, lib);
      b.addEventListener("click", () => {
        appliquerTheme(v);
        for (const x of groupe.children) {
          x.setAttribute("aria-pressed", String(x === b));
          x.setAttribute("aria-checked", String(x === b));
        }
      });
      return b;
    }));
    return carte("Apparence", "Le papier chaud de l'iPhone, en clair ou en sombre.", repere("Apparence", h("div", { class: "reglage" }, h("strong", null, "Apparence"), h("div", { style: { marginTop: "8px" } }, groupe))));
  },

  async noter() {
    const v = parDefaut();
    const groupe = h("div", { class: "rangee serree", role: "radiogroup", "aria-label": "Une pensée sans action claire" }, [["idee", "Dans les Idées"], ["tache", "Dans Motion"]].map(([val, lib]) => {
      const b = h("button", { type: "button", class: "puce", role: "radio", "aria-pressed": String(v === val), "aria-checked": String(v === val) }, lib);
      b.addEventListener("click", () => {
        local.ecrire(CLE_PAR_DEFAUT, val);
        for (const x of groupe.children) {
          x.setAttribute("aria-pressed", String(x === b));
          x.setAttribute("aria-checked", String(x === b));
        }
        dire(val === "idee" ? "Une pensée sans action claire ira dans les Idées." : "Une pensée sans action claire deviendra une tâche Motion.", { genre: "succes", duree: 2000 });
      });
      return b;
    }));
    return carte("Noter", "Rémy devine le genre sans IA ; tu corriges d'un clic.",
      sait("dossiers-v1")
        ? repere("Une pensée sans action claire", h("div", { class: "reglage" }, h("strong", null, "Une pensée sans action claire"), h("p", { class: "aide", style: { margin: "4px 0 8px" } }, "« Appeler le garage » reste une tâche Motion ; « un clip en noir » va où tu choisis."), groupe))
        : h("p", { class: "aide reglage" }, "Ta tour range tout dans Motion pour l'instant : les Idées arrivent avec sa mise à jour."),
      h("div", { class: "reglage" }, h("strong", null, "Raccourci"), h("p", { class: "aide" }, "N n'importe où sur le site ; dans l'app Windows, le raccourci global (Réglages › Ordinateur).")));
  },

  async file() {
    // Lue au moment du dessin : la section se redessine à chaque changement de la file (fileChangee).
    const l = fileEnvoi.liste();
    const vol = fileEnvoi.enVol();
    const apres = () => redessinerFile();
    const enRoute = (e) => {
      if (fileEnvoi.enVol() !== e.id) return false;
      dire(`« ${court(fileEnvoi.decrire(e).texte)} » part en ce moment : attends la réponse de Rémy.`);
      return true;
    };
    // Une ligne déjà partie (la file a bougé entre le dessin et le clic) : rien à retirer ni à renvoyer.
    const dejaPartie = (e, d) => {
      if (fileEnvoi.liste().some((x) => x.id === e.id)) return false;
      dire(`« ${court(d.texte)} » n'est plus en attente : elle est déjà partie vers Rémy.`);
      apres();
      return true;
    };
    const lignes = l.map((e) => {
      const d = fileEnvoi.decrire(e);
      const et = fileEnvoi.etat(e);
      const renvoyer = et.aRevoir ? bouton("Renvoyer", { classe: "papier petit", etiquette: `Renvoyer « ${court(d.texte)} »`, onclick: (ev) => {
        if (enRoute(e) || dejaPartie(e, d)) return;
        return occupe(ev.currentTarget, async () => {
          const r = await fileEnvoi.renvoyer(e.id);
          if (r.envoyes.length) dire(`Envoyé : « ${court(d.texte)} ».`, { genre: "succes" });
          else if (fileEnvoi.liste().some((x) => x.id === e.id && !x.refus)) dire("Toujours pas de réponse : elle repartira seule dès que Rémy sera joignable.");
          else dire(fileEnvoi.liste().find((x) => x.id === e.id)?.refus || "Pas envoyée.", { genre: "erreur" });
          await apres();
        });
      } }) : null;
      const retirer = bouton("Retirer", { classe: "texte petit reglages-danger", etiquette: `Retirer « ${court(d.texte)} »`, onclick: () => {
        if (enRoute(e) || dejaPartie(e, d)) return;
        // Telle qu'elle est maintenant (ses essais) : la phrase et « Annuler » partent de là.
        const actuelle = fileEnvoi.liste().find((x) => x.id === e.id);
        const place = fileEnvoi.retirer(e.id);
        dire(fileEnvoi.phraseRetiree(actuelle), { action: { libelle: "Annuler", faire: () => {
          fileEnvoi.remettre(actuelle, place);
          dire(`« ${court(d.texte)} » est de retour dans la file.`, { genre: "succes", duree: 2000 });
          return apres();
        } }, duree: 8000 });
        apres();
      } });
      if (renvoyer) renvoyer.dataset.cle = `renvoyer:${e.id}`;
      retirer.dataset.cle = `retirer:${e.id}`;
      return h("li", { class: `reglages-envoi ${et.aRevoir ? "a-revoir" : ""}`.trim() },
        h("div", { class: "rangee reglages-envoi-tete" }, icone(d.icone),
          h("div", { class: "corps" },
            h("div", { class: "titre-ligne reglages-quatre-lignes" }, d.texte),
            h("div", { class: "meta" }, `${d.libelle} · ${d.detail}`),
            h("div", { class: et.aRevoir && vol !== e.id ? "reglages-a-revoir" : "meta" }, vol === e.id ? "Part en ce moment…" : et.texte))),
        h("div", { class: "rangee reglages-envoi-actions" }, renvoyer, retirer));
    });
    const peutPartir = l.some(fileEnvoi.partSeul);
    // Pendant un envoi (ce bouton, le retour de la tour, la relance seule) : « Envoi… », comme l'iPhone.
    const envoyer = bouton(vol ? "Envoi…" : "Envoyer maintenant", { classe: "plein", icone: "envoyer", onclick: (ev) => {
      if (fileEnvoi.enVol()) return dire("Envoi en cours : attends la réponse de Rémy.");
      return occupe(ev.currentTarget, async () => {
        const r = await fileEnvoi.vider({ sansAttendre: true });
        if (r.envoyes.length) dire(`${r.envoyes.length === 1 ? "Envoyé" : `${r.envoyes.length} envoyés`} : ${r.envoyes.join(" ; ")}.`, { genre: "succes" });
        if (fileEnvoi.liste().some(fileEnvoi.partSeul)) dire("Rémy est toujours injoignable : elles partiront dès qu'il répond.");
        await apres();
      });
    } });
    envoyer.dataset.cle = "envoyer";
    if (vol) envoyer.setAttribute("aria-busy", "true");
    return carte("Envoi en attente", l.length ? "Notées sans réseau, telles que le site les a comprises. Elles partent seules dès que Rémy répond, une seule fois chacune." : "Tout est parti : rien n'attend plus Rémy.",
      l.length ? h("ul", { class: "liste reglages-envois" }, lignes) : null,
      peutPartir ? h("div", { class: "rangee", style: { marginTop: "12px" } }, envoyer) : null);
  },

  async remy(donnees) {
    const groupe = groupeBascules();
    const liens = bascule("Prévenir avant d'ouvrir un lien", "Lire une page web coûte un peu plus qu'un message.", local.lire("confirmerLiens", true) !== false, async (v) => {
      local.ecrire("confirmerLiens", v);
      dire(v ? "Rémy te préviendra avant de lire un lien." : "Rémy lira les liens sans te demander.", { genre: "succes", duree: 2000 });
    });
    let r = donnees;
    let erreur = null;
    if (r == null) {
      try {
        r = sait("reglages") ? await lireReglages() : null;
      } catch (err) {
        erreur = err;
      }
    }
    // Un seul changement à la fois ; la réponse de la tour redessine la section.
    const changer = async (corps, phrase) => {
      const v = await remplacer("/api/reglages", corps);
      reglagesTour = v;
      dire(phrase(v), { genre: "succes" });
      await redessiner(v);
    };
    const moteur = R.moteur(r);
    const zoneNuit = h("div");
    const tour = [];
    if (erreur) tour.push(erreurSection(`Réglages de la tour illisibles : ${texteErreur(erreur)}`, () => dessinerSection()));
    else if (r) {
      if (r.rechercheWeb != null) {
        tour.push(sousTitre("Recherche web"),
          bascule("Recherche web", phraseRechercheWeb(r), r.rechercheWeb === true, (v) => changer({ rechercheWeb: v }, (x) => confirmationRechercheWeb(x, v)), { groupe, desactive: r.rechercheWebCoupeeParLaTour === true }));
        if (r.rechercheWeb === true && !moteur) {
          tour.push(bascule("Envoi de contexte au cloud", r.contexteCloud === true ? "Une recherche autorisée emporte la conversation et ta mémoire. Jamais pour une conversation privée." : "Une recherche autorisée n'emporte que ta question.",
            r.contexteCloud === true, (v) => changer({ contexteCloud: v }, () => (v ? "Une recherche autorisée emportera la conversation et ta mémoire." : "Une recherche autorisée n'emportera que ta question.")), { groupe }));
        }
      }
      if (sait("recherche-privee-v1") && r.recherchePriveeReglage != null) {
        const verrou = verrouRecherchePrivee(r);
        tour.push(bascule("Recherche dans les conversations privées", phraseRecherchePrivee(r), recherchePriveeAffichee(r), (v) => changer({ recherchePrivee: v }, () => confirmationRecherchePrivee(v)), { groupe, desactive: Boolean(verrou), grise: Boolean(verrou) }));
      }
      if (r.secoursCloudSansObjet !== true) {
        const force = r.secoursCloudForceParLaTour === true;
        tour.push(sousTitre("Cloud"),
          bascule("Secours Claude si la tour ne répond pas", force ? "Activé sur la tour (REMY_SECOURS_CLOUD) : à couper là-bas." : "Tes messages et ta mémoire partent alors chez Anthropic. Jamais pour une conversation privée.",
            r.secoursCloud === true, (v) => changer({ secoursCloud: v }, () => (v ? "Secours Claude activé." : "Secours Claude coupé : rien ne part chez Anthropic quand la tour ne répond pas.")), { groupe, desactive: force }));
      }
      const circuits = Object.entries(r.circuits || {});
      if (circuits.length) {
        tour.push(sousTitre("Circuits"));
        // Ceux que l'écran explique d'abord, dans l'ordre de l'iPhone ; puis les autres, par leur nom.
        const ordre = ["nuit", "conseil", "compactage", "regles"];
        circuits.sort(([a], [b]) => (ordre.includes(a) ? ordre.indexOf(a) : 9) - (ordre.includes(b) ? ordre.indexOf(b) : 9));
        for (const [id, c] of circuits) tour.push(basculeCircuit(id, c, groupe));
        tour.push(zoneNuit);
      }
      const peremption = h("input", { class: "champ", type: "number", min: "1", max: "90", value: String(r.peremptionJours || 7), style: { width: "90px" }, "aria-label": "Jours" });
      peremption.addEventListener("change", async () => {
        const n = Number(peremption.value);
        if (!Number.isInteger(n) || n < 1 || n > 90) return dire("Entre 1 et 90 jours.", { genre: "erreur" });
        try {
          reglagesTour = await remplacer("/api/reglages", { peremptionJours: n });
          dire(`Au-delà de ${n} jour${n > 1 ? "s" : ""}, « Oui » demandera de confirmer.`, { genre: "succes" });
        } catch (err) {
          direErreur(err, () => peremption.dispatchEvent(new Event("change")), "Réglage pas enregistré");
        }
      });
      tour.push(repere("Ancienneté d'une proposition", h("div", { class: "rangee reglage" }, h("div", { style: { flex: 1 } }, h("strong", null, "Ancienneté d'une proposition"), h("p", { class: "aide" }, "Au-delà, « Oui » demande de confirmer.")), peremption, h("span", { class: "aide" }, "jours"))));
      // La préparation de nuit coupée sur la tour : « Rémy a remarqué » restera vide.
      lireTableau().then((d) => {
        if (d?.systeme?.reflexion === false) ajouterA(zoneNuit, info("Préparation de nuit désactivée : « Rémy a remarqué » restera vide.", "lune"));
      });
    }
    return carte("Rémy", "Ce que Rémy fait sans toi, et ce qu'il peut envoyer ailleurs.", liens, ...tour);
  },

  async memoire() {
    let m;
    try {
      m = await api("/api/memory");
    } catch (err) {
      if (err?.nature === "auth") throw err;
      return carte("Ce que Rémy sait de toi", null, erreurSection(`Impossible de lire la mémoire de Rémy : ${texteErreur(err)}`, () => dessinerSection()));
    }
    return memoireVue({ texteServeur: m?.text || "", majA: m?.updatedAt || null, edition: false });
  },

  async priorites() {
    // La proposition de Rémy et les projets Motion (priorites-v2) : lus en même temps, leur échec n'enlève que ce qu'ils apportent.
    const [lu, prop, proj] = await Promise.allSettled([
      api("/api/priorites"),
      sait("priorites-v2") ? api("/api/priorites/proposition", { delai: 20000 }) : Promise.resolve(null),
      sait("priorites-v2") ? api("/api/projets", { delai: 15000 }) : Promise.resolve(null),
    ]);
    if (lu.status === "rejected") {
      const err = lu.reason;
      if (err?.nature === "auth") throw err;
      return carte("Ce qui compte", SOUS_PRIORITES, erreurSection(`Priorités illisibles : ${texteErreur(err).replace(/\.$/, "")}.`, () => dessinerSection()));
    }
    const proposition = prop.status === "fulfilled" && Array.isArray(prop.value?.candidats) ? prop.value : null;
    return prioritesVue(lu.value, { proposition, projets: projetsLiables(proj) });
  },

  async modele(donnees) {
    let m = donnees;
    if (!m) {
      try {
        m = await api("/api/modeles");
      } catch (err) {
        if (err?.nature === "auth") throw err;
        return carte("Modèle", null, erreurSection("La tour n'a pas pu lire les modèles des Sparks.", () => dessinerSection()));
      }
    }
    return modeleVue(m);
  },

  async regles(donnees) {
    let liste = donnees;
    if (!liste) {
      try {
        liste = (await api("/api/regles")).regles || [];
      } catch (err) {
        if (err?.nature === "auth") throw err;
        return carte("Règles de Rémy", null, erreurSection(`Règles illisibles : ${texteErreur(err).replace(/\.$/, "")}.`, () => dessinerSection()));
      }
    }
    if (!reglagesTour && sait("reglages")) await lireReglages().catch(() => null);
    return reglesVue(liste);
  },

  async revue() {
    const dimanche = local.lire("remy-revue-dimanche", true) !== false;
    return carte("À trancher et revue", null,
      ligne("À trancher", "Cartes, rappels, articles, vieux fils, idées : un geste chacun.", () => ctx.aller("aujourdhui/trancher"), { ic: "liste" }),
      ligne("Revue de la semaine", "Fait, glissé, idées, trois décisions. Sans IA.", () => ctx.aller("aujourdhui/revue"), { ic: "calendrier" }),
      bascule("Revue du dimanche", "Proposée sur Aujourd'hui le dimanche, 10 minutes. Coupée : seulement depuis ici.", dimanche, async (v) => {
        local.ecrire("remy-revue-dimanche", v);
        dire(v ? "La revue sera proposée sur Aujourd'hui le dimanche." : "La revue ne sera plus proposée : elle reste ici.", { genre: "succes", duree: 2500 });
      }));
  },

  async activite(donnees) {
    if (donnees) return activiteVue(donnees);
    try {
      etatActivite.vue = await api("/api/activite-pc");
    } catch (err) {
      if (err?.nature === "auth") throw err;
      return carte("Activité du PC", null, erreurSection("La tour n'a pas pu lire l'activité du PC.", () => dessinerSection()), h("p", { class: "aide" }, texteErreur(err)));
    }
    return activiteVue(etatActivite.vue);
  },

  async lieux(donnees) {
    let v = donnees;
    if (!v) {
      try {
        v = await api("/api/lieux");
      } catch (err) {
        if (err?.nature === "auth") throw err;
        return carte("Localisation", null, erreurSection(`La tour n'a pas pu lire tes lieux : ${texteErreur(err)}`, () => dessinerSection()));
      }
    }
    return lieuxVue(v);
  },

  async conversations() {
    // La même vue que « Sources » de l'écran Conversations (Claude Code, T3, ChatGPT).
    const { dessinerSources } = await import("./conversations-externes.js");
    const zone = h("div", null, squelette([0.6, 0.8]));
    dessinerSources(zone);
    return carte("Sources des conversations", "Claude Code, T3 Code et ChatGPT, lus et chiffrés par la tour. Rien ne repart vers Claude ni OpenAI.",
      zone, h("div", { class: "rangee", style: { marginTop: "12px" } }, h("a", { class: "btn papier", href: "#/conversations" }, icone("conversations"), "Voir les conversations")));
  },

  async agenda() {
    const g = await api("/api/google/status");
    return carte("Agenda Google", g.configure === false ? "Pas d'identifiants Google sur la tour (GOOGLE_CLIENT_ID / SECRET)." : g.connecte ? "Connecté : Rémy lit ton agenda et peut y écrire sur ton accord." : "Pas connecté.",
      g.configure !== false ? h("div", { class: "rangee reglage" },
        g.connecte
          ? [bouton("Tester", { classe: "papier", onclick: (e) => occupe(e.currentTarget, async () => { try { const r = await ecrire("/api/google/test", {}); dire(r?.message || "L'agenda répond.", { genre: "succes" }); } catch (err) { direErreur(err, null, "Test raté"); } }) }),
            bouton("Déconnecter", { classe: "danger", onclick: async (e) => {
              if (!(await confirmer("Déconnecter l'agenda Google ?", { libelle: "Déconnecter", danger: true }))) return;
              await occupe(e.currentTarget, async () => { try { await ecrire("/api/google/deconnexion", {}); dire("Agenda Google déconnecté.", { genre: "succes" }); dessinerSection(); } catch (err) { direErreur(err); } });
            } })]
          : bouton("Connecter l'agenda", { classe: "plein", onclick: (e) => occupe(e.currentTarget, async () => {
            try {
              const r = await ecrire("/api/google/auth", {});
              if (r?.url) {
                if (bureau.estBureau()) await bureau.ouvrirLien(r.url);
                else window.open(r.url, "_blank", "noopener");
                dire("Termine la connexion dans la fenêtre Google, puis reviens ici.");
              }
            } catch (err) { direErreur(err, null, "Connexion impossible"); }
          }) })) : null);
  },

  async appareils() {
    let erreur = null;
    try {
      appareilsLus = (await api("/api/appareils")).appareils || [];
    } catch (err) {
      if (err?.nature === "auth") throw err;
      erreur = err;
      if (!appareilsLus) return carte("Appareils connectés", null, erreurSection(`Appareils illisibles : ${texteErreur(err)}`, () => dessinerSection()));
    }
    const liste = appareilsLus;
    return carte("Appareils connectés", "Les apps connectées par jeton (iPhone…). Déconnecter rend le jeton inutilisable tout de suite.",
      // Relecture ratée : l'ancienne liste reste, mais c'est dit.
      erreur ? erreurSection(`Liste pas relue : ${texteErreur(erreur)}`, () => dessinerSection()) : null,
      liste.length ? h("ul", { class: "liste" }, liste.map((a) => h("li", { class: "ligne" }, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, a.nom, a.actuel ? " · celui-ci" : ""), h("div", { class: "meta" }, a.vu_a ? `vu ${quand(a.vu_a)}` : a.cree_a ? `connecté ${quand(a.cree_a)}` : "")),
        bouton("Déconnecter", { classe: "danger petit", onclick: async (e) => {
          if (!(await confirmer(`Déconnecter « ${a.nom} » ?`, { detail: "Il faudra retaper le mot de passe sur cet appareil.", libelle: "Déconnecter", danger: true }))) return;
          await occupe(e.currentTarget, async () => {
            try {
              await supprimer(`/api/appareils/${seg(a.id)}`);
              appareilsLus = appareilsLus.filter((x) => x.id !== a.id);
              dire(`« ${a.nom} » est déconnecté : il devra retaper le mot de passe.`, { genre: "succes" });
              dessinerSection();
            } catch (err) { direErreur(err, null, "Pas déconnecté"); }
          });
        } })))) : h("p", { class: "aide reglage" }, "Aucun appareil n'a encore de jeton. Le site, lui, garde son cookie."));
  },

  async jeton() {
    const j = await api("/api/capture/jeton");
    const zone = h("div", { class: "reglage" });
    const dessiner = (etat, nouveau) => vider(zone,
      nouveau ? [h("p", { class: "aide" }, "Copie-le maintenant : il ne sera plus jamais affiché."), h("p", { class: "mono", style: { overflowWrap: "anywhere", margin: "6px 0" } }, nouveau), bouton("Copier", { classe: "papier petit", icone: "copier", onclick: async () => { try { await navigator.clipboard.writeText(nouveau); dire("Copié.", { genre: "succes" }); } catch { dire("Copie impossible : sélectionne-le à la main.", { genre: "erreur" }); } } })]
        : h("p", null, etat ? "Un jeton existe (créé " + (etat.creeA ? quand(etat.creeA) : "plus tôt") + ")." : "Aucun jeton."),
      h("div", { class: "rangee", style: { marginTop: "10px" } },
        bouton(etat || nouveau ? "Remplacer le jeton" : "Créer un jeton", { classe: "plein", onclick: (e) => occupe(e.currentTarget, async () => {
          try { const r = await ecrire("/api/capture/jeton", {}); dessiner(true, r.jeton); } catch (err) { direErreur(err, null, "Jeton pas créé"); }
        }) }),
        etat || nouveau ? bouton("Supprimer", { classe: "danger", onclick: async (e) => {
          if (!(await confirmer("Supprimer le jeton de capture ?", { detail: "Le raccourci iPhone qui l'utilise ne marchera plus.", libelle: "Supprimer", danger: true }))) return;
          await occupe(e.currentTarget, async () => { try { await supprimer("/api/capture/jeton"); dire("Jeton supprimé.", { genre: "succes" }); dessiner(null); } catch (err) { direErreur(err); } });
        } }) : null));
    dessiner(j.jeton);
    return carte("Jeton de capture", "Pour le raccourci « Envoyer à Rémy » de l'iPhone (feuille de partage, Siri) : il ne sert qu'à noter.", zone);
  },

  async couts() {
    const c = await api("/api/costs");
    const t = c.totals || {};
    const dollars = (v) => (typeof v === "number" ? `${v.toFixed(2).replace(".", ",")} $` : "—");
    const entrees = (c.entries || []).slice(0, 40);
    const jours = h("div");
    lireTableau().then((d) => {
      const n = joursActifs(d?.activite);
      if (n != null) ajouterA(jours, info(phraseJoursActifs(n), "calendrier"));
    });
    return carte("Coûts", "Chaque appel à un modèle est noté ici, avec son genre. Le modèle local ne coûte rien.",
      jours,
      repere("Coût des 30 derniers jours", h("dl", { class: "paires reglage" },
        h("dt", null, "Aujourd'hui"), h("dd", null, dollars(t.today)),
        h("dt", null, "7 jours"), h("dd", null, dollars(t.days7)),
        h("dt", null, "30 jours"), h("dd", null, dollars(t.days30)))),
      entrees.length ? h("ul", { class: "liste" }, entrees.map((e) => h("li", { class: "ligne" }, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, e.label || e.kind), h("div", { class: "meta" }, h("span", { class: "mono" }, quand(e.ts)), h("span", null, e.kind), h("span", null, e.model || ""), e.local ? h("span", null, "local") : null)), h("span", { class: "mono" }, dollars(e.usd))))) : vide(null, "Aucun appel noté."));
  },

  async usage() {
    const r = usage.resume();
    const nombre = (l) => h("li", { class: "ligne" }, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, l.libelle)), h("span", { class: "mono" }, String(l.nombre)));
    const depuis = r.depuis ? `Compté depuis le ${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(new Date(r.depuis))} — à revoir chaque mois.` : "";
    return carte("Ce que tu utilises vraiment", r.phrase,
      sousTitre(`Tes gestes, ${r.jours} derniers jours`),
      r.gestes.length ? h("ul", { class: "liste" }, r.gestes.map(nombre)) : h("p", { class: "aide reglage" }, "Aucun geste compté pour l'instant. Coche une tâche, parle à Rémy, note quelque chose : ça apparaîtra ici."),
      r.gestes.length && !r.assez ? h("p", { class: "aide" }, "Encore peu de gestes : attends quelques jours avant d'en tirer une conclusion.") : null,
      r.vues.length ? [sousTitre("Ce que tu regardes"), h("ul", { class: "liste" }, r.vues.map(nombre))] : null,
      r.assez && r.jamais.length ? [sousTitre("Jamais touché"), h("ul", { class: "liste" }, r.jamais.map((f) => h("li", { class: "ligne" }, h("div", { class: "corps" }, h("div", { class: "titre-ligne", style: { color: "var(--encre-2)" } }, usage.libelle(f)))))), h("p", { class: "aide" }, depuis)] : null,
      repere("Remettre les compteurs à zéro", h("div", { class: "rangee reglage", style: { marginTop: "12px" } }, bouton("Remettre les compteurs à zéro", { classe: "danger", onclick: async () => {
        if (!(await confirmer("Remettre les compteurs à zéro ?", { detail: "Les gestes comptés sur cet ordinateur.", libelle: "Remettre à zéro", danger: true }))) return;
        usage.remettreAZero();
        dire("Compteurs remis à zéro.", { genre: "succes" });
        dessinerSection();
      } }))),
      h("p", { class: "aide" }, "Compté sur cet ordinateur seulement : un nom de fonction et un nombre par jour, jamais un texte, un titre ou un lieu. Rien ne part. Gardé 60 jours."));
  },

  /**
   * Le suivi des tutoriels (12/11) : « 3 à découvrir · 1 commencé · 22
   * suivis », puis chaque tutoriel rangé par état (à découvrir d'abord), son
   * état en mots et sa date ; un clic l'ouvre (un commencé reprend à sa page).
   * « Tout marquer comme suivi », avec « Annuler ».
   */
  async nouveautes() {
    const m = nouveautes.modele({ sait });
    const redessiner = () => {
      dessinerMaitre();
      dessinerSection();
    };
    const aMarquer = m.aMarquer().length;
    return carte("Nouveautés", "Gardé sur cet ordinateur. Au lancement, Rémy ne présente que les tutoriels des deux dernières mises à jour ; les autres t'attendent ici.",
      h("div", { class: "rangee reglages-nouveautes-tete" },
        h("p", { class: "reglages-nouveautes-resume", role: "status" }, m.resume()),
        aMarquer ? bouton("Tout marquer comme suivi", { classe: "papier", icone: "coche", onclick: () => {
          const r = m.toutMarquerSuivi();
          redessiner();
          dire(`${r.n} tutoriel${r.n > 1 ? "s" : ""} marqué${r.n > 1 ? "s" : ""} comme suivi${r.n > 1 ? "s" : ""}.`, { genre: "succes", action: { libelle: "Annuler", faire: () => {
            r.annuler();
            redessiner();
          } } });
        } }) : null),
      m.groupes().map((g) => [
        sousTitre(`${g.titre} (${g.entrees.length})`),
        h("ul", { class: "liste reglages-nouveautes", dataset: { groupe: g.id } }, g.entrees.map((n) => {
          const etat = nouveautes.ETATS[m.etat(n)];
          return h("li", null, ligne(n.titre, m.libelle(n), async () => {
            await nouveautes.revoir(n, m);
            redessiner();
          }, { ic: n.pages[0]?.icone || "etincelles", fin: h("span", { class: `nouveautes-etat ${m.etat(n)}`, title: etat.mot, "aria-hidden": "true" }, icone(etat.icone)) }));
        })),
      ]));
  },

  async diagnostic() {
    const [v, inc] = await Promise.all([api("/api/version"), api("/api/incidents").catch(() => ({ incidents: [] }))]);
    const incidents = inc.incidents || [];
    const texte = [`Rémy (site) · tour ${v.serveur || "?"}${v.commit ? ` (${String(v.commit).slice(0, 7)})` : ""} · API ${v.api}`, `Capacités : ${(v.capacites || []).length}`, `App Windows : ${bureau.estBureau() ? bureau.etatBureau()?.version || "oui" : "non"}`, `Navigateur : ${navigator.userAgent}`,
      ...incidents.slice(0, 10).map((i) => `${i.code || "?"} ${i.type || ""} ${i.route || ""} ${i.a || ""}`)].join("\n");
    const temps = h("div", { class: "reglages-mesures" });
    const lireMesures = async () => {
      if (!sait("mesures-v1")) return vider(temps, mesuresVue(null, null));
      vider(temps, squelette([0.7, 0.5, 0.6]));
      try {
        vider(temps, mesuresVue(await api("/api/mesures", { delai: 10000 }), null, lireMesures));
      } catch (err) {
        if (err?.nature === "auth") return;
        vider(temps, mesuresVue(null, err, lireMesures));
      }
    };
    lireMesures();
    const majAuto = h("div", { class: "reglages-maj-auto" });
    const lireMajAuto = async () => {
      if (!sait("maj-auto-v1")) return vider(majAuto);
      vider(majAuto, squelette([0.8, 0.6]));
      try {
        vider(majAuto, majAutoVue(await api("/api/maj-auto", { delai: 10000 }), lireMajAuto));
      } catch (err) {
        if (err?.nature === "auth") return;
        vider(majAuto, erreurSection(`Mise à jour automatique illisible : ${texteErreur(err)}`, lireMajAuto));
      }
    };
    lireMajAuto();
    return carte("Diagnostic", "Pour comprendre ce que fait Rémy et le signaler. Rien d'indispensable au quotidien.",
      repere("Temps de réponse", h("div", { class: "reglage" }, h("h3", { class: "titre-section reglages-sous-titre" }, "Temps de réponse"), temps)),
      sait("pieces-v1") ? essaiPieces() : null,
      bascule("Jauge du contexte", "Le cadran en haut des conversations : la place prise, et le résumé à 70 %. Allumée par défaut.", local.lire("diagnostic.jauge", true) !== false, async (x) => {
        local.ecrire("diagnostic.jauge", x);
        dire(x ? "La jauge du contexte s'affiche en haut des conversations." : "Jauge du contexte masquée.", { genre: "succes", duree: 2000 });
      }),
      bascule("Vitesse de Rémy", "Les tokens par seconde sous chaque réponse. Coupée par défaut.", local.lire("diagnostic.vitesse", false) === true, async (x) => {
        local.ecrire("diagnostic.vitesse", x);
        dire(x ? "La vitesse s'affiche sous chaque réponse." : "Vitesse masquée.", { genre: "succes", duree: 2000 });
      }),
      h("p", { class: "aide reglage" }, "Les codes d'erreur (R-…) restent sous chaque message raté, avec « Copier le diagnostic »."),
      repere("Version", h("dl", { class: "paires reglage" }, h("dt", null, "Tour"), h("dd", null, `${v.serveur || "?"}${v.commit ? ` · ${String(v.commit).slice(0, 7)}` : ""}`), h("dt", null, "API"), h("dd", null, String(v.api)), h("dt", null, "Capacités"), h("dd", null, String((v.capacites || []).length)),
        h("dt", null, "App Windows"), h("dd", null, bureau.estBureau() ? bureau.etatBureau()?.version || "oui" : "non (navigateur)"))),
      sait("maj-auto-v1") ? repere("Mise à jour automatique", h("div", { class: "reglage" }, majAuto)) : null,
      sousTitre("Incidents récents"),
      incidents.length ? h("ul", { class: "liste" }, incidents.slice(0, 15).map((i) => h("li", { class: "ligne" }, h("div", { class: "corps" }, h("div", { class: "titre-ligne mono" }, i.code || "?"), h("div", { class: "meta" }, [i.type, i.route, i.a ? quand(new Date(i.a).getTime()) : null].filter(Boolean).join(" · ")))))) : vide(null, "Aucun incident."),
      h("div", { class: "rangee", style: { marginTop: "12px" } }, bouton("Copier le diagnostic", { classe: "papier", icone: "copier", onclick: async () => { try { await navigator.clipboard.writeText(texte); dire("Diagnostic copié.", { genre: "succes" }); } catch { dire("Copie impossible ici.", { genre: "erreur" }); } } })));
  },

  async avance() {
    return carte("Avancé", null,
      repere("Interface classique", h("div", { class: "reglage" }, h("strong", null, "Interface classique"), h("p", { class: "aide", style: { margin: "4px 0 8px" } }, "La roadmap et la consigne de nuit y restent. L'appel, Faire connaissance et l'import de conversations sont maintenant ici."), h("a", { class: "btn papier", href: "/classique.html" }, icone("externe"), "Ouvrir l'interface classique"))),
      repere("Se déconnecter", h("div", { class: "reglage" }, h("strong", null, "Session"), h("p", { class: "aide", style: { margin: "4px 0 8px" } }, "Sur cet ordinateur seulement."), bouton("Se déconnecter", { classe: "danger", onclick: async (e) => {
        if (!(await confirmer("Se déconnecter de Rémy ?", { detail: phraseDeconnexion(fileEnvoi.compte()), libelle: "Se déconnecter", danger: true }))) return;
        await occupe(e.currentTarget, async () => {
          try {
            await ecrire("/api/logout", {});
          } catch (err) {
            // Tour injoignable : la session reste sur la tour ; on le dit, sans recharger.
            if (err?.nature !== "auth") return direErreur(err, null, "Pas déconnecté");
          }
          location.reload();
        });
      } }))));
  },
};

const court = (t, n = 40) => {
  const s = String(t || "").trim();
  return s.length <= n ? s : `${s.slice(0, n - 1).trim()}…`;
};

let appareilsLus = null;
/** Le briefing ou le bilan refusé par Windows à l'allumage : { nom, raison }. */
let refusRituel = null;

/** Redessine Ordinateur (l'heure n'apparaît que l'interrupteur allumé). */
async function redessinerOrdinateur() {
  if (section === "ordinateur") await redessiner(null);
}

/**
 * Allume le briefing ou le bilan, puis essaie une notification : refusée par
 * Windows, rien ne sonnerait, le réglage revient et c'est dit (bureau.js du
 * lot boîte le fait ; ici le même geste tant qu'il n'est pas fusionné).
 */
async function activerRituel(nom) {
  if (typeof bureau.activerRituel === "function") return bureau.activerRituel(nom);
  const cle = nom === "bilan" ? "bilan" : "briefing";
  const r = bureau.reglerNotifs({ [cle]: true });
  try {
    await bureau.notifier("Rémy", cle === "bilan" ? `Ton bilan du soir arrivera ici chaque soir à ${r.heureBilan}.` : `Ton briefing arrivera ici chaque matin à ${r.heureBriefing}.`, `essai@${Date.now()}`, `aujourdhui/${cle}`);
    return { ok: true, erreur: null };
  } catch (err) {
    bureau.reglerNotifs({ [cle]: false });
    return { ok: false, erreur: texteErreur(err) };
  }
}

function basculeCircuit(id, c, groupe) {
  const titre = CIRCUITS[id]?.[0] || c.nom || id;
  return bascule(titre, detailCircuit(id, c), c.actif, async (v) => {
    const r = await remplacer("/api/reglages", { circuits: { [id]: v } });
    reglagesTour = r;
    dire(annonceCircuit(id, v), { genre: "succes" });
    await redessiner(section === "remy" ? r : undefined);
  }, { groupe, desactive: c.forceParLaTour === true });
}

// --- Ce que Rémy sait de toi : lu d'abord, corrigé ensuite ---

function memoireVue(etat) {
  const modifie = () => etat.edition && etat.texte !== etat.texteServeur;
  garde = () => (modifie() ? "ta correction de la mémoire" : null);
  if (!etat.edition) {
    const vide0 = !etat.texteServeur.trim();
    return carte("Ce que Rémy sait de toi", etat.majA ? `Mise à jour ${quand(etat.majA)}.` : null,
      h("p", { class: "aide reglages-intro" }, "Rémy met ce texte à jour après vos échanges. Si quelque chose est faux, corrige-le : tu as le dernier mot."),
      vide0 ? h("p", { class: "reglage" }, "Rémy ne sait encore rien de toi. Parle-lui, ou commence « Faire connaissance ».")
        : h("div", { class: "md reglages-memoire reglage", html: markdown(etat.texteServeur) }),
      h("div", { class: "rangee", style: { marginTop: "12px" } }, bouton("Corriger", { classe: "plein", icone: "crayon", onclick: () => {
        vider(refs.detail, memoireVue({ ...etat, edition: true, texte: etat.texteServeur }));
        refs.detail.querySelector("textarea")?.focus();
      } })));
  }
  const zone = h("textarea", { class: "champ reglages-memoire-champ", rows: 18, "aria-label": "Ce que Rémy sait de toi" });
  zone.value = etat.texte;
  const enregistrer = bouton("Enregistrer", { classe: "plein", onclick: () => envoyer(false) });
  enregistrer.dataset.enregistrer = "1";
  const maj = () => {
    etat.texte = zone.value;
    enregistrer.disabled = !modifie() || etat.enregistrement;
  };
  zone.addEventListener("input", maj);
  const lecture = (texteServeur, majA = etat.majA) => {
    garde = () => null;
    vider(refs.detail, memoireVue({ texteServeur, majA, edition: false }));
  };
  const envoyer = async (malgreConflit) => {
    if (etat.enregistrement || !modifie()) return;
    etat.enregistrement = true;
    enregistrer.querySelector(".lib").textContent = "…";
    maj();
    try {
      if (!malgreConflit) {
        // Rémy réécrit ce texte après vos échanges : ne pas écraser en silence ce qu'il vient d'ajouter.
        const actuelle = await api("/api/memory");
        if ((actuelle?.text || "") !== etat.texteServeur) {
          etat.enregistrement = false;
          enregistrer.querySelector(".lib").textContent = "Enregistrer";
          maj();
          const f = feuille({
            titre: "Rémy a modifié ce texte pendant que tu le corrigeais",
            contenu: h("p", { class: "aide" }, "Si tu gardes ta version, ce que Rémy vient d'ajouter sera perdu."),
            pied: [bouton("Voir la sienne", { classe: "papier", onclick: () => f.fermer("sienne") }), bouton("Garder ma version", { classe: "danger", onclick: () => f.fermer("mienne") })],
          });
          f.el.querySelector(".feuille-pied .btn")?.focus();
          const choix = await f.fini;
          if (choix === "mienne") return envoyer(true);
          if (choix === "sienne") lecture(actuelle?.text || "", actuelle?.updatedAt || null);
          else zone.focus();
          return;
        }
      }
      await remplacer("/api/memory", { text: etat.texte });
      dire("Enregistré : Rémy s'en servira dès maintenant.", { genre: "succes" });
      lecture(etat.texte, Date.now());
    } catch (err) {
      etat.enregistrement = false;
      if (enregistrer.isConnected) enregistrer.querySelector(".lib").textContent = "Enregistrer";
      maj();
      direErreur(err, () => envoyer(malgreConflit), "Mémoire pas enregistrée");
    }
  };
  maj();
  return carte("Ce que Rémy sait de toi", "Corrige ce qui est faux : Rémy s'en servira dès l'enregistrement.",
    h("div", { class: "reglage" }, zone),
    h("div", { class: "rangee" }, bouton("Annuler", { classe: "papier", onclick: () => lecture(etat.texteServeur) }), enregistrer, h("span", { class: "aide" }, `${ctrl}+S`)));
}

// --- Ce qui compte : « Ce que Rémy a compris » (12/11) ---
// Sam n'écrit plus ses priorités : la tour en PROPOSE un classement, sans IA,
// avec ses indices (GET /api/priorites/proposition). Sam confirme (« C'est
// ça »), corrige (↑ ↓) ou écarte (« Pas une priorité »). Tant qu'il n'a pas
// confirmé, c'est « proposé par Rémy, à confirmer », et rien ne s'en sert
// comme d'un fait : seules les priorités confirmées (`classee`) forment le
// classement, daté, que lisent le conseil, la nuit et « Prochaines heures ».
// Ajouter une priorité à la main reste possible, discrètement, en bas.

const PRIORITES_MAX = 5;
const SOUS_PRIORITES = "Ce que Rémy a compris de ce qui compte pour toi. Tu confirmes ou tu corriges : seul ce que tu confirmes lui sert.";
const nouvelIdPriorite = () => `p-${Math.random().toString(36).slice(2, 10)}`;
const avecLien = () => sait("priorites-v2");

/**
 * Les projets Motion qu'on peut relier, d'après GET /api/projets :
 * { liste: [{ id, nom }], etat: "ok" | "absent" (Motion pas relié) | "erreur" | "inconnu" (tour d'avant) }.
 */
export function projetsLiables(r) {
  if (!r || r.status === "fulfilled" && r.value == null) return { liste: [], etat: "inconnu" };
  if (r.status === "rejected") return { liste: [], etat: "erreur" };
  const v = r.value;
  if (v?.motion === false) return { liste: [], etat: "absent" };
  const liste = (Array.isArray(v?.projets) ? v.projets : []).filter((p) => p && p.id && p.nom).map((p) => ({ id: String(p.id), nom: String(p.nom) }));
  return { liste: liste.sort((a, b) => a.nom.localeCompare(b.nom, "fr")), etat: "ok" };
}

/** Les choix du menu « Projet Motion » d'une priorité : aucun, les projets connus, et le lien gardé s'il n'y est plus. */
export function choixProjet(p, projets) {
  const choix = [{ id: "", nom: "Aucun projet Motion" }, ...projets.liste];
  if (p?.projetMotion && !projets.liste.some((x) => x.id === p.projetMotion)) {
    choix.push({ id: p.projetMotion, nom: `${p.projetNom || "Projet relié"}${projets.etat === "ok" ? " (plus dans Motion)" : ""}` });
  }
  return choix;
}

/** Monter (−1) ou descendre (+1) la ligne `i` : la nouvelle liste, ou null au bord. */
export function deplacerPriorite(liste, i, sens) {
  const j = i + sens;
  if (i < 0 || i >= liste.length || j < 0 || j >= liste.length) return null;
  const out = [...liste];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** La clé d'une piste dans la proposition (celle que « Pas une priorité » écarte). */
export const clePiste = (p) => p?.cle || (p?.projetMotion ? `motion:${p.projetMotion}` : `declaree:${p?.id}`);

/**
 * L'écran à partir de ce que la tour a rendu : `classees` (le classement
 * confirmé, dans l'ordre), `proposees` (ce que Rémy propose, à confirmer :
 * ses pistes, et les priorités écrites mais jamais confirmées), `ecartees`.
 * `proposition` : null si elle n'a pas pu être calculée (les priorités
 * écrites restent alors proposées, sans indices).
 */
export function etatClassement(lu, proposition) {
  const liste = Array.isArray(lu?.priorites) ? lu.priorites : [];
  const copie = (p) => ({ ...p, motsTexte: (p.mots || []).join(", ") });
  const classees = liste.filter((p) => p.classee === true).map(copie);
  const ecrites = liste.filter((p) => p.classee !== true);
  const proposees = [];
  for (const c of proposition?.candidats || []) {
    if (!c?.cle || !c.titre) continue;
    const ecrite = c.declaree?.id ? ecrites.find((p) => p.id === c.declaree.id) : null;
    proposees.push({
      ...(ecrite ? copie(ecrite) : { id: null, titre: c.titre, pourquoi: "", mots: [], motsTexte: "" }),
      cle: c.cle, titre: ecrite?.titre || c.titre, projetMotion: c.projetMotion || ecrite?.projetMotion || null, projetNom: c.projetNom || ecrite?.projetNom || null,
      indices: (c.indices || []).map((i) => i.texte).filter(Boolean), ecrite: Boolean(ecrite),
    });
  }
  // Une priorité écrite que la proposition ne montre pas (elle n'a pas pu être calculée, ou au-delà de ses pistes) : proposée quand même.
  for (const p of ecrites) {
    if (!proposees.some((x) => x.ecrite && x.id === p.id)) proposees.push({ ...copie(p), cle: clePiste(p), indices: ["Tu l'as écrite toi-même"], ecrite: true });
  }
  return { classees, proposees, ecartees: Array.isArray(lu?.ecartees) ? [...lu.ecartees] : [] };
}

/** « C'est ça » : la piste devient une priorité confirmée (les mots de Sam gardés s'il l'avait écrite). */
export function confirmerPiste(x, nouvelId = nouvelIdPriorite) {
  return { ...x, id: x.id || nouvelId(), titre: [...String(x.titre || "").trim()].slice(0, 80).join(""), classee: true, indices: undefined, cle: undefined, ecrite: undefined };
}

/**
 * Ce qui part vers la tour : le classement (confirmées, dans l'ordre), puis
 * les priorités écrites pas encore confirmées (elles restent à Sam, sans
 * rang) ; les pistes de Rémy non confirmées ne partent pas — ce ne sont que
 * des hypothèses.
 */
export function aEnregistrerClassement({ classees, proposees, ecartees }) {
  const liste = [...classees.map((p) => ({ ...p, classee: true })), ...proposees.filter((p) => p.ecrite).map((p) => ({ ...p, classee: false }))];
  return { priorites: aEnvoyerPriorites(liste, { lien: true }), ecartees: [...new Set(ecartees)] };
}

function prioritesVue(lu, { proposition = null, projets = { liste: [], etat: "inconnu" } } = {}) {
  if (!avecLien()) return prioritesSansProposition(lu);
  const e = etatClassement(lu, proposition);
  const initial = JSON.stringify(aEnregistrerClassement(etatClassement(lu, proposition)));
  let enregistrement = false;
  let edition = null; // l'identifiant de la priorité confirmée ouverte en « Modifier »
  const annonce = h("p", { class: "reglages-annonce", role: "status", "aria-live": "polite" });
  const modifie = () => JSON.stringify(aEnregistrerClassement(e)) !== initial;
  garde = () => (modifie() ? "ton classement" : null);
  const enregistrer = bouton("Enregistrer le classement", { classe: "plein", onclick: () => envoyer() });
  enregistrer.dataset.enregistrer = "1";
  const majBouton = () => {
    enregistrer.disabled = !modifie() || enregistrement;
    enregistrer.querySelector(".lib").textContent = enregistrement ? "…" : "Enregistrer le classement";
  };
  const zone = h("div", { class: "reglages-priorites" });
  const dire2 = (t) => (annonce.textContent = t);
  const nomDe = (p) => `« ${court(p.titre || "Sans titre")} »`;
  const plein = () => e.classees.length >= PRIORITES_MAX;
  const changer = (focus) => {
    dessiner();
    majBouton();
    focus?.();
  };
  const focusSur = (cle, quoi) => () => zone.querySelector(`[data-ligne="${CSS.escape(cle)}"] ${quoi}`)?.focus();

  // --- Les gestes ---
  const deplacer = (liste, i, sens) => {
    const neuf = deplacerPriorite(liste, i, sens);
    if (!neuf) return;
    liste.splice(0, liste.length, ...neuf);
    const x = liste[i + sens];
    const k = clePiste(x);
    dire2(`${nomDe(x)} passe en ${liste === e.classees ? "n°" : "proposition n°"}${i + sens + 1}. Enregistrer pour confirmer.`);
    // Le focus suit la ligne déplacée ; au bord, il passe sur l'autre flèche.
    changer(() => {
      const ligne = zone.querySelector(`[data-ligne="${CSS.escape(k)}"]`);
      const meme = ligne?.querySelector(`[data-sens='${sens < 0 ? "haut" : "bas"}']`);
      (meme && !meme.disabled ? meme : ligne?.querySelector(`[data-sens='${sens < 0 ? "bas" : "haut"}']`))?.focus();
    });
  };
  const confirmer = (i) => {
    if (plein()) return dire("Cinq au plus dans ton classement : retire ou écarte une priorité d'abord.", { genre: "erreur" });
    const [x] = e.proposees.splice(i, 1);
    const p = confirmerPiste(x);
    e.classees.push(p);
    dire2(`${nomDe(p)} entre dans ton classement en n°${e.classees.length}. Enregistrer pour confirmer.`);
    changer(focusSur(clePiste(e.proposees[Math.min(i, e.proposees.length - 1)] || p), "button"));
  };
  const toutConfirmer = () => {
    const place = PRIORITES_MAX - e.classees.length;
    const pris = e.proposees.splice(0, place);
    e.classees.push(...pris.map((x) => confirmerPiste(x)));
    dire2(`${pris.length} confirmée${pris.length > 1 ? "s" : ""}, dans cet ordre. Enregistrer pour confirmer.`);
    changer(() => enregistrer.focus());
  };
  const ecarter = (liste, i) => {
    const [x] = liste.splice(i, 1);
    if (!e.ecartees.includes(clePiste(x))) e.ecartees.push(clePiste(x));
    dire2(`${nomDe(x)} : pas une priorité. Rémy ne la reproposera plus. Enregistrer pour confirmer.`);
    const suivante = liste[Math.min(i, liste.length - 1)];
    changer(suivante ? focusSur(clePiste(suivante), "button") : () => enregistrer.focus());
  };
  const ajouter = () => {
    if (plein()) return dire("Cinq au plus dans ton classement : au-delà, plus rien n'est prioritaire.", { genre: "erreur" });
    const p = { id: nouvelIdPriorite(), titre: "", pourquoi: "", mots: [], motsTexte: "", classee: true };
    e.classees.push(p);
    edition = p.id;
    changer(focusSur(clePiste(p), "input"));
  };
  const reproposer = () => {
    e.ecartees = [];
    dire2("Les pistes écartées seront reproposées après l'enregistrement.");
    changer(() => enregistrer.focus());
  };

  // --- Les lignes ---
  const fleches = (liste, i, x) => {
    const f = (sens, lib) => {
      const b = bouton("", { classe: "texte icone", icone: sens, etiquette: `${lib} ${nomDe(x)}`, onclick: () => deplacer(liste, i, sens === "haut" ? -1 : 1) });
      b.dataset.sens = sens;
      b.title = lib;
      b.disabled = sens === "haut" ? i === 0 : i === liste.length - 1;
      return b;
    };
    return liste.length > 1 ? [f("haut", "Monter"), f("bas", "Descendre")] : [];
  };
  const indices = (x) => (x.indices?.length ? h("ul", { class: "reglages-indices", "aria-label": `Ce que Rémy a vu pour ${nomDe(x)}` }, x.indices.map((t) => h("li", null, t))) : null);
  const ligneClassee = (p, i) => {
    const ouvert = edition === p.id;
    const etat = etatPriorite(p);
    const modifier = bouton(ouvert ? "Fermer" : "Modifier", { classe: "texte", onclick: () => { edition = ouvert ? null : p.id; changer(focusSur(clePiste(p), ouvert ? "[data-modifier]" : "input")); } });
    modifier.dataset.modifier = "1";
    modifier.setAttribute("aria-expanded", String(ouvert));
    return h("li", { class: "reglages-priorite classee", dataset: { ligne: clePiste(p) } },
      h("div", { class: "reglages-priorite-tete" },
        h("span", { class: "reglages-rang", title: `Priorité n°${i + 1}` }, `n°${i + 1}`),
        h("span", { class: "reglages-priorite-titre" }, h("strong", null, p.titre || "Sans titre"), p.projetNom ? h("span", { class: "aide" }, `Motion : ${p.projetNom}`) : null)),
      etat ? h("p", { class: p.neglige === true ? "reglages-neglige" : "aide" }, etat) : null,
      ouvert ? edition_(p) : null,
      h("div", { class: "rangee serree reglages-gestes" }, ...fleches(e.classees, i, p), modifier,
        bouton("Pas une priorité", { classe: "texte", etiquette: `${nomDe(p)} n'est pas une priorité`, onclick: () => ecarter(e.classees, i) })));
  };
  const edition_ = (p) => {
    const champ = (balise, props, cle) => {
      const el = h(balise, { class: "champ", ...props });
      el.value = p[cle] || "";
      el.addEventListener("input", () => {
        p[cle] = el.value;
        majBouton();
      });
      return el;
    };
    const menu = h("select", { class: "champ", "aria-label": `Projet Motion de ${nomDe(p)}` }, choixProjet(p, projets).map((x) => h("option", { value: x.id }, x.nom)));
    menu.value = p.projetMotion || "";
    menu.addEventListener("change", () => {
      p.projetMotion = menu.value || null;
      p.projetNom = menu.value ? (projets.liste.find((c) => c.id === menu.value)?.nom || p.projetNom || null) : null;
      majBouton();
    });
    return h("div", { class: "reglages-edition" },
      champ("input", { type: "text", placeholder: "Ce qui compte (ex. « La musique »)", "aria-label": "Ce qui compte", maxlength: "120" }, "titre"),
      champ("textarea", { rows: 2, placeholder: "Pourquoi, avec tes mots (facultatif)", "aria-label": "Pourquoi" }, "pourquoi"),
      champ("input", { type: "text", placeholder: "Mots qui la reconnaissent (facultatif : guitare, répétition)", "aria-label": "Mots qui la reconnaissent" }, "motsTexte"),
      h("label", { class: "reglages-lien-projet" }, h("span", { class: "aide" }, "Projet Motion (facultatif)"), menu),
      projets.etat === "erreur" ? h("p", { class: "aide" }, "Les projets Motion n'ont pas pu être lus : le lien déjà posé reste.") : null);
  };
  const ligneProposee = (x, i) => h("li", { class: "reglages-priorite proposee", dataset: { ligne: clePiste(x) } },
    h("div", { class: "reglages-priorite-tete" },
      h("span", { class: "reglages-rang propose", title: "Proposée par Rémy, à confirmer" }, `${i + 1} ?`),
      h("span", { class: "reglages-priorite-titre" }, h("strong", null, x.titre), x.projetNom && x.projetNom !== x.titre ? h("span", { class: "aide" }, `Motion : ${x.projetNom}`) : null)),
    indices(x),
    h("div", { class: "rangee serree reglages-gestes" },
      bouton("C'est ça", { classe: "papier", icone: "coche", etiquette: `C'est ça : ${nomDe(x)} est une priorité`, onclick: () => confirmer(i) }),
      ...fleches(e.proposees, i, x),
      bouton("Pas une priorité", { classe: "texte", etiquette: `${nomDe(x)} n'est pas une priorité`, onclick: () => ecarter(e.proposees, i) })));

  const dessiner = () => {
    const classeA = lu.classeA && !modifie() ? ` · confirmé le ${jourCourt(lu.classeA)}` : modifie() ? " · à enregistrer" : "";
    vider(zone,
      e.classees.length ? h("section", { class: "reglages-classement", "aria-label": "Ton classement" },
        h("h3", { class: "reglages-sous-titre" }, `Ton classement${classeA}`),
        e.classees.length > 1 ? h("p", { class: "reglages-regle" }, icone("etoile"), h("span", null, "Dans l'ordre : la n°1 passe devant la n°2, et ainsi de suite.")) : null,
        h("ol", { class: "reglages-liste-priorites" }, e.classees.map(ligneClassee))) : null,
      e.proposees.length ? h("section", { class: "reglages-proposition", "aria-label": "Proposé par Rémy, à confirmer" },
        h("h3", { class: "reglages-sous-titre" }, "Proposé par Rémy, à confirmer"),
        h("p", { class: "aide" }, e.classees.length
          ? "Rémy voit aussi ces pistes. Rien ne s'en sert tant que tu n'as pas dit « C'est ça »."
          : "Voilà ce que Rémy a compris, dans cet ordre. Rien ne s'en sert tant que tu n'as pas dit « C'est ça »."),
        h("ol", { class: "reglages-liste-priorites" }, e.proposees.map(ligneProposee)),
        e.proposees.length > 1 && !plein() ? h("div", { class: "rangee reglage" }, bouton(e.classees.length ? "Les confirmer toutes, dans cet ordre" : "Tout est juste, dans cet ordre", { classe: "papier", icone: "coche", onclick: toutConfirmer })) : null) : null,
      !e.classees.length && !e.proposees.length
        ? h("p", { class: "aide reglage" }, proposition
          ? "Rémy n'a encore rien à te proposer : ni projet Motion actif, ni priorité écrite. Il en proposera dès que Motion aura des tâches planifiées."
          : "La proposition de Rémy n'a pas pu être calculée : réessaie dans un instant.")
        : null,
      proposition?.limites ? h("p", { class: "aide reglages-limites" }, icone("info"), h("span", null, proposition.limites)) : null,
      proposition ? null : h("p", { class: "aide" }, "La proposition de Rémy n'a pas pu être lue : seules tes priorités écrites sont montrées."),
      h("div", { class: "rangee reglages-discret" },
        plein() ? h("span", { class: "aide" }, "Cinq au plus : au-delà, plus rien n'est prioritaire.") : bouton("Ajouter une priorité à la main", { classe: "texte petit", icone: "plus", onclick: ajouter }),
        e.ecartees.length ? bouton(`Reproposer les pistes écartées (${e.ecartees.length})`, { classe: "texte petit", onclick: reproposer }) : null));
  };

  const envoyer = async () => {
    if (enregistrement || !modifie()) return;
    enregistrement = true;
    majBouton();
    try {
      const r = await remplacer("/api/priorites", { ...aEnregistrerClassement(e), base: lu.version || 0 });
      const n = (r?.priorites || []).filter((p) => p.classee === true).length;
      dire(n ? `Classement enregistré : ${n} priorité${n > 1 ? "s" : ""}, dans cet ordre. Rémy s'en sert dès maintenant.` : "Enregistré : pas de classement confirmé pour l'instant.", { genre: "succes" });
      garde = () => null;
      await dessinerSection();
    } catch (err) {
      enregistrement = false;
      majBouton();
      if (err?.statut === 409) {
        dire("Ton classement a changé ailleurs entre-temps : je recharge, refais ta correction.", { genre: "erreur" });
        garde = () => null;
        await dessinerSection();
        return;
      }
      direErreur(err, () => envoyer(), "Classement pas enregistré");
    }
  };
  dessiner();
  majBouton();
  const pied = lu.version > 0 ? h("p", { class: "aide" }, `Version ${lu.version}${lu.majA ? ` du ${jourCourt(lu.majA)}` : ""} : chaque enregistrement garde les précédentes sur ta tour.`) : null;
  return carte("Ce qui compte", SOUS_PRIORITES,
    zone, annonce, h("div", { class: "rangee", style: { marginTop: "12px" } }, enregistrer, h("span", { class: "aide" }, `${ctrl}+S`)), pied);
}

/** Une tour d'avant priorites-v2 : la liste écrite, en lecture, et quoi faire. */
function prioritesSansProposition(lu) {
  garde = () => null;
  return carte("Ce qui compte", SOUS_PRIORITES,
    (lu.priorites || []).length ? h("ol", { class: "reglages-liste-priorites" }, lu.priorites.map((p) => h("li", { class: "reglages-priorite" }, h("strong", null, p.titre), etatPriorite(p) ? h("p", { class: "aide" }, etatPriorite(p)) : null))) : null,
    h("p", { class: "aide reglage" }, "Le classement proposé par Rémy arrive avec la mise à jour de ta tour (scripts/installer-tour.ps1)."));
}

// --- Modèle ---

function modeleVue(m) {
  let enCours = null;
  const servis = m.servis || [];
  const choix = [{ id: null, libelle: "Automatique", sous: `Celui que tes Sparks chargent${servis[0] ? ` : ${servis[0].libelle}` : ""}` }, ...servis.map((s) => ({ id: s.id, libelle: s.libelle || s.id, sous: fenetreLisible(s.fenetre) }))];
  const boutons = [];
  const liste = h("div", { class: "reglages-choix", role: "radiogroup", "aria-label": "Modèle" }, choix.map((x) => {
    const coche = (m.choisi ?? null) === x.id;
    const fin = h("span", { class: "fin" }, coche ? icone("coche", "reglages-coche") : null);
    const b = h("button", { type: "button", class: "reglages-ligne-lien reglages-choix-ligne", role: "radio", "aria-checked": String(coche), dataset: { cle: `modele:${x.id ?? "auto"}` } },
      h("span", { class: "corps" }, h("span", { class: "titre-ligne" }, x.libelle), x.sous ? h("span", { class: "sous" }, x.sous) : null), fin);
    b.addEventListener("click", async () => {
      if (enCours !== null) return;
      enCours = x.id ?? "";
      boutons.forEach((y) => (y.disabled = true));
      vider(fin, tourne());
      try {
        const v = await remplacer("/api/modeles", { id: x.id });
        const nom = v?.actif?.libelle || x.libelle;
        dire(x.id == null ? `Rémy suit le modèle de tes Sparks (${nom}).` : `Rémy répond maintenant avec ${nom}.`, { genre: "succes" });
        await redessiner(v);
      } catch (err) {
        enCours = null;
        boutons.forEach((y) => (y.disabled = false));
        vider(fin, coche ? icone("coche", "reglages-coche") : null);
        direErreur(err, () => b.click(), "Modèle pas changé");
      }
    });
    boutons.push(b);
    return b;
  }));
  const pied = `Seuls les modèles chargés sur tes Sparks apparaissent ici : tes conversations restent chez toi. ${sait("recherche-locale-v1") ? "Rémy cherche lui-même sur le web, sans Claude (Réglages › Recherche web)." : "Claude ne sert qu'aux recherches web que tu autorises."}`;
  return carte("Modèle", null,
    sousTitre("En ce moment"),
    h("div", { class: "reglage" }, h("strong", { class: "reglages-modele-actif" }, m.actif?.libelle || "Modèle inconnu"), h("p", { class: "aide" }, [pourquoiModele(m), m.machine].filter(Boolean).join(" · ")),
      m.joignable === false ? h("p", { class: "erreur-champ" }, "Les Sparks ne répondent pas : la liste ci-dessous peut dater. Rémy reprendra dès qu'elles reviennent.") : null),
    m.branche === false ? h("p", { class: "aide reglage" }, "Pas de modèle local branché sur la tour (REMY_GLM_URL).") : [
      sousTitre("Modèle"),
      liste,
      servis.length ? null : h("p", { class: "aide reglage" }, m.joignable !== false ? "Les Sparks ne déclarent aucun modèle." : "Aucun modèle connu tant que les Sparks ne répondent pas."),
    ],
    h("p", { class: "aide", style: { marginTop: "10px" } }, pied));
}

// --- Règles de Rémy ---

function reglesVue(regles) {
  let verification = false;
  const majListe = (r) => redessiner(r.regles || []);
  const basculer = async (r, actif) => {
    const v = await modifier(`/api/regles/${seg(r.id)}`, { actif });
    dire(actif ? `Règle « ${r.nom} » allumée.` : `Règle « ${r.nom} » coupée.`, { genre: "succes" });
    await majListe(v);
  };
  const supprimerRegle = async (r) => {
    if (!(await confirmer(`Supprimer la règle « ${r.nom} » ?`, { detail: "Rémy ne proposera plus sa tâche.", libelle: "Supprimer", danger: true }))) return;
    try {
      const v = await supprimer(`/api/regles/${seg(r.id)}`);
      dire(`Règle « ${r.nom} » supprimée.`, { genre: "succes" });
      await majListe(v);
    } catch (err) {
      direErreur(err, () => supprimerRegle(r), "Règle pas supprimée");
    }
  };
  const lignes = regles.map((r) => {
    const el = bascule(r.nom, detailRegle(r), r.actif !== false, (v) => basculer(r, v), { ancre: `regle:${r.id}`, classe: "reglages-regle" });
    const corbeille = bouton("", { classe: "texte icone", icone: "corbeille", etiquette: `Supprimer la règle « ${r.nom} »`, onclick: (e) => {
      e.preventDefault();
      supprimerRegle(r);
    } });
    const rangee = h("div", { class: "rangee reglages-regle-rangee" }, el, corbeille);
    surMenu(rangee, () => [
      { libelle: r.actif !== false ? "Couper la règle" : "Allumer la règle", icone: "curseurs", faire: () => basculer(r, r.actif === false).catch((err) => direErreur(err, null, "Règle pas changée")) },
      { libelle: "Supprimer", icone: "corbeille", danger: true, faire: () => supprimerRegle(r) },
    ], { titre: `Règle « ${r.nom} »` });
    return rangee;
  });
  const verifier = regles.length ? bouton("Vérifier maintenant", { classe: "papier", icone: "calendrier", onclick: async (e) => {
    if (verification) return;
    verification = true;
    const b = e.currentTarget;
    b.disabled = true;
    b.querySelector(".lib").textContent = "Rémy regarde ton agenda…";
    try {
      const r = await ecrire("/api/regles/verifier", {}, { delai: 60000 });
      const n = r?.proposees || 0;
      if (n > 0) {
        dire(`${n} tâche${n > 1 ? "s" : ""} proposée${n > 1 ? "s" : ""} dans le fil « Règles de Rémy ».`, { genre: "succes", action: { libelle: "Ouvrir le fil", faire: () => ouvrirFilRegles(r.conversation) }, duree: 10000 });
      } else dire("Rien de nouveau : aucun événement à venir ne demande de tâche.");
    } catch (err) {
      direErreur(err, () => b.click(), "Vérification impossible");
    } finally {
      verification = false;
      if (b.isConnected) {
        b.disabled = false;
        b.querySelector(".lib").textContent = "Vérifier maintenant";
      }
    }
  } }) : null;
  const circuit = reglagesTour?.circuits?.regles;
  return carte("Règles de Rémy", "Les tâches à faire avant un type d'événement.",
    circuit ? basculeCircuit("regles", circuit, null) : null,
    regles.length ? h("div", { class: "reglages-regles" }, lignes) : h("p", { class: "reglage" }, "Aucune règle pour l'instant. Dis à Rémy, par exemple : « avant chaque sortie, rappelle-moi de me raser »."),
    verifier ? h("div", { class: "rangee", style: { marginTop: "10px" } }, verifier) : null,
    h("p", { class: "aide", style: { marginTop: "12px" } }, "Rémy relit ton agenda et Motion toutes les 3 heures (de 7 h à 22 h), sans IA. Quand un événement correspond, il te propose la tâche dans le fil « Règles de Rémy » : rien n'est créé sans toi."));
}

/** Le fil « Règles de Rémy » : celui que la vérification a rempli, sinon cherché par son titre. */
async function ouvrirFilRegles(id) {
  if (id) return ctx.aller(`remy/${encodeURIComponent(id)}`);
  try {
    const l = await api("/api/conversations");
    const c = (Array.isArray(l) ? l : []).find((x) => x.title === "Règles de Rémy");
    ctx.aller(c ? `remy/${encodeURIComponent(c.id)}` : "remy");
  } catch (err) {
    direErreur(err, () => ouvrirFilRegles(id), "Fil introuvable");
  }
}

// --- Activité du PC ---

const etatActivite = { vue: null, enCours: false };

/** Un geste sur la tour à la fois ; la réponse (VueActivitePC) redessine la section. */
async function gesteActivite(f, phrase) {
  if (etatActivite.enCours) {
    dire("Un réglage est déjà en cours sur la tour : réessaie dans un instant.");
    return false;
  }
  etatActivite.enCours = true;
  await redessiner(etatActivite.vue);
  try {
    const v = await f();
    if (v && typeof v === "object" && "actif" in v) etatActivite.vue = v;
    else etatActivite.vue = await api("/api/activite-pc");
    const p = phrase(etatActivite.vue);
    if (p) dire(p, { genre: "succes" });
    return true;
  } catch (err) {
    direErreur(err, () => gesteActivite(f, phrase), "Pas fait sur la tour");
    return false;
  } finally {
    etatActivite.enCours = false;
    if (section === "activite") await redessiner(etatActivite.vue);
  }
}

function activiteVue(v) {
  etatActivite.vue = v;
  const enCours = etatActivite.enCours;
  const categories = new Map((v.categories || []).map((c) => [c.id, c.nom]));
  const nomCategorie = (id) => (v.semaine?.categories || []).find((c) => c.id === id)?.nom || categories.get(id) || null;
  const relever = (e) => occupe(e?.currentTarget, () => gesteActivite(() => ecrire("/api/activite-pc/collecte", {}, { delai: 20000 }), (x) => {
    const p = problemeActivite(x);
    if (p) {
      dire(p, { genre: "erreur" });
      return null;
    }
    return `Relu sur la tour : ${releveActivite(x).toLowerCase()}.`;
  }));
  const interrupteur = bascule("Activité du PC", "Le temps passé dans chaque appli de ta tour, d'après ActivityWatch. Rémy y voit des repères sur ta journée.", v.actif,
    (oui) => gesteActivite(() => remplacer("/api/activite-pc", { actif: oui }), (x) => messageActivation(x, oui)), { desactive: v.coupeParLaTour || enCours });
  const morceaux = [interrupteur];
  if (v.coupeParLaTour) morceaux.push(h("p", { class: "aide" }, "Coupée sur la tour (REMY_ACTIVITE_PC=off) : retire ce réglage de remy.env pour pouvoir l'allumer ici."));
  else if (enCours) morceaux.push(h("p", { class: "aide rangee reglages-en-cours" }, tourne(), "La tour relit ActivityWatch…"));
  if (v.actif) {
    const p = problemeActivite(v);
    morceaux.push(p
      ? h("div", { class: "reglage" },
        h("p", { class: "reglages-a-revoir rangee" }, icone("alerte"), h("span", null, p)),
        h("p", { class: "aide" }, v.activitywatch?.joignable === true
          ? "Sur la tour : ouvre ActivityWatch (l'icône près de l'horloge) et relance-le ; le dépannage est dans docs/tour.md."
          : "Sur la tour : installe ActivityWatch (activitywatch.net) et lance-le avec Windows ; le pas à pas est dans docs/tour.md."),
        h("div", { class: "rangee", style: { marginTop: "6px" } }, bouton("Réessayer maintenant", { classe: "papier", icone: "rafraichir", onclick: relever })))
      : h("div", { class: "reglage" },
        h("div", { class: "rangee" }, h("span", { style: { flex: 1 } }, releveActivite(v)), v.activitywatch?.version ? h("span", { class: "aide" }, `ActivityWatch ${v.activitywatch.version}`) : null,
          bouton("Relever maintenant", { classe: "papier petit", icone: "rafraichir", onclick: relever })),
        v.activitywatch?.web === false ? h("p", { class: "aide" }, "Sans l'extension ActivityWatch du navigateur, les sites ne sont pas détaillés (le temps du navigateur compte quand même).") : null));
    morceaux.push(bilanActivite("Aujourd'hui", v.aujourdhui, `Rien encore aujourd'hui : le temps compte quand tu es devant le PC. ${releveActivite(v)}.`));
    morceaux.push(bilanActivite("Ces 7 jours", v.semaine, "Pas encore assez de relevés pour la semaine.", comparaisonActivite(v)));
    const applis = v.semaine?.applis || [];
    if (applis.length) {
      const domaines = v.semaine?.domaines || [];
      morceaux.push(sousTitre("Applis les plus utilisées (7 jours)"),
        h("ul", { class: "liste" }, applis.map((a) => ligneComptee({ nom: a.nom, libelle: a.libelle || a.nom, sous: nomCategorie(a.categorie), secondes: a.secondes, categorie: a.categorie }))),
        domaines.length ? h("details", { class: "reglages-sites" }, h("summary", null, icone("bas", "chevron-replie"), "Sites (domaines seulement)"),
          h("ul", { class: "liste" }, domaines.map((d) => ligneComptee({ nom: d.nom, libelle: d.nom, secondes: d.secondes, site: true })))) : null,
        h("p", { class: "aide" }, "Clic droit sur une appli ou un site (ou son bouton « Ne plus compter ») pour ne plus le compter."));
    }
  }
  // Jamais comptées.
  morceaux.push(sousTitre("Jamais comptées"));
  if (!(v.exclusions || []).length && !(v.exclusionsTour || []).length) morceaux.push(h("p", { class: "aide" }, "Aucune appli exclue."));
  morceaux.push(h("ul", { class: "liste" },
    (v.exclusions || []).map((nom) => h("li", { class: "ligne" }, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, nom)),
      bouton("Compter de nouveau", { classe: "papier petit", icone: "oeil", etiquette: `Compter de nouveau « ${nom} »`, onclick: () => gesteActivite(() => remplacer("/api/activite-pc", { exclusions: (etatActivite.vue.exclusions || []).filter((x) => x !== nom) }), () => `« ${nom} » comptera de nouveau, à partir de maintenant.`) }))),
    (v.exclusionsTour || []).map((nom) => h("li", { class: "ligne grise" }, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, nom)), h("span", { class: "aide" }, "réglée sur la tour")))));
  const ajouter = bouton("Ne plus compter une appli…", { classe: "papier", icone: "oeilBarre", onclick: async () => {
    const nom = await demanderNom({ titre: "Ne plus compter une appli", placeholder: "Nom de l'appli (ex. Discord)", aide: "Son nom d'exécutable sans « .exe », ou un site (exemple.org). Ce qui était déjà compté s'efface.", libelle: "Exclure" });
    if (nom) exclure(nom);
  } });
  ajouter.disabled = enCours || v.coupeParLaTour;
  morceaux.push(repere("Ne plus compter une appli…", h("div", { class: "rangee reglage" }, ajouter)));
  morceaux.push(h("p", { class: "aide", style: { marginTop: "12px" } }, `Lu sur ta tour seulement. Les titres de fenêtres ne sont jamais gardés, un site se réduit à son domaine, la navigation privée est ignorée. Gardé ${v.jours ?? 90} jours, puis effacé. Le modèle local s'en sert comme repère ; Claude ne reçoit jamais ces relevés (avec le secours Claude, il peut lire ce que Rémy t'en a dit).`));
  const effacer = bouton("Tout effacer", { classe: "danger", icone: "corbeille", onclick: async () => {
    if (!(await confirmer("Effacer toute l'activité du PC ?", { detail: "Sur la tour. Ce qui précède ne sera pas relu dans ActivityWatch ; le relevé continue si l'activité reste allumée.", libelle: "Tout effacer", danger: true }))) return;
    gesteActivite(() => supprimer("/api/activite-pc"), () => "Activité du PC effacée sur la tour.");
  } });
  effacer.disabled = enCours;
  morceaux.push(repere("Tout effacer", h("div", { class: "rangee reglage" }, effacer)));
  return carte("Activité du PC", null, ...morceaux);
}

/** « Ne plus compter » : la clé de l'appli, refusée si elle est déjà exclue. */
function exclure(appli) {
  const c = cleExclusion(appli);
  const v = etatActivite.vue;
  if (!c || !v) return;
  if ((v.exclusions || []).includes(c)) return dire(`« ${c} » est déjà exclue.`);
  gesteActivite(() => remplacer("/api/activite-pc", { exclusions: [...(v.exclusions || []), c] }), () => `« ${c} » : plus rien n'est compté, et ce qui l'était est effacé sur la tour.`);
}

function bilanActivite(titre, b, videTexte, pied = null) {
  const total = b?.total || 0;
  return h("div", { class: "reglage reglages-bilan" },
    h("h3", { class: "titre-section reglages-sous-titre" }, titre, total >= 60 ? h("span", { class: "fin mono" }, dureeActivite(total)) : null),
    total < 60 ? h("p", { class: "aide" }, videTexte)
      : h("ul", { class: "liste reglages-barres" }, (b.categories || []).map((c) => h("li", { class: "reglages-barre-ligne", "aria-label": `${c.nom} : ${dureeActivite(c.secondes)}` },
        h("div", { class: "rangee" }, h("span", { style: { flex: 1 } }, c.nom), h("span", { class: "mono aide" }, dureeActivite(c.secondes))),
        h("div", { class: "reglages-barre", "aria-hidden": "true" }, h("span", { style: { width: `max(4px, ${Math.min(100, (c.secondes / total) * 100).toFixed(1)}%)` } }))))),
    pied ? h("p", { class: "aide" }, pied) : null);
}

/** Une appli ou un site compté : clic droit, ou son bouton au survol et au focus, pour ne plus le compter. */
function ligneComptee({ nom, libelle, sous = null, secondes, categorie = null, site = false }) {
  const confirmerExclusion = async () => {
    if (etatActivite.enCours) return dire("Un réglage est déjà en cours sur la tour : réessaie dans un instant.");
    if (!(await confirmer("Ne plus compter ?", { detail: messageExclusion({ categorie, secondes, site }), libelle: `Ne plus compter ${libelle}`, danger: true }))) return;
    exclure(nom);
  };
  const li = h("li", { class: "ligne reglages-appli", tabindex: "0", "aria-label": `${libelle}${sous ? `, ${sous}` : ""} : ${dureeActivite(secondes)}` },
    h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, libelle), sous ? h("div", { class: "meta" }, sous) : null),
    h("span", { class: "mono aide" }, dureeActivite(secondes)),
    bouton("Ne plus compter", { classe: "texte petit reglages-exclure", icone: "oeilBarre", etiquette: `Ne plus compter ${libelle}`, onclick: confirmerExclusion }));
  surMenu(li, () => [{ libelle: `Ne plus compter ${libelle}`, icone: "oeilBarre", danger: true, desactive: etatActivite.enCours, faire: confirmerExclusion }], { titre: libelle });
  return li;
}

// --- Localisation (lue et rangée ici ; le capteur reste sur l'iPhone) ---

function lieuxVue(v) {
  const geste = async (f, phrase) => {
    try {
      const r = await f();
      dire(phrase, { genre: "succes" });
      await redessiner(r && typeof r === "object" && Array.isArray(r.lieux) ? r : undefined);
    } catch (err) {
      direErreur(err, null, "Pas fait sur la tour");
    }
  };
  const renommer = async (l) => {
    const nom = await demanderNom({ titre: "Renommer", valeur: l.nom ?? l.commerce?.nom ?? "", placeholder: "Nom du lieu", libelle: "Renommer" });
    if (nom) geste(() => modifier(`/api/lieux/${seg(l.id)}`, { nom }), `Renommé en « ${nom} ».`);
  };
  const oublier = (l) => geste(() => supprimer(`/api/lieux/${seg(l.id)}`), `« ${lieuAffiche(l)} » oublié.`);
  const lieux = v.lieux || [];
  const notes = [];
  if (v.geocodage?.pret !== true) notes.push("Ta tour n'a pas encore sa base d'adresses : les lieux restent sans adresse. Sur la tour : scripts/geo-importer.mjs.");
  else if (v.commerces?.aRefaire === true) notes.push("La base des commerces de ta tour date d'avant les dernières règles : relance scripts/commerces-importer.mjs sur la tour.");
  else if (v.commerces != null && v.commerces.pret !== true) notes.push("Ta tour ne connaît pas encore les commerces autour de toi (coiffeur, drive, salle…). Sur la tour : scripts/commerces-importer.mjs.");
  return carte("Localisation", null,
    repere("Localisation", h("div", { class: "reglage" }, h("strong", null, "Localisation"), h("p", { class: "aide" }, v.actif ? "Allumée sur l'iPhone" : "Coupée (elle s'allume depuis l'iPhone)"))),
    sousTitre("En ce moment"),
    h("p", { class: "reglage" }, phraseEtatLieux(v.etat)),
    (v.aujourdhui || []).length ? [sousTitre("Aujourd'hui"), h("ul", { class: "liste" }, v.aujourdhui.map((x) => h("li", { class: "ligne" },
      h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, lieuLisible(x.lieu) || "Lieu sans adresse connue")),
      h("span", { class: "mono aide" }, `${heure(x.arrivee)}${x.depart ? `–${heure(x.depart)}` : ""}`))))] : null,
    repere("Tes lieux", h("h3", { class: "titre-section reglages-sous-titre" }, "Tes lieux")),
    lieux.length ? h("ul", { class: "liste" }, lieux.map((l) => {
      const li = h("li", { class: "ligne" },
        h("button", { type: "button", class: "corps cliquable reglages-lieu", onclick: () => renommer(l), "aria-label": `${lieuAffiche(l)}, renommer` },
          h("span", { class: "titre-ligne" }, lieuAffiche(l)),
          l.nom && l.adresse ? h("span", { class: "meta" }, l.adresse) : null,
          !l.nom && l.commerce ? h("span", { class: "reglages-sans-doute" }, `Sans doute : ${commerceLibelle(l.commerce)}`) : null,
          h("span", { class: "meta" }, sousTitreLieu(l))),
        bouton("", { classe: "texte icone", icone: "corbeille", etiquette: `Oublier « ${lieuAffiche(l)} »`, onclick: () => oublier(l) }));
      surMenu(li, () => [{ libelle: "Renommer", icone: "crayon", faire: () => renommer(l) }, { libelle: "Oublier ce lieu", icone: "corbeille", danger: true, faire: () => oublier(l) }], { titre: lieuAffiche(l) });
      return li;
    })) : h("p", { class: "aide" }, "Aucun lieu pour l'instant : ils apparaissent avec tes premières visites."),
    notes.map((n) => h("p", { class: "aide reglage" }, n)),
    h("p", { class: "aide", style: { marginTop: "10px" } }, `Gardé ${v.jours ?? 90} jours sur ta tour, puis effacé. Les adresses sont traduites chez toi : aucune position ne part chez Apple ni chez Claude.`),
    repere("Effacer l'historique", h("div", { class: "rangee reglage" }, bouton("Effacer l'historique", { classe: "danger", icone: "corbeille", onclick: async () => {
      if (!(await confirmer("Effacer tes visites et trajets ?", { detail: "Sur la tour. Les lieux que tu as nommés restent.", libelle: "Tout effacer", danger: true }))) return;
      geste(() => supprimer("/api/lieux/historique"), "Historique des lieux effacé.");
    } }))));
}

// --- Temps de réponse (Diagnostic) ---

/** Mise à jour automatique (Diagnostic) : la ligne, ce qui se passe, et la pause. */
function majAutoVue(v, relire) {
  const ligneEl = h("strong", { class: "maj-auto-ligne" }, phraseMajAuto(v));
  const detailEl = h("p", { class: "aide", style: { margin: "4px 0 0" } }, detailMajAuto(v));
  const blocs = [h("h3", { class: "titre-section reglages-sous-titre" }, "Mise à jour automatique"), ligneEl, detailEl];
  if (v.active && !v.coupeeParLaTour) {
    blocs.push(bascule("Installer seule les mises à jour", "Ce qui arrive sur main, une fois ses contrôles réussis, quand Rémy ne travaille pas. Coupé : en pause.", !v.pause, async (x) => {
      const r = await remplacer("/api/maj-auto", { pause: !x }, { delai: 10000 });
      ligneEl.textContent = phraseMajAuto(r);
      detailEl.textContent = detailMajAuto(r);
      dire(confirmationMajAuto(r.pause), { genre: "succes" });
    }, { ancre: "Installer seule les mises à jour" }));
  }
  blocs.push(h("div", { class: "rangee", style: { marginTop: "8px" } }, bouton("Rafraîchir", { classe: "papier", icone: "rafraichir", onclick: (e) => occupe(e.currentTarget, relire) })));
  return blocs;
}

function mesuresVue(t, erreur, rafraichir) {
  const ligneM = (titre, s) => h("li", { class: "reglages-mesure" }, h("div", null, titre), h("div", { class: `mono ${s?.n ? "aide" : "reglages-pale"}` }, ligneMesure(s)));
  const poste = mesuresPoste();
  const blocs = [];
  if (!sait("mesures-v1")) blocs.push(h("p", { class: "aide" }, "Les mesures de la tour arriveront avec sa mise à jour."));
  else if (erreur) blocs.push(h("p", { class: "erreur-champ" }, "Mesures de la tour illisibles."), h("p", { class: "aide" }, texteErreur(erreur)));
  else if (t) {
    blocs.push(h("strong", null, "Sur la tour"), h("ul", { class: "liste" }, MESURES_TOUR.map(([cle, titre]) => ligneM(titre, t.mesures?.[cle]))));
    const m = t.motion;
    if (m && m.etat !== "off") {
      blocs.push(h("strong", { style: { display: "block", marginTop: "12px" } }, "Motion"), h("dl", { class: "paires" },
        m.quota ? [h("dt", null, "Quota cette minute"), h("dd", null, `${m.quota.utilise} / ${m.quota.max} requêtes`)] : null,
        m.luA ? [h("dt", null, "Tâches lues"), h("dd", null, memeJour(m.luA, Date.now()) ? `à ${heure(m.luA)}` : quand(m.luA))] : null,
        h("dt", null, "État"), h("dd", null, etatMotion(m.etat))),
      m.raison ? h("p", { class: "aide" }, m.raison) : null);
    }
  }
  blocs.push(h("strong", { style: { display: "block", marginTop: "12px" } }, "Sur ce poste"), h("ul", { class: "liste" }, MESURES_POSTE.map(([cle, titre]) => ligneM(titre, poste[cle]))),
    h("p", { class: "aide" }, "Depuis l'ouverture de la page. Médiane : la moitié des fois plus rapide ; 95 % : presque toujours sous cette durée."));
  if (rafraichir) blocs.push(h("div", { class: "rangee", style: { marginTop: "8px" } }, bouton("Rafraîchir", { classe: "papier petit", icone: "rafraichir", onclick: (e) => occupe(e.currentTarget, rafraichir) })));
  return blocs;
}

/** « Ctrl+Alt+Space » depuis un appui de touches (format des raccourcis globaux). */
export function combinaison(e) {
  const mods = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  const code = e.code || "";
  let touche = null;
  if (/^Key[A-Z]$/.test(code)) touche = code.slice(3);
  else if (/^Digit\d$/.test(code)) touche = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) touche = code;
  else if (code === "Space") touche = "Space";
  else if (["Enter", "Backspace", "Insert", "Home", "End", "PageUp", "PageDown"].includes(code)) touche = code;
  if (!touche || !mods.some((m) => m !== "Shift")) return null;
  return [...mods, touche].join("+");
}
