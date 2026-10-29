// Les Sparks une à une (29/10) : « Sparks n/2 » doit dire combien répondent
// VRAIMENT, et le diagnostic quel modèle chacune sert. (Avant, « Sparks 0/2 »
// de /api/health comptait les inférences en cours de la garde de charge : 0
// la nuit, alors que les deux tournaient.)
//
//   REMY_SPARKS  les serveurs de modèle des Sparks, séparés par des virgules,
//                nommés ou non : spark-1=http://<ip>:8888/v1,spark-2=http://<ip>:8000/v1
//
// Sans REMY_SPARKS, la seule adresse connue est REMY_GLM_URL (le modèle de
// Rémy) : une ligne, sans prétendre compter les Sparks (servi à deux en tensor
// parallèle, ou par une seule ? La tour ne peut pas le savoir).
//
// Une seule requête par adresse (/models, la plus légère), au plus toutes les
// 30 s, et seulement quand on demande l'état (/api/health, /api/modeles, le
// diagnostic d'un incident) : rien en tâche de fond. Le jeton REMY_GLM_TOKEN ne
// part que vers REMY_GLM_URL. Les adresses ne sortent jamais d'ici : l'état
// dit des noms.

const normaliser = (u) => String(u || "").trim().replace(/\/+$/, "");
const SONDE_MS = 3_000;

export function sparksDeclarees(env = process.env) {
  const principale = normaliser(env.REMY_GLM_URL);
  const liste = [];
  String(env.REMY_SPARKS || "")
    .split(/[,;\s]+/)
    .filter(Boolean)
    .forEach((e, i) => {
      const m = e.match(/^([^=]+)=(.+)$/);
      const url = normaliser(m ? m[2] : e);
      if (!/^https?:\/\/[^/]/i.test(url) || liste.some((s) => s.url === url)) return;
      liste.push({ nom: (m ? m[1].trim() : "").slice(0, 40) || `Spark ${i + 1}`, url, principale: url === principale });
    });
  if (liste.length) return { liste, declarees: true };
  return { liste: principale ? [{ nom: "modèle local", url: principale, principale: true }] : [], declarees: false };
}

async function sonder({ nom, url, principale }, env) {
  const a = Date.now();
  try {
    const r = await fetch(`${url}/models`, {
      headers: principale && env.REMY_GLM_TOKEN ? { Authorization: `Bearer ${env.REMY_GLM_TOKEN}` } : {},
      signal: AbortSignal.timeout(SONDE_MS),
    });
    if (!r.ok) return { nom, principale, joignable: false, modeles: [], erreur: r.status === 401 ? "jeton refusé" : `réponse ${r.status}`, a };
    const j = await r.json().catch(() => null);
    const modeles = (Array.isArray(j?.data) ? j.data : []).map((x) => x?.id).filter((x) => typeof x === "string" && x).slice(0, 8);
    return { nom, principale, joignable: true, modeles, erreur: null, a };
  } catch (err) {
    return { nom, principale, joignable: false, modeles: [], erreur: err.name === "TimeoutError" ? "délai dépassé" : "injoignable", a };
  }
}

let cache = { a: 0, cle: "", etat: null };

// { declarees, sparks: [{ nom, principale, joignable, modeles, erreur }], a }
export async function sonderSparks({ maxAgeMs = 30_000, env = process.env } = {}) {
  const { liste, declarees } = sparksDeclarees(env);
  const cle = JSON.stringify(liste);
  if (cache.etat && cache.cle === cle && Date.now() - cache.a < maxAgeMs) return cache.etat;
  const sparks = await Promise.all(liste.map((s) => sonder(s, env)));
  const etat = { declarees, sparks, a: new Date().toISOString() };
  cache = { a: Date.now(), cle, etat };
  return etat;
}

// La ligne de /api/health. `libelle` : l'identifiant servi → ce qu'on affiche.
export function resumeSparks(etat, libelle = (x) => x) {
  const { declarees, sparks } = etat || {};
  if (!sparks?.length) return "— aucun modèle local branché (REMY_GLM_URL)";
  const modeles = (s) => (s.modeles.length ? s.modeles.map(libelle).join(", ") : "aucun modèle chargé");
  if (!declarees) {
    const s = sparks[0];
    return s.joignable
      ? `${s.modeles.length ? "✅" : "⚠️"} le modèle local répond (${modeles(s)}) — une seule adresse connue (REMY_GLM_URL) : déclare REMY_SPARKS pour suivre chaque Spark`
      : `❌ le modèle local ne répond pas (${s.erreur}) — vérifie que les Sparks sont allumées`;
  }
  const n = sparks.filter((s) => s.joignable).length;
  const detail = sparks
    .map((s) => `${s.nom}${s.principale ? " (Rémy)" : ""} : ${s.joignable ? modeles(s) : `❌ ${s.erreur}`}`)
    .join(" · ");
  return `${n === sparks.length ? "✅" : n ? "⚠️" : "❌"} Sparks ${n}/${sparks.length} ${n > 1 ? "répondent" : "répond"} — ${detail}`;
}

// Pour les tests.
export const _oublierSparks = () => {
  cache = { a: 0, cle: "", etat: null };
};
