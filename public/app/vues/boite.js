// La boîte et le rendez-vous du jour, pour Aujourd'hui (contrat A) :
// - le bouton « boîte » de l'en-tête et sa pastille (les sujets de la nuit
//   encore ouverts) ;
// - la feuille « Ton briefing » (BriefingVue de l'iPhone : les trois lignes
//   calculées par la tour, la ligne des conversations d'hier, les menacées,
//   le conseil, les sujets de la nuit, « Organiser ma journée »), ou « À voir
//   avec Rémy » (BoiteView) sur une tour sans rituel-v1 ;
// - la carte du rituel : le briefing du matin en court, le bilan du soir dès
//   18 h (BilanVue), et une fois « Ton briefing chaque matin ? »
//   (PropositionRituel) dans l'app Windows ;
// - « Cette nuit, je creuse aussi ? », ouverte par une notification.
// Lit /api/rituel au plus une fois par minute (sauf Rafraîchir), jamais
// /api/dashboard : aujourdhui.js le lui passe. Aucun appel IA ici : « En
// parler à Rémy » prépare la question sans l'envoyer ; « Organiser ma
// journée » l'envoie, le clic étant le geste (contrat C).
import { api, ecrire, remplacer, nouvelId, sait, evenements } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, texteErreur, squelette, blocErreur, vide, occupe, local, feuille, isoLocal, markdown } from "../ui.js";
import * as R from "../analyse/rituel.js";
import { nomSource } from "../analyse/conversations.js";
import { decaler } from "./gerer.js";
import * as bureau from "../bureau.js";

const MINUTE = 60e3;
/** Une relecture du tableau demandée par la boîte : au-delà (45 s d'attente de la tour), on dit qu'il n'est pas venu. */
const ATTENTE_TABLEAU = 50e3;

// Ce qui survit à un nouveau montage d'Aujourd'hui (même page) : la dernière
// lecture du rituel, les gestes sur les sujets, l'état du bilan du jour.
const lu = { rituel: null, luA: null, essaiA: -Infinity, erreur: null, chargement: false, lecture: null };
const surcharges = new Map(); // id du sujet → { etat, a } (a : quand la tour l'a pris), jusqu'au tableau qui le relit
const enVol = new Set(); // sujets dont l'écriture est en route
// `range` : le bilan rangé, gardé ici aussi (le stockage local peut refuser l'écriture).
const bilan = { jour: null, poussees: new Set(), pousse: false, envoi: false, brouillon: "", range: null };

// Session perdue : l'écran de connexion prend la place ; une feuille restée
// ouverte le masquerait (main.js ne connaît pas les feuilles des modules).
const feuillesOuvertes = new Set();
evenements.addEventListener("session-perdue", () => {
  for (const f of [...feuillesOuvertes]) f.fermer();
});

const CLE_BILAN = "remy-bilan";
const CLE_PROPOSITION = "remy-proposition-rituel";

function lireRituelTour() {
  if (lu.lecture) return lu.lecture;
  lu.essaiA = Date.now();
  lu.chargement = true;
  lu.lecture = (async () => {
    try {
      lu.rituel = await api("/api/rituel", { delai: 45000 });
      lu.luA = Date.now();
      lu.erreur = null;
    } catch (err) {
      lu.erreur = err;
    } finally {
      lu.chargement = false;
      lu.lecture = null;
    }
  })();
  return lu.lecture;
}

const etatsVus = () => new Map([...surcharges].map(([id, s]) => [id, s.etat]));
const erreurMontree = (err) => (err && err.nature !== "auth" ? err : null);
const avecCle = (el, cle) => {
  el.dataset.cle = cle;
  return el;
};
const intertitre = (texte) => h("h3", { class: "boite-intertitre" }, texte);

/**
 * Le bouton, la carte et les feuilles de la boîte. `relire()` : relecture
 * discrète du tableau par Aujourd'hui (après une écriture dans Motion).
 */
