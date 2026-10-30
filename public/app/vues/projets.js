// Projets et carnet, en maître-détail : projets Motion et leurs sous-projets,
// dossiers de Remy, Idées, listes (en tuiles), rappels, catégories,
// historique, ce que Rémy sait de toi. Comme l'onglet Projets de l'iPhone
// (ProjetsView, NoeudView, RappelsView, ListeView, HistoriqueView), adapté à
// la souris : le clic droit (Maj+F10 au clavier) fait l'appui long. Tout
// s'écrit avec des identifiants fixés ici : un geste rejoué n'est pas doublé.
import { api, ecrire, remplacer, supprimer, nouvelId, seg, sait } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, squelette, blocErreur, vide, confirmer, demanderTexte, duree, heure, occupe, feuille, local, texteErreur } from "../ui.js";
import { couleurProjet } from "../couleurs.js";
import { extraire } from "../analyse/dates.js";
import { articles as articlesDe } from "../analyse/genre.js";
import { resumeEtat, depuis, cheminEtat } from "../analyse/conversations.js";
import * as C from "../analyse/carnet.js";
import { surMenu, ouvrirMenu } from "../menu.js";
import { gerer, terminer } from "./gerer.js";
import { ligneRappel, ligneTriRappels, boutonFiltre, ouvrirFiltreRappels, lireFiltreLocal, nouveauRappel, retenirEtiquettes } from "./rappels.js";
import { ouvrirTri } from "./tri-rappels.js";

let racine;
let ctx;
let donnees = vides();
let selection = null; // { type, id }
let filtre = "";
let refs = {};
let tri = null; // la feuille du tri des rappels (#/projets/rappels/tri l'ouvre depuis une autre vue)
let hist = null; // l'historique affiché (filtre, pages)

function vides() {
  return { projets: null, erreurProjets: null, projetsLus: 0, dossiers: null, listes: null, rappels: null, etiquettes: null, dashboard: null, conversations: null };
}

export default {
  async monter(el, args, contexte) {
    racine = el;
    ctx = contexte;
    donnees = vides();
    hist = null;
    selection = lireSelection(args);
    refs.recherche = h("input", { class: "champ", type: "search", placeholder: "Chercher", "aria-label": "Chercher un projet, une liste…", oninput: (e) => { filtre = e.target.value; dessinerMaitre(); } });
    refs.maitre = h("nav", { class: "maitre", "aria-label": "Projets et carnet" }, squelette([0.7, 0.5, 0.8, 0.6]));
    refs.detail = h("section", { class: "detail" });
    refs.grille = h("div", { class: "maitre-detail" }, h("div", null, h("div", { class: "recherche-champ", style: { marginBottom: "12px" } }, icone("recherche"), refs.recherche, h("span", { class: "kbd" }, "/")), refs.maitre), refs.detail);
    vider(el,
      h("header", { class: "entete-ecran" },
        h("div", { class: "titres" }, h("div", { class: "sur-titre" }, "Où tu mets ton énergie"), h("h1", { class: "titre-ecran" }, "Projets")),
        h("div", { class: "actions-entete" },
          bouton("Nouvelle liste", { classe: "papier", icone: "liste", onclick: nouvelleListe }),
          bouton("Nouveau dossier", { classe: "papier", icone: "dossier", onclick: () => nouveauDossier(null) }),
          bouton("Noter", { classe: "plein", icone: "plus", kbd: "N", onclick: () => ctx.noter() }))),
      refs.grille);
    lireAnnexes();
    await charger();
  },
  suivre(args) {
    selection = lireSelection(args);
    if (selection?.type !== "historique") hist = null; // relu en y revenant
    dessinerMaitre();
    dessinerDetail();
  },
  chercher() {
    refs.recherche?.focus();
  },
  actualiser() {
    lireAnnexes();
    charger({ discret: true });
  },
  demonter() {
    // La vue s'en va : le tri se ferme sans toucher à l'adresse (déjà ailleurs), ni relire.
    const t = tri;
    tri = null;
    selection = null;
    racine = null;
    t?.fermer();
  },
};

function lireSelection(args) {
  if (!args?.length) return null;
  return { type: args[0], id: args[1] ? decodeURIComponent(args[1]) : null };
}
const aller = (type, id) => ctx.aller(`projets/${type}${id ? `/${encodeURIComponent(id)}` : ""}`);
const ouvert = (type, id) => selection?.type === type && (selection.id || null) === (id || null);

async function charger({ discret = false } = {}) {
  const sinon = (capacite, chemin) => (sait(capacite) ? api(chemin) : Promise.resolve(null));
  const [p, d, l, r, e] = await Promise.allSettled([sinon("projets-v1", "/api/projets"), sinon("dossiers-v1", "/api/dossiers"), api("/api/listes"), api("/api/rappels"), sinon("etiquettes-v1", "/api/etiquettes")]);
  const erreurs = [p, d, l, r].filter((x) => x.status === "rejected").map((x) => x.reason);
  if (p.status === "fulfilled") {
    if (p.value) {
      donnees.projets = p.value;
      donnees.projetsLus = Date.now();
    }
    donnees.erreurProjets = null;
  } else donnees.erreurProjets = p.reason;
  if (d.status === "fulfilled") donnees.dossiers = d.value?.dossiers || [];
  if (l.status === "fulfilled") donnees.listes = l.value.listes || [];
  if (r.status === "fulfilled") donnees.rappels = r.value.rappels || [];
  if (e.status === "fulfilled") {
    donnees.etiquettes = e.value?.etiquettes || [];
    retenirEtiquettes(donnees.etiquettes);
  }
  if (erreurs.length === 4) {
    vider(refs.maitre, blocErreur(erreurs[0], () => charger()));
    vider(refs.detail);
    return;
  }
  if (erreurs.length && !discret) direErreur(erreurs[0], () => charger(), "Une partie du carnet n'a pas pu être lue");
  dessinerMaitre();
  dessinerDetail();
}
const recharger = () => charger({ discret: true });

// Ce qui n'est lu qu'à l'affichage de Projets : la mémoire et la journée
// (le tableau), l'état des conversations d'ailleurs. Une erreur ici ne dit rien :
// les lignes gardent leur texte par défaut.
function lireAnnexes() {
  api("/api/dashboard", { delai: 20000 }).then((d) => {
    donnees.dashboard = d;
    dessinerMaitre();
  }).catch(() => {});
  if (sait("conversations-externes-v1")) api(cheminEtat(), { delai: 20000 }).then((c) => {
    donnees.conversations = c;
    dessinerMaitre();
  }).catch(() => {});
}
const journee = () => {
  const j = donnees.dashboard?.journee;
  return [...(j?.items || []), ...(j?.aFaire || []), ...(j?.retard?.items || [])];
};

// --- Le maître ---
function element(type, id, texte, n, { sous = false, icone: ic, couleur, meta, fin, menu, href, courant } = {}) {
  const actif = courant ?? (!href && ouvert(type, id));
  const a = h("a", { class: `element-maitre${sous ? " sous" : ""}${meta ? " projets-deux-lignes" : ""}`, href: href || `#/projets/${type}${id ? `/${encodeURIComponent(id)}` : ""}`, "aria-current": actif ? "page" : null },
    couleur ? h("span", { class: "puce", style: { padding: 0, minHeight: 0, background: "none" } }, h("span", { class: "point", style: { background: couleur } })) : ic ? icone(ic) : null,
    meta ? h("span", { class: "projets-textes" }, h("span", { class: "t" }, texte), meta) : h("span", { class: "t" }, texte),
    fin || null, n != null ? h("span", { class: "n" }, String(n)) : null);
  if (menu) surMenu(a, menu, { titre: texte });
  return a;
}
const petit = (...contenu) => h("small", null, ...contenu);

