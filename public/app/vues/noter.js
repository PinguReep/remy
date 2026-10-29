// « Noter » : la même capture que le « + » de l'iPhone. L'aperçu (genre
// deviné, échéance lue, titre propre) est calculé ICI, sans réseau ni IA
// (analyse/genre.js, port de l'iPhone) ; Sam corrige le genre d'un clic.
// Chaque capture a son identifiant : renvoyée après une coupure, elle n'est
// pas faite deux fois. Sans tour, elle attend dans la file d'envoi.
//   Tâche → Motion · Idée → dossier « Idées » · Liste → une liste du carnet
//   Rappel → rappels · Retenir → mémoire de Rémy (sur ton geste : le modèle)
//   Question → Rémy, la question préparée · Projet → un dossier de Remy
import { api, nouvelId, seg } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, feuille, quand, isoLocal, local, occupe, kbd } from "../ui.js";
import { apercu, GENRES, LIBELLES, MINIMUM_RETENIR, projet as lireProjet, plusieursIntentions } from "../analyse/genre.js";
import * as fileEnvoi from "../file-envoi.js";
import * as bureau from "../bureau.js";

export const CLE_PAR_DEFAUT = "remy-capture-par-defaut";
export const parDefaut = () => (local.lire(CLE_PAR_DEFAUT, "idee") === "tache" ? "tache" : "idee");
const CLE_LISTE = "remy-capture-liste";
const CLE_QUESTION = "remy-question";

// Ce que la tour sait déjà (listes, dossiers, projets), lu une fois par ouverture.
let connu = { listes: null, dossiers: null, projets: null };
async function lireConnu() {
  const [l, d, p] = await Promise.allSettled([api("/api/listes"), api("/api/dossiers"), api("/api/projets")]);
  connu = {
    listes: l.status === "fulfilled" ? l.value.listes || [] : connu.listes,
    dossiers: d.status === "fulfilled" ? d.value.dossiers || [] : connu.dossiers,
    projets: p.status === "fulfilled" ? p.value.projets || [] : connu.projets,
  };
  return connu;
}
const parents = () => [...(connu.dossiers || []).map((d) => d.nom), ...(connu.projets || []).map((p) => p.nom)];
function idParent(nom) {
  if (!nom) return null;
  const n = nom.toLowerCase();
  const d = (connu.dossiers || []).find((x) => x.nom.toLowerCase() === n);
  if (d) return d.id;
  const p = (connu.projets || []).find((x) => x.nom.toLowerCase() === n);
  return p ? `motion:${p.id}` : null;
}

const decrireDate = (a) => {
  const d = a.date;
  if (!d) return null;
  if (a.genre === "tache") {
    if (d.dejaPassee) return d.dejaPassee;
    return d.heureDite && !d.limite ? `à ${quand(d.quand.getTime())}` : `d'ici ${quand(d.echeance.getTime(), { avecHeure: d.heureDite })}`;
  }
  if (a.genre === "rappel") return d.dejaPassee || quand(d.quand.getTime());
  return null;
};

