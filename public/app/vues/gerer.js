// Les gestes sur une tâche ou une activité de l'agenda (« Gérer » de
// l'iPhone) : Terminer (bandeau « Annuler » 2 s, rien ne part avant),
// Commencer maintenant, Décaler (les choix de Ergonomie.swift), +15 et
// Prolonger, Bloquée (avec sa raison), catégories, Modifier. Motion fait foi ;
// chaque écriture porte un identifiant et s'annule depuis le bandeau.
import { api, ecrire, nouvelId, seg, sait } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, feuille, heure, quand, duree, isoLocal, versChampDate, depuisChampDate, occupe, demanderTexte } from "../ui.js";
import { couleurProjet } from "../couleurs.js";

const DELAI_ANNULATION = 2000;

// --- Les choix de « Décaler » (port de Decaler, Ergonomie.swift) ---
const debutJour = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const plusJours = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const echeanceDans = (jours, depuis = new Date()) => {
  const j = plusJours(debutJour(depuis), jours);
  return new Date(j.getFullYear(), j.getMonth(), j.getDate(), 23, 0);
};
export function joursJusquaLundi(d) {
  const n = (1 - d.getDay() + 7) % 7;
  return n === 0 ? 7 : n;
}
/** Au quart d'heure supérieur. */
export function arrondi(d) {
  const t = new Date(Math.floor(d.getTime() / 1000) * 1000);
  const reste = (t.getMinutes() % 15) * 60 + t.getSeconds();
  return reste === 0 ? t : new Date(t.getTime() + (15 * 60 - reste) * 1000);
}
/** Une tâche Motion ne se décale QUE par son échéance : Motion choisit l'heure. */
export function choixTache(echeance, maintenant = new Date()) {
  const choix = [];
  if (echeance != null && echeance < maintenant.getTime()) choix.push({ id: "aujourdhui", libelle: "Aujourd'hui", date: echeanceDans(0, maintenant) });
  choix.push({ id: "demain", libelle: "Demain", date: echeanceDans(1, maintenant) });
  const lundi = joursJusquaLundi(maintenant);
  if (lundi > 1) choix.push({ id: "lundi", libelle: "Lundi", date: echeanceDans(lundi, maintenant) });
  else choix.push({ id: "semaine", libelle: "Dans 1 sem.", date: echeanceDans(7, maintenant) });
  if (echeance == null) return choix;
  const apres = choix.filter((c) => c.date.getTime() > echeance);
  return apres.length ? apres : [{ id: "plus-7", libelle: "+1 sem.", date: echeanceDans(7, new Date(echeance)) }];
}
/** Une activité à soi se décale à l'heure : +15 min, +1 h, ce soir, demain même heure. */
export function choixActivite(e, maintenant = new Date()) {
  const debut = new Date(e.debut);
  const base = debut > maintenant ? debut : maintenant;
  const choix = [
    { id: "plus-15", libelle: "+15 min", date: arrondi(new Date(base.getTime() + 15 * 60e3)) },
    { id: "plus-60", libelle: "+1 h", date: arrondi(new Date(base.getTime() + 3600e3)) },
  ];
  const soir = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate(), 19, 0);
  if (soir.getTime() > base.getTime() + 3600e3) choix.push({ id: "ce-soir", libelle: "Ce soir", date: soir });
  choix.push({ id: "demain", libelle: "Demain", date: plusJours(debut, 1) });
  return choix;
}

const finEffective = (e) => e.fin ?? (e.debut != null ? e.debut + 30 * 60e3 : null);
/** « d'ici demain », « d'ici lundi », et « avant ce soir » le jour même (pas « d'ici aujourd'hui »). */
const dici = (date, maintenant = new Date()) => (debutJour(date).getTime() === debutJour(maintenant).getTime() ? "avant ce soir" : `d'ici ${quand(date.getTime(), { avecHeure: false })}`);
const estActivite = (e) => e.type === "rdv" && e.avecAutres !== true;
const estTache = (e) => e.type === "tache" || e.type === "sans-creneau";

