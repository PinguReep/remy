// Faux Motion À ÉTAT (Lot 0, J0.5) : l'API publique de Motion telle que Rémy
// s'en sert, en mémoire, sur un port local. Pour les tests serveur, les tests
// iPhone et, plus tard, les simulations d'onboarding — jamais le vrai compte.
//
//   const m = await demarrerFauxMotion({ pageTaille: 50, quotaParMinute: 12 });
//   process.env.MOTION_BASE_URL = m.url; // avant d'importer lib/motion.js
//   m.ajouter({ name: "Payer la facture" });
//   m.pannes.push({ methode: "PATCH", chemin: /\/tasks\/t2$/, code: 429, fois: 1 });
//   …
//   m.requetes  // [{ methode, chemin, corps }] pour les vérifications
//   await m.fermer();
//
// Fidèle aux comportements qui comptent pour la fiabilité : pagination par
// curseur, quota par minute (429), créneaux calculés par Motion en lecture
// seule, statut résolu, 404 sur une tâche disparue, latence et pannes
// injectables.

import http from "node:http";

// `horaires` : les plages de « Work Hours » ({ monday: [{ start, end }] … }),
// absentes par défaut comme avant.
export async function demarrerFauxMotion({ pageTaille = 50, quotaParMinute = null, latenceMs = 0, horaires = null } = {}) {
  const reglage = { latenceMs }; // modifiable en cours de test (m.latenceMs = 300)
  const taches = new Map();
  const requetes = [];
  const pannes = []; // { methode?, chemin: RegExp, code, fois, corps?, entetes? }
  const horodatages = [];
  let suivant = 1;
  const espace = { id: "w1", name: "Perso" };
  const statuts = [
    { name: "Todo", isDefaultStatus: true, isResolvedStatus: false },
    { name: "Completed", isDefaultStatus: false, isResolvedStatus: true },
  ];

  const statut = (nom) => statuts.find((s) => s.name === nom) || { name: nom, isResolvedStatus: false };

  function ajouter(champs = {}) {
    const id = champs.id || `t${suivant++}`;
    const t = {
      id,
      name: champs.name || `Tâche ${id}`,
      duration: champs.duration ?? 30,
      dueDate: champs.dueDate ?? null,
      priority: champs.priority || "MEDIUM",
      description: champs.description || "",
      workspace: { id: espace.id, name: espace.name },
      status: statut(champs.status?.name || champs.status || "Todo"),
      completed: false,
      scheduledStart: champs.scheduledStart ?? null,
      scheduledEnd: champs.scheduledEnd ?? null,
      project: champs.project ?? null,
      createdTime: new Date().toISOString(),
    };
    taches.set(id, t);
    return t;
  }

  const serveur = http.createServer((req, res) => {
    let corps = "";
    req.on("data", (c) => (corps += c));
    req.on("end", async () => {
      const u = new URL(req.url, "http://faux");
      const chemin = u.pathname.replace(/^\/v1/, "");
      let json = null;
      try {
        json = corps ? JSON.parse(corps) : null;
      } catch {}
      requetes.push({ methode: req.method, chemin: u.pathname + u.search, corps: json });
      const repondre = (code, v, entetes = {}) => {
        res.writeHead(code, { "Content-Type": "application/json", ...entetes });
        res.end(v === undefined ? "" : JSON.stringify(v));
      };
      if (reglage.latenceMs) await new Promise((r) => setTimeout(r, reglage.latenceMs));

      // Pannes injectées d'abord (consommées une par une).
      const p = pannes.find((x) => (!x.methode || x.methode === req.method) && x.chemin.test(chemin) && x.fois > 0);
      if (p) {
        p.fois--;
        if (p.code === 0) return req.socket.destroy(); // coupure réseau
        return repondre(p.code, p.corps ?? { message: `panne injectée ${p.code}` }, p.entetes);
      }
      // Quota par minute, comme le vrai (12/min pour un compte individuel).
      if (quotaParMinute) {
        const maintenant = Date.now();
        while (horodatages.length && maintenant - horodatages[0] > 60_000) horodatages.shift();
        if (horodatages.length >= quotaParMinute) return repondre(429, { message: "Rate limit exceeded" });
        horodatages.push(maintenant);
      }

      if (chemin === "/users/me") return repondre(200, { id: "u1", name: "Sam" });
      if (chemin === "/workspaces") return repondre(200, { workspaces: [{ ...espace, statuses: statuts }], meta: {} });
      if (chemin === "/statuses") return repondre(200, statuts);
      if (chemin === "/schedules") return repondre(200, [{ name: "Work Hours", isChunkedTaskSchedule: false, timezone: "Europe/Paris", ...(horaires ? { schedule: horaires } : {}) }]);
      if (chemin === "/projects") return repondre(200, { projects: [], meta: {} });

      if (chemin === "/tasks" && req.method === "GET") {
        let liste = [...taches.values()];
        const nom = u.searchParams.get("name");
        if (nom) liste = liste.filter((t) => t.name.toLowerCase().includes(nom.toLowerCase()));
        const debut = Number(u.searchParams.get("cursor") || 0);
        const page = liste.slice(debut, debut + pageTaille);
        const fin = debut + pageTaille;
        return repondre(200, { tasks: page, meta: { pageSize: pageTaille, ...(fin < liste.length ? { nextCursor: String(fin) } : {}) } });
      }
      if (chemin === "/tasks" && req.method === "POST") {
        if (!json?.name || !json?.workspaceId) return repondre(400, { message: "name et workspaceId requis" });
        const { status, autoScheduled, workspaceId, ...reste } = json;
        return repondre(201, ajouter({ ...reste, status }));
      }
      const m = chemin.match(/^\/tasks\/([^/]+)$/);
      if (m) {
        const t = taches.get(m[1]);
        if (!t) return repondre(404, { message: "Task not found" });
        if (req.method === "GET") return repondre(200, t);
        if (req.method === "DELETE") {
          taches.delete(m[1]);
          return repondre(204);
        }
        if (req.method === "PATCH") {
          // Le vrai Motion refuse workspaceId en PATCH (relevé sur le compte de Sam).
          const { workspaceId, status, autoScheduled, ...reste } = json || {};
          for (const [k, v] of Object.entries(reste)) if (k in t || ["dueDate", "duration", "priority", "name", "description"].includes(k)) t[k] = v;
          if (status) {
            t.status = statut(status);
            t.completed = Boolean(t.status.isResolvedStatus);
          }
          return repondre(200, t);
        }
      }
      return repondre(404, { message: `route inconnue du faux Motion : ${req.method} ${chemin}` });
    });
  });
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${serveur.address().port}/v1`,
    taches,
    requetes,
    pannes,
    ajouter,
    ouvertes: () => [...taches.values()].filter((t) => !t.completed),
    get latenceMs() {
      return reglage.latenceMs;
    },
    set latenceMs(v) {
      reglage.latenceMs = v;
    },
    fermer: () => new Promise((r) => serveur.close(r)),
  };
}
