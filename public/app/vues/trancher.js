// « À trancher », la revue du dimanche et le tri des retards, pour
// Aujourd'hui (contrat A) : CarteATrancher, ListeTri, LigneTri,
// RetardsFeuille, RevueDimanche et FeuillesTri de l'iPhone
// (ATrancherVues.swift ; la logique est dans ../analyse/rituel.js). Lit
// /api/a-trancher et /api/rappels au plus une fois par minute (sauf
// Rafraîchir), /api/revue à l'ouverture de la revue ; jamais /api/dashboard.
// Un geste par ligne, par les chemins qui existent déjà, et chacun s'annule
// depuis son bandeau. Aucun appel IA.
import { api, ecrire, remplacer, nouvelId, seg, sait, evenements } from "../api.js";
import { h, vider, icone, bouton, dire, direErreur, squelette, blocErreur, vide, local, feuille } from "../ui.js";
import * as R from "../analyse/rituel.js";
import { couleurProjet } from "../couleurs.js";
import { terminer, decaler, echeanceDans } from "./gerer.js";

const MINUTE = 60e3;
/** Un fil supprimé attend ce délai avant de partir (« Annuler » d'abord : une suppression de fil ne se rattrape pas). */
const DELAI_FIL = 6000;
const CLE_VISITE = "remy-derniere-visite";
const CLE_REVUE_ACTIVE = "remy-revue-dimanche";
const CLE_REVUE_FAITE = "remy-revue-faite";

const ICONES = { carte: "proposition", doublon: "copier", rappel: "cloche", "rappel-retard": "cloche", articles: "chariot", idee: "ampoule", fil: "remy", retard: "retard" };
const ICONES_GESTE = { oui: "coche", fait: "coche", non: "fermer", plusTard: "horloge", supprimer: "corbeille", retirer: "corbeille", fusionner: "fusion", garder: "ranger", demain: "leverSoleil", abandonner: "moins" };

// Ce qui survit à un nouveau montage d'Aujourd'hui (même page).
const lu = { vue: null, luA: null, essaiA: -Infinity, erreur: null, chargement: false, lecture: null, rappels: null };
const masquees = new Set(); // lignes réglées ici (elles reviennent si « Annuler »)
const enCours = new Set(); // lignes dont le geste est en route
const enSuppression = new Set(); // fils qui attendent leur suppression
const revue = { donnees: null, chargement: false, erreur: null };
// Session perdue : l'écran de connexion prend la place, la feuille ouverte se ferme.
const feuillesOuvertes = new Set();
evenements.addEventListener("session-perdue", () => {
  for (const f of [...feuillesOuvertes]) f.fermer();
});

function lireTour() {
  if (lu.lecture) return lu.lecture;
  lu.essaiA = Date.now();
  lu.chargement = true;
  lu.lecture = (async () => {
    const [t, r] = await Promise.allSettled([api("/api/a-trancher", { delai: 30000 }), api("/api/rappels", { delai: 20000 })]);
    if (t.status === "fulfilled") {
      lu.vue = t.value;
      lu.luA = Date.now();
      lu.erreur = null;
      // La tour a relu : ce qui était réglé ici n'y est plus (sauf un geste encore en route).
      for (const c of [...masquees]) if (!enSuppression.has(c) && !enCours.has(c)) masquees.delete(c);
    } else lu.erreur = t.reason;
    if (r.status === "fulfilled") lu.rappels = r.value?.rappels || [];
    lu.chargement = false;
    lu.lecture = null;
    return t.status === "fulfilled";
  })();
  return lu.lecture;
}

const groupes = () => R.filtrerGroupes(lu.vue?.groupes, { masquees, rappels: lu.rappels });
/** Ce qui est en retard : les tâches Motion (tour) et les rappels datés passés. */
const retards = () => [...(lu.vue?.retards || []), ...R.rappelsEnRetard(lu.rappels)].filter((l) => !masquees.has(l.cle));
const revueProposee = () => R.revueProposee({ active: local.lire(CLE_REVUE_ACTIVE, true) !== false, faiteLe: local.lire(CLE_REVUE_FAITE, null) });
const erreurMontree = (err) => (err && err.nature !== "auth" ? err : null);
const enAttente = (texte) => h("div", { class: "trancher-chargement", role: "status" }, h("span", { class: "boite-spinner", "aria-hidden": "true" }), texte);
const poserRappels = (liste) => ecrire("/api/rappels", { rappels: liste.map((r) => ({ id: r.id, texte: r.texte, quand: r.quand ?? null, fait: Boolean(r.fait), etiquettes: r.etiquettes || [] })) });

