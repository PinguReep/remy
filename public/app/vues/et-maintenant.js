// « Et maintenant ? » (EtMaintenant et ChoixTache de l'iPhone) : après la
// tâche du moment, une petite carte en bas à droite propose discrètement la
// suivante (« Commencer « X » », « Continuer », « Ouvrir ») ou « Choisir… »
// parmi aujourd'hui, en retard et cette semaine. Elle ne prend pas le focus
// (Tab l'atteint), part seule après 15 s, Échap ou la croix la ferment.
// Rien ne démarre sans un clic.
import { api, sait } from "../api.js";
import { h, vider, icone, bouton, feuille, squelette, texteErreur } from "../ui.js";
import { suivante, candidatsChoix, etatMoment } from "../analyse/journee.js";
import { gerer, commencer } from "./gerer.js";

let carte = null;
let minuteur = null;

function fermer() {
  clearTimeout(minuteur);
  document.removeEventListener("keydown", surTouche);
  carte?.remove();
  carte = null;
}
function surTouche(ev) {
  if (ev.key !== "Escape" || document.querySelector("dialog[open]")) return;
  fermer();
}

/** « Gérer » d'une tâche proposée (celle de la journée, ou une tâche sans créneau). */
const ouvrirTache = (c, { ouvrir, apres, contexte }) => {
  const e = c.item || { type: "sans-creneau", id: c.id, titre: c.titre, debut: null, duree: c.duree };
  if (ouvrir) ouvrir(e);
  else gerer(e, { apres, contexte });
};

/**
 * Propose la suite après « « T » terminée ». `journee()` : la journée affichée
 * (sans les cochées) ; `ouvrir(e)` : « Gérer » ; `apres()` : relire.
 */
export function proposerSuite(terminee, { journee, ouvrir, apres, contexte } = {}) {
  fermer();
  const m = Date.now();
  const j = typeof journee === "function" ? journee() : journee;
  const s = suivante(j, m);
  const peutCommencer = sait("taches-etat-v2");
  const options = { ouvrir, apres, contexte };
  let principal = null;
  if (s) {
    const enCours = s.item ? etatMoment(s.item, m) === "encours" : false;
    if (enCours) principal = bouton(`Continuer « ${s.titre} »`, { classe: "plein", icone: "curseurs", onclick: () => { fermer(); ouvrirTache(s, options); } });
    else if (peutCommencer) principal = bouton(`Commencer « ${s.titre} »`, { classe: "plein", icone: "lecture", onclick: () => { fermer(); commencer(s, { apres }); } });
    else principal = bouton(`Ouvrir « ${s.titre} »`, { classe: "plein", icone: "curseurs", onclick: () => { fermer(); ouvrirTache(s, options); } });
  }
  const choisir = bouton("Choisir…", { classe: s ? "papier" : "plein", onclick: () => { fermer(); ouvrirChoix({ journee, ...options }); } });
  carte = h("section", { class: "maintenant-suite", role: "region", "aria-label": "Et maintenant ?" },
    h("div", { class: "maintenant-suite-tete" },
      h("p", null, `« ${terminee} » terminée. Et maintenant ?`),
      h("button", { type: "button", class: "btn-fermer", "aria-label": "Fermer", onclick: fermer }, h("span", null, icone("fermer")))),
    h("div", { class: "rangee serree" }, principal, choisir));
  (document.querySelector(".contenu") || document.body).append(carte);
  document.addEventListener("keydown", surTouche);
  minuteur = setTimeout(fermer, 15e3);
  return carte;
}

/** La feuille « Et maintenant ? » : aujourd'hui, en retard, puis cette semaine (GET /api/projets). */
export function ouvrirChoix({ journee, ouvrir, apres, contexte } = {}) {
  const peutCommencer = sait("taches-etat-v2");
  const corps = h("div", { class: "maintenant-choix" });
  const f = feuille({ titre: "Et maintenant ?", contenu: corps, classe: "feuille-choix" });
  const options = { ouvrir, apres, contexte };
  let projets = null;
  let erreurProjets = null;
  const choisirTache = (c) => {
    f.fermer();
    if (peutCommencer) commencer(c, { apres });
    else ouvrirTache(c, options);
  };
  const ligne = (c) => h("button", {
    type: "button", class: "gerer-ligne", disabled: !peutCommencer && !c.item ? true : null,
    onclick: () => choisirTache(c),
  }, icone(peutCommencer ? "lecture" : "curseurs"), h("span", { class: "textes" }, h("strong", null, c.titre), h("span", { class: "detail" }, c.detail)), icone("chevron", "chevron-ligne"));
  const section = (titre, liste) => (liste.length ? h("section", { class: "groupe-gestes" }, h("h3", { class: "titre-section" }, titre), h("div", { class: "gerer-lignes" }, liste.map(ligne))) : null);
  const dessiner = () => {
    const j = typeof journee === "function" ? journee() : journee;
    const c = candidatsChoix(j, projets || [], Date.now());
    const enAttente = projets === null && !erreurProjets && sait("projets-v1");
    vider(corps,
      !peutCommencer ? h("p", { class: "aide" }, "« Commencer » arrivera avec la mise à jour de ta tour ; d'ici là, une tâche placée s'ouvre dans « Gérer ».") : null,
      section("Aujourd'hui", c.aujourdhui),
      section("En retard", c.retard),
      enAttente ? h("section", { class: "groupe-gestes" }, h("h3", { class: "titre-section" }, "Cette semaine"), squelette([0.7, 0.5])) : section("Cette semaine", c.semaine),
      erreurProjets ? h("p", { class: "aide" }, `Cette semaine : les projets n'ont pas pu être lus (${texteErreur(erreurProjets).replace(/[.\s]+$/, "")}).`) : null,
      !enAttente && !c.aujourdhui.length && !c.retard.length && !c.semaine.length ? h("p", { class: "vide" }, "Rien d'autre à proposer : Motion n'a plus de tâche ouverte pour toi.") : null);
  };
  dessiner();
  corps.querySelector("button:not([disabled])")?.focus();
  if (sait("projets-v1")) {
    api("/api/projets", { delai: 20000 })
      .then((r) => { projets = r?.projets || []; })
      .catch((err) => { erreurProjets = err; })
      .finally(() => { if (f.el.isConnected) dessiner(); });
  }
  return f;
}
