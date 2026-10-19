// Authentification par mot de passe + sessions signées + anti brute force.
//
// Variables d'environnement :
//   APP_PASSWORD_HASH  (recommandé)  → généré avec : node scripts/hash-password.js "ton-mdp"
//   APP_PASSWORD       (dépannage)   → mot de passe en clair (moins bien : visible dans Vercel)
//   SESSION_SECRET     (recommandé)  → openssl rand -hex 32 ; sinon dérivé du mot de passe
//
// En local sans mot de passe configuré, l'authentification est désactivée (mode dev).
// Sur Vercel sans mot de passe configuré, tout est refusé (jamais d'accès ouvert par accident).

import crypto from "node:crypto";
import { sendJSON, getIP, sameOrigin, isHTTPS } from "./http.js";
import { counterIncr, counterReset } from "./store.js";
import { jetonDe, appareilDuJeton, emettre } from "./appareils.js";

const COOKIE = "remy_session";
const SESSION_DAYS = 30;

const MAX_FAILS_PER_IP = 5; // au-delà : blocage 15 min pour cette IP
const IP_WINDOW_SEC = 15 * 60;
const MAX_FAILS_GLOBAL = 50; // au-delà (toutes IP confondues) : blocage 1 h — contre les attaques distribuées
const GLOBAL_WINDOW_SEC = 60 * 60;

export function authConfigured() {
  return Boolean(process.env.APP_PASSWORD_HASH || process.env.APP_PASSWORD);
}

function authRequired(req) {
  // Sur Vercel l'auth est toujours exigée ; ailleurs dès qu'un mdp est
  // configuré. Sans mot de passe, SEUL l'accès direct depuis la machine reste
  // ouvert (développement) : une tour fraîchement installée, publiée par
  // Tailscale Serve avant que le hash soit posé, n'est pas ouverte au tailnet.
  return Boolean(process.env.VERCEL) || authConfigured() || !estDirectLocal(req);
}

