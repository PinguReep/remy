// Aujourd'hui, dans l'ordre de l'iPhone (AujourdhuiView) : ce qui ne va pas
// avec Motion (bandeau), le conseil du moment, la carte Maintenant (Terminer ·
// Commencer · Décaler · +15 · Gérer), les rappels du jour, la menacée, le
// briefing le matin ou le bilan le soir, la journée à l'échelle (de maintenant
// − 1 h à + 6 h, « Toute la journée » sur un geste), Demain et 7 jours, et
// « À trancher » en carte compacte.
// Sur un grand écran, deux colonnes : à gauche faire (Maintenant, rappels,
// journée), à droite décider (conseil, menacées, rituel, semaine, à trancher).
// La boîte, le briefing, le bilan, « À trancher » et les rappels du jour sont
// des modules à part (boite.js, trancher.js, rappels.js), montés une fois :
// chacun lit ses propres routes et reçoit le tableau à chaque lecture.
// Lectures : /api/dashboard à l'affichage, au retour au premier plan et
// toutes les 5 min quand la fenêtre est visible (jamais en boucle serrée : il
// peut relancer le conseil réfléchi du modèle local).
import { api, ecrire, seg, sait, evenements } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, squelette, blocErreur, vide, heure, jourLong, duree, occupe, local } from "../ui.js";
import { couleurProjet } from "../couleurs.js";
import { gerer, terminer, decaler, commencer, choixTache, choixActivite, resteSur, finEffective, estActivite, marquerFaite, cochees, renoncerCochee, suivreFileCochees, chargerEtiquettes, nomsEtiquettes, preparerQuestion } from "./gerer.js";
import { phraseMotion, motionFrais, ALERTES_MOTION, REESSAI_MOTION } from "../analyse/motion.js";
import { BROUILLONS, titreFilJournee, sansCochees, detailLigne, detailTache, marqueBloquee, plusEnRetard, estPerimee, phraseRafraichi, phrasesSources, phraseGestes, phraseCaptures, carteConnaissance } from "../analyse/journee.js";
import * as fileEnvoi from "../file-envoi.js";
import { creerConseil } from "./conseil.js";
import { creerSemaine } from "./semaine.js";

let racine;
let donnees = null; // dashboard
let semaine = null; // Demain et les 7 jours, « À l'échelle » (vues/semaine.js)
let journeeEntiere = false; // « Toute la journée » déplié
let menaceesTout = false;
let erreur = null;
let masquees = new Set(); // lignes retirées tout de suite (Terminer, trancher)
let minuteurHorloge = null;
let minuteurLecture = null;
let ctx;
let enLecture = null;
let conseil = null; // la carte « Conseil du moment » (vues/conseil.js)
let desabonnerCochees = null;
let desabonnerFile = null;
let misAJour = null; // quand la journée affichée a été lue

const zones = {};

export default {
  async monter(el, args, contexte) {
    racine = el;
    ctx = contexte;
    masquees = new Set();
    const maintenant = new Date();
    const titre = h("div", { class: "titres" },
      h("div", { class: "sur-titre" }, jourLong(maintenant.getTime())),
      h("h1", { class: "titre-ecran" }, salutation(maintenant)));
    const rafraichir = bouton("Rafraîchir", { classe: "papier", icone: "rafraichir", titre: "Relire Motion et l'agenda", onclick: (e) => occupe(e.currentTarget, () => charger({ frais: true })) });
    const noter = bouton("Noter", { classe: "plein", icone: "plus", kbd: "N", onclick: () => ctx.noter() });
    actionsEntete = h("div", { class: "actions-entete" }, rafraichir, noter);
    // Chaque zone a sa place (classe zone-…) : deux colonnes sur grand écran,
    // une seule dans l'ordre de l'iPhone en dessous de 1024 px (atelier.css).
    for (const k of ["motion", "conseil", "maintenant", "rappels", "menacees", "rituel", "journee", "retards", "semaine", "trancher", "connaissance"]) zones[k] = h("div", { class: `auj-zone zone-${k}` });
    vider(el,
      h("header", { class: "entete-ecran" }, titre, actionsEntete),
      zones.motion,
      h("div", { class: "auj-grille" },
        h("div", { class: "auj-colonne principale" }, zones.maintenant, zones.rappels, zones.journee, zones.retards),
        h("div", { class: "auj-colonne laterale" }, zones.conseil, zones.menacees, zones.rituel, zones.semaine, zones.trancher, zones.connaissance)));
    ajouterA(zones.maintenant, h("section", { class: "carte maintenant" }, squelette([0.3, 0.8, 0.5], true)));
    ajouterA(zones.journee, h("section", { class: "carte" }, squelette([0.5, 0.9, 0.9, 0.7])));
    conseil?.arreter();
    conseil = creerConseil(ctx, { journee: journeeVue, ouvrirGerer: (e) => gerer(e, gestesDe(e)), surChange: () => majModules({ seulement: "boite" }) });
    vider(zones.conseil, conseil.carte);
    semaine = creerSemaine(ctx, { journee: journeeVue, gestes: gestesDe });
    vider(zones.semaine, semaine.carte);
    evenements.addEventListener("remy:sujets", surSujets);
    // Les tâches cochées d'ici : la journée suit leur liste (et la file d'envoi, sans réseau).
    desabonnerCochees?.();
    desabonnerCochees = cochees.surChangement(() => {
      if (racine?.isConnected && donnees) redessiner();
      semaine?.dessiner();
    });
    suivreFileCochees({ apres });
    // Ce qui attend la tour (captures, coches) : la ligne d'état suit la file d'envoi.
    desabonnerFile?.();
    desabonnerFile = fileEnvoi.surChangement(() => {
      if (racine?.isConnected) dessinerEtat();
    });
    if (sait("etiquettes-v1")) chargerEtiquettes().then(() => { if (racine?.isConnected && donnees) redessiner(); }).catch(() => {});
    modulesPrets = monterModules();
    await charger();
    ouvrirRoute(args);
    clearInterval(minuteurHorloge);
    minuteurHorloge = setInterval(() => {
      if (document.visibilityState === "visible" && donnees) {
        dessinerMaintenant();
        dessinerJournee();
        conseil?.dessiner();
      }
    }, 30e3);
    clearInterval(minuteurLecture);
    minuteurLecture = setInterval(() => {
      if (document.visibilityState === "visible") charger({ discret: true });
    }, 5 * 60e3);
  },
  demonter() {
    clearInterval(minuteurHorloge);
    clearInterval(minuteurLecture);
    conseil?.arreter();
    evenements.removeEventListener("remy:sujets", surSujets);
    desabonnerCochees?.();
    desabonnerCochees = null;
    desabonnerFile?.();
    desabonnerFile = null;
  },
  actualiser() {
    charger({ discret: true });
  },
  // #/aujourdhui/<quoi>[/<arg>] alors qu'Aujourd'hui est déjà affiché.
  suivre(args) {
    ouvrirRoute(args);
  },
};

