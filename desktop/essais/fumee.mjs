// Essai de fumée de la coquille, sous Linux (Xvfb + WebKitGTK) : le vrai
// binaire, une fausse tour locale, aucune donnée réelle.
//
//   node desktop/essais/fumee.mjs desktop/src-tauri/target/debug/remy-bureau
//
// Vérifie de bout en bout ce que les tests unitaires ne voient pas : la page
// de démarrage sonde la tour puis la fenêtre y part ; le site reçoit
// window.__TAURI__ ; les commandes du contrat répondent ; celles des pages
// embarquées et celles hors contrat sont refusées à la tour ; les notes de
// secours se lisent puis s'effacent ; la fenêtre Noter passe sur le site ;
// une navigation ou un window.open vers une autre origine n'ouvre rien dans
// l'app. Avant tout ça, la tour est « en panne » comme à l'ouverture de
// session (Tailscale Serve répond 502 tant que Rémy ne tourne pas) : la
// fenêtre principale doit revenir sur sa page embarquée et réessayer seule,
// puis, sur une page qui ne se charge jamais, le garde-fou de 20 s doit l'y
// ramener aussi ; Noter revient sur sa page de secours sans boucler.
// Compter ~1 min 30. Il faut xvfb-run et dbus-run-session.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const binaire = path.resolve(process.argv[2] || "desktop/src-tauri/target/debug/remy-bureau");
const DELAI_MS = Number(process.env.FUMEE_DELAI_MS || 180_000);

const resultats = [];
const autreOrigine = [];

const page = `<!doctype html><meta charset="utf-8"><title>Fausse tour</title><body>fausse tour<script>
(async () => {
  const fenetre = new URLSearchParams(location.search).get("fenetre") || "main";
  const r = { fenetre, tauri: !!window.__TAURI__ };
  const essai = async (nom, cmd, args) => {
    try { r[nom] = { ok: true, valeur: await window.__TAURI__.core.invoke(cmd, args) }; }
    catch (e) { r[nom] = { ok: false, erreur: String(e) }; }
  };
  if (window.__TAURI__) {
    await essai("etat", "bureau_etat");
    await essai("adresse_lire", "bureau_adresse_lire");
    await essai("adresse_enregistrer", "bureau_adresse_enregistrer", { adresse: "https://autre.exemple.ts.net" });
    await essai("note_locale", "bureau_note_locale", { texte: "x" });
    await essai("lien_fichier", "bureau_ouvrir_lien", { url: "file:///etc/passwd" });
    await essai("hors_contrat", "plugin:window|close");
    await essai("raccourci_invalide", "bureau_regler", { raccourci: "N" });
    if (fenetre === "main") {
      await essai("notes", "bureau_notes_attente");
      await essai("fermer_quitte", "bureau_regler", { fermerDansZone: false });
      await essai("fermer_range", "bureau_regler", { fermerDansZone: true });
      await essai("notifier", "bureau_notifier", { titre: "Essai", corps: "Rappel fictif", cle: "essai" });
      await essai("notifier_doublon", "bureau_notifier", { titre: "Essai", corps: "Rappel fictif", cle: "essai" });
      if (r.notes.ok) await essai("acquitter", "bureau_notes_acquitter", { ids: r.notes.valeur.map((n) => n.id) });
      await essai("notes_apres", "bureau_notes_attente");
    }
  }
  await fetch("/resultat", { method: "POST", body: JSON.stringify(r) });
  if (fenetre === "main") {
    window.open(AUTRE + "/fenetre");
    setTimeout(() => { location.href = AUTRE + "/navigation"; }, 400);
    setTimeout(() => fetch("/resultat", { method: "POST", body: JSON.stringify({ fenetre: "apres", url: location.href }) }), 2500);
  }
})();
</script>`;

function ecouter(gestion) {
  return new Promise((ok) => {
    const s = http.createServer(gestion).listen(0, "127.0.0.1", () => ok(s));
  });
}

const autre = await ecouter((req, res) => { autreOrigine.push(req.url); res.end("autre"); });
const AUTRE = `http://127.0.0.1:${autre.address().port}`;
// Les pannes servies, dans l'ordre, aux premières pages demandées par chaque
// fenêtre : « 502 » (corps vide, comme Tailscale Serve), « bloque » (jamais de
// réponse). Ensuite, la vraie page.
const pannes = { main: ["502", "bloque"], noter: ["502"] };
const pages = { main: [], noter: [] };
const bloquees = [];
const t0 = Date.now();
const tour = await ecouter((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/version") {
    // Tailscale Serve répond 502 à tout tant que Rémy ne tourne pas.
    if (pannes.main[0] === "502") { res.writeHead(502); return res.end(); }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"api":1,"appMin":null}');
  }
  if (u.pathname === "/" && req.method === "GET") {
    const fenetre = u.searchParams.get("fenetre") === "noter" ? "noter" : "main";
    const panne = pannes[fenetre].shift() || "page";
    pages[fenetre].push({ t: Date.now() - t0, panne });
    if (panne === "502") { res.writeHead(502); return res.end(); }
    if (panne === "bloque") { bloquees.push(res); return; }
  }
  if (u.pathname === "/resultat" && req.method === "POST") {
    let corps = "";
    req.on("data", (c) => (corps += c));
    req.on("end", () => { resultats.push(JSON.parse(corps)); res.writeHead(204); res.end(); });
    return;
  }
  if (u.pathname === "/" && req.method === "GET") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(page.replaceAll("AUTRE +", JSON.stringify(AUTRE) + " +"));
  }
  res.writeHead(404); res.end();
});
const TOUR = `http://127.0.0.1:${tour.address().port}`;