export function creerBoite(ctx, { relire } = {}) {
  let dashboard = null;
  let erreurTableau = null;
  let conseil;
  let ouverte = null; // { f, corps }
  let focusApres = null;
  let bilanDemande = false;
  let replieOuvert = false;
  let bougeA = null; // dernier geste qui a fait bouger les sujets (double clic)
  let lectureTableau = null; // relecture du tableau demandée à l'ouverture de la feuille
  let tableauIllisible = false;

  const ic = h("span", { class: "boite-ic" }, icone("plateau"));
  const pastille = h("span", { class: "pastille-compte boite-pastille", "aria-hidden": "true", hidden: true }, "0");
  const btn = h("button", { type: "button", class: "btn papier icone boite-bouton", onclick: () => ouvrir("boite") }, ic, pastille);
  const carte = h("div", { class: "boite-carte" });
  // Le champ du soir est créé une fois : son texte ne disparaît à aucun dessin.
  const champ = h("textarea", { class: "champ", rows: 2, placeholder: "Une ligne pour Rémy (facultatif)", "aria-label": "Comment ça s'est passé ?", id: `boite-bilan-${Math.random().toString(36).slice(2, 8)}` });
  champ.value = bilan.brouillon;
  champ.addEventListener("input", () => (bilan.brouillon = champ.value));

  async function lireRituel({ frais = false } = {}) {
    if (!sait("rituel-v1")) return;
    if (!lu.lecture && !frais && Date.now() - lu.essaiA < MINUTE) return;
    const p = lireRituelTour();
    dessiner();
    await p;
    dessiner();
  }

  function dessiner() {
    majBouton();
    dessinerCarte();
    dessinerFeuille();
  }

  // --- Le bouton de l'en-tête ---
  function majBouton() {
    const n = R.compteOuverts(R.sujets(dashboard?.briefing, etatsVus()));
    pastille.textContent = String(n);
    pastille.hidden = n === 0;
    vider(ic, icone(n ? "plateauPlein" : "plateau"));
    const lib = R.libelleBoite(n, sait("rituel-v1"));
    btn.setAttribute("aria-label", lib);
    btn.title = lib;
  }

  // --- Vers Rémy ---
  function preparer(texte) {
    if (!local.ecrire("remy-question", { texte, a: Date.now() })) {
      dire("Ce navigateur refuse de garder la question pour Rémy (stockage bloqué) : écris-la-lui toi-même.", { genre: "erreur" });
      return;
    }
    ouverte?.f.fermer();
    ctx.aller("remy/nouvelle");
  }
  function organiser(b) {
    if (!local.ecrire("remy-envoi", { texte: R.ORGANISER, a: Date.now(), titre: R.titreJournee(new Date()) })) {
      dire("Ce navigateur refuse de garder la demande pour Rémy (stockage bloqué) : écris-lui « Organise ma journée ».", { genre: "erreur" });
      return;
    }
    if (b) {
      b.disabled = true;
      const lib = b.querySelector(".lib");
      if (lib) lib.textContent = "Ouverture…";
    }
    setTimeout(() => {
      ouverte?.f.fermer();
      ctx.aller("remy/nouvelle");
    }, 120);
  }
  const boutonOrganiser = (classe = "plein") => {
    const b = avecCle(bouton("Organiser ma journée avec Rémy", { classe, icone: "baguette" }), "organiser");
    b.addEventListener("click", () => organiser(b));
    return b;
  };

  // --- Les sujets de la nuit ---
  async function changer(s, etat) {
    if (enVol.has(s.id)) return;
    const avant = etatsVus().get(s.id) ?? s.etat;
    if (avant === etat) return;
    surcharges.set(s.id, { etat, a: null });
    enVol.add(s.id);
    focusApres = etat === "ouvert" ? `parler:${s.id}` : `rouvrir:${s.id}`;
    dessiner();
    bougeA = Date.now();
    try {
      await remplacer("/api/briefing/etat", { id: s.id, etat });
      enVol.delete(s.id);
      // Montré tel quel jusqu'au premier tableau lu après ce moment.
      surcharges.set(s.id, { etat, a: Date.now() });
      focusApres = etat === "ouvert" ? `parler:${s.id}` : `rouvrir:${s.id}`;
      const phrase = R.phraseEtatSujet(etat);
      if (phrase) dire(phrase, { genre: "succes", action: { libelle: "Annuler", faire: () => changer(s, avant) } });
    } catch (err) {
      enVol.delete(s.id);
      surcharges.set(s.id, { etat: avant, a: Date.now() });
      focusApres = avant === "ouvert" ? `parler:${s.id}` : `rouvrir:${s.id}`;
      direErreur(err, () => changer(s, etat), "Pas enregistré");
    }
    dessiner();
    bougeA = Date.now();
  }

  function carteSujet(s, generatedAt) {
    const ouvert = s.etat === "ouvert";
    const attend = enVol.has(s.id);
    const geste = (libelle, cle, etat, classe = "papier") => {
      const b = avecCle(bouton(libelle, { classe, onclick: () => changer(s, etat) }), cle);
      // En route : occupé mais focalisable (le focus reste où il était ; un clic de plus ne part pas).
      if (attend) {
        b.setAttribute("aria-disabled", "true");
        b.setAttribute("aria-busy", "true");
      }
      return b;
    };
    return h("article", { class: `boite-sujet etat-${s.etat}`, dataset: { id: s.id } },
      h("p", { class: "boite-sujet-texte" }, s.texte),
      ouvert
        ? [
          avecCle(bouton("En parler à Rémy", { classe: "plein boite-parler", icone: "remy", onclick: () => preparer(R.phraseSujet(s.texte, generatedAt)) }), `parler:${s.id}`),
          h("div", { class: "boite-gestes" }, geste("C'est fait", `fait:${s.id}`, "traite"), geste("Laisser tomber", `ignore:${s.id}`, "ignore")),
        ]
        : h("div", { class: "boite-regle" }, h("span", null, s.etat === "traite" ? "Fait" : "Laissé de côté"), geste("Rouvrir", `rouvrir:${s.id}`, "ouvert", "texte")));
  }

  /** Feuille ouverte sans tableau : Aujourd'hui le relit ; s'il ne vient pas, on le dit (jamais un squelette sans fin). */
  function attendreTableau() {
    if (dashboard || lectureTableau) return lectureTableau;
    tableauIllisible = false;
    lectureTableau = (async () => {
      try {
        await Promise.race([Promise.resolve(relire?.()), new Promise((ok) => setTimeout(ok, ATTENTE_TABLEAU))]);
      } catch {}
      lectureTableau = null;
      tableauIllisible = !dashboard;
      dessiner();
    })();
    dessiner();
    return lectureTableau;
  }

  /** L'intro, puis les sujets ; sinon le texte du briefing ; sinon pourquoi il n'y a rien. */
  function blocSujets() {
    const b = dashboard?.briefing;
    if (!dashboard) {
      const err = erreurMontree(erreurTableau);
      const reessayer = () => (err ? relire?.() : attendreTableau());
      return h("div", { class: "carte plate boite-rien" },
        err ? blocErreur(err, reessayer)
          : tableauIllisible && !lectureTableau
            ? vide("Pas pu charger", "Le tableau n'a pas pu être lu : réessaie quand ta tour répond.", avecCle(bouton("Réessayer", { classe: "papier", icone: "rafraichir", onclick: (e) => occupe(e.currentTarget, reessayer) }), "reessayer-tableau"))
            : squelette([0.8, 0.55]));
    }
    // Dans l'ordre de la tour : un sujet réglé reste à sa place, le suivant ne glisse pas sous le pointeur.
    const liste = R.sujets(b, etatsVus());
    return [
      h("p", { class: "boite-intro" }, R.introBoite(b)),
      liste.length
        ? h("div", { class: "boite-sujets" }, liste.map((s) => carteSujet(s, b?.generatedAt)))
        : b?.text
          ? h("div", { class: "carte plate boite-texte md", html: markdown(b.text) })
          : h("div", { class: "carte plate boite-rien" }, h("p", null, R.rienBoite(b, dashboard?.systeme?.reflexion))),
    ];
  }

  // --- Les trois lignes du matin ---
  function provenance() {
    const err = erreurMontree(lu.erreur);
    const reessayer = err && !lu.chargement ? avecCle(bouton("Réessayer", { classe: "texte petit", icone: "rafraichir", onclick: (e) => occupe(e.currentTarget, () => lireRituel({ frais: true })) }), "reessayer-rituel") : null;
    return h("div", { class: "boite-provenance" },
      lu.chargement ? h("span", { class: "boite-spinner", "aria-hidden": "true" }) : null,
      h("span", null, R.provenance({ luA: lu.luA, chargement: lu.chargement, erreur: err ? texteErreur(err) : null })),
      reessayer);
  }
  function lignes(b, { court = false } = {}) {
    const menace = R.estMenace(b);
    const ligne = (texte, ic, classe) => (texte ? h("p", { class: `boite-ligne ${classe}` }, icone(ic), h("span", null, texte)) : null);
    return [
      ligne(b.compte, "cible", "fort"),
      ligne(b.pourquoi, "question", "normale"),
      ligne(b.menace, menace ? "alerte" : "bouclier", menace ? "danger" : "calme"),
      !court && b.resume ? h("p", { class: "boite-resume mono" }, b.resume) : null,
      b.avertissement ? h("p", { class: "boite-avertissement" }, icone("alerte"), h("span", null, b.avertissement)) : null,
    ];
  }
  /** Sans briefing pour ce jour : squelette, erreur + Réessayer, ou « pas encore prêt ». */
  function sansBriefing(texte = "Le briefing de ce jour n'est pas encore prêt.") {
    const err = erreurMontree(lu.erreur);
    if (lu.chargement || (!lu.rituel && !err)) return squelette([0.55, 0.95, 0.85, 0.9]);
    if (err && !lu.rituel) return blocErreur(err, () => lireRituel({ frais: true }));
    return vide(null, texte, avecCle(bouton("Réessayer", { classe: "papier", icone: "rafraichir", onclick: (e) => occupe(e.currentTarget, () => lireRituel({ frais: true })) }), "reessayer-rituel"));
  }
  function troisLignes() {
    if (!sait("rituel-v1")) {
      return h("section", { class: "carte plate boite-trois" }, h("p", { class: "aide-carte" }, "Ta tour ne sait pas encore préparer le briefing : relance son installeur pour la mettre à jour."));
    }
    const b = R.briefingDuJour(lu.rituel, { luA: lu.luA });
    if (!b) return h("section", { class: "carte plate boite-trois" }, sansBriefing());
    return h("section", { class: "carte plate boite-trois", "aria-label": "Ce qui compte, pourquoi, ce qui est menacé" },
      h("h3", { class: "boite-jour" }, R.jourTitre(b)), lignes(b), provenance());
  }
  function ligneConversations(c) {
    return h("section", { class: "carte plate boite-conversations", "aria-label": "Hier, dans tes conversations" },
      h("div", { class: "etat-mono boite-conv-titre" }, icone("conversations"), "Hier, dans tes conversations"),
      h("p", { class: "boite-conv-ligne" }, c.ligne),
      c.sources?.length ? h("p", { class: "mono boite-conv-sources" }, c.sources.map(nomSource).join(" · ")) : null,
      sait("conversations-externes-v1") ? avecCle(h("a", { class: "btn texte petit boite-lien", href: "#/conversations", onclick: () => ouverte?.f.fermer() }, "Voir les conversations"), "conversations") : null);
  }

  // --- Les menacées (CarteMenacee) ---
  function carteMenacee(m) {
    const a = m.action;
    let repousser = null;
    if (a?.type === "repousser" && a.echeance) {
      repousser = avecCle(bouton(a.libelle || "Repousser l'échéance", { classe: "papier", icone: "horloge" }), `repousser:${m.id}`);
      repousser.addEventListener("click", () => occupe(repousser, async () => {
        const lib = repousser.querySelector(".lib");
        if (lib) lib.textContent = "Envoi à Motion…";
        await decaler({ type: "tache", id: m.id, titre: m.titre }, new Date(a.echeance), { apres: () => { relire?.(); lireRituel({ frais: true }); } });
        if (lib) lib.textContent = a.libelle || "Repousser l'échéance";
      }));
    }
    const parler = avecCle(bouton(a?.type === "caser" && a.libelle ? a.libelle : "En parler à Rémy", { classe: "papier", icone: "remy", onclick: () => preparer(R.phraseMenacee(m)) }), `menacee:${m.id}`);
    return h("article", { class: "boite-menacee" },
      h("div", { class: "boite-menacee-tete" }, icone("alerte"), "Menacée"),
      h("p", { class: "boite-menacee-titre" }, `« ${m.titre} »`),
      m.phrase ? h("p", { class: "boite-menacee-phrase" }, m.phrase) : null,
      h("div", { class: "rangee serree boite-menacee-gestes" }, repousser, parler));
  }

  // --- La feuille ---
  function contenuFeuille() {
    if (!sait("rituel-v1")) return blocSujets();
    const b = R.briefingDuJour(lu.rituel, { luA: lu.luA });
    const c = lu.rituel?.conversations;
    const menacees = dashboard?.menacees ?? b?.menacees ?? [];
    const texteConseil = conseil !== undefined ? conseil?.texte : dashboard?.conseil?.conseil?.texte;
    const liste = R.sujets(dashboard?.briefing, etatsVus());
    return [
      troisLignes(),
      b && c?.ligne ? ligneConversations(c) : null,
      menacees.length ? [intertitre(R.intertitreMenacees(menacees.length)), h("div", { class: "boite-menacees" }, menacees.map(carteMenacee))] : null,
      texteConseil ? [intertitre("Le conseil du moment"), h("div", { class: "carte plate boite-conseil" }, h("p", null, texteConseil))] : null,
      intertitre(R.intertitreSujets(liste)),
      blocSujets(),
      h("div", { class: "boite-organiser" }, boutonOrganiser(),
        h("p", { class: "aide" }, "Rémy (ton modèle local) prépare un plan : rien ne bouge dans Motion sans ton « Oui ».")),
    ];
  }
  function dessinerFeuille() {
    if (!ouverte) return;
    const { f, corps } = ouverte;
    const defile = f.corps.scrollTop;
    const actif = document.activeElement;
    const cle = focusApres || (corps.contains(actif) && actif !== corps ? actif?.dataset?.cle : null);
    focusApres = null;
    vider(corps, contenuFeuille());
    f.corps.scrollTop = defile;
    if (cle) {
      const cible = [...corps.querySelectorAll("[data-cle]")].find((x) => x.dataset.cle === cle && !x.disabled);
      if (cible) cible.focus();
      else corps.focus({ preventScroll: true });
    }
  }
  function ouvrirFeuille() {
    if (ouverte) return;
    const retour = document.activeElement;
    // Le focus sur le contenu (pas sur un geste) : Entrée n'agit pas par mégarde, Tab y entre.
    const corps = h("div", { class: "boite-feuille", tabindex: "-1", autofocus: true });
    // Le second clic d'un double clic tomberait sur ce qui vient de bouger : un geste à la fois.
    corps.addEventListener("click", (e) => {
      if (e.detail > 0 && R.clicEnEcho(bougeA)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    const f = feuille({
      titre: sait("rituel-v1") ? "Ton briefing" : "À voir avec Rémy",
      large: true,
      classe: "boite-dialog",
      contenu: corps,
      surFermeture: () => {
        feuillesOuvertes.delete(f);
        ouverte = null;
        // Le focus revient d'où on venait (redessiné entre-temps : le bouton de la boîte).
        if (document.activeElement === document.body || !document.activeElement) (retour?.isConnected ? retour : btn).focus();
      },
    });
    feuillesOuvertes.add(f);
    ouverte = { f, corps };
    dessinerFeuille();
    corps.focus();
    lireRituel();
    if (!dashboard && !erreurTableau) attendreTableau();
  }

  // --- La carte de la colonne : proposition, bilan (le soir), briefing ---
  function carteProposition() {
    if (!bureau.estBureau() || !sait("rituel-v1")) return null;
    const notifs = bureau.reglagesNotifs();
    if (notifs.briefing || local.lire(CLE_PROPOSITION, false) || !bureau.accueilDejaVu()) return null;
    const a = R.texteHeure(notifs.heureBriefing);
    const oui = bouton(`Oui, à ${a}`, { classe: "plein" });
    oui.addEventListener("click", () => occupe(oui, async () => {
      local.ecrire(CLE_PROPOSITION, true);
      const r = await bureau.activerRituel("briefing");
      if (r.ok) dire(`Briefing activé : chaque matin à ${a}.`, { genre: "succes" });
      else dire(bureau.REFUS_NOTIFICATIONS, { genre: "erreur", detail: r.erreur, action: { libelle: "Réglages", faire: () => ctx.aller("reglages/ordinateur") } });
      dessinerCarte();
    }));
    const non = bouton("Non merci", { classe: "papier", onclick: () => {
      local.ecrire(CLE_PROPOSITION, true);
      dessinerCarte();
      dire("Pas de briefing chaque matin : tu peux l'allumer dans Réglages › Ordinateur.");
    } });
    return h("section", { class: "carte boite-proposition", "aria-label": "Ton briefing chaque matin ?" },
      h("h2", { class: "boite-proposition-titre" }, icone("leverSoleil"), "Ton briefing chaque matin ?"),
      h("p", { class: "aide-carte" }, `À ${a} : ce qui compte, pourquoi, ce qui est menacé. Trois lignes calculées par ta tour, sans IA. L'heure se change dans Réglages.`),
      h("div", { class: "rangee", style: { marginTop: "12px" } }, oui, non));
  }

  function carteBriefing({ replie }) {
    const avecRituel = sait("rituel-v1");
    const b = dashboard?.briefing;
    const liste = R.sujets(b, etatsVus());
    const n = R.compteOuverts(liste);
    if (!avecRituel && !liste.length && !b?.text) return null;
    const corps = [];
    if (avecRituel) {
      const br = R.briefingDuJour(lu.rituel, { luA: lu.luA });
      if (br) corps.push(h("div", { class: "boite-trois-court" }, lignes(br, { court: true }), provenance()));
      else corps.push(sansBriefing());
    }
    const etatSujets = n ? `${n} ${n > 1 ? "ouverts" : "ouvert"}` : liste.length ? "tous réglés" : dashboard ? R.rienBoite(b, dashboard?.systeme?.reflexion) : tableauIllisible || erreurMontree(erreurTableau) ? "pas pu être lus" : "…";
    corps.push(h("div", { class: "boite-ligne-sujets" },
      icone(n ? "plateauPlein" : "plateau"),
      h("span", { class: "boite-ligne-sujets-texte" }, h("strong", null, "Sujets de la nuit"), ` · ${etatSujets}`),
      avecCle(bouton("Voir", { classe: "papier petit", etiquette: avecRituel ? "Voir le briefing et les sujets de la nuit" : "Voir les sujets de la nuit", onclick: () => ouvrir("boite") }), "voir")));
    if (avecRituel) corps.push(h("div", { class: "boite-organiser-court" }, boutonOrganiser("texte")));
    // Une tour sans rituel-v1 n'a pas de briefing : seulement les sujets de la nuit.
    const nom = avecRituel ? "Briefing du matin" : "À voir avec Rémy";
    const titre = h("h2", { class: "titre-section" }, nom, n ? h("span", { class: "compte" }, String(n)) : null);
    // Le matin, ouvert ; l'après-midi et le soir, replié (un clic l'ouvre).
    if (!replie) return h("section", { class: "carte boite-briefing", "aria-label": nom }, titre, corps);
    const det = h("details", { class: "carte briefing-replie boite-briefing", "aria-label": nom, open: replieOuvert },
      avecCle(h("summary", null, titre, icone("bas", "chevron-replie")), "replie"), corps);
    det.addEventListener("toggle", () => (replieOuvert = det.open));
    return det;
  }

  function carteBilan(soir) {
    const jour = soir?.jour || R.jourISO();
    if (bilan.jour !== jour) {
      bilan.jour = jour;
      bilan.poussees = new Set();
    }
    const range = R.bilanRange(bilan.range, jour) || R.bilanRange(local.lire(CLE_BILAN, null), jour);
    const section = h("section", { class: "carte boite-bilan", "aria-label": "Bilan du soir", tabindex: "-1" }, h("h2", { class: "titre-section" }, "Bilan du soir"));
    if (!soir) ajouterA(section, sansBriefing("Le bilan d'aujourd'hui n'est pas encore prêt."));
    else {
      const reste = R.resteVisible(soir, bilan.poussees);
      const bloc = (titre, ic, lignesBloc, videTexte) => h("div", { class: "boite-bloc" },
        h("div", { class: "boite-bloc-titre" }, icone(ic), `${titre}${lignesBloc.length ? ` (${lignesBloc.length})` : ""}`),
        lignesBloc.length ? h("ul", { class: "boite-bloc-liste" }, lignesBloc.map((t) => h("li", null, t))) : h("p", { class: "aide" }, videTexte));
      let pousser = null;
      if (reste.length) {
        pousser = avecCle(bouton(bilan.pousse ? "Envoi à Motion…" : "Tout ce qui reste → demain", { classe: "plein", icone: "fleche" }), "pousser");
        pousser.disabled = bilan.pousse;
        pousser.addEventListener("click", () => toutADemain(soir));
      }
      ajouterA(section,
        h("p", { class: "carte-titre" }, soir.phrase || ""),
        soir.avertissement ? h("p", { class: "boite-avertissement" }, icone("alerte"), h("span", null, soir.avertissement)) : null,
        bloc("Fait", "coche", (soir.fait || []).map((x) => (typeof x === "string" ? x : x?.titre)).filter(Boolean), "Rien coché dans Rémy aujourd'hui. Ce que tu as coché dans Motion n'apparaît pas ici."),
        bloc("A glissé", "retour", (soir.glisse || []).map((x) => x.titre), "Rien n'a glissé de son créneau."),
        bloc("Reste pour aujourd'hui", "plateau", reste.map((x) => x.titre), R.videReste(bilan.poussees)),
        pousser ? h("div", { class: "boite-pousser" }, pousser, h("p", { class: "aide" }, "Une seule écriture dans Motion, même heure demain. Annulable depuis le bandeau ou l'Historique.")) : null);
    }
    const ranger = avecCle(bouton(range ? "Rangé pour la nuit" : bilan.envoi ? "Envoi…" : "Ranger pour la nuit", { classe: "papier", icone: range ? "coche" : "lune" }), "ranger");
    ranger.disabled = range || bilan.envoi;
    ranger.addEventListener("click", () => rangerBilan(jour));
    champ.disabled = range;
    ajouterA(section, h("hr", { class: "separateur" }),
      h("label", { class: "etiquette-champ", for: champ.id }, "Comment ça s'est passé ?"), champ,
      h("div", { class: "rangee", style: { marginTop: "10px" } }, ranger),
      h("p", { class: "aide", style: { marginTop: "6px" } }, "Rangé sur ta tour avec les faits du jour ; Rémy le relira cette nuit. Sans ligne, les faits suffisent."));
    return section;
  }

  async function rangerBilan(jour) {
    if (bilan.envoi) return;
    bilan.envoi = true;
    dessinerCarte();
    try {
      const r = await ecrire("/api/rituel/bilan", { ressenti: champ.value.trim() });
      bilan.range = { jour, range: true };
      local.ecrire(CLE_BILAN, bilan.range);
      dire(r?.phrase || "Bilan rangé : Rémy le relira cette nuit.", { genre: "succes" });
    } catch (err) {
      if (err?.nature !== "auth") dire(`Bilan pas rangé : ${texteErreur(err)} Ton texte est toujours là.`, { genre: "erreur", action: { libelle: "Réessayer", faire: () => rangerBilan(jour) } });
    } finally {
      bilan.envoi = false;
      dessinerCarte();
    }
  }

  async function toutADemain(soir) {
    const reste = R.resteVisible(soir, bilan.poussees);
    if (bilan.pousse) return;
    if (!reste.length) return dire("Rien ne reste pour aujourd'hui.");
    bilan.pousse = true;
    dessinerCarte();
    try {
      const actions = reste.map((t) => ({ type: "modifier", nom: t.titre, echeance: isoLocal(new Date(t.versDemain)), id: t.id }));
      const r = await ecrire("/api/motion/apply", { actions, resume: "Bilan du soir : tout ce qui reste à demain", idCommande: nouvelId() }, { delai: 180000 });
      const b = R.bilanPoussee(r, reste);
      if (!b.reussies) {
        dire(`Motion n'a rien déplacé : ${b.erreur || "raison inconnue"}. Réessaie.`, { genre: "erreur", action: { libelle: "Réessayer", faire: () => toutADemain(soir) } });
        return;
      }
      for (const id of b.ids) bilan.poussees.add(id);
      dire(R.phrasePoussees(b.reussies, b.echecs), {
        genre: b.echecs ? "erreur" : "succes",
        duree: 8000,
        action: r?.ledgerId ? { libelle: "Annuler", faire: () => annulerPoussee(r.ledgerId) } : null,
      });
      relire?.();
    } catch (err) {
      if (err?.nature === "auth") return;
      if (err?.nature === "reseau") dire("Pas de réseau : rien n'a été déplacé. Réessaie quand Rémy est joignable.", { genre: "erreur", action: { libelle: "Réessayer", faire: () => toutADemain(soir) } });
      else dire(`Rien n'a été déplacé : ${texteErreur(err)}`, { genre: "erreur", action: { libelle: "Réessayer", faire: () => toutADemain(soir) } });
    } finally {
      bilan.pousse = false;
      dessinerCarte();
    }
  }

  async function annulerPoussee(ledgerId) {
    try {
      const r = await ecrire("/api/motion/undo", { id: ledgerId }, { delai: 150000 });
      if (r?.ok === false) dire("Impossible de tout remettre à aujourd'hui : regarde l'Historique.", { genre: "erreur" });
      else {
        bilan.poussees = new Set();
        dire("Remis à aujourd'hui.", { genre: "succes" });
      }
      relire?.();
      lireRituel({ frais: true });
    } catch (err) {
      direErreur(err, () => annulerPoussee(ledgerId), "Pas remis à aujourd'hui");
    }
    dessinerCarte();
  }

  function dessinerCarte() {
    // Le champ du soir garde son focus et sa sélection d'un dessin à l'autre ; un bouton aussi.
    const focus = document.activeElement === champ ? [champ.selectionStart, champ.selectionEnd] : null;
    const cleFocus = carte.contains(document.activeElement) ? document.activeElement.dataset?.cle : null;
    const hh = new Date().getHours();
    const avecRituel = sait("rituel-v1");
    const blocs = [carteProposition()];
    // Le soir (dès 18 h, comme l'iPhone), le bilan passe devant.
    if (avecRituel && (hh >= 18 || bilanDemande)) blocs.push(carteBilan(R.soirDuJour(lu.rituel, { luA: lu.luA })));
    blocs.push(carteBriefing({ replie: hh >= 12 }));
    vider(carte, blocs);
    if (focus) {
      champ.focus({ preventScroll: true });
      champ.setSelectionRange(focus[0], focus[1]);
    } else if (cleFocus) {
      const cible = [...carte.querySelectorAll("[data-cle]")].find((x) => x.dataset.cle === cleFocus && !x.disabled);
      cible?.focus({ preventScroll: true });
    }
  }

  function montrerBilan() {
    bilanDemande = true;
    dessinerCarte();
    lireRituel();
    requestAnimationFrame(() => {
      const section = carte.querySelector(".boite-bilan");
      if (!section) {
        if (!sait("rituel-v1")) dire("Ta tour ne sait pas encore préparer le bilan : relance son installeur pour la mettre à jour.");
        return;
      }
      section.scrollIntoView({ block: "start", behavior: "smooth" });
      (champ.disabled ? section : champ).focus({ preventScroll: true });
    });
  }

  // --- « Cette nuit, je creuse aussi ? » (notification d'une proposition de nuit) ---
  function ouvrirNuit(id) {
    const corps = h("div", { class: "boite-nuit", tabindex: "-1", autofocus: true }, squelette([0.8, 0.5]));
    const f = feuille({ titre: "Cette nuit, je creuse aussi ?", contenu: corps, surFermeture: () => feuillesOuvertes.delete(f) });
    feuillesOuvertes.add(f);
    let restantes = [];
    let regles = [];
    let bouge = null; // la liste vient de perdre un sujet : le suivant glisse sous le pointeur
    corps.addEventListener("click", (e) => {
      if (e.detail > 0 && R.clicEnEcho(bouge)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    const plusTard = (p) => {
      // Rien ne part : elle reste proposée tant que la tour la propose. L'app
      // Windows la redit dans 3 heures (l'iPhone aussi : delaiPlusTard).
      if (bureau.estBureau()) {
        bureau.reporterProposition(p.id);
        dire("Plus tard : Rémy te le redemandera dans 3 heures.");
      }
      restantes = restantes.filter((x) => x !== p);
      if (!restantes.length && !regles.length) f.fermer();
      else dessinerNuit();
      bouge = Date.now();
    };
    const dessinerNuit = () => {
      if (!restantes.length && !regles.length) {
        vider(corps, vide(null, id ? "Ce sujet n'est plus proposé pour cette nuit." : "Rien n'attend ta réponse pour cette nuit."),
          h("div", { class: "rangee" }, bouton("Fermer", { classe: "papier", onclick: () => f.fermer() })));
        return;
      }
      vider(corps,
        restantes.map((p) => {
          const oui = bouton("Oui", { classe: "plein", icone: "coche" });
          oui.addEventListener("click", () => occupe(oui, () => accepter(p)));
          const pourquoi = p.sujet && p.texte && p.texte !== p.sujet ? p.texte.replace(`${p.sujet} — `, "") : null;
          return h("article", { class: "boite-nuit-sujet" },
            h("p", { class: "boite-nuit-titre" }, p.sujet || p.texte),
            pourquoi ? h("p", { class: "aide-carte" }, pourquoi) : null,
            h("p", { class: "aide" }, "Rémy le creusera pendant la réflexion de cette nuit, sans rien changer d'autre."),
            h("div", { class: "rangee", style: { marginTop: "10px" } }, oui, bouton("Plus tard", { classe: "papier", onclick: () => plusTard(p) })));
        }),
        regles.length ? [intertitre("D'après tes règles"), regles.map((p) => h("article", { class: "boite-nuit-sujet" },
          h("p", { class: "boite-nuit-titre" }, bureau.texteProposition(p).titre), h("p", { class: "aide-carte" }, p.texte),
          p.convId ? h("div", { class: "rangee", style: { marginTop: "10px" } }, h("a", { class: "btn papier", href: `#/remy/${encodeURIComponent(p.convId)}`, onclick: () => f.fermer() }, "Répondre dans Rémy")) : null))] : null);
    };
    const accepter = async (p) => {
      try {
        const r = await ecrire("/api/propositions/nuit", { sujet: p.sujet || p.texte });
        dire(r?.deja ? "C'est déjà dans les sujets de cette nuit." : "Ajouté aux sujets de cette nuit.", { genre: "succes" });
        restantes = restantes.filter((x) => x !== p);
        if (!restantes.length && !regles.length) f.fermer();
        else dessinerNuit();
        bouge = Date.now();
      } catch (err) {
        direErreur(err, () => accepter(p), "Pas ajouté");
      }
    };
    const charger = async () => {
      vider(corps, squelette([0.8, 0.5]));
      try {
        const propositions = (await api("/api/propositions/attente", { delai: 20000 }))?.propositions || [];
        if (!f.el.isConnected) return;
        const nuit = propositions.filter((p) => p.origine === "nuit");
        restantes = id ? nuit.filter((p) => p.id === id) : nuit;
        regles = id ? [] : propositions.filter((p) => p.origine !== "nuit");
        dessinerNuit();
      } catch (err) {
        vider(corps, blocErreur(err, charger));
      }
    };
    if (!sait("propositions-attente-v1")) {
      vider(corps, vide(null, "Ta tour ne sait pas encore proposer de sujets pour la nuit : relance son installeur pour la mettre à jour."));
      return;
    }
    charger();
  }

  function ouvrir(quoi = "boite", arg) {
    if (quoi === "bilan") return montrerBilan();
    if (quoi === "nuit") return ouvrirNuit(arg);
    ouvrirFeuille();
  }

  /** Aujourd'hui passe le tableau (et le conseil affiché) ; `frais` : Rafraîchir. `erreur` : le tableau n'a pas pu être lu. */
  function maj({ dashboard: d, conseil: c, frais = false, erreur } = {}) {
    if (d !== undefined && d !== null) {
      dashboard = d;
      tableauIllisible = false;
    }
    if (c !== undefined) conseil = c;
    erreurTableau = d ? null : erreur ?? erreurTableau;
    // Un tableau lu après le geste le relit (confirmé, ou changé ailleurs) ; un plus ancien ne le défait pas.
    for (const s of dashboard?.briefing?.items || []) {
      const sc = surcharges.get(s.id);
      if (sc && !enVol.has(s.id) && R.surchargeRelue(sc, s.etat, d ? dashboard.maintenant : null)) surcharges.delete(s.id);
    }
    dessiner();
    lireRituel({ frais });
  }

  majBouton();
  return { bouton: btn, carte, maj, ouvrir };
}
