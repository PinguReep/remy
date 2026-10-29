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
import { api, sait, evenements } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, squelette, blocErreur, vide, heure, jourLong, quand, duree, occupe, local } from "../ui.js";
import { couleurProjet } from "../couleurs.js";
import { gerer, terminer, decaler, prolonger, commencer, choixTache, choixActivite, resteSur, finEffective, estActivite } from "./gerer.js";
import { phraseMotion, motionFrais, ALERTES_MOTION, REESSAI_MOTION } from "../analyse/motion.js";
import { BROUILLONS, titreFilJournee } from "../analyse/journee.js";
import { creerConseil } from "./conseil.js";

let racine;
let donnees = null; // dashboard
let semaine = null;
let journeeEntiere = false; // « Toute la journée » déplié
let menaceesTout = false;
let erreur = null;
let masquees = new Set(); // lignes retirées tout de suite (Terminer, trancher)
let minuteurHorloge = null;
let minuteurLecture = null;
let ctx;
let enLecture = null;
let conseil = null; // la carte « Conseil du moment » (vues/conseil.js)

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
    for (const k of ["motion", "conseil", "maintenant", "rappels", "menacees", "rituel", "journee", "retards", "semaine", "trancher"]) zones[k] = h("div", { class: `auj-zone zone-${k}` });
    vider(el,
      h("header", { class: "entete-ecran" }, titre, actionsEntete),
      zones.motion,
      h("div", { class: "auj-grille" },
        h("div", { class: "auj-colonne principale" }, zones.maintenant, zones.rappels, zones.journee, zones.retards),
        h("div", { class: "auj-colonne laterale" }, zones.conseil, zones.menacees, zones.rituel, zones.semaine, zones.trancher)));
    ajouterA(zones.maintenant, h("section", { class: "carte maintenant" }, squelette([0.3, 0.8, 0.5], true)));
    ajouterA(zones.journee, h("section", { class: "carte" }, squelette([0.5, 0.9, 0.9, 0.7])));
    conseil?.arreter();
    conseil = creerConseil(ctx, { journee: journeeVue, ouvrirGerer: (e) => gerer(e, gestesDe(e)), surChange: () => majModules({ seulement: "boite" }) });
    vider(zones.conseil, conseil.carte);
    evenements.addEventListener("remy:sujets", surSujets);
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
  }
}

function salutation(d) {
  const hh = d.getHours();
  return hh < 5 ? "Bonne nuit" : hh < 12 ? "Bonjour" : hh < 18 ? "Bon après-midi" : "Bonsoir";
}

async function charger({ frais = false, discret = false } = {}) {
  if (enLecture) return enLecture;
  enLecture = (async () => {
    const [d, s] = await Promise.allSettled([
      api(`/api/dashboard${frais ? "?frais=1" : ""}`, { delai: 45000 }),
      api("/api/semaine?jours=7", { delai: 45000 }),
    ]);
    if (d.status === "fulfilled") {
      donnees = d.value;
      erreur = null;
    } else {
      erreur = d.reason;
      if (!discret || !donnees) donnees = donnees || null;
    }
    if (s.status === "fulfilled") semaine = s.value;
    masquees = new Set();
    toutDessiner({ erreursSecondaires: { semaine: s.status === "rejected" ? s.reason : null } });
    if (d.status === "fulfilled") majModules({ frais });
    if (frais && d.status === "fulfilled") {
      // « À jour. » seulement si Motion a vraiment été relu ; sinon, pourquoi.
      const m = donnees?.journee?.motion;
      if (motionFrais(m)) dire("À jour.", { duree: 1500 });
      else dire(phraseMotion(m) || m?.raison || "Motion n'a pas pu être relu : la journée affichée date d'avant.", { genre: ALERTES_MOTION.has(m?.etat) ? "erreur" : "info" });
    } else if (frais && d.status === "rejected") {
      direErreur(d.reason, () => charger({ frais: true }), "Pas rafraîchi");
    }
  })().finally(() => {
    enLecture = null;
  });
  return enLecture;
}

const apres = () => setTimeout(() => charger({ discret: true }), 600);

function toutDessiner({ erreursSecondaires = {} } = {}) {
  if (!racine?.isConnected) return;
  if (!donnees && erreur) {
    vider(zones.maintenant, h("section", { class: "carte" }, blocErreur(erreur, () => charger())));
    vider(zones.journee);
    vider(zones.retards);
  } else {
    dessinerMaintenant();
    dessinerJournee();
    dessinerRetards();
  }
  dessinerMotion();
  dessinerMenacees();
  dessinerSemaine(erreursSecondaires.semaine);
  dessinerConseil();
}

