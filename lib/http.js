// Helpers HTTP partagés entre le serveur local (server.js) et les fonctions Vercel (api/).

export function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

// L'app iPhone (builds jusqu'au 08/10/2026) encodait le « ? » d'une requête
// dans le chemin : « /api/dashboard%3Ffrais=1 ». On le remet à sa place plutôt
// que de répondre « route inconnue » à une app déjà installée.
export function reparerRequete(req) {
  const [chemin, ...reste] = String(req.url || "").split("?");
  const i = chemin.search(/%3F/i);
  if (i === -1) return req;
  const requete = [chemin.slice(i + 3), ...reste].filter(Boolean).join("&");
  req.url = chemin.slice(0, i) + (requete ? `?${requete}` : "");
  return req;
}

export function sendJSON(res, status, obj) {
  securityHeaders(res);
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(body);
}

// Lit le corps JSON. Sur Vercel, req.body est déjà parsé ; en local c'est un flux.
export async function readJSON(req, maxOctets = 1_000_000) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
  }
  // Compté en OCTETS, et plus rien n'est gardé au-delà du plafond : avant, la
  // concaténation continuait après le refus — 512 Mo envoyés à /api/login
  // (sans authentification) faisaient tomber le serveur.
  const annonce = Number(req.headers?.["content-length"]);
  if (Number.isFinite(annonce) && annonce > maxOctets) {
    req.resume(); // le reste est lu et jeté : la réponse 413 peut partir
    throw new Error("Corps trop grand");
  }
  const data = await new Promise((resolve, reject) => {
    const morceaux = [];
    let taille = 0;
    let trop = false;
    req.on("data", (c) => {
      if (trop) return;
      taille += c.length;
      if (taille > maxOctets) {
        trop = true;
        morceaux.length = 0;
        reject(new Error("Corps trop grand"));
        return;
      }
      morceaux.push(c);
    });
    req.on("end", () => {
      if (!trop) resolve(Buffer.concat(morceaux).toString("utf8"));
    });
    req.on("error", reject);
  });
  return JSON.parse(data || "{}");
}

// Lit un corps binaire brut (audio…). Sur Vercel, application/octet-stream arrive
// déjà en Buffer dans req.body ; en local on lit le flux.
export async function readRawBody(req, maxBytes = 4_500_000) {
  if (req.body !== undefined && req.body !== null) {
    const buf = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === "string"
        ? Buffer.from(req.body, "binary")
        : null;
    if (!buf) throw new Error("Corps binaire attendu");
    if (buf.length > maxBytes) throw new Error("Corps trop grand");
    return buf;
  }
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("Corps trop grand"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const estLocale = (adr) => /^(127\.|::1$|::ffff:127\.)/.test(String(adr || ""));

// Ce que /api/health dit du proxy : la tour voit-elle passer l'adresse de
// l'iPhone (V5 du Lot 0) ?
export const diagnosticProxy = { xffVu: false, dernierXff: null };

export function getIP(req) {
  // X-Forwarded-For : chaque proxy AJOUTE l'adresse de son client à la fin.
  // La première peut donc être écrite par n'importe qui ; seule la DERNIÈRE,
  // posée par notre proxy, est sûre.
  //   - Vercel écrase l'en-tête : sa première adresse est la bonne.
  //   - Sur la tour (TRUST_PROXY=1), Tailscale Serve, sur la même machine,
  //     ajoute l'adresse de l'appareil : on prend la dernière, et seulement si
  //     la connexion vient bien de la machine elle-même.
  //   - Sinon : l'adresse de la connexion (un client pourrait forger l'en-tête
  //     pour contourner les limites).
  const xf = req.headers["x-forwarded-for"];
  const liste = (Array.isArray(xf) ? xf.join(",") : xf || "").split(",").map((x) => x.trim()).filter(Boolean);
  const socket = req.socket?.remoteAddress || "inconnu";
  if (liste.length) {
    diagnosticProxy.xffVu = true;
    diagnosticProxy.dernierXff = liste.length;
  }
  if (process.env.VERCEL && liste.length) return liste[0];
  if (process.env.TRUST_PROXY && liste.length && estLocale(socket)) return liste[liste.length - 1];
  return socket;
}

// Protection CSRF basique : si un Origin est fourni, il doit correspondre à l'hôte.
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function isHTTPS(req) {
  return (
    req.headers["x-forwarded-proto"] === "https" ||
    Boolean(process.env.VERCEL)
  );
}
