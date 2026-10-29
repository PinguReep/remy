// Les briques de l'interface : éléments, icônes, bandeaux (succès / erreur +
// quoi faire / Annuler), squelettes, feuilles (dialog), confirmations,
// formats d'heure et de date en français, rendu du markdown de Rémy.
// Tout texte venu de la tour passe par textContent (jamais innerHTML brut).

/** Crée un élément : h("button", { class: "btn", onclick }, "Texte", enfant). */
export function h(tag, props, ...enfants) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v; // réservé au markdown déjà échappé
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  ajouter(el, enfants);
  return el;
}
function ajouter(el, enfants) {
  for (const e of enfants.flat(Infinity)) {
    if (e == null || e === false) continue;
    el.append(e instanceof Node ? e : document.createTextNode(String(e)));
  }
}
/** Ajoute des enfants en sautant null/false (l'append natif écrirait « null »). */
export const ajouterA = (el, ...enfants) => {
  ajouter(el, enfants);
  return el;
};
export const vider = (el, ...enfants) => {
  el.replaceChildren();
  ajouter(el, enfants);
  return el;
};

// --- Icônes (traits, 24×24) ---
const CHEMINS = {
  aujourdhui: "M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  remy: "M4 5h16v11H9l-5 4z",
  projets: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  conversations: "M7 8h10M7 12h6M4 4h16v12H8l-4 4z",
  reglages: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  plus: "M12 5v14M5 12h14",
  recherche: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  fermer: "M6 6l12 12M18 6 6 18",
  coche: "M5 12.5 10 17 19 7",
  horloge: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  fleche: "M5 12h14M13 6l6 6-6 6",
  retour: "M19 12H5M11 6l-6 6 6 6",
  cadenas: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  corbeille: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  epingle: "M9 4h6l-1 6 4 3H6l4-3zM12 13v7",
  crayon: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  micro: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  envoyer: "M5 12h14M13 6l6 6-6 6",
  stop: "M7 7h10v10H7z",
  rafraichir: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  alerte: "M12 4 2.5 20h19zM12 10v4M12 17.5v.5",
  chevron: "M9 6l6 6-6 6",
  bas: "M6 9l6 6 6-6",
  menu: "M4 7h16M4 12h16M4 17h16",
  externe: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  liste: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  cloche: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  ampoule: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z",
  lune: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  soleil: "M12 4V2M12 22v-2M4 12H2M22 12h-2M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
  ecran: "M3 5h18v11H3zM8 20h8M12 16v4",
  curseurs: "M4 8h16M4 16h16M9 5v6M15 13v6",
  jauge: "M4 18a8 8 0 1 1 16 0M12 18l4-6",
  compresser: "M4 9h6V3M20 15h-6v6M10 9 3 2M14 15l7 7",
  lecture: "M7 5v14l11-7z",
  pause: "M8 5v14M16 5v14",
  plusquinze: "M12 7v5l3 2M12 3a9 9 0 1 0 9 9",
  dossier: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z",
  copier: "M8 8h12v12H8zM4 16V4h12",
  clavier: "M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 14h10",
};
export function icone(nom, classe = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `ic ${classe}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", CHEMINS[nom] || CHEMINS.chevron);
  svg.append(p);
  return svg;
}

export const kbd = (...touches) => touches.map((t) => h("kbd", null, t));
/** Le raccourci écrit comme sur le clavier de Sam (Ctrl sous Windows, ⌘ sur Mac). */
export const estMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
export const ctrl = estMac ? "⌘" : "Ctrl";

/** Un bouton : bouton("Terminer", { classe: "plein", icone: "coche", kbd: "Entrée", onclick }) */
export function bouton(libelle, { classe = "", icone: ic, kbd: touche, titre, onclick, type = "button", etiquette } = {}) {
  return h("button", { type, class: `btn ${classe}`.trim(), title: titre, "aria-label": etiquette, onclick },
    ic ? icone(ic) : null, libelle ? h("span", { class: "lib" }, libelle) : null, touche ? h("span", { class: "kbd" }, touche) : null);
}

/** Pendant une action : bouton occupé, puis rendu. `faire` rend une promesse. */
export async function occupe(btn, faire) {
  if (!btn) return faire();
  btn.setAttribute("aria-busy", "true");
  btn.disabled = true;
  try {
    return await faire();
  } finally {
    btn.removeAttribute("aria-busy");
    btn.disabled = false;
  }
}

// --- Bandeaux ---
// Une feuille ouverte (showModal) passe dans la couche du dessus et rend tout
// le reste inerte : des bandeaux restés dans le body y seraient floutés et
// sourds aux clics (« Annuler » fermait la feuille au lieu d'annuler). La pile
// suit donc la modale du dessus, et revient au body quand elle se ferme.
let pile;
function pileBandeaux() {
  if (!pile) pile = h("div", { class: "bandeaux", role: "status", "aria-live": "polite" });
  placerBandeaux();
  return pile;
}
const modaleDuDessus = () => {
  const ouvertes = [...document.querySelectorAll("dialog[open]")].filter((d) => {
    try {
      return d.matches(":modal");
    } catch {
      return true;
    }
  });
  return ouvertes[ouvertes.length - 1] || null;
};
/** Met la pile des bandeaux là où on peut la voir et la cliquer. */
export function placerBandeaux({ attendre = true } = {}) {
  if (!pile) return;
  const modale = modaleDuDessus();
  const parent = modale || document.body;
  if (pile.parentElement === parent) return;
  // Pendant l'entrée d'une feuille, sa transformation ferait d'elle le repère
  // de la pile (position: fixed) : on attend la fin de l'animation (180 ms).
  const animations = attendre ? modale?.getAnimations?.() || [] : [];
  if (animations.length) {
    if (!pile.isConnected) document.body.append(pile);
    Promise.allSettled(animations.map((a) => a.finished)).then(() => placerBandeaux({ attendre: false }));
    return;
  }
  parent.append(pile);
  modale?.addEventListener("close", () => placerBandeaux({ attendre: false }), { once: true });
}
/**
 * Dit quelque chose en bas de l'écran. `action` : { libelle, faire } (Annuler,
 * Réessayer…). `genre` : info, succes, erreur. Rend une fonction pour le fermer.
 */
export function dire(message, { action, genre = "info", duree, detail } = {}) {
  const p = pileBandeaux();
  const fermer = () => {
    if (!el.isConnected) return;
    el.classList.add("sort");
    setTimeout(() => el.remove(), 160);
  };
  const el = h("div", { class: `bandeau ${genre}`, role: genre === "erreur" ? "alert" : null },
    h("div", { class: "msg" }, message, detail ? h("small", null, detail) : null),
    action ? h("button", { class: "btn petit", type: "button", onclick: async () => { fermer(); await action.faire(); } }, action.libelle) : null,
    h("button", { class: "btn texte petit", type: "button", "aria-label": "Fermer le message", onclick: fermer }, icone("fermer")));
  while (p.children.length >= 3) p.firstElementChild.remove();
  p.append(el);
  const ms = duree ?? (genre === "erreur" ? 9000 : action ? 6000 : 3800);
  if (ms > 0) setTimeout(fermer, ms);
  return fermer;
}
/** Le texte d'une erreur, quelle que soit sa forme (l'app Windows rejette avec une chaîne). */
export const texteErreur = (err) => (typeof err === "string" ? err : err?.message) || "Erreur inattendue.";
/**
 * Une erreur : son message, et « Réessayer » si on sait refaire. Une chose
 * introuvable (404) ne se réessaie pas : « Rafraîchir » relit l'écran si on
 * sait le faire (`rafraichir`).
 */
export function direErreur(err, reessayer, prefixe, { rafraichir } = {}) {
  if (err?.nature === "annule") return () => {};
  if (err?.nature === "auth") return () => {};
  const msg = (prefixe ? `${prefixe} : ` : "") + texteErreur(err);
  const introuvable = err?.statut === 404;
  const action = introuvable
    ? (rafraichir ? { libelle: "Rafraîchir", faire: rafraichir } : null)
    : reessayer ? { libelle: "Réessayer", faire: reessayer } : null;
  return dire(msg, { genre: "erreur", action });
}

// --- Squelettes et états ---
export function squelette(largeurs = [0.9, 0.62, 0.78], grand = false) {
  return h("div", { class: `squelette${grand ? " grand" : ""}`, "aria-label": "Chargement", role: "status" },
    largeurs.map((l) => h("span", { style: { width: `${Math.round(l * 100)}%` } })));
}
export function vide(titre, texte, action) {
  return h("div", { class: "vide" }, titre ? h("strong", null, titre) : null, texte ? h("p", null, texte) : null,
    action ? h("div", { class: "rangee", style: { marginTop: "10px" } }, action) : null);
}
/** Un bloc d'erreur à la place d'un contenu : le message et « Réessayer ». */
export function blocErreur(err, reessayer) {
  const titre = err?.nature === "reseau" ? "Tour injoignable" : err?.nature === "version" ? "Tour à mettre à jour" : "Pas pu charger";
  return vide(titre, texteErreur(err), reessayer ? bouton("Réessayer", { classe: "papier", icone: "rafraichir", onclick: (e) => occupe(e.currentTarget, reessayer) }) : null);
}

// --- lot chat : icônes de la vue Rémy (appel, privée, étapes, diagnostic) ---
Object.assign(CHEMINS, {
  telephone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  "cadenas-ouvert": "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2",
  "haut-gauche": "M17 17 7 7M7 15V7h8",
  "point-plein": "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  diagnostic: "M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-3M20 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
  plateau: "M4 13h4l1.5 3h5l1.5-3h4M4 13l2-8h12l2 8v6H4z",
  branche: "M7 4v16M7 12c6 0 10-3 10-8M14 4h3v3",
  "puce-calcul": "M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4",
  cerveau: "M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V6a2 2 0 0 0-3-2zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1",
  boussole: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z",
  "calendrier-plus": "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M12 13v5M9.5 15.5h5",
  sablier: "M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9",
});
// --- fin lot chat

// --- Feuilles ---
/**
 * Ouvre une feuille (dialog modale) : Échap ou la croix la ferment, le focus
 * y reste. `contenu` : élément(s) ; `pied` : boutons. Rend { el, fermer, fini }.
 * `avantFermeture(cause)` (« echap », « fond ») : rendre false garde la feuille.
 */
export function feuille({ titre, sousTitre, contenu, pied, large = false, classe = "", surFermeture, avantFermeture } = {}) {
  const corps = h("div", { class: "feuille-corps" }, contenu);
  const d = h("dialog", { class: `feuille ${large ? "large" : ""} ${classe}`.trim(), "aria-label": titre },
    h("div", { class: "feuille-tete" },
      h("div", { class: "titres" }, h("h2", null, titre), sousTitre ? h("p", { class: "sous" }, sousTitre) : null),
      h("button", { class: "btn-fermer", type: "button", "aria-label": "Fermer", onclick: () => fermer() }, h("span", null, icone("fermer")))),
    corps,
    pied ? h("div", { class: "feuille-pied" }, pied) : null);
  let resoudre;
  const fini = new Promise((r) => (resoudre = r));
  const fermer = (valeur) => {
    if (d.open) d.close();
    placerBandeaux({ attendre: false }); // avant de retirer la feuille : la pile y est peut-être
    d.remove();
    surFermeture?.(valeur);
    resoudre(valeur);
  };
  d.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (avantFermeture?.("echap") === false) return;
    fermer();
  });
  d.addEventListener("click", (e) => {
    if (e.target !== d) return;
    // Un clic à côté ne ferme pas une feuille qui a quelque chose à perdre.
    if (avantFermeture?.("fond") === false) return;
    fermer();
  });
  document.body.append(d);
  d.showModal();
  placerBandeaux();
  const premier = d.querySelector("[autofocus]") || d.querySelector(".feuille-corps input, .feuille-corps textarea, .feuille-corps button, .feuille-pied button");
  premier?.focus();
  return { el: d, corps, fermer, fini };
}

/** « Supprimer « X » ? » : rend true si confirmé. */
export function confirmer(question, { detail, libelle = "Confirmer", danger = false } = {}) {
  const f = feuille({
    titre: question,
    contenu: detail ? h("p", { class: "aide" }, detail) : null,
    pied: [
      bouton("Annuler", { classe: "papier", onclick: () => f.fermer(false) }),
      bouton(libelle, { classe: danger ? "danger" : "plein", onclick: () => f.fermer(true) }),
    ],
  });
  f.el.querySelector(".feuille-pied .btn:last-child")?.focus();
  return f.fini.then((v) => v === true);
}

/** Demande un texte (« Renommer », « Raison du blocage »…). Rend le texte ou null. */
export function demanderTexte(titre, { valeur = "", libelle = "Enregistrer", etiquette, placeholder, multiligne = false, aide } = {}) {
  const id = `champ-${Math.random().toString(36).slice(2, 8)}`;
  const champ = multiligne
    ? h("textarea", { class: "champ", id, rows: 3, placeholder })
    : h("input", { class: "champ", id, type: "text", placeholder, autocomplete: "off" });
  champ.value = valeur;
  const valider = (e) => {
    e?.preventDefault();
    const v = champ.value.trim();
    if (!v) return champ.focus();
    f.fermer(v);
  };
  const form = h("form", { onsubmit: valider },
    etiquette ? h("label", { class: "etiquette-champ", for: id }, etiquette) : null, champ,
    aide ? h("p", { class: "aide", style: { marginTop: "6px" } }, aide) : null);
  champ.addEventListener("keydown", (e) => {
    if (multiligne && e.key === "Enter" && !e.shiftKey) valider(e);
  });
  const f = feuille({ titre, contenu: form, pied: [bouton("Annuler", { classe: "papier", onclick: () => f.fermer(null) }), bouton(libelle, { classe: "plein", onclick: valider })] });
  champ.focus();
  champ.select?.();
  return f.fini.then((v) => (typeof v === "string" ? v : null));
}

// --- Formats (heure locale, français) ---
const fmt = (opts) => new Intl.DateTimeFormat("fr-FR", opts);
const F_HEURE = fmt({ hour: "2-digit", minute: "2-digit" });
const F_JOUR_LONG = fmt({ weekday: "long", day: "numeric", month: "long" });
const F_JOUR_COURT = fmt({ weekday: "short", day: "numeric", month: "short" });
const F_DATE = fmt({ day: "numeric", month: "short" });
export const heure = (ms) => (ms == null ? "" : F_HEURE.format(new Date(ms)));
export const jourLong = (ms) => F_JOUR_LONG.format(new Date(ms));
export const jourCourt = (ms) => F_JOUR_COURT.format(new Date(ms));
export const dateCourte = (ms) => F_DATE.format(new Date(ms));
export const debutJour = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const memeJour = (a, b) => debutJour(new Date(a)).getTime() === debutJour(new Date(b)).getTime();
/** « 1 h 15 », « 45 min ». */
export function duree(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${hh} h ${String(r).padStart(2, "0")}` : `${hh} h`;
}
/** « aujourd'hui 14:00 », « demain 9:00 », « jeudi 30 oct. 9:00 », sans heure si `avecHeure` est faux. */
export function quand(ms, { avecHeure = true, maintenant = Date.now() } = {}) {
  if (ms == null) return "";
  const j = Math.round((debutJour(new Date(ms)) - debutJour(new Date(maintenant))) / 86400000);
  const jour = j === 0 ? "aujourd'hui" : j === 1 ? "demain" : j === -1 ? "hier" : j > 1 && j < 7 ? fmt({ weekday: "long" }).format(new Date(ms)) : jourCourt(ms);
  return avecHeure ? `${jour} ${heure(ms)}` : jour;
}
/** « dans 50 min », « dans 2 h », « il y a 5 min ». */
export function relatif(ms, maintenant = Date.now()) {
  const s = Math.round((ms - maintenant) / 1000);
  const a = Math.abs(s);
  const t = a < 60 ? "moins d'une minute" : a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? duree(a / 60) : `${Math.round(a / 86400)} j`;
  return s >= 0 ? `dans ${t}` : `il y a ${t}`;
}
/** Une date ISO avec le fuseau de la machine (« 2026-10-30T23:00:00+01:00 »), comme l'iPhone l'envoie. */
export function isoLocal(d) {
  const z = -d.getTimezoneOffset();
  const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${z >= 0 ? "+" : "-"}${p(z / 60)}:${p(z % 60)}`;
}
/** Pour un <input type="datetime-local"> et retour. */
export const versChampDate = (d) => isoLocal(d).slice(0, 16);
export const depuisChampDate = (v) => (v ? new Date(v) : null);

// --- Markdown (réponses de Rémy) : échappé d'abord, puis un sous-ensemble sûr ---
const echapper = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function enLigne(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}
export function markdown(texte) {
  const lignes = echapper(texte || "").split("\n");
  let html = "";
  let liste = null;
  let code = null;
  let table = null;
  const fermerListe = () => {
    if (liste) html += `</${liste}>`;
    liste = null;
  };
  const fermerTable = () => {
    if (!table) return;
    const [tete, ...corps] = table.filter((l) => !/^\|?\s*:?-{2,}/.test(l.replace(/\s/g, "")));
    const cellules = (l) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => enLigne(c.trim()));
    html += "<table><thead><tr>" + cellules(tete).map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>"
      + corps.map((l) => "<tr>" + cellules(l).map((c) => `<td>${c}</td>`).join("") + "</tr>").join("") + "</tbody></table>";
    table = null;
  };
  for (const l of lignes) {
    if (l.trim().startsWith("```")) {
      fermerListe();
      fermerTable();
      if (code === null) code = [];
      else {
        html += `<pre><code>${code.join("\n")}</code></pre>`;
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(l);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      fermerListe();
      (table ||= []).push(l.trim());
      continue;
    }
    fermerTable();
    let m;
    if ((m = l.match(/^#{1,6}\s+(.*)/))) {
      fermerListe();
      html += `<h4>${enLigne(m[1])}</h4>`;
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      fermerListe();
      html += "<hr>";
    } else if ((m = l.match(/^\s*[-•*]\s+(.*)/))) {
      if (liste !== "ul") {
        fermerListe();
        html += "<ul>";
        liste = "ul";
      }
      html += `<li>${enLigne(m[1])}</li>`;
    } else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (liste !== "ol") {
        fermerListe();
        html += "<ol>";
        liste = "ol";
      }
      html += `<li>${enLigne(m[1])}</li>`;
    } else if (!l.trim()) {
      fermerListe();
    } else {
      fermerListe();
      html += `<p>${enLigne(l)}</p>`;
    }
  }
  if (code !== null) html += `<pre><code>${code.join("\n")}</code></pre>`;
  fermerListe();
  fermerTable();
  return html;
}

/** Retire les marqueurs techniques que Rémy laisse parfois (cartes, outils). */
export const sansMarqueurs = (t) => String(t || "").replace(/<\/?(proposition|outil|tool)[^>]*>/gi, "").replace(/\[\[[a-z-]+:[^\]]*\]\]/gi, "");

/** Le thème choisi (auto, light, dark), appliqué tout de suite. */
export function appliquerTheme(t) {
  try {
    if (t === "light" || t === "dark") localStorage.setItem("remy-theme", t);
    else localStorage.removeItem("remy-theme");
  } catch {}
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
export function themeChoisi() {
  try {
    return localStorage.getItem("remy-theme") || "auto";
  } catch {
    return "auto";
  }
}

/** Petit stockage local tolérant (navigation privée, stockage plein). */
export const local = {
  lire(cle, defaut = null) {
    try {
      const v = localStorage.getItem(cle);
      return v == null ? defaut : JSON.parse(v);
    } catch {
      return defaut;
    }
  },
  ecrire(cle, v) {
    try {
      localStorage.setItem(cle, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  },
  effacer(cle) {
    try {
      localStorage.removeItem(cle);
    } catch {}
  },
};
