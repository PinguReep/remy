// « Prochaines heures » (12/11) : une feuille large, variante d'« À
// l'échelle », ouverte par H (ou Ctrl+K), refermée par Échap, un clic sur le
// fond, ou H de nouveau. Les calculs sont dans analyse/heures.js (testé sous
// node) : ce fichier ne fait que dessiner et écouter.
//
// La frise se parcourt (12/11, second lot) : d'aujourd'hui dès 7 h jusqu'à
// demain soir, le passé estompé (fait, pas coché), maintenant comme repère,
// ouverte centrée sur maintenant. Glisser à la souris (avec inertie) ou au
// doigt (le défilement du navigateur), molette horizontale, flèches,
// « Maintenant ». Un clic sur la frise hors d'un bloc amène ce moment au
// milieu et met en avant ce qui s'y passe dans la liste ; un bloc (ou une
// ligne de la liste) ouvre « Gérer » par-dessus, la position est gardée. Un
// glisser (au-delà du seuil) n'ouvre rien et ne ferme jamais la feuille.
//
// « Sert ta priorité n°k » : seulement pour le classement CONFIRMÉ (les
// priorités `classee`) ; une proposition de Rémy n'est jamais citée ici. Les
// raisons du « planning de Rémy » ne sont pas reprises ici : elles expliquent
// SON placement, pas celui de Motion (on n'en dirait pas une raison de
// l'ordre affiché) ; la feuille y mène d'un bouton.
//
// Données : GET /api/semaine?jours=2 (sans IA, Motion lu depuis le cache de
// la tour ; heures-passe-v1 : les coches du jour, du journal) et GET
// /api/priorites. Jamais /api/dashboard (il peut relancer le conseil
// réfléchi). Relues au plus une fois par minute à l'ouverture, toutes les
// 5 min si la feuille reste ouverte ; l'heure, elle, avance chaque minute.
import { api, sait } from "../api.js";
import { h, vider, icone, bouton, feuille, squelette, vide, texteErreur, occupe } from "../ui.js";
import { couleurProjet } from "../couleurs.js";
import { heure, duree, jourTitre, jourCourtSemaine } from "../analyse/journee.js";
import { etatVue } from "../analyse/semaine.js";
import {
  prochainesHeures, classeesDe, phraseTranche, heuresTranche, phraseTete, semaineLisible,
  friseDe, defilementPour, ligneA, phraseMoment, phrasePlage, ligneCourante, voisine,
  estGlisser, vitesseRelachee, pasInertie,
} from "../analyse/heures.js";
import { cochees, gerer } from "./gerer.js";

const FRAIS_MS = 60e3;
const RELIRE_OUVERTE_MS = 5 * 60e3;

const etat = { semaine: null, priorites: [], misAJour: null, erreur: null, chargement: false };
let lecture = null;
// { f, corps, minuteur, contexte, centre (ms au milieu de la frise), suivre (suit maintenant), selection (clé), passeOuvert, ... }
let vue = null;

// Pas de guillemet seul en début de ligne : « et » tiennent au mot qu'ils encadrent.
const insecable = (t) => String(t ?? "").replace(/« /g, "« ").replace(/ »/g, " »");

const ICONE_FAIT = { fixe: "cadenas", menace: "alerte", priorite: "etoile", echeance: "drapeau", motion: "fleche", debut: "calendrier", attente: "pause", rien: "question" };

// Ce qui garde le focus d'un redessin à l'autre, à défaut d'une clé.
const FOCUS_STABLES = ["heures-defile", "heures-btn-mnt", "heures-pas", "heures-plus-tot-tete"];

const reduit = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const auDoigt = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
/** L'échelle : une demi-heure fait 48 px au doigt (4 h visibles sur un téléphone), 8 h visibles sur l'ordinateur. */
const pxParHeure = () => (typeof innerWidth === "number" && innerWidth < 640 ? 96 : 124);

async function charger({ frais = false } = {}) {
  if (!sait("semaine-v1")) return dessiner();
  if (lecture) return lecture;
  if (!frais && etat.misAJour && Date.now() - etat.misAJour < FRAIS_MS) return dessiner();
  etat.chargement = true;
  dessiner(); // squelettes, ou « Vue de 10:40, mise à jour… »
  lecture = (async () => {
    const [s, p] = await Promise.allSettled([
      api("/api/semaine?jours=2", { delai: 30000 }),
      sait("priorites-v1") ? api("/api/priorites", { delai: 15000 }) : Promise.resolve({ priorites: [] }),
    ]);
    if (s.status === "fulfilled" && semaineLisible(s.value)) {
      etat.semaine = s.value;
      etat.misAJour = Date.now();
      etat.erreur = null;
    } else {
      // Une réponse qui n'a pas la forme attendue : « illisible », pas « rien de prévu ».
      etat.erreur = s.status === "rejected" ? s.reason : { nature: "illisible", message: "La tour a rendu une réponse illisible." };
    }
    // Les priorités en plus : leur échec n'enlève que « sert ta priorité » (null = illisibles).
    etat.priorites = p.status === "fulfilled" && Array.isArray(p.value?.priorites) ? p.value.priorites : null;
  })().finally(() => {
    etat.chargement = false;
    lecture = null;
    dessiner();
  });
  return lecture;
}