/** Les requêtes d'une capture (dans l'ordre) et de quoi la défaire. */
function preparer(a, texteBrut, id, liste) {
  const titre = (a.titre || texteBrut).slice(0, 500);
  switch (a.genre) {
    case "tache": {
      const action = { type: "creer", nom: titre.slice(0, 200) };
      if (a.date) action.echeance = isoLocal(a.date.echeance);
      return { resume: `Tâche « ${court(titre)} »`, requetes: [{ chemin: "/api/motion/apply", corps: { actions: [action], resume: "Noté depuis le site", origine: "capture", idCommande: id }, delai: 150000 }] };
    }
    case "idee": {
      const requetes = [];
      if (!(connu.dossiers || []).some((d) => d.id === "idees")) requetes.push({ chemin: "/api/dossiers/idees", methode: "PUT", corps: { nom: "Idées", parent: null, ordre: -2 }, siAbsent: "idees" });
      requetes.push({ chemin: "/api/dossiers/idees/notes", corps: { notes: [{ id, texte: titre, fait: false }] } });
      return { resume: `Idée « ${court(titre)} »`, requetes, defaire: { chemin: `/api/dossiers/idees/notes/${seg(id)}`, methode: "DELETE" } };
    }
    case "liste": {
      const articles = a.articles.length ? a.articles : [titre];
      const elements = articles.map((t, i) => ({ id: `${id}-${i}`, texte: t.slice(0, 200), fait: false }));
      const requetes = [];
      let lid = liste?.id;
      if (!lid) {
        lid = "l-courses";
        requetes.push({ chemin: `/api/listes/${lid}`, methode: "PUT", corps: { nom: "Courses", ordre: 0 } });
      }
      requetes.push({ chemin: `/api/listes/${seg(lid)}/elements`, corps: { elements } });
      return {
        resume: `${articles.length > 1 ? `${articles.length} articles` : `« ${court(articles[0])} »`} dans « ${liste?.nom || "Courses"} »`,
        requetes,
        defaire: elements.map((e) => ({ chemin: `/api/listes/${seg(lid)}/elements/${seg(e.id)}`, methode: "DELETE" })),
      };
    }
    case "rappel":
      return {
        resume: `Rappel « ${court(titre)} »${a.date ? `, ${quand(a.date.quand.getTime())}` : ""}`,
        requetes: [{ chemin: "/api/rappels", corps: { rappels: [{ id, texte: titre.slice(0, 300), quand: a.date ? a.date.quand.getTime() : null }] } }],
        defaire: { chemin: `/api/rappels/${seg(id)}`, methode: "DELETE" },
      };
    case "retenir":
      return { resume: "À retenir", requetes: [{ chemin: "/api/capture", corps: { texte: texteBrut, source: "note", idCapture: id }, delai: 95000 }] };
    case "projet": {
      const p = a.projet || lireProjet(texteBrut, parents());
      return {
        resume: `Dossier « ${court(p.titre)} »`,
        requetes: [{ chemin: `/api/dossiers/${seg(id)}`, methode: "PUT", corps: { nom: p.titre.slice(0, 120), parent: idParent(p.parent), ordre: 99 } }],
        defaire: { chemin: `/api/dossiers/${seg(id)}`, methode: "DELETE" },
      };
    }
    default:
      return null;
  }
}
const court = (t) => (t.length > 60 ? t.slice(0, 57) + "…" : t);

const envoyer = (prep) => fileEnvoi.envoyerElement(prep);

async function defaire(prep, ledgerId) {
  try {
    if (ledgerId) await api("/api/motion/undo", { methode: "POST", corps: { id: ledgerId } });
    else for (const r of [].concat(prep.defaire || [])) await api(r.chemin, { methode: r.methode });
    dire("Annulé : rien n'a été gardé.", { genre: "succes" });
  } catch (err) {
    direErreur(err, null, "Pas annulé");
  }
}

/**
 * Le formulaire de capture. `surEnvoye(genre)` après un envoi réussi (ou mis
 * en file). `compact` : sans l'aide du clavier. `id` : imposé (notes de secours).
 */