// --- Motion : le bandeau quand quelque chose ne va pas (Bandeau de l'iPhone) ---
function dessinerMotion() {
  const m = donnees?.journee?.motion;
  const src = donnees?.journee?.sources || {};
  // Les deux sources en panne : la carte Maintenant le dit déjà.
  const phrase = src.motion !== "ok" && src.agenda !== "ok" ? null : phraseMotion(m);
  if (!phrase) return vider(zones.motion);
  const alerte = ALERTES_MOTION.has(m.etat);
  vider(zones.motion, h("div", { class: `bandeau-motion${alerte ? " alerte" : ""}`, role: alerte ? "alert" : "status" },
    icone(alerte ? "alerte" : "horloge"), h("span", { class: "msg" }, phrase),
    REESSAI_MOTION.has(m.etat) ? bouton("Réessayer", { classe: "papier petit", icone: "rafraichir", onclick: (e) => occupe(e.currentTarget, () => charger({ frais: true })) }) : null));
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
  const items = (j.items || []).filter((e) => !masquees.has(e.id));
  const enCours = items.find((e) => etat(e, m) === "encours" && !e.fait);
  if (enCours) return { cas: "enCours", e: enCours };
  const suivant = items.find((e) => etat(e, m) === "avenir");
  if (suivant) return { cas: "suivant", e: suivant };
  const aFaire = (j.aFaire || []).filter((t) => !masquees.has(t.id));
  if (aFaire.length) return { cas: "aFaire", t: aFaire[0], total: aFaire.length };
  return { cas: "rien", retards: j.retard?.total || 0 };
}

/** La journée telle qu'elle s'affiche : sans les lignes retirées tout de suite (Terminer). */
function journeeVue() {
  const j = donnees?.journee;
  if (!j || !masquees.size) return j || null;
  const garder = (x) => !masquees.has(x.id);
  const retard = j.retard ? { ...j.retard, items: (j.retard.items || []).filter(garder) } : j.retard;
  if (retard) retard.total = Math.max(0, (j.retard.total ?? 0) - ((j.retard.items || []).length - retard.items.length));
  return { ...j, items: (j.items || []).filter(garder), aFaire: (j.aFaire || []).filter(garder), retard };
}

const pucesProjet = (p) => (p ? h("span", { class: "puce" }, h("span", { class: "point", style: { background: couleurProjet(p) } }), h("span", null, p)) : null);

function retirerLigne(id) {
  masquees.add(id);
  dessinerMaintenant();
  dessinerJournee();
  dessinerRetards();
  conseil?.dessiner();
}
function remettreLigne(id) {
  masquees.delete(id);
  dessinerMaintenant();
  dessinerJournee();
  dessinerRetards();
  conseil?.dessiner();
}
const gestesDe = (e) => ({ apres, contexte: ctx, retirer: () => retirerLigne(e.id), remettre: () => remettreLigne(e.id) });
const sansCreneau = (t, retard) => ({ ...t, type: "sans-creneau", debut: null, retard });

function demanderARemy(texte) {
  local.ecrire("remy-question", { texte, a: Date.now() });
  ctx.aller("remy/nouvelle");
}