// Rémy a traité des sujets (événement SSE « traites ») : la boîte se relit avec le tableau.
const surSujets = () => charger({ discret: true });

// --- Les modules d'accueil des autres lots (contrat A) ---
// Chargés une fois au montage, par import() : un module absent (tour pas à
// jour, fichier manquant) laisse sa zone vide, sans casser la vue.
const MODULES_ACCUEIL = { boite: "./boite.js", trancher: "./trancher.js", rappels: "./rappels.js" };
let accueil = {}; // { boite, trancher, rappels } : ce que chaque module a rendu
let modulesPrets = null;
let actionsEntete = null;

async function chargerModule(nom, fabrique) {
  try {
    const m = await import(MODULES_ACCUEIL[nom]);
    if (typeof m[fabrique] !== "function") throw new Error(`${fabrique} absent de ${MODULES_ACCUEIL[nom]}`);
    return m[fabrique](ctx, { relire: () => charger({ discret: true }) });
  } catch (err) {
    console.warn(`Aujourd'hui : le module ${nom} n'est pas chargé.`, err);
    return null;
  }
}

async function monterModules() {
  const [boite, trancher, rappels] = await Promise.all([
    chargerModule("boite", "creerBoite"),
    chargerModule("trancher", "creerTrancher"),
    chargerModule("rappels", "creerRappelsDuJour"),
  ]);
  accueil = { boite, trancher, rappels };
  if (!racine?.isConnected) return;
  if (boite?.bouton) actionsEntete?.prepend(boite.bouton);
  if (boite?.carte) vider(zones.rituel, boite.carte);
  if (trancher?.carte) vider(zones.trancher, trancher.carte);
  if (rappels?.carte) vider(zones.rappels, rappels.carte);
  if (donnees) majModules();
}

/** Chaque module reçoit le tableau (il ne lit jamais /api/dashboard lui-même). */
function majModules({ frais = false, seulement = null } = {}) {
  const affiche = conseil?.affiche() || null;
  for (const [nom, m] of Object.entries(accueil)) {
    if (!m?.maj || (seulement && nom !== seulement)) continue;
    try {
      m.maj(nom === "boite" ? { dashboard: donnees, conseil: affiche, frais } : { dashboard: donnees, frais });
    } catch (err) {
      console.warn(`Aujourd'hui : le module ${nom} n'a pas pu se mettre à jour.`, err);
    }
  }
}

/** #/aujourdhui/<quoi>[/<arg>] (contrat B) : ouvre ce qui est demandé, puis l'adresse redevient #/aujourdhui. */
async function ouvrirRoute(args = []) {
  const [quoi, arg] = args || [];
  if (!quoi) return;
  history.replaceState(null, "", "#/aujourdhui");
  await modulesPrets;
  const absent = () => dire("Cette fenêtre n'a pas pu se charger : recharge la page (Ctrl+R).", { genre: "erreur" });
  if (["boite", "briefing", "bilan", "nuit"].includes(quoi)) {
    if (accueil.boite?.ouvrir) accueil.boite.ouvrir(quoi, arg);
    else absent();
  } else if (["trancher", "revue", "retards"].includes(quoi)) {
    if (accueil.trancher?.ouvrir) accueil.trancher.ouvrir(quoi);
    else absent();
  } else if (quoi === "echelle") {
    semaine?.ouvrir(arg || "aujourdhui");
  }
}

function salutation(d) {
  const hh = d.getHours();
  return hh < 5 ? "Bonne nuit" : hh < 12 ? "Bonjour" : hh < 18 ? "Bon après-midi" : "Bonsoir";
}

async function charger({ frais = false, discret = false } = {}) {
  if (enLecture) return enLecture;
  enLecture = (async () => {
    const [d] = await Promise.allSettled([api(`/api/dashboard${frais ? "?frais=1" : ""}`, { delai: 45000 })]);
    if (d.status === "fulfilled") {
      donnees = d.value;
      erreur = null;
      misAJour = Date.now();
    } else {
      erreur = d.reason;
      if (!discret || !donnees) donnees = donnees || null;
    }
    masquees = new Set();
    toutDessiner();
    if (d.status === "fulfilled") {
      majModules({ frais });
      semaine?.maj({ frais });
    }
    if (frais && d.status === "fulfilled" && !estPerimee(donnees?.journee)) {
      // « À jour. » seulement si Motion a vraiment été relu ; sinon, pourquoi.
      const m = donnees?.journee?.motion;
      if (motionFrais(m)) dire("À jour.", { duree: 1500 });
      else dire(phraseMotion(m) || m?.raison || "Motion n'a pas pu être relu : la journée affichée date d'avant.", { genre: ALERTES_MOTION.has(m?.etat) ? "erreur" : "info" });
    } else if (frais && d.status === "rejected") {
      direErreur(d.reason, () => charger({ frais: true }), "Pas rafraîchi");
    }
  })().finally(() => {
    enLecture = null;
    // Les « Réessayer » du bandeau redeviennent cliquables.
    if (racine?.isConnected) dessinerEtat();
  });
  return enLecture;
}

