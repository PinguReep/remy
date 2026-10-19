// Rémy Chat — serveur de développement local.
// En production, l'app tourne sur Vercel (fichiers statiques + fonctions api/).
// Ce serveur réutilise exactement les mêmes handlers (lib/handlers.js).

import http from "node:http";
import fs from "node:fs";
import util from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routeApi } from "./lib/routes.js";
import { authConfigured } from "./lib/auth.js";
import { providerName } from "./lib/providers.js";
import { sendJSON } from "./lib/http.js";
import { demarrerPlanificateur } from "./lib/planif.js";
import { sauvegarderRemy } from "./lib/sauvegarde.js";
import { runReflection } from "./lib/reflection.js";
import { preparerCoffre, coffre } from "./lib/coffre.js";
import { cerveau } from "./lib/providers.js";

// Sur la tour, Node tient son journal lui-même (UTF-8, horodaté) : relayée par
// PowerShell 5.1, sa sortie perdait les accents.
if (process.env.REMY_LOG) {
  const journal = fs.createWriteStream(process.env.REMY_LOG, { flags: "a" });
  for (const niveau of ["log", "info", "warn", "error"]) {
    console[niveau] = (...args) => journal.write(`${new Date().toISOString()} ${niveau === "log" ? "" : niveau.toUpperCase() + " "}${util.format(...args)}
`);
  }
  process.on("uncaughtException", (err) => {
    console.error("Exception non rattrapée :", err);
    journal.end(() => process.exit(1));
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
// Boucle locale par défaut : sur la tour, seul Tailscale Serve publie Rémy
// (HTTPS, appareils du tailnet seulement). HOST=0.0.0.0 pour l'ouvrir au LAN.
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Interdit");
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end("Introuvable");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (!url.pathname.startsWith("/api")) return serveStatic(res, url.pathname);
    const handled = await routeApi(req, res);
    if (!handled) return sendJSON(res, 404, { error: "Route inconnue" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) return sendJSON(res, 500, { error: "Erreur serveur" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Rémy démarré → http://${HOST}:${PORT} · cerveau ${cerveau()}${coffre() ? ` · coffre ${coffre()}` : ""}`);
  preparerCoffre();
  demarrerPlanificateur(runReflection, sauvegarderRemy);
  const provider = providerName();
  if (provider === "claude-code") {
    console.log("🧠 Moteur : Claude Code (abonnement Max). Assure-toi d'être connecté (`claude` puis /login).");
  } else if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  Moteur : API, mais ANTHROPIC_API_KEY n'est pas défini : le chat affichera une erreur.");
  } else {
    console.log("🧠 Moteur : API Anthropic.");
  }
  if (!authConfigured()) {
    console.log("ℹ️  Aucun mot de passe configuré : authentification désactivée (mode dev local).");
  }
});
