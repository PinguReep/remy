// Projets et carnet, en maître-détail : projets Motion et leurs sous-dossiers,
// dossiers de Remy, Idées, listes, rappels, catégories, historique. Tout
// s'écrit avec des identifiants fixés ici : un geste rejoué n'est pas doublé.
import { api, ecrire, remplacer, supprimer, nouvelId, seg, sait } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, squelette, blocErreur, vide, confirmer, demanderTexte, quand, duree, versChampDate, depuisChampDate, occupe, feuille } from "../ui.js";
import { couleurProjet } from "../couleurs.js";
import { extraire } from "../analyse/dates.js";
import { gerer, terminer } from "./gerer.js";

let racine;
let ctx;
let donnees = { projets: null, dossiers: null, listes: null, rappels: null, etiquettes: null };
let selection = null; // { type, id }
let filtre = "";
let refs = {};

export default {
  async monter(el, args, contexte) {
    racine = el;
    ctx = contexte;
    selection = lireSelection(args);
    refs.recherche = h("input", { class: "champ", type: "search", placeholder: "Chercher", "aria-label": "Chercher un projet, une liste…", oninput: (e) => { filtre = e.target.value; dessinerMaitre(); } });
    refs.maitre = h("nav", { class: "maitre", "aria-label": "Projets et carnet" }, squelette([0.7, 0.5, 0.8, 0.6]));
    refs.detail = h("section", { class: "detail" });
    refs.grille = h("div", { class: "maitre-detail" }, h("div", null, h("div", { class: "recherche-champ", style: { marginBottom: "12px" } }, icone("recherche"), refs.recherche, h("span", { class: "kbd" }, "/")), refs.maitre), refs.detail);
    vider(el,
      h("header", { class: "entete-ecran" },
        h("div", { class: "titres" }, h("div", { class: "sur-titre" }, "Carnet"), h("h1", { class: "titre-ecran" }, "Projets")),
        h("div", { class: "actions-entete" },
          bouton("Nouvelle liste", { classe: "papier", icone: "liste", onclick: nouvelleListe }),
          bouton("Nouveau dossier", { classe: "papier", icone: "dossier", onclick: () => nouveauDossier(null) }),
          bouton("Noter", { classe: "plein", icone: "plus", kbd: "N", onclick: () => ctx.noter() }))),
      refs.grille);
    await charger();
  },
  suivre(args) {
    selection = lireSelection(args);
    dessinerMaitre();
    dessinerDetail();
  },
  chercher() {
    refs.recherche?.focus();
  },
  actualiser() {
    charger({ discret: true });
  },
};

function lireSelection(args) {
  if (!args?.length) return null;
  return { type: args[0], id: args[1] ? decodeURIComponent(args[1]) : null };
}
const aller = (type, id) => ctx.aller(`projets/${type}${id ? `/${encodeURIComponent(id)}` : ""}`);

async function charger({ discret = false } = {}) {
  const [p, d, l, r, e] = await Promise.allSettled([api("/api/projets"), api("/api/dossiers"), api("/api/listes"), api("/api/rappels"), api("/api/etiquettes")]);
  const erreurs = [p, d, l, r].filter((x) => x.status === "rejected").map((x) => x.reason);
  if (p.status === "fulfilled") donnees.projets = p.value;
  if (d.status === "fulfilled") donnees.dossiers = d.value.dossiers || [];
  if (l.status === "fulfilled") donnees.listes = l.value.listes || [];
  if (r.status === "fulfilled") donnees.rappels = r.value.rappels || [];
  if (e.status === "fulfilled") donnees.etiquettes = e.value.etiquettes || [];
  if (erreurs.length === 4) {
    vider(refs.maitre, blocErreur(erreurs[0], () => charger()));
    vider(refs.detail);
    return;
  }
  if (erreurs.length && !discret) direErreur(erreurs[0], () => charger(), "Une partie du carnet n'a pas pu être lue");
  dessinerMaitre();
  dessinerDetail();
}
const recharger = () => charger({ discret: true });

// --- Le maître ---
function element(type, id, texte, n, { sous = false, icone: ic, couleur } = {}) {
  const courant = selection?.type === type && (selection.id || null) === (id || null);
  return h("a", { class: `element-maitre${sous ? " sous" : ""}`, href: `#/projets/${type}${id ? `/${encodeURIComponent(id)}` : ""}`, "aria-current": courant ? "page" : null },
    couleur ? h("span", { class: "puce", style: { padding: 0, minHeight: 0, background: "none" } }, h("span", { class: "point", style: { background: couleur } })) : ic ? icone(ic) : null,
    h("span", { class: "t" }, texte), n != null ? h("span", { class: "n" }, String(n)) : null);
}

