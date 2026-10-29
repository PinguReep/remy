// « Ajuster l'ajout » / « Ajuster la modification » : régler une ligne d'une
// proposition de Rémy avant de dire oui (le port d'AjusterAction.swift) —
// nom, quand (avec raccourcis), durée, priorité, catégorie, ou en faire un
// rappel plutôt qu'une tâche Motion. Pour Motion ET pour l'agenda. Rien ne
// part dans Motion ni dans le fil : la tour garde la version ajustée, et
// « Oui, fais-le » enverra celle-là. Seuls les champs changés partent.
// « Ranger en rappel » : d'abord la ligne sort de la proposition (ajuster
// { convertis }), PUIS le rappel est noté — jamais un rappel en double d'une
// tâche qui partirait quand même.
import { api, ecrire, seg, sait, natureEchec } from "../api.js";
import { h, vider, icone, bouton, dire, feuille, versChampDate, depuisChampDate, texteErreur } from "../ui.js";
import { echeanceDans } from "../analyse/dates.js";
import { etiquetteDevinee } from "../analyse/etiquettes.js";
import { isoAvecFuseau, duree as enMots, jourSemaineCourt, heure } from "../analyse/rangement.js";
import * as fileEnvoi from "../file-envoi.js";

export const DUREES = [5, 10, 15, 30, 45, 60, 90, 120];
export const PRIORITES = [["ASAP", "Urgente"], ["HIGH", "Importante"], ["MEDIUM", "Normale"], ["LOW", "Basse"]];
export const RACCOURCIS = [["Aujourd'hui", 0], ["Demain", 1], ["Dans 3 jours", 3], ["Dans 1 semaine", 7]];

const dateISO = (s) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? new Date(t) : null;
};
const debutJour = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const memeJour = (a, b) => debutJour(a).getTime() === debutJour(b).getTime();
/** Demain 9 h (un rendez-vous sans date). */
export function demainNeufHeures(maintenant = new Date()) {
  const d = debutJour(maintenant);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0, 0, 0);
}
/** Un raccourci de jour : change le jour, garde l'heure choisie. */
export function avecJour(quand, jours, maintenant = new Date()) {
  const j = debutJour(maintenant);
  return new Date(j.getFullYear(), j.getMonth(), j.getDate() + jours, quand.getHours(), quand.getMinutes(), 0, 0);
}
/** Une échéance « avant demain soir » devient un rappel à une heure où l'on est debout. */
export const versRappel = (quand) => (quand.getHours() >= 21 ? new Date(quand.getFullYear(), quand.getMonth(), quand.getDate(), 9, 0, 0, 0) : quand);

/** L'état de départ de la feuille, lu dans l'action proposée. */
export function etatInitial(a, { versAgenda = false, maintenant = new Date() } = {}) {
  const creation = a?.type === "creer";
  const nom = creation ? (a.nom ?? a.titre ?? "") : (a.nouveau_nom ?? a.nouveau_titre ?? a.nom ?? a.titre ?? "");
  const q = dateISO(versAgenda ? a?.debut : a?.echeance);
  let d = a?.duree != null && /^\d+$/.test(String(a.duree)) ? Number(a.duree) : null;
  if (versAgenda && d == null) {
    const debut = dateISO(a?.debut);
    const fin = dateISO(a?.fin);
    if (debut && fin) d = Math.round((fin - debut) / 60000);
  }
  const priorite = a?.priorite ? String(a.priorite).toUpperCase() : null;
  return {
    creation,
    initial: { nom, quand: q, duree: d, priorite, etiquettes: new Set(a?.etiquettes || []) },
    nom,
    avecDate: q != null || versAgenda,
    quand: q ?? (versAgenda ? demainNeufHeures(maintenant) : echeanceDans(1, maintenant)),
    duree: d,
    priorite: priorite ?? "MEDIUM",
    etiquettes: new Set(a?.etiquettes || []),
  };
}