/** Ouvre la feuille (ou la ramène au premier plan si elle l'est déjà). */
export function ouvrir({ contexte } = {}) {
  if (vue) return;
  const corps = h("div", { class: "heures-vue" });
  const rafraichir = bouton("Rafraîchir", { classe: "papier", icone: "rafraichir", onclick: (ev) => occupe(ev.currentTarget, () => charger({ frais: true })) });
  const planning = sait("planning-remy-v1")
    ? bouton("Le planning de Rémy", { classe: "texte", icone: "deplacer", titre: "Où Rémy ne placerait pas comme Motion, et pourquoi", onclick: () => import("./planning-remy.js").then((m) => m.ouvrir({ contexte })) })
    : null;
  const f = feuille({
    titre: "Prochaines heures", sousTitre: " ", contenu: corps, large: true, classe: "feuille-echelle feuille-heures",
    pied: [h("span", { class: "aide heures-aide" }, "H ou Échap : fermer · ← → : parcourir"), h("span", { class: "heures-pied-actions" }, planning, rafraichir)],
    // Un glisser qui finit sur le fond n'est pas « un clic à côté ».
    avantFermeture: (raison) => !(raison === "fond" && vue && Date.now() - (vue.finGeste || 0) < 450),
    surFermeture: () => {
      clearInterval(vue?.minuteur);
      clearTimeout(vue?.redessinPrevu);
      vue?.arreterInertie?.();
      vue?.desabonner?.();
      vue = null;
    },
  });
  // La même touche referme (la touche globale ne joue pas pendant qu'une feuille est ouverte).
  f.el.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target?.tagName || "")) return;
    if (ev.key === "h" || ev.key === "H") {
      ev.preventDefault();
      f.fermer();
    }
  });
  vue = { f, corps, contexte, minuteur: null, centre: null, suivre: true, selection: null, passeOuvert: false, finGeste: 0, glisse: false, enAttente: false };
  // Une coche faite d'ici (Gérer › Terminer) : la ligne passe « faite » tout de suite.
  vue.desabonner = cochees.surChangement(() => dessiner());
  // L'heure avance : la frise et les tranches suivent chaque minute ; la tour est relue toutes les 5 min.
  vue.minuteur = setInterval(() => {
    if (etat.misAJour && Date.now() - etat.misAJour >= RELIRE_OUVERTE_MS) charger({ frais: true });
    else dessiner();
  }, 60e3);
  dessiner();
  charger();
  // Le focus sur la feuille elle-même : Échap et H marchent tout de suite, rien n'est activé par erreur.
  f.el.setAttribute("tabindex", "-1");
  f.el.focus();
}

/** H : ouvre, ou referme si elle est ouverte. */
export function basculer(options) {
  if (vue) vue.f.fermer();
  else ouvrir(options);
}

export const estOuverte = () => Boolean(vue);

