// Les cartes de proposition de Rémy dans le fil (le port de PropositionView,
// LigneAction, CarteRegle et CarteCarnet — RemyView.swift, ReglesVues.swift,
// CerveauVues.swift — et des gestes de ChatModel, Modeles.swift) :
// - Motion ou l'agenda : « Rémy propose de changer ton planning », un verbe
//   par ligne (Ajouter, Marquer fait, Supprimer, Modifier), le détail en mots
//   de tous les jours, une case par ligne (propositions-partielles-v1), un
//   clic sur une ligne pour la régler (./ajuster.js) ; après « Oui », le bilan
//   ligne par ligne (fait, raté avec sa raison, écarté, déjà là), « Réessayer »
//   sur un échec, « Annuler » (et l'annulation partielle) ;
// - une règle (« Nouvelle règle ») et le carnet (« Pour ton carnet ») ont leur carte.
// Rien ne part sans le geste de Sam ; tant que Rémy écrit, les boutons attendent.
// Contrat D : carteProposition(p, c, index, { ecrit, relire, ctx }) → élément
// (il se redessine seul), majEcriture(ecrit) au début et à la fin de chaque flux.
// Les fonctions pures (verbe, detailAction, entete, bilanDeReponse…) sont
// exportées pour les tests (test/site-noter.test.mjs).
import { api, ecrire, evenements, nouvelId, seg, sait } from "../api.js";
import { h, vider, icone, bouton, dire, direErreur, feuille, texteErreur } from "../ui.js";
import { estDejaLa, toutDejaLa, jourSemaineCourt, heure, duree, phraseAttenteMotion } from "../analyse/rangement.js";
import { ouvrirAjuster } from "./ajuster.js";

// --- Les mots (Format.swift, Models.swift) ---

/** Le verbe affiché : liste blanche stricte (le type vient du modèle, jamais affiché brut). */
export const typeVerbe = (a) => (["creer", "terminer", "supprimer"].includes(a?.type) ? a.type : "modifier");
export const verbe = (a) => ({ creer: "Ajouter", terminer: "Marquer fait", supprimer: "Supprimer", modifier: "Modifier" })[typeVerbe(a)];
export const libelleAction = (a) => a?.nouveau_nom ?? a?.nom ?? a?.nouveau_titre ?? a?.titre ?? "(sans nom)";

const dateISO = (s) => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
};

/**
 * Le détail d'une ligne : « mer. 30 oct. à 09:00 · lieu · avant le jeu. 31 oct.
 * · 30 min · urgent ». L'heure d'une échéance est omise quand c'est une fin de
 * journée (≥ 20 h ou < 5 h) ou une date seule : « avant 23:59 » n'apprend rien.
 */
export function detailAction(a, versAgenda = false) {
  const bits = [];
  const debut = dateISO(a?.debut);
  if (debut) bits.push(`${jourSemaineCourt(debut)} à ${heure(debut)}`);
  if (a?.lieu) bits.push(a.lieu);
  const ech = versAgenda ? null : dateISO(a?.echeance);
  if (ech) {
    const hh = ech.getHours();
    bits.push(hh >= 20 || hh < 5 || String(a.echeance).length <= 10 ? `avant le ${jourSemaineCourt(ech)}` : `avant le ${jourSemaineCourt(ech)} à ${heure(ech)}`);
  }
  const du = a?.duree == null ? "" : String(a.duree).toUpperCase();
  if (du && du !== "NONE") bits.push(du === "REMINDER" ? "simple rappel" : /^\d+$/.test(du) ? duree(Number(du)) : du.toLowerCase());
  const p = String(a?.priorite || "").toUpperCase();
  if (p === "ASAP") bits.push("urgent");
  else if (p === "HIGH") bits.push("important");
  return bits.join(" · ");
}

// --- L'état d'une proposition (Proposition, Models.swift) ---