const apres = () => setTimeout(() => charger({ discret: true }), 600);

function toutDessiner() {
  if (!racine?.isConnected) return;
  // Une page restée d'un autre jour (fenêtre ouverte depuis hier, relecture ratée) : l'afficher tromperait.
  const perimee = Boolean(donnees) && estPerimee(donnees.journee);
  racine.classList.toggle("auj-perimee", perimee);
  if (perimee) {
    vider(zones.maintenant, h("section", { class: "carte" }, vide(null, "Cette page date d'un autre jour : Rémy doit la rafraîchir.",
      bouton("Rafraîchir", { classe: "plein", icone: "rafraichir", onclick: (ev) => occupe(ev.currentTarget, () => charger({ frais: true })) }))));
    dessinerEtat();
    return;
  }
  if (!donnees && erreur) {
    vider(zones.maintenant, h("section", { class: "carte" }, blocErreur(erreur, () => charger())));
    vider(zones.journee);
    vider(zones.retards);
  } else {
    dessinerMaintenant();
    dessinerJournee();
    dessinerRetards();
  }
  dessinerEtat();
  dessinerMenacees();
  dessinerConnaissance();
  semaine?.dessiner();
  dessinerConseil();
}

// --- Le bandeau d'état : seulement quand quelque chose ne va pas (Bandeau de l'iPhone) ---
// Ce qui attend la tour (captures, coches), une journée pas rafraîchie (avec sa
// date), Motion ou l'agenda qui ne répondent pas, la phrase de Motion. Jamais
// un succès qui n'a pas eu lieu.
function ligneEtat(texte, { alerte = true, reessayer = null } = {}) {
  return h("div", { class: `bandeau-motion etat-ligne${alerte ? " alerte" : ""}`, role: alerte ? "alert" : "status" },
    icone(alerte ? "alerte" : "horloge"), h("span", { class: "msg" }, texte),
    reessayer ? boutonReessayer(reessayer) : null);
}
/** « Réessayer », « … » et désactivé pendant la lecture. */
function boutonReessayer(faire) {
  const b = bouton(enLecture ? "…" : "Réessayer", { classe: "papier petit", icone: "rafraichir", onclick: async (ev) => {
    const btn = ev.currentTarget;
    const lib = btn.querySelector(".lib");
    if (lib) lib.textContent = "…";
    await occupe(btn, faire);
    if (btn.isConnected && lib) lib.textContent = "Réessayer";
  } });
  if (enLecture) b.disabled = true;
  return b;
}
const relireFrais = () => charger({ frais: true });

function dessinerEtat() {
  const lignes = [];
  const file = fileEnvoi.liste();
  const captures = phraseCaptures(file);
  if (captures) {
    lignes.push(h("button", { type: "button", class: "bandeau-motion etat-ligne etat-captures", "aria-label": `${captures.texte}. Ouvre la liste de ce qui attend Rémy.`, onclick: () => ctx.aller("reglages/file") },
      icone(captures.aRevoir ? "alerte" : "plateau", captures.aRevoir ? "danger" : "signal"), h("span", { class: "msg" }, captures.texte),
      h("span", { class: "voir" }, "Voir"), icone("chevron")));
  }
  const j = donnees?.journee;
  const enErreur = Boolean(donnees && erreur);
  if (enErreur) lignes.push(ligneEtat(phraseRafraichi(erreur, misAJour), { reessayer: () => charger() }));
  const gestes = phraseGestes(file.filter((x) => x.genre === "terminer").length);
  if (gestes) lignes.push(ligneEtat(gestes, { alerte: false, reessayer: enErreur ? null : () => fileEnvoi.vider({ sansAttendre: true }).catch(() => {}) }));
  if (!enErreur && j && !estPerimee(j)) {
    const src = j.sources || {};
    // Les deux sources en panne : la carte Maintenant le dit déjà.
    const phrase = src.motion !== "ok" && src.agenda !== "ok" ? null : phraseMotion(j.motion);
    if (phrase) lignes.push(ligneEtat(phrase, { alerte: ALERTES_MOTION.has(j.motion.etat), reessayer: REESSAI_MOTION.has(j.motion.etat) ? relireFrais : null }));
    for (const l of phrasesSources(j)) lignes.push(ligneEtat(l.texte, { reessayer: l.reessayer ? relireFrais : null }));
  }
  vider(zones.motion, lignes.length ? h("div", { class: "etat-lignes" }, lignes) : null);
}

// --- La journée : état de chaque élément selon l'heure ---
const etat = (e, m) => (finEffective(e) <= m ? "passe" : e.debut <= m ? "encours" : "avenir");
function prochain(j, m) {
  if (!j) return { cas: "inconnu" };
  const src = j.sources || {};
  if (src.motion !== "ok" && src.agenda !== "ok") {
    if (src.motion === "erreur" || src.agenda === "erreur") return { cas: "enPanne" };
    return { cas: "aucuneSource" };
  }
  const items = j.items || [];
  // Une activité faite ne compte plus comme « en cours ».
  const enCours = items.find((e) => etat(e, m) === "encours" && !e.fait);
  if (enCours) return { cas: "enCours", e: enCours };
  const suivant = items.find((e) => etat(e, m) === "avenir");
  if (suivant) return { cas: "suivant", e: suivant };
  const aFaire = j.aFaire || [];
  if (aFaire.length) return { cas: "aFaire", t: aFaire[0], total: aFaire.length };
  return { cas: "rien", retards: j.retard?.total || 0 };
}

