// Tour de démo PILOTÉE pour les parcours de l'app iPhone (CI, données fictives).
// Lance les faux services (ios-native/ci/faux-services.mjs) et server.js avec
// les mêmes réglages que les captures, plus un petit cerveau de conversation,
// puis écoute un port de pilotage que les tests XCUITest appellent :
//   POST /reinitialiser  données de démo d'origine, journée recalée sur maintenant
//   POST /couper         la tour s'éteint (Tailscale coupé, PC éteint…)
//   POST /relancer       la tour revient
//   GET  /etat           { tour: true|false }
// Aucune vraie clé, aucune vraie donnée. Rien de ce fichier n'entre dans l'app.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..", "..");
const port = (nom, defaut) => Number(process.env[nom] || defaut);
const PORT_TOUR = port("PORT_TOUR", 3000);
const PORT_PILOTE = port("PORT_PILOTE", 3099);
const PORT_CERVEAU = port("PORT_CERVEAU", 9993);
const P = { motion: port("PORT_MOTION", 9998), google: port("PORT_GOOGLE", 9995), dictee: port("PORT_DICTEE", 9997), glm: port("PORT_GLM", 9994) };
// Les faux services (ports figés dans le script de la CI ; une copie aux ports décalés en local).
const FAUX = process.env.FAUX_SERVICES || path.join(RACINE, "ios-native/ci/faux-services.mjs");
const DONNEES = path.join(RACINE, "data");
const JOURNAL = process.env.JOURNAL_TOUR || path.join(RACINE, "serveur-parcours.log");

const envTour = () => ({
  ...process.env,
  APP_PASSWORD: "demo-demo-demo", SESSION_SECRET: "ci", ANTHROPIC_API_KEY: "sk-ci",
  MOTION_API_KEY: "faux", MOTION_BASE_URL: `http://127.0.0.1:${P.motion}/v1`,
  GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y",
  GOOGLE_API_URL: `http://127.0.0.1:${P.google}/calendar/v3`, GOOGLE_TOKEN_URL: `http://127.0.0.1:${P.google}/token`,
  DICTEE_LOCALE_URL: `http://127.0.0.1:${P.dictee}`,
  // Le cerveau local (modèle sur les Sparks) : ici le petit cerveau de parcours,
  // qui relaie le reste au faux modèle de la CI.
  REMY_GLM_URL: `http://127.0.0.1:${PORT_CERVEAU}/v1`, REMY_PLANIF: "off",
  CRON_SECRET: "ci", REMY_ENV: "test", PORT: String(PORT_TOUR),
});

let tour = null;
let faux = null;
const journal = fs.createWriteStream(JOURNAL, { flags: "a" });
const note = (m) => journal.write(`[pilote ${new Date().toISOString()}] ${m}\n`);

