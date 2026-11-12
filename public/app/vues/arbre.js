// L'arbre des projets à l'écran (arbre-v1) et le verrou de « Ce que Rémy a
// compris » (verrou-v1) : les morceaux partagés par Projets, Rémy et Réglages.
// La logique sans écran est dans ../analyse/arbre.js (testée sous node).
//
// Rémy remplit, Sam confirme ou corrige : une fiche n'est jamais un
// formulaire vide à remplir. Chaque champ dit d'où il vient.
import { api, ecrire, remplacer, supprimer, seg, sait } from "../api.js";
import { h, icone, bouton, dire, direErreur, texteErreur, demanderTexte, feuille, occupe, squelette, vider } from "../ui.js";
import { ouvrirMenu } from "../menu.js";
import * as A from "../analyse/arbre.js";

// --- Lecture de l'arbre (GET /api/noeuds), gardée 30 s ---

let cache = null; // { a, donnees }
let enCours = null;
/** L'arbre lu sur la tour : { noeuds, parNoeud: Map, motion, verrou, limites }. */
export async function lireArbre({ frais = false } = {}) {
  if (!sait("arbre-v1")) return null;
  if (!frais && cache && Date.now() - cache.a < 30_000) return cache.donnees;
  if (enCours && !frais) return enCours;
  enCours = api("/api/noeuds", { delai: 20000 }).then((r) => {
    const noeuds = Array.isArray(r?.noeuds) ? r.noeuds : [];
    const donnees = { ...r, noeuds, parNoeud: new Map(noeuds.map((x) => [x.noeud, x])) };
    cache = { a: Date.now(), donnees };
    return donnees;
  }).finally(() => {
    enCours = null;
  });
  return enCours;
}
export const oublierArbre = () => {
  cache = null;
};
/** Pose une vue de nœud relue (après un geste) dans la copie gardée. */
function garder(vue) {
  if (!cache?.donnees || !vue) return;
  cache.donnees.parNoeud.set(vue.noeud, vue);
  cache.donnees.noeuds = cache.donnees.noeuds.map((x) => (x.noeud === vue.noeud ? vue : x));
}

// --- La pastille d'état : une forme ET un mot ---

export function pastilleEl(p, { court = false } = {}) {
  if (!p) return null;
  return h("span", { class: `arbre-pastille forme-${p.forme}${p.propose ? " propose" : ""}`, title: p.propose ? `${p.libelle} — proposé par Rémy, à confirmer` : p.libelle },
    h("span", { class: "arbre-forme", "aria-hidden": "true" }),
    h("span", { class: "arbre-pastille-lib" }, p.libelle, p.propose ? h("span", { class: "arbre-q", "aria-hidden": "true" }, " ?") : null),
    p.propose ? h("span", { class: "sr" }, court ? " (proposé)" : " (proposé par Rémy, à confirmer)") : null);
}

/** Les lignes sous le nom d'un nœud dans l'arbre : état, où on en est (ou pourquoi), son âge. */
export function lignesNoeud(vue, maintenant = Date.now()) {
  if (!vue) return null;
  const l = A.ligneArbre(vue, maintenant);
  if (!l.pastille && !l.ligne) return null;
  const morceau = (x, prefixe) => x ? h("span", { class: `arbre-ligne${x.origine === "deduit" ? " deduit" : ""}${x.vieux ? " vieux" : ""}` },
    prefixe ? h("span", { class: "arbre-ligne-tete" }, prefixe) : null,
    h("span", { class: "arbre-ligne-texte" }, x.texte),
    x.origine === "deduit" ? h("span", { class: "arbre-ligne-age" }, " · proposé") : x.age ? h("span", { class: "arbre-ligne-age" }, ` · ${x.age}`) : null) : null;
  return h("span", { class: "arbre-lignes" },
    h("span", { class: "arbre-ligne-1" }, A.ligneArbre(vue, maintenant).pastille ? pastilleEl(l.pastille, { court: true }) : null, morceau(l.ligne, l.ligne?.champ === "pourquoi" ? "Pourquoi : " : null)),
    l.pourquoi ? morceau(l.pourquoi, "Pourquoi : ") : null);
}

// --- La fiche d'un nœud (le détail) ---

async function envoyerFiche(vue, corps, { message, apres }) {
  try {
    const r = await remplacer(`/api/noeuds/${seg(vue.noeud)}/fiche`, corps);
    const maj = A.avecFiche(vue, r?.fiche);
    garder(maj);
    if (message) dire(message, { genre: "succes" });
    apres?.(maj);
    return maj;
  } catch (err) {
    if (err.nature !== "auth") direErreur(err, () => envoyerFiche(vue, corps, { message, apres }), "La fiche n'a pas été changée");
    return null;
  }
}