function dessinerMaitre() {
  const f = filtre.trim().toLowerCase();
  const ok = (t) => !f || String(t).toLowerCase().includes(f);
  const projets = donnees.projets?.projets || [];
  const dossiers = donnees.dossiers || [];
  const enfants = (parent) => dossiers.filter((d) => d.parent === parent && d.id !== "idees");
  const arbre = (parent, niveau = 0) => enfants(parent).flatMap((d) => [ok(d.nom) ? element("dossier", d.id, d.nom, d.notes?.length || null, { sous: niveau > 0, icone: "dossier" }) : null, ...arbre(d.id, niveau + 1)]);
  const groupes = [];
  if (donnees.projets?.motion !== false) {
    groupes.push(h("div", { class: "groupe" }, h("h2", { class: "titre-section" }, "Projets Motion"),
      projets.length ? projets.flatMap((p) => [ok(p.nom) ? element("motion", p.id, p.nom, p.taches, { couleur: couleurProjet(p.nom) }) : null, ...arbre(`motion:${p.id}`, 1)])
        : h("p", { class: "aide" }, donnees.projets ? "Aucun projet dans Motion." : "…")));
  }
  const idees = dossiers.find((d) => d.id === "idees");
  groupes.push(h("div", { class: "groupe" }, h("h2", { class: "titre-section" }, "Dossiers"),
    ok("Idées") ? element("dossier", "idees", idees?.nom || "Idées", idees?.notes?.filter((n) => !n.fait).length || null, { icone: "ampoule" }) : null,
    arbre(null)));
  groupes.push(h("div", { class: "groupe" }, h("h2", { class: "titre-section" }, "Listes"),
    (donnees.listes || []).filter((l) => ok(l.nom)).map((l) => element("liste", l.id, l.nom, l.elements?.filter((e) => !e.fait).length || null, { icone: "liste" })),
    donnees.listes && !donnees.listes.length ? h("p", { class: "aide" }, "Pas encore de liste.") : null));
  const rappelsActifs = (donnees.rappels || []).filter((r) => !r.fait).length;
  groupes.push(h("div", { class: "groupe" }, h("h2", { class: "titre-section" }, "Carnet"),
    ok("Rappels") ? element("rappels", null, "Rappels", rappelsActifs || null, { icone: "cloche" }) : null,
    ok("Catégories") ? element("categories", null, "Catégories", donnees.etiquettes?.length || null, { icone: "curseurs" }) : null,
    ok("Historique") ? element("historique", null, "Historique", null, { icone: "horloge" }) : null,
    // Comme sur l'iPhone (Projets › Conversations) ; sur le téléphone, les
    // onglets du bas n'ont pas la place d'une sixième entrée.
    sait("conversations-externes-v1") && ok("Conversations") ? h("a", { class: "element-maitre", href: "#/conversations" }, icone("conversations"), h("span", { class: "t" }, "Conversations"), h("span", { class: "n" }, "Claude, T3, ChatGPT")) : null));
  vider(refs.maitre, groupes);
  refs.grille.classList.toggle("detail-ouvert", Boolean(selection));
}

// --- Le détail ---
function retourMobile() {
  return h("a", { class: "btn texte petit lien-retour-projets", href: "#/projets" }, icone("retour"), "Projets");
}

function dessinerDetail() {
  if (!refs.detail) return;
  if (!selection) {
    vider(refs.detail, h("section", { class: "carte" }, vide("Choisis à gauche", "Un projet, un dossier, une liste ou tes rappels. N pour noter quelque chose n'importe où.")));
    return;
  }
  const { type, id } = selection;
  try {
    if (type === "motion") return detailMotion(id);
    if (type === "dossier") return detailDossier(id);
    if (type === "liste") return detailListe(id);
    if (type === "rappels") return detailRappels();
    if (type === "categories") return detailCategories();
    if (type === "historique") return detailHistorique();
  } catch (err) {
    console.error(err);
    vider(refs.detail, h("section", { class: "carte" }, blocErreur(err, recharger)));
    return;
  }
  vider(refs.detail, h("section", { class: "carte" }, vide("Introuvable", "Cet élément n'existe plus.")));
}

