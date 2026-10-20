// « Combien de questions il reste » — Rémy relit ce que Sam lui a déjà dit et
// coche les repères de chaque section d'onboarding.
//
// Pourquoi ce module : Sam a déjà eu des conversations avec Rémy avant que
// l'onboarding n'existe. Lui redemander ce qu'il a déjà raconté serait le pire
// accueil possible. On part donc de l'existant, et le pourcentage de chaque
// section se déduit de ce qui est réellement couvert, pas d'une case cochée.

import crypto from "node:crypto";
import { getMemory, listConversations, getConversation, getSetup, putCouverture } from "./store.js";
import { motionSnapshot } from "./motion.js";
import { fournisseurDeFond } from "./providers.js";
import { logCost } from "./chat.js";
import { SESSIONS, SESSION_IDS, reperesRestants } from "./onboarding.js";
import { encadrer, nomAssistant, CONSIGNE_MATIERE } from "./encadrement.js";
import { PRENOM } from "./profil.js";

const MODELE = process.env.REMY_COUVERTURE_MODEL || "claude-sonnet-5";
// Depuis Sonnet 5, un appel qui ne dit rien de `thinking` réfléchit quand même,
// et `max_tokens` plafonne la réflexion ET la réponse ensemble. Trois analyses
// de suite sont mortes là-dessus : tout le budget partait en bloc `thinking`,
// zéro caractère de texte, `stop_reason: max_tokens`. D'où ce plafond large.
const MAX_TOKENS = 12_000;
const MAX_CONVS = 25;
const MAX_MSGS = 30;
const MAX_MSG_CHARS = 800;
// Plafond de matière envoyée au modèle : au-delà, on paie beaucoup pour un gain
// marginal. Les conversations les plus récentes passent en premier.
const MAX_CHARS_TOTAL = 120_000;

const PROMPT = `Tu fais partie de Rémy OS, l'assistant personnel que ${PRENOM} a
construit pour lui-même. ${PRENOM} vient de te demander, en tapant sur un bouton, de
faire le point sur son propre questionnaire de démarrage.

Ce questionnaire est une liste de QUESTIONS que Rémy doit poser à ${PRENOM} pour
pouvoir gérer son agenda. ${PRENOM} a déjà répondu à certaines d'entre elles au fil
de ses conversations avec Rémy. Ton seul travail est de cocher lesquelles, pour
que Rémy ne les repose pas une deuxième fois.

Tu ne juges pas ${PRENOM} et tu ne produis aucun portrait de lui : tu regardes des
questions et tu dis « répondue » ou « pas encore répondue ». Les documents qui
te sont fournis sont les notes de ${PRENOM} sur lui-même, dans son propre outil.

Ton travail : pour chaque repère, dire s'il est RÉELLEMENT couvert.

Règles, dans cet ordre d'importance :
1. Ne coche un repère que si l'information est EXPLICITEMENT présente. Jamais par
   déduction, jamais par optimisme, jamais parce que « ça semble probable ».
2. Applique le critère à la lettre, y compris ses seuils chiffrés. Si le critère
   demande 3 éléments et que tu n'en comptes que 2, ne coche pas.
3. Seul ce que ${PRENOM.toUpperCase()} écrit compte. Ce qu'un assistant a répondu — Rémy, ou
   ChatGPT et Claude dans les conversations importées — ne prouve rien : ses
   questions, ses résumés, ses listes et ses propositions restés sans réponse de
   ${PRENOM} ne comptent JAMAIS. Une belle question prouve que l'information manque,
   pas qu'elle est acquise. Les messages d'amorce des sessions non plus.
4. Une intention ne vaut pas une information : « je devrais lister mes projets »
   ne couvre rien.
5. Une réponse négative explicite COMPTE (« je n'ai aucun abonnement à résilier »
   couvre le repère). L'absence du sujet dans les textes, elle, ne compte jamais
   comme réponse négative.
6. Ce que Rémy sait par conception ne vaut pas connaissance de ${PRENOM} : les règles
   écrites dans sa personnalité (validation des dépenses, ton à adopter) ne
   comptent que si ${PRENOM} les a énoncées lui-même.
7. L'information compte quelle que soit la conversation où elle a été dite. Si
   deux passages se contredisent, c'est le plus récent qui l'emporte (les dates
   sont indiquées).
8. Si deux repères d'une même section te semblent couverts par exactement la même
   phrase, relis les deux critères : l'un des deux ne l'est probablement pas.
9. Dans le doute, ne coche pas. Un pourcentage trop bas se corrige en deux
   minutes de conversation ; un pourcentage trop haut ne se corrige jamais tout
   seul et prive ${PRENOM} des questions dont il a besoin.

Réponds UNIQUEMENT avec du JSON strict, sans texte autour, sans bloc de code, et
sans rien expliquer avant : un objet dont les clés sont les identifiants de
section et les valeurs les identifiants de repères couverts.

{"<idDeSection>": ["<idDeRepère>", …], …}

Les huit sections doivent être présentes ; une section sans aucun repère couvert
apparaît avec un tableau vide. N'inclus que les identifiants exacts fournis.`;