/**
 * La carte « À trancher » (ou « Revue du dimanche ») et ses feuilles.
 * `relire()` : relecture discrète du tableau par Aujourd'hui.
 */
export function creerTrancher(ctx, { relire } = {}) {
  const carte = h("div", { class: "trancher-carte" });
  let ouverte = null; // { quoi, f, corps, dessiner }
  const apres = () => relire?.();

  async function maj({ frais = false } = {}) {
    if (!sait("a-trancher-v1")) return vider(carte);
    if (!lu.lecture && !frais && Date.now() - lu.essaiA < MINUTE) return dessiner();
    const p = lireTour();
    dessiner();
    const ok = await p;
    dessiner();
    // Tour injoignable : la visite n'est pas notée (l'absence sera encore là au prochain retour).
    if (ok) noterVisite();
  }

  /** Au retour après plus de 3 jours : « On trie tes retards ? », jamais par-dessus une autre feuille. */
  function noterVisite() {
    const avant = local.lire(CLE_VISITE, null);
    local.ecrire(CLE_VISITE, Date.now());
    if (!R.apresAbsence(typeof avant === "number" ? avant : null)) return;
    setTimeout(() => {
      if (!carte.isConnected || ouverte || document.querySelector("dialog[open]")) return;
      if (retards().length) ouvrir("retards");
    }, 1500);
  }

  function dessiner() {
    dessinerCarte();
    ouverte?.dessiner();
  }

  // --- La carte d'Aujourd'hui : rien quand rien n'attend ---
  function dessinerCarte() {
    if (!sait("a-trancher-v1")) return vider(carte);
    const dimanche = revueProposee();
    const n = R.totalGroupes(groupes());
    const titre = dimanche ? "Revue du dimanche" : "À trancher";
    if (!lu.vue && !dimanche) {
      const err = erreurMontree(lu.erreur);
      if (err) return vider(carte, h("section", { class: "carte trancher", "aria-label": titre }, h("h2", { class: "titre-section" }, titre), blocErreur(err, () => maj({ frais: true }))));
      if (lu.chargement) return vider(carte, h("section", { class: "carte trancher", "aria-label": titre }, h("h2", { class: "titre-section" }, titre), squelette([0.75, 0.5])));
      return vider(carte);
    }
    if (!dimanche && !n) return vider(carte);
    const reportes = lu.vue?.reportes || 0;
    vider(carte, h("section", { class: "carte trancher", "aria-label": titre },
      h("h2", { class: "titre-section" }, titre, !dimanche ? h("span", { class: "compte" }, String(n)) : null,
        !dimanche && reportes ? h("span", { class: "fin aide" }, `${reportes} reporté${reportes > 1 ? "s" : ""}`) : null),
      h("p", { class: "aide-carte" }, dimanche ? "Dix minutes pour solder la semaine : ce qui est fait, ce qui a glissé, tes idées, et trois décisions pour la suite." : R.phraseCarteTrancher(n)),
      h("div", { class: "rangee", style: { marginTop: "12px" } },
        dimanche
          ? bouton("Commencer la revue", { classe: "plein", icone: "revue", onclick: () => ouvrir("revue") })
          : bouton("Trancher", { classe: "papier", icone: "liste", onclick: () => ouvrir("trancher") }),
        dimanche && n ? bouton(`À trancher · ${n}`, { classe: "papier", onclick: () => ouvrir("trancher") }) : null)));
  }

  // --- Une ligne et ses gestes (LigneTri) ---
  function ligneTri(l) {
    const occupee = enCours.has(l.cle);
    const st = R.sousTitreLigne(l);
    return h("li", { class: `trancher-ligne${occupee ? " occupee" : ""}`, dataset: { cle: l.cle } },
      h("div", { class: "trancher-tete" },
        h("span", { class: "trancher-ic" }, icone(ICONES[l.type] || "liste")),
        h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, l.texte), st ? h("div", { class: "meta" }, st) : null),
        occupee ? h("span", { class: "boite-spinner", role: "status", "aria-label": "Envoi en cours" }) : null),
      h("div", { class: "trancher-gestes" },
        R.gestesTri(l.type).map(([g, lib]) => {
          const b = bouton(lib, { classe: R.PRINCIPAUX.has(g) ? "plein" : "papier", icone: ICONES_GESTE[g], etiquette: `${lib} : ${l.texte}` });
          b.dataset.geste = g;
          b.disabled = occupee;
          b.addEventListener("click", () => agir(g, l));
          return b;
        }),
        l.convId ? h("a", { class: "btn texte petit trancher-voir", href: `#/remy/${seg(l.convId)}`, onclick: () => ouverte?.f.fermer() }, "Voir") : null));
  }
  const groupe = (titre, total, lignes, pied) => h("section", { class: "trancher-groupe", "aria-label": titre },
    h("h3", { class: "titre-section" }, titre, h("span", { class: "compte" }, `(${total})`)),
    h("ul", { class: "liste trancher-lignes" }, lignes.map(ligneTri)),
    pied ? h("p", { class: "aide trancher-pied" }, pied) : null);

  /** Le contenu groupé, partagé par la feuille et les étapes de la revue (ListeTri). */
  function listeTri({ seulement = null, sauf = [], videTexte = "Rien à trancher : tout est rangé.", avecRetards = false } = {}) {
    const gs = groupes().filter((g) => (!seulement || seulement.includes(g.id)) && !sauf.includes(g.id));
    const rs = avecRetards ? retards() : [];
    const out = [];
    if (rs.length) out.push(groupe("En retard", rs.length, rs));
    if (!gs.length && !rs.length) {
      const err = erreurMontree(lu.erreur);
      if (!lu.vue && (lu.chargement || !err)) out.push(enAttente("Rémy rassemble ce qui attend…"));
      else if (!lu.vue && err) out.push(blocErreur(err, () => maj({ frais: true })));
      else out.push(vide(null, videTexte));
    }
    for (const g of gs) out.push(groupe(g.titre, g.total, g.lignes, g.total > g.lignes.length ? R.phrasePlusDe(g.total - g.lignes.length) : null));
    const r = lu.vue?.reportes || 0;
    if (r > 0 && !seulement) out.push(h("p", { class: "aide trancher-reportes" }, R.phraseReportes(r)));
    return out;
  }

  // --- Les feuilles ---
  /** Une feuille qui se redessine à chaque changement, en gardant le focus à sa place. */
  function ouvrirFeuille(quoi, { titre, sousTitre, rendu, pied, avantFermeture }) {
    if (ouverte) {
      if (ouverte.quoi === quoi) return ouverte;
      ouverte.f.fermer();
    }
    const retour = document.activeElement;
    const corps = h("div", { class: "trancher-feuille", tabindex: "-1", autofocus: true });
    const f = feuille({
      titre, sousTitre, large: true, classe: "trancher-dialog", contenu: corps, pied, avantFermeture,
      surFermeture: () => {
        feuillesOuvertes.delete(f);
        if (ouverte?.f === f) ouverte = null;
        // Le focus revient d'où on venait ; redessiné entre-temps, sur la carte.
        if (document.activeElement === document.body || !document.activeElement) (retour?.isConnected ? retour : carte.querySelector("button"))?.focus();
      },
    });
    const o = {
      quoi, f, corps,
      dessiner() {
        const actif = document.activeElement;
        const li = actif?.closest?.("li.trancher-ligne");
        const lignesAvant = [...corps.querySelectorAll("li.trancher-ligne")];
        const rang = li && corps.contains(li) ? lignesAvant.indexOf(li) : -1;
        const geste = li ? actif.dataset.geste : null;
        const cleLigne = li?.dataset.cle;
        const defile = f.corps.scrollTop;
        vider(corps, rendu());
        f.corps.scrollTop = defile;
        if (rang < 0) return;
        // La même ligne si elle est encore là ; sinon celle qui a pris sa place.
        const lignes = [...corps.querySelectorAll("li.trancher-ligne")];
        const cible = lignes.find((x) => x.dataset.cle === cleLigne) || lignes[Math.min(rang, lignes.length - 1)];
        const b = cible && ([...cible.querySelectorAll("button:not(:disabled)")].find((x) => x.dataset.geste === geste) || cible.querySelector("button:not(:disabled)"));
        (b || corps).focus({ preventScroll: false });
      },
    };
    feuillesOuvertes.add(f);
    ouverte = o;
    o.dessiner();
    corps.focus();
    return o;
  }

  function ouvrirTrancher() {
    ouvrirFeuille("trancher", { titre: "À trancher", sousTitre: "Un geste par ligne. Plus tard : elle revient dans une semaine.", rendu: () => listeTri() });
    maj();
  }

  function ouvrirRetards() {
    let o = null;
    const fermer = bouton("Plus tard", { classe: "papier", onclick: () => o?.f.fermer() });
    o = ouvrirFeuille("retards", {
      titre: "On trie tes retards ?",
      pied: [fermer],
      rendu: () => {
        const rs = retards();
        const lib = fermer.querySelector(".lib");
        if (lib) lib.textContent = rs.length ? "Plus tard" : "Fermer";
        const err = erreurMontree(lu.erreur);
        return [
          h("p", { class: "aide-carte trancher-intro" }, "Tu as été absent quelques jours. Ligne par ligne : c'est fait, ça passe à demain, ou tu abandonnes. Tout s'annule."),
          rs.length ? groupe("En retard", rs.length, rs)
            : lu.chargement ? enAttente("Lecture des retards…")
              : !lu.vue && err ? blocErreur(err, () => maj({ frais: true }))
                : vide(null, "Plus rien en retard. Bon retour !"),
        ];
      },
    });
    maj();
  }

  // --- La revue du dimanche, guidée (RevueDimanche) ---
  async function chargerRevue() {
    if (revue.chargement) return;
    revue.chargement = true;
    ouverte?.dessiner();
    try {
      revue.donnees = await api("/api/revue", { delai: 30000 });
      revue.erreur = null;
    } catch (err) {
      revue.erreur = err;
    } finally {
      revue.chargement = false;
    }
    ouverte?.dessiner();
  }

  function ouvrirRevue() {
    let o = null;
    let etape = 0;
    let decisionsLues = false;
    let enregistrement = false;
    const champs = [0, 1, 2].map((i) => h("input", { class: "champ", type: "text", placeholder: `Décision ${i + 1}`, "aria-label": `Décision ${i + 1}`, maxlength: "200", autocomplete: "off" }));
    const valeurs = () => champs.map((c) => c.value);
    const remplir = () => {
      const liste = revue.donnees?.decisions?.liste;
      if (decisionsLues || !Array.isArray(liste)) return;
      liste.slice(0, 3).forEach((x, i) => { if (!champs[i].value) champs[i].value = x; });
      decisionsLues = true;
    };
    const enregistrer = async () => {
      if (enregistrement) return;
      const propres = R.decisionsPropres(valeurs());
      enregistrement = true;
      o.dessiner();
      try {
        const d = await remplacer("/api/revue/decisions", { decisions: propres });
        if (revue.donnees) revue.donnees.decisions = d && Array.isArray(d.liste) ? d : { ...(revue.donnees.decisions || {}), liste: propres };
        dire(R.phraseDecisions(propres.length), { genre: "succes" });
      } catch (err) {
        direErreur(err, enregistrer, "Décisions pas enregistrées");
      } finally {
        enregistrement = false;
        if (ouverte === o) o.dessiner();
      }
    };
    /** Les décisions tapées partent en quittant l'étape : « Suivant » ne doit rien perdre. */
    const garderSiChange = () => {
      if (etape !== 3 || enregistrement) return;
      const propres = R.decisionsPropres(valeurs());
      if (JSON.stringify(propres) === JSON.stringify(revue.donnees?.decisions?.liste || [])) return;
      enregistrer();
    };
    const precedent = bouton("Précédent", { classe: "papier", onclick: () => aller(etape - 1) });
    const suivant = bouton("Suivant", { classe: "plein", onclick: () => (etape === R.TITRES_REVUE.length - 1 ? finir() : aller(etape + 1)) });
    const plusTard = bouton("Plus tard", { classe: "texte", onclick: () => {
      garderSiChange();
      o.f.fermer();
    } });
    const aller = (k) => {
      garderSiChange();
      etape = Math.max(0, Math.min(R.TITRES_REVUE.length - 1, k));
      o.dessiner();
      o.corps.querySelector(".trancher-etape-titre")?.focus();
    };
    const finir = () => {
      local.ecrire(CLE_REVUE_FAITE, Date.now());
      o.f.fermer();
      dire("Revue faite. Bonne semaine !", { genre: "succes" });
      dessinerCarte();
    };
    const semaine = () => {
      const r = revue.donnees;
      if (!r) {
        const err = erreurMontree(revue.erreur);
        return err && !revue.chargement ? blocErreur(err, chargerRevue) : squelette([0.8, 0.6, 0.9, 0.5]);
      }
      const domaines = r.domaines || [];
      const glissees = r.glissees || [];
      return [
        h("p", { class: "trancher-resume" }, R.resumeSemaine(r)),
        domaines.length
          ? h("ul", { class: "liste trancher-domaines" }, domaines.map((d) => h("li", { class: "ligne" },
            h("span", { class: "trancher-point", style: { background: couleurProjet(d.nom) } }),
            h("span", { class: "corps titre-ligne" }, d.nom),
            h("span", { class: "trancher-chiffres" }, h("span", null, R.ligneDomaine(d)), d.minutes > 0 ? h("span", { class: "mono" }, R.dureeCourte(d.minutes)) : null))))
          : vide(null, "Rien de coché par Rémy ces 7 derniers jours. Une semaine calme, ou cochée ailleurs que dans l'app."),
        glissees.length ? [
          h("h3", { class: "titre-section trancher-sous" }, "Ce qui a glissé", h("span", { class: "compte" }, `(${glissees.length})`)),
          h("ul", { class: "trancher-glissees" }, glissees.slice(0, 8).map((x) => h("li", null, R.ligneGlissee(x)))),
          h("p", { class: "aide" }, "Tu peux les régler à l'étape « À trancher » : Fait, Demain ou Abandonner."),
        ] : null,
      ];
    };
    const decisions = () => [
      h("p", { class: "aide-carte" }, "Trois choses qui comptent pour la semaine qui vient. Rémy les garde sur ta tour ; tu peux en laisser vides."),
      h("div", { class: "trancher-decisions" }, champs.map((c, i) => h("label", { class: "trancher-decision" }, h("span", { class: "mono" }, String(i + 1)), c))),
      (() => {
        const b = bouton(enregistrement ? "Enregistrement…" : "Garder ces décisions", { classe: "papier", icone: "coche", onclick: enregistrer });
        b.disabled = enregistrement;
        return h("div", { class: "rangee", style: { marginTop: "12px" } }, b);
      })(),
    ];
    const appris = () => {
      const l = revue.donnees?.appris || [];
      if (!revue.donnees && revue.chargement) return squelette([0.8, 0.6]);
      if (!l.length) return vide(null, "La nuit n'a rien noté de neuf sur toi cette semaine. Plus tu parles à Rémy, plus il a de matière.");
      return [h("p", { class: "aide-carte" }, "Relevé par la réflexion de nuit — des hypothèses, pas des faits :"), l.map((x) => h("div", { class: "carte plate trancher-appris" }, x))];
    };
    o = ouvrirFeuille("revue", {
      titre: R.TITRES_REVUE[0],
      pied: [plusTard, h("span", { class: "trancher-espace" }), precedent, suivant],
      // Échap, un clic à côté ou « Plus tard » : les décisions tapées ne se perdent pas.
      avantFermeture: () => {
        garderSiChange();
        return true;
      },
      rendu: () => {
        remplir();
        const titre = R.TITRES_REVUE[etape];
        const h2 = o?.f.el.querySelector(".feuille-tete h2");
        if (h2) h2.textContent = titre;
        o?.f.el.setAttribute("aria-label", titre);
        precedent.hidden = etape === 0;
        const lib = suivant.querySelector(".lib");
        if (lib) lib.textContent = etape === R.TITRES_REVUE.length - 1 ? "Terminer la revue" : "Suivant";
        const contenu = [semaine, () => listeTri({ seulement: ["idees"], videTexte: "Aucune idée en attente : rien à trier cette semaine." }), () => listeTri({ sauf: ["idees"], avecRetards: true }), decisions, appris][etape]();
        return [
          h("div", { class: "trancher-barre", role: "img", "aria-label": `Étape ${etape + 1} sur ${R.TITRES_REVUE.length}` },
            R.TITRES_REVUE.map((_, i) => h("span", { class: i <= etape ? "fait" : "" }))),
          h("p", { class: "trancher-etape-titre", tabindex: "-1" }, `Étape ${etape + 1} sur ${R.TITRES_REVUE.length}`),
          contenu,
        ];
      },
    });
    // Une hauteur fixe : la feuille ne saute pas d'une étape à l'autre.
    o.f.el.classList.add("trancher-revue");
    o.dessiner();
    chargerRevue();
    maj();
  }

  // --- Les gestes (ATrancherModel.agir) ---
  const masquer = (l) => masquees.add(l.cle);
  const montrer = (l) => {
    masquees.delete(l.cle);
    dessiner();
  };

  async function agir(g, l) {
    if (enCours.has(l.cle)) return;
    enCours.add(l.cle);
    dessiner();
    try {
      await faire(g, l);
    } catch (err) {
      direErreur(err, () => agir(g, l), "Pas fait");
    } finally {
      enCours.delete(l.cle);
      dessiner();
    }
  }

  /** Défait une écriture de la chaîne (journal). `ligne` : à remontrer. */
  async function defaire(ledgerId, source, ligne) {
    try {
      const r = await ecrire(source === "agenda" ? "/api/google/undo" : "/api/motion/undo", { id: ledgerId }, { delai: 150000 });
      if (r?.ok === false) dire("Annulation incomplète : vérifie ton planning.", { genre: "erreur" });
      else {
        dire("Annulé : tout est revenu comme avant.", { genre: "succes" });
        if (ligne) montrer(ligne);
      }
      apres();
    } catch (err) {
      direErreur(err, () => defaire(ledgerId, source, ligne), "Pas annulé");
    }
  }

  async function remettreRappels(liste, l, message) {
    try {
      await poserRappels(liste);
      const ids = new Set(liste.map((r) => r.id));
      lu.rappels = [...(lu.rappels || []).filter((r) => !ids.has(r.id)), ...liste];
      montrer(l);
      dire(message, { genre: "succes" });
    } catch (err) {
      direErreur(err, () => remettreRappels(liste, l, message), "Pas remis");
    }
  }
  const rappelDe = (l) => lu.rappels?.find((r) => r.id === l.rappelId) || { id: l.rappelId, texte: l.texte, quand: l.depuis ?? null, fait: false, etiquettes: [] };

  async function supprimerRappel(l) {
    const r = rappelDe(l);
    await api(`/api/rappels/${seg(r.id)}`, { methode: "DELETE" });
    lu.rappels = (lu.rappels || []).filter((x) => x.id !== r.id);
    masquer(l);
    dire("Rappel supprimé.", { genre: "succes", action: { libelle: "Annuler", faire: () => remettreRappels([r], l, "Rappel remis.") } });
  }

  /** Change un rappel (fait, demain) ; « Annuler » le remet tel qu'avant. */
  async function changerRappel(l, changement, message) {
    const avant = rappelDe(l);
    const apresChangement = { ...avant, ...changement };
    await poserRappels([apresChangement]);
    lu.rappels = (lu.rappels || []).map((x) => (x.id === avant.id ? apresChangement : x));
    masquer(l);
    dire(message, { genre: "succes", action: { libelle: "Annuler", faire: () => remettreRappels([avant], l, "Remis comme avant.") } });
  }

  async function faire(g, l) {
    if (g === "plusTard") {
      await ecrire("/api/a-trancher/reports", { cle: l.cle, jours: 7 });
      masquer(l);
      dire("Revient dans une semaine.", { action: { libelle: "Annuler", faire: async () => {
        try {
          await api(`/api/a-trancher/reports/${seg(l.cle)}`, { methode: "DELETE" });
          montrer(l);
        } catch (err) {
          direErreur(err, null, "Le report n'a pas été annulé");
        }
      } } });
    } else if (g === "oui" && l.type === "carte") {
      const base = `/api/conversations/${seg(l.convId)}/propositions/${seg(l.propositionId)}`;
      if (l.source === "regle") {
        const r = await ecrire(`${base}/regle`, {});
        masquer(l);
        const ids = (r?.regles || []).filter((x) => x && typeof x === "object" && !x.deja).map((x) => x.id);
        dire("Règle créée.", { genre: "succes", action: ids.length ? { libelle: "Annuler", faire: async () => {
          try {
            for (const id of ids) await api(`/api/regles/${seg(id)}`, { methode: "DELETE" });
            dire("Règle retirée.");
          } catch (err) {
            direErreur(err, null, "Règle pas retirée");
          }
        } } : null });
      } else if (l.source === "carnet") {
        await ecrire(`${base}/carnet`, {});
        masquer(l);
        dire("C'est fait.", { genre: "succes" });
      } else {
        const chemin = l.source === "agenda" ? "/api/google/apply" : "/api/motion/apply";
        const r = await ecrire(chemin, { actions: [], convId: l.convId, propositionId: l.propositionId }, { delai: 150000 });
        const rates = (r?.results || []).filter((x) => x?.ok === false);
        if (r?.etat === "echouee") throw new Error(`${rates[0]?.erreur || "raison inconnue"}.`);
        masquer(l);
        dire(rates.length ? `Fait en partie : ${rates.length} changement${rates.length > 1 ? "s" : ""} refusé${rates.length > 1 ? "s" : ""}.` : "C'est fait.", {
          genre: rates.length ? "erreur" : "succes",
          action: r?.ledgerId ? { libelle: "Annuler", faire: () => defaire(r.ledgerId, l.source, null) } : null,
        });
        apres();
      }
    } else if (g === "non") {
      await ecrire(`/api/conversations/${seg(l.convId)}/propositions/${seg(l.propositionId)}/refus`, {});
      masquer(l);
      dire("Écartée : rien n'a été changé.", { action: { libelle: "Annuler", faire: async () => {
        try {
          await ecrire("/api/a-trancher/rouvrir", { propositionId: l.propositionId });
          montrer(l);
        } catch (err) {
          direErreur(err, null, "La carte n'a pas été rouverte");
        }
      } } });
    } else if (g === "fusionner") {
      if (!lu.rappels) throw new Error("Le carnet n'est pas encore lu : réessaie dans un instant.");
      const ids = new Set(l.doublons || []);
      const retires = lu.rappels.filter((r) => ids.has(r.id));
      if (!retires.length) {
        masquer(l);
        dire("Déjà fusionnés.");
        return;
      }
      for (const r of retires) await api(`/api/rappels/${seg(r.id)}`, { methode: "DELETE" });
      lu.rappels = lu.rappels.filter((r) => !ids.has(r.id));
      masquer(l);
      dire(`Fusionnés : « ${l.texte} » ne reste qu'une fois.`, { genre: "succes", action: { libelle: "Annuler", faire: () => remettreRappels(retires, l, "Doublons remis.") } });
    } else if ((g === "supprimer" && l.type === "rappel") || (g === "abandonner" && l.type === "rappel-retard")) {
      await supprimerRappel(l);
    } else if (g === "retirer") {
      const listes = (await api("/api/listes"))?.listes || [];
      const liste = listes.find((x) => x.id === l.listeId);
      if (!liste) {
        masquer(l);
        dire("Cette liste n'existe plus.");
        return;
      }
      const pris = (liste.elements || []).filter((e) => e.fait);
      if (pris.length) await ecrire(`/api/listes/${seg(l.listeId)}/retirer`, { ids: pris.map((e) => e.id) });
      masquer(l);
      const n = pris.length;
      dire(n ? `${n} article${n > 1 ? "s" : ""} retiré${n > 1 ? "s" : ""}.` : "Déjà retirés.", { genre: "succes", action: n ? { libelle: "Annuler", faire: async () => {
        try {
          await ecrire(`/api/listes/${seg(l.listeId)}/elements`, { elements: pris.map((e) => ({ id: e.id, texte: e.texte, fait: true, ordre: e.ordre })) });
          montrer(l);
          dire("Articles remis.", { genre: "succes" });
        } catch (err) {
          direErreur(err, null, "Articles pas remis");
        }
      } } : null });
    } else if (g === "garder" || (g === "supprimer" && l.type === "idee")) {
      if (g === "garder") await ecrire(`/api/dossiers/${seg(l.dossierId)}/notes`, { notes: [{ id: l.noteId, texte: l.texte, fait: true }] });
      else await api(`/api/dossiers/${seg(l.dossierId)}/notes/${seg(l.noteId)}`, { methode: "DELETE" });
      masquer(l);
      dire(g === "garder" ? "Gardée dans « Idées », marquée relue." : "Idée supprimée.", {
        genre: "succes",
        action: { libelle: "Annuler", faire: async () => {
          try {
            await ecrire(`/api/dossiers/${seg(l.dossierId)}/notes`, { notes: [{ id: l.noteId, texte: l.texte, fait: false }] });
            montrer(l);
          } catch (err) {
            direErreur(err, null, "L'idée n'est pas revenue");
          }
        } },
      });
    } else if (g === "supprimer" && l.type === "fil") {
      // Il ne part qu'après le délai : « Annuler » pendant ce temps, et rien n'est effacé.
      masquer(l);
      enSuppression.add(l.cle);
      let renonce = false;
      dire("Fil supprimé.", { duree: DELAI_FIL, action: { libelle: "Annuler", faire: () => {
        renonce = true;
        enSuppression.delete(l.cle);
        montrer(l);
      } } });
      setTimeout(async () => {
        if (renonce) return;
        try {
          await api(`/api/conversations/${seg(l.convId)}`, { methode: "DELETE" });
        } catch (err) {
          masquees.delete(l.cle);
          dessiner();
          direErreur(err, null, "Le fil n'a pas été supprimé");
        } finally {
          enSuppression.delete(l.cle);
        }
      }, DELAI_FIL);
    } else if (g === "fait" && l.type === "retard" && l.tacheId) {
      masquer(l);
      terminer({ type: "tache", id: l.tacheId, titre: l.texte }, { retirer: () => {}, remettre: () => montrer(l), apres });
    } else if (g === "demain" && l.type === "retard" && l.tacheId) {
      if (await decaler({ type: "tache", id: l.tacheId, titre: l.texte }, echeanceDans(1), { apres })) masquer(l);
    } else if (g === "abandonner" && l.type === "retard" && l.tacheId) {
      const r = await ecrire("/api/motion/apply", { actions: [{ type: "terminer", nom: l.texte, id: l.tacheId }], resume: "Abandonnée (tri des retards)", idCommande: nouvelId() }, { delai: 150000 });
      if ((r?.echecs ?? 0) > 0 || r?.results?.[0]?.ok === false) {
        dire(`Motion n'a pas pu retirer « ${l.texte} » : ${r?.results?.[0]?.erreur || "raison inconnue"}.`, { genre: "erreur", action: { libelle: "Réessayer", faire: () => agir(g, l) } });
        return;
      }
      masquer(l);
      dire(`« ${l.texte} » abandonnée : retirée de ton planning.`, { genre: "succes", action: r?.ledgerId ? { libelle: "Annuler", faire: () => defaire(r.ledgerId, "motion", l) } : null });
      apres();
    } else if (g === "fait" && l.type === "rappel-retard") {
      await changerRappel(l, { fait: true }, `« ${l.texte} » : fait.`);
    } else if (g === "demain" && l.type === "rappel-retard") {
      const quand = R.demainMemeHeure(rappelDe(l).quand);
      await changerRappel(l, { quand }, `« ${l.texte} » : demain, ${R.heure(quand)}.`);
    }
  }

  function ouvrir(quoi = "trancher") {
    if (!sait("a-trancher-v1")) {
      dire("Ta tour ne sait pas encore rassembler ce qui attend : relance son installeur pour la mettre à jour.");
      return;
    }
    if (quoi === "revue") return ouvrirRevue();
    if (quoi === "retards") return ouvrirRetards();
    ouvrirTrancher();
  }

  return { carte, maj, ouvrir };
}