function carteDetail(surTitre, titre, actions, ...contenu) {
  return h("section", { class: "carte" }, retourMobile(),
    h("div", { class: "entete-ecran", style: { marginBottom: "12px" } },
      h("div", { class: "titres" }, surTitre ? h("div", { class: "sur-titre" }, surTitre) : null, h("h2", { class: "titre-ecran", style: { fontSize: "28px" } }, titre)),
      actions ? h("div", { class: "actions-entete" }, actions) : null),
    ...contenu);
}

// Projet Motion : ses tâches et ses sous-dossiers.
function detailMotion(id) {
  const p = donnees.projets?.projets?.find((x) => x.id === id);
  if (!donnees.projets) return vider(refs.detail, h("section", { class: "carte" }, squelette()));
  if (!p) return vider(refs.detail, h("section", { class: "carte" }, vide("Projet introuvable", "Il a peut-être été archivé dans Motion.")));
  const sous = (donnees.dossiers || []).filter((d) => d.parent === `motion:${p.id}`);
  const taches = (p.liste || []).map((t) => ligneTacheMotion(t, p.nom));
  vider(refs.detail, carteDetail("Projet Motion", p.nom, [bouton("Sous-dossier", { classe: "papier petit", icone: "plus", onclick: () => nouveauDossier(`motion:${p.id}`) })],
    h("p", { class: "aide" }, `${p.taches} tâche${p.taches > 1 ? "s" : ""}${p.enRetard ? ` · ${p.enRetard} en retard` : ""}${p.statut ? ` · ${p.statut}` : ""}`),
    h("h3", { class: "titre-section", style: { marginTop: "16px" } }, "Tâches"),
    taches.length ? h("ul", { class: "liste" }, taches) : vide(null, "Aucune tâche ouverte."),
    sous.length ? [h("h3", { class: "titre-section", style: { marginTop: "16px" } }, "Sous-dossiers"), h("ul", { class: "liste" }, sous.map((d) => h("li", { class: "ligne cliquable", onclick: () => aller("dossier", d.id) }, icone("dossier"), h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, d.nom)), icone("chevron"))))] : null));
}

function ligneTacheMotion(t, projet) {
  const e = { type: "sans-creneau", id: t.id, titre: t.titre, echeance: t.echeance, duree: t.duree, priorite: t.priorite, projet, debut: null };
  const li = h("li", { class: "ligne ligne-tache", style: { "--couleur": couleurProjet(projet) } });
  const caseB = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": "false", "aria-label": `Terminer « ${t.titre} »` });
  caseB.addEventListener("click", () => terminer(e, { retirer: () => { li.hidden = true; }, remettre: () => { li.hidden = false; }, apres: () => setTimeout(recharger, 600) }));
  ajouterA(li, caseB,
    h("div", { class: "corps cliquable", role: "button", tabindex: "0", onclick: () => gerer(e, { apres: () => setTimeout(recharger, 600), contexte: ctx }), onkeydown: (ev) => { if (ev.key === "Enter") gerer(e, { apres: recharger, contexte: ctx }); } },
      h("div", { class: "titre-ligne" }, t.titre),
      h("div", { class: "meta" }, t.echeance ? h("span", { class: t.echeance < Date.now() ? "risque" : "" }, `échéance ${quand(t.echeance)}`) : null, t.duree ? h("span", null, duree(t.duree)) : null)));
  return li;
}