async function corriger(vue, champ, ancre, opts) {
  const v = A.valeur(vue, champ);
  if (champ === "etat") {
    return ouvrirMenu(ancre, [
      ...A.ETATS.map((e) => ({ libelle: A.texteEtat(e), icone: v?.texte === e ? "coche" : null, faire: () => envoyerFiche(vue, A.corpsCorriger("etat", e), { ...opts, message: `État : ${A.texteEtat(e)}.` }) })),
      vue.fiche?.etat ? { libelle: "Effacer (Rémy proposera)", icone: "fermer", faire: () => envoyerFiche(vue, { etat: null }, { ...opts, message: "État effacé : Rémy proposera le sien." }) } : null,
    ], { titre: "État" });
  }
  const t = await demanderTexte(champ === "pourquoi" ? "Pourquoi on fait ça" : "Où on en est", {
    valeur: v?.texte || "", libelle: "Enregistrer", etiquette: "En une phrase",
    aide: v?.origine === "deduit" ? "Rémy l'avait proposé : corrige-le avec tes mots." : null,
  });
  if (!t) return null;
  return envoyerFiche(vue, A.corpsCorriger(champ, t), { ...opts, message: "Noté, avec tes mots." });
}

function ligneChamp(vue, champ, opts, maintenant) {
  const tenu = vue.fiche?.[champ]?.texte ? A.valeur(vue, champ) : null;
  const prop = A.proposition(vue, champ);
  const nom = A.NOMS_CHAMPS[champ];
  const texte = (v) => (champ === "etat" ? pastilleEl(A.PASTILLES[v.texte] ? { ...A.PASTILLES[v.texte], code: v.texte, propose: v.origine === "deduit" } : null) || A.texteEtat(v.texte) : v.texte);
  const gestesProp = (p, { remplace }) => h("div", { class: "rangee serree arbre-gestes" },
    bouton("C'est ça", { classe: "plein petit", icone: "coche", titre: "Rémy a vu juste : c'est confirmé, sa source est gardée", onclick: (e) => occupe(e.currentTarget, () => envoyerFiche(vue, A.corpsConfirmer(champ, p), { ...opts, message: remplace ? "Remplacé par ce que Rémy propose." : "Confirmé." })) }),
    bouton("Corriger", { classe: "papier petit", icone: "crayon", onclick: (e) => corriger(vue, champ, e.currentTarget, opts) }),
    bouton("Pas ça", { classe: "texte petit", icone: "fermer", titre: "Rémy ne le reproposera pas tant que ce qu'il voit ne change pas", onclick: (e) => occupe(e.currentTarget, () => envoyerFiche(vue, A.corpsEcarter(champ, p), { ...opts, message: "Écarté : Rémy ne le reproposera pas." })) }));
  const corps = [];
  if (tenu) {
    corps.push(h("div", { class: "arbre-valeur" }, texte(tenu)), h("p", { class: "arbre-origine" }, A.origine(tenu, maintenant)));
    if (prop) {
      corps.push(h("div", { class: "arbre-autre" },
        h("p", { class: "arbre-autre-tete" }, icone("etoile"), "Rémy voit autre chose : ", h("span", { class: "arbre-autre-texte" }, champ === "etat" ? A.texteEtat(prop.texte) : `« ${prop.texte} »`)),
        h("p", { class: "arbre-origine" }, A.origine({ ...prop, origine: "deduit" }, maintenant)),
        gestesProp(prop, { remplace: true })));
    }
  } else if (prop) {
    corps.push(h("div", { class: "arbre-valeur deduit" }, texte({ ...prop, origine: "deduit" })),
      h("p", { class: "arbre-origine deduit" }, icone("etoile"), A.origine({ ...prop, origine: "deduit" }, maintenant)),
      gestesProp(prop, { remplace: false }));
  } else {
    corps.push(h("p", { class: "arbre-inconnu" }, champ === "pourquoi" ? "Rémy ne sait pas encore pourquoi : aucune priorité ni sa mémoire n'en parlent." : champ === "etat" ? "Rémy n'a rien vu qui dise où ça en est." : "Rien d'ouvert ni de récent ici : Rémy n'a rien à en dire."));
  }
  const modifier = tenu || !prop ? bouton("", { classe: "texte icone", icone: "crayon", etiquette: `${tenu ? "Modifier" : "Écrire"} « ${nom} »`, titre: tenu ? "Modifier" : "L'écrire toi-même", onclick: (e) => corriger(vue, champ, e.currentTarget, opts) }) : null;
  return h("div", { class: `arbre-champ${!tenu && prop ? " a-confirmer" : ""}`, "data-champ": champ },
    h("div", { class: "arbre-champ-tete" }, h("h4", null, nom), !tenu && prop ? h("span", { class: "arbre-a-confirmer" }, "à confirmer") : null, modifier),
    corps);
}