const memeDate = (a, b) => (a == null && b == null) || (a != null && b != null && a.getTime() === b.getTime());
const memeEnsemble = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Seuls les champs changés partent ; `echeance: null` l'enlève. Clés : nom /
 * nouveau_nom (Motion), titre / nouveau_titre (agenda), echeance, duree,
 * priorite, etiquettes ; pour l'agenda, debut + fin (début + durée, 60 min par défaut).
 */
export function champsChanges(e, { versAgenda = false, categoriesPossibles = false, etiquettesValides = [...e.etiquettes] } = {}) {
  const c = {};
  const init = e.initial;
  const nom = String(e.nom || "").trim();
  if (nom !== init.nom) c[versAgenda ? (e.creation ? "titre" : "nouveau_titre") : (e.creation ? "nom" : "nouveau_nom")] = nom;
  const voulue = e.avecDate ? e.quand : null;
  if (versAgenda) {
    const d = e.duree ?? 60;
    if ((!memeDate(voulue, init.quand) || e.duree !== init.duree) && voulue) {
      c.debut = isoAvecFuseau(voulue);
      c.fin = isoAvecFuseau(new Date(voulue.getTime() + d * 60000));
    }
  } else {
    if (!memeDate(voulue, init.quand)) c.echeance = voulue ? isoAvecFuseau(voulue) : null;
    if (e.duree !== init.duree && e.duree != null) c.duree = e.duree;
    if (e.priorite !== (init.priorite ?? "MEDIUM")) c.priorite = e.priorite;
    if (categoriesPossibles && !memeEnsemble(new Set(etiquettesValides), init.etiquettes)) c.etiquettes = etiquettesValides;
  }
  return c;
}

/** « Rangé en rappel, mer. 30 oct. 09:00. » / « Rangé en rappel, sans date. » */
export const phraseRangeEnRappel = (quand) => (quand ? `Rangé en rappel, ${jourSemaineCourt(quand)} ${heure(quand)}.` : "Rangé en rappel, sans date.");

let etiquettesConnues = null;
async function lireEtiquettes() {
  if (!etiquettesConnues) etiquettesConnues = (await api("/api/etiquettes", { delai: 10000 }))?.etiquettes || [];
  return etiquettesConnues;
}

/** Une erreur d'ajustement : dite, et la conversation relue après un 409 (l'état réel). */
function direEchec(err, relire) {
  if (err?.nature === "auth") return "auth";
  if (err?.statut === 409) {
    dire(err.message, { genre: "erreur" });
    relire?.();
    return "relu";
  }
  dire(`Pas ajusté : ${texteErreur(err)}`, { genre: "erreur" });
  return "dit";
}

/** Envoie l'ajustement et met la proposition à jour (actions ajustées par la tour). */
async function envoyerAjustement(p, c, corps) {
  const r = await ecrire(`/api/conversations/${seg(c.id)}/propositions/${seg(p.id)}/ajuster`, corps);
  if (!p.actionsOrigine) p.actionsOrigine = p.actions;
  p.actions = Array.isArray(r?.actions) ? r.actions : p.actions;
  p.ajustee = true;
  // Ajustée, la tour la remet à neuf ; une date encore passée rendra 409 « perimee » au « Oui ».
  delete p.perimee;
  delete p.raisonPeremption;
  if (r?.statut === "converti") p.statut = "converti";
  p._decoches = new Set();
  return r;
}

/**
 * Ouvre la feuille pour la ligne `a` (rang `rang`) de la proposition `p` de la
 * conversation `c`. `apres()` redessine la carte ; `relire()` relit la
 * conversation ; `ctx.aller` pour « Créer tes catégories ».
 */
