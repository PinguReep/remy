// Les rappels, partout où ils se montrent (Projets › Rappels, la carte
// « Rappels du jour » d'Aujourd'hui), comme LigneRappel, QuandRappel,
// EtiquetterRappel, FiltreRappelsVue et LigneTriRappels de l'iPhone :
// cocher, « Quand ? » (reporter, étiquettes, fait, retirer), le clic droit
// (l'appui long), le filtre par étiquettes, « Rappels à traiter », un nouveau
// rappel. Chaque geste a son bandeau « Annuler » ; le rappel garde son
// identifiant : un geste rejoué n'est pas doublé.
import { api, ecrire, seg, sait, nouvelId } from "../api.js";
import { h, vider, icone, bouton, dire, direErreur, feuille, versChampDate, depuisChampDate, occupe, squelette, blocErreur } from "../ui.js";
import { surMenu } from "../menu.js";
import { extraire } from "../analyse/dates.js";
import * as C from "../analyse/carnet.js";

/** Les rappels du jour (Carnet.duJour de l'iPhone) : pas faits, dus avant ce soir minuit (les retards compris). */
export function rappelsDuJour(rappels, maintenant = Date.now()) {
  const d = new Date(maintenant);
  const fin = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return (rappels || []).filter((r) => r && !r.fait && !r.supprime && typeof r.quand === "number" && r.quand < fin).sort((a, b) => a.quand - b.quand);
}

/** Les choix de « Reporter » (les mêmes que l'iPhone, Decaler.rappel). */
export const choixReport = (m = new Date()) => C.choixRappel(m).map((c) => [c.libelle, c.date]);

// --- Les étiquettes du compte : lues au plus une fois par minute ---

let cache = { liste: null, lu: 0, promesse: null };
/** Les étiquettes déjà lues (ou null). */
export const etiquettesConnues = () => cache.liste;
/** Une liste fraîche lue ailleurs (Projets) : gardée ici pour les lignes. */
export function retenirEtiquettes(liste) {
  cache = { liste: Array.isArray(liste) ? liste : [], lu: Date.now(), promesse: null };
}
/** GET /api/etiquettes, au plus une fois par minute sauf `frais` ; une tour sans étiquettes : aucune. */
export function chargerEtiquettes({ frais = false } = {}) {
  if (!sait("etiquettes-v1")) return Promise.resolve(cache.liste || []);
  if (!frais && cache.liste && Date.now() - cache.lu < 60000) return Promise.resolve(cache.liste);
  if (cache.promesse) return cache.promesse;
  const p = api("/api/etiquettes", { delai: 20000 })
    .then((r) => {
      retenirEtiquettes(r?.etiquettes || []);
      return cache.liste;
    })
    .finally(() => {
      if (cache.promesse === p) cache.promesse = null;
    });
  cache.promesse = p;
  return p;
}

// --- Le filtre (gardé sur cet appareil, la même clé que l'iPhone) ---

export function lireFiltreLocal() {
  try {
    return C.lireFiltre(localStorage.getItem(C.CLE_FILTRE));
  } catch {
    return new Set();
  }
}
export function ecrireFiltreLocal(filtre) {
  try {
    const v = C.ecrireFiltre(filtre);
    if (v) localStorage.setItem(C.CLE_FILTRE, v);
    else localStorage.removeItem(C.CLE_FILTRE);
  } catch {}
}

// --- Écrire ---

/** Écrit un rappel tel quel (id fixe) ; `avant` : de quoi annuler. */
export async function ecrireRappel(r, message, { avant, apres } = {}) {
  try {
    await ecrire("/api/rappels", { rappels: [{ id: r.id, texte: r.texte, quand: r.quand ?? null, fait: Boolean(r.fait), etiquettes: r.etiquettes || [] }] });
    dire(message, { genre: "succes", action: avant ? { libelle: "Annuler", faire: () => ecrireRappel(avant, "Annulé.", { apres }) } : null });
    apres?.();
    return true;
  } catch (err) {
    direErreur(err, () => ecrireRappel(r, message, { avant, apres }), "Rappel pas enregistré");
    return false;
  }
}

