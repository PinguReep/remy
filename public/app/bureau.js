// Le pont avec l'app Windows (docs/bureau.md, 1.4). Dans un navigateur, tout
// ce qui suit est absent : `estBureau()` est faux et rien n'est appelé.
// Dans l'app, la page n'appelle que les commandes `bureau_*` du contrat ; la
// coquille vérifie de son côté que la page vient bien de l'adresse réglée.
//
// Les notifications sont décidées ICI, sans IA, par les routes existantes :
// - rappels dus : GET /api/rappels au plus une fois par minute ; un rappel
//   pas fait dont l'heure vient de passer est notifié une fois (clé
//   `rappel:<id>@<quand>`) ; ceux passés depuis plus de 2 h sont regroupés ;
// - briefing du matin et bilan du soir : GET /api/rituel une fois, à l'heure
//   choisie (coupés par défaut, comme sur l'iPhone) ;
// - jamais /api/dashboard en boucle (il peut relancer le conseil réfléchi).
import { api, ecrire } from "./api.js";
import { h, ajouterA, dire, feuille, bouton, local, heure } from "./ui.js";

const T = () => (typeof window !== "undefined" ? window.__TAURI__ : undefined);
export const estBureau = () => Boolean(T()?.core?.invoke);
export const invoke = (nom, args) => T().core.invoke(nom, args);
export const ecouter = (nom, f) => T()?.event?.listen?.(nom, f);

// --- Réglages des notifications (gardés dans ce profil WebView2) ---
const CLE_REGLAGES = "remy-bureau-notifications";
export const REGLAGES_PAR_DEFAUT = Object.freeze({ rappels: true, briefing: false, bilan: false, heureBriefing: "07:30", heureBilan: "21:30" });
export const reglagesNotifs = () => ({ ...REGLAGES_PAR_DEFAUT, ...(local.lire(CLE_REGLAGES, {}) || {}) });
export function reglerNotifs(changement) {
  const r = { ...reglagesNotifs(), ...changement };
  local.ecrire(CLE_REGLAGES, r);
  return r;
}

// --- Logique pure (testée sous node : test/site-bureau.test.mjs) ---
export const DEUX_HEURES = 2 * 3600e3;
/** Au-delà de 3 jours, un rappel pas fait relève d'« À trancher », plus d'une notification. */
export const OUBLI = 3 * 86400e3;
export const cleRappel = (r) => `rappel:${r.id}@${r.quand}`;
const borner = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/**
 * Ce qu'il faut dire des rappels. `deja` : les clés déjà notifiées.
 * Rend `{ notifications: [{ titre, corps, cle }], cles: [...] }` : un rappel
 * dû depuis moins de 2 h a sa notification (3 au plus, le reste regroupé) ;
 * plus vieux (tour éteinte, PC en veille), ils sont regroupés en une seule.
 */
export function rappelsADire(rappels, { maintenant = Date.now(), deja = new Set() } = {}) {
  const dus = (rappels || [])
    .filter((r) => r && !r.fait && !r.supprime && typeof r.quand === "number" && r.quand <= maintenant && maintenant - r.quand <= OUBLI && !deja.has(cleRappel(r)))
    .sort((a, b) => a.quand - b.quand);
  const recents = dus.filter((r) => maintenant - r.quand <= DEUX_HEURES);
  const anciens = dus.filter((r) => maintenant - r.quand > DEUX_HEURES);
  const seuls = recents.slice(-3);
  const regroupes = [...anciens, ...recents.slice(0, Math.max(0, recents.length - 3))];
  const notifications = seuls.map((r) => ({ titre: borner(r.texte, 80) || "Rappel", corps: `Rappel de ${heure(r.quand)}`, cle: cleRappel(r) }));
  if (regroupes.length === 1) {
    const r = regroupes[0];
    notifications.unshift({ titre: borner(r.texte, 80) || "Rappel", corps: `Rappel passé (${heure(r.quand)}) pendant ton absence.`, cle: cleRappel(r) });
  } else if (regroupes.length > 1) {
    notifications.unshift({
      titre: `${regroupes.length} rappels passés pendant ton absence`,
      corps: borner(regroupes.map((r) => r.texte).join(" · "), 240),
      cle: `rappels-groupes@${regroupes.map(cleRappel).join(",")}`.slice(0, 200),
    });
  }
  return { notifications, cles: dus.map(cleRappel) };
}

const jourISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const aHeure = (d, hhmm) => {
  const [hh, mm] = String(hhmm || "").split(":").map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0);
};
/** Une fenêtre de 4 h après l'heure choisie : un PC allumé à 10 h a encore son briefing de 7 h 30. */
export const FENETRE_RITUEL = 4 * 3600e3;

