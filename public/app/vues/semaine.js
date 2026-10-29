// Demain et les 7 jours (SemaineVues.swift, JourneeEtendue de Panneaux.swift) :
// sur l'accueil, une carte par jour (charge en mots, Chargée / Débordée, la
// jauge, les rendez-vous fixes, les échéances menacées qu'on ouvre dans
// « Gérer ») ; et la vue « À l'échelle », une grande feuille : Aujourd'hui |
// Demain | 7 jours, n'importe quel jour des 7 ouvert en frise à l'échelle avec
// sa charge et ses échéances, ← → pour le jour d'à côté (le glissement de
// l'iPhone). Tout vient de GET /api/semaine (Motion et l'agenda lus par la
// tour, sans IA), relu au plus une fois par minute sauf « Rafraîchir ».
import { api, sait } from "../api.js";
import { h, vider, icone, bouton, feuille, squelette, vide, texteErreur, occupe } from "../ui.js";
import { couleurProjet } from "../couleurs.js";
import { heure, finEffective, estRendezVous, etatMoment, jourISO, jourTitre } from "../analyse/journee.js";
import { niveauCharge, remplissage, phraseCharge, chargeDe, titreCourtJour, titreLongJour, estVide, menaceesDuJour, aSignaler, detailEcheance, resumeJour, ligneRendezVous, journeeDuJour, joursAffiches, demainISO, etatVue, notesSemaine, VIDES, heuresFrise, dansLeJour, couloirs, bornesJour } from "../analyse/semaine.js";
import { gerer, cochees } from "./gerer.js";

const PX = 1.5; // pixels par minute : 30 min = 45 px, une cible au doigt comme à la souris

/**
 * La carte de l'accueil et la vue « À l'échelle ». `journee()` : la journée
 * affichée (sans les cochées) ; `gestes(e)` : ce que « Gérer » reçoit depuis
 * Aujourd'hui. Rend { carte, maj({ frais }), dessiner(), ouvrir(portee) }.
 */