function dessiner() {
  if (!vue) return;
  // Pendant un glisser (ou l'élan d'un défilement au doigt), rien ne bouge dessous : on redessine à la fin.
  if (vue.glisse) {
    vue.enAttente = true;
    return;
  }
  if (Date.now() - (vue.dernierDefilement || 0) < 700 && !vue.redessinPrevu) {
    vue.redessinPrevu = setTimeout(() => {
      if (!vue) return;
      vue.redessinPrevu = null;
      vue.dernierDefilement = 0;
      dessiner();
    }, 800);
    return;
  }
  if (vue.redessinPrevu) return;
  const m = Date.now();
  const { f, corps } = vue;
  const sous = f.el.querySelector(".feuille-tete .sous");
  if (sous) sous.textContent = `${jourTitre(m)}, ${heure(m)}`;
  if (!sait("semaine-v1")) {
    vider(corps, vide(null, "Prochaines heures arrive avec la mise à jour de ta tour (scripts/installer-tour.ps1)."));
    return;
  }
  if (!etat.semaine) {
    if (etat.erreur && !etat.chargement) return vider(corps, blocErreur(etat.erreur));
    return vider(corps, squelettes());
  }
  // Ce qui doit survivre au redessin : la position de la frise (vue.centre, l'heure au milieu), le défilement de la feuille, le focus.
  const corpsFeuille = f.el.querySelector(".feuille-corps");
  const hautFeuille = corpsFeuille?.scrollTop ?? 0;
  const focus = document.activeElement;
  const focusDedans = corps.contains(focus);
  const focusCle = focusDedans ? focus.dataset?.cle || null : null;
  const focusZone = focusDedans ? (focus.closest(".heures-voie") ? "frise" : focus.closest(".heures-liste") && focusCle ? "liste" : null) : null;
  const focusClasse = focusDedans ? FOCUS_STABLES.find((c) => focus.classList.contains(c)) || null : null;

  const cocheesA = new Map(cochees.liste().map((c) => [c.id, c.a]));
  const v = prochainesHeures({ semaine: etat.semaine, priorites: etat.priorites, maintenant: m, cochees: cochees.ids(), cocheesA });
  vue.v = v;
  const bandeau = etatVue(etat, m);
  const notes = v.notes.map((n) => h("p", { class: `heures-note${n.alerte ? " risque-texte" : ""}` }, icone(n.alerte ? "alerte" : "info"), h("span", null, n.texte),
    n.reglage && vue.contexte?.aller ? bouton("Ce qui compte", { classe: "texte petit", onclick: () => { f.fermer(); vue?.contexte?.aller("reglages/priorites"); } }) : null));
  if (!sait("heures-passe-v1")) notes.push(h("p", { class: "heures-note" }, icone("info"), h("span", null, "Ce que tu as coché aujourd'hui apparaîtra dans la frise avec la mise à jour de ta tour.")));
  const tete = bandeau ? h("div", { class: "semaine-bandeau", role: "status" }, icone(etat.erreur ? "alerte" : "horloge"), h("span", { class: "msg" }, bandeau),
    etat.erreur ? bouton("Réessayer", { classe: "papier petit", icone: "rafraichir", onclick: (ev) => occupe(ev.currentTarget, () => charger({ frais: true })) }) : null) : null;
  const phrase = phraseTete(v, m);
  const regle = classeesDe(etat.priorites).length ? "Motion décide de l'ordre. Sous chaque ligne : ce que ses données en disent, et la priorité de ton classement qu'elle sert." : "Motion décide de l'ordre. Sous chaque ligne : ce que ses données en disent.";
  // Une sélection qui n'existe plus (la tâche est partie) : on n'en garde rien.
  if (vue.selection && !v.toutes.some((l) => l.cle === vue.selection)) vue.selection = null;

  // La frise d'abord, à la place exacte de son squelette : rien ne saute à l'arrivée des données.
  vider(corps,
    tete,
    frise(v, m),
    v.vide
      ? h("p", { class: "heures-tete" }, v.rienDuTout ? "Rien de prévu aujourd'hui ni demain." : "Plus rien de prévu d'ici demain midi.")
      : phrase ? h("p", { class: "heures-tete" }, insecable(phrase)) : null,
    v.rienDuTout ? h("p", { class: "aide heures-regle" }, "Ni rendez-vous, ni tâche placée par Motion, ni coche aujourd'hui : ce que Motion placera apparaîtra ici.")
      : v.vide ? null : h("p", { class: "aide heures-regle" }, regle),
    v.toute.length ? h("p", { class: "aide heures-toute" }, `Toute la journée : ${v.toute.join(" · ")}`) : null,
    notes,
    v.rienDuTout
      ? null
      : h("div", { class: "heures-grille" },
        h("section", { class: "heures-cote", "aria-label": "Sur quel projet" }, projets(v), neRentrePas(v)),
        h("section", { class: "heures-liste", "aria-label": "Dans l'ordre de Motion" }, liste(v, m))));

  if (corpsFeuille) corpsFeuille.scrollTop = hautFeuille;
  placer({ instantane: true });
  // Le focus revient où il était (un bloc redessiné est un nouvel élément) ; à défaut, sur la feuille :
  // H et Échap marchent toujours.
  if (focusDedans) {
    const cible = focusZone && focusCle ? corps.querySelector(`${focusZone === "liste" ? ".heures-liste" : ".heures-voie"} [data-cle="${CSS.escape(focusCle)}"]`)
      : focusClasse ? corps.querySelector(`.${focusClasse}`) : null;
    (cible || f.el).focus({ preventScroll: true });
  }
  marquer();
  if (vue.enAttente) vue.enAttente = false;
}

function squelettes() {
  // Les mêmes hauteurs que la vraie frise : rien ne saute quand elle arrive.
  return h("div", { class: "heures-squelettes" },
    h("div", { class: "heures-frise-zone" },
      h("div", { class: "heures-nav" }, h("span", { class: "heures-plage squelette-ligne" }), h("span", { class: "squelette-bouton" })),
      h("div", { class: "heures-frise-cadre squelette-frise", "aria-hidden": "true" }),
      h("p", { class: "heures-moment", role: "status" }, "Lecture de ta journée…")),
    squelette([0.62]), squelette([0.85, 0.6, 0.75]), squelette([0.6, 0.8]));
}

function blocErreur(err) {
  const reessayer = bouton("Réessayer", { classe: "papier", icone: "rafraichir", onclick: (ev) => occupe(ev.currentTarget, () => charger({ frais: true })) });
  const reseau = err?.nature === "reseau" || err?.nature === "delai";
  const texte = reseau
    ? "La tour ne répond pas : Tailscale est-il actif ? Rien n'est gardé ici pour ces heures-là."
    : err?.nature === "illisible"
      ? "La tour a rendu une réponse illisible : réessaie dans un instant. Si ça dure, regarde Réglages › Diagnostic."
      : texteErreur(err);
  return vide(reseau ? "Tour injoignable" : "Pas pu lire tes prochaines heures", texte, reessayer);
}

// --- La frise -------------------------------------------------------------------

const couleurDe = (l) => (l.type === "rdv" ? "var(--encre-2)" : couleurProjet(l.projet));

function etiquetteBloc(l) {
  const quand = l.ponctuel ? `cochée à ${heure(l.debut)}` : `${heure(l.debut)} – ${heure(l.fin)}`;
  const nature = l.type === "rdv" ? "rendez-vous" : "tâche";
  const bits = [quand, l.titre, nature, l.projet, l.fait ? "faite" : l.issue === "pasCochee" ? "pas cochée" : l.enCours ? "en cours" : l.etat === "passe" ? "passé" : null, l.menace ? "menacée" : null];
  return bits.filter(Boolean).join(", ");
}

