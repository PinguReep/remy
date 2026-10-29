// Les gestes sur un rappel, partagés par Projets › Rappels et la carte
// « Rappels du jour » d'Aujourd'hui (comme LigneRappel de l'iPhone) : cocher,
// reporter, supprimer, chacun avec son bandeau « Annuler ». Le rappel garde
// son identifiant : un geste rejoué n'est pas doublé.
import { api, ecrire, seg } from "../api.js";
import { h, icone, bouton, dire, direErreur, feuille, quand, versChampDate, depuisChampDate, occupe } from "../ui.js";

/** Les rappels du jour (Carnet.duJour de l'iPhone) : pas faits, dus avant ce soir minuit (les retards compris). */
export function rappelsDuJour(rappels, maintenant = Date.now()) {
  const d = new Date(maintenant);
  const fin = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return (rappels || []).filter((r) => r && !r.fait && !r.supprime && typeof r.quand === "number" && r.quand < fin).sort((a, b) => a.quand - b.quand);
}

/** Les choix de « Reporter » (les mêmes que l'iPhone). */
export const choixReport = (m = new Date()) => {
  const a = (hh, mm, j) => new Date(m.getFullYear(), m.getMonth(), m.getDate() + j, hh, mm);
  const choix = [];
  choix.push(["Dans 1 h", new Date(Math.ceil((m.getTime() + 3600e3) / 900e3) * 900e3)]);
  if (m.getHours() < 18) choix.push(["Ce soir 19:00", a(19, 0, 0)]);
  choix.push(["Demain 9:00", a(9, 0, 1)]);
  const lundi = (1 - m.getDay() + 7) % 7 || 7;
  if (lundi > 1) choix.push(["Lundi 9:00", a(9, 0, lundi)]);
  return choix;
};

/** Écrit un rappel tel quel (id fixe) ; `avant` : de quoi annuler. */
export async function ecrireRappel(r, message, { avant, apres } = {}) {
  try {
    await ecrire("/api/rappels", { rappels: [{ id: r.id, texte: r.texte, quand: r.quand ?? null, fait: Boolean(r.fait), etiquettes: r.etiquettes || [] }] });
    dire(message, { genre: "succes", action: avant ? { libelle: "Annuler", faire: () => ecrireRappel(avant, "Annulé.", { apres }) } : null });
    apres?.();
    return true;
  } catch (err) {
    direErreur(err, () => ecrireRappel(r, message, { avant, apres }), "Rappel pas enregistré");
    return false;
  }
}

/** La feuille « Reporter » : dans 1 h, ce soir, demain, lundi, ou une date. */
export function reporter(r, { apres } = {}) {
  const champ = h("input", { class: "champ", type: "datetime-local", "aria-label": "Autre moment" });
  champ.value = versChampDate(new Date(r.quand && r.quand > Date.now() ? r.quand : Date.now() + 3600e3));
  let f;
  const choisir = (d) => {
    f.fermer();
    ecrireRappel({ ...r, quand: d.getTime() }, `« ${r.texte} » : ${quand(d.getTime())}.`, { avant: r, apres });
  };
  f = feuille({
    titre: "Reporter", sousTitre: r.texte,
    contenu: h("div", null, h("div", { class: "rangee serree" }, choixReport().map(([lib, d]) => h("button", { type: "button", class: "puce", onclick: () => choisir(d) }, lib))),
      h("div", { class: "ajout-ligne" }, champ, bouton("OK", { classe: "plein", onclick: () => { const d = depuisChampDate(champ.value); if (d && !Number.isNaN(d.getTime())) choisir(d); else dire("Choisis une date valide.", { genre: "erreur" }); } }))),
  });
}

/**
 * Une ligne de rappel : la case (fait), le texte et l'heure (en rouge si
 * passée), Reporter, Supprimer. `retirer()` / `remettre()` : l'écran tout de
 * suite ; `apres()` : relire ; `nomEtiquette(id)` : le nom d'une catégorie.
 */
export function ligneRappel(r, { apres, retirer, remettre, nomEtiquette = (id) => id } = {}) {
  const passe = r.quand && r.quand < Date.now() && !r.fait;
  const caseB = h("button", { type: "button", class: "case", role: "checkbox", "aria-checked": String(Boolean(r.fait)), "aria-label": r.fait ? `« ${r.texte} » : fait` : `Marquer « ${r.texte} » comme fait` });
  caseB.addEventListener("click", async () => {
    if (!r.fait) retirer?.();
    const ok = await ecrireRappel({ ...r, fait: !r.fait }, r.fait ? "Rouvert." : `« ${r.texte} » : fait.`, { avant: r, apres });
    if (!ok) remettre?.();
  });
  return h("li", { class: `ligne${r.fait ? " faite" : ""}` }, caseB,
    h("div", { class: "corps" }, h("div", { class: "titre-ligne" }, r.texte),
      h("div", { class: "meta" }, r.quand ? h("span", { class: passe ? "risque" : "mono" }, passe ? icone("alerte") : null, quand(r.quand)) : null,
        (r.etiquettes || []).map((id) => h("span", { class: "puce" }, nomEtiquette(id))))),
    !r.fait ? bouton("", { classe: "texte icone", icone: "horloge", etiquette: `Reporter « ${r.texte} »`, titre: "Reporter", onclick: () => reporter(r, { apres }) }) : null,
    bouton("", { classe: "texte icone", icone: "corbeille", etiquette: `Supprimer « ${r.texte} »`, titre: "Supprimer", onclick: (e) => occupe(e.currentTarget, async () => {
      try {
        retirer?.();
        await api(`/api/rappels/${seg(r.id)}`, { methode: "DELETE" });
        dire("Rappel supprimé.", { action: { libelle: "Annuler", faire: () => ecrireRappel(r, "Rappel remis.", { apres }) } });
        apres?.();
      } catch (err) {
        remettre?.();
        direErreur(err, null, "Pas supprimé");
      }
    }) }));
}
