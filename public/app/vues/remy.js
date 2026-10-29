// Rémy : les conversations, le fil, et à droite la jauge du contexte,
// « Compacter » et les étapes de la réponse. Conversation privée (puce
// « Privée » avant le premier message, cadenas sur la marque, « Rendre
// privée » avec confirmation), propositions ajustables avec Oui / Non merci,
// autorisations, Interrompre / Envoyer après, dictée.
// Aucun message ne part sans un geste : une question préparée par « Noter »
// attend dans le champ, Entrée l'envoie.
import { api, ecrire, flux, nouvelId, seg, sait } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, squelette, blocErreur, vide, feuille, confirmer, demanderTexte, quand, duree, isoLocal, versChampDate, depuisChampDate, markdown, sansMarqueurs, occupe, local, kbd } from "../ui.js";
import { questionEnAttente } from "./noter.js";

let racine;
let ctx;
let liste = null;
let filtre = "";
let courante = null; // la conversation ouverte (objet de la tour) ou { nouvelle: true, prive }
let envoi = null; // { convId, ctrl, bloc }
let fileApres = []; // « Envoyer après » : messages tapés pendant une réponse
let etapes = []; // les étapes de la dernière réponse (panneau)
let refs = {};
const brouillons = new Map(); // ce qui est tapé et pas envoyé, par conversation

const CLE_LUS = "remy-conversations-lues";
const lus = () => local.lire(CLE_LUS, null);
function marquerLu(c) {
  const l = lus() || {};
  l[c.id] = c.updatedAt || Date.now();
  local.ecrire(CLE_LUS, l);
}
const nonLu = (c) => {
  const l = lus();
  if (!l) return false;
  return c.dernier === "assistant" && (c.updatedAt || 0) > (l[c.id] || 0) && courante?.id !== c.id;
};

export default {
  async monter(el, args, contexte) {
    racine = el;
    ctx = contexte;
    courante = null;
    construire();
    await chargerListe();
    await ouvrir(args[0]);
  },
  suivre(args) {
    const voulu = args[0] || null;
    const actuel = courante?.id || (courante?.nouvelle ? "nouvelle" : null);
    if (voulu === actuel && voulu !== "nouvelle") return;
    ouvrir(voulu);
  },
  demonter() {
    envoi?.ctrl.abort();
    envoi = null;
    fileApres = [];
  },
  chercher() {
    refs.recherche?.focus();
  },
  actualiser() {
    chargerListe();
    if (courante?.id && !envoi) recharger(courante.id);
  },
};

// --- Charpente ---
function construire() {
  refs = {};
  refs.recherche = h("input", { class: "champ", type: "search", placeholder: "Chercher un fil", "aria-label": "Chercher dans les conversations", oninput: (e) => { filtre = e.target.value; dessinerListe(); } });
  refs.liste = h("nav", { class: "defile", "aria-label": "Conversations" }, squelette([0.8, 0.6, 0.7, 0.5]));
  refs.titre = h("h1", { class: "titre-fil" }, "Rémy");
  refs.marque = h("span", { class: "marque-r", "aria-hidden": "true", style: { width: "32px", height: "32px", fontSize: "17px", flex: "none" } }, "R");
  refs.cadenas = h("span", { class: "puce", hidden: true, title: "Conversation privée : elle reste sur tes machines" }, icone("cadenas"), h("span", null, "Privée"));
  refs.actionsFil = h("div", { class: "rangee serree" });
  refs.messages = h("div", { class: "fil-messages", tabindex: "-1" });
  refs.champ = h("textarea", { rows: 1, placeholder: "Écris à Rémy…", "aria-label": "Message à Rémy" });
  refs.envoyer = bouton("", { classe: "plein icone", icone: "envoyer", etiquette: "Envoyer (Entrée)", titre: "Envoyer (Entrée)" });
  refs.micro = bouton("", { classe: "texte icone", icone: "micro", etiquette: "Dicter", titre: "Dicter" });
  refs.stop = bouton("Interrompre", { classe: "papier petit", icone: "stop", titre: "Interrompre la réponse (Échap)" });
  refs.stop.hidden = true;
  refs.attente = h("span", { class: "aide", hidden: true });
  refs.pucePrivee = h("button", { type: "button", class: "puce", "aria-pressed": "false", title: "Privée : jamais envoyée à Claude, même en secours" }, icone("cadenas"), h("span", null, "Privée"));
  refs.panneau = h("aside", { class: "remy-panneau", "aria-label": "Contexte et étapes" });
  const composeur = h("div", { class: "composeur" }, h("div", { class: "colonne" },
    h("div", { class: "rangee serree", style: { marginBottom: "8px" } }, refs.pucePrivee, refs.stop, refs.attente),
    h("div", { class: "boite" }, refs.champ, refs.micro, refs.envoyer),
    h("div", { class: "aide-clavier" }, h("span", null, kbd("Entrée"), " envoie"), h("span", null, kbd("Maj"), " ", kbd("Entrée"), " à la ligne"), h("span", null, kbd("Échap"), " interrompt"))));
  const nouvelle = bouton("Nouvelle", { classe: "plein petit", icone: "plus", titre: "Nouvelle conversation", onclick: () => ctx.aller("remy/nouvelle") });
  const privee = bouton("", { classe: "papier petit icone", icone: "cadenas", etiquette: "Nouvelle conversation privée", titre: "Nouvelle conversation privée", onclick: () => { local.ecrire("remy-nouvelle-privee", true); ctx.aller("remy/nouvelle"); } });
  refs.retour = h("a", { class: "btn texte icone lien-retour", href: "#/remy", "aria-label": "Toutes les conversations" }, icone("retour"));
  refs.btnPanneau = bouton("", { classe: "texte icone btn-panneau", icone: "jauge", etiquette: "Contexte et étapes", titre: "Contexte et étapes", onclick: () => refs.racine.classList.toggle("panneau-ouvert") });
  refs.racine = h("div", { class: "remy" },
    h("section", { class: "remy-liste" },
      h("div", { class: "tete-liste" }, h("div", { class: "rangee", style: { justifyContent: "space-between" } }, h("h1", null, "Rémy"), h("div", { class: "rangee serree" }, privee, nouvelle)),
        h("div", { class: "recherche-champ" }, icone("recherche"), refs.recherche, h("span", { class: "kbd" }, "/"))),
      refs.liste),
    h("section", { class: "remy-fil" },
      h("header", { class: "fil-tete" }, refs.retour, refs.marque, refs.titre, refs.cadenas, refs.actionsFil, refs.btnPanneau),
      refs.messages, composeur),
    refs.panneau);
  vider(racine, refs.racine);

  refs.champ.addEventListener("input", ajusterChamp);
  refs.champ.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      soumettre();
    } else if (e.key === "Escape" && envoi) {
      e.preventDefault();
      interrompre();
    }
  });
  refs.envoyer.addEventListener("click", soumettre);
  refs.stop.addEventListener("click", interrompre);
  refs.micro.addEventListener("click", dicter);
  refs.pucePrivee.addEventListener("click", () => {
    if (!courante) courante = { nouvelle: true, prive: false, messages: [] };
    if (!courante.nouvelle) return;
    courante.prive = !courante.prive;
    dessinerEnTete();
    dessinerFil();
    dessinerPanneau();
  });
}

