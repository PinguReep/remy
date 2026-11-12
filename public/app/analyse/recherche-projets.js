// Chercher dans Projets (12/11) : le port de RechercheProjets.swift. Dans ce
// que l'écran a déjà lu — projets Motion et leurs tâches, dossiers et leurs
// idées, listes et leurs articles, rappels (et leur note) —, sans IA, sans
// réseau, sans accents ni majuscules : chaque mot de la saisie doit commencer
// un mot du texte, dans n'importe quel ordre (« lait avo » trouve « Lait
// d'avoine »). Les résultats sont groupés par genre, le texte trouvé découpé
// en morceaux pour être mis en évidence, chacun avec l'écran qu'il ouvre.
// Module pur : importé par le site et par les tests node.
import { normaliser, mots, motsRequete } from "./recherche-reglages.js";

/** Les genres, dans l'ordre de l'écran. */
export const GENRES = Object.freeze([
  { id: "projet", titre: "Projets Motion" },
  { id: "tache", titre: "Tâches" },
  { id: "dossier", titre: "Dossiers" },
  { id: "note", titre: "Idées et notes" },
  { id: "liste", titre: "Listes" },
  { id: "article", titre: "Articles" },
  { id: "rappel", titre: "Rappels" },
]);

/** Au plus, par genre : au-delà, « et N autres ». */
export const PAR_GROUPE = 20;

const s = (n) => (n > 1 ? "s" : "");

/**
 * La note d'un texte pour les mots de la saisie : chacun doit être un mot du
 * texte (12) ou son début (10) ; à défaut, du texte secondaire (une note de
 * rappel : 5, début 4). +15 si le texte commence par la saisie entière. 0 : pas trouvé.
 */
export function noter(q, texte, secondaire = "") {
  const t = mots(texte);
  const sec = secondaire ? mots(secondaire) : [];
  let total = 0;
  for (const m of q) {
    let n = 0;
    for (const w of t) {
      if (w === m) { n = 12; break; }
      if (w.startsWith(m)) n = 10;
    }
    if (!n) {
      for (const w of sec) {
        if (w === m) { n = 5; break; }
        if (w.startsWith(m)) n = 4;
      }
    }
    if (!n) return 0;
    total += n;
  }
  if (t.join(" ").startsWith(q.join(" "))) total += 15;
  return total;
}

const LETTRE = /[\p{L}\p{N}]/u;

/**
 * Le texte en morceaux, `trouve` vrai sur le début de chaque mot qui répond à
 * la saisie (« Lait d'avoine », « avo » : « Lait d' », « avo », « ine »).
 */
export function morceaux(texte, q) {
  const car = Array.from(String(texte ?? "").normalize("NFC"));
  const marque = car.map(() => false);
  for (let i = 0; i < car.length; ) {
    if (!LETTRE.test(car[i])) { i++; continue; }
    let j = i;
    while (j < car.length && LETTRE.test(car[j])) j++;
    const norm = car.slice(i, j).map((c) => normaliser(c));
    const mot = norm.join("");
    const m = q.filter((x) => mot.startsWith(x)).sort((a, b) => b.length - a.length)[0];
    if (m) for (let k = i, n = 0; k < j && n < m.length; k++) { n += norm[k - i].length; marque[k] = true; }
    i = j;
  }
  const out = [];
  car.forEach((c, k) => {
    const d = out[out.length - 1];
    if (d && d.trouve === marque[k]) d.texte += c;
    else out.push({ texte: c, trouve: marque[k] });
  });
  return out;
}

/** « vide », « tout est pris », « 3 à prendre » (comme la tuile d'une liste). */
const resteListe = (l) => {
  const e = Array.isArray(l?.elements) ? l.elements : [];
  if (!e.length) return "vide";
  const n = e.filter((x) => !x?.fait).length;
  return n === 0 ? "tout est pris" : `${n} à prendre`;
};

/**
 * Ce que montre la recherche pour une saisie, dans `donnees` (ce que l'écran a
 * lu : `projets` — null s'ils ne sont pas lus —, `dossiers`, `listes`,
 * `rappels`). Rend `groupes` ([{ genre, titre, trouves, reste }], vides
 * retirés), `total`, et les phrases de l'écran (enTete, titreVide, detailVide).
 * Chaque trouvé : { genre, id, titre, contexte, fait, morceaux, cible } ;
 * `cible` dit l'écran à ouvrir ({ type: "projet"|"tache"|"dossier"|"liste"|"rappel", id, … }).
 * Les mieux notés d'abord, ce qui reste à faire avant ce qui est fait, puis l'ordre lu.
 */
