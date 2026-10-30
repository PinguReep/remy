// Le tri des rappels (OnboardingRappels de l'iPhone, Sam, 18/10 : il note
// dans la journée ce qu'il faut caser — sans date ou sans catégorie, un
// rappel attend). La première fois, les catégories d'abord (des exemples à
// garder, renommer, retirer, compléter). Puis, pour chaque rappel à traiter :
// une date et une heure, des catégories, et Garder / Tâche Motion / Rien.
// Le modèle local propose (à l'ouverture voulue par Sam, journalisé par la
// tour) ; rien n'est écrit, converti ni retiré avant « Valider ».
import { api, ecrire, remplacer, supprimer, nouvelId, seg, sait } from "../api.js";
import { h, vider, icone, bouton, dire, direErreur, feuille, versChampDate, depuisChampDate, occupe, squelette, blocErreur, isoLocal, confirmer, texteErreur } from "../ui.js";
import * as C from "../analyse/carnet.js";
import { retenirEtiquettes } from "./rappels.js";

// L'étiquette devinée par les mots (contrat E, module du lot « noter ») :
// lue à l'ouverture ; absente, pas de suggestion. Le chemin passe par une
// variable : le module n'existe pas forcément encore à côté de celui-ci.
const DEVINER = "../analyse/etiquettes.js";
async function devineur() {
  try {
    const m = await import(DEVINER);
    return typeof m.etiquetteDevinee === "function" ? m.etiquetteDevinee : null;
  } catch {
    return null;
  }
}

/**
 * Ouvre le tri. `apres()` : relire l'écran derrière, à la fermeture, quand le
 * tri a écrit quelque chose (« Valider », ou les catégories de l'étape 1 puis
 * « Plus tard ») ; `surFermeture()` : appelée à la fermeture.
 */