// Dossier (et Idées) : notes, tâches rangées, sous-dossiers.
function detailDossier(id) {
  if (!donnees.dossiers) return vider(refs.detail, h("section", { class: "carte" }, squelette()));
  let d = donnees.dossiers.find((x) => x.id === id);
  if (!d && id === "idees") d = { id: "idees", nom: "Idées", parent: null, notes: [], taches: [], absent: true };
  if (!d) return vider(refs.detail, h("section", { class: "carte" }, vide("Dossier introuvable", "Il a peut-être été supprimé.")));
  const sous = donnees.dossiers.filter((x) => x.parent === d.id);
  const champ = h("input", { class: "champ", type: "text", placeholder: d.id === "idees" ? "Une idée à garder…" : "Une note…", "aria-label": "Nouvelle note" });
  const ajouter = async () => {
    const texte = champ.value.trim();
    if (!texte) return champ.focus();
    try {
      if (d.absent) await remplacer("/api/dossiers/idees", { nom: "Idées", parent: null, ordre: -2 });
      await ecrire(`/api/dossiers/${seg(d.id)}/notes`, { notes: [{ id: nouvelId(), texte: texte.slice(0, 500), fait: false }] });
      champ.value = "";
      await recharger();
      refs.detail.querySelector("input.champ")?.focus();
    } catch (err) {
      direErreur(err, null, "Note pas ajoutée");
    }
  };
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ajouter(); } });
  const parentNom = d.parent?.startsWith("motion:") ? donnees.projets?.projets?.find((p) => `motion:${p.id}` === d.parent)?.nom : donnees.dossiers.find((x) => x.id === d.parent)?.nom;
  const notes = [...(d.notes || [])].sort((a, b) => Number(a.fait) - Number(b.fait));
  vider(refs.detail, carteDetail(d.id === "idees" ? "Rien n'est planifié" : parentNom ? `Dans « ${parentNom} »` : "Dossier", d.nom,
    d.id === "idees" ? null : [
      bouton("", { classe: "texte icone", icone: "plus", etiquette: "Sous-dossier", titre: "Sous-dossier", onclick: () => nouveauDossier(d.id) }),
      bouton("", { classe: "texte icone", icone: "crayon", etiquette: "Renommer", titre: "Renommer", onclick: () => renommerDossier(d) }),
      bouton("", { classe: "texte icone", icone: "corbeille", etiquette: "Supprimer le dossier", titre: "Supprimer le dossier", onclick: () => supprimerDossier(d) })],
    h("div", { class: "ajout-ligne" }, champ, bouton("Ajouter", { classe: "plein", onclick: (e) => occupe(e.currentTarget, ajouter) })),
    notes.length ? h("ul", { class: "liste", style: { marginTop: "12px" } }, notes.map((n) => ligneNote(d, n))) : vide(null, d.id === "idees" ? "Pas encore d'idée. Une pensée floue notée avec N arrive ici." : "Pas encore de note."),
    d.taches?.length ? [h("h3", { class: "titre-section", style: { marginTop: "16px" } }, "Tâches rangées ici"), h("p", { class: "aide" }, `${d.taches.length} tâche${d.taches.length > 1 ? "s" : ""} Motion rangée${d.taches.length > 1 ? "s" : ""} dans ce dossier.`)] : null,
    sous.length ? [h("h3", { class: "titre-section", style: { marginTop: "16px" } }, "Sous-dossiers"), h("ul", { class: "liste" }, sous.map((x) => h("li", { class: "ligne cliquable", onclick: () => aller("dossier", x.id) }, icone("dossier"), h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, x.nom)), icone("chevron"))))] : null));
}

function ligneNote(d, n) {
  const caseB = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": String(Boolean(n.fait)), "aria-label": n.fait ? `« ${n.texte} » : relue` : `Marquer « ${n.texte} » comme relue` });
  caseB.addEventListener("click", async () => {
    const fait = !n.fait;
    caseB.setAttribute("aria-checked", String(fait));
    try {
      await ecrire(`/api/dossiers/${seg(d.id)}/notes`, { notes: [{ id: n.id, texte: n.texte, fait }] });
      n.fait = fait;
      dessinerDetail();
    } catch (err) {
      caseB.setAttribute("aria-checked", String(n.fait));
      direErreur(err, null, "Pas enregistré");
    }
  });
  return h("li", { class: `ligne${n.fait ? " faite" : ""}` }, caseB, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, n.texte)),
    bouton("", { classe: "texte icone", icone: "corbeille", etiquette: `Supprimer « ${n.texte} »`, onclick: async (e) => {
      await occupe(e.currentTarget, async () => {
        try {
          await supprimer(`/api/dossiers/${seg(d.id)}/notes/${seg(n.id)}`);
          d.notes = d.notes.filter((x) => x.id !== n.id);
          dessinerDetail();
          dessinerMaitre();
          dire("Supprimée.", { action: { libelle: "Annuler", faire: async () => { await ecrire(`/api/dossiers/${seg(d.id)}/notes`, { notes: [n] }).catch(direErreur); recharger(); } } });
        } catch (err) {
          direErreur(err, null, "Pas supprimée");
        }
      });
    } }));
}

