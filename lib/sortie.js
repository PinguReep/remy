// Ce que GLM laisse parfois traîner dans sa réponse, et qui n'a rien à faire
// sous les yeux de Sam (constaté le 09/10/2026 sur une demande de tri Motion) :
//   - ses appels d'outil au format natif, écrits en texte au lieu d'être émis
//     (« <tool_call>motion_proposer<arg_key>actions</arg_key><arg_value>… ») ;
//   - des boucles (« c'est le paramétrage du studio — c'est le paramétrage du
//     studio — c'est… ») et des caractères chinois isolés (« motion_prop器 »).
// Le texte nettoyé remplace l'affichage à la fin de la réponse (événement
// « done ») et c'est lui qui est enregistré.

const BLOC_APPEL = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g;
const PAIRE = /<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/g;

// DeepSeek (20/10) écrit les siens entre jetons spéciaux :
// <｜tool▁call▁begin｜>nom<｜tool▁sep｜>{"arg": …}<｜tool▁call▁end｜>
// (ou, plus ancien, « function<｜tool▁sep｜>nom » puis un bloc ```json).
const APPEL_DEEPSEEK = /<｜tool▁call▁begin｜>\s*(?:function\s*<｜tool▁sep｜>\s*([a-z_]+)|([a-z_]+)\s*<｜tool▁sep｜>)\s*([\s\S]*?)<｜tool▁call▁end｜>/g;
export const appelEcritEnTexte = (texte) => /<tool_call>|<｜tool▁call▁begin｜>/.test(String(texte || ""));

// Les appels d'outil complets écrits en texte : { name, args } — pour les
// exécuter quand même (ils ne font que PROPOSER : Sam valide toujours).
export function appelsEcritsEnTexte(texte) {
  const appels = [];
  for (const m of String(texte || "").matchAll(APPEL_DEEPSEEK)) {
    const brut = m[3].trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    try {
      const args = JSON.parse(brut);
      if (args && typeof args === "object") appels.push({ name: m[1] || m[2], args });
    } catch {}
  }
  for (const m of String(texte || "").matchAll(/<tool_call>\s*([a-z_]+)\s*([\s\S]*?)<\/tool_call>/g)) {
    const args = {};
    for (const p of m[2].matchAll(PAIRE)) {
      let v = p[2];
      try {
        v = JSON.parse(v);
      } catch {}
      args[p[1].trim()] = v;
    }
    if (Object.keys(args).length) appels.push({ name: m[1], args });
  }
  return appels;
}

// Une phrase de 12 à 160 caractères répétée 3 fois ou plus d'affilée n'en garde qu'une.
function sansBoucles(texte) {
  return texte.replace(/(\S[^\n]{11,159}?)(?:\s*[—–-]?\s*\1){2,}/g, "$1");
}

export function nettoyerSortie(texte) {
  let t = String(texte || "");
  if (!t) return t;
  // Une réflexion restée dans le texte (serveur qui ne la range pas à part).
  t = t.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
  if (t.includes("</think>")) t = t.slice(t.lastIndexOf("</think>") + "</think>".length).trimStart();
  t = t.replace(BLOC_APPEL, "");
  t = t.replace(/<｜tool▁calls▁begin｜>[\s\S]*?(?:<｜tool▁calls▁end｜>|$)/g, "");
  // Morceaux d'appel orphelins (le début de l'appel a été écrit plus haut) :
  // les paires complètes partent avec leur contenu, puis les balises seules.
  t = t.replace(/<arg_key>[\s\S]*?<\/arg_key>/g, "").replace(/<arg_value>[\s\S]*?<\/arg_value>/g, "");
  t = t.replace(/<\/?(?:arg_key|arg_value|tool_call)>/g, "");
  t = t.replace(/<\|[a-z_]+\|>/gi, ""); // jetons spéciaux du modèle
  t = t.replace(/<｜[^｜>]{1,40}｜>/g, ""); // ceux de DeepSeek (barre pleine chasse)
  t = t.replace(/[㐀-鿿豈-﫿]+/g, ""); // Sam écrit en français
  t = sansBoucles(t);
  return t.replace(/\n{3,}/g, "\n\n").trimEnd();
}