function ajusterChamp() {
  const c = refs.champ;
  c.style.height = "auto";
  c.style.height = `${Math.min(240, c.scrollHeight)}px`;
}

// --- Liste des conversations ---
async function chargerListe() {
  try {
    const l = await api("/api/conversations");
    liste = Array.isArray(l) ? l : [];
    if (!lus()) {
      // Première visite : tout ce qui existe déjà est lu.
      const marques = {};
      for (const c of liste) marques[c.id] = c.updatedAt || 0;
      local.ecrire(CLE_LUS, marques);
    }
    dessinerListe();
  } catch (err) {
    if (!liste) vider(refs.liste, blocErreur(err, chargerListe));
    else direErreur(err, chargerListe, "Liste des conversations");
  }
}

function groupeDe(c, m = Date.now()) {
  if (c.pinned) return "Épinglées";
  const d = new Date(c.updatedAt || 0);
  const auj = new Date();
  auj.setHours(0, 0, 0, 0);
  if (d >= auj) return "Aujourd'hui";
  if (m - d < 7 * 86400e3) return "Cette semaine";
  if (m - d < 31 * 86400e3) return "Ce mois-ci";
  return "Plus ancien";
}

function dessinerListe() {
  if (!liste || !refs.liste) return;
  const f = filtre.trim().toLowerCase();
  const tries = [...liste].sort((a, b) => (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))) || (b.updatedAt || 0) - (a.updatedAt || 0)).filter((c) => !f || (c.title || "").toLowerCase().includes(f));
  if (!tries.length) {
    vider(refs.liste, vide(f ? "Aucun fil trouvé" : "Pas encore de conversation", f ? `Rien ne correspond à « ${filtre} ».` : "Écris à Rémy : une question, un projet, ce qui te trotte dans la tête."));
    return;
  }
  const groupes = new Map();
  for (const c of tries) {
    const g = groupeDe(c);
    if (!groupes.has(g)) groupes.set(g, []);
    groupes.get(g).push(c);
  }
  vider(refs.liste, [...groupes].map(([g, cs]) => [
    h("div", { class: "conv-groupe" }, g),
    cs.map((c) => h("a", { class: "conv", href: `#/remy/${seg(c.id)}`, "aria-current": courante?.id === c.id ? "page" : null, title: c.title },
      c.prive ? icone("cadenas") : null,
      h("span", { class: "t" }, c.title || "Sans titre"),
      nonLu(c) ? h("span", { class: "non-lu", role: "img", "aria-label": "Réponse non lue" }) : null,
      c.pinned ? icone("epingle") : null)),
  ]));
}

// --- Ouvrir une conversation ---
async function ouvrir(id) {
  // Le texte tapé reste attaché à sa conversation (changer de fil ne le perd ni ne l'emporte).
  const avant = courante?.id || (courante?.nouvelle ? "nouvelle" : null);
  if (refs.champ) {
    if (avant) brouillons.set(avant, refs.champ.value);
    refs.champ.value = brouillons.get(id || "") || "";
    ajusterChamp();
  }
  if (envoi && envoi.convId !== id) {
    // La réponse continue sur la tour : on la relira en revenant sur ce fil.
    envoi.ctrl.abort();
    envoi = null;
    fileApres = [];
  }
  etapes = [];
  if (!id || id === "nouvelle") {
    const privee = local.lire("remy-nouvelle-privee", false);
    local.effacer("remy-nouvelle-privee");
    courante = id === "nouvelle" ? { nouvelle: true, prive: Boolean(privee), messages: [] } : null;
    refs.racine.classList.toggle("fil-ouvert", id === "nouvelle");
    dessinerListe();
    dessinerEnTete();
    dessinerFil();
    dessinerPanneau();
    const q = questionEnAttente();
    if (q) {
      refs.champ.value = q;
      ajusterChamp();
      dire("Ta question est prête : Entrée pour l'envoyer à Rémy.", { duree: 4000 });
    }
    if (id === "nouvelle" || matchMedia("(min-width: 721px)").matches) refs.champ.focus();
    return;
  }
  refs.racine.classList.add("fil-ouvert");
  courante = { id, chargement: true, messages: [] };
  dessinerListe();
  dessinerEnTete();
  vider(refs.messages, h("div", { class: "colonne" }, squelette([0.5, 0.9, 0.7]), squelette([0.8, 0.6])));
  await recharger(id);
  refs.champ.focus();
}

async function recharger(id) {
  try {
    const c = await api(`/api/conversations/${seg(id)}`);
    if (courante?.id !== id) return;
    courante = c;
    marquerLu(c);
    dessinerListe();
    dessinerEnTete();
    dessinerFil();
    dessinerPanneau();
  } catch (err) {
    if (courante?.id !== id) return;
    courante = { id, introuvable: true, messages: [] };
    dessinerEnTete();
    if (err.statut === 404) {
      vider(refs.messages, h("div", { class: "colonne" }, vide("Conversation introuvable", "Elle a peut-être été supprimée.", bouton("Nouvelle conversation", { classe: "plein", onclick: () => ctx.aller("remy/nouvelle") }))));
      return;
    }
    vider(refs.messages, h("div", { class: "colonne" }, blocErreur(err, () => { courante = { id, chargement: true, messages: [] }; return recharger(id); })));
  }
}

