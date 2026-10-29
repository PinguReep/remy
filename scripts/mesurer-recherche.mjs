// Mesurer la partie de la recherche web qui ne dépend PAS du modèle (29/10) :
// moteurs, pertinence, lectures de pages en série et en parallèle, qualité de
// l'extraction, volume de matière envoyé au modèle. Pour comparer les
// stratégies (lib/recherche-rapide.js) avant de les jouer contre le vrai
// modèle (scripts/banc-recherche.mjs, sur la tour).
//
//   node scripts/mesurer-recherche.mjs                 les 12 questions
//   node scripts/mesurer-recherche.mjs --questions acre,smic --pause 2000
//   node scripts/mesurer-recherche.mjs --json mesures.json
//   node scripts/mesurer-recherche.mjs --points ddg-html --formes question,mots
//
// Ce qui part : les 12 questions (inventées, rien de personnel) vers
// DuckDuckGo (html et lite), puis les pages trouvées. Aucun modèle, aucune
// écriture hors du fichier --json demandé. Une pause entre deux requêtes au
// moteur (2,5 s par défaut) : une rafale déclenche sa vérification anti-robot.

import fs from "node:fs";
import { analyserDuckDuckGo, ENTETES_NAVIGATEUR, lirePage } from "../lib/recherche.js";
import { requeteDepuisMessage, classerResultats, passagesPertinents, rechercheDirecte, matiereDirecte, viderCachesRecherche } from "../lib/recherche-rapide.js";
import { QUESTIONS, hoteDe } from "./recherche-questions.mjs";

const args = process.argv.slice(2);
const val = (nom) => args.flatMap((a, i) => (a === nom ? [args[i + 1]] : [])).filter(Boolean)[0];
const choix = (val("--questions") || "").split(",").map((s) => s.trim()).filter(Boolean);
const PAUSE = Number(val("--pause")) || 2500;
const sortieJson = val("--json");
const points = (val("--points") || "ddg-html,ddg-lite").split(",").map((s) => s.trim()).filter(Boolean);
const formesVoulues = (val("--formes") || "question,mots").split(",").map((s) => s.trim()).filter(Boolean);
const questions = choix.length ? QUESTIONS.filter((q) => choix.includes(q.id)) : QUESTIONS;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const CARS_PAR_JETON = 3.2; // lib/debit.js, rapport de départ (français)
const jetons = (cars) => Math.round(cars / CARS_PAR_JETON);

const POINTS = {
  "ddg-html": "https://html.duckduckgo.com/html/",
  "ddg-lite": "https://lite.duckduckgo.com/lite/",
};
async function interroger(point, requete) {
  const url = POINTS[point];
  const t = performance.now();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { ...ENTETES_NAVIGATEUR, "Content-Type": "application/x-www-form-urlencoded", Referer: new URL(url).origin + "/" },
      body: new URLSearchParams({ q: requete, kl: "fr-fr" }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const html = await r.text();
    const ms = Math.round(performance.now() - t);
    if (r.status === 202 || /anomaly-modal|challenge-form/i.test(html)) return { ms, statut: "bloqué" };
    if (!r.ok) return { ms, statut: `réponse ${r.status}` };
    return { ms, statut: "ok", resultats: analyserDuckDuckGo(html) };
  } catch (err) {
    return { ms: Math.round(performance.now() - t), statut: err.name === "TimeoutError" ? "délai" : err.message };
  }
}

const rangRef = (liste, q) => {
  const i = liste.findIndex((x) => q.references.test(hoteDe(x.url)));
  return i === -1 ? null : i + 1;
};
const q50 = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};
const q90 = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.ceil(v.length * 0.9) - 1)] : null;
};

const rapport = { date: new Date().toISOString(), moteurs: [], lectures: [], extraction: [] };
const premiers = new Map(); // id → résultats de ddg-html / question, repris pour les lectures