export function ouvrirAjuster({ p, c, a, rang, versAgenda = false, apres, relire, ctx } = {}) {
  if (!p?.id || !c?.id) {
    dire("Cette proposition ne peut pas être ajustée : redemande-la à Rémy.", { genre: "erreur" });
    return Promise.resolve(false);
  }
  const e = etatInitial(a, { versAgenda });
  let forme = "tache";
  let envoi = false;
  let categoriesTouchees = false;
  let etiquettes = etiquettesConnues;
  const rappelPossible = e.creation && !versAgenda && sait("rappels-v1");
  const enRappel = () => forme === "rappel";
  const categoriesPossibles = () => !versAgenda && (enRappel() || sait("categories-taches-v1"));
  const etiquettesValides = () => (etiquettes ? etiquettes.map((x) => x.id).filter((id) => e.etiquettes.has(id)) : [...e.etiquettes]);
  const nomPropre = () => String(nom.value || "").trim();
  const champs = () => {
    e.nom = nom.value;
    return champsChanges(e, { versAgenda, categoriesPossibles: categoriesPossibles(), etiquettesValides: etiquettesValides() });
  };

  const nom = h("textarea", { class: "champ", rows: 2, id: "ajuster-nom", "aria-label": "Nom", autocomplete: "off" });
  nom.value = e.nom;
  const sections = h("div", { class: "ajuster-sections" });
  const principal = bouton("Enregistrer", { classe: "plein", icone: "coche", type: "submit" });
  const note = h("span", { class: "aide ajuster-note" });
  const annuler = bouton("Annuler", { classe: "papier", onclick: () => f.fermer(false) });

  const puce = (libelle, actif, faire, { cle, role = null } = {}) => {
    const b = h("button", { type: "button", class: "puce", "aria-pressed": role ? null : String(actif), role, "aria-checked": role ? String(actif) : null, dataset: { cle } }, libelle);
    b.addEventListener("click", () => {
      faire();
      dessiner(cle);
    });
    return b;
  };
  const section = (titre, contenu, pied) => h("section", { class: "ajuster-section" }, titre ? h("h3", { class: "titre-section" }, titre) : null, contenu, pied ? h("p", { class: "aide" }, pied) : null);

  const champDate = h("input", { class: "champ", type: "datetime-local", id: "ajuster-quand" });
  champDate.addEventListener("change", () => {
    const d = depuisChampDate(champDate.value);
    if (d && Number.isFinite(d.getTime())) e.quand = d;
    maj();
  });

  function dessiner(focus = null) {
    // Redessiner ne vole pas le focus du nom ou de la date (catégories lues en route).
    const garde = [nom, champDate].includes(document.activeElement) ? document.activeElement : null;
    const selection = garde === nom ? [nom.selectionStart, nom.selectionEnd] : null;
    const blocs = [];
    if (rappelPossible) {
      blocs.push(section(null, h("div", { class: "ajuster-forme", role: "radiogroup", "aria-label": "Ranger comme" },
        puce("Tâche Motion", forme === "tache", () => { forme = "tache"; }, { cle: "forme-tache", role: "radio" }),
        puce("Rappel", forme === "rappel", () => {
          forme = "rappel";
          e.quand = versRappel(e.quand);
        }, { cle: "forme-rappel", role: "radio" })),
      enRappel() ? "Un rappel te prévient au moment dit, sans prendre de créneau : pour une petite chose à ne pas oublier."
        : "Motion lui trouve un créneau avant l'échéance : pour ce qui demande du temps."));
    }
    blocs.push(section("Nom", nom));
    // Quand : un rendez-vous a toujours son heure (pas d'interrupteur).
    const quand = [];
    if (!versAgenda) {
      const bascule = h("input", { type: "checkbox", role: "switch", "aria-label": enRappel() ? "Une date et une heure" : "Une échéance" });
      bascule.checked = e.avecDate;
      bascule.dataset.cle = "bascule";
      bascule.addEventListener("change", () => {
        e.avecDate = bascule.checked;
        dessiner("bascule");
      });
      quand.push(h("label", { class: "bascule" }, h("span", { class: "textes" }, h("strong", null, enRappel() ? "Une date et une heure" : "Une échéance")), bascule));
    }
    if (e.avecDate) {
      champDate.value = versChampDate(e.quand);
      quand.push(h("label", { class: "etiquette-champ", for: "ajuster-quand" }, enRappel() ? "Le" : versAgenda ? "Début" : "Avant le"), champDate,
        h("div", { class: "rangee serree ajuster-raccourcis" }, RACCOURCIS.map(([lib, j]) => puce(lib, memeJour(e.quand, avecJour(e.quand, j)), () => {
          e.quand = avecJour(e.quand, j);
        }, { cle: `jour-${j}` }))));
    }
    const piedQuand = !e.avecDate && !enRappel() ? "Sans échéance, Motion la case quand il peut."
      : e.avecDate && !enRappel() && !versAgenda ? "C'est une limite, pas un créneau : Motion place la tâche avant." : null;
    blocs.push(section("Quand", quand, piedQuand));
    if (!enRappel()) {
      blocs.push(section("Durée", h("div", { class: "rangee serree" }, DUREES.map((m) => puce(enMots(m), e.duree === m, () => {
        e.duree = m;
      }, { cle: `duree-${m}` }))), e.duree == null ? "Rémy n'a pas donné de durée : en choisir une aide Motion à la placer." : null));
      if (!versAgenda) {
        blocs.push(section("Priorité", h("div", { class: "rangee serree", role: "radiogroup", "aria-label": "Priorité" }, PRIORITES.map(([v, lib]) => puce(lib, e.priorite === v, () => {
          e.priorite = v;
        }, { cle: `prio-${v}`, role: "radio" })))));
      }
    }
    if (categoriesPossibles()) {
      let contenu;
      if (etiquettes == null) contenu = h("p", { class: "aide" }, "Je lis tes catégories…");
      else if (!etiquettes.length) {
        contenu = h("a", { class: "prop-lien", href: "#/projets/categories", onclick: (ev) => {
          ev.preventDefault();
          f.fermer(false);
          ctx?.aller ? ctx.aller("projets/categories") : (location.hash = "#/projets/categories");
        } }, "Créer tes catégories (Voiture, Santé, Pro…)");
      } else {
        contenu = h("div", { class: "rangee serree" }, etiquettes.map((x) => puce(x.nom, e.etiquettes.has(x.id), () => {
          categoriesTouchees = true;
          if (e.etiquettes.has(x.id)) e.etiquettes.delete(x.id);
          else e.etiquettes.add(x.id);
        }, { cle: `cat-${x.id}` })));
      }
      blocs.push(section("Catégorie", contenu, "Le domaine (Voiture, Santé, Pro, Perso…), pour filtrer et voir où passe ton temps."));
    }
    vider(sections, blocs);
    if (focus) sections.querySelector(`[data-cle="${CSS.escape(focus)}"]`)?.focus();
    else if (garde?.isConnected) {
      garde.focus();
      if (selection) nom.setSelectionRange(...selection);
    }
    maj();
  }

  function maj() {
    const lib = principal.querySelector(".lib");
    if (enRappel()) {
      lib.textContent = envoi ? "…" : "Ranger en rappel";
      principal.disabled = envoi || !nomPropre();
      note.textContent = "Le rappel est noté tout de suite ; il sort de la proposition.";
    } else {
      lib.textContent = envoi ? "…" : "Enregistrer";
      principal.disabled = envoi || !nomPropre() || !Object.keys(champs()).length;
      note.textContent = "Rien ne part avant « Oui, fais-le ».";
    }
    if (envoi) principal.setAttribute("aria-busy", "true");
    else principal.removeAttribute("aria-busy");
  }

  async function enregistrer() {
    if (envoi || principal.disabled) return;
    envoi = true;
    maj();
    try {
      await envoyerAjustement(p, c, { actions: [{ rang, ...champs() }], convertis: [] });
      apres?.();
      f.fermer(true);
      dire("Ajustée : c'est cette version qui partira à ton « Oui ».", { genre: "succes" });
    } catch (err) {
      envoi = false;
      const suite = direEchec(err, relire);
      if (suite === "auth" || suite === "relu") f.fermer(false);
      else maj();
    }
  }

  async function rangerEnRappel() {
    if (envoi || !nomPropre()) return;
    envoi = true;
    maj();
    const texte = nomPropre().slice(0, 300);
    const quand = e.avecDate ? e.quand : null;
    try {
      // D'abord la ligne sort de la proposition : « Oui » ne créera plus la tâche.
      await envoyerAjustement(p, c, { actions: [], convertis: [rang] });
    } catch (err) {
      envoi = false;
      const suite = direEchec(err, relire);
      if (suite === "auth" || suite === "relu") f.fermer(false);
      else maj();
      return;
    }
    apres?.();
    f.fermer(true);
    const rappel = { id: `prop-${p.id}-${rang}`.replace(/[^A-Za-z0-9:_.-]/g, "-").slice(0, 150), texte, quand: quand ? quand.getTime() : null, etiquettes: etiquettesValides() };
    await noterRappel(rappel, { ctx, quand, texte });
  }

  const form = h("form", { class: "ajuster", onsubmit: (ev) => {
    ev.preventDefault();
    if (enRappel()) rangerEnRappel();
    else enregistrer();
  } }, sections);
  nom.addEventListener("input", maj);
  nom.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });
  principal.setAttribute("form", "ajuster-form");
  form.id = "ajuster-form";
  const f = feuille({
    titre: e.creation ? "Ajuster l'ajout" : "Ajuster la modification",
    contenu: form,
    pied: [note, annuler, principal],
    classe: "feuille-ajuster",
    avantFermeture: () => !envoi,
  });
  dessiner();
  nom.focus();
  nom.setSelectionRange(nom.value.length, nom.value.length);
  if (!versAgenda) {
    lireEtiquettes().then((liste) => {
      etiquettes = liste;
      // Pas de catégorie proposée par Rémy : celle que les mots suggèrent (sans IA).
      if (!categoriesTouchees && !e.etiquettes.size) {
        const id = etiquetteDevinee(nom.value, liste);
        if (id) e.etiquettes.add(id);
      }
      if (f.el.isConnected) dessiner();
    }).catch(() => {
      etiquettes = [];
      if (f.el.isConnected) dessiner();
    });
  }
  return f.fini.then((v) => v === true);
}