/** Le fil d'Ariane d'un nœud : chaque ancêtre est un lien. */
export function cheminEl(vue, parNoeud) {
  const ancetres = [];
  for (let p = vue.parent, n = 0; p && n < 30; p = parNoeud?.get(p)?.parent, n++) {
    const x = parNoeud?.get(p);
    if (!x) break;
    ancetres.unshift(x);
  }
  return h("nav", { class: "arbre-chemin", "aria-label": "Chemin" },
    ancetres.flatMap((x) => [h("a", { href: A.hrefNoeud(x.noeud) }, x.nom), h("span", { class: "arbre-sep", "aria-hidden": "true" }, " › ")]),
    h("span", { "aria-current": "page" }, vue.nom));
}

/**
 * La fiche en tête du détail d'un nœud : le chemin complet, pourquoi, état,
 * où on en est (chacun avec son origine), l'historique court, les
 * conversations rattachées. `apres(vue)` : la fiche a changé.
 */
export function sectionFiche(vue, { parNoeud, apres, enParler } = {}) {
  const maintenant = Date.now();
  const zone = h("section", { class: "arbre-fiche", "aria-label": "Ce que Rémy a compris de ce nœud" });
  const opts = { apres: (maj) => {
    vider(zone, ...sectionFiche(maj, { parNoeud, apres, enParler }).childNodes);
    apres?.(maj);
  } };
  const hist = h("div", { class: "arbre-historique" });
  const voirHist = bouton("Historique", { classe: "texte petit", icone: "horloge", titre: "Les derniers changements de cette fiche", onclick: (e) => occupe(e.currentTarget, () => historique(vue, hist, e.currentTarget)) });
  const convs = vue.conversations || [];
  const local = convs.length && sait("arbre-v1")
    ? bouton("Proposer « où on en est »", { classe: "papier petit", icone: "etincelles", titre: "Le modèle local de ta tour lit la dernière conversation rattachée et propose une phrase. Rien ne part ailleurs.", onclick: (e) => occupe(e.currentTarget, () => resumeLocal(vue, convs[0], zone, opts)) })
    : null;
  const morceaux = [
    h("div", { class: "arbre-fiche-tete" }, cheminEl(vue, parNoeud),
      h("span", { class: "arbre-calcul" }, vue.priorite?.rang ? `Ta priorité n°${vue.priorite.rang}` : vue.priorite ? "Une de tes priorités (pas encore classée)" : null)),
    h("div", { class: "arbre-champs" }, A.CHAMPS.map((c) => ligneChamp(vue, c, opts, maintenant))),
    vue.memoireCachee ? h("p", { class: "aide arbre-memoire-cachee" }, icone("cadenas"), `Sa mémoire en dit aussi quelque chose : `, h("a", { href: "#/projets/compris" }, "Ce que Rémy a compris"), " (verrouillé).") : null,
    h("div", { class: "arbre-pied" },
      convs.length ? h("div", { class: "arbre-convs" }, h("span", { class: "aide" }, convs.length > 1 ? "Conversations rattachées :" : "Conversation rattachée :"),
        convs.slice(0, 3).map((c) => h("a", { class: "puce", href: `#/remy/${seg(c.id)}` }, icone("remy"), h("span", null, c.titre))))
        : enParler ? h("span", { class: "aide" }, "Aucune conversation rattachée : « En parler à Rémy » en ouvre une, rattachée ici.") : null,
      h("div", { class: "rangee serree" }, local, voirHist)),
    hist];
  zone.append(...morceaux.filter(Boolean)); // append() écrirait « null »
  return zone;
}

async function historique(vue, zone, btn) {
  if (zone.childNodes.length) {
    vider(zone);
    btn.setAttribute("aria-expanded", "false");
    return;
  }
  vider(zone, squelette([0.6, 0.4]));
  try {
    const r = await api(`/api/noeuds/${seg(vue.noeud)}/historique`);
    const l = (r?.historique || []).slice(0, 8);
    btn.setAttribute("aria-expanded", "true");
    vider(zone, l.length
      ? h("ol", { class: "arbre-histo" }, l.map((x) => h("li", null,
        h("span", { class: "arbre-histo-quand" }, A.age(x.a) || ""),
        h("span", null, h("strong", null, `${A.NOMS_CHAMPS[x.champ] || x.champ} : `), x.texte == null ? "effacé" : A.texteChamp(x.champ, x.texte),
          h("span", { class: "aide" }, ` — ${x.origine === "confirme" ? "confirmé par toi" : x.origine === "ecrit" ? "écrit par toi" : "changé"}`)))))
      : h("p", { class: "aide" }, "Rien encore : l'historique commence au premier « C'est ça » ou à ta première correction."));
  } catch (err) {
    vider(zone, h("p", { class: "aide" }, `Historique illisible : ${texteErreur(err)}`));
  }
}