function groupeMotion(ok) {
  const p = donnees.projets;
  const projets = p?.projets || [];
  const err = donnees.erreurProjets;
  const reessayer = () => bouton("Réessayer", { classe: "papier petit", icone: "rafraichir", onclick: (e) => {
    const b = e.currentTarget;
    b.querySelector(".lib").textContent = "…";
    occupe(b, () => charger({ discret: true }));
  } });
  let etat = null;
  if (!sait("projets-v1") && !p) etat = h("p", { class: "aide" }, "Ta tour n'a pas encore la mise à jour qui lit tes projets Motion.");
  else if (err && err.nature !== "auth") etat = h("div", { class: "projets-etat" }, h("p", { class: "aide" }, p ? `${texteErreur(err)} Voici les derniers lus.` : texteErreur(err)), reessayer());
  else if (p?.motion === false) etat = h("p", { class: "aide" }, "Motion n'est pas branché sur ta tour : tes projets s'afficheront ici dès qu'il le sera.");
  else if (!p) etat = squelette([0.7, 0.5]);
  else if (!projets.length) etat = h("p", { class: "aide" }, "Aucun projet ouvert dans Motion.");
  const dossiers = donnees.dossiers || [];
  return h("div", { class: "groupe" }, h("h2", { class: "titre-section" }, "Projets Motion", projets.length ? h("span", { class: "compte" }, String(projets.length)) : null),
    etat,
    p?.motion !== false ? projets.flatMap((x) => [ok(x.nom) ? element("motion", x.id, x.nom, null, {
      couleur: couleurProjet(x.nom),
      meta: [petit(C.detailProjet(x)), x.enRetard > 0 ? h("span", { class: "risque" }, icone("alerte"), C.phraseRetard(x.enRetard)) : null],
      fin: x.statut ? h("span", { class: "pastille discrete projets-statut" }, x.statut) : null,
      menu: () => actionsProjet(x),
    }) : null, ...arbre(`motion:${x.id}`, 1, ok, dossiers)]) : null,
    p?.sansProjet > 0 ? h("p", { class: "aide projets-note" }, C.phraseSansProjet(p.sansProjet)) : null,
    p && donnees.projetsLus ? h("p", { class: "aide projets-note" }, `Liste datant ${depuis(donnees.projetsLus)}.`) : null);
}

function arbre(parent, niveau, ok, dossiers) {
  return C.enfants(dossiers, parent).filter((d) => d.id !== "idees").flatMap((d) => [
    ok(d.nom) ? element("dossier", d.id, d.nom, null, { sous: niveau > 0, icone: C.iconeDossier(d), meta: C.metaDossier(d, dossiers) ? petit(C.metaDossier(d, dossiers)) : null, menu: () => actionsDossier(d) }) : null,
    ...arbre(d.id, niveau + 1, ok, dossiers)]);
}

function dessinerMaitre() {
  if (!refs.maitre) return;
  const f = filtre.trim().toLowerCase();
  const ok = (t) => !f || String(t).toLowerCase().includes(f);
  const dossiers = donnees.dossiers || [];
  const groupes = [groupeMotion(ok)];
  if (sait("dossiers-v1") || donnees.dossiers) {
    const idees = dossiers.find((d) => d.id === "idees");
    const racines = arbre(null, 0, ok, dossiers).filter(Boolean);
    groupes.push(h("div", { class: "groupe" }, h("h2", { class: "titre-section" }, "Dossiers"),
      ok("Idées") ? element("dossier", "idees", idees?.nom || "Idées", idees?.notes?.filter((n) => !n.fait).length || null, { icone: "ampoule" }) : null,
      racines,
      donnees.dossiers && !C.enfants(dossiers, null).some((d) => d.id !== "idees") && !f
        ? h("p", { class: "aide projets-note" }, "Catégories, idées, sous-projets sans Motion : « Nouveau dossier » ici, ou « Projet » dans Noter.") : null));
  }
  const listes = donnees.listes || [];
  groupes.push(h("div", { class: "groupe" }, h("h2", { class: "titre-section" }, "Listes"),
    ok("Listes") || ok("Toutes les listes") ? element("listes", null, "Toutes les listes", listes.length || null, { icone: "grille", menu: () => menuListes(null) }) : null,
    listes.filter((l) => ok(l.nom)).map((l) => element("liste", l.id, l.nom, l.elements?.filter((e) => !e.fait).length || null, { icone: C.iconeListe(l.nom), menu: () => menuListes(l) })),
    donnees.listes && !listes.length ? h("p", { class: "aide" }, "Pas encore de liste.") : null));
  const rappelsActifs = (donnees.rappels || []).filter((r) => !r.fait).length;
  const memoire = donnees.dashboard?.memoire;
  groupes.push(h("div", { class: "groupe" }, h("h2", { class: "titre-section" }, "Carnet"),
    ok("Rappels") ? element("rappels", null, "Rappels", rappelsActifs || null, { icone: "cloche", courant: selection?.type === "rappels" }) : null,
    ok("Catégories") ? element("categories", null, "Catégories", donnees.etiquettes?.length || null, { icone: "curseurs" }) : null,
    ok("Historique") ? element("historique", null, "Historique", null, { icone: "horloge" }) : null,
    // Comme sur l'iPhone (Projets › Conversations) ; sur le téléphone, les
    // onglets du bas n'ont pas la place d'une sixième entrée.
    sait("conversations-externes-v1") && ok("Conversations") ? element("conversations", null, "Conversations", null, {
      href: "#/conversations", icone: "conversations", meta: petit(resumeEtat(donnees.conversations) || "Claude, T3, ChatGPT") }) : null,
    ok("Ce que Rémy sait de toi") || ok("Mémoire") ? element("memoire", null, "Ce que Rémy sait de toi", null, {
      href: "#/reglages/memoire", icone: "personne", meta: petit(C.resumeMemoire(memoire)) }) : null));
  vider(refs.maitre, groupes);
  refs.grille.classList.toggle("detail-ouvert", Boolean(selection));
}

// --- Le détail ---
function retourMobile() {
  return h("a", { class: "btn texte petit lien-retour-projets", href: "#/projets" }, icone("retour"), "Projets");
}

function dessinerDetail() {
  if (!refs.detail) return;
  if (!selection) {
    vider(refs.detail, h("section", { class: "carte" }, vide("Choisis à gauche", "Un projet, un dossier, une liste ou tes rappels. N pour noter quelque chose n'importe où. Clic droit sur une ligne : ses gestes.")));
    return;
  }
  const { type, id } = selection;
  try {
    if (type === "motion") return detailMotion(id);
    if (type === "dossier") return detailDossier(id);
    if (type === "listes") return detailListes();
    if (type === "liste") return detailListe(id);
    if (type === "rappels") return detailRappels(id);
    if (type === "categories") return detailCategories();
    if (type === "historique") return detailHistorique();
  } catch (err) {
    console.error(err);
    vider(refs.detail, h("section", { class: "carte" }, blocErreur(err, recharger)));
    return;
  }
  vider(refs.detail, h("section", { class: "carte" }, vide("Introuvable", "Cet élément n'existe plus.")));
}

function carteDetail(surTitre, titre, actions, ...contenu) {
  return h("section", { class: "carte" }, retourMobile(),
    h("div", { class: "entete-ecran", style: { marginBottom: "12px" } },
      h("div", { class: "titres" }, surTitre ? h("div", { class: "sur-titre" }, surTitre) : null, h("h2", { class: "titre-ecran", style: { fontSize: "28px" } }, titre)),
      actions ? h("div", { class: "actions-entete" }, actions) : null),
    ...contenu);
}
const titreSection = (texte, compte, { danger = false } = {}) =>
  h("h3", { class: `titre-section projets-section${danger ? " danger" : ""}` }, texte, compte ? h("span", { class: "compte" }, String(compte)) : null);

// --- Projets Motion ---

