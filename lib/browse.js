// Le « bras » de Rémy : un vrai navigateur sans écran, pour lire les pages que
// web_fetch voit vides (rendu JavaScript côté client) et cliquer dedans.
// Sur Vercel : Chromium compact (@sparticuz/chromium). En local : le Chromium
// de Playwright (BROWSE_EXECUTABLE pour forcer un binaire précis).
//
// Garde-fous :
//  - anti-SSRF : jamais d'adresse locale, privée, Tailscale (100.64/10) ou
//    réservée, en IPv4 comme en IPv6 — vérifié sur l'adresse RÉSOLUE (un nom
//    public qui pointe vers 10.0.0.5 est refusé), pour la page, chaque
//    redirection et chaque ressource (BROWSE_ALLOW_LOCAL=1 pour les tests) ;
//  - ni WebSocket ni service worker (une page ne sort pas par la bande) ;
//  - images/polices/vidéos bloquées (vitesse) ;
//  - texte plafonné, temps plafonné.

import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { PRENOM } from "./profil.js";

const PAGE_TIMEOUT_MS = 20_000;
const MAX_TEXT = 8_000;
const MAX_BUTTONS = 25;

const v4EnEntier = (ip) => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
const PLAGES_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
].map(([base, bits]) => [v4EnEntier(base), bits]);

function v4Interdite(ip) {
  const n = v4EnEntier(ip);
  return PLAGES_V4.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
}

// IPv6 développée en 8 groupes de 16 bits.
function groupesV6(ip) {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = v4EnEntier(v4[1]);
    s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [tete, queue] = s.split("::");
  const a = tete ? tete.split(":") : [];
  const b = queue !== undefined && queue ? queue.split(":") : [];
  const milieu = queue !== undefined ? Array(8 - a.length - b.length).fill("0") : [];
  return [...a, ...milieu, ...b].map((g) => parseInt(g || "0", 16));
}