export const appliquee = (p) => p?.statut === "applique";
export const convertie = (p) => p?.statut === "converti";
export const refusee = (p) => p?.statut === "refuse";
export const echouee = (p) => p?.statut === "echec";
export const versAgenda = (p) => p?.source === "agenda";
export const nombreEchecs = (p) => p?.bilan?.echoues?.length || 0;
export const rangeesEnRappels = (p) => Math.max(0, (p?.actionsOrigine?.length ?? p?.actions?.length ?? 0) - (p?.actions?.length || 0));
/** Tout existait déjà : rien d'écrit, rien de raté. */
export const toutDejaLaProp = (p) => appliquee(p) && Boolean(p.bilan?.dejaLa?.length) && !(p.bilan?.faits || []).length && nombreEchecs(p) === 0;
const memeNom = (nom, a) => nom != null && (nom === libelleAction(a) || nom === a.nom || nom === a.titre);
export const erreurPour = (p, a) => p?.bilan?.echoues?.find((e) => memeNom(e?.nom, a))?.erreur ?? null;
export const echecAnnulation = (p, a) => p?.annulationRatee?.find((e) => memeNom(e?.nom, a)) ?? null;
/** Décochée par Sam au moment du « Oui » : pas faite, exprès. */
export const estEcartee = (p, a) => appliquee(p) && Boolean(p.bilan?.ecartees?.includes(a.nom ?? a.titre));
/** « Pas défait : … » après une annulation incomplète, sinon « Pas fait : … ». */
export function erreurAffichee(p, a) {
  if (estEcartee(p, a)) return null;
  const rate = echecAnnulation(p, a);
  if (rate) return `Pas défait : ${rate.erreur || "raison inconnue"}`;
  if (!(appliquee(p) || echouee(p)) || p.annulee === true) return null;
  const e = erreurPour(p, a);
  return e ? `Pas fait : ${e}` : null;
}
/** L'action a bien été défaite (annulation totale, ou partielle sans elle). */
export function estDefaite(p, a) {
  if (p?.annulee === true) return true;
  if (!p?.annulationRatee?.length) return false;
  return !echecAnnulation(p, a);
}

/** L'en-tête de la carte, avant et après « Oui ». */
export function entete(p) {
  const n = p.actions?.length || 0;
  if (convertie(p)) return "Rangé dans tes rappels";
  if (echouee(p)) {
    const parLigne = (p.actions || []).some((a) => erreurPour(p, a) != null);
    return parLigne ? "Rien n'a pu être fait" : `Pas fait : ${p.bilan?.echoues?.map((e) => e?.erreur).find(Boolean) || "raison inconnue"}`;
  }
  if (!appliquee(p)) return versAgenda(p) ? "Rémy propose de changer ton agenda" : "Rémy propose de changer ton planning";
  if (p.annulationRatee?.length) return "Annulation incomplète";
  if (p.annulee === true) return "Annulé : tout est revenu comme avant.";
  if (toutDejaLaProp(p)) return versAgenda(p) ? "Déjà dans ton agenda : rien à ajouter" : "Déjà dans ton planning : rien à ajouter";
  const echecs = nombreEchecs(p);
  const ecartees = p.bilan?.ecartees?.length || 0;
  if (!echecs) {
    const fait = versAgenda(p) ? "C'est fait dans ton agenda" : "C'est fait dans ton planning";
    return ecartees ? `${fait} (${Math.max(0, n - ecartees)} sur ${n})` : fait;
  }
  return echecs >= n ? "Rien n'a pu être fait" : "En partie fait";
}

/** « Fait, dans « Perso ». » / « Fait, dans ton planning. » / « Fait, dans ton agenda. » */
export const ouFait = (p) => (versAgenda(p) ? "Fait, dans ton agenda." : p.bilan?.espace ? `Fait, dans « ${p.bilan.espace} ».` : "Fait, dans ton planning.");

/** « Oui, fais-le » ; « Oui, les 2 » ; « Oui, celle-ci » ; « Rien de coché » (SelectionLignes). */
export function libelleOui(total, gardes) {
  if (gardes === total) return "Oui, fais-le";
  if (gardes === 0) return "Rien de coché";
  return gardes === 1 ? "Oui, celle-ci" : `Oui, les ${gardes}`;
}
/** Les rangs à envoyer (ceux encore cochés) ; null : tout part. */
export function rangsGardes(actions, decoches) {
  const tous = actions.map((a, k) => a.rang ?? k);
  const gardes = tous.filter((r) => !decoches.has(r));
  return gardes.length === tous.length ? null : gardes;
}

/** L'aide sous les boutons. */
export function aideReglage({ partielle, ajustable }) {
  if (partielle) return `Décoche ce que tu ne veux pas${ajustable ? " ; touche une ligne pour la régler." : "."}`;
  return ajustable ? "Touche une ligne pour régler la date, la durée ou la catégorie, ou en faire un rappel." : "Pour changer un détail, réponds-le simplement à Rémy.";
}

