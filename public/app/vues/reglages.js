// Réglages, avec une recherche dans les réglages (filtre en direct, aussi
// dans Ctrl+K). Ordinateur (app Windows), Apparence, Noter, Rémy (circuits,
// recherche web, secours Claude…), Modèle local, Mémoire, Coûts, Appareils,
// jeton de capture, Agenda Google, Activité du PC, Règles, Envoi en attente,
// Diagnostic, Avancé (interface classique, se déconnecter).
import { api, ecrire, remplacer, supprimer, seg, sait, versionTour } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, squelette, blocErreur, vide, confirmer, quand, occupe, appliquerTheme, themeChoisi, local, ctrl } from "../ui.js";
import * as bureau from "../bureau.js";
import * as fileEnvoi from "../file-envoi.js";
import { CLE_PAR_DEFAUT, parDefaut } from "./noter.js";

let racine;
let ctx;
let section = "ordinateur";
let refs = {};
let recherche = "";

/** L'index des réglages : section, libellé, mots-clés (pour la recherche et Ctrl+K). */
export const INDEX = [
  ["ordinateur", "Raccourci global « Noter »", "raccourci clavier ctrl alt espace global noter"],
  ["ordinateur", "Démarrer avec Windows", "démarrage session ouverture automatique"],
  ["ordinateur", "Fermer = rester près de l'horloge", "fermer zone notification barre tâches"],
  ["ordinateur", "Notifications des rappels", "notification rappel alerte windows"],
  ["ordinateur", "Briefing du matin (notification)", "briefing matin notification heure"],
  ["ordinateur", "Bilan du soir (notification)", "bilan soir notification heure"],
  ["ordinateur", "Adresse de la tour", "adresse url tour tailscale serveur"],
  ["apparence", "Thème : auto, clair, sombre", "thème sombre clair nuit apparence couleurs"],
  ["noter", "Où va une pensée floue", "noter capture idée tâche défaut genre"],
  ["remy", "Réflexion de la nuit et circuits", "circuits nuit synthèses réflexion conseil compactage règles"],
  ["remy", "Recherche web", "recherche web internet duckduckgo autorisation"],
  ["remy", "Recherche dans les conversations privées", "privée recherche web cadenas"],
  ["remy", "Secours Claude", "secours claude cloud anthropic panne"],
  ["remy", "Contexte envoyé au cloud", "contexte cloud claude vie privée"],
  ["remy", "Ancienneté d'une proposition", "proposition périmée jours confirmer"],
  ["modele", "Modèle local", "modèle local glm deepseek spark cerveau"],
  ["memoire", "Mémoire de Rémy", "mémoire souvenirs identité préférences"],
  ["couts", "Coûts", "coûts dépenses argent dollars api"],
  ["appareils", "Appareils connectés", "appareils iphone jeton session déconnecter"],
  ["jeton", "Jeton de capture (raccourci iPhone)", "jeton capture raccourci partage siri"],
  ["agenda", "Agenda Google", "agenda google calendrier connexion"],
  ["activite", "Activité du PC", "activité pc activitywatch temps écran"],
  ["regles", "Règles de Rémy", "règles avant tâches conditionnelles"],
  ["file", "Envoi en attente", "file attente hors ligne envoi captures"],
  ["diagnostic", "Diagnostic et incidents", "diagnostic incidents version erreurs copier"],
  ["avance", "Interface classique", "classique ancienne interface onboarding appel import roadmap"],
  ["avance", "Se déconnecter", "déconnexion quitter session"],
];

const SECTIONS = [
  ["ordinateur", "Ordinateur", "ecran"],
  ["apparence", "Apparence", "soleil"],
  ["noter", "Noter", "plus"],
  ["remy", "Rémy", "remy"],
  ["modele", "Modèle local", "globe"],
  ["memoire", "Mémoire", "ampoule"],
  ["couts", "Coûts", "jauge"],
  ["appareils", "Appareils", "cadenas"],
  ["jeton", "Jeton de capture", "copier"],
  ["agenda", "Agenda Google", "horloge"],
  ["activite", "Activité du PC", "ecran"],
  ["regles", "Règles", "liste"],
  ["file", "Envoi en attente", "envoyer"],
  ["diagnostic", "Diagnostic", "alerte"],
  ["avance", "Avancé", "curseurs"],
];