// --- En-tête du fil ---
function dessinerEnTete() {
  const c = courante;
  refs.titre.textContent = !c ? "Rémy" : c.nouvelle ? (c.prive ? "Conversation privée" : "Nouvelle conversation") : c.title || "Conversation";
  const prive = Boolean(c?.prive);
  refs.cadenas.hidden = !prive;
  refs.marque.replaceChildren(prive ? icone("cadenas") : "R");
  refs.marque.title = prive ? "Conversation privée" : "";
  refs.pucePrivee.hidden = !(c?.nouvelle || !c);
  refs.pucePrivee.setAttribute("aria-pressed", String(Boolean(c?.nouvelle && c.prive)));
  vider(refs.actionsFil);
  if (c?.id && !c.chargement && !c.introuvable) {
    ajouterA(refs.actionsFil,
      bouton("", { classe: "texte icone", icone: "epingle", etiquette: c.pinned ? "Désépingler" : "Épingler", titre: c.pinned ? "Désépingler" : "Épingler", onclick: (e) => occupe(e.currentTarget, () => patch({ pinned: !c.pinned }, c.pinned ? "Désépinglée." : "Épinglée.")) }),
      bouton("", { classe: "texte icone", icone: "crayon", etiquette: "Renommer", titre: "Renommer", onclick: renommer }),
      !c.prive ? bouton("", { classe: "texte icone", icone: "cadenas", etiquette: "Rendre privée", titre: "Rendre privée", onclick: rendrePrivee }) : null,
      bouton("", { classe: "texte icone", icone: "corbeille", etiquette: "Supprimer", titre: "Supprimer", onclick: supprimerConv }));
  }
  majComposeur();
}

async function patch(corps, message) {
  const c = courante;
  try {
    await api(`/api/conversations/${seg(c.id)}`, { methode: "PATCH", corps });
    Object.assign(c, corps);
    const l = liste?.find((x) => x.id === c.id);
    if (l) Object.assign(l, corps);
    dessinerEnTete();
    dessinerListe();
    dessinerPanneau();
    if (message) dire(message, { genre: "succes" });
  } catch (err) {
    direErreur(err, null, "Pas modifiée");
  }
}
async function renommer() {
  const t = await demanderTexte("Renommer la conversation", { valeur: courante.title || "", libelle: "Renommer" });
  if (t) await patch({ title: t.slice(0, 120) }, "Renommée.");
}
async function rendrePrivee() {
  const ok = await confirmer("Rendre cette conversation privée ?", {
    detail: "Elle ne partira plus jamais vers Claude, même en secours. C'est définitif : pour revenir au cloud, il faudra une nouvelle conversation.",
    libelle: "Rendre privée",
  });
  if (ok) await patch({ prive: true }, "Conversation privée : elle reste sur tes machines.");
}
async function supprimerConv() {
  const c = courante;
  if (!(await confirmer(`Supprimer « ${c.title || "cette conversation"} » ?`, { detail: "Les messages sont effacés de la tour.", libelle: "Supprimer", danger: true }))) return;
  try {
    await api(`/api/conversations/${seg(c.id)}`, { methode: "DELETE" });
    liste = (liste || []).filter((x) => x.id !== c.id);
    dire("Conversation supprimée.", { genre: "succes" });
    ctx.aller("remy");
  } catch (err) {
    direErreur(err, null, "Pas supprimée");
  }
}

// --- Le fil ---
function dessinerFil() {
  const c = courante;
  const col = h("div", { class: "colonne" });
  if (!c) {
    ajouterA(col, h("div", { class: "bienvenue-remy" }, h("h2", null, "Bonjour"),
      h("p", { class: "aide" }, "Choisis une conversation, ou écris directement : une nouvelle conversation s'ouvre avec ton premier message."),
      h("div", { class: "rangee", style: { marginTop: "14px" } },
        bouton("Nouvelle conversation", { classe: "plein", icone: "plus", onclick: () => ctx.aller("remy/nouvelle") }),
        bouton("Conversation privée", { classe: "papier", icone: "cadenas", onclick: () => { local.ecrire("remy-nouvelle-privee", true); ctx.aller("remy/nouvelle"); } }))));
  } else if (!c.messages?.length) {
    ajouterA(col, c.prive
      ? h("div", { class: "carte-privee" }, h("strong", null, icone("cadenas"), "Conversation privée"),
        h("p", null, "Elle reste sur tes machines : jamais envoyée à Claude, même si le modèle local est en panne. La dictée y passe par la tour seulement."))
      : h("div", { class: "bienvenue-remy" }, h("h2", null, "Qu'est-ce qu'on fait ?"),
        h("p", { class: "aide" }, "Une question, une semaine à organiser, une idée à creuser. Rémy voit ton planning et peut proposer des changements : rien ne part sans ton « Oui »."),
        c.nouvelle ? h("p", { class: "aide", style: { marginTop: "8px" } }, "Pour qu'elle reste sur tes machines : « Privée », au-dessus du champ, avant le premier message.") : null));
  }
  (c?.messages || []).forEach((m, i) => col.append(blocMessage(m, i, c)));
  vider(refs.messages, col);
  defilerEnBas(true);
}