/** Le bilan d'une réponse de /api/motion/apply ou /api/google/apply (ResultatApplication.bilan). */
export function bilanDeReponse(r) {
  const res = r?.results || [];
  const nom = (x) => x?.nom ?? x?.titre;
  const deja = res.filter(estDejaLa).map(nom).filter(Boolean);
  const b = {
    faits: res.filter((x) => x?.ok === true && !estDejaLa(x)).map(nom).filter(Boolean),
    echoues: res.filter((x) => x?.ok !== true && !estDejaLa(x)).map((x) => ({ nom: nom(x) ?? null, erreur: x?.erreur ?? null })),
    espace: res.find((x) => x?.ok === true && x?.espace)?.espace ?? null,
  };
  if (deja.length) b.dejaLa = deja;
  if (r?.ecartees?.length) b.ecartees = r.ecartees;
  return b;
}
/** Le statut de la carte après application. */
export const statutDeReponse = (r) => (r?.etat === "echouee" && !toutDejaLa(r) ? "echec" : "applique");

/** Le bandeau après « Oui ». */
export function phraseApplication(p, r, bilan) {
  const n = p.actions?.length || 0;
  if (toutDejaLa(r)) return versAgenda(p) ? "Déjà dans ton agenda : rien à ajouter." : "Déjà dans ton planning : rien à ajouter.";
  const echecs = bilan.echoues?.length || 0;
  const ecartees = bilan.ecartees?.length || 0;
  if (!echecs) {
    const ou = versAgenda(p) ? " dans ton agenda" : bilan.espace ? ` dans « ${bilan.espace} »` : " dans ton planning";
    return ecartees ? `C'est fait${ou} (${n - ecartees} sur ${n}).` : `C'est fait${ou}.`;
  }
  if (echecs >= n - ecartees) return "Rien n'a pu être fait : la raison est sous chaque ligne.";
  const s = echecs > 1;
  return `${echecs} changement${s ? "s" : ""} sur ${n} n'${s ? "ont" : "a"} pas pu être fait${s ? "s" : ""} : la raison est sous la ligne.`;
}

/** Ce que dit une règle validée (RetourRegle.phrase). */
export function phraseRegle(r) {
  const regles = Array.isArray(r?.regles) ? r.regles : [];
  if (regles.length && regles.every((x) => x?.deja === true)) return "Cette règle existait déjà : rien n'a changé.";
  if (regles.some((x) => x?.fusionnee === true)) return "Règle mise à jour comme sur la carte : Rémy te proposera la tâche avant chaque événement qui correspond.";
  return "Règle créée : Rémy te proposera la tâche avant chaque événement qui correspond.";
}
/** « Rappel · mer. 30 oct., 09:00 » ou « Rappel sans heure ». */
export function quandCarnet(iso) {
  const d = dateISO(iso);
  return d ? `Rappel · ${jourSemaineCourt(d)}, ${heure(d)}` : "Rappel sans heure";
}

// --- L'écriture en cours, et les cartes montées ---

let ecritGlobal = false;
const cartes = new Set();
/** Rémy commence ou finit d'écrire : les boutons attendent la fin. */
export function majEcriture(ecrit) {
  ecritGlobal = Boolean(ecrit);
  for (const c of [...cartes]) {
    if (!c.el.isConnected && c.vue) {
      cartes.delete(c);
      continue;
    }
    c.ecrit = ecritGlobal;
    c.dessiner();
  }
}

// GET /api/motion/ledger à l'ouverture d'un fil : une carte annulée ailleurs
// (sur l'iPhone, avant un redémarrage) est montrée « Annulé ».
let journal = null; // { a, promesse }
function lireJournal() {
  if (journal && Date.now() - journal.a < 15000) return journal.promesse;
  const promesse = api("/api/motion/ledger", { delai: 15000 }).then((r) => new Set((r?.entries || []).filter((e) => e?.annule).map((e) => e.id))).catch(() => null);
  journal = { a: Date.now(), promesse };
  return promesse;
}