// --- Les écritures ---
async function appliquer(source, action, resume) {
  const chemin = source === "agenda" ? "/api/google/apply" : "/api/motion/apply";
  const r = await ecrire(chemin, { actions: [action], resume, idCommande: nouvelId() }, { delai: 150000 });
  const res = r?.results?.[0];
  if ((r?.echecs ?? 0) > 0 || res?.ok === false) {
    const erreur = res?.erreur || "raison inconnue";
    // « n'existe plus » (404, 410) : réessayer ne peut pas marcher ; on relira l'écran.
    const introuvable = /\((404|410)\)|n'existe plus|introuvable/i.test(erreur);
    throw Object.assign(new Error(erreur), { nature: "refus", statut: introuvable ? 404 : 0 });
  }
  return r;
}
async function defaire(source, ledgerId, titre, apres) {
  try {
    const r = await ecrire(source === "agenda" ? "/api/google/undo" : "/api/motion/undo", { id: ledgerId });
    dire(r?.ok === false ? "Annulation incomplète : vérifie ton planning." : `« ${titre} » : remis comme avant.`, { genre: r?.ok === false ? "erreur" : "succes" });
  } catch (err) {
    direErreur(err, null, "Pas annulé");
  }
  apres?.();
}
const annulable = (source, r, titre, apres) => (r?.ledgerId ? { libelle: "Annuler", faire: () => defaire(source, r.ledgerId, titre, apres) } : null);

/**
 * Terminer : la ligne part tout de suite, un bandeau « Annuler » 2 s, et
 * RIEN n'est envoyé pendant ce délai. `retirer()` / `remettre()` : l'écran.
 */
export function terminer(e, { retirer, remettre, apres } = {}) {
  let renonce = false;
  retirer?.();
  dire(`« ${e.titre} » : fait.`, { duree: DELAI_ANNULATION + 400, action: { libelle: "Annuler", faire: () => { renonce = true; remettre?.(); } } });
  setTimeout(async () => {
    if (renonce) return;
    try {
      if (e.type === "rdv") {
        await api(`/api/taches/${seg("rdv:" + e.id)}/etat`, { methode: "PUT", corps: { fait: true } });
      } else {
        const r = await appliquer("motion", { type: "terminer", nom: e.titre, id: e.id }, "Coché depuis le site");
        if (r?.ledgerId) dire(`« ${e.titre} » est marqué fait dans Motion.`, { genre: "succes", action: annulable("motion", r, e.titre, apres), duree: 5000 });
      }
      apres?.();
    } catch (err) {
      remettre?.();
      if (err.nature === "reseau") dire(`Pas de réseau : « ${e.titre} » n'est pas marqué fait. Il est de retour.`, { genre: "erreur", action: { libelle: "Réessayer", faire: () => terminer(e, { retirer, remettre, apres }) } });
      else direErreur(err, () => terminer(e, { retirer, remettre, apres }), `Motion n'a pas pu marquer « ${e.titre} » comme fait`, { rafraichir: apres });
    }
  }, DELAI_ANNULATION);
}

export async function decaler(e, date, { apres } = {}) {
  try {
    if (estTache(e)) {
      const r = await appliquer("motion", { type: "modifier", nom: e.titre, echeance: isoLocal(date), id: e.id }, "Replanifié depuis le site");
      dire(`« ${e.titre} » : à faire ${dici(date)}. Motion recalcule.`, { genre: "succes", action: annulable("motion", r, e.titre, apres) });
    } else if (estActivite(e)) {
      const r = await appliquer("agenda", { type: "modifier", titre: e.titre, debut: isoLocal(date), id: e.id }, "Décalée depuis le site");
      dire(`« ${e.titre} » : à ${heure(date.getTime())}${date.getDate() !== new Date().getDate() ? ` (${quand(date.getTime(), { avecHeure: false })})` : ""}.`, { genre: "succes", action: annulable("agenda", r, e.titre, apres) });
    } else {
      dire(`« ${e.titre} » a d'autres participants : déplace-le dans ton agenda, ou demande à Rémy.`);
      return false;
    }
    apres?.();
    return true;
  } catch (err) {
    direErreur(err, () => decaler(e, date, { apres }), `« ${e.titre} » n'a pas été décalé`, { rafraichir: apres });
    return false;
  }
}

