// Mesures (Lot 1, retours TestFlight 13) : combien de temps prend chaque étape,
// pour diagnostiquer avant de masquer. En mémoire seulement (les 200 dernières
// par série) : rien de personnel, des durées et des compteurs.
//
// Séries côté tour : motion.page, motion.liste, motion.attente_quota,
// motion.ecriture, google.jour, dashboard, glm.complete, glm.premier_jeton,
// conseil.glm, dictee, capture.

const MAX = 200;
const series = new Map();

export function mesurer(nom, ms, extra = null) {
  if (!Number.isFinite(ms) || ms < 0) return;
  let s = series.get(nom);
  if (!s) series.set(nom, (s = []));
  s.push({ ms: Math.round(ms), a: Date.now(), ...(extra ? { extra } : {}) });
  if (s.length > MAX) s.splice(0, s.length - MAX);
}

/** const fin = chrono("motion.liste"); … fin({ pages: 3 }) */
export function chrono(nom) {
  const t0 = performance.now();
  return (extra = null) => {
    const ms = performance.now() - t0;
    mesurer(nom, ms, extra);
    return ms;
  };
}

const quantile = (tri, q) => (tri.length ? tri[Math.min(tri.length - 1, Math.floor(q * tri.length))] : null);

export function resume({ depuis = 0 } = {}) {
  const out = {};
  for (const [nom, s] of series) {
    const vals = s.filter((m) => m.a >= depuis).map((m) => m.ms);
    if (!vals.length) continue;
    const tri = [...vals].sort((a, b) => a - b);
    const dernier = s[s.length - 1];
    out[nom] = { n: vals.length, p50: quantile(tri, 0.5), p95: quantile(tri, 0.95), max: tri[tri.length - 1], dernier: dernier.ms, dernierA: dernier.a };
  }
  return out;
}

export function _vider() {
  series.clear();
}