/** « En parler à Rémy » : la question préparée dans une nouvelle conversation, jamais envoyée seule. */
function enParler(p) {
  local.ecrire("remy-question", { texte: C.questionProjet(p.nom), a: Date.now() });
  ctx.aller("remy/nouvelle");
}
const actionsProjet = (p) => [
  { libelle: "En parler à Rémy", icone: "remy", faire: () => enParler(p) },
  sait("dossiers-v1") ? { libelle: "Nouveau sous-projet", icone: "plus", faire: () => nouveauDossier(`motion:${p.id}`) } : null,
];

function ligneDossier(d) {
  const meta = C.metaDossier(d, donnees.dossiers || []);
  const li = h("li", { class: "ligne cliquable", tabindex: "0", role: "link", onclick: () => aller("dossier", d.id), onkeydown: (e) => { if (e.key === "Enter") aller("dossier", d.id); } },
    h("span", { class: "projets-icone" }, icone(C.iconeDossier(d))),
    h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, d.nom), meta ? h("div", { class: "meta" }, meta) : null), icone("chevron"));
  surMenu(li, () => actionsDossier(d), { titre: d.nom });
  return li;
}

function detailMotion(id) {
  if (!donnees.projets) {
    if (donnees.erreurProjets) return vider(refs.detail, h("section", { class: "carte" }, blocErreur(donnees.erreurProjets, () => charger())));
    return vider(refs.detail, h("section", { class: "carte" }, squelette()));
  }
  const p = donnees.projets?.projets?.find((x) => x.id === id);
  if (!p) return vider(refs.detail, h("section", { class: "carte" }, vide("Projet introuvable", "Il a peut-être été archivé dans Motion.")));
  const dossiers = donnees.dossiers || [];
  const sous = C.enfants(dossiers, `motion:${p.id}`);
  const taches = C.tachesHorsSousProjets(p, dossiers);
  const avecDossiers = sait("dossiers-v1");
  vider(refs.detail, carteDetail("Projet Motion", p.nom, [
    bouton("En parler à Rémy", { classe: "papier petit", icone: "remy", titre: "Prépare la question dans une nouvelle conversation, sans l'envoyer", onclick: () => enParler(p) }),
    avecDossiers ? bouton("Sous-projet", { classe: "papier petit", icone: "plus", onclick: () => nouveauDossier(`motion:${p.id}`) }) : null],
  h("div", { class: "projets-tete-projet" },
    h("p", { class: "aide" }, C.detailProjet(p)),
    p.enRetard > 0 ? h("span", { class: "risque" }, icone("alerte"), C.phraseRetard(p.enRetard)) : null,
    p.statut ? h("span", { class: "pastille discrete" }, p.statut) : null),
  avecDossiers ? [
    titreSection("Sous-projets", sous.length),
    sous.length ? h("ul", { class: "liste" }, sous.map(ligneDossier)) : null,
    h("button", { type: "button", class: "btn texte projets-ajout", onclick: () => nouveauDossier(`motion:${p.id}`) }, icone("plus"), h("span", { class: "lib" }, "Nouveau sous-projet")),
    h("p", { class: "aide" }, "Les sous-projets vivent dans Remy : l'API Motion n'a pas de hiérarchie."),
  ] : null,
  titreSection("Tâches Motion", taches.length),
  taches.length ? h("ul", { class: "liste" }, taches.map((t) => ligneTacheMotion(t, p.nom, { noeud: `motion:${p.id}`, dans: null })))
    : vide(null, "Aucune tâche ouverte hors sous-projets.")));
}

/** Gérer une tâche : celle de la journée si elle y est, sinon telle que le projet la décrit. */
function elementTache(t, projet) {
  const duJour = journee().find((x) => x.id === t.id && x.type !== "rdv" && x.debut != null && x.type !== "sans-creneau");
  if (duJour) return duJour;
  return { type: "sans-creneau", id: t.id, titre: t.titre, echeance: t.echeance, duree: t.duree, priorite: t.priorite, projet, debut: null };
}

/** Ranger une tâche dans un sous-projet, ou l'en sortir : tout de suite à l'écran, rétabli si la tour refuse. */
async function ranger(t, dossierId, { silencieux = false } = {}) {
  const avant = (donnees.dossiers || []).map((d) => ({ ...d, taches: [...(d.taches || [])] }));
  const precedent = avant.find((d) => d.taches.includes(t.id))?.id || null;
  donnees.dossiers = avant.map((d) => ({ ...d, taches: d.id === dossierId ? [...d.taches.filter((x) => x !== t.id), t.id] : d.taches.filter((x) => x !== t.id) }));
  dessinerMaitre();
  dessinerDetail();
  try {
    await remplacer(`/api/rattachements/${seg(t.id)}`, { dossier: dossierId });
    if (silencieux) return;
    const nom = (donnees.dossiers || []).find((d) => d.id === dossierId)?.nom;
    dire(dossierId ? `« ${t.titre} » rangée dans « ${nom} ».` : `« ${t.titre} » sortie du sous-projet.`, { genre: "succes",
      action: { libelle: "Annuler", faire: () => ranger(t, precedent, { silencieux: true }) } });
  } catch (err) {
    donnees.dossiers = avant;
    dessinerMaitre();
    dessinerDetail();
    if (err.nature !== "auth") dire(`La tâche n'a pas été rangée : ${texteErreur(err).replace(/\.$/, "")}.`, { genre: "erreur" });
  }
}

/** Le chemin d'un sous-dossier depuis la racine (« Site vitrine › Pages »), pour le menu. */
function chemin(d) {
  const noms = [d.nom];
  const tous = donnees.dossiers || [];
  for (let p = tous.find((x) => x.id === d.parent), n = 0; p && n < 30; p = tous.find((x) => x.id === p.parent), n++) noms.unshift(p.nom);
  return noms.join(" › ");
}

function actionsTache(t, { noeud, dans, ancre, projet }) {
  const ou = C.rangements(donnees.dossiers || [], noeud).filter((d) => d.id !== dans);
  return [
    { libelle: "Gérer…", icone: "curseurs", faire: () => gerer(elementTache(t, projet), { apres: () => setTimeout(recharger, 600), contexte: ctx }) },
    ou.length ? { libelle: "Ranger dans…", icone: "dossier", faire: () => ouvrirMenu(ancre(), ou.map((d) => ({ libelle: chemin(d), icone: C.iconeDossier(d), faire: () => ranger(t, d.id) })), { titre: "Ranger dans…" }) } : null,
    dans ? { libelle: "Sortir du sous-projet", icone: "retour", faire: () => ranger(t, null) } : null,
  ];
}

function ligneTacheMotion(t, projet, { noeud, dans }) {
  const e = elementTache(t, projet);
  const li = h("li", { class: "ligne ligne-tache projets-tache", style: { "--couleur": couleurProjet(projet) } });
  const caseB = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": "false", "aria-label": `Terminer « ${t.titre} »` });
  caseB.addEventListener("click", () => terminer(e, { retirer: () => { li.hidden = true; }, remettre: () => { li.hidden = false; }, apres: () => setTimeout(recharger, 600) }));
  const actions = () => actionsTache(t, { noeud, dans, projet, ancre: () => li });
  const plus = bouton("", { classe: "texte icone projets-plus", icone: "points", etiquette: `Gestes de « ${t.titre} »`, titre: "Ranger, gérer (clic droit aussi)" });
  plus.addEventListener("click", () => ouvrirMenu(plus, actions(), { titre: t.titre }));
  ajouterA(li, caseB,
    h("div", { class: "corps cliquable", role: "button", tabindex: "0", onclick: () => gerer(e, { apres: () => setTimeout(recharger, 600), contexte: ctx }), onkeydown: (ev) => { if (ev.key === "Enter") gerer(e, { apres: recharger, contexte: ctx }); } },
      h("div", { class: "titre-ligne" }, t.titre),
      h("div", { class: "meta" }, t.echeance ? h("span", { class: t.echeance < Date.now() ? "risque" : "" }, `échéance ${C.quandRappel(t.echeance)}`) : null, t.duree ? h("span", null, duree(t.duree)) : null)),
    plus);
  surMenu(li, actions, { titre: t.titre });
  return li;
}

