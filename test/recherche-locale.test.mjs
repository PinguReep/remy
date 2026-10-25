// La recherche du modèle local (25/10, lib/recherche.js) : il cherche et lit
// lui-même, sans carte « Tu autorises ? » ni Claude.
//   - DuckDuckGo (html, puis lite si bloqué) et SearXNG, lus sur des pages
//     enregistrées (test/fixtures/recherche) : aucun accès réseau ;
//   - lire_page passe par la garde anti-SSRF du navigateur ;
//   - la boucle d'outils : un faux modèle local cherche, lit, répond — un
//     chiffre lu passe, un chiffre inventé est signalé « à vérifier » ;
//   - conversation privée, recherche coupée, moteur en panne : sans outil, ou
//     une erreur claire rendue au modèle.
//
// 127.0.0.1 joue « Internet » (BROWSE_TEST_PUBLIQUES, sous REMY_ENV=test
// seulement) ; 127.0.0.2 joue le réseau privé de Sam.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

console.log = () => {};
console.warn = () => {};

const ici = path.dirname(fileURLToPath(import.meta.url));
const fixture = (nom) => fs.readFileSync(path.join(ici, "fixtures", "recherche", nom), "utf8");
const ecouter = (srv, hote = "127.0.0.1") => new Promise((ok) => srv.listen(0, hote, ok));

// --- Faux DuckDuckGo : html et lite, selon `ddg.mode`. ----------------------------
const ddg = { mode: "ok", requetes: [] };
const serveurDdg = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    const lite = req.url.startsWith("/lite");
    ddg.requetes.push({ chemin: req.url, corps, ua: req.headers["user-agent"], langue: req.headers["accept-language"] });
    const bloque = ddg.mode === "anomalie" || (ddg.mode === "anomalie-html" && !lite);
    if (bloque) return res.writeHead(202, { "Content-Type": "text/html" }).end(fixture("ddg-anomalie.html"));
    if (ddg.mode === "panne") return res.writeHead(500).end("oups");
    if (ddg.mode === "vide") return res.writeHead(200, { "Content-Type": "text/html" }).end(fixture("ddg-vide.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fixture(lite ? "ddg-lite.html" : "ddg-html.html"));
  });
});
await ecouter(serveurDdg);

// --- Faux SearXNG. -------------------------------------------------------------------
const sx = { mode: "ok", requetes: [] };
const serveurSx = http.createServer((req, res) => {
  sx.requetes.push(req.url);
  if (sx.mode === "403") return res.writeHead(403).end("Forbidden");
  res.writeHead(200, { "Content-Type": "application/json" }).end(fixture("searxng.json"));
});
await ecouter(serveurSx);

// --- « Internet » (127.0.0.1) et réseau privé (127.0.0.2). --------------------------
let secretVu = 0;
const prive = http.createServer((q, r) => {
  secretVu++;
  r.end("SECRET");
});
await ecouter(prive, "127.0.0.2");
const urlPrivee = `http://127.0.0.2:${prive.address().port}/secret`;
const web = http.createServer((q, r) => {
  if (q.url === "/seuils") return r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fixture("page-officielle.html"));
  if (q.url === "/vers-prive") return r.writeHead(302, { Location: urlPrivee }).end();
  if (q.url === "/notice.pdf") return r.writeHead(200, { "Content-Type": "application/pdf" }).end("%PDF-1.4");
  if (q.url === "/latin1") {
    return r.writeHead(200, { "Content-Type": "text/html; charset=iso-8859-1" }).end(Buffer.from("<html><body><main><p>Publié le 3 mars 2025</p><p>Prélèvement à la source : " + "é".repeat(300) + "</p></main></body></html>", "latin1"));
  }
  r.writeHead(404).end("introuvable");
});
await ecouter(web);
const internet = `http://127.0.0.1:${web.address().port}`;