/** Le rituel dû maintenant (« briefing », « bilan ») ou null. `deja` : clés `briefing@AAAA-MM-JJ`. */
export function rituelDu(reglages, { maintenant = Date.now(), deja = new Set() } = {}) {
  const d = new Date(maintenant);
  for (const [nom, actif, h0] of [["briefing", reglages.briefing, reglages.heureBriefing], ["bilan", reglages.bilan, reglages.heureBilan]]) {
    if (!actif) continue;
    const debut = aHeure(d, h0).getTime();
    const cle = `${nom}@${jourISO(d)}`;
    if (maintenant >= debut && maintenant < debut + FENETRE_RITUEL && !deja.has(cle)) return { nom, cle };
  }
  return null;
}

/** Le texte de la notification de rituel, tiré de GET /api/rituel. */
export function texteRituel(nom, rituel) {
  if (nom === "briefing") {
    const a = rituel?.aujourdhui || {};
    const corps = [a.compte, a.resume].filter(Boolean).join(" ");
    return { titre: "Briefing du matin", corps: borner(corps || "Ta journée t'attend dans Rémy.", 240) };
  }
  const s = rituel?.soir || {};
  return { titre: "Bilan du soir", corps: borner(s.phrase ? `${s.phrase} 30 secondes pour faire le point.` : "30 secondes pour faire le point sur ta journée.", 240) };
}

// --- Mémoire des notifications déjà faites (3 jours) ---
const CLE_DEJA = "remy-bureau-notifies";
function lireDeja() {
  const l = local.lire(CLE_DEJA, []) || [];
  const limite = Date.now() - 3 * 86400e3;
  return l.filter((x) => x && x.a > limite);
}
function noterDeja(cles) {
  const l = lireDeja();
  const connues = new Set(l.map((x) => x.cle));
  for (const c of cles) if (!connues.has(c)) l.push({ cle: c, a: Date.now() });
  local.ecrire(CLE_DEJA, l.slice(-400));
}
const ensembleDeja = () => new Set(lireDeja().map((x) => x.cle));

// --- Les commandes ---
let etat = null;
export const etatBureau = () => etat;
export async function lireEtat() {
  etat = await invoke("bureau_etat");
  return etat;
}
/** Change un réglage de l'app (raccourci, démarrage, fermer dans la zone). Lève le refus de la coquille. */
export async function regler(changement) {
  etat = await invoke("bureau_regler", changement);
  return etat;
}
/** Une notification Windows ; `vue` : ouverte au clic (« projets/rappels »). */
export const notifier = (titre, corps, cle, vue) => invoke("bureau_notifier", { titre: borner(titre, 80), corps: borner(corps, 240), cle: cle ? String(cle).slice(0, 200) : undefined, vue: vue || undefined });
export const fermerNoter = () => (estBureau() ? invoke("bureau_noter_fermer").catch(() => {}) : Promise.resolve());
export const changerAdresse = () => invoke("bureau_changer_adresse");
export const ouvrirLien = (url) => invoke("bureau_ouvrir_lien", { url });

// --- La boucle des notifications (fenêtre principale seulement) ---
let boucle = null;
let derniereLecture = 0;
async function tic() {
  const r = reglagesNotifs();
  const deja = ensembleDeja();
  if (r.rappels && Date.now() - derniereLecture >= 59e3) {
    derniereLecture = Date.now();
    try {
      const { rappels } = await api("/api/rappels", { delai: 15000 });
      const { notifications, cles } = rappelsADire(rappels, { deja });
      for (const n of notifications) await notifier(n.titre, n.corps, n.cle, "projets/rappels").catch(() => {});
      if (cles.length) noterDeja(cles);
    } catch {
      // Tour injoignable ou session perdue : le site le dit déjà ; on réessaiera.
    }
  }
  const du = rituelDu(r, { deja });
  if (du) {
    noterDeja([du.cle]);
    try {
      const rituel = await api("/api/rituel", { delai: 30000 });
      const t = texteRituel(du.nom, rituel);
      await notifier(t.titre, t.corps, du.cle, "aujourdhui");
    } catch {}
  }
}
export function demarrerNotifications() {
  clearInterval(boucle);
  tic();
  // WebView2 ralentit les minuteries d'une fenêtre cachée à une par minute : ça suffit.
  boucle = setInterval(tic, 60e3);
}
/** Une notification d'essai (Réglages › Ordinateur). */
export const notificationEssai = () => notifier("Rémy", "Les notifications marchent. Tu verras ici tes rappels à l'heure.", `essai@${Date.now()}`, "reglages/ordinateur");

