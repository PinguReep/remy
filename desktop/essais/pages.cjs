// Les pages embarquées de l'app Windows (desktop/ui) dans Chromium, avec un
// faux window.__TAURI__ qui enregistre les invoke et une fausse tour locale :
// premier lancement, adresse invalide, tour injoignable, « Garder quand
// même », Réessayer, Changer l'adresse, Noter de secours ; à 1280 et 420 px.
// Puis le retour d'une page de la tour en panne (?injoignable=502,
// ?retour=502 : pas de nouvel essai immédiat) et le script de contrôle
// injecté par la coquille (src-tauri/src/controle.js) : statut HTTP lu par
// Chromium, page vide, cadres ignorés.
//
//   node desktop/essais/pages.cjs [dossier-des-captures]
//
// Il faut Playwright (require("playwright")) et son Chromium.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const UI = path.resolve(__dirname, "..", "ui");
const SORTIE = path.resolve(process.argv[2] || path.join(require("os").tmpdir(), "remy-bureau-pages"));
fs.mkdirSync(SORTIE, { recursive: true });

function servirUI() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const p = path.join(UI, new URL(req.url, "http://x").pathname);
      if (!p.startsWith(UI) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
      const type = p.endsWith(".html") ? "text/html; charset=utf-8" : p.endsWith(".css") ? "text/css" : "text/javascript";
      res.writeHead(200, { "content-type": type });
      fs.createReadStream(p).pipe(res);
    }).listen(0, "127.0.0.1", () => ok(s));
  });
}
let tourAllumee = false;
function servirTour() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      if (!tourAllumee) { req.socket.destroy(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"api":1,"appMin":null}');
    }).listen(0, "127.0.0.1", () => ok(s));
  });
}

function fauxTauri({ adresse, notes = 0, avertissement = null }) {
  return `
  (() => {
    const journal = [];
    window.__journal = journal;
    const ecouteurs = {};
    window.__emettre = (nom) => (ecouteurs[nom] || []).forEach((f) => f({ payload: null }));
    let adresse = ${JSON.stringify(adresse)};
    let notes = ${notes};
    window.__TAURI__ = {
      core: { invoke: async (cmd, args) => {
        journal.push([cmd, args || null]);
        switch (cmd) {
          case "bureau_adresse_lire": return { adresse, version: "0.1.0", fenetre: "main", raccourciLibelle: "Ctrl+Alt+Espace" };
          case "bureau_adresse_normaliser": {
            const t = (args.adresse || "").trim();
            if (!t || /\\s/.test(t)) throw "Adresse invalide : il faut l'adresse https de la tour.";
            return t.startsWith("http") ? t.replace(/\\/$/, "") : "https://" + t;
          }
          case "bureau_adresse_enregistrer": adresse = args.adresse; return adresse;
          case "bureau_aller_tour": return null;
          case "bureau_note_locale": notes += 1; return { id: "bureau-1", enAttente: notes, avertissement: ${JSON.stringify(avertissement)} };
          case "bureau_notes_locales_compte": return notes;
          case "bureau_noter_fermer": return null;
          default: throw "commande inconnue " + cmd;
        }
      } },
      event: { listen: async (nom, f) => { (ecouteurs[nom] ||= []).push(f); return () => {}; } },
    };
  })();`;
}

const verifs = [];
function verifier(nom, cond) { verifs.push([nom, !!cond]); console.log((cond ? "OK   " : "ÉCHEC") + " " + nom); }
const commandes = (page) => page.evaluate(() => window.__journal.map((j) => j[0]));

