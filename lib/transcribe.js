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

export async function transcribe(buffer, mime, provider) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), fileName(mime));
  form.append("model", provider.model);
  const lang = process.env.TRANSCRIBE_LANGUAGE ?? "fr";
  if (lang) form.append("language", lang);
  // Amorce de contexte : oriente le modèle vers le bon vocabulaire — grosse
  // différence quand on marmonne ou qu'on parle bas.
  const hint =
    process.env.TRANSCRIBE_PROMPT ??
    "Message dicté en français à Rémy, un assistant personnel. Vocabulaire fréquent : Rémy, Motion, Claude, TestFlight, briefing, tennis, boutique de bougies, garage, planning.";
  if (hint) form.append("prompt", hint);
  form.append("response_format", "json");

  const r = await fetch(`${provider.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.key}` },
    body: form,
    // Une dictée de 3 min se transcrit en quelques secondes : au-delà, on rend la main.
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`Transcription ${provider.name} (${r.status}) : ${detail.slice(0, 200)}`);
  }
  const data = await r.json();
  return String(data.text || "").trim();
}