/** Reporter à `d` (le rappel redevient à faire) ; « Annuler » remet la date et l'état d'avant. */
export const reporterA = (r, d, { apres } = {}) =>
  ecrireRappel({ ...r, quand: d.getTime(), fait: false }, `Rappel : ${C.quandRappel(d.getTime())}.`, { avant: r, apres });

/** Fait / pas encore fait. `retirer()` : l'écran tout de suite ; `remettre()` : si ça n'a pas pris. */
export async function basculerFait(r, { apres, retirer, remettre } = {}) {
  if (!r.fait) retirer?.();
  const ok = await ecrireRappel({ ...r, fait: !r.fait }, r.fait ? "Rouvert." : `« ${r.texte} » : fait.`, { avant: r, apres });
  if (!ok) remettre?.();
  return ok;
}

/** Retirer, avec « Annuler » (la même ligne réécrite revient). */
export async function retirerRappel(r, { apres, retirer, remettre } = {}) {
  try {
    retirer?.();
    await api(`/api/rappels/${seg(r.id)}`, { methode: "DELETE" });
    dire("Rappel retiré.", { action: { libelle: "Annuler", faire: () => ecrireRappel(r, "Rappel remis.", { apres }) } });
    apres?.();
    return true;
  } catch (err) {
    remettre?.();
    direErreur(err, null, "Pas retiré");
    return false;
  }
}

const versCategories = (f) => {
  f?.fermer();
  location.hash = "#/projets/categories";
};

// --- « Quand ? » ---

/**
 * La feuille « Quand ? » (QuandRappel) : reporter en un clic (ou à un moment
 * choisi), ses étiquettes, fait / pas encore fait, le retirer.
 */
export function ouvrirQuand(r, gestes = {}) {
  let f;
  const reporter = (d) => {
    f.fermer();
    reporterA(r, d, gestes);
  };
  const debut = new Date(typeof r.quand === "number" && r.quand > Date.now() ? r.quand : Date.now() + 3600e3);
  const champ = h("input", { class: "champ", type: "datetime-local", min: versChampDate(new Date()) });
  champ.value = versChampDate(debut);
  const lib = h("span", { class: "lib" });
  const valider = h("button", { type: "button", class: "btn plein large" }, icone("horloge"), lib);
  const lire = () => {
    const d = depuisChampDate(champ.value);
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const majLibelle = () => {
    const d = lire();
    lib.textContent = d ? `Reporter : ${C.quandRappel(d.getTime())}` : "Reporter : choisis un moment";
  };
  majLibelle();
  champ.addEventListener("input", majLibelle);
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); valider.click(); } });
  valider.addEventListener("click", () => {
    const d = lire();
    if (!d) return dire("Choisis une date et une heure.", { genre: "erreur" });
    if (d.getTime() < Date.now() - 60e3) return dire("Ce moment est passé : choisis-en un à venir.", { genre: "erreur" });
    reporter(d);
  });
  const choisir = h("div", { class: "rappels-choisir", hidden: true }, h("label", { class: "etiquette-champ" }, "Le", champ), valider);
  const puceChoisir = h("button", { type: "button", class: "puce", "aria-expanded": "false", onclick: () => {
    choisir.hidden = !choisir.hidden;
    puceChoisir.setAttribute("aria-expanded", String(!choisir.hidden));
    if (!choisir.hidden) champ.focus();
  } }, icone("agenda"), "Choisir…");
  f = feuille({
    titre: r.texte,
    sousTitre: typeof r.quand === "number" ? `Prévu ${C.quandRappel(r.quand)}` : "Sans date",
    classe: "rappels-quand",
    contenu: [
      h("h3", { class: "titre-section" }, "Quand ?"),
      h("div", { class: "rangee serree" }, C.choixRappel().map((c) => h("button", { type: "button", class: "puce", onclick: () => reporter(c.date) }, c.libelle)), puceChoisir),
      choisir,
      h("hr", { class: "separateur" }),
      h("div", { class: "rangee" },
        sait("etiquettes-v1") ? bouton("Étiquettes", { classe: "papier extensible", icone: "etiquette", onclick: () => { f.fermer(); ouvrirEtiquettes(r, gestes); } }) : null,
        bouton(r.fait ? "Pas encore fait" : "Fait", { classe: "plein extensible", icone: r.fait ? "retour" : "coche", onclick: () => { f.fermer(); basculerFait(r, gestes); } })),
      h("button", { type: "button", class: "btn texte large rappels-retirer", onclick: () => { f.fermer(); retirerRappel(r, gestes); } }, icone("corbeille"), h("span", { class: "lib" }, "Retirer ce rappel")),
    ],
  });
  f.el.querySelector(".rangee .puce")?.focus();
  return f;
}
/** L'ancien nom (« Reporter ») : la même feuille. */
export const reporter = ouvrirQuand;