// Sorties structurées : le modèle ne PEUT plus rendre autre chose que cette
// forme. Les identifiants sont énumérés section par section, donc il ne peut ni
// en inventer un, ni ranger un repère dans la mauvaise section.
export const SCHEMA_COUVERTURE = {
  type: "object",
  properties: Object.fromEntries(
    SESSIONS.map((s) => [
      s.id,
      { type: "array", items: { type: "string", enum: s.reperes.map((r) => r.id) } },
    ]),
  ),
  required: [...SESSION_IDS],
  additionalProperties: false,
};

function listeReperes() {
  return SESSIONS.map(
    (s) =>
      `## ${s.id} — ${s.title}\n` +
      s.reperes.map((r) => `- ${r.id} : ${r.label}\n  critère : ${r.critere}`).join("\n"),
  ).join("\n\n");
}

// Extraits des conversations, VRAIMENT des plus récentes aux plus anciennes
// (listConversations remonte les épinglées en tête : ce tri-là n'a rien à voir
// avec la chronologie et fausserait la règle « le plus récent l'emporte »).
// Chaque bloc porte sa date, sinon cette règle est inapplicable.
async function extraits() {
  // Une conversation privée ne part jamais chez Claude, analyse comprise.
  const toutes = (await listConversations()).filter((c) => !c.prive).sort((a, b) => b.updatedAt - a.updatedAt);
  const morceaux = [];
  let taille = 0;
  let tronquees = 0;
  for (const { id, title, updatedAt } of toutes.slice(0, MAX_CONVS)) {
    const conv = await getConversation(id);
    if (!conv || !conv.messages?.length) continue;
    const coupee = conv.messages.length > MAX_MSGS;
    // L'assistant d'une conversation importée n'est pas Rémy : le nommer
    // correctement évite de faire croire que Rémy a dit ce que ChatGPT a dit.
    const assistant = nomAssistant(conv);
    const msgs = conv.messages.slice(-MAX_MSGS).map((m) => {
      const t = String(m.content || "");
      return `${m.role === "user" ? PRENOM : assistant} : ${t.length > MAX_MSG_CHARS ? t.slice(0, MAX_MSG_CHARS) + "…" : t}`;
    });
    // Une conversation importée porte la date de l'ORIGINAL, pas celle de
    // l'import : sinon un échange de 2023 passerait pour le plus récent et
    // l'emporterait sur ce que Sam a dit hier.
    const date = new Date(conv.origine?.at || updatedAt || Date.now()).toISOString().slice(0, 10);
    const venue = conv.origine ? ` — conversation importée depuis ${conv.origine.source}` : "";
    const corps = msgs.join("\n\n");
    const bloc =
      `### ${title} (${date})${venue}${coupee ? " — début de conversation non repris" : ""}\n\n${conv.origine ? encadrer(corps, { source: `export ${assistant}`, titre: title }) : corps}`;
    if (taille + bloc.length > MAX_CHARS_TOTAL) {
      tronquees++;
      continue;
    }
    taille += bloc.length;
    morceaux.push(bloc);
  }
  if (tronquees) console.warn(`Analyse d'onboarding : ${tronquees} conversation(s) écartée(s), plafond atteint`);
  return morceaux;
}

