// Conversations : ce que tu as dit ailleurs (Claude Code, T3 Code, ChatGPT),
// lu et chiffré par la tour (docs/conversations-externes.md). Lecture seule :
// rien n'est écrit dans les sources, rien ne repart vers un service. La
// recherche est sans IA (mots exacts). Visible seulement si la tour annonce
// `conversations-externes-v1`.
import { api, ecrire, remplacer, supprimer, seg } from "../api.js";
import { h, ajouterA, vider, icone, bouton, dire, direErreur, squelette, blocErreur, vide, confirmer, quand, occupe, feuille, markdown, jourCourt } from "../ui.js";

const SOURCES = [["", "Toutes"], ["claude-code", "Claude Code"], ["t3", "T3 Code"], ["chatgpt", "ChatGPT"]];
const NOM = Object.fromEntries(SOURCES.filter(([id]) => id));
const AUTEUR = { utilisateur: "Toi", colle: "Toi (collé)", resume: "Résumé" };

let racine;
let ctx;
let etat = null;
let source = "";
let pages = null; // { conversations, suite, total }
let resultats = null; // recherche
let selection = null; // { source, id }
let refs = {};
let minuterieRecherche = null;

export default {
  async monter(el, args, contexte) {
    racine = el;
    ctx = contexte;
    selection = args.length >= 2 ? { source: args[0], id: decodeURIComponent(args[1]) } : null;
    refs.recherche = h("input", { class: "champ", type: "search", placeholder: "Chercher des mots (sans IA)", "aria-label": "Chercher dans les conversations externes" });
    refs.recherche.addEventListener("input", () => {
      clearTimeout(minuterieRecherche);
      minuterieRecherche = setTimeout(chercher, 300);
    });
    refs.filtres = h("div", { class: "rangee serree", role: "radiogroup", "aria-label": "Source" });
    refs.etat = h("p", { class: "aide" });
    refs.liste = h("div", null, squelette([0.8, 0.6, 0.7]));
    refs.detail = h("section", { class: "detail" });
    refs.grille = h("div", { class: "maitre-detail" },
      h("div", { class: "maitre" }, h("div", { class: "recherche-champ", style: { marginBottom: "10px" } }, icone("recherche"), refs.recherche, h("span", { class: "kbd" }, "/")), refs.filtres, h("div", { style: { margin: "8px 0" } }, refs.etat), refs.liste),
      refs.detail);
    vider(el,
      h("header", { class: "entete-ecran" },
        h("div", { class: "titres" }, h("div", { class: "sur-titre" }, "Claude Code · T3 Code · ChatGPT"), h("h1", { class: "titre-ecran" }, "Conversations")),
        h("div", { class: "actions-entete" },
          bouton("Sources", { classe: "papier", icone: "curseurs", onclick: panneauSources }),
          bouton("Lire maintenant", { classe: "plein", icone: "rafraichir", titre: "Relire Claude Code et T3 sur la tour", onclick: (e) => occupe(e.currentTarget, synchroniser) }))),
      refs.grille);
    dessinerFiltres();
    await Promise.all([chargerEtat(), chargerListe()]);
    dessinerDetail();
  },
  suivre(args) {
    selection = args.length >= 2 ? { source: args[0], id: decodeURIComponent(args[1]) } : null;
    dessinerListe();
    dessinerDetail();
  },
  chercher() {
    refs.recherche?.focus();
  },
  actualiser() {
    chargerEtat();
  },
};

function dessinerFiltres() {
  vider(refs.filtres, SOURCES.map(([id, lib]) => {
    const b = h("button", { type: "button", class: "puce", role: "radio", "aria-pressed": String(source === id), "aria-checked": String(source === id) }, lib);
    b.addEventListener("click", () => {
      source = id;
      dessinerFiltres();
      if (refs.recherche.value.trim()) chercher();
      else chargerListe();
    });
    return b;
  }));
}

async function chargerEtat() {
  try {
    etat = await api("/api/conversations-externes");
    const t = etat.total || {};
    const derniere = Math.max(0, ...(etat.sources || []).map((s) => s.derniereReussie || 0));
    const erreurs = (etat.sources || []).filter((s) => s.erreur);
    vider(refs.etat,
      `${t.conversations ?? 0} conversation${t.conversations > 1 ? "s" : ""}`, derniere ? ` · lues ${quand(derniere)}` : "",
      etat.cle?.erreur ? h("span", { class: "risque", style: { display: "block" } }, icone("alerte"), etat.cle.erreur) : null,
      erreurs.map((s) => h("span", { class: "risque", style: { display: "block" } }, icone("alerte"), `${s.nom} : ${s.erreur.message}`)));
  } catch (err) {
    vider(refs.etat, h("span", { class: "risque" }, icone("alerte"), err.message));
  }
}