function frise(v, m) {
  const px = pxParHeure();
  const g = friseDe(v.toutes, v.plage, m, { pxParHeure: px, cible: 44 });
  vue.g = g;
  vue.px = px;
  const piste = h("div", { class: "heures-piste", style: { width: `${g.total}px` } });
  // La règle : les heures, demain, maintenant.
  const graduation = h("div", { class: "heures-graduation", "aria-hidden": "true" });
  for (const r of g.heures) graduation.append(h("span", { class: `heures-repere${r.majeure ? " majeure" : ""}${r.masque ? " masque" : ""}`, style: { left: `${r.x}px` } }, r.libelle));
  if (g.maintenant != null) graduation.append(h("span", { class: "heures-mnt-pastille", style: { left: `${g.maintenant}px` } }, heure(m)));

  const voie = h("div", { class: "heures-voie" });
  if (g.maintenant != null) voie.append(h("span", { class: "heures-passe", "aria-hidden": "true", style: { width: `${g.maintenant}px` } }));
  for (const r of g.heures) voie.append(h("span", { class: `heures-trait${r.majeure ? " majeure" : ""}`, "aria-hidden": "true", style: { left: `${r.x}px` } }));
  if (g.nuit) voie.append(h("span", { class: "heures-nuit", "aria-hidden": "true", style: { left: `${g.nuit.x0}px`, width: `${g.nuit.x1 - g.nuit.x0}px` } }, h("span", null, "nuit")));
  if (g.demain != null) {
    voie.append(h("span", { class: "heures-minuit", "aria-hidden": "true", style: { left: `${g.demain}px` } }),
      h("span", { class: "heures-jour", "aria-hidden": "true", style: { left: `${g.demain}px` } }, h("strong", null, "Demain"), h("span", null, jourCourtSemaine(v.plage.fin - 1).toLowerCase())));
  }
  const depart = vue.selection || ligneCourante(v.toutes, m)?.cle || null;
  for (const l of v.toutes) {
    const b = g.parCle.get(l.cle);
    if (!b) continue;
    const classes = ["hb", l.type, l.etat, l.fait ? "fait" : "", l.issue === "pasCochee" ? "glisse" : "", l.menace ? "menace" : "", l.ponctuel ? "ponctuel" : "", l.enCours ? "encours" : "", b.etiquette ? `et-${b.etiquette}` : ""].filter(Boolean).join(" ");
    const visuel = h("span", { class: "hb-v", style: { left: `${b.x0 - b.hit0}px`, width: `${b.x1 - b.x0}px` } },
      l.ponctuel ? icone("coche") : null,
      b.etiquette === "icone" && !l.ponctuel ? h("span", { class: "hb-i", "aria-hidden": "true" }, l.fait ? icone("coche") : l.type === "rdv" ? icone("cadenas") : h("span", { class: "point" })) : null,
      (b.etiquette === "titre" || b.etiquette === "complete") && !l.ponctuel ? h("span", { class: "hb-t" }, l.fait ? icone("coche") : l.type === "rdv" ? icone("cadenas") : null, h("span", { class: "tt" }, l.titre)) : null,
      b.etiquette === "complete" && !l.ponctuel ? h("span", { class: "hb-h" }, `${heure(l.debut)} – ${heure(l.fin)}`) : null);
    voie.append(h("button", {
      type: "button", class: classes, dataset: { cle: l.cle }, tabindex: l.cle === depart ? "0" : "-1",
      "aria-label": etiquetteBloc(l), title: `${l.titre} · ${l.ponctuel ? `cochée à ${heure(l.debut)}` : `${heure(l.debut)} – ${heure(l.fin)}`}`,
      style: { left: `${b.hit0}px`, width: `${b.hit1 - b.hit0}px`, "--couloir": b.couloir, "--couloirs": b.couloirs, "--couleur": couleurDe(l) },
    }, visuel));
  }
  if (g.maintenant != null) voie.append(h("span", { class: "heures-mnt", "aria-hidden": "true", style: { left: `${g.maintenant}px` } }));
  if (vue.moment != null && vue.moment >= v.plage.debut && vue.moment <= v.plage.fin) voie.append(h("span", { class: "heures-curseur", "aria-hidden": "true", style: { left: `${g.x(vue.moment)}px` } }));
  piste.append(graduation, voie);

  const defile = h("div", {
    class: "heures-defile", tabindex: "0", role: "group",
    "aria-label": `Frise : ${phrasePlage(v.plage, m).toLowerCase()}. Flèches gauche et droite pour la parcourir, Tab pour ses blocs.`,
  }, piste);
  brancherGestes(defile, voie);

  const maintenant = bouton("Maintenant", { classe: "papier petit heures-btn-mnt", icone: "cible", titre: "Revenir à maintenant", onclick: () => revenirAMaintenant() });
  const nav = h("div", { class: "heures-nav" },
    h("span", { class: "heures-plage" }, phrasePlage(v.plage, m)),
    h("span", { class: "heures-nav-actions" },
      bouton("", { classe: "texte petit heures-pas prec", icone: "chevron", etiquette: "Trois heures plus tôt", titre: "Trois heures plus tôt", onclick: () => decaler(-3) }),
      bouton("", { classe: "texte petit heures-pas", icone: "chevron", etiquette: "Trois heures plus tard", titre: "Trois heures plus tard", onclick: () => decaler(3) }),
      maintenant));
  const moment = h("p", { class: "heures-moment", role: "status", "aria-live": "polite" }, vue.phraseMoment || aideMoment());
  return h("div", { class: "heures-frise-zone" }, nav, h("div", { class: "heures-frise-cadre" }, defile), moment);
}

