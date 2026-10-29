// La nuit relit tes conversations de la veille (29/10) : thèmes, décisions,
// choses à faire — des PROPOSITIONS, que tu acceptes d'un geste (jamais une
// action seule). Le modèle local, et rien d'autre : la demande part avec
// `prive`, que fournisseurDeFond refuse de confier à Claude (modèle local ou
// rien, secours activé ou non). Le résultat est rangé chiffré, avec la liste
// des sources dont il vient (pour l'effacer avec elles).
//
// Le briefing du matin peut en citer UNE ligne : elle est lue au moment de
// l'afficher (GET /api/rituel), jamais écrite dans le briefing de la nuit —
// qui, lui, peut repartir dans une demande à Claude.

import crypto from "node:crypto";
import { base, baseExiste, transaction } from "./base.js";
import { chiffrer, dechiffrerOuNull } from "./chiffre.js";
import { usage, messagesEntre, synchroniser, SOURCES } from "./sync.js";
import { encadrer, CONSIGNE_MATIERE } from "../encadrement.js";
import { PRENOM } from "../profil.js";
import { horodate, TZ } from "../activite.js";
import { debutJour, finJour } from "../dashboard.js";
import { modeleLocalChezToi } from "../glm.js";

const CONV_MAX = 40;
const CONV_MIN_CARACTERES = 700; // une conversation retenue a au moins ça
const MESSAGE_CARACTERES = 400;
const COLLE_CARACTERES = 200;
const TOTAL_CARACTERES = 24_000;
// Ce qui ressemble à une décision ou à une chose à faire : gardé où qu'il soit
// dans la conversation (contre-relecture du 29/10 : la nuit ne lisait que le
// début de chaque conversation).
const MARQUE =
  /(?<![\p{L}\p{N}])(il faut|il faudra|faudrait|[àa] faire|todo|penser [àa]|rappeler|n'oublie|relancer|avant (?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|la fin|le \d)|d[ée]cid|d[ée]cision|on part sur|je pars sur|on garde|on choisit|on retient|c'est (?:not[ée]|valid[ée]|tranch[ée])|prochaine [ée]tape|reste [àa])/iu;

export const PROMPT_NUIT = `Tu relis, pour ${PRENOM}, ses conversations d'hier avec d'autres assistants (Claude Code, T3 Code, ChatGPT). Tu en tires, sans rien inventer ni extrapoler :
- les thèmes de la journée (3 au plus, quelques mots chacun) ;
- les décisions qu'il a prises (5 au plus, une phrase chacune, telles qu'il les a prises) ;
- les choses à faire qu'il a évoquées ou qui restent ouvertes (5 au plus, une action courte chacune, avec la source : « Claude Code », « T3 Code » ou « ChatGPT ») ;
- une ligne pour son briefing du matin (20 mots au plus), la plus utile pour sa journée — ou une chaîne vide si rien ne la mérite.
Ce ne sont que des propositions : ${PRENOM} décidera. Ignore le code, les journaux d'erreurs et les détails techniques sans enjeu pour lui. Une liste vide vaut mieux qu'un élément forcé.
Réponds UNIQUEMENT avec ce JSON : {"themes":["…"],"decisions":["…"],"aFaire":[{"texte":"…","source":"…"}],"ligne":"…"}`;

const SCHEMA = {
  type: "object",
  properties: {
    themes: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    aFaire: {
      type: "array",
      items: { type: "object", properties: { texte: { type: "string" }, source: { type: "string" } }, required: ["texte", "source"], additionalProperties: false },
    },
    ligne: { type: "string" },
  },
  required: ["themes", "decisions", "aFaire", "ligne"],
  additionalProperties: false,
};

// « hier » vu de `maintenant`, à Paris.
export function jourPrecedent(maintenant = Date.now()) {
  return horodate(debutJour(maintenant, TZ) - 6 * 3600_000).jour;
}

const bornes = (jour) => {
  const midi = Date.parse(`${jour}T12:00:00Z`);
  return [debutJour(midi, TZ), finJour(midi, TZ)];
};

