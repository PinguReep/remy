// Les pièces jointes du chat (12/11), côté site et app Windows : les préparer
// (lire le fichier, réduire une image pour le modèle de vision local), les
// envoyer à la tour, et les montrer — dans le composeur (en attente) et dans
// le fil (vignette ouvrable en grand, ou puce téléchargeable), avec ce que
// Rémy en a lu. Les calculs sont dans ../analyse/pieces.js (testés).
import { api } from "../api.js";
import { h, icone, bouton, feuille } from "../ui.js";
import * as P from "../analyse/pieces.js";

/** Les octets d'un fichier en base64 (sans l'en-tête « data: »). */
function enBase64(blob) {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => ko(new Error("Fichier illisible sur cet ordinateur."));
    r.readAsDataURL(blob);
  });
}

/**
 * Une image réduite à P.COTE_VISION px (JPEG), pour le modèle de vision local
 * de la tour : l'original part tel quel à côté. null si le navigateur ne sait
 * pas la dessiner (HEIC) : la tour décidera avec l'original.
 */
async function apercuVision(fichier) {
  if (!P.DESSINABLES.has(P.extensionDe(fichier.name)) || typeof createImageBitmap !== "function") return null;
  try {
    const bmp = await createImageBitmap(fichier);
    const t = P.reduction(bmp.width, bmp.height);
    if (!t) return null;
    const c = document.createElement("canvas");
    c.width = t.largeur;
    c.height = t.hauteur;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, t.largeur, t.hauteur);
    g.drawImage(bmp, 0, 0, t.largeur, t.hauteur);
    bmp.close?.();
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return blob && blob.size <= 1_500_000 ? await enBase64(blob) : null;
  } catch {
    return null;
  }
}

/** Une pièce prête à partir (composeur) : { cle, fichier, nom, taille, famille, url? }. */
export function preparer(fichier, nom = fichier.name) {
  const famille = P.familleDe(nom);
  return {
    cle: `${nom}-${fichier.size}-${Math.random().toString(36).slice(2, 8)}`,
    fichier,
    nom,
    taille: fichier.size,
    famille,
    url: famille === "image" && P.DESSINABLES.has(P.extensionDe(nom)) ? URL.createObjectURL(fichier) : null,
    etat: "attente", // attente | envoi | erreur
  };
}
export const liberer = (p) => p?.url && URL.revokeObjectURL(p.url);

/** Envoie la pièce à la tour, qui la range (chiffrée) et la lit : rend sa fiche. */
export async function envoyer(convId, p) {
  const donnees = await enBase64(p.fichier);
  const apercu = p.famille === "image" ? await apercuVision(p.fichier) : null;
  // La tour lit avant de répondre (PDF, OCR, modèle de vision local) : délai large.
  return api(`/api/conversations/${encodeURIComponent(convId)}/pieces`, {
    methode: "POST",
    corps: { nom: p.nom, donnees, ...(apercu ? { apercu } : {}) },
    delai: 180000,
  });
}

const iconeDe = (famille) => (famille === "image" ? "image" : famille === "pdf" ? "fichier" : "note");

/** La puce d'une pièce en attente dans le composeur, avec « Retirer ». */
export function puceAttente(p, { retirer, desactive = false } = {}) {
  const etat = p.etat === "envoi" ? "Envoi et lecture…" : p.etat === "erreur" ? "Pas partie" : P.tailleLisible(p.taille);
  return h("div", { class: `remy-piece-attente ${p.etat}`, title: p.nom, "aria-busy": p.etat === "envoi" ? "true" : null },
    p.url ? h("img", { class: "remy-piece-mini", src: p.url, alt: "" }) : h("span", { class: "remy-piece-ic" }, icone(iconeDe(p.famille))),
    h("span", { class: "remy-piece-texte" }, h("span", { class: "nom" }, p.nom), h("span", { class: "aide" }, etat)),
    (() => {
      const b = bouton("", { classe: "texte icone petit", icone: "fermer", etiquette: `Retirer ${p.nom}`, titre: "Retirer", onclick: retirer });
      b.disabled = desactive || p.etat === "envoi";
      return b;
    })());
}

/** L'image en grand, dans une feuille ; « Télécharger » l'original. */
function ouvrirImage(convId, p) {
  feuille({
    titre: p.nom,
    sousTitre: `${P.tailleLisible(p.taille)} · ${P.mention(p)}`,
    large: true,
    classe: "remy-piece-feuille",
    contenu: h("img", { class: "remy-piece-grande", src: P.adresse(convId, p.id), alt: p.nom }),
    pied: [h("a", { class: "btn papier", href: P.adresse(convId, p.id, { telecharger: true }), download: p.nom }, icone("telecharger"), h("span", { class: "lib" }, "Télécharger"))],
  });
}

/** Les pièces d'un message de Sam, dans le fil. */
export function blocPieces(convId, pieces) {
  if (!convId || !Array.isArray(pieces) || !pieces.length) return null;
  return h("div", { class: "remy-pieces" }, ...pieces.map((p) => {
    const mention = h("span", { class: `remy-piece-mention ${P.estLue(p) ? "lue" : "non-lue"}` }, P.mention(p));
    if (p.famille === "image" && p.type !== "heic") {
      return h("button", { type: "button", class: "remy-piece-image", title: `${p.nom} — ouvrir en grand`, "aria-label": `${p.nom}, ${P.mention(p)} : ouvrir en grand`, onclick: () => ouvrirImage(convId, p) },
        h("img", {
          src: P.adresse(convId, p.id), alt: p.nom, loading: "lazy",
          onerror: (e) => e.currentTarget.replaceWith(h("span", { class: "remy-piece-ic" }, icone("image"))),
        }),
        h("span", { class: "remy-piece-legende" }, h("span", { class: "nom" }, p.nom), mention));
    }
    return h("a", { class: "remy-piece-fichier", href: P.adresse(convId, p.id, { telecharger: true }), download: p.nom, title: `Télécharger ${p.nom}` },
      h("span", { class: "remy-piece-ic" }, icone(iconeDe(p.famille))),
      h("span", { class: "remy-piece-texte" }, h("span", { class: "nom" }, p.nom), h("span", { class: "aide" }, `${P.tailleLisible(p.taille)}${p.pages ? ` · ${p.pages} p.` : ""}`), mention),
      icone("telecharger", "remy-piece-dl"));
  }));
}
