// Démarrage du site : session, charpente (rail à gauche, onglets en bas sous
// 720 px), routeur `#/…`, raccourcis clavier (N, /, Ctrl+K, Ctrl+1…5, ?),
// bandeau « tour injoignable », pont vers l'app Windows, file d'envoi.
import { api, evenements, chargerVersion, versionTour, sait, sonder, tourJoignable } from "./api.js";
import { h, vider, icone, bouton, dire, feuille, kbd, ctrl, squelette, appliquerTheme, themeChoisi, occupe } from "./ui.js";
import * as bureau from "./bureau.js";
import * as fileEnvoi from "./file-envoi.js";

const params = new URLSearchParams(location.search);
export const modeNoter = params.get("fenetre") === "noter";

// --- Les vues ---
export const VUES = [
  { id: "aujourdhui", titre: "Aujourd'hui", icone: "aujourdhui", charger: () => import("./vues/aujourdhui.js") },
  { id: "remy", titre: "Rémy", icone: "remy", charger: () => import("./vues/remy.js"), plein: true },
  { id: "projets", titre: "Projets", icone: "projets", charger: () => import("./vues/projets.js") },
  { id: "conversations", titre: "Conversations", icone: "conversations", charger: () => import("./vues/conversations-externes.js"), si: () => sait("conversations-externes-v1") || sait("conversations-externes") },
  { id: "reglages", titre: "Réglages", icone: "reglages", charger: () => import("./vues/reglages.js") },
];
const vuesVisibles = () => VUES.filter((v) => !v.si || v.si());

let racine;
let contenu;
let zoneVue;
let bandeauReseau;
let vueCourante = null; // { def, module, el, cle }
let routeCourante = null;

/** Va à une route (« aujourdhui », « remy/c1 », « reglages/ordinateur »). */
export function aller(route) {
  const cible = `#/${String(route).replace(/^#?\/?/, "")}`;
  if (location.hash === cible) afficher();
  else location.hash = cible;
}
export const route = () => routeCourante;

function lireRoute() {
  const brut = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const [id, ...reste] = brut.split("/").filter(Boolean);
  const def = vuesVisibles().find((v) => v.id === id) || VUES[0];
  return { def, args: def.id === id ? reste : [], brut };
}

async function afficher() {
  const { def, args, brut } = lireRoute();
  routeCourante = brut;
  majNavigation(def.id);
  // Même vue, autre argument (une autre conversation, un autre réglage) : la vue suit.
  if (vueCourante?.def.id === def.id && vueCourante.module?.suivre) {
    vueCourante.module.suivre(args);
    return;
  }
  vueCourante?.module?.demonter?.();
  const el = h("main", { class: def.plein ? "zone-pleine" : "ecran", id: "contenu-principal", tabindex: "-1" });
  vider(zoneVue, el);
  if (!def.plein) el.append(h("div", { class: "carte" }, squelette([0.4, 0.9, 0.7, 0.8], true)));
  document.title = `${def.titre} · Rémy`;
  const cle = Symbol(def.id);
  vueCourante = { def, el, cle, module: null };
  let module;
  try {
    module = (await def.charger()).default;
  } catch (err) {
    console.error(err);
    if (vueCourante?.cle !== cle) return;
    vider(el, h("div", { class: "carte" }, h("p", null, "Cette vue n'a pas pu se charger. Recharge la page (Ctrl+R) ; si ça continue, la tour n'est peut-être pas à jour.")));
    return;
  }
  if (vueCourante?.cle !== cle) return;
  vueCourante.module = module;
  vider(el);
  try {
    await module.monter(el, args, contexte);
  } catch (err) {
    console.error(err);
    if (vueCourante?.cle === cle) dire(`Cette vue a rencontré une erreur : ${err.message}`, { genre: "erreur", action: { libelle: "Recharger", faire: () => location.reload() } });
  }
}

/** Ce que les vues reçoivent. */
export const contexte = {
  aller,
  noter: (texte) => ouvrirNoter(texte),
  majCompteurs: () => majCompteurs(),
};

// --- Charpente ---
function lienRail(v, i) {
  return h("a", { class: "rail-lien", href: `#/${v.id}`, dataset: { vue: v.id }, title: `${v.titre} (${ctrl}+${i + 1})` },
    icone(v.icone), h("span", { class: "lib" }, v.titre), h("span", { class: "kbd kbd-raccourci" }, `${ctrl} ${i + 1}`));
}

