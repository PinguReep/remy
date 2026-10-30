// Les réponses de Rémy pas encore vues (OngletsView.swift : la pastille de
// l'onglet Rémy). Le même calcul que le point rouge de la liste des fils
// (analyse/remy.js, nonLu) : la dernière parole est celle de Rémy, plus
// récente que la marque de lecture gardée sur cet ordinateur, ni dans le fil
// ouvert, ni dans un fil importé. La pastille se pose sur les liens
// [data-vue='remy'] du rail et des onglets, et se cache à 0.
// Contrat F du plan de parité : demarrer(ctx) (main.js, au démarrage de la
// session) et maj(conversations) (vues/remy.js, après chaque lecture de la
// liste et à la fin d'une réponse). Rien au chargement : importable sous node.
import { api, sait } from "./api.js";
import { h, local } from "./ui.js";
import { nonLu, nombreNonLus, marqueNonLue, phraseNonVues, CLE_LUS } from "./analyse/remy.js";

let derniere = null; // la dernière liste lue (GET /api/conversations)
let branche = false;

/** Les marques de lecture : { id: updatedAt vu }, ou null avant la toute première liste. */
export const lus = () => local.lire(CLE_LUS, null);

/** Première liste lue sur cet ordinateur : tout ce qui existe déjà est lu (pas de pastille d'un coup). */
export function initialiser(liste) {
  if (lus() || !Array.isArray(liste)) return;
  const marques = {};
  for (const c of liste) marques[c.id] = c.updatedAt || 0;
  local.ecrire(CLE_LUS, marques);
}

/** Le fil est vu (ouvert, ou sa réponse finie sous les yeux de Sam). */
export function marquerLu(c) {
  if (!c?.id) return;
  const l = lus() || {};
  if ((l[c.id] || 0) >= (c.updatedAt || 0)) return;
  l[c.id] = c.updatedAt || Date.now();
  local.ecrire(CLE_LUS, l);
  dessiner();
}

/** « Marquer comme non lu » (comme Mail) : la dernière réponse redevient à voir. */
export function marquerNonLu(c) {
  if (!c?.id) return;
  const l = lus() || {};
  l[c.id] = marqueNonLue(c);
  local.ecrire(CLE_LUS, l);
  dessiner();
}

/** Le fil à l'écran : #/remy/<id>, et la fenêtre au premier plan. */
export function filOuvert() {
  if (typeof location === "undefined" || typeof document === "undefined" || document.visibilityState === "hidden") return null;
  const brut = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const [vue, ...reste] = brut.split("/").filter(Boolean);
  return vue === "remy" && reste.length && reste[0] !== "nouvelle" ? reste.join("/") : null;
}

const options = () => ({ lus: lus(), ouvert: filOuvert(), capacite: sait("non-lus-v1") });
export const estNonLu = (c) => nonLu(c, options());
export const compte = () => nombreNonLus(derniere, options());

/** La pastille sur les liens de Rémy (rail et onglets), et « (N) » dans le titre de la fenêtre. */
export function dessiner() {
  if (typeof document === "undefined") return;
  const n = derniere ? compte() : 0;
  for (const a of document.querySelectorAll("[data-vue='remy']")) {
    let p = a.querySelector(".pastille-compte");
    if (!n) {
      p?.remove();
      a.removeAttribute("aria-label");
      continue;
    }
    if (!p) {
      p = h("span", { class: "pastille-compte remy-pastille", "aria-hidden": "true" });
      a.append(p);
    }
    p.textContent = n > 99 ? "99+" : String(n);
    a.setAttribute("aria-label", `Rémy, ${phraseNonVues(n)}`);
  }
  const titre = document.title.replace(/^\(\d+\+?\) /, "");
  document.title = n ? `(${n > 99 ? "99+" : n}) ${titre}` : titre;
}

/** Une liste fraîche (vues/remy.js la passe après chaque lecture). */
export function maj(conversations) {
  if (Array.isArray(conversations)) {
    initialiser(conversations);
    derniere = conversations;
  }
  dessiner();
}

async function relire() {
  try {
    maj(await api("/api/conversations", { delai: 15000 }));
  } catch {
    // Tour injoignable, session perdue : la pastille garde ce qu'elle savait.
  }
}

/** Au démarrage de la session (main.js) : une lecture, puis à chaque retour au premier plan. */
export async function demarrer() {
  if (!branche && typeof document !== "undefined") {
    branche = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") relire();
    });
    // Un fil ouvert ne compte plus ; un fil quitté reste lu.
    window.addEventListener("hashchange", () => dessiner());
  }
  await relire();
}