export default {
  async monter(el, args, contexte) {
    racine = el;
    ctx = contexte;
    section = SECTIONS.some(([id]) => id === args[0]) ? args[0] : null;
    refs.recherche = h("input", { class: "champ", type: "search", placeholder: "Chercher un réglage", "aria-label": "Chercher dans les réglages", oninput: (e) => { recherche = e.target.value; dessinerMaitre(); } });
    refs.maitre = h("nav", { class: "maitre", "aria-label": "Sections des réglages" });
    refs.detail = h("section", { class: "detail" });
    refs.grille = h("div", { class: "reglages-grille" }, h("div", null, h("div", { class: "recherche-champ" }, icone("recherche"), refs.recherche, h("span", { class: "kbd" }, "/")), refs.maitre), refs.detail);
    vider(el, h("header", { class: "entete-ecran" }, h("div", { class: "titres" }, h("div", { class: "sur-titre" }, "Rémy"), h("h1", { class: "titre-ecran" }, "Réglages"))), refs.grille);
    if (!section && matchMedia("(min-width: 721px)").matches) section = "ordinateur";
    dessinerMaitre();
    await dessinerSection();
  },
  suivre(args) {
    section = SECTIONS.some(([id]) => id === args[0]) ? args[0] : null;
    dessinerMaitre();
    dessinerSection();
  },
  chercher() {
    refs.recherche?.focus();
  },
};

function dessinerMaitre() {
  const q = recherche.trim().toLowerCase();
  refs.grille.classList.toggle("detail-ouvert", Boolean(section) && !q);
  if (q) {
    const trouves = INDEX.filter(([, lib, mots]) => `${lib} ${mots}`.toLowerCase().includes(q));
    vider(refs.maitre, h("div", { class: "resultats-recherche" },
      trouves.length ? h("ul", { class: "liste" }, trouves.map(([s, lib]) => h("li", { class: "ligne cliquable", onclick: () => { recherche = ""; refs.recherche.value = ""; ctx.aller(`reglages/${s}`); } },
        h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, lib), h("div", { class: "meta" }, SECTIONS.find(([id]) => id === s)?.[1]))))) : vide(null, `Aucun réglage pour « ${recherche} ».`)));
    return;
  }
  vider(refs.maitre, SECTIONS.map(([id, lib, ic]) => h("a", { class: "element-maitre", href: `#/reglages/${id}`, "aria-current": section === id ? "page" : null }, icone(ic), h("span", { class: "t" }, lib),
    id === "file" && fileEnvoi.compte() ? h("span", { class: "pastille-compte" }, String(fileEnvoi.compte())) : null)));
}

const retour = () => h("a", { class: "btn texte petit lien-retour-projets", href: "#/reglages" }, icone("retour"), "Réglages");
function carte(titre, aide, ...contenu) {
  return h("section", { class: "carte section-reglage" }, retour(), h("h2", null, titre), aide ? h("p", { class: "aide" }, aide) : null, ...contenu);
}
function bascule(titre, detail, valeur, changer, { desactive = false } = {}) {
  const input = h("input", { type: "checkbox", role: "switch", disabled: desactive });
  input.checked = Boolean(valeur);
  input.addEventListener("change", async () => {
    input.disabled = true;
    try {
      await changer(input.checked);
    } catch (err) {
      input.checked = !input.checked;
      direErreur(err, null, "Réglage pas enregistré");
    } finally {
      input.disabled = desactive;
    }
  });
  return h("label", { class: "bascule reglage" }, h("span", { class: "textes" }, h("strong", null, titre), detail ? h("span", null, detail) : null), input);
}

async function dessinerSection() {
  if (!section) return vider(refs.detail);
  vider(refs.detail, h("section", { class: "carte" }, squelette([0.5, 0.8, 0.7])));
  const s = section;
  try {
    const contenu = await (SECTIONS_RENDU[s] || (() => vide("Section inconnue")))();
    if (s === section) vider(refs.detail, contenu);
  } catch (err) {
    if (s === section) vider(refs.detail, h("section", { class: "carte" }, blocErreur(err, dessinerSection)));
  }
}