function construire() {
  racine = document.getElementById("app");
  const visibles = vuesVisibles();
  const rail = h("aside", { class: "rail", "aria-label": "Navigation" },
    h("a", { class: "marque", href: "#/aujourdhui", "aria-label": "Rémy, aujourd'hui" },
      h("span", { class: "marque-r", "aria-hidden": "true" }, "R"), h("span", { class: "marque-mot" }, "RÉMY")),
    bouton("Noter", { classe: "plein large rail-noter", icone: "plus", kbd: "N", titre: "Noter quelque chose (N)", onclick: () => ouvrirNoter() }),
    h("nav", null, visibles.map((v, i) => lienRail(v, i))),
    h("div", { class: "rail-pied" },
      h("button", { class: "rail-recherche", type: "button", onclick: () => ouvrirPalette(), title: `Palette de commandes (${ctrl}+K)` },
        icone("recherche"), h("span", { class: "lib" }, "Chercher…"), h("span", { class: "kbd" }, `${ctrl} K`)),
      h("div", { class: "etat-tour", id: "etat-tour" }, h("span", { class: "point" }), h("span", { class: "lib", id: "etat-tour-texte" }, "Tour en ligne"))));
  const onglets = h("nav", { class: "onglets", "aria-label": "Onglets" },
    ["aujourdhui", "remy", "+", "projets", "reglages"].map((id) => {
      if (id === "+") return h("button", { class: "onglet plus", type: "button", "aria-label": "Noter", onclick: () => ouvrirNoter() }, h("span", { class: "rond" }, icone("plus")));
      const v = VUES.find((x) => x.id === id);
      return h("a", { class: "onglet", href: `#/${v.id}`, dataset: { vue: v.id } }, icone(v.icone), h("span", null, v.titre));
    }));
  bandeauReseau = h("div", { class: "bandeau-reseau", hidden: true, role: "alert" });
  zoneVue = h("div", { class: "zone-vue" });
  contenu = h("div", { class: "contenu" }, bandeauReseau, zoneVue);
  vider(racine, h("a", { class: "lien-evitement", href: "#contenu-principal" }, "Aller au contenu"), rail, contenu, onglets);
  racine.className = "app";
}

function majNavigation(id) {
  for (const a of document.querySelectorAll("[data-vue]")) {
    if (a.dataset.vue === id) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

/** Les compteurs du rail (captures en attente…). */
export function majCompteurs() {
  const n = fileEnvoi.compte();
  const texte = document.getElementById("etat-tour-texte");
  if (texte && tourJoignable()) texte.textContent = n ? `${n} en attente d'envoi` : "Tour en ligne";
}

// --- Tour injoignable ---
let relance = null;
function horsLigne() {
  document.getElementById("etat-tour")?.classList.add("hors-ligne");
  const t = document.getElementById("etat-tour-texte");
  if (t) t.textContent = "Tour injoignable";
  if (!bandeauReseau) return;
  const btn = bouton("Réessayer", { classe: "petit", icone: "rafraichir", onclick: (e) => occupe(e.currentTarget, verifierTour) });
  vider(bandeauReseau, icone("alerte"), h("span", null, "La tour ne répond pas."),
    h("span", { class: "detail" }, `Vérifie que le PC est allumé et que Tailscale est connecté (${location.host}). Ce que tu notes attend ici et partira tout seul.`), btn);
  bandeauReseau.hidden = false;
  clearInterval(relance);
  relance = setInterval(verifierTour, 20000);
}
function enLigne() {
  document.getElementById("etat-tour")?.classList.remove("hors-ligne");
  if (bandeauReseau) bandeauReseau.hidden = true;
  clearInterval(relance);
  relance = null;
  majCompteurs();
  fileEnvoi.vider().then(majCompteurs).catch(() => {});
}
async function verifierTour() {
  const ok = await sonder();
  if (ok) {
    if (bandeauReseau && !bandeauReseau.hidden) dire("La tour répond de nouveau.", { genre: "succes" });
    enLigne();
    vueCourante?.module?.actualiser?.();
  } else {
    horsLigne();
  }
}

// --- Noter et palette (chargés à la demande) ---
export async function ouvrirNoter(texte = "") {
  const m = await import("./vues/noter.js");
  m.ouvrirNoter({ texte, contexte });
}
export async function ouvrirPalette() {
  const m = await import("./palette.js");
  m.ouvrir({ contexte, vues: vuesVisibles(), vueCourante: () => vueCourante });
}

function aideRaccourcis() {
  const ligne = (texte, ...touches) => [h("dt", null, texte), h("dd", null, kbd(...touches))];
  feuille({
    titre: "Raccourcis clavier",
    contenu: h("dl", { class: "raccourcis" },
      ligne("Noter quelque chose", "N"),
      ligne("Chercher dans la vue", "/"),
      ligne("Palette de commandes", ctrl, "K"),
      ...vuesVisibles().map((v, i) => ligne(v.titre, ctrl, String(i + 1))),
      ligne("Envoyer (Rémy, Noter)", "Entrée"),
      ligne("Aller à la ligne", "Maj", "Entrée"),
      ligne("Fermer une fenêtre", "Échap"),
      ligne("Cette aide", "?")),
  });
}

const dansUnChamp = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function clavier(e) {
  if (e.defaultPrevented) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    ouvrirPalette();
    return;
  }
  if ((mod || e.altKey) && !e.shiftKey && /^[1-5]$/.test(e.key)) {
    const v = vuesVisibles()[Number(e.key) - 1];
    if (v) {
      e.preventDefault();
      aller(v.id);
    }
    return;
  }
  if (mod || e.altKey) return;
  if (document.querySelector("dialog[open]")) return;
  if (dansUnChamp(document.activeElement)) return;
  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    ouvrirNoter();
  } else if (e.key === "/") {
    e.preventDefault();
    if (vueCourante?.module?.chercher) vueCourante.module.chercher();
    else ouvrirPalette();
  } else if (e.key === "?") {
    e.preventDefault();
    aideRaccourcis();
  }
}
export { aideRaccourcis };

