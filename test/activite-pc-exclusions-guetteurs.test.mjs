// L'activité du PC (24/10, suite de la revue) : exclure un navigateur emporte ses
// sites, une exclusion posée sur la tour efface aussi le passé, un domaine en
// .app s'exclut ; un guetteur arrêté (seau encore là) se signale, sans fausse
// alerte au réveil de la tour ni après un redémarrage d'ActivityWatch.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

console.log = () => {};
console.warn = () => {};

const MIN = 60_000;
const H = 60 * MIN;
const T0 = Math.floor((Date.now() - 6 * H) / MIN) * MIN;
let n = 0;
const ev = (debut, fin, data) => ({ id: ++n, timestamp: new Date(debut).toISOString(), duration: (fin - debut) / 1000, data });

// Un faux ActivityWatch avec deux navigateurs ; `maj` : la fin du dernier
// événement de chaque guetteur (aw-server : last_updated ; aw-server-rust : metadata.end).
const aw = { eteint: false, rust: false, fenetres: [], absences: [], web: { firefox: [], chrome: [] }, maj: { fenetre: null, afk: null } };
const seau = (id, type, quand) => {
  const fin = quand == null ? undefined : new Date(quand).toISOString();
  return aw.rust ? { id, type, hostname: "tour-essai", metadata: { start: null, end: fin ?? null } } : { id, type, hostname: "tour-essai", last_updated: fin };
};
const serveurAW = http.createServer((req, res) => {
  if (aw.eteint) return req.socket.destroy();
  const u = new URL(req.url, "http://aw");
  const json = (v) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(v));
  };
  if (u.pathname === "/api/0/info") return json({ hostname: "tour-essai", version: "v0.13.2" });
  if (u.pathname === "/api/0/buckets/") {
    return json({
      "aw-watcher-window_tour-essai": seau("aw-watcher-window_tour-essai", "currentwindow", aw.maj.fenetre ?? Date.now()),
      "aw-watcher-afk_tour-essai": seau("aw-watcher-afk_tour-essai", "afkstatus", aw.maj.afk ?? Date.now()),
      "aw-watcher-web-firefox_tour-essai": { id: "aw-watcher-web-firefox_tour-essai", type: "web.tab.current", hostname: "tour-essai" },
      "aw-watcher-web-chrome_tour-essai": { id: "aw-watcher-web-chrome_tour-essai", type: "web.tab.current", hostname: "tour-essai" },
    });
  }
  const m = u.pathname.match(/^\/api\/0\/buckets\/([^/]+)\/events$/);
  if (!m) {
    res.statusCode = 404;
    return res.end("{}");
  }
  const id = decodeURIComponent(m[1]);
  const liste = id.includes("window") ? aw.fenetres : id.includes("afk") ? aw.absences : id.includes("firefox") ? aw.web.firefox : aw.web.chrome;
  const a = Date.parse(u.searchParams.get("start"));
  const b = Date.parse(u.searchParams.get("end"));
  json(liste.filter((e) => Date.parse(e.timestamp) + e.duration * 1000 >= a && Date.parse(e.timestamp) <= b));
});
await new Promise((r) => serveurAW.listen(0, "127.0.0.1", r));

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "remy-activite-pc-2-"));
for (const v of ["REMY_VAULT", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "REMY_ACTIVITE_PC", "REMY_ACTIVITE_PC_JOURS", "REMY_ACTIVITE_EXCLURE", "REMY_ACTIVITE_CATEGORIES"]) delete process.env[v];
process.env.REMY_DATA_DIR = dossier;
process.env.REMY_ACTIVITYWATCH_URL = `http://127.0.0.1:${serveurAW.address().port}`;
// La journée d'essai doit tomber « aujourd'hui » : un fuseau où il est 14 h.
{
  const h = ((14 - new Date().getUTCHours() + 36) % 24) - 12;
  process.env.REMY_TZ = h === 0 ? "Etc/UTC" : `Etc/GMT${h > 0 ? "-" : "+"}${Math.abs(h)}`;
}

const pc = await import("../lib/activite-pc.js");
const { db, fermer } = await import("../lib/db.js");
test.after(() => {
  serveurAW.close();
  fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});
const lignes = () =>
  db()
    .prepare("SELECT type, nom, secondes FROM activite_pc ORDER BY type, nom")
    .all()
    .map((l) => `${l.type}:${l.nom}=${l.secondes}`);
const etat = () => pc.vue().activitywatch;
// Le relevé d'avant, tel que la tour l'a noté (pour simuler une veille).
const releveAvant = (essai) => {
  const e = JSON.parse(db().prepare("SELECT valeur FROM meta WHERE cle = 'activite_pc_etat'").get().valeur);
  db().prepare("UPDATE meta SET valeur = ? WHERE cle = 'activite_pc_etat'").run(JSON.stringify({ ...e, joignable: true, essai }));
};

