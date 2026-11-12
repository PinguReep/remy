// L'arbre des projets (arbre-v1) et le verrou de « Ce que Rémy a compris »
// (verrou-v1) : la logique sans écran, partagée par Projets et Rémy.
//
// Chaque champ d'une fiche (pourquoi, état, où on en est) a une ORIGINE :
//   - « deduit »   : Rémy l'a déduit, sans IA, et dit de quoi (`source`) ;
//   - « confirme » : Sam a dit « C'est ça » à une déduction (source gardée) ;
//   - « ecrit »    : Sam l'a écrit ou corrigé.
// L'écran montre toujours laquelle : une déduction n'est jamais présentée
// comme un fait.

export const CHAMPS = ["pourquoi", "etat", "point"];
export const NOMS_CHAMPS = { pourquoi: "Pourquoi", etat: "État", point: "Où on en est" };
export const ETATS = ["en_cours", "en_attente", "en_pause", "fait"];
// La pastille : une FORME et un mot (jamais la couleur seule).
export const PASTILLES = {
  en_cours: { libelle: "en cours", forme: "plein" },
  en_attente: { libelle: "en attente", forme: "sablier" },
  en_pause: { libelle: "en pause", forme: "pause" },
  fait: { libelle: "fait", forme: "coche" },
};
const JOUR = 86_400_000;
export const VIEUX_JOURS = 21;

/** « aujourd'hui », « hier », « il y a 3 j », « il y a 2 mois ». */
const jourDe = (ms) => {
  const d = new Date(ms);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / JOUR;
};
/** En jours du calendrier (heure de l'appareil) : hier soir, c'est « hier ». */
export function age(ms, maintenant = Date.now()) {
  if (!Number.isFinite(ms)) return null;
  const j = jourDe(maintenant) - jourDe(ms);
  if (j <= 0) return "aujourd'hui";
  if (j === 1) return "hier";
  if (j < 60) return `il y a ${j} j`;
  return `il y a ${Math.round(j / 30)} mois`;
}
export const vieux = (ms, maintenant = Date.now()) => Number.isFinite(ms) && maintenant - ms > VIEUX_JOURS * JOUR;

/** La valeur d'un champ : celle que Sam tient (confirmée ou écrite), sinon la proposition de Rémy. */
export function valeur(vue, champ) {
  const f = vue?.fiche?.[champ];
  if (f?.texte) return { texte: f.texte, origine: f.origine === "confirme" ? "confirme" : "ecrit", source: f.source || null, a: f.a ?? null };
  const p = vue?.propositions?.[champ];
  if (p?.texte) return { texte: p.texte, origine: "deduit", source: p.source || null, a: null, memoire: Boolean(p.memoire) };
  return null;
}

/** La proposition de Rémy qui diffère de la valeur tenue (ou qui la remplit). */
export const proposition = (vue, champ) => (vue?.propositions?.[champ]?.texte ? { champ, ...vue.propositions[champ] } : null);

/** La pastille d'un nœud : { code, libelle, forme, propose } ou null. */
export function pastille(vue) {
  const v = valeur(vue, "etat");
  const p = v && PASTILLES[v.texte];
  return p ? { code: v.texte, ...p, propose: v.origine === "deduit" } : null;
}

/**
 * Ce que la ligne de l'arbre montre sous le nom, lisible sans clic :
 * { pastille, ligne: { champ, texte, origine, age, vieux }, pourquoi } —
 * « où on en est » d'abord, sinon « pourquoi ». `pourquoi` : la seconde
 * ligne quand les deux existent.
 */
export function ligneArbre(vue, maintenant = Date.now()) {
  const point = valeur(vue, "point");
  const pq = valeur(vue, "pourquoi");
  const avecAge = (v, champ) => (v ? { champ, texte: v.texte, origine: v.origine, age: v.origine === "deduit" ? null : age(v.a, maintenant), vieux: v.origine !== "deduit" && vieux(v.a, maintenant) } : null);
  const ligne = avecAge(point, "point") || avecAge(pq, "pourquoi");
  return { pastille: pastille(vue), ligne, pourquoi: point && pq ? avecAge(pq, "pourquoi") : null };
}

/** D'où vient un champ, en clair : « Confirmé par toi hier — d'après 3 tâches Motion ». */
export function origine(v, maintenant = Date.now()) {
  if (!v) return "";
  const quand = age(v.a, maintenant);
  if (v.origine === "deduit") return `Proposé par Rémy${v.source ? `, ${v.source}` : ""}${v.memoire ? " (sa mémoire)" : ""}`;
  if (v.origine === "confirme") return `Confirmé par toi${quand ? ` ${quand}` : ""}${v.source ? ` — Rémy l'avait déduit ${v.source}` : ""}`;
  return `Écrit par toi${quand ? ` ${quand}` : ""}`;
}

