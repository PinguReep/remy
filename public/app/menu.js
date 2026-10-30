// Le menu du clic droit (l'appui long de l'iPhone) : quelques actions près du
// pointeur, ou sous l'élément au clavier (Maj+F10, touche Menu). Flèches pour
// choisir, Entrée pour agir, Échap ou un clic à côté pour fermer.
// Fichier COMMUN à plusieurs lots du plan de parité (29/10) : chacun le crée
// à l'identique, octet pour octet ; on ne le modifie qu'après leur fusion.
import { h, icone } from "./ui.js";

let courant = null; // { menu, fermer(rendreFocus) }

/** Ferme le menu ouvert, s'il y en a un (le focus revient d'où il venait). */
export function fermerMenu() {
  courant?.fermer(true);
}

/**
 * Ouvre le menu près de `ou` : l'événement du clic droit (au pointeur) ou un
 * élément (juste dessous). `actions` : [{ libelle, icone?, danger?, desactive?, faire }],
 * les valeurs vides sont sautées. Rend le menu, ou null s'il n'y a rien à proposer.
 */
export function ouvrirMenu(ou, actions, { titre = "Actions" } = {}) {
  fermerMenu();
  const liste = (actions || []).filter(Boolean);
  if (!liste.length) return null;
  const retour = document.activeElement;
  const items = liste.map((a) => h("button", {
    type: "button", role: "menuitem", class: "btn texte", disabled: Boolean(a.desactive),
    style: { justifyContent: "flex-start", width: "100%", color: a.danger ? "var(--danger)" : "" },
    onclick: () => {
      courant?.fermer(false);
      a.faire?.();
      // Le focus revient d'où il venait, sauf si l'action l'a pris (une feuille ouverte).
      setTimeout(() => {
        if ((!document.activeElement || document.activeElement === document.body) && retour?.isConnected) retour.focus?.();
      }, 0);
    },
  }, a.icone ? icone(a.icone) : null, h("span", { class: "lib" }, a.libelle)));
  const menu = h("div", {
    class: "carte menu-contextuel", role: "menu", "aria-label": titre, popover: "manual",
    style: { position: "fixed", inset: "auto", margin: "0", padding: "6px", minWidth: "220px", maxWidth: "320px" },
  }, items);
  const dehors = (e) => {
    if (!menu.contains(e.target)) fermerMenu();
  };
  const fermer = (rendreFocus) => {
    if (courant?.menu !== menu) return;
    courant = null;
    document.removeEventListener("pointerdown", dehors, true);
    window.removeEventListener("blur", fermerMenu);
    window.removeEventListener("resize", fermerMenu);
    if (menu.matches(":popover-open")) menu.hidePopover();
    menu.remove();
    if (rendreFocus && retour?.isConnected) retour.focus?.();
  };
  menu.addEventListener("keydown", (e) => {
    const actifs = items.filter((b) => !b.disabled);
    const i = actifs.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // la feuille dessous reste ouverte
      fermerMenu();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const pas = e.key === "ArrowDown" ? 1 : -1;
      actifs[i < 0 ? (pas > 0 ? 0 : actifs.length - 1) : (i + pas + actifs.length) % actifs.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      (e.key === "Home" ? actifs[0] : actifs[actifs.length - 1])?.focus();
    } else if (e.key === "Tab") {
      e.preventDefault();
      fermerMenu();
    }
  });
  // Dans une feuille ouverte (modale), le reste de la page est inerte : le menu va dedans.
  const hote = [...document.querySelectorAll("dialog[open]")].pop() || document.body;
  hote.append(menu);
  menu.showPopover();
  courant = { menu, fermer };
  const b = ou instanceof Element ? ou.getBoundingClientRect() : null;
  const x = b ? b.left : ou.clientX;
  const y = b ? b.bottom + 4 : ou.clientY;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  document.addEventListener("pointerdown", dehors, true);
  window.addEventListener("blur", fermerMenu);
  window.addEventListener("resize", fermerMenu);
  (items.find((x) => !x.disabled) || menu).focus();
  return menu;
}

/**
 * Branche le menu sur `el` : clic droit, Maj+F10 et la touche Menu.
 * `actions` : un tableau, ou une fonction qui le rend au moment du geste.
 * Sans action à proposer, le menu du navigateur reste (copier, coller…).
 */
export function surMenu(el, actions, options) {
  const liste = () => ((typeof actions === "function" ? actions() : actions) || []).filter(Boolean);
  let parClavier = 0;
  el.addEventListener("keydown", (e) => {
    if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
    const l = liste();
    if (!l.length) return;
    e.preventDefault();
    e.stopPropagation();
    parClavier = Date.now();
    ouvrirMenu(el, l, options);
  });
  el.addEventListener("contextmenu", (e) => {
    const l = liste();
    if (!l.length) return;
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - parClavier < 400) return; // déjà ouvert au clavier
    ouvrirMenu(e, l, options);
  });
  return el;
}