export function formulaireNoter({ texte = "", id: idImpose, compact = false, surEnvoye, extra, contexte, fenetre = false } = {}) {
  let id = idImpose || nouvelId();
  let genreChoisi = null;
  let listeChoisie = local.lire(CLE_LISTE, null);
  const zone = h("textarea", {
    class: "champ", rows: compact ? 2 : 4, "aria-label": "Ce que tu veux noter",
    placeholder: "Appeler le garage demain à 9h · tomates, lait, œufs · idée : …",
    autocomplete: "off", spellcheck: "true",
  });
  zone.value = texte;
  const vueApercu = h("div", { class: "apercu", "aria-live": "polite" });
  const envoyerBtn = bouton("Envoyer", { classe: "plein", icone: "envoyer", kbd: "Entrée", type: "submit" });
  const form = h("form", { class: "noter", onsubmit: (e) => { e.preventDefault(); soumettre(); } },
    zone, vueApercu,
    h("div", { class: "noter-pied" },
      compact ? h("span", { class: "aide" }) : h("span", { class: "aide" }, kbd("Entrée"), " envoie · ", kbd("Maj"), " ", kbd("Entrée"), " passe à la ligne · ", kbd("Échap"), " ferme"),
      extra || null, envoyerBtn));

  const dessiner = () => {
    const brut = zone.value;
    const a = apercu(brut, { parDefaut: parDefaut(), genre: genreChoisi, parents: parents() });
    vider(vueApercu);
    if (!brut.trim()) {
      ajouterA(vueApercu, h("p", { class: "aide" }, "Rémy devine où le ranger pendant que tu tapes : tâche, idée, liste, rappel, question…"));
      envoyerBtn.disabled = true;
      return;
    }
    envoyerBtn.disabled = false;
    ajouterA(vueApercu, h("div", { class: "genres", role: "radiogroup", "aria-label": "Genre" },
      GENRES.map((g) => h("button", {
        type: "button", class: "puce", role: "radio", "aria-checked": String(a.genre === g), "aria-pressed": String(a.genre === g),
        title: a.genre === g && a.devine ? "Deviné par Rémy : clique sur un autre genre pour corriger" : null,
        onclick: () => { genreChoisi = g; dessiner(); zone.focus(); },
      }, LIBELLES[g]))));
    const lu = h("div", { class: "lu" });
    const d = decrireDate(a);
    if (a.genre === "liste") {
      const listes = connu.listes || [];
      const sel = h("select", { class: "champ", style: { width: "auto", minHeight: "36px", padding: "4px 10px" }, "aria-label": "Dans quelle liste" },
        listes.length ? listes.map((l) => h("option", { value: l.id }, l.nom)) : h("option", { value: "" }, "Courses (nouvelle)"));
      if (listeChoisie && listes.some((l) => l.id === listeChoisie)) sel.value = listeChoisie;
      sel.addEventListener("change", () => { listeChoisie = sel.value; local.ecrire(CLE_LISTE, sel.value); });
      ajouterA(lu, h("span", { class: "titre-lu" }, a.articles.length > 1 ? `${a.articles.length} articles : ${a.articles.join(", ")}` : `« ${a.articles[0] || a.titre} »`), h("span", { class: "aide" }, "dans"), sel);
    } else if (a.genre === "projet") {
      const p = a.projet;
      ajouterA(lu, h("span", { class: "titre-lu" }, `Dossier « ${p.titre} »`), p.parent ? h("span", { class: "aide" }, `dans « ${p.parent} »`) : null);
    } else if (a.genre === "question") {
      ajouterA(lu, h("span", { class: "aide" }, "Rémy s'ouvre avec ta question, prête à partir."));
    } else if (a.genre === "retenir") {
      ajouterA(lu, h("span", { class: "aide" }, longueurOk(brut) ? "Rémy en garde l'essentiel dans sa mémoire (le modèle lit ce texte)." : `Trop court pour Retenir : ${MINIMUM_RETENIR} caractères au moins.`));
    } else {
      ajouterA(lu, h("span", { class: "titre-lu" }, a.titre), d ? h("span", { class: "quand" }, d) : null);
      if (a.genre === "idee") ajouterA(lu, h("span", { class: "aide" }, "Gardée dans Idées, rien n'est planifié."));
      if (a.genre === "tache" && !a.date) ajouterA(lu, h("span", { class: "aide" }, "Motion lui trouve un créneau."));
    }
    ajouterA(vueApercu, lu);
    if (a.date?.dejaPassee && a.genre !== "tache" && a.genre !== "rappel") ajouterA(vueApercu, h("p", { class: "avertissement" }, a.date.dejaPassee));
    if (plusieursIntentions(brut) && a.genre !== "retenir") {
      ajouterA(vueApercu, h("div", { class: "rangee" },
        h("span", { class: "aide" }, "Plusieurs choses d'un coup ?"),
        bouton("Rémy les range une à une", { classe: "papier petit", icone: "liste", onclick: () => rangerPlusieurs(brut, { contexte, surFini: () => { zone.value = ""; genreChoisi = null; dessiner(); surEnvoye?.("plusieurs"); } }) })));
    }
  };
  const longueurOk = (t) => t.trim().length >= MINIMUM_RETENIR;

  const soumettre = async () => {
    const brut = zone.value.trim();
    if (!brut) return zone.focus();
    const a = apercu(brut, { parDefaut: parDefaut(), genre: genreChoisi, parents: parents() });
    if (a.genre === "question") {
      local.ecrire(CLE_QUESTION, { texte: brut, a: Date.now() });
      zone.value = "";
      surEnvoye?.("question");
      if (fenetre && bureau.estBureau()) await bureau.invoke("bureau_ouvrir", { vue: "remy/nouvelle" }).catch(() => {});
      else contexte?.aller("remy/nouvelle");
      return;
    }
    if (a.genre === "retenir" && !longueurOk(brut)) {
      dire(`Trop court pour Retenir (${MINIMUM_RETENIR} caractères au moins) : choisis Idée ou Tâche.`, { genre: "erreur" });
      return;
    }
    const liste = (connu.listes || []).find((l) => l.id === listeChoisie) || (connu.listes || [])[0] || null;
    const prep = preparer(a, brut, id, liste);
    await occupe(envoyerBtn, async () => {
      try {
        const r = await envoyer(prep);
        if (r && r.ok === false && Array.isArray(r.results)) {
          const res = r.results.find((x) => !x.ok);
          if (res?.nature === "passager" || /quota|indisponible|429/i.test(res?.erreur || "")) throw Object.assign(new Error(res.erreur), { nature: "reseau" });
          dire(`Motion a refusé : ${res?.erreur || "raison inconnue"}. Ton texte est toujours là.`, { genre: "erreur" });
          return;
        }
        const phrase = a.genre === "retenir" ? (r?.phrase || "Rémy l'a lu et retenu l'essentiel.") : phraseFaite(a, prep);
        dire(phrase, { genre: "succes", action: prep.defaire || r?.ledgerId ? { libelle: "Annuler", faire: () => defaire(prep, r?.ledgerId) } : null });
        id = nouvelId();
        zone.value = "";
        genreChoisi = null;
        dessiner();
        surEnvoye?.(a.genre);
      } catch (err) {
        if (err.nature === "reseau" || err.nature === "delai") {
          // Les identifiants sont déjà fixés : la file renverra sans doubler.
          fileEnvoi.ajouter({ id, resume: prep.resume, genre: a.genre, requetes: prep.requetes });
          dire("La tour ne répond pas : c'est gardé ici et ça partira tout seul.", { genre: "info", detail: prep.resume });
          id = nouvelId();
          zone.value = "";
          genreChoisi = null;
          dessiner();
          contexte?.majCompteurs?.();
          surEnvoye?.(a.genre);
          return;
        }
        direErreur(err, () => soumettre(), "Pas envoyé");
      }
    });
  };

  zone.addEventListener("input", () => {
    if (!zone.value.trim()) genreChoisi = null;
    dessiner();
  });
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      soumettre();
    }
  });
  dessiner();
  lireConnu().then(dessiner).catch(() => {});
  form.focusChamp = () => {
    zone.focus();
    zone.setSelectionRange(zone.value.length, zone.value.length);
  };
  form.vider = () => {
    zone.value = "";
    genreChoisi = null;
    id = nouvelId();
    dessiner();
  };
  return form;
}