async function nouveauDossier(parent) {
  const nom = await demanderTexte("Nouveau dossier", { etiquette: "Nom", libelle: "Créer", placeholder: "Travaux cuisine" });
  if (!nom) return;
  const id = nouvelId();
  try {
    const freres = (donnees.dossiers || []).filter((d) => d.parent === parent);
    await remplacer(`/api/dossiers/${seg(id)}`, { nom: nom.slice(0, 120), parent, ordre: freres.length });
    dire(`Dossier « ${nom} » créé.`, { genre: "succes" });
    await recharger();
    aller("dossier", id);
  } catch (err) {
    direErreur(err, null, "Dossier pas créé");
  }
}
async function renommerDossier(d) {
  const nom = await demanderTexte("Renommer le dossier", { valeur: d.nom, libelle: "Renommer" });
  if (!nom || nom === d.nom) return;
  try {
    await remplacer(`/api/dossiers/${seg(d.id)}`, { nom: nom.slice(0, 120), parent: d.parent, ordre: d.ordre ?? 0 });
    await recharger();
    dire("Renommé.", { genre: "succes" });
  } catch (err) {
    direErreur(err, null, "Pas renommé");
  }
}
async function supprimerDossier(d) {
  if (!(await confirmer(`Supprimer « ${d.nom} » ?`, { detail: "Ses notes et sous-dossiers partent avec lui. Les tâches Motion ne sont pas touchées.", libelle: "Supprimer", danger: true }))) return;
  try {
    await supprimer(`/api/dossiers/${seg(d.id)}`);
    dire(`« ${d.nom} » supprimé.`, { genre: "succes", action: { libelle: "Annuler", faire: async () => { await remplacer(`/api/dossiers/${seg(d.id)}`, { nom: d.nom, parent: d.parent, ordre: d.ordre ?? 0 }).catch(direErreur); recharger(); } } });
    ctx.aller("projets");
    recharger();
  } catch (err) {
    direErreur(err, null, "Pas supprimé");
  }
}

// Liste : articles, cocher, ajouter, retirer les pris.
function detailListe(id) {
  if (!donnees.listes) return vider(refs.detail, h("section", { class: "carte" }, squelette()));
  const l = donnees.listes.find((x) => x.id === id);
  if (!l) return vider(refs.detail, h("section", { class: "carte" }, vide("Liste introuvable", "Elle a peut-être été supprimée.")));
  const champ = h("input", { class: "champ", type: "text", placeholder: "tomates, lait et œufs", "aria-label": "Ajouter des articles" });
  const ajouter = async () => {
    const brut = champ.value.trim();
    if (!brut) return champ.focus();
    const textes = brut.replace(/\s+et\s+(?=[^,]*$)/u, ",").split(",").map((x) => x.trim()).filter(Boolean);
    const base = (l.elements || []).length;
    try {
      await ecrire(`/api/listes/${seg(l.id)}/elements`, { elements: textes.map((t, i) => ({ id: nouvelId(), texte: t.slice(0, 200), fait: false, ordre: base + i })) });
      champ.value = "";
      await recharger();
      refs.detail.querySelector("input.champ")?.focus();
    } catch (err) {
      direErreur(err, null, "Pas ajouté");
    }
  };
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ajouter(); } });
  const elements = [...(l.elements || [])].sort((a, b) => Number(a.fait) - Number(b.fait) || (a.ordre ?? 0) - (b.ordre ?? 0));
  const pris = elements.filter((e) => e.fait);
  vider(refs.detail, carteDetail("Liste", l.nom, [
    pris.length ? bouton(`Retirer les pris (${pris.length})`, { classe: "papier petit", onclick: (e) => occupe(e.currentTarget, async () => {
      try {
        await ecrire(`/api/listes/${seg(l.id)}/retirer`, { ids: pris.map((x) => x.id) });
        dire(`${pris.length} article${pris.length > 1 ? "s" : ""} retiré${pris.length > 1 ? "s" : ""}.`, { genre: "succes" });
        recharger();
      } catch (err) { direErreur(err, null, "Pas retirés"); }
    }) }) : null,
    bouton("", { classe: "texte icone", icone: "crayon", etiquette: "Renommer la liste", titre: "Renommer", onclick: async () => {
      const nom = await demanderTexte("Renommer la liste", { valeur: l.nom, libelle: "Renommer" });
      if (!nom) return;
      try { await remplacer(`/api/listes/${seg(l.id)}`, { nom: nom.slice(0, 80), ordre: l.ordre ?? 0 }); recharger(); } catch (err) { direErreur(err, null, "Pas renommée"); }
    } }),
    bouton("", { classe: "texte icone", icone: "corbeille", etiquette: "Supprimer la liste", titre: "Supprimer", onclick: async () => {
      if (!(await confirmer(`Supprimer la liste « ${l.nom} » ?`, { detail: `${elements.length} article${elements.length > 1 ? "s" : ""}.`, libelle: "Supprimer", danger: true }))) return;
      try { await supprimer(`/api/listes/${seg(l.id)}`); dire("Liste supprimée.", { genre: "succes" }); ctx.aller("projets"); recharger(); } catch (err) { direErreur(err, null, "Pas supprimée"); }
    } })],
    h("div", { class: "ajout-ligne" }, champ, bouton("Ajouter", { classe: "plein", onclick: (e) => occupe(e.currentTarget, ajouter) })),
    elements.length ? h("ul", { class: "liste", style: { marginTop: "12px" } }, elements.map((e) => ligneArticle(l, e))) : vide(null, "Liste vide. Plusieurs articles d'un coup : « tomates, lait et œufs ».")));
}