/** Pendant une écriture : la file de Motion, dite (« En file chez Motion : ~20 s »). */
export function suivreAttenteMotion(ligne) {
  let fini = false;
  const lent = async () => {
    try {
      const f = await api("/api/motion/file", { delai: 4000 });
      const t = phraseAttenteMotion(f);
      if (!fini && t) {
        vider(ligne, icone("sablier"), h("span", null, t));
        ligne.hidden = false;
      }
    } catch {}
  };
  evenements.addEventListener("motion-lent", lent);
  return () => {
    fini = true;
    evenements.removeEventListener("motion-lent", lent);
    ligne.hidden = true;
  };
}

/** La raison d'une erreur, sans le point final (« Pas ajouté : x. Réessaie… »). */
const sansPoint = (t) => String(t || "").replace(/[.\s]+$/, "");

/**
 * La carte complète d'une proposition. `c` : la conversation ({ id, … }) ;
 * `relire()` relit la conversation (après un 409 : l'état réel) ; `ctx.aller`
 * pour les liens (Réglages › Règles, Projets).
 */
export function carteProposition(p, c, index, { ecrit = ecritGlobal, relire, ctx } = {}) {
  const el = h("div", { class: "proposition prop-carte" });
  const carte = { el, ecrit: Boolean(ecrit), dessiner: () => {}, vue: false };
  const etat = { enCours: false, decoches: p._decoches || new Set() };
  p._decoches = etat.decoches;
  // Échec relu plus tard : les lignes écartées au premier essai restent décochées.
  if (echouee(p) && !etat.decoches.size && p.bilan?.ecartees?.length) {
    p.actions.forEach((a, k) => {
      if (p.bilan.ecartees.includes(a.nom ?? a.titre)) etat.decoches.add(a.rang ?? k);
    });
  }
  carte.dessiner = () => {
    carte.vue = true;
    if (p.source === "regle") return dessinerRegle(el, p, c, carte, etat, { relire, ctx });
    if (p.source === "carnet") return dessinerCarnet(el, p, c, carte, etat, { relire, ctx });
    return dessinerPlanning(el, p, c, index, carte, etat, { relire, ctx });
  };
  cartes.add(carte);
  carte.dessiner();
  if (appliquee(p) && p.ledgerId && p.annulee !== true && p.source !== "regle" && p.source !== "carnet") {
    lireJournal().then((annulees) => {
      if (annulees?.has(p.ledgerId) && p.annulee !== true) {
        p.annulee = true;
        carte.dessiner();
      }
    });
  }
  // Les noms des catégories viennent de la tour (une fois).
  if (p.actions?.some((a) => a.etiquettes?.length) && !etiquettesConnues) lireEtiquettes().then(() => carte.dessiner()).catch(() => {});
  return el;
}

let etiquettesConnues = null;
export async function lireEtiquettes() {
  if (!etiquettesConnues) etiquettesConnues = (await api("/api/etiquettes"))?.etiquettes || [];
  return etiquettesConnues;
}
const nomsCategories = (a) => (etiquettesConnues || []).filter((e) => (a.etiquettes || []).includes(e.id)).map((e) => e.nom);

/** Un geste à la fois par carte : « … » pendant l'envoi. */
async function agir(carte, etat, faire) {
  if (etat.enCours) return;
  etat.enCours = true;
  carte.dessiner();
  try {
    await faire();
  } finally {
    etat.enCours = false;
    carte.dessiner();
  }
}

// --- Motion et l'agenda ---

