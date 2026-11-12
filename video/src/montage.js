// Le montage, en un seul endroit : la place de chaque scène sur la ligne de
// temps et ses « repères » (l'instant où une carte apparaît, où un son
// tombe). La vidéo (src/) ET la bande-son (scripts/sons.mjs) lisent ce fichier :
// une image et son bruitage ne peuvent pas se décaler.
//
// Tout se cale sur public/minutage.json (scripts/minutage.mjs), c'est-à-dire
// sur la voix réellement enregistrée : une voix plus lente allonge la scène.
// JavaScript simple (pas de TypeScript) pour que Node l'importe tel quel.

export const FPS = 30;
export const LARGEUR = 1920;
export const HAUTEUR = 1080;

// avant : silence avant la première phrase ; apres : après la dernière (s).
const REGLAGES = {
  "01-probleme": { avant: 1.0, apres: 0.5 },
  "02-arrivee": { avant: 0.9, apres: 2.0 },
  "03-outils": { avant: 0.3, apres: 0.5 },
  "04-priorites": { avant: 0.3, apres: 0.5 },
  "05-pourquoi": { avant: 0.5, apres: 0.5 },
  "06-memoire": { avant: 0.3, apres: 0.5 },
  "07-chercher": { avant: 0.3, apres: 0.7 },
  "08-temps": { avant: 0.3, apres: 0.8 },
  "09-chez-toi": { avant: 0.3, apres: 2.6 },
};

// Repères : { nom, phrase, decalage (s, après le début de la phrase), son? }.
// `fin: true` : compté depuis la fin de la phrase. Les sons existent dans
// scripts/sons.mjs (souffle, pop, clic, ding, valide, sonnerie, touche, impact).
const REPERES = {
  "01-probleme": [
    { nom: "notif1", phrase: 0, decalage: -1.1, son: "ding" },
    { nom: "notif2", phrase: 0, decalage: -0.4, son: "ding" },
    { nom: "notif3", phrase: 0, decalage: 0.9, son: "ding" },
    { nom: "notif4", phrase: 0, decalage: 1.7, son: "ding" },
    { nom: "agents", phrase: 1, decalage: 0, son: "pop" },
    { nom: "notif5", phrase: 1, decalage: 0.8, son: "ding" },
    { nom: "notif6", phrase: 1, decalage: 1.3, son: "ding" },
    { nom: "gel", phrase: 2, decalage: -0.15, son: "souffle" },
    { nom: "chef", phrase: 3, decalage: 0 },
  ],
  "02-arrivee": [
    { nom: "repli", phrase: 0, decalage: -1.1, son: "souffle" },
    { nom: "logo", phrase: 0, decalage: -0.35, son: "impact" },
    { nom: "ecran", phrase: 1, decalage: 0.3, fin: true, son: "pop" },
  ],
  "03-outils": [
    { nom: "hub", phrase: 0, decalage: 0.1, son: "pop" },
    { nom: "t3", phrase: 1, decalage: 0.5, son: "clic" },
    { nom: "claude", phrase: 1, decalage: 2.6, son: "clic" },
    { nom: "chatgpt", phrase: 2, decalage: 0.3, son: "clic" },
    { nom: "motion", phrase: 3, decalage: 0.4, son: "clic" },
    { nom: "proposition", phrase: 3, decalage: 2.4, son: "pop" },
    { nom: "valide", phrase: 3, decalage: 3.4, son: "valide" },
  ],
  "04-priorites": [
    { nom: "liste", phrase: 0, decalage: 0, son: "pop" },
    { nom: "neglige", phrase: 1, decalage: 1.8, son: "clic" },
    { nom: "indices", phrase: 2, decalage: 0.2, son: "souffle" },
    { nom: "reordonne", phrase: 2, decalage: 1.6 },
    { nom: "geste", phrase: 2, decalage: 0, fin: true, son: "valide" },
  ],
  "05-pourquoi": [
    { nom: "touche", phrase: 1, decalage: 0.1, son: "touche" },
    { nom: "feuille", phrase: 1, decalage: 0.35, son: "souffle" },
    { nom: "pourquoi", phrase: 1, decalage: 2.0 },
    { nom: "accent", phrase: 2, decalage: 0, son: "pop" },
  ],
  "06-memoire": [
    { nom: "racine", phrase: 0, decalage: 0, son: "pop" },
    { nom: "branches", phrase: 1, decalage: 1.6, son: "souffle" },
    { nom: "feuilles", phrase: 2, decalage: 0.2 },
    { nom: "ouenest", phrase: 3, decalage: 0, son: "pop" },
  ],
  "07-chercher": [
    { nom: "telephone", phrase: 0, decalage: 0 },
    { nom: "rappel", phrase: 1, decalage: 0.3, son: "ding" },
    { nom: "notif", phrase: 1, decalage: 2.6, son: "ding" },
    { nom: "appel", phrase: 2, decalage: 0.5, son: "sonnerie" },
    { nom: "agent", phrase: 3, decalage: 0, son: "pop" },
  ],
  "08-temps": [
    { nom: "tri", phrase: 0, decalage: 0, son: "souffle" },
    { nom: "focus", phrase: 1, decalage: 0, son: "valide" },
  ],
  "09-chez-toi": [
    { nom: "appareils", phrase: 0, decalage: 0, son: "pop" },
    { nom: "tour", phrase: 1, decalage: 0, son: "clic" },
    { nom: "logo", phrase: 2, decalage: -0.25, son: "impact" },
  ],
};

// Phrases déjà écrites en grand à l'image : pas de sous-titre en double.
const SANS_SOUS_TITRE = { "01-probleme": [2, 3], "02-arrivee": [0, 1], "08-temps": [1], "09-chez-toi": [2] };

const f = (s) => Math.round(s * FPS);

/**
 * La ligne de temps, en images. `minutage` : le contenu de public/minutage.json.
 * Chaque scène : { id, debut, duree, voix: { debut, fichier }, phrases:
 * [{ texte, debut, fin }] (relatives au début de la scène), reperes: { nom: image } }.
 */
export function construire(minutage) {
  let t = 0;
  const scenes = minutage.scenes.map((s) => {
    const r = REGLAGES[s.id] || { avant: 0.4, apres: 0.6 };
    const voixDebut = f(r.avant);
    const duree = voixDebut + f(s.duree) + f(r.apres);
    const phrases = s.phrases.map((p, i) => ({ texte: p.texte, debut: voixDebut + f(p.debut), fin: voixDebut + f(p.fin), sousTitre: !(SANS_SOUS_TITRE[s.id] || []).includes(i) }));
    const reperes = {};
    const sons = [];
    for (const x of REPERES[s.id] || []) {
      const p = phrases[Math.min(x.phrase, phrases.length - 1)];
      const image = Math.max(0, Math.min(duree - 1, (x.fin ? p.fin : p.debut) + f(x.decalage)));
      reperes[x.nom] = image;
      if (x.son) sons.push({ son: x.son, image: t + image });
    }
    const scene = { id: s.id, debut: t, duree, voix: { debut: voixDebut, fichier: s.fichier }, phrases, reperes, sons };
    t += duree;
    return scene;
  });
  return { fps: FPS, total: t, scenes };
}

/** Une scène du montage par son identifiant. */
export const scene = (m, id) => m.scenes.find((s) => s.id === id);