function phraseFaite(a, prep) {
  switch (a.genre) {
    case "tache": return a.date ? `Ajoutée à Motion : « ${court(a.titre)} », ${decrireDate(a)}.` : `Ajoutée à Motion : « ${court(a.titre)} ». Il lui trouve un créneau.`;
    case "idee": return "Gardée dans Idées (Projets) : rien n'est planifié.";
    case "liste": return `Ajouté : ${prep.resume}.`;
    case "rappel": return `${prep.resume}.`;
    case "projet": return `${prep.resume} créé (Projets).`;
    default: return "C'est noté.";
  }
}

/** La feuille « Noter » (N, le bouton du rail, le ＋ des onglets). */
export function ouvrirNoter({ texte = "", contexte } = {}) {
  if (document.querySelector("dialog.feuille-noter")) {
    document.querySelector("dialog.feuille-noter textarea")?.focus();
    return;
  }
  let f;
  const form = formulaireNoter({ texte, contexte, surEnvoye: (g) => { if (g === "question" || g === "plusieurs") f?.fermer(); else form.focusChamp(); } });
  f = feuille({ titre: "Noter", sousTitre: "Une tâche, une idée, une liste, un rappel… Rémy range.", contenu: form, classe: "feuille-noter", large: true });
  form.focusChamp();
}