// --- « Étiquettes » ---

const ligneCase = (titre, actif, faire, { discret = false } = {}) => {
  const b = h("button", { type: "button", class: `rappels-case${discret ? " discret" : ""}`, role: "checkbox", "aria-checked": String(actif) },
    h("span", { class: "t" }, titre), h("span", { class: "rond", "aria-hidden": "true" }));
  b.addEventListener("click", () => {
    const v = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(v));
    faire(v);
  });
  return b;
};

/**
 * La feuille « Étiquettes » d'un rappel (EtiquetterRappel) : une case ronde
 * par étiquette du compte ; OK écrit les cochées dans l'ordre du compte. Un
 * échec ne change rien et le dit.
 */
export function ouvrirEtiquettes(r, { apres } = {}) {
  const coches = new Set(r.etiquettes || []);
  const corps = h("div", null, squelette([0.6, 0.5, 0.7]));
  let liste = null;
  const ok = bouton("OK", { classe: "plein", onclick: (e) => occupe(e.currentTarget, valider) });
  ok.disabled = true;
  const f = feuille({ titre: "Étiquettes", sousTitre: r.texte, classe: "rappels-etiquettes-feuille", contenu: corps,
    pied: [bouton("Annuler", { classe: "papier", onclick: () => f.fermer() }), ok] });
  async function valider() {
    const ids = C.dansLOrdre(coches, liste);
    const avant = r.etiquettes || [];
    try {
      await ecrire("/api/rappels", { rappels: [{ id: r.id, texte: r.texte, quand: r.quand ?? null, fait: Boolean(r.fait), etiquettes: ids }] });
      f.fermer();
      const noms = C.nomsEtiquettes(ids, liste);
      dire(noms.length ? `Étiquettes : ${noms.join(", ")}.` : "Plus d'étiquette sur ce rappel.", { genre: "succes",
        action: { libelle: "Annuler", faire: () => ecrireRappel({ ...r, etiquettes: avant }, "Annulé.", { apres }) } });
      apres?.();
    } catch (err) {
      direErreur(err, null, "Pas enregistré");
    }
  }
  const remplir = async (frais) => {
    vider(corps, squelette([0.6, 0.5, 0.7]));
    try {
      liste = await chargerEtiquettes({ frais });
    } catch (err) {
      vider(corps, blocErreur(err, () => remplir(true)));
      return;
    }
    ok.disabled = false;
    vider(corps,
      liste.length ? h("div", { class: "rappels-cases", role: "group", "aria-label": "Étiquettes du rappel" },
        liste.map((e) => ligneCase(e.nom, coches.has(e.id), (v) => (v ? coches.add(e.id) : coches.delete(e.id)))))
        : h("p", { class: "aide" }, "Pas encore d'étiquette : crée-les (Voiture, Santé, Pro, Perso…)."),
      h("a", { class: "btn texte petit rappels-gerer", href: "#/projets/categories", onclick: (e) => { e.preventDefault(); versCategories(f); } }, "Gérer les étiquettes…"));
    corps.querySelector("button")?.focus();
  };
  remplir(false);
  return f;
}

