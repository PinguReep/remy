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
//   choisie (coupés par défaut, comme sur l'iPhone) ; le clic ouvre le
//   briefing ou le bilan (#/aujourdhui/briefing, #/aujourdhui/bilan) ;
// - propositions qui attendent un « oui » (règles de Rémy, un sujet de plus
//   pour la nuit) : GET /api/propositions/attente au plus une fois par minute,
//   chacune dite une fois ; rien ne part sans un clic (Oui est dans Rémy, ou
//   dans la feuille « Cette nuit, je creuse aussi ? ») ;
// - jamais /api/dashboard en boucle (il peut relancer le conseil réfléchi).
import { api, ecrire, sait as saitTour } from "./api.js";
import { h, ajouterA, dire, feuille, bouton, local, heure } from "./ui.js";
import { texteHeure } from "./analyse/rituel.js";

const T = () => (typeof window !== "undefined" ? window.__TAURI__ : undefined);
export const estBureau = () => Boolean(T()?.core?.invoke);
/**
 * Une commande de la coquille. Tauri rejette avec une CHAÎNE (le `Err(String)`
 * de Rust) : elle devient une Error dont le message est l'explication de la
 * coquille (« Windows a refusé… »), au lieu d'un « Erreur inattendue » muet.
 */
export function invoke(nom, args) {
  const t = T();
  if (!t?.core?.invoke) return Promise.reject(Object.assign(new Error("L'app Windows ne répond pas : relance-la."), { nature: "bureau" }));
  return Promise.resolve()
    .then(() => t.core.invoke(nom, args))
    .catch((e) => {
      throw Object.assign(new Error(typeof e === "string" ? e : e?.message || String(e)), { nature: "bureau" });
    });
}
export const ecouter = (nom, f) => T()?.event?.listen?.(nom, f);