// Un profil neuf : jamais le vrai.
const maison = fs.mkdtempSync(path.join(os.tmpdir(), "remy-fumee-"));
const config = path.join(maison, ".config", "com.pingureep.remy.bureau");
fs.mkdirSync(config, { recursive: true });
fs.writeFileSync(path.join(config, "bureau.json"), JSON.stringify({ adresse: TOUR, premierLancementFait: true, demarrage: false }));
// L'ancien fichier en clair (0.1.0) : la coquille doit le reprendre.
fs.writeFileSync(path.join(config, "notes-en-attente.json"),
  JSON.stringify([{ id: "bureau-1", texte: "Commander des mèches pour les bougies", a: "2026-10-29T08:00:00Z" }]));

const app = spawn("xvfb-run", ["-a", "-s", "-screen 0 1440x900x24", "dbus-run-session", "--", binaire], {
  env: { ...process.env, HOME: maison, XDG_CONFIG_HOME: path.join(maison, ".config"), XDG_DATA_HOME: path.join(maison, ".local/share"), BROWSER: "/bin/true" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let journal = "";
app.stdout.on("data", (d) => (journal += d));
app.stderr.on("data", (d) => (journal += d));

const debut = Date.now();
const trouve = (f) => resultats.find((r) => r.fenetre === f);
while (Date.now() - debut < DELAI_MS && !(trouve("main") && trouve("noter") && trouve("apres"))) {
  await new Promise((r) => setTimeout(r, 500));
}
try { process.kill(-app.pid, "SIGTERM"); } catch { /* déjà fini */ }
for (const r of bloquees) r.destroy();
tour.closeAllConnections?.(); tour.close(); autre.close();
console.log("pages servies (ms depuis le début) :", JSON.stringify(pages));

const verifs = [];
const verifier = (nom, cond) => { verifs.push(!!cond); console.log(`${cond ? "OK   " : "ÉCHEC"} ${nom}`); };
const m = trouve("main") || {};
const n = trouve("noter") || {};
const refusParRegles = (x) => x && !x.ok && /not allowed/.test(x.erreur);

const [p502, pBloquee, pBonne] = pages.main;
verifier("502 : la fenêtre principale est revenue sur sa page et a réessayé seule (~30 s)",
  p502?.panne === "502" && pBloquee && pBloquee.t - p502.t >= 25_000);
verifier("page bloquée : le garde-fou de 20 s l'a ramenée, puis nouvel essai (~50 s)",
  pBloquee?.panne === "bloque" && pBonne && pBonne.t - pBloquee.t >= 45_000);
verifier("Noter : 502, retour sur sa page de secours, sans boucler",
  pages.noter[0]?.panne === "502" && pages.noter.length <= 3);
verifier("la page de démarrage a sondé la tour et la fenêtre y est partie", !!trouve("main"));
verifier("le site reçoit window.__TAURI__", m.tauri === true);
verifier("bureau_etat : adresse et fenêtre", m.etat?.ok && m.etat.valeur.adresse === TOUR && m.etat.valeur.fenetre === "main");
verifier("bureau_etat : raccourci par défaut", m.etat?.valeur?.raccourci === "Ctrl+Alt+Space" && m.etat.valeur.raccourciLibelle === "Ctrl+Alt+Espace");
verifier("commande d'adresse refusée à la tour (règles d'accès)", refusParRegles(m.adresse_lire) && refusParRegles(m.adresse_enregistrer));
verifier("note de secours refusée à la tour (règles d'accès)", refusParRegles(m.note_locale));
verifier("commande hors contrat refusée", m.hors_contrat && !m.hors_contrat.ok);
verifier("lien file:// refusé", m.lien_fichier && !m.lien_fichier.ok && /Lien refusé/.test(m.lien_fichier.erreur));
verifier("raccourci sans modificateur refusé", m.raccourci_invalide && !m.raccourci_invalide.ok && /Raccourci invalide/.test(m.raccourci_invalide.erreur));
verifier("réglage « fermer » appliqué puis rétabli", m.fermer_quitte?.valeur?.fermerDansZone === false && m.fermer_range?.valeur?.fermerDansZone === true);
verifier("notification acceptée, doublon refusé", m.notifier?.ok && m.notifier_doublon && !m.notifier_doublon.ok);
verifier("note de secours lue par le site", m.notes?.ok && m.notes.valeur.length === 1 && m.notes.valeur[0].id === "bureau-1");
verifier("note acquittée : plus rien en attente", m.acquitter?.ok && m.notes_apres?.ok && m.notes_apres.valeur.length === 0);
verifier("fichier des notes effacé (et l'ancien en clair de la 0.1.0 repris puis effacé)",
  !fs.existsSync(path.join(config, "notes-en-attente.json")) && !fs.existsSync(path.join(config, "notes-en-attente.dat")));
const reglages = JSON.parse(fs.readFileSync(path.join(config, "bureau.json"), "utf8"));
verifier("réglages gardés sur disque (adresse inchangée par la tour)", reglages.adresse === TOUR && reglages.fermerDansZone === true);
verifier("Noter est passée de la page de secours au site", n.etat?.ok && n.etat.valeur.fenetre === "noter");
verifier("Noter : mêmes refus que la fenêtre principale", refusParRegles(n.adresse_lire) && refusParRegles(n.note_locale));
verifier("autre origine : ni navigation ni fenêtre dans l'app", autreOrigine.length === 0);
verifier("la fenêtre est restée sur la tour", trouve("apres")?.url?.startsWith(TOUR));

const echecs = verifs.filter((v) => !v).length;
console.log(`\n${verifs.length - echecs}/${verifs.length} vérifications`);
if (echecs) console.log("\n--- journal de l'app (fin)\n" + journal.split("\n").slice(-40).join("\n"));
fs.rmSync(maison, { recursive: true, force: true });
process.exit(echecs ? 1 : 0);