async function chargerListe({ suite = false } = {}) {
  resultats = null;
  const q = new URLSearchParams({ limite: "40" });
  if (source) q.set("source", source);
  if (suite && pages?.suite != null) q.set("decalage", String(pages.suite));
  if (!suite) vider(refs.liste, squelette([0.8, 0.6, 0.7, 0.5]));
  try {
    const r = await api(`/api/conversations-externes/liste?${q}`);
    pages = suite && pages ? { ...r, conversations: [...pages.conversations, ...(r.conversations || [])] } : r;
    dessinerListe();
  } catch (err) {
    vider(refs.liste, blocErreur(err, () => chargerListe()));
  }
}

async function chercher() {
  const q = refs.recherche.value.trim();
  if (!q) return chargerListe();
  vider(refs.liste, squelette([0.7, 0.6]));
  try {
    const p = new URLSearchParams({ q, limite: "30" });
    if (source) p.set("source", source);
    resultats = (await api(`/api/conversations-externes/chercher?${p}`)).resultats || [];
    dessinerListe();
  } catch (err) {
    vider(refs.liste, blocErreur(err, chercher));
  }
}

function lienConv(src, id, titre, meta, extrait) {
  const courant = selection?.source === src && selection?.id === id;
  return h("a", { class: "element-maitre", href: `#/conversations/${src}/${encodeURIComponent(id)}`, "aria-current": courant ? "page" : null, style: { minHeight: "56px", alignItems: "flex-start", padding: "8px 12px" } },
    h("span", { style: { minWidth: 0, flex: 1 } }, h("span", { class: "t", style: { display: "block" } }, titre || "Sans titre"),
      h("span", { class: "aide", style: { display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, meta),
      extrait ? h("span", { class: "aide", style: { display: "block" } }, extrait) : null));
}

function dessinerListe() {
  refs.grille.classList.toggle("detail-ouvert", Boolean(selection));
  if (resultats) {
    vider(refs.liste, resultats.length ? resultats.map((r) => lienConv(r.source, r.conversation, r.titre, `${NOM[r.source] || r.source} · ${quand(r.ts)}${r.projet ? ` · ${r.projet.nom}` : ""}`, r.extrait))
      : vide(null, "Aucun message ne contient ces mots."));
    return;
  }
  if (!pages) return;
  const convs = pages.conversations || [];
  if (!convs.length) {
    const aide = (etat?.sources || []).map((s) => s.aide).filter(Boolean)[0];
    vider(refs.liste, vide("Rien pour l'instant", aide?.message || "« Lire maintenant » relit Claude Code et T3 sur la tour ; un export ChatGPT s'envoie depuis « Sources ».", bouton("Sources", { classe: "papier", onclick: panneauSources })));
    return;
  }
  vider(refs.liste, convs.map((c) => lienConv(c.source, c.id, c.titre, `${NOM[c.source] || c.source} · ${quand(c.fin || c.debut)} · ${c.messages} message${c.messages > 1 ? "s" : ""}${c.projet ? ` · ${c.projet.nom}` : ""}`)),
    pages.suite != null ? bouton("Plus", { classe: "texte petit", onclick: (e) => occupe(e.currentTarget, () => chargerListe({ suite: true })) }) : null);
}

let lecture = null;
async function dessinerDetail() {
  if (!selection) {
    vider(refs.detail, h("section", { class: "carte" }, vide("Choisis une conversation", "Ce que tu as dit à Claude Code, T3 Code ou ChatGPT, lisible ici. Rémy s'en sert seulement avec le modèle local, et une conversation qui les cite devient privée."), digestNuit()));
    return;
  }
  const { source: src, id } = selection;
  vider(refs.detail, h("section", { class: "carte" }, squelette([0.6, 0.9, 0.8, 0.7], true)));
  try {
    lecture = await api(`/api/conversations-externes/conversations/${seg(src)}/${seg(id)}?limite=300`);
    if (selection?.id !== id) return;
    afficherLecture();
  } catch (err) {
    vider(refs.detail, h("section", { class: "carte" }, h("a", { class: "btn texte petit lien-retour-projets", href: "#/conversations" }, icone("retour"), "Conversations"), blocErreur(err, dessinerDetail)));
  }
}

function afficherLecture() {
  const c = lecture.conversation || {};
  const messages = lecture.messages || [];
  const plus = lecture.suite != null ? bouton("Suite de la conversation", { classe: "papier", onclick: (e) => occupe(e.currentTarget, async () => {
    try {
      const r = await api(`/api/conversations-externes/conversations/${seg(c.source)}/${seg(c.id)}?limite=300&apres=${encodeURIComponent(lecture.suite)}`);
      lecture = { ...r, messages: [...messages, ...(r.messages || [])] };
      afficherLecture();
    } catch (err) { direErreur(err); }
  }) }) : null;
  vider(refs.detail, h("section", { class: "carte" },
    h("a", { class: "btn texte petit lien-retour-projets", href: "#/conversations" }, icone("retour"), "Conversations"),
    h("div", { class: "sur-titre" }, `${NOM[c.source] || c.source}${c.projet ? ` · ${c.projet.nom}` : ""}`),
    h("h2", { class: "titre-ecran", style: { fontSize: "26px" } }, c.titre || "Sans titre"),
    h("p", { class: "aide", style: { margin: "4px 0 14px" } }, `${c.debut ? jourCourt(c.debut) : ""} · ${c.messages} message${c.messages > 1 ? "s" : ""} · lecture seule`),
    h("div", { class: "colonne", style: { display: "flex", flexDirection: "column", gap: "14px" } }, messages.map((m) => m.auteur === "assistant"
      ? h("div", { class: "msg-remy" }, h("div", { class: "auteur" }, c.assistant || "Assistant", h("span", { class: "aide mono" }, m.ts ? ` ${quand(m.ts)}` : "")), h("div", { class: "md", html: markdown(m.texte) }))
      : h("div", { class: m.auteur === "resume" ? "carte-privee" : "msg-sam", style: m.auteur === "resume" ? null : { maxWidth: "88%" } }, m.auteur === "resume" ? h("strong", null, "Résumé de Claude Code") : null, m.texte))),
    plus ? h("div", { class: "rangee", style: { marginTop: "14px" } }, plus) : null));
}

function digestNuit() {
  const zone = h("div", { style: { marginTop: "16px" } });
  api("/api/conversations-externes/nuit").then((r) => {
    const d = r?.digest;
    if (!d) return;
    vider(zone, h("h3", { class: "titre-section" }, `Cette nuit · conversations du ${jourCourt(new Date(`${d.jour}T12:00:00`).getTime())}`),
      d.ligne ? h("p", { class: "carte-titre" }, d.ligne) : null,
      d.decisions?.length ? [h("div", { class: "etat-mono", style: { marginTop: "10px" } }, "DÉCISIONS"), h("ul", { style: { margin: "6px 0 0 18px" } }, d.decisions.map((x) => h("li", null, x)))] : null,
      d.aFaire?.length ? [h("div", { class: "etat-mono", style: { marginTop: "10px" } }, "À FAIRE"), h("ul", { class: "liste" }, d.aFaire.map((x) => h("li", { class: "ligne" }, h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, x.texte), x.source ? h("div", { class: "meta" }, x.source) : null),
        bouton("Noter", { classe: "papier petit", icone: "plus", onclick: () => ctx.noter(x.texte) }))))] : null,
      h("p", { class: "aide", style: { marginTop: "8px" } }, "Des propositions : rien n'est fait seul."));
  }).catch(() => {});
  return zone;
}