// --- Le filtre ---

/**
 * La feuille « Filtrer les rappels » (FiltreRappelsVue) : chaque coche
 * s'applique tout de suite (`surChangement`) et se garde sur cet appareil.
 */
export function ouvrirFiltreRappels({ surChangement } = {}) {
  let filtre = lireFiltreLocal();
  const corps = h("div", null, squelette([0.6, 0.5, 0.7]));
  const pied = h("p", { class: "aide rappels-pied-filtre" }, C.piedFiltre(filtre));
  const maj = () => {
    pied.textContent = C.piedFiltre(filtre);
    toutVoir.disabled = !filtre.size;
    surChangement?.(filtre);
  };
  const toutVoir = bouton("Tout voir", { classe: "papier", onclick: () => {
    filtre = new Set();
    ecrireFiltreLocal(filtre);
    for (const b of corps.querySelectorAll("[role=checkbox]")) b.setAttribute("aria-checked", "false");
    maj();
  } });
  toutVoir.disabled = !filtre.size;
  const basculer = (id, v) => {
    filtre = new Set(filtre);
    if (v) filtre.add(id);
    else filtre.delete(id);
    ecrireFiltreLocal(filtre);
    maj();
  };
  const f = feuille({ titre: "Filtrer les rappels", classe: "rappels-filtre-feuille", contenu: corps,
    pied: [toutVoir, bouton("OK", { classe: "plein", onclick: () => f.fermer() })] });
  const remplir = async (frais) => {
    let liste;
    try {
      liste = await chargerEtiquettes({ frais });
    } catch (err) {
      vider(corps, blocErreur(err, () => remplir(true)));
      return;
    }
    vider(corps,
      h("div", { class: "rappels-cases", role: "group", "aria-label": "Étiquettes à montrer" },
        liste.map((e) => ligneCase(e.nom, filtre.has(e.id), (v) => basculer(e.id, v))),
        ligneCase("Sans étiquette", filtre.has(C.SANS_ETIQUETTE), (v) => basculer(C.SANS_ETIQUETTE, v), { discret: true })),
      pied,
      liste.length ? null : h("p", { class: "aide" }, "Pas encore d'étiquette : crée-les dans « Gérer les étiquettes »."),
      h("a", { class: "btn texte petit rappels-gerer", href: "#/projets/categories", onclick: (e) => { e.preventDefault(); versCategories(f); } }, "Gérer les étiquettes…"));
    corps.querySelector("button")?.focus();
  };
  remplir(false);
  return f;
}

/** Le bouton « Filtrer » / « Filtré (n) » (BoutonFiltreRappels). */
export function boutonFiltre({ surChangement } = {}) {
  const b = h("button", { type: "button", class: "btn texte petit rappels-bouton-filtre" });
  const maj = () => {
    const n = lireFiltreLocal().size;
    const t = C.boutonFiltreTextes(n);
    vider(b, icone("entonnoir"), h("span", { class: "lib" }, t.libelle));
    b.setAttribute("aria-label", t.etiquette);
    b.classList.toggle("actif", n > 0);
  };
  maj();
  b.addEventListener("click", () => ouvrirFiltreRappels({ surChangement: (f) => { maj(); surChangement?.(f); } }));
  return b;
}

// --- « Rappels à traiter » ---

/** La ligne « Rappels à traiter » et sa pastille rouge (LigneTriRappels). */
export function ligneTriRappels(nombre, { ouvrir }) {
  return h("button", { type: "button", class: "rappels-a-traiter", "aria-label": `Rappels à traiter, ${nombre}`, onclick: ouvrir },
    h("span", { class: "boite-icone" }, icone("plateauPlein")),
    h("span", { class: "textes" }, h("strong", null, "Rappels à traiter"), h("span", null, "Une date et une catégorie pour chacun")),
    h("span", { class: "rappels-pastille", "aria-hidden": "true" }, String(nombre)),
    icone("chevron"));
}