// Une tâche rangée dans un dossier : son titre retrouvé, « avant le … · durée » ;
// un clic la gère si on la connaît (la journée, ou la liste de son projet).
function ligneTacheRangee(t, d) {
  const projet = t.projet || null;
  const connue = !t.inconnue;
  const li = h("li", { class: "ligne projets-tache" });
  const actions = () => actionsTache(t, { noeud: d.id, dans: d.id, projet, ancre: () => li });
  const plus = bouton("", { classe: "texte icone projets-plus", icone: "points", etiquette: `Gestes de « ${t.titre} »`, titre: "Ranger, sortir (clic droit aussi)" });
  plus.addEventListener("click", () => ouvrirMenu(plus, connue ? actions() : actions().filter((a) => a && a.libelle !== "Gérer…"), { titre: t.titre }));
  const meta = C.metaTache(t, duree);
  const ouvrir = () => gerer(elementTache(t, projet), { apres: () => setTimeout(recharger, 600), contexte: ctx });
  ajouterA(li, h("span", { class: "projets-icone" }, icone("liste")),
    h("div", connue ? { class: "corps cliquable", role: "button", tabindex: "0", onclick: ouvrir, onkeydown: (ev) => { if (ev.key === "Enter") ouvrir(); } } : { class: "corps" },
      h("div", { class: "titre-ligne" }, t.titre), meta ? h("div", { class: "meta" }, meta) : null),
    plus);
  surMenu(li, () => (connue ? actions() : actions().filter((a) => a && a.libelle !== "Gérer…")), { titre: t.titre });
  return li;
}

// --- Dossiers ---

const actionsDossier = (d) => d.id === "idees" ? [] : [
  { libelle: "Nouveau sous-projet", icone: "plus", faire: () => nouveauDossier(d.id) },
  { libelle: "Renommer", icone: "crayon", faire: () => renommerDossier(d) },
  C.peutAllerDansMotion(d) && sait("projets-v1") ? { libelle: "Aussi dans Motion…", icone: "pile", faire: () => aussiDansMotion(d) } : null,
  { libelle: "Supprimer", icone: "corbeille", danger: true, faire: () => supprimerDossier(d) },
];

function detailDossier(id) {
  if (!donnees.dossiers) return vider(refs.detail, h("section", { class: "carte" }, squelette()));
  let d = donnees.dossiers.find((x) => x.id === id);
  if (!d && id === "idees") d = { id: "idees", nom: "Idées", parent: null, notes: [], taches: [], absent: true };
  if (!d) return vider(refs.detail, h("section", { class: "carte" }, vide("Dossier introuvable", "Il a peut-être été supprimé.")));
  const sous = C.enfants(donnees.dossiers, d.id);
  const champ = h("input", { class: "champ", type: "text", placeholder: d.id === "idees" ? "Une idée à garder…" : "Une idée, une note…", "aria-label": "Nouvelle note" });
  const ajouter = async () => {
    const texte = champ.value.trim();
    if (!texte) return champ.focus();
    try {
      if (d.absent) await remplacer("/api/dossiers/idees", { nom: "Idées", parent: null, ordre: -2 });
      await ecrire(`/api/dossiers/${seg(d.id)}/notes`, { notes: [{ id: nouvelId(), texte: texte.slice(0, 500), fait: false }] });
      champ.value = "";
      await recharger();
      refs.detail.querySelector("input.champ")?.focus();
    } catch (err) {
      direErreur(err, null, "La note n'a pas été ajoutée");
    }
  };
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ajouter(); } });
  const parentNom = d.parent?.startsWith("motion:") ? donnees.projets?.projets?.find((p) => `motion:${p.id}` === d.parent)?.nom : donnees.dossiers.find((x) => x.id === d.parent)?.nom;
  const notes = [...(d.notes || [])].sort((a, b) => Number(a.fait) - Number(b.fait));
  const taches = C.tachesRangees(d, donnees.projets?.projets || [], journee());
  const motionBtn = C.peutAllerDansMotion(d) && sait("projets-v1")
    ? bouton("Aussi dans Motion…", { classe: "papier petit", icone: "pile", titre: "Faire de ce dossier un projet Motion", onclick: (e) => aussiDansMotion(d, e.currentTarget) }) : null;
  vider(refs.detail, carteDetail(d.id === "idees" ? "Rien n'est planifié" : parentNom ? `Dans « ${parentNom} »` : d.projetMotion ? "Dossier, aussi dans Motion" : "Dossier", d.nom,
    d.id === "idees" ? null : [
      motionBtn,
      bouton("", { classe: "texte icone", icone: "plus", etiquette: "Nouveau sous-projet", titre: "Nouveau sous-projet", onclick: () => nouveauDossier(d.id) }),
      bouton("", { classe: "texte icone", icone: "crayon", etiquette: "Renommer", titre: "Renommer", onclick: () => renommerDossier(d) }),
      bouton("", { classe: "texte icone", icone: "corbeille", etiquette: "Supprimer le dossier", titre: "Supprimer le dossier", onclick: () => supprimerDossier(d) })],
    d.id === "idees" ? null : [
      sous.length ? [titreSection("Sous-projets", sous.length), h("ul", { class: "liste" }, sous.map(ligneDossier))] : null,
      titreSection("Tâches rangées ici", taches.length),
      taches.length ? h("ul", { class: "liste" }, taches.map((t) => ligneTacheRangee(t, d))) : vide(null, "Range ici des tâches depuis le projet (clic droit sur une tâche)."),
      titreSection("Idées et notes", notes.filter((n) => !n.fait).length),
    ],
    h("div", { class: "ajout-ligne" }, champ, bouton("Ajouter", { classe: "plein", onclick: (e) => occupe(e.currentTarget, ajouter) })),
    notes.length ? h("ul", { class: "liste", style: { marginTop: "12px" } }, notes.map((n) => ligneNote(d, n))) : vide(null, d.id === "idees" ? "Pas encore d'idée. Une pensée floue notée avec N arrive ici." : "Pas encore de note.")));
}

function ligneNote(d, n) {
  const caseB = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": String(Boolean(n.fait)), "aria-label": n.fait ? `« ${n.texte} » : relue` : `Marquer « ${n.texte} » comme relue` });
  caseB.addEventListener("click", async () => {
    const fait = !n.fait;
    caseB.setAttribute("aria-checked", String(fait));
    try {
      await ecrire(`/api/dossiers/${seg(d.id)}/notes`, { notes: [{ id: n.id, texte: n.texte, fait }] });
      n.fait = fait;
      dessinerDetail();
      dessinerMaitre();
    } catch (err) {
      caseB.setAttribute("aria-checked", String(n.fait));
      direErreur(err, null, "La note n'a pas été cochée");
    }
  });
  return h("li", { class: `ligne${n.fait ? " faite" : ""}` }, caseB, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, n.texte)),
    bouton("", { classe: "texte icone", icone: "corbeille", etiquette: `Supprimer « ${n.texte} »`, onclick: async (e) => {
      await occupe(e.currentTarget, async () => {
        try {
          await supprimer(`/api/dossiers/${seg(d.id)}/notes/${seg(n.id)}`);
          d.notes = d.notes.filter((x) => x.id !== n.id);
          dessinerDetail();
          dessinerMaitre();
          dire("Supprimée.", { action: { libelle: "Annuler", faire: async () => { await ecrire(`/api/dossiers/${seg(d.id)}/notes`, { notes: [n] }).catch(direErreur); recharger(); } } });
        } catch (err) {
          direErreur(err, null, "La note n'a pas été retirée");
        }
      });
    } }));
}