test("le navigateur d'un seau web : firefox, chrome, Edge → msedge", () => {
  assert.equal(pc.navigateurDuSeau("aw-watcher-web-firefox_tour-essai"), "firefox");
  assert.equal(pc.navigateurDuSeau("aw-watcher-web-chrome"), "chrome");
  assert.equal(pc.navigateurDuSeau("aw-watcher-web-edge_tour"), "msedge");
  assert.equal(pc.navigateurDuSeau("aw-watcher-window_tour"), null);
  assert.equal(pc.cleAppli("Agenda.app"), "agenda.app", "un domaine en .app reste un domaine");
  assert.equal(pc.cleAppli("Code.EXE"), "code");
});

test("exclure Firefox efface tous les sites ; ses onglets en arrière-plan ne reviennent pas", async () => {
  // Firefox (perso) puis Chrome (travail) ; l'onglet de Firefox change pendant que Chrome est devant.
  aw.absences = [ev(T0, T0 + 5 * H, { status: "not-afk" })];
  aw.fenetres = [ev(T0, T0 + H, { app: "firefox.exe" }), ev(T0 + H, T0 + 2 * H, { app: "chrome.exe" }), ev(T0 + 2 * H, T0 + 3 * H, { app: "Code.exe" })];
  aw.web.firefox = [ev(T0, T0 + 70 * MIN, { url: "https://perso.example/a" }), ev(T0 + 70 * MIN, T0 + 2 * H, { url: "https://perso2.example/b" })];
  aw.web.chrome = [ev(T0 + 60 * MIN, T0 + 2 * H, { url: "https://travail.example/c" })];
  pc.regler({ actif: true }, T0);
  await pc.collecter({ maintenant: T0 + 3 * H });
  assert.ok(lignes().some((l) => l.startsWith("domaine:perso.example")), lignes().join(" "));
  const v = pc.regler({ exclusions: ["Firefox"] });
  assert.deepEqual(v.exclusions, ["firefox"]);
  assert.ok(!lignes().some((l) => l.startsWith("domaine:")), `tous les sites effacés : ${lignes().join(" ")}`);
  assert.ok(!lignes().some((l) => l.startsWith("app:firefox")));
  assert.ok(lignes().some((l) => l.startsWith("app:chrome")), "Chrome garde son temps");
  assert.deepEqual(v.semaine.domaines, []);
  // La suite : Chrome devant, Firefox derrière, son extension écrit encore.
  aw.fenetres.push(ev(T0 + 3 * H, T0 + 4 * H, { app: "chrome.exe" }));
  aw.web.firefox.push(ev(T0 + 3 * H + 30 * MIN, T0 + 4 * H, { url: "https://perso3.example/" }));
  aw.web.chrome.push(ev(T0 + 3 * H, T0 + 4 * H, { url: "https://travail.example/d" }));
  await pc.collecter({ maintenant: T0 + 4 * H + 6 * MIN });
  assert.ok(!lignes().some((l) => l.includes("perso")), `aucun site de Firefox ne revient : ${lignes().join(" ")}`);
  assert.ok(lignes().includes(`domaine:travail.example=${H / 1000}`), "Chrome devant toute l'heure : travail.example en entier");
});

test("un domaine en .app s'exclut, et ce qui était compté s'efface", async () => {
  aw.fenetres.push(ev(T0 + 4 * H, T0 + 4 * H + 30 * MIN, { app: "chrome.exe" }));
  aw.web.chrome.push(ev(T0 + 4 * H, T0 + 4 * H + 30 * MIN, { url: "https://www.agenda.app/semaine" }));
  await pc.collecter({ maintenant: T0 + 4 * H + 36 * MIN });
  assert.ok(lignes().some((l) => l.startsWith("domaine:agenda.app=")), lignes().join(" "));
  const v = pc.regler({ exclusions: ["firefox", "Agenda.app"] });
  assert.deepEqual(v.exclusions, ["firefox", "agenda.app"]);
  assert.ok(!lignes().some((l) => l.includes("agenda")), lignes().join(" "));
  assert.ok(lignes().some((l) => l.startsWith("domaine:travail.example")), "les autres sites restent (agenda.app n'est pas un navigateur)");
  // Revenu devant Sam : toujours pas compté.
  aw.fenetres.push(ev(T0 + 4 * H + 30 * MIN, T0 + 5 * H, { app: "chrome.exe" }));
  aw.web.chrome.push(ev(T0 + 4 * H + 30 * MIN, T0 + 5 * H, { url: "https://agenda.app/jour" }));
  await pc.collecter({ maintenant: T0 + 5 * H + 6 * MIN });
  assert.ok(!lignes().some((l) => l.includes("agenda")), lignes().join(" "));
});