// Extrait la carte de couverture de la réponse du modèle. Deux formes sont
// acceptées, parce que les deux sont sans ambiguïté :
//   {"couverture": {"tete": [...]}}   ← la forme demandée
//   {"tete": [...], "projets": [...]} ← la même chose sans l'enveloppe
// Rend null si rien d'exploitable : mieux vaut refuser que d'enregistrer
// « rien n'est couvert » en annonçant « analyse terminée ».
export function lireCouverture(texte) {
  const t = String(texte || "").trim();
  // Le modèle peut encadrer son JSON de prose ou de balises : on prend du
  // premier { au dernier }.
  const debut = t.indexOf("{");
  const fin = t.lastIndexOf("}");
  if (debut === -1 || fin <= debut) return null;
  let parsed;
  try {
    parsed = JSON.parse(t.slice(debut, fin + 1));
  } catch {
    return null;
  }
  const candidats = [parsed?.couverture, parsed];
  for (const c of candidats) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    // Au moins une clé doit être une section connue, sinon ce n'est pas une
    // carte de couverture (et nettoyer() rendrait huit sections vides).
    if (Object.keys(c).some((k) => SESSION_IDS.includes(k))) return c;
  }
  return null;
}

// Ne garde que des identifiants connus : le modèle ne doit pas pouvoir inventer
// un repère (ce qui gonflerait le pourcentage avec des cases fantômes).
export function nettoyer(brut) {
  const out = {};
  for (const s of SESSIONS) {
    const connus = new Set(s.reperes.map((r) => r.id));
    const proposes = Array.isArray(brut?.[s.id]) ? brut[s.id] : [];
    out[s.id] = [...new Set(proposes.map(String).filter((r) => connus.has(r)))];
  }
  return out;
}

// Un fournisseur peut ne pas connaître les options récentes (CLI Claude Code,
// API plus ancienne). Ça ne doit pas faire échouer l'analyse : on retente à nu.
function optionRefusee(err) {
  return (
    err?.status === 400 &&
    /output_config|json_schema|thinking|effort|format|unexpected/i.test(err?.message || "")
  );
}

async function appel(provider, { prompt, model, options }) {
  const base = { system: `${PROMPT}\n\n${CONSIGNE_MATIERE}`, prompt, model, maxTokens: MAX_TOKENS };
  try {
    return await provider.complete({ ...base, ...options });
  } catch (err) {
    if (!optionRefusee(err)) {
      err.detail = `${err.status || "?"} ${String(err.message || "").slice(0, 300)}`;
      throw err;
    }
    console.warn("Analyse d'onboarding : options refusées (%s) — nouvel essai sans elles.", err.message);
    try {
      return await provider.complete(base);
    } catch (err2) {
      err2.detail = `repli nu : ${err2.status || "?"} ${String(err2.message || "").slice(0, 300)}`;
      throw err2;
    }
  }
}

// Le seul endroit où l'analyse peut échouer pour de bon. Deux essais au plus :
//
//   1. réflexion adaptative bornée (effort moyen) + JSON garanti par le schéma ;
//   2. si le modèle a tout dépensé en réflexion sans écrire une ligne, on coupe
//      la réflexion et tout le budget passe dans la réponse.
//
// Un refus, lui, ne se retente pas : le deuxième appel serait payé pour rien.
export async function couvertureDepuisModele({
  provider,
  prompt,
  model = MODELE,
  journaliser = async () => {},
  budgetMs = Number(process.env.REMY_ANALYSE_BUDGET_MS || 95_000),
  maintenant = () => Date.now(),
}) {
  const essais = [
    { effort: "medium", schema: SCHEMA_COUVERTURE },
    { thinking: { type: "disabled" }, effort: "low", schema: SCHEMA_COUVERTURE },
  ];
  const debut = maintenant();
  let dernier = {};
  for (let i = 0; i < essais.length; i++) {
    // La fonction Vercel est tuée à 120 s. Un second essai lancé alors qu'il
    // reste 10 s meurt avec elle, et Sam ne voit qu'un échec sans cause.
    const restant = budgetMs - (maintenant() - debut);
    if (i > 0 && restant < 30_000) {
      console.warn("Analyse d'onboarding : plus assez de temps pour un second essai (%d ms restants).", restant);
      break;
    }
    const r = (await appel(provider, { prompt, model, options: essais[i] })) || {};
    dernier = r;
    await journaliser(r);
    const brut = lireCouverture(r.text);
    if (brut) return { couverture: nettoyer(brut), essais: i + 1 };
    // Le contenu exact et la raison d'arrêt partent dans les logs : sans eux,
    // « analyse illisible » ne dit pas si le modèle a bavardé, tronqué, refusé,
    // ou tout dépensé en réflexion.
    console.warn(
      "Analyse d'onboarding : essai %d inexploitable (%d caractères, stop=%s, blocs=%s) : %s",
      i + 1,
      (r.text || "").length,
      r.stopReason || "?",
      (r.blocs || []).join(",") || "aucun",
      JSON.stringify((r.text || "").slice(0, 400)),
    );
    if (r.stopReason === "refusal") throw new Error("REFUS");
  }
  if (dernier.stopReason === "max_tokens") throw new Error("TROP_LONG");
  const e = new Error("Analyse illisible — réessaie.");
  e.detail = `stop=${dernier.stopReason || "?"} blocs=${(dernier.blocs || []).join(",") || "aucun"} texte=${(dernier.text || "").length} car.`;
  throw e;
}