function ligneArticle(l, e) {
  const caseB = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": String(Boolean(e.fait)), "aria-label": e.fait ? `« ${e.texte} » : pris` : `Prendre « ${e.texte} »` });
  caseB.addEventListener("click", async () => {
    const fait = !e.fait;
    caseB.setAttribute("aria-checked", String(fait));
    try {
      await remplacer(`/api/listes/${seg(l.id)}/elements/${seg(e.id)}`, { texte: e.texte, fait, ordre: e.ordre ?? 0 });
      e.fait = fait;
      dessinerDetail();
      dessinerMaitre();
    } catch (err) {
      caseB.setAttribute("aria-checked", String(e.fait));
      direErreur(err, null, "Pas coché");
    }
  });
  return h("li", { class: `ligne${e.fait ? " faite" : ""}` }, caseB, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, e.texte)),
    bouton("", { classe: "texte icone", icone: "corbeille", etiquette: `Supprimer « ${e.texte} »`, onclick: (ev) => occupe(ev.currentTarget, async () => {
      try {
        await supprimer(`/api/listes/${seg(l.id)}/elements/${seg(e.id)}`);
        l.elements = l.elements.filter((x) => x.id !== e.id);
        dessinerDetail();
        dessinerMaitre();
      } catch (err) { direErreur(err, null, "Pas supprimé"); }
    }) }));
}

async function nouvelleListe() {
  const nom = await demanderTexte("Nouvelle liste", { etiquette: "Nom", libelle: "Créer", placeholder: "Courses" });
  if (!nom) return;
  const id = nouvelId();
  try {
    await remplacer(`/api/listes/${seg(id)}`, { nom: nom.slice(0, 80), ordre: (donnees.listes || []).length });
    await recharger();
    aller("liste", id);
  } catch (err) {
    direErreur(err, null, "Liste pas créée");
  }
}

// Rappels : à venir, sans date, faits. Ajouter avec la date lue dans la phrase.
const CHOIX_REPORT = () => {
  const m = new Date();
  const a = (hh, mm, j) => new Date(m.getFullYear(), m.getMonth(), m.getDate() + j, hh, mm);
  const choix = [];
  const heure = new Date(Math.ceil((m.getTime() + 3600e3) / 900e3) * 900e3);
  choix.push(["Dans 1 h", heure]);
  if (m.getHours() < 18) choix.push(["Ce soir 19:00", a(19, 0, 0)]);
  choix.push(["Demain 9:00", a(9, 0, 1)]);
  const lundi = (1 - m.getDay() + 7) % 7 || 7;
  if (lundi > 1) choix.push(["Lundi 9:00", a(9, 0, lundi)]);
  return choix;
};