test("une exclusion posée sur la tour efface aussi le passé, une seule fois pour les sites", async () => {
  process.env.REMY_ACTIVITE_EXCLURE = "code.exe";
  try {
    await pc.collecter({ maintenant: T0 + 5 * H + 7 * MIN });
    assert.ok(!lignes().some((l) => l.startsWith("app:code")), lignes().join(" "));
  } finally {
    delete process.env.REMY_ACTIVITE_EXCLURE;
  }
  assert.equal(pc.vue().aujourdhui.applis.some((a) => a.nom === "code"), false, "ne revient pas quand on retire la variable");
  // Un navigateur exclu sur la tour emporte les sites, une fois : ceux de
  // Chrome relevés ensuite restent.
  process.env.REMY_ACTIVITE_EXCLURE = "keepass,firefox";
  try {
    pc.regler({ exclusions: [] });
    await pc.collecter({ maintenant: T0 + 5 * H + 8 * MIN });
    assert.ok(!lignes().some((l) => l.startsWith("domaine:")), lignes().join(" "));
    aw.absences.push(ev(T0 + 5 * H, T0 + 6 * H, { status: "not-afk" }));
    aw.fenetres.push(ev(T0 + 5 * H, T0 + 6 * H, { app: "chrome.exe" }));
    aw.web.chrome.push(ev(T0 + 5 * H, T0 + 6 * H, { url: "https://travail.example/e" }));
    await pc.collecter({ maintenant: T0 + 5 * H + 40 * MIN });
    await pc.collecter({ maintenant: T0 + 5 * H + 41 * MIN });
    assert.ok(lignes().some((l) => l.startsWith("domaine:travail.example")), `les sites de Chrome restent : ${lignes().join(" ")}`);
  } finally {
    delete process.env.REMY_ACTIVITE_EXCLURE;
  }
});

test("guetteurs frais : aucune alerte (aw-server, puis aw-server-rust)", async () => {
  await pc.collecter();
  await pc.collecter();
  assert.equal(etat().message, null);
  assert.equal(etat().fenetre, true);
  assert.equal(etat().afk, true);
  aw.rust = true;
  try {
    await pc.collecter();
    assert.equal(etat().message, null, "aw-server-rust : metadata.end");
  } finally {
    aw.rust = false;
  }
});

test("guetteur arrêté, seau encore là : pas d'alerte au réveil, alerte au relevé suivant, levée à la relance", async () => {
  // La tour s'est endormie juste après un relevé, il y a 8 h ; les guetteurs
  // ont écrit jusqu'à la veille, et pas encore depuis le réveil.
  const veille = Date.now() - 8 * H;
  releveAvant(veille - 2 * MIN);
  aw.maj = { fenetre: veille, afk: veille };
  await pc.collecter();
  assert.equal(etat().message, null, "pas de fausse alerte au réveil");
  // aw-watcher-window est vraiment arrêté : au relevé suivant, l'alerte, avec quoi faire.
  aw.maj = { fenetre: veille, afk: Date.now() };
  await pc.collecter();
  assert.match(etat().message, /^aw-watcher-window n'écrit plus depuis (le .* à )?\d\d:\d\d : rien n'est compté\. Relance aw-qt sur la tour\.$/);
  assert.equal(etat().fenetre, false);
  assert.equal(etat().afk, true);
  // Relancé : l'alerte s'en va.
  aw.maj = { fenetre: null, afk: null };
  await pc.collecter();
  assert.equal(etat().message, null);
  assert.equal(etat().fenetre, true);
  // Même chose pour aw-watcher-afk.
  aw.maj = { fenetre: null, afk: Date.now() - H };
  await pc.collecter();
  assert.match(etat().message, /^aw-watcher-afk n'écrit plus depuis/);
  assert.equal(etat().afk, false);
  aw.maj = { fenetre: null, afk: null };
  await pc.collecter();
  assert.equal(etat().message, null);
});

test("écran verrouillé, Sam absent : aw-watcher-window se tait sans alerte ; Sam revenu, l'alerte", async () => {
  const verrou = Date.now() - H;
  aw.absences.push(ev(verrou, Date.now(), { status: "afk" }));
  const absences = aw.absences;
  // Ce qu'aw-watcher-afk a vu depuis : absent, rien d'autre.
  aw.absences = [ev(verrou, Date.now(), { status: "afk" })];
  aw.maj = { fenetre: verrou, afk: null };
  await pc.collecter();
  await pc.collecter();
  assert.equal(etat().message, null, "absent : le silence de la fenêtre s'explique");
  assert.equal(etat().fenetre, true);
  // Revenu depuis 5 min, et la fenêtre se tait toujours : arrêtée.
  aw.absences = [ev(verrou, Date.now() - 5 * MIN, { status: "afk" }), ev(Date.now() - 5 * MIN, Date.now(), { status: "not-afk" })];
  await pc.collecter();
  assert.match(etat().message, /^aw-watcher-window n'écrit plus depuis/);
  assert.equal(etat().fenetre, false);
  aw.absences = absences;
  aw.maj = { fenetre: null, afk: null };
  await pc.collecter();
  assert.equal(etat().message, null);
});

test("ActivityWatch redémarré (injoignable au relevé d'avant) : pas d'alerte au premier relevé", async () => {
  aw.eteint = true;
  await pc.collecter();
  assert.equal(etat().joignable, false);
  aw.eteint = false;
  // Pas encore réécrit depuis le redémarrage.
  aw.maj = { fenetre: Date.now() - 2 * H, afk: Date.now() - 2 * H };
  await pc.collecter();
  assert.equal(etat().joignable, true);
  assert.equal(etat().message, null);
  aw.maj = { fenetre: null, afk: null };
});
