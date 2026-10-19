// Comparer les modèles locaux (retours TestFlight 13, point 8) : GLM, Qwen,
// DeepSeek… ce qui répond VRAIMENT sur les machines de Sam, mesuré sur des
// requêtes françaises représentatives de Remy. Une recommandation fondée sur
// des mesures, pas sur une comparaison théorique.
//
// Sur la tour (PowerShell) :
//   node --env-file=%USERPROFILE%\.remy\remy.env scripts\comparer-modeles.mjs
//   node --env-file=… scripts\comparer-modeles.mjs --url http://192.168.1.50:8888/v1 --url http://192.168.1.51:8000/v1 --repetitions 5
//
//   --url U         un relais compatible OpenAI (répétable). Par défaut : REMY_GLM_URL.
//   --modeles a,b   ne tester que ces modèles (sinon : tous ceux que /models liste).
//   --repetitions N 3 par défaut.
//
// Garde-fous :
//   - adresses privées seulement (localhost, 10.x, 172.16-31.x, 192.168.x,
//     100.64-127.x de Tailscale) : AUCUN service cloud n'est appelé ;
//   - requêtes inventées, sans aucune donnée de Sam ;
//   - rien n'est écrit ailleurs que le rapport (dossier data/ de la tour) ;
//   - le modèle par défaut de Remy ne change pas : c'est une mesure.
//
// Ce qui est mesuré, par modèle et par catégorie : latence médiane et P95,
// temps avant le premier jeton (TTFT), jetons/seconde pendant la génération,
// respect du format JSON attendu, taux d'erreurs. C'est la vitesse
// d'inférence vue de la tour ; la latence jusqu'à l'iPhone (réseau, tour,
// affichage) se lit dans l'app : Réglages → Temps de réponse.

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const val = (nom) => args.flatMap((a, i) => (a === nom ? [args[i + 1]] : [])).filter(Boolean);
const urls = val("--url").length ? val("--url") : [process.env.REMY_GLM_URL].filter(Boolean);
const filtre = (val("--modeles")[0] || "").split(",").map((s) => s.trim()).filter(Boolean);
const REPETITIONS = Math.max(1, Number(val("--repetitions")[0]) || 3);
const JETON = process.env.REMY_GLM_TOKEN || "";

function privee(u) {
  let h;
  try {
    h = new URL(u).hostname;
  } catch {
    return false;
  }
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  const p = h.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x))) return false;
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

// --- Le jeu de requêtes (inventées, représentatives) ------------------------------

const SCHEMA_CAPTURE = {
  type: "object",
  properties: {
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nature: { type: "string", enum: ["rendez-vous", "contrainte", "tache", "rappel", "note", "liste"] },
          titre: { type: "string" },
          quand: { type: ["string", "null"] },
          dureeMin: { type: ["integer", "null"] },
          question: { type: ["string", "null"] },
        },
        required: ["nature", "titre"],
      },
    },
  },
  required: ["elements"],
};
const SYS_CAPTURE =
  "Tu ranges ce que Sam dit en éléments distincts. Natures : rendez-vous (heure fixe avec quelqu'un), contrainte (disponibilité limitée), tache (à planifier), rappel (à une date), note (information), liste (articles). N'invente ni heure ni durée ; si une information indispensable manque, mets une question. Réponds en JSON.";

const SCHEMA_ETIQUETTES = {
  type: "object",
  properties: { etiquettes: { type: "array", items: { type: "string" } }, type: { type: "string", enum: ["rappel", "to-do", "tache"] } },
  required: ["etiquettes", "type"],
};
const SYS_ETIQUETTES =
  "Étiquettes possibles : Personnel, Professionnel, Santé, Voiture, Administratif, Famille et amis, Anniversaire. Donne 1 ou 2 étiquettes et le type (rappel daté, to-do sans planification, tache planifiable dans un agenda). Réponds en JSON.";

const SCHEMA_PLANIF = {
  type: "object",
  properties: {
    propositions: {
      type: "array",
      items: { type: "object", properties: { tache: { type: "string" }, debut: { type: "string" }, dureeMin: { type: "integer" } }, required: ["tache", "debut", "dureeMin"] },
    },
    remarque: { type: "string" },
  },
  required: ["propositions"],
};
const SYS_PLANIF = "Tu proposes des créneaux réalistes dans la journée donnée, sans chevaucher les rendez-vous fixes. Réponds en JSON.";

