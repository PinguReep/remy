// Masquage des secrets AVANT tout stockage (mémoire de projets, lot B).
// Les sessions de code contiennent des clés d'API, des jetons, des mots de
// passe collés par erreur : rien de tout ça ne doit entrer dans la base de
// connaissances. Le masquage se fait en mémoire, le texte d'origine n'est
// jamais écrit.
//
// Trois filets :
//   1. des motifs connus (préfixes de clés, JWT, PEM, URL avec identifiants…) ;
//   2. des phrases (« mot de passe : … », password=…) ;
//   3. les valeurs exactes des secrets de la tour (remy.env), retirées à l'identique.

const MASQUE = "[secret masqué]";

// Préfixes et formats de jetons courants. Volontairement larges : un faux
// positif coûte un mot masqué, un faux négatif coûte un secret en clair.
const MOTIFS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bwhsec_[A-Za-z0-9]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\btskey-[A-Za-z0-9-]{10,}/g,
  /\bhf_[A-Za-z0-9]{20,}/g,
  /\bnpm_[A-Za-z0-9]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, // https://utilisateur:motdepasse@hôte
  /(_authToken\s*=\s*)\S+/gi,
];

// « mot de passe : hunter2 », password=…, pwd: …, token: …, secret = …
const PHRASES =
  /\b(mot de passe|mdp|password|passwd|pwd|passphrase|secret|token|api[_-]?key|cl[ée] (?:d'api|api|secr[èe]te))(\s*(?:est|:|=|=>)\s*)(["']?)([^\s"',;]{4,})\3/gi;

// Une longue chaîne base64 ou hexadécimale juste après un mot-clé sensible.
const ENTROPIE = /\b(key|cle|clé|token|secret|signature|hash)\b([^\n]{0,20}?)([A-Za-z0-9+/_-]{32,}={0,2})/gi;

let valeursTour = null;
// Les valeurs des secrets de la tour (remy.env, chargé dans process.env) : une
// valeur de plus de 8 caractères dont le nom évoque un secret.
function secretsDeLaTour() {
  if (valeursTour) return valeursTour;
  const noms = /(KEY|TOKEN|SECRET|PASSWORD|HASH|CLE|PASS)/i;
  valeursTour = Object.entries(process.env)
    .filter(([n, v]) => noms.test(n) && typeof v === "string" && v.length >= 8)
    .map(([, v]) => v)
    .sort((a, b) => b.length - a.length);
  return valeursTour;
}

// Pour les tests : relire process.env.
export function oublierSecretsDeLaTour() {
  valeursTour = null;
}

export function masquer(texte) {
  let t = String(texte ?? "");
  if (!t) return { texte: t, masques: 0 };
  let masques = 0;
  for (const v of secretsDeLaTour()) {
    if (t.includes(v)) {
      masques += t.split(v).length - 1;
      t = t.split(v).join(MASQUE);
    }
  }
  for (const m of MOTIFS) {
    t = t.replace(m, (tout, g1) => {
      masques++;
      // Les URL et _authToken gardent leur préfixe lisible.
      if (/^[a-z][a-z0-9+.-]*:\/\/$/i.test(g1 || "")) return `${g1}${MASQUE}@`;
      if (/_authToken/i.test(g1 || "")) return `${g1}${MASQUE}`;
      if (/^(Bearer|Basic)$/i.test(g1 || "")) return `${g1} ${MASQUE}`;
      return MASQUE;
    });
  }
  t = t.replace(PHRASES, (tout, mot, sep, guillemet) => {
    masques++;
    return `${mot}${sep}${guillemet}${MASQUE}${guillemet}`;
  });
  t = t.replace(ENTROPIE, (tout, mot, entre, valeur) => {
    if (valeur === MASQUE) return tout;
    masques++;
    return `${mot}${entre}${MASQUE}`;
  });
  return { texte: t, masques };
}

// Un fichier dont le contenu ne doit jamais entrer, même masqué (lu par un
// outil dans une session : .env, clés, identifiants).
export function fichierSensible(chemin) {
  const nom = String(chemin || "").split(/[\\/]/).pop().toLowerCase();
  return (
    /^\.env(\..*)?$/.test(nom) ||
    /\.(pem|key|p12|pfx|p8)$/.test(nom) ||
    /^id_(rsa|ed25519|ecdsa|dsa)/.test(nom) ||
    [".npmrc", ".netrc", ".git-credentials", "remy.env", ".pypirc"].includes(nom) ||
    /^credentials.*\.json$/.test(nom) ||
    /[\\/]secrets[\\/]/i.test(String(chemin || ""))
  );
}