// --- Le menu du clic droit (l'appui long de l'iPhone) ---

/** Les actions d'un rappel : Reporter…, Plus tard, Étiquettes…, Retirer. */
export function actionsRappel(r, gestes = {}) {
  return [
    { libelle: "Reporter…", icone: "horloge", faire: () => ouvrirQuand(r, gestes) },
    !r.fait ? { libelle: "Plus tard", icone: "plusquinze", faire: () => reporterA(r, C.plusTard(), gestes) } : null,
    sait("etiquettes-v1") ? { libelle: "Étiquettes…", icone: "etiquette", faire: () => ouvrirEtiquettes(r, gestes) } : null,
    { libelle: "Retirer", icone: "corbeille", danger: true, faire: () => retirerRappel(r, gestes) },
  ];
}

/**
 * Une ligne de rappel : la case (fait) ; le texte, qui ouvre « Quand ? » ;
 * l'heure (en rouge si passée) ou « sans date », « importé », les noms de ses
 * étiquettes (une étiquette inconnue n'est pas montrée) ; Quand ?,
 * Étiquettes, Retirer ; le clic droit et Maj+F10. `retirer()` / `remettre()` :
 * l'écran tout de suite ; `apres()` : relire ; `nomEtiquette(id)` : le nom
 * d'une catégorie (sinon les étiquettes lues ici, au plus une fois par minute).
 */
export function ligneRappel(r, { apres, retirer, remettre, nomEtiquette } = {}) {
  const gestes = { apres, retirer, remettre };
  const passe = typeof r.quand === "number" && r.quand < Date.now() && !r.fait;
  const caseB = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": String(Boolean(r.fait)), "aria-label": r.fait ? `« ${r.texte} » : fait` : `Marquer « ${r.texte} » comme fait` });
  caseB.addEventListener("click", () => basculerFait(r, gestes));
  const puces = h("span", { class: "rappels-puces" });
  const poser = (noms) => vider(puces, noms.map((n) => h("span", { class: "puce" }, n)));
  const ids = r.etiquettes || [];
  if (ids.length) {
    if (nomEtiquette) poser(ids.map((id) => nomEtiquette(id)).filter((n) => n && !ids.includes(n)));
    else {
      if (cache.liste) poser(C.nomsEtiquettes(ids, cache.liste));
      chargerEtiquettes().then((l) => poser(C.nomsEtiquettes(ids, l))).catch(() => {});
    }
  }
  const ouvrir = () => ouvrirQuand(r, gestes);
  const corps = h("div", { class: "corps cliquable", role: "button", tabindex: "0", "aria-haspopup": "dialog", title: "Quand ? Reporter, étiquettes, fait, retirer",
    onclick: ouvrir, onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ouvrir(); } } },
    h("div", { class: "titre-ligne" }, r.texte),
    h("div", { class: "meta" },
      typeof r.quand === "number" ? h("span", { class: passe ? "risque" : "mono" }, passe ? icone("alerte") : null, C.quandRappel(r.quand)) : h("span", { class: "rappels-sans-date" }, "sans date"),
      r.source === "apple" ? h("span", { class: "rappels-importe" }, "importé") : null,
      puces));
  const li = h("li", { class: `ligne rappels-ligne${r.fait ? " faite" : ""}` }, caseB, corps,
    !r.fait ? bouton("", { classe: "texte icone rappels-geste", icone: "horloge", etiquette: `Quand ? « ${r.texte} »`, titre: "Quand ?", onclick: ouvrir }) : null,
    sait("etiquettes-v1") ? bouton("", { classe: "texte icone rappels-geste", icone: "etiquette", etiquette: `Étiquettes de « ${r.texte} »`, titre: "Étiquettes", onclick: () => ouvrirEtiquettes(r, gestes) }) : null,
    bouton("", { classe: "texte icone rappels-geste", icone: "corbeille", etiquette: `Retirer « ${r.texte} »`, titre: "Retirer", onclick: (e) => occupe(e.currentTarget, () => retirerRappel(r, gestes)) }));
  surMenu(li, () => actionsRappel(r, gestes), { titre: `Rappel « ${r.texte} »` });
  return li;
}

