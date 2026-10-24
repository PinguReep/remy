// Grille tarifaire de l'API Anthropic (USD par million de tokens) et estimation
// du coût d'un appel. Les montants sont des ESTIMATIONS : la facture qui fait foi
// est celle de la console Anthropic (platform.claude.com).

const PRICES = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-opus-4-6": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  // Le modèle local des Sparks : rien n'est facturé (l'électricité mise à part).
  "glm-": { in: 0, out: 0 },
  "GLM-": { in: 0, out: 0 },
};

function priceFor(model) {
  if (!model) return PRICES["claude-opus-5"];
  const key = Object.keys(PRICES).find((k) => String(model).startsWith(k));
  return key ? PRICES[key] : PRICES["claude-opus-5"];
}

// usage : objet renvoyé par l'API (input_tokens, output_tokens,
// cache_creation_input_tokens, cache_read_input_tokens, web_search_requests)
export function estimateCostUsd(model, usage) {
  if (!usage) return 0;
  const p = priceFor(model);
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0; // ~1,25× le prix d'entrée
  const cacheRead = usage.cache_read_input_tokens || 0; // ~0,1× le prix d'entrée
  const webSearches = usage.web_search_requests || 0; // 10 $ les 1 000 recherches
  return (
    (input * p.in + cacheWrite * p.in * 1.25 + cacheRead * p.in * 0.1 + output * p.out) /
      1_000_000 +
    webSearches * 0.01
  );
}

// Seuls les modèles Claude sont facturés : le reste tourne sur les Sparks
// (GLM, DeepSeek, Qwen…), ou c'est Rémy lui-même. Les réponses enregistrées
// avant le 24/10 portaient un prix d'Opus pour un modèle local inconnu ; on le
// remet à 0 $ à la lecture, sans réécrire la conversation. Sans modèle noté
// (vieilles réponses), on garde le prix : c'était Claude.
export const modeleFacture = (model) => /^claude/i.test(String(model || ""));

export function corrigerCoutsLocaux(conv) {
  for (const m of conv?.messages || []) {
    if (m?.role === "assistant" && m.usd > 0 && m.model && !modeleFacture(m.model)) m.usd = 0;
  }
  return conv;
}
