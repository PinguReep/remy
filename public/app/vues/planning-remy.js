// « Le planning de Rémy, à côté de celui de Motion » (12/11, planning-remy-v1) :
// une feuille large ouverte depuis la carte « Demain et 7 jours » ou Ctrl+K.
// D'abord les écarts qui comptent, une ligne de pourquoi chacun, et deux gestes
// pour juger (« Rémy a raison » / « Motion a raison »), gardés sur la tour avec
// la date ; puis le planning de Rémy jour par jour, chaque ligne avec sa raison.
//
// Rien n'est écrit chez Motion ni dans l'agenda : c'est un essai, à côté.
// Calculé par la tour à l'ouverture seulement (GET /api/planning-remy, sans IA,
// la liste Motion du cache), jamais en fond. Les mots sont dans
// analyse/planning-remy.js (testé sous node).
import { api, sait } from "../api.js";
import { h, vider, icone, bouton, feuille, squelette, vide, texteErreur, occupe, dire } from "../ui.js";
import { couleurProjet } from "../couleurs.js";
import { heure } from "../analyse/journee.js";
import { GENRES, planningLisible, messageEtat, phraseCompteur, partRemy, phraseTete, notes, parJour, ecartsTries, avecJugement, phraseJugement, heuresLigne } from "../analyse/planning-remy.js";

let vue = null; // { f, corps, contexte, donnees, erreur, chargement, envoi }

const insecable = (t) => String(t ?? "").replace(/« /g, "« ").replace(/ »/g, " »");

export const disponible = () => sait("planning-remy-v1");

async function charger() {
  if (!vue || vue.chargement) return;
  vue.chargement = true;
  dessiner();
  try {
    const b = await api("/api/planning-remy", { delai: 30000 });
    if (!vue) return;
    if (planningLisible(b)) {
      vue.donnees = b;
      vue.erreur = null;
    } else vue.erreur = { nature: "illisible", message: "La tour a rendu une réponse illisible." };
  } catch (err) {
    if (vue) vue.erreur = err;
  } finally {
    if (vue) {
      vue.chargement = false;
      dessiner();
    }
  }
}

/** Ouvre la feuille (une seule à la fois). */
export function ouvrir({ contexte } = {}) {
  if (vue) return;
  const corps = h("div", { class: "pr-vue" });
  const rafraichir = bouton("Recalculer", { classe: "papier", icone: "rafraichir", onclick: (ev) => occupe(ev.currentTarget, () => charger()) });
  const f = feuille({
    titre: "Le planning de Rémy", sousTitre: "À côté de celui de Motion · rien n'est écrit chez Motion", contenu: corps, large: true, classe: "feuille-planning-remy",
    pied: [h("span", { class: "aide" }, "Un essai : Motion reste ton planning."), rafraichir],
    surFermeture: () => {
      vue = null;
    },
  });
  vue = { f, corps, contexte, donnees: null, erreur: null, chargement: false, envoi: new Set() };
  f.el.setAttribute("tabindex", "-1");
  f.el.focus();
  charger();
}

export const estOuverte = () => Boolean(vue);

function dessiner() {
  if (!vue) return;
  const { corps, donnees: b, erreur } = vue;
  if (!disponible()) return vider(corps, vide("Pas encore sur ta tour", "Le planning de Rémy arrive avec la mise à jour de ta tour."));
  if (!b) {
    if (erreur && !vue.chargement) return vider(corps, blocErreur(erreur));
    return vider(corps, h("div", { class: "pr-squelettes" }, squelette([0.6, 0.9]), squelette([0.85, 0.7, 0.5]), squelette([0.75, 0.6])));
  }
  const m = messageEtat(b);
  if (m) {
    return vider(corps, vide(m.titre, m.texte, m.reglages && vue.contexte?.aller
      ? bouton("Ouvrir les Réglages", { classe: "papier", icone: "reglages", onclick: () => { vue?.f.fermer(); vue?.contexte?.aller("reglages/remy"); } })
      : bouton("Réessayer", { classe: "papier", icone: "rafraichir", onclick: (ev) => occupe(ev.currentTarget, () => charger()) })));
  }
  const tri = ecartsTries(b.ecarts);
  vider(corps,
    erreur ? h("div", { class: "semaine-bandeau", role: "status" }, icone("alerte"), h("span", { class: "msg" }, `Pas pu recalculer : ${texteErreur(erreur)} Planning de ${heure(b.calculeA)}.`)) : null,
    h("p", { class: "pr-tete" }, phraseTete(b)),
    compteur(b.jugements),
    notes(b).map((n) => h("p", { class: `pr-note${n.alerte ? " risque-texte" : ""}` }, icone(n.alerte ? "alerte" : "info"), h("span", null, n.texte))),
    h("section", { class: "pr-ecarts", "aria-label": "Les écarts" },
      h("h3", { class: "pr-titre" }, "Les écarts"),
      tri.length ? h("ul", { class: "pr-liste" }, tri.map(carteEcart)) : vide(null, "Aucun écart qui compte entre les deux plannings.")),
    h("section", { class: "pr-planning", "aria-label": "Le planning de Rémy" },
      h("h3", { class: "pr-titre" }, "Le planning de Rémy, et pourquoi"),
      planning(b)),
    b.remy.nonPlaces.length ? h("section", { class: "pr-non", "aria-label": "Ce que Rémy ne place pas" },
      h("h3", { class: "pr-titre" }, "Ce que Rémy ne place pas"),
      h("ul", { class: "pr-lignes" }, b.remy.nonPlaces.map((x) => h("li", { class: "pr-ligne" }, h("span", { class: "t" }, x.titre), h("span", { class: "r" }, insecable(x.raison)))))) : null,
    h("details", { class: "pr-regles" },
      h("summary", null, "Les règles de Rémy, et ce qu'il ne sait pas faire"),
      h("ol", null, (b.regles || []).map((r) => h("li", null, r.nom))),
      h("ul", null, (b.limites || []).map((l) => h("li", null, l)))));
}

