// Le conseil du moment (ConseilDuMoment et ConseilPanneau de l'iPhone) : une
// ou deux phrases de Rémy en tête de la colonne de droite. Réfléchies par le
// modèle local de la tour quand elles sont là et à jour, sinon calculées ici
// par règles, sans IA (analyse/conseil.js). Clic ou Entrée : le conseil en
// grand ; clic droit (l'appui long de l'iPhone) : avec son « pourquoi » déplié.
// « Un autre conseil » demande au modèle local d'en réfléchir un autre : la
// réponse de la tour (202) n'a pas de texte, l'ancien reste affiché pendant
// qu'il réfléchit, puis le nouveau le remplace. Le site n'appelle aucune IA :
// la tour journalise ce calcul (kind conseil), déclenché par ce seul geste.
import { api, ecrire, sait } from "../api.js";
import { h, vider, icone, bouton, dire, feuille, local, texteErreur } from "../ui.js";
import { conseilPour, conseilReflechi, ligneSource, faitsConseil, TYPES_CONSEIL } from "../analyse/conseil.js";
import { BROUILLONS, estRendezVous } from "../analyse/journee.js";

const PAUSE = 1500;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
/** Le texte d'une erreur sans son point final (la phrase en remet un). */
const raisonDe = (err) => texteErreur(err).replace(/[.\s]+$/, "");

/**
 * La carte et son panneau. `journee()` : la journée affichée (sans les
 * tâches cochées) ; `ouvrirGerer(e)` : « Gérer » d'un élément ;
 * `surChange()` : le conseil affiché a changé (la boîte le reçoit).
 * Rend { carte, maj({ dashboard }), dessiner(), affiche(), ouvrir(mode), arreter() }.
 */