function dessinerPlanning(el, p, c, index, carte, etat, { relire, ctx }) {
  if (refusee(p) || !p.actions?.length) {
    // « Non merci » : la carte ne revient pas (ChatModel.carte).
    el.hidden = true;
    vider(el);
    return;
  }
  el.hidden = false;
  const ouverte = !appliquee(p) && !convertie(p);
  const partielle = ouverte && !carte.ecrit && Boolean(p.id) && (p.actions.length > 1 || etat.decoches.size > 0) && sait("propositions-partielles-v1");
  const ajustable = ouverte && !refusee(p) && !echouee(p) && !carte.ecrit && Boolean(p.id) && Boolean(c?.id) && sait("propositions-ajustables-v1");
  const peutAjuster = (a) => ["creer", "modifier"].includes(typeVerbe(a));
  const symbole = convertie(p) ? "cloche" : echouee(p) || p.annulationRatee?.length ? "alerte" : !appliquee(p) ? "etincelles" : p.annulee === true ? "retour" : nombreEchecs(p) ? "alerte" : "coche";
  const teinte = convertie(p) ? "" : echouee(p) || p.annulationRatee?.length ? "danger" : !appliquee(p) ? "signal" : "";
  el.classList.toggle("reglee", !ouverte);
  const tete = h("div", { class: "prop-tete" }, h("span", { class: `prop-symbole ${teinte}` }, icone(symbole)), h("strong", { class: "prop-entete" }, entete(p)),
    p.ajustee === true && ouverte ? h("span", { class: "prop-capsule" }, "ajustée par toi") : null);
  const blocs = [tete];
  if (ouverte && p.resume) blocs.push(h("p", { class: "prop-resume" }, p.resume));
  if (ouverte && p.perimee === true) blocs.push(h("p", { class: "prop-perimee" }, icone("horloge"), h("span", null, p.raisonPeremption || "Proposition ancienne : vérifie-la avant de dire oui.")));
  p.actions.forEach((a, k) => {
    const rang = a.rang ?? k;
    const decochee = partielle && etat.decoches.has(rang);
    const reglable = ajustable && peutAjuster(a) && !decochee;
    const d = detailAction(a, versAgenda(p));
    const err = erreurAffichee(p, a);
    const barree = estDefaite(p, a) || estEcartee(p, a);
    const cats = nomsCategories(a);
    const contenu = [
      h("span", { class: `prop-verbe ${typeVerbe(a) === "supprimer" ? "danger" : ""}` }, verbe(a)),
      h("span", { class: "prop-corps" },
        h("span", { class: `prop-nom${barree ? " barree" : ""}` }, libelleAction(a)),
        d ? h("span", { class: "prop-detail" }, d)
          : reglable && typeVerbe(a) === "creer" && !versAgenda(p) ? h("span", { class: "prop-detail discret" }, "Sans date : Motion la case quand il peut") : null,
        cats.length ? h("span", { class: "prop-categories" }, cats.join(" · ")) : null,
        err ? h("span", { class: "prop-erreur" }, err) : null),
      reglable ? h("span", { class: "prop-regler", "aria-hidden": "true" }, icone("reglage")) : null,
    ];
    const ligne = reglable
      ? h("button", { type: "button", class: "prop-ligne cliquable", title: "Régler la date, la durée ou la catégorie avant de dire oui", "aria-label": `${verbe(a)} « ${libelleAction(a)} »${d ? `, ${d}` : ""} — régler`,
        onclick: () => ouvrirAjuster({ p, c, a, rang, versAgenda: versAgenda(p), apres: () => carte.dessiner(), relire, ctx }) }, contenu)
      : h("div", { class: "prop-ligne" }, contenu);
    const caseLigne = partielle ? h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": String(!decochee), "aria-label": `Garder « ${libelleAction(a)} »`,
      onclick: () => {
        if (etat.decoches.has(rang)) etat.decoches.delete(rang);
        else etat.decoches.add(rang);
        carte.dessiner();
        el.querySelectorAll(".prop-rangee > .case")[k]?.focus();
      } }) : null;
    blocs.push(h("div", { class: `prop-rangee${decochee ? " decochee" : ""}` }, caseLigne, ligne));
  });
  const ranges = rangeesEnRappels(p);
  if (ranges > 0 && !convertie(p)) blocs.push(h("p", { class: "prop-ranges" }, icone("cloche"), ranges > 1 ? `${ranges} lignes rangées dans tes rappels` : "1 ligne rangée dans tes rappels"));

  // Le pied.
  if (convertie(p)) {
    // rien de plus
  } else if (!appliquee(p)) {
    const gardes = p.actions.length - (partielle ? etat.decoches.size : 0);
    const non = bouton("Non merci", { classe: "papier" });
    non.addEventListener("click", () => agir(carte, etat, () => refuser(p, c, carte, { relire })));
    const oui = bouton(etat.enCours ? "…" : echouee(p) ? "Réessayer" : libelleOui(p.actions.length, gardes), { classe: "plein", icone: echouee(p) ? "rafraichir" : "coche" });
    oui.disabled = carte.ecrit || gardes === 0 || etat.enCours || !c?.id;
    non.disabled = carte.ecrit || etat.enCours || !c?.id;
    if (etat.enCours) oui.setAttribute("aria-busy", "true");
    oui.addEventListener("click", async () => {
      const rangs = partielle ? rangsGardes(p.actions, etat.decoches) : null;
      // Périmée : jamais appliquée en silence.
      if (p.perimee === true) {
        if (!(await confirmerPerimee(p, ajustable))) return;
        return agir(carte, etat, () => appliquer(p, c, index, carte, { rangs, confirmer: true, relire }));
      }
      agir(carte, etat, () => appliquer(p, c, index, carte, { rangs, relire }));
    });
    const attente = h("p", { class: "prop-attente", hidden: true });
    blocs.push(h("div", { class: "prop-pied" }, h("div", { class: "rangee" }, non, oui), attente,
      etat.enCours ? null : h("p", { class: "prop-aide" }, carte.ecrit ? "Rémy écrit encore : attends la fin de sa réponse pour lui répondre." : aideReglage({ partielle, ajustable }))));
    if (etat.enCours) etat.finAttente?.();
    if (etat.enCours) etat.finAttente = suivreAttenteMotion(attente);
  } else if (p.annulationRatee?.length) {
    blocs.push(h("div", { class: "prop-pied" }, h("p", { class: "prop-aide" }, `Vérifie ${versAgenda(p) ? "ton agenda" : "ton planning"} : ce qui est marqué n'a pas pu être défait.`)));
  } else if (toutDejaLaProp(p)) {
    // rien à défaire
  } else if (p.annulee !== true && p.ledgerId && nombreEchecs(p) < p.actions.length) {
    const annuler = bouton(etat.enCours ? "…" : "Annuler", { classe: "papier petit", icone: "retour" });
    annuler.disabled = etat.enCours;
    annuler.addEventListener("click", () => agir(carte, etat, () => annulerProposition(p, carte)));
    blocs.push(h("div", { class: "prop-pied prop-fait" }, h("span", null, ouFait(p)), annuler));
  }
  if (!etat.enCours) {
    etat.finAttente?.();
    etat.finAttente = null;
  }
  vider(el, blocs);
}

