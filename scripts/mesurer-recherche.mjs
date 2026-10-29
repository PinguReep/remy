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
import { requeteDepuisMessage, classerResultats, ordreDeLecture, rechercheDirecte, matiereDirecte, blocRecherche, viderCachesRecherche } from "../lib/recherche-rapide.js";
import { promptSalleBlanche } from "../lib/salle-blanche.js";
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
  const liste = ordreDeLecture(classes);
  // En série, la même règle qu'en parallèle : jusqu'à 3 pages lues, 5 essais au plus.
  const serie = async () => {
    const t = performance.now();
    const pages = [];
    for (const x of liste.slice(0, 5)) {
      if (pages.filter((p) => p.ok).length >= 3) break;
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
  // Ce que la salle blanche relirait : la liste de résultats de chercher_web (encadrée).
  const listeResultats = r.resultats.slice(0, 6).map((x, i) => `${i + 1}. ${x.titre}\n   ${x.url}${x.extrait ? `\n   ${x.extrait}` : ""}`).join("\n");
  const ligne = {
    id: q.id,
    questionCars: q.question.length,
    resultatsCars: listeResultats.length + 300,
    page1Cars: Math.min(10_000, d.pages[0]?.texte.length || 0) + 400,
    page2Cars: Math.min(10_000, d.pages[1]?.texte.length || 0) + 400,
    blocCars: blocRecherche(d, { relance: true }).length,
    rechercheMs: r.ms,
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
// --- 4. Appels au modèle et jetons, par stratégie (des mesures ci-dessus) -------------------
// Ce qui est MESURÉ : la taille de ce que chaque appel envoie (consigne de la
// salle blanche, résultats, pages, matière jointe), le temps du web. Ce qui est
// SUPPOSÉ (à confirmer par scripts/banc-recherche.mjs sur la tour) : la taille
// de la consigne du modèle principal (--systeme, 31 000 jetons par défaut :
// l'ordre de grandeur de la jauge), les jetons écrits (réflexion selon
// l'effort, réponse, synthèse), et les débits (--decode 40 jetons/s : la jauge ;
// --prefill 2 000 jetons/s : non mesuré ici).
const S = Number(val("--systeme")) || 31_000;
const DECODE = Number(val("--decode")) || 40;
const PREFILL = Number(val("--prefill")) || 2_000;
const REFLEXION = { high: 400, medium: 250, low: 120, off: 0 };
const REPONSE = 350;
const SYNTHESE = 350;
const OUTIL = 40;
const PSB = jetons(promptSalleBlanche().length);
const est = (l) => {
  const Q = jetons(l.questionCars);
  const R = jetons(l.resultatsCars);
  const P1 = jetons(l.page1Cars);
  const P2 = jetons(l.page2Cars);
  const M = jetons(l.blocCars);
  const SB = jetons(SYNTHESE * CARS_PAR_JETON + 1200); // synthèse + passages + pages lues, rendus au modèle principal
  // [envoyé, nouveau (avec cache de préfixe), écrit] par appel
  const salle = [
    [S + Q, S + Q, REFLEXION.high + OUTIL],
    [PSB + Q + R, PSB + Q + R, REFLEXION.low + OUTIL],
    [PSB + Q + R + P1, P1, REFLEXION.medium + OUTIL],
    [PSB + Q + R + P1 + P2, P2, REFLEXION.medium + SYNTHESE],
    [S + Q + OUTIL + SB, OUTIL + SB, REFLEXION.medium + REPONSE],
  ];
  const direct = [[S + Q + M, S + Q + M, REFLEXION.low + REPONSE]];
  const vif = [[S + Q + M, S + Q + M, REPONSE]];
  const hybrideRelance = [direct[0], [S + Q + M + OUTIL + M, OUTIL + M, REFLEXION.low + REPONSE]];
  const web = { salle: l.rechercheMs + l.serieMs, direct: l.rechercheMs + l.paralleleMs };
  const bilan = (appels, webMs) => {
    const envoyes = appels.reduce((n, a) => n + a[0], 0);
    const nouveaux = appels.reduce((n, a) => n + a[1], 0);
    const ecrits = appels.reduce((n, a) => n + a[2], 0);
    // Premier mot : le web, puis tout sauf la réponse du dernier appel.
    return {
      appels: appels.length,
      envoyes,
      nouveaux,
      ecrits,
      sansCacheS: Math.round((webMs + (envoyes / PREFILL) * 1000 + (ecrits / DECODE) * 1000) / 100) / 10,
      avecCacheS: Math.round((webMs + (nouveaux / PREFILL) * 1000 + (ecrits / DECODE) * 1000) / 100) / 10,
    };
  };
  return {
    salle: bilan(salle, web.salle),
    "salle (1 page)": bilan([salle[0], salle[1], [salle[3][0] - P2, P1, REFLEXION.medium + SYNTHESE], salle[4]], l.rechercheMs + (l.pages.find((p) => p.ok)?.ms || 0)),
    direct: bilan(direct, web.direct),
    "direct sans réflexion": bilan(vif, web.direct),
    "hybride (avec relance)": bilan(hybrideRelance, web.direct * 2),
  };
};
const estimes = lec.map((l) => ({ id: l.id, ...est(l) }));
rapport.estimations = { hypotheses: { systemeJetons: S, decodeJetonsS: DECODE, prefillJetonsS: PREFILL, reflexion: REFLEXION, reponse: REPONSE, synthese: SYNTHESE, promptSalleBlancheJetons: PSB }, parQuestion: estimes };
console.log(`\n## Appels au modèle et jetons par stratégie (médianes ; consigne principale ${S} jetons, décodage ${DECODE} j/s, lecture ${PREFILL} j/s)\n`);
console.log("| Stratégie | Appels | Jetons envoyés | dont nouveaux (cache de préfixe) | Jetons écrits | Temps estimé sans cache | avec cache |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const nom of Object.keys(estimes[0] || {}).filter((k) => k !== "id")) {
  const m = (k) => q50(estimes.map((e) => e[nom][k]));
  console.log(`| ${nom} | ${m("appels")} | ${m("envoyes")} | ${m("nouveaux")} | ${m("ecrits")} | ${m("sansCacheS")} s | ${m("avecCacheS")} s |`);
}

if (sortieJson) {
  fs.writeFileSync(sortieJson, JSON.stringify(rapport, null, 2));
  console.log(`\nDétail : ${sortieJson}`);
}