// --- Faux modèle local : un script par réponse en flux. ------------------------------
const glm = { script: [], flux: [] };
const delta = (d, fin = null) => ({ choices: [{ index: 0, delta: d, finish_reason: fin }] });
const appel = (id, name, args) => [delta({ tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] }, "tool_calls")];
const texte = (t) => [delta({ content: t }, "stop")];
const serveurGlm = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: "glm" }] }));
    const b = JSON.parse(corps || "{}");
    if (!b.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { content: "NO_UPDATE" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }
    glm.flux.push(b);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const e of glm.script.shift() || texte("Réponse locale.")) res.write(`data: ${JSON.stringify(e)}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await ecouter(serveurGlm);

// --- Faux Claude : ne doit jamais être appelé. -----------------------------------------
const claude = [];
const anthropic = http.createServer((req, res) => {
  claude.push(req.url);
  res.writeHead(500).end("{}");
});
await ecouter(anthropic);

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-recherche-locale-"));
for (const v of ["REMY_VAULT", "MOTION_API_KEY", "GOOGLE_CLIENT_ID", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "APP_PASSWORD", "APP_PASSWORD_HASH", "VERCEL", "REMY_MODEL", "REMY_CERVEAU", "REMY_SECOURS_CLOUD", "REMY_WEB_SEARCH", "REMY_RECHERCHE", "REMY_SEARXNG_URL", "REMY_RECHERCHE_MAX", "REMY_LECTURE_MAX", "BROWSE_ALLOW_LOCAL", "REMY_ALLEGEMENT", "REMY_CONSEIL_CLOUD"]) {
  delete process.env[v];
}
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_GLM_URL = `http://127.0.0.1:${serveurGlm.address().port}/v1`;
process.env.REMY_PROVIDER = "api";
process.env.ANTHROPIC_API_KEY = "cle-de-test";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropic.address().port}`;
process.env.REMY_BROWSE = "off";
process.env.BROWSE_TEST_PUBLIQUES = "127.0.0.1";
process.env.REMY_DUCKDUCKGO_URL = `http://127.0.0.1:${serveurDdg.address().port}/html/`;
process.env.REMY_DUCKDUCKGO_LITE_URL = `http://127.0.0.1:${serveurDdg.address().port}/lite/`;

const recherche = await import("../lib/recherche.js");
const { analyserDuckDuckGo, analyserSearxng, chercherWeb, lirePage, dateDePage, chiffresAVerifier, ligneAVerifier, extraireTexte, _oublierBlocage } = recherche;
const { _outilsClient, _executerOutil } = await import("../lib/providers.js");
const store = await import("../lib/store.js");
const { routeApi } = await import("../lib/routes.js");
const { fermer } = await import("../lib/db.js");

const remy = http.createServer(async (req, res) => {
  if (!(await routeApi(req, res))) (res.statusCode = 404), res.end("{}");
});
await ecouter(remy);
const base = `http://127.0.0.1:${remy.address().port}`;