const aideMoment = () => (auDoigt() ? "Fais défiler la frise du doigt : le matin à gauche, demain à droite. Un bloc touché s'ouvre dans « Gérer »." : "Tire la frise à la souris, ou ← → ; un clic sur la frise y amène, un clic sur un bloc ouvre « Gérer ».");

/** Le fondu des bords dit qu'il y a plus loin : pas de fondu au bout de la frise. */
function bords(d) {
  d.classList.toggle("au-debut", d.scrollLeft <= 1);
  d.classList.toggle("a-la-fin", d.scrollLeft + d.clientWidth >= d.scrollWidth - 1);
}

/** Met la frise à sa place : suit maintenant, ou garde l'heure qu'on regardait. */
function placer({ instantane = false } = {}) {
  const d = vue?.corps.querySelector(".heures-defile");
  if (!d || !vue.g) return;
  const t = vue.suivre || vue.centre == null ? Date.now() : vue.centre;
  defilerVers(defilementPour(vue.g.x(t), d.clientWidth, vue.g.total), { instantane });
  bords(d);
}

function defilerVers(gauche, { instantane = false } = {}) {
  const d = vue?.corps.querySelector(".heures-defile");
  if (!d) return;
  vue.arreterInertie?.();
  d.scrollTo({ left: gauche, behavior: instantane || reduit() ? "auto" : "smooth" });
}

function revenirAMaintenant() {
  if (!vue?.g) return;
  vue.suivre = true;
  vue.centre = null;
  vue.moment = null;
  const l = vue.v ? ligneCourante(vue.v.toutes, Date.now()) : null;
  vue.selection = l?.cle || null;
  dire(l ? `Maintenant, ${heure(Date.now())} · ${l.enCours ? `en cours : « ${l.titre} »` : `ensuite : « ${l.titre} » à ${heure(l.debut)}`}` : `Maintenant, ${heure(Date.now())}`);
  placer();
  marquer({ defilerListe: true });
  vue.corps.querySelector(".heures-curseur")?.remove();
}

function decaler(heures) {
  const d = vue?.corps.querySelector(".heures-defile");
  if (!d || !vue.g) return;
  quitterSuivi();
  defilerVers(d.scrollLeft + heures * vue.px);
}

const quitterSuivi = () => {
  if (vue) vue.suivre = false;
};

function dire(texte) {
  if (!vue) return;
  vue.phraseMoment = texte;
  const p = vue.corps.querySelector(".heures-moment");
  if (p) p.textContent = texte;
}