export function chercher(requete, donnees = {}, { parGroupe = PAR_GROUPE } = {}) {
  const propre = String(requete ?? "").trim();
  const q = motsRequete(propre);
  const r = { requete: propre, vide: !q.length, groupes: [], total: 0, enTete: null, titreVide: null, detailVide: null };
  if (!q.length) return r;
  const tableau = (x) => (Array.isArray(x) ? x.filter((e) => e && typeof e === "object") : []);
  const projets = tableau(donnees.projets);
  const dossiers = tableau(donnees.dossiers);
  const listes = tableau(donnees.listes);
  const rappels = tableau(donnees.rappels);

  const trouves = Object.fromEntries(GENRES.map((g) => [g.id, []]));
  let rang = 0;
  const ajouter = (genre, note, x) => {
    if (note > 0) trouves[genre].push({ genre, ...x, fait: Boolean(x.fait), morceaux: morceaux(x.titre, q), note, rang: rang++ });
  };
  const parId = new Map(dossiers.map((d) => [d.id, d]));
  const nomProjet = new Map(projets.map((p) => [`motion:${p.id}`, p.nom]));
  const nomParent = (parent) => (parent == null ? null : nomProjet.get(parent) ?? parId.get(parent)?.nom ?? null);
  const rangeeDans = new Map();
  for (const d of dossiers) for (const t of Array.isArray(d.taches) ? d.taches : []) if (!rangeeDans.has(t)) rangeeDans.set(t, d);

  for (const p of projets) {
    if (!p?.id || typeof p.nom !== "string") continue;
    const n = Number(p.taches) || 0;
    ajouter("projet", noter(q, p.nom), { id: p.id, titre: p.nom, contexte: n ? `${n} tâche${s(n)}` : "aucune tâche ouverte", cible: { type: "projet", id: p.id } });
  }
  const vues = new Set();
  for (const p of projets) {
    for (const t of Array.isArray(p.liste) ? p.liste : []) {
      if (!t?.id || typeof t.titre !== "string" || vues.has(t.id)) continue;
      vues.add(t.id);
      const d = rangeeDans.get(t.id);
      ajouter("tache", noter(q, t.titre), { id: t.id, titre: t.titre, contexte: d ? `${p.nom} › ${d.nom}` : p.nom,
        cible: { type: "tache", id: t.id, projet: p.nom, tache: t } });
    }
  }
  for (const d of dossiers) {
    if (!d?.id || typeof d.nom !== "string") continue;
    const parent = nomParent(d.parent ?? null);
    ajouter("dossier", noter(q, d.nom), { id: d.id, titre: d.nom, contexte: parent ? `Dans « ${parent} »` : null, cible: { type: "dossier", id: d.id } });
    for (const n of Array.isArray(d.notes) ? d.notes : []) {
      if (!n?.id || typeof n.texte !== "string") continue;
      ajouter("note", noter(q, n.texte), { id: `${d.id}/${n.id}`, titre: n.texte, contexte: d.nom, fait: n.fait, cible: { type: "dossier", id: d.id } });
    }
  }
  for (const l of listes) {
    if (!l?.id || typeof l.nom !== "string") continue;
    ajouter("liste", noter(q, l.nom), { id: l.id, titre: l.nom, contexte: resteListe(l), cible: { type: "liste", id: l.id } });
    for (const e of Array.isArray(l.elements) ? l.elements : []) {
      if (!e?.id || typeof e.texte !== "string") continue;
      ajouter("article", noter(q, e.texte), { id: `${l.id}/${e.id}`, titre: e.texte, contexte: l.nom, fait: e.fait, cible: { type: "liste", id: l.id } });
    }
  }
  for (const x of rappels) {
    if (!x?.id || typeof x.texte !== "string") continue;
    const note = typeof x.note === "string" ? x.note.trim() : "";
    ajouter("rappel", noter(q, x.texte, note), { id: x.id, titre: x.texte, contexte: note || null, fait: x.fait,
      quand: typeof x.quand === "number" ? x.quand : null, cible: { type: "rappel", id: x.id } });
  }

  const ordre = (a, b) => b.note - a.note || Number(a.fait) - Number(b.fait) || a.rang - b.rang;
  for (const g of GENRES) {
    const liste = trouves[g.id].sort(ordre);
    if (!liste.length) continue;
    r.total += liste.length;
    r.groupes.push({ genre: g.id, titre: g.titre, trouves: liste.slice(0, parGroupe), reste: Math.max(0, liste.length - parGroupe) });
  }
  if (r.total) r.enTete = r.total === 1 ? "1 résultat" : `${r.total} résultats`;
  else {
    r.titreVide = `Rien pour « ${propre} ».`;
    r.detailVide = "Aucun projet, tâche, dossier, idée, liste, article ni rappel ne contient un mot qui commence ainsi. Essaie un autre mot, ou son début."
      + (Array.isArray(donnees.projets) ? "" : " Tes projets Motion ne sont pas encore lus : leurs tâches n'y sont pas.");
  }
  return r;
}

/** « et 4 autres : précise ta recherche ». */
export const phraseReste = (n) => `et ${n} autre${s(n)} : précise ta recherche`;