const phraseEchec = (debut, err) => `${debut} : ${texteErreur(err).replace(/\.$/, "")}.`;

async function nouveauDossier(parent) {
  const nom = (await demanderTexte(parent ? "Nouveau sous-projet" : "Nouveau dossier", { etiquette: "Nom", libelle: "Créer", placeholder: parent ? "Nom" : "Catégorie, projet perso…" }))?.trim().slice(0, 120);
  if (!nom) return;
  const id = nouvelId();
  const freres = C.enfants(donnees.dossiers || [], parent);
  const ordre = Math.max(-1, ...freres.map((d) => d.ordre ?? -1)) + 1;
  try {
    await remplacer(`/api/dossiers/${seg(id)}`, { nom, parent, ordre });
    dire(`« ${nom} » créé.`, { genre: "succes" });
    await recharger();
    aller("dossier", id);
  } catch (err) {
    if (err.nature !== "auth") dire(phraseEchec(`« ${nom} » n'a pas été créé`, err), { genre: "erreur" });
  }
}
async function renommerDossier(d) {
  const nom = (await demanderTexte("Renommer", { valeur: d.nom, libelle: "Renommer", etiquette: "Nom" }))?.trim().slice(0, 120);
  if (!nom || nom === d.nom) return;
  try {
    await remplacer(`/api/dossiers/${seg(d.id)}`, { nom, parent: d.parent, ordre: d.ordre ?? 0 });
    await recharger();
    dire("Renommé.", { genre: "succes" });
  } catch (err) {
    if (err.nature !== "auth") dire(phraseEchec("Le dossier n'a pas été renommé", err), { genre: "erreur" });
  }
}

/** Supprime le dossier et son contenu ; « Annuler » remet tout : sous-dossiers, notes, tâches rangées. */
async function supprimerDossier(d) {
  if (!(await confirmer(`Supprimer « ${d.nom} » ?`, { detail: "Les sous-projets et les idées partent avec ; les tâches Motion restent dans Motion. « Annuler » juste après.", libelle: "Supprimer le dossier et son contenu", danger: true }))) return;
  // La copie se fait sur une lecture fraîche : un sous-dossier ou une tâche
  // rangée depuis l'iPhone revient aussi avec « Annuler ».
  const frais = await api("/api/dossiers").then((r) => r?.dossiers).catch(() => null);
  const copie = C.aRestaurer(frais || donnees.dossiers || [], d.id);
  try {
    await supprimer(`/api/dossiers/${seg(d.id)}`);
  } catch (err) {
    if (err.nature !== "auth") dire(phraseEchec(`« ${d.nom} » n'a pas été supprimé`, err), { genre: "erreur" });
    return;
  }
  dire(`« ${d.nom} » supprimé.`, { genre: "succes", duree: 9000, action: { libelle: "Annuler", faire: () => restaurer(copie) } });
  if (selection?.type === "dossier" && copie.some((x) => x.id === selection.id)) {
    if (d.parent?.startsWith("motion:")) aller("motion", d.parent.slice(7));
    else if (d.parent) aller("dossier", d.parent);
    else ctx.aller("projets");
  }
  recharger();
}
async function restaurer(copie) {
  const echecs = [];
  const remis = [];
  for (const d of copie) {
    try {
      await remplacer(`/api/dossiers/${seg(d.id)}`, { nom: d.nom, parent: d.parent ?? null, ordre: d.ordre ?? 0 });
    } catch (err) {
      echecs.push(err);
      continue;
    }
    remis.push(d);
    for (const t of d.taches) await remplacer(`/api/rattachements/${seg(t)}`, { dossier: d.id }).catch((err) => echecs.push(err));
  }
  // Les idées reviennent avec leur dossier (la tour les garde) : seules celles
  // qui manquent à la relecture repartent, par envois de 100.
  if (remis.some((d) => d.notes.length)) {
    try {
      const lus = (await api("/api/dossiers"))?.dossiers || [];
      for (const e of C.notesARemettre(remis, lus)) await ecrire(`/api/dossiers/${seg(e.dossier)}/notes`, { notes: e.notes }).catch((err) => echecs.push(err));
    } catch (err) {
      echecs.push(err);
    }
  }
  await recharger();
  if (echecs.length) direErreur(echecs[0], () => restaurer(copie), "Pas tout remis");
  else dire("Remis comme avant.", { genre: "succes" });
}

/** Un dossier racine devient aussi un projet Motion (grand projet durable). */
async function aussiDansMotion(d, btn = null) {
  if (!(await confirmer(`Créer « ${d.nom} » dans Motion ?`, { detail: "Pour un grand projet durable. Motion ne permet pas de le supprimer ou de le renommer depuis Rémy : ce sera à faire dans Motion.", libelle: "Créer le projet Motion" }))) return;
  const attente = btn ? null : dire(`Motion crée « ${d.nom} »…`, { duree: 0 });
  await occupe(btn, async () => {
    try {
      await remplacer(`/api/dossiers/${seg(d.id)}`, { nom: d.nom, parent: null, ordre: d.ordre ?? 0, motion: true }, { delai: 45000 });
      attente?.();
      dire(`« ${d.nom} » est aussi un projet Motion.`, { genre: "succes" });
      await recharger();
    } catch (err) {
      attente?.();
      if (err.nature !== "auth") dire(C.phraseRefusMotion(texteErreur(err)), { genre: "erreur" });
    }
  });
}

// --- Listes ---

const disposition = () => local.lire(C.CLE_DISPOSITION, 0);
function choisirDisposition(ancre) {
  const actuelle = Number(disposition()) || 0;
  ouvrirMenu(ancre, C.DISPOSITIONS.map(([v, lib]) => ({ libelle: lib, icone: v === actuelle ? "coche" : null, faire: () => {
    local.ecrire(C.CLE_DISPOSITION, v);
    if (selection?.type === "listes") dessinerDetail();
    dire(`Disposition : ${lib.toLowerCase()}.`);
  } })), { titre: "Disposition" });
}
/** L'appui long d'une tuile : créer, disposer, et pour une liste, la renommer ou la supprimer. */
const menuListes = (l, ancre) => [
  { libelle: "Nouvelle liste", icone: "plus", faire: nouvelleListe },
  { libelle: "Disposition…", icone: "grille", faire: () => choisirDisposition(ancre?.() || refs.detail.querySelector(".projets-tuiles, .projets-tuile-vide") || refs.detail) },
  l ? { libelle: "Renommer", icone: "crayon", faire: () => renommerListe(l) } : null,
  l ? { libelle: "Supprimer", icone: "corbeille", danger: true, faire: () => supprimerListe(l) } : null,
];

function detailListes() {
  if (!donnees.listes) return vider(refs.detail, h("section", { class: "carte" }, squelette()));
  const listes = donnees.listes;
  const plus = bouton("", { classe: "texte icone", icone: "plus", etiquette: "Nouvelle liste, disposition", titre: "Nouvelle liste, disposition" });
  plus.addEventListener("click", () => ouvrirMenu(plus, menuListes(null, () => plus), { titre: "Listes" }));
  const colonnes = C.colonnesListes(disposition(), listes.length);
  const tuiles = listes.length
    ? h("div", { class: "projets-tuiles" }, listes.map((l) => {
        const couleur = couleurProjet(l.nom);
        const a = h("a", { class: `projets-tuile${colonnes === 1 ? " large" : ""}`, href: `#/projets/liste/${encodeURIComponent(l.id)}`, "aria-label": `${l.nom}, ${C.resteListe(l)}` },
          h("span", { class: "projets-tuile-icone", style: { color: couleur, background: `color-mix(in srgb, ${couleur} 14%, transparent)` } }, icone(C.iconeListe(l.nom))),
          h("span", { class: "projets-tuile-textes" }, h("strong", null, l.nom), h("span", null, C.resteListe(l))),
          colonnes === 1 ? icone("chevron") : null);
        surMenu(a, () => menuListes(l, () => a), { titre: l.nom });
        return a;
      }))
    : (() => {
        const v = h("div", { class: "projets-tuile-vide", tabindex: "0" }, "« + » (ou clic droit ici) pour créer ta première liste : courses, anniversaires…");
        surMenu(v, () => menuListes(null, () => v), { titre: "Listes" });
        return v;
      })();
  tuiles.style.setProperty("--colonnes", String(colonnes)); // une propriété personnalisée ne passe pas par Object.assign
  vider(refs.detail, carteDetail("Carnet", "Listes", [plus], tuiles));
}