function defilerEnBas(force = false) {
  const el = refs.messages;
  if (force || el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
}

function libelleModele(m) {
  if (!m?.model || m.model === "remy") return null;
  const usd = typeof m.usd === "number" && m.usd > 0 ? ` · ${m.usd < 0.01 ? "< 0,01" : m.usd.toFixed(2).replace(".", ",")} $` : "";
  return `${m.model}${m.tier === "local" ? " · sur tes machines" : ""}${usd}`;
}

function blocMessage(m, i, c) {
  if (m.role === "user") return h("div", { class: "msg-sam" }, m.content);
  const bloc = h("div", { class: "msg-remy", dataset: { index: String(i) } },
    h("div", { class: "auteur" }, h("span", { class: "marque-r", "aria-hidden": "true" }, "R"), "Rémy"),
    h("div", { class: "md", html: markdown(sansMarqueurs(m.content)) }),
    libelleModele(m) ? h("div", { class: "puce-modele" }, libelleModele(m)) : null);
  if (m.proposal?.actions?.length) bloc.append(carteProposition(m.proposal, c, i));
  if (m.autorisation) bloc.append(carteAutorisation(m.autorisation, c));
  return bloc;
}

// --- Propositions ---
const PRIO = { ASAP: "au plus vite", HIGH: "haute", MEDIUM: "moyenne", LOW: "basse" };
let etiquettesConnues = null;
async function etiquettes() {
  if (!etiquettesConnues) etiquettesConnues = (await api("/api/etiquettes")).etiquettes || [];
  return etiquettesConnues;
}
const nomEtiquette = (id) => etiquettesConnues?.find((e) => e.id === id)?.nom || id;

function quoi(a, source) {
  const nom = a.nom || a.titre || a.texte || "";
  if (a.type === "liste") return `Ajouter ${a.articles?.length > 1 ? `${a.articles.length} articles` : `« ${a.articles?.[0] || ""} »`} à « ${a.liste || "Courses"} »`;
  if (a.type === "rappel") return `Rappel « ${nom} »`;
  if (a.type === "creer") return source === "agenda" ? `Ajouter « ${nom} » à l'agenda` : `Créer « ${nom} »`;
  if (a.type === "modifier") return `Modifier « ${nom} »${a.nouveau_nom ? ` → « ${a.nouveau_nom} »` : ""}`;
  if (a.type === "terminer") return `Terminer « ${nom} »`;
  if (a.type === "supprimer") return `Supprimer « ${nom} »`;
  return a.resume || a.description || `${a.type || "Action"} « ${nom} »`;
}

function carteProposition(p, c, index) {
  const carte = h("div", { class: "proposition" });
  const dessiner = () => vider(carte, contenuProposition(p, c, index, dessiner));
  dessiner();
  if (p.actions?.some((a) => a.etiquettes?.length) && !etiquettesConnues) etiquettes().then(dessiner).catch(() => {});
  return carte;
}

function contenuProposition(p, c, index, redessiner) {
  const statut = p.statut || "en_attente";
  const ouverte = statut === "en_attente" || statut === "echec";
  if (!p._decoches) p._decoches = new Set();
  const decoches = p._decoches;
  const motionOuAgenda = p.source === "motion" || p.source === "agenda" || p.source === undefined;
  const partiel = ouverte && p.actions.length > 1 && sait("propositions-partielles-v1") && motionOuAgenda;
  const ajustable = ouverte && sait("propositions-ajustables-v1") && (p.source === "motion" || p.source === undefined) && Boolean(c?.id);
  const lignes = p.actions.map((a, k) => {
    const rang = a.rang ?? k;
    const details = [];
    if (a.echeance) details.push(["echeance", `d'ici ${quand(new Date(a.echeance).getTime(), { avecHeure: !/T2[23]:(00|59)/.test(a.echeance) })}`]);
    if (a.debut) details.push(["debut", quand(new Date(a.debut).getTime())]);
    if (a.duree) details.push(["duree", duree(Number(a.duree))]);
    if (a.priorite) details.push(["priorite", `priorité ${PRIO[a.priorite] || a.priorite}`]);
    if (a.etiquettes?.length) details.push(["etiquettes", a.etiquettes.map(nomEtiquette).join(", ")]);
    if (a.type === "rappel" && a.quand) details.push(["quand", quand(a.quand)]);
    const coche = partiel ? h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": String(!decoches.has(rang)), "aria-label": `Garder : ${quoi(a, p.source)}`, onclick: () => { if (decoches.has(rang)) decoches.delete(rang); else decoches.add(rang); redessiner(); } }) : null;
    const reglable = ajustable && ["creer", "modifier"].includes(a.type);
    return h("div", { class: "action-prop" }, coche,
      h("div", { class: "corps" }, h("div", { class: "quoi" }, quoi(a, p.source)),
        details.length || (ajustable && a.type === "creer") ? h("div", { class: "details" },
          details.map(([cle, texte]) => reglable && cle !== "quand"
            ? h("button", { type: "button", class: "btn papier", title: "Ajuster", onclick: () => ajuster(p, c, a, rang, cle, redessiner) }, texte)
            : h("span", { class: "puce" }, texte)),
          ajustable && a.type === "creer" ? [
            !a.echeance ? h("button", { type: "button", class: "btn texte", onclick: () => ajuster(p, c, a, rang, "echeance", redessiner) }, "+ échéance") : null,
            !a.duree ? h("button", { type: "button", class: "btn texte", onclick: () => ajuster(p, c, a, rang, "duree", redessiner) }, "+ durée") : null,
            sait("categories-taches-v1") && !a.etiquettes?.length ? h("button", { type: "button", class: "btn texte", onclick: () => ajuster(p, c, a, rang, "etiquettes", redessiner) }, "+ catégorie") : null,
            h("button", { type: "button", class: "btn texte", title: "En faire un rappel plutôt qu'une tâche", onclick: () => enRappel(p, c, a, rang, redessiner) }, "→ rappel"),
          ] : null) : null));
  });
  const gardes = p.actions.length - decoches.size;
  const libOui = gardes === p.actions.length ? "Oui, fais-le" : gardes === 0 ? "Rien de coché" : gardes === 1 ? "Oui, celle-ci" : `Oui, les ${gardes}`;
  const pied = [];
  if (ouverte && c?.id) {
    const oui = bouton(libOui, { classe: "plein", icone: "coche" });
    oui.disabled = gardes === 0;
    oui.addEventListener("click", () => occupe(oui, () => accepter(p, c, index, redessiner)));
    const non = bouton("Non merci", { classe: "papier" });
    non.addEventListener("click", () => occupe(non, () => refuser(p, c, redessiner)));
    pied.push(h("div", { class: "rangee" }, oui, non));
    if (p.perimee) pied.push(h("p", { class: "statut" }, `${p.raisonPeremption || "Proposition ancienne"} : « Oui » te demandera de confirmer.`));
    if (statut === "echec") pied.push(h("p", { class: "statut", style: { color: "var(--danger)" } }, `La dernière tentative a échoué : ${p.bilan?.echoues?.[0]?.erreur || "raison inconnue"}. Tu peux réessayer.`));
  } else if (!ouverte) {
    const texte = statut === "applique" ? (p.annulee ? "Annulée : tout est revenu comme avant." : `C'est fait${p.bilan?.dejaLa?.length ? ` (déjà là : ${p.bilan.dejaLa.join(", ")})` : ""}.`)
      : statut === "refuse" ? "Tu as dit non : rien n'a été changé." : statut === "converti" ? "Rangée en rappels." : statut;
    pied.push(h("div", { class: "rangee" }, h("p", { class: "statut" }, texte),
      statut === "applique" && p.ledgerId && !p.annulee && motionOuAgenda ? bouton("Annuler", { classe: "texte petit", onclick: (e) => occupe(e.currentTarget, () => annulerProposition(p, redessiner)) }) : null));
  }
  return [p.resume ? h("div", { class: "resume-prop" }, p.resume) : null, ...lignes, ...pied, p.ajustee && ouverte ? h("p", { class: "statut" }, "Ajustée par toi : c'est cette version qui partira.") : null];
}

async function accepter(p, c, index, redessiner) {
  const decoches = p._decoches || new Set();
  const rangs = decoches.size ? p.actions.map((a, k) => a.rang ?? k).filter((r) => !decoches.has(r)) : null;
  try {
    let confirmerPerimee = false;
    if (p.perimee) {
      if (!(await confirmer("Appliquer quand même ?", { detail: `${p.raisonPeremption || "Cette proposition est ancienne"}. Vérifie qu'elle tient encore.`, libelle: "Oui, appliquer" }))) return;
      confirmerPerimee = true;
    }
    if (p.source === "carnet" || p.source === "regle") {
      await ecrire(`/api/conversations/${seg(c.id)}/propositions/${seg(p.id)}/${p.source}`, {});
      p.statut = "applique";
      dire(p.source === "regle" ? "Règle créée." : "C'est fait : rangé dans ton carnet.", { genre: "succes" });
      redessiner();
      return;
    }
    const corps = { actions: p.actions, convId: c.id, index, propositionId: p.id, idCommande: nouvelId() };
    if (p.resume) corps.resume = p.resume;
    if (rangs) corps.rangs = rangs;
    if (confirmerPerimee) corps.confirmer = true;
    const r = await ecrire(p.source === "agenda" ? "/api/google/apply" : "/api/motion/apply", corps, { delai: 180000 });
    const rates = (r?.results || []).filter((x) => !x.ok);
    p.ledgerId = r?.ledgerId;
    p.statut = r?.etat === "echouee" ? "echec" : "applique";
    p.bilan = { echoues: rates.map((x) => ({ nom: x.nom, erreur: x.erreur })) };
    if (p.statut === "echec") dire(`Pas fait : ${rates[0]?.erreur || "raison inconnue"}.`, { genre: "erreur" });
    else dire(rates.length ? `Fait en partie : ${rates.length} changement${rates.length > 1 ? "s" : ""} refusé${rates.length > 1 ? "s" : ""} (${rates[0].erreur}).` : "C'est fait.", {
      genre: rates.length ? "erreur" : "succes",
      action: r?.ledgerId ? { libelle: "Annuler", faire: () => annulerProposition(p, redessiner) } : null,
    });
    redessiner();
  } catch (err) {
    if (err.statut === 409) {
      dire(err.message, { genre: "erreur" });
      recharger(c.id);
      return;
    }
    direErreur(err, () => accepter(p, c, index, redessiner), "Pas appliquée");
  }
}

async function annulerProposition(p, redessiner) {
  try {
    const r = await ecrire(p.source === "agenda" ? "/api/google/undo" : "/api/motion/undo", { id: p.ledgerId });
    if (r?.ok === false) dire("Annulation incomplète : vérifie ton planning.", { genre: "erreur" });
    else {
      p.annulee = true;
      dire("Annulé : tout est revenu comme avant.", { genre: "succes" });
    }
    redessiner();
  } catch (err) {
    direErreur(err, null, "Pas annulée");
  }
}

async function refuser(p, c, redessiner) {
  try {
    await ecrire(`/api/conversations/${seg(c.id)}/propositions/${seg(p.id)}/refus`, {});
    p.statut = "refuse";
    redessiner();
    dire("Noté : rien n'a été changé, et Rémy sait que tu as dit non.");
  } catch (err) {
    direErreur(err, null, "« Non merci » pas enregistré");
  }
}

async function envoyerAjustement(p, c, corps, redessiner) {
  const r = await ecrire(`/api/conversations/${seg(c.id)}/propositions/${seg(p.id)}/ajuster`, corps);
  p.actions = r?.actions || p.actions;
  p.statut = r?.statut === "converti" ? "converti" : "en_attente";
  p.ajustee = true;
  p._decoches = new Set();
  redessiner();
}

async function ajuster(p, c, a, rang, cle, redessiner) {
  let champ;
  let lire;
  if (cle === "echeance" || cle === "debut") {
    champ = h("input", { class: "champ", type: "datetime-local", "aria-label": cle === "debut" ? "Début" : "Échéance" });
    const v = a[cle] ? new Date(a[cle]) : new Date(Date.now() + 86400e3);
    if (!a[cle]) v.setHours(23, 0, 0, 0);
    champ.value = versChampDate(v);
    lire = () => (champ.value ? isoLocal(depuisChampDate(champ.value)) : null);
  } else if (cle === "duree") {
    champ = h("input", { class: "champ", type: "number", min: "5", max: "1440", step: "5", value: String(a.duree || 30), "aria-label": "Durée en minutes" });
    lire = () => Number(champ.value) || null;
  } else if (cle === "priorite") {
    champ = h("select", { class: "champ", "aria-label": "Priorité" }, Object.entries(PRIO).map(([v, l]) => h("option", { value: v }, l)));
    champ.value = a.priorite || "MEDIUM";
    lire = () => champ.value;
  } else if (cle === "etiquettes") {
    const toutes = await etiquettes().catch(() => []);
    const choisies = new Set(a.etiquettes || []);
    champ = h("div", { class: "rangee serree" }, toutes.length ? toutes.map((e) => {
      const b = h("button", { type: "button", class: "puce", "aria-pressed": String(choisies.has(e.id)) }, e.nom);
      b.addEventListener("click", () => { if (choisies.has(e.id)) choisies.delete(e.id); else choisies.add(e.id); b.setAttribute("aria-pressed", String(choisies.has(e.id))); });
      return b;
    }) : h("p", { class: "aide" }, "Pas encore de catégories."));
    lire = () => [...choisies];
  } else return;
  const LIB = { echeance: "Échéance", debut: "Début", duree: "Durée (minutes)", priorite: "Priorité", etiquettes: "Catégories" };
  let f;
  const valider = bouton("Ajuster", { classe: "plein", onclick: (e) => occupe(e.currentTarget, async () => {
    try {
      await envoyerAjustement(p, c, { actions: [{ rang, [cle]: lire() }] }, redessiner);
      f.fermer();
      dire("Ajustée : c'est cette version qui partira à ton « Oui ».", { genre: "succes" });
    } catch (err) {
      direErreur(err, null, "Pas ajustée");
    }
  }) });
  f = feuille({ titre: LIB[cle], sousTitre: quoi(a, p.source), contenu: champ, pied: [bouton("Annuler", { classe: "papier", onclick: () => f.fermer() }), valider] });
}

async function enRappel(p, c, a, rang, redessiner) {
  const nom = a.nom || a.titre || "";
  if (!(await confirmer("En faire un rappel ?", { detail: `« ${nom} » devient un rappel${a.echeance ? ` (${quand(new Date(a.echeance).getTime())})` : ""}, pas une tâche Motion.`, libelle: "Ranger en rappel" }))) return;
  try {
    await ecrire("/api/rappels", { rappels: [{ id: `prop-${p.id}-${rang}`.replace(/[^A-Za-z0-9:_.-]/g, "-").slice(0, 150), texte: nom, quand: a.echeance ? new Date(a.echeance).getTime() : null }] });
    await envoyerAjustement(p, c, { convertis: [rang] }, redessiner);
    dire(`« ${nom} » rangé en rappel.`, { genre: "succes" });
  } catch (err) {
    direErreur(err, null, "Pas rangé en rappel");
  }
}

// --- Autorisations (une recherche web qui passerait par Claude) ---
function carteAutorisation(a, c) {
  const el = h("div", { class: "autorisation" });
  if (a.statut && a.statut !== "en_attente") {
    el.append(h("p", { class: "statut aide" }, ["accordee", "accorde", "acceptee"].includes(a.statut) ? "Recherche autorisée." : "Recherche refusée : Rémy a répondu sans le web."));
    return el;
  }
  const oui = bouton("Autoriser cette recherche", { classe: "plein" });
  const non = bouton("Non, réponds sans", { classe: "papier" });
  const repondre = (accord) => {
    if (envoi) return dire("Attends la fin de la réponse en cours.");
    a.statut = accord ? "accordee" : "refusee";
    vider(el, h("p", { class: "statut aide" }, accord ? "Recherche autorisée…" : "Rémy répond sans le web…"));
    lancerFlux(`/api/conversations/${seg(c.id)}/autorisations/${seg(a.id)}`, { accord }, { texteSam: null });
  };
  oui.addEventListener("click", () => repondre(true));
  non.addEventListener("click", () => repondre(false));
  ajouterA(el, a.requete ? h("p", { class: "aide" }, `Seule la question partirait : « ${a.requete} »`) : null, h("div", { class: "rangee", style: { marginTop: "8px" } }, oui, non));
  return el;
}

// --- Envoyer ---
function majComposeur() {
  if (!refs.stop) return;
  refs.stop.hidden = !envoi || envoi.convId !== (courante?.id || null);
  refs.attente.hidden = !fileApres.length;
  refs.attente.textContent = fileApres.length ? `${fileApres.length} message${fileApres.length > 1 ? "s partiront" : " partira"} après la réponse` : "";
  refs.champ.placeholder = envoi ? "Écris la suite : elle partira après la réponse" : courante?.prive ? "Écris à Rémy (conversation privée)…" : "Écris à Rémy…";
  refs.envoyer.disabled = Boolean(courante?.chargement);
}

async function soumettre() {
  const texte = refs.champ.value.trim();
  if (!texte) return refs.champ.focus();
  if (courante?.chargement) return;
  refs.champ.value = "";
  ajusterChamp();
  brouillons.delete(courante?.id || "nouvelle");
  if (envoi) {
    fileApres.push(texte);
    majComposeur();
    return;
  }
  await envoyerMessage(texte);
}

async function envoyerMessage(texte) {
  // Pas de fil ouvert : une conversation naît avec le premier message.
  if (!courante || courante.nouvelle || courante.introuvable) {
    const prive = Boolean(courante?.prive);
    try {
      const c = await ecrire("/api/conversations", prive ? { prive: true } : {});
      courante = { ...c, messages: [] };
      liste = [{ id: c.id, title: c.title, updatedAt: Date.now(), prive: c.prive, pinned: false, messages: 0 }, ...(liste || [])];
      history.replaceState(null, "", `#/remy/${seg(c.id)}`);
      refs.racine.classList.add("fil-ouvert");
      dessinerListe();
      dessinerEnTete();
      dessinerFil();
    } catch (err) {
      refs.champ.value = texte;
      ajusterChamp();
      direErreur(err, () => soumettre(), "Conversation pas créée");
      return;
    }
  }
  const c = courante;
  c.messages.push({ role: "user", content: texte });
  if (c.messages.length === 1) dessinerFil();
  else refs.messages.querySelector(".colonne")?.append(h("div", { class: "msg-sam" }, texte));
  defilerEnBas(true);
  await lancerFlux(`/api/conversations/${seg(c.id)}/messages`, { text: texte, call: false }, { texteSam: texte });
}

/** Lit une réponse en flux (message ou autorisation) et la montre au fil de l'eau. */
async function lancerFlux(chemin, corps, { texteSam }) {
  const c = courante;
  const zoneEtapes = h("div", { class: "etapes", "aria-live": "polite" });
  const md = h("div", { class: "md" }, h("p", { class: "aide" }, "Rémy réfléchit…"));
  const puce = h("div", { class: "puce-modele" });
  const bloc = h("div", { class: "msg-remy" }, h("div", { class: "auteur" }, h("span", { class: "marque-r", "aria-hidden": "true" }, "R"), "Rémy"), zoneEtapes, md, puce);
  const bulleSam = texteSam ? refs.messages.querySelector(".colonne .msg-sam:last-of-type") : null;
  refs.messages.querySelector(".colonne")?.append(bloc);
  defilerEnBas(true);
  const ctrl = new AbortController();
  envoi = { convId: c.id, ctrl, bloc };
  etapes = [];
  const debut = Date.now();
  dessinerPanneau();
  majComposeur();
  let texte = "";
  let fini = false;
  let erreurServeur = null;
  let propose = null;
  const dessinerEtapes = (finies = false) => {
    if (!etapes.length) return vider(zoneEtapes);
    if (finies) {
      const secondes = ((Date.now() - debut) / 1000).toFixed(1).replace(".", ",");
      const detail = h("div", { class: "etapes", hidden: true }, etapes.map((e) => h("div", { class: "etape" }, h("span", { class: "point" }), h("span", null, e.text), h("span", { class: "t" }, `${((e.t || 0) / 1000).toFixed(1).replace(".", ",")} s`))));
      const bascule = h("button", { type: "button", class: "etapes-resume", "aria-expanded": "false" }, icone("chevron"), `${etapes.length} étape${etapes.length > 1 ? "s" : ""} · ${secondes} s`);
      bascule.addEventListener("click", () => {
        detail.hidden = !detail.hidden;
        bascule.setAttribute("aria-expanded", String(!detail.hidden));
      });
      vider(zoneEtapes, bascule, detail);
      return;
    }
    vider(zoneEtapes, etapes.slice(-4).map((e, i, arr) => h("div", { class: `etape${i === arr.length - 1 ? " courante" : ""}` }, h("span", { class: "point" }), h("span", null, e.text), e.detail ? h("span", { class: "aide" }, ` ${e.detail}`) : null)));
  };
  const visible = () => courante?.id === c.id;
  try {
    await flux(chemin, corps, (nom, d) => {
      if (nom === "delta") {
        texte += d.text || "";
        if (visible()) {
          md.innerHTML = markdown(sansMarqueurs(texte));
          defilerEnBas();
        }
      } else if (nom === "status") {
        const derniere = etapes[etapes.length - 1];
        if (derniere && derniere.cle && derniere.cle === d.cle) Object.assign(derniere, d);
        else etapes.push({ ...d });
        if (visible()) {
          dessinerEtapes();
          dessinerPanneau();
        }
      } else if (nom === "proposal") {
        propose = d;
        if (visible()) {
          bloc.append(carteProposition(d, c, d.index ?? c.messages.length));
          defilerEnBas();
        }
      } else if (nom === "autorisation") {
        if (visible()) {
          bloc.append(carteAutorisation(d, c));
          defilerEnBas();
        }
      } else if (nom === "debit") {
        puce.textContent = `${Math.round(d.tps || 0)} jetons/s…`;
      } else if (nom === "title") {
        c.title = d.title;
        const l = liste?.find((x) => x.id === c.id);
        if (l) l.title = d.title;
        if (visible()) dessinerEnTete();
        dessinerListe();
      } else if (nom === "done") {
        fini = true;
        if (typeof d.text === "string" && d.text && d.text !== texte) {
          texte = d.text;
          md.innerHTML = markdown(sansMarqueurs(texte));
        }
        puce.textContent = (libelleModele(d) || "") + (d.interrompu ? " · interrompue" : "");
        dessinerEtapes(true);
        c.messages.push({ role: "assistant", content: texte, model: d.model, tier: d.tier, usd: d.usd, mesures: d.mesures, proposal: propose || undefined });
      } else if (nom === "error") {
        erreurServeur = d;
      }
    }, { signal: ctrl.signal });
    if (erreurServeur) {
      // La tour a annulé ce message : le renvoyer est sûr.
      if (texteSam) c.messages.pop();
      vider(md, h("p", { class: "msg-erreur" }, (erreurServeur.message || "Erreur de la tour.") + (erreurServeur.code ? ` (code ${erreurServeur.code})` : "")),
        texteSam ? h("div", { class: "rangee", style: { marginTop: "8px" } }, bouton("Renvoyer", { classe: "papier petit", icone: "rafraichir", onclick: () => { bloc.remove(); bulleSam?.remove(); envoyerMessage(texteSam); } })) : null);
      dessinerEtapes(true);
    } else if (!fini) {
      vider(md, h("p", { class: "aide" }, "La connexion s'est coupée : je relis la conversation…"));
      setTimeout(() => visible() && recharger(c.id), 1500);
    }
  } catch (err) {
    if (err.nature === "annule") return;
    if (err.nature === "reseau" && !texte) {
      if (texteSam) {
        c.messages.pop();
        bulleSam?.remove();
        refs.champ.value = texteSam;
        ajusterChamp();
      }
      bloc.remove();
      dire("La tour ne répond pas : ton message est revenu dans le champ.", { genre: "erreur", action: texteSam ? { libelle: "Réessayer", faire: () => soumettre() } : null });
    } else if (err.nature === "reseau") {
      vider(md, h("p", { class: "aide" }, "La connexion s'est coupée pendant la réponse : je relis la conversation…"));
      setTimeout(() => visible() && recharger(c.id), 2000);
    } else {
      if (texteSam) c.messages.pop();
      vider(md, h("p", { class: "msg-erreur" }, err.message), texteSam ? h("div", { class: "rangee", style: { marginTop: "8px" } }, bouton("Renvoyer", { classe: "papier petit", onclick: () => { bloc.remove(); bulleSam?.remove(); envoyerMessage(texteSam); } })) : null);
    }
  } finally {
    if (envoi?.ctrl === ctrl) envoi = null;
    majComposeur();
    if (visible()) dessinerPanneau();
    marquerLu({ id: c.id, updatedAt: Date.now() });
    chargerListe();
    if (fileApres.length && visible()) {
      const suivant = fileApres.shift();
      majComposeur();
      setTimeout(() => envoyerMessage(suivant), 300);
    }
  }
}

async function interrompre() {
  if (!envoi) return;
  const id = envoi.convId;
  refs.stop.disabled = true;
  try {
    await ecrire(`/api/conversations/${seg(id)}/stop`, {});
    dire("Réponse interrompue : ce qui était écrit est gardé.");
  } catch (err) {
    envoi?.ctrl.abort();
    direErreur(err, null, "Pas interrompue");
  } finally {
    refs.stop.disabled = false;
  }
}

// --- Le panneau : jauge du contexte, Compacter, étapes ---
const NOMBRE = new Intl.NumberFormat("fr-FR");
function dernieresMesures(c) {
  for (let i = (c?.messages?.length || 0) - 1; i >= 0; i--) if (c.messages[i].mesures?.contexte) return c.messages[i];
  return null;
}
function dessinerPanneau() {
  const p = refs.panneau;
  if (!p) return;
  const c = courante;
  const blocs = [];
  if (c?.prive) blocs.push(h("div", { class: "carte-privee" }, h("strong", null, icone("cadenas"), "Privée"), h("p", null, "Sur tes machines seulement.")));
  const m = dernieresMesures(c);
  if (m && sait("jauge-v1")) {
    const me = m.mesures;
    const fenetre = me.fenetre || 1;
    const part = Math.min(1, me.contexte / fenetre);
    const rep = me.repartition || {};
    const segs = [["systeme", "Consignes et mémoire", "var(--encre-3)"], ["conversation", "Conversation", "var(--signal)"], ["outils", "Outils et pages lues", "var(--encre-2)"], ["reponse", "Réponse", "var(--fond-3)"]].filter(([k]) => rep[k] > 0);
    blocs.push(h("section", { class: "jauge", "aria-label": "Jauge du contexte" },
      h("h2", { class: "titre-section" }, "Contexte"),
      h("p", { class: "carte-titre chiffres" }, `${Math.round(part * 100)} %`),
      h("div", { class: "barre", role: "img", "aria-label": `${Math.round(part * 100)} % du contexte utilisé` },
        segs.length ? segs.map(([k, , coul]) => h("span", { style: { width: `${(rep[k] / fenetre) * 100}%`, background: coul } })) : h("span", { style: { width: `${part * 100}%`, background: "var(--signal)" } })),
      h("div", { class: "chiffres-jauge" }, h("span", null, NOMBRE.format(me.contexte)), h("span", null, `${NOMBRE.format(me.fenetre)} jetons`)),
      segs.length ? h("ul", { class: "legende" }, segs.map(([k, lib, coul]) => h("li", null, h("i", { style: { background: coul } }), lib, h("span", { class: "mono", style: { marginLeft: "auto" } }, NOMBRE.format(rep[k]))))) : null,
      me.tps ? h("p", { class: "aide", style: { marginTop: "8px" } }, `${String(me.tps).replace(".", ",")} jetons/s${me.premierMs ? ` · premier mot en ${(me.premierMs / 1000).toFixed(1).replace(".", ",")} s` : ""}`) : null,
      libelleModele(m) ? h("p", { class: "aide" }, libelleModele(m)) : null));
  } else if (c?.id) {
    blocs.push(h("section", { class: "jauge" }, h("h2", { class: "titre-section" }, "Contexte"), h("p", { class: "aide" }, "La jauge apparaît après une réponse du modèle local.")));
  }
  if (c?.id && sait("compactage-v1") && (c.messages?.length || 0) >= 4) {
    const btn = bouton("Compacter", { classe: "papier", icone: "compresser", titre: "Résumer le début du fil pour alléger le contexte (modèle local)" });
    btn.addEventListener("click", () => occupe(btn, async () => {
      try {
        const r = await ecrire(`/api/conversations/${seg(c.id)}/compacter`, {}, { delai: 120000 });
        dire(r?.compacte ? `Compacté : ${r.resumes} message${r.resumes > 1 ? "s" : ""} résumé${r.resumes > 1 ? "s" : ""}. La suite repart plus légère.` : r?.raison === "deja-fait" ? "Déjà compacté." : "Rien à résumer pour l'instant.", { genre: "succes" });
      } catch (err) {
        direErreur(err, null, "Pas compacté");
      }
    }));
    blocs.push(h("section", null, h("h2", { class: "titre-section" }, "Alléger"), h("p", { class: "aide", style: { marginBottom: "8px" } }, "Rémy résume le début du fil sur la tour ; la conversation reste lisible en entier."), btn));
  }
  blocs.push(h("section", null, h("h2", { class: "titre-section" }, "Étapes"),
    etapes.length ? h("div", { class: "etapes" }, etapes.map((e, i) => h("div", { class: `etape${envoi && i === etapes.length - 1 ? " courante" : ""}` }, h("span", { class: "point" }), h("span", null, e.text), h("span", { class: "t" }, `${((e.t || 0) / 1000).toFixed(1).replace(".", ",")} s`))))
      : h("p", { class: "aide" }, "Ce que fait Rémy pendant sa prochaine réponse : relire ton planning, chercher sur le web en local, lire des pages…")));
  vider(p, blocs);
}

// --- Dictée (micro du PC, transcrite par la tour) ---
let enregistreur = null;
async function dicter() {
  if (enregistreur) {
    enregistreur.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    dire("La dictée n'est pas disponible ici (micro non accessible).", { genre: "erreur" });
    return;
  }
  let flot;
  try {
    flot = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    dire("Micro refusé : autorise-le pour cette page, puis réessaie.", { genre: "erreur" });
    return;
  }
  const morceaux = [];
  const type = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
  enregistreur = new MediaRecorder(flot, type ? { mimeType: type } : undefined);
  const debut = Date.now();
  refs.micro.classList.add("signal");
  refs.micro.setAttribute("aria-label", "Arrêter la dictée");
  refs.micro.title = "Arrêter la dictée";
  const fermer = dire("J'écoute… touche le micro pour finir.", { duree: 0 });
  enregistreur.ondataavailable = (e) => e.data.size && morceaux.push(e.data);
  enregistreur.onstop = async () => {
    fermer();
    flot.getTracks().forEach((t) => t.stop());
    refs.micro.classList.remove("signal");
    refs.micro.setAttribute("aria-label", "Dicter");
    refs.micro.title = "Dicter";
    enregistreur = null;
    const blob = new Blob(morceaux, { type: type || "audio/webm" });
    const secondes = (Date.now() - debut) / 1000;
    if (blob.size < 1000) return dire("Rien entendu.", { genre: "erreur" });
    await occupe(refs.micro, async () => {
      try {
        const q = new URLSearchParams({ type: (type || "audio/webm").split(";")[0], dur: secondes.toFixed(1) });
        if (courante?.prive) q.set("prive", "1");
        const r = await fetch(`/api/transcribe?${q}`, { method: "POST", body: blob, headers: { "Content-Type": blob.type }, credentials: "same-origin" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.message || d.error || `Erreur ${r.status}`);
        refs.champ.value = (refs.champ.value ? refs.champ.value + " " : "") + (d.text || "");
        ajusterChamp();
        refs.champ.focus();
      } catch (err) {
        dire(`Dictée pas transcrite : ${err.message}`, { genre: "erreur" });
      }
    });
  };
  enregistreur.start();
}
