// Faux Motion (:9998), faux Google Calendar (:9995), faux ActivityWatch (:9993) : une journée réaliste,
// relative à « maintenant », pour les captures de la CI. Aucune donnée réelle.
// bord avec une journée réaliste. Tout est relatif à « maintenant ».
import http from "node:http";

const H = 3600_000;
const now = Date.now();
const auj = new Date(); auj.setHours(0, 0, 0, 0);
const t = (h, m = 0, jour = 0) => new Date(auj.getTime() + jour * 24 * H + h * H + m * 60_000).toISOString();
// La tâche en cours suit l'heure de la CI : commencée il y a ~25 min, 1 h 15
// au total. La carte « Maintenant » et « Gérer » ont toujours de quoi montrer.
const enCours = Math.floor((now - 25 * 60_000) / 300_000) * 300_000;

const taches = [
  { id: "t1", name: "Finaliser la démo de la boutique", scheduledStart: new Date(enCours).toISOString(), scheduledEnd: new Date(enCours + 75 * 60_000).toISOString(), dueDate: new Date(enCours + 4 * H).toISOString(), priority: "HIGH", project: { id: "p1", name: "Boutiques" }, duration: 75, workspace: { id: "w1" } },
  { id: "t2", name: "Relire le contrat de Hugo", scheduledStart: t(14), scheduledEnd: t(14, 45), dueDate: t(19), priority: "MEDIUM", duration: 45, project: { id: "p1", name: "Boutiques" }, workspace: { id: "w1" } },
  { id: "t3", name: "Préparer la facture Ondine", dueDate: t(17), priority: "MEDIUM", workspace: { id: "w1" } },
  { id: "t4", name: "Relancer le comptable", dueDate: t(18, 0, -4), priority: "ASAP", workspace: { id: "w1" } },
  { id: "t5", name: "Envoyer le devis tennis", dueDate: t(12, 0, -2), priority: "HIGH", workspace: { id: "w1" } },
  { id: "t6", name: "Trier la boîte mail", scheduledStart: t(8), scheduledEnd: t(8, 30), dueDate: t(9), workspace: { id: "w1" } },
  { id: "t7", name: "Plus tard", dueDate: t(9, 0, 6), workspace: { id: "w1" } },
  // Un titre très long : il doit passer à la ligne, jamais déborder.
  { id: "t9", name: "Préparer le dossier complet de subvention pour la rénovation énergétique de l'atelier de la rue des Lilas", scheduledStart: t(15, 15), scheduledEnd: t(16, 0), dueDate: t(19), duration: 45, project: { id: "p3", name: "Voyage à Porto et autres projets personnels au long cours" }, workspace: { id: "w1" } },
  // Placée par Motion APRÈS son échéance : le bandeau « menacée » (24/10).
  { id: "t10", name: "Envoyer les visuels à l'imprimeur", scheduledStart: new Date(now + 20 * H).toISOString(), scheduledEnd: new Date(now + 21 * H).toISOString(), dueDate: new Date(now + 6 * H).toISOString(), priority: "HIGH", duration: 60, project: { id: "p1", name: "Boutiques" }, workspace: { id: "w1" } },
  { id: "t8", name: "Retoucher les photos", dueDate: t(20, 0, 2), duration: 90, project: { id: "p2", name: "Album « Été »" }, workspace: { id: "w1" } },
];
const evenements = [
  { id: "e1", summary: "Podologue", start: { dateTime: t(9) }, end: { dateTime: t(9, 45) }, location: "Cabinet Voltaire, Paris 11e" },
  { id: "e2", summary: "Déjeuner avec Léa", start: { dateTime: t(12, 30) }, end: { dateTime: t(13, 45) }, location: "Chez Paulette" },
  { id: "e3", summary: "Point hebdo — associés", start: { dateTime: t(17, 30) }, end: { dateTime: t(18, 30) },
    attendees: [{ email: "sam@exemple.fr", self: true }, { email: "hugo@exemple.fr" }] },
  // Une activité à soi, à heure fixe (le « cadenas ») : se décale, se coche.
  { id: "e5", summary: "Aspirateur", start: { dateTime: t(19, 30) }, end: { dateTime: t(20, 0) } },
  { id: "e4", summary: "Salon du design", start: { date: t(0).slice(0, 10) }, end: { date: t(0, 0, 2).slice(0, 10) } },
];