function v6Interdite(ip) {
  const g = groupesV6(ip);
  if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return true;
  const enV4 = (h, l) => `${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Interdite(enV4(g[6], g[7])); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return v4Interdite(enV4(g[6], g[7])); // ::a.b.c.d (ancien)
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4Interdite(enV4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return v4Interdite(enV4(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 (privé, dont Tailscale fd7a:115c:a1e0::/48)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // lien local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  return false;
}

export function adresseInterdite(ip) {
  // Tests seulement (REMY_ENV=test) : des adresses locales jouent le rôle
  // d'Internet, pour vérifier le vrai navigateur sans sortir de la machine.
  if (process.env.REMY_ENV === "test" && (process.env.BROWSE_TEST_PUBLIQUES || "").split(",").includes(ip)) return false;
  const t = net.isIP(ip);
  if (t === 4) return v4Interdite(ip);
  if (t === 6) return v6Interdite(ip);
  return true; // ni IPv4 ni IPv6 : refusé
}

// La cible est-elle publique ? Vérifie le nom ET toutes les adresses vers
// lesquelles il se résout. `resoudre` : remplaçable dans les tests.
export async function verifierCible(raw, { resoudre = (h) => dns.lookup(h, { all: true, verbatim: true }) } = {}) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("URL invalide");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Seuls http(s) sont autorisés");
  if (process.env.BROWSE_ALLOW_LOCAL === "1") return u;
  const h = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".ts.net")) {
    throw new Error("Adresse locale ou privée refusée");
  }
  if (net.isIP(h)) {
    if (adresseInterdite(h)) throw new Error("Adresse locale ou privée refusée");
    return u;
  }
  let adresses;
  try {
    adresses = await resoudre(h);
  } catch {
    throw new Error(`Nom introuvable : ${h}`);
  }
  if (!adresses?.length || adresses.some((a) => adresseInterdite(a.address))) {
    throw new Error(`Adresse locale ou privée refusée (le nom pointe vers le réseau de ${PRENOM})`);
  }
  return u;
}

// Le « lookup » des connexions sortantes du navigateur : l'adresse est
// vérifiée AU MOMENT où la tour se connecte, et c'est exactement celle-là qui
// est utilisée (un DNS qui répond « public » puis « privé » ne passe pas).
function lookupSur(hote, options, rappel) {
  dns
    .lookup(hote, { all: true, verbatim: true })
    .then((adresses) => {
      if (process.env.BROWSE_ALLOW_LOCAL !== "1" && (!adresses.length || adresses.some((a) => adresseInterdite(a.address)))) {
        return rappel(new Error("Adresse locale ou privée refusée"));
      }
      if (options?.all) return rappel(null, adresses);
      return rappel(null, adresses[0].address, adresses[0].family);
    })
    .catch((err) => rappel(err));
}

const MAX_OCTETS = 5 * 1024 * 1024;
const MAX_REDIRECTIONS = 5;
const SANS = new Set(["host", "connection", "content-length", "transfer-encoding", "accept-encoding", "keep-alive", "proxy-connection", "upgrade"]);

function uneRequete(url, { method, headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const entetes = Object.fromEntries(Object.entries(headers || {}).filter(([k]) => !SANS.has(k.toLowerCase()) && !k.startsWith(":")));
    entetes["accept-encoding"] = "gzip, deflate, br";
    const req = mod.request(u, { method, headers: entetes, lookup: lookupSur, timeout: PAGE_TIMEOUT_MS }, (res) => {
      const morceaux = [];
      let taille = 0;
      res.on("data", (c) => {
        taille += c.length;
        if (taille > MAX_OCTETS) req.destroy(new Error("Page trop lourde"));
        else morceaux.push(c);
      });
      res.on("end", () => {
        let corps = Buffer.concat(morceaux);
        const enc = String(res.headers["content-encoding"] || "").toLowerCase();
        try {
          // Plafonné APRÈS décompression aussi : 800 octets de brotli peuvent
          // devenir 1 Go et geler la tour (bombe de décompression).
          const plafond = { maxOutputLength: MAX_OCTETS * 4 };
          if (enc === "gzip") corps = zlib.gunzipSync(corps, plafond);
          else if (enc === "deflate") corps = zlib.inflateSync(corps, plafond);
          else if (enc === "br") corps = zlib.brotliDecompressSync(corps, plafond);
        } catch (err) {
          if (err?.code === "ERR_BUFFER_TOO_LARGE") return reject(new Error("Page trop lourde une fois décompressée"));
        }
        const h = { ...res.headers };
        delete h["content-encoding"];
        delete h["content-length"];
        delete h["transfer-encoding"];
        resolve({ status: res.statusCode, headers: h, corps });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("délai dépassé")));
    req.on("error", reject);
    if (body?.length) req.write(body);
    req.end();
  });
}

// Une requête du navigateur, faite par la tour : chaque étape d'une
// redirection est revérifiée (Chromium suit les redirections sans les montrer
// à Playwright — constaté : une 302 vers 127.0.0.2 partait sans contrôle).
export async function telechargerSur(url, { method = "GET", headers = {}, body = null } = {}) {
  let actuelle = url;
  let methode = method;
  let corps = body;
  for (let i = 0; i <= MAX_REDIRECTIONS; i++) {
    await verifierCible(actuelle);
    const r = await uneRequete(actuelle, { method: methode, headers, body: corps });
    const vers = r.headers.location;
    if (r.status >= 300 && r.status < 400 && vers) {
      actuelle = new URL(vers, actuelle).href;
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && methode === "POST")) {
        methode = "GET";
        corps = null;
      }
      continue;
    }
    return { ...r, urlFinale: actuelle };
  }
  throw new Error("Trop de redirections");
}

// Chromium n'a AUCUN accès réseau direct : toute requête légitime est servie
// par la tour (route → telechargerSur, adresse vérifiée). Sans ces options,
// des requêtes que Playwright ne voit pas (préchargements « speculationrules »,
// prerender, SharedWorker, iframe, WebRTC) partaient vers le réseau privé —
// constaté par la revue de sécurité du Lot 0.
const SANS_RESEAU = [
  "--proxy-server=http://127.0.0.1:9", // port « discard » : tout ce qui sort directement échoue
  "--proxy-bypass-list=<-loopback>", // y compris vers la tour elle-même
  "--webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--force-webrtc-ip-handling-policy",
  "--disable-features=WebTransport,Prerender2,SpeculationRulesPrefetchFuture",
];

async function launchBrowser() {
  const { chromium } = await import("playwright-core");
  if (process.env.VERCEL) {
    const sparticuz = (await import("@sparticuz/chromium")).default;
    return chromium.launch({
      args: [...sparticuz.args, ...SANS_RESEAU],
      executablePath: await sparticuz.executablePath(),
      headless: true,
    });
  }
  const executablePath = process.env.BROWSE_EXECUTABLE;
  if (executablePath) return chromium.launch({ executablePath, headless: true, args: SANS_RESEAU });
  // Local : laisser playwright-core trouver le Chromium installé par Playwright.
  try {
    return await chromium.launch({ headless: true, args: SANS_RESEAU });
  } catch {
    // Dernier recours : le paquet playwright complet s'il est présent.
    const pw = await import("playwright");
    return pw.chromium.launch({ headless: true, args: SANS_RESEAU });
  }
}

// Visite une page, exécute le JavaScript, clique éventuellement (par texte
// visible), puis renvoie ce qu'un humain verrait : titre, texte, boutons/liens.
export async function browsePage({ url, clics = [] }) {
  await verifierCible(url);
  const browser = await launchBrowser();
  try {
    const contexte = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    const page = await contexte.newPage();
    // Chaque requête de la page — redirections et ressources comprises — est
    // faite par la tour, qui vérifie chaque adresse avant de s'y connecter :
    // une page publique ne fait pas appeler la tour, les Sparks ou le tailnet.
    let urlFinale = url;
    let refus = null;
    await contexte.route("**/*", async (route) => {
      const req = route.request();
      if (["image", "media", "font"].includes(req.resourceType())) return route.abort();
      if (!/^https?:/.test(req.url())) return route.abort("blockedbyclient");
      try {
        const r = await telechargerSur(req.url(), { method: req.method(), headers: await req.allHeaders(), body: req.postDataBuffer() });
        let corps = r.corps;
        const principale = req.isNavigationRequest() && req.frame() === page.mainFrame();
        if (principale) urlFinale = r.urlFinale;
        // Servie à l'adresse demandée : les liens relatifs suivent la vraie destination.
        if (r.urlFinale !== req.url() && /text\/html/i.test(String(r.headers["content-type"] || ""))) {
          const base = `<base href="${r.urlFinale.replace(/"/g, "&quot;")}">`;
          // latin1 : octet pour octet, quel que soit l'encodage de la page.
          const html = corps.toString("latin1");
          corps = Buffer.from(/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html, "latin1");
        }
        return route.fulfill({ status: r.status, headers: r.headers, body: corps });
      } catch (err) {
        if (req.isNavigationRequest() && req.frame() === page.mainFrame()) refus = err.message;
        return route.abort("blockedbyclient");
      }
    });
    await contexte.routeWebSocket(/.*/, (ws) => ws.close()).catch(() => {});
    // WebRTC et WebTransport parlent UDP sans passer par le proxy (constaté
    // avec headless_shell) : retirés de chaque page avant tout script.
    await contexte.addInitScript(() => {
      for (const nom of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCIceCandidate", "WebTransport"]) {
        try {
          Object.defineProperty(globalThis, nom, { value: undefined, configurable: false, writable: false });
        } catch {}
      }
    });
    try {
      await page.goto(url, { timeout: PAGE_TIMEOUT_MS, waitUntil: "domcontentloaded" });
    } catch (err) {
      throw new Error(refus || err.message.split("\n")[0]);
    }
    await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(600);

    const actions = [];
    for (const label of (clics || []).slice(0, 4)) {
      const text = String(label).slice(0, 80);
      try {
        const target = page
          .locator(`button:visible, a:visible, [role="button"]:visible, [role="tab"]:visible, [role="link"]:visible`)
          .filter({ hasText: text })
          .first();
        await target.click({ timeout: 5_000 });
        await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
        await page.waitForTimeout(500);
        actions.push(`clic « ${text} » : ok`);
      } catch {
        actions.push(`clic « ${text} » : introuvable ou impossible`);
      }
    }

    const extracted = await page.evaluate(() => {
      const texte = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
      const boutons = [
        ...new Set(
          [...document.querySelectorAll("button, a, [role='button'], [role='tab']")]
            .map((e) => (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "))
            .filter((t) => t && t.length <= 60)
        ),
      ];
      return { texte, boutons };
    });

    return {
      url_finale: urlFinale,
      titre: await page.title(),
      actions,
      texte: extracted.texte.slice(0, MAX_TEXT) + (extracted.texte.length > MAX_TEXT ? "\n[… texte tronqué]" : ""),
      elements_cliquables: extracted.boutons.slice(0, MAX_BUTTONS),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