export async function prolonger(e, minutes, { apres } = {}) {
  try {
    if (estTache(e)) {
      if (!e.duree) {
        dire(`Motion ne donne pas de durée pour « ${e.titre} » : impossible de la prolonger d'ici.`, { genre: "erreur" });
        return false;
      }
      const r = await appliquer("motion", { type: "modifier", nom: e.titre, duree: e.duree + minutes, id: e.id }, "Prolongé depuis le site");
      dire(`« ${e.titre} » : +${minutes} min. Motion recalcule la suite.`, { genre: "succes", action: annulable("motion", r, e.titre, apres) });
    } else if (estActivite(e)) {
      const nouvelle = Math.round((finEffective(e) - e.debut) / 60e3) + minutes;
      const r = await appliquer("agenda", { type: "modifier", titre: e.titre, duree: nouvelle, id: e.id }, "Prolongée depuis le site");
      dire(`« ${e.titre} » : +${minutes} min, jusqu'à ${heure(finEffective(e) + minutes * 60e3)}.`, { genre: "succes", action: annulable("agenda", r, e.titre, apres) });
    } else return false;
    apres?.();
    return true;
  } catch (err) {
    direErreur(err, () => prolonger(e, minutes, { apres }), `« ${e.titre} » n'a pas été prolongée`, { rafraichir: apres });
    return false;
  }
}

export async function commencer(e, { apres } = {}) {
  try {
    await api(`/api/taches/${seg(e.id)}/etat`, { methode: "PUT", corps: { commencee: Date.now() } });
    dire(`« ${e.titre} » commencée. Motion sera prévenu quand tu la termines.`, {
      genre: "succes",
      action: { libelle: "Annuler", faire: async () => {
        try {
          await api(`/api/taches/${seg(e.id)}/etat`, { methode: "PUT", corps: { commencee: false } });
          dire(`« ${e.titre} » : remise à sa place.`);
        } catch (err) { direErreur(err); }
        apres?.();
      } },
    });
    apres?.();
  } catch (err) {
    direErreur(err, () => commencer(e, { apres }), `« ${e.titre} » n'a pas pu être commencée`, { rafraichir: apres });
  }
}

export async function bloquer(e, bloquee, raison, { apres } = {}) {
  const avant = { bloquee: Boolean(e.bloquee), raison: e.raison || null };
  try {
    const corps = { bloquee };
    if (bloquee && raison) corps.raison = raison;
    await api(`/api/taches/${seg(e.id)}/etat`, { methode: "PUT", corps });
    dire(bloquee ? `« ${e.titre} » : en attente.` : `« ${e.titre} » : reprise.`, {
      genre: "succes",
      action: { libelle: "Annuler", faire: async () => {
        await api(`/api/taches/${seg(e.id)}/etat`, { methode: "PUT", corps: avant.bloquee ? { bloquee: true, raison: avant.raison || undefined } : { bloquee: false } }).catch((err) => direErreur(err));
        apres?.();
      } },
    });
    apres?.();
  } catch (err) {
    direErreur(err, null, "État pas enregistré");
  }
}

async function modifier(e, { nouveauNom, echeance, dureeMin, priorite }, { apres } = {}) {
  const action = { type: "modifier", nom: e.titre, id: e.id };
  if (nouveauNom && nouveauNom !== e.titre) action.nouveau_nom = nouveauNom;
  if (echeance) action.echeance = isoLocal(echeance);
  if (dureeMin) action.duree = dureeMin;
  if (priorite) action.priorite = priorite;
  try {
    const r = await appliquer("motion", action, "Modifié depuis le site");
    dire(`« ${action.nouveau_nom || e.titre} » : modifiée.`, { genre: "succes", action: annulable("motion", r, e.titre, apres) });
    apres?.();
    return true;
  } catch (err) {
    direErreur(err, null, `Motion n'a pas pu modifier « ${e.titre} »`);
    return false;
  }
}

let etiquettesConnues = null;
async function etiquettes() {
  if (!etiquettesConnues) etiquettesConnues = (await api("/api/etiquettes")).etiquettes || [];
  return etiquettesConnues;
}

const PRIORITES = [["ASAP", "Au plus vite"], ["HIGH", "Haute"], ["MEDIUM", "Moyenne"], ["LOW", "Basse"]];

/**
 * La feuille « Gérer » d'un élément de la journée (ou d'une tâche sans
 * créneau). `apres()` : relire la journée. `contexte` : pour « En parler à Rémy ».
 */