function detailListe(id) {
  if (!donnees.listes) return vider(refs.detail, h("section", { class: "carte" }, squelette()));
  const l = donnees.listes.find((x) => x.id === id);
  if (!l) return vider(refs.detail, h("section", { class: "carte" }, vide("Liste introuvable", "Elle a peut-être été supprimée.")));
  const champ = h("input", { class: "champ", type: "text", placeholder: "Ajouter un article…", "aria-label": "Ajouter des articles (tomates, lait)" });
  const ajouter = async () => {
    const brut = champ.value.trim();
    if (!brut) return champ.focus();
    const textes = articlesDe(brut);
    const base = Math.max(-1, ...(l.elements || []).map((e) => e.ordre ?? -1)) + 1;
    const nouveaux = (textes.length ? textes : [brut]).map((t, i) => ({ id: nouvelId(), texte: t.slice(0, 300), fait: false, ordre: base + i }));
    try {
      const r = await ecrire(`/api/listes/${seg(l.id)}/elements`, { elements: nouveaux });
      champ.value = "";
      const deja = r?.dejaLa || [];
      const ecartes = new Set(deja.map((x) => x.id));
      const crees = nouveaux.filter((x) => !ecartes.has(x.id));
      await recharger();
      refs.detail.querySelector(".projets-ajout-article input")?.focus();
      // Déjà à prendre : dit, pas recréé ; « Annuler » ne retire que les nouveaux.
      if (deja.length) dire(C.phraseDejaListe(deja.map((x) => x.texte)), { action: crees.length ? { libelle: "Annuler", faire: () => retirerArticles(l, crees) } : null });
    } catch (err) {
      direErreur(err, null, "Pas ajouté");
    }
  };
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ajouter(); } });
  const tri = (a, b) => (a.ordre ?? 0) - (b.ordre ?? 0);
  const aPrendre = (l.elements || []).filter((e) => !e.fait).sort(tri);
  const pris = (l.elements || []).filter((e) => e.fait).sort(tri);
  vider(refs.detail, carteDetail("Liste", l.nom, [
    pris.length ? bouton(`Retirer les pris (${pris.length})`, { classe: "papier petit", onclick: (e) => occupe(e.currentTarget, () => retirerPris(l, pris)) }) : null,
    bouton("", { classe: "texte icone", icone: "crayon", etiquette: "Renommer la liste", titre: "Renommer", onclick: () => renommerListe(l) }),
    bouton("", { classe: "texte icone", icone: "corbeille", etiquette: "Supprimer la liste", titre: "Supprimer", onclick: () => supprimerListe(l) })],
    !(l.elements || []).length ? h("p", { class: "vide" }, "Rien dans cette liste. Écris en bas : « tomates, lait » en ajoute deux.") : null,
    aPrendre.length ? h("ul", { class: "liste" }, aPrendre.map((e) => ligneArticle(l, e))) : null,
    pris.length ? [titreSection("Pris", pris.length), h("ul", { class: "liste" }, pris.map((e) => ligneArticle(l, e)))] : null,
    h("div", { class: "ajout-ligne projets-ajout-article" }, icone("plus"), champ, bouton("Ajouter", { classe: "plein", onclick: (e) => occupe(e.currentTarget, ajouter) }))));
}

async function retirerArticles(l, articles) {
  try {
    for (const a of articles) await supprimer(`/api/listes/${seg(l.id)}/elements/${seg(a.id)}`);
  } catch (err) {
    direErreur(err, null, "Pas tout retiré");
  }
  recharger();
}
async function remettreArticles(l, articles, message) {
  try {
    for (const lot of C.lots(articles, 100)) await ecrire(`/api/listes/${seg(l.id)}/elements`, { elements: lot.map((e) => ({ id: e.id, texte: e.texte, fait: Boolean(e.fait), ordre: e.ordre ?? 0 })) });
    if (message) dire(message, { genre: "succes" });
  } catch (err) {
    direErreur(err, () => remettreArticles(l, articles, message), "Pas remis");
  }
  recharger();
}
async function retirerPris(l, pris) {
  try {
    await ecrire(`/api/listes/${seg(l.id)}/retirer`, { ids: pris.map((x) => x.id) });
    dire(C.phraseCochesRetires(pris.length), { genre: "succes", action: { libelle: "Annuler", faire: () => remettreArticles(l, pris) } });
    recharger();
  } catch (err) {
    direErreur(err, null, "Pas retirés");
  }
}

function ligneArticle(l, e) {
  const caseB = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": String(Boolean(e.fait)), "aria-label": e.fait ? `« ${e.texte} » : pris` : `Prendre « ${e.texte} »` });
  caseB.addEventListener("click", async () => {
    const fait = !e.fait;
    caseB.setAttribute("aria-checked", String(fait));
    try {
      await remplacer(`/api/listes/${seg(l.id)}/elements/${seg(e.id)}`, { texte: e.texte, fait, ordre: e.ordre ?? 0 });
      e.fait = fait;
      dessinerDetail();
      dessinerMaitre();
    } catch (err) {
      caseB.setAttribute("aria-checked", String(e.fait));
      direErreur(err, null, "Pas coché");
    }
  });
  const retirer = (btn) => occupe(btn, async () => {
    try {
      await supprimer(`/api/listes/${seg(l.id)}/elements/${seg(e.id)}`);
      l.elements = l.elements.filter((x) => x.id !== e.id);
      dessinerDetail();
      dessinerMaitre();
      dire(`« ${e.texte} » retiré.`, { action: { libelle: "Annuler", faire: () => remettreArticles(l, [e]) } });
    } catch (err) {
      direErreur(err, null, "Pas retiré");
    }
  });
  const li = h("li", { class: `ligne${e.fait ? " faite" : ""}` }, caseB, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, e.texte)),
    bouton("", { classe: "texte icone", icone: "corbeille", etiquette: `Retirer « ${e.texte} »`, onclick: (ev) => retirer(ev.currentTarget) }));
  surMenu(li, () => [{ libelle: e.fait ? "Remettre à prendre" : "Pris", icone: "coche", faire: () => caseB.click() }, { libelle: "Retirer", icone: "corbeille", danger: true, faire: () => retirer(null) }], { titre: e.texte });
  return li;
}

