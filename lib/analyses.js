// Analyses par GLM LOCAL (Lot 1, retours TestFlight 13) — jamais le cloud :
//   - une capture à plusieurs intentions (« soirée chez Yanis jeudi, dispo
//     limitée samedi, deux heures de studio dimanche… ») découpée en éléments,
//     chacun avec sa nature ; rien n'est exécuté ici : l'app montre un
//     récapitulatif, Sam valide ;
//   - les rappels existants classés (étiquettes, garder / tâche Motion / rien)
//     pour le mini-onboarding : des PROPOSITIONS, rien n'est changé ici.

import { glmConfigured, verifierGlm, GLM_LABEL } from "./glm.js";
import { glmProvider } from "./providers.js";
import { logCost } from "./chat.js";
import { chrono } from "./mesures.js";
import { TZ } from "./activite.js";
import { PROMPT_EXTRAIRE, SCHEMA_EXTRAIRE, promptExtraire, lireExtraits, nettoyerCapture } from "./capture.js";

export class ErreurAnalyse extends Error {
  constructor(statut, message) {
    super(message);
    this.statut = statut;
  }
}

export const NATURES = ["rendez-vous", "contrainte", "tache", "rappel", "note", "liste", "projet"];

async function glmPret(sinon = "la capture reste simple") {
  if (!glmConfigured()) throw new ErreurAnalyse(503, `Le modèle local (GLM) n'est pas configuré sur la tour : ${sinon}.`);
  if (!(await verifierGlm()).ok) throw new ErreurAnalyse(503, `Le modèle local (GLM) ne répond pas : ${sinon} pour l'instant.`);
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

const nettoyer = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// « 2026-10-17T19:00 » ou « 2026-10-17 » à Paris → ms (et si l'heure est connue).
export function quandDe(v, tz = TZ) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, a, mo, j, h, mi] = m;
  const heureConnue = h !== undefined;
  // L'heure de Paris → UTC : on cherche le décalage du jour (été / hiver).
  const naif = Date.UTC(+a, +mo - 1, +j, heureConnue ? +h : 9, heureConnue ? +mi : 0);
  const decal = (ts) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ts;
  };
  const ts = naif - decal(naif);
  return Number.isFinite(ts) ? { ms: ts, heureConnue } : null;
}

const jourParis = (ms) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
const isoParis = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};

const SCHEMA_CAPTURE = {
  type: "object",
  properties: {
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nature: { type: "string", enum: NATURES },
          titre: { type: "string" },
          quand: { type: ["string", "null"] },
          dureeMin: { type: ["integer", "null"] },
          liste: { type: ["string", "null"] },
          articles: { type: "array", items: { type: "string" } },
          etiquettes: { type: "array", items: { type: "string" } },
          parent: { type: ["string", "null"] },
          question: { type: ["string", "null"] },
        },
        required: ["nature", "titre"],
      },
    },
  },
  required: ["elements"],
};

const SYSTEME_CAPTURE = `Tu ranges ce que Sam vient de dire ou d'écrire en ÉLÉMENTS distincts (un par intention). Natures :
- rendez-vous : à heure fixe, souvent avec quelqu'un ou dans un lieu (soirée, dîner, studio réservé) ;
- contrainte : une disponibilité limitée (« dispo seulement le matin samedi ») ;
- tache : un travail à planifier, qui prend du temps (Motion lui trouvera un créneau) ;
- rappel : une chose à ne pas oublier à un moment donné (« rappelle-moi de… le 5 ») ;
- note : une information utile, sans action ;
- liste : des articles à ajouter à une liste (courses…) ;
- projet : un nouveau projet, une catégorie ou un sous-projet à créer.
Règles :
- « quand » au format AAAA-MM-JJ ou AAAA-MM-JJTHH:MM (heure de Paris), calculé depuis la date du jour ; null si rien n'est dit. N'invente JAMAIS une heure.
- « dureeMin » seulement si elle est dite (« deux heures » = 120) ; sinon null.
- Une information vague ne devient pas un créneau fixe.
- Si une information indispensable manque (l'heure d'un rendez-vous), mets une question courte dans « question ».
- « liste » : le nom de la liste visée (parmi celles connues si possible) ; « articles » : un article par entrée.
- « etiquettes » : 0 à 2 noms pris dans la liste fournie, seulement si évident.
- « parent » (projet) : le nom d'un projet ou dossier existant où le ranger, ou null pour un projet à part.
- « titre » : court, à l'infinitif pour une tâche, sans la formule de demande (« rappelle-moi de »).
Réponds UNIQUEMENT en JSON : {"elements": [...]}.`;