// --- Réglages des notifications (gardés dans ce profil WebView2) ---
// Seuls les choix faits ici sont gardés (`v: 2`) : un défaut qui change (le
// bilan passé à 22 h 45 le 29/10, « avant que je me couche ») vaut pour qui
// n'a jamais choisi, et une heure choisie reste la sienne.
const CLE_REGLAGES = "remy-bureau-notifications";
export const REGLAGES_PAR_DEFAUT = Object.freeze({ rappels: true, briefing: false, bilan: false, heureBriefing: "07:30", heureBilan: "22:45", propositions: true });
/** L'ancienne heure par défaut du bilan, écrite avec tout l'objet avant le 29/10 : pas un choix. */
export const ANCIENNE_HEURE_BILAN = "21:30";
export function choixNotifs(brut) {
  if (!brut || typeof brut !== "object") return {};
  const { v, ...choix } = brut;
  if (v === 2) return choix;
  // Avant : reglerNotifs écrivait tous les réglages, défauts compris.
  if (choix.heureBilan === ANCIENNE_HEURE_BILAN) delete choix.heureBilan;
  return choix;
}
export const reglagesNotifs = () => ({ ...REGLAGES_PAR_DEFAUT, ...choixNotifs(local.lire(CLE_REGLAGES, {})) });
export function reglerNotifs(changement) {
  const choix = { ...choixNotifs(local.lire(CLE_REGLAGES, {})), ...changement };
  local.ecrire(CLE_REGLAGES, { v: 2, ...choix });
  return { ...REGLAGES_PAR_DEFAUT, ...choix };
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
 * Rend `{ notifications: [{ titre, corps, cle, cles }], cles: [...] }` : un
 * rappel dû depuis moins de 2 h a sa notification (3 au plus, le reste
 * regroupé) ; plus vieux (tour éteinte, PC en veille), ils sont regroupés en
 * une seule. `cles` d'une notification : les rappels qu'elle couvre (marqués
 * dits seulement quand Windows l'a prise).
 */
export function rappelsADire(rappels, { maintenant = Date.now(), deja = new Set() } = {}) {
  const dus = (rappels || [])
    .filter((r) => r && !r.fait && !r.supprime && typeof r.quand === "number" && r.quand <= maintenant && maintenant - r.quand <= OUBLI && !deja.has(cleRappel(r)))
    .sort((a, b) => a.quand - b.quand);
  const recents = dus.filter((r) => maintenant - r.quand <= DEUX_HEURES);
  const anciens = dus.filter((r) => maintenant - r.quand > DEUX_HEURES);
  const seuls = recents.slice(-3);
  const regroupes = [...anciens, ...recents.slice(0, Math.max(0, recents.length - 3))];
  const notifications = seuls.map((r) => ({ titre: borner(r.texte, 80) || "Rappel", corps: `Rappel de ${heure(r.quand)}`, cle: cleRappel(r), cles: [cleRappel(r)] }));
  if (regroupes.length === 1) {
    const r = regroupes[0];
    notifications.unshift({ titre: borner(r.texte, 80) || "Rappel", corps: `Rappel passé (${heure(r.quand)}) pendant ton absence.`, cle: cleRappel(r), cles: [cleRappel(r)] });
  } else if (regroupes.length > 1) {
    notifications.unshift({
      titre: `${regroupes.length} rappels passés pendant ton absence`,
      corps: borner(regroupes.map((r) => r.texte).join(" · "), 240),
      cle: `rappels-groupes@${regroupes.map(cleRappel).join(",")}`.slice(0, 200),
      cles: regroupes.map(cleRappel),
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
/** La vue qu'ouvre la notification d'un rituel : le briefing ou le bilan lui-même. */
export const vueRituel = (nom) => `aujourdhui/${nom === "bilan" ? "bilan" : "briefing"}`;

// --- Les propositions qui attendent un « oui » (GET /api/propositions/attente) ---
/** Au-delà, les plus anciennes sont regroupées en une seule (comme les rappels). */
export const MAX_PROPOSITIONS_SEULES = 3;
/** « Plus tard » : elle revient dans 3 heures (NotificationsPropositions.delaiPlusTard). */
export const PLUS_TARD_PROPOSITION = 3 * 3600e3;
/** Une vue du site que la coquille accepte (adresse.rs, vue_valide) et que `bureau://aller` relaie. */
const vueSure = (v) => (/^[a-z0-9/-]{1,60}$/.test(v) ? v : null);
/** Ce que dit la notification d'une proposition (PropositionEnAttente.notification). */
export function texteProposition(p) {
  if (p?.origine === "nuit") return { titre: "Cette nuit, je creuse aussi ?", corps: String(p.texte || p.sujet || "").slice(0, 220) };
  const n = p?.nombre || 1;
  const quoi = p?.source === "agenda" ? (n > 1 ? `${n} rendez-vous` : "Un rendez-vous") : n > 1 ? `${n} tâches` : "Une tâche";
  return { titre: `${quoi} d'après tes règles`, corps: String(p?.texte || "").slice(0, 220) };
}
/** Où mène le clic : le fil des règles (Oui et Non y sont), ou la feuille du sujet de nuit. */
export function vueProposition(p) {
  if (p?.origine === "nuit") return vueSure(`aujourdhui/nuit/${p.id}`) || "aujourdhui/nuit";
  return (p?.convId && vueSure(`remy/${p.convId}`)) || "remy";
}
/**
 * Les notifications à faire : chaque proposition jamais dite, la plus ancienne
 * d'abord ; au-delà de 3, les plus anciennes regroupées en une seule. `garder` :
 * les identifiants déjà dits ET encore en attente (une proposition tranchée
 * ailleurs est oubliée). `ids` d'une notification : ce qu'elle couvre (marqué
 * dit seulement quand Windows l'a prise). `plusTard` : id → pas avant (ms) ;
 * une proposition remise à plus tard se redit une fois cette heure passée.
 */
export function propositionsADire(liste, { deja = new Set(), plusTard = new Map(), maintenant = Date.now() } = {}) {
  const enAttente = (liste || []).filter((p) => p && p.id);
  const garder = enAttente.map((p) => p.id).filter((id) => deja.has(id) && !plusTard.has(id));
  const pasEncore = (p) => (plusTard.get(p.id) ?? -Infinity) > maintenant;
  const nouvelles = enAttente.filter((p) => (!deja.has(p.id) || plusTard.has(p.id)) && !pasEncore(p)).sort((a, b) => (a.a ?? 0) - (b.a ?? 0));
  const seules = nouvelles.slice(-MAX_PROPOSITIONS_SEULES);
  const groupe = nouvelles.slice(0, Math.max(0, nouvelles.length - MAX_PROPOSITIONS_SEULES));
  const notifications = seules.map((p) => ({ ...texteProposition(p), cle: `proposition:${p.id}`.slice(0, 200), vue: vueProposition(p), ids: [p.id] }));
  if (groupe.length === 1) {
    const p = groupe[0];
    notifications.unshift({ ...texteProposition(p), cle: `proposition:${p.id}`.slice(0, 200), vue: vueProposition(p), ids: [p.id] });
  } else if (groupe.length > 1) {
    const convs = new Set(groupe.map((p) => (p.origine === "nuit" ? "nuit" : p.convId)));
    const vue = convs.size === 1 && !convs.has("nuit") ? vueProposition(groupe[0]) : "aujourdhui/nuit";
    notifications.unshift({
      titre: `${groupe.length} propositions de Rémy attendent ta réponse`,
      corps: borner(groupe.map((p) => p.texte || p.sujet).join(" · "), 240),
      cle: `propositions@${groupe.map((p) => p.id).join(",")}`.slice(0, 200),
      vue,
      ids: groupe.map((p) => p.id),
    });
  }
  return { notifications, garder };
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
// Les propositions déjà dites : seulement celles encore en attente (la tour les rend).
// Celles remises à plus tard : id → pas avant (ms), oubliées une fois redites.
const CLE_PROPOSITIONS = "remy-bureau-propositions";
const CLE_PLUS_TARD = "remy-bureau-propositions-plus-tard";
const memoirePropositionsLocale = {
  lire: () => new Set((local.lire(CLE_PROPOSITIONS, []) || []).filter((x) => typeof x === "string")),
  ecrire: (ids) => local.ecrire(CLE_PROPOSITIONS, [...ids].slice(-200)),
  plusTard: () => new Map(Object.entries(local.lire(CLE_PLUS_TARD, {}) || {}).filter(([, t]) => typeof t === "number")),
  ecrirePlusTard: (m) => local.ecrire(CLE_PLUS_TARD, Object.fromEntries([...m].slice(-200))),
};
/** « Plus tard » sur une proposition (feuille « Cette nuit, je creuse aussi ? ») : redite dans 3 heures si elle attend toujours. */
export function reporterProposition(id, { maintenant = Date.now(), memoire = memoirePropositionsLocale } = {}) {
  if (!id) return;
  const m = memoire.plusTard();
  m.set(id, maintenant + PLUS_TARD_PROPOSITION);
  memoire.ecrirePlusTard(m);
}

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
/** Un rituel pas dit (tour pas encore joignable au réveil du PC, refus de Windows) se retente au plus toutes les 5 min. */
export const REESSAI_RITUEL = 5 * 60e3;
export const cleSession = (maintenant = Date.now()) => `session@${jourISO(new Date(maintenant))}`;

/**
 * La boucle d'une minute, ses dépendances injectables (tests). Une clé n'est
 * marquée « dite » qu'une fois la notification prise par Windows : un refus
 * (limite de la coquille, erreur de Windows) repartira au tour suivant. Une
 * session perdue se dit une fois par jour : sans elle, plus aucun rappel ne
 * part, et la fenêtre est peut-être cachée près de l'horloge.
 */
export function creerTic({
  lire = (chemin, options) => api(chemin, options),
  notif = notifier,
  horloge = () => Date.now(),
  reglages = reglagesNotifs,
  memoire = { deja: ensembleDeja, noter: noterDeja },
  sait = saitTour,
  memoirePropositions = memoirePropositionsLocale,
} = {}) {
  let derniereLecture = -Infinity;
  let derniereLecturePropositions = -Infinity;
  const essais = new Map(); // clé de rituel → dernier essai
  const direDeconnecte = async (maintenant) => {
    const cle = cleSession(maintenant);
    if (memoire.deja().has(cle)) return;
    try {
      await notif("Rémy est déconnecté", "Ouvre-le pour te reconnecter : sinon, plus de rappels ni de briefing.", cle, "aujourdhui");
      memoire.noter([cle]);
    } catch {}
  };
  return async function tic() {
    const maintenant = horloge();
    const r = reglages();
    if (r.rappels && maintenant - derniereLecture >= 59e3) {
      derniereLecture = maintenant;
      try {
        const { rappels } = await lire("/api/rappels", { delai: 15000 });
        const { notifications } = rappelsADire(rappels, { maintenant, deja: memoire.deja() });
        for (const n of notifications) {
          try {
            await notif(n.titre, n.corps, n.cle, "projets/rappels");
            memoire.noter(n.cles || [n.cle]);
          } catch {
            // Refusée : pas marquée, elle repartira à la prochaine minute.
          }
        }
      } catch (err) {
        if (err?.nature === "auth") await direDeconnecte(maintenant);
        // Tour injoignable : on réessaiera à la prochaine minute.
      }
    }
    const du = rituelDu(r, { maintenant, deja: memoire.deja() });
    if (du && maintenant - (essais.get(du.cle) ?? -Infinity) >= REESSAI_RITUEL) {
      essais.set(du.cle, maintenant);
      try {
        const rituel = await lire("/api/rituel", { delai: 30000 });
        const t = texteRituel(du.nom, rituel);
        await notif(t.titre, t.corps, du.cle, vueRituel(du.nom));
        memoire.noter([du.cle]);
        essais.delete(du.cle);
      } catch (err) {
        if (err?.nature === "auth") await direDeconnecte(maintenant);
        // Sinon : retenté dans 5 min, tant qu'on est dans la fenêtre de 4 h.
      }
    }
    // Les propositions qui attendent un « oui » : allumées par défaut, comme sur l'iPhone.
    if (r.propositions !== false && sait("propositions-attente-v1") && maintenant - derniereLecturePropositions >= 59e3) {
      derniereLecturePropositions = maintenant;
      try {
        const { propositions } = (await lire("/api/propositions/attente", { delai: 15000 })) || {};
        const plusTard = memoirePropositions.plusTard?.() || new Map();
        const { notifications, garder } = propositionsADire(propositions, { deja: memoirePropositions.lire(), plusTard, maintenant });
        const dites = new Set(garder);
        for (const n of notifications) {
          try {
            await notif(n.titre, n.corps, n.cle, n.vue);
            for (const id of n.ids) dites.add(id);
          } catch {
            // Refusée : pas marquée, elle repartira à la prochaine minute.
          }
        }
        memoirePropositions.ecrire(dites);
        if (memoirePropositions.plusTard) {
          // Relue maintenant (un « Plus tard » a pu arriver pendant les notifications) :
          // on oublie celles redites, et celles qui n'attendent plus.
          const attente = new Set((propositions || []).map((p) => p?.id));
          const m = memoirePropositions.plusTard();
          for (const [id, t] of m) if (!attente.has(id) || (t <= maintenant && dites.has(id))) m.delete(id);
          memoirePropositions.ecrirePlusTard(m);
        }
      } catch (err) {
        if (err?.nature === "auth") await direDeconnecte(maintenant);
        // Tour injoignable : on réessaiera à la prochaine minute.
      }
    }
  };
}

let boucle = null;
export function demarrerNotifications() {
  clearInterval(boucle);
  const tic = creerTic();
  tic();
  // WebView2 ralentit les minuteries d'une fenêtre cachée à une par minute : ça suffit.
  boucle = setInterval(tic, 60e3);
}
/** Une notification d'essai (Réglages › Ordinateur). */
export const notificationEssai = () => notifier("Rémy", "Les notifications marchent. Tu verras ici tes rappels à l'heure.", `essai@${Date.now()}`, "reglages/ordinateur");
/** Ce qu'on dit quand la coquille refuse une notification, et quoi faire. */
export const REFUS_NOTIFICATIONS = "Windows refuse les notifications de Rémy : autorise-les dans Paramètres › Système › Notifications, puis réessaie dans Réglages › Ordinateur.";
/**
 * Allume le briefing ou le bilan, puis essaie une notification : si la
 * coquille la refuse, rien ne sonnerait, le réglage est remis et c'est dit.
 * Rend { ok, erreur }.
 */
export async function activerRituel(nom, { essai = (titre, corps, cle, vue) => notifier(titre, corps, cle, vue) } = {}) {
  const cle = nom === "bilan" ? "bilan" : "briefing";
  const r = reglerNotifs({ [cle]: true });
  const quand = texteHeure(cle === "bilan" ? r.heureBilan : r.heureBriefing);
  try {
    await essai("Rémy", cle === "bilan" ? `Ton bilan du soir arrivera ici chaque soir à ${quand}.` : `Ton briefing arrivera ici chaque matin à ${quand}.`, `essai@${Date.now()}`, vueRituel(cle));
    return { ok: true, erreur: null };
  } catch (err) {
    reglerNotifs({ [cle]: false });
    return { ok: false, erreur: err?.message || String(err) };
  }
}

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
let accueilMontre = false;
/** La feuille d'accueil a été vue lors d'une visite d'avant (jamais deux questions de suite). */
export const accueilDejaVu = () => Boolean(local.lire(CLE_ACCUEIL, false)) && !accueilMontre;
function accueil() {
  if (local.lire(CLE_ACCUEIL, false)) return;
  local.ecrire(CLE_ACCUEIL, true);
  accueilMontre = true;
  const r = reglagesNotifs();
  const refus = h("p", { class: "erreur-champ", role: "alert", hidden: true });
  // Les textes de l'iPhone (ReglagesRituelVue) ; l'heure n'apparaît que bascule allumée.
  const bascule = (titre, detail, cle, cleHeure) => {
    const input = h("input", { type: "checkbox", role: "switch" });
    input.checked = Boolean(r[cle]);
    const champ = cleHeure ? h("input", { class: "champ", type: "time", "aria-label": `Heure : ${titre}`, value: r[cleHeure], style: { width: "auto" } }) : null;
    champ?.addEventListener("change", () => champ.value && reglerNotifs({ [cleHeure]: champ.value }));
    const ligneHeure = champ ? h("div", { class: "rangee", style: { margin: "0 0 8px" }, hidden: !input.checked }, h("span", { class: "aide" }, "À"), champ) : null;
    input.addEventListener("change", async () => {
      if (ligneHeure) ligneHeure.hidden = !input.checked;
      if (!input.checked || !cleHeure) return reglerNotifs({ [cle]: input.checked });
      refus.hidden = true;
      const a = await activerRituel(cle);
      if (!a.ok) {
        input.checked = false;
        if (ligneHeure) ligneHeure.hidden = true;
        refus.textContent = REFUS_NOTIFICATIONS;
        refus.hidden = false;
      }
    });
    return [h("label", { class: "bascule" }, h("span", { class: "textes" }, h("strong", null, titre), h("span", null, detail)), input), ligneHeure];
  };
  const f = feuille({
    titre: "Rémy est sur ton PC",
    sousTitre: "Il reste près de l'horloge et te prévient sans rien demander à l'IA.",
    contenu: h("div", null,
      bascule("Rappels à l'heure", "Une notification Windows quand un rappel tombe.", "rappels"),
      bascule("Briefing du matin", "Ce qui compte, pourquoi, ce qui est menacé. Calculé par ta tour, sans IA.", "briefing", "heureBriefing"),
      bascule("Bilan du soir", "Fait, glissé, ce qui reste pour demain : 30 secondes avant de te coucher.", "bilan", "heureBilan"),
      saitTour("propositions-attente-v1") ? bascule("Propositions de Rémy", "Les tâches proposées par tes règles et les sujets de plus pour la nuit.", "propositions") : null,
      refus,
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