export function gerer(e, { apres, contexte, retirer, remettre } = {}) {
  const tache = estTache(e);
  const activite = estActivite(e);
  const rdvAutres = e.type === "rdv" && !activite;
  const maintenant = Date.now();
  const enCours = e.debut != null && e.debut <= maintenant && finEffective(e) > maintenant;
  const sous = [
    e.projet ? h("span", { class: "puce" }, h("span", { class: "point", style: { background: couleurProjet(e.projet) } }), h("span", null, e.projet)) : null,
    e.debut != null && e.type !== "sans-creneau" ? h("span", { class: "mono" }, `${heure(e.debut)} – ${heure(finEffective(e))}`) : null,
    e.echeance ? h("span", null, `échéance ${quand(e.echeance)}`) : null,
    e.lieu ? h("span", null, e.lieu) : null,
  ].filter(Boolean);
  let f;
  const fermerPuis = (faire) => async (ev) => {
    const btn = ev?.currentTarget;
    await occupe(btn, async () => {
      const ok = await faire();
      if (ok !== false) f.fermer();
    });
  };
  const groupe = (titre, ...enfants) => h("section", { class: "groupe-gestes" }, h("h3", { class: "titre-section" }, titre), ...enfants);

  const contenu = h("div", null);
  ajouterA(contenu, h("div", { class: "rangee serree", style: { marginBottom: "6px" } }, sous));
  if (e.bloquee) ajouterA(contenu, h("p", { class: "marque-bloquee" }, icone("pause"), `En attente${e.raison ? ` : ${e.raison}` : ""}`));
  if (rdvAutres) ajouterA(contenu, h("p", { class: "aide", style: { margin: "8px 0" } }, "Un rendez-vous avec d'autres personnes ne se modifie pas d'un geste : déplace-le dans ton agenda, ou demande à Rémy."));

  // Maintenant
  const principaux = [];
  if (tache || activite) principaux.push(bouton("Terminer", { classe: "plein", icone: "coche", onclick: () => { f.fermer(); terminer(e, { retirer, remettre, apres }); } }));
  if (tache && !enCours && sait("taches-etat-v2")) {
    principaux.push(bouton("Commencer maintenant", { classe: "papier", icone: "lecture", onclick: fermerPuis(() => commencer(e, { apres })) }));
  }
  principaux.push(bouton("En parler à Rémy", { classe: "papier", icone: "remy", onclick: () => {
    f.fermer();
    try { localStorage.setItem("remy-question", JSON.stringify({ texte: `On parle de « ${e.titre} » ?`, a: Date.now() })); } catch {}
    contexte?.aller("remy/nouvelle");
  } }));
  ajouterA(contenu, groupe("Maintenant", h("div", { class: "rangee" }, principaux)));

  // Décaler
  if (tache || activite) {
    const choix = tache ? choixTache(e.echeance ?? null) : choixActivite(e);
    const autre = h("input", { class: "champ", type: tache ? "date" : "datetime-local", "aria-label": "Autre date", style: { width: "auto" } });
    const valeur = tache ? (e.echeance ? new Date(e.echeance) : echeanceDans(1)) : new Date(e.debut + 3600e3);
    autre.value = tache ? versChampDate(valeur).slice(0, 10) : versChampDate(valeur);
    ajouterA(contenu, groupe(tache ? "Décaler l'échéance" : "Décaler",
      h("div", { class: "rangee serree" },
        choix.map((c) => h("button", { type: "button", class: "puce", title: quand(c.date.getTime(), { avecHeure: !tache }), onclick: fermerPuis(() => decaler(e, c.date, { apres })) }, c.libelle)),
        h("span", { class: "rangee serree" }, autre, bouton("OK", { classe: "papier petit", onclick: fermerPuis(() => {
          const d = tache ? (autre.value ? new Date(`${autre.value}T23:00`) : null) : depuisChampDate(autre.value);
          if (!d || Number.isNaN(d.getTime())) {
            dire("Choisis une date valide.", { genre: "erreur" });
            return false;
          }
          return decaler(e, d, { apres });
        }) })))));
  }

  // Prolonger
  if ((tache && e.type !== "sans-creneau" && e.duree) || activite) {
    ajouterA(contenu, groupe("Prolonger", h("div", { class: "rangee serree" },
      [5, 15, 30].map((m) => h("button", { type: "button", class: "puce", onclick: fermerPuis(() => prolonger(e, m, { apres })) }, `+${m} min`)))));
  }

  // En attente (bloquée)
  if (tache) {
    ajouterA(contenu, groupe("En attente", h("div", { class: "rangee" },
      e.bloquee
        ? bouton("Reprendre", { classe: "papier", icone: "lecture", onclick: fermerPuis(() => bloquer(e, false, null, { apres })) })
        : bouton("Bloquée…", { classe: "papier", icone: "pause", onclick: async () => {
          const raison = await demanderTexte("Qu'est-ce qui bloque ?", { etiquette: "Raison (facultative)", libelle: "Mettre en attente", placeholder: "J'attends le devis de…", aide: "Motion n'a pas ce champ : Remy le garde." }).catch(() => null);
          if (raison === null) return;
          f.fermer();
          bloquer(e, true, raison, { apres });
        } }))));
  }

  // Catégories
  if (tache && sait("categories-taches-v1")) {
    const zone = h("div", { class: "rangee serree" }, h("span", { class: "aide" }, "…"));
    ajouterA(contenu, groupe("Catégories", zone));
    etiquettes().then((liste) => {
      const choisies = new Set(e.etiquettes || []);
      vider(zone, liste.length ? liste.map((et) => {
        const b = h("button", { type: "button", class: "puce", "aria-pressed": String(choisies.has(et.id)) }, et.nom);
        b.addEventListener("click", async () => {
          if (choisies.has(et.id)) choisies.delete(et.id);
          else choisies.add(et.id);
          b.setAttribute("aria-pressed", String(choisies.has(et.id)));
          try {
            await api(`/api/taches/${seg(e.id)}/etiquettes`, { methode: "PUT", corps: { etiquettes: [...choisies] } });
            e.etiquettes = [...choisies];
            apres?.();
          } catch (err) {
            if (choisies.has(et.id)) choisies.delete(et.id);
            else choisies.add(et.id);
            b.setAttribute("aria-pressed", String(choisies.has(et.id)));
            direErreur(err, null, "Catégorie pas enregistrée");
          }
        });
        return b;
      }) : h("span", { class: "aide" }, "Pas encore de catégories (Projets › Étiquettes)."));
    }).catch((err) => vider(zone, h("span", { class: "erreur-champ" }, err.message)));
  }

  // Modifier
  if (tache) {
    const nom = h("input", { class: "champ", type: "text", value: e.titre, "aria-label": "Nom" });
    const ech = h("input", { class: "champ", type: "datetime-local", "aria-label": "Échéance" });
    if (e.echeance) ech.value = versChampDate(new Date(e.echeance));
    const dur = h("input", { class: "champ", type: "number", min: "5", max: "1440", step: "5", "aria-label": "Durée (min)", placeholder: "min" });
    if (e.duree) dur.value = String(e.duree);
    const prio = h("select", { class: "champ", "aria-label": "Priorité" }, h("option", { value: "" }, "Priorité inchangée"), PRIORITES.map(([v, l]) => h("option", { value: v }, l)));
    if (e.priorite) prio.value = e.priorite;
    const details = h("details", null, h("summary", { class: "titre-section", style: { cursor: "pointer", minHeight: "44px", alignItems: "center", marginBottom: "0" } }, "Modifier"),
      h("div", { style: { display: "grid", gap: "10px", gridTemplateColumns: "1fr 1fr" } },
        h("label", { style: { gridColumn: "1 / -1" } }, h("span", { class: "etiquette-champ" }, "Nom"), nom),
        h("label", null, h("span", { class: "etiquette-champ" }, "Échéance"), ech),
        h("label", null, h("span", { class: "etiquette-champ" }, "Durée (min)"), dur),
        h("label", null, h("span", { class: "etiquette-champ" }, "Priorité"), prio),
        h("div", { style: { alignSelf: "end" } }, bouton("Enregistrer", { classe: "plein", onclick: fermerPuis(() => modifier(e, {
          nouveauNom: nom.value.trim(),
          echeance: depuisChampDate(ech.value),
          dureeMin: Number(dur.value) || null,
          priorite: prio.value && prio.value !== e.priorite ? prio.value : null,
        }, { apres })) }))));
    ajouterA(contenu, h("section", { class: "groupe-gestes" }, details));
  }

  f = feuille({ titre: e.titre, sousTitre: enCours ? "En cours" : e.type === "sans-creneau" ? "Sans créneau" : e.debut ? quand(e.debut) : null, contenu, large: true });
  return f;
}

/** Le résumé d'une durée « 50 min sur 1 h 15 » (carte Maintenant). */
export const resteSur = (e, maintenant = Date.now()) => {
  const reste = Math.max(1, Math.ceil((finEffective(e) - maintenant) / 60e3));
  const total = e.duree ?? Math.max(1, Math.round((finEffective(e) - e.debut) / 60e3));
  return { reste, total, texteReste: reste < 60 ? String(reste) : duree(reste), unite: reste < 60 ? "min restantes" : "restantes" };
};
export { finEffective, estActivite, estTache };