/** La petite fenêtre « Noter » de l'app Windows (`?fenetre=noter`). */
export async function monterFenetre(racine, { contexte }) {
  racine.className = "";
  racine.removeAttribute("aria-busy");
  let dernierEnvoye = false;
  const form = formulaireNoter({
    compact: true, fenetre: true, contexte,
    surEnvoye: () => {
      dernierEnvoye = true;
      setTimeout(() => bureau.fermerNoter(), 700);
    },
  });
  vider(racine, h("div", { class: "fenetre-noter" },
    h("div", { class: "tete-noter" }, h("span", { class: "marque-r", "aria-hidden": "true", style: { width: "26px", height: "26px", fontSize: "15px", borderRadius: "8px" } }, "R"), h("h1", null, "Noter"),
      h("span", { class: "aide" }, kbd("Entrée"), " envoie · ", kbd("Échap"), " ferme")),
    form));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      bureau.fermerNoter();
    }
  });
  bureau.surNoterOuvert(() => {
    if (dernierEnvoye) form.vider();
    dernierEnvoye = false;
    form.focusChamp();
  });
  form.focusChamp();
}

/** La question préparée par « Noter » (genre Question), à reprendre dans Rémy. */
export function questionEnAttente() {
  const q = local.lire(CLE_QUESTION, null);
  if (!q || Date.now() - q.a > 10 * 60e3) return null;
  local.effacer(CLE_QUESTION);
  return q.texte;
}

// --- Plusieurs intentions : Rémy (le modèle local) les sépare, Sam valide ---
const DESTINATIONS = {
  tache: (e) => `Tâche Motion${e.quand ? `, avant ${quand(e.quand, { avecHeure: e.heureConnue })}` : ""}`,
  rappel: (e) => `Rappel${e.quand ? ` ${quand(e.quand, { avecHeure: e.heureConnue })}` : ", sans date"}`,
  contrainte: (e) => `Rappel${e.quand ? ` ${quand(e.quand, { avecHeure: false })}` : ""} (pas de créneau bloqué)`,
  liste: (e) => `Liste « ${e.liste || "Courses"} »${e.articles?.length > 1 ? ` · ${e.articles.length} articles` : ""}`,
  note: () => "Idées (Projets)",
  "rendez-vous": (e) => (e.quand && e.heureConnue ? `Rappel ${quand(e.quand)}` : "Rendez-vous : heure manquante"),
  projet: (e) => `Nouveau dossier${e.parent ? ` dans « ${e.parent} »` : ""}`,
};