/** Découpe une capture en éléments (sans rien exécuter). */
export async function analyserCapture(texte, { maintenant = Date.now(), etiquettes = [], listes = [], dossiers = [] } = {}) {
  const t = nettoyer(texte, 2000);
  if (!t) throw new ErreurAnalyse(400, "Rien à analyser");
  await glmPret();
  const fin = chrono("capture.glm");
  const contexte = {
    maintenant: jourParis(maintenant),
    aujourdhui: isoParis(maintenant),
    etiquettes: etiquettes.map((e) => e.nom),
    listes: listes.map((l) => l.nom),
    projetsEtDossiers: dossiers.map((d) => d.nom).slice(0, 60),
  };
  let r;
  try {
    r = await glmProvider.complete({
      system: SYSTEME_CAPTURE,
      prompt: `Contexte : ${JSON.stringify(contexte)}\n\nCe que Sam a dit :\n${t}`,
      maxTokens: 1500,
      schema: SCHEMA_CAPTURE,
      delaiMs: 90_000,
    });
  } catch (err) {
    fin({ ok: false });
    throw new ErreurAnalyse(503, `Le modèle local n'a pas pu analyser (${err.message}) : la capture reste simple.`);
  }
  fin({ ok: true });
  logCost("capture", "glm", r.model || GLM_LABEL, r.usage, null, "Capture · analyse").catch(() => {});
  const j = lireJSON(r.text);
  if (!Array.isArray(j?.elements)) throw new ErreurAnalyse(502, "Le modèle local a répondu de façon illisible : la capture reste simple.");
  const parNom = new Map(etiquettes.map((e) => [e.nom.toLowerCase(), e.id]));
  const elements = j.elements
    .filter((e) => e && NATURES.includes(e.nature) && nettoyer(e.titre, 200))
    .slice(0, 12)
    .map((e, i) => {
      const q = e.quand ? quandDe(e.quand) : null;
      const articles = Array.isArray(e.articles) ? e.articles.map((a) => nettoyer(a, 120)).filter(Boolean).slice(0, 30) : [];
      let question = e.question ? nettoyer(e.question, 160) : null;
      // Un rendez-vous sans heure ne devient pas un créneau arbitraire.
      if (e.nature === "rendez-vous" && (!q || !q.heureConnue) && !question) question = "À quelle heure ?";
      return {
        cle: `e${i}`,
        nature: e.nature,
        titre: nettoyer(e.titre, 200),
        quand: q?.ms ?? null,
        heureConnue: Boolean(q?.heureConnue),
        dureeMin: Number.isInteger(e.dureeMin) && e.dureeMin > 0 && e.dureeMin <= 24 * 60 ? e.dureeMin : null,
        liste: e.nature === "liste" ? nettoyer(e.liste, 60) || null : null,
        articles: e.nature === "liste" ? (articles.length ? articles : [nettoyer(e.titre, 120)]) : [],
        etiquettes: (Array.isArray(e.etiquettes) ? e.etiquettes : []).map((n) => parNom.get(String(n).toLowerCase())).filter(Boolean).slice(0, 2),
        parent: e.nature === "projet" ? nettoyer(e.parent, 120) || null : null,
        question,
      };
    });
  return { elements, modele: r.model || GLM_LABEL };
}

const SCHEMA_RAPPELS = {
  type: "object",
  properties: {
    propositions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          etiquettes: { type: "array", items: { type: "string" } },
          action: { type: "string", enum: ["garder", "tache", "rien"] },
        },
        required: ["id", "action"],
      },
    },
  },
  required: ["propositions"],
};