/** La journée telle qu'elle s'affiche : sans les tâches cochées d'ici ni les lignes retirées tout de suite. */
function journeeVue() {
  const j = sansCochees(donnees?.journee || null, cochees.ids());
  if (!j || !masquees.size) return j || null;
  const garder = (x) => !masquees.has(x.id);
  const retard = j.retard ? { ...j.retard, items: (j.retard.items || []).filter(garder) } : j.retard;
  if (retard) retard.total = Math.max(0, (j.retard.total ?? 0) - ((j.retard.items || []).length - retard.items.length));
  return { ...j, items: (j.items || []).filter(garder), aFaire: (j.aFaire || []).filter(garder), retard };
}

const pucesProjet = (p) => (p ? h("span", { class: "puce" }, h("span", { class: "point", style: { background: couleurProjet(p) } }), h("span", null, p)) : null);

function redessiner() {
  if (!racine?.isConnected) return;
  dessinerMaintenant();
  dessinerJournee();
  dessinerRetards();
  conseil?.dessiner();
}
function retirerLigne(id) {
  masquees.add(id);
  redessiner();
}
function remettreLigne(id) {
  masquees.delete(id);
  redessiner();
}
/**
 * Ce que « Gérer » et Terminer reçoivent : relire, retirer ou remettre la
 * ligne, la journée du jour (l'effet d'une prolongation), la journée pour
 * « Et maintenant ? » après Terminer, l'agenda branché ou pas.
 */
const gestesDe = (e) => ({
  apres, contexte: ctx, retirer: () => retirerLigne(e.id), remettre: () => remettreLigne(e.id),
  jour: journeeVue(), journee: journeeVue, systeme: donnees?.systeme || null, maj: redessiner,
  ouvrir: (x) => gerer(x, gestesDe(x)),
});
/** Terminer sans proposer la suite (une tâche qui n'est pas celle du moment). */
const sansSuite = (e) => ({ ...gestesDe(e), journee: null });
const sansCreneau = (t, retard) => ({ ...t, type: "sans-creneau", debut: null, retard });

const demanderARemy = (texte) => preparerQuestion(texte, ctx);