function lancer(script, env, cwd = RACINE) {
  const p = spawn(process.execPath, [script], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.pipe(journal, { end: false });
  p.stderr.pipe(journal, { end: false });
  return p;
}

// Tuée par un signal, un processus garde exitCode à null : c'est signalCode qui le dit.
const vivant = (p) => Boolean(p && p.exitCode === null && p.signalCode === null);

async function arreter(p) {
  if (!vivant(p)) return;
  await new Promise((fin) => {
    p.once("exit", fin);
    p.kill("SIGTERM");
    setTimeout(() => p.kill("SIGKILL"), 3000);
  });
}

async function attendre(url, essais = 60) {
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function demarrerTour() {
  if (vivant(tour)) return true;
  tour = lancer("server.js", envTour());
  return attendre(`http://127.0.0.1:${PORT_TOUR}/api/health`);
}

async function reinitialiser() {
  await arreter(tour);
  await arreter(faux);
  fs.rmSync(DONNEES, { recursive: true, force: true });
  await new Promise((fin, rate) => {
    const s = lancer(path.join(RACINE, "ios-native/ci/donnees-demo.mjs"), { ...process.env, REMY_DATA_DIR: "" });
    s.once("exit", (c) => (c === 0 ? fin() : rate(new Error(`données de démo : code ${c}`))));
  });
  // La journée des faux services est calculée à leur démarrage : relancés, ils suivent l'heure.
  faux = lancer(FAUX, process.env, path.dirname(FAUX));
  await attendre(`http://127.0.0.1:${P.motion}/v1/workspaces`);
  return demarrerTour();
}

// --- Le cerveau de parcours ----------------------------------------------------------
// Une conversation qui répond vraiment (flux SSE comme le modèle local) : une demande
// de tâche reçoit une proposition Motion (outil motion_proposer), le reste une phrase.
// Les tâches courtes (routeur, titre, conseil, capture…) vont au faux modèle de la CI.
const delta = (d, fin = null) => ({ choices: [{ index: 0, delta: d, finish_reason: fin }] });

function nomDeTache(texte) {
  const t = texte.replace(/^(rémy|remy)[, ]*/i, "").replace(/^(peux-tu|tu peux|pense à|il faut que je|faut que je|je dois)\s*/i, "").trim();
  const sans = t.replace(/\s*(avant|d'ici|pour)?\s*(vendredi|jeudi|lundi|mardi|mercredi|samedi|dimanche|demain)\b.*$/i, "").replace(/[.?!]+$/, "");
  return (sans.charAt(0).toUpperCase() + sans.slice(1)).slice(0, 80) || "Nouvelle tâche";
}

function vendrediProchain() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + (((5 - d.getUTCDay() + 7) % 7) || 7));
  return d.toISOString().slice(0, 10) + "T17:00:00+02:00";
}

function repondreFlux(res, b) {
  const messages = b.messages || [];
  const dernier = messages.at(-1) || {};
  const texteDe = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).map((x) => x.text || "").join(" "));
  let tours;
  if (dernier.role === "tool") {
    tours = [delta({ content: "C'est prêt : dis oui d'un tap, ou ajuste l'échéance avant." }, "stop")];
  } else {
    const dit = texteDe([...messages].reverse().find((m) => m.role === "user"));
    if (/facture|devis|ajoute|cale|planifie|pense à|faut que je|je dois/i.test(dit)) {
      const args = JSON.stringify({
        resume: "Une tâche avec une échéance, pour que Motion la place.",
        actions: [{ type: "creer", nom: nomDeTache(dit), echeance: vendrediProchain(), duree: "30", priorite: "MEDIUM" }],
      });
      tours = [
        delta({ content: "Je te la mets dans Motion, avant vendredi : une demi-heure suffit." }),
        delta({ tool_calls: [{ index: 0, id: "appel-1", type: "function", function: { name: "motion_proposer", arguments: args.slice(0, 30) } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: args.slice(30) } }] }, "tool_calls"),
      ];
    } else {
      tours = [delta({ content: "Noté. " }), delta({ content: "Ta journée tient : reste sur la démo jusqu'à la fin du créneau." }, "stop")];
    }
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const e of tours) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 40 } })}\n\n`);
  res.end("data: [DONE]\n\n");
}

http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", async () => {
    let b = {};
    try { b = JSON.parse(corps || "{}"); } catch {}
    const systeme = String(typeof b.messages?.[0]?.content === "string" ? b.messages[0].content : "");
    if (req.method === "POST" && req.url.endsWith("/chat/completions")) {
      if (b.stream) return repondreFlux(res, b);
      const court = (texte) => res.end(JSON.stringify({ choices: [{ message: { content: texte }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 3 } }));
      res.setHeader("Content-Type", "application/json");
      if (systeme.startsWith("Tu es le routeur")) return court("raisonnement");
      if (systeme.startsWith("Tu génères le titre")) return court("Tâche à caler");
    }
    // Le reste : au faux modèle de la CI, tel quel.
    try {
      const r = await fetch(`http://127.0.0.1:${P.glm}${req.url}`, { method: req.method, headers: { "Content-Type": "application/json" }, body: req.method === "GET" ? undefined : corps });
      res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "application/json" });
      res.end(await r.text());
    } catch (e) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: String(e) }));
    }
  });
}).listen(PORT_CERVEAU, "127.0.0.1");

// --- Le pilotage ---------------------------------------------------------------------
let file = Promise.resolve();
const enFile = (f) => (file = file.then(f, f));

http.createServer((req, res) => {
  const repondre = (code, objet) => {
    res.writeHead(code, { "Content-Type": "application/json", Connection: "close" });
    res.end(JSON.stringify(objet));
  };
  req.resume();
  req.on("end", () => {
    const u = req.url.split("?")[0];
    note(`${req.method} ${u}`);
    if (u === "/etat") return repondre(200, { tour: vivant(tour) });
    if (req.method !== "POST") return repondre(405, {});
    if (u === "/reinitialiser") return enFile(reinitialiser).then((ok) => repondre(ok ? 200 : 500, { ok }), (e) => repondre(500, { erreur: String(e) }));
    if (u === "/couper") return enFile(() => arreter(tour)).then(() => repondre(200, { ok: true }));
    if (u === "/relancer") return enFile(demarrerTour).then((ok) => repondre(ok ? 200 : 500, { ok }));
    repondre(404, {});
  });
}).listen(PORT_PILOTE, "127.0.0.1", async () => {
  const ok = await enFile(reinitialiser);
  note(`prêt (tour ${ok ? "joignable" : "INJOIGNABLE"})`);
  console.log(ok ? "pilote prêt" : "pilote : la tour ne démarre pas");
});

for (const s of ["SIGINT", "SIGTERM"]) {
  process.on(s, async () => {
    await arreter(tour);
    await arreter(faux);
    process.exit(0);
  });
}
