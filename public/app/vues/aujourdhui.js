// Aujourd'hui : la carte Maintenant (Terminer · Décaler · +15 · Gérer), la
// journée à l'échelle, À trancher, les menacées, briefing et bilan, Demain et
// 7 jours, le conseil du moment. Sur un grand écran, deux colonnes.
// Lectures : /api/dashboard à l'affichage, au retour au premier plan et
// toutes les 5 min quand la fenêtre est visible (jamais en boucle serrée : il
// peut relancer le conseil réfléchi du modèle local).
import { api, ecrire, nouvelId, seg } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, squelette, blocErreur, vide, heure, jourLong, quand, duree, isoLocal, markdown, occupe, confirmer, local } from "../ui.js";
import { couleurProjet } from "../couleurs.js";
import { gerer, terminer, decaler, prolonger, choixTache, choixActivite, resteSur, finEffective, estActivite } from "./gerer.js";

let racine;
let donnees = null; // dashboard
let semaine = null;
let trancher = null;
let rituel = null;
let erreur = null;
let masquees = new Set(); // lignes retirées tout de suite (Terminer, trancher)
let minuteurHorloge = null;
let minuteurLecture = null;
let ctx;
let enLecture = null;

const zones = {};

export default {
  async monter(el, _args, contexte) {
    racine = el;
    ctx = contexte;
    masquees = new Set();
    const maintenant = new Date();
    const titre = h("div", { class: "titres" },
      h("div", { class: "sur-titre" }, jourLong(maintenant.getTime())),
      h("h1", { class: "titre-ecran" }, salutation(maintenant)));
    const rafraichir = bouton("Rafraîchir", { classe: "papier", icone: "rafraichir", titre: "Relire Motion et l'agenda", onclick: (e) => occupe(e.currentTarget, () => charger({ frais: true })) });
    const noter = bouton("Noter", { classe: "plein", icone: "plus", kbd: "N", onclick: () => ctx.noter() });
    for (const k of ["maintenant", "journee", "trancher", "menacees", "rituel", "semaine", "conseil", "retards"]) zones[k] = h("div");
    vider(el,
      h("header", { class: "entete-ecran" }, titre, h("div", { class: "actions-entete" }, rafraichir, noter)),
      h("div", { class: "auj-grille" },
        h("div", { class: "auj-colonne" }, zones.maintenant, zones.journee, zones.retards),
        h("div", { class: "auj-colonne" }, zones.trancher, zones.menacees, zones.rituel, zones.semaine, zones.conseil)));
    ajouterA(zones.maintenant, h("section", { class: "carte maintenant" }, squelette([0.3, 0.8, 0.5], true)));
    ajouterA(zones.journee, h("section", { class: "carte" }, squelette([0.5, 0.9, 0.9, 0.7])));
    ajouterA(zones.trancher, h("section", { class: "carte" }, squelette([0.4, 0.8, 0.6])));
    await charger();
    clearInterval(minuteurHorloge);
    minuteurHorloge = setInterval(() => {
      if (document.visibilityState === "visible" && donnees) {
        dessinerMaintenant();
        dessinerJournee();
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
  },
  actualiser() {
    charger({ discret: true });
  },
};

function salutation(d) {
  const hh = d.getHours();
  return hh < 5 ? "Bonne nuit" : hh < 12 ? "Bonjour" : hh < 18 ? "Bon après-midi" : "Bonsoir";
}

async function charger({ frais = false, discret = false } = {}) {
  if (enLecture) return enLecture;
  enLecture = (async () => {
    const [d, s, t, r] = await Promise.allSettled([
      api(`/api/dashboard${frais ? "?frais=1" : ""}`, { delai: 45000 }),
      api("/api/semaine?jours=7", { delai: 45000 }),
      api("/api/a-trancher", { delai: 30000 }),
      api("/api/rituel", { delai: 45000 }),
    ]);
    if (d.status === "fulfilled") {
      donnees = d.value;
      erreur = null;
    } else {
      erreur = d.reason;
      if (!discret || !donnees) donnees = donnees || null;
    }
    if (s.status === "fulfilled") semaine = s.value;
    if (t.status === "fulfilled") trancher = t.value;
    if (r.status === "fulfilled") rituel = r.value;
    masquees = new Set([...masquees].filter((c) => c.startsWith("tri:")));
    toutDessiner({ erreursSecondaires: { semaine: s.status === "rejected" ? s.reason : null, trancher: t.status === "rejected" ? t.reason : null, rituel: r.status === "rejected" ? r.reason : null } });
    if (frais && d.status === "fulfilled") dire("À jour.", { duree: 1500 });
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
  dessinerTrancher(erreursSecondaires.trancher);
  dessinerMenacees();
  dessinerRituel(erreursSecondaires.rituel);
  dessinerSemaine(erreursSecondaires.semaine);
  dessinerConseil();
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

const pucesProjet = (p) => (p ? h("span", { class: "puce" }, h("span", { class: "point", style: { background: couleurProjet(p) } }), h("span", null, p)) : null);

function retirerLigne(id) {
  masquees.add(id);
  dessinerMaintenant();
  dessinerJournee();
  dessinerRetards();
}
function remettreLigne(id) {
  masquees.delete(id);
  dessinerMaintenant();
  dessinerJournee();
  dessinerRetards();
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
        bouton("En parler à Rémy", { classe: "papier", icone: "remy", onclick: () => demanderARemy(`À propos de « ${e.titre} » (${heure(e.debut)}) : `) })));
  } else if (p.cas === "suivant") {
    const e = p.e;
    const decalerBtn = e.type === "tache" || estActivite(e) ? bouton("Décaler", { classe: "papier", icone: "horloge", onclick: () => menuDecaler(e, decalerBtn) }) : null;
    ajouterA(carte, h("div", { class: "tete" }, pucesProjet(e.projet), h("span", { class: "etat-mono" }, "À VENIR")), h("h2", null, e.titre),
      h("p", { class: "detail-maintenant" }, [heure(e.debut), relatifCourt(e.debut - m), e.lieu].filter(Boolean).join(" · ")),
      h("div", { class: "rangee gestes-maintenant" },
        e.type === "tache" ? bouton("Terminer", { classe: "plein", icone: "coche", onclick: () => terminer(e, gestesDe(e)) }) : null,
        decalerBtn,
        bouton("Gérer", { classe: "papier", icone: "curseurs", onclick: () => gerer(e, gestesDe(e)) }),
        bouton("En parler", { classe: "papier", icone: "remy", onclick: () => demanderARemy(e.type === "rdv" ? `Pour « ${e.titre} » à ${heure(e.debut)} : ` : `Pour « ${e.titre} » : `) })));
  } else if (p.cas === "aFaire") {
    const t = sansCreneau(p.t, false);
    const decalerBtn = bouton("Décaler", { classe: "papier", icone: "horloge", onclick: () => menuDecaler(t, decalerBtn) });
    ajouterA(carte, h("div", { class: "tete" }, pucesProjet(t.projet), h("span", { class: "etat-mono" }, "À FAIRE AUJOURD'HUI")), h("h2", null, t.titre),
      p.total > 1 ? h("p", { class: "detail-maintenant" }, `et ${p.total - 1} autre${p.total > 2 ? "s" : ""} tâche${p.total > 2 ? "s" : ""} aujourd'hui`) : null,
      h("div", { class: "rangee gestes-maintenant" },
        bouton("Terminer", { classe: "plein", icone: "coche", onclick: () => terminer(t, gestesDe(t)) }), decalerBtn,
        bouton("Gérer", { classe: "papier", icone: "curseurs", onclick: () => gerer(t, gestesDe(t)) })));
  } else if (p.cas === "rien") {
    ajouterA(carte, h("h2", { class: "titre-section" }, "Temps libre"), h("h2", null, "Plus rien de prévu"),
      p.retards ? h("p", { class: "risque", style: { marginTop: "8px" } }, icone("alerte"), p.retards > 1 ? `${p.retards} tâches en retard` : "Une tâche en retard") : null,
      p.retards ? h("div", { class: "rangee gestes-maintenant" }, bouton("Par quoi je commence ?", { classe: "papier", icone: "remy", onclick: () => demanderARemy("J'ai du temps libre et des tâches en retard : par quoi je commence ?") })) : null);
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
    choix.map((c) => h("button", { type: "button", class: "puce", onclick: (ev) => occupe(ev.currentTarget, async () => { if (await decaler(e, c.date, { apres })) menu.remove(); }) }, c.libelle)),
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
    return vider(zones.journee, carte);
  }
  const debutJ = new Date(); debutJ.setHours(0, 0, 0, 0);
  const minDe = (ms) => (ms - debutJ.getTime()) / 60e3;
  const h0 = Math.max(0, Math.min(8 * 60, Math.floor(Math.min(...items.map((e) => minDe(e.debut))) / 60) * 60));
  const h1 = Math.min(24 * 60, Math.max(20 * 60, Math.ceil(Math.max(...items.map((e) => minDe(finEffective(e)))) / 60) * 60));
  const PX = 1.1; // pixels par minute
  const echelle = h("div", { class: "echelle", style: { height: `${(h1 - h0) * PX}px` } });
  for (let t = h0; t <= h1; t += 60) {
    const y = (t - h0) * PX;
    ajouterA(echelle, h("div", { class: "trait-heure", style: { top: `${y}px` } }), h("span", { class: "heure-repere" , style: { top: `${y}px` } }, `${String(t / 60).padStart(2, "0")}:00`));
  }
  // Les chevauchements : chaque élément prend une colonne libre de son groupe.
  const tries = [...items].sort((a, b) => a.debut - b.debut);
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
    const top = (minDe(e.debut) - h0) * PX;
    const haut = Math.max(24, (minDe(finEffective(e)) - minDe(e.debut)) * PX - 2);
    const { col, n } = places.get(e);
    const st = etat(e, m);
    const bloc = h("button", {
      type: "button",
      class: `bloc ${e.type === "rdv" ? "rdv" : "tache"} ${st}${haut < 40 ? " court" : ""}`,
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
  ajouterA(carte, echelle);
  vider(zones.journee, carte);
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

// --- À trancher ---
const GESTES = {
  carte: [["oui", "Oui"], ["non", "Non"], ["plusTard", "Plus tard"]],
  doublon: [["fusionner", "Fusionner"], ["plusTard", "Plus tard"]],
  rappel: [["supprimer", "Supprimer"], ["plusTard", "Plus tard"]],
  articles: [["retirer", "Retirer"], ["plusTard", "Plus tard"]],
  idee: [["garder", "Gardée"], ["supprimer", "Supprimer"], ["plusTard", "Plus tard"]],
  fil: [["supprimer", "Supprimer"], ["plusTard", "Plus tard"]],
  retard: [["fait", "Fait"], ["demain", "Demain"], ["abandonner", "Abandonner"]],
};
const PRINCIPAUX = new Set(["oui", "fusionner", "retirer", "fait"]);
let trancherTout = false;

function lignesTrancher() {
  if (!trancher) return [];
  const lignes = [];
  for (const g of trancher.groupes || []) for (const l of g.lignes || []) lignes.push({ ...l, groupe: g.titre });
  for (const l of trancher.retards || []) lignes.push({ ...l, groupe: "Retards" });
  return lignes.filter((l) => !masquees.has(`tri:${l.cle}`));
}

function dessinerTrancher(err) {
  const lignes = lignesTrancher();
  const carte = h("section", { class: "carte", "aria-label": "À trancher" });
  ajouterA(carte, h("h2", { class: "titre-section" }, "À trancher", lignes.length ? h("span", { class: "compte" }, String(lignes.length)) : null,
    trancher?.reportes ? h("span", { class: "fin aide" }, `${trancher.reportes} reporté${trancher.reportes > 1 ? "s" : ""}`) : null));
  if (!trancher && err) ajouterA(carte, blocErreur(err, () => charger()));
  else if (!trancher) ajouterA(carte, squelette([0.6, 0.8]));
  else if (!lignes.length) ajouterA(carte, vide("Rien à trancher", "Les cartes en attente, doublons et vieux rappels s'afficheront ici."));
  else {
    const montrees = trancherTout ? lignes : lignes.slice(0, 5);
    ajouterA(carte, h("ul", { class: "liste" }, montrees.map((l) => h("li", { class: "sujet" },
      h("div", { class: "corps" },
        h("div", { class: "titre-ligne" }, l.texte),
        h("div", { class: "meta aide" }, [l.groupe, l.detail].filter(Boolean).join(" · ")),
        h("div", { class: "rangee serree", style: { marginTop: "6px" } },
          (GESTES[l.type] || [["plusTard", "Plus tard"]]).map(([g, lib]) => h("button", { type: "button", class: `btn petit ${PRINCIPAUX.has(g) ? "plein" : "papier"}`, onclick: (ev) => occupe(ev.currentTarget, () => agirTri(g, l)) }, lib)),
          l.convId ? h("a", { class: "btn texte petit", href: `#/remy/${seg(l.convId)}` }, "Voir") : null))))));
    if (lignes.length > 5) ajouterA(carte, bouton(trancherTout ? "Moins" : `Tout voir (${lignes.length})`, { classe: "texte petit", onclick: () => { trancherTout = !trancherTout; dessinerTrancher(); } }));
  }
  vider(zones.trancher, carte);
}

function masquerTri(l) {
  masquees.add(`tri:${l.cle}`);
  dessinerTrancher();
}
function montrerTri(l) {
  masquees.delete(`tri:${l.cle}`);
  dessinerTrancher();
}

async function agirTri(g, l) {
  try {
    if (g === "plusTard") {
      await ecrire("/api/a-trancher/reports", { cle: l.cle, jours: 7 });
      masquerTri(l);
      dire("Revient dans une semaine.", { action: { libelle: "Annuler", faire: async () => { await api(`/api/a-trancher/reports/${seg(l.cle)}`, { methode: "DELETE" }).catch(direErreur); montrerTri(l); } } });
    } else if (g === "oui" && l.type === "carte") {
      if (l.source === "regle") {
        await ecrire(`/api/conversations/${seg(l.convId)}/propositions/${seg(l.propositionId)}/regle`, {});
        masquerTri(l);
        dire("Règle créée.", { genre: "succes" });
      } else if (l.source === "carnet") {
        await ecrire(`/api/conversations/${seg(l.convId)}/propositions/${seg(l.propositionId)}/carnet`, {});
        masquerTri(l);
        dire("C'est fait.", { genre: "succes" });
      } else {
        const chemin = l.source === "agenda" ? "/api/google/apply" : "/api/motion/apply";
        const r = await ecrire(chemin, { actions: [], convId: l.convId, propositionId: l.propositionId }, { delai: 150000 });
        if (r?.etat === "echouee") throw new Error(r.results?.find((x) => !x.ok)?.erreur || "raison inconnue");
        masquerTri(l);
        dire("C'est fait.", { genre: "succes", action: r?.ledgerId ? { libelle: "Annuler", faire: () => ecrire(l.source === "agenda" ? "/api/google/undo" : "/api/motion/undo", { id: r.ledgerId }).then(() => { dire("Annulé."); montrerTri(l); apres(); }).catch(direErreur) } : null });
        apres();
      }
    } else if (g === "non") {
      await ecrire(`/api/conversations/${seg(l.convId)}/propositions/${seg(l.propositionId)}/refus`, {});
      masquerTri(l);
      dire("Écartée : rien n'a été changé.", { action: { libelle: "Annuler", faire: async () => { await ecrire("/api/a-trancher/rouvrir", { propositionId: l.propositionId }).catch(direErreur); montrerTri(l); } } });
    } else if (g === "fusionner") {
      for (const id of l.doublons || []) await api(`/api/rappels/${seg(id)}`, { methode: "DELETE" });
      masquerTri(l);
      dire(`Fusionnés : « ${l.texte} » ne reste qu'une fois.`, { genre: "succes" });
    } else if (g === "supprimer" && l.type === "rappel") {
      if (!(await confirmer(`Supprimer le rappel « ${l.texte} » ?`, { libelle: "Supprimer", danger: true }))) return;
      await api(`/api/rappels/${seg(l.rappelId)}`, { methode: "DELETE" });
      masquerTri(l);
      dire("Rappel supprimé.", { genre: "succes" });
    } else if (g === "retirer") {
      const listes = (await api("/api/listes")).listes || [];
      const liste = listes.find((x) => x.id === l.listeId);
      const ids = (liste?.elements || []).filter((e) => e.fait).map((e) => e.id);
      if (ids.length) await ecrire(`/api/listes/${seg(l.listeId)}/retirer`, { ids });
      masquerTri(l);
      dire(ids.length ? `${ids.length} article${ids.length > 1 ? "s" : ""} retiré${ids.length > 1 ? "s" : ""}.` : "Déjà retirés.", { genre: "succes" });
    } else if (g === "garder" || (g === "supprimer" && l.type === "idee")) {
      if (g === "garder") await ecrire(`/api/dossiers/${seg(l.dossierId)}/notes`, { notes: [{ id: l.noteId, texte: l.texte, fait: true }] });
      else await api(`/api/dossiers/${seg(l.dossierId)}/notes/${seg(l.noteId)}`, { methode: "DELETE" });
      masquerTri(l);
      dire(g === "garder" ? "Gardée dans « Idées », marquée relue." : "Idée supprimée.", {
        genre: "succes",
        action: { libelle: "Annuler", faire: async () => { await ecrire(`/api/dossiers/${seg(l.dossierId)}/notes`, { notes: [{ id: l.noteId, texte: l.texte, fait: false }] }).catch(direErreur); montrerTri(l); } },
      });
    } else if (g === "supprimer" && l.type === "fil") {
      if (!(await confirmer(`Supprimer la conversation « ${l.texte} » ?`, { libelle: "Supprimer", danger: true }))) return;
      await api(`/api/conversations/${seg(l.convId)}`, { methode: "DELETE" });
      masquerTri(l);
      dire("Fil supprimé.", { genre: "succes" });
    } else if (g === "fait" && l.tacheId) {
      masquerTri(l);
      terminer({ type: "tache", id: l.tacheId, titre: l.texte }, { retirer: () => {}, remettre: () => montrerTri(l), apres });
    } else if (g === "demain" && l.tacheId) {
      if (await decaler({ type: "tache", id: l.tacheId, titre: l.texte }, echeanceDemain(), { apres })) masquerTri(l);
    } else if (g === "abandonner" && l.tacheId) {
      if (!(await confirmer(`Abandonner « ${l.texte} » ?`, { detail: "Elle est retirée de ton planning (marquée faite dans Motion). Annulable.", libelle: "Abandonner", danger: true }))) return;
      const r = await ecrire("/api/motion/apply", { actions: [{ type: "terminer", nom: l.texte, id: l.tacheId }], resume: "Abandonnée (tri des retards)", idCommande: nouvelId() }, { delai: 150000 });
      if ((r?.echecs ?? 0) > 0) throw new Error(r.results?.[0]?.erreur || "raison inconnue");
      masquerTri(l);
      dire(`« ${l.texte} » abandonnée : retirée de ton planning.`, { genre: "succes", action: r?.ledgerId ? { libelle: "Annuler", faire: () => ecrire("/api/motion/undo", { id: r.ledgerId }).then(() => { montrerTri(l); apres(); }).catch(direErreur) } : null });
      apres();
    }
  } catch (err) {
    direErreur(err, () => agirTri(g, l), "Pas fait");
  }
}
const echeanceDemain = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 23, 0);
};

// --- Menacées ---
function dessinerMenacees() {
  const liste = (donnees?.menacees || []).filter((t) => !masquees.has(t.id));
  if (!liste.length) return vider(zones.menacees);
  vider(zones.menacees, h("section", { class: "carte", "aria-label": "Menacées" },
    h("h2", { class: "titre-section" }, "Menacées", h("span", { class: "compte" }, String(liste.length))),
    h("ul", { class: "liste" }, liste.map((t) => h("li", { class: "sujet menacee" },
      h("span", { class: "risque", style: { marginTop: "3px" } }, icone("alerte")),
      h("div", { class: "corps" },
        h("div", { class: "titre-ligne" }, t.titre),
        h("p", { class: "phrase" }, t.phrase),
        t.action ? h("div", { class: "rangee serree", style: { marginTop: "6px" } },
          t.action.type === "repousser" && t.action.echeance
            ? bouton(t.action.libelle, { classe: "papier petit", onclick: (ev) => occupe(ev.currentTarget, () => decaler({ type: "tache", id: t.id, titre: t.titre }, new Date(t.action.echeance), { apres })) })
            : bouton(t.action.libelle || "En parler à Rémy", { classe: "papier petit", icone: "remy", onclick: () => demanderARemy(`Peux-tu caser « ${t.titre} » aujourd'hui ? ${t.phrase}`) })) : null))))));
}

// --- Briefing du matin et bilan du soir ---
function dessinerRituel(err) {
  const blocs = [];
  const b = donnees?.briefing;
  const items = (b?.items || []).filter((x) => x.etat === "ouvert");
  if (b?.text) {
    const corps = items.length
      ? h("ul", { class: "liste" }, items.map((s) => h("li", { class: "sujet" },
        h("div", { class: "corps md" , html: markdown(s.texte) }),
        h("div", { class: "rangee serree" },
          bouton("", { classe: "texte petit", icone: "coche", etiquette: "Traité", titre: "Traité", onclick: (ev) => occupe(ev.currentTarget, () => etatSujet(s, "traite")) }),
          bouton("", { classe: "texte petit", icone: "fermer", etiquette: "Ignorer", titre: "Ignorer", onclick: (ev) => occupe(ev.currentTarget, () => etatSujet(s, "ignore")) })))))
      : h("p", { class: "aide" }, "Tous les sujets de la nuit sont traités.");
    blocs.push(h("section", { class: "carte", "aria-label": "Briefing du matin" },
      h("h2", { class: "titre-section" }, "Briefing du matin", b.generatedAt ? h("span", { class: "fin aide" }, `cette nuit, ${heure(b.generatedAt)}`) : null), corps));
  }
  const soir = rituel?.soir;
  if (soir && new Date().getHours() >= 16) blocs.push(carteBilan(soir));
  else if (!rituel && err) blocs.push(h("section", { class: "carte" }, h("h2", { class: "titre-section" }, "Bilan du soir"), blocErreur(err, () => charger())));
  vider(zones.rituel, blocs);
}

async function etatSujet(s, etat) {
  try {
    await api("/api/briefing/etat", { methode: "PUT", corps: { id: s.id, etat } });
    s.etat = etat;
    dessinerRituel();
    dire(etat === "traite" ? "Sujet traité." : "Sujet ignoré.", { action: { libelle: "Annuler", faire: async () => { await api("/api/briefing/etat", { methode: "PUT", corps: { id: s.id, etat: "ouvert" } }).catch(direErreur); s.etat = "ouvert"; dessinerRituel(); } } });
  } catch (err) {
    direErreur(err, null, "Pas enregistré");
  }
}

function carteBilan(soir) {
  const reste = soir.reste || [];
  const champ = h("textarea", { class: "champ", rows: 2, placeholder: "Une ligne pour Rémy (facultatif)", "aria-label": "Comment ça s'est passé ?" });
  const ranger = bouton("Ranger pour la nuit", { classe: "papier", icone: "lune" });
  ranger.addEventListener("click", () => occupe(ranger, async () => {
    try {
      const r = await ecrire("/api/rituel/bilan", { ressenti: champ.value.trim() });
      dire(r?.phrase || "Bilan rangé.", { genre: "succes" });
      ranger.disabled = true;
      ranger.querySelector(".lib").textContent = "Rangé pour la nuit";
    } catch (err) {
      direErreur(err, null, "Bilan pas rangé");
    }
  }));
  const pousser = reste.length ? bouton("Tout ce qui reste → demain", { classe: "plein", icone: "fleche" }) : null;
  pousser?.addEventListener("click", () => occupe(pousser, async () => {
    try {
      const actions = reste.map((t) => ({ type: "modifier", nom: t.titre, echeance: isoLocal(new Date(t.versDemain)), id: t.id }));
      const r = await ecrire("/api/motion/apply", { actions, resume: "Bilan du soir : tout ce qui reste → demain", idCommande: nouvelId() }, { delai: 180000 });
      const rates = (r?.results || []).filter((x) => !x.ok);
      dire(rates.length ? `${actions.length - rates.length} poussées à demain ; ${rates.length} refusée${rates.length > 1 ? "s" : ""}.` : "Poussé à demain. Motion recalcule.", {
        genre: rates.length ? "erreur" : "succes",
        action: r?.ledgerId ? { libelle: "Annuler", faire: () => ecrire("/api/motion/undo", { id: r.ledgerId }).then(apres).catch(direErreur) } : null,
      });
      apres();
    } catch (err) {
      direErreur(err, null, "Pas poussé à demain");
    }
  }));
  const bloc = (titre, lignes, videTexte) => h("div", { style: { marginTop: "10px" } }, h("div", { class: "etat-mono" }, `${titre}${lignes.length ? ` (${lignes.length})` : ""}`),
    lignes.length ? h("ul", { style: { margin: "6px 0 0 18px" } }, lignes.map((t) => h("li", null, t))) : h("p", { class: "aide" }, videTexte));
  return h("section", { class: "carte", "aria-label": "Bilan du soir" },
    h("h2", { class: "titre-section" }, "Bilan du soir"),
    h("p", { class: "carte-titre" }, soir.phrase || ""),
    soir.avertissement ? h("p", { class: "risque", style: { marginTop: "6px" } }, icone("alerte"), soir.avertissement) : null,
    bloc("Fait", (soir.fait || []).map((x) => (typeof x === "string" ? x : x.titre)), "Rien coché dans Rémy aujourd'hui."),
    bloc("A glissé", (soir.glisse || []).map((x) => x.titre), "Rien n'a glissé de son créneau."),
    bloc("Reste pour aujourd'hui", reste.map((x) => x.titre), "Rien ne reste : bravo."),
    pousser ? h("div", { class: "rangee", style: { marginTop: "12px" } }, pousser) : null,
    h("hr", { class: "separateur" }),
    h("label", { class: "etiquette-champ" }, "Comment ça s'est passé ?"), champ,
    h("div", { class: "rangee", style: { marginTop: "10px" } }, ranger));
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

// --- Le conseil du moment ---
function dessinerConseil() {
  const c = donnees?.conseil;
  if (!c?.conseil?.texte && !c?.texte) return vider(zones.conseil);
  const texte = c.conseil?.texte || c.texte;
  const pourquoi = c.conseil?.pourquoi || c.pourquoi || [];
  const renouveler = bouton("Renouveler", { classe: "texte petit", icone: "rafraichir", titre: "Demander un nouveau conseil (modèle local)" });
  renouveler.addEventListener("click", () => occupe(renouveler, async () => {
    try {
      const r = await ecrire("/api/conseil/renouveler", { type: c.type || "maintenant" }, { delai: 90000 });
      if (r) donnees.conseil = r;
      dessinerConseil();
    } catch (err) {
      direErreur(err, null, "Pas de nouveau conseil");
    }
  }));
  vider(zones.conseil, h("section", { class: "carte", "aria-label": "Conseil du moment" },
    h("h2", { class: "titre-section" }, "Le conseil du moment", h("span", { class: "fin" }, renouveler)),
    h("div", { class: "conseil" }, h("p", { class: "texte-conseil" }, texte),
      pourquoi.length ? h("ul", null, pourquoi.map((p) => h("li", null, p))) : null)));
}