export const texteEtat = (code) => PASTILLES[code]?.libelle || code || "";
/** Le texte d'un champ pour une phrase (l'état en mots). */
export const texteChamp = (champ, texte) => (champ === "etat" ? texteEtat(texte) : texte);

export const cheminTexte = (vue) => (Array.isArray(vue?.chemin) ? vue.chemin.join(" › ") : vue?.nom || "");

/** L'adresse d'un nœud dans Projets. */
export function hrefNoeud(noeud) {
  const m = /^(dossier|motion):(.+)$/.exec(String(noeud || ""));
  return m ? `#/projets/${m[1]}/${encodeURIComponent(m[2])}` : "#/projets";
}

/** Le corps de « C'est ça » : la déduction devient confirmée, sa source gardée. */
export const corpsConfirmer = (champ, p) => ({ [champ]: { texte: p.texte, origine: "confirme", source: p.source || null } });
/** Le corps d'une correction : les mots de Sam. */
export const corpsCorriger = (champ, texte) => ({ [champ]: { texte: String(texte || "").replace(/\s+/g, " ").trim().slice(0, 240), origine: "ecrit" } });
/** Le corps de « Pas ça » : Rémy ne la repropose plus tant qu'elle ne change pas. */
export const corpsEcarter = (champ, p) => ({ ecarter: { champ, texte: p.texte } });

/** La fiche relue par la tour, posée sur la vue (sans attendre une relecture de l'arbre). */
export function avecFiche(vue, fiche) {
  if (!vue || !fiche) return vue;
  const champs = {};
  const propositions = { ...(vue.propositions || {}) };
  for (const c of CHAMPS) {
    champs[c] = fiche[c] || null;
    const p = propositions[c];
    if (p && (fiche.ecartes?.[c] === p.texte || fiche[c]?.texte === p.texte)) delete propositions[c];
  }
  return { ...vue, fiche: champs, propositions };
}

/** Les nœuds proposés par « Rattacher à… » : tous, dans l'ordre, filtrés par mots (accents ignorés). */
const cle = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function choixRattacher(noeuds, recherche = "") {
  const mots = cle(recherche).split(/\s+/).filter(Boolean);
  return (Array.isArray(noeuds) ? noeuds : []).filter((x) => x?.noeud && (!mots.length || mots.every((m) => cle(cheminTexte(x)).includes(m))));
}

/** Le bandeau en tête d'une conversation rattachée. */
export function bandeau(vue, maintenant = Date.now()) {
  if (!vue) return null;
  const pq = valeur(vue, "pourquoi");
  const point = valeur(vue, "point");
  return { chemin: cheminTexte(vue), href: hrefNoeud(vue.noeud), pastille: pastille(vue), pourquoi: pq ? { ...pq, age: pq.origine === "deduit" ? null : age(pq.a, maintenant) } : null, point: point ? { ...point, age: point.origine === "deduit" ? null : age(point.a, maintenant) } : null };
}

// --- Le verrou ---

/** Ce que dit l'écran du verrou : « Déverrouillé encore 8 min », etc. */
export function phraseVerrou(etat, maintenant = Date.now()) {
  if (!etat) return "État du verrou inconnu.";
  if (etat.disponible === false) return etat.raison || "Pas de verrou sur cette tour.";
  if (etat.verrouille) return `Verrouillé. Ressaisis le mot de passe de Rémy : la vue reste ouverte ${etat.dureeMin || 10} minutes, puis se referme.`;
  const min = Math.max(0, Math.ceil(((etat.jusqua || 0) - maintenant) / 60_000));
  return min > 0 ? `Déverrouillé encore ${min} min.` : "Se referme maintenant.";
}

// Dit à l'écran, tel quel : ce que le verrou protège, et ce qu'il ne protège pas.
export const PROTEGE = [
  "Ce que la mémoire de Rémy dit de toi : cette vue, Réglages › Mémoire et l'export complet.",
  "La tour le vérifie à chaque demande, pour cette session seulement ; il se referme seul après quelques minutes, quand tu le demandes, ou quand tu te déconnectes.",
];
export const NE_PROTEGE_PAS = [
  "Le disque de la tour : sa base n'est pas chiffrée au repos. Le verrou protège l'écran et l'accès par le réseau, pas le disque.",
  "Les fiches de l'arbre et tes priorités : Projets et Ce qui compte en ont besoin tout le temps, elles restent visibles sans verrou. Une ligne de mémoire que tu confirmes dans une fiche y devient visible aussi.",
  "L'app iPhone : elle ne sait pas encore déverrouiller et lit toujours la mémoire sans ressaisie.",
  "Ce que Rémy te répond dans une conversation : il se sert de sa mémoire pour répondre.",
];
