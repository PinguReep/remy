// Faux Motion (:9998) et faux Google Calendar (:9995) : une journée réaliste,
// relative à « maintenant », pour les captures de la CI. Aucune donnée réelle.
// bord avec une journée réaliste. Tout est relatif à « maintenant ».
import http from "node:http";

const H = 3600_000;
const now = Date.now();
const auj = new Date(); auj.setHours(0, 0, 0, 0);
const t = (h, m = 0, jour = 0) => new Date(auj.getTime() + jour * 24 * H + h * H + m * 60_000).toISOString();

const taches = [
  { id: "t1", name: "Finaliser la démo de la boutique", scheduledStart: t(10, 30), scheduledEnd: t(11, 30), dueDate: t(18), priority: "HIGH", project: { name: "Boutique" }, duration: 60, workspace: { id: "w1" } },
  { id: "t2", name: "Relire le contrat de Hugo", scheduledStart: t(14), scheduledEnd: t(14, 45), dueDate: t(19), priority: "MEDIUM", duration: 45, workspace: { id: "w1" } },
  { id: "t3", name: "Préparer la facture Ondine", dueDate: t(17), priority: "MEDIUM", workspace: { id: "w1" } },
  { id: "t4", name: "Relancer le comptable", dueDate: t(18, 0, -4), priority: "ASAP", workspace: { id: "w1" } },
  { id: "t5", name: "Envoyer le devis tennis", dueDate: t(12, 0, -2), priority: "HIGH", workspace: { id: "w1" } },
  { id: "t6", name: "Trier la boîte mail", scheduledStart: t(8), scheduledEnd: t(8, 30), dueDate: t(9), workspace: { id: "w1" } },
  { id: "t7", name: "Plus tard", dueDate: t(9, 0, 6), workspace: { id: "w1" } },
];
const evenements = [
  { id: "e1", summary: "Podologue", start: { dateTime: t(9) }, end: { dateTime: t(9, 45) }, location: "Cabinet Voltaire, Paris 11e" },
  { id: "e2", summary: "Déjeuner avec Léa", start: { dateTime: t(12, 30) }, end: { dateTime: t(13, 45) }, location: "Chez Paulette" },
  { id: "e3", summary: "Point hebdo — associés", start: { dateTime: t(17, 30) }, end: { dateTime: t(18, 30) } },
  { id: "e4", summary: "Salon du design", start: { date: t(0).slice(0, 10) }, end: { date: t(0, 0, 2).slice(0, 10) } },
];

http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/v1/tasks") return res.end(JSON.stringify({ tasks: taches.filter((x) => !x.status?.isResolvedStatus) }));
  if (u.pathname === "/v1/statuses") return res.end(JSON.stringify([{ name: "Todo" }, { name: "Completed", isResolvedStatus: true }]));
  const m = u.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
  if (m) {
    const tache = taches.find((x) => x.id === decodeURIComponent(m[1]));
    if (!tache) { res.statusCode = 404; return res.end("{}"); }
    if (req.method === "PATCH") {
      // Cocher / décocher depuis l'app (statut terminé, puis restauré par « Annuler »).
      let corps = "";
      req.on("data", (c) => { corps += c; });
      req.on("end", () => {
        const b = JSON.parse(corps || "{}");
        if (b.status) tache.status = { name: b.status, isResolvedStatus: b.status === "Completed" };
        res.end(JSON.stringify(tache));
      });
      return;
    }
    return res.end(JSON.stringify({ ...tache, status: tache.status || { name: "Todo" } }));
  }
  if (u.pathname === "/v1/workspaces") return res.end(JSON.stringify({ workspaces: [{ id: "w1", name: "Perso" }] }));
  if (u.pathname === "/v1/schedules") return res.end(JSON.stringify([]));
  if (u.pathname === "/v1/projects") return res.end(JSON.stringify({ projects: [{ id: "p1", name: "Boutique" }] }));
  res.statusCode = 404; res.end("{}");
}).listen(9998);

http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/token") return res.end(JSON.stringify({ access_token: "faux", expires_in: 3600 }));
  if (u.pathname.endsWith("/events")) return res.end(JSON.stringify({ items: evenements }));
  res.statusCode = 404; res.end("{}");
}).listen(9995);
// Fausse Dictée Locale (:9997) : la dictée et le mode appel de l'app passent
// par /api/transcribe, qui lui envoie l'audio (multipart, API OpenAI).
http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  req.resume();
  req.on("end", () => {
    if (req.method === "POST" && req.url.endsWith("/audio/transcriptions")) {
      return res.end(JSON.stringify({ text: "Qu'est-ce que j'ai cet après-midi ?" }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
}).listen(9997);
console.log("mocks prêts");