/** Les gestes de la frise : glisser (souris, avec inertie), doigt (défilement natif), molette, clavier, clics. */
function brancherGestes(defile, voie) {
  let geste = null; // { id, x0, y0, gauche0, type, glisse, echantillons }
  let anim = null;
  const arreter = () => {
    if (anim) cancelAnimationFrame(anim);
    anim = null;
  };
  vue.arreterInertie = arreter;

  defile.addEventListener("pointerdown", (ev) => {
    arreter();
    if (ev.button !== 0) return;
    // Le doigt : le navigateur fait défiler lui-même (et annule le clic s'il a glissé).
    geste = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, gauche0: defile.scrollLeft, type: ev.pointerType || "mouse", glisse: false, echantillons: [{ t: ev.timeStamp, x: ev.clientX }] };
  });
  defile.addEventListener("pointermove", (ev) => {
    if (!geste || ev.pointerId !== geste.id) return;
    const dx = ev.clientX - geste.x0;
    const dy = ev.clientY - geste.y0;
    if (!geste.glisse) {
      if (!estGlisser(dx, dy, geste.type)) return;
      geste.glisse = true;
      quitterSuivi();
      if (geste.type === "mouse") {
        vue.glisse = true;
        defile.setPointerCapture?.(ev.pointerId);
        defile.classList.add("glisse");
      }
    }
    if (geste.type !== "mouse") return;
    defile.scrollLeft = geste.gauche0 - dx;
    geste.echantillons.push({ t: ev.timeStamp, x: ev.clientX });
    if (geste.echantillons.length > 12) geste.echantillons.shift();
  });
  const finir = (ev) => {
    if (!geste || ev.pointerId !== geste.id) return;
    const g = geste;
    geste = null;
    if (!g.glisse) return;
    vue.finGeste = Date.now();
    vue.clicBloque = true;
    // Le clic qui suit un glisser est avalé ; s'il ne vient pas, la consigne s'efface.
    setTimeout(() => {
      if (vue) vue.clicBloque = false;
    }, 60);
    defile.classList.remove("glisse");
    if (g.type !== "mouse") return;
    try {
      defile.releasePointerCapture?.(ev.pointerId);
    } catch {}
    let v = reduit() || ev.type === "pointercancel" ? 0 : -vitesseRelachee(g.echantillons, ev.timeStamp);
    let avant = performance.now();
    const pas = (t) => {
      const r = pasInertie(v, Math.min(48, t - avant));
      avant = t;
      v = r.v;
      const max = defile.scrollWidth - defile.clientWidth;
      defile.scrollLeft = Math.min(max, Math.max(0, defile.scrollLeft + r.dx));
      if (v !== 0 && defile.scrollLeft > 0 && defile.scrollLeft < max) anim = requestAnimationFrame(pas);
      else fin();
    };
    const fin = () => {
      anim = null;
      vue.glisse = false;
      if (vue.enAttente) dessiner();
    };
    if (v) anim = requestAnimationFrame(pas);
    else fin();
  };
  defile.addEventListener("pointerup", finir);
  defile.addEventListener("pointercancel", finir);
  // Où qu'il vienne (doigt, molette, trackpad, focus, « Maintenant »), le défilement dit l'heure regardée :
  // la frise suit maintenant tant qu'elle y est centrée, sinon un redessin garde l'heure qu'on regardait.
  defile.addEventListener("scroll", () => {
    if (!vue?.g || defile !== vue.corps.querySelector(".heures-defile")) return;
    vue.dernierDefilement = Date.now();
    bords(defile);
    vue.centre = vue.g.temps(defile.scrollLeft + defile.clientWidth / 2);
    vue.suivre = vue.g.maintenant != null && Math.abs(defile.scrollLeft - defilementPour(vue.g.maintenant, defile.clientWidth, vue.g.total)) < 4;
  }, { passive: true });
  // Un défilement par le doigt, la molette ou le trackpad : on ne suit plus maintenant.
  defile.addEventListener("wheel", (ev) => {
    arreter();
    if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) || ev.shiftKey) quitterSuivi();
  }, { passive: true });
  defile.addEventListener("touchmove", () => quitterSuivi(), { passive: true });
  // Le clic qui termine un glisser n'ouvre rien.
  defile.addEventListener("click", (ev) => {
    if (vue?.clicBloque) {
      ev.preventDefault();
      ev.stopPropagation();
      vue.clicBloque = false;
    }
  }, true);

  // Un bloc : Gérer (ou, pour une coche du journal, ce qu'on en sait). Hors d'un bloc : ce moment au milieu.
  voie.addEventListener("click", (ev) => {
    const b = ev.target.closest?.(".hb");
    if (b) return ouvrirLigne(b.dataset.cle, "frise");
    if (!vue?.g) return;
    const r = voie.getBoundingClientRect();
    const t = vue.g.temps(ev.clientX - r.left);
    allerA(t);
  });
  // Survoler un bloc : sa ligne s'éclaire dans la liste.
  voie.addEventListener("pointerover", (ev) => survoler(ev.target.closest?.(".hb")?.dataset.cle || null));
  voie.addEventListener("pointerleave", () => survoler(null));
  voie.addEventListener("focusin", (ev) => {
    const cle = ev.target.closest?.(".hb")?.dataset.cle;
    if (!cle) return;
    vue.selection = cle;
    marquer({ defilerListe: true });
    rendreVisible(cle);
  });

  defile.addEventListener("keydown", (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const bloc = ev.target.closest?.(".hb");
    if (bloc && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
      ev.preventDefault();
      const l = voisine(vue.v.toutes, bloc.dataset.cle, ev.key === "ArrowLeft" ? -1 : 1);
      if (!l) return;
      quitterSuivi();
      const suivant = voie.querySelector(`[data-cle="${CSS.escape(l.cle)}"]`);
      voie.querySelectorAll(".hb").forEach((x) => x.setAttribute("tabindex", x === suivant ? "0" : "-1"));
      suivant?.focus({ preventScroll: true });
      return;
    }
    if (ev.target !== defile) return;
    const pas = { ArrowLeft: -1, ArrowRight: 1 }[ev.key];
    if (pas) {
      ev.preventDefault();
      decaler(pas * (ev.shiftKey ? 3 : 1));
    } else if (ev.key === "Home" || ev.key === "End") {
      ev.preventDefault();
      quitterSuivi();
      defilerVers(ev.key === "Home" ? 0 : vue.g.total);
    }
  });
}

/** Un bloc, rendu visible sans tout recentrer s'il l'est déjà (focus au clavier). */
function rendreVisible(cle) {
  const d = vue?.corps.querySelector(".heures-defile");
  const b = vue?.g?.parCle.get(cle);
  if (!d || !b) return;
  const marge = 24;
  if (b.x0 >= d.scrollLeft + marge && b.x1 <= d.scrollLeft + d.clientWidth - marge) return;
  quitterSuivi();
  defilerVers(defilementPour((b.x0 + b.x1) / 2, d.clientWidth, vue.g.total));
}

/** Un moment touché sur la frise : au milieu, et ce qui s'y passe mis en avant dans la liste. */
function allerA(t) {
  if (!vue?.v) return;
  quitterSuivi();
  vue.centre = t;
  vue.moment = t;
  const r = ligneA(vue.v.toutes, t);
  vue.selection = r?.ligne.cle || null;
  dire(phraseMoment(t, r));
  const voie = vue.corps.querySelector(".heures-voie");
  voie?.querySelector(".heures-curseur")?.remove();
  voie?.append(h("span", { class: "heures-curseur", "aria-hidden": "true", style: { left: `${vue.g.x(t)}px` } }));
  placer();
  marquer({ defilerListe: true });
}

function survoler(cle) {
  if (!vue) return;
  vue.corps.querySelectorAll(".survol").forEach((x) => x.classList.remove("survol"));
  if (!cle) return;
  vue.corps.querySelectorAll(`[data-cle="${CSS.escape(cle)}"]`).forEach((x) => x.classList.add("survol"));
}