async function synchroniser() {
  try {
    const r = await ecrire("/api/conversations-externes/synchroniser", source && source !== "chatgpt" ? { source } : {}, { delai: 300000 });
    const rates = Object.entries(r?.bilan?.sources || {}).filter(([, b]) => b && b.ok === false);
    dire(rates.length ? `Lu, sauf : ${rates.map(([id, b]) => `${NOM[id] || id} (${b.erreur?.message || "erreur"})`).join(", ")}.` : "Conversations relues.", { genre: rates.length ? "erreur" : "succes" });
    await Promise.all([chargerEtat(), chargerListe()]);
  } catch (err) {
    direErreur(err, null, "Pas relu");
  }
}

// --- Les sources : allumer, couper, oublier ; importer un export ChatGPT ---
async function panneauSources() {
  const contenu = h("div", null, squelette([0.6, 0.8]));
  const f = feuille({ titre: "Sources des conversations", sousTitre: "La tour lit, chiffre, n'écrit jamais dans les originaux.", large: true, contenu });
  const dessiner = async () => {
    try {
      etat = await api("/api/conversations-externes");
    } catch (err) {
      vider(contenu, blocErreur(err, dessiner));
      return;
    }
    const usage = etat.usage || {};
    const basculeUsage = (cle, titre, detail) => {
      const i = h("input", { type: "checkbox", role: "switch", disabled: usage.forceParLaTour });
      i.checked = usage[cle] !== false;
      i.addEventListener("change", async () => {
        try { etat = await remplacer("/api/conversations-externes/usage", { [cle]: i.checked }); } catch (err) { i.checked = !i.checked; direErreur(err); }
      });
      return h("label", { class: "bascule reglage" }, h("span", { class: "textes" }, h("strong", null, titre), h("span", null, detail)), i);
    };
    const fichier = h("input", { type: "file", accept: ".zip,.json,application/zip,application/json", class: "sr", id: "fichier-chatgpt" });
    fichier.addEventListener("change", () => importer(fichier.files?.[0], dessiner));
    vider(contenu,
      (etat.sources || []).map((s) => {
        const i = h("input", { type: "checkbox", role: "switch", disabled: s.forceParLaTour, "aria-label": `Lire ${s.nom}` });
        i.checked = Boolean(s.actif);
        i.addEventListener("change", async () => {
          try { etat = await remplacer(`/api/conversations-externes/sources/${seg(s.id)}`, { actif: i.checked }); dire(`${s.nom} : ${i.checked ? "allumée" : "coupée"}.`); } catch (err) { i.checked = !i.checked; direErreur(err); }
        });
        return h("div", { class: "reglage" },
          h("label", { class: "bascule" }, h("span", { class: "textes" }, h("strong", null, s.nom), h("span", null, s.forceParLaTour ? "Réglée sur la tour (remy.env)." : `${s.conversations ?? 0} conversations${s.derniereReussie ? ` · lue ${quand(s.derniereReussie)}` : ""}`)), i),
          s.erreur ? h("p", { class: "risque" }, icone("alerte"), `${s.erreur.message}${s.erreur.quoiFaire ? ` ${s.erreur.quoiFaire}` : ""}`) : null,
          s.aide ? h("p", { class: "aide" }, s.aide.message || "") : null,
          h("div", { class: "rangee serree" },
            s.id === "chatgpt" ? [h("label", { class: "btn papier petit", for: "fichier-chatgpt", tabindex: "0", onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fichier.click(); } } }, icone("envoyer"), "Envoyer l'export ChatGPT (.zip)"), fichier] : null,
            (s.conversations ?? 0) > 0 ? bouton("Oublier", { classe: "texte petit", onclick: async (e) => {
              if (!(await confirmer(`Oublier ${s.nom} ?`, { detail: "Tout ce qui en vient est effacé de la tour, et la lecture coupée. Tes conversations d'origine ne sont pas touchées.", libelle: "Oublier", danger: true }))) return;
              await occupe(e.currentTarget, async () => { try { const r = await supprimer(`/api/conversations-externes/sources/${seg(s.id)}`); dire(r?.message || "Oublié.", { genre: "succes" }); dessiner(); chargerListe(); chargerEtat(); } catch (err) { direErreur(err); } });
            } }) : null));
      }),
      h("h3", { class: "titre-section", style: { marginTop: "16px" } }, "Ce que Rémy en fait"),
      basculeUsage("chat", "Dans ses réponses", "Des passages proches de ta question, au modèle local seulement ; la conversation devient privée."),
      basculeUsage("nuit", "La nuit", "Relire les conversations de la veille : thèmes, décisions, choses à faire (propositions)."),
      etat.cle?.erreur ? h("div", { class: "reglage" }, h("p", { class: "risque" }, icone("alerte"), etat.cle.erreur), bouton("Tout effacer", { classe: "danger", onclick: async () => {
        if (!(await confirmer("Tout effacer ?", { detail: "La base des conversations externes est vidée ; « Lire maintenant » relit tes sources.", libelle: "Tout effacer", danger: true }))) return;
        try { const r = await supprimer("/api/conversations-externes/tout"); dire(r?.message || "Effacé.", { genre: "succes" }); dessiner(); } catch (err) { direErreur(err); }
      } })) : null);
  };
  await dessiner();
  return f;
}

