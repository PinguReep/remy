// Les sujets de la réflexion nocturne, un par un.
//
// Le briefing sort du modèle comme un bloc de markdown. Pour que Sam puisse
// barrer ce qu'il a traité et écarter ce qu'il ne veut pas traiter, il faut que
// chaque ligne ait une IDENTITÉ stable — sinon un état coché le lundi se
// retrouverait sur une autre ligne le mardi.
//
// L'identité est le texte lui-même, réduit puis haché : pas de compteur, pas
// d'index. Une ligne reformulée par la réflexion suivante est un nouveau sujet
// (c'est le bon comportement : ce n'est plus tout à fait la même question).

import crypto from "node:crypto";

export const ETATS = ["ouvert", "traite", "ignore"];
// Au-delà, un sujet n'est plus d'actualité : on ne le traîne pas dans le prompt
// de Rémy ni dans les états stockés.
export const PEREMPTION_MS = 7 * 86_400_000;

// La réduction décide de ce qui compte comme « le même sujet » : la ponctuation,
// la casse et les espaces ne comptent pas ; les mots, si.
function reduire(texte) {
  return String(texte || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function idDe(texte) {
  return crypto.createHash("sha1").update(reduire(texte)).digest("hex").slice(0, 10);
}

// Le briefing est du markdown : ses sujets sont les puces de premier niveau.
// Une ligne de prose (introduction, conclusion) n'est pas un sujet à cocher.
export function itemsDe(texte) {
  const lignes = String(texte || "").split("\n");
  const items = [];
  const vus = new Set();
  for (const l of lignes) {
    const m = l.match(/^\s*[-*•]\s+(.*\S)\s*$/);
    if (!m) continue;
    const contenu = m[1].trim();
    const reduit = reduire(contenu);
    if (!reduit || vus.has(reduit)) continue; // deux fois la même puce = une seule
    vus.add(reduit);
    items.push({ id: idDe(contenu), texte: contenu });
  }
  return items;
}

export function avecEtats(items, etats = {}) {
  return items.map((i) => {
    const e = etats?.[i.id];
    return { ...i, etat: ETATS.includes(e?.etat) ? e.etat : "ouvert", depuis: e?.at || null };
  });
}

// Ce que Rémy doit avoir sous les yeux : les sujets encore ouverts, récents.
// Les sujets écartés ou déjà traités n'ont rien à faire dans son prompt — les
// remettre reviendrait à relancer Sam sur ce qu'il a explicitement fermé.
export function sujetsOuverts(texte, etats, { maintenant = Date.now(), genereA = null, max = 6 } = {}) {
  if (genereA && maintenant - genereA > PEREMPTION_MS) return [];
  return avecEtats(itemsDe(texte), etats)
    .filter((i) => i.etat === "ouvert")
    .slice(0, max);
}

// Ce que la pré-réflexion ne doit PAS reproposer : ce que Sam a écarté d'un
// tap. Un « − » n'est pas qu'un geste de ménage, c'est un signal.
export function sujetsFermes(textes, etats, { max = 12 } = {}) {
  const out = [];
  const vus = new Set();
  for (const t of textes || []) {
    for (const i of avecEtats(itemsDe(t), etats)) {
      if (i.etat === "ouvert" || vus.has(i.id)) continue;
      vus.add(i.id);
      out.push(i);
      if (out.length >= max) return out;
    }
  }
  return out;
}

// Purge : un état dont le sujet n'existe plus dans aucun briefing conservé n'a
// plus de raison d'occuper de la place.
export function etatsUtiles(etats, textes, { maintenant = Date.now() } = {}) {
  const vivants = new Set((textes || []).flatMap((t) => itemsDe(t).map((i) => i.id)));
  const out = {};
  for (const [id, e] of Object.entries(etats || {})) {
    if (!vivants.has(id)) continue;
    if (e?.at && maintenant - e.at > 90 * 86_400_000) continue;
    out[id] = e;
  }
  return out;
}
