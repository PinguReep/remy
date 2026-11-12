// « Bloquée par… » (taches-dependances-v1) : la logique sans écran du choix
// des tâches bloquantes, partagée par Gérer (site). Le même calcul vit dans
// RemyCore (Dependances.swift) pour l'iPhone.

/** « Réparer la Voiture » et « reparer la voiture » : la même recherche. */
export const cle = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Les tâches qu'on peut choisir comme bloquantes de `tacheId` : pas elle-même,
 * pas celles déjà choisies, pas celles qui l'attendent déjà (directement ou de
 * loin : la tour refuserait la boucle). `recherche` filtre par mots (tous
 * présents, dans le titre ou le projet). Les plus proches échéances d'abord.
 */
export function candidats(taches, { tacheId, deja = [], liens = [], recherche = "", max = 40 } = {}) {
  const exclues = new Set([tacheId, ...deja.map((x) => (typeof x === "string" ? x : x?.id))]);
  // Qui attend (de loin) tacheId : ceux-là boucleraient.
  const attendent = new Map();
  for (const l of liens || []) {
    const b = l?.bloquante?.id;
    const t = l?.tache?.id;
    if (b && t) attendent.set(b, [...(attendent.get(b) || []), t]);
  }
  const pile = [tacheId];
  while (pile.length) {
    const x = pile.pop();
    for (const t of attendent.get(x) || []) {
      if (exclues.has(t)) continue;
      exclues.add(t);
      pile.push(t);
    }
  }
  // Projets et dossiers (projets-bloques-v1) : `dans` dit ce qui contient
  // chaque élément. Une tâche n'attend pas son propre projet ; un projet
  // n'attend ni ses tâches ni ses sous-dossiers (ni son parent).
  const liste = Array.isArray(taches) ? taches : [];
  const siens = new Set(liste.find((t) => t?.id === tacheId)?.dans || []);
  const mots = cle(recherche).split(" ").filter(Boolean);
  return liste
    .filter((t) => t?.id && !exclues.has(t.id) && !siens.has(t.id) && !(t.dans || []).includes(tacheId))
    .filter((t) => {
      if (!mots.length) return true;
      const texte = cle(`${t.titre} ${t.projet || ""}`);
      return mots.every((m) => texte.includes(m));
    })
    .sort((a, b) => (a.echeance ?? Infinity) - (b.echeance ?? Infinity) || String(a.titre).localeCompare(String(b.titre), "fr"))
    .slice(0, max);
}

/** Ce que dit la liste quand elle est vide : rien dans Motion, ou rien qui corresponde. */
export function phraseVide({ total = 0, recherche = "" } = {}) {
  if (!total) return "Aucune autre tâche ouverte dans Motion : rien ne peut la bloquer pour l'instant.";
  return cle(recherche) ? `Aucune tâche ne correspond à « ${String(recherche).trim()} ».` : "Toutes les autres tâches l'attendent déjà, ou la bloquent déjà.";
}
