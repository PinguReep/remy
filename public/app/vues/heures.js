// « Prochaines heures » (12/11) : une feuille large, variante d'« À
// l'échelle », ouverte par H (ou Ctrl+K), refermée par Échap, un clic sur le
// fond, ou H de nouveau. Lecture seule. De maintenant à demain midi : une
// frise (la nuit vide resserrée), les rendez-vous et les tâches dans l'ordre
// où Motion les a placés avec UNE ligne de « pourquoi » tirée des faits, les
// minutes par projet et par tranche, et ce qui ne rentre pas avant demain midi
// d'après Motion. Les calculs sont dans analyse/heures.js (testé sous node).
//
// Données : GET /api/semaine?jours=2 (sans IA, Motion lu depuis le cache de
// la tour) et GET /api/priorites. Jamais /api/dashboard (il peut relancer le
// conseil réfléchi). Relues au plus une fois par minute à l'ouverture, toutes
// les 5 min si la feuille reste ouverte ; l'heure, elle, avance chaque minute.
import { api, sait } from "../api.js";
import { h, vider, icone, bouton, feuille, squelette, vide, texteErreur, occupe } from "../ui.js";
import { couleurProjet } from "../couleurs.js";
import { heure, duree, jourTitre } from "../analyse/journee.js";
import { etatVue } from "../analyse/semaine.js";
import { prochainesHeures, echelleFrise, phraseTranche, heuresTranche, phraseTete, semaineLisible } from "../analyse/heures.js";
import { cochees } from "./gerer.js";

const FRAIS_MS = 60e3;
const RELIRE_OUVERTE_MS = 5 * 60e3;

const etat = { semaine: null, priorites: [], misAJour: null, erreur: null, chargement: false };
let lecture = null;
let vue = null; // { f, corps, minuteur, contexte }