const SYSTEME_RAPPELS = `Tu aides Sam à ranger ses rappels. Pour CHAQUE rappel (par son id) :
- « etiquettes » : 0 à 2 noms pris UNIQUEMENT dans la liste fournie ;
- « action » : « garder » (un rappel ou une to-do qui reste telle quelle), « tache » (un vrai travail qui prend du temps et gagnerait à être planifié par Motion), ou « rien » (déjà clair, ne rien changer).
Ne propose « tache » que pour un travail clairement planifiable (pas « acheter du pain », pas un anniversaire).
Réponds UNIQUEMENT en JSON : {"propositions": [...]}.`;

/** Propositions pour les rappels existants (rien n'est modifié ici). */
export async function analyserRappels(rappels, etiquettes) {
  const aClasser = rappels.filter((r) => !r.fait).slice(0, 60);
  if (!aClasser.length) return { propositions: [] };
  await glmPret();
  const parNom = new Map(etiquettes.map((e) => [e.nom.toLowerCase(), e.id]));
  const propositions = [];
  for (let i = 0; i < aClasser.length; i += 20) {
    const lot = aClasser.slice(i, i + 20).map((r) => ({ id: r.id, texte: r.texte, date: r.quand ? isoParis(r.quand) : null }));
    const fin = chrono("rappels.glm");
    let r;
    try {
      r = await glmProvider.complete({
        system: SYSTEME_RAPPELS,
        prompt: `Étiquettes possibles : ${JSON.stringify(etiquettes.map((e) => e.nom))}\nRappels : ${JSON.stringify(lot)}`,
        maxTokens: 2500,
        schema: SCHEMA_RAPPELS,
        delaiMs: 120_000,
      });
    } catch (err) {
      fin({ ok: false });
      throw new ErreurAnalyse(503, `Le modèle local n'a pas pu classer tes rappels (${err.message}).`);
    }
    fin({ ok: true, n: lot.length });
    logCost("rappels", "glm", r.model || GLM_LABEL, r.usage, null, "Rappels · classement").catch(() => {});
    const j = lireJSON(r.text);
    const ids = new Set(lot.map((x) => x.id));
    for (const p of j?.propositions || []) {
      if (!p || !ids.has(p.id) || !["garder", "tache", "rien"].includes(p.action)) continue;
      ids.delete(p.id);
      propositions.push({
        id: p.id,
        action: p.action,
        etiquettes: (Array.isArray(p.etiquettes) ? p.etiquettes : []).map((n) => parNom.get(String(n).toLowerCase())).filter(Boolean).slice(0, 2),
      });
    }
  }
  return { propositions };
}

/**
 * « Retenir » un long texte (Sam, 18/10) : les infos que Rémy garderait, à
 * cocher. GLM local seulement ; rien n'est écrit ici.
 */
export async function extraireInfos(texte, { source = "note", memoire = "" } = {}) {
  const { capture, raison } = nettoyerCapture(texte, { source });
  if (!capture) throw new ErreurAnalyse(400, raison);
  await glmPret("tu peux tout retenir tel quel");
  const fin = chrono("capture.extraire");
  let r;
  try {
    r = await glmProvider.complete({
      system: PROMPT_EXTRAIRE,
      prompt: promptExtraire(memoire, capture),
      maxTokens: 3000,
      schema: SCHEMA_EXTRAIRE,
      delaiMs: 90_000,
    });
  } catch (err) {
    fin({ ok: false });
    throw new ErreurAnalyse(503, `Le modèle local n'a pas pu lire ce texte (${err.message}) : tu peux tout retenir tel quel.`);
  }
  fin({ ok: true });
  logCost("capture", "glm", r.model || GLM_LABEL, r.usage, null, "Retenir · ce que Rémy propose").catch(() => {});
  return { elements: lireExtraits(lireJSON(r.text)), modele: r.model || GLM_LABEL };
}