function dessinerMaintenant() {
  const m = Date.now();
  const j = journeeVue();
  const p = prochain(j, m);
  const carte = h("section", { class: "carte maintenant", "aria-label": "Maintenant" });
  if (p.cas === "enCours" && p.e.type === "tache") {
    const e = p.e;
    const r = resteSur(e, m);
    const prog = Math.min(1, Math.max(0, (m - e.debut) / Math.max(60e3, finEffective(e) - e.debut)));
    const decalerBtn = bouton("Décaler", { classe: "papier", icone: "horloge", onclick: () => menuDecaler(e, decalerBtn) });
    ajouterA(carte, 
      h("div", { class: "tete" }, pucesProjet(e.projet), h("span", { class: "marque-en-cours" }, "EN COURS")),
      h("h2", null, e.titre),
      e.bloquee ? h("p", { class: "marque-bloquee" }, icone("pause"), marqueBloquee(e.raison)) : null,
      h("div", { class: "reste", "aria-label": `${r.texteReste} ${r.unite} sur ${duree(r.total)}` },
        h("span", { class: "gros" }, r.texteReste), h("span", { class: "unite" }, r.unite), h("span", { class: "sur" }, `· sur ${duree(r.total)}`)),
      h("div", { class: "barre-temps", role: "img", "aria-label": `Temps écoulé : ${Math.round(prog * 100)} % du créneau` },
        h("div", { class: "piste" }, h("div", { class: "rempli", style: { width: `${prog * 100}%`, background: couleurProjet(e.projet) } })),
        h("div", { class: "curseur", style: { left: `${prog * 100}%` } })),
      h("div", { class: "heures-barre" }, h("span", null, heure(e.debut)), h("span", null, heure(finEffective(e)))),
      h("div", { class: "rangee gestes-maintenant" },
        bouton("Terminer", { classe: "plein extensible", icone: "coche", onclick: () => terminer(e, gestesDe(e)) }),
        decalerBtn,
        e.duree ? bouton("+15", { classe: "papier", titre: "Prolonger de 15 minutes", etiquette: "Prolonger de 15 minutes", onclick: () => gerer(e, { ...gestesDe(e), prolonger: 15 }) }) : null,
        bouton("Gérer", { classe: "papier", icone: "curseurs", onclick: () => gerer(e, gestesDe(e)) })));
  } else if (p.cas === "enCours") {
    const e = p.e;
    ajouterA(carte, h("div", { class: "tete" }, h("span", { class: "etat-mono" }, "EN CE MOMENT")), h("h2", null, e.titre),
      h("p", { class: "detail-maintenant" }, [`Jusqu'à ${heure(finEffective(e))}`, e.lieu].filter(Boolean).join(" · ")),
      h("div", { class: "rangee gestes-maintenant" },
        estActivite(e) ? bouton("Terminer", { classe: "plein", icone: "coche", onclick: () => terminer(e, gestesDe(e)) }) : null,
        estActivite(e) && sait("agenda-gestes-v1") ? bouton("+15", { classe: "papier", titre: "Prolonger de 15 minutes", etiquette: "Prolonger de 15 minutes", onclick: () => gerer(e, { ...gestesDe(e), prolonger: 15 }) }) : null,
        bouton("Gérer", { classe: "papier", icone: "curseurs", onclick: () => gerer(e, gestesDe(e)) }),
        bouton("En parler à Rémy", { classe: "papier", icone: "remy", onclick: () => demanderARemy(e.type === "rdv" ? BROUILLONS.rendezVous(e) : BROUILLONS.tache(e.titre)) })));
  } else if (p.cas === "suivant") {
    const e = p.e;
    const decalerBtn = e.type === "tache" || estActivite(e) ? bouton("Décaler", { classe: "papier", icone: "horloge", onclick: () => menuDecaler(e, decalerBtn) }) : null;
    // Une tâche à venir : « Commencer » d'abord, comme sur l'iPhone (1 geste au lieu de 2).
    const peutCommencer = e.type === "tache" && sait("taches-etat-v2");
    ajouterA(carte, h("div", { class: "tete" }, pucesProjet(e.projet), h("span", { class: "etat-mono" }, "À VENIR")), h("h2", null, e.titre),
      h("p", { class: "detail-maintenant" }, [heure(e.debut), relatifCourt(e.debut - m), e.lieu].filter(Boolean).join(" · ")),
      h("div", { class: "rangee gestes-maintenant" },
        peutCommencer ? bouton("Commencer", { classe: "plein", icone: "lecture", onclick: (ev) => occupe(ev.currentTarget, () => commencer(e, { apres })) }) : null,
        e.type === "tache" ? bouton("Terminer", { classe: peutCommencer ? "papier" : "plein", icone: "coche", onclick: () => terminer(e, gestesDe(e)) }) : null,
        decalerBtn,
        bouton("Gérer", { classe: "papier", icone: "curseurs", onclick: () => gerer(e, gestesDe(e)) }),
        bouton("En parler", { classe: "papier", icone: "remy", onclick: () => demanderARemy(e.type === "rdv" ? BROUILLONS.rendezVous(e) : BROUILLONS.tache(e.titre)) })));
  } else if (p.cas === "aFaire") {
    const t = sansCreneau(p.t, false);
    const decalerBtn = bouton("Décaler", { classe: "papier", icone: "horloge", onclick: () => menuDecaler(t, decalerBtn) });
    ajouterA(carte, h("div", { class: "tete" }, pucesProjet(t.projet), h("span", { class: "etat-mono" }, "À FAIRE AUJOURD'HUI")), h("h2", null, t.titre),
      p.total > 1 ? h("p", { class: "detail-maintenant" }, `et ${p.total - 1} autre${p.total > 2 ? "s" : ""} tâche${p.total > 2 ? "s" : ""} aujourd'hui`) : null,
      h("div", { class: "rangee gestes-maintenant" },
        bouton("Terminer", { classe: "plein", icone: "coche", onclick: () => terminer(t, gestesDe(t)) }),
        sait("taches-etat-v2") ? bouton("Commencer", { classe: "papier", icone: "lecture", onclick: (ev) => occupe(ev.currentTarget, () => commencer(t, { apres })) }) : null,
        decalerBtn,
        bouton("Gérer", { classe: "papier", icone: "curseurs", onclick: () => gerer(t, gestesDe(t)) })));
  } else if (p.cas === "rien") {
    ajouterA(carte, h("h2", { class: "titre-section" }, "Temps libre"), h("h2", null, "Plus rien de prévu"),
      p.retards ? h("p", { class: "risque", style: { marginTop: "8px" } }, icone("alerte"), p.retards > 1 ? `${p.retards} tâches en retard` : "Une tâche en retard") : null,
      p.retards ? h("div", { class: "rangee gestes-maintenant" }, bouton("Par quoi je commence ?", { classe: "papier", icone: "remy", onclick: () => demanderARemy(BROUILLONS.retards) })) : null);
  } else if (p.cas === "aucuneSource") {
    ajouterA(carte, h("h2", { class: "titre-section" }, "Ta journée"), h("h2", null, "Rémy ne voit pas encore ta journée"),
      h("p", { class: "detail-maintenant" }, "Branche Motion ou ton agenda Google : tes rendez-vous et tes tâches s'afficheront ici."),
      h("div", { class: "rangee gestes-maintenant" }, bouton("Brancher l'agenda", { classe: "papier", onclick: () => ctx.aller("reglages/agenda") })));
  } else if (p.cas === "enPanne") {
    ajouterA(carte, h("h2", { class: "titre-section" }, "Ta journée"), h("h2", null, "Impossible de lire ta journée pour l'instant"),
      h("p", { class: "detail-maintenant" }, raisonPanne(j)),
      h("div", { class: "rangee gestes-maintenant" }, bouton("Réessayer", { classe: "papier", icone: "rafraichir", onclick: (ev) => occupe(ev.currentTarget, () => charger({ frais: true })) })));
  } else {
    ajouterA(carte, squelette([0.3, 0.8, 0.5], true));
  }
  vider(zones.maintenant, carte);
}

function raisonPanne(j) {
  const r = j?.motion?.raison;
  return r ? `Motion : ${r}` : "Motion et ton agenda ne répondent pas. Réessaie dans un instant.";
}
const relatifCourt = (ms) => {
  const min = Math.round(ms / 60e3);
  return min < 60 ? `dans ${min} min` : `dans ${duree(min)}`;
};

/** Le petit menu « Décaler » de la carte Maintenant (les choix de l'iPhone). */
function menuDecaler(e, ancre) {
  const choix = e.type === "rdv" ? choixActivite(e) : choixTache(e.echeance ?? null);
  const existant = document.querySelector(".menu-decaler");
  if (existant) {
    existant.remove();
    if (existant.dataset.id === e.id) return;
  }
  const menu = h("div", { class: "menu-decaler rangee serree", dataset: { id: e.id }, role: "group", "aria-label": "Décaler", style: { marginTop: "10px" } },
    choix.map((c) => h("button", { type: "button", class: "puce", onclick: (ev) => occupe(ev.currentTarget, async () => { await decaler(e, c.date, { apres }); menu.remove(); }) }, c.libelle)),
    h("button", { type: "button", class: "puce", onclick: () => { menu.remove(); gerer(e, gestesDe(e)); } }, "Autre…"));
  ancre.closest(".gestes-maintenant").after(menu);
  menu.querySelector("button")?.focus();
}