/** Le rappel d'une ligne rangée : noté sur la tour, ou gardé ici si elle ne répond pas. */
async function noterRappel(rappel, { ctx, quand, texte }) {
  try {
    const r = await api("/api/rappels", { methode: "POST", corps: { rappels: [rappel] } });
    if (r?.dejaLa?.length) dire(`Déjà dans tes rappels : « ${texte} ».`);
    else dire(phraseRangeEnRappel(quand), { genre: "succes" });
  } catch (err) {
    if (natureEchec(err) !== "refus") {
      // La file d'envoi le renverra, avec le même identifiant (pas de doublon).
      fileEnvoi.ajouter({ id: rappel.id, resume: `Rappel « ${texte.length > 60 ? texte.slice(0, 57) + "…" : texte} »`, genre: "rappel", requetes: [{ chemin: "/api/rappels", corps: { rappels: [rappel] } }] });
      ctx?.majCompteurs?.();
      dire(`${phraseRangeEnRappel(quand)} La tour ne répond pas : il est gardé ici et partira tout seul.`, { genre: "info" });
      return;
    }
    dire(`Rappel pas noté : ${texteErreur(err)}`, { genre: "erreur", action: { libelle: "Réessayer", faire: () => noterRappel(rappel, { ctx, quand, texte }) } });
  }
}