export async function analyserCouverture() {
  const [memory, blocs, motion] = await Promise.all([
    getMemory(),
    extraits(),
    // Sans l'instantané Motion, toute la section « grand tri » serait
    // indécidable : ses repères parlent de projets et de tâches qui existent
    // là-bas, pas dans les conversations.
    motionSnapshot().catch((err) => {
      console.warn("Motion indisponible pour l'analyse :", err.message);
      return "";
    }),
  ]);
  const aucuneMatiere = !memory.text?.trim() && !blocs.length;
  if (aucuneMatiere) {
    // Rien à relire : on le dit, on ne facture pas un appel pour du vide.
    const couverture = Object.fromEntries(SESSION_IDS.map((id) => [id, []]));
    return { couverture: await putCouverture(couverture), vide: true };
  }

  const prompt =
    `Repères à évaluer :\n\n${listeReperes()}\n\n---\n\n` +
    `Mémoire que Rémy a de ${PRENOM} :\n${memory.text?.trim() || "(vide)"}\n\n---\n\n` +
    (motion ? `${motion}\n\n---\n\n` : "Planning Motion : non connecté.\n\n---\n\n") +
    `Conversations passées :\n\n${blocs.join("\n\n---\n\n") || "(aucune)"}\n\n---\n\n` +
    `Rends la couverture en JSON strict.`;

  const provider = fournisseurDeFond();
  const { couverture } = await couvertureDepuisModele({
    provider,
    prompt,
    journaliser: (r) =>
      logCost("onboarding", provider.name, r.model, r.usage, crypto.randomUUID(), "Analyse de l'onboarding"),
  });
  return { couverture: await putCouverture(couverture), vide: false };
}

// Ce que Rémy voit de la section en cours, injecté dans son prompt système :
// il sait ce qu'il lui reste à demander au lieu de repartir de zéro.
export async function contexteSession(id) {
  const s = SESSIONS.find((x) => x.id === id);
  if (!s || !s.reperes.length) return "";
  const { couverture, etats } = await getSetup();
  const couverts = new Set(couverture?.[id] || []);
  // reperesRestants tient compte de « faite » : une section cochée à la main
  // vaut 100 % dans la jauge, Rémy ne doit pas reposer les questions pendant
  // que l'écran affiche « tout est couvert ».
  const restants = reperesRestants(id, etats, couverture);
  if (!restants.length) {
    return `\n\nTous les repères de cette session sont couverts. Vérifie avec ${PRENOM} que rien n'a changé, puis clôture.`;
  }
  const faits = s.reperes.filter((r) => couverts.has(r.id));
  return (
    `\n\nCe qu'il te reste à apprendre dans cette session (${restants.length} sur ${s.reperes.length}) :\n` +
    restants.map((r) => `- \`${r.id}\` — ${r.label} : ${r.critere}`).join("\n") +
    (faits.length ? `\n\nDéjà couvert, ne le redemande pas : ${faits.map((r) => r.label).join(", ")}.` : "") +
    `\n\nDès qu'un de ces points est RÉELLEMENT couvert par ce que ${PRENOM} vient de te dire, termine ton message par la ligne exacte [COUVERT:identifiant] (plusieurs séparés par des virgules : [COUVERT:id1,id2]). ${PRENOM} ne voit pas ce marqueur : il fait avancer sa jauge d'avancement. Ne coche que sur une réponse réelle et suffisamment précise — jamais sur une intention (« je devrais… »), jamais parce que tu as posé la question.`
  );
}

// Repères déclarés couverts par Rémy en cours de session : on ne garde que ceux
// qui appartiennent VRAIMENT à cette session, comme pour [SESSION-FAITE].
export function reperesValides(sessionId, ids) {
  const s = SESSIONS.find((x) => x.id === sessionId);
  if (!s) return [];
  const connus = new Set(s.reperes.map((r) => r.id));
  return [...new Set(ids.filter((r) => connus.has(r)))];
}