export function creerConseil(ctx, { journee, ouvrirGerer, surChange } = {}) {
  const carte = h("div", { class: "conseil-zone" });
  const parType = new Map(); // type → dernière réponse de GET /api/conseil
  const chargement = new Set();
  const renouvellement = new Set();
  let dashboard = null;
  let panneau = null;
  let vivant = true;

  const disponible = () => sait("conseil-v1");
  /** Le conseil de la tour pour ce type (« maintenant » arrive aussi avec le tableau : le plus récent des deux). */
  function tour(type) {
    const lu = parType.get(type) || null;
    if (type !== "maintenant") return lu;
    const d = dashboard?.conseil || null;
    if (!lu || !d) return lu || d;
    return (d.conseil?.genereA ?? 0) > (lu.conseil?.genereA ?? 0) ? d : lu;
  }
  function calcul(type, m = Date.now()) {
    const j = journee?.() || null;
    const localC = conseilPour(type, j, m);
    const t = tour(type);
    const glm = conseilReflechi(t, m);
    return { j, local: localC, tour: t, glm, texte: glm?.texte ?? localC?.texte ?? null, pourquoi: glm?.pourquoi ?? localC?.pourquoi ?? [] };
  }

  // --- La carte de l'accueil ---
  function dessiner() {
    const c = calcul("maintenant");
    const focus = carte.contains(document.activeElement) ? document.activeElement?.dataset?.cle : null;
    if (!c.local) {
      vider(carte);
      dessinerPanneau();
      return;
    }
    const tourne = renouvellement.has("maintenant");
    const zone = h("div", {
      class: "conseil-ouvrir", role: "button", tabindex: "0", dataset: { cle: "ouvrir" },
      "aria-label": `Conseil du moment : ${c.texte}. Ouvre le conseil en grand ; clic droit : avec son pourquoi.`,
      onclick: () => ouvrir("detail"),
      onkeydown: (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          ouvrir("detail");
        }
      },
      oncontextmenu: (ev) => {
        ev.preventDefault();
        ouvrir("pourquoi");
      },
    },
    h("div", { class: "conseil" },
      h("p", { class: "conseil-tete" }, h("strong", null, "Rémy"), c.glm ? " · conseil réfléchi" : " · conseil du moment", tourne ? " · il réfléchit à nouveau…" : null),
      h("p", { class: "texte-conseil" }, c.texte),
      c.pourquoi.length ? h("ul", null, c.pourquoi.map((p) => h("li", null, p))) : null));
    vider(carte, h("section", { class: "carte conseil-carte", "aria-label": "Conseil du moment" }, zone, boutonAutre("maintenant", c.tour)));
    if (focus) carte.querySelector(`[data-cle="${focus}"]`)?.focus();
    dessinerPanneau();
  }

  /** « Un autre conseil » : seulement si le modèle local peut réfléchir (pas de faux bouton). */
  function boutonAutre(type, t) {
    if (!disponible() || t?.disponible === false) return null;
    const tourne = renouvellement.has(type);
    const b = bouton("", { classe: "texte icone conseil-autre", icone: "circulaire", etiquette: "Un autre conseil", titre: "Un autre conseil", onclick: () => renouveler(type) });
    b.dataset.cle = "autre";
    // Pendant qu'il réfléchit : désactivé et qui tourne, mais il garde le focus du clavier.
    if (tourne) {
      b.setAttribute("aria-disabled", "true");
      b.setAttribute("aria-busy", "true");
    }
    return b;
  }

  // --- Lire et renouveler ---
  /** Lit le conseil gardé par la tour ; si le modèle local réfléchit, repasse toutes les 1,5 s (20 fois au plus). */
  async function charger(type) {
    if (!disponible() || chargement.has(type)) return;
    chargement.add(type);
    dessiner();
    try {
      let essais = 0;
      let c = await api(`/api/conseil?type=${encodeURIComponent(type)}`, { delai: 15000 });
      parType.set(type, c);
      dessiner();
      while (c?.enCours === true && essais < 20 && enVie()) {
        await attendre(PAUSE);
        essais += 1;
        try {
          c = await api(`/api/conseil?type=${encodeURIComponent(type)}`, { delai: 15000 });
          parType.set(type, c);
          dessiner();
        } catch (err) {
          if (err?.nature === "auth") break;
        }
      }
    } catch {
      // Pas de conseil réfléchi : celui calculé ici reste affiché, la ligne de source le dit.
    } finally {
      chargement.delete(type);
      dessiner();
      surChange?.();
    }
  }

  async function renouveler(type) {
    if (!disponible() || renouvellement.has(type)) return;
    renouvellement.add(type);
    dessiner();
    const avant = tour(type)?.conseil?.genereA ?? 0;
    try {
      let r;
      try {
        r = await ecrire("/api/conseil/renouveler", { type }, { delai: 20000 });
      } catch (err) {
        if (err?.nature === "auth" || err?.nature === "annule") return; // la reconnexion s'affiche d'elle-même
        dire(`Rémy n'a pas pu demander un autre conseil : ${raisonDe(err)}.`, { genre: "erreur", action: { libelle: "Réessayer", faire: () => renouveler(type) } });
        return;
      }
      if (r?.disponible === false) {
        dire(r.raison || "Rémy ne peut pas réfléchir un autre conseil pour l'instant.");
        return;
      }
      // La réponse ne porte pas de texte : on relit jusqu'au nouveau conseil, l'ancien reste affiché.
      for (let i = 0; i < 30 && enVie(); i++) {
        await attendre(PAUSE);
        let c;
        try {
          c = await api(`/api/conseil?type=${encodeURIComponent(type)}`, { delai: 15000 });
        } catch (err) {
          if (err?.nature === "auth") return;
          continue;
        }
        parType.set(type, c);
        if ((c?.conseil?.genereA ?? 0) > avant || c?.enCours !== true) break;
      }
      if ((tour(type)?.conseil?.genereA ?? 0) <= avant && enVie()) {
        dire(tour(type)?.raison || "Le modèle local n'a pas répondu à temps : le conseil précédent reste affiché.");
      }
    } finally {
      renouvellement.delete(type);
      dessiner();
      surChange?.();
    }
  }

  const enVie = () => vivant && (carte.isConnected || Boolean(panneau));

  // --- Le panneau « Conseil du moment » ---
  function ouvrir(mode = "detail") {
    panneau?.f.fermer();
    const etat = { type: "maintenant", pourquoi: mode === "pourquoi" };
    const corps = h("div", { class: "conseil-panneau" });
    const tete = h("div", { class: "conseil-tete-panneau" });
    const p = { etat, corps, tete, f: null, tic: null };
    p.f = feuille({
      titre: "Conseil du moment", contenu: corps, large: true, classe: "conseil-feuille",
      surFermeture: () => {
        clearInterval(p.tic);
        if (panneau === p) panneau = null;
      },
    });
    // « Un autre conseil » en en-tête, à côté de la croix.
    p.f.el.querySelector(".feuille-tete .btn-fermer")?.before(tete);
    panneau = p;
    dessinerPanneau();
    // Le conseil en grand bouge avec l'heure : relu à la demi-minute tant qu'il est ouvert.
    p.tic = setInterval(dessinerPanneau, 30e3);
    charger(etat.type);
    p.f.el.querySelector(".conseil-puces button[aria-pressed='true']")?.focus();
  }

  function dessinerPanneau() {
    if (!panneau) return;
    const { etat, corps, tete, f } = panneau;
    const m = Date.now();
    const c = calcul(etat.type, m);
    const tourne = c.tour?.enCours === true || chargement.has(etat.type) || renouvellement.has(etat.type);
    const focus = f.el.contains(document.activeElement) ? document.activeElement?.dataset?.cle : null;
    vider(tete, boutonAutre(etat.type, c.tour));
    const puces = h("div", { class: "conseil-puces", role: "group", "aria-label": "Type de conseil" },
      TYPES_CONSEIL.map((t) => h("button", {
        type: "button", class: "puce", "aria-pressed": String(t.id === etat.type), dataset: { cle: `type-${t.id}` },
        onclick: () => {
          if (etat.type === t.id) return;
          etat.type = t.id;
          dessinerPanneau();
          charger(t.id);
        },
      }, t.libelle)));
    const source = h("p", { class: "conseil-source" }, icone(c.glm ? "ampoule" : "ecran"),
      h("span", null, ligneSource({ glm: c.glm, tour: c.tour, disponible: disponible(), tourne, maintenant: m })));
    const prio = c.glm && c.tour?.conseil?.priorite ? h("p", { class: "conseil-priorite" }, icone("etoile"), `Sert ta priorité « ${c.tour.conseil.priorite} »`) : null;
    const plier = h("button", {
      type: "button", class: "conseil-plier", "aria-expanded": String(etat.pourquoi), dataset: { cle: "pourquoi" },
      onclick: () => {
        etat.pourquoi = !etat.pourquoi;
        dessinerPanneau();
      },
    }, h("span", { class: "titre-section" }, "Pourquoi"), icone("bas", "chevron-plier"));
    const faits = faitsConseil(c.j, m);
    const pourquoi = etat.pourquoi ? h("div", { class: "conseil-pourquoi" },
      h("ul", { class: "conseil-raisons" }, (c.pourquoi.length ? c.pourquoi : ["Rémy n'a pas encore de raison à donner."]).map((r) => h("li", null, r))),
      faits.length ? [h("h3", { class: "titre-section" }, "Ce que Rémy a regardé"), h("ul", { class: "conseil-raisons discretes" }, faits.map((x) => h("li", null, x)))] : null) : null;
    // « Ouvrir « T » » : seulement si le conseil nomme une tâche de la journée.
    const tache = c.glm?.tache ? (c.j?.items || []).find((e) => !estRendezVous(e) && e.titre === c.glm.tache) : null;
    const actions = h("div", { class: "conseil-actions" },
      tache ? bouton(`Ouvrir « ${tache.titre} »`, { classe: "plein large", icone: "curseurs", onclick: () => { f.fermer(); ouvrirGerer?.(tache); } }) : null,
      c.texte ? bouton("En parler avec Rémy", { classe: "papier large", icone: "remy", onclick: () => {
        f.fermer();
        local.ecrire("remy-question", { texte: BROUILLONS.conseil(c.texte), a: Date.now() });
        ctx?.aller("remy/nouvelle");
      } }) : null);
    vider(corps, puces,
      h("p", { class: "conseil-grand", "aria-live": "polite" }, c.texte || "Rémy n'a pas encore ta journée : rafraîchis Aujourd'hui pour la charger."),
      source, prio, plier, pourquoi, actions);
    if (focus) f.el.querySelector(`[data-cle="${focus}"]`)?.focus();
  }

  return {
    carte,
    /** Après chaque lecture du tableau : le conseil de la journée, relu si le modèle local réfléchit encore. */
    maj({ dashboard: d } = {}) {
      dashboard = d || null;
      dessiner();
      if (dashboard?.conseil?.enCours === true) charger("maintenant");
    },
    dessiner,
    /** Le conseil affiché sur l'accueil : { texte, source } (pour la boîte), ou null. */
    affiche() {
      const c = calcul("maintenant");
      return c.texte ? { texte: c.texte, source: c.glm ? "glm" : "local" } : null;
    },
    ouvrir,
    arreter() {
      vivant = false;
      panneau?.f.fermer();
    },
  };
}