/** La boîte « Proposition ancienne » : Appliquer quand même / Pas maintenant. */
function confirmerPerimee(p, ajustable) {
  const f = feuille({
    titre: "Proposition ancienne",
    contenu: h("p", null, `${p.raisonPeremption || "Elle date un peu."}${ajustable ? " Touche une ligne pour la régler d'abord." : ""}`),
    pied: [bouton("Pas maintenant", { classe: "papier", onclick: () => f.fermer(false) }), bouton("Appliquer quand même", { classe: "plein", onclick: () => f.fermer(true) })],
  });
  f.el.querySelector(".feuille-pied .btn:last-child")?.focus();
  return f.fini.then((v) => v === true);
}

async function appliquer(p, c, index, carte, { rangs = null, confirmer = false, relire } = {}) {
  if (rangs && !rangs.length) {
    dire("Rien de coché : coche au moins une ligne, ou « Non merci ».");
    return;
  }
  const corps = { actions: p.actions, convId: c.id, index, propositionId: p.id, idCommande: nouvelId() };
  if (p.resume) corps.resume = p.resume;
  if (rangs) corps.rangs = rangs;
  if (confirmer) corps.confirmer = true;
  try {
    const r = await ecrire(versAgenda(p) ? "/api/google/apply" : "/api/motion/apply", corps, { delai: 180000 });
    const bilan = bilanDeReponse(r);
    p.statut = statutDeReponse(r);
    p.ledgerId = r?.ledgerId ?? p.ledgerId;
    p.bilan = bilan;
    p.annulee = false;
    p.annulationRatee = undefined;
    delete p.perimee;
    delete p.raisonPeremption;
    const echecs = bilan.echoues.length;
    dire(phraseApplication(p, r, bilan), {
      genre: toutDejaLa(r) ? "info" : echecs ? "erreur" : "succes",
      action: !echecs && r?.ledgerId && !toutDejaLa(r) ? { libelle: "Annuler", faire: () => agir(carte, { enCours: false }, () => annulerProposition(p, carte)) } : null,
    });
  } catch (err) {
    if (err?.nature === "auth" || err?.nature === "annule") return;
    if (err?.statut === 409 && /confirme pour l'appliquer/.test(err.message || "")) {
      // Périmée (la tour l'a vu avant la carte) : rien n'est écrit, la carte le dit.
      p.perimee = true;
      p.raisonPeremption = err.message;
      dire(`Rien n'a été fait : ${err.message}`, { genre: "erreur" });
      return;
    }
    if (err?.statut === 409) {
      dire(err.message, { genre: "erreur" });
      relire?.();
      return;
    }
    if (err?.statut === 502 || err?.statut === 503) {
      // Motion ou Google n'a rien pu écrire : la carte le dit et reste retentable.
      p.statut = "echec";
      p.bilan = { faits: [], echoues: [{ nom: null, erreur: err.message }] };
      dire(`Pas fait : ${err.message}`, { genre: "erreur" });
      return;
    }
    direErreur(err, () => agir(carte, { enCours: false }, () => appliquer(p, c, index, carte, { rangs, confirmer, relire })), "Pas appliquée");
  }
}