export function verifyPassword(pwd) {
  const hash = process.env.APP_PASSWORD_HASH;
  if (hash && hash.startsWith("scrypt:")) {
    const [, salt, hex] = hash.split(":");
    if (!salt || !hex) return false;
    const calc = crypto.scryptSync(pwd, salt, hex.length / 2);
    return crypto.timingSafeEqual(calc, Buffer.from(hex, "hex"));
  }
  const plain = process.env.APP_PASSWORD;
  if (plain) {
    const a = Buffer.from(String(pwd));
    const b = Buffer.from(plain);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return false;
}

function secret() {
  const s =
    process.env.SESSION_SECRET ||
    process.env.APP_PASSWORD_HASH ||
    process.env.APP_PASSWORD ||
    "dev-only";
  return crypto.createHash("sha256").update("remy-session:" + s).digest();
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function makeSessionToken() {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + SESSION_DAYS * 86400_000, v: 1 })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function checkSessionToken(token) {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now();
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function setSessionCookie(req, res, token) {
  const secure = isHTTPS(req) ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`
  );
}

export function clearSessionCookie(req, res) {
  const secure = isHTTPS(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

// Garde-fou à appeler au début de chaque handler protégé. Renvoie true si OK,
// sinon répond 401/403 et renvoie false.
export function requireAuth(req, res) {
  if (!sameOrigin(req)) {
    sendJSON(res, 403, { error: "origin" });
    return false;
  }
  if (!authRequired(req)) return true; // mode dev local, depuis la machine elle-même
  if (!authConfigured()) {
    sendJSON(res, 401, { error: "auth", message: "Mot de passe non configuré (APP_PASSWORD_HASH)." });
    return false;
  }
  // Un appareil qui présente son jeton est jugé sur CE jeton : révoqué, il
  // est déconnecté, même s'il a encore un cookie (sinon « Déconnecter cet
  // iPhone » attendrait 30 jours).
  const jeton = jetonDe(req);
  if (jeton) {
    let appareil;
    try {
      appareil = appareilDuJeton(jeton);
    } catch (err) {
      console.error(err.message);
      sendJSON(res, 503, { error: "base", message: "La base de la tour est indisponible pour le moment : réessaie dans un instant (ton appareil reste connecté)." });
      return false;
    }
    if (appareil) {
      req.appareil = appareil;
      return true;
    }
    sendJSON(res, 401, { error: "auth", message: "Cet appareil a été déconnecté — reconnecte-toi." });
    return false;
  }
  const token = parseCookies(req)[COOKIE];
  if (checkSessionToken(token)) return true;
  sendJSON(res, 401, { error: "auth" });
  return false;
}

// Sans répondre : la requête vient-elle de Sam (session, jeton valide, ou
// mode dev sans mot de passe) ? Pour les routes publiques qui en disent plus
// à Sam qu'à un inconnu (/api/health).
export function estAutorise(req) {
  if (!authRequired(req)) return true;
  if (!authConfigured()) return false;
  const jeton = jetonDe(req);
  if (jeton) {
    try {
      return Boolean(appareilDuJeton(jeton));
    } catch {
      return false;
    }
  }
  return checkSessionToken(parseCookies(req)[COOKIE]);
}

// Sur la tour elle-même (pas via Tailscale Serve) : connexion locale, sans
// en-tête de proxy, adressée à localhost.
export function estDirectLocal(req) {
  const adr = String(req.socket?.remoteAddress || "");
  const hote = String(req.headers.host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return /^(127\.|::1$|::ffff:127\.)/.test(adr) && !req.headers["x-forwarded-for"] && ["localhost", "127.0.0.1", "::1"].includes(hote);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tentative de connexion avec anti brute force.
// `appareil` : le nom de l'appareil qui se connecte (l'app iPhone) — il reçoit
// alors son propre jeton, en plus du cookie.
export async function attemptLogin(req, res, password, { appareil = null } = {}) {
  if (!sameOrigin(req)) return sendJSON(res, 403, { error: "origin" });
  if (!authConfigured()) {
    return sendJSON(res, 500, {
      error: "config",
      message: "Aucun mot de passe configuré. Définis APP_PASSWORD_HASH dans les variables d'environnement.",
    });
  }

  const ip = getIP(req);
  const ipKey = `remy:bf:ip:${ip}`;
  const globalKey = "remy:bf:global";

  // L'essai est COMPTÉ avant d'être vérifié : lire le compteur, attendre,
  // puis l'incrémenter laissait passer 60 essais envoyés en même temps (revue
  // de sécurité du Lot 0). Un succès remet le compteur de l'adresse à zéro.
  const [essaisIp, essaisGlobal] = await Promise.all([
    counterIncr(ipKey, IP_WINDOW_SEC),
    counterIncr(globalKey, GLOBAL_WINDOW_SEC),
  ]);
  if (essaisIp > MAX_FAILS_PER_IP || essaisGlobal > MAX_FAILS_GLOBAL) {
    return sendJSON(res, 429, {
      error: "locked",
      message: "Trop de tentatives. Réessaie dans 15 minutes.",
    });
  }

  // Petit délai aléatoire : ralentit les attaques et masque le temps de calcul.
  await sleep(250 + Math.random() * 500);

  if (!verifyPassword(String(password || ""))) {
    console.warn(`Connexion refusée depuis ${ip} (${essaisIp}/${MAX_FAILS_PER_IP})`);
    return sendJSON(res, 401, { error: "bad_password", message: "Mot de passe incorrect." });
  }

  await counterReset(ipKey);
  setSessionCookie(req, res, makeSessionToken());
  if (typeof appareil === "string" && appareil.trim()) {
    try {
      const a = emettre(appareil);
      return sendJSON(res, 200, { ok: true, jeton: a.jeton, appareil: { id: a.id, nom: a.nom } });
    } catch (err) {
      // Base indisponible : la connexion vaut quand même (cookie), sans jeton.
      console.warn("Jeton d'appareil non émis :", err.message);
    }
  }
  return sendJSON(res, 200, { ok: true });
}