// --- Nouveau rappel ---

/**
 * La feuille « Nouveau rappel » (NouveauRappel) : le texte, « À une date »
 * et le moment, rempli par la date lue dans la phrase tant que Sam n'y a pas
 * touché. `rappels` : ceux connus (pour dire lequel était déjà là).
 */
export function nouveauRappel({ apres, rappels = [] } = {}) {
  const id = nouvelId();
  let dateTouchee = false;
  const champ = h("input", { class: "champ", type: "text", placeholder: "Appeler le garage demain à 9h", "aria-label": "Le rappel", autocomplete: "off", maxlength: "300" });
  const aUneDate = h("input", { type: "checkbox", checked: true });
  const moment = h("input", { class: "champ", type: "datetime-local", "aria-label": "Quand" });
  moment.value = versChampDate(new Date(Date.now() + 3600e3));
  const zoneMoment = h("label", { class: "rappels-moment" }, h("span", { class: "etiquette-champ" }, "Quand"), moment);
  const ajouter = bouton("Ajouter", { classe: "plein", onclick: (e) => occupe(e.currentTarget, valider) });
  ajouter.disabled = true;
  const majZone = () => { zoneMoment.hidden = !aUneDate.checked; };
  champ.addEventListener("input", () => {
    ajouter.disabled = !champ.value.trim();
    if (dateTouchee) return;
    const d = extraire(champ.value.trim());
    if (!d) return;
    aUneDate.checked = true;
    moment.value = versChampDate(d.quand);
    majZone();
  });
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter" && !ajouter.disabled) { e.preventDefault(); occupe(ajouter, valider); } });
  moment.addEventListener("input", () => { dateTouchee = true; });
  aUneDate.addEventListener("change", majZone);
  async function valider() {
    const brut = champ.value.trim();
    if (!brut) return champ.focus();
    let quand = null;
    if (aUneDate.checked) {
      const d = depuisChampDate(moment.value);
      if (!d || Number.isNaN(d.getTime())) return dire("Choisis une date et une heure, ou décoche « À une date ».", { genre: "erreur" });
      quand = d.getTime();
    }
    const texte = C.texteNouveauRappel(brut, { dateTouchee }) || brut.slice(0, 300);
    try {
      const r = await ecrire("/api/rappels", { rappels: [{ id, texte, quand }] });
      f.fermer();
      const deja = r?.dejaLa?.[0];
      if (deja) dire(`Déjà dans tes rappels : « ${rappels.find((x) => x.id === deja.existant)?.texte || deja.texte} ».`);
      else dire(quand ? `Rappel : ${C.quandRappel(quand)}.` : "Rappel ajouté, sans date.", { genre: "succes" });
      apres?.();
    } catch (err) {
      direErreur(err, null, "Rappel pas ajouté");
    }
  }
  const f = feuille({ titre: "Nouveau rappel", classe: "rappels-nouveau", contenu: [
    champ,
    h("label", { class: "bascule" }, h("span", { class: "textes" }, h("strong", null, "À une date")), aUneDate),
    zoneMoment,
  ], pied: [bouton("Annuler", { classe: "papier", onclick: () => f.fermer() }), ajouter],
  avantFermeture: (cause) => cause !== "fond" || !champ.value.trim() });
  champ.focus();
  return f;
}

// --- La carte « Rappels du jour » d'Aujourd'hui (contrat A) ---