async function annulerProposition(p, carte) {
  let r;
  try {
    r = await ecrire(versAgenda(p) ? "/api/google/undo" : "/api/motion/undo", { id: p.ledgerId }, { delai: 150000 });
  } catch (err) {
    // « Déjà annulé » : l'état voulu est atteint, c'est un succès.
    if (err?.statut === 409 && /^Déjà annulé/.test(err.message || "")) r = { ok: true, dejaAnnule: true };
    else {
      if (err?.nature !== "auth") direErreur(err, () => agir(carte, { enCours: false }, () => annulerProposition(p, carte)), "Pas annulée");
      return;
    }
  }
  const rates = (r?.undone || []).filter((x) => x?.ok === false).map((x) => ({ nom: x.nom ?? x.titre ?? null, erreur: x.erreur ?? null }));
  if (r?.ok === false && rates.length) p.annulationRatee = rates;
  else p.annulee = true;
  const premier = (r?.undone || []).find((x) => x?.ok === false);
  if (r?.ok === false && premier) dire(`Annulation incomplète : « ${premier.nom || premier.titre || "?"} » — vérifie ${versAgenda(p) ? "ton agenda" : "ton planning"}.`, { genre: "erreur" });
  else dire("Annulé : tout est revenu comme avant.", { genre: "succes" });
}

/** « Non merci » : la carte disparaît et le refus est enregistré ; s'il ne l'est pas, elle revient. */
async function refuser(p, c, carte, { relire }) {
  const avant = p.statut;
  p.statut = "refuse";
  carte.dessiner();
  if (!p.id || !c?.id) {
    dire("D'accord, rien n'a été changé.");
    return;
  }
  try {
    await ecrire(`/api/conversations/${seg(c.id)}/propositions/${seg(p.id)}/refus`, {});
    dire("D'accord, rien n'a été changé.");
  } catch (err) {
    p.statut = avant;
    if (err?.nature === "auth") return;
    if (err?.statut === 409) {
      // Appliquée entre-temps (ailleurs) : l'état réel est relu.
      dire(err.message, { genre: "erreur" });
      relire?.();
      return;
    }
    dire(`« Non merci » pas enregistré : ${texteErreur(err)}`, { genre: "erreur" });
  }
}

// --- Une règle (CarteRegle) ---

function dessinerRegle(el, p, c, carte, etat, { relire, ctx }) {
  if (refusee(p)) {
    el.hidden = true;
    vider(el);
    return;
  }
  el.hidden = false;
  const a = p.actions?.[0] || {};
  const fait = appliquee(p);
  el.classList.toggle("reglee", fait);
  const blocs = [h("div", { class: "prop-tete" }, h("span", { class: `prop-symbole ${fait ? "" : "signal"}` }, icone(fait ? "coche" : "embranchement")),
    h("strong", { class: "prop-entete" }, fait ? (toutDejaLaProp(p) ? "Règle déjà là" : "Règle créée") : "Nouvelle règle"))];
  if (a.nom) blocs.push(h("p", { class: "prop-titre" }, a.nom));
  if (a.description) blocs.push(h("p", { class: "prop-resume" }, a.description));
  if (fait) {
    blocs.push(h("p", { class: "prop-aide" }, "Avant chaque événement qui correspond, Rémy te proposera la tâche. Tes règles sont dans Réglages."),
      h("a", { class: "prop-lien", href: "#/reglages/regles", onclick: (e) => { if (ctx?.aller) { e.preventDefault(); ctx.aller("reglages/regles"); } } }, "Voir mes règles dans Réglages"));
  } else if (!carte.ecrit) {
    const creer = bouton(etat.enCours ? "…" : "Créer la règle", { classe: "plein", icone: "coche" });
    const non = bouton("Non merci", { classe: "papier" });
    creer.disabled = etat.enCours || !c?.id;
    non.disabled = etat.enCours || !c?.id;
    creer.addEventListener("click", () => agir(carte, etat, () => validerRegle(p, c, { relire })));
    non.addEventListener("click", () => agir(carte, etat, () => refuser(p, c, carte, { relire })));
    blocs.push(h("div", { class: "rangee prop-boutons" }, creer, non));
  }
  vider(el, blocs);
}