const SCHEMA_CONSEIL = {
  type: "object",
  properties: { conseil: { type: "string" }, pourquoi: { type: "array", items: { type: "string" } }, tache: { type: ["string", "null"] } },
  required: ["conseil", "pourquoi"],
};
const SYS_CONSEIL =
  "Tu es le directeur de cabinet de Sam. Un conseil pour le moment présent, 1 ou 2 phrases, réaliste ; une activité domestique n'est pas un travail à « avancer » dans un trou de 20 min. Réponds en JSON {conseil, pourquoi[], tache}.";

const SCHEMA_PROJETS = {
  type: "object",
  properties: {
    niveau: { type: "string", enum: ["projet", "sous-projet", "tache", "note"] },
    parent: { type: ["string", "null"] },
    motion: { type: "boolean" },
    raison: { type: "string" },
  },
  required: ["niveau", "motion", "raison"],
};
const SYS_PROJETS =
  "Arborescence actuelle : Corail > Site internet ; Corail > Application ; Corail > Boutique de bougies > Comparer les fournisseurs TTS/STT. Dis où ranger la demande (niveau, parent) et s'il faut un projet Motion (seulement pour un grand projet durable, jamais pour une action isolée). Réponds en JSON.";

const JEU = [
  { cat: "capture simple", sys: SYS_CAPTURE, schema: SCHEMA_CAPTURE, u: "Appeler le garage pour la révision", ok: (j) => j.elements?.length === 1 && j.elements[0].nature === "tache" },
  { cat: "capture simple", sys: SYS_CAPTURE, schema: SCHEMA_CAPTURE, u: "tomates, lait d'avoine et œufs", ok: (j) => j.elements?.length >= 1 && j.elements.every((e) => e.nature === "liste") },
  { cat: "capture simple", sys: SYS_CAPTURE, schema: SCHEMA_CAPTURE, u: "Rappelle-moi de payer le loyer le 5", ok: (j) => j.elements?.[0]?.nature === "rappel" },
  {
    cat: "capture multi-intentions", sys: SYS_CAPTURE, schema: SCHEMA_CAPTURE,
    u: "Soirée chez Yanis jeudi, je suis dispo seulement le matin samedi, deux heures de studio dimanche à La Roseraie et il faut faire la lessive avant",
    ok: (j) => (j.elements?.length || 0) >= 4,
  },
  {
    cat: "capture multi-intentions", sys: SYS_CAPTURE, schema: SCHEMA_CAPTURE,
    u: "Déjeuner avec Léa vendredi midi chez Paulette, et pense à réserver le tennis pour l'anniversaire de Hugo",
    ok: (j) => (j.elements?.length || 0) >= 2 && j.elements.some((e) => e.nature === "rendez-vous"),
  },
  {
    cat: "capture multi-intentions", sys: SYS_CAPTURE, schema: SCHEMA_CAPTURE,
    u: "Envoyer le devis à Ondine, relancer le comptable et acheter une rallonge",
    ok: (j) => (j.elements?.length || 0) >= 3,
  },
  { cat: "classification", sys: SYS_ETIQUETTES, schema: SCHEMA_ETIQUETTES, u: "Contrôle technique de la Twingo avant le 30", ok: (j) => j.etiquettes?.includes("Voiture") },
  { cat: "classification", sys: SYS_ETIQUETTES, schema: SCHEMA_ETIQUETTES, u: "Anniversaire de Nina le 3 février", ok: (j) => j.etiquettes?.includes("Anniversaire") || j.etiquettes?.includes("Famille et amis") },
  { cat: "classification", sys: SYS_ETIQUETTES, schema: SCHEMA_ETIQUETTES, u: "Renouveler l'ordonnance chez le médecin", ok: (j) => j.etiquettes?.includes("Santé") },
  {
    cat: "planification", sys: SYS_PLANIF, schema: SCHEMA_PLANIF,
    u: "Journée : 9:00-10:00 point équipe (fixe), 12:30-13:30 déjeuner (fixe), 18:00 fin. À placer : préparer la démo (2 h), relire le contrat (45 min).",
    ok: (j) => (j.propositions?.length || 0) >= 2,
  },
  {
    cat: "planification", sys: SYS_PLANIF, schema: SCHEMA_PLANIF,
    u: "Après-midi : 14:00-15:00 dentiste (fixe). À placer avant 19:00 : mixer le titre 2 (90 min), trier la boîte mail (30 min).",
    ok: (j) => (j.propositions?.length || 0) >= 2,
  },
  {
    cat: "conseil", sys: SYS_CONSEIL, schema: SCHEMA_CONSEIL,
    u: '{"heure":"10:40","enCours":null,"prochainsFixes":[{"titre":"Déjeuner","debut":"11:25"}],"libreAvantProchainFixeMin":44,"aFaireAujourdhui":[{"titre":"Prendre une douche"},{"titre":"Préparer la démo","priorite":"importante"}]}',
    ok: (j) => typeof j.conseil === "string" && !/douche/i.test(j.conseil),
  },
  {
    cat: "conseil", sys: SYS_CONSEIL, schema: SCHEMA_CONSEIL,
    u: '{"heure":"16:10","enCours":{"titre":"Relire le contrat","fin":"16:40","resteMin":30},"prochainsFixes":[{"titre":"Appel Hugo","debut":"16:30"}]}',
    ok: (j) => typeof j.conseil === "string" && /hugo|16:30|appel/i.test(j.conseil),
  },
  { cat: "projets", sys: SYS_PROJETS, schema: SCHEMA_PROJETS, u: "Étudier ElevenLabs pour la voix du boutique", ok: (j) => ["sous-projet", "tache"].includes(j.niveau) && j.motion === false },
  { cat: "projets", sys: SYS_PROJETS, schema: SCHEMA_PROJETS, u: "Lancer une nouvelle activité de location de vans aménagés", ok: (j) => j.niveau === "projet" },
];

