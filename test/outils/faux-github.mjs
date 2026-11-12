// Un faux GitHub (API REST, sans jeton) pour la mise à jour automatique :
// GET /repos/:o/:r/commits/main et GET /repos/:o/:r/actions/runs?head_sha=…
// `etat` se modifie pendant l'essai : { main: { sha, date }, runs: { [sha]: [...] },
// limite: false, panne: false } ; `requetes` compte ce qui a été demandé.
import http from "node:http";

export function run(sha, { nom = "Serveur — tests", chemin = ".github/workflows/serveur.yml", statut = "completed", conclusion = "success", branche = "main", cree = "2026-11-12T10:00:00Z", numero = 1, evenement = "push", depot = "proprio/remy-essai", tete = depot } = {}) {
  return {
    name: nom, path: chemin, head_sha: sha, head_branch: branche, event: evenement, status: statut, conclusion: statut === "completed" ? conclusion : null,
    created_at: cree, run_number: numero, workflow_id: chemin.length, html_url: `https://exemple.invalid/runs/${numero}`,
    repository: { full_name: depot }, head_repository: { full_name: tete },
  };
}

export async function fauxGitHub({ proprietaire = "proprio", nom = "remy-essai", etat = {} } = {}) {
  const requetes = [];
  const e = { main: null, runs: {}, limite: false, panne: false, ...etat };
  const serveur = http.createServer((req, res) => {
    const u = new URL(req.url, "http://local");
    requetes.push(`${req.method} ${u.pathname}${u.search}`);
    const json = (code, corps, entetes = {}) => {
      res.writeHead(code, { "Content-Type": "application/json", "x-ratelimit-remaining": e.limite ? "0" : "59", ...entetes });
      res.end(JSON.stringify(corps));
    };
    if (e.panne) return json(502, { message: "Bad gateway" });
    if (e.limite) return json(403, { message: "API rate limit exceeded" }, { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 1800) });
    const racine = `/repos/${proprietaire}/${nom}`;
    if (u.pathname === `${racine}/commits/main` && e.main) {
      // ETag : un 304 quand rien n'a changé (ne compte pas dans la limite chez GitHub).
      const etag = `"${e.main.sha.slice(0, 12)}"`;
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { ETag: etag });
        return res.end();
      }
      return json(200, { sha: e.main.sha, commit: { committer: { date: e.main.date || new Date().toISOString() } } }, { ETag: etag });
    }
    if (u.pathname === `${racine}/actions/runs`) {
      const sha = u.searchParams.get("head_sha");
      const runs = e.runs[sha] || [];
      return json(200, { total_count: runs.length, workflow_runs: runs });
    }
    return json(404, { message: "Not Found" });
  });
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${serveur.address().port}`, etat: e, requetes, fermer: () => new Promise((r) => serveur.close(r)) };
}