/** L'export ChatGPT part en corps brut (XHR pour suivre l'envoi d'un gros .zip). */
function importer(fichier, apres) {
  if (!fichier) return;
  const fermer = dire(`Envoi de « ${fichier.name} »… 0 %`, { duree: 0 });
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/conversations-externes/chatgpt");
  xhr.setRequestHeader("Content-Type", fichier.name.endsWith(".json") ? "application/json" : "application/zip");
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const msg = document.querySelector(".bandeau:last-child .msg");
    if (msg) msg.firstChild.textContent = `Envoi de « ${fichier.name} »… ${Math.round((e.loaded / e.total) * 100)} %`;
  };
  xhr.onload = () => {
    fermer();
    let d = {};
    try { d = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status >= 200 && xhr.status < 300) {
      const b = d.bilan || {};
      dire(b.deja ? "Cet export était déjà importé." : `Import ChatGPT : ${b.nouvelles ?? 0} nouvelle${b.nouvelles > 1 ? "s" : ""}, ${b.misesAJour ?? 0} mise${b.misesAJour > 1 ? "s" : ""} à jour.`, { genre: "succes" });
      apres?.();
      chargerListe();
      chargerEtat();
    } else {
      dire(`${d.message || `Erreur ${xhr.status}`}${d.quoiFaire ? ` ${d.quoiFaire}` : ""}`, { genre: "erreur" });
    }
  };
  xhr.onerror = () => {
    fermer();
    dire("La tour ne répond pas : l'export n'est pas parti.", { genre: "erreur" });
  };
  xhr.send(fichier);
}
