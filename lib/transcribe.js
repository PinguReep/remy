// Transcription vocale côté serveur — la même qualité que la dictée de ChatGPT.
//
// La dictée de ChatGPT repose sur Whisper (OpenAI), un modèle open source.
// L'API « audio/transcriptions » d'OpenAI est devenue un standard de fait, servie
// aussi par Groq (Whisper hébergé, palier gratuit généreux) et Mistral (Voxtral).
// On utilise la première clé configurée ; TRANSCRIBE_BASE_URL permet même de
// pointer vers un serveur Whisper auto-hébergé compatible (whisper.cpp,
// faster-whisper…), 100 % gratuit et local.
//
// Invariant (Constitution) : l'audio n'est JAMAIS conservé — il transite en
// mémoire, seule la transcription existe ensuite.

import { chrono } from "./mesures.js";
import { VOCABULAIRE } from "./profil.js";

const PROVIDERS = [
  {
    name: "groq",
    keyVar: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3-turbo",
    usdPerMin: 0.04 / 60, // 0,04 $/heure — et un palier gratuit généreux
  },
  {
    name: "openai",
    keyVar: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    // Le grand modèle, pas le mini : Sam marmonne parfois, la voix est
    // prioritaire (0,006 $/min au lieu de 0,003 — ~0,36 $/h de dictée).
    model: "gpt-4o-transcribe",
    usdPerMin: 0.006,
  },
  {
    name: "mistral",
    keyVar: "MISTRAL_API_KEY",
    baseUrl: "https://api.mistral.ai/v1",
    model: "voxtral-mini-latest",
    usdPerMin: 0.001,
  },
];

export const transcriptionCloudBloquee = () =>
  Boolean(process.env.REMY_GLM_URL) && process.env.REMY_CERVEAU !== "cloud" && process.env.TRANSCRIPTION_CLOUD !== "on";

export const DICTEE_INDISPONIBLE =
  "Dictée indisponible : la Dictée Locale de la tour ne répond pas ou n'est pas branchée (DICTEE_LOCALE_URL), et l'audio ne part pas dans le cloud sans TRANSCRIPTION_CLOUD=on.";

export function transcribeProvider() {
  // Dictée Locale (Whisper sur la 5070 Ti de la tour, vocabulaire appris de
  // Sam, nettoyage fidèle). Quand elle est branchée, elle est la SEULE voie :
  // pas de repli vers un service en ligne, l'audio ne quitte pas la tour.
  if (process.env.DICTEE_LOCALE_URL) {
    return {
      name: "dictee-locale",
      key: "local",
      baseUrl: process.env.DICTEE_LOCALE_URL.replace(/\/+$/, ""),
      model: process.env.TRANSCRIBE_MODEL || "large-v3-turbo",
      usdPerMin: 0,
      locale: true,
    };
  }
  // Cerveau local (GLM branché) : la voix suit la même règle que le texte
  // (D21, 14/10/2026) — pas de transcription dans le cloud sans l'avoir décidé.
  // Sans Dictée Locale, la dictée se dit indisponible ; TRANSCRIPTION_CLOUD=on
  // rouvre la voie aux services en ligne, en connaissance de cause.
  if (transcriptionCloudBloquee()) return null;
  const forced = process.env.TRANSCRIBE_PROVIDER;
  const list = forced ? PROVIDERS.filter((p) => p.name === forced) : PROVIDERS;
  const found = list.find((p) => process.env[p.keyVar]);
  if (!found) return null;
  return {
    ...found,
    key: process.env[found.keyVar],
    baseUrl: process.env.TRANSCRIBE_BASE_URL || found.baseUrl,
    model: process.env.TRANSCRIBE_MODEL || found.model,
  };
}

function fileName(mime) {
  if (mime.includes("mp4")) return "audio.mp4";
  if (mime.includes("webm")) return "audio.webm";
  if (mime.includes("ogg")) return "audio.ogg";
  if (mime.includes("wav")) return "audio.wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "audio.mp3";
  return "audio.bin";
}

// « Corriger la dictée » depuis l'app : Sam surligne un mot mal compris et tape
// le bon. Dictée Locale l'apprend tout de suite (règle « entendu → voulu »),
// pour toutes les dictées suivantes. Rien ne sort de la tour : Dictée Locale
// n'écoute qu'en 127.0.0.1. Rend { de, vers } ou lève une erreur avec .status.
export async function corrigerDictee(entendu, voulu) {
  const erreur = (status, message) => Object.assign(new Error(message), { status });
  const p = transcribeProvider();
  if (!p?.locale) throw erreur(503, "Dictée Locale n'est pas branchée sur cette tour : la correction n'a nulle part où aller.");
  let r;
  try {
    r = await fetch(`${p.baseUrl}/vocabulaire/corrections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entendu, voulu }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw erreur(502, "Dictée Locale ne répond pas — vérifie que l'app tourne sur la tour (icône près de l'horloge).");
  }
  if (r.status === 404) throw erreur(501, "Dictée Locale ne sait pas encore apprendre depuis Rémy : mets-la à jour.");
  if (!r.ok) throw erreur(400, "Dictée Locale a refusé cette correction : quelques mots, pas une phrase.");
  const d = await r.json().catch(() => ({}));
  return { de: String(d.de || entendu), vers: String(d.vers || voulu) };
}

// Le temps laissé au moteur : 90 s, plus la durée du vocal (un vocal long se
// transcrit puis se relit sur la tour). L'iPhone attend un peu plus longtemps :
// c'est la tour qui dit ce qui coince.
export const delaiTranscription = (secondes = 0) => 90_000 + Math.max(0, Number(secondes) || 0) * 1000;

export async function transcribe(buffer, mime, provider, secondes = 0) {
  const fin = chrono("dictee");
  try {
    return await transcrireBrut(buffer, mime, provider, secondes);
  } finally {
    fin({ octets: buffer?.length ?? null });
  }
}

async function transcrireBrut(buffer, mime, provider, secondes) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), fileName(mime));
  form.append("model", provider.model);
  const lang = process.env.TRANSCRIBE_LANGUAGE ?? "fr";
  if (lang) form.append("language", lang);
  // Amorce de contexte : oriente le modèle vers le bon vocabulaire — grosse
  // différence quand on marmonne ou qu'on parle bas.
  const hint =
    process.env.TRANSCRIBE_PROMPT ??
    `Message dicté en français à Rémy, un assistant personnel. Vocabulaire fréquent : Rémy, Motion, Claude, briefing, planning, rappel${VOCABULAIRE ? `, ${VOCABULAIRE}` : ""}.`;
  if (hint) form.append("prompt", hint);
  form.append("response_format", "json");

  const r = await fetch(`${provider.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.key}` },
    body: form,
    signal: AbortSignal.timeout(delaiTranscription(secondes)),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`Transcription ${provider.name} (${r.status}) : ${detail.slice(0, 200)}`);
  }
  const data = await r.json();
  return String(data.text || "").trim();
}