// --- La journée à l'échelle ---
function dessinerJournee() {
  const j = journeeVue();
  if (!j) return vider(zones.journee);
  const m = Date.now();
  const items = (j.items || []).filter((e) => e.debut != null);
  const carte = h("section", { class: "carte journee-echelle", "aria-label": "La journée", oncontextmenu: (ev) => {
    if (ev.target.closest?.("input, textarea")) return;
    ev.preventDefault();
    semaine?.ouvrir("aujourdhui");
  } });
  ajouterA(carte, h("h2", { class: "titre-section" }, "La journée", items.length ? h("span", { class: "compte" }, String(items.length)) : null,
    h("span", { class: "fin" }, j.motion?.luA ? h("span", { class: "lu" }, `Motion lu à ${heure(j.motion.luA)}`) : null,
      bouton("À l'échelle", { classe: "texte petit", icone: "frise", etiquette: "À l'échelle : aujourd'hui, demain et les 7 jours (clic droit sur la journée)", titre: "À l'échelle (clic droit sur la journée)", onclick: () => semaine?.ouvrir("aujourdhui") }))));
  if (j.toute?.length) ajouterA(carte, h("p", { class: "toute-journee" }, "Toute la journée : " + j.toute.map((t) => t.titre).join(" · ")));
  if (!items.length) {
    ajouterA(carte, vide(null, "Rien à heure fixe aujourd'hui."));
    return vider(zones.journee, carte, lienOrganiser());
  }
  const debutJ = new Date(); debutJ.setHours(0, 0, 0, 0);
  const minDe = (ms) => (ms - debutJ.getTime()) / 60e3;
  // Toute la journée : de la première à la dernière chose (8 h – 20 h au moins).
  const h0Jour = Math.max(0, Math.min(8 * 60, Math.floor(Math.min(...items.map((e) => minDe(e.debut))) / 60) * 60));
  const h1Jour = Math.min(24 * 60, Math.max(20 * 60, Math.ceil(Math.max(...items.map((e) => minDe(finEffective(e)))) / 60) * 60));
  // Par défaut, ce qui compte maintenant : d'une heure avant à six heures après.
  const mn0 = minDe(m);
  const h0Fen = Math.max(0, Math.floor((mn0 - 60) / 60) * 60);
  const h1Fen = Math.min(24 * 60, Math.ceil((mn0 + 6 * 60) / 60) * 60);
  const borne = !journeeEntiere && (h0Fen > h0Jour || h1Fen < h1Jour);
  const h0 = borne ? Math.max(h0Fen, Math.min(h0Jour, h1Fen - 60)) : h0Jour;
  const h1 = borne ? Math.min(h1Fen, h1Jour) : h1Jour;
  const avant = items.filter((e) => minDe(finEffective(e)) <= h0).length;
  const apresFen = items.filter((e) => minDe(e.debut) >= h1).length;
  const visibles = items.filter((e) => minDe(finEffective(e)) > h0 && minDe(e.debut) < h1);
  const basculeJournee = (borne || journeeEntiere) && (avant || apresFen || journeeEntiere)
    ? bouton(journeeEntiere ? "Autour de maintenant" : `Toute la journée${avant + apresFen ? ` (${[avant ? `${avant} plus tôt` : null, apresFen ? `${apresFen} plus tard` : null].filter(Boolean).join(", ")})` : ""}`,
      { classe: "texte petit", icone: journeeEntiere ? "compresser" : "bas", onclick: () => { journeeEntiere = !journeeEntiere; dessinerJournee(); } })
    : null;
  if (!visibles.length) {
    ajouterA(carte, vide(null, mn0 >= h1Jour ? "Plus rien à heure fixe aujourd'hui." : "Rien à heure fixe dans les prochaines heures."), basculeJournee ? h("div", { class: "rangee" }, basculeJournee) : null);
    return vider(zones.journee, carte, lienOrganiser());
  }
  const PX = 1.5; // pixels par minute (30 min = 45 px : une cible au doigt, 44 px au moins)
  const echelle = h("div", { class: "echelle", style: { height: `${(h1 - h0) * PX}px` } });
  for (let t = h0; t <= h1; t += 60) {
    const y = (t - h0) * PX;
    ajouterA(echelle, h("div", { class: "trait-heure", style: { top: `${y}px` } }), h("span", { class: "heure-repere" , style: { top: `${y}px` } }, `${String(t / 60).padStart(2, "0")}:00`));
  }
  // Les chevauchements : chaque élément prend une colonne libre de son groupe.
  const tries = [...visibles].sort((a, b) => a.debut - b.debut);
  const places = new Map();
  let groupe = [];
  let finGroupe = -Infinity;
  const clore = () => {
    const n = Math.max(1, ...groupe.map((g) => g.col + 1));
    for (const g of groupe) places.set(g.e, { col: g.col, n });
    groupe = [];
  };
  let couloirs = [];
  for (const e of tries) {
    if (e.debut >= finGroupe) {
      clore();
      couloirs = [];
    }
    let col = couloirs.findIndex((f) => f <= e.debut);
    if (col < 0) {
      couloirs.push(finEffective(e));
      col = couloirs.length - 1;
    } else couloirs[col] = finEffective(e);
    groupe.push({ e, col });
    finGroupe = Math.max(finGroupe, finEffective(e));
  }
  clore();
  for (const e of tries) {
    // Coupé aux bords de la fenêtre (un bloc commencé avant h0 part du haut).
    const debutVu = Math.max(minDe(e.debut), h0);
    const finVue = Math.min(minDe(finEffective(e)), h1);
    const top = (debutVu - h0) * PX;
    // 46 px au moins : le bouton du bloc, dans sa bordure, garde ses 44 px.
    const haut = Math.max(46, (finVue - debutVu) * PX - 2);
    const { col, n } = places.get(e);
    ajouterA(echelle, blocFrise(e, { m, top, haut, col, n }));
  }
  const mn = minDe(m);
  if (mn >= h0 && mn <= h1) ajouterA(echelle, h("div", { class: "maintenant-trait", style: { top: `${(mn - h0) * PX}px` }, title: `Maintenant · ${heure(m)}` }));
  ajouterA(carte, echelle, basculeJournee ? h("div", { class: "rangee bascule-journee" }, basculeJournee) : null);
  vider(zones.journee, carte, lienOrganiser());
}