// --- 1. Moteurs × formes de requête ------------------------------------------------------
console.log("\n## Moteurs (DuckDuckGo html / lite) × forme de la requête\n");
for (const q of questions) {
  const rq = requeteDepuisMessage(q.question);
  const formes = Object.fromEntries(Object.entries({ question: rq.requete, mots: rq.mots.join(" ") }).filter(([f]) => formesVoulues.includes(f)));
  for (const point of points) {
    for (const [forme, requete] of Object.entries(formes)) {
      const r = await interroger(point, requete);
      if (r.resultats && point === "ddg-html" && forme === "question") premiers.set(q.id, r);
      const ligne = { id: q.id, point, forme, requete, ms: r.ms, statut: r.statut };
      if (r.resultats) {
        const classes = classerResultats(r.resultats, rq.mots);
        Object.assign(ligne, {
          n: r.resultats.length,
          refRang: rangRef(r.resultats, q),
          refRangClasse: rangRef(classes, q),
          officielsTop3: classes.slice(0, 3).filter((x) => x.source !== "autre").length,
          top3: r.resultats.slice(0, 3).map((x) => hoteDe(x.url)),
        });
      }
      rapport.moteurs.push(ligne);
      console.log(`${q.id.padEnd(12)} ${point.padEnd(9)} ${forme.padEnd(8)} ${String(r.ms).padStart(5)} ms  ${r.statut === "ok" ? `${ligne.n} rés., réf. au rang ${ligne.refRang ?? "—"} (classé : ${ligne.refRangClasse ?? "—"}) ${ligne.top3.join(", ")}` : r.statut}`);
      await pause(PAUSE);
    }
  }
}

// --- 2. Lectures : série contre parallèle, et l'extraction ------------------------------------
console.log("\n## Lectures (3 pages, une par site, officiels d'abord) : série puis parallèle\n");
for (const [k, q] of questions.entries()) {
  const rq = requeteDepuisMessage(q.question);
  let r = premiers.get(q.id);
  if (!r) {
    r = await interroger("ddg-html", rq.requete);
    await pause(PAUSE);
  }
  if (!r.resultats) {
    console.log(`${q.id} : moteur ${r.statut}`);
    rapport.lectures.push({ id: q.id, statut: r.statut });
    continue;
  }
  const classes = classerResultats(r.resultats, rq.mots);
  const vus = new Set();
  const trois = classes.filter((x) => !vus.has(hoteDe(x.url)) && vus.add(hoteDe(x.url))).slice(0, 3);
  const serie = async () => {
    const t = performance.now();
    const pages = [];
    for (const x of trois) {
      const t1 = performance.now();
      try {
        const p = await lirePage({ url: x.url });
        pages.push({ url: x.url, ms: Math.round(performance.now() - t1), ok: true, cars: p.texte.length, squelettique: p.squelettique, date: p.date, texte: p.texte, titre: p.titre });
      } catch (err) {
        pages.push({ url: x.url, ms: Math.round(performance.now() - t1), ok: false, erreur: err.message });
      }
    }
    return { ms: Math.round(performance.now() - t), pages };
  };
  const parallele = async () => {
    viderCachesRecherche();
    const t = performance.now();
    const d = await rechercheDirecte({
      requete: rq.requete,
      mots: rq.mots,
      n: 3,
      delaiMs: 15_000,
      chercher: async () => ({ backend: "duckduckgo", pointDEntree: "html.duckduckgo.com", resultats: r.resultats }),
    });
    return { ms: Math.round(performance.now() - t), d };
  };
  // L'ordre alterne d'une question à l'autre : ni l'une ni l'autre ne profite
  // toujours des connexions (DNS) déjà chaudes.
  let s;
  let p;
  if (k % 2) {
    p = await parallele();
    s = await serie();
  } else {
    s = await serie();
    p = await parallele();
  }
  viderCachesRecherche();
  const d = p.d;
  const matiere = matiereDirecte(d);
  const pagesAvecAttendu = d.pages.filter((x) => (x.passages || []).some((y) => q.attendu.test(y.texte))).length;
  const pleinAttendu = d.pages.filter((x) => q.attendu.test(x.texte)).length;
  const ligne = {
    id: q.id,
    serieMs: s.ms,
    paralleleMs: d.mesures.lecturesMs,
    pages: s.pages.map((x) => ({ hote: hoteDe(x.url), ms: x.ms, ok: x.ok, cars: x.cars ?? 0, squelettique: Boolean(x.squelettique), date: x.date || null, erreur: x.erreur || null })),
    lues: d.pages.length,
    officielles: d.pages.filter((x) => x.source !== "autre").length,
    datees: d.pages.filter((x) => x.date).length,
    passages: d.pages.reduce((n, x) => n + (x.passages || []).length, 0),
    matiereCars: matiere.length,
    pagesCompletesCars: d.pages.reduce((n, x) => n + Math.min(10_000, x.texte.length), 0),
    pagesAvecAttendu,
    pleinAttendu,
    echecs: d.echecs.map((e) => `${hoteDe(e.url)} : ${e.erreur}`),
  };
  rapport.lectures.push(ligne);
  console.log(
    `${q.id.padEnd(12)} série ${String(s.ms).padStart(5)} ms | parallèle ${String(d.mesures.lecturesMs).padStart(5)} ms | lues ${ligne.lues}/3 (officielles ${ligne.officielles}, datées ${ligne.datees}) | ` +
      `matière ${ligne.matiereCars} car. (~${jetons(ligne.matiereCars)} jetons) contre ${ligne.pagesCompletesCars} en pages entières | réponse dans les passages : ${pagesAvecAttendu} page(s) (dans les pages : ${pleinAttendu})` +
      (ligne.echecs.length ? ` | échecs : ${ligne.echecs.join(" ; ")}` : ""),
  );
  for (const x of s.pages) console.log(`    ${x.ok ? "ok " : "ÉCHEC"} ${String(x.ms).padStart(5)} ms ${hoteDe(x.url)} ${x.ok ? `${x.cars} car.${x.squelettique ? " (squelettique)" : ""}${x.date ? `, ${x.date}` : ""}` : x.erreur}`);
  rapport.extraction.push({ id: q.id, matiere });
}