/** La sélection, des deux côtés : le bloc et la ligne ; la liste défile jusqu'à elle si on le demande. */
function marquer({ defilerListe = false } = {}) {
  if (!vue) return;
  const cle = vue.selection;
  vue.corps.querySelectorAll(".choisi").forEach((x) => {
    x.classList.remove("choisi");
    x.removeAttribute("aria-current");
  });
  if (!cle) return;
  const ligneEl = vue.corps.querySelector(`.heures-liste [data-cle="${CSS.escape(cle)}"]`);
  // Une ligne passée, dans « Passé ou fait » replié : on le déplie pour la montrer.
  if (!ligneEl && defilerListe && vue.v?.groupes.passees.some((g) => g.lignes.some((l) => l.cle === cle)) && !vue.passeOuvert) {
    vue.passeOuvert = true;
    const zone = vue.corps.querySelector(".heures-plus-tot");
    if (zone) zone.replaceWith(plusTot(vue.v, Date.now()));
  }
  vue.corps.querySelectorAll(`[data-cle="${CSS.escape(cle)}"]`).forEach((x) => {
    x.classList.add("choisi");
    x.setAttribute("aria-current", "true");
  });
  const bloc = vue.corps.querySelector(`.heures-voie [data-cle="${CSS.escape(cle)}"]`);
  if (bloc) vue.corps.querySelectorAll(".heures-voie .hb").forEach((x) => x.setAttribute("tabindex", x === bloc ? "0" : "-1"));
  if (defilerListe) {
    const li = vue.corps.querySelector(`.heures-liste [data-cle="${CSS.escape(cle)}"]`);
    li?.scrollIntoView({ block: "nearest", behavior: reduit() ? "auto" : "smooth" });
  }
}

/** Ouvre une ligne : « Gérer » par-dessus (la frise reste où elle est), ou ce qu'on sait d'une coche du journal. */
function ouvrirLigne(cle, depuis) {
  const l = vue?.v?.toutes.find((x) => x.cle === cle);
  if (!l) return;
  vue.selection = cle;
  if (depuis === "liste") {
    quitterSuivi();
    rendreVisible(cle);
  }
  marquer({ defilerListe: depuis === "frise" });
  if (!l.gerable || !l.source) {
    dire(`${l.ponctuel ? heure(l.debut) : `${heure(l.debut)} – ${heure(l.fin)}`} · « ${l.titre} » : ${l.statut ? l.statut.charAt(0).toLowerCase() + l.statut.slice(1) : "faite"}. Pour la rouvrir : l'Historique.`);
    return;
  }
  const jour = (etat.semaine?.jours || []).find((j) => (j.items || []).some((e) => e.type === l.type && e.id === l.id));
  let relire = null;
  gerer(l.source, {
    contexte: vue.contexte,
    // Après un geste : la tour relue (Motion recalcule), la position et la sélection gardées.
    apres: () => {
      clearTimeout(relire);
      relire = setTimeout(() => charger({ frais: true }), 600);
    },
    maj: () => dessiner(),
    jour: jour?.items || null,
    systeme: { agenda: etat.semaine?.sources?.agenda === "ok" },
  });
}

// --- La liste --------------------------------------------------------------------

function liste(v, m) {
  const { aVenir } = v.groupes;
  return [
    plusTot(v, m),
    aVenir.length ? aVenir.map((t) => groupe(t, m)) : h("p", { class: "aide heures-plus-rien" }, "Plus rien de placé d'ici demain soir."),
  ];
}