// --- Les notes de secours (tapées dans « Noter » quand le site n'était jamais chargé) ---
async function notesDeSecours() {
  let notes = [];
  try {
    notes = (await invoke("bureau_notes_attente")) || [];
  } catch {
    return;
  }
  if (!notes.length) return;
  dire(notes.length > 1 ? `${notes.length} notes tapées pendant que la tour ne répondait pas.` : "Une note tapée pendant que la tour ne répondait pas.", {
    duree: 0,
    action: { libelle: "Les ranger", faire: () => rangerNotes(notes) },
  });
}
async function rangerNotes(notes) {
  const { formulaireNoter } = await import("./vues/noter.js");
  let reste = [...notes];
  const f = feuille({ titre: "Notes tapées hors ligne", sousTitre: "Chacune part comme une note du site : vérifie le genre, puis Envoyer.", large: true, contenu: h("div", { class: "pile" }) });
  const pile = f.corps.querySelector(".pile");
  const dessiner = () => {
    pile.replaceChildren();
    if (!reste.length) return f.fermer();
    for (const n of reste) {
      const carte = h("div", { class: "carte plate compacte" });
      ajouterA(carte, formulaireNoter({
        texte: n.texte,
        id: n.id,
        compact: true,
        surEnvoye: async () => {
          await invoke("bureau_notes_acquitter", { ids: [n.id] }).catch(() => {});
          reste = reste.filter((x) => x.id !== n.id);
          dessiner();
        },
        extra: bouton("Jeter", { classe: "texte", onclick: async () => {
          await invoke("bureau_notes_acquitter", { ids: [n.id] }).catch(() => {});
          reste = reste.filter((x) => x.id !== n.id);
          dessiner();
        } }),
      }));
      ajouterA(pile, carte);
    }
  };
  dessiner();
}

// --- Première fois dans l'app ---
const CLE_ACCUEIL = "remy-bureau-accueil";
function accueil() {
  if (local.lire(CLE_ACCUEIL, false)) return;
  local.ecrire(CLE_ACCUEIL, true);
  const r = reglagesNotifs();
  const bascule = (titre, detail, cle) => {
    const input = h("input", { type: "checkbox", role: "switch" });
    input.checked = Boolean(r[cle]);
    input.addEventListener("change", () => reglerNotifs({ [cle]: input.checked }));
    return h("label", { class: "bascule" }, h("span", { class: "textes" }, h("strong", null, titre), h("span", null, detail)), input);
  };
  const f = feuille({
    titre: "Rémy est sur ton PC",
    sousTitre: "Il reste près de l'horloge et te prévient sans rien demander à l'IA.",
    contenu: h("div", null,
      bascule("Rappels à l'heure", "Une notification Windows quand un rappel tombe.", "rappels"),
      bascule("Briefing du matin", `Ta journée en deux lignes, à ${r.heureBriefing}.`, "briefing"),
      bascule("Bilan du soir", `Fait, glissé, ce qui reste, à ${r.heureBilan}.`, "bilan"),
      h("p", { class: "aide", style: { marginTop: "10px" } }, `Noter de n'importe où : ${etat?.raccourciLibelle || etat?.raccourci || "Ctrl+Alt+Espace"}. Tout se règle dans Réglages › Ordinateur.`)),
    pied: [bouton("C'est parti", { classe: "plein", onclick: () => f.fermer() })],
  });
}

/** Lance le pont : appelé au démarrage du site (fenêtre principale ou Noter). */
export async function demarrer({ aller, fenetre } = {}) {
  if (!estBureau()) return;
  await lireEtat();
  document.documentElement.dataset.bureau = etat?.fenetre || fenetre || "main";
  // Liens externes : le navigateur par défaut, jamais une fenêtre de plus.
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (url.origin === location.origin || !/^https?:$/.test(url.protocol)) return;
    e.preventDefault();
    ouvrirLien(url.href).catch(() => dire("Le lien n'a pas pu s'ouvrir.", { genre: "erreur" }));
  });
  if ((etat?.fenetre || fenetre) === "noter") return;
  await ecouter("bureau://aller", (ev) => {
    const vue = ev?.payload?.vue;
    if (typeof vue === "string" && /^[a-z0-9/-]{1,60}$/.test(vue)) aller(vue);
  });
  demarrerNotifications();
  accueil();
  setTimeout(notesDeSecours, 1500);
}

/** La fenêtre Noter : prévenue quand la coquille la montre. */
export function surNoterOuvert(f) {
  if (!estBureau()) return;
  ecouter("bureau://noter-ouvert", () => f());
}

/** Pour les tests : l'envoi d'une capture marquée (rien d'autre n'écrit ici). */
export const _interne = { ecrire };