function compteur(j) {
  const part = partRemy(j);
  return h("div", { class: "pr-compteur", role: "status" },
    h("p", null, phraseCompteur(j)),
    part === null ? null : h("div", { class: "pr-barre", "aria-hidden": "true" }, h("span", { style: { width: `${Math.round(part * 100)}%` } })),
    j?.lisibles === false ? h("p", { class: "risque-texte" }, "Les jugements gardés sur la tour sont illisibles : un nouveau jugement serait refusé, rien n'est écrasé.") : null);
}

function carteEcart(e) {
  const g = GENRES[e.genre] || { titre: "Écart", icone: "info" };
  const choix = (verdict, libelle) => h("button", {
    type: "button", class: `btn papier pr-juge${e.jugement?.verdict === verdict ? " choisi" : ""}`, "aria-pressed": String(e.jugement?.verdict === verdict),
    disabled: vue.envoi.has(e.id) ? "" : null,
    onclick: () => juger(e, e.jugement?.verdict === verdict ? null : verdict),
  }, e.jugement?.verdict === verdict ? icone("coche") : null, libelle);
  return h("li", { class: `pr-ecart ${e.genre}${e.jugement ? " juge" : ""}`, dataset: { ecart: e.id } },
    h("p", { class: "pr-genre" }, icone(g.icone), h("span", null, g.titre)),
    h("p", { class: "pr-nom" }, e.titre),
    h("p", { class: "pr-pourquoi" }, insecable(e.pourquoi)),
    h("dl", { class: "pr-deux" },
      h("div", null, h("dt", null, "Rémy"), h("dd", null, insecable(e.remy))),
      h("div", null, h("dt", null, "Motion"), h("dd", null, insecable(e.motion)))),
    h("div", { class: "pr-gestes", role: "group", "aria-label": `Qui a raison : ${e.titre}` },
      choix("remy", "Rémy a raison"), choix("motion", "Motion a raison")),
    e.jugement ? h("p", { class: "aide pr-juge-le" }, phraseJugement(e.jugement), " Un clic sur ton choix l'annule.") : null);
}

async function juger(e, verdict) {
  if (!vue || vue.envoi.has(e.id)) return;
  vue.envoi.add(e.id);
  // Seule la carte se redessine (le reste de la feuille et le défilement ne bougent pas).
  const remplacer = () => {
    if (!vue) return;
    const actuel = vue.donnees.ecarts.find((x) => x.id === e.id) || e;
    const li = [...vue.corps.querySelectorAll("li.pr-ecart")].find((x) => x.dataset.ecart === e.id);
    const neuf = carteEcart(actuel);
    if (li) {
      const focus = li.contains(document.activeElement) ? document.activeElement.textContent : null;
      li.replaceWith(neuf);
      if (focus) [...neuf.querySelectorAll("button")].find((x) => x.textContent === focus)?.focus();
    }
    vue.corps.querySelector(".pr-compteur")?.replaceWith(compteur(vue.donnees.jugements));
    const tete = vue.corps.querySelector(".pr-tete");
    if (tete) tete.textContent = phraseTete(vue.donnees);
  };
  remplacer();
  try {
    const r = await api("/api/planning-remy/jugements", { methode: "POST", corps: { ecart: e.id, verdict, resume: e.titre }, delai: 15000 });
    if (!vue) return;
    vue.donnees = { ...vue.donnees, ecarts: avecJugement(vue.donnees.ecarts, e.id, r?.jugement || null), jugements: { ...vue.donnees.jugements, ...(r?.compte || {}) } };
    dire(verdict === null ? "Jugement retiré." : verdict === "remy" ? "Noté : Rémy a raison." : "Noté : Motion a raison.", { genre: "succes", duree: 2000 });
  } catch (err) {
    dire(`Jugement non gardé : ${texteErreur(err)}`, { genre: "erreur" });
  } finally {
    if (vue) {
      vue.envoi.delete(e.id);
      remplacer();
    }
  }
}

function planning(b) {
  const jours = parJour(b.remy.placements);
  if (!jours.length) return vide(null, "Rémy n'a rien pu placer dans tes horaires des 14 jours qui viennent.");
  return h("div", { class: "pr-jours" }, jours.map((j) => h("div", { class: "pr-jour" },
    h("p", { class: "pr-jour-titre" }, j.titre),
    h("ul", { class: "pr-lignes" }, j.lignes.map((p) => {
      const hh = heuresLigne(p, heure);
      return h("li", { class: `pr-ligne${p.alerte ? " alerte" : ""}`, style: { "--couleur": couleurProjet(p.projet) } },
      h("span", { class: "h" }, hh.premier),
      h("span", { class: "t" }, p.titre),
      h("span", { class: "r" }, insecable(p.raison)),
      hh.suite ? h("span", { class: "r" }, hh.suite) : null,
      p.alerte ? h("span", { class: "r risque-texte" }, icone("alerte"), insecable(p.alerte)) : null);
    })))));
}

function blocErreur(err) {
  const reseau = err?.nature === "reseau" || err?.nature === "delai";
  return vide(reseau ? "Tour injoignable" : "Pas pu calculer le planning de Rémy",
    reseau ? "La tour ne répond pas : Tailscale est-il actif ?" : texteErreur(err),
    bouton("Réessayer", { classe: "papier", icone: "rafraichir", onclick: (ev) => occupe(ev.currentTarget, () => charger()) }));
}