const ICONE_FAIT = { fixe: "cadenas", menace: "alerte", priorite: "etoile", echeance: "drapeau", motion: "fleche", debut: "calendrier", attente: "pause", rien: "question" };

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
  const f = feuille({
    titre: "Prochaines heures", sousTitre: " ", contenu: corps, large: true, classe: "feuille-echelle feuille-heures",
    pied: [h("span", { class: "aide heures-aide" }, "H ou Échap : fermer"), rafraichir],
    surFermeture: () => {
      clearInterval(vue?.minuteur);
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
  vue = { f, corps, contexte, minuteur: null };
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
  const m = Date.now();
  const { f, corps } = vue;
  const sous = f.el.querySelector(".feuille-tete .sous");
  if (sous) sous.textContent = `${jourTitre(m)}, ${heure(m)} · jusqu'à demain midi`;
  if (!sait("semaine-v1")) {
    vider(corps, vide(null, "Prochaines heures arrive avec la mise à jour de ta tour (scripts/installer-tour.ps1)."));
    return;
  }
  if (!etat.semaine) {
    if (etat.erreur && !etat.chargement) return vider(corps, blocErreur(etat.erreur));
    return vider(corps, squelettes());
  }
  const v = prochainesHeures({ semaine: etat.semaine, priorites: etat.priorites, maintenant: m, cochees: cochees.ids() });
  const bandeau = etatVue(etat, m);
  const notes = v.notes.map((n) => h("p", { class: `heures-note${n.alerte ? " risque-texte" : ""}` }, icone(n.alerte ? "alerte" : "info"), h("span", null, n.texte),
    n.reglage && vue.contexte?.aller ? bouton("Ce qui compte", { classe: "texte petit", onclick: () => { f.fermer(); vue?.contexte?.aller("reglages/priorites"); } }) : null));
  const tete = [
    bandeau ? h("div", { class: "semaine-bandeau", role: "status" }, icone(etat.erreur ? "alerte" : "horloge"), h("span", { class: "msg" }, bandeau)) : null,
  ];
  if (v.vide) {
    vider(corps, tete, vide("Rien de prévu d'ici demain midi", "Ni rendez-vous, ni tâche placée par Motion."), v.toute.length ? h("p", { class: "aide" }, `Toute la journée : ${v.toute.join(" · ")}`) : null, notes);
    return;
  }
  const phrase = phraseTete(v, m);
  vider(corps,
    tete,
    phrase ? h("p", { class: "heures-tete" }, phrase) : null,
    h("p", { class: "aide heures-regle" }, "Motion décide de l'ordre. Sous chaque ligne : ce que ses données en disent, et la priorité qu'elle sert."),
    frise(v),
    v.toute.length ? h("p", { class: "aide heures-toute" }, `Toute la journée : ${v.toute.join(" · ")}`) : null,
    notes,
    h("div", { class: "heures-grille" },
      h("section", { class: "heures-cote", "aria-label": "Sur quel projet" }, projets(v), neRentrePas(v)),
      h("section", { class: "heures-liste", "aria-label": "Dans l'ordre de Motion" }, v.tranches.filter((t) => t.lignes.length).map(groupe))));
}

function squelettes() {
  return h("div", { class: "heures-squelettes" },
    h("div", { class: "heures-frise squelette-frise", "aria-hidden": "true" }),
    squelette([0.7, 0.5]), squelette([0.85, 0.6, 0.75]), squelette([0.6, 0.8]));
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

/** La frise de maintenant à demain midi : les blocs à l'échelle, la nuit resserrée, les tranches dessous. */
function frise(v) {
  const g = echelleFrise(v.lignes, v.debut, v.fin);
  const pct = (x) => `${(x * 100).toFixed(3)}%`;
  const zone = h("div", { class: "heures-frise", "aria-hidden": "true" });
  for (const r of g.heures) zone.append(h("span", { class: `heures-repere${r.majeure ? " majeure" : ""}`, style: { left: pct(r.x) } }, h("span", null, r.libelle)));
  if (g.nuit) zone.append(h("span", { class: "heures-nuit", style: { left: pct(g.nuit.x0), width: pct(g.nuit.x1 - g.nuit.x0) } }, h("span", null, "nuit")));
  for (const l of v.lignes) {
    const x0 = g.pos(Math.max(l.debut, v.debut));
    const x1 = g.pos(Math.min(l.fin, v.fin));
    zone.append(h("span", {
      class: `heures-bloc ${l.type}${l.menace ? " menace" : ""}${l.enCours ? " encours" : ""}`,
      style: { left: pct(x0), width: `max(4px, calc(${pct(x1 - x0)} - 2px))`, "--couleur": l.type === "rdv" ? "var(--encre-2)" : couleurProjet(l.projet) },
      title: `${l.titre} · ${heure(l.debut)} – ${heure(l.fin)}`,
    }));
  }
  zone.append(h("span", { class: "heures-maintenant" }));
  const bandes = h("div", { class: "heures-bandes", "aria-hidden": "true" }, v.tranches.map((t) => {
    const x0 = g.pos(t.debut);
    const x1 = g.pos(t.fin);
    return h("span", { class: "heures-bande", style: { left: pct(x0), width: pct(x1 - x0) } }, h("span", null, t.titre));
  }));
  return h("div", { class: "heures-frise-zone" }, zone, bandes);
}

/** Sur quel projet, tranche par tranche. */
function projets(v) {
  return h("div", { class: "heures-projets" },
    h("h3", { class: "heures-titre" }, "Sur quel projet"),
    v.tranches.map((t) => {
      const max = Math.max(1, ...t.projets.map((p) => p.minutes), t.minutesRdv);
      return h("div", { class: "heures-tranche" },
        h("p", { class: "heures-tranche-tete" }, h("strong", null, t.titre), h("span", { class: "h" }, heuresTranche(t))),
        t.projets.length || t.minutesRdv
          ? h("ul", { class: "heures-barres", "aria-label": `${t.titre} : ${phraseTranche(t)}` },
            t.projets.map((p) => barre(p.nom, p.minutes, max, couleurProjet(p.nom === "Sans projet" ? null : p.nom), p.rang)),
            t.minutesRdv ? barre("Rendez-vous", t.minutesRdv, max, "var(--encre-2)", null, true) : null)
          : h("p", { class: "aide" }, "Rien de placé"));
    }));
}

function barre(nom, minutes, max, couleur, rang, rdv = false) {
  return h("li", { class: `heures-barre${rdv ? " rdv" : ""}` },
    h("span", { class: "nom" }, nom, rang ? h("span", { class: "rang", title: `Ta priorité n°${rang}` }, `n°${rang}`) : null),
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

/** Une tranche de la liste : son titre, puis ses lignes dans l'ordre de Motion. */
function groupe(t) {
  return h("div", { class: "heures-groupe" },
    h("h3", { class: "heures-titre" }, t.titre, h("span", { class: "h" }, heuresTranche(t))),
    h("ol", { class: "heures-lignes" }, t.lignes.map(ligne)));
}

function ligne(l) {
  const premier = l.faits[0]?.genre || "rien";
  const rdv = l.type === "rdv";
  return h("li", { class: `heures-ligne${l.enCours ? " encours" : ""}${l.menace ? " menace" : ""}${l.rien ? " rien" : ""}`, style: { "--couleur": rdv ? "var(--encre-2)" : couleurProjet(l.projet) } },
    h("span", { class: "heures-h" }, `${heure(l.debut)} – ${heure(l.fin)}`),
    h("span", { class: "heures-corps" },
      h("span", { class: "heures-t" }, rdv ? icone("cadenas") : h("span", { class: "point", "aria-hidden": "true" }), h("span", { class: "tt" }, l.titre),
        l.enCours ? h("span", { class: "pastille" }, "En cours") : null),
      l.projet || l.rang ? h("span", { class: "heures-p" }, l.projet || "", l.rang ? h("span", { class: "rang" }, `priorité n°${l.rang}`) : null) : null,
      h("span", { class: `heures-pq ${premier}` }, icone(ICONE_FAIT[premier] || "info"), h("span", null, l.pourquoi))));
}