async function nouvelleListe() {
  const nom = (await demanderTexte("Nouvelle liste", { etiquette: "Nom", libelle: "Créer", placeholder: "Courses, anniversaires…" }))?.trim().slice(0, 80);
  if (!nom) return;
  const id = nouvelId();
  try {
    await remplacer(`/api/listes/${seg(id)}`, { nom, ordre: Math.max(-1, ...(donnees.listes || []).map((l) => l.ordre ?? -1)) + 1 });
    await recharger();
    aller("liste", id);
  } catch (err) {
    direErreur(err, null, "Liste pas créée");
  }
}
async function renommerListe(l) {
  const nom = (await demanderTexte("Renommer la liste", { valeur: l.nom, libelle: "Renommer", etiquette: "Nom" }))?.trim().slice(0, 80);
  if (!nom || nom === l.nom) return;
  try {
    await remplacer(`/api/listes/${seg(l.id)}`, { nom, ordre: l.ordre ?? 0 });
    dire("Renommée.", { genre: "succes" });
    recharger();
  } catch (err) {
    direErreur(err, null, "Pas renommée");
  }
}
/** Supprime une liste ; « Annuler » la recrée (même identifiant) avec ses articles, par lots de 100. */
async function supprimerListe(l) {
  const n = (l.elements || []).length;
  if (!(await confirmer(`Supprimer la liste « ${l.nom} » ?`, { detail: `${n} article${n > 1 ? "s" : ""}. « Annuler » juste après.`, libelle: "Supprimer", danger: true }))) return;
  const garde = { ...l, elements: [...(l.elements || [])] };
  try {
    await supprimer(`/api/listes/${seg(l.id)}`);
  } catch (err) {
    direErreur(err, null, "Pas supprimée");
    return;
  }
  dire(`Liste « ${l.nom} » supprimée.`, { genre: "succes", action: { libelle: "Annuler", faire: () => recreerListe(garde) } });
  if (ouvert("liste", l.id)) aller("listes");
  recharger();
}
async function recreerListe(l) {
  try {
    await remplacer(`/api/listes/${seg(l.id)}`, { nom: l.nom, ordre: l.ordre ?? 0 });
  } catch (err) {
    direErreur(err, () => recreerListe(l), "Liste pas remise");
    return;
  }
  await remettreArticles(l, l.elements, `Liste « ${l.nom} » remise.`);
}

// --- Rappels : en retard, aujourd'hui, plus tard, sans date, faits ---
// Les gestes d'une ligne (cocher, « Quand ? », étiquettes, retirer) : vues/rappels.js.

function ouvrirTriRappels() {
  if (tri) return;
  // L'adresse « tri » ne reste pas dans l'historique : « Précédent » ne rouvre
  // pas le tri, ni l'analyse du modèle local (elle ne part qu'à l'ouverture voulue).
  if (ouvert("rappels", "tri")) {
    selection = { type: "rappels", id: null };
    history.replaceState(null, "", "#/projets/rappels");
  }
  tri = ouvrirTri({
    // Vue démontée (demonter remet `racine` à null avant de fermer) : rien à relire.
    apres: () => { if (racine) recharger(); },
    surFermeture: () => { tri = null; },
  });
}

function detailRappels(id) {
  if (id === "tri") queueMicrotask(ouvrirTriRappels);
  if (!donnees.rappels) return vider(refs.detail, h("section", { class: "carte" }, squelette()));
  const capable = sait("etiquettes-v1");
  // Le clic droit dans le champ garde le menu du navigateur (coller…), pas celui de la carte.
  const champ = h("input", { class: "champ", type: "text", placeholder: "Appeler le garage demain à 9h", "aria-label": "Nouveau rappel", oncontextmenu: (e) => e.stopPropagation() });
  const lu = h("p", { class: "aide", style: { marginTop: "6px", minHeight: "20px" } });
  champ.addEventListener("input", () => {
    const brut = champ.value.trim();
    const d = extraire(brut);
    lu.textContent = d ? `« ${C.texteNouveauRappel(brut)} », ${C.quandRappel(d.quand.getTime())}` : brut ? "Sans date : il restera dans « Sans date »." : "";
  });
  const ajouter = async () => {
    const brut = champ.value.trim();
    if (!brut) return champ.focus();
    const d = extraire(brut);
    try {
      const r = await ecrire("/api/rappels", { rappels: [{ id: nouvelId(), texte: C.texteNouveauRappel(brut) || brut.slice(0, 300), quand: d ? d.quand.getTime() : null }] });
      champ.value = "";
      lu.textContent = "";
      const deja = r?.dejaLa?.[0];
      if (deja) dire(`Déjà dans tes rappels : « ${donnees.rappels.find((x) => x.id === deja.existant)?.texte || deja.texte} ».`);
      else dire(d ? `Rappel : ${C.quandRappel(d.quand.getTime())}.` : "Rappel ajouté, sans date.", { genre: "succes" });
      await recharger();
      refs.detail.querySelector("input.champ")?.focus();
    } catch (err) {
      direErreur(err, null, "Rappel pas ajouté");
    }
  };
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ajouter(); } });
  const tous = donnees.rappels;
  const filtreActif = capable ? lireFiltreLocal() : new Set();
  const visibles = tous.filter((r) => C.garderRappel(r, filtreActif));
  const groupes = C.groupesRappels(visibles);
  const nTraiter = capable ? C.aTraiter(tous, donnees.etiquettes || []).length : 0;
  const nouveau = () => nouveauRappel({ apres: recharger, rappels: tous });
  const menu = () => [
    { libelle: "Nouveau rappel", icone: "plus", faire: nouveau },
    capable ? { libelle: filtreActif.size ? `Filtré (${filtreActif.size})…` : "Filtrer…", icone: "entonnoir", faire: () => ouvrirFiltreRappels({ surChangement: () => dessinerDetail() }) } : null,
    capable ? { libelle: "Organiser mes rappels…", icone: "plateauPlein", faire: ouvrirTriRappels } : null,
  ];
  const plus = bouton("", { classe: "texte icone", icone: "points", etiquette: "Ajouter, filtrer, organiser", titre: "Ajouter, filtrer, organiser" });
  plus.addEventListener("click", () => ouvrirMenu(plus, menu(), { titre: "Rappels" }));
  const section = (g) => [titreSection(g.titre, g.rappels.length, { danger: g.danger }), h("ul", { class: "liste" }, g.rappels.map(ligne))];
  const carte = carteDetail("Carnet", "Rappels", [
    capable ? boutonFiltre({ surChangement: () => dessinerDetail() }) : null,
    bouton("Nouveau rappel", { classe: "papier petit", icone: "plus", onclick: nouveau }),
    plus],
  h("div", { class: "ajout-ligne" }, champ, bouton("Ajouter", { classe: "plein", onclick: (e) => occupe(e.currentTarget, ajouter) })), lu,
  nTraiter ? ligneTriRappels(nTraiter, { ouvrir: ouvrirTriRappels }) : null,
  !tous.length ? h("p", { class: "vide" }, "Aucun rappel pour l'instant.") : null,
  tous.length && !visibles.length ? h("p", { class: "vide" }, C.phraseMasques(tous.length, { duJour: false })) : null,
  groupes.map(section));
  surMenu(carte, menu, { titre: "Rappels" });
  vider(refs.detail, carte);
}

const ligne = (r) => ligneRappel(r, { apres: recharger, nomEtiquette: (id) => donnees.etiquettes?.find((e) => e.id === id)?.nom || null });