test.after(() => {
  for (const s of [remy, serveurGlm, anthropic, serveurDdg, serveurSx, web, prive]) s.close();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

const json = (methode, chemin, corps) =>
  fetch(base + chemin, { method: methode, headers: { "Content-Type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps) });

async function flux(chemin, corps) {
  const t = await (await json("POST", chemin, corps)).text();
  return t
    .split("\n\n")
    .filter(Boolean)
    .map((bloc) => ({ nom: bloc.match(/^event: (.+)$/m)?.[1], data: JSON.parse(bloc.match(/^data: (.+)$/m)?.[1] || "null") }))
    .filter((e) => e.nom);
}
const nouveauFil = async (corps = {}) => (await (await json("POST", "/api/conversations", corps)).json()).id;
const nomsOutils = (b) => (b.tools || []).map((t) => t.function.name);

// --- Les moteurs ----------------------------------------------------------------------

test("DuckDuckGo « html » : résultats propres, publicité et doublon écartés, redirection décodée", () => {
  const r = analyserDuckDuckGo(fixture("ddg-html.html"));
  assert.deepEqual(r.map((x) => x.url), [
    "https://www.urssaf.fr/accueil/independant/micro-entrepreneur/seuils.html",
    "https://www.service-public.fr/professionnels-entreprises/vosdroits/F32353",
    "https://www.blog-bougies.example/micro-entreprise-seuils",
  ]);
  assert.equal(r[0].titre, "Micro-entrepreneur : les seuils de chiffre d'affaires - Urssaf.fr");
  assert.match(r[0].extrait, /ne doit pas dépasser 77 ?\s?700 € pour les prestations/);
  assert.match(r[1].extrait, /Vérifié le 1er janvier 2026/);
});

test("DuckDuckGo « lite » : même lecture, autre mise en page", () => {
  const r = analyserDuckDuckGo(fixture("ddg-lite.html"));
  assert.deepEqual(r.map((x) => x.url), [
    "https://www.service-public.fr/professionnels-entreprises/vosdroits/F23267",
    "https://www.urssaf.fr/accueil/exoneration-acre-createur.html",
  ]);
  assert.match(r[0].extrait, /^L'Acre consiste en une exonération partielle/);
  assert.equal(r[1].titre, "L'Acre : l'aide pour les créateurs et repreneurs - Urssaf.fr");
});

test("DuckDuckGo : vérification anti-robot, aucun résultat, page inconnue", () => {
  assert.throws(() => analyserDuckDuckGo(fixture("ddg-anomalie.html")), /anti-robot/);
  assert.deepEqual(analyserDuckDuckGo(fixture("ddg-vide.html")), []);
  assert.throws(() => analyserDuckDuckGo("<html><body>Autre chose</body></html>"), /illisible/);
});

test("SearXNG : résultats JSON, liens non web et doublons écartés, date gardée", () => {
  const r = analyserSearxng(JSON.parse(fixture("searxng.json")));
  assert.equal(r.length, 2);
  assert.equal(r[0].date, "2026-01-12");
  assert.equal(r[1].date, undefined);
});

test("chercher_web par DuckDuckGo : en-têtes de navigateur, html d'abord, lite s'il bloque, message clair s'il bloque partout", async () => {
  _oublierBlocage();
  ddg.mode = "ok";
  ddg.requetes = [];
  let r = await chercherWeb({ requete: "seuil micro-entreprise 2026", nombre: 2 });
  assert.equal(r.backend, "duckduckgo");
  assert.equal(r.pointDEntree, "html.duckduckgo.com");
  assert.equal(r.resultats.length, 2);
  assert.match(ddg.requetes[0].corps, /q=seuil\+micro-entreprise\+2026/);
  assert.match(ddg.requetes[0].ua, /Mozilla\/5\.0/);
  assert.match(ddg.requetes[0].langue, /^fr-FR/);

  ddg.mode = "anomalie-html";
  r = await chercherWeb({ requete: "acre 2026" });
  assert.equal(r.pointDEntree, "lite.duckduckgo.com");
  assert.equal(r.resultats.length, 2);

  ddg.mode = "anomalie";
  ddg.requetes = [];
  await assert.rejects(chercherWeb({ requete: "acre 2026" }), /DuckDuckGo bloque.*SearXNG/s);
  assert.equal(ddg.requetes.length, 2, "les deux points d'entrée essayés");
  await assert.rejects(chercherWeb({ requete: "acre 2026" }), /DuckDuckGo bloque/);
  assert.equal(ddg.requetes.length, 2, "bloqué : on n'insiste pas pendant quelques minutes");
  _oublierBlocage();

  ddg.mode = "panne";
  await assert.rejects(chercherWeb({ requete: "acre 2026" }), /Recherche impossible \(DuckDuckGo\).*réponse 500/);
  ddg.mode = "ok";
  await assert.rejects(chercherWeb({ requete: "   " }), /Requête vide/);
});

test("chercher_web par SearXNG : JSON, format refusé, adresse manquante ou injoignable", async () => {
  process.env.REMY_RECHERCHE = "searxng";
  try {
    await assert.rejects(chercherWeb({ requete: "x" }), /REMY_SEARXNG_URL manque/);
    process.env.REMY_SEARXNG_URL = `http://127.0.0.1:${serveurSx.address().port}`;
    sx.mode = "ok";
    const r = await chercherWeb({ requete: "seuil micro-entreprise 2026" });
    assert.equal(r.backend, "searxng");
    assert.equal(r.resultats.length, 2);
    assert.match(sx.requetes.at(-1), /^\/search\?q=seuil\+micro-entreprise\+2026&format=json/);
    sx.mode = "403";
    await assert.rejects(chercherWeb({ requete: "x" }), /search\.formats/);
    process.env.REMY_SEARXNG_URL = "http://127.0.0.1:9";
    await assert.rejects(chercherWeb({ requete: "x" }), /SearXNG injoignable/);
    process.env.REMY_RECHERCHE = "bing";
    await assert.rejects(chercherWeb({ requete: "x" }), /Moteur de recherche inconnu/);
    process.env.REMY_RECHERCHE = "off";
    await assert.rejects(chercherWeb({ requete: "x" }), /coupée sur la tour/);
  } finally {
    delete process.env.REMY_RECHERCHE;
    delete process.env.REMY_SEARXNG_URL;
  }
});

// --- Lire une page -------------------------------------------------------------------------

test("lire_page : texte principal (sans scripts, menus ni pied de page), titre, date de mise à jour", async () => {
  const p = await lirePage({ url: `${internet}/seuils` });
  assert.equal(p.titre, "Micro-entrepreneur : les seuils de chiffre d'affaires | Urssaf");
  assert.equal(p.date, "mise à jour le 12 janvier 2026");
  assert.match(p.texte, /77 ?\s?700/);
  assert.match(p.texte, /- 188/);
  assert.match(p.texte, /^Prestations de services \| 77\u00a0?\s?700 € \| 72\u00a0?\s?600 €$/m, "une ligne de tableau reste une ligne");
  for (const intrus of ["NE PAS LIRE", "MENU-PRINCIPAL", "PIED-DE-PAGE", "color: red"]) assert.ok(!p.texte.includes(intrus), intrus);
  const latin = await lirePage({ url: `${internet}/latin1` });
  assert.match(latin.texte, /Prélèvement à la source/, "jeu de caractères de la page respecté");
  assert.equal(latin.date, "publiée le 3 mars 2025");
});

test("lire_page : même garde anti-SSRF que le navigateur, et des refus clairs", async () => {
  secretVu = 0;
  await assert.rejects(lirePage({ url: urlPrivee }), /privée/);
  await assert.rejects(lirePage({ url: `${internet}/vers-prive` }), /privée/, "une redirection vers le réseau privé est refusée");
  await assert.rejects(lirePage({ url: "http://localhost:3010/api/health" }), /privée/);
  await assert.rejects(lirePage({ url: "http://10.0.0.5/" }), /privée/);
  await assert.rejects(lirePage({ url: "file:///etc/passwd" }), /http/);
  await assert.rejects(lirePage({ url: "pas une adresse" }), /URL http\(s\) complète attendue/);
  await assert.rejects(lirePage({ url: urlPrivee.replace("http://", "") }), /privée/, "sans schéma : https:// ajouté, puis la même garde");
  assert.equal(secretVu, 0, "le réseau privé n'a jamais été touché");
  await assert.rejects(lirePage({ url: `${internet}/notice.pdf` }), /PDF/);
  await assert.rejects(lirePage({ url: `${internet}/absente` }), /répond 404/);
});

test("date d'une page : métadonnées, « vérifié le » dans le texte, publication", () => {
  assert.equal(dateDePage('<meta property="article:modified_time" content="2026-02-03T10:00:00+01:00">'), "mise à jour le 3 février 2026");
  assert.equal(dateDePage("<p>x</p>", "Vérifié le 01/02/2026 - Direction de l'information légale"), "vérifiée le 1er février 2026");
  assert.equal(dateDePage('<script type="application/ld+json">{"datePublished":"2025-11-30"}</script>'), "publiée le 30 novembre 2025");
  assert.equal(dateDePage("<p>rien</p>", "Aucune date ici, 2026 non plus."), null);
  assert.equal(extraireTexte("<body><nav>MENU</nav><p>Bonjour</p></body>"), "Bonjour");
});

// --- Fiabilité sans IA -----------------------------------------------------------------------

test("chiffres à vérifier : formats français, rien de la question, rien des liens", () => {
  const lus = ["Le plafond est de 77 700 € et le taux de 12,5 %. Plafond annuel : 1 000,50 €. Mis à jour le 12 janvier 2026."];
  const reponse =
    "Le plafond est de 77 700 € (taux 12,5 %), soit 1 000,50 € par an. Ton budget de 3 000 € tient. " +
    "Le taux réduit est de 34 % et l'aide de 1 250 € par mois depuis 2024. Source : https://www.urssaf.fr/2031/page (2026).";
  const douteux = chiffresAVerifier(reponse, lus, "Avec 3 000 € de budget, ça tient en 2026 ?");
  assert.deepEqual(douteux, ["1 250 €", "34 %", "2024"]);
  assert.equal(ligneAVerifier(douteux), "_À vérifier (absent des pages lues) : 1 250 €, 34 %, 2024._");
  // Écritures équivalentes : 1 000 € = 1000 € = 1.000 € ; 12,5 % = 12.5% ; 77,7 k€ = 77 700 €.
  assert.deepEqual(chiffresAVerifier("1000 €, 1.000 €, 12.5%, 77,7 k€", ["1 000 € ; 12,5 % ; 77 700 €"]), []);
  // « en 2025 300 € » : une année puis un montant, pas 2 025 300 €.
  assert.deepEqual(chiffresAVerifier("En 2025 300 € de plus.", ["rien"]), ["300 €", "2025"]);
  assert.deepEqual(chiffresAVerifier("Fin 2026, 15 %.", ["2026 et 15 %"]), [], "la ponctuation ne colle pas au nombre");
  assert.deepEqual(chiffresAVerifier("50 € et 2026", []), [], "rien lu ce tour-ci : rien à vérifier");
  assert.equal(ligneAVerifier([]), "");
});

// --- Les outils dans la boucle ---------------------------------------------------------------

test("outils : chercher_web et lire_page seulement si la recherche locale est permise, jamais sans navigateur (privé)", async () => {
  const noms = (o) => _outilsClient(false, o).map((t) => t.name);
  assert.ok(noms({ recherche: true }).includes("chercher_web"));
  assert.ok(noms({ recherche: true }).includes("lire_page"));
  assert.equal(noms({}).includes("chercher_web"), false, "Claude et la recherche coupée : pas d'outil local");
  assert.equal(noms({ recherche: true, navigateur: false }).includes("chercher_web"), false, "conversation privée");
  process.env.REMY_RECHERCHE = "off";
  try {
    assert.equal(noms({ recherche: true }).includes("chercher_web"), false);
  } finally {
    delete process.env.REMY_RECHERCHE;
  }
  // Budget par message.
  process.env.REMY_RECHERCHE_MAX = "1";
  try {
    const r = await _executerOutil("chercher_web", { requete: "x" }, null, { recherche: 1, lus: [] });
    assert.match(r.erreur, /Budget de recherche atteint \(1 par message\)/);
  } finally {
    delete process.env.REMY_RECHERCHE_MAX;
  }
});

const QUESTION = "Mon CA visé est de 50 000 € en 2026 : quel est le seuil de la micro-entreprise pour les services ?";

test("boucle d'outils : le modèle local cherche, lit, répond — sans carte ni Claude ; un chiffre inventé est signalé", async () => {
  _oublierBlocage();
  ddg.mode = "ok";
  claude.length = 0;
  glm.flux = [];
  glm.script = [
    appel("c1", "chercher_web", { requete: "seuil micro-entreprise 2026 urssaf" }),
    appel("c2", "lire_page", { url: `${internet}/seuils` }),
    texte(
      "En 2026, le seuil est de 77 700 € pour les services : ton objectif de 50 000 € passe. " +
        "Le taux de cotisation est de 24,6 %.\n\nSource : Urssaf, mise à jour le 12 janvier 2026.",
    ),
  ];
  const id = await nouveauFil();
  const ev = await flux(`/api/conversations/${id}/messages`, { text: QUESTION });
  assert.ok(!ev.some((e) => e.nom === "autorisation"), "aucune carte « Tu autorises ? »");
  assert.equal(claude.length, 0, "rien chez Claude");
  const etapes = ev.filter((e) => e.nom === "status").map((e) => e.data);
  assert.ok(etapes.some((e) => e.cle === "web" && e.text === "Rémy cherche « seuil micro-entreprise 2026 urssaf »…"));
  assert.ok(etapes.some((e) => e.cle === "navigateur" && e.text === "Rémy lit 127.0.0.1…"));
  const done = ev.find((e) => e.nom === "done").data;
  assert.equal(done.tier, "web");
  assert.match(done.text, /\n\n_À vérifier \(absent des pages lues\) : 24,6 %\._$/, "seul le chiffre absent des pages lues");

  // Ce que le modèle a reçu : les outils, la consigne, puis les résultats et la page.
  assert.equal(glm.flux.length, 3);
  assert.ok(nomsOutils(glm.flux[0]).includes("chercher_web"));
  assert.ok(nomsOutils(glm.flux[0]).includes("lire_page"));
  assert.match(glm.flux[0].messages[0].content, /# Chercher sur le web/);
  assert.match(glm.flux[0].messages[0].content, /sources officielles d'abord/);
  assert.doesNotMatch(glm.flux[0].messages[0].content, /tu ne peux pas chercher/);
  const outil1 = JSON.parse(glm.flux[1].messages.at(-1).content);
  assert.equal(glm.flux[1].messages.at(-1).role, "tool");
  assert.match(outil1.resultats, /<matiere_externe source="résultats de recherche"/);
  assert.match(outil1.resultats, /https:\/\/www\.urssaf\.fr\/accueil\/independant\/micro-entrepreneur\/seuils\.html/);
  const outil2 = JSON.parse(glm.flux[2].messages.at(-1).content);
  assert.equal(outil2.date, "mise à jour le 12 janvier 2026");
  assert.match(outil2.page, /<matiere_externe source="page web"/);

  // Le panneau des coûts : la recherche, à 0 $, avec son moteur.
  const couts = await store.listCostEntries();
  const r = couts.find((c) => c.kind === "recherche");
  assert.ok(r, "recherche journalisée");
  assert.equal(r.usd, 0);
  assert.equal(r.provider, "duckduckgo");
  assert.equal(r.model, "html.duckduckgo.com");
  assert.match(r.label, /seuil micro-entreprise 2026 urssaf/);

  const conv = await (await json("GET", `/api/conversations/${id}`)).json();
  assert.match(conv.messages.at(-1).content, /À vérifier \(absent des pages lues\) : 24,6 %/);
});

test("moteur en panne : le modèle reçoit une erreur claire, la recherche ratée est journalisée", async () => {
  _oublierBlocage();
  ddg.mode = "anomalie";
  glm.flux = [];
  glm.script = [appel("c1", "chercher_web", { requete: "acre conditions 2026" }), texte("Je n'ai pas pu chercher : réessaie dans quelques minutes.")];
  const id = await nouveauFil();
  const ev = await flux(`/api/conversations/${id}/messages`, { text: "Les conditions de l'ACRE en 2026 ?" });
  const retour = JSON.parse(glm.flux[1].messages.at(-1).content);
  assert.match(retour.erreur, /DuckDuckGo bloque les recherches de la tour/);
  assert.match(ev.find((e) => e.nom === "done").data.text, /pas pu chercher/);
  assert.ok((await store.listCostEntries()).some((c) => c.kind === "recherche" && /\(échec\)/.test(c.label)));
  _oublierBlocage();
  ddg.mode = "ok";
});

test("conversation privée : aucun outil web, et le modèle le sait", async () => {
  glm.flux = [];
  glm.script = [];
  claude.length = 0;
  const id = await nouveauFil({ prive: true });
  const ev = await flux(`/api/conversations/${id}/messages`, { text: "Le seuil de la micro-entreprise en 2026 ?" });
  assert.ok(!ev.some((e) => e.nom === "autorisation"));
  assert.equal(claude.length, 0);
  assert.deepEqual(nomsOutils(glm.flux[0]).filter((n) => ["chercher_web", "lire_page", "browse_page"].includes(n)), []);
  assert.match(glm.flux[0].messages[0].content, /Conversation privée : pas de recherche web/);
  assert.match(glm.flux[0].messages[0].content, /tu ne peux pas chercher d'ici/);
});

test("« Recherche web » coupée dans les réglages : aucun outil web, ni carte, ni Claude", async () => {
  assert.equal((await json("PUT", "/api/reglages", { rechercheWeb: false })).status, 200);
  try {
    glm.flux = [];
    glm.script = [];
    claude.length = 0;
    const id = await nouveauFil();
    const ev = await flux(`/api/conversations/${id}/messages`, { text: "Le seuil de la micro-entreprise en 2026 ?" });
    assert.ok(!ev.some((e) => e.nom === "autorisation"));
    assert.equal(claude.length, 0);
    assert.equal(nomsOutils(glm.flux[0]).includes("chercher_web"), false);
    assert.match(glm.flux[0].messages[0].content, /Recherche web coupée par Sam/);
  } finally {
    await json("PUT", "/api/reglages", { rechercheWeb: true });
  }
});

test("un message ordinaire a aussi les outils : le modèle décide seul de chercher", async () => {
  glm.flux = [];
  glm.script = [];
  const id = await nouveauFil();
  await flux(`/api/conversations/${id}/messages`, { text: "Aide-moi à préparer mon dossier de création" });
  assert.ok(nomsOutils(glm.flux[0]).includes("chercher_web"));
  const r = await (await json("GET", "/api/reglages")).json();
  assert.equal(r.rechercheLocale, "duckduckgo", "l'app peut savoir que la recherche est locale");
  const v = await (await json("GET", "/api/version")).json();
  assert.ok(v.capacites.includes("recherche-locale-v1"));
});
