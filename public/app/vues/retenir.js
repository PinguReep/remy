// « Retenir » un long texte (le port de RetenirInfosVue, RetenirVue.swift) :
// Rémy (le modèle local, sur les machines de Sam) propose les infos qu'il
// garderait, Sam coche, seules les infos cochées entrent dans sa mémoire — le
// texte entier n'est pas gardé. « Tout le texte, Rémy trie seul » reste
// possible : c'est l'ancien « Retenir ». Les deux appels sont des gestes de
// Sam (leur coût est journalisé par la tour, lib/analyses.js).
// Contrat D : ouvrirRetenir({ texte, source = "note" }) → Promise<{ phrase } | null>.
// C'est l'appelant qui dit la phrase (bandeau) et vide son champ ; null : rien
// n'est retenu, le texte reste où il est.
import { api, nouvelId } from "../api.js";
import { h, vider, bouton, dire, feuille, texteErreur } from "../ui.js";

export const SOURCES = ["note", "chatgpt", "claude", "web"];
/** Une conversation privée n'entre jamais dans la mémoire (ConversationPrivee.pasDeMemoire). */
export const PAS_DE_MEMOIRE = "Conversation privée : rien n'entre dans la mémoire. Ouvre une conversation ordinaire pour noter une idée.";

/** « ta note », « cette réponse de ChatGPT », « cette réponse de Claude ». */
export function nomSource(source) {
  if (source === "chatgpt") return "cette réponse de ChatGPT";
  if (source === "claude") return "cette réponse de Claude";
  return "ta note";
}
/** « Retenir 3 infos ». */
export const libelleRetenir = (n) => `Retenir ${n} info${n > 1 ? "s" : ""}`;
/** La raison d'un échec, sans double point final. */
const raisonDe = (err) => texteErreur(err).replace(/\s+$/, "");

let ouverte = null;

export function ouvrirRetenir({ texte, source = "note", prive = false } = {}) {
  if (prive) {
    dire(PAS_DE_MEMOIRE);
    return Promise.resolve(null);
  }
  const t = String(texte || "").trim();
  if (!t) return Promise.resolve(null);
  if (ouverte) return ouverte;
  const s = SOURCES.includes(source) ? source : "note";
  let infos = [];
  let cochees = new Set();
  let chargement = true;
  let erreur = null;
  let envoi = false;
  let resultat = null;

  const haut = h("div", { class: "retenir-haut", role: "status", "aria-live": "polite" });
  const liste = h("div", { class: "retenir-infos" });
  const pied = h("p", { class: "aide retenir-pied" }, "Seules les infos cochées entrent dans sa mémoire ; le texte entier n'est pas gardé.");
  const principal = bouton(libelleRetenir(0), { classe: "plein", icone: "ampoule" });
  const tout = bouton("Tout le texte, Rémy trie seul", { classe: "texte retenir-tout" });
  const annuler = bouton("Annuler", { classe: "papier" });

  const dessiner = () => {
    vider(haut);
    vider(liste);
    if (chargement) ajouter(haut, h("span", { class: "dictee-roue", "aria-hidden": "true" }), h("span", null, `Rémy lit ${nomSource(s)}, sur tes machines…`));
    else if (erreur) {
      ajouter(haut, h("span", null, erreur));
      const re = bouton("Réessayer", { classe: "papier petit", icone: "rafraichir", onclick: () => charger() });
      haut.append(re);
    } else if (!infos.length) ajouter(haut, h("span", null, "Rémy n'y voit rien de nouveau à retenir sur toi. Tu peux quand même tout lui donner, il triera seul."));
    haut.hidden = !haut.childNodes.length;
    if (infos.length) {
      liste.append(h("h3", { class: "titre-section retenir-intertitre" }, "Ce que Rémy retiendrait"));
      infos.forEach((info, i) => {
        const coche = cochees.has(i);
        const ligne = h("button", { type: "button", class: "retenir-info", role: "checkbox", "aria-checked": String(coche), disabled: envoi },
          h("span", { class: "case", "aria-hidden": "true", "aria-checked": String(coche) }),
          h("span", { class: "corps" }, h("span", { class: "t" }, info.texte), info.section && info.section !== "Autre" ? h("span", { class: "section" }, info.section) : null));
        ligne.addEventListener("click", () => {
          if (cochees.has(i)) cochees.delete(i);
          else cochees.add(i);
          dessiner();
          liste.querySelectorAll(".retenir-info")[i]?.focus();
        });
        liste.append(ligne);
      });
    }
    principal.hidden = !infos.length;
    principal.disabled = envoi || !cochees.size;
    vider(principal.querySelector(".lib") || principal, envoi ? "…" : libelleRetenir(cochees.size));
    tout.disabled = chargement || envoi;
    tout.classList.toggle("fort", !chargement && !infos.length);
  };
  const ajouter = (el, ...enfants) => el.append(...enfants);

  async function charger() {
    chargement = true;
    erreur = null;
    dessiner();
    try {
      const r = await api("/api/capture/extraire", { methode: "POST", corps: { texte: t, source: s }, delai: 100000 });
      infos = (Array.isArray(r?.elements) ? r.elements : []).filter((x) => x && String(x.texte || "").trim()).map((x) => ({ texte: String(x.texte).trim(), section: x.section || null }));
      cochees = new Set(infos.map((_, i) => i));
    } catch (err) {
      if (err?.nature === "auth") {
        f.fermer(null);
        return;
      }
      infos = [];
      erreur = err?.nature === "serveur" && err.message ? err.message : "Rémy n'a pas pu lire ce texte. Tu peux tout lui donner, il triera seul.";
    } finally {
      chargement = false;
      if (f.el.isConnected) dessiner();
    }
    principal.focus();
  }

  async function envoyer(corps, delai) {
    if (envoi) return;
    envoi = true;
    dessiner();
    try {
      const r = await api("/api/capture", { methode: "POST", corps, delai });
      resultat = { phrase: r?.phrase || "Rémy l'a lu et retenu l'essentiel." };
      f.fermer(resultat);
    } catch (err) {
      envoi = false;
      if (err?.nature === "auth") {
        f.fermer(null);
        return;
      }
      dire(`Pas retenu : ${raisonDe(err)} Ton texte est toujours là.`, { genre: "erreur" });
      if (f.el.isConnected) dessiner();
    }
  }

  principal.addEventListener("click", () => {
    const choisis = infos.filter((_, i) => cochees.has(i)).map((x) => x.texte);
    if (choisis.length) envoyer({ choisis, source: s }, 90000);
  });
  tout.addEventListener("click", () => envoyer({ texte: t, source: s, idCapture: nouvelId() }, 95000));
  annuler.addEventListener("click", () => f.fermer(null));

  const f = feuille({
    titre: "Retenir",
    contenu: [haut, liste, pied],
    pied: [tout, h("span", { class: "retenir-espace" }), annuler, principal],
    classe: "feuille-retenir",
    avantFermeture: () => !envoi,
  });
  // Espace coche (le bouton de la ligne), Entrée valide, Échap ferme (la feuille).
  f.el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    const ici = document.activeElement;
    if (ici && ici !== principal && ici.tagName === "BUTTON" && !ici.classList.contains("retenir-info")) return;
    e.preventDefault();
    if (!principal.hidden && !principal.disabled) principal.click();
  });
  dessiner();
  charger();
  ouverte = f.fini.then((v) => (v && typeof v.phrase === "string" ? v : null)).finally(() => {
    ouverte = null;
  });
  return ouverte;
}