export function creerSemaine(ctx, { journee, gestes } = {}) {
  const carte = h("div", { class: "semaine-zone" });
  const etat = { donnees: null, misAJour: null, erreur: null, chargement: false };
  let lecture = null;
  let vue = null; // la feuille « À l'échelle » ouverte : { f, portee, ... }

  const disponible = () => sait("semaine-v1");
  const jours = () => joursAffiches(etat.donnees, Date.now(), cochees.ids());
  const jourDe = (iso) => jours().find((j) => j.jour === iso) || null;

  async function charger({ frais = false } = {}) {
    if (!disponible()) return dessiner();
    if (lecture) return lecture;
    if (!frais && etat.misAJour && Date.now() - etat.misAJour < 60e3) return;
    etat.chargement = true;
    lecture = api("/api/semaine?jours=7", { delai: 45000 })
      .then((s) => {
        etat.donnees = s;
        etat.misAJour = Date.now();
        etat.erreur = null;
      })
      .catch((err) => {
        etat.erreur = err;
      })
      .finally(() => {
        etat.chargement = false;
        lecture = null;
        dessiner();
      });
    dessiner(); // les squelettes, ou « Vue de 14:20, mise à jour… »
    return lecture;
  }

  // --- Ouvrir un élément dans « Gérer », avec les voisins de son jour ---
  function ouvrirElement(e, j) {
    vue?.f.fermer();
    const auj = jourISO();
    const jourVoisin = j && j.jour !== auj ? journeeDuJour(j) : journee?.() || null;
    const base = gestes ? gestes(e) : { contexte: ctx };
    gerer(e, { ...base, jour: jourVoisin });
  }
  /** Une échéance : la tâche telle que la frise la connaît (placée ce jour ou un autre), sinon comme une tâche à faire. */
  function ouvrirEcheance(t) {
    for (const j of jours()) {
      const e = (j.items || []).find((x) => x.type === "tache" && x.id === t.id);
      if (e) return ouvrirElement(e, j);
    }
    const e = (journee?.()?.items || []).find((x) => x.type === "tache" && x.id === t.id);
    if (e) return ouvrirElement(e, null);
    ouvrirElement({ ...t, type: "sans-creneau", debut: null, retard: t.echeance != null && t.echeance < Date.now() }, null);
  }

  // --- Les morceaux ---
  const jauge = (c) => {
    const n = niveauCharge(c);
    return h("div", { class: `semaine-jauge ${n}`, "aria-hidden": "true" }, h("span", { style: { width: `${Math.round(remplissage(c) * 100)}%`, minWidth: c.taches > 0 ? "6px" : "0" } }));
  };
  const badge = (c) => {
    const n = niveauCharge(c);
    if (n === "deborde") return h("span", { class: "risque" }, icone("alerte"), "Débordée");
    if (n === "charge") return h("span", { class: "pastille" }, "Chargée");
    return null;
  };
  const ligneEcheance = (t) => h("button", { type: "button", class: `semaine-echeance${t.menacee ? " menacee" : ""}`, onclick: () => ouvrirEcheance(t) },
    icone(t.menacee ? "alerte" : "drapeau"),
    h("span", { class: "textes" }, h("span", { class: "t" }, t.titre), h("span", { class: "d" }, detailEcheance(t))));

  /** Un jour en carte : l'en-tête ouvre ce jour à l'échelle, les menacées s'ouvrent dans « Gérer ». */
  function carteJour(j, ouvrirJour) {
    const c = chargeDe(j);
    const menacees = menaceesDuJour(j);
    const rdv = ligneRendezVous(j);
    const nom = j.jour === jourISO() ? "Aujourd'hui" : titreCourtJour(j);
    return h("div", { class: "semaine-jour" },
      h("button", { type: "button", class: "semaine-jour-tete", "aria-label": `${nom} : ${resumeJour(j)}. Ouvre ce jour à l'échelle.`, onclick: () => ouvrirJour(j.jour) },
        h("span", { class: "ligne-nom" }, h("strong", null, nom), badge(c), icone("chevron", "chevron-jour")),
        jauge(c),
        h("span", { class: "resume" }, resumeJour(j)),
        rdv ? h("span", { class: "rdv" }, icone("cadenas"), h("span", null, rdv)) : null,
        j.toute?.length ? h("span", { class: "toute" }, `Toute la journée : ${j.toute.map((t) => t.titre).join(" · ")}`) : null),
      menacees.slice(0, 2).map(ligneEcheance),
      menacees.length > 2 ? h("button", { type: "button", class: "semaine-plus", onclick: () => ouvrirJour(j.jour) }, `+ ${menacees.length - 2} autre${menacees.length > 3 ? "s" : ""} à surveiller`) : null);
  }

  /** Ce que dit la vue quand elle n'a pas (encore) de jours à montrer (EtatSemaine). */
  function etatSansJours(texteVide) {
    if (!disponible()) return vide(null, VIDES.pasAJour);
    if (!etat.donnees && (etat.chargement || !etat.erreur)) return h("div", { class: "semaine-squelettes" }, squelette([0.85, 0.6, 0.75]), squelette([0.7, 0.9]));
    if (etat.erreur && !etat.donnees) {
      const reseau = etat.erreur.nature === "reseau" || etat.erreur.nature === "delai";
      return vide(null, reseau ? VIDES.reseau : texteErreur(etat.erreur), bouton("Réessayer", { classe: "papier", icone: "rafraichir", onclick: (ev) => occupe(ev.currentTarget, () => charger({ frais: true })) }));
    }
    return vide(null, texteVide);
  }

  /** Le bandeau daté d'une vue gardée (BandeauSemaine). */
  function bandeauVue() {
    const t = etatVue(etat, Date.now());
    if (!t) return null;
    return h("div", { class: "semaine-bandeau", role: "status" }, icone(etat.erreur ? "alerte" : "horloge"), h("span", { class: "msg" }, t),
      etat.erreur ? bouton("Réessayer", { classe: "papier petit", icone: "rafraichir", onclick: (ev) => occupe(ev.currentTarget, () => charger({ frais: true })) }) : null);
  }

  // --- La carte de l'accueil : les jours qui viennent ---
  function dessinerCarte() {
    if (!disponible()) return vider(carte);
    const tete = h("h2", { class: "titre-section" }, "Demain et 7 jours",
      h("span", { class: "fin" }, bouton("À l'échelle", { classe: "texte petit", icone: "frise", etiquette: "À l'échelle : aujourd'hui, demain et les 7 jours", onclick: () => ouvrir("7jours") })));
    const suite = jours().filter((j) => j.jour !== jourISO());
    const corps = suite.length
      ? [bandeauVue(), h("div", { class: "semaine-cartes" }, suite.map((j) => carteJour(j, ouvrir))), ...notesSemaine(etat.donnees).map((n) => h("p", { class: `aide semaine-note${n.alerte ? " risque-texte" : ""}` }, n.texte))]
      : [bandeauVue(), etatSansJours(VIDES.semaine)];
    vider(carte, h("section", { class: "carte semaine-carte", "aria-label": "Demain et les 7 jours" }, tete, corps));
  }

  // --- La vue « À l'échelle » ---
  const portees = () => {
    const auj = jourISO();
    const dem = demainISO();
    const liste = jours().map((j) => j.jour);
    return liste.length ? liste : [auj, dem];
  };
  const normaliser = (p) => {
    if (p === "7jours" || p === "semaine") return "7jours";
    if (p === jourISO()) return "aujourdhui";
    if (p === demainISO()) return "demain";
    if (p === "aujourdhui" || p === "demain" || /^\d{4}-\d{2}-\d{2}$/.test(String(p))) return p;
    return "aujourdhui";
  };
  const estJour = (p) => /^\d{4}-\d{2}-\d{2}$/.test(p);

  function ouvrir(portee = "aujourdhui") {
    const p = normaliser(portee);
    if (vue) return aller(p);
    const corps = h("div", { class: "echelle-vue" });
    const retour = h("button", { type: "button", class: "btn texte icone echelle-retour", "aria-label": "Retour aux 7 jours", title: "Retour aux 7 jours", onclick: () => aller("7jours") }, icone("retour"));
    const f = feuille({
      titre: "À l'échelle", sousTitre: " ", contenu: corps, large: true, classe: "feuille-echelle",
      surFermeture: () => {
        vue = null;
      },
    });
    f.el.querySelector(".feuille-tete")?.prepend(retour);
    f.el.addEventListener("keydown", (ev) => {
      if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target?.tagName || "")) return;
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
        if (decaler(ev.key === "ArrowRight" ? 1 : -1)) ev.preventDefault();
      }
    });
    vue = { f, corps, retour, portee: p, defile: true };
    // Demain et les 7 jours : relus s'ils datent de plus d'une minute.
    if (p !== "aujourdhui") charger();
    dessinerVue();
    f.el.querySelector(".echelle-segment button[aria-pressed='true']")?.focus();
  }

  function aller(p) {
    if (!vue) return;
    vue.portee = normaliser(p);
    vue.defile = true;
    if (vue.portee !== "aujourdhui") charger();
    dessinerVue();
    vue?.f.el.querySelector(".echelle-segment button[aria-pressed='true']")?.focus();
  }

  /** Le jour d'à côté dans les 7 jours (rien depuis la vue des 7 jours). */
  function decaler(sens) {
    if (!vue || !disponible() || vue.portee === "7jours") return false;
    const auj = jourISO();
    const dem = demainISO();
    const actuel = vue.portee === "aujourdhui" ? auj : vue.portee === "demain" ? dem : vue.portee;
    const liste = portees();
    const i = liste.indexOf(actuel);
    const cible = liste[i + sens];
    if (i < 0 || !cible) return false;
    aller(cible === auj ? "aujourdhui" : cible === dem ? "demain" : cible);
    return true;
  }

  function dessinerVue() {
    if (!vue) return;
    const { f, corps, retour, portee } = vue;
    const dem = jourDe(demainISO());
    const j = estJour(portee) ? jourDe(portee) : null;
    const titre = portee === "aujourdhui" ? jourTitre(Date.now()) : portee === "demain" ? "Demain" : portee === "7jours" ? "Les 7 jours" : j ? titreLongJour(j) : portee;
    const sous = portee === "7jours" ? "Heures prévues sur tes heures libres" : portee === "demain" ? `${dem ? `${titreLongJour(dem)} · ` : ""}les durées sont à l'échelle` : "Les durées sont à l'échelle";
    const h2 = f.el.querySelector(".feuille-tete h2");
    if (h2) h2.textContent = titre;
    const p = f.el.querySelector(".feuille-tete .sous");
    if (p) p.textContent = sous;
    f.el.setAttribute("aria-label", titre);
    retour.hidden = !estJour(portee);
    const segment = disponible() ? h("div", { class: "echelle-segment", role: "group", "aria-label": "Portée" },
      [["aujourdhui", "Aujourd'hui"], ["demain", "Demain"], ["7jours", "7 jours"]].map(([id, lib]) => h("button", {
        type: "button", "aria-pressed": String(portee === id || (id === "7jours" && estJour(portee))),
        onclick: () => {
          if (portee !== id) aller(id);
        },
      }, lib))) : null;
    let contenu;
    if (portee === "aujourdhui") {
      contenu = frise(journee?.()?.items || [], bornesJour(Date.now()), { aujourdhui: true, vide: VIDES.aujourdhui, jour: null });
    } else if (portee === "7jours") {
      const liste = jours();
      contenu = h("div", null, bandeauVue(), liste.length
        ? [h("div", { class: "semaine-cartes" }, liste.map((x) => carteJour(x, aller))), ...notesSemaine(etat.donnees).map((n) => h("p", { class: `aide semaine-note${n.alerte ? " risque-texte" : ""}` }, n.texte))]
        : etatSansJours(VIDES.semaine));
    } else {
      const iso = portee === "demain" ? demainISO() : portee;
      const jj = jourDe(iso);
      contenu = h("div", null, bandeauVue(), jj && !estVide(jj)
        ? [resumeDuJour(jj), frise(jj.items || [], [jj.debut, Math.max(jj.debut + 3600e3, jj.fin ?? jj.debut + 86400e3)], { aujourdhui: false, vide: VIDES.frise, jour: jj })]
        : etatSansJours(portee === "demain" ? VIDES.demain : VIDES.jour));
    }
    vider(corps, segment, contenu, disponible() && portee !== "7jours" ? h("p", { class: "aide echelle-aide" }, "← → : le jour d'avant, le jour d'après.") : null);
    if (vue.defile) {
      vue.defile = false;
      requestAnimationFrame(() => defilerAuDebut());
    }
  }

  /** En tête d'un jour qui vient : sa charge, ce qui dure toute la journée, ses échéances (ResumeJour). */
  function resumeDuJour(j) {
    const c = chargeDe(j);
    return h("div", { class: "echelle-resume" },
      h("p", { class: "ligne-charge" }, h("span", null, phraseCharge(c)), niveauCharge(c) === "deborde" ? h("span", { class: "risque" }, icone("alerte"), "Débordée") : null),
      jauge(c),
      j.toute?.length ? h("p", { class: "toute" }, `Toute la journée : ${j.toute.map((t) => t.titre).join(" · ")}`) : null,
      aSignaler(j).slice(0, 3).map(ligneEcheance));
  }

  /** La frise à l'échelle d'un jour : de la première heure utile à la dernière (8 h – 22 h au moins), couloirs côte à côte. */
  function frise(items, bornes, { aujourdhui, vide: texteVide, jour }) {
    if (!items.length) return h("p", { class: "vide echelle-vide" }, texteVide);
    const dessines = items.map((e) => dansLeJour(e, bornes));
    const [h0, h1] = heuresFrise(dessines, bornes);
    const places = couloirs(dessines);
    const debutJ = bornes[0];
    const minDe = (ms) => (ms - debutJ) / 60e3;
    const m = Date.now();
    const zone = h("div", { class: "echelle echelle-grande", style: { height: `${(h1 - h0) * 60 * PX}px` } });
    for (let t = h0; t <= h1; t++) {
      const y = (t - h0) * 60 * PX;
      zone.append(h("div", { class: "trait-heure", style: { top: `${y}px` } }), h("span", { class: "heure-repere", dataset: { heure: String(t) }, style: { top: `${y}px` } }, `${String(t % 24).padStart(2, "0")}:00`));
    }
    dessines.forEach((d, i) => {
      const e = items[i];
      const p = places.get(`${d.type}:${d.id}`) || { index: 0, total: 1 };
      const top = (minDe(d.debut) - h0 * 60) * PX;
      const haut = Math.max(44, (finEffective(d) - d.debut) / 60e3 * PX - 2);
      const st = etatMoment(e, m);
      const rdv = estRendezVous(e);
      zone.append(h("button", {
        type: "button", class: `bloc ${rdv ? "rdv" : "tache"} ${st}${haut < 50 ? " court" : ""}${e.fait ? " faite" : ""}`,
        style: { top: `${top}px`, height: `${haut}px`, left: `calc(8px + (100% - 8px) * ${p.index / p.total})`, width: `calc((100% - 8px) / ${p.total} - 4px)`, "--couleur": rdv ? "var(--encre-2)" : couleurProjet(e.projet) },
        title: `${e.titre} · ${heure(e.debut)} – ${heure(finEffective(e))}`,
        onclick: () => ouvrirElement(e, jour),
      },
      h("span", { class: "t" }, rdv ? icone("cadenas") : null, e.titre, e.retard ? icone("alerte", "retard") : null),
      h("span", { class: "h" }, `${heure(e.debut)} – ${heure(finEffective(e))}`)));
    });
    if (aujourdhui) {
      const mn = minDe(m);
      if (mn >= h0 * 60 && mn <= h1 * 60) zone.append(h("div", { class: "maintenant-trait", style: { top: `${(mn - h0 * 60) * PX}px` }, title: `Maintenant · ${heure(m)}` }));
    }
    zone.dataset.premiere = String(h0);
    zone.dataset.depart = String(aujourdhui ? Math.floor(minDe(m) / 60) - 1 : Math.min(...dessines.map((d) => Math.floor(minDe(d.debut) / 60))) - 1);
    // La frise défile seule : le segment et le résumé du jour restent en vue.
    return h("div", { class: "echelle-defile", tabindex: "0", "aria-label": "La frise à l'échelle" }, zone);
  }

  /** Défilement initial : là où on en est aujourd'hui, le premier élément un autre jour. */
  function defilerAuDebut() {
    const corps = vue?.corps.querySelector(".echelle-defile");
    const zone = vue?.corps.querySelector(".echelle-grande");
    if (!corps || !zone) return;
    const h0 = Number(zone.dataset.premiere);
    const depart = Math.max(h0, Number(zone.dataset.depart));
    const repere = zone.querySelector(`.heure-repere[data-heure="${depart}"]`);
    if (repere) corps.scrollTop = Math.max(0, repere.getBoundingClientRect().top - corps.getBoundingClientRect().top + corps.scrollTop - 12);
  }

  function dessiner() {
    dessinerCarte();
    if (vue) dessinerVue();
  }

  return {
    carte,
    /** Après chaque lecture du tableau : relue au plus une fois par minute, sauf « Rafraîchir ». */
    maj({ frais = false } = {}) {
      dessinerCarte();
      return charger({ frais });
    },
    dessiner,
    ouvrir,
  };
}