/** Ce qui est passé, ou déjà fait : replié sous une ligne qui le compte, déplié d'un clic (ou en touchant un bloc passé). */
function plusTot(v, m) {
  const { passees } = v.groupes;
  const b = v.bilanPasse;
  if (!b.total) return h("div", { class: "heures-plus-tot vide-passe" });
  const compte = [b.faites ? `${b.faites} faite${b.faites > 1 ? "s" : ""}` : null, b.pasCochees ? `${b.pasCochees} pas cochée${b.pasCochees > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ");
  const ouvert = vue.passeOuvert;
  const corpsId = "heures-plus-tot-corps";
  const tete = h("button", {
    type: "button", class: "heures-plus-tot-tete", "aria-expanded": String(ouvert), "aria-controls": corpsId,
    onclick: () => {
      vue.passeOuvert = !vue.passeOuvert;
      const zone = vue.corps.querySelector(".heures-plus-tot");
      zone?.replaceWith(plusTot(vue.v, Date.now()));
      marquer();
      vue.corps.querySelector(".heures-plus-tot-tete")?.focus({ preventScroll: true });
    },
  }, icone(ouvert ? "haut" : "bas"), h("span", { class: "t" }, "Passé ou fait"), h("span", { class: "d" }, compte || `${b.total} passé${b.total > 1 ? "s" : ""}`));
  return h("div", { class: `heures-plus-tot${ouvert ? " ouvert" : ""}` }, tete,
    ouvert ? h("div", { id: corpsId, class: "heures-plus-tot-corps" }, passees.map((t) => groupe(t, m, true))) : null);
}

/** Une tranche de la liste : son titre, puis ses lignes dans l'ordre de Motion. */
function groupe(t, m, passe = false) {
  const plage = t.etat === "encours" && !passe ? `${heure(m)} – ${t.id.endsWith("oir") ? "minuit" : heure(t.fin)}` : heuresTranche(t);
  return h("div", { class: `heures-groupe${passe ? " passe" : ""}` },
    h("h3", { class: "heures-titre" }, t.titre, h("span", { class: "h" }, plage)),
    h("ol", { class: "heures-lignes" }, t.lignes.map(ligne)));
}

function ligne(l) {
  const premier = l.faits[0]?.genre || "rien";
  const rdv = l.type === "rdv";
  const passe = l.fait || l.etat === "passe";
  const sous = passe
    ? h("span", { class: `heures-pq statut${l.fait ? " fait" : l.issue === "pasCochee" ? " glisse" : ""}` }, icone(l.fait ? "coche" : l.issue === "pasCochee" ? "retard" : "horloge"), h("span", null, l.statut || "Passé"))
    : h("span", { class: `heures-pq ${premier}` }, icone(ICONE_FAIT[premier] || "info"), h("span", null, insecable(l.pourquoi)));
  const contenu = [
    h("span", { class: "heures-h" }, l.ponctuel ? heure(l.debut) : `${heure(l.debut)} – ${heure(l.fin)}`),
    h("span", { class: "heures-corps" },
      h("span", { class: "heures-t" }, l.fait ? icone("coche") : rdv ? icone("cadenas") : h("span", { class: "point", "aria-hidden": "true" }), h("span", { class: "tt" }, l.titre),
        l.enCours ? h("span", { class: "pastille" }, "En cours") : null),
      l.projet || l.rang ? h("span", { class: "heures-p" }, l.projet || "", l.rang && !passe ? h("span", { class: "rang" }, `priorité n°${l.rang}`) : null) : null,
      sous),
    l.gerable ? icone("chevron", "heures-chevron") : null,
  ];
  const histo = !l.gerable && !l.source && vue.contexte?.aller && (sait("historique-v1") || sait("historique-v2"));
  const classes = `heures-ligne${l.enCours ? " encours" : ""}${l.menace ? " menace" : ""}${l.rien && !passe ? " rien" : ""}${passe ? " passe" : ""}${l.fait ? " fait" : ""}${histo ? " avec-histo" : ""}`;
  return h("li", { class: "heures-li" },
    h("button", {
      type: "button", class: classes, dataset: { cle: l.cle }, style: { "--couleur": couleurDe(l) },
      "aria-label": `${etiquetteBloc(l)}.${l.gerable ? " Ouvrir Gérer." : ""}`,
      onclick: () => ouvrirLigne(l.cle, "liste"),
      onpointerenter: () => survoler(l.cle),
      onpointerleave: () => survoler(null),
      onfocus: () => {
        vue.selection = l.cle;
        marquer();
      },
    }, contenu),
    histo
      ? bouton("Historique", { classe: "texte petit heures-histo", etiquette: `« ${l.titre} » dans l'Historique`, onclick: () => { vue.f.fermer(); vue?.contexte?.aller("projets/historique"); } })
      : null);
}

// --- Le côté : sur quel projet, et ce qui ne rentre pas ----------------------------

/** Sur quel projet, tranche par tranche (de maintenant à demain midi). */
function projets(v) {
  return h("div", { class: "heures-projets" },
    h("h3", { class: "heures-titre" }, "Sur quel projet", h("span", { class: "h" }, "jusqu'à demain midi")),
    v.tranches.map((t) => {
      const max = Math.max(1, ...t.projets.map((p) => p.minutes), t.minutesRdv);
      return h("div", { class: "heures-tranche" },
        h("p", { class: "heures-tranche-tete" }, h("strong", null, t.titre), h("span", { class: "h" }, heuresTranche(t))),
        t.projets.length || t.minutesRdv
          ? h("ul", { class: "ph-barres", "aria-label": `${t.titre} : ${phraseTranche(t)}` },
            t.projets.map((p) => barre(p.nom, p.minutes, max, couleurProjet(p.nom === "Sans projet" ? null : p.nom), p.rang)),
            t.minutesRdv ? barre("Rendez-vous", t.minutesRdv, max, "var(--encre-2)", null, true) : null)
          : h("p", { class: "aide" }, "Rien de placé"));
    }));
}

function barre(nom, minutes, max, couleur, rang, rdv = false) {
  return h("li", { class: `ph-barre${rdv ? " rdv" : ""}` },
    h("span", { class: "nom" }, h("span", { class: "n", title: nom }, nom), rang ? h("span", { class: "rang", title: `Ta priorité n°${rang}` }, `n°${rang}`) : null),
    h("span", { class: "jauge", "aria-hidden": "true" }, h("span", { style: { width: `${Math.max(4, Math.round((minutes / max) * 100))}%`, background: couleur } })),
    h("span", { class: "min" }, duree(minutes)));
}

/** Ce que Motion ne tient pas avant demain midi (pas placé, ou fini après l'échéance). */
function neRentrePas(v) {
  const motionOk = etat.semaine?.sources?.motion === "ok";
  if (!v.neRentrePas.length && !motionOk) return null;
  return h("div", { class: "heures-rentre" },
    h("h3", { class: "heures-titre" }, "Ne rentre pas avant demain midi"),
    v.neRentrePas.length
      ? h("ul", null, v.neRentrePas.map((t) => h("li", { class: "heures-rentre-ligne" }, icone("alerte"), h("span", null, h("strong", null, t.titre), h("span", { class: "d" }, t.texte)))))
      : h("p", { class: "aide" }, "Ce qui est dû d'ici là, Motion le place à temps."));
}