function detailRappels() {
  if (!donnees.rappels) return vider(refs.detail, h("section", { class: "carte" }, squelette()));
  const champ = h("input", { class: "champ", type: "text", placeholder: "Appeler le garage demain à 9h", "aria-label": "Nouveau rappel" });
  const lu = h("p", { class: "aide", style: { marginTop: "6px", minHeight: "20px" } });
  champ.addEventListener("input", () => {
    const d = extraire(champ.value.trim());
    lu.textContent = d ? `« ${d.reste || champ.value.trim()} », ${quand(d.quand.getTime())}` : champ.value.trim() ? "Sans date : il restera dans « Sans date »." : "";
  });
  const ajouter = async () => {
    const brut = champ.value.trim();
    if (!brut) return champ.focus();
    const d = extraire(brut);
    try {
      await ecrire("/api/rappels", { rappels: [{ id: nouvelId(), texte: (d?.reste || brut).slice(0, 300), quand: d ? d.quand.getTime() : null }] });
      champ.value = "";
      lu.textContent = "";
      dire(d ? `Rappel ${quand(d.quand.getTime())}.` : "Rappel ajouté, sans date.", { genre: "succes" });
      await recharger();
      refs.detail.querySelector("input.champ")?.focus();
    } catch (err) {
      direErreur(err, null, "Rappel pas ajouté");
    }
  };
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ajouter(); } });
  const tous = donnees.rappels;
  const avenir = tous.filter((r) => !r.fait && r.quand).sort((a, b) => a.quand - b.quand);
  const sansDate = tous.filter((r) => !r.fait && !r.quand);
  const faits = tous.filter((r) => r.fait).slice(0, 20);
  const section = (titre, rs, videTexte) => [h("h3", { class: "titre-section", style: { marginTop: "18px" } }, titre, rs.length ? h("span", { class: "compte" }, String(rs.length)) : null),
    rs.length ? h("ul", { class: "liste" }, rs.map(ligneRappel)) : h("p", { class: "aide" }, videTexte)];
  vider(refs.detail, carteDetail("Carnet", "Rappels", null,
    h("div", { class: "ajout-ligne" }, champ, bouton("Ajouter", { classe: "plein", onclick: (e) => occupe(e.currentTarget, ajouter) })), lu,
    section("À venir", avenir, "Rien de prévu."),
    section("Sans date", sansDate, "Aucun."),
    faits.length ? section("Faits", faits, "") : null));
}

function ligneRappel(r) {
  const passe = r.quand && r.quand < Date.now() && !r.fait;
  const caseB = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": String(Boolean(r.fait)), "aria-label": r.fait ? `« ${r.texte} » : fait` : `Marquer « ${r.texte} » comme fait` });
  caseB.addEventListener("click", () => ecrireRappel({ ...r, fait: !r.fait }, r.fait ? "Rouvert." : `« ${r.texte} » : fait.`, r));
  return h("li", { class: `ligne${r.fait ? " faite" : ""}` }, caseB,
    h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, r.texte),
      h("div", { class: "meta" }, r.quand ? h("span", { class: passe ? "risque" : "mono" }, passe ? icone("alerte") : null, quand(r.quand)) : null,
        (r.etiquettes || []).map((id) => h("span", { class: "puce" }, donnees.etiquettes?.find((e) => e.id === id)?.nom || id)))),
    !r.fait ? bouton("", { classe: "texte icone", icone: "horloge", etiquette: `Reporter « ${r.texte} »`, titre: "Reporter", onclick: () => reporter(r) }) : null,
    bouton("", { classe: "texte icone", icone: "corbeille", etiquette: `Supprimer « ${r.texte} »`, onclick: (e) => occupe(e.currentTarget, async () => {
      try {
        await supprimer(`/api/rappels/${seg(r.id)}`);
        dire("Rappel supprimé.", { action: { libelle: "Annuler", faire: () => ecrireRappel(r, "Rappel remis.") } });
        recharger();
      } catch (err) { direErreur(err, null, "Pas supprimé"); }
    }) }));
}

async function ecrireRappel(r, message, avant) {
  try {
    await ecrire("/api/rappels", { rappels: [{ id: r.id, texte: r.texte, quand: r.quand ?? null, fait: Boolean(r.fait), etiquettes: r.etiquettes || [] }] });
    dire(message, { genre: "succes", action: avant ? { libelle: "Annuler", faire: () => ecrireRappel(avant, "Annulé.") } : null });
    recharger();
  } catch (err) {
    direErreur(err, null, "Rappel pas enregistré");
  }
}

function reporter(r) {
  const champ = h("input", { class: "champ", type: "datetime-local", "aria-label": "Autre moment" });
  champ.value = versChampDate(new Date(r.quand && r.quand > Date.now() ? r.quand : Date.now() + 3600e3));
  let f;
  const choisir = (d) => {
    f.fermer();
    ecrireRappel({ ...r, quand: d.getTime() }, `« ${r.texte} » : ${quand(d.getTime())}.`, r);
  };
  f = feuille({
    titre: "Reporter", sousTitre: r.texte,
    contenu: h("div", null, h("div", { class: "rangee serree" }, CHOIX_REPORT().map(([lib, d]) => h("button", { type: "button", class: "puce", onclick: () => choisir(d) }, lib))),
      h("div", { class: "ajout-ligne" }, champ, bouton("OK", { classe: "plein", onclick: () => { const d = depuisChampDate(champ.value); if (d) choisir(d); } }))),
  });
}