/**
 * La carte « Rappels du jour » (ATraiter de l'iPhone), montée par
 * Aujourd'hui : elle lit /api/rappels et /api/etiquettes (au plus une fois
 * par minute, sauf `frais`), jamais /api/dashboard. `carte` : l'élément
 * stable qu'elle remplit (caché quand il n'y a rien à montrer).
 */
export function creerRappelsDuJour(ctx, { relire } = {}) {
  const carte = h("div", { class: "projets-rappels-jour", hidden: true });
  let rappels = null;
  let etiquettes = [];
  let erreur = null;
  let lu = 0;
  let enCours = null;
  const masquees = new Set();

  const lire = (frais) => {
    if (!frais && rappels && Date.now() - lu < 60000) return Promise.resolve();
    if (enCours) return enCours;
    enCours = (async () => {
      const [r, e] = await Promise.allSettled([api("/api/rappels", { delai: 20000 }), chargerEtiquettes({ frais })]);
      if (r.status === "fulfilled") {
        rappels = r.value?.rappels || [];
        lu = Date.now();
        erreur = null;
        masquees.clear();
      } else erreur = r.reason;
      if (e.status === "fulfilled") etiquettes = e.value || [];
    })().finally(() => { enCours = null; });
    return enCours;
  };
  // Après un geste : la carte se relit.
  const relireBientot = () => setTimeout(() => maj({ frais: true }), 400);

  function dessiner() {
    if (!rappels) {
      if (erreur && erreur.nature !== "auth") {
        carte.hidden = false;
        vider(carte, h("section", { class: "carte", "aria-label": "Rappels du jour" }, h("h2", { class: "titre-section" }, "Rappels du jour"), blocErreur(erreur, () => maj({ frais: true }))));
      } else {
        carte.hidden = true;
        vider(carte);
      }
      return;
    }
    const tous = rappelsDuJour(rappels).filter((r) => !masquees.has(r.id));
    const filtre = lireFiltreLocal();
    const visibles = tous.filter((r) => C.garderRappel(r, filtre));
    const capable = sait("etiquettes-v1");
    const nTraiter = capable ? C.aTraiter(rappels.filter((r) => !masquees.has(r.id)), etiquettes).length : 0;
    if (!tous.length && !nTraiter) {
      carte.hidden = true;
      vider(carte);
      return;
    }
    carte.hidden = false;
    vider(carte, h("section", { class: "carte", "aria-label": "Rappels du jour" },
      h("div", { class: "rappels-tete" },
        h("h2", { class: "titre-section" }, "Rappels du jour", visibles.length ? h("span", { class: "compte" }, String(visibles.length)) : null),
        capable && tous.length ? boutonFiltre({ surChangement: () => dessiner() }) : null,
        h("a", { class: "btn texte petit lien-titre", href: "#/projets/rappels" }, "Tous les rappels")),
      nTraiter ? ligneTriRappels(nTraiter, { ouvrir: () => ctx.aller("projets/rappels/tri") }) : null,
      visibles.length ? h("ul", { class: "liste" }, visibles.map((r) => ligneRappel(r, {
        apres: relireBientot,
        retirer: () => { masquees.add(r.id); dessiner(); },
        remettre: () => { masquees.delete(r.id); dessiner(); },
      }))) : null,
      !visibles.length && tous.length ? h("p", { class: "aide rappels-masques" }, C.phraseMasques(tous.length)) : null));
  }

  async function maj({ frais = false } = {}) {
    if (!rappels && !erreur && !enCours) {
      carte.hidden = false;
      vider(carte, h("section", { class: "carte", "aria-label": "Rappels du jour" }, h("h2", { class: "titre-section" }, "Rappels du jour"), squelette([0.8, 0.6])));
    }
    await lire(frais);
    dessiner();
  }

  // `relire` (le tableau d'Aujourd'hui) ne sert pas ici : un geste sur un
  // rappel ne change pas la journée ; le tri, qui en fait des tâches, se
  // joue dans Projets et Aujourd'hui se relit en revenant.
  void relire;
  return { carte, maj };
}