const court = (t, n) => {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

// La matière de la nuit : TOUTES les conversations du jour (les plus
// fournies en messages de toi d'abord), le budget réparti entre elles. Dans
// chacune : ce qui ressemble à une décision ou à une chose à faire, où que ce
// soit, puis tes messages, puis les dernières réponses — remis dans l'ordre.
export function matiereDuJour(jour) {
  const [d, f] = bornes(jour);
  const msgs = messagesEntre(d, f, { limite: 20_000 });
  if (!msgs.length) return null;
  const parConv = new Map();
  for (const m of msgs) {
    const cle = `${m.source}:${m.conversation}`;
    if (!parConv.has(cle)) parConv.set(cle, { source: m.source, titre: m.titre, assistant: m.assistant, messages: [] });
    parConv.get(cle).messages.push(m);
  }
  const deToi = (m) => m.auteur === "utilisateur" || m.auteur === "colle";
  const convs = [...parConv.values()]
    .map((c) => ({ ...c, deToi: c.messages.filter(deToi).length }))
    .sort((a, b) => b.deToi - a.deToi || b.messages.length - a.messages.length)
    .slice(0, CONV_MAX);
  const part = Math.max(CONV_MIN_CARACTERES, Math.floor(TOTAL_CARACTERES / convs.length));
  let total = 0;
  const morceaux = [];
  const sources = new Set();
  for (const c of convs) {
    const qui = (m) => (m.auteur === "assistant" ? c.assistant || "Assistant" : m.auteur === "resume" ? "Résumé" : PRENOM);
    const ligne = (m) => `${qui(m)} : ${court(m.texte, m.auteur === "colle" ? COLLE_CARACTERES : MESSAGE_CARACTERES)}\n`;
    const reponses = c.messages.filter((m) => m.auteur === "assistant");
    const derniers = new Set(reponses.slice(-2));
    // Par ordre de priorité ; le budget de la conversation s'arrête où il s'arrête.
    const rang = (m) => (MARQUE.test(m.texte) ? 0 : deToi(m) ? 1 : derniers.has(m) ? 2 : 3);
    const choisis = new Set();
    let taille = 0;
    for (const m of [...c.messages].filter((m) => rang(m) < 3).sort((a, b) => rang(a) - rang(b))) {
      const l = ligne(m);
      if (taille + l.length > part) continue;
      choisis.add(m);
      taille += l.length;
    }
    if (!choisis.size) continue;
    const corps = c.messages.filter((m) => choisis.has(m)).map(ligne).join("");
    const nom = SOURCES[c.source]?.nom || c.source;
    const bloc = `### ${nom} — ${c.titre} (${c.messages.length} messages, dont ${c.deToi} de ${PRENOM})\n${encadrer(corps.trim(), { source: nom, titre: c.titre })}`;
    if (total + bloc.length > TOTAL_CARACTERES + 2000) break;
    total += bloc.length;
    morceaux.push(bloc);
    sources.add(c.source);
  }
  if (!morceaux.length) return null;
  return { texte: morceaux.join("\n\n"), sources: [...sources], conversations: morceaux.length, messages: msgs.length };
}

const nettoyer = (liste, n, max = 200) =>
  (Array.isArray(liste) ? liste : [])
    .map((x) => court(typeof x === "string" ? x : x?.texte, max))
    .filter(Boolean)
    .slice(0, n);

export function lireReponse(texte) {
  const brut = String(texte || "").trim();
  const debut = brut.indexOf("{");
  const fin = brut.lastIndexOf("}");
  if (debut === -1 || fin <= debut) throw new Error("Résumé de nuit illisible (pas de JSON)");
  const j = JSON.parse(brut.slice(debut, fin + 1));
  return {
    themes: nettoyer(j.themes, 3, 80),
    decisions: nettoyer(j.decisions, 5),
    aFaire: (Array.isArray(j.aFaire) ? j.aFaire : [])
      .map((x) => ({ texte: court(x?.texte, 160), source: court(x?.source, 30) || null }))
      .filter((x) => x.texte)
      .slice(0, 5),
    ligne: court(j.ligne, 160),
  };
}

// Prépare le résumé d'un jour. `fournisseur` et `noterCout` sont injectés
// (planificateur, tests) : jamais d'import de chat.js ici.
export async function preparerNuit({ jour, fournisseur, noterCout = async () => {}, relire = true } = {}) {
  if (!usage().nuit) return { saute: "usage-coupe" };
  // Le modèle « local » doit l'être vraiment (contre-relecture du 29/10).
  if (!modeleLocalChezToi()) return { saute: "modele-pas-chez-toi" };
  if (relire) await synchroniser().catch((err) => console.warn(`Conversations externes : relecture avant la nuit impossible (${err.code || err.message})`));
  if (!baseExiste()) return { vide: true };
  const matiere = matiereDuJour(jour);
  if (!matiere) return { vide: true, jour };
  const reqId = crypto.randomUUID();
  const r = await fournisseur.complete({
    prive: true, // modèle local ou rien
    system: `${PROMPT_NUIT}\n\n${CONSIGNE_MATIERE}`,
    prompt: `Conversations du ${jour} (${matiere.conversations} conversation(s)) :\n\n${matiere.texte}\n\n---\n\nPrépare le JSON.`,
    maxTokens: 3000,
    schema: SCHEMA,
  });
  await noterCout("conversations-nuit", fournisseur.name, r.model, r.usage, reqId, `Conversations du ${jour}`);
  const resume = lireReponse(r.text);
  transaction((t) => {
    t.prepare(
      "INSERT INTO digests (jour, cree_a, sources, contenu) VALUES (?, ?, ?, ?) ON CONFLICT(jour) DO UPDATE SET cree_a = excluded.cree_a, sources = excluded.sources, contenu = excluded.contenu",
    ).run(jour, Date.now(), JSON.stringify(matiere.sources), chiffrer(JSON.stringify(resume), `digest:${jour}`));
  });
  return { ok: true, jour, conversations: matiere.conversations, themes: resume.themes.length, aFaire: resume.aFaire.length };
}

export function lireDigest(jour) {
  if (!baseExiste()) return null;
  const d = base().prepare("SELECT jour, cree_a, sources, contenu FROM digests WHERE jour = ?").get(jour);
  if (!d) return null;
  const brut = dechiffrerOuNull(d.contenu, `digest:${jour}`);
  if (!brut) return null;
  let sources = [];
  try {
    sources = JSON.parse(d.sources || "[]");
  } catch {}
  return { jour: d.jour, creeA: d.cree_a, sources, ...JSON.parse(brut) };
}

// Le dernier résumé disponible (les 7 derniers jours).
export function dernierDigest(maintenant = Date.now()) {
  if (!baseExiste()) return null;
  const d = base().prepare("SELECT jour FROM digests ORDER BY jour DESC LIMIT 1").get();
  if (!d) return null;
  const limite = horodate(maintenant - 7 * 86_400_000).jour;
  return d.jour >= limite ? lireDigest(d.jour) : null;
}

// La ligne du briefing du matin : celle de la veille, si la nuit en a tiré une.
export function ligneDuMatin(maintenant = Date.now()) {
  if (!usage().nuit) return null;
  const jour = jourPrecedent(maintenant);
  const d = lireDigest(jour);
  if (!d?.ligne) return null;
  return { ligne: d.ligne, jour, sources: d.sources };
}