// Catégories (étiquettes des tâches et des rappels).
function detailCategories() {
  if (!donnees.etiquettes) return vider(refs.detail, h("section", { class: "carte" }, squelette()));
  const champ = h("input", { class: "champ", type: "text", placeholder: "Voiture", "aria-label": "Nouvelle catégorie" });
  const ajouter = async () => {
    const nom = champ.value.trim();
    if (!nom) return champ.focus();
    try {
      await remplacer(`/api/etiquettes/${seg(nouvelId())}`, { nom: nom.slice(0, 40), ordre: donnees.etiquettes.length });
      champ.value = "";
      recharger();
    } catch (err) { direErreur(err, null, "Pas ajoutée"); }
  };
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ajouter(); } });
  vider(refs.detail, carteDetail("Carnet", "Catégories", null,
    h("p", { class: "aide" }, "Pour ranger tâches et rappels (Voiture, Santé…). Motion ne les connaît pas : Remy les garde."),
    h("div", { class: "ajout-ligne" }, champ, bouton("Ajouter", { classe: "plein", onclick: (e) => occupe(e.currentTarget, ajouter) })),
    donnees.etiquettes.length ? h("ul", { class: "liste", style: { marginTop: "12px" } }, donnees.etiquettes.map((et) => h("li", { class: "ligne" },
      h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, et.nom)),
      bouton("", { classe: "texte icone", icone: "crayon", etiquette: `Renommer « ${et.nom} »`, onclick: async () => {
        const nom = await demanderTexte("Renommer la catégorie", { valeur: et.nom, libelle: "Renommer" });
        if (!nom) return;
        try { await remplacer(`/api/etiquettes/${seg(et.id)}`, { nom: nom.slice(0, 40), ordre: et.ordre ?? 0 }); recharger(); } catch (err) { direErreur(err, null, "Pas renommée"); }
      } }),
      bouton("", { classe: "texte icone", icone: "corbeille", etiquette: `Supprimer « ${et.nom} »`, onclick: async () => {
        if (!(await confirmer(`Supprimer « ${et.nom} » ?`, { detail: "Les tâches et rappels la perdent ; ils restent.", libelle: "Supprimer", danger: true }))) return;
        try { await supprimer(`/api/etiquettes/${seg(et.id)}`); recharger(); } catch (err) { direErreur(err, null, "Pas supprimée"); }
      } })))) : vide(null, "Pas encore de catégorie.")));
}

// Historique : ce qui a été écrit (par toi ou par Rémy), annulable.
async function detailHistorique() {
  vider(refs.detail, carteDetail("Carnet", "Historique", null, squelette([0.8, 0.6, 0.7, 0.5])));
  try {
    const r = await api("/api/historique?limite=60");
    if (selection?.type !== "historique") return;
    const entrees = r.entrees || [];
    vider(refs.detail, carteDetail("Ce qui a été écrit dans Motion, l'agenda et le carnet", "Historique", null,
      entrees.length ? h("ul", { class: "liste" }, entrees.map((e) => h("li", { class: "ligne" },
        h("div", { class: "corps" },
          h("div", { class: "titre-ligne" }, (e.elements || []).map((x) => `${x.action} : ${x.objet}`).join(" · ") || e.resume),
          h("div", { class: "meta" }, h("span", { class: "mono" }, quand(e.ts)), h("span", null, e.origine || ""), e.annule ? h("span", null, "annulé") : null, e.etat === "echouee" ? h("span", { class: "risque" }, "échec") : null)),
        e.annulable && !e.annule ? bouton("Annuler", { classe: "papier petit", onclick: (ev) => occupe(ev.currentTarget, async () => {
          try {
            await ecrire(e.source === "agenda" ? "/api/google/undo" : "/api/motion/undo", { id: e.id });
            dire("Annulé.", { genre: "succes" });
            detailHistorique();
          } catch (err) { direErreur(err, null, "Pas annulé"); }
        }) }) : null))) : vide(null, "Rien d'écrit pour l'instant.")));
  } catch (err) {
    vider(refs.detail, h("section", { class: "carte" }, blocErreur(err, detailHistorique)));
  }
}
