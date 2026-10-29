// Interface « Cerveau » (Lot 0, J0.9) : ce que Rémy attend d'un modèle, quel
// qu'il soit — GLM aujourd'hui, Hermès (piste S3) et Qwen demain, Claude en
// secours. Brancher un nouveau modèle local = déclarer son adresse, rien de plus.
//
//   completer({ system, prompt, maxTokens })   → { text, usage, model }
//   analyser({ system, prompt, schema })       → { valeur, usage, model }   (JSON validé par le relais)
//
// Un cerveau LOCAL tourne sur les machines de Sam (les Sparks) : 0 $ dans
// le panneau des coûts, et chaque appel passe par la garde de charge
// (lib/jobs.js) — un job attend sa place, un tap de Sam jamais.
//
// Les modèles locaux parlent tous le dialecte « chat completions » d'OpenAI
// (vLLM, tensorfold, llama.cpp) : un seul adaptateur suffit.

import { inference, signalerSurcharge } from "./jobs.js";
import { formatRefuse, avecSchemaEnConsigne, detailLisible } from "./glm.js";

// Noms de fournisseurs qui désignent les machines de Sam.
const LOCAUX = new Set(["glm", "qwen", "hermes", "local"]);
export const estLocal = (nom) => LOCAUX.has(String(nom || "").toLowerCase());

export class ErreurCerveau extends Error {
  constructor(nom, message, { nature = "reponse", status = null } = {}) {
    super(`${nom} : ${message}`);
    this.nature = nature; // injoignable | occupe | reponse
    this.status = status;
  }
}

const lireObjet = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
};

// Un cerveau local, joignable en « chat completions ». Rien n'est appelé à la
// création : un cerveau déclaré mais éteint ne coûte rien.
export function cerveauLocal({ nom, url, modele, jeton = null, delaiMs = 180_000 }) {
  if (!LOCAUX.has(nom)) LOCAUX.add(nom);
  const base = String(url || "").replace(/\/+$/, "");
  let formatSansImposer = false;

  async function appeler(corps) {
    return inference(async () => {
      let r;
      try {
        r = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
          body: JSON.stringify({ model: modele, ...corps }),
          signal: AbortSignal.timeout(delaiMs),
        });
      } catch (err) {
        throw new ErreurCerveau(nom, `injoignable (${err.name === "TimeoutError" ? "délai dépassé" : err.message})`, { nature: "injoignable" });
      }
      if (r.status === 429) {
        signalerSurcharge(60_000, `occupées (${nom}, 429)`);
        throw new ErreurCerveau(nom, "occupé (les Sparks sont au maximum)", { nature: "occupe", status: 429 });
      }
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        if (formatRefuse(r.status, detail)) throw new ErreurCerveau(nom, "ne sait pas imposer un format de réponse", { status: r.status, nature: "format" });
        const lisible = detailLisible(detail).slice(0, 160);
        throw new ErreurCerveau(nom, `réponse ${r.status}${lisible ? ` (${lisible})` : ""}`, { status: r.status, nature: r.status >= 502 ? "injoignable" : "reponse" });
      }
      const j = await r.json().catch(() => null);
      const choix = j?.choices?.[0];
      if (!choix) throw new ErreurCerveau(nom, "réponse illisible");
      return {
        text: String(choix.message?.content || "").replace(/^[\s\S]*<\/think>/, "").trim(),
        usage: { input_tokens: j.usage?.prompt_tokens || 0, output_tokens: j.usage?.completion_tokens || 0 },
        model: modele || nom,
      };
    });
  }

  const messages = (system, prompt) => [
    ...(system ? [{ role: "system", content: String(system) }] : []),
    { role: "user", content: String(prompt) },
  ];

  return {
    nom,
    local: true,
    async completer({ system, prompt, maxTokens = 4000 }) {
      return appeler({ messages: messages(system, prompt), max_tokens: maxTokens, temperature: 0.2 });
    },
    // Un relais qui ne sait pas imposer le format (formatRefuse, lib/glm.js)
    // reçoit le schéma dans la consigne ; le refus est retenu pour ce cerveau.
    async analyser({ system, prompt, schema, maxTokens = 4000 }) {
      const corps = (impose) => ({
        messages: messages(impose ? system : avecSchemaEnConsigne(system ? String(system) : "", schema), prompt),
        max_tokens: maxTokens,
        temperature: 0,
        ...(impose ? { response_format: { type: "json_schema", json_schema: { name: "reponse", schema } } } : {}),
      });
      let r;
      try {
        r = await appeler(corps(!formatSansImposer));
      } catch (err) {
        if (formatSansImposer || !(err instanceof ErreurCerveau && err.nature === "format")) throw err;
        formatSansImposer = true;
        r = await appeler(corps(false));
      }
      const t = r.text.replace(/^```(?:json)?\s*|\s*```$/g, "");
      // Sans format imposé, du texte peut entourer l'objet : on garde l'objet.
      const valeur = lireObjet(t) ?? lireObjet(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
      if (valeur === undefined) throw new ErreurCerveau(nom, "JSON illisible");
      return { valeur, usage: r.usage, model: r.model };
    },
  };
}

// Les cerveaux locaux déclarés sur la tour, en plus de GLM (lib/glm.js) :
//   REMY_HERMES_URL (+ REMY_HERMES_MODELE, REMY_HERMES_TOKEN) — piste S3
//   REMY_QWEN_URL   (+ REMY_QWEN_MODELE,   REMY_QWEN_TOKEN)
export function cerveauxDeclares() {
  const out = {};
  for (const nom of ["hermes", "qwen"]) {
    const url = process.env[`REMY_${nom.toUpperCase()}_URL`];
    if (!url) continue;
    out[nom] = cerveauLocal({
      nom,
      url,
      modele: process.env[`REMY_${nom.toUpperCase()}_MODELE`] || nom,
      jeton: process.env[`REMY_${nom.toUpperCase()}_TOKEN`] || null,
    });
  }
  return out;
}