// --- Catégories (étiquettes des tâches et des rappels) ---
function detailCategories() {
  if (!donnees.etiquettes) {
    if (!sait("etiquettes-v1")) return vider(refs.detail, h("section", { class: "carte" }, vide("Pas encore", "Ta tour n'a pas encore la mise à jour des catégories.")));
    return vider(refs.detail, h("section", { class: "carte" }, squelette()));
  }
  const champ = h("input", { class: "champ", type: "text", placeholder: "Voiture", "aria-label": "Nouvelle catégorie" });
  const ajouter = async () => {
    const nom = champ.value.trim();
    if (!nom) return champ.focus();
    try {
      await remplacer(`/api/etiquettes/${seg(nouvelId())}`, { nom: nom.slice(0, 40), ordre: Math.max(-1, ...donnees.etiquettes.map((e) => e.ordre ?? -1)) + 1 });
      champ.value = "";
      recharger();
    } catch (err) { direErreur(err, null, `L'étiquette « ${nom} » n'a pas été créée`); }
  };
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ajouter(); } });
  const renommer = async (et) => {
    const nom = (await demanderTexte("Renommer la catégorie", { valeur: et.nom, libelle: "Renommer" }))?.trim();
    if (!nom || nom === et.nom) return;
    try { await remplacer(`/api/etiquettes/${seg(et.id)}`, { nom: nom.slice(0, 40), ordre: et.ordre ?? 0 }); recharger(); } catch (err) { direErreur(err, null, "L'étiquette n'a pas été renommée"); }
  };
  const retirer = async (et) => {
    if (!(await confirmer(`Supprimer « ${et.nom} » ?`, { detail: "Les tâches et rappels la perdent ; ils restent.", libelle: "Supprimer", danger: true }))) return;
    try { await supprimer(`/api/etiquettes/${seg(et.id)}`); recharger(); } catch (err) { direErreur(err, null, "L'étiquette n'a pas été supprimée"); }
  };
  vider(refs.detail, carteDetail("Carnet", "Catégories", null,
    h("p", { class: "aide" }, "Pour ranger tâches et rappels (Voiture, Santé…). Motion ne les connaît pas : Remy les garde. Supprimer ne supprime aucun rappel."),
    h("div", { class: "ajout-ligne" }, champ, bouton("Ajouter", { classe: "plein", onclick: (e) => occupe(e.currentTarget, ajouter) })),
    donnees.etiquettes.length ? h("ul", { class: "liste", style: { marginTop: "12px" } }, donnees.etiquettes.map((et) => surMenu(h("li", { class: "ligne" },
      h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, et.nom)),
      bouton("", { classe: "texte icone", icone: "crayon", etiquette: `Renommer « ${et.nom} »`, onclick: () => renommer(et) }),
      bouton("", { classe: "texte icone", icone: "corbeille", etiquette: `Supprimer « ${et.nom} »`, onclick: () => retirer(et) })),
    [{ libelle: "Renommer", icone: "crayon", faire: () => renommer(et) }, { libelle: "Supprimer", icone: "corbeille", danger: true, faire: () => retirer(et) }], { titre: et.nom })))
      : vide(null, "Pas encore de catégorie.")));
}

// --- Historique : ce qui a été écrit (par toi ou par Rémy), filtré, page par page, annulable ---

function confirmerAvec(question, { detail, libelle, garder }) {
  const f = feuille({
    titre: question,
    contenu: detail ? h("p", { class: "aide" }, detail) : null,
    pied: [bouton(garder, { classe: "papier", onclick: () => f.fermer(false) }), bouton(libelle, { classe: "plein", onclick: () => f.fermer(true) })],
  });
  f.el.querySelector(".feuille-pied .btn:last-child")?.focus();
  return f.fini.then((v) => v === true);
}

async function chargerHistorique() {
  const n = ++hist.lecture;
  hist.chargement = true;
  hist.erreur = null;
  dessinerHistorique();
  try {
    const r = await api(C.cheminHistorique({ filtre: sait("historique-v2") ? hist.filtre : "tout" }));
    if (n !== hist.lecture) return; // un filtre quitté entre-temps
    hist.entrees = r?.entrees || [];
    hist.suite = sait("historique-v2") ? r?.suite ?? null : null;
  } catch (err) {
    if (n !== hist.lecture) return;
    hist.erreur = err;
  }
  hist.chargement = false;
  dessinerHistorique();
}

async function plusAncien(btn) {
  if (!hist.suite) return;
  const n = hist.lecture;
  btn.querySelector(".lib").textContent = "Lecture…";
  await occupe(btn, async () => {
    try {
      const r = await api(C.cheminHistorique({ filtre: hist.filtre, avant: hist.suite }));
      if (n !== hist.lecture) return;
      hist.entrees = C.ajouterPage(hist.entrees, r?.entrees);
      hist.suite = r?.suite ?? null;
    } catch (err) {
      if (err.nature !== "auth") dire(`Plus ancien illisible : ${texteErreur(err)}`, { genre: "erreur" });
    }
  });
  dessinerHistorique();
}

async function annulerEntree(e, btn) {
  if (!(await confirmerAvec("Annuler cette action ?", { detail: C.detailAnnulation(e.source), libelle: "Annuler l'action", garder: "Garder" }))) return;
  await occupe(btn, async () => {
    try {
      const r = await ecrire(e.source === "agenda" ? "/api/google/undo" : "/api/motion/undo", { id: e.id }, { delai: 60000 });
      dire(C.phraseAnnulation(e.source, r?.ok), { genre: r?.ok === false ? "erreur" : "succes" });
    } catch (err) {
      // « Déjà annulé » (409) : c'est fait.
      if (err.statut === 409) dire("Annulé.", { genre: "succes" });
      else if (err.nature !== "auth") dire(`Impossible d'annuler : ${texteErreur(err).replace(/\.$/, "")}.`, { genre: "erreur" });
    }
  });
  chargerHistorique();
}

function ligneHistorique(e) {
  return h("li", { class: "ligne projets-entree" },
    h("div", { class: "corps" },
      h("div", { class: "projets-entree-tete" }, h("span", { class: "mono" }, heure(e.ts)), h("span", { class: "origine" }, e.origine || ""), icone(e.source === "agenda" ? "agenda" : "liste")),
      (e.elements?.length ? e.elements : [{ action: e.resume || "Écriture", objet: "—" }]).map((x) => h("div", { class: `projets-element${x.erreur ? " erreur" : ""}${x.action === "Déjà là" ? " deja" : ""}${e.annule ? " annulee" : ""}` },
        h("div", { class: "quoi" }, `${x.action} · « ${x.objet} »`),
        (x.changements || []).map((c) => h("div", { class: "mono changement" }, c)),
        x.erreur ? h("div", { class: "aide" }, x.erreur) : null)),
      e.annule ? h("div", { class: "projets-annulee" }, "Annulée") : null),
    !e.annule && e.annulable ? bouton("Annuler", { classe: "papier petit", onclick: (ev) => annulerEntree(e, ev.currentTarget) }) : null);
}

function dessinerHistorique() {
  if (selection?.type !== "historique" || !hist) return;
  const v2 = sait("historique-v2");
  const filtres = v2 ? h("div", { class: "rangee serree projets-filtres", role: "group", "aria-label": "Filtrer l'historique" },
    C.FILTRES_HISTORIQUE.map((f) => h("button", { type: "button", class: "puce", "aria-pressed": String(hist.filtre === f.id), onclick: () => {
      if (hist.filtre === f.id) return;
      hist.filtre = f.id;
      hist.entrees = [];
      hist.suite = null;
      chargerHistorique();
    } }, f.titre))) : null;
  let corps;
  if (!hist.entrees.length) {
    if (hist.chargement) corps = h("div", { class: "projets-lecture" }, h("p", { class: "aide" }, "Lecture du journal…"), squelette([0.8, 0.6, 0.7]));
    else if (hist.erreur) corps = blocErreur(hist.erreur, chargerHistorique);
    else corps = vide(null, C.videHistorique(hist.filtre));
  } else {
    corps = C.groupesHistorique(hist.entrees).map((g) => [titreSection(g.titre), h("ul", { class: "liste" }, g.entrees.map(ligneHistorique))]);
  }
  const suite = hist.suite && hist.entrees.length ? h("button", { type: "button", class: "btn texte large projets-plus-ancien", onclick: (e) => plusAncien(e.currentTarget) }, h("span", { class: "lib" }, "Plus ancien")) : null;
  vider(refs.detail, carteDetail("Ce qui a été écrit dans Motion et l'agenda", "Historique", null, filtres, corps, suite));
}

function detailHistorique() {
  if (!sait("historique-v1") && !sait("historique-v2")) return vider(refs.detail, h("section", { class: "carte" }, vide("Pas encore", "Ta tour n'a pas encore la mise à jour de l'historique.")));
  if (!hist) {
    hist = { filtre: "tout", entrees: [], suite: null, lecture: 0, chargement: true, erreur: null };
    chargerHistorique();
    return;
  }
  dessinerHistorique();
}