/**
 * Un bloc de la frise : il s'ouvre dans « Gérer » ; une tâche ou une activité
 * à soi a sa case (44 px, Espace au clavier) sans gêner ce clic ; un
 * rendez-vous avec d'autres n'en a pas. Une activité faite est grisée.
 */
function blocFrise(e, { m, top, haut, col, n }) {
  const st = etat(e, m);
  const rdv = e.type === "rdv";
  const detail = [`${heure(e.debut)} – ${heure(finEffective(e))}`, detailLigne(e, m, nomsEtiquettes(e.etiquettes))].filter(Boolean).join(" · ");
  const marques = [e.retard && st !== "passe" ? "En retard" : null, e.bloquee ? marqueBloquee(e.raison) : null].filter(Boolean);
  let caseB = null;
  if (!rdv) {
    caseB = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": "false", "aria-label": `Terminer « ${e.titre} »`, title: "Terminer", onclick: (ev) => { ev.stopPropagation(); terminer(e, st === "encours" ? gestesDe(e) : sansSuite(e)); } });
  } else if (estActivite(e) && sait("taches-etat-v2")) {
    caseB = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": String(Boolean(e.fait)), "aria-label": e.fait ? `« ${e.titre} » : faite` : `Marquer « ${e.titre} » comme faite`, title: e.fait ? "Pas encore terminée" : "Terminer", onclick: (ev) => { ev.stopPropagation(); marquerFaite(e, !e.fait, { maj: redessiner }); } });
  }
  return h("div", {
    class: `bloc ${rdv ? "rdv" : "tache"} ${st}${haut < 50 ? " court" : ""}${e.fait ? " faite" : ""}${caseB ? " avec-case" : ""}`,
    style: { top: `${top}px`, height: `${haut}px`, left: `calc(8px + (100% - 8px) * ${col / n})`, width: `calc((100% - 8px) / ${n} - 4px)`, "--couleur": rdv ? "var(--encre-2)" : couleurProjet(e.projet) },
  },
  h("button", { type: "button", class: "bloc-ouvrir", title: [e.titre, detail, ...marques].join(" · "), onclick: () => gerer(e, gestesDe(e)) },
    h("span", { class: "t" }, rdv ? icone("cadenas") : null, h("span", { class: "tt" }, e.titre)),
    h("span", { class: "h" }, detail),
    marques.length && haut >= 66 ? h("span", { class: "marques" }, e.bloquee ? icone("pause") : icone("alerte"), marques.join(" · ")) : null),
  caseB);
}

/** « Organiser ma journée avec Rémy » : le clic est le geste, la demande part dans un fil neuf (contrat C). */
function lienOrganiser() {
  return h("div", { class: "rangee organiser" }, bouton("Organiser ma journée avec Rémy", { classe: "texte petit", icone: "remy", onclick: () => {
    local.ecrire("remy-envoi", { texte: BROUILLONS.journee, a: Date.now(), titre: titreFilJournee() });
    ctx.aller("remy/nouvelle");
  } }));
}

// --- À faire aujourd'hui (sans créneau) et en retard ---
function ligneTache(t, { retard = false } = {}) {
  const e = sansCreneau(t, retard);
  const caseBtn = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": "false", "aria-label": `Terminer « ${t.titre} »`, onclick: () => terminer(e, sansSuite(e)) });
  const detail = detailTache(t, { enRetard: retard, noms: nomsEtiquettes(t.etiquettes) });
  return h("li", { class: "ligne ligne-tache", style: { "--couleur": couleurProjet(t.projet) } },
    caseBtn,
    h("span", { class: "projet-trait" }),
    h("div", { class: "corps cliquable", role: "button", tabindex: "0", onclick: () => gerer(e, gestesDe(e)), onkeydown: (ev) => { if (ev.key === "Enter") gerer(e, gestesDe(e)); } },
      h("div", { class: "titre-ligne" }, t.titre),
      detail ? h("div", { class: `meta${retard ? " risque-texte" : ""}` }, retard ? icone("alerte") : null, h("span", null, detail)) : null,
      t.bloquee ? h("div", { class: "marque-bloquee" }, icone("pause"), marqueBloquee(t.raison)) : null),
    bouton("", { classe: "texte", icone: "curseurs", etiquette: `Gérer « ${t.titre} »`, onclick: () => gerer(e, gestesDe(e)) }));
}

/** Une tâche cochée d'ici : barrée, avec son « Annuler » (LigneCochee). */
function ligneCochee(c) {
  const annuler = () => bouton("Annuler", { classe: "texte petit", etiquette: `Annuler la coche de « ${c.titre} »`, onclick: () => renoncerCochee(c.id, { apres }) });
  let fin = null;
  if (c.envoi === "delai") fin = annuler();
  else if (c.envoi === "attente" || c.envoi === "tentee") fin = c.defaire ? h("span", { class: "etat-cochee" }, "sera rouverte") : [h("span", { class: "etat-cochee" }, "pas encore envoyée"), annuler()];
  else if (c.enCours) fin = h("span", { class: "cochee-tourne", role: "status", "aria-label": `« ${c.titre} » : en cours…` });
  else if (c.ledgerId) fin = annuler();
  return h("li", { class: "ligne faite cochee" }, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, c.titre)), fin);
}
function dessinerRetards() {
  const j = journeeVue();
  if (!j) return vider(zones.retards);
  const aFaire = j.aFaire || [];
  const retards = j.retard?.items || [];
  const blocs = [];
  if (aFaire.length) blocs.push(h("section", { class: "carte" }, h("h2", { class: "titre-section" }, "À faire aujourd'hui", h("span", { class: "compte" }, String(aFaire.length)), h("span", { class: "fin aide" }, "sans créneau")), h("ul", { class: "liste" }, aFaire.map((t) => ligneTache(t)))));
  if (retards.length || j.retard?.total > 0) {
    const autres = plusEnRetard(j.retard);
    blocs.push(h("section", { class: "carte" }, h("h2", { class: "titre-section", style: { color: "var(--danger)" } }, "En retard", h("span", { class: "compte" }, String(j.retard.total ?? retards.length))),
      h("ul", { class: "liste" }, retards.map((t) => ligneTache(t, { retard: true }))),
      autres ? h("p", { class: "aide plus-en-retard" }, autres) : null));
  }
  const faites = cochees.liste();
  if (faites.length) blocs.push(h("section", { class: "carte", "aria-label": "Cochées tout à l'heure" }, h("h2", { class: "titre-section" }, "Cochées tout à l'heure"), h("ul", { class: "liste" }, faites.map(ligneCochee))));
  vider(zones.retards, blocs);
}