function dessinerMaintenant() {
  const m = Date.now();
  const j = donnees?.journee;
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
      e.bloquee ? h("p", { class: "marque-bloquee" }, icone("pause"), `En attente${e.raison ? ` : ${e.raison}` : ""}`) : null,
      h("div", { class: "reste", "aria-label": `${r.texteReste} ${r.unite} sur ${duree(r.total)}` },
        h("span", { class: "gros" }, r.texteReste), h("span", { class: "unite" }, r.unite), h("span", { class: "sur" }, `· sur ${duree(r.total)}`)),
      h("div", { class: "barre-temps", role: "img", "aria-label": `Temps écoulé : ${Math.round(prog * 100)} % du créneau` },
        h("div", { class: "piste" }, h("div", { class: "rempli", style: { width: `${prog * 100}%`, background: couleurProjet(e.projet) } })),
        h("div", { class: "curseur", style: { left: `${prog * 100}%` } })),
      h("div", { class: "heures-barre" }, h("span", null, heure(e.debut)), h("span", null, heure(finEffective(e)))),
      h("div", { class: "rangee gestes-maintenant" },
        bouton("Terminer", { classe: "plein extensible", icone: "coche", onclick: () => terminer(e, gestesDe(e)) }),
        decalerBtn,
        e.duree ? bouton("+15", { classe: "papier", titre: "Prolonger de 15 minutes", etiquette: "Prolonger de 15 minutes", onclick: (ev) => occupe(ev.currentTarget, () => prolonger(e, 15, { apres })) }) : null,
        bouton("Gérer", { classe: "papier", icone: "curseurs", onclick: () => gerer(e, gestesDe(e)) })));
  } else if (p.cas === "enCours") {
    const e = p.e;
    ajouterA(carte, h("div", { class: "tete" }, h("span", { class: "etat-mono" }, "EN CE MOMENT")), h("h2", null, e.titre),
      h("p", { class: "detail-maintenant" }, [`Jusqu'à ${heure(finEffective(e))}`, e.lieu].filter(Boolean).join(" · ")),
      h("div", { class: "rangee gestes-maintenant" },
        estActivite(e) ? bouton("Terminer", { classe: "plein", icone: "coche", onclick: () => terminer(e, gestesDe(e)) }) : null,
        estActivite(e) ? bouton("+15", { classe: "papier", onclick: (ev) => occupe(ev.currentTarget, () => prolonger(e, 15, { apres })) }) : null,
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
  const j = donnees?.journee;
  if (!j) return vider(zones.journee);
  const m = Date.now();
  const items = (j.items || []).filter((e) => !masquees.has(e.id) && e.debut != null);
  const carte = h("section", { class: "carte journee-echelle", "aria-label": "La journée" });
  ajouterA(carte, h("h2", { class: "titre-section" }, "La journée", items.length ? h("span", { class: "compte" }, String(items.length)) : null,
    h("span", { class: "fin" }, j.motion?.luA ? `Motion lu à ${heure(j.motion.luA)}` : "")));
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
    const haut = Math.max(44, (finVue - debutVu) * PX - 2);
    const { col, n } = places.get(e);
    const st = etat(e, m);
    const bloc = h("button", {
      type: "button",
      class: `bloc ${e.type === "rdv" ? "rdv" : "tache"} ${st}${haut < 50 ? " court" : ""}`,
      style: { top: `${top}px`, height: `${haut}px`, left: `calc(8px + (100% - 8px) * ${col / n})`, width: `calc((100% - 8px) / ${n} - 4px)`, "--couleur": e.type === "rdv" ? "var(--encre-2)" : couleurProjet(e.projet) },
      title: `${e.titre} · ${heure(e.debut)} – ${heure(finEffective(e))}`,
      onclick: () => gerer(e, gestesDe(e)),
    },
    h("span", { class: "t" }, e.type === "rdv" && e.avecAutres ? icone("cadenas") : null, e.titre),
    h("span", { class: "h" }, `${heure(e.debut)} – ${heure(finEffective(e))}${e.lieu ? ` · ${e.lieu}` : ""}${e.retard ? " · en retard" : ""}`));
    ajouterA(echelle, bloc);
  }
  const mn = minDe(m);
  if (mn >= h0 && mn <= h1) ajouterA(echelle, h("div", { class: "maintenant-trait", style: { top: `${(mn - h0) * PX}px` }, title: `Maintenant · ${heure(m)}` }));
  ajouterA(carte, echelle, basculeJournee ? h("div", { class: "rangee bascule-journee" }, basculeJournee) : null);
  vider(zones.journee, carte, lienOrganiser());
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
  const caseBtn = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": "false", "aria-label": `Terminer « ${t.titre} »`, onclick: () => terminer(e, gestesDe(e)) });
  return h("li", { class: "ligne ligne-tache", style: { "--couleur": couleurProjet(t.projet) } },
    caseBtn,
    h("span", { class: "projet-trait" }),
    h("div", { class: "corps cliquable", role: "button", tabindex: "0", onclick: () => gerer(e, gestesDe(e)), onkeydown: (ev) => { if (ev.key === "Enter") gerer(e, gestesDe(e)); } },
      h("div", { class: "titre-ligne" }, t.titre),
      h("div", { class: "meta" },
        t.echeance ? h("span", { class: retard ? "risque" : "" }, retard ? icone("alerte") : null, `${retard ? "était due " : "échéance "}${quand(t.echeance)}`) : null,
        t.projet ? h("span", null, t.projet) : null,
        t.bloquee ? h("span", null, icone("pause"), " en attente") : null)),
    bouton("", { classe: "texte", icone: "curseurs", etiquette: `Gérer « ${t.titre} »`, onclick: () => gerer(e, gestesDe(e)) }));
}
function dessinerRetards() {
  const j = donnees?.journee;
  if (!j) return vider(zones.retards);
  const aFaire = (j.aFaire || []).filter((t) => !masquees.has(t.id));
  const retards = (j.retard?.items || []).filter((t) => !masquees.has(t.id));
  const blocs = [];
  if (aFaire.length) blocs.push(h("section", { class: "carte" }, h("h2", { class: "titre-section" }, "À faire aujourd'hui", h("span", { class: "compte" }, String(aFaire.length)), h("span", { class: "fin aide" }, "sans créneau")), h("ul", { class: "liste" }, aFaire.map((t) => ligneTache(t)))));
  if (retards.length) blocs.push(h("section", { class: "carte" }, h("h2", { class: "titre-section", style: { color: "var(--danger)" } }, "En retard", h("span", { class: "compte" }, String(j.retard.total ?? retards.length))), h("ul", { class: "liste" }, retards.map((t) => ligneTache(t, { retard: true })))));
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
  const liste = (donnees?.menacees || []).filter((t) => !masquees.has(t.id));
  if (!liste.length) return vider(zones.menacees);
  const montrees = menaceesTout ? liste : liste.slice(0, 1);
  vider(zones.menacees, h("section", { class: "carte", "aria-label": "Menacées" },
    h("h2", { class: "titre-section", style: { color: "var(--danger)" } }, liste.length > 1 ? "Échéances menacées" : "Échéance menacée", h("span", { class: "compte" }, String(liste.length))),
    h("ul", { class: "liste" }, montrees.map(ligneMenacee)),
    liste.length > 1 ? bouton(menaceesTout ? "Seulement la première" : `Voir tout (${liste.length})`, { classe: "texte petit", onclick: () => { menaceesTout = !menaceesTout; dessinerMenacees(); } }) : null));
}

// --- Demain et 7 jours ---
function dessinerSemaine(err) {
  const carte = h("section", { class: "carte", "aria-label": "Demain et les 7 jours" });
  ajouterA(carte, h("h2", { class: "titre-section" }, "Demain et 7 jours"));
  if (!semaine && err) ajouterA(carte, blocErreur(err, () => charger()));
  else if (!semaine) ajouterA(carte, squelette([0.7, 0.6, 0.8]));
  else {
    const jours = (semaine.jours || []).slice(1);
    if (!jours.length) ajouterA(carte, vide(null, "Rien de prévu les prochains jours."));
    ajouterA(carte, h("div", { class: "jours-semaine" }, jours.map((j, i) => {
      const d = new Date(`${j.jour}T12:00:00`);
      const nom = i === 0 ? "Demain" : new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric" }).format(d);
      const items = j.items || [];
      const rdv = items.filter((x) => x.type === "rdv").length;
      const taches = items.filter((x) => x.type === "tache").length;
      const charge = j.charge?.disponible ? Math.min(1, (j.charge.taches + j.charge.rdv) / Math.max(1, j.charge.travail || j.charge.disponible)) : 0;
      const menacees = (j.echeances || []).filter((x) => x.menacee).length;
      const det = h("details", { class: "jour-semaine", open: i === 0 },
        h("summary", null, h("span", { class: "nom" }, nom),
          menacees ? h("span", { class: "risque" }, icone("alerte"), `${menacees}`) : null,
          h("span", { class: "resume" }, [rdv ? `${rdv} rdv` : null, taches ? `${taches} tâche${taches > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ") || "libre"),
          h("span", { class: "charge", title: `Chargé à ${Math.round(charge * 100)} %` }, h("span", { style: { width: `${Math.round(charge * 100)}%` } }))),
        items.length ? h("ul", { class: "liste" }, items.map((x) => h("li", { class: "ligne" },
          h("span", { class: "heure" }, x.debut ? heure(x.debut) : "—"),
          h("span", { class: "projet-trait", style: { "--couleur": x.type === "rdv" ? "var(--encre-2)" : couleurProjet(x.projet), width: "3px", alignSelf: "stretch", borderRadius: "2px", background: "var(--couleur)" } }),
          h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, x.titre), x.lieu || x.projet ? h("div", { class: "meta" }, x.lieu || x.projet) : null)))) : h("p", { class: "aide" }, "Rien à heure fixe."));
      return det;
    })));
  }
  vider(zones.semaine, carte);
}

// --- Le conseil du moment (vues/conseil.js) ---
function dessinerConseil() {
  conseil?.maj({ dashboard: donnees });
}