let creees = 0;
http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/v1/tasks" && req.method === "POST") {
    // « Oui, fais-le » sur une création (test d'intégration) : la tâche existe ensuite.
    let corps = "";
    req.on("data", (c) => { corps += c; });
    req.on("end", () => {
      const b = JSON.parse(corps || "{}");
      const tache = { id: `t-cree-${++creees}`, name: b.name, dueDate: b.dueDate, duration: b.duration, priority: b.priority || "MEDIUM", workspace: { id: b.workspaceId || "w1" } };
      taches.push(tache);
      res.end(JSON.stringify({ ...tache, status: { name: "Todo" } }));
    });
    return;
  }
  if (u.pathname === "/v1/tasks") return res.end(JSON.stringify({ tasks: taches.filter((x) => !x.status?.isResolvedStatus) }));
  if (u.pathname === "/v1/statuses") return res.end(JSON.stringify([{ name: "Todo" }, { name: "Completed", isResolvedStatus: true }]));
  const m = u.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
  if (m) {
    const tache = taches.find((x) => x.id === decodeURIComponent(m[1]));
    if (!tache) { res.statusCode = 404; return res.end("{}"); }
    if (req.method === "DELETE") {
      // « Annuler » une création : la tâche disparaît.
      taches.splice(taches.indexOf(tache), 1);
      res.statusCode = 204;
      return res.end();
    }
    if (req.method === "PATCH") {
      // Cocher / décocher depuis l'app (statut terminé, puis restauré par « Annuler »).
      let corps = "";
      req.on("data", (c) => { corps += c; });
      req.on("end", () => {
        const b = JSON.parse(corps || "{}");
        if (b.status) tache.status = { name: b.status, isResolvedStatus: b.status === "Completed" };
        for (const k of ["name", "dueDate", "duration", "priority"]) if (k in b) tache[k] = b[k];
        res.end(JSON.stringify(tache));
      });
      return;
    }
    return res.end(JSON.stringify({ ...tache, status: tache.status || { name: "Todo" } }));
  }
  if (u.pathname === "/v1/workspaces") return res.end(JSON.stringify({ workspaces: [{ id: "w1", name: "Perso" }] }));
  if (u.pathname === "/v1/schedules") return res.end(JSON.stringify([]));
  if (u.pathname === "/v1/projects") return res.end(JSON.stringify({ projects: [
    { id: "p1", name: "Boutiques", status: { name: "En cours" } },
    { id: "p2", name: "Album « Été »", status: { name: "En cours" } },
    { id: "p3", name: "Voyage à Porto", status: { name: "En attente" } },
  ] }));
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
// Faux GLM (:9994, API OpenAI de tensorfold) : le conseil du moment réfléchi.
// Il lit la situation envoyée par la tour et répond un conseil plausible,
// pour que les captures montrent le vrai chemin (tour → GLM → app).
http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    // Deux modèles servis, pour l'écran Réglages › Modèle.
    if (req.url.endsWith("/models")) {
      return res.end(JSON.stringify({ data: [{ id: "DeepSeek-V4.1-Flash-1017", max_model_len: 1048576 }, { id: "zai-org/GLM-5.3-FP8", max_model_len: 131072 }] }));
    }
    if (!req.url.endsWith("/chat/completions")) {
      res.statusCode = 404;
      return res.end("{}");
    }
    let s = {};
    let b = {};
    try {
      b = JSON.parse(corps);
    } catch {}
    const systeme = b.messages?.[0]?.content || "";
    const texte = b.messages?.at(-1)?.content || "";
    const repondre = (objet) =>
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(objet) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 400, completion_tokens: 120 },
      }));
    // Capture à plusieurs intentions : l'exemple de Sam (Yanis), daté
    // depuis « aujourdhui » envoyé par la tour.
    if (systeme.startsWith("Tu ranges ce que Sam")) {
      let ctx = {};
      try {
        ctx = JSON.parse(texte.slice(texte.indexOf("{"), texte.indexOf("}\n") + 1));
      } catch {}
      // Le prochain jeudi / samedi / dimanche (0 = dimanche), aujourd'hui compris.
      const jour = (js) => {
        const d = new Date(`${ctx.aujourdhui || new Date().toISOString().slice(0, 10)}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + ((js - d.getUTCDay() + 7) % 7));
        return d.toISOString().slice(0, 10);
      };
      const dit = texte.slice(texte.indexOf("Ce que Sam a dit"));
      if (!/yanis/i.test(dit)) return repondre({ elements: [{ nature: "tache", titre: dit.split("\n").slice(1).join(" ").trim() || "Noter" }] });
      return repondre({ elements: [
        { nature: "rendez-vous", titre: "Soirée chez Yanis", quand: jour(4), question: "À quelle heure ?" },
        { nature: "contrainte", titre: "Samedi : dispo le matin seulement", quand: jour(6) },
        { nature: "tache", titre: "Studio : enregistrer la démo", quand: jour(0), dureeMin: 120 },
        { nature: "liste", titre: "Courses", liste: "Courses", articles: ["Vin", "Fromage"] },
        { nature: "projet", titre: "Site vitrine", parent: "Boutiques" },
      ] });
    }
    // « Retenir » un long texte : les infos à cocher (une par phrase de Sam).
    if (systeme.startsWith("Tu es le module mémoire de Rémy OS. Sam a collé")) {
      const colle = (texte.match(/<matiere_externe[^>]*>([\s\S]*?)<\/matiere_externe>/) || [, ""])[1];
      const phrases = colle.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 12).slice(0, 4);
      return repondre({ elements: phrases.map((p, i) => ({ texte: p, section: ["Projets en cours", "Objectifs", "Personnes", "Préférences"][i % 4] })) });
    }
    // Rangement des rappels (mini-onboarding) : des étiquettes évidentes.
    if (systeme.startsWith("Tu aides Sam à ranger ses rappels")) {
      let possibles = [];
      let rappels = [];
      try {
        possibles = JSON.parse(texte.match(/Étiquettes possibles : (\[.*\])/)[1]);
        rappels = JSON.parse(texte.match(/Rappels : (\[.*\])/s)[1]);
      } catch {}
      const si = (nom) => (possibles.includes(nom) ? [nom] : []);
      return repondre({ propositions: rappels.map((r) => {
        const t = r.texte.toLowerCase();
        if (t.includes("garage")) return { id: r.id, action: "tache", etiquettes: si("Voiture") };
        if (t.includes("passeport") || t.includes("loyer")) return { id: r.id, action: "garder", etiquettes: si("Administratif") };
        if (t.includes("hugo")) return { id: r.id, action: "garder", etiquettes: si("Professionnel") };
        if (t.includes("léa")) return { id: r.id, action: "garder", etiquettes: si("Famille et amis") };
        return { id: r.id, action: "rien", etiquettes: [] };
      }) });
    }
    try {
      s = JSON.parse(texte.slice(texte.indexOf("{")));
    } catch {}
    const fixe = s.prochainsFixes?.[0];
    const conseil = s.enCours
      ? `Reste sur « ${s.enCours.titre} » jusqu'à ${s.enCours.fin}${fixe ? `, puis prépare « ${fixe.titre} » (${fixe.debut}).` : "."}`
      : fixe
        ? `Tu as ${s.libreAvantProchainFixeMin ?? "un peu de"} min avant « ${fixe.titre} » : avance ce qui est urgent, pas le reste.`
        : "Rien d'urgent : suis le planning de Motion.";
    const pourquoi = [
      s.enCours && `« ${s.enCours.titre} » est en cours (${s.enCours.resteMin} min restantes)`,
      fixe && `Rendez-vous fixe à ${fixe.debut}${fixe.lieu ? ` (${fixe.lieu})` : ""}`,
      s.bloquees?.length && `${s.bloquees.length} tâche(s) en attente laissée(s) de côté`,
    ].filter(Boolean);
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ conseil, pourquoi, tache: s.enCours?.titre ?? null }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 300, completion_tokens: 60 },
    }));
  });
}).listen(9994);
// Faux ActivityWatch (:9993, API REST /api/0) : la fenêtre au premier plan et
// la présence, sur les 6 dernières heures. Les titres sont là comme sur une
// vraie tour : la tour ne doit jamais les garder.
{
  const debut = Math.floor((now - 6 * H) / 60_000) * 60_000;
  const ev = (de, a, data) => ({ id: de, timestamp: new Date(debut + de * 60_000).toISOString(), duration: (a - de) * 60, data });
  const fenetres = [
    ev(0, 110, { app: "Code.exe", title: "boutique.js — Code" }),
    ev(110, 170, { app: "chrome.exe", title: "Documentation — Chrome" }),
    ev(170, 195, { app: "Discord.exe", title: "#général — Discord" }),
    ev(195, 330, { app: "Code.exe", title: "panier.js — Code" }),
  ];
  const absences = [ev(0, 140, { status: "not-afk" }), ev(140, 160, { status: "afk" }), ev(160, 330, { status: "not-afk" })];
  const web = [ev(110, 170, { url: "https://developer.example.org/docs/fetch", title: "Documentation", incognito: false })];
  // Des guetteurs qui tournent : leur dernier événement est toujours frais.
  const seaux = () => ({
    "aw-watcher-window_tour-demo": { id: "aw-watcher-window_tour-demo", type: "currentwindow", hostname: "tour-demo", last_updated: new Date().toISOString() },
    "aw-watcher-afk_tour-demo": { id: "aw-watcher-afk_tour-demo", type: "afkstatus", hostname: "tour-demo", last_updated: new Date().toISOString() },
    "aw-watcher-web-chrome_tour-demo": { id: "aw-watcher-web-chrome_tour-demo", type: "web.tab.current", hostname: "tour-demo" },
  });
  http.createServer((req, res) => {
    const u = new URL(req.url, "http://aw");
    res.setHeader("Content-Type", "application/json");
    if (u.pathname === "/api/0/info") return res.end(JSON.stringify({ hostname: "tour-demo", version: "v0.13.2", testing: false }));
    if (u.pathname === "/api/0/buckets/") return res.end(JSON.stringify(seaux()));
    const m = u.pathname.match(/^\/api\/0\/buckets\/([^/]+)\/events$/);
    if (!m) {
      res.statusCode = 404;
      return res.end("{}");
    }
    const id = decodeURIComponent(m[1]);
    const liste = id.includes("window") ? fenetres : id.includes("afk") ? absences : web;
    const a = Date.parse(u.searchParams.get("start") || "1970-01-01");
    const b = Date.parse(u.searchParams.get("end") || "2999-01-01");
    res.end(JSON.stringify(liste.filter((e) => Date.parse(e.timestamp) + e.duration * 1000 >= a && Date.parse(e.timestamp) <= b).reverse()));
  }).listen(9993);
}
console.log("mocks prêts");