async function rangerPlusieurs(texte, { contexte, surFini }) {
  const contenu = h("div", null, h("p", { class: "aide" }, "Le modèle local de la tour sépare ce que tu as dit. Rien ne part avant ton accord."), h("div", { class: "squelette" }, h("span"), h("span"), h("span")));
  const valider = bouton("Ranger", { classe: "plein", icone: "coche" });
  valider.disabled = true;
  const f = feuille({ titre: "Ranger une à une", sousTitre: court(texte), large: true, contenu, pied: [bouton("Annuler", { classe: "papier", onclick: () => f.fermer() }), valider] });
  let elements;
  try {
    await lireConnu();
    elements = (await api("/api/capture/analyser", { methode: "POST", corps: { texte }, delai: 100000 })).elements || [];
  } catch (err) {
    vider(contenu, h("p", { class: "erreur-champ" }, err.message), h("p", { class: "aide" }, "Tu peux fermer et noter chaque chose séparément."));
    return;
  }
  if (!elements.length) {
    vider(contenu, h("p", null, "Rémy n'a rien trouvé à ranger dans ce texte."));
    return;
  }
  const coches = new Set(elements.map((e) => e.cle));
  vider(contenu, h("ul", { class: "liste" }, elements.map((e) => {
    const c = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": "true", "aria-label": `Ranger « ${e.titre} »` });
    c.addEventListener("click", () => {
      const v = c.getAttribute("aria-checked") !== "true";
      c.setAttribute("aria-checked", String(v));
      if (v) coches.add(e.cle);
      else coches.delete(e.cle);
      valider.disabled = !coches.size;
    });
    return h("li", { class: "ligne" }, c, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, e.titre),
      h("div", { class: "meta" }, (DESTINATIONS[e.nature] || (() => e.nature))(e), e.question ? h("span", { class: "risque" }, icone("alerte"), e.question) : null)));
  })));
  valider.disabled = false;
  valider.addEventListener("click", () => occupe(valider, async () => {
    const faits = [];
    const rates = [];
    for (const e of elements.filter((x) => coches.has(x.cle))) {
      try {
        await rangerElement(e);
        faits.push(e.titre);
      } catch (err) {
        rates.push(`${court(e.titre)} (${err.message})`);
      }
    }
    if (rates.length) dire(`${faits.length} rangé${faits.length > 1 ? "s" : ""} ; pas fait : ${rates.join(" ; ")}.`, { genre: "erreur" });
    else dire(faits.length === 1 ? `Rangé : ${faits[0]}.` : `${faits.length} éléments rangés.`, { genre: "succes" });
    f.fermer();
    surFini?.();
    contexte?.majCompteurs?.();
  }));
}

async function rangerElement(e) {
  const id = nouvelId();
  const iso = e.quand ? isoLocal(new Date(e.quand)) : undefined;
  switch (e.nature) {
    case "tache": {
      const action = { type: "creer", nom: e.titre.slice(0, 200) };
      if (iso) action.echeance = iso;
      if (e.dureeMin) action.duree = e.dureeMin;
      if (e.etiquettes?.length) action.etiquettes = e.etiquettes;
      const r = await api("/api/motion/apply", { methode: "POST", corps: { actions: [action], resume: "Rangé depuis le site", origine: "capture", idCommande: id }, delai: 150000 });
      if (r?.ok === false) throw new Error(r.results?.find((x) => !x.ok)?.erreur || "refusée par Motion");
      return;
    }
    case "rappel": case "contrainte": case "rendez-vous":
      await api("/api/rappels", { methode: "POST", corps: { rappels: [{ id, texte: e.titre.slice(0, 300), quand: e.quand ?? null, etiquettes: e.etiquettes || [] }] } });
      return;
    case "liste": {
      const nom = e.liste || "Courses";
      let l = (connu.listes || []).find((x) => x.nom.toLowerCase() === nom.toLowerCase());
      if (!l) {
        l = { id: nouvelId(), nom };
        await api(`/api/listes/${seg(l.id)}`, { methode: "PUT", corps: { nom, ordre: (connu.listes || []).length } });
        connu.listes = [...(connu.listes || []), l];
      }
      await api(`/api/listes/${seg(l.id)}/elements`, { methode: "POST", corps: { elements: (e.articles?.length ? e.articles : [e.titre]).map((t, i) => ({ id: `${id}-${i}`, texte: t, fait: false })) } });
      return;
    }
    case "note":
      if (!(connu.dossiers || []).some((d) => d.id === "idees")) await api("/api/dossiers/idees", { methode: "PUT", corps: { nom: "Idées", parent: null, ordre: -2 } });
      await api("/api/dossiers/idees/notes", { methode: "POST", corps: { notes: [{ id, texte: e.titre.slice(0, 500), fait: false }] } });
      return;
    case "projet":
      await api(`/api/dossiers/${seg(id)}`, { methode: "PUT", corps: { nom: e.titre.slice(0, 120), parent: idParent(e.parent), ordre: 99 } });
      return;
    default:
      throw new Error("genre inconnu");
  }
}