// --- Mesure -----------------------------------------------------------------------

async function modeles(url) {
  const r = await fetch(url.replace(/\/+$/, "") + "/models", {
    headers: JETON ? { Authorization: `Bearer ${JETON}` } : {},
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`/models : ${r.status}`);
  const j = await r.json();
  return (j.data || []).map((m) => m.id).filter(Boolean);
}

function lireJSON(t) {
  const s = String(t || "").replace(/<think>[\s\S]*?<\/think>/g, "");
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

async function une(url, modele, cas) {
  const t0 = performance.now();
  let premier = null;
  let texte = "";
  let jetons = null;
  const r = await fetch(url.replace(/\/+$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(JETON ? { Authorization: `Bearer ${JETON}` } : {}) },
    body: JSON.stringify({
      model: modele,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      max_tokens: 1200,
      chat_template_kwargs: { enable_thinking: false },
      response_format: { type: "json_schema", json_schema: { name: "reponse", schema: cas.schema } },
      messages: [
        { role: "system", content: cas.sys },
        { role: "user", content: cas.u },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const lecteur = r.body.getReader();
  const dec = new TextDecoder();
  let tampon = "";
  for (;;) {
    const { value, done } = await lecteur.read();
    if (done) break;
    tampon += dec.decode(value, { stream: true });
    let i;
    while ((i = tampon.indexOf("\n")) >= 0) {
      const ligne = tampon.slice(0, i).trim();
      tampon = tampon.slice(i + 1);
      if (!ligne.startsWith("data:")) continue;
      const d = ligne.slice(5).trim();
      if (d === "[DONE]") continue;
      let e;
      try {
        e = JSON.parse(d);
      } catch {
        continue;
      }
      const morceau = e.choices?.[0]?.delta?.content;
      if (morceau) {
        if (premier === null) premier = performance.now() - t0;
        texte += morceau;
      }
      if (e.usage?.completion_tokens) jetons = e.usage.completion_tokens;
    }
  }
  const total = performance.now() - t0;
  const j = lireJSON(texte);
  return {
    total,
    ttft: premier,
    jetonsSeconde: jetons && premier !== null && total > premier ? (jetons / ((total - premier) / 1000)) : null,
    formatOk: Boolean(j),
    sensOk: Boolean(j && cas.ok(j)),
  };
}

const q = (v, p) => {
  const t = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return t.length ? t[Math.min(t.length - 1, Math.floor(p * t.length))] : null;
};
const s = (ms) => (ms === null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);
const pc = (n, d) => (d ? `${Math.round((100 * n) / d)} %` : "—");

async function main() {
  if (!urls.length) {
    console.error("Aucun relais : passe --url http://192.168.1.50:8888/v1 (ou REMY_GLM_URL dans remy.env).");
    process.exit(2);
  }
  for (const u of urls) {
    if (!privee(u)) {
      console.error(`Refusé : ${u} n'est pas une adresse de ton réseau. Ce script n'appelle aucun service cloud.`);
      process.exit(2);
    }
  }
  const resultats = [];
  for (const url of urls) {
    let liste;
    try {
      liste = await modeles(url);
    } catch (err) {
      console.log(`⚠️  ${url} : ${err.message} — ignoré`);
      continue;
    }
    const aTester = filtre.length ? liste.filter((m) => filtre.includes(m)) : liste;
    console.log(`${url} : ${liste.join(", ") || "(aucun modèle listé)"}${filtre.length ? ` → testés : ${aTester.join(", ")}` : ""}`);
    for (const modele of aTester) {
      for (const cas of JEU) {
        for (let k = 0; k < REPETITIONS; k++) {
          try {
            resultats.push({ url, modele, cat: cas.cat, ...(await une(url, modele, cas)) });
            process.stdout.write(".");
          } catch (err) {
            resultats.push({ url, modele, cat: cas.cat, erreur: err.message });
            process.stdout.write("x");
          }
        }
      }
      process.stdout.write(` ${modele}\n`);
    }
  }
  if (!resultats.length) {
    console.log("Aucun modèle n'a répondu : rien à comparer.");
    process.exit(1);
  }

  const lignes = ["# Comparaison des modèles locaux", "", `${new Date().toLocaleString("fr-FR")} · ${REPETITIONS} répétition(s) par requête · ${JEU.length} requêtes`, ""];
  const cles = [...new Set(resultats.map((r) => `${r.modele} @ ${r.url}`))];
  lignes.push("| Modèle | Latence médiane | P95 | 1er jeton (méd.) | Jetons/s (méd.) | Format JSON | Réponse juste | Erreurs |");
  lignes.push("|---|---|---|---|---|---|---|---|");
  for (const c of cles) {
    const rs = resultats.filter((r) => `${r.modele} @ ${r.url}` === c);
    const ok = rs.filter((r) => !r.erreur);
    lignes.push(`| ${c} | ${s(q(ok.map((r) => r.total), 0.5))} | ${s(q(ok.map((r) => r.total), 0.95))} | ${s(q(ok.map((r) => r.ttft), 0.5))} | ${q(ok.map((r) => r.jetonsSeconde), 0.5)?.toFixed(1) ?? "—"} | ${pc(ok.filter((r) => r.formatOk).length, ok.length)} | ${pc(ok.filter((r) => r.sensOk).length, ok.length)} | ${pc(rs.length - ok.length, rs.length)} |`);
  }
  for (const cat of [...new Set(JEU.map((c) => c.cat))]) {
    lignes.push("", `## ${cat}`, "", "| Modèle | Médiane | P95 | Réponse juste |", "|---|---|---|---|");
    for (const c of cles) {
      const rs = resultats.filter((r) => `${r.modele} @ ${r.url}` === c && r.cat === cat && !r.erreur);
      lignes.push(`| ${c} | ${s(q(rs.map((r) => r.total), 0.5))} | ${s(q(rs.map((r) => r.total), 0.95))} | ${pc(rs.filter((r) => r.sensOk).length, rs.length)} |`);
    }
  }
  lignes.push("", "Vitesse d'inférence vue de la tour. La latence jusqu'à l'iPhone : app → Réglages → Temps de réponse.");
  const rapport = lignes.join("\n");
  console.log("\n" + rapport);
  const dossier = process.env.REMY_DATA_DIR || path.join(process.env.USERPROFILE || process.env.HOME || ".", ".remy");
  try {
    fs.mkdirSync(dossier, { recursive: true });
    const f = path.join(dossier, `comparaison-modeles-${new Date().toISOString().slice(0, 10)}.md`);
    fs.writeFileSync(f, rapport);
    fs.writeFileSync(f.replace(/\.md$/, ".json"), JSON.stringify(resultats, null, 1));
    console.log(`\nRapport : ${f}`);
  } catch (err) {
    console.log(`(rapport non écrit : ${err.message})`);
  }
}

await main();