// --- 3. Synthèse ------------------------------------------------------------------------------
const ok = rapport.moteurs.filter((m) => m.statut === "ok");
console.log("\n## Synthèse\n");
for (const point of points) {
  for (const forme of formesVoulues) {
    const l = rapport.moteurs.filter((m) => m.point === point && m.forme === forme);
    const o = l.filter((m) => m.statut === "ok");
    console.log(
      `${point} / ${forme} : ${o.length}/${l.length} abouties, médiane ${q50(o.map((m) => m.ms))} ms, P90 ${q90(o.map((m) => m.ms))} ms, ` +
        `référence dans les 3 premiers ${o.filter((m) => m.refRang && m.refRang <= 3).length}/${o.length} (après classement : ${o.filter((m) => m.refRangClasse && m.refRangClasse <= 3).length}), ` +
        `bloquées ${l.filter((m) => m.statut === "bloqué").length}`,
    );
  }
}
const lec = rapport.lectures.filter((l) => l.serieMs);
console.log(
  `Lectures de 3 pages : série médiane ${q50(lec.map((l) => l.serieMs))} ms (P90 ${q90(lec.map((l) => l.serieMs))}), parallèle médiane ${q50(lec.map((l) => l.paralleleMs))} ms (P90 ${q90(lec.map((l) => l.paralleleMs))})`,
);
const pagesUnes = lec.flatMap((l) => l.pages);
console.log(
  `Pages : ${pagesUnes.filter((p) => p.ok).length}/${pagesUnes.length} lues, médiane ${q50(pagesUnes.filter((p) => p.ok).map((p) => p.ms))} ms, P90 ${q90(pagesUnes.filter((p) => p.ok).map((p) => p.ms))} ms, ` +
    `squelettiques ${pagesUnes.filter((p) => p.squelettique).length}, datées ${pagesUnes.filter((p) => p.date).length}`,
);
console.log(
  `Matière jointe (recherche directe) : médiane ${q50(lec.map((l) => l.matiereCars))} car. (~${jetons(q50(lec.map((l) => l.matiereCars)))} jetons) ; pages entières lues par la salle blanche : médiane ${q50(lec.map((l) => l.pagesCompletesCars))} car. (~${jetons(q50(lec.map((l) => l.pagesCompletesCars)))} jetons). ` +
    `Réponse attendue présente dans les passages pour ${lec.filter((l) => l.pagesAvecAttendu > 0).length}/${lec.length} questions (dans les pages entières : ${lec.filter((l) => l.pleinAttendu > 0).length}/${lec.length}).`,
);
if (sortieJson) {
  fs.writeFileSync(sortieJson, JSON.stringify(rapport, null, 2));
  console.log(`\nDétail : ${sortieJson}`);
}