// --- Session ---
async function demarrerSession() {
  let v;
  try {
    v = await chargerVersion();
  } catch (err) {
    // Hors ligne, « Noter » marche quand même : la note attend dans la file.
    if (modeNoter) return demarrerNoter();
    if (err.nature === "reseau" || err.nature === "delai") return ecranTourInjoignable(err);
    throw err;
  }
  if (!v?.serveur) return ecranConnexion();
  if (modeNoter) return demarrerNoter();
  construire();
  window.addEventListener("hashchange", afficher);
  if (!location.hash) history.replaceState(null, "", "#/aujourdhui");
  await afficher();
  majCompteurs();
  fileEnvoi.vider().then(majCompteurs).catch(() => {});
  bureau.demarrer({ aller, ouvrirNoter, contexte }).catch((err) => console.warn("Pont bureau :", err));
}

async function ecranConnexion() {
  const m = await import("./vues/connexion.js");
  m.monter(document.getElementById("app"), { surConnecte: () => location.reload() });
}

function ecranTourInjoignable(err) {
  const app = document.getElementById("app");
  app.className = "connexion";
  const btn = bouton("Réessayer", { classe: "plein", icone: "rafraichir", onclick: (e) => occupe(e.currentTarget, async () => {
    if (await sonder()) location.reload();
    else dire("Toujours rien : la tour ne répond pas.", { genre: "erreur" });
  }) });
  vider(app, h("div", { class: "carte" },
    h("span", { class: "marque-r", "aria-hidden": "true", style: { width: "44px", height: "44px", fontSize: "24px", borderRadius: "13px" } }, "R"),
    h("h1", null, "La tour ne répond pas"),
    h("p", { class: "aide" }, err.message),
    h("p", { class: "aide", style: { marginTop: "8px" } }, `Adresse : ${location.origin}`),
    h("div", { class: "rangee", style: { marginTop: "18px" } }, btn,
      bouton("Noter quand même", { classe: "papier", icone: "plus", kbd: "N", onclick: () => ouvrirNoter() }),
      bureau.estBureau() ? bouton("Changer l'adresse", { classe: "papier", onclick: () => bureau.changerAdresse() }) : null),
    h("p", { class: "aide", style: { marginTop: "12px" } }, "Ce que tu notes ici attend sur cet ordinateur et part tout seul quand la tour répond.")));
  setTimeout(async () => {
    if (await sonder()) location.reload();
  }, 30000);
}

async function demarrerNoter() {
  document.body.classList.add("mode-noter");
  const m = await import("./vues/noter.js");
  await m.monterFenetre(document.getElementById("app"), { contexte });
  bureau.demarrer({ aller, ouvrirNoter, contexte, fenetre: "noter" }).catch((err) => console.warn("Pont bureau :", err));
}

// --- Lancement ---
function lancer() {
  appliquerTheme(themeChoisi());
  evenements.addEventListener("hors-ligne", horsLigne);
  evenements.addEventListener("en-ligne", enLigne);
  evenements.addEventListener("session-perdue", () => {
    if (document.querySelector(".connexion")) return;
    vueCourante?.module?.demonter?.();
    vueCourante = null;
    ecranConnexion();
  });
  document.addEventListener("keydown", clavier);
  // Revenue au premier plan : la vue relit ce qui a pu changer, la file part.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    vueCourante?.module?.actualiser?.();
    if (fileEnvoi.compte()) fileEnvoi.vider().then(majCompteurs).catch(() => {});
  });
  window.addEventListener("online", () => verifierTour());
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  demarrerSession().catch((err) => {
    console.error(err);
    const app = document.getElementById("app");
    vider(app, h("div", { class: "connexion" }, h("div", { class: "carte" }, h("h1", null, "Rémy n'a pas pu démarrer"), h("p", { class: "aide" }, err.message),
      h("div", { class: "rangee", style: { marginTop: "16px" } }, bouton("Recharger", { classe: "plein", onclick: () => location.reload() }), h("a", { class: "btn papier", href: "/classique.html" }, "Interface classique")))));
  });
}

lancer();
export { api, versionTour };