const SECTIONS_RENDU = {
  async ordinateur() {
    if (!bureau.estBureau()) {
      return carte("Ordinateur", "Ces réglages vivent dans l'app Rémy pour Windows : une vraie fenêtre épinglable à la barre des tâches, une icône près de l'horloge, « Noter » de n'importe où et des notifications.",
        h("p", { class: "aide", style: { marginTop: "8px" } }, "Tu es dans un navigateur. Pour installer l'app : la page des Releases du dépôt (« bureau-v… »), puis le guide « docs/bureau.md »."),
        h("div", { class: "reglage" }, h("strong", null, "Raccourcis de ce site"), h("p", { class: "aide" }, `N pour noter, / pour chercher, ${ctrl}+K pour la palette, ? pour l'aide.`)));
    }
    const etat = await bureau.lireEtat();
    const notifs = bureau.reglagesNotifs();
    const raccourci = h("input", { class: "champ", type: "text", readonly: true, value: etat.raccourci || "", "aria-label": "Raccourci global", style: { maxWidth: "260px" }, title: "Clique puis tape la combinaison voulue" });
    const erreurRaccourci = h("p", { class: "erreur-champ", role: "alert" });
    raccourci.addEventListener("keydown", async (e) => {
      if (["Tab", "Escape"].includes(e.key)) return;
      e.preventDefault();
      const combi = combinaison(e);
      if (!combi) {
        erreurRaccourci.textContent = "Garde au moins Ctrl, Alt ou Windows, puis une touche.";
        return;
      }
      raccourci.value = combi;
      erreurRaccourci.textContent = "";
      try {
        await bureau.regler({ raccourci: combi });
        dire(`Raccourci : ${combi}.`, { genre: "succes" });
      } catch (err) {
        erreurRaccourci.textContent = `${typeof err === "string" ? err : err?.message || "Refusé"}. L'ancien reste actif.`;
        raccourci.value = bureau.etatBureau()?.raccourci || "";
      }
    });
    const heure = (cle, valeur) => {
      const input = h("input", { class: "champ", type: "time", value: valeur, style: { width: "auto" }, "aria-label": "Heure" });
      input.addEventListener("change", () => {
        bureau.reglerNotifs({ [cle]: input.value || valeur });
        dire("Heure enregistrée.", { genre: "succes", duree: 1500 });
      });
      return input;
    };
    return carte("Ordinateur", "L'app Rémy pour Windows.",
      h("div", { class: "reglage" }, h("strong", null, "Noter de n'importe où"), h("p", { class: "aide" }, "Clique dans le champ, puis tape la combinaison voulue."), h("div", { class: "rangee", style: { marginTop: "6px" } }, raccourci), erreurRaccourci),
      bascule("Démarrer avec Windows", "La fenêtre se charge cachée ; les notifications tournent.", etat.demarrage, (v) => bureau.regler({ demarrage: v })),
      bascule("Fermer = rester près de l'horloge", "La croix range Rémy dans la zone de notification. Quitter : clic droit sur l'icône.", etat.fermerDansZone, (v) => bureau.regler({ fermerDansZone: v })),
      bascule("Notifications des rappels", "Une notification Windows quand un rappel tombe (lu au plus chaque minute, sans IA).", notifs.rappels, async (v) => bureau.reglerNotifs({ rappels: v })),
      h("div", { class: "rangee reglage" }, h("div", { style: { flex: 1 } }, bascule("Briefing du matin", "Ta journée en deux lignes.", notifs.briefing, async (v) => bureau.reglerNotifs({ briefing: v }))), heure("heureBriefing", notifs.heureBriefing)),
      h("div", { class: "rangee reglage" }, h("div", { style: { flex: 1 } }, bascule("Bilan du soir", "Fait, glissé, ce qui reste.", notifs.bilan, async (v) => bureau.reglerNotifs({ bilan: v }))), heure("heureBilan", notifs.heureBilan)),
      h("div", { class: "rangee reglage" }, bouton("Tester une notification", { classe: "papier", icone: "cloche", onclick: (e) => occupe(e.currentTarget, async () => {
        try { await bureau.notificationEssai(); dire("Envoyée : elle doit apparaître en bas à droite.", { genre: "succes" }); } catch (err) { direErreur(err, null, "Pas de notification"); }
      }) })),
      h("div", { class: "reglage" }, h("strong", null, "Adresse de la tour"), h("p", { class: "mono", style: { margin: "4px 0 8px", overflowWrap: "anywhere" } }, etat.adresse || location.origin),
        bouton("Changer l'adresse", { classe: "papier", onclick: async () => { if (await confirmer("Changer l'adresse de la tour ?", { detail: "La fenêtre revient à l'écran d'adresse.", libelle: "Changer" })) bureau.changerAdresse(); } })),
      h("p", { class: "aide reglage" }, `App Rémy ${etat.version || "?"}`));
  },

  async apparence() {
    const t = themeChoisi();
    const choix = [["auto", "Auto (comme Windows)"], ["light", "Clair"], ["dark", "Sombre"]];
    const groupe = h("div", { class: "rangee serree", role: "radiogroup", "aria-label": "Thème" }, choix.map(([v, lib]) => {
      const b = h("button", { type: "button", class: "puce", role: "radio", "aria-checked": String(t === v), "aria-pressed": String(t === v) }, lib);
      b.addEventListener("click", () => {
        appliquerTheme(v);
        for (const x of groupe.children) {
          x.setAttribute("aria-pressed", String(x === b));
          x.setAttribute("aria-checked", String(x === b));
        }
      });
      return b;
    }));
    return carte("Apparence", "Le papier chaud de l'iPhone, en clair ou en sombre.", h("div", { class: "reglage" }, groupe));
  },

  async noter() {
    const v = parDefaut();
    const groupe = h("div", { class: "rangee serree", role: "radiogroup", "aria-label": "Pensée floue" }, [["idee", "Dans les Idées"], ["tache", "Une tâche Motion"]].map(([val, lib]) => {
      const b = h("button", { type: "button", class: "puce", role: "radio", "aria-pressed": String(v === val), "aria-checked": String(v === val) }, lib);
      b.addEventListener("click", () => {
        local.ecrire(CLE_PAR_DEFAUT, val);
        for (const x of groupe.children) x.setAttribute("aria-pressed", String(x === b));
        dire("Enregistré.", { genre: "succes", duree: 1500 });
      });
      return b;
    }));
    return carte("Noter", "Rémy devine le genre sans IA ; tu corriges d'un clic.",
      h("div", { class: "reglage" }, h("strong", null, "Une pensée sans action claire va…"), h("p", { class: "aide", style: { margin: "4px 0 8px" } }, "« Un clip en noir pour le prochain son » : une idée à garder, ou une tâche à planifier ?"), groupe),
      h("div", { class: "reglage" }, h("strong", null, "Raccourci"), h("p", { class: "aide" }, "N n'importe où sur le site ; dans l'app Windows, le raccourci global (Réglages › Ordinateur).")));
  },

  async remy() {
    const r = await api("/api/reglages");
    const ecrireReglage = async (corps) => {
      const v = await remplacer("/api/reglages", corps);
      dire("Enregistré.", { genre: "succes", duree: 1500 });
      return v;
    };
    const circuits = Object.entries(r.circuits || {}).map(([id, c]) => bascule(c.nom, c.forceParLaTour ? "Coupé sur la tour (remy.env)." : null, c.actif, (v) => ecrireReglage({ circuits: { [id]: v } }), { desactive: c.forceParLaTour }));
    const peremption = h("input", { class: "champ", type: "number", min: "1", max: "90", value: String(r.peremptionJours || 7), style: { width: "90px" }, "aria-label": "Jours" });
    peremption.addEventListener("change", async () => {
      const n = Number(peremption.value);
      if (!Number.isInteger(n) || n < 1 || n > 90) return dire("Entre 1 et 90 jours.", { genre: "erreur" });
      try { await ecrireReglage({ peremptionJours: n }); } catch (err) { direErreur(err); }
    });
    return carte("Rémy", "Ce que Rémy fait sans toi, et ce qu'il peut envoyer ailleurs.",
      h("h3", { class: "titre-section", style: { marginTop: "12px" } }, "Recherche web"),
      bascule("Recherche web", r.rechercheWebCoupeeParLaTour ? "Coupée sur la tour." : `Locale (${r.rechercheLocale || "moteur local"}) : Rémy cherche et lit lui-même.`, r.rechercheWeb, (v) => ecrireReglage({ rechercheWeb: v }), { desactive: r.rechercheWebCoupeeParLaTour }),
      sait("recherche-privee-v1") ? bascule("Recherche dans les conversations privées", r.recherchePriveeVerrouillee ? "Verrouillée sur la tour." : "Seule la requête sort, jamais la conversation.", r.recherchePriveeReglage ?? r.recherchePrivee, (v) => ecrireReglage({ recherchePrivee: v }), { desactive: r.recherchePriveeVerrouillee }) : null,
      h("h3", { class: "titre-section", style: { marginTop: "16px" } }, "Cloud"),
      bascule("Secours Claude", r.secoursCloudForceParLaTour ? "Allumé par la tour (remy.env)." : "Si le modèle local est en panne, Rémy passe par Claude (payant). Jamais pour une conversation privée.", r.secoursCloudReglage ?? r.secoursCloud, (v) => ecrireReglage({ secoursCloud: v }), { desactive: r.secoursCloudForceParLaTour }),
      bascule("Contexte envoyé au cloud", "Quand Claude répond, il peut recevoir ton planning et ta mémoire. Coupé : seulement la question.", r.contexteCloud, (v) => ecrireReglage({ contexteCloud: v })),
      h("h3", { class: "titre-section", style: { marginTop: "16px" } }, "Circuits"),
      ...circuits,
      h("div", { class: "rangee reglage" }, h("div", { style: { flex: 1 } }, h("strong", null, "Ancienneté d'une proposition"), h("p", { class: "aide" }, "Au-delà, « Oui » demande de confirmer.")), peremption, h("span", { class: "aide" }, "jours")));
  },

  async modele() {
    const m = await api("/api/modeles");
    const choix = h("div", { class: "rangee serree", role: "radiogroup" }, [{ id: null, libelle: "Automatique (celui chargé)" }, ...(m.servis || [])].map((x) => {
      const actif = (m.choisi ?? null) === x.id;
      const b = h("button", { type: "button", class: "puce", role: "radio", "aria-pressed": String(actif), "aria-checked": String(actif) }, x.libelle || x.id, x.fenetre ? h("span", { class: "aide" }, ` ${Math.round(x.fenetre / 1024)}k`) : null);
      b.addEventListener("click", () => occupe(b, async () => {
        try {
          await remplacer("/api/modeles", { id: x.id });
          dire(x.id ? `Modèle : ${x.libelle || x.id}.` : "Modèle : automatique.", { genre: "succes" });
          dessinerSection();
        } catch (err) { direErreur(err, null, "Modèle pas changé"); }
      }));
      return b;
    }));
    return carte("Modèle local", m.joignable === false ? "Le modèle local ne répond pas en ce moment." : `Sur ${m.machine || "tes machines"} : la conversation reste chez toi.`,
      h("div", { class: "reglage" }, h("strong", null, "En service"), h("p", { class: "mono" }, m.actif?.libelle || m.actif?.id || "—")),
      m.branche === false ? h("p", { class: "aide reglage" }, "Pas de modèle local branché sur la tour (REMY_GLM_URL).") : h("div", { class: "reglage" }, h("strong", null, "Choisir"), h("div", { style: { marginTop: "8px" } }, choix)));
  },

  async memoire() {
    const m = await api("/api/memory");
    const zone = h("textarea", { class: "champ", rows: 18, "aria-label": "Mémoire de Rémy", style: { fontFamily: "var(--mono)", fontSize: "13px" } });
    zone.value = m.text || "";
    const enregistrer = bouton("Enregistrer", { classe: "plein", onclick: (e) => occupe(e.currentTarget, async () => {
      try { await remplacer("/api/memory", { text: zone.value }); dire("Mémoire enregistrée.", { genre: "succes" }); } catch (err) { direErreur(err, null, "Mémoire pas enregistrée"); }
    }) });
    zone.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        enregistrer.click();
      }
    });
    return carte("Mémoire de Rémy", m.updatedAt ? `Mise à jour ${quand(m.updatedAt)}. Ce que Rémy sait de toi : corrige ce qui est faux.` : "Encore vide.",
      h("div", { class: "reglage" }, zone), h("div", { class: "rangee" }, enregistrer, h("span", { class: "aide" }, `${ctrl}+S`)));
  },

  async couts() {
    const c = await api("/api/costs");
    const t = c.totals || {};
    const euros = (v) => (typeof v === "number" ? `${v.toFixed(2).replace(".", ",")} $` : "—");
    const entrees = (c.entries || []).slice(0, 40);
    return carte("Coûts", "Chaque appel à un modèle est noté ici, avec son genre. Le modèle local ne coûte rien.",
      h("dl", { class: "paires reglage" },
        h("dt", null, "Aujourd'hui"), h("dd", null, euros(t.today)),
        h("dt", null, "7 jours"), h("dd", null, euros(t.days7)),
        h("dt", null, "30 jours"), h("dd", null, euros(t.days30))),
      entrees.length ? h("ul", { class: "liste" }, entrees.map((e) => h("li", { class: "ligne" }, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, e.label || e.kind), h("div", { class: "meta" }, h("span", { class: "mono" }, quand(e.ts)), h("span", null, e.kind), h("span", null, e.model || ""), e.local ? h("span", null, "local") : null)), h("span", { class: "mono" }, euros(e.usd))))) : vide(null, "Aucun appel noté."));
  },

  async appareils() {
    const { appareils } = await api("/api/appareils");
    return carte("Appareils connectés", "Les apps connectées par jeton (iPhone…). Déconnecter rend le jeton inutilisable tout de suite.",
      appareils?.length ? h("ul", { class: "liste" }, appareils.map((a) => h("li", { class: "ligne" }, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, a.nom, a.actuel ? " (celui-ci)" : ""), h("div", { class: "meta" }, a.vu_a ? `vu ${quand(a.vu_a)}` : a.cree_a ? `connecté ${quand(a.cree_a)}` : "")),
        bouton("Déconnecter", { classe: "danger petit", onclick: async (e) => {
          if (!(await confirmer(`Déconnecter « ${a.nom} » ?`, { detail: "Il devra retaper le mot de passe.", libelle: "Déconnecter", danger: true }))) return;
          await occupe(e.currentTarget, async () => { try { await supprimer(`/api/appareils/${seg(a.id)}`); dire("Déconnecté.", { genre: "succes" }); dessinerSection(); } catch (err) { direErreur(err); } });
        } })))) : vide(null, "Aucun appareil connecté par jeton."));
  },

  async jeton() {
    const j = await api("/api/capture/jeton");
    const zone = h("div", { class: "reglage" });
    const dessiner = (etat, nouveau) => vider(zone,
      nouveau ? [h("p", { class: "aide" }, "Copie-le maintenant : il ne sera plus jamais affiché."), h("p", { class: "mono", style: { overflowWrap: "anywhere", margin: "6px 0" } }, nouveau), bouton("Copier", { classe: "papier petit", icone: "copier", onclick: async () => { try { await navigator.clipboard.writeText(nouveau); dire("Copié.", { genre: "succes" }); } catch { dire("Copie impossible : sélectionne-le à la main.", { genre: "erreur" }); } } })]
        : h("p", null, etat ? "Un jeton existe (créé " + (etat.creeA ? quand(etat.creeA) : "plus tôt") + ")." : "Aucun jeton."),
      h("div", { class: "rangee", style: { marginTop: "10px" } },
        bouton(etat || nouveau ? "Remplacer le jeton" : "Créer un jeton", { classe: "plein", onclick: (e) => occupe(e.currentTarget, async () => {
          try { const r = await ecrire("/api/capture/jeton", {}); dessiner(true, r.jeton); } catch (err) { direErreur(err, null, "Jeton pas créé"); }
        }) }),
        etat || nouveau ? bouton("Supprimer", { classe: "danger", onclick: async (e) => {
          if (!(await confirmer("Supprimer le jeton de capture ?", { detail: "Le raccourci iPhone qui l'utilise ne marchera plus.", libelle: "Supprimer", danger: true }))) return;
          await occupe(e.currentTarget, async () => { try { await supprimer("/api/capture/jeton"); dessiner(null); } catch (err) { direErreur(err); } });
        } }) : null));
    dessiner(j.jeton);
    return carte("Jeton de capture", "Pour le raccourci « Envoyer à Rémy » de l'iPhone (feuille de partage, Siri) : il ne sert qu'à noter.", zone);
  },

  async agenda() {
    const g = await api("/api/google/status");
    return carte("Agenda Google", g.configure === false ? "Pas d'identifiants Google sur la tour (GOOGLE_CLIENT_ID / SECRET)." : g.connecte ? "Connecté : Rémy lit ton agenda et peut y écrire sur ton accord." : "Pas connecté.",
      g.configure !== false ? h("div", { class: "rangee reglage" },
        g.connecte
          ? [bouton("Tester", { classe: "papier", onclick: (e) => occupe(e.currentTarget, async () => { try { const r = await ecrire("/api/google/test", {}); dire(r?.message || "L'agenda répond.", { genre: "succes" }); } catch (err) { direErreur(err, null, "Test raté"); } }) }),
            bouton("Déconnecter", { classe: "danger", onclick: async (e) => {
              if (!(await confirmer("Déconnecter l'agenda Google ?", { libelle: "Déconnecter", danger: true }))) return;
              await occupe(e.currentTarget, async () => { try { await ecrire("/api/google/deconnexion", {}); dessinerSection(); } catch (err) { direErreur(err); } });
            } })]
          : bouton("Connecter l'agenda", { classe: "plein", onclick: (e) => occupe(e.currentTarget, async () => {
            try {
              const r = await ecrire("/api/google/auth", {});
              if (r?.url) {
                if (bureau.estBureau()) await bureau.ouvrirLien(r.url);
                else window.open(r.url, "_blank", "noopener");
                dire("Termine la connexion dans la fenêtre Google, puis reviens ici.");
              }
            } catch (err) { direErreur(err, null, "Connexion impossible"); }
          }) })) : null);
  },

  async activite() {
    const a = await api("/api/activite-pc");
    return carte("Activité du PC", "Le temps passé par application (ActivityWatch), relevé sur la tour : rien ne sort.",
      bascule("Relever l'activité du PC", a.coupeParLaTour ? "Coupé sur la tour." : a.activitywatch?.joignable === false ? "ActivityWatch ne répond pas." : `Gardé ${a.jours || 90} jours.`, a.actif, async (v) => { await remplacer("/api/activite-pc", { actif: v }); dire("Enregistré.", { genre: "succes" }); }, { desactive: a.coupeParLaTour }),
      a.aujourdhui?.total ? h("p", { class: "aide reglage" }, `Aujourd'hui : ${Math.round(a.aujourdhui.total / 60)} min relevées.`) : null,
      h("div", { class: "rangee reglage" }, bouton("Effacer l'historique", { classe: "danger", onclick: async (e) => {
        if (!(await confirmer("Effacer tout l'historique d'activité ?", { libelle: "Effacer", danger: true }))) return;
        await occupe(e.currentTarget, async () => { try { await supprimer("/api/activite-pc"); dire("Effacé.", { genre: "succes" }); dessinerSection(); } catch (err) { direErreur(err); } });
      } })));
  },

  async regles() {
    const { regles } = await api("/api/regles");
    return carte("Règles de Rémy", "« Avant un rendez-vous chez le kiné, prévoir… » : les règles que tu as validées dans le chat.",
      regles?.length ? h("ul", { class: "liste" }, regles.map((r) => h("li", { class: "ligne" },
        h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, r.texte || r.resume || r.nom || r.id), r.declencheur ? h("div", { class: "meta" }, r.declencheur) : null),
        (() => {
          const i = h("input", { type: "checkbox", role: "switch", "aria-label": "Active" });
          i.checked = r.actif !== false;
          i.addEventListener("change", async () => { try { await api(`/api/regles/${seg(r.id)}`, { methode: "PATCH", corps: { actif: i.checked } }); } catch (err) { i.checked = !i.checked; direErreur(err); } });
          return h("label", { class: "bascule" }, i);
        })(),
        bouton("", { classe: "texte icone", icone: "corbeille", etiquette: "Supprimer la règle", onclick: async (e) => {
          if (!(await confirmer("Supprimer cette règle ?", { libelle: "Supprimer", danger: true }))) return;
          await occupe(e.currentTarget, async () => { try { await supprimer(`/api/regles/${seg(r.id)}`); dessinerSection(); } catch (err) { direErreur(err); } });
        } })))) : vide(null, "Aucune règle pour l'instant. Rémy en propose dans le chat ; tu les valides."));
  },

  async file() {
    const l = fileEnvoi.liste();
    return carte("Envoi en attente", "Ce que tu as noté pendant que la tour ne répondait pas. Ça part tout seul ; tu peux forcer.",
      l.length ? [h("ul", { class: "liste" }, l.map((e) => h("li", { class: "ligne" },
        h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, e.resume || e.genre), h("div", { class: "meta" }, `noté ${quand(e.cree)}`, e.refus ? h("span", { class: "risque" }, icone("alerte"), `refusé : ${e.refus}`) : e.tentatives ? h("span", null, `${e.tentatives} essai${e.tentatives > 1 ? "s" : ""}`) : null)),
        bouton("Réessayer", { classe: "papier petit", onclick: (ev) => occupe(ev.currentTarget, async () => { const r = await fileEnvoi.reessayer(e.id); dire(r.envoyes.length ? "Envoyé." : "Toujours pas parti.", { genre: r.envoyes.length ? "succes" : "erreur" }); ctx.majCompteurs(); dessinerSection(); dessinerMaitre(); }) }),
        bouton("Retirer", { classe: "texte petit", onclick: async () => { if (await confirmer("Retirer cet envoi ?", { detail: "Il ne partira jamais.", libelle: "Retirer", danger: true })) { fileEnvoi.retirer(e.id); ctx.majCompteurs(); dessinerSection(); dessinerMaitre(); } } })))),
      h("div", { class: "rangee", style: { marginTop: "12px" } }, bouton("Tout envoyer maintenant", { classe: "plein", onclick: (ev) => occupe(ev.currentTarget, async () => { const r = await fileEnvoi.vider({ force: true }); dire(r.envoyes.length ? `${r.envoyes.length} envoyé${r.envoyes.length > 1 ? "s" : ""}.` : "Rien n'est parti : la tour répond-elle ?", { genre: r.envoyes.length ? "succes" : "erreur" }); ctx.majCompteurs(); dessinerSection(); dessinerMaitre(); }) }))]
        : vide(null, "Rien en attente : tout est parti."));
  },

  async diagnostic() {
    const [v, inc] = await Promise.all([api("/api/version"), api("/api/incidents").catch(() => ({ incidents: [] }))]);
    const incidents = inc.incidents || [];
    const texte = [`Rémy (site) · tour ${v.serveur || "?"}${v.commit ? ` (${String(v.commit).slice(0, 7)})` : ""} · API ${v.api}`, `Capacités : ${(v.capacites || []).length}`, `App Windows : ${bureau.estBureau() ? bureau.etatBureau()?.version || "oui" : "non"}`, `Navigateur : ${navigator.userAgent}`,
      ...incidents.slice(0, 10).map((i) => `${i.code || "?"} ${i.type || ""} ${i.route || ""} ${i.a || ""}`)].join("\n");
    return carte("Diagnostic", "De quoi décrire un souci, sans contenu personnel.",
      h("dl", { class: "paires reglage" }, h("dt", null, "Tour"), h("dd", null, `${v.serveur || "?"}${v.commit ? ` · ${String(v.commit).slice(0, 7)}` : ""}`), h("dt", null, "API"), h("dd", null, String(v.api)), h("dt", null, "Capacités"), h("dd", null, String((v.capacites || []).length)),
        h("dt", null, "App Windows"), h("dd", null, bureau.estBureau() ? bureau.etatBureau()?.version || "oui" : "non (navigateur)")),
      h("h3", { class: "titre-section", style: { marginTop: "14px" } }, "Incidents récents"),
      incidents.length ? h("ul", { class: "liste" }, incidents.slice(0, 15).map((i) => h("li", { class: "ligne" }, h("div", { class: "corps" }, h("div", { class: "titre-ligne mono" }, i.code || "?"), h("div", { class: "meta" }, [i.type, i.route, i.a ? quand(new Date(i.a).getTime()) : null].filter(Boolean).join(" · ")))))) : vide(null, "Aucun incident."),
      h("div", { class: "rangee", style: { marginTop: "12px" } }, bouton("Copier le diagnostic", { classe: "papier", icone: "copier", onclick: async () => { try { await navigator.clipboard.writeText(texte); dire("Diagnostic copié.", { genre: "succes" }); } catch { dire("Copie impossible ici.", { genre: "erreur" }); } } })));
  },

  async avance() {
    return carte("Avancé", null,
      h("div", { class: "reglage" }, h("strong", null, "Interface classique"), h("p", { class: "aide", style: { margin: "4px 0 8px" } }, "Le mode appel, l'onboarding guidé, l'import de conversations, la roadmap et la consigne de nuit y restent."), h("a", { class: "btn papier", href: "/classique.html" }, icone("externe"), "Ouvrir l'interface classique")),
      h("div", { class: "reglage" }, h("strong", null, "Session"), h("p", { class: "aide", style: { margin: "4px 0 8px" } }, "Sur cet ordinateur seulement."), bouton("Se déconnecter", { classe: "danger", onclick: async () => {
        if (!(await confirmer("Se déconnecter ?", { detail: "Il faudra retaper le mot de passe de la tour.", libelle: "Se déconnecter", danger: true }))) return;
        try { await ecrire("/api/logout", {}); } catch {}
        location.reload();
      } })));
  },
};

/** « Ctrl+Alt+Space » depuis un appui de touches (format des raccourcis globaux). */
export function combinaison(e) {
  const mods = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  const code = e.code || "";
  let touche = null;
  if (/^Key[A-Z]$/.test(code)) touche = code.slice(3);
  else if (/^Digit\d$/.test(code)) touche = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) touche = code;
  else if (code === "Space") touche = "Space";
  else if (["Enter", "Backspace", "Insert", "Home", "End", "PageUp", "PageDown"].includes(code)) touche = code;
  if (!touche || !mods.some((m) => m !== "Shift")) return null;
  return [...mods, touche].join("+");
}