async function resumeLocal(vue, conv, zone, opts) {
  try {
    const r = await ecrire(`/api/noeuds/${seg(vue.noeud)}/resume-local`, { conversation: conv.id }, { delai: 100_000 });
    if (!r?.proposition) return dire(r?.message || "Le modèle local n'a rien trouvé de clair.", { duree: 6000 });
    // La proposition s'affiche comme une déduction : rien n'est rangé avant « C'est ça ».
    const maj = { ...vue, propositions: { ...(vue.propositions || {}), point: { texte: r.proposition.texte, source: r.proposition.source, origine: "deduit" } } };
    vider(zone, ...sectionFiche(maj, { ...opts, apres: opts.apres }).childNodes);
    zone.querySelector('[data-champ="point"]')?.scrollIntoView({ block: "nearest" });
    dire("Proposé par le modèle local : « C'est ça », corrige ou écarte.", { duree: 5000 });
  } catch (err) {
    if (err.nature !== "auth") direErreur(err, null, "Pas de proposition");
  }
}

// --- « Rattacher à… » une conversation ---

/** Rend le nœud choisi, `null` pour détacher, `undefined` si fermé. */
export function choisirNoeud(noeuds, { actuel = null, titre = "Rattacher à…" } = {}) {
  let f;
  const liste = h("div", { class: "arbre-choix-liste", role: "list" });
  const champ = h("input", { class: "champ", type: "search", placeholder: "Chercher une branche…", "aria-label": "Chercher une branche", autocomplete: "off" });
  const dessiner = () => {
    const l = A.choixRattacher(noeuds, champ.value);
    vider(liste, l.length ? l.map((x) => h("button", { type: "button", role: "listitem", class: `arbre-choix${x.noeud === actuel ? " actuel" : ""}`, style: { "--niveau": String(x.niveau || 0) }, onclick: () => f.fermer(x.noeud) },
      icone(x.type === "motion" ? "pile" : "dossier"),
      h("span", { class: "arbre-choix-textes" }, h("strong", null, x.nom), x.niveau ? h("small", null, A.cheminTexte(x)) : null),
      x.noeud === actuel ? icone("coche") : null))
      : h("p", { class: "vide" }, noeuds.length ? `Aucune branche ne correspond à « ${champ.value.trim()} ».` : "Pas encore de projet ni de dossier : crée-en un dans Projets."));
  };
  champ.addEventListener("input", dessiner);
  dessiner();
  f = feuille({ titre, sousTitre: "La conversation montrera en tête où en est cette branche, et pourquoi.", classe: "feuille-arbre-choix",
    contenu: [champ, liste],
    pied: actuel ? [bouton("Détacher", { classe: "papier", icone: "fermer", onclick: () => f.fermer(null) })] : null });
  champ.focus();
  return f.fini;
}

export async function rattacher(convId, noeud) {
  return remplacer(`/api/conversations/${seg(convId)}/noeud`, { noeud });
}

/** Le bandeau en tête d'une conversation rattachée : chemin, pourquoi, où on en est. */
export function bandeauEl(vue, { changer } = {}) {
  const b = A.bandeau(vue);
  if (!b) return null;
  const ligne = (nom, v) => v ? h("p", { class: `arbre-bandeau-ligne${v.origine === "deduit" ? " deduit" : ""}` },
    h("span", { class: "arbre-bandeau-nom" }, `${nom} : `), h("span", null, v.texte),
    h("span", { class: "aide" }, v.origine === "deduit" ? " · proposé par Rémy" : v.age ? ` · ${v.age}` : "")) : null;
  return h("div", { class: "arbre-bandeau", role: "note", "aria-label": `Rattachée à ${b.chemin}` },
    h("div", { class: "arbre-bandeau-tete" },
      h("a", { class: "arbre-bandeau-chemin", href: b.href, title: "Ouvrir la branche dans Projets" }, icone("dossier"), h("span", null, b.chemin)),
      pastilleEl(b.pastille, { court: true }),
      changer ? bouton("", { classe: "texte icone petit", icone: "crayon", etiquette: "Changer la branche", titre: "Rattacher à une autre branche", onclick: changer }) : null),
    ligne("Pourquoi", b.pourquoi) || h("p", { class: "arbre-bandeau-ligne aide" }, "Pourquoi : Rémy ne sait pas encore."),
    ligne("Où on en est", b.point));
}