async function validerRegle(p, c, { relire }) {
  try {
    const r = await ecrire(`/api/conversations/${seg(c.id)}/propositions/${seg(p.id)}/regle`, {});
    p.statut = "applique";
    if ((r?.regles || []).length && r.regles.every((x) => x?.deja === true)) p.bilan = { faits: [], dejaLa: [p.actions?.[0]?.nom || "règle"] };
    else if (r?.bilan) p.bilan = r.bilan;
    dire(phraseRegle(r), { genre: "succes" });
  } catch (err) {
    if (err?.nature === "auth") return;
    if (err?.statut === 409) {
      dire(err.message, { genre: "erreur" });
      relire?.();
      return;
    }
    direErreur(err, null, "Règle pas créée");
  }
}

// --- Le carnet (CarteCarnet) ---

function dessinerCarnet(el, p, c, carte, etat, { relire, ctx }) {
  if (refusee(p)) {
    el.hidden = true;
    vider(el);
    return;
  }
  el.hidden = false;
  const fait = appliquee(p);
  el.classList.toggle("reglee", fait);
  const blocs = [h("div", { class: "prop-tete" }, h("span", { class: `prop-symbole ${fait ? "" : "signal"}` }, icone(fait ? "coche" : "panier")),
    h("strong", { class: "prop-entete" }, fait ? "Dans ton carnet" : "Pour ton carnet"))];
  for (const a of p.actions || []) {
    if (a.type === "liste") blocs.push(h("div", { class: "prop-carnet" }, h("p", { class: "prop-titre" }, (a.articles || []).join(", ")), h("p", { class: "prop-detail" }, icone("liste"), `Liste « ${a.liste || "Courses"} »`)));
    else if (a.type === "rappel") blocs.push(h("div", { class: "prop-carnet" }, h("p", { class: "prop-titre" }, a.texte || "Rappel"), h("p", { class: "prop-detail" }, icone("cloche"), quandCarnet(a.quand))));
  }
  if (fait) {
    blocs.push(h("a", { class: "prop-lien", href: "#/projets", onclick: (e) => { if (ctx?.aller) { e.preventDefault(); ctx.aller("projets"); } } }, "Voir mes listes et rappels"));
  } else if (!carte.ecrit) {
    const ajouter = bouton(etat.enCours ? "…" : "Ajouter", { classe: "plein", icone: "coche" });
    const non = bouton("Non merci", { classe: "papier" });
    ajouter.disabled = etat.enCours || !c?.id;
    non.disabled = etat.enCours || !c?.id;
    ajouter.addEventListener("click", () => agir(carte, etat, () => validerCarnet(p, c, { relire })));
    non.addEventListener("click", () => agir(carte, etat, () => refuser(p, c, carte, { relire })));
    blocs.push(h("div", { class: "rangee prop-boutons" }, ajouter, non));
  }
  vider(el, blocs);
}

async function validerCarnet(p, c, { relire }) {
  if (!p.id || !c?.id) {
    dire("Cette proposition n'a pas d'identifiant : redemande-la à Rémy.", { genre: "erreur" });
    return;
  }
  try {
    const r = await ecrire(`/api/conversations/${seg(c.id)}/propositions/${seg(p.id)}/carnet`, {});
    p.statut = "applique";
    if (r?.bilan) p.bilan = r.bilan;
    const faits = r?.bilan?.faits || [];
    dire(faits.length ? `Ajouté : ${faits.join(", ")}.` : "C'est dans ton carnet.", { genre: "succes" });
  } catch (err) {
    if (err?.nature === "auth") return;
    if (err?.statut === 409) {
      dire(err.message, { genre: "erreur" });
      relire?.();
      return;
    }
    dire(`Pas ajouté : ${sansPoint(texteErreur(err))}. Réessaie, ou ajoute-le à la main dans Projets.`, { genre: "erreur" });
  }
}