(async () => {
  const ui = await servirUI();
  const tour = await servirTour();
  const baseUI = `http://127.0.0.1:${ui.address().port}`;
  const adresseTour = `http://127.0.0.1:${tour.address().port}`;
  const navigateur = await chromium.launch();

  for (const [l, h] of [[1280, 800], [420, 560]]) {
    // 1. Premier lancement : adresse vide, invalide, injoignable, puis gardée quand même.
    tourAllumee = false;
    let ctx = await navigateur.newContext({ viewport: { width: l, height: h } });
    await ctx.addInitScript(fauxTauri({ adresse: null }));
    let page = await ctx.newPage();
    const erreursJS = [];
    page.on("pageerror", (e) => erreursJS.push(e.message));
    await page.goto(`${baseUI}/demarrage.html`);
    await page.waitForSelector("#vue-adresse:not([hidden])");
    verifier(`${l}px premier lancement : formulaire d'adresse`, await page.isVisible("#champ-adresse"));
    verifier(`${l}px champ focalisé`, await page.evaluate(() => document.activeElement.id === "champ-adresse"));
    await page.screenshot({ path: path.join(SORTIE, `demarrage-premier-${l}.png`) });
    await page.fill("#champ-adresse", "pas une adresse");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#adresse-message.erreur");
    verifier(`${l}px adresse invalide : message d'erreur`, (await page.textContent("#adresse-message")).includes("Adresse invalide"));
    await page.fill("#champ-adresse", adresseTour);
    await page.click("#bouton-continuer");
    await page.waitForSelector("#bouton-garder:not([hidden])", { timeout: 8000 });
    verifier(`${l}px tour injoignable : « Pas de réponse » + Garder quand même`, (await page.textContent("#adresse-message")).includes("Pas de réponse"));
    await page.screenshot({ path: path.join(SORTIE, `demarrage-injoignable-${l}.png`) });
    await page.click("#bouton-garder");
    await page.waitForSelector("#vue-hors-ligne:not([hidden])");
    verifier(`${l}px gardée quand même : écran hors ligne avec l'adresse`, (await page.textContent("#hors-ligne-adresse")) === adresseTour);
    verifier(`${l}px compte à rebours affiché`, /dans \d+ s/.test(await page.textContent("#reessai-message")));
    await page.screenshot({ path: path.join(SORTIE, `demarrage-hors-ligne-${l}.png`) });
    // La tour revient : Réessayer → la fenêtre part sur la tour.
    tourAllumee = true;
    await page.click("#bouton-reessayer");
    await page.waitForFunction(() => window.__journal.some((j) => j[0] === "bureau_aller_tour"));
    verifier(`${l}px Réessayer, tour revenue → bureau_aller_tour`, true);
    verifier(`${l}px enregistrée avant de partir`, (await commandes(page)).includes("bureau_adresse_enregistrer"));
    // Cibles ≥ 44 px.
    const petites = await page.evaluate(() => [...document.querySelectorAll("button, input")]
      .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.id));
    verifier(`${l}px cibles ≥ 44 px (${petites.join(",") || "toutes"})`, petites.length === 0);
    const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    verifier(`${l}px pas de défilement horizontal`, !deborde);
    verifier(`${l}px aucune erreur JS`, erreursJS.length === 0);
    await ctx.close();

    // 2. Adresse connue, tour allumée : départ direct.
    ctx = await navigateur.newContext({ viewport: { width: l, height: h } });
    await ctx.addInitScript(fauxTauri({ adresse: adresseTour }));
    page = await ctx.newPage();
    await page.goto(`${baseUI}/demarrage.html`);
    await page.waitForFunction(() => window.__journal.some((j) => j[0] === "bureau_aller_tour"));
    verifier(`${l}px adresse connue, tour allumée → part sur la tour`, true);
    await ctx.close();

    // 3. Changer l'adresse : préremplie, Annuler / Échap reviennent.
    ctx = await navigateur.newContext({ viewport: { width: l, height: h } });
    await ctx.addInitScript(fauxTauri({ adresse: "https://ma-tour.mon-tailnet.ts.net:8444" }));
    page = await ctx.newPage();
    await page.goto(`${baseUI}/demarrage.html?changer=1`);
    await page.waitForSelector("#vue-adresse:not([hidden])");
    verifier(`${l}px changer : préremplie`, (await page.inputValue("#champ-adresse")) === "ma-tour.mon-tailnet.ts.net:8444");
    verifier(`${l}px changer : Annuler visible`, await page.isVisible("#bouton-annuler"));
    await page.screenshot({ path: path.join(SORTIE, `demarrage-changer-${l}.png`) });
    await page.keyboard.press("Escape");
    await page.waitForSelector("#vue-connexion:not([hidden]), #vue-hors-ligne:not([hidden])");
    verifier(`${l}px Échap annule le changement`, true);
    await page.screenshot({ path: path.join(SORTIE, `demarrage-connexion-${l}.png`) });
    await ctx.close();
  }

  // 4. Noter de secours (560 × 300).
  tourAllumee = false;
  let ctx = await navigateur.newContext({ viewport: { width: 560, height: 300 } });
  await ctx.addInitScript(fauxTauri({ adresse: adresseTour, notes: 1 }));
  let page = await ctx.newPage();
  const erreursJS = [];
  page.on("pageerror", (e) => erreursJS.push(e.message));
  await page.goto(`${baseUI}/noter.html`);
  await page.waitForFunction(() => window.__journal.some((j) => j[0] === "bureau_notes_locales_compte"));
  await page.evaluate(() => window.__emettre("bureau://noter-ouvert"));
  verifier("Noter : champ focalisé à l'ouverture", await page.evaluate(() => document.activeElement.id === "champ"));
  verifier("Noter : 1 en attente affiché", (await page.textContent("#etat")).includes("1 en attente"));
  await page.screenshot({ path: path.join(SORTIE, "noter-vide.png") });
  await page.keyboard.press("Enter");
  verifier("Noter : vide → « Écris d'abord »", (await page.textContent("#message")).includes("Écris d'abord"));
  await page.keyboard.type("Rappeler Léa demain 9h pour le devis des bougies");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("(et les mèches)");
  verifier("Noter : Maj+Entrée = nouvelle ligne", (await page.inputValue("#champ")).includes("\n"));
  await page.keyboard.press("Enter");
  await page.waitForSelector("#message.succes");
  verifier("Noter : gardée, 2 en attente", (await page.textContent("#message")).includes("2 en attente"));
  const envoi = await page.evaluate(() => window.__journal.find((j) => j[0] === "bureau_note_locale"));
  verifier("Noter : texte transmis tel quel", envoi && envoi[1].texte === "Rappeler Léa demain 9h pour le devis des bougies\n(et les mèches)");
  await page.screenshot({ path: path.join(SORTIE, "noter-gardee.png") });
  await page.waitForFunction(() => window.__journal.some((j) => j[0] === "bureau_noter_fermer"), null, { timeout: 4000 });
  verifier("Noter : se ferme après la confirmation", true);
  verifier("Noter : champ vidé", (await page.inputValue("#champ")) === "");
  await page.evaluate(() => window.__emettre("bureau://noter-ouvert"));
  await page.keyboard.press("Escape");
  const fermetures = (await commandes(page)).filter((c) => c === "bureau_noter_fermer").length;
  verifier("Noter : Échap ferme", fermetures >= 2);
  // Cachée, champ vide, tour revenue : passe sur le site.
  tourAllumee = true;
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForFunction(() => window.__journal.some((j) => j[0] === "bureau_aller_tour"), null, { timeout: 5000 });
  verifier("Noter : cachée et tour revenue → passe sur le site", true);
  verifier("Noter : aucune erreur JS", erreursJS.length === 0);
  await ctx.close();

  // 5. Revenue de la tour en panne : message clair, pas d'aller-retour immédiat.
  for (const [l, h] of [[1280, 800], [420, 560]]) {
    tourAllumee = true;
    ctx = await navigateur.newContext({ viewport: { width: l, height: h } });
    await ctx.addInitScript(fauxTauri({ adresse: adresseTour }));
    page = await ctx.newPage();
    const erreurs = [];
    page.on("pageerror", (e) => erreurs.push(e.message));
    await page.goto(`${baseUI}/demarrage.html?injoignable=502`);
    await page.waitForSelector("#vue-hors-ligne:not([hidden])");
    verifier(`${l}px 502 : « Rémy ne répond pas encore »`, (await page.textContent("#hors-ligne-titre")) === "Rémy ne répond pas encore");
    verifier(`${l}px 502 : l'erreur et quoi faire`, /erreur 502.*relance la tâche « Rémy »/.test(await page.textContent("#hors-ligne-explication")));
    verifier(`${l}px 502 : compte à rebours`, /dans \d+ s/.test(await page.textContent("#reessai-message")));
    await page.waitForTimeout(1500);
    verifier(`${l}px 502 : pas de nouvel essai immédiat (pas de boucle)`, !(await commandes(page)).includes("bureau_aller_tour"));
    await page.screenshot({ path: path.join(SORTIE, `demarrage-502-${l}.png`) });
    await page.click("#bouton-reessayer");
    await page.waitForFunction(() => window.__journal.some((j) => j[0] === "bureau_aller_tour"));
    verifier(`${l}px 502 : Réessayer → bureau_aller_tour`, true);
    await page.goto(`${baseUI}/demarrage.html?injoignable=muette`);
    await page.waitForSelector("#vue-hors-ligne:not([hidden])");
    verifier(`${l}px page muette : son propre message`, (await page.textContent("#hors-ligne-titre")).includes("ne s'est pas chargée"));
    // Puis la tour coupée pour de bon : retour au message « hors ligne ».
    tourAllumee = false;
    await page.click("#bouton-reessayer");
    await page.waitForFunction(() => /toujours pas de réponse/.test(document.getElementById("reessai-message").textContent), null, { timeout: 8000 });
    verifier(`${l}px puis tour coupée : « La tour ne répond pas »`, (await page.textContent("#hors-ligne-titre")) === "La tour ne répond pas");
    verifier(`${l}px 502 : aucune erreur JS`, erreurs.length === 0);
    await ctx.close();
  }
  tourAllumee = true;
  ctx = await navigateur.newContext({ viewport: { width: 560, height: 300 } });
  await ctx.addInitScript(fauxTauri({ adresse: adresseTour }));
  page = await ctx.newPage();
  await page.goto(`${baseUI}/noter.html?retour=502`);
  await page.waitForFunction(() => window.__journal.some((j) => j[0] === "bureau_notes_locales_compte"));
  await page.waitForTimeout(1500);
  verifier("Noter ?retour=502 : pas de nouvel essai immédiat", !(await commandes(page)).includes("bureau_aller_tour"));
  verifier("Noter ?retour=502 : « Rémy ne répond pas »", (await page.textContent("#etat")).startsWith("Rémy ne répond pas"));
  await ctx.close();

  // Notes d'avant illisibles (fichier mis de côté) : Noter le dit.
  ctx = await navigateur.newContext({ viewport: { width: 560, height: 300 } });
  await ctx.addInitScript(fauxTauri({ adresse: adresseTour, avertissement: "Les notes gardées avant n'ont pas pu être relues : fichier mis de côté (notes-en-attente.illisible)." }));
  page = await ctx.newPage();
  await page.goto(`${baseUI}/noter.html?retour=502`);
  await page.waitForFunction(() => window.__journal.some((j) => j[0] === "bureau_notes_locales_compte"));
  await page.fill("#champ", "Note du jour");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#message.erreur");
  verifier("Noter : notes d'avant illisibles → le message le dit", (await page.textContent("#message")).includes("mis de côté"));
  await page.screenshot({ path: path.join(SORTIE, "noter-illisible.png") });
  await ctx.close();

  // 6. Le script de contrôle de la coquille, dans Chromium (comme WebView2).
  const controle = fs.readFileSync(path.resolve(__dirname, "..", "src-tauri", "src", "controle.js"), "utf8");
  const tourControle = await new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x").pathname;
      if (u === "/panne") { res.writeHead(502, { "content-type": "text/plain" }); return res.end("Bad Gateway"); }
      if (u === "/vide") { res.writeHead(200, { "content-type": "text/html" }); return res.end(""); }
      if (u === "/cadre") { res.writeHead(200, { "content-type": "text/html" }); return res.end('<p>avec un cadre</p><iframe src="/ok"></iframe>'); }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>Rémy</title><div id=app>R</div>");
    }).listen(0, "127.0.0.1", () => ok(s));
  });
  const baseControle = `http://127.0.0.1:${tourControle.address().port}`;
  ctx = await navigateur.newContext();
  await ctx.addInitScript(() => {
    window.__signaux = [];
    window.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => { window.__signaux.push([cmd, args]); return null; } };
  });
  await ctx.addInitScript(controle);
  page = await ctx.newPage();
  const signaux = async (chemin) => {
    await page.goto(baseControle + chemin);
    await page.waitForLoadState("load");
    await page.waitForTimeout(300);
    return page.evaluate(() => window.__signaux);
  };
  let sx = await signaux("/ok");
  verifier("contrôle : page normale → statut 200, pas vide", sx.length === 1 && sx[0][0] === "bureau_page_chargee" && sx[0][1].statut === 200 && sx[0][1].vide === false);
  sx = await signaux("/panne");
  verifier("contrôle : réponse 502 (même avec un corps) → statut 502", sx.length === 1 && sx[0][1].statut === 502);
  sx = await signaux("/vide");
  verifier("contrôle : page vide signalée vide", sx.length === 1 && sx[0][1].vide === true);
  sx = await signaux("/cadre");
  verifier("contrôle : un seul signal, les cadres sont ignorés", sx.length === 1 && sx[0][1].statut === 200);
  await ctx.close();
  tourControle.close();

  await navigateur.close();
  ui.close(); tour.close();
  const echecs = verifs.filter(([, ok]) => !ok);
  console.log(`\n${verifs.length - echecs.length}/${verifs.length} vérifications`);
  process.exit(echecs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