// --- Le verrou ---

/** L'état du verrou, sans jamais faire échouer l'écran. */
export async function etatVerrou() {
  try {
    return await api("/api/verrou");
  } catch {
    return null;
  }
}

export function listesHonnetes() {
  return h("div", { class: "verrou-honnete" },
    h("div", null, h("h4", null, "Ce qu'il protège"), h("ul", null, A.PROTEGE.map((t) => h("li", null, t)))),
    h("div", null, h("h4", null, "Ce qu'il ne protège pas"), h("ul", null, A.NE_PROTEGE_PAS.map((t) => h("li", null, t)))));
}

/**
 * L'écran verrouillé : le mot de passe ressaisi, vérifié par la tour.
 * `ouvert()` : appelé une fois déverrouillé.
 */
export function carteVerrou(etat, { ouvert, titre = "Ce que Rémy a compris" } = {}) {
  const id = `mdp-verrou-${Math.random().toString(36).slice(2, 7)}`;
  const champ = h("input", { class: "champ", id, type: "password", autocomplete: "current-password", placeholder: "Mot de passe de Rémy", required: true });
  const erreur = h("p", { class: "verrou-erreur", role: "alert", hidden: true });
  const valider = bouton("Déverrouiller", { classe: "plein", icone: "cadenas-ouvert", type: "submit" });
  const form = h("form", { class: "verrou-form", onsubmit: async (e) => {
    e.preventDefault();
    if (!champ.value) return champ.focus();
    erreur.hidden = true;
    await occupe(valider, async () => {
      try {
        const r = await ecrire("/api/verrou", { password: champ.value });
        champ.value = "";
        dire(A.phraseVerrou(r), { genre: "succes" });
        ouvert?.(r);
      } catch (err) {
        if (err.nature === "auth") return; // session perdue : l'écran de connexion prend la main
        erreur.textContent = texteErreur(err);
        erreur.hidden = false;
        champ.select();
      }
    });
  } }, h("label", { class: "etiquette-champ", for: id }, "Ressaisis le mot de passe de Rémy"), h("div", { class: "ajout-ligne" }, champ, valider), erreur);
  const sansVerrou = etat && etat.disponible === false;
  return h("section", { class: "carte verrou-carte" },
    h("div", { class: "verrou-tete" }, h("span", { class: "verrou-icone", "aria-hidden": "true" }, icone("cadenas")),
      h("div", null, h("h2", { class: "titre-ecran", style: { fontSize: "26px" } }, titre),
        h("p", { class: "aide-carte" }, sansVerrou ? A.phraseVerrou(etat) : "Ce que Rémy tient pour vrai sur tes projets, et ce que sa mémoire dit de toi. Verrouillé : la tour vérifie le mot de passe à chaque demande."))),
    sansVerrou ? null : form,
    listesHonnetes());
}

/** La barre « Déverrouillé encore 8 min · Reverrouiller ». `ferme()` : reverrouillé (ou expiré). */
export function barreVerrou(etat, { ferme } = {}) {
  const texte = h("span", { class: "verrou-reste", role: "status" }, A.phraseVerrou(etat));
  const re = etat?.disponible === false ? null : bouton("Reverrouiller", { classe: "papier petit", icone: "cadenas", onclick: (e) => occupe(e.currentTarget, async () => {
    try {
      await supprimer("/api/verrou");
      dire("Reverrouillé.", { genre: "succes" });
    } catch (err) {
      direErreur(err, null, "Pas reverrouillé");
      return;
    }
    clearInterval(minuteur);
    ferme?.();
  }) });
  const minuteur = setInterval(() => {
    if (!texte.isConnected) return clearInterval(minuteur);
    texte.textContent = A.phraseVerrou(etat);
    if (etat?.jusqua && Date.now() >= etat.jusqua) {
      clearInterval(minuteur);
      ferme?.();
    }
  }, 15_000);
  return h("div", { class: "verrou-barre" }, h("span", { class: "verrou-ouvert-icone", "aria-hidden": "true" }, icone(etat?.disponible === false ? "alerte" : "cadenas-ouvert")), texte, re);
}

/** Un champ de fiche avec ses gestes (« C'est ça », Corriger, Pas ça), pour « Ce que Rémy a compris ». */
export const champFiche = (vue, champ, { apres } = {}) => ligneChamp(vue, champ, { apres }, Date.now());