export function ouvrirTri({ apres, surFermeture } = {}) {
  if (!sait("etiquettes-v1")) {
    dire("Ta tour n'a pas encore la mise à jour des catégories : le tri des rappels arrivera avec elle.");
    surFermeture?.();
    return null;
  }
  const corps = h("div", { class: "tri" }, squelette([0.5, 0.9, 0.7, 0.8]));
  const pied = h("div", { class: "tri-pied" });
  const analyse = new AbortController();
  let touche = false;
  let ecrit = false;
  const f = feuille({
    titre: "Rappels à traiter", large: true, classe: "tri-feuille", contenu: corps, pied: [pied],
    avantFermeture: (cause) => cause !== "fond" || !touche,
    surFermeture: () => {
      analyse.abort();
      if (ecrit) apres?.();
      surFermeture?.();
    },
  });
  // Ctrl+1…5 (une autre vue) sous la feuille : des choix pas encore validés ne
  // se perdent pas sans le demander. Confirmé, la touche repart vers main.js.
  f.el.addEventListener("keydown", async (e) => {
    if (!touche || e.shiftKey || !(e.ctrlKey || e.metaKey || e.altKey) || !/^[1-5]$/.test(e.key)) return;
    e.preventDefault();
    const touches = { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, bubbles: true };
    if (!(await confirmer("Quitter le tri ?", { detail: "Tes choix ne sont pas encore validés : ils seront perdus.", libelle: "Quitter sans valider", danger: true }))) return;
    if (!f.el.isConnected) return;
    touche = false;
    f.fermer();
    document.dispatchEvent(new KeyboardEvent("keydown", touches));
  });
  const titre = (t) => {
    f.el.querySelector(".feuille-tete h2").textContent = t;
    f.el.setAttribute("aria-label", t);
  };
  const plusTard = () => bouton("Plus tard", { classe: "papier", onclick: () => f.fermer() });

  let rappels = [];
  let etiquettes = [];
  let premiereFois = false;

  async function charger() {
    vider(corps, squelette([0.5, 0.9, 0.7, 0.8]));
    vider(pied, plusTard());
    try {
      const [r, e] = await Promise.all([api("/api/rappels", { delai: 20000 }), api("/api/etiquettes", { delai: 20000 })]);
      rappels = r?.rappels || [];
      etiquettes = e?.etiquettes || [];
      retenirEtiquettes(etiquettes);
    } catch (err) {
      vider(corps, blocErreur(err, charger));
      return;
    }
    if (!etiquettes.length) {
      premiereFois = true;
      etapeCategories();
    } else etapeRappels();
  }

  // --- Étape 1 : les catégories ---
  function etapeCategories() {
    titre("Tes catégories");
    const lignes = (etiquettes.length ? etiquettes.map((e) => ({ etiquette: e.id, nom: e.nom })) : C.CATEGORIES_PROPOSEES.map((nom) => ({ nom })))
      .map((l) => ({ ...l, cle: nouvelId(), idNouveau: l.etiquette ? null : nouvelId() }));
    const liste = h("ul", { class: "tri-categories", "aria-label": "Tes catégories" });
    const valider = bouton("", { classe: "plein", icone: "coche", onclick: (e) => occupe(e.currentTarget, envoyer) });
    const compter = () => {
      const n = lignes.filter((l) => l.nom.trim()).length;
      vider(valider, icone("coche"), h("span", { class: "lib" }, C.libelleValiderCategories(n)));
      valider.disabled = n === 0;
    };
    const dessinerLignes = () => {
      vider(liste, lignes.map((l) => {
        const champ = h("input", { class: "champ", type: "text", value: l.nom, maxlength: "40", "aria-label": "Nom de la catégorie" });
        champ.value = l.nom;
        champ.addEventListener("input", () => { l.nom = champ.value; touche = true; compter(); });
        return h("li", { class: "tri-categorie" }, champ,
          bouton("", { classe: "texte icone tri-retirer", icone: "moins", etiquette: `Retirer ${l.nom || "cette catégorie"}`, onclick: () => {
            lignes.splice(lignes.indexOf(l), 1);
            touche = true;
            dessinerLignes();
            compter();
            (liste.querySelector("input") || nouvelle).focus();
          } }));
      }));
    };
    const nouvelle = h("input", { class: "champ", type: "text", placeholder: "Ajouter une catégorie", "aria-label": "Ajouter une catégorie", maxlength: "40" });
    const ajouter = bouton("Ajouter", { classe: "papier", onclick: () => {
      const nom = nouvelle.value.trim();
      if (!nom) return nouvelle.focus();
      lignes.push({ cle: nouvelId(), idNouveau: nouvelId(), nom });
      nouvelle.value = "";
      ajouter.disabled = true;
      touche = true;
      dessinerLignes();
      compter();
      nouvelle.focus();
    } });
    ajouter.disabled = true;
    nouvelle.addEventListener("input", () => { ajouter.disabled = !nouvelle.value.trim(); });
    nouvelle.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ajouter.click(); } });

    async function envoyer() {
      const plan = C.planCategories(lignes, etiquettes);
      if (plan.supprimer.length || plan.ecrire.length) ecrit = true;
      for (const e of plan.ecrire) {
        const l = lignes.find((x) => x.idNouveau === e.id);
        if (l && l.ordre == null) l.ordre = e.ordre;
      }
      const echecs = [];
      for (const id of plan.supprimer) {
        try {
          await supprimer(`/api/etiquettes/${seg(id)}`);
        } catch (err) {
          if (err.nature === "auth") return;
          echecs.push(err);
        }
      }
      for (const e of plan.ecrire) {
        try {
          await remplacer(`/api/etiquettes/${seg(e.id)}`, { nom: e.nom, ordre: e.ordre });
        } catch (err) {
          if (err.nature === "auth") return;
          echecs.push(err);
        }
      }
      try {
        etiquettes = (await api("/api/etiquettes", { delai: 20000 }))?.etiquettes || [];
        retenirEtiquettes(etiquettes);
      } catch (err) {
        echecs.push(err);
      }
      if (echecs.length) {
        direErreur(echecs[0], () => occupe(valider, envoyer), "Catégories pas toutes enregistrées");
        return;
      }
      touche = false;
      etapeRappels();
    }

    dessinerLignes();
    compter();
    vider(corps,
      h("p", { class: "sur-titre" }, "Étape 1 sur 2"),
      liste,
      h("div", { class: "ajout-ligne" }, nouvelle, ajouter),
      h("p", { class: "aide tri-aide" }, C.PIED_CATEGORIES));
    vider(pied, plusTard(), valider);
    liste.querySelector("input")?.focus();
  }

  // --- Étape 2 : les rappels à traiter ---
  async function etapeRappels() {
    titre("Rappels à traiter");
    // Figés à l'ouverture : une ligne ne disparaît pas sous la souris dès qu'elle reçoit sa date.
    const aTrier = C.aTraiter(rappels, etiquettes);
    const deviner = await devineur();
    const choix = {};
    for (const r of aTrier) {
      const devinee = deviner ? deviner(r.texte, etiquettes) : null;
      choix[r.id] = { action: "garder", etiquettes: [...new Set([...(r.etiquettes || []), devinee].filter(Boolean))], quand: typeof r.quand === "number" ? r.quand : null };
    }
    const touchees = new Set();
    const etat = h("div", { class: "tri-etat", role: "status" });
    const liste = h("ul", { class: "tri-liste", "aria-label": "Rappels à traiter" });
    const lignes = new Map();

    const modifier = (id, f2, { surPlace = false } = {}) => {
      const c = { ...choix[id] };
      f2(c);
      // Toucher une date ou une catégorie, c'est vouloir ranger : « Rien » devient « Garder ».
      if (c.action === "rien") c.action = "garder";
      choix[id] = c;
      touchees.add(id);
      touche = true;
      if (!surPlace) return redessiner(id);
      // Le champ date se règle segment par segment (chaque flèche est un « change ») :
      // il reste en place, seuls Garder / Tâche Motion / Rien suivent.
      for (const b of lignes.get(id)?.querySelectorAll(".tri-actions [role=radio]") || []) b.setAttribute("aria-checked", String(b.dataset.focus === `action:${c.action}`));
    };
    const ligne = (r) => {
      const c = choix[r.id];
      const date = c.quand != null
        ? (() => {
            const champ = h("input", { class: "champ", type: "datetime-local", "aria-label": `Quand : ${r.texte}`, dataset: { focus: "date" } });
            champ.value = versChampDate(new Date(c.quand));
            champ.addEventListener("change", () => {
              const d = depuisChampDate(champ.value);
              if (d && !Number.isNaN(d.getTime())) modifier(r.id, (x) => { x.quand = d.getTime(); }, { surPlace: true });
            });
            const retirer = bouton("", { classe: "texte icone", icone: "fermer", etiquette: "Retirer la date", titre: "Retirer la date", onclick: () => modifier(r.id, (x) => { x.quand = null; }) });
            retirer.dataset.focus = "retirer-date";
            return h("div", { class: "tri-date" }, champ, retirer);
          })()
        : h("button", { type: "button", class: "btn texte tri-ajouter-date", dataset: { focus: "ajouter-date" }, onclick: () => modifier(r.id, (x) => { x.quand = C.parDefautTri().getTime(); }) },
            icone("agenda"), h("span", { class: "lib" }, "Ajouter une date et une heure"));
      const puces = h("div", { class: "rangee serree tri-puces", role: "group", "aria-label": "Catégories" },
        etiquettes.map((e) => {
          const actif = c.etiquettes.includes(e.id);
          return h("button", { type: "button", class: "puce", "aria-pressed": String(actif), dataset: { focus: `etiquette:${e.id}` }, onclick: () => modifier(r.id, (x) => {
            x.etiquettes = actif ? x.etiquettes.filter((y) => y !== e.id) : [...x.etiquettes, e.id];
          }) }, e.nom);
        }));
      const actions = h("div", { class: "tri-actions", role: "radiogroup", "aria-label": `Que faire de « ${r.texte} »` },
        [["garder", "Garder"], ["tache", "Tâche Motion"], ["rien", "Rien"]].map(([v, lib]) => h("button", {
          type: "button", role: "radio", "aria-checked": String(c.action === v), dataset: { focus: `action:${v}` }, onclick: () => {
            choix[r.id] = { ...choix[r.id], action: v };
            touchees.add(r.id);
            touche = true;
            redessiner(r.id, { focus: `action:${v}` });
          },
        }, lib)));
      return h("li", { class: "tri-ligne", dataset: { id: r.id } }, h("strong", { class: "tri-texte" }, r.texte), date, etiquettes.length ? puces : null, actions);
    };
    // Au clavier, le focus reste sur le même contrôle de la ligne redessinée (deux
    // catégories d'affilée, puis Tab vers la suite) ; « Ajouter une date » passe
    // au champ qui apparaît, « Retirer la date » au bouton qui revient.
    const SUIVANT = { "ajouter-date": "date", "retirer-date": "ajouter-date" };
    const redessiner = (id, { focus } = {}) => {
      const r = aTrier.find((x) => x.id === id);
      const avant = lignes.get(id);
      if (!r || !avant) return;
      const cle = focus || (avant.contains(document.activeElement) ? document.activeElement.dataset.focus : null);
      const neuve = ligne(r);
      lignes.set(id, neuve);
      avant.replaceWith(neuve);
      if (cle) (neuve.querySelector(`[data-focus="${CSS.escape(SUIVANT[cle] || cle)}"]`) || neuve.querySelector("[data-focus]"))?.focus();
    };
    for (const r of aTrier) lignes.set(r.id, ligne(r));
    vider(liste, [...lignes.values()]);

    const dessinerEtat = (e) => {
      if (!e) return vider(etat);
      if (e.attente) return vider(etat, h("span", { class: "tri-roue", "aria-hidden": "true" }), h("span", null, "Rémy propose un classement, sur tes machines…"));
      vider(etat, h("p", null, e.texte), e.reessayer ? bouton("Réessayer", { classe: "papier petit", icone: "rafraichir", onclick: () => analyser() }) : null);
    };
    async function analyser() {
      if (!aTrier.length) return;
      if (!sait("analyse-rappels-v1")) return dessinerEtat({ texte: "Rémy pourra proposer un classement après la mise à jour de ta tour ; d'ici là, choisis toi-même." });
      dessinerEtat({ attente: true });
      try {
        const r = await ecrire("/api/rappels/analyser", {}, { delai: 300000, signal: analyse.signal });
        const suite = C.appliquerPropositions(choix, r?.propositions, { touchees, ids: aTrier.map((x) => x.id) });
        for (const id of Object.keys(suite)) {
          if (suite[id] === choix[id]) continue;
          choix[id] = suite[id];
          redessiner(id);
        }
        dessinerEtat(null);
      } catch (err) {
        if (err.nature === "annule") return;
        if (err.nature === "auth") return dessinerEtat(null);
        dessinerEtat({ texte: `${texteErreur(err) || "Rémy n'a pas pu lire tes rappels."} Choisis toi-même ci-dessous.`, reessayer: true });
      }
    }

    const valider = bouton(`Valider (${aTrier.length})`, { classe: "plein", icone: "coche", onclick: (e) => occupe(e.currentTarget, appliquer) });
    async function appliquer() {
      const plan = C.planTri(aTrier, choix, etiquettes);
      if (plan.convertir.length && !(await confirmer("Convertir en tâches Motion ?", { detail: C.detailConversion(plan.convertir.length), libelle: "Convertir et valider" }))) return;
      ecrit = true;
      // Les rangés (date et catégories), par écritures que la tour prend en entier.
      // Un refus : la suite ne part pas (ni les tâches Motion), le bandeau dit où on en est.
      let ranges = 0;
      for (const envoi of C.ecrituresTri(plan.ranges)) {
        try {
          const rep = await ecrire("/api/rappels", envoi);
          ranges += typeof rep?.nombre === "number" ? rep.nombre : envoi.rappels.length;
        } catch (err) {
          direErreur(err, () => occupe(valider, appliquer), C.prefixeRefusTri(ranges, plan.ranges.length));
          return;
        }
      }
      // Les tâches Motion : par lots de 6 ; le rappel d'une tâche créée (ou déjà là) est retiré.
      let convertis = null;
      const echecs = [];
      if (plan.convertir.length) {
        convertis = 0;
        const retires = [];
        for (const lot of C.lots(plan.convertir, 6)) {
          try {
            const rep = await ecrire("/api/motion/apply", { actions: lot.map((r) => C.actionTache(r, isoLocal)), resume: "Rappel devenu tâche", origine: "capture", idCommande: nouvelId() }, { delai: 150000 });
            C.etatsLot(rep, lot.length).forEach((x, k) => {
              if (x.etat === "echec") echecs.push(`« ${lot[k].texte} » : ${x.erreur}`);
              else {
                if (x.etat === "fait") convertis++;
                retires.push(lot[k]);
              }
            });
          } catch (err) {
            for (const r of lot) echecs.push(`« ${r.texte} » : ${texteErreur(err).replace(/\.$/, "")}`);
          }
        }
        for (const r of retires) {
          try {
            await supprimer(`/api/rappels/${seg(r.id)}`);
          } catch (err) {
            echecs.push(`« ${r.texte} » est dans Motion, mais le rappel reste (${texteErreur(err).replace(/\.$/, "")})`);
          }
        }
      }
      let restent = 0;
      try {
        const [r, e] = await Promise.all([api("/api/rappels", { delai: 20000 }), api("/api/etiquettes", { delai: 20000 })]);
        restent = C.aTraiter(r?.rappels || [], e?.etiquettes || []).length;
      } catch {
        restent = 0;
      }
      touche = false;
      // La fermeture relit l'écran derrière (`apres`) ; déjà fermée (« Réessayer » après « Plus tard ») : on relit ici.
      if (f.el.isConnected) f.fermer();
      else apres?.();
      dire(C.phraseBilanTri({ ranges, convertis, echecs, restent }), { genre: echecs.length ? "erreur" : "succes", duree: echecs.length ? 12000 : 6000 });
    }

    vider(corps,
      premiereFois ? h("p", { class: "sur-titre" }, "Étape 2 sur 2") : null,
      etat,
      aTrier.length ? liste : h("p", { class: "vide" }, "Rien à traiter : chaque rappel a une date et une catégorie."),
      aTrier.length ? h("p", { class: "aide tri-aide" }, C.PIED_TRI) : null);
    vider(pied, plusTard(), aTrier.length ? valider : bouton("Fermer", { classe: "papier", onclick: () => f.fermer() }));
    (liste.querySelector("button, input") || pied.querySelector("button"))?.focus();
    analyser();
  }

  charger();
  return f;
}