// --- Menacées : la première, puis « Voir tout » (CarteMenacee de l'iPhone) ---
function ligneMenacee(t) {
  return h("li", { class: "sujet menacee" },
    h("span", { class: "risque", style: { marginTop: "3px" } }, icone("alerte")),
    h("div", { class: "corps" },
      h("div", { class: "titre-ligne" }, t.titre),
      h("p", { class: "phrase" }, t.phrase),
      t.action ? h("div", { class: "rangee serree", style: { marginTop: "6px" } },
        t.action.type === "repousser" && t.action.echeance
          ? bouton(t.action.libelle, { classe: "papier petit", onclick: (ev) => occupe(ev.currentTarget, () => decaler({ type: "tache", id: t.id, titre: t.titre }, new Date(t.action.echeance), { apres })) })
          : bouton(t.action.libelle || "En parler à Rémy", { classe: "papier petit", icone: "remy", onclick: () => demanderARemy(BROUILLONS.menacee(t)) })) : null));
}
function dessinerMenacees() {
  const faites = cochees.ids();
  const liste = (donnees?.menacees || []).filter((t) => !masquees.has(t.id) && !faites.has(t.id));
  if (!liste.length) return vider(zones.menacees);
  const montrees = menaceesTout ? liste : liste.slice(0, 1);
  vider(zones.menacees, h("section", { class: "carte", "aria-label": "Menacées" },
    h("h2", { class: "titre-section", style: { color: "var(--danger)" } }, liste.length > 1 ? "Échéances menacées" : "Échéance menacée", h("span", { class: "compte" }, String(liste.length))),
    h("ul", { class: "liste" }, montrees.map(ligneMenacee)),
    liste.length > 1 ? bouton(menaceesTout ? "Seulement la première" : `Voir tout (${liste.length})`, { classe: "texte petit", onclick: () => { menaceesTout = !menaceesTout; dessinerMenacees(); } }) : null));
}

// --- Faire connaissance : l'onboarding, tant qu'il reste une étape ---
function dessinerConnaissance() {
  const c = carteConnaissance(donnees?.setup);
  if (!c) return vider(zones.connaissance);
  vider(zones.connaissance, h("section", { class: "carte connaissance", "aria-label": "Faire connaissance" },
    h("h2", { class: "titre-section" }, "Faire connaissance"),
    h("p", { class: "aide-carte" }, c.texte),
    h("p", { class: "carte-titre", style: { marginTop: "10px" } }, c.titre),
    c.detail ? h("p", { class: "aide", style: { marginTop: "4px" } }, c.detail) : null,
    h("div", { class: "rangee", style: { marginTop: "12px" } }, bouton(c.libelle, { classe: "papier", onclick: (ev) => lancerEtape(c.session, ev.currentTarget) }))));
}

/**
 * Ouvre la conversation d'une étape (une seule par étape) : la reprend si
 * elle a des messages, sinon la crée, note l'étape « en cours » et envoie son
 * amorce (le clic est le geste, contrat C).
 */
async function lancerEtape(s, btn) {
  const lib = btn?.querySelector(".lib");
  const avant = lib?.textContent;
  if (lib) lib.textContent = "Ouverture…";
  await occupe(btn, async () => {
    try {
      const setup = donnees?.setup || {};
      const etats = { ...(setup.etats || {}) };
      const convs = { ...(setup.convs || {}) };
      if (convs[s.id]) {
        const existante = await api(`/api/conversations/${seg(convs[s.id])}`).catch((err) => {
          if (err?.statut === 404) return null;
          throw err;
        });
        if (existante?.messages?.length) return ctx.aller(`remy/${seg(convs[s.id])}`);
      }
      const conv = await ecrire("/api/conversations", { session: s.id });
      const neuve = !conv?.messages?.length;
      convs[s.id] = conv.id;
      if (neuve && etats[s.id] !== "faite") etats[s.id] = "en_cours";
      if (donnees) donnees.setup = { ...setup, etats, convs };
      try {
        await api("/api/setup", { methode: "PUT", corps: { etats, convs, vuA: setup.updatedAt } });
      } catch (err) {
        if (err?.nature !== "auth") dire("Étape ouverte, mais son suivi n'a pas pu être enregistré.", { genre: "erreur" });
      }
      if (neuve && s.prompt) local.ecrire("remy-envoi", { texte: s.prompt, a: Date.now(), conv: conv.id });
      ctx.aller(`remy/${seg(conv.id)}`);
    } catch (err) {
      direErreur(err, () => lancerEtape(s, btn), "L'étape n'a pas pu s'ouvrir");
    }
  });
  if (lib && btn.isConnected) lib.textContent = avant;
}

// --- Le conseil du moment (vues/conseil.js) ---
function dessinerConseil() {
  conseil?.maj({ dashboard: donnees });
}
